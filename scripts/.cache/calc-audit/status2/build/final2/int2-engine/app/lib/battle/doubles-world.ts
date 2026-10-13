import { allyOf, slotSide, type DoublesHazards, type DoublesSideId, type DoublesSlotId, type SideClockFlag } from "./doubles-types";
import type { SwitchHow } from "./doubles-switch";
import type { StatusStages } from "./status-table";
import type { BattleBuild, BattleConditions } from "./types";

/** A stage boost() reaches (the five stats, accuracy, evasion). */
export type Stage = keyof StatusStages;

// The doubles turn's worlds (SPEC §4.3): one discrete state of the turn with its mass, and the Pokémon's HP as factors (a
// partition of the present slots into independent joint tables). Exactness never rests on a factor being split; a
// split is kept only when every joint entry equals the product of its marginals.

/** HP keys: each slot of a factor is one digit in radix 4096 (engine HP, Dynamax HP included, is below 4096). */
export const RADIX = 4096;
/** Relative tolerance for a factor's split (SPEC §4.3). */
const SPLIT_TOLERANCE = 1e-12;

export type Factor = { slots: DoublesSlotId[]; table: Map<number, number> };

export type ProtectKind = "protect" | "kingsshield" | "spikyshield" | "banefulbunker" | "obstruct" | "silktrap" | "burningbulwark" | "maxguard";

/**
 * Moves-phase volatiles (status-eot SPEC §3.4; ADDENDUM §3.4). Track A (doubles-status.ts) writes them, Track E the
 * Substitute's hits and the Ally Switch counter; the end of turn reads only sleep (Bad Dreams reads build.status).
 * Values are immutable: replace a field, never mutate one in place (cloneMon copies the object shallowly).
 */
export type MoveVolatiles = {
  /** With build.status "slp": the counter's total decrease (attempts × 1, Early Bird × 2), and whether Rest put it to sleep. */
  sleep?: { elapsed: number; rest: boolean };
  /** Champions, with build.status "frz": BeforeMoves spent frozen. */
  freeze?: { attempts: number };
  /** Confused: BeforeMoves spent confused, and the least duration (T uniform on min..5; Axe Kick's 3); fresh: attempts 0. */
  confusion?: { attempts: number; min: 2 | 3 };
  taunt?: true;
  /** The move Disable stops (set only when it can still act). */
  disabled?: string;
  /** The move Encore holds it to (E2 "encore"; it changes no action this turn). */
  encore?: string;
  imprisoning?: true;
  /** Its Substitute's HP left: from carried.substitute or this turn's Substitute; hits lower it (Track E); deleted at 0. */
  substitute?: number;
  endure?: true;
  /** Its move this turn passed BeforeMove (lastMove for later reads). */
  usedMove?: string;
  /** Scarlet/Violet, Champions: the Ally Switch counter (carried, or 3 after a first use this turn). */
  allySwitch?: number;
  /**
   * Berserk or Anger Shell after a confusion self-hit (data/abilities.ts berserk, angershell onDamage: checkedBerserk false
   * for an effect of type Move): the TryEatItem of its healing Berry fails (Sitrus, Oran, the Figy family; not Berry Juice,
   * which is used, not eaten) until damage from something other than a move resets it (doubles-turn.ts afterLoss).
   * status2 Step 1 #2: "sheerforce", a Champions Sheer Force hit's lock (PS/data/mods/champions/abilities.ts berserk,
   * angershell onDamage have no Sheer Force clause, and the move runs no AfterMoveSecondary).
   */
  berryLocked?: true | "sheerforce";
  /**
   * Its accuracy and evasion stages from this turn (sim/pokemon.ts boosts.accuracy, boosts.evasion; no input carries them,
   * so they start at 0): written by doubles-status.ts applyBoosts, cleared by Haze and White Herb. The calculations do not
   * read them: Stored Power, Power Trip and Punishment are not estimated while one is positive (doubles-turn.ts applyStep).
   * status2: carried.stages starts them (carriedState); D's hidden stages read them.
   */
  stages?: { accuracy?: number; evasion?: number };

  // ---- status2 (SPEC2 §3.3, ADDENDUM2 §3.3): one writer each, as marked; values immutable. Absent until set. ----
  // A1
  stockpile?: { layers: 1 | 2 | 3; def: number; spd: number };
  powerTrick?: true; powerShift?: true; noRetreat?: true; minimize?: true;
  /** Gastro Acid: its real ability (the build holds GAS_STAND_IN). */
  gastroAcid?: string;
  /** The two-turn move it charged this turn (its release next turn: DoublesOutcomeMon.charging); A1's Geomancy, H's hidden moves. */
  charging?: string;
  trapped?: true;
  /** Transform this turn: the Pokémon it copied, and its own ability kept inert (status2 integration 1a, A1). */
  transform?: { into?: DoublesSlotId; inert?: string };
  /** The Pokémon whose Block, Mean Look or Spider Web this turn trap it (linked: a trapper's faint ends it). */
  trappers?: DoublesSlotId[];
  // A2
  /** Infatuated by the Pokémon that started the turn in this slot. */
  attract?: DoublesSlotId;
  tarShot?: true;
  revealed?: "foresight" | "miracleeye";
  /** This turn only. */
  electrify?: true; powder?: true;
  /** Gen 7: a type given at Showdown position 1 with its Curse queued (PS/data/moves.ts:19928-19934). */
  curseGlitch?: true;
  /** The type its move had as used this turn (kept only while a Conversion 2 user is in the turn). */
  usedType?: string;
  // A3
  magicCoat?: { prankster: boolean }; snatch?: true;
  // D
  glaiveRush?: true; berryWeaken?: true;
  // H, N, CL, M, PR (ADDENDUM2 §3.3)
  /** carriedState (H reads): Lock-On or Mind Reader at the Pokémon that started this turn in that slot. */
  lockOn?: DoublesSlotId;
  /** The two-turn move it is locked into this turn (carried.charging), until its action (C38); the kernel's chargesThisTurn reads it. */
  locked?: string;
  /** N (readers rule: only with its own protecting move this turn): the stall counter. */
  stall?: number;
  /** carriedState (N reads). */
  mustRecharge?: true;
  /** carriedState (calcBuild reads). */
  laserFocus?: true;
  /** carriedState; A1 (Q12) and K (Battle Bond) read and write. */
  onceUsed?: readonly string[];
  /** CL: Uproar's turns left after this one. */
  uproar?: number;
  /** M: G-Max Chi Strike layers. */
  chiStrike?: 1 | 2 | 3;
  /** PR. */
  beakBlast?: true; shellTrap?: { hit: boolean }; usedTarget?: DoublesSlotId;
  /** carriedState, PR: a Bide from earlier turns. */
  bide?: { stored: number; source: DoublesSlotId | null; release: boolean };
};

