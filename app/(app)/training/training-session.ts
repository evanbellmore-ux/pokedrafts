import type { DoublesSideId } from "@/app/lib/battle/doubles-types";
import type { HabitsRecord } from "./model/decision";
import { emptyHabits, parseHabits } from "./model/habits-data";
import {
  canonicalJson, firstDifference, IMPORT_MAX_BYTES, IMPORT_MAX_LABEL, logHash, logShapeHash, newBattleId, rewordedLog, RULES_VERSION, summaryOf,
  turnShapeHashes, type RerunTurn, type ReplayState, type SavedBattle, type SavedBattlesState,
} from "./model/saved-battle";
import { DEFAULT_INFO, parseInfoSettings, SHEET_FIELDS, type InfoSettings } from "./model/info";
import type { SuggestedSet, SuggestMember } from "./model/usage";
import {
  TRAINING_FORMAT_ID, type LogTurn, type PlayerChoice, type SetupDraft, type TrainingBattle, type TrainingPhase, type TrainingRequest,
  type TrainingSetup, type TrainingSnapshot,
} from "./model/view-types";
import type { FromWorker, ToWorker, TrainingTransport } from "./model/worker-protocol";
import { browserBattleStore, STORAGE_UNAVAILABLE, StoreError, type BattleStore, type ImportCheck } from "./saved/battle-store";
import { createSetupDraft } from "./setup/team-draft";
import { createWorkerTransport } from "./worker/worker-transport";

// The Training page's module-level store (browser only): the worker transport, the setup draft, the battle, saved battles and
// the replay screen. It survives tab navigation; a reload ends the battle, which Resume rebuilds from its last autosave. The
// transport is created on the first subscribe, never during server rendering. Habits, the information settings and whether
// "Your trends" is open live in localStorage, per account (test extras are never stored); saved battles in the BattleStore
// (this browser's IndexedDB, per account).

export type TrainingSession = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): TrainingSnapshot;
  getServerSnapshot(): TrainingSnapshot;
  /** Also stores draft.info's categories (never the test extras). */
  updateDraft(update: (draft: SetupDraft) => SetupDraft): void;
  /** Debounced 250 ms; results for another key are dropped. */
  validate(setup: TrainingSetup, key: string): void;
  /** Addendum A1.2: suggested sets for one side's chosen league members, in team order. `force` re-asks after an error. */
  suggest(side: DoublesSideId, key: string, members: SuggestMember[], force?: boolean): void;
  /** Addendum A1.3: the set editor's move list for a species (once per species unless it failed). */
  loadMoveOptions(speciesId: string): void;
  start(setup: TrainingSetup): void;
  choose(choice: PlayerChoice): void;
  forfeit(): void;
  rematch(): void;
  changeTeams(): void;
  retryEngine(): void;
  clearHabits(): void;
  /** Opens or closes "Your trends" on the setup screen (remembered). */
  setTrendsOpen(open: boolean): void;
  /** From useCalculatorRosters().state.userId; another account resets draft, battle, habits and information settings. */
  bindAccount(userId: string | null): void;
  /** Saved battles: the replay screen for a finished one (re-run in the worker), and closing it. */
  openReplay(id: string): void;
  closeReplay(): void;
  /** An unfinished battle: rebuilt in the worker from its sealed checkpoint, then played on. */
  resume(id: string): void;
  deleteSaved(id: string): void;
  deleteAllSaved(): void;
  /** A finished battle's export file (the page downloads it on your click). */
  exportSaved(id: string): Promise<{ name: string; text: string } | null>;
  /** An export file: size, schema and version checks, the validator and a re-run in the worker, then saved and opened. */
  importSaved(file: { name: string; size: number; text(): Promise<string> }): void;
};

export type TrainingSessionOptions = {
  transport: () => TrainingTransport;
  storage?: Storage | null;
  now?: () => number;
  /** false: never create the transport (the server's inert session). */
  connect?: boolean;
  /** Saved battles for an account ("anon" signed out); null or a throw: unavailable. Default: none. */
  battleStore?: (account: string) => BattleStore | null;
};

export const HABITS_KEY = "pokedrafts:training:habits:v1:";
export const INFO_KEY = "pokedrafts:training:info:v1:";
export const TRENDS_KEY = "pokedrafts:training:trends:v1:";
export const VALIDATE_DELAY_MS = 250;

function accountKey(userId: string | null) {
  return userId ?? "anon";
}

