// SPEC 10.10 switching. Voluntary switches are ordinary matrix rows (through the prelude, so entry effects are exact).
// Forced and mid-turn replacements are scored from the start rows alone: S(c) = Σ_p [worth_p·fraction(c→p) −
// worth_c·fraction(p→c)] + 0.3·speedEdge(c), over the other side's living known actives (when that side replaces too: the
// average over its revealed living bench), every distinct assignment of the flagged slots, the best total, ties to sheet
// order. The same scoring is the rollout ReplacePolicy for the AI's own side.
import { turnSpeed } from "@/app/lib/battle/calculate";
import { DOUBLES_SLOTS, slotSide, type DoublesSideId, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { AiView, MonKey, MonView, ReplacePolicy } from "../model/ai-view";
import type { JointAction, SlotAction } from "../model/view-types";
import { effectiveAccuracy } from "./accuracy";
import { calcBuild, type RowTable } from "./rows";

/** The Speed edge's weight in S(c) (SPEC 10.10). */
export const SPEED_EDGE = 0.3;

const living = (mon: MonView) => !mon.fainted && mon.hp > 0;
const other = (side: DoublesSideId): DoublesSideId => side === "own" ? "opponent" : "own";

/**
 * The foes a replacement on `side` would face, each with its share of the score: the other side's living known actives
 * (share 1), and for each of its slots left empty (it replaces too) its revealed living bench members sharing 1.
 */
function facing(view: AiView, side: DoublesSideId): { mon: MonView; share: number }[] {
  const foeSide = other(side);
  const actives = view.mons.filter((mon) => mon.side === foeSide && mon.slot !== null && living(mon));
  const out = actives.map((mon) => ({ mon, share: 1 }));
  const slots = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === foeSide);
  const empty = slots.filter((slot) => !actives.some((mon) => mon.slot === slot)).length;
  const bench = view.mons.filter((mon) => mon.side === foeSide && mon.slot === null && living(mon) && mon.revealed);
  if (empty > 0 && bench.length) {
    const replacing = Math.min(empty, bench.length);
    for (const mon of bench) out.push({ mon, share: replacing / bench.length });
  }
  return out;
}

/** turnSpeed of a Pokémon on the field now (Tailwind of its side; Trick Room read by the caller). */
function speedNow(view: AiView, mon: MonView, runtime: BattleRuntime): number {
  const tailwind = mon.side === "own" ? view.field.attackerSide.tailwind : view.field.defenderSide.tailwind;
  return turnSpeed(calcBuild(mon), tailwind, { ...view.field, trickRoom: false }, runtime);
}

/** S(c) for `candidate` entering `slot` (SPEC 10.10). */
export function replacementScore(view: AiView, rows: RowTable, worth: Record<MonKey, number>, candidate: MonKey, slot: DoublesSlotId, runtime?: BattleRuntime): number {
  const mon = view.mons.find((each) => each.key === candidate);
  if (!mon || !living(mon)) return -Infinity;
  void slot;
  const foes = facing(view, mon.side);
  let score = 0, edge = 0, shares = 0;
  for (const { mon: foe, share } of foes) {
    const out = rows.best(mon.key, foe.key);
    const into = rows.best(foe.key, mon.key);
    const acc = (attacker: MonKey, moveId: string, target: MonKey) => runtime ? effectiveAccuracy(view, attacker, moveId, target, runtime) : 1;
    const dealt = out ? out.fraction * acc(mon.key, out.moveId, foe.key) : 0;
    const taken = into ? into.fraction * acc(foe.key, into.moveId, mon.key) : 0;
    score += share * ((worth[foe.key] ?? 1) * dealt - (worth[mon.key] ?? 1) * taken);
    if (runtime) {
      const sign = Math.sign(speedNow(view, mon, runtime) - speedNow(view, foe, runtime)) * (view.field.trickRoom ? -1 : 1);
      edge += share * sign;
    }
    shares += share;
  }
  return score + SPEED_EDGE * (shares > 0 ? edge / shares : 0);
}

