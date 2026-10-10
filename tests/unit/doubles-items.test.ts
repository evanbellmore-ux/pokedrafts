import { beforeAll, describe, expect, it, vi } from "vitest";
import { usesHelpers } from "@/app/lib/battle/calculate";
import * as items from "@/app/lib/battle/doubles-items";
import { calculateDoublesOutcomes, calculateDoublesTurn, type TurnKernel } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { cloneWorld, pointFactor, type PendingAction, type World } from "@/app/lib/battle/doubles-world";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { itemTakeable } from "@/app/lib/battle/uses-to-ko";
import type { BattleBuild, BattleConditions, BattleGame } from "@/app/lib/battle/types";

/**
 * Trick and Switcheroo in the 2v2 turn (status-eot ADDENDUM §4.12, doubles-items.ts) against pinned Showdown c23d2e94
 * (data/moves.ts:19870-19906 trick, :18645-18690 switcheroo; sim/pokemon.ts takeItem, setItem; the design probes
 * addendum-probes-2.out T1-T12), through Track A's pipeline (doubles-status.ts: the status table's handler key
 * `swapItems`, after its TryHit, TryImmunity and Substitute checks and before its Update).
 */

type P = { id: string; ability?: string; item?: string; hp?: number; move?: string | null; target?: DoublesSlotId | null; boosts?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe", number>> };
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon", "champions"] as const) runtimes[game] = await loadBattleRuntime(game);
});
function buildOf(runtime: BattleRuntime, p: P): BattleBuild {
  const base = createBuild(p.id, runtime);
  const abilityId = p.ability ?? base.abilityId;
  const zero = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const trained = base.game === "champions" ? { points: zero } : { native: { level: 50, evs: zero, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } } };
  return {
    ...base, ...trained, nature: "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: p.item ?? "", currentHP: p.hp ?? null, status: "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...p.boosts },
  } as BattleBuild;
}
function input(game: BattleGame, slots: Partial<Record<DoublesSlotId, P>>, field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const runtime = runtimes[game];
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const p = slots[slot];
    if (!p) return [slot, null];
    const entry: DoublesPokemonInput = { build: buildOf(runtime, p), contexts: {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null } };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
}
const idle = (id: string, extra: Partial<P> = {}): P => ({ id, move: null, ...extra });
function ready(result: DoublesTurnResult): Extract<DoublesTurnResult, { status: "ready" }> {
  if (result.status !== "ready") throw new Error(`not ready: ${JSON.stringify(result).slice(0, 400)}`);
  return result;
}
const stepFacts = (result: Extract<DoublesTurnResult, { status: "ready" }>, slot: DoublesSlotId) => result.steps.find((step) => step.slot === slot)!.facts.map((fact) => fact.text);
const T: DoublesSlotId = "opponent-right";
/** Azelf (fast) Tricks the Pokémon at opponent-right; Blissey and a slow filler stand by. */
const trick = (game: BattleGame, user: Partial<P>, target: P, other: P = idle(game === "scarlet_violet" ? "torkoal" : "shuckle"), field: Partial<BattleConditions> = {}) =>
  input(game, { "own-left": { id: "azelf", move: "trick", target: T, ...user }, "own-right": idle("blissey"), [T]: target, "opponent-left": other }, field);
function heldAfter(turn: DoublesTurnInput): Record<DoublesSlotId, string[]> {
  const out = calculateDoublesOutcomes(turn);
  if (out.status !== "ready") throw new Error(`not ready: ${JSON.stringify(out).slice(0, 300)}`);
  return Object.fromEntries(SLOTS.map((slot) => [slot, [...new Set(out.outcomes.map((outcome) => outcome.mons[slot]?.build.itemId ?? "-"))]])) as Record<DoublesSlotId, string[]>;
}

