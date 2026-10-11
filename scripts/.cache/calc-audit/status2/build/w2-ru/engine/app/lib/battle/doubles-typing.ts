import { Generations, toID } from "@smogon/calc";
import { ABSORBING, CALLS_MOVE, FUTURE_MOVES, REASONS, REDIRECT_ABILITIES, TYPE_LOSS_MOVES } from "./doubles-actions";
import { allyOf, DOUBLES_SLOTS, foesOf, SHOWDOWN_POSITION, slotSide, type DoublesSlotId, type DoublesTurnInput } from "./doubles-types";
import { cloneWorld, type PendingAction, type World } from "./doubles-world";
import type { TurnKernel, TurnMoveInfo } from "./doubles-turn";
import * as hiddenNs from "./doubles-hidden";
import { breaks, generation, hitFact, setEot, setVol, type Gate, type StatusHandler, type Use } from "./doubles-use";
import { HEALING_BERRIES } from "./hit-loop";
import { getBuildGender, isMaxActive } from "./mechanics";
import type { BattleBuild, BattleGame, ChampionsMove } from "./types";
import { statusEntry, type StatusEntry } from "./status-table";
import type { TurnStepOutcome } from "./uses-to-ko";

// The hook namespace is copied once into a plain object: under tsx (the bench and the verify harness) a namespace import's
// member is a getter over the module's own export getter, while a plain object keeps each hook call one property load.
const hiddenHooks = { ...hiddenNs };

// Types, volatiles and grounding (status2 SPEC2 §2.2's A2 rows, §4.3; ADDENDUM2 §4.2; F2 = design/types-volatiles.md):
// Track A2's file. Pinned Showdown c23d2e94 is cited as PS/… (node_modules/.cache/champions/pokemon-showdown-c23d2e94…).
//
// - World types (SPEC2 §4.3.1): setTypes and addType follow pinned setType / addType; the kernel's typesIn reads them (a Tera
//   type alone, Roost's Type event, the added type last) and the calculation reads them through makePokemon (Step 0b).
// - The 22 status moves of the family through HANDLERS (doubles-status.ts dispatches by the status table's `handler`): Soak,
//   Magic Powder, Forest's Curse, Trick-or-Treat (with the generation 7 Curse glitch), Reflect Type, Conversion, Conversion 2,
//   Camouflage, Electrify, Ion Deluge, Tar Shot, Foresight and Odor Sleuth, Miracle Eye, Telekinesis, Embargo, Heal Block,
//   Nightmare, Octolock, Attract, Captivate and Powder.
// - The hooks Step 0 placed: Attract at BeforeMove 2 (beforeAttract), Powder at TryMove −1 (powderTryMove), a status move's
//   Electrify or Ion Deluge (retypeStatus), the combinations the turn does not follow (comboGuard), Protean and Libero at
//   PrepareHit (proteanGuard: now the type change itself), Roost (no guard: typesIn folds it), Smack Down's and Thousand
//   Arrows' grounding (groundingAfterHit), Burn Up, Double Shock and Color Change after a hit (afterHit), Psychic Noise's
//   kept Berry in its own hit (psychicNoiseKeepsBerry; later steps read Heal Block through the kernel's stand-ins, C14).
// - The guards that go (SPEC2 §2.4): typeChange (Protean, Roost, Burn Up, Double Shock), groundingChange (Ingrain, Magnet
//   Rise), Smack Down's and Thousand Arrows' later-action guard, Psychic Noise's. The moved functions keep their names and
//   call sites; each removed guard's body is now empty (the integrator removes the calls, status2-hooks.test.ts' rows).

/** The turn reads a Pokémon's move as used this turn (Conversion 2's target: PS/sim/battle-actions.ts:391 lastMoveUsed), kept only then (SPEC2 §4.9). */
const USED_TYPE_READERS = new WeakMap<DoublesTurnInput, boolean>();
function readsUsedType(kernel: TurnKernel): boolean {
  let known = USED_TYPE_READERS.get(kernel.input);
  if (known === undefined) {
    known = DOUBLES_SLOTS.some((slot) => kernel.input.pokemon[slot]?.action.moveId === "conversion2");
    USED_TYPE_READERS.set(kernel.input, known);
  }
  return known;
}

/** The eighteen types a Pokémon can be set to (PS/sim/dex-data.ts types.names(): the standard ones; Stellar and ??? never resist). */
const STANDARD_TYPES = ["Bug", "Dark", "Dragon", "Electric", "Fairy", "Fighting", "Fire", "Flying", "Ghost", "Grass", "Ground", "Ice", "Normal", "Poison",
  "Psychic", "Rock", "Steel", "Water"] as const;
/** The -ate abilities' types (PS/data/abilities.ts aerilate and its kin onModifyType, priority −1: a Normal move but their noModifyType). */
const ATE_TYPES: Readonly<Record<string, string>> = { aerilate: "Flying", pixilate: "Fairy", refrigerate: "Ice", galvanize: "Electric", dragonize: "Dragon" };
/** The moves the -ate abilities and Normalize leave alone (their noModifyType lists; Normalize also Hidden Power and Struggle). */
const ATE_KEPT: ReadonlySet<string> = new Set(["judgment", "multiattack", "naturalgift", "revelationdance", "technoblast", "terrainpulse", "weatherball"]);
/**
 * Moves whose type is set as they are used (their own onModifyType, or a type from the field, the user or its item: F2 §2.3):
 * an earlier turn's use of one gives Conversion 2 no type it can read (REASONS.needsLastMoveType).
 */
const OWN_TYPE_MOVES: ReadonlySet<string> = new Set([
  "weatherball", "terrainpulse", "judgment", "multiattack", "technoblast", "revelationdance", "naturalgift", "aurawheel", "ragingbull", "ivycudgel",
  "terablast", "terastarstorm",
]);
/** Telekinesis' immune species (PS/data/moves.ts:19137-19141: by base species; Mega Gengar by its form). */
const TELEKINESIS_IMMUNE: ReadonlySet<string> = new Set(["diglett", "dugtrio", "palossand", "sandygast"]);

const isTera = (build: BattleBuild) => build.mechanic === "tera";
/** A Tera type its types read alone (the kernel's typesIn: not Stellar). */
const teraTyped = (build: BattleBuild) => build.mechanic === "tera" && !!build.configuration?.teraType && build.configuration.teraType !== "Stellar";
const fixedTypes = (build: BattleBuild) => build.speciesId.startsWith("arceus") || build.speciesId.startsWith("silvally");

/**
 * pinned setType (PS/sim/pokemon.ts:2109-2129): false for a Terastallized Pokémon (any Tera type), Arceus and Silvally, or a
 * Stellar type; otherwise build.types = types (absent when they are its species'), addedType cleared.
 */
export function setTypes(kernel: TurnKernel, w: World, slot: DoublesSlotId, types: string[]): boolean {
  const mon = w.mons[slot]!;
  const build = mon.build;
  if (isTera(build) || types.includes("Stellar") || !types.length) return false;
  if (fixedTypes(build)) return false;
  const species = kernel.runtime.speciesById.get(build.speciesId)?.types ?? [];
  const same = species.length === types.length && species.every((type, index) => type === types[index]);
  const next = { ...build };
  if (same) delete next.types; else next.types = [...types];
  delete next.addedType;
  mon.build = next;
  return true;
}

