// SPEC 10.13 baselines: DecisionProviders on the same TurnContext as the engine provider, for the evaluation gates. They use
// the same belief model (world 0 only), so they also play without your Stat Points. Addendum A1.5: FirstChanceMega is the
// engine provider with the SPEC Q2 Mega rule, the per-turn Mega gate's comparison.
import { DOUBLES_SLOTS, foesOf, slotSide, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { AiInputs } from "../model/ai-inputs";
import type { AiView, MonKey, MonView } from "../model/ai-view";
import type { AIRandom, DecideOptions, DecisionProvider, DecisionStats, HabitsRecord, PlayerQuestion } from "../model/decision";
import type { TrainingUsageData } from "../model/usage";
import { megaSlots, type DecisionReport, type JointAction, type SlotAction } from "../model/view-types";
import { effectiveAccuracy } from "./accuracy";
import { isProtectMove } from "./battle-facts";
import { createBeliefModel } from "./belief/model";
import type { BeliefModel } from "./belief/types";
import { monInSlot } from "./classify";
import { createEngineProvider, type EngineProvider, type EngineProviderOptions } from "./engine-provider";
import { megaOutlook } from "./mega";
import { previewMatchups } from "./preview";
import { damageRows, SPREAD_TARGETS, worthOf, type RowTable } from "./rows";
import { chooseReplacements } from "./switches";

type BaselineOptions = { runtime: BattleRuntime };
const EMPTY_HABITS: HabitsRecord = { version: 1, turns: 0, data: null };

const emptyStats = (elapsedMs: number): DecisionStats => ({
  options: { its: 0, yours: 0 }, statusOptions: { its: 0, yours: 0 }, byMethod: { engine: 0, prelude: 0, rollout: 0, dropped: 0 },
  engineCalls: 0, rolloutSamples: 0, preludes: 0, builds: 0, beliefMs: 0, elapsedMs, valveFired: false, exploitability: 0, approximations: [], mega: null,
});
const report = (turn: number, o: DecideOptions, action: JointAction | null, elapsedMs: number): DecisionReport => ({
  turn, provider: "engine", difficulty: o.difficulty, predicted: [], strategy: action ? [{ action, chance: 1 }] : [], chosen: 0, actual: null,
  reason: null, mega: null, assumed: [], elapsedMs, evaluated: { yours: 0, its: action ? 1 : 0 },
});
const question = (turn: number): Extract<PlayerQuestion, { kind: "turn" }> => ({ kind: "turn", turn, options: [], slots: {} });

/** The shared belief plumbing: start at preview (or at the first decision), observe, world 0 only. */
function seatBelief(runtime: BattleRuntime) {
  let belief: BeliefModel | null = null;
  return {
    start(info: AiInputs["info"], sheet: AiInputs["sheet"], usage: TrainingUsageData | null) {
      belief = createBeliefModel(info, { usage });
      belief.start(sheet, runtime);
      return belief;
    },
    view(inputs: AiInputs, usage: TrainingUsageData | null, services: (worlds: ReturnType<BeliefModel["worlds"]>) => { view: AiView }, o: DecideOptions): AiView {
      if (!belief) { belief = createBeliefModel(inputs.info, { usage }); belief.start(inputs.sheet, runtime); }
      belief.observe(inputs, runtime);
      return services(belief.worlds(1, inputs, o.random, o.seedBase)).view;
    },
  };
}
function shuffled(n: number, random: AIRandom): number[] {
  const order = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = order.length - 1; i > 0; i--) { const j = random.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}

/** RandomLegal: uniform over the AI's legal joint actions; random team order and replacements. */
export function createRandomLegalProvider(options: BaselineOptions): DecisionProvider {
  const seat = seatBelief(options.runtime);
  return {
    id: "engine",
    async teamPreview(ctx, o) {
      seat.start(ctx.info, ctx.sheet, ctx.usage);
      return { order: shuffled(ctx.ai.members.length, o.random).slice(0, 4), report: report(0, o, null, 0) };
    },
    async chooseTurn(ctx, o) {
      const started = o.now();
      const view = seat.view(ctx.inputs, ctx.usage, ctx.services, o);
      const legal = view.legal.opponent;
      const action = legal[o.random.int(legal.length)] ?? {};
      return { action, report: report(view.turn, o, action, o.now() - started), stats: emptyStats(o.now() - started), question: question(view.turn) };
    },
    async chooseReplacements(ctx, o) {
      const view = seat.view(ctx.inputs, ctx.usage, ctx.services, o);
      const legal = view.legal.opponent;
      return { action: legal[o.random.int(legal.length)] ?? {} };
    },
    observeTurn() {},
    observeBattle() {},
    habits: () => EMPTY_HABITS,
  };
}

/** A slot action's damage score: Σ over the foes it reaches of fraction × accuracy (a spread move counts both). */
function damageScore(view: AiView, rows: RowTable, slot: DoublesSlotId, action: SlotAction, runtime: BattleRuntime): number | null {
  const mon = monInSlot(view, slot);
  if (!mon || action.kind !== "move") return null;
  const move = runtime.movesById.get(action.moveId);
  if (!move || move.category === "Status") return null;
  const foes = foesOf(slot).map((each) => monInSlot(view, each)).filter((each): each is MonView => !!each && each.hp > 0);
  const aimed = action.target ? monInSlot(view, action.target) : null;
  const targets = SPREAD_TARGETS.has(move.target) ? foes : move.target === "randomNormal" ? foes : aimed && aimed.side !== mon.side ? [aimed] : !action.target && foes.length === 1 ? foes : [];
  const share = move.target === "randomNormal" ? 1 / Math.max(1, foes.length) : 1;
  return targets.reduce((sum, foe) => sum + share * (rows.get(mon.key, foe.key, move.id)?.fraction ?? 0) * effectiveAccuracy(view, mon.key, move.id, foe.key, runtime), 0);
}
/** The SPEC Q2 Mega slot: the Mega form with the higher base stat total, then Showdown position 0 (opponent-right). */
function firstChanceSlot(view: AiView, rows: RowTable, runtime: BattleRuntime): DoublesSlotId | null {
  const outlook = megaOutlook(view, rows, runtime);
  const slots = (["opponent-right", "opponent-left"] as const).filter((slot) => { const mon = monInSlot(view, slot); return !!mon && !!outlook[mon.key] && mon.canMega; });
  const total = (slot: DoublesSlotId) => {
    const stats = runtime.speciesById.get(outlook[monInSlot(view, slot)!.key].formId)?.baseStats;
    return stats ? stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe : 0;
  };
  return [...slots].sort((a, b) => total(b) - total(a))[0] ?? null;
}

/**
 * MaxDamage (and HabitBot): every legal joint action scored per slot, the best played. MaxDamage: the move and target with
 * the highest fraction × accuracy (world-0 builds), Mega at first chance, never Protect or switch. HabitBot adds: Protect
 * below 50% HP when it did not Protect last turn; a choose-target move always into the foe in own-left; Fake Out on turn 1.
 */
function maxDamageAction(view: AiView, rows: RowTable, runtime: BattleRuntime, habitBot: boolean): JointAction {
  const legal = view.legal.opponent;
  if (!legal.length) return {};
  const megaSlot = firstChanceSlot(view, rows, runtime);
  const slotScore = (slot: DoublesSlotId, action: SlotAction | undefined): number => {
    if (!action || action.kind === "pass") return 0;
    if (action.kind === "switch") return -10;
    const mon = monInSlot(view, slot);
    if (!mon) return 0;
    if (habitBot) {
      const protectNow = mon.hp / Math.max(1, mon.maxHp) < 0.5 && !(mon.lastMove && isProtectMove(mon.lastMove));
      if (isProtectMove(action.moveId)) return protectNow ? 100 : -10;
      if (action.moveId === "fakeout" && view.turn === 1 && mon.firstTurn) return 50 + (action.target === "own-left" ? 1 : 0);
      const left = monInSlot(view, "own-left");
      const move = runtime.movesById.get(action.moveId);
      const chooses = move && ["normal", "any", "adjacentFoe"].includes(move.target);
      if (chooses && left && action.target !== "own-left") return -5;
    } else if (isProtectMove(action.moveId)) return -10;
    return damageScore(view, rows, slot, action, runtime) ?? -1;
  };
  let best = legal[0], top = -Infinity;
  for (const joint of legal) {
    const megas = megaSlots(joint);
    if (megas.length && megas[0] !== megaSlot) continue;
    const total = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === "opponent").reduce((sum, slot) => sum + slotScore(slot, joint[slot]), 0)
      + (megaSlot && megas[0] === megaSlot ? 1e-6 : 0);
    if (total > top + 1e-12) { best = joint; top = total; }
  }
  return best;
}

