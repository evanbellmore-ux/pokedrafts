import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReplayScreen from "@/app/(app)/training/replay/ReplayScreen";
import {
  beatDelay, IDLE_MS, nextTurn, play, positionText, previousTurn, replayFrame, replayTurns, seek, START, tick, type ReplayPosition,
} from "@/app/(app)/training/replay/replay-playback";
import SavedBattles, { ResumePrompt } from "@/app/(app)/training/saved/SavedBattles";
import { ANNOUNCE_MS, HP_ANIMATION_MS, RESOLVE_MS } from "@/app/(app)/training/board/playback";
import type { ReplayState, SavedBattlesState, SavedBattleSummary } from "@/app/(app)/training/model/saved-battle";
import type { LogTurn, TurnStep } from "@/app/(app)/training/model/view-types";
import { FORMAT_FACTS } from "@/app/(app)/training/model/format-facts";
import { isoTime, savedDate } from "@/app/(app)/training/saved/download";
import { capture, textOf } from "../fixtures/jsx-capture";
import { boardView, logTurns, runtime, trainingSetup } from "../fixtures/training";

vi.mock("react/jsx-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));
vi.mock("react/jsx-dev-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));

afterEach(() => { vi.unstubAllGlobals(); });

const CREATED = new Date(2026, 9, 8, 14, 2).getTime();
const summary = (patch: Partial<SavedBattleSummary> = {}): SavedBattleSummary => ({
  id: "f1", status: "finished", source: "played", createdAt: CREATED, updatedAt: CREATED + 60_000, own: "Your team", opponent: "Rival", turn: 7,
  result: { result: "win", forfeited: false }, difficulty: "safe", ...patch,
});
const savedState = (patch: Partial<SavedBattlesState> = {}): SavedBattlesState => ({
  status: "ready", list: [summary(), summary({ id: "u1", status: "unfinished", turn: 3, result: null }), summary({ id: "i1", source: "imported", result: { result: "loss", forfeited: true }, turn: 4 })],
  message: null, import: { status: "idle" }, autosaved: null, ...patch,
});
const actions = () => ({
  openReplay: vi.fn(), resume: vi.fn(), deleteSaved: vi.fn(), deleteAllSaved: vi.fn(), importSaved: vi.fn(),
  exportSaved: vi.fn(async () => null as { name: string; text: string } | null),
});
const buttons = (elements: { type: string; props: Record<string, unknown> }[]) => elements.filter((element) => element.type === "button");
const named = (elements: { type: string; props: Record<string, unknown> }[], label: string) => buttons(elements).find((button) => button.props["aria-label"] === label || textOf(button.props.children) === label);

describe("Saved battles list (setup screen)", () => {
  it("lists date, teams, result and turns with Replay, Export and Delete (Resume for an unfinished one), Import and Delete all", () => {
    const session = actions();
    const { result: html, elements } = capture(() => renderToStaticMarkup(createElement(SavedBattles, { saved: savedState(), session })));
    expect(html).toContain(">Saved battles</h2>");
    expect(html).toContain("3 of 100 in this browser · oldest removed first");
    expect(html).toContain("Your team vs Rival");
    expect(html).toContain(" · Won · 7 turns");
    expect(html).toContain(" · Unfinished · Turn 3");
    expect(html).toContain(" · Forfeited · 4 turns · Imported");
    expect(html).toMatch(/<time dateTime="2026-10-0\dT\d\d:02:00.000Z">/);
    expect(html).toContain("Export file (.json), up to 2 MB");
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept=".json,application\/json"[^>]*hidden=""/);
    const labels = buttons(elements).map((button) => String(button.props["aria-label"] ?? textOf(button.props.children)));
    expect(labels.filter((label) => label.startsWith("Replay "))).toHaveLength(2);
    expect(labels.filter((label) => label.startsWith("Export "))).toHaveLength(2);
    expect(labels.filter((label) => label.startsWith("Resume "))).toHaveLength(1);
    expect(labels.filter((label) => label.startsWith("Delete ") && label !== "Delete all")).toHaveLength(3);
    expect(labels).toContain("Import");
    expect(labels).toContain("Delete all");
    vi.stubGlobal("window", { confirm: vi.fn(() => true) });
    const replay = buttons(elements).find((button) => String(button.props["aria-label"]).startsWith("Replay Your team vs Rival"))!;
    (replay.props.onClick as () => void)();
    expect(session.openReplay).toHaveBeenCalledWith("f1");
    (buttons(elements).find((button) => String(button.props["aria-label"]).startsWith("Resume "))!.props.onClick as () => void)();
    expect(session.resume).toHaveBeenCalledWith("u1");
    (buttons(elements).find((button) => String(button.props["aria-label"]).startsWith("Delete "))!.props.onClick as () => void)();
    expect(session.deleteSaved).toHaveBeenCalledWith("f1");
    (named(elements, "Delete all")!.props.onClick as () => void)();
    expect(window.confirm).toHaveBeenLastCalledWith("Delete all 3 saved battles?");
    expect(session.deleteAllSaved).toHaveBeenCalledOnce();
    // The file input hands the chosen file to the store.
    const input = elements.find((element) => element.type === "input" && element.props.type === "file")!;
    const file = { name: "x.json", size: 3, text: async () => "{}" };
    const target = { files: [file], value: "C:\\fakepath\\x.json" };
    (input.props.onChange as (event: unknown) => void)({ target });
    expect(session.importSaved).toHaveBeenCalledWith(file);
    expect(target.value).toBe("");
  });

  it("states facts: none saved, unavailable storage, storage full, import checks and errors", () => {
    const render = (saved: SavedBattlesState) => renderToStaticMarkup(createElement(SavedBattles, { saved, session: actions() }));
    expect(render(savedState({ list: [] }))).toContain("No saved battles");
    expect(render(savedState({ list: [] }))).not.toContain("Delete all");
    const unavailable = render(savedState({ status: "unavailable", list: [], message: "Saved battles are unavailable in this browser." }));
    expect(unavailable).toContain("Saved battles are unavailable in this browser.");
    expect(unavailable).not.toContain("Import");
    expect(render(savedState({ message: "Storage is full. Turn 4 was not saved for Resume." }))).toMatch(/role="status"[^>]*>Storage is full. Turn 4 was not saved for Resume.</);
    expect(render(savedState({ import: { status: "checking", name: "a.json" } }))).toContain("Checking a.json…");
    expect(render(savedState({ import: { status: "error", name: "a.json", message: "The file is not JSON." } }))).toMatch(/role="alert"[^>]*>a.json: The file is not JSON.</);
    expect(render(savedState({ status: "loading", list: [] }))).toContain("Loading saved battles…");
    expect(render(savedState({ status: "idle", list: [] }))).toBe("");
  });

  it("offers Resume for the newest unfinished battle above the setup", () => {
    const session = actions();
    const { result: html, elements } = capture(() => renderToStaticMarkup(createElement(ResumePrompt, { saved: savedState(), session })));
    expect(html).toContain(">Unfinished battle</h2>");
    expect(html).toContain("Turn 3 · Saved <time");
    (buttons(elements)[0].props.onClick as () => void)();
    expect(session.resume).toHaveBeenCalledWith("u1");
    expect(renderToStaticMarkup(createElement(ResumePrompt, { saved: savedState({ list: [summary()] }), session }))).toBe("");
  });

  it("a time no Date holds renders as a fact instead of throwing", () => {
    expect(savedDate(Number.MAX_SAFE_INTEGER)).toBe("Unknown date");
    expect(isoTime(Number.MAX_SAFE_INTEGER)).toBeUndefined();
    expect(isoTime(CREATED)).toBe(new Date(CREATED).toISOString());
    const html = renderToStaticMarkup(createElement(SavedBattles, { saved: savedState({ list: [summary({ createdAt: Number.MAX_SAFE_INTEGER })] }), session: actions() }));
    expect(html).toContain("<time>Unknown date</time> · Won · 7 turns");
  });

  it("script-like team labels and file names render as text", () => {
    const evil = "<script>alert(1)</script>";
    const html = renderToStaticMarkup(createElement(SavedBattles, {
      saved: savedState({ list: [summary({ own: evil, opponent: '<img src=x onerror="alert(2)">' })], import: { status: "error", name: `${evil}.json`, message: "The file is not JSON." } }),
      session: actions(),
    }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; vs &lt;img src=x onerror=&quot;alert(2)&quot;&gt;");
    const replay = renderToStaticMarkup(createElement(ReplayScreen, {
      runtime, replay: { id: "x", summary: summary({ own: evil }), setup: trainingSetup(), log: logTurns(), status: "log", boards: null, message: null }, session: { closeReplay: vi.fn(), exportSaved: vi.fn(async () => null) },
    }));
    expect(replay).not.toContain("<script>");
  });

  it("Import stays focusable while a file is checked (aria-disabled, not disabled) and ignores presses", () => {
    const { elements } = capture(() => renderToStaticMarkup(createElement(SavedBattles, { saved: savedState({ import: { status: "checking", name: "a.json" } }), session: actions() })));
    const importing = buttons(elements).find((button) => textOf(button.props.children) === "Checking…")!;
    expect(importing.props["aria-disabled"]).toBe(true);
    expect(importing.props["aria-busy"]).toBe(true);
    expect(importing.props.disabled).toBeFalsy();
    expect(() => (importing.props.onClick as () => void)()).not.toThrow();
  });

  it("the format facts say battles are saved in this browser", () => {
    expect(FORMAT_FACTS.find((fact) => fact.term === "Battles")?.value).toBe("Saved in this browser (up to 100)");
  });
});

// ---------- the replay screen ----------
const exact = (current: number, maximum: number) => ({ kind: "exact" as const, current, maximum });
const STEP_A: TurnStep = {
  kind: "move", title: "Rock Slide", by: null, results: [], type: "Rock", targets: ["opponent-left", "opponent-right"], actor: "own-left",
  slots: [{ slot: "opponent-left", key: "ai-ampharos", name: "Ampharos", hp: { from: { kind: "percent", percent: 60 }, to: { kind: "percent", percent: 20 } }, facts: [] }],
};
const STEP_DIP: TurnStep = {
  kind: "move", title: "Waterfall", by: null, results: [], type: "Water", targets: ["own-left"], actor: "opponent-right",
  slots: [{ slot: "own-left", key: "own-garchomp", name: "Garchomp", hp: { from: exact(183, 183), to: exact(150, 183), low: exact(100, 183) }, facts: ["Sitrus Berry"] }],
};
function replayLog(): LogTurn[] {
  const log = logTurns();
  log[1] = { ...log[1], steps: [STEP_A, STEP_DIP] };
  log[2] = { ...log[2], steps: [] };
  return log;
}
const BOARDS = { starts: { 1: boardView({ turn: 1 }), 2: boardView({ turn: 2 }) }, end: boardView({ turn: 3 }) };

describe("replay playback (pure)", () => {
  const turns = replayTurns(replayLog(), BOARDS);
  it("takes each turn the board began, with its steps and the board it led to", () => {
    expect(turns.map((turn) => [turn.turn, turn.steps.length, turn.start.turn, turn.next.turn])).toEqual([[1, 2, 1, 2], [2, 0, 2, 3]]);
  });

  it("plays each step's beats (the dip when HP came back up), then the next turn, and stops after the last", () => {
    let position: ReplayPosition = play(turns, START);
    const seen: string[] = [];
    for (let i = 0; i < 12 && position.playing; i++) {
      seen.push(`${position.at}:${position.step}:${position.beat}`);
      position = tick(turns, position);
    }
    expect(seen).toEqual(["0:0:idle", "0:0:announce", "0:0:resolve", "0:1:announce", "0:1:dip", "0:1:resolve", "1:0:idle"]);
    expect(position).toEqual({ at: 2, step: 0, beat: "idle", playing: false });
    expect(positionText(turns, position)).toBe("End");
    expect(replayFrame(turns, BOARDS.end, position)).toEqual({ board: BOARDS.end, step: null, stepStart: null, turn: null });
    // Play at the end starts again from the first turn.
    expect(play(turns, position)).toEqual({ at: 0, step: 0, beat: "idle", playing: true });
  });

  it("times beats as the battle's playback, halved at 2×", () => {
    const at = (step: number, beat: ReplayPosition["beat"]): ReplayPosition => ({ at: 0, step, beat, playing: true });
    expect(beatDelay(turns, at(0, "idle"), 1)).toBe(IDLE_MS);
    expect(beatDelay(turns, at(0, "announce"), 1)).toBe(ANNOUNCE_MS);
    expect(beatDelay(turns, at(0, "resolve"), 1)).toBe(RESOLVE_MS);
    expect(beatDelay(turns, at(1, "dip"), 1)).toBe(HP_ANIMATION_MS);
    expect(beatDelay(turns, at(1, "resolve"), 1)).toBe(RESOLVE_MS - HP_ANIMATION_MS);
    expect(beatDelay(turns, at(0, "announce"), 2)).toBe(ANNOUNCE_MS / 2);
  });

  it("Previous goes to this turn's start, then the turn before; Next and the slider jump to a turn's start", () => {
    const mid: ReplayPosition = { at: 1, step: 0, beat: "announce", playing: true };
    expect(previousTurn(mid)).toEqual({ at: 1, step: 0, beat: "idle", playing: true });
    expect(previousTurn(previousTurn(mid))).toEqual({ at: 0, step: 0, beat: "idle", playing: true });
    expect(previousTurn(START)).toEqual(START);
    expect(nextTurn(turns, { at: 0, step: 1, beat: "resolve", playing: false })).toEqual({ at: 1, step: 0, beat: "idle", playing: false });
    expect(nextTurn(turns, { at: 1, step: 0, beat: "idle", playing: true })).toEqual({ at: 2, step: 0, beat: "idle", playing: false });
    expect(seek(turns, START, 7)).toEqual({ at: 2, step: 0, beat: "idle", playing: false });
    expect(seek(turns, START, 1)).toEqual({ at: 1, step: 0, beat: "idle", playing: false });
    expect(positionText(turns, START)).toBe("Turn 1 of 2");
  });

  it("the frame: the turn's board before its steps, a step's board at its beat", () => {
    expect(replayFrame(turns, BOARDS.end, START).board).toBe(BOARDS.starts[1]);
    const announce = replayFrame(turns, BOARDS.end, { at: 0, step: 0, beat: "announce", playing: true });
    expect(announce.step?.step.title).toBe("Rock Slide");
    expect(announce.board.active["opponent-left"]?.hp).toEqual({ kind: "percent", percent: 60 });
    const resolve = replayFrame(turns, BOARDS.end, { at: 0, step: 0, beat: "resolve", playing: true });
    expect(resolve.board.active["opponent-left"]?.hp).toEqual({ kind: "percent", percent: 20 });
    const dip = replayFrame(turns, BOARDS.end, { at: 0, step: 1, beat: "dip", playing: true });
    expect(dip.board.active["own-left"]?.hp).toEqual(exact(100, 183));
  });
});

describe("replay screen (server render)", () => {
  const replay = (patch: Partial<ReplayState> = {}): ReplayState => ({
    id: "f1", summary: summary(), setup: trainingSetup(), log: replayLog(), status: "board", boards: BOARDS, message: null, ...patch,
  });
  const session = { closeReplay: vi.fn(), exportSaved: vi.fn(async () => null) };

  it("shows the facts, the controls (Previous, Play, Next, the turn slider, 1× / 2×), the board and the log", () => {
    const { result: html, elements } = capture(() => renderToStaticMarkup(createElement(ReplayScreen, { runtime, replay: replay(), session })));
    expect(html).toContain('data-training-screen="replay"');
    expect(html).toMatch(/<h2[^>]*tabindex="-1"[^>]*>Replay<\/h2>/);
    expect(html).toContain("Your team vs Rival");
    expect(html).toContain(" · Won · 7 turns · Plays safe");
    expect(html).toContain("You saw: Open: Natures · Items · Abilities · Moves · Closed: Stat Points");
    expect(html).toMatch(/<input[^>]*type="range"[^>]*min="0"[^>]*max="2"[^>]*aria-valuetext="Turn 1 of 2"/);
    expect(html).toContain('data-training-board');
    expect(html).toContain('data-training-log');
    expect(html).toContain('data-training-announcer');
    expect(html).toContain(">Turn 1 of 2</output>");
    // Before turn 1's steps play, the panel shows what resolved before it (Start), as the battle did: not turn 1's lines yet.
    expect(html).toMatch(/data-training-replay-turn[^>]*aria-label="Start"/);
    const labels = buttons(elements).map((button) => String(button.props["aria-label"] ?? textOf(button.props.children)));
    expect(labels).toEqual(["Export", "Close replay", "Previous turn", "Play", "Next turn", "1×", "2×"]);
    expect(buttons(elements).find((button) => textOf(button.props.children) === "1×")!.props["aria-pressed"]).toBe(true);
    (named(elements, "Close replay")!.props.onClick as () => void)();
    expect(session.closeReplay).toHaveBeenCalledOnce();
  });

  it("while re-running: a status; when the re-run differs or fails: the fact and the saved log only", () => {
    const loading = renderToStaticMarkup(createElement(ReplayScreen, { runtime, replay: replay({ status: "loading", boards: null }), session }));
    expect(loading).toContain("Re-running the battle…");
    expect(loading).not.toContain("data-training-board");
    const log = renderToStaticMarkup(createElement(ReplayScreen, { runtime, replay: replay({ status: "log", boards: null, message: "The re-run differs from the saved log from turn 2. The saved log is shown." }), session }));
    expect(log).toContain("The re-run differs from the saved log from turn 2. The saved log is shown.");
    expect(log).toContain("data-training-log");
    expect(log).not.toContain("data-training-board");
    expect(log).not.toContain('type="range"');
  });
});
