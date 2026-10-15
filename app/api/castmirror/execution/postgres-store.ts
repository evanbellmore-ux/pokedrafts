import 'server-only';
import pg from 'pg';
import type {
  ExecutionCheckpoint, ExecutionClaim, ExecutionOwnership, ExecutionPin, ExecutionRelease, ExecutionStore, SQLQueryable,
} from './store-types';
export type { ExecutionCheckpoint, ExecutionClaim, ExecutionHistory, ExecutionOwnership, ExecutionPin, ExecutionRelease, ExecutionStore, SQLQueryable } from './store-types';

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LEDGER_BYTES = 1024 * 1024;
const HISTORY_BYTES = 2 * LEDGER_BYTES;
const POOL_BYTES = 8 * LEDGER_BYTES;
const PIN_BYTES = 128 * 1024;
const RAID_REVIEW_BYTES = 2 * LEDGER_BYTES;
const SAFE_CODES = new Set([
  'live-account-unavailable', 'live-account-busy', 'live-lock-lost', 'live-ledger-changed',
  'live-ledger-invalid', 'live-ledger-full', 'live-archive-invalid', 'live-role-invalid',
  'live-store-unavailable', 'compact-cache-full', 'compact-cache-size-cap', 'compact-cache-invalid',
  'execution-pin-full', 'execution-pin-invalid', 'live-store-config-invalid',
]);

/** Deliberately contains no driver error, cause, SQL, credential, or input body. */
export class ExecutionStoreError extends Error {
  readonly code: string;
  constructor(code: string) {
    super('Private Execution persistence is unavailable.');
    this.name = 'ExecutionStoreError';
    this.code = SAFE_CODES.has(code) ? code : 'live-store-unavailable';
  }
}
function refused(code = 'live-ledger-invalid'): never { throw new ExecutionStoreError(code); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function integer(value: unknown, positive = false): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= (positive ? 1 : 0);
}
function exactText(value: unknown, maximum: number, code: string): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximum ||
    Buffer.from(value, 'utf8').toString('utf8') !== value) refused(code);
}
function jsonText(value: unknown, maximum: number, code: string): string {
  let text: string | undefined;
  try { text = JSON.stringify(value); } catch { refused(code); }
  exactText(text, maximum, code);
  return text;
}
function sanitized(error: unknown): ExecutionStoreError {
  if (error instanceof ExecutionStoreError) return error;
  if (record(error) || error instanceof Error) {
    const value = error as { code?: unknown; detail?: unknown };
    if (value.code === '55P03') return new ExecutionStoreError('live-account-busy');
    if (value.code === 'P0001' && typeof value.detail === 'string' && SAFE_CODES.has(value.detail)) {
      return new ExecutionStoreError(value.detail);
    }
  }
  return new ExecutionStoreError('live-store-unavailable');
}

// All SQL is static and parameterized; no identifier ever comes from an input.
const SQL = {
  preflight: 'select execution_v3.preflight($1::text) as result',
  claim: 'select execution_v3.claim($1::text, $2::uuid, $3::int) as result',
  checkpoint: 'select execution_v3.checkpoint($1::text, $2::uuid, $3::bigint, $4::bigint, $5::text, $6::jsonb) as result',
  release: 'select execution_v3.release($1::text, $2::uuid, $3::bigint, $4::bigint) as result',
  history: 'select execution_v3.read_history($1::text, $2::text) as result',
  pool: 'select execution_v3.read_pool($1::text, $2::text) as result',
  savePool: 'select execution_v3.save_pool($1::text, $2::uuid, $3::bigint, $4::text, $5::text) as result',
  putPin: 'select execution_v3.put_pin($1::text, $2::text) as result',
  pin: 'select execution_v3.read_pin($1::text, $2::uuid) as result',
  raidReview: 'select execution_v3.read_raid_review($1::text, $2::text) as result',
  saveRaidReview: 'select execution_v3.save_raid_review($1::text, $2::uuid, $3::bigint, $4::text, $5::text) as result',
} as const;

