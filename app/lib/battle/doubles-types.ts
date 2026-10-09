import type { BattleRuntime } from "./runtime";
import type { BattleBuild, BattleConditions, BuildIssue, MoveContext, MoveDamageResult, SettledHP } from "./types";

// Contract for the 2v2 tab: types and slot helpers only. No mechanics; no engine imports (safe in the initial bundle).

/** Screen positions: your two Pokémon and the opponent's two, left and right as the page shows them. */
export type DoublesSlotId = "own-left" | "own-right" | "opponent-left" | "opponent-right";
export const DOUBLES_SLOTS: readonly DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
/** A slot's side; equal to roster-prep's RosterRole. */
export type DoublesSideId = "own" | "opponent";

export function slotSide(slot: DoublesSlotId): DoublesSideId {
  return slot === "own-left" || slot === "own-right" ? "own" : "opponent";
}
const ALLY: Record<DoublesSlotId, DoublesSlotId> = {
  "own-left": "own-right", "own-right": "own-left", "opponent-left": "opponent-right", "opponent-right": "opponent-left",
};
export function allyOf(slot: DoublesSlotId): DoublesSlotId {
  return ALLY[slot];
}
/** The other side's slots, screen-left first. */
export function foesOf(slot: DoublesSlotId): readonly [DoublesSlotId, DoublesSlotId] {
  return slotSide(slot) === "own" ? ["opponent-left", "opponent-right"] : ["own-left", "own-right"];
}
/** Where `target` stands as seen from `actor` (screen left and right). */
export type RelativePosition = "left-foe" | "right-foe" | "ally" | "itself";
export function relativePosition(actor: DoublesSlotId, target: DoublesSlotId): RelativePosition {
  if (actor === target) return "itself";
  if (target === ALLY[actor]) return "ally";
  return foesOf(actor)[0] === target ? "left-foe" : "right-foe";
}
/** Position words for facts and labels. */
export const SLOT_POSITION: Record<DoublesSlotId, string> = {
  "own-left": "your left", "own-right": "your right", "opponent-left": "opponent's left", "opponent-right": "opponent's right",
};
/**
 * Pinned Showdown side (p1 = 0) and position. The far side is mirrored, so the screen-left foe is the one across from your left
 * Pokémon (sim/pokemon.ts:745 isAdjacent; data/abilities.ts imposter copies foe.active[length - 1 - position]).
 */
export const SHOWDOWN_POSITION: Record<DoublesSlotId, { side: 0 | 1; position: 0 | 1 }> = {
  "own-left": { side: 0, position: 0 }, "own-right": { side: 0, position: 1 },
  "opponent-left": { side: 1, position: 1 }, "opponent-right": { side: 1, position: 0 },
};
/** Species names for facts and labels, with " (your left)" etc. added to both when two slots show the same species; "" for an empty slot. */
export function doublesNames(pokemon: Record<DoublesSlotId, { build: BattleBuild } | null>, runtime: BattleRuntime): Record<DoublesSlotId, string> {
  const base = Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const entry = pokemon[slot];
    return [slot, entry ? runtime.speciesById.get(entry.build.speciesId)?.name ?? entry.build.speciesId : ""];
  })) as Record<DoublesSlotId, string>;
  return Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const same = base[slot] !== "" && DOUBLES_SLOTS.some((other) => other !== slot && base[other] === base[slot]);
    return [slot, same ? `${base[slot]} (${SLOT_POSITION[slot]})` : base[slot]];
  })) as Record<DoublesSlotId, string>;
}

/**
 * A slot's choice. moveId null is "No move": it takes its turn at priority 0 and its own Speed and does nothing, as Splash
 * would. target: the slot it aims at when its rule is "choose"; null otherwise.
 */
export type DoublesAction = { moveId: string | null; target: DoublesSlotId | null };

/**
 * State from earlier turns a Pokémon brings into this turn. Training passes it from the public log (sim/tracker.ts counts);
 * the calculator passes only sleep, freeze, confusion, toxic and substitute. Absent fields: none of it. leechSeed and wish
 * are positions (Leech Seed's sourceSlot, Wish's slot condition); trap.source and syrupBomb are Pokémon (their
 * effectState.source). As the turn starts each position holds the Pokémon of that slot id, so the input is the same; they
 * differ only after an Ally Switch this turn.
 */
