// Cast Mirror realms API — every realm name per region (us/eu/kr/tw),
// for the page's type-to-filter realm picker. Cached per warm instance.

import { wcl } from '../lib';

export const maxDuration = 30;

let realmsCache: Record<string, string[]> | null = null;

async function getRealms(): Promise<Record<string, string[]>> {
  if (realmsCache) return realmsCache;
  const rg = await wcl(`query { worldData { regions { id compactName } } }`);
  const out: Record<string, string[]> = {};
  for (const region of rg.worldData.regions ?? []) {
    const key = (region.compactName ?? '').toLowerCase();
    if (!key) continue;
    const names: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const sv = await wcl(
        `query($id: Int!, $page: Int!) {
           worldData { region(id: $id) { servers(limit: 100, page: $page) { data { name } last_page } } }
         }`, { id: region.id, page });
      const s = sv.worldData.region?.servers;
      for (const x of s?.data ?? []) if (x?.name) names.push(x.name);
      if (!s || page >= (s.last_page ?? 1)) break;
    }
    if (names.length) out[key] = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }
  realmsCache = out;
  return realmsCache;
}

export async function GET() {
  try {
    return Response.json({ realms: await getRealms() });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
