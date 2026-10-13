-- CastMirror Execution v3: PRIVATE direct-Postgres persistence. Never add this
-- schema to PostgREST's exposed schemas. This does not change the public RPCs.
-- No account, login password, or enabled writer is installed by this migration.
-- CUTOVER REQUIRES A DB ADMIN: disable the old filesystem writer, verify/import
-- its FINAL exact LIVE ledger and linked LIVE history, then explicitly enable
-- that account. Never seed the 82 historical jobs or 27 pilot jobs. A fresh or
-- missing account is NOT evidence of an empty quota/debt ledger. Do not deploy
-- this via a service_role JWT/REST client. Capacity/DDL credentials must first
-- be verified externally; this migration alone is not proof of provisioning.
-- Admin-only seed_account deliberately leaves enabled=false. Provision a
-- NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT LOGIN with
-- membership in execution_v3_executor only, no admin option, and no raw grants.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'execution_v3_owner') THEN
    CREATE ROLE execution_v3_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'execution_v3_executor') THEN
    CREATE ROLE execution_v3_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('execution_v3_owner', 'execution_v3_executor')
             AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member IN
               (SELECT oid FROM pg_roles WHERE rolname IN ('execution_v3_owner', 'execution_v3_executor'))) THEN
    RAISE EXCEPTION 'Unsafe existing Execution database role';
  END IF;
END
$roles$;

CREATE SCHEMA IF NOT EXISTS execution_v3 AUTHORIZATION execution_v3_owner;
ALTER SCHEMA execution_v3 OWNER TO execution_v3_owner;
REVOKE ALL ON SCHEMA execution_v3 FROM PUBLIC, anon, authenticated, service_role, execution_v3_executor;
GRANT USAGE ON SCHEMA execution_v3 TO execution_v3_executor;
GRANT USAGE ON SCHEMA extensions TO execution_v3_owner;
GRANT EXECUTE ON FUNCTION extensions.digest(bytea, text) TO execution_v3_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE execution_v3_owner IN SCHEMA execution_v3 REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE execution_v3_owner IN SCHEMA execution_v3 REVOKE ALL ON TABLES FROM PUBLIC;

CREATE TABLE IF NOT EXISTS execution_v3.accounts (
  account text PRIMARY KEY CHECK (account ~ '^[a-f0-9]{64}$'),
  enabled boolean NOT NULL DEFAULT false,
  ledger_bytes bytea NOT NULL CHECK (octet_length(ledger_bytes) BETWEEN 2 AND 1048576),
  ledger_version text NOT NULL CHECK (ledger_version = 'execution-v3-live-account-1'),
  ledger_hash text NOT NULL CHECK (ledger_hash ~ '^[a-f0-9]{64}$'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  owner uuid,
  fence bigint NOT NULL DEFAULT 0 CHECK (fence BETWEEN 0 AND 9007199254740991),
  lease_until bigint,
  CHECK ((owner IS NULL AND lease_until IS NULL) OR
         (owner IS NOT NULL AND lease_until BETWEEN 0 AND 9007199254740991))
);
CREATE TABLE IF NOT EXISTS execution_v3.history (
  account text NOT NULL REFERENCES execution_v3.accounts(account),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 2 AND 2097152),
  version text NOT NULL CHECK (version = 'execution-v3-live-history-1'),
  previous_sha256 text,
  segments bigint NOT NULL CHECK (segments BETWEEN 1 AND 9007199254740991),
  through numeric NOT NULL CHECK (through > 0 AND through <= 9007199254740991),
  job_ids uuid[] NOT NULL,
  PRIMARY KEY (account, sha256),
  FOREIGN KEY (account, previous_sha256) REFERENCES execution_v3.history(account, sha256)
);
CREATE INDEX IF NOT EXISTS execution_v3_history_jobs ON execution_v3.history USING gin (job_ids);
CREATE TABLE IF NOT EXISTS execution_v3.pools (
  account text NOT NULL REFERENCES execution_v3.accounts(account),
  key text NOT NULL CHECK (key ~ '^[a-f0-9]{64}$'),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 2 AND 8388608),
  version text NOT NULL CHECK (version = 'execution-statistical-3'),
  rules_version text NOT NULL CHECK (rules_version = 'native-live-statistics-2'),
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL CHECK (expires_at = created_at + 600000),
  writer_owner uuid NOT NULL,
  writer_fence bigint NOT NULL CHECK (writer_fence BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (account, key)
);
CREATE TABLE IF NOT EXISTS execution_v3.pins (
  account text NOT NULL REFERENCES execution_v3.accounts(account),
  id uuid NOT NULL,
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 2 AND 131072),
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL CHECK (expires_at = created_at + 600000),
  PRIMARY KEY (account, id)
);
ALTER TABLE execution_v3.accounts OWNER TO execution_v3_owner;
ALTER TABLE execution_v3.history OWNER TO execution_v3_owner;
ALTER TABLE execution_v3.pools OWNER TO execution_v3_owner;
ALTER TABLE execution_v3.pins OWNER TO execution_v3_owner;
-- ACLs, not browser policies, form the boundary. RLS is also on, with no API
-- policies: an accidental future SELECT grant still cannot reveal records.
ALTER TABLE execution_v3.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_v3.history ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_v3.pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_v3.pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA execution_v3 FROM PUBLIC, anon, authenticated, service_role, execution_v3_executor;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA execution_v3 FROM PUBLIC, anon, authenticated, service_role, execution_v3_executor;

