import { championsRuntime, type BattleRuntime } from "./runtime";
import { heldItemForm, specialTeraForm, validateMechanic } from "./mechanics";
export { CROWNED_FORMS, heldItemForm } from "./mechanics";
import { imposterTransforms, NO_TRACE_ABILITIES, tracedAbility } from "./imposter";
import type {
  BattleBuild,
  BattleConditions,
  BattleStat,
  BuildIssue,
  CombatStat,
  ChampionsBuild,
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
  flashfire: "Flash Fire has been activated",
  electromorphosis: "Electromorphosis is charged",
  unburden: "Unburden has been activated",
  plus: "A partner with Plus or Minus is present",
  minus: "A partner with Plus or Minus is present",
  stakeout: "The defender just switched in",
  slowstart: "Slow Start is still active",
  analytic: "The target switches before this attack",
  protean: "Protean unused since switch-in",
  libero: "Libero unused since switch-in",
  imposter: "Transformed into the other Pokémon on entry",
  shieldsdown: "Its HP crossed half this turn",
  schooling: "Its HP crossed a quarter this turn",
};

/**
 * Scarlet/Violet's once-per-battle entry boosts: pinned Showdown raises the stage on the Pokémon's
 * first entry only (swordBoost / shieldBoost), and the gen 9 engine applies them only when ticked.
 * Sword/Shield raises them on every entry, which its engine always applies, so there is no switch.
 */
const SV_ENTRY_BOOST_LABELS: Record<string, string> = {
  intrepidsword: "Intrepid Sword has raised Attack",
  dauntlessshield: "Dauntless Shield has raised Defense",
};

/** The condition an ability's switch sets in this game, if it has one. Schooling has none below level 20. */
export function abilityActivationLabel(abilityId: string, profileId: string, context?: { level?: number }): string | undefined {
  if (abilityId === "schooling" && context?.level !== undefined && context.level < 20) return undefined;
  return ABILITY_ACTIVATION_LABELS[abilityId] ?? (profileId === "scarlet_violet" ? SV_ENTRY_BOOST_LABELS[abilityId] : undefined);
}

/** Terrain Seeds: the terrain that uses each one up and the stat it raises (pinned Showdown data/items.ts). */
export const SEED_TERRAINS: Readonly<Record<string, { terrain: BattleConditions["terrain"]; stat: "def" | "spd" }>> = {
  grassyseed: { terrain: "Grassy", stat: "def" }, electricseed: { terrain: "Electric", stat: "def" },
  psychicseed: { terrain: "Psychic", stat: "spd" }, mistyseed: { terrain: "Misty", stat: "spd" },
};

/**
 * The held item whose Magic Room timing is a choice (the build's itemUsedBeforeRoom), or null: a
 * terrain Seed on its terrain, Room Service under Trick Room, or a Protosynthesis / Quark Drive
 * holder's Booster Energy that neither
 * its own field (sun without Cloud Nine or Air Lock, Electric Terrain) nor the other Pokémon's
 * Neutralizing Gas (Ability Shield is suppressed by the room too) decides. Pinned Showdown uses both
 * at once on entry, and a Seed also when its terrain starts, unless the room is already up; a room set
 * later does not undo them. An active Klutz never lets either act.
 */
export function roomItemChoice(build: BattleBuild, other: BattleBuild, field: BattleConditions): string | null {
  if (build.transformedFrom) return null;
  // The ability it has after entry: a Klutz copied by Trace or Imposter never lets the item act either.
  const ability = build.abilityId === "trace" ? tracedAbility(build, other, field.magicRoom).abilityId ?? "trace"
    : imposterTransforms(build, other, field.magicRoom) ? other.abilityId : build.abilityId;
  if (ability === "klutz" && !(other.abilityId === "neutralizinggas" && build.itemId !== "abilityshield")) return null;
  const seedOrService = (field.terrain && SEED_TERRAINS[build.itemId]?.terrain === field.terrain) || (field.trickRoom && build.itemId === "roomservice");
  const fieldOn = build.abilityId === "protosynthesis"
    ? field.weather === "Sun" && ![build, other].some((entry) => ["cloudnine", "airlock"].includes(entry.abilityId))
    : field.terrain === "Electric";
  // With its field up the field switch decides (fieldItemChoice), a held-back Booster included.
  const booster = ["protosynthesis", "quarkdrive"].includes(build.abilityId) && build.itemId === "boosterenergy" && !fieldOn && other.abilityId !== "neutralizinggas";
  // Without Magic Room only an unticked switch is shown: the item it held back stays held after the room ends.
  if (!field.magicRoom) return (seedOrService || booster) && build.itemUsedBeforeRoom === false ? build.itemId : null;
  return seedOrService || booster ? build.itemId : null;
}

