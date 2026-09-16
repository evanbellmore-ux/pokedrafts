import { calculate, Field, Generations, Move, Pokemon, toID } from "@smogon/calc";
import type { Result, StatsTable } from "@smogon/calc";
import { abilitiesById, itemsById, movesById, speciesById } from "./catalog";
import { ABILITY_ACTIVATION_LABELS, validateBuild, validateConditions } from "./model";
import type {
  BattleBuild,
  BattleConditions,
  BuildIssue,
  ChampionsMove,
  MoveContext,
  MoveDamageResult,
  SideConditions,
} from "./types";

const generation = Generations.get(0);

export type MatchupResult = {
  issues: { attacker: BuildIssue[]; defender: BuildIssue[]; field: BuildIssue[] };
  results: MoveDamageResult[];
};

/** These need information that a two-build snapshot does not contain. */
const HISTORY_MOVES: Record<string, string> = {
  assurance: "Needs to know whether the defender has already taken damage this turn.",
  avalanche: "Needs to know whether the attacker was damaged earlier this turn.",
  revenge: "Needs to know whether the attacker was damaged earlier this turn.",
  payback: "Needs the actual move order, including priority, switches and speed ties.",
  pursuit: "Needs the defender's switching state.",
  ragefist: "Needs the number of hits the attacker has taken earlier in the battle.",
  lastrespects: "Needs the number of allies that have fainted.",
  beatup: "Needs the eligible party members and their individual base Attack stats.",
  retaliate: "Needs to know whether an ally fainted on the previous turn.",
  lashout: "Needs to know whether a stat was lowered this turn, not just its current stage.",
  stompingtantrum: "Needs to know whether the attacker's previous move failed.",
  furycutter: "Needs the consecutive-use count.",
  rollout: "Needs the consecutive-use count and Defense Curl state.",
  iceball: "Needs the consecutive-use count and Defense Curl state.",
  echoedvoice: "Needs the consecutive-turn use count.",
  round: "Needs the earlier Round users and move order this turn.",
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
  rivalry: "Rivalry needs both Pokémon's genders; gender context is not modeled in this version.",
  supremeoverlord: "Supreme Overlord needs the number of fainted allies when it activated.",
};
const EXPLOSIVE_MOVES = new Set(["explosion", "selfdestruct", "mistyexplosion", "mindblown"]);
// Damaging moves with the pinned Showdown source's gravity flag; not a new learnset.
const GRAVITY_BLOCKED_MOVES = new Set(["bounce", "floatyfall", "fly", "flyingpress", "highjumpkick", "jumpkick", "skydrop"]);

const ZERO_POWER_IMPLEMENTED = new Set([
  "seismictoss", "nightshade", "dragonrage", "sonicboom", "finalgambit",
  "electroball", "gyroball", "lowkick", "grassknot", "heavyslam", "heatcrash",
  "flail", "reversal", "hardpress",
]);

const SUCCESS_ASSUMPTIONS: Record<string, string> = {
  suckerpunch: "Assumes Sucker Punch succeeds against an attacking move.",
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
    moveId: move.id, kind, min: null, max: null, minPercent: null, maxPercent: null,
    rolls: null, ohkoChance: null, description: move.description, assumptions: [], reason, hits: null,
  };
}

function makePokemon(build: BattleBuild, speciesId = build.speciesId) {
  const species = speciesById.get(speciesId);
  const ability = abilitiesById.get(build.abilityId);
  if (!species || !generation.species.get(toID(species.calcName)) || !ability) {
    throw new Error("The selected Pokémon is not present in the pinned Champions engine.");
  }
  return new Pokemon(generation, species.calcName, {
    level: 50,
    nature: build.nature,
    // Champions uses direct Stat Points in this engine parameter, not EVs.
    evs: build.points as StatsTable,
    boosts: build.boosts as Partial<StatsTable>,
    ability: ability.name,
    abilityOn: build.abilityActive,
    item: build.itemId ? itemsById.get(build.itemId)?.name : undefined,
    curHP: build.currentHP ?? undefined,
    status: build.status,
  });
}

