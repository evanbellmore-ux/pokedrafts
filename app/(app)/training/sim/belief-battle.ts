// A battle rebuilt from scratch from the AI's seat (SPEC §9.2, I5): a new Battle with its own exact team and one belief
// world for the other side, then every field written from AiInputs (the public state, its own request) and the world,
// then Showdown's own endTurn(). The real battle is never read or cloned here (boundary test). Prototype:
// scripts/.cache/training/design/spec/seat-probe.mjs buildFromPublic; truth-copy check: scripts/lib/showdown-sim/gate.mjs.
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { AiInputs, BeliefWorld } from "../model/ai-inputs";
import type { PublicCondition, PublicMon, ShownHP } from "../model/public-state";
import { createRandom } from "../model/random";
import type { ShowdownSet, SideID } from "../model/showdown-types";
import { identName, type MemberKeys } from "./choices";
import { volatileStates } from "./effects";
import { Battle, Dex, FORMAT, State, toID, type ClonedBattle, type ModdedDex, type WritablePokemon, type WritableSide } from "./sim";
import { shownPercent } from "./tracker";

export type BeliefBattle = { battle: ClonedBattle; json: string; keys: MemberKeys; approximations: string[] };

/** Base turns and the setter's item that makes them 8 (pinned data/moves.ts durationCallback; rocks, Light Clay, Terrain Extender). */
const DURATION: Record<string, { base: number; item?: string }> = {
  sunnyday: { base: 5, item: "heatrock" }, raindance: { base: 5, item: "damprock" }, sandstorm: { base: 5, item: "smoothrock" },
  snowscape: { base: 5, item: "icyrock" }, hail: { base: 5, item: "icyrock" },
  electricterrain: { base: 5, item: "terrainextender" }, grassyterrain: { base: 5, item: "terrainextender" },
  mistyterrain: { base: 5, item: "terrainextender" }, psychicterrain: { base: 5, item: "terrainextender" },
  reflect: { base: 5, item: "lightclay" }, lightscreen: { base: 5, item: "lightclay" }, auroraveil: { base: 5, item: "lightclay" },
  tailwind: { base: 4 }, trickroom: { base: 5 }, gravity: { base: 5 }, magicroom: { base: 5 }, wonderroom: { base: 5 },
  safeguard: { base: 5 }, mist: { base: 5 }, luckychant: { base: 5 }, fairylock: { base: 2 },
};
const LAYERED: ReadonlySet<string> = new Set(["spikes", "toxicspikes"]);
/** Tracked as side conditions with layers = slot position + 1; slot conditions in the simulator (sim/side.ts slotConditions). */
const SLOT_CONDITIONS: ReadonlySet<string> = new Set(["wish", "futuresight", "doomdesire"]);
/** Future Sight's stored move data (pinned data/moves.ts futuresight onTry). */
const FUTURE_SIGHT_DATA = {
  id: "futuresight", name: "Future Sight", accuracy: 100, basePower: 120, category: "Special", priority: 0,
  flags: { allyanim: 1, metronome: 1, futuremove: 1 }, ignoreImmunity: false, effectType: "Move", type: "Psychic",
};
/** Forms a Pokémon leaves when it switches out (non-permanent formeChange; pinned sim/pokemon.ts clearVolatile setSpecies). */
const TEMPORARY_FORMS: ReadonlySet<string> = new Set([
  "aegislash", "aegislashblade", "morpeko", "morpekohangry", "cramorantgulping", "cramorantgorging", "castformsunny", "castformrainy",
  "castformsnowy", "cherrimsunshine", "eiscuenoice", "wishiwashischool", "miniormeteor", "darmanitanzen", "darmanitangalarzen", "meloettapirouette",
]);

let formatDex: ModdedDex | null = null;
const dex = () => (formatDex ??= Dex.forFormat(FORMAT));
const speciesOfDetails = (details: string) => toID(details.split(",")[0]);

/** HP values a Pokémon with `maxhp` can have while it shows `shown` (pinned Champions shared formula, sim/pokemon.ts:2060-2073). */
export function hpBand(shown: ShownHP, maxhp: number): number[] {
  const out: number[] = [];
  for (let hp = 1; hp <= maxhp; hp++) {
    const each = shownPercent(hp, maxhp);
    if (each.percent === shown.percent && (shown.color === null || each.color === shown.color || each.color === null)) out.push(hp);
  }
  return out;
}

function nameKeys(entries: { key: string; set: ShowdownSet }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const { key, set } of entries) {
    // A set named as its species battles under its base species' name (pinned sim/pokemon.ts:329-334).
    for (const name of [set.name, set.species, dex().species.get(set.species).baseSpecies]) { map.set(name, key); map.set(toID(name), key); }
  }
  return map;
}

