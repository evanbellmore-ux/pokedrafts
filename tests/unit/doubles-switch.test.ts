import { describe, expect, it } from "vitest";
import { REASONS } from "@/app/lib/battle/doubles-actions";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { startId } from "@/app/lib/battle/doubles-types";
import type {
  DoublesBenchPokemon, DoublesCarried, DoublesHazards, DoublesOutcome, DoublesPokemonInput, DoublesSideId, DoublesSlotId, DoublesStep, DoublesTurnInput, DoublesTurnResult,
} from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus } from "@/app/lib/battle/types";

/**
 * status2 wave 2, Track R-E (SPEC2 §4.8, guards.md §5.4, ADDENDUM2 §8.7): switch-outs with a replacement, app/lib/battle/
 * doubles-switch.ts and its kernel sites. Every number is pinned Showdown c23d2e94's: each test is a case of the verify
 * harness (scripts/.cache/calc-audit/2v2/verify/cases-r.ts G4-SWX-, IN-BNC-, IN-HZD-, T2E-BL-, T2P-, CQ-PUR-R-; R-E's own
 * status2/build/w2-re/cases-re.ts RE-) whose app result agrees with the oracle (v3/run.ts --wave2; w2-re/run-cases.ts), with
 * its builds made as app-turn.ts caseInput makes them: level 50, 31 IVs, Serious, 0 EVs unless set (Champions: Stat Points),
 * one Pokémon left on a side without a bench (canSwitch).
 */
type Game = "sv" | "swsh" | "usum" | "champions";
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; ivs?: Partial<Record<Stat, number>>; hp?: number; level?: number;
  status?: BattleStatus; boosts?: Partial<Record<Exclude<Stat, "hp">, number>>; carried?: DoublesCarried; moves?: string[];
  /** Other build fields (a bench Pokémon Terastallized earlier: mechanic "tera" and its Tera type). */
  build?: Partial<BattleBuild>;
};
type Slot = Mon & { move: string | null; target?: DoublesSlotId };
type Ready = Extract<DoublesTurnResult, { status: "ready" }>;
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left", PR: DoublesSlotId = "opponent-right";
const SLOTS: DoublesSlotId[] = [OL, OR, PL, PR];
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const RUNTIME: Record<Game, BattleGame> = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" };
const runtimes: Partial<Record<Game, BattleRuntime>> = {};
const runtimeOf = async (game: Game) => (runtimes[game] ??= await loadBattleRuntime(RUNTIME[game]));
const toId = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

const mon = (species: string, ability: string, extra: Partial<Mon> = {}): Mon => ({ species, ability, ...extra });
const act = (m: Mon, move: string | null, target?: DoublesSlotId): Slot => ({ ...m, move, ...(target ? { target } : {}) });
const idle = (m: Mon): Slot => act(m, null);
/** A Thick Fat Snorlax with n × 8 Speed EVs (Champions: n Stat Points): the cases' L(game, n). */
const L = (game: Game, n: number, extra: Partial<Mon> = {}) => mon("Snorlax", "Thick Fat", { evs: { spe: game === "champions" ? n : n * 8 }, ...extra });
const fast = (game: Game, m: Mon): Mon => ({ ...m, evs: { ...m.evs, spe: game === "champions" ? 32 : 252 } });
const slowest = (game: Game): Partial<Mon> => ({ nature: "Brave", ...(game === "champions" ? {} : { ivs: { spe: 0 } }) });
const chomp = (extra: Partial<Mon> = {}) => mon("Garchomp", "Rough Skin", extra);
/** The cases' fast U-turn user: Ambipom (SV, USUM), Liepard (SwSh), Rillaboom (Champions). */
const uturner = (game: Game, extra: Partial<Mon> = {}) => fast(game, game === "swsh" ? mon("Liepard", "Limber", extra) : game === "champions" ? mon("Rillaboom", "Overgrow", extra) : mon("Ambipom", "Technician", extra));

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(toId(m.species), runtime);
  const abilityId = toId(m.ability);
  const shared = {
    nature: m.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: toId(m.item ?? ""),
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  return (base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs }, ...m.build }
    : { ...base, ...shared, native: { level: m.level ?? 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs } }, ...m.build }) as BattleBuild;
}
type More = {
  bench?: Partial<Record<DoublesSideId, [string, Mon][]>>; replacement?: Partial<Record<DoublesSlotId, string>>;
  hazards?: Partial<Record<DoublesSideId, DoublesHazards>>; field?: Partial<BattleConditions>;
  replacementOrder?: DoublesTurnInput["replacementOrder"];
};
/** The four Pokémon in slot order own-left, own-right, opponent-left, opponent-right, as app-turn.ts caseInput builds a case. */
async function turn(game: Game, slots: [Slot, Slot, Slot, Slot], more: More = {}): Promise<DoublesTurnInput> {
  const runtime = await runtimeOf(game);
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = slots[i];
    const moveId = m.move === null ? null : toId(m.move);
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId, target: m.target ?? null },
      ...(m.carried ? { carried: m.carried } : {}), ...(m.moves ? { moves: [...new Set([...(moveId ? [moveId] : []), ...m.moves.map(toId)])] } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  const bench: Partial<Record<DoublesSideId, DoublesBenchPokemon[]>> = {};
  for (const side of ["own", "opponent"] as const) {
    const members = more.bench?.[side];
    if (members) bench[side] = members.map(([id, m]) => ({ id, build: buildOf(runtime, m), ...(m.moves ? { moves: m.moves.map(toId) } : {}) }));
  }
  const input: DoublesTurnInput = {
    runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide(), ...more.field }, pokemon,
    canSwitch: { own: true, opponent: true },
    ...(Object.keys(bench).length ? { bench } : {}), ...(more.replacement ? { replacement: more.replacement } : {}), ...(more.hazards ? { hazards: more.hazards } : {}),
    ...(more.replacementOrder ? { replacementOrder: more.replacementOrder } : {}),
  };
  for (const slot of SLOTS) {
    const entry = pokemon[slot];
    if (entry.action.moveId && entry.action.target && doublesTargetRule(input, slot, entry.action.moveId).kind !== "choose") entry.action = { ...entry.action, target: null };
  }
  return input;
}
function ready(input: DoublesTurnInput): Ready {
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(`expected ready, got ${result.status}: ${result.status === "not-estimated" ? result.reason : JSON.stringify(result.issues)}`);
  return result;
}
function endOf(result: Ready) {
  if (result.endOfTurn.status !== "ready") throw new Error(`end of turn not estimated: ${result.endOfTurn.reason}`);
  return result.endOfTurn;
}
function outcomesOf(input: DoublesTurnInput): DoublesOutcome[] {
  const result = calculateDoublesOutcomes(input);
  if (result.status !== "ready") throw new Error(`outcomes ${result.status}`);
  expect(result.endOfTurn).toBe("applied");
  return result.outcomes;
}
const stepOf = (result: Ready, slot: DoublesSlotId, moveId: string): DoublesStep => {
  const step = result.steps.find((each) => each.slot === slot && each.moveId === moveId);
  if (!step) throw new Error(`no ${moveId} step of ${slot}`);
  return step;
};
const hitOf = (step: DoublesStep, slot: DoublesSlotId, id?: string) => {
  const hit = step.hits.find((each) => each.slot === slot && each.id === id);
  if (!hit) throw new Error(`no hit on ${slot}${id ? ` (${id})` : ""}`);
  return hit;
};
const texts = (facts: { text: string; chance: number }[]) => facts.map((fact) => `${fact.text} @${Math.round(fact.chance * 1e4) / 1e4}`);
const range = (hp: { min: number | null; max: number | null }) => [hp.min, hp.max];
const reason = (input: DoublesTurnInput) => {
  const result = calculateDoublesTurn(input);
  return result.status === "not-estimated" ? result.reason : result.status;
};

