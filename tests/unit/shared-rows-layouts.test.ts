import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import BattleConditions from "@/app/(app)/calculator/BattleConditions";
import { BUILD_ROWS, buildRows } from "@/app/(app)/calculator/BuildSettings";
import { RosterPicker, railRows } from "@/app/(app)/calculator/LeagueMatchupPicker";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import styles from "@/app/(app)/calculator/calculator.module.css";
import SwapDialog from "@/app/(app)/leagues/[leagueId]/free-agents/SwapDialog";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { createBattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, NativeCatalog } from "@/app/lib/battle/types";
import type { DraftPokemon } from "@/app/types/draft";
import type { RosterPokemon } from "@/app/types/league";
import svCatalog from "@/data/battle/scarlet_violet/catalog.json";
import { childAttributes, childClasses, cssBlock, declarations, SUMMARY_CARD_ROWS } from "../fixtures/shared-rows";

// Two-sided menus whose sides sit side by side share one set of rows (subgrid), so each part sits level with the other
// side's part in the same row: the calculator's desktop roster rails, 1v1 summary cards, 1v1 Build settings and Field
// conditions' sides, and the free-agent swap dialog's Drop and Add cards. (Training setup's team panels:
// training-setup-rows.test.ts; a busy 2v2 Bench in Field conditions: calculator-doubles-bench.test.ts.)

const css = readFileSync(join(__dirname, "..", "..", "app", "(app)", "calculator", "calculator.module.css"), "utf8");

describe("the calculator's desktop roster rails", () => {
  it("share their rows; the calculator spans them and a flexible last row, so it never stretches a rail row", () => {
    expect(declarations(css, ".withRosters")).toMatchObject({
      display: "grid", "grid-template-columns": "12rem minmax(0, 1fr) 12rem", "grid-template-rows": "repeat(var(--rail-rows), auto) 1fr",
      "align-items": "start", "column-gap": "1rem",
    });
    expect(declarations(css, ".withRosters > .center")).toEqual({ "grid-column": "2", "grid-row": "1 / -1" });
    expect(declarations(css, ".withRosters > .rail")).toEqual({ display: "grid", "grid-row": "1 / -2", "grid-template-rows": "subgrid" });
    expect([".attackerRoster", ".defenderRoster"].map((selector) => declarations(css, selector)["grid-column"])).toEqual(["1", "3"]);
    expect(declarations(css, ".rail > [data-calculator-roster]")).toEqual({ display: "grid", "grid-row": "1 / -1", "grid-template-rows": "subgrid" });
  });

  it("place each roster part in its row: railRows' three fixed rows around one row per choice of the longer roster", () => {
    const row = (part: string) => declarations(css, `.rail [data-roster-row="${part}"]`)["grid-row"];
    expect(["header", "message", "list", "end"].map(row)).toEqual(["1", "2", "3 / -2", "-2"]);
    expect(declarations(css, '.rail [data-roster-row="list"]')).toMatchObject({ display: "grid", "grid-template-rows": "subgrid", "row-gap": "0" });
    expect(declarations(css, '.rail [data-roster-row="list"] > * + *')).toEqual({ "margin-block-start": "0.5rem" });
    const choices = (count: number) => ({ choices: Array(count) });
    expect(railRows([choices(2), choices(5)])).toBe(3 + 5);
    expect(railRows([choices(4), choices(0)])).toBe(3 + 4);
    expect(railRows([choices(0), choices(0)])).toBe(3 + 1);
  });
});

describe("the calculator's 1v1 summary cards", () => {
  it("share their rows at every width, one per part, the first and last holding the cards' padding", () => {
    // At the top level, not inside a media or container query: every block opened before it is closed.
    const before = css.slice(0, css.indexOf(".summaryCard {"));
    expect(before.split("{").length).toBe(before.split("}").length);
    expect(declarations(css, ".summaryCard")).toEqual({
      display: "grid", "grid-row": `span ${SUMMARY_CARD_ROWS.length}`, "grid-template-rows": "subgrid", "grid-template-columns": "minmax(0, 1fr)",
    });
    expect(SUMMARY_CARD_ROWS.map((name) => declarations(css, `.${name}`)["grid-row"])).toEqual(SUMMARY_CARD_ROWS.map((_, index) => String(index + 1)));
  });
});

