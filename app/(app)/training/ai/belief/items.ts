// SPEC 10.1.1 Items, when closed (addendum A1.4: usage first, the role table as the fallback and for the usage's uncovered share).
import { getMegaOptions } from "@/app/lib/battle/mega-forms";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { SheetMember } from "../../model/sheet";
import { TYPE_NAMES, typeEffectiveness } from "../battle-facts";
import type { Weighted } from "./abilities";
import type { UsageSource } from "./usage";

/** The heaviest items kept per member (SPEC 10.1.1: the role table keeps its top 8; usage adds its own). */
export const ITEMS_KEPT = 10;
/** The least share left to the role table when a usage row exists (its top 12 items rarely cover every set). */
const RULE_FLOOR = 0.05;

const TYPE_BOOSTERS: Readonly<Record<string, string>> = {
  Fire: "charcoal", Water: "mysticwater", Grass: "miracleseed", Electric: "magnet", Ice: "nevermeltice", Fighting: "blackbelt",
  Poison: "poisonbarb", Ground: "softsand", Flying: "sharpbeak", Psychic: "twistedspoon", Bug: "silverpowder", Rock: "hardstone",
  Ghost: "spelltag", Dragon: "dragonfang", Dark: "blackglasses", Steel: "metalcoat", Normal: "silkscarf", Fairy: "fairyfeather",
};
/** The berry that halves a super-effective hit of each type (PS/data/items.ts onSourceModifyDamage, e.g. occaberry). */
export const RESIST_BERRY: Readonly<Record<string, string>> = {
  Fire: "occaberry", Water: "passhoberry", Electric: "wacanberry", Grass: "rindoberry", Ice: "yacheberry", Fighting: "chopleberry",
  Poison: "kebiaberry", Ground: "shucaberry", Flying: "cobaberry", Psychic: "payapaberry", Bug: "tangaberry", Rock: "chartiberry",
  Ghost: "kasibberry", Dragon: "habanberry", Dark: "colburberry", Steel: "babiriberry", Fairy: "roseliberry",
};
const SCREENS = new Set(["reflect", "lightscreen", "auroraveil"]);
const WEATHER_ROCKS: readonly { rock: string; abilities: string[]; moves: string[] }[] = [
  { rock: "heatrock", abilities: ["drought"], moves: ["sunnyday"] },
  { rock: "damprock", abilities: ["drizzle"], moves: ["raindance"] },
  { rock: "smoothrock", abilities: ["sandstream"], moves: ["sandstorm"] },
  { rock: "icyrock", abilities: ["snowwarning"], moves: ["snowscape", "hail"] },
];
const SURGES = new Set(["electricsurge", "grassysurge", "psychicsurge", "mistysurge"]);
const TERRAIN_MOVES = new Set(["electricterrain", "grassyterrain", "psychicterrain", "mistyterrain"]);
const MENTAL_HERB_USERS = new Set(["trickroom", "tailwind", "followme", "ragepowder"]);
/** Moves that lower their user's stats (White Herb restores them). */
const SELF_LOWERING = new Set(["closecombat", "dracometeor", "overheat", "leafstorm", "superpower", "makeitrain", "armorcannon", "headlongrush", "clangingscales"]);
const MINOR_ITEMS = ["widelens", "zoomlens", "quickclaw", "scopelens", "kingsrock", "shellbell", "redcard", "ejectbutton"];

