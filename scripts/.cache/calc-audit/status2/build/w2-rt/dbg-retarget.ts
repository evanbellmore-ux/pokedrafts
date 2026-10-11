import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { memberFromSet, seatBattle } from "../../../../../../tests/unit/training-sim-fixtures";
const sp = (hp = 0, atk = 0, def = 0, spa = 0, spd = 0, spe = 0) => ({ hp, atk, def, spa, spd, spe });
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const set = (species: string, item: string, ability: string, moves: string[], extra: Record<string, unknown> = {}) =>
  ({ name: species, species, item, ability, moves, nature: "Serious", evs: sp(), ivs: IV, level: 50, gender: "M", ...extra });
const team = (sets: ReturnType<typeof set>[]) => toShowdownTeam(sets.map((each) => memberFromSet(each as never)), runtime);
const s = seatBattle([1, 2, 3, 4], { own: team([set("Snorlax", "", "Thick Fat", ["Rest", "Protect"]), set("Corviknight", "", "Pressure", ["Rest", "Protect"])]), opponent: team([set("Garchomp", "", "Rough Skin", ["Dragon Claw", "Protect"]), set("Kingambit", "", "Defiant", ["Iron Head", "Protect"])]) });
s.step("team 12", "team 12");
(s.battle.p1.active[1] as unknown as { hp: number }).hp = 1;
const before = s.battle.log.length;
s.step("move 1, move 1", "move 1 2, move 1 2");
console.log(s.battle.log.slice(before).join("\n"));
