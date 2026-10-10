// The naming pass's guard (scripts/.cache/naming/RULES.md §5 gate 9): text names Pokémon, never their screen positions.
// 1. No string literal, template part or JSX text in app/ names a position (TypeScript AST, not a regex over the source).
// 2. The position helpers are gone (SLOT_POSITION, POSITION_WORDS and the 2v2 position labels).
// 3. In rendered states with look-alikes (a mirror, same-side twins, a Transform), every per-Pokémon accessible name is
//    unique (radios within their group), apart from the known follow-up F5 fields and buttons, and none is positional.
// 4. Each 2v2 rail button's accessible name contains its visible text (label in name).
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { act, createElement, type ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CalculatorState, DoublesMatchup } from "@/app/(app)/calculator/doubles-prep";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import type { PreparedMatchup } from "@/app/(app)/calculator/roster-prep";
import type { BoardView, PokemonView, TrainingBattle } from "@/app/(app)/training/model/view-types";
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleBuild } from "@/app/lib/battle/types";
import { FakeElement, FakeText, installFakeDom, reactProps, type FakeDocument } from "../fixtures/fake-dom";
import { POSITIONAL } from "../fixtures/naming";
import { boardView, logTurns, moveRequest, OPPONENT_ROSTER, OWN_ROSTER, rosterState, runtime as trainingRuntime, trainingSetup } from "../fixtures/training";

const state = vi.hoisted(() => ({ matchup: null as unknown, doubles: null as unknown, desktop: false, rosters: null as unknown }));
vi.mock("@/app/(app)/leagues/[leagueId]/useMinWidthMd", () => ({ useMinWidthMd: () => false }));
vi.mock("@/app/(app)/calculator/useDesktopRosterLayout", () => ({ useDesktopRosterLayout: () => state.desktop }));
vi.mock("@/app/(app)/calculator/useCalculatorRosters", async () => {
  const { createRosterState } = await import("@/app/(app)/calculator/roster-data");
  const { useEffect } = await import("react");
  const fallback = createRosterState();
  // The fixture rosters, handed to the page as the real hook does (through `receive`, after render).
  function useCalculatorRosters(receive?: (value: CalculatorRosterState) => void) {
    const value = (state.rosters as CalculatorRosterState | null) ?? fallback;
    useEffect(() => { receive?.(value); }, [receive, value]);
    return { state: value, selectLeague: () => undefined, selectOpponent: () => undefined, refresh: () => undefined };
  }
  return { default: useCalculatorRosters };
});
vi.mock("@/app/(app)/calculator/doubles-prep", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/(app)/calculator/doubles-prep")>();
  return { ...actual, createDoubles: (...args: Parameters<typeof actual.createDoubles>) => (state.doubles as DoublesMatchup | null) ?? actual.createDoubles(...args) };
});
vi.mock("@/app/(app)/calculator/roster-prep", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/(app)/calculator/roster-prep")>();
  return { ...actual, createMatchup: (...args: Parameters<typeof actual.createMatchup>) => (state.matchup as PreparedMatchup | null) ?? actual.createMatchup(...args) };
});

const ROOT = path.resolve(import.meta.dirname, "../..");

// ---- 1. literals ----

/** RULES §5 gate 9: everywhere in app/. */
const POSITION_WORDS = /\b(?:your|opponent's) (?:left|right)\b|\b(?:Left|Right) foe\b/;
/** Only under the calculator, Training and the battle engine (a league's "Position 1 picks first" is a draft position). */
const SCOPED = /\bPosition [1-4]\b|^Ally$/;
const SCOPED_DIRS = ["app/(app)/calculator/", "app/(app)/training/", "app/lib/battle/"];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(?:ts|tsx|mts)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

type Literal = { at: string; text: string; scoped: boolean };
/**
 * Every string literal, template part and JSX text, plus each whole template with its substitutions as "1" (so
 * `Position ${n + 1}` is checked as "Position 1"). Also every identifier, for the removed helpers.
 */
function literalsOf(file: string): { literals: Literal[]; identifiers: Set<string> } {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const scoped = SCOPED_DIRS.some((dir) => rel.startsWith(dir));
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const literals: Literal[] = [];
  const identifiers = new Set<string>();
  const add = (node: ts.Node, text: string) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (text) literals.push({ at: `${rel}:${line}`, text, scoped });
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) add(node, node.text);
    else if (ts.isJsxText(node)) add(node, node.text.trim());
    else if (ts.isTemplateExpression(node)) add(node, node.head.text + node.templateSpans.map((span) => `1${span.literal.text}`).join(""));
    else if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { literals, identifiers };
}

