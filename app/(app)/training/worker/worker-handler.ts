// The Training worker's message loop (SPEC §7.2): a pure function of messages, testable without a Worker. It owns the
// real battle; the AI decides from AiInputs only (G1–G5): your choice is held until the AI has committed, the AI's
// randomness depends only on (aiBase, requestId), and the read for a turn leaves only after that turn resolves,
// redacted per youSee. Saved battles: each resolved turn's checkpoint leaves sealed (Resume rebuilds the battle and the AI's
// state by replaying its choices, then plays on); a finished battle re-runs from its seed and choices for the replay screen.
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { AiInputs } from "../model/ai-inputs";
import {
  DEFAULT_BUDGET, type DecideOptions, type DecisionProvider, type HabitsRecord, type PlayerQuestion, type TurnRecord,
} from "../model/decision";
import { slotAt } from "../model/positions";
import type { ObservedAction } from "../model/public-state";
import type { SideID } from "../model/showdown-types";
import { createRandom, seedHex } from "../model/random";
import { redactSheet, type SheetView } from "../model/sheet";
import type { TrainingUsageData, SetLegality } from "../model/usage";
import { logHash, turnHashes } from "../model/saved-battle";
import { jointActionKey, type BoardView, type DecisionReport, type JointAction, type LogTurn, type PlayerChoice, type TrainingSetup } from "../model/view-types";
import type { FromWorker, ToWorker } from "../model/worker-protocol";
import { createStepBuilder, type StepBuilder } from "../log/protocol-steps";
import { createLogFormatter, type LogFormatter } from "../log/protocol-text";
import { BattleHost, type HostOptions } from "../sim/battle-host";
import { buildBoard } from "../sim/board";
import { ChoiceBuildError, identName, legalJointActions, teamChoice, toChoiceString, type MemberKeys } from "../sim/choices";
import { aiInputs, createTestOracle } from "../sim/inputs";
import { normalizeRequest } from "../sim/requests";
import { createTurnServices } from "../sim/services";
import { createSetLegality, hasProblems, memberKeys, sheetFromSets, toShowdownTeam, validateTeams, type AdaptedTeam } from "../sim/showdown-set";
import { Dex, FORMAT, TeamValidator } from "../sim/sim";
import { createTracker, type PublicTracker } from "../sim/tracker";
import { editorMoveOptions } from "../usage/move-options";
import { suggestTrainingSets } from "../usage/suggested-sets";
import { loadTrainingUsage } from "../usage/training-usage";
import { createMoveType } from "./move-type";
import { redactJoint, redactReport, type RedactContext } from "./redact-report";
import type { Sealer } from "./sealer";

export type WorkerDeps = {
  post(message: FromWorker): void;
  /** Integration: createEngineProvider({ runtime, habits }). */
  createProvider(habits: HabitsRecord | null): DecisionProvider;
  now(): number;
  /** 32 hex digits (crypto.getRandomValues in the worker). */
  randomHex(): string;
  /** BROWSER_VALVE_MS in the worker; null in tests and Node evaluation. */
  deadlineMs: number | null;
  /** Yields to the worker's message queue (MessageChannel); default below. */
  yieldNow?(): Promise<void>;
  runtime?: BattleRuntime;
  /** The training usage data (A1.1); default loadTrainingUsage. */
  usage?(): TrainingUsageData;
  /** Seals each resolved turn's checkpoint for Resume (worker/sealer.ts); absent or null: no checkpoints, Resume refused. */
  sealer?: Sealer | null;
};

/** One AI job as it ran: each decide (by salt) and each choice it sent the battle, in order. */
type AiStep = { decide: string } | { choose: string; ok: boolean };
/** Every choice that went into the battle, in order: what Resume replays (the AI's decides rebuild its state). */
type LiveEvent =
  | { by: "ai"; requestId: number; midTurn: boolean; steps: AiStep[]; action: JointAction | null; decided: boolean }
  | { by: "you"; requestId: number; choice: string; action: JointAction | null };
/** The sealed checkpoint (never posted in the clear). */
type Checkpoint = { v: 1; turn: number; seed: string; aiBase: string; habits: HabitsRecord | null; events: LiveEvent[]; hash: string };
const REBUILD_FAILED = "The saved battle did not re-run the same way.";

