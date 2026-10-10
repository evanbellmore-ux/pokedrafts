import { DOUBLES_SLOTS, duplicateNameParts, nameText, slotSide, type DoublesSideId, type DoublesSlotId, type NameParts } from "@/app/lib/battle/doubles-types";
import type { BattleStatus, CombatStat } from "@/app/lib/battle/types";
import type { BoardView, FieldEffectView, HPView, ItemView, PokemonView } from "../model/view-types";

// Text for the battle board: facts only. Foe HP is the percentage the game shows (pinned Champions getHealth,
// sim/pokemon.ts:2060-2073: floor(100 × hp / maxhp) || 1, with a `y`/`r` or `g`/`y` suffix only at exactly 20 and 50).

export type BoardNames = Record<DoublesSlotId, string>;

/** "yours" / "opponent's" for a side. */
const SIDE_WORD: Record<DoublesSideId, NonNullable<NameParts["side"]>> = { own: "yours", opponent: "opponent's" };

/**
 * The active cards' name parts (§1.2-1.4 of the naming rules): the side word when both teams have the card's battle name
 * (`board.mirrored`) or an active card on the other side shows the same name now (a Transform), the number while the two
 * active cards of one side show the same name (an Illusion or a Transform: own-left / opponent-left 1, the right slots 2).
 * An empty slot's base is "".
 */
export function boardNameParts(board: BoardView): Record<DoublesSlotId, NameParts> {
  const base = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, board.active[slot]?.name ?? ""])) as BoardNames;
  const parts = duplicateNameParts(base);
  for (const slot of DOUBLES_SLOTS) {
    const view = board.active[slot];
    if (view && !parts[slot].side && board.mirrored.includes(view.key)) parts[slot] = { ...parts[slot], side: SIDE_WORD[slotSide(slot)] };
  }
  return parts;
}

/** The active cards' full names for facts and labels ("Garchomp", "Garchomp (yours)", "Garchomp (1)"); "" for an empty slot. */
export function boardNames(board: BoardView): BoardNames {
  const parts = boardNameParts(board);
  return Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, nameText(parts[slot])])) as BoardNames;
}

/** An active slot's name without its side word ("Garchomp", "Garchomp (2)"): where only your own Pokémon can be meant. */
export function plainName(board: BoardView, slot: DoublesSlotId) {
  return nameText({ ...boardNameParts(board)[slot], side: null });
}

/** A member by its name with its team's side word when both teams have that name ("Garchomp (opponent's)"), active or not. */
export function memberFullName(board: BoardView, view: Pick<PokemonView, "key" | "name" | "side">) {
  return nameText({ base: view.name, side: board.mirrored.includes(view.key) ? SIDE_WORD[view.side] : null, number: null });
}

/** "143 / 183 HP", "58% HP". */
export function hpText(hp: HPView) {
  return hp.kind === "exact" ? `${hp.current} / ${hp.maximum} HP` : `${hp.percent}% HP`;
}
/** The meter's aria-valuetext: "143 of 183 HP", "58% HP". */
export function hpValueText(hp: HPView) {
  return hp.kind === "exact" ? `${hp.current} of ${hp.maximum} HP` : `${hp.percent}% HP`;
}
export function hpFraction(hp: HPView) {
  if (hp.kind === "exact") return hp.maximum > 0 ? Math.max(0, Math.min(1, hp.current / hp.maximum)) : 0;
  return Math.max(0, Math.min(1, hp.percent / 100));
}
/** Bar tone as the 2v2 card: above half green, above a fifth yellow, else red; at exactly 50% / 20% the suffix decides. */
export function hpTone(hp: HPView): "success" | "warning" | "danger" {
  if (hp.kind === "percent" && hp.color) return hp.color === "g" ? "success" : hp.color === "y" ? "warning" : "danger";
  const fraction = hpFraction(hp);
  return fraction > 0.5 ? "success" : fraction > 0.2 ? "warning" : "danger";
}

const STATUS_LABELS: Record<BattleStatus, string> = {
  "": "Healthy", brn: "Burned", par: "Paralyzed", psn: "Poisoned", tox: "Badly poisoned", slp: "Asleep", frz: "Frozen",
};
export function statusLabel(status: BattleStatus) {
  return STATUS_LABELS[status] ?? status;
}

const BOOST_ORDER: (CombatStat | "accuracy" | "evasion")[] = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"];
const BOOST_SHORT: Record<CombatStat | "accuracy" | "evasion", string> = {
  atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe", accuracy: "Acc", evasion: "Eva",
};
const BOOST_FULL: Record<CombatStat | "accuracy" | "evasion", string> = {
  atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "Accuracy", evasion: "Evasion",
};
function signed(value: number) {
  return value > 0 ? `+${value}` : `−${-value}`;
}
type Boosts = PokemonView["boosts"];
/** "Atk +1 · SpD −1" (stages at 0 omitted). */
export function boostText(boosts: Boosts) {
  return BOOST_ORDER.filter((stat) => (boosts[stat] ?? 0) !== 0).map((stat) => `${BOOST_SHORT[stat]} ${signed(boosts[stat]!)}`).join(" · ");
}
/** "Attack +1, Sp. Def −1" for aria-label. */
export function boostLabel(boosts: Boosts) {
  return BOOST_ORDER.filter((stat) => (boosts[stat] ?? 0) !== 0).map((stat) => `${BOOST_FULL[stat]} ${signed(boosts[stat]!)}`).join(", ");
}

/** "Item: Sitrus Berry", "Item: Sitrus Berry (eaten)", "Item: Focus Sash (used)", "Item: Choice Scarf (removed)", "No item", "Item: not shown". */
export function itemText(item: ItemView) {
  switch (item.state) {
    case "unknown": return "Item: not shown";
    case "none": return "No item";
    case "held": return `Item: ${item.name}`;
    case "consumed": return `Item: ${item.name} (${item.id.endsWith("berry") ? "eaten" : "used"})`;
    case "removed": return `Item: ${item.name} (removed)`;
  }
}

/** "Trick Room · 2 turns", "Tailwind · 1 turn", "Spikes" (no count when it lasts). */
export function fieldText(effect: FieldEffectView) {
  return effect.turns === null ? effect.name : `${effect.name} · ${effect.turns} turn${effect.turns === 1 ? "" : "s"}`;
}

/** Living Pokémon left: yours from the four brought; the AI's from its four, less the ones shown fainted. */
export function remaining(board: BoardView, side: DoublesSideId) {
  if (side === "own") return board.team.own.filter((mon) => !mon.fainted).length;
  return Math.max(0, 4 - board.team.opponent.filter((mon) => mon.fainted).length);
}

/** The member a key names on either side of the board. */
export function memberByKey(board: BoardView | null, key: string): PokemonView | null {
  if (!board) return null;
  return board.team.own.find((mon) => mon.key === key) ?? board.team.opponent.find((mon) => mon.key === key) ?? null;
}
