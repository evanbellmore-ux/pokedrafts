import { getHostedExecutionAvailability, NO_STORE_HEADERS } from '../availability';

export function GET() {
  return Response.json({
    error: 'Hosted Execution benchmarks are unavailable. No verified snapshot or cross-instance comparison hydration is supported.',
    ...getHostedExecutionAvailability(),
  }, { status: 409, headers: NO_STORE_HEADERS });
}
