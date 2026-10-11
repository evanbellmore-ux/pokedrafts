import { usesHelpers } from "./calculate";
import { settleDoublesStart } from "./doubles-start";
import { REASONS } from "./doubles-actions";
import { DOUBLES_SLOTS, slotSide, type DoublesSlotId, type DoublesTurnInput } from "./doubles-types";
import { cloneWorld, mapHP, marginal, type PendingAction, type Stage, type World } from "./doubles-world";
import type { TurnKernel } from "./doubles-turn";
import * as guardNs from "./doubles-guards";
import { setEot, setVol, stageFact } from "./doubles-use";
import { berryArithmetic, HEALING_BERRIES, PINCH_STAT_BERRIES, stolenEat } from "./hit-loop";
import { NATURES } from "./model";
import type { BattleRuntime } from "./runtime";
import { itemTakeable } from "./uses-to-ko";
import type { BattleBuild, ChampionsMove, CombatStat } from "./types";

// The hook namespaces are copied once into plain objects: under tsx (the bench and the verify harness) a namespace
// import's member is a getter over the module's own export getter, while a plain object keeps each hook call one property
// load. No runtime import of these modules is in a cycle (tests/source/status2-hooks.test.ts), so each namespace is
// complete when this module runs, and every export is a function or a const.
const guardHooks = { ...guardNs };