export function initialSnapshot(info: InfoSettings = DEFAULT_INFO): TrainingSnapshot {
  return {
    revision: 0,
    engine: { status: "idle" },
    draft: createSetupDraft(info),
    validation: { status: "idle" },
    habits: { turns: 0, data: emptyHabits() },
    trendsOpen: false,
    setupError: null,
    battle: null,
    suggestions: { own: { status: "idle" }, opponent: { status: "idle" } },
    moveOptions: {},
    saved: { status: "idle", list: [], message: null, import: { status: "idle" }, autosaved: null },
    replay: null,
  };
}

/** The snapshot's habits view of a stored record: its decayed turns and the parsed data (empty when none or corrupt). */
export function habitsView(record: HabitsRecord | null): TrainingSnapshot["habits"] {
  return { turns: record?.turns ?? 0, data: parseHabits(record?.data) };
}

/** The phase a request opens (a `wait` request: only the AI replaces a fainted Pokémon). */
export function phaseFor(request: TrainingRequest): TrainingPhase {
  switch (request.kind) {
    case "team-preview": return { kind: "preview", request };
    case "move": return { kind: "choose", request };
    case "switch": return { kind: "switch", request };
    case "wait": return { kind: "waiting", reason: "opponent-switch" };
  }
}

function requestOf(phase: TrainingPhase) {
  return phase.kind === "preview" || phase.kind === "choose" || phase.kind === "switch" ? phase.request : null;
}

/** Turn N's read is shown only once turn N has resolved: the board has moved past it, or the battle ended (SPEC D7). */
function stripUnresolved(log: readonly LogTurn[], boardTurn: number, ended: boolean): LogTurn[] {
  return log.map((turn) => !ended && turn.turn >= boardTurn && turn.read ? { ...turn, read: null } : turn);
}

function mergeLog(current: readonly LogTurn[], changed: readonly LogTurn[]) {
  const byTurn = new Map(current.map((turn) => [turn.turn, turn]));
  for (const turn of changed) byTurn.set(turn.turn, turn);
  return [...byTurn.values()].sort((a, b) => a.turn - b.turn);
}

/** The saved log of an unfinished battle: the turns that resolved before `turn` began. */
const resolvedBefore = (log: readonly LogTurn[], turn: number) => log.filter((each) => each.turn < turn);
const factOf = (error: unknown, fallback: string) => (error instanceof StoreError || error instanceof Error ? error.message : fallback);
const UNREADABLE = "The saved battle could not be read.";

function sameTeam(a: TrainingSetup, b: TrainingSetup) {
  return a.own.members.length === b.own.members.length && a.own.members.every((member, index) => member.key === b.own.members[index]?.key);
}

