import { settleDoublesStart, usesHelpers } from "./calculate";
import { REASONS } from "./doubles-actions";
import { allyOf, DOUBLES_SLOTS, type DoublesSlotId, type DoublesTurnInput } from "./doubles-types";
import { marginal, type PendingAction, type World } from "./doubles-world";
import type { TurnKernel } from "./doubles-turn";
import { berryArithmetic, HEALING_BERRIES, PINCH_STAT_BERRIES } from "./hit-loop";
import type { BattleRuntime } from "./runtime";
import { itemTakeable } from "./uses-to-ko";
import type { BattleBuild, ChampionsMove, CombatStat } from "./types";

// Items moved by Trick and Switcheroo (status-eot ADDENDUM §4.12): Track E's file. The item change is per world
// (MonState.build.itemId), as Knock Off, Bug Bite and eaten Berries change it, so every later calculation, Speed sort
// (generation 8 on; generation 7 keeps its frozen keys), grounding and the end of turn read the new holder;
// World.itemsMoved keeps Symbiosis out (doubles-turn.ts eventGuards). Track A's doubles-status.ts runs the move's
// pipeline (the Protect family, Good as Gold, Psychic Terrain, Sticky Hold's TryImmunity, Prankster vs Dark, a
// Substitute, Neutralizing Gas's guard) and calls swapItems through the status table's handler key `swapItems`, then the
// action's Update (Berries and Mental Herb). Pinned Showdown c23d2e94: data/moves.ts:19870-19906 (trick), :18645-18690
// (switcheroo; data/mods/gen7/moves.ts:952-983 is equivalent), sim/pokemon.ts takeItem and setItem (:1868-1889).

/** The Seeds and the terrain each is used in (data/items.ts electricseed and its kin onStart / onTerrainChange). */
const SEED_TERRAINS: Readonly<Record<string, string>> = { electricseed: "Electric", grassyseed: "Grassy", mistyseed: "Misty", psychicseed: "Psychic" };
/** The curing Berries' statuses (data/items.ts lumberry, cheriberry, chestoberry, pechaberry, rawstberry, aspearberry onUpdate). */
const CURES: Readonly<Record<string, readonly string[]>> = {
  lumberry: ["par", "brn", "psn", "tox", "slp", "frz"], cheriberry: ["par"], chestoberry: ["slp"], pechaberry: ["psn", "tox"], rawstberry: ["brn"], aspearberry: ["frz"],
};
const STATS: CombatStat[] = ["atk", "def", "spa", "spd", "spe"];
/** A stage below 0 that White Herb restores: its stats', or this turn's accuracy or evasion (MoveVolatiles.stages). */
const lowered = (mon: World["mons"][DoublesSlotId] & object) => STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < 0) || Object.values(mon.vol.stages ?? {}).some((stage) => (stage ?? 0) < 0);

const paradoxes = new WeakMap<BattleRuntime, (speciesId: string) => boolean>();
/** UsesHelpers.paradox for a runtime (a Paradox Pokémon's Booster Energy cannot be moved). */
function paradoxOf(runtime: BattleRuntime): (speciesId: string) => boolean {
  let paradox = paradoxes.get(runtime);
  if (!paradox) paradoxes.set(runtime, paradox = usesHelpers(runtime).paradox);
  return paradox;
}

/** The species takeItem's handlers read (data/items.ts onTakeItem: baseSpecies; a transformed Pokémon keeps its own, uses-to-ko.ts takeable). */
const speciesOf = (build: BattleBuild) => build.transformedFrom?.speciesId ?? build.speciesId;

/**
 * Trick and Switcheroo's onHit (data/moves.ts:19878-19906), with a = the user's item and b = the target's in this world:
 * - both item-less: fails ({Move} fails: neither holds an item.);
 * - an item that cannot move (its onTakeItem with its holder, takeItem's runEvent, and with its receiver, the move's
 *   singleEvent('TakeItem'): uses-to-ko.ts itemTakeable with thief): fails ({Move} fails: {Holder}'s {Item} cannot be moved.);
 * - otherwise the two builds' items swap (World.itemsMoved: no Symbiosis for the takeItem and setItem, T11), with the
 *   step fact; Unburden (receive), then each receiver's item on receipt (receive), the target first, then the user.
 */
