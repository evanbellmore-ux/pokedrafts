import { createElement, type ChangeEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import MoveResults, { MoveDetails } from "@/app/(app)/calculator/MoveResults";
import { previewRemainingHP } from "@/app/(app)/calculator/hp-preview";
import { hitCountRanges, hitCountText, hitRangeText } from "@/app/(app)/calculator/result-format";
import { createMatchup, getAttackView, getMoveOwner, selectMatchupMove, updateMatchupBuild, updateMatchupMoveContext, type PreparedMatchup } from "@/app/(app)/calculator/roster-prep";
import * as selectControl from "@/app/components/ui/Select";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, rankResults, validateBuild } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, MoveContext, MoveDamageResult } from "@/app/lib/battle/types";

const viewport = vi.hoisted(() => ({ wide: false }));
vi.mock("@/app/(app)/leagues/[leagueId]/useMinWidthMd", () => ({ useMinWidthMd: () => viewport.wide }));

const sv = await loadBattleRuntime("scarlet_violet");

/**
 * Hand-made rows in the shape of the row contract (types.ts hits, hitChances, attackerFaintsOnHit), with the
 * engine's per-hit rolls: Technician Breloom's Bullet Seed into Garchomp (Scarlet/Violet, 183 HP) and
 * Technician Maushold's Population Bomb into a Rough Skin Garchomp (Maushold faints on hit 9 of 10).
 */
const SEED_HIT = [28, 28, 30, 30, 30, 30, 30, 31, 31, 31, 31, 33, 33, 33, 33, 34];
const BOMB_HIT = [15, 15, 15, 15, 15, 15, 15, 16, 16, 16, 16, 16, 16, 16, 16, 18];
const GARCHOMP_HP = 183;

function multiHit(moveId: string, name: string, hit: number[], hits: number, landing: number, extra: Partial<MoveDamageResult> = {}): MoveDamageResult {
  const min = Math.min(...hit) * landing, max = Math.max(...hit) * hits;
  return {
    moveId, effectiveName: name, effectiveType: moveId === "bulletseed" ? "Grass" : "Normal", effectivePower: moveId === "bulletseed" ? 25 : 20, effectiveCategory: "Physical",
    kind: "calculated", min, max, minPercent: min / GARCHOMP_HP * 100, maxPercent: max / GARCHOMP_HP * 100,
    rolls: Array.from({ length: hits }, () => [...hit]), ohkoChance: null,
    description: `${name}: ${min}–${max} HP.`, assumptions: [], reason: null, hits, ...extra,
  };
}

const randomSeed = multiHit("bulletseed", "Bullet Seed", SEED_HIT, 5, 2, {
  hitChances: [{ hits: 2, chance: 0.35 }, { hits: 3, chance: 0.35 }, { hits: 4, chance: 0.15 }, { hits: 5, chance: 0.15 }],
  assumptions: ["Bullet Seed: 2–5 hits (2 and 3: 35% each, 4 and 5: 15% each)."],
});
const cutBomb = multiHit("populationbomb", "Population Bomb", BOMB_HIT, 9, 9, {
  attackerFaintsOnHit: { hit: 9, of: 10, by: ["Rough Skin"] },
  assumptions: ["Population Bomb: all 10 hits land.", "Maushold faints on hit 9 of 10 (Rough Skin)."],
});
const randomCutBomb = multiHit("populationbomb", "Population Bomb", BOMB_HIT, 9, 4, {
  hitChances: [4, 5, 6, 7, 8].map((hits) => ({ hits, chance: 1 / 7 })).concat({ hits: 9, chance: 2 / 7 }),
  attackerFaintsOnHit: { hit: 9, of: 10, by: ["Rough Skin"] },
  assumptions: ["Population Bomb: 4–10 hits (Loaded Dice).", "Maushold faints on hit 9 of 10 (Rough Skin)."],
});
const staleSeed: MoveDamageResult = {
  ...randomSeed, kind: "needs-context", min: null, max: null, minPercent: null, maxPercent: null, rolls: null, hits: null,
  hitChances: undefined, assumptions: [], reason: "Needs the hit count (2–5).",
};

function build(id: string, abilityId: string, runtime: BattleRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, ...extra } as BattleBuild;
}