export type DoublesCarried = {
  /** With build.status "slp": BeforeMoves it has spent asleep since it fell asleep (public `|cant|…|slp` lines) and whether Rest put it to sleep. Absent: 0, not Rest (turn fact). */
  sleep?: { attempts: number; rest: boolean };
  /** With build.status "frz", Champions only: BeforeMoves it has spent frozen. Absent: 0 (turn fact). */
  freeze?: { attempts: number };
  /** Confused from an earlier turn: BeforeMoves it has spent confused (public `-activate|…|confusion` lines); Axe Kick's lasts at least 3. */
  confusion?: { attempts: number; axeKick?: true };
  /** With build.status "tox": the stage before this end of turn (end-of-turn ticks this stint), 0–15. Absent: 0 (turn fact). */
  toxic?: number;
  /** Seeded by the Pokémon at this slot (Leech Seed's sourceSlot). */
  leechSeed?: DoublesSlotId;
  /** Partially trapped by the Pokémon at `source` (Fire Spin, Whirlpool, Bind…); Binding Band: 1/6. `move`: the move that set it, for the residual's name (absent: "Partial trap"). */
  trap?: { source: DoublesSlotId; bindingBand: boolean; move?: string };
  saltCure?: true;
  aquaRing?: true;
  ingrain?: true;
  /** Ghost-type Curse on it. */
  curse?: true;
  /** Syrup Bomb from the Pokémon at this slot. */
  syrupBomb?: DoublesSlotId;
  /** Drowsy from a Yawn that landed last turn: it falls asleep at this end of turn. */
  yawn?: true;
  /** The perish count shown before this turn: this end of turn lowers it; 1 faints now. */
  perish?: 1 | 2 | 3;
  /** A Wish landing on this slot at this end of turn: the HP it restores (half the wisher's maximum HP, truncated). */
  wish?: number;
  /** A Future Sight or Doom Desire landing on this slot now (its move id): the end of turn is not estimated. */
  futureMove?: string;
  /** A Berry Cud Chew re-eats at this end of turn: the end of turn is not estimated. */
  cudChew?: true;
  /**
   * Its Substitute from an earlier turn: the HP it has left (pinned substitute condition hp, PS/data/moves.ts:18335):
   * at most floor(maxHP/4) of the Pokémon that made it, which for a Substitute Shed Tail passed is the Shed Tail user
   * (C13′). Absent: no Substitute.
   */
  substitute?: number;
  /**
   * Scarlet/Violet and Champions: it used Ally Switch last turn (the allyswitch volatile, duration 2, PS/data/moves.ts:333):
   * its use this turn works with 1/allySwitch, then the counter triples (at most 729). Absent: not used last turn (a turn
   * fact when it uses Ally Switch).
   */
  allySwitch?: 3 | 9 | 27 | 81 | 243 | 729;
};

export type DoublesPokemonInput = {
  build: BattleBuild;
  /** The slot's move contexts by move id; the turn reads its action's. turnOrder is ignored: the turn decides it. */
  contexts: Record<string, MoveContext>;
  /** It used Charge on an earlier turn: its next Electric attack doubles. */
  charged: boolean;
  action: DoublesAction;
  carried?: DoublesCarried;
  /** The move it used last before this turn (pinned pokemon.lastMove); null: none since it came in; absent: unknown. */
  lastMove?: string | null;
  /** Every move it has (Imprison reads its user's): the calculator's quick moves plus its chosen move; Training's set. Absent: unknown. */
  moves?: readonly string[];
};