export function swapItems(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, move: ChampionsMove): World[] {
  const user = action.slot;
  const giver = w.mons[user]!, holder = w.mons[target]!;
  const a = giver.build.itemId, b = holder.build.itemId;
  if (!a && !b) {
    kernel.stepFact(action, `${move.name} fails: neither holds an item.`, w.mass);
    return [w];
  }
  const paradox = paradoxOf(kernel.runtime);
  // takeItem on the target first (yourItem), then on the user (myItem); either failing fails the move.
  const stuck = b && !itemTakeable(kernel.runtime, paradox, b, speciesOf(holder.build), speciesOf(giver.build), true) ? { slot: target, item: b }
    : a && !itemTakeable(kernel.runtime, paradox, a, speciesOf(giver.build), speciesOf(holder.build), true) ? { slot: user, item: a } : null;
  if (stuck) {
    kernel.stepFact(action, `${move.name} fails: ${kernel.names[stuck.slot]}'s ${kernel.itemName(stuck.item)} cannot be moved.`, w.mass);
    return [w];
  }
  const before = { [user]: giver.build, [target]: holder.build } as Record<DoublesSlotId, BattleBuild>;
  giver.build = { ...giver.build, itemId: b };
  holder.build = { ...holder.build, itemId: a };
  w.itemsMoved = [user, target];
  const item = (id: string) => kernel.itemName(id);
  const fact = a && b ? `${move.name}: ${kernel.names[user]} gets ${item(b)}, ${kernel.names[target]} gets ${item(a)}.`
    : a ? `${move.name}: ${kernel.names[target]} gets ${item(a)}; ${kernel.names[user]} gets nothing.`
      : `${move.name}: ${kernel.names[user]} gets ${item(b)}; ${kernel.names[target]} gets nothing.`;
  kernel.stepFact(action, fact, w.mass);
  for (const slot of [target, user]) unburden(w, slot, before[slot]);
  // setItem's Start for each receiver, in onHit order: the target, then the user (sim/pokemon.ts setItem).
  if (a) receive(kernel, w, action, target);
  if (b) receive(kernel, w, action, user);
  return [w];
}

/**
 * Unburden (data/abilities.ts:5235-5252; T7, T7b): takeItem gives its holder the unburden volatile, whose Speed doubles
 * while it holds nothing; the volatile stays. In effect after the move: it held an item before it (or Unburden was
 * already on) and holds none now.
 */
function unburden(w: World, slot: DoublesSlotId, before: BattleBuild) {
  const mon = w.mons[slot]!;
  if (mon.build.abilityId !== "unburden") return;
  mon.build = { ...mon.build, abilityActive: (!!before.itemId || before.abilityActive) && !mon.build.itemId };
}

/**
 * The receiver's new item as setItem starts it (sim/pokemon.ts:1868-1889: singleEvent('Start'), skipped for an item its
 * holder ignores: Klutz, Magic Room; T4b). White Herb with a lowered stage is used at once: the lowered stages to 0, no
 * item, Unburden (T4 p2:147). A Terrain Seed in its terrain, Room Service under Trick Room, and Booster Energy for a
 * Protosynthesis or Quark Drive holder are used inside setItem too (T10c): not followed (REASONS.received). The others
 * change nothing this turn's numbers read but through the build (Air Balloon, Choice items, Utility Umbrella, Metronome,
 * Quick Claw's and the others' fixed fractional priority). A received item its holder uses this action (White Herb now,
 * a Berry or Mental Herb at the action's Update) runs AfterUseItem, where a partner's Symbiosis passes its own item:
 * not followed.
 */
