import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { previewRemainingHP, type DamageRollMode } from "@/app/(app)/calculator/hp-preview";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import { createMatchup, getAttackView, selectMatchupMove, updateMatchupBuild } from "@/app/(app)/calculator/roster-prep";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext, MoveDamageResult, StatTable } from "@/app/lib/battle/types";

/**
 * False Swipe and Hold Back never knock the target out: pinned Showdown c23d2e94's onDamage (priority -20)
 * returns target.hp - 1 before Sturdy (-30), Focus Sash or Focus Band (-40) act. Their Z-Move and Max Move
 * lose the effect. Level 50, 31 IVs, Serious unless stated, Singles. Every number is from a real pinned
 * Showdown battle per roll (audit gaps/false-swipe/repro.ts, extra.ts, extra2.ts).
 */
const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const) runtimes[game] = await loadBattleRuntime(game);
  runtimes.champions = championsRuntime;
});
type Spec = { ability?: string; item?: string; nature?: string; evs?: Partial<StatTable<number>>; level?: number; hp?: number; mechanic?: BattleBuild["mechanic"]; tera?: string };
function build(game: BattleGame, id: string, spec: Spec = {}): BattleBuild {
  const base = createBuild(id, runtimes[game]);
  if (base.game === "champions") throw new Error("native games only");
  return {
    ...base,
    ...(spec.ability ? { abilityId: spec.ability } : {}),
    ...(spec.item !== undefined ? { itemId: spec.item } : {}),
    ...(spec.nature ? { nature: spec.nature } : {}),
    ...(spec.hp ? { currentHP: spec.hp } : {}),
    ...(spec.mechanic ? { mechanic: spec.mechanic, configuration: { ...base.configuration, ...(spec.tera ? { teraType: spec.tera } : {}), ...(spec.mechanic === "gigantamax" ? { gigantamax: true } : {}) } } : {}),
    native: { ...base.native, level: spec.level ?? 50, evs: { ...base.native.evs, ...spec.evs } },
  } as BattleBuild;
}
function row(game: BattleGame, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, context?: MoveContext) {
  const result = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, context ? { [moveId]: context } : {}, runtimes[game]);
  expect(result.issues).toEqual({ attacker: [], defender: [], field: [] });
  const found = result.results.find((entry) => entry.moveId === moveId);
  if (!found) throw new Error(`${moveId} is not calculated`);
  return found;
}
const modes: DamageRollMode[] = ["low", "average", "high"];
const NOTE = (name: string) => `${name} cannot knock the target out: damage that would reach its HP leaves it 1 HP instead, before Sturdy, Focus Sash or Focus Band could act.`;
/** Every roll leaves exactly 1 HP; the damage shown stays the raw roll. */
function leavesOne(game: BattleGame, defender: BattleBuild, hit: MoveDamageResult, maximum: number, damage: [number, number, number]) {
  for (const [index, mode] of modes.entries()) {
    expect(previewRemainingHP(defender, hit, mode, runtimes[game])).toMatchObject({ status: "ready", maximum, min: 1, max: 1, damage: damage[index], remaining: 1 });
  }
}
const scizor = (game: BattleGame, spec: Spec = {}) => build(game, "scizor", { ability: "technician", nature: "Adamant", evs: { atk: 252 }, ...spec });