describe("the swap and its facts", () => {
  it("both items move; one item moves to an item-less Pokémon; neither holds one: it fails (T5)", () => {
    const both = ready(calculateDoublesTurn(trick("scarlet_violet", { item: "choicescarf" }, idle("snorlax", { item: "leftovers" }))));
    expect(stepFacts(both, "own-left")).toEqual(["Trick: Azelf gets Leftovers, Snorlax gets Choice Scarf."]);
    expect(heldAfter(trick("scarlet_violet", { item: "choicescarf" }, idle("snorlax", { item: "leftovers" })))).toMatchObject({ "own-left": ["leftovers"], [T]: ["choicescarf"] });
    expect(both.hp[T]!.conditions).toEqual([{ text: "Holds Choice Scarf.", chance: 1 }]);
    expect(both.hp["own-left"]!.conditions).toEqual([{ text: "Holds Leftovers.", chance: 1 }]);
    const give = ready(calculateDoublesTurn(trick("scarlet_violet", { item: "choicescarf" }, idle("snorlax"))));
    expect(stepFacts(give, "own-left")).toEqual(["Trick: Snorlax gets Choice Scarf; Azelf gets nothing."]);
    expect(give.hp["own-left"]!.conditions).toEqual([{ text: "Holds no item.", chance: 1 }]);
    const take = ready(calculateDoublesTurn(trick("scarlet_violet", {}, idle("snorlax", { item: "leftovers" }))));
    expect(stepFacts(take, "own-left")).toEqual(["Trick: Azelf gets Leftovers; Snorlax gets nothing."]);
    const none = ready(calculateDoublesTurn(trick("scarlet_violet", {}, idle("snorlax"))));
    expect(stepFacts(none, "own-left")).toEqual(["Trick fails: neither holds an item."]);
    expect(none.hp[T]!.conditions).toBeUndefined();
  });
  it("Switcheroo is Trick (T9; Ultra Sun/Ultra Moon's mod is equivalent)", () => {
    for (const game of ["scarlet_violet", "ultra_sun_ultra_moon"] as const) {
      const turn = input(game, { "own-left": { id: "klefki", move: "switcheroo", target: T, item: "choicescarf" }, "own-right": idle("blissey"), [T]: idle("snorlax", { item: "leftovers" }), "opponent-left": idle(game === "scarlet_violet" ? "torkoal" : "shuckle") });
      expect(stepFacts(ready(calculateDoublesTurn(turn)), "own-left"), game).toEqual(["Switcheroo: Klefki gets Leftovers, Snorlax gets Choice Scarf."]);
    }
  });
  it("an item that cannot be moved fails it, either way (T6)", () => {
    const fails = (game: BattleGame, user: Partial<P>, target: P) => stepFacts(ready(calculateDoublesTurn(trick(game, user, target))), "own-left");
    expect(fails("scarlet_violet", {}, idle("arceusfire", { ability: "multitype", item: "flameplate" }))).toEqual(["Trick fails: Arceus-Fire's Flame Plate cannot be moved."]);
    expect(fails("scarlet_violet", { item: "flameplate" }, idle("arceus", { ability: "multitype" }))).toEqual(["Trick fails: Azelf's Flame Plate cannot be moved."]);
    expect(fails("scarlet_violet", { item: "boosterenergy" }, idle("fluttermane"))).toEqual(["Trick fails: Azelf's Booster Energy cannot be moved."]);
    // Booster Energy to a Pokémon that is no Paradox Pokémon moves and does nothing.
    expect(fails("scarlet_violet", { item: "boosterenergy" }, idle("snorlax"))).toEqual(["Trick: Snorlax gets Booster Energy; Azelf gets nothing."]);
    expect(fails("sword_shield", {}, idle("zaciancrowned", { item: "rustedsword" }))).toEqual(["Trick fails: Zacian-Crowned's Rusted Sword cannot be moved."]);
    expect(fails("ultra_sun_ultra_moon", { item: "firiumz" }, idle("snorlax"))).toEqual(["Trick fails: Azelf's Firium Z cannot be moved."]);
    const champions = (user: P, target: P) => stepFacts(ready(calculateDoublesTurn(input("champions", {
      "own-left": { move: "trick", target: T, ...user }, "own-right": idle("torkoal"), [T]: target, "opponent-left": idle("venusaur"),
    }))), "own-left");
    expect(champions({ id: "alakazam" }, idle("charizard", { item: "charizarditex" }))).toEqual(["Trick fails: Charizard's Charizardite X cannot be moved."]);
    expect(champions({ id: "alakazam", item: "charizarditex" }, idle("charizard"))).toEqual(["Trick fails: Alakazam's Charizardite X cannot be moved."]);
    expect(champions({ id: "alakazam", item: "charizarditex" }, idle("snorlax"))).toEqual(["Trick: Snorlax gets Charizardite X; Alakazam gets nothing."]);
  });
});

