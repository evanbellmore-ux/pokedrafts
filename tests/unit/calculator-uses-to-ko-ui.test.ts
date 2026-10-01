import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import MoveResults, { MoveDetails } from "@/app/(app)/calculator/MoveResults";
import { createMatchup, getAttackView, selectMatchupMove, updateMatchupBuild } from "@/app/(app)/calculator/roster-prep";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, type DamageSort } from "@/app/lib/battle/model";
import type { BattleBuild, MoveDamageResult, UsesToKO } from "@/app/lib/battle/types";

// MoveResults opens on the minimum-damage sort with no details open; a test can open it on another
// sort, or with one move's details open, and at the md breakpoint (the wide table).
const view = vi.hoisted(() => ({ wide: false, sort: undefined as string | undefined, expanded: undefined as string | undefined }));
vi.mock("@/app/(app)/leagues/[leagueId]/useMinWidthMd", () => ({ useMinWidthMd: () => view.wide }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => actual.useState(initial === "minimum" && view.sort ? view.sort
      : view.expanded && initial && typeof initial === "object" && "moveId" in initial ? { ...initial, moveId: view.expanded } : initial),
  };
});

const sv = await loadBattleRuntime("scarlet_violet");
const HP = 170;
type Counted = Extract<UsesToKO, { kind: "uses" }>;
const counted = (fields: Partial<Counted> = {}): Counted => ({ kind: "uses", guaranteed: 5, fewest: 5, limit: 16, limitReason: "pp", carried: [], notes: [], ...fields });
function row(moveId: string, min: number, max: number, ohkoChance: number, usesToKO: UsesToKO | undefined, extra: Partial<MoveDamageResult> = {}): MoveDamageResult {
  const rolls = min === max ? min : Array.from({ length: 16 }, (_, index) => Math.floor(min + (max - min) * index / 15));
  return { moveId, kind: "calculated", min, max, minPercent: min / HP * 100, maxPercent: max / HP * 100, rolls, ohkoChance, description: "", assumptions: [], reason: null, hits: 1, usesToKO, ...extra };
}
const uncalculated = (moveId: string, kind: MoveDamageResult["kind"], reason: string | null = null): MoveDamageResult => ({
  ...row(moveId, 0, 0, 0, undefined), kind, min: null, max: null, minPercent: null, maxPercent: null, rolls: null, ohkoChance: null, hits: null, reason,
});
/** Garchomp's moves into a 170 HP Incineroar, with hand-set counts in Uses to KO order. */
const ROWS: MoveDamageResult[] = [
  row("closecombat", 180, 213, 1, counted({ guaranteed: 1, fewest: 1 })),
  row("earthquake", 138, 164, 0.375, counted({ guaranteed: 2, fewest: 1, fasterChance: 0.375 })),
  row("stoneedge", 252, 300, 0, counted({ guaranteed: 2, fewest: 2, survival: "Focus Sash" }), { survival: "Focus Sash" }),
  row("thunderpunch", 34, 41, 0, counted({ fewest: 4, fasterChance: 0.0053253173828125, carried: ["The target eats its Sitrus Berry at half HP or less."], notes: ["Assumes the weather lasts through every use."] })),
  row("thunderfang", 34, 41, 0, counted({ fewest: 3, fasterChance: 0.0002 })),
  row("hyperbeam", 25, 30, 0, counted({ guaranteed: 7, fewest: 6, fasterChance: 0.004, turns: "Recharges after each use" })),
  row("explosion", 160, 190, 0.625, { kind: "single-use", reason: "The user faints", koChance: 0.625 }),
  row("steelbeam", 76, 91, 0, counted({ guaranteed: null, fewest: 2, limit: 2, limitReason: "self-cost" })),
  row("fireblast", 12, 14, 0, counted({ guaranteed: null, fewest: null, limit: 8, needed: 14 })),
  row("falseswipe", 39, 46, 0, { kind: "never", reason: "False Swipe leaves at least 1 HP" }, { leavesOneHP: true }),
  row("earthpower", 0, 0, 0, { kind: "no-damage" }),
  row("knockoff", 35, 42, 0, { kind: "not-estimated", reason: "The target is protecting" }),
  uncalculated("protect", "status"),
];

