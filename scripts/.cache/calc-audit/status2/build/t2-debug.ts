// T2 debugging: a seat battle's log for one scenario of tests/unit/training-status2-t2.test.ts, and the real battle's state.
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { memberFromSet, seatBattle } from "../../../../../tests/unit/training-sim-fixtures";
const sp = (hp = 0, atk = 0, def = 0, spa = 0, spd = 0, spe = 0) => ({ hp, atk, def, spa, spd, spe });
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const set = (species: string, item: string, ability: string, moves: string[], extra: Record<string, unknown> = {}) => ({ name: species, species, item, ability, moves, nature: "Serious", evs: sp(), ivs: IV, level: 50, gender: "M", ...extra });
const team = (sets: ReturnType<typeof set>[]) => toShowdownTeam(sets.map((each) => { const m = memberFromSet(each as never); return { ...m, build: { ...m.build, configuration: { ...m.build.configuration, gender: each.gender as "M" } } }; }), runtime);
const lax = (name: string, moves = ["Rest", "Protect"]) => /2$|Bench/.test(name) ? set("Corviknight", "", "Pressure", moves) : set("Snorlax", "", "Thick Fat", moves);
type Scenario = [ReturnType<typeof set>[], ReturnType<typeof set>[], [string, string][]];
const scenarios: Record<string, Scenario> = {
  recharge: [[set("Snorlax", "", "Thick Fat", ["Hyper Beam", "Protect"]), lax("Lax2")], [lax("Foe"), lax("Foe2")], [["move 1 1, move 2", "move 2, move 2"]]],
  charge: [[set("Aggron", "", "Sturdy", ["Solar Beam", "Protect"]), lax("Lax2")], [set("Corviknight", "", "Pressure", ["Fly", "Protect"]), lax("Foe")], [["move 1 1, move 2", "move 1 2, move 2"]]],
  uproar: [[set("Snorlax", "", "Thick Fat", ["Uproar", "Protect"]), lax("Lax2")], [lax("Foe"), lax("Foe2")], [["move 1, move 2", "move 2, move 2"]]],
  field: [[lax("Lax"), lax("Lax2")], [set("Farigiraf", "", "Armor Tail", ["Future Sight", "Protect", "Gravity", "Magic Room"]), set("Alakazam", "", "Inner Focus", ["Psychic Terrain", "Protect", "Safeguard"]), lax("Bench")], [["move 2, move 2", "move 3, move 1"], ["move 2, move 2", "move 4, move 3"]]],
  leads: [[lax("Lax"), lax("Lax2")], [lax("Foe"), lax("Foe2")], []],
  seed: [[set("Venusaur", "", "Overgrow", ["Leech Seed", "Protect"]), set("Garchomp", "", "Rough Skin", ["Protect", "Dragon Claw"])], [lax("Foe"), lax("Foe2")], [["move 1 -2, move 1", "move 2, move 2"]]],
};
const which = process.argv[2] ?? "recharge";
const [p1, p2, turns] = scenarios[which];
const seat = seatBattle([1, 2, 3, 4], { own: team(p1), opponent: team(p2) });
seat.step(`team ${p1.map((_, i) => i + 1).join("")}`, `team ${p2.map((_, i) => i + 1).join("")}`);
for (const [a, b] of turns) seat.step(a, b);
console.log(seat.battle.log.filter((l) => !l.startsWith("|t:|") && !l.startsWith("|split") && !/\/100/.test(l)).join("\n"));
for (const side of [seat.battle.p1, seat.battle.p2]) for (const mon of side.active) {
  if (!mon) continue;
  const vols = Object.fromEntries(Object.entries(mon.volatiles).map(([id, s]) => [id, { duration: (s as { duration?: number }).duration, move: (s as { move?: string }).move, targetLoc: (s as { targetLoc?: number }).targetLoc, counter: (s as { counter?: number }).counter }]));
  console.log(mon.name, mon.position, "effectOrder", mon.abilityState.effectOrder, JSON.stringify(vols));
}
const field = seat.battle.field as unknown as { terrain: string; terrainState: { duration?: number }; pseudoWeather: Record<string, { duration?: number }> };
console.log("terrain", field.terrain, field.terrainState.duration, "pseudo", JSON.stringify(Object.fromEntries(Object.entries(field.pseudoWeather).map(([k, v]) => [k, v.duration]))));
console.log("request p1", JSON.stringify((seat.battle.p1.activeRequest as { active?: unknown })?.active));
