import { InputError, parseExecutionRequest } from '../../compare/contracts';
import { getHostedExecutionAvailability, NO_STORE_HEADERS } from '../availability';

export function GET(request: Request) {
  try {
    const requestedContext = parseExecutionRequest(request);
    return Response.json(getHostedExecutionAvailability(requestedContext), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : 'Invalid Execution status request.' }, {
      status: 400, headers: NO_STORE_HEADERS,
    });
  }
}
