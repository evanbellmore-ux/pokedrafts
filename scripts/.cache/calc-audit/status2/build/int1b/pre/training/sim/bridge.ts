// A belief battle (or a prelude clone stopped before the first move) → the 2v2 turn engine's input for one cell
// (SPEC §9.4 "Bridge" and "Guards"). Engine orientation: "own" is the player (the other side of the AI's seat),
// "opponent" is the AI. Prototypes: scripts/.cache/training/design/probe/{bridge-probe.ts,prelude-probe.ts}.
import { CHARGE_TURN_MOVES, SEMI_INVULNERABLE_MOVES } from "@/app/lib/battle/doubles-actions";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { DOUBLES_SLOTS, slotSide, type DoublesCarried, type DoublesPokemonInput, type DoublesSideId, type DoublesSlotId, type DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { createBuild, createConditions, getBuildStats, validateBuild } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext, SideConditions } from "@/app/lib/battle/types";
import { BERSERK_BERRIES, CANT_SUPPRESS } from "@/app/lib/battle/hit-loop";
import { intimidatedKey } from "@/app/lib/battle/intimidate";
import { ENTRY_ABILITIES } from "@/app/lib/battle/uses-to-ko";
import type { CellActions, FieldClock, MonKey } from "../model/ai-view";
import { showdownPosition, slotAt } from "../model/positions";
import type { PublicMon } from "../model/public-state";
import type { SideID } from "../model/showdown-types";
import type { JointAction, SlotAction } from "../model/view-types";
import type { MemberKeys } from "./choices";
import type { ClonedBattle, Pokemon } from "./sim";
import { CHOOSABLE_TARGETS } from "./choices";
import { countsOf, PROTECT_FAMILY, type SubstituteVolatile } from "./tracker";

export const WEATHER: Record<string, BattleConditions["weather"]> = {
  sunnyday: "Sun", raindance: "Rain", sandstorm: "Sand", snowscape: "Snow", hail: "Hail",
  desolateland: "Harsh Sunshine", primordialsea: "Heavy Rain", deltastream: "Strong Winds",
};
export const TERRAIN: Record<string, BattleConditions["terrain"]> = {
  electricterrain: "Electric", grassyterrain: "Grassy", mistyterrain: "Misty", psychicterrain: "Psychic",
};
/**
 * Volatiles with no effect the engine reads (status-eot SPEC §6): legality the request already applies (choicelock,
 * lockedmove, Torment, Throat Chop, Imprison, C8), counters (stall: the public streak, below; Laser Focus), this turn's
 * protection and redirection, what the build carries (Charge, Flash Fire, Unburden, Slow Start), trapping (no switch in
 * the turn).
 */
const IGNORED_VOLATILES: ReadonlySet<string> = new Set([
  "charge", "flashfire", "unburden", "slowstart", "choicelock", "lockedmove", "torment", "throatchop",
  "trapper", "stall", "laserfocus", "imprison", "protect", "helpinghand", "followme", "ragepowder", "endure",
]);
/**
 * Volatiles mapped into the engine input (DoublesCarried and the build): the end of turn and the moves read them. status2
 * T1 (SPEC2 §6): Stockpile, Power Trick, Power Shift, No Retreat, Minimize, Gastro Acid, Attract, Octolock, Heal Block,
 * Glaive Rush, and trapped (No Retreat reads it). status2 T2 (ADDENDUM2 §6): the recharge, Destiny Bond, Taunt, Encore and
 * Disable with their turns, Uproar, Lock-On, a charged two-turn move (twoturnmove, and the move's own volatile beside it),
 * and A2's Tar Shot, Foresight, Miracle Eye, Telekinesis, Embargo and Nightmare.
 */
const MAPPED_VOLATILES: ReadonlySet<string> = new Set([
  "confusion", "leechseed", "yawn", "perishsong", "partiallytrapped", "saltcure", "aquaring", "ingrain", "curse", "syrupbomb", "focusenergy", "dragoncheer",
  "substitute", "allyswitch",
  "stockpile", "powertrick", "powershift", "noretreat", "minimize", "gastroacid", "attract", "octolock", "healblock", "glaiverush", "trapped",
  "mustrecharge", "destinybond", "taunt", "encore", "disable", "uproar", "lockon", "twoturnmove",
  "tarshot", "foresight", "miracleeye", "telekinesis", "embargo", "nightmare",
]);
/** status2 T2: Safeguard, Mist and Lucky Chant from an earlier turn go into the side conditions (T2E §4.6.1). */
const MAPPED_SIDE: ReadonlySet<string> = new Set(["reflect", "lightscreen", "auroraveil", "tailwind", "safeguard", "mist", "luckychant"]);
const IGNORED_SIDE: ReadonlySet<string> = new Set(["spikes", "toxicspikes", "stealthrock", "stickyweb"]);
const ROOMS: ReadonlySet<string> = new Set(["trickroom", "gravity", "wonderroom", "magicroom", "fairylock"]);
const NOT_MODELLED_ABILITIES: ReadonlySet<string> = new Set([...Object.keys(ENTRY_ABILITIES), "download", "protosynthesis", "quarkdrive"]);
/**
 * status2 T2: the carried volatiles a working Mental Herb cures at its holder's Update (pinned data/items.ts mentalherb
 * onUpdate; Torment too, which the engine does not carry): a belief world holding the herb beside one is not a battle state
 * (the engine's "Mental Herb would have cured it." issue), so the cell is a rollout.
 */
const MENTAL_HERB_CURES: readonly [string, string][] = [["attract", "its infatuation"], ["taunt", "its Taunt"], ["encore", "its Encore"], ["disable", "its Disable"], ["healblock", "its Heal Block"]];
/** status2 Step 1 #11 (C19): pinned statsRaisedThisTurn, statsLoweredThisTurn, usedItemThisTurn before the first move. */
export type EarlierThisTurn = { statsRaised?: true; statsLowered?: true; usedItem?: true };

