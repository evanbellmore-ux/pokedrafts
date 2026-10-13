import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import type { DoublesOutcome, DoublesOutcomeMon, DoublesSlotId, DoublesStart } from "@/app/lib/battle/doubles-types";
import { getBuildStats, validateBuild } from "@/app/lib/battle/model";
import { readNames } from "@/app/(app)/training/ai/engine-provider";
import { nextClock, postFromOutcome } from "@/app/(app)/training/ai/evaluate";
import { stateTerms, valueWeights } from "@/app/(app)/training/ai/value";
import type { CellActions, EngineWorld, PostState } from "@/app/(app)/training/model/ai-view";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { bridgeTurn, liveBuild } from "@/app/(app)/training/sim/bridge";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import type { Pokemon } from "@/app/(app)/training/sim/sim";
import { countsOf, createTracker, type StockpileVolatile } from "@/app/(app)/training/sim/tracker";
import { emptyClock, makeView, postOf } from "../fixtures/training-ai";
import { memberFromSet, runtime, seatBattle } from "./training-sim-fixtures";

/**
 * status2 Track T1 (SPEC2 §6, ADDENDUM2 §6's T1 rows) on pinned Showdown c23d2e94: the states from earlier turns the bridge
 * now passes from public lines (Stockpile and its counts, Power Trick, the stored stats after a split or Speed Swap, No
 * Retreat, Minimize, Gastro Acid, trapped, Attract, Octolock, Heal Block, Glaive Rush, the Berserk lock, Ripen's weakened
 * Berry, an Opportunist copy, the item it last used), the builds' world types, added type, stored stats, changed ability and
 * Transform, and evaluate.ts's clock, bench cure and carried outcome state. Each belief battle (truth world, perfect
 * information) is checked against the real battle it was rebuilt from: what the bridge reads is Showdown's own state.
 */
const sp = (hp = 0, atk = 0, def = 0, spa = 0, spd = 0, spe = 0) => ({ hp, atk, def, spa, spd, spe });
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const set = (species: string, item: string, ability: string, moves: string[], extra: Record<string, unknown> = {}) =>
  ({ name: species, species, item, ability, moves, nature: "Serious", evs: sp(), ivs: IV, level: 50, gender: "M", ...extra });
type Set = ReturnType<typeof set>;
/** Training members with the set's gender (Attract reads it). */
const team = (sets: Set[]) => toShowdownTeam(sets.map((each) => {
  const member = memberFromSet(each as never);
  return { ...member, build: { ...member.build, configuration: { ...member.build.configuration, gender: each.gender as "M" | "F" } } };
}), runtime);
const hex = (n: number) => n.toString(16).padStart(32, "0");
const keyOf = (_side: "p1" | "p2", name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
const quiet: CellActions = {
  own: { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } },
  opponent: { "opponent-right": { kind: "move", moveId: "protect", target: null }, "opponent-left": { kind: "move", moveId: "protect", target: null } },
};
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];

/** A real Champions battle from the AI's seat (p2), its belief battle on the truth world, and the bridge of `cell`. */
function play(p1: Set[], p2: Set[], turns: [string, string][], seed = [1, 2, 3, 4], cell: CellActions = quiet) {
  const seat = seatBattle(seed, { own: team(p1), opponent: team(p2) });
  seat.step(`team ${p1.map((_, i) => i + 1).join("")}`, `team ${p2.map((_, i) => i + 1).join("")}`);
  for (const [a, b] of turns) seat.step(a, b);
  const inputs = seat.inputs();
  const belief = buildBeliefBattle(inputs, seat.truthWorld(), runtime);
  const publicOf = (key: string) => inputs.public.mons[`${key.startsWith("own:") ? "p1" : "p2"}:${key.slice(key.indexOf(":") + 1)}`] ?? null;
  const bridged = bridgeTurn(belief.battle, cell, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set(), publicOf });
  const real = (species: string) => [...seat.battle.p1.active, ...seat.battle.p2.active].find((each) => each?.species.id === species || each?.baseSpecies.id === species) as Pokemon;
  const believed = (species: string) => [...belief.battle.p1.active, ...belief.battle.p2.active].find((each) => each?.species.id === species || each?.baseSpecies.id === species) as Pokemon;
  const slotOf = (species: string) => {
    if (bridged.kind !== "engine") throw new Error(bridged.reasons.join(" "));
    return SLOTS.find((slot) => bridged.input.pokemon[slot]?.build.speciesId === species || bridged.input.pokemon[slot]?.build.transformedFrom?.speciesId === species)!;
  };
  const entry = (species: string) => {
    if (bridged.kind !== "engine") throw new Error(bridged.reasons.join(" "));
    return bridged.input.pokemon[slotOf(species)]!;
  };
  return { seat, inputs, belief, bridged, real, believed, slotOf, entry, log: seat.battle.log.filter((line) => !line.startsWith("|t:|")) };
}
/**
 * An idle Pokémon (Rest fails at full HP; Champions has no Splash): Snorlax, or Corviknight for a second one on a side (the
 * Species Clause: the log names a Pokémon by its species, and two of one species on a side would be one to the tracker).
 */
const lax = (name: string, moves = ["Rest", "Protect"]) => /2$|Bench/.test(name) ? set("Corviknight", "", "Pressure", moves) : set("Snorlax", "", "Thick Fat", moves);