describe("the switch and its newcomer (replaceSlot, betweenActions; guards.md §5.4)", () => {
  it("U-turn brings in the first bench Pokémon by default; its Intimidate starts; the later Dragon Claw meets it (G4-SWX-01, B2)", async () => {
    const input = await turn("sv", [act(fast("sv", mon("Rillaboom", "Overgrow")), "U-turn", PL), idle(L("sv", 1)), act(chomp(), "Dragon Claw", OL), idle(L("sv", 3))],
      { bench: { own: [["inci", mon("Incineroar", "Intimidate")]] } });
    const result = ready(input);
    expect(result.facts).toContain("Assumes Incineroar comes in for Rillaboom.");
    expect(texts(stepOf(result, OL, "uturn").facts)).toEqual(["Rillaboom switches out; Incineroar comes in. @1", "Garchomp: −1 Attack. @1", "Snorlax (opponent's): −1 Attack. @1"]);
    expect(range(hitOf(stepOf(result, PL, "dragonclaw"), OL, "inci"))).toEqual([42, 51]);
    expect(result.replaced?.[OL]?.left.map((left) => [left.id, left.chance, left.hp.min, left.hp.max])).toEqual([["slot:own-left", 1, 154, 154]]);
    expect(result.replaced?.[OL]?.entered).toEqual([{ id: "inci", chance: 1 }]);
    const entered = result.hpEntered?.[OL]?.inci;
    expect(entered && [entered.start, entered.maximum, entered.min, entered.max]).toEqual([170, 170, 119, 128]);
    // The slot's own record is its starting Pokémon's, as it left.
    expect(range(result.hp[OL]!)).toEqual([154, 154]);
    const [outcome] = outcomesOf(input);
    expect(outcome.mons[OL]?.id).toBe("inci");
    expect(outcome.benched?.own?.map((each) => [each.id, each.slot, each.hp])).toEqual([["slot:own-left", OL, [{ hp: 154, chance: 1 }]]]);
  });
  it("a chosen replacement comes in with no turn fact (G4-SWX-02, IN-BNC-02)", async () => {
    const input = await turn("champions", [act(fast("champions", mon("Incineroar", "Blaze")), "Parting Shot", PL), idle(L("champions", 1)),
      act(chomp(slowest("champions")), "Dragon Claw", OL), idle(L("champions", 3))],
    { bench: { own: [["lax", L("champions", 2)], ["corv", mon("Corviknight", "Pressure")]] }, replacement: { [OL]: "corv" } });
    const result = ready(input);
    expect(result.facts.filter((fact) => fact.startsWith("Assumes") && fact.includes("comes in for"))).toEqual([]);
    expect(result.replaced?.[OL]?.entered).toEqual([{ id: "corv", chance: 1 }]);
    expect(range(hitOf(stepOf(result, PL, "dragonclaw"), OL, "corv"))).toEqual([20, 24]);
  });
  it("Roar drags in one of two bench Pokémon at 1/2 each; each one's Leftovers at the end of turn (G4-SWX-04, B5)", async () => {
    const input = await turn("swsh", [act(mon("Arcanine", "Justified"), "Roar", PL), idle(L("swsh", 1)), act(L("swsh", 4), "Body Slam", OR), idle(L("swsh", 3))], {
      bench: { opponent: [["lax", { ...L("swsh", 2), item: "Leftovers", hp: 150 }], ["bliss", mon("Blissey", "Natural Cure", { item: "Leftovers", hp: 200 })]] },
    });
    const result = ready(input);
    expect(result.replaced?.[PL]?.entered).toEqual([{ id: "lax", chance: 0.5 }, { id: "bliss", chance: 0.5 }]);
    expect(texts(stepOf(result, OL, "roar").facts)).toContain("Roar: Snorlax (opponent's, 1) is dragged out; Blissey comes in. @0.5");
    const end = endOf(result);
    expect(end.residuals.filter((each) => each.slot === PL).map((each) => [each.id, each.effect, each.min, each.chance])).toEqual([["bliss", "Leftovers", 20, 0.5], ["lax", "Leftovers", 14, 0.5]]);
    expect(outcomesOf(input).map((outcome) => [outcome.chance, outcome.mons[PL]?.id, outcome.mons[PL]?.hp])).toEqual([[0.5, "lax", [{ hp: 164, chance: 1 }]], [0.5, "bliss", [{ hp: 220, chance: 1 }]]]);
  });
  it("Icy Wind drops two Eject Pack holders: the second leaves at the first newcomer's switch-in (G4-SWX-05, B1)", async () => {
    const input = await turn("sv", [act(fast("sv", mon("Glalie", "Inner Focus")), "Icy Wind"), act(mon("Venusaur", "Overgrow"), "Tackle", PL),
      idle({ ...L("sv", 4), item: "Eject Pack" }), idle(mon("Torkoal", "Shell Armor", { item: "Eject Pack" }))],
    { bench: { opponent: [["lax", L("sv", 2)], ["bliss", mon("Blissey", "Natural Cure")]] } });
    const result = ready(input);
    expect(texts(stepOf(result, OL, "icywind").facts)).toEqual([
      "Snorlax's Eject Pack is used up. @1", "Snorlax switches out; Snorlax (2) comes in. @1", "Torkoal's Eject Pack is used up. @1", "Torkoal switches out; Blissey comes in. @1",
    ]);
    expect(result.facts).toEqual(expect.arrayContaining(["Assumes Snorlax (2) comes in for Snorlax.", "Assumes Blissey comes in for Torkoal."]));
    expect(range(hitOf(stepOf(result, OR, "tackle"), PL, "lax"))).toEqual([19, 23]);
  });
  it("a Drought newcomer re-sorts the later moves from generation 8, not in Ultra Sun/Ultra Moon (G4-SWX-06, B7)", async () => {
    const order = async (game: Game) => {
      const result = ready(await turn(game, [act(fast(game, mon("Ambipom", "Technician")), "U-turn", PR), act(mon("Venusaur", "Chlorophyll"), "Tackle", PL),
        act(chomp(), "Dragon Claw", OR), idle(L(game, 3))], { bench: { own: [["tork", mon("Torkoal", "Drought")]] } }));
      expect(texts(stepOf(result, OL, "uturn").facts)).toContain("Torkoal: the weather becomes Sun. @1");
      return result.steps.map((step) => step.moveId);
    };
    expect(await order("sv")).toEqual(["uturn", "tackle", "dragonclaw"]);
    expect(await order("usum")).toEqual(["uturn", "dragonclaw", "tackle"]);
  });
  it("Regenerator heals the leaver by a third as it leaves (G4-SWX-07, B6)", async () => {
    const result = ready(await turn("sv", [act(mon("Slowking-Galar", "Regenerator", { hp: 120 }), "Chilly Reception"), idle(L("sv", 1)), act(chomp(), "Dragon Claw", OL), idle(L("sv", 3))],
      { bench: { own: [["corv", mon("Corviknight", "Pressure")]] } }));
    expect(result.hp[OL]!.heals).toEqual(["Regenerator: +56 HP."]);
    expect(range(result.replaced![OL]!.left[0].hp)).toEqual([95, 109]);
  });
  it("Eject Button sends its holder out before its own move; the later Body Slam meets the newcomer (G4-SWX-08)", async () => {
    const result = ready(await turn("sv", [act(fast("sv", chomp()), "Dragon Claw", PL), act(L("sv", 1), "Body Slam", PL), act({ ...L("sv", 4), item: "Eject Button" }, "Body Slam", OL), idle(L("sv", 3))],
      { bench: { opponent: [["corv", mon("Corviknight", "Pressure")], ["bliss", mon("Blissey", "Natural Cure")]] } }));
    const cancelled = stepOf(result, PL, "bodyslam");
    expect([cancelled.moves, texts(cancelled.skipped)]).toEqual([0, ["Switches out before it moves. @1"]]);
    expect(range(hitOf(stepOf(result, OR, "bodyslam"), PL, "corv"))).toEqual([25, 30]);
  });
  it("Baton Pass passes +2 Attack to the newcomer (G4-SWX-09, B4a)", async () => {
    const input = await turn("sv", [act(fast("sv", mon("Ambipom", "Technician", { boosts: { atk: 2 }, carried: { stages: { evasion: 1 } } })), "Baton Pass"), idle(L("sv", 1)),
      act(chomp(), "Dragon Claw", OL), idle(L("sv", 3))], { bench: { own: [["lax", L("sv", 2)]] } });
    const result = ready(input);
    expect(range(hitOf(stepOf(result, PL, "dragonclaw"), OL, "lax"))).toEqual([81, 96]);
    const [outcome] = outcomesOf(input);
    expect([outcome.mons[OL]?.id, outcome.mons[OL]?.build.boosts.atk]).toEqual(["lax", 2]);
    expect(outcome.benched?.own?.[0].build.boosts.atk).toBe(0);
  });
  it("Emergency Exit mid-turn: the holder leaves before its own move (G4-SWX-10, B10)", async () => {
    const result = ready(await turn("champions", [act(fast("champions", chomp()), "Dragon Claw", PL), act(L("champions", 1), "Body Slam", PL),
      act(mon("Golisopod", "Emergency Exit", { hp: 90 }), "Rock Slide"), idle(L("champions", 3))],
    { bench: { opponent: [["lax", L("champions", 2)], ["bliss", mon("Clefable", "Cute Charm")]] } }));
    expect(texts(stepOf(result, PL, "rockslide").skipped)).toEqual(["Switches out before it moves. @1"]);
    expect(texts(stepOf(result, OL, "dragonclaw").facts)).toEqual(["Emergency Exit: Golisopod switches out. @1", "Golisopod switches out; Snorlax (opponent's, 2) comes in. @1"]);
    expect(range(hitOf(stepOf(result, OR, "bodyslam"), PL, "lax"))).toEqual([75, 88]);
  });
  it("Red Card drags the attacker's bench in at random (G4-SWX-11, B9)", async () => {
    const result = ready(await turn("sv", [act(fast("sv", chomp()), "Dragon Claw", PL), idle(L("sv", 1)), idle({ ...L("sv", 4), item: "Red Card" }), act(L("sv", 3), "Body Slam", OL)],
      { bench: { own: [["lax", { ...L("sv", 2), hp: 180 }], ["bliss", mon("Blissey", "Natural Cure")]] } }));
    expect(texts(stepOf(result, OL, "dragonclaw").facts)).toEqual(["Red Card: Garchomp is dragged out; Snorlax (yours, 2) comes in. @0.5", "Red Card: Garchomp is dragged out; Blissey comes in. @0.5"]);
    const slam = stepOf(result, PR, "bodyslam");
    expect([hitOf(slam, OL, "lax").reached, ...range(hitOf(slam, OL, "lax"))]).toEqual([0.5, 75, 88]);
    expect([hitOf(slam, OL, "bliss").reached, ...range(hitOf(slam, OL, "bliss"))]).toEqual([0.5, 208, 246]);
  });
  it("both Pokémon of a side U-turn: the second takes the next bench Pokémon; Natural Cure cures the leaver (G4-SWX-18)", async () => {
    const input = await turn("sv", [act(fast("sv", mon("Comfey", "Natural Cure", { status: "par" })), "U-turn", PL), act(mon("Ambipom", "Technician"), "U-turn", PR), idle(L("sv", 4)), idle(L("sv", 3))],
      { bench: { own: [["lax", L("sv", 2)], ["bliss", mon("Blissey", "Natural Cure")]] } });
    const result = ready(input);
    expect(result.replaced?.[OR]?.entered).toEqual([{ id: "lax", chance: 1 }]);
    expect(result.replaced?.[OL]?.entered).toEqual([{ id: "bliss", chance: 0.75 }]);
    const both = outcomesOf(input).find((outcome) => outcome.mons[OL]?.id === "bliss")!;
    expect([both.chance, both.benched?.own?.find((each) => each.id === "slot:own-left")?.build.status]).toEqual([0.75, ""]);
  });
  it("Shed Tail passes its Substitute; the later Body Slam breaks it (G4-SWX-19)", async () => {
    const result = ready(await turn("sv", [act(fast("sv", mon("Cyclizar", "Regenerator")), "Shed Tail"), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["lax", L("sv", 2)]] } }));
    const hit = hitOf(stepOf(result, PL, "bodyslam"), OL, "lax");
    expect([hit.kind, texts(hit.facts)]).toEqual(["substitute", ["Its Substitute breaks. @1"]]);
    expect(range(result.hpEntered![OL]!.lax)).toEqual([235, 235]);
  });
  it("Teleport switches at −6 in Sword/Shield and fails in Ultra Sun/Ultra Moon (G4-SWX-21)", async () => {
    const run = async (game: Game) => ready(await turn(game, [act(mon("Arcanine", "Justified"), "Teleport"), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))],
      { bench: { own: [["lax", { ...L(game, 2), item: "Leftovers", hp: 150 }]] } }));
    const swsh = await run("swsh");
    expect(swsh.replaced?.[OL]?.entered).toEqual([{ id: "lax", chance: 1 }]);
    expect(endOf(swsh).residuals.map((each) => [each.slot, each.id, each.effect, each.min])).toEqual([[OL, "lax", "Leftovers", 14]]);
    const usum = await run("usum");
    expect([usum.replaced, texts(stepOf(usum, OL, "teleport").facts)]).toEqual([undefined, ["Teleport fails. @1"]]);
  });
  it("Volt Switch into a Ground type does not switch; Dragon Tail drags at random (G4-SWX-22)", async () => {
    const result = ready(await turn("sv", [act(fast("sv", mon("Jolteon", "Volt Absorb")), "Volt Switch", PL), idle(L("sv", 1)), act(chomp(), "Dragon Tail", OR), idle(L("sv", 3))], {
      bench: { own: [["lax", { ...L("sv", 2), hp: 150 }], ["bliss", mon("Blissey", "Natural Cure", { hp: 120 })]], opponent: [["olax", L("sv", 5)]] },
    }));
    expect(result.replaced?.[OL]).toBeUndefined();
    expect(result.replaced?.[OR]?.entered).toEqual([{ id: "lax", chance: 0.5 }, { id: "bliss", chance: 0.5 }]);
  });
  it("U-turn into an Eject Button holder: the holder leaves, the U-turn user stays (G4-SWX-23, B8)", async () => {
    const result = ready(await turn("sv", [act(uturner("sv"), "U-turn", PL), idle(L("sv", 1)), act({ ...L("sv", 4), item: "Eject Button" }, "Body Slam", OR), act(L("sv", 3), "Body Slam", PL)],
      { bench: { own: [["own", L("sv", 5)]], opponent: [["lax", L("sv", 2)]] } }));
    expect(result.replaced?.[OL]).toBeUndefined();
    expect(result.replaced?.[PL]?.entered).toEqual([{ id: "lax", chance: 1 }]);
    expect(range(hitOf(stepOf(result, PR, "bodyslam"), PL, "lax"))).toEqual([75, 88]);
  });
  it("Parting Shot's drops set off no Eject Pack; its user switches (G4-SWX-24, B12)", async () => {
    const result = ready(await turn("sv", [act(fast("sv", mon("Incineroar", "Blaze")), "Parting Shot", PL), idle(L("sv", 1)), act({ ...L("sv", 4), item: "Eject Pack" }, "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["corv", mon("Corviknight", "Pressure")]], opponent: [["lax", L("sv", 2)]] } }));
    expect(result.replaced?.[PL]).toBeUndefined();
    expect(range(hitOf(stepOf(result, PL, "bodyslam"), OL, "corv"))).toEqual([16, 20]);
  });
  it("a U-turn user that faints to Rough Skin does not switch (G4-SWX-26)", async () => {
    const result = ready(await turn("sv", [act(uturner("sv", { hp: 10 }), "U-turn", PL), idle(L("sv", 1)), act(chomp(), "Body Slam", OL), idle(L("sv", 3))], { bench: { own: [["lax", L("sv", 2)]] } }));
    expect([result.replaced, result.hpEntered, result.hp[OL]!.koChance]).toEqual([undefined, undefined, 1]);
  });
  it("Wimp Out mid-turn (G4-SWX-29)", async () => {
    const result = ready(await turn("swsh", [act(fast("swsh", chomp()), "Body Slam", PL), act(L("swsh", 1), "Body Slam", PL), idle(mon("Wimpod", "Wimp Out")), idle(L("swsh", 3))],
      { bench: { opponent: [["lax", L("swsh", 2)]] } }));
    expect(texts(stepOf(result, OL, "bodyslam").facts)).toEqual(["Wimp Out: Wimpod switches out. @1", "Wimpod switches out; Snorlax (opponent's, 2) comes in. @1"]);
    expect(range(result.replaced![PL]!.left[0].hp)).toEqual([5, 20]);
  });
  it("an Intimidate newcomer sets off a foe's Eject Pack: a second request, from the other side (G4-SWX-30)", async () => {
    const result = ready(await turn("sv", [act(uturner("sv"), "U-turn", PR), act(mon("Venusaur", "Overgrow"), "Tackle", PL), idle({ ...L("sv", 4), item: "Eject Pack" }), idle(L("sv", 3))],
      { bench: { own: [["inci", mon("Incineroar", "Intimidate", { evs: { spe: 8 } })]], opponent: [["lax", L("sv", 2)]] } }));
    expect(texts(stepOf(result, OL, "uturn").facts)).toEqual([
      "Ambipom switches out; Incineroar comes in. @1", "Snorlax (1)'s Eject Pack is used up. @1", "Snorlax (1): −1 Attack. @1", "Snorlax (2): −1 Attack. @1",
      "Snorlax (1) switches out; Snorlax (3) comes in. @1",
    ]);
    expect(range(hitOf(stepOf(result, OR, "tackle"), PL, "lax"))).toEqual([19, 23]);
  });
});

describe("the entry pipeline (hazards, Starts, items: runSwitch)", () => {
  it("a Supreme Overlord newcomer: its Start changes nothing this turn reads (GF-OVERLORD)", async () => {
    const result = ready(await turn("sv", [act(uturner("sv"), "U-turn", PL), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["gambit", mon("Kingambit", "Supreme Overlord", { build: { faintedAllies: 2 } })]] } }));
    expect(range(hitOf(stepOf(result, PL, "bodyslam"), OL, "gambit"))).toEqual([22, 27]);
  });
  it("a Terastallized Ogerpon-Wellspring newcomer is its Tera form: Embody Aspect gives +1 Sp. Def at each entry (GF-EMBODY)", async () => {
    const oger = mon("Ogerpon-Wellspring", "Water Absorb", { item: "Wellspring Mask", build: { mechanic: "tera", configuration: { teraType: "Water" } } });
    const result = ready(await turn("sv", [act(uturner("sv"), "U-turn", PL), idle(L("sv", 1)), act(L("sv", 4), "Hyper Voice"), idle(L("sv", 3))], { bench: { own: [["oger", oger]] } }));
    expect(texts(stepOf(result, OL, "uturn").facts)).toEqual(["Ambipom switches out; Ogerpon-Wellspring comes in. @1", "Ogerpon-Wellspring: +1 Sp. Def. @1"]);
    expect(range(hitOf(stepOf(result, PL, "hypervoice"), OL, "oger"))).toEqual([19, 24]);
    // Not Terastallized: its mask's form with Water Absorb, no boost.
    const plain = ready(await turn("sv", [act(uturner("sv"), "U-turn", PL), idle(L("sv", 1)), act(L("sv", 4), "Hyper Voice"), idle(L("sv", 3))],
      { bench: { own: [["oger", mon("Ogerpon-Wellspring", "Water Absorb", { item: "Wellspring Mask" })]] } }));
    expect(range(hitOf(stepOf(plain, PL, "hypervoice"), OL, "oger"))).toEqual([28, 34]);
  });
  it("Stealth Rock takes half of a Charizard (G4-SWX-03, B3)", async () => {
    const result = ready(await turn("sv", [act(uturner("sv"), "U-turn", PL), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["zard", mon("Charizard", "Blaze")]] }, hazards: { own: { stealthRock: true } } }));
    const zard = result.hpEntered![OL]!.zard;
    expect([zard.min, zard.max, zard.losses]).toEqual([1, 13, [{ text: "Charizard loses 76 HP (Stealth Rock).", chance: 1 }]]);
  });
  it("Stealth Rock and two layers of Spikes; G-Max Steelsurge and Spikes in Sword/Shield (IN-HZD-01)", async () => {
    const sv = ready(await turn("sv", [act(uturner("sv"), "U-turn", PL), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["arca", mon("Arcanine", "Justified")]] }, hazards: { own: { stealthRock: true, spikes: 2 } } }));
    expect(sv.hpEntered![OL]!.arca.losses).toEqual([{ text: "Arcanine loses 41 HP (Stealth Rock).", chance: 1 }, { text: "Arcanine loses 27 HP (Spikes).", chance: 1 }]);
    const swsh = ready(await turn("swsh", [act(uturner("swsh"), "U-turn", PL), idle(L("swsh", 1)), act(L("swsh", 4), "Body Slam", OL), idle(L("swsh", 3))],
      { bench: { own: [["lax", L("swsh", 2)]] }, hazards: { own: { steelsurge: true, spikes: 1 } } }));
    expect(swsh.hpEntered![OL]!.lax.losses).toEqual([{ text: "Snorlax (yours, 2) loses 29 HP (Spikes).", chance: 1 }, { text: "Snorlax (yours, 2) loses 29 HP (G-Max Steelsurge).", chance: 1 }]);
  });
  it("Toxic Spikes: bad poison at two layers (SV), poison at one (USUM), and the end of turn's poison (IN-HZD-02)", async () => {
    const run = async (game: Game, layers: 1 | 2) => ready(await turn(game, [act(uturner(game), "U-turn", PL), idle(L(game, 1)), idle(L(game, 4)), idle(L(game, 3))],
      { bench: { own: [["lax", L(game, 2)]] }, hazards: { own: { toxicSpikes: layers } } }));
    const sv = await run("sv", 2);
    expect(texts(stepOf(sv, OL, "uturn").facts)).toContain("Toxic Spikes: Snorlax (yours, 2) is badly poisoned. @1");
    expect(endOf(sv).residuals.map((each) => [each.id, each.effect, each.min])).toEqual([["lax", "Bad poison", -14]]);
    const usum = await run("usum", 1);
    expect(endOf(usum).residuals.map((each) => [each.id, each.effect, each.min])).toEqual([["lax", "Poison", -29]]);
  });
  it("a grounded Poison-type newcomer takes the Toxic Spikes away (IN-HZD-03)", async () => {
    const input = await turn("sv", [act(uturner("sv"), "U-turn", PL), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["pex", mon("Toxapex", "Limber")]] }, hazards: { own: { toxicSpikes: 1 } } });
    const result = ready(input);
    expect(texts(stepOf(result, OL, "uturn").facts)).toContain("Toxapex takes away the Toxic Spikes. @1");
    expect(result.hpEntered![OL]!.pex.conditions).toBeUndefined();
  });
  it("Sticky Web on a Defiant newcomer: −1 Speed, +2 Attack (IN-HZD-04)", async () => {
    const result = ready(await turn("sv", [act(uturner("sv"), "U-turn", PL), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["gambit", mon("Kingambit", "Defiant")]] }, hazards: { own: { stickyWeb: true } } }));
    expect(texts(stepOf(result, OL, "uturn").facts)).toEqual(expect.arrayContaining(["Sticky Web: Kingambit is caught. @1", "Kingambit: +2 Attack, −1 Speed. @1"]));
  });
  it("Heavy-Duty Boots keep the hazards off (IN-HZD-05)", async () => {
    const result = ready(await turn("sv", [act(uturner("sv"), "U-turn", PL), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["zard", mon("Charizard", "Blaze", { item: "Heavy-Duty Boots" })]] }, hazards: { own: { stealthRock: true, spikes: 1 } } }));
    expect([result.hpEntered![OL]!.zard.losses, ...range(result.hpEntered![OL]!.zard)]).toEqual([undefined, 77, 89]);
  });
  it("a newcomer under a foe's Neutralizing Gas has no Intimidate (G4-SWX-14)", async () => {
    const result = ready(await turn("sv", [act(uturner("sv"), "U-turn", PR), idle(L("sv", 1)), act(mon("Weezing-Galar", "Neutralizing Gas"), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["inci", mon("Incineroar", "Intimidate", { evs: { spe: 8 } })]] } }));
    expect(texts(stepOf(result, OL, "uturn").facts)).toEqual(["Ambipom switches out; Incineroar comes in. @1"]);
    expect(range(hitOf(stepOf(result, PL, "bodyslam"), OL, "inci"))).toEqual([33, 39]);
  });
  it("an Imposter newcomer transforms into the foe across (G4-SWX-16)", async () => {
    const result = ready(await turn("sv", [act(uturner("sv"), "U-turn", PR), idle(L("sv", 1)), act(chomp({ ...slowest("sv"), item: "Choice Scarf" }), "Dragon Claw", OL), idle(L("sv", 3))],
      { bench: { own: [["ditto", mon("Ditto", "Imposter")]] } }));
    expect(texts(stepOf(result, OL, "uturn").facts)).toContain("Ditto transforms into Garchomp. @1");
    const hit = hitOf(stepOf(result, PL, "dragonclaw"), OL, "ditto");
    expect([hit.min, hit.max]).toEqual([132, 156]);
    expect(hit.koChance).toBeCloseTo(1, 12);
  });
  it("a Drizzle newcomer weakens the later Flamethrower and takes a spread Rock Slide (G4-SWX-17, B11)", async () => {
    const result = ready(await turn("sv", [act(uturner("sv"), "U-turn", PR), idle(L("sv", 1)), act(chomp(slowest("sv")), "Rock Slide"), act(L("sv", 3), "Flamethrower", OR)],
      { bench: { own: [["peli", mon("Pelipper", "Drizzle")]] } }));
    expect(range(hitOf(stepOf(result, PL, "rockslide"), OL, "peli"))).toEqual([58, 70]);
    expect(range(hitOf(stepOf(result, PR, "flamethrower"), OR))).toEqual([5, 7]);
  });
  it("keeps the narrow reasons: a gas newcomer, Commander's pair, a gas holder leaving (G4-SWX-15, -20, -25)", async () => {
    expect(reason(await turn("sv", [act(uturner("sv"), "U-turn", PR), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["weez", mon("Weezing-Galar", "Neutralizing Gas")]] } }))).toBe(REASONS.entersWithGas("Weezing-Galar"));
    expect(reason(await turn("sv", [act(uturner("sv"), "U-turn", PR), idle(mon("Dondozo", "Unaware")), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["tats", mon("Tatsugiri", "Commander")]] } }))).toBe(REASONS.notIn2v2("Commander"));
    expect(reason(await turn("sv", [idle(mon("Weezing-Galar", "Neutralizing Gas", { item: "Eject Button" })), idle(L("sv", 1)), act(fast("sv", chomp()), "Body Slam", OL),
      idle(mon("Incineroar", "Intimidate", { evs: { spe: 8 } }))], { bench: { own: [["lax", L("sv", 2)]] } }))).toBe(REASONS.gasEnds);
  });
});

