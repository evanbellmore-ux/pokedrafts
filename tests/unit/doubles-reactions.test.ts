import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn, type TurnKernel } from "@/app/lib/battle/doubles-turn";
import { LISTED_REACTIONS, STATE_REACTIONS, stepEnv, USER_REACTIONS } from "@/app/lib/battle/doubles-reactions";
import type { DoublesCarried, DoublesOutcomeMon, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import type { MonState, World } from "@/app/lib/battle/doubles-world";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus } from "@/app/lib/battle/types";

/**
 * status2 Track K (ADDENDUM2 §4.3 K, tier2-moves.md §3.2-§3.12): app/lib/battle/doubles-reactions.ts. Every number is pinned
 * Showdown c23d2e94's: each turn here is one of scripts/.cache/calc-audit/status2/build/w1b-k/cases.ts (the same builds: level
 * 50, 31 IVs, Serious, 0 EVs or Stat Points unless set), whose oracle results (sim-dfs.ts) the app agrees with (w1b-k/run.ts).
 * Core Enforcer; a spread move's reactions on its user; a spread user knocked out by Spiky Shield; Unnerve's resist Berry and
 * its end on a knockout; Cotton Down; Flower Veil and Pastel Veil; Battle Bond; Aftermath and Innards Out; Receiver and Power
 * of Alchemy; and the narrow reasons each keeps.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; ivs?: Partial<Record<Stat, number>>;
  hp?: number; status?: BattleStatus; boosts?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe", number>>; carried?: DoublesCarried;
  substitute?: number; build?: Partial<BattleBuild>; mega?: string; move: string | null; target?: DoublesSlotId; absent?: true;
};
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left", PR: DoublesSlotId = "opponent-right";
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const SV = "scarlet_violet", SWSH = "sword_shield", USUM = "ultra_sun_ultra_moon", CHAMPIONS = "champions";
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const game = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));
const id = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** A Pokémon by its Showdown names (case-kit.ts mon), with its action. */
const mon = (species: string, ability: string, move: string | null, extra: Partial<Mon> = {}): Mon => ({ species, ability, move, ...extra });
/** case-kit.ts lax(spe): a Thick Fat Snorlax with `spe` Speed EVs (Stat Points in Champions). */
const lax = (spe: number, move: string | null = null, extra: Partial<Mon> = {}) => mon("Snorlax", "Thick Fat", move, { evs: { spe }, ...extra });

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.mega ?? id(m.species), runtime);
  const ability = id(m.ability);
  const shared = {
    nature: m.nature ?? "Serious", abilityId: ability, abilityActive: defaultAbilityActive(ability), itemId: id(m.item ?? ""),
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const trained = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs } } };
  return { ...trained, ...m.build } as BattleBuild;
}
/** The four Pokémon in slot order own-left, own-right, opponent-left, opponent-right (app-turn.ts caseInput). */
function turn(runtime: BattleRuntime, mons: [Mon, Mon, Mon, Mon], field: Partial<BattleConditions> = {}, more: Partial<DoublesTurnInput> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    if (m.absent) return [slot, null];
    const carried = { ...m.carried, ...(m.substitute !== undefined ? { substitute: m.substitute } : {}) };
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move === null ? null : id(m.move), target: m.target ?? null },
      ...(Object.keys(carried).length ? { carried } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const input: DoublesTurnInput = {
    runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide(), ...field }, pokemon,
    canSwitch: { own: true, opponent: true }, ...more,
  };
  for (const slot of SLOTS) {
    const entry = pokemon[slot];
    if (entry?.action.moveId && entry.action.target && doublesTargetRule(input, slot, entry.action.moveId).kind !== "choose") entry.action = { ...entry.action, target: null };
  }
  return input;
}
type Ready = Extract<DoublesTurnResult, { status: "ready" }>;
function ready(input: DoublesTurnInput): Ready {
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(`${result.status}: ${"reason" in result ? result.reason : JSON.stringify(result)}`);
  return result;
}
const reason = (input: DoublesTurnInput) => {
  const result = calculateDoublesTurn(input);
  return result.status === "not-estimated" ? result.reason : result.status;
};
/** The E2 outcomes of one slot, by a field read from each (chances summed). */
function outcomes<T>(input: DoublesTurnInput, slot: DoublesSlotId, read: (mon: DoublesOutcomeMon) => T): Map<string, number> {
  const result = calculateDoublesOutcomes(input);
  if (result.status !== "ready") throw new Error(`${result.status}: ${"reason" in result ? result.reason : ""}`);
  const out = new Map<string, number>();
  for (const outcome of result.outcomes) {
    const each = outcome.mons[slot];
    if (!each) continue;
    const key = JSON.stringify(read(each));
    out.set(key, (out.get(key) ?? 0) + outcome.chance);
  }
  return out;
}
/** One certain E2 value of a slot. */
function only<T>(input: DoublesTurnInput, slot: DoublesSlotId, read: (mon: DoublesOutcomeMon) => T): T {
  const values = outcomes(input, slot, read);
  expect([...values.keys()], `${slot}: one outcome`).toHaveLength(1);
  return JSON.parse([...values.keys()][0]) as T;
}
const stages = (each: DoublesOutcomeMon) => Object.fromEntries(Object.entries(each.build.boosts).filter(([, stage]) => stage));
const hitFacts = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => result.steps.find((step) => step.slot === slot)!.hits.find((hit) => hit.slot === target)?.facts.map((fact) => fact.text) ?? [];
const range = (result: Ready, slot: DoublesSlotId) => {
  const hp = result.hp[slot]!;
  return { min: hp.min, max: hp.max, average: hp.average, koChance: hp.koChance };
};

