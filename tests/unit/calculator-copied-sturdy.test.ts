import { beforeAll, describe, expect, it } from "vitest";
import { previewRemainingHP, type DamageRollMode } from "@/app/(app)/calculator/hp-preview";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, StatTable } from "@/app/lib/battle/types";

/**
 * A Sturdy (or Focus Sash) the calculation settles on for the receiving Pokémon: copied by Trace (from
 * the other Pokémon, or chosen in Build settings) or by Imposter. The remaining-HP preview shows the HP the
 * row's exact first use (afterUse) leaves, and withholds on the survival effect where the row has none (an
 * alternate case, a Focus Band). Level 50, 31 IVs, Serious unless stated,
 * Singles. Every number is from a real pinned Showdown c23d2e94 battle with that roll (audit
 * oos/sturdy-copied/cases.ts, cases2.ts and cases3.ts): the hit leaves 1 HP where the preview used to show 0.
 */
const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of ["champions", "scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const) runtimes[game] = await loadBattleRuntime(game);
});
type Spec = { ability?: string; item?: string; nature?: string; evs?: Partial<StatTable<number>>; level?: number; hp?: number; traced?: string; dynamax?: boolean; tera?: string };
function build(game: BattleGame, id: string, spec: Spec = {}): BattleBuild {
  const base = createBuild(id, runtimes[game]);
  const own = {
    ...base,
    ...(spec.ability ? { abilityId: spec.ability, abilityActive: spec.ability === "imposter" } : {}),
    ...(spec.item !== undefined ? { itemId: spec.item } : {}),
    ...(spec.nature ? { nature: spec.nature } : {}),
    ...(spec.hp ? { currentHP: spec.hp } : {}),
    ...(spec.traced ? { tracedAbility: spec.traced } : {}),
    ...(spec.dynamax ? { mechanic: "dynamax" as const } : {}),
    ...(spec.tera ? { mechanic: "tera" as const, configuration: { ...base.configuration, teraType: spec.tera } } : {}),
  };
  return base.game === "champions" ? { ...own, points: { ...base.points, ...spec.evs } } as BattleBuild
    : { ...own, native: { ...base.native, level: spec.level ?? 50, evs: { ...base.native.evs, ...spec.evs } } } as BattleBuild;
}
function row(game: BattleGame, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}) {
  const result = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, {}, runtimes[game]);
  expect(result.issues).toEqual({ attacker: [], defender: [], field: [] });
  const found = result.results.find((entry) => entry.moveId === moveId);
  if (!found) throw new Error(`${moveId} is not calculated`);
  return found;
}
const modes: DamageRollMode[] = ["low", "average", "high"];
const specsMagnezone = (game: BattleGame = "scarlet_violet") => build(game, "magnezone", { ability: "sturdy", item: "choicespecs", nature: "Modest", evs: { spa: 252 } });
const bandAggron = (game: BattleGame) => build(game, "aggron", { ability: "sturdy", item: "choiceband", nature: "Adamant", evs: { atk: 252 } });
/** Every roll leaves `left` HP: 1 where the survival effect holds, 0 where it does not; the damage is the HP taken off. */
const leaves = (game: BattleGame, defender: BattleBuild, hit: ReturnType<typeof row>, left: number) => {
  for (const mode of modes) {
    const preview = previewRemainingHP(defender, hit, mode, runtimes[game]);
    expect(preview).toMatchObject({ status: "ready", min: left, max: left, remaining: left });
    if (preview.status === "ready") expect(preview.damage).toBe(preview.current - left);
  }
};
const withheld = (game: BattleGame, defender: BattleBuild, hit: ReturnType<typeof row>, effect = "Sturdy") => {
  for (const mode of modes) expect(previewRemainingHP(defender, hit, mode, runtimes[game])).toEqual({ status: "unavailable", reason: `Remaining HP is withheld for ${effect}.` });
};