/**
 * End-of-turn state (one writer per field: A = status engine, B = end-of-turn engine, as marked; C16's Rapid Spin and
 * Mortal Spin and a Substitute starting may also end leechSeed and trap). Values are immutable, as MoveVolatiles'.
 */
export type EotState = {
  /** A (setStatus "tox": 0) / carried. */
  toxic?: number;
  /** A / carried: the position of the seeder (Leech Seed's sourceSlot). */
  leechSeed?: DoublesSlotId;
  /**
   * B (trapping damaging moves) / carried: the trapper (a Pokémon), the divisor (Binding Band 6) and the move that set it (the
   * residual's name); status2 `gmax`: G-Max Centiferno or Sandblast (it outlives its source).
   */
  trap?: { source: DoublesSlotId; divisor: 6 | 8; move?: string; gmax?: true };
  /** B / carried. */
  saltCure?: true;
  /** A / carried. */
  aquaRing?: true; ingrain?: true; curse?: true;
  /** B / carried: the Pokémon whose Syrup Bomb it is. */
  syrupBomb?: DoublesSlotId;
  /** A (2: this turn's) / carried (1: falls asleep at this end of turn). */
  yawn?: 1 | 2;
  /** A (4: this turn's Perish Song) / carried (1–3). */
  perish?: number;
  /** Carried: a Wish landing on this slot (a position) at this end of turn, its HP. */
  wish?: number;
  /** A. */
  roosted?: true; magnetRise?: true;
  /** B. */
  smackedDown?: true;
  /** B (Psychic Noise). */
  healBlock?: true;
  /**
   * B (charge turn) / carried (C38): the hidden move of a charge or a carried release (status2 ADDENDUM2 C20, widened from
   * "sheltered" | "semi"); sheltered(id) is Dig or Dive.
   */
  hidden?: "fly" | "bounce" | "dig" | "dive" | "phantomforce" | "shadowforce" | "skydrop";
  /**
   * Carried (widened, C33): a landing with its user's starting slot or its build (`{ bare }`: a bare move id, its user not
   * given). E's landing reads it.
   */
  futureMove?: { move: "futuresight" | "doomdesire"; source: DoublesSlotId | null; build: BattleBuild | null } | { bare: string };
  /** Carried (widened, C33): true, a Berry not known which; or Cud Chew's Berry and counter (carried 1; a Berry eaten in the moves 2, in the end of turn 1). */
  cudChew?: true | { berry: string; counter: 1 | 2 };
  // ---- status2 (SPEC2 §3.3, ADDENDUM2 §3.3) ----
  nightmare?: true;                                   // A2
  octolock?: DoublesSlotId;                           // A2
  /** Turns left before this end of turn's countdown. */
  telekinesis?: number; embargo?: number;             // A2
  /** With healBlock: turns left before this end of turn's countdown (Psychic Noise this turn 2, Heal Block 5). */
  healBlockLeft?: number;                             // A2
  /** H: lifted by the Sky Drop user at this slot. */
  lifted?: DoublesSlotId;
  /**
   * Turns left before this end of turn's countdown (N's inputs; a use this turn writes its fresh duration: Taunt 3, 4 when
   * its target had moved; Encore 3, 4 when it had moved; Disable 5, 4 when it has not moved yet).
   */
  tauntLeft?: number; encoreLeft?: number; disableLeft?: number;
};

/** Dig and Dive shelter their user (EotState.hidden; doubles-eot.ts residualMon's `sheltered`): the other hidden moves leave it in the air or out of reach. */
export function sheltered(hidden: EotState["hidden"]): boolean {
  return hidden === "dig" || hidden === "dive";
}

/** Everything about one Pokémon in a world but its HP (which is in the factors). */
export type MonState = {
  /** The settled build, updated along the turn (items, stages, ability, form, status, mechanic); currentHP is unused. */
  build: BattleBuild;
  fainted: boolean;
  /** Its action has been picked (sim/battle-queue.ts willMove no longer finds it). */
  moved: boolean;
  /** The move that made it flinch (Fake Out, Upper Hand), or null. */
  flinched: string | null;
  /** Focus Punch's lostFocus (data/moves.ts focuspunch condition onHit). */
  focusLost: boolean;
  /** It used Charge before (its next Electric attack doubles), until an Electric move uses it up. */
  charged: boolean;
  protect: ProtectKind | null;
  /** It is the centre of attention (doubles-turn.ts redirection): its Follow Me or Rage Powder; Spotlight in the start rows only. */
  centre: "followme" | "ragepowder" | "spotlight" | null;
  /** Helping Hand received this turn. */
  helpingHand: number;
  /** It took damage this turn (sim/battle.ts spreadDamage hurtThisTurn). */
  hurt: boolean;
  /** The Pokémon whose moves dealt it damage this turn (sim/pokemon.ts attackedBy). */
  damagedBy: DoublesSlotId[];
  /** Hits taken this turn (sim/battle-actions.ts timesAttacked). */
  timesAttacked: number;
  /** A stat stage of its fell this turn (sim/battle.ts boost statsLoweredThisTurn). */
  statsLowered: boolean;
  /** A stat stage of its rose this turn (sim/battle.ts boost statsRaisedThisTurn). */
  statsRaised: boolean;
  /** It used Destiny Bond this turn (data/moves.ts destinybond volatile). */
  destinyBond?: true;
  /** Its own move's step followed its HP (recoil, Life Orb, retaliation, draining): whether it lost HP is in the factors. */
  ownHP?: true;
  /** Throat Chop hit it this turn (data/moves.ts throatchop condition): no sound move. */
  throatChopped?: true;
  /** Moves-phase volatiles (Track A, Track E). */
  vol: MoveVolatiles;
  /** End-of-turn state (Track A, Track B). */
  eot: EotState;
  // ---- status2 (SPEC2 §3.3, ADDENDUM2 §3.3); absent until set, each written only while a reader exists (SPEC2 §4.9) ----
  /** Item history (D's writers in the kernel; kept only while ctx.tracksItems): pokemon.lastItem and usedItemThisTurn. */
  lastItem?: string; usedItem?: true;
  /** Opportunist or Mirror Herb: the copy accumulated since its last application (effectState.boosts). */
  copy?: { stages: Partial<Record<Stage, number>>; by: "opportunist" | "mirrorherb" };
  /** W (only with a Sparkling Aria user in the turn): during one action, the followed user reached 0 HP in the hits. */
  faintedInHits?: true;
  /** The last hits from foes this turn (Counter family, a releasing Bide); only while one of them is queued on it. */
  taken?: Partial<Record<"physical" | "special" | "any", { from: DoublesSlotId; damage: number }>>;
  /** PR: Commander's pair. */
  commanding?: DoublesSlotId; commanded?: DoublesSlotId;
  /** N: its ability state's age (input entryOrder, then this turn's changes, each later than all before); only with a tie reader. */
  entry?: number;
  /**
   * status2 R (F4 §5.4): who this is. Absent: the Pokémon that started the turn in this slot (startId(slot)); a newcomer:
   * its bench id (DoublesBenchPokemon.id). mons[slot] is the slot's occupant (replaced as one comes in); `occupant` and
   * `positionOf` stay positional.
   */
  id?: string;
  /**
   * status2 R-E: it came in during this turn (a newcomer, or a slot's starting Pokémon back in): pinned newlySwitched (Payback,
   * Bolt Beak), no action left, its entry read from the bench (the kernel's input view: doubles-turn.ts syncOccupants).
   */
  entered?: true;
  /** status2 R-E: its Eject Pack's drop is marked (effectState.eject) and waits for the next AfterMove or SwitchIn to be used. */
  ejectMarked?: true;
  /** status2 R-E: it came in after the residual (a switch after the turn: DoublesEndOfTurn.replaced). */
  late?: true;
  /** status2 R-E: it came in under Neutralizing Gas: its own ability, behind the stand-in its build holds (the kernel's gas view). */
  gassed?: string;
};

