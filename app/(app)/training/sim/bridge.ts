// A belief battle (or a prelude clone stopped before the first move) → the 2v2 turn engine's input for one cell
// (SPEC §9.4 "Bridge" and "Guards"). Engine orientation: "own" is the player (the other side of the AI's seat),
// "opponent" is the AI. Prototypes: scripts/.cache/training/design/probe/{bridge-probe.ts,prelude-probe.ts}.
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { DOUBLES_SLOTS, slotSide, type DoublesCarried, type DoublesPokemonInput, type DoublesSideId, type DoublesSlotId, type DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext, SideConditions } from "@/app/lib/battle/types";
import { ENTRY_ABILITIES } from "@/app/lib/battle/uses-to-ko";
import type { CellActions, FieldClock, MonKey } from "../model/ai-view";
import { showdownPosition, slotAt } from "../model/positions";
import type { PublicMon } from "../model/public-state";
import type { SideID } from "../model/showdown-types";
import type { JointAction, SlotAction } from "../model/view-types";
import type { MemberKeys } from "./choices";
import type { ClonedBattle, Pokemon } from "./sim";
import { countsOf, type SubstituteVolatile } from "./tracker";

export const WEATHER: Record<string, BattleConditions["weather"]> = {
  sunnyday: "Sun", raindance: "Rain", sandstorm: "Sand", snowscape: "Snow", hail: "Hail",
  desolateland: "Harsh Sunshine", primordialsea: "Heavy Rain", deltastream: "Strong Winds",
};
export const TERRAIN: Record<string, BattleConditions["terrain"]> = {
  electricterrain: "Electric", grassyterrain: "Grassy", mistyterrain: "Misty", psychicterrain: "Psychic",
};
/**
 * Volatiles with no effect the engine reads (status-eot SPEC §6): legality the request already applies (choicelock,
 * lockedmove, Encore, Taunt, Disable, Torment, Throat Chop, Imprison, C8), counters (stall, Laser Focus), this turn's
 * protection and redirection, what the build carries (Charge, Flash Fire, Unburden, Slow Start), trapping (no switch in
 * the turn).
 */
const IGNORED_VOLATILES: ReadonlySet<string> = new Set([
  "charge", "flashfire", "unburden", "slowstart", "choicelock", "lockedmove", "encore", "taunt", "disable", "torment", "throatchop",
  "trapped", "trapper", "stall", "laserfocus", "imprison", "protect", "helpinghand", "followme", "ragepowder", "endure",
  // Recharge: its request offers only Recharge, which is "No move"; any other move with it is a rollout (below).
  "mustrecharge",
]);
/** Volatiles mapped into the engine input (DoublesCarried and the build): the end of turn and the moves read them. */
const MAPPED_VOLATILES: ReadonlySet<string> = new Set([
  "confusion", "leechseed", "yawn", "perishsong", "partiallytrapped", "saltcure", "aquaring", "ingrain", "curse", "syrupbomb", "focusenergy", "dragoncheer",
  "substitute", "allyswitch",
]);
const MAPPED_SIDE: ReadonlySet<string> = new Set(["reflect", "lightscreen", "auroraveil", "tailwind"]);
const IGNORED_SIDE: ReadonlySet<string> = new Set(["spikes", "toxicspikes", "stealthrock", "stickyweb", "luckychant"]);
const ROOMS: ReadonlySet<string> = new Set(["trickroom", "gravity", "wonderroom", "magicroom", "fairylock"]);
/**
 * Held items that act after Magic Room's countdown (order 27.6): Flame Orb, Toxic Orb and Sticky Barb (28.3), White Herb
 * (29), and at the final Update Mental Herb, Booster Energy and the Berries (Micle Berry's handler comes last too).
 */
