// Track V2 (status2 wave 1b): v1/run.ts for the wave 1b cases: runs cases on both sides and compares them (compare.ts
// compareCase, E2 included), with the owning track of each case (cases-wave1b.ts OWNER_1B, else wave 1a's) and a JSON report.
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v2/run.ts <id or prefix>... [--wave1b] [--shard=i/n] [--oracle] [--oracle-only] [--store] [--exact] [--quiet] [--report=name]
// --wave1b:      only the wave 1b cases (cases-wave1b.ts), with the ids/prefixes given as a further filter.
// --shard=i/n:   the i-th of n interleaved parts of the selection (parallel oracle runs).
// --oracle:      run the pinned Showdown oracle (sim-dfs.ts oracle()) and write results/<id>.json first; else the stored one is read.
// --oracle-only: only the oracle side (no app run).
// --store:       write the app side to verify/app-results/<id>.json (what compare.ts writes).
// --store-dir=d: write the app side to d/<id>.json instead (a new app-results set for changed-cases.ts diff).
// --compare-out=f: write f in results/compare.json's shape ({ id, status, ms, mismatches }) for gen-tests.ts --compare=f.
// --report=name: write verify/v1/reports/<name>.json ({ id, owner, status, reason, mismatches }).
import fs from "node:fs";
import path from "node:path";
import { CASES } from "../cases";
import { appTurn, APP_RESULTS_DIR, runtimeFor } from "../app-turn";
import { compareCase, loadRuntimes, readOracle } from "../compare";
import { oracle, RESULTS_DIR } from "../sim-dfs";
import { ownerOf } from "../cases-wave1a";
import { WAVE1B_CASES, ownerOf1b } from "../cases-wave1b";

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));
const runOracle = args.includes("--oracle") || args.includes("--oracle-only"), oracleOnly = args.includes("--oracle-only");
const store = args.includes("--store"), exact = args.includes("--exact"), quiet = args.includes("--quiet");
const reportName = args.find((a) => a.startsWith("--report="))?.split("=")[1];
const storeDir = args.find((a) => a.startsWith("--store-dir="))?.slice("--store-dir=".length);
const compareOut = args.find((a) => a.startsWith("--compare-out="))?.slice("--compare-out=".length);
if (storeDir) fs.mkdirSync(storeDir, { recursive: true });
const compared: { id: string; status: string; ms: number; mismatches: unknown[]; error?: string }[] = [];
const wave1b = args.includes("--wave1b");
const WAVE1B = new Set(WAVE1B_CASES.map((c) => c.id));
const shard = args.find((a) => a.startsWith("--shard="))?.slice("--shard=".length).split("/").map(Number);
const owner1b = (id: string) => (WAVE1B.has(id) ? ownerOf1b(id) : ownerOf(id));
type Row = { id: string; owner: string; status: string; reason?: string; endReason?: string; mismatches: string[]; error?: string };
(async () => {
  await loadRuntimes();
  const rows: Row[] = [];
  let bad = 0, total = 0, seen = 0;
  for (const c of CASES) {
    if (wave1b && !WAVE1B.has(c.id)) continue;
    if (ids.length && !ids.some((id) => (exact ? c.id === id : c.id === id || c.id.startsWith(id)))) continue;
    if (shard && seen++ % shard[1] !== shard[0]) continue;
    total++;
    const owner = owner1b(c.id);
    // --force: also a case with notEstimated (a stored case whose reason this build removes: changed-cases.ts).
    if (runOracle && (!c.notEstimated || args.includes("--force"))) {
      const t0 = Date.now();
      try {
        const r = oracle(c);
        fs.writeFileSync(path.join(RESULTS_DIR, `${c.id}.json`), JSON.stringify(r, null, 1));
        const runs = r.walks.all.runs + r.walks.lowest.runs + r.walks.highest.runs;
        if (!quiet || r.warnings.length) console.log(`${c.id}: oracle ${Date.now() - t0} ms, ${runs} runs${r.warnings.length ? ` warnings: ${r.warnings.join(" | ")}` : ""}`);
      } catch (error) {
        bad++;
        console.log(`${c.id}: ORACLE FAILED ${(error as Error).message.split("\n")[0]}`);
        rows.push({ id: c.id, owner, status: "oracle failed", mismatches: [], error: (error as Error).message.split("\n")[0] });
        continue;
      }
    }
    if (oracleOnly) continue;
    const app = await appTurn(c);
    if (store) fs.writeFileSync(path.join(APP_RESULTS_DIR, `${c.id}.json`), JSON.stringify(app, null, 1));
    if (storeDir) fs.writeFileSync(path.join(storeDir, `${c.id}.json`), JSON.stringify(app, null, 1));
    if (app.error) {
      compared.push({ id: c.id, status: "error", ms: app.ms, mismatches: [], error: app.error.split("\n")[0] });
      bad++;
      console.log(`${c.id} [${owner}]: APP ERROR ${app.error.split("\n").slice(0, 3).join(" | ")}`);
      rows.push({ id: c.id, owner, status: "app error", mismatches: [], error: app.error.split("\n")[0] });
      continue;
    }
    const runtime = await runtimeFor(c);
    const mismatches = compareCase(c, readOracle(c.id), app.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status", app.outcomes);
    compared.push({ id: c.id, status: app.result?.status ?? "none", ms: app.ms, mismatches });
    const status = app.result?.status === "not-estimated" ? `not-estimated (${app.result.reason})` : app.result?.status === "issues" ? `issues ${JSON.stringify(app.result.issues)}` : app.result?.status;
    const eot = app.result?.status === "ready" && app.result.endOfTurn.status === "not-estimated" ? app.result.endOfTurn.reason : undefined;
    const lines = mismatches.map((m) => `${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
    rows.push({
      id: c.id, owner, status: app.result?.status ?? "none",
      ...(app.result?.status === "not-estimated" ? { reason: app.result.reason } : {}), ...(eot ? { endReason: eot } : {}), mismatches: lines,
    });
    if (mismatches.length) {
      bad++;
      console.log(`${c.id} [${owner}]: ${status}${eot ? ` [end: ${eot}]` : ""}: ${mismatches.length} mismatches`);
      if (!quiet) for (const line of lines.slice(0, 12)) console.log(`   ${line}`);
    } else if (!quiet) console.log(`${c.id} [${owner}]: ${status}${eot ? ` [end: ${eot}]` : ""}: match`);
  }
  if (reportName) {
    const dir = path.resolve("scripts/.cache/calc-audit/2v2/verify/v2/reports");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${reportName}.json`), JSON.stringify(rows, null, 1));
  }
  if (compareOut) fs.writeFileSync(compareOut, JSON.stringify(compared, null, 1));
  console.log(`\n${total - bad}/${total} cases match.`);
})();
void APP_RESULTS_DIR;
