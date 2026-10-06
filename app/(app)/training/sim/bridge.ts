// A belief battle (or a prelude clone stopped before the first move) → the 2v2 turn engine's input for one cell
// (SPEC §9.4 "Bridge" and "Guards"). Engine orientation: "own" is the player (the other side of the AI's seat),
// "opponent" is the AI. Prototypes: scripts/.cache/training/design/probe/{bridge-probe.ts,prelude-probe.ts}.
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { DOUBLES_SLOTS, type DoublesPokemonInput, type DoublesSlotId, type DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext, SideConditions } from "@/app/lib/battle/types";
import { ENTRY_ABILITIES } from "@/app/lib/battle/uses-to-ko";
import type { CellActions, FieldClock, MonKey } from "../model/ai-view";
import { showdownPosition, slotAt } from "../model/positions";
import type { SideID } from "../model/showdown-types";
import type { JointAction, SlotAction } from "../model/view-types";
import type { MemberKeys } from "./choices";
import type { ClonedBattle, Pokemon } from "./sim";

export const WEATHER: Record<string, BattleConditions["weather"]> = {
  sunnyday: "Sun", raindance: "Rain", sandstorm: "Sand", snowscape: "Snow", hail: "Hail",
  desolateland: "Harsh Sunshine", primordialsea: "Heavy Rain", deltastream: "Strong Winds",
};
export const TERRAIN: Record<string, BattleConditions["terrain"]> = {
  electricterrain: "Electric", grassyterrain: "Grassy", mistyterrain: "Misty", psychicterrain: "Psychic",
};
/** Volatiles the engine may ignore (legality, end of turn, crits) or that the build already carries (SPEC 9.4 guards). */
const IGNORED_VOLATILES: ReadonlySet<string> = new Set([
  "charge", "flashfire", "unburden", "slowstart", "choicelock", "lockedmove", "encore", "taunt", "disable", "torment", "throatchop",
  "healblock", "leechseed", "yawn", "perishsong", "partiallytrapped", "saltcure", "trapped", "trapper", "stall", "focusenergy",
  "laserfocus", "dragoncheer", "imprison", "protect", "helpinghand", "followme", "ragepowder", "endure",
  // Recharge: its request offers only Recharge, which is "No move"; any other move with it is a rollout (below).
  "mustrecharge",
]);
const MAPPED_SIDE: ReadonlySet<string> = new Set(["reflect", "lightscreen", "auroraveil", "tailwind"]);
const IGNORED_SIDE: ReadonlySet<string> = new Set(["spikes", "toxicspikes", "stealthrock", "stickyweb", "luckychant"]);
const ROOMS: ReadonlySet<string> = new Set(["trickroom", "gravity", "wonderroom", "magicroom", "fairylock"]);
const NOT_MODELLED_ABILITIES: ReadonlySet<string> = new Set([...Object.keys(ENTRY_ABILITIES), "download", "protosynthesis", "quarkdrive"]);
const FIRST_TURN_ONLY: ReadonlySet<string> = new Set(["fakeout", "firstimpression"]);
const FIRST_IN_A_SWITCHED_SLOT: ReadonlySet<string> = new Set(["boltbeak", "fishiousrend"]);

export const monKey = (side: SideID, aiSide: SideID, memberKey: string): MonKey => `${side === aiSide ? "opponent" : "own"}:${memberKey}`;
export function keyOfPokemon(pokemon: Pokemon, aiSide: SideID, keys: MemberKeys): MonKey {
  return monKey(pokemon.side.id, aiSide, keys.keyOf(pokemon.side.id, pokemon.name));
}
export const slotOfPokemon = (pokemon: Pokemon, aiSide: SideID): DoublesSlotId => slotAt(pokemon.side.id, pokemon.position, aiSide);

const isTypeChanger = (ability: string) => ability === "protean" || ability === "libero";
const typeChangerUsed = (pokemon: Pokemon) => !!(pokemon.abilityState as Record<string, unknown>)[pokemon.ability];

