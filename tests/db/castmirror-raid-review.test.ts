import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { PostgresExecutionStore } from '../../app/api/castmirror/execution/postgres-store';
import { RAID_REVIEW_RULES_VERSION } from '../../app/api/castmirror/execution/raid/collector';
import { connect, expectRpcError, expectSqlState, type Client } from './harness';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
async function rpc<T = unknown>(db: Client, fn: string, args: unknown[]): Promise<T> {
  const { rows } = await db.query(`select execution_v3.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args);
  return rows[0].result as T;
}
function review(key = hash(randomUUID())) {
  return { version: 'raid-execution-review-1', key, at: Date.now(), rulesVersion: RAID_REVIEW_RULES_VERSION,
    identity: { name: 'Pokémon♀', server: "Mal'Ganis", region: 'US', className: 'Priest' },
    scope: { zone: 53, encounter: 3470, difficulty: 5, size: 20, partition: 2, patch: '12.1.5' },
    boss: { id: 3470, name: "Nek'zali" }, status: 'complete', reason: null, availableKills: 0, fights: [], sampleLimit: 6 };
}

describe('private raid Execution review cache', () => {
  let admin: Client, runtime: Client;
  const login = `raid_review_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    admin = await connect();
    await admin.query(`create role ${login} login inherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication password 'embedded-only'`);
    await admin.query(`grant execution_v3_executor to ${login}`);
    runtime = new pg.Client({ host: '127.0.0.1', port: inject('dbPort'), database: inject('dbName'), user: login, password: 'embedded-only' });
    await runtime.connect();
  });
  afterAll(async () => { await runtime?.end(); await admin?.query(`drop role if exists ${login}`); await admin?.end(); });
  async function seed() {
    const account = hash(randomUUID());
    const ledger = JSON.stringify({ version: 'execution-v3-live-account-1', updatedAt: Date.now(), jobs: [], windows: [] }) + '\r\n';
    await rpc(admin, 'seed_account', [account, ledger, '[]']);
    await admin.query('update execution_v3.accounts set enabled=true where account=$1', [account]);
    const owner = randomUUID();
    const c = await rpc<{ fence: number; revision: number }>(runtime, 'claim', [account, owner, 150000]);
    return { account, owner, ...c, ledger };
  }
  it('round-trips exact bytes and retains fixed expiry, fencing and accounting', async () => {
    const c = await seed(), p = review(), bytes = JSON.stringify(p, null, 1) + '\r\n';
    expect(await rpc(runtime, 'preflight', [c.account])).toBe(true);
    await rpc(runtime, 'save_raid_review', [c.account, c.owner, c.fence, p.key, bytes]);
    expect(await rpc(runtime, 'read_raid_review', [c.account, p.key])).toBe(bytes);
    const before = await admin.query('select created_at,expires_at,writer_owner,writer_fence from execution_v3.raid_reviews where account=$1', [c.account]);
    expect(Number(before.rows[0].expires_at) - Number(before.rows[0].created_at)).toBe(600000);
    p.at = Date.now();
    await rpc(runtime, 'save_raid_review', [c.account, c.owner, c.fence, p.key, JSON.stringify(p)]);
    const after = await admin.query('select created_at,expires_at,writer_owner,writer_fence from execution_v3.raid_reviews where account=$1', [c.account]);
    expect(after.rows).toEqual(before.rows);
    const account = await admin.query("select convert_from(ledger_bytes,'UTF8') bytes,revision from execution_v3.accounts where account=$1", [c.account]);
    expect(account.rows[0]).toEqual({ bytes: c.ledger, revision: '0' });
    await rpc(runtime, 'release', [c.account, c.owner, c.fence, c.revision]);
    expect(await rpc(runtime, 'read_raid_review', [c.account, p.key])).toBe(JSON.stringify(p));
  });
  it('isolates accounts and expires reads without extending the lifetime', async () => {
    const a = await seed(), b = await seed(), p = review();
    await rpc(runtime, 'save_raid_review', [a.account, a.owner, a.fence, p.key, JSON.stringify(p)]);
    expect(await rpc(runtime, 'read_raid_review', [b.account, p.key])).toBeNull();
    await admin.query('update execution_v3.raid_reviews set created_at=0,expires_at=600000 where account=$1', [a.account]);
    expect(await rpc(runtime, 'read_raid_review', [a.account, p.key])).toBeNull();
  });
  it('rejects stale writers after a new fenced acquisition', async () => {
    const c = await seed(), p = review();
    await rpc(runtime, 'release', [c.account, c.owner, c.fence, c.revision]);
    const owner = randomUUID();
    const newer = await rpc<{ fence: number }>(runtime, 'claim', [c.account, owner, 150000]);
    expect(newer.fence).toBe(c.fence + 1);
    await expectRpcError(rpc(runtime, 'save_raid_review', [c.account, c.owner, c.fence, p.key, JSON.stringify(p)]), 'live-lock-lost');
    expect(await rpc(runtime, 'read_raid_review', [c.account, p.key])).toBeNull();
  });
  it('refuses incompatible, malformed, oversize and stale payloads without a write', async () => {
    const c = await seed(), p = review();
    for (const payload of [
      { ...p, version: 'raid-execution-review-2' }, { ...p, rulesVersion: 'native-live-statistics-5' },
      { ...p, sampleLimit: 7 }, { ...p, scope: { ...p.scope, encounter: 0 } },
      { ...p, boss: { ...p.boss, id: 3445 } }, { ...p, fights: [null] }, { ...p, fights: {} },
      { ...p, at: Date.now() - 600001 }, { ...p, at: Date.now() + 11000 },
    ]) await expectRpcError(rpc(runtime, 'save_raid_review', [c.account, c.owner, c.fence, p.key, JSON.stringify(payload)]), 'compact-cache-invalid');
    await expectRpcError(rpc(runtime, 'save_raid_review', [c.account, c.owner, c.fence, p.key, '{x']), 'compact-cache-invalid');
    await expectRpcError(rpc(runtime, 'save_raid_review', [c.account, c.owner, c.fence, p.key, 'x'.repeat(2097153)]), 'compact-cache-size-cap');
    expect(await rpc(runtime, 'read_raid_review', [c.account, p.key])).toBeNull();
  });
  it('caps each account at 64 entries while allowing same-key updates and expired replacement', async () => {
    const c = await seed();
    for (let i = 0; i < 64; i++) { const p = review(hash(String(i))); await rpc(runtime, 'save_raid_review', [c.account, c.owner, c.fence, p.key, JSON.stringify(p)]); }
    const p = review();
    await expectRpcError(rpc(runtime, 'save_raid_review', [c.account, c.owner, c.fence, p.key, JSON.stringify(p)]), 'compact-cache-full');
    const same = review(hash('0'));
    await rpc(runtime, 'save_raid_review', [c.account, c.owner, c.fence, same.key, JSON.stringify(same)]);
    await admin.query('update execution_v3.raid_reviews set created_at=0,expires_at=600000 where account=$1 and key=$2', [c.account, hash('1')]);
    await rpc(runtime, 'save_raid_review', [c.account, c.owner, c.fence, p.key, JSON.stringify(p)]);
    const count = await admin.query('select count(*)::int n from execution_v3.raid_reviews where account=$1', [c.account]);
    expect(count.rows[0].n).toBe(64);
  });
  it('denies raw access and browser/service roles access to both new private RPCs', async () => {
    const c = await seed(), p = review();
    await expectSqlState(runtime.query('select * from execution_v3.raid_reviews'), '42501');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const db = await connect();
      try {
        await db.query(`set role ${role}`);
        await expectSqlState(rpc(db, 'read_raid_review', [c.account, p.key]), '42501');
        await expectSqlState(rpc(db, 'save_raid_review', [c.account, c.owner, c.fence, p.key, JSON.stringify(p)]), '42501');
        await expectSqlState(db.query('select * from execution_v3.raid_reviews'), '42501');
      } finally { await db.end(); }
    }
  });
  it('the actual store saves, reloads and releases without latching a failure', async () => {
    const c = await seed(), p = review();
    const store = new PostgresExecutionStore({ account: c.account, db: { query: (text, values) => runtime.query(text, values) } });
    await store.saveRaidReview(p, { account: c.account, owner: c.owner, fence: c.fence });
    expect(await store.readRaidReview(p.key)).toEqual(p);
    await store.release({ account: c.account, owner: c.owner, fence: c.fence, revision: c.revision });
    const row = await admin.query("select lease_until,convert_from(ledger_bytes,'UTF8') ledger from execution_v3.accounts where account=$1", [c.account]);
    expect(row.rows[0]).toEqual({ lease_until: '0', ledger: c.ledger });
  });
});