/** The switch label for roomItemChoice's item; without Magic Room, one it held back that has since ended. */
export function roomItemLabel(itemId: string, runtime: BattleRuntime = championsRuntime, magicRoom = true): string {
  const name = runtime.itemsById.get(itemId)?.name ?? itemId;
  const seed = SEED_TERRAINS[itemId];
  const where = seed ? `on ${seed.terrain} Terrain` : itemId === "roomservice" ? "under Trick Room" : "on entry,";
  return magicRoom ? `Its ${name} was used ${where} before Magic Room was set` : `Its ${name} was used ${where.replace(/,$/, "")}`;
}

/**
 * The stat Protosynthesis or Quark Drive boosts (pinned Showdown getBestStat(false, true)): the highest
 * stat with its stages; under Wonder Room each defensive stat uses the other's stage. Ties go to Attack,
 * Defense, Sp. Atk, Sp. Def, Speed in order.
 */
export function paradoxBestStat(stats: StatTable, stage: (stat: CombatStat) => number, wonderRoom: boolean): CombatStat {
  const swapped = { def: "spd", spd: "def" } as const;
  let best: CombatStat = "atk";
  let bestValue = 0;
  for (const stat of COMBAT_STATS) {
    const boost = stage(wonderRoom && (stat === "def" || stat === "spd") ? swapped[stat] : stat);
    const value = boost >= 0 ? Math.floor(stats[stat] * (2 + boost) / 2) : Math.floor(stats[stat] * 2 / (2 - boost));
    if (value > bestValue) { best = stat; bestValue = value; }
  }
  return best;
}

/** The sun or terrain abilities that set each paradox ability's field on entry (switch-in priority 0). */
export const PARADOX_FIELD_SETTERS: Readonly<Record<"sun" | "terrain", readonly string[]>> = {
  sun: ["drought", "orichalcumpulse"], terrain: ["electricsurge", "hadronengine"],
};

/** A Protosynthesis or Quark Drive holder's item timing against its field (the build's itemUsedBeforeField). */
export type FieldItemChoice = {
  itemId: string; abilityId: "protosynthesis" | "quarkdrive"; field: "sun" | "terrain"; checked: boolean;
  /** The other Pokémon's Cloud Nine or Air Lock that keeps the sun from Protosynthesis (its Booster Energy's timing). */
  suppressor?: string;
};

/**
 * The held item whose timing against the sun or Electric Terrain that activates Protosynthesis or Quark
 * Drive is a choice (the build's itemUsedBeforeField), with the switch's state, or null. Pinned Showdown:
 * Booster Energy acts whenever its field is down after the holder has entered (boosterenergy onUpdate),
 * so it is used up when the field started after the holder entered or ended while it was out, and never
 * when Magic Room was up at entry; when the terrain or weather changes, each Pokémon's ability runs
 * before its item, so the ability picks its stat before a Seed (or Room Service) it had not used yet.
 * Offered for a Booster Energy (the item is used up or still held), and for a Seed on its terrain or
 * Room Service under Trick Room when the order changes the stat. Unset, the Booster Energy is held and a
 * Seed or Room Service came first, unless the other Pokémon's ability set the field as both entered
 * (settleItems foeSetsField). The other Pokémon's Neutralizing Gas stops the ability, so nothing is offered.
 * With the sun up and the other Pokémon's Cloud Nine or Air Lock out, the Booster Energy's choice is
 * whether it activated Protosynthesis (checked) or the sun did before that ability came in, which used the
 * Booster Energy up with no effect (its volatile already existed) and then ended Protosynthesis.
 */
