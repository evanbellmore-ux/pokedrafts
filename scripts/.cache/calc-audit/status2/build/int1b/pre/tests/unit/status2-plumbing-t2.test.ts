import { beforeAll, describe, expect, it } from "vitest";
import { calculateTurnMove, settleItems, usesHelpers } from "@/app/lib/battle/calculate";
import { hitStep, startHits, type HitLoopInput } from "@/app/lib/battle/hit-loop";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive, getBuildStats } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext } from "@/app/lib/battle/types";
import { createTurnSearch, prepareUses, type CalcTrace, type TurnStepOutcome, type TurnStepPart, type UsesEnv } from "@/app/lib/battle/uses-to-ko";

/**
 * status2 Step 0b′ and 0b.3 (scripts/.cache/calc-audit/status2/design ADDENDUM2.md §3.6: tier2-moves.md §2.3–§2.5,
 * tier2-presence.md §9.4–§9.5, inputs.md §4.4; build/STEP0B.md): each field set as the 2v2 kernel's hooks set it, against
 * pinned Showdown c23d2e94. The calculations' ranges are build/step0b-probes.ts's, the steps' distributions
 * build/step0b-step-probes.ts's, for the same scenarios on the pinned simulator. Level 50, 31 IVs, Serious, no EVs unless
 * set; doubles; one target unless it says spread.
 */
type Set = { species: string; ability: string; item?: string; evs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>> };
const GAMES = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" } as const satisfies Record<string, BattleGame>;
type Game = keyof typeof GAMES;
const id = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const runtimes = {} as Record<Game, BattleRuntime>;
beforeAll(async () => {
  for (const game of Object.keys(GAMES) as Game[]) runtimes[game] = await loadBattleRuntime(GAMES[game]);
});

function build(game: Game, set: Set, extra: Partial<BattleBuild> = {}): BattleBuild {
  const base = createBuild(id(set.species), runtimes[game]);
  const abilityId = id(set.ability);
  const trained = base.game === "champions" ? { ...base, points: { ...ZERO, ...set.evs } } : { ...base, native: { ...base.native, evs: { ...ZERO, ...set.evs } } };
  return { ...trained, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: id(set.item ?? ""), ...extra } as BattleBuild;
}
const LAX: Set = { species: "Snorlax", ability: "Thick Fat" };
function field(change: (c: BattleConditions) => BattleConditions = (c) => c, spread = false): BattleConditions {
  return change({ ...createConditions(), multipleTargets: spread, attackerSide: createSide(), defenderSide: createSide() });
}
function hit(game: Game, attacker: BattleBuild, defender: BattleBuild, move: string, conditions = field(), context?: MoveContext) {
  const runtime = runtimes[game];
  const row = calculateTurnMove(runtime.movesById.get(id(move))!, attacker, defender, conditions, context, runtime);
  return { row, range: [row.min, row.max] };
}

/** A doubles turn's step for one pair, as doubles-turn.ts searchFor and singleStep run it (prepareUses with the step's UsesEnv). */
function step(game: Game, attacker: BattleBuild, defender: BattleBuild, move: string, opts: {
  conditions?: BattleConditions; context?: MoveContext; env?: UsesEnv; part?: TurnStepPart; mode?: "all" | "lowest" | "highest"; follow?: false;
} = {}): TurnStepOutcome[] {
  const runtime = runtimes[game];
  const conditions = opts.conditions ?? field();
  const assigned = runtime.movesById.get(id(move))!;
  const trace: CalcTrace = {};
  const row = calculateTurnMove(assigned, attacker, defender, conditions, opts.context, runtime, trace);
  const m = prepareUses(attacker, defender, conditions, runtime, usesHelpers(runtime), { turn: true, ...opts.env });
  const search = createTurnSearch(m, {
    move: assigned, row, trace, context: opts.context,
    rerun: (next) => { const nextTrace: CalcTrace = {}; return { row: calculateTurnMove(assigned, next.attacker, next.defender, next.conditions, next.context, runtime, nextTrace), trace: nextTrace }; },
  }, opts.follow);
  const follow = opts.follow === false ? false : search.needsAttackerHP();
  const attackerHP = attacker.currentHP ?? getBuildStats(attacker, runtime)!.hp;
  const defenderHP = defender.currentHP ?? getBuildStats(defender, runtime)!.hp;
  const result = search.turnStep([{ attackerHP, target: new Map([[defenderHP, 1]]) }], opts.mode ?? "all", follow, opts.part);
  if ("failed" in result) throw new Error(result.failed);
  return result.outcomes;
}
/** The target's HP distribution over every outcome (rounded masses). */
function targetHP(outcomes: TurnStepOutcome[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const outcome of outcomes) for (const [hp, mass] of outcome.dist) out[hp] = +((out[hp] ?? 0) + mass).toFixed(6);
  return out;
}