CREATE OR REPLACE FUNCTION execution_v3._fail(p_code text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Private Execution operation refused', DETAIL = p_code;
END
$fn$;
CREATE OR REPLACE FUNCTION execution_v3._now() RETURNS bigint
LANGUAGE sql VOLATILE SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
  SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
$fn$;
CREATE OR REPLACE FUNCTION execution_v3._num(p_value jsonb, p_positive boolean DEFAULT false, p_integer boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'number' THEN
    CASE WHEN p_positive THEN (p_value::text)::numeric > 0 ELSE (p_value::text)::numeric >= 0 END
    AND (p_value::text)::numeric <= 9007199254740991
    AND (NOT p_integer OR (p_value::text)::numeric = trunc((p_value::text)::numeric))
  ELSE false END;
$fn$;
CREATE OR REPLACE FUNCTION execution_v3._head(p_value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
  SELECT coalesce(p_value = 'null'::jsonb OR
    (jsonb_typeof(p_value) = 'object' AND p_value->>'sha256' ~ '^[a-f0-9]{64}$'
     AND execution_v3._num(p_value->'segments', true, true) AND execution_v3._num(p_value->'through', true)), false);
$fn$;
CREATE OR REPLACE FUNCTION execution_v3._stop(p_value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
  SELECT coalesce(p_value = 'null'::jsonb OR (jsonb_typeof(p_value) = 'string' AND p_value #>> '{}' ~ '^[a-zA-Z][a-zA-Z0-9-]{0,79}$'), false);
$fn$;
CREATE OR REPLACE FUNCTION execution_v3._budget(p_value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
DECLARE
  k text; p jsonb := p_value->'points';
  limits CONSTANT jsonb := '{"graphql":60,"network":75,"review":20,"rankingPages":1,"rankingRows":100,"reportHeads":6,"kills":6,"playersPerKill":20,"observations":120,"eventPages":3,"events":500000,"responseBytes":16777216,"evidenceBytes":268435456,"deadlineMs":120000,"requestTimeoutMs":15000,"maxAttempts":2,"points":150,"allowanceFraction":0.1,"reserveFraction":0.3,"retryPointHeadroom":4}';
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR p_value->>'version' IS DISTINCT FROM 'mythic-maintenance-1'
     OR NOT execution_v3._num(p_value->'startedAt', false, true) OR NOT execution_v3._num(p_value->'deadline', false, true)
     OR NOT execution_v3._num(p_value->'lastObservedAt', false, true)
     OR (p_value->>'deadline')::numeric <> (p_value->>'startedAt')::numeric + 120000
     OR (p_value->>'lastObservedAt')::numeric < (p_value->>'startedAt')::numeric
     OR p_value->'limits' IS DISTINCT FROM limits OR jsonb_typeof(p_value->'counters') IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_value->'counters')) <> 10
     OR NOT execution_v3._num(p_value->'unmeasuredGraphql', false, true)
     OR NOT execution_v3._num(p_value->'pointEstimate', true) OR NOT execution_v3._stop(p_value->'stop')
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) x WHERE x NOT IN
                  ('version','startedAt','deadline','lastObservedAt','limits','counters','unmeasuredGraphql','pointEstimate','points','stop')) THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['graphql','network','review','rankingPages','rankingRows','reportHeads','kills','observations','events','evidenceBytes'] LOOP
    IF NOT execution_v3._num(p_value->'counters'->k, false, true)
       OR (p_value->'counters'->>k)::numeric > (limits->>k)::numeric THEN RETURN false; END IF;
  END LOOP;
  IF (p_value->>'unmeasuredGraphql')::numeric > (p_value->'counters'->>'graphql')::numeric THEN RETURN false; END IF;
  IF p = 'null'::jsonb THEN RETURN true; END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['limit','resetIn','allowance'] LOOP
    IF NOT execution_v3._num(p->k, true) THEN RETURN false; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['spent','jobSpent'] LOOP
    IF NOT execution_v3._num(p->k) THEN RETURN false; END IF;
  END LOOP;
  RETURN execution_v3._num(p->'measuredAt', false, true)
     AND (p->>'spent')::numeric <= (p->>'limit')::numeric
     AND (p->>'measuredAt')::numeric BETWEEN (p_value->>'startedAt')::numeric AND (p_value->>'lastObservedAt')::numeric
     AND (p->>'allowance')::numeric = least(150, floor((p->>'limit')::numeric * 0.1))
     AND (p->>'measuredAt')::numeric + (p->>'resetIn')::numeric * 1000 <= 9007199254740991;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$fn$;

CREATE OR REPLACE FUNCTION execution_v3._ledger(p_text text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
DECLARE
  l jsonb; w jsonb; j jsonb; p jsonb; u jsonb; k text; wk text; found_w jsonb;
  keys text[] := '{}'; ids text[] := '{}'; active integer := 0;
BEGIN
  IF p_text IS NULL OR octet_length(convert_to(p_text, 'UTF8')) > 1048576 THEN PERFORM execution_v3._fail('live-ledger-full'); END IF;
  l := p_text::jsonb;
  IF jsonb_typeof(l) IS DISTINCT FROM 'object' OR l->>'version' IS DISTINCT FROM 'execution-v3-live-account-1'
     OR NOT execution_v3._num(l->'updatedAt', false, true)
     OR jsonb_typeof(l->'jobs') IS DISTINCT FROM 'array' OR jsonb_typeof(l->'windows') IS DISTINCT FROM 'array'
     OR jsonb_array_length(l->'jobs') > 128 OR jsonb_array_length(l->'windows') > 64
     OR NOT execution_v3._head(coalesce(l->'archive', 'null'::jsonb))
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(l) x WHERE x NOT IN ('version','updatedAt','jobs','windows','archive','legacyUnknown')) THEN
    PERFORM execution_v3._fail('live-ledger-invalid');
  END IF;
  FOR w IN SELECT value FROM jsonb_array_elements(l->'windows') LOOP
    IF jsonb_typeof(w) IS DISTINCT FROM 'object' OR NOT execution_v3._num(w->'limit', true)
       OR NOT execution_v3._num(w->'resetAt', true) OR NOT execution_v3._num(w->'pointEstimate', true)
       OR NOT execution_v3._num(coalesce(w->'gapCharged','0'::jsonb))
       OR NOT w ? 'native' OR NOT w ? 'legacy'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(w) x WHERE x NOT IN
                    ('limit','resetAt','pointEstimate','gapCharged','native','legacy','unmeasuredLegacy')) THEN PERFORM execution_v3._fail('live-ledger-invalid'); END IF;
    wk := jsonb_build_array(w->'limit',w->'resetAt')::text;
    IF wk = ANY(keys) THEN PERFORM execution_v3._fail('live-ledger-invalid'); END IF;
    keys := array_append(keys,wk);
    IF (w->>'resetAt')::numeric > (l->>'updatedAt')::numeric THEN active := active + 1; END IF;
    p := w->'native';
    IF p IS DISTINCT FROM 'null'::jsonb AND
       (jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT execution_v3._num(p->'measuredAt', false, true)
        OR NOT execution_v3._num(p->'spent') OR (p->>'spent')::numeric > (w->>'limit')::numeric
        OR (p->>'measuredAt')::numeric > (l->>'updatedAt')::numeric OR (p->>'measuredAt')::numeric >= (w->>'resetAt')::numeric) THEN
      PERFORM execution_v3._fail('live-ledger-invalid');
    END IF;
    FOREACH k IN ARRAY ARRAY['legacy','unmeasuredLegacy'] LOOP
      p := w->k;
      IF p IS NULL OR p = 'null'::jsonb THEN CONTINUE; END IF;
      IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT execution_v3._num(p->'charged') OR NOT execution_v3._num(p->'pending')
         OR NOT execution_v3._num(p->'estimatedRequestCost',true)
         OR (k = 'legacy' AND (NOT execution_v3._num(p->'lastSpent') OR (p->>'lastSpent')::numeric > (w->>'limit')::numeric))
         OR (k = 'unmeasuredLegacy' AND w->'native' = 'null'::jsonb) THEN PERFORM execution_v3._fail('live-ledger-invalid'); END IF;
    END LOOP;
    IF w->'native' = 'null'::jsonb AND w->'legacy' = 'null'::jsonb THEN PERFORM execution_v3._fail('live-ledger-invalid'); END IF;
  END LOOP;
  IF active > 1 THEN PERFORM execution_v3._fail('live-ledger-invalid'); END IF;
  FOR j IN SELECT value FROM jsonb_array_elements(l->'jobs') LOOP
    IF jsonb_typeof(j) IS DISTINCT FROM 'object' OR j->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
       OR j->>'id' IS NULL OR j->>'id' = ANY(ids)
       OR NOT j ?& ARRAY['id','window','charged','pending','terminal','accountingFailure','uncertainUntil','budget']
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(j) x WHERE x NOT IN
                    ('id','window','charged','pending','terminal','accountingFailure','uncertainUntil','budget'))
       OR NOT execution_v3._num(j->'charged') OR NOT execution_v3._num(j->'pending')
       OR jsonb_typeof(j->'terminal') IS DISTINCT FROM 'boolean' OR NOT execution_v3._stop(j->'accountingFailure')
       OR (j->'uncertainUntil' IS DISTINCT FROM 'null'::jsonb AND NOT execution_v3._num(j->'uncertainUntil',true))
       OR (j->'accountingFailure' = 'null'::jsonb AND j->'uncertainUntil' <> 'null'::jsonb)
       OR NOT execution_v3._budget(j->'budget')
       OR (j->'budget'->>'lastObservedAt')::numeric > (l->>'updatedAt')::numeric
       OR (j->>'terminal')::boolean IS DISTINCT FROM (j->'budget'->'stop' <> 'null'::jsonb)
       OR (j->>'pending')::numeric < (j->'budget'->>'unmeasuredGraphql')::numeric * (j->'budget'->>'pointEstimate')::numeric THEN
      PERFORM execution_v3._fail('live-ledger-invalid');
    END IF;
    ids := array_append(ids,j->>'id');
    found_w := NULL;
    IF j->'window' IS DISTINCT FROM 'null'::jsonb THEN
      IF jsonb_typeof(j->'window') IS DISTINCT FROM 'string' OR NOT ((j->>'window')::jsonb::text = ANY(keys)) THEN
        PERFORM execution_v3._fail('live-ledger-invalid');
      END IF;
      SELECT value INTO found_w FROM jsonb_array_elements(l->'windows')
        WHERE jsonb_build_array(value->'limit',value->'resetAt') = (j->>'window')::jsonb;
    END IF;
    p := j->'budget'->'points';
    IF j->'accountingFailure' = 'null'::jsonb THEN
      IF (p = 'null'::jsonb AND (j->>'charged')::numeric <> 0) OR (p <> 'null'::jsonb AND
          (found_w IS NULL OR found_w->'native' = 'null'::jsonb
           OR (j->>'charged')::numeric < (p->>'jobSpent')::numeric
           OR found_w->'limit' <> p->'limit'
           OR abs((found_w->>'resetAt')::numeric - ((p->>'measuredAt')::numeric + (p->>'resetIn')::numeric * 1000)) > 10000
           OR (found_w->'native'->>'spent')::numeric < (p->>'spent')::numeric
           OR (found_w->'native'->>'measuredAt')::numeric < (p->>'measuredAt')::numeric
           OR (found_w->>'pointEstimate')::numeric < (j->'budget'->>'pointEstimate')::numeric)) THEN
        PERFORM execution_v3._fail('live-ledger-invalid');
      END IF;
    END IF;
  END LOOP;
  u := l->'legacyUnknown';
  IF u IS NOT NULL AND u <> 'null'::jsonb THEN
    IF jsonb_typeof(u) IS DISTINCT FROM 'object' OR NOT execution_v3._num(u->'charged') OR NOT execution_v3._num(u->'pending')
       OR (u->>'charged')::numeric < (u->>'pending')::numeric OR NOT execution_v3._num(u->'estimatedRequestCost',true)
       OR NOT execution_v3._head(coalesce(u->'archivedIn','null'::jsonb)) OR NOT u ? 'boundWindow' THEN
      PERFORM execution_v3._fail('live-ledger-invalid');
    END IF;
    IF u->'boundWindow' <> 'null'::jsonb THEN
      IF NOT execution_v3._num(u->'boundWindow'->'limit',true) OR NOT execution_v3._num(u->'boundWindow'->'resetAt',true) THEN
        PERFORM execution_v3._fail('live-ledger-invalid');
      END IF;
      SELECT value INTO found_w FROM jsonb_array_elements(l->'windows') WHERE
        jsonb_build_array(value->'limit',value->'resetAt') = jsonb_build_array(u->'boundWindow'->'limit',u->'boundWindow'->'resetAt');
      IF found_w IS NOT NULL THEN
        p := found_w->'unmeasuredLegacy';
        IF p IS NULL OR p = 'null'::jsonb OR (p->>'charged')::numeric < (u->>'charged')::numeric
           OR (p->>'pending')::numeric < (u->>'pending')::numeric OR (p->>'estimatedRequestCost')::numeric < (u->>'estimatedRequestCost')::numeric THEN
          PERFORM execution_v3._fail('live-ledger-invalid');
        END IF;
      ELSIF coalesce(u->'archivedIn','null'::jsonb) = 'null'::jsonb OR coalesce(l->'archive','null'::jsonb) = 'null'::jsonb THEN
        PERFORM execution_v3._fail('live-ledger-invalid');
      END IF;
    END IF;
  END IF;
  RETURN l;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN PERFORM execution_v3._fail('live-ledger-invalid'); RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION execution_v3._immutable_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
BEGIN PERFORM execution_v3._fail('live-archive-invalid'); RETURN NULL; END
$fn$;
DROP TRIGGER IF EXISTS immutable_history ON execution_v3.history;
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON execution_v3.history FOR EACH ROW EXECUTE FUNCTION execution_v3._immutable_history();

CREATE OR REPLACE FUNCTION execution_v3._insert_history(p_account text, p_entry jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
DECLARE
  v_bytes bytea; h jsonb; prev execution_v3.history%ROWTYPE; w jsonb; j jsonb;
  expiry numeric; v_through numeric := 0; ids uuid[] := '{}'; head jsonb;
BEGIN
  IF jsonb_typeof(p_entry) IS DISTINCT FROM 'object' OR jsonb_typeof(p_entry->'bytes') IS DISTINCT FROM 'string'
     OR p_entry->>'sha256' !~ '^[a-f0-9]{64}$' OR p_entry->>'sha256' IS NULL THEN PERFORM execution_v3._fail('live-archive-invalid'); END IF;
  v_bytes := convert_to(p_entry->>'bytes','UTF8');
  IF octet_length(v_bytes) > 2097152 OR encode(extensions.digest(v_bytes,'sha256'),'hex') <> p_entry->>'sha256' THEN
    PERFORM execution_v3._fail('live-archive-invalid');
  END IF;
  h := (p_entry->>'bytes')::jsonb;
  IF jsonb_typeof(h) IS DISTINCT FROM 'object' OR h->>'version' IS DISTINCT FROM 'execution-v3-live-history-1'
     OR NOT execution_v3._head(h->'previous') OR NOT execution_v3._num(h->'sourceUpdatedAt',false,true)
     OR NOT execution_v3._num(h->'through',true) OR jsonb_typeof(h->'windows') IS DISTINCT FROM 'array'
     OR jsonb_array_length(h->'windows') = 0 OR jsonb_typeof(h->'jobs') IS DISTINCT FROM 'array' THEN
    PERFORM execution_v3._fail('live-archive-invalid');
  END IF;
  IF h->'previous' <> 'null'::jsonb THEN
    SELECT * INTO prev FROM execution_v3.history WHERE account = p_account AND sha256 = h->'previous'->>'sha256';
    IF NOT FOUND OR to_jsonb(prev.segments) <> h->'previous'->'segments' OR to_jsonb(prev.through) <> h->'previous'->'through' THEN
      PERFORM execution_v3._fail('live-archive-invalid');
    END IF;
    v_through := prev.through;
  END IF;
  PERFORM execution_v3._ledger(jsonb_build_object('version','execution-v3-live-account-1','updatedAt',h->'sourceUpdatedAt',
                                                'windows',h->'windows','jobs',h->'jobs')::text);
  FOR w IN SELECT value FROM jsonb_array_elements(h->'windows') LOOP
    IF w->'native' = 'null'::jsonb THEN PERFORM execution_v3._fail('live-archive-invalid'); END IF;
    expiry := (w->>'resetAt')::numeric;
    FOR j IN SELECT value FROM jsonb_array_elements(h->'jobs') WHERE (value->>'window')::jsonb = jsonb_build_array(w->'limit',w->'resetAt') LOOP
      IF NOT (j->>'terminal')::boolean OR (j->'accountingFailure' <> 'null'::jsonb AND j->'uncertainUntil' = 'null'::jsonb) THEN
        PERFORM execution_v3._fail('live-archive-invalid');
      END IF;
      expiry := greatest(expiry, coalesce((j->>'uncertainUntil')::numeric,0),
                         coalesce((j->'budget'->'points'->>'measuredAt')::numeric + (j->'budget'->'points'->>'resetIn')::numeric * 1000,0));
    END LOOP;
    v_through := greatest(v_through,expiry + 10000);
  END LOOP;
  IF v_through <> (h->>'through')::numeric OR v_through > execution_v3._now()
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(h->'jobs') WHERE value->'window' = 'null'::jsonb) THEN
    PERFORM execution_v3._fail('live-archive-invalid');
  END IF;
  SELECT coalesce(array_agg((value->>'id')::uuid),'{}'::uuid[]) INTO ids FROM jsonb_array_elements(h->'jobs');
  IF EXISTS (SELECT 1 FROM execution_v3.history WHERE account = p_account AND sha256 <> p_entry->>'sha256' AND job_ids && ids) THEN
    PERFORM execution_v3._fail('live-archive-invalid');
  END IF;
  head := jsonb_build_object('sha256',p_entry->>'sha256','segments',coalesce(prev.segments,0)+1,'through',v_through);
  INSERT INTO execution_v3.history(account,sha256,bytes,version,previous_sha256,segments,through,job_ids)
    VALUES (p_account,p_entry->>'sha256',v_bytes,'execution-v3-live-history-1',h->'previous'->>'sha256',coalesce(prev.segments,0)+1,v_through,ids)
    ON CONFLICT (account,sha256) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM execution_v3.history WHERE account = p_account AND sha256 = p_entry->>'sha256' AND history.bytes = v_bytes) THEN
    PERFORM execution_v3._fail('live-archive-invalid');
  END IF;
  RETURN head;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN PERFORM execution_v3._fail('live-archive-invalid'); RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION execution_v3._check_archive(p_account text, l jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
DECLARE h jsonb; r execution_v3.history%ROWTYPE; u jsonb := l->'legacyUnknown'; w jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(l->'jobs') j JOIN execution_v3.history h
               ON h.account = p_account AND h.job_ids @> ARRAY[(j.value->>'id')::uuid]) THEN
    PERFORM execution_v3._fail('live-archive-invalid');
  END IF;
  IF coalesce(l->'archive','null'::jsonb) <> 'null'::jsonb THEN
    SELECT * INTO r FROM execution_v3.history WHERE account = p_account AND sha256 = l->'archive'->>'sha256';
    IF NOT FOUND OR to_jsonb(r.segments) <> l->'archive'->'segments' OR to_jsonb(r.through) <> l->'archive'->'through'
       OR r.through > (l->>'updatedAt')::numeric THEN PERFORM execution_v3._fail('live-archive-invalid'); END IF;
  END IF;
  IF u IS NOT NULL AND u <> 'null'::jsonb AND u->'boundWindow' <> 'null'::jsonb AND
     NOT EXISTS (SELECT 1 FROM jsonb_array_elements(l->'windows') WHERE
       jsonb_build_array(value->'limit',value->'resetAt') = jsonb_build_array(u->'boundWindow'->'limit',u->'boundWindow'->'resetAt')) THEN
    SELECT * INTO r FROM execution_v3.history WHERE account = p_account AND sha256 = u->'archivedIn'->>'sha256';
    IF NOT FOUND OR to_jsonb(r.segments) <> u->'archivedIn'->'segments' OR to_jsonb(r.through) <> u->'archivedIn'->'through'
       OR r.segments > (l->'archive'->>'segments')::numeric OR r.through > (l->'archive'->>'through')::numeric THEN
      PERFORM execution_v3._fail('live-archive-invalid');
    END IF;
    h := convert_from(r.bytes,'UTF8')::jsonb;
    SELECT value INTO w FROM jsonb_array_elements(h->'windows') WHERE
      jsonb_build_array(value->'limit',value->'resetAt') = jsonb_build_array(u->'boundWindow'->'limit',u->'boundWindow'->'resetAt');
    IF w IS NULL OR w->'unmeasuredLegacy' IS NULL OR w->'unmeasuredLegacy' = 'null'::jsonb
       OR (w->'unmeasuredLegacy'->>'charged')::numeric < (u->>'charged')::numeric
       OR (w->'unmeasuredLegacy'->>'pending')::numeric < (u->>'pending')::numeric
       OR (w->'unmeasuredLegacy'->>'estimatedRequestCost')::numeric < (u->>'estimatedRequestCost')::numeric THEN
      PERFORM execution_v3._fail('live-archive-invalid');
    END IF;
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION execution_v3._transition(p_account text, p_owner uuid, old_l jsonb, new_l jsonb, archived jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
DECLARE
  old_j jsonb; new_j jsonb; old_b jsonb; new_b jsonb; old_w jsonb; new_w jsonb; k text; name text;
  old_u jsonb := old_l->'legacyUnknown'; new_u jsonb := new_l->'legacyUnknown'; measured boolean; floor_cost numeric;
BEGIN
  IF (new_l->>'updatedAt')::numeric < (old_l->>'updatedAt')::numeric THEN PERFORM execution_v3._fail('live-ledger-invalid'); END IF;
  FOR old_j IN SELECT value FROM jsonb_array_elements(old_l->'jobs') LOOP
    SELECT value INTO new_j FROM jsonb_array_elements(new_l->'jobs') WHERE value->>'id' = old_j->>'id';
    IF new_j IS NULL THEN
      IF archived IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(archived->'jobs') WHERE value = old_j) THEN
        PERFORM execution_v3._fail('live-ledger-invalid');
      END IF;
      CONTINUE;
    END IF;
    -- An expired owner never resumes, resets, or edits an earlier job. Even its
    -- nonterminal uncertain dispatch debt remains exact on writer takeover.
    IF old_j->>'id' <> p_owner::text OR (old_j->>'terminal')::boolean THEN
      IF old_j IS DISTINCT FROM new_j THEN PERFORM execution_v3._fail('live-ledger-invalid'); END IF;
      CONTINUE;
    END IF;
    old_b := old_j->'budget'; new_b := new_j->'budget';
    IF (new_j->>'charged')::numeric < (old_j->>'charged')::numeric
       OR new_b->'startedAt' IS DISTINCT FROM old_b->'startedAt' OR new_b->'deadline' IS DISTINCT FROM old_b->'deadline'
       OR new_b->'limits' IS DISTINCT FROM old_b->'limits'
       OR (new_b->>'lastObservedAt')::numeric < (old_b->>'lastObservedAt')::numeric
       OR (new_b->>'pointEstimate')::numeric < (old_b->>'pointEstimate')::numeric
       OR (old_j->'window' <> 'null'::jsonb AND new_j->'window' IS DISTINCT FROM old_j->'window') THEN
      PERFORM execution_v3._fail('live-ledger-invalid');
    END IF;
    FOR k IN SELECT jsonb_object_keys(old_b->'counters') LOOP
      IF (new_b->'counters'->>k)::numeric < (old_b->'counters'->>k)::numeric THEN PERFORM execution_v3._fail('live-ledger-invalid'); END IF;
    END LOOP;
    IF old_b->'points' <> 'null'::jsonb AND
       (new_b->'points' = 'null'::jsonb OR new_b->'points'->'limit' IS DISTINCT FROM old_b->'points'->'limit'
        OR new_b->'points'->'allowance' IS DISTINCT FROM old_b->'points'->'allowance'
        OR (new_b->'points'->>'spent')::numeric < (old_b->'points'->>'spent')::numeric
        OR (new_b->'points'->>'jobSpent')::numeric < (old_b->'points'->>'jobSpent')::numeric
        OR (new_b->'points'->>'measuredAt')::numeric < (old_b->'points'->>'measuredAt')::numeric) THEN
      PERFORM execution_v3._fail('live-ledger-invalid');
    END IF;
    measured := new_b->'points' <> 'null'::jsonb AND new_j->'accountingFailure' = 'null'::jsonb
                AND (new_b->'points' IS DISTINCT FROM old_b->'points' OR
                     (new_b->>'unmeasuredGraphql')::numeric < (old_b->>'unmeasuredGraphql')::numeric);
    IF ((new_j->>'pending')::numeric < (old_j->>'pending')::numeric OR
        (new_b->>'unmeasuredGraphql')::numeric < (old_b->>'unmeasuredGraphql')::numeric) AND NOT measured THEN
      PERFORM execution_v3._fail('live-ledger-invalid');
    END IF;
    IF old_j->'accountingFailure' <> 'null'::jsonb AND
       (new_j->'accountingFailure' IS DISTINCT FROM old_j->'accountingFailure'
        OR (new_j->>'pending')::numeric < (old_j->>'pending')::numeric
        OR (old_j->'uncertainUntil' = 'null'::jsonb AND new_j->'uncertainUntil' <> 'null'::jsonb)
        OR (old_j->'uncertainUntil' <> 'null'::jsonb AND
            (new_j->'uncertainUntil' = 'null'::jsonb OR (new_j->>'uncertainUntil')::numeric < (old_j->>'uncertainUntil')::numeric))) THEN
      PERFORM execution_v3._fail('live-ledger-invalid');
    END IF;
  END LOOP;
  FOR new_j IN SELECT value FROM jsonb_array_elements(new_l->'jobs') LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_l->'jobs') WHERE value->>'id' = new_j->>'id') THEN
      IF new_j->>'id' <> p_owner::text OR EXISTS
         (SELECT 1 FROM execution_v3.history WHERE account = p_account AND job_ids @> ARRAY[(new_j->>'id')::uuid]) THEN
        PERFORM execution_v3._fail('live-ledger-invalid');
      END IF;
    END IF;
  END LOOP;
  FOR old_w IN SELECT value FROM jsonb_array_elements(old_l->'windows') LOOP
    SELECT value INTO new_w FROM jsonb_array_elements(new_l->'windows') WHERE
      jsonb_build_array(value->'limit',value->'resetAt') = jsonb_build_array(old_w->'limit',old_w->'resetAt');
    IF new_w IS NULL THEN
      IF archived IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(archived->'windows') WHERE value = old_w) THEN
        PERFORM execution_v3._fail('live-ledger-invalid');
      END IF;
      CONTINUE;
    END IF;
    IF coalesce((new_w->>'gapCharged')::numeric,0) < coalesce((old_w->>'gapCharged')::numeric,0)
       OR (old_w->'native' <> 'null'::jsonb AND
           (new_w->'native' = 'null'::jsonb OR (new_w->'native'->>'spent')::numeric < (old_w->'native'->>'spent')::numeric
            OR (new_w->'native'->>'measuredAt')::numeric < (old_w->'native'->>'measuredAt')::numeric)) THEN
      PERFORM execution_v3._fail('live-ledger-invalid');
    END IF;
    FOREACH name IN ARRAY ARRAY['legacy','unmeasuredLegacy'] LOOP
      IF old_w->name IS NULL OR old_w->name = 'null'::jsonb THEN CONTINUE; END IF;
      IF new_w->name IS NULL OR new_w->name = 'null'::jsonb THEN PERFORM execution_v3._fail('live-ledger-invalid'); END IF;
      FOR k IN SELECT jsonb_object_keys(old_w->name) LOOP
        IF execution_v3._num(old_w->name->k) AND
           (NOT execution_v3._num(new_w->name->k) OR (new_w->name->>k)::numeric < (old_w->name->>k)::numeric) THEN
          PERFORM execution_v3._fail('live-ledger-invalid');
        END IF;
      END LOOP;
    END LOOP;
    IF (new_w->>'pointEstimate')::numeric < (old_w->>'pointEstimate')::numeric THEN
      -- The native reducer has one explicit provenance-backed correction for an
      -- inflated cross-job estimate, never a debt/charged refund.
      IF old_w->'native' = 'null'::jsonb OR (old_w->>'resetAt')::numeric <= (new_l->>'updatedAt')::numeric
         OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_l->'jobs') WHERE
                         (value->>'window')::jsonb = jsonb_build_array(old_w->'limit',old_w->'resetAt'))
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(old_l->'jobs') WHERE
              (value->'window' = 'null'::jsonb AND (value->'budget'->'counters'->>'network')::numeric > 0)
              OR ((value->>'window')::jsonb = jsonb_build_array(old_w->'limit',old_w->'resetAt') AND
                  (NOT (value->>'terminal')::boolean OR value->'accountingFailure' <> 'null'::jsonb
                   OR ((value->>'pending')::numeric > 0 AND (value->'budget'->>'unmeasuredGraphql')::numeric = 0)))) THEN
        PERFORM execution_v3._fail('live-ledger-invalid');
      END IF;
      SELECT greatest(4,coalesce((old_w->'legacy'->>'estimatedRequestCost')::numeric,0),
                         coalesce((old_w->'unmeasuredLegacy'->>'estimatedRequestCost')::numeric,0),
                         max(greatest((value->'budget'->>'pointEstimate')::numeric,
                             CASE WHEN (value->'budget'->>'unmeasuredGraphql')::numeric > 0
                             THEN (value->>'pending')::numeric / (value->'budget'->>'unmeasuredGraphql')::numeric ELSE 0 END)))
        INTO floor_cost FROM jsonb_array_elements(old_l->'jobs') WHERE
          (value->>'window')::jsonb = jsonb_build_array(old_w->'limit',old_w->'resetAt');
      IF (new_w->>'pointEstimate')::numeric < floor_cost THEN PERFORM execution_v3._fail('live-ledger-invalid'); END IF;
    END IF;
  END LOOP;
  IF old_u IS NOT NULL AND old_u <> 'null'::jsonb THEN
    IF new_u IS NULL OR new_u = 'null'::jsonb THEN PERFORM execution_v3._fail('live-ledger-invalid'); END IF;
    FOREACH k IN ARRAY ARRAY['charged','pending','estimatedRequestCost'] LOOP
      IF (new_u->>k)::numeric < (old_u->>k)::numeric THEN PERFORM execution_v3._fail('live-ledger-invalid'); END IF;
    END LOOP;
    IF old_u->'boundWindow' <> 'null'::jsonb AND new_u->'boundWindow' IS DISTINCT FROM old_u->'boundWindow' THEN
      PERFORM execution_v3._fail('live-ledger-invalid');
    END IF;
  END IF;