export function fieldItemChoice(build: BattleBuild, other: BattleBuild, field: BattleConditions, runtime: BattleRuntime = championsRuntime): FieldItemChoice | null {
  const abilityId = build.abilityId;
  if (build.transformedFrom || (abilityId !== "protosynthesis" && abilityId !== "quarkdrive") || other.abilityId === "neutralizinggas") return null;
  const paradox = abilityId === "protosynthesis" ? "sun" : "terrain";
  const fieldOn = paradox === "sun"
    ? field.weather === "Sun" && ![build, other].some((entry) => ["cloudnine", "airlock"].includes(entry.abilityId))
    : field.terrain === "Electric";
  const choice = (checked: boolean): FieldItemChoice => ({ itemId: build.itemId, abilityId, field: paradox, checked });
  // With the other Pokémon's Cloud Nine or Air Lock out, whatever the weather or room now: the outcome
  // stays after the sun ends or a Magic Room is set. One that met a Magic Room on entry never acts (the
  // room switch decides).
  if (paradox === "sun" && ["cloudnine", "airlock"].includes(other.abilityId) && build.itemId === "boosterenergy"
    && build.itemUsedBeforeRoom !== false) return { ...choice(build.itemUsedBeforeField !== false), suppressor: other.abilityId };
  if (!fieldOn) return null;
  // One the room held back on entry is shown unticked; ticking it also clears that (PokemonPanel).
  if (build.itemId === "boosterenergy") return choice(build.itemUsedBeforeField === true && build.itemUsedBeforeRoom !== false);
  // A Seed or Room Service the room held back is never used, so its order changes nothing.
  const seed = SEED_TERRAINS[build.itemId]?.terrain === field.terrain && field.terrain ? SEED_TERRAINS[build.itemId] : null;
  const roomService = build.itemId === "roomservice" && field.trickRoom;
  if ((!seed && !roomService) || build.itemUsedBeforeRoom === false) return null;
  const checked = build.itemUsedBeforeField ?? !PARADOX_FIELD_SETTERS[paradox].includes(other.abilityId);
  const stats = getBuildStats(build, runtime);
  if (!stats) return null;
  // Its own item's change: a paradox holder has neither Contrary nor Simple.
  const change = seed ? { [seed.stat]: 1 } : { spe: -1 };
  const pick = (withItem: boolean) => paradoxBestStat(stats, (stat) => Math.max(-6, Math.min(6, (build.boosts[stat] ?? 0) + (withItem ? (change as Partial<Record<CombatStat, number>>)[stat] ?? 0 : 0))), field.wonderRoom);
  // Shown when the order changes the stat, or to undo a choice made earlier.
  return pick(true) !== pick(false) || build.itemUsedBeforeField !== undefined ? choice(checked) : null;
}

/** The switch label for fieldItemChoice. */
export function fieldItemLabel(choice: FieldItemChoice, runtime: BattleRuntime = championsRuntime): string {
  const name = runtime.itemsById.get(choice.itemId)?.name ?? choice.itemId;
  if (choice.suppressor) return "Its Booster Energy activated Protosynthesis";
  if (choice.itemId === "boosterenergy") return `Its Booster Energy was used while ${choice.field === "sun" ? "the sun" : "Electric Terrain"} was down`;
  return `Its ${name} was used before ${runtime.abilitiesById.get(choice.abilityId)?.name ?? choice.abilityId} activated`;
}

/** Ability conditions that need an ally, so they never hold in Singles. */
export const PARTNER_ABILITY_CONDITIONS: ReadonlySet<string> = new Set(["plus", "minus"]);

/**
 * Abilities that stop a foe's priority move aimed at the holder or its ally (pinned Showdown
 * data/abilities.ts queenlymajesty, dazzling and armortail onFoeTryMove), set on a side as its
 * partner's (SideConditions.priorityShield).
 */
export const PRIORITY_SHIELD_ABILITIES = ["queenlymajesty", "dazzling", "armortail"] as const;

/** The priority-shield abilities the game has, for labels: "Queenly Majesty or Armor Tail" in Champions. */
export function priorityShieldNames(runtime: BattleRuntime = championsRuntime): string {
  return joinOr(PRIORITY_SHIELD_ABILITIES.flatMap((id) => runtime.abilitiesById.get(id)?.name ?? []));
}

const joinOr = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;

/**
 * Singles has no ally, so Helping Hand (it fails with [notarget] in pinned Showdown), an
 * additional Fairy Aura source and a Plus/Minus partner cannot exist there. Returns what the
 * calculation uses and the names of the Doubles-only settings it ignored.
 */
