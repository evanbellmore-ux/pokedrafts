// This module is used only by Node route handlers. No environment value or
// credential is included in a status, cache key returned to a client, or error.
import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { ComparisonClient } from '../compare/contracts';
import type { ExecutionStore } from './store-types';
import {
  COMPARISON_ID_PATTERN, createComparisonPin, freezePin, isRecord, realmKey, sameRealm, validateRankingScope,
  type CompareExecutionBinder, type PinnedComparison, type PinnedParams,
} from './pins';

export interface NativeExecutionEnvironment extends Record<string, string | undefined> {
  EXECUTION_DATABASE_URL?: string;
  EXECUTION_DATABASE_CA?: string;
  EXECUTION_NATIVE_ENABLED?: string;
  EXECUTION_RUNTIME_VERIFIED?: string;
  EXECUTION_VERIFY_TOKEN?: string;
  WCL_CLIENT_ID?: string;
  WCL_CLIENT_SECRET?: string;
}
export interface NativeExecutionStore extends ExecutionStore { preflight(): Promise<void>; close(): Promise<void> }
export interface NativeExecutionAccess { readonly mode: 'public' | 'verification'; readonly account: string }
export interface NativeCompareOptions { piPolicy: 'Any' | 'Exclude'; waitForInflight: false; signal?: AbortSignal }
interface BudgetOptions { now?: () => number; signal?: AbortSignal; isForegroundBusy?: () => boolean }
export interface NativeExecutionModules {
  WclClient: new (id: string, secret: string) => unknown;
  LiveExecutionService: new (options: {
    client: () => unknown; store: ExecutionStore; budgetFactory: (options: BudgetOptions) => Promise<unknown>;
    now?: () => number; onAccountingFailure?: () => void;
  }) => { compare(base: PinnedComparison, params: PinnedParams, options: NativeCompareOptions): Promise<unknown> };
  createDurableLiveBudget(options: BudgetOptions & { store: ExecutionStore; account: string }): Promise<unknown>;
  resolveScope(client: ComparisonClient, request: Record<string, unknown>): Promise<unknown>;
}
export interface NativeExecutionRuntime {
  readonly account: string;
  readonly store: NativeExecutionStore;
  resolveScope(client: ComparisonClient, request: Record<string, unknown>): Promise<unknown>;
  compare(base: PinnedComparison, params: PinnedParams, options: NativeCompareOptions): Promise<unknown>;
  close(): Promise<void>;
}
export interface NativeRuntimeOptions {
  env?: NativeExecutionEnvironment;
  signal?: AbortSignal;
  now?: () => number;
  createStore?: (options: { account: string; connectionString: string; ca?: string }) => NativeExecutionStore | Promise<NativeExecutionStore>;
  loadModules?: () => Promise<NativeExecutionModules>;
}

/** Fixed-length digests make comparison constant-time even for wrong lengths.
 * The verification token is accepted only in a private Authorization header. */
function verifiedBearer(request: Request, token: string | undefined): boolean {
  if (!token || token.length > 1024 || /[\s\u0000-\u001f\u007f]/u.test(token)) return false;
  const authorization = request.headers.get('authorization');
  if (!authorization || authorization.length > 1031 || !/^Bearer [^\s,]+$/.test(authorization)) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(authorization.slice(7)), digest(token));
}

/** Pure gate: missing/unverified configuration does not import a provider,
 * create a pool, query WCL/Postgres, read the filesystem, or create fallback state. */
export function getNativeExecutionAccess(request: Request, env: NativeExecutionEnvironment = process.env): NativeExecutionAccess | null {
  if (typeof window !== 'undefined' || env.EXECUTION_RUNTIME_VERIFIED !== '1' || !env.EXECUTION_DATABASE_URL
    || !env.WCL_CLIENT_ID || !env.WCL_CLIENT_SECRET) return null;
  const mode = env.EXECUTION_NATIVE_ENABLED === '1' ? 'public' : verifiedBearer(request, env.EXECUTION_VERIFY_TOKEN) ? 'verification' : null;
  if (!mode) return null;
  return { mode, account: createHash('sha256').update('wcl-client:' + env.WCL_CLIENT_ID).digest('hex') };
}

