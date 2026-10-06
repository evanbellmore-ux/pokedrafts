import { calculate, Field, Generations, Move as EngineMove, Pokemon, toID } from "@smogon/calc";
import type { Move, Result, StatsTable } from "@smogon/calc";
import type { AbilityName, Generation, ID, MoveName, TypeName } from "@smogon/calc/dist/data/interface";
import { calculateBPModsChampions } from "@smogon/calc/dist/mechanics/champions";
import { calculateBPModsSMSSSV } from "@smogon/calc/dist/mechanics/gen789";
import { checkMultihitBoost, checkSeedBoost, getFinalSpeed, isGrounded } from "@smogon/calc/dist/mechanics/util";
import { getBerryResistType, getNaturalGift } from "@smogon/calc/dist/items";
import { championsRuntime, type BattleRuntime } from "./runtime";
import "./engine-corrections.cjs";
import { abilityActivationLabel, CROWNED_FORMS, defaultAbilityActive, getBuildStats, NATURES, PARADOX_FIELD_SETTERS, paradoxBestStat, priorityShieldNames, validateBuild, validateConditions, withoutSinglesPartners } from "./model";
import { getBuildGender, isMaxActive, specialTeraForm } from "./mechanics";
import { resolveBattleMove, STELLAR_FIRST_USE_REASON, withResolvedPriority } from "./resolve-move";
import { EVENT_DOUBLING_MOVES, eventDoublingAssumption, isEventDoubled } from "./event-moves";
import { withDynamaxHealth } from "./health";
import { mimicryState } from "./mimicry";
import { FIXED_DAMAGE_MOVES, MOVES_FIRST_POWER_MOVES } from "./turn-order";
import { imposterTransforms, movesSpeciesId, NO_TRACE_ABILITIES, NO_TRANSFORM_ABILITIES, TRANSFORM_LOCKED_ABILITIES, tracedAbility } from "./imposter";
import { applyIntimidate, atLead, beforeDownload, downloadStat, entryBoosts, intimidatedKey, leadForm, leadSpeed, unknownLeadForms, type EntryBoost, type IntimidateBattle } from "./intimidate";
import { hitCountRule, hitCountsText, type HitChance, type HitCountBattle } from "./hit-count";
import {
  berryArithmetic, BERRY_STEALERS, CANT_SUPPRESS, CONFUSING_BERRIES, eatBerry, FAIL_SKILL_SWAP, gulpingTarget, HEALING_BERRIES, hitPaths, hitsCanFaint, KLUTZ_IGNORED_ITEMS, ownMoveId,
  PINCH_STAT_BERRIES, PINCH_TYPES, usedMoveName, walkHits,
  type HitLoopInput, type HitState,
} from "./hit-loop";
import { chanceText } from "./chance";
import { beatUpPlan, countPower, supremeOverlordMultiplier } from "./count-moves";
import { CONFUSED_NOTE, ENTRY_ABILITIES, entryStagesOf, estimateUses, prepareUses, STARF_REASON, UNCOUNTED, type CalcTrace, type UsesHelpers } from "./uses-to-ko";
import { DOUBLES_SLOTS, doublesNames, foesOf, SLOT_POSITION, slotSide, type DoublesSlotId, type DoublesTurnInput } from "./doubles-types";
import type {
  AfterUse,
  BattleBuild,
  BattleConditions,
  BuildIssue,
  CombatStat,
  ChampionsMove,
  ChampionsSpecies,
  MoveContext,
  MoveDamageResult,
  SettledHP,
  SideConditions,
  UsesToKO,
} from "./types";

export type MatchupResult = {
  issues: { attacker: BuildIssue[]; defender: BuildIssue[]; field: BuildIssue[] };
  results: MoveDamageResult[];
  /** Each side's HP when the move starts, when an item changed it before the move (settleItems). */
  settledHP?: { attacker?: SettledHP; defender?: SettledHP };
};

/** These need information that a two-build snapshot does not contain. */
const HISTORY_MOVES: Record<string, string> = {
  pursuit: "Needs the defender's switching state.",
  retaliate: "Needs whether an ally fainted last turn.",
  furycutter: "Needs the consecutive-use count.",
  rollout: "Needs the consecutive-use count and Defense Curl state.",
  iceball: "Needs the consecutive-use count and Defense Curl state.",
  echoedvoice: "Needs the consecutive-turn use count.",
  spitup: "Needs the number of Stockpile uses.",
  trumpcard: "Needs the move's remaining PP.",
  present: "Random damage or healing, not modelled.",
  magnitude: "Needs the random Magnitude power.",
  counter: "Needs the damage and category of the earlier attack.",
  mirrorcoat: "Needs the damage and category of the earlier attack.",
  metalburst: "Needs the damage of the earlier attack.",
  comeuppance: "Needs the damage of the earlier attack.",
  bide: "Needs the damage stored over earlier turns.",
  fling: "Fling is not verified for Champions.",
};

const CONTEXT_ABILITIES: Record<string, string> = {
  rivalry: "Rivalry needs both Pokémon's genders.",
};
const EXPLOSIVE_MOVES = new Set(["explosion", "selfdestruct", "mistyexplosion", "mindblown"]);
/**
 * Moves that never knock the target out: pinned Showdown's falseswipe and holdback onDamage
 * (onDamagePriority -20) return target.hp - 1 for a hit that would reach the target's HP, before
 * Sturdy (-30), Focus Sash or Focus Band (-40) act, so none of those activates. Their Z-Move and Max
 * Move (Breakneck Blitz, Max Strike) are other moves, without the effect.
 */
const LEAVES_ONE_HP_MOVES = new Set(["falseswipe", "holdback"]);
// Target items pinned Showdown uses only after the whole move (Kee and Maranga Berry
// onAfterMoveSecondary, White Herb onAnyAfterMove); the engine's multi-hit loop uses them between hits.
const AFTER_MOVE_ITEMS = new Set(["Kee Berry", "Maranga Berry", "White Herb"]);
// Beat Up hits are separate calculations, so effects that change damage after the first hit are
// withheld (pinned Showdown). Kee Berry and Anger Shell act only after the whole move, and Tera
// Shell resists every hit, so separate calculations already match.
// A Defense rise changes nothing when a critical hit ignores it (the stage stays positive) or
// the attacker's Unaware ignores every stage.
const ignoresDefenseRise = (attacker: Pokemon, defender: Pokemon, critical: boolean) => attacker.hasAbility("Unaware") || (critical && defender.boosts.def >= 0);
// Multiscale, Shadow Shield (at full HP) and Colbur Berry halve only the first hit; Stamina and Weak
// Armor change Defense after every hit; Seed Sower's first hit sets Grassy Terrain, and its Grassy Seed
// then raises Defense for the later hits.
const BEAT_UP_BLOCKERS: { name: string; applies: (result: Result, conditions: BattleConditions) => boolean }[] = [
  { name: "Multiscale", applies: ({ defender }) => defender.hasAbility("Multiscale") && defender.curHP() === defender.maxHP() },
  { name: "Shadow Shield", applies: ({ defender }) => defender.hasAbility("Shadow Shield") && defender.curHP() === defender.maxHP() },
  { name: "Stamina", applies: ({ attacker, defender }, conditions) => defender.hasAbility("Stamina") && !ignoresDefenseRise(attacker, defender, conditions.critical) },
  { name: "Weak Armor", applies: ({ attacker, defender }) => defender.hasAbility("Weak Armor") && !attacker.hasAbility("Unaware") },
  { name: "Colbur Berry", applies: ({ rawDesc }) => rawDesc.defenderItem === "Colbur Berry" },
  {
    name: "Seed Sower with a Grassy Seed",
    applies: ({ attacker, defender }, conditions) => defender.hasAbility("Seed Sower") && defender.hasItem("Grassy Seed") && conditions.terrain !== "Grassy"
      && !ignoresDefenseRise(attacker, defender, conditions.critical),
  },
];
// Damaging moves with the pinned Showdown source's gravity flag; not a new learnset.
const GRAVITY_BLOCKED_MOVES = new Set(["bounce", "floatyfall", "fly", "flyingpress", "highjumpkick", "jumpkick", "skydrop"]);

const ZERO_POWER_IMPLEMENTED = new Set([
  "seismictoss", "nightshade", "dragonrage", "sonicboom", "finalgambit",
  "electroball", "gyroball", "lowkick", "grassknot", "heavyslam", "heatcrash",
  "flail", "reversal", "hardpress", "guardianofalola",
  // The engine's HP-, boost- and berry-based power matches pinned Showdown (audit native-games-14).
  "crushgrip", "wringout", "punishment", "naturalgift",
]);

type FixedHP = { hp: number; beforeDynamax: number; userHP: number };
const halfHP = ({ beforeDynamax }: FixedHP) => Math.max(1, Math.floor(beforeDynamax / 2));
/**
 * HP-based fixed damage (pinned Showdown data/moves.ts damageCallback). The engine has no
 * case for Super Fang, Ruination or Endeavor, and its Nature's Madness case misses Dynamax
 * and the minimum of 1. The half-HP moves deal half the target's HP scaled back from
 * Dynamax (pokemon.ts getUndynamaxedHP, rounded up), the half rounded down, at least 1. Endeavor fails unless the user
 * has less HP than the target (onTryImmunity, on Dynamax HP), and battle.ts spreadDamage
 * raises a nonzero result below 1 to 1 but leaves 0, which only a Dynamaxed target can give.
 * No Parental Bond Pokémon learns the half-HP moves (tested), and Endeavor's noparentalbond
 * flag keeps it one strike.
 */
/**
 * Abilities in the engines' own move-immunity checks (mechanics/gen789.js, champions.js).
 * Only these are named as blocking a fixed-HP move; an ability that changes the outcome by
 * switching another effect off (Neutralizing Gas on Scrappy, Klutz on Ring Target) is not.
 */
const MOVE_BLOCKING_ABILITIES = new Set([
  "Wonder Guard", "Sap Sipper", "Flash Fire", "Well-Baked Body", "Dry Skin", "Storm Drain", "Water Absorb",
  "Lightning Rod", "Motor Drive", "Volt Absorb", "Levitate", "Eelevate", "Bulletproof", "Soundproof",
  "Queenly Majesty", "Dazzling", "Armor Tail", "Earth Eater", "Wind Rider",
]);
const FIXED_HP_MOVES: Record<string, (hp: FixedHP) => number | null> = {
  superfang: halfHP,
  naturesmadness: halfHP,
  ruination: halfHP,
  endeavor: ({ hp, beforeDynamax, userHP }) => {
    if (userHP >= hp) return null;
    const damage = beforeDynamax - userHP;
    return damage === 0 ? 0 : Math.max(1, damage);
  },
};

const SUCCESS_ASSUMPTIONS: Record<string, string> = {
  suckerpunch: "Assumes Sucker Punch succeeds.",
  thunderclap: "Assumes Thunderclap succeeds.",
  upperhand: "Assumes Upper Hand succeeds.",
  shelltrap: "Assumes Shell Trap succeeds.",
  focuspunch: "Assumes Focus Punch is not interrupted.",
  firstimpression: "Assumes the attacker's first turn in battle.",
  fakeout: "Assumes the attacker's first turn in battle.",
  lastresort: "Assumes Last Resort can be used.",
  belch: "Assumes the attacker has eaten a Berry.",
  synchronoise: "Assumes the target shares a type with the attacker.",
  futuresight: "Uses this target and these conditions when the damage lands.",
  doomdesire: "Uses this target and these conditions when the damage lands.",
  meteorbeam: "Includes its +1 Sp. Atk before the hit, on top of the set stages.",
  electroshot: "Includes its +1 Sp. Atk before the hit, on top of the set stages.",
};

function emptyRow(move: ChampionsMove, kind: MoveDamageResult["kind"], reason: string | null): MoveDamageResult {
  return {
    moveId: move.id, effectiveName: move.name, effectiveType: move.type, effectivePower: move.power, effectiveCategory: move.category,
    kind, min: null, max: null, minPercent: null, maxPercent: null,
    rolls: null, ohkoChance: null, description: move.description, assumptions: [], reason, hits: null,
  };
}

/**
 * A Pokémon whose current types differ from its species (Mimicry). The engine deep-merges species
 * overrides element by element, so a one-type override would keep the species' second type; every
 * clone (calculate() clones its inputs) carries the forced types instead.
 */
function withTypes(pokemon: Pokemon, types: [TypeName] | undefined): Pokemon {
  if (!types) return pokemon;
  pokemon.types = types;
  const clone = pokemon.clone.bind(pokemon);
  pokemon.clone = () => withTypes(clone(), types);
  return pokemon;
}

function makePokemon(build: BattleBuild, runtime: BattleRuntime, speciesId = build.speciesId, types?: [TypeName]) {
  const generation = Generations.get(runtime.profile.generation);
  const species = runtime.speciesById.get(speciesId);
  const ability = runtime.abilitiesById.get(build.abilityId);
  if (build.game !== runtime.profile.id || !species || !generation.species.get(toID(species.calcName)) || !ability) {
    throw new Error(`The selected Pokémon is not present in the pinned ${runtime.profile.id === "champions" ? "Champions" : runtime.profile.label} engine.`);
  }
  const teraType = build.mechanic === "tera" && build.configuration?.teraType
    ? generation.types.get(toID(build.configuration.teraType))?.name : undefined;
  return withTypes(withDynamaxHealth(new Pokemon(generation, species.calcName, {
    level: build.game === "champions" ? 50 : build.native.level!,
    nature: build.nature,
    // Gen 0 uses direct Stat Points; native games retain their real EVs/IVs.
    evs: (build.game === "champions" ? build.points : build.native.evs) as StatsTable,
    ivs: build.game === "champions" ? undefined : build.native.ivs as StatsTable,
    boosts: build.boosts as Partial<StatsTable>,
    ability: ability.name,
    // Intimidate is applied once to the stored stages (intimidate.ts); the engine would re-apply it
    // on every calculation, including Parental Bond's second strike.
    abilityOn: build.abilityId === "intimidate" ? false : build.abilityActive,
    item: build.itemId ? runtime.itemsById.get(build.itemId)?.name : undefined,
    curHP: build.currentHP ?? undefined,
    status: build.status,
    gender: getBuildGender(build, runtime) ?? "N",
    teraType,
    isDynamaxed: isMaxActive(build),
    dynamaxLevel: build.configuration?.dynamaxLevel ?? 10,
    // Supreme Overlord's fallen count (engine alliesFainted); 0 is the start of a battle.
    alliesFainted: build.abilityId === "supremeoverlord" ? build.faintedAllies ?? 0 : undefined,
    // Protosynthesis / Quark Drive: the stat settleItems found active; unset, the engine never boosts.
    ...(build.settledBoostedStat ? { boostedStat: build.settledBoostedStat } : {}),
    // Transform copies every stat but HP (pinned Showdown transformInto): the target's species and
    // training with the Imposter user's base HP and HP training.
    ...(build.transformedFrom ? { overrides: { baseStats: { hp: build.transformedFrom.baseHP } } as never } : {}),
  })), types);
}

/** Mimicry's terrain type for the engine (mimicry.ts), with the result's note. */
function mimicryTypes(build: BattleBuild, other: BattleBuild, conditions: BattleConditions, who: "attacker" | "target", runtime: BattleRuntime): { types: [TypeName] | undefined; line: string | null } {
  // Mimicry copied by Transform, with no terrain, gives the Pokémon its own original types (pinned
  // Showdown onTerrainChange uses baseSpecies.types; its hint "Transform Mimicry").
  const own = build.transformedFrom ? runtime.speciesById.get(build.transformedFrom.speciesId) : undefined;
  if (own && build.abilityId === "mimicry" && !conditions.terrain && !gassedAbility(build, other, conditions) && own.types.length === 1) {
    return { types: [own.types[0] as TypeName], line: `Mimicry: no terrain, so the transformed ${who} is its own ${own.types[0]} type.` };
  }
  const state = mimicryState(build, other, conditions);
  if (!state) return { types: undefined, line: null };
  if (!state.type) {
    return { types: undefined, line: `Mimicry: suppressed by Neutralizing Gas, so the ${who} keeps its own types (assumes the gas was out when the terrain started or the ${who} entered).` };
  }
  return { types: [state.type], line: `Mimicry: on ${state.terrain} Terrain the ${who} is ${state.type} type.` };
}

/**
 * The number of base-power modifiers the engine chains with an active Supreme Overlord boost, or
 * null without one. Both round at each step, but the engine chains in its own order and pinned
 * Showdown by handler priority (Supreme Overlord 21, items 15–16, Helping Hand 10, move effects
 * such as Knock Off 0). Two modifiers always agree; three or more can be 1–2 HP apart.
 */
function supremeOverlordChain(generation: Generation, result: Result): number | null {
  if (!result.attacker.hasAbility("Supreme Overlord") || !result.attacker.alliesFainted) return null;
  const { move } = result;
  const target = move.target;
  const chain = (generation.num === 0 ? calculateBPModsChampions : calculateBPModsSMSSSV)(
    generation, result.attacker, result.defender, move, result.field, {} as Result["rawDesc"], move.bp, false, "last", 1,
  );
  move.target = target;
  return chain.length;
}

function makeSide(side: SideConditions) {
  return {
    isReflect: side.reflect,
    isLightScreen: side.lightScreen,
    isAuroraVeil: side.auroraVeil,
    isHelpingHand: side.helpingHand,
    isFriendGuard: side.friendGuard,
    isTailwind: side.tailwind,
    isCharge: side.charge,
    // Doubles turn only (doubles-turn.ts flowerGift): unset in 1v1, the engine's default.
    ...(side.flowerGift ? { isFlowerGift: true } : {}),
    // Protect is resolved by protectOutcome: the engine quarters before the final modifiers,
    // gives mainline Unseen Fist a quarter, and blocks Future Sight and Mighty Cleave.
  };
}

/** Damaging moves without pinned Showdown's protect flag (data/moves.ts): they hit a Protecting Pokémon in full. */
const PROTECT_IGNORING_MOVES = new Set([
  "feint", "futuresight", "doomdesire", "phantomforce", "shadowforce", "hyperspacefury", "hyperspacehole",
  "hyperdrill", "mightycleave", "gmaxoneblow", "gmaxrapidflow",
]);

const FUTURE_MOVES = new Set(["futuresight", "doomdesire"]);

type ProtectOutcome = { kind: "blocked" } | { kind: "full" | "quarter"; line: string };

/** Species pinned Showdown tags "Paradox" (data/pokedex.ts), whose Booster Energy cannot be removed. */
const PARADOX_SPECIES = new Set(["greattusk", "screamtail", "brutebonnet", "fluttermane", "slitherwing", "sandyshocks", "roaringmoon", "walkingwake",
  "irontreads", "ironbundle", "ironhands", "ironjugulis", "ironmoth", "ironthorns", "ironvaliant", "ironleaves"]);
/** Mega Stones whose onTakeItem (pinned Showdown data/items.ts) checks the holder's own base form, as the engine does. */
const FORM_KEYED_MEGA_STONES = new Set(["floettite", "magearnite", "meowsticite", "tatsugirinite"]);

/**
 * Whether Knock Off cannot remove the target's Mega Stone although the engine thinks it can, so the
 * engine would wrongly give it 1.5x power. Pinned Showdown's stones refuse TakeItem for the holder's
 * whole family (Raichunite X on Alolan Raichu, Slowbronite on Galarian Slowbro, Zygardite on any
 * Zygarde); the engine checks only the exact form.
 */
function megaStoneKeptFromKnockOff(generation: Generation, defender: Pokemon, itemId: string, build: BattleBuild): boolean {
  // Booster Energy cannot be removed from a Paradox Pokémon (pinned Showdown boosterenergy onTakeItem).
  if (itemId === "boosterenergy") return PARADOX_SPECIES.has(build.transformedFrom?.speciesId ?? build.speciesId);
  // Transform keeps the Imposter user's own base species, so any Stone can be knocked off it.
  if (build.transformedFrom) return false;
  const item = generation.items.get(itemId as ID);
  if (!item?.megaStone || FORM_KEYED_MEGA_STONES.has(itemId)) return false;
  const megaStone = item.megaStone as Record<string, string>;
  const engineKeeps = !!megaStone[defender.name] || Object.values(megaStone).includes(defender.name);
  const family = defender.species.baseSpecies ?? defender.name;
  const showdownKeeps = itemId === "zygardite" ? family === "Zygarde" : !!megaStone[family];
  return showdownKeeps && !engineKeeps;
}

/** Status berries that cure their holder's status at once (pinned Showdown onUpdate / onAfterSetStatus). */
const STATUS_BERRIES: Record<string, readonly string[]> = {
  lumberry: ["brn", "par", "psn", "tox", "slp", "frz"], rawstberry: ["brn"], cheriberry: ["par"],
  pechaberry: ["psn", "tox"], aspearberry: ["frz"], chestoberry: ["slp"],
};
const STATUS_NAMES: Record<string, string> = { brn: "burn", par: "paralysis", psn: "poison", tox: "bad poison", slp: "sleep", frz: "freeze" };
/**
 * Held items, besides the stat berries (PINCH_STAT_BERRIES), that a Pokémon at or under their line uses before
 * either Pokémon moves (settleItems): the HP berries and Berry Juice but Enigma Berry, Lansat, Starf and Custap.
 */
const PRE_MOVE_ITEMS = new Set([...[...HEALING_BERRIES].filter((item) => item !== "enigmaberry"), "lansatberry", "starfberry", "custapberry"]);
const SEED_TERRAINS: Record<string, BattleConditions["terrain"]> = { grassyseed: "Grassy", electricseed: "Electric", psychicseed: "Psychic", mistyseed: "Misty" };
const CASTFORM_FORMS: Record<string, string> = { Sun: "castformsunny", "Harsh Sunshine": "castformsunny", Rain: "castformrainy", "Heavy Rain": "castformrainy", Snow: "castformsnowy", Hail: "castformsnowy" };

/**
 * Castform's Forecast is stopped by the other battler's Neutralizing Gas, and Utility Umbrella makes
 * it ignore sun and rain (pinned Showdown effectiveWeather); it then stays Normal type.
 */
function forecastBlocked(build: BattleBuild, other: BattleBuild, conditions: BattleConditions): "Neutralizing Gas" | "Utility Umbrella" | null {
  if (build.abilityId !== "forecast" || !build.speciesId.startsWith("castform")) return null;
  if (other.abilityId === "neutralizinggas" && !shieldsAbility(build, conditions)) return "Neutralizing Gas";
  if (build.itemId === "utilityumbrella" && !conditions.magicRoom && ["Sun", "Harsh Sunshine", "Rain", "Heavy Rain"].includes(conditions.weather)) return "Utility Umbrella";
  return null;
}

/** A copied ability's condition: a copied Intrepid Sword or Dauntless Shield starts afresh and boosts. */
const copiedAbilityActive = (abilityId: string) => defaultAbilityActive(abilityId);
const COMBAT_STATS = ["atk", "def", "spa", "spd", "spe"] as const;
const STAGE_NAMES: Record<(typeof COMBAT_STATS)[number], string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };
const clampStage = (stage: number) => Math.max(-6, Math.min(6, stage));
const cap = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;

function intimidateBattle(conditions: BattleConditions, sourceTailwind: boolean, targetTailwind: boolean, positions?: IntimidateBattle["positions"]): IntimidateBattle {
  return {
    magicRoom: conditions.magicRoom, wonderRoom: conditions.wonderRoom, terrain: conditions.terrain, gameType: conditions.gameType,
    tailwind: { source: sourceTailwind, target: targetTailwind }, ...(positions ? { positions } : {}),
  };
}

/**
 * Ability and form states the battle has already settled on entry, as pinned Showdown resolves them:
 * Trace copies a foe's ability, Imposter transforms its user into the target, and Forecast sets
 * Castform's form from the weather (any selected Castform form).
 */
function settleAbilities(build: BattleBuild, other: BattleBuild, conditions: BattleConditions, runtime: BattleRuntime, who: string, otherTailwind: boolean): { build: BattleBuild; lines: string[]; withheld?: string } {
  const lines: string[] = [];
  const name = runtime.speciesById.get(build.speciesId)?.name ?? build.speciesId;
  const abilityName = (id: string) => runtime.abilitiesById.get(id)?.name ?? id;
  const otherName = runtime.speciesById.get(other.speciesId)?.name ?? other.speciesId;
  let settled = build;
  // Terastallized Ogerpon and Terapagos change form, and with it their ability.
  const form = specialTeraForm(build, runtime);
  if (form) {
    const species = runtime.speciesById.get(form)!;
    const abilityId = species.abilities[0];
    settled = { ...settled, speciesId: form, abilityId, abilityActive: defaultAbilityActive(abilityId) };
    const embody = EMBODY_STATS[abilityId];
    // The other battler's Neutralizing Gas suppresses Embody Aspect, Tera Shell and Teraform Zero.
    const gassed = gassedAbility(settled, other, conditions);
    lines.push(form.startsWith("ogerpon")
      ? `Terastallization: ${who} ${name} is ${species.name}; ${abilityName(abilityId)} ${gassed ? "is suppressed by Neutralizing Gas" : `gives +1 ${embody}`}.`
      : form === "terapagosterastal"
        ? `Tera Shift: ${who} ${name} is Terapagos-Terastal${gassed ? "; Tera Shell is suppressed by Neutralizing Gas" : ", with Tera Shell"}.`
        : `Terastallization: ${who} ${name} is Terapagos-Stellar${gassed ? "; Teraform Zero is suppressed by Neutralizing Gas" : `; Teraform Zero cleared the weather and terrain${conditions.weather || conditions.terrain ? " (assumes the set weather and terrain returned after)" : ""}`}.`);
  }
  // Shields Down and Schooling set the form from HP on entry and at the end of each turn (pinned
  // Showdown onStart and onResidual; neither can be suppressed). Minior is Meteor above half HP;
  // Wishiwashi (level 20+) is School above a quarter. The panel's switch keeps the selected form when
  // the HP crossed that line earlier this turn.
  const hpForm = entryForm(settled, runtime);
  if (hpForm) {
    const formName = runtime.speciesById.get(hpForm.speciesId)?.name ?? hpForm.speciesId;
    if (hpForm.kept) {
      lines.push(`${hpForm.ability}: ${who} ${name} stays ${name} until the end of the turn (${formName} ${hpForm.why}).`);
    } else {
      settled = { ...settled, speciesId: hpForm.speciesId };
      lines.push(`${hpForm.ability}: ${who} ${name} is ${formName} ${hpForm.why}.`);
    }
  }
  // Ice Face is restored only on entry, or when snow or hail starts (pinned Showdown iceface onStart and
  // onWeatherChange), so a selected Eiscue-Noice in that weather broke its face after it started.
  if (settled.abilityId === "iceface" && settled.speciesId === "eiscuenoice" && !settled.transformedFrom && ["Snow", "Hail"].includes(conditions.weather)
    && ![settled, other].some((entry) => ["cloudnine", "airlock"].includes(entry.abilityId) && !gassedAbility(entry, entry === settled ? other : settled, conditions))) {
    const weather = conditions.weather === "Hail" ? "hail" : "snow";
    lines.push(`Ice Face: assumes ${who} Eiscue-Noice's face broke while the ${weather} was up.`);
  }
  // Trace copies a foe's ability on entry (pinned Showdown trace onStart); the engine has none.
  if (build.abilityId === "trace") {
    const traced = tracedAbility(build, other, conditions.magicRoom);
    if (traced.abilityId) {
      settled = { ...settled, abilityId: traced.abilityId, abilityActive: copiedAbilityActive(traced.abilityId) };
      lines.push(`Trace: ${who} ${name} copied ${abilityName(traced.abilityId)}${traced.chosen ? "" : ` from ${otherName}`}.`);
    } else if (traced.blockedBy) {
      lines.push(`Trace: ${who} ${name} copies nothing (${traced.blockedBy}).`);
    } else {
      lines.push(`Trace: ${who} ${name} copies nothing (${abilityName(other.abilityId)} cannot be copied).`);
    }
  }
  // Imposter transforms its user into the target on entry (Showdown transformInto): the target's
  // species, types, stats but HP, ability, stat stages, weight and moves; it keeps its HP, item and status.
  if (imposterTransforms(build, other, conditions.magicRoom)) {
    const own = runtime.speciesById.get(build.speciesId);
    if (build.mechanic || other.mechanic) return { build, lines, withheld: "Imposter with Terastallization or Dynamax on either Pokémon is not modelled." };
    if (!own) return { build, lines, withheld: "The Imposter user's species is not in this catalog." };
    let transformed: BattleBuild;
    if (build.game === "champions" && other.game === "champions") {
      transformed = { ...other, points: { ...other.points, hp: build.points.hp } };
    } else if (build.game !== "champions" && other.game !== "champions") {
      if (build.native.level !== other.native.level) return { build, lines, withheld: "Imposter needs both Pokémon at the same level." };
      transformed = {
        ...other,
        native: {
          ...other.native,
          evs: { ...other.native.evs, hp: build.native.evs.hp }, ivs: { ...other.native.ivs, hp: build.native.ivs.hp },
          // Transform keeps the user's own Hidden Power type (pinned Showdown transformInto keeps hpType
          // from generation 5), so Hidden Power reads the Imposter user's own innate IVs, never the target's.
          innateIVs: { ...(build.native.innateIVs ?? build.native.ivs) },
        },
      };
    } else {
      return { build, lines, withheld: "Both Pokémon must use the same game rules." };
    }
    // Both are assumed to enter together with the target faster. Transform copies the target's stages
    // at that moment: its stored stages and the ability entry boosts the engine adds at calculation
    // time (priority 0, so by Speed; Download read the untransformed user). A Seed (priority -1) is
    // used only after Imposter, so it is not copied. After that the two change separately, so the
    // Imposter user's own stored stages are added as later changes.
    const targetEntry = entryBoosts(other, { ...build, boosts: Object.fromEntries(COMBAT_STATS.map((stat) => [stat, 0])) as BattleBuild["boosts"] }, [],
      otherTailwind, intimidateBattle(conditions, otherTailwind, false), runtime).filter((entry) => !SEED_TERRAINS[entry.id]);
    // The form Imposter meets on entry: Tera Shift (priority 2) has already made Terapagos Terastal,
    // while Forecast and Flower Gift (priority -2) have not yet changed Castform or Cherrim.
    const lateForms: Record<string, [string, string]> = {
      forecast: ["castform", "castform"], flowergift: ["cherrimsunshine", "cherrim"], shieldsdown: ["miniormeteor", "minior"], schooling: ["wishiwashischool", "wishiwashi"],
    };
    const late = lateForms[other.abilityId];
    const entryForm = specialTeraForm(other, runtime) ?? (late && (other.abilityId === "forecast" ? other.speciesId.startsWith("castform") : other.speciesId === late[0]) && runtime.speciesById.has(late[1]) ? late[1] : other.speciesId);
    const copiedAbility = entryForm !== other.speciesId && specialTeraForm(other, runtime) ? runtime.speciesById.get(entryForm)!.abilities[0] : other.abilityId;
    transformed = { ...transformed, speciesId: entryForm };
    const boosts = Object.fromEntries(COMBAT_STATS.map((stat) => [stat, clampStage((other.boosts[stat] ?? 0)
      + targetEntry.filter((entry) => entry.stat === stat).reduce((sum, entry) => sum + entry.amount, 0) + (build.boosts[stat] ?? 0))])) as BattleBuild["boosts"];
    // Disguise, Neutralizing Gas and the other notransform abilities do nothing on a transformed
    // Pokémon, nor do the form abilities Showdown switches off for one (Stance Change, Forecast, ...).
    const inert = NO_TRANSFORM_ABILITIES.has(copiedAbility) || TRANSFORM_LOCKED_ABILITIES.has(copiedAbility);
    settled = {
      ...transformed, boosts,
      abilityId: inert ? build.abilityId : copiedAbility, abilityActive: inert ? true : copiedAbilityActive(copiedAbility),
      // Its own item, and that item's Magic Room timing (the spread copied the target's).
      itemId: build.itemId, itemUsedBeforeRoom: build.itemUsedBeforeRoom, status: build.status, currentHP: build.currentHP, mechanic: undefined,
      // It keeps its own gender, happiness and declared Hidden Power type (transformInto leaves them alone).
      configuration: { ...other.configuration, gender: getBuildGender(build, runtime), happiness: build.configuration?.happiness, hiddenPowerType: build.configuration?.hiddenPowerType },
      faintedAllies: build.faintedAllies, tracedAbility: undefined, settledDownload: undefined,
      transformedFrom: { speciesId: build.speciesId, baseHP: own.baseStats.hp },
    };
    const entryList = targetEntry.map((entry) => `${entry.cause} ${entry.amount > 0 ? "+" : ""}${entry.amount} ${STAGE_NAMES[entry.stat]}`).join(" and ");
    const formName = runtime.speciesById.get(entryForm)?.name ?? entryForm;
    lines.push(`Imposter: ${who} ${name} transformed into ${formName} (${abilityName(copiedAbility)}${inert ? ", no effect when transformed" : ""}${entryList ? `; copied ${entryList}` : ""}); ${name}'s own stat stages are added on top. Assumes both entered together, ${otherName} faster, and nothing blocked the transformation.`);
  }
  if (build.abilityId === "forecast" && build.speciesId.startsWith("castform") && runtime.speciesById.has("castform")) {
    const airLock = [build, other].some((entry) => ["cloudnine", "airlock"].includes(entry.abilityId));
    const blocked = forecastBlocked(build, other, conditions);
    const form = !airLock && !blocked ? CASTFORM_FORMS[conditions.weather] ?? "castform" : "castform";
    if (form !== build.speciesId) {
      const formName = runtime.speciesById.get(form)?.name ?? form;
      lines.push(`Forecast: ${who} ${name} is ${formName} (${runtime.speciesById.get(form)?.types.join("/")} type)${blocked ? `; ${blocked} blocks it` : airLock ? "; Cloud Nine or Air Lock negates the weather" : conditions.weather ? ` in ${conditions.weather}` : " without sun, rain or snow"}.`);
    }
    settled = { ...settled, speciesId: "castform" };
  }
  return { build: settled, lines };
}

