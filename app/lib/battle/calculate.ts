import { calculate, Field, Generations, Move as EngineMove, Pokemon, toID } from "@smogon/calc";
import type { Move, Result, StatsTable } from "@smogon/calc";
import type { AbilityName, Generation, ID, MoveName, TypeName } from "@smogon/calc/dist/data/interface";
import { calculateBPModsChampions } from "@smogon/calc/dist/mechanics/champions";
import { calculateBPModsSMSSSV } from "@smogon/calc/dist/mechanics/gen789";
import { checkMultihitBoost, checkSeedBoost, getFinalSpeed, isGrounded } from "@smogon/calc/dist/mechanics/util";
import { getBerryResistType, getNaturalGift } from "@smogon/calc/dist/items";
import { getMaxMoveName, getZMoveName } from "@smogon/calc/dist/move";
import { championsRuntime, type BattleRuntime } from "./runtime";
import "./engine-corrections.cjs";
import { abilityActivationLabel, defaultAbilityActive, getBuildStats, validateBuild, validateConditions, withoutSinglesPartners } from "./model";
import { getBuildGender, isMaxActive, specialTeraForm } from "./mechanics";
import { resolveBattleMove, withResolvedPriority } from "./resolve-move";
import { EVENT_DOUBLING_MOVES, eventDoublingAssumption, isEventDoubled } from "./event-moves";
import { withDynamaxHealth } from "./health";
import { mimicryState } from "./mimicry";
import { FIXED_DAMAGE_MOVES, MOVES_FIRST_POWER_MOVES } from "./turn-order";
import { imposterTransforms, movesSpeciesId, NO_TRANSFORM_ABILITIES, TRANSFORM_LOCKED_ABILITIES, tracedAbility } from "./imposter";
import { applyIntimidate, entryBoosts, intimidatedKey, type IntimidateBattle } from "./intimidate";
import { hitCountRule, type HitCountBattle } from "./hit-count";
import { beatUpPlan, countPower, supremeOverlordMultiplier } from "./count-moves";
import type {
  BattleBuild,
  BattleConditions,
  BuildIssue,
  ChampionsMove,
  ChampionsSpecies,
  MoveContext,
  MoveDamageResult,
  SideConditions,
} from "./types";

export type MatchupResult = {
  issues: { attacker: BuildIssue[]; defender: BuildIssue[]; field: BuildIssue[] };
  results: MoveDamageResult[];
};

/** These need information that a two-build snapshot does not contain. */
const HISTORY_MOVES: Record<string, string> = {
  pursuit: "Needs the defender's switching state.",
  retaliate: "Needs to know whether an ally fainted on the previous turn.",
  furycutter: "Needs the consecutive-use count.",
  rollout: "Needs the consecutive-use count and Defense Curl state.",
  iceball: "Needs the consecutive-use count and Defense Curl state.",
  echoedvoice: "Needs the consecutive-turn use count.",
  spitup: "Needs the number of Stockpile uses.",
  trumpcard: "Needs the move's remaining PP.",
  present: "Its random damage/healing outcomes are not modeled by this engine adapter.",
  magnitude: "Needs the randomly selected Magnitude power.",
  counter: "Needs the damage and category of the earlier attack.",
  mirrorcoat: "Needs the damage and category of the earlier attack.",
  metalburst: "Needs the damage of the earlier attack.",
  comeuppance: "Needs the damage of the earlier attack.",
  bide: "Needs the damage stored over earlier turns.",
  fling: "Fling's item eligibility and consumption need additional verification for Champions.",
};