function list(rows: MoveDamageResult[], attacker: BattleBuild, runtime: BattleRuntime, contexts: Record<string, MoveContext> = {}, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(MoveResults, {
    rows, moveIds: rows.map((row) => row.moveId), ownerId: "0:0", selectedMoveId: null, onSelectMove: vi.fn(),
    contexts, onContextChange: vi.fn(), abilityId: attacker.abilityId, itemId: attacker.itemId, attackerName: "Attacker",
    defenderName: "Garchomp", defenderHP: GARCHOMP_HP, runtime, sourceBuild: attacker, ...extra,
  }));
}

function details(row: MoveDamageResult | undefined, moveId: string, attacker: BattleBuild, runtime: BattleRuntime, context?: MoveContext, onContextChange = vi.fn()) {
  return renderToStaticMarkup(createElement(MoveDetails, {
    runtime, moveId, row, id: "details", context, abilityId: attacker.abilityId, itemId: attacker.itemId, onContextChange, sourceBuild: attacker,
  }));
}

function summary(runtime: BattleRuntime, attacker: BattleBuild, moveId: string, row: MoveDamageResult, context?: MoveContext) {
  let matchup: PreparedMatchup = createMatchup(0, runtime);
  matchup = updateMatchupBuild(matchup, "attacker", attacker);
  matchup = updateMatchupBuild(matchup, "defender", build("garchomp", "roughskin", runtime));
  matchup = selectMatchupMove(matchup, moveId);
  if (context) matchup = updateMatchupMoveContext(matchup, getMoveOwner(matchup.attacker), moveId, context);
  const view = getAttackView(matchup);
  return renderToStaticMarkup(createElement(MatchupSummary, {
    attacker: matchup.attacker, defender: matchup.defender, attack: matchup.attack, replacement: matchup.replacement,
    resultIdentity: { source: view.owner, receiver: view.receiverOwner }, selectedRow: row, rollMode: "average",
    issues: { attacker: validateBuild(matchup.attacker.build, runtime), defender: validateBuild(matchup.defender.build, runtime) },
    movesControl: "moves", onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onShowMove: vi.fn(),
    onRollModeChange: vi.fn(), onActivateMove: vi.fn(), onToggleMega: vi.fn(), runtime,
  }));
}

/** Text a sighted user can see, with tags and screen-reader-only text removed and spacing collapsed. */
const text = (html: string) => html.replace(/<(\w+)\b[^>]*\bclass="[^"]*\bsr-only\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g, " ")
  .replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const breloom = build("breloom", "technician", sv);
const maushold = build("mausholdfour", "technician", championsRuntime);

describe("hit count text", () => {
  it("states the random range, the hit the attacker faints on, or the count", () => {
    expect(hitCountText(randomSeed)).toBe("2–5");
    expect(hitCountText(cutBomb)).toBe("9 of 10");
    expect(hitCountText(randomCutBomb)).toBe("4–9");
    expect(hitCountText({ hits: 3 })).toBe("3");
    expect(hitCountText({ hits: null })).toBeNull();
    // Every count merged into the hit it faints on: one count, out of the most it would make.
    expect(hitCountText({ hits: 2, hitChances: [{ hits: 2, chance: 1 }], attackerFaintsOnHit: { hit: 2, of: 5, by: ["Rocky Helmet"] } })).toBe("2 of 5");
    expect(hitRangeText(randomSeed)).toBe("2–5 hits");
    expect(hitRangeText(cutBomb)).toBe("9 of 10 hits");
    expect(hitRangeText({ hits: 1, attackerFaintsOnHit: { hit: 1, of: 10, by: ["Rough Skin"] } })).toBe("1 of 10 hits");
    // A fixed or chosen count needs no hit line.
    expect(hitRangeText({ hits: 5 })).toBeNull();
    expect(hitRangeText({ hits: 1 })).toBeNull();
  });

  it("names the counts a faint cuts short as the faint's assumption does", () => {
    // Loaded Dice's 4 or 5 hits, both cut at hit 1: "1 of 4 or 5", as "faints on hit 1 of 4 or 5".
    expect(hitCountText({ hits: 1, attackerFaintsOnHit: { hit: 1, of: 5, ofMin: 4, by: ["Rough Skin"] } })).toBe("1 of 4 or 5");
    expect(hitRangeText({ hits: 1, attackerFaintsOnHit: { hit: 1, of: 5, ofMin: 4, by: ["Rough Skin"] } })).toBe("1 of 4 or 5 hits");
    expect(hitRangeText({ hits: 2, attackerFaintsOnHit: { hit: 2, of: 5, ofMin: 2, by: ["Rough Skin"] } })).toBe("2 of 2–5 hits");
    expect(hitRangeText({ hits: 9, attackerFaintsOnHit: { hit: 9, of: 10, ofMin: 10, by: ["Rough Skin"] } })).toBe("9 of 10 hits");
  });

  it("sums each count's first hits for its damage range", () => {
    expect(hitCountRanges(randomSeed)).toEqual([
      { hits: 2, chance: 0.35, min: 56, max: 68 }, { hits: 3, chance: 0.35, min: 84, max: 102 },
      { hits: 4, chance: 0.15, min: 112, max: 136 }, { hits: 5, chance: 0.15, min: 140, max: 170 },
    ]);
    expect(hitCountRanges(randomCutBomb)!.map(({ hits, min, max }) => [hits, min, max])).toEqual([[4, 60, 72], [5, 75, 90], [6, 90, 108], [7, 105, 126], [8, 120, 144], [9, 135, 162]]);
    // The fewest hits at their lowest rolls and the most at their highest are the row's min and max.
    const ranges = hitCountRanges(randomSeed)!;
    expect([ranges[0].min, ranges[ranges.length - 1].max]).toEqual([randomSeed.min, randomSeed.max]);
    expect(hitCountRanges(cutBomb)).toBeNull();
    expect(hitCountRanges({ ...randomSeed, rolls: SEED_HIT })).toBeNull();
    expect(hitCountRanges({ ...randomSeed, rolls: randomSeed.rolls && (randomSeed.rolls as number[][]).slice(0, 4) })).toBeNull();
  });
});