describe("the switches after the residual and the end of turn with the newcomer", () => {
  it("Emergency Exit after the burn: the newcomer comes in after the turn and meets Stealth Rock (G4-SWX-12)", async () => {
    const input = await turn("champions", [act(L("champions", 4), "Body Slam", PR), idle(L("champions", 1)), idle(mon("Golisopod", "Emergency Exit", { hp: 80, status: "brn" })), idle(L("champions", 3))],
      { bench: { opponent: [["lax", { ...L("champions", 2), hp: 200 }]] }, hazards: { opponent: { stealthRock: true } } });
    const result = ready(input);
    expect([result.replaced, result.facts]).toEqual([undefined, expect.arrayContaining(["Assumes Snorlax (opponent's, 2) comes in for Golisopod."])]);
    const end = endOf(result);
    expect(end.replaced?.[PL]?.entered).toEqual([{ id: "lax", chance: 1 }]);
    expect([end.hpEntered![PL]!.lax.min, end.hpEntered![PL]!.lax.losses]).toEqual([171, [{ text: "Snorlax (opponent's, 2) loses 29 HP (Stealth Rock).", chance: 1 }]]);
    const [outcome] = outcomesOf(input);
    expect([outcome.mons[PL]?.id, outcome.benched?.opponent?.map((each) => [each.id, each.hp, each.build.status])]).toEqual(["lax", [["slot:opponent-left", [{ hp: 71, chance: 1 }], "brn"]]]);
  });
  it("Eject Pack after Syrup Bomb's drop at the residual (G4-SWX-13)", async () => {
    const result = ready(await turn("sv", [idle(L("sv", 4)), idle(L("sv", 1)), idle({ ...L("sv", 2), item: "Eject Pack", carried: { syrupBomb: OL } }), idle(L("sv", 3))],
      { bench: { opponent: [["lax", { ...L("sv", 5), hp: 150 }]] } }));
    const end = endOf(result);
    expect(end.replaced?.[PL]?.entered).toEqual([{ id: "lax", chance: 1 }]);
    expect(end.residuals.find((each) => each.effect === "Eject Pack")?.facts.map((fact) => fact.text)).toEqual(["Switches out after the turn."]);
  });
  it("a Future Sight and a Wish land on the newcomer at the position (T2E-BL-01, -02)", async () => {
    const sight = ready(await turn("sv", [idle(mon("Hatterene", "Magic Bounce")), idle(L("sv", 4)), idle(L("sv", 12)), act(uturner("sv", { carried: { futureMove: { move: "futuresight", source: OL } } }), "U-turn", OR)],
      { bench: { opponent: [["lax", L("sv", 2)]] } }));
    expect(endOf(sight).residuals.filter((each) => (each.min ?? 0) < 0).map((each) => [each.slot, each.id, each.min, each.max])).toEqual([[PR, "lax", -97, -82]]);
    const wish = ready(await turn("sv", [idle(L("sv", 4)), idle(L("sv", 1)), act(uturner("sv", { carried: { wish: 100 } }), "U-turn", OR), idle(L("sv", 3))],
      { bench: { opponent: [["lax", { ...L("sv", 2), hp: 100 }]] } }));
    expect(endOf(wish).residuals.map((each) => [each.slot, each.id, each.effect, each.min])).toEqual([[PL, "lax", "Wish", 100]]);
  });
  it("a landing whose user left lands from the bench: no item, no ability (T2E-BL-03)", async () => {
    const result = ready(await turn("sv", [act(mon("Slowking-Galar", "Regenerator", { item: "Twisted Spoon", nature: "Modest", evs: { spa: 252 } }), "Chilly Reception"),
      idle(L("sv", 4)), idle(L("sv", 12)), idle({ ...L("sv", 8), carried: { futureMove: { move: "futuresight", source: OL } } })], { bench: { own: [["lax", L("sv", 2)]] } }));
    const landing = endOf(result).residuals.filter((each) => each.slot === PR);
    expect(landing.map((each) => [each.min, each.max, each.facts.map((fact) => fact.text)])).toEqual([
      [null, null, ["Slowking-Galar is not in battle: its ability, item and stat changes do not count."]], [-111, -93, []],
    ]);
  });
  it("a landing on a Red Card holder drags its Life Orb user out after the turn, with no Life Orb loss (R-E: RE-FS-RC-LO)", async () => {
    const result = ready(await turn("sv", [idle(mon("Hatterene", "Magic Bounce", { item: "Life Orb" })), idle(L("sv", 4)),
      idle({ ...L("sv", 12), item: "Red Card", carried: { futureMove: { move: "futuresight", source: OL } } }), idle(L("sv", 3))], { bench: { own: [["lax", L("sv", 2)]] } }));
    const end = endOf(result);
    expect(range(end.hp[OL]!)).toEqual([132, 132]);
    expect(end.residuals.some((each) => each.effect === "Life Orb")).toBe(false);
    expect(end.residuals.find((each) => each.effect === "Red Card")?.facts.map((fact) => fact.text)).toEqual(["Dragged out after the turn."]);
  });
});

