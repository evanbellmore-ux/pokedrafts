import { DOUBLES_SLOTS, SLOT_POSITION, type DoublesSideId, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleStatus, CombatStat } from "@/app/lib/battle/types";
import type { BoardView, FieldEffectView, HPView, ItemView, PokemonView } from "../model/view-types";

// Text for the battle board: facts only. Foe HP is the percentage the game shows (pinned Champions getHealth,
// sim/pokemon.ts:2060-2073: floor(100 × hp / maxhp) || 1, with a `y`/`r` or `g`/`y` suffix only at exactly 20 and 50).

export type BoardNames = Record<DoublesSlotId, string>;

/** Names for facts and labels, with " (your left)" etc. on both when two slots show the same name; "" for an empty slot. */
export function boardNames(board: BoardView): BoardNames {
  const base = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, board.active[slot]?.name ?? ""])) as BoardNames;
  return Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const same = base[slot] !== "" && DOUBLES_SLOTS.some((other) => other !== slot && base[other] === base[slot]);
    return [slot, same ? `${base[slot]} (${SLOT_POSITION[slot]})` : base[slot]];
  })) as BoardNames;
}

/** "Garchomp (your left)". */
export function slotName(board: BoardView, slot: DoublesSlotId) {
  const name = board.active[slot]?.name ?? "";
  return name ? `${name} (${SLOT_POSITION[slot]})` : capitalize(SLOT_POSITION[slot]);
}

export function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
