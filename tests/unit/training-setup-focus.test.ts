import { act, createElement, useState } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReplayState, SavedBattlesState, SavedBattleSummary } from "@/app/(app)/training/model/saved-battle";
import type { TrainingBattle, TrainingSnapshot, SetupDraft, SuggestionState, TeamSourceDraft } from "@/app/(app)/training/model/view-types";
import type { DoublesSideId } from "@/app/lib/battle/doubles-types";
import { emptyHabits } from "@/app/(app)/training/model/habits-data";
import { createSetupDraft, emptySource, resolveSetup, resolveTeam } from "@/app/(app)/training/setup/team-draft";
import type TeamSourcePanelType from "@/app/(app)/training/setup/TeamSourcePanel";
import type TrainingClientType from "@/app/(app)/training/TrainingClient";
import { initialSnapshot } from "@/app/(app)/training/training-session";
import { installFakeDom, reactProps, type FakeDocument, type FakeElement } from "../fixtures/fake-dom";
import { OPPONENT_ROSTER, OWN_ROSTER, PREVIEW_REQUEST, rosterState, runtime, suggestedSet, trainingSetup } from "../fixtures/training";

// Keyboard focus after the setup's controls unmount themselves (fake DOM): Edit as PokéPaste → the importer's Team text,
// Import team → Choose 6, Change teams → Your team's heading, a closed replay → the Replay button that opened it. The browser
// moves the focus of a removed element to the page body; the fake DOM does not, so each case puts it there as the press would.

const state = vi.hoisted(() => ({ snapshot: null as unknown, session: null as unknown }));
vi.mock("@/app/(app)/training/useTrainingSession", () => ({ useTrainingSession: () => [state.snapshot, state.session] }));
vi.mock("@/app/(app)/calculator/useCalculatorRosters", async () => {
  const { OPPONENT_ROSTER, OWN_ROSTER, rosterState } = await import("../fixtures/training");
  const rosters = { state: rosterState(OWN_ROSTER, OPPONENT_ROSTER), selectLeague() {}, selectOpponent() {}, refresh() {} };
  return { default: () => rosters };
});
vi.mock("@/app/(app)/training/setup/useNextOpponent", () => ({ useNextOpponent: (rosters: unknown) => rosters }));
// The replay screen as its heading only: these cases are about where the focus goes when it closes.
vi.mock("@/app/(app)/training/replay/ReplayScreen", async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("h2", { tabIndex: -1 }, "Replay") };
});

const ROSTERS = rosterState(OWN_ROSTER, OPPONENT_ROSTER);

/** Ready suggested sets for both sides' chosen league members (as training-setup.test.ts builds them). */
function suggestionsFor(draft: SetupDraft): Record<DoublesSideId, SuggestionState> {
  const idle: SuggestionState = { status: "idle" };
  const loading = resolveSetup(draft, ROSTERS, { own: idle, opponent: idle }, runtime);
  const sets = (team: typeof loading.own): SuggestionState => ({
    status: "ready", key: team.suggestKey!,
    sets: Object.fromEntries(team.suggestMembers.map((member) => [member.key, suggestedSet(member.key, member.speciesId, ["protect", "earthquake"], {
      abilityId: runtime.speciesById.get(member.speciesId)!.abilities[0],
    })])),
  });
  return { own: sets(loading.own), opponent: sets(loading.opponent) };
}

let document: FakeDocument;
let root: { render(node: unknown): void; unmount(): void };
let TeamSourcePanel: typeof TeamSourcePanelType;
let TrainingClient: typeof TrainingClientType;

beforeAll(async () => {
  document = installFakeDom();
  const { createRoot } = await import("react-dom/client");
  TeamSourcePanel = (await import("@/app/(app)/training/setup/TeamSourcePanel")).default;
  TrainingClient = (await import("@/app/(app)/training/TrainingClient")).default;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element) as unknown as typeof root;
});
afterAll(async () => { await act(async () => { root?.unmount(); }); });

const button = (label: string) => document.querySelectorAll("button").find((each) => each.textContent === label);
async function press(label: string) {
  const element = button(label);
  if (!element) throw new Error(`No button "${label}".`);
  element.focus();
  await act(async () => { (reactProps(element).onClick as () => void)(); });
}

describe("Your team's panel", () => {
  const suggestions = suggestionsFor(createSetupDraft()).own;
  /** The panel on its own, its source kept in local state as the session keeps the draft. */
  function Panel() {
    const [source, setSource] = useState<TeamSourceDraft>(emptySource());
    const team = resolveTeam(source, ROSTERS, "own", suggestions, runtime);
    return createElement(TeamSourcePanel, {
      role: "own", team, source, ownMode: source.mode, runtime, visibility: null, problems: null, moveOptions: {}, shared: new Set<string>(), reveal: 0,
      rosters: { state: ROSTERS, selectLeague() {}, selectOpponent() {}, refresh() {} },
      onSource: (change) => setSource(change), onRetrySuggest() {}, onLoadMoves() {},
    });
  }

  it("Edit as PokéPaste focuses the importer's Team text; Import team focuses Choose 6", async () => {
    await act(async () => { root.render(createElement(Panel)); });
    await press("Edit as PokéPaste");
    const active = document.activeElement as FakeElement;
    expect(active.localName).toBe("textarea");
    expect(active.closest("[data-paste-importer]")?.getAttribute("data-paste-importer")).toBe("own");
    expect(String(reactProps(active).value)).toMatch(/^Garchomp\nAbility: Rough Skin\n/);
    await press("Preview team text");
    await press("Import team (5 selectable)");
    const fact = document.activeElement as FakeElement;
    expect(fact.localName).toBe("div");
    expect(fact.getAttribute("data-training-choose")).not.toBeNull();
    expect(fact.getAttribute("tabindex")).toBe("-1");
    // It holds the list's fact (from 64rem) and the same fact as its toggle (below 64rem).
    expect(fact.querySelectorAll("span")[0].textContent).toBe("Choose 6 · 5 of 6 chosen");
    expect(fact.querySelector("button")?.textContent).toBe("Choose 6 · 5 of 6 chosen · Your team");
    // A later change of the source (back to League team) moves nothing.
    const toggle = document.querySelectorAll("button").find((each) => each.textContent === "League team")!;
    toggle.focus();
    await act(async () => { (reactProps(toggle).onClick as () => void)(); });
    expect(document.activeElement).toBe(toggle);
    await act(async () => { root.render(null); });
  });
});

