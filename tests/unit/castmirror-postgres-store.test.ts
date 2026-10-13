import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createPostgresExecutionStore, executionPoolConfig, ExecutionStoreError, PostgresExecutionStore, type SQLQueryable } from '../../app/api/castmirror/execution/postgres-store';

const account = createHash('sha256').update('wcl-client:unit-test').digest('hex');
const owner = randomUUID();
const ownership = { account, owner, fence: 1 };
const ledger = '{"version":"execution-v3-live-account-1","updatedAt":1,"jobs":[],"windows":[]}\r\n';
function database(results: unknown[] = []) {
  const query = vi.fn<SQLQueryable['query']>();
  query.mockResolvedValueOnce({ rows: [{ result: true }] });
  for (const result of results) query.mockResolvedValueOnce({ rows: [{ result }] });
  return { query, end: vi.fn(async () => {}) };
}
function claimResult(overrides = {}) { return { ledger, revision: 0, fence: 1, leaseUntil: 180000, ...overrides }; }

// No provider, environment secret, REST client, or real network is used here.
describe('server-only PostgreSQL Execution store', () => {
  it('lazily runs one actual-role/account preflight, with static parameterized RPCs and exact bytes', async () => {
    const db = database([claimResult(), { revision: 1 }, null]);
    const store = new PostgresExecutionStore({ account, db });
    expect(db.query).not.toHaveBeenCalled();
    const claimed = await store.claim(account, owner, 150000);
    expect(claimed).toEqual(claimResult());
    expect(await store.checkpoint({ ...ownership, revision: 0, ledger })).toEqual({ revision: 1 });
    await store.release({ ...ownership, revision: 1 });
    expect(db.query.mock.calls).toEqual([
      ['select execution_v3.preflight($1::text) as result', [account]],
      ['select execution_v3.claim($1::text, $2::uuid, $3::int) as result', [account, owner, 150000]],
      ['select execution_v3.checkpoint($1::text, $2::uuid, $3::bigint, $4::bigint, $5::text, $6::jsonb) as result', [account, owner, 1, 0, ledger, '[]']],
      ['select execution_v3.release($1::text, $2::uuid, $3::bigint, $4::bigint) as result', [account, owner, 1, 1]],
    ]);
  });
  it('shares a concurrent preflight promise rather than launching extra connections', async () => {
    const db = database([null, null]); const store = new PostgresExecutionStore({ account, db });
    await Promise.all([store.readPin(randomUUID()), store.readPool(account)]);
    expect(db.query.mock.calls.filter(([sql]) => sql.includes('preflight'))).toHaveLength(1);
  });
  it('refuses unbound account, unsafe numeric revisions/fences, malformed owner, overlong lease before DB I/O', async () => {
    const db=database(); const store=new PostgresExecutionStore({ account, db });
    await expect(store.claim('raw-client-identity',owner,150000)).rejects.toMatchObject({code:'live-lock-lost'});
    await expect(store.claim(account,owner,150001)).rejects.toMatchObject({code:'live-lock-lost'});
    await expect(store.claim(account,'x',150000)).rejects.toMatchObject({code:'live-lock-lost'});
    await expect(store.checkpoint({...ownership,revision:Number.MAX_SAFE_INTEGER+1,ledger})).rejects.toMatchObject({code:'live-ledger-changed'});
    await expect(store.checkpoint({...ownership,fence:0,revision:0,ledger})).rejects.toMatchObject({code:'live-lock-lost'});
    await expect(store.savePool({key:account})).rejects.toMatchObject({code:'live-lock-lost'});
    expect(db.query).not.toHaveBeenCalled();
  });
  it('bounds exact UTF8 ledger/history/pools/pins without lossy surrogate replacement', async () => {
    const db=database(); const store=new PostgresExecutionStore({ account, db });
    await expect(store.checkpoint({...ownership,revision:0,ledger:' '.repeat(1048577)})).rejects.toMatchObject({code:'live-ledger-full'});
    await expect(store.checkpoint({...ownership,revision:0,ledger:'\ud800'})).rejects.toMatchObject({code:'live-ledger-full'});
    await expect(store.checkpoint({...ownership,revision:0,ledger,history:[{sha256:account,bytes:' '.repeat(2097153)}]})).rejects.toMatchObject({code:'live-archive-invalid'});
    await expect(store.checkpoint({...ownership,revision:0,ledger,history:Array(2).fill({sha256:account,bytes:'{}'})})).rejects.toMatchObject({code:'live-archive-invalid'});
    await expect(store.savePool({key:account,padding:' '.repeat(8388608)},ownership)).rejects.toMatchObject({code:'compact-cache-size-cap'});
    await expect(store.putPin({padding:' '.repeat(131072)},{})).rejects.toMatchObject({code:'execution-pin-invalid'});
    expect(db.query).not.toHaveBeenCalled();
  });
  it('does not let the provider dispatch before a durable admission checkpoint acknowledgment', async () => {
    const db=database(); let acknowledge!: (value:{rows:Record<string,unknown>[]}) => void;
    db.query.mockImplementationOnce(() => new Promise(resolve => { acknowledge=resolve; }));
    const store=new PostgresExecutionStore({account,db}); const provider=vi.fn();
    const attempt=(async()=>{await store.checkpoint({...ownership,revision:0,ledger});provider();})();
    await vi.waitFor(()=>expect(db.query).toHaveBeenCalledTimes(2));
    expect(provider).not.toHaveBeenCalled();
    acknowledge({rows:[{result:{revision:1}}]}); await attempt; expect(provider).toHaveBeenCalledOnce();
  });
  it('latches ambiguous commit failure, never retries it, never dispatches provider or resets/refunds debt', async () => {
    const db=database(); const privateFailure=Object.assign(new Error('postgres://password@internal database error body'),{code:'08006',detail:'SQL and credential body'});
    db.query.mockRejectedValueOnce(privateFailure);
    const store=new PostgresExecutionStore({account,db}); const provider=vi.fn();
    const attempt=async()=>{await store.checkpoint({...ownership,revision:0,ledger});provider();};
    const error=await attempt().catch(e=>e);
    expect(error).toBeInstanceOf(ExecutionStoreError); expect(error.code).toBe('live-store-unavailable');
    expect(error.message).not.toContain('postgres'); expect(error.cause).toBeUndefined(); expect(JSON.stringify(error)).not.toContain('password');
    await expect(attempt()).rejects.toBe(error);
    await expect(store.claim(account,randomUUID(),150000)).rejects.toBe(error);
    await expect(store.release({...ownership,revision:0})).rejects.toBe(error);
    expect(db.query).toHaveBeenCalledTimes(2); expect(provider).not.toHaveBeenCalled();
  });
  it('sanitizes SQLSTATE/detail whitelists and latches stale-fence/revision writes', async () => {
    const db=database(); db.query.mockRejectedValueOnce({code:'P0001',detail:'live-ledger-changed',message:'private body'});
    const store=new PostgresExecutionStore({account,db});
    await expect(store.checkpoint({...ownership,revision:0,ledger})).rejects.toMatchObject({code:'live-ledger-changed',message:'Private Execution persistence is unavailable.'});
    await expect(store.readPool(account)).rejects.toMatchObject({code:'live-ledger-changed'});
    expect(db.query).toHaveBeenCalledTimes(2);
    const unknown=database(); unknown.query.mockRejectedValueOnce({code:'P0001',detail:'credential:SECRET'});
    await expect(new PostgresExecutionStore({account,db:unknown}).claim(account,owner,150000)).rejects.toMatchObject({code:'live-store-unavailable'});
  });
  it('prompt busy is a refusal, not an automatic queue/retry or ambiguous commit latch', async () => {
    const db=database(); db.query.mockRejectedValueOnce({code:'55P03',message:'raw lock query'});
    const store=new PostgresExecutionStore({account,db});
    await expect(store.claim(account,owner,150000)).rejects.toMatchObject({code:'live-account-busy'});
    expect(db.query).toHaveBeenCalledTimes(2);
    db.query.mockResolvedValueOnce({rows:[{result:claimResult()}]});
    expect(await store.claim(account,randomUUID(),150000)).toEqual(claimResult());
    expect(db.query).toHaveBeenCalledTimes(3);
  });
  it('fails closed on malformed/unsafe/incorrect monotonic DB acknowledgments', async () => {
    for(const value of [{revision:0},{revision:2},{revision:Number.MAX_SAFE_INTEGER+1},null]){
      const db=database([value]); const store=new PostgresExecutionStore({account,db});
      await expect(store.checkpoint({...ownership,revision:0,ledger})).rejects.toMatchObject({code:'live-store-unavailable'});
      await expect(store.claim(account,owner,150000)).rejects.toMatchObject({code:'live-store-unavailable'});
      expect(db.query).toHaveBeenCalledTimes(2);
    }
  });
  it('reads account-bound exact history/compact pools/pins on every access, no warm L1 authority', async () => {
    const key=account, id=randomUUID(), compact={key,version:'execution-statistical-3',at:1,observations:[]};
    const pin={base:{name:'Pokémon♀'},params:{metric:'dps'}}; const history='{ "previous":null }\r\n';
    const db=database([history,JSON.stringify(compact),JSON.stringify(compact),id,JSON.stringify(pin),null]);
    const store=new PostgresExecutionStore({account,db});
    expect(await store.readHistory(key)).toBe(history);
    expect(await store.readPool(key)).toEqual(compact); expect(await store.readPool(key)).toEqual(compact);
    expect(await store.putPin(pin.base,pin.params)).toBe(id); expect(await store.readPin(id)).toEqual(pin); expect(await store.readPin(id)).toBeNull();
    expect(db.query.mock.calls.filter(([sql])=>sql.includes('read_pool'))).toHaveLength(2);
    expect(db.query.mock.calls.every(([,values])=>values?.[0]===account)).toBe(true);
    expect(await store.readPin('browser-fabricated')).toBeNull(); expect(db.query).toHaveBeenCalledTimes(7);
  });
  it('publishes pool with required owner fence and bounded history with checkpoint, never raw table writes', async () => {
    const db=database([null,{revision:1}]); const store=new PostgresExecutionStore({account,db}); const pool={key:account,at:1};
    await store.savePool(pool,ownership);
    const history=[{sha256:account,bytes:'{ "previous":null }\n'}]; await store.checkpoint({...ownership,revision:0,ledger,history});
    expect(db.query.mock.calls[1]).toEqual(['select execution_v3.save_pool($1::text, $2::uuid, $3::bigint, $4::text, $5::text) as result',[account,owner,1,account,JSON.stringify(pool)]]);
    expect(db.query.mock.calls[2][1]?.[5]).toBe(JSON.stringify(history));
    expect(db.query.mock.calls.every(([sql])=>sql.startsWith('select execution_v3.'))).toBe(true);
  });
  it('bounds never-settling pool cleanup at five seconds without reopening or exposing errors', async () => {
    vi.useFakeTimers();
    try {
      const db=database(); db.end.mockImplementationOnce(()=>new Promise<void>(()=>{}));
      const store=new PostgresExecutionStore({account,db}); let settled=false;
      const result=store.close().catch(error=>error).then(error=>{settled=true;return error;});
      await vi.advanceTimersByTimeAsync(4999); expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({code:'live-store-unavailable',message:'Private Execution persistence is unavailable.'});
      await store.close(); expect(db.end).toHaveBeenCalledOnce();
      await expect(store.preflight()).rejects.toMatchObject({code:'live-store-unavailable'});
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('closes once and rejects subsequent use, including failure-safe cleanup without raw error', async () => {
    const db=database(); const store=new PostgresExecutionStore({account,db}); await store.close(); await store.close();
    expect(db.end).toHaveBeenCalledOnce(); await expect(store.preflight()).rejects.toMatchObject({code:'live-store-unavailable'});
    const failed=database(); failed.end.mockRejectedValueOnce(new Error('credential-body'));
    await expect(new PostgresExecutionStore({account,db:failed}).close()).rejects.toMatchObject({code:'live-store-unavailable'});
  });
});

describe('restricted PG runtime configuration',()=>{
  const connectionString='postgresql://execution_runtime:unit-only-password@db.example.test:5432/app';
  it('uses a two-connection pool, certificate-verifying TLS and bounded connect/query/statement timeouts',()=>{
    const config=executionPoolConfig({connectionString:connectionString+'?sslmode=verify-full',ca:'test-ca'});
    expect(config.ssl).toEqual({rejectUnauthorized:true,ca:'test-ca'}); expect(config.max).toBe(2);
    expect(config.connectionTimeoutMillis).toBe(3000); expect(config.query_timeout).toBe(5000); expect(config.statement_timeout).toBe(3000);
    expect(config.options).toContain('lock_timeout=250ms'); expect(config.connectionString).not.toContain('sslmode');
    expect(executionPoolConfig({connectionString}).ssl).toEqual({rejectUnauthorized:true});
  });
  it('rejects privileged/browser principals, JWT passwords, plaintext TLS overrides and URL option injection',()=>{
    for(const user of ['postgres','postgres.project','supabase_admin','service_role','anon','authenticated']){
      expect(()=>executionPoolConfig({connectionString:connectionString.replace('execution_runtime',user)})).toThrow(ExecutionStoreError);
    }
    for(const suffix of ['?sslmode=disable','?sslmode=no-verify','?ssl=true','?options=-c%20statement_timeout%3D0','?sslrootcert=secret']){
      expect(()=>executionPoolConfig({connectionString:connectionString+suffix})).toThrow(ExecutionStoreError);
    }
    expect(()=>executionPoolConfig({connectionString:connectionString.replace('unit-only-password','eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature')})).toThrow(ExecutionStoreError);
    expect(()=>executionPoolConfig({connectionString:'service-role-JWT-not-a-PG-URL'})).toThrow(ExecutionStoreError);
  });
  it('constructs a lazy private pool without opening a network connection',async()=>{
    const store=createPostgresExecutionStore({account,connectionString}); expect(store.account).toBe(account); await store.close();
  });
});
