// Addendum A1.2/A1.3: TrainingMember origin "edited" + suggestion, TeamSourceDraft.edits, MemberEdit, SuggestionState, MoveOptionsState, TrainingSnapshot.suggestions/.moveOptions; A1.5: DecisionReport.mega (MegaFact), megaSlots, withoutMega. Your trends: TrainingSnapshot.habits.data/.trendsOpen, TrainingBattle.habitsBefore.
import { DOUBLES_SLOTS, type DoublesSideId, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { MoveSlots } from "@/app/lib/battle/move-defaults";
import type { BattleBuild, BattleStat, BattleStatus, CombatStat } from "@/app/lib/battle/types";
import type { AppliedPaste } from "@/app/(app)/calculator/roster-prep";
import type { ImportDraft } from "@/app/(app)/calculator/PokePasteImporter";
import type { HabitsData } from "./habits-data";
import type { InfoSettings } from "./info";
import type { ReplayState, SavedBattlesState } from "./saved-battle";
import type { ShowdownActiveData, ShowdownMoveData, ShowdownSidePokemon } from "./showdown-types";
import type { EditorMoveOption, SuggestedSet, SuggestionSource } from "./usage";

// The Training page/worker contract: types, constants and pure helpers. No engine, simulator or React imports.

export const TRAINING_FORMAT_ID = "gen9championsvgc2026regmc";
export type TrainingDifficulty = "safe" | "reads";

// ---------- Setup ----------
export type TrainingMember = {
  /** RosterSource.key (league) or the paste choice key; unique per team (Species Clause makes speciesId unique too). */
  key: string;
  name: string;
  speciesId: string;
  /** The calculator build, nature already passed through showdownNature (model/sets.ts). */
  build: BattleBuild;
  moves: MoveSlots;
  /** Addendum A1.3: "edited" once the set editor changed it (it is then neither the suggestion nor the paste). */
  origin: "suggested" | "imported" | "edited";
  /** Addendum A1.2: how the suggested set was made; present only with origin "suggested". */
  suggestion?: { source: SuggestionSource; protectAdded: boolean };
  spriteName?: string;
};
export type TrainingTeam = { label: string; members: TrainingMember[] }; // exactly 6 at start
export type TrainingSetup = {
  own: TrainingTeam; opponent: TrainingTeam; difficulty: TrainingDifficulty; showRead: boolean;
  info: InfoSettings;
};
export type TeamSourceDraft = {
  mode: "league" | "paste";
  paste: AppliedPaste | null;
  pasteDraft: ImportDraft | null;
  /** PokePasteImporter owner epoch: bumps on mode change, Apply and Remove. */
  epoch: number;
  /** Chosen member keys in order; null = the first six eligible. */
  chosen: string[] | null;
  /** Addendum A1.3: set editor results by TrainingMember.key; each replaces that member's suggested or imported set. */
  edits: Readonly<Record<string, MemberEdit>>;
};
/** Addendum A1.3: a member's set as the set editor left it (the calculator's build controls edit a BattleBuild and MoveSlots). */
export type MemberEdit = { build: BattleBuild; moves: MoveSlots };
export type SetupDraft = {
  own: TeamSourceDraft; opponent: TeamSourceDraft; difficulty: TrainingDifficulty; showRead: boolean;
  info: InfoSettings;
};
export type TeamProblems = { team: string[]; members: Record<string, string[]> };
export type SetupValidation =
  | { status: "idle" }
  | { status: "checking"; key: string }
  | { status: "ready"; key: string; own: TeamProblems; opponent: TeamProblems }
  | { status: "error"; key: string; message: string };
/** Addendum A1.2: the worker's suggested sets for one side's league members (stale keys dropped, as SetupValidation). */
export type SuggestionState =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; sets: Readonly<Record<string, SuggestedSet>> }   // by TrainingMember.key
  | { status: "error"; key: string; message: string };
/** Addendum A1.3: the set editor's move list for one species (every legal move, usage order first, then A–Z). */
export type MoveOptionsState =
  | { status: "loading" }
  | { status: "ready"; moves: readonly EditorMoveOption[] }
  | { status: "error"; message: string };

// ---------- Requests for p1, normalized by the worker ----------
export type RequestMove = ShowdownMoveData;
export type RequestActive = ShowdownActiveData;
export type RequestPokemon = ShowdownSidePokemon;
/** `id` is the worker's request number: new for every new request, unchanged by a rejected choice. */
export type PreviewRequest = { kind: "team-preview"; id: number; maxChosenTeamSize: number; side: RequestPokemon[] };
export type MoveRequest = { kind: "move"; id: number; active: (RequestActive | null)[]; side: RequestPokemon[] };
export type SwitchRequest = { kind: "switch"; id: number; forceSwitch: boolean[]; midTurn: boolean; side: RequestPokemon[] };
export type WaitRequest = { kind: "wait"; id: number; side: RequestPokemon[] };
export type TrainingRequest = PreviewRequest | MoveRequest | SwitchRequest | WaitRequest;

