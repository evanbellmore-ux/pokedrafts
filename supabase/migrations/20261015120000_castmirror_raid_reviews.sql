-- Private, bounded per-boss raid review cache. Apply in one admin transaction.
-- Existing account ledgers, history, leases, pins and compact pools are untouched.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

CREATE TABLE IF NOT EXISTS execution_v3.raid_reviews (
  account text NOT NULL REFERENCES execution_v3.accounts(account),
  key text NOT NULL CHECK (key ~ '^[a-f0-9]{64}$'),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 2 AND 2097152),
  version text NOT NULL CHECK (version = 'raid-execution-review-1'),
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL CHECK (expires_at = created_at + 600000),
  writer_owner uuid NOT NULL,
  writer_fence bigint NOT NULL CHECK (writer_fence BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (account,key)
);
ALTER TABLE execution_v3.raid_reviews OWNER TO execution_v3_owner;
ALTER TABLE execution_v3.raid_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON execution_v3.raid_reviews FROM PUBLIC, anon, authenticated, service_role, execution_v3_executor;

CREATE OR REPLACE FUNCTION execution_v3.read_raid_review(p_account text, p_key text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, execution_v3, pg_temp
SET lock_timeout = '250ms' SET statement_timeout = '3s' AS $fn$
DECLARE bytes bytea;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM execution_v3.accounts WHERE account = p_account AND enabled) THEN PERFORM execution_v3._fail('live-account-unavailable'); END IF;
  IF p_key IS NULL OR p_key !~ '^[a-f0-9]{64}$' THEN PERFORM execution_v3._fail('compact-cache-invalid'); END IF;
  SELECT r.bytes INTO bytes FROM execution_v3.raid_reviews r
    WHERE account = p_account AND key = p_key AND expires_at > execution_v3._now();
  RETURN convert_from(bytes,'UTF8');
END
$fn$;

