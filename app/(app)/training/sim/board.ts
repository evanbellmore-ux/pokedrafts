// Your view of the battle (SPEC §7.6): your side from the real battle (it is yours), the AI's side only from the p1
// channel's tracker and the AI's sheet as youSee allows. One of the three readers of the real battle (boundary test):
// it reads the AI's real Pokémon only for the two test settings (exact HP, brought).
import { DOUBLES_SLOTS, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleStat, BattleStatus } from "@/app/lib/battle/types";
import type { InfoView } from "../model/info";
import type { PublicCondition, PublicMon, PublicState, PublicVolatile } from "../model/public-state";
import type { SheetMember, SheetView } from "../model/sheet";
import type { BoardView, FieldEffectView, FieldView, ItemView, PokemonView } from "../model/view-types";
import type { MemberKeys } from "./choices";
import type { Battle, Pokemon } from "./sim";
import { toID } from "./tracker";

const SLOT: Record<"p1" | "p2", [DoublesSlotId, DoublesSlotId]> = { p1: ["own-left", "own-right"], p2: ["opponent-right", "opponent-left"] };
const STATS: readonly BattleStat[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** The board's volatile whitelist (SPEC 9.6); never stall, choicelock, lockedmove, twoturnmove or mustrecharge. */
const VOLATILE_NAMES: Record<string, string> = {
  substitute: "Substitute", confusion: "Confusion", taunt: "Taunt", encore: "Encore", disable: "Disable", torment: "Torment",
  leechseed: "Leech Seed", yawn: "Yawn", magnetrise: "Magnet Rise", telekinesis: "Telekinesis", smackdown: "Smack Down",
  saltcure: "Salt Cure", tarshot: "Tar Shot", focusenergy: "Focus Energy", laserfocus: "Laser Focus", charge: "Charge",
  protect: "Protect", followme: "Follow Me", ragepowder: "Rage Powder",
};
export function volatileNames(volatiles: readonly PublicVolatile[], runtime: BattleRuntime): string[] {
  const names: string[] = [];
  for (const each of volatiles) {
    if (each.id === "perishsong") names.push(`Perish Song (${each.layers ?? 3})`);
    else if (each.id === "stockpile") names.push(`Stockpile (${each.layers ?? 1})`);
    else if (each.id === "partiallytrapped") names.push(`${runtime.movesById.get(each.moveId ?? "")?.name ?? "Trap"} (trapped)`);
    else if (VOLATILE_NAMES[each.id]) names.push(VOLATILE_NAMES[each.id]);
  }
  return names;
}
/** Real volatiles of your own Pokémon, as the same whitelist. */
function realVolatiles(pokemon: Pokemon, runtime: BattleRuntime): string[] {
  const list: PublicVolatile[] = Object.entries(pokemon.volatiles).map(([id, state]) => ({
    id, since: 0, elapsed: 0, layers: id === "perishsong" ? Number(state.duration ?? 3) : id === "stockpile" ? Number(state.layers ?? 1) : undefined,
    moveId: id === "partiallytrapped" ? toID((state.sourceEffect as { id?: string } | undefined)?.id ?? "") : undefined,
  }));
  return volatileNames(list, runtime);
}

const FIELD_NAMES: Record<string, string> = {
  sunnyday: "Sun", raindance: "Rain", sandstorm: "Sandstorm", snowscape: "Snow", hail: "Hail", desolateland: "Harsh sunshine",
  primordialsea: "Heavy rain", deltastream: "Strong winds", electricterrain: "Electric Terrain", grassyterrain: "Grassy Terrain",
  mistyterrain: "Misty Terrain", psychicterrain: "Psychic Terrain", trickroom: "Trick Room", gravity: "Gravity", magicroom: "Magic Room",
  wonderroom: "Wonder Room", fairylock: "Fairy Lock", tailwind: "Tailwind", reflect: "Reflect", lightscreen: "Light Screen",
  auroraveil: "Aurora Veil", safeguard: "Safeguard", mist: "Mist", spikes: "Spikes", toxicspikes: "Toxic Spikes",
  stealthrock: "Stealth Rock", stickyweb: "Sticky Web", luckychant: "Lucky Chant", wideguard: "Wide Guard", quickguard: "Quick Guard", wish: "Wish", futuresight: "Future Sight",
};
/** Base turns, and the item that lengthens it to 8 (pinned data/moves.ts durationCallback: rocks, Light Clay, Terrain Extender). */
const DURATION: Record<string, { base: number; item?: string }> = {
  sunnyday: { base: 5, item: "heatrock" }, raindance: { base: 5, item: "damprock" }, sandstorm: { base: 5, item: "smoothrock" },
  snowscape: { base: 5, item: "icyrock" }, hail: { base: 5, item: "icyrock" },
  electricterrain: { base: 5, item: "terrainextender" }, grassyterrain: { base: 5, item: "terrainextender" },
  mistyterrain: { base: 5, item: "terrainextender" }, psychicterrain: { base: 5, item: "terrainextender" },
  reflect: { base: 5, item: "lightclay" }, lightscreen: { base: 5, item: "lightclay" }, auroraveil: { base: 5, item: "lightclay" },
  tailwind: { base: 4 }, trickroom: { base: 5 }, gravity: { base: 5 }, magicroom: { base: 5 }, wonderroom: { base: 5 },
  safeguard: { base: 5 }, mist: { base: 5 }, luckychant: { base: 5 }, fairylock: { base: 2 }, wish: { base: 2 }, futuresight: { base: 3 },
};

export type BoardArgs = {
  battle: Battle; tracker: { state(): PublicState }; sheet: SheetView; info: InfoView; keys: MemberKeys; runtime: BattleRuntime;
  /** Your members' keys in team (sheet) order. */
  ownKeys: readonly string[];
  /** Member keys (both sides) whose battle name is on both teams (BoardView.mirrored); default none. */
  mirrored?: readonly string[];
};

export function buildBoard({ battle, tracker, sheet, info, keys, runtime, ownKeys, mirrored = [] }: BoardArgs): BoardView {
  const state = tracker.state();
  const keyOf = (pokemon: Pokemon) => keys.keyOf(pokemon.side.id, pokemon.name);
  const species = (id: string) => runtime.speciesById.get(id);
  const name = (id: string, fallback: string) => species(id)?.name ?? fallback;

  // ---------- Your side: the real battle ----------
  const ownView = (pokemon: Pokemon): PokemonView => {
    const set = pokemon.set;
    const setItem = toID(set.item);
    const item: ItemView = pokemon.item
      ? { state: "held", id: pokemon.item, name: runtime.itemsById.get(pokemon.item)?.name ?? pokemon.item }
      : pokemon.lastItem ? { state: "consumed", id: pokemon.lastItem, name: runtime.itemsById.get(pokemon.lastItem)?.name ?? pokemon.lastItem }
        : setItem ? { state: "removed", id: setItem, name: runtime.itemsById.get(setItem)?.name ?? set.item } : { state: "none" };
    // A fainted active stays in side.active until it is replaced, though fainting clears isActive (PS/sim/battle.ts:2566).
    const inSlot = battle.p1.active[pokemon.position] === pokemon;
    return {
      key: keyOf(pokemon), ident: pokemon.fullname, side: "own", slot: inSlot ? SLOT.p1[pokemon.position] : null,
      speciesId: pokemon.species.id, name: name(pokemon.species.id, pokemon.species.name), types: [...pokemon.types],
      hp: { kind: "exact", current: pokemon.hp, maximum: pokemon.maxhp }, fainted: pokemon.fainted, status: pokemon.status as BattleStatus,
      boosts: Object.fromEntries(Object.entries(pokemon.boosts).filter(([, value]) => value !== 0)),
      volatiles: pokemon.isActive ? realVolatiles(pokemon, runtime) : [],
      item, ability: { id: pokemon.ability, name: runtime.abilitiesById.get(pokemon.ability)?.name ?? pokemon.ability },
      nature: set.nature, points: Object.fromEntries(STATS.map((stat) => [stat, set.evs[stat] ?? 0])) as Record<BattleStat, number>,
      moves: pokemon.moveSlots.map((slot) => ({ id: slot.id, name: runtime.movesById.get(slot.id)?.name ?? slot.move, pp: slot.pp, maxpp: slot.maxpp })),
      mega: !!pokemon.species.isMega, revealed: true, brought: true,
      ...(pokemon.volatiles.commanding ? { commanding: true } : {}),
    };
  };
  const ownTeam = [...battle.p1.pokemon].sort((a, b) => ownKeys.indexOf(keyOf(a)) - ownKeys.indexOf(keyOf(b))).map(ownView);

  // ---------- The AI's side: the p1 tracker + the sheet as youSee allows ----------
  const realAI = new Map(battle.p2.pokemon.map((pokemon) => [keyOf(pokemon), pokemon]));
  // After team preview the side holds only the brought four (pinned sim/side.ts chooseTeam).
  const broughtKnown = battle.p2.pokemon.length < sheet.members.length;
  const foeView = (member: SheetMember): PokemonView => {
    const mon: PublicMon | undefined = state.mons[`p2:${member.key}`];
    const real = realAI.get(member.key);
    const speciesId = mon?.speciesId ?? member.speciesId;
    const shownItem = mon?.item ?? { state: "not-shown" as const };
    let item: ItemView;
    if (shownItem.state === "gone") item = { state: shownItem.how, id: shownItem.itemId, name: runtime.itemsById.get(shownItem.itemId)?.name ?? shownItem.itemId };
    else if (shownItem.state === "held") item = { state: "held", id: shownItem.itemId, name: runtime.itemsById.get(shownItem.itemId)?.name ?? shownItem.itemId };
    else if (member.itemId === null) item = { state: "unknown" };
    else if (member.itemId === "") item = { state: "none" };
    else item = { state: "held", id: member.itemId, name: runtime.itemsById.get(member.itemId)?.name ?? member.itemId };
    // A Mega form has one ability of its own (catalog): shown once it Mega Evolved even before it acts.
    const megaAbility = mon?.mega ? species(speciesId)?.abilities[0] ?? null : null;
    const abilityId = mon?.ability?.abilityId ?? megaAbility ?? member.abilityId;
    const used = Object.keys(mon?.movesUsed ?? {});
    const moves = member.moves ? [...member.moves] : used;
    // "Test: exact HP" covers members you have seen; the unseen ones too only with "Test: brought Pokémon" (SPEC 4.1).
    const exact = info.exactHP && real && (info.brought || (mon?.switchIns ?? 0) > 0) ? { kind: "exact" as const, current: real.hp, maximum: real.maxhp } : null;
    return {
      key: member.key, ident: `p2: ${member.name}`, side: "opponent",
      slot: mon && mon.position !== null ? SLOT.p2[mon.position] : null,
      speciesId, name: name(speciesId, member.name), types: [...(species(speciesId)?.types ?? [])],
      hp: exact ?? { kind: "percent", percent: mon ? mon.hp.percent : 100, ...(mon?.hp.color ? { color: mon.hp.color } : {}) },
      fainted: !!mon?.fainted, status: mon?.status ?? "",
      boosts: Object.fromEntries(Object.entries(mon?.boosts ?? {}).filter(([, value]) => value !== 0)),
      volatiles: mon && mon.position !== null ? volatileNames(mon.volatiles, runtime) : [],
      item, ability: abilityId ? { id: abilityId, name: runtime.abilitiesById.get(abilityId)?.name ?? abilityId } : null,
      nature: member.nature, points: member.points ? { ...member.points } : null,
      moves: moves.map((id) => ({ id, name: runtime.movesById.get(id)?.name ?? id })),
      ...(member.moves ? {} : { unseenMoves: Math.max(0, 4 - used.length) }),
      mega: !!mon?.mega, revealed: !!mon && mon.switchIns > 0,
      brought: info.brought && broughtKnown ? realAI.has(member.key) : null,
    };
  };
  const foeTeam = sheet.members.map(foeView);

  const active = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, null])) as Record<DoublesSlotId, PokemonView | null>;
  for (const view of ownTeam) if (view.slot) active[view.slot] = view;
  for (const view of foeTeam) if (view.slot) active[view.slot] = view;

  return {
    turn: state.turn, active, team: { own: ownTeam, opponent: foeTeam },
    field: fieldView(state, battle, sheet, runtime, keys),
    megaUsed: { own: state.sides.p1.megaUsed, opponent: state.sides.p2.megaUsed },
    mirrored: [...mirrored],
  };
}

