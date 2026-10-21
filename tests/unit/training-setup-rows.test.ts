import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TeamSetup, { type TeamSetupProps } from "@/app/(app)/training/setup/TeamSetup";
import { PANEL_ROWS, sharedRows } from "@/app/(app)/training/setup/TeamSourcePanel";
import { createSetupDraft } from "@/app/(app)/training/setup/team-draft";
import styles from "@/app/(app)/training/setup/setup.module.css";
import { childClasses, cssBlock, declarations } from "../fixtures/shared-rows";
import { OPPONENT_ROSTER, OWN_ROSTER, rosterState, runtime, snapshotWith } from "../fixtures/training";

// From 64rem the two team panels share one set of rows (subgrid): the headers, the source controls, the Choose 6 facts and
// each Pokémon row sit level across the sides, every pair one height. Below 64rem the panels stack as before.

const css = readFileSync(join(__dirname, "..", "..", "app", "(app)", "training", "setup", "setup.module.css"), "utf8");
const wide = cssBlock(css, "@media (min-width: 64rem)");
const row = (selector: string) => declarations(wide, selector)["grid-row"];

function render(own = OWN_ROSTER, opponent = OPPONENT_ROSTER) {
  const state = rosterState(own, opponent);
  const session = { updateDraft: vi.fn(), validate: vi.fn(), suggest: vi.fn(), loadMoveOptions: vi.fn(), start: vi.fn(), clearHabits: vi.fn(), setTrendsOpen: vi.fn(), retryEngine: vi.fn() };
  return renderToStaticMarkup(createElement(TeamSetup, {
    runtime, rosters: { state, selectLeague: vi.fn(), selectOpponent: vi.fn(), refresh: vi.fn() }, snapshot: snapshotWith({}, createSetupDraft(), state), session,
  } satisfies TeamSetupProps));
}

/** The shared-row class a panel part carries (null: none). */
const ROW_CLASSES = ["teamHeader", "teamSource", "teamNote", "choose", "suggestError", "teamProblems", "teamEdit", "teamEnd"] as const;
const rowOf = (classes: string[]) => ROW_CLASSES.find((name) => classes.includes(styles[name])) ?? null;