// ---- 3. rendered states (fake DOM) ----

let document: FakeDocument;
let root: { render: (node: unknown) => void };

async function settle(rounds = 8) {
  for (let index = 0; index < rounds; index++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
/** Settles until no deferred calculation is pending. */
async function settled() {
  await settle();
  for (let round = 0; round < 40 && /Calculations are paused\.|Calculating…/.test(document.documentElement.textContent); round++) await settle(2);
}
async function mount(node: ReactNode) {
  await act(async () => { root.render(null); });
  await act(async () => { root.render(node); });
  await settled();
}
function walk(from: FakeElement, visit: (element: FakeElement) => void) {
  from.childNodes.forEach((child) => { if (child instanceof FakeElement) { visit(child); walk(child, visit); } });
}
function all(match: (element: FakeElement) => boolean): FakeElement[] {
  const found: FakeElement[] = [];
  walk(document.documentElement, (element) => { if (match(element)) found.push(element); });
  return found;
}
async function click(element: FakeElement) {
  const handler = reactProps(element).onClick as ((event: unknown) => void) | undefined;
  if (!handler) throw new Error(`No onClick on <${element.localName}>`);
  await act(async () => { handler({ currentTarget: element, target: element, preventDefault() {}, stopPropagation() {}, nativeEvent: {} }); });
  await settled();
}
async function choose(radio: FakeElement) {
  const handler = reactProps(radio).onChange as ((event: unknown) => void) | undefined;
  if (!handler) throw new Error(`No onChange on <${radio.localName}>`);
  radio.checked = true;
  await act(async () => { handler({ currentTarget: radio, target: radio, preventDefault() {}, stopPropagation() {} }); });
  await settled();
}

const isSrOnly = (element: FakeElement) => /(?:^|\s)sr-only(?:\s|$)/.test(element.getAttribute("class") ?? "");
/** Text for an accessible name: aria-hidden subtrees left out. `visible` also leaves out screen-reader-only text. */
function textOf(element: FakeElement, visible = false): string {
  const parts: string[] = [];
  const read = (node: FakeElement) => node.childNodes.forEach((child) => {
    if (child instanceof FakeText) { if (child.nodeType === 3) parts.push(child.data); return; }
    if (!(child instanceof FakeElement) || child.getAttribute("aria-hidden") === "true" || (visible && isSrOnly(child))) return;
    read(child);
  });
  read(element);
  return parts.join("").replace(/\s+/g, " ").trim();
}
function byId(id: string) { return document.getElementById(id) as FakeElement | null; }
/** A practical accessible name: aria-labelledby, aria-label, <label for>, a wrapping <label>, a legend, or the text. */
function accessibleName(element: FakeElement): string {
  const ids = element.getAttribute("aria-labelledby");
  if (ids) return ids.split(/\s+/).map((id) => (byId(id) ? textOf(byId(id)!) : "")).join(" ").trim();
  const aria = element.getAttribute("aria-label");
  if (aria) return aria;
  const tag = element.localName;
  if (tag === "fieldset") {
    const legend = element.childNodes.find((child) => child instanceof FakeElement && child.localName === "legend") as FakeElement | undefined;
    return legend ? textOf(legend) : "";
  }
  if (tag === "input" || tag === "select" || tag === "textarea") {
    const id = element.getAttribute("id");
    const labels = id ? all((each) => each.localName === "label" && each.getAttribute("for") === id) : [];
    if (labels.length) return labels.map((label) => textOf(label)).join(" ");
    for (let up = element.parentElement; up instanceof FakeElement; up = up.parentElement) if (up.localName === "label") return textOf(up);
    return element.getAttribute("placeholder") ?? "";
  }
  return textOf(element);
}
function hiddenAncestor(element: FakeElement) {
  for (let up: FakeElement | null = element; up instanceof FakeElement; up = up.parentElement) {
    if (up.hasAttribute("hidden") || up.getAttribute("aria-hidden") === "true" || (up.localName === "dialog" && !up.hasAttribute("open"))) return true;
  }
  return false;
}
/** The labelled group a radio sits in (radios are unique within their group). */
function groupOf(element: FakeElement): string {
  for (let up = element.parentElement; up instanceof FakeElement; up = up.parentElement) {
    if (up.localName === "fieldset" || up.getAttribute("role") === "radiogroup" || up.getAttribute("role") === "group") return `${up.localName}:${accessibleName(up)}`;
  }
  return "";
}

/** The name of the nearest named fieldset, group or region around `element` ("" when none). */
function contextOf(element: FakeElement): string {
  for (let up = element.parentElement; up instanceof FakeElement; up = up.parentElement) {
    const role = up.getAttribute("role");
    if (up.localName === "fieldset" || role === "group" || role === "radiogroup" || role === "region") {
      const name = accessibleName(up);
      if (name) return name;
    }
  }
  return "";
}

type Named = { kind: string; name: string; group: string; context: string; element: FakeElement };
/** Buttons, inputs, selects, meters, named lists and tables, named groups, outside hidden subtrees, closed dialogs and `skip`. */
function namedElements(skip?: (element: FakeElement) => boolean): Named[] {
  const rows: Named[] = [];
  walk(document.documentElement, (element) => {
    if (hiddenAncestor(element)) return;
    for (let up: FakeElement | null = element; up instanceof FakeElement; up = up.parentElement) if (skip?.(up)) return;
    const tag = element.localName;
    const role = element.getAttribute("role");
    const control = tag === "button" || tag === "select" || tag === "textarea" || (tag === "input" && element.getAttribute("type") !== "hidden") || role === "meter";
    const group = tag === "fieldset" || role === "group" || role === "radiogroup" || role === "region" || tag === "aside" || tag === "nav"
      || (tag === "section" && (element.hasAttribute("aria-label") || element.hasAttribute("aria-labelledby")));
    const list = (tag === "ul" || tag === "ol" || tag === "table") && element.hasAttribute("aria-label");
    if (!control && !group && !list) return;
    const name = accessibleName(element);
    if (group && !name) return;
    const kind = tag === "input" ? `input[${element.getAttribute("type") ?? String(reactProps(element).type ?? "text")}]` : role ?? tag;
    rows.push({ kind, name, group: kind === "input[radio]" ? groupOf(element) : "", context: contextOf(element), element });
  });
  return rows;
}

/** RULES §8 F5: known duplicates that are not positional (one per card or Build settings region). */
const F5 = [/^Tera Type$/, /^Current HP$/, /^Apply Intimidate to /];
/**
 * Duplicate names: radios within their group; any other repeated name unless it is F5's, or (the same class as F5) each
 * copy sits in a different named fieldset, group or region (the Build settings editor's `Nature`, one per region named
 * after its Pokémon; a side's `Reflect` in its `{name}’s side` fieldset). `allowed` collects those, for review.
 */
function duplicates(rows: Named[], allowed: string[] = []): string[] {
  const byKey = new Map<string, Named[]>();
  for (const row of rows) {
    const key = row.kind === "input[radio]" ? `radio in ${row.group} › ${row.name}` : `${row.kind} › ${row.name}`;
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const found: string[] = [];
  for (const [key, same] of byKey) {
    if (same.length < 2) continue;
    const contexts = same.map((row) => row.context);
    const told = same[0].kind !== "input[radio]" && contexts.every(Boolean) && new Set(contexts).size === contexts.length;
    if (F5.some((pattern) => pattern.test(same[0].name)) || told) allowed.push(`${same.length}× ${key}${told ? ` (in ${contexts.join(" / ")})` : " (F5)"}`);
    else found.push(`${same.length}× ${key}`);
  }
  return found;
}
/** NAMING_GUARD_DUMP=<dir> writes each state's names (kind, group, name) there, for review. */
function dump(scenario: string, rows: Named[]) {
  const dir = process.env.NAMING_GUARD_DUMP;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const allowed: string[] = [];
  const found = duplicates(rows, allowed);
  fs.writeFileSync(path.join(dir, `${scenario}.txt`), [
    `${rows.length} named elements; ${found.length} duplicates; ${allowed.length} allowed repeats`, ...found.map((line) => `DUPLICATE ${line}`), ...allowed.map((line) => `allowed ${line}`), "",
    ...rows.map((row) => `${row.kind}\t${row.group || row.context}\t${row.name}`),
  ].join("\n"));
}
/**
 * Named containers (fieldsets, groups, regions, asides, named sections) with the same name, page-wide: a container's name
 * is what a screen reader announces on entering it, so a card's name must not also name an unrelated group (review CALC-3).
 */
const CONTAINER_KINDS = new Set(["fieldset", "group", "radiogroup", "region", "aside", "nav", "section"]);
/** 2v2's side group of cards and its Field conditions side fieldset: both name the same side (unchanged since 0824a6a). */
const SAME_SIDE = /^(?:Your|Opponent's) side$/;
function containerDuplicates(rows: Named[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) if (CONTAINER_KINDS.has(row.kind) && !SAME_SIDE.test(row.name)) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([name, count]) => `${count}× ${name}`);
}
const positional = (rows: Named[]) => rows.filter((row) => POSITIONAL.test(row.name) || POSITION_WORDS.test(row.name)).map((row) => `${row.kind} › ${row.name}`);

async function calculatorStart() {
  const { loadBattleRuntime } = await import("@/app/lib/battle/load-runtime");
  const runtime = await loadBattleRuntime("champions");
  state.matchup = null; state.doubles = null;
  const roster = await import("@/app/(app)/calculator/roster-prep");
  const prep = await import("@/app/(app)/calculator/doubles-prep");
  return { matchup: roster.createMatchup(0, runtime), doubles: prep.createDoubles(0, runtime) } as CalculatorState;
}
async function species(s: CalculatorState, slot: DoublesSlotId, id: string) {
  const { chosenBuild } = await import("@/app/(app)/calculator/PokemonChooser");
  const prep = await import("@/app/(app)/calculator/doubles-prep");
  return prep.updateDoublesBuild(s, s.doubles.slots[slot].key, chosenBuild(id, s.doubles.runtime, "Doubles") as BattleBuild);
}
async function move(s: CalculatorState, slot: DoublesSlotId, moveId: string, target?: DoublesSlotId) {
  const prep = await import("@/app/(app)/calculator/doubles-prep");
  const { getMoveOwner } = await import("@/app/(app)/calculator/roster-prep");
  let next = prep.chooseDoublesMove(s, getMoveOwner(s.doubles.slots[slot]), moveId);
  if (target) next = prep.setDoublesTarget(next, getMoveOwner(next.doubles.slots[slot]), target);
  return next;
}
async function showCalculator(mode: "1v1" | "2v2", calc: CalculatorState) {
  state.matchup = calc.matchup; state.doubles = calc.doubles; state.desktop = true; state.rosters = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
  const { default: CalculatorClient } = await import("@/app/(app)/calculator/CalculatorClient");
  await mount(createElement(CalculatorClient, { initialMode: mode }));
  // Every Build settings and Field conditions section open, so their editors' controls count too.
  for (let round = 0; round < 12; round++) {
    const closed = all((element) => element.localName === "button" && (element.hasAttribute("data-build-toggle") || element.hasAttribute("data-field-toggle"))
      && element.getAttribute("aria-expanded") === "false" && !hiddenAncestor(element) && !inOtherMode(element, mode));
    if (!closed.length) break;
    await click(closed[0]);
  }
}
const otherMode = (mode: "1v1" | "2v2") => (element: FakeElement) => element.getAttribute("data-calculator-mode-only") === (mode === "1v1" ? "2v2" : "1v1");
function inOtherMode(element: FakeElement, mode: "1v1" | "2v2") {
  for (let up: FakeElement | null = element; up instanceof FakeElement; up = up.parentElement) if (otherMode(mode)(up)) return true;
  return false;
}

beforeAll(async () => {
  document = installFakeDom();
  // <dialog>: the fake DOM has no showModal / close.
  Object.assign(FakeElement.prototype, {
    showModal(this: FakeElement) { this.setAttribute("open", ""); },
    close(this: FakeElement) { this.removeAttribute("open"); },
  });
  Object.defineProperty(FakeElement.prototype, "open", {
    get(this: FakeElement) { return this.hasAttribute("open"); },
    set(this: FakeElement, value: boolean) { if (value) this.setAttribute("open", ""); else this.removeAttribute("open"); },
    configurable: true,
  });
  Object.assign(globalThis, { HTMLDialogElement: FakeElement, HTMLInputElement: FakeElement, HTMLSelectElement: FakeElement, HTMLTextAreaElement: FakeElement, Element: FakeElement });
  Object.assign(globalThis.window as object, { HTMLElement: FakeElement, HTMLButtonElement: FakeElement, Element: FakeElement });
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element) as unknown as typeof root;
});

describe("naming guard: names, never positions", () => {
  it("no string literal, template or JSX text in app/ names a screen position", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, "app"))) {
      for (const literal of literalsOf(file).literals) {
        if (POSITIONAL.test(literal.text) || POSITION_WORDS.test(literal.text) || (literal.scoped && SCOPED.test(literal.text))) hits.push(`${literal.at} ${JSON.stringify(literal.text)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the guard's patterns catch the removed labels", () => {
    for (const text of ["your left", "Opponent's right Pokémon", "Left foe", "Right foe", "Lead · left", "Garchomp (left)", "left HP", "Change left Pokémon"]) expect(POSITIONAL.test(text) || POSITION_WORDS.test(text), text).toBe(true);
    for (const text of ["Position 1", "Ally"]) expect(SCOPED.test(text), text).toBe(true);
    for (const text of ["You: 3 left · AI: 4 left", "Left out of the count", "No Pokémon left", "Protect right after a Protect", "Ally Switch", "Ally Minun has Minus.", "Your side", "Garchomp (yours, 1)", "Position 1 picks first"]) {
      expect(POSITIONAL.test(text) || POSITION_WORDS.test(text) || /^Ally$/.test(text), text).toBe(false);
    }
  });

  it("the position helpers are gone", async () => {
    const types = await import("@/app/lib/battle/doubles-types");
    const format = await import("@/app/(app)/calculator/doubles-format");
    const protocol = await import("@/app/(app)/training/log/protocol-text");
    for (const name of ["SLOT_POSITION", "relativePosition"]) expect(name in types, name).toBe(false);
    for (const name of ["RELATIVE_LABELS", "relativeLabel", "positionLabel", "baseName", "positionedName", "relativeName"]) expect(name in format, name).toBe(false);
    expect("POSITION_WORDS" in protocol).toBe(false);
    const used: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, "app"))) {
      const { identifiers } = literalsOf(file);
      for (const name of ["SLOT_POSITION", "POSITION_WORDS", "RELATIVE_LABELS", "relativeLabel", "positionLabel", "positionedName", "relativeName", "relativePosition", "RelativePosition"]) {
        if (identifiers.has(name)) used.push(`${path.relative(ROOT, file)}: ${name}`);
      }
    }
    expect(used).toEqual([]);
  });

  it("2v2 with three Garchomp (a mirror and same-side twins, two Dragon Claw users), desktop rails, both rosters: names are unique", async () => {
    let s = await calculatorStart();
    s = await species(s, "own-left", "garchomp");
    s = await species(s, "own-right", "garchomp");
    s = await species(s, "opponent-left", "garchomp");
    s = await move(s, "own-left", "earthquake");
    s = await move(s, "own-right", "dragonclaw", "opponent-left");
    s = await move(s, "opponent-left", "dragonclaw", "own-right");
    await showCalculator("2v2", s);
    const rows = namedElements(otherMode("2v2"));
    dump("calculator-2v2", rows);
    const names = rows.map((row) => row.name);
    // The state really has the look-alikes, both rails and both Dragon Claw lists.
    for (const name of ["Change Garchomp (yours, 1)", "Change Garchomp (yours, 2)", "Change Garchomp (opponent's)", "Your team shortcuts", "Opponent's team shortcuts",
      "Dragon Claw hits from Garchomp (yours, 2)", "Dragon Claw hits from Garchomp (opponent's)", "Garchomp (yours, 1) stats and Stat Points"]) expect(names, name).toContain(name);
    expect(rows.length).toBeGreaterThan(200);
    expect(positional(rows)).toEqual([]);
    expect(duplicates(rows)).toEqual([]);
    expect(containerDuplicates(rows)).toEqual([]);
    // Label in name (WCAG 2.5.3): each rail button's accessible name contains its visible text.
    const rails = all((element) => element.localName === "aside" && element.hasAttribute("data-calculator-roster-rail"));
    expect(rails).toHaveLength(2);
    const railButtons = rails.flatMap((rail) => { const found: FakeElement[] = []; walk(rail, (element) => { if (element.localName === "button") found.push(element); }); return found; });
    const replace = railButtons.filter((button) => /^(?:Replace|Active)\b/.test(textOf(button, true)));
    expect(replace.length).toBeGreaterThan(20);
    for (const button of replace) expect(accessibleName(button), textOf(button, true)).toContain(textOf(button, true));
    expect(replace.map((button) => textOf(button, true))).toEqual(expect.arrayContaining(["Replace Garchomp (1)", "Replace Garchomp (2)", "Replace Garchomp", "Replace Pikachu"]));
  }, 120_000);

  it("1v1 Charizard mirror with rails: names are unique", async () => {
    let m = await calculatorStart();
    const { chosenBuild } = await import("@/app/(app)/calculator/PokemonChooser");
    const roster = await import("@/app/(app)/calculator/roster-prep");
    m = { ...m, matchup: roster.updateMatchupBuild(m.matchup, "defender", chosenBuild("charizard", m.matchup.runtime, m.matchup.field.gameType) as BattleBuild) };
    await showCalculator("1v1", m);
    const rows = namedElements(otherMode("1v1"));
    dump("calculator-1v1", rows);
    const names = rows.map((row) => row.name);
    for (const name of ["Change Charizard (yours)", "Change Charizard (opponent's)", "Your team shortcuts", "Opponent's team shortcuts", "Charizard (yours) stats and Stat Points"]) expect(names, name).toContain(name);
    expect(positional(rows)).toEqual([]);
    expect(duplicates(rows)).toEqual([]);
    expect(containerDuplicates(rows)).toEqual([]);
  }, 120_000);

  // Review CALC-2: the move-replacement heading names its Pokémon by the full name, as the line under it does.
  it("1v1 Charizard mirror: each card's move replacement is headed by its Pokémon's full name", async () => {
    const start = await calculatorStart();
    const { chosenBuild } = await import("@/app/(app)/calculator/PokemonChooser");
    const roster = await import("@/app/(app)/calculator/roster-prep");
    const mirror = roster.updateMatchupBuild(start.matchup, "defender", chosenBuild("charizard", start.matchup.runtime, start.matchup.field.gameType) as BattleBuild);
    await showCalculator("1v1", { ...start, matchup: mirror });
    const read: [string, string][] = [];
    for (const who of ["Charizard (yours)", "Charizard (opponent's)"]) {
      // A card's move 1 button opens its replacement (activateMoveSlot).
      const quick = all((element) => element.localName === "button" && (element.getAttribute("aria-label") ?? "").startsWith(`${who} move 1:`) && !hiddenAncestor(element) && !inOtherMode(element, "1v1"));
      expect(quick, who).toHaveLength(1);
      await click(quick[0]);
      const moves = all((element) => element.localName === "section" && element.hasAttribute("data-moves-owner") && !hiddenAncestor(element) && !inOtherMode(element, "1v1"));
      expect(moves, who).toHaveLength(1);
      const heading = byId(moves[0].getAttribute("aria-labelledby")!)!;
      const move = quick[0].getAttribute("aria-label")!.slice(`${who} move 1: `.length);
      read.push([textOf(heading), `Replace ${who}’s move 1 — ${move}`]);
      const other = who === "Charizard (yours)" ? "Charizard (opponent's)" : "Charizard (yours)";
      expect(textOf(moves[0]), who).toContain(`${who} → ${other}`);
    }
    for (const [heading, expected] of read) expect(heading).toBe(expected);
  }, 120_000);

  // Review CALC-3: one Garchomp (no look-alike), so its full name is the bare species name the rail's Garchomp entry has.
  it("2v2 with one Garchomp beside the rail's Garchomp entry: no two named groups share a name", async () => {
    let s = await calculatorStart();
    s = await species(s, "own-left", "garchomp");
    await showCalculator("2v2", s);
    const rows = namedElements(otherMode("2v2"));
    const groups = rows.filter((row) => row.kind === "group").map((row) => row.name);
    // The Field conditions group for the Pokémon, and the rail entry's group named after its buttons.
    expect(groups).toContain("Garchomp");
    expect(groups).toContain("Garchomp from your team");
    expect(containerDuplicates(rows)).toEqual([]);
    expect(duplicates(rows)).toEqual([]);
    expect(positional(rows)).toEqual([]);
  }, 120_000);

  it("Training board with Transform look-alikes (across the sides and on one side): names are unique", async () => {
    const { default: BattleScreen } = await import("@/app/(app)/training/BattleScreen");
    const { emptyHabits } = await import("@/app/(app)/training/model/habits-data");
    const session = { choose: () => undefined, forfeit: () => undefined, rematch: () => undefined, changeTeams: () => undefined };
    const base = boardView();
    const garchomp = (view: PokemonView): PokemonView => ({ ...view, name: "Garchomp", speciesId: "garchomp" });
    // The opponent's Ditto shown as Garchomp beside your Garchomp: the side words; your own Ditto shown as Garchomp too: the numbers.
    const cross: BoardView = { ...base, active: { ...base.active, "opponent-left": garchomp(base.active["opponent-left"]!) }, team: { ...base.team, opponent: base.team.opponent.map((view) => view.key === "ai-ampharos" ? garchomp(view) : view) } };
    const both: BoardView = { ...cross, active: { ...cross.active, "own-right": garchomp(cross.active["own-right"]!) }, team: { ...cross.team, own: cross.team.own.map((view) => view.key === "own-gyarados" ? garchomp(view) : view) } };
    for (const [label, board, expected] of [
      ["across", cross, ["Garchomp (yours) HP", "Garchomp (opponent's) HP"]],
      ["across and on one side", both, ["Garchomp (yours, 1) HP", "Garchomp (yours, 2) HP", "Garchomp (opponent's) HP"]],
    ] as const) {
      const battle: TrainingBattle = {
        id: 1, setup: trainingSetup(), seed: null, phase: { kind: "choose", request: moveRequest() }, board, log: logTurns(),
        ai: { status: "idle" }, lastPreview: null, habitsBefore: emptyHabits(), savedId: "saved-1", startedAt: 0,
      };
      await mount(createElement(BattleScreen, { runtime: trainingRuntime, battle, session, habits: emptyHabits() }));
      // Waterfall from your right card, so its target radios (one per Pokémon it can reach) count too.
      const waterfall = all((element) => element.localName === "input" && reactProps(element).value === "move:waterfall");
      expect(waterfall, label).toHaveLength(1);
      await choose(waterfall[0]);
      const rows = namedElements();
      dump(`training-${label.replace(/ /g, "-")}`, rows);
      const names = rows.map((row) => row.name);
      for (const name of expected) expect(names, `${label}: ${name}`).toContain(name);
      expect(rows.filter((row) => row.kind === "input[radio]" && row.group.startsWith("fieldset:Target")).length, label).toBe(3);
      expect(positional(rows), label).toEqual([]);
      expect(duplicates(rows), label).toEqual([]);
    }
  }, 120_000);
});