/**
 * Entry effects between the two settled Pokémon that the engine cannot see: an Intimidate copied by
 * Trace or Imposter lowers the foe's Attack (its Start runs when the ability is copied), and Download
 * against a Pokémon that transformed after it read the untransformed Pokémon's defenses.
 */
function settleEntry(
  attacker: BattleBuild, defender: BattleBuild, shown: { attacker: BattleBuild; defender: BattleBuild }, conditions: BattleConditions, runtime: BattleRuntime,
): { attacker: BattleBuild; defender: BattleBuild; lines: string[] } {
  const lines: string[] = [];
  const builds = { attacker, defender };
  const ownName = (build: BattleBuild) => runtime.speciesById.get(build.transformedFrom?.speciesId ?? build.speciesId)?.name ?? build.speciesId;
  const tailwind = { attacker: conditions.attackerSide.tailwind, defender: conditions.defenderSide.tailwind };
  for (const [side, foeSide] of [["attacker", "defender"], ["defender", "attacker"]] as const) {
    const copiedBy = shown[side].abilityId === "trace" ? "Trace" : shown[side].abilityId === "imposter" ? "Imposter" : null;
    if (!copiedBy || builds[side].abilityId !== "intimidate" || shown[side].copiedIntimidateStored === intimidatedKey(shown[foeSide], runtime)) continue;
    const holder = builds[side], foe = builds[foeSide];
    const who = side === "attacker" ? "the attacker" : "the target";
    const foeWho = foeSide === "attacker" ? "the attacker" : "the target";
    // A transformed holder shares its foe's species name: name each by who it is instead.
    const speciesName = runtime.speciesById.get(foe.speciesId)?.name ?? foe.speciesId;
    const positions = holder.transformedFrom ? { source: ownName(holder), target: foeWho } : undefined;
    const result = applyIntimidate(holder, foe, intimidateBattle(conditions, tailwind[side], tailwind[foeSide], positions), runtime);
    builds[side] = result.source;
    builds[foeSide] = result.target;
    const named = (line: string) => positions
      ? cap(line.replaceAll(`${speciesName} (${positions.source})`, positions.source).replaceAll(`${speciesName} (${foeWho})`, `${foeWho} ${speciesName}`))
      : line;
    lines.push(`${cap(who)} ${ownName(holder)}'s Intimidate (copied by ${copiedBy}) is applied.`,
      // The engine adds entry boosts at calculation time; nothing is stored here.
      ...result.lines.slice(1).filter((line) => !/\(added at calculation\)\.$|^Assumes Tailwind started/.test(line)).map(named));
  }
  // After Intimidate, whose own stage bookkeeping adds the Download boost entryBoosts gives.
  for (const [side, foeSide] of [["attacker", "defender"], ["defender", "attacker"]] as const) {
    const holder = builds[side], foe = builds[foeSide];
    const who = side === "attacker" ? "the attacker" : "the target";
    // At a shared lead Download (switch-in priority 0) reads the foe before its terrain Seed (priority
    // -1), before Embody Aspect (Ogerpon Terastallizes during the turn) and before a slower foe's
    // Dauntless Shield (entryBoosts, beforeDownload), in the form it led with and before any room
    // (atLead); the engine reads the foe as it is now, with all of them.
    if (holder.abilityId === "download" && !foe.transformedFrom && !gassedAbility(holder, foe, conditions)) {
      const battle = intimidateBattle(conditions, tailwind[side], tailwind[foeSide]);
      const foeEntry = entryBoosts(foe, holder, null, tailwind[foeSide], battle, runtime);
      const stat = entryBoosts(holder, foe, foeEntry, tailwind[side], battle, runtime).find((entry) => entry.id === "download")?.stat;
      if (!stat) continue;
      const lead = atLead(foe, battle, runtime);
      const before = beforeDownload(holder, foe, foeEntry, runtime);
      const later = downloadStat(foe, foeEntry, battle, runtime);
      if (stat !== later) {
        builds[side] = { ...holder, boosts: { ...holder.boosts, [stat]: clampStage((holder.boosts[stat] ?? 0) + 1) }, settledDownload: stat };
      }
      // The other outcomes, which make the assumed entry worth stating: the holder entered later (the
      // engine's pick), or the other order at a shared entry.
      const shield = foeEntry.find((entry) => entry.id === "dauntlessshield");
      const counted = !!shield && before.includes(shield);
      const swap = shield ? downloadStat(lead.foe, counted ? before.filter((entry) => entry !== shield) : [...before, shield], lead.battle, runtime) : stat;
      // Necrozma-Ultra or Zygarde-Complete could have led as either of two forms: when a lead read differs
      // from the one used, the later entry is stated.
      const unknown = unknownLeadForms(foe, runtime);
      if (unknown && later === stat && swap === stat) {
        if (unknown.speciesIds.some((id) => { const read = downloadStat({ ...lead.foe, speciesId: id }, before, lead.battle, runtime); return read && read !== stat; })) {
          lines.push(`${cap(who)} ${ownName(holder)}'s Download raised its ${STAGE_NAMES[stat]}, read from ${ownName(foe)} as it is now (assumes it entered after ${unknown.base} ${unknown.change}).`);
        }
        continue;
      }
      if (later === stat && swap === stat) continue;
      // What Download did not count that could matter to it (Embody Aspect's Attack or Speed never does),
      // the form the foe had then, and a room that was not up yet.
      const missed = foeEntry.filter((entry) => !before.includes(entry) && (entry.stat === "def" || entry.stat === "spd"));
      const embody = missed.some((entry) => EMBODY_STATS[entry.id]);
      const form = leadForm(foe, runtime);
      const holderName = ownName(holder), foeName = form ? runtime.speciesById.get(form.speciesId)?.name ?? form.speciesId : ownName(foe);
      const mine = leadSpeed(holder, runtime), theirs = leadSpeed(foe, runtime);
      const effect = (entry: EntryBoost) => SEED_TERRAINS[entry.id] ? `its ${entry.cause} was used` : `its ${entry.cause} raised its ${STAGE_NAMES[entry.stat]}`;
      const befores = [...missed.map(effect), ...(form?.change ? [`it ${form.change}`] : []), ...(conditions.wonderRoom ? ["Wonder Room was set"] : [])];
      const order = swap === stat ? "" : mine === theirs
        ? `, Dauntless Shield first (Speed tie at ${mine})`
        : `, ${counted ? foeName : holderName} first (${Math.max(mine, theirs)} Speed against ${Math.min(mine, theirs)} on entry)`;
      const list = befores.length < 2 ? befores.join("") : `${befores.slice(0, -1).join(", ")} and ${befores[befores.length - 1]}`;
      const done = [counted ? `counted ${foeName}'s Dauntless Shield rise` : "", befores.length ? `read ${counted ? "its" : `${foeName}'s`} Defense and Sp. Def before ${list}` : ""].filter(Boolean);
      lines.push(`${cap(who)} ${holderName}'s Download raised its ${STAGE_NAMES[stat]}${done.length ? `: it ${done.join(" but ")}` : ""} `
        + `(assumes both ${embody ? `led together, ${foeName} Terastallizing after Download` : swap !== stat || befores.length > missed.length ? `led together${order}` : "entered together"}).`);
      continue;
    }
    if (holder.abilityId === "download" && foe.transformedFrom && !gassedAbility(holder, foe, conditions)) {
      const zero = Object.fromEntries(COMBAT_STATS.map((stat) => [stat, 0])) as BattleBuild["boosts"];
      const download = entryBoosts(holder, { ...shown[foeSide], boosts: zero }, [], tailwind[side], intimidateBattle(conditions, tailwind[side], tailwind[foeSide]), runtime)
        .find((entry) => entry.id === "download");
      if (download) {
        builds[side] = { ...holder, boosts: { ...holder.boosts, [download.stat]: clampStage((holder.boosts[download.stat] ?? 0) + 1) }, settledDownload: download.stat };
        lines.push(`${cap(who)} ${ownName(holder)}'s Download raised its ${STAGE_NAMES[download.stat]}, read from ${ownName(foe)} before it transformed.`);
      }
    }
  }
  return { ...builds, lines };
}

/** What settleItems leaves: the settled build, its lines, the HP an eaten item changed, and a Starf Berry's pending rise. */
export type SettledItems = {
  build: BattleBuild; lines: string[]; settledHP?: SettledHP;
  /** A Starf Berry eaten before the move: +`amount` to one of `stats` at random (each equally likely), not yet in the build's stages. */
  starf?: { stats: CombatStat[]; amount: number };
  /** The HP, pinch, Lansat, Starf or Custap Berry eaten before the move (not Berry Juice, which is not a Berry). */
  eaten?: string;
  /** The stages a pinch stat Berry eaten before the move raised (after Contrary, Simple and the +6 cap), for a foe's Mirror Herb or Opportunist. */
  raised?: Partial<Record<CombatStat, number>>;
  /** A Figy-family Berry it eats before the move confused it. */
  confused?: true;
};

/**
 * Held-item states the battle has already settled before this attack, from the Pokémon's settled
 * abilities, as pinned Showdown runs a turn from the state set at its start (both sides alike): its Custap
 * Berry at its line is eaten when its move is chosen, then at the turn's first Update a matching status
 * berry (Lum, Rawst, Cheri, Pecha, Aspear, Chesto) cures its holder and an HP or pinch berry at or under its
 * line is eaten, unless Magic Room, an active Klutz or the other battler's Unnerve / As One stops it (Cheek
 * Pouch heals a third as any Berry is eaten); a terrain Seed on its terrain is used up on entry. Unburden then
 * activates, and it stays off while an item is still held.
 */
function settleItems(build: BattleBuild, other: BattleBuild, conditions: BattleConditions, runtime: BattleRuntime, who: string, name: string): SettledItems {
  const lines: string[] = [];
  const itemName = (id: string) => runtime.itemsById.get(id)?.name ?? id;
  let settled = build;
  let settledHP: SettledHP | undefined;
  let starf: SettledItems["starf"];
  let eaten: string | undefined;
  let raised: SettledItems["raised"];
  let confused = false;
  /** The item used at this turn's first Update (a status, HP or pinch Berry, Berry Juice), and the Speed stages its Salac Berry changed, for generation 7's turn order. */
  let usedAtUpdate: string | null = null;
  let berrySpe = 0;
  const klutz = klutzActive(build, other);
  const itemOn = !conditions.magicRoom && !klutz;
  // A Booster Energy or Seed used before Magic Room was set stays used (the panel's choice, unset
  // meaning it was); one that met the room on entry, or a terrain starting after it, stays unused.
  const usedBeforeRoom = conditions.magicRoom && !klutz && build.itemUsedBeforeRoom !== false;
  // The holder's own Neutralizing Gas suppresses Unnerve, but not As One or an Ability Shield holder's.
  const unnerved = ["unnerve", "asoneglastrier", "asonespectrier"].includes(other.abilityId) && !gassedAbility(other, build, conditions);
  const abilityOn = !gassedAbility(build, other, conditions);
  // A transformed Imposter user keeps its own maximum HP (pinned Showdown transformInto copies every stat but HP).
  const maxHP = getBuildStats(build.transformedFrom ? { ...build, speciesId: build.transformedFrom.speciesId } : build, runtime)?.hp ?? 0;
  // Cheek Pouch (data/abilities.ts onEatItem) heals a third of the base maximum HP as any Berry is eaten, Berry Juice
  // aside (it is used, not eaten); battle.heal rounds down, at least 1, and caps at the maximum.
  const pouch = abilityOn && build.abilityId === "cheekpouch" ? Math.max(1, Math.floor(maxHP / 3)) : 0;
  const berry = STATUS_BERRIES[build.itemId];
  let usedUp = false;
  if (berry && build.status && berry.includes(build.status) && itemOn && !unnerved) {
    const healed = pouch && build.currentHP !== null && maxHP ? Math.min(maxHP, build.currentHP + pouch) : null;
    const heal = healed !== null && healed !== build.currentHP ? `, then Cheek Pouch: ${healed} HP` : "";
    lines.push(`${cap(who)} ${name}'s ${itemName(build.itemId)} cured its ${STATUS_NAMES[build.status] ?? build.status} (used up)${heal}.`);
    settled = { ...settled, status: "", itemId: "", ...(heal ? { currentHP: healed } : {}) };
    if (heal) settledHP = { hp: healed!, entered: build.currentHP!, maxHP, item: itemName(build.itemId) };
    usedUp = true;
    usedAtUpdate = build.itemId;
  }
  const onSeedTerrain = !!SEED_TERRAINS[build.itemId] && SEED_TERRAINS[build.itemId] === conditions.terrain;
  // An item Magic Room held back stays held after the room ends (Seeds and Room Service react only to
  // entry and to their terrain or Trick Room starting), so the switch's unticked state holds without it too.
  const seedUsed = onSeedTerrain && !klutz && build.itemUsedBeforeRoom !== false;
  const seedStat = ["grassyseed", "electricseed"].includes(build.itemId) ? "def" : "spd";
  const contrary = build.abilityId === "contrary" && abilityOn;
  // Item stat changes go through Showdown's boost(): Contrary inverts them and Simple doubles them.
  const boostScale = (contrary ? -1 : 1) * (build.abilityId === "simple" && abilityOn ? 2 : 1);
  const boostNote = contrary ? " (Contrary)" : boostScale === 2 ? " (Simple)" : "";
  const stages = (amount: number, stat: (typeof COMBAT_STATS)[number]) => `${amount > 0 ? "+" : ""}${amount} ${STAGE_NAMES[stat]}${boostNote}`;
  // An HP or pinch berry at or under its line was eaten at the turn's first Update, before either Pokémon moves
  // (pinned Showdown sim/battle.ts runAction ends the beforeTurn action with eachEvent('Update'); data/items.ts
  // onUpdate): Sitrus, Oran and Berry Juice at half HP or less, the Figy family, the stat berries, Lansat and Starf
  // at a quarter (half with Gluttony); Ripen doubles the heal and the rise (onTryHeal, onChangeBoost), Cheek Pouch
  // heals a third more, and boost() applies Contrary and Simple. A Custap Berry at that line was eaten before that,
  // when its move was chosen (sim/battle-queue.ts resolveAction runs FractionalPriority with 0, so for any move).
  // Unnerve and As One stop a Berry, not Berry Juice (used, not eaten); Enigma Berry acts only when its holder is
  // hit, and a Micle Berry only at the end of a turn (onResidual). In the HP as entered, before any Dynamax (the
  // runDynamax action comes after the beforeTurn one).
  const held = settled.itemId;
  const pinchStat = PINCH_STAT_BERRIES[held];
  // Protosynthesis and Quark Drive picked their stat when they activated, before this Update's berry (below).
  const stagesBeforeBerry = settled.boosts;
  if (!usedUp && itemOn && build.currentHP !== null && maxHP && (PRE_MOVE_ITEMS.has(held) || pinchStat) && (held === "berryjuice" || !unnerved)) {
    const ability = abilityOn ? build.abilityId : "";
    const berry = berryArithmetic(held, { maxHP, baseMaxHP: maxHP, ability }, runtime.profile.generation);
    if (build.currentHP <= berry.line) {
      const hp = eatBerry(berry, build.currentHP);
      const amount = (pinchStat ? 1 : held === "starfberry" ? 2 : 0) * boostScale * (ability === "ripen" ? 2 : 1);
      // Starf Berry (onEat) raises one stat at random, of those below +6 (accuracy and evasion aside).
      const open = held === "starfberry" ? COMBAT_STATS.filter((stat) => (settled.boosts[stat] ?? 0) < 6) : [];
      const effect = pinchStat ? stages(amount, pinchStat)
        : open.length ? `${amount > 0 ? "+" : ""}${amount} to ${open.length === COMBAT_STATS.length ? "a random stat" : `one of ${orList(open.map((stat) => STAGE_NAMES[stat]))} at random`}${boostNote}`
          : held === "lansatberry" ? "+2 critical-hit ratio" : "";
      // A Figy-family Berry (onEat) confuses a holder whose Nature lowers its stat, unless Own Tempo
      // (data/abilities.ts owntempo onTryAddVolatile) or Misty Terrain under a grounded holder (data/moves.ts
      // mistyterrain onTryAddVolatile) stops it.
      const disliked = CONFUSING_BERRIES[held];
      confused = !!disliked && NATURES.find((nature) => nature.name === build.nature)?.minus === disliked && !(abilityOn && build.abilityId === "owntempo")
        && !(conditions.terrain === "Misty" && isGrounded(ignoringItem(makePokemon(settled, runtime), settled, other, conditions), makeField(conditions)));
      const changes = [hp !== build.currentHP ? `${hp} HP` : "", effect, confused ? "confused" : ""].filter(Boolean);
      lines.push(`${cap(who)} ${name}'s ${itemName(held)} was ${held === "berryjuice" ? "used" : "eaten"} at ${build.currentHP} HP${changes.length ? `: ${changes.join(", ")}` : ""}.`);
      settled = {
        ...settled, itemId: "", currentHP: hp, ...(pinchStat ? { boosts: { ...settled.boosts, [pinchStat]: clampStage((settled.boosts[pinchStat] ?? 0) + amount) } } : {}),
        ...(held === "custapberry" ? { settledCustap: true as const } : {}),
        ...(held === "lansatberry" ? { settledFocusEnergy: true as const } : {}),
      };
      // boost() passes the stages it actually raised to the foe's onFoeAfterBoost (Mirror Herb, Opportunist).
      const rise = pinchStat ? (settled.boosts[pinchStat] ?? 0) - (stagesBeforeBerry[pinchStat] ?? 0) : 0;
      if (rise > 0) raised = { [pinchStat]: rise };
      if (pinchStat === "spe") berrySpe = rise;
      if (open.length) starf = { stats: open, amount };
      if (held !== "berryjuice") eaten = held;
      if (hp !== build.currentHP) settledHP = { hp, entered: build.currentHP, maxHP, item: itemName(held) };
      usedUp = true;
      // A Custap Berry is eaten as the move is chosen, before the turn order is set.
      if (held !== "custapberry") usedAtUpdate = held;
    }
  }
  // An item Magic Room kept from acting: still unused under the room, and still held after it.
  const unused = conditions.magicRoom ? "is not used" : "is still held";
  if (seedUsed) lines.push(`${cap(who)} ${name}'s ${itemName(build.itemId)} was used up on ${conditions.terrain} Terrain${conditions.magicRoom ? " before Magic Room" : ""}: ${stages(boostScale, seedStat)}.`);
  else if (onSeedTerrain && !klutz) {
    lines.push(`${cap(who)} ${name}'s ${itemName(build.itemId)} ${unused}: Magic Room was up when it entered or ${conditions.terrain} Terrain started.`);
  }
  // Room Service lowers Speed by 1 on entry under Trick Room, or when Trick Room starts, unless Magic
  // Room is already up (pinned Showdown data/items.ts roomservice); the engine does not model it.
  const roomService = build.itemId === "roomservice" && conditions.trickRoom;
  const roomServiceUsed = roomService && !klutz && build.itemUsedBeforeRoom !== false;
  if (roomServiceUsed) lines.push(`${cap(who)} ${name}'s Room Service was used up under Trick Room${conditions.magicRoom ? " before Magic Room" : ""}: ${stages(-boostScale, "spe")}.`);
  else if (roomService && !klutz) {
    lines.push(`${cap(who)} ${name}'s Room Service ${unused}: Magic Room was up when it entered or Trick Room started.`);
  }
  if (build.abilityId === "unburden" && abilityOn) {
    if (usedUp || seedUsed || roomServiceUsed) {
      if (!build.abilityActive) lines.push(`${cap(who)} ${name}'s Unburden is active (${itemName(build.itemId)} used up).`);
      settled = { ...settled, abilityActive: true };
    } else if (build.abilityActive && build.itemId) {
      lines.push(`${cap(who)} ${name}'s Unburden is inactive (it holds its ${itemName(build.itemId)}).`);
      settled = { ...settled, abilityActive: false };
    }
  }
  // Protosynthesis and Quark Drive (pinned Showdown): active in sun (not Harsh Sunshine; Cloud Nine and
  // Air Lock remove it; Utility Umbrella does not) or on Electric Terrain, or else from Booster Energy,
  // which is then used up on entry. The other battler's Neutralizing Gas stops both.
  const paradox = PARADOX_FIELDS[build.abilityId];
  if (paradox && abilityOn && !build.transformedFrom) {
    const weatherless = [build, other].some((entry) => ["cloudnine", "airlock"].includes(entry.abilityId) && !gassedAbility(entry, entry === build ? other : build, conditions));
    const fieldOn = paradox === "sun" ? conditions.weather === "Sun" && !weatherless : conditions.terrain === "Electric";
    // With its field up, a Booster Energy was used only if the field was down at some point after the
    // holder entered (pinned Showdown boosterenergy onUpdate acts whenever its field is down, once its
    // switch-in onStart has run): the panel's choice. Without it, Magic Room set after it entered does not
    // undo a Booster Energy used on entry (usedBeforeRoom); one that met the room on entry stays unused even
    // after the room ends (the room skipped that onStart), with or without its field.
    const booster = settled.itemId === "boosterenergy" && !klutz && build.itemUsedBeforeRoom !== false
      && (fieldOn ? build.itemUsedBeforeField === true : true);
    // The other Pokémon's Cloud Nine or Air Lock is out. If the sun activated Protosynthesis before that
    // ability came in (the panel's choice), the Booster Energy was used up with no effect, its volatile
    // already existing, and the ability's WeatherChange then ended Protosynthesis; that stays so after the
    // sun ends or a Magic Room is set.
    const cloud = paradox === "sun" && booster && ["cloudnine", "airlock"].includes(other.abilityId) && !gassedAbility(other, build, conditions)
      ? runtime.abilitiesById.get(other.abilityId)?.name ?? other.abilityId : null;
    const burned = !!cloud && build.itemUsedBeforeField === false;
    // Which came first, its Seed or Room Service or the field activating the ability (the panel's choice,
    // model fieldItemChoice). On entry a Seed or Room Service (switch-in priority -1) acts before the
    // ability picks its stat (-2), but the foe's Drought, Orichalcum Pulse, Electric Surge or Hadron Engine
    // (priority 0) sets the field before both at a shared lead, a terrain or sun starting while it is out
    // runs its ability before its item (pinned Showdown runEvent subOrder: ability, then item), and Room
    // Service acts only on entry or when Trick Room starts.
    const foeSetsField = fieldOn && !gassedAbility(other, build, conditions) && PARADOX_FIELD_SETTERS[paradox].includes(other.abilityId);
    const itemFirst = build.itemUsedBeforeField ?? !foeSetsField;
    const fieldName = paradox === "sun" ? "the sun" : "Electric Terrain";
    if (burned) {
      lines.push(`${cap(who)} ${name}'s Protosynthesis is not active: the sun activated it before the other Pokémon's ${cloud} came in, and its Booster Energy was used up.`);
      settled = { ...settled, itemId: "" };
    } else if (!fieldOn && !booster && settled.itemId === "boosterenergy") {
      lines.push(klutz ? `${cap(who)} ${name}'s Booster Energy is not used (Klutz).` : `${cap(who)} ${name}'s Booster Energy ${unused}: it entered under Magic Room.`);
    } else if (fieldOn && !booster && settled.itemId === "boosterenergy" && !klutz) {
      lines.push(build.itemUsedBeforeRoom === false
        ? `${cap(who)} ${name}'s Booster Energy is still held: it entered under Magic Room.`
        : `${cap(who)} ${name}'s Booster Energy is still held (assumes ${fieldName} has been up since it entered).`);
    }
    if (!burned && (fieldOn || booster)) {
      const activated = { ...settled, boosts: stagesBeforeBerry };
      const spedDown = { ...activated, boosts: { ...activated.boosts, spe: clampStage((activated.boosts.spe ?? 0) - boostScale) } };
      // A Seed or Room Service used first is counted in the pick; one used after the field activated it is not.
      const pick = (first: boolean) => paradoxStat(first && roomServiceUsed ? spedDown : activated, other, conditions, runtime, !first);
      const stat = pick(booster || itemFirst);
      const otherOrder = !booster && (seedUsed || roomServiceUsed) ? pick(!itemFirst) : stat;
      settled = { ...settled, settledBoostedStat: stat, ...(booster ? { itemId: "" } : {}) };
      const abilityName = runtime.abilitiesById.get(build.abilityId)?.name;
      const usedUpText = fieldOn ? ` while ${fieldName} was down${conditions.magicRoom ? ", before Magic Room" : ""}` : usedBeforeRoom ? " before Magic Room" : "";
      // A Seed or Room Service used after the ability picked changed its stages since.
      const itemAfter = !booster && !itemFirst && (seedUsed || roomServiceUsed);
      const beforeItem = itemAfter && otherOrder !== stat ? (seedUsed ? " before its Seed" : " before Room Service") : "";
      lines.push(`${cap(who)} ${name}'s ${abilityName} boosts its ${STAGE_NAMES[stat]} (its highest stat${beforeItem}), ${booster ? `from its Booster Energy (used up${usedUpText})` : paradox === "sun" ? "in the sun" : "on Electric Terrain"}. Assumes no stage changes since it activated${itemAfter ? ", other than its item's" : ""}.`);
      if (cloud && conditions.weather === "Sun") {
        lines.push(`Assumes the other Pokémon's ${cloud} was out when ${name} entered, or the sun was down at some point since.`);
      }
      if (otherOrder !== stat) {
        const acted = seedUsed ? `its ${itemName(build.itemId)} was used` : "Room Service lowered its Speed";
        const why = build.itemUsedBeforeField !== undefined ? ""
          : foeSetsField ? ` (assumes both entered together and the other Pokémon's ${runtime.abilitiesById.get(other.abilityId)?.name} set ${fieldName} first)`
            : !seedUsed ? " (assumes Trick Room was up when it entered)"
              : paradox === "terrain" ? " (assumes Electric Terrain was up when it entered)" : ` (assumes ${conditions.terrain} Terrain was up before the sun started, or both were up when it entered)`;
        lines.push(itemFirst
          ? `${cap(who)} ${name}'s ${cap(acted.replace(/^its /, ""))} before ${abilityName} activated${why}.`
          : `${cap(who)} ${name}'s ${abilityName} activated before ${acted}${why}.`);
      }
    }
  }
  // The engine drops a Magic Room item before its checkSeedBoost, so a Seed used before the room goes
  // in as its stage with the item gone (Acrobatics, Knock Off and Poltergeist then see no item). After
  // the paradox stat, whose "before the Seed" pass must not see this rise.
  if (seedUsed && conditions.magicRoom) {
    settled = { ...settled, itemId: "", boosts: { ...settled.boosts, [seedStat]: clampStage((settled.boosts[seedStat] ?? 0) + boostScale) } };
  }
  // Room Service goes in the same way (the paradox stat above already saw its drop where it came first).
  if (roomServiceUsed) {
    settled = { ...settled, itemId: "", boosts: { ...settled.boosts, spe: clampStage((settled.boosts.spe ?? 0) - boostScale) } };
  }
  // Generation 7 keeps the order the turn's actions were sorted in before its first Update (pinned Showdown
  // sim/battle.ts runAction sorts the queue again after an action only from generation 8): the Speed stage and
  // Unburden from before the item used there (a Seed or Room Service used on entry had activated it).
  if (usedAtUpdate && runtime.profile.generation === 7) {
    const unburden = build.abilityId === "unburden" && abilityOn;
    const unburdenBefore = unburden && (seedUsed || roomServiceUsed);
    if (berrySpe !== 0 || (unburden && settled.abilityActive && !unburdenBefore)) {
      settled = { ...settled, firstTurnSpeed: { spe: (settled.boosts.spe ?? 0) - berrySpe, unburden: unburdenBefore, item: itemName(usedAtUpdate) } };
    }
  }
  return {
    build: settled, lines, ...(settledHP ? { settledHP } : {}), ...(starf ? { starf } : {}), ...(eaten ? { eaten } : {}),
    ...(raised ? { raised } : {}), ...(confused ? { confused: true as const } : {}),
  };
}

const PARADOX_FIELDS: Record<string, "sun" | "terrain"> = { protosynthesis: "sun", quarkdrive: "terrain" };

/**
 * The form Shields Down or Schooling gives this Pokémon at its current HP, when it differs from the
 * selected one. `kept` means its HP crossed the line this turn (the panel's switch), so the form
 * changes only at the end of the turn; below level 20 Wishiwashi is always Solo.
 */
function entryForm(build: BattleBuild, runtime: BattleRuntime): { speciesId: string; ability: string; why: string; kept: boolean } | null {
  if (build.transformedFrom) return null;
  const species = runtime.speciesById.get(build.speciesId);
  if (!species) return null;
  const stats = getBuildStats(build, runtime);
  const hp = build.currentHP ?? stats?.hp ?? 0;
  const max = stats?.hp ?? 0;
  const pick = (speciesId: string, ability: string, why: string, fixed = false) => speciesId !== build.speciesId && runtime.speciesById.has(speciesId)
    ? { speciesId, ability, why, kept: !fixed && build.abilityActive } : null;
  if (build.abilityId === "shieldsdown" && species.baseSpecies === "minior" && max) {
    // Its core form is the selected colour; a selected Meteor Form falls back to the plain core.
    return hp > max / 2 ? pick("miniormeteor", "Shields Down", "above half its HP")
      : build.speciesId === "miniormeteor" ? pick("minior", "Shields Down", "at half its HP or less") : null;
  }
  if (build.abilityId === "schooling" && species.baseSpecies === "wishiwashi" && max && build.game !== "champions") {
    const schools = (build.native.level ?? 100) >= 20 && hp > max / 4;
    return schools ? pick("wishiwashischool", "Schooling", "above a quarter of its HP at level 20 or higher")
      : (build.native.level ?? 100) < 20 ? pick("wishiwashi", "Schooling", "below level 20", true) : pick("wishiwashi", "Schooling", "at a quarter of its HP or less");
  }
  return null;
}

/** An intact Ice Face takes the first physical hit and an intact Disguise the first hit of any
 * category (pinned Showdown iceface and disguise onDamage), unless Mold Breaker or an ignoreAbility
 * move bypasses them; Ability Shield keeps them even then. onDamage runs only for a hit that connects:
 * an immune target or a move that fails leaves the face or disguise intact. */
const ICE_FACE_REASON = "Intact Ice Face takes the first physical hit.";
const DISGUISE_REASON = "Intact Disguise takes the first hit.";

/** Attacks that fail unless the user has this type (pinned Showdown onTryMove). */
const TYPE_GATED_MOVES: Record<string, "Electric" | "Fire"> = { doubleshock: "Electric", burnup: "Fire" };

/** Signature attacks that fail for any other user (pinned Showdown onTry). */
const USER_RESTRICTED_MOVES: Record<string, { allowed: (species: ChampionsSpecies) => boolean; who: string }> = {
  aurawheel: { allowed: (species) => species.baseSpecies === "morpeko", who: "Morpeko" },
  hyperspacefury: { allowed: (species) => species.id === "hoopaunbound", who: "Hoopa-Unbound" },
};
const EMBODY_STATS: Record<string, string> = {
  embodyaspectteal: "Speed", embodyaspecthearthflame: "Attack", embodyaspectwellspring: "Sp. Def", embodyaspectcornerstone: "Defense",
};

/**
 * The stat Protosynthesis or Quark Drive boosts (pinned Showdown getBestStat(false, true)): the highest
 * stat with its stages, counting a terrain Seed used up on entry just before; under Wonder Room each
 * defensive stat uses the other's stage. Ties go to Attack, Defense, Sp. Atk, Sp. Def, Speed in order.
 */
function paradoxStat(build: BattleBuild, other: BattleBuild, conditions: BattleConditions, runtime: BattleRuntime, beforeSeed = false): (typeof COMBAT_STATS)[number] {
  const stats = getBuildStats(build, runtime);
  if (!stats) return "atk";
  const entry = beforeSeed ? [] : entryBoosts(build, other, null, false, intimidateBattle(conditions, false, false), runtime).filter((boost) => SEED_TERRAINS[boost.id]);
  const stage = (stat: (typeof COMBAT_STATS)[number]) => clampStage((build.boosts[stat] ?? 0) + entry.filter((boost) => boost.stat === stat).reduce((sum, boost) => sum + boost.amount, 0));
  return paradoxBestStat(stats, stage, conditions.wonderRoom);
}

/** Abilities Neutralizing Gas cannot suppress (the engine's own ignoresNeutralizingGas list). */
const GAS_PROOF_ABILITIES = new Set(["asoneglastrier", "asonespectrier", "battlebond", "comatose", "disguise", "gulpmissile", "iceface", "multitype", "neutralizinggas", "powerconstruct", "rkssystem", "schooling", "shieldsdown", "stancechange", "terashift", "zenmode", "zerotohero"]);
/** The other battler's Neutralizing Gas suppresses this ability (unless Ability Shield keeps it). */
const gassedAbility = (build: BattleBuild, other: BattleBuild, conditions: BattleConditions) =>
  other.abilityId === "neutralizinggas" && !GAS_PROOF_ABILITIES.has(build.abilityId) && !shieldsAbility(build, conditions);
const UMBRELLA_SUN_ABILITIES = new Set(["chlorophyll", "solarpower", "flowergift"]);
/** Utility Umbrella makes its holder ignore sun and rain (Showdown effectiveWeather) for these abilities. */
const umbrellaBlocksAbility = (build: BattleBuild, other: BattleBuild, conditions: BattleConditions) =>
  build.itemId === "utilityumbrella" && !conditions.magicRoom && !klutzActive(build, other)
  && ((UMBRELLA_SUN_ABILITIES.has(build.abilityId) && ["Sun", "Harsh Sunshine"].includes(conditions.weather))
    || (build.abilityId === "swiftswim" && ["Rain", "Heavy Rain"].includes(conditions.weather)));

/** Showdown's pokeRound: halves round down. */
const pokeRound = (value: number) => value % 1 > 0.5 ? Math.ceil(value) : Math.floor(value);
/** Multi-hit moves whose power grows each hit (Showdown basePowerCallback: power x hit number). */
const ESCALATING_MOVES = new Set(["tripleaxel", "triplekick"]);
/** Ability conditions that matter for a Pokémon receiving an attack: its Speed, typing or Defense. */
const RECEIVER_CONDITIONS = new Set(["unburden", "slowstart", "protean", "libero", "imposter", "dauntlessshield"]);

/** Items the engine's checkItem keeps for a Klutz holder (util.js EV_ITEMS). */
const ENGINE_KLUTZ_KEPT_ITEMS = new Set(["machobrace", "poweranklet", "powerband", "powerbelt", "powerbracer", "powerlens", "powerweight"]);

/** Klutz works unless the other battler's Neutralizing Gas suppresses it (an Ability Shield holder keeps it). */
const klutzActive = (build: BattleBuild, other: BattleBuild) =>
  build.abilityId === "klutz" && !(other.abilityId === "neutralizinggas" && build.itemId !== "abilityshield");

/** A copy without its held item when Showdown's ignoringItem() holds: Magic Room, or an active Klutz. */
/**
 * The priority a move is used with (pinned Showdown getActionSpeed, after onModifyPriority), for turn
 * order and priority shields; the engines raise Gale Wings and Triage too late for either, and never
 * Grassy Glide. Showdown applies abilities after Z/Max conversion, so the effective Flying attack gains
 * Gale Wings' +1, not its untransformed base move; Hidden Power is queued as the dex Normal move (its type
 * comes later, in onModifyType), so Gale Wings never raises it. Triage gives a healing move +3 (flags.heal:
 * for damaging moves, the draining ones). Grassy Glide gains +1 on Grassy Terrain for a grounded user,
 * where Showdown's isGrounded ignores an Iron Ball or Air Balloon under Magic Room or Klutz (the target's
 * Neutralizing Gas suppresses Klutz); the engine clears it only inside calculate().
 */
function usedPriority(metadata: ChampionsMove, assigned: ChampionsMove, resolved: { transformed: boolean; move: Move }, attacker: Pokemon,
  attackerBuild: BattleBuild, defenderBuild: BattleBuild, conditions: BattleConditions): { priority: number; grassyGlide: boolean } {
  let priority = resolved.move.priority;
  if (attacker.hasAbility("Gale Wings") && metadata.type === "Flying" && attacker.curHP() === attacker.maxHP()
    && (resolved.transformed || !assigned.id.startsWith("hiddenpower"))) {
    priority = metadata.priority + 1;
  }
  if (attacker.hasAbility("Triage") && resolved.move.drain) priority = metadata.priority + 3;
  const grassyGlide = metadata.id === "grassyglide" && conditions.terrain === "Grassy"
    && isGrounded(ignoringItem(attacker, attackerBuild, defenderBuild, conditions), makeField(conditions));
  if (grassyGlide) priority = metadata.priority + 1;
  return { priority, grassyGlide };
}

function ignoringItem(pokemon: Pokemon, build: BattleBuild, other: BattleBuild, conditions: BattleConditions): Pokemon {
  const klutz = klutzActive(build, other);
  if (!pokemon.item || !(conditions.magicRoom || klutz)) return pokemon;
  const copy = pokemon.clone();
  copy.item = undefined;
  return copy;
}

/** Ability Shield keeps an ability through Neutralizing Gas, except under Magic Room. */
const shieldsAbility = (build: BattleBuild, conditions: BattleConditions) => build.itemId === "abilityshield" && !conditions.magicRoom;

const windRiderSuppressed = (holder: BattleBuild, other: BattleBuild, conditions: BattleConditions) =>
  other.abilityId === "neutralizinggas" && !shieldsAbility(holder, conditions);

/** Damp on either battler stops explosions; Mold Breaker ignores the target's, and Neutralizing Gas suppresses it. */
function dampPrevents(attacker: BattleBuild, defender: BattleBuild): boolean {
  const gas = [attacker, defender].some((build) => build.abilityId === "neutralizinggas");
  return !gas && (attacker.abilityId === "damp" || (defender.abilityId === "damp" && !ABILITY_IGNORERS.has(attacker.abilityId)));
}

/**
 * An attack into a Protecting Pokémon, as pinned Showdown resolves it (battle.ts
 * checkMoveBypassesProtect, battle-actions.ts modifyDamage). Moves without the protect flag hit
 * in full, and so do the main games' Unseen Fist contact moves (it removes the flag). Z-Moves and
 * Max Moves, except G-Max One Blow and Rapid Flow, and in Champions contact moves from Unseen Fist
 * or Piercing Drill, deal a quarter after every other damage modifier.
 */
function protectOutcome(move: ChampionsMove, engineMove: Move, attacker: BattleBuild, defender: BattleBuild, conditions: BattleConditions, runtime: BattleRuntime): ProtectOutcome {
  if (PROTECT_IGNORING_MOVES.has(move.id)) return { kind: "full", line: `Protect does not block ${move.name}.` };
  // The target's Neutralizing Gas suppresses the ability unless Ability Shield (not under Magic Room) keeps it.
  const suppressed = defender.abilityId === "neutralizinggas" && !shieldsAbility(attacker, conditions);
  // Punching Glove removes contact from punching moves (Showdown data/items.ts).
  const contact = !!engineMove.flags.contact && !(attacker.itemId === "punchingglove" && engineMove.flags.punch && !conditions.magicRoom);
  const piercing = !suppressed && contact && (attacker.abilityId === "unseenfist" || (runtime.profile.id === "champions" && attacker.abilityId === "piercingdrill"));
  const ability = runtime.abilitiesById.get(attacker.abilityId)?.name ?? attacker.abilityId;
  if (runtime.profile.id === "champions") {
    return piercing ? { kind: "quarter", line: `Protect: ${ability} gets this contact move through at 1/4 damage.` } : { kind: "blocked" };
  }
  if (engineMove.isZ || engineMove.isMax || move.isZ || move.isMax || isMaxActive(attacker)) return { kind: "quarter", line: `Protect: ${move.name} breaks through at 1/4 damage.` };
  if (piercing) return { kind: "full", line: "Protect: Unseen Fist gets this contact move through in full." };
  return { kind: "blocked" };
}

/**
 * Damaging moves pinned Showdown's Parental Bond never doubles (data/abilities.ts onPrepareHit):
 * the charge, futuremove and noparentalbond flags, across the four games' catalogs. Multi-hit
 * moves, spread hits and Z/Max Moves are excluded separately.
 */
const NO_PARENTAL_BOND_MOVES = new Set([
  "bounce", "dig", "dive", "doomdesire", "dragondarts", "dynamaxcannon", "electroshot", "endeavor", "explosion",
  "finalgambit", "fling", "fly", "freezeshock", "futuresight", "iceball", "iceburn", "meteorbeam", "phantomforce",
  "razorwind", "rollout", "selfdestruct", "shadowforce", "skullbash", "skyattack", "skydrop", "solarbeam", "solarblade",
]);

/** Why Showdown's Parental Bond adds no second strike to this move, or null when it does. */
function parentalBondSkip(move: ChampionsMove, engineMove: Move, conditions: BattleConditions, hits: number): string | null {
  if (NO_PARENTAL_BOND_MOVES.has(move.id)) return "excluded move";
  if (move.multihit !== null || hits > 1) return "multi-hit move";
  if (move.isZ || move.isMax || engineMove.isZ || engineMove.isMax) return engineMove.isMax || move.isMax ? "Max Move" : "Z-Move";
  if (conditions.gameType === "Doubles" && ["allAdjacent", "allAdjacentFoes"].includes(engineMove.target)) return "spread hit";
  return null;
}

/**
 * Parental Bond's second strike, at a quarter of the damage (the engine's "Parental Bond (Child)"),
 * from fresh Pokémon so each one-shot setup (Wonder Room's swap) applies once. The engine's
 * between-hit effects (checkMultihitBoost: Stamina, Weak Armor, Seed Sower, Luminous Moss, Power-Up
 * Punch, a lowered stat...) apply once more, as in its own recursion, with these corrections from
 * pinned Showdown: a resist berry eaten by the first strike is gone; a terrain Seed the first strike
 * used up on the terrain at use keeps its +1 after Seed Sower changes the terrain; Kee Berry, Maranga
 * Berry and White Herb act only after the whole move; Magic Room and Klutz stop the target's item
 * (Luminous Moss) between strikes too; Terrain Pulse keeps the type and power it had at use; and
 * Mummy, Lingering Aroma or Wandering Spirit replacing Parental Bond after contact keeps the quarter
 * (Showdown set the strike count at PrepareHit).
 */
function parentalBondStrike(generation: Generation, attacker: Pokemon, defender: Pokemon, move: Move, conditions: BattleConditions, first: Result, burned: boolean): Result["damage"] {
  const child = attacker.clone();
  if (burned) child.status = "brn";
  const target = defender.clone();
  child.ability = "Parental Bond (Child)" as AbilityName;
  const field = makeField(conditions);
  const terrainAtUse = field.terrain;
  const groundedAtUse = isGrounded(child, field);
  if (first.rawDesc.defenderItem && getBerryResistType(first.rawDesc.defenderItem)) target.item = undefined;
  // The engine's checkItem clears a Magic Room or Klutz item only inside calculate().
  const suppressed = !!target.item && (conditions.magicRoom || target.hasAbility("Klutz"));
  if (!suppressed) checkSeedBoost(target, field);
  const held = target.item;
  const hidden = suppressed || held === "Kee Berry" || held === "Maranga Berry" || held === "White Herb";
  if (hidden) target.item = undefined;
  const ability = target.ability;
  checkMultihitBoost(generation, child, target, move, field, {} as Result["rawDesc"]);
  child.ability = "Parental Bond (Child)" as AbilityName;
  target.ability = ability;
  if (hidden) target.item = held;
  let strike = move;
  if (move.originalName === "Terrain Pulse" && field.terrain !== terrainAtUse) {
    // Showdown sets Terrain Pulse's type and power at use (onModifyType / onModifyMove); the engine
    // would read them again from Seed Sower's Grassy Terrain by its name. A pulse move with no
    // name-keyed engine branch carries them instead.
    strike = new EngineMove(generation, "Dragon Pulse", {
      isCrit: move.isCrit, hits: 1,
      overrides: { name: "Terrain Pulse (type and power at use)" as MoveName, type: first.move.type, basePower: move.bp * (groundedAtUse && terrainAtUse ? 2 : 1) },
    });
  }
  return calculate(generation, child, target, strike, field).damage;
}

/** Abilities whose holder cannot be burned (pinned Showdown onSetStatus / onUpdate). */
const BURN_IMMUNE_ABILITIES = new Set(["waterveil", "waterbubble", "thermalexchange", "comatose", "purifyingsalt"]);

/**
 * The first hit (0-based) of the move made by an attacker burned by the target's Spicy Spray
 * (Champions: data/abilities.ts onDamagingHit trySetStatus('brn')), or null when it never burns.
 * Every hit from that one on is by a burned attacker. Showdown's status rules decide: an existing
 * status, the Fire type (its Tera type when Terastallized), Water Veil, Water Bubble, Thermal
 * Exchange, Comatose, Purifying Salt, Leaf Guard in sun, Flower Veil on a Grass type and a grounded
 * attacker on Misty Terrain stop it. A Lum or Rawst Berry (not under Magic Room or Klutz) cures the
 * first burn at once and is used up, so the second hit burns the attacker again: from the third hit on.
 */
function spicySprayFirstBurnedHit(first: Result, attackerBuild: BattleBuild, conditions: BattleConditions): number | null {
  const { attacker, defender, field } = first;
  if (!defender.hasAbility("Spicy Spray") || attackerBuild.status || first.range()[1] === 0) return null;
  const types: string[] = attacker.teraType && attacker.teraType !== "Stellar" ? [attacker.teraType] : [...attacker.types];
  if (types.includes("Fire")) return null;
  if (BURN_IMMUNE_ABILITIES.has(toID(attacker.ability ?? ""))) return null;
  if (attacker.hasAbility("Leaf Guard") && field.hasWeather("Sun", "Harsh Sunshine") && !attacker.hasItem("Utility Umbrella")) return null;
  if (attacker.hasAbility("Flower Veil") && types.includes("Grass")) return null;
  if (field.hasTerrain("Misty") && isGrounded(attacker, field)) return null;
  if (!conditions.magicRoom && !attacker.hasAbility("Klutz") && attacker.hasItem("Lum Berry", "Rawst Berry")) return 2;
  return 1;
}

/** Moves whose power the engine sets from the two Pokémon's Speed or turn order. */
const SPEED_POWER_MOVES = new Set(["electroball", "gyroball", "boltbeak", "fishiousrend"]);

type TurnOrder = { order: "first" | "last" | "tie"; reason: string; bySpeed: boolean; notes: string[] };

/**
 * Whether this attack comes before the target's move, as pinned Showdown orders a turn (sim/battle.ts
 * comparePriority: priority, then fractional priority, then Speed, with Trick Room letting the slower
 * Pokémon move first and a tie decided at random). The target is assumed to use a priority-0 move.
 * Speeds are the engine's final Speed from `probe` (Tailwind, paralysis, items, abilities, stages).
 */
function turnOrderAgainstTarget(probe: Result, priority: number, attackerBuild: BattleBuild, defenderBuild: BattleBuild, conditions: BattleConditions, runtime: BattleRuntime): TurnOrder {
  const notes = ["Assumes the target uses a 0-priority move."];
  if (priority !== 0) return { order: priority > 0 ? "first" : "last", reason: `${priority > 0 ? "+" : ""}${priority} priority`, bySpeed: false, notes };
  const itemName = (id: string) => runtime.itemsById.get(id)?.name ?? id;
  // Fractional priority: Lagging Tail, Full Incense and Stall make the holder move last in its
  // bracket; an eaten Custap Berry (at 1/4 HP, or 1/2 with Gluttony) makes it move first. settleItems
  // eats one held at its line before the move (settledCustap).
  const fraction = (build: BattleBuild, other: BattleBuild, pokemon: Pokemon, who: string) => {
    const itemOn = !conditions.magicRoom && !(build.abilityId === "klutz" && other.abilityId !== "neutralizinggas");
    const abilityOn = !(other.abilityId === "neutralizinggas" && !shieldsAbility(build, conditions));
    const unnerved = ["unnerve", "asoneglastrier", "asonespectrier"].includes(other.abilityId) && !gassedAbility(other, build, conditions);
    const hp = pokemon.curHP(), max = pokemon.maxHP();
    if (build.settledCustap || (itemOn && build.itemId === "custapberry" && !unnerved && (hp <= max / 4 || (hp <= max / 2 && abilityOn && build.abilityId === "gluttony")))) {
      return { value: 0.1, why: `${who} Custap Berry` };
    }
    // Quick Claw and Quick Draw run after the constant -0.1 handlers and can still return 0.1.
    if (itemOn && build.itemId === "quickclaw") notes.push(`Assumes ${who} Quick Claw does not activate (20% chance).`);
    if (abilityOn && build.abilityId === "quickdraw") notes.push(`Assumes ${who} Quick Draw does not activate (30% chance).`);
    if (itemOn && ["laggingtail", "fullincense"].includes(build.itemId)) return { value: -0.1, why: `${who} ${itemName(build.itemId)}` };
    if (abilityOn && build.abilityId === "stall") return { value: -0.1, why: `${who} Stall` };
    return { value: 0, why: "" };
  };
  const own = fraction(attackerBuild, defenderBuild, probe.attacker, "the attacker's");
  const theirs = fraction(defenderBuild, attackerBuild, probe.defender, "the target's");
  if (own.value !== theirs.value) {
    return { order: own.value > theirs.value ? "first" : "last", reason: [own.why, theirs.why].filter(Boolean).join(" and "), bySpeed: false, notes };
  }
  // Generation 7 orders the turn from the Speed before the item used at its first Update (settleItems firstTurnSpeed).
  const speed = (pokemon: Pokemon, build: BattleBuild, side: Result["field"]["attackerSide"], who: string) => {
    const before = build.firstTurnSpeed;
    if (!before && (!pokemon.isDynamaxed || !pokemon.hasItem("Choice Scarf"))) return pokemon.stats.spe;
    const copy = pokemon.clone();
    if (pokemon.isDynamaxed && pokemon.hasItem("Choice Scarf")) copy.item = undefined;
    if (before) {
      copy.boosts.spe = before.spe;
      if (copy.hasAbility("Unburden")) copy.abilityOn = before.unburden;
      const set = getFinalSpeed(probe.gen, copy, probe.field, side);
      if (set !== getFinalSpeed(probe.gen, pokemon, probe.field, side)) notes.push(`The turn order was set before ${who} ${before.item} was used (generation 7).`);
      return set;
    }
    return getFinalSpeed(probe.gen, copy, probe.field, side);
  };
  const mine = speed(probe.attacker, attackerBuild, probe.field.attackerSide, "the attacker's"), target = speed(probe.defender, defenderBuild, probe.field.defenderSide, "the target's");
  if (mine === target) return { order: "tie", reason: `Speed tie at ${mine}`, bySpeed: true, notes };
  const first = conditions.trickRoom ? mine < target : mine > target;
  return {
    order: first ? "first" : "last",
    reason: `${mine} Speed against ${target}${conditions.trickRoom ? " under Trick Room" : ""}`,
    bySpeed: true, notes,
  };
}

/**
 * Showdown's modify(damage, 0.25) after the final modifiers, with its minimum of 1. An immune target
 * stays at 0: Showdown checks immunity after the Protect bypass and never reaches modifyDamage.
 */
const quarterDamage = (damage: number) => damage === 0 ? 0 : Math.max(1, Math.trunc((damage * 1024 + 2047) / 4096));

/** Moves whose onTry needs the target still about to use an attacking move, which a Protecting target never is. */
const TARGET_ATTACK_MOVES = new Set(["suckerpunch", "thunderclap", "upperhand"]);

/** Moves whose damage is fixed, so damage modifiers such as Friend Guard never apply. */

// Pinned Showdown's Friend Guard, Queenly Majesty, Dazzling and Armor Tail (data/abilities.ts) are
// breakable, so these attackers ignore a partner's; Neutralizing Gas on either battler suppresses
// them, Mold Breaker included. The engine applies Friend Guard unconditionally and has no partner
// shield. The partner's own Ability Shield, which keeps them through both, is not modelled.
const ABILITY_IGNORERS = new Set(["moldbreaker", "teravolt", "turboblaze"]);

export function partnerAbilitySuppressor(attacker: BattleBuild, defender: BattleBuild, runtime: BattleRuntime): string | null {
  if ([attacker, defender].some((build) => build.abilityId === "neutralizinggas")) return "Neutralizing Gas";
  if (ABILITY_IGNORERS.has(attacker.abilityId)) return runtime.abilitiesById.get(attacker.abilityId)?.name ?? attacker.abilityId;
  return null;
}

/**
 * The target abilities the engine lets Mold Breaker and ignoreAbility moves bypass (gen789.js
 * defenderAbilityIgnored). The engine's own list of such moves spells G-Max Fireball "G-Max Fire
 * Ball", so the calculation applies this rule to it itself.
 */
const ENGINE_BYPASSED_ABILITIES = new Set([
  "Armor Tail", "Aroma Veil", "Aura Break", "Battle Armor", "Big Pecks", "Bulletproof", "Clear Body", "Contrary", "Damp", "Dazzling",
  "Disguise", "Dry Skin", "Earth Eater", "Eelevate", "Filter", "Flash Fire", "Flower Gift", "Flower Veil", "Fluffy", "Friend Guard",
  "Fur Coat", "Good as Gold", "Grass Pelt", "Guard Dog", "Heatproof", "Heavy Metal", "Hyper Cutter", "Ice Face", "Ice Scales",
  "Illuminate", "Immunity", "Inner Focus", "Insomnia", "Keen Eye", "Leaf Guard", "Levitate", "Light Metal", "Lightning Rod", "Limber",
  "Magic Bounce", "Magma Armor", "Marvel Scale", "Mind's Eye", "Mirror Armor", "Motor Drive", "Multiscale", "Oblivious", "Overcoat",
  "Own Tempo", "Pastel Veil", "Punk Rock", "Purifying Salt", "Queenly Majesty", "Sand Veil", "Sap Sipper", "Shell Armor", "Shield Dust",
  "Simple", "Snow Cloak", "Solid Rock", "Soundproof", "Sticky Hold", "Storm Drain", "Sturdy", "Suction Cups", "Sweet Veil",
  "Tangled Feet", "Telepathy", "Tera Shell", "Thermal Exchange", "Thick Fat", "Unaware", "Vital Spirit", "Volt Absorb", "Water Absorb",
  "Water Bubble", "Water Veil", "Well-Baked Body", "White Smoke", "Wind Rider", "Wonder Guard", "Wonder Skin",
]);

/** Moves with a critical-hit ratio above the default 1 (pinned Showdown data/moves.ts critRatio). */
const CRIT_RATIO_MOVES: Record<string, number> = Object.fromEntries([
  ...["aeroblast", "aircutter", "aquacutter", "attackorder", "blazekick", "crabhammer", "crosschop", "crosspoison", "drillrun", "esperwing", "ivycudgel",
    "karatechop", "leafblade", "nightslash", "poisontail", "psychocut", "razorleaf", "razorwind", "shadowclaw", "skyattack", "slash", "snipeshot",
    "spacialrend", "stoneedge", "triplearrows"].map((id) => [id, 2]),
  ["10000000voltthunderbolt", 3],
]);

/**
 * The attacker's critical-hit ratio, when it makes every hit critical (pinned Showdown battle-actions.ts getDamage:
 * the used move's critRatio, then ModifyCritRatio: a Lansat Berry's focusenergy +2, Super Luck +1, Scope Lens and
 * Razor Claw +1, Leek +2 for Farfetch'd and Sirfetch'd and Lucky Punch +2 for Chansey by their own species;
 * from generation 6 a ratio of 4 or more, capped at 4, crits at critMult[4] = 1): the stages over the default 1
 * and what gave them, or null. A Z-Move or Max Move has its own ratio (only 10,000,000 Volt Thunderbolt's is raised).
 */
function certainCrit(moveId: string, build: BattleBuild, other: BattleBuild, context: MoveContext | undefined, conditions: BattleConditions, runtime: BattleRuntime): { stages: number; sources: string[] } | null {
  if (runtime.profile.generation < 6) return null;
  const { ratio, sources } = critRatio(moveId, build, other, context, conditions, runtime);
  return ratio >= 4 ? { stages: ratio - 1, sources } : null;
}

/** certainCrit's ratio (1 by default) and what raised it, whether or not it makes every hit critical. */
function critRatio(moveId: string, build: BattleBuild, other: BattleBuild, context: MoveContext | undefined, conditions: BattleConditions, runtime: BattleRuntime): { ratio: number; sources: string[] } {
  const sources: string[] = [];
  let ratio = 1;
  const used = context?.useZ ? (build.itemId === "pikashuniumz" && moveId === "thunderbolt" ? "10000000voltthunderbolt" : "") : isMaxActive(build) ? "" : moveId;
  const raised = CRIT_RATIO_MOVES[used];
  if (raised) { ratio = raised; sources.push(runtime.movesById.get(used)?.name ?? (used === "10000000voltthunderbolt" ? "10,000,000 Volt Thunderbolt" : used)); }
  if (build.settledFocusEnergy) { ratio += 2; sources.push("the Lansat Berry"); }
  if (build.abilityId === "superluck" && !gassedAbility(build, other, conditions)) { ratio += 1; sources.push("Super Luck"); }
  const own = runtime.speciesById.get(build.transformedFrom?.speciesId ?? build.speciesId)?.baseSpecies;
  const item = !conditions.magicRoom && !klutzActive(build, other) ? build.itemId : "";
  const itemBoost = item === "scopelens" || item === "razorclaw" ? 1 : item === "leek" && (own === "farfetchd" || own === "sirfetchd") ? 2
    : item === "luckypunch" && own === "chansey" ? 2 : 0;
  if (itemBoost) { ratio += itemBoost; sources.push(runtime.itemsById.get(item)?.name ?? item); }
  return { ratio, sources };
}

/** Moves with pinned Showdown's ignoreAbility (data/moves.ts): they bypass breakable abilities. */
const IGNORE_ABILITY_MOVES = new Set([
  "sunsteelstrike", "moongeistbeam", "photongeyser", "lightthatburnsthesky", "searingsunrazesmash",
  "menacingmoonrazemaelstrom", "gmaxdrumsolo", "gmaxfireball", "gmaxhydrosnipe",
]);

const FINAL_MOD_ATTACKER_ABILITIES = new Set(["Neuroforce", "Sniper", "Tinted Lens"]);
const FINAL_MOD_DEFENDER_ABILITIES = new Set(["Multiscale", "Shadow Shield", "Fluffy", "Aura Guard", "Punk Rock", "Ice Scales", "Solid Rock", "Filter", "Prism Armor"]);
const FINAL_MOD_ATTACKER_ITEMS = new Set(["Expert Belt", "Life Orb", "Metronome"]);

/**
 * The final damage modifiers the engine chained (calculateFinalMods), from what it reports. With
 * Friend Guard and two or more others its fixed order can round 1 HP away from pinned Showdown,
 * which orders them by each holder's Speed with screens last (battle.ts comparePriority).
 */
/**
 * Whether pinned Showdown's Shell Side Arm ties (data/moves.ts shellsidearm onModifyMove). It compares
 * floor(floor(floor(2 * level / 5 + 2) * 90 * Atk / Def) / 50) with the same for Sp. Atk and Sp. Def, from
 * stats with their stages only (getStat unmodified: no items, abilities, burn or screens; under Wonder Room
 * each stored defense keeps its value and takes the other one's stage), and on a tie picks at random
 * (randomChance(1, 2)). The engine's getShellSideArmCategory compares the unfloored ratios with a strict
 * ">", which gives Showdown's category whenever the estimates differ (the floors are monotonic) but one
 * fixed category on a tie. `result` is an engine run of the move: its stats are the final ones, with the
 * raw defenses already swapped for Wonder Room.
 */
function shellSideArmTies({ attacker, defender, field }: Result): boolean {
  const base = Math.floor(2 * attacker.level / 5 + 2) * 90;
  const estimate = (attack: number, defense: number) => Math.floor(Math.floor(base * attack / defense) / 50);
  const [def, spd] = field.isWonderRoom ? [defender.stats.spd, defender.stats.def] : [defender.stats.def, defender.stats.spd];
  return estimate(attacker.stats.atk, def) === estimate(attacker.stats.spa, spd);
}

/** The effects a row's description lists as applied. */
function appliedEffects({ rawDesc: desc }: Result) {
  return [desc.attackerAbility, desc.defenderAbility, desc.attackerItem, desc.defenderItem, desc.weather, desc.terrain].filter(Boolean);
}

function finalModifierCount({ rawDesc: desc, attacker, defender, move }: Result): number {
  let count = Number(!!desc.isFriendGuard) + Number(!!(desc.isReflect || desc.isLightScreen)) + Number(!!desc.isAuroraVeil);
  if (desc.attackerAbility && FINAL_MOD_ATTACKER_ABILITIES.has(desc.attackerAbility)) count++;
  if (desc.defenderAbility && FINAL_MOD_DEFENDER_ABILITIES.has(desc.defenderAbility)) {
    // Fluffy halves a contact move and doubles a Fire one; a contact Fire move gets both.
    count += desc.defenderAbility === "Fluffy" && move.flags.contact && move.hasType("Fire") && !attacker.hasAbility("Long Reach") ? 2 : 1;
  }
  if (desc.attackerItem && FINAL_MOD_ATTACKER_ITEMS.has(desc.attackerItem)) count++;
  if (desc.defenderItem && getBerryResistType(desc.defenderItem)) count++;
  if (defender.isDynamaxed && move.named("Dynamax Cannon", "Behemoth Blade", "Behemoth Bash")) count++;
  return count;
}

function makeField(field: BattleConditions) {
  return new Field({
    gameType: field.gameType,
    weather: field.weather || undefined,
    terrain: field.terrain || undefined,
    isGravity: field.gravity,
    isWonderRoom: field.wonderRoom,
    isMagicRoom: field.magicRoom,
    isFairyAura: field.fairyAura,
    // The doubles turn's Ruin abilities and auras on another active Pokémon (the engine applies a Ruin once,
    // whether from the attacker or the field, gen789.js 1237-1247); 1v1 never sets them.
    ...(field.ruin?.sword ? { isSwordOfRuin: true } : {}),
    ...(field.ruin?.beads ? { isBeadsOfRuin: true } : {}),
    ...(field.ruin?.tablets ? { isTabletsOfRuin: true } : {}),
    ...(field.ruin?.vessel ? { isVesselOfRuin: true } : {}),
    ...(field.darkAura ? { isDarkAura: true } : {}),
    ...(field.auraBreak ? { isAuraBreak: true } : {}),
    // Trick Room is app-owned: the engine has no turn-order field for it.
    attackerSide: makeSide(field.attackerSide),
    defenderSide: makeSide(field.defenderSide),
  });
}

/**
 * The hits the engine is asked for: the fixed count, the chosen one, or with none chosen every hit of a move
 * that checks accuracy for each, or for a random count its largest, with the chances of each (`chances`). A
 * chosen count outside the rule's range is asked for again.
 */
function resolveHits(move: ChampionsMove, build: BattleBuild, context: MoveContext | undefined, runtime: BattleRuntime, battle: HitCountBattle): { hits: number | null; reason: string | null; chances: HitChance[] | null } {
  const rule = hitCountRule(move, build, runtime, battle);
  if (rule.kind === "fixed") return { hits: rule.hits, reason: null, chances: null };
  if (context?.hits === undefined) return { hits: rule.defaultHits ?? rule.max, reason: null, chances: rule.defaultHits === null ? rule.chances : null };
  if (!Number.isInteger(context.hits) || context.hits < rule.min || context.hits > rule.max) {
    return { hits: null, reason: `Needs the hit count (${rule.min}–${rule.max}).`, chances: null };
  }
  return { hits: context.hits, reason: null, chances: null };
}

/**
 * Dragon Darts is Showdown's only smart-target move (data/moves.ts `smartTarget`).
 * In Doubles with both foes targetable, sim/pokemon.ts getSmartTargets returns both
 * foes and battle-actions.ts hitStepMoveHitLoop sends dart 1 to the chosen target and
 * dart 2 to its partner, each without the spread reduction. Showdown falls back to both
 * darts on one foe when the other is absent, fainted, protected, immune or
 * semi-invulnerable; "Multiple targets hit" off represents that case. The engine has
 * no smart-target model and would otherwise put both darts on the selected target.
 */
function splitsDartsAcrossFoes(move: ChampionsMove, conditions: BattleConditions): boolean {
  return move.id === "dragondarts" && conditions.gameType === "Doubles" && conditions.multipleTargets;
}

/**
 * One-target Expanding Force in Doubles. On Psychic Terrain, with a grounded user, both the
 * engine (calculateBasePower in mechanics/champions.js and gen789.js) and Showdown retarget
 * it to both foes. Showdown's battle-actions.ts trySpreadMoveHit applies the spread reduction
 * whenever more than one foe is still a target (only absent and fainted foes are dropped),
 * before Protect, immunity and semi-invulnerability are checked. "Multiple targets hit" off
 * is therefore the absent or fainted partner; the engine reads any retargeted move as spread.
 */
function hitsOneFoe(move: ChampionsMove, conditions: BattleConditions): boolean {
  // Terapagos-Stellar's Tera Starstorm is retargeted to both foes the same way.
  return ["expandingforce", "terastarstorm"].includes(move.id) && conditions.gameType === "Doubles" && !conditions.multipleTargets;
}

/**
 * Keeps an engine move single-target: calculate() clones its move, and the engine assigns
 * the retargeted `target` to that copy in strict mode, so every copy gets an accessor that
 * ignores the assignment and reports it. The engine's own 1.5x terrain power and Doubles
 * screen rules stay.
 */
function withSingleTarget<M extends { clone(): M }>(move: M, onRetarget: () => void): M {
  Object.defineProperty(move, "target", {
    get: () => "normal", set: (target: string) => { if (target !== "normal") onRetarget(); }, enumerable: true, configurable: true,
  });
  const clone = move.clone.bind(move);
  move.clone = () => withSingleTarget(clone(), onRetarget);
  return move;
}

/** Only a complete, single-hit roll distribution is used for KO probabilities. */
function directKOChance(result: Result, hits: number): number | null {
  // Every hit of False Swipe or Hold Back leaves the target at least 1 HP, whatever the rolls or hit count.
  if (LEAVES_ONE_HP_MOVES.has(toID(result.move.name))) return 0;
  if (result.defender.hasItem("Focus Band")) return null;
  const hp = result.defender.curHP();
  const damage = result.damage;
  if (typeof damage === "number" && damage === 0) return 0;
  if (hits !== 1 || (Array.isArray(damage) && (damage.length !== 16 || Array.isArray(damage[0])))) return null;
  if (hp === result.defender.maxHP()
    && (result.defender.hasItem("Focus Sash") || result.defender.hasAbility("Sturdy"))) return 0;
  if (typeof damage === "number") return damage >= hp ? 1 : 0;
  const rolls = damage as number[];
  return rolls.filter((roll) => roll >= hp).length / rolls.length;
}

function copyRolls(damage: Result["damage"]): MoveDamageResult["rolls"] {
  if (typeof damage === "number") return damage;
  if (Array.isArray(damage[0])) return (damage as number[][]).map((rolls) => [...rolls]);
  return [...damage] as number[];
}

/** The engine result with other damage (its methods kept), for a KO chance of the hits that land. */
function withDamage(result: Result, damage: number[]): Result {
  return Object.assign(Object.create(Object.getPrototypeOf(result)), result, { damage }) as Result;
}

/**
 * A random count's range with each count's chance (chanceText, as the rolls list states it), counts of equal
 * chance together: "Bullet Seed: 2–5 hits (2 and 3: 35% each, 4 and 5: 15% each).", "Population Bomb: 4–10
 * hits (Loaded Dice, 14.29% each).".
 */
function hitRangeLine(name: string, chances: HitChance[], loadedDice: boolean): string {
  const groups: HitChance[][] = [];
  for (const entry of chances) {
    const group = groups[groups.length - 1];
    if (group && Math.abs(group[0].chance - entry.chance) < 1e-9) group.push(entry);
    else groups.push([entry]);
  }
  const counts = (group: HitChance[]) => group.length === 1 ? `${group[0].hits}` : group.length === 2 ? `${group[0].hits} and ${group[1].hits}` : `${group[0].hits}–${group[group.length - 1].hits}`;
  const each = (group: HitChance[]) => `${chanceText(group[0].chance)}${group.length > 1 ? " each" : ""}`;
  const parts = groups.length === 1 ? each(groups[0]) : groups.map((group) => `${counts(group)}: ${each(group)}`).join(", ");
  return `${name}: ${chances[0].hits}–${chances[chances.length - 1].hits} hits (${loadedDice ? `Loaded Dice${groups.length === 1 ? "," : ";"} ` : ""}${parts}).`;
}

/**
 * Whether pinned Showdown keeps the attacker's ability from the target's Mummy, Lingering Aroma or Wandering
 * Spirit (onDamagingHit; a Neutralizing Gas suppressing them counts as no replacer): the hit makes no contact
 * (Long Reach, Protective Pads; the engine drops a Punching Glove's punch itself), the attacker's working
 * Ability Shield blocks setAbility (abilityshield onSetAbility), its ability cannot be suppressed, or
 * Wandering Spirit's skillSwap fails (failskillswap on either side, the target's Ability Shield
 * or Dynamax). The engine's checkMultihitBoost replaces on the contact flag alone.
 */
function abilityReplacementBlocked(attackerBuild: BattleBuild, defenderBuild: BattleBuild, conditions: BattleConditions): boolean {
  const replacer = gassedAbility(defenderBuild, attackerBuild, conditions) ? "" : defenderBuild.abilityId;
  if (!["mummy", "lingeringaroma", "wanderingspirit"].includes(replacer)) return false;
  const own = gassedAbility(attackerBuild, defenderBuild, conditions) ? "" : attackerBuild.abilityId;
  const item = conditions.magicRoom || klutzActive(attackerBuild, defenderBuild) ? "" : attackerBuild.itemId;
  if (own === "longreach" || item === "protectivepads" || shieldsAbility(attackerBuild, conditions)) return true;
  if (replacer === "wanderingspirit") return FAIL_SKILL_SWAP.has(own) || shieldsAbility(defenderBuild, conditions) || isMaxActive(defenderBuild);
  return CANT_SUPPRESS.has(own);
}

/**
 * What a row's hits read for the attacker's HP between them (hit-loop.ts): the settled builds' abilities after
 * Neutralizing Gas (Mold Breaker suppresses none of those it reads: none is breakable), their items where they
 * work (not under Magic Room or an active Klutz; an Ability Shield works through Klutz), the engine move's
 * contact flag (a Punching Glove's punch and Shell Side Arm's physical hit already set) after Long Reach and
 * Protective Pads (data/abilities.ts longreach, sim/battle.ts checkMoveMakesContact), its draining, the Berry Bug Bite,
 * Pluck and Incinerate find (held, whether or not it works for the target, unless the hit's damage ate it as a resist
 * Berry) and Bug Bite's and Pluck's user eating it (its own items ignored under Magic Room or Klutz but for an ignoreKlutz
 * item), and the target's Gulping or Gorging form (Gulp Missile is cantsuppress, and notransform: not a transformed copy's).
 */
function hitLoopInput(result: Result, attacker: Pokemon, attackerBuild: BattleBuild, defenderBuild: BattleBuild, conditions: BattleConditions, runtime: BattleRuntime, moveId: string): HitLoopInput {
  const ability = (build: BattleBuild, other: BattleBuild) => gassedAbility(build, other, conditions) ? "" : build.abilityId;
  const item = (build: BattleBuild, other: BattleBuild) => conditions.magicRoom || klutzActive(build, other) ? "" : build.itemId;
  const attackerAbility = ability(attackerBuild, defenderBuild), attackerItem = item(attackerBuild, defenderBuild);
  const flags = result.move.flags ?? {};
  // Not their Z-Move or Max Move, which runs none of their handlers (hit-loop.ts ownMoveId).
  const steals = BERRY_STEALERS.has(ownMoveId(moveId, result.move));
  return {
    hp: attacker.curHP(), maxHP: attacker.maxHP(), baseMaxHP: attacker.maxHP(true),
    attackerAbility, attackerItem, targetAbility: ability(defenderBuild, attackerBuild), targetItem: item(defenderBuild, attackerBuild),
    attackerShielded: shieldsAbility(attackerBuild, conditions), targetShielded: shieldsAbility(defenderBuild, conditions), targetDynamaxed: isMaxActive(defenderBuild),
    contact: !!flags.contact && attackerAbility !== "longreach" && attackerItem !== "protectivepads" && !(attackerItem === "punchingglove" && !!flags.punch),
    category: result.move.category === "Special" ? "Special" : "Physical",
    drain: (result.move as Move & { drain?: [number, number] }).drain ?? null,
    takesBerry: steals,
    ...(steals ? { targetBerry: defenderBuild.itemId.endsWith("berry") && !(result.rawDesc.defenderItem && getBerryResistType(result.rawDesc.defenderItem)) ? defenderBuild.itemId : "" } : {}),
    ...(steals && moveId !== "incinerate"
      ? { eats: { ignoresItem: conditions.magicRoom || (attackerAbility === "klutz" && !KLUTZ_IGNORED_ITEMS.has(attackerBuild.itemId)) } } : {}),
    targetGulping: gulpingTarget({ speciesId: defenderBuild.speciesId, abilityId: defenderBuild.abilityId, transformed: !!defenderBuild.transformedFrom }),
    generation: runtime.profile.generation,
  };
}

function zeroDamage(move: ChampionsMove, reason: string): MoveDamageResult {
  return {
    ...emptyRow(move, "calculated", null),
    min: 0, max: 0, minPercent: 0, maxPercent: 0, rolls: 0, ohkoChance: 0,
    description: reason, assumptions: [reason], reason: null, hits: 1,
  };
}

/**
 * A fixed-HP move's row. Only type and ability immunities apply, so `probe` is the same
 * move at 1 power under a neutral name: it connects whenever the probe deals damage, which
 * keeps the engine's retyping (-ate abilities), Scrappy, Tera types and Wonder Guard.
 * `connectsWithoutDefenderAbility` reruns a blocked probe with the defender's ability
 * removed; a move-blocking ability is named only when the move then connects.
 */
/**
 * The survival effect the engine's settled target keeps against this hit (pinned Showdown sturdy and
 * focussash onDamage at full HP, focusband at any HP): after Trace, Imposter and Tera forms, and after
 * Mold Breaker, Neutralizing Gas, Magic Room and Klutz switch one off. highest is the most damage this
 * hit can deal (Fickle Beam's doubled case included). The HP preview withholds on it.
 */
function survivalEffect({ defender, move }: Result, highest: number): Pick<MoveDamageResult, "survival" | "leavesOneHP"> {
  // False Swipe and Hold Back leave 1 HP first, so no survival effect ever acts on them.
  if (LEAVES_ONE_HP_MOVES.has(toID(move.name))) return { leavesOneHP: true };
  // Each effect acts only on a hit that would otherwise knock the target out.
  if (highest < defender.curHP()) return {};
  const full = defender.curHP() === defender.maxHP();
  // Sturdy acts before either item (onDamagePriority -30 against -40), so a Focus Sash is kept.
  const survival = full && defender.hasAbility("Sturdy") ? "Sturdy" : full && defender.hasItem("Focus Sash") ? "Focus Sash"
    : defender.hasItem("Focus Band") ? "Focus Band" : undefined;
  return survival ? { survival } : {};
}

const FOCUS_BAND_NOTE = "Focus Band is not modelled: no KO chance or Uses to KO.";

function fixedHPDamage(move: ChampionsMove, probe: Result, assumptions: string[], connectsWithoutDefenderAbility: () => boolean, intactFace: string | null): MoveDamageResult {
  const { attacker, defender } = probe;
  const noDamage = (reason: string) => ({ ...zeroDamage(move, reason), effectiveType: probe.move.type });
  if (!probe.range()[1]) {
    const type = probe.move.type === move.type ? "" : `${probe.move.type}-type `;
    return noDamage(MOVE_BLOCKING_ABILITIES.has(defender.ability ?? "") && connectsWithoutDefenderAbility()
      ? `${defender.ability} blocks ${type}${move.name}.`
      : `${type}${move.name} does not affect the defender's type.`);
  }
  const hp = defender.curHP();
  const dynamaxed = defender.maxHP() !== defender.maxHP(true);
  // Showdown pokemon.ts getUndynamaxedHP.
  const beforeDynamax = Math.ceil(hp * defender.maxHP(true) / defender.maxHP());
  const userHP = attacker.curHP();
  const damage = FIXED_HP_MOVES[move.id]({ hp, beforeDynamax, userHP });
  if (damage === null) {
    return noDamage(`${move.name} fails because the attacker's HP (${userHP}) is not lower than the defender's (${hp}).`);
  }
  // A hit that connects meets the face or disguise, even Endeavor's 0 into a Dynamaxed target
  // (pinned Showdown spreadDamage runs the Damage event for 0).
  if (intactFace) return emptyRow(move, "needs-context", intactFace);
  if (damage === 0) {
    return noDamage(`${move.name} deals no damage: the defender's HP scaled back from Dynamax (${beforeDynamax}) equals the attacker's HP.`);
  }
  const targetHP = `the defender's current HP${dynamaxed ? " scaled back from Dynamax" : ""} (${beforeDynamax})`;
  const lines = [move.id === "endeavor"
    ? `Fixed damage: ${targetHP} minus the attacker's current HP (${userHP}), at least 1.`
    : `Fixed damage: half ${targetHP}, rounded down, at least 1.`];
  if (probe.move.type !== move.type) lines.push(`Effective move type: ${probe.move.type}.`);
  if (defender.hasItem("Focus Band")) lines.push(FOCUS_BAND_NOTE);
  probe.damage = damage;
  const percent = damage / defender.maxHP() * 100;
  return {
    moveId: move.id, effectiveName: move.name, effectiveType: probe.move.type, effectivePower: move.power, effectiveCategory: move.category,
    kind: "calculated", min: damage, max: damage, minPercent: percent, maxPercent: percent,
    rolls: damage, ohkoChance: directKOChance(probe, 1),
    description: `${move.name}: ${damage}–${damage} HP (${percent.toFixed(1)}–${percent.toFixed(1)}% of maximum HP).`,
    assumptions: [...assumptions, ...lines], reason: null, hits: 1, ...survivalEffect(probe, damage),
  };
}

function calculateMove(
  assigned: ChampionsMove,
  attackerBuild: BattleBuild,
  defenderBuild: BattleBuild,
  battleConditions: BattleConditions,
  context: MoveContext | undefined,
  runtime: BattleRuntime,
  /** The ability that suppresses the receiving side's Friend Guard partner for every move. */
  friendGuardSuppressedBy: string | null = null,
  /** Filled with the engine result the row reports, for the next use's state (uses-to-ko.ts). */
  trace: CalcTrace = {},
  /** The attacker's earlier consecutive turns with this move, for Metronome's boost on a later use. */
  consecutive = 0,
  /** A later use's builds, whose stages already hold the entry rises the engine adds (uses-to-ko.ts entryStages). */
  settledEntry = false,
): MoveDamageResult {
  let conditions = battleConditions;
  // A critical-hit ratio that makes every hit critical counts as the field's Critical hit.
  const ratioCrit = conditions.critical ? null : certainCrit(assigned.id, attackerBuild, defenderBuild, context, conditions, runtime);
  if (ratioCrit) conditions = { ...conditions, critical: true };
  // Event-doubling moves (event-moves.ts): pass the chosen case's power as an override,
  // which survives the engine's internal move clone. A Z/Max conversion takes its own
  // power from zMove/maxMove data, so this does not leak into a transformed attack.
  // A Protecting target used Protect (+4 priority) this turn, so it has already moved: Payback doubles.
  const paybackAfterProtect = assigned.id === "payback" && conditions.defenderSide.protect;
  const eventPower = EVENT_DOUBLING_MOVES[assigned.id]
    ? assigned.power * (isEventDoubled(assigned.id, context) || paybackAfterProtect ? 2 : 1)
    : null;
  // Last Respects / Rage Fist power from their count, and Beat Up's hits (count-moves.ts).
  const counted = countPower(assigned.id, context, runtime);
  const beatUp = assigned.id === "beatup" ? beatUpPlan(attackerBuild, context, runtime) : null;
  const overridePower = eventPower ?? (counted && "power" in counted ? counted.power : null)
    ?? (beatUp && "hits" in beatUp ? beatUp.hits[0].power : null);
  const baseOverrides = {
    ...(conditions.gameType === "Doubles" && !conditions.multipleTargets ? { target: "normal" as const } : {}),
    // Move.clone() resets a fixed multihit from data, so `hits` alone does not survive. Showdown's
    // Tera 60-power floor skips any dex multihit move (battle-actions.ts getDamage), so the split dart
    // keeps multiaccuracy, the other thing the engine's floor check reads.
    ...(splitsDartsAcrossFoes(assigned, conditions) ? { multihit: 1, multiaccuracy: true } : {}),
    // Showdown never raises Beat Up (basePower 0 with a basePowerCallback) to the Tera 60-power floor.
    ...(beatUp && "hits" in beatUp ? { multiaccuracy: true } : {}),
  };
  // A Stellar first use the partner-shield check below answers for itself (moveContext); the question
  // is asked only if the shield lets the move through.
  let moveContext = context;
  const resolveWith = (basePower: number | null, extra: { name?: MoveName; type?: TypeName; category?: "Physical" | "Special"; flags?: { contact: 1 } } = {}) => {
    const resolution = resolveBattleMove(assigned, attackerBuild, makePokemon(attackerBuild, runtime), moveContext, runtime, {
      isCrit: conditions.critical,
      overrides: { ...baseOverrides, ...(basePower !== null ? { basePower } : {}), ...extra },
    });
    // Metronome's boost counts earlier consecutive turns (pinned Showdown numConsecutive, at most 5); the
    // engine reads it from the move, and its clones keep it.
    if (!resolution.kind && consecutive > 0) resolution.move.timesUsedWithMetronome = Math.min(consecutive, 5);
    return resolution;
  };
  // Double Shock and Burn Up fail in onTryMove (pinned Showdown), before a Stellar first-use question or
  // Protect matters; their Z-Move and Max Move do not. A transformed Imposter user has the copied form's
  // types (its settled speciesId), which Mimicry can still change.
  const earlyGate = TYPE_GATED_MOVES[assigned.id];
  if (earlyGate && !context?.useZ && !isMaxActive(attackerBuild)) {
    const tera = attackerBuild.mechanic === "tera" ? attackerBuild.configuration?.teraType : undefined;
    const types: readonly string[] = tera && tera !== "Stellar" ? [tera]
      : mimicryTypes(attackerBuild, defenderBuild, conditions, "attacker", runtime).types ?? runtime.speciesById.get(attackerBuild.speciesId)?.types ?? [];
    if (!types.includes(earlyGate)) return zeroDamage(assigned, `${assigned.name} fails because the attacker is not ${earlyGate} type.`);
  }
  // A Crowned Zacian or Zamazenta has Behemoth Blade / Bash in its Iron Head slot (pinned Showdown
  // onBattleStart), so Iron Head is never used; Transform copies that slot.
  const crownedMove = Object.values(CROWNED_FORMS).find((entry) => entry.form === attackerBuild.speciesId)?.move;
  if (crownedMove && assigned.id === "ironhead") {
    const species = runtime.speciesById.get(attackerBuild.speciesId)?.name ?? attackerBuild.speciesId;
    const replacement = runtime.movesById.get(crownedMove)?.name ?? crownedMove;
    return emptyRow(assigned, "unsupported", attackerBuild.transformedFrom
      ? `The transformed ${species} copied ${replacement} in place of Iron Head.`
      : `${species}'s Iron Head becomes ${replacement}.`);
  }
  let resolved: ReturnType<typeof resolveBattleMove>;
  let pendingContext: string | null = null;
  try {
    resolved = resolveWith(overridePower);
    // A partner's priority shield acts before the Stellar boost could matter.
    if (resolved.kind === "needs-context" && resolved.reason === STELLAR_FIRST_USE_REASON && conditions.defenderSide.priorityShield) {
      pendingContext = resolved.reason;
      moveContext = { ...context, stellarFirstUse: false };
      resolved = resolveWith(overridePower);
    }
  } catch (error) {
    return emptyRow(assigned, "unsupported", `This matchup could not be calculated: ${error instanceof Error ? error.message : "Unknown engine error."}`);
  }
  if (resolved.kind) return emptyRow(assigned, resolved.kind, resolved.reason);
  // Showdown types Weather Ball and Terrain Pulse before it picks the Max Move (useMove ModifyType, then
  // getActiveMaxMove), so a Gigantamax user gets its G-Max move only when that type is its signature's
  // (G-Max Hydrosnipe then keeps its fixed 160 power and ignores abilities). The engine picks from the
  // Normal data type, so a probe finds the engine's own converted type and the move is built with it.
  if (attackerBuild.mechanic === "gigantamax" && ["weatherball", "terrainpulse"].includes(assigned.id)) {
    const probeSide = (build: BattleBuild, other: BattleBuild) => {
      const pokemon = makePokemon(build, runtime);
      if (gassedAbility(build, other, conditions)) pokemon.ability = "Run Away" as AbilityName;
      return pokemon;
    };
    const type = calculate(Generations.get(runtime.profile.generation), probeSide(attackerBuild, defenderBuild), probeSide(defenderBuild, attackerBuild),
      resolved.move.clone(), makeField(conditions)).move.type;
    if (type !== resolved.move.type) {
      const retyped = resolveWith(overridePower, { type });
      if (retyped.kind) return emptyRow(assigned, retyped.kind, retyped.reason);
      resolved = { ...retyped, assumptions: [...retyped.assumptions, `${assigned.name} is ${type} type, so it becomes ${retyped.move.name}.`] };
    }
  }
  const metadata = resolved.effective;
  if (metadata.unsupported.length) return emptyRow(metadata, "unsupported", metadata.unsupported.join(" "));
  if (metadata.category === "Status") return emptyRow(metadata, "status", "No direct damage; its effects are not simulated.");
  // Bide is the one damaging move that targets its user (pinned Showdown data/moves.ts bide: target "self"). In Singles
  // no target is chosen, so sim/battle-queue.ts resolveAction aims its Z-Move at the user too (getRandomTarget for a
  // "self" move), and sim/battle.ts getTarget gives Breakneck Blitz none at its user's own position: it fails
  // ([notarget]). In Doubles the Z-Move needs a foe as its target (sim/side.ts chooseMove), which it hits.
  if (resolved.transformed && resolved.move.isZ && assigned.id === "bide" && conditions.gameType === "Singles") {
    return zeroDamage(metadata, `${metadata.name} fails: in Singles, Z-Bide is aimed at its user.`);
  }
  if (conditions.gravity && GRAVITY_BLOCKED_MOVES.has(metadata.id)) {
    return zeroDamage(metadata, `Gravity prevents ${metadata.name} from being used.`);
  }
  // A partner's Queenly Majesty, Dazzling or Armor Tail stops a move with this priority aimed at either
  // Pokémon on its side, a spread move's other target included (pinned Showdown onFoeTryMove:
  // move.priority > 0.1). It acts in TryMove, before Protect or Max Guard, the move's own Try (Sucker
  // Punch) and any question about the hit (genders for Rivalry, a Stellar first use, a hit count). The
  // attacker's partner never does.
  let shieldIgnoredBy: string | null = null;
  let shieldNote: string | null = null;
  // onFoeTryMove skips a move aimed at the user or the foe's side in the dex data (Bide, whose release
  // never runs TryMove; the engine gives it another target).
  if (conditions.defenderSide.priorityShield && !["self", "foeSide"].includes(assigned.target)) {
    const user = makePokemon(attackerBuild, runtime);
    // The target's Neutralizing Gas also stops Gale Wings and Triage.
    if (gassedAbility(attackerBuild, defenderBuild, conditions)) user.ability = "Run Away" as AbilityName;
    const { priority } = usedPriority(metadata, assigned, resolved, user, attackerBuild, defenderBuild, conditions);
    if (priority > 0) {
      const names = priorityShieldNames(runtime);
      const suppressor = partnerAbilitySuppressor(attackerBuild, defenderBuild, runtime);
      if (!suppressor) return zeroDamage(metadata, `A partner with ${names} blocks ${metadata.name} (+${priority} priority).`);
      shieldNote = `${suppressor} ${suppressor === "Neutralizing Gas" ? "suppresses" : "ignores"} the partner's ${names}.`;
      if (suppressor !== "Neutralizing Gas") shieldIgnoredBy = suppressor;
    }
  }
  if (pendingContext) return emptyRow(metadata, "needs-context", pendingContext);
  let protect: ProtectOutcome | null = null;
  if (conditions.defenderSide.protect) {
    if (isMaxActive(defenderBuild)) return emptyRow(metadata, "unsupported", "Max Guard is not modelled.");
    // These fail in Showdown's Try/TryMove steps, before Protect's TryHit.
    if (TARGET_ATTACK_MOVES.has(metadata.id)) return zeroDamage(metadata, `${metadata.name} fails: the target is protecting.`);
    if (metadata.id === "snore" && attackerBuild.status !== "slp" && attackerBuild.abilityId !== "comatose") return zeroDamage(metadata, "Snore fails because the attacker is not asleep.");
    if (EXPLOSIVE_MOVES.has(metadata.id) && dampPrevents(attackerBuild, defenderBuild)) return zeroDamage(metadata, `Damp prevents ${metadata.name} from being used.`);
    protect = protectOutcome(metadata, resolved.move, attackerBuild, defenderBuild, conditions, runtime);
    if (protect.kind === "blocked") return zeroDamage(metadata, `Protect blocks ${metadata.name}.`);
    // Fixed damage (damageCallback) skips modifyDamage, where Showdown takes the quarter; Guardian of Alola has its own.
    if (protect.kind === "quarter" && FIXED_DAMAGE_MOVES.has(metadata.id)) {
      protect = metadata.id === "guardianofalola"
        ? { kind: "quarter", line: "Protect: Guardian of Alola breaks through at 1/4 of its fixed damage." }
        : { kind: "full", line: `Protect: ${metadata.name}'s fixed damage gets through in full.` };
    }
  }
  // Fixed damage ignores the attacker's ability boosts, so these contexts cannot change it.
  if (CONTEXT_ABILITIES[attackerBuild.abilityId] && !FIXED_HP_MOVES[metadata.id]
    && (attackerBuild.abilityId !== "rivalry" || !getBuildGender(attackerBuild, runtime) || !getBuildGender(defenderBuild, runtime))) {
    return emptyRow(metadata, "needs-context", CONTEXT_ABILITIES[attackerBuild.abilityId]);
  }
  if (metadata.ohko) return emptyRow(metadata, "unsupported", "One-hit KO move: no damage range.");
  if (HISTORY_MOVES[metadata.id]) return emptyRow(metadata, "needs-context", metadata.id === "fling" && runtime.profile.id !== "champions"
    ? "Fling is not verified for this game."
    : HISTORY_MOVES[metadata.id]);
  if (!resolved.transformed && counted && "reason" in counted) return emptyRow(metadata, "needs-context", counted.reason);
  if (!resolved.transformed && beatUp && "reason" in beatUp) return emptyRow(metadata, "needs-context", beatUp.reason);
  if (metadata.power === 0 && !ZERO_POWER_IMPLEMENTED.has(metadata.id) && !FIXED_HP_MOVES[metadata.id] && !(beatUp && !resolved.transformed)) {
    return emptyRow(metadata, "unsupported", `This move's damage is not verified in the ${runtime.profile.id === "champions" ? "Champions" : runtime.profile.label} engine.`);
  }
  const restricted = !resolved.transformed ? USER_RESTRICTED_MOVES[metadata.id] : undefined;
  const userSpecies = runtime.speciesById.get(attackerBuild.speciesId);
  if (restricted && userSpecies && !restricted.allowed(userSpecies)) {
    return zeroDamage(metadata, `${metadata.name} fails: only ${restricted.who} can use it.`);
  }
  // Ability Shield keeps Ice Face and Disguise from Mold Breaker and its kin (and an ignoreAbility move).
  const faceKept = shieldsAbility(defenderBuild, conditions)
    || (!["moldbreaker", "teravolt", "turboblaze"].includes(attackerBuild.abilityId) && !IGNORE_ABILITY_MOVES.has(metadata.id));
  const iceFace = faceKept && defenderBuild.speciesId === "eiscue" && defenderBuild.abilityId === "iceface";
  const disguise = faceKept && ["mimikyu", "mimikyutotem"].includes(defenderBuild.speciesId) && defenderBuild.abilityId === "disguise";
  /** The reason an intact Ice Face or Disguise takes a hit of this category; ask only once the hit connects. */
  const intactFace = (category: string) => iceFace && category === "Physical" ? ICE_FACE_REASON : disguise ? DISGUISE_REASON : null;
  if (metadata.id === "dreameater" && defenderBuild.status !== "slp" && defenderBuild.abilityId !== "comatose") return zeroDamage(metadata, "Dream Eater fails because the defender is not asleep.");
  if (metadata.id === "snore" && attackerBuild.status !== "slp" && attackerBuild.abilityId !== "comatose") return zeroDamage(metadata, "Snore fails because the attacker is not asleep.");
  // Analytic (pinned Showdown onBasePower) boosts when no other active Pokémon will still move this
  // turn. Its condition (the target switches out) always boosts; otherwise the turn order decides.
  const analyticOrdered = attackerBuild.abilityId === "analytic" && (!attackerBuild.abilityActive || conditions.gameType === "Doubles")
    && !FIXED_HP_MOVES[metadata.id] && !FIXED_DAMAGE_MOVES.has(metadata.id)
    && !(EXPLOSIVE_MOVES.has(metadata.id) && dampPrevents(attackerBuild, defenderBuild))
    && !(defenderBuild.abilityId === "neutralizinggas" && !shieldsAbility(attackerBuild, conditions));
  // Into a Protecting target in Singles the target has already moved, so Analytic boosts.
  const analyticAfterProtect = analyticOrdered && !!protect && conditions.gameType === "Singles";
  // Pinned Showdown's Acrobatics (basePowerCallback) and Poltergeist (onTry) look at the held item
  // itself, which Magic Room or Klutz only suppresses; the engine clears a suppressed item before
  // them. A neutral name keeps its name-keyed doubling and failure branches off.
  // (A transformed move's id is its Z/Max id, so it never takes this branch.)
  const suppressedItemHolder = metadata.id === "acrobatics" ? attackerBuild : metadata.id === "poltergeist" ? defenderBuild : null;
  const suppressedItemOther = suppressedItemHolder === attackerBuild ? defenderBuild : attackerBuild;
  let suppressedItemNote: string | null = null;
  const holderKlutz = !!suppressedItemHolder && klutzActive(suppressedItemHolder, suppressedItemOther);
  // The engine clears the item under Magic Room, or for Klutz unless it is one of its kept items.
  if (suppressedItemHolder?.itemId && (conditions.magicRoom || (holderKlutz && !ENGINE_KLUTZ_KEPT_ITEMS.has(suppressedItemHolder.itemId)))) {
    resolved = resolveWith(overridePower, { name: `${metadata.name} (held item suppressed)` as MoveName });
    if (resolved.kind) return emptyRow(metadata, resolved.kind, resolved.reason);
    const item = runtime.itemsById.get(suppressedItemHolder.itemId)?.name ?? suppressedItemHolder.itemId;
    const klutzSuppresses = holderKlutz && !KLUTZ_IGNORED_ITEMS.has(suppressedItemHolder.itemId);
    const by = conditions.magicRoom && klutzSuppresses ? "Magic Room and Klutz suppress" : conditions.magicRoom ? "Magic Room suppresses" : klutzSuppresses ? "Klutz suppresses" : null;
    // A Seed still held on its own terrain met the room first (settleItems says so, and its panel
    // switch covers the other order); an active Klutz never lets it activate.
    const whose = metadata.id === "acrobatics" ? "the attacker's" : "the target's";
    const outcome = metadata.id === "acrobatics" ? "Acrobatics has its usual power" : "Poltergeist hits";
    suppressedItemNote = by ? `${by} ${whose} ${item}, still held: ${outcome}.` : `Klutz does not affect ${whose} ${item}: ${outcome}.`;
  }

  const hitBattle: HitCountBattle = { magicRoom: conditions.magicRoom, opponentAbilityId: defenderBuild.abilityId };
  const resolvedHits = resolveHits(metadata, attackerBuild, context, runtime, hitBattle);
  // A hit an intact face or disguise takes needs no hit count: one hit finds out whether it connects,
  // and the count is asked for after the engine run otherwise.
  const hitsReason = resolvedHits.hits === null ? resolvedHits.reason : null;
  // The rule the rows carry for the hit selector: the settled attacker's (a transformed Imposter user's copied ability counts).
  const hitRule = hitCountRule(metadata, attackerBuild, runtime, hitBattle);
  if (hitsReason && !intactFace(metadata.category)) return { ...emptyRow(metadata, "needs-context", hitsReason), hitRule };
  let hitCount: { hits: number; reason: string | null } = resolvedHits.hits === null ? { hits: 1, reason: null } : { hits: resolvedHits.hits, reason: resolvedHits.reason };
  // A random count with none chosen: the engine deals its largest, and the row runs over every count.
  const randomHits = resolvedHits.chances;

  const assumptions = ["One use, if it connects; damage is not capped at the target's HP.", ...resolved.assumptions, ...(shieldNote ? [shieldNote] : [])];
  if (protect && "line" in protect) assumptions.push(protect.line);
  if (suppressedItemNote) assumptions.push(suppressedItemNote);
  if (analyticAfterProtect) assumptions.push("Analytic: boosted (the target protected first).");
  const eventAssumption = resolved.transformed ? null
    : paybackAfterProtect ? "Payback: doubled power (the target protected first)."
    : eventDoublingAssumption(metadata.id, context);
  if (eventAssumption) assumptions.push(eventAssumption);
  if (!resolved.transformed && counted && "line" in counted) assumptions.push(counted.line);
  const beatUpHits = !resolved.transformed && beatUp && "hits" in beatUp ? beatUp.hits : null;
  if (beatUpHits) {
    assumptions.push(`Beat Up: ${beatUpHits.length} hit${beatUpHits.length === 1 ? "" : "s"} (${beatUpHits.map((hit) => `${hit.name} ${hit.power}`).join(", ")} power).`);
  }
  if (attackerBuild.abilityId === "supremeoverlord") {
    const fallen = attackerBuild.faintedAllies ?? 0;
    assumptions.push(`Supreme Overlord: ${fallen} all${fallen === 1 ? "y" : "ies"} fainted, ${supremeOverlordMultiplier(fallen).toFixed(1)}x power.`);
  }
  if (splitsDartsAcrossFoes(metadata, conditions)) {
    hitCount = { hits: 1, reason: null };
    assumptions.push("Dragon Darts: one dart per foe.");
  }
  if (conditions.gravity) assumptions.push("Gravity: accuracy changes are not simulated.");
  if (conditions.trickRoom) assumptions.push("Trick Room: turn order only; Speed is unchanged.");
  if (conditions.wonderRoom) assumptions.push("Wonder Room: unboosted Defense and Sp. Def swapped; stages are not.");
  // Pinned Showdown data/moves.ts wonderroom onModifyMove turns Body Press's attacking stat
  // into Sp. Def, and sim/pokemon.ts calculateStat swaps it back to the original Defense;
  // the engine's calculateAttack matches, and so does cartridge research (a quirk shared
  // with Shell Side Arm and Download). Only Showdown's hint text says Defense stages.
  if (conditions.wonderRoom && metadata.id === "bodypress") assumptions.push("Body Press under Wonder Room: the attacker's original Defense with its Sp. Def stages.");
  if (conditions.magicRoom) assumptions.push("Magic Room: held items have no effect but stay held; forms unchanged.");
  if (conditions.fairyAura) assumptions.push("Fairy Aura is active (sources do not stack).");
  // Friend Guard is a damage modifier (Showdown ModifyDamage), so fixed damage never passes through it.
  if (!FIXED_DAMAGE_MOVES.has(metadata.id)) {
    if (friendGuardSuppressedBy) {
      assumptions.push(`${friendGuardSuppressedBy} ${friendGuardSuppressedBy === "Neutralizing Gas" ? "suppresses" : "ignores"} the partner's Friend Guard.`);
    } else if (conditions.defenderSide.friendGuard && IGNORE_ABILITY_MOVES.has(metadata.id)) {
      conditions = { ...conditions, defenderSide: { ...conditions.defenderSide, friendGuard: false } };
      assumptions.push(`${metadata.name} ignores the partner's Friend Guard.`);
    } else if (conditions.defenderSide.friendGuard) {
      assumptions.push("Friend Guard: 75% damage.");
    }
  }
  if (SUCCESS_ASSUMPTIONS[metadata.id]) assumptions.push(SUCCESS_ASSUMPTIONS[metadata.id]);
  if (LEAVES_ONE_HP_MOVES.has(metadata.id)) {
    assumptions.push(`${metadata.name} leaves the target at least 1 HP.`);
  } else if (resolved.transformed && LEAVES_ONE_HP_MOVES.has(assigned.id)) {
    assumptions.push(`${metadata.name} can knock the target out, unlike ${assigned.name}.`);
  }
  // Where the hit count's line goes: the count's own, or for a random count its range once the hits that
  // land are known (an attacker that faints on a hit cuts them short).
  const countLine = assumptions.length;
  if (hitRule.kind === "fixed" && hitRule.reason) assumptions.push(hitRule.reason);
  if (hitRule.kind === "choose" && hitRule.perHitAccuracy) {
    assumptions.push(hitCount.hits === hitRule.max ? `${metadata.name}: all ${hitRule.max} hits land.` : `${metadata.name}: ${hitCount.hits} of ${hitRule.max} hits land.`);
  }
  const ownCountLine = assumptions.length > countLine ? assumptions[countLine] : null;
  let attackingSpecies = attackerBuild.speciesId;
  if (attackingSpecies === "aegislash" && attackerBuild.abilityId === "stancechange") {
    attackingSpecies = "aegislashblade";
    const blade = runtime.speciesById.get(attackingSpecies);
    if (!blade || blade.unsupported.length) return emptyRow(metadata, "unsupported", "Stance Change needs a verified Blade Forme.");
    assumptions.push("Stance Change: Blade Forme.");
  }

  try {
    const generation = Generations.get(runtime.profile.generation);
    const attackerMimicry = mimicryTypes(attackerBuild, defenderBuild, conditions, "attacker", runtime);
    const defenderMimicry = mimicryTypes(defenderBuild, attackerBuild, conditions, "target", runtime);
    for (const line of [attackerMimicry.line, defenderMimicry.line]) if (line) assumptions.push(line);
    const attacker = makePokemon(analyticAfterProtect ? { ...attackerBuild, abilityActive: true } : attackerBuild, runtime, attackingSpecies, attackerMimicry.types);
    const defender = makePokemon(defenderBuild, runtime, defenderBuild.speciesId, defenderMimicry.types);
    // A Seed Magic Room held back stays held and unused after the room ends; the engine would use it, so
    // it sees an item with no effect here (Knock Off, Acrobatics and Poltergeist still see an item).
    for (const [pokemon, build] of [[attacker, attackerBuild], [defender, defenderBuild]] as const) {
      if (!conditions.magicRoom && build.itemUsedBeforeRoom === false && SEED_TERRAINS[build.itemId] === conditions.terrain) pokemon.item = "Leftovers" as never;
    }
    // Double Shock and Burn Up fail for a user that lacks the Electric or Fire type (pinned Showdown
    // onTryMove hasType, which reads its Tera type, or its own types when Terastallized to Stellar, before
    // Protean or Libero act); the engine calculates them for any user.
    const typeGate = !resolved.transformed ? TYPE_GATED_MOVES[metadata.id] : undefined;
    if (typeGate && !(attacker.teraType && attacker.teraType !== "Stellar" ? attacker.teraType === typeGate : attacker.types.includes(typeGate))) {
      return zeroDamage(metadata, `${metadata.name} fails because the attacker is not ${typeGate} type.`);
    }
    // E. The engine adds Wind Rider's Tailwind +1 before it applies Neutralizing Gas; Showdown's
    // suppressed Wind Rider never gets it (onStart / onSideConditionStart do not run).
    const attackerWindRider = conditions.attackerSide.tailwind && attackerBuild.abilityId === "windrider" ? !windRiderSuppressed(attackerBuild, defenderBuild, conditions) : null;
    const defenderWindRider = conditions.defenderSide.tailwind && defenderBuild.abilityId === "windrider" ? !windRiderSuppressed(defenderBuild, attackerBuild, conditions) : null;
    if (attackerWindRider === false) attacker.ability = "Run Away" as AbilityName;
    if (defenderWindRider === false) defender.ability = "Run Away" as AbilityName;
    // The engine applies Neutralizing Gas only after it has used abilities for Speed, entry boosts and
    // items, and it ignores Utility Umbrella for sun and rain abilities; Run Away has no effect.
    for (const [pokemon, build, other] of [[attacker, attackerBuild, defenderBuild], [defender, defenderBuild, attackerBuild]] as const) {
      if (gassedAbility(build, other, conditions) || umbrellaBlocksAbility(build, other, conditions)) pokemon.ability = "Run Away" as AbilityName;
      // Download's entry boost is already in the stages (settleEntry); it has no other effect. So are a later
      // use's Dauntless Shield, Intrepid Sword, Embody Aspect and Wind Rider rises (a target's Wind Rider still
      // takes a wind move).
      if (build.settledDownload) pokemon.ability = "Run Away" as AbilityName;
      if (settledEntry && ENTRY_ABILITIES[build.abilityId] && !(pokemon === defender && build.abilityId === "windrider" && resolved.move.flags?.wind)) pokemon.ability = "Run Away" as AbilityName;
    }
    // The other battler's Neutralizing Gas suppresses Klutz, so the item works (Showdown ignoringItem);
    // the engine's checkItem drops a Klutz holder's item before it applies the gas.
    if (attackerBuild.abilityId === "klutz" && !klutzActive(attackerBuild, defenderBuild)) attacker.ability = "Run Away" as AbilityName;
    if (defenderBuild.abilityId === "klutz" && !klutzActive(defenderBuild, attackerBuild)) defender.ability = "Run Away" as AbilityName;
    // The engine's multi-hit loop gives the attacker the target's Mummy or Lingering Aroma, or swaps for Wandering
    // Spirit, on the move's contact flag alone; where Showdown does not, the target's ability (with no damage
    // effect of its own) is left out so the attacker keeps its own for every hit.
    if (abilityReplacementBlocked(attackerBuild, defenderBuild, conditions)) defender.ability = "Run Away" as AbilityName;
    // An Iron Ball grounds its holder before Levitate or Eelevate count (pinned Showdown sim/pokemon.ts
    // isGrounded), so Ground moves hit; the Champions engine skips that check (gen789 has it). With the
    // Iron Ball working the ability changes no damage, and Run Away changes none in the engine.
    const ironBallGrounded = defenderBuild.itemId === "ironball" && !conditions.magicRoom && ["levitate", "eelevate"].includes(defenderBuild.abilityId);
    if (ironBallGrounded && runtime.profile.id === "champions") defender.ability = "Run Away" as AbilityName;
    // The engine runs Forecast before it applies Neutralizing Gas, and ignores Utility Umbrella.
    if (forecastBlocked(attackerBuild, defenderBuild, conditions)) attacker.ability = "Run Away" as AbilityName;
    if (forecastBlocked(defenderBuild, attackerBuild, conditions)) defender.ability = "Run Away" as AbilityName;
    // The engine counts a Booster Energy as used up whenever Protosynthesis or Quark Drive is active;
    // sun or Electric Terrain activates them with the item still held (settleItems), so Acrobatics and
    // Poltergeist must see an ordinary held item (Leftovers changes no damage).
    if (!resolved.transformed && (metadata.id === "acrobatics" || metadata.id === "poltergeist")) {
      const [holder, holderBuild] = metadata.id === "acrobatics" ? [attacker, attackerBuild] : [defender, defenderBuild];
      if (holderBuild.settledBoostedStat && holderBuild.itemId === "boosterenergy" && holder.item === "Booster Energy") holder.item = "Leftovers" as never;
    }
    // Likewise Knock Off: a kept Booster Energy that can be removed (no Paradox tag: Gouging Fire,
    // Raging Bolt, Iron Boulder, Iron Crown) still gives Knock Off its 1.5x.
    if (!resolved.transformed && metadata.id === "knockoff" && defenderBuild.settledBoostedStat && defenderBuild.itemId === "boosterenergy"
      && defender.item === "Booster Energy" && !PARADOX_SPECIES.has(defenderBuild.transformedFrom?.speciesId ?? defenderBuild.speciesId)) {
      defender.item = "Leftovers" as never;
    }
    // G-Max Fireball ignores the target's ability as the other ignoreAbility moves do (see
    // ENGINE_BYPASSED_ABILITIES for the engine's misspelling).
    let fireballIgnored: AbilityName | null = null;
    if (metadata.id === "gmaxfireball" && defender.ability && ENGINE_BYPASSED_ABILITIES.has(defender.ability) && !defender.hasItem("Ability Shield")) {
      fireballIgnored = defender.ability;
      defender.ability = "Run Away" as AbilityName;
    }
    // Normalize leaves Hidden Power's type alone (pinned Showdown noModifyType), so it gets no boost
    // either; the engine would make it Normal type. Normalize does nothing else.
    if (!resolved.transformed && metadata.id.startsWith("hiddenpower") && attacker.hasAbility("Normalize")) {
      assumptions.push("Normalize: no effect on Hidden Power.");
      attacker.ability = "Run Away" as AbilityName;
    }
    const stellar = attackerBuild.mechanic === "tera" && attackerBuild.configuration?.teraType === "Stellar";
    // Stellar replaces the STAB step, so Adaptability (a ModifySTAB effect) does not apply (pinned
    // Showdown battle-actions); the engine would still double STAB. Adaptability does nothing else.
    if (stellar && attacker.hasAbility("Adaptability")) {
      assumptions.push("Adaptability: no effect while Stellar-Terastallized.");
      attacker.ability = "Run Away" as AbilityName;
    }
    // Revelation Dance takes the user's first type, which Stellar keeps as the original one; the
    // engine would make it Stellar type. Without the engine's Tera type, the first use's Stellar
    // boost (2x for this same-type move) is Adaptability's STAB, which Oricorio's Dancer leaves free.
    let stellarRevelation = false;
    if (stellar && !resolved.transformed && metadata.id === "revelationdance" && attackerBuild.abilityId === "dancer") {
      (attacker as { teraType?: TypeName }).teraType = undefined;
      stellarRevelation = true;
      if (context?.stellarFirstUse) {
        attacker.ability = "Adaptability" as AbilityName;
        // The target's Neutralizing Gas would clear the stand-in; Stellar's boost is not an ability,
        // and the gas does nothing else to this damage (Dancer has no damage effect).
        if (defender.hasAbility("Neutralizing Gas") && !attacker.hasItem("Ability Shield")) defender.ability = "Run Away" as AbilityName;
      }
      assumptions.push(`Revelation Dance: ${attacker.types[0]} type${context?.stellarFirstUse ? ", Stellar 2x boost (first use)" : ""}.`);
    }
    // Knock Off's 1.5x needs an item it can remove; the engine misjudges a Mega Stone held by another
    // form of its family (megaStoneKeptFromKnockOff). A neutral name keeps the engine's boost off.
    // A transformed Imposter user's Stone can always be knocked off; the engine checks the copied form.
    if (metadata.id === "knockoff" && !resolved.transformed && defenderBuild.transformedFrom && generation.items.get(defenderBuild.itemId as ID)?.megaStone) {
      defender.item = "Leftovers" as never;
      assumptions.push(`Knock Off: boosted power (the transformed target's ${runtime.itemsById.get(defenderBuild.itemId)?.name ?? defenderBuild.itemId} can be removed).`);
    }
    if (metadata.id === "knockoff" && !resolved.transformed && defenderBuild.itemId && megaStoneKeptFromKnockOff(generation, defender, defenderBuild.itemId, defenderBuild)) {
      resolved = resolveWith(overridePower, { name: "Knock Off (item kept)" as MoveName });
      if (resolved.kind) return emptyRow(metadata, resolved.kind, resolved.reason);
      assumptions.push(`Knock Off: no power boost (the target's ${runtime.itemsById.get(defenderBuild.itemId)?.name ?? defenderBuild.itemId} cannot be removed).`);
    }
    // Bolt Beak and Fishious Rend double when the user moves before its target; the engine uses
    // Speed alone (ties and Trick Room wrong), so the app sets the power from the turn order.
    let orderBySpeed = false;
    if (MOVES_FIRST_POWER_MOVES.has(metadata.id) && !resolved.transformed) {
      let first: boolean;
      if (context?.turnOrder) {
        first = context.turnOrder === "first";
        assumptions.push(`${metadata.name}: ${first ? "doubled power, moves before the target" : "usual power, moves after the target"}.`);
      } else {
        const probe = calculate(generation, attacker, defender, resolved.move, makeField(conditions));
        const order = probe.range()[1] === 0 ? { order: "first" as const, reason: "", bySpeed: false, notes: [] } : turnOrderAgainstTarget(probe, resolved.move.priority, attackerBuild, defenderBuild, conditions, runtime);
        if (order.order === "tie") {
          // A hit an intact face or disguise takes needs no turn order.
          return emptyRow(metadata, "needs-context", intactFace(probe.move.category) ?? `${metadata.name}: needs the turn order (${order.reason}).`);
        }
        first = order.order === "first";
        orderBySpeed = order.bySpeed;
        if (order.reason) assumptions.push(...order.notes, `${metadata.name}: ${first ? "doubled power, moves before the target" : "usual power, moves after the target"} (${order.reason}).`);
      }
      resolved = resolveWith((overridePower ?? metadata.power) * (first ? 2 : 1), { name: `${metadata.name} (turn order set)` as MoveName });
      if (resolved.kind) return emptyRow(metadata, resolved.kind, resolved.reason);
    }
    // Set only when the engine retargets, i.e. a grounded user on Psychic Terrain.
    let retargeted = false;
    // A doubles turn's one-target Z-Move with a spread target of its own (conditions.oneTarget) keeps one target too.
    const oneZ = !!conditions.oneTarget && !!resolved.move.isZ && ["allAdjacent", "allAdjacentFoes"].includes(resolved.move.target);
    let move = hitsOneFoe(metadata, conditions) || oneZ ? withSingleTarget(resolved.move, () => { retargeted = true; }) : resolved.move;
    move.hits = hitCount.hits;
    if (hitCount.hits > 1 && defender.item && AFTER_MOVE_ITEMS.has(defender.item)) defender.item = undefined;
    // The priority the move is used with, for turn order and the engine's priority shields.
    const { priority, grassyGlide } = usedPriority(metadata, assigned, resolved, attacker, attackerBuild, defenderBuild, conditions);
    // For the turn order (calculateMatchup's Mirror Herb and Opportunist): the engine drops negative priority, the catalog keeps it.
    trace.priority = resolved.transformed || assigned.priority >= 0 ? priority : assigned.priority;
    if (grassyGlide) assumptions.push("Grassy Glide: +1 priority.");
    // The engine reads move.priority both for its priority shields (Queenly Majesty, Dazzling, Armor Tail,
    // Psychic Terrain) and for the Tera/Stellar 60-power floor, where pinned Showdown's floor reads the
    // dex move's own priority (battle-actions.ts getDamage). A raise that stops the attack goes to the
    // engine; otherwise it changes nothing there but the floor, so a Terastallized user's move keeps its
    // own priority.
    if (priority !== move.priority && (!attacker.teraType
      || calculate(generation, attacker, defender, withResolvedPriority(move.clone(), priority), makeField(conditions)).range()[1] === 0)) {
      withResolvedPriority(move, priority);
    }
    // Analytic's turn order: the move settings' choice, a Protecting target in Singles, or in Singles
    // the order against the target. The engine boosts on its condition (abilityOn) and Run Away has
    // no effect, so each decision is exact.
    if (analyticOrdered && !analyticAfterProtect) {
      let last: boolean | null = null;
      if (FUTURE_MOVES.has(metadata.id)) {
        // Future Sight and Doom Desire land at the end of a later turn, when no Pokémon still has to move.
        last = true;
        assumptions.push(`Analytic: boosted, ${metadata.name} lands after every Pokémon has moved (assumes the user is still in battle).`);
      } else if (context?.turnOrder) {
        last = context.turnOrder === "last";
        assumptions.push(`Analytic: ${last ? "boosted, moves last" : "no boost, moves before another Pokémon"}.`);
      } else {
        const probe = calculate(generation, attacker, defender, move, makeField(conditions));
        // No damage either way (an immune target) needs no turn order.
        if (probe.range()[1] > 0) {
          // Nor does a hit an intact face or disguise takes.
          const face = intactFace(probe.move.category);
          if (face) return emptyRow(metadata, "needs-context", face);
          if (conditions.gameType === "Doubles") {
            return emptyRow(metadata, "needs-context", "Analytic: needs the Doubles turn order.");
          }
          // The engine drops negative priority (Avalanche, Focus Punch...); the catalog keeps it.
          const orderPriority = resolved.transformed || assigned.priority >= 0 ? priority : assigned.priority;
          const order = turnOrderAgainstTarget(probe, orderPriority, attackerBuild, defenderBuild, conditions, runtime);
          if (order.order === "tie") {
            return emptyRow(metadata, "needs-context", `Analytic: needs the turn order (${order.reason}).`);
          }
          last = order.order === "last";
          orderBySpeed = order.bySpeed;
          assumptions.push(...order.notes, `Analytic: ${last ? "boosted, moves after the target" : "no boost, moves before the target"} (${order.reason}).`);
        }
      }
      if (last === true) attacker.abilityOn = true;
      else if (last === false) attacker.ability = "Run Away" as AbilityName;
    }
    if (FIXED_HP_MOVES[metadata.id]) {
      // A neutral name keeps name-keyed engine branches (its own Nature's Madness case)
      // from replacing the probe's damage; the engine reads data by originalName.
      const probe = resolveWith(1, { name: "Fixed-damage probe" as MoveName });
      if (probe.kind) return emptyRow(metadata, probe.kind, probe.reason);
      const run = (target: Pokemon) => calculate(generation, attacker, target, probe.move, makeField(conditions));
      const probed = run(defender);
      trace.result = probed;
      trace.fixedHP = true;
      return fixedHPDamage(metadata, probed, assumptions, () => {
        // An empty ability would be refilled with the species' first one on the engine's
        // clone; Run Away has no effect anywhere in the engine.
        const bare = defender.clone();
        bare.ability = "Run Away" as AbilityName;
        return run(bare).range()[1] > 0;
      }, intactFace(metadata.category));
    }
    // The engine computes only the first strike: its own second strike re-applies setup to shared
    // objects, so parentalBondStrike computes it (and Showdown skips some moves altogether).
    const parentalBond = attacker.hasAbility("Parental Bond") && defenderBuild.abilityId !== "neutralizinggas";
    const bondSkip = parentalBond ? (beatUpHits ? "one hit per party member" : parentalBondSkip(metadata, move, conditions, hitCount.hits)) : null;
    if (attacker.hasAbility("Parental Bond")) attacker.ability = "Run Away" as AbilityName;
    if (bondSkip) assumptions.push(`Parental Bond: no second strike (${bondSkip}).`);
    let result = calculate(generation, attacker, defender, move, makeField(conditions));
    // A later use's engine-only rerun starts from these inputs; every step below that changes the damage
    // after the engine call clears them.
    trace.engine = { attacker, defender, move, conditions };
    // On a Shell Side Arm tie Showdown picks the category at random: the row is the special hit and the
    // physical hit, which makes contact, its 50% alternate. Neutral names keep the engine's own choice off.
    let tiedPhysical: Result | null = null;
    if (metadata.id === "shellsidearm" && !resolved.transformed && shellSideArmTies(result)) {
      const special = resolveWith(overridePower, { name: "Shell Side Arm (special)" as MoveName, category: "Special" });
      if (special.kind) return emptyRow(metadata, special.kind, special.reason);
      const physical = resolveWith(overridePower, { name: "Shell Side Arm (physical)" as MoveName, category: "Physical", flags: { contact: 1 } });
      if (physical.kind) return emptyRow(metadata, physical.kind, physical.reason);
      special.move.hits = physical.move.hits = hitCount.hits;
      move = special.move;
      result = calculate(generation, attacker, defender, move, makeField(conditions));
      tiedPhysical = calculate(generation, attacker, defender, physical.move, makeField(conditions));
      trace.engine = undefined;
    }
    // Shell Side Arm off a tie, and Tera Blast or Tera Starstorm from a Terastallized user, turn physical
    // only inside the engine's calculate() (as in Showdown's onModifyMove), so Ice Face is checked with the
    // engine's category (a tie's physical half is its alternate, below). Only a hit that connects meets the face or disguise: an immune target (a Ground move into an
    // Air Balloon, a Normal move into a Ghost) or a move that fails (Poltergeist without an item, priority on
    // Psychic Terrain) leaves it intact.
    const face = intactFace(result.move.category);
    if (face && result.range()[1] > 0) return emptyRow(metadata, "needs-context", face);
    if (hitsReason) return { ...emptyRow(metadata, "needs-context", hitsReason), hitRule };
    const finalMods = Math.max(...[result, tiedPhysical].map((run) => run?.rawDesc.isFriendGuard ? finalModifierCount(run) : 0));
    if (finalMods >= 3) {
      return emptyRow(metadata, "unsupported", `Friend Guard with ${finalMods - 1} other damage modifiers: not calculated (their order can change the damage by 1 HP).`);
    }
    const overlordChain = supremeOverlordChain(generation, result);
    if (overlordChain !== null && overlordChain >= 3) {
      return emptyRow(metadata, "unsupported", `Supreme Overlord with ${overlordChain - 1} other power boosts: not calculated (their order can change the damage by 1–2 HP).`);
    }
    if (beatUpHits && beatUpHits.length > 1 && Array.isArray(result.damage) && !Array.isArray(result.damage[0])) {
      // Each hit is calculated on its own at that member's power.
      const blocker = BEAT_UP_BLOCKERS.find((entry) => entry.applies(result, conditions));
      if (blocker) return emptyRow(metadata, "unsupported", `Beat Up into ${blocker.name}: not calculated.`);
      const strikes = [result.damage as number[]];
      const firstBurned = spicySprayFirstBurnedHit(result, attackerBuild, conditions);
      const burnedStriker = attacker.clone();
      burnedStriker.status = "brn";
      for (const [index, hit] of beatUpHits.entries()) {
        if (index === 0) continue;
        const next = resolveWith(hit.power);
        if (next.kind) return emptyRow(metadata, next.kind, next.reason);
        next.move.hits = 1;
        const burned = firstBurned !== null && index >= firstBurned;
        const strike = calculate(generation, burned ? burnedStriker : attacker.clone(), defender, next.move, makeField(conditions));
        const damage = strike.damage;
        if (!Array.isArray(damage) || Array.isArray(damage[0])) return emptyRow(metadata, "unsupported", "The engine returned an unexpected Beat Up hit.");
        // Guts or Flare Boost that only the burned strikes use still belongs in the Applied list.
        if (burned) result.rawDesc.attackerAbility ??= strike.rawDesc.attackerAbility;
        strikes.push(damage as number[]);
      }
      result.damage = strikes;
      hitCount = { hits: strikes.length, reason: null };
      trace.engine = undefined;
    }
    if (retargeted && metadata.id === "terastarstorm") assumptions.push("One target: no spread reduction (assumes the target's partner is absent or fainted).");
    else if (retargeted) assumptions.push("One target: no spread reduction, 1.5x power from Psychic Terrain (assumes the target's partner is absent or fainted).");
    // The engine doubles Payback whenever the attacker is not faster (its turn-order guess).
    // Showdown doubles it only when the target already moved, which is this move's context.
    if (metadata.id === "payback" && eventPower !== null && !resolved.transformed && result.rawDesc.moveBP === eventPower * 2) {
      const retry = resolveWith(eventPower / 2);
      if (retry.kind) return emptyRow(metadata, retry.kind, retry.reason);
      retry.move.hits = hitCount.hits;
      result = calculate(generation, attacker, defender, retry.move, makeField(conditions));
      trace.engine = { attacker, defender, move: retry.move, conditions };
    }
    const firstHit = result;
    const firstBurnedHit = spicySprayFirstBurnedHit(firstHit, attackerBuild, conditions);
    // What the splices below changed for later hits, which a rerun for the attacker's HP between hits keeps.
    let burnedFrom: number | null = null;
    let seededLater: { defender: Pokemon; conditions: BattleConditions } | null = null;
    // The engine's own multi-hit loop keeps the attacker's first-hit status for every hit.
    if (firstBurnedHit !== null && !beatUpHits && hitCount.hits > firstBurnedHit && Array.isArray(result.damage) && Array.isArray(result.damage[0])) {
      const burned = attacker.clone();
      burned.status = "brn";
      const laterResult = calculate(generation, burned, defender, move, makeField(conditions));
      const later = laterResult.damage as number[][];
      result.damage = [...(result.damage as number[][]).slice(0, firstBurnedHit), ...later.slice(firstBurnedHit)];
      result.rawDesc.attackerAbility ??= laterResult.rawDesc.attackerAbility;
      trace.engine = undefined;
      burnedFrom = firstBurnedHit;
    }
    // Seed Sower sets Grassy Terrain after the first hit, and a held Grassy Seed then raises Defense
    // at once (Showdown onTerrainChange); the engine's multi-hit loop never checks the Seed again.
    if (!beatUpHits && hitCount.hits > 1 && Array.isArray(result.damage) && Array.isArray(result.damage[0]) && result.range()[1] > 0
      && result.defender.hasAbility("Seed Sower") && defender.hasItem("Grassy Seed") && conditions.terrain !== "Grassy"
      && !conditions.magicRoom && !defender.hasAbility("Klutz")) {
      const seeded = defender.clone();
      seeded.item = undefined;
      seeded.boosts.def = Math.max(-6, Math.min(6, seeded.boosts.def + (seeded.hasAbility("Contrary") ? -1 : 1)));
      const later = calculate(generation, attacker, seeded, move, makeField({ ...conditions, terrain: "Grassy" })).damage as number[][];
      result.damage = [(result.damage as number[][])[0], ...later.slice(1)];
      trace.engine = undefined;
      seededLater = { defender: seeded, conditions: { ...conditions, terrain: "Grassy" } };
    }
    if (parentalBond && !bondSkip && result.range()[1] > 0) {
      trace.engine = undefined;
      const first = result.damage;
      if (typeof first === "number") {
        // Fixed damage (Seismic Toss) is dealt in full by both strikes (damageCallback skips the quarter).
        result.damage = [Array(16).fill(first), Array(16).fill(first)];
      } else if (!Array.isArray(first[0])) {
        // Showdown doubles Assurance's second strike (the first hurt the target); a doubled case is already 2x.
        let strikeMove = move;
        if (metadata.id === "assurance" && eventPower !== null && !resolved.transformed && !isEventDoubled(metadata.id, context)) {
          const doubledRun = resolveWith(eventPower * 2);
          if (doubledRun.kind) return emptyRow(metadata, doubledRun.kind, doubledRun.reason);
          doubledRun.move.hits = 1;
          strikeMove = doubledRun.move;
          assumptions.push("Parental Bond: Assurance's second strike has doubled power.");
        }
        const second = parentalBondStrike(generation, makePokemon(attackerBuild, runtime, attackingSpecies, attackerMimicry.types), defender, strikeMove, conditions, result, spicySprayFirstBurnedHit(result, attackerBuild, conditions) === 1);
        if (!Array.isArray(second) || Array.isArray(second[0])) return emptyRow(metadata, "unsupported", "The engine returned an unexpected Parental Bond second strike.");
        result.damage = [first as number[], second as number[]];
      }
      result.rawDesc.attackerAbility ??= "Parental Bond";
    }
    // A burn changes physical hits (halved, or boosted by Guts and Facade) and Flare Boost's special ones.
    if (firstBurnedHit !== null && Array.isArray(result.damage) && Array.isArray(result.damage[0]) && result.damage.length > firstBurnedHit
      && (result.move.category === "Physical" || result.attacker.hasAbility("Flare Boost"))) {
      assumptions.push(firstBurnedHit === 1
        ? "Spicy Spray: the attacker is burned from the second hit on (assumes no Safeguard)."
        : `Spicy Spray: the attacker is burned from the third hit on (its ${result.attacker.item ?? "berry"} cured the first burn; assumes no Safeguard).`);
    }
    if (ironBallGrounded && !conditions.gravity && result.move.type === "Ground") {
      assumptions.push(`Iron Ball: the target is grounded despite its ${runtime.abilitiesById.get(defenderBuild.abilityId)?.name ?? defenderBuild.abilityId}.`);
    }
    // Showdown's Unaware ignores only the attacker's Attack, Defense and Sp. Atk stages, so it
    // keeps Wonder Room Body Press's Sp. Def stage; the engine's Unaware ignores it. A crit
    // ignores a negative stage in both. The engine result carries the effective abilities
    // (Mold Breaker suppresses Unaware) and the stage after a terrain Seed; an immune target
    // takes no damage in both.
    const spdStage = result.attacker.boosts.spd ?? 0;
    if (conditions.wonderRoom && metadata.id === "bodypress" && result.defender.hasAbility("Unaware") && result.range()[1] > 0
      && (spdStage > 0 || (spdStage < 0 && !conditions.critical))) {
      return emptyRow(metadata, "unsupported", "Body Press under Wonder Room into Unaware with a Sp. Def stage: not calculated.");
    }
    // Use effective cloned abilities: Mold Breaker may have suppressed Damp.
    if (EXPLOSIVE_MOVES.has(metadata.id) && (result.attacker.hasAbility("Damp") || result.defender.hasAbility("Damp"))) {
      return zeroDamage(metadata, `Damp prevents ${metadata.name} from being used.`);
    }
    // The attacker's HP from hit to hit (hit-loop.ts): what the target deals back on a hit (Rough Skin, Iron
    // Barbs, Rocky Helmet, a Jaboca or Rowap Berry, Gulp Missile), its own draining and berry; once it faints
    // no later hit lands. Without draining the hit it faints on hangs on no roll.
    const dealtHits = Array.isArray(result.damage) && Array.isArray(result.damage[0]) ? (result.damage as number[][]).length : 1;
    const loop = dealtHits > 1 ? hitLoopInput(result, attacker, attackerBuild, defenderBuild, conditions, runtime, metadata.id) : null;
    const retaliated = !!loop && hitsCanFaint(loop);
    const walk = retaliated && !loop!.drain ? walkHits(loop!, dealtHits) : null;
    // Pinned Showdown reads the user's HP, stat stages and status for each hit's damage (Blaze and its kin at a
    // third of its HP, Defeatist at half, an eaten pinch berry's stage, Guts once Gulp Missile paralyses it);
    // the engine keeps the first hit's for every hit, so a later hit whose attacker differs comes from a rerun
    // with that HP, stage and status (and the burn or Grassy Seed the splices above gave that hit). Beat Up's
    // strikes and Parental Bond's second are their own calculations: a change there is stated instead.
    const unspliced: string[] = [];
    if (walk) {
      const engineMove = result.move;
      const offense: CombatStat = engineMove.category === "Special" ? "spa" : metadata.id === "bodypress" ? "def" : "atk";
      const maxHP = attacker.maxHP();
      // The Gorging form's Gulp Missile paralyses the attacker in the hit that spends it (data/abilities.ts
      // gulpmissile trySetStatus: not an Electric type, a statused one or one on Misty Terrain on the ground; a
      // Lum or Cheri Berry cures it at that hit's Update), so Guts boosts the hits after that one.
      const ownTypes: readonly string[] = attacker.teraType && attacker.teraType !== "Stellar" ? [attacker.teraType] : attacker.types;
      const paralysedFrom = defenderBuild.speciesId === "cramorantgorging" && loop!.targetGulping && !attacker.status && !ownTypes.includes("Electric")
        && !(conditions.terrain === "Misty" && isGrounded(attacker, result.field)) && !["lumberry", "cheriberry"].includes(loop!.attackerItem)
        ? walk.before.findIndex((state) => !state.gulping) : -1;
      const modeOf = (state: HitState, index: number) => `${PINCH_TYPES[state.attackerAbility] === engineMove.type && state.hp <= maxHP / 3}|${state.attackerAbility === "defeatist" && state.hp <= maxHP / 2}`
        + `|${state.stages[offense] ?? 0}|${paralysedFrom > 0 && index >= paralysedFrom && state.attackerAbility === "guts"}`;
      const first = modeOf(walk.before[0], 0);
      const changed = walk.before.findIndex((state, index) => modeOf(state, index) !== first);
      if (changed > 0 && (beatUpHits || (parentalBond && !bondSkip))) {
        const state = walk.before[changed], before = walk.before[changed - 1];
        const raiser = state.stolen && !before.stolen ? state.stolen.item : attackerBuild.itemId;
        const what = (state.stages[offense] ?? 0) !== (before.stages[offense] ?? 0) ? `${runtime.itemsById.get(raiser)?.name ?? raiser} stat stage`
          : changed === paralysedFrom && state.attackerAbility === "guts" ? "Guts once Gulp Missile paralyses it"
            : `${runtime.abilitiesById.get(state.attackerAbility)?.name ?? state.attackerAbility} at its HP`;
        unspliced.push(`Not included: the attacker's ${what} from hit ${changed + 1}.`);
      } else if (changed > 0) {
        const reruns = new Map<string, number[][]>();
        result.damage = (result.damage as number[][]).map((rolls, index) => {
          // The hits after the attacker faints never land (the cut below drops them).
          const state = walk.before[index];
          if (!state || modeOf(state, index) === first) return rolls;
          const mode = modeOf(state, index);
          const burned = burnedFrom !== null && index >= burnedFrom, seeded = !!seededLater && index >= 1;
          const paralysed = paralysedFrom > 0 && index >= paralysedFrom;
          const key = `${mode}|${burned}|${seeded}`;
          let damage = reruns.get(key);
          if (!damage) {
            const striker = attacker.clone();
            striker.originalCurHP = state.hp;
            striker.boosts[offense] = Math.max(-6, Math.min(6, striker.boosts[offense] + (state.stages[offense] ?? 0)));
            if (burned) striker.status = "brn";
            else if (paralysed) striker.status = "par";
            const rerun = calculate(generation, striker, seeded ? seededLater!.defender : defender, move, makeField(seeded ? seededLater!.conditions : conditions));
            reruns.set(key, damage = rerun.damage as number[][]);
          }
          return [...damage[index]];
        });
        trace.engine = undefined;
      }
    }
    if (protect?.kind === "quarter") {
      trace.engine = undefined;
      const damage = result.damage;
      // Guardian of Alola's own damageCallback: 3/4 of the HP, then round(x / 4) half down, at least 1.
      result.damage = typeof damage === "number" ? (damage === 0 ? 0 : Math.max(1, Math.ceil(damage / 4 - 0.5)))
        : Array.isArray(damage[0]) ? (damage as number[][]).map((hit) => hit.map(quarterDamage)) : (damage as number[]).map(quarterDamage);
    }
    // The hits that land: every hit the engine dealt, cut where the attacker faints, and for a random count
    // each count's chance, those it cuts short merged into the hit it faints on (types.ts hitChances). The
    // engine result keeps every hit it dealt (trace.result), for a later use from other HP. With no per-hit
    // damage (an immune target) no hit lands, so no count is rolled (pinned Showdown hitStepMoveHitLoop runs
    // after hitStepTryHitEvent and hitStepTypeImmunity).
    const engineHits = Array.isArray(result.damage) && Array.isArray(result.damage[0]) ? result.damage as number[][] : null;
    let landedHits = engineHits;
    let chances = engineHits ? randomHits : null;
    let attackerFaintsOnHit: MoveDamageResult["attackerFaintsOnHit"];
    let pathRange: { min: number; max: number } | null = null;
    const countLines: string[] = [];
    const attackerSpecies = attackerBuild.transformedFrom?.speciesId ?? attackerBuild.speciesId;
    const attackerName = runtime.speciesById.get(attackerSpecies)?.name ?? attackerSpecies;
    const cutAt = (hit: number, by: string[]) => {
      landedHits = engineHits!.slice(0, hit);
      attackerFaintsOnHit = { hit, of: engineHits!.length, by };
      if (chances) {
        const kept = chances.filter((entry) => entry.hits < hit);
        const reaching = chances.filter((entry) => entry.hits >= hit);
        const merged = [...kept, ...reaching.length ? [{ hits: hit, chance: reaching.reduce((total, entry) => total + entry.chance, 0) }] : []];
        attackerFaintsOnHit.ofMin = reaching[0].hits;
        countLines.push(`${attackerName} faints on hit ${hit} of ${hitCountsText(reaching[0].hits, reaching[reaching.length - 1].hits)} (${listNames(by)}).`);
        chances = merged.length > 1 ? merged : null;
      } else {
        countLines.push(`${attackerName} faints on hit ${hit} of ${engineHits!.length} (${listNames(by)}).`);
      }
      trace.engine = undefined;
    };
    if (engineHits && walk?.faint && walk.faint.hit < engineHits.length) cutAt(walk.faint.hit, walk.faint.by);
    if (engineHits && retaliated && loop!.drain) {
      // Draining heals by what each hit dealt, so the hit the attacker faints on hangs on the rolls: the
      // lowest damage stops at the earliest faint, the highest at the latest (hitPaths).
      const paths = hitPaths(loop!, engineHits);
      const early = paths.faints.slice(0, -1);
      const sure = early.findIndex((mass) => mass > 1 - 1e-12);
      const sources = (pick: (rolls: number[]) => number) => walkHits(loop!, engineHits.length, (hit) => pick(engineHits[hit - 1])).faint?.by ?? [];
      const by = [...new Set([...sources((rolls) => Math.min(...rolls)), ...sources((rolls) => Math.max(...rolls))])];
      if (sure >= 0) cutAt(sure + 1, by);
      else if (early.some((mass) => mass > 0)) {
        const stands = 1 - early.reduce((total, mass) => total + mass, 0);
        const last = stands > 0 ? engineHits.length : early.findLastIndex((mass) => mass > 0) + 1;
        landedHits = engineHits.slice(0, last);
        pathRange = { min: paths.min, max: paths.max };
        early.forEach((mass, index) => {
          if (mass > 0) countLines.push(`${attackerName} faints on hit ${index + 1} of ${engineHits.length} (${listNames(by)}) on ${chanceText(mass)} of rolls.`);
        });
        trace.engine = undefined;
      }
    }
    if (chances) countLines.unshift(hitRangeLine(metadata.name, chances, hitRule.kind === "choose" && hitRule.loadedDice));
    // A count line that names hits the faint cuts short ("Population Bomb: all 10 hits land.") gives way to the faint's.
    if (attackerFaintsOnHit && ownCountLine && (hitRule.kind === "choose" || / hits land\.$/.test(ownCountLine))) assumptions.splice(countLine, 1);
    assumptions.splice(countLine, 0, ...countLines, ...unspliced);
    const sum = (hits: number[][], count: number, pick: (rolls: number[]) => number) => hits.slice(0, count).reduce((total, rolls) => total + pick(rolls), 0);
    const [min, max] = pathRange ? [pathRange.min, pathRange.max]
      : landedHits ? [sum(landedHits, chances ? chances[0].hits : landedHits.length, (rolls) => Math.min(...rolls)), sum(landedHits, landedHits.length, (rolls) => Math.max(...rolls))]
        : result.range();
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min) {
      return emptyRow(metadata, "unsupported", "The engine returned an invalid damage range for this matchup.");
    }
    if (landedHits && landedHits.length > 1) assumptions.push(MULTI_HIT_NOTE);
    if (result.attacker.hasItem("Metronome")) assumptions.push("Metronome: first use, no boost.");
    if (conditions.attackerSide.charge && result.rawDesc.isCharge) assumptions.push("Charge: 2x power.");
    const tailwind = [conditions.attackerSide.tailwind && "the attacker's side", conditions.defenderSide.tailwind && "the target's side"].filter(Boolean);
    const speedSetsPower = SPEED_POWER_MOVES.has(metadata.id) && !MOVES_FIRST_POWER_MOVES.has(metadata.id);
    if (tailwind.length && (speedSetsPower || orderBySpeed)) assumptions.push(`Tailwind: doubled Speed on ${tailwind.join(" and ")}.`);
    // Showdown gives Wind Rider +1 Attack when Tailwind starts on its side or it enters during Tailwind.
    if (attackerWindRider !== null && result.move.category === "Physical" && metadata.id !== "foulplay" && metadata.id !== "bodypress") {
      assumptions.push(attackerWindRider ? "Wind Rider: +1 Attack from Tailwind, on top of the set stages." : "Wind Rider: no Tailwind boost (Neutralizing Gas).");
    }
    if (defenderWindRider !== null && metadata.id === "foulplay") {
      assumptions.push(defenderWindRider ? "Wind Rider: the target has +1 Attack from Tailwind, on top of the set stages." : "Wind Rider: the target gets no Tailwind boost (Neutralizing Gas).");
    }
    for (const [label, build] of [["Attacker", attackerBuild], ["Target", defenderBuild]] as const) {
      if (label === "Attacker" && analyticAfterProtect) continue;
      // Shields Down and Schooling's switch is described by their form notes, when it matters.
      if (["shieldsdown", "schooling"].includes(build.abilityId)) continue;
      // A receiving Pokémon's condition matters only when it changes its Speed or typing.
      if (label === "Target" && !RECEIVER_CONDITIONS.has(build.abilityId) && !(build.abilityId === "intrepidsword" && metadata.id === "foulplay")) continue;
      // A condition means nothing while the other battler's Neutralizing Gas suppresses the ability.
      if (gassedAbility(build, label === "Attacker" ? defenderBuild : attackerBuild, conditions)) continue;
      const activation = abilityActivationLabel(build.abilityId, runtime.profile.id);
      if (activation) assumptions.push(`${label}: ${/^(The|A|An|Its) /.test(activation) ? activation[0].toLowerCase() + activation.slice(1) : activation} — ${build.abilityActive ? "yes" : "no"}.`);
    }
    if (conditions.critical && result.defender.hasAbility("Shell Armor", "Battle Armor") && result.range()[1] > 0) {
      assumptions.push(`The target's ${result.defender.ability} prevents the critical hit.`);
    } else if (ratioCrit && result.range()[1] > 0) {
      assumptions.push(`Every hit is a critical hit (critical-hit ratio +${ratioCrit.stages}: ${listNames(ratioCrit.sources)}).`);
    }
    const screens = result.move.category === "Physical" ? [conditions.defenderSide.reflect && "Reflect", conditions.defenderSide.auroraVeil && "Aurora Veil"]
      : [conditions.defenderSide.lightScreen && "Light Screen", conditions.defenderSide.auroraVeil && "Aurora Veil"];
    if (result.attacker.hasAbility("Infiltrator") && screens.some(Boolean)) {
      assumptions.push(`Infiltrator ignores the target's ${screens.filter(Boolean).join(" and ")}.`);
    }
    if (result.rawDesc.moveType && result.rawDesc.moveType !== metadata.type) assumptions.push(`Effective move type: ${result.rawDesc.moveType}.`);
    const escalating = ESCALATING_MOVES.has(metadata.id) && !resolved.transformed && Array.isArray(result.damage) && Array.isArray(result.damage[0]);
    if (escalating) assumptions.push(`Power per hit: ${(landedHits ?? []).map((_, index) => metadata.power * (index + 1)).join(", ")}.`);
    else if (result.rawDesc.moveBP !== undefined && pokeRound(result.rawDesc.moveBP) !== metadata.power) assumptions.push(`Move power: ${pokeRound(result.rawDesc.moveBP)}.`);
    // Mold Breaker is listed only when ignoring the target's ability changed the damage or the KO
    // chance (Sturdy), when it broke through an intact Disguise the calculator checks itself, or when
    // it ignored the partner's Friend Guard (the run without it gets the Friend Guard back).
    // The stand-in Adaptability is Stellar's boost, already stated.
    if (stellarRevelation && result.rawDesc.attackerAbility === "Adaptability") delete result.rawDesc.attackerAbility;
    // G-Max Fireball's bypass is noted only when the ability would have changed the result (the
    // engine, which misspells the move, still applies it in a rerun).
    const same = (a: Result, b: Result) => JSON.stringify(a.damage) === JSON.stringify(b.damage) && directKOChance(a, hitCount.hits!) === directKOChance(b, hitCount.hits!);
    // The engine names a breaker only for a target ability it ignores; a Friend Guard partner the
    // calculation dropped for it counts too, and so does a partner's priority shield it let a hit through.
    const guarded = !!friendGuardSuppressedBy && friendGuardSuppressedBy !== "Neutralizing Gas" && !FIXED_DAMAGE_MOVES.has(metadata.id);
    const unshielded = !!shieldIgnoredBy && result.range()[1] > 0;
    const breaker = result.rawDesc.attackerAbility ?? (guarded ? friendGuardSuppressedBy ?? undefined : undefined) ?? (unshielded ? shieldIgnoredBy ?? undefined : undefined);
    // Only the label checks below need this rerun, so it runs at most once, on demand.
    let baseline: Result | null = null;
    const withIt = () => baseline ??= calculate(generation, attacker, defender, move, makeField(conditions));
    if (fireballIgnored) {
      const kept = defender.clone();
      kept.ability = fireballIgnored;
      if (!same(withIt(), calculate(generation, attacker, kept, move, makeField(conditions)))) assumptions.push(`G-Max Fireball ignores the target's ${fireballIgnored}.`);
    }
    if (["Mold Breaker", "Teravolt", "Turboblaze"].includes(breaker ?? "")) {
      const plain = attacker.clone();
      plain.ability = "Run Away" as AbilityName;
      const without = calculate(generation, plain, defender, move, makeField(guarded ? { ...conditions, defenderSide: { ...conditions.defenderSide, friendGuard: true } } : conditions));
      // Only a hit that connects meets the Disguise.
      const brokeDisguise = ["mimikyu", "mimikyutotem"].includes(defenderBuild.speciesId) && defenderBuild.abilityId === "disguise" && !IGNORE_ABILITY_MOVES.has(metadata.id) && withIt().range()[1] > 0;
      if (brokeDisguise) {
        assumptions.push(`${breaker} ignores the target's intact Disguise.`);
        result.rawDesc.attackerAbility = breaker;
      } else if (same(withIt(), without) && !unshielded) {
        delete result.rawDesc.attackerAbility;
      } else {
        result.rawDesc.attackerAbility = breaker;
        if (!same(withIt(), without) && JSON.stringify(withIt().damage) === JSON.stringify(without.damage) && !guarded) {
          assumptions.push(`${breaker} ignores the target's ${runtime.abilitiesById.get(defenderBuild.abilityId)?.name ?? defenderBuild.abilityId}.`);
        }
      }
    }
    // Ability Shield is listed only when the ability it kept changed the damage (tested by neutralizing
    // that ability, so an item-keyed move such as Knock Off still sees an item).
    for (const [side, key] of [["defender", "defenderItem"], ["attacker", "attackerItem"]] as const) {
      if (result.rawDesc[key] !== "Ability Shield") continue;
      const bare = (side === "defender" ? defender : attacker).clone();
      bare.ability = "Run Away" as AbilityName;
      const rerun = side === "defender" ? calculate(generation, attacker, bare, move, makeField(conditions)) : calculate(generation, bare, defender, move, makeField(conditions));
      if (same(withIt(), rerun)) delete result.rawDesc[key];
    }
    if (conditions.weather && !result.field.weather) assumptions.push("Weather is suppressed by an ability.");
    // False Swipe and Hold Back leave 1 HP before these could act (their own note says so).
    const spares = LEAVES_ONE_HP_MOVES.has(metadata.id);
    if (!spares && result.defender.curHP() === result.defender.maxHP()
      && (result.defender.hasItem("Focus Sash") || result.defender.hasAbility("Sturdy"))) {
      assumptions.push("Full-HP Focus Sash/Sturdy: no one-hit KO unless bypassed.");
    }
    if (!spares && result.defender.hasItem("Focus Band")) assumptions.push(FOCUS_BAND_NOTE);

    const minPercent = min / result.defender.maxHP() * 100;
    const maxPercent = max / result.defender.maxHP() * 100;
    // Fickle Beam doubles its power 30% of the time (Showdown onBasePower randomChance(3, 10) then
    // chainModify(2); an exact 2x, so a doubled base power gives the same rolls).
    let alternate: MoveDamageResult["alternate"];
    let alternateText = "";
    // A tie's physical hit, when its effects differ from the special hit's (the description then names each).
    let physicalEffects: ReturnType<typeof appliedEffects> | null = null;
    // One hit that lands (the attacker faints on the first) has the ordinary KO chance of its rolls.
    let koChance = landedHits?.length === 1 ? directKOChance(withDamage(result, landedHits[0]), 1) : directKOChance(result, hitCount.hits);
    if (metadata.id === "ficklebeam" && !resolved.transformed && max > 0 && Array.isArray(result.damage) && !Array.isArray(result.damage[0])) {
      const doubled = resolveWith((overridePower ?? metadata.power) * 2);
      if (doubled.kind) return emptyRow(metadata, doubled.kind, doubled.reason);
      doubled.move.hits = 1;
      const doubledResult = calculate(generation, attacker, defender, doubled.move, makeField(conditions));
      if (protect?.kind === "quarter" && Array.isArray(doubledResult.damage)) doubledResult.damage = (doubledResult.damage as number[]).map(quarterDamage);
      const [altMin, altMax] = doubledResult.range();
      const altKO = directKOChance(doubledResult, 1);
      alternate = {
        chance: 0.3, label: "doubled power", usualLabel: "usual power", min: altMin, max: altMax,
        minPercent: altMin / result.defender.maxHP() * 100, maxPercent: altMax / result.defender.maxHP() * 100,
        rolls: [...(doubledResult.damage as number[])],
      };
      koChance = koChance === null || altKO === null ? null : 0.7 * koChance + 0.3 * altKO;
      trace.engine = undefined;
      assumptions.push(`Fickle Beam: doubled power 30% of the time, ${altMin}–${altMax} HP (${alternate.minPercent.toFixed(1)}–${alternate.maxPercent.toFixed(1)}%). The KO chance includes both cases.`);
      alternateText = `, or ${altMin}–${altMax} HP (${alternate.minPercent.toFixed(1)}–${alternate.maxPercent.toFixed(1)}%) when its power doubles (30% chance)`;
    }
    // No Shell Side Arm user has Parental Bond or another multi-hit source, so both hits are single roll sets
    // (an immune target gives 0 for both).
    if (tiedPhysical && Array.isArray(result.damage) && !Array.isArray(result.damage[0]) && Array.isArray(tiedPhysical.damage) && !Array.isArray(tiedPhysical.damage[0])) {
      // An intact Ice Face takes the physical hit whole (pinned Showdown iceface onDamage returns 0).
      const rolls = iceFace ? (tiedPhysical.damage as number[]).map(() => 0) : [...(tiedPhysical.damage as number[])];
      const tie = "Shell Side Arm: tied, so physical or special at random";
      if (JSON.stringify(rolls) === JSON.stringify(result.damage)) {
        assumptions.push(`${tie} (50% each), same damage; only the physical hit makes contact.`);
      } else {
        const [altMin, altMax] = [Math.min(...rolls), Math.max(...rolls)];
        alternate = {
          chance: 0.5, label: iceFace ? "a physical hit, which Ice Face blocks" : "a physical hit", usualLabel: "special hit", min: altMin, max: altMax,
          minPercent: altMin / result.defender.maxHP() * 100, maxPercent: altMax / result.defender.maxHP() * 100, rolls,
        };
        const altKO = iceFace ? 0 : directKOChance(tiedPhysical, hitCount.hits);
        koChance = koChance === null || altKO === null ? null : 0.5 * koChance + 0.5 * altKO;
        assumptions.push(iceFace
          ? `${tie}: these rolls are the special hit (50%); Ice Face blocks the physical hit (50%). The KO chance includes both cases.`
          : `${tie}: these rolls are the special hit (50%); the physical hit (50%, contact) deals ${altMin}–${altMax} HP (${alternate.minPercent.toFixed(1)}–${alternate.maxPercent.toFixed(1)}%). The KO chance includes both cases.`);
        if (!iceFace && appliedEffects(tiedPhysical).join() !== appliedEffects(result).join()) physicalEffects = appliedEffects(tiedPhysical);
        alternateText = iceFace ? ", or no damage when it is physical and Ice Face blocks it (50% chance)"
          : `, or ${altMin}–${altMax} HP (${alternate.minPercent.toFixed(1)}–${alternate.maxPercent.toFixed(1)}%) when it is physical (50% chance)`;
      }
    }
    // Weather Ball, Terrain Pulse, Multi-Attack and Techno Blast take their own type before Z or Max
    // conversion (pinned Showdown useMove / getActiveMaxMove), so the Z-Move or Max Move is that
    // type's; the engine types the result so but keeps the Normal Breakneck Blitz or Max Strike name.
    // (hit-loop.ts usedMoveName, which Uses to KO and the doubles turn read its own effects by.)
    const used = resolved.transformed ? usedMoveName(assigned.name, result.move) : result.move.name;
    const zName = used !== result.move.name ? used : null;
    if (zName) assumptions.push(`${assigned.name} is ${result.move.type} type, so it becomes ${zName}.`);
    const effectNames = appliedEffects(result);
    trace.result = result;
    const applied = physicalEffects
      ? `${effectNames.length ? ` Applied to the special hit: ${effectNames.join(", ")}.` : ""}${physicalEffects.length ? ` Applied to the physical hit: ${physicalEffects.join(", ")}.` : ""}`
      : effectNames.length ? ` Applied: ${effectNames.join(", ")}.` : "";
    return {
      // A neutral engine name (a suppressed item, a set turn order) is not shown; a Z-Move or Max Move keeps its own.
      moveId: assigned.id, effectiveName: zName ?? (resolved.transformed ? result.move.name : metadata.name), effectiveType: result.move.type,
      // Showdown rounds a modified base power (pokeRound: Knock Off's 97.5 is 97); escalating hits show the first hit's.
      // Natural Gift's power comes from the held berry (the engine does not report it).
      effectivePower: escalating ? metadata.power
        : metadata.id === "naturalgift" && result.attacker.item?.endsWith("Berry") ? getNaturalGift(generation, result.attacker.item).p
          : result.rawDesc.moveBP !== undefined ? pokeRound(result.rawDesc.moveBP) : result.move.bp, effectiveCategory: result.move.category,
      kind: "calculated", min, max, minPercent, maxPercent,
      rolls: landedHits ? (landedHits.length === 1 ? [...landedHits[0]] : landedHits.map((rolls) => [...rolls])) : copyRolls(result.damage), ohkoChance: koChance,
      description: `${zName ?? metadata.name}: ${min}–${max} HP (${minPercent.toFixed(1)}–${maxPercent.toFixed(1)}% of maximum HP)${alternateText}.${applied}`,
      // The hits that land (Parental Bond's two strikes included); none for a random count no hit reaches.
      assumptions, reason: null, hits: landedHits ? landedHits.length : randomHits ? null : hitCount.hits, hitRule,
      ...(chances ? { hitChances: chances } : {}), ...(attackerFaintsOnHit ? { attackerFaintsOnHit } : {}),
      ...survivalEffect(result, Math.max(max, alternate?.max ?? 0)),
      ...(alternate ? { alternate } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown engine error.";
    return emptyRow(metadata, "unsupported", `This matchup could not be calculated: ${message}`);
  }
}

function listNames(names: string[]) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function orList(names: string[]) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** A row with several hits until calculateMatchup gives it its first use's exact outcome (MoveDamageResult.afterUse). */
const MULTI_HIT_NOTE = "No one-use KO chance for multiple hits.";

export function calculateMatchup(
  attacker: BattleBuild,
  defender: BattleBuild,
  field: BattleConditions,
  contexts: Record<string, MoveContext> = {},
  runtime: BattleRuntime = championsRuntime,
): MatchupResult {
  const settled = settleMatchup(attacker, defender, field, runtime);
  return "results" in settled ? settled : matchupRows(settled, contexts, runtime);
}

/**
 * What calculateMatchup settles before its rows: the two settled builds (abilities and forms, the entry effects
 * between them, held items), the field with Singles' partners dropped and Friend Guard where it cannot apply, the
 * moves the rows list, the settle lines (`notes`), and each side's settleItems outcome for the row loop
 * (matchupRows: Starf outcomes, copies, Uses to KO, merges and facts).
 */
export type SettledMatchup = {
  issues: MatchupResult["issues"];
  attacker: BattleBuild; defender: BattleBuild; field: BattleConditions;
  /** The moves the rows follow (a transformed Imposter user has its target's). */
  moves: readonly string[];
  notes: string[];
  names: { attacker: string; defender: string };
  attackerItems: SettledItems; defenderItems: SettledItems;
  /** The ability that suppresses the receiving side's Friend Guard partner for every move. */
  suppressor: string | null;
  settledHP?: MatchupResult["settledHP"];
};

/** settleMatchup's settle for calculateMatchup, or the result itself when the builds have issues or an ability withholds every row. */
export function settleMatchup(attacker: BattleBuild, defender: BattleBuild, field: BattleConditions, runtime: BattleRuntime = championsRuntime): MatchupResult | SettledMatchup {
  const issues = {
    attacker: validateBuild(attacker, runtime),
    defender: validateBuild(defender, runtime),
    field: validateConditions(field, runtime),
  };
  if (Object.values(issues).some((list) => list.length)) return { issues, results: [] };
  const species = runtime.speciesById.get(attacker.speciesId)!;
  const effective = withoutSinglesPartners(field, attacker, defender, runtime);
  const notes = effective.ignored.length
    ? [`Singles: ${listNames(effective.ignored)} ${effective.ignored.length === 1 ? "is" : "are"} ignored.`]
    : [];
  // States the battle settled on entry: abilities and forms first, then the entry effects between the
  // two, then held items (which read the settled abilities: a copied Klutz or Unnerve counts).
  const shown = { attacker: effective.attacker, defender: effective.defender };
  const names = { attacker: runtime.speciesById.get(shown.attacker.speciesId)?.name ?? shown.attacker.speciesId, defender: runtime.speciesById.get(shown.defender.speciesId)?.name ?? shown.defender.speciesId };
  const attackerAbility = settleAbilities(shown.attacker, shown.defender, effective.field, runtime, "the attacker", effective.field.defenderSide.tailwind);
  const defenderAbility = settleAbilities(shown.defender, shown.attacker, effective.field, runtime, "the target", effective.field.attackerSide.tailwind);
  const withheld = attackerAbility.withheld ?? defenderAbility.withheld;
  if (withheld) {
    // The rows follow the moves the attacker is shown with (a transformed Imposter user has its target's).
    const shownMoves = runtime.speciesById.get(movesSpeciesId(shown.attacker, shown.defender, effective.field.magicRoom)) ?? species;
    return { issues, results: shownMoves.moves.flatMap((id) => { const move = runtime.movesById.get(id); return move ? [{ ...emptyRow(move, "unsupported", withheld), moveId: id }] : []; }) };
  }
  const entry = settleEntry(attackerAbility.build, defenderAbility.build, shown, effective.field, runtime);
  const attackerItems = settleItems(entry.attacker, entry.defender, effective.field, runtime, "the attacker", names.attacker);
  const defenderItems = settleItems(entry.defender, entry.attacker, effective.field, runtime, "the target", names.defender);
  effective.attacker = attackerItems.build;
  effective.defender = defenderItems.build;
  notes.push(...attackerAbility.lines, ...defenderAbility.lines, ...entry.lines, ...attackerItems.lines, ...defenderItems.lines);
  const settledHP = attackerItems.settledHP || defenderItems.settledHP
    ? { ...(attackerItems.settledHP ? { attacker: attackerItems.settledHP } : {}), ...(defenderItems.settledHP ? { defender: defenderItems.settledHP } : {}) }
    : undefined;
  // Friend Guard protects the receiving side only; drop it where it cannot apply (per move in calculateMove).
  const suppressor = effective.field.defenderSide.friendGuard ? partnerAbilitySuppressor(effective.attacker, effective.defender, runtime) : null;
  if (suppressor) effective.field = { ...effective.field, defenderSide: { ...effective.field.defenderSide, friendGuard: false } };
  // A transformed Imposter user attacks with its target's moves; a form change keeps the Pokémon's own.
  const moveSpecies = effective.attacker.transformedFrom ? runtime.speciesById.get(effective.attacker.speciesId) ?? species : species;
  return {
    issues, attacker: effective.attacker, defender: effective.defender, field: effective.field, moves: moveSpecies.moves, notes, names,
    attackerItems, defenderItems, suppressor, ...(settledHP ? { settledHP } : {}),
  };
}

/** The helpers Uses to KO reads of calculate.ts (uses-to-ko.ts UsesHelpers). */
export function usesHelpers(runtime: BattleRuntime): UsesHelpers {
  return {
    gassed: gassedAbility, klutz: klutzActive, spicySpray: spicySprayFirstBurnedHit, makeField, paradox: (speciesId) => PARADOX_SPECIES.has(speciesId),
    critRatio: (moveId, build, other, context, conditions) => runtime.profile.generation < 6 ? 0 : critRatio(moveId, build, other, context, conditions, runtime).ratio,
    hpForm: (build) => { const form = entryForm(build, runtime); return form && !form.kept ? form.speciesId : null; },
  };
}

/** calculateMatchup's rows from a settled matchup (settleMatchup, or the doubles start's calculateDoublesMoves). */
export function matchupRows(settled: SettledMatchup, contexts: Record<string, MoveContext>, runtime: BattleRuntime): MatchupResult {
  const { issues, notes, names, attackerItems, defenderItems, suppressor, settledHP } = settled;
  const effective = { attacker: settled.attacker, defender: settled.defender, field: settled.field };
  // Uses to KO repeats each calculated row from the settled builds (uses-to-ko.ts); the entry effects
  // settled above are not settled again for later uses.
  const helpers = usesHelpers(runtime);
  // A Starf Berry eaten before the move raised one stat at random: every outcome is its own pair of builds, each
  // equally likely on its side (starfOutcomes); without one there is a single outcome, the settled builds.
  const outcomes = starfOutcomes(effective.attacker, effective.defender, attackerItems.starf, defenderItems.starf);
  const prepared = new Map<StarfOutcome, ReturnType<typeof prepareUses> | null>();
  const usesFor = (outcome: StarfOutcome) => {
    if (!prepared.has(outcome)) {
      let uses: ReturnType<typeof prepareUses> | null = null;
      try {
        uses = prepareUses(outcome.attacker, outcome.defender, effective.field, runtime, helpers);
      } catch {
        // Every calculated row then says its uses could not be counted.
      }
      prepared.set(outcome, uses);
    }
    return prepared.get(outcome)!;
  };
  // Harvest may regrow a Berry either Pokémon ate before the move, and Cud Chew eats it again, at the end of a later
  // turn (pinned Showdown data/abilities.ts harvest and cudchew onResidual); the uses do not follow either.
  const regrowth = (items: SettledItems, build: BattleBuild, other: BattleBuild, whose: string) => items.eaten && !gassedAbility(build, other, effective.field)
    ? ({ harvest: `${whose}Harvest may regrow its Berry`, cudchew: `${whose}Cud Chew eats its Berry again` } as Record<string, string>)[build.abilityId] : undefined;
  const regrown = regrowth(defenderItems, effective.defender, effective.attacker, "") ?? regrowth(attackerItems, effective.attacker, effective.defender, "The attacker's ");
  // Per Starf outcome, shared by the rows (and their prepared uses): the builds with the copies applied, and the
  // builds that apply them after the first use.
  const copiedOutcomes = new Map<StarfOutcome, StarfOutcome>();
  const pendingOutcomes = new Map<StarfOutcome, StarfOutcome>();
  const results = settled.moves.map((id) => {
    const move = runtime.movesById.get(id);
    if (!move) throw new Error(`${runtime.profile.id === "champions" ? "Champions" : runtime.profile.label} catalog has an unresolved move: ${id}.`);
    const calculateFor = (outcome: StarfOutcome) => {
      const trace: CalcTrace = {};
      const computed = calculateMove(move, outcome.attacker, outcome.defender, effective.field, contexts[id], runtime, suppressor, trace);
      return { outcome, computed, trace };
    };
    // A rise a foe's Mirror Herb or Opportunist copies (copiesOf) is applied at the turn's first AfterMove: before this
    // move when the target moves first in Singles, after it when the attacker does (the uses from the second on carry
    // it: pendingCopy), and otherwise either.
    const one = (outcome: StarfOutcome): ReturnType<typeof calculateFor> & { copy: { when: CopyTiming; facts: string[]; reason: string } | null } => {
      const plain = calculateFor(outcome);
      const copies = copiesOf(outcome, effective, attackerItems, defenderItems);
      if (!copies.length || plain.computed.kind !== "calculated" || plain.computed.max === 0) return { ...plain, copy: null };
      const order = effective.field.gameType === "Doubles" || !plain.trace.result ? null
        : turnOrderAgainstTarget(plain.trace.result, plain.trace.priority ?? move.priority, outcome.attacker, outcome.defender, effective.field, runtime);
      const when: CopyTiming = order?.order === "last" ? "before" : order?.order === "first" ? "after" : "either";
      const facts = [...(order?.notes ?? []), ...copies.map((copy) => copyLine(copy, when, order?.reason ?? "", names))];
      const reason = `${copies[0].by[0]} copies the ${copies[0].who === "attacker" ? "target" : "attacker"}'s rise`;
      if (when === "either") return { ...plain, copy: { when, facts, reason } };
      const map = when === "before" ? copiedOutcomes : pendingOutcomes;
      if (!map.has(outcome)) map.set(outcome, when === "before" ? withCopies(outcome, copies, effective.field) : withPendingCopies(outcome, copies));
      // The row before this move's copy is the plain one; its uses carry the copy from the second on.
      return when === "before" ? { ...calculateFor(map.get(outcome)!), copy: { when, facts, reason } } : { ...plain, outcome: map.get(outcome)!, copy: { when, facts, reason } };
    };
    // Uses to KO and the first use's exact outcome (uses-to-ko.ts estimateUses).
    const count = ({ outcome, computed, trace, copy }: ReturnType<typeof one>): { usesToKO: UsesToKO; afterUse: AfterUse | null } => {
      // A count that cannot be worked out never takes the row's one-use result down with it.
      try {
        const uses = usesFor(outcome);
        if (!uses) throw new Error("No uses to count");
        const { usesToKO, afterUse } = estimateUses(uses, {
          move, row: computed, trace, context: contexts[id],
          rerun: (next) => {
            const nextTrace: CalcTrace = {};
            const nextRow = calculateMove(move, next.attacker, next.defender, next.conditions, next.context, runtime, suppressor, nextTrace, next.consecutive, true);
            return { row: nextRow, trace: nextTrace };
          },
        });
        // The Berry comes back only at the end of a turn: a count every sequence finishes in its first use stands, and
        // so does the first use's outcome. A copy that may come before or after this move leaves neither.
        if (copy?.when === "either") return { usesToKO: { kind: "not-estimated", reason: copy.reason }, afterUse: null };
        return { usesToKO: regrown && usesToKO.kind === "uses" && usesToKO.guaranteed !== 1 ? { kind: "not-estimated", reason: regrown } : usesToKO, afterUse };
      } catch {
        return { usesToKO: { kind: "not-estimated", reason: UNCOUNTED }, afterUse: null };
      }
    };
    const runs = outcomes.map(one);
    const merged = runs.length === 1 ? { row: runs[0].computed, facts: [] } : mergeStarfOutcomes(runs);
    let row: MoveDamageResult = { ...merged.row, moveId: id };
    if (row.kind === "calculated") {
      let afterUse: AfterUse | null;
      if (runs.length === 1) {
        const estimated = count(runs[0]);
        row.usesToKO = estimated.usesToKO;
        afterUse = estimated.afterUse;
      } else {
        // The uses carry the stat a Starf Berry raised: they are counted only when every outcome counts the same,
        // and the first use's outcome is kept only when every outcome's is the same.
        const counts = sameStarfDamage(runs) ? runs.map(count) : null;
        const same = (pick: (entry: ReturnType<typeof count>) => unknown) => !!counts && counts.every((entry) => JSON.stringify(pick(entry)) === JSON.stringify(pick(counts[0])));
        row.usesToKO = same((entry) => entry.usesToKO) ? counts![0].usesToKO : { kind: "not-estimated", reason: STARF_REASON };
        afterUse = same((entry) => entry.afterUse) ? counts![0].afterUse : null;
      }
      if (afterUse) {
        // Several hits take their one-use KO chance from the first use's walk (each hit's rolls, the hits stopping
        // once the target faints, survival effects and berries between hits); one hit keeps its own, which the walk
        // gives too, unless it has none.
        const several = (row.hits ?? 0) > 1;
        row = {
          ...row, afterUse,
          ...(several || row.ohkoChance === null ? { ohkoChance: afterUse.koChance } : {}),
          ...(several ? { assumptions: row.assumptions.filter((line) => line !== MULTI_HIT_NOTE) } : {}),
        };
      }
      // A copy that may come before or after this move leaves its KO chance to the turn order.
      if (runs.some((run) => run.copy?.when === "either")) row = { ...row, ohkoChance: null };
      // A confused attacker (its Figy-family Berry) hits itself instead of moving 33% of the time (pinned Showdown
      // data/conditions.ts confusion onBeforeMove: randomChance(33, 100)). As with full paralysis, the counts
      // follow the move being used and say so.
      if (attackerItems.confused && (row.max ?? 0) > 0 && row.usesToKO?.kind === "uses" && !row.usesToKO.notes.includes(CONFUSED_NOTE)) {
        row = { ...row, usesToKO: { ...row.usesToKO, notes: [...row.usesToKO.notes, CONFUSED_NOTE] } };
      }
    }
    // The Starf Berry's outcomes and the copies follow the line saying the berry was eaten.
    const copyFacts = [...new Set(runs.flatMap((run) => run.copy?.facts ?? []))].filter((line) => !row.assumptions.includes(line));
    const confusedFact = attackerItems.confused && (row.max ?? 0) > 0 ? [CONFUSED_NOTE] : [];
    const facts = [...notes, ...merged.facts, ...copyFacts, ...confusedFact];
    return facts.length && row.kind === "calculated" ? { ...row, assumptions: [...row.assumptions, ...facts] } : row;
  });
  return { issues, results, ...(settledHP ? { settledHP } : {}) };
}

/** When the turn's first AfterMove applies a copied rise: before this move, after it, or either (Doubles, a Speed tie). */
type CopyTiming = "before" | "after" | "either";
/** The stages a foe's Berry raised before the move, stored by `who`'s Mirror Herb or Opportunist (`by`). */
type Copy = { who: "attacker" | "target"; by: string[]; stages: Partial<Record<CombatStat, number>> };

/**
 * The rises each side's Opportunist or Mirror Herb copies from the other's Berry eaten before the move (pinned
 * Showdown data/abilities.ts opportunist and data/items.ts mirrorherb onFoeAfterBoost: the stages boost() raised,
 * with a Starf Berry's in this outcome), to be applied at the turn's first onAnyAfterMove. Neutralizing Gas stops
 * the ability, Magic Room or an active Klutz the herb.
 */
function copiesOf(outcome: StarfOutcome, settled: { attacker: BattleBuild; defender: BattleBuild; field: BattleConditions }, attackerItems: SettledItems, defenderItems: SettledItems): Copy[] {
  const copies: Copy[] = [];
  const sides = [
    { who: "attacker" as const, holder: outcome.attacker, foe: outcome.defender, foeSettled: settled.defender, raised: defenderItems.raised },
    { who: "target" as const, holder: outcome.defender, foe: outcome.attacker, foeSettled: settled.attacker, raised: attackerItems.raised },
  ];
  for (const { who, holder, foe, foeSettled, raised } of sides) {
    const by = [
      ...(holder.abilityId === "opportunist" && !gassedAbility(holder, foe, settled.field) ? ["Opportunist"] : []),
      ...(holder.itemId === "mirrorherb" && !settled.field.magicRoom && !klutzActive(holder, foe) ? ["Mirror Herb"] : []),
    ];
    if (!by.length) continue;
    const stages: Partial<Record<CombatStat, number>> = { ...raised };
    // The foe's Starf Berry rise in this outcome.
    for (const stat of COMBAT_STATS) {
      const rise = (foe.boosts[stat] ?? 0) - (foeSettled.boosts[stat] ?? 0);
      if (rise > 0) stages[stat] = (stages[stat] ?? 0) + rise;
    }
    if (Object.keys(stages).length) copies.push({ who, by, stages });
  }
  return copies;
}

/** The outcome with each copy applied through boost() (Contrary, Simple, the ±6 cap), once for each copier, a used Mirror Herb gone (Unburden activates). */
function withCopies(outcome: StarfOutcome, copies: Copy[], field: BattleConditions): StarfOutcome {
  let { attacker, defender } = outcome;
  for (const copy of copies) {
    const build = copy.who === "attacker" ? attacker : defender, foe = copy.who === "attacker" ? defender : attacker;
    const abilityOn = !gassedAbility(build, foe, field);
    const scale = (abilityOn && build.abilityId === "contrary" ? -1 : 1) * (abilityOn && build.abilityId === "simple" ? 2 : 1);
    const boosts = { ...build.boosts };
    for (let time = 0; time < copy.by.length; time++) {
      for (const [stat, amount] of Object.entries(copy.stages) as [CombatStat, number][]) boosts[stat] = clampStage((boosts[stat] ?? 0) + amount * scale);
    }
    const herb = copy.by.includes("Mirror Herb");
    const next: BattleBuild = { ...build, boosts, ...(herb ? { itemId: "", ...(build.abilityId === "unburden" && abilityOn ? { abilityActive: true } : {}) } : {}) };
    if (copy.who === "attacker") attacker = next;
    else defender = next;
  }
  return { ...outcome, attacker, defender };
}

/** The outcome whose copiers apply their copies after the attacker's first use (types.ts pendingCopy, uses-to-ko.ts afterHit). */
function withPendingCopies(outcome: StarfOutcome, copies: Copy[]): StarfOutcome {
  let { attacker, defender } = outcome;
  for (const { who, by, stages } of copies) {
    if (who === "attacker") attacker = { ...attacker, pendingCopy: { stages, by } };
    else defender = { ...defender, pendingCopy: { stages, by } };
  }
  return { ...outcome, attacker, defender };
}

/** "The attacker Garchomp's Mirror Herb copies the target's +1 Attack before this move (the target moves first: 100 Speed against 142)." */
function copyLine(copy: Copy, when: CopyTiming, reason: string, names: { attacker: string; defender: string }): string {
  const holder = copy.who === "attacker" ? `The attacker ${names.attacker}` : `The target ${names.defender}`;
  const stages = (Object.entries(copy.stages) as [CombatStat, number][]).map(([stat, amount]) => `+${amount} ${STAGE_NAMES[stat]}`);
  const timing = when === "before" ? ` before this move (the target moves first${reason ? `: ${reason}` : ""})`
    : when === "after" ? ` after this move (the attacker moves first${reason ? `: ${reason}` : ""})`
      : ` after the turn's first move, before or after this one${reason ? ` (${reason})` : ""}`;
  return `${holder}'s ${listNames(copy.by)} copies the ${copy.who === "attacker" ? "target" : "attacker"}'s ${listNames(stages)}${timing}.`;
}

/** One outcome of the Starf Berries eaten before the move: both builds with the stat each raised, and its chance. */
type StarfOutcome = { attacker: BattleBuild; defender: BattleBuild; chance: number; rises: { who: "attacker" | "target"; stat: CombatStat; amount: number }[] };

/** Every outcome of the sides' pending Starf rises (settleItems `starf`): each stat on a side equally likely, the sides independent. */
function starfOutcomes(attacker: BattleBuild, defender: BattleBuild, ...pending: [SettledItems["starf"], SettledItems["starf"]]): StarfOutcome[] {
  let outcomes: StarfOutcome[] = [{ attacker, defender, chance: 1, rises: [] }];
  pending.forEach((starf, index) => {
    if (!starf) return;
    const key = index === 0 ? "attacker" : "defender";
    outcomes = outcomes.flatMap((outcome) => starf.stats.map((stat) => {
      const build = outcome[key];
      return {
        ...outcome, [key]: { ...build, boosts: { ...build.boosts, [stat]: clampStage((build.boosts[stat] ?? 0) + starf.amount) } },
        chance: outcome.chance / starf.stats.length, rises: [...outcome.rises, { who: index === 0 ? "attacker" : "target", stat, amount: starf.amount }],
      };
    }));
  });
  return outcomes;
}

type StarfRun = { outcome: StarfOutcome; computed: MoveDamageResult };
/** What a Starf outcome's row says about the damage, to compare outcomes by. */
const starfDamageKey = ({ computed: row }: StarfRun) => JSON.stringify([row.kind, row.reason, row.min, row.max, row.rolls, row.hits, row.hitChances, row.ohkoChance,
  row.alternate, row.survival, row.leavesOneHP, row.attackerFaintsOnHit, row.effectivePower, row.effectiveType, row.effectiveCategory]);
const sameStarfDamage = (runs: StarfRun[]) => runs.every((run) => starfDamageKey(run) === starfDamageKey(runs[0]));

/**
 * One row over the Starf outcomes, and the facts that follow the line saying the berry was eaten. When every
 * outcome deals the same, it is the first outcome's. Otherwise the outcomes are grouped by their damage: the most
 * likely group's row is the usual case, a single-hit row with one other group gets it as its alternate (the KO
 * chance weighs both), and any other row states each other group's range as a fact, its KO chance weighing every
 * group when each has one. A group whose row is not calculated (a turn order it needs, a move that fails) gives
 * the row.
 */
function mergeStarfOutcomes(runs: StarfRun[]): { row: MoveDamageResult; facts: string[] } {
  if (sameStarfDamage(runs)) return { row: runs[0].computed, facts: [] };
  const groups: { runs: StarfRun[]; chance: number }[] = [];
  for (const run of runs) {
    const group = groups.find((entry) => starfDamageKey(entry.runs[0]) === starfDamageKey(run));
    if (group) { group.runs.push(run); group.chance += run.outcome.chance; } else groups.push({ runs: [run], chance: run.outcome.chance });
  }
  const failed = groups.find((group) => group.runs[0].computed.kind !== "calculated");
  if (failed) return { row: failed.runs[0].computed, facts: [] };
  const usual = groups.reduce((best, group) => group.chance > best.chance ? group : best);
  const others = groups.filter((group) => group !== usual);
  const base = usual.runs[0].computed;
  const sign = (amount: number) => `${amount > 0 ? "+" : ""}${amount}`;
  const rise = ({ who, stat, amount }: StarfOutcome["rises"][number]) => `the ${who}'s ${sign(amount)} ${STAGE_NAMES[stat]}`;
  // "the target's +2 Attack, Sp. Atk or Speed" for one side's Starf Berry; each outcome in full for both sides'.
  const label = ({ runs: group }: (typeof groups)[number]) => {
    const [first] = group[0].outcome.rises;
    return group.every(({ outcome: { rises } }) => rises.length === 1 && rises[0].who === first.who && rises[0].amount === first.amount)
      ? `the ${first.who}'s ${sign(first.amount)} ${orList(group.map(({ outcome }) => STAGE_NAMES[outcome.rises[0].stat]))}`
      : orList(group.map((run) => run.outcome.rises.map(rise).join(" and ")));
  };
  // The groups' float chances sum to 1 within rounding, so the weighed chance is kept at 1 or below.
  const koChance = groups.every((group) => group.runs[0].computed.ohkoChance !== null)
    ? Math.min(1, groups.reduce((total, group) => total + group.chance * group.runs[0].computed.ohkoChance!, 0)) : null;
  const other = others[0].runs[0].computed;
  // Focus Sash or Sturdy keeps the target in on the outcomes whose rolls reach its HP (survivalEffect).
  const survival = groups.map((group) => group.runs[0].computed.survival).find(Boolean);
  const kept = survival ? { survival } : {};
  const single = others.length === 1 && !base.alternate && !other.alternate && base.hits === 1 && other.hits === 1
    && Array.isArray(base.rolls) && typeof base.rolls[0] === "number" && Array.isArray(other.rolls) && typeof other.rolls[0] === "number";
  if (single && other.min !== null && other.max !== null && other.minPercent !== null && other.maxPercent !== null) {
    const [min, max] = [other.min, other.max];
    return {
      row: {
        ...base, ...kept, ohkoChance: koChance,
        alternate: {
          chance: others[0].chance, label: `${label(others[0])} (Starf Berry)`, usualLabel: label(usual), min, max,
          minPercent: other.minPercent, maxPercent: other.maxPercent, rolls: [...(other.rolls as number[])],
        },
        description: base.description.replace(/\.( Applied: .*)?$/, `, or ${min}–${max} HP (${other.minPercent.toFixed(1)}–${other.maxPercent.toFixed(1)}%) with ${label(others[0])} (${chanceText(others[0].chance)} chance).$1`),
      },
      facts: [`Starf Berry: ${label(others[0])} (${chanceText(others[0].chance)} chance) gives ${min}–${max} HP (${other.minPercent.toFixed(1)}–${other.maxPercent.toFixed(1)}%). The KO chance includes both cases.`],
    };
  }
  return {
    row: { ...base, ...kept, ohkoChance: koChance },
    facts: [
      `Starf Berry: these rolls are for ${label(usual)} (${chanceText(usual.chance)} chance).`,
      ...others.map((group) => {
        const row = group.runs[0].computed;
        return `Starf Berry: ${label(group)} (${chanceText(group.chance)} chance) gives ${row.min}–${row.max} HP (${row.minPercent!.toFixed(1)}–${row.maxPercent!.toFixed(1)}%).`;
      }),
      ...(koChance !== null ? ["The KO chance includes every Starf Berry outcome."] : []),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The doubles turn (doubles-turn.ts): one pair's calculation within a turn, the order keys, and the start of the turn.
// ---------------------------------------------------------------------------------------------------------------

/**
 * One damaging hit of a doubles turn from `attacker` into `defender` (SPEC §4.9): calculateMove with the Friend Guard
 * suppressor as calculateMatchup applies it, on builds whose entry rises are already in their stages (settleDoublesStart's
 * folded builds), so the engine's own entry boosts are off.
 */
export function calculateTurnMove(move: ChampionsMove, attacker: BattleBuild, defender: BattleBuild, conditions: BattleConditions, context: MoveContext | undefined,
  runtime: BattleRuntime, trace: CalcTrace = {}): MoveDamageResult {
  const suppressor = conditions.defenderSide.friendGuard ? partnerAbilitySuppressor(attacker, defender, runtime) : null;
  const field = suppressor ? { ...conditions, defenderSide: { ...conditions.defenderSide, friendGuard: false } } : conditions;
  return calculateMove(move, attacker, defender, field, context, runtime, suppressor, trace, 0, true);
}

/** What a doubles turn reads of the move a Pokémon uses (resolveTurnMove). */
export type TurnMove =
  | {
    kind: "move";
    /** The move used (a Z-Move's or Max Move's own: its id, name, type, category and target). */
    effective: ChampionsMove;
    /** A Z-Move or Max Move. */
    transformed: boolean; isZ: boolean; isMax: boolean;
    /** It makes contact with this user (its flag, after Long Reach, Protective Pads and a Punching Glove on a punch: sim/battle.ts checkMoveMakesContact). */
    contact: boolean;
    /** The engine move's flags (sound, wind, punch...). */
    flags: Record<string, number | undefined>;
    /** It drains (heals by the damage it deals), and it has secondaries (Sheer Force removes them). */
    drain: boolean; secondaries: boolean;
    /** Its user takes recoil from the damage it deals (the engine move's recoil). */
    recoil: boolean;
  }
  | { kind: "unsupported" | "needs-context"; reason: string };

/** The move `build` uses for `move` with `context` (resolve-move.ts resolveBattleMove: Z-Move and Max Move conversion). */
export function resolveTurnMove(move: ChampionsMove, build: BattleBuild, conditions: BattleConditions, context: MoveContext | undefined, runtime: BattleRuntime): TurnMove {
  let resolved: ReturnType<typeof resolveBattleMove>;
  try {
    resolved = resolveBattleMove(move, build, makePokemon(build, runtime), context, runtime, { isCrit: conditions.critical });
  } catch (error) {
    return { kind: "unsupported", reason: `This matchup could not be calculated: ${error instanceof Error ? error.message : "Unknown engine error."}` };
  }
  if (resolved.kind) return { kind: resolved.kind, reason: resolved.reason };
  const flags = (resolved.move.flags ?? {}) as Record<string, number | undefined>;
  const item = conditions.magicRoom || klutzActive(build, build) ? "" : build.itemId;
  const contact = !!flags.contact && build.abilityId !== "longreach" && item !== "protectivepads" && !(item === "punchingglove" && !!flags.punch);
  return {
    kind: "move", effective: resolved.effective, transformed: resolved.transformed, isZ: !!resolved.move.isZ, isMax: !!resolved.move.isMax, contact, flags,
    drain: !!(resolved.move as Move & { drain?: unknown }).drain, secondaries: !!resolved.move.secondaries,
    recoil: !!(resolved.move as Move & { recoil?: unknown }).recoil,
  };
}

/**
 * A damaging move into a Protecting Pokémon (protectOutcome): "blocked", or it gets through in full or at a quarter
 * (Z-Moves and Max Moves, Unseen Fist, Champions Piercing Drill, moves without the protect flag). Null when the move
 * cannot be resolved (its calculation then says why).
 */
export function turnProtectOutcome(move: ChampionsMove, attacker: BattleBuild, defender: BattleBuild, conditions: BattleConditions, context: MoveContext | undefined,
  runtime: BattleRuntime): ProtectOutcome["kind"] | null {
  let resolved: ReturnType<typeof resolveBattleMove>;
  try {
    resolved = resolveBattleMove(move, attacker, makePokemon(attacker, runtime), context, runtime, { isCrit: conditions.critical });
  } catch {
    return null;
  }
  if (resolved.kind) return null;
  return protectOutcome(resolved.effective, resolved.move, attacker, defender, conditions, runtime).kind;
}

/**
 * The priority `build` uses `move` with in a doubles turn (pinned Showdown sim/battle.ts getActionSpeed: the dex
 * priority of the move used, a Z-Move's or Max Move's own, then ModifyPriority, set again at every sort from
 * generation 8): for attacks usedPriority (Gale Wings at full HP, Triage on draining moves, Grassy Glide), the catalog
 * keeping a negative priority the engine drops; for status moves the catalog priority, Prankster +1
 * (data/abilities.ts prankster onModifyPriority) and Gale Wings +1 for a Flying move at full HP. Triage's status
 * moves all change HP (the turn does not estimate them). The build's currentHP is the HP at that sort.
 */
export function turnPriority(move: ChampionsMove, build: BattleBuild, conditions: BattleConditions, context: MoveContext | undefined, runtime: BattleRuntime): number | { reason: string } {
  const pokemon = makePokemon(build, runtime);
  if (move.category === "Status" && !context?.useZ) {
    let priority = move.priority;
    if (build.abilityId === "prankster") priority += 1;
    if (build.abilityId === "galewings" && move.type === "Flying" && pokemon.curHP() === pokemon.maxHP()) priority += 1;
    return priority;
  }
  let resolved: ReturnType<typeof resolveBattleMove>;
  try {
    resolved = resolveBattleMove(move, build, pokemon, context, runtime, { isCrit: conditions.critical });
  } catch (error) {
    return { reason: `This matchup could not be calculated: ${error instanceof Error ? error.message : "Unknown engine error."}` };
  }
  if (resolved.kind) return { reason: resolved.reason };
  const { priority } = usedPriority(resolved.effective, move, resolved, pokemon, build, build, conditions);
  return resolved.transformed || move.priority >= 0 ? priority : move.priority;
}

/**
 * A Pokémon's action Speed in a doubles turn (pinned Showdown sim/pokemon.ts getActionSpeed): the engine's final Speed
 * as calculateMove's turn order reads it (stages, Tailwind, paralysis, Choice Scarf (not while Dynamaxed), Iron Ball,
 * Unburden, the weather and terrain abilities, Slow Start, Quick Feet, a Protosynthesis or Quark Drive Speed; held
 * items off under Magic Room and for Klutz, as the engine's checkItem clears them; Utility Umbrella's sun and rain
 * abilities off), capped at 10000; under Trick Room 10000 minus it; then trunc(·, 13) (sim/dex.ts trunc: modulo 8192,
 * as the real formats keep it). Champions (data/mods/champions/scripts.ts:45-53 getActionSpeed) has no Trick Room
 * wrap: minus the Speed; and its Speed is not the engine's generation-0 999 cap (mechanics/util.js getFinalSpeed caps
 * at 999 for a generation number of 2 or less), only sim/pokemon.ts:637's 10000. `firstTurn`: generation 7's order
 * from the Speed before the item used at the turn's first Update (settleItems firstTurnSpeed).
 */
export function turnSpeed(build: BattleBuild, tailwind: boolean, conditions: BattleConditions, runtime: BattleRuntime, firstTurn = false): number {
  const champions = runtime.profile.id === "champions";
  const engine = Generations.get(runtime.profile.generation);
  // The Champions engine's stat rules are the modern ones (getModifiedStat, paralysis at 50%); generation 9 caps at 10000.
  const generation = champions ? Object.create(engine, { num: { value: 9 } }) as typeof engine : engine;
  const pokemon = makePokemon(build, runtime);
  if (umbrellaBlocksAbility(build, build, conditions)) pokemon.ability = "Run Away" as AbilityName;
  if (pokemon.item && (conditions.magicRoom || (klutzActive(build, build) && !ENGINE_KLUTZ_KEPT_ITEMS.has(build.itemId)))) pokemon.item = undefined;
  if (pokemon.isDynamaxed && pokemon.hasItem("Choice Scarf")) pokemon.item = undefined;
  const before = firstTurn ? build.firstTurnSpeed : undefined;
  if (before) {
    pokemon.boosts.spe = before.spe;
    if (pokemon.hasAbility("Unburden")) pokemon.abilityOn = before.unburden;
  }
  const field = makeField(conditions);
  const side = makeSide({ ...conditions.attackerSide, tailwind });
  let speed = getFinalSpeed(generation, pokemon, field, side as unknown as Result["field"]["attackerSide"]);
  if (champions) return conditions.trickRoom ? -speed : speed;
  if (conditions.trickRoom) speed = 10000 - speed;
  return (speed >>> 0) % 8192;
}

/** A build's HP as the engine holds it (Dynamax HP while Dynamaxed): its current HP, maximum and base maximum. */
export function turnHP(build: BattleBuild, runtime: BattleRuntime): { hp: number; maxHP: number; baseMaxHP: number } {
  const pokemon = makePokemon(build, runtime);
  return { hp: pokemon.curHP(), maxHP: pokemon.maxHP(), baseMaxHP: pokemon.maxHP(true) };
}

/** One present slot's start of the doubles turn (settleDoublesStart). */
export type DoublesStartSlot = {
  /** Settled as calculateMatchup settles a side (abilities and forms, Download against both foes, items); the engine still adds its entry rises. */
  build: BattleBuild;
  /** `build` with its entry rises in the stages and a terrain Seed used up (entryStagesOf), for the turn's calculations (calculateTurnMove). */
  folded: BattleBuild;
  items: SettledItems;
  /** The settle lines, as start facts. */
  lines: string[];
  /** The other Pokémon its settle read as "the other battler" (SPEC §4.2 step 2). */
  representative: DoublesSlotId;
};
export type DoublesSettle = { slots: Record<DoublesSlotId, DoublesStartSlot | null>; reason: string | null };

const UNNERVE_ABILITIES = new Set(["unnerve", "asoneglastrier", "asonespectrier"]);
const WEATHER_NEGATORS = new Set(["cloudnine", "airlock"]);

/**
 * The start of a doubles turn (SPEC §4.2). The 1v1 settle reads "the other battler" for Unnerve and As One, Cloud Nine
 * and Air Lock (Forecast, Ice Face, Protosynthesis), the paradox field setters and the Trace source; each slot takes as
 * that other the one Pokémon that supplies all it needs, or the foe across when it needs nothing. Two different
 * Pokémon acting on it as the turn starts, Trace with two different copyable foe abilities unchosen, Trace copying
 * Intimidate, Download against a foe's entry boost to its defenses, a Starf Berry, a confused Pokémon with a move, and a
 * copy of a Berry's rise give `reason`. Download reads both foes (pinned Showdown data/abilities.ts download: the sum
 * of their Defense and Sp. Def at the lead, as settleEntry's atLead reads one foe) and is always settled into the
 * stages, since the engine would read only the target.
 */
export function settleDoublesStart(input: DoublesTurnInput): DoublesSettle {
  const { runtime } = input;
  const field: BattleConditions = { ...input.field, gameType: "Doubles" };
  const present = DOUBLES_SLOTS.filter((slot) => input.pokemon[slot]);
  const shown = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, input.pokemon[slot]?.build ?? null])) as Record<DoublesSlotId, BattleBuild | null>;
  const names = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, shown[slot] ? runtime.speciesById.get(shown[slot]!.speciesId)?.name ?? shown[slot]!.speciesId : ""])) as Record<DoublesSlotId, string>;
  const labels = doublesNames(input.pokemon, runtime);
  const tailwind = (slot: DoublesSlotId) => (slotSide(slot) === "own" ? field.attackerSide : field.defenderSide).tailwind;
  const empty = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, null])) as Record<DoublesSlotId, DoublesStartSlot | null>;
  let reason: string | null = null;
  const fail = (text: string) => { reason ??= text; };
  for (const slot of present) {
    if (shown[slot]!.abilityId === "neutralizinggas") fail("Neutralizing Gas is not modelled in 2v2.");
    if (shown[slot]!.abilityId === "imposter") fail("Imposter is not modelled in 2v2.");
  }
  if (reason) return { slots: empty, reason };
  const others = (slot: DoublesSlotId) => present.filter((other) => other !== slot);
  const foes = (slot: DoublesSlotId) => present.filter((other) => slotSide(other) !== slotSide(slot));
  // The foe across: the one on the same screen side (SHOWDOWN_POSITION mirrors the far side), else any other.
  const across = (slot: DoublesSlotId): DoublesSlotId => {
    const facing = (slot.endsWith("left") ? foesOf(slot)[0] : foesOf(slot)[1]);
    return shown[facing] ? facing : foes(slot)[0] ?? others(slot)[0] ?? slot;
  };
  /** The one Pokémon that meets every need (each a list of Pokémon that would do), or the reason two act. */
  const pick = (slot: DoublesSlotId, needs: DoublesSlotId[][]): DoublesSlotId | null => {
    if (!needs.length) return across(slot);
    const fits = others(slot).filter((other) => needs.every((need) => need.includes(other)));
    if (fits.length) return fits.includes(across(slot)) ? across(slot) : fits[0];
    const first = needs[0][0];
    const second = needs.find((need) => !need.includes(first))![0];
    fail(`${labels[first]} and ${labels[second]} both act on ${labels[slot]} as the turn starts.`);
    return null;
  };
  // Phase 1: abilities and forms (Trace, Forecast and Ice Face read the other battler).
  const needsA = Object.fromEntries(present.map((slot) => {
    const build = shown[slot]!;
    const needs: DoublesSlotId[][] = [];
    const negators = others(slot).filter((other) => WEATHER_NEGATORS.has(shown[other]!.abilityId));
    const readsWeather = (build.abilityId === "forecast" && build.speciesId.startsWith("castform"))
      || (build.abilityId === "iceface" && build.speciesId === "eiscuenoice" && ["Snow", "Hail"].includes(field.weather));
    if (readsWeather && negators.length) needs.push(negators);
    if (build.abilityId === "trace" && !(build.itemId === "abilityshield" && !field.magicRoom)) {
      const copyable = foes(slot).filter((foe) => !NO_TRACE_ABILITIES.has(shown[foe]!.abilityId));
      const copied = build.tracedAbility ?? (new Set(copyable.map((foe) => shown[foe]!.abilityId)).size > 1 ? null : copyable.length ? shown[copyable[0]]!.abilityId : "");
      if (copied === null) fail("Trace copies a random foe's ability.");
      else if (copied === "intimidate") fail("Trace copying Intimidate is not modelled in 2v2.");
      else if (copied && !build.tracedAbility) needs.push(copyable);
    }
    return [slot, needs];
  })) as Record<DoublesSlotId, DoublesSlotId[][]>;
  if (reason) return { slots: empty, reason };
  const settleA = (slot: DoublesSlotId, rep: DoublesSlotId) => settleAbilities(shown[slot]!, shown[rep]!, field, runtime, SLOT_POSITION[slot], tailwind(rep));
  const repA = Object.fromEntries(present.map((slot) => [slot, pick(slot, needsA[slot])])) as Record<DoublesSlotId, DoublesSlotId | null>;
  if (reason) return { slots: empty, reason };
  const abilities = Object.fromEntries(present.map((slot) => [slot, settleA(slot, repA[slot]!)])) as Record<DoublesSlotId, ReturnType<typeof settleAbilities>>;
  for (const slot of present) if (abilities[slot].withheld) fail(abilities[slot].withheld!);
  if (reason) return { slots: empty, reason };
  // Phase 2: items (Unnerve and As One, Cloud Nine and Air Lock, the paradox field setters read the other battler).
  const settledA = (slot: DoublesSlotId) => abilities[slot].build;
  const reps = {} as Record<DoublesSlotId, DoublesSlotId>;
  for (const slot of present) {
    const build = settledA(slot);
    const needs = [...needsA[slot]];
    const unnervers = foes(slot).filter((foe) => UNNERVE_ABILITIES.has(settledA(foe).abilityId));
    if (build.itemId.endsWith("berry") && unnervers.length) needs.push(unnervers);
    const paradox = PARADOX_FIELDS[build.abilityId];
    if (paradox === "sun" && field.weather === "Sun") {
      const negators = others(slot).filter((other) => WEATHER_NEGATORS.has(settledA(other).abilityId));
      if (negators.length) needs.push(negators);
    }
    const fieldOn = paradox === "sun" ? field.weather === "Sun" : paradox === "terrain" && field.terrain === "Electric";
    const setters = paradox && fieldOn ? others(slot).filter((other) => PARADOX_FIELD_SETTERS[paradox].includes(settledA(other).abilityId)) : [];
    if (setters.length) needs.push(setters);
    const rep = pick(slot, needs);
    if (!rep) return { slots: empty, reason };
    reps[slot] = rep;
    if (rep !== repA[slot]) abilities[slot] = settleA(slot, rep);
  }
  // Download against both foes, at the lead (settleEntry's atLead: their lead forms, no Defense or Sp. Def stage, no room).
  const entered = Object.fromEntries(present.map((slot) => [slot, settledA(slot)])) as Record<DoublesSlotId, BattleBuild>;
  const lines = Object.fromEntries(present.map((slot) => [slot, [...abilities[slot].lines]])) as Record<DoublesSlotId, string[]>;
  for (const slot of present) {
    const holder = entered[slot];
    if (holder.abilityId !== "download") continue;
    const battle: IntimidateBattle = { magicRoom: field.magicRoom, wonderRoom: field.wonderRoom, terrain: field.terrain, gameType: "Doubles" };
    let def = 0, spd = 0;
    for (const foe of foes(slot)) {
      const build = abilities[foe].build;
      const boosted = entryBoosts(build, holder, null, tailwind(foe), { ...battle, tailwind: { source: tailwind(foe), target: tailwind(slot) } }, runtime)
        .some((entry) => entry.stat === "def" || entry.stat === "spd");
      if (build.transformedFrom || boosted) { fail(`Download is not modelled with ${labels[foe]}'s entry boost.`); continue; }
      const forms = unknownLeadForms(build, runtime)?.speciesIds ?? [atLead(build, battle, runtime).foe.speciesId];
      const reads = forms.map((speciesId) => getBuildStats({ ...build, speciesId }, runtime));
      if (reads.some((stats) => !stats || stats.def !== reads[0]!.def || stats.spd !== reads[0]!.spd)) { fail(`Download is not modelled with ${labels[foe]}'s entry boost.`); continue; }
      def += reads[0]!.def; spd += reads[0]!.spd;
    }
    if (reason) return { slots: empty, reason };
    // Pinned Showdown download onStart: Sp. Atk when the foes' Defense total is at least their Sp. Def total, else Attack.
    const stat: CombatStat | null = def && def >= spd ? "spa" : spd ? "atk" : null;
    if (!stat) continue;
    entered[slot] = { ...holder, boosts: { ...holder.boosts, [stat]: clampStage((holder.boosts[stat] ?? 0) + 1) }, settledDownload: stat };
    lines[slot].push(`${cap(SLOT_POSITION[slot])} ${names[slot]}'s Download raised its ${STAGE_NAMES[stat]}.`);
  }
  const slots = { ...empty };
  for (const slot of present) {
    const items = settleItems(entered[slot], entered[reps[slot]] ?? entered[slot], field, runtime, SLOT_POSITION[slot], names[slot]);
    if (items.starf) fail(STARF_REASON);
    if (items.confused && input.pokemon[slot]!.action.moveId !== null) fail("Confusion is not modelled in 2v2.");
    if (items.raised) {
      for (const foe of foes(slot)) {
        const copier = entered[foe];
        if (copier.abilityId === "opportunist") fail("Opportunist copying a stat rise is not modelled in 2v2.");
        if (copier.itemId === "mirrorherb" && !field.magicRoom && !klutzActive(copier, copier)) fail("Mirror Herb copying a stat rise is not modelled in 2v2.");
      }
    }
    const build = items.build;
    const itemOn = !field.magicRoom && !klutzActive(build, build);
    const entry = entryStagesOf(build, build.abilityId, itemOn, field.terrain, tailwind(slot), runtime);
    const boosts = Object.fromEntries(COMBAT_STATS.map((stat) => [stat, clampStage((build.boosts[stat] ?? 0) + (entry.stages[stat] ?? 0))])) as BattleBuild["boosts"];
    const folded: BattleBuild = { ...build, boosts, ...(entry.seed ? { itemId: "" } : {}) };
    slots[slot] = { build, folded, items, lines: [...lines[slot], ...items.lines], representative: reps[slot] };
  }
  return { slots, reason };
}
