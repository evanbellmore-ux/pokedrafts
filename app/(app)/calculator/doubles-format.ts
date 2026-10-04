import {
  allyOf, DOUBLES_SLOTS, foesOf, relativePosition, SLOT_POSITION, slotSide,
  type DoublesFact, type DoublesHit, type DoublesHP, type DoublesSlotId, type DoublesStartRow, type DoublesStep, type DoublesTargetRule,
  type DoublesTurnResult, type RelativePosition,
} from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleMechanic, MoveDamageResult } from "@/app/lib/battle/types";
import type { DamageRollMode } from "./hp-preview";
import { chanceText, damagePercent, formatRange, hitRangeText } from "./result-format";

// Text for the 2v2 tab: facts only. A "→" joins a move to its targets; the components show it aria-hidden with " targets " for screen readers.

export type DoublesNames = Record<DoublesSlotId, string>;

export const ARROW = " → ";

const ROLL_DESCRIPTIONS: Record<DamageRollMode, string> = { low: "Low roll", average: "Average estimate", high: "High roll" };

/** "Low roll", "Average estimate", "High roll" (the 1v1 card's roll words). */
export function rollDescription(mode: DamageRollMode) {
  return ROLL_DESCRIPTIONS[mode];
}

const RELATIVE_LABELS: Record<RelativePosition, string> = { "left-foe": "Left foe", "right-foe": "Right foe", ally: "Ally", itself: "Itself" };

/** Where `target` stands as `actor` sees it: "Left foe", "Right foe", "Ally" or "Itself". */
export function relativeLabel(actor: DoublesSlotId, target: DoublesSlotId) {
  return RELATIVE_LABELS[relativePosition(actor, target)];
}

/** "Your left", "Opponent's right". */
export function positionLabel(slot: DoublesSlotId) {
  const words = SLOT_POSITION[slot];
  return words[0].toUpperCase() + words.slice(1);
}

