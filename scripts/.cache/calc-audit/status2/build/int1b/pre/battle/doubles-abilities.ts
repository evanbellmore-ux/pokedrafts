import { MOLD_BREAKERS, REASONS, STRONG_WEATHERS } from "./doubles-actions";
import { allyOf, DOUBLES_SLOTS, foesOf, SHOWDOWN_POSITION, slotSide, type DoublesOutcomeMon, type DoublesSlotId } from "./doubles-types";
import { cloneWorld, mapHP, type MoveVolatiles, type PendingAction, type Stage, type World } from "./doubles-world";
import type { TurnKernel, TurnMoveInfo } from "./doubles-turn";
import * as fieldChangeNs from "./doubles-fieldchange";
import * as historyNs from "./doubles-history";
import * as typingNs from "./doubles-typing";
import { applyBoosts, whiteHerbAfterMove, writeStages } from "./doubles-stages";
import { gameOf, generation, hitFact, setEot, setVol, STAGE_NAMES, type StatusHandler, type Use } from "./doubles-use";
import { abilityEntry, abilityFlag, type AbilityFlag } from "./ability-table";
import { GAS_STAND_IN } from "./calculate";
import { OWN_STATUS_CURES } from "./hit-loop";
import { TRANSFORM_LOCKED_ABILITIES } from "./imposter";
import { getBuildGender, isMaxActive } from "./mechanics";
import { defaultAbilityActive } from "./model";
import type { StatusEntry } from "./status-table";
import type { BattleBuild, ChampionsMove, CombatStat } from "./types";

// The hook namespaces are copied once into plain objects: under tsx (the bench and the verify harness) a namespace
// import's member is a getter over the module's own export getter, while a plain object keeps each hook call one property
// load. No runtime import of these modules is in a cycle (tests/source/status2-hooks.test.ts), so each namespace is
// complete when this module runs, and every export is a function or a const.
const fieldChangeHooks = { ...fieldChangeNs };
const historyHooks = { ...historyNs };
const typingHooks = { ...typingNs };

// Stats, abilities and Transform (status2 SPEC2 §2.2's A1 rows, §4.2; ADDENDUM2 §4.2; F1 = design/stats-abilities-transform.md):
// Track A1's file. The thirty status moves' handlers (HANDLERS, by status-table key: doubles-status.ts dispatches them at its
// own steps), the ability change in pinned Showdown c23d2e94's order (PS/sim/pokemon.ts setAbility, PS/sim/battle.ts skillSwap,
// PS/sim/pokemon.ts transformInto) with the per-game ability table (ability-table.ts) and the Start and End handlers that act
// when an ability is gained or lost mid-turn (ABILITY_STARTS, ABILITY_ENDS), Intimidate's Start (applyBoosts' `intimidate`),
// the Update's cures of a changed ability, Spit Up's Try and AfterMove. Every number follows pinned Showdown in Scarlet/Violet,
// Champions, Sword/Shield and Ultra Sun/Ultra Moon; what the turn does not follow is not estimated with a fact.

/** How an ability changes (F1 §3.4.2). */
export type AbilityChange = "skillswap" | "roleplay" | "entrainment" | "simplebeam" | "worryseed" | "doodle" | "transform" | "trace";

/**
 * A1's volatiles beyond doubles-world.ts MoveVolatiles (read and written only here): `transform`, a Transform this turn
 * (the Pokémon it copied: "Transformed into {Target}.") and `inert`, its copied ability that does nothing while it is
 * transformed (the notransform flag, the form abilities that check `transformed`: the build holds GAS_STAND_IN).
 */
type A1Vol = MoveVolatiles & { transform?: { into?: DoublesSlotId; inert?: string }; trappers?: DoublesSlotId[] };
const volOf = (w: World, slot: DoublesSlotId) => w.mons[slot]!.vol as A1Vol;
/**
 * The trapped volatile now (data/conditions.ts trapped): one from an earlier turn (DoublesCarried.trapped: its trapper is not
 * known), or this turn's while a Pokémon that set it has not fainted (Block, Mean Look, Spider Web: addVolatile('trapped',
 * source, move, 'trapper') links it to the user; PS/sim/pokemon.ts clearVolatile at a faint runs removeLinkedVolatiles).
 */
function trappedNow(w: World, slot: DoublesSlotId): boolean {
  const vol = volOf(w, slot);
  return !!vol.trapped && (!vol.trappers || vol.trappers.some((source) => !w.mons[source]?.fainted));
}

const STAGES: readonly Stage[] = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"];
const COMBAT: readonly CombatStat[] = ["atk", "def", "spa", "spd", "spe"];
/** pinned Showdown's modify (sim/battle.ts): tr((tr(value × tr(ratio × 4096)) + 2047) / 4096). */
const modify = (value: number, ratio: number) => Math.trunc((Math.trunc(value * Math.trunc(ratio * 4096)) + 2047) / 4096);
const stageOf = (w: World, slot: DoublesSlotId, stat: Stage) => {
  const mon = w.mons[slot]!;
  return stat === "accuracy" || stat === "evasion" ? mon.vol.stages?.[stat] ?? 0 : mon.build.boosts[stat as CombatStat] ?? 0;
};
const stagesOf = (w: World, slot: DoublesSlotId, stats: readonly Stage[] = STAGES) => Object.fromEntries(stats.map((stat) => [stat, stageOf(w, slot, stat)])) as Partial<Record<Stage, number>>;
const flag = (kernel: TurnKernel, ability: string, name: AbilityFlag) => abilityFlag(ability, gameOf(kernel), name);
/** The living Pokémon of the field in pinned getAllActive order (side 1, then side 2; each by its Showdown position now). */
function allActive(kernel: TurnKernel, w: World): DoublesSlotId[] {
  const order = (slot: DoublesSlotId) => {
    const at = SHOWDOWN_POSITION[kernel.positionOf(w, slot)];
    return at.side * 2 + at.position;
  };
  return DOUBLES_SLOTS.filter((slot) => kernel.alive(w, slot) && slot !== w.ghost).sort((a, b) => order(a) - order(b));
}
/** `slot`'s living foes by Showdown position (pinned adjacentFoes: in doubles every foe is adjacent). */
const foesIn = (kernel: TurnKernel, w: World, slot: DoublesSlotId) => allActive(kernel, w).filter((other) => kernel.isFoe(other, slot));
/** `slot`'s living partner (pinned allies(), adjacentAllies()), or null. */
const partnerOf = (kernel: TurnKernel, w: World, slot: DoublesSlotId) => {
  const ally = allyOf(slot);
  return kernel.alive(w, ally) && ally !== w.ghost ? ally : null;
};
/** n worlds of one each (a uniform random pick: pinned sample), `w` the last. */
function split(w: World, n: number): World[] {
  if (n <= 1) return [w];
  const out = Array.from({ length: n - 1 }, () => cloneWorld(w, w.mass / n));
  w.mass /= n;
  return [...out, w];
}

// ------------------------------------------------------------------------------------------------------------------
// The Pokémon's own ability and its suppression
// ------------------------------------------------------------------------------------------------------------------

/**
 * `slot`'s own ability (pinned pokemon.ability: Gastro Acid and an inert copy do not change it): under Gastro Acid
 * MoveVolatiles.gastroAcid, a transformed Pokémon's inert copy A1Vol.transform.inert, under Neutralizing Gas from the
 * turn's start the ability its stand-in replaced (DoublesGas.abilities); otherwise the build's.
 */
export function realAbility(kernel: TurnKernel, w: World, slot: DoublesSlotId): string {
  const mon = w.mons[slot]!;
  const vol = mon.vol as A1Vol;
  if (vol.gastroAcid !== undefined) return vol.gastroAcid;
  if (vol.transform?.inert) return vol.transform.inert;
  if (mon.build.abilityId === GAS_STAND_IN) return kernel.gas?.abilities[slot] ?? GAS_STAND_IN;
  return mon.build.abilityId;
}
/** Its ability does nothing now (pinned ignoringAbility): the build holds the stand-in (Gastro Acid, an inert copy, the gas). */
const suppressed = (w: World, slot: DoublesSlotId) => w.mons[slot]!.build.abilityId === GAS_STAND_IN;
/** A working Ability Shield (data/items.ts abilityshield onSetAbility: the item's handler, not under Embargo, Magic Room or Klutz). */
const shielded = (kernel: TurnKernel, w: World, slot: DoublesSlotId) => {
  const build = w.mons[slot]!.build;
  return build.itemId === "abilityshield" && kernel.itemWorks(w, build);
};
/** Its copied ability does nothing while it is transformed (pinned ignoringAbility notransform; the form abilities' own `transformed` checks). */
const inertWhenTransformed = (kernel: TurnKernel, ability: string) => flag(kernel, ability, "notransform") || TRANSFORM_LOCKED_ABILITIES.has(ability);

// ------------------------------------------------------------------------------------------------------------------
// One action's ability changes: their context, and what waits for the move's end
// ------------------------------------------------------------------------------------------------------------------

/**
 * One move's ability changes (or another caller's): its use (facts), the active move's suppression of breakable abilities
 * read as it started (sim/battle.ts suppressingAbility: the move's ignoreAbility, from its user's Mold Breaker, Teravolt,
 * Turboblaze or, for a status move, Mycelium Might; an Ability Shield keeps it off, and from generation 8 the user's own),
 * and what waits for the move's end: each White Herb at AfterMove (onAnyAfterMove), the field's state before it (FC's
 * field change), the Unnerve and As One holders whose ability ended (their foes' Berries at the Update).
 */
type Change = {
  use?: Use;
  breaker: (holder: DoublesSlotId) => boolean;
  herbs: Set<DoublesSlotId>;
  unnerved: Set<DoublesSlotId>;
  field: string;
};
function changeOf(kernel: TurnKernel, w: World, use?: Use): Change {
  let breaker: Change["breaker"] = () => false;
  if (use) {
    const ability = w.mons[use.user]!.build.abilityId;
    if (MOLD_BREAKERS.has(ability) || (use.move.category === "Status" && ability === "myceliummight")) {
      const user = use.user, own = generation(kernel) < 8;
      breaker = (holder) => (holder !== user || own) && !shielded(kernel, w, holder);
    }
  }
  return { use, breaker, herbs: new Set(), unnerved: new Set(), field: fieldKey(kernel, w) };
}
const fieldKey = (kernel: TurnKernel, w: World) => `${w.field.weather}|${kernel.effectiveWeather(w)}|${w.field.terrain}`;
/**
 * The move's end for the changes it made: White Herb (onAnyAfterMove), a weather, effective weather or terrain change (FC's
 * changed: wave 1a, today's guard while a field-settled ability or item is in), then the Update's Berries an Unnerve that
 * ended no longer stops (kernel.unnerveEnds).
 */
function finish(kernel: TurnKernel, worlds: World[], c: Change): World[] {
  return worlds.flatMap((w) => {
    for (const slot of c.herbs) if (kernel.alive(w, slot)) whiteHerbAfterMove(kernel, w, slot, c.use);
    if (fieldKey(kernel, w) !== c.field) fieldChangeHooks.changed(kernel, w);
    return c.unnerved.size ? kernel.unnerveEnds(w, [...c.unnerved]) : [w];
  });
}
/** A fact about `slot` on the change's use: its hit entry where the use reached it, else a step fact naming it. */
function fact(kernel: TurnKernel, c: Change, w: World, slot: DoublesSlotId, text: string) {
  if (c.use) hitFact(kernel, c.use, slot, text, w);
}
/** A step fact of the change's use. */
function stepFact(kernel: TurnKernel, c: Change, w: World, text: string) {
  if (c.use) kernel.stepFact(c.use.action, text, w.mass);
}

