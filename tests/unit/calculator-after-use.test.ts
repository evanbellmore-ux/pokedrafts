import { describe, expect, it } from "vitest";
import { calculateMatchup, type MatchupResult } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, getBuildStats } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { AfterUse, BattleBuild, BattleConditions, MoveContext, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * One use's outcome (MoveDamageResult.afterUse): the target's HP after the hits of one use, from its HP when the
 * move starts, as pinned Showdown c23d2e94 sim/battle-actions.ts hitStepMoveHitLoop walks them. Every value in
 * `SHOWDOWN` was checked by scripts/.cache/calc-audit/after-use/verify.ts against
 *  - a brute force over every hit-count draw and every roll sequence, written apart from app/lib/battle, fed with
 *    Showdown's own per-hit rolls and draws (exact);
 *  - Showdown itself over every draw and every distinct roll of every hit, where that is under 120,000 leaves
 *    (exact), and with forced lowest and highest rolls on the fewest and most hits (low, high);
 *  - 4,000 real Showdown turns per case with crypto-seeded rolls (KO chance and average within 4 standard errors).
 * The HP is read when the turn's residuals start. Level 50, 0 EVs / Stat Points, 31 IVs, Serious nature, Singles,
 * no critical hit, every accuracy check passing. Garchomp's maximum HP is 183 (Sitrus line 91, Figy line 45).
 */
const runtimes: Partial<Record<string, BattleRuntime>> = { champions: championsRuntime };
async function game(id: "scarlet_violet" | "sword_shield" | "ultra_sun_ultra_moon" | "champions"): Promise<BattleRuntime> {
  return runtimes[id] ??= await loadBattleRuntime(id);
}
type Spec = { ability?: string; item?: string; hp?: number; frac?: number; level?: number };
function build(runtime: BattleRuntime, id: string, spec: Spec = {}): BattleBuild {
  const base = { ...createBuild(id, runtime), nature: "Serious", ...(spec.ability ? { abilityId: spec.ability } : {}), itemId: spec.item ?? "" } as BattleBuild;
  const leveled = spec.level !== undefined && base.game !== "champions" ? { ...base, native: { ...base.native, level: spec.level } } as BattleBuild : base;
  const max = getBuildStats(leveled, runtime)!.hp;
  const hp = spec.hp ?? (spec.frac !== undefined ? Math.max(1, Math.floor(max * spec.frac)) : undefined);
  return hp === undefined ? leveled : { ...leveled, currentHP: hp };
}
function matchup(runtime: BattleRuntime, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, contexts: Record<string, MoveContext> = {}): MatchupResult {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", multipleTargets: false, ...field }, contexts, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out;
}
function row(out: MatchupResult, moveId: string): MoveDamageResult {
  const found = out.results.find((result) => result.moveId === moveId);
  expect(found?.kind, moveId).toBe("calculated");
  return found!;
}
const MULTI_HIT_NOTE = "No one-use KO chance for multiple hits.";
/**
 * afterUse to the stated precision: whole HP exactly, the average to 1e-9, the KO chance to 1e-12; the roll paths
 * when the case states them, and always their own arithmetic (the damage dealt is the HP taken off plus the HP
 * regained on that path).
 */
function expectUse(actual: AfterUse | undefined, expected: AfterUse, label = "") {
  expect(actual, label).toBeDefined();
  const { average, koChance, paths, ...whole } = actual!;
  const { average: expectedAverage, koChance: expectedKO, paths: expectedPaths, ...expectedWhole } = expected;
  expect(whole, label).toEqual(expectedWhole);
  if (expectedPaths) expect(paths, label).toEqual(expectedPaths);
  expect(paths, label).toBeDefined();
  for (const mode of ["low", "high"] as const) {
    const regained = paths![mode].heals.reduce((sum, fact) => sum + Number(/\+(\d+) HP\.$/.exec(fact)![1]), 0);
    expect(paths![mode].dealt, `${label} ${mode} path`).toBe(actual!.start - actual![mode] + regained);
  }
  expect(Math.abs(average - expectedAverage), `${label} average ${average}`).toBeLessThan(1e-9);
  expect(Math.abs(koChance - expectedKO), `${label} koChance ${koChance}`).toBeLessThan(1e-12);
}
/** A row with several hits takes its one-use KO chance from afterUse and drops the note that it had none. */
function expectSeveral(result: MoveDamageResult) {
  expect(result.hits).toBeGreaterThan(1);
  expect(result.ohkoChance).toBe(result.afterUse!.koChance);
  expect(result.assumptions).not.toContain(MULTI_HIT_NOTE);
}

/**
 * An independent walk of one use over the row's own per-hit rolls (each equally likely) and hit-count chances, by
 * pinned Showdown's rules: the hits stop once the target is at 0; at full HP Sturdy, then Focus Sash (used up),
 * leaves 1 HP; after each hit an HP berry at its line heals once.
 */
type Rules = { maxHP: number; sash?: boolean; sturdy?: boolean; berry?: { name: string; line: number; heal: number } };
function walkUse(result: MoveDamageResult, start: number, rules: Rules): AfterUse {
  const hits = Array.isArray(result.rolls) && Array.isArray(result.rolls[0]) ? result.rolls as number[][] : [result.rolls as number[]];
  const counts = result.hitChances ?? [{ hits: hits.length, chance: 1 }];
  type St = { hp: number; held: boolean; sash: boolean };
  const regained: number[] = [];
  const step = (s: St, roll: number, note: (heal: number) => void): St => {
    if (s.hp === 0) return s;
    let damage = roll, sash = s.sash, held = s.held;
    if (s.hp === rules.maxHP && damage >= s.hp) {
      if (rules.sturdy) damage = s.hp - 1;
      else if (sash) { damage = s.hp - 1; sash = false; }
    }
    let hp = Math.max(0, s.hp - damage);
    if (hp > 0 && held && rules.berry && hp <= rules.berry.line) {
      held = false;
      const healed = Math.min(rules.maxHP, hp + rules.berry.heal);
      note(healed - hp);
      hp = healed;
    }
    return { hp, held, sash };
  };
  const noteAll = (heal: number) => { regained.push(heal); };
  const first: St = { hp: start, held: !!rules.berry, sash: !!rules.sash };
  const finals = new Map<number, number>();
  let states = new Map<string, [St, number]>([[JSON.stringify(first), [first, 1]]]);
  for (let hit = 0, next = 0; next < counts.length; hit++) {
    for (; next < counts.length && counts[next].hits === hit; next++) {
      for (const [s, mass] of states.values()) finals.set(s.hp, (finals.get(s.hp) ?? 0) + mass * counts[next].chance);
    }
    if (next === counts.length) break;
    const after = new Map<string, [St, number]>();
    for (const [s, mass] of states.values()) {
      for (const roll of hits[hit]) {
        const to = step(s, roll, noteAll);
        const key = JSON.stringify(to);
        const entry = after.get(key);
        if (entry) entry[1] += mass / hits[hit].length; else after.set(key, [to, mass / hits[hit].length]);
      }
    }
    states = after;
  }
  // A roll path's one sequence: the HP it leaves, and its damage dealt with the heal it ate.
  const line = (pick: (rolls: number[]) => number, count: number) => {
    let s = first, heal = 0;
    for (let hit = 0; hit < count; hit++) s = step(s, pick(hits[hit]), (amount) => { heal += amount; });
    return { hp: s.hp, heal };
  };
  const support = [...finals.keys()];
  const least = Math.min(...regained), most = Math.max(...regained);
  const low = line((rolls) => Math.min(...rolls), counts[0].hits), high = line((rolls) => Math.max(...rolls), counts[counts.length - 1].hits);
  const path = ({ hp, heal }: { hp: number; heal: number }) => ({ dealt: start - hp + heal, heals: heal && rules.berry ? [`${rules.berry.name}: +${heal} HP.`] : [] });
  return {
    start, low: low.hp, high: high.hp,
    average: [...finals].reduce((sum, [hp, mass]) => sum + hp * mass, 0), min: Math.min(...support), max: Math.max(...support), koChance: finals.get(0) ?? 0,
    heals: regained.length && rules.berry ? [`${rules.berry.name}: +${least === most ? least : `${least}–${most}`} HP.`] : [],
    paths: { low: path(low), high: path(high) },
  };
}

type GameId = "scarlet_violet" | "sword_shield" | "ultra_sun_ultra_moon" | "champions";
/** A verified case: the game, the move, the attacker and the target, the field, the row's hits, and Showdown's outcome. */
type Verified = { game: GameId; move: string; attacker: [string, Spec]; target: [string, Spec & { dynamax?: boolean }]; field?: Partial<BattleConditions>; hits: number; use: AfterUse };
async function verified({ game: gameId, move, attacker, target, field, hits, use }: Verified) {
  const runtime = await game(gameId);
  const defender = build(runtime, target[0], target[1]);
  const result = row(matchup(runtime, build(runtime, attacker[0], attacker[1]), target[1].dynamax ? { ...defender, mechanic: "dynamax" } : defender, field), move);
  const label = `${gameId} ${move} ${attacker[0]} -> ${target[0]} ${JSON.stringify(target[1])}`;
  expect(result.hits, label).toBe(hits);
  expectUse(result.afterUse, use, label);
  if (hits > 1) expectSeveral(result);
  else expect(result.ohkoChance, label).toBe(use.koChance);
  return result;
}
const SV = "scarlet_violet", SS = "sword_shield", US = "ultra_sun_ultra_moon", CH = "champions";
const MAUSHOLD: [string, Spec] = ["maushold", { ability: "technician" }];
const BRELOOM: [string, Spec] = ["breloom", { ability: "technician" }];
const CINCCINO: [string, Spec] = ["cinccino", { ability: "skilllink" }];
const SITRUS = ["Sitrus Berry: +45 HP."];
const chomp = (spec: Spec & { dynamax?: boolean }): [string, Spec & { dynamax?: boolean }] => ["garchomp", { ability: "sandveil", ...spec }];

describe("one use's outcome against pinned Showdown", () => {
  it("walks Population Bomb into Garchomp's Sitrus Berry between hits", async () => {
    const cases: Verified[] = [
      // From full HP the berry heals 45 after the hit that takes Garchomp to 91 or less; Rough Skin lets 9 hits land.
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: chomp({ ability: "roughskin", item: "sitrusberry" }), hits: 9,
        use: { start: 183, low: 93, high: 66, average: 86.8125, min: 66, max: 93, koChance: 0, heals: SITRUS } },
      { game: CH, move: "populationbomb", attacker: MAUSHOLD, target: chomp({ ability: "roughskin", item: "sitrusberry", frac: 0.7 }), hits: 9,
        use: { start: 128, low: 38, high: 11, average: 31.8125, min: 11, max: 38, koChance: 0, heals: SITRUS } },
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: chomp({ ability: "roughskin", item: "sitrusberry", frac: 0.6 }), hits: 9,
        use: { start: 109, low: 19, high: 0, average: 12.812503267006832, min: 0, max: 19, koChance: 0.000011336233001202345, heals: SITRUS } },
      // All 10 hits deal 150 or more: without the berry 110 HP is always out; the heal makes it 83.95%.
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: chomp({ item: "sitrusberry", hp: 110 }), hits: 10,
        use: { start: 110, low: 5, high: 0, average: 0.24691423065178242, min: 0, max: 5, koChance: 0.8395078098483282, heals: SITRUS } },
      // 51% (93 HP) eats it after the first hit; 50% (91) ate it before the move, so the move starts at 136 without it.
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: chomp({ item: "sitrusberry", frac: 0.51 }), hits: 10,
        use: { start: 93, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: SITRUS } },
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: chomp({ item: "sitrusberry", frac: 0.5 }), hits: 10,
        use: { start: 136, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: [] } },
      // Rough Skin stops the hits on the ninth: 135-162 from 120 HP always knocks out.
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: chomp({ ability: "roughskin", hp: 120 }), hits: 9,
        use: { start: 120, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: [] } },
    ];
    for (const entry of cases) await verified(entry);
    const full = row(matchup(await game(SV), build(await game(SV), ...MAUSHOLD), build(await game(SV), ...chomp({ ability: "roughskin", item: "sitrusberry" }))), "populationbomb");
    expect(full).toMatchObject({ attackerFaintsOnHit: { hit: 9, of: 10, by: ["Rough Skin"] }, ohkoChance: 0 });
  });

  it("weighs every count of a random hit count", async () => {
    for (const entry of [
      // Loaded Dice Population Bomb: 4-10 hits at 1/7 each; the fewest hits at the lowest rolls leave 123.
      { game: SV, move: "populationbomb", attacker: ["maushold", { ability: "technician", item: "loadeddice" }], target: chomp({ item: "sitrusberry" }), hits: 10,
        use: { start: 183, low: 123, high: 48, average: 104.9761580313955, min: 48, max: 136, koChance: 0, heals: SITRUS } },
      { game: SV, move: "populationbomb", attacker: ["maushold", { ability: "technician", item: "loadeddice" }], target: chomp({ item: "sitrusberry", hp: 120 }), hits: 10,
        use: { start: 120, low: 105, high: 0, average: 55.187785205799486, min: 0, max: 105, koChance: 0.0004819468015609475, heals: SITRUS } },
      // Bullet Seed: 2-5 hits (35/35/15/15%); 4 or 5 hits always knock 109 HP out, 3 never do: 30%.
      { game: SV, move: "bulletseed", attacker: BRELOOM, target: chomp({ frac: 0.6 }), hits: 5,
        use: { start: 109, low: 53, high: 0, average: 22.05, min: 0, max: 53, koChance: 0.3, heals: [] } },
      { game: SV, move: "bulletseed", attacker: BRELOOM, target: chomp({ item: "sitrusberry", frac: 0.7 }), hits: 5,
        use: { start: 128, low: 117, high: 3, average: 76.9, min: 3, max: 117, koChance: 0, heals: SITRUS } },
      { game: SV, move: "bulletseed", attacker: ["breloom", { ability: "technician", item: "loadeddice" }], target: chomp({ frac: 0.5 }), hits: 5,
        use: { start: 91, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: [] } },
    ] as Verified[]) await verified(entry);
  });

  it("eats each HP berry at its own line and heals by its own rules", async () => {
    for (const entry of [
      // The Figy family at a quarter: 47 HP eats it between hits (+61), 45 before the move (to 106).
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: chomp({ item: "figyberry", frac: 0.26 }), hits: 10,
        use: { start: 47, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: ["Figy Berry: +61 HP."] } },
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: chomp({ item: "figyberry", frac: 0.25 }), hits: 10,
        use: { start: 106, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: [] } },
      // Gluttony at half: Snorlax (235 HP) at 50% ate it before the move (to 195), at 60% eats it between hits.
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: ["snorlax", { ability: "gluttony", item: "figyberry", frac: 0.5 }], hits: 10,
        use: { start: 195, low: 5, high: 0, average: 0.000015305854503822047, min: 0, max: 5, koChance: 0.9999881312496655, heals: [] } },
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: ["snorlax", { ability: "gluttony", item: "figyberry", frac: 0.6 }], hits: 10,
        use: { start: 141, low: 29, high: 0, average: 7.1832515221376525, min: 0, max: 29, koChance: 0.04906166050750471, heals: ["Figy Berry: +78 HP."] } },
      // Ultra Sun and Ultra Moon's Figy heals half.
      { game: US, move: "tailslap", attacker: CINCCINO, target: chomp({ item: "figyberry", frac: 0.3 }), hits: 5,
        use: { start: 54, low: 65, high: 50, average: 59.6875, min: 50, max: 65, koChance: 0, heals: ["Figy Berry: +91 HP."] } },
      // Ripen doubles the heal; Cheek Pouch heals a third more after it, up to the maximum.
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: ["appletun", { ability: "ripen", item: "sitrusberry", frac: 0.6 }], hits: 10,
        use: { start: 111, low: 43, high: 0, average: 18.000000054075826, min: 0, max: 43, koChance: 1.584712663316168e-7, heals: ["Sitrus Berry: +92 HP."] } },
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: ["greedent", { ability: "cheekpouch", item: "sitrusberry" }], hits: 10,
        use: { start: 195, low: 150, high: 123, average: 147.1505218707025, min: 123, max: 150, koChance: 0, heals: ["Sitrus Berry: +48 HP.", "Cheek Pouch: +50–65 HP."] } },
      // Enigma Berry after the first super-effective hit, at any HP.
      { game: SV, move: "iciclespear", attacker: ["cloyster", { ability: "skilllink" }], target: chomp({ item: "enigmaberry" }), hits: 5,
        use: { start: 183, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: ["Enigma Berry: +45 HP."] } },
      // Berry Juice is drunk, not eaten: the attacker's Unnerve does not stop it.
      { game: US, move: "crunch", attacker: ["tyranitar", { ability: "unnerve" }], target: chomp({ item: "berryjuice", frac: 0.6 }), hits: 1,
        use: { start: 109, low: 68, high: 56, average: 61.75, min: 56, max: 68, koChance: 0, heals: ["Berry Juice: +20 HP."] } },
    ] as Verified[]) await verified(entry);
  });

  it("keeps the berry where the attacker's Unnerve, Magic Room or Klutz stops it", async () => {
    for (const entry of [
      { game: SV, move: "rockblast", attacker: ["tyranitar", { ability: "unnerve" }], target: chomp({ item: "sitrusberry", frac: 0.7 }), hits: 5,
        use: { start: 128, low: 110, high: 68, average: 96.03125000000001, min: 68, max: 110, koChance: 0, heals: [] } },
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: chomp({ item: "sitrusberry", frac: 0.6 }), field: { magicRoom: true }, hits: 10,
        use: { start: 109, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: [] } },
      { game: SV, move: "bulletseed", attacker: BRELOOM, target: ["golurk", { ability: "klutz", item: "sitrusberry", frac: 0.6 }], hits: 5,
        use: { start: 98, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: [] } },
    ] as Verified[]) await verified(entry);
  });

  it("starts from a stat Berry's stage when it was eaten before the move", async () => {
    const sv = await game(SV);
    for (const entry of [
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: chomp({ item: "ganlonberry", frac: 0.25 }), hits: 10,
        use: { start: 45, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: [] } },
      // Liechi's Attack changes nothing here, eaten between hits.
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: chomp({ item: "liechiberry", frac: 0.4 }), hits: 10,
        use: { start: 73, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: [] } },
      // Apicot's +1 Sp. Def: 10.95% to knock 45 HP out.
      { game: SV, move: "watershuriken", attacker: ["greninja", { ability: "torrent" }], target: chomp({ item: "apicotberry", frac: 0.25 }), hits: 5,
        use: { start: 45, low: 31, high: 0, average: 17.330001306533813, min: 0, max: 31, koChance: 0.1095113754272461, heals: [] } },
    ] as Verified[]) await verified(entry);
    // Each hit is weaker than without the stage, and the KO chance lower.
    const greninja = build(sv, "greninja", { ability: "torrent" });
    const raised = row(matchup(sv, greninja, build(sv, "garchomp", { ability: "sandveil", item: "apicotberry", frac: 0.25 })), "watershuriken");
    const plain = row(matchup(sv, greninja, build(sv, "garchomp", { ability: "sandveil", frac: 0.25 })), "watershuriken");
    expect(raised.max!).toBeLessThan(plain.max!);
    expect(raised.afterUse!.koChance).toBeLessThan(plain.afterUse!.koChance);
    const maushold = build(sv, ...MAUSHOLD);
    const ganlon = row(matchup(sv, maushold, build(sv, "garchomp", { ability: "sandveil", item: "ganlonberry", frac: 0.25 })), "populationbomb");
    expect(ganlon.max!).toBeLessThan(row(matchup(sv, maushold, build(sv, "garchomp", { ability: "sandveil", frac: 0.25 })), "populationbomb").max!);
  });

  it("leaves 1 HP on the first hit only for Focus Sash and Sturdy, and halves only Multiscale's first", async () => {
    for (const entry of [
      // Level 5: every hit knocks out; the first leaves 1 HP and the second takes it.
      { game: SV, move: "tailslap", attacker: CINCCINO, target: ["dedenne", { ability: "pickup", item: "focussash", level: 5 }], hits: 5,
        use: { start: 23, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: [] } },
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: ["donphan", { ability: "sturdy", level: 5 }], hits: 10,
        use: { start: 25, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: [] } },
      { game: SV, move: "iciclespear", attacker: ["cloyster", { ability: "skilllink" }], target: ["dragonite", { ability: "multiscale" }], hits: 5,
        use: { start: 166, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: [] } },
      // A busted Disguise takes every hit.
      { game: SV, move: "bulletseed", attacker: BRELOOM, target: ["mimikyubusted", { ability: "disguise", frac: 0.8 }], hits: 5,
        use: { start: 104, low: 38, high: 0, average: 12.043554687499999, min: 0, max: 38, koChance: 0.5447265625000001, heals: [] } },
    ] as Verified[]) await verified(entry);
  });

  it("follows escalating hits, Parental Bond's two strikes and an attacker that faints between hits", async () => {
    for (const entry of [
      { game: SV, move: "tripleaxel", attacker: ["weavile", { ability: "pressure" }], target: chomp({ item: "sitrusberry", frac: 0.7 }), hits: 3,
        use: { start: 128, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: SITRUS } },
      { game: US, move: "return", attacker: ["kangaskhanmega", { ability: "parentalbond", item: "kangaskhanite" }], target: chomp({ item: "sitrusberry", frac: 0.7 }), hits: 2,
        use: { start: 128, low: 84, high: 65, average: 75, min: 65, max: 84, koChance: 0, heals: SITRUS } },
      // From 10 HP the drain and Rough Skin decide on the rolls whether the second strike lands.
      { game: US, move: "drainpunch", attacker: ["kangaskhanmega", { ability: "parentalbond", item: "kangaskhanite", hp: 10 }], target: chomp({ ability: "roughskin", item: "sitrusberry", frac: 0.55 }), hits: 2,
        use: { start: 100, low: 100, high: 91, average: 96.0625, min: 91, max: 100, koChance: 0, heals: SITRUS } },
      // Rough Skin and Rocky Helmet faint a 30% HP Cinccino on the second hit.
      { game: SV, move: "tailslap", attacker: ["cinccino", { ability: "skilllink", frac: 0.3 }], target: chomp({ ability: "roughskin", item: "rockyhelmet" }), hits: 2,
        use: { start: 183, low: 151, high: 145, average: 148.875, min: 145, max: 151, koChance: 0, heals: [] } },
      { game: SS, move: "tailslap", attacker: CINCCINO, target: chomp({ item: "sitrusberry", frac: 0.7 }), hits: 5,
        use: { start: 128, low: 93, high: 78, average: 87.6875, min: 78, max: 93, koChance: 0, heals: SITRUS } },
    ] as Verified[]) await verified(entry);
  });

  it("gives a single hit the berry after it, and a Dynamaxed target its doubled HP and line", async () => {
    for (const entry of [
      { game: SV, move: "nightslash", attacker: ["weavile", { ability: "pressure" }], target: chomp({ item: "sitrusberry", frac: 0.51 }), hits: 1,
        use: { start: 93, low: 89, high: 80, average: 84.875, min: 80, max: 89, koChance: 0, heals: SITRUS } },
      { game: SV, move: "nightslash", attacker: ["weavile", { ability: "pressure" }], target: chomp({ item: "sitrusberry", frac: 0.5 }), hits: 1,
        use: { start: 136, low: 87, high: 78, average: 82.875, min: 78, max: 87, koChance: 0, heals: [] } },
      // Dynamax HP (366 at most): 128 x 2, the line at 183, the heal a quarter of 183.
      { game: SS, move: "tailslap", attacker: CINCCINO, target: chomp({ item: "sitrusberry", frac: 0.7, dynamax: true }), hits: 5,
        use: { start: 256, low: 221, high: 206, average: 215.6875, min: 206, max: 221, koChance: 0, heals: SITRUS } },
      // 82 ate it before Dynamax: 127 x 2.
      { game: SS, move: "tailslap", attacker: CINCCINO, target: chomp({ item: "sitrusberry", frac: 0.45, dynamax: true }), hits: 5,
        use: { start: 254, low: 174, high: 159, average: 168.6875, min: 159, max: 174, koChance: 0, heals: [] } },
    ] as Verified[]) await verified(entry);
  });

  it("walks the target's hits in Doubles", async () => {
    for (const entry of [
      // A single-target move in Doubles: 10 hits into 109 HP, the berry between them.
      { game: SV, move: "populationbomb", attacker: MAUSHOLD, target: chomp({ item: "sitrusberry", frac: 0.6 }), field: { gameType: "Doubles" }, hits: 10,
        use: { start: 109, low: 4, high: 0, average: 0.0864220405001106, min: 0, max: 4, koChance: 0.935320912592033, heals: SITRUS } },
      // Dragon Darts at both foes: one dart each.
      { game: SV, move: "dragondarts", attacker: ["dragapult", { ability: "clearbody" }], target: chomp({ item: "sitrusberry", frac: 0.6 }), field: { gameType: "Doubles", multipleTargets: true }, hits: 1,
        use: { start: 109, low: 86, high: 70, average: 78.125, min: 70, max: 86, koChance: 0, heals: SITRUS } },
    ] as Verified[]) await verified(entry);
  });

  it("matches an independent walk of the row's own rolls at every HP above the berry's line", async () => {
    const sv = await game("scarlet_violet");
    const sitrus = { name: "Sitrus Berry", line: 91, heal: 45 };
    const attackers = [
      ["populationbomb", build(sv, "maushold", { ability: "technician" })],
      ["populationbomb", build(sv, "maushold", { ability: "technician", item: "loadeddice" })],
      ["bulletseed", build(sv, "breloom", { ability: "technician" })],
    ] as const;
    let checked = 0;
    for (const [moveId, attacker] of attackers) {
      for (let hp = 92; hp <= 183; hp += 7) {
        const result = row(matchup(sv, attacker, build(sv, "garchomp", { ability: "sandveil", item: "sitrusberry", hp })), moveId);
        expectUse(result.afterUse, walkUse(result, hp, { maxHP: 183, berry: sitrus }), `${moveId} ${attacker.itemId} ${hp}`);
        expectSeveral(result);
        checked++;
      }
    }
    expect(checked).toBe(42);
  });
});