/**
 * status2 R (F4 §5.4): a Pokémon that left its slot during the turn (World.benched). Its HP leaves the factors as its marginal,
 * which is exact for what reads it: E2's per-Pokémon outcome, the result's leaver line, and its own return later in the
 * turn (the joint with the others no longer matters once it is out).
 */
export type BenchedMon = {
  /** startId(slot) for a slot's starting Pokémon, else its bench id. */
  id: string;
  /** The slot it left, as World.mons keys it. */
  slot: DoublesSlotId;
  /** Its state as it left, after its switch-out effects (Regenerator, Natural Cure, Zero to Hero) and with what leaving clears gone. */
  mon: MonState;
  /** Its HP as it left: [hp, mass] ascending by HP, masses summing to 1. */
  hp: readonly (readonly [number, number])[];
  /** status2 R-E: it came back in later this turn (the entry stays for the result's leaver line: DoublesReplaced.left). */
  back?: true;
  /** status2 R-E: it left after the residual (a switch after the turn: DoublesEndOfTurn.replaced). */
  late?: true;
};

/** status2 R: a switch-out pending in a world until the action ends (World.switching; doubles-switch.ts betweenActions). */
export type PendingSwitch = {
  /** The slot (as World.mons keys it) whose Pokémon leaves. */
  slot: DoublesSlotId;
  how: SwitchHow;
  /** The move of the action it happened in (U-turn, Roar, Parting Shot…), or null (an item or ability outside a move's own effect). */
  moveId: string | null;
  /** status2 R-E: the statistics index of the action it happened in (DoublesStep facts); -1 outside an action. */
  index?: number;
  /** status2 R-E: Emergency Exit and Wimp Out: only in the part of the world where its HP is now at most half and above 0. */
  below?: true;
  /** status2 R-E: Red Card's holder (its card is used up as the drag is set). */
  holder?: DoublesSlotId;
};

export type SideState = {
  reflect: boolean; lightScreen: boolean; auroraVeil: boolean; tailwind: boolean; wideGuard: boolean; quickGuard: boolean; faintedThisTurn: number;
  /** Safeguard up on the side (Track A). */
  safeguard: boolean;
  /** Hazard move ids that landed on the side this turn, in order (Track A; Magic Bounce sends them back). Replace the array, never push into it. */
  hazards: string[];
  // ---- status2 (SPEC2 §3.3, ADDENDUM2 §3.3): absent = off, so worlds and E2 outcomes stay as they were until one is set ----
  /** A3, this turn only. */
  craftyShield?: true; matBlock?: true;
  /** A3 (startWorld from the input's side conditions). */
  mist?: true; luckyChant?: true;
  /** A3 (and fieldMove's screens and Tailwind): the clock each condition up on this side runs on. */
  clock?: Partial<Record<SideClockFlag, DoublesSideId | "set">>;
  /** The pre-turn hazards this side holds now (DoublesOutcome.sides.hazardsFrom): A1 Tidy Up, A3 Defog / Court Change, the kernel's Rapid Spin / Mortal Spin (Step 1). */
  hazardsFrom?: DoublesSideId | null;
  /** A3: Aromatherapy or Heal Bell cured this side's bench. */
  benchCured?: true;
  /** PR sets, E2 counts down: the Pledges' side conditions, turns left. */
  pledge?: Partial<Record<"fire" | "grass" | "water", number>>;
  /** E2 (startWorld from SideConditions.gmaxResidual): the G-Max side conditions up (move ids). */
  gmax?: string[];
};

/**
 * status2 R (integration 2): whether `side` holds a hazard in `w`: one that landed this turn (SideState.hazards) or one from
 * before the turn that it holds now (DoublesTurnInput.hazards, `before`, through SideState.hazardsFrom: its own, the other
 * side's after Court Change, none once cleared). Court Change's, Defog's, Tidy Up's and G-Max Wind Rage's facts read it: pinned
 * courtchange, defog, tidyup and gmaxwindrage (PS/data/moves.ts) move or remove the hazards from before the turn too.
 */