/** The species name without the " (your left)" doublesNames adds when two slots show the same species. */
export function baseName(names: DoublesNames, slot: DoublesSlotId) {
  const suffix = ` (${SLOT_POSITION[slot]})`;
  const name = names[slot];
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

/** "Charizard (your left)". */
export function positionedName(names: DoublesNames, slot: DoublesSlotId) {
  return `${baseName(names, slot)} (${SLOT_POSITION[slot]})`;
}

/** "Blastoise (left foe)", as `actor` sees `target`. */
export function relativeName(names: DoublesNames, actor: DoublesSlotId, target: DoublesSlotId) {
  return `${baseName(names, target)} (${relativeLabel(actor, target).toLowerCase()})`;
}

const NO_TARGET_FACTS: Record<Extract<DoublesTargetRule, { kind: "none" }>["scope"], string> = {
  self: "Targets itself",
  "self-and-ally": "Targets itself and its ally",
  "own-side": "Targets its side",
  "foe-side": "Targets the foes' side",
  field: "Targets the field",
  "own-team": "Targets its team",
  "last-attacker": "Targets the foe that last hit it",
};

function joinAnd(parts: string[]) {
  return parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** The Pokémon a list of slots names, from `actor`: "both foes and Venusaur (ally)", "Blastoise (left foe)". */
export function slotsText(names: DoublesNames, actor: DoublesSlotId, slots: readonly DoublesSlotId[]) {
  const foes = slots.filter((slot) => slotSide(slot) !== slotSide(actor));
  const others = slots.filter((slot) => slotSide(slot) === slotSide(actor));
  const parts = [...(foes.length === 2 ? ["both foes"] : foes.map((slot) => relativeName(names, actor, slot))), ...others.map((slot) => relativeName(names, actor, slot))];
  return parts.length ? joinAnd(parts) : "no Pokémon";
}

/**
 * What a slot's move aims at under its target rule (doubles-types DoublesTargetRule): `{ arrow: true }` for Pokémon targets
 * ("Blastoise (left foe)", "both foes and Venusaur (ally)", "a random foe"), `{ arrow: false }` for a "none" rule ("Targets itself").
 * A "choose" rule without a target, or an "auto" rule that reaches no Pokémon (every one it could reach has fainted), gives
 * "No target"; a random foe with one foe left names it.
 */
export function actionTargets(names: DoublesNames, actor: DoublesSlotId, rule: DoublesTargetRule, target: DoublesSlotId | null): { arrow: boolean; text: string } {
  if (rule.kind === "none") return { arrow: false, text: NO_TARGET_FACTS[rule.scope] };
  if (rule.kind === "auto") {
    if (!rule.hits.length) return { arrow: false, text: "No target" };
    return { arrow: true, text: rule.random && rule.hits.length > 1 ? "a random foe" : slotsText(names, actor, rule.hits) };
  }
  return target && rule.options.includes(target) ? { arrow: true, text: relativeName(names, actor, target) } : { arrow: false, text: "No target" };
}

/** "Flamethrower → Blastoise (left foe)", "Earthquake → both foes and Venusaur (ally)", "Protect · Targets itself". */
export function actionFact(moveName: string, names: DoublesNames, actor: DoublesSlotId, rule: DoublesTargetRule, target: DoublesSlotId | null) {
  const targets = actionTargets(names, actor, rule, target);
  return `${moveName}${targets.arrow ? ARROW : " · "}${targets.text}`;
}

/** The move's name in the turn: the converted move's (Z-Move, Max Move) when it differs. */
export function stepMoveName(step: Pick<DoublesStep, "moveId" | "effectiveName">, runtime: BattleRuntime) {
  return step.effectiveName ?? runtime.movesById.get(step.moveId)?.name ?? step.moveId;
}

/**
 * A step's first line: "2 · Flamethrower · Charizard (your left) → Blastoise (left foe)". `targets` comes from the slot's
 * action (actionTargets); without one (the action changed since), the Pokémon the step can reach.
 */
export function stepHeading(position: number, step: DoublesStep, names: DoublesNames, runtime: BattleRuntime, targets: { arrow: boolean; text: string } | null) {
  const aim = targets ?? (step.hits.length ? { arrow: true, text: slotsText(names, step.slot, step.hits.map((hit) => hit.slot)) } : null);
  const head = `${position} · ${stepMoveName(step, runtime)} · ${positionedName(names, step.slot)}`;
  return aim ? `${head}${aim.arrow ? ARROW : " · "}${aim.text}` : head;
}

/** "Faints before it moves (62.5%)." A fact that always holds keeps its text. */
export function factLine(fact: DoublesFact) {
  if (fact.chance > 1 - 1e-9) return fact.text;
  const chance = ` (${chanceText(fact.chance)})`;
  return fact.text.endsWith(".") ? `${fact.text.slice(0, -1)}${chance}.` : `${fact.text}${chance}`;
}

function ordinal(position: number) {
  const tens = position % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : position % 10 === 1 ? "st" : position % 10 === 2 ? "nd" : position % 10 === 3 ? "rd" : "th";
  return `${position}${suffix}`;
}

/** "Order: 1st 50% · 2nd 50%." when the step's place in the turn is not certain; null when it is. */
export function orderFact(order: DoublesStep["order"]) {
  return order.length > 1 ? `Order: ${order.map((entry) => `${ordinal(entry.position)} ${chanceText(entry.chance)}`).join(" · ")}.` : null;
}

function damageText(row: Pick<MoveDamageResult, "min" | "max" | "minPercent" | "maxPercent">) {
  return `${formatRange(row.min, row.max)} damage (${damagePercent(row)})`;
}

/**
 * One Pokémon a move reaches: "Blastoise: 36–43 damage (23.38–27.92% of max HP), 2–5 hits · KO chance 75% · reaches it 50%",
 * or "Blastoise: no damage" for a blocked or immune hit (its facts follow on their own line). `chosen`: the hit count is
 * one chosen in the move settings, which the line names ("3 hits"), as the 1v1 card does (result-format hitRangeText).
 */
export function hitLine(hit: DoublesHit, names: DoublesNames, chosen = false) {
  const reach = hit.reached > 1 - 1e-9 ? "" : ` · reaches it ${chanceText(hit.reached)}`;
  if (hit.kind !== "calculated") return `${names[hit.slot]}: no damage${reach}`;
  const hits = hit.row ? hitRangeText(hit.row, chosen) : null;
  return `${names[hit.slot]}: ${damageText(hit)}${hits ? `, ${hits}` : ""} · KO chance ${chanceText(hit.koChance)}${reach}`;
}

const ROW_KINDS: Record<MoveDamageResult["kind"], string> = {
  calculated: "Calculated", status: "Status move", "needs-context": "Needs context", unsupported: "Unsupported",
};

/**
 * A move's damage into one Pokémon at the start of the turn: "Flamethrower · Charizard → Blastoise: 26–31 damage (…)".
 * `chosen` as for hitLine.
 */
export function startRowLine(entry: DoublesStartRow, names: DoublesNames, runtime: BattleRuntime, chosen = false) {
  const { row } = entry;
  const name = row.effectiveName ?? runtime.movesById.get(row.moveId)?.name ?? row.moveId;
  const hits = row.kind === "calculated" ? hitRangeText(row, chosen) : null;
  const result = row.kind === "calculated" ? `${damageText(row)}${hits ? `, ${hits}` : ""}` : row.reason ?? ROW_KINDS[row.kind];
  return `${name} · ${names[entry.slot]}${ARROW}${names[entry.target]}: ${result}`;
}

/**
 * The card shows the slot's KO chance: some step reaches it, or it can faint without one (its own recoil, Explosion,
 * Life Orb or a target's Rocky Helmet; the step's facts say which). Unreached Pokémon that cannot faint show none.
 */
export function cardReached(turn: Extract<DoublesTurnResult, { status: "ready" }> | null, slot: DoublesSlotId) {
  if (!turn) return false;
  return turn.steps.some((step) => step.hits.some((hit) => hit.slot === slot && hit.reached > 0)) || (turn.hp[slot]?.koChance ?? 0) > 0;
}

/** The HP the card shows for the roll: the low or high roll's, or the average rounded like 1v1 (the HP taken off rounds half up). */
export function shownHP(hp: Pick<DoublesHP, "start" | "low" | "average" | "high">, mode: DamageRollMode) {
  return mode === "low" ? hp.low : mode === "high" ? hp.high : hp.start - Math.round(hp.start - hp.average);
}

/** A 2v2 Pokémon at 0 HP: it fainted before the turn and takes no part in it. */
export const FAINTED = "Fainted";

/** The card's HP label: "After the moves · Average estimate" for a turn result, else "Current HP" (the 1v1 Dynamax wording). */
export function cardHPLabel(projected: boolean, mode: DamageRollMode, mechanic: BattleMechanic | undefined) {
  if (projected) return `After the moves · ${rollDescription(mode)}`;
  return mechanic === "dynamax" ? "Current HP (Dynamax)" : mechanic === "gigantamax" ? "Current HP (Gigantamax)" : "Current HP";
}

/** "Garchomp HP remaining: 79 / 183. Blastoise HP remaining: 0 / 154, KO chance 75%." for a ready turn; the reason otherwise. */
export function turnSummary(turn: DoublesTurnResult | null, names: DoublesNames, mode: DamageRollMode) {
  if (!turn) return "";
  if (turn.status === "not-estimated") return `Turn not estimated: ${turn.reason}`;
  if (turn.status === "issues") return issueLines(turn.issues, names).join(" ");
  return DOUBLES_SLOTS.flatMap((slot) => {
    const hp = turn.hp[slot];
    if (!hp) return [];
    return [`${names[slot]} HP remaining: ${shownHP(hp, mode)} / ${hp.maximum}${hp.koChance > 0 ? `, KO chance ${chanceText(hp.koChance)}` : ""}.`];
  }).join(" ");
}

/** The engine's validation messages, each with the Pokémon it is about. */
export function issueLines(issues: Extract<DoublesTurnResult, { status: "issues" }>["issues"], names: DoublesNames) {
  return [
    ...DOUBLES_SLOTS.flatMap((slot) => (issues.pokemon[slot] ?? []).map((issue) => `${positionedName(names, slot)}: ${issue.message}`)),
    ...issues.actions.map((issue) => `${positionedName(names, issue.slot)}: ${issue.message}`),
    ...issues.field.map((issue) => `Field: ${issue.message}`),
  ];
}

/** The Pokémon `slot`'s damage can go into, in the Moves pane's order: left foe, right foe, ally. */
export function intoOptions(slot: DoublesSlotId): DoublesSlotId[] {
  return [...foesOf(slot), allyOf(slot)];
}
