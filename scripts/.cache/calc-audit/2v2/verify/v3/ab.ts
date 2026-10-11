// Track R-V: the oracle before wave 2's harness changes (sim-dfs-pre-r.ts, the snapshot) against the current sim-dfs.ts on the
// same cases, fresh runs both: byte-equal JSON (ms removed) for every case without a bench.
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v3/ab.ts [ids or prefixes...] [--all] [--shard=i/n]
import { CASES } from "../cases";
import { oracle as after } from "../sim-dfs";
import { oracle as before } from "../sim-dfs-pre-r";
const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));
const shard = args.find((a) => a.startsWith("--shard="))?.slice(8).split("/").map(Number);
const strip = (j: unknown) => JSON.stringify(j, (k, v) => (k === "ms" ? undefined : v));
let same = 0, diff = 0, failed = 0, seen = 0;
for (const c of CASES) {
  if (c.notEstimated) continue;
  if (ids.length && !ids.some((id) => c.id === id || c.id.startsWith(id))) continue;
  if (c.bench && Object.values(c.bench).some((b) => b?.members !== undefined)) continue;
  if (shard && seen++ % shard[1] !== shard[0]) continue;
  let a: string, b: string;
  try { a = strip(before(c)); } catch (e) { a = `ERROR ${(e as Error).message}`; }
  try { b = strip(after(c)); } catch (e) { b = `ERROR ${(e as Error).message}`; }
  if (a === b) same++;
  else if (a.startsWith("ERROR") && b.startsWith("ERROR")) { failed++; console.log(`${c.id}: both fail (${a.slice(0, 100)} | ${b.slice(0, 100)})`); }
  else { diff++; console.log(`${c.id}: DIFFERS (${a.slice(0, 80)} | ${b.slice(0, 80)})`); }
}
console.log(`${same} byte-equal, ${diff} differ, ${failed} fail both`);
