// Integration 1b: prints a stored case's app result (hp, steps) as a doubles-turn-fixes.test.ts READY row's hp/steps part.
import { CASES } from "../../../../2v2/verify/cases";
import { appTurn } from "../../../../2v2/verify/app-turn";
const r4 = (n: number) => Number(n.toFixed(10));
async function main() {
for (const id of process.argv.slice(2)) {
  const c = CASES.find((each) => each.id === id)!;
  const { result } = await appTurn(c);
  if (!result || result.status !== "ready") { console.log(id, result?.status, result && "reason" in result ? result.reason : ""); continue; }
  const hp = Object.fromEntries(Object.entries(result.hp).map(([slot, h]) => [slot, h && { start: h.start, maximum: h.maximum, low: h.low, high: h.high, min: h.min, max: h.max, average: r4(h.average), koChance: r4(h.koChance), ...(h.faintsBeforeMoving ? { faintsBeforeMoving: r4(h.faintsBeforeMoving) } : {}) }]));
  const steps = Object.fromEntries(result.steps.map((step) => [step.slot, { moveId: step.moveId, moves: r4(step.moves), order: step.order.map((o) => [o.position, r4(o.chance)]),
    hits: step.hits.map((hit) => ({ slot: hit.slot, reached: r4(hit.reached), koChance: r4(hit.koChance), ...(hit.kind === "calculated" ? { min: hit.min, max: hit.max } : { kind: hit.kind }) })) }]));
  console.log(id, JSON.stringify({ hp, steps }).replace(/"([a-zA-Z]+)":/g, "$1:"));
}
}
void main();