describe("status2 Step 0b′: hidden targets, critical hits, priority and Helping Hand (T2M §2.3)", () => {
  it("T2-SI01 / T2-SI03: Earthquake into Dig and Gust into Fly at 2x final damage", () => {
    expect(hit("sv", build("sv", { species: "Excadrill", ability: "Sand Rush" }), build("sv", { species: "Garchomp", ability: "Rough Skin" }, { takenMods: { hidden: "dig" } }), "Earthquake", field((c) => c, true)).range).toEqual([116, 138]);
    expect(hit("sv", build("sv", LAX), build("sv", { species: "Dragonite", ability: "Inner Focus" }, { takenMods: { hidden: "fly" } }), "Gust").range).toEqual([22, 28]);
  });

  it("T2-SI05: Gust into Bounce at 2x power; CQ08b: Sky Drop doubles only its pair's own Gust, so a third Pokémon's is unboosted", () => {
    const bounce = hit("swsh", build("swsh", LAX), build("swsh", { species: "Lopunny", ability: "Limber" }, { takenMods: { hidden: "bounce" } }), "Gust").row;
    expect([bounce.min, bounce.max]).toEqual([22, 27]);
    expect(bounce.assumptions).toContain("Gust into a Pokémon in the air: 2x power.");
    // data/moves.ts skydrop onAnyBasePower reads the BasePower event's target, the attacker (sim/battle.ts runEvent args).
    expect(hit("usum", build("usum", LAX), build("usum", { species: "Braviary", ability: "Keen Eye", evs: { spe: 252 } }, { takenMods: { hidden: "skydrop" } }), "Gust").range).toEqual([14, 17]);
  });

  it("critBoost and laserFocus: G-Max Chi Strike's three layers and Laser Focus give a critical hit; Lucky Chant still blocks", () => {
    expect(hit("swsh", build("swsh", LAX, { critBoost: 3 }), build("swsh", LAX), "Body Slam").range).toEqual([111, 132]);
    expect(hit("usum", build("usum", LAX, { laserFocus: true }), build("usum", LAX), "Body Slam").range).toEqual([111, 132]);
    const chant = hit("usum", build("usum", LAX, { laserFocus: true }), build("usum", LAX), "Body Slam", field((c) => ({ ...c, defenderSide: { ...c.defenderSide, luckyChant: true } }))).row;
    expect([chant.min, chant.max]).toEqual([75, 88]);
  });

  it("T2-GW01-usum: a Gale Wings Brave Bird keeps the +1 the turn's start froze, so a Dazzling target blocks it", () => {
    const runtime = runtimes.usum;
    const hurt = build("usum", { species: "Talonflame", ability: "Gale Wings" });
    const talonflame = { ...hurt, currentHP: getBuildStats(hurt, runtime)!.hp - 20 };
    const bruxish = build("usum", { species: "Bruxish", ability: "Dazzling" });
    expect(hit("usum", talonflame, bruxish, "Brave Bird", field(), { frozenPriority: 1 }).range).toEqual([0, 0]);
    expect(hit("usum", talonflame, bruxish, "Brave Bird").range[1]).toBeGreaterThan(0);
  });

  it("allyTarget: a +1 move into the user's own ally meets neither Psychic Terrain nor the ally's Dazzling", () => {
    expect(hit("sv", build("sv", LAX), build("sv", LAX), "Quick Attack", field((c) => ({ ...c, terrain: "Psychic", allyTarget: true }))).range).toEqual([34, 42]);
    expect(hit("usum", build("usum", LAX), build("usum", { species: "Bruxish", ability: "Dazzling" }), "Quick Attack", field((c) => ({ ...c, allyTarget: true }))).range).toEqual([33, 40]);
  });

  it("helpingHands: two Helping Hands are one 2.25x modifier", () => {
    const row = hit("sv", build("sv", LAX), build("sv", LAX), "Body Slam", field((c) => ({ ...c, attackerSide: { ...c.attackerSide, helpingHand: true } })), { helpingHands: 2 }).row;
    expect([row.min, row.max]).toEqual([165, 195]);
    expect(row.assumptions).toContain("Helping Hand twice: 2.25x power.");
  });
});

