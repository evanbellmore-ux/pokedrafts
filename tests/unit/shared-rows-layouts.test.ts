import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { railRows } from "@/app/(app)/calculator/LeagueMatchupPicker";
import SwapDialog from "@/app/(app)/leagues/[leagueId]/free-agents/SwapDialog";
import type { DraftPokemon } from "@/app/types/draft";
import type { RosterPokemon } from "@/app/types/league";
import { childClasses, declarations, SUMMARY_CARD_ROWS } from "../fixtures/shared-rows";

// Two-sided menus whose sides sit side by side share one set of rows (subgrid), so each part sits level with the other
// side's part in the same row: the calculator's desktop roster rails and 1v1 summary cards, and the free-agent swap dialog's
// Drop and Add cards. (Training setup's team panels: training-setup-rows.test.ts.)

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
