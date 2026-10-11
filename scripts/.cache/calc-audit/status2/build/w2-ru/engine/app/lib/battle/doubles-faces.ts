import { getBerryResistType } from "@smogon/calc/dist/items";
import { calculateTurnMove, usesHelpers } from "./calculate";
import { BUSTED_FORMS, DRAG_MOVES, REASONS, SWITCH_MOVES } from "./doubles-actions";
import * as switchNs from "./doubles-switch";
import { sideCanSwitch, type DoublesSlotId } from "./doubles-types";
import { setVol, stageFact } from "./doubles-use";
import { cloneWorld, condition, mapHP, marginal, withSpecies, type PendingAction, type Stage, type World } from "./doubles-world";
import type { FaceKind, SearchEntry, StepChild, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import { neutralEffectiveness } from "./engine-corrections.cjs";
import { BERRY_STEALERS, KLUTZ_IGNORED_ITEMS, stolenEat } from "./hit-loop";
import { isMaxActive } from "./mechanics";
import { accuracyDrop, everyUseStatus, MAX_MOVE_EFFECTS, statMove } from "./stat-moves";
import { itemTakeable, type CalcTrace, type TurnCase, type TurnSide, type TurnStepOutcome } from "./uses-to-ko";
import type { BattleBuild, BattleConditions, ChampionsMove, CombatStat, MoveContext, MoveDamageResult } from "./types";

// The hook namespace is copied once into a plain object (as the other hook modules do): under tsx a namespace import's
// member is a getter over the module's own export getter. No runtime import here is in a cycle (status2-hooks.test.ts).
const switchHooks = { ...switchNs };

// Disguise and Ice Face (status2 ADDENDUM2 §2.3 #15, #48; T2M §3.13, §3.25): Track S's file (with doubles-substitute.ts).
// Step 0 moved today's code here verbatim (faceTaken, faceHit, faceProbe, neutralRow, rowReason's face branch as multiHit,
// confusionHit's guard as selfHit); Track S models what those guarded:
// - a multi-hit move or a Parental Bond move into an intact face: the first hit through the face (no damage), the busted
//   form at that hit's Update (Disguise's chip from generation 8), then the move's later hits into the busted form as a
//   continuation of the pair's step (uses-to-ko.ts TurnStepPart { caseIndex, skip: 1 }) from that Update's state;
// - the 0-damage hit's own effects: the items that answer a hit (Rocky Helmet, Air Balloon, Jaboca and Rowap Berry, Sticky
//   Barb, Cell Battery, Absorb Bulb, Luminous Moss, Snowball, Kee and Maranga Berry, Eject Button, Red Card), the moves that
//   take or use the item (Knock Off, Thief, Covet, Bug Bite, Pluck, Incinerate), Smelling Salts and Wake-Up Slap, Magician,
//   the screens a move breaks, and the kernel's afterHit for everything else a hit does;
// - a confusion self-hit into an intact Disguise (no damage, the busted form, the chip from generation 8).
// Pinned Showdown c23d2e94: data/abilities.ts disguise, iceface (onDamage 0 for a Move effect, onEffectiveness 0, onCriticalHit
// false, onUpdate the form and the 1/8 chip; data/mods/gen7/abilities.ts no chip); sim/battle-actions.ts spreadMoveHit (the
// hit's steps: onHit, Hit, the secondaries, DamagingHit and AfterHit run on a 0-damage hit; sim/battle.ts spreadDamage sets
// hurtThisTurn only for damage above 0), hitStepMoveHitLoop (the Update after each hit; the later hits stop once the target
// or the user has fainted), afterMoveSecondaryEvent. Probes: status2/design/tier2-moves-probes-3.out T2-FA01-FA13.

const FACE_REASONS: Record<string, FaceKind> = { "Intact Disguise takes the first hit.": "disguise", "Intact Ice Face takes the first physical hit.": "iceface" };
/** The items a hit uses up by its type in DamagingHit, and their stages (data/items.ts cellbattery, absorbbulb, luminousmoss, snowball: useItem). */
const TYPE_ITEMS: Readonly<Record<string, { type: string; boosts: Partial<Record<CombatStat, number>> }>> = {
  cellbattery: { type: "Electric", boosts: { atk: 1 } }, absorbbulb: { type: "Water", boosts: { spa: 1 } },
  luminousmoss: { type: "Water", boosts: { spd: 1 } }, snowball: { type: "Ice", boosts: { atk: 1 } },
};
/** Jaboca and Rowap Berry (data/items.ts onDamagingHit): eaten by a hit of their category; the attacker loses 1/8 of its base maximum HP. */
const RETALIATION_BERRIES: Readonly<Record<string, "Physical" | "Special">> = { jabocaberry: "Physical", rowapberry: "Special" };
/** Kee and Maranga Berry (data/items.ts onAfterMoveSecondary): eaten after a move of their category; +1 Defense / Sp. Def. */
const AFTER_MOVE_BERRIES: Readonly<Record<string, { category: "Physical" | "Special"; stat: CombatStat }>> = {
  keeberry: { category: "Physical", stat: "def" }, marangaberry: { category: "Special", stat: "spd" },
};
/**
 * Every catalog item with a handler a hit runs (pinned dex: onDamagingHit, onAfterMoveSecondary, onHit, onTryHit, the
 * resist Berries' onSourceModifyDamage, onDamage; the attacker's onAfterMoveSecondarySelf and onSourceTryPrimaryHit), as a
 * face's 0-damage hit meets it (tests/source/doubles-substitute-census.test.ts): `modelled` here (zeroHit, afterMoveItems,
 * faceRetaliation, neutralRow's Chilan Berry); `super-effective` (typeMod > 0, which the face's neutral hit never has:
 * Weakness Policy, Enigma Berry, the other resist Berries); `no damage` (Focus Band, Focus Sash: a hit that knocks out);
 * `attacker` (the user's own, the probe's or the continuation's: Life Orb, Shell Bell, Throat Spray, a Gem); `before` (Safety
 * Goggles: a powder move that does not connect never meets the face).
 */
export const FACE_HIT_ITEMS: Readonly<Record<string, "modelled" | "super-effective" | "no damage" | "attacker" | "before">> = {
  absorbbulb: "modelled", airballoon: "modelled", cellbattery: "modelled", jabocaberry: "modelled", luminousmoss: "modelled", rockyhelmet: "modelled",
  rowapberry: "modelled", snowball: "modelled", ejectbutton: "modelled", keeberry: "modelled", marangaberry: "modelled", redcard: "modelled",
  stickybarb: "modelled", chilanberry: "modelled", weaknesspolicy: "super-effective", enigmaberry: "super-effective", focusband: "no damage",
  focussash: "no damage", lifeorb: "attacker", shellbell: "attacker", throatspray: "attacker", normalgem: "attacker", safetygoggles: "before",
};
/** The multi-hit moves whose hits differ in power (data/moves.ts triplekick, tripleaxel basePowerCallback): a fresh continuation is not theirs. */
const VARYING_POWER_HITS: ReadonlySet<string> = new Set(["triplekick", "tripleaxel"]);


/** The intact Disguise or Ice Face a hit meets (calculateMove's reason: a move that connects with a face it does not break), or null. */
export function faceTaken(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, row: MoveDamageResult, move: ChampionsMove): FaceKind | null {
  void kernel; void w; void attacker; void target; void move;
  return FACE_REASONS[row.reason ?? ""] ?? null;
}

/** rowReason's face branch: none (a face against a multi-hit move is modelled, faceHit). */
export function multiHit(kernel: TurnKernel, w: World, target: DoublesSlotId, row: MoveDamageResult, move: ChampionsMove): string | null {
  void kernel; void w; void target; void row; void move;
  return null;
}

/**
 * A confusion self-hit into an intact Disguise (T2M §3.25; PS/data/conditions.ts:193-194: the self-hit's effect is of type
 * Move, so Disguise's onDamage gives 0): no damage, the busted form at the Update, and from generation 8 the 1/8 chip (its
 * Berry at that Update; hurtThisTurn from the chip only). No Berserk lock (no damage of type Move landed). Ice Face takes only
 * physical moves' hits, which the self-hit is not: null. `at`: the action (doubles-status.ts confusionHit uses the worlds).
 */
export function selfHit(kernel: TurnKernel, w: World, at: PendingAction): World[] | null {
  const slot = at.slot;
  const build = w.mons[slot]!.build;
  if (build.abilityId !== "disguise" || !BUSTED_FORMS[build.speciesId] || build.speciesId === "eiscue" || build.transformedFrom) return null;
  const name = kernel.names[slot];
  const world = cloneWorld(w);
  const mon = world.mons[slot]!;
  mon.build = withSpecies(mon.build, BUSTED_FORMS[mon.build.speciesId]);
  if (at.moveId === null) kernel.lossFact(slot, `${name} hurts itself in confusion; ${kernel.abilityName("disguise")} takes the hit.`, w.mass);
  else kernel.skipFact(at, `Hurts itself in confusion; ${kernel.abilityName("disguise")} takes the hit.`, w.mass);
  if (kernel.gen7) return [world];
  const chip = Math.max(1, Math.floor(kernel.hp[slot].baseMaxHP / 8));
  kernel.lossFact(slot, `${name} loses ${chip} HP (${kernel.abilityName("disguise")}).`, w.mass);
  const before = kernel.snapshot(world);
  return kernel.afterLoss(world, slot, chip).map((next) => { kernel.eventGuards(before, next, false); return next; });
}

/** faceHit's options: `retaliation` "caller" (a spread step that adds faceRetaliation to its own sum): the attacker's loss is not applied here. */
export type FaceHitOptions = { retaliation?: "caller" };

/**
 * A hit an intact Disguise or Ice Face takes (data/abilities.ts disguise, iceface): no damage (onDamage gives 0 and
 * onEffectiveness a neutral typeMod, so no Weakness Policy, Enigma Berry or resist Berry acts but a Chilan Berry, which
 * any Normal hit's getDamage eats), the busted form at the Update, and from generation 8 Disguise's 1/8 of the base
 * maximum HP then (not in generation 7, data/mods/gen7/abilities.ts). The hit still lands: the move's 100% stages and
 * statuses on the target (stat-moves.ts), the items that answer a hit and the moves that take an item (zeroHit), and the
 * kernel's afterHit. A multi-hit move or a Parental Bond move goes on into the busted form (faceContinue). `inSpread`: a
 * spread move's target (one hit each): the attacker's state goes to spreadStep's check, and its HP is spreadStep's.
 */
export function faceHit(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, face: FaceKind, multiple: boolean, inSpread = false,
  opts: FaceHitOptions = {}): World[] {
  const attacker = action.slot;
  const move = kernel.runtime.movesById.get(action.moveId!)!;
  const holder = w.mons[target]!;
  const faceName = kernel.abilityName(holder.build.abilityId);
  // A Chilan Berry the hit eats (neutralRow), where the calculation reads Unnerve as the turn does (the other resist Berries
  // need a super-effective hit, which the face's never is).
  if (holder.build.itemId === "chilanberry") kernel.unnerveGuard(w, attacker, target);
  // A move that can hit more than once (its hit count, Parental Bond, Dragon Darts at one target): the face takes the first.
  const several = !inSpread && (move.multihit !== null || w.mons[attacker]!.build.abilityId === "parentalbond");
  if (several) {
    const neutral = neutralRow(kernel, w, attacker, target, move, kernel.conditionsFor(w, attacker, target, multiple, move.id), kernel.contextFor(w, action, target, info), faceName);
    if ((neutral.row.hits ?? 1) > 1) return faceSeveral(kernel, w, action, info, target, face, multiple, neutral, faceName);
    return faceOnce(kernel, w, action, info, target, face, multiple, inSpread, opts, faceName, neutral);
  }
  return faceOnce(kernel, w, action, info, target, face, multiple, inSpread, opts, faceName);
}

/**
 * The HP the attacker loses to the face's 0-damage hit in DamagingHit (data/items.ts rockyhelmet on contact: 1/6 of its
 * base maximum HP; jabocaberry, rowapberry by the move's category: 1/8, eaten, Unnerve stopping it), Magic Guard none. A
 * spread step adds it to its targets' retaliation (one Update after the hit: faceHit's `retaliation: "caller"`).
 */
export function faceRetaliation(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, category: string = info.effective.category): number {
  const attacker = action.slot;
  const user = w.mons[attacker]!.build, holder = w.mons[target]!.build;
  if (user.abilityId === "magicguard" || !kernel.itemWorks(w, holder) || attacker === target) return 0;
  const base = kernel.hp[attacker].baseMaxHP;
  if (holder.itemId === "rockyhelmet" && info.contact) return Math.max(1, Math.floor(base / 6));
  if (RETALIATION_BERRIES[holder.itemId] === category && !kernel.berryStopped(w, target)) return Math.max(1, Math.floor(base / 8));
  return 0;
}

/** The engine row's used category and type (Shell Side Arm, Photon Geyser, the -ate abilities), else the move's. */
const usedCategory = (row: MoveDamageResult | undefined, info: TurnMoveInfo) => (row?.effectiveCategory ?? info.effective.category) as string;
const usedTypeOf = (row: MoveDamageResult | undefined, info: TurnMoveInfo) => row?.effectiveType ?? info.effective.type;

/** What zeroHit did to the attacker: its HP lost in DamagingHit (applied by the caller at the hit's Update) and healed by a Berry it ate (Bug Bite, Pluck). */
type ZeroHit = { retaliation: number; heal: { amount: number; source: string } | null };

/**
 * The 0-damage hit's own effects in `w` (in place), in pinned Showdown's order (sim/battle-actions.ts spreadMoveHit): the
 * Chilan Berry its damage ate (getDamage); the move's onHit: Bug Bite and Pluck (the user eats a Berry: hit-loop.ts
 * stolenEat; its stages and cure are the attacker side's, the heal is returned), Incinerate (a Berry or a Gem burned up),
 * Smelling Salts and Wake-Up Slap (their status cured); the Hit event: Sticky Barb moving to an item-less user on contact; the
 * 100% stages and statuses on the target; DamagingHit: Air Balloon popping, Jaboca and Rowap (faceRetaliation's loss), Rocky
 * Helmet, Cell Battery, Absorb Bulb, Luminous Moss and Snowball used (their stage through boost()); AfterHit: Knock Off and
 * Thief or Covet (an item-less user that spent no Gem). The holder's ability is its face, so no ability of its own answers.
 * `itemNow`: the user's item as the hit lands (a Gem it spent: ""). `secondaries`: the move's own effects (not a Z-Move's or
 * Max Move's). Item history: a taken item in World.itemsTaken, a used one through noteItemUse (only while the turn keeps it).
 */
function zeroHit(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, neutral: { row: MoveDamageResult; berry: string } | null,
  itemNow: string, opts: { gemSpent: boolean; spread: boolean }): ZeroHit {
  const attacker = action.slot;
  const user = w.mons[attacker]!, receiver = w.mons[target]!;
  const userName = kernel.names[attacker], name = kernel.names[target];
  const moveName = kernel.moveName(action.moveId!);
  const own = info.transformed ? "" : action.moveId!;
  const category = usedCategory(neutral?.row, info), type = usedTypeOf(neutral?.row, info);
  const takenItem = (slot: DoublesSlotId) => { if (kernel.tracksItems) w.itemsTaken = [...(w.itemsTaken ?? []), slot]; };
  const lose = (slot: DoublesSlotId, used: boolean) => {
    const mon = w.mons[slot]!, item = mon.build.itemId;
    mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
    if (used) kernel.noteItemUse(w, slot, item); else takenItem(slot);
  };
  const species = (build: BattleBuild) => build.transformedFrom?.speciesId ?? build.speciesId;
  const takeable = (item: string, holder: BattleBuild, taker: BattleBuild, thief: boolean) =>
    itemTakeable(kernel.runtime, usesHelpers(kernel.runtime).paradox, item, species(holder), species(taker), thief);
  const out: ZeroHit = { retaliation: 0, heal: null };
  // getDamage: the Chilan Berry (neutralRow's `berry`).
  if (neutral?.berry && receiver.build.itemId === neutral.berry) lose(target, true);
  // The move's onHit (data/moves.ts bugbite, pluck, incinerate, smellingsalts, wakeupslap).
  const held = receiver.build.itemId;
  if (BERRY_STEALERS.has(own) && held.endsWith("berry") && (own === "incinerate" || kernel.alive(w, attacker))) {
    if (own !== "incinerate") {
      const ignoresItem = w.field.magicRoom || (user.build.abilityId === "klutz" && !KLUTZ_IGNORED_ITEMS.has(user.build.itemId));
      const eat = stolenEat(held, { baseMaxHP: kernel.hp[attacker].baseMaxHP, ability: user.build.abilityId, ignoresItem }, kernel.runtime.profile.generation);
      const amount = eat.heal + eat.pouch;
      if (amount > 0) out.heal = { amount, source: `${userName} eats ${name}'s ${kernel.itemName(held)}` };
      kernel.hitFact(action, target, `${moveName}: ${userName} eats ${name}'s ${kernel.itemName(held)}.`, w.mass);
    } else kernel.hitFact(action, target, `${moveName}: ${name}'s ${kernel.itemName(held)} is burned up.`, w.mass);
    lose(target, false);
  } else if (own === "incinerate" && held.endsWith("gem")) {
    kernel.hitFact(action, target, `${moveName}: ${name}'s ${kernel.itemName(held)} is burned up.`, w.mass);
    lose(target, false);
  }
  if ((own === "smellingsalts" && receiver.build.status === "par") || (own === "wakeupslap" && receiver.build.status === "slp")) {
    kernel.hitFact(action, target, `${moveName}: ${name}'s ${receiver.build.status === "par" ? "paralysis" : "sleep"} is cured.`, w.mass);
    if (receiver.build.status === "slp") setVol(w, target, { sleep: undefined });
    receiver.build = { ...receiver.build, status: "" };
  }
  // The Hit event: Sticky Barb (data/items.ts stickybarb onHit; no item handler of an ignored item runs).
  if (receiver.build.itemId === "stickybarb" && kernel.itemWorks(w, receiver.build) && info.contact && !itemNow && kernel.alive(w, attacker)) {
    // A spread step writes its user once, from every target's step (spreadStep): an item it gets from one is not followed.
    if (opts.spread) kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName(receiver.build.abilityId)));
    receiver.build = { ...receiver.build, itemId: "" };
    user.build = { ...user.build, itemId: "stickybarb" };
    takenItem(target);
    kernel.hitFact(action, target, `${kernel.itemName("stickybarb")} moves to ${userName}.`, w.mass);
    itemNow = "stickybarb";
  }
  // A Max Move's drop on every foe, the face holder's included (data/moves.ts max* self.onHit, in selfDrops; the kernel's
  // maxEffects gives the other foe's and the user's partner's, the attacker side its own).
  if (info.isMax && kernel.alive(w, target)) {
    const effect = MAX_MOVE_EFFECTS[kernel.usedMove(w, attacker, action.moveId!, target, info).name];
    if (effect?.foe) kernel.foeDrop(w, target, effect.foe, attacker, kernel.breaks(w, attacker, target, info));
  }
  // The move's 100% stages and statuses on the target (stat-moves.ts; Sheer Force removes them, Covert Cloak stops the secondaries).
  const sheerForce = user.build.abilityId === "sheerforce";
  const sereneGrace = user.build.abilityId === "serenegrace";
  const cloak = receiver.build.itemId === "covertcloak" && kernel.itemWorks(w, receiver.build);
  const stages = info.transformed ? undefined : statMove(move(kernel, action).id, kernel.runtime.profile.id, sereneGrace)?.target;
  if (stages && !sheerForce && !cloak) kernel.foeDrop(w, target, stages, attacker, kernel.breaks(w, attacker, target, info));
  const status = info.transformed ? undefined : everyUseStatus(move(kernel, action).id, sereneGrace);
  if (status && (status.status === "psn" || status.status === "tox" || status.status === "brn" || status.status === "par") && !(status.secondary && (sheerForce || cloak))) {
    kernel.giveStatus(w, target, status.status, attacker);
  }
  // DamagingHit (a 0 damage is a number: sim/battle-actions.ts spreadMoveHit's damagedTargets).
  const item = receiver.build.itemId;
  const works = kernel.itemWorks(w, receiver.build);
  if (works && item === "airballoon") {
    lose(target, false);
    kernel.hitFact(action, target, `${name}'s ${kernel.itemName("airballoon")} pops.`, w.mass);
  } else if (works && RETALIATION_BERRIES[item] === category && user.build.abilityId !== "magicguard" && kernel.alive(w, attacker) && !kernel.berryStopped(w, target)) {
    out.retaliation += faceRetaliation(kernel, w, action, info, target, category);
    lose(target, true);
    kernel.hitFact(action, target, `${name} eats its ${kernel.itemName(item)}.`, w.mass);
    if (!opts.spread) kernel.lossFact(attacker, `${kernel.itemName(item)}: ${userName} loses ${out.retaliation} HP.`, w.mass);
  } else if (works && item === "rockyhelmet") {
    const loss = faceRetaliation(kernel, w, action, info, target, category);
    out.retaliation += loss;
    if (loss && !opts.spread) kernel.lossFact(attacker, `${kernel.itemName("rockyhelmet")}: ${userName} loses ${loss} HP.`, w.mass);
  } else if (works && TYPE_ITEMS[item]?.type === type) {
    lose(target, true);
    const changed = kernel.applyBoosts(w, target, TYPE_ITEMS[item].boosts, target, { effect: "item" });
    const text = Object.entries(changed).filter(([, amount]) => amount).map(([stat, amount]) => stageFact(stat as Stage, amount!)).join(" ");
    kernel.hitFact(action, target, `${name} uses its ${kernel.itemName(item)}${text ? `: ${text}` : "."}`, w.mass);
  }
  // AfterHit (data/moves.ts knockoff, thief, covet onAfterHit; Sticky Hold is not a face holder's).
  const now = receiver.build.itemId;
  if (own === "knockoff" && now && takeable(now, receiver.build, user.build, false)) {
    kernel.hitFact(action, target, `${moveName}: ${name}'s ${kernel.itemName(now)} is knocked off.`, w.mass);
    lose(target, false);
  } else if ((own === "thief" || own === "covet") && now && !itemNow && !opts.gemSpent && kernel.alive(w, attacker) && takeable(now, receiver.build, user.build, true)) {
    receiver.build = { ...receiver.build, itemId: "" };
    user.build = { ...user.build, itemId: now };
    takenItem(target);
    kernel.hitFact(action, target, `${moveName}: ${userName} takes ${name}'s ${kernel.itemName(now)}.`, w.mass);
  }
  return out;
}
const move = (kernel: TurnKernel, action: PendingAction) => kernel.runtime.movesById.get(action.moveId!)!;

