import { createElement, type ComponentProps, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import BuildSettingsSections from "@/app/(app)/calculator/BuildSettings";
import { describeConditions } from "@/app/(app)/calculator/BattleConditions";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import { buildSectionKey, fieldSectionKey, NO_SETTINGS_SECTIONS, setSectionOpen, trackSectionIssues } from "@/app/(app)/calculator/settings-sections";
import { createRosterState } from "@/app/(app)/calculator/roster-data";
import { createMatchup, swapMatchup, updateMatchupBuild, type BattleSide, type PreparedMatchup } from "@/app/(app)/calculator/roster-prep";
import { createBuild, validateBuild } from "@/app/lib/battle/model";
import type { BuildIssue } from "@/app/lib/battle/types";

// Real SSR and hooks, recording host button props for DOM-free callback checks.
const host = vi.hoisted(() => ({ capture: false, buttons: [] as ComponentProps<"button">[] }));
vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const record = (type: unknown, props: unknown) => { if (host.capture && type === "button") host.buttons.push(props as ComponentProps<"button">); };
  return {
    ...actual,
    jsx: (...args: Parameters<typeof actual.jsx>) => { record(args[0], args[1]); return actual.jsx(...args); },
    jsxs: (...args: Parameters<typeof actual.jsxs>) => { record(args[0], args[1]); return actual.jsxs(...args); },
  };
});
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  return {
    ...actual,
    jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
      if (host.capture && args[0] === "button") host.buttons.push(args[1] as ComponentProps<"button">);
      return actual.jsxDEV(...args);
    },
  };
});

const state = vi.hoisted(() => ({ matchup: null as PreparedMatchup | null }));
vi.mock("@/app/(app)/leagues/[leagueId]/useMinWidthMd", () => ({ useMinWidthMd: () => false }));
vi.mock("@/app/(app)/calculator/useDesktopRosterLayout", () => ({ useDesktopRosterLayout: () => false }));
vi.mock("@/app/(app)/calculator/useCalculatorRosters", () => ({
  default: () => ({ state: createRosterState(), selectLeague: () => undefined, selectOpponent: () => undefined, refresh: () => undefined }),
}));
vi.mock("@/app/(app)/calculator/roster-prep", async (original) => {
  const actual = await original<typeof import("@/app/(app)/calculator/roster-prep")>();
  return { ...actual, createMatchup: (...args: Parameters<typeof actual.createMatchup>) => state.matchup ?? actual.createMatchup(...args) };
});
afterEach(() => { state.matchup = null; });

const issue = (field: string): BuildIssue => ({ field, message: `${field} is invalid.` });
const position = (side: BattleSide) => side === "attacker" ? "left" : "right";

function sections(matchup: PreparedMatchup, open: Record<BattleSide, boolean>, onToggle = { attacker: vi.fn(), defender: vi.fn() }) {
  host.buttons = [];
  host.capture = true;
  try {
    const html = renderToStaticMarkup(createElement(BuildSettingsSections, {
      attacker: matchup.attacker, defender: matchup.defender,
      issues: { attacker: validateBuild(matchup.attacker.build), defender: validateBuild(matchup.defender.build) },
      builds: {
        attacker: { id: "left-build", open: open.attacker, onToggle: onToggle.attacker },
        defender: { id: "right-build", open: open.defender, onToggle: onToggle.defender },
      },
      renderEditor: (side: BattleSide) => createElement(PokemonPanel, {
        side, build: matchup[side].build, issues: validateBuild(matchup[side].build), onChange: vi.fn(), hpInput: matchup[side].hpInput, onHPChange: vi.fn(),
      }),
    }));
    return { html, buttons: host.buttons };
  } finally {
    host.capture = false;
  }
}

async function calculator(matchup: PreparedMatchup) {
  state.matchup = matchup;
  const { default: CalculatorClient } = await import("@/app/(app)/calculator/CalculatorClient");
  return renderToStaticMarkup(createElement(CalculatorClient));
}

const toggleTag = /<button\b[^>]*data-(build|field)-toggle="(\w+)"[^>]*aria-expanded="(\w+)"[^>]*aria-controls="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g;