describe("status2 Step 0b′: Electrify and Ion Deluge on own-type moves, Z-Moves and Max Moves (T2M §3.29)", () => {
  it("T2-Q01: a Dynamaxed Pixilate Hyper Voice becomes Max Lightning (no -ate boost)", () => {
    const row = hit("swsh", build("swsh", { species: "Sylveon", ability: "Pixilate" }, { mechanic: "dynamax" }), build("swsh", LAX), "Hyper Voice", field(), { retype: "electrify" }).row;
    expect([row.min, row.max, row.effectiveName, row.effectiveType]).toEqual([50, 59, "Max Lightning", "Electric"]);
  });
  it("T2-Q03: Weather Ball in sun is Electric at its doubled power", () => {
    const row = hit("swsh", build("swsh", { species: "Altaria", ability: "Natural Cure" }), build("swsh", { species: "Gyarados", ability: "Moxie" }), "Weather Ball", field((c) => ({ ...c, weather: "Sun" })), { retype: "electrify" }).row;
    expect([row.min, row.max, row.effectiveType]).toEqual([116, 140, "Electric"]);
  });
  it("T2-Q06 / Q04 / Q05: a Z-Move keeps its name and becomes Electric (Ion Deluge: a Normal one)", () => {
    const inferno = hit("usum", build("usum", { species: "Arcanine", ability: "Intimidate", item: "Firium Z" }), build("usum", LAX), "Flamethrower", field(), { useZ: true, retype: "electrify" }).row;
    expect([inferno.min, inferno.max, inferno.effectiveName, inferno.effectiveType]).toEqual([62, 73, "Inferno Overdrive", "Electric"]);
    const blitz = hit("usum", build("usum", { ...LAX, item: "Normalium Z" }), build("usum", LAX), "Body Slam", field((c) => ({ ...c, ionDeluge: true })), { useZ: true, retype: "iondeluge" }).row;
    expect([blitz.min, blitz.max, blitz.effectiveName, blitz.effectiveType]).toEqual([92, 109, "Breakneck Blitz", "Electric"]);
    expect(hit("usum", build("usum", { ...LAX, item: "Snorlium Z" }), build("usum", { species: "Garchomp", ability: "Rough Skin" }), "Giga Impact", field(), { useZ: true, retype: "electrify" }).range).toEqual([0, 0]);
  });
  it("T2-Q16: Raging Bull is Electric and still breaks Reflect", () => {
    const row = hit("champions", build("champions", { species: "Tauros-Paldea-Blaze", ability: "Intimidate" }), build("champions", LAX), "Raging Bull",
      field((c) => ({ ...c, defenderSide: { ...c.defenderSide, reflect: true } })), { retype: "electrify" }).row;
    expect([row.min, row.max, row.effectiveType]).toEqual([52, 62, "Electric"]);
  });
  it("T2-Q07 / Q09 / Q09b: Judgment; Ion Deluge on Weather Ball with no weather (Electric) and in rain (Water)", () => {
    expect(hit("usum", build("usum", { species: "Arceus-Fire", ability: "Multitype", item: "Flame Plate" }), build("usum", LAX), "Judgment", field(), { retype: "electrify" }).range).toEqual([41, 49]);
    const altaria = build("usum", { species: "Altaria", ability: "Natural Cure" });
    expect(hit("usum", altaria, build("usum", LAX), "Weather Ball", field((c) => ({ ...c, ionDeluge: true })), { retype: "iondeluge" }).range).toEqual([14, 17]);
    const rain = hit("usum", altaria, build("usum", LAX), "Weather Ball", field((c) => ({ ...c, weather: "Rain", ionDeluge: true })), { retype: "iondeluge" }).row;
    expect([rain.min, rain.max, rain.effectiveType]).toEqual([40, 48, "Water"]);
  });
  it("Liquid Voice, then Electrify; Galvanize under Electrify keeps its own boost", () => {
    expect(hit("swsh", build("swsh", { species: "Primarina", ability: "Liquid Voice" }), build("swsh", LAX), "Hyper Voice", field((c) => c, true), { retype: "electrify" }).range).toEqual([28, 34]);
    expect(hit("usum", build("usum", { species: "Golem-Alola", ability: "Galvanize" }), build("usum", LAX), "Body Slam", field(), { retype: "electrify" }).range).toEqual([94, 112]);
  });
});