export function withoutSinglesPartners<B extends BattleBuild>(field: BattleConditions, attacker: B, defender: B, runtime: BattleRuntime = championsRuntime) {
  if (field.gameType !== "Singles") return { field, attacker, defender, ignored: [] as string[] };
  const ignored: string[] = [];
  if (field.attackerSide.helpingHand || field.defenderSide.helpingHand) ignored.push("Helping Hand");
  if (field.attackerSide.friendGuard || field.defenderSide.friendGuard) ignored.push("the Friend Guard partner");
  if (field.attackerSide.priorityShield || field.defenderSide.priorityShield) ignored.push(`the ${priorityShieldNames(runtime)} partner`);
  if (field.fairyAura) ignored.push("Additional Fairy Aura on the field");
  const partnerless = (build: B): B => PARTNER_ABILITY_CONDITIONS.has(build.abilityId) && build.abilityActive ? { ...build, abilityActive: false } : build;
  if (partnerless(attacker) !== attacker || partnerless(defender) !== defender) ignored.push("the Plus/Minus partner");
  return {
    field: {
      ...field, fairyAura: false,
      attackerSide: { ...field.attackerSide, helpingHand: false, friendGuard: false, priorityShield: false },
      defenderSide: { ...field.defenderSide, helpingHand: false, friendGuard: false, priorityShield: false },
    },
    attacker: partnerless(attacker), defender: partnerless(defender), ignored,
  };
}

export function defaultAbilityActive(abilityId: string): boolean {
  return ["slowstart", "protean", "libero", "imposter", "intrepidsword", "dauntlessshield"].includes(abilityId);
}

