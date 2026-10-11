// Track V1: the wave 1a case ids whose slots use one of the given moves or abilities (for an oracle re-run).
import { WAVE1A_CASES } from "../cases-wave1a";
import { SLOTS, toID } from "../case-types";
const want = new Set(process.argv.slice(2).map(toID));
const ids = WAVE1A_CASES.filter((c) => SLOTS.some((s) => want.has(toID(c.slots[s].action.move ?? "")) || want.has(toID(c.slots[s].ability)))).map((c) => c.id);
console.log(ids.join(" "));
