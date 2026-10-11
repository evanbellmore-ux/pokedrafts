import { DRAG_MOVES, PROTECT_MOVES, REASONS, SEMI_INVULNERABLE_MOVES } from "./doubles-actions";
import { CRASH_MOVES } from "./status-table";
import { DOUBLES_SLOTS, foesOf, slotSide, type DoublesSlotId } from "./doubles-types";
import { marginal, withSpecies, type EotState, type PendingAction, type World } from "./doubles-world";
import type { HitCheck, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import { generation, setEot, setVol, tableEntry, type Gate, type Use } from "./doubles-use";
import type { ChampionsMove } from "./types";

// The hidden state (status2 ADDENDUM2 §3.5, §4.2 H; T2M §3.1, C20, C21, C24, C27, C38): Track H's file. Fly, Bounce, Dig,
// Dive, Phantom Force, Shadow Force and Sky Drop out of reach; crash damage. Pinned Showdown c23d2e94 (PS/… below is
// node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353).
//
// One state, EotState.hidden (C20): the hidden move of a charge this turn (doubles-eot.ts charging, after chargeHidden), of
// a release carried from last turn (doubles-turn.ts carriedState, from DoublesCarried.charging) or of Sky Drop: "skydrop"
// on its user AND on the lifted Pokémon, which also has EotState.lifted (its user's slot). The lifted Pokémon carries
// "skydrop" too because every reader of the hidden state reads pinned isSemiInvulnerable(), which isSkyDropped() makes true
// for both of the pair (PS/sim/pokemon.ts:2162-2175): the terrains' status and priority blocks (doubles-status.ts), Grassy
// Terrain's heal and the landing at the end of turn, the hit steps here.
//
// When the hidden state ends (pinned volatiles): a charge this turn keeps it to the end of the turn (duration 2). A carried
// release ends at its action: Fly's onTryMove removes the volatile at its TryMove (PS/data/moves.ts fly), and a release
// stopped at BeforeMove ends it at MoveAborted (PS/data/conditions.ts:320-322 twoturnmove onMoveAborted removes
// twoturnmove, whose onEnd removes the move's volatile: probe w1a-h-probes.ts H01, H02; T2M's T2-SI12b reading, "it stays
// hidden", saw a slower Body Slam come before the paralysed release). Gravity's start lands Fly, Bounce and Sky Drop's user
// (PS/data/moves.ts:7780-7806), Smack Down and Thousand Arrows Fly and Bounce (:16967-16994): the volatiles go, the queued
// release is cancelled (sim/battle-queue.ts cancelMove) and twoturnmove with it. Sky Drop's pair is held while its user is
// in and keeps the skydrop volatile (PS/sim/pokemon.ts isSkyDropped): its user fainting frees the lifted Pokémon.

/** A hidden move (EotState.hidden, C20). */
export type HiddenKind = NonNullable<EotState["hidden"]>;

/** The moves each hidden move lets through (PS/data/moves.ts fly, bounce, dig, dive condition onInvulnerability; skydrop onAnyInvulnerability). */
const AIRBORNE_PASS: ReadonlySet<string> = new Set(["gust", "twister", "skyuppercut", "thunder", "hurricane", "smackdown", "thousandarrows"]);
const PASSES: Readonly<Record<HiddenKind, ReadonlySet<string>>> = {
  fly: AIRBORNE_PASS, bounce: AIRBORNE_PASS, skydrop: AIRBORNE_PASS,
  dig: new Set(["earthquake", "magnitude"]), dive: new Set(["surf", "whirlpool"]),
  // PS/data/moves.ts phantomforce, shadowforce condition onInvulnerability: false.
  phantomforce: new Set(), shadowforce: new Set(),
};
/** The moves Grassy Terrain halves into a grounded target that is not semi-invulnerable (PS/data/moves.ts grassyterrain onBasePower). */
const GRASSY_WEAKENED: ReadonlySet<string> = new Set(["earthquake", "bulldoze", "magnitude"]);
/** The field-wide moves that check the invulnerability of each Pokémon themselves (PS/data/moves.ts:13247 perishsong, :19048 teatime onHitField). */
const FIELD_CHECKS: ReadonlySet<string> = new Set(["perishsong", "teatime"]);
/** The target types useMoveInner sends to tryMoveHit, which has no invulnerability step (PS/sim/battle-actions.ts:502-506). */
const SIDE_TARGETS: ReadonlySet<string> = new Set(["all", "foeSide", "allySide", "allyTeam"]);
/** Gulp Missile's forms that hit back (PS/data/abilities.ts gulpmissile onDamagingHit: not while semi-invulnerable). */
const GULPING: ReadonlySet<string> = new Set(["cramorantgulping", "cramorantgorging"]);
/** Follow Me and Rage Powder stop drawing moves while their user is lifted (PS/data/moves.ts:6064 followme, :14620 ragepowder onFoeRedirectTarget isSkyDropped); Spotlight does not. */
const LIFT_STOPS_CENTRE: ReadonlySet<string> = new Set(["followme", "ragepowder"]);

/**
 * `slot`'s hidden move in `w` as the invulnerability step reads it (PS/sim/pokemon.ts isSemiInvulnerable), or null: none, a
 * carried release whose action has started (vol.locked, `moved`: TryMove or MoveAborted ended it), a lifted Pokémon whose
 * Sky Drop user is no longer in or no longer holds it. The other tracks' readers of the hidden state call this.
 */
export function hiddenKind(w: World, slot: DoublesSlotId): HiddenKind | null {
  const mon = w.mons[slot];
  const hidden = mon?.eot.hidden;
  if (!hidden || mon.fainted) return null;
  if (mon.vol.locked === hidden && mon.moved) return null;
  const by = mon.eot.lifted;
  if (by !== undefined && !holdsSkyDrop(w, by)) return null;
  return hidden;
}

/** `slot` is a Sky Drop user in, holding its target (the skydrop volatile). */
function holdsSkyDrop(w: World, slot: DoublesSlotId): boolean {
  const user = w.mons[slot];
  return !!user && !user.fainted && user.eot.hidden === "skydrop" && user.eot.lifted === undefined;
}

/** The Pokémon `user`'s Sky Drop holds (its eot.lifted), or null. */
function liftedBy(w: World, user: DoublesSlotId): DoublesSlotId | null {
  return DOUBLES_SLOTS.find((slot) => w.mons[slot]?.eot.lifted === user) ?? null;
}

/** The hidden state of `slot` cleared where it has ended (hiddenKind null), so the hit's later readers see it gone. */
function settle(w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot];
  if (mon?.eot.hidden && hiddenKind(w, slot) === null) setEot(w, slot, { hidden: undefined, lifted: undefined });
}

