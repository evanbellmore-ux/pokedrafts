import { REASONS } from "./doubles-actions";
import { allyOf, DOUBLES_SLOTS, foesOf, SHOWDOWN_POSITION, slotSide, type DoublesSideId, type DoublesSlotId, type DoublesTurnInput } from "./doubles-types";
import { cloneWorld, mapHP, type PendingAction, type World } from "./doubles-world";
import type { TurnKernel, TurnMoveInfo } from "./doubles-turn";
import type { GivenStatus } from "./doubles-status";
import { setEot, setVol, type Use } from "./doubles-use";
import * as hiddenNs from "./doubles-hidden";
import * as itemNs from "./doubles-items";
import * as typingNs from "./doubles-typing";
import { getBuildGender, isMaxActive } from "./mechanics";
import { MAX_MOVE_EFFECTS } from "./stat-moves";
import type { ChampionsMove } from "./types";

// Max Moves, G-Max moves and Max Guard (status2 ADDENDUM2 §3.5, §4.3 M; T2M §3.19, §3.24): Track M's file (wave 1b), Sword/Shield
// only (the one game with Dynamax). Pinned Showdown c23d2e94 (PS/… = node_modules/.cache/champions/pokemon-showdown-c23d2e9…):
// - every G-Max move's self.onHit (PS/data/moves.ts:6712-7536), which runs in the hit after its damage (sim/battle-actions.ts
//   spreadMoveHit step 4 selfDrops, before DamagingHit and the hit's Update: :1086-1129, :967); the damage over time of Vine Lash,
//   Wildfire, Cannonade, Volcalith and the traps of Centiferno and Sandblast are E2's (doubles-eot.ts, T2E §4.4); G-Max Snooze's
//   Yawn is a 1/2 chance (the turn's rule: added effects below 100% do not happen);
// - Max Guard (PS/data/moves.ts:11157-11205): a Dynamaxed Pokémon's status move (sim/battle-actions.ts:1494-1513
//   getActiveMaxMove, MAX_MOVES.Status), priority 4 (sim/battle.ts:2631-2649 reads the Max Move's dex priority), a stalling move
//   (N's stall roll), blocking every move into its user but its pass list, Max Moves included, with no contact effect;
// - Pain Split into a Dynamaxed Pokémon (PS/data/moves.ts:13129-13146, PS/sim/pokemon.ts:748-754 getUndynamaxedHP, :1655-1667
//   sethp).
// The kernel lines these parts read (status2/build/W1B-M.md M-1 … M-17) are in since integration 1b: maxEffects' worlds at its
// call sites (G-Max Befuddle's and Stun Shock's random statuses, G-Max Replenish's 1/2), the Max Guard lines (the used move, the
// protect kind, the blocks), Pain Split's arithmetic, and G-Max Chi Strike's card condition and E2 volatile.

/** The moves Max Guard lets through (PS/data/moves.ts:11183-11185 bypassesMaxGuard). */
export const MAX_GUARD_PASS: ReadonlySet<string> = new Set([
  "acupressure", "afteryou", "allyswitch", "aromatherapy", "aromaticmist", "coaching", "confide", "copycat", "curse", "decorate", "doomdesire",
  "feint", "futuresight", "gmaxoneblow", "gmaxrapidflow", "healbell", "holdhands", "howl", "junglehealing", "lifedew", "meanlook", "perishsong",
  "playnice", "powertrick", "roar", "roleplay", "tearfullook",
]);

/** The statuses G-Max Befuddle and Stun Shock pick per foe (this.sample(['slp', 'par', 'psn']); this.random(2): par, psn). */
const RANDOM_STATUSES: Readonly<Record<string, readonly ("slp" | "par" | "psn")[]>> = { gmaxbefuddle: ["slp", "par", "psn"], gmaxstunshock: ["par", "psn"] };
/** The fact for a status a G-Max move gave ("{G-Max Befuddle}: {Name} is {paralysed}."). */
const GIVEN: Readonly<Record<string, string>> = { slp: "falls asleep", par: "is paralysed", psn: "is poisoned" };
/** Status names in the cure facts (doubles-status.ts STATUS_NOUNS). */
const STATUS_NOUNS: Readonly<Record<string, string>> = { slp: "sleep", par: "paralysis", brn: "burn", psn: "poison", tox: "bad poison", frz: "freeze" };
/** The hazards G-Max Wind Rage removes from both sides (PS/data/moves.ts:7510-7520 removeAll; the foe side's screens, Safeguard and Mist too). */
const WIND_RAGE_ENDS: readonly ["safeguard" | "mist", string][] = [["safeguard", "safeguard"], ["mist", "mist"]];