END
$fn$;

-- Explicit, admin-only cutover import. Does not enable the account or accept a
-- runtime "fresh ledger" fallback. The caller supplies the exact FINAL live
-- bytes and oldest-first immutable live segments, after disabling old writers.
CREATE OR REPLACE FUNCTION execution_v3.seed_account(p_account text, p_ledger text, p_history jsonb DEFAULT '[]'::jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, execution_v3, pg_temp
SET lock_timeout = '250ms' SET statement_timeout = '3s' AS $fn$
DECLARE l jsonb; entry jsonb; head jsonb := 'null'::jsonb;
BEGIN
  IF p_account IS NULL OR p_account !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_history) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_history) > 128 THEN PERFORM execution_v3._fail('live-ledger-invalid'); END IF;
  l := execution_v3._ledger(p_ledger);
  INSERT INTO execution_v3.accounts(account,ledger_bytes,ledger_version,ledger_hash)
    VALUES (p_account,convert_to(p_ledger,'UTF8'),'execution-v3-live-account-1',encode(extensions.digest(convert_to(p_ledger,'UTF8'),'sha256'),'hex'));
  FOR entry IN SELECT value FROM jsonb_array_elements(p_history) LOOP
    IF ((entry->>'bytes')::jsonb)->'previous' IS DISTINCT FROM head THEN PERFORM execution_v3._fail('live-archive-invalid'); END IF;
    head := execution_v3._insert_history(p_account,entry);
  END LOOP;
  IF coalesce(l->'archive','null'::jsonb) IS DISTINCT FROM head THEN PERFORM execution_v3._fail('live-archive-invalid'); END IF;
  PERFORM execution_v3._check_archive(p_account,l);
