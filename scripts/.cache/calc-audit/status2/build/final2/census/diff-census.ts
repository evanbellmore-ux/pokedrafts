// Integration 2: the census sample's reasons by family, main → 1a → 2 (int1a's diff-census.mjs is not in this checkout; this
// one also folds every Pokémon name, with its "(yours)" / "(opponent's)" / number suffix, into {Name}, using the runtimes'
// species names). Usage (repo root):
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/int2/census/diff-census.ts main.json 1a.json 2.json [--labels=main,1a,2]
import fs from "node:fs";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";

type Reason = { reason: string; n: number };
type Summary = { turns: number; ready: number; notEstimated: number; issues: number; endNotEstimated: number; turnReasons: Reason[]; endReasons: Reason[] };
type Out = { champions: Summary; scarletVioletRandomBattle: Summary };

(async () => {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const labels = (process.argv.find((a) => a.startsWith("--labels="))?.split("=")[1] ?? files.map((_, i) => `#${i}`).join(",")).split(",");
  const outs = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")) as Out);
  const names = new Set<string>();
  for (const game of ["champions", "scarlet_violet"] as const) {
    const runtime = await loadBattleRuntime(game);
    for (const species of runtime.speciesById.values()) names.add((species as unknown as { name: string }).name);
  }
  const sorted = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const nameRe = new RegExp(`(?:${sorted.join("|")})(?: \\((?:yours|opponent's|\\d)\\)| \\d)?(?=['’ .,:;)]|$)`, "g");
  const family = (reason: string) => reason.replace(nameRe, "{Name}");
  const fold = (list: Reason[]) => { const m = new Map<string, number>(); for (const r of list) m.set(family(r.reason), (m.get(family(r.reason)) ?? 0) + r.n); return m; };
  const pct = (s: Summary) => `${(s.notEstimated / s.turns * 100).toFixed(2)} %`;
  for (const [key, label] of [["champions", "Champions"], ["scarletVioletRandomBattle", "SV"]] as const) {
    const sums = outs.map((o) => o[key]);
    console.log(`\n== ${label}: ` + sums.map((s, i) => `${labels[i]} ready ${s.ready}, not estimated ${s.notEstimated} (${pct(s)}), end not estimated ${s.endNotEstimated}, issues ${s.issues}`).join("; "));
    for (const part of ["turnReasons", "endReasons"] as const) {
      const maps = sums.map((s) => fold(s[part]));
      const all = [...new Set(maps.flatMap((m) => [...m.keys()]))];
      all.sort((a, b) => (maps[maps.length - 1].get(b) ?? 0) - (maps[maps.length - 1].get(a) ?? 0) || (maps[0].get(b) ?? 0) - (maps[0].get(a) ?? 0) || a.localeCompare(b));
      console.log(`  ${part === "turnReasons" ? "turn" : "end"} reasons by family (${labels.join(" -> ")}):`);
      for (const reason of all) console.log(`    ${maps.map((m) => String(m.get(reason) ?? 0).padStart(4)).join(" -> ")}    ${reason}`);
    }
  }
})();
