// T1: a foe's Liechi Berry at the final Update after the residual (Leech Seed), Espathra's Opportunist copy pending into the next turn.
import { Battle } from "@/app/(app)/training/sim/sim";
const sp = (hp = 0, atk = 0, def = 0, spa = 0, spd = 0, spe = 0) => ({ hp, atk, def, spa, spd, spe });
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const set = (species: string, item: string, ability: string, moves: string[], extra: Record<string, unknown> = {}) => ({ name: species, species, item, ability, moves, nature: "Serious", evs: sp(), ivs: IV, level: 50, gender: "M", ...extra });
const b = new Battle({ formatid: "gen9championsvgc2026regmc", seed: [1, 2, 3, 4] });
b.setPlayer("p1", { team: [set("Garchomp", "Liechi Berry", "Rough Skin", ["Yawn", "Protect"]), set("Snorlax", "", "Thick Fat", ["Rest", "Protect"])] as never });
b.setPlayer("p2", { team: [set("Espathra", "", "Opportunist", ["Rest", "Protect"]), set("Venusaur", "", "Overgrow", ["Leech Seed", "Super Fang", "Protect"])] as never });
b.makeChoices("team 12", "team 12");
const turns: [string, string][] = [["move 1 2, move 1", "move 1, move 2 1"], ["move 1 2, move 1", "move 1, move 1 1"], ["move 1 2, move 1", "move 1, move 3"], ["move 1 2, move 1", "move 1, move 3"], ["move 1 2, move 1", "move 1, move 3"]];
for (const [x, y] of turns) {
  b.makeChoices(x, y);
  const esp = b.p2.active[0]!;
  console.log(`turn ${b.turn} Espathra boosts ${JSON.stringify((esp.abilityState as unknown as { boosts?: object }).boosts)} atk ${esp.boosts.atk}; Garchomp hp ${b.p1.active[0]!.hp}/${b.p1.active[0]!.maxhp} item ${b.p1.active[0]!.item}`);
}
console.log(b.log.filter((l) => !l.startsWith("|t:|") && !l.startsWith("|split") && !/\/100/.test(l)).slice(-60).join("\n"));
