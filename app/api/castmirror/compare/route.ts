import { createCompareHandler } from './service';

export const maxDuration = 60;
export const runtime = 'nodejs';

// Preserve the ten-minute bounded cache for the lifetime of a warm instance;
// do not construct a new handler (and cache) for every GET.
const compare = createCompareHandler();

export async function GET(request: Request) {
  return compare(request);
}
