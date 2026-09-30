import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";

/**
 * Reference rolls from pinned Showdown c23d2e94's real move pipeline (useMove with
 * ModifyMove/BasePower/TryHit; field-core ref.ts), level 50, 0 Stat Points/EVs, 31 IVs,
 * Serious nature, no crit unless stated. "One target" is Doubles with the spread flag off,
 * which Showdown sets only when more than one target is hit.
 */
type Field = Partial<Omit<BattleConditions, "attackerSide" | "defenderSide">> & { lightScreen?: boolean; helpingHand?: boolean };

function field(options: Field): BattleConditions {
  const { lightScreen, helpingHand, ...rest } = options;
  const base = createConditions();
  return {
    ...base, ...rest,
    attackerSide: { ...base.attackerSide, helpingHand: !!helpingHand },
    defenderSide: { ...base.defenderSide, lightScreen: !!lightScreen },
  };
}

function build(id: string, abilityId: string, runtime: BattleRuntime = championsRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, ...extra } as BattleBuild;
}

function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, conditions: BattleConditions, runtime: BattleRuntime = championsRuntime) {
  const out = calculateMatchup(attacker, defender, conditions, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

const oneTarget = { gameType: "Doubles", multipleTargets: false } as const;
const bothTargets = { gameType: "Doubles", multipleTargets: true } as const;

describe("one-target Expanding Force", () => {
  const alakazam = build("alakazam", "synchronize");
  const chimecho = build("chimecho", "levitate");
  const snorlax = build("snorlax", "thickfat");

  it.each<[string, BattleBuild, Field, number, number]>([
    ["grounded, Psychic Terrain, one target", alakazam, { ...oneTarget, terrain: "Psychic" }, 105, 124],
    ["grounded, Psychic Terrain, both targets", alakazam, { ...bothTargets, terrain: "Psychic" }, 78, 93],
    ["grounded, Psychic Terrain, Singles", alakazam, { gameType: "Singles", terrain: "Psychic" }, 105, 124],
    ["no terrain, one target", alakazam, { ...oneTarget }, 54, 64],
    ["one target keeps the Doubles Light Screen", alakazam, { ...oneTarget, terrain: "Psychic", lightScreen: true }, 70, 83],
    ["Singles Light Screen for comparison", alakazam, { gameType: "Singles", terrain: "Psychic", lightScreen: true }, 52, 62],
    ["one target with Helping Hand", alakazam, { ...oneTarget, terrain: "Psychic", helpingHand: true }, 157, 186],
    ["Levitate user, one target", chimecho, { ...oneTarget, terrain: "Psychic" }, 42, 49],
    ["Levitate user, both targets: not retargeted, so no spread", chimecho, { ...bothTargets, terrain: "Psychic" }, 42, 49],
    ["Levitate user grounded by Gravity", chimecho, { ...oneTarget, terrain: "Psychic", gravity: true }, 78, 93],
    ["Air Balloon user", { ...alakazam, itemId: "airballoon" }, { ...oneTarget, terrain: "Psychic" }, 54, 64],
  ])("%s", (_label, attacker, options, min, max) => {
    expect(row("expandingforce", attacker, snorlax, field(options))).toMatchObject({ kind: "calculated", min, max });
  });

  it("explains the one-target case only when the engine retargets the move", () => {
    const line = "One target: no spread reduction, with Expanding Force's 1.5x power from Psychic Terrain. This fits only when the target's partner is absent or has fainted; a partner on the field still triggers Showdown's spread reduction even when it protects, is immune or is semi-invulnerable, so keep “Multiple targets hit” on then.";
    const result = row("expandingforce", alakazam, snorlax, field({ ...oneTarget, terrain: "Psychic" }));
    expect(result.effectivePower).toBe(120);
    expect(result.assumptions).toContain(line);
    expect(row("expandingforce", alakazam, snorlax, field({ ...bothTargets, terrain: "Psychic" })).assumptions).not.toContain(line);
    // An ungrounded user is never retargeted, so the toggle changes nothing for it.
    expect(row("expandingforce", chimecho, snorlax, field({ ...oneTarget, terrain: "Psychic" })).assumptions).not.toContain(line);
    expect(row("expandingforce", alakazam, snorlax, field({ ...oneTarget })).assumptions).not.toContain(line);
  });

  it("matches Showdown in Scarlet/Violet and Sword/Shield", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const indeedee = build("indeedee", "psychicsurge", sv);
    const svSnorlax = build("snorlax", "thickfat", sv);
    expect(row("expandingforce", indeedee, svSnorlax, field({ ...oneTarget, terrain: "Psychic" }), sv)).toMatchObject({ kind: "calculated", min: 85, max: 102 });
    expect(row("expandingforce", indeedee, svSnorlax, field({ ...bothTargets, terrain: "Psychic" }), sv)).toMatchObject({ kind: "calculated", min: 64, max: 76 });
    const swsh = await loadBattleRuntime("sword_shield");
    expect(row("expandingforce", build("hatterene", "magicbounce", swsh), build("snorlax", "thickfat", swsh), field({ ...oneTarget, terrain: "Psychic" }), swsh))
      .toMatchObject({ kind: "calculated", min: 106, max: 126 });
  });

  it("does not leak the single-target move into other moves or later calculations", () => {
    const conditions = field({ ...oneTarget, terrain: "Psychic" });
    const first = row("expandingforce", alakazam, snorlax, conditions);
    expect(row("expandingforce", alakazam, snorlax, field({ ...bothTargets, terrain: "Psychic" }))).toMatchObject({ min: 78, max: 93 });
    expect(row("expandingforce", alakazam, snorlax, conditions)).toMatchObject({ min: first.min, max: first.max });
  });
});

describe("Body Press under Wonder Room", () => {
  const snorlax = build("snorlax", "thickfat");
  const avalugg = (def: number, spd: number) => build("avalugg", "owntempo", championsRuntime, { boosts: { ...createBuild("avalugg").boosts, def, spd } });

  it.each<[string, number, number, Field, number, number]>([
    ["no stages", 0, 0, { gameType: "Singles", wonderRoom: true }, 96, 114],
    ["Sp. Def stages are used, Defense stages are not", 2, -1, { gameType: "Singles", wonderRoom: true }, 64, 76],
    ["a +3 Sp. Def stage raises it", -2, 3, { gameType: "Singles", wonderRoom: true }, 238, 280],
    ["a crit ignores the negative Sp. Def stage", 2, -1, { gameType: "Singles", wonderRoom: true, critical: true }, 144, 170],
    ["without Wonder Room, Defense stages as usual", 2, -1, { gameType: "Singles" }, 288, 340],
    ["without Wonder Room, no stages", 0, 0, { gameType: "Singles" }, 146, 172],
  ])("%s", (_label, def, spd, options, min, max) => {
    expect(row("bodypress", avalugg(def, spd), snorlax, field(options))).toMatchObject({ kind: "calculated", min, max });
  });

  it("states the rule it uses", () => {
    const result = row("bodypress", avalugg(2, -1), snorlax, field({ gameType: "Singles", wonderRoom: true }));
    expect(result.assumptions).toContain("Under Wonder Room, Body Press uses the attacker's original Defense with its Sp. Def stages, a game quirk that pinned Showdown also calculates.");
  });

  it("withholds only the Unaware case where Showdown and the engine disagree", () => {
    const clefable = build("clefable", "unaware");
    const wonderRoom = field({ gameType: "Singles", wonderRoom: true });
    // Showdown keeps the Sp. Def stage through Unaware; the engine drops it.
    const withStage = row("bodypress", avalugg(2, -1), clefable, wonderRoom);
    expect(withStage).toMatchObject({ kind: "unsupported", min: null });
    expect(withStage.reason).toContain("It is calculated when the attacker has no Sp. Def stage.");
    expect(row("bodypress", avalugg(-2, 3), clefable, wonderRoom).kind).toBe("unsupported");
    // Where they agree: no Sp. Def stage (Showdown 28-33), a crit ignoring a negative stage,
    // no Wonder Room (Unaware ignores the Defense stage: Showdown 33-39), or no Unaware.
    expect(row("bodypress", avalugg(2, 0), clefable, wonderRoom)).toMatchObject({ kind: "calculated", min: 28, max: 33 });
    expect(row("bodypress", avalugg(2, -1), clefable, field({ gameType: "Singles", wonderRoom: true, critical: true })).kind).toBe("calculated");
    expect(row("bodypress", avalugg(2, -1), clefable, field({ gameType: "Singles" }))).toMatchObject({ kind: "calculated", min: 33, max: 39 });
    expect(row("bodypress", avalugg(2, -1), build("clefable", "magicguard"), wonderRoom).kind).toBe("calculated");
  });

  it("follows the effective Unaware, the stage after a terrain Seed, and immunity", () => {
    const clefable = build("clefable", "unaware");
    const wonderRoom = field({ gameType: "Singles", wonderRoom: true });
    // Mold Breaker suppresses Unaware in both, so the Sp. Def stage counts (Showdown 39-46).
    const hawlucha = build("hawlucha", "moldbreaker", championsRuntime, { boosts: { ...createBuild("hawlucha").boosts, spd: 2 } });
    expect(row("bodypress", hawlucha, clefable, wonderRoom)).toMatchObject({ kind: "calculated", min: 39, max: 46 });
    // A Psychic Seed adds a Sp. Def stage on Psychic Terrain: from 0 it makes +1 (Showdown 42-49,
    // withheld); from -1 it makes 0, where both agree (Showdown 28-33).
    const seeded = (spd: number) => build("avalugg", "owntempo", championsRuntime, { itemId: "psychicseed", boosts: { ...createBuild("avalugg").boosts, spd } });
    const psychic = field({ gameType: "Singles", wonderRoom: true, terrain: "Psychic" });
    expect(row("bodypress", seeded(0), clefable, psychic).kind).toBe("unsupported");
    expect(row("bodypress", seeded(-1), clefable, psychic)).toMatchObject({ kind: "calculated", min: 28, max: 33 });
    // Ghost-type Skeledirge is immune to Body Press whatever the stage.
    expect(row("bodypress", avalugg(0, 2), build("skeledirge", "unaware"), wonderRoom)).toMatchObject({ kind: "calculated", min: 0, max: 0 });
  });

  it("matches Showdown in Scarlet/Violet and Sword/Shield", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const archaludon = build("archaludon", "stamina", sv, { boosts: { ...createBuild("archaludon", sv).boosts, def: 2, spd: -1 } });
    expect(row("bodypress", archaludon, build("snorlax", "thickfat", sv), field({ gameType: "Singles", wonderRoom: true }), sv)).toMatchObject({ kind: "calculated", min: 48, max: 58 });
    const swsh = await loadBattleRuntime("sword_shield");
    const corviknight = build("corviknight", "pressure", swsh, { boosts: { ...createBuild("corviknight", swsh).boosts, def: -2, spd: 3 } });
    expect(row("bodypress", corviknight, build("snorlax", "thickfat", swsh), field({ gameType: "Singles", wonderRoom: true }), swsh)).toMatchObject({ kind: "calculated", min: 146, max: 172 });
  });
});
