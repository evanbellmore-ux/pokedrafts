// Track V1: prints one case (cases.ts) as JSON.
import { CASES } from "../cases";
for (const id of process.argv.slice(2)) console.log(JSON.stringify(CASES.find((c) => c.id === id), null, 1));
