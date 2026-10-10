import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getPokemonTypeColours } from "@/app/lib/theme";
import {
  ANNOUNCE_MS, cardLabels, HP_ANIMATION_MS, playbackBoard, popupOf, RESOLVE_MS, spokenName, stepAnnouncement, unplayedSteps,
} from "@/app/(app)/training/board/playback";
import { emptyHabits } from "@/app/(app)/training/model/habits-data";
import type { BoardView, LogTurn, PokemonView, TrainingBattle, TurnStep } from "@/app/(app)/training/model/view-types";
import { FakeElement, installFakeDom, reactProps, type FakeDocument } from "../fixtures/fake-dom";
import { boardView, logTurns, moveRequest, runtime, trainingSetup } from "../fixtures/training";

// The board's turn playback (board/useTurnPlayback.ts), client-rendered in the fake DOM (tests/fixtures/fake-dom.ts) with
// fake timers. Each step: ANNOUNCE (a popup over the board: the move's name in its type colour) for ANNOUNCE_MS, then
// RESOLVE (its targets framed in that colour, HP bars from before to after, results as labels on the cards) for RESOLVE_MS.
// Skip, your controls hidden while it plays, the live region once per step, and prefers-reduced-motion.

const exact = (current: number, maximum: number) => ({ kind: "exact" as const, current, maximum });
const percent = (value: number) => ({ kind: "percent" as const, percent: value });

/** Turn 3 as the worker would send it for tests/fixtures/training.ts boardView(): Rock Slide, Swords Dance, a switch, the end. */
const STEPS: TurnStep[] = [
  {
    kind: "move", title: "Rock Slide", by: "Garchomp", results: [], type: "Rock", actor: "own-left", targets: ["opponent-left", "opponent-right"],
    slots: [
      { slot: "opponent-left", key: "ai-ampharos", name: "Ampharos", hp: { from: percent(20), to: percent(0) }, fainted: true, facts: [] },
      { slot: "opponent-right", key: "ai-absol", name: "Absol", hp: { from: percent(21), to: percent(5) }, facts: ["Critical hit"] },
      { slot: "own-left", key: "own-garchomp", name: "Garchomp", hp: { from: exact(143, 183), to: exact(125, 183) }, facts: ["Life Orb"] },
    ],
  },
  {
    kind: "move", title: "Swords Dance", by: null, results: [], type: "Normal", actor: "own-left", targets: ["own-left"],
    slots: [{ slot: "own-left", key: "own-garchomp", name: "Garchomp", boosts: { atk: 3, spd: -1 }, facts: ["Attack +2"] }],
  },
  {
    kind: "switch", title: "Gyarados switches for Incineroar", by: null, results: [], type: null, actor: null, targets: ["own-right"],
    slots: [
      { slot: "own-right", key: "own-incineroar", name: "Incineroar", entered: true, hp: { from: exact(202, 202), to: exact(202, 202) }, facts: ["Intimidate"] },
      { slot: "opponent-right", key: "ai-absol", name: "Absol", boosts: { atk: -1 }, facts: ["Attack −1"] },
    ],
  },
  {
    kind: "end", title: "End of turn", by: null, results: ["Snow ended"], type: null, actor: null, targets: ["opponent-right"],
    slots: [{ slot: "opponent-right", key: "ai-absol", name: "Absol", hp: { from: percent(5), to: percent(0) }, fainted: true, facts: ["Burn"] }],
  },
];

