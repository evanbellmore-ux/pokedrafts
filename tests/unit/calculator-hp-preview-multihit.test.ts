import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import { getSettledHealth, previewRemainingHP, settledText, type DamageRollMode } from "@/app/(app)/calculator/hp-preview";
import { koChance } from "@/app/(app)/calculator/result-format";
import { activateMoveSlot, createMatchup, getAttackView, getMoveOwner, selectMatchupMove, updateMatchupBuild, type PreparedMatchup } from "@/app/(app)/calculator/roster-prep";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, getBuildStats, validateBuild } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { AfterUse, BattleBuild, MoveDamageResult, SettledHP } from "@/app/lib/battle/types";

const sv = await loadBattleRuntime("scarlet_violet");
const swsh = await loadBattleRuntime("sword_shield");

/**
 * Hand-made rows in the shape of the row contract (types.ts afterUse, calculate.ts MatchupResult settledHP),
 * with the engine's per-hit rolls: Technician Maushold-Four's Population Bomb (Champions) and Technician
 * Breloom's Bullet Seed (Scarlet/Violet) into Garchomp (183 HP). Each afterUse is the exact walk below.
 */
const BOMB_HIT = [15, 15, 15, 15, 15, 15, 15, 16, 16, 16, 16, 16, 16, 16, 16, 18];
const SEED_HIT = [28, 28, 30, 30, 30, 30, 30, 31, 31, 31, 31, 33, 33, 33, 33, 34];
const SEED_COUNTS = [{ hits: 2, chance: 0.35 }, { hits: 3, chance: 0.35 }, { hits: 4, chance: 0.15 }, { hits: 5, chance: 0.15 }];
const GARCHOMP_HP = 183;
const modes: DamageRollMode[] = ["low", "average", "high"];

type Walk = { start: number; maxHP: number; hits: number[][]; counts?: { hits: number; chance: number }[]; sash?: boolean; berry?: { name: string; line: number; heal: number } };

/**
 * One use as AfterUse describes it, for these rows: each hit's rolls equally likely, the hits stop once the
 * target faints, a full-HP Focus Sash leaves 1 HP on the first hit, and a berry heals once at its line.
 */
function walk({ start, maxHP, hits, counts = [{ hits: hits.length, chance: 1 }], sash = false, berry }: Walk): AfterUse {
  const step = (hp: number, held: boolean, roll: number, first: boolean): [number, boolean, boolean] => {
    if (hp === 0) return [0, held, false];
    let left = sash && first && hp === maxHP && roll >= hp ? 1 : Math.max(0, hp - roll);
    let ate = false;
    if (berry && held && left > 0 && left <= berry.line) { left = Math.min(maxHP, left + berry.heal); held = false; ate = true; }
    return [left, held, ate];
  };
  const finals = new Map<number, number>();
  let states = new Map<string, number>([[`${start}|1`, 1]]);
  let ateAny = false;
  for (let hit = 0, next = 0; next < counts.length; hit++) {
    for (; next < counts.length && counts[next].hits === hit; next++) {
      for (const [key, mass] of states) finals.set(Number(key.split("|")[0]), (finals.get(Number(key.split("|")[0])) ?? 0) + mass * counts[next].chance);
    }
    if (next === counts.length) break;
    const after = new Map<string, number>();
    for (const [key, mass] of states) {
      const [hp, held] = [Number(key.split("|")[0]), key.endsWith("|1")];
      for (const roll of hits[hit]) {
        const [left, still, ate] = step(hp, held, roll, hit === 0);
        ateAny ||= ate;
        const id = `${left}|${still ? 1 : 0}`;
        after.set(id, (after.get(id) ?? 0) + mass / hits[hit].length);
      }
    }
    states = after;
  }
  const line = (pick: (rolls: number[]) => number, count: number) => {
    let hp = start, held = true;
    for (let hit = 0; hit < count; hit++) [hp, held] = step(hp, held, pick(hits[hit]), hit === 0);
    return hp;
  };
  const support = [...finals.keys()];
  return {
    start, low: line((rolls) => Math.min(...rolls), counts[0].hits), high: line((rolls) => Math.max(...rolls), counts[counts.length - 1].hits),
    average: [...finals].reduce((sum, [hp, mass]) => sum + hp * mass, 0), min: Math.min(...support), max: Math.max(...support),
    koChance: finals.get(0) ?? 0, heals: ateAny && berry ? [`${berry.name}: +${berry.heal} HP.`] : [],
  };
}