/** pinned addType (PS/sim/pokemon.ts:2132-2136): false while Terastallized; else addedType = type (it replaces an added type). */
export function addType(kernel: TurnKernel, w: World, slot: DoublesSlotId, type: "Grass" | "Ghost"): boolean {
  void kernel;
  const mon = w.mons[slot]!;
  if (isTera(mon.build)) return false;
  mon.build = { ...mon.build, addedType: type };
  return true;
}

/** Its base types as getTypes(true) reads them (PS/sim/pokemon.ts:2138-2146): a Tera type alone, else Roost's Type event on its types, Normal when none is left. */
function baseTypesIn(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  const all = kernel.typesIn(w, slot);
  const added = w.mons[slot]!.build.addedType;
  // typesIn puts the added type last (none on a Terastallized Pokémon); getTypes(true) leaves it out.
  return added && !teraTyped(w.mons[slot]!.build) ? all.slice(0, -1) : all;
}

/**
 * Electrify on the user (PS/data/moves.ts:4576-4582: any move but Struggle) and Ion Deluge on the field (:9693-9699: a Normal
 * move), at ModifyType priority −2: the last step of a move's type as used, after its user's ModifyType chain (`type`).
 */
function retyped(w: World, slot: DoublesSlotId, moveId: string, type: string): string {
  if (w.mons[slot]?.vol.electrify && moveId !== "struggle") return "Electric";
  if (w.field.ionDeluge && type === "Normal") return "Electric";
  return type;
}

/**
 * A move's type after its user's ModifyType chain (PS/data/abilities.ts normalize from generation 7, then an -ate ability on
 * a Normal move or Liquid Voice on a sound move; their noModifyType moves kept): Conversion 2's reading of an earlier turn's move.
 */
function chainType(kernel: TurnKernel, build: BattleBuild, moveId: string): string {
  const move = kernel.runtime.movesById.get(moveId);
  let type = moveId.startsWith("hiddenpower") ? "Normal" : move?.type ?? "Normal";
  const ability = build.abilityId;
  const kept = ATE_KEPT.has(moveId) || moveId.startsWith("hiddenpower");
  if (ability === "normalize" && generation(kernel) >= 7 && !kept && moveId !== "struggle") type = "Normal";
  if (ATE_TYPES[ability] && type === "Normal" && !kept) type = ATE_TYPES[ability];
  const entry = statusEntry(moveId, kernel.runtime.profile.id as BattleGame);
  const sound = entry ? !!entry.flags.sound : !!Generations.get(kernel.runtime.profile.generation).moves.get(toID(move?.name ?? moveId) as never)?.flags?.sound;
  if (ability === "liquidvoice" && sound) type = "Water";
  return type;
}

/** pinned Showdown's type chart: whether `defending` resists or is immune to `attacking` (PS/data/typechart.ts damageTaken 2 or 3). */
function resists(kernel: TurnKernel, attacking: string, defending: string): boolean {
  const chart = Generations.get(kernel.runtime.profile.generation).types.get(toID(attacking) as never);
  const factor = (chart?.effectiveness as Record<string, number> | undefined)?.[defending];
  return factor !== undefined && factor < 1;
}

/**
 * Nightmare ends with the sleep (PS/sim/pokemon.ts cureStatus: removeVolatile('nightmare')): a Pokémon that is no longer asleep
 * (woke at its BeforeMove, cured by a Berry, Heal Bell, Worry Seed...) has none, so a later sleep in the turn does not bring it
 * back. Run at each use's start (comboGuard, retypeStatus) and at BeforeMove 2 (after the sleep check, priority 10).
 */
function nightmareSweep(w: World) {
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (mon?.eot.nightmare && mon.build.status !== "slp" && mon.build.abilityId !== "comatose") setEot(w, slot, { nightmare: undefined });
  }
}

/** The fail fact of a status move on `slot` ("{Move} fails: {reason}.") as doubles-status.ts writes it; the use goes on with `w`. */
function failed(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId, reason: string): World[] {
  hitFact(kernel, use, slot, `${use.move.name} fails: ${reason}.`, w);
  return [w];
}
/** An immunity (the step's "no damage" kind): `{Name} is immune.` or an ability's own text. */
function immuneFact(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId, text: string, blocked = false) {
  const stats = kernel.hitStats(use.action, slot);
  if (stats) { if (blocked) stats.blocked += w.mass; else stats.noDamage += w.mass; }
  hitFact(kernel, use, slot, text, w);
}
/** Why setType fails (setTypes false): Arceus and Silvally keep their types; a Terastallized Pokémon keeps its Tera type. */
const cannot = (kernel: TurnKernel, w: World, slot: DoublesSlotId) => (fixedTypes(w.mons[slot]!.build) ? `${kernel.names[slot]}'s type cannot change` : `${kernel.names[slot]} is Terastallized`);

/**
 * A queued Curse of `slot` it chose as a Pokémon that was not a Ghost type (its request's target: "self", the action's target
 * none), now that it is one (Trick-or-Treat, Color Change): pinned useMoveInner then aims it with no target location. Generation
 * 9 (and Champions): getRandomTarget, a random foe (PS/data/moves.ts:3276-3282, the ally rule: doubles-status.ts makeUse turns
 * a Ghost Curse aimed at its ally into randomNormal); generation 8: its target is randomNormal already (data/mods/gen8/moves.ts
 * curse); generation 7: target "normal" at location 0, a random foe (one world each, the action aimed there: a foe that
 * faints first leaves it to the other, as getRandomTarget would), or, with Trick-or-Treat's Curse glitch (`glitch`: its target
 * at Showdown position 1, PS/data/moves.ts:19928-19934 targetLoc −1), its ally at position 0. Null: not a world splitter (the
 * one world `w` changed in place); otherwise the worlds.
 */
function curseRetarget(kernel: TurnKernel, w: World, slot: DoublesSlotId, glitch: boolean): World[] | null {
  const queued = w.remaining.find((action) => action.slot === slot && action.moveId === "curse");
  if (!queued || queued.target !== null || kernel.input.pokemon[slot]?.contexts.curse?.useZ || !kernel.typesIn(w, slot).includes("Ghost")) return null;
  const aim = (world: World, target: DoublesSlotId) => { world.remaining = world.remaining.map((action) => (action === queued ? { ...action, target } : action)); };
  const gen = generation(kernel);
  if (gen === 8) return null;
  if (gen >= 9) { aim(w, allyOf(slot)); return null; }
  const position = kernel.positionOf(w, slot);
  if (glitch && SHOWDOWN_POSITION[position].position === 1) { aim(w, allyOf(position)); return null; }
  const foes = foesOf(slot).filter((foe) => kernel.alive(w, foe));
  if (!foes.length) { aim(w, foesOf(slot)[0]); return null; }
  return foes.map((foe) => {
    const world = foes.length > 1 ? cloneWorld(w, w.mass / foes.length) : w;
    aim(world, kernel.positionOf(world, foe));
    return world;
  });
}

// ------------------------------------------------------------------------------------------------------------------
// The type moves (F2 §3.1–§3.8)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Soak (PS/data/moves.ts:17196-17204) and Magic Powder (:10748-10751): the target becomes Water (Psychic) type alone, its
 * added type gone; it fails when its types already are that one type (getTypes(): the added type and a Tera type count) or
 * setType fails (Terastallized, Arceus, Silvally). The pipeline's TryHit (Water Absorb takes Soak; Overcoat, Safety Goggles and
 * a Grass type are immune to Magic Powder) and Magic Bounce come first.
 */
