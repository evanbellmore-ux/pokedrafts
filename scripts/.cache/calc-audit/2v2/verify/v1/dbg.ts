import { CASES } from "../cases";
import { oracle } from "../sim-dfs";
const c = CASES.find((x) => x.id === process.argv[2])!;
try { oracle(c); console.log("ok"); } catch (e) { console.log((e as Error).stack?.split("\n").slice(0, 12).join("\n")); }