/** The engine build of a simulator Pokémon (sim design §7.3): current form, ability, item, stages, HP, status. */
export function liveBuild(pokemon: Pokemon, runtime: BattleRuntime): BattleBuild | null {
  const speciesId = pokemon.species.id;
  if (!runtime.speciesById.has(speciesId)) return null;
  const base = createBuild(speciesId, runtime);
  if (base.game !== "champions") return null;
  const v = pokemon.volatiles;
  const abilityActive = pokemon.ability === "flashfire" ? !!v.flashfire : pokemon.ability === "unburden" ? !!v.unburden
    : pokemon.ability === "slowstart" ? !!v.slowstart
    // Protean / Libero: "active" = unused (app/lib/battle/model.ts:67-68). Showdown flags a use on the ability's state
    // (PS/data/abilities.ts:3497-3507, 2318-2328), which switch-in and Mega Evolution replace (PS/sim/pokemon.ts:423, 1925).
    : isTypeChanger(pokemon.ability) ? !typeChangerUsed(pokemon) : false;
  const fallen = Number((pokemon.abilityState as { fallen?: number }).fallen ?? 0);
  // Trace keeps "trace" with the copied ability beside it (types.ts tracedAbility; model.ts validates it so).
  const traced = pokemon.baseAbility === "trace" && pokemon.ability !== "trace";
  return {
    ...base, speciesId, nature: pokemon.set.nature || "Serious", abilityId: traced ? "trace" : pokemon.ability, abilityActive,
    ...(traced ? { tracedAbility: pokemon.ability } : {}),
    itemId: pokemon.item,
    boosts: { atk: pokemon.boosts.atk, def: pokemon.boosts.def, spa: pokemon.boosts.spa, spd: pokemon.boosts.spd, spe: pokemon.boosts.spe },
    currentHP: pokemon.hp === pokemon.maxhp ? null : pokemon.hp,
    status: (pokemon.status || "") as BattleBuild["status"],
    points: { hp: pokemon.set.evs.hp, atk: pokemon.set.evs.atk, def: pokemon.set.evs.def, spa: pokemon.set.evs.spa, spd: pokemon.set.evs.spd, spe: pokemon.set.evs.spe },
    configuration: { gender: pokemon.gender || "N" },
    ...(pokemon.ability === "supremeoverlord" ? { faintedAllies: Math.min(5, fallen) } : {}),
  };
}

function sideConditions(battle: ClonedBattle, side: SideID, base: SideConditions): SideConditions {
  const has = (id: string) => !!battle[side].sideConditions[id];
  return { ...base, reflect: has("reflect"), lightScreen: has("lightscreen"), auroraVeil: has("auroraveil"), tailwind: has("tailwind") };
}
/** Engine field: attackerSide is the player's side ("own"), defenderSide the AI's ("opponent"). */
export function fieldConditions(battle: ClonedBattle, aiSide: SideID): BattleConditions {
  const other: SideID = aiSide === "p1" ? "p2" : "p1";
  const field = createConditions();
  const pseudo = battle.field.pseudoWeather;
  return {
    ...field, gameType: "Doubles",
    weather: WEATHER[battle.field.weather] ?? "", terrain: TERRAIN[battle.field.terrain] ?? "",
    gravity: !!pseudo.gravity, trickRoom: !!pseudo.trickroom, wonderRoom: !!pseudo.wonderroom, magicRoom: !!pseudo.magicroom,
    attackerSide: sideConditions(battle, other, field.attackerSide), defenderSide: sideConditions(battle, aiSide, field.defenderSide),
  };
}
/** Turns left as the battle stands (its countdown for this turn not applied yet). */
export function fieldClock(battle: ClonedBattle, aiSide: SideID): FieldClock {
  const other: SideID = aiSide === "p1" ? "p2" : "p1";
  const turns = (state: { duration?: number } | undefined) => (state ? Number(state.duration ?? 0) : 0);
  const sideClock = (side: SideID): FieldClock["sides"]["own"] => {
    const conditions = battle[side].sideConditions;
    return {
      tailwind: turns(conditions.tailwind), reflect: turns(conditions.reflect), lightScreen: turns(conditions.lightscreen),
      auroraVeil: turns(conditions.auroraveil), safeguard: turns(conditions.safeguard), stealthRock: !!conditions.stealthrock,
      spikes: Math.min(3, Number(conditions.spikes?.layers ?? 0)) as 0 | 1 | 2 | 3,
      toxicSpikes: Math.min(2, Number(conditions.toxicspikes?.layers ?? 0)) as 0 | 1 | 2, stickyWeb: !!conditions.stickyweb,
    };
  };
  const weather = WEATHER[battle.field.weather];
  const terrain = TERRAIN[battle.field.terrain];
  const pseudo = battle.field.pseudoWeather;
  return {
    weather: weather ? { id: weather, turns: battle.field.weatherState.duration ? Number(battle.field.weatherState.duration) : null } : null,
    terrain: terrain ? { id: terrain, turns: Number(battle.field.terrainState.duration ?? 0) } : null,
    rooms: { trickRoom: turns(pseudo.trickroom), gravity: turns(pseudo.gravity), magicRoom: turns(pseudo.magicroom), wonderRoom: turns(pseudo.wonderroom) },
    sides: { own: sideClock(other), opponent: sideClock(aiSide) },
  };
}