const toId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const positionOf = (kernel: TurnKernel, w: World, slot: DoublesSlotId) => SHOWDOWN_POSITION[kernel.positionOf(w, slot)].position;
/** `attacker`'s living foes by their positions after an Ally Switch (sim/pokemon.ts foes(): HP above 0; ADDENDUM §3.5.2). */
function foesInOrder(kernel: TurnKernel, w: World, attacker: DoublesSlotId): DoublesSlotId[] {
  return [...foesOf(attacker)].sort((a, b) => positionOf(kernel, w, a) - positionOf(kernel, w, b)).filter((slot) => kernel.alive(w, slot));
}
/** `attacker` and its living ally by position (sim/pokemon.ts alliesAndSelf: side.allies(), HP above 0). */
function sideInOrder(kernel: TurnKernel, w: World, attacker: DoublesSlotId): DoublesSlotId[] {
  return [attacker, allyOf(attacker)].sort((a, b) => positionOf(kernel, w, a) - positionOf(kernel, w, b)).filter((slot) => kernel.alive(w, slot));
}
/** A fact on `slot`: on the step's hit entry for its target, otherwise a step fact (the text names the Pokémon). */
function factOn(kernel: TurnKernel, action: PendingAction, target: DoublesSlotId, slot: DoublesSlotId, text: string, mass: number) {
  if (slot === target) kernel.hitFact(action, slot, text, mass);
  else kernel.stepFact(action, text, mass);
}
/** Aroma Veil on `slot`'s side (PS/data/abilities.ts aromaveil onAllyTryAddVolatile: attract, torment…; breakable by the move). */
function aromaVeiled(kernel: TurnKernel, w: World, attacker: DoublesSlotId, slot: DoublesSlotId, info: TurnMoveInfo): boolean {
  return DOUBLES_SLOTS.some((holder) => slotSide(holder) === slotSide(slot) && kernel.alive(w, holder) && holder !== w.ghost
    && w.mons[holder]!.build.abilityId === "aromaveil" && (holder === attacker || !kernel.breaks(w, attacker, holder, info)));
}

// ------------------------------------------------------------------------------------------------------------------
// The Max Moves' and G-Max moves' self.onHit
// ------------------------------------------------------------------------------------------------------------------

/**
 * A Max Move's side effects beyond its target, once a hit landed (a Substitute's hit included; data/moves.ts max* and gmax*
 * self.onHit): the stages it gives the user go to the user's partner too and the drops it gives the target to the other foe
 * (stat-moves.ts MAX_MOVE_EFFECTS: the pair's step gives the user and the target theirs); then the G-Max move's own effect
 * (gmaxEffect). Every effect is in place on `w` but G-Max Befuddle's and Stun Shock's random statuses and G-Max Replenish's
 * 1/2, which split it (WIRED.worlds); the worlds after it, `w` first.
 */
export function maxEffects(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId): World[] {
  const attacker = action.slot;
  const name = kernel.usedMove(w, attacker, action.moveId!, target, info).name;
  const effect = MAX_MOVE_EFFECTS[name];
  const partner = allyOf(attacker);
  const foes = foesInOrder(kernel, w, attacker);
  if (effect?.user && kernel.alive(w, partner)) kernel.selfBoost(w, partner, effect.user, null);
  if (effect?.foe) for (const foe of foes) if (foe !== target) kernel.foeDrop(w, foe, effect.foe, attacker, kernel.breaks(w, attacker, foe, info));
  const id = toId(name);
  return id.startsWith("gmax") ? gmaxEffect(kernel, w, action, info, target, id, name) : [w];
}

/** The G-Max move `id`'s self.onHit (PS/data/moves.ts:6712-7536), in place on `w` but where it splits it. */
function gmaxEffect(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, id: string, name: string): World[] {
  const attacker = action.slot;
  const foes = foesInOrder(kernel, w, attacker);
  const side = slotSide(attacker), foeSide: DoublesSideId = side === "own" ? "opponent" : "own";
  switch (id) {
    // Foam Burst, Tartness: this.boost on each foe (TryBoost: Mist, Clear Body, Mirror Armor; Defiant, Competitive).
    case "gmaxfoamburst": case "gmaxtartness": {
      const stages = id === "gmaxfoamburst" ? { spe: -2 } : { evasion: -1 };
      for (const foe of foes) kernel.foeDrop(w, foe, stages, attacker, kernel.breaks(w, attacker, foe, info));
      return [w];
    }
    // Volt Crash, Malodor: trySetStatus on each foe (the target's own came with the step: stat-moves.ts STATUS_MOVES).
    case "gmaxvoltcrash": case "gmaxmalodor":
      for (const foe of foes) kernel.giveStatus(w, foe, id === "gmaxvoltcrash" ? "par" : "psn", attacker);
      return [w];
    // Smite, Gold Rush: addVolatile('confusion') on each foe, the source the user (sim/pokemon.ts:1977-1981).
    case "gmaxsmite": case "gmaxgoldrush":
    {
      const confused = foes.filter((foe) => confuse(kernel, w, attacker, foe, info));
      for (const foe of confused) factOn(kernel, action, target, foe, `${name}: ${kernel.names[foe]} is confused.`, w.mass);
      for (const foe of confused) cureBerry(kernel, w, foe, (text) => factOn(kernel, action, target, foe, text, w.mass));
      return [w];
    }
    case "gmaxcuddle":
      return [cuddle(kernel, w, action, info, target, foes)];
    case "gmaxchistrike":
      for (const slot of sideInOrder(kernel, w, attacker)) chiStrike(kernel, w, action, target, slot);
      return [w];
    case "gmaxfinale":
      return [finale(kernel, w, attacker)];
    case "gmaxsweetness":
      sweetness(kernel, w, action, attacker);
      return [w];
    // Resonance: self.sideCondition 'auroraveil' (addSideCondition fails while it is up; no hail needed), on a fresh clock.
    case "gmaxresonance":
      if (!w.sides[side].auroraVeil) w.sides[side] = { ...w.sides[side], auroraVeil: true, clock: { ...w.sides[side].clock, auroraVeil: "set" } };
      return [w];
    case "gmaxgravitas":
      gravitas(kernel, w);
      return [w];
    case "gmaxwindrage":
      windRage(kernel, w, action, foeSide);
      return [w];
    // Steelsurge, Stonesurge: the foe side's hazard (addSideCondition: one already up this turn fails).
    case "gmaxsteelsurge": case "gmaxstonesurge": {
      const hazard = id === "gmaxsteelsurge" ? "gmaxsteelsurge" : "stealthrock";
      if (!w.sides[foeSide].hazards.includes(hazard)) w.sides[foeSide] = { ...w.sides[foeSide], hazards: [...w.sides[foeSide].hazards, hazard] };
      return [w];
    }
    case "gmaxterror":
      for (const foe of foes) terror(kernel, w, action, target, attacker, foe);
      return [w];
    case "gmaxmeltdown":
      for (const foe of foes) meltdown(kernel, w, action, info, target, attacker, foe);
      return [w];
    case "gmaxbefuddle": case "gmaxstunshock":
      return randomStatuses(kernel, w, action, target, attacker, id, name);
    case "gmaxreplenish":
      return replenish(kernel, w, action, target, attacker, name);
    // Depletion's PP (no later reader this turn: Trump Card is not in Sword/Shield), Snooze's 1/2 Yawn (the turn's rule), the
    // damage over time and traps (E2), One Blow and Rapid Flow (no self effect), Drum Solo, Fireball, Hydrosnipe (ignoreAbility).
    default:
      return [w];
  }
}