describe("rows the one-use walk leaves alone", () => {
  it("leaves afterUse unset where a stat Berry eaten between hits would change the later hits", async () => {
    const sv = await game("scarlet_violet");
    const maushold = build(sv, "maushold", { ability: "technician" });
    const greninja = build(sv, "greninja", { ability: "torrent" });
    // Pinned Showdown eats Ganlon at a hit's Update (data/items.ts onUpdate), and the next hit reads the +1 Defense;
    // the row's per-hit rolls do not, so the outcome is not exact: no afterUse, and the row keeps its note.
    for (const [attacker, moveId, item] of [[maushold, "populationbomb", "ganlonberry"], [greninja, "watershuriken", "apicotberry"], [maushold, "populationbomb", "starfberry"]] as const) {
      const result = row(matchup(sv, attacker, build(sv, "garchomp", { ability: "sandveil", item, frac: 0.4 })), moveId);
      expect(result.afterUse, item).toBeUndefined();
      expect(result.ohkoChance, item).toBeNull();
      expect(result.assumptions, item).toContain(MULTI_HIT_NOTE);
    }
    // A stat the damage does not read (Liechi's Attack on a physical hit) changes nothing: the outcome stands.
    expect(row(matchup(sv, maushold, build(sv, "garchomp", { ability: "sandveil", item: "liechiberry", frac: 0.4 })), "populationbomb").afterUse).toBeDefined();
    // Cheek Pouch heals as a Lansat Berry is eaten, which the hits do not eat: unset, one hit or several.
    const pouch = matchup(sv, maushold, build(sv, "greedent", { ability: "cheekpouch", item: "lansatberry", frac: 0.4 }));
    expect(row(pouch, "populationbomb").afterUse).toBeUndefined();
    expect(row(pouch, "bite").afterUse).toBeUndefined();
  });

  it("leaves Focus Band to its rule, and an intact Disguise to the move's own question", async () => {
    const sv = await game("scarlet_violet");
    const band = row(matchup(sv, build(sv, "maushold", { ability: "technician" }), build(sv, "garchomp", { ability: "sandveil", item: "focusband" })), "populationbomb");
    expect(band.afterUse).toBeUndefined();
    expect(band.ohkoChance).toBeNull();
    expect(band.assumptions).toContain(MULTI_HIT_NOTE);
    const disguise = matchup(sv, build(sv, "breloom", { ability: "technician" }), build(sv, "mimikyu", { ability: "disguise" })).results.find((entry) => entry.moveId === "bulletseed")!;
    expect(disguise).toMatchObject({ kind: "needs-context", reason: "Intact Disguise takes the first hit." });
    expect(disguise.afterUse).toBeUndefined();
  });

  it("keeps a Starf Berry's outcome only when every stat it can raise deals the same", async () => {
    const sv = await game("scarlet_violet");
    // Garchomp at 45 HP eats its Starf Berry before the move: Seismic Toss deals 50 whatever it raised.
    const out = matchup(sv, build(sv, "smeargle", { ability: "technician" }), build(sv, "garchomp", { ability: "sandveil", item: "starfberry", frac: 0.25 }));
    expectUse(row(out, "seismictoss").afterUse, { start: 45, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: [] });
    for (const moveId of ["dragonclaw", "populationbomb", "bulletseed"]) expect(row(out, moveId).afterUse, moveId).toBeUndefined();
  });
});

