import { describe, expect, it } from "vitest";
import type { ClonedBattle } from "@/app/(app)/training/sim/sim";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { oracleFacts, trackerFacts } from "../../scripts/training/lib/oracle";
import { startingHP, startingMons } from "../../scripts/training/lib/starting-mons";
import { memberFromSet, runtime, seatBattle } from "./training-sim-fixtures";

// status-eot EOT-5: conformance gate 4b reads each Pokémon's HP where it stands after the turn, keyed by the slot it
// started in (E2's outcomes are keyed so), not by position: after an Ally Switch the side's two stand swapped.
const sp = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number) => ({ hp, atk, def, spa, spd, spe });
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const set = (species: string, item: string, ability: string, moves: string[], nature: string, evs: ReturnType<typeof sp>) =>
  ({ name: species, species, item, ability, moves, nature, evs, ivs: IV, level: 50, gender: "" as const });
const player = () => [
  set("Farigiraf", "Sitrus Berry", "Armor Tail", ["Ally Switch", "Psychic", "Protect", "Wish"], "Quiet", sp(32, 0, 2, 32, 0, 0)),
  set("Snorlax", "Leftovers", "Thick Fat", ["Protect", "Body Slam", "Yawn", "Curse"], "Careful", sp(32, 2, 16, 0, 16, 0)),
  set("Garchomp", "Life Orb", "Rough Skin", ["Protect", "Dragon Claw", "Rock Slide", "Earthquake"], "Jolly", sp(2, 32, 0, 0, 0, 32)),
  set("Kingambit", "Black Glasses", "Defiant", ["Protect", "Sucker Punch", "Iron Head", "Kowtow Cleave"], "Adamant", sp(32, 32, 0, 0, 2, 0)),
];
const opponent = () => [
  set("Clefable", "Leftovers", "Magic Guard", ["Protect", "Moonblast", "Follow Me", "Future Sight"], "Bold", sp(32, 0, 32, 0, 2, 0)),
  set("Pelipper", "Mystic Water", "Drizzle", ["Protect", "Weather Ball", "Tailwind", "Hurricane"], "Modest", sp(32, 0, 0, 32, 2, 0)),
  set("Sneasler", "White Herb", "Unburden", ["Protect", "Close Combat", "Dire Claw", "Fake Out"], "Jolly", sp(2, 32, 0, 0, 0, 32)),
  set("Dragonite", "Lum Berry", "Multiscale", ["Extreme Speed", "Outrage", "Iron Head", "Protect"], "Adamant", sp(2, 32, 0, 0, 0, 32)),
];

describe("conformance's reading of a played turn (EOT-5)", () => {
  it("follows each Pokémon through an Ally Switch", () => {
    const player = [
      set("Farigiraf", "Sitrus Berry", "Armor Tail", ["Ally Switch", "Psychic", "Protect", "Wish"], "Quiet", sp(32, 0, 2, 32, 0, 0)),
      set("Snorlax", "Leftovers", "Thick Fat", ["Protect", "Body Slam", "Yawn", "Curse"], "Careful", sp(32, 2, 16, 0, 16, 0)),
      set("Garchomp", "Life Orb", "Rough Skin", ["Protect", "Dragon Claw", "Rock Slide", "Earthquake"], "Jolly", sp(2, 32, 0, 0, 0, 32)),
      set("Kingambit", "Black Glasses", "Defiant", ["Protect", "Sucker Punch", "Iron Head", "Kowtow Cleave"], "Adamant", sp(32, 32, 0, 0, 2, 0)),
    ];
    const ai = [
      set("Clefable", "Leftovers", "Magic Guard", ["Protect", "Moonblast", "Follow Me", "Helping Hand"], "Bold", sp(32, 0, 32, 0, 2, 0)),
      set("Pelipper", "Mystic Water", "Drizzle", ["Protect", "Weather Ball", "Tailwind", "Hurricane"], "Modest", sp(32, 0, 0, 32, 2, 0)),
      set("Sneasler", "White Herb", "Unburden", ["Protect", "Close Combat", "Dire Claw", "Fake Out"], "Jolly", sp(2, 32, 0, 0, 0, 32)),
      set("Dragonite", "Lum Berry", "Multiscale", ["Extreme Speed", "Outrage", "Iron Head", "Protect"], "Adamant", sp(2, 32, 0, 0, 0, 32)),
    ];
    const seat = seatBattle([1, 2, 3, 4], { own: toShowdownTeam(player.map((each) => memberFromSet(each)), runtime), opponent: toShowdownTeam(ai.map((each) => memberFromSet(each)), runtime) });
    seat.step("team 1234", "team 1234");
    const battle = seat.battle as unknown as ClonedBattle;
    const started = startingMons(battle, "p2");
    expect(started["own-left"]?.name).toBe("Farigiraf");
    const before = battle.log.length;
    // Farigiraf (p1a) uses Ally Switch; everyone else Protects.
    seat.step("move 1, move 1", "move 1, move 1");
    expect(battle.log.slice(before).some((line) => line.startsWith("|swap|p1a: Farigiraf|1"))).toBe(true);
    const [left, right] = [battle.p1.active[0]!, battle.p1.active[1]!];
    expect([left.name, right.name]).toEqual(["Snorlax", "Farigiraf"]);
    expect(left.maxhp).not.toBe(right.maxhp);
    // Keyed by the starting slot: Farigiraf's HP for own-left wherever it now stands.
    expect(startingHP(started)).toMatchObject({ "own-left": right.hp, "own-right": left.hp });
  });

  it("reads Wish and Future Sight, slot conditions in Showdown, as the tracker keeps them (gate 1 on pool E)", () => {
    const seat = seatBattle([1, 2, 3, 4], { own: toShowdownTeam(player().map((each) => memberFromSet(each)), runtime), opponent: toShowdownTeam(opponent().map((each) => memberFromSet(each)), runtime) });
    seat.step("team 1234", "team 1234");
    // Farigiraf (p1a) wishes; Clefable (p2a) uses Future Sight on p1b (Snorlax).
    seat.step("move 4, move 1", "move 4 2, move 1");
    const real = oracleFacts(seat.battle, "p2", seat.keys).sides.p1;
    expect(real).toBe("futuresightx2,wish");
    expect(trackerFacts(seat.inputs().public).sides.p1).toBe(real);
  });
});
