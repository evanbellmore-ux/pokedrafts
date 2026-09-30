import snapshot from "@/data/champions/move-usage.json";
import { CROWNED_FORMS, HIDDEN_POWER_IVS, HIDDEN_POWER_TYPES, hiddenPowerType } from "./mechanics";
import { championsRuntime, cosmeticFamily, type BattleRuntime } from "./runtime";
import type { BattleBuild, ChampionsMove } from "./types";

export type MoveSlot = {
  moveId: string | null;
  /** usage: Champions usage; randomBattle: a native game's pinned Showdown Random Battle sets. */
  origin: "usage" | "randomBattle" | "suggested" | "required" | "manual" | "imported" | "empty";
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
 * usage statistics, in a native game the one pinned Showdown's Random Battle generator gave it most often
 * (catalog randomBattle, from the format its quick moves read), unless `usage` is false; otherwise
 * Showdown's first ability slot (0, 1, Hidden, Special), as its teambuilder fills in. Only abilities the
 * form has and the engine supports count; null when none does.
 */
export function usualAbility(speciesId: string, gameType: GameType, runtime: BattleRuntime = championsRuntime, { usage = true } = {}): string | null {
  const species = runtime.speciesById.get(speciesId);
  if (!species) return null;
  const usable = (id: string | undefined): id is string => !!id && species.abilities.includes(id) && !runtime.abilitiesById.get(id)?.unsupported.length;
  if (usage && runtime.profile.id === "champions") {
    const used = formats[gameType].abilities?.[usageRow(speciesId, runtime)];
    if (usable(used)) return used;
  } else if (usage && runtime.catalog.game !== "champions") {
    // Its own format's sets first, else the other one's, as createMoveSlots reads the rows.
    const sets = runtime.catalog.randomBattle?.formats ?? {};
    const own = sets[gameType] ?? sets.Singles;
    const generated = own?.abilities[speciesId] ?? (own === sets.Singles ? sets.Doubles : sets.Singles)?.abilities[speciesId];
    if (usable(generated)) return generated;
  }
  return (species.abilityOrder ?? species.abilities ?? []).find(usable) ?? null;
}

/** Power times accuracy; a move that never misses counts as 100% accurate. */
const stabStrength = (move: { power: number | string | null; accuracy: number | null }) => (typeof move.power === "number" ? move.power : 0) * (move.accuracy ?? 100);

/**
 * Attacks the native fill never suggests: recharge, self-KO or half-HP cost, two-turn charge and delayed
 * attacks, the calculator's history-based moves, and attacks that fail or deal nothing without battle
 * state a fresh build lacks. Random Battle rows may still name them.
 */
const NATIVE_FILL_EXCLUDED: ReadonlySet<string> = new Set([
  "blastburn", "eternabeam", "frenzyplant", "gigaimpact", "hydrocannon", "hyperbeam", "meteorassault", "prismaticlaser", "roaroftime", "rockwrecker",
  "explosion", "finalgambit", "mindblown", "mistyexplosion", "selfdestruct", "steelbeam",
  "electroshot", "freezeshock", "iceburn", "meteorbeam", "razorwind", "skullbash", "skyattack", "solarbeam", "solarblade", "doomdesire", "futuresight",
  "bide", "comeuppance", "counter", "echoedvoice", "fling", "furycutter", "iceball", "magnitude", "metalburst", "mirrorcoat", "present", "pursuit", "retaliate", "rollout", "spitup", "trumpcard",
  "terablast", "aurawheel", "belch", "dreameater", "focuspunch", "hyperspacefury", "lastresort", "naturalgift", "poltergeist", "shelltrap", "snore", "steelroller", "synchronoise", "upperhand",
]);

/** A fixed-power attack a fresh native build can calculate without more context, which the native fill may suggest. */
export function nativeFillCandidate(move: ChampionsMove): boolean {
  return typeof move.power === "number" && move.power > 0 && !move.unsupported.length && !move.ohko
    && !Array.isArray(move.multihit) && !move.id.startsWith("hiddenpower") && !NATIVE_FILL_EXCLUDED.has(move.id);
}

/** The attacking category a form fills with: its stronger one (Huge Power and Pure Power double Attack), or both when equal. */
function strongerCategories(speciesId: string, gameType: GameType, runtime: BattleRuntime): string[] {
  const species = runtime.speciesById.get(speciesId)!;
  const atk = species.baseStats.atk * (["hugepower", "purepower"].includes(usualAbility(speciesId, gameType, runtime) ?? "") ? 2 : 1);
  return atk > species.baseStats.spa ? ["Physical"] : species.baseStats.spa > atk ? ["Special"] : ["Physical", "Special"];
}

/** Exact proven learnsets, not engine support or base-form usage, determine eligibility. */
export function createMoveSlots(speciesId: string, gameType: GameType, runtime: BattleRuntime = championsRuntime): MoveSlots {
  const { speciesById, movesById } = runtime;
  const species = speciesById.get(speciesId);
  if (!species) return [emptySlot(), emptySlot(), emptySlot(), emptySlot()];
  // A Crowned Zacian or Zamazenta never uses Iron Head: its Behemoth move replaces it (pinned Showdown onBattleStart).
  const crowned = Object.values(CROWNED_FORMS).some((entry) => entry.form === speciesId);
  const legal = new Set(species.moves.filter((id) => {
    const move = movesById.get(id);
    return Boolean(id && move && move.category !== "Status" && !move.isZ && !move.isMax && !(crowned && id === "ironhead"));
  }).sort(compareIds));
  const selected = new Set<string>();
  const slots: MoveSlot[] = [];
  const add = (ids: readonly string[], origin: "usage" | "randomBattle" | "suggested" | "required", format: GameType = gameType) => {
    for (const moveId of ids) {
      if (slots.length === 4) break;
      if (!legal.has(moveId) || selected.has(moveId)) continue;
      selected.add(moveId);
      slots.push({ moveId, origin, gameType: format });
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
    const categories = strongerCategories(speciesId, gameType, runtime);
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
  } else if (runtime.catalog.game !== "champions") {
    // The native games read pinned Showdown's Random Battle sets. Gen 7 and 8 publish Singles sets only,
    // which Doubles then reads (and names); Scarlet/Violet reads the other format's row for a form that
    // one of its files leaves out.
    const sets = runtime.catalog.randomBattle?.formats ?? {};
    const own: GameType | null = sets[gameType] ? gameType : sets.Singles ? "Singles" : null;
    const other: GameType = own === "Singles" ? "Doubles" : "Singles";
    const rowFormat = own && sets[own]?.species[speciesId] ? own : sets[other]?.species[speciesId] ? other : null;
    if (rowFormat) add(sets[rowFormat]!.species[speciesId], "randomBattle", rowFormat);
    // Then, as in Champions, a same-type attack for each type the slots lack (by power x accuracy, in
    // the stronger category), and coverage by the format's Random Battle ranking, at most two of a type.
    const categories = strongerCategories(speciesId, gameType, runtime);
    const candidates = [...legal].filter((id) => nativeFillCandidate(movesById.get(id)!)).sort((a, b) => stabStrength(movesById.get(b)!) - stabStrength(movesById.get(a)!) || compareIds(a, b));
    const ofType = (type: string) => slots.filter((slot) => slot.moveId && movesById.get(slot.moveId)?.type === type).length;
    for (const type of species.types) {
      if (!ofType(type)) add(candidates.filter((id) => movesById.get(id)!.type === type && categories.includes(movesById.get(id)!.category)).slice(0, 1), "suggested");
    }
    const common = (own ? sets[own]!.aggregate : []).filter((id) => candidates.includes(id));
    for (const id of [...common.filter((move) => categories.includes(movesById.get(move)!.category)), ...common, ...candidates]) {
      if (ofType(movesById.get(id)!.type) < 2) add([id], "suggested");
    }
    add(candidates, "suggested");
  }
  // Typed Hidden Powers are base Hidden Power under a declared type (Unown learns nothing else); a fresh
  // build's IVs give one type, so the last resort never repeats base Hidden Power as other types.
  add([...legal].filter((id) => id === "hiddenpower" || !id.startsWith("hiddenpower")), "suggested");
  return [slots[0] ?? emptySlot(), slots[1] ?? emptySlot(), slots[2] ?? emptySlot(), slots[3] ?? emptySlot()];
}

/** The type of the typed Hidden Power a Random Battle row put in these slots (Magnezone's Ground), if any. */
export function quickHiddenPowerType(moves: MoveSlots): (typeof HIDDEN_POWER_TYPES)[number] | null {
  for (const slot of moves) {
    if (slot.origin !== "randomBattle" || !slot.moveId?.startsWith("hiddenpower")) continue;
    const type = HIDDEN_POWER_TYPES.find((entry) => slot.moveId === `hiddenpower${entry.toLowerCase()}`);
    if (type) return type;
  }
  return null;
}

/**
 * A fresh Ultra Sun/Ultra Moon build with these quick moves. A typed Hidden Power from the Random Battle
 * row calculates only with its type's IVs, which Showdown's team validator fills in for that set (HIDDEN_POWER_IVS): below level
 * 100 Hyper Training cannot keep 31s and change the type. So all-31 IVs take them; at the fresh level 50
 * with no EVs no stat changes. Any other build is returned as it is: imported, cached or edited IVs,
 * innate IVs and a declared Hidden Power type are never rewritten.
 */
export function withHiddenPowerIVs(build: BattleBuild, moves: MoveSlots, runtime: BattleRuntime = championsRuntime): BattleBuild {
  if (build.game === "champions" || runtime.profile.generation !== 7 || build.native.innateIVs || build.configuration?.hiddenPowerType
    || (build.native.level ?? 100) >= 100 || Object.values(build.native.ivs).some((iv) => iv !== 31)) return build;
  const type = quickHiddenPowerType(moves);
  if (!type || hiddenPowerType(build.native.ivs) === type) return build;
  return { ...build, native: { ...build.native, ivs: { ...build.native.ivs, ...HIDDEN_POWER_IVS[type] } } };
}

/** Plain text for both visible hints and accessible move-picker provenance. */
export function describeMoveSlot(slot: MoveSlot): string {
  if (!slot.moveId || slot.origin === "empty") return "Choose a move";
  if (slot.origin === "manual") return "Manually chosen";
  if (slot.origin === "imported") return "Imported from team paste";
  if (slot.origin === "suggested") return "Suggested, per-species usage unavailable for this move";
  if (slot.origin === "required") return "Required for this form";
  if (slot.origin === "randomBattle") return slot.gameType === "Doubles" ? "From Showdown's Random Doubles Battle sets" : "From Showdown's Random Battle sets (Singles)";
  if (!slot.gameType) return "Common Champions usage";
  const [year, month] = formats[slot.gameType].source.month.split("-");
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1];
  return `Common Champions ${slot.gameType} usage, ${monthName} ${year}`;
}