const AFTER_ROOM_ITEMS: ReadonlySet<string> = new Set(["flameorb", "toxicorb", "stickybarb", "whiteherb", "mentalherb", "boosterenergy"]);
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
    if (at && there && !there.fainted) {
      if (!foe(at)) reasons.add(`${name}: Leech Seed from an ally is not modelled.`);
      carried.leechSeed = at;
    }
  }
  const trap = effectOf(mon, "partiallytrapped");
  if (trap) {
    // It ends at this end of turn without damage when its countdown runs out or its source is gone (data/conditions.ts partiallytrapped).
    const source = trap.source;
    const effect = String((trap.sourceEffect as { id?: string } | undefined)?.id ?? "");
    if (effect === "gmaxcentiferno" || effect === "gmaxsandblast") reasons.add(`${name}: a G-Max trap is not modelled.`);
    else if (Number(trap.duration ?? 0) > 1 && source && source.isActive && !source.fainted && source.hp > 0) {
      const at = slotOfPokemon(source, aiSide);
      if (!foe(at)) reasons.add(`${name}: a trap from an ally is not modelled.`);
      // The move that set it names the residual (its -activate line is public; effects.ts builds the volatile from it).
      carried.trap = { source: at, bindingBand: Number(trap.boundDivisor) === 6, ...(runtime.movesById.has(effect) ? { move: effect } : {}) };
    }
  }
  if (mon.volatiles.saltcure) carried.saltCure = true;
  if (mon.volatiles.aquaring) carried.aquaRing = true;
  if (mon.volatiles.ingrain) carried.ingrain = true;
  if (mon.volatiles.curse) carried.curse = true;
  const syrup = effectOf(mon, "syrupbomb");
  if (syrup?.source && syrup.source.isActive && !syrup.source.fainted && Number(syrup.duration ?? 0) > 1) {
    const at = slotOfPokemon(syrup.source, aiSide);
    if (!foe(at)) reasons.add(`${name}: Syrup Bomb from an ally is not modelled.`);
    carried.syrupBomb = at;
  }
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
  if (future && overflowed >= Number(future.endingTurn ?? Infinity)) carried.futureMove = String(future.move ?? "futuresight");
  const chew = mon.abilityState as { berry?: unknown; counter?: number };
  if (mon.ability === "cudchew" && chew.berry && Number(chew.counter ?? 0) <= 1) carried.cudChew = true;
  const sub = effectOf(mon, "substitute");
  if (sub) {
    const shown = pub?.volatiles.find((each) => each.id === "substitute") as SubstituteVolatile | undefined;
    if (!shown || (shown.hits ?? 0) > 0 || !shown.sourceKey) reasons.add(`${name}: its Substitute's HP after a hit is not public.`);
    else carried.substitute = Math.max(1, Number(sub.hp ?? 1));
  }
  const ally = effectOf(mon, "allyswitch");
  if (ally && Number(ally.counter ?? 0) >= 3) carried.allySwitch = Math.min(729, Number(ally.counter)) as DoublesCarried["allySwitch"];
  return carried;
}

/**
 * The engine input for `cell` on `battle`. `switched`: slots whose Pokémon switched this turn (the prelude ran their
 * entries; they take no action). `afterPrelude`: the battle is a prelude clone. Any state the engine does not model
 * is a rollout with its reasons.
 */