describe("the tracker's Stockpile counts (ADDENDUM2 C17)", () => {
  const LEAD = ["|switch|p1a: Swalot|Swalot, L50, M|100/100", "|switch|p1b: Shuckle|Shuckle, L50, M|100/100", "|turn|1"];
  const state = (lines: string[]) => { const t = createTracker("p2", keyOf); t.push([...LEAD, ...lines]); return t.state(); };
  it("counts −1 for each layer whose boost changed the stat (0: none), Contrary's -unboost included, and carries them to the next layer", () => {
    const one = state(["|move|p1a: Swalot|Stockpile|p1a: Swalot", "|-start|p1a: Swalot|stockpile1", "|-boost|p1a: Swalot|def|0", "|-boost|p1a: Swalot|spd|1"]);
    expect(one.mons["p1:swalot"].volatiles.find((each) => each.id === "stockpile")).toMatchObject({ layers: 1, def: 0, spd: -1 });
    const two = state(["|move|p1a: Swalot|Stockpile|p1a: Swalot", "|-start|p1a: Swalot|stockpile1", "|-boost|p1a: Swalot|def|0", "|-boost|p1a: Swalot|spd|1",
      "|move|p1b: Shuckle|Stockpile|p1b: Shuckle", "|-start|p1b: Shuckle|stockpile1", "|-unboost|p1b: Shuckle|def|1", "|-unboost|p1b: Shuckle|spd|1",
      "|upkeep", "|turn|2", "|move|p1a: Swalot|Stockpile|p1a: Swalot", "|-start|p1a: Swalot|stockpile2", "|-boost|p1a: Swalot|def|1", "|-boost|p1a: Swalot|spd|1"]);
    expect(two.mons["p1:swalot"].volatiles.find((each) => each.id === "stockpile")).toMatchObject({ layers: 2, def: -1, spd: -2 });
    expect(two.mons["p1:shuckle"].volatiles.find((each) => each.id === "stockpile")).toMatchObject({ layers: 1, def: -1, spd: -1 });
    // A later boost line of another source is not the layer's.
    const later = state(["|move|p1a: Swalot|Stockpile|p1a: Swalot", "|-start|p1a: Swalot|stockpile1", "|-boost|p1a: Swalot|def|1", "|-boost|p1a: Swalot|spd|1",
      "|move|p1b: Shuckle|Acupressure|p1a: Swalot", "|-boost|p1a: Swalot|def|2"]);
    expect(later.mons["p1:swalot"].volatiles.find((each) => each.id === "stockpile")).toMatchObject({ layers: 1, def: -1, spd: -1 });
  });
  it("matches the real battle's effectState (two layers, the second at +6 Defense) and the bridge carries it", () => {
    const run = play([set("Swalot", "", "Gluttony", ["Stockpile", "Iron Defense", "Protect"]), lax("Lax")], [lax("Foe1"), lax("Foe2")],
      [["move 2, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"]]);
    const real = run.real("swalot").volatiles.stockpile as unknown as { layers: number; def: number; spd: number };
    expect([real.layers, real.def, real.spd]).toEqual([2, 0, -2]);
    const pile = run.inputs.public.mons["p1:swalot"].volatiles.find((each) => each.id === "stockpile") as StockpileVolatile;
    expect([pile.layers, pile.def, pile.spd]).toEqual([2, 0, -2]);
    const believed = run.believed("swalot").volatiles.stockpile as unknown as { layers: number; def: number; spd: number };
    expect([believed.layers, believed.def, believed.spd]).toEqual([2, 0, -2]);
    expect(run.entry("swalot").carried?.stockpile).toEqual({ layers: 2, def: 0, spd: -2 });
  });
});

describe("stored stats after Power Trick, Power Split, Guard Split and Speed Swap", () => {
  it("the belief battle replays them in log order (each partner as it stood) to the real battle's stored stats", () => {
    const run = play(
      [set("Medicham", "", "Pure Power", ["Power Trick", "Power Split", "Guard Split", "Protect"], { evs: sp(2, 32, 0, 0, 0, 32) }), lax("Lax")],
      [set("Chandelure", "", "Flash Fire", ["Power Split", "Speed Swap", "Protect"], { evs: sp(2, 0, 0, 32, 0, 32) }), lax("Foe")],
      [["move 1, move 1", "move 1 1, move 1"], ["move 2 1, move 1", "move 2 1, move 1"], ["move 3 1, move 1", "move 3, move 1"]]);
    for (const species of ["medicham", "chandelure"]) expect(run.believed(species).storedStats, species).toEqual(run.real(species).storedStats);
    // The view's build is Showdown's (liveBuild: the stored stats as they are); the engine takes Power Trick's swap undone
    // (doubles-turn.ts carriedState swaps a carried Power Trick back).
    const medicham = run.real("medicham");
    expect(liveBuild(run.believed("medicham"), runtime)!.storedStats).toEqual({ ...medicham.storedStats });
    const entry = run.entry("medicham");
    expect(entry.carried?.powerTrick).toBe(true);
    expect({ ...entry.build.storedStats!, atk: entry.build.storedStats!.def, def: entry.build.storedStats!.atk }).toEqual({ ...medicham.storedStats });
    expect(run.entry("chandelure").build.storedStats).toEqual({ ...run.real("chandelure").storedStats });
    expect(getBuildStats(run.entry("chandelure").build, runtime)!.hp).toBe(run.real("chandelure").maxhp);
    expect(calculateDoublesOutcomes(run.bridged.kind === "engine" ? run.bridged.input : (null as never)).status).not.toBe("issues");
  });
  it("a Power Trick a form change undid (Stance Change) is a rollout", () => {
    const run = play([set("Aegislash", "", "Stance Change", ["Power Trick", "Shadow Sneak", "King's Shield"]), lax("Lax")], [lax("Foe1"), lax("Foe2")],
      [["move 1, move 1", "move 1, move 1"], ["move 2 1, move 1", "move 1, move 1"]]);
    expect(run.real("aegislash").volatiles.powertrick).toBeDefined();
    expect(run.believed("aegislash").storedStats).toEqual(run.real("aegislash").storedStats);
    expect(run.bridged).toMatchObject({ kind: "rollout", reasons: ["Aegislash: Power Trick across a form change is not modelled."] });
  });
});

