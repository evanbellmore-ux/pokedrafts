import { BUSTED_FORMS, IGNORE_ABILITY_MOVES, KO_BOOSTS, MOLD_BREAKERS, REASONS, RESIST_BERRIES, VOLATILE_SECONDARY_MOVES } from "./doubles-actions";
import { allyOf, DOUBLES_SLOTS, SHOWDOWN_POSITION, slotSide, type DoublesSlotId } from "./doubles-types";
import { cloneWorld, marginal, withSpecies, type MoveVolatiles, type PendingAction, type World } from "./doubles-world";
import type { HitCheck, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import { moveConfusion, statusLands } from "./doubles-status";
import { foesLeft, whiteHerbAfterMove, writeStages } from "./doubles-stages";
import { berryUnnerved, gulpingTarget, HEALING_BERRIES, ownMoveId, PINCH_STAT_BERRIES, UNNERVES } from "./hit-loop";
import { statMove } from "./stat-moves";
import type { BattleBuild, BattleGame, CombatStat } from "./types";
import * as abilityNs from "./doubles-abilities";
import { abilityFlag } from "./ability-table";
import { GAS_STAND_IN } from "./calculate";
import { setVol, tableEntry, type Use } from "./doubles-use";
import type { TurnSide, TurnStepOutcome } from "./uses-to-ko";

// The hook namespaces are copied once into plain objects (as doubles-turn.ts does): no runtime import of these modules is in a cycle.
const abilityHandlers = { ...abilityNs.HANDLERS };
const realAbility = abilityNs.realAbility;
const setAbility = abilityNs.setAbility;

// The reactions to a hit (status2 ADDENDUM2 §3.5, §4.3 K; T2M §3.2-§3.12): Track K's file (Step 1 #12, #13; wave 1b).
// Burning Jealousy, Alluring Voice, Spectral Thief, Core Enforcer; a spread move's reactions on its user, replayed in target
// order; a spread user its protecting target's contact effect knocks out; Unnerve's resist Berry (stand-ins for the
// calculation) and its end on a knockout (the hit's Update); Cotton Down; Flower Veil and Pastel Veil (the step's veil);
// Battle Bond; Aftermath and Innards Out (the step's koRetaliation); Receiver and Power of Alchemy. Every number follows
// pinned Showdown c23d2e94 in Scarlet/Violet, Champions, Sword/Shield and Ultra Sun/Ultra Moon; what the turn does not
// follow is not estimated with a fact.

// ------------------------------------------------------------------------------------------------------------------
// One walk's notes on the pairs its searches set up (searchFor: stepEnv and calcStandIns run before every search, memoised
// or not), read by the hooks that run on the step's children: which stand-in the calculation read, and whether the step
// followed the target's Aftermath or Innards Out.
// ------------------------------------------------------------------------------------------------------------------

type PairNote = {
  /** calcStandIns: "target" (its resist Berry read as Leftovers), "attacker" (its Unnerve or As One read as no ability), "guard" (a move that takes the Berry); absent: none. */
  standIn?: "target" | "attacker" | "guard";
  /** calcStandIns' "guard": the move that takes the Berry (its reason names it). */
  taker?: string;
  /** stepEnv: the step took the target's Aftermath or Innards Out on its knocking hit ("followed"), or did not ("unfollowed"). */
  ko?: "followed" | "unfollowed";
  /** stepEnv, a spread step into an Innards Out holder: the HP it has as the move starts (Dynamax undone), or null where it differs between entries. */
  spreadIO?: number | null;
};
const NOTES = new WeakMap<TurnKernel, Map<DoublesSlotId, Map<DoublesSlotId, PairNote>>>();
function noteOf(kernel: TurnKernel, attacker: DoublesSlotId, target: DoublesSlotId): PairNote {
  let notes = NOTES.get(kernel);
  if (!notes) NOTES.set(kernel, notes = new Map());
  let byTarget = notes.get(attacker);
  if (!byTarget) notes.set(attacker, byTarget = new Map());
  let note = byTarget.get(target);
  if (!note) byTarget.set(target, note = {});
  return note;
}
/** The walks whose searches run calcStandIns (the integrator's searchFor line): unnerveStand reads its notes only there. */
const STAND_INS = new WeakSet<TurnKernel>();
/**
 * K's volatile beyond doubles-world.ts MoveVolatiles (read and written only here, as A1's A1Vol): `receive`, the ability a
 * Receiver or Power of Alchemy holder takes in a spread move's faint batch (allyFaint stashes it during the hits, spreadUser
 * applies it after them and clears it, so no world leaves the move with it).
 */
type KVol = MoveVolatiles & { receive?: string };
const peekNote = (kernel: TurnKernel, attacker: DoublesSlotId, target: DoublesSlotId) => NOTES.get(kernel)?.get(attacker)?.get(target);

const gameOf = (kernel: TurnKernel) => kernel.runtime.profile.id as BattleGame;
/** The move `attacker` uses as `moveId` in this world (Z-Move and Max Move conversion), or null. */
function infoOf(kernel: TurnKernel, w: World, attacker: DoublesSlotId, moveId: string): TurnMoveInfo | null {
  if (!kernel.runtime.movesById.has(moveId)) return null;
  const info = kernel.moveInfo(w, attacker, moveId, kernel.input.pokemon[attacker]?.contexts[moveId]);
  return info.kind === "move" ? info : null;
}
/** The living Pokémon of the field in pinned getAllActive order (side 1, then side 2; each by its Showdown position now). */
function allActive(kernel: TurnKernel, w: World): DoublesSlotId[] {
  const order = (slot: DoublesSlotId) => {
    const at = SHOWDOWN_POSITION[kernel.positionOf(w, slot)];
    return at.side * 2 + at.position;
  };
  return DOUBLES_SLOTS.filter((slot) => kernel.alive(w, slot) && slot !== w.ghost).sort((a, b) => order(a) - order(b));
}
const STAT_LABEL: Record<CombatStat, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };
const listText = (parts: string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

// ------------------------------------------------------------------------------------------------------------------
// The pair's environment (doubles-turn.ts searchFor; uses-to-ko.ts UsesEnv) and the calculation's stand-ins
// ------------------------------------------------------------------------------------------------------------------

/**
 * A damp holder in effect (PS/data/abilities.ts damp onAnyDamage: Aftermath's damage fails; breakable, so the attacker's
 * Mold Breaker or an ignoreAbility move passes it unless an Ability Shield keeps it: kernel.breaks).
 */
function dampOn(kernel: TurnKernel, w: World, attacker: DoublesSlotId, info: () => TurnMoveInfo | null): boolean {
  return DOUBLES_SLOTS.some((slot) => kernel.alive(w, slot) && slot !== w.ghost && w.mons[slot]!.build.abilityId === "damp" && !brokenBy(kernel, w, attacker, slot, info));
}
/** `holder`'s breakable ability is passed by `attacker`'s move (kernel.breaks; its own never), the move read only when asked. */
function brokenBy(kernel: TurnKernel, w: World, attacker: DoublesSlotId, holder: DoublesSlotId, info: () => TurnMoveInfo | null): boolean {
  if (holder === attacker) return false;
  const move = info();
  return !!move && kernel.breaks(w, attacker, holder, move);
}

/**
 * The target's side's veil for the pair's step (T2M §3.9; PS/data/abilities.ts flowerveil onAllyTryBoost and onAllySetStatus:
 * a Grass-type Pokémon of its side, itself included, against any other source; pastelveil onAllySetStatus and onSetStatus: its
 * side's poison): a living holder whose breakable ability the attacker's move does not pass (kernel.breaks: Mold Breaker, an
 * ignoreAbility move; an Ability Shield keeps it). The target's types are its types in this world (Tera, Roost, an added type).
 */
function veilFor(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: () => TurnMoveInfo | null): "flowerveil" | "pastelveil" | null {
  const holders = (ability: string) => DOUBLES_SLOTS.some((slot) => slotSide(slot) === slotSide(target) && kernel.alive(w, slot) && slot !== w.ghost
    && w.mons[slot]!.build.abilityId === ability && !brokenBy(kernel, w, attacker, slot, info));
  if (holders("flowerveil") && kernel.typesIn(w, target).includes("Grass")) return "flowerveil";
  return holders("pastelveil") ? "pastelveil" : null;
}

/**
 * The HP an Innards Out holder has as the move starts, as its damage reads it (PS/data/abilities.ts innardsout: damage +
 * move.totalDamage, getUndynamaxedHP), where every entry of the world gives it one value; else null.
 */
/**
 * Whether a single-target hit into `target` is stepped once per HP the target has (doubles-turn.ts singleStep, status2 integration
 * 1b): an Innards Out holder whose HP differs between entries (PS/data/abilities.ts innardsout onDamagingHit: the HP it had before
 * the hit, target.getUndynamaxedHP(damage), one value per step: stepEnv's koRetaliation), with a living user. Any damaging move,
 * a Z-Move or Max Move included; not at the end of turn (a residual hit is not followed).
 */
export function innardsOutSplit(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId): boolean {
  const mon = w.mons[target];
  if (kernel.inEndOfTurn || action.slot === target || !mon || mon.fainted || mon.build.abilityId !== "innardsout" || !kernel.alive(w, action.slot)) return false;
  return [...marginal(w, target).keys()].filter((hp) => hp > 0).length > 1;
}

function startHP(kernel: TurnKernel, w: World, target: DoublesSlotId): number | null {
  const hps = [...marginal(w, target).keys()].filter((hp) => hp > 0);
  if (hps.length !== 1) return null;
  const { maxHP, baseMaxHP } = kernel.hp[target];
  return maxHP !== baseMaxHP ? Math.ceil(hps[0] * baseMaxHP / maxHP) : hps[0];
}

/**
 * Every catalog ability and item whose own reaction to a damaging hit acts on the move's user (PS/data/abilities.ts, items.ts
 * onDamagingHit, onAfterMoveSecondary, onHit; tests/source/doubles-spread-reactions.test.ts checks the list against the pinned
 * dex), by how a spread move's user reads it (T2M §3.3): "listed", a stage reaction the step lists and spreadUser replays
 * (uses-to-ko.ts HIT_ABILITIES with `attacker`); "state", one the step applies to the user's state, tagged by veil and composed
 * by spreadUser; "loss", HP the user loses in the hit (doubles-spread.ts's summed retaliation; Aftermath and Innards Out:
 * spreadRetaliation); "chance", an effect below 100% (the turn's rule: it does not happen); "switch", a forced switch
 * (doubles-turn.ts hitReactions); "field", a side or field effect (the step's); "later", a state only a later turn reads.
 */
export const USER_REACTIONS: Readonly<Record<string, "listed" | "state" | "loss" | "chance" | "switch" | "field" | "later">> = {
  gooey: "listed", tanglinghair: "listed", cottondown: "listed",
  spicyspray: "state", mummy: "state", lingeringaroma: "state", wanderingspirit: "state", pickpocket: "state", gulpmissile: "state", stickybarb: "state",
  roughskin: "loss", ironbarbs: "loss", rockyhelmet: "loss", jabocaberry: "loss", rowapberry: "loss", aftermath: "loss", innardsout: "loss",
  cutecharm: "chance", effectspore: "chance", flamebody: "chance", poisonpoint: "chance", static: "chance", cursedbody: "chance",
  redcard: "switch", ejectbutton: "switch", toxicdebris: "field", perishbody: "later",
};
/** The target abilities whose reaction on a spread move's user the step lists (uses-to-ko.ts HIT_ABILITIES with `attacker`: UsesEnv.spreadUser). */
export const LISTED_REACTIONS: ReadonlySet<string> = new Set(Object.keys(USER_REACTIONS).filter((id) => USER_REACTIONS[id] === "listed"));
/** The attacker's own Berries the hit loop eats at a hit's Update (hit-loop.ts hitStep's Update; Lansat and Starf are the caller's). */
const updateBerry = (item: string) => (HEALING_BERRIES.has(item) || !!PINCH_STAT_BERRIES[item]) && item !== "enigmaberry";

/**
 * K's part of the pair's environment (doubles-turn.ts searchFor; uses-to-ko.ts UsesEnv), in the memo key; each part set only
 * when its holder is in (SPEC2 §4.9's readers rule), none at the end of turn (a residual hit is not followed):
 * - `veil` (T2M §3.9): the target's side's Flower Veil on a Grass target or Pastel Veil (veilFor).
 * - `koRetaliation` (T2M §3.11), a single-target step: the target's Aftermath with no Damp in effect (the hit loop checks
 *   contact), or its Innards Out with the HP it has as the move starts (one value: the HP every entry of the step starts
 *   from; Dynamax undone, getUndynamaxedHP). The step then follows the attacker (needsAttackerHP) and the hit loop takes the
 *   loss on the knocking hit before its Update. A target whose HP differs between entries is noted "unfollowed"
 *   (koRetaliationAfter: not estimated where it is knocked out).
 * - `unnerve.endsOnKO` (T2M §3.7), a single-target step: the target is a foe Unnerve or As One holder and no third
 *   Pokémon's stops the attacker's working HP or pinch Berry: the knocking hit's Update reads it gone (before recoil, Life
 *   Orb and Steel Beam's cost).
 * - `spreadUser` (T2M §3.3), a spread step into a Gooey, Tangling Hair or Cotton Down holder: the reaction on the user is
 *   listed, not applied (spreadUser replays it in target order).
 */
export function stepEnv(kernel: TurnKernel, w: World, attacker: DoublesSlotId | null, target: DoublesSlotId, moveId: string, spread: boolean): Record<string, unknown> {
  if (!attacker || attacker === target || kernel.inEndOfTurn || !w.mons[attacker] || !w.mons[target]) return {};
  const env: Record<string, unknown> = {};
  const user = w.mons[attacker]!.build, receiver = w.mons[target]!.build;
  let move: TurnMoveInfo | null | undefined;
  const info = () => (move === undefined ? (move = infoOf(kernel, w, attacker, moveId)) : move);
  const veil = veilFor(kernel, w, attacker, target, info);
  if (veil) env.veil = veil;
  if (spread) {
    if (LISTED_REACTIONS.has(receiver.abilityId)) env.spreadUser = true;
    if (receiver.abilityId === "innardsout") noteOf(kernel, attacker, target).spreadIO = startHP(kernel, w, target);
    return env;
  }
  const kept = peekNote(kernel, attacker, target);
  if (kept) delete kept.ko;
  if (receiver.abilityId === "aftermath") {
    noteOf(kernel, attacker, target).ko = "followed";
    if (!dampOn(kernel, w, attacker, info)) env.koRetaliation = { aftermath: true, innardsOut: 0 };
  } else if (receiver.abilityId === "innardsout") {
    const hp = startHP(kernel, w, target);
    if (hp !== null) env.koRetaliation = { aftermath: false, innardsOut: hp };
    noteOf(kernel, attacker, target).ko = hp !== null ? "followed" : "unfollowed";
  }
  if (kernel.isFoe(attacker, target) && UNNERVES.has(receiver.abilityId) && updateBerry(user.itemId) && kernel.itemWorks(w, user)) {
    const unnerve = kernel.turnUnnerve(w, attacker, target) ?? { foes: true, target: false, attacker: false };
    if (unnerve.foes && !unnerve.attacker) env.unnerve = { ...unnerve, endsOnKO: true };
  }
  return env;
}

/** Moves that take or burn the target's Berry (a stand-in Leftovers would be taken instead: PS/data/moves.ts bugbite, pluck, thief, covet, incinerate). */
const BERRY_TAKERS: ReadonlySet<string> = new Set(["bugbite", "pluck", "thief", "covet", "incinerate"]);

/**
 * The calculation's stand-ins for a resist Berry under Unnerve (T2M §3.6; the integrator's searchFor line, before the memo
 * key): a resist Berry (PS/data/items.ts occaberry and its kin onSourceModifyDamage: eatItem, which Unnerve and As One
 * stop) is read by the engine's calculation, which stops it for the attacker's own Unnerve or As One alone (gen789
 * calculateFinalModsSMSSSV), where the turn reads Unnerve from every Pokémon in (turnUnnerve; PS/data/abilities.ts unnerve
 * onFoeTryEatItem: a foe of the holder that is in). Where they differ:
 * - a third Pokémon's Unnerve stops the target's Berry: the target's item reads Leftovers (no damage change; Knock Off and
 *   Poltergeist still see an item), put back on each child (unnerveRecoil);
 * - the attacker's own Unnerve does not stop its ally's Berry: the attacker's ability reads the stand-in (Unnerve and As One
 *   change no damage), put back on each child (unnerveRecoil) or in the spread move's replay (spreadUser).
 * A move that takes or burns the Berry, or a Magician user, keeps the calculation as it is and unnerveStand's reason.
 */
export function calcStandIns(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, moveId: string, xb: BattleBuild, tb: BattleBuild): [BattleBuild, BattleBuild] {
  STAND_INS.add(kernel);
  // A pair's note is kept only for a target that holds a resist Berry (the readers rule); any other pair has nothing to put back.
  const kept = peekNote(kernel, attacker, target);
  if (kept) delete kept.standIn;
  const build = w.mons[target]?.build;
  if (!build || attacker === target || !w.mons[attacker] || !RESIST_BERRIES.has(build.itemId) || !kernel.itemWorks(w, build)) return [xb, tb];
  const own = w.mons[attacker]!.build.abilityId;
  const stopped = berryUnnerved(kernel.turnUnnerve(w, attacker, target), "target", own);
  if (stopped === UNNERVES.has(own)) return [xb, tb];
  const note = noteOf(kernel, attacker, target);
  if (BERRY_TAKERS.has(moveId) || own === "magician") { note.standIn = "guard"; note.taker = own === "magician" ? kernel.abilityName(own) : kernel.moveName(moveId); return [xb, tb]; }
  if (stopped) { note.standIn = "target"; return [xb, { ...tb, itemId: "leftovers" }]; }
  note.standIn = "attacker";
  return [{ ...xb, abilityId: GAS_STAND_IN }, tb];
}

/** A face holder or its busted form: S's face paths read the target's resist Berry their own way (doubles-faces.ts). */
const faced = (speciesId: string) => !!BUSTED_FORMS[speciesId] || Object.values(BUSTED_FORMS).includes(speciesId);

/**
 * The resist Berry's Unnerve where the calculation read it otherwise than the turn (doubles-turn.ts singleStep, spreadStep's
 * plans, S's faces and Substitute continuation; the kernel's unnerveGuard): where the walk's searches run calcStandIns the
 * calculation read the turn's Unnerve and nothing is left to guard; without them (no stand-in line in searchFor), for a move
 * that takes the Berry (the "guard" note) and on a face's path, today's reason (resistUnnerve).
 */
export function unnerveStand(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId) {
  const note = peekNote(kernel, attacker, target);
  const face = faced(w.mons[target]!.build.speciesId);
  if (STAND_INS.has(kernel) && note?.standIn !== "guard" && !face) return;
  const reason = resistUnnerve(kernel, w, attacker, target);
  if (!reason) return;
  if (!STAND_INS.has(kernel)) kernel.notEstimated(reason);
  // The narrow reasons: the move (or Magician) that takes the Berry, or the face, with the Unnerve that stops it.
  const unnerve = reason.slice(0, reason.indexOf(" is not modelled"));
  const what = note?.standIn === "guard" && note.taker ? note.taker : kernel.abilityName(w.mons[target]!.build.abilityId);
  kernel.notEstimated(REASONS.combo(what, unnerve));
}

/** unnerveStand's reason for this pair, or null when the calculation reads the target's resist Berry as the turn does (doubles-turn.ts resistUnnerve, moved verbatim; the start rows read it too). */
export function resistUnnerve(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId): string | null {
  const build = w.mons[target]!.build;
  if (attacker === target || !RESIST_BERRIES.has(build.itemId) || !kernel.itemWorks(w, build)) return null;
  const own = w.mons[attacker]!.build.abilityId;
  if (berryUnnerved(kernel.turnUnnerve(w, attacker, target), "target", own) === UNNERVES.has(own)) return null;
  const holder = DOUBLES_SLOTS.find((slot) => slot !== attacker && kernel.alive(w, slot) && slot !== w.ghost && kernel.isFoe(slot, target) && UNNERVES.has(w.mons[slot]!.build.abilityId));
  return REASONS.notIn2v2(kernel.abilityName(holder ? w.mons[holder]!.build.abilityId : own));
}

// ------------------------------------------------------------------------------------------------------------------
// One child of a pair's step (doubles-turn.ts applyStep: unnerveRecoil, veil, hitReactions, afterHit)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Each child of a pair's step, after its faints (doubles-turn.ts applyStep): the calculation's stand-ins put back
 * (calcStandIns): the target's resist Berry where its item reads Leftovers after the step, the attacker's own Unnerve or As
 * One where its ability reads the stand-in (a spread step does not write the attacker: spreadUser). A knocked-out target's
 * Unnerve or As One ending before the attacker's recoil is the step's (stepEnv's `unnerve.endsOnKO`: the knocking hit's
 * Update eats the attacker's Berry, sim/battle-actions.ts:967, before applyRecoilDamage), so nothing is left to follow here.
 */
export function unnerveRecoil(kernel: TurnKernel, next: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo,
  before: { user: BattleBuild; receiver: BattleBuild }, follow: boolean) {
  void outcome; void info; void follow;
  const attacker = action.slot;
  const standIn = peekNote(kernel, attacker, target)?.standIn;
  if (standIn === "target") {
    const receiver = next.mons[target]!;
    if (receiver.build.itemId === "leftovers" && RESIST_BERRIES.has(before.receiver.itemId)) receiver.build = { ...receiver.build, itemId: before.receiver.itemId };
  } else if (standIn === "attacker" && !next.spread) {
    const user = next.mons[attacker];
    if (user && user.build.abilityId === GAS_STAND_IN && UNNERVES.has(before.user.abilityId)) user.build = { ...user.build, abilityId: before.user.abilityId };
  }
}

/** Target reactions whose effect on a spread move's user the step applies to its own state (not listed): T2M §3.3's status, ability and item reactions. */
export const STATE_REACTIONS: ReadonlySet<string> = new Set(Object.keys(USER_REACTIONS).filter((id) => USER_REACTIONS[id] === "state"));
/** World.spread's per-target tags (veil): the target slot and the reaction it holds, in the side text's JSON (doubles-spread.ts parses and dedupes it). */
const TAG_TARGET = "kTarget", TAG_REACTION = "kReaction";

/**
 * Flower Veil and Pastel Veil are the step's (stepEnv's `veil`: the drops before boost(), the statuses fail; the kernel's own
 * drops and statuses already pass applyBoosts and canStatus). In a spread move's hits (World.spread), each child's entry of a
 * target whose reaction on the user the step applies to its own state (STATE_REACTIONS: an ability, or a Sticky Barb) is tagged with the
 * target and the reaction, so spreadUser can tell each target's state from the others' (T2M §3.3).
 */
export function veil(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, was: BattleBuild) {
  void kernel;
  if (!w.spread?.length || attacker === target) return;
  // status2 integration 1b: Mirror Armor's reflected drop (an onTryBoost, not a DamagingHit: no USER_REACTIONS row) is tagged too;
  // Gulp Missile only where it hits back (a Gulping or Gorging Cramorant: hit-loop.ts gulpingTarget).
  const gulpless = was.abilityId === "gulpmissile" && !gulpingTarget({ speciesId: was.speciesId, abilityId: was.abilityId, transformed: !!was.transformedFrom });
  const reaction = (STATE_REACTIONS.has(was.abilityId) && !gulpless) || was.abilityId === "mirrorarmor" ? was.abilityId : STATE_REACTIONS.has(was.itemId) ? was.itemId : null;
  if (!reaction) return;
  const last = w.spread.length - 1;
  const text = w.spread[last];
  if (!text.startsWith("{")) return;
  const side = JSON.parse(text) as Record<string, unknown>;
  side[TAG_TARGET] = target;
  side[TAG_REACTION] = reaction;
  w.spread = [...w.spread.slice(0, last), JSON.stringify(side)];
}

/** Cotton Down is koRetaliationAfter's (a single-target hit) and spreadUser's (a spread move's): it needs the hits that landed. */
export function cottonDown(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId) {
  void kernel; void w; void attacker; void target;
}

/**
 * Cotton Down (SwSh; T2M §3.8; PS/data/abilities.ts cottondown onDamagingHit): for each of `landed` hits on its holder, every
 * other active Pokémon in getAllActive order, fainted ones aside, takes Spe −1 from the holder (boost(…, pokemon, target, null,
 * true): Clear Body and kin, Mirror Armor back onto a living holder, Mist, Flower Veil, Defiant and Competitive for a foe of
 * the holder, Eject Pack's drop), White Herb after the move; `skip`: the Pokémon whose drop is the step's (the user's own:
 * uses-to-ko.ts HIT_ABILITIES.cottondown). One hit fact per Pokémon whose Speed fell.
 */
function cottonDownRounds(kernel: TurnKernel, w: World, action: PendingAction, holder: DoublesSlotId, landed: number, skip: DoublesSlotId | null) {
  const touched = new Set<DoublesSlotId>();
  for (let hit = 0; hit < landed; hit++) {
    for (const slot of allActive(kernel, w)) {
      if (slot === holder || slot === skip) continue;
      const changed = kernel.applyBoosts(w, slot, { spe: -1 }, holder, { effect: "ability", herb: false });
      touched.add(slot);
      if ((changed.spe ?? 0) < 0) kernel.hitFact(action, holder, `${kernel.abilityName("cottondown")}: ${kernel.names[slot]}'s Speed falls.`, w.mass);
    }
  }
  for (const slot of touched) if (kernel.alive(w, slot)) whiteHerbAfterMove(kernel, w, slot, undefined);
}

/**
 * The hit's reactions after the step, on a target the hit reached (doubles-turn.ts afterHit, residualReactions):
 * - Flower Veil's fact where the step's veil kept the move's certain drop off a Grass target.
 * - Cotton Down's drops on the others (cottonDownRounds; a spread move's are spreadUser's; a residual hit's are not followed).
 * - Aftermath (a contact move) and Innards Out on the knocking hit are the step's where stepEnv set them (noted "followed");
 *   otherwise (a spread move's hits, a residual hit, an Innards Out holder whose HP differs between entries) not estimated
 *   where the hit knocks it out. Damp in effect stops Aftermath.
 */
export function koRetaliationAfter(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo) {
  const ability = w.mons[target]!.build.abilityId;
  // Flower Veil kept the move's drop off a Grass target (the step's veil): the hit's fact (T2M §4.2). Integration 1b: none for a
  // residual hit whose source is not in battle (action.userless: a landing move drops nothing, and no Pokémon is its user).
  if (!action.userless && outcome.landed > 0 && !info.transformed && kernel.alive(w, target) && kernel.secondaryLands(w, action.slot, target, info)
    && veilFor(kernel, w, action.slot, target, () => info) === "flowerveil") {
    const drops = statMove(ownMoveId(action.moveId!, info), gameOf(kernel), w.mons[action.slot]!.build.abilityId === "serenegrace")?.target;
    if (drops && Object.values(drops).some((amount) => amount! < 0)) kernel.hitFact(action, target, `${kernel.abilityName("flowerveil")}: ${kernel.names[target]}'s stats do not fall.`, w.mass);
  }
  if (ability === "cottondown" && outcome.landed > 0 && !w.spread) {
    if (kernel.inEndOfTurn) kernel.notEstimated(REASONS.combo(kernel.moveName(action.moveId!), kernel.abilityName(ability)));
    cottonDownRounds(kernel, w, action, target, outcome.landed, action.slot);
  }
  if (!outcome.knocked) return;
  const reacts = (ability === "aftermath" && info.contact && !dampOn(kernel, w, action.slot, () => info)) || ability === "innardsout";
  if (!reacts) return;
  const followed = !w.spread && !kernel.inEndOfTurn && peekNote(kernel, action.slot, target)?.ko === "followed";
  if (followed) return;
  if (w.spread) { spreadRetaliation(kernel, w, action, target, ability); return; }
  if (!kernel.inEndOfTurn) kernel.notEstimated(REASONS.combo(kernel.abilityName(ability), "earlier damage this turn"));
  kernel.notEstimated(REASONS.combo(kernel.moveName(action.moveId!), kernel.abilityName(ability)));
}

/** World.spread's marker of a DamagingHit loss on a spread move's user that depends on the world (spreadRetaliation). */
export const SPREAD_LOSS = "loss:";

/**
 * Aftermath or Innards Out on a spread move's knocking hit (T2M §3.11; the step does not follow the user): its loss joins the
 * other targets' DamagingHit losses (Rough Skin, Rocky Helmet) in spreadStep's first loss group, before the Update after the
 * hits (sim/battle-actions.ts:966: its Berry) and the faint batch: a World.spread marker (SPREAD_LOSS) the spread step adds to
 * that group. Aftermath trunc(baseMaxHP / 4), Innards Out the HP its holder had as the move started (stepEnv's note: one
 * value), none through Magic Guard. Not estimated where the holder's HP differed between entries.
 */
function spreadRetaliation(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, ability: string) {
  const attacker = action.slot;
  const reason = () => kernel.notEstimated(REASONS.combo(kernel.moveName(action.moveId!), kernel.abilityName(ability)));
  if (!kernel.alive(w, attacker) || attacker === w.ghost) return;
  const user = w.mons[attacker]!.build;
  if (user.abilityId === "magicguard") return;
  const amount = ability === "aftermath" ? Math.trunc(kernel.hp[attacker].baseMaxHP / 4) : peekNote(kernel, attacker, target)?.spreadIO;
  if (!amount) reason();
  w.spread = [...(w.spread ?? []), `${SPREAD_LOSS}${amount}`];
  kernel.lossFact(attacker, `${kernel.names[attacker]} loses ${amount} HP (${kernel.abilityName(ability)}).`, w.mass);
}

/**
 * Battle Bond on the knocker-out (T2M §3.10, C22; PS/data/abilities.ts battlebond onSourceAfterFaint, data/mods/gen8: a move's
 * knockout, a Greninja-Bond not transformed that is still in, whose foes have a Pokémon left (foePokemonLeft, counted after the
 * faint: doubles-stages.ts foesLeft, with its turn fact when canSwitch is not given) and has not had it act: SV +1 Attack, Sp. Atk
 * and Speed through boost() (once a battle: MoveVolatiles.onceUsed, the input's onceUsed; the turn fact when the input does not
 * say), USUM the Greninja-Ash form (its HP base is Greninja-Bond's: the maximum HP stays). One faint batch boosts once.
 */
function battleBond(kernel: TurnKernel, w: World, action: PendingAction, attacker: DoublesSlotId, knocked: DoublesSlotId) {
  const mon = w.mons[attacker];
  if (!mon || !kernel.alive(w, attacker) || attacker === w.ghost) return;
  const build = mon.build;
  if (build.abilityId !== "battlebond" || build.speciesId !== "greninjabond" || build.transformedFrom) return;
  if (mon.vol.onceUsed?.includes("battlebond") || !foesLeft(kernel, w, attacker)) return;
  const name = kernel.names[attacker], bond = kernel.abilityName("battlebond");
  if (kernel.runtime.profile.generation === 7) {
    mon.build = withSpecies(build, "greninjaash");
    kernel.hitFact(action, knocked, `${bond}: ${name} becomes ${kernel.runtime.speciesById.get("greninjaash")?.name ?? "Greninja-Ash"}.`, w.mass);
    return;
  }
  if (kernel.input.pokemon[attacker]?.carried?.onceUsed === undefined) kernel.turnFact(`Assumes ${name} has not had ${bond} act before in this battle.`);
  setVol(w, attacker, { onceUsed: [...(mon.vol.onceUsed ?? []), "battlebond"] });
  const changed = kernel.applyBoosts(w, attacker, { atk: 1, spa: 1, spe: 1 }, attacker, { effect: "ability" });
  const parts = (["atk", "spa", "spe"] as const).filter((stat) => changed[stat]).map((stat) => `+${changed[stat]} ${STAT_LABEL[stat]}`);
  kernel.hitFact(action, knocked, parts.length ? `${bond}: ${name} gets ${listText(parts)}.` : `${bond}: ${name}'s stats cannot go higher.`, w.mass);
}

/** The knocker-out's Battle Bond after a single-target hit (doubles-turn.ts afterHit; a spread move's faint batch is spreadUser's). */
export function afterKnockOut(kernel: TurnKernel, w: World, action: PendingAction, outcome: TurnStepOutcome) {
  if (!outcome.knocked || w.spread) return;
  const target = (w.hitTargets ?? []).find((slot) => w.mons[slot]?.fainted) ?? action.target ?? action.slot;
  battleBond(kernel, w, action, action.slot, target);
}

/**
 * Receiver and Power of Alchemy (T2M §3.12; PS/data/abilities.ts receiver, powerofalchemy onAllyFaint): as a Pokémon faints
 * (the kernel's faint, the end of turn's included), its partner with that ability in effect and HP takes the fainted one's
 * ability (getAbility: its own, a suppressed one included) unless it has the noreceiver flag or is none: setAbility(ability,
 * target), A1's doubles-abilities.ts setAbility (cantsuppress, an Ability Shield on the receiver, the old ability's End, the
 * new one's Start: Intimidate acts at once). In a spread move's hits (World.spread) Showdown faints the targets after every
 * hit, and the receiver may be a later target whose step would write its ability back: the copy is stashed (KVol.receive)
 * and spreadUser applies it after the hits. Not estimated where the Start splits the world.
 */
export function allyFaint(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const partner = allyOf(slot);
  if (!kernel.alive(w, partner) || partner === w.ghost) return;
  const holder = w.mons[partner]!.build.abilityId;
  if (holder !== "receiver" && holder !== "powerofalchemy") return;
  const theirs = realAbility(kernel, w, slot);
  if (!theirs || theirs === GAS_STAND_IN || theirs === "noability" || abilityFlag(theirs, gameOf(kernel), "noreceiver")) return;
  if (w.spread) { setVol(w, partner, { receive: theirs } as Partial<KVol>); return; }
  receive(kernel, w, partner, theirs, slot);
}

/**
 * The knocking move's user whose move ignores abilities while the faint batch runs inside it (sim/battle-actions.ts:974
 * faintMessages in the hit loop; sim/battle.ts suppressingAbility: the active move's ignoreAbility from its user's Mold
 * Breaker, Teravolt or Turboblaze, an ignoreAbility move, or Mycelium Might on a status move). It reads the move running
 * (kernel.moving: Showdown's activeMove), as it is used: a Z or Max form's own ignoreAbility (getActiveZMove,
 * getActiveMaxMove, sim/battle-actions.ts:397-407), and a called move's caller (its ignoreAbility is the caller's,
 * :422-425). None between moves (a switch request's newcomer: clearActiveMove, sim/battle.ts:2831) or at the end of turn;
 * Pursuit at a switch-out runs as its own move (data/moves.ts:14432). A drag keeps its move active (sim/battle.ts:2821-2831,
 * :565); doubles-switch.ts dragIn rules a breaker's drag into hazards or a breakable Start not estimated, so it is not read here.
 */
function knockingBreaker(kernel: TurnKernel, w: World): DoublesSlotId | undefined {
  const action = kernel.moving;
  if (!action?.moveId || action.userless) return undefined;
  const user = w.mons[action.slot];
  if (!user || user.fainted) return undefined;
  const ability = user.build.abilityId;
  const used = infoOf(kernel, w, action.slot, action.moveId)?.effective;
  const id = used?.id ?? action.moveId;
  const status = (used?.category ?? kernel.runtime.movesById.get(action.moveId)?.category) === "Status";
  return MOLD_BREAKERS.has(ability) || IGNORE_ABILITY_MOVES.has(id) || (status && ability === "myceliummight") ? action.slot : undefined;
}

/** The receiver takes `ability` from the fainted `from` (allyFaint): A1's setAbility; not estimated where its Start splits the world. */
function receive(kernel: TurnKernel, w: World, partner: DoublesSlotId, ability: string, from: DoublesSlotId) {
  const holder = w.mons[partner]!.build.abilityId;
  const worlds = setAbility(kernel, w, partner, ability, { source: from, how: "roleplay", actingBreaker: knockingBreaker(kernel, w) });
  if (worlds.length !== 1) kernel.notEstimated(REASONS.combo(kernel.abilityName(holder), kernel.abilityName(ability)));
  if (worlds[0] !== w) Object.assign(w, worlds[0]);
}

// ------------------------------------------------------------------------------------------------------------------
// The volatile secondaries (T2M §3.2)
// ------------------------------------------------------------------------------------------------------------------

/**
 * The 100% secondaries the pair's step does not carry (SPEC §2.2, the third-party row), on a target the hit reached, as
 * Showdown runs them after the hit's damage and before its DamagingHit (sim/battle-actions.ts spreadMoveHit steps 3-5):
 * - Burning Jealousy and Alluring Voice (status2 Step 1 #12; T2M §3.2, C19): on a target whose stats rose this turn before
 *   the hit (`raisedBefore`: pinned statsRaisedThisTurn, which the hit's own DamagingHit rises come after), with the secondary
 *   reaching it (kernel.secondaryLands: Sheer Force, Shield Dust, Covert Cloak): Burning Jealousy's trySetStatus('brn')
 *   (PS/data/moves.ts:2071: kernel.giveStatus through canStatus, a Rawst or Lum Berry at the hit's Update), Alluring Voice's
 *   addVolatile('confusion') (:282: doubles-status.ts moveConfusion, Persim and Lum at the Update). Spread: in target order.
 * - Spectral Thief's steal is beforeStep's (Step 1 #13): nothing after the hit.
 * - Core Enforcer's suppression (coreEnforcer).
 * Psychic Noise's branch is A2's doubles-typing.ts psychicNoiseGuard. `hitAny`: a hit of the move landed, a Substitute's
 * included (the caller calls it on a hit into the Pokémon, or for Core Enforcer and Spectral Thief on any).
 */
export function volatileSecondary(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo, hitAny: boolean, raisedBefore = false) {
  void hitAny;
  const id = action.moveId!;
  if (id === "psychicnoise" || info.transformed || !VOLATILE_SECONDARY_MOVES.has(id) || !kernel.alive(w, target)) return;
  if (id === "burningjealousy" || id === "alluringvoice") {
    if (!raisedBefore || !kernel.secondaryLands(w, action.slot, target, info)) return;
    const name = kernel.names[target];
    if (id === "burningjealousy") {
      if (!statusLands(kernel, w, target, "brn", action.slot)) return;
      kernel.giveStatus(w, target, "brn", action.slot);
      kernel.hitFact(action, target, `${kernel.moveName(id)}: ${name} is burned.`, w.mass);
    } else if (moveConfusion(kernel, w, action.slot, target, info)) {
      kernel.hitFact(action, target, `${kernel.moveName(id)}: ${name} is confused.`, w.mass);
    }
    return;
  }
  if (id === "spectralthief") return;
  if (id === "coreenforcer") coreEnforcer(kernel, w, action, target, info);
}

/**
 * The abilities whose own reaction to a Core Enforcer hit (special, Dragon, no contact) comes after the move's onHit
 * (PS/sim/battle-actions.ts spreadMoveHit: step 3 runMoveEffects, then DamagingHit, then AfterMoveSecondary and
 * EmergencyExit), which the pair's step applies with the ability it read for the damage: Stamina, Cotton Down, Sand Spit,
 * Anger Point (a critical hit), Berserk, Color Change (PS/data/abilities.ts onDamagingHit, onAfterMoveSecondary), Emergency
 * Exit and Wimp Out (onEmergencyExit). In Showdown the suppression comes first, so none of them acts.
 */
const AFTER_ONHIT_ABILITIES: ReadonlySet<string> = new Set([
  "stamina", "cottondown", "sandspit", "angerpoint", "berserk", "colorchange", "emergencyexit", "wimpout",
]);

/**
 * Core Enforcer (SwSh, USUM; PS/data/moves.ts:2874-2893 onHit and onAfterSubDamage, T2M §3.2, FX-CE): a target it hit (its
 * Substitute's hit included) that has HP, has moved (no move action of it left in the queue: queue.willMove) and did not
 * switch in this turn (newlySwitched) gets the gastroacid volatile unless its ability is cantsuppress or it has the volatile
 * already: A1's Gastro Acid path (doubles-abilities.ts HANDLERS.gastroAcid.onHit: the old ability's End, the stand-in, its
 * Update's Berries and field change). Only as Core Enforcer itself (its Z-Move has no onHit). The hit's fact names the
 * ability. Not estimated where the suppressed ability's own reaction to this hit is one the step applied
 * (AFTER_ONHIT_ABILITIES), or where the Update the suppression brings splits the world (an Unnerve's foe's Berry).
 */
function coreEnforcer(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo) {
  const mon = w.mons[target]!;
  if (mon.vol.gastroAcid !== undefined || kernel.input.pokemon[target]?.switchedIn) return;
  if (w.remaining.some((entry) => entry.slot === target)) return;
  const theirs = realAbility(kernel, w, target);
  if (abilityFlag(theirs, gameOf(kernel), "cantsuppress")) return;
  // The hit reached the Pokémon (applyStep's hitTargets, written before afterHit), so its DamagingHit ran in the step.
  if (w.hitTargets?.includes(target) && AFTER_ONHIT_ABILITIES.has(theirs) && mon.build.abilityId === theirs) {
    kernel.notEstimated(REASONS.combo(kernel.moveName("coreenforcer"), kernel.abilityName(theirs)));
  }
  // A gas holder's own build holds the stand-in under its Neutralizing Gas (DoublesGas.abilities), which A1's End skips: its
  // gas ends here (kernel.gasEnds: not estimated while a Pokémon it suppressed is in, Q5).
  if (theirs === "neutralizinggas") kernel.gasEnds(w, target);
  const move = kernel.runtime.movesById.get("coreenforcer")!;
  // A use with no statistics (index −1): A1's own fact is replaced by this hit's.
  const use: Use = {
    action: { ...action, index: -1 }, user: action.slot, move, entry: tableEntry(kernel, "gastroacid")!, info, type: move.type, priority: 0,
    prankster: false, bounced: false, infiltrates: false, targetType: move.target, reached: new Set([target]),
  };
  const worlds = abilityHandlers.gastroAcid.onHit!(kernel, w, use, target);
  if (worlds.length !== 1) kernel.notEstimated(REASONS.combo(kernel.moveName("coreenforcer"), kernel.abilityName(theirs)));
  if (worlds[0] !== w) Object.assign(w, worlds[0]);
  kernel.hitFact(action, target, `${kernel.moveName("coreenforcer")}: ${kernel.names[target]}'s ${kernel.abilityName(theirs)} is suppressed.`, w.mass);
}

// ------------------------------------------------------------------------------------------------------------------
// Spread moves (doubles-spread.ts spreadStep, drainingStep: contactKO before the hits, spreadUser after them)
// ------------------------------------------------------------------------------------------------------------------

/**
 * A spread move's protecting-move contact effect before its hits (T2M §3.4; PS/sim/battle-actions.ts:550-577: every target's
 * TryHit first, then the hit loop, which reads no user HP): a user that Spiky Shield's 1/8 knocks out still hits the rest
 * and faints in the batch after the hits (spreadStep's first loss group: afterLoss). Its own effects after the hits need its
 * HP (boost(): Moxie and its kin, Battle Bond; Throat Spray, Life Orb): where the user can be at 0 HP here and one of them
 * would act, not estimated (`loss`: the contact damage so far; `contact`, `rest`: the checks).
 */
export function contactKO(kernel: TurnKernel, world: World, action: PendingAction, contact: HitCheck[], rest: HitCheck[], loss: number) {
  const attacker = action.slot;
  const out = !kernel.alive(world, attacker) || [...marginal(world, attacker).keys()].some((hp) => hp <= loss);
  if (!out || !rest.some((check) => !check.block)) return;
  const build = world.mons[attacker]!.build;
  const afterHits = !!KO_BOOSTS[build.abilityId] || build.abilityId === "battlebond"
    || (build.itemId === "throatspray" && kernel.itemWorks(world, build));
  if (afterHits) kernel.notEstimated(REASONS.notIn2v2(contact.map((check) => (check.block as { by: string }).by)[0]));
}

/** A spread step's side text (World.spread), its tags taken out. */
type Entry = { target: DoublesSlotId | null; reaction: string | null; side: TurnSide; key: string };
function entryOf(text: string, pre: BattleBuild): Entry {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const target = (raw[TAG_TARGET] as DoublesSlotId | undefined) ?? null, reaction = (raw[TAG_REACTION] as string | undefined) ?? null;
  delete raw[TAG_TARGET]; delete raw[TAG_REACTION];
  // The attacker's own Unnerve read as the stand-in in its ally's calculation (calcStandIns) is its Unnerve.
  if (raw.abilityId === GAS_STAND_IN && UNNERVES.has(pre.abilityId)) raw.abilityId = pre.abilityId;
  const side = raw as unknown as TurnSide;
  return { target, reaction, side, key: JSON.stringify(side) };
}

/**
 * One target's own-state reaction on the user, as the difference between its step's state and the reference (a target with
 * none): the fields a status, ability or item reaction changes (Spicy Spray's burn, a Lum or Rawst Berry it used, Mummy,
 * Lingering Aroma, Wandering Spirit, Pickpocket, Sticky Barb), applied in target order on the user's build: the first status
 * stands (a later one fails), the latest ability and item. Stages (status2 integration 1b): a Gulping Cramorant's Gulp Missile
 * (Def -1) and a Mirror Armor holder's reflected drop (the move's certain drops on it, those it is not at -6 in), each replayed
 * through applyBoosts from the holder (`stages`). False for a difference it cannot compose (other stages, a form).
 */
function applyDiff(kernel: TurnKernel, world: World, attacker: DoublesSlotId, ref: TurnSide, side: TurnSide, stages?: { from: DoublesSlotId; changes: Partial<Record<CombatStat, number>> } | null): boolean {
  const mon = world.mons[attacker]!;
  for (const key of new Set([...Object.keys(ref), ...Object.keys(side)]) as Set<keyof TurnSide>) {
    if (key === "hp" || JSON.stringify(ref[key]) === JSON.stringify(side[key])) continue;
    if (key === "boosts" && stages) {
      if (kernel.alive(world, attacker)) kernel.applyBoosts(world, attacker, stages.changes, stages.from, { effect: "ability" });
      continue;
    }
    if (key === "status") { if (!mon.build.status) mon.build = { ...mon.build, status: side.status }; continue; }
    if (key === "itemId") { mon.build = { ...mon.build, itemId: side.itemId }; continue; }
    if (key === "unburden") { if (side.unburden && mon.build.abilityId === "unburden" && !mon.build.itemId) mon.build = { ...mon.build, abilityActive: true }; continue; }
    if (key === "abilityId") { mon.build = { ...mon.build, abilityId: side.abilityId }; continue; }
    return false;
  }
  return true;
}

/**
 * The stage reaction a spread target's entry carries for applyDiff (status2 integration 1b): a Gulping Cramorant's Gulp Missile
 * (Def -1 from the holder: PS/data/abilities.ts gulpmissile onDamagingHit, boost(…, source, target, null, true)), or a Mirror
 * Armor holder's reflection of the move's certain drops on it (PS/data/abilities.ts mirrorarmor onTryBoost: each negative
 * stage the holder is not at -6 in, boosted on the user from the holder), else null.
 */
function stageReaction(kernel: TurnKernel, world: World, action: PendingAction, info: TurnMoveInfo, entry: Entry): { from: DoublesSlotId; changes: Partial<Record<CombatStat, number>> } | null {
  if (!entry.target || !entry.reaction) return null;
  if (entry.reaction === "gulpmissile") return { from: entry.target, changes: { def: -1 } };
  if (entry.reaction !== "mirrorarmor") return null;
  const drops = statMove(ownMoveId(action.moveId!, info), gameOf(kernel), world.mons[action.slot]!.build.abilityId === "serenegrace")?.target ?? {};
  const holder = world.mons[entry.target]!.build;
  const changes = Object.fromEntries(Object.entries(drops).filter(([stat, amount]) => (amount ?? 0) < 0 && (holder.boosts[stat as CombatStat] ?? 0) > -6)) as Partial<Record<CombatStat, number>>;
  return Object.keys(changes).length ? { from: entry.target, changes } : null;
}

/**
 * The user after a spread move's hits (T2M §3.3; doubles-spread.ts spreadStep and drainingStep, before they apply the state
 * every target's step left it in): pinned Showdown deals every target's damage, then each target's DamagingHit in target
 * order (compareLeftToRightOrder), so the user's state is its state before the move with each target's reaction applied in
 * that order, each through boost() from the state the earlier ones left (T2-SE02, T2-SE03, T2-SE04), then the faint batch
 * (Battle Bond). Composed here from the reference state (a target's with no reaction on the user):
 * - each target's own-state reaction (STATE_REACTIONS, tagged by veil) as its difference from the reference (applyDiff);
 * - each Gooey and Tangling Hair holder the move contacted, and each Cotton Down holder, the hit it took: Spe −1 on the user
 *   (the step listed it: stepEnv's spreadUser) and, for Cotton Down, on every other active Pokémon (cottonDownRounds' order);
 * - White Herb after the move, then Battle Bond for the batch.
 * The state is then applied here (the caller's `states` emptied). With no reaction, the caller applies its one state as
 * before. Not estimated (spreadEffect) where the states cannot be told apart or composed, and for Dragon Darts at two targets
 * whose first dart's target changes the user before the second dart (a burn, a Cotton Down drop on a Defiant or Competitive
 * user: each dart's damage is calculated from the state before the move).
 */
export function spreadUser(kernel: TurnKernel, world: World, action: PendingAction, info: TurnMoveInfo, states: string[]) {
  const attacker = action.slot;
  const fail = () => kernel.notEstimated(REASONS.spreadEffect(kernel.moveName(action.moveId!), kernel.names[attacker]));
  const pre = world.mons[attacker]!.build;
  const hits = (world.hitTargets ?? []).filter((slot) => slot !== attacker);
  const listed = (slot: DoublesSlotId) => {
    const ability = world.mons[slot]!.build.abilityId;
    return ability === "cottondown" || ((ability === "gooey" || ability === "tanglinghair") && info.contact);
  };
  const knocked = hits.find((slot) => world.mons[slot]!.fainted);
  const tagged = states.some((text) => text.includes(`"${TAG_TARGET}"`));
  const standIn = UNNERVES.has(pre.abilityId) && states.some((text) => text.includes(`"abilityId":"${GAS_STAND_IN}"`));
  const bond = !!knocked && pre.abilityId === "battlebond";
  const receivers = DOUBLES_SLOTS.filter((slot) => (world.mons[slot]?.vol as KVol | undefined)?.receive !== undefined);
  if (!tagged && !standIn && !bond && !receivers.length && !hits.some(listed)) {
    if (states.length > 1) fail();
    return;
  }
  // A Mirror Armor holder the move drops nothing on (no certain drop: stageReaction null) is a target with no reaction.
  const entries = states.map((text) => entryOf(text, pre)).map((entry) => (entry.reaction === "mirrorarmor" && !stageReaction(kernel, world, action, info, entry) ? { ...entry, reaction: null } : entry));
  const keys = new Set(entries.map((entry) => entry.key));
  const ref = entries.find((entry) => !entry.reaction)?.side ?? (keys.size === 1 ? entries[0]?.side : undefined);
  if (!ref) { if (entries.length) fail(); }
  // A stage reaction adds up over the targets (two Mirror Armor holders: two drops), so its entry needs a target with none to
  // compose from (status2 integration 1b; a status, ability or item reaction stands once, as one entry gives it).
  if (!entries.some((entry) => !entry.reaction) && entries.some((entry) => stageReaction(kernel, world, action, info, entry))) fail();
  const plain = new Set(entries.filter((entry) => !entry.reaction).map((entry) => entry.key));
  if (plain.size > 1) fail();
  const first = hits[0];
  if (action.moveId === "dragondarts" && !info.transformed && new Set(hits).size > 1 && first) {
    const user = pre.abilityId;
    if (entries.some((entry) => entry.target === first) || (world.mons[first]!.build.abilityId === "cottondown" && (user === "defiant" || user === "competitive"))) fail();
  }
  // A drop replayed after the hits where Showdown runs it between two of the steps' own changes: a Cotton Down drop on a later
  // target whose own DamagingHit changes its Speed (Weak Armor, Steam Engine, Rattled: the cap makes the order count), or the
  // user's White Herb its step used up (its AfterMove restore would take the replayed drops too).
  const listedHits = hits.filter(listed);
  if (listedHits.some((slot) => world.mons[slot]!.build.abilityId === "cottondown"
    && hits.slice(hits.indexOf(slot) + 1).some((later) => ["weakarmor", "steamengine", "rattled"].includes(world.mons[later]!.build.abilityId)))) fail();
  if (listedHits.length && pre.itemId === "whiteherb" && ref && ref.itemId !== "whiteherb") fail();
  // The reference state applied as spreadStep applies one (the heal-block stand-in's real item back: kernel.healStandIn).
  if (ref) world.mons[attacker]!.build = kernel.unfollowed(pre, kernel.fromSide(pre, { ...ref, hp: 0 }), kernel.healStandIn(world, attacker, true));
  const order = [...hits, ...entries.map((entry) => entry.target).filter((slot): slot is DoublesSlotId => !!slot && !hits.includes(slot))];
  const touched = new Set<DoublesSlotId>();
  for (const slot of order) {
    const entry = entries.find((each) => each.target === slot);
    if (entry && ref && keys.size > 1 && !applyDiff(kernel, world, attacker, ref, entry.side, stageReaction(kernel, world, action, info, entry))) fail();
    if (!hits.includes(slot) || !listed(slot)) continue;
    if (world.mons[slot]!.build.abilityId === "cottondown") {
      for (const other of allActive(kernel, world)) {
        if (other === slot) continue;
        const changed = kernel.applyBoosts(world, other, { spe: -1 }, slot, { effect: "ability", herb: false });
        touched.add(other);
        if ((changed.spe ?? 0) < 0) kernel.hitFact(action, slot, `${kernel.abilityName("cottondown")}: ${kernel.names[other]}'s Speed falls.`, world.mass);
      }
    } else {
      kernel.applyBoosts(world, attacker, { spe: -1 }, slot, { effect: "ability", herb: false });
      touched.add(attacker);
    }
  }
  for (const slot of touched) if (kernel.alive(world, slot)) whiteHerbAfterMove(kernel, world, slot, undefined);
  // The faint batch (sim/battle.ts faintMessages): each Faint's Receiver and Power of Alchemy, then the batch's AfterFaint.
  for (const slot of receivers) {
    const ability = (world.mons[slot]!.vol as KVol).receive!;
    setVol(world, slot, { receive: undefined } as Partial<KVol>);
    if (kernel.alive(world, slot)) receive(kernel, world, slot, ability, allyOf(slot));
  }
  if (knocked) battleBond(kernel, world, action, attacker, knocked);
  states.length = 0;
}

// ------------------------------------------------------------------------------------------------------------------
// Spectral Thief (Step 1 #13)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Before a pair's calculation (singleStep, spreadStep's plans): Spectral Thief's steal (status2 Step 1 #13; T2M §3.2;
 * PS/sim/battle-actions.ts:781-806 hitStepStealBoosts, after the invulnerability, TryHit, type immunity and accuracy steps
 * and before the hits, through a Substitute too): the target's every positive stage (accuracy and evasion included) goes to
 * the user through boost(boosts, pokemon, pokemon) (doubles-stages.ts applyBoosts from the user itself: Contrary, Simple,
 * the cap, the ledger a foe's Opportunist or Mirror Herb reads), then the target's are set to 0 (setBoost: no boost event,
 * no Eject Pack, no statsLoweredThisTurn: doubles-stages.ts writeStages and World.boosted's reset). Only as Spectral Thief
 * itself (not its Z-Move), into a target it is not immune to (the calculation's no-damage row: a Normal type), with a
 * stage above 0. The calculation then reads the new stages (the engine's own Spectral Thief branch finds nothing left).
 * The world the calculation then reads (a copy), or null for none. spreadStep accepts none (no spread move steals).
 */
export function beforeStep(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, check: HitCheck): World | null {
  if (info.transformed || action.moveId !== "spectralthief" || check.block) return null;
  const user = action.slot, target = check.slot;
  if (user === target || !kernel.alive(w, target) || !kernel.alive(w, user)) return null;
  const mon = w.mons[target]!;
  const STATS = ["atk", "def", "spa", "spd", "spe"] as const;
  const stolen: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe" | "accuracy" | "evasion", number>> = {};
  for (const stat of STATS) if ((mon.build.boosts[stat] ?? 0) > 0) stolen[stat] = mon.build.boosts[stat]!;
  for (const stat of ["accuracy", "evasion"] as const) if ((mon.vol.stages?.[stat] ?? 0) > 0) stolen[stat] = mon.vol.stages![stat];
  if (!Object.keys(stolen).length) return null;
  // The type immunity comes first (hitStepTypeImmunity): the row a Ghost-type move has into a Normal type.
  const probe = kernel.searchFor(w, user, target, action.moveId, kernel.conditionsFor(w, user, target, false, action.moveId), kernel.contextFor(w, action, target, info));
  if (probe.row.kind === "calculated" && !((probe.row.max ?? 0) > 0)) return null;
  const next = cloneWorld(w);
  kernel.applyBoosts(next, user, stolen, user, { effect: "move" });
  const zeroed = Object.fromEntries(Object.keys(stolen).map((stat) => [stat, 0]));
  writeStages(kernel, next, target, zeroed);
  next.boosted = { ...next.boosted, [target]: { ...next.boosted?.[target], reset: true } };
  const STAGE_LABELS: Record<string, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasion" };
  const list = Object.entries(stolen).map(([stat, stage]) => `+${stage} ${STAGE_LABELS[stat]}`);
  const text = list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  kernel.hitFact(action, target, `${kernel.moveName("spectralthief")}: ${kernel.names[user]} takes ${kernel.names[target]}'s ${text}.`, next.mass);
  return next;
}
