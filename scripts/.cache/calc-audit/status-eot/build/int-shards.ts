// Integration: split every oracle case into N shards balanced by its stored run time (results/<id>.json walks ms), for
// parallel sim-dfs.ts runs. Usage: npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/int-shards.ts <N> <outDir>
import fs from "node:fs";
import path from "node:path";
import { CASES } from "../../2v2/verify/cases";

const [n = "8", out = "scripts/.cache/calc-audit/status-eot/build/int-shards"] = process.argv.slice(2);
const results = path.resolve("scripts/.cache/calc-audit/2v2/verify/results");
const cost = (id: string) => {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(results, `${id}.json`), "utf8"));
    return Object.values(r.walks as Record<string, { ms: number }>).reduce((sum, w) => sum + (w.ms || 0), 0) || 50;
  } catch { return 50; }
};
const ids = CASES.filter((c) => !c.notEstimated).map((c) => ({ id: c.id, ms: cost(c.id) })).sort((a, b) => b.ms - a.ms);
const shards = Array.from({ length: Number(n) }, () => ({ ms: 0, ids: [] as string[] }));
for (const each of ids) {
  const least = shards.reduce((a, b) => (b.ms < a.ms ? b : a));
  least.ids.push(each.id);
  least.ms += each.ms;
}
fs.mkdirSync(out, { recursive: true });
shards.forEach((shard, i) => fs.writeFileSync(path.join(out, `shard-${i}.txt`), shard.ids.join(" ")));
console.log(`${ids.length} cases in ${n} shards: ${shards.map((s) => `${s.ids.length} (${(s.ms / 1000).toFixed(0)} s)`).join(", ")}`);