export type DoublesTurnInput = {
  runtime: BattleRuntime;
  /**
   * The field before the turn: weather, terrain, rooms, Gravity, Critical hit. attackerSide is your side and defenderSide the
   * opponent's (Reflect, Light Screen, Aurora Veil, Tailwind). gameType is treated as "Doubles"; multipleTargets, fairyAura and
   * the side flags helpingHand, friendGuard, priorityShield, protect and charge are worked out from the four Pokémon and their
   * actions, and ignored here.
   */
  field: BattleConditions;
  /**
   * null: no Pokémon in that slot, as when its Pokémon fainted with no replacement left (the 2v2 UI passes a Pokémon at 0 HP
   * so). As pinned Showdown skips a fainted active Pokémon (sim/side.ts allies, sim/pokemon.ts isAdjacent, sim/battle.ts
   * runEvent), it takes no action, is no target (a move aimed at it goes to the other foe), a spread move counts only the
   * Pokémon in place, and its partner gets none of its effects; Last Respects counts it among its side's fainted
   * (side.totalFainted). With both foe slots empty, a move that can reach a foe has no target and no step.
   */
  pokemon: Record<DoublesSlotId, DoublesPokemonInput | null>;
  /** Turns the weather has left before this turn's countdown (1: it ends at this end of turn without acting). Absent: it lasts (turn fact when it acts). */
  weatherTurns?: number;
  /** Whether each side has a Pokémon left to switch in (S moves, Healing Wish, Lunar Dance, Roar, Whirlwind). Absent: true (turn fact when read). */
  canSwitch?: Partial<Record<DoublesSideId, boolean>>;
};

/** Which targets the move a slot would use can take, as chosen in the game (doubles-targets.ts). */
export type DoublesTargetRule =
  /** The player picks one: present slots, in the order left foe, right foe, ally, itself; none when both foe slots are empty and the move can reach a foe. */
  | { kind: "choose"; options: DoublesSlotId[] }
  /** Showdown picks: every slot listed (foes screen-left first, then the ally), or one living foe at random; none when both foe slots are empty. */
  | { kind: "auto"; hits: DoublesSlotId[]; random?: true }
  /** No Pokémon target. */
  | { kind: "none"; scope: "self" | "self-and-ally" | "own-side" | "foe-side" | "field" | "own-team" | "last-attacker" };

/** A fact and the share of the turn (0–1) in which it holds; 1 when it always does. */
export type DoublesFact = { text: string; chance: number };

/**
 * One Pokémon's HP after the turn's moves (DoublesTurnResult.hp: no end of turn) or after the whole turn
 * (DoublesEndOfTurn.hp), in the HP its bar shows (Dynamax HP while Dynamaxed).
 */
export type DoublesHP = {
  /** HP when the first move starts (after an item used as the turn starts, `settled`). */
  start: number;
  maximum: number;
  settled?: SettledHP;
  /** Its most likely HP when every damage roll of the turn is its lowest and every random hit count its fewest; ties go to the higher HP. */
  low: number;
  /** Expected HP over every outcome (exact, unrounded). */
  average: number;
  /** Its most likely HP when every damage roll is its highest and every random hit count its most; ties go to the lower HP. */
  high: number;
  /** The least and the most HP over every outcome. */
  min: number;
  max: number;
  /** Chance (0–1) it has fainted by the end of the moves (or of the turn, in DoublesEndOfTurn.hp); below 1 unless certain (uses-to-ko.ts uncertain). */
  koChance: number;
  /** HP it regains on some outcome, as facts ("Sitrus Berry: +58 HP."). */
  heals: string[];
  /** Chance (0–1) it faints before its own move; set when it has a move and the chance is above 0. */
  faintsBeforeMoving?: number;
  /** HP it lost outside any step: a No-move Pokémon's confusion self-hit ("Garchomp hurts itself in confusion: 23–28 HP."). */
  losses?: DoublesFact[];
  /** Its statuses and volatiles at this point, with chances ("Paralysed.", "Confused.", "Drowsy.", "Leech Seed.", "Perish count 3.", "Substitute: 35 HP."). Absent: none. */
  conditions?: DoublesFact[];
};