describe("the bench's readers: Assist, Beat Up, Pursuit (doubles-calling.ts, doubles-presence.ts)", () => {
  const assist = async (allyMoves: boolean, bench: [string, Mon][] | null) => turn("usum", [act(mon("Liepard", "Limber"), "Assist"),
    act(L("usum", 1, allyMoves ? { moves: [] } : {}), "Body Slam", PL), idle(L("usum", 4)), idle(L("usum", 3))], bench ? { bench: { own: bench } } : {});
  it("Assist calls one of the party's move slots at random: the ally's and the bench's (T2P-AST-01)", async () => {
    const result = ready(await assist(true, [["arca", mon("Arcanine", "Justified", { moves: ["Flamethrower"] })], ["lax", L("usum", 2, { moves: ["Ice Beam"] })]]));
    expect(texts(stepOf(result, OL, "assist").facts)).toEqual(["Assist calls Body Slam. @0.3333", "Assist calls Flamethrower. @0.3333", "Assist calls Ice Beam. @0.3333"]);
    expect(result.facts).toContain("Assumes no Pokémon of Liepard's party fainted before this turn.");
    expect([result.hp[PL]!.min, result.hp[PL]!.max, Math.round(result.hp[PL]!.average * 1000) / 1000]).toEqual([98, 160, 141.167]);
  });
  it("Assist leaves out the noassist moves (Protect, Roar) (T2P-AST-02)", async () => {
    const result = ready(await assist(true, [["arca", mon("Arcanine", "Justified", { moves: ["Protect", "Roar", "Will-O-Wisp"] })], ["lax", L("usum", 2, { moves: ["Thunderbolt", "Protect"] })]]));
    expect(texts(stepOf(result, OL, "assist").facts)).toEqual(["Assist calls Body Slam. @0.3333", "Assist calls Will-O-Wisp. @0.3333", "Assist calls Thunderbolt. @0.3333"]);
  });
  it("Assist without the party's moves keeps its reason: no bench, or a party member's moves not given", async () => {
    const needs = REASONS.needsParty("Assist", "Liepard");
    expect(reason(await assist(true, null))).toBe(needs);
    expect(reason(await assist(false, [["arca", mon("Arcanine", "Justified", { moves: ["Flamethrower"] })]]))).toBe(needs);
    expect(reason(await assist(true, [["arca", mon("Arcanine", "Justified")]]))).toBe(needs);
  });
  it("Beat Up counts the bench: a paralysed member does not hit (T2P-BTR-01)", async () => {
    const result = ready(await turn("sv", [act(mon("Houndoom", "Flash Fire"), "Beat Up", PL), idle(L("sv", 1)), idle(L("sv", 4)), idle(L("sv", 3))],
      { bench: { own: [["arca", mon("Arcanine", "Justified")], ["lax", L("sv", 2, { status: "par" })]] } }));
    expect(range(hitOf(stepOf(result, OL, "beatup"), PL))).toEqual([36, 45]);
  });
  it("Pursuit runs at the switching target's BeforeSwitchOut at 80 power, even aimed at the other foe (CQ-PUR-R-01, -02)", async () => {
    for (const target of [OL, OR]) {
      const result = ready(await turn("usum", [act(uturner("usum"), "U-turn", PL), idle(L("usum", 1)), act(mon("Houndoom", "Flash Fire"), "Pursuit", target), idle(L("usum", 3))],
        { bench: { own: [["lax", L("usum", 2)]] } }));
      expect(range(hitOf(stepOf(result, PL, "pursuit"), OL))).toEqual([58, 70]);
      expect(range(result.replaced![OL]!.left[0].hp)).toEqual([80, 92]);
    }
  });
  it("a Technician user's Pursuit at a switching target is 80 power, which Technician does not boost (RE-PUR-TECH)", async () => {
    const result = ready(await turn("usum", [act(fast("usum", mon("Ambipom", "Pickup")), "U-turn", PR), idle(L("usum", 1)), act(mon("Scizor", "Technician"), "Pursuit", OL), idle(L("usum", 3))],
      { bench: { own: [["lax", L("usum", 2)]] } }));
    expect(range(hitOf(stepOf(result, PL, "pursuit"), OL))).toEqual([53, 63]);
  });
  it("Baton Pass skips BeforeSwitchOut: no Pursuit at Ambipom; it hits the newcomer at 40 power (GF-PUR-BP)", async () => {
    const result = ready(await turn("usum", [act(fast("usum", mon("Ambipom", "Technician")), "Baton Pass"), idle(L("usum", 1)), act(mon("Houndoom", "Flash Fire"), "Pursuit", OL),
      idle(L("usum", 3))], { bench: { own: [["lax", L("usum", 2)]] } }));
    expect([...range(result.hp[OL]!), ...range(hitOf(stepOf(result, PL, "pursuit"), OL, "lax"))]).toEqual([150, 150, 30, 36]);
  });
  it("Pursuit after a Red Card's drag hits the newcomer at 40 power: a newcomer of the turn is not the guarded switch before the moves (GF-PUR-DRAG)", async () => {
    const result = ready(await turn("usum", [act(fast("usum", chomp()), "Dragon Claw", PL), idle(L("usum", 1)), idle({ ...L("usum", 4), item: "Red Card" }),
      act(mon("Houndoom", "Flash Fire"), "Pursuit", OL)], { bench: { own: [["lax", L("usum", 3)], ["lax9", L("usum", 9)]] } }));
    const pursuit = stepOf(result, PR, "pursuit");
    expect([range(hitOf(pursuit, OL, "lax")), range(hitOf(pursuit, OL, "lax9"))]).toEqual([[30, 36], [30, 36]]);
  });
  it("the leaver's Destiny Bond ends at its BeforeSwitchOut, before the Pursuit that knocks it out (RE-PUR-DB)", async () => {
    const result = ready(await turn("usum", [act(fast("usum", mon("Gengar", "Cursed Body", { item: "Eject Button" })), "Destiny Bond"), idle(L("usum", 1)),
      act(mon("Tyranitar", "Unnerve"), "Pursuit", OR), act({ ...L("usum", 3), evs: { spe: 252 } }, "Crunch", OL)], { bench: { own: [["lax", L("usum", 2)]] } }));
    expect([result.hp[OL]!.koChance, ...range(result.hp[PL]!), result.hp[PL]!.koChance]).toEqual([1, 175, 175, 0]);
  });
});