EXCEPTION WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN PERFORM execution_v3._fail('live-ledger-invalid');
END
$fn$;

CREATE OR REPLACE FUNCTION execution_v3.claim(p_account text, p_owner uuid, p_lease_ms integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, execution_v3, pg_temp
SET lock_timeout = '250ms' SET statement_timeout = '3s' AS $fn$
DECLARE a execution_v3.accounts%ROWTYPE; at bigint; l jsonb;
BEGIN
  IF p_account IS NULL OR p_account !~ '^[a-f0-9]{64}$' OR p_owner IS NULL OR p_lease_ms IS NULL OR p_lease_ms NOT BETWEEN 1 AND 150000 THEN
    PERFORM execution_v3._fail('live-lock-lost');
  END IF;
  SELECT * INTO a FROM execution_v3.accounts WHERE account = p_account FOR UPDATE;
  IF NOT FOUND OR NOT a.enabled THEN PERFORM execution_v3._fail('live-account-unavailable'); END IF;
  at := execution_v3._now();
  IF a.owner IS NOT NULL AND a.lease_until > at THEN PERFORM execution_v3._fail('live-account-busy'); END IF;
  l := execution_v3._ledger(convert_from(a.ledger_bytes,'UTF8'));
  PERFORM execution_v3._check_archive(p_account,l);
  IF a.fence >= 9007199254740991 OR a.owner = p_owner
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(l->'jobs') WHERE value->>'id' = p_owner::text)
     OR EXISTS (SELECT 1 FROM execution_v3.history WHERE account = p_account AND job_ids @> ARRAY[p_owner])
     OR encode(extensions.digest(a.ledger_bytes,'sha256'),'hex') <> a.ledger_hash THEN
    PERFORM execution_v3._fail('live-lock-lost');
  END IF;
  at := execution_v3._now();
  UPDATE execution_v3.accounts SET owner = p_owner, fence = a.fence + 1, lease_until = at + p_lease_ms WHERE account = p_account;
  RETURN jsonb_build_object('ledger',convert_from(a.ledger_bytes,'UTF8'),'revision',a.revision,'fence',a.fence+1,'leaseUntil',at+p_lease_ms);
