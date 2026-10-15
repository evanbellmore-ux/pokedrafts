import 'server-only';
import type { ComparisonClient } from '../../compare/contracts';
import { getNativeExecutionAccess, type NativeExecutionEnvironment } from '../runtime';
import type { RaidBudgetGrant, RaidReviewRuntime } from './collector';

export interface RaidRuntimeOptions {
  env?: NativeExecutionEnvironment;
  now?: () => number;
  signal?: AbortSignal;
}

/** The same private account, restricted login and durable quota ledger as A/B Execution. */
export async function openRaidReviewRuntime(request: Request, options: RaidRuntimeOptions = {}): Promise<RaidReviewRuntime | null> {
  const env = options.env ?? process.env;
  const access = getNativeExecutionAccess(request, env);
  if (!access) return null;
  options.signal?.throwIfAborted();
  const { createPostgresExecutionStore } = await import('../postgres-store');
  const store = createPostgresExecutionStore({ account: access.account, connectionString: env.EXECUTION_DATABASE_URL!, ca: env.EXECUTION_DATABASE_CA });
  try {
    await store.preflight();
    options.signal?.throwIfAborted();
    const [nativeBudget, provider] = await Promise.all([
      import('../../../../../vendor/castmirror/native/execution/live-budget.mjs'),
      import('../../../../../vendor/castmirror/native/wcl-client/wcl.mjs'),
    ]);
    options.signal?.throwIfAborted();
    const client = new provider.WclClient(env.WCL_CLIENT_ID!, env.WCL_CLIENT_SECRET!) as unknown as ComparisonClient;
    const createBudget = nativeBudget.createDurableLiveBudget as unknown as (options: {
      store: typeof store; account: string; now?: () => number; signal?: AbortSignal;
    }) => Promise<RaidBudgetGrant>;
    let closed = false;
    return {
      account: access.account, client,
      store: {
        readRaidReview: (key) => store.readRaidReview(key),
        saveRaidReview: (review, ownership) => store.saveRaidReview(review as unknown as Record<string, unknown>, ownership),
      },
      budgetFactory: async (budgetOptions) => {
        if (closed) throw new Error('Raid Execution is unavailable.');
        return await createBudget({ store, account: access.account,
          now: options.now ?? budgetOptions.now, signal: budgetOptions.signal ?? options.signal });
      },
      async close() { if (!closed) { closed = true; await store.close(); } },
    };
  } catch (error) {
    await store.close().catch(() => {});
    throw error;
  }
}
