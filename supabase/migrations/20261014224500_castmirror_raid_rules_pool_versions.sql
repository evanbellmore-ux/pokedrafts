-- Allow reviewed Execution rule revisions in the private compact cache.
-- Apply this file in one admin transaction. It does not seed, reset, enable,
-- or change account ledgers, linked history, leases, pins, roles, or privileges.
-- Legacy rule versions remain readable; the application keys each rules revision
-- separately. Future schema families require a separate reviewed migration.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE execution_v3.pools DROP CONSTRAINT pools_rules_version_check;
ALTER TABLE execution_v3.pools ADD CONSTRAINT pools_rules_version_check CHECK (
  rules_version IN ('native-live-statistics-2','native-live-statistics-3')
  OR rules_version ~ '^native-live-statistics-4-[a-f0-9]{16}$'
);

CREATE OR REPLACE FUNCTION execution_v3._pool(p_key text, p_payload text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
DECLARE p jsonb; item jsonb; k text; component jsonb;
BEGIN
  IF p_payload IS NULL OR octet_length(convert_to(p_payload,'UTF8')) > 8388608 THEN PERFORM execution_v3._fail('compact-cache-size-cap'); END IF;
  p := p_payload::jsonb;
  IF p_key IS NULL OR p_key !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p->>'key' IS DISTINCT FROM p_key OR p->>'version' IS DISTINCT FROM 'execution-statistical-3'
     OR NOT coalesce(p->>'rulesVersion' IN ('native-live-statistics-2','native-live-statistics-3')
       OR p->>'rulesVersion' ~ '^native-live-statistics-4-[a-f0-9]{16}$',false) OR NOT execution_v3._num(p->'at',false,true)
     OR jsonb_typeof(p->'scope') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'observations') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p->'observations') > 120 OR jsonb_typeof(p->'attempted') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p->'attempted') > 512 OR jsonb_typeof(p->'acquisition') IS DISTINCT FROM 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) x WHERE x NOT IN ('key','version','rulesVersion','at','scope','observations','attempted','acquisition')) THEN
    PERFORM execution_v3._fail('compact-cache-invalid');
  END IF;
  FOREACH k IN ARRAY ARRAY['zone','encounter','difficulty'] LOOP
    IF NOT execution_v3._num(p->'scope'->k,true,true) THEN PERFORM execution_v3._fail('compact-cache-invalid'); END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['size','partition'] LOOP
    IF coalesce(p->'scope'->k,'null'::jsonb) <> 'null'::jsonb AND NOT execution_v3._num(p->'scope'->k,false,true) THEN
      PERFORM execution_v3._fail('compact-cache-invalid');
    END IF;
  END LOOP;
  IF coalesce(p->'scope'->'patch','null'::jsonb) <> 'null'::jsonb AND
     (jsonb_typeof(p->'scope'->'patch') IS DISTINCT FROM 'string' OR length(p->'scope'->>'patch') NOT BETWEEN 1 AND 256) THEN
    PERFORM execution_v3._fail('compact-cache-invalid');
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p->'attempted') LOOP
    IF jsonb_typeof(item) <> 'string' OR length(item #>> '{}') > 150 THEN PERFORM execution_v3._fail('compact-cache-invalid'); END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(p->'observations') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item->>'version' IS DISTINCT FROM 'execution-statistical-3'
       OR jsonb_typeof(item->'identity') IS DISTINCT FROM 'object' OR jsonb_typeof(item->'scope') IS DISTINCT FROM 'object'
       OR jsonb_typeof(item->'components') IS DISTINCT FROM 'object'
       OR jsonb_typeof(item->'support') IS DISTINCT FROM 'object'
       OR (item->'support'->'pi' IS DISTINCT FROM 'null'::jsonb AND jsonb_typeof(item->'support'->'pi') IS DISTINCT FROM 'boolean')
       OR item->'identity'->'verified' IS DISTINCT FROM 'true'::jsonb
       OR item->'identity'->>'code' IS NULL OR item->'identity'->>'code' !~ '^[A-Za-z0-9]{16}$'
       OR NOT execution_v3._num(item->'identity'->'fightID',true,true) OR NOT execution_v3._num(item->'identity'->'actorID',true,true)
       OR coalesce(item->'identity'->>'role','') NOT IN ('dps','tank','healer')
       OR jsonb_typeof(item->'fight') IS DISTINCT FROM 'object' OR jsonb_typeof(item->'fight'->'kill') IS DISTINCT FROM 'boolean'
       OR NOT execution_v3._num(item->'fight'->'startTime') OR NOT execution_v3._num(item->'fight'->'endTime',true)
       OR (item->'fight'->>'endTime')::numeric <= (item->'fight'->>'startTime')::numeric
       OR NOT execution_v3._num(item->'fight'->'durationSec',true)
       OR abs((item->'fight'->>'durationSec')::numeric - ((item->'fight'->>'endTime')::numeric - (item->'fight'->>'startTime')::numeric) / 1000)
          > greatest(0.000000001,abs((item->'fight'->>'durationSec')::numeric) * 0.000000000001)
       OR jsonb_typeof(item->'provenance') IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(item) x WHERE x NOT IN ('version','identity','scope','fight','provenance','support','components')) THEN
      PERFORM execution_v3._fail('compact-cache-invalid');
    END IF;
    FOREACH k IN ARRAY ARRAY['zone','encounter','difficulty'] LOOP
      IF NOT execution_v3._num(item->'scope'->k,true,true) THEN PERFORM execution_v3._fail('compact-cache-invalid'); END IF;
    END LOOP;
    FOREACH k IN ARRAY ARRAY['name','server','region','className','spec'] LOOP
      IF jsonb_typeof(item->'identity'->k) IS DISTINCT FROM 'string' OR length(item->'identity'->>k) NOT BETWEEN 1 AND 128 THEN
        PERFORM execution_v3._fail('compact-cache-invalid');
      END IF;
    END LOOP;
    FOREACH k IN ARRAY ARRAY['avoidance','survival','incoming','defenses','output','healing'] LOOP
      component := item->'components'->k;
      IF jsonb_typeof(component) IS DISTINCT FROM 'object' OR coalesce(component->>'state','') NOT IN ('known','incomplete','unsupported','missing')
         OR (component->'value' IS DISTINCT FROM 'null'::jsonb AND NOT execution_v3._num(component->'value'))
         OR jsonb_typeof(component->'measurements') IS DISTINCT FROM 'object' OR jsonb_typeof(component->'definition') IS DISTINCT FROM 'object'
         OR jsonb_typeof(component->'scoreEligible') IS DISTINCT FROM 'boolean' OR component->'score' IS DISTINCT FROM 'null'::jsonb THEN
        PERFORM execution_v3._fail('compact-cache-invalid');
      END IF;
    END LOOP;
  END LOOP;
  RETURN p;