describe("move list damage for random and cut-short hit counts", () => {
  it.each([false, true])("shows the range and the hits that land, with no Set hits prompt (wide=%s)", (wide) => {
    viewport.wide = wide;
    try {
      const seed = text(list([randomSeed], breloom, sv));
      expect(seed).toContain("56–170 HP · 2–5 hits");
      expect(seed).toContain("30.6–92.9% of max HP");
      expect(seed).not.toContain("Set hits");
      expect(seed).not.toContain("Unranked");
      expect(seed).toContain("Details");
      const bomb = text(list([cutBomb], maushold, championsRuntime));
      expect(bomb).toContain("135–162 HP · 9 of 10 hits");
      expect(bomb).not.toContain("Set hits");
      const dice = build("maushold", "technician", sv, { itemId: "loadeddice" });
      const random = text(list([randomCutBomb], dice, sv));
      expect(random).toContain("60–162 HP · 4–9 hits");
      expect(random).not.toContain("Set hits");
      // A chosen count is named; every hit landing by default keeps the plain damage line.
      const chosen = { ...randomSeed, hitChances: undefined, min: 140, assumptions: [] };
      expect(text(list([chosen], breloom, sv, { bulletseed: { hits: 5 } }))).toContain("140–170 HP · 5 hits");
      const allTen = { ...cutBomb, attackerFaintsOnHit: undefined, hits: 10, rolls: Array.from({ length: 10 }, () => [...BOMB_HIT]), min: 150, max: 180 };
      expect(text(list([allTen], maushold, championsRuntime))).toMatch(/150–180 HP [\d.]+–[\d.]+% of max HP/);
      expect(text(list([{ ...allTen, hits: 4, min: 60, max: 72 }], maushold, championsRuntime, { populationbomb: { hits: 4 } }))).toContain("60–72 HP · 4 hits");
      // Z-Moves and Max Moves hit once.
      const zMove = { ...chosen, effectiveName: "Bloom Doom", effectivePower: 120, hits: 1, rolls: SEED_HIT, min: 28, max: 34 };
      expect(text(list([zMove], breloom, sv, { bulletseed: { hits: 5, useZ: true } }))).toMatch(/28–34 HP [\d.]+–[\d.]+% of max HP/);
    } finally {
      viewport.wide = false;
    }
  });

  it("asks for hits only for a chosen count outside the range", () => {
    for (const wide of [false, true]) {
      viewport.wide = wide;
      try {
        // Loaded Dice keeps only 4 or 5 hits, so a chosen 3 is stale.
        expect(list([staleSeed], build("breloom", "technician", sv, { itemId: "loadeddice" }), sv, { bulletseed: { hits: 3 } })).toContain("Set hits");
        expect(list([staleSeed], breloom, sv, { bulletseed: { hits: 6 } })).toContain("Set hits");
        expect(list([randomSeed], breloom, sv)).not.toContain("Set hits");
        // A per-hit-accuracy move's stale count too, but not another needs-context reason.
        const weavile = build("weavile", "pressure", championsRuntime);
        const axel: MoveDamageResult = { ...staleSeed, moveId: "tripleaxel", effectiveName: "Triple Axel", reason: "Needs the hit count (1–3)." };
        expect(list([axel], weavile, championsRuntime, { tripleaxel: { hits: 4 } })).toContain("Set hits");
        expect(list([{ ...axel, reason: "Intact Disguise takes the first hit." }], weavile, championsRuntime, { tripleaxel: { hits: 4 } })).not.toContain("Set hits");
        expect(list([{ ...axel, reason: "Intact Disguise takes the first hit." }], weavile, championsRuntime)).not.toContain("Set hits");
        // Paused calculations have no rows: only a stale count still waits.
        expect(list([randomSeed], breloom, sv, {}, { blocked: true })).not.toContain("Set hits");
        expect(list([randomSeed], breloom, sv, { bulletseed: { hits: 9 } }, { blocked: true })).toContain("Set hits");
      } finally {
        viewport.wide = false;
      }
    }
  });
});