function receive(kernel: TurnKernel, w: World, action: PendingAction, slot: DoublesSlotId) {
  const mon = w.mons[slot]!;
  const build = mon.build;
  const item = build.itemId;
  if (!kernel.itemWorks(w, build)) return;
  const partner = allyOf(slot);
  if (usedThisAction(kernel, w, slot, item) && kernel.alive(w, partner) && w.mons[partner]!.build.abilityId === "symbiosis" && w.mons[partner]!.build.itemId) {
    kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName("symbiosis")));
  }
  const received = () => kernel.notEstimated(REASONS.received(kernel.itemName(item), kernel.names[slot]));
  if (SEED_TERRAINS[item] && SEED_TERRAINS[item] === w.field.terrain) received();
  if (item === "roomservice" && w.field.trickRoom) received();
  if (item === "boosterenergy" && (build.abilityId === "protosynthesis" || build.abilityId === "quarkdrive")) received();
  if (item === "whiteherb" && lowered(mon)) {
    const boosts = { ...build.boosts };
    for (const stat of STATS) if ((boosts[stat] ?? 0) < 0) boosts[stat] = 0;
    mon.build = { ...build, boosts, itemId: "", ...(build.abilityId === "unburden" ? { abilityActive: true } : {}) };
    // This turn's accuracy and evasion stages too (data/items.ts whiteherb onStart reads every stage).
    if (mon.vol.stages) mon.vol = { ...mon.vol, stages: Object.fromEntries(Object.entries(mon.vol.stages).map(([stat, stage]) => [stat, Math.max(0, stage ?? 0)])) };
    kernel.stepFact(action, `${kernel.itemName("whiteherb")}: ${kernel.names[slot]}'s lowered stats are restored.`, w.mass);
  }
}

/**
 * Whether the receiver uses its new item in this action (useItem or eatItem, which run AfterUseItem): White Herb with a
 * lowered stage at once; at the action's Update, Mental Herb against Taunt, Encore, Disable or Heal Block, a curing Berry
 * against its status (Lum and Persim against confusion too), an HP or pinch Berry with some HP at or under its line (a
 * foe's Unnerve or As One stops a Berry, Berry Juice aside).
 */
function usedThisAction(kernel: TurnKernel, w: World, slot: DoublesSlotId, item: string): boolean {
  const mon = w.mons[slot]!;
  const build = mon.build;
  if (item === "whiteherb") return lowered(mon);
  if (item === "mentalherb") return !!(mon.vol.taunt || mon.vol.disabled || (mon.vol as { encore?: unknown }).encore || mon.eot.healBlock);
  if (!item.endsWith("berry") && item !== "berryjuice") return false;
  if (item !== "berryjuice" && kernel.berryStopped(w, slot)) return false;
  if (CURES[item]?.includes(build.status)) return true;
  if ((item === "lumberry" || item === "persimberry") && mon.vol.confusion) return true;
  if (!(HEALING_BERRIES.has(item) || PINCH_STAT_BERRIES[item] || item === "lansatberry" || item === "starfberry") || item === "enigmaberry") return false;
  const line = berryArithmetic(item, { ...kernel.hp[slot], ability: build.abilityId }, kernel.runtime.profile.generation).line;
  return [...marginal(w, slot).keys()].some((hp) => hp > 0 && hp <= line);
}

const startItems = new WeakMap<DoublesTurnInput, Partial<Record<DoublesSlotId, string>>>();
/** Each Pokémon's item as the turn starts, after the items used then (calculate.ts settleDoublesStart's folded builds). */
function startItemsOf(input: DoublesTurnInput): Partial<Record<DoublesSlotId, string>> {
  let items = startItems.get(input);
  if (!items) {
    const settle = settleDoublesStart(input);
    items = Object.fromEntries(DOUBLES_SLOTS.flatMap((slot) => settle.slots[slot] ? [[slot, settle.slots[slot]!.folded.itemId]] : []));
    startItems.set(input, items);
  }
  return items;
}

/**
 * Track E's item facts on `slot` in one world (DoublesHP.conditions; ADDENDUM §5): "Holds {Item}." or "Holds no item."
 * where its item differs from the one it held as the turn started (Trick, Switcheroo, Knock Off, Thief, an eaten Berry...).
 */
export function conditions(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  const mon = w.mons[slot];
  if (!mon || mon.fainted) return [];
  const start = startItemsOf(kernel.input)[slot] ?? "";
  const item = mon.build.itemId;
  if (item === start) return [];
  return [item ? `Holds ${kernel.itemName(item)}.` : "Holds no item."];
}
