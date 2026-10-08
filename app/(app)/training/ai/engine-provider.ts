// SPEC 10.8 the engine provider: the worker's only production DecisionProvider (SPEC 11). Each turn: the belief observes the
// AI's own inputs, builds belief worlds, the services build belief battles from them, and the AI scores its options
// against the player's with the 2v2 engine (rollouts where it cannot), solves the simultaneous turn, predicts the player
// from good play plus habits, and plays a purified mixed strategy. Addendum A1.4: status moves are candidates and usage
// weights their priors; A1.5: Mega Evolution is decided every turn (Mega and non-Mega rows in one matrix, the prelude's
// types, ability and Speed this turn, plus the lasting and option values), and the read states the Mega fact.
import { DOUBLES_SLOTS, slotSide, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { AiInputs } from "../model/ai-inputs";
import type { AiView, MonKey } from "../model/ai-view";
import type {
  CellMethod, DecideOptions, DecisionProvider, DecisionStats, HabitsRecord, MegaPolicy, MegaStats, PlayerModel, PlayerPrediction,
  PlayerQuestion, TieBreaker, TurnDecision,
} from "../model/decision";
import { DEFAULT_MEGA_POLICY } from "../model/decision";
import type { InfoView } from "../model/info";
import type { SheetView } from "../model/sheet";
import type { TrainingUsageData } from "../model/usage";
import { megaSlots, type DecisionOption, type DecisionReport, type JointAction } from "../model/view-types";
import { splitPublicKey } from "./battle-facts";
import { createBeliefModel } from "./belief/model";
import type { BeliefModel } from "./belief/types";
import { aiCandidates, playerCandidates, type Candidate, type Limits } from "./candidates";
import { classifySlotAction } from "./classify";
import { createCellEvaluator, type CellValue } from "./evaluate";
import { createHabitModel, type HabitContext, type HabitModel } from "./habits";
import { questionSummary } from "./jev";
import { megaOutlook } from "./mega";
import { teamPreview } from "./preview";
import { megaFacts, readFacts } from "./reveal";
import { damageRows, worthOf, type RowTable } from "./rows";
import { purify, robustResponse, rowPayoffs, sample, solveZeroSum, undominated, type Solution } from "./solve";
import { chooseReplacements, replacePolicy } from "./switches";
import { valueWeights, type Weights } from "./value";

export type EngineProviderOptions = {
  runtime: BattleRuntime;
  habits: HabitsRecord | null;
  /** More player models beside the habit model (Jev later, SPEC 11); combined by their predictions' weights. */
  playerModels?: PlayerModel[];
  tieBreaker?: TieBreaker;
  weights?: Partial<Weights>;
  /** A1.5: "per-turn" (default) or "first-chance" (the SPEC Q2 rule, for the A1.5 gate's baseline). */
  megaPolicy?: MegaPolicy;
  limits?: Partial<Limits>;
};
export type EngineProvider = DecisionProvider & {
  /** The last turn decision's matrix and cells, for tests and evaluation scripts. */
  lastTurn(): TurnTrace | null;
};
export type TurnTrace = {
  view: AiView; ai: Candidate[]; player: Candidate[];
  /** Kept rows and columns (indices into ai / player) and their values. */
  rows: number[]; columns: number[]; matrix: number[][]; cells: (CellValue | null)[][];
  solution: Solution; q: number[]; x: number[];
  /** Milliseconds by phase: belief, services (builds and view), rows + worth + Mega outlook, candidates, E2, value, bridge/prelude, rollouts, and the rest (posts, solves, report). */
  timing: Record<"belief" | "services" | "rows" | "candidates" | "e2" | "value" | "bridge" | "rollout" | "rest", number>;
  /** E2 calls spent on accuracy corrections. */
  corrections: number;
  /** The reasons of cells without a value, by "row,column" (indices into ai / player). */
  dropped: Record<string, readonly string[]>;
};

/** Support threshold of stage B (SPEC 10.8: x*ₐ ≥ 0.05, y*ᵦ ≥ 0.05). */
export const SUPPORT = 0.05;
/** Cells between worker yields in stage A (SPEC 10.8). */
export const YIELD_EVERY = 4;
/** Reads you: λ = LAMBDA_MAX·n/(n + LAMBDA_HALF), n = the habits' (decayed) turns (SPEC 10.7). */
export const LAMBDA_MAX = 0.75, LAMBDA_HALF = 8;
/** SPEC 10.4's 10 × 6 matrix: stage B's rollout budget is scaled down for larger ones (A1.5's 14 Mega options). */
export const BASE_CELLS = 10 * 6;
/**
 * Stage B stops once the decision's work (ai/evaluate.ts work(): E2 calls, rollout samples and preludes in E2-call units)
 * reaches this: A1.5 keeps the decision time (SPEC 15) by trimming rollouts first.
 */
export const STAGE_B_WORK = 420;
/** A TieBreaker is asked when the top two purified options differ by less than this share of the matrix spread (SPEC 11). */
export const TIE_SHARE = 0.02;

function abortError(): Error {
  const error = new Error("The decision was stopped.");
  error.name = "AbortError";
  return error;
}
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw abortError(); };