/**
 * After the move (sim/battle-actions.ts afterMoveSecondaryEvent; none after a Sheer Force move with secondaries): the holder's
 * Kee or Maranga Berry for the move's category (eaten: +1 Defense / Sp. Def through boost(); Unnerve stops it), then its Eject
 * Button (it switches out) or Red Card (the attacker does: R's doubles-switch.ts switchOut, as hitReactions has them). A
 * fainted holder's handlers do not run.
 */
function afterMoveItems(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, category: string) {
  const attacker = action.slot;
  const receiver = w.mons[target]!;
  if (!kernel.alive(w, target) || (w.mons[attacker]!.build.abilityId === "sheerforce" && info.secondaries)) return;
  const item = receiver.build.itemId;
  if (!kernel.itemWorks(w, receiver.build)) return;
  const berry = AFTER_MOVE_BERRIES[item];
  if (berry && berry.category === category && !kernel.berryStopped(w, target)) {
    receiver.build = { ...receiver.build, itemId: "" };
    kernel.noteItemUse(w, target, item);
    const changed = kernel.applyBoosts(w, target, { [berry.stat]: 1 }, target, { effect: "item" });
    const amount = changed[berry.stat] ?? 0;
    kernel.hitFact(action, target, `${kernel.names[target]} eats its ${kernel.itemName(item)}${amount ? `: ${stageFact(berry.stat, amount)}` : "."}`, w.mass);
    return;
  }
  // Eject Button and Red Card need a Pokémon to come in (canSwitch); Eject Button waits for none already switching (a
  // U-turn's user: its selfSwitch is set in the hit); each is used up as it acts.
  const canSwitch = (slot: DoublesSlotId) => sideCanSwitch(kernel.input, sideOfSlot(slot)) !== false;
  const selfSwitch = !info.transformed && SWITCH_MOVES.has(action.moveId!) && kernel.alive(w, attacker);
  // Dragon Tail and Circle Throw set the holder's forceSwitchFlag in the hit (sim/battle-actions.ts forceSwitch), before these.
  const dragged = !info.transformed && DRAG_MOVES.has(action.moveId!) && !isMaxActive(receiver.build);
  if (dragged) return;
  if (item === "ejectbutton" && canSwitch(target) && !selfSwitch) {
    receiver.build = { ...receiver.build, itemId: "" };
    kernel.noteItemUse(w, target, item);
    kernel.gasEnds(w, target);
    switchHooks.switchOut(kernel, w, target, "ejectbutton", null);
  } else if (item === "redcard" && kernel.alive(w, attacker) && attacker !== target && canSwitch(attacker)) {
    receiver.build = { ...receiver.build, itemId: "" };
    kernel.noteItemUse(w, target, item);
    kernel.gasEnds(w, attacker);
    switchHooks.switchOut(kernel, w, attacker, "redcard", null);
  }
}

