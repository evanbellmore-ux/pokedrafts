import { createExecutionV3Handler } from './service';

export const runtime = 'nodejs';
export const maxDuration = 180;

const executionV3 = createExecutionV3Handler();

export async function GET(request: Request) {
  return executionV3(request);
}
