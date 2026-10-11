import type { ComparisonClient, CompareParams } from './contracts';

/** Generated, side-effect-free source-pinned comparison algorithm. */
export function buildComparison(client: ComparisonClient, params: CompareParams): Promise<unknown>;
