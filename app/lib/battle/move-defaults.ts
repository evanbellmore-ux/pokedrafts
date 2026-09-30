import snapshot from "@/data/champions/move-usage.json";
import { championsRuntime, cosmeticFamily, type BattleRuntime } from "./runtime";

export type MoveSlot = {
  moveId: string | null;
  origin: "usage" | "suggested" | "required" | "manual" | "imported" | "empty";
  gameType: "Singles" | "Doubles" | null;
};
export type MoveSlots = [MoveSlot, MoveSlot, MoveSlot, MoveSlot];

type GameType = "Singles" | "Doubles";
type FormatUsage = {
  source: { month: string };
  species: Record<string, readonly string[]>;
  /** Each form's most-used ability (raw weight among its catalog abilities). */
  abilities?: Record<string, string>;
  aggregate: readonly string[];
};
const formats: Record<GameType, FormatUsage> = snapshot.formats;
const emptySlot = (): MoveSlot => ({ moveId: null, origin: "empty", gameType: null });
/**
 * The one explicit exception to "no base-form usage". Smogon's Champions usage has a
 * single Maushold row and no Maushold-Four row (the importer reports no unmatched
 * species). Family of Four has the same learnset, stats, types and abilities; only its
 * weight differs. League rosters name it plain "Maushold", so it reuses that row.
 */
const USAGE_ROWS: Readonly<Record<string, string>> = { mausholdfour: "maushold" };
/**
 * The usage row a form reads. Smogon's statistics count cosmetic forms under their family (the
 * source has only Vivillon, Alcremie, Florges and Furfrou rows), so those forms read the family's.
 */
const usageRow = (speciesId: string, runtime: BattleRuntime) => USAGE_ROWS[speciesId] ?? cosmeticFamily(runtime, speciesId)?.id ?? speciesId;
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/**
 * The usual ability for a fresh build of this form: in Champions the most-used one in the format's
 * usage statistics (unless `usage` is false), otherwise Showdown's first ability slot (0, 1, Hidden,
 * Special), as its teambuilder fills in. Only abilities the form has and the engine supports count;
 * null when none does.
 */
export function usualAbility(speciesId: string, gameType: GameType, runtime: BattleRuntime = championsRuntime, { usage = true } = {}): string | null {
  const species = runtime.speciesById.get(speciesId);
  if (!species) return null;
  const usable = (id: string | undefined): id is string => !!id && species.abilities.includes(id) && !runtime.abilitiesById.get(id)?.unsupported.length;
  if (usage && runtime.profile.id === "champions") {
    const used = formats[gameType].abilities?.[usageRow(speciesId, runtime)];
    if (usable(used)) return used;
  }
  return (species.abilityOrder ?? species.abilities ?? []).find(usable) ?? null;
}

/** Power times accuracy; a move that never misses counts as 100% accurate. */
const stabStrength = (move: { power: number | string | null; accuracy: number | null }) => (typeof move.power === "number" ? move.power : 0) * (move.accuracy ?? 100);

/** Exact proven learnsets, not engine support or base-form usage, determine eligibility. */
export function createMoveSlots(speciesId: string, gameType: GameType, runtime: BattleRuntime = championsRuntime): MoveSlots {
  const { speciesById, movesById } = runtime;
  const species = speciesById.get(speciesId);
  if (!species) return [emptySlot(), emptySlot(), emptySlot(), emptySlot()];
  const legal = new Set(species.moves.filter((id) => {
    const move = movesById.get(id);
    return Boolean(id && move && move.category !== "Status" && !move.isZ && !move.isMax);
  }).sort(compareIds));
  const selected = new Set<string>();
  const slots: MoveSlot[] = [];
  const add = (ids: readonly string[], origin: "usage" | "suggested" | "required") => {
    for (const moveId of ids) {
      if (slots.length === 4) break;
      if (!legal.has(moveId) || selected.has(moveId)) continue;
      selected.add(moveId);
      slots.push({ moveId, origin, gameType });
    }
  };
  // A form that only exists with a prepared move (Showdown requiredMove, e.g. Keldeo-Resolute's
  // Secret Sword) starts with it, so its first calculation is not blocked.
  if (species.requiredMove) add([species.requiredMove], "required");
  const format = formats[gameType];
  // The importer has already filtered before ranking. Recheck against this catalog
  // as a defense against stale snapshots, without mutating either imported dataset.
  if (runtime.profile.id === "champions") {
    add(format.species[usageRow(speciesId, runtime)] ?? [], "usage");
    // A form without four usage moves (Reg M-C newcomers have none) gets a same-type attack for each
    // of its types the slots lack: the format's most-used one it learns, in its stronger attacking
    // category (either when they are equal), before the format-wide fill.
    const rank = new Map(format.aggregate.map((id, index) => [id, index]));
    // Huge Power and Pure Power double Attack.
    const atk = species.baseStats.atk * (["hugepower", "purepower"].includes(usualAbility(speciesId, gameType, runtime) ?? "") ? 2 : 1);
    const categories = atk > species.baseStats.spa ? ["Physical"] : species.baseStats.spa > atk ? ["Special"] : ["Physical", "Special"];
    for (const type of species.types) {
      if (slots.some((slot) => slot.moveId && movesById.get(slot.moveId)?.type === type)) continue;
      const stab = [...legal].filter((id) => {
        const move = movesById.get(id)!;
        return move.type === type && categories.includes(move.category) && typeof move.power === "number" && move.power > 0 && !move.unsupported.length;
      });
      stab.sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || stabStrength(movesById.get(b)!) - stabStrength(movesById.get(a)!) || compareIds(a, b));
      add(stab.slice(0, 1), "suggested");
    }
    add(format.aggregate, "suggested");
  }
  add([...legal], "suggested");
  return [slots[0] ?? emptySlot(), slots[1] ?? emptySlot(), slots[2] ?? emptySlot(), slots[3] ?? emptySlot()];
}

/** Plain text for both visible hints and accessible move-picker provenance. */
export function describeMoveSlot(slot: MoveSlot): string {
  if (!slot.moveId || slot.origin === "empty") return "Choose a move";
  if (slot.origin === "manual") return "Manually chosen";
  if (slot.origin === "imported") return "Imported from team paste";
  if (slot.origin === "suggested") return "Suggested, per-species usage unavailable for this move";
  if (slot.origin === "required") return "Required for this form";
  if (!slot.gameType) return "Common Champions usage";
  const [year, month] = formats[slot.gameType].source.month.split("-");
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1];
  return `Common Champions ${slot.gameType} usage, ${monthName} ${year}`;
}