export function holdsHazards(w: World, side: DoublesSideId, before: Partial<Record<DoublesSideId, DoublesHazards>> | undefined): boolean {
  const state = w.sides[side];
  if (state.hazards.length) return true;
  const from = state.hazardsFrom === undefined ? side : state.hazardsFrom;
  const pre = from === null ? undefined : before?.[from];
  return !!pre && !!(pre.stealthRock || pre.spikes || pre.toxicSpikes || pre.stickyWeb || pre.steelsurge);
}
/** The field (status2: mudSport, waterSport and ionDeluge absent unless set; outcomeOf drops ionDeluge, which ends with the turn). */
export type FieldState = Pick<BattleConditions, "weather" | "terrain" | "gravity" | "trickRoom" | "wonderRoom" | "magicRoom" | "mudSport" | "waterSport" | "ionDeluge">;

/** One queued action (sim/battle-queue.ts): a move, or "No move" (a Splash-like pass), with its fractional priority fixed at queue time. */
export type PendingAction = {
  /** Index into the turn's actions. */
  index: number;
  slot: DoublesSlotId;
  moveId: string | null;
  target: DoublesSlotId | null;
  fractional: number;
  /** Generation 7: the priority (fractional included) and Speed sorted at the turn's start, frozen for the turn. */
  frozen?: { priority: number; speed: number };
  /**
   * The queue's order key (sim/battle-queue.ts:277-287 comparePriority, order ascending first): absent = 200, a move;
   * After You 3 (the action next, data/moves.ts:195-216), Quash 201 (last, data/moves.ts:14455-14472; gen 7's
   * data/mods/gen7/moves.ts:750-766 inserts it before the residual, also last).
   */
  order?: number;
  /** status2 PR, CL: Showdown action.sourceEffect (a pulled Round, the Pledge that waited, "instruct"). */
  source?: string;
  /** status2 PR: a Dancer's copy (runMove externalMove). */
  external?: true;
  /**
   * status2 integration 1b: a hit at the residual whose source is not in battle (doubles-turn.ts residualHit): `slot` only
   * names the source's side (it may be empty or hold another Pokémon), so nothing reads it as the user.
   */
  userless?: true;
};

export type World = {
  mass: number;
  mons: Partial<Record<DoublesSlotId, MonState>>;
  sides: Record<DoublesSideId, SideState>;
  field: FieldState;
  remaining: PendingAction[];
  /** Move actions picked so far (positions among the slots with a move). */
  executed: number;
  factors: Factor[];
  /** While a spread move runs (doubles-turn.ts): the attacker's state each target's step left, compared afterwards. */
  spread?: string[];
  /**
   * While Explosion and its kin hit (doubles-turn.ts spreadStep): their user, at 0 HP with its faint queued, whose
   * Ally, Foe and Any handlers no longer run (sim/pokemon.ts allies() needs HP; sim/battle.ts findEventHandlers).
   */
  ghost?: DoublesSlotId;
  /** Pokémon that left during the moves with no later action (S moves, U-turn, Eject Button...): the end of turn is not estimated (Track B: doubles-eot.ts leaving). */
  leaving?: DoublesSlotId[];
  /** An end-of-turn-level guard set during the moves (an L move as the last action...): the end of turn is not estimated with this reason. */
  endGuard?: string;
  /** Ally Switch: this side's two Pokémon stand swapped (PS/sim/battle.ts:1588-1607). */
  swapped?: Partial<Record<DoublesSideId, true>>;
  /** During one action: the Pokémon whose item Trick or Switcheroo moved (eventGuards: no Symbiosis, T11). Cleared after the action. */
  itemsMoved?: DoublesSlotId[];
  /**
   * During one action (its BeforeMove included): the Pokémon a boost() reached with a rise or a drop in the table its
   * AfterBoost reads (sim/battle.ts boost: after ChangeBoost, the cap and TryBoost; accuracy and evasion included), as
   * doubles-status.ts applyBoosts records it: Opportunist and Mirror Herb read a rise (onFoeAfterBoost), Eject Pack a
   * drop (onAfterBoost), whatever the stage ends at. A clearBoosts (Haze) is none. `reset`: a damaging move's clearBoosts
   * (Clear Smog) set the Pokémon's stages to 0, so the step's stage difference is no drop there. eventGuards reads and clears it.
   * status2 (SPEC2 §3.3): `rose` holds the summed positive parts by stat of every boost() table that reached it in the action
   * (doubles-guards.ts noteRise); its truthiness keeps today's readers.
   */
  boosted?: Partial<Record<DoublesSlotId, { rose?: Partial<Record<Stage, number>>; fell?: true; reset?: true }>>;
  /** During one damaging action: the Pokémon its move hit (sim/battle-actions.ts move.hitTargets), in hit order (Sparkling Aria). */
  hitTargets?: DoublesSlotId[];
  /**
   * An action of the moves changed the weather (doubles-turn.ts walk): the weather up now was set this turn (or none is
   * up), so it has its new duration (sim/field.ts setWeather) and is not the one from before the turn whose turns left
   * the input gives (doubles-eot.ts weatherHandler).
   */
  weatherSet?: true;
  // ---- status2 (SPEC2 §3.3, ADDENDUM2 §3.3); each written only while a reader exists (SPEC2 §4.9) ----
  /** Rooms, Sports, Gravity and Trick Room set during this turn and up now (A3; fieldMove's Trick Room and Gravity). */
  fieldSet?: Partial<Record<"magicRoom" | "wonderRoom" | "trickRoom" | "gravity" | "mudSport" | "waterSport" | "echoedVoice", true>>;
  /** During one action: the Pokémon whose item a takeItem removed (no Symbiosis); cleared after the action, as itemsMoved. */
  itemsTaken?: DoublesSlotId[];
  /** PR: an action did something this turn (Dancer, Fusion readers only). */
  didSomething?: true;
  /** PR: the last successful move of the turn (Fusion Bolt, Fusion Flare); null: none. */
  lastSuccessful?: string | null;
  /** CL: the last move used in the battle (Copycat), this turn's or the input's battleLastMove. */
  lastMove?: string | null;
  // ---- status2 R (SPEC2 §4.8, F4 §5.4); each written only with a bench (DoublesTurnInput.bench), absent otherwise ----
  /** The Pokémon that left each side's slots this turn, in the order they left (DoublesOutcome.benched, DoublesTurnResult.replaced). */
  benched?: Partial<Record<DoublesSideId, BenchedMon[]>>;
  /**
   * The ids on each side's bench now, in Showdown's team order beyond the active Pokémon (sim/side.ts pokemon): the input's
   * order, a leaver taking the place of the Pokémon that came in for it (sim/battle-actions.ts switchIn); a slot's starting
   * Pokémon goes by startId. Absent for a side: its whole input bench.
   */
  bench?: Partial<Record<DoublesSideId, string[]>>;
  /** Switch-outs set during the current action (sim/pokemon.ts switchFlag, forceSwitchFlag), resolved as it ends (doubles-switch.ts betweenActions). */
  switching?: PendingSwitch[];
};

