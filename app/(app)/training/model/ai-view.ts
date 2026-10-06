import type { DoublesSideId, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";
import type { BeliefWorld } from "./ai-inputs";
import type { TurnRecord } from "./decision";
import type { JointAction, RequestActive } from "./view-types";

/** Engine-oriented side + TrainingMember.key. The AI is always "opponent" in its own view (model/positions.ts). */
export type MonKey = `${DoublesSideId}:${string}`;

/** Turns left as the field stands now (this turn's countdown not applied yet); 0 = off. */
export type FieldClock = {
  weather: { id: BattleConditions["weather"]; turns: number | null } | null;   // null turns: permanent (strong weathers)
  terrain: { id: BattleConditions["terrain"]; turns: number } | null;
  rooms: { trickRoom: number; gravity: number; magicRoom: number; wonderRoom: number };
  sides: Record<DoublesSideId, {
    tailwind: number; reflect: number; lightScreen: number; auroraVeil: number; safeguard: number;
    stealthRock: boolean; spikes: 0 | 1 | 2 | 3; toxicSpikes: 0 | 1 | 2; stickyWeb: boolean;
  }>;
};

export type MonView = {
  key: MonKey; side: DoublesSideId; memberKey: string;
  slot: DoublesSlotId | null;
  /** AI side: true. Player side: has been active (only revealed player members appear in AiView.mons). */
  revealed: boolean;
  fainted: boolean;
  /** AI side: exact. Player side: belief world 0 (Stat Points, nature, item, ability as believed) over the public state. */
  build: BattleBuild;
  hp: number; maxHp: number;
  /** true for the AI's own; for the player's only under the exact-HP test setting. */
  hpExact: boolean;
  accuracyStage: number; evasionStage: number;
  moves: string[];
  /** Active and has not acted since it came in: Fake Out and First Impression work. */
  firstTurn: boolean;
  /** k: its next protecting move succeeds with 3^-k. */
  protectStreak: number;
  /** Public counts (PublicMon.statusElapsed); null unless asleep / frozen. */
  sleepElapsed: number | null; freezeElapsed: number | null;
  lastMove: string | null;
  volatiles: string[];
  canMega: boolean;
};

export type AiRequest =
  | { kind: "move"; active: (RequestActive | null)[] }               // by Showdown position of the AI's side
  | { kind: "switch"; forceSwitch: boolean[]; midTurn: boolean };

export type AiView = {
  perspective: "p1" | "p2";
  turn: number; requestId: number;
  /** Engine orientation: attackerSide = own (the player), defenderSide = opponent (the AI). gameType "Doubles". */
  field: BattleConditions;
  clock: FieldClock;
  /** The AI's brought four and the player's revealed members. Never the player's unrevealed ones. */
  mons: MonView[];
  /** The player's brought members not seen yet, and the sheet members they can be, with bring chances. */
  hidden: { unrevealed: number; candidates: { memberKey: string; chance: number }[] };
  megaUsed: Record<DoublesSideId, boolean>;
  request: AiRequest;
  /** opponent: from the AI's real request. own: from the other side's request in belief world 0, with switches limited to
   *  revealed living members plus at most one UNSEEN_MEMBER option. */
  legal: { opponent: JointAction[]; own: JointAction[] };
  /** The player's revealed members' builds in each belief world (speed-order chances). */
  particles: { weight: number; builds: Partial<Record<MonKey, BattleBuild>> }[];
  history: TurnRecord[];
};

export type CellActions = { own: JointAction; opponent: JointAction };

export type EngineWorld = {
  weight: number;                                   // the worlds' weights sum to 1
  input: DoublesTurnInput;
  /** Which Pokémon stands in each engine slot of this input (a prelude may have switched). */
  keys: Record<DoublesSlotId, MonKey | null>;
  notes: string[];                                  // "Wakes up (1/3).", "Protect fails (2/3)."
};
export type EngineWorlds =
  | { kind: "engine"; source: "live" | "prelude"; worlds: EngineWorld[] }
  | { kind: "rollout"; reasons: string[] }
  /** Belief world 0 rejects this cell's choice strings: the cell is dropped. */
  | { kind: "skip"; reasons: string[] };

/** The AI's own replacement choice inside rollouts (its U-turn, Eject Button): one key per flagged slot, in slot order. */
export type ReplacePolicy = (side: DoublesSideId, slots: DoublesSlotId[], options: MonKey[]) => MonKey[];

export type PostMon = {
  key: MonKey; side: DoublesSideId; slot: DoublesSlotId | null;
  /** false: one of the player's members the AI has not seen (scored at the prior). */
  known: boolean;
  build: BattleBuild;                               // after the turn: form, ability, item, boosts, status
  hp: readonly { hp: number; chance: number }[];    // chances sum to 1
  maxHp: number;
  volatiles: readonly string[];                     // rollouts only
  perishCount?: number;
  sleepTurns?: number;
  protected: boolean;
};
export type PostState = {
  chance: number;
  mons: PostMon[];
  clock: FieldClock;                                // after this turn's countdown
  megaUsed: Record<DoublesSideId, boolean>;
  /** Engine: chance every present Pokémon of the side fainted (E2 allFainted). Rollouts: 0 or 1. */
  wiped: Record<DoublesSideId, number>;
  endOfTurn: "applied" | "estimated";
};

export interface TurnServices {
  readonly view: AiView;
  readonly worlds: readonly BeliefWorld[];
  /** Bridge + splits + prelude on belief world 0 for one pairing. The caller memoises by jointActionKey. */
  engineWorlds(cell: CellActions): EngineWorlds;
  /** One rollout on belief world (sample mod worlds.length); sample n uses the decision's seed n for every cell. */
  rollout(cell: CellActions, sample: number, replace: ReplacePolicy): PostState;
  /** End-of-turn HP change per Pokémon active now, no moves (belief world 0; cached per decision). */
  residual(): Readonly<Record<MonKey, number>>;
  /** World 0's start state with every action "No move", for damage rows and worth. */
  startInput(): DoublesTurnInput;
  /** World 0's start state as a PostState (chance 1, endOfTurn "applied"). */
  current(): PostState;
  /** Public facts a belief battle could not represent ("Substitute HP assumed full."); also in DecisionStats. */
  readonly approximations: readonly string[];
  readonly spent: { builds: number; preludes: number; rollouts: number };
}
