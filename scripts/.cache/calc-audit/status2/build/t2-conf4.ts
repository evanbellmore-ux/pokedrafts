// T2: conformance row 4b's one cell outside the E2 support (#4, turn 1: Incineroar Fake Out and Kommo-o's Life Orb Vacuum
// Wave into a Chople Berry Kingambit). Rebuilt here from V10 / V06; E2's range with and without T2's new turn-level fields.
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { CellActions } from "@/app/(app)/training/model/ai-view";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { bridgeTurn } from "@/app/(app)/training/sim/bridge";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { PRNG, State } from "@/app/(app)/training/sim/sim";
import { fixtureById } from "../../../../../tests/fixtures/training-teams";
import { teamOf } from "../../../../../scripts/training/lib/teams";
import { seatBattle } from "../../../../../tests/unit/training-sim-fixtures";

const p1 = teamOf(fixtureById("V10")), p2 = teamOf(fixtureById("V06"));
const seat = seatBattle([4, 2, 3, 4], { own: toShowdownTeam(p1.members, runtime), opponent: toShowdownTeam(p2.members, runtime) });
const order = (team: typeof p1, first: string[]) => {
  const ids = team.members.map((member) => member.speciesId);
  const lead = first.map((id) => ids.indexOf(id) + 1);
  const rest = ids.map((_, i) => i + 1).filter((i) => !lead.includes(i)).slice(0, 2);
  return `team ${[...lead, ...rest].join("")}`;
};
seat.step(order(p1, ["incineroar", "kommoo"]), order(p2, ["kingambit", "gardevoir"]));
const cell: CellActions = {
  own: { "own-left": { kind: "move", moveId: "fakeout", target: "opponent-right" }, "own-right": { kind: "move", moveId: "vacuumwave", target: "opponent-right" } },
  opponent: { "opponent-right": { kind: "move", moveId: "ironhead", target: "own-right" }, "opponent-left": { kind: "move", moveId: "psychic", target: "own-left" } },
};
const inputs = seat.inputs();
const belief = buildBeliefBattle(inputs, seat.truthWorld(), runtime);
const publicOf = (key: string) => inputs.public.mons[`${key.startsWith("own:") ? "p1" : "p2"}:${key.slice(key.indexOf(":") + 1)}`] ?? null;
const bridged = bridgeTurn(belief.battle, cell, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set(), publicOf });
if (bridged.kind !== "engine") throw new Error(bridged.reasons.join(" "));
const range = (input: DoublesTurnInput) => {
  const result = calculateDoublesOutcomes(input);
  if (result.status !== "ready") return result.status;
  const hp = result.outcomes.flatMap((outcome) => outcome.mons["opponent-right"]!.hp.map((entry) => entry.hp));
  return [Math.min(...hp), Math.max(...hp), result.endOfTurn === "applied" ? "applied" : result.endOfTurn.notEstimated];
};
console.log("with T2's fields", JSON.stringify(range(bridged.input)));
const stripped: DoublesTurnInput = { ...bridged.input, entryOrder: undefined, battleLastMove: undefined, faintedLastTurn: undefined, fieldTurns: undefined,
  pokemon: Object.fromEntries(Object.entries(bridged.input.pokemon).map(([slot, entry]) => [slot, entry && (() => { const { firstTurn: _f, lastMoveTarget: _l, ...rest } = entry; void _f; void _l; return rest; })()])) as DoublesTurnInput["pokemon"] };
console.log("without", JSON.stringify(range(stripped)));
// Showdown on the belief json: Kingambit's HP after the turn over 400 seeds (no crit).
let lowest = Infinity;
const choices = { p1: "move 1 1, move 3 1", p2: "move 3 2, move 2 1" };
for (let n = 0; n < 400; n++) {
  const battle = State.deserializeBattle(belief.json);
  battle.restart(() => {});
  battle.prng = new PRNG(`sodium,${n.toString(16).padStart(32, "0")}` as never);
  const before = battle.log.length;
  battle.makeChoices(choices.p1, choices.p2);
  const lines = battle.log.slice(before);
  if (lines.some((line) => line.startsWith("|-crit|"))) continue;
  lowest = Math.min(lowest, battle.p2.active[0]!.hp);
}
console.log("Showdown lowest", lowest, "moves", seat.battle.p1.active.map((mon) => mon?.moveSlots.map((slot) => slot.id)), seat.battle.p2.active.map((mon) => mon?.moveSlots.map((slot) => slot.id)));
// Per-move damage into Kingambit over the seeds, and E2's steps.
const fake = new Map<number, number>(), vacuum = new Map<number, number>();
for (let n = 0; n < 400; n++) {
  const battle = State.deserializeBattle(belief.json);
  battle.restart(() => {});
  battle.prng = new PRNG(`sodium,${n.toString(16).padStart(32, "0")}` as never);
  const before = battle.log.length;
  battle.makeChoices(choices.p1, choices.p2);
  const lines = battle.log.slice(before);
  if (lines.some((line) => line.startsWith("|-crit|"))) continue;
  let hp = 207, mover = "";
  for (const line of lines) {
    if (line.startsWith("|move|")) mover = line.split("|")[3];
    const m = /^\|-damage\|p2a: Kingambit\|(\d+)\/207$/.exec(line);
    if (m) { const lost = hp - Number(m[1]); hp = Number(m[1]); const map = mover === "Fake Out" ? fake : vacuum; map.set(lost, (map.get(lost) ?? 0) + 1); }
  }
}
console.log("Fake Out", JSON.stringify([...fake].sort((a, b) => a[0] - b[0])), "Vacuum Wave", JSON.stringify([...vacuum].sort((a, b) => a[0] - b[0])));
const steps = calculateDoublesOutcomes(bridged.input);
const turn = calculateDoublesTurn(bridged.input) as unknown as { steps?: { slot: string; hits: { slot: string; min: number | null; max: number | null }[] }[] } | undefined;
console.log("E2 steps", JSON.stringify(turn?.steps?.map((step) => [step.slot, step.hits.map((hit) => [hit.slot, hit.min, hit.max])])), steps.status);
for (const slot of ["own-left", "own-right", "opponent-left", "opponent-right"] as const) {
  const entry = bridged.input.pokemon[slot]!;
  console.log(slot, entry.build.speciesId, entry.build.abilityId, entry.build.tracedAbility ?? "", JSON.stringify(entry.build.boosts), JSON.stringify(entry.earlierThisTurn ?? {}));
}
console.log(seat.battle.log.filter((line) => /ability|boost|Trace|turn\|1/.test(line)).join("\n"));
console.log(JSON.stringify((turn as unknown as { facts?: unknown }).facts), JSON.stringify((turn as unknown as { start?: unknown }).start).slice(0, 600));
const whole = turn as unknown as Record<string, unknown>;
console.log(Object.keys(whole));
console.log(JSON.stringify(whole.startRows ?? whole.start ?? null).slice(0, 1500));
const noTrace: DoublesTurnInput = { ...bridged.input, pokemon: { ...bridged.input.pokemon, "opponent-left": { ...bridged.input.pokemon["opponent-left"]!, build: { ...bridged.input.pokemon["opponent-left"]!.build, tracedAbility: undefined } } } };
const t2 = calculateDoublesTurn(noTrace) as unknown as { steps?: { slot: string; hits: { slot: string; min: number | null; max: number | null }[] }[] };
console.log("no traced ability", JSON.stringify(t2.steps?.map((step) => [step.slot, step.hits.map((hit) => [hit.slot, hit.min, hit.max])])));