function multiHit(moveId: string, name: string, hit: number[], hits: number, landing: number, extra: Partial<MoveDamageResult> = {}): MoveDamageResult {
  const min = Math.min(...hit) * landing, max = Math.max(...hit) * hits;
  return {
    moveId, effectiveName: name, effectiveType: moveId === "bulletseed" ? "Grass" : "Normal", effectivePower: moveId === "bulletseed" ? 25 : 20, effectiveCategory: "Physical",
    kind: "calculated", min, max, minPercent: min / GARCHOMP_HP * 100, maxPercent: max / GARCHOMP_HP * 100,
    rolls: Array.from({ length: hits }, () => [...hit]), ohkoChance: null,
    description: `${name}: ${min}–${max} HP.`, assumptions: [], reason: null, hits, ...extra,
  };
}

/** One hit, with its flat rolls. */
function single(hit: number[], extra: Partial<MoveDamageResult> = {}): MoveDamageResult {
  return { ...multiHit("populationbomb", "Population Bomb", hit, 1, 1), rolls: [...hit], ohkoChance: 0, ...extra };
}

const bombs = (count: number) => Array.from({ length: count }, () => BOMB_HIT);
/** Maushold faints on hit 9 of 10 against Rough Skin. */
const cutBomb = multiHit("populationbomb", "Population Bomb", BOMB_HIT, 9, 9, {
  attackerFaintsOnHit: { hit: 9, of: 10, by: ["Rough Skin"] },
  afterUse: walk({ start: GARCHOMP_HP, maxHP: GARCHOMP_HP, hits: bombs(9) }),
});
const randomSeed = (start: number) => multiHit("bulletseed", "Bullet Seed", SEED_HIT, 5, 2, {
  hitChances: SEED_COUNTS, afterUse: walk({ start, maxHP: GARCHOMP_HP, hits: Array.from({ length: 5 }, () => SEED_HIT), counts: SEED_COUNTS }),
});

function build(id: string, abilityId: string, runtime: BattleRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, ...extra } as BattleBuild;
}

type SummaryOptions = { defender?: BattleBuild; settledHP?: { attacker?: SettledHP; defender?: SettledHP }; rollMode?: DamageRollMode; blockedReason?: string; reverse?: boolean };

function summary(runtime: BattleRuntime, attacker: BattleBuild, moveId: string, row: MoveDamageResult | undefined, options: SummaryOptions = {}) {
  let matchup: PreparedMatchup = createMatchup(0, runtime);
  matchup = updateMatchupBuild(matchup, "attacker", attacker);
  matchup = updateMatchupBuild(matchup, "defender", options.defender ?? build("garchomp", "roughskin", runtime));
  if (options.reverse) matchup = activateMoveSlot(matchup, getMoveOwner(matchup.defender), 0);
  matchup = selectMatchupMove(matchup, moveId);
  const view = getAttackView(matchup);
  return renderToStaticMarkup(createElement(MatchupSummary, {
    attacker: matchup.attacker, defender: matchup.defender, attack: matchup.attack, replacement: matchup.replacement,
    resultIdentity: { source: view.owner, receiver: view.receiverOwner }, selectedRow: row, rollMode: options.rollMode ?? "average",
    issues: { attacker: validateBuild(matchup.attacker.build, runtime), defender: validateBuild(matchup.defender.build, runtime) },
    movesControl: "moves", onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onShowMove: vi.fn(),
    onRollModeChange: vi.fn(), onActivateMove: vi.fn(), onToggleMega: vi.fn(), runtime, settledHP: options.settledHP, blockedReason: options.blockedReason,
  }));
}

/** Text a sighted user can see, with tags and screen-reader-only text removed and spacing collapsed. */
const text = (html: string) => html.replace(/<(\w+)\b[^>]*\bclass="[^"]*\bsr-only\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g, " ")
  .replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

function meter(html: string, position: "left" | "right") {
  const found = html.match(new RegExp(`<div role="meter" aria-label="[^"]* ${position} [^"]*"[^>]*>[\\s\\S]*?</div>(?:<div data-hp-range[^>]*></div>)?</div>`))?.[0];
  expect(found).toBeDefined();
  return found!;
}

