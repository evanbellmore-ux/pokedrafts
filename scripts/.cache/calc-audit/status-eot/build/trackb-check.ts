// Track B's end-of-turn spot checks: own cases through Track D's in-progress oracle (2v2/verify/sim-dfs.ts, read-only use)
// and the app's calculateDoublesTurn / calculateDoublesOutcomes, comparing HP after the whole turn per slot.
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/trackb-check.ts [id ...] [--verbose]
import { oracle } from "../../2v2/verify/sim-dfs";
import { caseInput, runtimeFor } from "../../2v2/verify/app-turn";
import { SLOTS, toID, type Case, type CaseMon, type SlotId } from "../../2v2/verify/case-types";
import { calculateDoublesOutcomes, calculateDoublesTurn, DOUBLES_REFERENCE } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { TB_CASES } from "./trackb-cases";
import { CASES } from "../../2v2/verify/cases";
import { ER_CASES } from "../../2v2/verify/cases-er";
import { S_CASES } from "../../2v2/verify/cases-s";
import { E_CASES } from "../../2v2/verify/cases-e";

function appInput(c: Case, input: DoublesTurnInput): DoublesTurnInput {
  const pokemon = { ...input.pokemon };
  for (const slot of SLOTS) {
    const m = c.slots[slot], entry = pokemon[slot];
    if (!entry || !m.carried && m.substitute === undefined) continue;
    const { trap, ...rest } = m.carried ?? {};
    const carried: DoublesCarried = { ...rest, ...(trap ? { trap: { source: trap.source, bindingBand: trap.bindingBand } } : {}), ...(m.substitute !== undefined ? { substitute: m.substitute } : {}) };
    pokemon[slot] = { ...entry, carried };
  }
  return { ...input, pokemon, ...(c.weatherTurns !== undefined ? { weatherTurns: c.weatherTurns } : {}), ...(c.canSwitch ? { canSwitch: c.canSwitch } : {}) };
}

const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));
const quiet = args.includes("--quiet");
const verbose = args.includes("--verbose");
async function main() {
let pass = 0, fail = 0;
for (const c of process.argv.includes("--stored") ? CASES.filter((each) => !each.notEstimated) : process.argv.includes("--er") ? ER_CASES.filter((each) => !each.notEstimated) : process.argv.includes("--se") ? [...S_CASES, ...E_CASES].filter((each) => !each.notEstimated) : TB_CASES) {
  if (ids.length && !ids.some((id) => c.id === id || c.id.startsWith(id))) continue;
  const runtime = await runtimeFor(c);
  const input = appInput(c, caseInput(c, runtime));
  const result = calculateDoublesTurn(input);
  const problems: string[] = [];
  let r: ReturnType<typeof oracle> | null = null;
  try { r = oracle(c); } catch (error) { problems.push(`oracle error: ${(error as Error).message}`); }
  if (result.status !== "ready") problems.push(`app ${result.status}: ${"reason" in result ? result.reason : JSON.stringify(result)}`);
  else if (c.endNotEstimated) {
    if (result.endOfTurn.status !== "not-estimated" || result.endOfTurn.reason !== c.endNotEstimated) problems.push(`end of turn: ${JSON.stringify(result.endOfTurn)} want ${c.endNotEstimated}`);
  } else if (result.endOfTurn.status !== "ready") problems.push(`end of turn not estimated: ${result.endOfTurn.reason}`);
  else if (r) {
    if (!r.afterTurn) problems.push("oracle: no after-turn result");
    else {
      for (const slot of SLOTS) {
        const want = r.afterTurn[slot], got = result.endOfTurn.hp[slot];
        if (c.slots[slot].absent) continue;
        if (!got) { problems.push(`${slot}: app null`); continue; }
        const tol = 1e-9 * Math.max(1, want.maximum);
        for (const key of ["average", "koChance"] as const) if (!close(got[key], want[key], key === "average" ? tol : 1e-9)) problems.push(`${slot} ${key}: app ${got[key]} oracle ${want[key]}`);
        for (const key of ["min", "max", "low", "high"] as const) if (got[key] !== want[key]) problems.push(`${slot} ${key}: app ${got[key]} oracle ${want[key]}`);
      }
      // E2: the outcomes' HP mixture equals the turn's after-turn distribution.
      const outcomes = calculateDoublesOutcomes(input);
      if (outcomes.status !== "ready") problems.push(`E2 ${outcomes.status}`);
      else if (outcomes.endOfTurn !== "applied") problems.push(`E2 end of turn ${JSON.stringify(outcomes.endOfTurn)}`);
      else {
        for (const slot of SLOTS) {
          const want = r.afterTurn[slot];
          if (c.slots[slot].absent) continue;
          let average = 0;
          for (const o of outcomes.outcomes) for (const e of o.mons[slot]!.hp) average += o.chance * e.chance * e.hp;
          if (!close(average, want.average, 1e-9 * Math.max(1, want.maximum))) problems.push(`E2 ${slot} average ${average} oracle ${want.average}`);
        }
      }
      // Reference mode: the same after-turn HP.
      DOUBLES_REFERENCE.on = true;
      try {
        const ref = calculateDoublesTurn(input);
        if (ref.status !== "ready" || ref.endOfTurn.status !== "ready") problems.push(`reference: ${ref.status}`);
        else for (const slot of SLOTS) {
          const a = ref.endOfTurn.hp[slot], b = result.endOfTurn.hp[slot];
          if (a && b && (!close(a.average, b.average, 1e-9 * Math.max(1, b.maximum)) || !close(a.koChance, b.koChance))) problems.push(`reference ${slot}: ${a.average}/${a.koChance} vs ${b.average}/${b.koChance}`);
        }
      } finally { DOUBLES_REFERENCE.on = false; }
    }
  }
  if (problems.length) { fail++; console.log(`FAIL ${c.id} ${c.title}`); for (const p of problems) console.log(`   ${p}`); }
  else { pass++; if (!quiet) console.log(`ok   ${c.id} ${c.title}`); }
  if ((verbose || problems.length) && result.status === "ready") {
    if (result.endOfTurn.status === "ready") for (const e of result.endOfTurn.residuals) console.log(`     app  ${e.slot} ${e.effect}${e.other ? ` (${e.other})` : ""} chance ${e.chance.toFixed(6)} ${e.min}..${e.max} ko ${e.koChance.toFixed(6)} ${e.facts.map((f) => `${f.text}@${f.chance.toFixed(4)}`).join(" ")}`);
    for (const e of r?.residuals ?? []) console.log(`     orc  ${e.slot} ${e.effect}${e.other ? ` (${e.other})` : ""} chance ${e.chance.toFixed(6)} ${e.min}..${e.max} ko ${e.koChance.toFixed(6)} ${Object.entries(e.facts).map(([k, v]) => `${k}@${v.toFixed(4)}`).join(" ")}`);
    if (result.endOfTurn.status === "ready" && r?.afterTurn) for (const slot of SLOTS) {
      const a = result.endOfTurn.hp[slot], o = r.afterTurn[slot];
      if (a) console.log(`     ${slot}: app ${a.low}/${a.average.toFixed(4)}/${a.high} [${a.min}-${a.max}] ko ${a.koChance.toFixed(6)} | orc ${o.low}/${o.average.toFixed(4)}/${o.high} [${o.min}-${o.max}] ko ${o.koChance.toFixed(6)}`);
    }
    console.log(`     facts: ${result.facts.join(" | ")}`);
  }
}
console.log(`${pass} pass, ${fail} fail`);
}
void main();
void toID; void ({} as CaseMon);