/**
 * setSpecies' resets (PS/sim/pokemon.ts:1387-1420): every engine form change goes through it; Transform does not. A form
 * change drops the build's stored stats, weight and world types (status2 SPEC2 §3.3).
 */
export function withSpecies(build: BattleBuild, speciesId: string): BattleBuild {
  // The build's key order is kept (speciesId in its place), so a world's discrete key reads as before the change.
  const next: BattleBuild = { ...build, speciesId };
  delete next.storedStats; delete next.weighthg; delete next.types; delete next.addedType;
  return next;
}

/** Where the Pokémon that started the turn in `slot` stands now. */
export function positionOf(w: World, slot: DoublesSlotId): DoublesSlotId {
  return w.swapped?.[slotSide(slot)] ? allyOf(slot) : slot;
}
/** The Pokémon (its starting slot) standing at `position` now. In doubles the swap is its own inverse, so this is positionOf's map. */
export function occupant(w: World, position: DoublesSlotId): DoublesSlotId {
  return w.swapped?.[slotSide(position)] ? allyOf(position) : position;
}
/** A partial trap ends on `slot` (its Substitute starting: PS/data/moves.ts:18336-18339; its Rapid Spin, Mortal Spin: C16). */
export function endTrap(w: World, slot: DoublesSlotId): void {
  const mon = w.mons[slot];
  if (mon?.eot.trap) mon.eot = { ...mon.eot, trap: undefined };
}

/**
 * RADIX ** index for the digit places of a factor (perf pass 1b: a table read in place of Math.pow; the values are the
 * same powers of two, so every key computed from them is unchanged).
 */
const POW = [1, RADIX, RADIX ** 2, RADIX ** 3, RADIX ** 4, RADIX ** 5, RADIX ** 6, RADIX ** 7];
/** RADIX ** index. */
export const radixPow = (index: number): number => POW[index] ?? RADIX ** index;
const digit = (key: number, index: number) => Math.floor(key / (POW[index] ?? RADIX ** index)) % RADIX;
/** The digit of `key` at `index` (hpIn with the slot's index known). */
export const digitAt = digit;

/** A slot's factor index and its digit in that factor. */
export function locate(world: World, slot: DoublesSlotId): { factor: number; index: number } {
  for (let factor = 0; factor < world.factors.length; factor++) {
    const index = world.factors[factor].slots.indexOf(slot);
    if (index >= 0) return { factor, index };
  }
  throw new Error(`No HP factor holds ${slot}.`);
}

/** The HP digit of `slot` in a key of `factor`. */
export function hpIn(factor: Factor, key: number, slot: DoublesSlotId): number {
  return digit(key, factor.slots.indexOf(slot));
}

/** The key with `slot`'s digit set to `hp`. */
export function withHP(factor: Factor, key: number, slot: DoublesSlotId, hp: number): number {
  const index = factor.slots.indexOf(slot);
  return key + (hp - digit(key, index)) * radixPow(index);
}

export function pointFactor(slot: DoublesSlotId, hp: number): Factor {
  return { slots: [slot], table: new Map([[hp, 1]]) };
}

/** The product of two independent factors. */
export function product(a: Factor, b: Factor): Factor {
  const shift = radixPow(a.slots.length);
  const table = new Map<number, number>();
  for (const [keyA, massA] of a.table) for (const [keyB, massB] of b.table) table.set(keyA + keyB * shift, massA * massB);
  return { slots: [...a.slots, ...b.slots], table };
}

/** A slot's marginal: HP -> mass. */
export function marginal(world: World, slot: DoublesSlotId): Map<number, number> {
  const { factor, index } = locate(world, slot);
  const f = world.factors[factor];
  const out = new Map<number, number>();
  for (const [key, mass] of f.table) {
    const hp = digit(key, index);
    out.set(hp, (out.get(hp) ?? 0) + mass);
  }
  return out;
}

/**
 * status2 R-E: `slot` leaves the factors (its Pokémon switched out): its digit summed out of its factor (the others' joint
 * is exact as it was), the rest re-split exactly. Its marginal as it left: [hp, mass] ascending by HP, masses summing to 1.
 */
export function takeOut(world: World, slot: DoublesSlotId): [number, number][] {
  const { factor, index } = locate(world, slot);
  const f = world.factors[factor];
  const own = new Map<number, number>();
  let total = 0;
  if (f.slots.length === 1) {
    for (const [key, mass] of f.table) { own.set(key, (own.get(key) ?? 0) + mass); total += mass; }
    world.factors = world.factors.filter((_, at) => at !== factor);
  } else {
    const rest = f.slots.filter((other) => other !== slot);
    const table = new Map<number, number>();
    for (const [key, mass] of f.table) {
      const hp = digit(key, index);
      own.set(hp, (own.get(hp) ?? 0) + mass);
      total += mass;
      let restKey = 0;
      for (let at = 0, place = 0; at < f.slots.length; at++) {
        if (at === index) continue;
        restKey += digit(key, at) * radixPow(place++);
      }
      table.set(restKey, (table.get(restKey) ?? 0) + mass);
    }
    normalise(table);
    world.factors = [...world.factors.filter((_, at) => at !== factor), ...splitFactor({ slots: rest, table })];
  }
  return [...own].sort((a, b) => a[0] - b[0]).map(([hp, mass]) => [hp, total > 0 ? mass / total : mass] as [number, number]);
}

/** status2 R-E: `slot` joins the factors with its own HP table (a newcomer: a point, or a leaver back in: its marginal as it left). */
export function putIn(world: World, slot: DoublesSlotId, hp: readonly (readonly [number, number])[]): void {
  world.factors = [...world.factors, { slots: [slot], table: new Map(hp.map(([value, mass]) => [value, mass])) }];
}

/** Merge the factors holding `slots` into one (their product), returning its index. */
export function join(world: World, slots: DoublesSlotId[]): number {
  const indexes = [...new Set(slots.map((slot) => locate(world, slot).factor))].sort((a, b) => a - b);
  if (indexes.length === 1) return indexes[0];
  let joined = world.factors[indexes[0]];
  for (const index of indexes.slice(1)) joined = product(joined, world.factors[index]);
  world.factors = [...world.factors.filter((_, index) => !indexes.includes(index)), joined];
  return world.factors.length - 1;
}