/**
 * A fresh confusion from a G-Max move (addVolatile('confusion')): none if it is confused already (no onRestart), Own Tempo
 * (breakable), Misty Terrain under a grounded Pokémon that is not hidden, or Safeguard on its side against another Pokémon
 * unless the user's Infiltrator passes it into a foe (TryAddVolatile: PS/data/abilities.ts owntempo, PS/data/moves.ts
 * mistyterrain, safeguard condition onTryAddVolatile). Whether it was confused.
 */
function confuse(kernel: TurnKernel, w: World, attacker: DoublesSlotId, slot: DoublesSlotId, info: TurnMoveInfo): boolean {
  const mon = w.mons[slot]!;
  if (mon.vol.confusion) return false;
  if (mon.build.abilityId === "owntempo" && !kernel.breaks(w, attacker, slot, info)) return false;
  if (w.field.terrain === "Misty" && kernel.grounded(w, slot) && !mon.eot.hidden) return false;
  const infiltrates = w.mons[attacker]!.build.abilityId === "infiltrator" && kernel.isFoe(attacker, slot);
  if (w.sides[slotSide(slot)].safeguard && attacker !== slot && !infiltrates) return false;
  setVol(w, slot, { confusion: { attempts: 0, min: 2 } });
  return true;
}

/** The curing Berries' statuses (data/items.ts lumberry, cheriberry, chestoberry, pechaberry, rawstberry, aspearberry onUpdate). */
const CURES: Readonly<Record<string, readonly string[]>> = {
  lumberry: ["par", "brn", "psn", "tox", "slp", "frz"], cheriberry: ["par"], chestoberry: ["slp"], pechaberry: ["psn", "tox"], rawstberry: ["brn"], aspearberry: ["frz"],
};
/**
 * A curing Berry at the hit's Update (data/items.ts lumberry and its kin onUpdate; Persim and Lum against a confusion; a foe's
 * Unnerve or As One stops it): eaten (item history, Unburden, Cheek Pouch), the status and the confusion it cures end, with the
 * fact ("{Name} eats its {Persim Berry}: its confusion ends."). Whether it was eaten.
 */
function cureBerry(kernel: TurnKernel, w: World, slot: DoublesSlotId, fact: (text: string) => void): boolean {
  const mon = w.mons[slot];
  if (!mon || mon.fainted) return false;
  const build = mon.build, item = build.itemId, status = build.status;
  const curesStatus = !!status && !!CURES[item]?.includes(status);
  const curesConfusion = !!mon.vol.confusion && (item === "lumberry" || item === "persimberry");
  if ((!curesStatus && !curesConfusion) || !kernel.itemWorks(w, build) || kernel.berryStopped(w, slot)) return false;
  mon.build = { ...build, itemId: "", ...(curesStatus ? { status: "" as const } : {}), ...(build.abilityId === "unburden" ? { abilityActive: true } : {}) };
  kernel.noteItemUse(w, slot, item);
  if (curesConfusion) setVol(w, slot, { confusion: undefined });
  if (curesStatus && status === "slp") setVol(w, slot, { sleep: undefined });
  if (curesStatus && status === "frz") setVol(w, slot, { freeze: undefined });
  if (curesStatus && status === "tox") setEot(w, slot, { toxic: undefined });
  kernel.pouchHeal(w, slot);
  const ended = [curesStatus ? STATUS_NOUNS[status] : "", curesConfusion ? "confusion" : ""].filter(Boolean).join(" and ");
  fact(`${kernel.names[slot]} eats its ${kernel.itemName(item)}: its ${ended} ends.`);
  return true;
}

