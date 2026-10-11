# Integration 1b (INTEGRATION-1A §2's G4-FLG-09-sv; SPEC2 D, guards.md §6 [E6]): Symbiosis after a Fling took its user's item.
from patchlib import rep
G = "doubles-guards.ts"
rep(G, 'import { usesHelpers } from "./calculate";', 'import { usesHelpers } from "./calculate";', "noop anchor")
rep(G, 'import type { TurnStepOutcome } from "./uses-to-ko";', 'import { itemTakeable, type TurnStepOutcome } from "./uses-to-ko";', "import itemTakeable")
rep(G, """  for (const world of worlds) for (const slot of DOUBLES_SLOTS) if (marked(world.mons[slot])?.flung) flingEnd(kernel, world, slot);
  return worlds;""", """  for (const world of worlds) for (const slot of DOUBLES_SLOTS) if (marked(world.mons[slot])?.flung) flingEnd(kernel, world, slot, action);
  return worlds;""", "afterAction call")
rep(G, """  flingEnd(kernel, w, attacker);
}""", """  flingEnd(kernel, w, attacker, action);
}""", "flingHit call")
rep(G, """/**
 * The `fling` volatile's onUpdate (PS/data/moves.ts:5774-5782): the item gone, lastItem and usedItemThisTurn (with item
 * history; a Cud Chew user's flung Berry counts as eaten: :5751-5753), AfterUseItem (Unburden; Symbiosis: the turn's
 * eventGuards). A Mirror Herb the user used before the action's Update (its copy at AfterMove) is not followed.
 */
function flingEnd(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const mon = marked(w.mons[slot])!;
  const flung = mon.flung!;
  delete mon.flung;
  if (mon.build.itemId !== flung.item) kernel.notEstimated(REASONS.combo(kernel.moveName("fling"), kernel.itemName(flung.item)));
  mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
  kernel.noteItemUse(w, slot, flung.item);
}""", """/**
 * The `fling` volatile's onUpdate (PS/data/moves.ts:5774-5782): the item gone, lastItem and usedItemThisTurn (with item
 * history; a Cud Chew user's flung Berry counts as eaten: :5751-5753), AfterUseItem (Unburden; a partner's Symbiosis:
 * symbiosisPass). A Mirror Herb the user used before the action's Update (its copy at AfterMove) is not followed.
 */
function flingEnd(kernel: TurnKernel, w: World, slot: DoublesSlotId, action: PendingAction) {
  const mon = marked(w.mons[slot])!;
  const flung = mon.flung!;
  delete mon.flung;
  if (mon.build.itemId !== flung.item) kernel.notEstimated(REASONS.combo(kernel.moveName("fling"), kernel.itemName(flung.item)));
  mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
  kernel.noteItemUse(w, slot, flung.item);
  symbiosisPass(kernel, w, action, slot);
}

/** The species takeItem's handlers read (data/items.ts onTakeItem: baseSpecies; a transformed Pokémon keeps its own). */
const takeSpecies = (build: BattleBuild) => build.transformedFrom?.speciesId ?? build.speciesId;

/**
 * Symbiosis after a Fling took its user's item (status2 integration 1b; data/abilities.ts symbiosis onAllyAfterUseItem, at the
 * `fling` volatile's AfterUseItem; guards.md §6 [E6], G4-FLG-09): the living partner's Symbiosis passes its own item to `slot`
 * at once: takeItem on the partner (no item history: no lastItem, no usedItemThisTurn), its item's TakeItem toward `slot` (an
 * item that cannot move stays, uses-to-ko.ts itemTakeable as Trick reads it), then setItem on `slot`, with the step fact.
 * `slot`'s Unburden keeps its volatile but doubles its Speed only while it holds nothing (abilityActive false while it holds the
 * item); both slots are World.itemsMoved (no Symbiosis guard reads the move). The passed item acts no sooner than the turn's
 * next Update unless it does at once or after Fling's hit, which the turn does not follow here and keeps narrow
 * (REASONS.combo("Fling", "Symbiosis")): a Berry its holder eats now (a due HP or pinch Berry, a curing one), a White Herb
 * with a lowered stage, a Mental Herb with a state it ends, a Terrain Seed in its terrain, Room Service under Trick Room,
 * Booster Energy for Protosynthesis or Quark Drive, and Life Orb or Shell Bell (their AfterMoveSecondarySelf after the hit).
 */
function symbiosisPass(kernel: TurnKernel, w: World, action: PendingAction, slot: DoublesSlotId) {
  const partner = allyOf(slot);
  const giver = w.mons[partner], mon = w.mons[slot]!;
  if (!giver || mon.fainted || !kernel.alive(w, partner) || giver.build.abilityId !== "symbiosis" || !giver.build.itemId) return;
  const item = giver.build.itemId;
  if (!itemTakeable(kernel.runtime, usesHelpers(kernel.runtime).paradox, item, takeSpecies(giver.build), takeSpecies(mon.build), true)) return;
  const received: BattleBuild = { ...mon.build, itemId: item, ...(mon.build.abilityId === "unburden" ? { abilityActive: false } : {}) };
  if (kernel.itemWorks(w, received)) {
    const narrow = () => kernel.notEstimated(REASONS.combo(kernel.moveName("fling"), kernel.abilityName("symbiosis")));
    const vol = mon.vol as typeof mon.vol & { encore?: unknown };
    const lowered = STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < 0) || Object.values(mon.vol.stages ?? {}).some((stage) => (stage ?? 0) < 0);
    const seeds: Record<string, string> = { electricseed: "Electric", grassyseed: "Grassy", mistyseed: "Misty", psychicseed: "Psychic" };
    if (item === "lifeorb" || item === "shellbell" || (item === "whiteherb" && lowered)) narrow();
    if (item === "mentalherb" && (vol.taunt || vol.disabled || vol.encore || mon.eot.healBlock || vol.attract || vol.torment)) narrow();
    if ((seeds[item] && seeds[item] === w.field.terrain) || (item === "roomservice" && w.field.trickRoom)) narrow();
    if (item === "boosterenergy" && (received.abilityId === "protosynthesis" || received.abilityId === "quarkdrive")) narrow();
    if ((item === "persimberry" || item === "lumberry") && mon.vol.confusion) narrow();
    if (item.endsWith("berry")) {
      const probe = cloneWorld(w);
      probe.mons[slot]!.build = received;
      if (kernel.berryDue(probe, slot).some((each) => each.mons[slot]!.build.itemId !== item)) narrow();
    }
  }
  giver.build = { ...giver.build, itemId: "" };
  mon.build = received;
  w.itemsMoved = [...new Set([...(w.itemsMoved ?? []), slot, partner])];
  kernel.stepFact(action, `${kernel.abilityName("symbiosis")}: ${kernel.names[partner]} passes ${kernel.names[slot]} its ${kernel.itemName(item)}.`, w.mass);
}""", "flingEnd + symbiosisPass")
