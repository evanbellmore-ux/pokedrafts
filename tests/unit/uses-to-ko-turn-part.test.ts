import { beforeAll, describe, expect, it } from "vitest";
import { calculateTurnMove, usesHelpers } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, MoveContext } from "@/app/lib/battle/types";
import {
  createTurnSearch, itemOwner, itemTakeable, prepareUses, type CalcTrace, type Mode, type TurnStepEntry, type TurnStepOutcome, type TurnStepPart, type UsesSearch,
} from "@/app/lib/battle/uses-to-ko";

/**
 * The doubles turn's step after hits into a Substitute (status-eot ADDENDUM §3.3′, uses-to-ko.ts TurnStepPart), Step 0's
 * gates (ADDENDUM §3.5): a part with skip 0, mixed over the cases by chance, is the step without a part; with every hit
 * into the Substitute, Life Orb alone of the after-hits losses acts (K7), the user's own effects act and the target's do
 * not (U3, U7, U8); with a continuation, Focus Sash at full HP saves on the first hit after the break (U4d) and Rocky
 * Helmet answers only the continuation's hits (K8). itemTakeable is takeable's rule without a matchup.
 * Level 50, 31 IVs, Serious nature, 0 EVs unless set (Scarlet/Violet).
 */
type P = { id: string; ability?: string; item?: string; nature?: string; evs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>; status?: BattleStatus };
let sv: BattleRuntime;
beforeAll(async () => { sv = await loadBattleRuntime("scarlet_violet"); });

function buildOf(runtime: BattleRuntime, p: P): BattleBuild {
  const base = createBuild(p.id, runtime);
  const abilityId = p.ability ?? base.abilityId;
  const zero = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const trained = base.game === "champions" ? { points: { ...zero, ...p.evs } } : { native: { ...base.native!, evs: { ...zero, ...p.evs } } };
  return {
    ...base, ...trained, nature: p.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: p.item ?? "",
    currentHP: null, status: p.status ?? "",
  } as BattleBuild;
}

const FIELD: BattleConditions = { ...createConditions(), gameType: "Doubles" };

/** One pair's turn search as doubles-turn.ts searchFor makes it. */
function searchOf(runtime: BattleRuntime, attacker: P, target: P, moveId: string, context?: MoveContext): { search: UsesSearch; follow: boolean } {
  const move = runtime.movesById.get(moveId)!;
  const xb = buildOf(runtime, attacker), tb = buildOf(runtime, target);
  const trace: CalcTrace = {};
  const row = calculateTurnMove(move, xb, tb, FIELD, context, runtime, trace);
  expect(row.kind, `${moveId}: ${row.reason ?? ""}`).toBe("calculated");
  const m = prepareUses(xb, tb, FIELD, runtime, usesHelpers(runtime), { turn: true });
  const search = createTurnSearch(m, {
    move, row, trace, context,
    rerun: (next) => {
      const nextTrace: CalcTrace = {};
      return { row: calculateTurnMove(move, next.attacker, next.defender, next.conditions, next.context, runtime, nextTrace), trace: nextTrace };
    },
  });
  return { search, follow: search.needsAttackerHP() };
}

function step(search: UsesSearch, follow: boolean, entries: TurnStepEntry[], mode: Mode, part?: TurnStepPart) {
  const result = search.turnStep(entries, mode, follow, part);
  if ("failed" in result) throw new Error(result.failed);
  return result;
}

/** The step's outcomes as one canonical joint distribution: the attacker's and the target's states (target HP apart), the hits, and the target's HP. */
function joint(outcomes: TurnStepOutcome[], follow: boolean, weight = 1, into = new Map<string, number>()): Map<string, number> {
  for (const outcome of outcomes) {
    const attacker = JSON.stringify({ ...outcome.attacker, hp: follow ? outcome.attacker.hp : 0 });
    const target = JSON.stringify({ ...outcome.target, hp: 0 });
    for (const [hp, mass] of outcome.dist) {
      const key = JSON.stringify([attacker, follow && outcome.attackerFainted, target, outcome.knocked, outcome.landed, outcome.knocked ? 0 : hp, outcome.conditions]);
      into.set(key, (into.get(key) ?? 0) + mass * weight);
    }
  }
  return into;
}
function expectSame(a: Map<string, number>, b: Map<string, number>, label: string) {
  const drop = (map: Map<string, number>) => new Map([...map].filter(([, mass]) => mass > 1e-15));
  const x = drop(a), y = drop(b);
  expect([...x.keys()].sort(), label).toEqual([...y.keys()].sort());
  for (const [key, mass] of x) expect(Math.abs(mass - y.get(key)!), `${label} ${key}`).toBeLessThanOrEqual(1e-9);
}
const rowMass = (rows: Map<unknown, number>) => [...rows.values()].reduce((sum, mass) => sum + mass, 0);

