// The Training worker's message loop (SPEC §7.2): a pure function of messages, testable without a Worker. It owns the
// real battle; the AI decides from AiInputs only (G1–G5): your choice is held until the AI has committed, the AI's
// randomness depends only on (aiBase, requestId), and the read for a turn leaves only after that turn resolves,
// redacted per youSee.
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
import { jointActionKey, type DecisionReport, type JointAction, type LogTurn, type PlayerChoice, type TrainingSetup } from "../model/view-types";
import type { FromWorker, ToWorker } from "../model/worker-protocol";
import { createStepBuilder, type StepBuilder } from "../log/protocol-steps";
import { createLogFormatter, type LogFormatter } from "../log/protocol-text";
import { BattleHost } from "../sim/battle-host";
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
};

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
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const defaultYield = () => new Promise<void>((resolve) => {
  if (typeof MessageChannel === "undefined") { setTimeout(resolve, 0); return; }
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
  channel.port2.postMessage(null);
});

export function createTrainingWorker(deps: WorkerDeps): { receive(message: ToWorker): void } {
  const runtime = deps.runtime ?? championsRuntime;
  const yieldNow = deps.yieldNow ?? defaultYield;
  let validator: TeamValidator | null = null;
  let legality: SetLegality | null = null;
  let usage: TrainingUsageData | null = null;
  let state: BattleState | null = null;
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
  function start(battleId: number, setup: TrainingSetup, habits: HabitsRecord | null) {
    stop();
    let adapted: ReturnType<typeof adapt>;
    try {
      adapted = adapt(setup);
    } catch (error) {
      deps.post({ type: "battle-error", battleId, message: messageOf(error) });
      return;
    }
    const firstProblem = (["own", "opponent"] as const).flatMap((side) => {
      const problems = adapted.problems[side];
      return [...problems.team, ...Object.values(problems.members).flat()].map((problem) => `${side === "own" ? "Your team" : "Opponent"}: ${problem}`);
    })[0];
    if (hasProblems(adapted.problems.own) || hasProblems(adapted.problems.opponent)) {
      deps.post({ type: "battle-error", battleId, message: firstProblem ?? "The teams have problems." });
      return;
    }
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
    try {
      const host = new BattleHost({
        formatid: FORMAT, seed: null,
        p1: { name: "You", team: adapted.own.sets.map((entry) => entry.set) },
        p2: { name: "Training", team: adapted.opponent.sets.map((entry) => entry.set) },
      });
      state = {
        battleId, setup, host, adapted: { own: adapted.own, opponent: adapted.opponent }, keys,
        trackers: { p1: createTracker("p1", keys.keyOf), p2: createTracker("p2", keys.keyOf) },
        sheets: {
          forAI: redactSheet(sheetFromSets(adapted.own), setup.info.aiKnows),
          forYou,
        },
        provider: deps.createProvider(habits), aiBase: deps.randomHex(),
        formatter: createLogFormatter({ names: display }),
        // The board replays each turn from these steps (the same p1 channel as the log).
        steps: createStepBuilder({ names: display, keyOf: keys.keyOf, moveType }),
        log: new Map(), dirty: new Set(), snapshots: new Map(), ai: null, held: null, pending: new Map(), ownActions: new Map(),
        lastTurn: 0, habitsChanged: false, ended: false, forfeited: false,
      };
    } catch (error) {
      state = null;
      deps.post({ type: "battle-error", battleId, message: messageOf(error) });
      return;
    }
    advance(state);
  }

  function stop() {
    state?.ai?.controller.abort();
    state = null;
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
    s.dirty.add(turn);
  }

  function advance(s: BattleState) {
    if (state !== s) return;
    // 1. Drain both channels.
    const drain = s.host.drain();
    s.formatter.push(drain.channel.p1);
    s.steps.push(drain.channel.p1);
    s.trackers.p1.push(drain.channel.p1);
    s.trackers.p2.push(drain.channel.p2);
    const groups = s.formatter.turns();
    const stepGroups = s.steps.turns();
    groups.forEach((lines, turn) => {
      const entry = logTurn(s, turn);
      const steps = stepGroups[turn] ?? [];
      if (entry.lines.length !== lines.length || entry.steps?.length !== steps.length) { entry.lines = lines; entry.steps = steps; s.dirty.add(turn); }
    });
    // 2. Turns that resolved since the last drain (a new |turn| line, or the end).
    const turnNow = drain.turn;
    for (let turn = s.lastTurn; turn < turnNow; turn++) resolveTurn(s, turn);
    // A forfeit before your choice for this turn went in ends a turn that never ran: its AI choice and read stay in the
    // worker (G5; Rematch reuses the same teams). A forfeit during a mid-turn replacement ends a turn that did run.
    if (drain.ended) {
      if (s.forfeited && !s.ownActions.has(turnNow)) s.pending.delete(turnNow);
      else resolveTurn(s, turnNow);
    }
    s.lastTurn = turnNow;
    // 3. Ended: the battle record for habits, the final seed, no request.
    if (drain.ended) {
      s.ai?.controller.abort();
      const observations = s.trackers.p2.observations();
      const firstTurn = observations.find((each) => each.turn === 1);
      const leads = firstTurn && firstTurn.actions.length === 2 ? [firstTurn.actions[0].key.slice(3), firstTurn.actions[1].key.slice(3)] as [string, string] : null;
      const revealed = Object.values(s.trackers.p2.state().mons).filter((mon) => mon.side === "p1" && mon.switchIns > 0).map((mon) => mon.key.slice(3));
      try { s.provider.observeBattle({ leads, revealed }); s.habitsChanged = true; } catch { /* habits only */ }
      const winner = drain.ended.winner;
      post(s, {
        seed: String(s.host.battle.prng.startingSeed), request: null,
        ended: { result: winner === "p1" ? "win" : winner === "p2" ? "loss" : "tie", forfeited: s.forfeited },
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
    // 6. The AI thinks during your think time.
    if (s.host.needsChoice("p2") && s.ai?.requestId !== drain.requestId) startAi(s, drain.requestId, drain.midTurn);
  }

  function post(s: BattleState, part: { seed: string | null; request: ReturnType<typeof yourRequest>; ended: { result: "win" | "loss" | "tie"; forfeited: boolean } | null }) {
    const board = buildBoard({ battle: s.host.battle, tracker: s.trackers.p1, sheet: s.sheets.forYou, info: s.setup.info.youSee, keys: s.keys, runtime, ownKeys: s.adapted.own.sets.map((entry) => entry.key) });
    const log = [...s.dirty].sort((a, b) => a - b).map((turn) => structuredClone(logTurn(s, turn)));
    s.dirty.clear();
    const habits = s.habitsChanged ? s.provider.habits() : undefined;
    s.habitsChanged = false;
    deps.post({ type: "battle", battleId: s.battleId, seed: part.seed, request: part.request, board, log, ended: part.ended, ...(habits ? { habits } : {}) });
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

  async function decide(s: BattleState, requestId: number, midTurn: boolean, salt: string, signal: AbortSignal) {
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
    const decision = await s.provider.chooseTurn({ runtime, inputs, services, usage }, options(s, requestId, signal, salt));
    return { choice: toChoiceString("p2", decision.action, request, s.keys, "p2"), action: decision.action, report: decision.report, question: decision.question };
  }

  function startAi(s: BattleState, requestId: number, midTurn: boolean) {
    const job: AiJob = { requestId, controller: new AbortController(), committed: false };
    s.ai = job;
    deps.post({ type: "ai", battleId: s.battleId, requestId, status: "thinking" });
    const live = () => state === s && s.ai === job && !job.controller.signal.aborted;
    const turn = s.host.battle.turn;
    const request = s.host.request("p2");
    const slotMembers: Partial<Record<DoublesSlotId, string>> = {};
    request?.side.pokemon.slice(0, 2).forEach((each, position) => { if (each.active) slotMembers[slotAt("p2", position, "p2")] = s.keys.keyOf("p2", identName(each.ident)); });
    const shownMembers: Partial<Record<DoublesSlotId, string>> = {};
    for (const mon of Object.values(s.trackers.p1.state().mons)) {
      if (mon.side === "p2" && mon.position !== null) shownMembers[slotAt("p2", mon.position, "p2")] = mon.key.slice(3);
    }
    const kind = request && "teamPreview" in request ? "preview" : request && "forceSwitch" in request ? "switch" : "move";
    const run = async () => {
      let status: "locked" | "fallback" = "locked";
      let message: string | undefined;
      let result: Awaited<ReturnType<typeof decide>> | null = null;
      for (const salt of ["ai", "ai-retry"]) {
        try {
          result = await decide(s, requestId, midTurn, salt, job.controller.signal);
        } catch (error) {
          if (!live()) return;
          status = "fallback";
          message = error instanceof ChoiceBuildError ? error.message : messageOf(error);
          break;
        }
        if (!live()) return;
        const chosen = s.host.choose("p2", result.choice);
        if (chosen.ok) break;
        // A hidden trap or disable shown to the AI's seat re-emits its request: decide once more with fresh inputs.
        if (!chosen.requestChanged || salt === "ai-retry") { status = "fallback"; message = chosen.error; result = null; break; }
        result = null;
      }
      if (!live()) return;
      if (!result) {
        if (!s.host.choose("p2", fallbackChoice(s)).ok) s.host.choose("p2", "default");
        status = "fallback";
      }
      job.committed = true;
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
    const result = s.host.choose("p1", choice);
    if (result.ok && action && request && "active" in request) s.ownActions.set(turn, action);
    if (!result.ok) deps.post({ type: "choice-error", battleId: s.battleId, requestId: s.host.requestId, message: result.error });
  }

  function choose(battleId: number, requestId: number, choice: PlayerChoice) {
    const s = state;
    if (!s || s.battleId !== battleId || s.host.requestId !== requestId || s.ended) return;
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
    if (!s || s.battleId !== battleId) return;
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
      }
    },
  };
}