/**
 * G-Max Cuddle (PS/data/moves.ts:6836-6857): addVolatile('attract') on each foe, the source the user (PS/sim/pokemon.ts:1977-1981).
 * None if it is infatuated already (no onRestart) or has Oblivious (onImmunity 'attract'; breakable); Aroma Veil on its side
 * (TryAddVolatile); then the attract condition's Start: opposite genders only (genderless or the same: none; a species of both
 * genders with none set: REASONS.needsGender, USER-DECISIONS Q10); the Attract event: its Destiny Knot infatuates the user back
 * (PS/data/items.ts destinyknot onAttract) unless the user is infatuated already, has Oblivious or its side's Aroma Veil.
 * Mental Herb ends it at the hit's Update (mentalHerb). A2's Attract state (MonState.vol.attract: the source's slot).
 */
function cuddle(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, foes: DoublesSlotId[]): World {
  const attacker = action.slot;
  const user = w.mons[attacker]!;
  const own = getBuildGender(user.build, kernel.runtime);
  const infatuated: DoublesSlotId[] = [];
  for (const foe of foes) {
    const mon = w.mons[foe]!;
    if (mon.vol.attract) continue;
    if (mon.build.abilityId === "oblivious" && !kernel.breaks(w, attacker, foe, info)) continue;
    if (aromaVeiled(kernel, w, attacker, foe, info)) continue;
    const theirs = getBuildGender(mon.build, kernel.runtime);
    if (theirs === "N" || own === "N") continue;
    if (!theirs) kernel.notEstimated(REASONS.needsGender("G-Max Cuddle", kernel.names[foe]));
    if (!own) kernel.notEstimated(REASONS.needsGender("G-Max Cuddle", kernel.names[attacker]));
    if (theirs === own) continue;
    setVol(w, foe, { attract: attacker });
    infatuated.push(foe);
    factOn(kernel, action, target, foe, `G-Max Cuddle: ${kernel.names[foe]} is infatuated.`, w.mass);
    const knot = mon.build.itemId === "destinyknot" && kernel.itemWorks(w, mon.build);
    if (knot && kernel.alive(w, attacker) && !w.mons[attacker]!.vol.attract && user.build.abilityId !== "oblivious" && !aromaVeiled(kernel, w, foe, attacker, info)) {
      setVol(w, attacker, { attract: foe });
      infatuated.push(attacker);
      factOn(kernel, action, target, foe, `${kernel.itemName("destinyknot")}: ${kernel.names[attacker]} becomes infatuated too.`, w.mass);
    }
  }
  for (const slot of DOUBLES_SLOTS) if (infatuated.includes(slot)) mentalHerb(kernel, w, action, target, slot);
  return w;
}

/**
 * Mental Herb at the hit's Update (data/items.ts mentalherb onUpdate: attract, taunt, encore, torment, disable, healblock; useItem,
 * which Unnerve does not stop): used up, its holder's conditions end, Unburden. `torment`: the condition that set it off is a
 * Torment (not kept as a state: it changes only the next choice).
 */
function mentalHerb(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, slot: DoublesSlotId, torment = false) {
  const mon = w.mons[slot];
  if (!mon || mon.fainted) return;
  const build = mon.build;
  if (build.itemId !== "mentalherb" || !kernel.itemWorks(w, build)) return;
  const ended = [mon.vol.attract ? "infatuation" : "", torment ? kernel.moveName("torment") : "", mon.vol.taunt ? kernel.moveName("taunt") : "",
    mon.vol.encore ? kernel.moveName("encore") : "", mon.vol.disabled ? kernel.moveName("disable") : "", mon.eot.healBlock ? kernel.moveName("healblock") : ""].filter(Boolean);
  if (!ended.length) return;
  mon.build = { ...build, itemId: "", ...(build.abilityId === "unburden" ? { abilityActive: true } : {}) };
  kernel.noteItemUse(w, slot, "mentalherb");
  setVol(w, slot, { attract: undefined, taunt: undefined, encore: undefined, disabled: undefined });
  setEot(w, slot, { healBlock: undefined });
  factOn(kernel, action, target, slot, `${kernel.itemName("mentalherb")}: ${kernel.names[slot]}'s ${ended.join(", ")} ends.`, w.mass);
}

/** G-Max Chi Strike (PS/data/moves.ts:6795-6834): the gmaxchistrike volatile, +1 critical-hit stage a layer, at most 3 (onRestart). */
function chiStrike(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, slot: DoublesSlotId) {
  const layers = w.mons[slot]!.vol.chiStrike ?? 0;
  if (layers >= 3) return;
  setVol(w, slot, { chiStrike: (layers + 1) as 1 | 2 | 3 });
  factOn(kernel, action, target, slot, `G-Max Chi Strike: ${kernel.names[slot]}'s critical-hit ratio rises.`, w.mass);
}