describe("the after-move items with a bench (afterMoveSecondaryEvent)", () => {
  it("a Sheer Force move with an added effect sets off no Red Card and no Eject Button (RE-SF-RC, RE-SF-EB)", async () => {
    for (const item of ["Red Card", "Eject Button"]) {
      for (const game of ["sv", "champions"] as const) {
        const result = ready(await turn(game, [act(fast(game, mon("Feraligatr", "Sheer Force")), "Ice Beam", PL), idle(L(game, 1)), act({ ...L(game, 4), item }, "Body Slam", OL), idle(L(game, 3))],
          { bench: { own: [["lax", L(game, 2)]], opponent: [["lax2", L(game, 2)]] } }));
        expect(result.replaced).toBeUndefined();
        expect(stepOf(result, PL, "bodyslam").moves).toBe(1);
      }
    }
  });
  it("Red Card against a Life Orb attacker: its drag stops the Life Orb, which the step took (RE-RC-LO)", async () => {
    const card = (game: Game, attacker: Partial<Mon>, more: More) => turn(game, [act(fast(game, chomp({ item: "Life Orb", ...attacker })), "Dragon Claw", PL), idle(L(game, 1)),
      idle({ ...L(game, 4), item: "Red Card" }), idle(L(game, 3))], more);
    const combo = REASONS.combo("Red Card", "Life Orb");
    expect(reason(await card("sv", {}, { bench: { own: [["lax", L("sv", 2)]] } }))).toBe(combo);
    // One the step's Life Orb knocked out: the card dragged it first.
    expect(reason(await card("sv", { hp: 10 }, { bench: { own: [["lax", L("sv", 2)]] } }))).toBe(combo);
    // No bench and no later action (Trick Room): the moves are estimated, so the same reason; with a later action, today's.
    expect(reason(await card("sv", {}, { field: { trickRoom: true } }))).toBe(combo);
    expect(reason(await card("sv", {}, {}))).toBe(REASONS.switchesOut("Garchomp"));
  });
  it("a Life Orb Dragon Tail into a Red Card holder drags the holder first: no Red Card, the Life Orb loss stands (RE-RC-DT)", async () => {
    const result = ready(await turn("sv", [act(fast("sv", chomp({ item: "Life Orb" })), "Dragon Tail", PL), idle(L("sv", 1)), idle({ ...L("sv", 4), item: "Red Card" }), idle(L("sv", 3))],
      { bench: { own: [["lax", L("sv", 2)]], opponent: [["lax2", L("sv", 5)]] } }));
    expect([...range(result.hp[OL]!), result.replaced?.[OL], result.replaced?.[PL]?.entered]).toEqual([165, 165, undefined, [{ id: "lax2", chance: 1 }]]);
  });
  // One AfterMoveSecondary event over a spread move's targets (contested): Eject Button before Red Card, each by its holder's
  // Speed; the first that acts stops the others of its kind, whose holders keep their items.
  it("Rock Slide into two Eject Button holders: the faster one leaves, the other keeps its button and moves (GF-EB-SPREAD)", async () => {
    const input = await turn("sv", [act(fast("sv", chomp()), "Rock Slide"), idle(L("sv", 1)), act({ ...L("sv", 4), item: "Eject Button" }, "Body Slam", OL),
      act({ ...L("sv", 3), item: "Eject Button" }, "Body Slam", OL)], { bench: { opponent: [["lax2", L("sv", 5)], ["lax3", L("sv", 6)]] } });
    const result = ready(input);
    expect([result.replaced?.[PL]?.entered, result.replaced?.[PR]]).toEqual([[{ id: "lax2", chance: 1 }], undefined]);
    expect(texts(stepOf(result, PL, "bodyslam").skipped)).toEqual(["Switches out before it moves. @1"]);
    expect(range(hitOf(stepOf(result, PR, "bodyslam"), OL))).toEqual([55, 66]);
    const [outcome] = outcomesOf(input);
    expect([outcome.mons[PL]?.id, outcome.mons[PR]?.build.itemId, outcome.benched?.opponent?.map((each) => each.build.itemId)]).toEqual(["lax2", "ejectbutton", [""]]);
  });
  it("two Eject Button holders of equal Speed: either leaves at random (GF-EB-SPREAD-TIE)", async () => {
    const result = ready(await turn("sv", [act(chomp({ level: 1 }), "Rock Slide"), idle(L("sv", 1)), idle({ ...L("sv", 4), item: "Eject Button" }),
      idle({ ...L("sv", 4), item: "Eject Button", hp: 200 })], { bench: { opponent: [["lax2", L("sv", 5)]] } }));
    expect([result.replaced?.[PL]?.entered, result.replaced?.[PR]?.entered]).toEqual([[{ id: "lax2", chance: 0.5 }], [{ id: "lax2", chance: 0.5 }]]);
  });
  it("Rock Slide into two Red Card holders: the faster holder's card drags Garchomp out, the other keeps its card (GF-RC-SPREAD)", async () => {
    const input = await turn("sv", [act(fast("sv", chomp()), "Rock Slide"), idle(L("sv", 1)), idle({ ...L("sv", 4), item: "Red Card" }), idle({ ...L("sv", 3), item: "Red Card" })],
      { bench: { own: [["lax", L("sv", 2)]] } });
    expect(ready(input).replaced?.[OL]?.entered).toEqual([{ id: "lax", chance: 1 }]);
    const [outcome] = outcomesOf(input);
    expect([outcome.mons[PL]?.build.itemId, outcome.mons[PR]?.build.itemId]).toEqual(["", "redcard"]);
  });
  // The face's hit (doubles-faces.ts afterMoveItems): its Eject Button waits for no U-turn, and with a bench R's switchOut
  // uses the item up.
  it("a U-turn into Disguise with an Eject Button: the holder leaves, the U-turn user stays (RE-FACE-EB-UT)", async () => {
    const result = ready(await turn("sv", [act(fast("sv", mon("Ambipom", "Pickup")), "U-turn", PR), idle(L("sv", 1)), act(L("sv", 3), "Body Slam", OL),
      idle(mon("Mimikyu", "Disguise", { item: "Eject Button" }))], { bench: { own: [["lax", L("sv", 2)]], opponent: [["lax2", L("sv", 5)]] } }));
    expect([result.replaced?.[OL], result.replaced?.[PR]?.entered]).toEqual([undefined, [{ id: "lax2", chance: 1 }]]);
    expect(range(result.hp[OL]!)).toEqual([63, 77]);
  });
  it("Disguise with a Red Card drags its attacker out (RE-FACE-RC)", async () => {
    const result = ready(await turn("sv", [act(fast("sv", chomp()), "Iron Head", PR), idle(L("sv", 1)), act(L("sv", 3), "Body Slam", OL),
      idle(mon("Mimikyu", "Disguise", { item: "Red Card" }))], { bench: { own: [["lax", L("sv", 2)]], opponent: [["lax2", L("sv", 5)]] } }));
    expect(result.replaced?.[OL]?.entered).toEqual([{ id: "lax", chance: 1 }]);
  });
});