// ------------------------------------------------------------------------------------------------------------------
// Core Enforcer (T2M §3.2, FX-CE; T2-VS04)
// ------------------------------------------------------------------------------------------------------------------

describe("Core Enforcer", () => {
  const zygarde = (extra: Partial<Mon> = {}) => mon("Zygarde", "Aura Break", "Core Enforcer", { ivs: { spe: 0 }, nature: "Brave", ...extra });
  for (const g of [USUM, SWSH] as const) {
    it(`${g}: suppresses a target that has moved, not one still to move; a later Earthquake hits the suppressed Levitate holder only (K-CE-01)`, async () => {
      const input = turn(await game(g), [zygarde(), mon("Garchomp", "Rough Skin", "Earthquake", { evs: { spe: 252 }, nature: "Jolly" }),
        mon("Bronzong", "Levitate", null, { ivs: { spe: 0 }, nature: "Brave" }), mon("Rotom-Wash", "Levitate", null, { evs: { spe: 252 }, nature: "Timid" })], { trickRoom: true });
      const result = ready(input);
      expect(range(result, PL)).toEqual({ min: 14, max: 35, average: 24.5625, koChance: 0 });
      expect(range(result, PR)).toEqual({ min: 85, max: 92, average: 88.5, koChance: 0 });
      expect(hitFacts(result, OL, PL)).toContain("Core Enforcer: Bronzong's Levitate is suppressed.");
      expect(only(input, PL, (each) => [each.build.abilityId, each.volatiles ?? []])).toEqual(["levitate", ["gastroacid"]]);
      expect(only(input, PR, (each) => each.volatiles ?? [])).toEqual([]);
    });
    it(`${g}: two targets still to move keep their abilities (K-CE-02)`, async () => {
      const input = turn(await game(g), [zygarde({ ivs: {}, nature: "Jolly", evs: { spe: 252 } }), mon("Garchomp", "Rough Skin", "Earthquake", { ivs: { spe: 0 }, nature: "Brave" }),
        mon("Bronzong", "Levitate", null, { ivs: { spe: 0 }, nature: "Brave" }), mon("Rotom-Wash", "Levitate", null, { ivs: { spe: 0 }, nature: "Bold" })]);
      const result = ready(input);
      expect(range(result, PL)).toEqual({ min: 125, max: 128, average: 126.75, koChance: 0 });
      expect(only(input, PL, (each) => each.volatiles ?? [])).toEqual([]);
    });
  }
  it("usum: as the last action into a badly poisoned Poison Heal Gliscor that has moved: the toxic damage at the end of turn (FX-CE-01)", async () => {
    const input = turn(await game(USUM), [zygarde(), lax(80), mon("Gliscor", "Poison Heal", null, { status: "tox", hp: 100 }), lax(120)]);
    const result = ready(input);
    expect(range(result, PL)).toEqual({ min: 46, max: 55, average: 51, koChance: 0 });
    const end = result.endOfTurn.status === "ready" ? result.endOfTurn.hp[PL]! : null;
    expect(end && { min: end.min, max: end.max, average: end.average }).toEqual({ min: 37, max: 46, average: 42 });
    expect(only(input, PL, (each) => [each.build.status, each.volatiles ?? []])).toEqual(["tox", ["gastroacid"]]);
  });
  it("swsh: as the last action into a Speed Boost Blaziken that has moved: no rise at the end of turn (FX-CE-01)", async () => {
    const input = turn(await game(SWSH), [zygarde(), lax(80), mon("Blaziken", "Speed Boost", null), lax(120)]);
    expect(only(input, PL, (each) => [stages(each), each.volatiles ?? []])).toEqual([{}, ["gastroacid"]]);
  });
  it("usum: through a moved Rotom-Wash's Substitute (onAfterSubDamage); a slower Earthquake hits it (K-CE-03)", async () => {
    const input = turn(await game(USUM), [zygarde(), lax(0, "Earthquake", { ivs: { spe: 0 }, nature: "Brave", evs: { atk: 252 } }),
      mon("Rotom-Wash", "Levitate", null, { substitute: 40, evs: { spe: 252 }, nature: "Timid" }), lax(120)]);
    const result = ready(input);
    expect(range(result, PL)).toEqual({ min: 31, max: 125, average: 119.625, koChance: 0 });
    expect(outcomes(input, PL, (each) => (each.volatiles ?? []).includes("gastroacid"))).toEqual(new Map([["true", 1]]));
  });
  it("swsh: a moved Stamina holder: not estimated (its rise comes after the suppression in Showdown, the step applies it) (K-CE-04)", async () => {
    const input = turn(await game(SWSH), [zygarde(), lax(80), mon("Mudsdale", "Stamina", null, { evs: { spe: 252 }, nature: "Jolly" }), lax(120)]);
    expect(reason(input)).toBe("Core Enforcer with Stamina is not modelled in 2v2.");
  });
  it("swsh: a moved Neutralizing Gas holder: its gas ends with a suppressed Pokémon in (Q5's reason) (NG32)", async () => {
    const input = turn(await game(SWSH), [mon("Zygarde", "Aura Break", "Core Enforcer"), mon("Venusaur", "Overgrow", null),
      mon("Weezing", "Neutralizing Gas", null, { item: "Choice Scarf" }), lax(0)]);
    expect(reason(input)).toBe("Neutralizing Gas ending is not modelled in 2v2.");
  });
});

// ------------------------------------------------------------------------------------------------------------------
// A spread move's reactions on its user (T2M §3.3; T2-SE01-04)
// ------------------------------------------------------------------------------------------------------------------

