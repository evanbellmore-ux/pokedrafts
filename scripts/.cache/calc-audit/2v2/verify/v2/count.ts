// Track V2: counts and ids of the wave 1b cases (a quick load check of the case files).
import { WAVE1B_CASES, ownerOf1b } from "../cases-wave1b";
import { CASES } from "../cases";
const by = new Map<string, number>();
for (const c of WAVE1B_CASES) by.set(ownerOf1b(c.id), (by.get(ownerOf1b(c.id)) ?? 0) + 1);
console.log(`${WAVE1B_CASES.length} wave 1b cases; ${CASES.length} cases in all`);
for (const [k, v] of [...by].sort()) console.log(`  ${k}: ${v}`);
