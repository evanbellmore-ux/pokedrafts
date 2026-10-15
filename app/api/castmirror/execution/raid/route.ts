import { createRaidExecutionHandler } from './service';

export const runtime = 'nodejs';
export const maxDuration = 180;
const raidExecution = createRaidExecutionHandler();
export async function POST(request: Request) { return raidExecution(request); }