describe("a spread move's reactions on its user, in target order", () => {
  const goodras = [mon("Goodra", "Gooey", null), mon("Goodra-Hisui", "Gooey", null)] as const;
  const fast = (g: BattleGame) => (g === CHAMPIONS ? 4 : 32);
  for (const g of [SV, CHAMPIONS] as const) {
    it(`${g}: two Gooey targets: Spe −2 through boost() twice (K-SE-02; today's one state gave −1)`, async () => {
      const input = turn(await game(g), [mon("Garchomp", "Rough Skin", "Breaking Swipe", { evs: { spe: fast(g) } }), lax(g === CHAMPIONS ? 1 : 8), ...goodras]);
      expect(only(input, OL, stages)).toEqual({ spe: -2 });
      expect(range(ready(input), PL)).toEqual({ min: 63, max: 81, average: 72.875, koChance: 0 });
    });
    it(`${g}: at Spe −5 the first drop reaches −6 and the second fails (K-SE-03)`, async () => {
      const input = turn(await game(g), [mon("Garchomp", "Rough Skin", "Breaking Swipe", { evs: { spe: fast(g) }, boosts: { spe: -5 } }), lax(g === CHAMPIONS ? 1 : 8), ...goodras]);
      expect(only(input, OL, stages)).toEqual({ spe: -6 });
    });
    it(`${g}: White Herb restores once after both drops (K-SE-04)`, async () => {
      const input = turn(await game(g), [mon("Garchomp", "Rough Skin", "Breaking Swipe", { evs: { spe: fast(g) }, item: "White Herb" }), lax(g === CHAMPIONS ? 1 : 8), ...goodras]);
      expect(only(input, OL, (each) => [stages(each), each.build.itemId])).toEqual([{}, ""]);
    });
    it(`${g}: one Gooey target and a Snorlax: one drop; the ally's later Body Slam is unchanged (K-SE-06)`, async () => {
      const input = turn(await game(g), [mon("Garchomp", "Rough Skin", "Breaking Swipe", { evs: { spe: fast(g) } }), lax(0, "Body Slam", { nature: "Brave", ivs: { spe: 0 }, target: PL }),
        mon("Goodra", "Gooey", null), lax(g === CHAMPIONS ? 2 : 16)]);
      expect(only(input, OL, stages)).toEqual({ spe: -1 });
    });
  }
  for (const g of [SWSH, USUM] as const) {
    it(`${g}: Defiant Passimian's Brutal Swing into two Gooey Goodra: −2 Speed, +4 Attack (K-SE-07)`, async () => {
      const input = turn(await game(g), [mon("Passimian", "Defiant", "Brutal Swing", { evs: { spe: 252 } }), lax(40), mon("Goodra", "Gooey", null, { evs: { spe: 8 } }), mon("Goodra", "Gooey", null, { evs: { spe: 16 } })]);
      expect(only(input, OL, stages)).toEqual({ atk: 4, spe: -2 });
    });
    it(`${g}: at Spe −6 both drops fail and Defiant does not rise (K-SE-08)`, async () => {
      const input = turn(await game(g), [mon("Passimian", "Defiant", "Brutal Swing", { evs: { spe: 252 }, boosts: { spe: -6 } }), lax(40), mon("Goodra", "Gooey", null, { evs: { spe: 8 } }), mon("Goodra", "Gooey", null, { evs: { spe: 16 } })]);
      expect(only(input, OL, stages)).toEqual({ spe: -6 });
    });
    it(`${g}: Tangling Hair (hit first) then Mummy: Defiant answers the drop, then Mummy replaces it (K-SE-05)`, async () => {
      const input = turn(await game(g), [mon("Passimian", "Defiant", "Brutal Swing", { evs: { spe: 252 } }), lax(40), mon("Cofagrigus", "Mummy", null), mon("Dugtrio-Alola", "Tangling Hair", null)]);
      expect(only(input, OL, (each) => [stages(each), each.build.abilityId])).toEqual([{ atk: 2, spe: -1 }, "mummy"]);
    });
  }
  const scovillain = (move: string | null = null) => mon("Scovillain", "Spicy Spray", move, { item: "Scovillainite", mega: "scovillainmega", build: { abilityId: "spicyspray" } });
  it("champions: Rock Slide into Scovillain-Mega (Spicy Spray) and a Snorlax: one burn; the burn at the end of turn (K-SE-01)", async () => {
    const input = turn(await game(CHAMPIONS), [mon("Garchomp", "Rough Skin", "Rock Slide", { evs: { spe: 32 } }), lax(1), scovillain(), lax(2)]);
    const result = ready(input);
    expect(only(input, OL, (each) => each.build.status)).toBe("brn");
    const end = result.endOfTurn.status === "ready" ? result.endOfTurn.hp[OL]! : null;
    expect(end?.max).toBe(172);
  });
  it("champions: the same with a Lum Berry: the burn is cured and the Berry used (K-SE-10)", async () => {
    const input = turn(await game(CHAMPIONS), [mon("Garchomp", "Rough Skin", "Rock Slide", { evs: { spe: 32 }, item: "Lum Berry" }), lax(1), scovillain(), lax(2)]);
    expect(only(input, OL, (each) => [each.build.status, each.build.itemId])).toEqual(["", ""]);
  });
  it("champions: Matcha Gotcha (a spread heal) into Scovillain-Mega and a Snorlax: the burn composed after the heal's steps (K-SE-12)", async () => {
    const input = turn(await game(CHAMPIONS), [mon("Sinistcha", "Hospitality", "Matcha Gotcha", { evs: { spe: 32 }, hp: 60 }), lax(1), scovillain(), lax(2)]);
    expect(only(input, OL, (each) => each.build.status)).toBe("brn");
  });
  it("champions: Dragon Darts with the first dart into Scovillain-Mega: the second dart reads the burn: the kept reason (K-SE-11)", async () => {
    const input = turn(await game(CHAMPIONS), [mon("Dragapult", "Clear Body", "Dragon Darts", { evs: { spe: 32 }, target: PL }), lax(1), scovillain(), lax(2)]);
    expect(reason(input)).toBe("Dragon Darts's effect on Dragapult from more than one target is not modelled.");
  });
});