CREATE OR REPLACE FUNCTION execution_v3.save_raid_review(p_account text, p_owner uuid, p_fence bigint, p_key text, p_payload text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, execution_v3, pg_temp
SET lock_timeout = '250ms' SET statement_timeout = '3s' AS $fn$
DECLARE a execution_v3.accounts%ROWTYPE; p jsonb; item jsonb; k text; at bigint;
BEGIN
  SELECT * INTO a FROM execution_v3.accounts WHERE account = p_account FOR UPDATE;
  IF NOT FOUND OR NOT a.enabled THEN PERFORM execution_v3._fail('live-account-unavailable'); END IF;
  IF p_owner IS NULL OR p_fence IS NULL OR a.owner IS DISTINCT FROM p_owner OR a.fence <> p_fence
     OR a.lease_until <= execution_v3._now() THEN PERFORM execution_v3._fail('live-lock-lost'); END IF;
  IF p_payload IS NULL OR octet_length(convert_to(p_payload,'UTF8')) NOT BETWEEN 2 AND 2097152 THEN PERFORM execution_v3._fail('compact-cache-size-cap'); END IF;
  BEGIN p := p_payload::jsonb;
  EXCEPTION WHEN OTHERS THEN PERFORM execution_v3._fail('compact-cache-invalid'); END;
  IF p_key IS NULL OR p_key !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p->>'key' IS DISTINCT FROM p_key OR p->>'version' IS DISTINCT FROM 'raid-execution-review-1'
     OR NOT coalesce(p->>'rulesVersion' ~ '^reviewed-contact-rubric-1-[a-f0-9]{16}$',false)
     OR NOT execution_v3._num(p->'at',false,true) OR p->'sampleLimit' IS DISTINCT FROM '6'::jsonb
     OR jsonb_typeof(p->'identity') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'scope') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p->'boss') IS DISTINCT FROM 'object'
     OR coalesce(p->>'status','') NOT IN ('complete','partial','unavailable')
     OR NOT execution_v3._num(p->'availableKills',false,true)
     OR jsonb_typeof(p->'fights') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'fights') > 6 THEN
    PERFORM execution_v3._fail('compact-cache-invalid');
  END IF;
  FOREACH k IN ARRAY ARRAY['name','server','region'] LOOP
    IF jsonb_typeof(p->'identity'->k) IS DISTINCT FROM 'string' OR length(p->'identity'->>k) NOT BETWEEN 1 AND 128 THEN
      PERFORM execution_v3._fail('compact-cache-invalid');
    END IF;
  END LOOP;
  IF jsonb_typeof(p->'identity'->'className') IS DISTINCT FROM 'string' OR length(p->'identity'->>'className') > 128 THEN
    PERFORM execution_v3._fail('compact-cache-invalid');
  END IF;
  FOREACH k IN ARRAY ARRAY['zone','encounter','difficulty','size','partition'] LOOP
    IF NOT execution_v3._num(p->'scope'->k,true,true) THEN PERFORM execution_v3._fail('compact-cache-invalid'); END IF;
  END LOOP;
  IF jsonb_typeof(p->'scope'->'patch') IS DISTINCT FROM 'string' OR length(p->'scope'->>'patch') NOT BETWEEN 1 AND 128
     OR p->'boss'->'id' IS DISTINCT FROM p->'scope'->'encounter' THEN PERFORM execution_v3._fail('compact-cache-invalid'); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p->'fights') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT coalesce(item->>'code' ~ '^[A-Za-z0-9]{16}$',false)
       OR NOT execution_v3._num(item->'fightID',true,true) OR NOT execution_v3._num(item->'actorID',true,true)
       OR coalesce(item->>'role','') NOT IN ('dps','tank','healer') OR jsonb_typeof(item->'spec') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'kill') IS DISTINCT FROM 'boolean' OR NOT execution_v3._num(item->'date',true,true)
       OR NOT execution_v3._num(item->'durationSec',true)
       OR jsonb_typeof(item->'damage') IS DISTINCT FROM 'object' OR jsonb_typeof(item->'survival') IS DISTINCT FROM 'object'
       OR jsonb_typeof(item->'utility') IS DISTINCT FROM 'object' OR jsonb_typeof(item->'limitations') IS DISTINCT FROM 'array' THEN
      PERFORM execution_v3._fail('compact-cache-invalid');
    END IF;
  END LOOP;
  at := execution_v3._now();
  IF (p->>'at')::numeric > at + 10000 OR (p->>'at')::numeric <= at - 600000 THEN PERFORM execution_v3._fail('compact-cache-invalid'); END IF;
  DELETE FROM execution_v3.raid_reviews WHERE account = p_account AND expires_at <= at;
  IF NOT EXISTS (SELECT 1 FROM execution_v3.raid_reviews WHERE account = p_account AND key = p_key)
     AND (SELECT count(*) FROM execution_v3.raid_reviews WHERE account = p_account) >= 64 THEN PERFORM execution_v3._fail('compact-cache-full'); END IF;
  IF a.lease_until <= execution_v3._now() THEN PERFORM execution_v3._fail('live-lock-lost'); END IF;
  INSERT INTO execution_v3.raid_reviews(account,key,bytes,version,created_at,expires_at,writer_owner,writer_fence)
    VALUES(p_account,p_key,convert_to(p_payload,'UTF8'),p->>'version',at,at+600000,p_owner,p_fence)
    ON CONFLICT(account,key) DO UPDATE SET bytes=excluded.bytes,writer_owner=excluded.writer_owner,writer_fence=excluded.writer_fence;
EXCEPTION WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN lock_not_available THEN PERFORM execution_v3._fail('live-account-busy');
  WHEN OTHERS THEN PERFORM execution_v3._fail('compact-cache-invalid');
END
$fn$;

ALTER FUNCTION execution_v3.read_raid_review(text,text) OWNER TO execution_v3_owner;
ALTER FUNCTION execution_v3.save_raid_review(text,uuid,bigint,text,text) OWNER TO execution_v3_owner;
REVOKE ALL ON FUNCTION execution_v3.read_raid_review(text,text), execution_v3.save_raid_review(text,uuid,bigint,text,text)
  FROM PUBLIC, anon, authenticated, service_role, execution_v3_executor;