/** The board after turn 3 (what the worker sends with the steps). */
function after(): BoardView {
  const base = boardView();
  const fainted = (view: PokemonView): PokemonView => ({ ...view, hp: percent(0), fainted: true });
  const garchomp: PokemonView = { ...base.active["own-left"]!, hp: exact(125, 183), boosts: { atk: 3, spd: -1 } };
  const incineroar: PokemonView = { ...base.team.own[2], slot: "own-right", hp: exact(202, 202) };
  return {
    ...base, turn: 4,
    active: { "own-left": garchomp, "own-right": incineroar, "opponent-left": fainted(base.active["opponent-left"]!), "opponent-right": fainted(base.active["opponent-right"]!) },
    team: {
      own: [garchomp, { ...base.team.own[1], slot: null }, incineroar, base.team.own[3]],
      opponent: base.team.opponent.map((view) => (view.slot ? fainted(view) : view)),
    },
  };
}
const TURN_3: LogTurn = {
  turn: 3, lines: [{ text: "Garchomp used Rock Slide → both foes.", kind: "move", slots: ["own-left"] }], steps: STEPS,
  actions: { own: { "own-left": { kind: "move", moveId: "rockslide", target: null } }, opponent: {} }, read: null,
};

function battle(overrides: Partial<TrainingBattle> = {}): TrainingBattle {
  return {
    id: 1, setup: trainingSetup(), seed: null, phase: { kind: "choose", request: moveRequest() }, board: boardView(), log: logTurns(),
    ai: { status: "idle" }, lastPreview: null, habitsBefore: emptyHabits(), savedId: "saved-1", startedAt: 0, ...overrides,
  };
}
const resolved = (overrides: Partial<TrainingBattle> = {}) => battle({ board: after(), log: [...logTurns(), TURN_3], phase: { kind: "choose", request: moveRequest({ id: 8 }) }, ...overrides });

let document: FakeDocument;
let root: { render: (node: unknown) => void; unmount: () => void };
let BattleScreen: typeof import("@/app/(app)/training/BattleScreen").default;
const session = { choose: vi.fn(), forfeit: vi.fn(), rematch: vi.fn(), changeTeams: vi.fn() };
let reduced = false;

beforeAll(async () => {
  document = installFakeDom();
  // prefers-reduced-motion as each test sets it (the fake DOM's matchMedia matches nothing).
  const media = (query: string) => ({ matches: reduced && query.includes("reduce"), addEventListener() {}, removeEventListener() {} });
  Object.assign(globalThis.window, { matchMedia: media });
  const { createRoot } = await import("react-dom/client");
  BattleScreen = (await import("@/app/(app)/training/BattleScreen")).default;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element) as unknown as typeof root;
});
afterAll(async () => { await act(async () => { root?.unmount(); }); });
afterEach(async () => {
  await act(async () => { root.render(null); });
  vi.useRealTimers();
  reduced = false;
});

async function show(value: TrainingBattle) {
  await act(async () => { root.render(createElement(BattleScreen, { runtime, battle: value, session, habits: emptyHabits() })); });
}
/** Advances the fake clock in 10 ms ticks, each in its own act(), so a timer set by an effect after a tick runs too. */
async function wait(ms: number) {
  for (let left = ms; left > 0; left -= 10) await act(async () => { vi.advanceTimersByTime(Math.min(10, left)); });
}
const query = (selector: string) => document.querySelectorAll(selector);
/** Elements by tag name under `root` (the fake DOM's selectors take letters-only tag names, so not "h2"). */
function byTag(root: FakeElement, tag: string): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (node: FakeElement) => node.childNodes.forEach((child) => {
    if (child instanceof FakeElement) { if (child.localName === tag) found.push(child); walk(child); }
  });
  walk(root);
  return found;
}
const heading = () => byTag(query("[data-training-turn]")[0], "h2")[0].textContent;
const popup = () => query("[data-training-popup]")[0] ?? null;
const popupTitle = () => query("[data-training-popup-title]")[0]?.textContent ?? null;
const popupSub = () => query("[data-training-popup-sub]")[0]?.textContent ?? null;
const titleColour = () => query("[data-training-popup-title]")[0]?.style.color;
const card = (slot: string) => query(`[data-training-card="${slot}"]`)[0];
const bar = (slot: string) => card(slot).querySelectorAll("[data-training-hp-bar]")[0];
const widths = (...slots: string[]) => slots.map((slot) => bar(slot).style.width);
const SLOTS = ["opponent-left", "opponent-right", "own-left", "own-right"];
const roles = () => Object.fromEntries(SLOTS.map((slot) => [slot, card(slot).getAttribute("data-training-step-role")]));
const labels = () => Object.fromEntries(SLOTS.map((slot) => [slot, card(slot).querySelectorAll("[data-training-step-label]").map((each) => each.textContent)]));
const controls = () => query("[data-training-controls]").length + query("[data-training-submit-bar]").length;
const name = (slot: string) => byTag(card(slot), "h3")[0]?.textContent.replace(/ \(.*\)$/, "") ?? null;
const progress = () => query("[data-training-playback-progress]")[0]?.textContent ?? null;
const announcer = () => query("[data-training-announcer]")[0].textContent;
const rock = getPokemonTypeColours("Rock")!;
const normal = getPokemonTypeColours("Normal")!;
const NONE = { "opponent-left": [], "opponent-right": [], "own-left": [], "own-right": [] };