/** Durations from the tracker's start turn: yours with your item; the AI's only when its item is shown or open, else null. */
function fieldView(state: PublicState, battle: Battle, sheet: SheetView, runtime: BattleRuntime, keys: MemberKeys): FieldView {
  const ownItems = new Map(battle.p1.pokemon.map((pokemon) => [`p1:${keys.keyOf("p1", pokemon.name)}`, pokemon.item || toID(pokemon.set.item)]));
  const itemOf = (setterKey: string | null): string | null | undefined => {
    if (!setterKey) return undefined;
    if (setterKey.startsWith("p1:")) return ownItems.get(setterKey) ?? "";
    const shown = state.mons[setterKey]?.item;
    if (shown?.state === "held") return shown.itemId;
    if (shown?.state === "gone") return shown.itemId;
    return sheet.members.find((member) => `p2:${member.key}` === setterKey)?.itemId ?? null;
  };
  const effect = (condition: PublicCondition): FieldEffectView => {
    const rule = DURATION[condition.id];
    const label = FIELD_NAMES[condition.id] ?? condition.id;
    // Wish and Future Sight carry their slot in layers (sim/tracker.ts); hazards their layer count.
    const name = condition.layers > 1 && !["wish", "futuresight"].includes(condition.id) ? `${label} (${condition.layers})` : label;
    if (!rule) return { id: condition.id, name, turns: null };
    let base = rule.base;
    if (rule.item) {
      const item = itemOf(condition.setterKey);
      if (item === null) return { id: condition.id, name, turns: null };
      if (item === rule.item) base = 8;
    }
    return { id: condition.id, name, turns: Math.max(1, base - (state.turn - condition.since)) };
  };
  const weather = state.field.weather
    ? ["desolateland", "primordialsea", "deltastream"].includes(state.field.weather.id)
      ? { id: state.field.weather.id, name: FIELD_NAMES[state.field.weather.id] ?? state.field.weather.id, turns: null }
      : effect(state.field.weather)
    : null;
  return {
    weather, terrain: state.field.terrain ? effect(state.field.terrain) : null,
    rooms: state.field.rooms.map(effect),
    sides: { own: state.sides.p1.conditions.map(effect), opponent: state.sides.p2.conditions.map(effect) },
  };
}