function setTypeMove(type: string): StatusHandler {
  return {
    onHit: (kernel, w, use, slot) => {
      if (kernel.typesIn(w, slot).join() === type) return failed(kernel, w, use, slot, `${kernel.names[slot]} is already ${type} type`);
      if (!setTypes(kernel, w, slot, [type])) return failed(kernel, w, use, slot, cannot(kernel, w, slot));
      hitFact(kernel, use, slot, `Becomes ${type} type.`, w);
      return [w];
    },
  };
}

/**
 * Forest's Curse (PS/data/moves.ts:6135-6139) and Trick-or-Treat (:19923-19934): the target's added type is Grass (Ghost),
 * replacing another added type; it fails when it already has the type (hasType) or is Terastallized (addType). Trick-or-Treat
 * then turns a queued Curse its target chose as a non-Ghost into the Ghost Curse (curseRetarget, with the generation 7 glitch).
 */
const addTypeMove: StatusHandler = {
  onHit: (kernel, w, use, slot) => {
    const type = use.move.id === "forestscurse" ? "Grass" : "Ghost";
    if (kernel.typesIn(w, slot).includes(type)) return failed(kernel, w, use, slot, `${kernel.names[slot]} is already ${type} type`);
    if (!addType(kernel, w, slot, type)) return failed(kernel, w, use, slot, `${kernel.names[slot]} is Terastallized`);
    hitFact(kernel, use, slot, `${type} type added.`, w);
    return (type === "Ghost" ? curseRetarget(kernel, w, slot, true) : null) ?? [w];
  },
};

/**
 * Reflect Type (PS/data/moves.ts:14893-14910), on the target with its effect on the user: the user fails as Arceus or Silvally
 * or Terastallized; its new base types are the target's getTypes(true) without ??? (a Terastallized target: its Tera type;
 * Roost's Type event applies), Normal when none is left but the target has an added type, else it fails; then the user's
 * added type is the target's.
 */
const reflectType: StatusHandler = {
  onHit: (kernel, w, use, slot) => {
    const user = use.user;
    if (fixedTypes(w.mons[user]!.build) || isTera(w.mons[user]!.build)) return failed(kernel, w, use, slot, cannot(kernel, w, user));
    const target = w.mons[slot]!.build;
    const added = teraTyped(target) ? undefined : target.addedType;
    let types = baseTypesIn(kernel, w, slot).filter((type) => type !== "???");
    if (!types.length) {
      if (!added) return failed(kernel, w, use, slot, `${kernel.names[slot]} has no type to copy`);
      types = ["Normal"];
    }
    setTypes(kernel, w, user, types);
    if (added) w.mons[user]!.build = { ...w.mons[user]!.build, addedType: added };
    hitFact(kernel, use, slot, `${kernel.names[user]} becomes ${kernel.typesIn(w, user).join("/")} type.`, w);
    return [w];
  },
};

/**
 * Conversion (PS/data/moves.ts:2804-2808): the user becomes the dex type of its first move slot (Hidden Power and Weather Ball
 * give Normal); it fails when it has that type (hasType) or setType fails. The first move is DoublesPokemonInput.moves[0]
 * (Training's move slots, the calculator's first quick move: the turn fact); absent: REASONS.needsFirstMove.
 */
const conversion: StatusHandler = {
  onHit: (kernel, w, use, slot) => {
    const moves = kernel.input.pokemon[slot]?.moves;
    if (!moves?.length) kernel.notEstimated(REASONS.needsFirstMove(kernel.names[slot]));
    const first = moves![0];
    kernel.turnFact(`Assumes ${kernel.moveName(first)} is ${kernel.names[slot]}'s first move.`);
    const type = first.startsWith("hiddenpower") ? "Normal" : kernel.runtime.movesById.get(first)?.type ?? "Normal";
    if (kernel.typesIn(w, slot).includes(type)) return failed(kernel, w, use, slot, `${kernel.names[slot]} is already ${type} type`);
    if (!setTypes(kernel, w, slot, [type])) return failed(kernel, w, use, slot, cannot(kernel, w, slot));
    hitFact(kernel, use, slot, `Becomes ${type} type.`, w);
    return [w];
  },
};

/**
 * The type of `slot`'s move as last used (Conversion 2's target.lastMoveUsed.type, PS/sim/battle-actions.ts:391, set as a use
 * starts, then typed by ModifyType): this turn's (vol.usedType, written at each use: comboGuard, retypeStatus; or the move that
 * passed its BeforeMove, vol.usedMove, typed by its user's chain), else the input's lastMove from before the turn (undefined:
 * REASONS.needsLastMove; a Z-Move, a Max Move or a move typed as it is used: REASONS.needsLastMoveType). Null: none.
 */
function lastUsedType(kernel: TurnKernel, w: World, user: Use, slot: DoublesSlotId): string | null {
  const mon = w.mons[slot]!;
  if (mon.vol.usedType) return mon.vol.usedType;
  if (mon.vol.usedMove) {
    const used = kernel.runtime.movesById.get(mon.vol.usedMove);
    if (!used || used.isZ || used.isMax || OWN_TYPE_MOVES.has(used.id)) kernel.notEstimated(REASONS.needsLastMoveType(user.move.name, kernel.names[slot]));
    return retyped(w, slot, used!.id, chainType(kernel, mon.build, used!.id));
  }
  const last = kernel.input.pokemon[slot]?.lastMove;
  if (last === undefined) kernel.notEstimated(REASONS.needsLastMove(user.move.name, kernel.names[slot]));
  if (last === null) return null;
  const move = kernel.runtime.movesById.get(last!);
  if (!move || move.isZ || move.isMax || OWN_TYPE_MOVES.has(last!) || last!.startsWith("hiddenpower")) kernel.notEstimated(REASONS.needsLastMoveType(user.move.name, kernel.names[slot]));
  return chainType(kernel, mon.build, last!);
}

/**
 * Conversion 2 (PS/data/moves.ts:2823-2843): the target's last move used (none: it fails); the standard types the user does
 * not have whose damage taken from that type is a resistance or an immunity; none: it fails; else one at random (this.sample:
 * one world each, 1/n), then setType (it fails while Terastallized).
 */
const conversion2: StatusHandler = {
  onHit: (kernel, w, use, slot) => {
    const user = use.user;
    const used = lastUsedType(kernel, w, use, slot);
    if (used === null) return failed(kernel, w, use, slot, `${kernel.names[slot]} has used no move`);
    const own = kernel.typesIn(w, user);
    const options = STANDARD_TYPES.filter((type) => !own.includes(type) && resists(kernel, used, type));
    if (!options.length) return failed(kernel, w, use, slot, `no type resists ${used} that ${kernel.names[user]} lacks`);
    if (fixedTypes(w.mons[user]!.build) || isTera(w.mons[user]!.build)) return failed(kernel, w, use, slot, cannot(kernel, w, user));
    return options.map((type, index) => {
      const world = options.length > 1 ? cloneWorld(w, w.mass / options.length) : w;
      void index;
      setTypes(kernel, world, user, [type]);
      hitFact(kernel, use, slot, `${kernel.names[user]} becomes ${type} type.`, world);
      return world;
    });
  },
};

/**
 * Camouflage (USUM; PS/data/moves.ts:2164-2178): Electric, Grass, Fairy or Psychic on its terrain, else Normal; it fails when
 * the user's types already are that one type or setType fails.
 */
