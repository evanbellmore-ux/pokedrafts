import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { PostgresExecutionStore } from '../../app/api/castmirror/execution/postgres-store';
import { LIVE_RULES_VERSION } from '../../vendor/castmirror/native/execution/live.mjs';
import { createDurableLiveBudget, stageLiveJob } from '../../vendor/castmirror/native/execution/live-budget.mjs';
import { maintenanceClient } from '../../vendor/castmirror/native/execution/maintenance.mjs';
import { WclClient } from '../../vendor/castmirror/native/wcl-client/wcl.mjs';
import { connect, expectRpcError, expectSqlState, type Client } from './harness';
import { EXECUTION_MIGRATION, EXECUTION_TIMEOUT_MIGRATION, readMigrations } from './migrations-lib';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const VERSION = 'execution-v3-live-account-1';
const LIMITS = { graphql: 60, network: 75, review: 20, rankingPages: 1, rankingRows: 100, reportHeads: 6,
  kills: 6, playersPerKill: 20, observations: 120, eventPages: 3, events: 500000, responseBytes: 16777216,
  evidenceBytes: 268435456, deadlineMs: 120000, requestTimeoutMs: 15000, maxAttempts: 2,
  points: 150, allowanceFraction: 0.1, reserveFraction: 0.3, retryPointHeadroom: 4 };
function budget(at: number) {
  return { version: 'mythic-maintenance-1', startedAt: at, deadline: at + 120000, lastObservedAt: at,
    limits: LIMITS, counters: { graphql: 0, network: 0, review: 0, rankingPages: 0, rankingRows: 0,
      reportHeads: 0, kills: 0, observations: 0, events: 0, evidenceBytes: 0 }, unmeasuredGraphql: 0,
    pointEstimate: 4, points: null as null | { limit: number; spent: number; resetIn: number; measuredAt: number; allowance: number; jobSpent: number },
    stop: null as string | null };
}
function job(id: string, at: number, terminal = false) {
  const b = budget(at);
  b.counters.network = 1; b.counters.graphql = 1; b.unmeasuredGraphql = 1;
  b.stop = terminal ? 'closed' : null;
  return { id, window: null as string | null, charged: 0, pending: 4, terminal, accountingFailure: null, uncertainUntil: null, budget: b };
}
function ledger(at = Date.now()) { return { version: VERSION, updatedAt: at, jobs: [] as ReturnType<typeof job>[], windows: [] as Record<string, unknown>[] }; }
function pool(key = sha(randomUUID())) {
  return { version: 'execution-statistical-3', rulesVersion: 'native-live-statistics-2', key, at: Date.now(),
    scope: { zone: 42, encounter: 200, difficulty: 5, size: 20, partition: 1, patch: '12.0' },
    observations: [], attempted: [], acquisition: {} };
}
function pin() {
  const scope = { zone: 42, encounter: 200, difficulty: 5, size: 20 };
  const side = { code: 'ABCDEFGHIJKLMNOP', fightID: 2, actorID: 4, name: 'Pokémon♀', server: 'Test', scope,
    amount: 100, rankPercent: null, durSec: 200, kill: true };
  return { base: { encounter: { id: 200, name: 'Test' }, difficulty: 5, metric: 'dps', className: 'Priest', spec: 'Shadow', a: side,
    b: { ...side, actorID: 5 }, pi: { a: false, b: false, excluded: false }, hero: { a: null, b: null, alt: null, requested: null } },
    params: { name: side.name, server: side.server, region: 'US', encounter: 200, difficulty: 5, metric: 'dps', code: side.code, fightID: 2 } };
}
async function call<T = unknown>(db: Client, name: string, values: unknown[] = []): Promise<T> {
  const { rows } = await db.query(`select execution_v3.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) as result`, values);
  return rows[0].result as T;
}
type Claim = { ledger: string; revision: number; fence: number; leaseUntil: number };
const stageNativeJob = stageLiveJob as unknown as (value: ReturnType<typeof ledger>, options: {
  state: ReturnType<typeof budget>; jobID: string; accountingFailure?: string | null;
}) => { ledger: ReturnType<typeof stageLiveJob>['ledger']; accountingFailure: string | null };
// Native JS defaults underdescribe the required durable-store options.
const createStoredBudget = createDurableLiveBudget as unknown as (options: {
  store: PostgresExecutionStore; account: string; now: () => number;
}) => ReturnType<typeof createDurableLiveBudget>;