// ------------------------------------------------------------------------------------------------------------------
// The ability change (PS/sim/pokemon.ts setAbility; PS/sim/battle.ts skillSwap; F1 §3.4)
// ------------------------------------------------------------------------------------------------------------------

/**
 * One ability change on `slot` (PS/sim/pokemon.ts setAbility): nothing for a fainted Pokémon; unless Transform's (a form
 * change), none to or from a cantsuppress ability, and a working Ability Shield blocks it (the SetAbility event); then the old
 * ability's End, a fresh ability state, the new ability's Start (not when Transform copied the same one; a suppressed or inert
 * ability starts nothing). History's entryChanged (N's tie order). The worlds, and whether it changed.
 */
function changeAbility(kernel: TurnKernel, w: World, slot: DoublesSlotId, ability: string, c: Change, how: AbilityChange, announce?: string): { worlds: World[]; done: boolean } {
  const mon = w.mons[slot]!;
  if (mon.fainted) return { worlds: [w], done: false };
  const old = realAbility(kernel, w, slot);
  if (how !== "transform") {
    if (flag(kernel, ability, "cantsuppress") || flag(kernel, old, "cantsuppress")) return { worlds: [w], done: false };
    if (shielded(kernel, w, slot)) {
      fact(kernel, c, w, slot, `${kernel.itemName("abilityshield")}: ${kernel.names[slot]} keeps ${kernel.abilityName(old)}.`);
      return { worlds: [w], done: false };
    }
  }
  // An ability the game's data does not list has no engine entry (Simple Beam in Champions: no Pokémon there has Simple).
  if (!kernel.runtime.abilitiesById.has(ability)) {
    const label = kernel.abilityName(ability);
    kernel.notEstimated(REASONS.notIn2v2(`${c.use?.move.name ?? "An ability change"} giving ${label === ability ? label.charAt(0).toUpperCase() + label.slice(1) : label}`));
  }
  // The change's own fact (pinned setAbility's -ability line comes before the new ability's Start).
  if (announce) stepFact(kernel, c, w, announce);
  endBefore(kernel, w, slot, old, c);
  switchAbility(kernel, w, slot, ability);
  endAfter(kernel, w, slot, old, c);
  historyHooks.entryChanged(kernel, w, slot);
  const worlds = how === "transform" && old === ability ? [w] : abilityStartIn(kernel, w, slot, c, "gained");
  return { worlds, done: true };
}

/**
 * The switch itself (PS/sim/pokemon.ts setAbility: `this.ability = ability`, a fresh abilityState): the build's ability with
 * its fresh state (model.ts defaultAbilityActive; the settled entry fields of the old one cleared; abilityChanged for the
 * validation); under Gastro Acid the volatile keeps it suppressed (MoveVolatiles.gastroAcid holds the new one) unless it is a
 * cantsuppress ability (pinned ignoringAbility); a transformed Pokémon's notransform or form ability is inert (the stand-in).
 * An Electromorphosis charge (the input's abilityActive) is the Pokémon's charge volatile, which stays (MonState.charged).
 */
function switchAbility(kernel: TurnKernel, w: World, slot: DoublesSlotId, ability: string) {
  const mon = w.mons[slot]!;
  const vol = mon.vol as A1Vol;
  const before = mon.build;
  if (before.abilityId === "electromorphosis" && before.abilityActive) mon.charged = true;
  const fresh: BattleBuild = { ...before, abilityActive: defaultAbilityActive(ability), abilityChanged: true };
  delete fresh.tracedAbility; delete fresh.settledDownload; delete fresh.settledBoostedStat; delete fresh.copiedIntimidateStored;
  const gastro = vol.gastroAcid !== undefined && !flag(kernel, ability, "cantsuppress");
  const inert = !!before.transformedFrom && inertWhenTransformed(kernel, ability);
  if (gastro) {
    mon.build = { ...fresh, abilityId: GAS_STAND_IN };
    setVol(w, slot, { gastroAcid: ability, ...(vol.transform?.inert ? { transform: vol.transform.into ? { into: vol.transform.into } : undefined } : {}) } as Partial<A1Vol>);
    return;
  }
  if (vol.gastroAcid !== undefined) setVol(w, slot, { gastroAcid: ability });
  mon.build = { ...fresh, abilityId: inert ? GAS_STAND_IN : ability };
  if (inert || vol.transform?.inert) {
    const into = vol.transform?.into;
    const next = { ...(into ? { into } : {}), ...(inert ? { inert: ability } : {}) };
    setVol(w, slot, { transform: Object.keys(next).length ? next : undefined } as Partial<A1Vol>);
  }
}

/**
 * Skill Swap's own order (PS/sim/battle.ts skillSwap; C13): both fainted or Dynamaxed checks and the failskillswap flags (the
 * caller's facts), both SetAbility events (Ability Shield on the target, then on the user), both Ends (the user's, then the
 * target's), the swap with fresh states, then the Starts: the target's new ability first, then the user's. Not under
 * Neutralizing Gas (doubles-status.ts statusMove's withGas guard, Q5).
 */
export function skillSwap(kernel: TurnKernel, w: World, user: DoublesSlotId, target: DoublesSlotId, use: Use): World[] {
  const c = changeOf(kernel, w, use);
  const name = (slot: DoublesSlotId) => kernel.names[slot];
  const fail = (text: string) => { fact(kernel, c, w, target, `${use.move.name} fails: ${text}.`); return [w]; };
  if (!kernel.alive(w, user) || !kernel.alive(w, target)) return [w];
  for (const slot of [user, target]) if (isMaxActive(w.mons[slot]!.build)) return fail(`${name(slot)} is Dynamaxed`);
  const mine = realAbility(kernel, w, user), theirs = realAbility(kernel, w, target);
  for (const [slot, ability] of [[user, mine], [target, theirs]] as const) {
    if (flag(kernel, ability, "failskillswap")) return fail(`${name(slot)}'s ${kernel.abilityName(ability)} cannot be swapped`);
  }
  for (const slot of [target, user]) {
    if (!shielded(kernel, w, slot)) continue;
    fact(kernel, c, w, slot, `${kernel.itemName("abilityshield")}: ${name(slot)} keeps ${kernel.abilityName(slot === user ? mine : theirs)}.`);
    return [w];
  }
  kernel.stepFact(use.action, `${name(user)} gets ${kernel.abilityName(theirs)}; ${name(target)} gets ${kernel.abilityName(mine)}.`, w.mass);
  endBefore(kernel, w, user, mine, c);
  endBefore(kernel, w, target, theirs, c);
  switchAbility(kernel, w, user, theirs);
  switchAbility(kernel, w, target, mine);
  endAfter(kernel, w, user, mine, c);
  endAfter(kernel, w, target, theirs, c);
  historyHooks.entryChanged(kernel, w, user);
  historyHooks.entryChanged(kernel, w, target);
  const worlds = abilityStartIn(kernel, w, target, c, "gained").flatMap((world) => abilityStartIn(kernel, world, user, c, "gained"));
  return finish(kernel, worlds, c);
}

/**
 * One ability change on `slot` for another caller (K's Receiver and Power of Alchemy, the moves of this file): pinned
 * setAbility (no change for a fainted Pokémon, to or from a cantsuppress ability, or through a working Ability Shield; then the
 * old ability's End, a fresh state and the new ability's Start), with the move's end (White Herb, the field change, the
 * Update's Berries) applied. The worlds after it.
 */
export function setAbility(kernel: TurnKernel, w: World, slot: DoublesSlotId, ability: string, opts: { source: DoublesSlotId; how: AbilityChange; use?: Use }): World[] {
  void opts.source;
  const c = changeOf(kernel, w, opts.use);
  return finish(kernel, changeAbility(kernel, w, slot, ability, c, opts.how).worlds, c);
}

/** An ability's Start (F1 §3.4.5; `why`: "entered" for R's newcomers, which also run onSwitchIn in wave 2), with the move's end applied. */
export function abilityStart(kernel: TurnKernel, w: World, slot: DoublesSlotId, why: "gained" | "entered"): World[] {
  const c = changeOf(kernel, w);
  return finish(kernel, abilityStartIn(kernel, w, slot, c, why), c);
}

/** An ability's End (F1 §3.4.4; C7: Opportunist's deletes its pending copy), as it is lost now (the caller switches it), with the move's end applied. */
export function abilityEnd(kernel: TurnKernel, w: World, slot: DoublesSlotId, ability: string): World[] {
  const c = changeOf(kernel, w);
  endBefore(kernel, w, slot, ability, c);
  endAfter(kernel, w, slot, ability, c);
  return finish(kernel, [w], c);
}

// ------------------------------------------------------------------------------------------------------------------
// Ends (PS/data/abilities.ts onEnd; F1 §3.4.4)
// ------------------------------------------------------------------------------------------------------------------

/**
 * What each ability's End does when it is lost mid-turn (every catalog ability with an End handler; the source test checks
 * the list against the ability table): "acts" (endBefore / endAfter), "nothing" (the fresh ability state already holds it, or
 * it changes nothing the turn reads: Flash Fire's, Unburden's and Slow Start's volatiles, Gorilla Tactics' lock, Supreme
 * Overlord's count, Illusion's disguise, which the turn never models), "guard" (Zen Mode: cantsuppress and failskillswap in
 * every game that has it, so no move reaches it).
 */
export const ABILITY_ENDS: Readonly<Record<string, "acts" | "nothing" | "guard">> = {
  airlock: "acts", cloudnine: "acts", asoneglastrier: "acts", asonespectrier: "acts", unnerve: "acts", opportunist: "acts",
  protosynthesis: "acts", quarkdrive: "acts", neutralizinggas: "acts", deltastream: "acts", desolateland: "acts", primordialsea: "acts",
  flashfire: "nothing", unburden: "nothing", slowstart: "nothing", gorillatactics: "nothing", supremeoverlord: "nothing", illusion: "nothing",
  zenmode: "guard",
};

/**
 * The End's part before the switch (the old ability's own state): Opportunist's pending copy deleted (C7: onEnd deletes
 * effectState.boosts; Mirror Herb's is the item's), Protosynthesis' and Quark Drive's boost (the fresh state clears
 * settledBoostedStat), Neutralizing Gas ending (kernel.gasEnds). A suppressed ability ended already (Gastro Acid's onStart
 * ran it); an inert copy has nothing to end.
 */
function endBefore(kernel: TurnKernel, w: World, slot: DoublesSlotId, old: string, c: Change) {
  void c;
  if (suppressed(w, slot)) return;
  const mon = w.mons[slot]!;
  if (old === "opportunist" && mon.copy?.by === "opportunist") delete mon.copy;
  if (old === "neutralizinggas") kernel.gasEnds(w, slot);
  if (old === "zenmode" && ABILITY_ENDS.zenmode === "guard") kernel.notEstimated(REASONS.abilityEnd(kernel.abilityName(old), kernel.names[slot]));
}
/**
 * The End's part after the switch: an Unnerve or As One gone (its foes' Berries are due at the Update: finish), a strong
 * weather of USUM whose last holder lost it (PS/data/abilities.ts desolateland and its kin onEnd: clearWeather), Air Lock
 * and Cloud Nine (the effective weather: finish's field change).
 */
