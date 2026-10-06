import { DOUBLES_SLOTS, SLOT_POSITION, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { getPokemonTypeColours } from "@/app/lib/theme";
import type { BoardView, HPView, LogTurn, PokemonView, TurnStep } from "../model/view-types";
import { hpText } from "./board-format";

// The board's turn playback (pure): which steps are new, the board at each beat of a step, its popup, the cards' labels and
// the live region's sentence. The worker sends each turn's steps (log/protocol-steps.ts); the page never parses protocol.

/** Each step plays in two beats (the timings live here only): the popup with the move's name, then its results on the cards. */
export const ANNOUNCE_MS = 900;
export const RESOLVE_MS = 2000;
/** The HP bars' slide at the start of the resolve beat. */
export const HP_ANIMATION_MS = 900;

/**
 * "announce": the popup over the board as it was before the step; "resolve": the step's results on the cards. A step whose HP
 * dipped and came back up (a hit, then its Sitrus Berry) opens its resolve with "dip" (the bars at their lowest, HP_ANIMATION_MS).
 */
export type StepBeat = "announce" | "dip" | "resolve";
export type QueuedStep = { turn: number; index: number; step: TurnStep };
export type PlayedCounts = Readonly<Record<number, number>>;

/** Steps the page has already shown, per turn: every step of the log as it is now. */
export function playedCounts(log: readonly LogTurn[]): Record<number, number> {
  return Object.fromEntries(log.map((turn) => [turn.turn, turn.steps?.length ?? 0]));
}

/** A Pokémon's HP went down and back up in the step (StepSlot hp.low). */
export function hasDip(step: TurnStep) {
  return step.slots.some((slot) => !!slot.hp?.low);
}

/** The log's steps beyond `played`, oldest first (turn 0, the leads, is never replayed), and the counts with them. */
export function unplayedSteps(log: readonly LogTurn[], played: PlayedCounts): { queue: QueuedStep[]; played: Record<number, number> } {
  const queue: QueuedStep[] = [];
  for (const turn of log) {
    const steps = turn.steps ?? [];
    const from = played[turn.turn] ?? 0;
    if (turn.turn > 0) steps.slice(from).forEach((step, offset) => queue.push({ turn: turn.turn, index: from + offset, step }));
  }
  return { queue, played: { ...played, ...playedCounts(log) } };
}

/** The move's type colour (getPokemonTypeColours); null for a step without a move type. */
export function typeColours(step: TurnStep) {
  return step.type ? getPokemonTypeColours(step.type) : null;
}

/** The cards' highlight: the move's type colour, the theme accent for switches, Mega Evolution and the end of turn. */
export function highlightColour(step: TurnStep): string {
  return typeColours(step)?.background ?? "var(--color-accent)";
}

export type Popup = {
  /** "Blizzard", "Dragonite switches for Blastoise", "U-turn: Staraptor switches for Venusaur", "End of turn". */
  title: string;
  /** Under the title: a move's user when its cards do not show it; another step's results ("Snow", "Snow ended"). */
  sub: string | null;
  /** A move's name is drawn large in its type colour; the other steps are sentences in the text colour. */
  move: boolean;
  /** Text colour and its contrasting outline (the type's own text colour, so it reads on any background). */
  colour: string;
  outline: string;
};

/** `actorName`: the move's user as its card shows it ("Gardevoir-Mega"), used unless the step told two of one name apart. */
export function popupOf(step: TurnStep, actorName: string | null = null): Popup {
  const colours = step.kind === "move" ? typeColours(step) : null;
  const by = step.by && actorName && !step.by.includes("(") ? actorName : step.by;
  return {
    title: step.title,
    sub: step.kind === "move" ? by : step.results.length ? step.results.join(" · ") : null,
    move: step.kind === "move",
    colour: colours?.background ?? "var(--color-text)",
    outline: colours?.foreground ?? "var(--color-bg)",
  };
}

/**
 * A card's labels in the resolve beat: its facts in the step ("Burned", "Attack −1", "Protected", "Missed", "Focus Sash"),
 * "Fainted", and on a move's target the move's own results ("Failed", "No target", "Hit 3 times"). Damage alone needs none
 * (the bar). The other steps' results are under their popup.
 */
export function cardLabels(step: TurnStep, slot: DoublesSlotId): string[] {
  const labels = step.slots.filter((each) => each.slot === slot).flatMap((each) => [...each.facts, ...(each.fainted ? ["Fainted"] : [])]);
  if (step.kind === "move" && step.targets.includes(slot)) labels.push(...step.results);
  return [...new Set(labels)];
}

function sameHP(a: HPView, b: HPView) {
  return a.kind === "exact" && b.kind === "exact" ? a.current === b.current : a.kind === "percent" && b.kind === "percent" ? a.percent === b.percent : false;
}

/**
 * A Pokémon as the live region names it: as its card shows it on `board` ("Gardevoir-Mega"; by `key` when given, else the
 * one in `slot`), with its position when another active Pokémon shows the same name ("Garchomp (your right)").
 */
export function spokenName(board: BoardView, slot: DoublesSlotId, key?: string): string | null {
  const active = Object.values(board.active);
  const view = key ? [...active, ...board.team.own, ...board.team.opponent].find((each) => each?.key === key) : board.active[slot];
  if (!view) return null;
  const twins = active.filter((each) => each && each.key !== view.key && each.name === view.name).length > 0;
  return twins ? `${view.name} (${SLOT_POSITION[slot]})` : view.name;
}

/**
 * The live region's sentence for a step (read once, when its popup shows): "Abomasnow used Blizzard. Dragonite: 100% HP to
 * 17% HP, Super effective." `nameOf` names a Pokémon by its slot (and key) as the board does (spokenName); the step's own
 * names are the fallback.
 */
export function stepAnnouncement(step: TurnStep, nameOf: (slot: DoublesSlotId, key?: string) => string | null): string {
  const user = step.actor ? nameOf(step.actor) : null;
  const head = step.kind === "move" && user ? `${user} used ${step.title}.` : `${step.title}.`;
  const cards = step.slots.map((each) => {
    const parts = [
      ...(each.hp && !each.entered && !sameHP(each.hp.from, each.hp.to)
        ? [each.hp.low ? `${hpText(each.hp.from)} to ${hpText(each.hp.low)}, then ${hpText(each.hp.to)}` : `${hpText(each.hp.from)} to ${hpText(each.hp.to)}`] : []),
      ...cardLabels(step, each.slot).filter((label) => each.facts.includes(label) || label === "Fainted"),
    ];
    return parts.length ? `${nameOf(each.slot, each.key) ?? each.name}: ${parts.join(", ")}.` : "";
  });
  return [head, ...cards, ...step.results.map((result) => `${result}.`)].filter(Boolean).join(" ");
}

/**
 * The board while queue[index] plays: `base` (the board before the queue's first step) with the steps before it applied and
 * this one at its start ("from": the HP before, no one in or Mega Evolved yet; the announce beat) or its end ("to": HP,
 * status, stages, faints, switches and Mega Evolution after; the resolve beat), or "low" (as "to" with the HP at its lowest in
 * the step; the dip beat). A Pokémon that came in
 * or Mega Evolved is drawn as `latest` (the board now) shows it, with the step's HP; the rest keep `base`'s facts.
 */
export function playbackBoard(base: BoardView, latest: BoardView | null, queue: readonly QueuedStep[], index: number, phase: "from" | "low" | "to"): BoardView {
  const baseViews = new Map([...base.team.own, ...base.team.opponent].map((view) => [view.key, view]));
  for (const view of Object.values(base.active)) if (view && !baseViews.has(view.key)) baseViews.set(view.key, view);
  const latestViews = new Map(latest ? [...latest.team.own, ...latest.team.opponent].map((view) => [view.key, view]) : []);
  if (latest) for (const view of Object.values(latest.active)) if (view && !latestViews.has(view.key)) latestViews.set(view.key, view);
  const views = new Map<string, PokemonView>();
  const get = (key: string) => views.get(key) ?? baseViews.get(key) ?? latestViews.get(key) ?? null;
  const active = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, base.active[slot]?.key ?? null])) as Record<DoublesSlotId, string | null>;

  const apply = (step: TurnStep, phase: "from" | "low" | "to") => {
    const at = phase === "from" ? "from" : "to";
    for (const change of step.slots) {
      // Before the step, a Pokémon coming in is not there yet (the slot shows the one it replaces).
      if (at === "from" && change.entered) continue;
      let view = get(change.key);
      if (!view) continue;
      if (change.entered) {
        const shown = latestViews.get(change.key) ?? view;
        view = { ...shown, hp: view.hp, status: view.status, fainted: false, boosts: {} };
        for (const slot of DOUBLES_SLOTS) if (active[slot] === change.key) active[slot] = null;
        active[change.slot] = change.key;
      }
      if (change.mega && at === "to") {
        const shown = latestViews.get(change.key);
        if (shown) view = { ...view, name: shown.name, speciesId: shown.speciesId, types: shown.types, ability: shown.ability, mega: true };
      }
      const hp = change.hp ? (phase === "from" ? change.hp.from : phase === "low" ? change.hp.low ?? change.hp.to : change.hp.to) : view.hp;
      view = at === "to"
        ? { ...view, hp, fainted: change.fainted ? true : view.fainted, status: change.status ?? view.status, boosts: change.boosts ?? view.boosts }
        : { ...view, hp };
      views.set(change.key, view);
    }
  };
  for (let each = 0; each < Math.min(index, queue.length); each++) apply(queue[each].step, "to");
  if (index < queue.length) apply(queue[index].step, phase);

  const slotOf = (key: string): DoublesSlotId | null => DOUBLES_SLOTS.find((slot) => active[slot] === key) ?? null;
  const place = (view: PokemonView): PokemonView => {
    const current = views.get(view.key) ?? view;
    return { ...current, slot: slotOf(view.key) };
  };
  return {
    ...base,
    active: Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
      const key = active[slot];
      const view = key ? get(key) : null;
      return [slot, view ? { ...view, slot } : null];
    })) as Record<DoublesSlotId, PokemonView | null>,
    team: { own: base.team.own.map(place), opponent: base.team.opponent.map(place) },
  };
}
