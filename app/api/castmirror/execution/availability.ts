import type { RequestedExecutionContext } from '../compare/contracts';

export const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

const REASONS = [
  'No reachable durable native Execution backend is configured for this hosted service.',
  'Native quota accounting and retained comparison pins require shared durable state; this hosted adapter does not start collection.',
];

/** Stateless hosted availability only. Requested throughput context is not a
 * verified Execution scope. This helper does not query WCL, read/write files,
 * retain comparison pins, dispatch jobs, or invent benchmark metadata. */
export function getHostedExecutionAvailability(requestedContext: RequestedExecutionContext | null = null) {
  return {
    state: 'unsupported' as const,
    reason: 'Execution statistics are unavailable here until this site is connected.',
    reasons: [...REASONS],
    capabilities: { build: false as const, reference: false as const },
    scope: null,
    revision: null,
    coverage: null,
    job: null,
    updatedAt: null,
    requestedContext: requestedContext ? { ...requestedContext } : null,
  };
}