// ---------- Board: what you can see ----------
export type HPView =
  | { kind: "exact"; current: number; maximum: number }
  | { kind: "percent"; percent: number; color?: "g" | "y" | "r" };
/** "unknown": closed for you and not shown yet; "none": shown to hold no item. */
export type ItemView =
  | { state: "unknown" }
  | { state: "none" }
  | { state: "held" | "consumed" | "removed"; id: string; name: string };
export type PokemonView = {
  key: string;                    // TrainingMember.key
  ident: string;                  // "p1: Garchomp"
  side: DoublesSideId;
  slot: DoublesSlotId | null;     // null on the bench / not brought
  speciesId: string; name: string; types: string[];
  hp: HPView; fainted: boolean; status: BattleStatus;
  boosts: Partial<Record<CombatStat | "accuracy" | "evasion", number>>;
  /** Display names from the board whitelist (section 9.6), e.g. "Confusion", "Substitute", "Taunt", "Protect". */
  volatiles: string[];
  /** Yours: always known. The AI's: per InfoSettings.youSee and what the battle showed. */
  item: ItemView;
  ability: { id: string; name: string } | null;
  nature: string | null;
  points: Record<BattleStat, number> | null;
  /** Yours: the four, with PP. The AI's: the sheet's four when Moves are open, else the moves it has used. */
  moves: { id: string; name: string; pp?: number; maxpp?: number }[];
  /** The AI's with Moves closed: how many of its moves you have not seen. */
  unseenMoves?: number;
  mega: boolean;
  /** The AI's: has been active. Yours: true for the four brought. */
  revealed: boolean;
  /** The AI's under the "brought" test setting: true for its four, false for the other two; otherwise null. Yours: true. */
  brought: boolean | null;
  commanding?: boolean;
};
export type FieldEffectView = { id: string; name: string; turns: number | null };
export type FieldView = {
  weather: FieldEffectView | null; terrain: FieldEffectView | null;
  rooms: FieldEffectView[];
  sides: Record<DoublesSideId, FieldEffectView[]>;
};
export type BoardView = {
  turn: number;
  active: Record<DoublesSlotId, PokemonView | null>;
  /** Own: the four brought, in sheet order. Opponent: its six sheet entries (the unbrought ones are never revealed). */
  team: Record<DoublesSideId, PokemonView[]>;
  field: FieldView;
  megaUsed: Record<DoublesSideId, boolean>;
  /**
   * Member keys (both sides) whose battle name is on both teams (the two sixes of the team preview, so fixed for the battle):
   * their cards and the text that names them carry "(yours)" / "(opponent's)".
   */
  mirrored: string[];
};

// ---------- Actions ----------
export type MegaMechanic = "mega" | "megax" | "megay";
export type SlotAction =
  | { kind: "move"; moveId: string; target: DoublesSlotId | null; mega?: MegaMechanic }
  | { kind: "switch"; to: string }            // TrainingMember.key, or UNSEEN_MEMBER (model/ai-inputs.ts) inside the AI
  | { kind: "pass" };
/** Slots in engine orientation: for the board and the worker protocol, own = you (p1), opponent = the AI (p2). */
export type JointAction = Partial<Record<DoublesSlotId, SlotAction>>;
/** team: 1-based indices into setup.own.members, maxChosenTeamSize entries, the first two lead. */
export type PlayerChoice = { kind: "team"; order: number[] } | { kind: "action"; action: JointAction };

export function slotActionKey(action: SlotAction): string {
  if (action.kind === "move") return `move:${action.moveId}:${action.target ?? "-"}${action.mega ? `:${action.mega}` : ""}`;
  return action.kind === "switch" ? `switch:${action.to}` : "pass";
}
export function jointActionKey(action: JointAction): string {
  return DOUBLES_SLOTS.map((slot) => { const each = action[slot]; return each ? `${slot}=${slotActionKey(each)}` : ""; }).filter(Boolean).join(";");
}
/** Addendum A1.5: the slots whose move carries a Mega Evolution (one per side per battle: PS/sim/side.ts:779-781, PS/sim/battle-actions.ts:1898-1916). */
export function megaSlots(action: JointAction): DoublesSlotId[] {
  return DOUBLES_SLOTS.filter((slot) => { const each = action[slot]; return each?.kind === "move" && !!each.mega; });
}
/** Addendum A1.5: the same action without any Mega Evolution (the non-Mega candidate of a Mega option). */
export function withoutMega(action: JointAction): JointAction {
  const result: JointAction = {};
  for (const slot of DOUBLES_SLOTS) {
    const each = action[slot];
    if (each) result[slot] = each.kind === "move" && each.mega ? { kind: "move", moveId: each.moveId, target: each.target } : each;
  }
  return result;
}