describe("Training setup's shared rows", () => {
  it("shares the panels' rows from 64rem only; below, the panels stack as before", () => {
    const narrow = css.slice(0, css.indexOf("@media (min-width: 64rem)"));
    // Nothing below 64rem places a part or sets a display that would beat the list fold's max-lg:hidden.
    expect(narrow).not.toMatch(/subgrid|grid-row|\.members|\.choose/);
    expect(declarations(narrow, ".teamEnd")).toEqual({ display: "none" });
    expect(declarations(narrow, ".team > * + *")).toEqual({ "margin-block-start": "0.75rem" });
    expect(declarations(wide, ".teams")).toEqual({ "grid-template-columns": "repeat(2, minmax(0, 1fr))", "row-gap": "0" });
    expect(declarations(wide, ".team")).toEqual({
      display: "grid", "grid-row": "1 / span var(--team-rows)", "grid-template-rows": "subgrid", "grid-template-columns": "minmax(0, 1fr)", "row-gap": "0",
    });
    for (const nested of [".choose", ".members"]) expect(declarations(wide, nested)).toMatchObject({ display: "grid", "grid-template-rows": "subgrid", "row-gap": "0" });
    expect(declarations(wide, ".members > * + *")).toEqual({ "margin-block-start": "0.5rem" });
  });

  it("places each part in its row: PANEL_ROWS fixed rows around one row per Pokémon of the longer list", () => {
    expect([".teamHeader", ".teamSource", ".teamNote", ".choose"].map(row)).toEqual(["1", "2", "3", "4 / -5"]);
    expect([".chooseFact", ".chooseLabel", ".members"].map(row)).toEqual(["1", "2", "3 / -1"]);
    expect([".suggestError", ".teamProblems", ".teamEdit", ".team > .teamEnd"].map(row)).toEqual(["-5", "-4", "-3", "-2"]);
    // The rows before the Pokémon (the panel's three, the fact and the team's name) and after them (from line -5 on).
    const [chooseStart, chooseEnd] = row(".choose").split(" / ").map(Number);
    const membersStart = Number(row(".members").split(" / ")[0]);
    expect((chooseStart - 1) + (membersStart - 1) + (-chooseEnd - 1)).toBe(PANEL_ROWS);
    expect(sharedRows([{ candidates: Array(7) }, { candidates: Array(6) }])).toBe(PANEL_ROWS + 7);
    expect(sharedRows([{ candidates: [] }, { candidates: Array(11) }])).toBe(PANEL_ROWS + 11);
    expect(sharedRows([{ candidates: [] }, { candidates: [] }])).toBe(PANEL_ROWS + 1);
  });

  it("tops each header with its heading and switch; the opponent's quick picks between them where they fit, else under them", () => {
    expect(declarations(css, ".teamHeader")).toEqual({ container: "team-header / inline-size" });
    const phone = css.slice(0, css.indexOf("@media (min-width: 40rem) {"));
    expect(declarations(phone, ".headerRow")).toMatchObject({ display: "grid", "grid-template-areas": '"heading picks" "switch switch"', "align-items": "start" });
    expect(declarations(cssBlock(css, "@media (min-width: 40rem)"), ".headerRow")).toEqual({
      "grid-template-columns": "minmax(0, 1fr) auto", "grid-template-areas": '"heading switch" "picks picks"',
    });
    const roomy = cssBlock(cssBlock(css, "@container team-header (min-width: 34rem)"), "@media (min-width: 40rem)");
    expect(declarations(roomy, ".headerRow")).toEqual({ "grid-template-columns": "auto minmax(0, 1fr) auto", "grid-template-areas": '"heading picks switch"' });
    // The switch's own Tailwind display (two equal buttons below 40rem, a row from 40rem) is never overridden.
    expect(css).not.toMatch(/\.headerSwitch\s*\{[^}]*display/);
    const state = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const session = { updateDraft: vi.fn(), validate: vi.fn(), suggest: vi.fn(), loadMoveOptions: vi.fn(), start: vi.fn(), clearHabits: vi.fn(), setTrendsOpen: vi.fn(), retryEngine: vi.fn() };
    const picks = { userId: "user-1", leagueId: "league-a", opponents: {}, recent: { "league-a": ["member-other"] } };
    const html = renderToStaticMarkup(createElement(TeamSetup, {
      runtime, rosters: { state, selectLeague: vi.fn(), selectOpponent: vi.fn(), refresh: vi.fn() }, snapshot: snapshotWith({ picks }, createSetupDraft(), state), session,
    } satisfies TeamSetupProps));
    const header = (role: "own" | "opponent") => childClasses(html.slice(html.indexOf(`data-training-team="${role}"`)), `class="${styles.headerRow}"`)
      .map((classes) => ["headerHeading", "headerPicks", "headerSwitch"].find((name) => classes.includes(styles[name])) ?? null);
    expect(header("own")).toEqual(["headerHeading", "headerSwitch"]);
    expect(header("opponent")).toEqual(["headerHeading", "headerPicks", "headerSwitch"]);
  });

  it("gives both panels the rows of the longer list, and every part of each panel a shared row", () => {
    const html = render();
    expect(html).toContain(`<div class="${styles.teams}" style="--team-rows:${PANEL_ROWS + OWN_ROSTER.length}">`);
    const parts = (role: "own" | "opponent") => childClasses(html, `data-training-team="${role}"`);
    for (const role of ["own", "opponent"] as const) {
      expect(html).toMatch(new RegExp(`<section data-training-team="${role}" aria-labelledby="[^"]+" class="${styles.team} `));
      // Every part is placed (none left to auto-placement), in row order.
      const rows = parts(role).map(rowOf);
      expect(rows).not.toContain(null);
      expect(rows.map((name) => ROW_CLASSES.indexOf(name!))).toEqual([...rows.map((name) => ROW_CLASSES.indexOf(name!))].sort((a, b) => a - b));
      // Inside Choose 6: the fact, the team's name, the folded names (below 64rem only), the list.
      const choose = childClasses(html.slice(html.indexOf(`data-training-team="${role}"`)), `class="${styles.choose} `);
      expect(choose.map((classes) => classes.includes(styles.chooseFact) ? "fact" : classes.includes(styles.chooseLabel) ? "label"
        : classes.includes(styles.members) ? "members" : classes.includes("lg:hidden") ? "folded" : null)).toEqual(["fact", "label", "folded", "members"]);
    }
    // Yours ends with Edit as PokéPaste; the opponent's has none ("You see" closes Stat Points), and its end row still matches.
    expect(parts("own").map(rowOf)).toEqual(["teamHeader", "teamSource", "choose", "teamEdit", "teamEnd"]);
    expect(parts("opponent").map(rowOf)).toEqual(["teamHeader", "teamSource", "choose", "teamEnd"]);
    // The longer list sets the rows whichever side has it.
    expect(render(OPPONENT_ROSTER, OWN_ROSTER)).toContain(`style="--team-rows:${PANEL_ROWS + OWN_ROSTER.length}"`);
  });
});