export function bridgeTurn(battle: ClonedBattle, cell: CellActions, ctx: {
  runtime: BattleRuntime; keys: MemberKeys; aiSide: SideID; switched: ReadonlySet<DoublesSlotId>;
  /** The tracker's public view of a Pokémon by key (services.ts publicOf): the counts carried state reads. */
  publicOf?: (key: MonKey) => PublicMon | null;
}): BridgeResult {
  const { runtime, keys, aiSide, switched } = ctx;
  const reasons = new Set<string>();
  const notes: string[] = [];
  const action = (slot: DoublesSlotId): SlotAction | undefined => (slot.startsWith("own") ? cell.own : cell.opponent)[slot];
  const anySwitch = DOUBLES_SLOTS.some((slot) => action(slot)?.kind === "switch");

  // Field guards.
  if (battle.field.weather && !WEATHER[battle.field.weather]) reasons.add(`Weather ${battle.field.weather} is not modelled.`);
  for (const id of Object.keys(battle.field.pseudoWeather)) if (!ROOMS.has(id)) reasons.add(`Field effect ${id} is not modelled.`);
  // Magic Room with one turn left ends at this residual's order 27.6 (pinned data/moves.ts magicroom onFieldResidualOrder
  // 27, SubOrder 6), and the items above act after it; the engine takes no turns left for it and keeps it to the end.
  const room = battle.field.pseudoWeather.magicroom as { duration?: number } | undefined;
  if (room && Number(room.duration ?? 0) === 1) {
    const late = (["p1", "p2"] as const).flatMap((side) => battle[side].active as (Pokemon | null)[])
      .some((mon) => !!mon && !mon.fainted && !!mon.item && (mon.item.endsWith("berry") || AFTER_ROOM_ITEMS.has(mon.item)));
    if (late) reasons.add("Magic Room ending this turn is not modelled.");
  }
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
    for (const id of Object.keys(mon.volatiles)) if (!IGNORED_VOLATILES.has(id) && !MAPPED_VOLATILES.has(id)) reasons.add(`${mon.name}: ${id} is not modelled.`);
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
      if (moveId === "recharge") {
        doubles = { moveId: null, target: null };
        // Recharge stops at BeforeMove (mustrecharge, priority 11) before confusion could hurt it; "No move" is Splash, which can.
        if (mon.volatiles.confusion) reasons.add(`${mon.name}: recharging while confused is not modelled.`);
      }
      else if (moveId === "struggle" || moveId === "sleeptalk") reasons.add(`${mon.name}: ${moveId} is not modelled.`);
      else {
        const species = runtime.speciesById.get(mon.species.id);
        const learnable = species?.moves.includes(moveId) || runtime.speciesById.get(mon.baseSpecies.id)?.moves.includes(moveId);
        if (!runtime.movesById.has(moveId) || !learnable) reasons.add(`${mon.name}: ${moveId} is not in its catalog moves.`);
        if (mon.volatiles.mustrecharge) reasons.add(`${mon.name} must recharge.`);
        if (FIRST_TURN_ONLY.has(moveId) && mon.activeMoveActions > 0) {
          notes.push(`${runtime.movesById.get(moveId)?.name ?? moveId} fails: not its first turn.`);
          doubles = { moveId: null, target: null };
          // Fake Out failing is not Splash: no Gravity or confusion check stands in for it.
          if (mon.volatiles.confusion) reasons.add(`${mon.name}: ${moveId} after its first turn while confused is not modelled.`);
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
    const pub = ctx.publicOf?.(slotKeys[slot]!) ?? null;
    const carried = carriedOf(battle, mon, slot, pub, aiSide, reasons, runtime);
    // Ingrain grounds its holder, which the damage calculations do not read (a Ground move into a Flying type).
    if (carried.ingrain && (mon.hasType("Flying") || mon.ability === "levitate" || build.itemId === "airballoon")) reasons.add(`${mon.name}: Ingrain on a Pokémon that is not grounded otherwise is not modelled.`);
    const cheer = effectOf(mon, "dragoncheer");
    const withVolatiles: BattleBuild = {
      ...build, ...(mon.volatiles.focusenergy ? { focusEnergy: true as const } : {}), ...(cheer ? { dragonCheer: cheer.hasDragonType ? 2 as const : 1 as const } : {}),
    };
    pokemon[slot] = {
      build: withVolatiles, contexts, charged: !!mon.volatiles.charge, action: doubles,
      ...(Object.keys(carried).length ? { carried } : {}),
      lastMove: pub ? pub.lastMove : (mon.lastMove?.id ?? null),
      moves: mon.moveSlots.map((each) => each.id),
    };
  }
  if (reasons.size) return { kind: "rollout", reasons: [...reasons] };
  const canSwitch = (side: SideID) => battle[side].pokemon.some((each) => !each.fainted && !each.isActive);
  const weatherTurns = Number(battle.field.weatherState?.duration ?? 0);
  const other: SideID = aiSide === "p1" ? "p2" : "p1";
  const switches: Record<DoublesSideId, boolean> = { own: canSwitch(other), opponent: canSwitch(aiSide) };
  const input: DoublesTurnInput = {
    runtime, field: fieldConditions(battle, aiSide), pokemon, canSwitch: switches,
    ...(battle.field.weather && weatherTurns > 0 ? { weatherTurns } : {}),
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