describe("the volatiles the bridge now maps (SPEC2 §6)", () => {
  it("Minimize and Octolock (with its user's slot), No Retreat, trapped (Block) and Gastro Acid, Glaive Rush: carried", () => {
    const locked = play([set("Starmie", "", "Natural Cure", ["Minimize", "Protect"]), lax("Lax")], [set("Grapploct", "", "Limber", ["Octolock", "Protect"]), lax("Foe")],
      [["move 1, move 1", "move 1 1, move 1"]]);
    for (const id of ["minimize", "octolock"]) {
      expect(locked.real("starmie").volatiles[id], id).toBeDefined();
      expect(locked.believed("starmie").volatiles[id], `${id} (belief)`).toBeDefined();
    }
    expect(locked.entry("starmie").carried).toMatchObject({ minimize: true, octolock: locked.slotOf("grapploct") });
    expect(calculateDoublesOutcomes(locked.bridged.kind === "engine" ? locked.bridged.input : (null as never)).status).not.toBe("issues");
    const trapped = play([set("Falinks", "", "Battle Armor", ["No Retreat", "Gastro Acid", "Protect"]), set("Garchomp", "", "Rough Skin", ["Protect", "Dragon Claw"])],
      [set("Baxcalibur", "", "Thermal Exchange", ["Rest", "Block", "Protect"]), lax("Foe")],
      [["move 1, move 1", "move 1, move 1"], ["move 2 1, move 1", "move 2 2, move 1"]]);
    for (const [species, id] of [["falinks", "noretreat"], ["garchomp", "trapped"], ["baxcalibur", "gastroacid"]] as const) {
      expect(trapped.real(species).volatiles[id], `${species} ${id}`).toBeDefined();
      expect(trapped.believed(species).volatiles[id], `${species} ${id} (belief)`).toBeDefined();
    }
    expect(trapped.entry("falinks").carried).toMatchObject({ noRetreat: true });
    expect(trapped.entry("garchomp").carried).toMatchObject({ trapped: true });
    expect(trapped.entry("baxcalibur").carried).toMatchObject({ gastroAcid: true });
    expect(calculateDoublesOutcomes(trapped.bridged.kind === "engine" ? trapped.bridged.input : (null as never)).status).not.toBe("issues");
    // Glaive Rush stands until its user's next BeforeMove (data/moves.ts glaiverush onBeforeMove).
    const rush = play([lax("Lax1"), lax("Lax2")], [set("Baxcalibur", "", "Thermal Exchange", ["Glaive Rush", "Protect"]), lax("Foe")], [["move 1, move 1", "move 1 1, move 1"]]);
    expect(rush.real("baxcalibur").volatiles.glaiverush).toBeDefined();
    expect(rush.entry("baxcalibur").carried).toMatchObject({ glaiveRush: true });
  });
  it("Attract with its source's slot, and Heal Block's turns left as the real battle's duration (Psychic Noise: 2)", () => {
    const run = play([set("Espeon", "", "Synchronize", ["Psychic Noise", "Attract", "Protect"], { gender: "F" }), lax("Lax")], [lax("Foe1"), lax("Foe2")],
      [["move 2 1, move 1", "move 1, move 1"], ["move 1 2, move 1", "move 1, move 1"]]);
    const blocked = run.real("snorlax") && [...run.seat.battle.p2.active].find((each) => each?.volatiles.healblock)!;
    const duration = Number((blocked.volatiles.healblock as unknown as { duration: number }).duration);
    const slot = SLOTS.find((each) => run.bridged.kind === "engine" && run.bridged.input.pokemon[each]?.carried?.healBlock !== undefined)!;
    expect(run.bridged.kind === "engine" && run.bridged.input.pokemon[slot]!.carried?.healBlock).toBe(duration);
    expect(duration).toBe(1);
    const loving = SLOTS.find((each) => run.bridged.kind === "engine" && run.bridged.input.pokemon[each]?.carried?.attract)!;
    expect(run.bridged.kind === "engine" && run.bridged.input.pokemon[loving]!.carried?.attract).toBe(run.slotOf("espeon"));
    expect(calculateDoublesOutcomes(run.bridged.kind === "engine" ? run.bridged.input : (null as never)).status).not.toBe("issues");
  });
});

