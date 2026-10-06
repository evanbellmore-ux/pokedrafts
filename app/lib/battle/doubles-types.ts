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

export type DoublesPokemonInput = {
  build: BattleBuild;
  /** The slot's move contexts by move id; the turn reads its action's. turnOrder is ignored: the turn decides it. */
  contexts: Record<string, MoveContext>;
  /** It used Charge on an earlier turn: its next Electric attack doubles. */
  charged: boolean;
  action: DoublesAction;
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

/** One Pokémon's HP after the turn's moves (no end of turn), in the HP its bar shows (Dynamax HP while Dynamaxed). */
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
  /** Chance (0–1) it has fainted by the end of the moves; below 1 unless certain (uses-to-ko.ts uncertain). */
  koChance: number;
  /** HP it regains on some outcome, as facts ("Sitrus Berry: +58 HP."). */
  heals: string[];
  /** Chance (0–1) it faints before its own move; set when it has a move and the chance is above 0. */
  faintsBeforeMoving?: number;
};

/** One Pokémon a move reaches. */
export type DoublesHit = {
  slot: DoublesSlotId;
  /** Share of the turn in which this move reached this slot, after redirection, retargeting and failures. */
  reached: number;
  /** "blocked": Protect, Wide Guard, Quick Guard, Telepathy or an absorbing ability stopped it; "no-damage": it reached and dealt nothing (immune). */
  kind: "calculated" | "blocked" | "no-damage";
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
export type DoublesStartRow = { slot: DoublesSlotId; target: DoublesSlotId; row: MoveDamageResult };
export type DoublesIssues = {
  pokemon: Partial<Record<DoublesSlotId, BuildIssue[]>>;
  field: BuildIssue[];
  actions: { slot: DoublesSlotId; message: string }[];
};
export type DoublesStart = Record<DoublesSlotId, { hp: number; maximum: number; settled?: SettledHP } | null>;

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
    hp: Record<DoublesSlotId, DoublesHP | null>;
    startRows: DoublesStartRow[];
    /** §2.3. */
    facts: string[];
  };

// ---------- The turn as finished worlds (calculateDoublesOutcomes; Training AI, SPEC E2) ----------

/** One Pokémon at the end of the moves in one outcome (no end of turn). */
export type DoublesOutcomeMon = {
  /** HP distribution (chances sum to 1) from the world's marginal (doubles-world.ts marginal), ascending by HP. */
  hp: { hp: number; chance: number }[];
  /** The world's MonState.build: stages, status, item, ability, form (currentHP unused). */
  build: BattleBuild;
  /** A protecting move of its succeeded this turn (MonState.protect). */
  protected: boolean;
  /** Its action was picked this turn (MonState.moved). */
  moved: boolean;
};
export type DoublesOutcome = {
  /** The world's mass; outcomes' chances sum to 1. */
  chance: number;
  mons: Partial<Record<DoublesSlotId, DoublesOutcomeMon>>;
  sides: Record<DoublesSideId, { reflect: boolean; lightScreen: boolean; auroraVeil: boolean; tailwind: boolean; faintedThisTurn: number }>;
  field: Pick<BattleConditions, "weather" | "terrain" | "gravity" | "trickRoom" | "wonderRoom" | "magicRoom">;
  /** Within this outcome, the chance every present Pokémon of the side is at 0 HP (from the joint factors); 1 with none present. */
  allFainted: Record<DoublesSideId, number>;
};
export type DoublesOutcomesResult =
  | { status: "issues"; issues: DoublesIssues }
  | { status: "not-estimated"; reason: string }
  | { status: "ready"; start: DoublesStart; outcomes: DoublesOutcome[] };