describe("itemTakeable both ways (uses-to-ko.ts, Trick's two TakeItem checks)", () => {
  it("a family's item is stuck with its holder and refused by a receiver of that family", () => {
    const sv = runtimes.scarlet_violet, paradox = usesHelpers(sv).paradox;
    expect(itemTakeable(sv, paradox, "flameplate", "arceusfire", "azelf", true)).toBe(false);
    expect(itemTakeable(sv, paradox, "flameplate", "azelf", "arceus", true)).toBe(false);
    expect(itemTakeable(sv, paradox, "flameplate", "azelf", "snorlax", true)).toBe(true);
    expect(itemTakeable(sv, paradox, "boosterenergy", "azelf", "fluttermane", true)).toBe(false);
    expect(itemTakeable(sv, paradox, "boosterenergy", "fluttermane", "azelf", true)).toBe(false);
    expect(itemTakeable(sv, paradox, "leftovers", "fluttermane", "arceus", true)).toBe(true);
  });
});

describe("later in the turn everything reads the new holder (T1, T2, T3, T7)", () => {
  it("a Choice Scarf tricked onto Snorlax (50 → 75) moves it ahead of Chansey (70) from generation 8; generation 7 keeps the start order (T1)", () => {
    for (const game of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const) {
      const turn = input(game, {
        "own-left": { id: "azelf", move: "trick", target: T, item: "choicescarf" }, "own-right": idle(game === "scarlet_violet" ? "torkoal" : "shuckle"),
        [T]: { id: "snorlax", move: "bodyslam", target: "own-right" }, "opponent-left": { id: "chansey", move: "seismictoss", target: "own-right" },
      });
      const order = ready(calculateDoublesTurn(turn)).steps.map((step) => step.slot);
      expect(order, game).toEqual(game === "ultra_sun_ultra_moon" ? ["own-left", "opponent-left", T] : ["own-left", T, "opponent-left"]);
    }
  });
  it("Iron Ball grounds its new holder: a later Earthquake hits Gyarados (T2)", () => {
    const turn = input("scarlet_violet", {
      // Iron Ball halves Azelf's Speed (67): Torkoal (20) quakes after the Trick.
      "own-left": { id: "azelf", move: "trick", target: T, item: "ironball" }, "own-right": { id: "torkoal", move: "earthquake" },
      [T]: idle("gyarados"), "opponent-left": idle("blissey"),
    });
    const quake = ready(calculateDoublesTurn(turn)).steps.find((step) => step.slot === "own-right")!.hits.find((hit) => hit.slot === T)!;
    expect(quake.kind).toBe("calculated");
    expect(quake.max).toBeGreaterThan(0);
  });
  it("a received Air Balloon makes a later Earthquake miss its new holder; the giver is grounded again (T10)", () => {
    const turn = input("scarlet_violet", {
      "own-left": { id: "azelf", move: "trick", target: T, item: "airballoon" }, "own-right": idle("blissey"),
      [T]: idle("snorlax"), "opponent-left": { id: "torkoal", move: "earthquake" },
    });
    const quake = ready(calculateDoublesTurn(turn)).steps.find((step) => step.slot === "opponent-left")!.hits;
    // Azelf has Levitate: only Blissey is hit; Snorlax, holding the Air Balloon now, is not.
    expect(quake.find((hit) => hit.slot === T)!.kind).toBe("no-damage");
    expect(quake.find((hit) => hit.slot === "own-right")!.kind).toBe("calculated");
  });
  it("Life Orb moves with the item: its new holder's later hit costs it a tenth (T3)", () => {
    const turn = input("scarlet_violet", {
      "own-left": { id: "azelf", move: "trick", target: T, item: "lifeorb" }, "own-right": idle("blissey"),
      [T]: { id: "snorlax", move: "bodyslam", target: "own-right" }, "opponent-left": idle("torkoal"),
    });
    const result = ready(calculateDoublesTurn(turn));
    expect(result.hp[T]).toMatchObject({ min: 235 - 23, max: 235 - 23 });
    expect(result.hp["own-left"]!.max).toBe(result.hp["own-left"]!.start);
  });
  it("Unburden: losing the item and getting none doubles Speed at once; receiving one stops it (T7, T7b)", () => {
    // Hawlucha (Unburden, Sitrus; Speed −1: 92) loses its Berry to an item-less Azelf (135): 184, ahead of Garchomp (122).
    const lost = input("scarlet_violet", {
      "own-left": { id: "azelf", move: "trick", target: T }, "own-right": idle("blissey"),
      [T]: { id: "hawlucha", ability: "unburden", item: "sitrusberry", move: "acrobatics", target: "own-right", boosts: { spe: -1 } }, "opponent-left": { id: "garchomp", move: "dragonclaw", target: "own-right" },
    });
    expect(ready(calculateDoublesTurn(lost)).steps.map((step) => step.slot)).toEqual(["own-left", T, "opponent-left"]);
    const out = calculateDoublesOutcomes(lost);
    if (out.status !== "ready") throw new Error(out.status);
    expect(out.outcomes.every((outcome) => outcome.mons[T]!.build.abilityActive && !outcome.mons[T]!.build.itemId)).toBe(true);
    // A Hawlucha whose Unburden is on (item-less; Speed −3: 110) receives Leftovers: 55 while it holds one, behind Blissey (75).
    const gets = input("scarlet_violet", {
      "own-left": { id: "azelf", move: "trick", target: T, item: "leftovers" }, "own-right": idle("torkoal"),
      [T]: { id: "hawlucha", ability: "unburden", move: "acrobatics", target: "own-right", boosts: { spe: -3 } }, "opponent-left": { id: "blissey", move: "seismictoss", target: "own-right" },
    });
    gets.pokemon[T]!.build = { ...gets.pokemon[T]!.build, abilityActive: true };
    expect(ready(calculateDoublesTurn(gets)).steps.map((step) => step.slot)).toEqual(["own-left", "opponent-left", T]);
  });
});