/** The SPEC 10.1.1 role table for one species and its (believed) moves, normalised over the legal catalog items, top 8. */
export function ruleItems(speciesId: string, moves: readonly string[], runtime: BattleRuntime): Weighted[] {
  const species = runtime.speciesById.get(speciesId);
  if (!species) return [{ id: "", weight: 1 }];
  const base = species.baseStats;
  const known = moves.map((id) => runtime.movesById.get(id)).filter((move) => !!move);
  const damaging = known.filter((move) => move.category !== "Status");
  const status = known.filter((move) => move.category === "Status");
  const weights = new Map<string, number>();
  const add = (id: string, weight: number) => { if (runtime.itemsById.has(id) && weight > 0) weights.set(id, (weights.get(id) ?? 0) + weight); };
  const stones = getMegaOptions(speciesId, runtime).filter((option) => option.baseSpeciesId === speciesId);
  for (const option of stones) add(option.itemId, 3 / stones.length);
  add("sitrusberry", 1);
  if (moves.some((id) => SCREENS.has(id))) add("lightclay", 1.5);
  for (const { rock, abilities, moves: setters } of WEATHER_ROCKS) {
    if (species.abilities.some((id) => abilities.includes(id)) || moves.some((id) => setters.includes(id))) add(rock, 1);
  }
  if (species.abilities.some((id) => SURGES.has(id)) || moves.some((id) => TERRAIN_MOVES.has(id))) add("terrainextender", 0.8);
  add("focussash", 0.6 * (base.hp + base.def + base.spd <= 240 && base.spe >= 80 ? 2 : 1));
  add("lifeorb", 0.6 * (damaging.length >= 3 ? 1.5 : 1));
  add("choicescarf", 0.5 * (damaging.length === 4 && base.spe >= 60 && base.spe <= 100 ? 1.5 : 1) * (status.length ? 0.1 : 1));
  const types = new Map<string, number>();
  for (const move of damaging) types.set(move.type, (types.get(move.type) ?? 0) + 1);
  const common = [...types].sort((a, b) => b[1] - a[1] || TYPE_NAMES.indexOf(a[0] as never) - TYPE_NAMES.indexOf(b[0] as never))[0]?.[0];
  if (common && TYPE_BOOSTERS[common]) add(TYPE_BOOSTERS[common], 0.5);
  add("leftovers", 0.4);
  add("lumberry", 0.4);
  if (moves.some((id) => MENTAL_HERB_USERS.has(id))) add("mentalherb", 0.4);
  let worst: string | null = null, worstMultiplier = 1;
  for (const type of TYPE_NAMES) {
    const multiplier = typeEffectiveness(type, species.types);
    if (multiplier > worstMultiplier && RESIST_BERRY[type]) { worst = type; worstMultiplier = multiplier; }
  }
  if (worst) add(RESIST_BERRY[worst], 0.4);
  add("rockyhelmet", 0.3 * (base.def >= 100 ? 2 : 1));
  if (moves.some((id) => SELF_LOWERING.has(id))) add("whiteherb", 0.3);
  add("expertbelt", 0.3);
  if ((species.types.includes("Steel") || species.types.includes("Electric")) && !species.abilities.includes("levitate")) add("airballoon", 0.2);
  for (const id of MINOR_ITEMS) add(id, 0.1);
  const ranked = [...weights].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8);
  const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
  return ranked.map(([id, weight]) => ({ id, weight: weight / total }));
}

/**
 * Open: the sheet's item. Closed: the member's usage items (each row's list, Mega rows holding their stone) for the share
 * of sets they cover (at most 1 − RULE_FLOOR), the role table for the rest; the role table alone without usage. Item
 * Clause: items in `taken` (shown on another member) are left out. Normalised, heaviest first, top ITEMS_KEPT.
 */
export function itemPrior(member: SheetMember, moves: readonly string[], source: UsageSource, taken: ReadonlySet<string>, runtime: BattleRuntime): Weighted[] {
  if (member.itemId !== null) return [{ id: member.itemId, weight: 1 }];
  const usage = new Map<string, number>();
  for (const { row, share } of source.rows) {
    for (const entry of row.items) if (entry.id === "" || runtime.itemsById.has(entry.id)) usage.set(entry.id, (usage.get(entry.id) ?? 0) + share * entry.weight);
  }
  const covered = Math.min(1 - RULE_FLOOR, [...usage.values()].reduce((sum, weight) => sum + weight, 0));
  const usageTotal = [...usage.values()].reduce((sum, weight) => sum + weight, 0);
  const weights = new Map<string, number>();
  if (usageTotal > 0) for (const [id, weight] of usage) weights.set(id, covered * weight / usageTotal);
  for (const entry of ruleItems(member.speciesId, moves, runtime)) weights.set(entry.id, (weights.get(entry.id) ?? 0) + (1 - (usageTotal > 0 ? covered : 0)) * entry.weight);
  const ranked = [...weights].filter(([id]) => id === "" || !taken.has(id)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, ITEMS_KEPT);
  const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
  return total > 0 ? ranked.map(([id, weight]) => ({ id, weight: weight / total })) : [{ id: "", weight: 1 }];
}