type AiJob = { requestId: number; controller: AbortController; committed: boolean };
type Pending = {
  turn: number; report: DecisionReport | null; question: Extract<PlayerQuestion, { kind: "turn" }> | null; aiAction: JointAction;
  /** The AI's member in each of its slots at the decision: from its request, and as your log showed it (Illusion). */
  slotMembers: Partial<Record<DoublesSlotId, string>>; shownMembers: Partial<Record<DoublesSlotId, string>>;
};
type BattleState = {
  battleId: number; setup: TrainingSetup; host: BattleHost; adapted: { own: AdaptedTeam; opponent: AdaptedTeam }; keys: MemberKeys;
  trackers: { p1: PublicTracker; p2: PublicTracker }; sheets: { forAI: SheetView; forYou: SheetView };
  provider: DecisionProvider; aiBase: string; formatter: LogFormatter; steps: StepBuilder;
  log: Map<number, LogTurn>; dirty: Set<number>; snapshots: Map<number, string>;
  ai: AiJob | null; held: { requestId: number; choice: string; action: JointAction | null } | null;
  /** The AI's turn decision waiting for its turn to resolve (keyed by the turn number). */
  pending: Map<number, Pending>;
  /** Your committed move action per turn. */
  ownActions: Map<number, JointAction>;
  lastTurn: number; habitsChanged: boolean; ended: boolean; forfeited: boolean;
  /** The simulator's seed ("sodium,…"), the habits this battle started from, and every choice so far (checkpoints). */
  seed: string; habitsAtStart: HabitsRecord | null; events: LiveEvent[];
  /** Resume: the reads as they were shown, by turn (the rebuild does not re-run decisions). Non-null while rebuilding. */
  shownReads: Map<number, DecisionReport | null> | null;
  /** Resume is replaying the recorded choices: your choices and a forfeit wait for it. */
  rebuilding: boolean;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const defaultYield = () => new Promise<void>((resolve) => {
  if (typeof MessageChannel === "undefined") { setTimeout(resolve, 0); return; }
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
  channel.port2.postMessage(null);
});

/** The live update rule of the log (advance and the replay share it): a turn's lines and steps are replaced when either count changed. */
function syncLog(log: Map<number, LogTurn>, formatter: LogFormatter, steps: StepBuilder, dirty?: Set<number>) {
  const groups = formatter.turns();
  const stepGroups = steps.turns();
  groups.forEach((lines, turn) => {
    let entry = log.get(turn);
    if (!entry) { entry = { turn, lines: [], steps: [], actions: null, read: null }; log.set(turn, entry); }
    const each = stepGroups[turn] ?? [];
    if (entry.lines.length !== lines.length || entry.steps?.length !== each.length) { entry.lines = lines; entry.steps = each; dirty?.add(turn); }
  });
}

/** The simulator's choice lines (">p1 move 1 2, move 2 1"); its >start and >player lines carry the seed and both teams. */
function choiceLines(inputLog: readonly string[]): string[] {
  return inputLog.filter((line) => /^>p[12] /.test(line));
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** The unsealed checkpoint (AES-GCM authenticated it; the shape is still checked). */
function parseCheckpoint(value: unknown): Checkpoint {
  if (!isRecord(value) || value.v !== 1 || typeof value.seed !== "string" || typeof value.aiBase !== "string" || typeof value.hash !== "string"
    || !Number.isInteger(value.turn) || !Array.isArray(value.events)) throw new Error("Not a checkpoint.");
  for (const event of value.events) {
    if (!isRecord(event) || !Number.isInteger(event.requestId)) throw new Error("Not a checkpoint.");
    if (event.by === "you" ? typeof event.choice !== "string" : event.by !== "ai" || !Array.isArray(event.steps)) throw new Error("Not a checkpoint.");
  }
  return value as unknown as Checkpoint;
}

export function createTrainingWorker(deps: WorkerDeps): { receive(message: ToWorker): void } {
  const runtime = deps.runtime ?? championsRuntime;
  const yieldNow = deps.yieldNow ?? defaultYield;
  let validator: TeamValidator | null = null;
  let legality: SetLegality | null = null;
  let usage: TrainingUsageData | null = null;
  let state: BattleState | null = null;
  /** Bumped by every stop: a Resume still unsealing or rebuilding gives up when another battle started meanwhile. */
  let generation = 0;
  /** Checkpoints are sealed in order (Web Crypto may settle two encryptions out of order). */
  let sealing: Promise<void> = Promise.resolve();
  const tools = () => {
    validator ??= new TeamValidator(FORMAT);
    legality ??= createSetLegality(validator, runtime);
    usage ??= (deps.usage ?? loadTrainingUsage)();
    return { validator, legality, usage };
  };

  // ---------- setup messages ----------
  function load() {
    const start = deps.now();
    try {
      Dex.forFormat(FORMAT);
      tools();
      deps.post({ type: "loaded", ms: Math.round(deps.now() - start) });
    } catch (error) {
      deps.post({ type: "load-error", message: messageOf(error) });
    }
  }
  function adapt(setup: TrainingSetup) {
    const own = toShowdownTeam(setup.own.members, runtime), opponent = toShowdownTeam(setup.opponent.members, runtime);
    return { own, opponent, problems: validateTeams(own, opponent, tools().validator) };
  }

  // ---------- the battle ----------
  /** The first problem Showdown's validator found ("Your team: …"), or null. */
  function firstProblem(problems: ReturnType<typeof adapt>["problems"]): string | null {
    if (!hasProblems(problems.own) && !hasProblems(problems.opponent)) return null;
    return (["own", "opponent"] as const).flatMap((side) => {
      const list = problems[side];
      return [...list.team, ...Object.values(list.members).flat()].map((problem) => `${side === "own" ? "Your team" : "Opponent"}: ${problem}`);
    })[0] ?? "The teams have problems.";
  }

  /**
   * The battle and what reads your channel: the host (a given seed for Resume and replays, else a fresh sodium seed), the
   * member keys, the log formatter, the playback's steps and both trackers. Throws on teams the validator refuses.
   */
  function battleParts(setup: TrainingSetup, seed: string | null) {
    const adapted = adapt(setup);
    const problem = firstProblem(adapted.problems);
    if (problem) throw new Error(problem);
    const keys = memberKeys(adapted.own, adapted.opponent);
    const names = new Map<string, string>();
    // Log names are the species each set battles as (a Mega form is sent as its base holding the stone, sim/showdown-set.ts).
    for (const [side, team] of [["p1", adapted.own], ["p2", adapted.opponent]] as const) for (const { key, set } of team.sets) names.set(`${side}:${key}`, set.name);
    const display = (side: SideID, name: string) => names.get(`${side}:${keys.keyOf(side, name)}`) ?? name;
    const forYou = redactSheet(sheetFromSets(adapted.opponent), setup.info.youSee);
    // A move's type for the playback's colours, with its user's ability where you know it (your sets; the AI's as "You see" opens).
    const moveType = createMoveType((user) => {
      const key = keys.keyOf(user.side, user.name);
      if (user.side === "p1") return adapted.own.sets.find((entry) => entry.key === key)?.set.ability ?? null;
      const id = forYou.members.find((member) => member.key === key)?.abilityId;
      return id ? Dex.forFormat(FORMAT).abilities.get(id).name : null;
    });
    const host = new BattleHost({
      formatid: FORMAT, seed: seed as HostOptions["seed"],
      p1: { name: "You", team: adapted.own.sets.map((entry) => entry.set) },
      p2: { name: "Training", team: adapted.opponent.sets.map((entry) => entry.set) },
    });
    return {
      host, adapted: { own: adapted.own, opponent: adapted.opponent }, keys, forYou,
      trackers: { p1: createTracker("p1", keys.keyOf), p2: createTracker("p2", keys.keyOf) },
      formatter: createLogFormatter({ names: display }),
      // The board replays each turn from these steps (the same p1 channel as the log).
      steps: createStepBuilder({ names: display, keyOf: keys.keyOf, moveType }),
    };
  }

  /** A new battle's state (Resume: its seed, AI seed base and starting habits); null after posting battle-error. */
  function createBattle(battleId: number, setup: TrainingSetup, habits: HabitsRecord | null, saved?: { seed: string; aiBase: string }): BattleState | null {
    try {
      const parts = battleParts(setup, saved?.seed ?? null);
      return {
        battleId, setup, host: parts.host, adapted: parts.adapted, keys: parts.keys, trackers: parts.trackers,
        sheets: { forAI: redactSheet(sheetFromSets(parts.adapted.own), setup.info.aiKnows), forYou: parts.forYou },
        provider: deps.createProvider(habits), aiBase: saved?.aiBase ?? deps.randomHex(),
        formatter: parts.formatter, steps: parts.steps,
        log: new Map(), dirty: new Set(), snapshots: new Map(), ai: null, held: null, pending: new Map(), ownActions: new Map(),
        lastTurn: 0, habitsChanged: false, ended: false, forfeited: false,
        seed: String(parts.host.battle.prng.startingSeed), habitsAtStart: habits ? structuredClone(habits) : null, events: [], shownReads: null, rebuilding: false,
      };
    } catch (error) {
      deps.post({ type: "battle-error", battleId, message: messageOf(error) });
      return null;
    }
  }

  function start(battleId: number, setup: TrainingSetup, habits: HabitsRecord | null) {
    stop();
    const s = createBattle(battleId, setup, habits);
    if (!s) return;
    state = s;
    advance(s);
  }

  function stop() {
    state?.ai?.controller.abort();
    state = null;
    generation++;
  }

  /** p1's request as the page gets it: its own, or "wait" while only the AI chooses. */
  function yourRequest(s: BattleState) {
    const request = s.host.request("p1");
    if (!request) return null;
    return normalizeRequest(request, s.host.battle, s.host.requestId);
  }

  function logTurn(s: BattleState, turn: number): LogTurn {
    let entry = s.log.get(turn);
    if (!entry) { entry = { turn, lines: [], steps: [], actions: null, read: null }; s.log.set(turn, entry); }
    return entry;
  }

  function redactContext(s: BattleState, pending: Pending): RedactContext {
    return { state: s.trackers.p1.state(), youSee: s.setup.info.youSee, slotMembers: pending.slotMembers, shownMembers: pending.shownMembers };
  }

  /** What the AI's log showed each of your slots do in `turn` (never your choice string), and a Mega it showed. */
  function observedOf(s: BattleState, turn: number): { observed: TurnRecord["observed"]; observedMega: DoublesSlotId | null } {
    const record = s.trackers.p2.observations().find((each) => each.turn === turn);
    const observed: Partial<Record<DoublesSlotId, ObservedAction>> = {};
    let observedMega: DoublesSlotId | null = null;
    if (!record) return { observed, observedMega };
    for (const each of record.actions) observed[slotAt("p1", each.position, "p2")] = each.action;
    for (const reveal of record.reveals) {
      if (reveal.kind !== "mega" || !reveal.key.startsWith("p1:")) continue;
      const at = record.actions.find((each) => each.key === reveal.key);
      if (at) observedMega = slotAt("p1", at.position, "p2");
    }
    return { observed, observedMega };
  }

  /** A finished turn: its read (redacted, only now), both sides' actions, and the habits update (I8). */
  function resolveTurn(s: BattleState, turn: number) {
    const pending = s.pending.get(turn);
    s.pending.delete(turn);
    const entry = logTurn(s, turn);
    const own = s.ownActions.get(turn) ?? null;
    if (pending) {
      const ctx = redactContext(s, pending);
      if (turn > 0) entry.actions = { own: own ?? {}, opponent: redactJoint(pending.aiAction, ctx) };
      if (pending.report && s.setup.showRead) {
        const actual = own ? pending.report.predicted.find((option) => option.action && jointActionKey(option.action) === jointActionKey(own))?.chance ?? null : null;
        entry.read = redactReport({ ...pending.report, actual: turn > 0 ? { chance: actual } : null }, ctx);
      }
      if (turn > 0 && pending.question) {
        const { observed, observedMega } = observedOf(s, turn);
        try {
          s.provider.observeTurn({ turn, question: pending.question, observed, observedMega, opponent: pending.aiAction });
          s.habitsChanged = true;
        } catch { /* a habits failure never stops the battle */ }
      }
    }
    // Resume: the reads as they were shown (the rebuild replays the AI's state, not its decisions).
    if (s.shownReads) entry.read = s.shownReads.get(turn) ?? null;
    s.dirty.add(turn);
  }

  /** Steps 1–2 of advance: both channels into the log, the steps and the trackers, then the turns that resolved. */
  function ingest(s: BattleState) {
    const drain = s.host.drain();
    s.formatter.push(drain.channel.p1);
    s.steps.push(drain.channel.p1);
    s.trackers.p1.push(drain.channel.p1);
    s.trackers.p2.push(drain.channel.p2);
    syncLog(s.log, s.formatter, s.steps, s.dirty);
    // Turns that resolved since the last drain (a new |turn| line, or the end).
    const turnNow = drain.turn;
    const resolved = turnNow > s.lastTurn;
    for (let turn = s.lastTurn; turn < turnNow; turn++) resolveTurn(s, turn);
    // A forfeit before your choice for this turn went in ends a turn that never ran: its AI choice and read stay in the
    // worker (G5; Rematch reuses the same teams). A forfeit during a mid-turn replacement ends a turn that did run.
    if (drain.ended) {
      if (s.forfeited && !s.ownActions.has(turnNow)) s.pending.delete(turnNow);
      else resolveTurn(s, turnNow);
    }
    s.lastTurn = turnNow;
    return { drain, resolved };
  }

  function advance(s: BattleState) {
    if (state !== s) return;
    // 1–2. Drain, then the turns that resolved.
    const { drain, resolved } = ingest(s);
    // 3. Ended: the battle record for habits, the final seed, both sides' choices, no request.
    if (drain.ended) {
      s.ai?.controller.abort();
      const observations = s.trackers.p2.observations();
      const firstTurn = observations.find((each) => each.turn === 1);
      const leads = firstTurn && firstTurn.actions.length === 2 ? [firstTurn.actions[0].key.slice(3), firstTurn.actions[1].key.slice(3)] as [string, string] : null;
      const revealed = Object.values(s.trackers.p2.state().mons).filter((mon) => mon.side === "p1" && mon.switchIns > 0).map((mon) => mon.key.slice(3));
      try { s.provider.observeBattle({ leads, revealed }); s.habitsChanged = true; } catch { /* habits only */ }
      const winner = drain.ended.winner;
      post(s, {
        seed: s.seed, request: null,
        ended: { result: winner === "p1" ? "win" : winner === "p2" ? "loss" : "tie", forfeited: s.forfeited },
        inputLog: choiceLines(s.host.inputLog()),
      });
      state = null;
      return;
    }
    // 4. Snapshot for your choice check (the last two requests).
    if (!s.snapshots.has(drain.requestId)) {
      s.snapshots.set(drain.requestId, s.host.snapshot());
      for (const id of [...s.snapshots.keys()]) if (id < drain.requestId - 1) s.snapshots.delete(id);
    }
    // 5. Your request (or wait), the board and the changed turns.
    post(s, { seed: null, request: yourRequest(s), ended: null });
    // 5b. A turn resolved: its checkpoint for Resume, before the AI's next job (its choice for this turn is not in it).
    if (resolved && drain.turn >= 1) checkpoint(s, drain.turn);
    // 6. The AI thinks during your think time.
    if (s.host.needsChoice("p2") && s.ai?.requestId !== drain.requestId) startAi(s, drain.requestId, drain.midTurn);
  }

  function post(s: BattleState, part: { seed: string | null; request: ReturnType<typeof yourRequest>; ended: { result: "win" | "loss" | "tie"; forfeited: boolean } | null; inputLog?: string[] }) {
    const board = boardOf(s);
    const log = [...s.dirty].sort((a, b) => a - b).map((turn) => structuredClone(logTurn(s, turn)));
    s.dirty.clear();
    const habits = s.habitsChanged ? s.provider.habits() : undefined;
    s.habitsChanged = false;
    deps.post({
      type: "battle", battleId: s.battleId, seed: part.seed, request: part.request, board, log, ended: part.ended,
      ...(habits ? { habits } : {}), ...(part.inputLog ? { inputLog: part.inputLog } : {}),
    });
  }

  /** The board as you can see it (per setup.info.youSee). */
  function boardOf(s: Pick<BattleState, "host" | "trackers" | "sheets" | "setup" | "keys" | "adapted">): BoardView {
    return buildBoard({ battle: s.host.battle, tracker: s.trackers.p1, sheet: s.sheets.forYou, info: s.setup.info.youSee, keys: s.keys, runtime, ownKeys: s.adapted.own.sets.map((entry) => entry.key) });
  }

  // ---------- saved battles: checkpoints, Resume, replays ----------
  /** The battle sealed as this turn begins: seed, AI seed base, starting habits, every choice so far and the log's hash. */
  function checkpoint(s: BattleState, turn: number) {
    const sealer = deps.sealer;
    if (!sealer) return;
    const payload: Checkpoint = { v: 1, turn, seed: s.seed, aiBase: s.aiBase, habits: s.habitsAtStart, events: structuredClone(s.events), hash: logHash([...s.log.values()]) };
    const battleId = s.battleId;
    // One after another: the page stores each checkpoint over the last, so an older one never lands after a newer one.
    sealing = sealing.then(() => sealer.seal(JSON.stringify(payload))).then(
      (sealed) => deps.post({ type: "checkpoint", battleId, turn, sealed }),
      () => deps.post({ type: "checkpoint", battleId, turn, sealed: null }),
    );
  }

  /**
   * Resume: a new battle on the checkpoint's seed with its AI seed base and starting habits; every recorded choice goes in
   * again in order, with the AI's decides re-run up to their question (provider.replayTurn), so the AI's belief and habits
   * are the ones it had. The log must hash as the checkpoint's. Then it posts the board and your request and plays on.
   */
  async function resume(battleId: number, setup: TrainingSetup, sealed: string, shown: readonly LogTurn[]) {
    stop();
    const mine = generation;
    const fail = (message: string) => {
      if (generation !== mine) return;
      state = null;
      deps.post({ type: "battle-error", battleId, message });
    };
    if (!deps.sealer) { fail("Resume is unavailable in this browser."); return; }
    let saved: Checkpoint;
    try {
      saved = parseCheckpoint(JSON.parse(await deps.sealer.unseal(sealed)));
    } catch {
      fail("The saved battle cannot be opened in this browser.");
      return;
    }
    if (generation !== mine) return;
    const s = createBattle(battleId, setup, saved.habits, { seed: saved.seed, aiBase: saved.aiBase });
    if (!s) return;
    state = s;
    s.shownReads = new Map(shown.map((turn) => [turn.turn, turn.read ?? null]));
    s.rebuilding = true;
    try {
      ingest(s);
      for (const event of saved.events) {
        const ok = event.by === "ai" ? await rebuildAi(s, event) : rebuildYours(s, event);
        if (state !== s) return;
        if (!ok) throw new Error(REBUILD_FAILED);
        ingest(s);
      }
      if (s.host.battle.ended || s.lastTurn !== saved.turn || logHash([...s.log.values()]) !== saved.hash) throw new Error(REBUILD_FAILED);
    } catch (error) {
      if (state === s) fail(messageOf(error) === REBUILD_FAILED ? REBUILD_FAILED : `${REBUILD_FAILED} ${messageOf(error)}`);
      return;
    }
    s.shownReads = null;
    s.rebuilding = false;
    advance(s);
  }

  /** One recorded AI job: its decides (the AI's state only) and its choices, as they ran. */
  async function rebuildAi(s: BattleState, event: Extract<LiveEvent, { by: "ai" }>): Promise<boolean> {
    if (s.host.requestId !== event.requestId || !s.host.needsChoice("p2")) return false;
    const at = aiContext(s);
    const controller = new AbortController();
    let question: Pending["question"] = null;
    for (const step of event.steps) {
      if ("decide" in step) {
        try {
          question = (await decide(s, event.requestId, event.midTurn, step.decide, controller.signal, true)).question;
        } catch {
          question = null;
        }
        if (state !== s) return false;
      } else if (s.host.choose("p2", step.choose).ok !== step.ok) return false;
    }
    s.ai = { requestId: event.requestId, controller, committed: true };
    if (at.kind !== "switch") {
      s.pending.set(at.turn, { turn: at.turn, report: null, question: event.decided ? question : null, aiAction: event.action ?? {}, slotMembers: at.slotMembers, shownMembers: at.shownMembers });
    }
    s.events.push(event);
    return true;
  }

  function rebuildYours(s: BattleState, event: Extract<LiveEvent, { by: "you" }>): boolean {
    if (s.host.requestId !== event.requestId) return false;
    const request = s.host.request("p1");
    const turn = s.host.battle.turn;
    if (!s.host.choose("p1", event.choice).ok) return false;
    if (event.action && request && "active" in request) s.ownActions.set(turn, event.action);
    s.events.push(event);
    return true;
  }

  /**
   * The replay screen: the teams through Showdown's validator (an import file is untrusted), then the battle re-run from
   * its seed and choice lines, drained after each choice as the live battle was. Posts the board as each turn began and
   * after the end (per setup.info.youSee, from your channel) and the re-run log's hashes; never the log itself.
   */
  function replay(replayId: number, setup: TrainingSetup, seed: string, inputLog: readonly string[], forfeited: boolean) {
    const fail = (message: string) => deps.post({ type: "replay-error", replayId, message });
    let parts: ReturnType<typeof battleParts>;
    try {
      parts = battleParts(setup, seed);
    } catch (error) {
      fail(messageOf(error));
      return;
    }
    const view = { host: parts.host, trackers: parts.trackers, sheets: { forAI: parts.forYou, forYou: parts.forYou }, setup, keys: parts.keys, adapted: parts.adapted };
    const log = new Map<number, LogTurn>();
    const starts: Record<number, BoardView> = {};
    let turn = 0;
    let ended: ReturnType<BattleHost["drain"]>["ended"] = null;
    const pump = () => {
      const drain = parts.host.drain();
      ended = drain.ended;
      parts.formatter.push(drain.channel.p1);
      parts.steps.push(drain.channel.p1);
      parts.trackers.p1.push(drain.channel.p1);
      syncLog(log, parts.formatter, parts.steps);
      if (drain.turn > turn) {
        turn = drain.turn;
        if (!drain.ended) starts[turn] = boardOf(view);
      }
    };
    try {
      pump();
      for (const [index, line] of inputLog.entries()) {
        const match = /^>(p[12]) (.+)$/.exec(line);
        if (!match || parts.host.battle.ended) { fail(`The saved choices do not fit the battle (choice ${index + 1}).`); return; }
        if (!parts.host.choose(match[1] as SideID, match[2]).ok) { fail(`The saved choices do not fit the battle (turn ${Math.max(1, parts.host.battle.turn)}).`); return; }
        pump();
      }
      // The forfeit is the battle's end only when the choices did not end it first.
      const forfeit = forfeited && !parts.host.battle.ended;
      if (forfeit) { parts.host.forfeit("p1"); pump(); }
      if (!parts.host.battle.ended) { fail("The saved choices end before the battle does."); return; }
      const winner = (ended as ReturnType<BattleHost["drain"]>["ended"])?.winner ?? null;
      const turns = [...log.values()];
      deps.post({
        type: "replay-ready", replayId, starts, end: boardOf(view), hash: logHash(turns), turnHashes: turnHashes(turns),
        result: { result: winner === "p1" ? "win" : winner === "p2" ? "loss" : "tie", forfeited: forfeit },
      });
    } catch (error) {
      fail(messageOf(error));
    }
  }

  // ---------- the AI's seat ----------
  function inputsFor(s: BattleState, requestId: number): AiInputs {
    const info = s.setup.info.aiKnows;
    // Constructed only under a test extra; it reads the real battle for those two facts alone (I10).
    const oracle = info.exactHP || info.brought ? createTestOracle(s.host.battle, "p2", info, s.keys) : null;
    return aiInputs({ side: "p2", requestId, request: s.host.request("p2")!, own: s.adapted.opponent, sheet: s.sheets.forAI, tracker: s.trackers.p2, info, oracle });
  }

  function options(s: BattleState, requestId: number, signal: AbortSignal, salt: string): DecideOptions {
    return {
      difficulty: s.setup.difficulty, budget: DEFAULT_BUDGET, deadlineMs: deps.deadlineMs,
      random: createRandom(s.aiBase, requestId, salt), seedBase: seedHex(s.aiBase, requestId), signal, yieldNow, now: deps.now,
    };
  }

  function fallbackChoice(s: BattleState): string {
    const request = s.host.request("p2");
    if (!request) return "default";
    if ("teamPreview" in request) return teamChoice([1, 2, 3, 4]);
    const bench = request.side.pokemon.map((each) => s.keys.keyOf("p2", identName(each.ident)));
    const legal = legalJointActions({ side: "p2", aiSide: "p2", request, bench, firstTurn: [false, false], megaUsed: true, keys: s.keys });
    try { return legal[0] ? toChoiceString("p2", legal[0], request, s.keys, "p2") : "default"; } catch { return "default"; }
  }

  /** `rebuild` (Resume): a turn's decide goes only up to its question (provider.replayTurn when it has one). */
  async function decide(s: BattleState, requestId: number, midTurn: boolean, salt: string, signal: AbortSignal, rebuild = false) {
    const request = s.host.request("p2")!;
    const usage = tools().usage;
    if ("teamPreview" in request) {
      const preview = await s.provider.teamPreview({ runtime, ai: s.setup.opponent, sheet: s.sheets.forAI, info: s.setup.info.aiKnows, usage }, options(s, requestId, signal, salt));
      return { choice: teamChoice(preview.order), action: null, report: preview.report, question: null };
    }
    const inputs = inputsFor(s, requestId);
    const seedBase = seedHex(s.aiBase, requestId);
    const services = (worlds: Parameters<typeof createTurnServices>[1]) => createTurnServices(inputs, worlds, { runtime, keys: s.keys, seedBase, midTurn });
    if ("forceSwitch" in request) {
      const slots = request.forceSwitch.map((flag, position) => (flag ? slotAt("p2", position, "p2") : null)).filter((slot): slot is DoublesSlotId => !!slot);
      const decision = await s.provider.chooseReplacements({ runtime, inputs, services, slots, midTurn, usage }, options(s, requestId, signal, salt));
      return { choice: toChoiceString("p2", decision.action, request, s.keys, "p2"), action: decision.action, report: null, question: null };
    }
    if (rebuild && s.provider.replayTurn) return { choice: "", action: null, report: null, question: await s.provider.replayTurn({ runtime, inputs, services, usage }, options(s, requestId, signal, salt)) };
    const decision = await s.provider.chooseTurn({ runtime, inputs, services, usage }, options(s, requestId, signal, salt));
    return { choice: toChoiceString("p2", decision.action, request, s.keys, "p2"), action: decision.action, report: decision.report, question: decision.question };
  }

  /** What the AI's job records at its start: the turn, the AI's member in each slot (its request) and as your log shows it. */
  function aiContext(s: BattleState) {
    const turn = s.host.battle.turn;
    const request = s.host.request("p2");
    const slotMembers: Partial<Record<DoublesSlotId, string>> = {};
    request?.side.pokemon.slice(0, 2).forEach((each, position) => { if (each.active) slotMembers[slotAt("p2", position, "p2")] = s.keys.keyOf("p2", identName(each.ident)); });
    const shownMembers: Partial<Record<DoublesSlotId, string>> = {};
    for (const mon of Object.values(s.trackers.p1.state().mons)) {
      if (mon.side === "p2" && mon.position !== null) shownMembers[slotAt("p2", mon.position, "p2")] = mon.key.slice(3);
    }
    const kind = request && "teamPreview" in request ? "preview" : request && "forceSwitch" in request ? "switch" : "move";
    return { turn, slotMembers, shownMembers, kind };
  }

  function startAi(s: BattleState, requestId: number, midTurn: boolean) {
    const job: AiJob = { requestId, controller: new AbortController(), committed: false };
    s.ai = job;
    deps.post({ type: "ai", battleId: s.battleId, requestId, status: "thinking" });
    const live = () => state === s && s.ai === job && !job.controller.signal.aborted;
    const { turn, slotMembers, shownMembers, kind } = aiContext(s);
    const run = async () => {
      let status: "locked" | "fallback" = "locked";
      let message: string | undefined;
      let result: Awaited<ReturnType<typeof decide>> | null = null;
      // Recorded for checkpoints: Resume replays each decide (the AI's state) and each choice in this order.
      const steps: AiStep[] = [];
      const send = (choice: string) => { const chosen = s.host.choose("p2", choice); steps.push({ choose: choice, ok: chosen.ok }); return chosen; };
      for (const salt of ["ai", "ai-retry"]) {
        steps.push({ decide: salt });
        try {
          result = await decide(s, requestId, midTurn, salt, job.controller.signal);
        } catch (error) {
          if (!live()) return;
          status = "fallback";
          message = error instanceof ChoiceBuildError ? error.message : messageOf(error);
          break;
        }
        if (!live()) return;
        const chosen = send(result.choice);
        if (chosen.ok) break;
        // A hidden trap or disable shown to the AI's seat re-emits its request: decide once more with fresh inputs.
        if (!chosen.requestChanged || salt === "ai-retry") { status = "fallback"; message = chosen.error; result = null; break; }
        result = null;
      }
      if (!live()) return;
      if (!result) {
        if (!send(fallbackChoice(s)).ok) send("default");
        status = "fallback";
      }
      job.committed = true;
      s.events.push({ by: "ai", requestId, midTurn, steps, action: result?.action ?? null, decided: !!result });
      if (kind !== "switch") s.pending.set(turn, { turn, report: result?.report ?? null, question: result?.question ?? null, aiAction: result?.action ?? {}, slotMembers, shownMembers });
      deps.post({ type: "ai", battleId: s.battleId, requestId, status, ...(message ? { message } : {}) });
      // G1: your held choice goes in only now (it already passed the clone check).
      const held = s.held;
      if (held && held.requestId === requestId) {
        s.held = null;
        commitYours(s, held.choice, held.action);
      }
      advance(s);
    };
    void run();
  }

  function commitYours(s: BattleState, choice: string, action: JointAction | null) {
    // Your move action belongs to the turn it is chosen for (the commit may run that turn).
    const request = s.host.request("p1");
    const turn = s.host.battle.turn;
    const requestId = s.host.requestId;
    const result = s.host.choose("p1", choice);
    if (result.ok && action && request && "active" in request) s.ownActions.set(turn, action);
    if (result.ok) s.events.push({ by: "you", requestId, choice, action });
    if (!result.ok) deps.post({ type: "choice-error", battleId: s.battleId, requestId: s.host.requestId, message: result.error });
  }

  function choose(battleId: number, requestId: number, choice: PlayerChoice) {
    const s = state;
    if (!s || s.battleId !== battleId || s.host.requestId !== requestId || s.ended || s.rebuilding) return;
    const request = s.host.request("p1");
    if (!request || "wait" in request) return;
    let text: string;
    let action: JointAction | null = null;
    try {
      if (choice.kind === "team") {
        if (!("teamPreview" in request)) throw new ChoiceBuildError("Not team preview.");
        text = teamChoice(choice.order);
      } else {
        text = toChoiceString("p1", choice.action, request, s.keys, "p2");
        action = choice.action;
      }
    } catch (error) {
      deps.post({ type: "choice-error", battleId, requestId, message: error instanceof ChoiceBuildError ? error.message : messageOf(error) });
      return;
    }
    const snapshot = s.snapshots.get(requestId) ?? s.host.snapshot();
    const check = s.host.checkChoice("p1", text, snapshot);
    if (!check.ok) {
      const updated = check.requestChanged && check.request ? normalizeRequest(check.request, s.host.battle, requestId) : undefined;
      deps.post({ type: "choice-error", battleId, requestId, message: check.error, ...(updated ? { request: updated } : {}) });
      return;
    }
    // G1: never while the AI's job for this request is unresolved.
    if (s.host.needsChoice("p2") && !(s.ai?.requestId === requestId && s.ai.committed)) {
      s.held = { requestId, choice: text, action };
      return;
    }
    commitYours(s, text, action);
    advance(s);
  }

  function forfeit(battleId: number) {
    const s = state;
    if (!s || s.battleId !== battleId || s.rebuilding) return;
    s.ai?.controller.abort();
    s.held = null;
    s.forfeited = true;
    s.host.forfeit("p1");
    advance(s);
  }

  // ---------- usage helpers (A1.2, A1.3) ----------
  function suggest(key: string, side: "own" | "opponent", members: Parameters<typeof suggestTrainingSets>[0]) {
    try {
      const { usage: data, legality: rules } = tools();
      deps.post({ type: "suggested", key, side, sets: suggestTrainingSets(members, { usage: data, legality: rules, runtime }) });
    } catch (error) {
      deps.post({ type: "suggest-error", key, side, message: messageOf(error) });
    }
  }
  function moveOptions(speciesId: string) {
    try {
      const { usage: data, legality: rules } = tools();
      deps.post({ type: "move-options-ready", speciesId, moves: editorMoveOptions(speciesId, { usage: data, legality: rules, runtime }) });
    } catch (error) {
      deps.post({ type: "move-options-error", speciesId, message: messageOf(error) });
    }
  }

  return {
    receive(message: ToWorker) {
      switch (message.type) {
        case "load": load(); return;
        case "validate":
          try {
            const { problems } = adapt(message.setup);
            deps.post({ type: "validated", key: message.key, own: problems.own, opponent: problems.opponent });
          } catch (error) {
            deps.post({ type: "validate-error", key: message.key, message: messageOf(error) });
          }
          return;
        case "start": start(message.battleId, message.setup, message.habits); return;
        case "choose": choose(message.battleId, message.requestId, message.choice); return;
        case "forfeit": forfeit(message.battleId); return;
        case "stop": if (state?.battleId === message.battleId) stop(); return;
        case "suggest": suggest(message.key, message.side, message.members); return;
        case "move-options": moveOptions(message.speciesId); return;
        case "resume": void resume(message.battleId, message.setup, message.sealed, message.log); return;
        case "replay": replay(message.replayId, message.setup, message.seed, message.inputLog, message.forfeited); return;
      }
    },
  };
}