describe("world types, the added type, a changed ability and Transform on the build", () => {
  it("Soak and Forest's Curse: the build's types and added type are the real battle's", () => {
    const run = play([lax("Lax"), set("Garchomp", "", "Rough Skin", ["Rest", "Protect"])], [set("Azumarill", "", "Huge Power", ["Soak", "Protect"]), set("Trevenant", "", "Natural Cure", ["Forest's Curse", "Protect"])],
      [["move 1, move 1", "move 1 1, move 1 2"]]);
    expect([...run.real("snorlax").types]).toEqual(["Water"]);
    expect((run.real("garchomp") as unknown as { addedType: string }).addedType).toBe("Grass");
    expect(run.entry("snorlax").build.types).toEqual(["Water"]);
    expect(run.entry("garchomp").build).toMatchObject({ addedType: "Grass" });
    expect(run.entry("garchomp").build.types).toBeUndefined();
    expect(calculateDoublesOutcomes(run.bridged.kind === "engine" ? run.bridged.input : (null as never)).status).not.toBe("issues");
  });
  it("Reflect Type copies its target's types and added type (no types on its line); Soak leaves an unused Protean unused", () => {
    const run = play([set("Greninja", "", "Protean", ["Rest", "Protect"]), set("Garchomp", "", "Rough Skin", ["Rest", "Protect"])],
      [set("Gengar", "", "Cursed Body", ["Reflect Type", "Protect"]), set("Trevenant", "", "Natural Cure", ["Forest's Curse", "Soak", "Protect"])],
      [["move 1, move 1", "move 2, move 1 2"], ["move 1, move 1", "move 1 2, move 2 1"]]);
    const gengar = run.real("gengar") as unknown as { types: string[]; addedType: string };
    expect([[...gengar.types], gengar.addedType]).toEqual([["Dragon", "Ground"], "Grass"]);
    expect(run.entry("gengar").build).toMatchObject({ types: ["Dragon", "Ground"], addedType: "Grass" });
    expect([...run.real("greninja").types]).toEqual(["Water"]);
    // Soak on a Water type changes nothing it shows; Protean was not used.
    expect(run.entry("greninja").build.abilityActive).toBe(true);
    expect(calculateDoublesOutcomes(run.bridged.kind === "engine" ? run.bridged.input : (null as never)).status).not.toBe("issues");
  });
  it("a used Protean: its public type, abilityActive false; a rollout only while the engine refuses that build", () => {
    const run = play([set("Greninja", "", "Protean", ["Ice Beam", "Protect"]), lax("Lax")], [lax("Foe1"), lax("Foe2")], [["move 1 1, move 1", "move 1, move 1"]]);
    const build = liveBuild(run.believed("greninja"), runtime)!;
    expect(build).toMatchObject({ abilityActive: false, types: ["Ice"] });
    expect([...run.real("greninja").types]).toEqual(["Ice"]);
    const refused = validateBuild(build, runtime).some((issue) => issue.field === "abilityActive");
    if (refused) expect(run.bridged).toMatchObject({ kind: "rollout", reasons: ["Greninja: protean was used this stint."] });
    else expect(run.entry("greninja").build).toMatchObject({ abilityActive: false, types: ["Ice"] });
  });
  it("Skill Swap: an ability that is not its species' own is marked abilityChanged and goes to the engine", () => {
    const run = play([set("Alakazam", "", "Inner Focus", ["Skill Swap", "Protect"]), lax("Lax")], [set("Incineroar", "", "Intimidate", ["Rest", "Protect"]), lax("Foe")],
      [["move 1 1, move 1", "move 1, move 1"]]);
    expect(run.real("alakazam").ability).toBe("intimidate");
    expect(run.entry("alakazam").build).toMatchObject({ abilityId: "intimidate", abilityChanged: true });
    expect(run.entry("incineroar").build).toMatchObject({ abilityId: "innerfocus", abilityChanged: true });
    expect(calculateDoublesOutcomes(run.bridged.kind === "engine" ? run.bridged.input : (null as never)).status).not.toBe("issues");
  });
  it("a transformed Ditto: its target's species, stored stats and ability, its own HP (transformedFrom)", () => {
    // Imposter transforms into the foe across from it (p2a into p1b) as the leads enter.
    const run = play([lax("Lax"), set("Garchomp", "", "Rough Skin", ["Protect", "Dragon Claw"], { evs: sp(2, 32, 0, 0, 0, 32) })],
      [set("Ditto", "Choice Scarf", "Imposter", ["Transform"], { evs: sp(32, 0, 0, 0, 0, 0) }), lax("Foe")], []);
    const ditto = run.real("ditto");
    expect(ditto.transformed).toBe(true);
    const entry = run.entry("ditto");
    expect(entry.build).toMatchObject({ speciesId: "garchomp", abilityId: "roughskin", transformedFrom: { speciesId: "ditto" } });
    expect(entry.build.storedStats).toEqual({ ...ditto.storedStats });
    expect(getBuildStats(entry.build, runtime)!.hp).toBe(ditto.maxhp);
    expect(entry.moves).toEqual(ditto.moveSlots.map((each) => each.id));
    expect(calculateDoublesOutcomes(run.bridged.kind === "engine" ? run.bridged.input : (null as never)).status).not.toBe("issues");
  });
});

describe("Transform's copy as it was (the belief battle)", () => {
  it("keeps the ability it copied when its target's changes later (Skill Swap), and its copied moves' PP", () => {
    const run = play([lax("Lax"), set("Garbodor", "", "Aftermath", ["Rest", "Gunk Shot"])],
      [set("Ditto", "Choice Scarf", "Imposter", ["Transform"], { evs: sp(32, 0, 0, 0, 0, 0) }), set("Espeon", "", "Synchronize", ["Skill Swap", "Protect"], { gender: "F" })],
      [["move 1, move 1", "move 2 1, move 1 2"], ["move 1, move 1", "move 2 1, move 2"]]);
    const [real, believed] = [run.real("ditto"), run.believed("ditto")];
    expect(run.real("garbodor").ability).toBe("synchronize");
    expect([real.ability, believed.ability]).toEqual(["aftermath", "aftermath"]);
    expect(believed.moveSlots.map((each) => [each.id, each.pp])).toEqual(real.moveSlots.map((each) => [each.id, each.pp]));
    expect(run.entry("ditto").build).toMatchObject({ speciesId: "garbodor", abilityId: "aftermath" });
  });
  it("stays transformed into a target that fainted since; Protean copied acts on its own entry (its flag after the copy)", () => {
    const run = play([lax("Lax"), set("Greninja", "", "Protean", ["Memento", "Ice Beam"]), lax("Bench2")],
      [set("Ditto", "Choice Scarf", "Imposter", ["Transform"], { evs: sp(32, 0, 0, 0, 0, 0) }), set("Espeon", "", "Synchronize", ["Protect", "Psychic"], { gender: "F" })],
      [["move 1, move 1 1", "move 2 1, move 1"], ["switch 3", ""]]);
    const [real, believed] = [run.real("ditto"), run.believed("ditto")];
    expect(real.transformed).toBe(true);
    expect(run.seat.battle.p1.pokemon.find((each) => each.species.id === "greninja")!.fainted).toBe(true);
    expect([believed.transformed, believed.species.id, [...believed.types]]).toEqual([true, real.species.id, [...real.types]]);
    expect((believed.abilityState as unknown as { protean?: boolean }).protean).toBe((real.abilityState as unknown as { protean?: boolean }).protean);
    expect((real.abilityState as unknown as { protean?: boolean }).protean).toBe(true);
  });
  it("the tracker: a Berry's effect right after it was eaten names no holder (Teatime's heal names its user)", () => {
    const t = createTracker("p2", keyOf);
    t.push(["|switch|p1a: Polteageist|Polteageist, L50|100/100", "|switch|p2a: Clefable|Clefable, L50, F|190/190", "|turn|1",
      "|move|p1a: Polteageist|Teatime|p1a: Polteageist", "|-fieldactivate|move: Teatime", "|-enditem|p2a: Clefable|Sitrus Berry|[eat]",
      "|-heal|p2a: Clefable|190/190|[from] item: Sitrus Berry|[of] p1a: Polteageist"]);
    expect(t.state().mons["p1:polteageist"].item).toEqual({ state: "not-shown" });
    expect(t.state().mons["p2:clefable"].item).toMatchObject({ state: "gone", itemId: "sitrusberry" });
  });
  it("the tracker: Octolock's silent end when its user left ends Octolock, not a partial trap", () => {
    const t = createTracker("p2", keyOf);
    t.push(["|switch|p1a: Falinks|Falinks, L50|100/100", "|switch|p2a: Grapploct|Grapploct, L50, M|155/155", "|turn|1",
      "|move|p2a: Grapploct|Octolock|p1a: Falinks", "|-start|p1a: Falinks|move: Octolock|[of] p2a: Grapploct",
      "|-activate|p1a: Falinks|move: Fire Spin|[of] p2a: Grapploct", "|-end|p1a: Falinks|Octolock|[partiallytrapped]|[silent]"]);
    expect(t.state().mons["p1:falinks"].volatiles.map((each) => each.id)).toEqual(["partiallytrapped"]);
  });
});

