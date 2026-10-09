import {
  allyOf, DOUBLES_SLOTS, foesOf, relativePosition, SLOT_POSITION, slotSide,
  type DoublesFact, type DoublesHit, type DoublesHP, type DoublesResidual, type DoublesSlotId, type DoublesStartRow, type DoublesStep, type DoublesTargetRule,
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

/** The minus sign of HP changes (U+2212). */
const MINUS = "−";

/**
 * An HP change over every outcome, signed: "+163", "−87", "+12–20", "−11–22" (a loss of 11 to 22), "−30 to +40" (a
 * loss on some outcomes and a gain on others, as Pain Split can give).
 */
export function hpChangeText(min: number, max: number) {
  if (min === max) return min > 0 ? `+${min}` : min < 0 ? `${MINUS}${-min}` : "0";
  if (min >= 0) return `+${min}–${max}`;
  if (max <= 0) return `${MINUS}${-max}–${-min}`;
  return `${MINUS}${-min} to +${max}`;
}

/** " · reaches it 50%" for a share of the turn below 1; "" when certain. */
function reachText(chance: number) {
  return chance > 1 - 1e-9 ? "" : ` · reaches it ${chanceText(chance)}`;
}

/**
 * The hits of a move that met `hit`'s Substitute (DoublesHit.substitute): "Blastoise's Substitute: −15–19 HP, breaks 25% ·
 * reaches it 50%", the HP the Substitute lost, the share of the turn in which it broke, and the share in which the move
 * met it. Null when it met none.
 */
export function substituteLine(hit: DoublesHit, names: DoublesNames) {
  const sub = hit.substitute;
  if (!sub) return null;
  const lost = sub.min === sub.max ? `${MINUS}${sub.min}` : `${MINUS}${sub.min}–${sub.max}`;
  return `${names[hit.slot]}'s Substitute: ${lost} HP${sub.breaks > 0 ? `, breaks ${chanceText(sub.breaks)}` : ""}${reachText(sub.chance)}`;
}

/**
 * One Pokémon a move reaches: "Blastoise: 36–43 damage (23.38–27.92% of max HP), 2–5 hits · KO chance 75% · reaches it 50%",
 * or "Blastoise: no damage" for a blocked or immune hit (its facts follow on their own line). `chosen`: the hit count is
 * one chosen in the move settings, which the line names ("3 hits"), as the 1v1 card does (result-format hitRangeText).
 * A status move (`status`) that acted on it: "Blastoise", with the HP it changed ("Blastoise: +77 HP"); one that was
 * blocked or had no effect: "Blastoise: no effect". A move whose every outcome met a Substitute: substituteLine's text
 * (a calculated hit that also met one shows that line before this one, and no hit count: the row's count is the whole
 * move's, while the damage is that of the hits that got past the Substitute).
 */
export function hitLine(hit: DoublesHit, names: DoublesNames, chosen = false, status = false) {
  const reach = reachText(hit.reached);
  if (hit.kind === "effect") return `${names[hit.slot]}${hit.change ? `: ${hpChangeText(hit.change.min, hit.change.max)} HP` : ""}${reach}`;
  if (hit.kind === "substitute") return substituteLine(hit, names) ?? `${names[hit.slot]}'s Substitute${reach}`;
  if (hit.kind !== "calculated") return `${names[hit.slot]}: ${status ? "no effect" : "no damage"}${reach}`;
  const hits = hit.row && !hit.substitute ? hitRangeText(hit.row, chosen) : null;
  return `${names[hit.slot]}: ${damageText(hit)}${hits ? `, ${hits}` : ""} · KO chance ${chanceText(hit.koChance)}${reach}`;
}

/**
 * The hits a step lists. A hit the move never reached in any outcome, with no fact of its own, is left out (a Ghost type's
 * Curse lists its own user, which it never targets: its line would read "no effect · reaches it 0%"). So is a status move's
 * hit that states nothing of its own (no HP change, no fact, in every outcome) when the step's own facts say what the move
 * did (Wish, Ally Switch, Trick): its line would be the name alone.
 */
export function listedHits(step: Pick<DoublesStep, "hits" | "facts">) {
  const unreached = (hit: DoublesHit) => hit.reached < 1e-12 && !hit.facts.length && !hit.substitute;
  const bare = (hit: DoublesHit) => hit.kind === "effect" && !hit.change && !hit.substitute && !hit.facts.length && hit.reached > 1 - 1e-9;
  const listed = step.hits.filter((hit) => !unreached(hit) && !(step.facts.length > 0 && bare(hit)));
  return listed.length === step.hits.length ? step.hits : listed;
}

/**
 * One residual of the end of turn: "Sandstorm · Garchomp: −11 HP", "Leech Seed · Venusaur: +12 HP (from Blastoise)",
 * "Bad poison · Blastoise: −9–19 HP (50%), KO chance 12.5%", "Healer · Garchomp (from Audino) (30%)" when it changes no
 * HP. The chance in brackets is the share of the turn in which it acts; the KO chance, the share in which it knocks the
 * Pokémon out.
 */
export function residualLine(residual: DoublesResidual, names: DoublesNames) {
  const { effect, slot, other, chance, min, max, koChance } = residual;
  const change = min === null || max === null ? "" : `: ${hpChangeText(min, max)} HP`;
  const from = other ? ` (from ${names[other]})` : "";
  const share = chance > 1 - 1e-9 ? "" : ` (${chanceText(chance)})`;
  return `${effect} · ${names[slot]}${change}${from}${share}${koChance > 0 ? `, KO chance ${chanceText(koChance)}` : ""}`;
}

/** "Substitute: 15 HP." → ["Substitute: ", 15]: a condition whose worlds differ only by an HP value. */
function hpCondition(text: string): [string, number] | null {
  const match = /^(.+: )(\d+) HP\.$/.exec(text);
  return match ? [match[1], Number(match[2])] : null;
}

/**
 * The card's conditions line (DoublesHP.conditions): "Paralysed · Confused (67%) · Substitute: 15–19 HP". Each fact
 * without its full stop, with the share of the turn in which it holds when below 1. Facts that differ only by an HP
 * value ("Substitute: 15 HP.", "Substitute: 19 HP.") are one range, with the share in which any of them holds.
 */
export function conditionsLine(conditions: readonly DoublesFact[]) {
  const merged: { text: string; chance: number; hp?: [string, number, number] }[] = [];
  for (const fact of conditions) {
    const hp = hpCondition(fact.text);
    const same = hp && merged.find((entry) => entry.hp?.[0] === hp[0]);
    if (same?.hp && hp) {
      same.hp = [hp[0], Math.min(same.hp[1], hp[1]), Math.max(same.hp[2], hp[1])];
      same.chance += fact.chance;
    } else merged.push({ text: fact.text, chance: fact.chance, ...(hp ? { hp: [hp[0], hp[1], hp[1]] as [string, number, number] } : {}) });
  }
  return merged.map(({ text, chance, hp }) => {
    const words = hp ? `${hp[0]}${formatRange(hp[1], hp[2])} HP` : text.endsWith(".") ? text.slice(0, -1) : text;
    return chance > 1 - 1e-9 ? words : `${words} (${chanceText(Math.min(1, chance))})`;
  }).join(" · ");
}

const ROW_KINDS: Record<MoveDamageResult["kind"], string> = {
  calculated: "Calculated", status: "Status move", "needs-context": "Needs context", unsupported: "Unsupported",
};

/**
 * A move's damage into one Pokémon at the start of the turn: "Flamethrower · Charizard → Blastoise: 26–31 damage (…)",
 * then where the move goes when the row says (" · Lightning Rod: Raichu takes Thunderbolt."). `chosen` as for hitLine.
 */
export function startRowLine(entry: DoublesStartRow, names: DoublesNames, runtime: BattleRuntime, chosen = false) {
  const { row } = entry;
  const name = row.effectiveName ?? runtime.movesById.get(row.moveId)?.name ?? row.moveId;
  const hits = row.kind === "calculated" ? hitRangeText(row, chosen) : null;
  const result = row.kind === "calculated" ? `${damageText(row)}${hits ? `, ${hits}` : ""}` : row.reason ?? ROW_KINDS[row.kind];
  return `${name} · ${names[entry.slot]}${ARROW}${names[entry.target]}: ${result}${entry.fact ? ` · ${entry.fact}` : ""}`;
}

type ReadyTurn = Extract<DoublesTurnResult, { status: "ready" }>;

/**
 * The HP the cards and the live summary show for a ready turn: after the whole turn when its end of turn is estimated
 * (`afterTurn`), else after the moves.
 */
export function turnHP(turn: ReadyTurn): { hp: ReadyTurn["hp"]; afterTurn: boolean } {
  return turn.endOfTurn.status === "ready" ? { hp: turn.endOfTurn.hp, afterTurn: true } : { hp: turn.hp, afterTurn: false };
}

/**
 * Whether a turn in which no Pokémon chose a move still has something to show: a No-move Pokémon's confusion self-hit
 * (DoublesHP.losses), an end-of-turn residual or fact (sand, Leftovers, a Wish), or an end of turn not estimated.
 */
export function actsWithoutMoves(turn: DoublesTurnResult | null | undefined): boolean {
  if (turn?.status !== "ready") return false;
  if (DOUBLES_SLOTS.some((slot) => (turn.hp[slot]?.losses?.length ?? 0) > 0)) return true;
  const end = turn.endOfTurn;
  return end.status === "not-estimated" || end.residuals.length > 0 || end.facts.length > 0;
}

/**
 * The card shows the slot's KO chance: some damaging move reaches it, a status move takes HP from it (Pain Split, Belly
 * Drum's cost), a residual of the end of turn takes HP from it, or it can faint without any of these (its own recoil,
 * Explosion, Life Orb or a target's Rocky Helmet; the step's facts say which). A Pokémon only a status move reached
 * otherwise (Thunder Wave, Swords Dance, a status move it is immune to) shows none: a status move is known by its
 * "effect" hit, or with `runtime` by its category.
 */
export function cardReached(turn: ReadyTurn | null, slot: DoublesSlotId, runtime?: BattleRuntime) {
  if (!turn) return false;
  const end = turn.endOfTurn.status === "ready" ? turn.endOfTurn : null;
  const status = (step: DoublesStep, hit: DoublesHit) => hit.kind === "effect" || runtime?.movesById.get(step.moveId)?.category === "Status";
  const reaches = (step: DoublesStep, hit: DoublesHit) => hit.slot === slot && hit.reached > 0 && (!status(step, hit) || (hit.change?.min ?? 0) < 0);
  return turn.steps.some((step) => step.hits.some((hit) => reaches(step, hit))) || (turn.hp[slot]?.koChance ?? 0) > 0
    || !!end && ((end.hp[slot]?.koChance ?? 0) > 0 || end.residuals.some((residual) => residual.slot === slot && residual.min !== null && residual.min < 0));
}

/** The HP the card shows for the roll: the low or high roll's, or the average rounded like 1v1 (the HP taken off rounds half up). */
export function shownHP(hp: Pick<DoublesHP, "start" | "low" | "average" | "high">, mode: DamageRollMode) {
  return mode === "low" ? hp.low : mode === "high" ? hp.high : hp.start - Math.round(hp.start - hp.average);
}

/** A 2v2 Pokémon at 0 HP: it fainted before the turn and takes no part in it. */
export const FAINTED = "Fainted";

/**
 * The card's HP label for a turn result: "After the turn · Average estimate" when its HP is after the end of turn
 * (`afterTurn`), else "After the moves · Average estimate"; without one, "Current HP" (the 1v1 Dynamax wording).
 */
export function cardHPLabel(projected: boolean, mode: DamageRollMode, mechanic: BattleMechanic | undefined, afterTurn = false) {
  if (projected) return `${afterTurn ? "After the turn" : "After the moves"} · ${rollDescription(mode)}`;
  return mechanic === "dynamax" ? "Current HP (Dynamax)" : mechanic === "gigantamax" ? "Current HP (Gigantamax)" : "Current HP";
}

/** "End of turn not estimated: {reason}" (the turn panel's line and the live summary's last sentence). */
export function endNotEstimatedText(reason: string) {
  return `End of turn not estimated: ${reason}`;
}

/**
 * "Garchomp HP remaining: 79 / 183. Blastoise HP remaining: 0 / 154, KO chance 75%." for a ready turn, after the whole
 * turn when its end of turn is estimated; otherwise after the moves, then why the end of turn is not. The reason for any
 * other result.
 */
export function turnSummary(turn: DoublesTurnResult | null, names: DoublesNames, mode: DamageRollMode) {
  if (!turn) return "";
  if (turn.status === "not-estimated") return `Turn not estimated: ${turn.reason}`;
  if (turn.status === "issues") return issueLines(turn.issues, names).join(" ");
  const { hp: records } = turnHP(turn);
  return [...DOUBLES_SLOTS.flatMap((slot) => {
    const hp = records[slot];
    if (!hp) return [];
    return [`${names[slot]} HP remaining: ${shownHP(hp, mode)} / ${hp.maximum}${hp.koChance > 0 ? `, KO chance ${chanceText(hp.koChance)}` : ""}.`];
  }), ...(turn.endOfTurn.status === "not-estimated" ? [endNotEstimatedText(turn.endOfTurn.reason)] : [])].join(" ");
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