const camouflage: StatusHandler = {
  onHit: (kernel, w, use, slot) => {
    const TERRAIN: Record<string, string> = { Electric: "Electric", Grassy: "Grass", Misty: "Fairy", Psychic: "Psychic" };
    const type = TERRAIN[w.field.terrain ?? ""] ?? "Normal";
    if (kernel.typesIn(w, slot).join() === type) return failed(kernel, w, use, slot, `${kernel.names[slot]} is already ${type} type`);
    if (!setTypes(kernel, w, slot, [type])) return failed(kernel, w, use, slot, cannot(kernel, w, slot));
    hitFact(kernel, use, slot, `Becomes ${type} type.`, w);
    return [w];
  },
};

// ------------------------------------------------------------------------------------------------------------------
// The volatile moves (F2 §3.9–§3.21): each `volatile` is the condition's addVolatile (an existing one without onRestart fails
// it; PS/sim/pokemon.ts addVolatile), TryAddVolatile (Aroma Veil), then its onStart.
// ------------------------------------------------------------------------------------------------------------------

/** "{Move} fails: it is already up on {Name}." (addVolatile on a volatile it has, no onRestart). */
const already = (kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId) => { failed(kernel, w, use, slot, `it is already up on ${kernel.names[slot]}`); return false; };
/** Aroma Veil on the target's side (PS/data/abilities.ts aromaveil onAllyTryAddVolatile: attract, disable, encore, healblock, taunt, torment; breakable). */
function aromaVeiled(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): boolean {
  return DOUBLES_SLOTS.some((holder) => slotSide(holder) === slotSide(slot) && kernel.alive(w, holder) && holder !== w.ghost
    && w.mons[holder]!.build.abilityId === "aromaveil" && !breaks(kernel, w, use, holder));
}

/**
 * Electrify (PS/data/moves.ts:4566-4583): onTryHit fails on a target with no move queued that has been in since an earlier turn
 * (a Pokémon that switched in this turn has activeTurns 0 and does not fail it; No move is a queued move); for this turn every
 * move of the target but Struggle is Electric (MoveContext.retype for its damaging moves, retypeStatus for its status moves).
 * A Substitute stops it; Volt Absorb, Motor Drive and Lightning Rod take it (the pipeline's TryHit, by its own type).
 */
const electrify: StatusHandler = {
  tryHit: (kernel, w, use, slot) => {
    const queued = w.remaining.some((action) => action.slot === slot);
    return !queued && !kernel.input.pokemon[slot]?.switchedIn ? `${kernel.names[slot]} has already moved` : null;
  },
  volatile: (kernel, w, use, slot) => {
    if (w.mons[slot]!.vol.electrify) return already(kernel, w, use, slot);
    setVol(w, slot, { electrify: true });
    hitFact(kernel, use, slot, "Electrify: its move is Electric type this turn.", w);
    return true;
  },
};

/**
 * Ion Deluge (USUM; PS/data/moves.ts:9685-9700): a pseudo-weather for this turn (addPseudoWeather fails while it is up): every
 * move whose type after its user's ModifyType chain is Normal becomes Electric (contextFor's retype, retypeStatus).
 */
const ionDeluge: StatusHandler = {
  sideOrField: (kernel, w, use) => {
    if (w.field.ionDeluge) { kernel.stepFact(use.action, `${use.move.name} fails: ${use.move.name} is already up.`, w.mass); return [w]; }
    w.field = { ...w.field, ionDeluge: true };
    kernel.stepFact(use.action, `${use.move.name}: Normal moves are Electric type this turn.`, w.mass);
    return [w];
  },
};

/**
 * Tar Shot (SV, SwSh; PS/data/moves.ts:18954-18974): its Speed −1 first (the pipeline's boosts), then the volatile, which a
 * Terastallized target refuses (onStart false); Fire then gets +1 effectiveness on the target's first type (calcBuild's tarShot,
 * Step 0b's scope). A second Tar Shot adds nothing (no onRestart; its Speed drop made the move a success).
 */
const tarShot: StatusHandler = {
  volatile: (kernel, w, use, slot) => {
    const mon = w.mons[slot]!;
    if (mon.vol.tarShot || mon.fainted) return false;
    if (isTera(mon.build)) { failed(kernel, w, use, slot, `${kernel.names[slot]} is Terastallized`); return false; }
    setVol(w, slot, { tarShot: true });
    hitFact(kernel, use, slot, "Tar Shot: Fire is twice as effective against it.", w);
    return true;
  },
};

/**
 * Foresight and Odor Sleuth (USUM; PS/data/moves.ts:6102-6120, 13005-13013), Miracle Eye (:11960-11978): each fails on a target
 * under the other (onTryHit); the volatile lets Normal and Fighting moves hit a Ghost type (Psychic a Dark type) at 1 on that
 * type (calcBuild's revealed: the engine's isForesight, Step 0b's Miracle Eye scope). Positive evasion is ignored, but every
 * move hits in the turn.
 */
function revealMove(kind: "foresight" | "miracleeye"): StatusHandler {
  const other = kind === "foresight" ? "miracleeye" : "foresight";
  return {
    tryHit: (kernel, w, use, slot) => (w.mons[slot]!.vol.revealed === other ? `${kernel.names[slot]} is under ${kernel.moveName(other)}` : null),
    volatile: (kernel, w, use, slot) => {
      if (w.mons[slot]!.vol.revealed === kind) return already(kernel, w, use, slot);
      setVol(w, slot, { revealed: kind });
      hitFact(kernel, use, slot, kind === "foresight" ? `${use.move.name}: Normal and Fighting moves can hit it.` : `${use.move.name}: Psychic moves can hit it.`, w);
      return true;
    },
  };
}

/**
 * Telekinesis (USUM; PS/data/moves.ts:19124-19162): Gravity stops it at BeforeMove (its gravity flag); onStart: Diglett,
 * Dugtrio, Sandygast, Palossand and Mega Gengar are immune, a Smack Down or Ingrain target fails it; 3 turns (eot.telekinesis,
 * ended at residual 19 by the end of turn); it lifts its target (the kernel's grounded, calcBuild's floating marker).
 */
const telekinesis: StatusHandler = {
  volatile: (kernel, w, use, slot) => {
    const mon = w.mons[slot]!;
    if (mon.eot.telekinesis !== undefined) return already(kernel, w, use, slot);
    const species = kernel.runtime.speciesById.get(mon.build.speciesId);
    if (TELEKINESIS_IMMUNE.has(species?.baseSpecies ?? "") || mon.build.speciesId === "gengarmega") {
      immuneFact(kernel, w, use, slot, `${kernel.names[slot]} is immune.`);
      return false;
    }
    if (mon.eot.smackedDown || mon.eot.ingrain) { failed(kernel, w, use, slot, `${kernel.names[slot]} is held to the ground`); return false; }
    setEot(w, slot, { telekinesis: 3 });
    hitFact(kernel, use, slot, `${use.move.name}: ${kernel.names[slot]} floats.`, w);
    return true;
  },
};

/**
 * Embargo (USUM; PS/data/moves.ts:4689-4702): 5 turns (eot.embargo, ended at residual 21); its item has no effect
 * (PS/sim/pokemon.ts ignoringItem: build.itemSuppressed, which itemWorks and the calculation read; it can still be taken, Knock
 * Off keeps its 1.5x). onStart runs the item's End, which no USUM item has.
 */