/**
 * Magician after the move (data/abilities.ts magician onAfterMoveSecondarySelf; none after Sheer Force with secondaries): an
 * item-less user that spent no Gem takes the face holder's item (itemTakeable), unless the holder has fainted.
 */
function magician(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, gemSpent: boolean): boolean {
  const attacker = action.slot;
  const user = w.mons[attacker]!, receiver = w.mons[target]!;
  if (user.build.abilityId !== "magician" || user.build.itemId || gemSpent || !kernel.alive(w, attacker) || !kernel.alive(w, target) || action.moveId === "fling") return false;
  const item = receiver.build.itemId;
  const species = (build: BattleBuild) => build.transformedFrom?.speciesId ?? build.speciesId;
  if (!item || !itemTakeable(kernel.runtime, usesHelpers(kernel.runtime).paradox, item, species(receiver.build), species(user.build), false)) return false;
  receiver.build = { ...receiver.build, itemId: "" };
  user.build = { ...user.build, itemId: item };
  if (kernel.tracksItems) w.itemsTaken = [...(w.itemsTaken ?? []), target];
  kernel.hitFact(action, target, `${kernel.abilityName("magician")}: ${kernel.names[attacker]} takes ${kernel.names[target]}'s ${kernel.itemName(item)}.`, w.mass);
  void info;
  return true;
}