describe("turn playback on the board", () => {
  it("each step: the popup with the move's name in its type colour, then its targets framed, HP bars sliding and results as labels", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await show(battle());
    expect(popup()).toBeNull();
    expect(controls()).toBeGreaterThan(0);

    await show(resolved());
    // Step 1, ANNOUNCE: the popup over the board as it was before the turn; your controls hidden, Skip shown.
    expect(popup()?.getAttribute("data-training-popup")).toBe("move");
    expect(popup()?.getAttribute("aria-hidden")).toBe("true");
    expect(query("[data-training-popup-layer]")).toHaveLength(1);
    expect(popupTitle()).toBe("Rock Slide");
    expect(titleColour()).toBe(rock.background);
    expect(query("[data-training-popup-title]")[0].style.textShadow).toContain(rock.foreground);
    expect(popup()?.style.animationDuration).toBe(`${ANNOUNCE_MS}ms`);
    expect(popupSub()).toBe("Garchomp");
    expect(heading()).toBe("Turn 3");
    expect(progress()).toBe("Turn 3 · step 1 of 4");
    expect(controls()).toBe(0);
    expect(query("[data-training-skip]")).toHaveLength(1);
    // Only the user is framed (dashed) while the popup shows; no labels yet; the HP before.
    expect(roles()).toEqual({ "opponent-left": null, "opponent-right": null, "own-left": "actor", "own-right": null });
    expect(card("own-left").style.outline).toBe(`2px dashed ${rock.background}`);
    expect(labels()).toEqual(NONE);
    expect(widths("opponent-left", "opponent-right", "own-left")).toEqual(["20%", "21%", `${(143 / 183) * 100}%`]);
    expect(bar("opponent-left").style.transition).toBe(`width ${HP_ANIMATION_MS}ms ease-out`);
    expect(card("opponent-left").querySelectorAll("[data-training-fainted]")).toHaveLength(0);
    // The live region reads the step once.
    // Each Pokémon as its card names it (the Mega Evolved Absol as "Absol-Mega").
    const read = "Garchomp used Rock Slide. Ampharos: 20% HP to 0% HP, Fainted. Absol-Mega: 21% HP to 5% HP, Critical hit. Garchomp: 143 / 183 HP to 125 / 183 HP, Life Orb.";
    expect(announcer()).toBe(read);

    // RESOLVE: the popup gone, the targets framed and tinted in Rock's colour, the bars at the HP after, the labels.
    await wait(ANNOUNCE_MS - 10);
    expect(popupTitle()).toBe("Rock Slide");
    await wait(10);
    expect(popup()).toBeNull();
    expect(roles()).toEqual({ "opponent-left": "target", "opponent-right": "target", "own-left": "actor", "own-right": null });
    expect(card("opponent-left").style.outline).toBe(`3px solid ${rock.background}`);
    expect(card("opponent-left").style.backgroundColor).toBe(`color-mix(in srgb, ${rock.background} 18%, transparent)`);
    expect(widths("opponent-left", "opponent-right", "own-left")).toEqual(["0%", "5%", `${(125 / 183) * 100}%`]);
    expect(bar("opponent-left").style.transition).toBe(`width ${HP_ANIMATION_MS}ms ease-out`);
    expect(labels()).toEqual({ "opponent-left": ["Fainted"], "opponent-right": ["Critical hit"], "own-left": ["Life Orb"], "own-right": [] });
    expect(card("opponent-left").querySelectorAll("[data-training-step-label]")[0].style.color).toBe("var(--color-danger)");
    expect(card("opponent-right").querySelectorAll("[data-training-step-label]")[0].style.borderColor).toBe(rock.background);
    expect(card("opponent-left").querySelectorAll("[data-training-fainted]")).toHaveLength(1);
    expect(announcer()).toBe(read);

    // Step 2 after RESOLVE_MS: a status move on its user (no name under it: its card shows who).
    await wait(RESOLVE_MS - 10);
    expect(roles()["opponent-left"]).toBe("target");
    await wait(10);
    expect(popupTitle()).toBe("Swords Dance");
    expect(titleColour()).toBe(normal.background);
    expect(popupSub()).toBeNull();
    expect(progress()).toBe("Turn 3 · step 2 of 4");
    expect(announcer()).toBe("Garchomp used Swords Dance. Garchomp: Attack +2.");
    // The previous step's results stay on the board: Ampharos fainted.
    expect(card("opponent-left").querySelectorAll("[data-training-fainted]")).toHaveLength(1);
    expect(labels()).toEqual(NONE);
    await wait(ANNOUNCE_MS);
    expect(roles()).toEqual({ "opponent-left": null, "opponent-right": null, "own-left": "target", "own-right": null });
    expect(card("own-left").style.outline).toBe(`3px solid ${normal.background}`);
    expect(labels()["own-left"]).toEqual(["Attack +2"]);
    expect(card("own-left").textContent).toContain("Atk +3");

    // Step 3: the switch pops up as a sentence in the text colour; the card swaps when it resolves.
    await wait(RESOLVE_MS);
    expect(popup()?.getAttribute("data-training-popup")).toBe("switch");
    expect(popupTitle()).toBe("Gyarados switches for Incineroar");
    expect(titleColour()).toBe("var(--color-text)");
    expect(name("own-right")).toBe("Gyarados");
    await wait(ANNOUNCE_MS);
    expect(name("own-right")).toBe("Incineroar");
    expect(card("own-right").style.outline).toBe("3px solid var(--color-accent)");
    expect(labels()).toMatchObject({ "own-right": ["Intimidate"], "opponent-right": ["Attack −1"] });

    // Step 4: the end of turn, its field result under it.
    await wait(RESOLVE_MS);
    expect(popupTitle()).toBe("End of turn");
    expect(popupSub()).toBe("Snow ended");
    expect(announcer()).toBe("End of turn. Absol-Mega: 5% HP to 0% HP, Burn, Fainted. Snow ended.");
    await wait(ANNOUNCE_MS);
    expect(roles()["opponent-right"]).toBe("target");
    expect(bar("opponent-right").style.width).toBe("0%");
    expect(labels()["opponent-right"]).toEqual(["Burn", "Fainted"]);

    // After the last step: the real board and your controls.
    await wait(RESOLVE_MS);
    expect(popup()).toBeNull();
    expect(progress()).toBeNull();
    expect(controls()).toBeGreaterThan(0);
    expect(roles()).toEqual({ "opponent-left": null, "opponent-right": null, "own-left": null, "own-right": null });
    expect(labels()).toEqual(NONE);
    expect(heading()).toBe("Turn 4");
    expect(bar("opponent-left").style.transition ?? "").toBe("");
    // Each step was read as it played: only the next request follows, not the turn's recap again.
    expect(announcer()).toBe("Turn 4.");
  });

  it("Skip jumps to the end: the real board and the controls at once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await show(battle());
    await show(resolved());
    await wait(ANNOUNCE_MS + RESOLVE_MS);
    expect(popupTitle()).toBe("Swords Dance");
    const skip = query("[data-training-skip]")[0];
    await act(async () => { (reactProps(skip).onClick as () => void)(); });
    expect(popup()).toBeNull();
    expect(controls()).toBeGreaterThan(0);
    expect(name("own-right")).toBe("Incineroar");
    expect(card("opponent-right").querySelectorAll("[data-training-fainted]")).toHaveLength(1);
    expect(document.activeElement?.localName).toBe("h2");
    // Skipped steps were not read: the turn's recap, then the next request.
    expect(announcer()).toMatch(/^Turn 3\. Garchomp used Rock Slide → both foes\..* Turn 4\.$/);
    await wait((ANNOUNCE_MS + RESOLVE_MS) * 3);
    expect(popup()).toBeNull();
  });

  it("prefers-reduced-motion: the popup and labels still show for each step, without the slide", async () => {
    reduced = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await show(battle());
    await show(resolved());
    expect(popupTitle()).toBe("Rock Slide");
    expect(bar("opponent-left").style.width).toBe("20%");
    expect(bar("opponent-left").style.transition ?? "").toBe("");
    await wait(ANNOUNCE_MS);
    expect(popup()).toBeNull();
    expect(bar("opponent-left").style.width).toBe("0%");
    expect(bar("opponent-left").style.transition ?? "").toBe("");
    expect(labels()["opponent-right"]).toEqual(["Critical hit"]);
    await wait(RESOLVE_MS);
    expect(popupTitle()).toBe("Swords Dance");
    expect(query("[data-training-skip]")).toHaveLength(1);
  });

  it("queues steps that arrive while playing (a mid-turn replacement) and never replays a turn shown before mounting", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await show(battle());
    const first = { ...TURN_3, steps: STEPS.slice(0, 2) };
    await show(battle({ board: after(), log: [...logTurns(), first], phase: { kind: "waiting", reason: "opponent-switch" } }));
    expect(popupTitle()).toBe("Rock Slide");
    expect(progress()).toBe("Turn 3 · step 1 of 2");
    // The fieldset stays enabled while playing so Skip works during the AI's replacement.
    expect(reactProps(query("fieldset")[0]).disabled).toBe(false);
    await show(resolved());
    expect(progress()).toBe("Turn 3 · step 1 of 4");
    await wait((ANNOUNCE_MS + RESOLVE_MS) * 2);
    expect(popupTitle()).toBe("Gyarados switches for Incineroar");
    await wait((ANNOUNCE_MS + RESOLVE_MS) * 2);
    expect(popup()).toBeNull();

    // A fresh mount (back to the tab) shows the board as it is.
    await act(async () => { root.render(null); });
    await show(resolved());
    expect(popup()).toBeNull();
    expect(controls()).toBeGreaterThan(0);
  });

  it("a hit before a Sitrus Berry: the bar dips to its lowest first, then comes back up, in the same RESOLVE_MS", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const hit: TurnStep = {
      kind: "move", title: "Close Combat", by: "Garchomp", results: [], type: "Fighting", actor: "own-left", targets: ["opponent-right"],
      slots: [{ slot: "opponent-right", key: "ai-absol", name: "Absol", hp: { from: percent(21), to: percent(18), low: percent(4) }, facts: ["Sitrus Berry"] }],
    };
    await show(battle());
    await show(resolved({ log: [...logTurns(), { ...TURN_3, steps: [hit] }] }));
    expect(bar("opponent-right").style.width).toBe("21%");
    expect(announcer()).toBe("Garchomp used Close Combat. Absol-Mega: 21% HP to 4% HP, then 18% HP, Sitrus Berry.");
    await wait(ANNOUNCE_MS);
    expect(bar("opponent-right").style.width).toBe("4%");
    expect(roles()["opponent-right"]).toBe("target");
    expect(labels()["opponent-right"]).toEqual(["Sitrus Berry"]);
    await wait(HP_ANIMATION_MS);
    expect(bar("opponent-right").style.width).toBe("18%");
    expect(labels()["opponent-right"]).toEqual(["Sitrus Berry"]);
    await wait(RESOLVE_MS - HP_ANIMATION_MS - 10);
    expect(progress()).toBe("Turn 3 · step 1 of 1");
    await wait(10);
    expect(progress()).toBeNull();
  });

  it("reads a step once: its names come from the board as it began, so a twin leaving mid-step changes nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const start = boardView();
    // The AI's Pokémon in opponent-left shows the same name as your Garchomp (a Transform): each card gets its side word.
    const twin = (view: PokemonView): PokemonView => (view.key === "ai-ampharos" ? { ...view, name: "Garchomp" } : view);
    const before: BoardView = { ...start, active: { ...start.active, "opponent-left": twin(start.active["opponent-left"]!) }, team: { ...start.team, opponent: start.team.opponent.map(twin) } };
    const incineroar: PokemonView = { ...start.team.own[2], slot: "own-left" };
    const later: BoardView = { ...before, turn: 4, active: { ...before.active, "own-left": incineroar }, team: { ...before.team, own: [{ ...start.team.own[0], slot: null }, start.team.own[1], incineroar, start.team.own[3]] } };
    const swap: TurnStep = {
      kind: "switch", title: "Garchomp switches for Incineroar", by: null, results: [], type: null, actor: null, targets: ["own-left"],
      slots: [
        { slot: "own-left", key: "own-incineroar", name: "Incineroar", entered: true, hp: { from: exact(202, 202), to: exact(202, 202) }, facts: ["Intimidate"] },
        { slot: "opponent-left", key: "ai-ampharos", name: "Garchomp", boosts: { atk: -1 }, facts: ["Attack −1"] },
      ],
    };
    await show(battle({ board: before }));
    await show(battle({ board: later, log: [...logTurns(), { ...TURN_3, steps: [swap] }], phase: { kind: "choose", request: moveRequest({ id: 8 }) } }));
    const read = "Garchomp switches for Incineroar. Incineroar: Intimidate. Garchomp (opponent's): Attack −1.";
    expect(announcer()).toBe(read);
    await wait(ANNOUNCE_MS);
    expect(name("own-left")).toBe("Incineroar");
    expect(announcer()).toBe(read);
  });

  it("styles: the popup's layer above every other element and clear of the pointer; no animation under reduced motion", () => {
    const css = readFileSync(join(process.cwd(), "app", "(app)", "training", "board", "board.module.css"), "utf8");
    expect(css).toMatch(/\.popupLayer \{[^}]*position: absolute;[^}]*z-index: 100;[^}]*pointer-events: none;/);
    expect(css).toMatch(/\.popup \{[^}]*position: sticky;[^}]*animation-name: popup;/);
    expect(css).toMatch(/\.popupMove \{[^}]*font-size: clamp\(2rem, 9vw, 3\.25rem\);[^}]*overflow-wrap: anywhere;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.popup,\s*\.label \{\s*animation: none;/);
  });
});