EXCEPTION WHEN lock_not_available THEN PERFORM execution_v3._fail('live-account-busy'); RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION execution_v3.checkpoint(p_account text, p_owner uuid, p_fence bigint, p_revision bigint, p_ledger text, p_history jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, execution_v3, pg_temp
SET lock_timeout = '250ms' SET statement_timeout = '3s' AS $fn$
DECLARE a execution_v3.accounts%ROWTYPE; old_l jsonb; new_l jsonb; archived jsonb; head jsonb; entry jsonb;
BEGIN
  SELECT * INTO a FROM execution_v3.accounts WHERE account = p_account FOR UPDATE;
  IF NOT FOUND OR NOT a.enabled THEN PERFORM execution_v3._fail('live-account-unavailable'); END IF;
  IF p_owner IS NULL OR p_fence IS NULL OR a.owner IS DISTINCT FROM p_owner OR a.fence <> p_fence
     OR a.lease_until <= execution_v3._now() THEN PERFORM execution_v3._fail('live-lock-lost'); END IF;
  IF p_revision IS NULL OR a.revision <> p_revision OR a.revision >= 9007199254740991 THEN PERFORM execution_v3._fail('live-ledger-changed'); END IF;
  IF jsonb_typeof(p_history) IS DISTINCT FROM 'array' OR jsonb_array_length(p_history) > 1 THEN PERFORM execution_v3._fail('live-archive-invalid'); END IF;
  old_l := execution_v3._ledger(convert_from(a.ledger_bytes,'UTF8')); new_l := execution_v3._ledger(p_ledger);
  IF jsonb_array_length(p_history) = 1 THEN
    entry := p_history->0; archived := (entry->>'bytes')::jsonb;
    IF archived->'previous' IS DISTINCT FROM coalesce(old_l->'archive','null'::jsonb)
       OR archived->'sourceUpdatedAt' IS DISTINCT FROM old_l->'updatedAt'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(archived->'windows') x WHERE
                  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_l->'windows') y WHERE x.value = y.value))
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(archived->'jobs') x WHERE
                  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_l->'jobs') y WHERE x.value = y.value))
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(old_l->'jobs') x WHERE
            EXISTS (SELECT 1 FROM jsonb_array_elements(archived->'windows') w WHERE
                     (x.value->>'window')::jsonb = jsonb_build_array(w.value->'limit',w.value->'resetAt'))
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(archived->'jobs') y WHERE x.value = y.value)) THEN
      PERFORM execution_v3._fail('live-archive-invalid');
    END IF;
    head := execution_v3._insert_history(p_account,entry);
    IF new_l->'archive' IS DISTINCT FROM head
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(new_l->'windows') x JOIN jsonb_array_elements(archived->'windows') y
                    ON jsonb_build_array(x.value->'limit',x.value->'resetAt') = jsonb_build_array(y.value->'limit',y.value->'resetAt'))
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(new_l->'jobs') x JOIN jsonb_array_elements(archived->'jobs') y
                    ON x.value->>'id' = y.value->>'id') THEN PERFORM execution_v3._fail('live-archive-invalid'); END IF;
  ELSIF coalesce(new_l->'archive','null'::jsonb) IS DISTINCT FROM coalesce(old_l->'archive','null'::jsonb) THEN
    PERFORM execution_v3._fail('live-archive-invalid');
  END IF;
  PERFORM execution_v3._transition(p_account,p_owner,old_l,new_l,archived);
  PERFORM execution_v3._check_archive(p_account,new_l);
  IF a.lease_until <= execution_v3._now() THEN PERFORM execution_v3._fail('live-lock-lost'); END IF;
  UPDATE execution_v3.accounts SET ledger_bytes = convert_to(p_ledger,'UTF8'),
    ledger_hash = encode(extensions.digest(convert_to(p_ledger,'UTF8'),'sha256'),'hex'),revision = a.revision+1 WHERE account = p_account;
  RETURN jsonb_build_object('revision',a.revision+1);