/** The step side of a build at an HP (for an afterHit outcome with no pair's step: zero damage). */
function sideOf(kernel: TurnKernel, w: World, slot: DoublesSlotId): TurnSide {
  const build = w.mons[slot]!.build;
  const hp = kernel.hp[slot];
  return {
    hp: 0, maxHP: hp.maxHP, baseMaxHP: hp.baseMaxHP, itemId: build.itemId, boosts: { ...build.boosts },
    abilityId: build.abilityId, speciesId: build.speciesId, status: build.status, mechanic: build.mechanic, dynamaxTurns: null, toxic: 0, slowStart: null,
    saltCure: false, smackedDown: false, unburden: false, focusEnergy: false,
  } as TurnSide;
}

/**
 * The face's hit when the move ends with it (one hit; a spread move's target, `inSpread`): the attacker after the same hit
 * into the busted form (faceProbe: its Gem, Throat Spray, Charge, Stellar and the move's own stages), its item as zeroHit and
 * Magician leave it; the hit's statistics (the damage Showdown calculates before the face takes it: neutralRow); zeroHit;
 * the busted form and the chip at the hit's Update, the attacker's DamagingHit loss there (a Bug Bite heal before it); the
 * after-move items; Life Orb (its onAfterMoveSecondarySelf needs no damage) at the action's Update; the screens the move broke;
 * a Max Move's effects; then the kernel's afterHit on an outcome of one hit that reached the Pokémon.
 */