// ---------- Log and AI read ----------
export type LogLineKind = "move" | "switch" | "damage" | "heal" | "faint" | "status" | "boost" | "field" | "item" | "ability" | "form" | "fail" | "info" | "result";
export type LogLine = { text: string; kind: LogLineKind; slots: DoublesSlotId[] };
/** action null: an option that would show you a closed fact of the AI's team ("Not shown"). */
export type DecisionOption = { action: JointAction | null; chance: number };
/**
 * Addendum A1.5: the turn's Mega Evolution fact for the AI's side. worker/redact-report.ts sets DecisionReport.mega to null
 * when it would show you a closed fact: the stone while youSee.open.items is false and the battle has not shown it (evolved
 * false), or a named move while youSee.open.moves is false and the AI has not used it.
 */
export type MegaFact = {
  /** The AI's member the fact names (TrainingMember.key). */
  memberKey: string;
  /** true: it Mega Evolved this turn; false: it kept the Mega Evolution. */
  evolved: boolean;
  /** The AI's move ids the text names. */
  moves: string[];
  /** One fact sentence: "Kept Mega Evolution: Garchomp-Mega would not change this turn's KOs." / "Mega Evolved Charizard: Drought before Heat Wave." */
  text: string;
};
/** The AI's members and moves one read sentence names, for worker/redact-report.ts (never posted to the page). */
export type ReadRefs = {
  /** The AI's members it names as standing in a slot at the decision (TrainingMember.key). */
  inSlot: { memberKey: string; slot: DoublesSlotId }[];
  /** The AI's members it names as switching in. */
  incoming: string[];
  /** The AI's moves it names or implies, by member. */
  moves: { memberKey: string; moveId: string }[];
  /** It rests on the AI's Stat Points and nature (a Speed order, a KO chance). */
  stats: boolean;
};
export type ReadFact = { text: string; refs: ReadRefs };
export type DecisionReport = {
  turn: number;                                  // 0: team preview
  provider: "engine" | "jev" | "engine-fallback";
  difficulty: TrainingDifficulty;
  predicted: DecisionOption[];                   // your joint actions, most likely first, at most 3
  strategy: DecisionOption[];                    // its purified mixed strategy, most likely first
  chosen: number;                                // index into strategy
  /** The predicted chance of what you actually did; null when it was not among the evaluated options. */
  actual: { chance: number | null } | null;
  /** One fact sentence or null (section 10.12). */
  reason: string | null;
  /** Addendum A1.5: null at team preview, when the AI had no Mega Evolution available this turn, or once redacted. */
  mega: MegaFact | null;
  /**
   * Every read sentence and Mega fact that applied, in rule order, with what each names: `reason` and `mega` are their
   * first entries. The worker states the first one that shows you no closed fact and removes both lists.
   */
  facts?: { reasons: ReadFact[]; mega: (MegaFact & { refs: ReadRefs })[] };
  /** The AI's most likely spread for each of your active Pokémon when Stat Points are closed to it: "Garchomp: 2 HP / 32 Atk / 32 Spe · Jolly (64%)". */
  assumed: string[];
  elapsedMs: number;
  evaluated: { yours: number; its: number };
  preview?: { predictedLeads: { keys: string[]; chance: number }[] };
};
// ---------- Turn playback: the board replays each resolved turn one action at a time ----------
/** One Pokémon's change in a step, from the p1 channel (your HP exact, the AI's as the percentage it shows). */
export type StepSlot = {
  slot: DoublesSlotId;
  /** The member in that slot after the step (TrainingMember.key) and its log name. */
  key: string;
  name: string;
  /** It came into this slot during the step (a switch, a replacement, a drag, Ally Switch): its HP then is hp.from. */
  entered?: true;
  /** HP before and after the step (both always present when HP changed or it entered); `low` when it dipped below both
   * in the step (a hit, then its Sitrus Berry). */
  hp?: { from: HPView; to: HPView; low?: HPView };
  fainted?: true;
  /** Its status after the step, when the step changed it ("" when cured). */
  status?: BattleStatus;
  /** Its stat stages after the step, when the step changed them (stages at 0 left out). */
  boosts?: PokemonView["boosts"];
  /** It Mega Evolved. */
  mega?: true;
  /** Facts for its card during the step: "Burned", "Attack +2", "Protected", "Missed", "No effect", "Super effective", "Life Orb". */
  facts: string[];
};
export type TurnStep = {
  kind: "move" | "switch" | "cant" | "mega" | "end" | "effect";
  /** "Rock Slide", "Dragonite switches for Blastoise", "U-turn: Staraptor switches for Venusaur", "Charizard Mega Evolves", "End of turn". */
  title: string;
  /** The move's user when the highlighted cards do not show who acted (a move on another Pokémon); else null. */
  by: string | null;
  /** Results not tied to one card: "Failed", "No target", "Missed", "Hit 3 times"; at the end of turn "Snow ended". */
  results: string[];
  /** The move's type ("Rock") for the highlight colour; null for switches, Mega Evolution, the end of turn and the rest. */
  type: string | null;
  /** The cards to highlight: the move's targets (its user for a move on itself), the Pokémon that came in, the ones that changed at the end of turn. */
  targets: DoublesSlotId[];
  /** The move's user, when the step is a move. */
  actor: DoublesSlotId | null;
  slots: StepSlot[];
};