function createDamageProvider(options: BaselineOptions, habitBot: boolean): DecisionProvider {
  const { runtime } = options;
  const seat = seatBelief(runtime);
  return {
    id: "engine",
    async teamPreview(ctx, o) {
      const belief = seat.start(ctx.info, ctx.sheet, ctx.usage);
      const snapshot = belief.snapshot();
      const { offMine } = previewMatchups({
        runtime, ai: ctx.ai, sheet: ctx.sheet, builds: belief.mapBuilds(runtime),
        moves: Object.fromEntries(Object.entries(snapshot.members).map(([key, member]) => [key, member.moves])),
      });
      const mean = offMine.map((row) => row.reduce((sum, value) => sum + value, 0) / Math.max(1, row.length));
      const order = mean.map((value, i) => ({ value, i })).sort((a, b) => b.value - a.value || a.i - b.i).slice(0, 4).map((entry) => entry.i + 1);
      return { order, report: report(0, o, null, 0) };
    },
    async chooseTurn(ctx, o) {
      const started = o.now();
      const view = seat.view(ctx.inputs, ctx.usage, ctx.services, o);
      const rows = damageRows(view, runtime);
      const action = maxDamageAction(view, rows, runtime, habitBot);
      return { action, report: report(view.turn, o, action, o.now() - started), stats: emptyStats(o.now() - started), question: question(view.turn) };
    },
    async chooseReplacements(ctx, o) {
      const view = seat.view(ctx.inputs, ctx.usage, ctx.services, o);
      const rows = damageRows(view, runtime);
      const worth: Record<MonKey, number> = worthOf(view, rows, runtime);
      return { action: chooseReplacements(view, rows, worth, ctx.slots, runtime) };
    },
    observeTurn() {},
    observeBattle() {},
    habits: () => EMPTY_HABITS,
  };
}

/** MaxDamage (SPEC 10.13). */
export function createMaxDamageProvider(options: BaselineOptions): DecisionProvider {
  return createDamageProvider(options, false);
}
/** HabitBot (SPEC 10.13): MaxDamage with fixed habits Reads you can learn. */
export function createHabitBotProvider(options: BaselineOptions): DecisionProvider {
  return createDamageProvider(options, true);
}
/** A1.5 gate baseline: the engine provider with Mega Evolution at its first chance (SPEC Q2). */
export function createFirstChanceMegaProvider(options: EngineProviderOptions): EngineProvider {
  return createEngineProvider({ ...options, megaPolicy: "first-chance" });
}
