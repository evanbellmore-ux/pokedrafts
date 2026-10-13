import sys; sys.path.insert(0, 'v3/tools')
from patchlib import patch
P = '../../status2/build/changed-cases.ts'
patch(P, [
("""// Wave 1b (Track V2): with --wave=1b (or 1a,1b / all) the cases before wave 1b are "stored" (wave 1a's included: FS08e,""",
"""// Wave 2 (Track R-V): with --wave=2 (or 1a,1b,2 / all) the cases before wave 2 are "stored" (STORED_2), and the rows for 2
// are listChanged2's: the stored cases whose app input changes (app-turn.ts now passes CaseSide.hazards as
// DoublesTurnInput.hazards, which R-E's hazardFails and the Court Change / Defog / Tidy Up / G-Max Wind Rage counts read). No
// stored case has a bench, so the switch family keeps its reason (status2-removed.ts: switchesOut kept without a bench), and
// no stored oracle result changes (the harness's wave 2 additions act only with a bench: v3/ab.ts, byte-equal).
// Wave 1b (Track V2): with --wave=1b (or 1a,1b / all) the cases before wave 1b are "stored" (wave 1a's included: FS08e,"""),
("""import { WAVE1B_CASES } from "../../2v2/verify/cases-wave1b";""",
"""import { WAVE1B_CASES } from "../../2v2/verify/cases-wave1b";
import { WAVE2_CASES } from "../../2v2/verify/cases-wave2";"""),
("""const wave1b = new Set(WAVE1B_CASES.map((c) => c.id));
export const STORED = CASES.filter((c) => !wave1a.has(c.id) && !wave1b.has(c.id));""",
"""const wave1b = new Set(WAVE1B_CASES.map((c) => c.id));
const wave2 = new Set(WAVE2_CASES.map((c) => c.id));
export const STORED = CASES.filter((c) => !wave1a.has(c.id) && !wave1b.has(c.id) && !wave2.has(c.id));"""),
("""/** Wave 1b's stored set: every case before wave 1b (the stored and wave 1a's). */
export const STORED_1B = CASES.filter((c) => !wave1b.has(c.id));""",
"""/** Wave 1b's stored set: every case before wave 1b (the stored and wave 1a's). */
export const STORED_1B = CASES.filter((c) => !wave1b.has(c.id) && !wave2.has(c.id));
/** Wave 2's stored set: every case before wave 2. */
export const STORED_2 = CASES.filter((c) => !wave2.has(c.id));
/**
 * status2 wave 2 (Track R-V): the stored cases wave 2 changes: a pre-turn hazard on a side reaches the app input
 * (DoublesTurnInput.hazards) and R-E's readers (hazardFails; the hazards Court Change moves and Defog, Tidy Up and G-Max Wind
 * Rage clear: their facts). Numbers are expected unchanged (the same hazards stood in the oracle before), so no oracle re-run.
 */
export function listChanged2(): Listed[] {
  const out: Listed[] = [];
  for (const c of STORED_2) {
    const sides = (["own", "opponent"] as const).filter((side) => c.field?.[side]?.hazards?.length);
    if (!sides.length) continue;
    out.push({ id: c.id, why: `the input's pre-turn hazards (${sides.map((s) => `${s}: ${c.field![s]!.hazards!.join(", ")}`).join("; ")}) now reach the app (hazardFails, the hazard facts)`, owner: "R-E / integrator", wave: "2", reexpect: false, oracle: false });
  }
  return out;
}"""),
("""export function listChanged(opts: { c19?: boolean; wave1b?: boolean } = {}): Listed[] {
  const out: Listed[] = opts.wave1b ? listChanged1b() : [];""",
"""export function listChanged(opts: { c19?: boolean; wave1b?: boolean; wave2?: boolean } = {}): Listed[] {
  const out: Listed[] = [...(opts.wave1b ? listChanged1b() : []), ...(opts.wave2 ? listChanged2() : [])];"""),
("""  const with1b = inWave("1b");
  const listed = listChanged({ c19: args.includes("--c19"), wave1b: with1b });""",
"""  const with1b = inWave("1b"), with2 = inWave("2");
  const listed = listChanged({ c19: args.includes("--c19"), wave1b: with1b, wave2: with2 });"""),
("""  const isNewCase = (id: string) => (with1b ? wave1b.has(id) : wave1a.has(id) || wave1b.has(id));""",
"""  const isNewCase = (id: string) => (with2 ? wave2.has(id) : with1b ? wave1b.has(id) || wave2.has(id) : wave1a.has(id) || wave1b.has(id) || wave2.has(id));"""),
("""    console.log(`\\n${with1b ? STORED_1B.length : STORED.length} stored cases: ${new Set(listed.map((l) => l.id)).size} listed (${listed.filter((l) => l.wave === "1a").length} rows for wave 1a, ${listed.filter((l) => l.wave === "1b").length} for 1b)""",
"""    console.log(`\\n${with2 ? STORED_2.length : with1b ? STORED_1B.length : STORED.length} stored cases: ${new Set(listed.map((l) => l.id)).size} listed (${listed.filter((l) => l.wave === "1a").length} rows for wave 1a, ${listed.filter((l) => l.wave === "1b").length} for 1b, ${listed.filter((l) => l.wave === "2").length} for 2)"""),
("""STEP1_IDS.has(c.id) ? "Step 1 (step1-changed.ts)" : "NOT LISTED") : wave1b.has(c.id) ? "wave 1b case" : "wave 1a case"}""",
"""STEP1_IDS.has(c.id) ? "Step 1 (step1-changed.ts)" : "NOT LISTED") : wave2.has(c.id) ? "wave 2 case" : wave1b.has(c.id) ? "wave 1b case" : "wave 1a case"}"""),
])
