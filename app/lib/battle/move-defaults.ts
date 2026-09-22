import snapshot from "@/data/champions/move-usage.json";
import { movesById, speciesById } from "./catalog";

export type MoveSlot = {
  moveId: string | null;
  origin: "usage" | "suggested" | "manual" | "imported" | "empty";
  gameType: "Singles" | "Doubles" | null;
};
export type MoveSlots = [MoveSlot, MoveSlot, MoveSlot, MoveSlot];

type GameType = "Singles" | "Doubles";
type FormatUsage = {
  source: { month: string };
  species: Record<string, readonly string[]>;
  aggregate: readonly string[];
};
const formats: Record<GameType, FormatUsage> = snapshot.formats;
const emptySlot = (): MoveSlot => ({ moveId: null, origin: "empty", gameType: null });
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Exact proven learnsets, not engine support or base-form usage, determine eligibility. */
export function createMoveSlots(speciesId: string, gameType: GameType): MoveSlots {
  const species = speciesById.get(speciesId);
  if (!species) return [emptySlot(), emptySlot(), emptySlot(), emptySlot()];
  const legal = new Set(species.moves.filter((id) => {
    const move = movesById.get(id);
    return Boolean(id && move && move.category !== "Status");
  }).sort(compareIds));
  const selected = new Set<string>();
  const slots: MoveSlot[] = [];
  const add = (ids: readonly string[], origin: "usage" | "suggested") => {
    for (const moveId of ids) {
      if (slots.length === 4) break;
      if (!legal.has(moveId) || selected.has(moveId)) continue;
      selected.add(moveId);
      slots.push({ moveId, origin, gameType });
    }
  };
  const format = formats[gameType];
  // The importer has already filtered before ranking. Recheck against this catalog
  // as a defense against stale snapshots, without mutating either imported dataset.
  add(format.species[speciesId] ?? [], "usage");
  add(format.aggregate, "suggested");
  add([...legal], "suggested");
  return [slots[0] ?? emptySlot(), slots[1] ?? emptySlot(), slots[2] ?? emptySlot(), slots[3] ?? emptySlot()];
}

/** Plain text for both visible hints and accessible move-picker provenance. */
export function describeMoveSlot(slot: MoveSlot): string {
  if (!slot.moveId || slot.origin === "empty") return "Choose a move";
  if (slot.origin === "manual") return "Manually chosen";
  if (slot.origin === "imported") return "Imported from team paste";
  if (slot.origin === "suggested") return "Suggested, per-species usage unavailable for this move";
  if (!slot.gameType) return "Common Champions usage";
  const [year, month] = formats[slot.gameType].source.month.split("-");
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1];
  return `Common Champions ${slot.gameType} usage, ${monthName} ${year}`;
}