describe("status2 Step 0b.3: the presence moves' contexts (T2P §9.5)", () => {
  it("a combined Pledge (basePower, retypeTo, forceStab), Round's 120, Pursuit with no switch, Mat Block's quarter", () => {
    const pledge = hit("sv", build("sv", { species: "Lapras", ability: "Water Absorb" }), build("sv", LAX), "Water Pledge", field(), { basePower: 150, retypeTo: "Grass", forceStab: true }).row;
    expect([pledge.min, pledge.max, pledge.effectiveType]).toEqual([69, 82, "Grass"]);
    expect(hit("sv", build("sv", LAX), build("sv", LAX), "Round", field(), { basePower: 120 }).range).toEqual([45, 54]);
    expect(hit("usum", build("usum", LAX), build("usum", LAX), "Pursuit", field(), { switching: false }).range).toEqual([23, 28]);
    expect(hit("usum", build("usum", LAX), build("usum", LAX), "Pursuit").row.kind).toBe("needs-context");
    const mat = hit("usum", build("usum", { species: "Arcanine", ability: "Intimidate", item: "Firium Z" }), build("usum", LAX), "Flamethrower",
      field((c) => ({ ...c, defenderSide: { ...c.defenderSide, protect: true, protectName: "Mat Block" } })), { useZ: true }).row;
    expect([mat.min, mat.max]).toEqual([11, 14]);
    expect(mat.assumptions.some((line) => line.startsWith("Mat Block:"))).toBe(true);
  });

  it("settleItems' reads: a foe's Unnerve read from all four (reads.unnerved) changes one settle", () => {
    const runtime = runtimes.sv;
    const holder = build("sv", { ...LAX, item: "Sitrus Berry" }, { currentHP: 100 });
    const unnerve = build("sv", { species: "Tyranitar", ability: "Unnerve" });
    const conditions = field();
    const kept = settleItems(holder, unnerve, conditions, runtime, { label: "Snorlax" }, "Snorlax");
    expect(kept.build.itemId).toBe("sitrusberry");
    const eaten = settleItems(holder, unnerve, conditions, runtime, { label: "Snorlax" }, "Snorlax", false, { unnerved: false });
    expect([eaten.build.itemId, eaten.build.currentHP]).toEqual(["", 158]);
    const stopped = settleItems(holder, build("sv", LAX), conditions, runtime, { label: "Snorlax" }, "Snorlax", false, { unnerved: true });
    expect(stopped.build.itemId).toBe("sitrusberry");
  });
});

