// Track V1 (status2 wave 1a): re-runs stored cases' oracle with this harness and compares each with its stored result as
// regress.mjs does (the status-eot and status2 additions, ms and the walk bookkeeping stripped), so a harness change is
// shown not to move a stored result.
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v1/rerun.ts <id>... [--out=dir]
import fs from "node:fs";
import path from "node:path";
import { CASES } from "../cases";
import { oracle, RESULTS_DIR } from "../sim-dfs";

const SLOT_EXTRA = ["status", "volatiles", "boosts", "item", "sub", "timesAttacked", "perish", "sleepTime", "toxicStage", "swapped", "switchFlag",
  "types", "ability", "forme", "stored", "weight", "stockpile", "lastItem", "durations", "pendingCopy", "berryLocked"];
const STEP_EXTRA = ["effects", "change", "sides", "moveChange", "selfHit"];
const WALK_EXTRA = ["ms", "afterTurn", "swapped", "sideConditions", "noMove", "runs", "classes", "decisions"];
const TOP_EXTRA = ["afterTurn", "residuals", "hidden"];
export function strip(r: any, keepExtra = false) {
  const out = structuredClone(r);
  if (!keepExtra) for (const key of TOP_EXTRA) delete out[key];
  out.warnings = (out.warnings ?? []).filter((w: string) => !w.startsWith("validate "));
  for (const walk of Object.values(out.walks ?? {}) as any[]) {
    for (const key of WALK_EXTRA) if (!keepExtra || ["ms", "runs", "classes", "decisions"].includes(key)) delete walk[key];
    if (keepExtra && walk.afterTurn) { delete walk.afterTurn.ms; delete walk.afterTurn.runs; delete walk.afterTurn.classes; delete walk.afterTurn.decisions; }
    const slotsOf = [walk.slots, ...(keepExtra && walk.afterTurn ? [walk.afterTurn.slots] : [])];
    for (const slots of slotsOf) for (const slot of Object.values(slots ?? {}) as any[]) for (const key of keepExtra ? SLOT_EXTRA.slice(11) : SLOT_EXTRA) delete slot[key];
    if (keepExtra && walk.afterTurn) { delete walk.afterTurn.pseudo; delete walk.afterTurn.sides; delete walk.afterTurn.benchCured; }
    for (const step of Object.values(walk.steps ?? {}) as any[]) {
      if (!keepExtra) for (const key of STEP_EXTRA) delete step[key];
      if (!keepExtra) for (const hit of Object.values(step.hits ?? {}) as any[]) delete hit.sub;
    }
  }
  return JSON.stringify(out);
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("v1/rerun.ts")) {
  const args = process.argv.slice(2);
  const ids = args.filter((a) => !a.startsWith("--"));
  const dir = path.resolve(args.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "scripts/.cache/calc-audit/2v2/verify/v1/rerun");
  fs.mkdirSync(dir, { recursive: true });
  let same = 0, full = 0, bad = 0;
  for (const id of ids) {
    const c = CASES.find((x) => x.id === id);
    if (!c) { console.log(`${id}: no such case`); bad++; continue; }
    const file = path.join(RESULTS_DIR, `${id}.json`);
    if (!fs.existsSync(file)) { console.log(`${id}: no stored result`); continue; }
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    const r = JSON.parse(JSON.stringify(oracle(c)));
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(r, null, 1));
    const a = strip(old), b = strip(r);
    // With the status-eot fields kept too (only the new status2 keys and the bookkeeping stripped).
    const fa = strip(old, true), fb = strip(r, true);
    if (fa === fb) { full++; same++; console.log(`${id}: equal (status-eot fields included)`); continue; }
    if (a === b) { same++; console.log(`${id}: equal after the moves; status-eot fields differ`); continue; }
    bad++;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    console.log(`${id}: DIFFER at ${i}\n  old …${a.slice(Math.max(0, i - 150), i + 150)}…\n  new …${b.slice(Math.max(0, i - 150), i + 150)}…`);
  }
  console.log(`\n${same}/${ids.length} equal after the moves (${full} with every status-eot field), ${bad} differ`);
}