/** turn 0 = "Start" (leads, entry abilities). */
export type LogTurn = {
  turn: number;
  lines: LogLine[];
  /** The turn's actions as steps for the board's playback, in protocol order (log/protocol-steps.ts); absent before the worker sends any. */
  steps?: TurnStep[];
  /** Both sides' actions, once the turn resolved; the AI's with hidden slot actions removed (section 9.7). */
  actions: { own: JointAction; opponent: JointAction } | null;
  /** Only once the turn resolved (the store also strips an early one). */
  read: DecisionReport | null;
  /**
   * The member (TrainingMember.key) in each slot when the turn's actions were chosen: yours from your request, the AI's as
   * your log showed them. The AI's read and the actions name each slot by it. Absent in battles saved before it existed.
   */
  occupants?: Partial<Record<DoublesSlotId, string>>;
  /**
   * Each occupant's full name on the board the turn's actions were chosen on ("Ditto", "Garchomp (yours, 2)": occupantNames),
   * so the AI's read and the actions keep that turn's names after a later Transform, Mega Evolution or switch. Absent in
   * battles saved before it existed (the occupants then name the slots).
   */
  names?: Partial<Record<DoublesSlotId, string>>;
};

// ---------- Session snapshot ----------
export type EngineLoad = { status: "idle" | "loading" | "ready" | "error"; message?: string };
export type AIStatus = { status: "idle" | "thinking" | "locked" | "fallback" | "error"; message?: string };
export type TrainingPhase =
  | { kind: "starting" }
  | { kind: "preview"; request: PreviewRequest; error?: string }
  | { kind: "choose"; request: MoveRequest; error?: string }
  | { kind: "switch"; request: SwitchRequest; error?: string }
  | { kind: "waiting"; reason: "simulating" | "opponent-switch" }
  | { kind: "ended"; result: "win" | "loss" | "tie"; forfeited: boolean };
export type TrainingBattle = {
  id: number; setup: TrainingSetup; seed: string | null;
  phase: TrainingPhase; board: BoardView | null; log: LogTurn[]; ai: AIStatus;
  /** The previous battle's team order (1-based), for "Same as last battle". */
  lastPreview: number[] | null;
  /** The habits sent with this battle's start (empty when none): "Your usual" at the battle end. */
  habitsBefore: HabitsData;
  /** Saved battles: the record this battle autosaves to, its start time, and whether it was resumed from a reload. */
  savedId: string;
  startedAt: number;
  resumed?: boolean;
};
export type TrainingSnapshot = {
  revision: number;
  engine: EngineLoad;
  draft: SetupDraft;
  validation: SetupValidation;
  /** The stored habits: the decayed turn count and the parsed data (empty when none), for "Your trends". */
  habits: { turns: number; data: HabitsData };
  /** "Your trends" open on the setup screen (remembered per browser and account). */
  trendsOpen: boolean;
  setupError: string | null;
  battle: TrainingBattle | null;
  /** Addendum A1.2: suggested sets per side, from the worker (usage data is loaded only there). */
  suggestions: Record<DoublesSideId, SuggestionState>;
  /** Addendum A1.3: set editor move lists by speciesId, requested when an editor opens. */
  moveOptions: Readonly<Record<string, MoveOptionsState>>;
  /** Saved battles in this browser (the setup screen's list, Resume, import) and the replay screen when one is open. */
  saved: SavedBattlesState;
  replay: ReplayState | null;
};