const embargo: StatusHandler = {
  volatile: (kernel, w, use, slot) => {
    const mon = w.mons[slot]!;
    if (mon.eot.embargo !== undefined) return already(kernel, w, use, slot);
    setEot(w, slot, { embargo: 5 });
    mon.build = { ...mon.build, itemSuppressed: true };
    hitFact(kernel, use, slot, `${use.move.name}: its item has no effect.`, w);
    return true;
  },
};

/**
 * Heal Block (USUM; PS/data/moves.ts:8283-8344, allAdjacentFoes): one already up fails on that target (onRestart); Aroma Veil
 * on its side blocks it; 5 turns (eot.healBlockLeft, ended at residual 20); BeforeMove 6 stops its heal-flag moves, TryHeal
 * fails every heal (the kernel's stand-ins in later steps, C14); Mental Herb cures it at the Update (doubles-status.ts updateAll).
 */
const healBlock: StatusHandler = {
  volatile: (kernel, w, use, slot) => {
    const mon = w.mons[slot]!;
    if (mon.eot.healBlock) return already(kernel, w, use, slot);
    if (aromaVeiled(kernel, w, use, slot)) { hitFact(kernel, use, slot, `${kernel.abilityName("aromaveil")}: ${kernel.names[slot]} is not affected.`, w); return false; }
    setEot(w, slot, { healBlock: true, healBlockLeft: 5 });
    hitFact(kernel, use, slot, `${use.move.name}: it cannot heal.`, w);
    return true;
  },
};

/**
 * Nightmare (USUM; PS/data/moves.ts:12706-12724): onStart fails unless the target is asleep or has Comatose; a quarter of its
 * base maximum HP at residual 11 (the end of turn's); it ends with the sleep (nightmareSweep).
 */
const nightmare: StatusHandler = {
  volatile: (kernel, w, use, slot) => {
    const mon = w.mons[slot]!;
    if (mon.eot.nightmare) return already(kernel, w, use, slot);
    if (mon.build.status !== "slp" && mon.build.abilityId !== "comatose") { failed(kernel, w, use, slot, `${kernel.names[slot]} is awake`); return false; }
    setEot(w, slot, { nightmare: true });
    hitFact(kernel, use, slot, `${use.move.name} starts.`, w);
    return true;
  },
};

/**
 * Octolock (Champions, SwSh; PS/data/moves.ts:12970-12995): a Ghost type is immune (onTryImmunity: getImmunity('trapped'), its
 * added type included); one already up fails; its source is the user (eot.octolock): Defense and Sp. Def −1 at residual 14 (the
 * end of turn's), ended silently once its source is gone.
 */
const octolock: StatusHandler = {
  tryImmunity: (kernel, w, use, slot) => {
    if (!kernel.typesIn(w, slot).includes("Ghost")) return null;
    immuneFact(kernel, w, use, slot, `${kernel.names[slot]} is immune.`);
    return false;
  },
  volatile: (kernel, w, use, slot) => {
    if (w.mons[slot]!.eot.octolock) return already(kernel, w, use, slot);
    setEot(w, slot, { octolock: use.user });
    hitFact(kernel, use, slot, `${use.move.name} starts.`, w);
    return true;
  },
};

/**
 * Attract and Captivate's TryHit and TryImmunity (PS/sim/battle-actions.ts hitStepTryHitEvent, then hitStepTryImmunity): the
 * target's Oblivious (PS/data/abilities.ts:3024-3029 onTryHit, breakable), then opposite genders only (PS/data/moves.ts:754-756,
 * 2194-2196: genderless or the same gender is immune). A species of both genders with none set: REASONS.needsGender
 * (USER-DECISIONS Q10). Null: it passes (today's checks follow: Prankster against a Dark foe).
 */
function genderImmunity(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): boolean | null {
  const target = w.mons[slot]!.build;
  if (target.abilityId === "oblivious" && !breaks(kernel, w, use, slot)) {
    immuneFact(kernel, w, use, slot, `${kernel.abilityName("oblivious")}: ${kernel.names[slot]} is not affected.`, true);
    return false;
  }
  const theirs = getBuildGender(target, kernel.runtime), own = getBuildGender(w.mons[use.user]!.build, kernel.runtime);
  if (theirs !== "N" && own !== "N") {
    if (!theirs) kernel.notEstimated(REASONS.needsGender(use.move.name, kernel.names[slot]));
    if (!own) kernel.notEstimated(REASONS.needsGender(use.move.name, kernel.names[use.user]));
    if (theirs !== own) return null;
  }
  immuneFact(kernel, w, use, slot, `${kernel.names[slot]} is immune.`);
  return false;
}

/**
 * Attract (PS/data/moves.ts:714-760): Oblivious and the genders (genderImmunity); one already up fails; Aroma Veil on the target's
 * side blocks it; then the Attract event: the target's Destiny Knot infatuates the user back (PS/data/items.ts:1396-1401) unless
 * the user has one already, its Oblivious (onImmunity 'attract') or its side's Aroma Veil stops it. The infatuation's source is
 * the user (vol.attract): 1/2 at each BeforeMove of the target (beforeAttract), ended at the Update after its source left.
 */
const attract: StatusHandler = {
  tryImmunity: genderImmunity,
  volatile: (kernel, w, use, slot) => {
    const mon = w.mons[slot]!;
    if (mon.vol.attract) { failed(kernel, w, use, slot, `${kernel.names[slot]} is already infatuated`); return false; }
    if (aromaVeiled(kernel, w, use, slot)) { hitFact(kernel, use, slot, `${kernel.abilityName("aromaveil")}: ${kernel.names[slot]} is not affected.`, w); return false; }
    setVol(w, slot, { attract: use.user });
    hitFact(kernel, use, slot, "Becomes infatuated.", w);
    const user = w.mons[use.user]!;
    const knot = mon.build.itemId === "destinyknot" && kernel.itemWorks(w, mon.build);
    if (knot && kernel.alive(w, use.user) && use.user !== slot && !user.vol.attract && user.build.abilityId !== "oblivious" && !aromaVeiled(kernel, w, use, use.user)) {
      setVol(w, use.user, { attract: slot });
      hitFact(kernel, use, slot, `${kernel.itemName("destinyknot")}: ${kernel.names[use.user]} becomes infatuated too.`, w);
    }
    return true;
  },
};

/** Captivate (USUM; PS/data/moves.ts:2184-2203): Oblivious and the genders (genderImmunity), then Sp. Atk −2 (the pipeline's boosts). */
const captivate: StatusHandler = { tryImmunity: genderImmunity };

/**
 * Powder (USUM; PS/data/moves.ts:13669-13689): one already up fails; for this turn the target's Fire move fails at TryMove
 * priority −1 and costs it a quarter of its maximum HP (powderTryMove). Its powder flag: a Grass type, Overcoat and Safety
 * Goggles are immune (the pipeline's TryHit and TryImmunity).
 */
const powder: StatusHandler = {
  volatile: (kernel, w, use, slot) => {
    if (w.mons[slot]!.vol.powder) return already(kernel, w, use, slot);
    setVol(w, slot, { powder: true });
    hitFact(kernel, use, slot, `${use.move.name}: its Fire move fails this turn.`, w);
    return true;
  },
};

/** A2's status-move handlers by the status table's `handler` key (doubles-status.ts dispatches to them). */
export const HANDLERS: Readonly<Record<string, StatusHandler>> = {
  soak: setTypeMove("Water"), magicPowder: setTypeMove("Psychic"), addType: addTypeMove, reflectType, conversion, conversion2, camouflage,
  electrify, ionDeluge, tarShot, foresight: revealMove("foresight"), miracleEye: revealMove("miracleeye"), telekinesis, embargo, healBlock,
  nightmare, octolock, attract, captivate, powder,
};