describe("Training's replacement order (DoublesTurnInput.replacementOrder; USER-DECISIONS Q9, not a Showdown rule)", () => {
  // Ambipom takes Garchomp's Dragon Claw (56–71 of 150 HP) and U-turns out; Corviknight U-turns out after it. Blissey on the
  // bench at 139 of 330 HP (a share inside Ambipom's range).
  const both = (order: NonNullable<DoublesTurnInput["replacementOrder"]>["own"]) => turn("sv", [act(mon("Ambipom", "Technician"), "U-turn", PR),
    act(mon("Corviknight", "Pressure"), "U-turn", PR), act(fast("sv", chomp()), "Dragon Claw", OL), idle(L("sv", 2))],
  { bench: { own: [["x", L("sv", 1)], ["blis", mon("Blissey", "Natural Cure", { hp: 139 })]] }, ...(order ? { replacementOrder: { own: order } } : {}) });
  it("healthiest: the bench Pokémon with the highest HP share at each switch, a Pokémon that left earlier included; its HP splits the world where it decides; no fact", async () => {
    const input = await both("healthiest");
    const result = ready(input);
    expect(result.replaced?.[OL]?.entered).toEqual([{ id: "x", chance: 1 }]);
    expect(result.replaced?.[OR]?.entered).toEqual([{ id: "blis", chance: 0.5 }, { id: startId(OL), chance: 0.5 }]);
    expect(result.facts.filter((fact) => fact.startsWith("Assumes"))).toEqual([]);
    // Ambipom comes back exactly where its share is above Blissey's (139 / 330 = 63.2 / 150), and stays out where it is not.
    const outcomes = outcomesOf(input);
    const back = outcomes.filter((each) => each.mons[OR]?.id === startId(OL)).flatMap((each) => each.mons[OR]!.hp.map((hp) => hp.hp));
    const out = outcomes.filter((each) => each.mons[OR]?.id === "blis").flatMap((each) => each.benched!.own!.find((mon) => mon.id === startId(OL))!.hp.map((hp) => hp.hp));
    expect([Math.min(...back), Math.max(...back), Math.min(...out), Math.max(...out)]).toEqual([65, 71, 56, 63]);
  });
  it("a list: the first Pokémon on it still on the bench; without an order, the default with its facts", async () => {
    const listed = ready(await both(["blis", startId(OL), "x"]));
    expect([listed.replaced?.[OL]?.entered, listed.replaced?.[OR]?.entered]).toEqual([[{ id: "blis", chance: 1 }], [{ id: startId(OL), chance: 1 }]]);
    const plain = ready(await both(undefined));
    expect([plain.replaced?.[OL]?.entered, plain.replaced?.[OR]?.entered]).toEqual([[{ id: "x", chance: 1 }], [{ id: "blis", chance: 1 }]]);
    expect(plain.facts).toContain("Assumes Blissey comes in for Corviknight.");
  });
  it("names only its side's Pokémon", async () => {
    const result = calculateDoublesTurn(await both(["blis", "nobody"]));
    expect(result.status === "issues" && result.issues.field.map((issue) => issue.message)).toEqual(["A replacement order names a Pokémon that is not on its side."]);
  });
});

