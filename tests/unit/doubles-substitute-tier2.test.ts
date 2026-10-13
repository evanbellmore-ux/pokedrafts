import { beforeAll, describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { frozenCases } from "@/app/lib/battle/doubles-substitute";
import type { DoublesCarried, DoublesOutcomesResult, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext } from "@/app/lib/battle/types";

/**
 * Hits into a Substitute the status2 build models (ADDENDUM2 §2.3 #33, #34; T2M §3.22, §3.23; app/lib/battle/doubles-substitute.ts)
 * against pinned Showdown c23d2e94: Max Moves, signature Z-Moves, Magician, Parental Bond, constant-power multi-hit moves in
 * front of the effects the engine's later hits read (the hits into the Substitute as the first, the hits after the break a
 * fresh continuation), and a face behind a Substitute. Each expectation is the oracle's (verify sim-dfs.ts, the exhaustive
 * walk; status2/build/w1a-s cases, their ids in the titles; V1's T2M-SB and T2M-SP). Level 50, 31 IVs, Serious, 0 EVs
 * (Champions: Stat Points) unless set; every Pokémon left over uses Splash (No move).
 */
type P = {
  id: string; ability: string; item?: string; evs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>; hp?: number;
  move?: string | null; target?: DoublesSlotId; carried?: DoublesCarried; context?: MoveContext; build?: Partial<BattleBuild>;
};
type S = "OL" | "OR" | "PL" | "PR";
const SLOT: Record<S, DoublesSlotId> = { OL: "own-left", OR: "own-right", PL: "opponent-left", PR: "opponent-right" };
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const GAMES = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" } as const;
type Game = keyof typeof GAMES;
const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of Object.values(GAMES)) runtimes[game] = await loadBattleRuntime(game);
});