export function parseIntegerInput(text: string): number | null {
  if (!/^-?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/** A fresh build with the form's usual ability (move-defaults usualAbility) instead of the sorted first one. */
export function withUsualAbility<T extends BattleBuild>(build: T, abilityId: string | null): T {
  return abilityId && abilityId !== build.abilityId ? { ...build, abilityId, abilityActive: defaultAbilityActive(abilityId) } : build;
}

export function createBuild(speciesId?: string): ChampionsBuild;
export function createBuild(speciesId: string, runtime: BattleRuntime): BattleBuild;
export function createBuild(speciesId = "charizard", runtime: BattleRuntime = championsRuntime): BattleBuild {
  const species = runtime.speciesById.get(speciesId);
  const abilityId = species?.abilities.find((id) => !runtime.abilitiesById.get(id)?.unsupported.length)
    ?? species?.abilities[0] ?? "";
  const base = {
    speciesId,
    nature: "Serious",
    abilityId,
    abilityActive: defaultAbilityActive(abilityId),
    itemId: species?.requiredItem ?? species?.requiredItems?.[0] ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    currentHP: null,
    status: "" as const,
  };
  const zero = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  return runtime.profile.id === "champions"
    ? { ...base, game: "champions", points: zero }
    : {
      ...base, game: runtime.profile.id,
      native: { level: 50, evs: zero, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } },
      ...(species?.requiredTeraType ? { configuration: { teraType: species.requiredTeraType } } : {}),
    };
}

export function createSide(): SideConditions {
  return { reflect: false, lightScreen: false, auroraVeil: false, helpingHand: false, friendGuard: false, priorityShield: false, protect: false, tailwind: false, charge: false };
}

export const SHARED_FIELD_EFFECTS = [
  { key: "gravity", label: "Gravity" },
  { key: "trickRoom", label: "Trick Room" },
  { key: "wonderRoom", label: "Wonder Room" },
  { key: "magicRoom", label: "Magic Room" },
  { key: "fairyAura", label: "Additional Fairy Aura on the field" },
] as const;

export function createConditions(): BattleConditions {
  return {
    gameType: "Doubles", weather: "", terrain: "", critical: false, multipleTargets: true,
    gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false, fairyAura: false,
    attackerSide: createSide(), defenderSide: createSide(),
  };
}

/** Base/pre-transformation training stats, before stages/abilities/items. */
export function getBuildStats(build: BattleBuild, runtime: BattleRuntime = championsRuntime): StatTable | null {
  if (build.game !== runtime.profile.id) return null;
  // Terapagos battles as Terastal, or Stellar once Terastallized: those forms' stats, HP included.
  const species = runtime.speciesById.get(specialTeraForm(build, runtime) ?? build.speciesId);
  const nature = NATURES.find((entry) => entry.name === build.nature);
  if (!species || !nature) return null;
  if (build.game === "champions") {
    if (!build.points || build.native || STATS.some((stat) => !isIntegerWithin(build.points[stat], 0, 32))) return null;
  } else if (!build.native || build.points || !isIntegerWithin(build.native.level, 1, 100)
    || STATS.some((stat) => !isIntegerWithin(build.native.evs?.[stat], 0, 252) || !isIntegerWithin(build.native.ivs?.[stat], 0, 31))) return null;
  const stats = {} as StatTable;
  for (const stat of STATS) {
    const base = species.baseStats[stat];
    const raw = build.game === "champions"
      ? base + build.points[stat]! + (stat === "hp" ? 75 : 20)
      : Math.floor((2 * base + build.native.ivs[stat]! + Math.floor(build.native.evs[stat]! / 4)) * build.native.level! / 100)
        + (stat === "hp" ? build.native.level! + 10 : 5);
    if (stat === "hp") stats.hp = base === 1 ? 1 : raw;
    else {
      const multiplier = nature.plus === stat ? 110 : nature.minus === stat ? 90 : 100;
      stats[stat] = Math.floor(raw * multiplier / 100);
    }
  }
  return stats;
}

function isIntegerWithin(value: number | null, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function validateBuild(build: BattleBuild, runtime: BattleRuntime = championsRuntime): BuildIssue[] {
  if (build.game !== runtime.profile.id) return [{ field: "game", message: "This build belongs to a different battle game." }];
  const issues: BuildIssue[] = [];
  const label = build.game === "champions" ? "Champions" : runtime.profile.label;
  const species = runtime.speciesById.get(build.speciesId);
  if (!species) return [{ field: "speciesId", message: `Select a Pokémon from the ${label} catalog.` }];
  for (const reason of species.unsupported) issues.push({ field: "speciesId", message: reason });

  if (build.game === "champions") {
    if (build.native) issues.push({ field: "native", message: "Native training data cannot be applied as Champions Stat Points." });
    for (const stat of STATS) {
      if (!isIntegerWithin(build.points?.[stat], 0, 32)) {
        issues.push({ field: `points.${stat}`, message: `${STAT_LABELS[stat]} needs a whole number from 0 to 32.` });
      }
    }
    const points = STATS.reduce((total, stat) => total + (Number.isFinite(build.points?.[stat]) ? build.points[stat]! : 0), 0);
    if (points > 66) issues.push({ field: "points", message: `Use at most 66 Stat Points (${points} allocated).` });
  } else {
    if (build.points) issues.push({ field: "points", message: "Champions Stat Points cannot be applied as native EVs." });
    if (!isIntegerWithin(build.native?.level, 1, 100)) issues.push({ field: "native.level", message: "Level must be a whole number from 1 to 100." });
    for (const stat of STATS) {
      if (!isIntegerWithin(build.native?.evs?.[stat], 0, 252)) issues.push({ field: `native.evs.${stat}`, message: `${STAT_LABELS[stat]} EVs must be a whole number from 0 to 252.` });
      if (!isIntegerWithin(build.native?.ivs?.[stat], 0, 31)) issues.push({ field: `native.ivs.${stat}`, message: `${STAT_LABELS[stat]} IVs must be a whole number from 0 to 31.` });
      if (build.native?.innateIVs) {
        const innate = build.native.innateIVs[stat];
        const effective = build.native.ivs?.[stat];
        if (!isIntegerWithin(innate, 0, 31)) issues.push({ field: `native.innateIVs.${stat}`, message: `${STAT_LABELS[stat]} innate IVs must be a whole number from 0 to 31.` });
        else if (effective !== innate && (effective !== 31 || (build.native.level ?? 0) < (runtime.profile.generation === 9 ? 50 : 100))) {
          issues.push({ field: `native.innateIVs.${stat}`, message: `Hyper Training requires effective IV 31 and level ${runtime.profile.generation === 9 ? 50 : 100} or above.` });
        }
      }
    }
    const evs = STATS.reduce((total, stat) => total + (Number.isFinite(build.native?.evs?.[stat]) ? build.native.evs[stat]! : 0), 0);
    if (evs > 510) issues.push({ field: "native.evs", message: `Use at most 510 EVs (${evs} allocated).` });
  }
  if (!NATURES.some((nature) => nature.name === build.nature)) issues.push({ field: "nature", message: "Select a valid nature." });

  const ability = runtime.abilitiesById.get(build.abilityId);
  if (!ability || !species.abilities.includes(build.abilityId)) {
    issues.push({ field: "abilityId", message: `Select an ability available to this Pokémon in ${label}.` });
  } else {
    for (const reason of ability.unsupported) issues.push({ field: "abilityId", message: reason });
  }
  if (build.faintedAllies !== undefined && (!Number.isInteger(build.faintedAllies) || build.faintedAllies < 0 || build.faintedAllies > 5)) {
    issues.push({ field: "faintedAllies", message: "Fainted allies must be a whole number from 0 to 5." });
  }
  if (build.abilityId === "trace" && build.tracedAbility !== undefined && (!runtime.abilitiesById.has(build.tracedAbility) || NO_TRACE_ABILITIES.has(build.tracedAbility))) {
    issues.push({ field: "tracedAbility", message: "Trace cannot copy that ability." });
  }
  // Unburden activates only once its item is gone; a terrain Seed or Room Service may be used up in the calculation.
  if (build.abilityId === "unburden" && build.abilityActive && build.itemId && !build.itemId.endsWith("seed") && build.itemId !== "roomservice") {
    issues.push({ field: "abilityActive", message: "Unburden needs its held item used up." });
  }
  if (["protean", "libero"].includes(build.abilityId) && !build.abilityActive) {
    issues.push({ field: "abilityActive", message: "Only unused Protean/Libero with unchanged typing is supported." });
  }
  if (build.itemId) {
    const item = runtime.itemsById.get(build.itemId);
    if (!item) issues.push({ field: "itemId", message: `Select a held item from the ${label} catalog.` });
    else for (const reason of item.unsupported) issues.push({ field: "itemId", message: reason });
  }
  const requiredItems = species.requiredItems?.length ? species.requiredItems : species.requiredItem ? [species.requiredItem] : [];
  // Zacian or Zamazenta holding its Rusted item, Arceus holding a Plate (or a type's Z-Crystal) and Silvally holding a
  // Memory battle as that item's form (mechanics.ts heldItemForm): that form is the one to select.
  const heldForm = heldItemForm(build.speciesId, build.itemId, runtime);
  if (heldForm) {
    const form = runtime.speciesById.get(heldForm)!.name;
    issues.push({ field: "itemId", message: `${species.name} holding ${runtime.itemsById.get(build.itemId)?.name ?? build.itemId} battles as ${form}.` });
  }
  if (requiredItems.length && !requiredItems.includes(build.itemId)) {
    issues.push({ field: "itemId", message: `${species.name} requires ${requiredItems.map((id) => runtime.itemsById.get(id)?.name ?? id).join(" or ")}.` });
  }
  if (species.requiredMove && !build.preparedMoves?.includes(species.requiredMove)) {
    issues.push({ field: "preparedMoves", message: `${species.name} requires ${runtime.movesById.get(species.requiredMove)?.name ?? species.requiredMove} in its prepared moves.` });
  }
  if (species.name.includes("-Mega")) {
    if (!runtime.profile.mega) issues.push({ field: "speciesId", message: `Mega Evolution is not available in ${label}.` });
    const heldItem = runtime.itemsById.get(build.itemId);
    if (heldItem?.zMove || heldItem?.zMoveType) issues.push({ field: "itemId", message: "A Mega-Evolved Pokémon cannot hold a Z-Crystal." });
  }
  issues.push(...validateMechanic(build, runtime));
  for (const stat of COMBAT_STATS) {
    if (!isIntegerWithin(build.boosts[stat], -6, 6)) {
      issues.push({ field: `boosts.${stat}`, message: `${STAT_LABELS[stat]} stages must be a whole number from −6 to +6.` });
    }
  }
  if (!STATUSES.some((status) => status.value === build.status)) issues.push({ field: "status", message: "Select a valid battle status." });
  const stats = getBuildStats(build, runtime);
  if (build.currentHP !== null && !isIntegerWithin(build.currentHP, 1, stats?.hp ?? Number.MAX_SAFE_INTEGER)) {
    issues.push({ field: "currentHP", message: `Current HP must be a whole number from 1 to ${stats?.hp ?? "maximum HP"}.` });
  }
  return issues;
}

export function validateConditions(field: BattleConditions, runtime: BattleRuntime = championsRuntime): BuildIssue[] {
  const issues: BuildIssue[] = [];
  if (!["Singles", "Doubles"].includes(field.gameType)) issues.push({ field: "gameType", message: "Select Singles or Doubles." });
  if (!runtime.profile.weather.includes(field.weather)) issues.push({ field: "weather", message: "Select a supported weather condition." });
  if (!["", "Electric", "Grassy", "Misty", "Psychic"].includes(field.terrain)) issues.push({ field: "terrain", message: "Select a supported terrain." });
  for (const effect of SHARED_FIELD_EFFECTS) {
    if (typeof field[effect.key] !== "boolean") {
      issues.push({ field: effect.key, message: `${effect.label} must be on or off.` });
    }
  }
  return issues;
}

export type DamageSort = "minimum" | "maximum" | "uses" | "name";

/**
 * Uses to KO order, lowest first: guaranteed counts (fewest uses, then the higher chance that one use
 * fewer is enough, then the best rolls' count when there is no chance), then KOs that are only possible
 * (the higher chance first, then the fewest uses), then no KO within the uses counted (the user fainting
 * before any KO included), never, no damage and not estimated.
 */
function usesOrder(row: MoveDamageResult): number[] {
  const value = row.usesToKO;
  switch (value?.kind) {
    case "uses":
      // The calculation's chance, also for a 2HKO: one use with that turn's end, which the One-use KO chance
      // leaves out (and has none for multihit moves).
      if (value.guaranteed !== null) return [0, value.guaranteed, -(value.fasterChance ?? 0), value.fewest ?? value.guaranteed];
      return value.fewest !== null ? [1, -(value.chance ?? 0), value.fewest] : [2];
    case "single-use":
      return value.koChance === 1 ? [0, 1, 0, 1] : value.koChance > 0 ? [1, -value.koChance, 1] : [2];
    case "never": return [3];
    case "no-damage": return [4];
    default: return [5];
  }
}

/**
 * The damage the minimum and maximum sorts compare: the row's min or max, except for a random hit count
 * (hitChances), where it is that extreme's expected value over the counts, Σ chance × the sum of the
 * count's first hits' lowest (or highest) rolls. A 2–5 hit move ranks by 35% × 2 hits + 35% × 3 + 15% × 4
 * + 15% × 5 of its lowest (or highest) rolls, not by its fewest or most hits.
 */
function sortDamage(row: MoveDamageResult, extreme: "min" | "max"): number {
  const value = row[extreme] ?? -1;
  const { hitChances, rolls } = row;
  if (!hitChances?.length || !Array.isArray(rolls) || !rolls.every((hit) => Array.isArray(hit) && hit.length > 0)) return value;
  const perHit = (rolls as number[][]).map((hit) => extreme === "min" ? Math.min(...hit) : Math.max(...hit));
  if (perHit.length < hitChances[hitChances.length - 1].hits) return value;
  return hitChances.reduce((sum, { hits, chance }) => sum + chance * perHit.slice(0, hits).reduce((total, damage) => total + damage, 0), 0);
}

export function rankResults(results: MoveDamageResult[], sort: DamageSort = "minimum", runtime: BattleRuntime = championsRuntime): MoveDamageResult[] {
  const damage = new Map(results.map((row) => [row, { min: sortDamage(row, "min"), max: sortDamage(row, "max") }]));
  return [...results].sort((a, b) => {
    const nameA = a.effectiveName ?? runtime.movesById.get(a.moveId)?.name ?? a.moveId;
    const nameB = b.effectiveName ?? runtime.movesById.get(b.moveId)?.name ?? b.moveId;
    if (sort === "name") return nameA.localeCompare(nameB, "en");
    const calculable = Number(b.kind === "calculated") - Number(a.kind === "calculated");
    if (calculable) return calculable;
    if (sort === "uses") {
      const orderA = usesOrder(a), orderB = usesOrder(b);
      // Same-group keys have the same length.
      const uses = orderA.reduce((order, key, index) => order || key - orderB[index], 0);
      if (uses) return uses;
    }
    // Uses to KO ties fall back to the minimum damage order.
    const primary = sort === "maximum" ? "max" : "min";
    const secondary = sort === "maximum" ? "min" : "max";
    const damageA = damage.get(a)!, damageB = damage.get(b)!;
    return damageB[primary] - damageA[primary]
      || damageB[secondary] - damageA[secondary]
      || nameA.localeCompare(nameB, "en");
  });
}