describe("no bench, an empty bench", () => {
  const uturn = (more: More) => turn("sv", [act(fast("sv", mon("Rillaboom", "Overgrow")), "U-turn", PL), idle(L("sv", 1)), act(chomp(), "Dragon Claw", OL), idle(L("sv", 3))], more);
  it("without a bench the replacement is not known (REASONS.switchesOut, kept)", async () => {
    expect(reason(await uturn({}))).toBe(REASONS.switchesOut("Rillaboom"));
  });
  it("an empty bench is no Pokémon left: U-turn does not switch", async () => {
    const result = ready(await uturn({ bench: { own: [] } }));
    expect([result.replaced, texts(stepOf(result, OL, "uturn").facts)]).toEqual([undefined, []]);
  });
});

describe("integration 2: the census sample's newcomers and the switch facts", () => {
  it("a Tatsugiri newcomer beside a Pokémon that is not a Dondozo: its Commander does nothing; the later Body Slam hits it (G4-SWX-82)", async () => {
    const input = await turn("sv", [act(uturner("sv"), "U-turn", PR), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["tats", mon("Tatsugiri", "Commander")]] } });
    const result = ready(input);
    expect(result.replaced?.[OL]?.entered).toEqual([{ id: "tats", chance: 1 }]);
    expect(range(hitOf(stepOf(result, PL, "bodyslam"), OL, "tats"))).toEqual([78, 93]);
    expect(outcomesOf(input).every((outcome) => outcome.mons[OL]?.id === "tats" && !outcome.mons[OL]?.volatiles?.includes("commanding"))).toBe(true);
  });
  it("a newcomer has not used Minimize: no `Assumes … has not used Minimize.` for it; the Pokémon in from the start keeps the fact", async () => {
    const newcomer = ready(await turn("sv", [act(uturner("sv"), "U-turn", PR), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["inci", mon("Incineroar", "Blaze")]] } }));
    expect(newcomer.facts.filter((fact) => fact.includes("Minimize"))).toEqual([]);
    const stays = ready(await turn("sv", [idle(uturner("sv")), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["inci", mon("Incineroar", "Blaze")]] } }));
    expect(stays.facts.filter((fact) => fact.includes("Minimize"))).toEqual(["Assumes Ambipom has not used Minimize."]);
  });
  it("a party cure reaches the bench: a bench newcomer later this turn enters cured (V-HB-TOX), and so does a leaver that comes back (review 2 R2-A2A3-H-2)", async () => {
    // Pinned healbell onHit cures target.side.pokemon, the bench included (cureStatus works off the field): the newcomer has no status.
    const healBell = await turn("sv", [act(fast("sv", mon("Blissey", "Natural Cure")), "Heal Bell"), act(mon("Scizor", "Technician", slowest("sv")), "U-turn", PL), idle(L("sv", 4)), idle(L("sv", 3))],
      { bench: { own: [["laxt", { ...L("sv", 2), status: "tox" }]] } });
    expect(endOf(ready(healBell)).residuals.filter((each) => each.slot === OR)).toEqual([]);
    expect(outcomesOf(healBell).map((outcome) => [outcome.mons[OR]?.id, outcome.mons[OR]?.build.status])).toEqual([["laxt", ""]]);
    // A poisoned Ambipom U-turns out first, Heal Bell cures it on the bench, Roar drags it back in: it comes back cured (the
    // oracle does not follow a Pokémon coming in a second time; World.benched is cured as SideState.benchCured is set).
    const back = await turn("sv", [act(fast("sv", mon("Ambipom", "Technician", { status: "psn" })), "U-turn", PL), act(mon("Blissey", "Natural Cure"), "Heal Bell"),
      act(mon("Arcanine", "Intimidate", slowest("sv")), "Roar", OL), idle(L("sv", 3))], { bench: { own: [["lax9", L("sv", 9)]] } });
    expect(endOf(ready(back)).residuals.filter((each) => each.slot === OL)).toEqual([]);
    expect(outcomesOf(back).map((outcome) => [outcome.mons[OL]?.id, outcome.mons[OL]?.build.status])).toEqual([[undefined, ""]]);
  });
  it("Pastel Veil's onAnySwitchIn: a poisoned newcomer beside the holder is cured as it comes in (review 2 R1-A1K-03, K1-PASTEL-NEWCOMER, V3-PV-TOX)", async () => {
    // Pinned pastelveil onAnySwitchIn runs its Start again: cureStatus on each poisoned Pokémon of the holder's side.
    const own = await turn("swsh", [act(uturner("swsh"), "U-turn", PL), idle(mon("Rapidash-Galar", "Pastel Veil")), idle(L("swsh", 2)), idle(L("swsh", 1))],
      { bench: { own: [["laxp", { ...L("swsh", 3), status: "psn" }]] } });
    const result = ready(own);
    expect(texts(stepOf(result, OL, "uturn").facts)).toContain("Pastel Veil: Snorlax (yours) is cured of its poison. @1");
    expect(endOf(result).residuals.filter((each) => each.slot === OL)).toEqual([]);
    expect(outcomesOf(own).map((outcome) => [outcome.mons[OL]?.id, outcome.mons[OL]?.build.status])).toEqual([["laxp", ""]]);
    // The holder on the opponent's side, a badly poisoned newcomer: no Bad poison at the end of turn.
    const opponent = await turn("swsh", [idle(L("swsh", 2)), idle(L("swsh", 1)), act(uturner("swsh"), "U-turn", OL), idle(mon("Rapidash-Galar", "Pastel Veil"))],
      { bench: { opponent: [["laxt", { ...L("swsh", 3), status: "tox" }]] } });
    expect(endOf(ready(opponent)).residuals.filter((each) => each.slot === PL)).toEqual([]);
    expect(outcomesOf(opponent).map((outcome) => [outcome.mons[PL]?.id, outcome.mons[PL]?.build.status])).toEqual([["laxt", ""]]);
  });
  it("a status move's switch with a bench is stated once, as it is made (Parting Shot, Roar); without a bench `{Name} switches out.` stays", async () => {
    const parting = ready(await turn("champions", [act(fast("champions", mon("Incineroar", "Blaze")), "Parting Shot", PL), idle(L("champions", 1)),
      act(chomp(slowest("champions")), "Dragon Claw", OL), idle(L("champions", 3))],
    { bench: { own: [["lax", L("champions", 2)], ["corv", mon("Corviknight", "Pressure")]] }, replacement: { [OL]: "corv" } }));
    expect(texts(stepOf(parting, OL, "partingshot").facts)).toEqual(["Incineroar switches out; Corviknight comes in. @1"]);
    const roar = ready(await turn("swsh", [act(mon("Arcanine", "Justified"), "Roar", PL), idle(L("swsh", 1)), act(L("swsh", 4), "Body Slam", OR), idle(L("swsh", 3))], {
      bench: { opponent: [["lax", { ...L("swsh", 2), item: "Leftovers", hp: 150 }], ["bliss", mon("Blissey", "Natural Cure", { item: "Leftovers", hp: 200 })]] },
    }));
    expect(texts(stepOf(roar, OL, "roar").facts)).toEqual(["Roar: Snorlax (opponent's, 1) is dragged out; Snorlax (opponent's, 3) comes in. @0.5", "Roar: Snorlax (opponent's, 1) is dragged out; Blissey comes in. @0.5"]);
    // No bench and no later action: the switch reaches only the end of turn, and the step states it.
    const alone = ready(await turn("sv", [act(mon("Arcanine", "Justified"), "Roar", PL), idle(L("sv", 1)), idle(L("sv", 4)), idle(L("sv", 3))]));
    expect([texts(stepOf(alone, OL, "roar").facts), alone.endOfTurn.status === "not-estimated" && alone.endOfTurn.reason]).toEqual([["Snorlax (opponent's, 1) switches out. @1"], REASONS.switchesOut("Snorlax (opponent's, 1)")]);
  });
});