/**
 * G-Max Finale (PS/data/moves.ts:6905-6926): this.heal(maxhp / 6) on the user and its living ally (sim/battle.ts heal: truncated,
 * through TryHeal: Heal Block stops it; none at full HP), the maximum the Dynamax one. In place: the user's HP is unchanged by the
 * step here (randomStatusGuard keeps a use whose step changes it out). The heals list (DoublesHP.heals).
 */
function finale(kernel: TurnKernel, w: World, attacker: DoublesSlotId): World {
  for (const slot of sideInOrder(kernel, w, attacker)) {
    if (w.mons[slot]!.eot.healBlock) continue;
    const { maxHP } = kernel.hp[slot];
    const gain = Math.trunc(maxHP / 6);
    const [next] = mapHP(w, slot, (hp) => {
      if (hp <= 0 || hp >= maxHP) return { hp, tag: "" };
      const after = Math.min(maxHP, hp + gain);
      kernel.noteHeal(slot, "G-Max Finale", after - hp);
      return { hp: after, tag: "" };
    });
    w.factors = next.world.factors;
  }
  return w;
}

/**
 * G-Max Sweetness (PS/data/moves.ts:7299-7319): cureStatus on every Pokémon of the user's side, the bench included (the user's own:
 * the step, stat-moves.ts MAX_MOVE_EFFECTS curesUserStatus): its living ally here, and the bench (SideState.benchCured, E2).
 */
function sweetness(kernel: TurnKernel, w: World, action: PendingAction, attacker: DoublesSlotId) {
  const partner = allyOf(attacker);
  const side = slotSide(attacker);
  if (kernel.alive(w, partner) && w.mons[partner]!.build.status) {
    const status = w.mons[partner]!.build.status;
    w.mons[partner]!.build = { ...w.mons[partner]!.build, status: "" };
    if (status === "slp") setVol(w, partner, { sleep: undefined });
    if (status === "frz") setVol(w, partner, { freeze: undefined });
    if (status === "tox") setEot(w, partner, { toxic: undefined });
    kernel.stepFact(action, `G-Max Sweetness: ${kernel.names[partner]}'s status is cured.`, w.mass);
  }
  w.sides[side] = { ...w.sides[side], benchCured: true };
  if (kernel.input.canSwitch?.[side] !== false && DOUBLES_SLOTS.every((slot) => slotSide(slot) !== side || kernel.input.pokemon[slot])) {
    kernel.stepFact(action, `G-Max Sweetness also cures the statuses of ${side === "own" ? "your side" : "the opponent's side"}'s Pokémon not in battle.`, w.mass);
  }
}

/**
 * G-Max Gravitas (PS/data/moves.ts:6987-7003 self.pseudoWeather 'gravity'): addPseudoWeather fails while Gravity is up; its
 * onFieldStart lands every hidden Pokémon (H's land) and ends Magnet Rise and Telekinesis (A2's gravityGrounds), as Gravity's
 * own start (doubles-field.ts fieldMove). Set this turn (World.fieldSet).
 */
function gravitas(kernel: TurnKernel, w: World) {
  if (w.field.gravity) return;
  w.field = { ...w.field, gravity: true };
  w.fieldSet = { ...w.fieldSet, gravity: true };
  for (const each of DOUBLES_SLOTS) if (w.mons[each]?.eot.hidden && kernel.alive(w, each)) hiddenNs.land(kernel, w, each);
  for (const each of DOUBLES_SLOTS) if (kernel.alive(w, each)) typingNs.gravityGrounds(kernel, w, each);
}

/**
 * G-Max Wind Rage (PS/data/moves.ts:7501-7536): the foe side's Reflect, Light Screen and Aurora Veil (the step's conditions),
 * Safeguard and Mist end; every hazard goes from both sides (hazardsFrom null); the terrain ends (the step's conditions).
 */
function windRage(kernel: TurnKernel, w: World, action: PendingAction, foeSide: DoublesSideId) {
  const state = w.sides[foeSide];
  const gone = WIND_RAGE_ENDS.filter(([flag]) => state[flag]);
  const { mist: _mist, clock, ...rest } = state;
  void _mist;
  // A condition gone takes its clock entry with it (the screens the step's conditions ended too).
  const up = { ...rest, safeguard: false } as Record<string, unknown>;
  const kept = clock ? Object.fromEntries(Object.entries(clock).filter(([flag]) => !!up[flag])) : {};
  w.sides[foeSide] = { ...rest, safeguard: false, ...(Object.keys(kept).length ? { clock: kept } : {}) };
  const sideName = foeSide === "own" ? "your side" : "the opponent's side";
  for (const [, move] of gone) kernel.stepFact(action, `G-Max Wind Rage: ${kernel.moveName(move)} ends on ${sideName}.`, w.mass);
  const landed = w.sides.own.hazards.length > 0 || w.sides.opponent.hazards.length > 0;
  for (const each of ["own", "opponent"] as const) w.sides[each] = { ...w.sides[each], hazards: [], hazardsFrom: null };
  if (landed) kernel.stepFact(action, "G-Max Wind Rage: the hazards on both sides are cleared.", w.mass);
}