describe("the item it last used (pinned pokemon.lastItem)", () => {
  it("the tracker follows useItem, eatItem and Fling, not a popped Air Balloon; Recycle clears it; it stays across a switch", () => {
    const run = play(
      [set("Garbodor", "Air Balloon", "Aftermath", ["Recycle", "Protect"]), set("Polteageist", "Sitrus Berry", "Weak Armor", ["Teatime", "Recycle", "Protect"]), lax("Bench")],
      [set("Clefable", "Focus Sash", "Magic Guard", ["Fling", "Protect"]), set("Garchomp", "Normal Gem", "Rough Skin", ["Body Slam", "Protect"])],
      [["move 1, move 1", "move 1 2, move 1 1"], ["move 2, move 2", "move 2, move 2"]]);
    const realLast = (name: string) => [...run.seat.battle.p1.pokemon, ...run.seat.battle.p2.pokemon].find((each) => each.species.id === name)!.lastItem;
    for (const [key, species] of [["p1:garbodor", "garbodor"], ["p1:polteageist", "polteageist"], ["p2:clefable", "clefable"], ["p2:garchomp", "garchomp"]] as const) {
      expect(countsOf(run.inputs.public.mons[key]).lastItem ?? "", key).toBe(realLast(species));
    }
    if (run.bridged.kind !== "engine") throw new Error(run.bridged.reasons.join(" "));
    for (const slot of SLOTS) {
      const input = run.bridged.input.pokemon[slot];
      if (input) expect(input.lastItem, slot).toBe(realLast(input.build.speciesId) || null);
    }
  });
});

describe("the ability state public lines decide", () => {
  it("Champions: a Sheer Force hit with secondaries locks Berserk's Sitrus Berry (checkedBerserk false), which the bridge carries", () => {
    const run = play([set("Drampa", "Sitrus Berry", "Berserk", ["Protect", "Yawn"], { evs: sp(32, 0, 32, 0, 0, 0) }), lax("Lax")],
      [set("Conkeldurr", "", "Sheer Force", ["Rock Slide", "Mach Punch", "Protect"]), lax("Foe")], [["move 2 1, move 1", "move 1, move 1"]]);
    expect((run.real("drampa").abilityState as unknown as { checkedBerserk?: boolean }).checkedBerserk).toBe(false);
    expect((run.believed("drampa").abilityState as unknown as { checkedBerserk?: boolean }).checkedBerserk).toBe(false);
    expect(run.entry("drampa").carried).toMatchObject({ berryLocked: true });
    // Without Sheer Force (the same hit by Guts): AfterMoveSecondary resets it.
    const plain = play([set("Drampa", "Sitrus Berry", "Berserk", ["Protect", "Yawn"], { evs: sp(32, 0, 32, 0, 0, 0) }), lax("Lax")],
      [set("Conkeldurr", "", "Guts", ["Rock Slide", "Mach Punch", "Protect"]), lax("Foe")], [["move 2 1, move 1", "move 1, move 1"]]);
    expect((plain.real("drampa").abilityState as unknown as { checkedBerserk?: boolean }).checkedBerserk).toBe(true);
    expect(plain.entry("drampa").carried?.berryLocked).toBeUndefined();
  });
  it("a lock the public lines cannot decide (a move reached it since) is a rollout; a Pickup's unknown target passes no last item", () => {
    const run = play([set("Drampa", "Sitrus Berry", "Berserk", ["Protect", "Yawn"], { evs: sp(32, 0, 32, 0, 0, 0) }), lax("Lax")],
      [set("Conkeldurr", "", "Sheer Force", ["Rock Slide", "Mach Punch", "Protect"]), lax("Foe")], [["move 2 1, move 1", "move 1, move 1"]]);
    Object.assign(run.inputs.public.mons["p1:drampa"], { berserk: { kind: "unknown" } });
    Object.assign(run.inputs.public.mons["p1:snorlax"], { lastItem: "sitrusberry", lastItemUnknown: true });
    const belief = buildBeliefBattle(run.inputs, run.seat.truthWorld(), runtime);
    expect((run.believed("drampa").abilityState as unknown as { checkedBerserk?: boolean }).checkedBerserk).toBe(false);
    expect((belief.battle.p1.active[0]!.abilityState as unknown as { checkedBerserk?: boolean }).checkedBerserk).toBeUndefined();
    const publicOf = (key: string) => run.inputs.public.mons[`${key.startsWith("own:") ? "p1" : "p2"}:${key.slice(key.indexOf(":") + 1)}`] ?? null;
    expect(bridgeTurn(belief.battle, quiet, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set(), publicOf })).toMatchObject({ kind: "rollout", reasons: ["Drampa: whether Sitrus Berry is locked by Berserk is not known."] });
    Object.assign(run.inputs.public.mons["p1:drampa"], { berserk: undefined });
    const open = buildBeliefBattle(run.inputs, run.seat.truthWorld(), runtime);
    const result = bridgeTurn(open.battle, quiet, { runtime, keys: open.keys, aiSide: "p2", switched: new Set(), publicOf });
    if (result.kind !== "engine") throw new Error(result.reasons.join(" "));
    const snorlax = SLOTS.find((slot) => result.kind === "engine" && result.input.pokemon[slot]?.build.speciesId === "snorlax" && slot.startsWith("own"))!;
    expect("lastItem" in result.input.pokemon[snorlax]!).toBe(false);
    expect(result.input.pokemon[SLOTS.find((slot) => result.kind === "engine" && result.input.pokemon[slot]?.build.speciesId === "drampa")!]!.lastItem).toBeNull();
  });
  it("Ripen: a resist Berry eaten outside a hit (Teatime) leaves berryWeaken, carried; eaten in a hit, none", () => {
    const run = play([set("Polteageist", "", "Weak Armor", ["Teatime", "Protect"]), lax("Lax")], [set("Appletun", "Occa Berry", "Ripen", ["Protect", "Yawn"]), lax("Foe")],
      [["move 1, move 1", "move 2 2, move 1"]]);
    expect((run.real("appletun").abilityState as unknown as { berryWeaken?: boolean }).berryWeaken).toBe(true);
    expect(countsOf(run.inputs.public.mons["p2:appletun"]).ripen).toBe("weaken");
    expect(run.entry("appletun").carried).toMatchObject({ berryWeaken: true });
  });
});

