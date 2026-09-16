import { abilitiesById, itemsById, movesById, speciesById } from "./catalog";
import type {
  BattleBuild,
  BattleConditions,
  BattleStat,
  BuildIssue,
  CombatStat,
  MoveDamageResult,
  SideConditions,
  StatTable,
} from "./types";

export const STATS: readonly BattleStat[] = ["hp", "atk", "def", "spa", "spd", "spe"];
export const COMBAT_STATS: readonly CombatStat[] = ["atk", "def", "spa", "spd", "spe"];
export const STAT_LABELS: Record<BattleStat, string> = {
  hp: "HP", atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed",
};

export const NATURES: { name: string; plus: CombatStat | null; minus: CombatStat | null }[] = [
  { name: "Hardy", plus: null, minus: null },
  { name: "Lonely", plus: "atk", minus: "def" },
  { name: "Brave", plus: "atk", minus: "spe" },
  { name: "Adamant", plus: "atk", minus: "spa" },
  { name: "Naughty", plus: "atk", minus: "spd" },
  { name: "Bold", plus: "def", minus: "atk" },
  { name: "Docile", plus: null, minus: null },
  { name: "Relaxed", plus: "def", minus: "spe" },
  { name: "Impish", plus: "def", minus: "spa" },
  { name: "Lax", plus: "def", minus: "spd" },
  { name: "Timid", plus: "spe", minus: "atk" },
  { name: "Hasty", plus: "spe", minus: "def" },
  { name: "Serious", plus: null, minus: null },
  { name: "Jolly", plus: "spe", minus: "spa" },
  { name: "Naive", plus: "spe", minus: "spd" },
  { name: "Modest", plus: "spa", minus: "atk" },
  { name: "Mild", plus: "spa", minus: "def" },
  { name: "Quiet", plus: "spa", minus: "spe" },
  { name: "Bashful", plus: null, minus: null },
  { name: "Rash", plus: "spa", minus: "spd" },
  { name: "Calm", plus: "spd", minus: "atk" },
  { name: "Gentle", plus: "spd", minus: "def" },
  { name: "Sassy", plus: "spd", minus: "spe" },
  { name: "Careful", plus: "spd", minus: "spa" },
  { name: "Quirky", plus: null, minus: null },
];

export const STATUSES = [
  { value: "", label: "Healthy" }, { value: "brn", label: "Burned" },
  { value: "par", label: "Paralyzed" }, { value: "psn", label: "Poisoned" },
  { value: "tox", label: "Badly poisoned" }, { value: "slp", label: "Asleep" },
  { value: "frz", label: "Frozen" },
] as const;

export const ABILITY_ACTIVATION_LABELS: Record<string, string> = {
  intimidate: "Apply Intimidate on entry",
  flashfire: "Flash Fire has been activated",
  electromorphosis: "Electromorphosis is charged",
  unburden: "Unburden has been activated",
  plus: "A partner with Plus or Minus is present",
  minus: "A partner with Plus or Minus is present",
  stakeout: "The defender just switched in",
  slowstart: "Slow Start is still active",
  analytic: "The target switches before this attack",
  protean: "Protean is unused since switch-in; typing is still unchanged",
  libero: "Libero is unused since switch-in; typing is still unchanged",
};

export function defaultAbilityActive(abilityId: string): boolean {
  return ["slowstart", "protean", "libero"].includes(abilityId);
}