function faceOnce(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, face: FaceKind, multiple: boolean, inSpread: boolean,
  opts: FaceHitOptions, faceName: string, given?: { row: MoveDamageResult; berry: string; gem: boolean }): World[] {
  const attacker = action.slot;
  const mv = move(kernel, action);
  // A spread move's Magician takes from the fastest target it hit (speedSort): spreadStep's order is not that.
  if (inSpread && w.mons[attacker]!.build.abilityId === "magician" && !w.mons[attacker]!.build.itemId) kernel.notEstimated(REASONS.notIn2v2(faceName));
  const found = faceProbe(kernel, w, action, info, target, multiple, faceName, given);
  const probe = found?.outcome ?? null;
  const world = cloneWorld(w);
  const user = world.mons[attacker]!, receiver = world.mons[target]!;
  const raisedBefore = w.mons[target]!.statsRaised;
  const startItem = w.mons[attacker]!.build.itemId;
  const gemSpent = !!found?.gem && startItem.endsWith("gem");
  if (probe) {
    if (inSpread) world.spread = [...(world.spread ?? []), kernel.sideKey(probe.attacker)];
    else {
      user.build = kernel.unfollowed(user.build, kernel.fromSide(user.build, probe.attacker), kernel.healStandIn(w, attacker, true));
      // The attacker's item as the face's hit leaves it: one it held, as the probe used it (a Gem, Throat Spray); an item the
      // probe's hit gave an item-less user (Thief, Covet, Magician, Sticky Barb from the busted form) is zeroHit's and Magician's.
      if (!startItem && user.build.itemId) user.build = { ...user.build, itemId: "" };
    }
    if (!probe.conditions.attackerSide.charge) user.charged = false;
    world.field = { ...world.field, weather: probe.conditions.weather, terrain: probe.conditions.terrain };
    // Screens the move broke on the target's side (Brick Break, Psychic Fangs, Raging Bull: onTryHit, before the hit).
    if (kernel.isFoe(attacker, target)) {
      const side = world.sides[sideOfSlot(target)], left = probe.conditions.defenderSide;
      if ((side.reflect && !left.reflect) || (side.lightScreen && !left.lightScreen) || (side.auroraVeil && !left.auroraVeil)) {
        world.sides[sideOfSlot(target)] = { ...side, reflect: side.reflect && left.reflect, lightScreen: side.lightScreen && left.lightScreen, auroraVeil: side.auroraVeil && left.auroraVeil };
      }
    }
  }
  const stats = kernel.hitStats(action, target);
  if (stats) {
    kernel.hitFact(action, target, `${faceName}: ${kernel.names[target]} takes no damage.`, world.mass);
    // The damage Showdown calculates for the hit before the face takes it (getDamage at a neutral typeMod): the hit's row.
    if (found) { stats.calculated += world.mass; kernel.noteMet(action, target, found.row, world.mass); kernel.noteFirst(action, target, found.row, world.mass); }
    else stats.noDamage += world.mass;
  }
  // The hit's effects on the target (zeroHit); the busted form is a form change (withSpecies: no world types, stored stats or weight).
  const zero = zeroHit(kernel, world, action, info, target, found ? { row: found.row, berry: found.berry } : null, gemSpent ? "" : startItem, { gemSpent, spread: inSpread });
  if (inSpread && zero.retaliation && opts.retaliation !== "caller") kernel.notEstimated(REASONS.notIn2v2(faceName));
  receiver.build = withSpecies(receiver.build, BUSTED_FORMS[receiver.build.speciesId] ?? receiver.build.speciesId);
  receiver.timesAttacked += 1;
  receiver.focusLost = true;
  if (!world.hitTargets?.includes(target)) world.hitTargets = [...(world.hitTargets ?? []), target];
  // The hit's Update: the busted form's chip (its Berry there); the attacker's DamagingHit loss (a Bug Bite heal before it).
  const chip = face === "disguise" && !kernel.gen7 ? Math.max(1, Math.floor(kernel.hp[target].baseMaxHP / 8)) : 0;
  let worlds = chip ? kernel.afterLoss(world, target, chip) : [world];
  // The chip knocking the holder out in the action counts as the hit's knockout (the Pokémon it reached went to 0 HP in it).
  if (stats) for (const next of worlds) if (!kernel.alive(next, target)) stats.ko += next.mass;
  const category = usedCategory(found?.row, info);
  const sheerForce = user.build.abilityId === "sheerforce" && info.secondaries;
  if (!inSpread) {
    worlds = worlds.flatMap((next) => {
      let out = [next];
      if (zero.heal) out = out.flatMap((each) => heal(kernel, each, attacker, zero.heal!));
      if (zero.retaliation) out = out.flatMap((each) => kernel.afterLoss(each, attacker, zero.retaliation));
      else if (user.build.itemId && !startItem) out = out.flatMap((each) => kernel.berryDue(each, attacker));
      return out;
    });
  }
  worlds = worlds.flatMap((next) => {
    afterMoveItems(kernel, next, action, info, target, category);
    if (inSpread) return [next];
    const took = !sheerForce && magician(kernel, next, action, info, target, gemSpent);
    // Life Orb after a hit that landed (its onAfterMoveSecondarySelf needs no damage), at the action's Update; none for a flung
    // Life Orb (the `fling` volatile took it at the hit's Update: status2 integration 1b, D's ask 2).
    const build = next.mons[attacker]!.build;
    const flung = mv.id === "fling" && !info.transformed;
    const lifeOrb = build.itemId === "lifeorb" && !flung && kernel.itemWorks(next, build) && build.abilityId !== "magicguard" && !sheerForce && kernel.alive(next, attacker);
    if (lifeOrb) return kernel.afterLoss(next, attacker, Math.max(1, Math.floor(kernel.hp[attacker].baseMaxHP / 10)));
    return took ? kernel.berryDue(next, attacker) : [next];
  });
  if (!inSpread && info.isMax) worlds = worlds.flatMap((next) => kernel.maxEffects(next, action, info, target));
  // The kernel's afterHit (doubles-turn.ts: the turn's reactions to one hit, the accuracy drop and flinch included) on an
  // outcome of one hit that reached the Pokémon.
  const outcome: TurnStepOutcome = probe
    ? { ...probe, landed: 1, subHits: 0, knocked: false, attackerFainted: false }
    : { attacker: sideOf(kernel, w, attacker), attackerFainted: false, target: sideOf(kernel, world, target), knocked: false, conditions: kernel.conditionsFor(w, attacker, target, multiple, mv.id),
      landed: 1, subHits: 0, dist: new Map() };
  for (const next of worlds) kernel.afterHit(next, action, target, outcome, info, raisedBefore);
  return worlds;
}
const sideOfSlot = (slot: DoublesSlotId) => (slot.startsWith("own") ? "own" : "opponent") as "own" | "opponent";

/** `slot` heals `amount` HP (a stolen Berry's, Bug Bite and Pluck: data/moves.ts bugbite onHit's Eat) up to its maximum, noted as a heal. */
function heal(kernel: TurnKernel, w: World, slot: DoublesSlotId, given: { amount: number; source: string }): World[] {
  const max = kernel.hp[slot].maxHP;
  return mapHP(w, slot, (hp) => {
    if (hp <= 0) return { hp, tag: "" };
    const next = Math.min(max, hp + given.amount);
    kernel.noteHeal(slot, given.source, next - hp);
    return { hp: next, tag: "" };
  }).map(({ world }) => world);
}