describe("the ability state public lines decide: the tracker's marks", () => {
  const LEAD = ["|switch|p1a: Drampa|Drampa, L50, M|100/100", "|switch|p1b: Appletun|Appletun, L50, M|100/100",
    "|switch|p2a: Conkeldurr|Conkeldurr, L50, M|190/190", "|switch|p2b: Espathra|Espathra, L50, M|170/170", "|turn|1"];
  // The decision point comes after the turn's last move closed (its residual's blank line, then |upkeep|).
  const state = (lines: string[]) => { const t = createTracker("p2", keyOf); t.push([...LEAD, ...lines, "|", "|upkeep"]); return t.state(); };
  it("Berserk: the last single hit names its user and move; a confusion self-hit locks; other damage resets; a move that only reaches it is unknown", () => {
    const hit = ["|move|p2a: Conkeldurr|Rock Slide|p1a: Drampa|[spread] p1a,p1b", "|-damage|p1a: Drampa|80/100", "|-damage|p1b: Appletun|90/100"];
    expect(countsOf(state(hit).mons["p1:drampa"]).berserk).toEqual({ kind: "move", by: "p2:conkeldurr", move: "rockslide" });
    expect(countsOf(state([...hit, "|", "|-damage|p1a: Drampa|70/100|[from] Leech Seed|[of] p2b: Espathra"]).mons["p1:drampa"]).berserk).toBeUndefined();
    expect(countsOf(state([...hit, "|-damage|p1a: Drampa|70/100|[from] Leech Seed|[of] p2b: Espathra"]).mons["p1:drampa"]).berserk).toBeUndefined();
    expect(countsOf(state([...hit, "|-activate|p1a: Drampa|confusion", "|-damage|p1a: Drampa|60/100|[from] confusion"]).mons["p1:drampa"]).berserk).toEqual({ kind: "confusion" });
    expect(countsOf(state([...hit, "|move|p2b: Espathra|Yawn|p1a: Drampa", "|-start|p1a: Drampa|move: Yawn|[of] p2b: Espathra"]).mons["p1:drampa"]).berserk).toEqual({ kind: "unknown" });
    // A move aimed elsewhere leaves it; a multi-hit move resets it.
    expect(countsOf(state([...hit, "|move|p2b: Espathra|Yawn|p1b: Appletun"]).mons["p1:drampa"]).berserk).toEqual({ kind: "move", by: "p2:conkeldurr", move: "rockslide" });
    expect(countsOf(state([...hit, "|move|p2a: Conkeldurr|Dual Chop|p1a: Drampa", "|-damage|p1a: Drampa|60/100", "|-damage|p1a: Drampa|50/100", "|-hitcount|p1a: Drampa|2"]).mons["p1:drampa"]).berserk).toBeUndefined();
    expect(countsOf(state(["|-activate|p1a: Drampa|confusion", "|-damage|p1a: Drampa|90/100|[from] confusion"]).mons["p1:drampa"]).berserk).toEqual({ kind: "confusion" });
    // A switch gives a fresh ability state.
    expect(countsOf(state([...hit, "|switch|p1a: Snorlax|Snorlax, L50, M|100/100"]).mons["p1:drampa"]).berserk).toBeUndefined();
  });
  it("Ripen: a resist Berry eaten with no [weaken] line after it; the hit it was eaten in uses it up; the next hit uses it up", () => {
    const tea = ["|move|p2b: Espathra|Teatime|p2b: Espathra", "|-enditem|p1b: Appletun|Occa Berry|[eat]"];
    expect(countsOf(state(tea).mons["p1:appletun"]).ripen).toBe("weaken");
    expect(countsOf(state(["|move|p2b: Espathra|Flamethrower|p1b: Appletun", "|-enditem|p1b: Appletun|Occa Berry|[eat]", "|-enditem|p1b: Appletun|Occa Berry|[weaken]", "|-damage|p1b: Appletun|70/100"]).mons["p1:appletun"]).ripen).toBeUndefined();
    expect(countsOf(state([...tea, "|move|p2a: Conkeldurr|Mach Punch|p1b: Appletun", "|-damage|p1b: Appletun|80/100"]).mons["p1:appletun"]).ripen).toBeUndefined();
    // A status move does not calculate damage: it stays.
    expect(countsOf(state([...tea, "|move|p2b: Espathra|Yawn|p1b: Appletun", "|-start|p1b: Appletun|move: Yawn|[of] p2b: Espathra"]).mons["p1:appletun"]).ripen).toBe("weaken");
  });
  it("the last item: not a popped Air Balloon; a Gem, Fling, a Berry, a Red Card; Recycle and Harvest clear it; Pickup between two candidates is unknown", () => {
    const items = state([
      "|-enditem|p1a: Drampa|Air Balloon", "|-enditem|p2a: Conkeldurr|Normal Gem|[from] gem|[move] Body Slam",
      "|move|p2b: Espathra|Fling|p1a: Drampa", "|-enditem|p2b: Espathra|Focus Sash|[from] move: Fling", "|-damage|p1a: Drampa|90/100",
      "|-enditem|p1b: Appletun|Sitrus Berry|[eat]",
    ]);
    expect(countsOf(items.mons["p1:drampa"]).lastItem).toBeUndefined();
    expect(countsOf(items.mons["p2:conkeldurr"]).lastItem).toBe("normalgem");
    expect(countsOf(items.mons["p2:espathra"]).lastItem).toBe("focussash");
    expect(countsOf(items.mons["p1:appletun"]).lastItem).toBe("sitrusberry");
    const recycled = state(["|-enditem|p1b: Appletun|Sitrus Berry|[eat]", "|move|p1b: Appletun|Recycle|p1b: Appletun", "|-item|p1b: Appletun|Sitrus Berry|[from] move: Recycle"]);
    expect(countsOf(recycled.mons["p1:appletun"]).lastItem).toBeUndefined();
    const picked = state(["|-enditem|p1b: Appletun|Sitrus Berry|[eat]", "|-enditem|p2b: Espathra|Sitrus Berry|[eat]", "|-item|p2a: Conkeldurr|Sitrus Berry|[from] ability: Pickup"]);
    expect([countsOf(picked.mons["p1:appletun"]).lastItemUnknown, countsOf(picked.mons["p2:espathra"]).lastItemUnknown]).toEqual([true, true]);
    const one = state(["|-enditem|p1b: Appletun|Sitrus Berry|[eat]", "|-item|p2a: Conkeldurr|Sitrus Berry|[from] ability: Pickup"]);
    expect(countsOf(one.mons["p1:appletun"]).lastItem).toBeUndefined();
  });
  it("Opportunist: a foe's rise at the final Update (after |upkeep|) waits; a switch-in, a Mega Evolution or a move applies it", () => {
    const raw = (lines: string[]) => { const t = createTracker("p2", keyOf); t.push([...LEAD, ...lines]); return t.state(); };
    const late = ["|move|p2a: Conkeldurr|Bulk Up|p2a: Conkeldurr", "|-boost|p2a: Conkeldurr|atk|1", "|upkeep", "|-enditem|p1a: Drampa|Liechi Berry|[eat]", "|-boost|p1a: Drampa|atk|1|[from] item: Liechi Berry", "|turn|2"];
    expect(countsOf(raw(late).mons["p2:espathra"]).copyRises).toEqual({ atk: 1 });
    expect(countsOf(raw(late).mons["p1:appletun"]).copyRises).toBeUndefined();
    expect(countsOf(raw([...late, "|move|p2b: Espathra|Protect|p2b: Espathra"]).mons["p2:espathra"]).copyRises).toBeUndefined();
    expect(countsOf(raw(["|upkeep", "|switch|p2a: Snorlax|Snorlax, L50, M|100/100", "|-boost|p1a: Drampa|atk|1|[from] ability: Defiant", "|turn|2"]).mons["p2:espathra"]).copyRises).toBeUndefined();
  });
  it("a real battle: Espathra's copy of a Liechi Berry eaten after the residual is pending into the next turn, and carried", () => {
    const run = play([set("Garchomp", "Liechi Berry", "Rough Skin", ["Yawn", "Protect"]), lax("Lax")], [set("Espathra", "", "Opportunist", ["Rest", "Protect"]), set("Venusaur", "", "Overgrow", ["Leech Seed", "Super Fang", "Protect"])],
      [["move 1 2, move 1", "move 1, move 2 1"], ["move 1 2, move 1", "move 1, move 1 1"], ["move 1 2, move 1", "move 1, move 3"], ["move 1 2, move 1", "move 1, move 3"]]);
    expect((run.real("espathra").abilityState as unknown as { boosts?: object }).boosts).toEqual({ atk: 1 });
    expect((run.believed("espathra").abilityState as unknown as { boosts?: object }).boosts).toEqual({ atk: 1 });
    expect(run.entry("espathra").carried).toMatchObject({ copy: { atk: 1 } });
    expect(run.entry("venusaur").carried?.copy).toBeUndefined();
  });
});