function makeSide(side: SideConditions) {
  return {
    isReflect: side.reflect,
    isLightScreen: side.lightScreen,
    isAuroraVeil: side.auroraVeil,
    isHelpingHand: side.helpingHand,
  };
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

function resolveHits(move: ChampionsMove, build: BattleBuild, context?: MoveContext) {
  if (!Array.isArray(move.multihit)) return { hits: move.multihit ?? 1, reason: null };
  const [baseMinimum, maximum] = move.multihit;
  let minimum = baseMinimum;
  if (build.abilityId === "skilllink") return { hits: maximum, reason: null };
  if (build.itemId === "loadeddice" && minimum === 2 && maximum === 5) minimum = 4;
  if (!Number.isInteger(context?.hits) || context!.hits! < minimum || context!.hits! > maximum) {
    return { hits: null, reason: `Choose a hit count from ${minimum} to ${maximum}; damage is conditional on every selected hit connecting.` };
  }
  return { hits: context!.hits!, reason: null };
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

function calculateMove(
  metadata: ChampionsMove,
  attackerBuild: BattleBuild,
  defenderBuild: BattleBuild,
  conditions: BattleConditions,
  context?: MoveContext,
): MoveDamageResult {
  if (metadata.unsupported.length) return emptyRow(metadata, "unsupported", metadata.unsupported.join(" "));
  if (metadata.category === "Status") return emptyRow(metadata, "status", "No direct damage calculated; status and called-move effects are not simulated.");
  if (conditions.gravity && GRAVITY_BLOCKED_MOVES.has(metadata.id)) {
    return zeroDamage(metadata, `Gravity prevents ${metadata.name} from being used.`);
  }
  if (CONTEXT_ABILITIES[attackerBuild.abilityId]) return emptyRow(metadata, "needs-context", CONTEXT_ABILITIES[attackerBuild.abilityId]);
  if (metadata.ohko) return emptyRow(metadata, "unsupported", "One-hit KO moves use their own accuracy/eligibility rules, not a normal damage range.");
  if (HISTORY_MOVES[metadata.id]) return emptyRow(metadata, "needs-context", HISTORY_MOVES[metadata.id]);
  if (metadata.power === 0 && !ZERO_POWER_IMPLEMENTED.has(metadata.id)) {
    return emptyRow(metadata, "unsupported", "This move's special damage mechanic is not verified in the pinned Champions engine.");
  }
  if (defenderBuild.speciesId === "mimikyu" && defenderBuild.abilityId === "disguise" && attackerBuild.abilityId !== "moldbreaker") {
    return emptyRow(metadata, "needs-context", "Intact Disguise absorbs a hit. Select Mimikyu-Busted for damage after the disguise breaks; shield loss is not simulated.");
  }
  if (metadata.id === "expandingforce" && conditions.gameType === "Doubles"
    && !conditions.multipleTargets && conditions.terrain === "Psychic") {
    return emptyRow(metadata, "unsupported", "The pinned engine cannot isolate one-target Expanding Force on Psychic Terrain while retaining doubles screen rules.");
  }
  if (metadata.id === "dreameater" && defenderBuild.status !== "slp") return zeroDamage(metadata, "Dream Eater fails because the defender is not asleep.");
  if (metadata.id === "snore" && attackerBuild.status !== "slp") return zeroDamage(metadata, "Snore fails because the attacker is not asleep.");
  if (conditions.trickRoom && attackerBuild.abilityId === "analytic" && !attackerBuild.abilityActive) {
    return emptyRow(metadata, "needs-context", "Analytic under Trick Room needs the actual turn order, including priority and speed ties. Only enable the target-switching condition if the target switches before this attack.");
  }
  if (conditions.wonderRoom && metadata.id === "bodypress") {
    return emptyRow(metadata, "unsupported", "Body Press under Wonder Room is withheld: the pinned Champions engine does not apply its attacking Defense stages correctly.");
  }
  if (conditions.magicRoom && metadata.id === "acrobatics" && attackerBuild.itemId) {
    return emptyRow(metadata, "unsupported", "Held-item Acrobatics under Magic Room is withheld: the item is suppressed, not absent, but the pinned Champions engine treats it as absent for move power.");
  }

  const hitCount = resolveHits(metadata, attackerBuild, context);
  if (hitCount.hits === null) return emptyRow(metadata, "needs-context", hitCount.reason!);

  const assumptions = ["One use, conditional on connecting; damage is before the defender's remaining-HP cap."];
  if (conditions.gravity) assumptions.push("Gravity grounds airborne Pokémon. Displayed accuracy remains the catalog value; accuracy changes are not simulated.");
  if (conditions.trickRoom) assumptions.push("Trick Room changes turn order, not Speed stats. Turn order is not simulated; Electro Ball and Gyro Ball still use actual effective Speed.");
  if (conditions.wonderRoom) assumptions.push("Wonder Room swaps unboosted Defense and Sp. Def; stages stay with their original stat.");
  if (conditions.magicRoom) assumptions.push("Magic Room suppresses held-item effects without removing the held items or changing selected forms.");
  if (conditions.fairyAura) assumptions.push("Additional Fairy Aura is active for Fairy-type attacks on either side; aura sources do not stack.");
  if (SUCCESS_ASSUMPTIONS[metadata.id]) assumptions.push(SUCCESS_ASSUMPTIONS[metadata.id]);
  let attackingSpecies = attackerBuild.speciesId;
  if (attackingSpecies === "aegislash" && attackerBuild.abilityId === "stancechange") {
    attackingSpecies = "aegislashblade";
    const blade = speciesById.get(attackingSpecies);
    if (!blade || blade.unsupported.length) return emptyRow(metadata, "unsupported", "A verified Blade Forme is required for Stance Change attacks.");
    assumptions.push("Stance Change uses Blade Forme for this damaging attack.");
  }

  try {
    const attacker = makePokemon(attackerBuild, attackingSpecies);
    const defender = makePokemon(defenderBuild);
    const move = new Move(generation, metadata.name, {
      ability: attacker.ability,
      item: attacker.item,
      species: attacker.name,
      isCrit: conditions.critical,
      hits: hitCount.hits,
      timesUsed: 1,
      timesUsedWithMetronome: 0,
      overrides: {
        ...(conditions.gameType === "Doubles" && !conditions.multipleTargets ? { target: "normal" as const } : {}),
        // Resolve priority before the engine's Psychic Terrain/Armor Tail checks.
        ...(attacker.hasAbility("Gale Wings") && metadata.type === "Flying" && attacker.curHP() === attacker.maxHP()
          ? { priority: metadata.priority + 1 } : {}),
      },
    });
    const result = calculate(generation, attacker, defender, move, makeField(conditions));
    // Use effective cloned abilities: Mold Breaker may have suppressed Damp.
    if (EXPLOSIVE_MOVES.has(metadata.id) && (result.attacker.hasAbility("Damp") || result.defender.hasAbility("Damp"))) {
      return zeroDamage(metadata, `Damp prevents ${metadata.name} from being used.`);
    }
    const [min, max] = result.range();
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min) {
      return emptyRow(metadata, "unsupported", "The engine returned an invalid damage range for this matchup.");
    }
    if (hitCount.hits > 1 || (Array.isArray(result.damage) && Array.isArray(result.damage[0]))) {
      assumptions.push(`Assumes all ${hitCount.hits > 1 ? hitCount.hits : 2} hits finish. Mid-move healing, retaliation and attacker fainting are not simulated; no multi-hit KO probability is claimed.`);
    }
    if (result.attacker.hasItem("Metronome")) assumptions.push("Metronome is treated as the first use, without a consecutive-use bonus.");
    for (const [label, build] of [["Attacker", attackerBuild], ["Defender", defenderBuild]] as const) {
      const activation = ABILITY_ACTIVATION_LABELS[build.abilityId];
      if (activation) assumptions.push(`${label}: ${activation.toLowerCase()} — ${build.abilityActive ? "yes" : "no"}.`);
    }
    if (result.rawDesc.moveType && result.rawDesc.moveType !== metadata.type) assumptions.push(`Effective move type: ${result.rawDesc.moveType}.`);
    if (result.rawDesc.moveBP !== undefined && result.rawDesc.moveBP !== metadata.power) assumptions.push(`Move power reported by the engine: ${result.rawDesc.moveBP}.`);
    if (conditions.weather && !result.field.weather) assumptions.push("Weather is suppressed by an ability.");
    if (result.defender.curHP() === result.defender.maxHP()
      && (result.defender.hasItem("Focus Sash") || result.defender.hasAbility("Sturdy"))) {
      assumptions.push("Damage is uncapped; full-HP Focus Sash/Sturdy prevents a single-hit KO unless bypassed.");
    }
    if (result.defender.hasItem("Focus Band")) assumptions.push("Focus Band survival chance is not modeled; KO probability is unavailable.");

    const minPercent = min / result.defender.maxHP() * 100;
    const maxPercent = max / result.defender.maxHP() * 100;
    const effectNames = [
      result.rawDesc.attackerAbility, result.rawDesc.defenderAbility,
      result.rawDesc.attackerItem, result.rawDesc.defenderItem,
      result.rawDesc.weather, result.rawDesc.terrain,
    ].filter(Boolean);
    return {
      moveId: metadata.id, kind: "calculated", min, max, minPercent, maxPercent,
      rolls: copyRolls(result.damage), ohkoChance: directKOChance(result, hitCount.hits),
      description: `${metadata.name}: ${min}–${max} HP (${minPercent.toFixed(1)}–${maxPercent.toFixed(1)}% of maximum HP).${effectNames.length ? ` Applied: ${effectNames.join(", ")}.` : ""}`,
      assumptions, reason: null, hits: hitCount.hits,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown engine error.";
    return emptyRow(metadata, "unsupported", `This matchup could not be calculated: ${message}`);
  }
}

export function calculateMatchup(
  attacker: BattleBuild,
  defender: BattleBuild,
  field: BattleConditions,
  contexts: Record<string, MoveContext> = {},
): MatchupResult {
  const issues = {
    attacker: validateBuild(attacker),
    defender: validateBuild(defender),
    field: validateConditions(field),
  };
  if (Object.values(issues).some((list) => list.length)) return { issues, results: [] };
  const species = speciesById.get(attacker.speciesId)!;
  const results = species.moves.map((id) => {
    const move = movesById.get(id);
    if (!move) throw new Error(`Champions catalog has an unresolved move: ${id}.`);
    return calculateMove(move, attacker, defender, field, contexts[id]);
  });
  return { issues, results };
}
