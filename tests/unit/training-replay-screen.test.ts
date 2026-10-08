import { createElement } from "react";
import { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { IDLE_MS, replayTurns } from "@/app/(app)/training/replay/replay-playback";
import { ANNOUNCE_MS, RESOLVE_MS } from "@/app/(app)/training/board/playback";
import { DEFAULT_INFO } from "@/app/(app)/training/model/info";
import { summaryOf, type ReplayState, type SavedBattle } from "@/app/(app)/training/model/saved-battle";
import { TRAINING_FORMAT_ID, type TrainingSetup } from "@/app/(app)/training/model/view-types";
import { playBattle, replayBattle } from "@/scripts/training/lib/saved-check";
import { parsePools, teamPair } from "@/scripts/training/lib/teams";
import { FakeElement, installFakeDom, reactProps, type FakeDocument } from "../fixtures/fake-dom";

// The replay screen in the fake DOM, on a battle played and re-run in the real worker: Play shows each step's popup and
// results with the battle's timings (halved at 2×), Pause holds, Previous / Next / the slider move by turns.

let document: FakeDocument;
let root: { render(node: unknown): void; unmount(): void };
let ReplayScreen: typeof import("@/app/(app)/training/replay/ReplayScreen").default;
let replay: ReplayState;
const session = { closeReplay: vi.fn(), exportSaved: vi.fn(async () => null) };

beforeAll(async () => {
  const pair = teamPair("saved-screen", 0, parsePools("S,V"), runtime);
  const setup: TrainingSetup = { own: pair.p1.team, opponent: pair.p2.team, difficulty: "safe", showRead: true, info: DEFAULT_INFO };
  const played = await playBattle({ run: "saved-screen", index: 0, setup, seat: "random", sealer: null });
  const ended = played.ended!;
  const rerun = await replayBattle(setup, ended);
  if (!rerun.ok) throw new Error(rerun.error);
  const log = [...played.log.values()].sort((a, b) => a.turn - b.turn);
  const record: SavedBattle = {
    version: 1, id: "r1", status: "finished", source: "played", format: TRAINING_FORMAT_ID, rules: "c23d2e94", createdAt: 0, updatedAt: 0, setup,
    turn: ended.board.turn, result: { result: ended.ended!.result, forfeited: ended.ended!.forfeited }, seed: ended.seed, inputLog: ended.inputLog!,
    log, resume: null, habitsBefore: null, habitsAfter: null, order: null,
  };
  replay = { id: "r1", summary: summaryOf(record), setup, log, status: "board", boards: { starts: rerun.message.starts, end: rerun.message.end }, message: null };

  document = installFakeDom();
  Object.assign(globalThis.window, { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  const { createRoot } = await import("react-dom/client");
  ReplayScreen = (await import("@/app/(app)/training/replay/ReplayScreen")).default;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element) as unknown as typeof root;
}, 60_000);
afterAll(async () => { await act(async () => { root?.unmount(); }); });
afterEach(async () => {
  await act(async () => { root.render(null); });
  vi.useRealTimers();
});

async function show() {
  await act(async () => { root.render(createElement(ReplayScreen, { runtime, replay, session })); });
}
async function wait(ms: number) {
  for (let left = ms; left > 0; left -= 10) await act(async () => { vi.advanceTimersByTime(Math.min(10, left)); });
}
const query = (selector: string) => document.querySelectorAll(selector);
const button = (text: string) => query("button").find((each) => each.getAttribute("aria-label") === text || each.textContent === text)!;
const click = async (text: string) => { await act(async () => { (reactProps(button(text)).onClick as () => void)(); }); };
const position = () => query("[data-training-replay-position]")[0].textContent;
const popupTitle = () => query("[data-training-popup-title]")[0]?.textContent ?? null;
const announcer = () => query("[data-training-announcer]")[0].textContent;
const firstTurnWithSteps = () => replayTurns(replay.log, replay.boards!).findIndex((turn) => turn.steps.length > 0);

describe("replay screen playback", () => {
  it("Play: the turn's board, then each step's popup and results; Pause holds; it reaches the end", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await show();
    const turns = replayTurns(replay.log, replay.boards!);
    expect(turns.length).toBeGreaterThan(1);
    expect(position()).toBe(`Turn 1 of ${turns.at(-1)!.turn}`);
    expect((document.activeElement as FakeElement | null)?.textContent).toBe("Replay");
    expect(popupTitle()).toBeNull();
    const first = firstTurnWithSteps();
    for (let i = 0; i < first; i++) await click("Next turn");
    const panel = () => query("[data-training-replay-turn]")[0]?.getAttribute("aria-label") ?? null;
    // Before the turn's steps the panel shows the turn that resolved before it (as the battle's Last turn did).
    expect(panel()).not.toBe(`Turn ${turns[first].turn}`);
    await click("Play");
    expect(button("Pause")).toBeDefined();
    await wait(IDLE_MS);
    const step = turns[first].steps[0];
    expect(popupTitle()).toBe(step.title);
    expect(panel()).toBe(`Turn ${turns[first].turn}`);
    expect(announcer()).toContain(step.kind === "move" ? `used ${step.title}.` : `${step.title}.`);
    expect(position()).toContain("step 1 of");
    await wait(ANNOUNCE_MS);
    expect(popupTitle()).toBeNull();
    await click("Pause");
    const held = position();
    await wait(RESOLVE_MS * 3);
    expect(position()).toBe(held);
    await click("Play");
    await wait(60_000 * 10);
    expect(position()).toBe("End");
    expect(button("Play")).toBeDefined();
    expect(announcer()).toMatch(/^End\. (Won|Lost|Tie|Forfeited)\.$/);
  }, 60_000);

  it("2× halves each beat", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await show();
    const first = firstTurnWithSteps();
    for (let i = 0; i < first; i++) await click("Next turn");
    await click("2×");
    expect(button("2×").getAttribute("aria-pressed")).toBe("true");
    await click("Play");
    await wait(IDLE_MS / 2);
    expect(popupTitle()).not.toBeNull();
    await wait(ANNOUNCE_MS / 2);
    expect(popupTitle()).toBeNull();
  });

  it("Previous, Next and the slider move by turns", async () => {
    await show();
    const turns = replayTurns(replay.log, replay.boards!);
    await click("Next turn");
    expect(position()).toBe(`Turn ${turns[1].turn} of ${turns.at(-1)!.turn}`);
    await click("Previous turn");
    expect(position()).toBe(`Turn ${turns[0].turn} of ${turns.at(-1)!.turn}`);
    const slider = query("input").find((each) => each.getAttribute("aria-valuetext") !== null)!;
    await act(async () => { (reactProps(slider).onChange as (event: unknown) => void)({ target: { value: String(turns.length) } }); });
    expect(position()).toBe("End");
    // At the ends Next / Previous are aria-disabled, not disabled: the button keeps the keyboard focus, and a press does nothing.
    const next = button("Next turn");
    await act(async () => { next.focus(); });
    await click("Next turn");
    expect(position()).toBe("End");
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(reactProps(next).disabled).toBeFalsy();
    expect(document.activeElement).toBe(next);
    await act(async () => { (reactProps(slider).onChange as (event: unknown) => void)({ target: { value: "0" } }); });
    expect(button("Previous turn").getAttribute("aria-disabled")).toBe("true");
    await click("Previous turn");
    expect(position()).toBe(`Turn ${turns[0].turn} of ${turns.at(-1)!.turn}`);
    expect(button("Next turn").getAttribute("aria-disabled")).toBeNull();
    await click("Close replay");
    expect(session.closeReplay).toHaveBeenCalled();
  });
});