/** A factor's canonical text, to compare tables. */
export function factorKey(factor: Factor): string {
  const keys = [...factor.table.keys()].sort((a, b) => a - b);
  return `${factor.slots.join(",")}:${keys.map((key) => `${key}=${factor.table.get(key)}`).join(";")}`;
}

function normalise(table: Map<number, number>): number {
  let total = 0;
  for (const mass of table.values()) total += mass;
  if (total > 0 && total !== 1) for (const [key, mass] of table) table.set(key, mass / total);
  return total;
}

/**
 * The factor as independent parts where that is exact: each slot is split off when every joint entry equals the product
 * of its marginal and the rest's within SPLIT_TOLERANCE, over the full product support (SPEC §4.3).
 */
export function splitFactor(factor: Factor, reference = false): Factor[] {
  if (factor.slots.length === 1 || reference) return [factor];
  if (factor.slots.length === 2) {
    const pair = splitPair(factor);
    if (pair) return pair;
  }
  for (const slot of factor.slots) {
    const at = factor.slots.indexOf(slot);
    // Perf pass 1b: a slot whose HPs do not all have the same number of entries cannot pass the size test below (a full
    // product's support has them so), so it is passed over before its marginals are summed.
    if (!evenSupport(factor, at)) continue;
    const place = radixPow(at);
    const rest = factor.slots.filter((other) => other !== slot);
    const own = new Map<number, number>(), others = new Map<number, number>();
    for (const [key, mass] of factor.table) {
      const hp = Math.floor(key / place) % RADIX;
      const restKey = key - hp * place;
      own.set(hp, (own.get(hp) ?? 0) + mass);
      others.set(restKey, (others.get(restKey) ?? 0) + mass);
    }
    if (own.size * others.size !== factor.table.size) continue;
    let independent = true;
    for (const [key, mass] of factor.table) {
      const hp = Math.floor(key / place) % RADIX;
      const expected = own.get(hp)! * others.get(key - hp * place)!;
      if (Math.abs(mass - expected) > SPLIT_TOLERANCE * Math.max(mass, expected)) { independent = false; break; }
    }
    if (!independent) continue;
    // Re-key the rest without the split slot's digit.
    const restTable = new Map<number, number>();
    for (const [restKey, mass] of others) {
      let key = 0;
      for (let index = 0, digitAt = 0; index < factor.slots.length; index++) {
        if (index === at) continue;
        key += digit(restKey, index) * radixPow(digitAt++);
      }
      restTable.set(key, mass);
    }
    return [{ slots: [slot], table: own }, ...splitFactor({ slots: rest, table: restTable })];
  }
  return [factor];
}

// splitPair's marginals by HP (a digit is below RADIX) and the HPs in the order first met, zeroed again after each use.
const PAIR_OWN = new Float64Array(RADIX), PAIR_REST = new Float64Array(RADIX);
const PAIR_OWN_SEEN = new Uint8Array(RADIX), PAIR_REST_SEEN = new Uint8Array(RADIX);
const PAIR_OWN_ORDER = new Int32Array(RADIX), PAIR_REST_ORDER = new Int32Array(RADIX);
const PAIR_KEYS = RADIX * RADIX;

/**
 * splitFactor for a factor of two slots (perf pass 1b), with the marginals in arrays by HP rather than maps; the same sums in
 * the same order, the same tests and the same tables (in the order their HPs are first met). The first slot decides: the
 * second's support test and independence test read the same marginals (each sum over the same entries in the same order), so
 * when the first slot does not split off, neither does the second.
 */
function splitPair(factor: Factor): Factor[] | null {
  let owns = 0, rests = 0, plain = true;
  for (const [key, mass] of factor.table) {
    // A key that is not two digits (an integer from 0 to RADIX² − 1) goes to the general path.
    if (!(key >= 0 && key < PAIR_KEYS && key === Math.floor(key))) { plain = false; break; }
    const hp = key % RADIX, other = Math.floor(key / RADIX) % RADIX;
    if (!PAIR_OWN_SEEN[hp]) { PAIR_OWN_SEEN[hp] = 1; PAIR_OWN_ORDER[owns++] = hp; }
    PAIR_OWN[hp] = PAIR_OWN[hp] + mass;
    if (!PAIR_REST_SEEN[other]) { PAIR_REST_SEEN[other] = 1; PAIR_REST_ORDER[rests++] = other; }
    PAIR_REST[other] = PAIR_REST[other] + mass;
  }
  let independent = plain && owns * rests === factor.table.size;
  if (independent) {
    for (const [key, mass] of factor.table) {
      const expected = PAIR_OWN[key % RADIX] * PAIR_REST[Math.floor(key / RADIX) % RADIX];
      if (Math.abs(mass - expected) > SPLIT_TOLERANCE * Math.max(mass, expected)) { independent = false; break; }
    }
  }
  let out: Factor[] | null = plain ? [factor] : null;
  if (independent) {
    const own = new Map<number, number>(), restTable = new Map<number, number>();
    for (let index = 0; index < owns; index++) { const hp = PAIR_OWN_ORDER[index]; own.set(hp, PAIR_OWN[hp]); }
    for (let index = 0; index < rests; index++) { const hp = PAIR_REST_ORDER[index]; restTable.set(hp, PAIR_REST[hp]); }
    out = [{ slots: [factor.slots[0]], table: own }, { slots: [factor.slots[1]], table: restTable }];
  }
  for (let index = 0; index < owns; index++) { const hp = PAIR_OWN_ORDER[index]; PAIR_OWN[hp] = 0; PAIR_OWN_SEEN[hp] = 0; }
  for (let index = 0; index < rests; index++) { const hp = PAIR_REST_ORDER[index]; PAIR_REST[hp] = 0; PAIR_REST_SEEN[hp] = 0; }
  return out;
}

// evenSupport's counts by HP (a digit is below RADIX), zeroed again after each use.
const SUPPORT_COUNTS = new Uint32Array(RADIX);
const SUPPORT_SEEN = new Int32Array(RADIX);

/**
 * Whether every HP of the slot at `at` has the same number of entries in the factor's table, and those numbers make up its
 * size: what a support that is the full product of that slot's HPs and the rest's has (splitFactor's size test).
 */