function buildOf(runtime: BattleRuntime, p: P): BattleBuild {
  const base = createBuild(p.id, runtime);
  const shared = {
    nature: "Serious", abilityId: p.ability, abilityActive: defaultAbilityActive(p.ability), itemId: p.item ?? "", currentHP: p.hp ?? null, status: "" as const,
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  };
  const build = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...p.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...p.evs }, ivs: IV31 } };
  return { ...build, ...p.build } as BattleBuild;
}
function turn(game: Game, slots: Record<S, P>, field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const runtime = runtimes[GAMES[game]];
  const pokemon = Object.fromEntries((Object.keys(SLOT) as S[]).map((key) => {
    const p = slots[key];
    const move = p.move ?? null;
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, p), contexts: move && p.context ? { [move]: p.context } : {}, charged: false,
      action: { moveId: move, target: p.target ?? null }, ...(p.carried ? { carried: p.carried } : {}),
    };
    return [SLOT[key], entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon, canSwitch: { own: true, opponent: true } };
}
const sub = (hp: number) => ({ carried: { substitute: hp } });
const lax = (spe: number, extra: Partial<P> = {}): P => ({ id: "snorlax", ability: "thickfat", evs: { spe }, ...extra });
const fast = (id: string, ability: string, move: string, extra: Partial<P> = {}): P => ({ id, ability, evs: { spe: 252 }, move, target: SLOT.PL, ...extra });
const champ = (id: string, ability: string, move: string, extra: Partial<P> = {}): P => ({ id, ability, evs: { spe: 32 }, move, target: SLOT.PL, ...extra });
const kanga = (game: "usum" | "champions", move: string): P => ({ id: "kangaskhanmega", ability: "parentalbond", item: "kangaskhanite", evs: { spe: game === "usum" ? 252 : 32 }, move, target: SLOT.PL });
const into = (game: Game, attacker: P, defender: P, field: Partial<BattleConditions> = {}) => turn(game, { OL: attacker, OR: lax(8), PL: defender, PR: lax(16) }, field);

function ready(result: DoublesTurnResult): Extract<DoublesTurnResult, { status: "ready" }> {
  if (result.status !== "ready") throw new Error(`not ready: ${JSON.stringify(result).slice(0, 400)}`);
  return result;
}
function outcomes(result: DoublesOutcomesResult) {
  if (result.status !== "ready") throw new Error(`not ready: ${JSON.stringify(result).slice(0, 400)}`);
  return result.outcomes;
}
type Want = { hp?: { min: number; max: number; average: number; koChance: number }; item?: string; species?: string; boosts?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe", number>>; sub?: Record<number, number> };
function agrees(input: DoublesTurnInput, want: Partial<Record<S, Want>>) {
  const result = ready(calculateDoublesTurn(input));
  const list = outcomes(calculateDoublesOutcomes(input));
  for (const [key, each] of Object.entries(want) as [S, Want][]) {
    const slot = SLOT[key];
    if (each.hp) {
      const hp = result.hp[slot]!;
      expect([hp.min, hp.max, hp.koChance], slot).toEqual([each.hp.min, each.hp.max, expect.closeTo(each.hp.koChance, 9)]);
      expect(hp.average, slot).toBeCloseTo(each.hp.average, 9);
    }
    const living = list.filter((outcome) => outcome.mons[slot] && !outcome.mons[slot]!.hp.every(({ hp }) => hp === 0));
    if (each.item !== undefined) expect([...new Set(living.map((outcome) => outcome.mons[slot]!.build.itemId))], `${slot} item`).toEqual([each.item]);
    if (each.species) expect([...new Set(living.map((outcome) => outcome.mons[slot]!.build.speciesId))], `${slot} form`).toEqual([each.species]);
    if (each.boosts) {
      const boosts = [...new Set(living.map((outcome) => JSON.stringify(outcome.mons[slot]!.build.boosts)))].map((text) => JSON.parse(text));
      expect(boosts, `${slot} stages`).toEqual([{ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...each.boosts }]);
    }
    if (each.sub) {
      const mix: Record<number, number> = {};
      for (const outcome of list) for (const { hp, chance } of outcome.mons[slot]!.substitute ?? []) mix[hp] = (mix[hp] ?? 0) + chance * outcome.chance;
      expect(Object.keys(mix).sort(), `${slot} Substitute`).toEqual(Object.keys(each.sub).sort());
      for (const [hp, chance] of Object.entries(each.sub)) expect(mix[Number(hp)]).toBeCloseTo(chance, 12);
    }
  }
  return { result, list };
}
const fields = (list: ReturnType<typeof outcomes>) => [...new Set(list.map((outcome) => `${outcome.field.weather}/${outcome.field.terrain}`))];

describe("a Max Move into a Substitute: its self effects act (T2M §3.22; T2-SB01-SB03)", () => {
  it("Max Darkness lowers every foe's Sp. Def, the holder's too; Max Knuckle raises the user's side; Max Lightning and Max Flare set the field", () => {
    const dyna = (id: string, ability: string, move: string) => fast(id, ability, move, { build: { mechanic: "dynamax" } });
    agrees(into("swsh", dyna("snorlax", "thickfat", "crunch"), lax(0, sub(58))), { PL: { boosts: { spd: -1 } }, PR: { boosts: { spd: -1 } } });
    agrees(into("swsh", dyna("lucario", "innerfocus", "closecombat"), lax(0, sub(58))), { OL: { boosts: { atk: 1 } }, OR: { boosts: { atk: 1 } } });
    const lightning = agrees(into("swsh", dyna("snorlax", "thickfat", "thunderbolt"), lax(0, sub(58))),
      { PL: { sub: { 19: 0.0625, 20: 0.125, 21: 0.1875, 22: 0.125, 23: 0.1875, 24: 0.125, 25: 0.1875 } } });
    expect(fields(lightning.list)).toEqual(["/Electric"]);
    expect(fields(agrees(into("swsh", dyna("charizard", "blaze", "flamethrower"), lax(0, sub(58))), {}).list)).toEqual(["Sun/"]);
  });
});

describe("a signature Z-Move into a Substitute (T2M §3.22; T2-SB05)", () => {
  it("Splintered Stormshards ends the terrain; Genesis Supernova sets Psychic Terrain (its secondary's self acts: S-SB-02b)", () => {
    const z = (id: string, ability: string, item: string, move: string) => fast(id, ability, move, { item, context: { useZ: true } });
    expect(fields(agrees(into("usum", z("lycanroc", "sandrush", "lycaniumz", "stoneedge"), lax(0, sub(58)), { terrain: "Psychic" }), {}).list)).toEqual(["/"]);
    expect(fields(agrees(into("usum", z("mew", "synchronize", "mewniumz", "psychic"), lax(0, sub(58))), {}).list)).toEqual(["/Psychic"]);
    expect(fields(agrees(into("usum", z("lycanroc", "sandrush", "lycaniumz", "stoneedge"), lax(0, sub(300))), {}).list)).toEqual(["/"]);
  });
});

describe("Magician and Parental Bond into a Substitute (T2M §3.22; T2-SB06, status-eot U15)", () => {
  it("Magician takes the item of the Pokémon behind it (S-SB-04)", () => {
    agrees(into("sv", fast("delphox", "magician", "psychic"), lax(0, { item: "leftovers", ...sub(58) })), { OL: { item: "leftovers" }, PL: { item: "" } });
    agrees(into("champions", champ("delphox", "magician", "psychic"), lax(0, { item: "leftovers", ...sub(58) })), { OL: { item: "leftovers" }, PL: { item: "" } });
  });
  it("both strikes walk the Substitute; Power-Up Punch's stage per strike (+2), whether or not the first breaks it (S-SB-05, S-SB-06)", () => {
    agrees(into("usum", kanga("usum", "poweruppunch"), lax(0, sub(20))), { OL: { boosts: { atk: 2 } }, PL: { hp: { min: 213, max: 217, average: 215.625, koChance: 0 } } });
    agrees(into("usum", kanga("usum", "poweruppunch"), lax(0, sub(300))), { OL: { boosts: { atk: 2 } } });
    agrees(into("usum", kanga("usum", "bodyslam"), lax(0, sub(58))), { PL: { hp: { min: 211, max: 216, average: 213.8125, koChance: 0 } } });
    agrees(into("champions", kanga("champions", "bodyslam"), lax(0, sub(20))), { PL: { hp: { min: 211, max: 216, average: 213.8125, koChance: 0 } } });
  });
  it("Mind Blown keeps its reason until the spread step adds its costs (plan's `costs`)", () => {
    const blown = turn("usum", { OL: { ...fast("blacephalon", "beastboost", "mindblown"), target: undefined }, OR: lax(8), PL: lax(0, sub(58)), PR: lax(16, sub(58)) });
    const result = calculateDoublesTurn(blown);
    // The oracle (S-SB-03-usum): two costs of 64 knock Blacephalon (128) out; its ally takes 42–51.
    if (result.status === "ready") expect(result.hp[SLOT.OL]).toMatchObject({ min: 0, max: 0, koChance: 1 });
    else expect(result).toMatchObject({ status: "not-estimated", reason: "Mind Blown into a Substitute is not modelled in 2v2." });
  });
});

describe("a multi-hit move in front of the effects the engine's later hits read (T2M §3.23; T2-SP01)", () => {
  it("every hit into the Substitute reads as the first: Multiscale halves both of Dual Wingbeat's (S-SP-01)", () => {
    agrees(into("sv", fast("talonflame", "flamebody", "dualwingbeat"), { id: "dragonite", ability: "multiscale", ...sub(30) }),
      { PL: { sub: { 6: 0.140625, 7: 0.28125, 8: 0.328125, 9: 0.1875, 10: 0.0625 } } });
    agrees(into("champions", champ("aerodactyl", "pressure", "dualwingbeat"), { id: "dragonite", ability: "multiscale", ...sub(30) }), { PL: { item: "", species: "dragonite" } });
  });
  it("from the first hit after the break the Pokémon reads them as a first hit: Stamina, Weak Armor, a resist Berry, Mummy (S-SP-02, S-SP-10, S-SP-03, S-SP-07)", () => {
    const spear = (defender: P, game: Game = "sv") => into(game, fast("cloyster", "skilllink", "iciclespear"), defender);
    agrees(spear({ id: "mudsdale", ability: "stamina", ...sub(20) }), { PL: { hp: { min: 75, max: 97, average: 88.375, koChance: 0 }, boosts: { def: 4 } } });
    agrees(spear({ id: "mudsdale", ability: "stamina", ...sub(20) }, "swsh"), { PL: { hp: { min: 75, max: 97, average: 88.375, koChance: 0 }, boosts: { def: 4 } } });
    agrees(into("sv", fast("cloyster", "skilllink", "rockblast"), { id: "skarmory", ability: "weakarmor", ...sub(20) }),
      { PL: { hp: { min: 118, max: 122, average: 120.625, koChance: 0 }, boosts: { def: -2, spe: 4 } } });
    agrees(into("usum", fast("breloom", "technician", "bulletseed"), { id: "swampert", ability: "torrent", item: "rindoberry", ...sub(30) }),
      { PL: { hp: { min: 0, max: 115, average: 38.5875, koChance: 0.65 } } });
    agrees(spear({ id: "dragonite", ability: "multiscale", ...sub(20) }), { PL: { hp: { min: 0, max: 0, average: 0, koChance: 1 } } });
    agrees(spear({ id: "garchomp", ability: "roughskin", item: "yacheberry", ...sub(20) }), { PL: { hp: { min: 0, max: 0, average: 0, koChance: 1 } } });
    agrees(into("swsh", fast("talonflame", "flamebody", "dualwingbeat"), { id: "cofagrigus", ability: "mummy", ...sub(20) }), { PL: { species: "cofagrigus" } });
    agrees(into("sv", fast("greninja", "torrent", "watershuriken"), lax(0, { item: "luminousmoss", ...sub(20) })), { PL: { hp: { min: 205, max: 235, average: 227.1111938477, koChance: 0 } } });
  });
  it("kept (ADDENDUM2 §2.3 #34): Triple Axel's powers, a Gem's first hit, Parental Bond's ×0.25 strike in front of one", () => {
    const reason = (input: DoublesTurnInput) => { const result = calculateDoublesTurn(input); return result.status === "not-estimated" ? result.reason : result.status; };
    expect(reason(into("sv", fast("weavile", "pressure", "tripleaxel"), { id: "dragonite", ability: "multiscale", ...sub(40) }))).toBe("Triple Axel into Dragonite's Substitute with Multiscale is not modelled in 2v2.");
    expect(reason(into("sv", fast("maushold", "technician", "populationbomb", { item: "normalgem" }), { id: "dragonite", ability: "multiscale", ...sub(40) })))
      .toBe("Population Bomb into Dragonite's Substitute with Multiscale is not modelled in 2v2.");
    expect(reason(into("usum", kanga("usum", "bodyslam"), { id: "dragonite", ability: "multiscale", ...sub(40) }))).toBe("Body Slam into Dragonite's Substitute with Multiscale is not modelled in 2v2.");
  });
  it("frozenCases reads every hit as the case's first", () => {
    const hit = (values: number[]) => ({ values, weights: values.map(() => 1 / values.length) });
    expect(frozenCases([{ chance: 0.35, hits: [hit([10, 12]), hit([7, 8])] }])).toEqual([{ chance: 0.35, hits: [hit([10, 12]), hit([10, 12])] }]);
  });
});

describe("an intact face behind a Substitute (T2M §3.13: the Substitute's prefix, the face's hit, the busted form; S-SP-04, S-SP-14)", () => {
  it("Icicle Spear: the hits into the Substitute, Disguise takes the next, the rest into the busted form", () => {
    agrees(into("sv", fast("cloyster", "skilllink", "iciclespear"), { id: "mimikyu", ability: "disguise", ...sub(20) }),
      { PL: { hp: { min: 51, max: 82, average: 75.84375, koChance: 0 }, item: "", species: "mimikyubusted" } });
    agrees(into("sv", fast("cloyster", "skilllink", "iciclespear"), { id: "mimikyu", ability: "disguise", item: "sitrusberry", ...sub(20) }),
      { PL: { hp: { min: 66, max: 96, average: 77.8432617188, koChance: 0 }, species: "mimikyubusted" } });
  });
});