/**
 * G-Max Terror (PS/data/moves.ts:7343-7363): addVolatile('trapped', source, null, 'trapper') on each foe: none on one trapped
 * already or a Ghost type (runStatusImmunity 'trapped'); linked to the user (A1's trapped state: vol.trappers).
 */
function terror(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, attacker: DoublesSlotId, foe: DoublesSlotId) {
  const vol = w.mons[foe]!.vol;
  const trapped = !!vol.trapped && (!vol.trappers || vol.trappers.some((source) => !w.mons[source]?.fainted));
  if (trapped || !kernel.alive(w, attacker) || kernel.typesIn(w, foe).includes("Ghost")) return;
  setVol(w, foe, { trapped: true, trappers: [attacker] });
  factOn(kernel, action, target, foe, `${kernel.names[foe]} can no longer switch out.`, w.mass);
}

/**
 * G-Max Meltdown (PS/data/moves.ts:7043-7063): Torment on each foe that is not Dynamaxed; Aroma Veil on its side blocks it
 * (TryAddVolatile). Torment changes only the next choice (no state here); Mental Herb ends it at the hit's Update, used up.
 */
function meltdown(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, attacker: DoublesSlotId, foe: DoublesSlotId) {
  if (isMaxActive(w.mons[foe]!.build) || aromaVeiled(kernel, w, attacker, foe, info)) return;
  mentalHerb(kernel, w, action, target, foe, true);
}

/**
 * G-Max Befuddle and Stun Shock (PS/data/moves.ts:6712-6733, 7272-7297): per foe in order, a status picked at random (1/3 each of
 * slp, par, psn; 1/2 each of par, psn), then trySetStatus from the user (the kernel's giveStatus: canStatus' immunities, Synchronize,
 * a curing Berry at once; sleep's counter fresh). One world per pick that lands; picks that change nothing share their world.
 */
function randomStatuses(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, attacker: DoublesSlotId, id: string, name: string): World[] {
  const picks = RANDOM_STATUSES[id];
  let worlds: World[] = [w];
  for (const foe of foesInOrder(kernel, w, attacker)) {
    worlds = worlds.flatMap((world) => {
      if (!kernel.alive(world, foe)) return [world];
      const share = world.mass / picks.length;
      return picks.map((status, index) => {
        const next = index === picks.length - 1 ? world : cloneWorld(world, share);
        next.mass = share;
        giveRandom(kernel, next, action, target, attacker, foe, status, name);
        return next;
      });
    });
  }
  return worlds;
}

/**
 * One random status of G-Max Befuddle or Stun Shock on `foe`: the kernel's damaging-path status (giveStatus: canStatus reads
 * sleep's immunities too, Insomnia, Vital Spirit, Sweet Veil, Electric Terrain; Synchronize; a Lum Berry at once), and for a
 * sleep a Chesto Berry at the hit's Update (data/items.ts chestoberry onUpdate) and no counter once cured.
 */