/** Free a lifted Pokémon: its hidden state and its lift go (its own queued action, if any, runs again). */
function free(w: World, slot: DoublesSlotId) {
  setEot(w, slot, { hidden: undefined, lifted: undefined });
}

/** How the invulnerability step lets a move through, or null when the hidden move stops it (pinned handler order: priority 1 first). */
type Pass = "noguard" | "lockon" | "pair" | "list";
function passes(w: World, user: DoublesSlotId | null, slot: DoublesSlotId, kind: HiddenKind, used: string | null): Pass | null {
  // No Guard on either Pokémon (PS/data/abilities.ts:2970-2973 onAnyInvulnerability, priority 1: return 0).
  const target = w.mons[slot]!;
  if (target.build.abilityId === "noguard" || (user && w.mons[user]?.build.abilityId === "noguard")) return "noguard";
  // Lock-On or Mind Reader from last turn at this Pokémon (PS/data/moves.ts:10414-10417 lockon onSourceInvulnerability, priority 1).
  if (user && w.mons[user]?.vol.lockOn === slot) return "lockon";
  // Sky Drop's pair: the lifted Pokémon's move at its user (PS/data/moves.ts:16762-16773).
  if (kind === "skydrop" && user && w.mons[user]?.eot.lifted === slot && target.eot.lifted === undefined) return "pair";
  return used && PASSES[kind].has(used) ? "list" : null;
}

/** The fact label of a hidden move ("Fly", "Sky Drop"). */
const labelOf = (kernel: TurnKernel, kind: HiddenKind) => kernel.moveName(kind);

/**
 * A charge turn of a damaging two-turn move (doubles-turn.ts chargeTurn, before doubles-eot.ts charging writes eot.hidden for
 * the six hidden moves): the move it charged (vol.charging, DoublesOutcomeMon.charging: pinned twoturnmove), the turn's fact
 * that it was not charged last turn (ADDENDUM2 §2.5), and Cramorant's Dive form (PS/data/moves.ts:3764-3767 dive onTryMove:
 * Gulp Missile's Gulping at more than half its HP, Gorging at half or less). Its later actions are followed (H models the
 * hidden state).
 */