/**
 * The face takes one hit of several (T2M §3.13 model 1): a multi-hit move's, Parental Bond's strike or Dragon Darts' dart
 * at one target; hit `at` (0-based: the move's first, or the first after a Substitute broke: faceAfterSub). zeroHit for that
 * hit (its own 100% stages, statuses and item reactions; the attacker's own effects are the move's, applied once by the
 * continuation), the busted form and the chip at its Update (the attacker's DamagingHit loss there), then faceContinue. The
 * hit's calculation (DoublesHit.cases, min and max: getDamage before the face takes it, as the oracle sums every hit's
 * getDamage) joins each continuation's: neutralRow's hit `at` plus the later hits. A move the user or the face holder no
 * longer goes on with (the user fainted to the hit's Rocky Helmet or Jaboca Berry, the holder to its chip) ends there
 * (faceEnds). `fixed`: one case of the run, its mass already the world's (after a Substitute's prefix), else every case.
 */
function faceSeveral(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, face: FaceKind, multiple: boolean,
  neutral: { row: MoveDamageResult; berry: string; gem: boolean }, faceName: string, at = 0, fixed?: Fixed): World[] {
  const attacker = action.slot;
  const world = cloneWorld(w);
  const receiver = world.mons[target]!;
  const startItem = world.mons[attacker]!.build.itemId;
  const gemSpent = neutral.gem && startItem.endsWith("gem");
  kernel.hitFact(action, target, `${faceName}: ${kernel.names[target]} takes no damage.`, world.mass);
  const zero = zeroHit(kernel, world, action, info, target, neutral, gemSpent ? "" : startItem, { gemSpent, spread: false });
  receiver.build = withSpecies(receiver.build, BUSTED_FORMS[receiver.build.speciesId] ?? receiver.build.speciesId);
  receiver.focusLost = true;
  if (!world.hitTargets?.includes(target)) world.hitTargets = [...(world.hitTargets ?? []), target];
  const user = world.mons[attacker]!;
  const accuracy = info.transformed ? 0 : accuracyDrop(move(kernel, action).id, user.build.abilityId === "serenegrace");
  const cloak = receiver.build.itemId === "covertcloak" && kernel.itemWorks(world, receiver.build);
  if (accuracy && user.build.abilityId !== "sheerforce" && !cloak) kernel.foeDrop(world, target, { accuracy }, attacker, kernel.breaks(world, attacker, target, info));
  kernel.flinchCheck(world, action, target, info);
  // The hit's Update: the attacker's loss (a Bug Bite heal before it), and a stolen Berry it is due to eat.
  let worlds = [world];
  if (zero.heal) worlds = worlds.flatMap((each) => heal(kernel, each, attacker, zero.heal!));
  if (zero.retaliation) worlds = worlds.flatMap((each) => kernel.afterLoss(each, attacker, zero.retaliation));
  else if (user.build.itemId && !startItem) worlds = worlds.flatMap((each) => kernel.berryDue(each, attacker));
  const first = hitRange(neutral.row, at);
  const category = usedCategory(neutral.row, info);
  const chip = face === "disguise" && !kernel.gen7 ? Math.max(1, Math.floor(kernel.hp[target].baseMaxHP / 8)) : 0;
  return worlds.flatMap((next) => {
    // The user fainted in the hit: no later hit (sim/battle-actions.ts hitStepMoveHitLoop), the after-move items still act.
    if (!kernel.alive(next, attacker)) {
      next.mons[target]!.timesAttacked += at + 1;
      const after = chip ? kernel.afterLoss(next, target, chip) : [next];
      for (const each of after) { endedStats(kernel, each, action, target, neutral.row, first, at); afterMoveItems(kernel, each, action, info, target, category); }
      return after;
    }
    if (!chip) return faceContinue(kernel, next, action, info, target, multiple, first, faceName, at + 1, fixed);
    return condition(next, target, (hp) => hp > chip).flatMap(({ world: part, meets: lives }) => lives
      ? kernel.afterLoss(part, target, chip).flatMap((each) => faceContinue(kernel, each, action, info, target, multiple, first, faceName, at + 1, fixed))
      : faceEnds(kernel, part, action, info, target, multiple, chip, faceName, at, fixed).map((each) => { endedStats(kernel, each, action, target, neutral.row, first, at); return each; }));
  });
}

/**
 * The statistics of a move that ended with the face's hit (its user or the holder fainted at that hit's Update): the hit
 * reached the Pokémon, calculated (the damage before the face took it: getDamage's, which the oracle sums over the hits
 * dealt), and the holder's faint there is the hit's knockout.
 */
function endedStats(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, row: MoveDamageResult, first: { min: number; max: number }, at: number) {
  const stats = kernel.hitStats(action, target);
  if (!stats) return;
  stats.calculated += w.mass;
  kernel.noteMet(action, target, { ...row, min: first.min, max: first.max, rolls: null, hits: at + 1 }, w.mass);
  if (!kernel.alive(w, target)) stats.ko += w.mass;
}

/** One case of the run a continuation keeps to (after a Substitute's prefix: the class's case), its mass already the world's. */
type Fixed = { caseIndex: number; useCase: TurnCase };

/** The least and the most damage of a calculation's hit `at` (its per-hit rolls), else of the whole row. */
function hitRange(row: MoveDamageResult, at = 0): { min: number; max: number } {
  const rolls = row.rolls;
  if (Array.isArray(rolls) && Array.isArray(rolls[0])) {
    const hit = (rolls as number[][])[Math.min(at, rolls.length - 1)];
    return { min: Math.min(...hit), max: Math.max(...hit) };
  }
  return { min: row.min ?? 0, max: row.max ?? 0 };
}

/**
 * The face holder's chip knocks it out at the face's hit's Update (generation 8+ Disguise, at most 1/8 of its HP left): the
 * move ends with that hit (hit `at`). The user's own effects as one use with no later hit on the Pokémon (the pair's step
 * with every hit skipped: uses-to-ko.ts TurnStepPart, its Gem, Life Orb, Throat Spray), from the world before the chip; then
 * the chip. A move whose hits each give its user a stage (Parental Bond Power-Up Punch: stat-moves.ts userSecondary) would
 * count every hit: not followed (the face's reason). The hit count takes the hits dealt (`at` + 1).
 */
function faceEnds(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, multiple: boolean, chip: number, faceName: string, at: number, fixed?: Fixed): World[] {
  const attacker = action.slot;
  const mv = move(kernel, action);
  if (!info.transformed && statMove(mv.id, kernel.runtime.profile.id, w.mons[attacker]!.build.abilityId === "serenegrace")?.userSecondary) kernel.notEstimated(REASONS.notIn2v2(faceName));
  const entry = continuationEntry(kernel, w, action, info, target, multiple, faceName);
  w.mons[target]!.timesAttacked += at + 1;
  const out: World[] = [];
  for (const part of hpParts(kernel, w, action, entry, target)) {
    const cases = entry.search!.turnCases(part.x, part.t, kernel.mode);
    if ("failed" in cases) kernel.notEstimated(cases.failed);
    const caseIndex = fixed?.caseIndex ?? 0;
    for (const child of kernel.applyStep(part.world, action, target, entry, info, false, { caseIndex, skip: cases[caseIndex].hits.length })) {
      out.push(...kernel.afterLoss(child.world, target, chip));
    }
  }
  return out;
}