describe("items acting on receipt (ADDENDUM §4.12.4)", () => {
  it("White Herb with a lowered stage is used at once: the stages back to 0, no item (T4)", () => {
    const turn = trick("scarlet_violet", { item: "whiteherb" }, idle("snorlax", { boosts: { def: -2, spe: 1 } }));
    const result = ready(calculateDoublesTurn(turn));
    expect(stepFacts(result, "own-left")).toEqual(["Trick: Snorlax gets White Herb; Azelf gets nothing.", "White Herb: Snorlax's lowered stats are restored."]);
    const out = calculateDoublesOutcomes(turn);
    if (out.status !== "ready") throw new Error(out.status);
    expect(out.outcomes.map((outcome) => [outcome.mons[T]!.build.itemId, outcome.mons[T]!.build.boosts.def, outcome.mons[T]!.build.boosts.spe])).toEqual([["", 0, 1]]);
    // A Klutz receiver ignores it (singleEvent skips an ignored item: T4b).
    expect(heldAfter(trick("scarlet_violet", { item: "whiteherb" }, idle("golurk", { ability: "klutz", boosts: { def: -2 } })))[T]).toEqual(["whiteherb"]);
  });
  it("a Seed outside its terrain is held; under Magic Room nothing acts (T4b)", () => {
    expect(heldAfter(trick("scarlet_violet", { item: "electricseed" }, idle("snorlax")))[T]).toEqual(["electricseed"]);
    // A Seed Magic Room held back from its giver (itemUsedBeforeRoom false) is not used by its receiver either.
    const room = trick("scarlet_violet", { item: "electricseed" }, idle("snorlax"), undefined, { terrain: "Electric", magicRoom: true });
    room.pokemon["own-left"]!.build = { ...room.pokemon["own-left"]!.build, itemUsedBeforeRoom: false };
    expect(heldAfter(room)[T]).toEqual(["electricseed"]);
  });
  it("Symbiosis does not act on the swap (T11); a received item its holder uses this action would run it: not followed", () => {
    const scarf = trick("scarlet_violet", { item: "choicescarf" }, idle("snorlax"), idle("torkoal"));
    scarf.pokemon["own-right"] = { ...scarf.pokemon["own-right"]!, build: buildOf(runtimes.scarlet_violet, { id: "oranguru", ability: "symbiosis", item: "leftovers" }) };
    expect(heldAfter(scarf)).toMatchObject({ "own-left": [""], "own-right": ["leftovers"], [T]: ["choicescarf"] });
    // Azelf at 50 HP receives a Sitrus Berry it eats at the action's Update: AfterUseItem, so its partner's Symbiosis would act.
    const berry = trick("scarlet_violet", { item: "choicescarf", hp: 50 }, idle("snorlax", { item: "sitrusberry" }));
    berry.pokemon["own-right"] = { ...berry.pokemon["own-right"]!, build: buildOf(runtimes.scarlet_violet, { id: "oranguru", ability: "symbiosis", item: "leftovers" }) };
    expect(calculateDoublesTurn(berry)).toMatchObject({ status: "not-estimated", reason: "Symbiosis is not modelled in 2v2." });
    // At full HP it holds the Berry: nothing is used, nothing for Symbiosis (E23).
    const held = trick("scarlet_violet", { item: "choicescarf" }, idle("snorlax", { item: "sitrusberry" }));
    held.pokemon["own-right"] = { ...held.pokemon["own-right"]!, build: buildOf(runtimes.scarlet_violet, { id: "oranguru", ability: "symbiosis", item: "leftovers" }) };
    expect(heldAfter(held)).toMatchObject({ "own-left": ["sitrusberry"], "own-right": ["leftovers"], [T]: ["choicescarf"] });
  });
});