export function chargeHidden(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove) {
  const slot = action.slot;
  const mon = w.mons[slot]!;
  setVol(w, slot, { charging: move.id });
  if (!kernel.input.pokemon[slot]?.carried?.charging) kernel.turnFact(`Assumes ${kernel.names[slot]} did not charge ${move.name} last turn.`);
  if (move.id !== "dive" || mon.build.abilityId !== "gulpmissile" || mon.build.speciesId !== "cramorant" || mon.build.transformedFrom) return;
  const half = kernel.hp[slot].maxHP / 2;
  const forms = new Set([...marginal(w, slot).keys()].map((hp) => (hp <= half ? "cramorantgorging" : "cramorantgulping")));
  if (forms.size > 1) kernel.notEstimated(REASONS.formChange(kernel.abilityName("gulpmissile"), kernel.names[slot]));
  const form = [...forms][0];
  if (kernel.runtime.speciesById.has(form)) mon.build = withSpecies(mon.build, form);
}

/**
 * As the walk starts, for each slot (doubles-turn.ts presenceGuards): a carried hidden release (DoublesCarried.charging of Fly,
 * Bounce, Dig, Dive, Phantom Force or Shadow Force: eot.hidden from the turn's start, C38) is modelled: the later moves meet
 * the hidden state until its action. Two inputs have no exact turn:
 * - its move with no Pokémon to aim at (both foe slots empty), whose action does nothing in the walk (doubles-turn.ts
 *   execute), so its release would never end the state;
 * - `slot`'s hazard into a side whose Magic Bounce holder or Magic Coat user would send it back, while a Pokémon of that side
 *   can be hidden as it is used: pinned Showdown sends it back only when the move's first target is not semi-invulnerable
 *   (PS/data/abilities.ts:2449-2451 magicbounce, PS/data/moves.ts:10722-10724 magiccoat onAllyTryHitSide), which
 *   doubles-status.ts's bounce does not read;
 * - Cramorant's Dive with a working Power Herb: Dive's onTryMove changes its form before Power Herb skips the charge
 *   (PS/data/moves.ts:3760-3771), and with no charge turn chargeHidden never runs.
 */
export function carriedStart(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot];
  const hidden = mon?.eot.hidden;
  if (hidden && kernel.targetless(slot)) kernel.notEstimated(REASONS.combo(kernel.moveName(hidden), "no Pokémon to aim at"));
  hazardBounce(kernel, w, slot);
  const entry = kernel.input.pokemon[slot];
  if (mon && entry?.action.moveId === "dive" && !entry.carried?.charging && mon.build.abilityId === "gulpmissile" && mon.build.speciesId === "cramorant"
    && !mon.build.transformedFrom && mon.build.itemId === "powerherb" && kernel.itemWorks(w, mon.build)) {
    kernel.notEstimated(REASONS.formChange(kernel.abilityName("gulpmissile"), kernel.names[slot]));
  }
}

/** carriedStart's second input: a hazard of `slot` that a foe's Magic Bounce or Magic Coat could send back while a foe can be hidden. */
function hazardBounce(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const moveId = kernel.input.pokemon[slot]?.action.moveId;
  const entry = moveId ? tableEntry(kernel, moveId) : undefined;
  if (!entry || entry.target !== "foeSide" || !entry.flags.reflectable) return;
  const foes = foesOf(slot).filter((foe) => w.mons[foe] && kernel.alive(w, foe));
  const bouncer = foes.find((foe) => w.mons[foe]!.build.abilityId === "magicbounce" || kernel.input.pokemon[foe]?.action.moveId === "magiccoat");
  if (!bouncer) return;
  const lifts = DOUBLES_SLOTS.some((other) => kernel.input.pokemon[other]?.action.moveId === "skydrop");
  const hidable = foes.some((foe) => w.mons[foe]!.eot.hidden || SEMI_INVULNERABLE_MOVES.has(kernel.input.pokemon[foe]?.action.moveId ?? "")) || lifts;
  if (!hidable) return;
  const by = w.mons[bouncer]!.build.abilityId === "magicbounce" ? kernel.abilityName("magicbounce") : kernel.moveName("magiccoat");
  kernel.notEstimated(REASONS.combo(kernel.moveName(moveId!), `${kernel.names[bouncer]}'s ${by}`));
}