function contextsOf(pokemon: Pokemon, battle: ClonedBattle): Record<string, MoveContext> {
  const contexts: Record<string, MoveContext> = {};
  const side = battle[pokemon.side.id];
  for (const slot of pokemon.moveSlots) {
    if (slot.id === "ragefist") contexts.ragefist = { timesHit: Math.min(6, pokemon.timesAttacked) };
    if (slot.id === "lastrespects") contexts.lastrespects = { fainted: Math.min(5, side.totalFainted) };
    if (slot.id === "stompingtantrum" || slot.id === "temperflare") contexts[slot.id] = { doubled: pokemon.moveLastTurnResult === false };
    if (slot.id === "beatup") contexts.beatup = { party: side.pokemon.filter((each) => each !== (pokemon as unknown) && !each.fainted && !each.status).map((each) => each.species.id) };
  }
  return contexts;
}

export type BridgeResult =
  | { kind: "engine"; input: DoublesTurnInput; keys: Record<DoublesSlotId, MonKey | null>; notes: string[] }
  | { kind: "rollout"; reasons: string[] };

/**
 * The engine input for `cell` on `battle`. `switched`: slots whose Pokémon switched this turn (the prelude ran their
 * entries; they take no action). `afterPrelude`: the battle is a prelude clone. Any state the engine does not model
 * is a rollout with its reasons.
 */