async function loadNativeModules(): Promise<NativeExecutionModules> {
  const [live, budget, source, wcl] = await Promise.all([
    import('../../../../vendor/castmirror/native/execution/live.mjs'),
    import('../../../../vendor/castmirror/native/execution/live-budget.mjs'),
    import('../../../../vendor/castmirror/native/execution/source.mjs'),
    import('../../../../vendor/castmirror/native/wcl-client/wcl.mjs'),
  ]);
  return { LiveExecutionService: live.LiveExecutionService, createDurableLiveBudget: budget.createDurableLiveBudget,
    resolveScope: source.resolveScope, WclClient: wcl.WclClient } as unknown as NativeExecutionModules;
}

/** The enabled, imported account and nonprivileged DB login are checked BEFORE
 * native collection. Failed/ambiguous operations are never replayed elsewhere. */
export async function openNativeExecutionRuntime(request: Request, options: NativeRuntimeOptions = {}): Promise<NativeExecutionRuntime | null> {
  const env = options.env ?? process.env;
  const access = getNativeExecutionAccess(request, env);
  if (!access) return null;
  options.signal?.throwIfAborted();
  const createStore = options.createStore ?? (await import('./postgres-store')).createPostgresExecutionStore;
  options.signal?.throwIfAborted();
  const store = await createStore({ account: access.account, connectionString: env.EXECUTION_DATABASE_URL!, ca: env.EXECUTION_DATABASE_CA });
  try {
    await store.preflight();
    options.signal?.throwIfAborted();
    const modules = await (options.loadModules ?? loadNativeModules)();
    options.signal?.throwIfAborted();
    let client: unknown;
    let service: InstanceType<NativeExecutionModules['LiveExecutionService']> | undefined;
    let closed = false;
    return {
      account: access.account, store,
      resolveScope: (queryClient, scope) => modules.resolveScope(queryClient, scope),
      compare(base, params, compareOptions) {
        if (closed) return Promise.reject(new Error('Native Execution is unavailable.'));
        service ??= new modules.LiveExecutionService({
          // Use the native async attempt/byte observers, NEVER hosted wcl()'s
          // independent three-round retry transport beneath a durable budget.
          client: () => client ??= new modules.WclClient(env.WCL_CLIENT_ID!, env.WCL_CLIENT_SECRET!), store, now: options.now,
          budgetFactory: (budgetOptions) => modules.createDurableLiveBudget({
            ...budgetOptions, store, account: access.account, now: options.now ?? budgetOptions.now,
            signal: budgetOptions.signal ?? compareOptions.signal ?? options.signal,
          }),
          onAccountingFailure: () => { /* No raw native/driver diagnostic in a hosted response or log. */ },
        });
        return service.compare(base, params, { ...compareOptions, waitForInflight: false });
      },
      async close() { if (!closed) { closed = true; await store.close(); } },
    };
  } catch (error) {
    await store.close().catch(() => {});
    throw error;
  }
}

interface CharacterProof { variables: Record<string, unknown>; rows: Array<{ code: string; fightID: number; spec: unknown; partition: unknown }> }
interface WorldProof { variables: Record<string, unknown>; rows: Array<{ code: string; fightID: number; name: string; server: string; partition: unknown }> }
const defaultRanking = (document: string, field: string) => {
  const argumentsText = new RegExp(`\\b${field}\\s*\\(([^)]*)\\)`).exec(document)?.[1];
  return argumentsText !== undefined && !/\b(?:partition|size)\s*:/.test(argumentsText);
};
const partitionMatches = (partition: unknown, expected: number) => partition === undefined || partition === null || partition === expected;

export interface HostedBinderOptions extends NativeRuntimeOptions { deadlineAt: number }
/** Request-local observer records only already validated server replies. The
 * extra metadata query is optional, bounded by the SAME throughput invocation. */