/** Every distinct assignment of `options` to `slots` (a slot may stay empty only when the options run out). */
function assignments(slots: readonly DoublesSlotId[], options: readonly MonKey[]): (MonKey | null)[][] {
  const need = Math.min(slots.length, options.length);
  const out: (MonKey | null)[][] = [];
  const walk = (index: number, chosen: (MonKey | null)[]) => {
    if (index === slots.length) {
      if (chosen.filter(Boolean).length === need) out.push(chosen);
      return;
    }
    for (const key of options) if (!chosen.includes(key)) walk(index + 1, [...chosen, key]);
    walk(index + 1, [...chosen, null]);
  };
  walk(0, []);
  return out;
}

/** The best assignment of `options` to `slots` by total S(c); ties to the options' order (sheet order). */
export function bestAssignment(view: AiView, rows: RowTable, worth: Record<MonKey, number>, slots: readonly DoublesSlotId[], options: readonly MonKey[], runtime?: BattleRuntime): (MonKey | null)[] {
  const scores = new Map<string, number>();
  const score = (key: MonKey, slot: DoublesSlotId) => {
    const id = `${key}>${slot}`;
    let value = scores.get(id);
    if (value === undefined) scores.set(id, value = replacementScore(view, rows, worth, key, slot, runtime));
    return value;
  };
  let best: (MonKey | null)[] = slots.map(() => null), top = -Infinity;
  for (const assignment of assignments(slots, options)) {
    const total = assignment.reduce((sum, key, i) => sum + (key ? score(key, slots[i]) : 0), 0);
    if (total > top + 1e-12) { best = assignment; top = total; }
  }
  return best;
}

/** The AI's living bench (its own request's members not in battle), in view order (its sheet order). */
export function benchOf(view: AiView, side: DoublesSideId): MonKey[] {
  return view.mons.filter((mon) => mon.side === side && mon.slot === null && living(mon)).map((mon) => mon.key);
}

/**
 * Forced or mid-turn replacements for the AI's flagged `slots` (engine orientation). Among the request's legal joint
 * actions (view.legal.opponent) the one whose switches score highest; without a legal list, the best assignment.
 */
export function chooseReplacements(view: AiView, rows: RowTable, worth: Record<MonKey, number>, slots: DoublesSlotId[], runtime?: BattleRuntime): JointAction {
  const side: DoublesSideId = "opponent";
  const memberOf = (key: MonKey) => key.slice(key.indexOf(":") + 1);
  const legal = view.legal.opponent;
  if (legal.length) {
    const score = (action: SlotAction | undefined, slot: DoublesSlotId) => action?.kind === "switch"
      ? replacementScore(view, rows, worth, `${side}:${action.to}` as MonKey, slot, runtime) : 0;
    // Ties keep the legal list's order (the request's member order).
    let best = legal[0], top = -Infinity;
    for (const joint of legal) {
      const total = slots.reduce((sum, slot) => sum + score(joint[slot], slot), 0);
      if (total > top + 1e-12) { best = joint; top = total; }
    }
    return best;
  }
  const assignment = bestAssignment(view, rows, worth, slots, benchOf(view, side), runtime);
  const action: JointAction = {};
  slots.forEach((slot, i) => { const key = assignment[i]; action[slot] = key ? { kind: "switch", to: memberOf(key) } : { kind: "pass" }; });
  return action;
}

/** The rollout ReplacePolicy: the best assignment by S(c) for either side's flagged slots. */
export function replacePolicy(view: AiView, rows: RowTable, worth: Record<MonKey, number>, runtime?: BattleRuntime): ReplacePolicy {
  return (_side, slots, options) => {
    const assignment = bestAssignment(view, rows, worth, slots, options, runtime);
    const out: MonKey[] = [];
    for (const key of assignment) if (key) out.push(key);
    // Options that score -Infinity (unknown to this view) still fill a flagged slot, in their given order.
    for (const key of options) if (out.length < Math.min(slots.length, options.length) && !out.includes(key)) out.push(key);
    return out;
  };
}
