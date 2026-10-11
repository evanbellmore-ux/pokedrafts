import { CASES } from "../cases";
import { walk, prepare } from "../sim-dfs";
const c = CASES.find((x) => x.id === process.argv[2])!;
const p = prepare(c);
console.log(p.choices, p.warnings);
const t0 = Date.now();
try { const w = walk(c, "lowest", { maxRuns: 3000 }); console.log("lowest runs", w.runs, Date.now() - t0, "ms"); } catch (e) { console.log("lowest", (e as Error).message, Date.now() - t0); }
try { const w = walk(c, "all", { maxRuns: 20000 }); console.log("all runs", w.runs, w.decisions, Date.now() - t0, "ms"); } catch (e) { console.log("all", (e as Error).message, Date.now() - t0); }