/** The pair's search for the hits after the face's (the busted form as the world after the face's hit's Update leaves it; not a spread search). */
function continuationEntry(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, multiple: boolean, faceName: string): SearchEntry {
  const attacker = action.slot;
  const mv = move(kernel, action);
  const entry = kernel.searchFor(w, attacker, target, mv.id, kernel.conditionsFor(w, attacker, target, multiple, mv.id), kernel.contextFor(w, action, target, info), false);
  if (entry.row.kind !== "calculated") kernel.notEstimated(kernel.rowReason(w, target, entry.row, mv));
  // The busted form keeps the types the face's hit connected with: a later hit that deals nothing is not this model's.
  if (!entry.search) kernel.notEstimated(REASONS.notIn2v2(faceName));
  return entry;
}

/** The world taken apart by the parts of the target's HP the damage reads (and of the attacker's, where it reads that): one world per part (doubles-substitute.ts's walk). */
export function hpParts(kernel: TurnKernel, w: World, action: PendingAction, entry: SearchEntry, slot: DoublesSlotId, attackerHP?: number): { world: World; x: number; t: number }[] {
  const attacker = action.slot;
  const search = entry.search!;
  void kernel;
  const reads = search.readsAttackerHP() && attackerHP === undefined && entry.follow;
  return byClass(w, slot, (hp) => search.targetHPClass(hp)).flatMap(({ world, hp: t }) => reads
    ? byClass(world, attacker, (hp) => search.attackerHPClass(hp)).map(({ world: each, hp: x }) => ({ world: each, x, t }))
    : [{ world, x: search.initial.att.hp, t }]);
}

/** The world split by a key of `slot`'s HP: one world per key with an HP of it (the first met), or `w` itself for one key. */
export function byClass(w: World, slot: DoublesSlotId, key: (hp: number) => string): { world: World; hp: number }[] {
  const firsts = new Map<string, number>();
  for (const hp of marginal(w, slot).keys()) { const at = key(hp); if (!firsts.has(at)) firsts.set(at, hp); }
  if (firsts.size === 1) return [{ world: w, hp: firsts.values().next().value! }];
  return [...firsts].flatMap(([at, hp]) => condition(w, slot, (value) => key(value) === at).filter(({ meets: inside }) => inside).map(({ world }) => ({ world, hp })));
}

/**
 * The move's hits after the face's into the busted form (T2M §2.5's continuation): per part of the HP the damage reads and
 * per case of the run (each count of a random hit count with its chance; `fixed`: the one case after a Substitute's
 * prefix), the pair's step with TurnStepPart { caseIndex, skip }: the case's hits from `skip` on dealt to the busted form,
 * each at its own index (Parental Bond's ×0.25 strike, Triple Axel's power, the first hit's Gem), from the state the face's
 * hit's Update left; the user's own effects once there (every hit's, the face's and a Substitute's included: Life Orb, a
 * Gem, Throat Spray, Power-Up Punch's stage per strike); the hit count takes every hit of the move (kernel applyStep:
 * timesAttacked + landed + subHits; the face's hit reached the Pokémon, so with no hit after it the count is ours). The
 * knocker-out's rise after the hits. The calculations met become the move's: the face's hit plus the later ones.
 */
function faceContinue(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, multiple: boolean, first: { min: number; max: number }, faceName: string,
  skip: number, fixed?: Fixed): World[] {
  const attacker = action.slot;
  const entry = continuationEntry(kernel, w, action, info, target, multiple, faceName);
  // Focus Band on a later hit and the busted form's resist Berry under Unnerve, as singleStep reads them (W's and K's hooks).
  kernel.focusBandGuard(w, target, entry.row);
  kernel.unnerveGuard(w, attacker, target);
  const fresh = resistFirst(kernel, w, action, info, target, entry, faceName);
  const out: World[] = [];
  for (const part of hpParts(kernel, w, action, entry, target)) {
    const cases = entry.search!.turnCases(part.x, part.t, kernel.mode);
    if ("failed" in cases) kernel.notEstimated(cases.failed);
    const each = (world: World, caseIndex: number) => {
      const useCase = cases[caseIndex];
      const from = Math.min(skip, useCase.hits.length);
      // A fresh continuation's hits are the case's first ones (TurnStepPart.fresh), as its statistics read them.
      const read = fresh ? { chance: useCase.chance, hits: useCase.hits.slice(0, useCase.hits.length - from) } : useCase;
      const worlds = stepContinued(kernel, world, action, info, target, entry, { caseIndex, skip: from, ...(fresh ? { fresh: true as const } : {}) }, read, first, fresh ? 0 : from);
      if (from >= useCase.hits.length) for (const next of worlds) next.mons[target]!.timesAttacked += from;
      out.push(...worlds);
    };
    if (fixed) { each(part.world, fixed.caseIndex); continue; }
    cases.forEach((useCase, caseIndex) => { if (useCase.chance > 0) each(cloneWorld(part.world, part.world.mass * useCase.chance), caseIndex); });
  }
  return out;
}

/**
 * The face's hit after a Substitute broke (doubles-substitute.ts; T2M §3.13 model 1: "into a Substitute first"): the move's
 * case `caseIndex` had `at` hits into the Substitute, hit `at` meets the intact face, the rest go into the busted form.
 */
export function faceAfterSub(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, face: FaceKind, caseIndex: number, useCase: TurnCase, at: number): World[] {
  const attacker = action.slot;
  const mv = move(kernel, action);
  const holder = w.mons[target]!;
  const faceName = kernel.abilityName(holder.build.abilityId);
  if (holder.build.itemId === "chilanberry") kernel.unnerveGuard(w, attacker, target);
  const neutral = neutralRow(kernel, w, attacker, target, mv, kernel.conditionsFor(w, attacker, target, false, mv.id), kernel.contextFor(w, action, target, info), faceName);
  return faceSeveral(kernel, w, action, info, target, face, false, neutral, faceName, at, { caseIndex, useCase });
}

/**
 * The busted form's resist Berry for the move's type (T2M §3.13): the face's hit, at a neutral typeMod, does not eat it, so
 * the first hit into the busted form does (a super-effective one: data/items.ts the resist Berries' onSourceModifyDamage),
 * while the engine reads a multi-hit move's later hits as after a first that ate it. Then the continuation is fresh
 * (TurnStepPart.fresh: its first hit reads the busted form as a first hit), which is exact for a constant-power move whose
 * hits do not differ by their index otherwise: not for Triple Axel or Triple Kick, Parental Bond's ×0.25 strike, or a Gem
 * the face's hit spent (the face's reason). Whether the continuation is fresh.
 */
function resistFirst(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, entry: SearchEntry, faceName: string): boolean {
  const holder = w.mons[target]!.build;
  const item = kernel.itemWorks(w, holder) ? holder.itemId : "";
  if (!item.endsWith("berry") || item === "chilanberry" || !getBerryResistType(kernel.itemName(item) as never)) return false;
  if (getBerryResistType(kernel.itemName(item) as never) !== (entry.row.effectiveType ?? info.effective.type)) return false;
  const user = w.mons[action.slot]!.build;
  const doubled = user.abilityId === "parentalbond" && move(kernel, action).multihit === null;
  const gem = !!entry.trace?.result?.rawDesc.attackerItem?.endsWith(" Gem") || (user.itemId.endsWith("gem") && kernel.itemWorks(w, user));
  if (doubled || gem || (!info.transformed && VARYING_POWER_HITS.has(action.moveId!))) kernel.notEstimated(REASONS.notIn2v2(faceName));
  return true;
}