/**
 * The invulnerability step of a damaging move into `slot` (doubles-turn.ts hitChecks, each target first; C27: after
 * presence.invulnerable), PS/sim/battle-actions.ts:621-641: a hidden Pokémon is missed unless No Guard is on either Pokémon,
 * the user is locked on to it, the move as used (its own id: a Z-Move or Max Move is in no list) is in the hidden move's list,
 * or it is Sky Drop's pair. A miss is `{ slot, block: { by: "miss", hidden } }` (blockedHit's fact "{Move} misses {Name}
 * ({Hidden move})."; no contact effect; a crash move then crashes). Sky Drop's own charge turn into a protected Pokémon: the
 * charge turn has no contact flag (PS/data/moves.ts:16695-16700 onModifyMove), so the protection blocks it with no contact
 * effect. A move that gets through into a hidden Pokémon where the calculation would read it as on the ground and not
 * hidden is not estimated (the engine's terrain checks, Gulp Missile, a one-hit KO move's accuracy step: below).
 */
export function misses(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, slot: DoublesSlotId): HitCheck | null {
  const target = w.mons[slot];
  if (!target) return null;
  if (target.eot.hidden) settle(w, slot);
  const kind = hiddenKind(w, slot);
  const attacker = action.slot;
  if (!kind) return action.moveId === "skydrop" && !info.transformed ? skyDropProtect(kernel, w, action, slot) : null;
  if (slot === attacker) return null;
  const used = info.effective.id;
  const how = passes(w, attacker, slot, kind, used);
  if (!how) return { slot, block: { by: "miss", hidden: labelOf(kernel, kind) } };
  passedCorners(kernel, w, action, info, slot, kind, how);
  return null;
}

/**
 * A damaging move that gets through into a hidden Pokémon where the app's calculation and step read it as a Pokémon on the
 * ground that is not hidden (pinned Showdown skips each of these for a semi-invulnerable target): Grassy Terrain halving
 * Earthquake, Bulldoze and Magnitude (PS/data/moves.ts:7696 grassyterrain onBasePower); Psychic Terrain stopping a foe's
 * priority move (:14120 psychicterrain onTryHit); Misty Terrain halving a Dragon move and stopping a status or confusion
 * (:12172-12187); Gulp Missile hitting back (PS/data/abilities.ts:1747); a one-hit KO move's accuracy and level steps
 * (PS/sim/battle-actions.ts:696-710). Each is not estimated, naming the move, the field or ability and the hidden move.
 */
function passedCorners(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, slot: DoublesSlotId, kind: HiddenKind, how: Pass) {
  const target = w.mons[slot]!;
  const move = kernel.moveName(info.effective.id);
  const hidden = `${kernel.names[slot]}'s ${labelOf(kernel, kind)}`;
  if (info.effective.ohko) kernel.notEstimated(REASONS.combo(move, hidden));
  if (target.build.abilityId === "gulpmissile" && GULPING.has(target.build.speciesId)) kernel.notEstimated(REASONS.combo(move, `${kernel.names[slot]}'s Gulp Missile`));
  if (kind === "skydrop") skyDropHeld(kernel, w, slot, info.effective.id, move);
  // Smack Down and Thousand Arrows end Fly and Bounce on any Pokémon they hit, one already on the ground included (A2's
  // doubles-typing.ts groundingAfterHit; status2 integration 1b).
  const terrain = w.field.terrain;
  if (!terrain || !kernel.grounded(w, slot)) return;
  const on = (name: string) => kernel.notEstimated(REASONS.combo(move, `${name} Terrain and ${hidden}`));
  if (terrain === "Grassy" && GRASSY_WEAKENED.has(info.effective.id)) on("Grassy");
  if (terrain === "Psychic" && kernel.isFoe(action.slot, slot)) {
    const priority = action.frozen ? action.frozen.priority - action.fractional : kernel.priorityOf(w, action);
    if (priority > 0.1) on("Psychic");
  }
  if (terrain === "Misty") {
    const context = kernel.input.pokemon[action.slot]?.contexts[action.moveId!];
    if (how !== "list" || kernel.usedType(w, action.slot, action.moveId!, slot, info, context) === "Dragon") on("Misty");
  }
}

/**
 * A move that reaches one of Sky Drop's pair: the pair cannot be made to leave (PS/data/moves.ts:16741-16743 skydrop
 * onAnyDragOut; PS/data/items.ts:1689 Eject Button reads isSkyDropped), which the switch family does not read: Dragon Tail,
 * Circle Throw, Roar, Whirlwind and a held Eject Button are not estimated there.
 */
function skyDropHeld(kernel: TurnKernel, w: World, slot: DoublesSlotId, used: string, move: string) {
  const build = w.mons[slot]!.build;
  if (DRAG_MOVES.has(used) || used === "roar" || used === "whirlwind") kernel.notEstimated(REASONS.combo(move, `${kernel.names[slot]}'s ${kernel.moveName("skydrop")}`));
  if (build.itemId === "ejectbutton" && kernel.itemWorks(w, build)) kernel.notEstimated(REASONS.combo(move, `${kernel.names[slot]}'s ${kernel.itemName("ejectbutton")}`));
}