describe("False Swipe and Hold Back leave the target 1 HP", () => {
  it.each(["ultra_sun_ultra_moon", "sword_shield", "scarlet_violet"] as const)("never KO a damaged target (%s)", (game) => {
    // Showdown: Pikachu 20/110 -> 1/110 on all 16 rolls (raw 76-90).
    const pikachu = build(game, "pikachu", { hp: 20 });
    const hit = row(game, "falseswipe", scizor(game), pikachu);
    expect(hit).toMatchObject({ kind: "calculated", min: 76, max: 90, ohkoChance: 0, leavesOneHP: true, hits: 1 });
    expect(hit.survival).toBeUndefined();
    expect((hit.rolls as number[])[0]).toBe(76); // raw rolls stay before the HP cap
    expect(hit.assumptions).toContain(NOTE("False Swipe"));
    leavesOne(game, pikachu, hit, 110, [76, 83, 90]);
  });

  it("covers Hold Back in Ultra Sun/Ultra Moon and Sword/Shield", () => {
    const usum = row("ultra_sun_ultra_moon", "holdback", build("ultra_sun_ultra_moon", "metagross", { nature: "Adamant", evs: { atk: 252 } }), build("ultra_sun_ultra_moon", "pikachu", { hp: 20 }));
    expect(usum).toMatchObject({ min: 52, max: 62, ohkoChance: 0, leavesOneHP: true }); // Showdown 1/110
    expect(usum.assumptions).toContain(NOTE("Hold Back"));
    const pikachu = build("sword_shield", "pikachu", { hp: 20 });
    const swsh = row("sword_shield", "holdback", build("sword_shield", "snorlax", { nature: "Adamant", evs: { atk: 252 } }), pikachu);
    expect(swsh).toMatchObject({ min: 67, max: 81, ohkoChance: 0, leavesOneHP: true }); // Showdown 1/110
    leavesOne("sword_shield", pikachu, swsh, 110, [67, 74, 81]);
  });

  it("keeps the effect through Pixilate, Scrappy, Tera and a Dynamaxed target", () => {
    const usumPikachu = build("ultra_sun_ultra_moon", "pikachu", { hp: 20 });
    const fairy = row("ultra_sun_ultra_moon", "falseswipe", build("ultra_sun_ultra_moon", "altariamega", { ability: "pixilate", item: "altarianite", nature: "Adamant", evs: { atk: 252 } }), usumPikachu);
    expect(fairy).toMatchObject({ effectiveType: "Fairy", min: 81, max: 96, ohkoChance: 0, leavesOneHP: true }); // Showdown 1/110
    const gengar = build("sword_shield", "gengar", { hp: 20 });
    const scrappy = row("sword_shield", "falseswipe", build("sword_shield", "pangoro", { ability: "scrappy", nature: "Adamant", evs: { atk: 252 } }), gengar);
    expect(scrappy).toMatchObject({ min: 37, max: 44, ohkoChance: 0, leavesOneHP: true }); // Showdown 1/135
    leavesOne("sword_shield", gengar, scrappy, 135, [37, 40, 44]);
    const tera = row("scarlet_violet", "falseswipe", scizor("scarlet_violet", { mechanic: "tera", tera: "Normal" }), build("scarlet_violet", "pikachu", { hp: 20 }));
    expect(tera).toMatchObject({ min: 114, max: 135, ohkoChance: 0, leavesOneHP: true }); // Showdown 1/110 (Tera 60-power floor)
    // Showdown: a level 5 Snorlax at 30 base HP Dynamaxes to 60/64 and False Swipe leaves 1/64.
    const giant = build("sword_shield", "snorlax", { level: 5, hp: 30, mechanic: "dynamax" });
    const max = row("sword_shield", "falseswipe", scizor("sword_shield", { evs: { atk: 252, spe: 252 } }), giant);
    expect(max).toMatchObject({ min: 346, max: 408, ohkoChance: 0, leavesOneHP: true });
    leavesOne("sword_shield", giant, max, 64, [346, 377, 408]);
  });

  it("previews instead of withholding for Sturdy, Focus Sash and Focus Band, which never activate", () => {
    // Showdown: Pineco 21/21 -> 1/21 with no Sturdy message (raw 300-354).
    const pineco = build("ultra_sun_ultra_moon", "pineco", { ability: "sturdy", level: 5 });
    const sturdy = row("ultra_sun_ultra_moon", "falseswipe", scizor("ultra_sun_ultra_moon"), pineco);
    expect(sturdy).toMatchObject({ min: 300, max: 354, ohkoChance: 0, leavesOneHP: true });
    expect(sturdy.survival).toBeUndefined();
    expect(sturdy.assumptions).not.toContain("Damage is uncapped; full-HP Focus Sash/Sturdy prevents a single-hit KO unless bypassed.");
    leavesOne("ultra_sun_ultra_moon", pineco, sturdy, 21, [300, 327, 354]);
    // Showdown: Pikachu 20/20 -> 1/20 and the Focus Sash is still held.
    const sash = build("sword_shield", "pikachu", { item: "focussash", level: 5 });
    const sashed = row("sword_shield", "falseswipe", scizor("sword_shield"), sash);
    expect(sashed).toMatchObject({ min: 450, max: 530, ohkoChance: 0, leavesOneHP: true });
    expect(sashed.survival).toBeUndefined();
    leavesOne("sword_shield", sash, sashed, 20, [450, 490, 530]);
    // Showdown: 20/110 -> 1/110 with a Focus Band; the KO chance is no longer unestimated.
    const band = build("ultra_sun_ultra_moon", "pikachu", { item: "focusband", hp: 20 });
    const banded = row("ultra_sun_ultra_moon", "falseswipe", scizor("ultra_sun_ultra_moon"), band);
    expect(banded).toMatchObject({ ohkoChance: 0, leavesOneHP: true });
    expect(banded.survival).toBeUndefined();
    expect(banded.assumptions).not.toContain("Focus Band survival chance is not modeled; KO probability is unavailable.");
    leavesOne("ultra_sun_ultra_moon", band, banded, 110, [76, 83, 90]);
    // Showdown: Ogerpon-Cornerstone 24/24 -> 1/24 (raw 117-138).
    const ogerpon = build("scarlet_violet", "ogerponcornerstone", { ability: "sturdy", item: "cornerstonemask", level: 5 });
    const cornerstone = row("scarlet_violet", "falseswipe", build("scarlet_violet", "haxorus", { ability: "unnerve", nature: "Adamant", evs: { atk: 252 } }), ogerpon);
    expect(cornerstone).toMatchObject({ min: 117, max: 138, ohkoChance: 0, leavesOneHP: true });
    leavesOne("scarlet_violet", ogerpon, cornerstone, 24, [117, 127, 138]);
  });

  it("gives Mold Breaker nothing to break: the target still keeps 1 HP", () => {
    // Showdown: Pineco 21/21 -> 1/21 (raw 218-257); a Focus Sash Pikachu 20/20 -> 1/20, Sash kept (raw 327-385).
    const pineco = build("ultra_sun_ultra_moon", "pineco", { ability: "sturdy", level: 5 });
    const haxorus = (game: BattleGame) => build(game, "haxorus", { ability: "moldbreaker", nature: "Adamant", evs: { atk: 252 } });
    const broken = row("ultra_sun_ultra_moon", "falseswipe", haxorus("ultra_sun_ultra_moon"), pineco);
    expect(broken).toMatchObject({ min: 218, max: 257, ohkoChance: 0, leavesOneHP: true });
    expect(broken.description).not.toContain("Mold Breaker");
    expect(broken.assumptions).not.toContain("Mold Breaker ignores the target's Sturdy.");
    leavesOne("ultra_sun_ultra_moon", pineco, broken, 21, [218, 237, 257]);
    const sash = build("scarlet_violet", "pikachu", { item: "focussash", level: 5 });
    const sashed = row("scarlet_violet", "falseswipe", haxorus("scarlet_violet"), sash);
    expect(sashed).toMatchObject({ min: 327, max: 385, ohkoChance: 0, leavesOneHP: true });
    leavesOne("scarlet_violet", sash, sashed, 20, [327, 356, 385]);
  });

  it("keeps a target at 1 HP there, and leaves hits that cannot reach the HP and immune targets alone", () => {
    const one = build("ultra_sun_ultra_moon", "pikachu", { hp: 1 });
    const hit = row("ultra_sun_ultra_moon", "falseswipe", scizor("ultra_sun_ultra_moon"), one);
    expect(hit).toMatchObject({ min: 76, max: 90, ohkoChance: 0 }); // Showdown: 0 damage, 1/110
    leavesOne("ultra_sun_ultra_moon", one, hit, 110, [76, 83, 90]);
    const blissey = build("ultra_sun_ultra_moon", "blissey");
    const weak = row("ultra_sun_ultra_moon", "falseswipe", scizor("ultra_sun_ultra_moon"), blissey);
    expect(weak).toMatchObject({ min: 151, max: 178, ohkoChance: 0, leavesOneHP: true });
    expect(previewRemainingHP(blissey, weak, "low", runtimes.ultra_sun_ultra_moon)).toMatchObject({ status: "ready", remaining: 179, min: 152, max: 179 }); // Showdown 179/330
    expect(previewRemainingHP(blissey, weak, "high", runtimes.ultra_sun_ultra_moon)).toMatchObject({ status: "ready", remaining: 152 }); // Showdown 152/330
    const gengar = build("ultra_sun_ultra_moon", "gengar", { hp: 20 });
    const immune = row("ultra_sun_ultra_moon", "falseswipe", scizor("ultra_sun_ultra_moon"), gengar);
    expect(immune).toMatchObject({ min: 0, max: 0, ohkoChance: 0 });
    expect(previewRemainingHP(gengar, immune, "high", runtimes.ultra_sun_ultra_moon)).toMatchObject({ status: "ready", remaining: 20 }); // Showdown 20/135
  });

  it("lets the Z-Move and Max Move knock out: they lose the effect", () => {
    // Showdown: Breakneck Blitz (100 power) 125-148 faints Pikachu 20/110 on every roll.
    const usumPikachu = build("ultra_sun_ultra_moon", "pikachu", { hp: 20 });
    const z = row("ultra_sun_ultra_moon", "falseswipe", scizor("ultra_sun_ultra_moon", { item: "normaliumz" }), usumPikachu, {}, { useZ: true });
    expect(z).toMatchObject({ effectiveName: "Breakneck Blitz", min: 125, max: 148, ohkoChance: 1 });
    expect(z.leavesOneHP).toBeUndefined();
    expect(z.assumptions).toContain("Breakneck Blitz does not keep False Swipe's effect of leaving the target 1 HP, so it can knock the target out.");
    expect(previewRemainingHP(usumPikachu, z, "low", runtimes.ultra_sun_ultra_moon)).toMatchObject({ status: "ready", remaining: 0 });
    // Showdown: Max Strike 113-134 and G-Max Replenish (Hold Back) 151-178 faint Pikachu 20/110.
    const swshPikachu = build("sword_shield", "pikachu", { hp: 20 });
    const max = row("sword_shield", "falseswipe", scizor("sword_shield", { mechanic: "dynamax" }), swshPikachu);
    expect(max).toMatchObject({ effectiveName: "Max Strike", min: 113, max: 134, ohkoChance: 1 });
    expect(max.leavesOneHP).toBeUndefined();
    expect(previewRemainingHP(swshPikachu, max, "low", runtimes.sword_shield)).toMatchObject({ status: "ready", remaining: 0 });
    const gmax = row("sword_shield", "holdback", build("sword_shield", "snorlax", { nature: "Adamant", evs: { atk: 252 }, mechanic: "gigantamax" }), swshPikachu);
    expect(gmax).toMatchObject({ effectiveName: "G-Max Replenish", min: 151, max: 178, ohkoChance: 1 });
    expect(gmax.assumptions).toContain("G-Max Replenish does not keep Hold Back's effect of leaving the target 1 HP, so it can knock the target out.");
  });

  it("is the same in Doubles, and Champions has neither move", () => {
    const pikachu = build("scarlet_violet", "pikachu", { hp: 20 });
    expect(row("scarlet_violet", "falseswipe", scizor("scarlet_violet"), pikachu, { gameType: "Doubles" })).toMatchObject({ min: 76, max: 90, ohkoChance: 0, leavesOneHP: true });
    expect(championsRuntime.movesById.has("falseswipe")).toBe(false);
    expect(championsRuntime.movesById.has("holdback")).toBe(false);
  });

  it("shows 0% and 1 HP remaining in the summary", () => {
    const usum = runtimes.ultra_sun_ultra_moon;
    const pikachu = build("ultra_sun_ultra_moon", "pikachu", { hp: 20 });
    let matchup = createMatchup(0, usum);
    matchup = updateMatchupBuild(matchup, "attacker", scizor("ultra_sun_ultra_moon"));
    matchup = updateMatchupBuild(matchup, "defender", pikachu);
    matchup = selectMatchupMove(matchup, "falseswipe");
    const view = getAttackView(matchup);
    const hit = row("ultra_sun_ultra_moon", "falseswipe", scizor("ultra_sun_ultra_moon"), pikachu);
    const html = renderToStaticMarkup(createElement(MatchupSummary, {
      attacker: matchup.attacker, defender: matchup.defender, attack: matchup.attack, replacement: matchup.replacement,
      resultIdentity: { source: view.owner, receiver: view.receiverOwner }, selectedRow: hit, rollMode: "high",
      issues: { attacker: [], defender: [] }, movesControl: "moves", onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onShowMove: vi.fn(),
      onRollModeChange: vi.fn(), onActivateMove: vi.fn(), onToggleMega: vi.fn(), runtime: usum,
    })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(html).toContain("76–90 damage range · One-use KO: 0% (all rolls)");
    expect(html).toContain("Right Pokémon HP remaining: 1 / 110");
  });
});