EXCEPTION WHEN lock_not_available THEN PERFORM execution_v3._fail('live-account-busy'); RETURN NULL;
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN PERFORM execution_v3._fail('live-ledger-invalid'); RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION execution_v3.release(p_account text, p_owner uuid, p_fence bigint, p_revision bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, execution_v3, pg_temp
SET lock_timeout = '250ms' SET statement_timeout = '3s' AS $fn$
DECLARE a execution_v3.accounts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM execution_v3.accounts WHERE account = p_account FOR UPDATE;
  IF NOT FOUND OR NOT a.enabled THEN PERFORM execution_v3._fail('live-account-unavailable'); END IF;
  IF p_owner IS NULL OR p_fence IS NULL OR a.owner IS DISTINCT FROM p_owner OR a.fence <> p_fence
     OR a.lease_until <= execution_v3._now() THEN PERFORM execution_v3._fail('live-lock-lost'); END IF;
  IF p_revision IS NULL OR a.revision <> p_revision THEN PERFORM execution_v3._fail('live-ledger-changed'); END IF;
  -- Retain the last owner UUID to prohibit same-owner replay; never edit debt,
  -- revision, or fence, and never release someone else's or an expired lease.
  UPDATE execution_v3.accounts SET lease_until = 0 WHERE account = p_account;
EXCEPTION WHEN lock_not_available THEN PERFORM execution_v3._fail('live-account-busy');
END
$fn$;

CREATE OR REPLACE FUNCTION execution_v3.read_history(p_account text, p_sha256 text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, execution_v3, pg_temp
SET lock_timeout = '250ms' SET statement_timeout = '3s' AS $fn$
DECLARE bytes bytea;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM execution_v3.accounts WHERE account = p_account AND enabled) THEN PERFORM execution_v3._fail('live-account-unavailable'); END IF;
  SELECT h.bytes INTO bytes FROM execution_v3.history h WHERE account = p_account AND sha256 = p_sha256;
  RETURN convert_from(bytes,'UTF8');
END
$fn$;

CREATE OR REPLACE FUNCTION execution_v3._pool(p_key text, p_payload text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
DECLARE p jsonb; item jsonb; k text; component jsonb;
BEGIN
  IF p_payload IS NULL OR octet_length(convert_to(p_payload,'UTF8')) > 8388608 THEN PERFORM execution_v3._fail('compact-cache-size-cap'); END IF;
  p := p_payload::jsonb;
  IF p_key IS NULL OR p_key !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p->>'key' IS DISTINCT FROM p_key OR p->>'version' IS DISTINCT FROM 'execution-statistical-3'
     OR p->>'rulesVersion' IS DISTINCT FROM 'native-live-statistics-2' OR NOT execution_v3._num(p->'at',false,true)
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
CREATE OR REPLACE FUNCTION execution_v3.read_pool(p_account text, p_key text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, execution_v3, pg_temp
SET lock_timeout = '250ms' SET statement_timeout = '3s' AS $fn$
DECLARE bytes bytea;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM execution_v3.accounts WHERE account = p_account AND enabled) THEN PERFORM execution_v3._fail('live-account-unavailable'); END IF;
  SELECT p.bytes INTO bytes FROM execution_v3.pools p WHERE account = p_account AND key = p_key AND expires_at > execution_v3._now();
  RETURN convert_from(bytes,'UTF8');
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
    VALUES (p_account,p_key,convert_to(p_payload,'UTF8'),'execution-statistical-3','native-live-statistics-2',at,at+600000,p_owner,p_fence)
    ON CONFLICT (account,key) DO UPDATE SET bytes = excluded.bytes,writer_owner = excluded.writer_owner,writer_fence = excluded.writer_fence;
  -- A same-key update never extends its TTL. Expired rows may be replaced as a
  -- new pool only after a new fenced acquisition; a read never changes anything.
EXCEPTION WHEN lock_not_available THEN PERFORM execution_v3._fail('live-account-busy');
END
$fn$;

CREATE OR REPLACE FUNCTION execution_v3._pin(p_payload text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
DECLARE p jsonb; b jsonb; side jsonb; k text;
BEGIN
  IF p_payload IS NULL OR octet_length(convert_to(p_payload,'UTF8')) > 131072 THEN PERFORM execution_v3._fail('execution-pin-invalid'); END IF;
  p := p_payload::jsonb; b := p->'base';
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(b) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p->'params') IS DISTINCT FROM 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) x WHERE x NOT IN ('base','params'))
     OR NOT execution_v3._num(b->'encounter'->'id',true,true) OR (b->>'difficulty') NOT IN ('3','4','5')
     OR jsonb_typeof(b->'className') IS DISTINCT FROM 'string' OR length(b->>'className') NOT BETWEEN 1 AND 64
     OR jsonb_typeof(b->'spec') IS DISTINCT FROM 'string' OR length(b->>'spec') NOT BETWEEN 1 AND 64
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(b) x WHERE x NOT IN
                 ('encounter','difficulty','metric','className','spec','a','b','pi','hero','executionRankingContext','executionRankingScope')) THEN
    PERFORM execution_v3._fail('execution-pin-invalid');
  END IF;
  FOREACH k IN ARRAY ARRAY['a','b'] LOOP
    side := b->k;
    IF jsonb_typeof(side) IS DISTINCT FROM 'object' OR side->>'code' IS NULL OR side->>'code' !~ '^[A-Za-z0-9]{16}$'
       OR NOT execution_v3._num(side->'fightID',true,true) OR NOT execution_v3._num(side->'actorID',true,true)
       OR jsonb_typeof(side->'name') IS DISTINCT FROM 'string' OR length(side->>'name') NOT BETWEEN 1 AND 128
       OR jsonb_typeof(side->'server') IS DISTINCT FROM 'string' OR length(side->>'server') NOT BETWEEN 1 AND 128
       OR jsonb_typeof(side->'scope') IS DISTINCT FROM 'object' OR side ? 'events' OR side ? 'casts' OR side ? 'raw' THEN
      PERFORM execution_v3._fail('execution-pin-invalid');
    END IF;
  END LOOP;