EXCEPTION WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN PERFORM execution_v3._fail('compact-cache-invalid'); RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION execution_v3.save_pool(p_account text, p_owner uuid, p_fence bigint, p_key text, p_payload text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, execution_v3, pg_temp
SET lock_timeout = '250ms' SET statement_timeout = '3s' AS $fn$
DECLARE a execution_v3.accounts%ROWTYPE; p jsonb; at bigint;
BEGIN
  SELECT * INTO a FROM execution_v3.accounts WHERE account = p_account FOR UPDATE;
  IF NOT FOUND OR NOT a.enabled THEN PERFORM execution_v3._fail('live-account-unavailable'); END IF;
  IF p_owner IS NULL OR p_fence IS NULL OR a.owner IS DISTINCT FROM p_owner OR a.fence <> p_fence
     OR a.lease_until <= execution_v3._now() THEN PERFORM execution_v3._fail('live-lock-lost'); END IF;
  p := execution_v3._pool(p_key,p_payload); at := execution_v3._now();
  IF (p->>'at')::numeric > at + 10000 OR (p->>'at')::numeric <= at - 600000 THEN PERFORM execution_v3._fail('compact-cache-invalid'); END IF;
  DELETE FROM execution_v3.pools WHERE account = p_account AND expires_at <= at;
  IF NOT EXISTS (SELECT 1 FROM execution_v3.pools WHERE account = p_account AND key = p_key)
     AND (SELECT count(*) FROM execution_v3.pools WHERE account = p_account) >= 64 THEN PERFORM execution_v3._fail('compact-cache-full'); END IF;
  IF a.lease_until <= execution_v3._now() THEN PERFORM execution_v3._fail('live-lock-lost'); END IF;
  INSERT INTO execution_v3.pools(account,key,bytes,version,rules_version,created_at,expires_at,writer_owner,writer_fence)
    VALUES (p_account,p_key,convert_to(p_payload,'UTF8'),p->>'version',p->>'rulesVersion',at,at+600000,p_owner,p_fence)
    ON CONFLICT (account,key) DO UPDATE SET bytes = excluded.bytes,version = excluded.version,rules_version = excluded.rules_version,writer_owner = excluded.writer_owner,writer_fence = excluded.writer_fence;
  -- A same-key update never extends its TTL. Expired rows may be replaced as a
  -- new pool only after a new fenced acquisition; a read never changes anything.
EXCEPTION WHEN lock_not_available THEN PERFORM execution_v3._fail('live-account-busy');
END
$fn$;

-- CREATE OR REPLACE retains the isolated owner and existing function ACLs.
-- Same-key cache writes still retain their original creation time and TTL.