describe("Saved battles keyboard focus", () => {
  const saved = (ids: string[]) => ({
    status: "ready" as const, message: null, import: { status: "idle" as const }, autosaved: null,
    list: ids.map((id) => ({ ...replay.summary, id })),
  });
  const actions = () => ({ openReplay: vi.fn(), resume: vi.fn(), deleteSaved: vi.fn(), deleteAllSaved: vi.fn(), importSaved: vi.fn(), exportSaved: vi.fn(async () => null) });

  it("closing a replay gives the focus back to its row's Replay button; a delete moves it to the heading", async () => {
    const SavedBattles = (await import("@/app/(app)/training/saved/SavedBattles")).default;
    const session = actions();
    const onReturned = vi.fn();
    await act(async () => { root.render(createElement(SavedBattles, { saved: saved(["a", "b"]), session, returnTo: "b", onReturned })); });
    const focused = document.activeElement as FakeElement;
    expect(focused.getAttribute("data-training-replay-for")).toBe("b");
    expect(onReturned).toHaveBeenCalledOnce();
    Object.assign(globalThis.window, { confirm: () => true });
    const remove = query("button").find((each) => each.getAttribute("aria-label")?.startsWith("Delete "))!;
    await act(async () => { (reactProps(remove).onClick as () => void)(); });
    expect(session.deleteSaved).toHaveBeenCalledWith("a");
    expect((document.activeElement as FakeElement).getAttribute("data-training-saved-heading")).not.toBeNull();
  });
});