const maushold = build("mausholdfour", "technician", championsRuntime);
const breloom = build("breloom", "technician", sv);
const garchomp = build("garchomp", "roughskin", championsRuntime);

describe("one-use HP preview from afterUse", () => {
  it("previews a multi-hit row: each roll mode's HP left, the hits' damage and the whole range", () => {
    expect(cutBomb.afterUse).toEqual({ start: 183, low: 48, high: 21, average: 41.8125, min: 21, max: 48, koChance: 0, heals: [] });
    const expected = { low: [135, 48], average: [141, 42], high: [162, 21] } as const;
    for (const mode of modes) {
      const [damage, remaining] = expected[mode];
      expect(previewRemainingHP(garchomp, cutBomb, mode)).toEqual({ status: "ready", current: 183, maximum: 183, min: 21, max: 48, damage, remaining });
    }
  });

  it("previews random hit counts, with the exact KO chance", () => {
    const hurt = build("garchomp", "roughskin", sv, { currentHP: 100 });
    const seed = randomSeed(100);
    // 3 hits reach 100 HP on 61 of the 4096 roll sequences (34+34+34, 34+34+33, 34+33+33); 4 and 5 hits always do.
    expect(seed.afterUse!.koChance).toBeCloseTo(0.35 * 61 / 4096 + 0.3, 12);
    expect(seed.afterUse).toMatchObject({ start: 100, low: 44, high: 0, min: 0, max: 44 });
    expect(previewRemainingHP(hurt, seed, "low", sv)).toMatchObject({ status: "ready", damage: 56, remaining: 44, min: 0, max: 44 });
    expect(previewRemainingHP(hurt, seed, "high", sv)).toMatchObject({ status: "ready", damage: 100, remaining: 0 });
    const average = Math.round(seed.afterUse!.average);
    expect(previewRemainingHP(hurt, seed, "average", sv)).toMatchObject({ status: "ready", damage: 100 - average, remaining: average });
    expect(koChance(seed)).toBe("30.52%");
  });

  it("previews a full-HP Focus Sash against several hits, and one hit, that the preview withheld before", () => {
    const sash = { ...garchomp, abilityId: "sandveil", itemId: "focussash" };
    const big = Array.from({ length: 16 }, (_, index) => 190 + index);
    const bomb = multiHit("populationbomb", "Population Bomb", big, 10, 10, { afterUse: walk({ start: 183, maxHP: 183, hits: Array.from({ length: 10 }, () => big), sash: true }) });
    // 1 HP after the first hit, then the second knocks it out.
    expect(bomb.afterUse).toEqual({ start: 183, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 1, heals: [] });
    for (const mode of modes) expect(previewRemainingHP(sash, bomb, mode)).toEqual({ status: "ready", current: 183, maximum: 183, min: 0, max: 0, damage: 183, remaining: 0 });
    expect(koChance(bomb)).toBe("100%");
    const one = single(big, { afterUse: walk({ start: 183, maxHP: 183, hits: [big], sash: true }) });
    for (const mode of modes) expect(previewRemainingHP(sash, one, mode)).toMatchObject({ status: "ready", damage: 182, remaining: 1 });
    // Without afterUse the survival effect still withholds, for one hit or several.
    expect(previewRemainingHP(sash, { ...one, afterUse: undefined })).toEqual({ status: "unavailable", reason: "Remaining HP is withheld for Focus Sash." });
    expect(previewRemainingHP(sash, { ...bomb, afterUse: undefined })).toEqual({ status: "unavailable", reason: "Remaining HP is withheld for Focus Sash." });
    const band = { ...garchomp, itemId: "focusband" };
    expect(previewRemainingHP(band, { ...cutBomb, afterUse: undefined })).toEqual({ status: "unavailable", reason: "Remaining HP is withheld for Focus Band." });
    expect(previewRemainingHP(garchomp, { ...cutBomb, afterUse: undefined })).toEqual({ status: "unavailable", reason: "A complete flat damage distribution is required for an HP preview." });
  });

  it("rounds a half average the way the per-roll preview does: the damage up", () => {
    // 11–14 four times each: 12.5 average damage, 170.5 HP left from 183.
    const hit = [11, 11, 11, 11, 12, 12, 12, 12, 13, 13, 13, 13, 14, 14, 14, 14];
    const row = single(hit, { afterUse: walk({ start: 183, maxHP: 183, hits: [hit] }) });
    expect(row.afterUse).toMatchObject({ average: 170.5, min: 169, max: 172 });
    for (const mode of modes) {
      expect(previewRemainingHP(garchomp, row, mode)).toEqual(previewRemainingHP(garchomp, { ...row, afterUse: undefined }, mode));
    }
    expect(previewRemainingHP(garchomp, row, "average")).toMatchObject({ damage: 13, remaining: 170 });
  });

  it("lists healing during the hits and leaves their damage unknown", () => {
    const sitrus = { ...garchomp, abilityId: "sandveil", itemId: "sitrusberry" };
    const bomb = multiHit("populationbomb", "Population Bomb", BOMB_HIT, 10, 10, {
      afterUse: walk({ start: 183, maxHP: 183, hits: bombs(10), berry: { name: "Sitrus Berry", line: 91, heal: 45 } }),
    });
    expect(bomb.afterUse).toEqual({ start: 183, low: 78, high: 48, average: 71.125, min: 48, max: 78, koChance: 0, heals: ["Sitrus Berry: +45 HP."] });
    expect(previewRemainingHP(sitrus, bomb)).toEqual({ status: "ready", current: 183, maximum: 183, min: 48, max: 78, damage: null, remaining: 71, heals: ["Sitrus Berry: +45 HP."] });
    const html = text(summary(championsRuntime, maushold, "populationbomb", bomb, { defender: sitrus }));
    expect(html).toContain("183 → 71 HP · Average estimate");
    expect(html).toContain("Garchomp HP remaining: 71 / 183 Sitrus Berry: +45 HP.");
  });

  it("gives the low and high rolls their own damage dealt and healing, and the average the healing that can occur", () => {
    // The engine's row (calculator-after-use.test.ts checks it against Showdown): Avalanche 36–44 into Sitrus Garchomp
    // at 130, whose lowest roll leaves 94 without the berry and whose highest leaves 86, healed to 131.
    const sitrus = build("garchomp", "sandveil", sv, { itemId: "sitrusberry", currentHP: 130 });
    const smeargle = build("smeargle", "owntempo", sv);
    const avalanche = calculateMatchup(smeargle, sitrus, { ...createConditions(), gameType: "Singles" }, {}, sv).results.find((result) => result.moveId === "avalanche")!;
    const ready = { status: "ready", current: 130, maximum: 183, min: 94, max: 135 };
    expect(previewRemainingHP(sitrus, avalanche, "low", sv)).toEqual({ ...ready, damage: 36, remaining: 94 });
    expect(previewRemainingHP(sitrus, avalanche, "high", sv)).toEqual({ ...ready, damage: 44, remaining: 131, heals: ["Sitrus Berry: +45 HP."] });
    expect(previewRemainingHP(sitrus, avalanche, "average", sv)).toEqual({ ...ready, damage: null, remaining: 119, heals: ["Sitrus Berry: +45 HP."] });
    const low = text(summary(sv, smeargle, "avalanche", avalanche, { defender: sitrus, rollMode: "low" }));
    expect(low).toContain("36 damage · Low roll");
    expect(low).toContain("Garchomp HP remaining: 94 / 183");
    expect(low).not.toContain("Sitrus Berry: +45 HP.");
    const high = text(summary(sv, smeargle, "avalanche", avalanche, { defender: sitrus, rollMode: "high" }));
    expect(high).toContain("44 damage · High roll");
    expect(high).toContain("Garchomp HP remaining: 131 / 183 Sitrus Berry: +45 HP.");
    expect(text(summary(sv, smeargle, "avalanche", avalanche, { defender: sitrus }))).toContain("130 → 119 HP · Average estimate");
    // A path whose damage is not a whole HP falls back to the healing that can occur.
    const broken = { ...avalanche, afterUse: { ...avalanche.afterUse!, paths: { ...avalanche.afterUse!.paths!, high: { dealt: 1.5, heals: [] } } } };
    expect(previewRemainingHP(sitrus, broken, "high", sv)).toMatchObject({ damage: null, remaining: 131, heals: ["Sitrus Berry: +45 HP."] });
  });

  it("leaves out a one-use outcome calculated before the HP was edited", () => {
    // The result calculated at 91 HP settled the target at 136; the HP typed in since is 136, its afterUse's start.
    const typed = { ...garchomp, itemId: "sitrusberry", currentHP: 136 };
    const stale: SettledHP = { hp: 136, entered: 91, maxHP: 183, item: "Sitrus Berry" };
    const row = { ...cutBomb, afterUse: walk({ start: 136, maxHP: 183, hits: bombs(9) }) };
    for (const mode of modes) expect(previewRemainingHP(typed, row, mode, championsRuntime, stale).status).toBe("unavailable");
    expect(previewRemainingHP(typed, row, "low", championsRuntime)).toMatchObject({ status: "ready", current: 136, remaining: 1 });
    const html = summary(championsRuntime, maushold, "populationbomb", row, { defender: typed, settledHP: { defender: stale } });
    expect(meter(html, "right")).toContain('aria-valuenow="136"');
    expect(meter(html, "right")).toContain('aria-label="Garchomp right current HP"');
  });

  it("starts from the HP the target has after a berry it ate before the move", () => {
    const hurt = { ...garchomp, currentHP: 91, itemId: "sitrusberry" };
    const settled: SettledHP = { hp: 136, entered: 91, maxHP: 183, item: "Sitrus Berry" };
    const row = { ...cutBomb, afterUse: walk({ start: 136, maxHP: 183, hits: bombs(9) }) };
    expect(row.afterUse).toMatchObject({ start: 136, low: 1, high: 0, min: 0, max: 1 });
    expect(previewRemainingHP(hurt, row, "low", championsRuntime, settled)).toMatchObject({ status: "ready", current: 136, damage: 135, remaining: 1 });
    expect(previewRemainingHP(hurt, row, "high", championsRuntime, settled)).toMatchObject({ status: "ready", current: 136, damage: 136, remaining: 0 });
    // From the entered HP the row is for another start, so the multi-hit preview is unavailable.
    expect(previewRemainingHP(hurt, row, "low").status).toBe("unavailable");
    // A single hit without afterUse subtracts from the settled HP too.
    expect(previewRemainingHP(hurt, single(SEED_HIT), "high", championsRuntime, settled)).toMatchObject({ status: "ready", current: 136, damage: 34, remaining: 102 });
  });

  it("falls back to the per-roll preview when afterUse is for another HP, out of range, or the row has an alternate case", () => {
    const hit = single(SEED_HIT);
    const exact = walk({ start: 183, maxHP: 183, hits: [SEED_HIT] });
    expect(previewRemainingHP(garchomp, { ...hit, afterUse: exact }, "high")).toMatchObject({ status: "ready", damage: 34, remaining: 149 });
    for (const afterUse of [
      { ...exact, start: 150 }, { ...exact, low: 184 }, { ...exact, min: -1 }, { ...exact, average: Number.NaN }, { ...exact, high: 1.5 },
      { ...exact, min: 160 }, { ...exact, koChance: 2 }, { ...exact, heals: [1] as unknown as string[] },
    ]) {
      expect(previewRemainingHP(garchomp, { ...hit, afterUse }, "high")).toEqual({ status: "ready", current: 183, maximum: 183, min: 149, max: 155, damage: 34, remaining: 149 });
      expect(previewRemainingHP(garchomp, { ...cutBomb, afterUse }, "high").status).toBe("unavailable");
    }
    const alternate = { ...hit, alternate: { chance: 0.3, label: "Fickle Beam doubled", usualLabel: "usual", min: 56, max: 68, minPercent: 0, maxPercent: 0, rolls: SEED_HIT.map((roll) => roll * 2) } };
    expect(previewRemainingHP(garchomp, { ...alternate, afterUse: { ...exact, average: exact.min } }, "average")).toMatchObject({ status: "ready", damage: 31, remaining: 152, alternate: { damage: 62, remaining: 121 } });
  });
});