describe("evaluate.ts", () => {
  const side = { reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, faintedThisTurn: 0 };
  const outcome = (own: Partial<DoublesOutcome["sides"]["own"]> = {}, opponent: Partial<DoublesOutcome["sides"]["opponent"]> = {}, more: Partial<DoublesOutcome> = {}): DoublesOutcome => ({
    chance: 1, mons: {}, allFainted: { own: 0, opponent: 0 }, positions: { own: "kept", opponent: "kept" },
    sides: { own: { ...side, ...own }, opponent: { ...side, ...opponent } },
    field: { weather: "", terrain: "", gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false }, ...more,
  } as DoublesOutcome);
  it("nextClock: Court Change's swapped clocks and hazards, a condition set this turn, and a room set during the turn", () => {
    const clock = emptyClock();
    clock.sides.own = { ...clock.sides.own, tailwind: 2, stealthRock: true, spikes: 1 };
    clock.sides.opponent = { ...clock.sides.opponent, reflect: 3 };
    clock.rooms.trickRoom = 2;
    const swapped = nextClock(clock, outcome({ reflect: true, clock: { reflect: "opponent" }, hazardsFrom: "opponent" }, { tailwind: true, clock: { tailwind: "own" }, hazardsFrom: "own" },
      { field: { weather: "", terrain: "", gravity: false, trickRoom: true, wonderRoom: false, magicRoom: false }, fieldSet: { trickRoom: true } }));
    expect(swapped.sides.own).toMatchObject({ reflect: 2, tailwind: 0, stealthRock: false, spikes: 0 });
    expect(swapped.sides.opponent).toMatchObject({ tailwind: 1, reflect: 0, stealthRock: true, spikes: 1 });
    expect(swapped.rooms.trickRoom).toBe(4);
    expect(nextClock(clock, outcome({ tailwind: true, clock: { tailwind: "set" } })).sides.own.tailwind).toBe(3);
    // Without the marks: today's countdown.
    expect(nextClock(clock, outcome({ tailwind: true }), {}).sides.own.tailwind).toBe(1);
  });
  it("postFromOutcome: Heal Bell's bench cure, and the outcome's state from this turn on the Pokémon (no value term reads it)", () => {
    const view = makeView([
      { side: "opponent", species: "chimecho", slot: "opponent-left", moves: ["healbell", "protect"], ability: "levitate", item: "", nature: "Calm", points: {} },
      { side: "opponent", species: "snorlax", slot: "opponent-right", moves: ["protect"], ability: "thickfat", item: "", nature: "Calm", points: {} },
      { side: "opponent", species: "garchomp", slot: null, moves: ["protect"], ability: "roughskin", item: "", nature: "Jolly", points: {}, status: "brn" },
      { side: "own", species: "incineroar", slot: "own-left", moves: ["protect"], ability: "intimidate", item: "", nature: "Careful", points: {} },
      { side: "own", species: "rotomwash", slot: "own-right", moves: ["protect"], ability: "levitate", item: "", nature: "Modest", points: {} },
    ] as never);
    const base = postOf(view);
    const mons: Partial<Record<DoublesSlotId, DoublesOutcomeMon>> = {};
    const start = {} as DoublesStart;
    for (const mon of view.mons.filter((each) => each.slot)) {
      mons[mon.slot!] = { hp: [{ hp: mon.hp, chance: 1 }], build: mon.build, protected: false, moved: true, ...(mon.slot === "opponent-right" ? { stockpile: { layers: 1, def: -1, spd: -1 }, stages: { evasion: 2 }, turnsLeft: { healblock: 1 } } : {}) };
      (start as Record<string, unknown>)[mon.slot!] = { maximum: mon.maxHp };
    }
    const world: EngineWorld = { weight: 1, input: null as never, keys: Object.fromEntries(view.mons.filter((each) => each.slot).map((each) => [each.slot, each.key])) as EngineWorld["keys"], notes: [] };
    const cured = postFromOutcome({ view, base, residual: {}, outcome: { ...outcome({}, { benchCured: true }), mons }, start, world, cell: quiet, endOfTurn: "applied" });
    expect(cured.mons.find((each) => each.build.speciesId === "garchomp")!.build.status).toBe("");
    expect(cured.mons.find((each) => each.build.speciesId === "snorlax")!.carried).toEqual({ stockpile: { layers: 1, def: -1, spd: -1 }, stages: { evasion: 2 }, turnsLeft: { healblock: 1 } });
    const kept = postFromOutcome({ view, base, residual: {}, outcome: { ...outcome(), mons }, start, world, cell: quiet, endOfTurn: "applied" });
    expect(kept.mons.find((each) => each.build.speciesId === "garchomp")!.build.status).toBe("brn");
  });
  it("value.ts: the Speed term reads a stored Speed that is not the form's own (Speed Swap), past its cache", () => {
    const view = makeView([
      { side: "opponent", species: "garchomp", slot: "opponent-left", moves: ["dragonclaw"], ability: "roughskin", item: "", nature: "Serious", points: {} },
      { side: "own", species: "garchomp", slot: "own-left", moves: ["dragonclaw"], ability: "roughskin", item: "", nature: "Serious", points: {} },
    ] as never);
    const post = postOf(view) as PostState;
    const ctx = { weights: valueWeights(), worth: Object.fromEntries(view.mons.map((each) => [each.key, 1])), runtime, field: view.field, rows: {} as never, particles: [], view };
    const withSpeed = (spe: number): PostState => ({ ...post, mons: post.mons.map((mon) => mon.side === "opponent" ? { ...mon, build: { ...mon.build, storedStats: { ...getBuildStats(mon.build, runtime)!, spe } } } : mon) });
    const faster = stateTerms(withSpeed(999), ctx).speed;
    const slower = stateTerms(withSpeed(1), ctx).speed;
    expect(faster).toBeGreaterThan(0);
    expect(slower).toBeLessThan(0);
  });
});

void hex;

describe("the AI's read names a transformed Pokémon as the log does", () => {
  it("readNames: its own name (transformedFrom), not its target's species", () => {
    const view = makeView([
      { side: "opponent", species: "garchomp", slot: "opponent-left", moves: ["protect"], ability: "roughskin", item: "", nature: "Serious", points: {} },
      { side: "own", species: "garchomp", slot: "own-left", moves: ["protect"], ability: "roughskin", item: "", nature: "Serious", points: {} },
    ] as never);
    const ditto = view.mons.find((each) => each.side === "opponent")!;
    ditto.build = { ...ditto.build, transformedFrom: { speciesId: "ditto", baseHP: 48 } };
    const names = readNames(view, runtime);
    expect(names(ditto.key)).toBe("Ditto");
    expect(names(view.mons.find((each) => each.side === "own")!.key)).toBe("Garchomp");
  });
});
