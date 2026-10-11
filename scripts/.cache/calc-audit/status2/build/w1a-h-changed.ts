// Track H (wave 1a): the stored cases Track H's change moves. Compares two app-results folders (step0a-run-app.ts output
// from the base and new copies of w1a-h-wire.mjs, ms removed), lists each case whose app result changed with the paths
// that changed, and compares each with its stored oracle result where one exists (compare.ts compareCase, E2 included).
// Run from the repo root (with the copy's tsconfig, so the comparison reads the same engine as the new folder):
//   TSX_TSCONFIG_PATH=scripts/.cache/calc-audit/status2/build/h-new/tsconfig.json npx --no-install tsx \
//     scripts/.cache/calc-audit/status2/build/w1a-h-changed.ts <base dir> <new dir>
import fs from "node:fs";
import path from "node:path";
import { CASES } from "../../2v2/verify/cases";
import { runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase, loadRuntimes, readOracle } from "../../2v2/verify/compare";

const [baseDir, newDir] = process.argv.slice(2).map((dir) => path.resolve(dir));
if (!baseDir || !newDir) throw new Error("usage: w1a-h-changed.ts <base dir> <new dir>");

/** The JSON paths where two values differ (the first few). */
function diffPaths(a: unknown, b: unknown, at = "", out: string[] = []): string[] {
  if (out.length >= 6) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const key of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) diffPaths((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${at}.${key}`, out);
  } else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    a.forEach((x, i) => diffPaths(x, b[i], `${at}[${i}]`, out));
  } else out.push(`${at}: ${JSON.stringify(a)?.slice(0, 140)} → ${JSON.stringify(b)?.slice(0, 140)}`);
  return out;
}

(async () => {
  await loadRuntimes();
  let changed = 0, agree = 0, disagree = 0, noOracle = 0;
  for (const c of CASES) {
    const file = `${c.id}.json`;
    const pa = path.join(baseDir, file), pb = path.join(newDir, file);
    if (!fs.existsSync(pa) || !fs.existsSync(pb)) continue;
    const x = JSON.parse(fs.readFileSync(pa, "utf8")), y = JSON.parse(fs.readFileSync(pb, "utf8"));
    delete x.ms; delete y.ms;
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    changed++;
    const status = (r: { result?: { status?: string; reason?: string } | null }) => `${r.result?.status}${r.result?.reason ? ` (${r.result.reason})` : ""}`;
    console.log(`${c.id}: ${status(x)} → ${status(y)}`);
    for (const line of diffPaths(x, y)) console.log(`   ${line}`);
    const oracle = readOracle(c.id);
    if (!oracle && !c.notEstimated) { noOracle++; console.log("   (no stored oracle result)"); continue; }
    const runtime = await runtimeFor(c);
    const mismatches = compareCase(c, oracle, y.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status", y.outcomes);
    if (mismatches.length) { disagree++; for (const m of mismatches.slice(0, 8)) console.log(`   ✗ ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}`); }
    else { agree++; console.log("   ✓ agrees with the oracle"); }
  }
  console.log(`\n${changed} changed: ${agree} agree with the stored oracle, ${disagree} do not, ${noOracle} have no stored oracle result.`);
})();