const CONTEXT_ABILITIES: Record<string, string> = {
  rivalry: "Rivalry needs both Pokémon's genders; specify both instead of assuming the engine's default male gender.",
};
const EXPLOSIVE_MOVES = new Set(["explosion", "selfdestruct", "mistyexplosion", "mindblown"]);
// Target items pinned Showdown uses only after the whole move (Kee and Maranga Berry
// onAfterMoveSecondary, White Herb onAnyAfterMove); the engine's multi-hit loop uses them between hits.
const AFTER_MOVE_ITEMS = new Set(["Kee Berry", "Maranga Berry", "White Herb"]);
// Beat Up hits are separate calculations, so effects that change damage after the first hit are
// withheld (pinned Showdown). Kee Berry and Anger Shell act only after the whole move, and Tera
// Shell resists every hit, so separate calculations already match.
// A Defense rise changes nothing when a critical hit ignores it (the stage stays positive) or
// the attacker's Unaware ignores every stage.
const ignoresDefenseRise = (attacker: Pokemon, defender: Pokemon, critical: boolean) => attacker.hasAbility("Unaware") || (critical && defender.boosts.def >= 0);
const BEAT_UP_BLOCKERS: { name: string; applies: (result: Result, conditions: BattleConditions) => boolean; effect: string }[] = [
  { name: "Multiscale", applies: ({ defender }) => defender.hasAbility("Multiscale") && defender.curHP() === defender.maxHP(), effect: "at full HP it halves only the first hit" },
  { name: "Shadow Shield", applies: ({ defender }) => defender.hasAbility("Shadow Shield") && defender.curHP() === defender.maxHP(), effect: "at full HP it halves only the first hit" },
  { name: "Stamina", applies: ({ attacker, defender }, conditions) => defender.hasAbility("Stamina") && !ignoresDefenseRise(attacker, defender, conditions.critical), effect: "it raises Defense after every hit" },
  { name: "Weak Armor", applies: ({ attacker, defender }) => defender.hasAbility("Weak Armor") && !attacker.hasAbility("Unaware"), effect: "it lowers Defense after every physical hit" },
  { name: "Colbur Berry", applies: ({ rawDesc }) => rawDesc.defenderItem === "Colbur Berry", effect: "it halves only the first hit" },
  {
    name: "Seed Sower with a Grassy Seed",
    applies: ({ attacker, defender }, conditions) => defender.hasAbility("Seed Sower") && defender.hasItem("Grassy Seed") && conditions.terrain !== "Grassy"
      && !ignoresDefenseRise(attacker, defender, conditions.critical),
    effect: "the first hit sets Grassy Terrain, and the Seed then raises Defense for the later hits",
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
  suckerpunch: "Assumes Sucker Punch succeeds against an attacking move.",
  thunderclap: "Assumes Thunderclap succeeds against an attacking move.",
  upperhand: "Assumes Upper Hand succeeds: the target is about to use a priority attacking move this turn.",
  shelltrap: "Assumes Shell Trap succeeds: an opposing Pokémon's physical move hits the user earlier this turn.",
  focuspunch: "Assumes Focus Punch is not interrupted.",
  firstimpression: "Assumes this is the attacker's first turn after entering battle.",
  fakeout: "Assumes this is the attacker's first turn after entering battle.",
  lastresort: "Assumes the requirements for using Last Resort have been met.",
  belch: "Assumes the attacker has already consumed a Berry.",
  synchronoise: "Assumes the target meets Synchronoise's type requirement.",
  futuresight: "Uses the selected defender and conditions at the time damage lands.",
  doomdesire: "Uses the selected defender and conditions at the time damage lands.",
  meteorbeam: "Includes the move's pre-hit Special Attack increase; enter stages from before using it.",
  electroshot: "Includes the move's pre-hit Special Attack increase; enter stages from before using it.",
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
    return { types: [own.types[0] as TypeName], line: `Mimicry: without terrain, the transformed ${who} takes its own original ${own.types[0]} type.` };
  }
  const state = mimicryState(build, other, conditions);
  if (!state) return { types: undefined, line: null };
  if (!state.type) {
    return { types: undefined, line: `Neutralizing Gas suppresses Mimicry, so the ${who} keeps its own types. This assumes the terrain started, or it entered, while Neutralizing Gas was on the field.` };
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
      ? `Terastallization changes ${who} ${name} into ${species.name}, whose ${abilityName(abilityId)} ${gassed ? `is suppressed by Neutralizing Gas, so its ${embody} does not rise` : `raises its ${embody} by 1 stage on entry`}.`
      : form === "terapagosterastal"
        ? `Tera Shift changes ${who} ${name} into Terapagos-Terastal when it enters${gassed ? "; Neutralizing Gas suppresses its Tera Shell" : " (with Tera Shell)"}.`
        : `Terastallization changes ${who} ${name} into Terapagos-Stellar${gassed ? "; Neutralizing Gas suppresses Teraform Zero, so the weather and terrain stay" : `, whose Teraform Zero clears the weather and terrain when it Terastallizes${conditions.weather || conditions.terrain ? "; set them only if they were restored afterwards" : ""}`}.`);
  }
  // Shields Down and Schooling set the form from HP on entry and at the end of each turn (pinned
  // Showdown onStart and onResidual; neither can be suppressed). Minior is Meteor above half HP;
  // Wishiwashi (level 20+) is School above a quarter. The panel's switch keeps the selected form when
  // the HP crossed that line earlier this turn.
  const hpForm = entryForm(settled, runtime);
  if (hpForm) {
    const formName = runtime.speciesById.get(hpForm.speciesId)?.name ?? hpForm.speciesId;
    if (hpForm.kept) {
      lines.push(`${hpForm.ability}: ${who} ${name} stays ${name} until the end of the turn, although it would be ${formName} ${hpForm.why}.`);
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
    lines.push(`Ice Face: this assumes ${who} Eiscue-Noice's face broke while the ${weather} was up. Entering in ${weather}, or ${weather} starting, restores it: select Eiscue for that.`);
  }
  // Trace copies a foe's ability on entry (pinned Showdown trace onStart); the engine has none.
  if (build.abilityId === "trace") {
    const traced = tracedAbility(build, other, conditions.magicRoom);
    if (traced.abilityId) {
      settled = { ...settled, abilityId: traced.abilityId, abilityActive: copiedAbilityActive(traced.abilityId) };
      lines.push(`Trace: ${who} ${name} copied ${abilityName(traced.abilityId)}${traced.chosen ? " (chosen in Build settings)" : ` from ${otherName}`}.`);
    } else if (traced.blockedBy) {
      lines.push(`Trace: ${who} ${name} copies nothing (${traced.blockedBy === "Ability Shield" ? "its Ability Shield blocks Trace" : "Neutralizing Gas stops it"}).`);
    } else {
      lines.push(`Trace: ${who} ${name} copies nothing here (it cannot copy ${abilityName(other.abilityId)}). Choose what it copied in Build settings if it copied another Pokémon's ability.`);
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
      if (build.native.level !== other.native.level) return { build, lines, withheld: "Imposter copies the target's stats at its level; set both Pokémon to the same level." };
      transformed = {
        ...other,
        native: {
          ...other.native,
          evs: { ...other.native.evs, hp: build.native.evs.hp }, ivs: { ...other.native.ivs, hp: build.native.ivs.hp },
          ...(other.native.innateIVs || build.native.innateIVs ? { innateIVs: { ...(other.native.innateIVs ?? other.native.ivs), hp: (build.native.innateIVs ?? build.native.ivs).hp } } : {}),
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
      itemId: build.itemId, status: build.status, currentHP: build.currentHP, mechanic: undefined,
      configuration: { ...other.configuration, gender: getBuildGender(build, runtime) },
      faintedAllies: build.faintedAllies, tracedAbility: undefined, settledDownload: undefined,
      transformedFrom: { speciesId: build.speciesId, baseHP: own.baseStats.hp },
    };
    const entryList = targetEntry.map((entry) => `${entry.cause} ${entry.amount > 0 ? "+" : ""}${entry.amount} ${STAGE_NAMES[entry.stat]}`).join(" and ");
    const formName = runtime.speciesById.get(entryForm)?.name ?? entryForm;
    lines.push(`Imposter: ${who} ${name} transformed into ${formName}, copying its types, stats except HP, ${abilityName(copiedAbility)}${inert ? " (which does nothing on a transformed Pokémon)" : ""}, stat stages${entryList ? ` (with its ${entryList})` : ""} and moves; it keeps its own HP, item and status. ${cap(name)}'s own stat stages are added as changes after it transformed. This assumes both entered together with ${otherName} faster (its entry abilities come before Imposter; Seeds, Forecast, Flower Gift, Shields Down and Schooling come after) and nothing (such as a Substitute or Illusion) stopped the transformation. If ${name} switched in later, it copied ${otherName} as it was then: edit its stages.`);
  }
  if (build.abilityId === "forecast" && build.speciesId.startsWith("castform") && runtime.speciesById.has("castform")) {
    const airLock = [build, other].some((entry) => ["cloudnine", "airlock"].includes(entry.abilityId));
    const blocked = forecastBlocked(build, other, conditions);
    const form = !airLock && !blocked ? CASTFORM_FORMS[conditions.weather] ?? "castform" : "castform";
    if (form !== build.speciesId) {
      const formName = runtime.speciesById.get(form)?.name ?? form;
      lines.push(`Forecast: ${blocked ? `${blocked} keeps it from changing form` : airLock ? "Cloud Nine or Air Lock removes the weather's effect" : conditions.weather ? `in ${conditions.weather}` : "without sun, rain or snow"}, so ${who} ${name} is ${formName} (${runtime.speciesById.get(form)?.types.join("/")} type).`);
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
    lines.push(`${cap(who)} ${ownName(holder)}'s Intimidate (copied by ${copiedBy}) acts when it enters, and this calculation applies it, so do not change the stages for it by hand.`,
      // The engine adds entry boosts at calculation time; nothing is stored here.
      ...result.lines.slice(1).filter((line) => !/which the calculator adds when it calculates|^This assumes Tailwind started/.test(line)).map(named));
  }
  // After Intimidate, whose own stage bookkeeping adds the engine's Download boost.
  for (const [side, foeSide] of [["attacker", "defender"], ["defender", "attacker"]] as const) {
    const holder = builds[side], foe = builds[foeSide];
    const who = side === "attacker" ? "the attacker" : "the target";
    if (holder.abilityId === "download" && foe.transformedFrom && !gassedAbility(holder, foe, conditions)) {
      const zero = Object.fromEntries(COMBAT_STATS.map((stat) => [stat, 0])) as BattleBuild["boosts"];
      const download = entryBoosts(holder, { ...shown[foeSide], boosts: zero }, [], tailwind[side], intimidateBattle(conditions, tailwind[side], tailwind[foeSide]), runtime)
        .find((entry) => entry.id === "download");
      if (download) {
        builds[side] = { ...holder, boosts: { ...holder.boosts, [download.stat]: clampStage((holder.boosts[download.stat] ?? 0) + 1) }, settledDownload: download.stat };
        lines.push(`${cap(who)} ${ownName(holder)}'s Download read ${ownName(foe)}'s Defense and Sp. Def before it transformed, raising its ${STAGE_NAMES[download.stat]}.`);
      }
    }
  }
  return { ...builds, lines };
}

/**
 * Held-item states the battle has already settled before this attack, from the Pokémon's settled
 * abilities: a matching status berry (Lum, Rawst, Cheri, Pecha, Aspear, Chesto) cures its holder at
 * once and is used up, unless Magic Room, an active Klutz or the other battler's Unnerve / As One
 * stops it; a terrain Seed on its terrain is used up on entry. Unburden then activates, and it stays
 * off while an item is still held.
 */
function settleItems(build: BattleBuild, other: BattleBuild, conditions: BattleConditions, runtime: BattleRuntime, who: string, name: string): { build: BattleBuild; lines: string[] } {
  const lines: string[] = [];
  const itemName = (id: string) => runtime.itemsById.get(id)?.name ?? id;
  let settled = build;
  const itemOn = !conditions.magicRoom && !klutzActive(build, other);
  // The holder's own Neutralizing Gas suppresses Unnerve, but not As One or an Ability Shield holder's.
  const unnerved = ["unnerve", "asoneglastrier", "asonespectrier"].includes(other.abilityId) && !gassedAbility(other, build, conditions);
  const abilityOn = !gassedAbility(build, other, conditions);
  const berry = STATUS_BERRIES[build.itemId];
  let usedUp = false;
  if (berry && build.status && berry.includes(build.status) && itemOn && !unnerved) {
    lines.push(`${cap(who)} ${name}'s ${itemName(build.itemId)} cures its ${STATUS_NAMES[build.status] ?? build.status} at once and is used up.`);
    settled = { ...settled, status: "", itemId: "" };
    usedUp = true;
  }
  const seedUsed = !!SEED_TERRAINS[build.itemId] && SEED_TERRAINS[build.itemId] === conditions.terrain && itemOn;
  if (seedUsed) lines.push(`${cap(who)} ${name}'s ${itemName(build.itemId)} is used up on ${conditions.terrain} Terrain, raising its ${["grassyseed", "electricseed"].includes(build.itemId) ? "Defense" : "Sp. Def"}${build.abilityId === "contrary" && abilityOn ? " (lowering it, with Contrary)" : ""}.`);
  if (build.abilityId === "unburden" && abilityOn) {
    if (usedUp || seedUsed) {
      if (!build.abilityActive) lines.push(`${cap(who)} ${name}'s Unburden activates once its ${itemName(build.itemId)} is used up, doubling its Speed.`);
      settled = { ...settled, abilityActive: true };
    } else if (build.abilityActive && build.itemId) {
      lines.push(`${cap(who)} ${name}'s Unburden stays inactive while it holds its ${itemName(build.itemId)}.`);
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
    // Magic Room set after it entered does not undo a Booster Energy used on entry (the panel's
    // activation choice); a Pokémon entering under the room keeps it unused.
    const usedBeforeRoom = conditions.magicRoom && !klutzActive(build, other) && build.abilityActive;
    const booster = !fieldOn && settled.itemId === "boosterenergy" && (itemOn || usedBeforeRoom);
    // At a shared lead the foe's Drought, Orichalcum Pulse, Electric Surge or Hadron Engine (priority 0)
    // activates it before the holder's Seed (priority -1) is used, so the Seed's rise is not counted.
    const foeSetsField = fieldOn && !gassedAbility(other, build, conditions)
      && (paradox === "sun" ? ["drought", "orichalcumpulse"] : ["electricsurge", "hadronengine"]).includes(other.abilityId);
    if (!fieldOn && !booster && settled.itemId === "boosterenergy" && !itemOn) {
      lines.push(conditions.magicRoom && !klutzActive(build, other)
        ? `${cap(who)} ${name}'s Booster Energy is not used: it entered while Magic Room was up. Tick its Booster Energy choice if it was used on entry, before the room was set.`
        : `${cap(who)} ${name}'s Klutz keeps its Booster Energy from activating.`);
    }
    if (fieldOn || booster) {
      const stat = paradoxStat(settled, other, conditions, runtime, foeSetsField);
      const afterSeed = foeSetsField && seedUsed ? paradoxStat(settled, other, conditions, runtime, false) : stat;
      settled = { ...settled, settledBoostedStat: stat, ...(booster ? { itemId: "" } : {}) };
      const abilityName = runtime.abilitiesById.get(build.abilityId)?.name;
      lines.push(`${cap(who)} ${name}'s ${abilityName} raises its ${STAGE_NAMES[stat]}, its highest stat${afterSeed !== stat ? " before its Seed" : ""}, ${booster ? `activated by its Booster Energy, which is used up${usedBeforeRoom ? " on entry, before Magic Room was set" : ""}` : paradox === "sun" ? "in the sun" : "on Electric Terrain"}. This assumes its stat stages have not changed since it activated.`);
      if (afterSeed !== stat) {
        lines.push(`This assumes both entered together, so the other Pokémon's ${runtime.abilitiesById.get(other.abilityId)?.name} set the ${paradox === "sun" ? "sun" : "terrain"} and ${abilityName} activated before ${who} ${name}'s ${itemName(build.itemId)} was used. If it entered after the ${paradox === "sun" ? "sun" : "terrain"} was up, the Seed came first and ${abilityName} raises its ${STAGE_NAMES[afterSeed]}.`);
      }
    }
  }
  return { build: settled, lines };
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

/** An intact Ice Face takes the first physical hit (pinned Showdown iceface onDamage), unless Mold
 * Breaker or an ignoreAbility move bypasses it; Ability Shield keeps it even then. */
const ICE_FACE_REASON = "Intact Ice Face takes the first physical hit. Select Eiscue-Noice for damage after the face breaks.";

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
  const swapped = { def: "spd", spd: "def" } as const;
  let best: (typeof COMBAT_STATS)[number] = "atk";
  let bestValue = 0;
  for (const stat of COMBAT_STATS) {
    const boost = stage(conditions.wonderRoom && (stat === "def" || stat === "spd") ? swapped[stat] : stat);
    const value = boost >= 0 ? Math.floor(stats[stat] * (2 + boost) / 2) : Math.floor(stats[stat] * 2 / (2 - boost));
    if (value > bestValue) { best = stat; bestValue = value; }
  }
  return best;
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

/** Items Klutz never suppresses (pinned Showdown data/items.ts ignoreKlutz). */
const KLUTZ_IGNORED_ITEMS = new Set(["abilityshield", "machobrace", "poweranklet", "powerband", "powerbelt", "powerbracer", "powerlens", "powerweight"]);
/** Items the engine's checkItem keeps for a Klutz holder (util.js EV_ITEMS). */
const ENGINE_KLUTZ_KEPT_ITEMS = new Set(["machobrace", "poweranklet", "powerband", "powerbelt", "powerbracer", "powerlens", "powerweight"]);

/** Klutz works unless the other battler's Neutralizing Gas suppresses it (an Ability Shield holder keeps it). */
const klutzActive = (build: BattleBuild, other: BattleBuild) =>
  build.abilityId === "klutz" && !(other.abilityId === "neutralizinggas" && build.itemId !== "abilityshield");

/** A copy without its held item when Showdown's ignoringItem() holds: Magic Room, or an active Klutz. */
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
  if (FUTURE_MOVES.has(move.id)) return { kind: "full", line: `${move.name} lands at the end of a later turn, which the target's Protect does not block.` };
  if (PROTECT_IGNORING_MOVES.has(move.id)) return { kind: "full", line: `The target is protecting, but ${move.name} is not blocked by Protect.` };
  // The target's Neutralizing Gas suppresses the ability unless Ability Shield (not under Magic Room) keeps it.
  const suppressed = defender.abilityId === "neutralizinggas" && !shieldsAbility(attacker, conditions);
  // Punching Glove removes contact from punching moves (Showdown data/items.ts).
  const contact = !!engineMove.flags.contact && !(attacker.itemId === "punchingglove" && engineMove.flags.punch && !conditions.magicRoom);
  const piercing = !suppressed && contact && (attacker.abilityId === "unseenfist" || (runtime.profile.id === "champions" && attacker.abilityId === "piercingdrill"));
  const ability = runtime.abilitiesById.get(attacker.abilityId)?.name ?? attacker.abilityId;
  if (runtime.profile.id === "champions") {
    return piercing ? { kind: "quarter", line: `The target is protecting: ${ability} lets this contact move through for a quarter of the damage, after every other modifier.` } : { kind: "blocked" };
  }
  if (engineMove.isZ || engineMove.isMax || move.isZ || move.isMax || isMaxActive(attacker)) return { kind: "quarter", line: `The target is protecting: ${move.name} breaks through for a quarter of the damage, after every other modifier.` };
  if (piercing) return { kind: "full", line: "The target is protecting, but Unseen Fist lets this contact move through in full." };
  return { kind: "blocked" };
}

/** Status moves whose lasting effect is set under Field conditions instead. */
const STATE_MOVE_HINTS: Record<string, string> = {
  ...Object.fromEntries(["protect", "detect", "kingsshield", "spikyshield", "banefulbunker", "obstruct", "silktrap", "burningbulwark"]
    .map((id) => [id, "For attacks into a Pokémon protecting this turn, tick Protecting on its side under Field conditions."])),
  tailwind: "Tick Tailwind on the user's side under Field conditions to double that side's Speed.",
  charge: "Tick Charge on the user's side under Field conditions for its next Electric attack.",
};

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
  if (NO_PARENTAL_BOND_MOVES.has(move.id)) return `${move.name} is never doubled by Parental Bond`;
  if (move.multihit !== null || hits > 1) return `${move.name} already hits more than once`;
  if (move.isZ || move.isMax || engineMove.isZ || engineMove.isMax) return `${move.name} is a ${engineMove.isMax || move.isMax ? "Max Move" : "Z-Move"}`;
  if (conditions.gameType === "Doubles" && ["allAdjacent", "allAdjacentFoes"].includes(engineMove.target)) return "a spread hit is never doubled";
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
  const notes = ["This assumes the target uses a move with 0 priority."];
  if (priority !== 0) return { order: priority > 0 ? "first" : "last", reason: `it has ${priority > 0 ? "+" : ""}${priority} priority`, bySpeed: false, notes };
  const itemName = (id: string) => runtime.itemsById.get(id)?.name ?? id;
  // Fractional priority: Lagging Tail, Full Incense and Stall make the holder move last in its
  // bracket; an eaten Custap Berry (at 1/4 HP, or 1/2 with Gluttony) makes it move first.
  const fraction = (build: BattleBuild, other: BattleBuild, pokemon: Pokemon, who: string) => {
    const itemOn = !conditions.magicRoom && !(build.abilityId === "klutz" && other.abilityId !== "neutralizinggas");
    const abilityOn = !(other.abilityId === "neutralizinggas" && !shieldsAbility(build, conditions));
    const unnerved = ["unnerve", "asoneglastrier", "asonespectrier"].includes(other.abilityId) && !gassedAbility(other, build, conditions);
    const hp = pokemon.curHP(), max = pokemon.maxHP();
    if (itemOn && build.itemId === "custapberry" && !unnerved && (hp <= max / 4 || (hp <= max / 2 && abilityOn && build.abilityId === "gluttony"))) {
      return { value: 0.1, why: `${who} Custap Berry lets it move first in its priority bracket` };
    }
    // Quick Claw and Quick Draw run after the constant -0.1 handlers and can still return 0.1.
    if (itemOn && build.itemId === "quickclaw") notes.push(`This assumes ${who === "its" ? "the attacker's" : "the target's"} Quick Claw does not activate (a 20% chance to move first).`);
    if (abilityOn && build.abilityId === "quickdraw") notes.push(`This assumes ${who === "its" ? "the attacker's" : "the target's"} Quick Draw does not activate (a 30% chance to move first).`);
    if (itemOn && ["laggingtail", "fullincense"].includes(build.itemId)) return { value: -0.1, why: `${who} ${itemName(build.itemId)} makes it move last in its priority bracket` };
    if (abilityOn && build.abilityId === "stall") return { value: -0.1, why: `${who} Stall makes it move last in its priority bracket` };
    return { value: 0, why: "" };
  };
  const own = fraction(attackerBuild, defenderBuild, probe.attacker, "its");
  const theirs = fraction(defenderBuild, attackerBuild, probe.defender, "the target's");
  if (own.value !== theirs.value) {
    return { order: own.value > theirs.value ? "first" : "last", reason: [own.why, theirs.why].filter(Boolean).join(" and "), bySpeed: false, notes };
  }
  const speed = (pokemon: Pokemon, side: Result["field"]["attackerSide"]) => {
    if (!pokemon.isDynamaxed || !pokemon.hasItem("Choice Scarf")) return pokemon.stats.spe;
    const scarfless = pokemon.clone();
    scarfless.item = undefined;
    return getFinalSpeed(probe.gen, scarfless, probe.field, side);
  };
  const mine = speed(probe.attacker, probe.field.attackerSide), target = speed(probe.defender, probe.field.defenderSide);
  if (mine === target) return { order: "tie", reason: `both have ${mine} Speed, so Showdown picks the order at random`, bySpeed: true, notes };
  const first = conditions.trickRoom ? mine < target : mine > target;
  return {
    order: first ? "first" : "last",
    reason: `it has ${mine} Speed against the target's ${target}${conditions.trickRoom ? ", and Trick Room lets the slower Pokémon move first" : ""}`,
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

// Pinned Showdown Friend Guard (data/abilities.ts) is breakable, so these attackers ignore the
// partner's; Neutralizing Gas on either battler suppresses it, Mold Breaker included. The engine
// applies it unconditionally.
const ABILITY_IGNORERS = new Set(["moldbreaker", "teravolt", "turboblaze"]);

function friendGuardSuppressor(attacker: BattleBuild, defender: BattleBuild, runtime: BattleRuntime): string | null {
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
    // Trick Room is app-owned: the engine has no turn-order field for it.
    attackerSide: makeSide(field.attackerSide),
    defenderSide: makeSide(field.defenderSide),
  });
}

function resolveHits(move: ChampionsMove, build: BattleBuild, context: MoveContext | undefined, runtime: BattleRuntime, battle: HitCountBattle) {
  const rule = hitCountRule(move, build, runtime, battle);
  if (rule.kind === "fixed") return { hits: rule.hits, reason: null };
  // Per-hit-accuracy moves default to every hit landing; 2–5 hit moves need a choice.
  if (context?.hits === undefined && rule.defaultHits !== null) return { hits: rule.defaultHits, reason: null };
  if (!Number.isInteger(context?.hits) || context!.hits! < rule.min || context!.hits! > rule.max) {
    return { hits: null, reason: `Choose a hit count from ${rule.min} to ${rule.max}; damage is conditional on every selected hit connecting.` };
  }
  return { hits: context!.hits!, reason: null };
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
function fixedHPDamage(move: ChampionsMove, probe: Result, assumptions: string[], connectsWithoutDefenderAbility: () => boolean): MoveDamageResult {
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
  if (damage === 0) {
    return noDamage(`${move.name} deals no damage: the defender's HP scaled back from Dynamax (${beforeDynamax}) equals the attacker's HP.`);
  }
  const targetHP = `the defender's current HP${dynamaxed ? " scaled back from Dynamax" : ""} (${beforeDynamax})`;
  const lines = [move.id === "endeavor"
    ? `Fixed damage: ${targetHP} minus the attacker's current HP (${userHP}), at least 1. Enter the attacker's HP at the moment it attacks.`
    : `Fixed damage: half ${targetHP}, rounded down, at least 1.`,
  "Stats, stat stages, items, abilities, weather, screens and critical hits do not change fixed damage; only type and ability immunities apply."];
  if (probe.move.type !== move.type) lines.push(`Effective move type: ${probe.move.type}.`);
  if (defender.hasItem("Focus Band")) lines.push("Focus Band survival chance is not modeled; KO probability is unavailable.");
  probe.damage = damage;
  const percent = damage / defender.maxHP() * 100;
  return {
    moveId: move.id, effectiveName: move.name, effectiveType: probe.move.type, effectivePower: move.power, effectiveCategory: move.category,
    kind: "calculated", min: damage, max: damage, minPercent: percent, maxPercent: percent,
    rolls: damage, ohkoChance: directKOChance(probe, 1),
    description: `${move.name}: ${damage}–${damage} HP (${percent.toFixed(1)}–${percent.toFixed(1)}% of maximum HP).`,
    assumptions: [...assumptions, ...lines], reason: null, hits: 1,
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
): MoveDamageResult {
  let conditions = battleConditions;
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
    // Move.clone() resets a fixed multihit from data, so `hits` alone does not survive.
    ...(splitsDartsAcrossFoes(assigned, conditions) ? { multihit: 1 } : {}),
    // Showdown never raises Beat Up (basePower 0 with a basePowerCallback) to the Tera 60-power
    // floor; multiaccuracy is the only other thing the engine's floor check reads.
    ...(beatUp && "hits" in beatUp ? { multiaccuracy: true } : {}),
  };
  const resolveWith = (basePower: number | null, extra: { name?: MoveName; type?: TypeName } = {}) => resolveBattleMove(assigned, attackerBuild, makePokemon(attackerBuild, runtime), context, runtime, {
    isCrit: conditions.critical,
    overrides: { ...baseOverrides, ...(basePower !== null ? { basePower } : {}), ...extra },
  });
  let resolved: ReturnType<typeof resolveBattleMove>;
  try {
    resolved = resolveWith(overridePower);
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
      resolved = { ...retyped, assumptions: [...retyped.assumptions, `${assigned.name} takes its ${type} type before Max conversion, so it becomes ${retyped.move.name}.`] };
    }
  }
  const metadata = resolved.effective;
  if (metadata.unsupported.length) return emptyRow(metadata, "unsupported", metadata.unsupported.join(" "));
  if (metadata.category === "Status") {
    const hint = STATE_MOVE_HINTS[metadata.id];
    return emptyRow(metadata, "status", `No direct damage calculated; status and called-move effects are not simulated.${hint ? ` ${hint}` : ""}`);
  }
  if (conditions.gravity && GRAVITY_BLOCKED_MOVES.has(metadata.id)) {
    return zeroDamage(metadata, `Gravity prevents ${metadata.name} from being used.`);
  }
  let protect: ProtectOutcome | null = null;
  if (conditions.defenderSide.protect) {
    if (isMaxActive(defenderBuild)) return emptyRow(metadata, "unsupported", "A Dynamaxed Pokémon protects with Max Guard, which is not modelled.");
    // These fail in Showdown's Try/TryMove steps, before Protect's TryHit.
    if (TARGET_ATTACK_MOVES.has(metadata.id)) return zeroDamage(metadata, `${metadata.name} fails: a Pokémon protecting this turn has already used its move.`);
    if (metadata.id === "snore" && attackerBuild.status !== "slp" && attackerBuild.abilityId !== "comatose") return zeroDamage(metadata, "Snore fails because the attacker is not asleep.");
    if (EXPLOSIVE_MOVES.has(metadata.id) && dampPrevents(attackerBuild, defenderBuild)) return zeroDamage(metadata, `Damp prevents ${metadata.name} from being used.`);
    protect = protectOutcome(metadata, resolved.move, attackerBuild, defenderBuild, conditions, runtime);
    if (protect.kind === "blocked") return zeroDamage(metadata, `The target is protecting, which blocks ${metadata.name}.`);
    // Fixed damage (damageCallback) skips modifyDamage, where Showdown takes the quarter; Guardian of Alola has its own.
    if (protect.kind === "quarter" && FIXED_DAMAGE_MOVES.has(metadata.id)) {
      protect = metadata.id === "guardianofalola"
        ? { kind: "quarter", line: "The target is protecting: Guardian of Alola breaks through for a quarter of its fixed damage." }
        : { kind: "full", line: `The target is protecting, but ${metadata.name}'s fixed damage gets through in full.` };
    }
  }
  // Fixed damage ignores the attacker's ability boosts, so these contexts cannot change it.
  if (CONTEXT_ABILITIES[attackerBuild.abilityId] && !FIXED_HP_MOVES[metadata.id]
    && (attackerBuild.abilityId !== "rivalry" || !getBuildGender(attackerBuild, runtime) || !getBuildGender(defenderBuild, runtime))) {
    return emptyRow(metadata, "needs-context", CONTEXT_ABILITIES[attackerBuild.abilityId]);
  }
  if (metadata.ohko) return emptyRow(metadata, "unsupported", "One-hit KO moves use their own accuracy/eligibility rules, not a normal damage range.");
  if (HISTORY_MOVES[metadata.id]) return emptyRow(metadata, "needs-context", metadata.id === "fling" && runtime.profile.id !== "champions"
    ? "Fling's item eligibility and consumption need additional verification for this game."
    : HISTORY_MOVES[metadata.id]);
  if (!resolved.transformed && counted && "reason" in counted) return emptyRow(metadata, "needs-context", counted.reason);
  if (!resolved.transformed && beatUp && "reason" in beatUp) return emptyRow(metadata, "needs-context", beatUp.reason);
  if (metadata.power === 0 && !ZERO_POWER_IMPLEMENTED.has(metadata.id) && !FIXED_HP_MOVES[metadata.id] && !(beatUp && !resolved.transformed)) {
    return emptyRow(metadata, "unsupported", `This move's special damage mechanic is not verified in the pinned ${runtime.profile.id === "champions" ? "Champions" : runtime.profile.label} engine.`);
  }
  const restricted = !resolved.transformed ? USER_RESTRICTED_MOVES[metadata.id] : undefined;
  const userSpecies = runtime.speciesById.get(attackerBuild.speciesId);
  if (restricted && userSpecies && !restricted.allowed(userSpecies)) {
    return zeroDamage(metadata, `${metadata.name} fails: only ${restricted.who} can use it.`);
  }
  const iceFace = defenderBuild.speciesId === "eiscue" && defenderBuild.abilityId === "iceface"
    && (shieldsAbility(defenderBuild, conditions) || (!["moldbreaker", "teravolt", "turboblaze"].includes(attackerBuild.abilityId) && !IGNORE_ABILITY_MOVES.has(metadata.id)));
  if (iceFace && metadata.category === "Physical") return emptyRow(metadata, "needs-context", ICE_FACE_REASON);
  // Ability Shield keeps Disguise from Mold Breaker and its kin (and an ignoreAbility move).
  if (["mimikyu", "mimikyutotem"].includes(defenderBuild.speciesId) && defenderBuild.abilityId === "disguise"
    && (shieldsAbility(defenderBuild, conditions) || (!["moldbreaker", "teravolt", "turboblaze"].includes(attackerBuild.abilityId)
    && !IGNORE_ABILITY_MOVES.has(metadata.id)))) {
    return emptyRow(metadata, "needs-context", "Intact Disguise absorbs a hit. Select Mimikyu-Busted for damage after the disguise breaks; shield loss is not simulated.");
  }
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
    // A Seed on its own terrain stays unused under Magic Room only if the room came first; an
    // active Klutz never lets it activate.
    const seedOrder = conditions.magicRoom && !klutzSuppresses && conditions.terrain && suppressedItemHolder.itemId === `${conditions.terrain.toLowerCase()}seed`
      ? " This assumes Magic Room started before the terrain; otherwise the Seed was used up." : "";
    const whose = metadata.id === "acrobatics" ? "the attacker's" : "the target's";
    const outcome = metadata.id === "acrobatics" ? "so Acrobatics keeps its usual power" : "so Poltergeist hits";
    suppressedItemNote = (by ? `${by} ${whose} ${item}, but it is still held, ${outcome}.` : `Klutz does not affect ${whose} ${item}, ${outcome}.`) + seedOrder;
  }

  const hitBattle: HitCountBattle = { magicRoom: conditions.magicRoom, opponentAbilityId: defenderBuild.abilityId };
  let hitCount = resolveHits(metadata, attackerBuild, context, runtime, hitBattle);
  if (hitCount.hits === null) return emptyRow(metadata, "needs-context", hitCount.reason!);
  const hitRule = hitCountRule(metadata, attackerBuild, runtime, hitBattle);

  const assumptions = ["One use, conditional on connecting; damage is before the defender's remaining-HP cap.", ...resolved.assumptions];
  if (protect && "line" in protect) assumptions.push(protect.line);
  if (suppressedItemNote) assumptions.push(suppressedItemNote);
  if (analyticAfterProtect) assumptions.push("The target protected before this attack, so Analytic boosts it.");
  const eventAssumption = resolved.transformed ? null
    : paybackAfterProtect ? "Doubled power: the target is protecting, so it has already moved this turn."
    : eventDoublingAssumption(metadata.id, context);
  if (eventAssumption) assumptions.push(eventAssumption);
  if (!resolved.transformed && counted && "line" in counted) assumptions.push(counted.line);
  const beatUpHits = !resolved.transformed && beatUp && "hits" in beatUp ? beatUp.hits : null;
  if (beatUpHits) {
    assumptions.push(`Beat Up: ${beatUpHits.length} hit${beatUpHits.length === 1 ? "" : "s"}, one per party member that is not fainted and has no status: ${beatUpHits.map((hit) => `${hit.name} ${hit.power}`).join(", ")} power. Set the party in the move settings above the move list.`);
  }
  if (attackerBuild.abilityId === "supremeoverlord") {
    const fallen = attackerBuild.faintedAllies ?? 0;
    assumptions.push(`Supreme Overlord: ${fallen} all${fallen === 1 ? "y" : "ies"} had fainted when it entered (${supremeOverlordMultiplier(fallen).toFixed(1)}x power). Set the count in Build settings.`);
  }
  if (splitsDartsAcrossFoes(metadata, conditions)) {
    hitCount = { hits: 1, reason: null };
    assumptions.push("In Doubles, one dart hits this target and the other hits its partner. Turn off “Multiple targets hit” when only this target can be hit (partner absent, fainted, protecting, immune or semi-invulnerable); both darts then hit it.");
  }
  if (conditions.gravity) assumptions.push("Gravity grounds airborne Pokémon. Displayed accuracy remains the catalog value; accuracy changes are not simulated.");
  if (conditions.trickRoom) assumptions.push("Trick Room lets the slower Pokémon move first within a priority bracket; it changes no Speed stat, so Electro Ball and Gyro Ball still use actual effective Speed.");
  if (conditions.wonderRoom) assumptions.push("Wonder Room swaps unboosted Defense and Sp. Def; stages stay with their original stat.");
  // Pinned Showdown data/moves.ts wonderroom onModifyMove turns Body Press's attacking stat
  // into Sp. Def, and sim/pokemon.ts calculateStat swaps it back to the original Defense;
  // the engine's calculateAttack matches, and so does cartridge research (a quirk shared
  // with Shell Side Arm and Download). Only Showdown's hint text says Defense stages.
  if (conditions.wonderRoom && metadata.id === "bodypress") assumptions.push("Under Wonder Room, Body Press uses the attacker's original Defense with its Sp. Def stages, a game quirk that pinned Showdown also calculates.");
  if (conditions.magicRoom) assumptions.push("Magic Room suppresses held-item effects without removing the held items or changing selected forms.");
  if (conditions.fairyAura) assumptions.push("Additional Fairy Aura is active for Fairy-type attacks on either side; aura sources do not stack.");
  // Friend Guard is a damage modifier (Showdown ModifyDamage), so fixed damage never passes through it.
  if (!FIXED_DAMAGE_MOVES.has(metadata.id)) {
    if (friendGuardSuppressedBy) {
      assumptions.push(`${friendGuardSuppressedBy} ${friendGuardSuppressedBy === "Neutralizing Gas" ? "suppresses" : "ignores"} the partner's Friend Guard.`);
    } else if (conditions.defenderSide.friendGuard && IGNORE_ABILITY_MOVES.has(metadata.id)) {
      conditions = { ...conditions, defenderSide: { ...conditions.defenderSide, friendGuard: false } };
      assumptions.push(`${metadata.name} ignores the partner's Friend Guard.`);
    } else if (conditions.defenderSide.friendGuard) {
      assumptions.push("Friend Guard: the receiving Pokémon's partner reduces this damage to 75%.");
    }
  }
  if (SUCCESS_ASSUMPTIONS[metadata.id]) assumptions.push(SUCCESS_ASSUMPTIONS[metadata.id]);
  if (hitRule.kind === "fixed" && hitRule.reason) assumptions.push(hitRule.reason);
  if (hitRule.kind === "choose" && hitRule.perHitAccuracy) {
    assumptions.push(hitCount.hits === hitRule.max
      ? `Assumes all ${hitRule.max} hits land. After the first, each hit checks accuracy again and the move stops at the first miss; choose fewer hits under the selected move.`
      : `Assumes exactly ${hitCount.hits} of up to ${hitRule.max} hits: after the first, each hit checks accuracy again and the move stops at the first miss.`);
  }
  let attackingSpecies = attackerBuild.speciesId;
  if (attackingSpecies === "aegislash" && attackerBuild.abilityId === "stancechange") {
    attackingSpecies = "aegislashblade";
    const blade = runtime.speciesById.get(attackingSpecies);
    if (!blade || blade.unsupported.length) return emptyRow(metadata, "unsupported", "A verified Blade Forme is required for Stance Change attacks.");
    assumptions.push("Stance Change uses Blade Forme for this damaging attack.");
  }

  try {
    const generation = Generations.get(runtime.profile.generation);
    const attackerMimicry = mimicryTypes(attackerBuild, defenderBuild, conditions, "attacker", runtime);
    const defenderMimicry = mimicryTypes(defenderBuild, attackerBuild, conditions, "target", runtime);
    for (const line of [attackerMimicry.line, defenderMimicry.line]) if (line) assumptions.push(line);
    const attacker = makePokemon(analyticAfterProtect ? { ...attackerBuild, abilityActive: true } : attackerBuild, runtime, attackingSpecies, attackerMimicry.types);
    const defender = makePokemon(defenderBuild, runtime, defenderBuild.speciesId, defenderMimicry.types);
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
      // Download's entry boost is already in the stages (settleEntry); it has no other effect.
      if (build.settledDownload) pokemon.ability = "Run Away" as AbilityName;
    }
    // The other battler's Neutralizing Gas suppresses Klutz, so the item works (Showdown ignoringItem);
    // the engine's checkItem drops a Klutz holder's item before it applies the gas.
    if (attackerBuild.abilityId === "klutz" && !klutzActive(attackerBuild, defenderBuild)) attacker.ability = "Run Away" as AbilityName;
    if (defenderBuild.abilityId === "klutz" && !klutzActive(defenderBuild, attackerBuild)) defender.ability = "Run Away" as AbilityName;
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
      assumptions.push("Normalize does not change Hidden Power's type, so it gets no Normalize boost.");
      attacker.ability = "Run Away" as AbilityName;
    }
    const stellar = attackerBuild.mechanic === "tera" && attackerBuild.configuration?.teraType === "Stellar";
    // Stellar replaces the STAB step, so Adaptability (a ModifySTAB effect) does not apply (pinned
    // Showdown battle-actions); the engine would still double STAB. Adaptability does nothing else.
    if (stellar && attacker.hasAbility("Adaptability")) {
      assumptions.push("Adaptability does not apply while Stellar-Terastallized.");
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
      assumptions.push(`Stellar keeps the user's own types, so Revelation Dance is ${attacker.types[0]} type${context?.stellarFirstUse ? ", with Stellar's 2x same-type boost on this first use" : ""}.`);
    }
    // Knock Off's 1.5x needs an item it can remove; the engine misjudges a Mega Stone held by another
    // form of its family (megaStoneKeptFromKnockOff). A neutral name keeps the engine's boost off.
    // A transformed Imposter user's Stone can always be knocked off; the engine checks the copied form.
    if (metadata.id === "knockoff" && !resolved.transformed && defenderBuild.transformedFrom && generation.items.get(defenderBuild.itemId as ID)?.megaStone) {
      defender.item = "Leftovers" as never;
      assumptions.push(`Transform keeps the target's own species, so Knock Off can remove its ${runtime.itemsById.get(defenderBuild.itemId)?.name ?? defenderBuild.itemId} and gets its power boost.`);
    }
    if (metadata.id === "knockoff" && !resolved.transformed && defenderBuild.itemId && megaStoneKeptFromKnockOff(generation, defender, defenderBuild.itemId, defenderBuild)) {
      resolved = resolveWith(overridePower, { name: "Knock Off (item kept)" as MoveName });
      if (resolved.kind) return emptyRow(metadata, resolved.kind, resolved.reason);
      assumptions.push(defenderBuild.itemId === "boosterenergy"
        ? "Knock Off cannot remove Booster Energy from a Paradox Pokémon, so it gets no power boost."
        : `Knock Off cannot remove the target's ${runtime.itemsById.get(defenderBuild.itemId)?.name ?? defenderBuild.itemId}, which belongs to its family, so it gets no power boost.`);
    }
    // Bolt Beak and Fishious Rend double when the user moves before its target; the engine uses
    // Speed alone (ties and Trick Room wrong), so the app sets the power from the turn order.
    let orderBySpeed = false;
    if (MOVES_FIRST_POWER_MOVES.has(metadata.id) && !resolved.transformed) {
      let first: boolean;
      if (context?.turnOrder) {
        first = context.turnOrder === "first";
        assumptions.push(first ? `${metadata.name}: set to move before the target (or the target switched in this turn), so its power doubles.` : `${metadata.name}: set to move after the target, so it has its usual power.`);
      } else {
        const probe = calculate(generation, attacker, defender, resolved.move, makeField(conditions));
        const order = probe.range()[1] === 0 ? { order: "first" as const, reason: "", bySpeed: false, notes: [] } : turnOrderAgainstTarget(probe, resolved.move.priority, attackerBuild, defenderBuild, conditions, runtime);
        if (order.order === "tie") {
          return emptyRow(metadata, "needs-context", `${metadata.name} doubles its power only if it moves before the target, and ${order.reason}. Choose the turn order in the move settings above the move list.`);
        }
        first = order.order === "first";
        orderBySpeed = order.bySpeed;
        if (order.reason) assumptions.push(...order.notes, `${metadata.name}: ${order.reason}, so it moves ${first ? "before the target and its power doubles" : "after the target and has its usual power"}.`);
      }
      resolved = resolveWith((overridePower ?? metadata.power) * (first ? 2 : 1), { name: `${metadata.name} (turn order set)` as MoveName });
      if (resolved.kind) return emptyRow(metadata, resolved.kind, resolved.reason);
    }
    // Set only when the engine retargets, i.e. a grounded user on Psychic Terrain.
    let retargeted = false;
    const move = hitsOneFoe(metadata, conditions) ? withSingleTarget(resolved.move, () => { retargeted = true; }) : resolved.move;
    move.hits = hitCount.hits;
    if (hitCount.hits > 1 && defender.item && AFTER_MOVE_ITEMS.has(defender.item)) defender.item = undefined;
    // Both engines resolve Gale Wings too late for terrain/priority shields.
    // Showdown battle.ts:2619–2646 applies abilities AFTER Z/Max conversion; the
    // effective Flying attack gains priority, not its untransformed base move.
    if (attacker.hasAbility("Gale Wings") && metadata.type === "Flying" && attacker.curHP() === attacker.maxHP()) {
      withResolvedPriority(move, metadata.priority + 1);
    }
    // Grassy Glide gains +1 priority on Grassy Terrain for a grounded user (Showdown data/moves.ts
    // onModifyPriority), so Armor Tail, Queenly Majesty and Dazzling block it; the engine never raises it.
    // Showdown's isGrounded ignores an Iron Ball or Air Balloon under Magic Room or Klutz (the target's
    // Neutralizing Gas suppresses Klutz); the engine clears it only inside calculate().
    if (metadata.id === "grassyglide" && conditions.terrain === "Grassy" && isGrounded(ignoringItem(attacker, attackerBuild, defenderBuild, conditions), makeField(conditions))) {
      withResolvedPriority(move, metadata.priority + 1);
      assumptions.push("Grassy Glide has +1 priority on Grassy Terrain because the user is grounded.");
    }
    // Analytic's turn order: the move settings' choice, a Protecting target in Singles, or in Singles
    // the order against the target. The engine boosts on its condition (abilityOn) and Run Away has
    // no effect, so each decision is exact.
    if (analyticOrdered && !analyticAfterProtect) {
      let last: boolean | null = null;
      if (FUTURE_MOVES.has(metadata.id)) {
        // Future Sight and Doom Desire land at the end of a later turn, when no Pokémon still has to move.
        last = true;
        assumptions.push(`${metadata.name} lands at the end of a later turn, after every Pokémon has moved, so Analytic boosts it (if this Pokémon is still in battle).`);
      } else if (context?.turnOrder) {
        last = context.turnOrder === "last";
        assumptions.push(last ? "Analytic: set to move last this turn, so it boosts." : "Analytic: set to move before another Pokémon this turn, so it does not boost.");
      } else {
        const probe = calculate(generation, attacker, defender, move, makeField(conditions));
        // No damage either way (an immune target) needs no turn order.
        if (probe.range()[1] > 0) {
          if (conditions.gameType === "Doubles") {
            return emptyRow(metadata, "needs-context", "In Doubles, Analytic boosts only if this Pokémon moves after all three other Pokémon, which depends on their moves and Speed (a target that switched out counts as having moved, but the other two still decide it). Choose the turn order in the move settings above the move list.");
          }
          // The engine drops negative priority (Avalanche, Focus Punch...); the catalog keeps it.
          const orderPriority = resolved.transformed || assigned.priority >= 0 ? move.priority : assigned.priority;
          const order = turnOrderAgainstTarget(probe, orderPriority, attackerBuild, defenderBuild, conditions, runtime);
          if (order.order === "tie") {
            return emptyRow(metadata, "needs-context", `Analytic boosts only if this Pokémon moves after the target, and ${order.reason}. Choose the turn order in the move settings above the move list.`);
          }
          last = order.order === "last";
          orderBySpeed = order.bySpeed;
          assumptions.push(...order.notes, `Analytic: ${order.reason}, so it moves ${last ? "after the target and boosts" : "before the target and does not boost"}.`);
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
      return fixedHPDamage(metadata, run(defender), assumptions, () => {
        // An empty ability would be refilled with the species' first one on the engine's
        // clone; Run Away has no effect anywhere in the engine.
        const bare = defender.clone();
        bare.ability = "Run Away" as AbilityName;
        return run(bare).range()[1] > 0;
      });
    }
    // The engine computes only the first strike: its own second strike re-applies setup to shared
    // objects, so parentalBondStrike computes it (and Showdown skips some moves altogether).
    const parentalBond = attacker.hasAbility("Parental Bond") && defenderBuild.abilityId !== "neutralizinggas";
    const bondSkip = parentalBond ? (beatUpHits ? "Beat Up already hits once per party member" : parentalBondSkip(metadata, move, conditions, hitCount.hits)) : null;
    if (attacker.hasAbility("Parental Bond")) attacker.ability = "Run Away" as AbilityName;
    if (bondSkip) assumptions.push(`Parental Bond adds no second strike here: ${bondSkip}.`);
    let result = calculate(generation, attacker, defender, move, makeField(conditions));
    // Shell Side Arm, and Tera Blast or Tera Starstorm from a Terastallized user, turn physical only
    // inside the engine's calculate() (as in Showdown's onModifyMove), so Ice Face is checked again.
    if (iceFace && result.move.category === "Physical") return emptyRow(metadata, "needs-context", ICE_FACE_REASON);
    const finalMods = result.rawDesc.isFriendGuard ? finalModifierCount(result) : 0;
    if (finalMods >= 3) {
      return emptyRow(metadata, "unsupported", `Friend Guard with ${finalMods - 1} other damage modifiers here (such as a screen, Life Orb, Solid Rock or a resist berry) is withheld: the pinned ${runtime.profile.id === "champions" ? "Champions" : runtime.profile.label} engine combines them in a fixed order, while Showdown orders them by each Pokémon's Speed, which can change the damage by 1 HP.`);
    }
    const overlordChain = supremeOverlordChain(generation, result);
    if (overlordChain !== null && overlordChain >= 3) {
      return emptyRow(metadata, "unsupported", `Supreme Overlord with ${overlordChain - 1} other power boosts here (such as Helping Hand, a type-boosting item or Knock Off) is withheld: the pinned ${runtime.profile.id === "champions" ? "Champions" : runtime.profile.label} engine combines them in a different order from Showdown, which can change the damage by 1–2 HP.`);
    }
    if (beatUpHits && beatUpHits.length > 1 && Array.isArray(result.damage) && !Array.isArray(result.damage[0])) {
      // Each hit is calculated on its own at that member's power.
      const blocker = BEAT_UP_BLOCKERS.find((entry) => entry.applies(result, conditions));
      if (blocker) return emptyRow(metadata, "unsupported", `Beat Up into ${blocker.name} is withheld: ${blocker.effect}, and each Beat Up hit here is calculated separately.`);
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
    }
    if (retargeted && metadata.id === "terastarstorm") assumptions.push("One target: no spread reduction. Terapagos-Stellar's Tera Starstorm hits both foes, so this fits only when the target's partner is absent or has fainted; keep “Multiple targets hit” on otherwise.");
    else if (retargeted) assumptions.push("One target: no spread reduction, with Expanding Force's 1.5x power from Psychic Terrain. This fits only when the target's partner is absent or has fainted; a partner on the field still triggers Showdown's spread reduction even when it protects, is immune or is semi-invulnerable, so keep “Multiple targets hit” on then.");
    // The engine doubles Payback whenever the attacker is not faster (its turn-order guess).
    // Showdown doubles it only when the target already moved, which is this move's context.
    if (metadata.id === "payback" && eventPower !== null && !resolved.transformed && result.rawDesc.moveBP === eventPower * 2) {
      const retry = resolveWith(eventPower / 2);
      if (retry.kind) return emptyRow(metadata, retry.kind, retry.reason);
      retry.move.hits = hitCount.hits;
      result = calculate(generation, attacker, defender, retry.move, makeField(conditions));
    }
    const firstHit = result;
    const firstBurnedHit = spicySprayFirstBurnedHit(firstHit, attackerBuild, conditions);
    // The engine's own multi-hit loop keeps the attacker's first-hit status for every hit.
    if (firstBurnedHit !== null && !beatUpHits && hitCount.hits > firstBurnedHit && Array.isArray(result.damage) && Array.isArray(result.damage[0])) {
      const burned = attacker.clone();
      burned.status = "brn";
      const laterResult = calculate(generation, burned, defender, move, makeField(conditions));
      const later = laterResult.damage as number[][];
      result.damage = [...(result.damage as number[][]).slice(0, firstBurnedHit), ...later.slice(firstBurnedHit)];
      result.rawDesc.attackerAbility ??= laterResult.rawDesc.attackerAbility;
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
    }
    if (parentalBond && !bondSkip && result.range()[1] > 0) {
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
          assumptions.push("Parental Bond: the second strike doubles Assurance's power because the first strike hurt the target.");
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
        ? "Spicy Spray burns the attacker after the first hit, so every later hit is by a burned attacker (Safeguard, not modelled, would stop it)."
        : `Spicy Spray burns the attacker after the first hit, but its ${result.attacker.item ?? "berry"} cures that burn at once and is used up. The second hit burns it again, so every hit from the third on is by a burned attacker (Safeguard, not modelled, would stop it).`);
    }
    if (ironBallGrounded && !conditions.gravity && result.move.type === "Ground") {
      assumptions.push(`The target's Iron Ball grounds it, so its ${runtime.abilitiesById.get(defenderBuild.abilityId)?.name ?? defenderBuild.abilityId} does not stop Ground moves.`);
    }
    // Showdown's Unaware ignores only the attacker's Attack, Defense and Sp. Atk stages, so it
    // keeps Wonder Room Body Press's Sp. Def stage; the engine's Unaware ignores it. A crit
    // ignores a negative stage in both. The engine result carries the effective abilities
    // (Mold Breaker suppresses Unaware) and the stage after a terrain Seed; an immune target
    // takes no damage in both.
    const spdStage = result.attacker.boosts.spd ?? 0;
    if (conditions.wonderRoom && metadata.id === "bodypress" && result.defender.hasAbility("Unaware") && result.range()[1] > 0
      && (spdStage > 0 || (spdStage < 0 && !conditions.critical))) {
      return emptyRow(metadata, "unsupported", "Body Press under Wonder Room into Unaware is withheld while the attacker has a Sp. Def stage, including one from a terrain Seed: pinned Showdown applies that stage, the engine ignores it, and no cartridge test settles which is right. It is calculated when the attacker has no Sp. Def stage.");
    }
    // Use effective cloned abilities: Mold Breaker may have suppressed Damp.
    if (EXPLOSIVE_MOVES.has(metadata.id) && (result.attacker.hasAbility("Damp") || result.defender.hasAbility("Damp"))) {
      return zeroDamage(metadata, `Damp prevents ${metadata.name} from being used.`);
    }
    if (protect?.kind === "quarter") {
      const damage = result.damage;
      // Guardian of Alola's own damageCallback: 3/4 of the HP, then round(x / 4) half down, at least 1.
      result.damage = typeof damage === "number" ? (damage === 0 ? 0 : Math.max(1, Math.ceil(damage / 4 - 0.5)))
        : Array.isArray(damage[0]) ? (damage as number[][]).map((hit) => hit.map(quarterDamage)) : (damage as number[]).map(quarterDamage);
    }
    const [min, max] = result.range();
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min) {
      return emptyRow(metadata, "unsupported", "The engine returned an invalid damage range for this matchup.");
    }
    if (hitCount.hits > 1 || (Array.isArray(result.damage) && Array.isArray(result.damage[0]))) {
      assumptions.push(`Assumes all ${hitCount.hits > 1 ? hitCount.hits : 2} hits finish. Mid-move healing, retaliation and attacker fainting are not simulated; no multi-hit KO probability is claimed.`);
    }
    if (result.attacker.hasItem("Metronome")) assumptions.push("Metronome is treated as the first use, without a consecutive-use bonus.");
    if (conditions.attackerSide.charge && result.rawDesc.isCharge) assumptions.push("Charge doubles this Electric attack's power.");
    const tailwind = [conditions.attackerSide.tailwind && "the attacking Pokémon's side", conditions.defenderSide.tailwind && "the receiving Pokémon's side"].filter(Boolean);
    const speedSetsPower = SPEED_POWER_MOVES.has(metadata.id) && !MOVES_FIRST_POWER_MOVES.has(metadata.id);
    if (tailwind.length && (speedSetsPower || orderBySpeed)) {
      assumptions.push(`Tailwind doubles Speed on ${tailwind.join(" and ")}, which ${speedSetsPower ? "sets this move's power" : "sets the turn order"}.`);
    }
    // Showdown gives Wind Rider +1 Attack when Tailwind starts on its side or it enters during Tailwind.
    if (attackerWindRider !== null && result.move.category === "Physical" && metadata.id !== "foulplay" && metadata.id !== "bodypress") {
      assumptions.push(attackerWindRider
        ? "Wind Rider: Tailwind on its side gave the attacker +1 Attack, added to the stages set here."
        : "The target's Neutralizing Gas stops Wind Rider's Tailwind boost. Set +1 Attack only if the attacker gained it before Neutralizing Gas came in.");
    }
    if (defenderWindRider !== null && metadata.id === "foulplay") {
      assumptions.push(defenderWindRider
        ? "Wind Rider: Tailwind on its side gave the target +1 Attack, which Foul Play uses, added to the stages set here."
        : "The attacker's Neutralizing Gas stops the target's Wind Rider Tailwind boost. Set its +1 Attack only if it gained it before Neutralizing Gas came in.");
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
    }
    const screens = result.move.category === "Physical" ? [conditions.defenderSide.reflect && "Reflect", conditions.defenderSide.auroraVeil && "Aurora Veil"]
      : [conditions.defenderSide.lightScreen && "Light Screen", conditions.defenderSide.auroraVeil && "Aurora Veil"];
    if (result.attacker.hasAbility("Infiltrator") && screens.some(Boolean)) {
      assumptions.push(`Infiltrator ignores the target's ${screens.filter(Boolean).join(" and ")}.`);
    }
    if (result.rawDesc.moveType && result.rawDesc.moveType !== metadata.type) assumptions.push(`Effective move type: ${result.rawDesc.moveType}.`);
    const escalating = ESCALATING_MOVES.has(metadata.id) && !resolved.transformed && Array.isArray(result.damage) && Array.isArray(result.damage[0]);
    if (escalating) assumptions.push(`Power per hit: ${(result.damage as number[][]).map((_, index) => metadata.power * (index + 1)).join(", ")}.`);
    else if (result.rawDesc.moveBP !== undefined && pokeRound(result.rawDesc.moveBP) !== metadata.power) assumptions.push(`Move power reported by the engine: ${pokeRound(result.rawDesc.moveBP)}.`);
    // Mold Breaker is listed only when ignoring the target's ability changed the damage or the KO
    // chance (Sturdy), when it broke through an intact Disguise the calculator checks itself, or when
    // it ignored the partner's Friend Guard (the run without it gets the Friend Guard back).
    // The stand-in Adaptability is Stellar's boost, already stated.
    if (stellarRevelation && result.rawDesc.attackerAbility === "Adaptability") delete result.rawDesc.attackerAbility;
    // G-Max Fireball's bypass is noted only when the ability would have changed the result (the
    // engine, which misspells the move, still applies it in a rerun).
    const same = (a: Result, b: Result) => JSON.stringify(a.damage) === JSON.stringify(b.damage) && directKOChance(a, hitCount.hits!) === directKOChance(b, hitCount.hits!);
    // The engine names a breaker only for a target ability it ignores; a Friend Guard partner the
    // calculation dropped for it counts too.
    const guarded = !!friendGuardSuppressedBy && friendGuardSuppressedBy !== "Neutralizing Gas" && !FIXED_DAMAGE_MOVES.has(metadata.id);
    const breaker = result.rawDesc.attackerAbility ?? (guarded ? friendGuardSuppressedBy ?? undefined : undefined);
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
      } else if (same(withIt(), without)) {
        delete result.rawDesc.attackerAbility;
      } else {
        result.rawDesc.attackerAbility = breaker;
        if (JSON.stringify(withIt().damage) === JSON.stringify(without.damage) && !guarded) {
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
    if (result.defender.curHP() === result.defender.maxHP()
      && (result.defender.hasItem("Focus Sash") || result.defender.hasAbility("Sturdy"))) {
      assumptions.push("Damage is uncapped; full-HP Focus Sash/Sturdy prevents a single-hit KO unless bypassed.");
    }
    if (result.defender.hasItem("Focus Band")) assumptions.push("Focus Band survival chance is not modeled; KO probability is unavailable.");

    const minPercent = min / result.defender.maxHP() * 100;
    const maxPercent = max / result.defender.maxHP() * 100;
    // Fickle Beam doubles its power 30% of the time (Showdown onBasePower randomChance(3, 10) then
    // chainModify(2); an exact 2x, so a doubled base power gives the same rolls).
    let alternate: MoveDamageResult["alternate"];
    let koChance = directKOChance(result, hitCount.hits);
    if (metadata.id === "ficklebeam" && !resolved.transformed && max > 0 && Array.isArray(result.damage) && !Array.isArray(result.damage[0])) {
      const doubled = resolveWith((overridePower ?? metadata.power) * 2);
      if (doubled.kind) return emptyRow(metadata, doubled.kind, doubled.reason);
      doubled.move.hits = 1;
      const doubledResult = calculate(generation, attacker, defender, doubled.move, makeField(conditions));
      if (protect?.kind === "quarter" && Array.isArray(doubledResult.damage)) doubledResult.damage = (doubledResult.damage as number[]).map(quarterDamage);
      const [altMin, altMax] = doubledResult.range();
      const altKO = directKOChance(doubledResult, 1);
      alternate = {
        chance: 0.3, label: "doubled power", min: altMin, max: altMax,
        minPercent: altMin / result.defender.maxHP() * 100, maxPercent: altMax / result.defender.maxHP() * 100,
        rolls: [...(doubledResult.damage as number[])],
      };
      koChance = koChance === null || altKO === null ? null : 0.7 * koChance + 0.3 * altKO;
      assumptions.push(`Fickle Beam's power doubles 30% of the time: then ${altMin}–${altMax} HP (${alternate.minPercent.toFixed(1)}–${alternate.maxPercent.toFixed(1)}% of maximum HP). The KO chance weighs both cases.`);
    }
    // Weather Ball, Terrain Pulse, Multi-Attack and Techno Blast take their own type before Z or Max
    // conversion (pinned Showdown useMove / getActiveMaxMove), so the Z-Move or Max Move is that
    // type's; the engine types the result so but keeps the Normal Breakneck Blitz or Max Strike name.
    const retyped = resolved.transformed && result.move.type !== "Normal" && ["Breakneck Blitz", "Max Strike"].includes(result.move.name);
    const zName = !retyped ? null : result.move.name === "Max Strike"
      ? getMaxMoveName(generation, result.move.type, assigned.name, false) : getZMoveName(assigned.name, result.move.type);
    if (zName) assumptions.push(`${assigned.name} takes its ${result.move.type} type before ${result.move.name === "Max Strike" ? "Max" : "Z"} conversion, so it becomes ${zName}.`);
    const effectNames = [
      result.rawDesc.attackerAbility, result.rawDesc.defenderAbility,
      result.rawDesc.attackerItem, result.rawDesc.defenderItem,
      result.rawDesc.weather, result.rawDesc.terrain,
    ].filter(Boolean);
    return {
      // A neutral engine name (a suppressed item, a set turn order) is not shown; a Z-Move or Max Move keeps its own.
      moveId: assigned.id, effectiveName: zName ?? (resolved.transformed ? result.move.name : metadata.name), effectiveType: result.move.type,
      // Showdown rounds a modified base power (pokeRound: Knock Off's 97.5 is 97); escalating hits show the first hit's.
      // Natural Gift's power comes from the held berry (the engine does not report it).
      effectivePower: escalating ? metadata.power
        : metadata.id === "naturalgift" && result.attacker.item?.endsWith("Berry") ? getNaturalGift(generation, result.attacker.item).p
          : result.rawDesc.moveBP !== undefined ? pokeRound(result.rawDesc.moveBP) : result.move.bp, effectiveCategory: result.move.category,
      kind: "calculated", min, max, minPercent, maxPercent,
      rolls: copyRolls(result.damage), ohkoChance: koChance,
      description: `${zName ?? metadata.name}: ${min}–${max} HP (${minPercent.toFixed(1)}–${maxPercent.toFixed(1)}% of maximum HP)${alternate ? `, or ${alternate.min}–${alternate.max} HP (${alternate.minPercent.toFixed(1)}–${alternate.maxPercent.toFixed(1)}%) when its power doubles (30% chance)` : ""}.${effectNames.length ? ` Applied: ${effectNames.join(", ")}.` : ""}`,
      assumptions, reason: null, hits: hitCount.hits,
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

export function calculateMatchup(
  attacker: BattleBuild,
  defender: BattleBuild,
  field: BattleConditions,
  contexts: Record<string, MoveContext> = {},
  runtime: BattleRuntime = championsRuntime,
): MatchupResult {
  const issues = {
    attacker: validateBuild(attacker, runtime),
    defender: validateBuild(defender, runtime),
    field: validateConditions(field, runtime),
  };
  if (Object.values(issues).some((list) => list.length)) return { issues, results: [] };
  const species = runtime.speciesById.get(attacker.speciesId)!;
  const effective = withoutSinglesPartners(field, attacker, defender);
  const notes = effective.ignored.length
    ? [`Singles has only the two battling Pokémon, so ${listNames(effective.ignored)} set for Doubles ${effective.ignored.length === 1 ? "is" : "are"} ignored.`]
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
  // Friend Guard protects the receiving side only; drop it where it cannot apply (per move in calculateMove).
  const suppressor = effective.field.defenderSide.friendGuard ? friendGuardSuppressor(effective.attacker, effective.defender, runtime) : null;
  if (suppressor) effective.field = { ...effective.field, defenderSide: { ...effective.field.defenderSide, friendGuard: false } };
  // A transformed Imposter user attacks with its target's moves; a form change keeps the Pokémon's own.
  const moveSpecies = effective.attacker.transformedFrom ? runtime.speciesById.get(effective.attacker.speciesId) ?? species : species;
  const results = moveSpecies.moves.map((id) => {
    const move = runtime.movesById.get(id);
    if (!move) throw new Error(`${runtime.profile.id === "champions" ? "Champions" : runtime.profile.label} catalog has an unresolved move: ${id}.`);
    const row = { ...calculateMove(move, effective.attacker, effective.defender, effective.field, contexts[id], runtime, suppressor), moveId: id };
    return notes.length && row.kind === "calculated" ? { ...row, assumptions: [...row.assumptions, ...notes] } : row;
  });
  return { issues, results };
}