const classesOf = (attributes: string) => /\bclass="([^"]*)"/.exec(attributes)?.[1].split(/\s+/) ?? [];

describe("the calculator's 1v1 Build settings", () => {
  const wide = cssBlock(css, "@container calculator (min-width: 44rem)");
  const row = (selector: string) => declarations(wide, selector)["grid-row"];
  /** PokemonPanel's parts by the shared-row class each carries, first to last ("roster": the RosterPicker passed in, which has none). */
  const EDITOR_ROWS = ["editorSpecies", "editorGame", "roster", "editorFields", "editorRoomItem", "editorFieldItem", "editorRequired", "editorAbility",
    "editorIntimidate", "editorMechanic", "editorStats", "editorExtra"] as const;
  const STATS_ROWS = ["editorStatsHeading", "editorInnate", "editorTable", "editorStatIssues"] as const;
  const rowOf = (attributes: string) => attributes.includes("data-calculator-roster") ? "roster"
    : EDITOR_ROWS.find((name) => name !== "roster" && classesOf(attributes).includes(styles[name])) ?? null;

  it("share their rows only side by side, from the calculator's 44rem; below, the editors stack as before", () => {
    const at = css.indexOf("@container calculator (min-width: 44rem)");
    expect(css.slice(0, at)).not.toMatch(/buildSection|--build-rows/);
    expect(css.slice(css.indexOf("{", at) + 1 + wide.length)).not.toMatch(/\.buildSection|\.editor[A-Z]/);
    expect(declarations(wide, ".settings")).toEqual({ "grid-template-columns": "repeat(2, minmax(0, 1fr))", "grid-template-rows": "repeat(var(--build-rows), auto) auto" });
    expect(declarations(wide, ".buildSection")).toEqual({ display: "grid", "grid-row": "1 / -2", "grid-template-rows": "subgrid", "grid-template-columns": "minmax(0, 1fr)" });
    expect(row(".settings > .fieldSection")).toBe("-2");
    for (const nested of [".buildSection > [data-build-region]:not([hidden])", ".buildSection .editor", ".buildSection .editor > [data-calculator-roster]", '.buildSection [data-roster-row="list"]', ".buildSection .editorStats"]) {
      expect(declarations(wide, nested)).toMatchObject({ "grid-template-rows": "subgrid" });
    }
    // Margins instead of row gaps, so a row neither side uses stays 0 tall: the editor's 0.75rem, the choices' 0.5rem.
    expect(declarations(wide, ".buildSection .editor")["row-gap"]).toBe("0");
    expect(declarations(wide, ".buildSection .editor > *")).toEqual({ "align-self": "start", "margin-block-end": "0.75rem" });
    expect(declarations(wide, ".buildSection .editorStats")["margin-block-end"]).toBe("0");
    expect(declarations(wide, ".buildSection .editorExtra")["margin-block"]).toBe("0.75rem 0");
    expect(declarations(wide, '.buildSection [data-roster-row="list"]')["row-gap"]).toBe("0");
    expect(declarations(wide, '.buildSection [data-roster-row="list"] > :nth-child(n + 3)')).toEqual({ "margin-block-start": "0.5rem" });
    // The padded edges each hold an empty item, so PokemonPanel and RosterPicker keep their markup: the region's first row, the roster's last.
    expect(declarations(wide, ".buildSection > [data-build-region]::before")).toEqual({ content: '""', "grid-row": "1" });
    expect(declarations(wide, ".buildSection .editor > [data-calculator-roster]::after")).toEqual({ content: '""', "grid-row": "-2" });
  });

  it("places each part in its row: BUILD_ROWS fixed rows around one per two choices of the longer roster", () => {
    expect([".buildSection > [data-build-toggle]", ".buildSection > [data-build-region]:not([hidden])", ".buildSection .editor"].map(row)).toEqual(["1", "2 / -1", "2 / -1"]);
    // The editor's rows: the error lines, the roster, then the rest of its parts down to the last row.
    const editorRows = EDITOR_ROWS.map((name) => row(name === "roster" ? ".buildSection .editor > [data-calculator-roster]" : `.buildSection .${name}`));
    expect(editorRows).toEqual(["1", "2", "3 / -13", "-13", "-12", "-11", "-10", "-9", "-8", "-7", "-6 / -2", "-2"]);
    expect(STATS_ROWS.map((name) => row(`.buildSection .${name}`))).toEqual(["1", "2", "3", "4"]);
    expect(["header", "message", "list"].map((part) => row(`.buildSection [data-roster-row="${part}"]`))).toEqual(["1", "2", "3 / -2"]);
    // The button and the region's edge, the error lines and the roster's heading and message before the choices; the
    // roster's end and the rest of the editor after them.
    const [rosterStart, rosterEnd] = row(".buildSection .editor > [data-calculator-roster]").split(" / ").map(Number);
    const [listStart, listEnd] = row('.buildSection [data-roster-row="list"]').split(" / ").map(Number);
    expect(2 + (rosterStart - 1) + (listStart - 1) + (-listEnd - 1) + (-rosterEnd - 1)).toBe(BUILD_ROWS);
    const choices = (count: number) => ({ choices: Array(count) });
    expect(buildRows([choices(10), choices(3)])).toBe(BUILD_ROWS + 5);
    expect(buildRows([choices(0), choices(1)])).toBe(BUILD_ROWS + 1);
    // No inline roster (the desktop rails have them): one empty row for the choices.
    expect(buildRows([])).toBe(BUILD_ROWS + 1);
  });

  it("gives each part of the editor its row class, in row order", () => {
    const sv = createBattleRuntime(svCatalog as NativeCatalog, "3".repeat(64));
    const native = createBuild("charizard", sv);
    if (native.game === "champions") throw new Error("A native build");
    const editor = (build: BattleBuild, props: Partial<ComponentProps<typeof PokemonPanel>> = {}) => renderToStaticMarkup(createElement(PokemonPanel, {
      side: "attacker", build, onChange: vi.fn(), hpInput: "", onHPChange: vi.fn(), runtime: sv,
      issues: ["speciesId", "game", "preparedMoves", "mechanic", "native.evs.atk"].map((field) => ({ field, message: `Check ${field}.` })),
      roster: createElement(RosterPicker, { role: "own", side: "attacker", occupant: "Charizard", activeSource: null, onSelect: vi.fn() }), ...props,
    }));
    const rows = (html: string) => childAttributes(html, "data-calculator-build-settings").map(rowOf);
    const plus = editor({ ...native, abilityId: "plus", abilityActive: false, native: { ...native.native, innateIVs: { ...native.native.ivs } } }, {
      roomItemChoice: "roomservice", fieldItemChoice: { itemId: "boosterenergy", abilityId: "protosynthesis", field: "sun", checked: false },
      requiredMove: { name: "Secret Sword", slots: ["Flamethrower"], onEquip: vi.fn() },
    });
    expect(rows(plus)).toEqual(EDITOR_ROWS.filter((name) => name !== "editorIntimidate"));
    expect(childClasses(plus, `class="${styles.editorStats} `).map((classes) => STATS_ROWS.find((name) => classes.includes(styles[name])))).toEqual(STATS_ROWS);
    const intimidate = editor({ ...native, abilityId: "intimidate" }, { onApplyIntimidate: vi.fn() });
    expect(rows(intimidate)).toEqual(["editorSpecies", "editorGame", "roster", "editorFields", "editorRequired", "editorIntimidate", "editorMechanic", "editorStats", "editorExtra"]);
  });
});