describe("move details for random and cut-short hit counts", () => {
  it("offers the random count first, then each exact count", () => {
    const html = details(randomSeed, "bulletseed", breloom, sv);
    expect(html).toContain('id="details-hits"');
    expect(html).toContain('<option value="" selected="">2–5 hits (random)</option><option value="2">2 hits</option><option value="3">3 hits</option><option value="4">4 hits</option><option value="5">5 hits</option>');
    expect(html).not.toContain("Choose hit count");
    expect(text(html)).toContain("· Hits: 2–5");
    const chosen = details({ ...randomSeed, hitChances: undefined, hits: 3, rolls: [SEED_HIT, SEED_HIT, SEED_HIT], min: 84, max: 102 }, "bulletseed", breloom, sv, { hits: 3 });
    expect(chosen).toContain('<option value="">2–5 hits (random)</option>');
    expect(chosen).toContain('<option value="3" selected="">3 hits</option>');
    expect(text(chosen)).toContain("· Hits: 3");
    const dice = details(randomCutBomb, "populationbomb", build("maushold", "technician", sv, { itemId: "loadeddice" }), sv);
    expect(dice).toContain('<option value="" selected="">4–10 hits (random)</option><option value="4">4 hits</option>');
    expect(dice).toContain('<option value="10">10 hits</option>');
    expect(dice).toContain("Loaded Dice limits this choice to 4–10 hits.");
    expect(text(dice)).toContain("· Hits: 4–9");
    const loadedSeed = details(randomSeed, "bulletseed", build("breloom", "technician", sv, { itemId: "loadeddice" }), sv);
    expect(loadedSeed).toContain('<option value="" selected="">4–5 hits (random)</option><option value="4">4 hits</option><option value="5">5 hits</option></select>');
  });

  it("keeps the random count implicit and an exact count chosen", () => {
    const selects = vi.spyOn(selectControl, "default");
    try {
      const onContextChange = vi.fn();
      details(randomSeed, "bulletseed", breloom, sv, { hits: 3, useZ: false }, onContextChange);
      const [select] = selects.mock.calls[0];
      select.onChange!({ target: { value: "" } } as ChangeEvent<HTMLSelectElement>);
      select.onChange!({ target: { value: "5" } } as ChangeEvent<HTMLSelectElement>);
      expect(onContextChange.mock.calls).toEqual([[{ hits: undefined, useZ: false }], [{ hits: 5, useZ: false }]]);
    } finally {
      selects.mockRestore();
    }
  });

  it("keeps a stale count selected and marked", () => {
    const stale = { ...staleSeed, reason: "Needs the hit count (4–5)." };
    const html = details(stale, "bulletseed", build("breloom", "technician", sv, { itemId: "loadeddice" }), sv, { hits: 2 });
    expect(html).toContain('<option value="">4–5 hits (random)</option><option value="2" disabled="" selected="">2 hits — choose again</option>');
    expect(text(html)).toContain("Needs the hit count (4–5).");
    expect(html).toContain("No damage rolls available.");
  });

  it("lists each count's chance and damage, then the rolls per hit", () => {
    const seed = text(details(randomSeed, "bulletseed", breloom, sv));
    expect(seed).toContain("2 hits (35%): 56–68 HP 3 hits (35%): 84–102 HP 4 hits (15%): 112–136 HP 5 hits (15%): 140–170 HP");
    expect(seed).toContain(`Hits 1–5, each: ${SEED_HIT.join(", ")}`);
    expect(seed).toContain("Bullet Seed: 2–5 hits (2 and 3: 35% each, 4 and 5: 15% each).");
    expect(seed).not.toContain("Group");
    const random = text(details(randomCutBomb, "populationbomb", build("maushold", "technician", sv, { itemId: "loadeddice" }), sv));
    expect(random).toContain("4 hits (14.29%): 60–72 HP");
    expect(random).toContain("8 hits (14.29%): 120–144 HP 9 hits (28.57%): 135–162 HP");
    expect(random).not.toMatch(/10 hits \(\d/);
    expect(random).toContain(`Hits 1–9, each: ${BOMB_HIT.join(", ")}`);
    expect(random).toContain("Maushold faints on hit 9 of 10 (Rough Skin).");
  });

  it("shows the hit it is cut short on and only the hits that land", () => {
    const html = details(cutBomb, "populationbomb", maushold, championsRuntime);
    const visible = text(html);
    expect(visible).toContain("· Hits: 9 of 10");
    expect(visible).toContain(`Hits 1–9, each: ${BOMB_HIT.join(", ")}`);
    expect(visible).not.toMatch(/\d+ hits \(\d/);
    expect(visible).toContain("Maushold faints on hit 9 of 10 (Rough Skin).");
    // Every hit landing stays the default for a move that checks accuracy for each hit.
    expect(html).toMatch(/<option value="10" selected="">10 hits \(all\)<\/option>/);
    expect(html).not.toContain("(random)");
  });

  it("gives hits with different rolls their own lines and wraps them at phone width", () => {
    const parental = { ...cutBomb, attackerFaintsOnHit: undefined, hits: 2, rolls: [SEED_HIT, SEED_HIT.map((roll) => Math.floor(roll / 4))] };
    const html = details(parental, "populationbomb", maushold, championsRuntime);
    expect(text(html)).toContain(`Hit 1: ${SEED_HIT.join(", ")} Hit 2: ${SEED_HIT.map((roll) => Math.floor(roll / 4)).join(", ")}`);
    const lines = [...html.matchAll(/<li class="([^"]*)">Hits? \d/g)].map(([, classes]) => classes);
    expect(lines).toHaveLength(2);
    for (const classes of lines) expect(classes).toContain("wrap-anywhere");
  });
});

describe("selected-move summary for random and cut-short hit counts", () => {
  it("states the hit range beside the damage range and never asks for hits", () => {
    const seed = text(summary(sv, breloom, "bulletseed", randomSeed));
    expect(seed).toContain("56–170 damage range, 2–5 hits · One-use KO: Not estimated (all rolls)");
    expect(seed).toContain("Show move");
    expect(seed).not.toContain("Set hits");
    expect(seed).not.toContain("HP remaining:");
    const bomb = text(summary(championsRuntime, maushold, "populationbomb", cutBomb));
    expect(bomb).toContain("135–162 damage range, 9 of 10 hits · One-use KO: Not estimated");
    expect(bomb).not.toContain("Set hits");
  });

  it("names a chosen count", () => {
    const chosen = { ...randomSeed, hitChances: undefined, hits: 3, rolls: [SEED_HIT, SEED_HIT, SEED_HIT], min: 84, max: 102, assumptions: [] };
    expect(text(summary(sv, breloom, "bulletseed", chosen, { hits: 3 }))).toContain("84–102 damage range, 3 hits · One-use KO");
    expect(text(summary(sv, breloom, "bulletseed", chosen))).toContain("84–102 damage range · One-use KO");
  });

  it("asks for hits for a stale chosen count only", () => {
    expect(summary(sv, breloom, "bulletseed", staleSeed, { hits: 7 })).toContain(">Set hits</button>");
    expect(summary(sv, breloom, "bulletseed", staleSeed)).not.toContain(">Set hits</button>");
  });

  it("keeps the HP preview unavailable for multi-hit rows without afterUse", () => {
    const garchomp = build("garchomp", "roughskin", sv);
    for (const row of [randomSeed, cutBomb, randomCutBomb]) expect(previewRemainingHP(garchomp, row, "average", sv).status).toBe("unavailable");
  });
});

describe("damage order for random hit counts", () => {
  /** A one-hit row with 16 rolls from min to max. */
  const single = (moveId: string, min: number, max: number): MoveDamageResult => ({
    moveId, kind: "calculated", min, max, minPercent: 0, maxPercent: 0, rolls: Array.from({ length: 16 }, (_, index) => Math.floor(min + (max - min) * index / 15)),
    ohkoChance: 0, description: "", assumptions: [], reason: null, hits: 1,
  });

  it("ranks a random count by its expected damage over the counts, not its fewest or most hits", () => {
    // Bullet Seed's expected hits: 0.35 × 2 + 0.35 × 3 + 0.15 × 4 + 0.15 × 5 = 3.1, so 86.8 HP at its lowest rolls and 105.4 at its highest.
    const below = single("seedbomb", 80, 120);
    const above = single("leafblade", 90, 100);
    const order = (sort: "minimum" | "maximum", rows: MoveDamageResult[]) => rankResults(rows, sort, sv).map((row) => row.moveId);
    // By its fewest hits (56) Bullet Seed would rank last, by its most (170) first.
    expect(order("minimum", [below, randomSeed, above])).toEqual(["leafblade", "bulletseed", "seedbomb"]);
    expect(order("maximum", [below, randomSeed, above])).toEqual(["seedbomb", "bulletseed", "leafblade"]);
    // The 4–9 hits of the cut-short Loaded Dice row: (4 + 5 + 6 + 7 + 8) / 7 + 9 × 2/7 = 6.86 hits, so 102.9 HP at 15 per hit and 123.4 at 18.
    expect(order("minimum", [single("a", 102, 130), randomCutBomb, single("b", 103, 104)])).toEqual(["b", "populationbomb", "a"]);
    expect(order("maximum", [single("a", 0, 123), randomCutBomb, single("b", 0, 124)])).toEqual(["b", "populationbomb", "a"]);
    // A fixed count, a cut-short one included, ranks by its own min and max.
    expect(order("minimum", [single("a", 134, 140), cutBomb, single("b", 136, 140)])).toEqual(["b", "populationbomb", "a"]);
  });

  it("orders the move list the same way", () => {
    const below = single("seedbomb", 80, 120);
    const above = single("leafblade", 90, 100);
    const html = list([below, randomSeed, above], breloom, sv);
    const names = [...html.matchAll(/aria-label="Select ([^"]+?) to preview HP"/g)].map(([, name]) => name);
    expect(names).toEqual(["Leaf Blade", "Bullet Seed", "Seed Bomb"]);
  });
});

describe("rows from the calculation", () => {
  const real = (runtime: BattleRuntime, moveId: string, attacker: BattleBuild, defender: BattleBuild) => {
    const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles" }, {}, runtime);
    return out.results.find((row) => row.moveId === moveId)!;
  };

  it("shows Bullet Seed's random 2–5 hits everywhere", () => {
    const row = real(sv, "bulletseed", breloom, build("garchomp", "sandveil", sv));
    expect(row).toMatchObject({ kind: "calculated", min: 56, max: 170, hits: 5 });
    expect(text(list([row], breloom, sv))).toContain("56–170 HP · 2–5 hits");
    const shown = text(details(row, "bulletseed", breloom, sv));
    expect(shown).toContain("· Hits: 2–5");
    expect(shown).toContain("2 hits (35%): 56–68 HP 3 hits (35%): 84–102 HP 4 hits (15%): 112–136 HP 5 hits (15%): 140–170 HP");
    expect(shown).toContain(`Hits 1–5, each: ${SEED_HIT.join(", ")}`);
    const panel = text(summary(sv, breloom, "bulletseed", row));
    expect(panel).toContain("56–170 damage range, 2–5 hits");
    expect(panel).not.toContain("Set hits");
  });

  it.each(["champions", "scarlet_violet"] as const)("shows Maushold's Population Bomb into Rough Skin stopping at hit 9 of 10 (%s)", (game) => {
    const runtime = game === "champions" ? championsRuntime : sv;
    const attacker = build(game === "champions" ? "mausholdfour" : "maushold", "technician", runtime);
    const row = real(runtime, "populationbomb", attacker, build("garchomp", "roughskin", runtime));
    expect(row).toMatchObject({ kind: "calculated", min: 135, max: 162, hits: 9, attackerFaintsOnHit: { hit: 9, of: 10 } });
    const cell = text(list([row], attacker, runtime));
    expect(cell).toContain("135–162 HP · 9 of 10 hits");
    expect(cell).not.toContain("Set hits");
    const shown = text(details(row, "populationbomb", attacker, runtime));
    expect(shown).toContain("· Hits: 9 of 10");
    expect(shown).toContain(`Hits 1–9, each: ${BOMB_HIT.join(", ")}`);
    expect(shown).not.toContain("Hits 1–10");
    expect(text(summary(runtime, attacker, "populationbomb", row))).toContain("135–162 damage range, 9 of 10 hits");
  });

  it("states a faint that cuts every count short the same way on the card, the details and the assumption", () => {
    // Cinccino (Technician, Loaded Dice) at 40/150 into Rough Skin and Rocky Helmet: 18 + 25 on hit 1 (Showdown 22–27, 1 hit).
    const cinccino = build("cinccino", "technician", sv, { itemId: "loadeddice", currentHP: 40 });
    const row = real(sv, "tailslap", cinccino, build("garchomp", "roughskin", sv, { itemId: "rockyhelmet" }));
    expect(row).toMatchObject({ kind: "calculated", min: 22, max: 27, hits: 1, attackerFaintsOnHit: { hit: 1, of: 5, ofMin: 4 } });
    expect(row.assumptions).toContain("Cinccino faints on hit 1 of 4 or 5 (Rough Skin and Rocky Helmet).");
    expect(text(list([row], cinccino, sv))).toContain("22–27 HP · 1 of 4 or 5 hits");
    expect(text(details(row, "tailslap", cinccino, sv))).toContain("· Hits: 1 of 4 or 5");
  });

  it("offers the hit count the calculation used: a transformed Imposter user's copied Skill Link fixes it", () => {
    // Ditto (Imposter) into Skill Link Cinccino: Showdown's transformed Ditto hits 5 times (105–125).
    const ditto = build("ditto", "imposter", sv);
    const row = real(sv, "tailslap", ditto, build("cinccino", "skilllink", sv));
    expect(row).toMatchObject({ kind: "calculated", min: 105, max: 125, hits: 5, hitRule: { kind: "fixed", hits: 5 } });
    const html = details(row, "tailslap", ditto, sv);
    expect(html).not.toContain("<select");
    expect(html).not.toContain("(random)");
    expect(text(html)).toContain("Skill Link: 5 hits.");
    expect(text(list([row], ditto, sv))).not.toContain("hits ·");
  });

  it("states each chance at one precision: the range line, the rolls list and a faint's share of rolls", () => {
    const attacker = build("maushold", "technician", sv, { itemId: "loadeddice" });
    const row = real(sv, "populationbomb", attacker, build("garchomp", "sandveil", sv));
    const shown = text(details(row, "populationbomb", attacker, sv));
    expect(shown).toContain("Population Bomb: 4–10 hits (Loaded Dice, 14.29% each).");
    expect(shown).toContain("4 hits (14.29%): 60–72 HP");
    expect(shown).not.toMatch(/14\.3%/);
  });

  it("shows Loaded Dice Population Bomb's random 4–10 hits cut to 4–9 by Rough Skin", () => {
    const attacker = build("maushold", "technician", sv, { itemId: "loadeddice" });
    const row = real(sv, "populationbomb", attacker, build("garchomp", "roughskin", sv));
    expect(row).toMatchObject({ kind: "calculated", min: 60, max: 162, hits: 9 });
    expect(text(list([row], attacker, sv))).toContain("60–162 HP · 4–9 hits");
    const html = details(row, "populationbomb", attacker, sv);
    expect(html).toContain('<option value="" selected="">4–10 hits (random)</option>');
    expect(text(html)).toContain("· Hits: 4–9");
    expect(text(html)).toContain("4 hits (14.29%): 60–72 HP");
    expect(text(html)).toContain("9 hits (28.57%): 135–162 HP");
    expect(text(summary(sv, attacker, "populationbomb", row))).toContain("60–162 damage range, 4–9 hits");
  });
});