function giveRandom(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, attacker: DoublesSlotId, foe: DoublesSlotId, status: "slp" | "par" | "psn", name: string) {
  const mon = w.mons[foe]!;
  const before = mon.build.status, item = mon.build.itemId;
  kernel.giveStatus(w, foe, status as GivenStatus, attacker);
  if (status === "slp" && mon.build.status === "slp" && item === "chestoberry" && kernel.itemWorks(w, mon.build) && !kernel.berryStopped(w, foe)) {
    mon.build = { ...mon.build, itemId: "", status: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
    kernel.noteItemUse(w, foe, item);
    kernel.pouchHeal(w, foe);
  }
  if (status === "slp" && mon.build.status !== "slp") setVol(w, foe, { sleep: undefined });
  const landed = mon.build.status === status && before !== status;
  const cured = !before && !mon.build.status && !!item && !mon.build.itemId;
  if (landed) factOn(kernel, action, target, foe, `${name}: ${kernel.names[foe]} ${GIVEN[status]}.`, w.mass);
  else if (cured) factOn(kernel, action, target, foe, `${name}: ${kernel.names[foe]} ${GIVEN[status]}; its ${kernel.itemName(item)} cures it.`, w.mass);
}

/**
 * G-Max Replenish (PS/data/moves.ts:7095-7123): randomChance(1, 2) once for the move: in one half nothing; in the other each
 * Pokémon of the user's side (alliesAndSelf, by position) holding nothing whose last item is a Berry gets it back (lastItem
 * cleared, setItem: doubles-items.ts restore), then the hit's Update eats it if due (kernel.berryDue; a Persim or Lum Berry
 * against a confusion). The last item read: MonState.lastItem (item history: doubles-guards.ts tracksItems), else the input's;
 * unknown: REASONS.needsLastItem.
 */
function replenish(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, attacker: DoublesSlotId, name: string): World[] {
  const back: { slot: DoublesSlotId; item: string }[] = [];
  for (const slot of sideInOrder(kernel, w, attacker)) {
    const mon = w.mons[slot]!;
    if (mon.build.itemId) continue;
    let last: string | null | undefined = mon.lastItem;
    if (last === undefined) last = kernel.input.pokemon[slot]?.lastItem;
    if (last === undefined) kernel.notEstimated(REASONS.needsLastItem(name, kernel.names[slot]));
    if (last && last.endsWith("berry")) back.push({ slot, item: last });
  }
  if (!back.length) return [w];
  const restored = cloneWorld(w, w.mass / 2);
  w.mass /= 2;
  let worlds: World[] = [restored];
  for (const { slot, item } of back) {
    for (const world of worlds) {
      itemNs.restore(kernel, world, action, slot, item);
      factOn(kernel, action, target, slot, `G-Max Replenish: ${kernel.names[slot]}'s ${kernel.itemName(item)} comes back.`, world.mass);
    }
  }
  // The hit's Update (sim/battle-actions.ts:967): each restored Berry that is due (a curing one, else an HP or pinch Berry).
  for (const { slot } of back) {
    worlds = worlds.flatMap((world) => {
      if (!kernel.alive(world, slot) || cureBerry(kernel, world, slot, (text) => factOn(kernel, action, target, slot, text, world.mass))) return [world];
      return kernel.berryDue(world, slot);
    });
  }
  return [w, ...worlds];
}

// ------------------------------------------------------------------------------------------------------------------
// The guards known before the walk (doubles-turn.ts presenceGuards)
// ------------------------------------------------------------------------------------------------------------------

/** The step of `slot`'s action (its index among the present slots: doubles-turn.ts createContext's actions and statistics). */
function stepOf(kernel: TurnKernel, slot: DoublesSlotId) {
  const index = DOUBLES_SLOTS.filter((each) => kernel.input.pokemon[each]).indexOf(slot);
  return kernel.step({ index, slot, moveId: kernel.input.pokemon[slot]!.action.moveId, target: null, fractional: 0 });
}

/**
 * A Dynamaxed Pokémon's status move is Max Guard (sim/battle-actions.ts:1494-1513 getActiveMaxMove: MAX_MOVES.Status): its
 * step is named so (DoublesStep.effectiveName, as a Max Move's).
 */
export function statusMove(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  void w;
  if (!maxGuardAction(kernel.input, slot)) return;
  const guard = kernel.runtime.movesById.get("maxguard");
  const step = stepOf(kernel, slot);
  if (step && guard) { step.effectiveName = guard.name; step.effectiveType = guard.type; }
}

/**
 * Before the walk, for a Dynamaxed Pokémon's damaging move: G-Max Finale heals its user in the hit (self.onHit), before the move's later changes to the user's HP in the same use (its
 *   Life Orb or Shell Bell after the move, a foe's Jaboca or Rowap Berry, Innards Out, a contact ability or Rocky Helmet in its
 *   DamagingHit), while the pair's step gives the user its HP after the whole use: such a use is not estimated (a narrow reason:
 *   the heal's cap and the user's faint depend on the order).
 */
export function randomStatusGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const entry = kernel.input.pokemon[slot]!;
  const moveId = entry.action.moveId!;
  const build = w.mons[slot]!.build;
  const move = kernel.runtime.movesById.get(moveId)!;
  if (move.category === "Status" || !isMaxActive(build)) return;
  const info = kernel.moveInfo(w, slot, moveId, entry.contexts[moveId]);
  if (info.kind !== "move") return;
  const id = toId(info.effective.name);
  if (id === "gmaxfinale") finaleGuard(kernel, w, slot, info);
}