describe("settings sections' open state", () => {
  it("opens a section when it gains an issue field, and leaves closing to the user", () => {
    const [left, right] = [buildSectionKey(0), buildSectionKey(1)];
    let open = trackSectionIssues(NO_SETTINGS_SECTIONS, [{ key: left, issues: [] }, { key: right, issues: [] }]);
    expect(open).toBe(NO_SETTINGS_SECTIONS);
    open = trackSectionIssues(open, [{ key: left, issues: [issue("points"), issue("points.atk")] }, { key: right, issues: [] }]);
    expect(open.open).toEqual({ [left]: true });
    // Collapsed again by the user, the same problems (even reworded) do not reopen it.
    open = setSectionOpen(open, left, false);
    const same = trackSectionIssues(open, [{ key: left, issues: [issue("points.atk"), { field: "points", message: "Reworded." }] }, { key: right, issues: [] }]);
    expect(same).toBe(open);
    // Fixing one keeps it collapsed; a new field opens it again.
    open = trackSectionIssues(open, [{ key: left, issues: [issue("points")] }, { key: right, issues: [] }]);
    expect(open.open[left]).toBe(false);
    open = trackSectionIssues(open, [{ key: left, issues: [issue("points"), issue("nature")] }, { key: right, issues: [] }]);
    expect(open.open[left]).toBe(true);
    // Fixing everything never closes it.
    open = trackSectionIssues(open, [{ key: left, issues: [] }, { key: right, issues: [] }]);
    expect(open.open[left]).toBe(true);
    // Field conditions is tracked the same way, apart from the builds.
    const field = fieldSectionKey(0);
    open = trackSectionIssues(open, [{ key: field, issues: [issue("gravity")] }]);
    expect(open.open[field]).toBe(true);
    expect(open.open[right]).toBeUndefined();
  });

  it("follows each Pokémon by key through a Swap, keeps the field's, and starts collapsed after a Reset", () => {
    const matchup = createMatchup(3);
    let open = setSectionOpen(NO_SETTINGS_SECTIONS, buildSectionKey(matchup.defender.key), true);
    open = setSectionOpen(open, fieldSectionKey(matchup.revision), true);
    expect(setSectionOpen(open, buildSectionKey(matchup.defender.key), true)).toBe(open);
    const swapped = swapMatchup(matchup);
    expect(open.open[buildSectionKey(swapped.attacker.key)]).toBe(true);
    expect(open.open[buildSectionKey(swapped.defender.key)]).toBeUndefined();
    expect(open.open[fieldSectionKey(swapped.revision)]).toBe(true);
    const reset = createMatchup(4);
    expect([buildSectionKey(reset.attacker.key), buildSectionKey(reset.defender.key), fieldSectionKey(reset.revision)].map((key) => !!open.open[key]))
      .toEqual([false, false, false]);
  });
});

describe("Build settings under the summary", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])("is an accessible disclosure for each side, in card order (open left=%s right=%s)", (left, right) => {
    const matchup = createMatchup();
    const onToggle = { attacker: vi.fn(), defender: vi.fn() };
    const { html, buttons } = sections(matchup, { attacker: left, defender: right }, onToggle);
    for (const side of ["attacker", "defender"] as const) {
      const open = side === "attacker" ? left : right;
      const id = side === "attacker" ? "left-build" : "right-build";
      const name = side === "attacker" ? "Charizard" : "Blastoise";
      const toggle = html.match(new RegExp(`<button\\b[^>]*data-build-toggle="${side}"[^>]*>[\\s\\S]*?</button>`))![0];
      expect(toggle).toContain('type="button"');
      expect(toggle).toContain(`aria-expanded="${open}"`);
      expect(toggle).toContain(`aria-controls="${id}"`);
      expect(toggle).toContain(`<span class="sr-only">${name} ${position(side)} </span>Build settings`);
      expect(toggle).not.toContain("settings to check");
      const toggleId = toggle.match(/\bid="([^"]+)"/)![1];
      const region = html.match(new RegExp(`<div id="${id}"[^>]*>`))![0];
      expect(region).toContain('role="region"');
      expect(region).toContain(`aria-labelledby="${toggleId}"`);
      expect(region).toContain(`data-build-region="${side}"`);
      expect(region.includes('hidden=""')).toBe(!open);
      // The region holds this side's editor, right after its own button.
      expect(html.indexOf(region)).toBeGreaterThan(html.indexOf(toggle));
      const after = html.slice(html.indexOf(region));
      const next = after.indexOf("data-build-toggle=", 1);
      const editor = after.slice(0, next === -1 ? undefined : next);
      expect([...editor.matchAll(/data-calculator-build-settings="true"/g)]).toHaveLength(1);
      expect(editor).toMatch(new RegExp(`id="${side}-[^"]*-nature"`));
      buttons.find((props) => props["aria-controls"] === id)!.onClick!({} as MouseEvent<HTMLButtonElement>);
      expect(onToggle[side]).toHaveBeenCalledOnce();
    }
    expect(html.indexOf('data-build-section="attacker"')).toBeLessThan(html.indexOf('data-build-section="defender"'));
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, references] of html.matchAll(/\baria-(?:describedby|labelledby)="([^"]+)"/g)) {
      for (const reference of references.split(" ")) expect(ids).toContain(reference);
    }
  });

  it("shows each side's issue count on its collapsed disclosure", () => {
    let matchup = createMatchup();
    matchup = updateMatchupBuild(matchup, "defender", { ...createBuild("blastoise"), points: { ...createBuild().points, atk: 40, spa: 40 } });
    matchup = updateMatchupBuild(matchup, "attacker", { ...createBuild("gallade"), configuration: { gender: "F" } });
    const counts = { attacker: validateBuild(matchup.attacker.build).length, defender: validateBuild(matchup.defender.build).length };
    expect(counts.attacker).toBe(1);
    expect(counts.defender).toBeGreaterThan(1);
    const { html } = sections(matchup, { attacker: false, defender: false });
    for (const side of ["attacker", "defender"] as const) {
      const toggle = html.match(new RegExp(`<button\\b[^>]*data-build-toggle="${side}"[^>]*>[\\s\\S]*?</button>`))![0];
      const count = counts[side];
      expect(toggle).toContain(`<span class="sr-only">, </span>${count} ${count === 1 ? "setting" : "settings"} to check</span>`);
      expect(toggle).toContain('aria-expanded="false"');
    }
  });

  it("sits right under the summary, outside its pinned box, with Field conditions below both", async () => {
    const html = await calculator(createMatchup());
    const summaryEnd = html.indexOf("</section>", html.indexOf("<section data-calculator-summary"));
    // The summary's wrapper (the sticky box) closes right after the summary, before the settings.
    expect(html.slice(summaryEnd)).toMatch(/^<\/section><\/div><div data-calculator-settings="true"/);
    const settings = html.slice(summaryEnd, html.indexOf('role="tabpanel"'));
    const order = ['data-build-section="attacker"', 'data-build-section="defender"', 'data-field-section="true"'].map((marker) => settings.indexOf(marker));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.slice(0, summaryEnd)).not.toMatch(/data-(?:build|field)-(?:toggle|region)|data-calculator-build-settings/);
  });

  it("opens the Build settings of a Pokémon whose build has issues and keeps the others collapsed", async () => {
    const matchup = createMatchup();
    const invalid = updateMatchupBuild(matchup, "defender", { ...createBuild("blastoise"), points: { ...createBuild().points, spe: 33 } });
    const html = await calculator(invalid);
    const count = validateBuild(invalid.defender.build).length;
    const toggles = [...html.matchAll(toggleTag)];
    expect(toggles.map(([, kind, side, expanded]) => [kind, side, expanded])).toEqual([["build", "attacker", "false"], ["build", "defender", "true"], ["field", "true", "false"]]);
    expect(toggles[1][5]).toContain(`${count} ${count === 1 ? "setting" : "settings"} to check`);
    for (const [, kind, side, expanded, controls] of toggles) {
      const region = html.match(new RegExp(`<div id="${controls}" role="region"[^>]*>`))![0];
      expect(region).toContain(`data-${kind}-region="${side}"`);
      expect(region.includes('hidden=""')).toBe(expanded === "false");
    }
    expect(html).toMatch(/<input\b[^>]*id="defender-[^"]*-points-spe"[^>]*aria-invalid="true"/);
    expect(html).not.toMatch(/data-calculator-(?:tab|panel)="(?:builds|field)"/);
  });
});

