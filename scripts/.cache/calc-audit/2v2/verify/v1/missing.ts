// Track V1: the wave 1a cases with no stored oracle result (and not notEstimated), for re-runs.
import fs from "node:fs";
import path from "node:path";
import { WAVE1A_CASES } from "../cases-wave1a";
import { RESULTS_DIR } from "../sim-dfs";
const prefix = process.argv.slice(2);
const miss = WAVE1A_CASES.filter((c) => !c.notEstimated && (!prefix.length || prefix.some((p) => c.id.startsWith(p))) && !fs.existsSync(path.join(RESULTS_DIR, `${c.id}.json`)));
console.log(miss.map((c) => c.id).join(" "));
console.log(`${miss.length} without results of ${WAVE1A_CASES.length}`);
