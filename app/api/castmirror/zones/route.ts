// Cast Mirror zones API — raid zones (newest first, current tier first)
// with their encounter lists, for the page's raid selector.

import { getZones } from '../lib';

export const maxDuration = 30;

export async function GET() {
  try {
    const zones = await getZones();
    return Response.json({ zones, currentId: zones[0]?.id ?? 0 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