/** One Pokémon a move reaches. */
export type DoublesHit = {
  slot: DoublesSlotId;
  /** Share of the turn in which this move reached this slot, after redirection, retargeting and failures. */
  reached: number;
  /**
   * "blocked": a TryHit blocker stopped it (Protect, Wide Guard, Quick Guard, Telepathy, an absorbing ability; for a
   * status move also Magic Bounce, Good as Gold, Soundproof, powder blockers); "no-damage": it reached and dealt nothing
   * (immune: types, Prankster vs Dark, a move's own immunity, a Substitute against a status move); "effect": a status move
   * reached it and acted (its facts say what, failures included); "substitute": every outcome of this move met a
   * Substitute in front of this Pokémon and none reached the Pokémon itself (min, max, minPercent, maxPercent null;
   * koChance 0; row: the calculation into the Substitute).
   */
  kind: "calculated" | "blocked" | "no-damage" | "effect" | "substitute";
  /** HP a status move changed on it over every outcome (heal +, cost −, Pain Split either); absent when none. */
  change?: { min: number; max: number };
  /**
   * The hits that met its Substitute (PS/data/moves.ts:18342-18372): `chance`, the share of the turn in which they did;
   * `min`/`max`, the HP the Substitute lost over those outcomes (capped at its HP); `breaks`, the share in which it broke.
   * With kind "calculated", min/max/koChance are the hits that reached the Pokémon (no Substitute, or after it broke).
   * Absent: it never met one.
   */
  substitute?: { chance: number; min: number; max: number; breaks: number };
  /** Damage over every calculation it met (not capped at HP); null unless calculated. */
  min: number | null;
  max: number | null;
  minPercent: number | null;
  maxPercent: number | null;
  /** Share of the turn in which this hit knocked it out; a Pokémon's hit chances add up to its koChance. */
  koChance: number;
  /** The calculation it met most often (the 1v1 row: hits, hitChances, description, assumptions); absent for blocked hits. */
  row?: MoveDamageResult;
  /** Distinct calculations it met (HP-based damage, a Berry used, Multiscale broken...). */
  cases: number;
  facts: DoublesFact[];
};

/** One move of the turn. */
export type DoublesStep = {
  slot: DoublesSlotId;
  moveId: string;
  /** The move it uses, when that differs (Z-Move, Max Move, form): name and type. */
  effectiveName?: string;
  effectiveType?: string;
  /** 1-based position among the slots with a move, with chances; one entry when certain. */
  order: { position: number; chance: number }[];
  /** Share of the turn in which it uses its move. */
  moves: number;
  /** Why it does not use it ("Faints before it moves.", "Flinches (Fake Out).", "Fully paralysed."). */
  skipped: DoublesFact[];
  /** Each Pokémon it can reach, in the order Showdown hits them. */
  hits: DoublesHit[];
  /** Redirection, retargeting, Helping Hand, failures, and effects on the user (recoil, Life Orb, Rocky Helmet, drain). */
  facts: DoublesFact[];
};

/** A move's damage into one Pokémon at the start of the turn, before any move (calculateDoublesMoves). */
/**
 * A damaging move's damage into a Pokémon it reaches at the start of the turn. `fact`: where the move goes then, when
 * that is not its chosen target ("Lightning Rod: Raichu takes Thunderbolt."), or the Pokémon that takes it once a move
 * of this turn has been used ("Follow Me: Clefairy takes Dragon Claw if Follow Me comes first.").
 */
export type DoublesStartRow = { slot: DoublesSlotId; target: DoublesSlotId; row: MoveDamageResult; fact?: string };
export type DoublesIssues = {
  pokemon: Partial<Record<DoublesSlotId, BuildIssue[]>>;
  field: BuildIssue[];
  actions: { slot: DoublesSlotId; message: string }[];
};
export type DoublesStart = Record<DoublesSlotId, { hp: number; maximum: number; settled?: SettledHP } | null>;

/** One residual on one Pokémon, aggregated over the turn's worlds. */
export type DoublesResidual = {
  slot: DoublesSlotId;
  /** "Sandstorm", "Leftovers", "Burn", "Bad poison", "Leech Seed", "Fire Spin", "Bad Dreams", "Healer", "Sitrus Berry"... */
  effect: string;
  /** The other Pokémon of a two-Pokémon residual: Leech Seed's seeder or seeded, the Bad Dreams or Healer holder. */
  other?: DoublesSlotId;
  /** Share of the turn in which it acted on this Pokémon. */
  chance: number;
  /** HP change where it acted (negative = damage); null when it changes no HP. */
  min: number | null;
  max: number | null;
  /** Hits' and residuals' KO chances add up to endOfTurn.hp[slot].koChance. */
  koChance: number;
  /** "Cures its poison.", "Falls asleep.", "Speed +1.", "Perish count 2.", "Switches out after the turn." */
  facts: DoublesFact[];
};
/** The end of the turn (SPEC §2.3): ready with every Pokémon's HP after the residuals, or not estimated with a fact reason (the moves stay estimated). */
export type DoublesEndOfTurn =
  | { status: "ready"; hp: Record<DoublesSlotId, DoublesHP | null>; residuals: DoublesResidual[]; facts: string[] }
  | { status: "not-estimated"; reason: string };

