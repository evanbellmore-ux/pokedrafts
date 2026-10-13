// Track F (SPEC2 §4.7, §10 risk 7): the golden-1v1 rows the Fling fix changes, by id, against the stored golden
// (2v2/verify/golden-1v1.full.json.gz): every differing row must be a Fling row, and nothing else of a case may change.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/fling/golden-diff.ts [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { corpus } from "./golden-corpus";

const FULL = "scripts/.cache/calc-audit/2v2/verify/golden-1v1.full.json.gz";
(async () => {
  const golden = JSON.parse(gunzipSync(readFileSync(process.env.GOLDEN_BEFORE ?? FULL)).toString("utf8")) as Record<string, string>;
  const cases = await corpus();
  const changed: { id: string; before: string; after: string }[] = [];
  const other: string[] = [];
  for (const c of cases) {
    const R = await loadBattleRuntime(c.game);
    const now = calculateMatchup(c.attacker, c.defender, c.field, c.contexts, R) as { results: { moveId: string }[] };
    const before = JSON.parse(golden[c.id]) as { results: { moveId: string }[] };
    if (JSON.stringify({ ...before, results: undefined }) !== JSON.stringify({ ...now, results: undefined })) other.push(`${c.id}: matchup fields`);
    if (before.results.length !== now.results.length) other.push(`${c.id}: ${before.results.length} -> ${now.results.length} rows`);
    for (let index = 0; index < Math.max(before.results.length, now.results.length); index++) {
      const a = JSON.stringify(before.results[index]), b = JSON.stringify(now.results[index]);
      if (a === b) continue;
      const moveId = now.results[index]?.moveId ?? before.results[index]?.moveId;
      if (moveId === "fling") changed.push({ id: `${c.id}|fling`, before: a, after: b });
      else other.push(`${c.id}|${moveId}`);
    }
  }
  for (const row of changed) console.log(row.id);
  console.log(`${changed.length} Fling rows changed; ${other.length} other differences${other.length ? `:\n  ${other.join("\n  ")}` : ""}`);
  const at = process.argv.indexOf("--json");
  if (at > 0) writeFileSync(process.argv[at + 1], JSON.stringify(changed, null, 1));
})();