// ------------------------------------------------------------------------------------------------------------------
// The hooks (SPEC2 §3.5's table; STEP0A.md has the call sites)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Protean and Libero (PS/data/abilities.ts:3497-3512, 2318-2333; generation 7 and 8: data/mods/gen8/abilities.ts:556-567,
 * 776-787) at PrepareHit (the move about to hit: after its Try): the user becomes its move's type as used (`type`: after
 * ModifyType; Electrify and Ion Deluge applied here, retyped), unless the move is a future move or calls another, or the use
 * is a bounced one (the callers skip it) or a snatched one (move.sourceEffect 'snatch': a Snatch user using a move it did not
 * choose, A2-SN1; A3's I4 also skips it at the callers once useCalled carries `snatched`), the type is ??? or already its
 * only one (getTypes().join()), or setType fails (a Terastallized user). Generation 9 and Champions: once per entry
 * (effectState.protean, set only by a change): the build's abilityActive (the app's "unused since switch-in") goes false.
 */
export function proteanGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId, moveId: string, type: () => string) {
  const mon = w.mons[slot]!;
  const build = mon.build;
  if (build.abilityId !== "protean" && build.abilityId !== "libero") return;
  const once = generation(kernel) >= 9;
  if (once && !build.abilityActive) return;
  // status2 CL-7: pinned callsMove (CALLS_MOVE): Instruct is none, so Protean acts on it.
  if (FUTURE_MOVES.has(moveId) || CALLS_MOVE.has(moveId)) return;
  if (kernel.input.pokemon[slot]?.action.moveId === "snatch" && moveId !== "snatch") return;
  const used = retyped(w, slot, moveId, type());
  if (!used || used === "???" || kernel.typesIn(w, slot).join() === used) return;
  if (!setTypes(kernel, w, slot, [used])) return;
  if (once) mon.build = { ...mon.build, abilityActive: false };
}

/** Roost (PS/data/moves.ts roost condition, :15442-15459): no Flying type this turn (typesIn and calcBuild fold eot.roosted), unless Terastallized (its onStart fails). */
export function roost(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId) {
  void kernel; void use;
  if (w.mons[slot]!.build.mechanic === "tera") return;
  setEot(w, slot, { roosted: true });
}

/** Ingrain's grounding (PS/sim/pokemon.ts isGrounded): the kernel's grounded and calcBuild's pinned marker follow it (status2 C11: the guard is gone). */
export function ingrainGuard(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId, grounded: boolean) {
  void kernel; void w; void use; void slot; void grounded;
}

/** Magnet Rise's lift (PS/sim/pokemon.ts isGrounded): the kernel's grounded and calcBuild's floating marker follow it (status2 C11: the guard is gone). */
export function magnetRiseGuard(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId, grounded: boolean) {
  void kernel; void w; void use; void slot; void grounded;
}

/**
 * A Lightning Rod or Storm Drain holder reads a status move's type as used, while the kernel's redirection of a status move reads
 * its calculation's type, the move's own (doubles-turn.ts redirection): where a type-changing ability (an -ate ability,
 * Normalize, Liquid Voice) or Electrify or Ion Deluge made them differ and a holder could take either, not followed (`{Ability}
 * is not modelled in 2v2.`; `{Move} with Electrify is not modelled in 2v2.`). It goes once targetsOf passes the use's type to
 * the redirection (needsFromIntegrator).
 */
export function ateRedirectGuard(kernel: TurnKernel, w: World, use: Use) {
  if (use.type === use.move.type) return;
  for (const slot of DOUBLES_SLOTS) {
    const holder = w.mons[slot];
    if (slot === use.user || !holder || !kernel.alive(w, slot)) continue;
    const type = REDIRECT_ABILITIES[holder.build.abilityId];
    if (!type || (type !== use.type && type !== use.move.type)) continue;
    const user = w.mons[use.user]!;
    if (user.vol.electrify && use.move.id !== "struggle") kernel.notEstimated(REASONS.combo(use.move.name, kernel.moveName("electrify")));
    if (w.field.ionDeluge && use.type === "Electric" && modifiedStatusType(kernel, w, use.user, use.move, use.entry) === "Normal") kernel.notEstimated(REASONS.combo(use.move.name, kernel.moveName("iondeluge")));
    kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName(user.build.abilityId)));
  }
}

/**
 * Smack Down and Thousand Arrows (PS/data/moves.ts:16965-16994 smackdown condition onStart; the step's smackedDown when the hit
 * met a target that was not grounded): the target is grounded (eot.smackedDown: the kernel's grounded, calcBuild's pinned
 * marker), its Magnet Rise and Telekinesis end, and a Fly or Bounce user lands (H's land). A Fly or Bounce user the hit
 * reached lands too where it was on the ground already (an Iron Ball, not Flying type: the step's smackedDown is false), since
 * the condition's onStart removes the fly or bounce volatile before it reads the grounding (`applies`; status2 integration 1b,
 * in place of H's guard).
 */
export function groundingAfterHit(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo) {
  void action;
  if (!kernel.alive(w, target)) return;
  const hidden = w.mons[target]!.eot.hidden;
  const lands = outcome.landed > 0 && !info.transformed && (info.effective.id === "smackdown" || info.effective.id === "thousandarrows") && (hidden === "fly" || hidden === "bounce");
  if (!outcome.target.smackedDown && !lands) return;
  setEot(w, target, { smackedDown: true, magnetRise: undefined, telekinesis: undefined });
  hiddenHooks.land(kernel, w, target);
}

/**
 * Gravity starting (PS/data/moves.ts:7774-7807 onFieldStart): every active Pokémon's Magnet Rise and Telekinesis end (A3's
 * fieldMove calls it for each, beside H's land for the hidden ones).
 */
export function gravityGrounds(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  void kernel;
  const mon = w.mons[slot];
  if (mon && (mon.eot.magnetRise || mon.eot.telekinesis !== undefined)) setEot(w, slot, { magnetRise: undefined, telekinesis: undefined });
}

/**
 * After a hit (doubles-turn.ts afterHit, residualReactions): Burn Up and Double Shock (PS/data/moves.ts:2108-2113, 3961-3966
 * self.onHit) set their user's types to getTypes(true) with Fire (Electric) as ??? once a hit of its own move landed, a
 * Substitute's included (`ownAny`), unless it fainted or is Terastallized (setType); then Color Change on the target.
 */
export function afterHit(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo, ownAny: boolean) {
  const id = action.moveId!;
  const user = w.mons[action.slot]!;
  if (TYPE_LOSS_MOVES.has(id) && ownAny && !user.fainted && !isTera(user.build)) {
    const lost = id === "burnup" ? "Fire" : "Electric";
    const types = baseTypesIn(kernel, w, action.slot).map((type) => (type === lost ? "???" : type));
    if (setTypes(kernel, w, action.slot, types)) kernel.stepFact(action, `${kernel.moveName(id)}: ${kernel.names[action.slot]} becomes ${kernel.typesIn(w, action.slot).join("/")} type.`, w.mass);
  }
  colorChange(kernel, w, action, target, outcome, info);
}

