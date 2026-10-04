import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import MoveResults from "@/app/(app)/calculator/MoveResults";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import { createMatchup, getAttackView, selectMatchupMove, updateMatchupBuild } from "@/app/(app)/calculator/roster-prep";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { beatUpPartyOptions } from "@/app/lib/battle/count-moves";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, validateBuild } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * Reference rolls from pinned Showdown c23d2e94's real useMove pipeline (fix13 ref.ts) with
 * side.totalFainted (Supreme Overlord after its Start event, Last Respects), the user's
 * timesAttacked (Rage Fist) and real benched party members (Beat Up). Level 50, 0 Stat
 * Points/EVs, 31 IVs, Serious nature, Singles, no crit.
 */
function build(id: string, abilityId: string, runtime: BattleRuntime = championsRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, ...extra } as BattleBuild;
}

function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, context?: MoveContext, runtime: BattleRuntime = championsRuntime, field: Partial<BattleConditions> = {}) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, context ? { [moveId]: context } : {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

const garchomp = build("garchomp", "sandveil");
const snorlax = build("snorlax", "thickfat");

describe("Supreme Overlord", () => {
  it.each([[0, 66, 78], [1, 72, 85], [2, 78, 93], [3, 84, 100], [4, 91, 108], [5, 97, 115]])("%s fainted allies: Kowtow Cleave %s-%s", (fallen, min, max) => {
    const kingambit = build("kingambit", "supremeoverlord", championsRuntime, { faintedAllies: fallen });
    const result = row("kowtowcleave", kingambit, garchomp);
    expect(result).toMatchObject({ kind: "calculated", min, max });
    expect(result.assumptions.some((line) => line.startsWith(`Supreme Overlord: ${fallen} all`))).toBe(true);
  });

  it("defaults to the start of a battle and rejects impossible counts", async () => {
    expect(row("kowtowcleave", build("kingambit", "supremeoverlord"), garchomp)).toMatchObject({ min: 66, max: 78 });
    expect(validateBuild(build("kingambit", "supremeoverlord", championsRuntime, { faintedAllies: 6 }))).toEqual([expect.objectContaining({ field: "faintedAllies" })]);
    const sv = await loadBattleRuntime("scarlet_violet");
    expect(row("kowtowcleave", build("kingambit", "supremeoverlord", sv, { faintedAllies: 2 }), build("garchomp", "sandveil", sv), undefined, sv)).toMatchObject({ min: 78, max: 93 });
  });

  // Real Doubles turns with Incineroar's Helping Hand, into Garchomp (Rough Skin).
  it("is withheld with two or more other power boosts, which Showdown orders differently", () => {
    const doubles = (helpingHand: boolean): Partial<BattleConditions> => {
      const base = createConditions();
      return { gameType: "Doubles", attackerSide: { ...base.attackerSide, helpingHand } };
    };
    const roughskin = build("garchomp", "roughskin");
    const kingambit = (itemId: string, faintedAllies: number, extra: Partial<BattleBuild> = {}) => build("kingambit", "supremeoverlord", championsRuntime, { itemId, faintedAllies, ...extra });
    const withheld = row("kowtowcleave", kingambit("blackglasses", 5), roughskin, undefined, championsRuntime, doubles(true));
    expect(withheld).toMatchObject({ kind: "unsupported", reason: expect.stringContaining("Supreme Overlord with 2 other power boosts") });
    expect(row("kowtowcleave", kingambit("blackglasses", 5), roughskin, undefined, championsRuntime, doubles(false))).toMatchObject({ kind: "calculated", min: 117, max: 138 });
    expect(row("kowtowcleave", kingambit("", 5), roughskin, undefined, championsRuntime, doubles(true))).toMatchObject({ kind: "calculated", min: 145, max: 172 });
    expect(row("kowtowcleave", kingambit("blackglasses", 0), roughskin, undefined, championsRuntime, doubles(true))).toMatchObject({ kind: "calculated", min: 117, max: 138 });
    expect(row("facade", kingambit("silkscarf", 5, { status: "psn" }), roughskin, undefined, championsRuntime, doubles(false)).kind).toBe("unsupported");
    expect(row("facade", kingambit("blackglasses", 5, { status: "psn" }), roughskin, undefined, championsRuntime, doubles(false))).toMatchObject({ kind: "calculated", min: 107, max: 126 });
  });
});

describe("Last Respects and Rage Fist", () => {
  const houndstone = build("houndstone", "sandrush");
  const annihilape = build("annihilape", "defiant");

  it.each([[0, 31, 37], [1, 60, 72], [2, 90, 106], [3, 118, 141], [4, 148, 175], [5, 178, 210]])("Last Respects with %s fainted: %s-%s", (fainted, min, max) => {
    const result = row("lastrespects", houndstone, garchomp, { fainted });
    expect(result).toMatchObject({ kind: "calculated", min, max });
    expect(result.assumptions).toContain(`Last Respects: ${fainted} fainted, ${50 + 50 * fainted} power.`);
  });

  it.each([[0, 33, 40], [1, 67, 79], [2, 100, 118], [3, 133, 157], [4, 166, 196], [5, 198, 234], [6, 231, 273]])("Rage Fist hit %s times: %s-%s", (timesHit, min, max) => {
    expect(row("ragefist", annihilape, garchomp, { timesHit })).toMatchObject({ kind: "calculated", min, max });
  });

  it("explains each game's Rage Fist count and rejects impossible counts", async () => {
    expect(row("ragefist", annihilape, garchomp).assumptions).toContain("Rage Fist: hit 0 times since switching in, 50 power.");
    const sv = await loadBattleRuntime("scarlet_violet");
    const svRow = row("ragefist", build("annihilape", "defiant", sv), build("garchomp", "sandveil", sv), { timesHit: 3 }, sv);
    expect(svRow).toMatchObject({ min: 133, max: 157 });
    expect(svRow.assumptions).toContain("Rage Fist: hit 3 times, 200 power.");
    expect(row("lastrespects", houndstone, garchomp, { fainted: 6 })).toMatchObject({ kind: "needs-context" });
    expect(row("ragefist", annihilape, garchomp, { timesHit: 7 })).toMatchObject({ kind: "needs-context" });
  });
});

describe("Beat Up", () => {
  const maushold = build("mausholdfour", "technician");
  const strikes = (result: MoveDamageResult) => (result.rolls as number[][]).map((hit) => `${hit[0]}-${hit[15]}`);

  it("hits once per chosen party member at that member's power", () => {
    const result = row("beatup", maushold, snorlax, { party: ["garchomp", "incineroar", "kingambit"] });
    // Four strikes at most 53 never reach Snorlax's HP: the one use's exact KO chance (afterUse) is 0.
    expect(result).toMatchObject({ kind: "calculated", min: 43, max: 53, hits: 4, ohkoChance: 0 });
    expect(strikes(result)).toEqual(["8-10", "12-15", "11-13", "12-15"]);
    expect(result.assumptions).toContain("Beat Up: 4 hits (Maushold-Four 12, Garchomp 18, Incineroar 16, Kingambit 18 power).");
    expect(row("beatup", maushold, snorlax, { party: [] })).toMatchObject({ kind: "calculated", min: 8, max: 10, hits: 1 });
  });

  it("needs its party chosen", () => {
    expect(row("beatup", maushold, snorlax)).toMatchObject({ kind: "needs-context", reason: "Beat Up: party needed." });
    expect(row("beatup", maushold, snorlax, { party: ["garchomp", ""] })).toMatchObject({ kind: "needs-context", reason: "Beat Up: a party member has no Pokémon." });
  });

  it("uses a Mega's base form and never adds a Parental Bond strike", () => {
    const kangaskhan = build("kangaskhanmega", "parentalbond", championsRuntime, { itemId: "kangaskhanite" });
    const result = row("beatup", kangaskhan, snorlax, { party: ["garchomp", "incineroar"] });
    expect(result).toMatchObject({ kind: "calculated", min: 33, max: 41, hits: 3 });
    expect(result.assumptions.some((line) => line.includes("Kangaskhan 14"))).toBe(true);
    expect(result.assumptions).toContain("Parental Bond: no second strike (one hit per party member).");
  });

  it("withholds defenders whose damage changes after the first hit", () => {
    const dragonite = build("dragonite", "multiscale");
    expect(row("beatup", maushold, dragonite, { party: ["garchomp"] })).toMatchObject({ kind: "unsupported", reason: "Beat Up into Multiscale: not calculated." });
    expect(row("beatup", maushold, dragonite, { party: [] }).kind).toBe("calculated");
    // Multiscale does nothing below full HP.
    expect(row("beatup", maushold, { ...dragonite, currentHP: 80 }, { party: ["garchomp"] }).kind).toBe("calculated");
    // Seed Sower's Grassy Terrain triggers the Grassy Seed, +1 Defense from the second hit.
    const arboliva = build("arboliva", "seedsower", championsRuntime, { itemId: "grassyseed" });
    const party = { party: ["garchomp", "incineroar"] };
    expect(row("beatup", maushold, arboliva, party)).toMatchObject({ kind: "unsupported", reason: expect.stringContaining("Seed Sower with a Grassy Seed") });
    expect(strikes(row("beatup", maushold, arboliva, party, championsRuntime, { critical: true }))).toEqual(["10-12", "15-18", "13-16"]);
    expect(strikes(row("beatup", maushold, arboliva, party, championsRuntime, { terrain: "Grassy" }))).toEqual(["5-6", "6-8", "6-8"]);
    expect(strikes(row("beatup", maushold, { ...arboliva, itemId: "" }, party))).toEqual(["6-8", "10-12", "9-11"]);
  });

  it("calculates effects that act only after the whole move, and critical hits past a Defense rise", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const mausholdSV = build("maushold", "technician", sv);
    const party = { party: ["garchomp", "annihilape"] };
    // Kee Berry and Anger Shell act after the move (onAfterMoveSecondary).
    expect(strikes(row("beatup", mausholdSV, build("snorlax", "thickfat", sv, { itemId: "keeberry" }), party, sv))).toEqual(["8-10", "12-15", "11-13"]);
    expect(strikes(row("beatup", mausholdSV, build("klawf", "angershell", sv, { currentHP: 80 }), { party: ["garchomp", "annihilape", "snorlax", "incineroar", "kingambit"] }, sv)))
      .toEqual(["5-7", "8-10", "7-9", "7-9", "7-9", "8-10"]);
    expect(strikes(row("beatup", mausholdSV, build("dragonite", "multiscale", sv, { currentHP: 80 }), { party: ["garchomp"] }, sv))).toEqual(["6-8", "9-11"]);
    // A critical hit ignores Stamina's rises; Weak Armor's drops still count.
    expect(row("beatup", mausholdSV, build("mudsdale", "stamina", sv), party, sv).kind).toBe("unsupported");
    expect(strikes(row("beatup", mausholdSV, build("mudsdale", "stamina", sv), party, sv, { critical: true }))).toEqual(["10-12", "13-16", "12-15"]);
    expect(row("beatup", mausholdSV, build("skarmory", "weakarmor", sv), { party: ["garchomp"] }, sv, { critical: true }).kind).toBe("unsupported");
    // Colbur Berry is withheld only when it halves the first hit.
    expect(row("beatup", mausholdSV, build("espeon", "synchronize", sv, { itemId: "colburberry" }), { party: ["garchomp"] }, sv)).toMatchObject({ kind: "unsupported", reason: expect.stringContaining("Colbur Berry") });
    expect(strikes(row("beatup", mausholdSV, build("snorlax", "thickfat", sv, { itemId: "colburberry" }), party, sv))).toEqual(["8-10", "12-15", "11-13"]);
  });

  it("never gets the Tera 60-power floor", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const tera = (id: string, abilityId: string, teraType: string) => build(id, abilityId, sv, { mechanic: "tera", configuration: { teraType } } as Partial<BattleBuild>);
    const snorlaxSV = build("snorlax", "thickfat", sv);
    const dark = row("beatup", tera("maushold", "technician", "Dark"), snorlaxSV, { party: ["garchomp"] }, sv);
    expect(strikes(dark)).toEqual(["12-15", "18-22"]);
    expect(dark.effectivePower).toBe(12);
    expect(strikes(row("beatup", tera("maushold", "technician", "Stellar"), snorlaxSV, { party: ["garchomp"], stellarFirstUse: true }, sv))).toEqual(["10-12", "14-18"]);
    expect(row("beatup", tera("weavile", "pressure", "Dark"), snorlaxSV, { party: [] }, sv)).toMatchObject({ min: 22, max: 28 });
  });

  it("matches Showdown in the other games", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    expect(row("beatup", build("maushold", "technician", sv), build("snorlax", "thickfat", sv), { party: ["garchomp", "annihilape"] }, sv)).toMatchObject({ min: 31, max: 38, hits: 3 });
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    expect(row("beatup", build("ambipom", "technician", usum), build("snorlax", "thickfat", usum), { party: ["garchomp", "snorlax"] }, usum)).toMatchObject({ min: 40, max: 49, hits: 3 });
    const swsh = await loadBattleRuntime("sword_shield");
    expect(row("beatup", build("bisharp", "defiant", swsh), build("snorlax", "thickfat", swsh), { party: ["garchomp"] }, swsh)).toMatchObject({ min: 34, max: 43, hits: 2 });
  });
});