export function createHostedComparisonBinder(request: Request, options: HostedBinderOptions): CompareExecutionBinder | null {
  const access = getNativeExecutionAccess(request, options.env ?? process.env);
  if (!access) return null;
  const now = options.now ?? Date.now;
  const characters: CharacterProof[] = [], worlds: WorldProof[] = [];
  return {
    // A private verification result must never warm the public/off-mode cache.
    cacheKey: `${access.mode}:${access.account}`,
    observe(document, variables, data) {
      if (!isRecord(data)) return;
      if (characters.length < 4 && document.includes('characterData') && defaultRanking(document, 'encounterRankings')) {
        const ch = isRecord(data.characterData) ? data.characterData.character : null;
        const rankings = isRecord(ch) ? ch.encounterRankings : null;
        if (isRecord(rankings) && Array.isArray(rankings.ranks)) {
          const rows: CharacterProof['rows'] = [];
          for (const row of rankings.ranks.slice(0, 10_000)) {
            if (isRecord(row) && isRecord(row.report) && typeof row.report.code === 'string' && /^[A-Za-z0-9]{16}$/.test(row.report.code)
              && typeof row.report.fightID === 'number' && Number.isSafeInteger(row.report.fightID)) {
              rows.push({ code: row.report.code, fightID: row.report.fightID, spec: row.spec, partition: row.partition ?? row.partitionID });
            }
          }
          characters.push({ variables: { ...variables }, rows });
        }
      }
      if (worlds.length < 12 && document.includes('worldData') && defaultRanking(document, 'characterRankings')) {
        const encounter = isRecord(data.worldData) ? data.worldData.encounter : null;
        const rankings = isRecord(encounter) ? encounter.characterRankings : null;
        if (isRecord(rankings) && Array.isArray(rankings.rankings)) {
          const rows: WorldProof['rows'] = [];
          for (const row of rankings.rankings.slice(0, 100)) {
            const server = isRecord(row) && isRecord(row.server) ? row.server.name : null;
            if (isRecord(row) && isRecord(row.report) && typeof row.report.code === 'string' && /^[A-Za-z0-9]{16}$/.test(row.report.code)
              && typeof row.report.fightID === 'number' && Number.isSafeInteger(row.report.fightID) && typeof row.name === 'string' && typeof server === 'string') {
              rows.push({ code: row.report.code, fightID: row.report.fightID, name: row.name, server, partition: row.partition ?? row.partitionID });
            }
          }
          worlds.push({ variables: { ...variables }, rows });
        }
      }
    },
    async bind(comparison, params, client, signal) {
      signal.throwIfAborted();
      // DB calls settle under their provider timeouts. Do not start a new one at
      // the edge of 55 seconds or detach/replay a potentially committed write.
      // Connect/preflight (3s + 5s), pin RPC (5s), and close (5s) are
      // bounded independently. Leave margin rather than rely on instant cleanup.
      if (now() + 20_000 >= options.deadlineAt) return null;
      const pin = createComparisonPin(comparison, params);
      const runtime = await openNativeExecutionRuntime(request, { ...options, signal });
      if (!runtime) return null;
      try {
        signal.throwIfAborted();
        try {
          if (now() + 11_000 >= options.deadlineAt) return null;
          const scope = validateRankingScope(await runtime.resolveScope(client, {
            zone: pin.base.a.scope.zone, encounter: pin.base.encounter.id, difficulty: pin.base.difficulty,
          }), pin.base);
          pin.params.executionRankingScope = scope;
          pin.params.executionCurrentPartition = characters.some(({ variables: v, rows }) =>
            v.enc === params.encounter && v.diff === params.difficulty && v.metric === params.metric
            && typeof v.name === 'string' && v.name.trim().toLowerCase() === params.name.trim().toLowerCase()
            && v.slug === realmKey(params.server) && v.region === params.region
            && rows.some((row) => row.code === pin.base.a.code && row.fightID === pin.base.a.fightID && row.spec === pin.base.spec
              && partitionMatches(row.partition, scope.partition)));
          pin.params.executionReferenceCurrentPartition = worlds.some(({ variables: v, rows }) =>
            v.enc === params.encounter && v.diff === params.difficulty && v.metric === params.metric && v.cls === pin.base.className && v.spec === pin.base.spec
            && rows.some((row) => row.code === pin.base.b.code && row.fightID === pin.base.b.fightID
              && row.name.trim().toLowerCase() === pin.base.b.name.trim().toLowerCase() && sameRealm(row.server, pin.base.b.server)
              && partitionMatches(row.partition, scope.partition)));
        } catch {
          // Historic or unverified ranking scope stays unknown. Native collection
          // may expose independent measurements, never a fabricated current cohort.
          delete pin.params.executionRankingScope;
          pin.params.executionCurrentPartition = false;
          pin.params.executionReferenceCurrentPartition = false;
        }
        signal.throwIfAborted();
        if (now() + 11_000 >= options.deadlineAt) return null;
        freezePin(pin);
        const createdAt = now(); // Conservative fixed anchor BEFORE the DB mints it.
        const comparisonID = await runtime.store.putPin(pin.base, pin.params);
        signal.throwIfAborted();
        if (!COMPARISON_ID_PATTERN.test(comparisonID)) return null;
        return { comparisonID, createdAt };
      } finally { await runtime.close(); }
    },
  };
}