describe("playback (pure)", () => {
  it("takes the steps beyond those played, never turn 0", () => {
    const log = [{ ...logTurns()[0], steps: [STEPS[2]] }, TURN_3];
    expect(unplayedSteps(log, {}).queue.map((each) => [each.turn, each.index])).toEqual([[3, 0], [3, 1], [3, 2], [3, 3]]);
    expect(unplayedSteps(log, { 3: 3 }).queue.map((each) => each.index)).toEqual([3]);
    expect(unplayedSteps(log, { 3: 3 }).played).toEqual({ 0: 1, 3: 4 });
  });

  it("builds the board at a step from the board before the turn", () => {
    const queue = STEPS.map((step, index) => ({ turn: 3, index, step }));
    const start = playbackBoard(boardView(), after(), queue, 0, "from");
    expect(start.active["opponent-left"]).toMatchObject({ hp: percent(20), fainted: false });
    const second = playbackBoard(boardView(), after(), queue, 1, "from");
    expect(second.active["opponent-left"]).toMatchObject({ hp: percent(0), fainted: true });
    expect(second.active["own-left"]?.boosts).toEqual({ atk: 1, spd: -1 });
    // The switch's announce beat: the one it replaces is still there.
    expect(playbackBoard(boardView(), after(), queue, 2, "from").active["own-right"]?.key).toBe("own-gyarados");
    const third = playbackBoard(boardView(), after(), queue, 2, "to");
    expect(third.active["own-right"]).toMatchObject({ key: "own-incineroar", slot: "own-right", boosts: {} });
    expect(third.team.own.find((view) => view.key === "own-gyarados")?.slot).toBeNull();
    expect(third.team.own.find((view) => view.key === "own-incineroar")?.slot).toBe("own-right");
  });

  it("the popup: a move in its type colour with an outline in the type's own text colour; other steps in the text colour", () => {
    const blizzard: TurnStep = { ...STEPS[0], title: "Blizzard", type: "Ice", by: "Abomasnow" };
    const ice = getPokemonTypeColours("Ice")!;
    expect(popupOf(blizzard)).toEqual({ title: "Blizzard", sub: "Abomasnow", move: true, colour: ice.background, outline: ice.foreground });
    // Its user as its card names it (a Mega Evolved form, a side word); the step's own name without one.
    expect(popupOf(blizzard, "Abomasnow-Mega").sub).toBe("Abomasnow-Mega");
    expect(popupOf({ ...blizzard, by: "Garchomp (yours)" }, "Garchomp (yours)").sub).toBe("Garchomp (yours)");
    expect(popupOf({ ...blizzard, by: "Garchomp (2)" }, null).sub).toBe("Garchomp (2)");
    expect(popupOf({ ...STEPS[1] }, "Garchomp").sub).toBeNull();
    const uturn: TurnStep = { ...STEPS[2], title: "U-turn: Staraptor switches for Venusaur" };
    expect(popupOf(uturn)).toEqual({ title: "U-turn: Staraptor switches for Venusaur", sub: null, move: false, colour: "var(--color-text)", outline: "var(--color-bg)" });
    expect(popupOf({ ...STEPS[0], kind: "mega", title: "Charizard Mega Evolves", type: null, by: null })).toMatchObject({ move: false, sub: null });
  });

  it("card labels: the card's facts, Fainted, and on a target the step's own results", () => {
    expect(cardLabels(STEPS[0], "opponent-left")).toEqual(["Fainted"]);
    expect(cardLabels(STEPS[0], "own-right")).toEqual([]);
    const failed: TurnStep = { kind: "move", title: "Protect", by: null, results: ["Failed"], type: "Normal", actor: "own-right", targets: ["own-right"], slots: [] };
    expect(cardLabels(failed, "own-right")).toEqual(["Failed"]);
    // The end of turn's field results go under its popup, not on the cards.
    expect(cardLabels(STEPS[3], "opponent-right")).toEqual(["Burn", "Fainted"]);
    expect(stepAnnouncement(failed, () => "Gyarados")).toBe("Gyarados used Protect. Failed.");
  });

  it("the live region names each Pokémon as its card does: its team's word on both sides' names, a number for one side's two", () => {
    const board = boardView();
    expect(spokenName(board, "opponent-right")).toBe(board.active["opponent-right"]!.name);
    expect(spokenName(board, "own-left", "own-garchomp")).toBe("Garchomp");
    const twins: BoardView = { ...board, active: { ...board.active, "opponent-left": { ...board.active["opponent-left"]!, key: "ai-garchomp", name: "Garchomp" } } };
    expect(spokenName(twins, "own-left")).toBe("Garchomp (yours)");
    expect(spokenName(twins, "opponent-left", "ai-garchomp")).toBe("Garchomp (opponent's)");
    const hit: TurnStep = {
      kind: "move", title: "Earthquake", by: "Garchomp (opponent's)", results: [], type: "Ground", actor: "opponent-left", targets: ["own-left"],
      slots: [{ slot: "own-left", key: "own-garchomp", name: "Garchomp", hp: { from: exact(143, 183), to: exact(100, 183) }, facts: [] }],
    };
    expect(stepAnnouncement(hit, (slot, key) => spokenName(twins, slot, key))).toBe("Garchomp (opponent's) used Earthquake. Garchomp (yours): 143 / 183 HP to 100 / 183 HP.");
    // A name on both teams (BoardView.mirrored) carries the word on the bench too; two of one name on a side are numbered.
    const mirrored: BoardView = { ...board, mirrored: ["ai-annihilape", "own-gyarados"] };
    expect(spokenName(mirrored, "opponent-left", "ai-annihilape")).toBe("Annihilape (opponent's)");
    expect(spokenName(mirrored, "own-right")).toBe("Gyarados (yours)");
    const sameSide: BoardView = { ...board, active: { ...board.active, "own-right": { ...board.active["own-right"]!, name: "Garchomp" } } };
    expect([spokenName(sameSide, "own-left"), spokenName(sameSide, "own-right")]).toEqual(["Garchomp (1)", "Garchomp (2)"]);
    expect(spokenName({ ...board, active: { ...board.active, "own-right": null } }, "own-right")).toBeNull();
  });

  // Naming review T4: one team on both sides gives both teams the same member keys; each is looked up on its own side.
  it("a member key on both teams: the live region and the playback board take the Pokémon of the slot's side", () => {
    const board = boardView();
    const as = (view: PokemonView, key: string, name: string, slot: PokemonView["slot"]): PokemonView => ({ ...view, key, name, speciesId: key, slot });
    const ownCharizard = as(board.active["own-left"]!, "charizard", "Charizard", "own-left");
    const ownIncineroar = as(board.team.own[2], "incineroar", "Incineroar", null);
    const foeCharizard = as(board.active["opponent-right"]!, "charizard", "Charizard", "opponent-right");
    const foeIncineroar = as(board.team.opponent[2], "incineroar", "Incineroar", null);
    const mirror: BoardView = {
      ...board, mirrored: ["charizard", "incineroar"],
      active: { ...board.active, "own-left": ownCharizard, "opponent-right": { ...foeCharizard, mega: false } },
      team: { own: [ownCharizard, board.team.own[1], ownIncineroar], opponent: [{ ...foeCharizard, mega: false }, board.team.opponent[1], foeIncineroar] },
    };
    // The opponent's Incineroar comes in (the announce beat: it is not on its slot yet); yours stays on the bench.
    expect(spokenName(mirror, "opponent-left", "incineroar")).toBe("Incineroar (opponent's)");
    expect(spokenName(mirror, "own-right", "incineroar")).toBe("Incineroar (yours)");
    expect(spokenName(mirror, "opponent-right", "charizard")).toBe("Charizard (opponent's)");
    // The opponent's Charizard Mega Evolves: your Charizard keeps its own view.
    const megaY = { ...foeCharizard, name: "Charizard-Mega-Y", speciesId: "charizardmegay", mega: true };
    const latest: BoardView = { ...mirror, active: { ...mirror.active, "opponent-right": megaY }, team: { ...mirror.team, opponent: [megaY, board.team.opponent[1], foeIncineroar] } };
    const mega: TurnStep = { kind: "mega", title: "Charizard Mega Evolves", by: null, results: [], type: null, actor: "opponent-right", targets: [], slots: [{ slot: "opponent-right", key: "charizard", name: "Charizard (opponent's)", mega: true, facts: [] }] };
    const played = playbackBoard(mirror, latest, [{ turn: 3, index: 0, step: mega }], 0, "to");
    expect([played.active["own-left"]?.name, played.active["opponent-right"]?.name]).toEqual(["Charizard", "Charizard-Mega-Y"]);
    expect([played.team.own[0].name, played.team.own[0].slot, played.team.opponent[0].name, played.team.opponent[0].slot]).toEqual(["Charizard", "own-left", "Charizard-Mega-Y", "opponent-right"]);
    expect(spokenName(played, "own-left")).toBe("Charizard (yours)");
  });
});
