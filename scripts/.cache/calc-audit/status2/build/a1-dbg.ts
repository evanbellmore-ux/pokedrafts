// Track A1: debug one A1 case's oracle (the stack of a failure). npx --no-install tsx scripts/.cache/calc-audit/status2/build/a1-dbg.ts <id>
import { A1_CASES } from "./a1-cases";
import { oracle } from "../../2v2/verify/sim-dfs";
const c = A1_CASES.find((x) => x.id === process.argv[2])!;
try { oracle(c); console.log("ok"); } catch (e) { console.log((e as Error).stack); }