/**
 * Color Change (status2 Step 1 #3; PS/data/abilities.ts colorchange onAfterMoveSecondary): a damaging move that reached the
 * holder (a hit on the Pokémon, not its Substitute: sim/battle-actions.ts:1005 afterMoveSecondaryEvent over the damaged
 * targets) makes it the move's type as used (Electrify and Ion Deluge included), when it still has HP, the type is not "???"
 * and it is not of that type already (hasType); none after a Sheer Force move with secondaries (no AfterMoveSecondary:
 * sim/battle-actions.ts:811-816); setType fails while Terastallized (setTypes). A queued Curse it chose as a non-Ghost becomes
 * the Ghost Curse (curseRetarget); generation 7's random foe for it, which needs one world per foe here, is not followed.
 */
function colorChange(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo) {
  const holder = w.mons[target]!;
  if (holder.build.abilityId !== "colorchange" || outcome.landed <= 0 || !kernel.alive(w, target) || target === action.slot) return;
  if (info.effective.category === "Status") return;
  // Integration 1b: a residual hit whose source is not in battle (action.userless) has the move's own type: the landing runs
  // no ModifyType (data/conditions.ts futuremove onEnd), and the Normalize it reads is an active source's.
  const user = action.userless ? null : w.mons[action.slot]!.build;
  if (user?.abilityId === "sheerforce" && info.secondaries) return;
  const type = !user ? info.effective.type
    : retyped(w, action.slot, action.moveId!, kernel.usedType(w, action.slot, action.moveId!, target, info, kernel.input.pokemon[action.slot]?.contexts[action.moveId!]));
  const before = kernel.typesIn(w, target);
  if (!type || type === "???" || before.includes(type)) return;
  if (!setTypes(kernel, w, target, [type])) return;
  if (!before.includes("Ghost") && type === "Ghost" && generation(kernel) === 7 && w.remaining.some((each) => each.slot === target && each.moveId === "curse" && each.target === null)) {
    kernel.notEstimated(REASONS.combo(kernel.moveName("curse"), kernel.abilityName("colorchange")));
  }
  curseRetarget(kernel, w, target, false);
  kernel.hitFact(action, target, `${kernel.abilityName("colorchange")}: ${kernel.names[target]} becomes ${type} type.`, w.mass);
}

/**
 * The HP Berry `target` keeps through Psychic Noise's hit, or null (status-eot ER21c). Its 100% secondary Heal Block
 * (secondaryLands; Aroma Veil on the target's side stops it, data/abilities.ts aromaveil) comes before the hit's Update
 * (sim/battle-actions.ts hitStepMoveHitLoop: spreadMoveHit, then eachEvent('Update')), where an HP Berry's onTryEatItem
 * TryHeal then fails (data/items.ts): Sitrus, Oran, Berry Juice and the Figy family stay held and heal nothing. Enigma
 * Berry is eaten in the hit's Hit event, before the secondary. doubles-eot.ts afterHit then sets the Heal Block.
 * (doubles-turn.ts psychicNoiseKeepsBerry, moved verbatim.)
 */
export function psychicNoiseKeepsBerry(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: TurnMoveInfo): string | null {
  if (info.transformed || info.effective.id !== "psychicnoise" || attacker === target) return null;
  const receiver = w.mons[target]!;
  const item = receiver.build.itemId;
  if (!HEALING_BERRIES.has(item) || item === "enigmaberry" || !kernel.itemWorks(w, receiver.build) || receiver.eot.healBlock) return null;
  if (!kernel.secondaryLands(w, attacker, target, info)) return null;
  const veiled = [target, allyOf(target)].some((slot) => kernel.alive(w, slot) && w.mons[slot]!.build.abilityId === "aromaveil" && !kernel.breaks(w, attacker, slot, info));
  return veiled ? null : item;
}

/**
 * Psychic Noise's Heal Block in later moves (status2 C14, F2 §2.6): the kernel's heal-block stand-ins read eot.healBlock in every
 * later step (an HP Berry and Shell Bell read as Leftovers, an absorbing ability heals nothing, Cheek Pouch none, BeforeMove 6
 * stops a heal-flag move), so the guard is gone.
 */
export function psychicNoiseGuard(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo) {
  void kernel; void w; void action; void target; void info;
}

/**
 * BeforeMove priority 2 (PS/data/moves.ts:742-749 attract condition; after confusion, before paralysis; the kernel skips it for
 * No move): an infatuated Pokémon whose source has left (fainted: its onUpdate ended it at the Update after) moves on; otherwise
 * it is stopped with randomChance(1, 2): one world each. Also Nightmare's end with a sleep that ended at this BeforeMove's sleep
 * check (nightmareSweep). A Gate, or null for `w` going on unchanged.
 */
export function beforeAttract(kernel: TurnKernel, w: World, action: PendingAction): Gate | null {
  nightmareSweep(w);
  const mon = w.mons[action.slot]!;
  const source = mon.vol.attract;
  if (!source) return null;
  if (!kernel.alive(w, source)) { setVol(w, action.slot, { attract: undefined }); return null; }
  const stopped = cloneWorld(w, w.mass / 2);
  w.mass /= 2;
  kernel.skipFact(action, "Infatuated.", stopped.mass);
  return { go: [w], stopped: [stopped] };
}

/**
 * TryMove priority −1 (PS/data/moves.ts:13676-13684 powder condition; after Heavy Rain's and Desolate Land's priority 1, Damp,
 * the priority shields): a Powder user whose move as used is Fire type (Electrify and Ion Deluge applied: retyped) fails it and
 * takes clampIntRange(round(maxhp / 4), 1) (none with Magic Guard; its Berry at the action's Update). A damaging Fire move in
 * Heavy Rain fails on the rain first, and Burn Up from a user that is not a Fire type on its own onTryMove: no loss. The worlds
 * after its loss (the move failed), or null.
 */
export function powderTryMove(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, type: () => string): World[] | null {
  const slot = action.slot;
  const mon = w.mons[slot]!;
  if (!mon.vol.powder || !kernel.alive(w, slot)) return null;
  if (retyped(w, slot, move.id, type()) !== "Fire") return null;
  const status = move.category === "Status" && !kernel.input.pokemon[slot]?.contexts[move.id]?.useZ;
  if (!status && kernel.effectiveWeather(w) === "Heavy Rain") return null;
  if (move.id === "burnup" && !kernel.typesIn(w, slot).includes("Fire")) return null;
  kernel.stepFact(action, `${kernel.moveName("powder")}: ${move.name} fails.`, w.mass);
  if (mon.build.abilityId === "magicguard") return [w];
  const loss = Math.max(1, Math.round(kernel.hp[slot].maxHP / 4));
  kernel.lossFact(slot, `${kernel.names[slot]} loses ${loss} HP (${kernel.moveName("powder")}).`, w.mass);
  return kernel.afterLoss(w, slot, loss);
}

/** A status move's type after its user's ModifyType chain (doubles-status.ts modifiedType, the same rules). */
function modifiedStatusType(kernel: TurnKernel, w: World, user: DoublesSlotId, move: ChampionsMove, entry: StatusEntry): string {
  const build = w.mons[user]!.build;
  const ability = build.abilityId;
  if (ability === "normalize" && generation(kernel) >= 7) return "Normal";
  if (ability === "liquidvoice" && entry.flags.sound && !isMaxActive(build)) return "Water";
  if (move.type === "Normal" && ATE_TYPES[ability]) return ATE_TYPES[ability];
  return move.type;
}