function endAfter(kernel: TurnKernel, w: World, slot: DoublesSlotId, old: string, c: Change) {
  if (old === "unnerve" || old === "asoneglastrier" || old === "asonespectrier") c.unnerved.add(slot);
  const weather = Object.entries(STRONG_WEATHERS).find(([, keeper]) => keeper === old)?.[0];
  if (weather && w.field.weather === weather && !DOUBLES_SLOTS.some((other) => kernel.alive(w, other) && w.mons[other]!.build.abilityId === old)) {
    w.field = { ...w.field, weather: "" };
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Starts (PS/data/abilities.ts onStart; F1 §3.4.5, with C10, Q12)
// ------------------------------------------------------------------------------------------------------------------

/**
 * What each ability's Start does when it is gained mid-turn (every catalog ability with a Start handler; the source test checks
 * the list against the ability table): "acts" (abilityStartIn's cases), "nothing" (a message, or a state every reader takes
 * from the ability per world: Mold Breaker, Pressure, the auras and Ruins, Unnerve, Comatose, Gluttony, Anticipation, Forewarn,
 * Frisk, Slow Start's fresh state, Truant's next turn, Gorilla Tactics), "guard" (REASONS.abilityStart: Supreme Overlord's
 * count of the side's faints in the battle is not an input; the form and field abilities no move can give a Pokémon they act on).
 */
export const ABILITY_STARTS: Readonly<Record<string, "acts" | "nothing" | "guard">> = {
  intimidate: "acts", download: "acts", trace: "acts", costar: "acts", curiousmedicine: "acts", hospitality: "acts",
  supersweetsyrup: "acts", intrepidsword: "acts", dauntlessshield: "acts", windrider: "acts", screencleaner: "acts", pastelveil: "acts",
  drizzle: "acts", drought: "acts", sandstream: "acts", snowwarning: "acts", orichalcumpulse: "acts", deltastream: "acts", desolateland: "acts",
  primordialsea: "acts", electricsurge: "acts", grassysurge: "acts", mistysurge: "acts", psychicsurge: "acts", hadronengine: "acts",
  airlock: "acts", cloudnine: "acts", mimicry: "acts", klutz: "acts", forecast: "acts", flowergift: "acts",
  anticipation: "nothing", forewarn: "nothing", frisk: "nothing", moldbreaker: "nothing", pressure: "nothing", teravolt: "nothing",
  turboblaze: "nothing", aurabreak: "nothing", darkaura: "nothing", fairyaura: "nothing", beadsofruin: "nothing", swordofruin: "nothing",
  tabletsofruin: "nothing", vesselofruin: "nothing", unnerve: "nothing", asoneglastrier: "nothing", asonespectrier: "nothing", comatose: "nothing",
  gluttony: "nothing", slowstart: "nothing", truant: "nothing", gorillatactics: "nothing",
  supremeoverlord: "guard", commander: "guard", embodyaspectcornerstone: "guard", embodyaspecthearthflame: "guard", embodyaspectteal: "guard",
  embodyaspectwellspring: "guard", iceface: "guard", protosynthesis: "guard", quarkdrive: "guard", schooling: "guard", shieldsdown: "guard",
};

/**
 * The once-a-battle Starts of generation 9 (PS/data/abilities.ts intrepidsword, dauntlessshield, supersweetsyrup: pokemon
 * swordBoost, shieldBoost, syrupTriggered) and the DoublesCarried.onceUsed id of each.
 */
const ONCE: Readonly<Record<string, "intrepidsword" | "dauntlessshield" | "supersweetsyrup">> = {
  intrepidsword: "intrepidsword", dauntlessshield: "dauntlessshield", supersweetsyrup: "supersweetsyrup",
};

/**
 * `slot`'s ability's Start as it is gained (PS/sim/pokemon.ts setAbility: singleEvent('Start'); a suppressed or inert ability
 * starts nothing, nor one with no Start handler in this game). The worlds after it.
 */
function abilityStartIn(kernel: TurnKernel, w: World, slot: DoublesSlotId, c: Change, why: "gained" | "entered"): World[] {
  void why;
  if (!kernel.alive(w, slot) || suppressed(w, slot)) return [w];
  const mon = w.mons[slot]!;
  const id = mon.build.abilityId;
  const game = gameOf(kernel);
  if (!abilityEntry(id, game).start) return [w];
  const name = kernel.names[slot], label = kernel.abilityName(id);
  const kind = ABILITY_STARTS[id];
  if (kind === "guard" && startGuarded(kernel, w, slot, id)) kernel.notEstimated(REASONS.abilityStart(label, name));
  if (kind !== "acts") return [w];
  const boost = (target: DoublesSlotId, stages: Partial<Record<Stage, number>>, source: DoublesSlotId, intimidate = false) => {
    applyBoosts(kernel, w, target, stages, source, { use: c.use, effect: "ability", report: true, herb: false, breakHolder: c.breaker, ...(intimidate ? { intimidate } : { by: target === slot ? label : undefined }) });
    c.herbs.add(target);
    c.herbs.add(source);
  };
  switch (id) {
    case "intimidate": {
      // data/abilities.ts intimidate onStart: each adjacent foe by position; a Substitute is -immune; else boost({atk: −1})
      // from the holder (isSecondary), through every TryBoost and AfterBoost of the drop (applyBoosts' `intimidate`; C10:
      // Mirror Armor, then Mist).
      const foes = foesIn(kernel, w, slot);
      if (!foes.length) return [w];
      stepFact(kernel, c, w, `${name}'s ${label} activates.`);
      for (const foe of foes) {
        if (w.mons[foe]!.vol.substitute) { fact(kernel, c, w, foe, `${kernel.names[foe]} is behind a Substitute.`); continue; }
        boost(foe, { atk: -1 }, slot, true);
      }
      return [w];
    }
    case "download": {
      // data/abilities.ts download onStart: the foes' Defense and Sp. Def with their stages (getStat(stat, false, true):
      // stored stats, no other modifier; under Wonder Room the stored stat stays and the other stat's stage is read).
      const room = w.field.wonderRoom;
      const statOf = (foe: DoublesSlotId, stat: "def" | "spd") => {
        const stored = kernel.buildStats(w.mons[foe]!.build);
        if (!stored) return kernel.notEstimated(REASONS.notIn2v2(label));
        const stage = stageOf(w, foe, room ? (stat === "def" ? "spd" : "def") : stat);
        const table = [1, 1.5, 2, 2.5, 3, 3.5, 4];
        return stage >= 0 ? Math.floor(stored[stat] * table[stage]) : Math.floor(stored[stat] / table[-stage]);
      };
      let def = 0, spd = 0;
      for (const foe of foesIn(kernel, w, slot)) { def += statOf(foe, "def"); spd += statOf(foe, "spd"); }
      const stat: CombatStat | null = def && def >= spd ? "spa" : spd ? "atk" : null;
      if (!stat) return [w];
      boost(slot, { [stat]: 1 }, slot);
      // The engine's own Download is off: its rise is in the stages (calculate.ts settledDownload).
      w.mons[slot]!.build = { ...w.mons[slot]!.build, settledDownload: stat };
      return [w];
    }
    case "trace": return traceStart(kernel, w, slot, c);
    case "costar": {
      // data/abilities.ts costar onStart: its partner's stages (all seven) and critical-hit volatiles, written directly.
      const ally = partnerOf(kernel, w, slot);
      if (!ally) return [w];
      writeStages(kernel, w, slot, stagesOf(w, ally), c.use, { herb: false });
      copyCritStages(w, ally, slot);
      c.herbs.add(slot);
      stepFact(kernel, c, w, `${label}: ${name} copies ${kernel.names[ally]}'s stat changes.`);
      return [w];
    }
    case "curiousmedicine": {
      // data/abilities.ts curiousmedicine onStart: its partner's stages cleared (clearBoosts: no boost event).
      const ally = partnerOf(kernel, w, slot);
      if (!ally) return [w];
      writeStages(kernel, w, ally, Object.fromEntries(STAGES.map((stat) => [stat, 0])), c.use, { herb: false });
      stepFact(kernel, c, w, `${label}: ${kernel.names[ally]}'s stat changes are removed.`);
      return [w];
    }
    case "hospitality": {
      // data/abilities.ts hospitality onStart: heal(ally.baseMaxhp / 4) for its partner (TryHeal: Heal Block; none at full HP).
      const ally = partnerOf(kernel, w, slot);
      if (!ally) return [w];
      return heal(kernel, w, ally, kernel.hp[ally].baseMaxHP / 4, label, c.use).map(({ world }) => world);
    }
    case "supersweetsyrup": {
      if (!once(kernel, w, slot, id)) return [w];
      // data/abilities.ts supersweetsyrup onStart: each adjacent foe's evasion −1 from the holder (a Substitute: -immune).
      const foes = foesIn(kernel, w, slot);
      stepFact(kernel, c, w, `${name}'s ${label} activates.`);
      for (const foe of foes) {
        if (w.mons[foe]!.vol.substitute) { fact(kernel, c, w, foe, `${kernel.names[foe]} is behind a Substitute.`); continue; }
        boost(foe, { evasion: -1 }, slot);
      }
      return [w];
    }
    case "intrepidsword": case "dauntlessshield": {
      if (!once(kernel, w, slot, id)) return [w];
      boost(slot, id === "intrepidsword" ? { atk: 1 } : { def: 1 }, slot);
      return [w];
    }
    case "windrider": {
      // data/abilities.ts windrider onStart: +1 Attack with Tailwind on its side.
      if (w.sides[slotSide(slot)].tailwind) boost(slot, { atk: 1 }, slot);
      return [w];
    }
    case "screencleaner": {
      // data/abilities.ts screencleaner onStart: Reflect, Light Screen and Aurora Veil end on both sides.
      let any = false;
      for (const side of ["own", "opponent"] as const) {
        const state = w.sides[side];
        if (!state.reflect && !state.lightScreen && !state.auroraVeil) continue;
        any = true;
        const clock = state.clock ? { ...state.clock } : undefined;
        if (clock) { delete clock.reflect; delete clock.lightScreen; delete clock.auroraVeil; }
        w.sides[side] = { ...state, reflect: false, lightScreen: false, auroraVeil: false, ...(state.clock ? { clock: clock! } : {}) };
      }
      if (any) stepFact(kernel, c, w, `${label}: the screens end on both sides.`);
      return [w];
    }
    case "pastelveil": {
      // data/abilities.ts pastelveil onStart (Sword/Shield): its own and its partner's poison cured.
      for (const each of [slot, partnerOf(kernel, w, slot)]) {
        if (each && ["psn", "tox"].includes(w.mons[each]!.build.status)) cure(kernel, w, each, c, label);
      }
      return [w];
    }
    case "drizzle": case "drought": case "sandstream": case "snowwarning": case "orichalcumpulse": case "deltastream": case "desolateland": case "primordialsea": {
      // data/abilities.ts drizzle, drought onStart: not Kyogre with the Blue Orb, nor Groudon with the Red Orb (the Primal forms'
      // own); sim/field.ts setWeather: the weather up already fails, and a strong weather's living holder keeps any other out.
      const build = w.mons[slot]!.build;
      if ((id === "drizzle" && build.speciesId === "kyogre" && build.itemId === "blueorb") || (id === "drought" && build.speciesId === "groudon" && build.itemId === "redorb")) return [w];
      const old = gameOf(kernel) === "sword_shield" || gameOf(kernel) === "ultra_sun_ultra_moon";
      const weather = ({
        drizzle: "Rain", drought: "Sun", sandstream: "Sand", snowwarning: old ? "Hail" : "Snow", orichalcumpulse: "Sun",
        deltastream: "Strong Winds", desolateland: "Harsh Sunshine", primordialsea: "Heavy Rain",
      } as const)[id];
      if (w.field.weather === weather) return [w];
      const keeper = STRONG_WEATHERS[w.field.weather];
      if (!STRONG_WEATHERS[weather] && keeper && DOUBLES_SLOTS.some((other) => kernel.alive(w, other) && w.mons[other]!.build.abilityId === keeper)) return [w];
      w.field = { ...w.field, weather };
      stepFact(kernel, c, w, `${name}'s ${label}: the weather becomes ${weather}.`);
      return [w];
    }
    case "electricsurge": case "grassysurge": case "mistysurge": case "psychicsurge": case "hadronengine": {
      // sim/field.ts setTerrain: the terrain up already fails.
      const terrain = ({ electricsurge: "Electric", grassysurge: "Grassy", mistysurge: "Misty", psychicsurge: "Psychic", hadronengine: "Electric" } as const)[id];
      if (w.field.terrain === terrain) return [w];
      w.field = { ...w.field, terrain };
      stepFact(kernel, c, w, `${name}'s ${label}: the terrain becomes ${terrain} Terrain.`);
      return [w];
    }
    case "airlock": case "cloudnine":
      // The effective weather (kernel.effectiveWeather reads the living holders): finish's field change.
      return [w];
    case "mimicry": {
      // data/abilities.ts mimicry onStart → onTerrainChange: the terrain's type, else its base species' types; setType
      // (A2's setTypes) only when they differ from its types now.
      const terrain = ({ Electric: "Electric", Grassy: "Grass", Misty: "Fairy", Psychic: "Psychic" } as const)[w.field.terrain as "Electric"];
      const base = kernel.runtime.speciesById.get(w.mons[slot]!.build.transformedFrom?.speciesId ?? w.mons[slot]!.build.speciesId)?.types ?? [];
      const types = terrain ? [terrain] : [...base];
      if (kernel.typesIn(w, slot).join() !== types.join() && typingHooks.setTypes(kernel, w, slot, types)) {
        stepFact(kernel, c, w, `${label}: ${name} becomes ${types.join("/")} type.`);
      }
      return [w];
    }
    case "klutz": {
      // data/abilities.ts klutz onStart: its item's End (Mirror Herb's deletes its pending copy; Utility Umbrella's only
      // re-reads the weather for its holder, whose ability is now Klutz).
      if (w.mons[slot]!.copy?.by === "mirrorherb" && w.mons[slot]!.build.itemId === "mirrorherb") delete w.mons[slot]!.copy;
      return [w];
    }
    case "forecast": case "flowergift": {
      // data/abilities.ts forecast, flowergift onStart: Castform's or Cherrim's form (FC's per-holder handler; wave 1a: its
      // reason); on any other species nothing.
      const species = kernel.runtime.speciesById.get(w.mons[slot]!.build.speciesId)?.baseSpecies ?? "";
      if (/^(castform|cherrim)$/i.test(species)) return fieldChangeHooks.settleHolder(kernel, w, slot);
      return [w];
    }
  }
  return [w];
}

/** Whether a guarded Start would act on this holder (its own species and state): a form or field ability no move gives one it acts on. */
function startGuarded(kernel: TurnKernel, w: World, slot: DoublesSlotId, id: string): boolean {
  const build = w.mons[slot]!.build;
  const species = kernel.runtime.speciesById.get(build.speciesId);
  const base = (species?.baseSpecies ?? "").toLowerCase();
  switch (id) {
    case "supremeoverlord": return true;
    case "commander": return base === "tatsugiri";
    case "embodyaspectcornerstone": case "embodyaspecthearthflame": case "embodyaspectteal": case "embodyaspectwellspring": return base === "ogerpon";
    case "iceface": return build.speciesId === "eiscuenoice";
    case "schooling": return base === "wishiwashi" && !build.transformedFrom;
    case "shieldsdown": return base === "minior" && !build.transformedFrom;
  }
  // Protosynthesis and Quark Drive read the field and Booster Energy as they start.
  return true;
}

/**
 * A generation 9 once-a-battle Start (Q12): not when its Pokémon had it before in this battle (the input's onceUsed, or it
 * started the turn with this ability: it acted as it entered), else it acts once (MoveVolatiles.onceUsed), with the turn fact
 * `Assumes {Name} has not had {Ability} before in this battle.` when the input does not say. Sword/Shield's act every time.
 */
function once(kernel: TurnKernel, w: World, slot: DoublesSlotId, ability: string): boolean {
  const key = ONCE[ability];
  if (!key || generation(kernel) < 9) return true;
  const mon = w.mons[slot]!;
  const input = kernel.input.pokemon[slot]!;
  const started = input.build.abilityId === ability || input.build.tracedAbility === ability;
  if (started || mon.vol.onceUsed?.includes(key)) return false;
  if (input.carried?.onceUsed === undefined) kernel.turnFact(`Assumes ${kernel.names[slot]} has not had ${kernel.abilityName(ability)} before in this battle.`);
  setVol(w, slot, { onceUsed: [...(mon.vol.onceUsed ?? []), key] });
  return true;
}

/**
 * Trace's Start (data/abilities.ts trace onStart, onUpdate): an Ability Shield on its holder blocks it; otherwise it copies at
 * once a random adjacent foe's ability that is not notrace (one world per candidate, 1/k: SA14b), whose Start then runs
 * (pinned setAbility). With no copyable foe it keeps seeking at every later Update: exact while no later action can change a
 * foe's ability; otherwise not estimated (REASONS.abilityStart).
 */
function traceStart(kernel: TurnKernel, w: World, slot: DoublesSlotId, c: Change): World[] {
  const name = kernel.names[slot];
  if (shielded(kernel, w, slot)) { stepFact(kernel, c, w, `${kernel.itemName("abilityshield")}: ${name}'s ${kernel.abilityName("trace")} copies nothing.`); return [w]; }
  const candidates = foesIn(kernel, w, slot).filter((foe) => {
    const ability = realAbility(kernel, w, foe);
    return ability !== "noability" && !flag(kernel, ability, "notrace");
  });
  if (!candidates.length) {
    if (laterAbilityChange(kernel, w)) kernel.notEstimated(REASONS.abilityStart(kernel.abilityName("trace"), name));
    return [w];
  }
  return split(w, candidates.length).flatMap((world, index) => {
    const foe = candidates[index];
    const ability = realAbility(kernel, world, foe);
    return changeAbility(kernel, world, slot, ability, c, "trace", `${name}'s ${kernel.abilityName("trace")} copies ${kernel.abilityName(ability)} from ${kernel.names[foe]}.`).worlds;
  });
}
/** Abilities that change another Pokémon's ability during the moves (contact: Mummy, Lingering Aroma, Wandering Spirit; an ally's faint: Receiver, Power of Alchemy). */
const ABILITY_CHANGERS = new Set(["mummy", "lingeringaroma", "wanderingspirit", "receiver", "powerofalchemy"]);
/** The status moves that change a Pokémon's ability. */
const ABILITY_MOVES = new Set(["skillswap", "roleplay", "entrainment", "simplebeam", "worryseed", "doodle", "transform"]);
/** Whether an ability can still change this turn: a later living action's ability move, or an ability that changes one. */
function laterAbilityChange(kernel: TurnKernel, w: World): boolean {
  if (w.remaining.some((entry) => kernel.alive(w, entry.slot) && entry.moveId && ABILITY_MOVES.has(entry.moveId))) return true;
  return DOUBLES_SLOTS.some((slot) => kernel.alive(w, slot) && ABILITY_CHANGERS.has(w.mons[slot]!.build.abilityId));
}

/** Psych Up's, Costar's and Transform's critical-hit volatiles (PS/data/moves.ts psychup: the user's removed, then the source's added). */
function copyCritStages(w: World, from: DoublesSlotId, to: DoublesSlotId) {
  const source = w.mons[from]!, mon = w.mons[to]!;
  const focus = !!(source.build.focusEnergy || source.build.settledFocusEnergy);
  const next: BattleBuild = { ...mon.build };
  delete next.focusEnergy; delete next.settledFocusEnergy; delete next.dragonCheer;
  if (focus) next.focusEnergy = true;
  if (source.build.dragonCheer) next.dragonCheer = source.build.dragonCheer;
  mon.build = next;
  setVol(w, to, { chiStrike: source.vol.chiStrike, laserFocus: source.vol.laserFocus });
}
const critKey = (w: World, slot: DoublesSlotId) => {
  const mon = w.mons[slot]!;
  return JSON.stringify([!!(mon.build.focusEnergy || mon.build.settledFocusEnergy), mon.build.dragonCheer ?? 0, mon.vol.chiStrike ?? 0, !!mon.vol.laserFocus]);
};

// ------------------------------------------------------------------------------------------------------------------
// Heals, cures and the Update's cures of a changed ability
// ------------------------------------------------------------------------------------------------------------------

/**
 * A heal of `amount` on `slot` (sim/battle.ts heal: at least 1, truncated; TryHeal: Heal Block; none at 0 or full HP; capped
 * at the maximum; doubles-status.ts healWorlds' rule). `healed`: false where it healed nothing.
 */
function heal(kernel: TurnKernel, w: World, slot: DoublesSlotId, amount: number, source: string, use?: Use, failFact = false): { world: World; healed: boolean }[] {
  const value = Math.trunc(amount && amount <= 1 ? 1 : amount);
  const { maxHP } = kernel.hp[slot];
  const name = kernel.names[slot];
  if (w.mons[slot]!.eot.healBlock) {
    if (failFact && use) hitFact(kernel, use, slot, `${source} fails: ${name} cannot heal.`, w);
    return [{ world: w, healed: false }];
  }
  return mapHP(w, slot, (hp) => {
    if (hp <= 0 || hp >= maxHP) return { hp, tag: "full" };
    const after = Math.min(maxHP, hp + value);
    kernel.noteHeal(slot, source, after - hp);
    const stats = use ? kernel.hitStats(use.action, slot) : null;
    if (stats) stats.change = stats.change ? { min: Math.min(stats.change.min, after - hp), max: Math.max(stats.change.max, after - hp) } : { min: after - hp, max: after - hp };
    return { hp: after, tag: "healed" };
  }).map(({ world, tag }) => {
    if (tag === "full" && failFact && use) hitFact(kernel, use, slot, `${source} fails: ${name} is at full HP.`, world);
    return { world, healed: tag === "healed" };
  });
}

const STATUS_NOUNS: Record<string, string> = { slp: "sleep", par: "paralysis", brn: "burn", psn: "poison", tox: "bad poison", frz: "freeze" };
/** cureStatus on `slot` (its sleep counter, freeze counter, bad poison stage; a sleep cure ends Nightmare, A2's: CR11). */
function cure(kernel: TurnKernel, w: World, slot: DoublesSlotId, c: Change | null, by?: string) {
  const mon = w.mons[slot]!;
  const status = mon.build.status;
  if (!status) return;
  mon.build = { ...mon.build, status: "" };
  if (status === "slp") { setVol(w, slot, { sleep: undefined }); if (mon.eot.nightmare) setEot(w, slot, { nightmare: undefined }); }
  if (status === "frz") setVol(w, slot, { freeze: undefined });
  if (status === "tox") setEot(w, slot, { toxic: undefined });
  if (c) fact(kernel, c, w, slot, by ? `${by}: ${kernel.names[slot]} is cured of its ${STATUS_NOUNS[status]}.` : `Its ${STATUS_NOUNS[status]} is cured.`);
}

/**
 * The action's Update for `slot` (doubles-status.ts updateAll, per Pokémon, after today's cures), for a Pokémon whose ability
 * changed this turn (abilityChanged): its ability's onUpdate cures whatever it holds now (PS/data/abilities.ts insomnia,
 * vitalspirit, limber, immunity, pastelveil, waterveil, waterbubble, thermalexchange, magmaarmor: cureStatus at every Update;
 * owntempo: confusion; oblivious: attraction and Taunt), as SA14f shows (Skill Swap's Insomnia cures a sleeping ally at that
 * move's Update). A suppressed ability (the stand-in) cures nothing.
 */
export function updateCures(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot];
  if (!mon || mon.fainted || !mon.build.abilityChanged) return;
  const ability = mon.build.abilityId, status = mon.build.status;
  if (status && OWN_STATUS_CURES[ability]?.includes(status)) cure(kernel, w, slot, null);
  if (ability === "owntempo" && mon.vol.confusion) setVol(w, slot, { confusion: undefined });
  if (ability === "oblivious" && (mon.vol.attract || mon.vol.taunt)) setVol(w, slot, { attract: undefined, taunt: undefined });
}

// ------------------------------------------------------------------------------------------------------------------
// Transform (PS/sim/pokemon.ts transformInto; F1 §3.5 with C2)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Transform's copied build (PS/sim/pokemon.ts transformInto with C2): the target's species (its current form), world types
 * (its types before Tera; Roost's are read when used: typesIn) and added type, stored stats (an earlier split, Speed Swap or
 * Power Trick included: the five but HP), weight, the five stages and the critical-hit stages, and its own ability (the
 * caller applies the change: an inert copy, Gastro Acid); the user keeps its HP and HP training (transformedFrom's base HP),
 * level, item, status, mechanic, gender, happiness, Hidden Power type and Tera type, its item and order timings.
 */
export function transformBuild(kernel: TurnKernel, w: World, user: DoublesSlotId, target: DoublesSlotId): BattleBuild {
  const own = w.mons[user]!.build, copy = w.mons[target]!.build;
  const stats = kernel.buildStats(copy);
  const species = kernel.runtime.speciesById.get(own.transformedFrom?.speciesId ?? own.speciesId);
  if (!stats || !species) return kernel.notEstimated(REASONS.notIn2v2(`Transform into ${kernel.names[target]}`));
  const gender = getBuildGender(own, kernel.runtime) ?? "N";
  const next = {
    ...copy,
    game: own.game,
    ...(own.game === "champions" ? { points: own.points } : { native: own.native }),
    itemId: own.itemId, status: own.status, currentHP: null, mechanic: own.mechanic,
    configuration: { ...own.configuration, gender },
    transformedFrom: { speciesId: species.id, baseHP: species.baseStats.hp },
    storedStats: { atk: stats.atk, def: stats.def, spa: stats.spa, spd: stats.spd, spe: stats.spe },
    abilityId: realAbility(kernel, w, target), abilityActive: defaultAbilityActive(realAbility(kernel, w, target)), abilityChanged: true,
    itemUsedBeforeRoom: own.itemUsedBeforeRoom, itemUsedBeforeField: own.itemUsedBeforeField, settledCustap: own.settledCustap,
    firstTurnSpeed: own.firstTurnSpeed, faintedAllies: own.faintedAllies, itemSuppressed: own.itemSuppressed, preparedMoves: own.preparedMoves,
    focusEnergy: copy.focusEnergy || copy.settledFocusEnergy ? true : undefined, settledFocusEnergy: undefined, dragonCheer: copy.dragonCheer,
    tracedAbility: undefined, settledDownload: undefined, settledBoostedStat: undefined, copiedIntimidateStored: undefined, pendingCopy: undefined,
  } as BattleBuild;
  for (const key of Object.keys(next) as (keyof BattleBuild)[]) if (next[key] === undefined) delete next[key];
  return next;
}

/**
 * Transform's hit (PS/sim/pokemon.ts transformInto): the failures (Illusion on either: its disguise is not an input; either
 * transformed; Eternatus-Eternamax; Ogerpon or Terapagos with either Terastallized; a Stellar user; Sword/Shield's Dynamaxed
 * target), then the copy (transformBuild, its `timesAttacked`, accuracy and evasion, G-Max Chi Strike and Laser Focus), the
 * user's old ability's End and the copied one's Start when it differs (setAbility(…, true, true): no cantsuppress check, no
 * Ability Shield). A Substitute stops it before (doubles-status.ts hitOne).
 */
function transformInto(kernel: TurnKernel, w: World, use: Use, target: DoublesSlotId): World[] {
  const user = use.user;
  const own = w.mons[user]!.build, copy = w.mons[target]!.build;
  const fail = (text: string) => { hitFact(kernel, use, target, `${use.move.name} fails: ${text}.`, w); return [w]; };
  if (realAbility(kernel, w, user) === "illusion" || realAbility(kernel, w, target) === "illusion") kernel.notEstimated(REASONS.notIn2v2(`${use.move.name} with ${kernel.abilityName("illusion")}`));
  if (copy.transformedFrom) return fail(`${kernel.names[target]} is transformed`);
  if (own.transformedFrom) return fail(`${kernel.names[user]} is transformed`);
  const base = (build: BattleBuild) => (kernel.runtime.speciesById.get(build.speciesId)?.baseSpecies ?? "").toLowerCase();
  if (copy.speciesId === "eternatuseternamax") return fail(`${kernel.names[target]} is Eternatus-Eternamax`);
  const tera = (build: BattleBuild) => build.mechanic === "tera";
  if (["ogerpon", "terapagos"].includes(base(copy)) && (tera(own) || tera(copy))) return fail(`${kernel.names[target]} cannot be copied while Terastallized`);
  if (tera(own) && own.configuration?.teraType === "Stellar") return fail(`${kernel.names[user]} is Terastallized as Stellar`);
  if (isMaxActive(copy)) kernel.notEstimated(REASONS.transformMax(kernel.names[target]));
  const c = changeOf(kernel, w, use);
  const old = realAbility(kernel, w, user), copied = realAbility(kernel, w, target);
  kernel.stepFact(use.action, `${kernel.names[user]} transforms into ${kernel.names[target]}.`, w.mass);
  endBefore(kernel, w, user, old, c);
  const mon = w.mons[user]!;
  const gastro = mon.vol.gastroAcid !== undefined;
  mon.build = { ...transformBuild(kernel, w, user, target), boosts: { ...copy.boosts } };
  mon.timesAttacked = w.mons[target]!.timesAttacked;
  writeStages(kernel, w, user, stagesOf(w, target, ["accuracy", "evasion"]), use, { herb: false });
  setVol(w, user, { chiStrike: w.mons[target]!.vol.chiStrike, laserFocus: w.mons[target]!.vol.laserFocus, transform: { into: target } } as Partial<A1Vol>);
  c.herbs.add(user);
  // The copied ability (setAbility with isFromFormeChange and isTransform): Gastro Acid keeps it suppressed unless it is a
  // cantsuppress one; a notransform or form ability is inert while transformed.
  const inert = inertWhenTransformed(kernel, copied);
  if (gastro && !flag(kernel, copied, "cantsuppress")) {
    mon.build = { ...mon.build, abilityId: GAS_STAND_IN };
    setVol(w, user, { gastroAcid: copied });
  } else {
    if (gastro) setVol(w, user, { gastroAcid: copied });
    if (inert) {
      mon.build = { ...mon.build, abilityId: GAS_STAND_IN };
      setVol(w, user, { transform: { into: target, inert: copied } } as Partial<A1Vol>);
    }
  }
  endAfter(kernel, w, user, old, c);
  historyHooks.entryChanged(kernel, w, user);
  const worlds = old === copied ? [w] : abilityStartIn(kernel, w, user, c, "gained");
  return finish(kernel, worlds, c);
}

// ------------------------------------------------------------------------------------------------------------------
// Stockpile, Swallow, Spit Up (PS/data/moves.ts:17961-18008 stockpile, swallow, spitup; F1 §4.1 with C1, C17)
// ------------------------------------------------------------------------------------------------------------------

/** The turn facts of a move reading `slot`'s Stockpile from earlier turns (SPEC2 §2.5, ADDENDUM2 §2.5, C17). */
function stockpileFacts(kernel: TurnKernel, slot: DoublesSlotId, ends: boolean) {
  const carried = kernel.input.pokemon[slot]?.carried?.stockpile;
  const name = kernel.names[slot];
  if (!carried) kernel.turnFact(`Assumes ${name} has not stockpiled.`);
  else if (ends && (carried.def === undefined || carried.spd === undefined)) kernel.turnFact(`Assumes each of ${name}'s Stockpile layers changed its Defense and Sp. Def.`);
}
/**
 * Stockpile's End (its condition onEnd): the counted Defense and Sp. Def changes reversed through boost() from the holder
 * itself (Contrary, Simple: CQ01b; White Herb, Eject Pack), the volatile gone. "Its Stockpile ends." on the use.
 */
function stockpileEnd(kernel: TurnKernel, w: World, slot: DoublesSlotId, use: Use) {
  const pile = w.mons[slot]!.vol.stockpile;
  if (!pile || w.mons[slot]!.fainted) return;
  setVol(w, slot, { stockpile: undefined });
  hitFact(kernel, use, slot, "Its Stockpile ends.", w);
  const back: Partial<Record<Stage, number>> = {};
  if (pile.def) back.def = pile.def;
  if (pile.spd) back.spd = pile.spd;
  if (Object.keys(back).length) applyBoosts(kernel, w, slot, back, slot, { use, effect: "move", report: true });
}

/** A Use for a damaging move's own effects outside its hits (Spit Up's AfterMove): no Pokémon reached, so its facts are step facts. */
function sideUse(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, info: TurnMoveInfo): Use {
  const entry = { kind: "M", target: move.target, priority: move.priority, type: move.type, flags: {}, games: {} } as StatusEntry;
  return {
    action, user: action.slot, move, entry, info, type: move.type, priority: move.priority, prankster: false, bounced: false,
    infiltrates: w.mons[action.slot]!.build.abilityId === "infiltrator", targetType: move.target, reached: new Set(),
  };
}

/**
 * A damaging move's own Try of A1's after moveFailure (doubles-turn.ts damagingMove; pinned trySpreadMoveHit's Try, before
 * any TryHit): Spit Up with no Stockpile fails (PS/data/moves.ts spitup onTry), its turn facts; the minimize-flag moves' turn
 * fact on the Pokémon they aim at (SPEC2 §2.5). A Z-Move or Max Move has none of Spit Up's own handlers.
 */
export function damagingTry(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, info: TurnMoveInfo): string | null {
  if (info.transformed) return null;
  const user = action.slot;
  if (MINIMIZE_MOVES.has(move.id)) minimizeFacts(kernel, w, action);
  if (move.id !== "spitup") return null;
  const pile = w.mons[user]!.vol.stockpile;
  stockpileFacts(kernel, user, !!pile);
  return pile ? null : `${move.name} fails: ${kernel.names[user]} has not stockpiled.`;
}
/** The moves Minimize's condition doubles (pinned flags.minimize; calculate.ts MINIMIZE_MOVES). */
const MINIMIZE_MOVES: ReadonlySet<string> = new Set(["bodyslam", "dragonrush", "flyingpress", "heatcrash", "heavyslam", "maliciousmoonsault", "steamroller", "stomp", "supercellslam"]);
/** `Assumes {Name} has not used Minimize.` for the Pokémon a minimize-flag move aims at and a centre of attention that can take it. */
function minimizeFacts(kernel: TurnKernel, w: World, action: PendingAction) {
  const aimed = action.target ? kernel.occupant(w, action.target) : null;
  const slots = new Set<DoublesSlotId>();
  if (aimed) slots.add(aimed);
  for (const slot of foesOf(action.slot)) if (kernel.alive(w, slot) && w.mons[slot]!.centre) slots.add(slot);
  for (const slot of slots) {
    if (!w.mons[slot] || w.mons[slot]!.vol.minimize || kernel.input.pokemon[slot]?.carried?.minimize) continue;
    kernel.turnFact(`Assumes ${kernel.names[slot]} has not used Minimize.`);
  }
}

/**
 * The move's own AfterMove of A1's (doubles-turn.ts runMove, before the onAnyAfterMove handlers): Spit Up's Stockpile End
 * (PS/data/moves.ts spitup onAfterMove: removeVolatile, whatever the move did; nothing for a fainted user). The worlds, or
 * null for an unchanged world.
 */
export function afterMove(kernel: TurnKernel, w: World, action: PendingAction): World[] | null {
  if (action.moveId !== "spitup") return null;
  const mon = w.mons[action.slot];
  if (!mon || mon.fainted || !mon.vol.stockpile) return null;
  const move = kernel.runtime.movesById.get("spitup")!;
  const info = kernel.moveInfo(w, action.slot, "spitup", kernel.input.pokemon[action.slot]!.contexts.spitup);
  if (info.kind !== "move" || info.transformed) return null;
  stockpileEnd(kernel, w, action.slot, sideUse(kernel, w, action, move, info));
  return [w];
}

// ------------------------------------------------------------------------------------------------------------------
// The status moves (F1 §4; SPEC2 §2.2's A1 rows)
// ------------------------------------------------------------------------------------------------------------------

const name = (kernel: TurnKernel, slot: DoublesSlotId) => kernel.names[slot];
/** The user's Mold Breaker for a status move's onTryHit checks of the target's ability (they read getAbility: no suppression). */
const ok = (world: World) => ({ world, ok: true });
const no = (kernel: TurnKernel, use: Use, world: World, reason: string) => { kernel.stepFact(use.action, `${use.move.name} fails: ${reason}.`, world.mass); return { world, ok: false }; };

/** The side moves' and field moves' reach: each Pokémon they act on joins the use's hit entries (its facts are hit facts). */
function reach(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId) {
  use.reached.add(slot);
  const stats = kernel.hitStats(use.action, slot);
  if (stats) { stats.reached += w.mass; stats.effect += w.mass; }
}

/** pinned isGrounded for Rototiller (runImmunity('Ground')): Ring Target negates the Flying check; the user's Mold Breaker passes Levitate. */
function groundedFor(kernel: TurnKernel, w: World, slot: DoublesSlotId, use: Use, c: Change): boolean {
  const mon = w.mons[slot]!;
  const build = mon.build;
  if (w.field.gravity || mon.eot.ingrain || mon.eot.smackedDown) return true;
  const item = kernel.itemWorks(w, build) ? build.itemId : "";
  if (item === "ironball") return true;
  if (item !== "ringtarget" && kernel.typesIn(w, slot).includes("Flying")) return false;
  if (build.abilityId === "levitate" && !c.breaker(slot)) return false;
  if (mon.eot.magnetRise || mon.eot.telekinesis) return false;
  return item !== "airballoon";
}

/** The damaging moves that set the trapped volatile on their target as they hit (PS/data/moves.ts; Jaw Lock traps both). */
const TRAP_HITS: ReadonlySet<string> = new Set(["thousandwaves", "anchorshot", "spiritshackle"]);
/**
 * The trapped volatile a damaging hit sets (needsFromIntegrator I6: the hit pipeline calls it where the move's onHit runs,
 * after the hit's damage; for Anchor Shot and Spirit Shackle only where their secondary applies: not under Sheer Force, not
 * into Shield Dust or Covert Cloak). PS/data/moves.ts thousandwaves onHit, anchorshot and spiritshackle secondary.onHit:
 * target.addVolatile('trapped', source, move, 'trapper') while the user is in; jawlock onHit: the user, then the target, each
 * trapped by the other. addVolatile fails silently on a fainted Pokémon, a fainted source, one already trapped and a Ghost type.
 */
export function trapAfterHit(kernel: TurnKernel, w: World, action: PendingAction, user: DoublesSlotId, target: DoublesSlotId, moveId: string) {
  const add = (slot: DoublesSlotId, source: DoublesSlotId) => {
    if (!kernel.alive(w, slot) || !kernel.alive(w, source) || trappedNow(w, slot) || kernel.typesIn(w, slot).includes("Ghost")) return;
    setVol(w, slot, { trapped: true, trappers: [source] } as Partial<A1Vol>);
    const text = `${name(kernel, slot)} can no longer switch out.`;
    if (slot === target) kernel.hitFact(action, slot, text, w.mass);
    else kernel.stepFact(action, text, w.mass);
  };
  if (moveId === "jawlock") { add(user, target); add(target, user); }
  else if (TRAP_HITS.has(moveId)) add(target, user);
}

/** A1's status-move handlers by the status table's `handler` key (doubles-status.ts dispatches to them). */
export const HANDLERS: Readonly<Record<string, StatusHandler>> = {
  // ---- Stat stages: boost() (F1 §3.1) ----
  acupressure: {
    // PS/data/moves.ts acupressure onHit: one world per stat below +6 (atk, def, spa, spd, spe, accuracy, evasion), 1/n each
    // (sample), +2 from the user (Contrary −2, Simple +4: SA01, SA02b); none: it fails.
    onHit(kernel, w, use, slot) {
      const open = STAGES.filter((stat) => stageOf(w, slot, stat) < 6);
      if (!open.length) { hitFact(kernel, use, slot, `${use.move.name} fails: ${name(kernel, slot)}'s stats are all at +6.`, w); return [w]; }
      return split(w, open.length).map((world, index) => {
        applyBoosts(kernel, world, slot, { [open[index]]: 2 }, use.user, { use, effect: "move", report: true });
        return world;
      });
    },
  },
  stockpile: {
    // PS/data/moves.ts stockpile onTry: three layers fail; condition onStart / onRestart: a layer, boost({def: 1, spd: 1}) from
    // itself, each stat that changed counted −1 (C17: Contrary's too).
    moveTry(kernel, w, use) {
      stockpileFacts(kernel, use.user, false);
      return (w.mons[use.user]!.vol.stockpile?.layers ?? 0) >= 3 ? [no(kernel, use, w, `${name(kernel, use.user)} has stockpiled 3 times`)] : [ok(w)];
    },
    volatile(kernel, w, use, slot) {
      const pile = w.mons[slot]!.vol.stockpile;
      const def = stageOf(w, slot, "def"), spd = stageOf(w, slot, "spd");
      const layers = (pile?.layers ?? 0) + 1 as 1 | 2 | 3;
      hitFact(kernel, use, slot, `Stockpile ${layers}.`, w);
      applyBoosts(kernel, w, slot, { def: 1, spd: 1 }, slot, { use, effect: "move", report: true });
      setVol(w, slot, { stockpile: { layers, def: (pile?.def ?? 0) - (stageOf(w, slot, "def") !== def ? 1 : 0), spd: (pile?.spd ?? 0) - (stageOf(w, slot, "spd") !== spd ? 1 : 0) } });
      return true;
    },
  },
  swallow: {
    // PS/data/moves.ts swallow onTry (a snatched use skips it: sourceEffect snatch), onHit: heal modify(maxhp, [¼, ½, 1][layers − 1])
    // with its user's own layers (1 with none: C1, the Snatch user's), then its Stockpile ends whatever the heal did.
    moveTry(kernel, w, use) {
      stockpileFacts(kernel, use.user, true);
      if (use.snatched || w.mons[use.user]!.vol.stockpile) return [ok(w)];
      return [no(kernel, use, w, `${name(kernel, use.user)} has not stockpiled`)];
    },
    onHit(kernel, w, use, slot) {
      const layers = w.mons[slot]!.vol.stockpile?.layers ?? 1;
      const amount = modify(kernel.hp[slot].maxHP, [0.25, 0.5, 1][layers - 1]);
      return heal(kernel, w, slot, amount, use.move.name, use, true).map(({ world }) => {
        stockpileEnd(kernel, world, slot, use);
        return world;
      });
    },
  },
  tidyUp: {
    // PS/data/moves.ts tidyup onHit: every active Pokémon's Substitute removed, the hazards on both sides, then +1 Attack +1
    // Speed from itself. The hazards from before the turn: hazardsFrom null on both sides (SPEC2 §4.2).
    onHit(kernel, w, use, slot) {
      for (const each of allActive(kernel, w)) {
        if (!w.mons[each]!.vol.substitute) continue;
        setVol(w, each, { substitute: undefined });
        kernel.stepFact(use.action, `${use.move.name}: ${name(kernel, each)}'s Substitute is removed.`, w.mass);
      }
      const landed = (["own", "opponent"] as const).some((side) => w.sides[side].hazards.length);
      for (const side of ["own", "opponent"] as const) w.sides[side] = { ...w.sides[side], hazards: [], hazardsFrom: null };
      if (landed) kernel.stepFact(use.action, `${use.move.name}: the hazards are removed from both sides.`, w.mass);
      applyBoosts(kernel, w, slot, { atk: 1, spe: 1 }, slot, { use, effect: "move", report: true });
      return [w];
    },
  },
  noRetreat: {
    // PS/data/moves.ts noretreat onTry: its volatile up fails; trapped: no volatile (the boosts still: runMoveEffects).
    moveTry(kernel, w, use) {
      if (!kernel.input.pokemon[use.user]?.carried?.noRetreat) kernel.turnFact(`Assumes ${name(kernel, use.user)} has not used No Retreat.`);
      return w.mons[use.user]!.vol.noRetreat ? [no(kernel, use, w, `it is already up on ${name(kernel, use.user)}`)] : [ok(w)];
    },
    volatile(kernel, w, use, slot) {
      if (trappedNow(w, slot)) return true;
      setVol(w, slot, { noRetreat: true });
      hitFact(kernel, use, slot, `${name(kernel, slot)} can no longer switch out.`, w);
      return true;
    },
  },
  trap: {
    // PS/data/moves.ts block, meanlook, spiderweb onHit: target.addVolatile('trapped', source, move, 'trapper'), whose false
    // is the move's failure: one already trapped, a Ghost type (runStatusImmunity('trapped'): data/typechart.ts Ghost trapped 3).
    // Read by No Retreat (its volatile) and the next turn (E2). No protect flag; reflectable; a Substitute stops it (hitOne).
    onHit(kernel, w, use, slot) {
      if (trappedNow(w, slot)) { hitFact(kernel, use, slot, `${use.move.name} fails: ${name(kernel, slot)} is already trapped.`, w); return [w]; }
      if (kernel.typesIn(w, slot).includes("Ghost")) { hitFact(kernel, use, slot, `${use.move.name} fails: ${name(kernel, slot)} is a Ghost type.`, w); return [w]; }
      setVol(w, slot, { trapped: true, trappers: [use.user] } as Partial<A1Vol>);
      hitFact(kernel, use, slot, `${name(kernel, slot)} can no longer switch out.`, w);
      return [w];
    },
  },
  autotomize: {
    // PS/data/moves.ts autotomize onTryHit: +6 Speed (−6 with Contrary) fails; onHit: weighthg − 1000, at least 1 (K18).
    moveTry(kernel, w, use) {
      const contrary = w.mons[use.user]!.build.abilityId === "contrary";
      return stageOf(w, use.user, "spe") === (contrary ? -6 : 6) ? [no(kernel, use, w, `${name(kernel, use.user)}'s Speed cannot go higher`)] : [ok(w)];
    },
    onHit(kernel, w, use, slot) {
      const build = w.mons[slot]!.build;
      const weight = build.weighthg ?? Math.round((kernel.runtime.speciesById.get(build.speciesId)?.weightkg ?? 0) * 10);
      if (weight > 1) {
        const next = Math.max(1, weight - 1000);
        w.mons[slot]!.build = { ...build, weighthg: next };
        hitFact(kernel, use, slot, `${use.move.name}: ${name(kernel, slot)} weighs ${(next / 10).toFixed(1)} kg.`, w);
      }
      return [w];
    },
  },
  minimize: {
    // PS/data/moves.ts minimize: evasion +2 (its boosts), the volatile (onRestart null: once); the ×2 for the minimize-flag
    // moves into it is calcBuild's takenMods.minimize (C6).
    volatile(kernel, w, use, slot) {
      void kernel; void use;
      if (!w.mons[slot]!.vol.minimize) setVol(w, slot, { minimize: true });
      return true;
    },
  },
  geomancy: {
    // PS/data/moves.ts geomancy onTryMove: a charge from last turn is released (removeVolatile, carried.charging: C38); else a
    // working Power Herb is used and it acts at once (data/items.ts powerherb onChargeMove); else the charge turn (twoturnmove).
    moveTry(kernel, w, use) {
      const user = use.user, mon = w.mons[user]!;
      if (mon.vol.locked === "geomancy") { setVol(w, user, { locked: undefined }); return [ok(w)]; }
      if (!kernel.input.pokemon[user]?.carried?.charging) kernel.turnFact(`Assumes ${name(kernel, user)} did not charge ${use.move.name} last turn.`);
      const build = mon.build;
      if (build.itemId === "powerherb" && kernel.itemWorks(w, build)) {
        mon.build = { ...build, itemId: "", ...(build.abilityId === "unburden" ? { abilityActive: true } : {}) };
        kernel.noteItemUse(w, user, "powerherb");
        kernel.stepFact(use.action, `${kernel.itemName("powerherb")}: ${name(kernel, user)} uses ${use.move.name} at once.`, w.mass);
        return [ok(w)];
      }
      setVol(w, user, { charging: "geomancy" });
      kernel.stepFact(use.action, `${name(kernel, user)} charges ${use.move.name}.`, w.mass);
      return [{ world: w, ok: false }];
    },
  },
  plusMinus: {
    // PS/data/moves.ts gearup, magneticflux onHitSide: the living Pokémon of the user's side with Plus or Minus (hasAbility:
    // not suppressed), each boost(…, target, source, move, false, true); none: it fails.
    sideOrField(kernel, w, use) {
      const stages = use.move.id === "gearup" ? { atk: 1, spa: 1 } : { def: 1, spd: 1 };
      const holders = allActive(kernel, w).filter((slot) => slotSide(slot) === slotSide(use.user) && ["plus", "minus"].includes(w.mons[slot]!.build.abilityId));
      if (!holders.length) { kernel.stepFact(use.action, `${use.move.name} fails: no Pokémon on ${name(kernel, use.user)}'s side has Plus or Minus.`, w.mass); return [w]; }
      for (const slot of holders) {
        reach(kernel, w, use, slot);
        applyBoosts(kernel, w, slot, stages, use.user, { use, effect: "move", report: true });
      }
      return [w];
    },
  },
  flowerShield: {
    // PS/data/moves.ts flowershield onHitField: every active Grass type (hasType: its types now) in getAllActive order, +1
    // Defense from the user (a foe's TryBoost and Defiant read it); none: it fails.
    sideOrField(kernel, w, use) {
      const grass = allActive(kernel, w).filter((slot) => kernel.typesIn(w, slot).includes("Grass"));
      if (!grass.length) { kernel.stepFact(use.action, `${use.move.name} fails: no Grass type is in play.`, w.mass); return [w]; }
      for (const slot of grass) {
        reach(kernel, w, use, slot);
        applyBoosts(kernel, w, slot, { def: 1 }, use.user, { use, effect: "move", report: true });
      }
      return [w];
    },
  },
  rototiller: {
    // PS/data/moves.ts rototiller onHitField: an airborne Pokémon is -immune; each grounded Grass type +1 Attack +1 Sp. Atk; no
    // grounded Grass type and none airborne: it fails.
    sideOrField(kernel, w, use) {
      const c = changeOf(kernel, w, use);
      const grass: DoublesSlotId[] = [];
      let airborne = false;
      for (const slot of allActive(kernel, w)) {
        if (!groundedFor(kernel, w, slot, use, c)) {
          airborne = true;
          use.reached.add(slot);
          const stats = kernel.hitStats(use.action, slot);
          if (stats) { stats.reached += w.mass; stats.noDamage += w.mass; }
          hitFact(kernel, use, slot, `${name(kernel, slot)} is immune.`, w);
          continue;
        }
        if (kernel.typesIn(w, slot).includes("Grass")) grass.push(slot);
      }
      if (!grass.length && !airborne) { kernel.stepFact(use.action, `${use.move.name} fails: no grounded Grass type is in play.`, w.mass); return [w]; }
      for (const slot of grass) {
        reach(kernel, w, use, slot);
        applyBoosts(kernel, w, slot, { atk: 1, spa: 1 }, use.user, { use, effect: "move", report: true });
      }
      return [w];
    },
  },
  // ---- Direct stage writes (F1 §3.1: no boost event; White Herb at AfterMove) ----
  psychUp: {
    // PS/data/moves.ts psychup onHit: the target's seven stages and critical-hit volatiles onto the user (SA03).
    onHit(kernel, w, use, slot) {
      const user = use.user;
      const crit = critKey(w, user);
      writeStages(kernel, w, user, stagesOf(w, slot), use);
      copyCritStages(w, slot, user);
      kernel.stepFact(use.action, `${name(kernel, user)} copies ${name(kernel, slot)}'s stat changes.`, w.mass);
      if (critKey(w, user) !== crit) kernel.stepFact(use.action, `${name(kernel, user)}'s critical-hit stages are now ${name(kernel, slot)}'s.`, w.mass);
      return [w];
    },
  },
  swapStages: {
    // PS/data/moves.ts powerswap, guardswap, heartswap onHit: setBoost both ways (SA04, SA04b, SA04c, SA04d).
    onHit(kernel, w, use, slot) {
      const stats: readonly Stage[] = use.move.id === "powerswap" ? ["atk", "spa"] : use.move.id === "guardswap" ? ["def", "spd"] : STAGES;
      const mine = stagesOf(w, use.user, stats), theirs = stagesOf(w, slot, stats);
      writeStages(kernel, w, slot, mine, use, { herb: false });
      writeStages(kernel, w, use.user, theirs, use, { herb: false });
      whiteHerbAfterMove(kernel, w, slot, use);
      whiteHerbAfterMove(kernel, w, use.user, use);
      const what = use.move.id === "powerswap" ? "Attack and Sp. Atk changes" : use.move.id === "guardswap" ? "Defense and Sp. Def changes" : "stat changes";
      kernel.stepFact(use.action, `${name(kernel, use.user)} and ${name(kernel, slot)} swap their ${what}.`, w.mass);
      return [w];
    },
  },
  topsyTurvy: {
    // PS/data/moves.ts topsyturvy onHit: every stage not 0 negated; none: it fails (SA08, K14).
    onHit(kernel, w, use, slot) {
      const stages = stagesOf(w, slot);
      const changed = Object.fromEntries(Object.entries(stages).filter(([, stage]) => stage).map(([stat, stage]) => [stat, -stage!]));
      if (!Object.keys(changed).length) { hitFact(kernel, use, slot, `${use.move.name} fails: ${name(kernel, slot)} has no stat changes.`, w); return [w]; }
      hitFact(kernel, use, slot, "Its stat changes are inverted.", w);
      writeStages(kernel, w, slot, changed, use);
      return [w];
    },
  },
  // ---- Stored stats (F1 §3.2, §4.2) ----
  splitStats: {
    // PS/data/moves.ts powersplit, guardsplit onHit: both stored stats to floor((a + b) / 2) (K12, SA06, SA06b).
    onHit(kernel, w, use, slot) {
      const pair: readonly ["atk", "spa"] | readonly ["def", "spd"] = use.move.id === "powersplit" ? ["atk", "spa"] : ["def", "spd"];
      const a = storedOf(kernel, w, use.user), b = storedOf(kernel, w, slot);
      const mean = Object.fromEntries(pair.map((stat) => [stat, Math.floor((a[stat] + b[stat]) / 2)])) as Partial<Record<CombatStat, number>>;
      setStored(w, use.user, { ...a, ...mean });
      setStored(w, slot, { ...b, ...mean });
      const [first, second] = pair;
      kernel.stepFact(use.action, `${name(kernel, use.user)} and ${name(kernel, slot)} now have ${mean[first]} ${STAGE_NAMES[first]} and ${mean[second]} ${STAGE_NAMES[second]}.`, w.mass);
      return [w];
    },
  },
  speedSwap: {
    // PS/data/moves.ts speedswap onHit: the stored Speeds swapped (K10; the generation 8 re-sort follows, USUM's order is frozen).
    onHit(kernel, w, use, slot) {
      const a = storedOf(kernel, w, use.user), b = storedOf(kernel, w, slot);
      setStored(w, use.user, { ...a, spe: b.spe });
      setStored(w, slot, { ...b, spe: a.spe });
      kernel.stepFact(use.action, `${name(kernel, use.user)} now has ${b.spe} Speed, ${name(kernel, slot)} ${a.spe}.`, w.mass);
      return [w];
    },
  },
  powerTrick: {
    // PS/data/moves.ts powertrick, powershift: the volatile's onStart swaps the stored Attack and Defense; a second use removes
    // it (onRestart), whose onEnd swaps them back (SA07, SA07b, K11).
    moveTry(kernel, w, use) {
      const carried = kernel.input.pokemon[use.user]?.carried;
      if (!(use.move.id === "powershift" ? carried?.powerShift : carried?.powerTrick)) kernel.turnFact(`Assumes ${name(kernel, use.user)} has no ${use.move.name} from an earlier turn.`);
      return [ok(w)];
    },
    volatile(kernel, w, use, slot) {
      const key = use.move.id === "powershift" ? "powerShift" : "powerTrick";
      const stored = storedOf(kernel, w, slot);
      setStored(w, slot, { ...stored, atk: stored.def, def: stored.atk });
      const ends = !!w.mons[slot]!.vol[key];
      setVol(w, slot, { [key]: ends ? undefined : true } as Partial<MoveVolatiles>);
      hitFact(kernel, use, slot, `${use.move.name}${ends ? " ends" : ""}: ${name(kernel, slot)}'s Attack is ${stored.def} and its Defense ${stored.atk}.`, w);
      return true;
    },
  },
  // ---- Abilities (F1 §3.4, §4.4) ----
  skillSwap: {
    // PS/data/moves.ts skillswap onHit: battle.skillSwap (its checks are there).
    onHit(kernel, w, use, slot) {
      return skillSwap(kernel, w, use.user, slot, use);
    },
  },
  rolePlay: {
    // PS/data/moves.ts roleplay onTryHit: the same ability, the target's failroleplay, the user's cantsuppress; onHit:
    // source.setAbility(target's).
    tryHit(kernel, w, use, slot) {
      const mine = realAbility(kernel, w, use.user), theirs = realAbility(kernel, w, slot);
      if (mine === theirs) return `${name(kernel, use.user)} already has ${kernel.abilityName(mine)}`;
      if (flag(kernel, theirs, "failroleplay")) return `${name(kernel, slot)}'s ${kernel.abilityName(theirs)} cannot be copied`;
      if (flag(kernel, mine, "cantsuppress")) return `${name(kernel, use.user)}'s ${kernel.abilityName(mine)} cannot be replaced`;
      return null;
    },
    onHit(kernel, w, use, slot) {
      return changeMove(kernel, w, use, use.user, realAbility(kernel, w, slot), "roleplay");
    },
  },
  entrainment: {
    // PS/data/moves.ts entrainment onTryHit: a Dynamaxed target, the same ability, the target's cantsuppress or Truant, the
    // user's noentrain; onHit: target.setAbility(source's).
    tryHit(kernel, w, use, slot) {
      const mine = realAbility(kernel, w, use.user), theirs = realAbility(kernel, w, slot);
      if (isMaxActive(w.mons[slot]!.build)) return `${name(kernel, slot)} is Dynamaxed`;
      if (mine === theirs) return `${name(kernel, slot)} already has ${kernel.abilityName(mine)}`;
      if (flag(kernel, theirs, "cantsuppress") || theirs === "truant") return `${name(kernel, slot)}'s ${kernel.abilityName(theirs)} cannot be replaced`;
      if (flag(kernel, mine, "noentrain")) return `${name(kernel, use.user)}'s ${kernel.abilityName(mine)} cannot be passed on`;
      return null;
    },
    onHit(kernel, w, use, slot) {
      return changeMove(kernel, w, use, slot, realAbility(kernel, w, use.user), "entrainment");
    },
  },
  simpleBeam: {
    // PS/data/moves.ts simplebeam onTryHit: the target's cantsuppress, Simple, Truant; onHit: setAbility('simple') (its old
    // ability's End: SA16's Unnerve).
    tryHit(kernel, w, use, slot) {
      void use;
      const theirs = realAbility(kernel, w, slot);
      if (theirs === "simple") return `${name(kernel, slot)} already has ${kernel.abilityName("simple")}`;
      if (flag(kernel, theirs, "cantsuppress") || theirs === "truant") return `${name(kernel, slot)}'s ${kernel.abilityName(theirs)} cannot be replaced`;
      return null;
    },
    onHit(kernel, w, use, slot) {
      return changeMove(kernel, w, use, slot, "simple", "simplebeam");
    },
  },
  worrySeed: {
    // PS/data/moves.ts worryseed onTryImmunity: Truant and Insomnia are immune; onTryHit: cantsuppress; onHit:
    // setAbility('insomnia'), then a sleeping target is cured (Q2b; K9c: a later Spore fails through canStatus).
    tryImmunity(kernel, w, use, slot) {
      const theirs = realAbility(kernel, w, slot);
      if (theirs !== "truant" && theirs !== "insomnia") return null;
      const stats = kernel.hitStats(use.action, slot);
      if (stats) stats.noDamage += w.mass;
      hitFact(kernel, use, slot, `${name(kernel, slot)} is immune.`, w);
      return false;
    },
    tryHit(kernel, w, use, slot) {
      void use;
      const theirs = realAbility(kernel, w, slot);
      return flag(kernel, theirs, "cantsuppress") ? `${name(kernel, slot)}'s ${kernel.abilityName(theirs)} cannot be replaced` : null;
    },
    onHit(kernel, w, use, slot) {
      return changeMove(kernel, w, use, slot, "insomnia", "worryseed", (world, c) => {
        if (world.mons[slot]!.build.status === "slp") cure(kernel, world, slot, c);
      });
    },
  },
  gastroAcid: {
    // PS/data/moves.ts gastroacid onTryHit: cantsuppress fails, an Ability Shield blocks; condition onStart: the old ability's
    // End, then it is suppressed (pinned ignoringAbility: the build holds the stand-in, MoveVolatiles.gastroAcid the ability).
    tryHit(kernel, w, use, slot) {
      void use;
      const theirs = realAbility(kernel, w, slot);
      return flag(kernel, theirs, "cantsuppress") ? `${name(kernel, slot)}'s ${kernel.abilityName(theirs)} cannot be suppressed` : null;
    },
    volatile(kernel, w, use, slot) {
      const mon = w.mons[slot]!;
      const theirs = realAbility(kernel, w, slot);
      if (mon.vol.gastroAcid !== undefined) { hitFact(kernel, use, slot, `${use.move.name} fails: it is already up on ${name(kernel, slot)}.`, w); return false; }
      if (shielded(kernel, w, slot)) {
        const stats = kernel.hitStats(use.action, slot);
        if (stats) { stats.effect -= w.mass; stats.blocked += w.mass; }
        hitFact(kernel, use, slot, `${kernel.itemName("abilityshield")}: ${name(kernel, slot)} keeps ${kernel.abilityName(theirs)}.`, w);
        return false;
      }
      return true;
    },
    onHit(kernel, w, use, slot) {
      const c = changeOf(kernel, w, use);
      const theirs = realAbility(kernel, w, slot);
      endBefore(kernel, w, slot, theirs, c);
      const vol = volOf(w, slot);
      w.mons[slot]!.build = { ...w.mons[slot]!.build, abilityId: GAS_STAND_IN };
      setVol(w, slot, { gastroAcid: theirs, ...(vol.transform?.inert ? { transform: vol.transform.into ? { into: vol.transform.into } : undefined } : {}) } as Partial<A1Vol>);
      endAfter(kernel, w, slot, theirs, c);
      hitFact(kernel, use, slot, `Its ${kernel.abilityName(theirs)} is suppressed.`, w);
      return finish(kernel, [w], c);
    },
  },
  doodle: {
    // PS/data/moves.ts doodle onHit: not from a failroleplay target; the user and its partner (alliesAndSelf, by position), each
    // not with that ability already and not cantsuppress, get it (setAbility with its Start: K9).
    onHit(kernel, w, use, slot) {
      const theirs = realAbility(kernel, w, slot);
      if (flag(kernel, theirs, "failroleplay")) { hitFact(kernel, use, slot, `${use.move.name} fails: ${name(kernel, slot)}'s ${kernel.abilityName(theirs)} cannot be copied.`, w); return [w]; }
      const c = changeOf(kernel, w, use);
      const side = allActive(kernel, w).filter((each) => slotSide(each) === slotSide(use.user));
      let worlds = [w];
      const changed = new Set<World>();
      for (const each of side) {
        worlds = worlds.flatMap((world) => {
          const mine = realAbility(kernel, world, each);
          if (mine === theirs || flag(kernel, mine, "cantsuppress")) return [world];
          const result = changeAbility(kernel, world, each, theirs, c, "doodle", `${name(kernel, each)} gets ${kernel.abilityName(theirs)}.`);
          for (const next of result.worlds) if (result.done || changed.has(world)) changed.add(next);
          return result.worlds;
        });
      }
      for (const world of worlds) if (!changed.has(world)) kernel.stepFact(use.action, `${use.move.name} fails.`, world.mass);
      return finish(kernel, worlds, c);
    },
  },
  transform: {
    onHit(kernel, w, use, slot) {
      return transformInto(kernel, w, use, slot);
    },
  },
};

/** An ability move's change on `slot` (pinned setAbility through the move): its fact, `after` (Worry Seed's cure), the move's end. */
function changeMove(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId, ability: string, how: AbilityChange, after?: (world: World, c: Change) => void): World[] {
  const c = changeOf(kernel, w, use);
  const result = changeAbility(kernel, w, slot, ability, c, how, `${name(kernel, slot)} gets ${kernel.abilityName(ability)}.`);
  if (!result.done) {
    if (!shielded(kernel, w, slot)) hitFact(kernel, use, slot, `${use.move.name} fails.`, w);
    return result.worlds;
  }
  for (const world of result.worlds) after?.(world, c);
  return finish(kernel, result.worlds, c);
}

/** `slot`'s stored stats now (kernel.buildStats: an earlier override included), the five but HP. */
function storedOf(kernel: TurnKernel, w: World, slot: DoublesSlotId): Record<CombatStat, number> {
  const stats = kernel.buildStats(w.mons[slot]!.build);
  if (!stats) return kernel.notEstimated(REASONS.notIn2v2(kernel.names[slot]));
  return { atk: stats.atk, def: stats.def, spa: stats.spa, spd: stats.spd, spe: stats.spe };
}
/** BattleBuild.storedStats on `slot`'s world build (F1 §3.2). */
function setStored(w: World, slot: DoublesSlotId, stats: Record<CombatStat, number>) {
  const mon = w.mons[slot]!;
  mon.build = { ...mon.build, storedStats: Object.fromEntries(COMBAT.map((stat) => [stat, stats[stat]])) as Record<CombatStat, number> };
}

// ------------------------------------------------------------------------------------------------------------------
// The next turn's state and the card's conditions (needsFromIntegrator: doubles-turn.ts outcomeOf and doubles-status.ts
// conditions call these)
// ------------------------------------------------------------------------------------------------------------------

/**
 * A1's part of an E2 outcome Pokémon (SPEC2 §3.1): the volatiles the next turn reads (stockpile, powertrick, powershift,
 * noretreat, minimize, gastroacid, transform, trapped, twoturnmove and geomancy for a charged Geomancy), the build with its own
 * ability where the world build holds the stand-in (Gastro Acid, an inert copy), the accuracy and evasion stages, a
 * transformed Pokémon's moves (its target's, when the input gives them).
 */
export function outcomeMon(kernel: TurnKernel, w: World, slot: DoublesSlotId): { volatiles: string[]; build?: BattleBuild; fields: Partial<DoublesOutcomeMon> } {
  const mon = w.mons[slot]!;
  if (mon.fainted) return { volatiles: [], fields: {} };
  const vol = mon.vol as A1Vol;
  const volatiles = [
    ...(vol.stockpile ? ["stockpile"] : []), ...(vol.powerTrick ? ["powertrick"] : []), ...(vol.powerShift ? ["powershift"] : []),
    ...(vol.noRetreat ? ["noretreat"] : []), ...(vol.minimize ? ["minimize"] : []), ...(vol.gastroAcid !== undefined ? ["gastroacid"] : []),
    ...(mon.build.transformedFrom ? ["transform"] : []), ...(trappedNow(w, slot) ? ["trapped"] : []), ...(vol.charging === "geomancy" ? ["twoturnmove", "geomancy"] : []),
  ];
  const own = vol.gastroAcid ?? vol.transform?.inert;
  const fields: Partial<DoublesOutcomeMon> = {};
  const stages = Object.fromEntries(Object.entries(mon.vol.stages ?? {}).filter(([, stage]) => stage));
  if (Object.keys(stages).length) fields.stages = stages;
  const moves = vol.transform?.into ? kernel.input.pokemon[vol.transform.into]?.moves : undefined;
  if (mon.build.transformedFrom && moves) fields.moves = [...moves];
  return { volatiles, ...(own !== undefined && mon.build.abilityId === GAS_STAND_IN ? { build: { ...mon.build, abilityId: own } } : {}), fields };
}

/**
 * A1's condition facts on `slot` in one world (DoublesHP.conditions, SPEC2 §5.1): Stockpile, Power Trick, Power Shift, No
 * Retreat, Minimize, a suppressed ability, an ability changed this turn, a Transform this turn, a Geomancy charge.
 */
export function conditions(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  const mon = w.mons[slot]!;
  if (mon.fainted) return [];
  const vol = mon.vol as A1Vol;
  const out: string[] = [];
  if (vol.stockpile) out.push(`Stockpile ${vol.stockpile.layers}.`);
  if (vol.powerTrick) out.push("Power Trick.");
  if (vol.powerShift) out.push("Power Shift.");
  if (vol.noRetreat) out.push("No Retreat.");
  if (vol.minimize) out.push("Minimized.");
  if (vol.gastroAcid !== undefined) out.push("Ability suppressed.");
  if (vol.transform?.into) out.push(`Transformed into ${kernel.names[vol.transform.into]}.`);
  else if (mon.build.abilityChanged && mon.build.abilityId !== GAS_STAND_IN && mon.build.abilityId !== kernel.input.pokemon[slot]?.build.abilityId) out.push(`Ability: ${kernel.abilityName(mon.build.abilityId)}.`);
  if (vol.charging === "geomancy") out.push(`Charging ${kernel.moveName("geomancy")}.`);
  return out;
}