/** Display names for the read: the species shown; "your" / "its" when both sides show the same species. */
export function readNames(view: AiView, runtime: BattleRuntime): (key: MonKey) => string {
  const nameOf = (speciesId: string) => runtime.speciesById.get(speciesId)?.name ?? speciesId;
  return (key) => {
    const mon = view.mons.find((each) => each.key === key);
    if (!mon) return key.slice(key.indexOf(":") + 1);
    const name = nameOf(mon.build.speciesId);
    const mirrored = view.mons.some((other) => other.side !== mon.side && nameOf(other.build.speciesId) === name);
    return mirrored ? `${mon.side === "own" ? "your" : "its"} ${name}` : name;
  };
}

const emptyMethods = (): Record<CellMethod, number> => ({ engine: 0, prelude: 0, rollout: 0, dropped: 0 });
const options = (list: readonly Candidate[], chances: readonly number[], indices: readonly number[]): DecisionOption[] =>
  indices.map((index, k) => ({ action: list[index].action, chance: chances[k] })).filter((option) => option.chance > 0)
    .map((option, order) => ({ option, order })).sort((a, b) => b.option.chance - a.option.chance || a.order - b.order).map(({ option }) => option);

export function createEngineProvider(config: EngineProviderOptions): EngineProvider {
  const { runtime } = config;
  const weights = valueWeights(config.weights);
  const megaPolicy = config.megaPolicy ?? DEFAULT_MEGA_POLICY;
  const habit: HabitModel = createHabitModel(config.habits);
  const extra = config.playerModels ?? [];
  let belief: BeliefModel | null = null;
  let sheet: SheetView | null = null;
  let perspective: "p1" | "p2" = "p2";
  const decisions = new Map<number, { view: AiView; rows: RowTable; worth: Record<MonKey, number> }>();
  let trace: TurnTrace | null = null;

  const ensureBelief = (inputs: AiInputs, usage: TrainingUsageData | null) => {
    if (!belief) {
      belief = createBeliefModel(inputs.info, { usage });
      belief.start(inputs.sheet, runtime);
      sheet = inputs.sheet;
    }
    perspective = inputs.perspective;
    return belief;
  };
  const startBelief = (info: InfoView, view: SheetView, usage: TrainingUsageData | null) => {
    belief = createBeliefModel(info, { usage });
    belief.start(view, runtime);
    sheet = view;
    return belief;
  };

  /** Every player model's prediction over the question's options; the provider id from whether Jev answered. */
  async function predict(question: Extract<PlayerQuestion, { kind: "turn" }>, signal: AbortSignal): Promise<{ prediction: PlayerPrediction | null; provider: DecisionReport["provider"] }> {
    const models: PlayerModel[] = [habit, ...extra];
    const answers = await Promise.all(models.map((model) => model.predict(question, signal).catch(() => null)));
    const valid = answers.map((answer, i) => ({ answer, model: models[i] })).filter((entry): entry is { answer: PlayerPrediction; model: PlayerModel } => !!entry.answer && entry.answer.weight > 0);
    const hasJev = models.some((model) => model.id === "jev");
    const provider = !hasJev ? "engine" : valid.some((entry) => entry.model.id === "jev") ? "jev" : "engine-fallback";
    if (!valid.length) return { prediction: null, provider };
    const total = valid.reduce((sum, entry) => sum + entry.answer.weight, 0);
    const probabilities = Object.fromEntries(question.options.map((option) => [option.id, valid.reduce((sum, entry) => sum + entry.answer.weight * (entry.answer.probabilities[option.id] ?? 0), 0) / total]));
    return { prediction: { probabilities, weight: total }, provider };
  }

  /**
   * chooseTurn up to its question: the belief observes the turn's inputs, the view, rows and worth are kept for observeTurn,
   * and your candidates make the question. Everything chooseTurn changes in the provider happens here (Resume replays it).
   */
  function prepareTurn(ctx: Parameters<DecisionProvider["chooseTurn"]>[0], o: DecideOptions) {
    const model = ensureBelief(ctx.inputs, ctx.usage);
    const beliefStart = o.now();
    model.observe(ctx.inputs, runtime);
    const beliefMs = o.now() - beliefStart;
    const worlds = model.worlds(o.budget.worlds, ctx.inputs, o.random, o.seedBase);
    const servicesStart = o.now();
    const services = ctx.services(worlds);
    const view = services.view;
    const rowsStart = o.now();
    const rows = damageRows(view, runtime);
    const worth = worthOf(view, rows, runtime, weights);
    const mega = megaOutlook(view, rows, runtime, weights);
    const candidatesStart = o.now();
    decisions.set(view.turn, { view, rows, worth });
    for (const turn of [...decisions.keys()]) if (turn < view.turn - 2) decisions.delete(turn);
    const candidateOptions = { usage: ctx.usage, mega, megaPolicy, weights: config.weights, limits: config.limits };
    // The habit model's per-slot chances reserve its favourites before pruning (SPEC 10.4 "+ the habit model's top option").
    const slotsOnly = playerCandidates(view, rows, worth, null, runtime, candidateOptions).slots;
    const player = playerCandidates(view, rows, worth, { probabilities: habit.slotPrediction(slotsOnly), weight: 1 }, runtime, candidateOptions);
    const question: Extract<PlayerQuestion, { kind: "turn" }> = {
      kind: "turn", turn: view.turn, options: player.kept.map((candidate) => ({ id: candidate.id, action: candidate.action, label: candidate.label })),
      slots: player.slots, summary: questionSummary(view, runtime),
    };
    return { model, beliefMs, services, view, rows, worth, mega, candidateOptions, player, question, servicesStart, rowsStart, candidatesStart };
  }

  async function chooseTurn(ctx: Parameters<DecisionProvider["chooseTurn"]>[0], o: DecideOptions): Promise<TurnDecision> {
    const started = o.now();
    checkAbort(o.signal);
    const { model, beliefMs, services, view, rows, worth, mega, candidateOptions, player, question, servicesStart, rowsStart, candidatesStart } = prepareTurn(ctx, o);
    const ai = aiCandidates(view, rows, worth, runtime, candidateOptions);
    // Player models answer while stage A runs (a remote model's latency overlaps the evaluation).
    const predicted = predict(question, o.signal);
    const evaluateStart = o.now();

    const evaluator = createCellEvaluator({ services, runtime, weights, worth, rows, replace: replacePolicy(view, rows, worth, runtime), budget: o.budget, mega, now: o.now });
    const cells: (CellValue | null)[][] = ai.map(() => player.kept.map(() => null));
    const evaluated: number[] = [];
    const byMethod = emptyMethods();
    let valveFired = false, count = 0;
    // Stage A: the AI's options in prior order, each row's cells in the player's prior order.
    for (let a = 0; a < ai.length; a++) {
      if (!evaluator.canEvaluate()) break;
      for (let b = 0; b < player.kept.length; b++) {
        // The accuracy correction spends only engine calls beyond one per cell still to come; a rollout cell takes two
        // samples only while one stays free for every cell still to come (any of them may need a rollout: on a 14 × 12
        // matrix of preludes and rollouts the share seen so far left 2 cells without a sample, gates run integrate-gates).
        const reserve = (ai.length - a - 1) * player.kept.length + (player.kept.length - b - 1);
        const rolloutsAhead = reserve;
        const value = evaluator.evaluate({ own: player.kept[b].action, opponent: ai[a].action }, "A", reserve, rolloutsAhead);
        cells[a][b] = value;
        byMethod[value?.method ?? "dropped"]++;
        if (++count % YIELD_EVERY === 0) { await o.yieldNow(); checkAbort(o.signal); }
      }
      evaluated.push(a);
      if (o.deadlineMs !== null && o.now() - started > o.deadlineMs && evaluated.length >= 2 && a < ai.length - 1) { valveFired = true; break; }
    }
    // Belief world 0 rejects a choice string for every pairing of one side's option (a skip runs along a whole row or
    // column: a switch out of a trap the battle shows, such as Mega Gengar's Shadow Tag): those options cannot be played and
    // leave the matrix uncounted. Then rows with any other missing cell are dropped (SPEC 10.8).
    const skipped = (a: number, b: number) => evaluator.skipped({ own: player.kept[b].action, opponent: ai[a].action });
    const rowsOut = new Set(evaluated.filter((a) => player.kept.every((_, b) => skipped(a, b))));
    const liveRows = evaluated.filter((a) => !rowsOut.has(a));
    const colsOut = new Set(player.kept.map((_, b) => b).filter((b) => liveRows.length > 0 && liveRows.every((a) => skipped(a, b))));
    for (const a of evaluated) for (let b = 0; b < player.kept.length; b++) if (!cells[a][b] && (rowsOut.has(a) || colsOut.has(b))) byMethod.dropped--;
    const columns = player.kept.map((_, b) => b).filter((b) => !colsOut.has(b) && liveRows.some((a) => cells[a][b] !== null));
    const kept = liveRows.filter((a) => columns.every((b) => cells[a][b] !== null));
    const { prediction, provider } = await predicted;
    checkAbort(o.signal);
    if (!kept.length || !columns.length) {
      // No complete row: the AI's heaviest option world 0 accepts (else the heaviest, else the request's first legal action).
      const action = ai[liveRows[0] ?? 0]?.action ?? view.legal.opponent[0] ?? {};
      return fallbackDecision(view, action, question, { byMethod, beliefMs, started, o, ai, player: player.kept, services, evaluator, valveFired, provider });
    }
    const M = kept.map((a) => columns.map((b) => cells[a][b]!.value));
    let solution = solveZeroSum(M);
    // Stage B: rollout cells in the solved support, x*ₐ·y*ᵦ order, topped up to stageBSamples.
    const support: { i: number; j: number; w: number }[] = [];
    kept.forEach((a, i) => columns.forEach((b, j) => {
      if (solution.x[i] >= SUPPORT && solution.y[j] >= SUPPORT && cells[a][b]!.method === "rollout") support.push({ i, j, w: solution.x[i] * solution.y[j] });
    }));
    support.sort((p, q) => q.w - p.w || p.i - q.i || p.j - q.j);
    let changed = false;
    // A1.5 "keep the decision budget by trimming rollouts first": stage B's rollouts shrink with the matrix beyond 10 × 6.
    const stageBLimit = Math.round(o.budget.rolloutSamples * Math.min(1, BASE_CELLS / Math.max(1, ai.length * player.kept.length)));
    for (const { i, j } of support) {
      if (evaluator.used.rolloutSamples >= stageBLimit || evaluator.work() >= STAGE_B_WORK) break;
      // The browser's wall valve (SPEC C5) covers stage B too: its top-ups stop once the decision passes it.
      if (o.deadlineMs !== null && o.now() - started > o.deadlineMs) { valveFired = true; break; }
      const a = kept[i], b = columns[j];
      const value = evaluator.evaluate({ own: player.kept[b].action, opponent: ai[a].action }, "B");
      if (value) { cells[a][b] = value; M[i][j] = value.value; changed = true; }
      await o.yieldNow();
      checkAbort(o.signal);
    }
    if (changed) solution = solveZeroSum(M);

    // q per difficulty (SPEC 10.7): Plays safe reads y*; Reads you blends the player models in with λ.
    const h = prediction ? normalised(columns.map((b) => prediction.probabilities[player.kept[b].id] ?? 0)) : null;
    const n = habit.record().turns;
    const lambda = LAMBDA_MAX * n / (n + LAMBDA_HALF);
    const q = o.difficulty === "reads" && h ? solution.y.map((y, j) => (1 - lambda) * y + lambda * h[j]) : [...solution.y];
    let x = o.difficulty === "reads" ? robustResponse(M, q, solution) : [...solution.x];
    // A row another kept row beats or ties against every column of yours gives its weight to that row (dominance is
    // transitive, so an undominated dominator always exists).
    x = purify(undominated(M, x));
    if (config.tieBreaker && o.deadlineMs !== null) {
      const payoff = rowPayoffs(M, q);
      const ranked = x.map((p, i) => ({ p, i })).filter((entry) => entry.p > 0).sort((p1, p2) => payoff[p2.i] - payoff[p1.i]);
      if (ranked.length > 1 && payoff[ranked[0].i] - payoff[ranked[1].i] < TIE_SHARE * solution.spread) {
        const pair = ranked.slice(0, 2).map((entry) => ai[kept[entry.i]]);
        const pick = await config.tieBreaker.pick({ options: pair.map((candidate) => ({ id: candidate.id, action: candidate.action, label: candidate.label })), summary: question.summary }, o.signal).catch(() => null);
        const index = pick ? kept.findIndex((a) => ai[a].id === pick) : -1;
        if (index >= 0) x = x.map((_, i) => i === index ? 1 : 0);
      }
    }
    const pickIndex = sample(x, o.random);
    const action = ai[kept[pickIndex]].action;

    const strategy = options(ai, x, kept);
    const predictedOptions = options(player.kept, q, columns);
    const names = readNames(view, runtime);
    const chosenCell = { own: predictedOptions[0]?.action ?? {}, opponent: action };
    const preludeField = (slot: DoublesSlotId) => {
      void slot;
      const worldsOf = evaluator.worldsOf(chosenCell);
      return worldsOf.kind === "engine" && worldsOf.source === "prelude" ? worldsOf.worlds[0].input.field : null;
    };
    const reasons = readFacts({ view, rows, q: predictedOptions, chosen: action, names, runtime });
    const megaList = megaFacts({ view, rows, q: predictedOptions, chosen: action, names, runtime, mega, preludeField });
    const firstMega = megaList[0] ?? null;
    const report: DecisionReport = {
      turn: view.turn, provider, difficulty: o.difficulty,
      predicted: predictedOptions.slice(0, 3),
      strategy, chosen: Math.max(0, strategy.findIndex((option) => option.action === action)),
      actual: null,
      reason: reasons[0]?.text ?? null,
      mega: firstMega ? { memberKey: firstMega.memberKey, evolved: firstMega.evolved, moves: firstMega.moves, text: firstMega.text } : null,
      facts: { reasons, mega: megaList },
      assumed: model.assumed(ctx.inputs, runtime),
      elapsedMs: 0,
      evaluated: { yours: columns.length, its: kept.length },
    };
    const megaStats = megaStatsOf(view, ai, kept, columns, cells, M, q, x, action);
    const stats: DecisionStats = {
      options: { its: ai.length, yours: player.kept.length },
      statusOptions: { its: ai.filter((candidate) => candidate.status).length, yours: player.kept.filter((candidate) => candidate.status).length },
      byMethod, engineCalls: evaluator.used.engineCalls, rolloutSamples: evaluator.used.rolloutSamples,
      preludes: services.spent.preludes, builds: services.spent.builds, beliefMs, elapsedMs: 0, valveFired,
      exploitability: solution.exploitability, approximations: [...services.approximations], mega: megaStats,
    };
    const evaluated_ = evaluator.timing;
    trace = {
      view, ai, player: player.kept, rows: kept, columns, matrix: M, cells, solution, q, x,
      timing: {
        belief: beliefMs, services: rowsStart - servicesStart, rows: candidatesStart - rowsStart, candidates: evaluateStart - candidatesStart,
        e2: evaluated_.e2, value: evaluated_.value, bridge: evaluated_.bridge, rollout: evaluated_.rollout,
        rest: Math.max(0, o.now() - evaluateStart - evaluated_.e2 - evaluated_.value - evaluated_.bridge - evaluated_.rollout),
      },
      corrections: evaluator.corrections,
      dropped: Object.fromEntries(evaluated.flatMap((a) => player.kept.flatMap((candidate, b) => cells[a][b] ? [] : [[`${a},${b}`, evaluator.notesOf({ own: candidate.action, opponent: ai[a].action })]]))),
    };
    const elapsedMs = o.now() - started;
    report.elapsedMs = stats.elapsedMs = elapsedMs;
    return { action, report, stats, question };
  }

  /** A1.5 MegaStats: eligible slots, the played Mega, the strategy's Mega share, and the best Mega row minus the best non-Mega row by term. */
  function megaStatsOf(view: AiView, ai: Candidate[], kept: number[], columns: number[], cells: (CellValue | null)[][], M: number[][], q: number[], x: number[], action: JointAction): MegaStats | null {
    const eligible = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === "opponent" && !view.megaUsed.opponent
      && view.mons.some((mon) => mon.slot === slot && mon.canMega && !mon.fainted && mon.hp > 0));
    if (!eligible.length) return null;
    const payoff = rowPayoffs(M, q);
    const termOf = (i: number, part: "lasting" | "keep") => columns.reduce((sum, b, j) => sum + q[j] * (cells[kept[i]][b]?.mega[part] ?? 0), 0);
    const best = (withMega: boolean) => kept.map((a, i) => ({ a, i })).filter(({ a }) => (ai[a].mega !== null) === withMega)
      .sort((p, r) => payoff[r.i] - payoff[p.i] || p.i - r.i)[0] ?? null;
    const top = best(true), plain = best(false);
    let terms = { thisTurn: 0, lasting: 0, keep: 0 };
    if (top && plain) {
      const lasting = termOf(top.i, "lasting") - termOf(plain.i, "lasting");
      const keep = termOf(top.i, "keep") - termOf(plain.i, "keep");
      terms = { thisTurn: payoff[top.i] - payoff[plain.i] - lasting - keep, lasting, keep };
    }
    return {
      eligible,
      chosen: megaSlots(action).find((slot) => slotSide(slot) === "opponent") ?? null,
      share: kept.reduce((sum, a, i) => sum + (ai[a].mega !== null ? x[i] : 0), 0),
      terms,
    };
  }

  function fallbackDecision(view: AiView, action: JointAction, question: Extract<PlayerQuestion, { kind: "turn" }>, parts: {
    byMethod: Record<CellMethod, number>; beliefMs: number; started: number; o: DecideOptions; ai: Candidate[]; player: Candidate[];
    services: { spent: { builds: number; preludes: number }; approximations: readonly string[] }; evaluator: { used: { engineCalls: number; rolloutSamples: number } };
    valveFired: boolean; provider: DecisionReport["provider"];
  }): TurnDecision {
    const elapsedMs = parts.o.now() - parts.started;
    const report: DecisionReport = {
      turn: view.turn, provider: parts.provider, difficulty: parts.o.difficulty, predicted: [], strategy: [{ action, chance: 1 }], chosen: 0, actual: null,
      reason: null, mega: null, assumed: [], elapsedMs, evaluated: { yours: 0, its: 0 },
    };
    const stats: DecisionStats = {
      options: { its: parts.ai.length, yours: parts.player.length },
      statusOptions: { its: parts.ai.filter((candidate) => candidate.status).length, yours: parts.player.filter((candidate) => candidate.status).length },
      byMethod: parts.byMethod, engineCalls: parts.evaluator.used.engineCalls, rolloutSamples: parts.evaluator.used.rolloutSamples,
      preludes: parts.services.spent.preludes, builds: parts.services.spent.builds, beliefMs: parts.beliefMs, elapsedMs, valveFired: parts.valveFired,
      exploitability: 0, approximations: [...parts.services.approximations], mega: null,
    };
    return { action, report, stats, question };
  }

  return {
    id: "engine",
    async teamPreview(ctx, o) {
      const started = o.now();
      checkAbort(o.signal);
      habit.startBattle();
      decisions.clear();
      const model = startBelief(ctx.info, ctx.sheet, ctx.usage);
      const snapshot = model.snapshot();
      const result = teamPreview({
        runtime, ai: ctx.ai, sheet: ctx.sheet, builds: model.mapBuilds(runtime),
        moves: Object.fromEntries(Object.entries(snapshot.members).map(([key, member]) => [key, member.moves])),
        habits: habit.data(), difficulty: o.difficulty, random: o.random,
      });
      model.setBring(result.bring);
      return { order: result.order, report: { ...result.report, elapsedMs: o.now() - started } };
    },
    chooseTurn,
    async replayTurn(ctx, o) {
      checkAbort(o.signal);
      return prepareTurn(ctx, o).question;
    },
    async chooseReplacements(ctx, o) {
      checkAbort(o.signal);
      const model = ensureBelief(ctx.inputs, ctx.usage);
      model.observe(ctx.inputs, runtime);
      const services = ctx.services(model.worlds(1, ctx.inputs, o.random, o.seedBase));
      const view = services.view;
      const rows = damageRows(view, runtime);
      const worth = worthOf(view, rows, runtime, weights);
      return { action: chooseReplacements(view, rows, worth, ctx.slots, runtime) };
    },
    observeTurn(record) {
      const decision = decisions.get(record.question.turn) ?? decisions.get(record.turn);
      const context: HabitContext = decision ? {
        targetSlot: (publicKey) => {
          const { side, member } = splitPublicKey(publicKey);
          const engineSide = side === perspective ? "opponent" : "own";
          return decision.view.mons.find((mon) => mon.key === `${engineSide}:${member}`)?.slot ?? null;
        },
        classify: (slot, action) => classifySlotAction(decision.view, decision.rows, slot, action, runtime, { worth: decision.worth }),
      } : {};
      habit.observeTurn(record, context);
      for (const model of extra) model.observeTurn(record);
    },
    observeBattle(record) {
      habit.observeBattle(record, { speciesOf: (key) => sheet?.members.find((member) => member.key === key)?.speciesId ?? null });
      for (const model of extra) model.observeBattle(record);
    },
    habits: () => habit.record(),
    lastTurn: () => trace,
  };
}

function normalised(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? values.map((value) => value / total) : values.map(() => 1 / Math.max(1, values.length));
}
