// Addendum A1.2: ToWorker "suggest" → FromWorker "suggested" / "suggest-error"; A1.3: ToWorker "move-options" → FromWorker "move-options-ready" / "move-options-error".
import type { DoublesSideId } from "@/app/lib/battle/doubles-types";
import type { HabitsRecord } from "./decision";
import type { EditorMoveOption, SuggestedSet, SuggestMember } from "./usage";
import type { BoardView, LogTurn, PlayerChoice, TeamProblems, TrainingRequest, TrainingSetup } from "./view-types";

export type ToWorker =
  | { type: "load" }
  | { type: "validate"; key: string; setup: TrainingSetup }
  | { type: "start"; battleId: number; setup: TrainingSetup; habits: HabitsRecord | null }
  | { type: "choose"; battleId: number; requestId: number; choice: PlayerChoice }
  | { type: "forfeit"; battleId: number }
  | { type: "stop"; battleId: number }
  /** Addendum A1.2: suggested sets for one side's league members, in team order (Item Clause takes items in that order). */
  | { type: "suggest"; key: string; side: DoublesSideId; members: SuggestMember[] }
  /** Addendum A1.3: the set editor's move list for one species. */
  | { type: "move-options"; speciesId: string };

export type FromWorker =
  | { type: "loaded"; ms: number }
  | { type: "load-error"; message: string }
  | { type: "validated"; key: string; own: TeamProblems; opponent: TeamProblems }
  | { type: "validate-error"; key: string; message: string }
  | {
    type: "battle"; battleId: number;
    /** null until the battle ends (it would predict rolls). */
    seed: string | null;
    /** Your request; { kind: "wait" } while only the AI chooses; null once ended. */
    request: TrainingRequest | null;
    /** Built per setup.info.youSee (section 9.7). */
    board: BoardView;
    /** Changed and new turns since the last message; the store replaces by turn number. */
    log: LogTurn[];
    ended: { result: "win" | "loss" | "tie"; forfeited: boolean } | null;
    habits?: HabitsRecord;
  }
  | { type: "choice-error"; battleId: number; requestId: number; message: string; request?: TrainingRequest }
  | { type: "ai"; battleId: number; requestId: number; status: "thinking" | "locked" | "fallback" | "error"; message?: string }
  | { type: "battle-error"; battleId: number; message: string }
  /** Addendum A1.2: one set per requested member, in the request's order. */
  | { type: "suggested"; key: string; side: DoublesSideId; sets: SuggestedSet[] }
  | { type: "suggest-error"; key: string; side: DoublesSideId; message: string }
  /** Addendum A1.3: every legal move of the species, usage order first, then A–Z. */
  | { type: "move-options-ready"; speciesId: string; moves: EditorMoveOption[] }
  | { type: "move-options-error"; speciesId: string; message: string };

export type TrainingTransport = {
  post(message: ToWorker): void;
  onMessage(listener: (message: FromWorker) => void): () => void;
  terminate(): void;
};