export function parseIntegerInput(text: string): number | null {
  if (!/^-?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

export function createBuild(speciesId = "charizard"): BattleBuild {
  const species = speciesById.get(speciesId);
  const abilityId = species?.abilities.find((id) => !abilitiesById.get(id)?.unsupported.length)
    ?? species?.abilities[0] ?? "";
  return {
    speciesId,
    nature: "Serious",
    abilityId,
    abilityActive: defaultAbilityActive(abilityId),
    itemId: species?.requiredItem ?? "",
    points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    currentHP: null,
    status: "",
  };
}

export function createSide(): SideConditions {
  return { reflect: false, lightScreen: false, auroraVeil: false, helpingHand: false };
}

export function createConditions(): BattleConditions {
  return {
    gameType: "Doubles", weather: "", terrain: "", critical: false, multipleTargets: true,
    attackerSide: createSide(), defenderSide: createSide(),
  };
}

/** Champions training stats, before in-battle stages/abilities/items. */
export function getBuildStats(build: BattleBuild): StatTable | null {
  const species = speciesById.get(build.speciesId);
  const nature = NATURES.find((entry) => entry.name === build.nature);
  if (!species || !nature || STATS.some((stat) => !isIntegerWithin(build.points[stat], 0, 32))) return null;
  const stats = {} as StatTable;
  for (const stat of STATS) {
    const base = species.baseStats[stat];
    const points = build.points[stat] as number;
    if (stat === "hp") stats.hp = base === 1 ? 1 : base + points + 75;
    else {
      const multiplier = nature.plus === stat ? 1.1 : nature.minus === stat ? 0.9 : 1;
      stats[stat] = Math.floor((base + points + 20) * multiplier);
    }
  }
  return stats;
}

function isIntegerWithin(value: number | null, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function validateBuild(build: BattleBuild): BuildIssue[] {
  const issues: BuildIssue[] = [];
  const species = speciesById.get(build.speciesId);
  if (!species) return [{ field: "speciesId", message: "Select a Pokémon from the Champions catalog." }];
  for (const reason of species.unsupported) issues.push({ field: "speciesId", message: reason });

  for (const stat of STATS) {
    if (!isIntegerWithin(build.points[stat], 0, 32)) {
      issues.push({ field: `points.${stat}`, message: `${STAT_LABELS[stat]} needs a whole number from 0 to 32.` });
    }
  }
  const points = STATS.reduce((total, stat) => total + (Number.isFinite(build.points[stat]) ? build.points[stat]! : 0), 0);
  if (points > 66) issues.push({ field: "points", message: `Use at most 66 Stat Points (${points} allocated).` });
  if (!NATURES.some((nature) => nature.name === build.nature)) issues.push({ field: "nature", message: "Select a valid nature." });

  const ability = abilitiesById.get(build.abilityId);
  if (!ability || !species.abilities.includes(build.abilityId)) {
    issues.push({ field: "abilityId", message: "Select an ability available to this Pokémon in Champions." });
  } else {
    for (const reason of ability.unsupported) issues.push({ field: "abilityId", message: reason });
  }
  if (["protean", "libero"].includes(build.abilityId) && !build.abilityActive) {
    issues.push({ field: "abilityActive", message: "Only unused Protean/Libero with unchanged typing is supported. Previously changed typing needs additional battle context." });
  }
  if (build.itemId) {
    const item = itemsById.get(build.itemId);
    if (!item) issues.push({ field: "itemId", message: "Select a held item from the Champions catalog." });
    else for (const reason of item.unsupported) issues.push({ field: "itemId", message: reason });
  }
  if (species.requiredItem && species.requiredItem !== build.itemId) {
    issues.push({ field: "itemId", message: `${species.name} requires ${itemsById.get(species.requiredItem)?.name ?? species.requiredItem}.` });
  }
  for (const stat of COMBAT_STATS) {
    if (!isIntegerWithin(build.boosts[stat], -6, 6)) {
      issues.push({ field: `boosts.${stat}`, message: `${STAT_LABELS[stat]} stages must be a whole number from −6 to +6.` });
    }
  }
  if (!STATUSES.some((status) => status.value === build.status)) issues.push({ field: "status", message: "Select a valid battle status." });
  const stats = getBuildStats(build);
  if (build.currentHP !== null && !isIntegerWithin(build.currentHP, 1, stats?.hp ?? Number.MAX_SAFE_INTEGER)) {
    issues.push({ field: "currentHP", message: `Current HP must be a whole number from 1 to ${stats?.hp ?? "maximum HP"}, or blank for full HP.` });
  }
  return issues;
}

export function validateConditions(field: BattleConditions): BuildIssue[] {
  const issues: BuildIssue[] = [];
  if (!["Singles", "Doubles"].includes(field.gameType)) issues.push({ field: "gameType", message: "Select Singles or Doubles." });
  if (!["", "Sun", "Rain", "Sand", "Snow"].includes(field.weather)) issues.push({ field: "weather", message: "Select a supported weather condition." });
  if (!["", "Electric", "Grassy", "Misty", "Psychic"].includes(field.terrain)) issues.push({ field: "terrain", message: "Select a supported terrain." });
  return issues;
}

export type DamageSort = "minimum" | "maximum" | "name";

export function rankResults(results: MoveDamageResult[], sort: DamageSort = "minimum"): MoveDamageResult[] {
  return [...results].sort((a, b) => {
    const nameA = movesById.get(a.moveId)?.name ?? a.moveId;
    const nameB = movesById.get(b.moveId)?.name ?? b.moveId;
    if (sort === "name") return nameA.localeCompare(nameB, "en");
    const calculable = Number(b.kind === "calculated") - Number(a.kind === "calculated");
    if (calculable) return calculable;
    const primary = sort === "minimum" ? "min" : "max";
    const secondary = sort === "minimum" ? "max" : "min";
    return (b[primary] ?? -1) - (a[primary] ?? -1)
      || (b[secondary] ?? -1) - (a[secondary] ?? -1)
      || nameA.localeCompare(nameB, "en");
  });
}