export const monKey = (side: SideID, aiSide: SideID, memberKey: string): MonKey => `${side === aiSide ? "opponent" : "own"}:${memberKey}`;
export function keyOfPokemon(pokemon: Pokemon, aiSide: SideID, keys: MemberKeys): MonKey {
  return monKey(pokemon.side.id, aiSide, keys.keyOf(pokemon.side.id, pokemon.name));
}
export const slotOfPokemon = (pokemon: Pokemon, aiSide: SideID): DoublesSlotId => slotAt(pokemon.side.id, pokemon.position, aiSide);

const isTypeChanger = (ability: string) => ability === "protean" || ability === "libero";
const typeChangerUsed = (pokemon: Pokemon) => !!(pokemon.abilityState as Record<string, unknown>)[pokemon.ability];

/** The terrain's type Mimicry gives (pinned data/abilities.ts mimicry onTerrainChange). */
const MIMICRY_TYPES: Record<string, string> = { electricterrain: "Electric", grassyterrain: "Grass", mistyterrain: "Fairy", psychicterrain: "Psychic" };
const COMBAT: readonly ("atk" | "def" | "spa" | "spd" | "spe")[] = ["atk", "def", "spa", "spd", "spe"];
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((each, i) => each === b[i]);

/**
 * The engine build of a simulator Pokémon (sim design §7.3): current form, ability, item, stages, HP, status; and (status2
 * SPEC2 §6) the state as Showdown holds it where it is not its species' own: its types and added type (Soak, Magic Powder,
 * Reflect Type, Forest's Curse, Trick-or-Treat, Protean, Libero, Burn Up, Double Shock: the public typechange / typeadd lines
 * the belief battle replays; Mimicry's terrain type is the engine's own), its stored stats (Power Split, Guard Split, Speed
 * Swap, Power Trick, Transform: replayed from the public lines on the belief sets), its weight, an ability that is not its
 * species' (abilityChanged: Skill Swap, Role Play, Entrainment, Simple Beam, Worry Seed, Transform's copy), and a
 * transformed Pokémon as such (its target's species, stored stats and ability; its own HP and spread: transformedFrom).
 */