// ------------------------------------------------------------------------------------------------------------------
// A spread user knocked out by a protecting move's contact effect (T2M §3.4; T2-SCK01)
// ------------------------------------------------------------------------------------------------------------------

describe("a spread user knocked out by Spiky Shield before the hits", () => {
  for (const g of [CHAMPIONS, SV] as const) {
    it(`${g}: still hits the rest, then faints in the batch (K-SCK-01)`, async () => {
      const input = turn(await game(g), [mon("Garchomp", "Sand Veil", "Breaking Swipe", { evs: { spe: g === CHAMPIONS ? 4 : 32 }, hp: 20 }), lax(g === CHAMPIONS ? 1 : 8),
        mon("Chesnaught", "Bulletproof", "Spiky Shield", { evs: { spe: g === CHAMPIONS ? 32 : 252 } }), lax(g === CHAMPIONS ? 2 : 16)]);
      const result = ready(input);
      expect(range(result, OL).koChance).toBe(1);
      expect(range(result, PR)).toEqual({ min: 181, max: 190, average: 186, koChance: 0 });
      expect(only(input, PR, stages)).toEqual({ atk: -1 });
    });
  }
});

// ------------------------------------------------------------------------------------------------------------------
// Unnerve: the resist Berry's stand-ins, and its end on a knockout (T2M §3.6, §3.7; T2-UN01-03)
// ------------------------------------------------------------------------------------------------------------------

