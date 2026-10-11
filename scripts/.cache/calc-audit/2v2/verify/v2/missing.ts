// Track V2: wave 1b cases without a stored oracle result (results/<id>.json), not-estimated ones aside.
import fs from "node:fs";
import path from "node:path";
import { WAVE1B_CASES } from "../cases-wave1b";
import { RESULTS_DIR } from "../sim-dfs";
const missing = WAVE1B_CASES.filter((c) => !c.notEstimated && !fs.existsSync(path.join(RESULTS_DIR, `${c.id}.json`)));
console.log(`${missing.length} missing: ${missing.map((c) => c.id).join(" ")}`);
