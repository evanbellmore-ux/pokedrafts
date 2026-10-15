-- Allow new private Execution jobs to wait up to 60 seconds for a WCL request.
-- Apply in one admin transaction before deploying the new native default.
-- The two exact policies are the historical 15-second policy and its new
-- 60-second replacement. Every other budget limit and validation is unchanged.
-- _transition still forbids changing the limits of any existing job. This
-- replaces only a private validator; it does not rewrite account/history bytes,
-- reset debt, extend leases/deadlines, or change ownership, roles or privileges.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

CREATE OR REPLACE FUNCTION execution_v3._budget(p_value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, execution_v3, pg_temp AS $fn$
DECLARE
  k text; p jsonb := p_value->'points';
  limits CONSTANT jsonb := '{"graphql":60,"network":75,"review":20,"rankingPages":1,"rankingRows":100,"reportHeads":6,"kills":6,"playersPerKill":20,"observations":120,"eventPages":3,"events":500000,"responseBytes":16777216,"evidenceBytes":268435456,"deadlineMs":120000,"requestTimeoutMs":60000,"maxAttempts":2,"points":150,"allowanceFraction":0.1,"reserveFraction":0.3,"retryPointHeadroom":4}';
  historical_limits CONSTANT jsonb := jsonb_set(limits, '{requestTimeoutMs}', '15000'::jsonb);
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR p_value->>'version' IS DISTINCT FROM 'mythic-maintenance-1'
     OR NOT execution_v3._num(p_value->'startedAt', false, true) OR NOT execution_v3._num(p_value->'deadline', false, true)
     OR NOT execution_v3._num(p_value->'lastObservedAt', false, true)
     OR (p_value->>'deadline')::numeric <> (p_value->>'startedAt')::numeric + 120000
     OR (p_value->>'lastObservedAt')::numeric < (p_value->>'startedAt')::numeric
     OR (p_value->'limits' IS DISTINCT FROM limits AND p_value->'limits' IS DISTINCT FROM historical_limits)
     OR jsonb_typeof(p_value->'counters') IS DISTINCT FROM 'object'
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
