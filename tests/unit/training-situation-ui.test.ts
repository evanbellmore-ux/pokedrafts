import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BattleEnd from "@/app/(app)/training/end/BattleEnd";
import BattleScreen from "@/app/(app)/training/BattleScreen";
import { emptyHabits } from "@/app/(app)/training/model/habits-data";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO } from "@/app/(app)/training/model/info";
import {
  matchupOf, parseFinishedBattle, parseSummary, RULES_VERSION, summaryOf, type SavedBattle, type SavedBattleSummary,
} from "@/app/(app)/training/model/saved-battle";
import {
  DEFAULT_SITUATION_SETTINGS, leftFact, matchupText, parseSituationSettings, requestLabel, situationIntro, situationLabel, spotFact,
  type SituationDeal, type SituationRequest, type TrainingSituation,
} from "@/app/(app)/training/model/situation";
import { TRAINING_FORMAT_ID, type TrainingBattle } from "@/app/(app)/training/model/view-types";
import SavedBattles from "@/app/(app)/training/saved/SavedBattles";
import SetupModeSwitch from "@/app/(app)/training/setup/SetupModeSwitch";
import SituationsPanel, { type SituationsPanelProps } from "@/app/(app)/training/setup/SituationsPanel";
import { createTrainingSession, SITUATIONS_KEY } from "@/app/(app)/training/training-session";
import { capture, textOf } from "../fixtures/jsx-capture";
import { boardView, fakeTransport, logTurns, memoryStorage, moveRequest, PREVIEW_REQUEST, runtime, trainingSetup } from "../fixtures/training";