/** One bound account; the DB (not a warm process) is the sole authority. */
export class PostgresExecutionStore implements ExecutionStore {
  readonly account: string;
  private readonly db: SQLQueryable;
  private ready: Promise<void> | undefined;
  private failure: ExecutionStoreError | undefined;
  private closed = false;
  constructor({ account, db }: { account: string; db: SQLQueryable }) {
    if (!SHA256.test(account) || !db || typeof db.query !== 'function') refused('live-store-config-invalid');
    this.account = account;
    this.db = db;
  }
  async preflight(): Promise<void> {
    this.assertAvailable();
    this.ready ??= (async () => {
      try {
        const { rows } = await this.db.query(SQL.preflight, [this.account]);
        if (rows.length !== 1 || rows[0].result !== true) refused('live-role-invalid');
      } catch (error) {
        this.failure = sanitized(error);
        throw this.failure;
      }
    })();
    await this.ready;
    this.assertAvailable();
  }
  private assertAvailable(): void {
    if (this.failure) throw this.failure;
    if (this.closed) refused('live-store-unavailable');
  }
  private ownership(input: ExecutionOwnership): void {
    if (!input || input.account !== this.account || !UUID.test(input.owner) || !integer(input.fence, true)) refused('live-lock-lost');
  }
  private async rpc(sql: string, values: unknown[], accountWrite = false): Promise<unknown> {
    await this.preflight();
    try {
      const { rows } = await this.db.query(sql, values);
      if (rows.length !== 1 || !Object.hasOwn(rows[0], 'result')) refused('live-store-unavailable');
      return rows[0].result;
    } catch (error) {
      const safe = sanitized(error);
      // A timed-out/disconnected write may already have committed. Never replay
      // it or dispatch further work from this account handle after uncertainty.
      if (safe.code === 'live-store-unavailable' || (accountWrite && safe.code !== 'live-account-busy')) this.failure ??= safe;
      throw this.failure ?? safe;
    }
  }
  async claim(account: string, owner: string, leaseMs: number): Promise<ExecutionClaim> {
    if (account !== this.account || !UUID.test(owner) || !integer(leaseMs, true) || leaseMs > 150_000) refused('live-lock-lost');
    const value = await this.rpc(SQL.claim, [account, owner, leaseMs], true);
    if (!record(value) || !integer(value.revision) || !integer(value.fence, true) || !integer(value.leaseUntil, true)) {
      this.failure = new ExecutionStoreError('live-store-unavailable'); throw this.failure;
    }
    try { exactText(value.ledger, LEDGER_BYTES, 'live-ledger-invalid'); }
    catch { this.failure = new ExecutionStoreError('live-ledger-invalid'); throw this.failure; }
    return { ledger: value.ledger, revision: value.revision, fence: value.fence, leaseUntil: value.leaseUntil };
  }
  async checkpoint(input: ExecutionCheckpoint): Promise<{ revision: number }> {
    this.ownership(input);
    if (!integer(input.revision)) refused('live-ledger-changed');
    exactText(input.ledger, LEDGER_BYTES, 'live-ledger-full');
    if (input.history !== undefined && (!Array.isArray(input.history) || input.history.length > 1)) refused('live-archive-invalid');
    for (const segment of input.history ?? []) {
      if (!segment || !SHA256.test(segment.sha256)) refused('live-archive-invalid');
      exactText(segment.bytes, HISTORY_BYTES, 'live-archive-invalid');
    }
    const value = await this.rpc(SQL.checkpoint, [input.account, input.owner, input.fence, input.revision, input.ledger, JSON.stringify(input.history ?? [])], true);
    if (!record(value) || !integer(value.revision) || value.revision !== input.revision + 1) {
      this.failure = new ExecutionStoreError('live-store-unavailable'); throw this.failure;
    }
    return { revision: value.revision };
  }
  async release(input: ExecutionRelease): Promise<void> {
    this.ownership(input);
    if (!integer(input.revision)) refused('live-ledger-changed');
    await this.rpc(SQL.release, [input.account, input.owner, input.fence, input.revision], true);
  }
  async readHistory(sha256: string): Promise<string | null> {
    if (!SHA256.test(sha256)) refused('live-archive-invalid');
    const value = await this.rpc(SQL.history, [this.account, sha256]);
    if (value === null) return null;
    exactText(value, HISTORY_BYTES, 'live-archive-invalid');
    return value;
  }
  async readPool(key: string): Promise<Record<string, unknown> | null> {
    if (!SHA256.test(key)) refused('compact-cache-invalid');
    const text = await this.rpc(SQL.pool, [this.account, key]);
    if (text === null) return null;
    exactText(text, POOL_BYTES, 'compact-cache-invalid');
    try {
      const pool: unknown = JSON.parse(text);
      if (!record(pool) || pool.key !== key) refused('compact-cache-invalid');
      return pool;
    } catch { refused('compact-cache-invalid'); }
  }
  async savePool(pool: Record<string, unknown>, ownership?: ExecutionOwnership): Promise<void> {
    if (!ownership) refused('live-lock-lost');
    this.ownership(ownership);
    if (!record(pool) || typeof pool.key !== 'string' || !SHA256.test(pool.key)) refused('compact-cache-invalid');
    const text = jsonText(pool, POOL_BYTES, 'compact-cache-size-cap');
    await this.rpc(SQL.savePool, [this.account, ownership.owner, ownership.fence, pool.key, text], true);
  }
  async putPin(base: Record<string, unknown>, params: Record<string, unknown>): Promise<string> {
    if (!record(base) || !record(params)) refused('execution-pin-invalid');
    // The protected native binding supplies a verified, compact whitelist. This
    // method's JSON checks are bounds, not evidence that browser inputs are trusted.
    const text = jsonText({ base, params }, PIN_BYTES, 'execution-pin-invalid');
    const id = await this.rpc(SQL.putPin, [this.account, text]);
    if (typeof id !== 'string' || !UUID.test(id)) refused('execution-pin-invalid');
    return id;
  }
  async readRaidReview(key: string): Promise<Record<string, unknown> | null> {
    if (!SHA256.test(key)) refused('compact-cache-invalid');
    const text = await this.rpc(SQL.raidReview, [this.account, key]);
    if (text === null) return null;
    exactText(text, RAID_REVIEW_BYTES, 'compact-cache-invalid');
    try {
      const review: unknown = JSON.parse(text);
      if (!record(review) || review.key !== key || review.version !== 'raid-execution-review-1') refused('compact-cache-invalid');
      return review;
    } catch { refused('compact-cache-invalid'); }
  }
  async saveRaidReview(review: Record<string, unknown>, ownership?: ExecutionOwnership): Promise<void> {
    if (!ownership) refused('live-lock-lost');
    this.ownership(ownership);
    if (!record(review) || typeof review.key !== 'string' || !SHA256.test(review.key) || review.version !== 'raid-execution-review-1') refused('compact-cache-invalid');
    const text = jsonText(review, RAID_REVIEW_BYTES, 'compact-cache-size-cap');
    await this.rpc(SQL.saveRaidReview, [this.account, ownership.owner, ownership.fence, review.key, text], true);
  }
  async readPin(id: string): Promise<ExecutionPin | null> {
    if (!UUID.test(id)) return null;
    const text = await this.rpc(SQL.pin, [this.account, id]);
    if (text === null) return null;
    exactText(text, PIN_BYTES, 'execution-pin-invalid');
    try {
      const pin: unknown = JSON.parse(text);
      if (!record(pin) || !record(pin.base) || !record(pin.params)) refused('execution-pin-invalid');
      return { base: pin.base, params: pin.params };
    } catch { refused('execution-pin-invalid'); }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.db.end?.(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ExecutionStoreError('live-store-unavailable')), 5_000);
          timer.unref?.();
        }),
      ]);
    } catch { throw new ExecutionStoreError('live-store-unavailable'); }
    finally { if (timer) clearTimeout(timer); }
  }
}