// Every mutation is local to the embedded cluster. No production URL/env is read.
describe('private CastMirror Execution PostgreSQL authority', () => {
  let admin: Client, runtime: Client, other: Client;
  const login = `execution_test_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    admin = await connect();
    await admin.query(`create role ${login} login inherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication password 'embedded-test-only'`);
    await admin.query(`grant execution_v3_executor to ${login}`);
    const config = { host: '127.0.0.1', port: inject('dbPort'), database: inject('dbName'), user: login, password: 'embedded-test-only',
      connectionTimeoutMillis: 3000, statement_timeout: 3000, query_timeout: 5000 };
    runtime = new pg.Client(config); other = new pg.Client(config);
    await runtime.connect(); await other.connect();
  });
  afterAll(async () => { await runtime?.end(); await other?.end(); await admin?.query(`drop role if exists ${login}`); await admin?.end(); });
  async function seed(value: unknown = ledger(), enabled = true, history: unknown[] = []) {
    const account = sha(randomUUID()); const text = typeof value === 'string' ? value : JSON.stringify(value) + '\n';
    await call(admin, 'seed_account', [account, text, JSON.stringify(history)]);
    if (enabled) await admin.query('update execution_v3.accounts set enabled=true where account=$1', [account]);
    return { account, text };
  }
  async function claim(account: string, owner: string = randomUUID(), lease = 150000, db = runtime) {
    return { owner, ...(await call<Claim>(db, 'claim', [account, owner, lease])) };
  }
  async function checkpoint(account: string, c: Claim & { owner: string }, value: unknown, history: unknown[] = [], db = runtime) {
    return call<{ revision: number }>(db, 'checkpoint', [account, c.owner, c.fence, c.revision, typeof value === 'string' ? value : JSON.stringify(value) + '\n', JSON.stringify(history)]);
  }

  it('keeps a private eleven-function executor catalog and public 37 functions untouched', async () => {
    const { rows } = await admin.query<{ name: string; definer: boolean; owner: string; config: string[] }>(`
      select p.proname name,p.prosecdef definer,r.rolname owner,p.proconfig config from pg_proc p
      join pg_roles r on r.oid=p.proowner where p.pronamespace='execution_v3'::regnamespace
      and has_function_privilege('execution_v3_executor',p.oid,'EXECUTE') order by 1`);
    expect(rows.map(r => r.name)).toEqual(['checkpoint','claim','preflight','put_pin','read_history','read_pin','read_pool','read_raid_review','release','save_pool','save_raid_review']);
    for (const row of rows) {
      expect(row.definer).toBe(true); expect(row.owner).toBe('execution_v3_owner');
      expect(row.config).toContain('search_path=pg_catalog, execution_v3, pg_temp');
      expect(row.config).toContain('lock_timeout=250ms');
    }
    const count = await admin.query(`select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and proname not like '\\_%'
      and (has_function_privilege('anon',oid,'EXECUTE') or has_function_privilege('authenticated',oid,'EXECUTE'))`);
    expect(count.rows[0].n).toBe(37);
    const owners = await admin.query(`select rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication from pg_roles
      where rolname in ('execution_v3_executor','execution_v3_owner')`);
    expect(owners.rows).toHaveLength(2);
    expect(owners.rows.every(row => Object.values(row).every(v => v === false))).toBe(true);
  });

  it('denies anon/authenticated/service_role every private RPC/table, plus executor raw writes/DDL/seed/enable/grants', async () => {
    const { account } = await seed();
    for (const role of ['anon','authenticated','service_role']) {
      const db = await connect();
      try {
        await db.query(`set role ${role}`);
        await expectSqlState(call(db,'claim',[account,randomUUID(),100]),'42501');
        await expectSqlState(db.query('select * from execution_v3.accounts'),'42501');
        const grants = await admin.query(`select has_schema_privilege($1,'execution_v3','USAGE') schema,
          exists(select 1 from pg_proc where pronamespace='execution_v3'::regnamespace and has_function_privilege($1,oid,'EXECUTE')) fn`,[role]);
        expect(grants.rows[0]).toEqual({ schema: false, fn: false });
      } finally { await db.end(); }
    }
    await expectSqlState(runtime.query('select * from execution_v3.accounts'),'42501');
    await expectSqlState(runtime.query('update execution_v3.accounts set enabled=true'),'42501');
    await expectSqlState(runtime.query("insert into execution_v3.pins(account,id,bytes,created_at,expires_at) values($1,$2,'{}',0,600000)",[account,randomUUID()]),'42501');
    await expectSqlState(runtime.query('delete from execution_v3.history'),'42501');
    await expectSqlState(call(runtime,'seed_account',[sha(randomUUID()),JSON.stringify(ledger()),'[]']),'42501');
    await expectSqlState(runtime.query('create table execution_v3.forbidden(id int)'),'42501');
    await expectSqlState(runtime.query('create table public.execution_forbidden(id int)'),'42501');
    await expectSqlState(runtime.query('grant execution_v3_executor to anon'),'42501');
    await runtime.query('grant execute on function execution_v3.claim(text,uuid,integer) to anon');
    const grant = await admin.query("select has_function_privilege('anon','execution_v3.claim(text,uuid,integer)','execute') ok");
    expect(grant.rows[0].ok).toBe(false);
  });

  it('checks the actual restricted PG login, not a plausible URL or SET ROLE superuser', async () => {
    const { account } = await seed();
    expect(await call(runtime,'preflight',[account])).toBe(true);
    await expectRpcError(call(admin,'preflight',[account]),'live-role-invalid');
    await admin.query(`grant select on execution_v3.accounts to ${login}`);
    try { await expectRpcError(call(runtime,'preflight',[account]),'live-role-invalid'); }
    finally { await admin.query(`revoke select on execution_v3.accounts from ${login}`); }
  });

  it('accepts the genuine Supabase public statistics views without changing their grants', async () => {
    await admin.query('create extension if not exists pg_stat_statements with schema extensions');
    const stats = await admin.query(`select c.relname,has_table_privilege($1,c.oid,'SELECT') readable
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='extensions' and c.relname in ('pg_stat_statements','pg_stat_statements_info') order by 1`,[login]);
    expect(stats.rows).toEqual([{ relname: 'pg_stat_statements', readable: true }, { relname: 'pg_stat_statements_info', readable: true }]);
    const { account } = await seed();
    expect(await call(runtime,'preflight',[account])).toBe(true);
    const after = await admin.query(`select c.relname,has_table_privilege($1,c.oid,'SELECT') readable
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='extensions' and c.relname in ('pg_stat_statements','pg_stat_statements_info') order by 1`,[login]);
    expect(after.rows).toEqual(stats.rows);
  });

  it('rejects a same-name statistics view without genuine extension membership', async () => {
    const { account } = await seed();
    await admin.query('alter extension pg_stat_statements drop view extensions.pg_stat_statements');
    try { await expectRpcError(call(runtime,'preflight',[account]),'live-role-invalid'); }
    finally { await admin.query('alter extension pg_stat_statements add view extensions.pg_stat_statements'); }
    expect(await call(runtime,'preflight',[account])).toBe(true);
  });

  it('still rejects write grants on genuine statistics views', async () => {
    const { account } = await seed();
    await admin.query(`grant update on extensions.pg_stat_statements to ${login}`);
    try { await expectRpcError(call(runtime,'preflight',[account]),'live-role-invalid'); }
    finally { await admin.query(`revoke update on extensions.pg_stat_statements from ${login}`); }
    expect(await call(runtime,'preflight',[account])).toBe(true);
  });

  it('rejects public application data even when it resembles a statistics view', async () => {
    const { account } = await seed();
    await admin.query('create view public.execution_statistics_impostor as select 1 as value');
    await admin.query('grant select on public.execution_statistics_impostor to public');
    try { await expectRpcError(call(runtime,'preflight',[account]),'live-role-invalid'); }
    finally { await admin.query('drop view public.execution_statistics_impostor'); }
    expect(await call(runtime,'preflight',[account])).toBe(true);
  });

  it('admin seed stays disabled and runtime cannot create implicit fresh credit', async () => {
    const { account } = await seed(ledger(),false);
    await expectRpcError(call(runtime,'preflight',[account]),'live-account-unavailable');
    await expectRpcError(claim(account),'live-account-unavailable');
    const missing = sha(randomUUID());
    await expectRpcError(claim(missing),'live-account-unavailable');
    const absent = await admin.query('select count(*)::int n from execution_v3.accounts where account=$1',[missing]);
    expect(absent.rows[0].n).toBe(0);
  });

  it('claims once, returns exact imported bytes, and never extends a same-owner lease', async () => {
    const l = ledger();
    const text = JSON.stringify(l,null,2).replace('execution','\\u0065xecution') + '\r\n';
    const { account } = await seed(text);
    const before = Number(await call(admin,'_now')); const c = await claim(account);
    const after = Number(await call(admin,'_now'));
    expect(c.ledger).toBe(text); expect(c.revision).toBe(0); expect(c.fence).toBe(1);
    expect(c.leaseUntil).toBeGreaterThanOrEqual(before+150000); expect(c.leaseUntil).toBeLessThanOrEqual(after+150000);
    await expectRpcError(claim(account,c.owner),'live-account-busy');
    const stored = await admin.query('select lease_until from execution_v3.accounts where account=$1',[account]);
    expect(Number(stored.rows[0].lease_until)).toBe(c.leaseUntil);
    await expectRpcError(claim(account,randomUUID(),150001),'live-lock-lost');
  });

  it('two concurrent claims have only one writer and promptly refuse the loser', async () => {
    const { account } = await seed(); const start = Date.now();
    const attempts = await Promise.allSettled([claim(account,randomUUID(),150000,runtime),claim(account,randomUUID(),150000,other)]);
    expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find(x => x.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.detail).toBe('live-account-busy'); expect(Date.now()-start).toBeLessThan(2000);
  });

  it('uses bounded lock timeout instead of waiting behind a stuck account transaction', async () => {
    const { account } = await seed();
    await admin.query('begin');
    try {
      await admin.query('select account from execution_v3.accounts where account=$1 for update',[account]);
      const start = Date.now(); await expectRpcError(claim(account),'live-account-busy');
      expect(Date.now()-start).toBeLessThan(2000);
    } finally { await admin.query('rollback'); }
  });

  it('enforces concurrent revision CAS and exact ledger hash publication', async () => {
    const { account } = await seed(); const c = await claim(account); const l = ledger();
    l.jobs.push(job(c.owner,l.updatedAt)); const text = JSON.stringify(l,null,1) + '\r\n';
    const results = await Promise.allSettled([checkpoint(account,c,text,[],runtime),checkpoint(account,c,text,[],other)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.detail).toBe('live-ledger-changed');
    const stored = await admin.query("select convert_from(ledger_bytes,'UTF8') bytes,ledger_hash,revision from execution_v3.accounts where account=$1",[account]);
    expect(stored.rows[0]).toEqual({bytes:text,ledger_hash:sha(text),revision:'1'});
  });

  it('expiry preserves unknown nonterminal debt and fences stale checkpoint/release/pool writes', async () => {
    const oldOwner = randomUUID(); const l = ledger(Date.now()-200000); l.jobs.push(job(oldOwner,l.updatedAt));
    const { account, text } = await seed(l); const first = await claim(account);
    await admin.query('update execution_v3.accounts set lease_until=0 where account=$1',[account]);
    const second = await claim(account);
    expect(second.fence).toBe(first.fence+1); expect(second.revision).toBe(first.revision); expect(second.ledger).toBe(text);
    await expectRpcError(checkpoint(account,first,l),'live-lock-lost');
    await expectRpcError(call(runtime,'release',[account,first.owner,first.fence,first.revision]),'live-lock-lost');
    await expectRpcError(call(runtime,'save_pool',[account,first.owner,first.fence,sha('stale'),JSON.stringify(pool(sha('stale')))]),'live-lock-lost');
    const changed = structuredClone(l); changed.updatedAt = Date.now(); changed.jobs[0].pending=0; changed.jobs[0].budget.unmeasuredGraphql=0;
    await expectRpcError(checkpoint(account,second,changed),'live-ledger-invalid');
    const removed = structuredClone(l); removed.jobs=[]; removed.updatedAt=Date.now();
    await expectRpcError(checkpoint(account,second,removed),'live-ledger-invalid');
    const added = structuredClone(l); added.updatedAt=Date.now(); added.jobs.push(job(second.owner,added.updatedAt));
    expect(await checkpoint(account,second,added)).toEqual({revision:1});
    expect(JSON.parse((await admin.query("select convert_from(ledger_bytes,'UTF8') l from execution_v3.accounts where account=$1",[account])).rows[0].l).jobs[0]).toEqual(l.jobs[0]);
  });

  it('forbids expired owner publication even without a replacement, and release never resets ledger/fence/revision', async () => {
    const { account,text } = await seed(); const c = await claim(account);
    await admin.query('update execution_v3.accounts set lease_until=0 where account=$1',[account]);
    await expectRpcError(checkpoint(account,c,ledger()),'live-lock-lost');
    await expectRpcError(call(runtime,'release',[account,c.owner,c.fence,c.revision]),'live-lock-lost');
    const next = await claim(account);
    await call(runtime,'release',[account,next.owner,next.fence,next.revision]);
    const row = await admin.query("select convert_from(ledger_bytes,'UTF8') l,revision,fence,lease_until from execution_v3.accounts where account=$1",[account]);
    expect(row.rows[0]).toEqual({l:text,revision:'0',fence:String(next.fence),lease_until:'0'});
    await expectRpcError(claim(account,next.owner),'live-lock-lost');
  });

  it('allows measured native pending reconciliation but rejects unknown refunds and charged decreases', async () => {
    const { account } = await seed(); const c = await claim(account); const l=ledger(); l.jobs.push(job(c.owner,l.updatedAt));
    const first=await checkpoint(account,c,l); c.revision=first.revision;
    const refund=structuredClone(l); refund.jobs[0].pending=0; refund.jobs[0].budget.unmeasuredGraphql=0;
    await expectRpcError(checkpoint(account,c,refund),'live-ledger-invalid');
    const next=structuredClone(l); next.updatedAt=Date.now(); const j=next.jobs[0];
    j.budget.lastObservedAt=next.updatedAt; j.budget.unmeasuredGraphql=0;
    j.budget.points={limit:2000,spent:10,resetIn:100,measuredAt:next.updatedAt,allowance:150,jobSpent:4};
    j.charged=4; j.pending=0; j.window=JSON.stringify([2000,next.updatedAt+100000]);
    next.windows=[{limit:2000,resetAt:next.updatedAt+100000,pointEstimate:4,native:{spent:10,measuredAt:next.updatedAt},legacy:null}];
    expect(await checkpoint(account,c,next)).toEqual({revision:2}); c.revision=2;
    const lower=structuredClone(next); lower.jobs[0].charged=0; lower.jobs[0].budget.points!.jobSpent=0;
    await expectRpcError(checkpoint(account,c,lower),'live-ledger-invalid');
  });

  it('unchanged SQL rejects the old reset-drift refund and accepts native failed stages that preserve dispatch debt', async () => {
    const { account } = await seed(); const c = await claim(account);
    const at = Date.now(), canonicalReset = at + 100000;
    const value = ledger(at), prior = job(c.owner,at-1000);
    prior.budget.lastObservedAt = at;
    prior.budget.counters.graphql = prior.budget.counters.network = 2;
    prior.budget.points = { limit:2000,spent:10,resetIn:(canonicalReset+1427-at)/1000,
      measuredAt:at,allowance:150,jobSpent:4 };
    prior.window = JSON.stringify([2000,canonicalReset]); prior.charged=4; prior.pending=8;
    value.jobs.push(prior);
    value.windows.push({limit:2000,resetAt:canonicalReset,pointEstimate:8,native:{spent:10,measuredAt:at},legacy:null});
    c.revision = (await checkpoint(account,c,value)).revision;
    const incoming = structuredClone(prior.budget);
    incoming.lastObservedAt=at+1000; incoming.unmeasuredGraphql=0;
    incoming.pointEstimate=12;
    incoming.points={...prior.budget.points,spent:11,jobSpent:5,measuredAt:incoming.lastObservedAt,
      resetIn:(canonicalReset+1427+9000-incoming.lastObservedAt)/1000};

    // This is the pre-fix candidate: the inner accepted measurement clears its
    // counter before canonical-window reconciliation fails. Shape is valid,
    // but the unchanged SQL successor guard must reject its unproven refund.
    const oldCandidate={...structuredClone(value),updatedAt:incoming.lastObservedAt,jobs:[{
      ...structuredClone(prior),budget:incoming,accountingFailure:'live-window-incompatible',uncertainUntil:canonicalReset+10427,
    }]};
    expect(await call(admin,'_ledger',[JSON.stringify(oldCandidate)])).toEqual(oldCandidate);
    await expectRpcError(checkpoint(account,c,oldCandidate),'live-ledger-invalid');
    const rejected=await admin.query("select convert_from(ledger_bytes,'UTF8') bytes,revision from execution_v3.accounts where account=$1",[account]);
    expect(JSON.parse(rejected.rows[0].bytes)).toEqual(value); expect(Number(rejected.rows[0].revision)).toBe(c.revision);

    const staged=stageNativeJob(value,{state:incoming,jobID:c.owner});
    expect(staged.accountingFailure).toBe('live-window-incompatible');
    expect(staged.ledger.jobs[0].budget.unmeasuredGraphql).toBe(1);
    expect(staged.ledger.jobs[0].pending).toBe(12); expect(staged.ledger.jobs[0].charged).toBe(4);
    expect(staged.ledger.jobs[0].budget.pointEstimate).toBe(12);
    expect(staged.ledger.jobs[0].window).toBe(prior.window); expect(staged.ledger.windows).toEqual(value.windows);
    const store=new PostgresExecutionStore({account,db:{query:(text,values)=>runtime.query(text,values)}});
    c.revision=(await store.checkpoint({account,owner:c.owner,fence:c.fence,revision:c.revision,ledger:JSON.stringify(staged.ledger)+'\n'})).revision;
    const changedFailure=structuredClone(staged.ledger); changedFailure.jobs[0].accountingFailure='quota-window-changed';
    await expectRpcError(checkpoint(account,c,changedFailure),'live-ledger-invalid');
    const closed=stageNativeJob(staged.ledger,{state:{...incoming,lastObservedAt:at+2000,stop:'closed'},
      jobID:c.owner,accountingFailure:'quota-window-changed'});
    expect(closed.accountingFailure).toBe(staged.accountingFailure);
    expect(closed.ledger.jobs[0].budget.unmeasuredGraphql).toBe(1); expect(closed.ledger.jobs[0].pending).toBe(12);
    c.revision=(await store.checkpoint({account,owner:c.owner,fence:c.fence,revision:c.revision,ledger:JSON.stringify(closed.ledger)+'\n'})).revision;
    await store.release({account,owner:c.owner,fence:c.fence,revision:c.revision});
    const saved=await admin.query("select convert_from(ledger_bytes,'UTF8') bytes,ledger_hash,revision,lease_until from execution_v3.accounts where account=$1",[account]);
    expect(JSON.parse(saved.rows[0].bytes)).toEqual(closed.ledger);
    expect(saved.rows[0].ledger_hash).toBe(sha(saved.rows[0].bytes)); expect(saved.rows[0].lease_until).toBe('0');
    expect(Number(saved.rows[0].revision)).toBe(c.revision);
    expect(incoming.unmeasuredGraphql).toBe(0); // Native staging does not mutate its caller's snapshot.
  });

  it('real transport and restricted PostgreSQL retain the canonical quota expiry across awaited body checkpoints', async () => {
    const at=Date.now(), canonicalReset=at+100000, {account}=await seed(ledger(at));
    let clock=at, graphql=0, delayed=false;
    const checkpoints:ReturnType<typeof ledger>[]=[];
    const dateNow=vi.spyOn(Date,'now').mockImplementation(()=>clock);
    const store=new PostgresExecutionStore({account,db:{query:async(text,values)=>{
      if(text.includes('execution_v3.checkpoint')){
        const next=JSON.parse(String(values?.[4])) as ReturnType<typeof ledger>;
        checkpoints.push(structuredClone(next));
        const current=next.jobs.at(-1)!;
        // The second response has already received its headers and bytes, but
        // its quota is not yet parsed/observed. Await an actual SQL checkpoint
        // while advancing the same transport/native clock by >10s and <15s.
        if(!delayed&&graphql===2&&current.budget.counters.evidenceBytes>65536){
          expect(current.budget.unmeasuredGraphql).toBe(1);expect(current.pending).toBeGreaterThan(0);
          expect(current.budget.points?.spent).toBe(11);
          delayed=true;clock+=10427;
          await Promise.resolve();
        }
      }
      return runtime.query(text,values);
    }}});
    const fetchMock=vi.fn(async(input:string|URL|Request)=>{
      const url=input instanceof Request?input.url:input.toString();
      if(url==='https://www.warcraftlogs.com/oauth/token')return Response.json({access_token:'embedded-synthetic-token',expires_in:3600});
      expect(url).toBe('https://www.warcraftlogs.com/api/v2/client');graphql++;
      // The TTL is the provider's value at dispatch/header receipt. Body and
      // durable byte-observer latency must not be added to its reset boundary.
      return Response.json({data:{_executionMaintenanceQuota:{limitPerHour:graphql===3?3000:2000,
        pointsSpentThisHour:10+graphql,pointsResetIn:(canonicalReset-clock)/1000},
        __typename:'Query',...(graphql===2?{payload:'x'.repeat(131072)}:{})}});
    });
    vi.stubGlobal('fetch',fetchMock);
    let live:Awaited<ReturnType<typeof createDurableLiveBudget>>|undefined;
    try{
      live=await createStoredBudget({store,account,now:()=>clock});
      const client=maintenanceClient(new WclClient('embedded-synthetic-client','embedded-synthetic-secret'),live.budget);
      await client.measure();
      const initial=live.budget.snapshot();
      expect(initial.points!.measuredAt+initial.points!.resetIn*1000).toBe(canonicalReset);
      expect(initial.unmeasuredGraphql).toBe(0);
      const response=await client.query('query { __typename }',{});
      expect(response.__typename).toBe('Query');expect(delayed).toBe(true);expect(clock-at).toBe(10427);
      const accepted=live.budget.snapshot();
      expect(accepted.points!.measuredAt).toBe(clock);
      expect(accepted.points!.measuredAt+accepted.points!.resetIn*1000).toBe(canonicalReset);
      expect(accepted.unmeasuredGraphql).toBe(0);expect(accepted.stop).toBe(null);
      const settled=checkpoints.at(-1)!, settledJob=settled.jobs.at(-1)!;
      expect(settled.windows).toHaveLength(1);expect(settled.windows[0].resetAt).toBe(canonicalReset);
      expect(settledJob.window).toBe(JSON.stringify([2000,canonicalReset]));
      expect(settledJob.pending).toBe(0);expect(settledJob.charged).toBe(5);
      expect(settledJob.accountingFailure).toBe(null);
      expect(checkpoints.some(value=>{const j=value.jobs.at(-1)!;return j.budget.counters.graphql===2&&j.budget.unmeasuredGraphql===1&&j.pending>0&&j.budget.points?.spent===11;})).toBe(true);

      // A genuine incompatible quota is still rejected and cannot settle the
      // third dispatched request's pending debt or extend the canonical expiry.
      await expect(client.query('query { __typename }',{})).rejects.toMatchObject({code:'quota-window-changed'});
      expect(graphql).toBe(3);expect(fetchMock).toHaveBeenCalledTimes(4);
      const failed=checkpoints.at(-1)!, failedJob=failed.jobs.at(-1)!;
      expect(failed.windows[0].resetAt).toBe(canonicalReset);expect(failedJob.pending).toBeGreaterThan(0);
      expect(failedJob.budget.unmeasuredGraphql).toBe(1);expect(failedJob.budget.points?.spent).toBe(12);
      expect(failedJob.charged).toBe(5);
      await client.settle();await live.release();live=undefined;
      const saved=await admin.query("select convert_from(ledger_bytes,'UTF8') bytes,ledger_hash,revision,lease_until from execution_v3.accounts where account=$1",[account]);
      const stored=JSON.parse(saved.rows[0].bytes) as ReturnType<typeof ledger>;
      expect(stored.windows[0].resetAt).toBe(canonicalReset);expect(stored.jobs.at(-1)!.pending).toBeGreaterThan(0);
      expect(stored.jobs.at(-1)!.budget.unmeasuredGraphql).toBe(1);expect(stored.jobs.at(-1)!.terminal).toBe(true);
      expect(saved.rows[0].ledger_hash).toBe(sha(saved.rows[0].bytes));expect(saved.rows[0].lease_until).toBe('0');
      expect(Number(saved.rows[0].revision)).toBeGreaterThan(0);
    }finally{
      if(live)await live.release().catch(()=>undefined);
      dateNow.mockRestore();vi.unstubAllGlobals();
    }
  });

  it('terminal jobs remain immutable and new IDs must match the current owner', async () => {
    const l=ledger(); l.jobs.push(job(randomUUID(),l.updatedAt,true)); const { account }=await seed(l); const c=await claim(account);
    const resume=structuredClone(l); resume.jobs[0].terminal=false; resume.jobs[0].budget.stop=null;
    await expectRpcError(checkpoint(account,c,resume),'live-ledger-invalid');
    const fake=structuredClone(l); fake.jobs.push(job(randomUUID(),l.updatedAt));
    await expectRpcError(checkpoint(account,c,fake),'live-ledger-invalid');
    const terminalMutation=structuredClone(l); terminalMutation.jobs[0].pending=8;
    await expectRpcError(checkpoint(account,c,terminalMutation),'live-ledger-invalid');
  });

  it('admits a new exact 60-second request policy while preserving imported 15-second jobs and debt', async () => {
    const value=ledger(); value.jobs.push(job(randomUUID(),value.updatedAt,true));
    const {account}=await seed(value); const c=await claim(account);
    const next=structuredClone(value); next.updatedAt=Date.now();
    const current=job(c.owner,next.updatedAt);
    current.budget.limits={...LIMITS,requestTimeoutMs:60000}; next.jobs.push(current);
    expect(await checkpoint(account,c,next)).toEqual({revision:1});
    const saved=await admin.query("select convert_from(ledger_bytes,'UTF8') bytes from execution_v3.accounts where account=$1",[account]);
    expect(saved.rows[0].bytes).toBe(JSON.stringify(next)+'\n');
    expect(JSON.parse(saved.rows[0].bytes).jobs[0]).toEqual(value.jobs[0]);
    expect(next.jobs[0].pending).toBe(4); expect(next.jobs[0].budget.unmeasuredGraphql).toBe(1);
  });

  it('rejects timeout values above 60 seconds or between the two exact approved policies without persisting them', async () => {
    const {account,text}=await seed(); const c=await claim(account);
    for(const timeout of [60001,30000,15001,0]) {
      const next=ledger(); const current=job(c.owner,next.updatedAt);
      current.budget.limits={...LIMITS,requestTimeoutMs:timeout}; next.jobs.push(current);
      await expectRpcError(checkpoint(account,c,next),'live-ledger-invalid');
    }
    const saved=await admin.query("select convert_from(ledger_bytes,'UTF8') bytes,revision from execution_v3.accounts where account=$1",[account]);
    expect(saved.rows[0]).toEqual({bytes:text,revision:'0'});
  });

  it('never widens an existing active 15-second job to the new 60-second policy', async () => {
    const {account}=await seed(); const c=await claim(account); const value=ledger();
    value.jobs.push(job(c.owner,value.updatedAt)); c.revision=(await checkpoint(account,c,value)).revision;
    const wider=structuredClone(value); wider.jobs[0].budget.limits.requestTimeoutMs=60000;
    await expectRpcError(checkpoint(account,c,wider),'live-ledger-invalid');
    const saved=await admin.query("select convert_from(ledger_bytes,'UTF8') bytes,revision,lease_until from execution_v3.accounts where account=$1",[account]);
    expect(saved.rows[0]).toEqual({bytes:JSON.stringify(value)+'\n',revision:'1',lease_until:String(c.leaseUntil)});
  });

  it('keeps every other budget guard exact under the 60-second policy', async () => {
    const {account,text}=await seed(); const c=await claim(account);
    for(const [key,amount] of Object.entries(LIMITS)) {
      if(key==='requestTimeoutMs') continue;
      const next=ledger(); const current=job(c.owner,next.updatedAt);
      current.budget.limits={...LIMITS,requestTimeoutMs:60000,[key]:amount+1}; next.jobs.push(current);
      await expectRpcError(checkpoint(account,c,next),'live-ledger-invalid');
    }
    const extended=ledger(); const current=job(c.owner,extended.updatedAt);
    current.budget.limits={...LIMITS,requestTimeoutMs:60000}; current.budget.deadline+=1; extended.jobs.push(current);
    await expectRpcError(checkpoint(account,c,extended),'live-ledger-invalid');
    await expectRpcError(claim(account,randomUUID(),150001),'live-lock-lost');
    const saved=await admin.query("select convert_from(ledger_bytes,'UTF8') bytes,revision,lease_until from execution_v3.accounts where account=$1",[account]);
    expect(saved.rows[0]).toEqual({bytes:text,revision:'0',lease_until:String(c.leaseUntil)});
  });

  it('never removes or lowers unbound legacy debt or monetary/counter bounds', async () => {
    const value={...ledger(),legacyUnknown:{charged:12,pending:8,estimatedRequestCost:4,boundWindow:null}};
    const { account }=await seed(value); const c=await claim(account);
    await expectRpcError(checkpoint(account,c,ledger()),'live-ledger-invalid');
    const lower=structuredClone(value); lower.legacyUnknown.pending=0;
    await expectRpcError(checkpoint(account,c,lower),'live-ledger-invalid');
    const unsafe=structuredClone(value); unsafe.legacyUnknown.charged=Number.MAX_SAFE_INTEGER+1;
    await expectRpcError(checkpoint(account,c,unsafe),'live-ledger-invalid');
    const invalid={...ledger(),jobs:[job(c.owner,Date.now())]}; invalid.jobs[0].budget.counters.graphql=61;
    await expectRpcError(checkpoint(account,c,invalid),'live-ledger-invalid');
  });

  function archiveFixture() {
    const now=Date.now(), at=now-300000, measured=at+50000, resetAt=now-20000;
    const j=job(randomUUID(),at,true); j.pending=0; j.charged=5; j.budget.unmeasuredGraphql=0; j.budget.lastObservedAt=measured;
    j.budget.points={limit:2000,spent:10,resetIn:(resetAt-measured)/1000,measuredAt:measured,allowance:150,jobSpent:5};
    j.window=JSON.stringify([2000,resetAt]);
    const w={limit:2000,resetAt,pointEstimate:4,native:{spent:10,measuredAt:measured},legacy:null};
    const l={version:VERSION,updatedAt:measured,jobs:[j],windows:[w]};
    const h={version:'execution-v3-live-history-1',previous:null,through:resetAt+10000,sourceUpdatedAt:measured,windows:[w],jobs:[j]};
    const bytes=JSON.stringify(h,null,1)+'\r\n'; const entry={sha256:sha(bytes),bytes};
    const head={sha256:entry.sha256,segments:1,through:h.through};
    const next={...ledger(now),archive:head};
    return {l,h,entry,head,next};
  }
  it('upgrades only the private validator and leaves exact legacy ledger/history bytes, hashes, debt and authority untouched', async () => {
    const migrations=readMigrations();
    const original=migrations.find(value=>value.name===EXECUTION_MIGRATION)!;
    const upgrade=migrations.find(value=>value.name===EXECUTION_TIMEOUT_MIGRATION)!;
    const originalBudget=original.sql.match(/CREATE OR REPLACE FUNCTION execution_v3\._budget\(p_value jsonb\)[\s\S]*?\$fn\$;/)?.[0];
    expect(originalBudget).toBeTruthy();
    await admin.query('begin');
    try {
      // Reproduce an already-deployed old validator with real 15-second live
      // and archived records. Roll back the whole exercise after verification.
      await admin.query(originalBudget!);
      const old=ledger(); old.jobs.push(job(randomUUID(),old.updatedAt,true));
      const imported=JSON.stringify(old,null,2)+'\r\n';
      const {account}=await seed(imported); const archived=archiveFixture();
      const history=await seed(archived.next,false,[archived.entry]);
      const before=await admin.query('select * from execution_v3.accounts where account=any($1::text[]) order by account',[[account,history.account]]);
      const oldHistory=await admin.query('select * from execution_v3.history where account=$1',[history.account]);
      const authority=await admin.query("select proowner,proacl,prosecdef,provolatile,proconfig from pg_proc where oid='execution_v3._budget(jsonb)'::regprocedure");
      const transition=await admin.query("select pg_get_functiondef('execution_v3._transition(text,uuid,jsonb,jsonb,jsonb)'::regprocedure) definition");
      const proposed={...budget(old.updatedAt),limits:{...LIMITS,requestTimeoutMs:60000}};
      expect(await call(admin,'_budget',[JSON.stringify(proposed)])).toBe(false);
      expect(await call(admin,'_budget',[JSON.stringify(old.jobs[0].budget)])).toBe(true);
      await admin.query(upgrade.sql);
      expect(await call(admin,'_budget',[JSON.stringify(proposed)])).toBe(true);
      expect(await call(admin,'_budget',[JSON.stringify(old.jobs[0].budget)])).toBe(true);
      expect(await call(admin,'_ledger',[imported])).toEqual(old);
      const after=await admin.query('select * from execution_v3.accounts where account=any($1::text[]) order by account',[[account,history.account]]);
      expect(after.rows).toEqual(before.rows);
      expect((await admin.query('select * from execution_v3.history where account=$1',[history.account])).rows).toEqual(oldHistory.rows);
      expect((await admin.query("select proowner,proacl,prosecdef,provolatile,proconfig from pg_proc where oid='execution_v3._budget(jsonb)'::regprocedure")).rows).toEqual(authority.rows);
      expect((await admin.query("select pg_get_functiondef('execution_v3._transition(text,uuid,jsonb,jsonb,jsonb)'::regprocedure) definition")).rows).toEqual(transition.rows);
    } finally { await admin.query('rollback'); }
  });
  it('atomically appends exact hashed expired history with the ledger, then forbids mutation/reuse of archived IDs', async () => {
    const {l,entry,next}=archiveFixture(); const {account}=await seed(l); const c=await claim(account);
    expect(await checkpoint(account,c,next,[entry])).toEqual({revision:1});
    expect(await call(runtime,'read_history',[account,entry.sha256])).toBe(entry.bytes);
    const different=await seed(); expect(await call(runtime,'read_history',[different.account,entry.sha256])).toBeNull();
    await expectRpcError(admin.query('update execution_v3.history set bytes=bytes where account=$1',[account]),'live-archive-invalid');
    await expectRpcError(admin.query('delete from execution_v3.history where account=$1',[account]),'live-archive-invalid');
    await call(runtime,'release',[account,c.owner,c.fence,1]);
    await expectRpcError(claim(account,l.jobs[0].id),'live-lock-lost');
  });
  it('rejects bad history hashes, unlinked heads, unexpired archives, and unproven deletions without publishing anything', async () => {
    const {l,entry,next}=archiveFixture(); const {account,text}=await seed(l); const c=await claim(account);
    await expectRpcError(checkpoint(account,c,next,[{...entry,sha256:sha('wrong')}]),'live-archive-invalid');
    const h=JSON.parse(entry.bytes); h.previous={sha256:sha('other'),segments:1,through:h.through};
    const bytes=JSON.stringify(h)+'\n';
    await expectRpcError(checkpoint(account,c,next,[{sha256:sha(bytes),bytes}]),'live-archive-invalid');
    await expectRpcError(checkpoint(account,c,ledger()),'live-ledger-invalid');
    const count=await admin.query('select count(*)::int n from execution_v3.history where account=$1',[account]); expect(count.rows[0].n).toBe(0);
    const row=await admin.query("select convert_from(ledger_bytes,'UTF8') l,revision from execution_v3.accounts where account=$1",[account]);
    expect(row.rows[0]).toEqual({l:text,revision:'0'});
    const active=structuredClone(l); active.windows[0].resetAt=Date.now()+20000; active.jobs[0].window=JSON.stringify([2000,active.windows[0].resetAt]);
    active.jobs[0].budget.points!.resetIn=(active.windows[0].resetAt-active.updatedAt)/1000;
    const seeded=await seed(active); const activeClaim=await claim(seeded.account);
    const liveH={version:'execution-v3-live-history-1',previous:null,through:active.windows[0].resetAt+10000,sourceUpdatedAt:active.updatedAt,
      windows:active.windows,jobs:active.jobs}; const liveBytes=JSON.stringify(liveH)+'\n';
    await expectRpcError(checkpoint(seeded.account,activeClaim,{...ledger(),archive:{sha256:sha(liveBytes),segments:1,through:liveH.through}},
      [{sha256:sha(liveBytes),bytes:liveBytes}]),'live-archive-invalid');
  });
  it('admin can import a linked final live archive, disabled, with exact segment bytes', async () => {
    const {entry,head,next}=archiveFixture(); const {account}=await seed(next,false,[entry]);
    const imported=await admin.query("select encode(bytes,'hex') bytes from execution_v3.history where account=$1 and sha256=$2",[account,head.sha256]);
    expect(imported.rows[0].bytes).toBe(Buffer.from(entry.bytes).toString('hex'));
    await expectRpcError(claim(account),'live-account-unavailable');
  });

  it('a real committed-but-unacknowledged admission stays charged/pending, is latched, and is never replayed', async () => {
    const {account}=await seed(); let statements=0; let dispatched=false;
    const store=new PostgresExecutionStore({account,db:{query:async(text,values)=>{
      statements++;
      const result=await runtime.query(text,values);
      if(text.includes('execution_v3.checkpoint')) throw Object.assign(new Error('private driver body'),{code:'08006'});
      return result;
    }}});
    const c=await store.claim(account,randomUUID(),150000); const l=ledger(); const id=(await admin.query('select owner from execution_v3.accounts where account=$1',[account])).rows[0].owner;
    l.jobs.push(job(id,l.updatedAt));
    await expect((async()=>{await store.checkpoint({account,owner:id,fence:c.fence,revision:c.revision,ledger:JSON.stringify(l)+'\n'});dispatched=true;})()).rejects.toMatchObject({code:'live-store-unavailable'});
    expect(dispatched).toBe(false); expect(statements).toBe(3);
    await expect(store.checkpoint({account,owner:id,fence:c.fence,revision:0,ledger:JSON.stringify(ledger())})).rejects.toMatchObject({code:'live-store-unavailable'});
    await expect(store.release({account,owner:id,fence:c.fence,revision:1})).rejects.toMatchObject({code:'live-store-unavailable'});
    expect(statements).toBe(3);
    await admin.query('update execution_v3.accounts set lease_until=0 where account=$1',[account]);
    const replacement=await claim(account,randomUUID(),150000,other);
    expect(replacement.revision).toBe(1); expect(replacement.fence).toBe(c.fence+1);
    expect(JSON.parse(replacement.ledger).jobs).toEqual(l.jobs);
  });

  it('extends a linked history only from the old exact head and admin import requires the whole oldest-first chain', async () => {
    const first=archiveFixture(); const second=archiveFixture(); second.l.jobs[0].id=randomUUID();
    second.l.windows[0].resetAt=first.l.windows[0].resetAt-1000;
    second.l.jobs[0].window=JSON.stringify([2000,second.l.windows[0].resetAt]);
    second.l.jobs[0].budget.points!.resetIn=(second.l.windows[0].resetAt-second.l.updatedAt)/1000;
    const old={version:VERSION,updatedAt:Date.now(),windows:[...first.l.windows,...second.l.windows],jobs:[...first.l.jobs,...second.l.jobs]};
    const {account}=await seed(old); const c=await claim(account);
    const h1={...first.h,sourceUpdatedAt:old.updatedAt}; const bytes1=JSON.stringify(h1)+'\n'; const e1={sha256:sha(bytes1),bytes:bytes1};
    const head1={sha256:e1.sha256,segments:1,through:h1.through};
    const intermediate={...ledger(),windows:second.l.windows,jobs:second.l.jobs,archive:head1};
    expect(await checkpoint(account,c,intermediate,[e1])).toEqual({revision:1}); c.revision=1;
    const h2={version:'execution-v3-live-history-1',previous:head1,through:head1.through,sourceUpdatedAt:intermediate.updatedAt,
      windows:second.l.windows,jobs:second.l.jobs}; const bytes2=JSON.stringify(h2,null,1)+'\r\n'; const e2={sha256:sha(bytes2),bytes:bytes2};
    const final={...ledger(),archive:{sha256:e2.sha256,segments:2,through:h2.through}};
    expect(await checkpoint(account,c,final,[e2])).toEqual({revision:2});
    expect(await call(runtime,'read_history',[account,e1.sha256])).toBe(bytes1);
    expect(await call(runtime,'read_history',[account,e2.sha256])).toBe(bytes2);
    const imported=await seed(final,false,[e1,e2]);
    expect((await admin.query('select count(*)::int n from execution_v3.history where account=$1',[imported.account])).rows[0].n).toBe(2);
    await expectRpcError(call(admin,'seed_account',[sha(randomUUID()),JSON.stringify(final),JSON.stringify([e2])]),'live-archive-invalid');
    await expectRpcError(call(admin,'seed_account',[sha(randomUUID()),JSON.stringify(final),JSON.stringify([e2,e1])]),'live-archive-invalid');
    await expectRpcError(call(admin,'seed_account',[sha(randomUUID()),JSON.stringify(final),JSON.stringify([e1])]),'live-archive-invalid');
  });

  it('pools are account-scoped exact JSON, fixed 600000ms TTL, non-sliding even on same-key writes', async () => {
    const {account}=await seed(); const c=await claim(account); const p=pool(); const text=JSON.stringify(p,null,1);
    await call(runtime,'save_pool',[account,c.owner,c.fence,p.key,text]);
    const before=await admin.query('select created_at,expires_at,writer_fence from execution_v3.pools where account=$1',[account]);
    expect(Number(before.rows[0].expires_at)-Number(before.rows[0].created_at)).toBe(600000);
    expect(await call(other,'read_pool',[account,p.key])).toBe(text);
    p.at=Date.now(); await call(runtime,'save_pool',[account,c.owner,c.fence,p.key,JSON.stringify(p)]);
    const after=await admin.query('select created_at,expires_at,writer_fence from execution_v3.pools where account=$1',[account]); expect(after.rows).toEqual(before.rows);
    const another=await seed(); expect(await call(runtime,'read_pool',[another.account,p.key])).toBeNull();
    await admin.query('update execution_v3.pools set created_at=0,expires_at=600000 where account=$1',[account]);
    expect(await call(runtime,'read_pool',[account,p.key])).toBeNull();
    await admin.query('update execution_v3.accounts set lease_until=0 where account=$1',[account]);
    await expectRpcError(call(runtime,'save_pool',[account,c.owner,c.fence,p.key,JSON.stringify(p)]),'live-lock-lost');
  });
  it.each(['native-live-statistics-2', 'native-live-statistics-3', LIVE_RULES_VERSION])(
    'round-trips supported pool rules %s with matching relational metadata and unchanged accounting', async rulesVersion => {
      const {account,text:ledgerText}=await seed(); const c=await claim(account);
      const p={...pool(),rulesVersion}; const exact=JSON.stringify(p,null,1)+'\r\n';
      await call(runtime,'save_pool',[account,c.owner,c.fence,p.key,exact]);
      expect(await call(other,'read_pool',[account,p.key])).toBe(exact);
      const row=await admin.query(`select rules_version,version,convert_from(bytes,'UTF8') bytes,
        writer_owner,writer_fence,expires_at-created_at ttl from execution_v3.pools where account=$1 and key=$2`,[account,p.key]);
      expect(row.rows[0]).toEqual({rules_version:rulesVersion,version:'execution-statistical-3',bytes:exact,
        writer_owner:c.owner,writer_fence:String(c.fence),ttl:'600000'});
      const accounting=await admin.query("select convert_from(ledger_bytes,'UTF8') ledger,revision,fence from execution_v3.accounts where account=$1",[account]);
      expect(accounting.rows[0]).toEqual({ledger:ledgerText,revision:'0',fence:String(c.fence)});
      await call(runtime,'release',[account,c.owner,c.fence,c.revision]);
      const next=await claim(account);
      expect(next.ledger).toBe(ledgerText); expect(next.revision).toBe(c.revision); expect(next.fence).toBe(c.fence+1);
    });
  it('same-key rule upgrades keep the fixed TTL and update the column to the saved payload version', async () => {
    const {account}=await seed(); const c=await claim(account); const p=pool();
    await call(runtime,'save_pool',[account,c.owner,c.fence,p.key,JSON.stringify(p)]);
    const before=await admin.query('select created_at,expires_at from execution_v3.pools where account=$1 and key=$2',[account,p.key]);
    for(const rulesVersion of ['native-live-statistics-3',LIVE_RULES_VERSION]) {
      p.rulesVersion=rulesVersion; p.at=Date.now();
      await call(runtime,'save_pool',[account,c.owner,c.fence,p.key,JSON.stringify(p)]);
      const row=await admin.query("select rules_version,convert_from(bytes,'UTF8') bytes,created_at,expires_at from execution_v3.pools where account=$1 and key=$2",[account,p.key]);
      expect(row.rows[0]).toEqual({...before.rows[0],rules_version:rulesVersion,bytes:JSON.stringify(p)});
      expect(JSON.parse(await call<string>(other,'read_pool',[account,p.key])).rulesVersion).toBe(rulesVersion);
    }
  });
  it('refuses unsupported or malformed pool rules at both the RPC and table constraint', async () => {
    const {account,text:ledgerText}=await seed(); const c=await claim(account); const p=pool();
    const invalid=['native-live-statistics-5','native-live-statistics-5-41a428147ec909d2',
      'native-live-statistics-4','native-live-statistics-4-', 'native-live-statistics-4-1234',
      'native-live-statistics-4-41A428147EC909D2','native-live-statistics-4-41a428147ec909d22',
      'native-live-statistics-4-41a428147ec909dg','native-live-statistics-4-41a428147ec909d2-extra',''];
    for(const rulesVersion of invalid) {
      await expectRpcError(call(runtime,'save_pool',[account,c.owner,c.fence,p.key,JSON.stringify({...p,rulesVersion})]),'compact-cache-invalid');
    }
    const absent=await admin.query('select count(*)::int n from execution_v3.pools where account=$1',[account]);
    expect(absent.rows[0].n).toBe(0);
    await call(runtime,'save_pool',[account,c.owner,c.fence,p.key,JSON.stringify({...p,rulesVersion:LIVE_RULES_VERSION})]);
    for(const rulesVersion of invalid) {
      await expectSqlState(admin.query('update execution_v3.pools set rules_version=$3 where account=$1 and key=$2',[account,p.key,rulesVersion]),'23514');
    }
    const stored=await admin.query('select rules_version from execution_v3.pools where account=$1 and key=$2',[account,p.key]);
    expect(stored.rows[0].rules_version).toBe(LIVE_RULES_VERSION);
    const accounting=await admin.query("select convert_from(ledger_bytes,'UTF8') ledger,revision from execution_v3.accounts where account=$1",[account]);
    expect(accounting.rows[0]).toEqual({ledger:ledgerText,revision:'0'});
  });
  it('the real PostgreSQL store saves the generated raid rules and releases its lease without latching a failure', async () => {
    expect(LIVE_RULES_VERSION).toMatch(/^native-live-statistics-4-[a-f0-9]{16}$/);
    const {account,text:ledgerText}=await seed();
    const store=new PostgresExecutionStore({account,db:{query:(text,values)=>runtime.query(text,values)}});
    const owner=randomUUID(); const c=await store.claim(account,owner,150000);
    const ownership={account,owner,fence:c.fence}, p={...pool(),rulesVersion:LIVE_RULES_VERSION};
    await store.savePool(p,ownership);
    expect(await store.readPool(p.key)).toEqual(p);
    await store.release({...ownership,revision:c.revision});
    const row=await admin.query("select lease_until,revision,convert_from(ledger_bytes,'UTF8') ledger from execution_v3.accounts where account=$1",[account]);
    expect(row.rows[0]).toEqual({lease_until:'0',revision:'0',ledger:ledgerText});
    const next=await claim(account,randomUUID(),150000,other);
    expect(next.fence).toBe(c.fence+1); expect(next.ledger).toBe(ledgerText);
  });
  it('accepts nonempty native compact statistics, preserves unknown metrics, and rejects malformed observations', async () => {
    const {account}=await seed(); const c=await claim(account); const p=pool();
    const unknown={state:'missing',value:null,direction:null,scoreEligible:false,measurements:{complete:false},definition:{},limitations:['Not observed'],score:null};
    const observation={version:'execution-statistical-3',
      identity:{code:'ABCDEFGHIJKLMNOP',fightID:2,actorID:4,name:'Pokémon♀',server:'Test',region:'US',className:'Priest',spec:'Shadow',role:'dps',verified:true},
      scope:p.scope,fight:{encounter:200,difficulty:5,size:20,startTime:0,endTime:200000,durationSec:200,kill:true},
      provenance:{mode:'current-bound',legacy:false,authenticated:null,streams:[]},
      support:{pi:null,state:'unknown',limitations:['Partial coverage']},
      components:{avoidance:unknown,survival:unknown,incoming:unknown,defenses:unknown,healing:unknown,
        output:{...unknown,state:'known',value:125000,direction:'higher',scoreEligible:true,
          measurements:{usefulDamage:25000000,usefulDamagePerSecond:125000,complete:true},
          definition:{id:'native-boss-damage-per-fight-second-v1',unit:'damage/second'}}}};
    const valid={...p,observations:[observation],scope:{...p.scope,zoneName:'Test Raid',encounterName:'Test Boss'}};
    const exact=JSON.stringify(valid,null,1)+'\r\n';
    await call(runtime,'save_pool',[account,c.owner,c.fence,p.key,exact]);
    expect(await call(other,'read_pool',[account,p.key])).toBe(exact);
    const fractional={...observation,fight:{...observation.fight,startTime:0.1,endTime:0.3,durationSec:(0.3-0.1)/1000}};
    await call(runtime,'save_pool',[account,c.owner,c.fence,p.key,JSON.stringify({...valid,observations:[fractional]})]);
    for(const malformed of [
      {...observation,identity:{...observation.identity,verified:false}},
      {...observation,scope:{...observation.scope,zone:0}},
      {...observation,fight:{...observation.fight,durationSec:201}},
      {...observation,events:[{raw:'provider-payload'}]},
      {...observation,components:{...observation.components,output:{...observation.components.output,score:99}}},
      {...observation,components:{...observation.components,survival:{...unknown,state:'invented'}}},
    ]) await expectRpcError(call(runtime,'save_pool',[account,c.owner,c.fence,p.key,JSON.stringify({...valid,observations:[malformed]})]),'compact-cache-invalid');
    await expectRpcError(call(runtime,'save_pool',[account,c.owner,c.fence,p.key,JSON.stringify({...valid,scope:{...valid.scope,partition:-1}})]),'compact-cache-invalid');
  });
  it('caps pools at 64 and 8MiB and checks versions/structure before publication', async () => {
    const {account}=await seed(); const c=await claim(account);
    for(let i=0;i<64;i++){const p=pool(sha(`pool-${i}`));await call(runtime,'save_pool',[account,c.owner,c.fence,p.key,JSON.stringify(p)]);}
    const p=pool(); await expectRpcError(call(runtime,'save_pool',[account,c.owner,c.fence,p.key,JSON.stringify(p)]),'compact-cache-full');
    await expectRpcError(call(runtime,'save_pool',[account,c.owner,c.fence,p.key,' '.repeat(8388609)]),'compact-cache-size-cap');
    await expectRpcError(call(runtime,'save_pool',[account,c.owner,c.fence,p.key,JSON.stringify({...p,version:'old'})]),'compact-cache-invalid');
    await expectRpcError(call(runtime,'save_pool',[account,c.owner,c.fence,p.key,JSON.stringify({...p,attempted:Array(513).fill('x')})]),'compact-cache-invalid');
  });
  it('pins are server-minted UUIDs, exact compact UTF8, fixed/non-sliding/account-scoped, and capped at 128', async () => {
    const {account}=await seed(); const text=JSON.stringify(pin(),null,1); const id=await call<string>(runtime,'put_pin',[account,text]);
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    const before=await admin.query('select created_at,expires_at from execution_v3.pins where account=$1 and id=$2',[account,id]);
    expect(Number(before.rows[0].expires_at)-Number(before.rows[0].created_at)).toBe(600000);
    expect(await call(other,'read_pin',[account,id])).toBe(text); expect(await call(other,'read_pin',[account,id])).toBe(text);
    const after=await admin.query('select created_at,expires_at from execution_v3.pins where account=$1 and id=$2',[account,id]); expect(after.rows).toEqual(before.rows);
    const another=await seed(); expect(await call(runtime,'read_pin',[another.account,id])).toBeNull();
    for(let i=1;i<128;i++) await call(runtime,'put_pin',[account,text]);
    await expectRpcError(call(runtime,'put_pin',[account,text]),'execution-pin-full');
    await admin.query('update execution_v3.pins set created_at=0,expires_at=600000 where account=$1',[account]);
    expect(await call(runtime,'read_pin',[account,id])).toBeNull();
    expect(await call(runtime,'put_pin',[account,text])).not.toBe(id);
    await expectRpcError(call(runtime,'put_pin',[account,JSON.stringify({base:{},params:{}})]),'execution-pin-invalid');
  });
});