/**
 * Sky Drop's charge turn into a Pokémon that is not hidden, at the invulnerability step: a protection that blocks it (Wide and
 * Quick Guard first: hitChecks' own checks, with no contact effect) blocks it without its contact effect.
 */
function skyDropProtect(kernel: TurnKernel, w: World, action: PendingAction, slot: DoublesSlotId): HitCheck | null {
  const target = w.mons[slot]!;
  if (!target.protect) return null;
  const side = w.sides[slotSide(slot)];
  const priority = action.frozen ? action.frozen.priority - action.fractional : kernel.priorityOf(w, action);
  if (side.quickGuard && priority > 0.1) return null;
  if (kernel.protectPasses(w, action, slot)) return null;
  const by = kernel.moveName(Object.entries(PROTECT_MOVES).find(([, protect]) => protect === target.protect)![0]);
  return { slot, block: { by } };
}

/**
 * The invulnerability step of a status move into `slot` (doubles-status.ts tryHit, first; after presence.invulnerable): the
 * hidden move's name for the fact "{Move} misses {Name} ({Hidden move}).", or null. PS/sim/battle-actions.ts:621-641: Helping
 * Hand passes; Toxic from a Poison-type user passes (generation 8 on: :627; generation 7: the toxic volatile its PrepareHit
 * adds, PS/data/mods/gen7/moves.ts:1031-1047); then No Guard, Lock-On, Sky Drop's pair; every hidden move lets no status move
 * through. Moves that tryMoveHit runs (side and field moves) have no such step, but Perish Song and Teatime, which check each
 * Pokémon themselves (PS/data/moves.ts:13247, :19048: they come here through tryHit).
 */
export function missesStatus(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): string | null {
  const target = w.mons[slot];
  if (!target?.eot.hidden || slot === use.user) return null;
  if (SIDE_TARGETS.has(use.targetType) && !FIELD_CHECKS.has(use.move.id)) return null;
  settle(w, slot);
  const kind = hiddenKind(w, slot);
  if (!kind || use.move.id === "helpinghand") return null;
  if (use.move.id === "toxic" && poisonToxic(kernel, w, use.user)) return null;
  if (!passes(w, use.user, slot, kind, use.move.id)) return labelOf(kernel, kind);
  if (kind === "skydrop") skyDropHeld(kernel, w, slot, use.move.id, use.move.name);
  return null;
}

/**
 * Toxic from a Poison-type user passes the invulnerability step (generation 8 on, PS/sim/battle-actions.ts:627: the user's
 * types at the step, after its Protean or Libero). Generation 7 reads its types at the move's own PrepareHit, before Protean's
 * (PS/data/mods/gen7/moves.ts:1031-1033): a Protean or Libero user made Poison by this Toxic is not estimated there.
 */
function poisonToxic(kernel: TurnKernel, w: World, user: DoublesSlotId): boolean {
  if (!kernel.typesIn(w, user).includes("Poison")) return false;
  const build = w.mons[user]!.build;
  if (generation(kernel) === 7 && (build.abilityId === "protean" || build.abilityId === "libero") && !kernel.typesOf({ ...build, types: undefined }).includes("Poison")) {
    kernel.notEstimated(REASONS.combo(kernel.moveName("toxic"), kernel.abilityName(build.abilityId)));
  }
  return true;
}

/**
 * A field-wide move's reach to `slot` (A3's Teatime; Perish Song comes through missesStatus): whether the hidden Pokémon is
 * missed (PS/data/moves.ts:19048 teatime onHitField: runEvent('Invulnerability', pokemon, source, move) === false: No Guard,
 * Lock-On and Sky Drop's pair pass, and no hidden move lets Teatime through). `user`: the move's user (No Guard, Lock-On);
 * absent, only the hidden move is read.
 */
export function missesField(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove, user?: DoublesSlotId): boolean {
  if (!w.mons[slot]?.eot.hidden || slot === user) return false;
  settle(w, slot);
  const kind = hiddenKind(w, slot);
  return !!kind && !passes(w, user ?? null, slot, kind, move.id);
}