describe("Change teams", () => {
  const session = new Proxy({} as Record<string | symbol, ReturnType<typeof vi.fn>>, { get: (target, key) => (target[key] ??= vi.fn()) });
  const draft = createSetupDraft();
  const setupSnapshot = (patch: Partial<TrainingSnapshot> = {}): TrainingSnapshot => ({
    ...initialSnapshot(), engine: { status: "ready" }, draft, suggestions: suggestionsFor(draft), ...patch,
  });
  const battle: TrainingBattle = {
    id: 1, setup: trainingSetup(), seed: null, phase: { kind: "preview", request: PREVIEW_REQUEST }, board: null, log: [], ai: { status: "thinking" },
    lastPreview: null, habitsBefore: emptyHabits(), savedId: "s1", startedAt: 0,
  };
  async function show(snapshot: TrainingSnapshot) {
    state.snapshot = snapshot;
    state.session = session;
    await act(async () => { root.render(createElement(TrainingClient)); });
  }
  const ownHeading = () => document.querySelectorAll('[data-training-team-heading="own"]')[0];

  it("gives the focus to Your team's heading on the way back from team preview; not on first load or after a stopped battle", async () => {
    document.activeElement = document.body;
    await show(setupSnapshot());
    expect(ownHeading()).toBeDefined();
    expect(document.activeElement).toBe(document.body);
    // Start: team preview takes the focus to its heading.
    await press("Start battle");
    document.activeElement = document.body;
    await show(setupSnapshot({ battle }));
    expect((document.activeElement as FakeElement).textContent).toBe("Team preview");
    await press("Change teams");
    expect(session.changeTeams).toHaveBeenCalledOnce();
    document.activeElement = document.body;
    await show(setupSnapshot());
    expect(document.activeElement).toBe(ownHeading());
    // A battle that stopped with an error comes back to Setup with its alert; the focus is not moved.
    await show(setupSnapshot({ battle }));
    document.activeElement = document.body;
    await show(setupSnapshot({ setupError: "The battle engine stopped." }));
    expect(document.activeElement).toBe(document.body);
    await act(async () => { root.render(null); });
  });

  const finished: SavedBattleSummary = {
    id: "f1", status: "finished", source: "played", createdAt: 1, updatedAt: 2, own: "Home", opponent: "Rival", turn: 7,
    result: { result: "win", forfeited: false }, difficulty: "safe", testSettings: false,
  };
  const saved: SavedBattlesState = { status: "ready", list: [finished], message: null, import: { status: "idle" }, autosaved: null };
  const replay = { id: "f1" } as ReplayState;
  const marked = (attribute: string) => document.querySelectorAll("button").find((each) => each.getAttribute(attribute) === "f1")!;

  it("a replay left for a battle (its header's Rematch) takes no focus back: Change teams still gives it to Your team's heading", async () => {
    document.activeElement = document.body;
    await show(setupSnapshot({ saved }));
    await show(setupSnapshot({ saved, replay }));
    // Rematch in the replay's header: the battle replaces the replay in one snapshot.
    document.activeElement = document.body;
    await show(setupSnapshot({ saved, battle }));
    expect((document.activeElement as FakeElement).textContent).toBe("Team preview");
    await press("Change teams");
    document.activeElement = document.body;
    await show(setupSnapshot({ saved }));
    expect(document.activeElement).toBe(ownHeading());
    // Refused by the worker (Battle stopped): the focus stays where the page left it.
    await show(setupSnapshot({ saved, replay }));
    await show(setupSnapshot({ saved, battle }));
    document.activeElement = document.body;
    await show(setupSnapshot({ saved, setupError: "Your team: Garchomp can't learn Spore." }));
    expect(document.activeElement).toBe(document.body);
    await act(async () => { root.render(null); });
  });

  it("closing a replay gives the focus back to the Replay button that opened it: the Last battle card's, else its row's", async () => {
    document.activeElement = document.body;
    await show(setupSnapshot({ saved }));
    const fromCard = marked("data-training-last-replay-for");
    expect(fromCard.closest("[data-training-last-battle]")).not.toBeNull();
    fromCard.focus();
    await act(async () => { (reactProps(fromCard).onClick as () => void)(); });
    expect(session.openReplay).toHaveBeenLastCalledWith("f1");
    await show(setupSnapshot({ saved, replay }));
    document.activeElement = document.body;
    await show(setupSnapshot({ saved }));
    expect(document.activeElement).toBe(marked("data-training-last-replay-for"));
    // The same battle's row in Saved battles: back to the row.
    const fromRow = marked("data-training-replay-for");
    fromRow.focus();
    await act(async () => { (reactProps(fromRow).onClick as () => void)(); });
    await show(setupSnapshot({ saved, replay }));
    document.activeElement = document.body;
    await show(setupSnapshot({ saved }));
    expect(document.activeElement).toBe(marked("data-training-replay-for"));
    expect((document.activeElement as FakeElement).closest("[data-training-saved]")).not.toBeNull();
    await act(async () => { root.render(null); });
  });
});