describe("Field conditions under the Build settings", () => {
  it("starts collapsed, with the field summary and no separate summary line", async () => {
    const matchup = createMatchup();
    const html = await calculator(matchup);
    const [toggle] = [...html.matchAll(toggleTag)].filter(([, kind]) => kind === "field");
    expect(toggle[3]).toBe("false");
    expect(toggle[0]).toContain('type="button"');
    expect(toggle[5]).toContain("<span>Field conditions</span>");
    expect(toggle[5]).not.toContain("to check");
    const summary = describeConditions(matchup.field);
    expect(summary).toBe("Doubles · No weather · No terrain · 1 toggles on");
    // Only the disclosure shows the field summary now.
    expect(html.split(summary)).toHaveLength(2);
    expect(toggle[5]).toContain(summary);
    const toggleId = toggle[0].match(/\bid="([^"]+)"/)![1];
    const region = html.match(new RegExp(`<div id="${toggle[4]}"[^>]*>`))![0];
    expect(region).toContain('role="region"');
    expect(region).toContain(`aria-labelledby="${toggleId}"`);
    expect(region).toContain('hidden=""');
    // Its editor and the unmodelled-states note stay mounted inside it.
    const inside = html.slice(html.indexOf(region), html.indexOf('role="tabpanel"'));
    expect(inside).toMatch(/<select\b[^>]*id="[^"]*-weather"/);
    expect(inside).toMatch(/<input\b[^>]*id="[^"]*-trickRoom"/);
    expect(inside).toContain("Battle states that cannot be set here");
  });

  it("opens itself with its issue count when the field has an issue", async () => {
    const matchup = createMatchup();
    const html = await calculator({ ...matchup, field: { ...matchup.field, gravity: "on" as unknown as boolean } });
    const toggles = [...html.matchAll(toggleTag)];
    expect(toggles.map(([, kind, , expanded]) => [kind, expanded])).toEqual([["build", "false"], ["build", "false"], ["field", "true"]]);
    expect(toggles[2][5]).toContain('<span class="sr-only">, </span>1 setting to check</span>');
    const region = html.match(new RegExp(`<div id="${toggles[2][4]}" role="region"[^>]*>`))![0];
    expect(region).not.toContain('hidden=""');
    expect(html.slice(html.indexOf(region))).toMatch(/^[\s\S]*?<input\b[^>]*id="[^"]*-gravity"[^>]*aria-invalid="true"/);
    expect(html).toContain("Gravity must be on or off.");
  });
});