/**
 * One continuation step (kernel.applyStep with the part) and its statistics: the knocker-out's rise after the hits, and the
 * calculations met as the whole move's (`first`, the face's hit, plus the case's hits from the part's skip on).
 */
export function stepContinued(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, entry: SearchEntry,
  part: { caseIndex: number; skip: number; fresh?: true }, useCase: TurnCase, first: { min: number; max: number } | null, rowsFrom = part.skip): World[] {
  const attacker = action.slot;
  const stats = kernel.hitStats(action, target);
  const before = stats ? new Map([...stats.met].map(([key, met]) => [key, met.mass])) : null;
  const children: StepChild[] = kernel.applyStep(w, action, target, entry, info, false, part);
  if (stats && before) continuedRows(stats.met, before, useCase, rowsFrom, first);
  const out: World[] = [];
  for (const { world, knocked } of children) {
    // The faint batch after the hits: the knocker-out's rise (doubles-turn.ts singleStep).
    if (knocked) kernel.koBoost(world, attacker, 1);
    out.push(world);
  }
  return out;
}

/**
 * The calculations a continuation met (HitStats.met; DoublesHit.min and max): the step lists the run's row, the whole move's
 * damage, for an outcome in which a hit reached the target; its share goes to the continuation's own damage instead, the
 * case's hits from `skip` on (their least and most rolls summed), plus `first` (a face's hit before them), keyed apart.
 */
export function continuedRows(met: Map<string, { row: MoveDamageResult; mass: number }>, before: Map<string, number>, useCase: TurnCase, skip: number,
  first: { min: number; max: number } | null) {
  const hits = useCase.hits.slice(skip);
  const min = hits.reduce((sum, hit) => sum + Math.min(...hit.values), first?.min ?? 0), max = hits.reduce((sum, hit) => sum + Math.max(...hit.values), first?.max ?? 0);
  const count = hits.length + (first ? 1 : 0);
  for (const [key, entry] of [...met]) {
    if (key.startsWith("substitute:")) continue;
    const added = entry.mass - (before.get(key) ?? 0);
    if (added <= 0) continue;
    if (before.has(key)) entry.mass -= added; else met.delete(key);
    const row: MoveDamageResult = { ...entry.row, min, max, rolls: null, hits: count };
    const own = `substitute:${JSON.stringify([min, max, count, entry.row.effectiveName, entry.row.effectivePower])}`;
    const known = met.get(own);
    if (known) known.mass += added; else met.set(own, { row, mass: added });
  }
}

/**
 * The attacker's state after a hit an intact face takes: the same hit into the busted form from the world before it,
 * not following the attacker's HP (the Gem, Throat Spray, Charge, Stellar and the move's own stages it uses); every
 * outcome must leave the attacker one state. Null when that hit deals no damage either. `given`: the neutral row faceHit
 * already made.
 */
export function faceProbe(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, multiple: boolean, faceName: string,
  given?: { row: MoveDamageResult; berry: string; gem: boolean }): { outcome: TurnStepOutcome; row: MoveDamageResult; berry: string; gem: boolean } | null {
  const attacker = action.slot;
  const mv = move(kernel, action);
  const probe = cloneWorld(w);
  const holder = probe.mons[target]!;
  probe.mons[target] = { ...holder, build: withSpecies(holder.build, BUSTED_FORMS[holder.build.speciesId] ?? holder.build.speciesId) };
  const conditions = kernel.conditionsFor(probe, attacker, target, multiple, mv.id);
  const context = kernel.contextFor(probe, action, target, info);
  const entry = kernel.searchFor(probe, attacker, target, mv.id, conditions, context, true);
  if (entry.row.kind !== "calculated") kernel.notEstimated(kernel.rowReason(probe, target, entry.row, mv));
  if (!entry.search) return null;
  const result = entry.search.turnStep([{ attackerHP: 0, target: marginal(probe, target) }], kernel.mode, false);
  if ("failed" in result) kernel.notEstimated(result.failed);
  if (new Set(result.outcomes.map((outcome) => kernel.sideKey(outcome.attacker))).size > 1) kernel.notEstimated(REASONS.notIn2v2(faceName));
  if (!result.outcomes[0]) return null;
  return { outcome: result.outcomes[0], ...(given ?? neutralRow(kernel, w, attacker, target, mv, kernel.conditionsFor(w, attacker, target, multiple, mv.id), context, faceName)) };
}

/**
 * The damage a hit into an intact face is calculated with (Showdown's getDamage before onDamage gives 0): the intact
 * form's stats and every type of the holder neutral but an immunity (data/abilities.ts iceface and disguise
 * onEffectiveness give 0 for each of its types, sim/pokemon.ts runEffectiveness), so no super-effective or resisted
 * damage and nothing that reads it (Expert Belt, Filter, Tinted Lens), in every generation; a Snow holder that is Ice
 * type keeps its Defense. Never a critical hit (iceface and disguise onCriticalHit give false, so getDamage's
 * CriticalHit event stops the field's Critical hit, an always-critical move, a certain ratio and Merciless): calculated
 * with the intact form holding Battle Armor in place of the face, which in the engine does that alone, under
 * engine-corrections.cjs neutralEffectiveness. (Strong Winds, whose halving the engine applies apart, is only in Ultra
 * Sun / Ultra Moon, where neither Mimikyu nor Eiscue is Flying type.) `berry`: the holder's resist Berry the hit eats
 * (a Chilan Berry's onSourceModifyDamage runs inside getDamage for any Normal hit; the others need a super-effective
 * typeMod, which the face's hit never has), or "". `gem`: the attacker's Gem the hit spends (its onSourceTryPrimaryHit).
 */
export function neutralRow(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, move: ChampionsMove, conditions: BattleConditions, context: MoveContext | undefined,
  faceName: string): { row: MoveDamageResult; berry: string; gem: boolean } {
  if (!kernel.runtime.abilitiesById.has("battlearmor")) kernel.notEstimated(REASONS.notIn2v2(faceName));
  const plain: BattleBuild = { ...kernel.calcBuild(w, target), abilityId: "battlearmor", abilityActive: false };
  kernel.countCalculation();
  const trace: CalcTrace = {};
  const row = neutralEffectiveness(() => calculateTurnMove(move, kernel.calcBuild(w, attacker), plain, { ...conditions, critical: false }, context, kernel.runtime, trace));
  if (row.kind !== "calculated") kernel.notEstimated(kernel.rowReason(w, target, row, move));
  // The attacker's Neutralizing Gas would leave Battle Armor out of the engine's calculation, where the face still acts.
  if (trace.result?.rawDesc.isCritical) kernel.notEstimated(REASONS.notIn2v2(faceName));
  const used = trace.result?.rawDesc.defenderItem;
  return { row, berry: used && getBerryResistType(used) ? plain.itemId : "", gem: !!trace.result?.rawDesc.attackerItem?.endsWith(" Gem") };
}