describe("remaining-HP preview with a Sturdy the calculation settled on", () => {
  it("previews 1 HP for a Sturdy that Trace copied from the attacker (Showdown leaves 1 HP)", () => {
    const gardevoir = build("scarlet_violet", "gardevoir", { ability: "trace" });
    const hit = row("scarlet_violet", "flashcannon", specsMagnezone(), gardevoir);
    expect(hit).toMatchObject({ min: 204, max: 240, ohkoChance: 0, survival: "Sturdy" });
    expect(hit.assumptions).toContain("Trace: the target Gardevoir copied Sturdy from Magnezone.");
    leaves("scarlet_violet", gardevoir, hit, 1); // Showdown: 143/143 -> 1/143 on the lowest and highest roll
    const porygon2 = build("scarlet_violet", "porygon2", { ability: "trace", level: 5 });
    const low = row("scarlet_violet", "flashcannon", { ...specsMagnezone(), itemId: "" }, porygon2);
    expect(low).toMatchObject({ min: 562, max: 663, ohkoChance: 0, survival: "Sturdy" });
    leaves("scarlet_violet", porygon2, low, 1); // Showdown: 25/25 -> 1/25
  });

  it("previews 1 HP for a Sturdy chosen as Trace's copy in Build settings", () => {
    // Showdown (Doubles, the foe's partner Magnezone traced): 143/143 -> 1/143.
    const gardevoir = build("scarlet_violet", "gardevoir", { ability: "trace", traced: "sturdy" });
    const treads = build("scarlet_violet", "irontreads", { ability: "quarkdrive", item: "choiceband", nature: "Adamant", evs: { atk: 252 } });
    const hit = row("scarlet_violet", "ironhead", treads, gardevoir, { gameType: "Doubles" });
    expect(hit).toMatchObject({ min: 288, max: 338, ohkoChance: 0, survival: "Sturdy" });
    leaves("scarlet_violet", gardevoir, hit, 1);
  });

  it.each(["sword_shield", "ultra_sun_ultra_moon"] as const)("previews 1 HP for a Sturdy that Imposter copied (%s)", (game) => {
    const ditto = build(game, "ditto", { ability: "imposter" });
    const hit = row(game, "earthquake", bandAggron(game), ditto);
    expect(hit).toMatchObject({ min: 204, max: 240, ohkoChance: 0, survival: "Sturdy" });
    leaves(game, ditto, hit, 1); // Showdown: 123/123 -> 1/123
  });

  it("previews 1 HP in Champions for Trace and Imposter", () => {
    const gardevoir = build("champions", "gardevoir", { ability: "trace" });
    const smash = row("champions", "headsmash", build("champions", "aggron", { ability: "sturdy", item: "metalcoat", nature: "Adamant", evs: { atk: 32 } }), gardevoir);
    expect(smash).toMatchObject({ min: 178, max: 210, ohkoChance: 0, survival: "Sturdy" });
    leaves("champions", gardevoir, smash, 1); // Showdown: 143/143 -> 1/143
    const ditto = build("champions", "ditto", { ability: "imposter" });
    const quake = row("champions", "earthquake", build("champions", "aggron", { ability: "sturdy", item: "softsand", nature: "Adamant", evs: { atk: 32 } }), ditto);
    expect(quake).toMatchObject({ min: 160, max: 192, ohkoChance: 0, survival: "Sturdy" });
    leaves("champions", ditto, quake, 1); // Showdown: 123/123 -> 1/123
  });

  it("previews 1 HP for fixed damage, Dynamax HP and a spread hit, and withholds for Fickle Beam's doubled case", () => {
    const porygon2 = (game: BattleGame, spec: Spec = {}) => build(game, "porygon2", { ability: "trace", level: 5, ...spec });
    const toss = row("sword_shield", "seismictoss", build("sword_shield", "aggron", { ability: "sturdy" }), porygon2("sword_shield"));
    expect(toss).toMatchObject({ min: 50, max: 50, survival: "Sturdy" });
    leaves("sword_shield", porygon2("sword_shield"), toss, 1); // Showdown: 25/25 -> 1/25
    const boom = row("ultra_sun_ultra_moon", "sonicboom", build("ultra_sun_ultra_moon", "magnezone", { ability: "sturdy" }), porygon2("ultra_sun_ultra_moon", { level: 3 }));
    expect(boom).toMatchObject({ min: 20, max: 20, survival: "Sturdy" });
    leaves("ultra_sun_ultra_moon", porygon2("ultra_sun_ultra_moon", { level: 3 }), boom, 1); // Showdown: 19/19 -> 1/19
    const gambit = row("sword_shield", "finalgambit", build("sword_shield", "shuckle", { ability: "sturdy" }), porygon2("sword_shield"));
    expect(gambit).toMatchObject({ min: 95, max: 95, survival: "Sturdy" });
    leaves("sword_shield", porygon2("sword_shield"), gambit, 1); // Showdown: 25/25 -> 1/25
    const giant = porygon2("sword_shield", { dynamax: true });
    const max = row("sword_shield", "flashcannon", specsMagnezone("sword_shield"), giant);
    expect(max).toMatchObject({ min: 843, max: 993, ohkoChance: 0, survival: "Sturdy" });
    leaves("sword_shield", giant, max, 1); // Showdown: 50/50 Dynamax HP -> 1/50
    const spread = row("scarlet_violet", "discharge", specsMagnezone(), porygon2("scarlet_violet"), { gameType: "Doubles" });
    expect(spread).toMatchObject({ min: 631, max: 744, survival: "Sturdy" });
    leaves("scarlet_violet", porygon2("scarlet_violet"), spread, 1); // Showdown: 25/25 -> 1/25
    // Only the doubled Fickle Beam reaches its 121 HP: Showdown leaves 3 (plain) or 1 (doubled).
    const target = build("scarlet_violet", "porygon2", { ability: "trace", level: 37, traced: "sturdy" });
    const beam = row("scarlet_violet", "ficklebeam", build("scarlet_violet", "hydrapple", { ability: "regenerator", nature: "Modest", evs: { spa: 252 } }), target);
    expect(beam).toMatchObject({ min: 100, max: 118, alternate: { min: 198, max: 234 }, ohkoChance: 0, survival: "Sturdy" });
    withheld("scarlet_violet", target, beam);
  });

  it("still previews a copied Sturdy's hit that cannot knock it out", () => {
    const gardevoir = build("scarlet_violet", "gardevoir", { ability: "trace" });
    const bolt = row("scarlet_violet", "thunderbolt", specsMagnezone(), gardevoir);
    expect(bolt).toMatchObject({ min: 114, max: 135, ohkoChance: 0 });
    expect(bolt.survival).toBeUndefined();
    expect(previewRemainingHP(gardevoir, bolt, "high", runtimes.scarlet_violet)).toMatchObject({ status: "ready", remaining: 8 }); // Showdown 8/143
    const swshGardevoir = build("sword_shield", "gardevoir", { ability: "trace" });
    const fang = row("sword_shield", "superfang", build("sword_shield", "togedemaru", { ability: "sturdy" }), swshGardevoir);
    expect(fang).toMatchObject({ min: 71, max: 71 });
    expect(fang.survival).toBeUndefined();
    expect(previewRemainingHP(swshGardevoir, fang, "average", runtimes.sword_shield)).toMatchObject({ status: "ready", remaining: 72 }); // Showdown 72/143
    const toss = row("sword_shield", "seismictoss", build("sword_shield", "aggron", { ability: "sturdy" }), swshGardevoir);
    expect(toss.survival).toBeUndefined();
    expect(previewRemainingHP(swshGardevoir, toss, "average", runtimes.sword_shield)).toMatchObject({ status: "ready", remaining: 93 }); // Showdown 93/143
  });

  it("previews the KO when the copy fails or the copied Sturdy is below full HP", () => {
    const shielded = build("scarlet_violet", "gardevoir", { ability: "trace", item: "abilityshield" });
    const blocked = row("scarlet_violet", "flashcannon", specsMagnezone(), shielded);
    expect(blocked).toMatchObject({ min: 204, max: 240, ohkoChance: 1 });
    expect(blocked.survival).toBeUndefined();
    expect(previewRemainingHP(shielded, blocked, "low", runtimes.scarlet_violet)).toMatchObject({ status: "ready", remaining: 0 }); // Showdown faints
    const hurt = build("scarlet_violet", "gardevoir", { ability: "trace", hp: 142 });
    const partial = row("scarlet_violet", "flashcannon", specsMagnezone(), hurt);
    expect(partial).toMatchObject({ ohkoChance: 1 });
    expect(partial.survival).toBeUndefined();
    expect(previewRemainingHP(hurt, partial, "low", runtimes.scarlet_violet)).toMatchObject({ status: "ready", remaining: 0 }); // Showdown faints
    const hurtDitto = build("sword_shield", "ditto", { ability: "imposter", hp: 122 });
    const imposter = row("sword_shield", "earthquake", bandAggron("sword_shield"), hurtDitto);
    expect(imposter).toMatchObject({ min: 204, max: 240, ohkoChance: 1 });
    expect(previewRemainingHP(hurtDitto, imposter, "low", runtimes.sword_shield)).toMatchObject({ status: "ready", remaining: 0 }); // Showdown faints
    // Mold Breaker ignores a Sturdy chosen as Trace's copy (Showdown faints: 25/25 -> 0).
    const chosen = build("scarlet_violet", "porygon2", { ability: "trace", level: 5, traced: "sturdy" });
    const broken = row("scarlet_violet", "earthquake", build("scarlet_violet", "excadrill", { ability: "moldbreaker", item: "choiceband", nature: "Adamant", evs: { atk: 252 } }), chosen);
    expect(broken).toMatchObject({ min: 1149, max: 1353, ohkoChance: 1 });
    expect(broken.survival).toBeUndefined();
    expect(previewRemainingHP(chosen, broken, "low", runtimes.scarlet_violet)).toMatchObject({ status: "ready", remaining: 0 });
    const gassed = build("scarlet_violet", "gardevoir", { ability: "trace" });
    const weezing = build("scarlet_violet", "weezing", { ability: "neutralizinggas", item: "choicespecs", nature: "Modest", evs: { spa: 252 } });
    expect(previewRemainingHP(gassed, row("scarlet_violet", "fireblast", weezing, gassed), "high", runtimes.scarlet_violet)).toMatchObject({ status: "ready", remaining: 61 }); // Showdown 61/143
  });

  it("sets survival from the settled, effective target, and previews the knockouts the shown selections cannot stop", () => {
    // Showdown faints each of these; the row has no survival, and its exact first use knocks the target out.
    const aggron = build("sword_shield", "aggron", { ability: "sturdy" });
    const breaker = row("sword_shield", "earthquake", build("sword_shield", "excadrill", { ability: "moldbreaker", item: "choiceband", nature: "Adamant", evs: { atk: 252 } }), aggron);
    expect(breaker).toMatchObject({ min: 348, max: 412, ohkoChance: 1 });
    expect(breaker.survival).toBeUndefined();
    leaves("sword_shield", aggron, breaker, 0);
    const sash = build("scarlet_violet", "gardevoir", { ability: "trace", item: "focussash" });
    const klutz = row("scarlet_violet", "heavyslam", build("scarlet_violet", "golurk", { ability: "klutz", nature: "Adamant", evs: { atk: 252 } }), sash);
    expect(klutz).toMatchObject({ min: 204, max: 242, ohkoChance: 1 });
    expect(klutz.survival).toBeUndefined();
    leaves("scarlet_violet", sash, klutz, 0);
    // A Sturdy kept by Ability Shield through Mold Breaker, a Tera'd Ogerpon-Cornerstone and a Sash with a copied Sturdy.
    const magnezone = build("scarlet_violet", "magnezone", { ability: "sturdy", item: "abilityshield" });
    const kept = row("scarlet_violet", "earthquake", build("scarlet_violet", "excadrill", { ability: "moldbreaker", item: "choiceband", nature: "Adamant", evs: { atk: 252 } }), magnezone);
    expect(kept).toMatchObject({ min: 516, max: 612, ohkoChance: 0, survival: "Sturdy" }); // Showdown 1/145
    const garchomp = build("scarlet_violet", "garchomp", { item: "choiceband", nature: "Adamant", evs: { atk: 252 } });
    const tera = build("scarlet_violet", "ogerponcornerstone", { ability: "sturdy", item: "cornerstonemask", tera: "Rock" });
    const embody = row("scarlet_violet", "earthquake", garchomp, tera);
    expect(embody).toMatchObject({ min: 218, max: 258, ohkoChance: 1 });
    expect(embody.survival).toBeUndefined();
    expect(previewRemainingHP(tera, embody, "high", runtimes.scarlet_violet)).toMatchObject({ status: "ready", remaining: 0 }); // Showdown faints
    const both = build("scarlet_violet", "gardevoir", { ability: "trace", item: "focussash" });
    // Sturdy acts first and the Sash is kept (Showdown: -ability Sturdy, 1/143, no -enditem).
    const first = row("scarlet_violet", "flashcannon", specsMagnezone(), both);
    expect(first).toMatchObject({ ohkoChance: 0, survival: "Sturdy" });
    leaves("scarlet_violet", both, first, 1);
  });
  it("previews 1 HP for a Sturdy copied by a Terastallized Trace user and by Imposter into Ogerpon-Cornerstone, and withholds over a Focus Band", () => {
    // Showdown: 143/143 -> 1/143 (Tera Fairy Gardevoir traced Sturdy).
    const tera = build("scarlet_violet", "gardevoir", { ability: "trace", tera: "Fairy" });
    const cannon = row("scarlet_violet", "flashcannon", specsMagnezone(), tera);
    expect(cannon).toMatchObject({ min: 204, max: 240, ohkoChance: 0, survival: "Sturdy" });
    leaves("scarlet_violet", tera, cannon, 1);
    // Showdown: Ditto becomes Ogerpon-Cornerstone with Sturdy, 123/123 -> 1/123.
    const ditto = build("scarlet_violet", "ditto", { ability: "imposter" });
    const cudgel = row("scarlet_violet", "ivycudgel", build("scarlet_violet", "ogerponcornerstone", { ability: "sturdy", item: "cornerstonemask", nature: "Adamant", evs: { atk: 252 } }), ditto);
    expect(cudgel).toMatchObject({ min: 123, max: 145, ohkoChance: 0, survival: "Sturdy" });
    leaves("scarlet_violet", ditto, cudgel, 1);
    // Sturdy acts before Focus Band (Showdown: -ability Sturdy, 1/143); the Band leaves the KO chance unestimated.
    const band = build("scarlet_violet", "gardevoir", { ability: "trace", item: "focusband" });
    const banded = row("scarlet_violet", "flashcannon", specsMagnezone(), band);
    expect(banded).toMatchObject({ min: 204, max: 240, ohkoChance: null, survival: "Sturdy" });
    withheld("scarlet_violet", band, banded);
  });

  it("leaves Sturdy out of the row when the move ignores abilities, and previews the knockout", () => {
    // Showdown: Sunsteel Strike ignores Sturdy, Sudowoodo faints (145/145 -> 0).
    const sudowoodo = build("scarlet_violet", "sudowoodo", { ability: "sturdy" });
    const strike = row("scarlet_violet", "sunsteelstrike", build("scarlet_violet", "solgaleo", { ability: "fullmetalbody", item: "choiceband", nature: "Adamant", evs: { atk: 252 } }), sudowoodo);
    expect(strike).toMatchObject({ min: 260, max: 308, ohkoChance: 1 });
    expect(strike.survival).toBeUndefined();
    leaves("scarlet_violet", sudowoodo, strike, 0);
  });
});