// Twenty rows: single hits, recoil, drain, Life Orb, Shell Bell, fixed damage, fixed and random hit counts, a Berry
// between hits, Multiscale, Rocky Helmet, Rough Skin and Focus Sash on the target.
const ROWS: { label: string; attacker: P; target: P; move: string; hp?: number; context?: MoveContext }[] = [
  { label: "Earthquake", attacker: { id: "garchomp", evs: { atk: 252 } }, target: { id: "blastoise" }, move: "earthquake" },
  { label: "Brave Bird recoil", attacker: { id: "talonflame", evs: { atk: 252 } }, target: { id: "snorlax" }, move: "bravebird" },
  { label: "Drain Punch", attacker: { id: "breloom", evs: { atk: 252 } }, target: { id: "snorlax" }, move: "drainpunch" },
  { label: "Close Combat with Life Orb", attacker: { id: "breloom", item: "lifeorb" }, target: { id: "snorlax" }, move: "closecombat" },
  { label: "Brave Bird with Shell Bell", attacker: { id: "talonflame", item: "shellbell" }, target: { id: "snorlax" }, move: "bravebird" },
  { label: "Super Fang", attacker: { id: "cinccino" }, target: { id: "snorlax" }, move: "superfang", hp: 200 },
  { label: "Bullet Seed 2-5", attacker: { id: "breloom", evs: { atk: 252 } }, target: { id: "blastoise" }, move: "bulletseed" },
  { label: "Icicle Spear with Skill Link", attacker: { id: "cloyster", ability: "skilllink" }, target: { id: "garchomp" }, move: "iciclespear" },
  { label: "Triple Axel", attacker: { id: "weavile", evs: { atk: 252 } }, target: { id: "garchomp" }, move: "tripleaxel" },
  { label: "Dual Wingbeat into Rocky Helmet", attacker: { id: "dragonite", evs: { atk: 252 } }, target: { id: "garchomp", item: "rockyhelmet" }, move: "dualwingbeat" },
  { label: "Rock Blast into Rough Skin", attacker: { id: "cloyster" }, target: { id: "garchomp", ability: "roughskin" }, move: "rockblast" },
  { label: "Bullet Seed with Shell Bell", attacker: { id: "breloom", item: "shellbell" }, target: { id: "snorlax" }, move: "bulletseed" },
  { label: "Surging Strikes", attacker: { id: "urshifurapidstrike", evs: { atk: 252 } }, target: { id: "snorlax" }, move: "surgingstrikes" },
  { label: "Bullet Seed into a Sitrus Berry", attacker: { id: "breloom", evs: { atk: 252 } }, target: { id: "snorlax", item: "sitrusberry" }, move: "bulletseed" },
  { label: "Icicle Spear into Multiscale", attacker: { id: "cloyster", evs: { atk: 252 } }, target: { id: "dragonite", ability: "multiscale" }, move: "iciclespear" },
  { label: "Water Shuriken", attacker: { id: "greninja", evs: { spa: 252 } }, target: { id: "garchomp" }, move: "watershuriken" },
  { label: "Scale Shot", attacker: { id: "garchomp", evs: { atk: 252 } }, target: { id: "dragonite" }, move: "scaleshot" },
  { label: "Flame Charge", attacker: { id: "talonflame" }, target: { id: "breloom" }, move: "flamecharge" },
  { label: "Bullet Seed into Focus Sash", attacker: { id: "breloom", evs: { atk: 252 }, item: "lifeorb" }, target: { id: "pikachu", item: "focussash" }, move: "bulletseed" },
  { label: "Population Bomb with Loaded Dice", attacker: { id: "maushold", evs: { atk: 252 }, item: "loadeddice" }, target: { id: "garchomp" }, move: "populationbomb" },
];