describe("count controls", () => {
  function results(moveId: string, attacker: BattleBuild, contexts: Record<string, MoveContext> = {}, runtime: BattleRuntime = championsRuntime) {
    const result: MoveDamageResult = { moveId, kind: "needs-context", min: null, max: null, minPercent: null, maxPercent: null, rolls: null, ohkoChance: null, description: "", assumptions: [], reason: null, hits: null };
    return renderToStaticMarkup(createElement(MoveResults, {
      rows: [result], moveIds: [moveId], ownerId: "0:0", sourcePosition: "left", selectedMoveId: moveId, onSelectMove: vi.fn(), contexts,
      onContextChange: vi.fn(), abilityId: attacker.abilityId, itemId: attacker.itemId, attackerName: "Attacker", defenderName: "Defender",
      defenderHP: 100, runtime, sourceBuild: attacker, partyOptions: [{ speciesId: "garchomp", name: "Garchomp" }],
    }));
  }

  it("offers a fainted-allies count for Supreme Overlord only", () => {
    const panel = (abilityId: string) => renderToStaticMarkup(createElement(PokemonPanel, {
      side: "attacker", build: build("kingambit", abilityId, championsRuntime, { faintedAllies: 3 }), issues: [], onChange: vi.fn(), hpInput: "", onHPChange: vi.fn(),
    }));
    const html = panel("supremeoverlord");
    expect(html).toContain("Allies fainted before it entered");
    expect(html).toMatch(/<option value="3" selected="">3<\/option>/);
    expect(panel("defiant")).not.toContain("Allies fainted before it entered");
  });

  it("offers the Last Respects and Rage Fist counts in the move settings", async () => {
    expect(results("lastrespects", build("houndstone", "sandrush"), { lastrespects: { fainted: 2 } })).toMatch(/Party members that have fainted[\s\S]*<option value="2" selected="">2<\/option>/);
    expect(results("ragefist", build("annihilape", "defiant"))).toContain("Times hit since it last switched in");
    const sv = await loadBattleRuntime("scarlet_violet");
    expect(results("ragefist", build("annihilape", "defiant", sv), {}, sv)).toContain("Times hit this battle");
  });

  it("lists a team's Megas and other battle-only forms as their team form", () => {
    expect(beatUpPartyOptions(["mausholdfour", "kangaskhanmega", "garchomp", "gengarmega", "kangaskhan", "charizardmegay"], championsRuntime).map((option) => option.speciesId))
      .toEqual(["mausholdfour", "kangaskhan", "garchomp", "gengar", "charizard"]);
  });

  it("prompts to set Beat Up's party in the move settings", () => {
    const mausholdFour = build("mausholdfour", "technician");
    let matchup = createMatchup(0, championsRuntime);
    matchup = updateMatchupBuild(matchup, "attacker", mausholdFour);
    matchup = updateMatchupBuild(matchup, "defender", snorlax);
    matchup = selectMatchupMove(matchup, "beatup");
    const view = getAttackView(matchup);
    const result = row("beatup", mausholdFour, snorlax);
    const html = renderToStaticMarkup(createElement(MatchupSummary, {
      attacker: matchup.attacker, defender: matchup.defender, attack: matchup.attack, replacement: matchup.replacement,
      resultIdentity: { source: view.owner, receiver: view.receiverOwner }, selectedRow: result, rollMode: "average",
      issues: { attacker: [], defender: [] }, movesControl: "moves", onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onShowMove: vi.fn(),
      onRollModeChange: vi.fn(), onActivateMove: vi.fn(), onToggleMega: vi.fn(), runtime: championsRuntime,
    }));
    expect(html).toContain(">Set party</button>");
    expect(result.reason).toBe("Beat Up: party needed.");
    expect(results("beatup", mausholdFour)).toMatch(/id="[^"]*-settings"[^>]*aria-label="Selected attack context"[\s\S]*Move settings: Beat Up/);
  });

  it("builds Beat Up's party with the team listed first", () => {
    const empty = results("beatup", build("mausholdfour", "technician"));
    expect(empty).toContain("Other party members that can attack");
    expect(empty).toContain("Choose how many");
    const chosen = results("beatup", build("mausholdfour", "technician"), { beatup: { party: ["garchomp", ""] } });
    expect(chosen).toContain("Party member 2");
    expect(chosen).toContain("Party member 3");
    expect(chosen).toMatch(/<optgroup label="This team"><option value="garchomp"/);
  });
});