/**
 * A hidden Pokémon lands. `cause`: "gravity" (A3's fieldMove at Gravity's start: Fly, Bounce and Sky Drop's user,
 * PS/data/moves.ts:7780-7806) or the move that grounds it ("smackdown", "thousandarrows": A2's grounding write; Fly and Bounce
 * only, :16967-16994). Absent, it is Gravity while Gravity is up (no Fly, Bounce or Sky Drop stands under Gravity: Gravity's
 * start lands them, and its BeforeMove stops their use), else Smack Down. Its hidden state and its charge (vol.charging: twoturnmove removed) go; its queued action this
 * turn (a carried release) is cancelled (sim/battle-queue.ts cancelMove: willMove no longer finds it, so `moved`), with the
 * skip fact "{Name} falls to the ground ({Cause}): {Move} is cancelled."; Sky Drop's lifted Pokémon is freed (its own queued
 * action runs). Dig, Dive, Phantom Force, Shadow Force and a lifted Pokémon itself do not land.
 */
export function land(kernel: TurnKernel, w: World, slot: DoublesSlotId, given?: string) {
  const cause = given ?? (w.field.gravity ? "gravity" : "smackdown");
  const mon = w.mons[slot];
  if (!mon || mon.fainted || !mon.eot.hidden) return;
  const kind = hiddenKind(w, slot);
  if (!kind) { settle(w, slot); return; }
  const lands = kind === "fly" || kind === "bounce" || (kind === "skydrop" && cause === "gravity" && mon.eot.lifted === undefined);
  if (!lands) return;
  if (kind === "skydrop") {
    const lifted = liftedBy(w, slot);
    if (lifted) free(w, lifted);
  }
  setEot(w, slot, { hidden: undefined });
  if (mon.vol.charging) setVol(w, slot, { charging: undefined });
  const queued = w.remaining.find((entry) => entry.slot === slot && entry.moveId !== null);
  if (!queued) return;
  w.remaining = w.remaining.filter((entry) => entry !== queued);
  mon.moved = true;
  // The cancelled move still takes its place among the moves (DoublesStep.order: the moves picked or cancelled before a move).
  w.executed++;
  kernel.skipFact(queued, `${kernel.names[slot]} falls to the ground (${kernel.moveName(cause)}): ${kernel.moveName(queued.moveId!)} is cancelled.`, w.mass);
}

/**
 * Before a move's use (doubles-turn.ts runMove): a carried release leaves its hidden state at its TryMove (PS/data/moves.ts
 * fly and its kin onTryMove: attacker.removeVolatile(move.id)). beforeMove clears it already where it is wired; this keeps
 * the moves that go on exact without it.
 */
export function release(kernel: TurnKernel, w: World, action: PendingAction) {
  void kernel;
  const mon = w.mons[action.slot];
  if (mon?.eot.hidden && mon.vol.locked === mon.eot.hidden) setEot(w, action.slot, { hidden: undefined });
}

/**
 * BeforeMove at priority 12 (doubles-status.ts beforeMove, between D's beforeFirst at 100 and N's beforeMoveStart at 11;
 * integration 1a wires it, W1A-H.md): a Pokémon Sky Drop lifted does nothing (PS/data/moves.ts:16747-16754 skydrop
 * onFoeBeforeMove, priority 12: null before sleep, freeze, flinch or paralysis read anything), with the skip fact "Lifted by
 * {User} (Sky Drop)."; a carried release's hidden state ends here (its TryMove if it goes on, its MoveAborted if a later check
 * stops it: nothing between reads its own hidden state). Null where neither applies (the world goes on unchanged).
 */
export function beforeMove(kernel: TurnKernel, w: World, action: PendingAction): Gate | null {
  const mon = w.mons[action.slot];
  if (!mon?.eot.hidden) return null;
  const by = mon.eot.lifted;
  if (by !== undefined) {
    if (!holdsSkyDrop(w, by)) { free(w, action.slot); return null; }
    kernel.skipFact(action, `Lifted by ${kernel.names[by]} (${kernel.moveName("skydrop")}).`, w.mass);
    return { go: [], stopped: [w] };
  }
  if (mon.vol.locked === mon.eot.hidden) setEot(w, action.slot, { hidden: undefined });
  return null;
}