GRANT EXECUTE ON FUNCTION execution_v3.read_raid_review(text,text), execution_v3.save_raid_review(text,uuid,bigint,text,text)
  TO execution_v3_executor;


-- Extend the restricted preflight catalog by exactly the two reviewed cache RPCs.
CREATE OR REPLACE FUNCTION execution_v3.preflight(p_account text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, execution_v3, pg_temp
SET lock_timeout = '250ms' SET statement_timeout = '3s' AS $fn$
DECLARE r pg_roles%ROWTYPE; executor oid; approved CONSTANT text[] := ARRAY['preflight','claim','checkpoint','release','read_history','read_pool','save_pool','put_pin','read_pin','read_raid_review','save_raid_review'];
BEGIN
  -- session_user is the authenticated PG LOGIN, not the SECURITY DEFINER owner.
  SELECT * INTO r FROM pg_roles WHERE rolname = session_user;
  SELECT oid INTO executor FROM pg_roles WHERE rolname = 'execution_v3_executor';
  IF NOT FOUND OR NOT r.rolcanlogin OR NOT r.rolinherit OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
     OR r.rolname ~* '^(postgres|supabase_admin|supabaseadmin|service_role|anon|authenticated)([.@_-]|$)'
     OR NOT pg_has_role(r.oid,executor,'USAGE')
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid AND (roleid <> executor OR admin_option))
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = executor)
     OR has_database_privilege(r.oid,current_database(),'CREATE')
     OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = 'execution_v3'
                AND has_schema_privilege(r.oid,n.oid,'USAGE WITH GRANT OPTION'))
     OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
                AND has_schema_privilege(r.oid,n.oid,'CREATE'))
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','f')
                  -- Supabase's public statistics views are system instrumentation,
                  -- not application data. Names alone never establish membership.
                  AND ((has_table_privilege(r.oid,c.oid,'SELECT') AND NOT
                         (c.relkind = 'v' AND n.nspname = 'extensions'
                          AND c.relname IN ('pg_stat_statements','pg_stat_statements_info')
                          AND EXISTS (SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
                               WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.objsubid = 0
                                 AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e'
                                 AND e.extname = 'pg_stat_statements' AND e.extnamespace = n.oid)))
                       OR has_table_privilege(r.oid,c.oid,'INSERT')
                       OR has_table_privilege(r.oid,c.oid,'UPDATE') OR has_table_privilege(r.oid,c.oid,'DELETE')
                       OR has_table_privilege(r.oid,c.oid,'TRUNCATE') OR has_table_privilege(r.oid,c.oid,'REFERENCES')
                       OR has_table_privilege(r.oid,c.oid,'TRIGGER')))
     OR EXISTS (SELECT 1 FROM pg_proc f WHERE f.pronamespace = 'execution_v3'::regnamespace
                AND has_function_privilege(r.oid,f.oid,'EXECUTE')
                AND (NOT f.proname = ANY(approved) OR NOT f.prosecdef OR f.proowner <> 'execution_v3_owner'::regrole
                     OR has_function_privilege(r.oid,f.oid,'EXECUTE WITH GRANT OPTION')
                     OR NOT coalesce(f.proconfig @> ARRAY['search_path=pg_catalog, execution_v3, pg_temp','lock_timeout=250ms','statement_timeout=3s'],false)))
     OR EXISTS (SELECT 1 FROM unnest(approved) fn WHERE NOT EXISTS
                 (SELECT 1 FROM pg_proc f WHERE f.pronamespace = 'execution_v3'::regnamespace AND f.proname = fn
                    AND has_function_privilege(r.oid,f.oid,'EXECUTE') AND f.prosecdef
                    AND f.proowner = 'execution_v3_owner'::regrole)) THEN
    PERFORM execution_v3._fail('live-role-invalid');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM execution_v3.accounts WHERE account = p_account AND enabled) THEN PERFORM execution_v3._fail('live-account-unavailable'); END IF;
  RETURN true;
END
$fn$;
