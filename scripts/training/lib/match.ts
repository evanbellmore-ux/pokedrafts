// The Training match runner (SPEC §14.2): one battle on the real BattleHost between two DecisionProviders, each seat
// through its own tracker, its own AiInputs (p2 with info.aiKnows, p1 with info.youSee) and its own ServicesFactory,
// mirroring worker/worker-handler.ts advance(). Deterministic: deadlineMs null, seeds from model/random.ts (SPEC 5.10).
// The runner is a reader of the real battle (SPEC I10, boundary test): only for the test oracle (test extras) and results.
import { createHash } from "node:crypto";
import { DOUBLES_SLOTS, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { AiInputs, BeliefWorld } from "@/app/(app)/training/model/ai-inputs";
import type { TurnServices } from "@/app/(app)/training/model/ai-view";
import type { DecideOptions, DecisionProvider, DecisionStats, HabitsRecord, PlayerQuestion, TurnRecord, WorkBudget } from "@/app/(app)/training/model/decision";
import { DEFAULT_BUDGET } from "@/app/(app)/training/model/decision";
import type { InfoSettings, InfoView } from "@/app/(app)/training/model/info";
import { slotAt } from "@/app/(app)/training/model/positions";
import type { ObservedAction, TurnObservations } from "@/app/(app)/training/model/public-state";
import { createRandom, seedHex } from "@/app/(app)/training/model/random";
import { redactSheet, type SheetView } from "@/app/(app)/training/model/sheet";
import type { ShowdownRequest, SideID } from "@/app/(app)/training/model/showdown-types";
import type { TrainingUsageData } from "@/app/(app)/training/model/usage";
import { jointActionKey, megaSlots, type DecisionReport, type JointAction, type TrainingDifficulty, type TrainingTeam } from "@/app/(app)/training/model/view-types";
import { BattleHost, type HostDrain } from "@/app/(app)/training/sim/battle-host";
import { ChoiceBuildError, identName, isFainted, legalJointActions, teamChoice, toChoiceString, type MemberKeys } from "@/app/(app)/training/sim/choices";
import { aiInputs, createTestOracle } from "@/app/(app)/training/sim/inputs";
import { isMidTurn } from "@/app/(app)/training/sim/requests";
import { memberKeys, sheetFromSets, toShowdownTeam, validateTeams, hasProblems, type AdaptedTeam } from "@/app/(app)/training/sim/showdown-set";
import { FORMAT, TeamValidator } from "@/app/(app)/training/sim/sim";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { createTracker, type PublicTracker } from "@/app/(app)/training/sim/tracker";

export const TURN_CAP = 200;
export type Seat = { provider: DecisionProvider; difficulty: TrainingDifficulty };
export type DecisionKind = "preview" | "turn" | "switch";
export type DecisionRecord = {
  side: SideID; kind: DecisionKind; turn: number; requestId: number;
  /** Wall time of the provider call (belief update and builds included). */
  ms: number;
  choice: string;
  stats: DecisionStats | null;
  report: DecisionReport | null;
  /** The joint action the provider returned (engine orientation of its own seat). */
  action: JointAction | null;
  /** "retry": a rejected choice re-run after the request changed (a hidden trap or disable shown); "fallback": legal[0] / default. */
  recovery: null | { kind: "retry" | "fallback"; error: string; trapShown: boolean };
  /** Cells whose E2 call returned issues (an engine bug, SPEC 10.5), from the engine provider's lastTurn() trace. */
  engineIssues: number;
  /** Move ids the seat's active Pokémon could use at this request (not disabled, PP left): the A1.4 status-move gate's denominator. */
  available: string[];
};
export type MatchObserver = {
  /** Every decision's inputs, before the provider runs (leak and structural checks). */
  inputs?(side: SideID, kind: DecisionKind, inputs: AiInputs | null, host: BattleHost): void;
  /** After each drain: the host, both trackers and the drained channels (conformance oracles, leak histories). */
  drained?(host: BattleHost, trackers: Record<SideID, PublicTracker>, keys: MemberKeys, drain: HostDrain): void;
  /** Before a decision's inputs are built (leak tests change the real battle here: HP, dice). */
  before?(side: SideID, kind: DecisionKind, host: BattleHost, ordinal: number): void;
  /** Every ServicesFactory call a provider makes (the belief worlds it passes and the services built from them). */
  services?(side: SideID, inputs: AiInputs, worlds: readonly BeliefWorld[], services: TurnServices): void;
  /** Before a turn's choices are committed (conformance: clones, choice strings). */
  committing?(host: BattleHost, choices: Partial<Record<SideID, string>>): void;
};
export type MatchOptions = {
  seats: Record<SideID, Seat>;
  teams: Record<SideID, TrainingTeam>;
  info: InfoSettings;
  runtime: BattleRuntime;
  usage: TrainingUsageData;
  seedRun: string; index: number;
  budget?: WorkBudget;
  observer?: MatchObserver;
  /** Replay: play these choice strings (by order of commit per side) instead of the providers' (leak tests). */
  forced?: Record<SideID, string[]>;
  /** Battle seed override (SPEC 5.10 evaluation default: sodium,seedHex(run, index, "battle")). */
  seed?: string;
  /** Team preview orders to commit (1-based, leads first); the seat's provider still runs its preview (its belief starts there). */
  forcedPreview?: Partial<Record<SideID, number[]>>;
  /** Stop the battle after this decision (Mega positions). */
  stop?: (record: DecisionRecord) => boolean;
};
export type MatchResult = {
  index: number; seed: string;
  winner: SideID | "tie" | null; turns: number; ended: boolean; capped: boolean; forfeited: SideID | null;
  decisions: DecisionRecord[];
  errors: { side: SideID | null; stage: string; message: string }[];
  choiceLogHash: string;
  inputLog: string[];
  habits: Record<SideID, HabitsRecord>;
  choices: Record<SideID, string[]>;
};

/** Which view of the other side each seat has (SPEC §14.2: p2 = the AI with aiKnows, p1 with youSee). */
export const infoFor = (info: InfoSettings, side: SideID): InfoView => side === "p2" ? info.aiKnows : info.youSee;
const other = (side: SideID): SideID => side === "p1" ? "p2" : "p1";

/** TurnRecord.observed / observedMega from the seat's tracker record of the turn (never a choice string; SPEC I8). */
export function observedBySlot(record: TurnObservations | undefined, perspective: SideID): { observed: Partial<Record<DoublesSlotId, ObservedAction>>; observedMega: DoublesSlotId | null } {
  const observed: Partial<Record<DoublesSlotId, ObservedAction>> = {};
  let observedMega: DoublesSlotId | null = null;
  if (!record) return { observed, observedMega };
  const foe = other(perspective);
  for (const entry of record.actions) {
    const slot = slotAt(foe, entry.position, perspective);
    observed[slot] = entry.action;
    if (record.reveals.some((reveal) => reveal.kind === "mega" && reveal.key === entry.key)) observedMega = slot;
  }
  return { observed, observedMega };
}

/** Move ids the request's active Pokémon can use (not disabled, PP left). */
function availableMoves(request: ShowdownRequest): string[] {
  if (!("active" in request)) return [];
  return [...new Set(request.active.flatMap((active, position) => active && !isFainted(request.side.pokemon[position])
    ? active.moves.filter((move) => !move.disabled && move.pp !== 0).map((move) => move.id) : []))];
}

/** Engine slots flagged by a forceSwitch request, in the seat's own orientation. */
function flaggedSlots(side: SideID, request: ShowdownRequest): DoublesSlotId[] {
  if (!("forceSwitch" in request)) return [];
  return request.forceSwitch.flatMap((flag, position) => flag ? [slotAt(side, position, side)] : []);
}

/** The first legal joint action of the seat's real request, else Showdown's "default". */
function fallbackChoice(side: SideID, request: ShowdownRequest, keys: MemberKeys, tracker: PublicTracker): string {
  try {
    if ("teamPreview" in request) return teamChoice([1, 2, 3, 4]);
    const state = tracker.state();
    const bench = request.side.pokemon.filter((pokemon) => !pokemon.active && !isFainted(pokemon)).map((pokemon) => keys.keyOf(side, identName(pokemon.ident)));
    const firstTurn = request.side.pokemon.slice(0, 2).map((pokemon) => (state.mons[`${side}:${keys.keyOf(side, identName(pokemon.ident))}`]?.actions ?? 0) === 0);
    const legal = legalJointActions({ side, aiSide: side, request, bench, firstTurn, megaUsed: state.sides[side].megaUsed, keys });
    if (legal[0]) return toChoiceString(side, legal[0], request, keys, side);
  } catch { /* "default" below */ }
  return "default";
}

export async function runMatch(options: MatchOptions): Promise<MatchResult> {
  const { seats, teams, info, runtime, usage, seedRun, index, observer } = options;
  const budget = options.budget ?? DEFAULT_BUDGET;
  const seed = options.seed ?? `sodium,${seedHex(seedRun, index, "battle")}`;
  const errors: MatchResult["errors"] = [];
  const decisions: DecisionRecord[] = [];
  const choices: Record<SideID, string[]> = { p1: [], p2: [] };
  const forcedAt: Record<SideID, number> = { p1: 0, p2: 0 };

  const adapted: Record<SideID, AdaptedTeam> = { p1: toShowdownTeam(teams.p1.members, runtime), p2: toShowdownTeam(teams.p2.members, runtime) };
  const problems = validateTeams(adapted.p1, adapted.p2, new TeamValidator(FORMAT));
  if (hasProblems(problems.own) || hasProblems(problems.opponent)) {
    const text = JSON.stringify(problems);
    return { index, seed, winner: null, turns: 0, ended: false, capped: false, forfeited: null, decisions, errors: [{ side: null, stage: "validate", message: text }],
      choiceLogHash: "", inputLog: [], habits: { p1: seats.p1.provider.habits(), p2: seats.p2.provider.habits() }, choices };
  }
  const keys = memberKeys(adapted.p1, adapted.p2);
  const host = new BattleHost({
    formatid: FORMAT, seed: seed as `sodium,${string}`,
    p1: { name: "You", team: adapted.p1.sets.map((entry) => entry.set) },
    p2: { name: "Training", team: adapted.p2.sets.map((entry) => entry.set) },
  });
  const trackers: Record<SideID, PublicTracker> = {
    p1: createTracker("p1", (side, name) => keys.keyOf(side, name)),
    p2: createTracker("p2", (side, name) => keys.keyOf(side, name)),
  };
  // What each seat knows of the other side's team at team preview (SPEC 7.2 start step 4).
  const sheets: Record<SideID, SheetView> = {
    p1: redactSheet(sheetFromSets(adapted.p2), infoFor(info, "p1")),
    p2: redactSheet(sheetFromSets(adapted.p1), infoFor(info, "p2")),
  };
  const aiBase: Record<SideID, string> = { p1: seedHex(seedRun, index, "ai", "p1"), p2: seedHex(seedRun, index, "ai", "p2") };
  const pending: Record<SideID, { turn: number; question: Extract<PlayerQuestion, { kind: "turn" }>; action: JointAction } | null> = { p1: null, p2: null };
  let lastTurn = 0;
  const forfeited: SideID | null = null;
  let stopped = false;
  const ordinal: Record<SideID, number> = { p1: 0, p2: 0 };
  /** Each seat's view of the other side's leads (its actives when turn 1 starts). */
  const leads: Record<SideID, [string, string] | null> = { p1: null, p2: null };

  const decide = async (side: SideID, requestId: number, retry: boolean): Promise<{ choice: string; record: DecisionRecord }> => {
    const request = host.request(side)!;
    const seat = seats[side];
    const view = infoFor(info, side);
    const kind: DecisionKind = "teamPreview" in request ? "preview" : "forceSwitch" in request ? "switch" : "turn";
    observer?.before?.(side, kind, host, ordinal[side]++);
    const testOracle = view.exactHP || view.brought ? createTestOracle(host.battle, side, view, keys) : null;
    const inputs = kind === "preview" ? null : aiInputs({ side, requestId, request, own: adapted[side], sheet: sheets[side], tracker: trackers[side], info: view, oracle: testOracle });
    observer?.inputs?.(side, kind, inputs, host);
    const seedBase = seedHex(aiBase[side], requestId);
    const decideOptions: DecideOptions = {
      difficulty: seat.difficulty, budget, deadlineMs: null,
      random: createRandom(aiBase[side], requestId, retry ? "ai-retry" : "ai"), seedBase,
      signal: new AbortController().signal, yieldNow: async () => {}, now: () => performance.now(),
    };
    const turn = trackers[side].state().turn;
    const record: DecisionRecord = { side, kind, turn, requestId, ms: 0, choice: "", stats: null, report: null, action: null, recovery: null, engineIssues: 0, available: availableMoves(request) };
    const started = performance.now();
    if (kind === "preview") {
      const decision = await seat.provider.teamPreview({ runtime, ai: teams[side], sheet: sheets[side], info: view, usage }, decideOptions);
      record.ms = performance.now() - started;
      record.report = decision.report;
      record.choice = teamChoice(options.forcedPreview?.[side] ?? decision.order);
      return { choice: record.choice, record };
    }
    const services = (worlds: readonly BeliefWorld[]) => {
      // A mid-turn replacement's services know it (sim/services.ts ServicesContext.midTurn).
      const built = createTurnServices(inputs!, worlds, { runtime, keys, seedBase, midTurn: kind === "switch" && isMidTurn(host.battle) });
      observer?.services?.(side, inputs!, worlds, built);
      return built;
    };
    if (kind === "switch") {
      const decision = await seat.provider.chooseReplacements({ runtime, inputs: inputs!, services, slots: flaggedSlots(side, request), midTurn: isMidTurn(host.battle), usage }, decideOptions);
      record.ms = performance.now() - started;
      record.action = decision.action;
    } else {
      const decision = await seat.provider.chooseTurn({ runtime, inputs: inputs!, services, usage }, decideOptions);
      record.ms = performance.now() - started;
      record.action = decision.action;
      record.stats = decision.stats;
      record.report = decision.report;
      pending[side] = { turn, question: decision.question, action: decision.action };
      const trace = (seat.provider as { lastTurn?(): { cells: ({ notes: string[] } | null)[][] } | null }).lastTurn?.();
      record.engineIssues = trace ? trace.cells.flat().filter((cell) => cell?.notes.some((note) => /engine reported issues/i.test(note))).length : 0;
    }
    record.choice = toChoiceString(side, record.action!, request, keys, side);
    return { choice: record.choice, record };
  };

  /** One seat's decision for the current request, committed with the SPEC 7.2 step 6.5 recovery. */
  const play = async (side: SideID): Promise<string | null> => {
    const requestId = host.requestId;
    const forced = options.forced?.[side];
    if (forced) {
      const choice = forced[forcedAt[side]++] ?? "default";
      // Replays still run the provider on this seat's own inputs (leak tests compare its decisions).
      try { decisions.push((await decide(side, requestId, false)).record); } catch (error) { errors.push({ side, stage: "provider", message: (error as Error).message }); }
      return choice;
    }
    let made: { choice: string; record: DecisionRecord } | null = null;
    try {
      made = await decide(side, requestId, false);
    } catch (error) {
      const message = error instanceof ChoiceBuildError ? `choice: ${error.message}` : (error as Error).stack ?? String(error);
      errors.push({ side, stage: "provider", message });
      const request = host.request(side)!;
      const choice = fallbackChoice(side, request, keys, trackers[side]);
      const kind: DecisionKind = "teamPreview" in request ? "preview" : "forceSwitch" in request ? "switch" : "turn";
      decisions.push({ side, kind, turn: trackers[side].state().turn, requestId, ms: 0, choice, stats: null, report: null, action: null, recovery: { kind: "fallback", error: message, trapShown: false }, engineIssues: 0, available: availableMoves(request) });
      return choice;
    }
    decisions.push(made.record);
    if (options.stop?.(made.record)) stopped = true;
    return made.choice;
  };

  const commit = async (side: SideID, choice: string): Promise<void> => {
    choices[side].push(choice);
    let result = host.choose(side, choice);
    if (result.ok) return;
    const last = decisions.filter((entry) => entry.side === side).at(-1);
    if (result.requestChanged && !options.forced) {
      // A hidden trap or disable was shown to this seat: one re-run with fresh inputs (SPEC 7.2 step 6.5).
      try {
        const retry = await decide(side, host.requestId, true);
        retry.record.recovery = { kind: "retry", error: result.error, trapShown: true };
        decisions.push(retry.record);
        result = host.choose(side, retry.choice);
        choices[side].push(retry.choice);
        if (result.ok) return;
      } catch (error) {
        errors.push({ side, stage: "retry", message: (error as Error).message });
      }
    }
    const fallback = fallbackChoice(side, host.request(side)!, keys, trackers[side]);
    if (last) last.recovery = { kind: "fallback", error: result.ok ? "" : result.error, trapShown: !result.ok && result.requestChanged };
    let final = host.choose(side, fallback);
    if (!final.ok) final = host.choose(side, "default");
    choices[side].push(fallback);
    if (!final.ok) errors.push({ side, stage: "commit", message: `${choice} → ${final.error}` });
  };

  for (let step = 0; step < 5000; step++) {
    const drain = host.drain();
    trackers.p1.push(drain.channel.p1);
    trackers.p2.push(drain.channel.p2);
    observer?.drained?.(host, trackers, keys, drain);
    for (const side of ["p1", "p2"] as const) {
      const state = trackers[side].state();
      if (leads[side] || state.turn < 1) continue;
      const active = Object.values(state.mons).filter((mon) => mon.side === other(side) && mon.position !== null).sort((a, b) => a.position! - b.position!);
      if (active.length === 2) leads[side] = [active[0].key.slice(3), active[1].key.slice(3)];
    }
    if (drain.turn > lastTurn || drain.ended) {
      for (const side of ["p1", "p2"] as const) {
        const entry = pending[side];
        if (!entry || (entry.turn >= drain.turn && !drain.ended)) continue;
        const record = trackers[side].observations().find((each) => each.turn === entry.turn);
        const seen = observedBySlot(record, side);
        const turnRecord: TurnRecord = { turn: entry.turn, question: entry.question, observed: seen.observed, observedMega: seen.observedMega, opponent: entry.action };
        try { seats[side].provider.observeTurn(turnRecord); } catch (error) { errors.push({ side, stage: "observeTurn", message: (error as Error).message }); }
        pending[side] = null;
      }
      lastTurn = drain.turn;
    }
    if (drain.ended) break;
    if (drain.turn >= TURN_CAP) {
      // SPEC §14.2 legality gate: every battle ends before turn 200; a capped battle is recorded as such and tied.
      host.battle.tie();
      host.drain();
      break;
    }
    const need = (["p2", "p1"] as const).filter((side) => host.needsChoice(side));
    if (!need.length) { errors.push({ side: null, stage: "loop", message: `no side to choose at turn ${drain.turn}` }); break; }
    const made: Partial<Record<SideID, string>> = {};
    // Both seats decide from inputs built before either commits (G1: no seat sees the other's pending choice).
    for (const side of need) { const choice = await play(side); if (choice !== null) made[side] = choice; }
    if (stopped) break;
    observer?.committing?.(host, made);
    for (const side of need) if (made[side] !== undefined) await commit(side, made[side]!);
  }

  const battle = host.battle;
  for (const side of ["p1", "p2"] as const) {
    const state = trackers[side].state();
    const own = side;
    const revealed = Object.values(state.mons).filter((mon) => mon.side === other(own) && mon.switchIns > 0).map((mon) => mon.key.slice(3));
    try { seats[side].provider.observeBattle({ leads: leads[side], revealed }); }
    catch (error) { errors.push({ side, stage: "observeBattle", message: (error as Error).message }); }
  }
  const winnerName = battle.winner;
  const winner: MatchResult["winner"] = !battle.ended ? null : winnerName === "You" ? "p1" : winnerName === "Training" ? "p2" : "tie";
  const inputLog = [...host.inputLog()];
  return {
    index, seed, winner, turns: battle.turn, ended: battle.ended, capped: battle.turn >= TURN_CAP, forfeited,
    decisions, errors,
    choiceLogHash: createHash("sha256").update(inputLog.join("\n")).digest("hex"),
    inputLog,
    habits: { p1: seats.p1.provider.habits(), p2: seats.p2.provider.habits() },
    choices,
  };
}

/** A battle's score for `side`: 1 win, ½ tie (and an unfinished battle), 0 loss. */
export const scoreOf = (result: MatchResult, side: SideID) => result.winner === side ? 1 : result.winner === other(side) ? 0 : 0.5;
export const actionKey = (action: JointAction | null) => action ? jointActionKey(action) : "";
export const megaIn = (action: JointAction | null) => action ? megaSlots(action) : [];
export { DOUBLES_SLOTS };
