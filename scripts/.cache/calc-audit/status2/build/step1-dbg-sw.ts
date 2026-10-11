import { CASES } from "../../2v2/verify/cases";
import { oracle } from "../../2v2/verify/sim-dfs";
const c = CASES.find((x) => x.id === process.argv[2])!;
try { oracle(c); } catch (e) { console.log((e as Error).stack?.split("\n").slice(0, 8).join("\n")); }