export function bridgeTurn(battle: ClonedBattle, cell: CellActions, ctx: { runtime: BattleRuntime; keys: MemberKeys; aiSide: SideID; switched: ReadonlySet<DoublesSlotId> }): BridgeResult {
  const { runtime, keys, aiSide, switched } = ctx;
  const reasons = new Set<string>();
  const notes: string[] = [];
  const action = (slot: DoublesSlotId): SlotAction | undefined => (slot.startsWith("own") ? cell.own : cell.opponent)[slot];
  const anySwitch = DOUBLES_SLOTS.some((slot) => action(slot)?.kind === "switch");

  // Field guards.
  if (battle.field.weather && !WEATHER[battle.field.weather]) reasons.add(`Weather ${battle.field.weather} is not modelled.`);
  for (const id of Object.keys(battle.field.pseudoWeather)) if (!ROOMS.has(id)) reasons.add(`Field effect ${id} is not modelled.`);
  for (const side of ["p1", "p2"] as const) {
    for (const id of Object.keys(battle[side].sideConditions)) if (!MAPPED_SIDE.has(id) && !IGNORED_SIDE.has(id)) reasons.add(`Side effect ${id} is not modelled.`);
  }

  const pokemon = {} as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const slotKeys = {} as Record<DoublesSlotId, MonKey | null>;
  for (const slot of DOUBLES_SLOTS) {
    const { side, position } = showdownPosition(slot, aiSide);
    const mon = battle[side].active[position] as Pokemon | null;
    if (!mon || mon.fainted) { pokemon[slot] = null; slotKeys[slot] = null; continue; }
    slotKeys[slot] = keyOfPokemon(mon, aiSide, keys);
    const build = liveBuild(mon, runtime);
    if (!build) { reasons.add(`${mon.species.name} is not in the engine's catalog.`); pokemon[slot] = null; continue; }
    for (const id of Object.keys(mon.volatiles)) if (!IGNORED_VOLATILES.has(id)) reasons.add(`${mon.name}: ${id} is not modelled.`);
    if (NOT_MODELLED_ABILITIES.has(mon.ability)) reasons.add(`${mon.name}: ${mon.ability} is not modelled.`);
    // The engine takes Protean / Libero only unused, with the species' own typing (app/lib/battle/model.ts:398-399).
    if (isTypeChanger(mon.ability) && typeChangerUsed(mon)) reasons.add(`${mon.name}: ${mon.ability} was used this stint.`);
    // Skill Swap, Role Play, Entrainment, Worry Seed: an ability its form does not have (the engine validates abilities by species).
    if (build.abilityId !== "trace" && !runtime.speciesById.get(build.speciesId)?.abilities.includes(build.abilityId)) reasons.add(`${mon.name}: its ability was changed (${build.abilityId}).`);
    if (mon.transformed) reasons.add(`${mon.name} is transformed.`);
    if (mon.illusion) reasons.add(`${mon.name} has an Illusion.`);
    let doubles: DoublesPokemonInput["action"] = { moveId: null, target: null };
    const chosen = action(slot);
    if (chosen?.kind === "move" && !switched.has(slot)) {
      const moveId = chosen.moveId;
      if (moveId === "recharge") doubles = { moveId: null, target: null };
      else if (moveId === "struggle" || moveId === "sleeptalk") reasons.add(`${mon.name}: ${moveId} is not modelled.`);
      else {
        const species = runtime.speciesById.get(mon.species.id);
        const learnable = species?.moves.includes(moveId) || runtime.speciesById.get(mon.baseSpecies.id)?.moves.includes(moveId);
        if (!runtime.movesById.has(moveId) || !learnable) reasons.add(`${mon.name}: ${moveId} is not in its catalog moves.`);
        if (mon.volatiles.mustrecharge) reasons.add(`${mon.name} must recharge.`);
        if (FIRST_TURN_ONLY.has(moveId) && mon.activeMoveActions > 0) {
          notes.push(`${runtime.movesById.get(moveId)?.name ?? moveId} fails: not its first turn.`);
          doubles = { moveId: null, target: null };
        } else {
          doubles = { moveId, target: chosen.target };
          if (moveId === "payback" && chosen.target && switched.has(chosen.target)) reasons.add("Payback into a Pokémon that switched in.");
          if (mon.ability === "analytic" && anySwitch) reasons.add("Analytic with a switch this turn.");
        }
      }
    }
    const contexts = contextsOf(mon, battle);
    if (doubles.moveId && FIRST_IN_A_SWITCHED_SLOT.has(doubles.moveId) && doubles.target && switched.has(doubles.target)) {
      contexts[doubles.moveId] = { ...contexts[doubles.moveId], turnOrder: "first" };
    }
    pokemon[slot] = { build, contexts, charged: !!mon.volatiles.charge, action: doubles };
  }
  if (reasons.size) return { kind: "rollout", reasons: [...reasons] };
  const input: DoublesTurnInput = { runtime, field: fieldConditions(battle, aiSide), pokemon };
  // Targets as the engine takes them for each move's rule (non-"choose" rules: none; an absent target: the first option).
  for (const slot of DOUBLES_SLOTS) {
    const entry = pokemon[slot];
    if (!entry?.action.moveId) continue;
    const rule = doublesTargetRule(input, slot, entry.action.moveId);
    if (rule.kind !== "choose") entry.action = { ...entry.action, target: null };
    else if (!entry.action.target || !rule.options.includes(entry.action.target)) entry.action = { ...entry.action, target: rule.options[0] ?? null };
  }
  return { kind: "engine", input, keys: slotKeys, notes };
}

/** World 0's start state with every action "No move" (damage rows and worth). */
export function startInput(battle: ClonedBattle, ctx: { runtime: BattleRuntime; aiSide: SideID }): DoublesTurnInput {
  const pokemon = {} as Record<DoublesSlotId, DoublesPokemonInput | null>;
  for (const slot of DOUBLES_SLOTS) {
    const { side, position } = showdownPosition(slot, ctx.aiSide);
    const mon = battle[side].active[position] as Pokemon | null;
    const build = mon && !mon.fainted ? liveBuild(mon, ctx.runtime) : null;
    pokemon[slot] = mon && build ? { build, contexts: contextsOf(mon, battle), charged: !!mon.volatiles.charge, action: { moveId: null, target: null } } : null;
  }
  return { runtime: ctx.runtime, field: fieldConditions(battle, ctx.aiSide), pokemon };
}

/** Does any position of either joint action switch or Mega Evolve (a prelude is needed)? */
export function needsPrelude(cell: CellActions): boolean {
  return [cell.own, cell.opponent].some((joint: JointAction) => Object.values(joint).some((each) => each?.kind === "switch" || (each?.kind === "move" && !!each.mega)));
}