/** randomStatusGuard's G-Max Finale part: the first source that changes the user's HP in its own use after the heal. */
function finaleGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId, info: TurnMoveInfo) {
  const user = w.mons[slot]!.build;
  if (user.abilityId === "magicguard") {
    if (user.itemId === "shellbell" && kernel.itemWorks(w, user)) kernel.notEstimated(REASONS.combo("G-Max Finale", kernel.itemName("shellbell")));
    return;
  }
  if ((user.itemId === "lifeorb" || user.itemId === "shellbell") && kernel.itemWorks(w, user)) kernel.notEstimated(REASONS.combo("G-Max Finale", kernel.itemName(user.itemId)));
  const berry = info.effective.category === "Physical" ? "jabocaberry" : "rowapberry";
  for (const foe of foesOf(slot)) {
    const mon = w.mons[foe];
    if (!mon || mon.fainted) continue;
    const held = mon.build.itemId, ability = mon.build.abilityId;
    const name = kernel.names[foe];
    if (held === berry && kernel.itemWorks(w, mon.build)) kernel.notEstimated(REASONS.combo("G-Max Finale", `${name}'s ${kernel.itemName(berry)}`));
    if (ability === "innardsout") kernel.notEstimated(REASONS.combo("G-Max Finale", `${name}'s ${kernel.abilityName(ability)}`));
    if (info.contact && (ability === "roughskin" || ability === "ironbarbs")) kernel.notEstimated(REASONS.combo("G-Max Finale", `${name}'s ${kernel.abilityName(ability)}`));
    if (info.contact && held === "rockyhelmet" && kernel.itemWorks(w, mon.build)) kernel.notEstimated(REASONS.combo("G-Max Finale", `${name}'s ${kernel.itemName(held)}`));
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Max Guard (the kernel lines of W1B-M.md read these)
// ------------------------------------------------------------------------------------------------------------------

/** Whether `slot`'s queued action is Max Guard: a Dynamaxed Pokémon (its build as entered) with a status move, not as a Z-Move. */
export function maxGuardAction(input: DoublesTurnInput, slot: DoublesSlotId): boolean {
  const entry = input.pokemon[slot];
  const moveId = entry?.action.moveId;
  if (!entry || !moveId || !isMaxActive(entry.build) || entry.contexts[moveId]?.useZ) return false;
  return input.runtime.movesById.get(moveId)?.category === "Status";
}

/**
 * The move a queued action uses (sim/battle-actions.ts runMove: a Dynamaxed Pokémon's move is its Max Move, getActiveMaxMove):
 * a status move of a Dynamaxed Pokémon is Max Guard. Not a Dancer's copy (runMove with externalMove and no maxMove) or another
 * second use (`source`). For the queue's priority (doubles-turn.ts priorityOf), BeforeMove (doubles-status.ts beforeInfo) and the
 * status move's run (doubles-turn.ts runMove); the queued action keeps its own move (Copycat's last move, the step's move id).
 */
export function usedStatus(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): ChampionsMove {
  if (move.category !== "Status" || action.external || action.source) return move;
  const mon = w.mons[action.slot];
  if (!mon || !isMaxActive(mon.build) || kernel.input.pokemon[action.slot]?.contexts[move.id]?.useZ) return move;
  return kernel.runtime.movesById.get("maxguard") ?? move;
}

/**
 * Whether a damaging move passes `target`'s Max Guard (its onTryHit, PS/data/moves.ts:11182-11198, by the move as used: a Max
 * Move's own id): Feint, G-Max One Blow, G-Max Rapid Flow (Future Sight and Doom Desire land later). Max Guard ignores the protect
 * flag and blocks Max Moves; no contact effect (doubles-turn.ts hitChecks, with protect "maxguard").
 */
export function passesMaxGuard(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId): boolean {
  const id = info.transformed ? toId(kernel.usedMove(w, action.slot, action.moveId!, target, info).name) : info.effective.id;
  return MAX_GUARD_PASS.has(id);
}

/** A status move into `slot`'s Max Guard (doubles-status.ts tryHit, priority 3 with the protecting moves): the fact, or null where it passes. */
export function maxGuardBlocks(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove): string | null {
  const kind = w.mons[slot]?.protect;
  if (kind !== "maxguard" || MAX_GUARD_PASS.has(move.id)) return null;
  return `${kernel.moveName("maxguard")} blocks ${move.name}.`;
}

// ------------------------------------------------------------------------------------------------------------------
// Pain Split into a Dynamaxed Pokémon
// ------------------------------------------------------------------------------------------------------------------

/** Pain Split with a Dynamaxed party: its arithmetic is painSplitHP's (doubles-status.ts painSplit), so nothing here. Kept as the hook its caller names. */
export function painSplitMax(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId) {
  void kernel; void w; void use; void slot;
}

/**
 * Pain Split's HP for the user (HP `a`) and its target (HP `b`) (PS/data/moves.ts:13138-13146): the target's undynamaxed HP
 * (PS/sim/pokemon.ts:748-754: ceil(hp × baseMaxhp / maxhp) while Dynamaxed), the average floor((t + a) / 2) or 1; the target's
 * sethp(hp − (t − average)) and the user's sethp(average) (PS/sim/pokemon.ts:1655-1667: truncated, at least 1, at most the
 * maximum). Without Dynamax it is floor((a + b) / 2) or 1 for both, each at most its maximum (T2-PS01: 300/470 → 275, the user 125).
 */
export function painSplitHP(kernel: TurnKernel, w: World, user: DoublesSlotId, target: DoublesSlotId, a: number, b: number): readonly [number, number] {
  const { maxHP: maxUser } = kernel.hp[user];
  const { maxHP: maxTarget, baseMaxHP } = kernel.hp[target];
  const undynamaxed = isMaxActive(w.mons[target]!.build) ? Math.ceil(b * baseMaxHP / maxTarget) : b;
  const average = Math.floor((undynamaxed + a) / 2) || 1;
  const sethp = (hp: number, max: number) => Math.min(max, Math.max(1, Math.trunc(hp)));
  return [sethp(average, maxUser), sethp(b - (undynamaxed - average), maxTarget)];
}

// ------------------------------------------------------------------------------------------------------------------
// G-Max Chi Strike's state on the card and in E2
// ------------------------------------------------------------------------------------------------------------------

/** The card's condition fact (DoublesHP.conditions; ADDENDUM2 §5.1): `G-Max Chi Strike +{n}.` while it has layers. */
export function conditions(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  void kernel;
  const mon = w.mons[slot];
  return mon && !mon.fainted && mon.vol.chiStrike ? [`G-Max Chi Strike +${mon.vol.chiStrike}.`] : [];
}

/** E2's volatile (ADDENDUM2 §3.1): "gmaxchistrike" while it has layers (DoublesOutcomeMon.chiStrike holds them). */
export function outcomeVolatiles(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  void kernel;
  const mon = w.mons[slot];
  return mon && !mon.fainted && mon.vol.chiStrike ? ["gmaxchistrike"] : [];
}