describe("the first use's KO chance and the count's", () => {
  it("is the chance one use knocks out that Uses to KO counts, where the end of the turn changes nothing", async () => {
    // The count's first use (with its end of turn, which does nothing here) and the walk agree on every row with a
    // chance of one use fewer: Uses to KO's fasterChance for a count of 2.
    const sv = await game("scarlet_violet");
    let checked = 0;
    const attackers = [["maushold", "technician", ""], ["maushold", "technician", "loadeddice"], ["breloom", "technician", ""], ["cinccino", "skilllink", ""], ["garchomp", "roughskin", ""], ["dragapult", "infiltrator", ""]] as const;
    for (const [attackerId, ability, item] of attackers) {
      for (const [frac, berry] of [[0.35, ""], [0.5, ""], [0.65, ""], [0.8, ""], [1, ""], [0.6, "sitrusberry"], [0.8, "sitrusberry"], [1, "sitrusberry"]] as const) {
        const out = matchup(sv, build(sv, attackerId, { ability, item }), build(sv, "garchomp", { ability: "roughskin", item: berry, frac }));
        for (const result of out.results) {
          const uses = result.usesToKO;
          // A move that works once (Explosion, Fake Out...) is counted for its one use alone.
          const first = uses?.kind === "single-use" ? uses.koChance : uses?.kind === "uses" && uses.guaranteed === 2 ? uses.fasterChance : undefined;
          if (result.kind !== "calculated" || first === undefined || !result.afterUse) continue;
          expect(Math.abs(first - result.afterUse.koChance), `${attackerId} ${result.moveId} ${frac}`).toBeLessThan(1e-12);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe("single-hit rows", () => {
  it("give every single-hit row the one-use KO chance it already had", async () => {
    let checked = 0;
    for (const id of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon", "champions"] as const) {
      const runtime = await game(id);
      const targets = [
        build(runtime, "garchomp", { ability: "roughskin", item: "sitrusberry" }), build(runtime, "garchomp", { ability: "roughskin", item: "sitrusberry", frac: 0.6 }),
        build(runtime, "garchomp", { ability: "sandveil", frac: 0.3 }), build(runtime, "garchomp", { ability: "sandveil", item: "focussash" }),
        build(runtime, "dragonite", { ability: "multiscale" }), build(runtime, "incineroar", { item: "sitrusberry", frac: 0.5 }),
      ];
      const attackers = ["smeargle", "garchomp", "dragapult", "incineroar"].filter((species) => runtime.speciesById.has(species)).map((species) => build(runtime, species));
      for (const [attacker, target] of attackers.flatMap((attacker) => targets.map((target) => [attacker, target] as const))) {
        for (const result of matchup(runtime, attacker, target).results) {
          if (result.kind !== "calculated" || result.hits !== 1) continue;
          // Every single-hit row with damage has its outcome here (no Focus Band, no stat Berry between hits); a row
          // that fails before the engine runs (Aura Wheel from Smeargle) has none.
          if (!result.afterUse && result.max === 0) continue;
          expect(result.afterUse, `${id} ${result.moveId}`).toBeDefined();
          expect(result.ohkoChance, `${id} ${result.moveId}`).not.toBeNull();
          expect(Math.abs(result.afterUse!.koChance - result.ohkoChance!), `${id} ${result.moveId} ${target.speciesId}`).toBeLessThan(1e-12);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });
});

/** The HP a use without damage leaves: as it was, or with an absorbing ability's quarter (pinned Showdown onTryHit). */
const unchanged = (start: number, left = start, heals: string[] = []): AfterUse => ({
  start, low: left, high: left, average: left, min: left, max: left, koChance: 0, heals,
  paths: { low: { dealt: 0, heals }, high: { dealt: 0, heals } },
});

describe("rows without damage, and the roll paths", () => {
  it("leaves an immune target's HP as it was, whatever the hit count, and heals nothing a fixed-damage move cannot reach", async () => {
    const sv = await game(SV);
    const gengar = build(sv, "gengar", { ability: "cursedbody" });
    // Super Fang's fixed damage does not reach a Ghost type (Showdown 135 and 130 left, Mimikyu's Sitrus Berry kept).
    const fang = row(matchup(sv, build(sv, "pawmot", { ability: "naturalcure" }), gengar), "superfang");
    expect(fang).toMatchObject({ min: 0, max: 0, usesToKO: { kind: "no-damage" } });
    expectUse(fang.afterUse, unchanged(135));
    expectUse(row(matchup(sv, build(sv, "pawmot", { ability: "naturalcure" }), build(sv, "mimikyu", { ability: "disguise", item: "sitrusberry" })), "superfang").afterUse, unchanged(130));
    // A random hit count no count resolves, and a fixed one (Showdown 135 left).
    const tail = row(matchup(sv, build(sv, "cinccino", { ability: "technician" }), gengar), "tailslap");
    expect(tail.hits).toBeNull();
    expectUse(tail.afterUse, unchanged(135));
    expectUse(row(matchup(sv, build(sv, "maushold", { ability: "technician" }), gengar), "populationbomb").afterUse, unchanged(135));
  });

  it("heals the target by a quarter of its base maximum HP for Water Absorb, Volt Absorb, Dry Skin and Earth Eater, once a move", async () => {
    const sv = await game(SV);
    const primarina = build(sv, "primarina", { ability: "torrent" });
    // Showdown: Vaporeon 102 to 153 (+51 of 205), with Surf and with Surging Strikes' three hits; at full HP nothing.
    expectUse(row(matchup(sv, primarina, build(sv, "vaporeon", { ability: "waterabsorb", frac: 0.5 })), "surf").afterUse, unchanged(102, 153, ["Water Absorb: +51 HP."]));
    const strikes = row(matchup(sv, build(sv, "urshifurapidstrike", { ability: "unseenfist" }), build(sv, "vaporeon", { ability: "waterabsorb", frac: 0.5 })), "surgingstrikes");
    expect(strikes.hits).toBe(3);
    expectUse(strikes.afterUse, unchanged(102, 153, ["Water Absorb: +51 HP."]));
    expectUse(row(matchup(sv, primarina, build(sv, "vaporeon", { ability: "waterabsorb" })), "surf").afterUse, unchanged(205));
    // Jolteon 56 to 91, Orthworm 43 to 79, Toxicroak 79 to 118 (Showdown).
    expectUse(row(matchup(sv, build(sv, "pikachu", { ability: "static" }), build(sv, "jolteon", { ability: "voltabsorb", frac: 0.4 })), "thunderbolt").afterUse, unchanged(56, 91, ["Volt Absorb: +35 HP."]));
    expectUse(row(matchup(sv, build(sv, "garchomp", { ability: "roughskin" }), build(sv, "orthworm", { ability: "eartheater", frac: 0.3 })), "earthquake").afterUse, unchanged(43, 79, ["Earth Eater: +36 HP."]));
    expectUse(row(matchup(sv, primarina, build(sv, "toxicroak", { ability: "dryskin", frac: 0.5 })), "surf").afterUse, unchanged(79, 118, ["Dry Skin: +39 HP."]));
  });

  it("walks a stat Berry the target never reaches: the hits stop where the attacker faints", async () => {
    const sv = await game(SV);
    // Maushold at 29 HP faints to Rough Skin on the second hit: Garchomp's Ganlon Berry (its line 45) stays (Showdown 147–153).
    const bomb = row(matchup(sv, build(sv, "maushold", { ability: "technician", hp: 29 }), build(sv, "garchomp", { ability: "roughskin", item: "ganlonberry" })), "populationbomb");
    expect(bomb).toMatchObject({ hits: 2, attackerFaintsOnHit: { hit: 2 } });
    expectUse(bomb.afterUse, { start: 183, low: 153, high: 147, average: 151.625, min: 147, max: 153, koChance: 0, heals: [] });
    expectSeveral(bomb);
  });

  it("gives each roll path its own damage dealt and healing", async () => {
    const sv = await game(SV);
    // Avalanche 36–44 into Sitrus Garchomp at 130: the lowest roll leaves 94 (no berry), the highest 86, healed to 131 (Showdown).
    const avalanche = row(matchup(sv, build(sv, "smeargle", { ability: "owntempo" }), build(sv, "garchomp", { ability: "sandveil", item: "sitrusberry", hp: 130 })), "avalanche");
    expectUse(avalanche.afterUse, {
      start: 130, low: 94, high: 131, average: 119.375, min: 94, max: 135, koChance: 0, heals: SITRUS,
      paths: { low: { dealt: 36, heals: [] }, high: { dealt: 44, heals: SITRUS } },
    });
    // Population Bomb from full HP: the berry on both paths, each hit's damage added back (93 = 183 - 135 + 45).
    const bomb = row(matchup(sv, build(sv, ...MAUSHOLD), build(sv, ...chomp({ ability: "roughskin", item: "sitrusberry" }))), "populationbomb");
    expect(bomb.afterUse!.paths).toEqual({ low: { dealt: 135, heals: SITRUS }, high: { dealt: 162, heals: SITRUS } });
  });
});