function evenSupport(factor: Factor, at: number): boolean {
  // Keys of five places or more can pass 2^53, where a key and its digits need not decompose exactly: the size test alone
  // decides there. An empty table passes it too.
  if (factor.slots.length > 4 || !factor.table.size) return true;
  const place = radixPow(at);
  let seen = 0;
  for (const key of factor.table.keys()) {
    const hp = Math.floor(key / place) % RADIX;
    if (SUPPORT_COUNTS[hp]++ === 0) SUPPORT_SEEN[seen++] = hp;
  }
  const each = factor.table.size / seen;
  let even = Number.isInteger(each);
  for (let index = 0; index < seen; index++) {
    const hp = SUPPORT_SEEN[index];
    if (SUPPORT_COUNTS[hp] !== each) even = false;
    SUPPORT_COUNTS[hp] = 0;
  }
  return even;
}

/** A copy of the Pokémon's state whose parts can be changed (vol and eot copied shallowly: their values are immutable). */
export function cloneMon(mon: MonState): MonState {
  return { ...mon, damagedBy: [...mon.damagedBy], vol: { ...mon.vol }, eot: { ...mon.eot } };
}

/** A copy of the world whose discrete parts can be changed (factors shared until replaced). */
export function cloneWorld(world: World, mass = world.mass): World {
  const mons: World["mons"] = {};
  for (const [slot, mon] of Object.entries(world.mons) as [DoublesSlotId, MonState][]) mons[slot] = cloneMon(mon);
  const out: World = {
    mass, mons, sides: { own: { ...world.sides.own }, opponent: { ...world.sides.opponent } }, field: { ...world.field },
    remaining: [...world.remaining], executed: world.executed, factors: [...world.factors], ...(world.spread ? { spread: [...world.spread] } : {}),
    ...(world.ghost ? { ghost: world.ghost } : {}),
    ...(world.leaving ? { leaving: [...world.leaving] } : {}), ...(world.endGuard !== undefined ? { endGuard: world.endGuard } : {}),
    ...(world.swapped ? { swapped: { ...world.swapped } } : {}), ...(world.itemsMoved ? { itemsMoved: [...world.itemsMoved] } : {}),
    ...(world.boosted ? { boosted: { ...world.boosted } } : {}), ...(world.hitTargets ? { hitTargets: [...world.hitTargets] } : {}),
    ...(world.weatherSet ? { weatherSet: true as const } : {}),
  };
  // status2: each copied only while present (so Step 0's worlds are unchanged).
  if (world.fieldSet) out.fieldSet = { ...world.fieldSet };
  if (world.itemsTaken) out.itemsTaken = [...world.itemsTaken];
  if (world.didSomething) out.didSomething = true;
  if (world.lastSuccessful !== undefined) out.lastSuccessful = world.lastSuccessful;
  if (world.lastMove !== undefined) out.lastMove = world.lastMove;
  // status2 R: the lists are replaced, never changed in place (their entries are immutable), so a shallow copy of each.
  if (world.benched) out.benched = { ...world.benched };
  if (world.bench) out.bench = { ...world.bench };
  if (world.switching) out.switching = [...world.switching];
  return out;
}

/**
 * The world restricted to the entries where `slot`'s HP meets `test`, and the rest: up to two worlds, each table
 * renormalised and the mass scaled (SPEC §4.3 conditioning). The tag says which side each is.
 */
export function condition(world: World, slot: DoublesSlotId, test: (hp: number) => boolean): { world: World; meets: boolean }[] {
  const { factor } = locate(world, slot);
  const f = world.factors[factor];
  const parts = [new Map<number, number>(), new Map<number, number>()];
  for (const [key, mass] of f.table) parts[test(hpIn(f, key, slot)) ? 0 : 1].set(key, mass);
  const out: { world: World; meets: boolean }[] = [];
  for (const [index, table] of parts.entries()) {
    if (!table.size) continue;
    const share = normalise(table);
    if (share <= 0 && parts[1 - index].size) continue;
    const next = cloneWorld(world, world.mass * share);
    next.factors[factor] = { slots: f.slots, table };
    out.push({ world: next, meets: index === 0 });
  }
  return out;
}

/**
 * The world after `slot`'s HP goes through `map` (a deterministic change: a heal, a fixed loss), split by the tag the
 * map gives each HP (a Berry eaten or not, fainted or not): one world per tag, each table renormalised.
 */
export function mapHP(world: World, slot: DoublesSlotId, map: (hp: number) => { hp: number; tag: string }): { world: World; tag: string }[] {
  const { factor } = locate(world, slot);
  const f = world.factors[factor];
  const byTag = new Map<string, Map<number, number>>();
  for (const [key, mass] of f.table) {
    const { hp, tag } = map(hpIn(f, key, slot));
    let table = byTag.get(tag);
    if (!table) byTag.set(tag, table = new Map());
    const next = withHP(f, key, slot, hp);
    table.set(next, (table.get(next) ?? 0) + mass);
  }
  const out: { world: World; tag: string }[] = [];
  for (const [tag, table] of byTag) {
    const share = normalise(table);
    const next = cloneWorld(world, world.mass * share);
    next.factors[factor] = { slots: f.slots, table };
    next.factors.splice(factor, 1, ...splitFactor(next.factors[factor]));
    out.push({ world: next, tag });
  }
  return out;
}

/**
 * The world after `slot` loses an amount drawn from `dist` (loss → mass, summing to 1), convolved into its factor: `apply`
 * maps an HP and a loss to the HP after and a tag (afterLoss-style: "fainted" or "in", a Berry eaten or not), one world
 * per tag, each table renormalised and re-split exactly (a confusion self-hit's rolls: Track A).
 */
export function lossDist(world: World, slot: DoublesSlotId, dist: ReadonlyMap<number, number>, apply: (hp: number, loss: number) => { hp: number; tag: string }): { world: World; tag: string }[] {
  const { factor } = locate(world, slot);
  const f = world.factors[factor];
  const byTag = new Map<string, Map<number, number>>();
  for (const [key, mass] of f.table) {
    const hp = hpIn(f, key, slot);
    for (const [loss, share] of dist) {
      const { hp: after, tag } = apply(hp, loss);
      let table = byTag.get(tag);
      if (!table) byTag.set(tag, table = new Map());
      const next = withHP(f, key, slot, after);
      table.set(next, (table.get(next) ?? 0) + mass * share);
    }
  }
  const out: { world: World; tag: string }[] = [];
  for (const [tag, table] of byTag) {
    const share = normalise(table);
    if (share <= 0) continue;
    const next = cloneWorld(world, world.mass * share);
    next.factors[factor] = { slots: f.slots, table };
    next.factors.splice(factor, 1, ...splitFactor(next.factors[factor]));
    out.push({ world: next, tag });
  }
  return out;
}