// status2 (SPEC2 §4.4, ADDENDUM2 §4.2, F3 §5.4): Track A3's file. Besides Trick and Switcheroo below, the item moves of the
// field family live here: Bestow's one-way give (give), Corrosive Gas's take (takeAway), Recycle's restore (restore), the
// forced eat of Teatime and Stuff Cheeks (forceEat, which D's flung Berry calls with `flung`), and the received Seeds and
// Room Service used at once (receive; T2M §3.21). Each follows pinned Showdown c23d2e94 (sim/pokemon.ts eatItem, useItem,
// takeItem, setItem; data/moves.ts bestow, corrosivegas, recycle, teatime, stuffcheeks; data/items.ts).
//
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
/** The Seeds' boosts (data/items.ts electricseed and its kin: boosts). */
const SEED_STAGES: Readonly<Record<string, Partial<Record<CombatStat, number>>>> = { electricseed: { def: 1 }, grassyseed: { def: 1 }, mistyseed: { spd: 1 }, psychicseed: { spd: 1 } };
/** Status names in the cure facts (doubles-status.ts STATUS_NOUNS). */
const STATUS_NOUNS: Readonly<Record<string, string>> = { slp: "sleep", par: "paralysis", brn: "burn", psn: "poison", tox: "bad poison", frz: "freeze" };
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
 * item, Unburden (T4 p2:147). A Terrain Seed in its terrain and Room Service under Trick Room are used inside setItem too
 * (T10c; status2 T2M §3.21: useItem's boosts from the holder itself, so ChangeBoost (Contrary, Simple) and the cap apply and
 * no other Pokémon's TryBoost; the item used, Unburden); Booster Energy for a Protosynthesis or Quark Drive holder is not
 * followed (REASONS.received: a non-Paradox holder of either ability exists only after an ability change in battle). The
 * others change nothing this turn's numbers read but through the build (Air Balloon, Choice items, Utility Umbrella,
 * Metronome, Quick Claw's and the others' fixed fractional priority). A received item its holder uses this action (White
 * Herb, a Seed or Room Service now, a Berry or Mental Herb at the action's Update) runs AfterUseItem, where a partner's
 * Symbiosis passes its own item: not followed (D's guard).
 */
function receive(kernel: TurnKernel, w: World, action: PendingAction, slot: DoublesSlotId) {
  const mon = w.mons[slot]!;
  const build = mon.build;
  const item = build.itemId;
  if (!kernel.itemWorks(w, build)) return;
  // A partner's Symbiosis after the received item is used this action (D's doubles-guards.ts symbiosisReceived, moved verbatim).
  guardHooks.symbiosisReceived(kernel, w, slot, () => usedThisAction(kernel, w, slot, item));
  const received = () => kernel.notEstimated(REASONS.received(kernel.itemName(item), kernel.names[slot]));
  // A Seed in its terrain, Room Service under Trick Room (data/items.ts electricseed and its kin, roomservice onStart:
  // pokemon.useItem(), whose item.boosts boost the holder from itself: sim/pokemon.ts useItem).
  const used = SEED_TERRAINS[item] && SEED_TERRAINS[item] === w.field.terrain ? SEED_STAGES[item] : item === "roomservice" && w.field.trickRoom ? { spe: -1 } : null;
  if (used) {
    // useItem's order: the boost, then the item gone (lastItem, usedItemThisTurn), then AfterUseItem (Unburden).
    const changed = kernel.applyBoosts(w, slot, used, slot, { effect: "item" });
    mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
    kernel.noteItemUse(w, slot, item);
    const text = stageText(changed), where = SEED_TERRAINS[item] ? `on ${w.field.terrain} Terrain` : `under ${kernel.moveName("trickroom")}`;
    const line = `${kernel.itemName(item)} is used up ${where}${text ? `: ${text}` : ""}.`;
    // On the move's target, a hit fact; on its user (Trick's own receipt, Recycle), a step fact naming it.
    if (slot === action.slot) kernel.stepFact(action, `${kernel.names[slot]}'s ${line}`, w.mass);
    else kernel.hitFact(action, slot, `Its ${line}`, w.mass);
    return;
  }
  if (item === "boosterenergy" && (build.abilityId === "protosynthesis" || build.abilityId === "quarkdrive")) received();
  whiteHerb(kernel, w, action, slot);
}

/**
 * A held White Herb with a lowered stage used now (data/items.ts whiteherb onStart, onAnyAfterMove: every stage below 0,
 * accuracy and evasion included, to 0; the item gone, Unburden): on receipt (receive) and after Magic Room ends
 * (doubles-field.ts: its next AfterMove). The step fact "White Herb: {Name}'s lowered stats are restored."
 */
export function whiteHerb(kernel: TurnKernel, w: World, action: PendingAction, slot: DoublesSlotId) {
  const mon = w.mons[slot]!;
  const build = mon.build;
  if (build.itemId !== "whiteherb" || !lowered(mon)) return;
  const boosts = { ...build.boosts };
  for (const stat of STATS) if ((boosts[stat] ?? 0) < 0) boosts[stat] = 0;
  mon.build = { ...build, boosts, itemId: "", ...(build.abilityId === "unburden" ? { abilityActive: true } : {}) };
  // Item history (status2 F3 §4.1; a no-op unless the turn keeps it).
  kernel.noteItemUse(w, slot, "whiteherb");
  // This turn's accuracy and evasion stages too (data/items.ts whiteherb onStart reads every stage).
  if (mon.vol.stages) mon.vol = { ...mon.vol, stages: Object.fromEntries(Object.entries(mon.vol.stages).map(([stat, stage]) => [stat, Math.max(0, stage ?? 0)])) };
  kernel.stepFact(action, `${kernel.itemName("whiteherb")}: ${kernel.names[slot]}'s lowered stats are restored.`, w.mass);
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
  // status2 T2M §3.21: a Seed in its terrain, Room Service under Trick Room (used inside setItem).
  if ((SEED_TERRAINS[item] && SEED_TERRAINS[item] === w.field.terrain) || (item === "roomservice" && w.field.trickRoom)) return true;
  if (item === "mentalherb") return !!(mon.vol.taunt || mon.vol.disabled || (mon.vol as { encore?: unknown }).encore || mon.eot.healBlock);
  if (!item.endsWith("berry") && item !== "berryjuice") return false;
  if (item !== "berryjuice" && kernel.berryStopped(w, slot)) return false;
  if (CURES[item]?.includes(build.status)) return true;
  if ((item === "lumberry" || item === "persimberry") && mon.vol.confusion) return true;
  if (!(HEALING_BERRIES.has(item) || PINCH_STAT_BERRIES[item] || item === "lansatberry" || item === "starfberry") || item === "enigmaberry") return false;
  const line = berryArithmetic(item, { ...kernel.hp[slot], ability: build.abilityId }, kernel.runtime.profile.generation).line;
  return [...marginal(w, slot).keys()].some((hp) => hp > 0 && hp <= line);
}

/** The stages that changed, as a fact's list ("+1 Defense, −1 Speed"), or "". */
function stageText(changed: Partial<Record<Stage, number>>): string {
  return (Object.entries(changed) as [Stage, number][]).filter(([, by]) => by).map(([stat, by]) => stageFact(stat, by).slice(0, -1)).join(", ");
}

/**
 * Whether `item` can move from the Pokémon holding it (`holder`) to `receiver` (sim/pokemon.ts takeItem's TakeItem event on
 * its holder and, with `thief`, the item's own TakeItem toward its receiver): uses-to-ko.ts itemTakeable, as Trick reads it
 * (Mega Stones, Z-Crystals, the owned items, a Paradox Pokémon's Booster Energy stay).
 */
export function movable(kernel: TurnKernel, item: string, holder: BattleBuild, receiver: BattleBuild, thief: boolean): boolean {
  return itemTakeable(kernel.runtime, paradoxOf(kernel.runtime), item, speciesOf(holder), speciesOf(receiver), thief);
}

/**
 * Bestow's one-way give (data/moves.ts bestow onHit, after its own failures, which doubles-field.ts checks; F3 §5.4.2):
 * `user`'s item to `target`, which holds none: Trick's half (World.itemsMoved: no Symbiosis for the takeItem, and the
 * receiver's item acts at the action's Update through doubles-status.ts receivedItem), the giver's Unburden (onTakeItem),
 * then the receiver's item on receipt (setItem's Start: receive).
 */
export function give(kernel: TurnKernel, w: World, action: PendingAction, user: DoublesSlotId, target: DoublesSlotId) {
  const giver = w.mons[user]!, holder = w.mons[target]!;
  const item = giver.build.itemId;
  const before = { [user]: giver.build, [target]: holder.build } as Record<DoublesSlotId, BattleBuild>;
  giver.build = { ...giver.build, itemId: "" };
  holder.build = { ...holder.build, itemId: item };
  w.itemsMoved = [target, user];
  for (const slot of [user, target]) unburden(w, slot, before[slot]);
  receive(kernel, w, action, target);
}

/**
 * Corrosive Gas's takeItem on `slot` (data/moves.ts corrosivegas onHit, after the failures doubles-field.ts checks; F3
 * §5.4.1): the item gone with no item history (takeItem sets no lastItem), Unburden (onTakeItem), and World.itemsTaken
 * (takeItem runs no AfterUseItem, so no Symbiosis: F84).
 */
export function takeAway(w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot]!;
  const before = mon.build;
  mon.build = { ...mon.build, itemId: "" };
  unburden(w, slot, before);
  w.itemsTaken = [...(w.itemsTaken ?? []), slot];
}

/**
 * Recycle's restore (data/moves.ts recycle onHit: pokemon.lastItem = '', then setItem; F3 §5.4.3): `item` back on `slot`
 * (MonState.lastItem "" from now: none), Unburden off while it holds it, its Start (receive), and World.itemsMoved so the
 * action's Update eats a due Berry (doubles-status.ts receivedItem) and no Symbiosis reads the move.
 */
export function restore(kernel: TurnKernel, w: World, action: PendingAction, slot: DoublesSlotId, item: string) {
  const mon = w.mons[slot]!;
  const before = mon.build;
  mon.build = { ...mon.build, itemId: item };
  mon.lastItem = "";
  unburden(w, slot, before);
  w.itemsMoved = [...(w.itemsMoved ?? []).filter((each) => each !== slot), slot];
  receive(kernel, w, action, slot);
}

/** Why a held item does nothing (sim/pokemon.ts ignoringItem): Magic Room, Embargo, Klutz. */
export function ignoredBy(kernel: TurnKernel, w: World, build: BattleBuild): string {
  return w.field.magicRoom ? kernel.moveName("magicroom") : build.itemSuppressed ? kernel.moveName("embargo") : kernel.abilityName("klutz");
}

/**
 * A forced eat of Berry `item` by `slot` (pinned sim/pokemon.ts eatItem(true): Teatime, Stuff Cheeks; D's flung Berry with
 * `flung`, F3 §4.2), which `source` made it eat (Teatime's user, Stuff Cheeks' own; null for a flung Berry): no TryEatItem,
 * so no HP line, no Unnerve or As One, no Berserk lock. Then:
 * - singleEvent('Eat') (hit-loop.ts stolenEat), skipped when the eater ignores its item (Magic Room, Embargo, Klutz:
 *   sim/battle.ts singleEvent): the heal through TryHeal (none at full HP or under Heal Block; Ripen doubles it), the cures
 *   (Lum and Persim end a confusion too), the stages through boost() from `source` (Contrary, Simple, Ripen; a drop from
 *   another Pokémon meets its TryBoost: Mist, Clear Body, Mirror Armor, Defiant; `breaks`: the move's Mold Breaker passes
 *   the eater's breakable abilities), a Figy-family Berry's confusion (its Nature; Own Tempo, Misty Terrain under it, and
 *   Safeguard against another Pokémon stop it), Lansat's focus, Starf's random +2 (one world per stat);
 * - runEvent('EatItem'), which eatItem always runs: Cheek Pouch's third (none under Heal Block), Ripen's weakened Berry
 *   (a resist Berry: vol.berryWeaken, D's marker; F3 §5.4.4);
 * - a held Berry is then gone (lastItem, usedItemThisTurn: noteItemUse) with Unburden (AfterUseItem); a flung one is not
 *   held: no item change, no item history.
 * `fact` writes the eater's facts: "Eats its Sitrus Berry." (not for a flung one), "Eats its Sitrus Berry: no effect
 * (Magic Room).", "Its burn is cured.", "Liechi Berry: +1 Attack.", "Figy Berry: it becomes confused."; the heals go to
 * the heals list ("Sitrus Berry: +58 HP.", "Cheek Pouch: +47 HP.").
 */
export function forceEat(kernel: TurnKernel, w: World, action: PendingAction, slot: DoublesSlotId, item: string, source: DoublesSlotId | null,
  opts: { fact: (world: World, text: string) => void; flung?: true; breaks?: boolean }): World[] {
  const mon = w.mons[slot];
  if (!mon || mon.fainted) return [w];
  const build = mon.build;
  const name = kernel.itemName(item);
  const ignored = !kernel.itemWorks(w, build);
  const eat = stolenEat(item, { baseMaxHP: kernel.hp[slot].baseMaxHP, ability: build.abilityId, ignoresItem: ignored }, kernel.runtime.profile.generation);
  if (!opts.flung) opts.fact(w, ignored ? `Eats its ${name}: no effect (${ignoredBy(kernel, w, build)}).` : `Eats its ${name}.`);
  let worlds: World[] = [w];
  if (!ignored) {
    if (eat.heal) worlds = worlds.flatMap((world) => heal(kernel, world, slot, eat.heal, action, name).map((part) => part.world));
    worlds = worlds.flatMap((world) => eaten(kernel, world, slot, item, eat, source, opts));
  }
  for (const world of worlds) {
    if (!kernel.alive(world, slot)) continue;
    // EatItem (sim/pokemon.ts eatItem: runEvent('EatItem') whatever the Eat did): Cheek Pouch, Ripen.
    kernel.pouchHeal(world, slot);
    if (eat.weakens) setVol(world, slot, { berryWeaken: true });
    if (opts.flung) continue;
    const held = world.mons[slot]!;
    held.build = { ...held.build, itemId: "", ...(held.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
    kernel.noteItemUse(world, slot, item);
  }
  return worlds;
}

/** The Eat's effects past the heal (forceEat): cures, stages, confusion, Lansat, Starf (one world per stat). */
function eaten(kernel: TurnKernel, w: World, slot: DoublesSlotId, item: string, eat: ReturnType<typeof stolenEat>, source: DoublesSlotId | null,
  opts: { fact: (world: World, text: string) => void; breaks?: boolean }): World[] {
  const mon = w.mons[slot]!;
  if (mon.fainted) return [w];
  const name = kernel.itemName(item);
  const status = mon.build.status;
  if (status && eat.cures.includes(status)) {
    mon.build = { ...mon.build, status: "" };
    if (status === "slp") setVol(w, slot, { sleep: undefined });
    if (status === "frz") setVol(w, slot, { freeze: undefined });
    if (status === "tox") setEot(w, slot, { toxic: undefined });
    opts.fact(w, `Its ${STATUS_NOUNS[status]} is cured.`);
  }
  if (eat.curesConfusion && mon.vol.confusion) {
    setVol(w, slot, { confusion: undefined });
    opts.fact(w, "Its confusion is cured.");
  }
  const boostFrom = source ?? slot;
  const raise = (world: World, stages: Partial<Record<CombatStat, number>>) => {
    const changed = kernel.applyBoosts(world, slot, stages, boostFrom, { effect: "item", ...(opts.breaks !== undefined ? { broken: opts.breaks } : {}) });
    const text = stageText(changed);
    if (text) opts.fact(world, `${name}: ${text}.`);
  };
  if (Object.keys(eat.stages).length) raise(w, eat.stages);
  if (eat.confuses && berryConfuses(kernel, w, slot, eat.confuses, source, !!opts.breaks)) opts.fact(w, `${name}: it becomes confused.`);
  if (eat.focusEnergy && !mon.build.focusEnergy && !mon.build.settledFocusEnergy && !mon.build.dragonCheer) {
    mon.build = { ...mon.build, settledFocusEnergy: true };
    opts.fact(w, `${name}: Focus Energy, +2 critical-hit stages.`);
  }
  if (!eat.starf) return [w];
  // Starf Berry (data/items.ts starfberry onEat: this.sample over the stats below +6, accuracy and evasion aside).
  const open = STATS.filter((stat) => (mon.build.boosts[stat] ?? 0) < 6);
  if (!open.length) return [w];
  const share = w.mass / open.length;
  const worlds = open.map((_, index) => (index === 0 ? w : cloneWorld(w, share)));
  w.mass = share;
  open.forEach((stat, index) => raise(worlds[index], { [stat]: eat.starf! }));
  return worlds;
}

/**
 * A Figy-family Berry's confusion (data/items.ts figyberry and its kin onEat: addVolatile('confusion') when the eater's
 * Nature lowers that stat): Own Tempo (breakable: `broken`), an existing confusion, Misty Terrain under a grounded eater
 * that is not semi-invulnerable, and Safeguard on its side against another Pokémon's eat (the Eat's source: Teatime's
 * user) stop it (onTryAddVolatile). Whether it was confused.
 */
function berryConfuses(kernel: TurnKernel, w: World, slot: DoublesSlotId, stat: CombatStat, source: DoublesSlotId | null, broken: boolean): boolean {
  const mon = w.mons[slot]!;
  if (NATURES.find((nature) => nature.name === mon.build.nature)?.minus !== stat || mon.vol.confusion) return false;
  if (mon.build.abilityId === "owntempo" && !broken) return false;
  if (w.field.terrain === "Misty" && kernel.grounded(w, slot) && !mon.eot.hidden) return false;
  if (source && source !== slot && w.sides[slotSide(slot)].safeguard) return false;
  setVol(w, slot, { confusion: { attempts: 0, min: 2 } });
  return true;
}

/**
 * A heal of `amount` on `slot` (sim/battle.ts heal: at least 1, truncated; TryHeal: Heal Block; none at 0 HP or full HP;
 * capped at the maximum), as doubles-status.ts healWorlds does it (the heals list, DoublesHit.change). `healed`: whether it
 * healed in that world.
 */
export function heal(kernel: TurnKernel, w: World, slot: DoublesSlotId, amount: number, action: PendingAction, source: string): { world: World; healed: boolean }[] {
  const gain = Math.trunc(amount && amount <= 1 ? 1 : amount);
  const { maxHP } = kernel.hp[slot];
  if (w.mons[slot]!.eot.healBlock) return [{ world: w, healed: false }];
  return mapHP(w, slot, (hp) => {
    if (hp <= 0 || hp >= maxHP) return { hp, tag: "full" };
    const after = Math.min(maxHP, hp + gain);
    kernel.noteHeal(slot, source, after - hp);
    const stats = kernel.hitStats(action, slot);
    if (stats) stats.change = stats.change ? { min: Math.min(stats.change.min, after - hp), max: Math.max(stats.change.max, after - hp) } : { min: after - hp, max: after - hp };
    return { hp: after, tag: "healed" };
  }).map(({ world, tag }) => ({ world, healed: tag === "healed" }));
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