vi.mock("react/jsx-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));
vi.mock("react/jsx-dev-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));

// Situations on the page: the store's deal (the worker deals, then the battle starts there), the remembered choices, the
// Situations panel, the battle screen and its end for a dealt battle, and saved battles that began from one.

const DEALT: TrainingSituation = {
  request: { kind: "spot", spot: "down-one", level: "hard" }, spot: "down-one",
  own: { members: [{ key: "own-garchomp", hp: 80 }, { key: "own-gyarados", hp: 70, status: "par" }, { key: "own-incineroar", hp: 100 }, { key: "own-aerodactyl", hp: 0 }] },
  opponent: { members: [{ key: "ai-ampharos", hp: 100, boosts: { spa: 2 } }, { key: "ai-absol", hp: 90 }, { key: "ai-annihilape", hp: 100 }, { key: "ai-altaria", hp: 100 }], tailwind: true },
};
const dealtSetup = (situation: TrainingSituation = DEALT) => trainingSetup({ situation, own: { label: "Your ready-made team", members: trainingSetup().own.members }, opponent: { label: "The AI's ready-made team", members: trainingSetup().opponent.members } });
const buttons = (elements: { type: string; props: Record<string, unknown> }[]) => elements.filter((element) => element.type === "button");
const named = (elements: { type: string; props: Record<string, unknown> }[], label: string) => buttons(elements).find((button) => textOf(button.props.children) === label || button.props["aria-label"] === label);

describe("situation facts and labels", () => {
  it("name the situation, its Pokémon left and each named situation's recipe", () => {
    expect(situationLabel(DEALT)).toBe("Down one · Hard");
    expect(situationLabel({ request: { kind: "random", level: "very-hard" }, spot: null })).toBe("Fully random · Very hard");
    expect(situationLabel({ request: { kind: "any", level: "hard" }, spot: "endgame" })).toBe("Endgame · Hard");
    expect(situationLabel({ request: { kind: "custom", custom: DEFAULT_SITUATION_SETTINGS.custom }, spot: null })).toBe("Custom situation");
    expect(leftFact(DEALT)).toBe("You have 3 Pokémon left, the opponent 4.");
    expect(situationIntro(DEALT)).toBe("Situation: Down one (Hard). You have 3 Pokémon left, the opponent 4.");
    expect(situationIntro({ ...DEALT, request: { kind: "custom", custom: DEFAULT_SITUATION_SETTINGS.custom }, spot: null })).toBe("Situation: Custom. You have 3 Pokémon left, the opponent 4.");
    expect(spotFact("down-one", "hard")).toBe("You: 3 left, 70–100% HP. AI: 4 left, 70–100% HP.");
    expect(spotFact("sweeper", "very-hard")).toBe("You: 4 left, 70–100% HP. AI: 4 left, 90–100% HP, a lead at +2 in its attacking stat and +1 Speed.");
    expect(spotFact("crippled", "hard")).toBe("You: 4 left, 80–100% HP, one lead burned or paralyzed. AI: 4 left, 80–100% HP.");
    expect(spotFact("half-health", "very-hard")).toBe("You: 4 left, 50% HP. AI: 4 left, 100% HP.");
    expect(spotFact("tailwind", "hard")).toContain("Tailwind (4 turns)");
    expect(requestLabel({ kind: "any", level: "very-hard" })).toBe("Random situation · Very hard");
    expect(matchupText(dealtSetup())).toBe("Down one · Hard");
    expect(matchupText(trainingSetup())).toBe("Your team vs Rival");
  });

  it("read stored choices back as untrusted, each part on its own", () => {
    expect(parseSituationSettings(null)).toEqual(DEFAULT_SITUATION_SETTINGS);
    expect(parseSituationSettings({ mode: "situations", level: "very-hard", custom: { own: { left: 2, hp: 50, leads: [{ atk: 2, spe: 9 }, { def: -1 }] } } })).toEqual({
      mode: "situations", level: "very-hard",
      custom: { own: { left: 2, hp: 50, leads: [{ atk: 2 }, { def: -1 }] }, opponent: DEFAULT_SITUATION_SETTINGS.custom.opponent },
    });
    expect(parseSituationSettings({ mode: "x", level: 3, custom: { own: { left: 9, hp: 33, leads: "no" } } })).toEqual({
      ...DEFAULT_SITUATION_SETTINGS, custom: { own: { ...DEFAULT_SITUATION_SETTINGS.custom.own, leads: [{}, {}] }, opponent: DEFAULT_SITUATION_SETTINGS.custom.opponent },
    });
  });
});

describe("the store's situations", () => {
  beforeEach(() => { vi.stubGlobal("window", {}); });
  afterEach(() => { vi.unstubAllGlobals(); });
  function loaded(storage = memoryStorage()) {
    const fake = fakeTransport();
    const session = createTrainingSession({ transport: () => fake.transport, storage });
    session.subscribe(() => undefined);
    fake.emit({ type: "loaded", ms: 1 });
    session.bindAccount("user-1");
    return { session, fake, storage };
  }

  it("asks the worker to deal with the draft's settings, then starts the dealt battle", () => {
    const { session, fake } = loaded();
    session.updateDraft((draft) => ({ ...draft, difficulty: "reads", showRead: false }));
    const request: SituationRequest = { kind: "spot", spot: "down-one", level: "hard" };
    session.startSituation(request);
    const [deal] = fake.of("deal");
    expect(deal).toMatchObject({ request, settings: { difficulty: "reads", showRead: false, info: DEFAULT_INFO } });
    expect(session.getSnapshot().situations.deal).toEqual({ status: "dealing", key: deal.key, request });
    fake.emit({ type: "dealt", key: deal.key, setup: dealtSetup() });
    expect(session.getSnapshot().situations.deal).toEqual({ status: "idle" });
    const battle = session.getSnapshot().battle!;
    expect(battle.setup.situation).toEqual(DEALT);
    expect(fake.of("start").at(-1)).toMatchObject({ battleId: battle.id, setup: { situation: DEALT } });
    // Rematch plays the same position again; New situation asks for another the same way.
    session.rematch();
    expect(fake.of("start").at(-1)!.setup.situation).toEqual(DEALT);
    session.startSituation(DEALT.request);
    expect(fake.of("deal").at(-1)!.request).toEqual(DEALT.request);
  });

  it("a worker that stops before turn 1 returns the battle to Setup with the fact; one past turn 1 stays", () => {
    const { session, fake } = loaded();
    session.startSituation(DEALT.request);
    fake.emit({ type: "dealt", key: fake.of("deal").at(-1)!.key, setup: dealtSetup() });
    const first = session.getSnapshot().battle!;
    expect(first.phase.kind).toBe("starting");
    fake.emit({ type: "load-error", message: "Worker crashed." });
    expect(session.getSnapshot()).toMatchObject({ battle: null, setupError: "The battle engine stopped: Worker crashed.", engine: { status: "error" } });

    // At team preview (turn 0), the same.
    session.retryEngine();
    fake.emit({ type: "loaded", ms: 1 });
    session.startSituation(DEALT.request);
    fake.emit({ type: "dealt", key: fake.of("deal").at(-1)!.key, setup: dealtSetup() });
    const second = session.getSnapshot().battle!;
    fake.emit({ type: "battle", battleId: second.id, seed: null, request: PREVIEW_REQUEST, board: boardView({ turn: 0 }), log: [], ended: null });
    expect(session.getSnapshot().battle?.phase.kind).toBe("preview");
    fake.emit({ type: "load-error", message: "Worker crashed." });
    expect(session.getSnapshot().battle).toBeNull();

    // Past turn 1 the board, the log and the autosave stay; Forfeit is on screen.
    session.retryEngine();
    fake.emit({ type: "loaded", ms: 1 });
    session.start(trainingSetup());
    const third = session.getSnapshot().battle!;
    fake.emit({ type: "battle", battleId: third.id, seed: null, request: moveRequest(), board: boardView({ turn: 2 }), log: [], ended: null });
    fake.emit({ type: "load-error", message: "Worker crashed." });
    expect(session.getSnapshot().battle?.id).toBe(third.id);
  });

  it("keeps only the newest deal, states a failed one, and a full battle drops one in progress", () => {
    const { session, fake } = loaded();
    session.startSituation({ kind: "random", level: "hard" });
    session.startSituation({ kind: "any", level: "very-hard" });
    const [first, second] = fake.of("deal");
    fake.emit({ type: "dealt", key: first.key, setup: dealtSetup() });
    expect(session.getSnapshot().battle).toBeNull();
    fake.emit({ type: "deal-error", key: second.key, message: "No legal ready-made team after 8 draws." });
    expect(session.getSnapshot().situations.deal).toEqual({ status: "error", request: second.request, message: "No legal ready-made team after 8 draws." });
    session.startSituation({ kind: "spot", spot: "endgame", level: "hard" });
    session.start(trainingSetup());
    expect(session.getSnapshot().situations.deal).toEqual({ status: "idle" });
    fake.emit({ type: "dealt", key: fake.of("deal").at(-1)!.key, setup: dealtSetup() });
    expect(session.getSnapshot().battle?.setup.situation).toBeUndefined();
    // New situation, then Rematch or Back to setup before it is dealt: the deal's answer is ignored.
    for (const before of [() => session.rematch(), () => session.changeTeams()]) {
      session.startSituation({ kind: "spot", spot: "endgame", level: "hard" });
      const battleBefore = session.getSnapshot().battle?.id ?? null;
      before();
      const after = session.getSnapshot().battle?.id ?? null;
      fake.emit({ type: "dealt", key: fake.of("deal").at(-1)!.key, setup: dealtSetup() });
      expect(session.getSnapshot().battle?.id ?? null).toBe(after);
      expect(after === null || after !== battleBefore).toBe(true);
    }
  });

  it("waits for the worker to load, fails with it, and asks a new worker again after Retry", () => {
    const fake = fakeTransport();
    const session = createTrainingSession({ transport: () => fake.transport, storage: memoryStorage() });
    session.subscribe(() => undefined);
    session.bindAccount("user-1");
    session.startSituation({ kind: "spot", spot: "down-two", level: "hard" });
    expect(fake.of("deal")).toHaveLength(0);
    fake.emit({ type: "loaded", ms: 1 });
    expect(fake.of("deal")).toHaveLength(1);
    session.retryEngine();
    fake.emit({ type: "loaded", ms: 1 });
    expect(fake.of("deal")).toHaveLength(2);
    expect(fake.of("deal")[1].key).toBe(fake.of("deal")[0].key);
    session.startSituation({ kind: "spot", spot: "down-two", level: "hard" });
    fake.emit({ type: "load-error", message: "Worker failed." });
    expect(session.getSnapshot().situations.deal).toMatchObject({ status: "error", message: expect.stringContaining("Worker failed.") });
  });

  it("remembers the mode, level and custom situation per account", () => {
    const storage = memoryStorage({ [`${SITUATIONS_KEY}user-2`]: JSON.stringify({ mode: "situations", level: "very-hard" }) });
    const { session } = loaded(storage);
    session.updateSituations((current) => ({ ...current, mode: "situations", custom: { ...current.custom, own: { left: 1, hp: 25, leads: [{ atk: 1 }, {}] } } }));
    expect(JSON.parse(storage.data.get(`${SITUATIONS_KEY}user-1`)!)).toMatchObject({ mode: "situations", level: "hard", custom: { own: { left: 1, hp: 25 } } });
    session.bindAccount("user-2");
    expect(session.getSnapshot().situations.settings).toMatchObject({ mode: "situations", level: "very-hard" });
    session.bindAccount("user-3");
    expect(session.getSnapshot().situations.settings).toEqual(DEFAULT_SITUATION_SETTINGS);
  });
});

describe("the Situations panel", () => {
  const panel = (patch: { engine?: SituationsPanelProps["snapshot"]["engine"]; deal?: SituationDeal; level?: "hard" | "very-hard" } = {}) => {
    const session = { updateSituations: vi.fn(), startSituation: vi.fn(), retryEngine: vi.fn() };
    const snapshot: SituationsPanelProps["snapshot"] = {
      engine: patch.engine ?? { status: "ready" },
      situations: { settings: { ...DEFAULT_SITUATION_SETTINGS, mode: "situations", level: patch.level ?? "hard" }, deal: patch.deal ?? { status: "idle" } },
    };
    const { result: html, elements } = capture(() => renderToStaticMarkup(createElement(SituationsPanel, { snapshot, session })));
    return { html, elements, session };
  };

  it("offers Random situation, every named one with its facts, Fully random and a custom one, each starting at once", () => {
    const { html, elements, session } = panel({ level: "very-hard" });
    expect(html).toContain(">Situations</h2>");
    expect(html).toContain('aria-label="Situation difficulty"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Very hard</);
    for (const label of ["Random situation", "Down one", "Down two", "Last one standing", "Half health", "Set-up sweeper", "Tailwind against you", "Crippled leads", "Endgame", "Fully random", "Start custom situation"]) {
      expect(named(elements, label), label).toBeTruthy();
    }
    expect(html).toContain(spotFact("down-two", "very-hard"));
    expect(html).toContain("Smogon 2026-08 VGC Reg M-B usage");
    (named(elements, "Down two")!.props.onClick as () => void)();
    expect(session.startSituation).toHaveBeenCalledWith({ kind: "spot", spot: "down-two", level: "very-hard" });
    (named(elements, "Random situation")!.props.onClick as () => void)();
    expect(session.startSituation).toHaveBeenLastCalledWith({ kind: "any", level: "very-hard" });
    (named(elements, "Start custom situation")!.props.onClick as () => void)();
    expect(session.startSituation).toHaveBeenLastCalledWith({ kind: "custom", custom: DEFAULT_SITUATION_SETTINGS.custom });
    // Custom: Pokémon left and HP per side, five stat stages per lead (named for the screen reader).
    expect(html).toContain('aria-label="Your side: Pokémon left"');
    expect(html).toContain('aria-label="AI&#x27;s side: right lead Speed stage"');
    const left = elements.find((element) => element.type === "select" && element.props["aria-label"] === "Your side: Pokémon left")!;
    (left.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "1" } });
    const change = session.updateSituations.mock.calls.at(-1)![0] as (settings: typeof DEFAULT_SITUATION_SETTINGS) => typeof DEFAULT_SITUATION_SETTINGS;
    expect(change(DEFAULT_SITUATION_SETTINGS).custom.own.left).toBe(1);
  });

  it("waits for the battle rules and for a deal, states a failed deal, and does nothing when pressed meanwhile", () => {
    const loading = panel({ engine: { status: "loading" } });
    expect(loading.html).toContain("Loading battle rules…");
    expect(named(loading.elements, "Down one")!.props["aria-disabled"]).toBe(true);
    (named(loading.elements, "Down one")!.props.onClick as () => void)();
    expect(loading.session.startSituation).not.toHaveBeenCalled();
    const dealing = panel({ deal: { status: "dealing", key: "k", request: { kind: "spot", spot: "endgame", level: "hard" } } });
    expect(dealing.html).toContain("Dealing Endgame · Hard…");
    expect(named(dealing.elements, "Fully random")!.props["aria-disabled"]).toBe(true);
    const failed = panel({ deal: { status: "error", request: { kind: "random", level: "hard" }, message: "No legal ready-made team after 8 draws." } });
    expect(failed.html).toContain("Situation not dealt");
    expect(failed.html).toContain("No legal ready-made team after 8 draws.");
  });

  it("the mode switch is a pressed-button pair", () => {
    const onChange = vi.fn();
    const { result: html, elements } = capture(() => renderToStaticMarkup(createElement(SetupModeSwitch, { mode: "situations", onChange })));
    expect(html).toContain('aria-label="Battle start"');
    expect(named(elements, "Situations")!.props["aria-pressed"]).toBe(true);
    expect(named(elements, "Full battle")!.props["aria-pressed"]).toBe(false);
    (named(elements, "Full battle")!.props.onClick as () => void)();
    expect(onChange).toHaveBeenCalledWith("battle");
  });
});

describe("a dealt battle on screen", () => {
  const session = { choose: vi.fn(), forfeit: vi.fn(), rematch: vi.fn(), changeTeams: vi.fn(), startSituation: vi.fn() };
  const battle = (patch: Partial<TrainingBattle> = {}): TrainingBattle => ({
    id: 1, setup: dealtSetup(), seed: null, phase: { kind: "choose", request: moveRequest() }, board: boardView({ turn: 1 }), log: [], ai: { status: "idle" },
    lastPreview: null, habitsBefore: emptyHabits(), savedId: "s1", startedAt: 0, ...patch,
  });
  const render = (value: TrainingBattle) => renderToStaticMarkup(createElement(BattleScreen, { runtime, battle: value, session, habits: emptyHabits() }));

  it("offers Back to setup until the first board, where Forfeit takes over", () => {
    for (const waiting of [
      battle({ phase: { kind: "starting" }, board: null }),
      battle({ phase: { kind: "preview", request: PREVIEW_REQUEST }, board: boardView({ turn: 0 }) }),
      // A Resume going in has no board either.
      battle({ setup: trainingSetup(), phase: { kind: "starting" }, board: null, resumed: true }),
    ]) {
      session.changeTeams.mockClear();
      const { result: html, elements } = capture(() => render(waiting));
      expect(html).toMatch(/Starting the situation…|Resuming battle…/);
      expect(buttons(elements).map((button) => textOf(button.props.children))).toEqual(["Back to setup"]);
      (named(elements, "Back to setup")!.props.onClick as () => void)();
      expect(session.changeTeams).toHaveBeenCalledOnce();
    }
    const { elements } = capture(() => render(battle()));
    expect(named(elements, "Back to setup")).toBeUndefined();
    expect(named(elements, "Forfeit")).toBeTruthy();
  });

  it("waits for its position instead of showing team preview", () => {
    const html = render(battle({ phase: { kind: "preview", request: PREVIEW_REQUEST }, board: boardView({ turn: 0 }) }));
    expect(html).toContain("Starting the situation…");
    expect(html).not.toContain("data-training-board");
    expect(html).not.toContain("Forfeit");
  });

  it("names the situation, and opens your team's stats, items and abilities and the opponent's sheet", () => {
    const stats = { hp: 183, atk: 182, def: 115, spa: 90, spd: 105, spe: 169 };
    const board = boardView({ turn: 1 });
    board.team.own = board.team.own.map((mon) => ({ ...mon, stats }));
    const html = render(battle({ board }));
    expect(html).toContain("Down one · Hard · You: 3 left · AI: 4 left");
    expect(html).toContain("<details open=\"\" data-training-own-team");
    expect(html).toContain("<details open=\"\" data-training-opponent-team");
    expect(html).toContain("HP 183 · Atk 182 · Def 115 · SpA 90 · SpD 105 · Spe 169");
    expect(html).toContain("Item: Life Orb");
    expect(html).toContain("In the back");
    // In play first (left, right), then the back, then the fainted.
    const order = [...html.matchAll(/data-training-own-member="([^"]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(["own-garchomp", "own-gyarados", "own-incineroar", "own-aerodactyl"]);
    expect(html).toContain("data-training-opponent-sheet");
    // A full battle keeps them closed (team preview showed both teams).
    const full = renderToStaticMarkup(createElement(BattleScreen, { runtime, battle: { ...battle({ board }), setup: trainingSetup() }, session, habits: emptyHabits() }));
    expect(full).toContain("<details data-training-own-team");
  });

  it("ends with Rematch, New situation and Back to setup", () => {
    const ended = battle({ phase: { kind: "ended", result: "loss", forfeited: false } });
    const onNewSituation = vi.fn();
    const { result: html, elements } = capture(() => renderToStaticMarkup(createElement(BattleEnd, { battle: ended, onRematch: vi.fn(), onChangeTeams: vi.fn(), logText: "", habits: emptyHabits(), onNewSituation, deal: { status: "idle" } })));
    expect(buttons(elements).map((button) => textOf(button.props.children))).toEqual(["Rematch", "New situation", "Back to setup", "Copy log"]);
    (named(elements, "New situation")!.props.onClick as () => void)();
    expect(onNewSituation).toHaveBeenCalledOnce();
    const dealing = renderToStaticMarkup(createElement(BattleEnd, { battle: ended, onRematch: vi.fn(), onChangeTeams: vi.fn(), logText: "", habits: emptyHabits(), onNewSituation, deal: { status: "dealing", key: "k", request: DEALT.request } }));
    expect(dealing).toContain("Dealing Down one · Hard…");
    expect(html).not.toContain("Change teams");
  });
});

describe("saved battles that began from a situation", () => {
  const record = (setup = dealtSetup()): SavedBattle => ({
    version: 1, id: "r1", status: "finished", source: "played", format: TRAINING_FORMAT_ID, rules: RULES_VERSION, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_060_000,
    setup, turn: 5, result: { result: "win", forfeited: false }, seed: `sodium,${"a".repeat(32)}`, inputLog: [">p2 team 3, 1, 4, 2", ">p1 team 1, 2, 3, 4"], log: logTurns(),
    resume: null, habitsBefore: null, habitsAfter: null, order: null,
  });

  it("are listed and named by their situation", () => {
    const summary = summaryOf(record());
    expect(summary.situation).toBe("Down one · Hard");
    expect(parseSummary(summary)).toEqual(summary);
    expect(matchupOf(summary)).toBe("Down one · Hard");
    expect(matchupOf({ own: "Home", opponent: "Rival" })).toBe("Home vs Rival");
    const saved = { status: "ready" as const, list: [summary], message: null, import: { status: "idle" as const }, autosaved: null };
    const sessionActions = { openReplay: vi.fn(), resume: vi.fn(), rematchSaved: vi.fn(), deleteSaved: vi.fn(), deleteAllSaved: vi.fn(), importSaved: vi.fn(), exportSaved: vi.fn(async () => null) };
    const { result: html, elements } = capture(() => renderToStaticMarkup(createElement(SavedBattles, { saved, session: sessionActions })));
    expect(html).toContain("Down one · Hard");
    expect(buttons(elements).some((button) => String(button.props["aria-label"] ?? "").startsWith("Rematch Down one · Hard, "))).toBe(true);
    const plain: SavedBattleSummary = { ...summary, situation: undefined };
    expect(matchupOf(plain)).toBe("Your ready-made team vs The AI's ready-made team");
  });

  it("import with their situation checked, as every other field", () => {
    expect(parseFinishedBattle(record())).toMatchObject({ ok: true, record: { setup: { situation: DEALT } } });
    const broken = (situation: unknown) => parseFinishedBattle(record({ ...dealtSetup(), situation: situation as TrainingSituation }));
    expect(broken({ ...DEALT, request: { kind: "spot", spot: "nowhere", level: "hard" } })).toMatchObject({ ok: false, error: expect.stringContaining("battle.setup.situation.request.spot") });
    expect(broken({ ...DEALT, own: { members: DEALT.own.members.slice(0, 3) } })).toMatchObject({ ok: false, error: expect.stringContaining("battle.setup.situation.own.members") });
    expect(broken({ ...DEALT, own: { members: [{ key: "own-mew", hp: 50 }, ...DEALT.own.members.slice(1)] } })).toMatchObject({ ok: false, error: expect.stringContaining("its team does not have") });
    expect(broken({ ...DEALT, opponent: { members: DEALT.opponent.members.map((member) => ({ ...member, boosts: { atk: 9 } })) } })).toMatchObject({ ok: false });
    // Information settings and test extras are the record's own, as in any battle.
    expect(parseFinishedBattle(record({ ...dealtSetup(), info: { aiKnows: DEFAULT_INFO.aiKnows, youSee: CLOSED_TEAM_SHEETS } }))).toMatchObject({ ok: true });
  });
});