describe("a part with skip 0, mixed over the cases by chance, is the step without one", () => {
  for (const row of ROWS) {
    it(row.label, () => {
      const { search, follow } = searchOf(sv, row.attacker, row.target, row.move, row.context);
      const t = search.initial.def.maxHP, x = search.initial.att.maxHP;
      const low = row.hp ?? Math.max(1, Math.floor(t * 0.6));
      const entries: TurnStepEntry[] = follow
        ? [{ attackerHP: x, target: new Map([[t, 0.3], [low, 0.2]]) }, { attackerHP: Math.max(1, x - 31), target: new Map([[t, 0.5]]) }]
        : [{ attackerHP: 0, target: new Map([[t, 0.6], [low, 0.4]]) }];
      for (const mode of ["all", "lowest", "highest"] as const) {
        const whole = step(search, follow, entries, mode);
        const cases = search.turnCases(follow ? x : search.initial.att.hp, t, mode);
        if ("failed" in cases) throw new Error(cases.failed);
        expect(cases.reduce((sum, each) => sum + each.chance, 0), `${row.label} ${mode} chances`).toBeCloseTo(1, 12);
        const mixed = new Map<string, number>();
        let rows = 0;
        cases.forEach((each, caseIndex) => {
          const part = step(search, follow, entries, mode, { caseIndex, skip: 0 });
          for (const outcome of part.outcomes) expect(outcome.subHits).toBe(0);
          joint(part.outcomes, follow, each.chance, mixed);
          rows += rowMass(part.rows) * each.chance;
        });
        expectSame(joint(whole.outcomes, follow), mixed, `${row.label} ${mode}`);
        expect(Math.abs(rows - rowMass(whole.rows)), `${row.label} ${mode} rows`).toBeLessThanOrEqual(1e-9);
      }
    });
  }
});

describe("hits into a Substitute alone (skip = the case's hits)", () => {
  /** The step with every hit of case 0 into the Substitute, from the attacker's HP `x` (after the prefix) into a target at full HP. */
  function subOnly(attacker: P, target: P, moveId: string, x?: number) {
    const { search, follow } = searchOf(sv, attacker, target, moveId);
    const cases = search.turnCases(search.initial.att.hp, search.initial.def.maxHP, "all");
    if ("failed" in cases) throw new Error(cases.failed);
    const hp = x ?? search.initial.att.hp;
    const result = step(search, follow, [{ attackerHP: hp, target: new Map([[search.initial.def.maxHP, 1]]) }], "all", { caseIndex: 0, skip: cases[0].hits.length });
    return { search, follow, result, hp };
  }

  it("Life Orb costs a tenth; no recoil, no Shell Bell heal, no second Steel Beam cost (K7)", () => {
    const orb = subOnly({ id: "talonflame", item: "lifeorb" }, { id: "snorlax" }, "bravebird", 120);
    expect(orb.follow).toBe(true);
    expect(orb.result.outcomes).toHaveLength(1);
    const [outcome] = orb.result.outcomes;
    expect(outcome.subHits).toBe(1);
    expect(outcome.landed).toBe(0);
    expect(outcome.attacker.hp).toBe(120 - Math.floor(orb.search.initial.att.baseMaxHP / 10));
    expect([...outcome.dist]).toEqual([[orb.search.initial.def.maxHP, 1]]);
    expect(orb.result.rows.size).toBe(0);

    const bell = subOnly({ id: "talonflame", item: "shellbell" }, { id: "snorlax" }, "bravebird", 120);
    expect(bell.result.outcomes.map((each) => each.attacker.hp)).toEqual([120]);
    expect(bell.result.attackerHeals.size).toBe(0);

    const beam = subOnly({ id: "metagross", evs: { atk: 252 } }, { id: "snorlax" }, "steelbeam", 100);
    expect(beam.result.outcomes.map((each) => each.attacker.hp)).toEqual([100]);
  });

  it("the user's own effects act: its stage changes and once per hit its secondary self boost (U8)", () => {
    const cc = subOnly({ id: "breloom" }, { id: "snorlax" }, "closecombat");
    expect(cc.result.outcomes.map((each) => [each.attacker.boosts.def, each.attacker.boosts.spd])).toEqual([[-1, -1]]);
    const charge = subOnly({ id: "talonflame" }, { id: "breloom" }, "flamecharge");
    expect(charge.result.outcomes.map((each) => each.attacker.boosts.spe)).toEqual([1]);
  });

  it("the target's Air Balloon pops; nothing else of the target acts (U7)", () => {
    const balloon = subOnly({ id: "garchomp" }, { id: "heatran", item: "airballoon" }, "dragonclaw");
    expect(balloon.result.outcomes.map((each) => each.target.itemId)).toEqual([""]);
    const helmet = subOnly({ id: "garchomp" }, { id: "snorlax", item: "rockyhelmet" }, "dragonclaw", 150);
    expect(helmet.result.outcomes.map((each) => [each.attacker.hp, each.target.itemId])).toEqual([[150, "rockyhelmet"]]);
    const knock = subOnly({ id: "weavile" }, { id: "snorlax", item: "leftovers" }, "knockoff");
    expect(knock.result.outcomes.map((each) => each.target.itemId)).toEqual(["leftovers"]);
    const nuzzle = subOnly({ id: "pikachu" }, { id: "snorlax" }, "nuzzle");
    expect(nuzzle.result.outcomes.map((each) => each.target.status)).toEqual([""]);
    const rough = subOnly({ id: "breloom" }, { id: "garchomp", ability: "roughskin" }, "machpunch", 100);
    expect(rough.result.outcomes.map((each) => each.attacker.hp)).toEqual([100]);
  });
});

