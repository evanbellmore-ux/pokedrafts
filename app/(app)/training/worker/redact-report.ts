// The AI's read and its actions as you may see them (SPEC §9.7, I9; addendum A1.5 MegaFact): an option that would show
// you a closed fact of the AI's team (a move it has not used with Moves closed, a member not yet seen without the
// brought test setting, a Mega Stone with Items closed and not shown, a move of a Pokémon your log shows as another one
// under Illusion) is replaced by "Not shown"; a read sentence or Mega fact that names one is left out.
import { DOUBLES_SLOTS, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { InfoView } from "../model/info";
import type { PublicState } from "../model/public-state";
import type { DecisionOption, DecisionReport, JointAction, MegaFact, ReadRefs, SlotAction } from "../model/view-types";

/** Your view of the AI's side (the p1 tracker's state) and which member stood in each of its slots that turn. */
export type RedactContext = {
  state: PublicState;
  youSee: InfoView;
  /** The AI's member key per engine slot at the decision (opponent-left / opponent-right), from its request. */
  slotMembers: Partial<Record<DoublesSlotId, string>>;
  /**
   * The member your log showed in each of the AI's slots at the decision (the p1 tracker). It differs from slotMembers
   * while an Illusion disguises that Pokémon (PS/sim/pokemon.ts:530-533, 544-553). Absent: no Illusion check.
   */
  shownMembers?: Partial<Record<DoublesSlotId, string>>;
};

const aiMon = (ctx: RedactContext, memberKey: string | undefined) => (memberKey ? ctx.state.mons[`p2:${memberKey}`] : undefined);
const stoneShown = (ctx: RedactContext, memberKey: string | undefined) => {
  const mon = aiMon(ctx, memberKey);
  return !!mon && (mon.mega || mon.item.state !== "not-shown");
};
/** Your log has shown this member enter the battle. */
const memberShown = (ctx: RedactContext, memberKey: string) => (aiMon(ctx, memberKey)?.switchIns ?? 0) > 0;
/** Your log showed this member in this slot at the decision (not hidden behind an Illusion). */
const shownInSlot = (ctx: RedactContext, memberKey: string, slot: DoublesSlotId) =>
  ctx.shownMembers ? ctx.shownMembers[slot] === memberKey : memberShown(ctx, memberKey);
const moveShown = (ctx: RedactContext, memberKey: string, moveId: string) =>
  ctx.youSee.open.moves || (aiMon(ctx, memberKey)?.movesUsed[moveId] ?? 0) > 0;

/** True for one of the AI's slot actions that would show you a closed fact. */
export function hiddenSlotAction(slot: DoublesSlotId, action: SlotAction, ctx: RedactContext): boolean {
  if (!slot.startsWith("opponent")) return false;
  const memberKey = ctx.slotMembers[slot];
  if (action.kind === "switch") {
    if (ctx.youSee.brought) return false;
    const target = aiMon(ctx, action.to);
    return !target || target.switchIns === 0;
  }
  if (action.kind !== "move") return false;
  // A move of a Pokémon your log shows as another member (Illusion) names the real one.
  if (memberKey && ctx.shownMembers && ctx.shownMembers[slot] !== memberKey) return true;
  const mon = aiMon(ctx, memberKey);
  if (!ctx.youSee.open.moves && !(mon && (mon.movesUsed[action.moveId] ?? 0) > 0)) return true;
  if (action.mega && !ctx.youSee.open.items && !stoneShown(ctx, memberKey)) return true;
  return false;
}

const isHidden = (action: JointAction, ctx: RedactContext) => DOUBLES_SLOTS.some((slot) => { const each = action[slot]; return !!each && hiddenSlotAction(slot, each, ctx); });

/** The AI's executed action without its hidden slot actions (LogTurn.actions.opponent). */
export function redactJoint(action: JointAction, ctx: RedactContext): JointAction {
  const out: JointAction = {};
  for (const slot of DOUBLES_SLOTS) {
    const each = action[slot];
    if (each && !hiddenSlotAction(slot, each, ctx)) out[slot] = each;
  }
  return out;
}

/** A read sentence shows you nothing closed: its members as your log showed them, its moves open or used, its Stat Points and nature open when it rests on them. */
function refsShown(refs: ReadRefs, ctx: RedactContext): boolean {
  if (refs.stats && !(ctx.youSee.open.statPoints && ctx.youSee.open.natures)) return false;
  if (refs.inSlot.some(({ memberKey, slot }) => !shownInSlot(ctx, memberKey, slot))) return false;
  if (refs.incoming.some((memberKey) => !memberShown(ctx, memberKey))) return false;
  return refs.moves.every(({ memberKey, moveId }) => moveShown(ctx, memberKey, moveId));
}

/** A kept Mega Evolution names the stone: left out while Items are closed and the battle has not shown it. */
const stoneClosed = (mega: MegaFact, ctx: RedactContext) => !ctx.youSee.open.items && !mega.evolved && !stoneShown(ctx, mega.memberKey);
/** A Mega fact without its refs: the stone, and the moves it names as the Mega member's. */
function megaShown(mega: MegaFact, ctx: RedactContext): boolean {
  const mon = aiMon(ctx, mega.memberKey);
  const movesClosed = !ctx.youSee.open.moves && mega.moves.some((moveId) => !(mon && (mon.movesUsed[moveId] ?? 0) > 0));
  return !stoneClosed(mega, ctx) && !movesClosed;
}

/**
 * Strategy options that would show a closed fact merge into one `{ action: null }` entry with their summed chance;
 * `chosen` points to it when the chosen option was hidden. The read sentence and the Mega fact are the first that show
 * you nothing closed (`facts`, which never leaves the worker).
 */
export function redactReport(report: DecisionReport, ctx: RedactContext): DecisionReport {
  const shown: DecisionOption[] = [];
  let hiddenChance = 0;
  let hiddenIndex = -1;
  let chosen = -1;
  report.strategy.forEach((option, index) => {
    const hidden = option.action !== null && isHidden(option.action, ctx);
    if (!hidden && option.action !== null) {
      if (index === report.chosen) chosen = shown.length;
      shown.push(option);
      return;
    }
    hiddenChance += option.chance;
    if (index === report.chosen) chosen = -2;
    if (hiddenIndex < 0) hiddenIndex = index;
  });
  const strategy = [...shown];
  if (hiddenChance > 0 || hiddenIndex >= 0) {
    const merged: DecisionOption = { action: null, chance: hiddenChance };
    const at = strategy.findIndex((option) => option.chance < hiddenChance);
    const position = at < 0 ? strategy.length : at;
    strategy.splice(position, 0, merged);
    if (chosen === -2) chosen = position;
    else if (chosen >= position) chosen++;
  }
  const { facts, ...rest } = report;
  let reason: string | null;
  let mega: MegaFact | null;
  if (facts) {
    reason = facts.reasons.find((fact) => refsShown(fact.refs, ctx))?.text ?? null;
    const megaFact = facts.mega.find((fact) => refsShown(fact.refs, ctx) && !stoneClosed(fact, ctx));
    mega = megaFact ? { memberKey: megaFact.memberKey, evolved: megaFact.evolved, moves: megaFact.moves, text: megaFact.text } : null;
  } else {
    // A report without its facts (team preview, a fallback, another provider): a sentence whose names are not known
    // could show a closed fact, so it is left out; the Mega fact by its own member, stone and moves.
    reason = null;
    mega = report.mega && megaShown(report.mega, ctx) ? report.mega : null;
  }
  return { ...rest, strategy, chosen: Math.max(0, chosen), reason, mega };
}
