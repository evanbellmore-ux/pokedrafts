import { getHostedExecutionAvailability, NO_STORE_HEADERS } from '../availability';

// Unconditional: forwarded addresses, loopback origins, and request bodies
// cannot grant a capability that does not exist in this hosted deployment.
export function POST() {
  return Response.json({
    error: 'Execution build/refresh is disabled on the hosted service. Durable snapshots, authenticated maintenance, and workers are not configured.',
    ...getHostedExecutionAvailability(),
  }, { status: 403, headers: NO_STORE_HEADERS });
}