describe("the calculator's Field conditions sides", () => {
  const wide = cssBlock(css, "@container calculator (min-width: 36rem)");
  const row = (selector: string) => declarations(wide, selector)["grid-row"];
  /** A grid-row value's first row and how many it spans ("5 / span 11" → [5, 11]). */
  const span = (value: string): [number, number] => [Number(value.split(" / ")[0]), Number(value.split(" / span ")[1] ?? 1)];

  it("share their rows from the calculator's 36rem; below, the sides stack as before, each name on its box's top border", () => {
    const narrow = css.slice(0, css.indexOf("@container calculator (min-width: 36rem)"));
    expect(declarations(narrow, ".fieldSides")).toEqual({ display: "grid", gap: "0.75rem" });
    // As a legend: half the name's 1rem line above the box, its middle on the 1px border.
    expect(declarations(narrow, ".fieldSide")).toEqual({ "margin-block-start": "calc(0.5rem - 0.5px)" });
    expect(declarations(narrow, ".fieldSideName")).toEqual({ "margin-block-start": "calc(-0.5rem - 0.5px)" });
    expect(declarations(wide, ".fieldSides")).toEqual({ "grid-template-columns": "repeat(2, minmax(0, 1fr))", "grid-template-rows": "repeat(22, auto)", "row-gap": "0" });
    expect(declarations(wide, ".fieldSide")).toEqual({ display: "grid", "grid-row": "1 / -1", "grid-template-rows": "subgrid", "grid-template-columns": "minmax(0, 1fr)" });
    // The parts with parts of their own share the side's rows too: its conditions from earlier turns, the bench's wrapper,
    // each Pokémon's group, the Bench, its list of Pokémon and Hazards.
    const nested = /\.fieldSide > :is\(\[data-doubles-side-earlier\], \[data-doubles-bench\], \[data-doubles-carried\]\),\s+\.fieldSide :is\(\.bench, \.benchRows, \[data-doubles-hazards\]\) \{([^}]*)\}/.exec(wide);
    expect(nested?.[1].replace(/\s+/g, " ").trim()).toBe("display: grid; grid-template-rows: subgrid; grid-template-columns: minmax(0, 1fr);");
    // The box's bottom padding lands on an empty last item.
    expect(declarations(wide, ".fieldSide::after")).toEqual({ content: '""', "grid-row": "-2" });
  });

  it("places each part in its row: 21 rows of parts, then the end", () => {
    // The side's parts, first to last and back to back: its name, toggles, conditions from earlier turns, Bench with
    // Hazards, then the left Pokémon's group and the right one's.
    const parts = [".fieldSideName", ".fieldSide > .sideToggles", ".fieldSide > [data-doubles-side-earlier]", ".fieldSide > [data-doubles-bench]",
      '.fieldSide > [data-doubles-carried$="-left"]', '.fieldSide > [data-doubles-carried$="-right"]'].map((selector) => span(row(selector)));
    expect(parts).toEqual([[1, 1], [2, 1], [3, 2], [5, 11], [16, 3], [19, 3]]);
    expect(parts.reduce((next, [start, count]) => start === next ? next + count : NaN, 1)).toBe(22);
    // In the bench's rows: the Bench's heading, Add to bench, full note, issue and four bench Pokémon; Hazards' three.
    expect([".fieldSide .bench", ".fieldSide [data-doubles-hazards]"].map(row)).toEqual(["1 / span 8", "9 / span 3"]);
    expect([".fieldSide .benchAdd", ".fieldSide .benchFull", ".fieldSide .benchIssue", ".fieldSide .benchRows"].map(row)).toEqual(["2", "3", "4", "5 / span 4"]);
    // Every group's heading, checkboxes and counts; the side's own conditions from earlier turns have no heading.
    expect([".sideHeading", ".sideChecks", ".sideInputs"].map((name) => row(`.fieldSide [role="group"] > ${name}`))).toEqual(["1", "2", "3"]);
    expect([".sideChecks", ".sideInputs"].map((name) => row(`.fieldSide [data-doubles-side-earlier] > ${name}`))).toEqual(["1", "2"]);
  });

  it("makes each side a group named by its first line, drawn as a legend, with its toggles in the next row", () => {
    const conditions = (props: Partial<ComponentProps<typeof BattleConditions>> = {}) => renderToStaticMarkup(createElement(BattleConditions, {
      value: createConditions(), issues: [], onChange: vi.fn(), names: { attackerSide: "Charizard", defenderSide: "Blastoise" }, ...props,
    }));
    for (const html of [conditions(), conditions({ variant: "doubles", sideLegends: { attackerSide: "Your side", defenderSide: "Opponent's side" } })]) {
      const sides = [...html.matchAll(/<div role="group" aria-labelledby="([^"]+)" class="([^"]*)"><p id="\1" class="([^"]*)">/g)];
      expect(sides).toHaveLength(2);
      for (const [, , box, name] of sides) {
        expect(box.split(" ")).toEqual([styles.fieldSide, "min-w-0", "rounded-lg", "border", "border-line", "px-2", "pb-1"]);
        expect(name.split(" ")).toEqual([styles.fieldSideName, "w-fit", "bg-panel", "px-1", "text-xs", "font-semibold", "text-text"]);
      }
      for (const index of [0, 1]) {
        const marker = `aria-labelledby="${sides[index][1]}"`;
        expect(childClasses(html, marker).map((classes) => classes[0])).toEqual([styles.fieldSideName, styles.sideToggles]);
      }
      // Shared field effects is one box across both sides: it keeps its fieldset.
      expect(html).toContain('<legend class="px-1 text-xs font-semibold text-text">Shared field effects</legend>');
    }
  });
});