describe("the handler on a world (kernel fixture)", () => {
  function fixture(user: Partial<BattleBuild>, target: Partial<BattleBuild>) {
    const runtime = runtimes.scarlet_violet;
    const mon = (build: BattleBuild) => ({
      build, fainted: false, moved: false, flinched: null, focusLost: false, charged: false, protect: null, centre: null, helpingHand: 0, hurt: false,
      damagedBy: [], timesAttacked: 0, statsLowered: false, statsRaised: false, vol: {}, eot: {},
    });
    const side = { reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, wideGuard: false, quickGuard: false, faintedThisTurn: 0, safeguard: false, hazards: [] };
    const w: World = {
      mass: 1, mons: { "own-left": mon({ ...buildOf(runtime, { id: "azelf" }), ...user } as BattleBuild), [T]: mon({ ...buildOf(runtime, { id: "snorlax" }), ...target } as BattleBuild) },
      sides: { own: { ...side }, opponent: { ...side } }, field: { weather: "", terrain: "", gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false },
      remaining: [], executed: 1, factors: [pointFactor("own-left", 100), pointFactor(T, 100)],
    };
    const stepFact = vi.fn();
    const kernel = {
      runtime, champions: false, gen7: false, names: { "own-left": "Azelf", "own-right": "", "opponent-left": "", [T]: "Snorlax" },
      itemName: (id: string) => runtime.itemsById.get(id)?.name ?? id, abilityName: (id: string) => runtime.abilitiesById.get(id)?.name ?? id,
      itemWorks: (world: World, build: BattleBuild) => !world.field.magicRoom && build.abilityId !== "klutz", alive: (world: World, slot: DoublesSlotId) => !!world.mons[slot] && !world.mons[slot]!.fainted,
      notEstimated: (reason: string) => { throw new Error(reason); }, stepFact,
    } as unknown as TurnKernel;
    const action: PendingAction = { index: 0, slot: "own-left", moveId: "trick", target: T, fractional: 0 };
    return { w, kernel, action, stepFact, move: runtime.movesById.get("trick")! };
  }
  it("itemsMoved names both Pokémon and survives a clone of the world", () => {
    const { w, kernel, action, move } = fixture({ itemId: "choicescarf" }, { itemId: "" });
    expect(items.swapItems(kernel, w, action, T, move)).toEqual([w]);
    expect(w.itemsMoved).toEqual(["own-left", T]);
    expect(cloneWorld(w).itemsMoved).toEqual(["own-left", T]);
    expect([w.mons["own-left"]!.build.itemId, w.mons[T]!.build.itemId]).toEqual(["", "choicescarf"]);
  });
  it("Unburden's four cases", () => {
    const run = (user: Partial<BattleBuild>, target: Partial<BattleBuild>) => {
      const { w, kernel, action, move } = fixture(user, target);
      items.swapItems(kernel, w, action, T, move);
      return [w.mons["own-left"]!.build.abilityActive, w.mons[T]!.build.abilityActive];
    };
    const unburden = { abilityId: "unburden", abilityActive: false };
    // Held an item, gets none: on. Held one, gets one: off. Held none (Unburden off), gets one: off. On already, gets one: off.
    expect(run({ ...unburden, itemId: "choicescarf" }, {})).toEqual([true, false]);
    expect(run({ ...unburden, itemId: "choicescarf" }, { itemId: "leftovers" })).toEqual([false, false]);
    expect(run(unburden, { itemId: "leftovers" })).toEqual([false, false]);
    expect(run({ ...unburden, abilityActive: true }, { itemId: "leftovers" })).toEqual([false, false]);
  });
  it("a Terrain Seed in its terrain and Room Service under Trick Room, from a giver that could not use them, are not followed (T10c)", () => {
    const seed = fixture({ itemId: "electricseed", abilityId: "klutz" }, {});
    seed.w.field = { ...seed.w.field, terrain: "Electric" };
    expect(() => items.swapItems(seed.kernel, seed.w, seed.action, T, seed.move)).toThrow("Electric Seed received by Snorlax is not modelled in 2v2.");
    const room = fixture({ itemId: "roomservice", abilityId: "klutz" }, {});
    room.w.field = { ...room.w.field, trickRoom: true };
    expect(() => items.swapItems(room.kernel, room.w, room.action, T, room.move)).toThrow("Room Service received by Snorlax is not modelled in 2v2.");
    // The Klutz giver receiving nothing: nothing for it to use.
    const back = fixture({ abilityId: "klutz" }, { itemId: "electricseed", abilityId: "klutz" });
    back.w.field = { ...back.w.field, terrain: "Electric" };
    expect(items.swapItems(back.kernel, back.w, back.action, T, back.move)).toEqual([back.w]);
  });
  it("Booster Energy received by a Protosynthesis or Quark Drive holder is not followed", () => {
    const { w, kernel, action, move } = fixture({ itemId: "boosterenergy" }, { abilityId: "protosynthesis" });
    expect(() => items.swapItems(kernel, w, action, T, move)).toThrow("Booster Energy received by Snorlax is not modelled in 2v2.");
  });
});