describe("review 2 (R7-1..R7-3): Heal Block at the kernel's Update, the hazards' order, a Dynamaxed bench build", () => {
  it("Heal Block keeps an HP Berry at the kernel's Update: Baton Pass's newcomer, an Unnerve holder gone, a fixed loss (R7-1, RV2-R7-BP-HB2, -UNNERVE-HB, -PD-HB-POUCH, -PD-HB-SPIKY)", async () => {
    // Pinned sitrusberry onTryEatItem runs TryHeal, which healblock's onTryHeal fails; Baton Pass copies healblock.
    const passed = ready(await turn("sv", [act(fast("sv", mon("Ambipom", "Technician", { carried: { healBlock: 1 } })), "Baton Pass"), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))],
      { bench: { own: [["lax", L("sv", 2, { hp: 80, item: "Sitrus Berry" })]] } }));
    const entered = passed.hpEntered?.[OL]?.lax;
    expect(entered && [entered.start, entered.min, entered.max, entered.koChance]).toEqual([80, 0, 5, 0.5625]);
    const unnerve = ready(await turn("sv", [act(fast("sv", chomp()), "Dragon Claw", PL), act(L("sv", 1, { hp: 80, item: "Sitrus Berry", carried: { healBlock: 2 } }), null),
      idle(mon("Tyranitar", "Unnerve", { hp: 1 })), idle(L("sv", 3))]));
    expect(range(unnerve.hp[OR]!)).toEqual([80, 80]);
    // A pinch Berry is eaten; Cheek Pouch heals nothing under Heal Block.
    const pouch = await turn("sv", [act(fast("sv", chomp()), "Dragon Claw", PL), idle(mon("Dedenne", "Cheek Pouch", { hp: 20, item: "Liechi Berry", carried: { healBlock: 2 } })),
      idle(mon("Tyranitar", "Unnerve", { hp: 1 })), idle(L("sv", 3))]);
    expect(range(ready(pouch).hp[OR]!)).toEqual([20, 20]);
    expect(outcomesOf(pouch).map((outcome) => [outcome.mons[OR]?.build.itemId, outcome.mons[OR]?.build.boosts.atk])).toEqual([["", 1]]);
    // The kernel's afterLoss too: Spiky Shield's 1/8 takes a heal-blocked Snorlax under half; it keeps its Sitrus (RV2-PD-HB-SPIKY).
    const spiky = await turn("sv", [act(L("sv", 1, { hp: 130, item: "Sitrus Berry", carried: { healBlock: 2 } }), "Body Slam", PL), idle(L("sv", 0)),
      act(fast("sv", mon("Chesnaught", "Bulletproof")), "Spiky Shield"), idle(L("sv", 2))]);
    expect(range(ready(spiky).hp[OL]!)).toEqual([101, 101]);
    expect(outcomesOf(spiky).map((outcome) => outcome.mons[OL]?.build.itemId)).toEqual(["sitrusberry"]);
  });
  it("hazards act in the order they went up: Sticky Web before a Stealth Rock knock-out (R7-2, RV2-R7-WEBSR-DEF-PRE, -SRWEB-DEF-PRE)", async () => {
    // Pinned resolvePriority gives SwitchIn handlers their effectOrder; fieldEvent skips a fainted holder's after the knock-out.
    const make = (order: DoublesHazards["order"]) => turn("sv", [act(fast("sv", mon("Scizor", "Technician")), "U-turn", PR), idle(L("sv", 1)),
      act({ ...L("sv", 4), item: "Mirror Herb" }, "Body Slam", OR), idle(L("sv", 3))],
    { bench: { own: [["gambit", mon("Kingambit", "Defiant", { hp: 10 })], ["lax", L("sv", 2)]] }, hazards: { own: { stickyWeb: true, stealthRock: true, ...(order ? { order } : {}) } } });
    const webFirst = await make(["stickyweb", "stealthrock"]);
    expect([range(hitOf(stepOf(ready(webFirst), PL, "bodyslam"), OR)), range(ready(webFirst).hp[OR]!)]).toEqual([[147, 174], [61, 88]]);
    expect(outcomesOf(webFirst).map((outcome) => [outcome.mons[PL]?.build.itemId, outcome.mons[PL]?.build.boosts.atk])).toEqual([["", 2]]);
    const rockFirst = await make(["stealthrock", "stickyweb"]);
    expect([range(hitOf(stepOf(ready(rockFirst), PL, "bodyslam"), OR)), range(ready(rockFirst).hp[OR]!)]).toEqual([[75, 88], [147, 160]]);
    expect(outcomesOf(rockFirst).map((outcome) => [outcome.mons[PL]?.build.itemId, outcome.mons[PL]?.build.boosts.atk])).toEqual([["mirrorherb", 0]]);
    // The order not given (the calculator): not estimated where it decides the result; a newcomer the hazards cannot knock out reads none.
    expect(reason(await make(undefined))).toBe(REASONS.hazardOrder("Stealth Rock and Sticky Web", "your side"));
    expect(calculateDoublesTurn(await turn("sv", [act(fast("sv", mon("Scizor", "Technician")), "U-turn", PR), idle(L("sv", 1)),
      act({ ...L("sv", 4), item: "Mirror Herb" }, "Body Slam", OR), idle(L("sv", 3))],
    { bench: { own: [["gambit", mon("Kingambit", "Defiant", { hp: 100 })]] }, hazards: { own: { stickyWeb: true, stealthRock: true } } })).status).toBe("ready");
  });
  it("Toxic Spikes taken away before a knock-out only when they went up first (R7-2, RV2-V-TS-SR-POISON, RV2-PD-SR-TS-POISON)", async () => {
    const make = (order?: DoublesHazards["order"]) => turn("usum", [act(fast("usum", mon("Scizor", "Technician")), "U-turn", PR), idle(L("usum", 1)), idle(L("usum", 4)), idle(L("usum", 3))],
      { bench: { own: [["pex", mon("Toxapex", "Regenerator", { hp: 5 })], ["lax", L("usum", 2)]] }, hazards: { own: { toxicSpikes: 1, stealthRock: true, ...(order ? { order } : {}) } } });
    expect(outcomesOf(await make(["toxicspikes", "stealthrock"])).map((outcome) => outcome.sides.own.hazards ?? [])).toEqual([["stealthrock"]]);
    expect(outcomesOf(await make(["stealthrock", "toxicspikes"])).map((outcome) => [outcome.sides.own.hazards ?? [], outcome.sides.own.hazardsFrom])).toEqual([[[], undefined]]);
    expect(reason(await make())).toBe(REASONS.hazardOrder("Stealth Rock and Toxic Spikes", "your side"));
  });
  it("a bench build with a Dynamax mechanic is refused: a Pokémon on the bench is not Dynamaxed (R7-3)", async () => {
    const input = await turn("swsh", [act(uturner("swsh"), "U-turn", PL), idle(L("swsh", 1)), act(chomp(), "Dragon Claw", OL), idle(L("swsh", 3))],
      { bench: { own: [["lax", L("swsh", 2, { build: { mechanic: "dynamax" } })]] } });
    const result = calculateDoublesTurn(input);
    expect(result.status === "issues" ? result.issues.field : []).toEqual([{ field: "bench.own.0", message: "Bench Snorlax (yours, 2): a Pokémon on the bench is not Dynamaxed." }]);
  });
});

describe("review 2, round 2: the move running at a newcomer's faint, the hazards from before the turn", () => {
  it("Receiver after the move: an Eject Button newcomer that faints to Stealth Rock meets Clear Body; Pursuit at a switch-out is its own move (R2-A1K-02, RV2-Q2-RC-EJECT-SR2, -PURSUIT)", async () => {
    // sim/battle.ts:2831 clearActiveMove comes before the switch request: Excadrill's Mold Breaker is not in effect any more.
    for (const game of ["sv", "usum"] as const) {
      const eject = await turn(game, [act(fast(game, mon("Excadrill", "Mold Breaker")), "Iron Head", PL), act(mon("Metagross", "Clear Body", slowest(game)), "Body Slam", PR),
        idle(L(game, 2, { item: "Eject Button" })), idle(mon("Passimian", "Receiver"))],
      { bench: { opponent: [["incin", mon("Incineroar", "Intimidate", { hp: 10 })]] }, hazards: { opponent: { stealthRock: true } } });
      expect(range(hitOf(stepOf(ready(eject), OR, "bodyslam"), PR)), game).toEqual([50, 59]);
      expect(outcomesOf(eject).map((outcome) => outcome.mons[OR]?.build.boosts.atk), game).toEqual(outcomesOf(eject).map(() => 0));
    }
    // USUM: Mold Breaker Rampardos's Pursuit knocks out the U-turn user as it leaves (data/moves.ts:14432 runMove in
    // onBeforeSwitchOut): its ignoreAbility holds, so Passimian's Intimidate passes Metagross's Clear Body.
    const pursuit = await turn("usum", [act(mon("Rampardos", "Mold Breaker"), "Pursuit", PL), idle(mon("Metagross", "Clear Body")),
      act(fast("usum", mon("Incineroar", "Intimidate", { hp: 1 })), "U-turn", OR), idle(mon("Passimian", "Receiver"))],
    { bench: { opponent: [["laxo", L("usum", 3)]] } });
    expect([...new Set(outcomesOf(pursuit).map((outcome) => outcome.mons[OR]?.build.boosts.atk))]).toEqual([-1]);
  });
  it("one hazard from before the turn with no order has its place: it went up before this turn's (R7-r2-1, RV2-R2-SR1-WEBTURN-DEF, -R2-TS1-SRTURN-POISON)", async () => {
    // Stealth Rock from before the turn, Sticky Web set this turn: Stealth Rock knocks Kingambit out first; the Mirror Herb stays.
    const web = await turn("sv", [act({ ...mon("Scizor", "Technician"), ...slowest("sv") }, "U-turn", PR), idle(L("sv", 1)),
      act(fast("sv", mon("Ribombee", "Shield Dust", { item: "Mirror Herb" })), "Sticky Web"), idle(L("sv", 3))],
    { bench: { own: [["gambit", mon("Kingambit", "Defiant", { hp: 10 })], ["lax", L("sv", 2)]] }, hazards: { own: { stealthRock: true } } });
    expect(calculateDoublesTurn(web).status).toBe("ready");
    expect(outcomesOf(web).map((outcome) => [outcome.mons[PL]?.build.itemId, outcome.mons[PL]?.build.boosts.atk])).toEqual([["mirrorherb", 0]]);
    // Toxic Spikes from before the turn, Stealth Rock this turn (USUM): Toxapex takes the Toxic Spikes away, then faints.
    const spikes = await turn("usum", [act({ ...mon("Scizor", "Technician"), ...slowest("usum") }, "U-turn", PR), idle(L("usum", 1)),
      act(fast("usum", chomp()), "Stealth Rock"), idle(L("usum", 3))],
    { bench: { own: [["pex", mon("Toxapex", "Regenerator", { hp: 5 })], ["lax", L("usum", 2)]] }, hazards: { own: { toxicSpikes: 1 } } });
    expect(calculateDoublesTurn(spikes).status).toBe("ready");
    expect(outcomesOf(spikes).map((outcome) => outcome.sides.own.hazards ?? [])).toEqual([["stealthrock"]]);
  });
});