/**
 * Sky Drop's charge turn at the hit (doubles-turn.ts singleStep, right after a blocked check; integration 1a wires it,
 * W1A-H.md): PS/data/moves.ts:16708-16733 skydrop onTryHit, run in the hit loop after the hit steps (the invulnerability step
 * and the protections in hitChecks, misses above; the type immunity: a Normal Sky Drop under Normalize into a Ghost type
 * that Foresight or Scrappy does not reach, an Electric one under Electrify into a Ground type; accuracy is true on the
 * charge turn, Wonder Guard does not stop it). It fails into a Substitute or an ally ("-fail") and into a Pokémon of 200 kg or
 * more ("[heavy]"; weight after Heavy Metal and Light Metal, which the user's Mold Breaker passes, then Float Stone:
 * PS/sim/pokemon.ts getWeight). Else no damage: the pair is lifted (twoturnmove with the skydrop volatile on the user,
 * vol.charging "skydrop"; both hidden, eot.lifted on the target; the target's Follow Me or Rage Powder stops drawing moves).
 * Null for any other move, a Z-Move, or a type immunity (the step's own no-damage row).
 */
export function skyDropHit(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, check: HitCheck): World[] | null {
  if (action.moveId !== "skydrop" || info.transformed || check.block) return null;
  const user = action.slot, slot = check.slot;
  const target = w.mons[slot]!;
  const move = kernel.moveName("skydrop");
  const fails = (why: string) => {
    const stats = kernel.hitStats(action, slot);
    if (stats) stats.blocked += w.mass;
    kernel.stepFact(action, `${move} fails: ${why}.`, w.mass);
    return [w];
  };
  if (immune(kernel, w, action, info, slot)) return null;
  if (!kernel.isFoe(user, slot)) return fails(`${kernel.names[slot]} is an ally`);
  if (target.vol.substitute) return fails(`${kernel.names[slot]} is behind a Substitute`);
  if (weightOf(kernel, w, user, slot, info) >= 2000) return fails(`${kernel.names[slot]} weighs 200 kg or more`);
  centreGuard(kernel, w, user, slot);
  // A lifted Snatch user takes no later move (PS/data/moves.ts:17124 snatch onAnyPrepareHit isSkyDropped), which A3's Snatch does not read.
  if (target.vol.snatch && kernel.laterAction(w)) kernel.notEstimated(REASONS.combo(move, kernel.moveName("snatch")));
  setEot(w, user, { hidden: "skydrop" });
  setVol(w, user, { charging: "skydrop" });
  setEot(w, slot, { hidden: "skydrop", lifted: user });
  if (target.centre && LIFT_STOPS_CENTRE.has(target.centre)) target.centre = null;
  const stats = kernel.hitStats(action, slot);
  if (stats) stats.effect += w.mass;
  kernel.stepFact(action, `${move}: ${kernel.names[user]} lifts ${kernel.names[slot]} into the air.`, w.mass);
  return [w];
}

/** The type immunity a type-changed Sky Drop meets (hitStepTypeImmunity): Normal into Ghost (not revealed, no Scrappy or Mind's Eye), Electric into Ground. */
function immune(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, slot: DoublesSlotId): boolean {
  const context = kernel.input.pokemon[action.slot]?.contexts[action.moveId!];
  const type = kernel.usedType(w, action.slot, action.moveId!, slot, info, context);
  const types = kernel.typesIn(w, slot);
  if (type === "Electric") return types.includes("Ground");
  if (type !== "Normal" || !types.includes("Ghost")) return false;
  const ability = w.mons[action.slot]!.build.abilityId;
  return w.mons[slot]!.vol.revealed !== "foresight" && ability !== "scrappy" && ability !== "mindseye";
}

/** PS/sim/pokemon.ts getWeight in hectograms: the world weight (Autotomize) or the species', Heavy Metal ×2 and Light Metal ½ (breakable), Float Stone ½. */
function weightOf(kernel: TurnKernel, w: World, user: DoublesSlotId, slot: DoublesSlotId, info: TurnMoveInfo): number {
  const build = w.mons[slot]!.build;
  let hg = build.weighthg ?? Math.round((kernel.runtime.speciesById.get(build.speciesId)?.weightkg ?? 0) * 10);
  if (!kernel.breaks(w, user, slot, info)) {
    if (build.abilityId === "heavymetal") hg *= 2;
    if (build.abilityId === "lightmetal") hg = Math.trunc(hg / 2);
  }
  if (build.itemId === "floatstone" && kernel.itemWorks(w, build)) hg = Math.trunc(hg / 2);
  return Math.max(1, hg);
}

/**
 * A lifted Follow Me or Rage Powder user draws no moves while it is held; Gravity starting later this turn, or a later hit
 * knocking its Sky Drop user out, would free it and its redirection again before a later move of its foes: not estimated
 * then (the redirection it had is not kept in the world).
 */