export function createTrainingSession(options: TrainingSessionOptions): TrainingSession {
  const storage = options.storage ?? null;
  const now = options.now ?? Date.now;
  const connectOnSubscribe = options.connect ?? true;
  const server = initialSnapshot();
  let snapshot = server;
  const listeners = new Set<() => void>();
  let transport: TrainingTransport | null = null;
  let detach: (() => void) | null = null;
  let account: { id: string | null } | undefined;
  let habits: HabitsRecord | null = null;
  let battleCounter = 0;
  let validateTimer: ReturnType<typeof setTimeout> | null = null;
  let queuedValidate: { setup: TrainingSetup; key: string } | null = null;
  const queuedSuggest: Partial<Record<DoublesSideId, { key: string; members: SuggestMember[] }>> = {};
  const queuedMoves = new Set<string>();
  const suggestRequests: Partial<Record<DoublesSideId, { key: string; members: SuggestMember[] }>> = {};
  /** The phase a choice left, restored with its error when Showdown rejects the choice. */
  let chosenFrom: TrainingPhase | null = null;
  /** The team order you submitted in this battle (1-based), for "Same as last battle". */
  let submittedOrder: number[] | null = null;
  // ---------- saved battles ----------
  let store: BattleStore | null = null;
  /** Bumped on every account change: answers for the previous account's store are dropped. */
  let storeEpoch = 0;
  /** Saves run one after another (an autosave never lands after the battle's final save). */
  let saveChain: Promise<void> = Promise.resolve();
  /** Resume after the stored habits changed (another battle, Clear habits): this battle does not write them. */
  let habitsDetached = false;
  /** Worker messages waiting for it to load (Resume, replays, an import's check). */
  let waiting: ToWorker[] = [];
  let replayCounter = 0;
  /** The re-runs the worker is doing, by replayId: the replay screen's, and an import file's check (both can run at once). */
  type ReplayJob = {
    replayId: number; record: SavedBattle; kind: "view" | "import"; message: ToWorker;
    /** `turns`: the re-run's written turns when the saved log differs from it only in wording (they replace its lines and steps). */
    settle?: (error: string | null, boards: ReplayState["boards"], turns: RerunTurn[] | null) => void;
  };
  const replayJobs = new Map<number, ReplayJob>();

  function setSaved(patch: Partial<SavedBattlesState>) {
    set({ saved: { ...snapshot.saved, ...patch } });
  }
  function set(patch: Partial<Omit<TrainingSnapshot, "revision">>) {
    snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
    for (const listener of [...listeners]) listener();
  }
  function setBattle(patch: Partial<TrainingBattle>) {
    if (!snapshot.battle) return;
    set({ battle: { ...snapshot.battle, ...patch } });
  }
  function post(message: ToWorker) {
    transport?.post(message);
  }
  const ready = () => snapshot.engine.status === "ready" && !!transport;

  // ---------- storage (every access guarded: private windows and blocked storage throw) ----------
  function read(key: string): unknown {
    if (!storage) return null;
    try {
      const raw = storage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  }
  function write(key: string, value: unknown) {
    if (!storage) return;
    try { storage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: not remembered */ }
  }
  function remove(key: string) {
    if (!storage) return;
    try { storage.removeItem(key); } catch { /* blocked: nothing to clear */ }
  }
  function readHabits(userId: string | null): HabitsRecord | null {
    const value = read(HABITS_KEY + accountKey(userId)) as Partial<HabitsRecord> | null;
    return value && value.version === 1 && typeof value.turns === "number" && Number.isFinite(value.turns) ? { version: 1, turns: value.turns, data: value.data ?? null } : null;
  }
  function readInfo(userId: string | null): InfoSettings | null {
    const value = read(INFO_KEY + accountKey(userId));
    return value === null ? null : parseInfoSettings(value);
  }
  function readTrendsOpen(userId: string | null): boolean {
    const value = read(TRENDS_KEY + accountKey(userId));
    return !!value && typeof value === "object" && (value as { open?: unknown }).open === true;
  }
  /** Only the five categories per direction: the test extras are never remembered (SPEC I2). */
  function storeInfo(info: InfoSettings) {
    if (!account) return;
    const categories = (view: InfoSettings["aiKnows"]) => ({ open: Object.fromEntries(SHEET_FIELDS.map((field) => [field, view.open[field]])) });
    write(INFO_KEY + accountKey(account.id), { aiKnows: categories(info.aiKnows), youSee: categories(info.youSee) });
  }

  // ---------- the worker ----------
  function connect() {
    if (transport) return;
    let created: TrainingTransport;
    try {
      created = options.transport();
    } catch (error) {
      set({ engine: { status: "error", message: error instanceof Error ? error.message : "The battle engine could not start." } });
      return;
    }
    transport = created;
    detach = created.onMessage(receive);
    set({ engine: { status: "loading" } });
    created.post({ type: "load" });
  }
  function disconnect() {
    detach?.();
    detach = null;
    transport?.terminate();
    transport = null;
  }
  function flush() {
    if (!ready()) return;
    if (queuedValidate) { const { setup, key } = queuedValidate; queuedValidate = null; post({ type: "validate", key, setup }); }
    for (const side of ["own", "opponent"] as const) {
      const queued = queuedSuggest[side];
      if (queued) { delete queuedSuggest[side]; post({ type: "suggest", key: queued.key, side, members: queued.members }); }
    }
    for (const speciesId of queuedMoves) post({ type: "move-options", speciesId });
    queuedMoves.clear();
    const queued = waiting;
    waiting = [];
    for (const message of queued) post(message);
  }
  /** Posts now, or once the worker has loaded (failed with it when it does not). */
  function postWhenReady(message: ToWorker) {
    if (ready()) post(message);
    else waiting.push(message);
  }
  /** The worker did not load (or stopped): what waited for it, and the replay it was re-running, fail with that fact. */
  function failWaiting(message: string) {
    const queued = waiting;
    waiting = [];
    for (const each of queued) {
      if (each.type === "resume" && snapshot.battle?.id === each.battleId) set({ battle: null, setupError: `The battle engine did not load: ${message}` });
    }
    for (const job of [...replayJobs.values()]) replayFailed(job.replayId, `The battle engine did not load: ${message}`);
  }

  function receive(message: FromWorker) {
    switch (message.type) {
      case "loaded":
        set({ engine: { status: "ready" } });
        flush();
        return;
      case "load-error": {
        // Requests waiting for the worker fail with it (Retry re-sends the suggestions; reopening an editor its move list).
        queuedMoves.clear();
        const suggestions = { ...snapshot.suggestions };
        for (const side of ["own", "opponent"] as const) {
          const state = suggestions[side];
          if (state.status === "loading") suggestions[side] = { status: "error", key: state.key, message: message.message };
          delete queuedSuggest[side];
        }
        const moveOptions = Object.fromEntries(Object.entries(snapshot.moveOptions).map(([speciesId, state]) =>
          [speciesId, state.status === "loading" ? { status: "error" as const, message: message.message } : state]));
        set({ engine: { status: "error", message: message.message }, suggestions, moveOptions });
        failWaiting(message.message);
        return;
      }
      case "validated":
        if (snapshot.validation.status !== "idle" && snapshot.validation.key === message.key) {
          set({ validation: { status: "ready", key: message.key, own: message.own, opponent: message.opponent } });
        }
        return;
      case "validate-error":
        if (snapshot.validation.status !== "idle" && snapshot.validation.key === message.key) {
          set({ validation: { status: "error", key: message.key, message: message.message } });
        }
        return;
      case "suggested": {
        const state = snapshot.suggestions[message.side];
        if (state.status === "idle" || state.key !== message.key) return;
        const sets: Record<string, SuggestedSet> = Object.fromEntries(message.sets.map((each) => [each.key, each]));
        set({ suggestions: { ...snapshot.suggestions, [message.side]: { status: "ready", key: message.key, sets } } });
        return;
      }
      case "suggest-error": {
        const state = snapshot.suggestions[message.side];
        if (state.status === "idle" || state.key !== message.key) return;
        set({ suggestions: { ...snapshot.suggestions, [message.side]: { status: "error", key: message.key, message: message.message } } });
        return;
      }
      case "move-options-ready":
        set({ moveOptions: { ...snapshot.moveOptions, [message.speciesId]: { status: "ready", moves: message.moves } } });
        return;
      case "move-options-error":
        set({ moveOptions: { ...snapshot.moveOptions, [message.speciesId]: { status: "error", message: message.message } } });
        return;
      case "battle": {
        const battle = snapshot.battle;
        if (!battle || battle.id !== message.battleId) return;
        const ended = message.ended;
        const previous = requestOf(battle.phase) ?? requestOf(chosenFrom ?? battle.phase);
        let phase: TrainingPhase;
        if (ended) phase = { kind: "ended", result: ended.result, forfeited: ended.forfeited };
        else if (message.request) phase = phaseFor(message.request);
        else phase = battle.phase;
        if (phase.kind !== "waiting" || message.request) chosenFrom = null;
        const newRequest = !!message.request && message.request.id !== previous?.id;
        // A resumed battle whose habits changed meanwhile (another battle, Clear habits) leaves the stored habits alone.
        const learned = message.habits && !(battle.resumed && habitsDetached) ? message.habits : undefined;
        if (learned) {
          habits = learned;
          if (account) write(HABITS_KEY + accountKey(account.id), learned);
        }
        const log = stripUnresolved(mergeLog(battle.log, message.log), message.board.turn, !!ended);
        set({
          battle: {
            ...battle, seed: message.seed, phase, board: message.board, log,
            ai: newRequest || ended ? { status: "idle" } : battle.ai,
          },
          ...(learned ? { habits: habitsView(learned) } : {}),
        });
        if (ended && snapshot.battle) saveFinished(snapshot.battle, message.inputLog ?? null);
        return;
      }
      case "checkpoint": {
        const battle = snapshot.battle;
        // A late checkpoint never replaces the battle's final save.
        if (!battle || battle.id !== message.battleId || battle.phase.kind === "ended") return;
        if (!message.sealed) {
          setSaved({ message: "Resume is unavailable in this browser.", autosaved: null });
          return;
        }
        saveUnfinished(battle, message.turn, message.sealed);
        return;
      }
      case "replay-ready": {
        const job = replayJobs.get(message.replayId);
        if (!job) return;
        replayJobs.delete(message.replayId);
        const boards = { starts: message.starts, end: message.end };
        // Equal text, or the same battle in another wording (saved before the current wording): its shape is the re-run's.
        const sameText = message.hash === logHash(job.record.log);
        const reworded = !sameText && message.shape === logShapeHash(job.record.log);
        const differs = sameText || reworded ? null : firstDifference(turnShapeHashes(job.record.log), message.turnShapes);
        const differsText = differs === null ? "" : ` from turn ${differs}`;
        if (job.kind === "import") {
          // An import file is untrusted: its log, result and turns must all be the re-run's (its text is replaced by the re-run's).
          const result = job.record.result;
          const refused = !sameText && !reworded ? `The file's log does not match a re-run of its battle${differsText}.`
            : !result || result.result !== message.result.result || result.forfeited !== message.result.forfeited ? "The file's result does not match a re-run of its battle."
              : job.record.turn !== message.end.turn ? "The file's turn count does not match a re-run of its battle." : null;
          job.settle?.(refused, boards, reworded ? message.turns : null);
          return;
        }
        if (snapshot.replay?.id !== job.record.id) return;
        if (reworded) {
          // The re-run's wording is shown and stored (same id and last save, so the list keeps its order).
          const log = rewordedLog(job.record.log, message.turns);
          persist({ ...job.record, log }, () => undefined, () => undefined);
          set({ replay: { ...snapshot.replay, log, status: "board", boards, message: null } });
          return;
        }
        set({
          replay: sameText
            ? { ...snapshot.replay, status: "board", boards, message: null }
            : { ...snapshot.replay, status: "log", boards: null, message: `The re-run differs from the saved log${differsText}. The saved log is shown.` },
        });
        return;
      }
      case "replay-error":
        replayFailed(message.replayId, message.message);
        return;
      case "choice-error": {
        const battle = snapshot.battle;
        const from = chosenFrom;
        const request = from ? requestOf(from) : null;
        if (!battle || battle.id !== message.battleId || !from || !request || request.id !== message.requestId) return;
        // An updated request (a hidden trap or disable shown) keeps the same id, so the form keeps its selections.
        const updated = message.request && message.request.kind === request.kind ? { ...message.request, id: request.id } as TrainingRequest : request;
        const phase = { ...phaseFor(updated), error: message.message } as TrainingPhase;
        chosenFrom = null;
        setBattle({ phase });
        return;
      }
      case "ai": {
        const battle = snapshot.battle;
        if (!battle || battle.id !== message.battleId) return;
        setBattle({ ai: { status: message.status, ...(message.message ? { message: message.message } : {}) } });
        return;
      }
      case "battle-error": {
        const battle = snapshot.battle;
        if (!battle || battle.id !== message.battleId) return;
        chosenFrom = null;
        set({ battle: null, setupError: message.message });
        return;
      }
    }
  }

  // ---------- battles ----------
  function startBattle(setup: TrainingSetup, lastPreview: number[] | null) {
    const id = ++battleCounter;
    chosenFrom = null;
    submittedOrder = null;
    habitsDetached = false;
    post({ type: "start", battleId: id, setup, habits });
    set({
      setupError: null,
      saved: { ...snapshot.saved, autosaved: null },
      battle: {
        id, setup, seed: null, phase: { kind: "starting" }, board: null, log: [], ai: { status: "idle" }, lastPreview, habitsBefore: parseHabits(habits?.data),
        savedId: newBattleId(), startedAt: now(),
      },
    });
  }
  function stopBattle() {
    const battle = snapshot.battle;
    if (battle && battle.phase.kind !== "ended") post({ type: "stop", battleId: battle.id });
  }

  // ---------- saved battles ----------
  function refreshSaved() {
    const target = store;
    const epoch = storeEpoch;
    if (!target) return;
    target.list().then(
      (list) => { if (epoch === storeEpoch) setSaved({ status: "ready", list }); },
      (error: unknown) => { if (epoch === storeEpoch) setSaved({ status: "unavailable", list: [], message: factOf(error, STORAGE_UNAVAILABLE) }); },
    );
  }
  /** Queued after earlier saves; `failed` states what was not saved. */
  function persist(record: SavedBattle, onSaved: () => void, failed: (fact: string) => void) {
    const target = store;
    const epoch = storeEpoch;
    if (!target) { failed(STORAGE_UNAVAILABLE); return; }
    saveChain = saveChain.then(() => target.save(record)).then(
      () => { if (epoch === storeEpoch) { onSaved(); refreshSaved(); } },
      (error: unknown) => { if (epoch === storeEpoch) failed(factOf(error, STORAGE_UNAVAILABLE)); },
    );
  }
  function baseRecord(battle: TrainingBattle): Omit<SavedBattle, "status" | "turn" | "result" | "seed" | "inputLog" | "log" | "resume" | "habitsBefore" | "habitsAfter"> {
    return {
      version: 1, id: battle.savedId, source: "played", format: TRAINING_FORMAT_ID, rules: RULES_VERSION, createdAt: battle.startedAt, updatedAt: now(),
      setup: battle.setup, order: submittedOrder ?? battle.lastPreview,
    };
  }
  function saveUnfinished(battle: TrainingBattle, turn: number, sealed: string) {
    const record: SavedBattle = {
      ...baseRecord(battle), status: "unfinished", turn, result: null, seed: null, inputLog: null, log: resolvedBefore(battle.log, turn),
      resume: { sealed }, habitsBefore: battle.habitsBefore, habitsAfter: habits,
    };
    const battleId = battle.id;
    persist(record, () => { if (snapshot.battle?.id === battleId) setSaved({ autosaved: { battleId, turn }, message: null }); },
      (fact) => setSaved({ autosaved: null, message: `${fact} Turn ${turn} was not saved for Resume.` }));
  }
  function saveFinished(battle: TrainingBattle, inputLog: string[] | null) {
    if (battle.phase.kind !== "ended" || !battle.seed || !inputLog) return;
    const record: SavedBattle = {
      ...baseRecord(battle), status: "finished", turn: battle.board?.turn ?? 0, result: { result: battle.phase.result, forfeited: battle.phase.forfeited },
      seed: battle.seed, inputLog, log: battle.log, resume: null, habitsBefore: null, habitsAfter: null,
    };
    persist(record, () => setSaved({ autosaved: null, message: null }), (fact) => setSaved({ autosaved: null, message: `${fact} This battle was not saved.` }));
  }
  function replayFailed(replayId: number, message: string) {
    const job = replayJobs.get(replayId);
    if (!job) return;
    replayJobs.delete(replayId);
    if (job.kind === "import") { job.settle?.(message, null, null); return; }
    if (snapshot.replay?.id !== job.record.id) return;
    set({ replay: { ...snapshot.replay, status: "log", boards: null, message: `The battle could not be re-run: ${message} The saved log is shown.` } });
  }
  /** The worker re-runs a finished record (the replay screen, or an import's check). */
  function rerun(record: SavedBattle, kind: "view" | "import", settle?: ReplayJob["settle"]) {
    const replayId = ++replayCounter;
    const message: ToWorker = { type: "replay", replayId, setup: record.setup, seed: record.seed ?? "", inputLog: record.inputLog ?? [], forfeited: !!record.result?.forfeited };
    replayJobs.set(replayId, { replayId, record, kind, settle, message });
    if (snapshot.engine.status === "error") { replayFailed(replayId, `The battle engine did not load: ${snapshot.engine.message ?? "unknown error"}`); return; }
    postWhenReady(message);
  }
  function replayView(record: SavedBattle, boards: ReplayState["boards"]): ReplayState {
    return { id: record.id, summary: summaryOf(record), setup: record.setup, log: record.log, status: boards ? "board" : "loading", boards, message: null };
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (connectOnSubscribe && typeof window !== "undefined") connect();
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => server,

    updateDraft(update) {
      const draft = update(snapshot.draft);
      if (draft === snapshot.draft) return;
      const infoChanged = JSON.stringify(draft.info) !== JSON.stringify(snapshot.draft.info);
      set({ draft });
      if (infoChanged) storeInfo(draft.info);
    },

    validate(setup, key) {
      const current = snapshot.validation;
      if (current.status !== "idle" && current.key === key) return;
      set({ validation: { status: "checking", key } });
      if (validateTimer !== null) clearTimeout(validateTimer);
      validateTimer = setTimeout(() => {
        validateTimer = null;
        if (snapshot.validation.status !== "checking" || snapshot.validation.key !== key) return;
        queuedValidate = { setup, key };
        flush();
      }, VALIDATE_DELAY_MS);
    },

    suggest(side, key, members, force = false) {
      const current = snapshot.suggestions[side];
      if (!force && current.status !== "idle" && current.key === key) return;
      suggestRequests[side] = { key, members };
      if (snapshot.engine.status === "error") {
        set({ suggestions: { ...snapshot.suggestions, [side]: { status: "error", key, message: snapshot.engine.message ?? "The battle engine did not load." } } });
        return;
      }
      set({ suggestions: { ...snapshot.suggestions, [side]: { status: "loading", key } } });
      queuedSuggest[side] = { key, members };
      flush();
    },

    loadMoveOptions(speciesId) {
      const current = snapshot.moveOptions[speciesId];
      if (current && current.status !== "error") return;
      if (snapshot.engine.status === "error") {
        if (current?.status !== "error") set({ moveOptions: { ...snapshot.moveOptions, [speciesId]: { status: "error", message: snapshot.engine.message ?? "The battle engine did not load." } } });
        return;
      }
      set({ moveOptions: { ...snapshot.moveOptions, [speciesId]: { status: "loading" } } });
      queuedMoves.add(speciesId);
      flush();
    },

    start(setup) {
      const previous = snapshot.battle;
      stopBattle();
      startBattle(setup, previous && sameTeam(previous.setup, setup) ? submittedOrder ?? previous.lastPreview : null);
    },

    choose(choice) {
      const battle = snapshot.battle;
      if (!battle) return;
      const request = requestOf(battle.phase);
      if (!request) return;
      if (choice.kind === "team") submittedOrder = [...choice.order];
      chosenFrom = { ...battle.phase, error: undefined } as TrainingPhase;
      post({ type: "choose", battleId: battle.id, requestId: request.id, choice });
      setBattle({ phase: { kind: "waiting", reason: "simulating" } });
    },

    forfeit() {
      const battle = snapshot.battle;
      if (!battle || battle.phase.kind === "ended") return;
      post({ type: "forfeit", battleId: battle.id });
    },

    rematch() {
      const battle = snapshot.battle;
      if (!battle) return;
      const order = submittedOrder ?? battle.lastPreview;
      stopBattle();
      startBattle(battle.setup, order);
    },

    changeTeams() {
      stopBattle();
      chosenFrom = null;
      set({ battle: null, setupError: null });
    },

    retryEngine() {
      stopBattle();
      disconnect();
      chosenFrom = null;
      queuedValidate = null;
      // The new worker re-runs the replays and import checks the old one was asked for; a Resume does not carry over.
      waiting = [...replayJobs.values()].map((job) => job.message);
      const suggestions = { ...snapshot.suggestions };
      for (const side of ["own", "opponent"] as const) {
        const last = suggestRequests[side];
        if (last && snapshot.suggestions[side].status !== "ready") {
          queuedSuggest[side] = last;
          suggestions[side] = { status: "loading", key: last.key };
        }
      }
      set({
        battle: null,
        suggestions,
        validation: { status: "idle" },
        moveOptions: Object.fromEntries(Object.entries(snapshot.moveOptions).filter(([, state]) => state.status === "ready")),
      });
      connect();
    },

    clearHabits() {
      habits = null;
      remove(HABITS_KEY + accountKey(account?.id ?? null));
      set({ habits: habitsView(null) });
    },

    setTrendsOpen(open) {
      if (open === snapshot.trendsOpen) return;
      set({ trendsOpen: open });
      if (account) write(TRENDS_KEY + accountKey(account.id), { open });
    },

    bindAccount(userId) {
      if (account && account.id === userId) return;
      const first = account === undefined;
      account = { id: userId };
      // Saved battles: this account's store (none, or a throw: unavailable).
      storeEpoch++;
      replayJobs.clear();
      try {
        store = options.battleStore?.(accountKey(userId)) ?? null;
      } catch {
        store = null;
      }
      const saved: SavedBattlesState = store
        ? { status: "loading", list: [], message: null, import: { status: "idle" }, autosaved: null }
        : { status: "unavailable", list: [], message: STORAGE_UNAVAILABLE, import: { status: "idle" }, autosaved: null };
      habits = readHabits(userId);
      const stored = readInfo(userId);
      const view = habitsView(habits);
      const trendsOpen = readTrendsOpen(userId);
      if (first) {
        // The draft so far belongs to this account: keep it, with its remembered categories when there are any.
        const info = stored ?? snapshot.draft.info;
        set({ draft: { ...snapshot.draft, info }, habits: view, trendsOpen, saved, replay: null });
        if (!stored) storeInfo(info);
        refreshSaved();
        return;
      }
      stopBattle();
      chosenFrom = null;
      submittedOrder = null;
      queuedValidate = null;
      set({
        draft: createSetupDraft(stored ?? DEFAULT_INFO), battle: null, validation: { status: "idle" }, setupError: null, habits: view, trendsOpen,
        suggestions: { own: { status: "idle" }, opponent: { status: "idle" } }, saved, replay: null,
      });
      refreshSaved();
    },

    openReplay(id) {
      const target = store;
      const epoch = storeEpoch;
      if (!target) return;
      target.get(id).then((record) => {
        if (epoch !== storeEpoch) return;
        if (!record || record.status !== "finished") { setSaved({ message: UNREADABLE }); return; }
        set({ replay: replayView(record, null) });
        rerun(record, "view");
      }, (error: unknown) => { if (epoch === storeEpoch) setSaved({ message: factOf(error, UNREADABLE) }); });
    },

    closeReplay() {
      for (const job of [...replayJobs.values()]) if (job.kind === "view") replayJobs.delete(job.replayId);
      if (snapshot.replay) set({ replay: null });
    },

    resume(id) {
      const target = store;
      const epoch = storeEpoch;
      if (!target) return;
      target.get(id).then((record) => {
        if (epoch !== storeEpoch) return;
        if (!record || record.status !== "unfinished" || !record.resume) { setSaved({ message: UNREADABLE }); return; }
        stopBattle();
        chosenFrom = null;
        submittedOrder = record.order;
        habitsDetached = canonicalJson(habits) !== canonicalJson(record.habitsAfter);
        const battleId = ++battleCounter;
        set({
          replay: null, setupError: null, saved: { ...snapshot.saved, autosaved: { battleId, turn: record.turn } },
          battle: {
            id: battleId, setup: record.setup, seed: null, phase: { kind: "starting" }, board: null, log: record.log, ai: { status: "idle" },
            lastPreview: record.order, habitsBefore: record.habitsBefore ?? parseHabits(habits?.data), savedId: record.id, startedAt: record.createdAt, resumed: true,
          },
        });
        if (snapshot.engine.status === "error") { set({ battle: null, setupError: `The battle engine did not load: ${snapshot.engine.message ?? "unknown error"}` }); return; }
        postWhenReady({ type: "resume", battleId, setup: record.setup, sealed: record.resume.sealed, log: record.log });
      }, (error: unknown) => { if (epoch === storeEpoch) setSaved({ message: factOf(error, UNREADABLE) }); });
    },

    deleteSaved(id) {
      const target = store;
      const epoch = storeEpoch;
      if (!target) return;
      target.remove(id).then(() => { if (epoch === storeEpoch) refreshSaved(); }, (error: unknown) => { if (epoch === storeEpoch) setSaved({ message: factOf(error, STORAGE_UNAVAILABLE) }); });
    },

    deleteAllSaved() {
      const target = store;
      const epoch = storeEpoch;
      if (!target) return;
      target.removeAll().then(() => { if (epoch === storeEpoch) refreshSaved(); }, (error: unknown) => { if (epoch === storeEpoch) setSaved({ message: factOf(error, STORAGE_UNAVAILABLE) }); });
    },

    async exportSaved(id) {
      if (!store) return null;
      try {
        return await store.export(id);
      } catch (error) {
        setSaved({ message: factOf(error, UNREADABLE) });
        return null;
      }
    },

    importSaved(file) {
      const target = store;
      const epoch = storeEpoch;
      const name = file.name.slice(0, 120);
      if (!target) { setSaved({ import: { status: "error", name, message: STORAGE_UNAVAILABLE } }); return; }
      if (file.size > IMPORT_MAX_BYTES) { setSaved({ import: { status: "error", name, message: `The file is larger than ${IMPORT_MAX_LABEL}.` } }); return; }
      setSaved({ import: { status: "checking", name } });
      let checked: ReplayState["boards"] = null;
      // A file saved before the current wording is stored with the re-run's lines and steps: its own text is never shown.
      const verify = (record: SavedBattle) => new Promise<ImportCheck>((resolve) => {
        rerun(record, "import", (error, boards, turns) => { checked = boards; resolve(error ?? (turns ? { log: rewordedLog(record.log, turns) } : null)); });
      });
      // The browser's own words for an unreadable file are not a fact of ours.
      const read = file.text().catch(() => { throw new StoreError("The file could not be read."); });
      read.then((text) => target.import(text, verify)).then((record) => {
        if (epoch !== storeEpoch) return;
        setSaved({ import: { status: "done", name } });
        set({ replay: replayView(record, checked) });
        refreshSaved();
      }, (error: unknown) => {
        if (epoch !== storeEpoch) return;
        setSaved({ import: { status: "error", name, message: factOf(error, "The file could not be read.") } });
      });
    },
  };
}

const INERT: TrainingTransport = { post: () => undefined, onMessage: () => () => undefined, terminate: () => undefined };

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let singleton: TrainingSession | null = null;

/** Browser: the module singleton. Server: a fresh inert session per call (a server singleton would be shared across users). */
export function getTrainingSession(): TrainingSession {
  if (typeof window === "undefined") return createTrainingSession({ transport: () => INERT, storage: null, connect: false });
  singleton ??= createTrainingSession({ transport: createWorkerTransport, storage: browserStorage(), battleStore: browserBattleStore });
  return singleton;
}