describe("status2 Step 0b′: the turn step's environment (T2M §2.4, §2.5; T2P §9.4)", () => {
  it("O1 / O1b: a Focus Band leaves 1 HP in 1/10 of each knocking hit (0.9 / 0.1; two hits 0.99 / 0.01)", () => {
    const chomp = build("sv", { species: "Garchomp", ability: "Rough Skin", evs: { atk: 252, spe: 252 } });
    expect(targetHP(step("sv", chomp, build("sv", { ...LAX, item: "Focus Band" }, { currentHP: 30 }), "Dragon Claw", { env: { focusBand: true } }))).toEqual({ 0: 0.9, 1: 0.1 });
    const nite = build("sv", { species: "Dragonite", ability: "Inner Focus", evs: { atk: 252, spe: 252 } });
    expect(targetHP(step("sv", nite, build("sv", { ...LAX, item: "Focus Band" }, { currentHP: 20 }), "Dual Wingbeat", { env: { focusBand: true } }))).toEqual({ 0: 0.99, 1: 0.01 });
  });

  it("T2-BE01: a Ganlon Berry stops the use at hit 1; the continuation at +1 Defense gives Showdown's distribution", () => {
    const nite = build("sv", { species: "Dragonite", ability: "Inner Focus", evs: { spe: 252 } });
    const stops = step("sv", nite, build("sv", { ...LAX, item: "Ganlon Berry" }, { currentHP: 100 }), "Dual Wingbeat", { env: { betweenHits: true } });
    expect(stops.every((outcome) => outcome.stopAt === 1 && outcome.target.itemId === "ganlonberry")).toBe(true);
    expect(targetHP(stops)).toEqual({ 51: 0.0625, 52: 0.1875, 54: 0.1875, 55: 0.1875, 57: 0.1875, 58: 0.1875 });
    const raw: Record<number, number> = {};
    for (const [hp, mass] of stops[0].dist) {
      const next = step("sv", nite, build("sv", LAX, { currentHP: hp, boosts: { atk: 0, def: 1, spa: 0, spd: 0, spe: 0 } }), "Dual Wingbeat", { part: { caseIndex: 0, skip: 1 } });
      for (const outcome of next) for (const [after, share] of outcome.dist) raw[after] = (raw[after] ?? 0) + mass * share;
    }
    const total = Object.fromEntries(Object.entries(raw).map(([hp, mass]) => [hp, +mass.toFixed(6)]));
    expect(total).toEqual({ 17: 0.003906, 18: 0.027344, 19: 0.046875, 20: 0.027344, 21: 0.125, 22: 0.105469, 23: 0.066406, 24: 0.1875, 25: 0.105469, 26: 0.070313, 27: 0.128906, 28: 0.058594, 29: 0.023438, 30: 0.023438 });
  });

  it("T2-AF01 / AF03: Aftermath on the knocking hit, before the hit's Sitrus Berry and before the recoil", () => {
    const loop: HitLoopInput = {
      hp: 110, maxHP: 183, baseMaxHP: 183, attackerAbility: "roughskin", attackerItem: "sitrusberry", targetAbility: "aftermath", targetItem: "",
      attackerShielded: false, targetShielded: false, targetDynamaxed: false, contact: true, category: "Physical", drain: null, takesBerry: false,
      targetGulping: false, generation: 9, koRetaliation: { aftermath: true, innardsOut: 0 },
    };
    const knocked = hitStep(loop, startHits(loop), 1, true);
    expect([knocked.state.hp, knocked.losses, knocked.ate]).toEqual([110, [{ source: "Aftermath", amount: 45 }], "sitrusberry"]);
    // Only the knocking hit (hitStep's `knocked`) sets it off.
    expect(hitStep(loop, startHits(loop), 1).state.hp).toBe(110);
    const arcanine = build("sv", { species: "Arcanine", ability: "Intimidate", evs: { spe: 252 } });
    const [out] = step("sv", arcanine, build("sv", { species: "Electrode", ability: "Aftermath" }, { currentHP: 30 }), "Flare Blitz", { env: { koRetaliation: { aftermath: true, innardsOut: 0 } } });
    expect([out.knocked, out.attacker.hp]).toEqual([true, 114]);
  });

  it("T2-IO02: Innards Out deals the HP the target had as the move started, on the knocking second hit", () => {
    const nite = build("swsh", { species: "Dragonite", ability: "Inner Focus", evs: { spe: 252 } });
    const outcomes = step("swsh", nite, build("swsh", { species: "Pyukumuku", ability: "Innards Out" }, { currentHP: 45 }), "Dual Wingbeat", { env: { koRetaliation: { aftermath: false, innardsOut: 45 } } });
    expect(outcomes.map((outcome) => [outcome.knocked, outcome.landed, outcome.attacker.hp])).toEqual([[true, 2, 121]]);
  });

  it("T2-UN03: the hit that knocks out the Unnerve holder ends Unnerve before its Update: the Sitrus Berry, then the recoil", () => {
    const arcanine = build("sv", { species: "Arcanine", ability: "Intimidate", item: "Sitrus Berry", evs: { spe: 252 } }, { currentHP: 100 });
    const tyranitar = build("sv", { species: "Tyranitar", ability: "Unnerve", item: "Rocky Helmet" }, { currentHP: 5 });
    const [out] = step("sv", arcanine, tyranitar, "Flare Blitz", { env: { unnerve: { foes: true, target: false, attacker: false, endsOnKO: true } } });
    expect([out.knocked, out.attacker.hp, out.attacker.itemId]).toEqual([true, 112, ""]);
  });

  it("T2-FV01: Flower Veil keeps Snarl's drop off its Grass ally; spreadUser lists Gooey's reaction (T2-SE02)", () => {
    const roar = build("sv", { species: "Incineroar", ability: "Blaze", evs: { spe: 252 } });
    const spread = field((c) => c, true);
    const [venusaur] = step("sv", roar, build("sv", { species: "Venusaur", ability: "Overgrow" }), "Snarl", { conditions: spread, follow: false, env: { veil: "flowerveil" } });
    expect(venusaur.target.boosts.spa).toBe(0);
    expect(targetHP([venusaur])).toEqual({ 131: 0.0625, 133: 0.375, 134: 0.375, 136: 0.1875 });
    const [comfey] = step("sv", roar, build("sv", { species: "Comfey", ability: "Flower Veil" }), "Snarl", { conditions: spread, follow: false });
    expect(comfey.target.boosts.spa).toBe(-1);
    const king = build("champions", { species: "Kingambit", ability: "Defiant", evs: { spe: 32 } });
    const [goodra] = step("champions", king, build("champions", { species: "Goodra", ability: "Gooey" }), "Breaking Swipe", { conditions: spread, follow: false, env: { spreadUser: true } });
    expect(goodra.reactions).toEqual([{ source: "Gooey", stages: { spe: -1 } }]);
    expect([goodra.attacker.boosts.spe, goodra.attacker.boosts.atk, goodra.target.boosts.atk]).toEqual([0, 0, -1]);
  });

  it("T2-SP01: a fresh continuation's first hit reads the target as a first hit (Multiscale at full HP)", () => {
    const wing = build("sv", { species: "Dragonite", ability: "Inner Focus", evs: { spe: 252 } });
    const scale = build("sv", { species: "Dragonite", ability: "Multiscale" });
    // Showdown: Dual Wingbeat into a full-HP Multiscale Dragonite behind a 1 HP Substitute: hit 1 breaks it, hit 2 deals 15-18.
    expect(targetHP(step("sv", wing, scale, "Dual Wingbeat", { part: { caseIndex: 0, skip: 1, fresh: true } }))).toEqual({ 148: 0.3125, 149: 0.25, 150: 0.25, 151: 0.1875 });
    // Not fresh, the second hit keeps the engine's second-hit damage (Multiscale gone after the first hit).
    expect(targetHP(step("sv", wing, scale, "Dual Wingbeat", { part: { caseIndex: 0, skip: 1 }, mode: "lowest" }))).toEqual({ 135: 1 });
  });

  it("report: lastHit and dealt of a multi-hit move; used; rises without a copy", () => {
    const nite = build("sv", { species: "Dragonite", ability: "Inner Focus", evs: { spe: 252 } });
    const [low] = step("sv", nite, build("sv", LAX), "Dual Wingbeat", { mode: "lowest", env: { report: { lastHit: true, dealt: true } } });
    expect([low.dealt, low.lastHit]).toEqual([84, { damage: 42, category: "Physical" }]);
    const [high] = step("sv", nite, build("sv", LAX), "Dual Wingbeat", { mode: "highest", env: { report: { lastHit: true, dealt: true } } });
    expect([high.dealt, high.lastHit]).toEqual([98, { damage: 49, category: "Physical" }]);
    const arcanine = build("sv", { species: "Arcanine", ability: "Intimidate", item: "Sitrus Berry", evs: { spe: 252 } }, { currentHP: 100 });
    const [used] = step("sv", arcanine, build("sv", { species: "Tyranitar", ability: "Unnerve", item: "Rocky Helmet" }, { currentHP: 5 }), "Flare Blitz",
      { env: { unnerve: { foes: true, target: false, attacker: false, endsOnKO: true }, report: { used: true } } });
    expect(used.used).toEqual({ att: ["sitrusberry"] });
    const charger = build("sv", { species: "Talonflame", ability: "Flame Body" });
    const [charged] = step("sv", charger, build("sv", { species: "Kingambit", ability: "Defiant" }), "Flame Charge", { mode: "lowest", env: { report: { rises: true } } });
    expect(charged.rises).toEqual({ att: { spe: 1 } });
  });
});