describe("a continuation after the Substitute breaks", () => {
  it("Focus Sash at full HP saves on the first hit after the break (U4d)", () => {
    const { search, follow } = searchOf(sv, { id: "dragonite", evs: { atk: 252 } }, { id: "breloom", item: "focussash" }, "dualwingbeat");
    const t = search.initial.def.maxHP;
    const result = step(search, follow, [{ attackerHP: search.initial.att.hp, target: new Map([[t, 1]]) }], "all", { caseIndex: 0, skip: 1 });
    for (const outcome of result.outcomes) expect(outcome.subHits).toBe(1);
    expect(result.outcomes.every((each) => !each.knocked && each.landed === 1)).toBe(true);
    expect(result.outcomes.flatMap((each) => [...each.dist.keys()])).toEqual([1]);
    expect(result.outcomes.map((each) => each.target.itemId)).toEqual([""]);
    expect(result.rows.size).toBeGreaterThan(0);
  });

  it("Rocky Helmet answers only the continuation's hits (K8)", () => {
    const { search, follow } = searchOf(sv, { id: "dragonite" }, { id: "snorlax", item: "rockyhelmet" }, "dualwingbeat");
    expect(follow).toBe(true);
    const x = search.initial.att.hp, t = search.initial.def.maxHP;
    const helmet = Math.floor(search.initial.att.baseMaxHP / 6);
    const after = (skip: number) => step(search, follow, [{ attackerHP: x, target: new Map([[t, 1]]) }], "all", { caseIndex: 0, skip }).outcomes.map((each) => each.attacker.hp);
    expect([...new Set(after(1))]).toEqual([x - helmet]);
    expect([...new Set(after(0))]).toEqual([x - 2 * helmet]);
  });
});

describe("itemTakeable", () => {
  /** takeable before Step 0 moved it out of the matchup (uses-to-ko.ts), as the reference. */
  function before(runtime: BattleRuntime, paradox: (id: string) => boolean, itemId: string, holder: string, taker: string, thief: boolean): boolean {
    const item = runtime.itemsById.get(itemId);
    if (!item) return true;
    if (item.zMoveType || item.zMove || itemId.endsWith("iumz")) return false;
    const family = (id: string) => runtime.speciesById.get(id)?.baseSpecies ?? id;
    const keyed = new Set(["floettite", "magearnite", "meowsticite", "tatsugirinite"]);
    const owns = (species: string) => {
      if (item.megaTargets.length) {
        return item.megaTargets.some((target) => keyed.has(itemId) ? target.baseSpeciesId === species || target.formId === species : family(target.baseSpeciesId) === family(species));
      }
      if (itemId === "boosterenergy") return paradox(species);
      return itemOwner(itemId, runtime.profile.id)?.[0] === family(species);
    };
    return !owns(holder) && !((thief || itemOwner(itemId, runtime.profile.id)?.[1]) && owns(taker));
  }

  for (const game of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon", "champions"] as BattleGame[]) {
    it(`agrees with takeable on every catalog item, holder and taker that can own one (${game})`, async () => {
      const runtime = await loadBattleRuntime(game);
      const { paradox } = usesHelpers(runtime);
      // Every species an item can belong to (Mega Stones' targets, the owned items' families, the Paradox Pokémon), with their forms, and two that own none.
      const owners = new Set<string>(["pikachu", "snorlax"].filter((id) => runtime.speciesById.has(id)));
      const families = new Set<string>();
      for (const item of runtime.itemsById.values()) {
        for (const target of item.megaTargets) { owners.add(target.baseSpeciesId); if (target.formId) owners.add(target.formId); families.add(runtime.speciesById.get(target.baseSpeciesId)?.baseSpecies ?? target.baseSpeciesId); }
        const owner = itemOwner(item.id, runtime.profile.id);
        if (owner) families.add(owner[0]);
      }
      for (const species of runtime.speciesById.values()) {
        if (families.has(species.baseSpecies ?? species.id) || paradox(species.id)) owners.add(species.id);
      }
      let checked = 0;
      for (const item of runtime.itemsById.keys()) {
        for (const holder of owners) {
          for (const taker of ["pikachu", holder]) {
            for (const thief of [false, true]) {
              expect(itemTakeable(runtime, paradox, item, holder, taker, thief), `${item} ${holder} ${taker} ${thief}`).toBe(before(runtime, paradox, item, holder, taker, thief));
              expect(itemTakeable(runtime, paradox, item, taker, holder, thief), `${item} ${taker} ${holder} ${thief}`).toBe(before(runtime, paradox, item, taker, holder, thief));
              checked++;
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(1000);
    });
  }
});