export type DoublesTurnResult =
  | { status: "issues"; issues: DoublesIssues }
  | { status: "not-estimated"; reason: string; start: DoublesStart | null; startRows: DoublesStartRow[]; facts: string[] }
  | {
    status: "ready";
    start: DoublesStart;
    /**
     * Slots with a move only, by mean position (slot order on ties). Empty when no slot has a move. A move with no target
     * because both foe slots are empty has no step (the fact "No target: both foes have fainted.").
     */
    steps: DoublesStep[];
    /** After the moves (no end of turn). */
    hp: Record<DoublesSlotId, DoublesHP | null>;
    startRows: DoublesStartRow[];
    /** §2.3. */
    facts: string[];
    /** Ally Switch: the chance each side's two Pokémon stand swapped after the moves; absent when 0. Slots stay the Pokémon as they started. */
    swapped?: Partial<Record<DoublesSideId, number>>;
    /** The end of the turn after the moves: HP after the whole turn, or why it is not estimated. */
    endOfTurn: DoublesEndOfTurn;
  };

// ---------- The turn as finished worlds (calculateDoublesOutcomes; Training AI, SPEC E2) ----------

/** One Pokémon in one outcome: at the end of the moves, or after the turn when the result's endOfTurn is "applied". */
export type DoublesOutcomeMon = {
  /** HP distribution (chances sum to 1) from the world's marginal (doubles-world.ts marginal), ascending by HP. */
  hp: { hp: number; chance: number }[];
  /**
   * The world's MonState.build: stages, status, item, ability, form (currentHP unused). build.itemId is the world's item
   * after Trick, Switcheroo, Knock Off or an eaten Berry.
   */
  build: BattleBuild;
  /** A protecting move of its succeeded this turn (MonState.protect). */
  protected: boolean;
  /** Its action was picked this turn (MonState.moved). */
  moved: boolean;
  /**
   * Showdown volatile ids the next turn's value reads: confusion, taunt, encore, yawn, leechseed, perishsong, substitute,
   * curse, saltcure, aquaring, ingrain, partiallytrapped; "substitute" while one stands and "allyswitch" after a use this
   * turn that passed its PrepareHit (Scarlet/Violet, Champions). Absent: none.
   */
  volatiles?: string[];
  /** Asleep: expected remaining sleep counter (Showdown statusState.time; Early Bird counts each BeforeMove twice). */
  sleepTurns?: number;
  /** Perish count after this turn (3, 2, 1). */
  perishCount?: number;
  /** Its Substitute's HP after the turn, chances summing to 1; present exactly when volatiles has "substitute". */
  substitute?: { hp: number; chance: number }[];
  /** Scarlet/Violet, Champions: the Ally Switch counter after this turn's use (the next use works 1/counter). */
  allySwitch?: number;
};
export type DoublesOutcome = {
  /** The world's mass; outcomes' chances sum to 1. */
  chance: number;
  mons: Partial<Record<DoublesSlotId, DoublesOutcomeMon>>;
  sides: Record<DoublesSideId, {
    reflect: boolean; lightScreen: boolean; auroraVeil: boolean; tailwind: boolean; faintedThisTurn: number;
    /** Safeguard up on the side. Absent: not up. */
    safeguard?: boolean;
    /** Hazard move ids that landed on this side this turn. Absent: none. */
    hazards?: string[];
  }>;
  field: Pick<BattleConditions, "weather" | "terrain" | "gravity" | "trickRoom" | "wonderRoom" | "magicRoom">;
  /** Within this outcome, the chance every present Pokémon of the side is at 0 HP (from the joint factors); 1 with none present. */
  allFainted: Record<DoublesSideId, number>;
  /** Ally Switch: each side's two Pokémon stand swapped after the turn, or not. mons stay keyed by the slot each started in. */
  positions: Record<DoublesSideId, "kept" | "swapped">;
};
export type DoublesOutcomesResult =
  | { status: "issues"; issues: DoublesIssues }
  | { status: "not-estimated"; reason: string }
  | {
    status: "ready"; start: DoublesStart; outcomes: DoublesOutcome[];
    /** "applied": the outcomes are after the whole turn; otherwise they are after the moves and the end of turn is not estimated (why). */
    endOfTurn: "applied" | { notEstimated: string };
  };