/**
 * The world after the HPs of `a` and `b` go through `map` together (Pain Split, Leech Seed: Track B), from their joined
 * factors: each joint entry rewritten, one world per tag, each table renormalised and re-split exactly.
 */
export function mapJoint(world: World, [a, b]: readonly [DoublesSlotId, DoublesSlotId], map: (hpA: number, hpB: number) => { hp: readonly [number, number]; tag: string }): { world: World; tag: string }[] {
  const base = cloneWorld(world);
  const at = join(base, [a, b]);
  const f = base.factors[at];
  const byTag = new Map<string, Map<number, number>>();
  for (const [key, mass] of f.table) {
    const { hp: [toA, toB], tag } = map(hpIn(f, key, a), hpIn(f, key, b));
    let table = byTag.get(tag);
    if (!table) byTag.set(tag, table = new Map());
    const next = withHP(f, withHP(f, key, a, toA), b, toB);
    table.set(next, (table.get(next) ?? 0) + mass);
  }
  const out: { world: World; tag: string }[] = [];
  for (const [tag, table] of byTag) {
    const share = normalise(table);
    if (share <= 0) continue;
    const next = cloneWorld(base, world.mass * share);
    next.factors[at] = { slots: f.slots, table };
    next.factors.splice(at, 1, ...splitFactor(next.factors[at]));
    out.push({ world: next, tag });
  }
  return out;
}

/**
 * The discrete key two worlds must share to merge: everything but the mass and the factor tables (their partition included).
 * status2's new fields of every state object enter through `mons`, `sides` and `field`; the World's keyed fields (fieldSet,
 * didSomething, lastSuccessful, lastMove) through one more entry, present only while one of them is set (so a world with
 * none of them has today's key); R's (benched with the leavers' HP, bench, switching) through another, likewise.
 */
export function discreteKey(world: World): string {
  const partition = world.factors.map((factor) => factor.slots.join(",")).sort();
  const key: unknown[] = [world.mons, world.sides, world.field, world.remaining, world.executed, world.spread ?? null, partition,
    world.swapped ?? null, world.endGuard ?? null, world.leaving ?? null, world.weatherSet ?? null];
  if (world.fieldSet || world.didSomething || world.lastSuccessful !== undefined || world.lastMove !== undefined) {
    key.push({ fieldSet: world.fieldSet, didSomething: world.didSomething, lastSuccessful: world.lastSuccessful, lastMove: world.lastMove });
  }
  if (world.benched || world.bench || world.switching) key.push({ benched: world.benched, bench: world.bench, switching: world.switching });
  return JSON.stringify(key);
}

/**
 * Worlds with equal discrete keys merged (SPEC §4.3): every table equal, the masses add; exactly one table different
 * (with `mixtures`), that factor becomes their mixture, which is exact since m1(f⊗g1) + m2(f⊗g2) = f⊗(m1 g1 + m2 g2).
 */
export function mergeWorlds(worlds: World[], mixtures: boolean): World[] {
  // Perf pass 1b: the factors are compared as tables (sameTable: what equal factorKey texts mean), and only between worlds
  // of one discrete key, so a world alone in its key costs no table text. The merges, their order and their masses are
  // those of the factorKey comparison.
  // One world merges with nothing: it is kept unless its mass is at most 0, as below (no key to make).
  if (worlds.length === 1) return worlds[0].mass <= 0 ? [] : [worlds[0]];
  const byKey = new Map<string, World[]>();
  const out: World[] = [];
  for (const world of worlds) {
    if (world.mass <= 0) continue;
    const key = discreteKey(world);
    const group = byKey.get(key);
    if (!group) { byKey.set(key, [world]); out.push(world); continue; }
    let merged = false;
    for (const entry of group) {
      // The factors (by their slots; both worlds have the same partition) whose tables differ: none, one (its index in
      // `world.factors`), or more (-2).
      let different = -1;
      for (let index = 0; index < world.factors.length; index++) {
        const factor = world.factors[index];
        const theirs = factorOf(entry, factor.slots);
        if (theirs && sameTable(theirs.table, factor.table)) continue;
        if (different !== -1) { different = -2; break; }
        different = index;
      }
      if (different === -1) { entry.mass += world.mass; merged = true; break; }
      if (mixtures && different >= 0) {
        const other = world.factors[different];
        const slots = other.slots.join(",");
        const at = entry.factors.findIndex((factor) => factor.slots.join(",") === slots);
        const total = entry.mass + world.mass;
        const table = new Map<number, number>();
        for (const [k, m] of entry.factors[at].table) table.set(k, m * entry.mass / total);
        for (const [k, m] of other.table) table.set(k, (table.get(k) ?? 0) + m * world.mass / total);
        entry.factors = [...entry.factors];
        entry.factors[at] = { slots: other.slots, table };
        entry.mass = total;
        merged = true;
        break;
      }
    }
    if (!merged) { group.push(world); out.push(world); }
  }
  return out;
}

/** The factor of `world` over exactly `slots` (in that order), or undefined. */
function factorOf(world: World, slots: DoublesSlotId[]): Factor | undefined {
  for (const factor of world.factors) {
    if (factor.slots.length !== slots.length) continue;
    let same = true;
    for (let index = 0; index < slots.length; index++) if (factor.slots[index] !== slots[index]) { same = false; break; }
    if (same) return factor;
  }
  return undefined;
}

/**
 * Two tables are equal as their factorKey texts compare: the same keys, and at each key masses with the same text (equal
 * numbers, 0 and -0 alike, NaN alike).
 */
function sameTable(a: Map<number, number>, b: Map<number, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, mass] of a) {
    const other = b.get(key);
    if (other === undefined) return false;
    if (other !== mass && !(other !== other && mass !== mass)) return false;
  }
  return true;
}

/** The number of factor entries across worlds (budget). */
export function entryCount(worlds: World[]): number {
  let count = 0;
  for (const world of worlds) for (const factor of world.factors) count += factor.table.size;
  return count;
}