export function liveBuild(pokemon: Pokemon, runtime: BattleRuntime): BattleBuild | null {
  const speciesId = pokemon.species.id;
  const species = runtime.speciesById.get(speciesId);
  if (!species) return null;
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
  const traced = pokemon.baseAbility === "trace" && pokemon.ability !== "trace" && !pokemon.transformed;
  const build: BattleBuild = {
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
  // A transformed Pokémon battles as its target's species with its own spread and HP (types.ts transformedFrom).
  const own = pokemon.transformed ? runtime.speciesById.get(pokemon.baseSpecies.id) : undefined;
  if (pokemon.transformed && own) build.transformedFrom = { speciesId: own.id, baseHP: own.baseStats.hp };
  // Its types as they stand (setType; the added type apart), unless they are its species' or Mimicry's for the terrain.
  const types = [...pokemon.types];
  const mimicry = pokemon.ability === "mimicry" ? (MIMICRY_TYPES[(pokemon as unknown as { battle: ClonedBattle }).battle?.field.terrain ?? ""] ?? null) : null;
  const mimicryTypes = mimicry ? [mimicry] : species.types;
  if (!sameList(types, species.types) && !(pokemon.ability === "mimicry" && sameList(types, mimicryTypes))) build.types = types;
  const added = (pokemon as unknown as { addedType?: string }).addedType;
  if (added === "Grass" || added === "Ghost") build.addedType = added;
  // Stored stats that are not this form's own (with a transformed one's always: its target's).
  const stats = getBuildStats({ ...build, storedStats: undefined, transformedFrom: undefined }, runtime);
  const stored = pokemon.storedStats;
  if (pokemon.transformed || !stats || COMBAT.some((stat) => stats[stat] !== stored[stat])) build.storedStats = { atk: stored.atk, def: stored.def, spa: stored.spa, spd: stored.spd, spe: stored.spe };
  const weighthg = (pokemon as unknown as { weighthg?: number }).weighthg;
  if (weighthg !== undefined && weighthg !== (pokemon.species as unknown as { weighthg?: number }).weighthg) build.weighthg = weighthg;
  // An ability its form does not have (Skill Swap, Role Play, Entrainment, Simple Beam, Worry Seed, a transformed copy).
  if (!traced && !species.abilities.includes(build.abilityId)) build.abilityChanged = true;
  return build;
}

function sideConditions(battle: ClonedBattle, side: SideID, base: SideConditions): SideConditions {
  const has = (id: string) => !!battle[side].sideConditions[id];
  return {
    ...base, reflect: has("reflect"), lightScreen: has("lightscreen"), auroraVeil: has("auroraveil"), tailwind: has("tailwind"),
    // status2 T2 (T2E §4.6.1, §4.6.3): Safeguard, Mist and Lucky Chant from an earlier turn (public -sidestart lines).
    ...(has("safeguard") ? { safeguard: true } : {}), ...(has("mist") ? { mist: true } : {}), ...(has("luckychant") ? { luckyChant: true } : {}),
  };
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
 * Whether sim/splits.ts forks a sleeping or frozen Pokémon's BeforeMove into weighted engine inputs. It no longer does:
 * the engine's own BeforeMove takes the sleep and freeze counts (status-eot SPEC §6: carried.sleep, carried.freeze from
 * the public counts), and splits.ts keeps only Protect.
 */
export const SPLITS_BRANCH_SLEEP = false;

/** The engine slot a Showdown slot id ("p2a") stands for. */
function slotOfShowdown(id: unknown, aiSide: SideID): DoublesSlotId | null {
  const match = /^(p[12])([ab])$/.exec(String(id ?? ""));
  return match ? slotAt(match[1] as SideID, match[2] === "a" ? 0 : 1, aiSide) : null;
}
type Effect = Record<string, unknown> & { duration?: number; source?: Pokemon; sourceSlot?: string };
const effectOf = (mon: Pokemon, id: string) => (mon.volatiles as Record<string, Effect | undefined>)[id];

/**
 * A Pokémon's state from earlier turns as the engine takes it (status-eot SPEC §6, ADDENDUM §6). From the public counts
 * (`pub`, sim/tracker.ts): turns lost to sleep (cant lines) and Rest, Champions turns lost to freeze, confusion's
 * attempts (-activate lines) and Axe Kick, bad poison's ticks this stint. From the belief battle, exact per belief
 * world: Leech Seed's position, a partial trap that still damages now (its source in, Binding Band), Salt Cure, Aqua
 * Ring, Ingrain, Curse, Syrup Bomb (its source in), a Yawn landing now, the perish count, a Wish or a Future Sight landing
 * on its position now, Cud Chew's Berry due now, a Substitute no hit has met (its maker's quarter), the Ally Switch counter.
 * What the engine cannot take is a rollout reason.
 */
function carriedOf(battle: ClonedBattle, mon: Pokemon, slot: DoublesSlotId, pub: PublicMon | null, aiSide: SideID, reasons: Set<string>, runtime: BattleRuntime): DoublesCarried {
  const carried: DoublesCarried = {};
  const name = mon.name;
  const foe = (other: DoublesSlotId | null) => !!other && slotSide(other) !== slotSide(slot);
  const counted = (what: string) => { if (!pub) reasons.add(`${name}: ${what} needs the public counts.`); return !!pub; };
  if (SPLITS_BRANCH_SLEEP) {
    // sim/splits.ts forks this BeforeMove (asleep: No move; awake: no status), and the engine would branch the asleep
    // world's own BeforeMove again: a sleep it cannot wake from at once (no turn counted, no Early Bird) is exact; the rest
    // are rollouts.
    if (mon.status === "frz") reasons.add(`${name} is frozen: the turn's thaw is split before the engine.`);
    if (mon.status === "slp" && mon.ability === "earlybird") reasons.add(`${name} is asleep with Early Bird: the turn's wake is split before the engine.`);
  } else {
    if (mon.status === "slp" && counted("its sleep")) carried.sleep = { attempts: pub!.statusElapsed, rest: !!countsOf(pub!).restSleep };
    if (mon.status === "frz") carried.freeze = { attempts: pub ? pub.statusElapsed : Math.max(0, 3 - Number(mon.statusState.time ?? 3)) };
  }
  if (mon.status === "tox") carried.toxic = Math.min(15, pub ? pub.statusElapsed : Number(mon.statusState.stage ?? 0));
  if (mon.volatiles.confusion && counted("its confusion")) {
    const shown = pub!.volatiles.find((each) => each.id === "confusion");
    carried.confusion = { attempts: shown?.elapsed ?? 0, ...(shown?.moveId === "axekick" ? { axeKick: true as const } : {}) };
  }
  const seed = effectOf(mon, "leechseed");
  if (seed) {
    // Leech Seed heals whoever stands at the seeder's position (pinned data/moves.ts leechseed getAtSlot(sourceSlot)); an
    // empty position heals no one and the seeded loses nothing (it returns first).
    const at = slotOfShowdown(seed.sourceSlot, aiSide);
    const { side, position } = at ? showdownPosition(at, aiSide) : { side: "p1" as SideID, position: 0 };
    const there = at ? battle[side].active[position] as Pokemon | null : null;
    // status2 T2 (C32): an ally's seed too (the engine heals whoever stands at the seeder's position); a seed whose
    // position the seeded Pokémon itself now holds (an Ally Switch since) drains into itself, which the engine refuses.
    if (at && there && !there.fainted) {
      if (at === slot) reasons.add(`${name}: Leech Seed draining into its own position is not modelled.`);
      else carried.leechSeed = at;
    }
  }
  const trap = effectOf(mon, "partiallytrapped");
  if (trap) {
    // It ends at this end of turn without damage when its countdown runs out or its source is gone (data/conditions.ts partiallytrapped).
    const source = trap.source;
    const effect = String((trap.sourceEffect as { id?: string } | undefined)?.id ?? "");
    if (effect === "gmaxcentiferno" || effect === "gmaxsandblast") reasons.add(`${name}: a G-Max trap is not modelled.`);
    else if (Number(trap.duration ?? 0) > 1 && source && source.isActive && !source.fainted && source.hp > 0) {
      // status2 T2 (C32): an ally's trap too.
      const at = slotOfPokemon(source, aiSide);
      // The move that set it names the residual (its -activate line is public; effects.ts builds the volatile from it).
      carried.trap = { source: at, bindingBand: Number(trap.boundDivisor) === 6, ...(runtime.movesById.has(effect) ? { move: effect } : {}) };
    }
  }
  if (mon.volatiles.saltcure) carried.saltCure = true;
  if (mon.volatiles.aquaring) carried.aquaRing = true;
  if (mon.volatiles.ingrain) carried.ingrain = true;
  if (mon.volatiles.curse) carried.curse = true;
  const syrup = effectOf(mon, "syrupbomb");
  // status2 T2 (C32): an ally's Syrup Bomb too.
  if (syrup?.source && syrup.source.isActive && !syrup.source.fainted && Number(syrup.duration ?? 0) > 1) carried.syrupBomb = slotOfPokemon(syrup.source, aiSide);
  const yawn = effectOf(mon, "yawn");
  if (yawn && Number(yawn.duration ?? 0) <= 1) carried.yawn = true;
  const perish = effectOf(mon, "perishsong");
  if (perish) carried.perish = Math.max(1, Math.min(3, Number(perish.duration ?? 3))) as 1 | 2 | 3;
  // Slot conditions at its position (a Wish, a Future Sight), landing at this end of turn (pinned sim/battle.ts
  // getOverflowedTurnCount: the turn less one, modulo 256 from generation 8). A Wish lands once that count is past its
  // startingTurn (data/moves.ts wish onResidual); a Future Sight once it reaches its endingTurn, set to (turn − 1) + 2 at
  // its use (data/conditions.ts futuremove onResidual): two turns after the turn it was used.
  const overflowed = (battle.turn - 1) % 256;
  const conditions = (battle[mon.side.id].slotConditions[mon.position] ?? {}) as Record<string, Effect>;
  const wish = conditions.wish;
  if (wish && overflowed > Number(wish.startingTurn ?? 0)) carried.wish = Math.max(1, Math.trunc(Number(wish.hp ?? 0)));
  const future = conditions.futuremove;
  if (future && overflowed >= Number(future.endingTurn ?? Infinity)) {
    // status2 T2 (ADDENDUM2 §6, C33): with its user (the -start line's Pokémon, effectState.source): its slot when it is in
    // battle, else the user as it is now (pinned futuremove onEnd: data.source; out of battle its ability and item do not
    // count, sim/pokemon.ts ignoringAbility / ignoringItem, nor its stages, cleared as it left; its HP is not read).
    const move = String(future.move ?? "futuresight");
    const source = future.source as Pokemon | undefined;
    const away = source && !(source.isActive && !source.fainted) ? liveBuild(source, runtime) : null;
    const user = away && !validateBuild({ ...away, currentHP: null }, runtime).length ? { ...away, currentHP: null } : null;
    // A user whose build the engine would refuse stays a bare id (the engine's end of turn is then not estimated).
    carried.futureMove = move !== "futuresight" && move !== "doomdesire" ? move
      : source?.isActive && !source.fainted ? { move, source: slotOfPokemon(source, aiSide) }
      : user ? { move, build: user } : move;
  }
  // Cud Chew's Berry due at this end of turn (status2 Step 1 #16, T2E finding 3): from the tracker's public eat line
  // (PublicCounts.cudChew; the belief battle builds ability states fresh, then restores it from the same record with counter
  // 1), or one the prelude's clone ate. status2 T2 (T2E §4.2.3): the Berry by its id (the ability state's), so E2 re-eats it.
  const chew = mon.abilityState as { berry?: { id?: string } | string; counter?: number };
  if (mon.ability === "cudchew" && chew.berry && Number(chew.counter ?? 0) <= 1) {
    const berry = typeof chew.berry === "string" ? chew.berry : String(chew.berry.id ?? "");
    carried.cudChew = runtime.itemsById.has(berry) ? berry : true;
  }
  const sub = effectOf(mon, "substitute");
  if (sub) {
    const shown = pub?.volatiles.find((each) => each.id === "substitute") as SubstituteVolatile | undefined;
    if (!shown || (shown.hits ?? 0) > 0 || !shown.sourceKey) reasons.add(`${name}: its Substitute's HP after a hit is not public.`);
    else carried.substitute = Math.max(1, Number(sub.hp ?? 1));
  }
  // status2 Step 1 #8 (F4 F4): accuracy and evasion stages from earlier turns (public: -boost and -unboost lines; the belief
  // battle replays them). Stored Power, Power Trip and Punishment reading a positive one are not estimated in the engine (a rollout).
  const accuracy = Number(mon.boosts.accuracy ?? 0), evasion = Number(mon.boosts.evasion ?? 0);
  if (accuracy || evasion) carried.stages = { ...(accuracy ? { accuracy } : {}), ...(evasion ? { evasion } : {}) };
  const ally = effectOf(mon, "allyswitch");
  if (ally && Number(ally.counter ?? 0) >= 3) carried.allySwitch = Math.min(729, Number(ally.counter)) as DoublesCarried["allySwitch"];
  // ---- status2 T1 (SPEC2 §6): the A1, A2 and D states from earlier turns, each from a public line the belief battle replays ----
  // Stockpile: its layers and the counts its End reverses (tracker.ts StockpileVolatile, the -boost lines of each use).
  const pile = effectOf(mon, "stockpile");
  if (pile) {
    const layers = Math.max(1, Math.min(3, Number(pile.layers ?? 1))) as 1 | 2 | 3;
    carried.stockpile = { layers, def: Number(pile.def ?? -layers), spd: Number(pile.spd ?? -layers) };
  }
  if (mon.volatiles.powertrick) carried.powerTrick = true;
  if (mon.volatiles.powershift) carried.powerShift = true;
  if (mon.volatiles.noretreat) carried.noRetreat = true;
  if (mon.volatiles.minimize) carried.minimize = true;
  // Gastro Acid fails on a cantsuppress ability (data/moves.ts gastroacid onTryHit): one this belief world gives it is not
  // the one it had, and the engine refuses the pair.
  if (mon.volatiles.gastroacid && CANT_SUPPRESS.has(mon.ability)) reasons.add(`${name}: Gastro Acid on ${runtime.abilitiesById.get(mon.ability)?.name ?? mon.ability} is not modelled.`);
  else if (mon.volatiles.gastroacid) carried.gastroAcid = true;
  if (mon.volatiles.trapped) carried.trapped = true;
  if (mon.volatiles.glaiverush) carried.glaiveRush = true;
  // Heal Block (Psychic Noise 2 turns, Heal Block 5: effects.ts from the public use): turns left before this end of turn.
  const block = effectOf(mon, "healblock");
  if (block) carried.healBlock = Math.max(1, Math.min(4, Number(block.duration ?? 1))) as 1 | 2 | 3 | 4;
  // Attract: its source, which is in battle (Attract's Update ends it once the source leaves: data/moves.ts attract onUpdate).
  const love = effectOf(mon, "attract");
  if (love) {
    if (love.source && love.source.isActive && !love.source.fainted) carried.attract = slotOfPokemon(love.source, aiSide);
    else reasons.add(`${name}: its infatuation's source is not in battle.`);
  }
  // Octolock: its user (the -start line's [of]). With its user gone, or in battle for no turn yet, it ends at this end of
  // turn's order 14 with no drop and traps no one in the turn (data/moves.ts octolock onResidual, onTrapPokemon): nothing.
  const lock = effectOf(mon, "octolock");
  if (lock?.source && lock.source.isActive && !lock.source.fainted && lock.source.hp > 0 && lock.source.activeTurns > 0) {
    const at = slotOfPokemon(lock.source, aiSide);
    if (!foe(at)) reasons.add(`${name}: Octolock from an ally is not modelled.`);
    else carried.octolock = at;
  }
  // Berserk / Anger Shell's Berry lock, Ripen's weakened Berry, Opportunist's pending copy: the belief battle's ability
  // state (belief-battle.ts abilityStateOf, from the public lines). Gastro Acid suppresses each (the engine's stand-in).
  const state = mon.abilityState as Record<string, unknown>;
  const counts = pub ? countsOf(pub) : null;
  if (!mon.volatiles.gastroacid) {
    const flag = mon.ability === "berserk" ? "checkedBerserk" : mon.ability === "angershell" ? "checkedAngerShell" : null;
    if (flag && BERSERK_BERRIES.has(mon.item)) {
      if (state[flag] === false) carried.berryLocked = true;
      else if (counts?.berserk?.kind === "unknown") reasons.add(`${name}: whether ${runtime.itemsById.get(mon.item)?.name ?? mon.item} is locked by ${runtime.abilitiesById.get(mon.ability)?.name ?? mon.ability} is not known.`);
    }
    if (mon.ability === "ripen" && state.berryWeaken === true) carried.berryWeaken = true;
    const boosts = mon.ability === "opportunist" ? state.boosts as Partial<Record<string, number>> | undefined : undefined;
    const copy = Object.fromEntries(Object.entries(boosts ?? {}).filter(([, amount]) => (amount ?? 0) > 0));
    if (Object.keys(copy).length) carried.copy = copy as DoublesCarried["copy"];
  }
  // ---- status2 T2 (ADDENDUM2 §6): the N, H, CL and A2 states from earlier turns, each from a public line the belief battle replays ----
  // The recharge (the -mustrecharge line; its action is No move), Destiny Bond still up (-singlemove, until its next move).
  if (mon.volatiles.mustrecharge) carried.mustRecharge = true;
  if (mon.volatiles.destinybond) carried.destinyBond = true;
  // Taunt, Encore and Disable: turns left before this end of turn's countdown (effects.ts: each condition's duration from
  // its public start, PS/data/moves.ts taunt, encore, disable onStart).
  const turnsOf = (id: string, most: number) => Math.max(1, Math.min(most, Number(effectOf(mon, id)?.duration ?? 1)));
  if (mon.volatiles.taunt) carried.taunt = turnsOf("taunt", 3) as 1 | 2 | 3;
  const encore = effectOf(mon, "encore");
  if (encore && runtime.movesById.has(String(encore.move ?? ""))) carried.encore = { move: String(encore.move), turns: turnsOf("encore", 3) as 1 | 2 | 3 };
  else if (encore) reasons.add(`${name}: its Encore's move is not known.`);
  const disable = effectOf(mon, "disable");
  if (disable && runtime.movesById.has(String(disable.move ?? ""))) carried.disable = { move: String(disable.move), turns: turnsOf("disable", 4) as 1 | 2 | 3 | 4 };
  else if (disable) reasons.add(`${name}: its disabled move is not known.`);
  // Uproar from an earlier turn: its turns left as this turn starts (3 from its start, data/moves.ts uproar condition).
  if (mon.volatiles.uproar) carried.uproar = turnsOf("uproar", 2) as 1 | 2;
  // Lock-On (or Mind Reader) at a Pokémon in battle (the volatile's source; one that left is no longer locked on).
  const lockOn = effectOf(mon, "lockon");
  if (lockOn?.source && lockOn.source.isActive && !lockOn.source.fainted && lockOn.source !== (mon as unknown)) carried.lockOn = slotOfPokemon(lockOn.source, aiSide);
  // A2's volatiles (none has a move in Champions): Tar Shot, Foresight, Miracle Eye, Nightmare; Telekinesis and Embargo's turns.
  if (mon.volatiles.tarshot) carried.tarShot = true;
  if (mon.volatiles.foresight) carried.foresight = true;
  if (mon.volatiles.miracleeye) carried.miracleEye = true;
  if (mon.volatiles.nightmare) carried.nightmare = true;
  if (mon.volatiles.telekinesis) carried.telekinesis = turnsOf("telekinesis", 2) as 1 | 2;
  if (mon.volatiles.embargo) carried.embargo = turnsOf("embargo", 4) as 1 | 2 | 3 | 4;
  // Generation 9's once-a-battle effects it has had (the belief battle's flags, from their public lines: tracker.ts
  // onceUsed); Battle Bond counts in Scarlet/Violet only (Champions rejects it: C22).
  const flags = mon as unknown as { bondTriggered?: boolean; swordBoost?: boolean; shieldBoost?: boolean; syrupTriggered?: boolean };
  const once: NonNullable<DoublesCarried["onceUsed"]>[number][] = [
    ...(flags.bondTriggered && runtime.profile.id === "scarlet_violet" ? ["battlebond" as const] : []),
    ...(flags.swordBoost ? ["intrepidsword" as const] : []), ...(flags.shieldBoost ? ["dauntlessshield" as const] : []),
    ...(flags.syrupTriggered ? ["supersweetsyrup" as const] : []),
  ];
  if (once.length) carried.onceUsed = once;
  // A working Mental Herb beside a volatile it cures is not a battle state (it cures at the holder's Update): a belief
  // world's item the public lines rule out.
  const herb = mon.item === "mentalherb" && !battle.field.pseudoWeather.magicroom && mon.ability !== "klutz" && !mon.volatiles.embargo;
  if (herb) for (const [id, what] of MENTAL_HERB_CURES) if (mon.volatiles[id]) reasons.add(`${name}: Mental Herb would have cured ${what}.`);
  return carried;
}

/**
 * The engine input for `cell` on `battle`. `switched`: slots whose Pokémon switched this turn (the prelude ran their
 * entries; they take no action: status2 Step 1 #14, DoublesPokemonInput.switchedIn). `afterPrelude`: the battle is a prelude
 * clone. `earlier` (status2 Step 1 #11, C19): what happened to each Pokémon earlier this turn before the moves (the prelude's
 * flags after its switches, and on the battle's first turn the leads' entry lines: services.ts earlierOf). Any state the
 * engine does not model is a rollout with its reasons.
 */
export function bridgeTurn(battle: ClonedBattle, cell: CellActions, ctx: {
  runtime: BattleRuntime; keys: MemberKeys; aiSide: SideID; switched: ReadonlySet<DoublesSlotId>;
  /** The tracker's public view of a Pokémon by key (services.ts publicOf): the counts carried state reads. */
  publicOf?: (key: MonKey) => PublicMon | null;
  earlier?: Partial<Record<DoublesSlotId, EarlierThisTurn>>;
}): BridgeResult {
  const { runtime, keys, aiSide, switched } = ctx;
  const reasons = new Set<string>();
  const notes: string[] = [];
  const action = (slot: DoublesSlotId): SlotAction | undefined => (slot.startsWith("own") ? cell.own : cell.opponent)[slot];

  // Field guards. (status2 T2: Magic Room, Gravity and the terrain ending this turn are the engine's: fieldTurns, below.)
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
    // (status2 T2: a charged two-turn move's own volatile beside twoturnmove is carried.charging's.)
    const chargingMove = String(effectOf(mon, "twoturnmove")?.move ?? "");
    for (const id of Object.keys(mon.volatiles)) if (!IGNORED_VOLATILES.has(id) && !MAPPED_VOLATILES.has(id) && id !== chargingMove) reasons.add(`${mon.name}: ${id} is not modelled.`);
    if (NOT_MODELLED_ABILITIES.has(mon.ability)) reasons.add(`${mon.name}: ${mon.ability} is not modelled.`);
    // status2 T1 (SPEC2 §6): a used Protean or Libero (with its public type), a changed ability (abilityChanged) and a
    // transformed Pokémon go to the engine as liveBuild gives them; the build check below rolls out what it does not take.
    if (mon.illusion) reasons.add(`${mon.name} has an Illusion.`);
    // Mimicry's types are the engine's own from the terrain (calculate.ts mimicryTypes): another type on it is not.
    if (mon.ability === "mimicry" && build.types) reasons.add(`${mon.name}: a type change on Mimicry is not modelled.`);
    let doubles: DoublesPokemonInput["action"] = { moveId: null, target: null };
    const chosen = action(slot);
    const pub = ctx.publicOf?.(slotKeys[slot]!) ?? null;
    if (chosen?.kind === "move" && !switched.has(slot)) {
      const moveId = chosen.moveId;
      // Recharge is the engine's own BeforeMove (status2 T2: carried.mustRecharge, priority 11, before confusion): No move.
      if (moveId === "recharge") doubles = { moveId: null, target: null };
      // status2 T2 (T2E §4.7.2): Struggle (the request's, when no move is left) is the engine's: a random foe, its recoil.
      else if (moveId === "struggle") doubles = { moveId, target: null };
      else {
        const species = runtime.speciesById.get(mon.species.id);
        const learnable = species?.moves.includes(moveId) || runtime.speciesById.get(mon.baseSpecies.id)?.moves.includes(moveId);
        if (!runtime.movesById.has(moveId) || !learnable) reasons.add(`${mon.name}: ${moveId} is not in its catalog moves.`);
        if (mon.volatiles.mustrecharge) reasons.add(`${mon.name} must recharge.`);
        // A Pokémon that switched in this turn (switchedIn): the engine reads Payback, Bolt Beak, Fishious Rend and Analytic
        // against it (doubles-turn.ts contextFor; T2E §4.7.4). status2 T2: Fake Out and First Impression after its first turn
        // are the engine's (firstTurn, below: D's move Try), and so is Sleep Talk (CL).
        doubles = { moveId, target: chosen.target };
        // status2 T2: a two-turn move charged last turn is released at the target it was charged at (pinned side.ts
        // chooseMove: the move volatile's targetLoc, twoturnmove onStart's lastMoveTargetLoc), not the action's. That target
        // is hidden (the charge turn's move line is "[still]", its target blank): the belief world's (effects.ts draws it).
        const charge = effectOf(mon, "twoturnmove");
        if (charge && String(charge.move ?? "") === moveId) {
          const loc = Number((effectOf(mon, moveId) as { targetLoc?: number } | undefined)?.targetLoc ?? 0);
          const at = { side: loc > 0 ? (mon.side.id === "p1" ? "p2" as const : "p1" as const) : mon.side.id, position: (Math.abs(loc) - 1) as 0 | 1 };
          const there = loc ? battle[at.side].active[at.position] as Pokemon | null : null;
          if (!loc) reasons.add(`${mon.name}: the target its ${runtime.movesById.get(moveId)?.name ?? moveId} was charged at is not known.`);
          // An ally there that fainted since: the release has no target (pinned battle.ts getTarget returns null for it).
          else if (loc < 0 && (!there || there.fainted)) reasons.add(`${mon.name}: its ${runtime.movesById.get(moveId)?.name ?? moveId} is aimed at an ally that fainted.`);
          else doubles = { moveId, target: slotAt(at.side, at.position, aiSide) };
        }
      }
    }
    const contexts = contextsOf(mon, battle);
    const carried = carriedOf(battle, mon, slot, pub, aiSide, reasons, runtime);
    // status2 T2 (ADDENDUM2 §6): the stall counter from the public streak (tracker protectStreak: Protect, Detect, Endure,
    // the shields, Wide Guard, Quick Guard), with a protecting action or Endure only (the readers rule): 3^streak, at most 729;
    // 1 for none last turn (no assumption). The charged two-turn move (twoturnmove: the request offers only it).
    if (doubles.moveId && PROTECT_FAMILY.has(doubles.moveId) && pub) carried.stall = Math.min(729, 3 ** pub.protectStreak) as NonNullable<DoublesCarried["stall"]>;
    const charging = effectOf(mon, "twoturnmove");
    if (charging) {
      const move = String(charging.move ?? "");
      if (CHARGE_TURN_MOVES.has(move) || SEMI_INVULNERABLE_MOVES.has(move)) carried.charging = move;
      else reasons.add(`${mon.name}: twoturnmove is not modelled.`);
    }
    // An Encore whose move cannot be used (no PP left: the request's Struggle) does nothing this turn and ends at this end of
    // turn (data/moves.ts encore onResidual): not carried.
    if (carried.encore && doubles.moveId === "struggle") delete carried.encore;
    // The request offers only the move a charge, an Encore or an Uproar locks it into; a cell with another is not one.
    const lockedInto = carried.charging ?? carried.encore?.move ?? (carried.uproar !== undefined ? "uproar" : undefined);
    if (lockedInto && doubles.moveId !== lockedInto) reasons.add(`${mon.name} is locked into ${runtime.movesById.get(lockedInto)?.name ?? lockedInto}.`);
    // A move it is locked into (a charged move, an Uproar) that Disable forbids: Disable stops it at BeforeMove (priority 7),
    // which no action of the engine's stands for.
    else if (lockedInto && carried.disable?.move === lockedInto) reasons.add(`${mon.name}: the ${runtime.movesById.get(lockedInto)?.name ?? lockedInto} it is locked into is disabled.`);
    // (status2 T1: Ingrain grounds its holder in the engine: doubles-turn.ts turnMarks "pinned".)
    // status2 Step 1 #11: an item used or eaten earlier this turn names the item (DoublesPokemonInput.lastItem, which the engine
    // asks for with earlierThisTurn.usedItem; public: the -enditem line the tracker and the belief battle replay, or the
    // prelude copy's own). status2 T1: the item it last used or ate is passed for every Pokémon (null: none since the battle
    // began; absent: a Pickup's target not public), as Recycle and Harvest read it.
    const earlier = ctx.earlier?.[slot];
    const unknownLast = !!(pub && countsOf(pub).lastItemUnknown);
    const lastItem = unknownLast ? undefined : !mon.lastItem ? null : runtime.itemsById.has(mon.lastItem) ? mon.lastItem : undefined;
    if (earlier?.usedItem && typeof lastItem !== "string") reasons.add(`${mon.name}: the item it used earlier this turn is not known.`);
    const cheer = effectOf(mon, "dragoncheer");
    let withVolatiles: BattleBuild = {
      ...build, ...(mon.volatiles.focusenergy ? { focusEnergy: true as const } : {}), ...(cheer ? { dragonCheer: cheer.hasDragonType ? 2 as const : 1 as const } : {}),
    };
    // status2 T1: the engine swaps a carried Power Trick's (Power Shift's) stored Attack and Defense itself (doubles-turn.ts
    // carriedState): it takes the stats without that swap. The swaps since its form last changed (tracker.ts stored) say
    // whether the volatile's swap stands: a form change undoes it with the volatile up (pinned setSpecies), and a use after
    // that swaps with none; neither is an input the engine takes.
    for (const id of ["powertrick", "powershift"] as const) {
      const toggles = (pub && pub.speciesId === mon.species.id ? countsOf(pub).stored ?? [] : []).filter((event) => event.move === id).length;
      const up = !!mon.volatiles[id];
      if (up !== (toggles % 2 === 1)) reasons.add(`${mon.name}: ${runtime.movesById.get(id)?.name ?? id} across a form change is not modelled.`);
      else if (up && withVolatiles.storedStats) withVolatiles = { ...withVolatiles, storedStats: { ...withVolatiles.storedStats, atk: withVolatiles.storedStats.def, def: withVolatiles.storedStats.atk } };
    }
    if (mon.volatiles.powertrick && mon.volatiles.powershift) reasons.add(`${mon.name}: Power Trick with Power Shift is not modelled.`);
    if (withVolatiles.storedStats && !withVolatiles.transformedFrom) {
      const own = getBuildStats({ ...withVolatiles, storedStats: undefined }, runtime);
      if (own && COMBAT.every((stat) => own[stat] === withVolatiles.storedStats![stat])) { const { storedStats: _same, ...rest } = withVolatiles; void _same; withVolatiles = rest; }
    }
    // status2 T1: a build with a state the engine validates (world types, an added type, stored stats, a weight, a changed
    // ability, a transformed Pokémon, a used Protean or Libero) that the engine would refuse is a rollout, not an issue.
    if (withVolatiles.types || withVolatiles.addedType || withVolatiles.storedStats || withVolatiles.weighthg !== undefined || withVolatiles.abilityChanged || withVolatiles.transformedFrom || (isTypeChanger(withVolatiles.abilityId) && !withVolatiles.abilityActive)) {
      const issue = validateBuild(withVolatiles, runtime)[0];
      if (issue) {
        reasons.add(mon.transformed ? `${mon.name} is transformed.`
          : issue.field === "abilityActive" && isTypeChanger(withVolatiles.abilityId) ? `${mon.name}: ${mon.ability} was used this stint.`
          : issue.field === "abilityId" && withVolatiles.abilityChanged ? `${mon.name}: its ability was changed (${withVolatiles.abilityId}).`
          : `${mon.name}: ${issue.message}`);
      }
    }
    // status2 T2 (T2E §4.7.3): Fake Out and First Impression work only on its first action since it came in (pinned
    // activeMoveActions, the tracker's action count the belief battle carries), for a called one too; a Pokémon that switched
    // in this turn is on its first.
    const firstTurn = switched.has(slot) ? undefined : mon.activeMoveActions === 0;
    // status2 T2 (CL's Instruct): the target its last move was chosen at (pinned lastMoveTargetLoc: a position), from its move
    // line when no redirection or retarget can have changed it (tracker.ts lastTargetUnknown); null for a move with no chosen
    // target (a spread, self or random-target move); absent when not public.
    const lastData = pub?.lastMove ? runtime.movesById.get(pub.lastMove) : undefined;
    const lastMoveTarget = !pub?.lastMove || !lastData ? undefined
      : !CHOOSABLE_TARGETS.has(lastData.target) ? null
      : pub.lastMoveTarget && !countsOf(pub).lastTargetUnknown ? slotAt(pub.lastMoveTarget.side, pub.lastMoveTarget.position, aiSide) : undefined;
    pokemon[slot] = {
      build: withVolatiles, contexts, charged: !!mon.volatiles.charge, action: doubles,
      ...(Object.keys(carried).length ? { carried } : {}),
      lastMove: pub ? pub.lastMove : (mon.lastMove?.id ?? null),
      moves: mon.moveSlots.map((each) => each.id),
      ...(switched.has(slot) ? { switchedIn: true as const } : {}),
      ...(earlier && Object.keys(earlier).length ? { earlierThisTurn: { ...earlier } } : {}),
      ...(lastItem !== undefined ? { lastItem } : {}),
      ...(firstTurn !== undefined ? { firstTurn } : {}),
      ...(lastMoveTarget !== undefined ? { lastMoveTarget } : {}),
    };
  }
  if (reasons.size) return { kind: "rollout", reasons: [...reasons] };
  // status2 T2: a Trace holder's copied Intimidate acted as it was copied (its Start, before this turn or in the prelude), and
  // its drops are in the foes' stages from the public lines: stored, so the start settle does not apply it again
  // (doubles-start.ts copiedIntimidateStored; conformance 4b, V10 against V06: Gardevoir tracing Incineroar's Intimidate).
  for (const slot of DOUBLES_SLOTS) {
    const build = pokemon[slot]?.build;
    if (!build || build.abilityId !== "trace" || build.tracedAbility !== "intimidate") continue;
    const foes = DOUBLES_SLOTS.filter((other) => slotSide(other) !== slotSide(slot) && pokemon[other]);
    pokemon[slot] = { ...pokemon[slot]!, build: { ...build, copiedIntimidateStored: foes.map((foe) => intimidatedKey(pokemon[foe]!.build, runtime)).join(",") } };
  }
  const canSwitch = (side: SideID) => battle[side].pokemon.some((each) => !each.fainted && !each.isActive);
  const weatherTurns = Number(battle.field.weatherState?.duration ?? 0);
  const other: SideID = aiSide === "p1" ? "p2" : "p1";
  const switches: Record<DoublesSideId, boolean> = { own: canSwitch(other), opponent: canSwitch(aiSide) };
  // status2 T2 (ADDENDUM2 §6, T2E §4.6.2): the turns the terrain, Gravity and Magic Room have left before this turn's
  // countdown (the belief battle's durations from their public starts: fieldClock); 1 ends at this end of turn.
  const clock = fieldClock(battle, aiSide);
  const fieldTurns: NonNullable<DoublesTurnInput["fieldTurns"]> = {
    ...(clock.terrain && clock.terrain.turns > 0 ? { terrain: clock.terrain.turns } : {}),
    ...(clock.rooms.gravity > 0 ? { gravity: clock.rooms.gravity } : {}),
    ...(clock.rooms.magicRoom > 0 ? { magicRoom: clock.rooms.magicRoom } : {}),
  };
  // The order the actives' ability states began (abilityState.effectOrder: the belief battle's from the public lines, a
  // prelude's switch-ins and Mega Evolutions after them), as ranks; a Pokémon with no public record has none.
  const known = DOUBLES_SLOTS.filter((slot) => {
    if (!pokemon[slot] || !slotKeys[slot]) return false;
    if (switched.has(slot) || (action(slot)?.kind === "move" && !!(action(slot) as { mega?: unknown }).mega)) return true;
    const pub = ctx.publicOf?.(slotKeys[slot]!) ?? null;
    return !!pub && countsOf(pub).entry !== undefined;
  });
  const effectOrder = (slot: DoublesSlotId) => {
    const { side, position } = showdownPosition(slot, aiSide);
    return Number((battle[side].active[position] as Pokemon).abilityState.effectOrder ?? 0);
  };
  const ranked = [...known].sort((a, b) => effectOrder(a) - effectOrder(b));
  const entryOrder = Object.fromEntries(ranked.map((slot, rank) => [slot, rank])) as Partial<Record<DoublesSlotId, number>>;
  // The battle's last move (Copycat: battle.lastMove, the belief battle's from the public lines) and each side's faint last
  // turn (side.faintedLastTurn: Retaliate).
  const lastMove = battle.lastMove?.id ?? null;
  const input: DoublesTurnInput = {
    runtime, field: fieldConditions(battle, aiSide), pokemon, canSwitch: switches,
    ...(battle.field.weather && weatherTurns > 0 ? { weatherTurns } : {}),
    ...(Object.keys(fieldTurns).length ? { fieldTurns } : {}),
    ...(ranked.length ? { entryOrder } : {}),
    ...(lastMove === null || runtime.movesById.has(lastMove) ? { battleLastMove: lastMove } : {}),
    faintedLastTurn: { own: !!battle[other].faintedLastTurn, opponent: !!battle[aiSide].faintedLastTurn },
  };
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