/**
 * A status move's type as used (doubles-status.ts statusType's last step, at each use's start): Electrify on its user (but
 * Struggle) or Ion Deluge on a Normal one makes it Electric (PS/data/moves.ts:4576-4582, 9693-9699), which the absorbing
 * abilities, Protean and Conversion 2 read. Its use is the user's last move used this turn (vol.usedType, only with a
 * Conversion 2 user in the turn; a bounced or snatched use is its new user's: useMove). Nightmare's end (nightmareSweep).
 */
export function retypeStatus(kernel: TurnKernel, w: World, user: DoublesSlotId, move: ChampionsMove, entry: StatusEntry, type: string): string {
  void entry;
  nightmareSweep(w);
  const used = retyped(w, user, move.id, type);
  if (readsUsedType(kernel) && w.mons[user]) setVol(w, user, { usedType: used });
  return used;
}

/**
 * A damaging move's use starts (doubles-turn.ts damagingMove, right after moveInfo): its user's last move used this turn
 * (vol.usedType, only with a Conversion 2 user in the turn: a Z-Move's base move keeps its dex type, PS/sim/battle-actions.ts:390-
 * 398, but Z-Weather Ball; a Max Move's base move is typed first, :399-403), Nightmare's end (nightmareSweep), and the
 * combinations the turn does not follow (REASONS.combo): Synchronoise from a user with two types and an added one (the engine
 * compares only its first two: gen789.js Synchronoise), Natural Gift under Embargo (its item ignored) or Heal Block (the step's
 * stand-in would change its Berry), and Electrify or Ion Deluge while the kernel's own type reads (redirection, the absorbing
 * abilities, a frozen target's thaw, a Z-Move's or Max Move's name) do not see the retype yet.
 */
export function comboGuard(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, info: TurnMoveInfo) {
  nightmareSweep(w);
  const slot = action.slot;
  const mon = w.mons[slot]!;
  const context = kernel.input.pokemon[slot]?.contexts[move.id];
  const aimed = DOUBLES_SLOTS.find((each) => each === action.target && !!w.mons[each]) ?? DOUBLES_SLOTS.find((each) => each !== slot && !!w.mons[each]) ?? slot;
  const kernelType = () => kernel.usedType(w, slot, move.id, aimed, info, context);
  if (readsUsedType(kernel)) {
    // A Z-Move's base move is typed only by its own ModifyType, and only for Weather Ball (no Electrify, no ability).
    const type = info.isZ ? (move.id === "weatherball" ? kernelType() : move.type) : retyped(w, slot, move.id, kernelType());
    setVol(w, slot, { usedType: type });
  }
  if (!info.transformed && move.id === "synchronoise" && (mon.build.types ?? kernel.runtime.speciesById.get(mon.build.speciesId)?.types ?? []).length >= 2 && mon.build.addedType && !isTera(mon.build)) {
    kernel.notEstimated(REASONS.combo(move.name, "an added type"));
  }
  if (!info.transformed && move.id === "naturalgift") {
    if (mon.build.itemSuppressed) kernel.notEstimated(REASONS.combo(move.name, kernel.moveName("embargo")));
    if (mon.eot.healBlock && HEALING_BERRIES.has(mon.build.itemId)) kernel.notEstimated(REASONS.combo(move.name, kernel.moveName("healblock")));
  }
  const retype = mon.vol.electrify && move.id !== "struggle" ? "electrify" : w.field.ionDeluge ? "iondeluge" : null;
  if (retype) {
    const before = kernelType(), after = retyped(w, slot, move.id, before);
    if (after !== before && kernelReadsType(kernel, w, slot, info, [before, after])) kernel.notEstimated(REASONS.combo(info.effective.name, kernel.moveName(retype)));
  }
}

/**
 * Whether the kernel's own reads of a damaging move's type as used (doubles-turn.ts usedType: from the calculation, without
 * MoveContext.retype) can meet this use in a way the retype changes (comboGuard): a Z-Move's or Max Move's name and effects,
 * another Pokémon's absorbing or redirecting ability of either type, a frozen Pokémon's thaw by a Fire move.
 */
function kernelReadsType(kernel: TurnKernel, w: World, user: DoublesSlotId, info: TurnMoveInfo, types: string[]): boolean {
  if (info.transformed) return true;
  return DOUBLES_SLOTS.some((slot) => {
    const mon = w.mons[slot];
    if (slot === user || !mon || !kernel.alive(w, slot)) return false;
    const absorbs = ABSORBING[mon.build.abilityId]?.type ?? REDIRECT_ABILITIES[mon.build.abilityId];
    return (!!absorbs && types.includes(absorbs)) || (mon.build.status === "frz" && types.includes("Fire"));
  });
}

// ------------------------------------------------------------------------------------------------------------------
// The card's conditions and E2's volatiles (needsFromIntegrator: doubles-turn.ts conditionFacts and outcomeOf call them)
// ------------------------------------------------------------------------------------------------------------------

/** An infatuation or Octolock whose source is still in (Attract's onUpdate; Octolock's residual ends it silently once its source left). */
const sourceIn = (kernel: TurnKernel, w: World, source: DoublesSlotId | undefined) => !!source && kernel.alive(w, source);
const asleep = (build: BattleBuild) => build.status === "slp" || build.abilityId === "comatose";

/**
 * A2's condition facts on `slot` in one world (DoublesHP.conditions, SPEC2 §5.1): its types when they differ from its species'
 * (not a Tera type: the card shows Tera), infatuation, Tar Shot, Foresight or Miracle Eye, Telekinesis, Embargo, Nightmare and
 * Octolock, each while it holds.
 */
export function conditions(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  const mon = w.mons[slot];
  if (!mon || mon.fainted) return [];
  const out: string[] = [];
  const species = kernel.runtime.speciesById.get(mon.build.speciesId)?.types ?? [];
  const types = kernel.typesIn(w, slot);
  if (!isTera(mon.build) && types.join() !== species.join()) out.push(`Type: ${types.join("/")}.`);
  if (sourceIn(kernel, w, mon.vol.attract)) out.push("Infatuated.");
  if (mon.vol.tarShot) out.push("Tar Shot.");
  if (mon.vol.revealed) out.push(mon.vol.revealed === "foresight" ? "Foresight." : "Miracle Eye.");
  if (mon.eot.telekinesis !== undefined) out.push("Telekinesis.");
  if (mon.eot.embargo !== undefined) out.push("Embargo.");
  if (mon.eot.nightmare && asleep(mon.build)) out.push("Nightmare.");
  if (sourceIn(kernel, w, mon.eot.octolock)) out.push("Octolock.");
  return out;
}

/**
 * A2's volatiles of an E2 outcome Pokémon the next turn reads (SPEC2 §3.1): attract (its source still in), tarshot, foresight
 * or miracleeye, telekinesis, embargo, nightmare (while asleep), octolock (its source still in). healblock is the end of turn's
 * (doubles-eot.ts outcomeMon); electrify and powder last this turn only.
 */
export function outcomeVolatiles(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  const mon = w.mons[slot];
  if (!mon || mon.fainted) return [];
  return [
    ...(sourceIn(kernel, w, mon.vol.attract) ? ["attract"] : []), ...(mon.vol.tarShot ? ["tarshot"] : []), ...(mon.vol.revealed ? [mon.vol.revealed] : []),
    ...(mon.eot.telekinesis !== undefined ? ["telekinesis"] : []), ...(mon.eot.embargo !== undefined ? ["embargo"] : []),
    ...(mon.eot.nightmare && asleep(mon.build) ? ["nightmare"] : []), ...(sourceIn(kernel, w, mon.eot.octolock) ? ["octolock"] : []),
  ];
}