function centreGuard(kernel: TurnKernel, w: World, user: DoublesSlotId, slot: DoublesSlotId) {
  const centre = w.mons[slot]!.centre;
  if (!centre || !LIFT_STOPS_CENTRE.has(centre)) return;
  const later = w.remaining.filter((entry) => kernel.alive(w, entry.slot) && entry.moveId !== null);
  const foeMove = later.some((entry) => kernel.isFoe(entry.slot, slot));
  const freed = later.some((entry) => entry.moveId === "gravity" || (kernel.isFoe(entry.slot, user) && reaches(kernel, w, entry, user)));
  if (foeMove && freed) kernel.notEstimated(REASONS.combo(kernel.moveName("skydrop"), kernel.moveName(centre)));
}

/** Whether a later damaging action can reach the Sky Drop user through its hidden state (its move in the list, No Guard, Lock-On). */
function reaches(kernel: TurnKernel, w: World, entry: PendingAction, user: DoublesSlotId): boolean {
  const move = kernel.runtime.movesById.get(entry.moveId!);
  if (!move || move.category === "Status") return false;
  return !!passes(w, entry.slot, user, "skydrop", move.id);
}

/**
 * A Pokémon fainting (doubles-turn.ts faint, beside presence.onFaint; integration 1a wires it, W1A-H.md): its volatiles go
 * (PS/sim/battle.ts faintMessages clearVolatile): its hidden state and charge; a fainting Sky Drop user frees the Pokémon it
 * held (PS/data/moves.ts:16785-16789 skydrop onFaint; isSkyDropped reads the volatile).
 */
export function fainted(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  void kernel;
  const mon = w.mons[slot];
  if (!mon) return;
  if (mon.eot.hidden === "skydrop" && mon.eot.lifted === undefined) {
    const lifted = liftedBy(w, slot);
    if (lifted) free(w, lifted);
  }
  if (mon.eot.hidden || mon.eot.lifted !== undefined) setEot(w, slot, { hidden: undefined, lifted: undefined });
  if (mon.vol.charging) setVol(w, slot, { charging: undefined });
}

/** Whether `slot` is out of reach now (pinned isSemiInvulnerable: a hidden move or Sky Drop's pair), for the other tracks' readers (Dancer, Magic Bounce, Magic Coat, Snatch). */
export function semiInvulnerable(w: World, slot: DoublesSlotId): boolean {
  return hiddenKind(w, slot) !== null;
}

/** Whether `slot` is held by a Sky Drop (pinned isSkyDropped: its user, or the Pokémon it lifted). */
export function skyDropped(w: World, slot: DoublesSlotId): boolean {
  return hiddenKind(w, slot) === "skydrop";
}

/**
 * Crash damage (status2 Step 1 #10; T2M §3.1.7, C24): High Jump Kick, Jump Kick, Axe Kick and Supercell Slam used as
 * themselves (CRASH_MOVES, generated from the dex's hasCrashDamage; not their Z-Move or Max Move) run MoveFail when every
 * target failed in the hit steps (PS/sim/battle-actions.ts:521-531: a miss, Protect and the shields after their contact
 * effect, Wide Guard, Quick Guard, Mat Block, Telepathy, an absorbing ability, a type or ability immunity: the calculation's
 * no-damage row), and none when it had no target at all (:504-508: damagingMove's no-target branch never reaches here) or met
 * a Substitute or a Disguise (`hit`: a hit reached a target or its Substitute in that world). onMoveFail
 * (PS/data/moves.ts highjumpkick and its kin): `this.damage(source.baseMaxhp / 2, source, source, …)`, truncated, from a
 * non-move effect (Magic Guard stops it; a Berserk lock resets): afterLoss, its Berry at the action's Update; Emergency
 * Exit and Wimp Out read the drop (doubles-turn.ts eventGuards, a damaging action).
 */
export function crash(kernel: TurnKernel, worlds: World[], action: PendingAction, info: TurnMoveInfo, hit: (w: World) => boolean): World[] {
  if (info.transformed || !CRASH_MOVES.has(action.moveId!)) return worlds;
  const user = action.slot;
  const loss = Math.trunc(kernel.hp[user].baseMaxHP / 2);
  return worlds.flatMap((w) => {
    const mon = w.mons[user]!;
    if (!kernel.alive(w, user) || hit(w) || mon.build.abilityId === "magicguard" || loss <= 0) return [w];
    kernel.lossFact(user, `${kernel.names[user]} loses ${loss} HP (${kernel.moveName(action.moveId!)}).`, w.mass);
    return kernel.afterLoss(w, user, loss);
  });
}