function moves(options: { wide?: boolean; sort?: DamageSort; expanded?: string; rows?: MoveDamageResult[]; blocked?: boolean } = {}) {
  Object.assign(view, { wide: options.wide ?? false, sort: options.sort, expanded: options.expanded });
  try {
    const rows = options.rows ?? ROWS;
    return renderToStaticMarkup(createElement(MoveResults, {
      rows, moveIds: rows.map((result) => result.moveId), ownerId: "0:0", sourcePosition: "left", selectedMoveId: "thunderpunch", onSelectMove: vi.fn(), contexts: {},
      onContextChange: vi.fn(), abilityId: "roughskin", itemId: "", attackerName: "Garchomp", defenderName: "Incineroar", defenderHP: HP, runtime: sv, blocked: options.blocked,
    }));
  } finally {
    Object.assign(view, { wide: false, sort: undefined, expanded: undefined });
  }
}
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/** What a sighted user reads (no sr-only text) and what a screen reader reads (no aria-hidden text). */
const visible = (html: string) => words(html.replace(/<span class="sr-only">[^<]*<\/span>/g, ""));
const spoken = (html: string) => words(html.replace(/<span aria-hidden="true">[^<]*<\/span>/g, ""));
const sortedHeaders = (html: string) => [...html.matchAll(/<th scope="col"[^>]*aria-sort="(\w+)"[^>]*>([^<]*)</g)].map(([, sort, name]) => `${name}: ${sort}`);
const order = (html: string) => [...html.matchAll(/id="[^"]*-(\w+)-select" type="radio"/g)].map(([, moveId]) => moveId);
const describedBy = (html: string, moveId: string) => html.match(new RegExp(`id="[^"]*-${moveId}-select"[^>]*aria-describedby="([^"]+)"`))![1].split(" ");

describe("Uses to KO in the move table", () => {
  it("adds the column after One-use KO, and the details row spans it", () => {
    const table = moves({ wide: true });
    expect(words(table)).toContain("Move Damage One-use KO Uses to KO Details Stone Edge");
    expect(visible(table)).toContain("Thunder Punch Selected Electric Physical 34–41 HP 20–24.12% of max HP 0% Guaranteed 5HKO 0.53% chance to 4HKO Details");
    expect(visible(table)).toContain("Explosion Normal Physical 160–190 HP 94.12–111.76% of max HP 62.5% One use only The user faints");
    expect(visible(table)).toContain("Guaranteed 7HKO 0.4% chance to 6HKO Recharges after each use");
    expect(visible(table)).toContain("2 uses at most Possible 2HKO with the best rolls Each use costs half its max HP");
    expect(visible(table)).toContain("Runs out of PP Needs 14 uses, has 8 PP");
    expect(visible(table)).toContain("Never KOs False Swipe leaves at least 1 HP");
    expect(visible(table)).toContain("No damage");
    expect(visible(table)).toContain("Not estimated The target is protecting");
    // 768px: a long reason wraps inside 12rem instead of widening the column into the move names.
    expect(table).toMatch(/-knockoff-uses" class="px-4 py-3 align-middle"><div class="max-w-48 tabular-nums">/);
    // A status row has no count and says so plainly, as One-use KO does.
    expect(table).toMatch(/Not estimated<\/td><td id="[^"]*-protect-uses" class="px-4 py-3 align-middle"><p class="text-muted">Not estimated<\/p><\/td>/);
    const open = moves({ wide: true, expanded: "thunderpunch" });
    expect(open).toContain('<td colSpan="5" class="p-4">');
    expect(open).not.toContain('colSpan="4"');
  });

  it("marks the sorted header under each sort", () => {
    expect(sortedHeaders(moves({ wide: true }))).toEqual(["Damage: descending"]);
    expect(sortedHeaders(moves({ wide: true, sort: "maximum" }))).toEqual(["Damage: descending"]);
    expect(sortedHeaders(moves({ wide: true, sort: "uses" }))).toEqual(["Uses to KO: ascending"]);
    expect(sortedHeaders(moves({ wide: true, sort: "name" }))).toEqual(["Move: ascending"]);
    // Paused calculations sort by name.
    expect(sortedHeaders(moves({ wide: true, sort: "uses", blocked: true }))).toEqual(["Move: ascending"]);
  });

  it("offers the sort and ranks by it", () => {
    const html = moves({ sort: "uses" });
    expect(html).toMatch(/<option value="maximum">Maximum damage \(high to low\)<\/option><option value="uses" selected="">Uses to KO \(fewest first\)<\/option><option value="name">/);
    expect(html).toContain("Showing 13 of 13 matching moves.</p>");
    expect(order(html)).toEqual(["closecombat", "earthquake", "stoneedge", "thunderpunch", "thunderfang", "hyperbeam", "explosion", "steelbeam", "fireblast", "falseswipe", "earthpower", "knockoff", "protect"]);
    const minimum = moves();
    expect(minimum).toContain("Showing 13 of 13 matching moves.</p>");
    expect(order(minimum).slice(0, 4)).toEqual(["stoneedge", "closecombat", "explosion", "earthquake"]);
    expect(moves({ blocked: true })).toContain('<option value="uses" disabled="">Uses to KO (fewest first)</option>');
  });

  it("describes the selection radio with the damage, One-use KO and Uses to KO cells", () => {
    const table = moves({ wide: true });
    const ids = new Set([...table.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id));
    const radio = describedBy(table, "thunderpunch");
    expect(radio.map((id) => id.replace(/^.*-thunderpunch-/, ""))).toEqual(["damage", "ko", "uses"]);
    for (const id of radio) expect(ids).toContain(id);
    // The card's block already holds both lines.
    expect(describedBy(moves(), "thunderpunch")).toEqual([expect.stringMatching(/-thunderpunch-damage$/)]);
  });

  it("reads the KO tokens as words", () => {
    const table = moves({ wide: true });
    const body = table.split("<details")[0];
    expect(spoken(body)).toContain("Guaranteed KO in 5 uses 0.53% chance to KO in 4 uses");
    expect(spoken(body)).toContain("Guaranteed KO in 2 uses Focus Sash stops a KO in 1 use");
    expect(spoken(body)).toContain("Guaranteed KO in 1 use");
    expect(spoken(body)).not.toMatch(/\dHKO|OHKO/);
    expect(body).toContain('<span aria-hidden="true">Guaranteed 5HKO</span><span class="sr-only">Guaranteed KO in 5 uses</span>');
    // Lines without the tokens are written once.
    expect(body).toContain('<p class="font-semibold text-text">One use only</p>');
  });

  it("adds a Uses to KO line to each card, inside its damage block", () => {
    const cards = moves();
    expect(visible(cards)).toContain("34–41 HP 20–24.12% of max HP One-use KO: 0% Uses to KO: Guaranteed 5HKO 0.53% chance to 4HKO Details");
    expect(visible(cards)).toContain("One-use KO: 62.5% Uses to KO: One use only The user faints");
    expect(visible(cards)).toContain("One-use KO: Not estimated Uses to KO: Not estimated");
    expect(spoken(cards)).toContain("Uses to KO: Guaranteed KO in 5 uses 0.53% chance to KO in 4 uses");
    // 375px: the block can shrink beside the Details button, and each line under the label is its own short line.
    expect(cards).toMatch(/<div id="[^"]*-thunderpunch-damage" class="min-w-0 text-sm">[\s\S]*?Uses to KO: <span class="font-semibold text-text"><span aria-hidden="true">Guaranteed 5HKO<\/span><span class="sr-only">Guaranteed KO in 5 uses<\/span><\/span><span class="block"><span aria-hidden="true">0.53% chance to 4HKO<\/span>/);
    for (const [, lines] of cards.matchAll(/<div id="[^"]*-damage" class="min-w-0 text-sm">([\s\S]*?)<\/div><button/g)) {
      for (const text of visible(lines.replace(/<(p|span class="block")(?=[\s>])[^>]*>/g, "|")).split("|")) expect(text.trim().length, text).toBeLessThanOrEqual(38);
    }
  });

  it("shows the chance with no guarantee, and the user fainting first, in the table and the cards", () => {
    const rows = [
      row("flareblitz", 60, 71, 0, counted({ guaranteed: null, fewest: 3, chance: 0.4, faintsFirst: true, attackerFaints: { lowest: 3, highest: 2 } })),
      row("dracometeor", 50, 59, 0, counted({ guaranteed: null, fewest: 7, chance: 0.3125, limit: 8, needed: 9 })),
      row("headsmash", 80, 95, 0, counted({ guaranteed: null, fewest: 2, faintsFirst: true, attackerFaints: { highest: 2 } })),
    ];
    const table = moves({ wide: true, rows });
    expect(visible(table)).toContain("No guaranteed KO 40% chance before the user faints High rolls: user faints after use 2 Details");
    expect(visible(table)).toContain("Runs out of PP 31.25% chance within 8 uses Needs 9 uses, has 8 PP Details");
    expect(visible(table)).toContain("No guaranteed KO Possible 2HKO with the best rolls High rolls: user faints after use 2 Details");
    expect(spoken(table.split("<details")[0])).toContain("No guaranteed KO Possible KO in 2 uses with the best rolls High rolls: user faints after use 2");
    const cards = moves({ rows });
    expect(visible(cards)).toContain("Uses to KO: No guaranteed KO 40% chance before the user faints High rolls: user faints after use 2 Details");
    expect(visible(cards)).toContain("Uses to KO: Runs out of PP 31.25% chance within 8 uses Needs 9 uses, has 8 PP Details");
    for (const [, lines] of cards.matchAll(/<div id="[^"]*-damage" class="min-w-0 text-sm">([\s\S]*?)<\/div><button/g)) {
      for (const text of visible(lines.replace(/<(p|span class="block")(?=[\s>])[^>]*>/g, "|")).split("|")) expect(text.trim().length, text).toBeLessThanOrEqual(38);
    }
  });

  // The calculation's numbers for real matchups, checked against pinned Showdown c23d2e94 battles (rolls 85 and 100) in
  // scripts/.cache/calc-audit/nhko/review/ui-docs/verify/f1-sash.ts, f2-2hko.ts, f3-eot.ts, f4-float.ts and f7-9-misc.ts.
  it("shows a 2HKO's own chance to OHKO, end-of-turn KOs, uncertain chances and no KO before the user faints", () => {
    const rows = [
      // SV Dragapult's Dragon Darts into Garchomp: 84+84 => 16 then 84 => 0 (85), 102+102 => 0 (100); 137 of 256 dart pairs knock out.
      row("dragondarts", 168, 204, 0, counted({ guaranteed: 2, fewest: 1, fasterChance: 137 / 256 }), { ohkoChance: null, hits: 2 }),
      // SV, Sand: Garchomp's Shadow Claw into Flutter Mane: 128 => 3, sand => 0 (85); 152 => 0 (100).
      row("shadowclaw", 128, 152, 0.875, counted({ guaranteed: 1, fewest: 1, limit: 24, endOfTurn: true })),
      // SV, Sand: Garchomp's Earthquake into Focus Sash Smeargle: 205 => 1, sand => 0 (85); 243 => 1, sand => 0 (100).
      row("earthquake", 205, 243, 0, counted({ guaranteed: 1, fewest: 1, survival: "Focus Sash", endOfTurn: true }), { survival: "Focus Sash" }),
      // SV Teddiursa's Low Kick into Slowking-Galar: 2 HP left after use 24 on the lowest rolls (85).
      row("lowkick", 7, 9, 0, counted({ guaranteed: 25, fewest: 19, fasterChance: 1.0000000000000004, limit: 32 })),
      // Champions Alcremie's Facade into Rocky Helmet Stunfisk: Alcremie faints after use 7 on both roll paths, with Stunfisk in.
      row("facade", 21, 25, 0, counted({ guaranteed: null, fewest: null, faintsFirst: true, limit: 20, attackerFaints: { lowest: 7, highest: 7 } })),
      // Champions, Sand: Gourgeist's Explosion into Castform: 136 => 9, sand => 0 (100); 115 => 30, sand => 21 (85).
      row("explosion", 115, 136, 0, { kind: "single-use", reason: "The user faints", koChance: 0.0625 }),
    ];
    const table = moves({ wide: true, rows });
    expect(visible(table)).toContain("Dragon Darts Dragon Physical 168–204 HP 98.82–120% of max HP Not estimated Guaranteed 2HKO 53.52% chance to OHKO Details");
    expect(visible(table)).toContain("87.5% Guaranteed OHKO Counts end-of-turn damage Details");
    expect(visible(table)).toContain("0% Guaranteed OHKO Counts end-of-turn damage Details");
    expect(visible(table)).not.toContain("Focus Sash stops the OHKO");
    expect(visible(table)).toContain("Guaranteed 25HKO &gt;99.99% chance to 24HKO Details");
    expect(visible(table)).toContain("No KO before user faints The user faints after use 7 Details");
    expect(visible(table)).toContain("0% One use only The user faints 6.25% chance to OHKO Details");
    expect(visible(table.split("<details")[0])).not.toMatch(/\b100%/);
    expect(spoken(table.split("<details")[0])).toContain("Guaranteed KO in 2 uses 53.52% chance to KO in 1 use");
    expect(spoken(table.split("<details")[0])).toContain("Guaranteed KO in 25 uses &gt;99.99% chance to KO in 24 uses");
    const cards = moves({ rows });
    expect(visible(cards)).toContain("One-use KO: Not estimated Uses to KO: Guaranteed 2HKO 53.52% chance to OHKO Details");
    expect(visible(cards)).toContain("One-use KO: 87.5% Uses to KO: Guaranteed OHKO Counts end-of-turn damage Details");
    expect(visible(cards)).toContain("One-use KO: 0% Uses to KO: No KO before user faints The user faints after use 7 Details");
    for (const [, lines] of cards.matchAll(/<div id="[^"]*-damage" class="min-w-0 text-sm">([\s\S]*?)<\/div><button/g)) {
      for (const text of visible(lines.replace(/<(p|span class="block")(?=[\s>])[^>]*>/g, "|")).split("|")) expect(text.trim().length, text).toBeLessThanOrEqual(38);
    }
  });

  it("renders the calculation's own rows", () => {
    const garchomp = createBuild("garchomp", sv), incineroar = { ...createBuild("incineroar", sv), currentHP: 160 } as BattleBuild;
    const { results } = calculateMatchup(garchomp, incineroar, { ...createConditions(), gameType: "Singles" }, {}, sv);
    for (const wide of [true, false]) {
      const html = moves({ wide, rows: results });
      expect(order(html).length).toBe(Math.min(30, results.length));
      expect([...html.matchAll(/id="[^"]*-uses"|Uses to KO: /g)].length).toBe(Math.min(30, results.length));
    }
  });
});

describe("Uses to KO in the move details", () => {
  const details = (result: MoveDamageResult | undefined, moveId = result?.moveId ?? "thunderpunch") => renderToStaticMarkup(createElement(MoveDetails, {
    moveId, row: result, id: "details", context: {}, abilityId: "", itemId: "", onContextChange: vi.fn(), runtime: sv,
  }));

  it("lists every line in words, what the count carries and what it leaves out", () => {
    const html = visible(details(ROWS[3]));
    expect(html).toContain("Uses to KO Guaranteed KO in 5 uses. 0.53% chance to KO in 4 uses.");
    expect(html).toContain("Carried into later uses The target eats its Sitrus Berry at half HP or less.");
    expect(html).toContain("Left out of the count Assumes the weather lasts through every use.");
    expect(visible(details(ROWS[4]))).toContain("Guaranteed KO in 5 uses. 0.02% chance to KO in 4 uses. The best rolls KO in 3 uses.");
    expect(visible(details(ROWS[4]))).not.toContain("Carried into later uses");
    expect(visible(details(ROWS[6]))).toContain("Uses to KO One use only. The user faints.");
  });

  it("explains a chance with no guarantee, and why the user fainting first leaves none", () => {
    const recoil = row("flareblitz", 60, 71, 0, counted({ guaranteed: null, fewest: 3, chance: 0.4, faintsFirst: true, attackerFaints: { lowest: 3, highest: 2 } }));
    expect(visible(details(recoil))).toContain("Uses to KO No guaranteed KO. 40% chance before the user faints. High rolls: user faints after use 2. Low rolls: user faints after use 3."
      + " The best rolls KO in 3 uses. A roll sequence where the user faints first never knocks out, so no count is guaranteed."
      + " The chance is that the target is out within 16 uses, before the user faints.");
    const fallback = row("flareblitz", 60, 71, 0, counted({ guaranteed: null, fewest: 3, faintsFirst: true, attackerFaints: { highest: 3 } }));
    expect(visible(details(fallback))).toContain("Uses to KO No guaranteed KO. Possible KO in 3 uses with the best rolls. High rolls: user faints after use 3."
      + " A roll sequence where the user faints first never knocks out, so no count is guaranteed.");
    const pp = row("dracometeor", 50, 59, 0, counted({ guaranteed: null, fewest: 7, chance: 0.3125, limit: 8, needed: 9 }));
    expect(visible(details(pp))).toContain("Uses to KO Runs out of PP. 31.25% chance within 8 uses. Needs 9 uses, has 8 PP. The best rolls KO in 7 uses.");
    expect(visible(details(pp))).not.toContain("faints first");
  });

  it("words the new lines in the move details", () => {
    // SV, Sand: Stomping Tantrum into Flutter Mane: only the highest roll (123 => 8, sand => 0) knocks out on the first turn.
    const tantrum = row("stompingtantrum", 103, 123, 0, counted({ guaranteed: 2, fewest: 1, fasterChance: 0.0625, endOfTurn: true }));
    expect(visible(details(tantrum))).toContain("Uses to KO Guaranteed KO in 2 uses. 6.25% chance to KO in 1 use. Counts end-of-turn damage.");
    // Champions Hard Press into Vanilluxe at 60 HP: the lowest and highest roll paths only (KO in 4 and in 3).
    const hardPress = row("hardpress", 32, 42, 0, counted({ guaranteed: 4, fewest: 3, limit: 12,
      notes: ["There are too many roll sequences to count exactly, so these counts take the lowest and the highest roll on every use, with no chance."] }));
    expect(visible(details(hardPress))).toContain("Uses to KO Guaranteed KO in 4 uses. Possible KO in 3 uses with the best rolls.");
    expect(visible(details(hardPress))).not.toContain("The best rolls KO");
    const facade = row("facade", 21, 25, 0, counted({ guaranteed: null, fewest: null, faintsFirst: true, limit: 20, attackerFaints: { lowest: 7, highest: 7 } }));
    expect(visible(details(facade))).toContain("Uses to KO No KO before user faints. The user faints after use 7.");
    expect(visible(details(facade))).not.toContain("No guaranteed KO");
    const explosion = row("explosion", 115, 136, 0, { kind: "single-use", reason: "The user faints", koChance: 0.0625 });
    expect(visible(details(explosion))).toContain("Uses to KO One use only. The user faints. 6.25% chance to KO in 1 use. Counts end-of-turn damage.");
  });

  it("has no Uses to KO section without a count", () => {
    expect(details(ROWS[12])).not.toContain("Uses to KO");
    expect(details(undefined)).not.toContain("Uses to KO");
    expect(details(row("thunderpunch", 34, 41, 0, undefined))).not.toContain("Uses to KO");
  });
});

describe("Uses to KO in the summary", () => {
  function summary(selected: MoveDamageResult | undefined, blockedReason?: string) {
    let matchup = createMatchup(0, sv);
    matchup = updateMatchupBuild(matchup, "attacker", createBuild("garchomp", sv));
    matchup = updateMatchupBuild(matchup, "defender", { ...createBuild("incineroar", sv), currentHP: 160 } as BattleBuild);
    matchup = selectMatchupMove(matchup, "thunderfang");
    const attack = getAttackView(matchup);
    return renderToStaticMarkup(createElement(MatchupSummary, {
      attacker: matchup.attacker, defender: matchup.defender, attack: matchup.attack, replacement: matchup.replacement,
      resultIdentity: { source: attack.owner, receiver: attack.receiverOwner }, selectedRow: selected, rollMode: "low", blockedReason,
      issues: { attacker: [], defender: [] }, movesControl: "moves", onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onShowMove: vi.fn(),
      onRollModeChange: vi.fn(), onActivateMove: vi.fn(), onToggleMega: vi.fn(), runtime: sv,
    }));
  }
  const thunderFang = row("thunderfang", 34, 41, 0, counted({ fewest: 4, fasterChance: 0.0053253173828125 }));

  it("adds a line under the damage range, inside the announced result", () => {
    const html = summary(thunderFang);
    expect(visible(html)).toContain("34–41 damage range · One-use KO: 0% (all rolls) Uses to KO: Guaranteed 5HKO · 0.53% chance to 4HKO Right Pokémon HP remaining");
    expect(spoken(html)).toContain("Uses to KO: Guaranteed KO in 5 uses · 0.53% chance to KO in 4 uses");
    const live = html.match(/aria-live="polite"[^>]*>([\s\S]*?)<\/div><button/)![1];
    expect(live).toContain("Uses to KO: ");
    expect(visible(summary({ ...thunderFang, usesToKO: undefined }))).toContain("Uses to KO: Not estimated Right Pokémon");
    expect(summary(thunderFang, "Loading the calculator.")).not.toContain("Uses to KO:");
    expect(summary(undefined)).not.toContain("Uses to KO:");
  });

  it("gives the summary the same lines for a chance with no guarantee", () => {
    const recoil = row("thunderfang", 34, 41, 0, counted({ guaranteed: null, fewest: 5, chance: 0.4, faintsFirst: true, attackerFaints: { highest: 4 } }));
    expect(visible(summary(recoil))).toContain("Uses to KO: No guaranteed KO · 40% chance before the user faints · High rolls: user faints after use 4 Right Pokémon HP remaining");
    const pp = row("thunderfang", 34, 41, 0, counted({ guaranteed: null, fewest: 7, chance: 0.3125, limit: 8, needed: 9 }));
    expect(visible(summary(pp))).toContain("Uses to KO: Runs out of PP · 31.25% chance within 8 uses · Needs 9 uses, has 8 PP Right Pokémon HP remaining");
  });
});