export function buildBeliefBattle(inputs: AiInputs, world: BeliefWorld, runtime: BattleRuntime): BeliefBattle {
  void runtime;   // SPEC 9.2 signature; the sets arrive as Showdown sets, so the catalog is not read here
  const ai = inputs.perspective;
  const other: SideID = ai === "p1" ? "p2" : "p1";
  const approximations = new Set<string>();
  const random = createRandom("belief", world.seed);
  const pub = inputs.public;

  // 1. Sides: the AI's brought four in its request's side order (exact sets); the other side's brought four of this world.
  const ownNames = nameKeys([...inputs.own]);
  const aiOrder = inputs.request.side.pokemon.map((pokemon) => {
    const key = ownNames.get(identName(pokemon.ident)) ?? ownNames.get(toID(identName(pokemon.ident)));
    const entry = inputs.own.find((each) => each.key === key);
    if (!entry) throw new Error(`Own member not found: ${pokemon.ident}`);
    return { key: entry.key, set: entry.set, request: pokemon };
  });
  const playerOrder = world.brought.filter((key) => world.sets[key]).map((key) => ({ key, set: world.sets[key], request: null }));
  const order = { [ai]: aiOrder, [other]: playerOrder } as Record<SideID, { key: string; set: ShowdownSet; request: AiInputs["request"]["side"]["pokemon"][number] | null }[]>;
  const sideNames = { p1: nameKeys(order.p1), p2: nameKeys(order.p2) };
  const keys: MemberKeys = {
    keyOf: (side, name) => sideNames[side].get(name) ?? sideNames[side].get(toID(name)) ?? `?${name}`,
    speciesOf: (side, key) => order[side].find((each) => each.key === key)?.set.species ?? key,
  };

  // 2. A fresh battle through team preview; entry effects that fire here are overwritten below.
  const battle = new Battle({ formatid: FORMAT, seed: [7, 7, 7, 7] }) as unknown as ClonedBattle;
  battle.setPlayer("p1", { name: "You", team: order.p1.map((each) => structuredClone(each.set)) });
  battle.setPlayer("p2", { name: "Training", team: order.p2.map((each) => structuredClone(each.set)) });
  const team = (n: number) => `team ${Array.from({ length: n }, (_, i) => i + 1).join("")}`;
  battle.makeChoices(team(order.p1.length), team(order.p2.length));

  const monOfKey = new Map<string, WritablePokemon>();
  for (const side of ["p1", "p2"] as const) order[side].forEach((each, i) => monOfKey.set(`${side}:${each.key}`, battle[side].pokemon[i]));
  const monOf = (key: string | undefined | null) => (key ? monOfKey.get(key) ?? null : null);
  const turn = pub.turn;

  // 3. Every field, per Pokémon.
  const transforms: [WritablePokemon, string][] = [];
  for (const side of ["p1", "p2"] as const) {
    const isAI = side === ai;
    order[side].forEach((entry, index) => {
      const bp = battle[side].pokemon[index];
      const key = `${side}:${entry.key}`;
      const mon: PublicMon | undefined = pub.mons[key];
      const request = entry.request;
      const active = index < battle[side].active.length;
      // Form: as shown (temporary forms such as Aegislash-Blade keep the details' name), else its own request's details;
      // formeChange, permanent for Megas.
      const shownSpecies = mon?.speciesId ?? (request ? speciesOfDetails(request.details) : undefined);
      let formChanged = false;
      if (shownSpecies && shownSpecies !== bp.species.id) {
        const mega = request ? /-Mega/.test(request.details) : !!mon?.mega;
        try {
          bp.formeChange(shownSpecies, mega ? bp.getItem() : null, mega || !TEMPORARY_FORMS.has(shownSpecies));
          formChanged = true;
        } catch {
          approximations.add(`Form not rebuilt: ${shownSpecies}.`);
        }
      }
      // HP: exact for its own side (request condition); the other side's from the test reveal, else inside the shown band.
      const condition = request?.condition ?? null;
      const fainted = condition ? condition.endsWith(" fnt") : !!mon?.fainted;
      let hp = bp.maxhp;
      if (fainted) hp = 0;
      else if (condition) hp = Math.min(bp.maxhp, Number(condition.split("/")[0]) || bp.maxhp);
      else if (inputs.reveals.exactHP?.[key]) {
        // Exact under the test setting; a believed maximum other than the real one keeps the real share of it.
        const real = inputs.reveals.exactHP[key];
        hp = real.maxhp === bp.maxhp ? real.hp : Math.min(bp.maxhp, Math.max(real.hp > 0 ? 1 : 0, Math.round((real.hp * bp.maxhp) / Math.max(1, real.maxhp))));
      }
      else if (mon) {
        const band = hpBand(mon.hp, bp.maxhp);
        hp = band.length ? (world.hp === "midpoint" ? band[Math.floor(band.length / 2)] : band[random.int(band.length)]) : Math.max(1, Math.round((bp.maxhp * mon.hp.percent) / 100));
      }
      bp.hp = hp;
      bp.fainted = fainted;
      if (fainted) { bp.isActive = false; bp.switchFlag = false; }

      // Status: sleep and freeze counters redrawn from the public attempts (champions/conditions.ts slp, frz).
      const status = fainted ? "" : (mon?.status ?? (condition?.split(" ")[1] as PublicMon["status"] | undefined) ?? "");
      bp.status = status;
      bp.statusState = battle.initEffectState({ id: status, target: bp });
      const elapsed = mon?.statusElapsed ?? 0;
      if (status === "slp") {
        const step = bp.ability === "earlybird" ? 2 : 1;
        const start = [2, 3, 3].filter((each) => each > elapsed * step);
        const startTime = start.length ? start[random.int(start.length)] : elapsed * step + 1;
        Object.assign(bp.statusState, { startTime, time: startTime - elapsed * step });
      } else if (status === "frz") {
        Object.assign(bp.statusState, { startTime: 3, time: Math.max(1, 3 - elapsed) });
      } else if (status === "tox") {
        Object.assign(bp.statusState, { stage: Math.min(15, elapsed) });
      }
      bp.boosts = mon ? { ...mon.boosts } : { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };

      // Item: its own side's from the request; the other side's as shown, else the world's set (construction may have used it).
      const setItem = toID(entry.set.item);
      if (request) {
        bp.item = request.item;
        bp.lastItem = mon?.item.state === "gone" && mon.item.how === "consumed" ? mon.item.itemId : "";
      } else if (mon?.item.state === "gone") {
        bp.item = "";
        bp.lastItem = mon.item.how === "consumed" ? mon.item.itemId : "";
      } else {
        bp.item = mon?.item.state === "held" ? mon.item.itemId : setItem;
        bp.lastItem = "";
      }
      bp.itemKnockedOff = false;
      bp.itemState = battle.initEffectState({ id: bp.item, target: bp });
      bp.usedItemThisTurn = false;
      bp.ateBerry = false;

      // Ability: its own current one; the other side's as shown, else the form's (after a Mega Evolution) or the set's.
      const ability = request ? toID(request.ability ?? request.baseAbility) : mon?.ability?.abilityId ?? (formChanged ? bp.ability : toID(entry.set.ability));
      bp.ability = ability;
      if (request) bp.baseAbility = toID(request.baseAbility);
      else if (mon?.ability?.how === "announced") bp.baseAbility = ability;
      bp.abilityState = battle.initEffectState({ id: ability, target: bp });
      const fallen = mon?.volatiles.find((each) => each.id === "fallen");
      if (fallen) bp.abilityState.fallen = fallen.layers ?? 0;

      // PP: its own actives from the request; everyone else maxpp − shown uses (R4).
      const requestMoves = isAI && active && !fainted && "active" in inputs.request ? inputs.request.active[index]?.moves ?? [] : [];
      for (const slot of bp.moveSlots) {
        const fromRequest = requestMoves.find((each) => each.id === slot.id && each.pp !== undefined);
        slot.pp = fromRequest?.pp ?? Math.max(0, slot.maxpp - (mon?.movesUsed[slot.id] ?? 0));
        slot.used = (mon?.movesUsed[slot.id] ?? 0) > 0;
      }
      // Moves, results and counters (endTurn moves moveThisTurnResult to moveLastTurnResult and adds 1 to activeTurns).
      bp.lastMove = mon?.lastMove ? battle.dex.getActiveMove(mon.lastMove) : null;
      bp.lastMoveUsed = bp.lastMove;
      bp.lastMoveEncore = null;
      bp.lastMoveTargetLoc = mon?.lastMoveTarget
        ? (mon.lastMoveTarget.side === side ? -(mon.lastMoveTarget.position + 1) : mon.lastMoveTarget.position + 1)
        : undefined;
      bp.moveThisTurnResult = mon?.lastResult ?? undefined;
      bp.timesAttacked = mon?.timesHit ?? 0;
      bp.activeMoveActions = mon?.actions ?? 0;
      bp.previouslySwitchedIn = mon?.switchIns ?? 0;
      bp.isStarted = active && !fainted;
      bp.activeTurns = Math.max(0, (mon?.activeTurns ?? 0) - (active && !fainted ? 1 : 0));
      bp.attackedBy = [];
      if (pub.sides[side].megaUsed) { bp.canMegaEvo = null; bp.canMegaEvoX = null; bp.canMegaEvoY = null; }
      // Once-per-battle entry abilities have fired if it entered before (pinned data/abilities.ts supersweetsyrup,
      // zerotohero, battlebond, intrepidsword, dauntlessshield flags on the Pokémon).
      const entered = bp.previouslySwitchedIn > 0;
      Object.assign(bp, { syrupTriggered: entered, heroMessageDisplayed: entered, bondTriggered: entered, swordBoost: entered, shieldBoost: entered });
      // Public type changes (Protean, Soak, Reflect Type, Forest's Curse); Protean and Libero act once per entry.
      const typechange = mon?.volatiles.find((each) => each.id === "typechange");
      const typeadd = mon?.volatiles.find((each) => each.id === "typeadd");
      if (typechange && active && !fainted) {
        if (typechange.moveId) {
          bp.types = typechange.moveId.split("/");
          bp.addedType = "";
          bp.apparentType = bp.types.join("/");
          bp.knownType = true;
          if (bp.ability === "protean" || bp.ability === "libero") bp.abilityState[bp.ability] = true;
        } else approximations.add("Type change not rebuilt.");
      }
      if (typeadd?.moveId && active && !fainted) bp.addedType = typeadd.moveId;
      if (mon?.transformedInto) transforms.push([bp, mon.transformedInto]);
    });
  }
  // Volatiles once every Pokémon exists (sources and linked volatiles refer to others).
  for (const side of ["p1", "p2"] as const) {
    order[side].forEach((entry, index) => {
      const bp = battle[side].pokemon[index];
      const mon = pub.mons[`${side}:${entry.key}`];
      bp.volatiles = {};
      if (!mon || bp.fainted || index >= battle[side].active.length) return;
      Object.assign(bp.volatiles, volatileStates({ battle, mon: bp, pub: mon, turn, random, monOf, own: side === ai, approximations }));
    });
  }
  // Transform, in log order, after everything else.
  for (const [bp, targetKey] of transforms) {
    const target = monOf(targetKey);
    if (target && !bp.fainted) { try { bp.transformInto(target, null); } catch { approximations.add("Transform not rebuilt."); } }
  }

  // Sides and field.
  // The setter's item when the effect started: what it holds, else what it battled with (Knock Off later does not shorten it).
  const setItemOf = new Map<string, string>();
  for (const side of ["p1", "p2"] as const) for (const each of order[side]) setItemOf.set(`${side}:${each.key}`, toID(each.set.item));
  const itemOf = (setterKey: string | null) => { const setter = monOf(setterKey); return setter ? setter.item || setter.lastItem || (setterKey ? setItemOf.get(setterKey) ?? "" : "") : ""; };
  const turnsLeft = (condition: PublicCondition) => {
    const rule = DURATION[condition.id];
    if (!rule) return undefined;
    const base = rule.item && itemOf(condition.setterKey) === rule.item ? 8 : rule.base;
    return Math.max(1, base - (turn - condition.since));
  };
  for (const side of ["p1", "p2"] as const) {
    const s: WritableSide = battle[side];
    s.sideConditions = {};
    s.slotConditions = s.slotConditions.map(() => ({}));
    for (const condition of pub.sides[side].conditions.filter((each) => SLOT_CONDITIONS.has(each.id))) {
      const setter = monOf(condition.setterKey);
      const slot = s.slotConditions[condition.layers - 1];
      if (!slot || !setter) continue;
      if (condition.id === "wish") {
        // data/moves.ts wish condition: startingTurn is the overflowed turn count at use (turn - 1, sim/battle.ts
        // getOverflowedTurnCount); it heals source.maxhp / 2 at the end of the next turn.
        slot.wish = battle.initEffectState({ id: "wish", target: s, isSlotCondition: true, source: setter, sourceSlot: setter.getSlot(), hp: setter.maxhp / 2, startingTurn: condition.since - 1 });
      } else {
        // data/conditions.ts futuremove: hits at the end of endingTurn = use turn + 1 (onStart (turn - 1) + 2).
        slot.futuremove = battle.initEffectState({ id: "futuremove", target: s, isSlotCondition: true, source: setter, sourceSlot: setter.getSlot(), targetSlot: `${side}${"ab"[condition.layers - 1]}`, endingTurn: condition.since + 1, move: condition.id, moveData: { ...FUTURE_SIGHT_DATA } });
      }
    }
    for (const condition of pub.sides[side].conditions.filter((each) => !SLOT_CONDITIONS.has(each.id))) {
      const setter = monOf(condition.setterKey);
      const duration = turnsLeft(condition);
      s.sideConditions[condition.id] = battle.initEffectState({
        id: condition.id, target: s, ...(setter ? { source: setter, sourceSlot: setter.getSlot() } : {}),
        ...(duration !== undefined ? { duration } : {}), ...(LAYERED.has(condition.id) ? { layers: condition.layers } : {}),
      });
    }
    s.totalFainted = pub.sides[side].totalFainted;
    s.pokemonLeft = s.pokemon.filter((pokemon) => !pokemon.fainted).length;
    s.faintedThisTurn = monOf(pub.sides[side].faintedLastTurn);
    s.faintedLastTurn = null;
  }
  const weather = pub.field.weather;
  if (weather) {
    const setter = monOf(weather.setterKey);
    const duration = ["desolateland", "primordialsea", "deltastream"].includes(weather.id) ? undefined : turnsLeft(weather);
    battle.field.weather = weather.id;
    battle.field.weatherState = battle.initEffectState({ id: weather.id, ...(setter ? { source: setter, sourceSlot: setter.getSlot() } : {}), ...(duration !== undefined ? { duration } : {}) });
  } else {
    battle.field.weather = "";
    battle.field.weatherState = battle.initEffectState({ id: "" });
  }
  const terrain = pub.field.terrain;
  if (terrain) {
    const setter = monOf(terrain.setterKey);
    battle.field.terrain = terrain.id;
    battle.field.terrainState = battle.initEffectState({ id: terrain.id, ...(setter ? { source: setter, sourceSlot: setter.getSlot() } : {}), duration: turnsLeft(terrain) ?? 5 });
  } else {
    battle.field.terrain = "";
    battle.field.terrainState = battle.initEffectState({ id: "" });
  }
  battle.field.pseudoWeather = {};
  for (const room of pub.field.rooms) {
    const setter = monOf(room.setterKey);
    battle.field.pseudoWeather[room.id] = battle.initEffectState({ id: room.id, ...(setter ? { source: setter, sourceSlot: setter.getSlot() } : {}), duration: turnsLeft(room) ?? 5 });
  }
  battle.lastMove = pub.lastMove ? battle.dex.getActiveMove(pub.lastMove) : null;

  // 4. Showdown's own upkeep recomputes disabled moves, Choice lock, trapping and both requests (pinned sim/battle.ts:1623).
  // Replacements. Fainted Pokémon are flagged only once the turn's queue is empty, after the residual phase (pinned
  // sim/battle.ts runAction "switching"), and turnLoop keeps midTurn true at that request, so the commit runs the
  // switches and then endTurn() with no second residual (sim/battle.ts:2943-2956). A request that flags only living
  // Pokémon (U-turn, Parting Shot, Baton Pass, Eject Button/Pack) comes mid-turn: the turn's remaining actions are not
  // public, so the belief battle runs the residual phase after the switches (midTurn false).
  let midTurn = false;
  if ("forceSwitch" in inputs.request) {
    battle.turn = turn;
    inputs.request.forceSwitch.forEach((flag, position) => {
      const bp = battle[ai].active[position];
      if (!bp || !flag) return;
      if (bp.fainted) { midTurn = true; bp.switchFlag = true; return; }
      // A self-switch move flags its user with the move id, which the switch takes as its source (Baton Pass and Shed
      // Tail copy, the line's [from] tag): sim/battle-actions.ts:1311-1312, sim/battle-queue.ts:251-254, battle-actions.ts:77-81.
      const last = pub.mons[`${ai}:${order[ai][position].key}`]?.lastMove ?? null;
      const selfSwitch = last ? (battle.dex.getActiveMove(last) as { selfSwitch?: unknown }).selfSwitch : undefined;
      bp.switchFlag = last && selfSwitch ? last : true;
    });
    const otherSide = battle[other];
    const bench = otherSide.pokemon.slice(otherSide.active.length).some((pokemon) => !pokemon.fainted);
    for (const bp of otherSide.active) if (bp?.fainted && bench) bp.switchFlag = true;
    try { battle.makeRequest("switch"); } catch { approximations.add("Replacement request not rebuilt."); }
  } else {
    battle.turn = turn - 1;
    battle.endTurn();
  }
  battle.midTurn = midTurn;

  // 5. Serialized once for preludes, rollouts and the residual pass.
  const json = JSON.stringify(State.serializeBattle(battle));
  return { battle, json, keys, approximations: [...approximations] };
}