export function executionPoolConfig({ connectionString, ca }: { connectionString: string; ca?: string }): pg.PoolConfig {
  let url: URL;
  try { url = new URL(connectionString); } catch { refused('live-store-config-invalid'); }
  let user: string, password: string;
  try { user = decodeURIComponent(url.username); password = decodeURIComponent(url.password); } catch { refused('live-store-config-invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !user || !password ||
    /^(?:postgres|supabase_admin|supabaseadmin|service_role|anon|authenticated)(?:[.@_-]|$)/i.test(user) ||
    /^[^.]+\.[^.]+\.[^.]+$/.test(password) || !url.pathname || url.pathname === '/') refused('live-store-config-invalid');
  for (const [key, value] of url.searchParams) {
    if (key !== 'sslmode' || value !== 'verify-full') refused('live-store-config-invalid');
  }
  // pg's connection-string SSL fields override ssl options. Remove the sole
  // accepted field so a supplied CA never gets silently lost during parsing.
  url.search = '';
  return {
    connectionString: url.toString(), ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    max: 2, connectionTimeoutMillis: 3_000, query_timeout: 5_000,
    statement_timeout: 3_000, idleTimeoutMillis: 10_000, allowExitOnIdle: true,
    options: '-c lock_timeout=250ms -c idle_in_transaction_session_timeout=5000',
    application_name: 'castmirror-execution-v3',
  };
}
/** Called only after the server feature gate is enabled; never uses REST/JWT. */
export function createPostgresExecutionStore({ account, connectionString = process.env.EXECUTION_DATABASE_URL, ca = process.env.EXECUTION_DATABASE_CA }: {
  account: string; connectionString?: string; ca?: string;
}): PostgresExecutionStore {
  if (!connectionString) refused('live-store-config-invalid');
  if (typeof window !== 'undefined') refused('live-store-config-invalid');
  const pool = new pg.Pool(executionPoolConfig({ connectionString, ca }));
  pool.on('error', () => { /* Do not log raw connection errors or credentials. */ });
  return new PostgresExecutionStore({ account, db: pool });
}
