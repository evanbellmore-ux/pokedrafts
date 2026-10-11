// T1 debugging: a seat battle's log, belief and bridge for one scenario of training-status2-t1.test.ts.
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { bridgeTurn } from "@/app/(app)/training/sim/bridge";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import type { CellActions } from "@/app/(app)/training/model/ai-view";
import { memberFromSet, seatBattle } from "../../../../../tests/unit/training-sim-fixtures";
const sp = (hp = 0, atk = 0, def = 0, spa = 0, spd = 0, spe = 0) => ({ hp, atk, def, spa, spd, spe });
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const set = (species: string, item: string, ability: string, moves: string[], extra: Record<string, unknown> = {}) => ({ name: species, species, item, ability, moves, nature: "Serious", evs: sp(), ivs: IV, level: 50, gender: "M", ...extra });
const team = (sets: ReturnType<typeof set>[]) => toShowdownTeam(sets.map((each) => { const m = memberFromSet(each as never); return { ...m, build: { ...m.build, configuration: { ...m.build.configuration, gender: each.gender as "M" } } }; }), runtime);
const quiet: CellActions = { own: { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } }, opponent: { "opponent-right": { kind: "move", moveId: "protect", target: null }, "opponent-left": { kind: "move", moveId: "protect", target: null } } };
const lax = (name: string, moves = ["Rest", "Protect"]) => set("Snorlax", "", "Thick Fat", moves, { name });
const extra = {
  attract: [[set("Espeon", "", "Synchronize", ["Psychic Noise", "Attract", "Protect"], { gender: "F" }), lax("Lax")], [lax("Foe1"), lax("Foe2")], [["move 2 1, move 1", "move 1, move 1"], ["move 1 2, move 1", "move 1, move 1"]]],
  curse: [[lax("Lax"), set("Garchomp", "", "Rough Skin", ["Protect", "Dragon Claw"])], [set("Azumarill", "", "Huge Power", ["Soak", "Protect"]), set("Trevenant", "", "Natural Cure", ["Forest's Curse", "Protect"])], [["move 1, move 1", "move 1 1, move 1 2"]]],
} as const;
const scenarios: Record<string, [ReturnType<typeof set>[], ReturnType<typeof set>[], [string, string][]]> = {
  ptrick: [[set("Medicham", "", "Pure Power", ["Power Trick", "Power Split", "Guard Split", "Protect"], { evs: sp(2, 32, 0, 0, 0, 32) }), lax("Lax")], [set("Chandelure", "", "Flash Fire", ["Power Split", "Speed Swap", "Protect"], { evs: sp(2, 0, 0, 32, 0, 32) }), lax("Foe")], [["move 1, move 1", "move 1 1, move 1"], ["move 2 1, move 1", "move 2 1, move 1"], ["move 3 1, move 1", "move 3, move 1"]]],
  ditto: [[lax("Lax"), set("Garchomp", "", "Rough Skin", ["Protect", "Dragon Claw"], { evs: sp(2, 32, 0, 0, 0, 32) })], [set("Ditto", "Choice Scarf", "Imposter", ["Transform"], { evs: sp(32, 0, 0, 0, 0, 0) }), lax("Foe")], []],
};
const which = process.argv[2] ?? "ptrick";
const [p1, p2, turns] = (scenarios as never)[which] ?? (extra as never)[which];
const seat = seatBattle([1, 2, 3, 4], { own: team(p1), opponent: team(p2) });
seat.step(`team ${p1.map((_, i) => i + 1).join("")}`, `team ${p2.map((_, i) => i + 1).join("")}`);
for (const [a, b] of turns) seat.step(a, b);
console.log(seat.battle.log.filter((l) => !l.startsWith("|t:|") && !l.startsWith("|split") && !/\/100/.test(l)).join("\n"));
const inputs = seat.inputs();
const belief = buildBeliefBattle(inputs, seat.truthWorld(), runtime);
const publicOf = (key: string) => inputs.public.mons[`${key.startsWith("own:") ? "p1" : "p2"}:${key.slice(key.indexOf(":") + 1)}`] ?? null;
const bridged = bridgeTurn(belief.battle, quiet, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set(), publicOf });
console.log(JSON.stringify(bridged.kind === "engine" ? Object.fromEntries(Object.entries(bridged.input.pokemon).map(([k, v]) => [k, v && { species: v.build.speciesId, ability: v.build.abilityId, stored: v.build.storedStats, carried: v.carried, types: v.build.types, tf: v.build.transformedFrom }])) : bridged, null, 1));
if (bridged.kind === "engine") { const r = calculateDoublesOutcomes(bridged.input); console.log(r.status, r.status === "issues" ? JSON.stringify(r.issues) : r.status === "not-estimated" ? r.reason : ""); }