describe("the free-agent swap dialog", () => {
  const card = (name: string): DraftPokemon & RosterPokemon => ({ name, points: 12, tier: 2 } as DraftPokemon & RosterPokemon);

  it("lines up the Drop and Add cards' label, sprite, name, types and points in five shared rows", () => {
    const html = renderToStaticMarkup(createElement(SwapDialog, {
      move: { add: card("Decidueye-Hisui"), drop: card("Pikachu"), pointsAfter: 80 }, budget: 100, swapsRemaining: 3, swapLimit: 5,
      pending: false, onClose: () => undefined, onConfirm: () => undefined,
    }));
    // Columns 0.75rem apart, no row gap: the cards' parts keep their own margins.
    const cards = childClasses(html, 'class="grid gap-x-3 grid-cols-2"');
    expect(cards).toHaveLength(2);
    for (const classes of cards) expect(classes).toEqual(expect.arrayContaining(["row-span-5", "grid", "grid-rows-subgrid"]));
    for (const label of ["Drop", "Add"]) {
      const parts = childClasses(html.slice(html.lastIndexOf("<div", html.indexOf(`>${label}</p>`))), "row-span-5");
      const rows = parts.map((classes) => Number(classes.find((name) => name.startsWith("row-start-"))?.slice("row-start-".length)));
      // Every part names its row, in order; the types row stays empty when a name has no known types.
      expect(rows).toEqual([...new Set(rows)].sort((a, b) => a - b));
      expect(rows.filter((row) => row !== 4)).toEqual([1, 2, 3, 5]);
    }
    // An add into an open slot: one card, the same rows.
    const single = renderToStaticMarkup(createElement(SwapDialog, {
      move: { add: card("Pikachu"), drop: null, pointsAfter: 80 }, budget: 100, swapsRemaining: 3, swapLimit: 5,
      pending: false, onClose: () => undefined, onConfirm: () => undefined,
    }));
    expect(childClasses(single, 'class="grid gap-x-3 grid-cols-1"')).toHaveLength(1);
  });
});