describe("one-use KO from afterUse", () => {
  it("states the exact chance for a multi-hit row, and keeps the row's own chance when it has one", () => {
    expect(koChance({ ...cutBomb, afterUse: { ...cutBomb.afterUse!, koChance: 0.25 } })).toBe("25%");
    expect(koChance({ ...cutBomb, ohkoChance: 0.5, afterUse: { ...cutBomb.afterUse!, koChance: 0.25 } })).toBe("50%");
    expect(koChance({ ...cutBomb, afterUse: undefined })).toBe("Not estimated");
    for (const chance of [Number.NaN, -0.1, 1.1]) expect(koChance({ ...cutBomb, afterUse: { ...cutBomb.afterUse!, koChance: chance } })).toBe("Not estimated");
    expect(koChance({ ...cutBomb, kind: "needs-context" })).toBe("Not estimated");
  });
});

describe("selected-move summary with a one-use preview", () => {
  it("shows the projected HP, its range on the bar and the KO chance for a multi-hit row", () => {
    const html = summary(championsRuntime, maushold, "populationbomb", cutBomb);
    expect(text(html)).toContain("141 damage · Average estimate 135–162 damage range, 9 of 10 hits · One-use KO: 0% (all rolls)");
    expect(text(html)).toContain("Garchomp HP remaining: 42 / 183");
    const bar = meter(html, "right");
    expect(bar).toContain('aria-label="Garchomp right projected HP"');
    expect(bar).toContain('aria-valuenow="42"');
    expect(bar).toContain('aria-valuetext="42 of 183 HP after Population Bomb, Average estimate (21–48). Current HP: 183."');
    expect(bar).toContain(`width:${42 / 183 * 100}%`);
    expect(bar).toContain(`<div data-hp-range="true" aria-hidden="true" class="absolute inset-y-0 bg-text/25" style="left:${21 / 183 * 100}%;width:${27 / 183 * 100}%"></div>`);
    expect(text(html)).toContain("After Population Bomb · Average estimate 42 / 183 HP");
    for (const [mode, label, damage, remaining] of [["low", "Low roll", 135, 48], ["high", "High roll", 162, 21]] as const) {
      expect(text(summary(championsRuntime, maushold, "populationbomb", cutBomb, { rollMode: mode }))).toContain(`${damage} damage · ${label}`);
      expect(text(summary(championsRuntime, maushold, "populationbomb", cutBomb, { rollMode: mode }))).toContain(`HP remaining: ${remaining} / 183`);
    }
  });

  it("shows a random count's preview and KO chance", () => {
    const seed = randomSeed(100);
    const html = text(summary(sv, breloom, "bulletseed", seed, { defender: build("garchomp", "roughskin", sv, { currentHP: 100 }) }));
    const average = Math.round(seed.afterUse!.average);
    expect(html).toContain(`${100 - average} damage · Average estimate 56–170 damage range, 2–5 hits · One-use KO: 30.52% (all rolls)`);
    expect(html).toContain(`Garchomp HP remaining: ${average} / 183`);
    expect(html).toContain("Current HP: 100 / 183");
  });

  it("starts the target's bar from its settled HP, with the berry as a fact", () => {
    const hurt = build("garchomp", "roughskin", championsRuntime, { currentHP: 91, itemId: "sitrusberry" });
    const settledHP = { defender: { hp: 136, entered: 91, maxHP: 183, item: "Sitrus Berry" } };
    const row = { ...cutBomb, afterUse: walk({ start: 136, maxHP: 183, hits: bombs(9) }) };
    const html = summary(championsRuntime, maushold, "populationbomb", row, { defender: hurt, settledHP });
    const average = Math.round(row.afterUse.average);
    expect(text(html)).toContain(`${136 - average} damage · Average estimate`);
    expect(text(html)).toContain(`After Population Bomb · Average estimate ${average} / 183 HP Sitrus Berry: 91 → 136 HP`);
    expect(text(html)).not.toContain("Current HP: 91");
    expect(meter(html, "right")).toContain("Current HP: 91. Sitrus Berry: 91 → 136 HP.");
    // A status move has no preview: the bar shows the HP the move starts with.
    const status: MoveDamageResult = { ...cutBomb, kind: "status", min: null, max: null, rolls: null, hits: null, afterUse: undefined };
    const resting = summary(championsRuntime, maushold, "populationbomb", status, { defender: hurt, settledHP });
    expect(meter(resting, "right")).toContain('aria-label="Garchomp right current HP"');
    expect(meter(resting, "right")).toContain('aria-valuenow="136"');
    expect(meter(resting, "right")).not.toContain("data-hp-range");
    expect(text(resting)).toContain("Current HP 136 / 183 HP Sitrus Berry: 91 → 136 HP");
  });

  it("shows the attacker's settled HP on its own card", () => {
    const max = getBuildStats(maushold)!.hp;
    const hurt = { ...maushold, currentHP: 74, itemId: "sitrusberry" };
    const settledHP = { attacker: { hp: 111, entered: 74, maxHP: max, item: "Sitrus Berry" } };
    const html = summary(championsRuntime, hurt, "populationbomb", cutBomb, { settledHP });
    expect(max).toBe(149);
    expect(meter(html, "left")).toContain('aria-valuenow="111"');
    expect(meter(html, "left")).toContain('aria-valuetext="111 of 149 HP. Sitrus Berry: 74 → 111 HP."');
    expect(text(html)).toContain("Current HP 111 / 149 HP Sitrus Berry: 74 → 111 HP");
    // The right Pokémon attacking the left: the move's user is the result's attacker.
    const reverse = summary(championsRuntime, hurt, "earthquake", undefined, { reverse: true, settledHP: { defender: settledHP.attacker } });
    expect(meter(reverse, "left")).toContain('aria-valuenow="111"');
    expect(meter(reverse, "right")).toContain('aria-valuenow="183"');
  });

  it("ignores settled HP for another entered HP, a blocked result or another pair", () => {
    const hurt = build("garchomp", "roughskin", championsRuntime, { currentHP: 90, itemId: "sitrusberry" });
    const stale = { defender: { hp: 136, entered: 91, maxHP: 183, item: "Sitrus Berry" } };
    expect(getSettledHealth(hurt, stale.defender)).toBeNull();
    expect(meter(summary(championsRuntime, maushold, "populationbomb", undefined, { defender: hurt, settledHP: stale }), "right")).toContain('aria-valuenow="90"');
    const fresh = { defender: { ...stale.defender, entered: 90, hp: 135 } };
    expect(meter(summary(championsRuntime, maushold, "populationbomb", undefined, { defender: hurt, settledHP: fresh }), "right")).toContain('aria-valuenow="135"');
    const blocked = summary(championsRuntime, maushold, "populationbomb", undefined, { defender: hurt, settledHP: fresh, blockedReason: "Fix invalid settings." });
    expect(meter(blocked, "right")).toContain('aria-valuenow="90"');
    expect(blocked).not.toContain("Sitrus Berry:");
  });

  it("shows a settled Dynamax target in Dynamax HP and the berry in the HP as entered", () => {
    const dynamax = { ...build("garchomp", "roughskin", swsh, { currentHP: 91, itemId: "sitrusberry" }), mechanic: "dynamax" as const };
    const max = getBuildStats(dynamax, swsh)!.hp;
    const settled = { hp: 136, entered: 91, maxHP: max, item: "Sitrus Berry" };
    expect(getSettledHealth(dynamax, settled, swsh)).toEqual({ current: 272, maximum: max * 2 });
    expect(settledText(settled)).toBe("Sitrus Berry: 91 → 136 HP");
    const row = single(SEED_HIT, { moveId: "earthquake", effectiveName: "Max Quake", afterUse: walk({ start: 272, maxHP: max * 2, hits: [SEED_HIT] }) });
    expect(previewRemainingHP(dynamax, row, "high", swsh, settled)).toMatchObject({ status: "ready", current: 272, damage: 34, remaining: 238 });
  });

  it("wraps the facts it adds at phone width", () => {
    const hurt = build("garchomp", "roughskin", championsRuntime, { currentHP: 91, itemId: "sitrusberry" });
    const sitrus = { ...cutBomb, afterUse: { ...walk({ start: 136, maxHP: 183, hits: bombs(9) }), heals: ["Sitrus Berry: +45 HP."] } };
    const html = summary(championsRuntime, maushold, "populationbomb", sitrus, { defender: hurt, settledHP: { defender: { hp: 136, entered: 91, maxHP: 183, item: "Sitrus Berry" } } });
    for (const fact of ["Sitrus Berry: 91 → 136 HP", "Sitrus Berry: +45 HP."]) {
      const tag = html.match(new RegExp(`<p class="([^"]*)">${fact.replace(/[.+]/g, "\\$&")}</p>`));
      expect(tag?.[1]).toContain("wrap-anywhere");
    }
  });
});
