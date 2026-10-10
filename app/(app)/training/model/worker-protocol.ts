// Addendum A1.2: ToWorker "suggest" → FromWorker "suggested" / "suggest-error"; A1.3: ToWorker "move-options" → FromWorker "move-options-ready" / "move-options-error".
// Saved battles: FromWorker "checkpoint" (the sealed autosave of each resolved turn), ToWorker "resume" (rebuild it, then
// continue) and "replay" → FromWorker "replay-ready" / "replay-error" (re-run a finished battle from its seed and choices).
import type { DoublesSideId } from "@/app/lib/battle/doubles-types";
import type { HabitsRecord } from "./decision";
import type { EditorMoveOption, SuggestedSet, SuggestMember } from "./usage";
import type { RerunTurn } from "./saved-battle";
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
  | { type: "move-options"; speciesId: string }
  /** An unfinished battle from its sealed checkpoint: rebuilt by replaying its choices, then played on. `log`: the saved log (its reads). */
  | { type: "resume"; battleId: number; setup: TrainingSetup; sealed: string; log: LogTurn[] }
  /** A finished battle re-run for the replay screen; the teams are validated first (an import file is untrusted). */
  | { type: "replay"; replayId: number; setup: TrainingSetup; seed: string; inputLog: string[]; forfeited: boolean };

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
    /** Once ended: the simulator's choice lines (both sides, committed turns only), for the saved battle's replay. */
    inputLog?: string[];
  }
  /**
   * After each turn resolves (turn = the turn that begins): the battle sealed for Resume (its seed, both sides' choices, the AI's
   * seed base, the habits at the start), encrypted with this browser's key; null when it could not be sealed.
   */
  | { type: "checkpoint"; battleId: number; turn: number; sealed: string | null }
  /**
   * The board as each turn began and after the last one (built per setup.info.youSee), the re-run log's hashes (its text and
   * its wording-free shape, saved-battle.ts logShapeHash), its written turns (lines and steps: a saved log that differs only
   * in wording takes them) and the re-run's result.
   */
  | {
    type: "replay-ready"; replayId: number; starts: Record<number, BoardView>; end: BoardView; hash: string; turnHashes: Record<number, string>;
    shape: string; turnShapes: Record<number, string>; turns: RerunTurn[];
    result: { result: "win" | "loss" | "tie"; forfeited: boolean };
  }
  | { type: "replay-error"; replayId: number; message: string }
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