describe("Unnerve and As One", () => {
  // The stand-ins read the integrator's searchFor line (W1B-K.md needsFromIntegrator 1, in since integration 1b).
  it("sv: a third Pokémon's Unnerve stops the target's Haban Berry (K-UN-01)", async () => {
    const input = turn(await game(SV), [mon("Tyranitar", "Unnerve", null), mon("Garchomp", "Rough Skin", "Dragon Claw", { evs: { spe: 252 }, target: PL }),
      mon("Dragonite", "Inner Focus", null, { item: "Haban Berry" }), lax(16)]);
    expect(range(ready(input), PL)).toEqual({ min: 26, max: 50, average: 37.5, koChance: 0 });
    expect(only(input, PL, (each) => each.build.itemId)).toBe("habanberry");
  });
  it("sv: the user's own Unnerve does not stop its ally's Shuca Berry in a spread move (K-UN-02)", async () => {
    const input = turn(await game(SV), [mon("Tyranitar", "Unnerve", "Earthquake", { evs: { spe: 252 } }), mon("Magnezone", "Sturdy", null, { item: "Shuca Berry" }), lax(32), lax(64)]);
    expect(range(ready(input), OR)).toEqual({ min: 67, max: 79, average: 73.75, koChance: 0 });
    expect(only(input, OL, (each) => each.build.abilityId)).toBe("unnerve");
  });
  it("sv: Thief into the Berry under a third Pokémon's Unnerve: the narrow reason (K-UN-03)", async () => {
    const input = turn(await game(SV), [mon("Tyranitar", "Unnerve", null), mon("Incineroar", "Blaze", "Thief", { evs: { spe: 252 }, target: PL }),
      mon("Lucario", "Inner Focus", null, { item: "Colbur Berry" }), lax(16)]);
    expect(reason(input)).toBe("Thief with Unnerve is not modelled in 2v2.");
  });
  for (const g of [SV, CHAMPIONS] as const) {
    it(`${g}: Flare Blitz knocks out the Unnerve holder: Rocky Helmet, the Sitrus at the hit's Update, then the recoil (K-UNR-01)`, async () => {
      const input = turn(await game(g), [mon("Arcanine", "Flash Fire", "Flare Blitz", { item: "Sitrus Berry", evs: { spe: g === CHAMPIONS ? 32 : 252 }, hp: 100, target: PL }),
        lax(g === CHAMPIONS ? 1 : 8), mon("Tyranitar", "Unnerve", null, { item: "Rocky Helmet", hp: 5 }), lax(g === CHAMPIONS ? 2 : 16)]);
      expect(range(ready(input), OL)).toEqual({ min: 112, max: 112, average: 112, koChance: 0 });
    });
  }
  it("sv: a knockout with no recoil: the Sitrus at the hit's Update (K-UNR-03)", async () => {
    const input = turn(await game(SV), [mon("Garchomp", "Rough Skin", "Dragon Claw", { evs: { spe: 252 }, item: "Sitrus Berry", hp: 80, target: PL }), lax(8),
      mon("Tyranitar", "Unnerve", null, { hp: 1 }), lax(16)]);
    expect(range(ready(input), OL)).toEqual({ min: 125, max: 125, average: 125, koChance: 0 });
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Cotton Down (T2M §3.8; SwSh; T2-CD01, CD02)
// ------------------------------------------------------------------------------------------------------------------

describe("Cotton Down", () => {
  it("swsh: every other active Pokémon −1 Speed; a Mirror Armor ally sends it back to the holder (K-CD-01)", async () => {
    const input = turn(await game(SWSH), [mon("Garchomp", "Rough Skin", "Dragon Claw", { evs: { spe: 252 }, target: PL }), mon("Corviknight", "Mirror Armor", null),
      mon("Eldegoss", "Cotton Down", null), lax(16)]);
    expect(only(input, OL, stages)).toEqual({ spe: -1 });
    expect(only(input, OR, stages)).toEqual({});
    expect(only(input, PL, stages)).toEqual({ spe: -1 });
    expect(only(input, PR, stages)).toEqual({ spe: -1 });
    expect(hitFacts(ready(input), OL, PL)).toContain("Cotton Down: Snorlax's Speed falls.");
  });
  it("swsh: a two-hit move: two rounds; the user's Defiant ally +2 Attack each (K-CD-02)", async () => {
    const input = turn(await game(SWSH), [mon("Dragonite", "Inner Focus", "Dual Wingbeat", { evs: { spe: 252 }, target: PL }), mon("Bisharp", "Defiant", null),
      mon("Eldegoss", "Cotton Down", null), lax(16)]);
    expect(only(input, OL, stages)).toEqual({ spe: -2 });
    expect(only(input, OR, stages)).toEqual({ atk: 4, spe: -2 });
    expect(only(input, PR, stages)).toEqual({ spe: -2 });
  });
  it("swsh: a spread move: the drops after both targets' steps, a later target's included (K-CD-04)", async () => {
    const input = turn(await game(SWSH), [mon("Garchomp", "Rough Skin", "Rock Slide", { evs: { spe: 252 } }), mon("Bisharp", "Defiant", null), mon("Eldegoss", "Cotton Down", null), lax(16)]);
    expect(only(input, OL, stages)).toEqual({ spe: -1 });
    expect(only(input, OR, stages)).toEqual({ atk: 2, spe: -1 });
    expect(only(input, PR, stages)).toEqual({ spe: -1 });
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Flower Veil and Pastel Veil (T2M §3.9; T2-FV01, FV02)
// ------------------------------------------------------------------------------------------------------------------

describe("Flower Veil and Pastel Veil", () => {
  for (const g of [SV, USUM] as const) {
    it(`${g}: Snarl's drop is kept off the veil's Grass ally, not off the Fairy holder (K-FV-01)`, async () => {
      const input = turn(await game(g), [mon("Incineroar", "Blaze", "Snarl", { evs: { spe: 252 } }), lax(8), mon("Comfey", "Flower Veil", null), mon("Venusaur", "Overgrow", null)]);
      expect(only(input, PL, stages)).toEqual({ spa: -1 });
      expect(only(input, PR, stages)).toEqual({});
      expect(hitFacts(ready(input), OL, PR)).toContain("Flower Veil: Venusaur's stats do not fall.");
    });
  }
  it("sv: a Mold Breaker Bulldoze passes the veil (K-FV-02)", async () => {
    const input = turn(await game(SV), [mon("Excadrill", "Mold Breaker", "Bulldoze", { evs: { spe: 252 } }), lax(8, "Protect"), mon("Comfey", "Flower Veil", null), mon("Venusaur", "Overgrow", null)]);
    expect(only(input, PR, stages)).toEqual({ spe: -1 });
  });
  it("the step's environment: a Pastel Veil holder's ally gets the veil, a Grass ally of a Flower Veil holder the Flower Veil", async () => {
    const runtime = await game(SWSH);
    const build = (species: string, ability: string) => ({ ...createBuild(species, runtime), abilityId: ability });
    const monState = (b: BattleBuild): MonState => ({ build: b, vol: {}, eot: {}, fainted: false, damagedBy: [] } as unknown as MonState);
    const w = {
      mass: 1, factors: [], remaining: [], executed: 0, field: {}, sides: { own: {}, opponent: {} },
      mons: { "own-left": monState(build("nidoking", "poisonpoint")), "own-right": monState(build("snorlax", "thickfat")),
        "opponent-left": monState(build("ponytagalar", "pastelveil")), "opponent-right": monState(build("venusaur", "overgrow")) },
    } as unknown as World;
    const kernel = {
      inEndOfTurn: false, runtime, input: { pokemon: {} }, alive: (world: World, slot: DoublesSlotId) => !world.mons[slot]!.fainted, isFoe: (a: DoublesSlotId, b: DoublesSlotId) => a.split("-")[0] !== b.split("-")[0],
      typesIn: (world: World, slot: DoublesSlotId) => runtime.speciesById.get(world.mons[slot]!.build.speciesId)!.types, breaks: () => false,
      moveInfo: () => ({ kind: "other" }), itemWorks: () => true, turnUnnerve: () => undefined, hp: {},
    } as unknown as TurnKernel;
    expect(stepEnv(kernel, w, OL, PR, "sludgebomb", false)).toEqual({ veil: "pastelveil" });
    w.mons[PL]!.build = build("florges", "flowerveil");
    expect(stepEnv(kernel, w, OL, PR, "sludgebomb", false)).toEqual({ veil: "flowerveil" });
    w.mons[PR]!.build = build("snorlax", "thickfat");
    expect(stepEnv(kernel, w, OL, PR, "sludgebomb", false)).toEqual({});
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Battle Bond (T2M §3.10, C22; T2-BB01-03)
// ------------------------------------------------------------------------------------------------------------------

describe("Battle Bond", () => {
  const greninja = (move = "Dark Pulse", extra: Partial<Mon> = {}) => mon("Greninja-Bond", "Battle Bond", move, { evs: { spe: 252 }, target: move === "Surf" ? undefined : PL, ...extra });
  it("sv: a knockout gives +1 Attack, Sp. Atk and Speed once, with the once-a-battle fact (K-BB-01)", async () => {
    const input = turn(await game(SV), [greninja(), lax(8), lax(40, null, { hp: 1 }), lax(16)]);
    const result = ready(input);
    expect(only(input, OL, (each) => [stages(each), each.onceUsed ?? []])).toEqual([{ atk: 1, spa: 1, spe: 1 }, ["battlebond"]]);
    expect(hitFacts(result, OL, PL)).toContain("Battle Bond: Greninja-Bond gets +1 Attack, +1 Sp. Atk and +1 Speed.");
    expect(result.facts).toContain("Assumes Greninja-Bond has not had Battle Bond act before in this battle.");
  });
  it("usum: a knockout changes it to Greninja-Ash; a later Body Slam into it reads Ash's stats (K-BB-02)", async () => {
    const input = turn(await game(USUM), [greninja(), lax(8), lax(40, null, { hp: 1 }), lax(0, "Body Slam", { ivs: { spe: 0 }, nature: "Brave", target: OL })]);
    expect(range(ready(input), OL)).toEqual({ min: 53, max: 68, average: 60.5625, koChance: 0 });
    expect(only(input, OL, (each) => [each.build.speciesId, stages(each)])).toEqual(["greninjaash", {}]);
  });
  it("sv: the foes' last Pokémon knocked out: no boost (K-BB-03)", async () => {
    const input = turn(await game(SV), [greninja(), lax(8), lax(40, null, { hp: 1 }), { ...lax(16), absent: true }], {}, { canSwitch: { own: true, opponent: false } });
    expect(only(input, OL, stages)).toEqual({});
  });
  it("sv: Battle Bond used earlier in the battle (onceUsed): no boost (K-BB-04)", async () => {
    const input = turn(await game(SV), [greninja("Dark Pulse", { carried: { onceUsed: ["battlebond"] } }), lax(8), lax(40, null, { hp: 1 }), lax(16)]);
    expect(only(input, OL, stages)).toEqual({});
  });
  it("sv: a spread knockout: one faint batch, one boost (K-BB-05)", async () => {
    const input = turn(await game(SV), [greninja("Surf"), lax(8), lax(40, null, { hp: 1 }), lax(16)]);
    expect(only(input, OL, stages)).toEqual({ atk: 1, spa: 1, spe: 1 });
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Aftermath and Innards Out (T2M §3.11; T2-AF01-03, IO01-03)
// ------------------------------------------------------------------------------------------------------------------

describe("Aftermath and Innards Out", () => {
  const chomp = (move: string, extra: Partial<Mon> = {}) => mon("Garchomp", "Rough Skin", move, { evs: { spe: 252 }, ...extra });
  it("sv: Aftermath's quarter inside the knocking hit, then the Sitrus at its Update (K-AF-01)", async () => {
    const input = turn(await game(SV), [chomp("Dragon Claw", { item: "Sitrus Berry", hp: 110, target: PL }), lax(8), mon("Drifblim", "Aftermath", null, { hp: 1 }), lax(16)]);
    expect(range(ready(input), OL)).toEqual({ min: 110, max: 110, average: 110, koChance: 0 });
    expect(only(input, OL, (each) => each.build.itemId)).toBe("");
  });
  it("sv: Damp on the field stops it (K-AF-02)", async () => {
    const input = turn(await game(SV), [chomp("Dragon Claw", { item: "Sitrus Berry", hp: 110, target: PL }), lax(8), mon("Drifblim", "Aftermath", null, { hp: 1 }), mon("Bellibolt", "Damp", null)]);
    expect(only(input, OL, (each) => each.build.itemId)).toBe("sitrusberry");
  });
  it("sv: before the recoil (K-AF-03)", async () => {
    const input = turn(await game(SV), [mon("Arcanine", "Flash Fire", "Flare Blitz", { evs: { spe: 252 }, target: PL }), lax(8), mon("Electrode", "Aftermath", null, { hp: 30 }), lax(16)]);
    expect(range(ready(input), OL)).toEqual({ min: 114, max: 114, average: 114, koChance: 0 });
  });
  it("champions: in a contact spread move: the quarter joins the Update after the hits (K-AF-05)", async () => {
    const input = turn(await game(CHAMPIONS), [mon("Garchomp", "Rough Skin", "Breaking Swipe", { evs: { spe: 32 } }), lax(1), mon("Garbodor", "Aftermath", null, { hp: 1 }), lax(2)]);
    const result = ready(input);
    expect(range(result, OL)).toEqual({ min: 138, max: 138, average: 138, koChance: 0 });
    expect(result.hp[OL]!.losses?.map((fact) => fact.text)).toContain("Garchomp loses 45 HP (Aftermath).");
  });
  for (const g of [SWSH, USUM] as const) {
    it(`${g}: Innards Out deals the HP its holder had (K-IO-01)`, async () => {
      const input = turn(await game(g), [chomp("Dragon Claw", { target: PL }), lax(8), mon("Pyukumuku", "Innards Out", null, { hp: 40 }), lax(16)]);
      expect(range(ready(input), OL)).toEqual({ min: 143, max: 143, average: 143, koChance: 0 });
    });
  }
  it("swsh: after a two-hit move: the HP as the move started (K-IO-02)", async () => {
    const input = turn(await game(SWSH), [mon("Dragonite", "Inner Focus", "Dual Wingbeat", { evs: { spe: 252 }, target: PL }), lax(8), mon("Pyukumuku", "Innards Out", null, { hp: 45 }), lax(16)]);
    expect(range(ready(input), OL)).toEqual({ min: 121, max: 121, average: 121, koChance: 0 });
  });
  it("swsh: in a spread move (K-IO-04)", async () => {
    const input = turn(await game(SWSH), [chomp("Rock Slide"), lax(8), mon("Pyukumuku", "Innards Out", null, { hp: 5 }), lax(16)]);
    const result = ready(input);
    expect(range(result, OL)).toEqual({ min: 178, max: 178, average: 178, koChance: 0 });
    expect(result.hp[OL]!.losses?.map((fact) => fact.text)).toContain("Garchomp loses 5 HP (Innards Out).");
  });
  it("the user knocked out in the hit: Innards Out (K-IO-07, swsh) and Aftermath (K-AF-06, sv)", async () => {
    const io = ready(turn(await game(SWSH), [chomp("Dragon Claw", { hp: 30, target: PL }), lax(8), mon("Pyukumuku", "Innards Out", null, { hp: 40 }), lax(16)]));
    expect(range(io, OL).koChance).toBe(1);
    const aftermath = ready(turn(await game(SV), [chomp("Dragon Claw", { hp: 40, target: PL }), lax(8), mon("Drifblim", "Aftermath", null, { hp: 1 }), lax(16)]));
    expect(range(aftermath, OL).koChance).toBe(1);
  });
  // The self-faint fact's sources (doubles-turn.ts selfFaintFact: W1B-K.md needsFromIntegrator 2, in since integration 1b).
  it("the user's faint names Innards Out and Aftermath (K-IO-07, K-AF-06)", async () => {
    const io = ready(turn(await game(SWSH), [chomp("Dragon Claw", { hp: 30, target: PL }), lax(8), mon("Pyukumuku", "Innards Out", null, { hp: 40 }), lax(16)]));
    expect(io.steps.find((step) => step.slot === OL)!.facts.map((fact) => fact.text)).toContain("Garchomp faints (Innards Out).");
    const aftermath = ready(turn(await game(SV), [chomp("Dragon Claw", { hp: 40, target: PL }), lax(8), mon("Drifblim", "Aftermath", null, { hp: 1 }), lax(16)]));
    expect(aftermath.steps.find((step) => step.slot === OL)!.facts.map((fact) => fact.text)).toContain("Garchomp faints (Aftermath).");
  });
  it("swsh: a spread user's Berry: the loss joins the hits' loss group before the Update (K-IO-05, review 2 R1-A1K-05); a holder hurt earlier this turn is stepped per HP (K-IO-06, INT-IO-01: integration 1b)", async () => {
    const runtime = await game(SWSH);
    const berry = ready(turn(runtime, [chomp("Rock Slide", { item: "Sitrus Berry" }), lax(8), mon("Pyukumuku", "Innards Out", null, { hp: 5 }), lax(16)]));
    expect(range(berry, OL)).toEqual({ min: 178, max: 178, average: 178, koChance: 0 });
    // Aftermath's quarter (45) takes a 110 HP Garchomp to 65, at or below half: the Sitrus at the Update after the hits (+45).
    const aftermath = ready(turn(await game(SV), [chomp("Breaking Swipe", { item: "Sitrus Berry", hp: 110 }), lax(8), mon("Drifblim", "Aftermath", null, { hp: 1 }), lax(16)]));
    expect(range(aftermath, OL)).toEqual({ min: 110, max: 110, average: 110, koChance: 0 });
    expect(aftermath.hp[OL]!.losses?.map((fact) => fact.text)).toContain("Garchomp loses 45 HP (Aftermath).");
    expect(reason(turn(runtime, [chomp("Rock Slide"), mon("Dragonite", "Inner Focus", "Dragon Claw", { ivs: { spe: 0 }, nature: "Brave", target: PL }), mon("Pyukumuku", "Innards Out", null, { hp: 60 }), lax(16)])))
      .toBe("ready");
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Receiver and Power of Alchemy (T2M §3.12; T2-RC01, RC02)
// ------------------------------------------------------------------------------------------------------------------

describe("Receiver and Power of Alchemy", () => {
  for (const g of [SV, CHAMPIONS] as const) {
    it(`${g}: Receiver takes the fainted ally's Intimidate, which acts at once (K-RC-01)`, async () => {
      const input = turn(await game(g), [mon("Incineroar", "Intimidate", null, { hp: 1 }), mon("Passimian", "Receiver", null),
        mon("Garchomp", "Rough Skin", "Dragon Claw", { evs: { spe: g === CHAMPIONS ? 32 : 252 }, boosts: { atk: -1 }, target: OL }), lax(0, "Body Slam", { ivs: { spe: 0 }, nature: "Brave", boosts: { atk: -1 }, target: OR })]);
      expect(only(input, OR, (each) => each.build.abilityId)).toBe("intimidate");
      expect(only(input, PL, stages)).toEqual({ atk: -2 });
      expect(range(ready(input), OR)).toEqual({ min: 136, max: 142, average: 139.875, koChance: 0 });
    });
    it(`${g}: a spread knockout: the copy in the faint batch after the hits (K-RC-03)`, async () => {
      const input = turn(await game(g), [mon("Garchomp", "Rough Skin", "Rock Slide", { evs: { spe: g === CHAMPIONS ? 32 : 252 } }), lax(0, "Body Slam", { ivs: { spe: 0 }, nature: "Brave", boosts: { atk: -1 }, target: PR }),
        mon("Incineroar", "Intimidate", null, { hp: 1 }), mon("Passimian", "Receiver", null)]);
      expect(only(input, OL, stages)).toEqual({ atk: -1 });
      expect(only(input, OR, stages)).toEqual({ atk: -2 });
      expect(only(input, PR, (each) => each.build.abilityId)).toBe("intimidate");
    });
  }
  it("sv: Receiver inside a Mold Breaker or Teravolt user's knocking move: the copied Intimidate passes that user's ally's Clear Body (review 2 R1-A1K-02, K2-RC-MOLD, V2-RC-SPREAD)", async () => {
    const sv = await game(SV);
    const knock = (user: Mon) => turn(sv, [user, mon("Metagross", "Clear Body", "Body Slam", { ivs: { spe: 0 }, nature: "Brave", target: PL }),
      mon("Passimian", "Receiver", null), mon("Incineroar", "Intimidate", null, { hp: 1 })]);
    // The faint batch runs inside Iron Head (sim/battle-actions.ts:974): its ignoreAbility suppresses Clear Body as Intimidate starts.
    const mold = knock(mon("Excadrill", "Mold Breaker", "Iron Head", { evs: { spe: 252 }, target: PR }));
    expect(only(mold, OR, stages)).toEqual({ atk: -1 });
    expect(ready(mold).steps.find((step) => step.slot === OR)!.hits[0]).toMatchObject({ min: 34, max: 40 });
    expect(only(knock(mon("Kyurem-Black", "Teravolt", "Iron Head", { evs: { spe: 252 }, target: PR })), OR, stages)).toEqual({ atk: -1 });
    // A spread knockout's copy (spreadUser's stashed receive) too; with no Mold Breaker, Clear Body stops the drop (the control).
    expect(only(knock(mon("Excadrill", "Mold Breaker", "Rock Slide", { evs: { spe: 252 } })), OR, stages)).toEqual({ atk: -1 });
    const control = knock(mon("Garchomp", "Rough Skin", "Iron Head", { evs: { spe: 252 }, target: PR }));
    expect(only(control, OR, stages)).toEqual({});
    expect(ready(control).steps.find((step) => step.slot === OR)!.hits[0]).toMatchObject({ min: 50, max: 59 });
  });
  it("Receiver reads the move as it runs: a G-Max form's own ignoreAbility, and a called move's caller (review 2 round 2 R2-A1K-01: RV2-Q2-RC-GMAX-FIREBALL-swsh, -STALK-MYC-SWIFT-sv)", async () => {
    // G-Max Fireball carries ignoreAbility (data/moves.ts gmaxfireball), Pyro Ball does not: Clear Body is suppressed, and
    // Metagross's later Body Slam is at −1 (34–40).
    const swsh = await game(SWSH);
    const fireball = turn(swsh, [mon("Cinderace", "Blaze", "Pyro Ball", { evs: { spe: 252 }, target: PR }),
      mon("Metagross", "Clear Body", "Body Slam", { ivs: { spe: 0 }, nature: "Brave", target: PL }), mon("Passimian", "Receiver", null), mon("Incineroar", "Intimidate", null, { hp: 1 })]);
    const cinderace = fireball.pokemon[OL]!;
    cinderace.build = { ...cinderace.build, mechanic: "gigantamax", configuration: { ...cinderace.build.configuration, dynamaxLevel: 10, gigantamax: true } } as BattleBuild;
    expect(only(fireball, OR, stages)).toEqual({ atk: -1 });
    expect(ready(fireball).steps.find((step) => step.slot === OR)!.hits[0]).toMatchObject({ min: 34, max: 40 });
    // Max Steelspike (Dynamaxed Sunsteel Strike) has none, though Sunsteel Strike does: Clear Body holds (its +1 Defense only).
    const steelspike = turn(swsh, [mon("Solgaleo", "Full Metal Body", "Sunsteel Strike", { evs: { spe: 252 }, target: PR }),
      mon("Metagross", "Clear Body", null), mon("Passimian", "Receiver", null), mon("Incineroar", "Intimidate", null, { hp: 1 })]);
    steelspike.pokemon[OL]!.build = { ...steelspike.pokemon[OL]!.build, mechanic: "dynamax" } as BattleBuild;
    expect(only(steelspike, OR, stages)).toEqual({ def: 1 });
    // Sleep Talk into Swift: the called spread move takes Sleep Talk's ignoreAbility (sim/battle-actions.ts:422-425), which
    // Mycelium Might gave the status move; Toedscruel's own Swift has none.
    const sv = await game(SV);
    const talk = (move: string) => {
      const input = turn(sv, [mon("Toedscruel", "Mycelium Might", move, { evs: { spe: 252 }, status: move === "Sleep Talk" ? "slp" : "" }),
        mon("Metagross", "Clear Body", null), mon("Passimian", "Receiver", null), mon("Incineroar", "Intimidate", null, { hp: 1 })]);
      input.pokemon[OL] = { ...input.pokemon[OL]!, moves: ["swift"] };
      return input;
    };
    expect(only(talk("Sleep Talk"), OR, stages)).toEqual({ atk: -1 });
    expect(only(talk("Swift"), OR, stages)).toEqual({});
  });
  it("usum: Power of Alchemy takes Levitate; a later Earthquake misses it (K-RC-02)", async () => {
    const input = turn(await game(USUM), [mon("Bronzong", "Levitate", null, { hp: 1 }), mon("Muk-Alola", "Power of Alchemy", null),
      mon("Garchomp", "Rough Skin", "Dragon Claw", { evs: { spe: 252 }, target: OL }), mon("Excadrill", "Sand Rush", "Earthquake", { ivs: { spe: 0 }, nature: "Brave" })]);
    expect(range(ready(input), OR)).toEqual({ min: 180, max: 180, average: 180, koChance: 0 });
    expect(only(input, OR, (each) => each.build.abilityId)).toBe("levitate");
  });
});

// ------------------------------------------------------------------------------------------------------------------
// The reaction lists
// ------------------------------------------------------------------------------------------------------------------

describe("the reactions on a move's user", () => {
  it("lists the step's listed reactions and the state reactions spreadUser composes", () => {
    expect([...LISTED_REACTIONS].sort()).toEqual(["cottondown", "gooey", "tanglinghair"]);
    expect([...STATE_REACTIONS].sort()).toEqual(["gulpmissile", "lingeringaroma", "mummy", "pickpocket", "spicyspray", "stickybarb", "wanderingspirit"]);
    expect(Object.values(USER_REACTIONS).every((kind) => ["listed", "state", "loss", "chance", "switch", "field", "later"].includes(kind))).toBe(true);
  });
});
