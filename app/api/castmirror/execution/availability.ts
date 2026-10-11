import type { RequestedExecutionContext } from '../compare/contracts';

export const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

const REASONS = [
  'The real 12.1 encounter catalogs are unsupported: reviewed mechanics and verified Execution benchmarks are not available.',
  'This hosted service has no durable benchmark snapshots, authenticated maintenance, or background workers; Execution builds and references are disabled.',
];

/** Stateless hosted availability only. Requested throughput context is not a
 * verified Execution scope. This helper does not query WCL, read/write files,
 * retain comparison pins, dispatch jobs, or invent benchmark metadata. */
export function getHostedExecutionAvailability(requestedContext: RequestedExecutionContext | null = null) {
  return {
    state: 'unsupported' as const,
    reason: 'Execution references are unavailable on the hosted service.',
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