EXCEPTION WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN PERFORM execution_v3._fail('execution-pin-invalid');
END
$fn$;
CREATE OR REPLACE FUNCTION execution_v3.put_pin(p_account text, p_payload text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, execution_v3, pg_temp
SET lock_timeout = '250ms' SET statement_timeout = '3s' AS $fn$
DECLARE at bigint; id uuid; a execution_v3.accounts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM execution_v3.accounts WHERE account = p_account FOR UPDATE;
  IF NOT FOUND OR NOT a.enabled THEN PERFORM execution_v3._fail('live-account-unavailable'); END IF;
  PERFORM execution_v3._pin(p_payload); at := execution_v3._now();
  DELETE FROM execution_v3.pins WHERE account = p_account AND expires_at <= at;
  IF (SELECT count(*) FROM execution_v3.pins WHERE account = p_account) >= 128 THEN PERFORM execution_v3._fail('execution-pin-full'); END IF;
  id := gen_random_uuid();
  INSERT INTO execution_v3.pins(account,id,bytes,created_at,expires_at) VALUES (p_account,id,convert_to(p_payload,'UTF8'),at,at+600000);
  RETURN id;
EXCEPTION WHEN lock_not_available THEN PERFORM execution_v3._fail('live-account-busy'); RETURN NULL;
END
$fn$;
CREATE OR REPLACE FUNCTION execution_v3.read_pin(p_account text, p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, execution_v3, pg_temp
SET lock_timeout = '250ms' SET statement_timeout = '3s' AS $fn$
DECLARE bytes bytea;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM execution_v3.accounts WHERE account = p_account AND enabled) THEN PERFORM execution_v3._fail('live-account-unavailable'); END IF;
  SELECT p.bytes INTO bytes FROM execution_v3.pins p WHERE account = p_account AND id = p_id AND expires_at > execution_v3._now();
  RETURN convert_from(bytes,'UTF8');
END
$fn$;

CREATE OR REPLACE FUNCTION execution_v3.preflight(p_account text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, execution_v3, pg_temp
SET lock_timeout = '250ms' SET statement_timeout = '3s' AS $fn$
DECLARE r pg_roles%ROWTYPE; executor oid; approved CONSTANT text[] := ARRAY['preflight','claim','checkpoint','release','read_history','read_pool','save_pool','put_pin','read_pin'];
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

-- Deliberately no public-client "Grants" catalog section: this is not a browser
-- API. Every private function is owned by the isolated migration object owner.
DO $owners$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p WHERE p.pronamespace = 'execution_v3'::regnamespace LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO execution_v3_owner',f.signature);
  END LOOP;
END
$owners$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA execution_v3 FROM PUBLIC, anon, authenticated, service_role, execution_v3_executor;
GRANT EXECUTE ON FUNCTION execution_v3.preflight(text), execution_v3.claim(text,uuid,integer),
  execution_v3.checkpoint(text,uuid,bigint,bigint,text,jsonb), execution_v3.release(text,uuid,bigint,bigint),
  execution_v3.read_history(text,text), execution_v3.read_pool(text,text), execution_v3.save_pool(text,uuid,bigint,text,text),
  execution_v3.put_pin(text,text), execution_v3.read_pin(text,uuid) TO execution_v3_executor;
-- The applying DB admin may explicitly seed only; it must still perform the
-- external cutover verification and enablement, never an application RPC.
DO $admin$
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION execution_v3.seed_account(text,text,jsonb) TO %I',current_user);
  EXECUTE format('GRANT USAGE ON SCHEMA execution_v3 TO %I',current_user);
END
$admin$;
