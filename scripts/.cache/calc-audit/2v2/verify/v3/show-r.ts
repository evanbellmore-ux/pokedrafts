// Track R-V: a wave 2 oracle result, readable: the slots (identity), the steps with their hits (on newcomers too), the
// switch-outs and newcomers after the moves and after the turn, the residuals.
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v3/show-r.ts <id>... [--dir=results dir]
import fs from "node:fs";
import path from "node:path";
import { SLOTS, type OracleResult } from "../case-types";

const args = process.argv.slice(2);
const dir = path.resolve(args.find((a) => a.startsWith("--dir="))?.slice(6) ?? "scripts/.cache/calc-audit/2v2/verify/results");
for (const id of args.filter((a) => !a.startsWith("--"))) show(JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")) as OracleResult);
function show(r: OracleResult) {
const p = (x: number) => +x.toFixed(6);
const dist = (d: [number, number][]) => d.map(([h, q]) => `${h}:${p(q)}`).join(" ");
console.log(`${r.id}: ${r.title}`);
for (const w of r.warnings) console.log(`  ! ${w}`);
for (const slot of SLOTS) {
  const e = r.expected[slot], t = r.afterTurn?.[slot];
  console.log(`  ${slot} ${r.walks.all.slots[slot].species}: ${e.start}→ low ${e.low} avg ${p(e.average)} high ${e.high} [${e.min}–${e.max}] ko ${p(e.koChance)}${t ? ` | turn low ${t.low} avg ${p(t.average)} high ${t.high} ko ${p(t.koChance)}` : ""}`);
}
for (const [slot, s] of Object.entries(r.walks.all.steps)) {
  if (!s) continue;
  console.log(`  step ${slot} ${s.moveId}: picked ${p(s.picked)} moved ${p(s.moved)} order ${JSON.stringify(Object.fromEntries(Object.entries(s.orderAll).map(([k, v]) => [k, p(v)])))} cant ${JSON.stringify(s.cant)}`);
  const sub = (h: { sub?: { mass: number; takenMin: number; takenMax: number; breaks: number } }) => (h.sub ? ` sub ${p(h.sub.mass)} took ${h.sub.takenMin}–${h.sub.takenMax} breaks ${p(h.sub.breaks)}` : "");
  for (const [t, h] of Object.entries(s.hits)) console.log(`    → ${t}: reached ${p(h!.reached)} landed ${p(h!.landed)} ko ${p(h!.ko)} dmg ${h!.dmgMin}–${h!.dmgMax}${sub(h!)}`);
  for (const [t, byId] of Object.entries(s.hitsEntered ?? {})) for (const [who, h] of Object.entries(byId ?? {})) console.log(`    → ${t}|${who}: reached ${p(h.reached)} landed ${p(h.landed)} ko ${p(h.ko)} dmg ${h.dmgMin}–${h.dmgMax}${sub(h)}`);
}
const bench = (label: string, rep: OracleResult["expectedReplaced"] | null | undefined, ent: OracleResult["expectedEntered"] | null | undefined) => {
  for (const [slot, x] of Object.entries(rep ?? {})) {
    for (const l of x!.left) console.log(`  ${label} ${slot} left ${l.id} (${p(l.chance)}): low ${l.low} avg ${p(l.average)} high ${l.high} [${l.min}–${l.max}] | ${dist(l.dist)}`);
    console.log(`  ${label} ${slot} entered ${x!.entered.map((e) => `${e.id} ${p(e.chance)}`).join(", ")}`);
  }
  for (const [slot, byId] of Object.entries(ent ?? {})) for (const [who, e] of Object.entries(byId ?? {})) {
    console.log(`  ${label} ${slot}|${who} (${p(e.chance)}): ${e.start}/${e.maximum}→ low ${e.low} avg ${p(e.average)} high ${e.high} [${e.min}–${e.max}] ko ${p(e.koChance)}`);
  }
};
bench("moves", r.expectedReplaced, r.expectedEntered);
bench("turn", r.afterTurnReplaced, r.afterTurnEntered);
for (const x of r.residuals ?? []) console.log(`  residual ${x.slot}${x.id ? `|${x.id}` : ""} ${x.effect}: ${p(x.chance)} ${x.min}..${x.max} ko ${p(x.koChance)} ${JSON.stringify(x.facts)}`);
const ent = r.walks.all.afterTurn?.entered ?? {};
for (const [slot, byId] of Object.entries(ent)) for (const [who, e] of Object.entries(byId ?? {})) {
  console.log(`  E2 ${slot}|${who}: status ${JSON.stringify(e.status)} boosts ${JSON.stringify(e.boosts)} volatiles ${JSON.stringify(e.volatiles)} item ${JSON.stringify(e.item)}`);
}
console.log(`  decisions ${JSON.stringify(r.walks.all.decisions)} | after ${JSON.stringify(r.walks.all.afterTurn?.decisions)} noResidual ${r.walks.all.afterTurn?.noResidual}`);
}
