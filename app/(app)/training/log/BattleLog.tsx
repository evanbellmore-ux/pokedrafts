import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BoardView, LogTurn } from "../model/view-types";
import AIReadPanel from "./AIReadPanel";
import { TurnLines, turnTitle } from "./TurnLines";

export type BattleLogProps = {
  log: readonly LogTurn[];
  runtime: BattleRuntime;
  showRead: boolean;
  board: BoardView | null;
  /** A replay's board as each turn began: names a turn's slots when it has no occupants (a battle saved before them). */
  decisionBoards?: Readonly<Record<number, BoardView>>;
  ownName(key: string): string | null;
  headingId: string;
};

/** Every turn, oldest first. Not a live region: the announcer reads the news once (SPEC D10). */
export default function BattleLog({ log, runtime, showRead, board, decisionBoards, ownName, headingId }: BattleLogProps) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel p-3">
      <h2 id={headingId} className="text-base font-semibold text-text">Battle log</h2>
      <ol data-training-log className="mt-2 space-y-3">
        {log.filter((turn) => turn.lines.length || turn.read).map((turn) => (
          <li key={turn.turn} data-training-log-turn={turn.turn} className="min-w-0">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{turnTitle(turn.turn)}</h3>
            <TurnLines lines={turn.lines} />
            {showRead && <AIReadPanel turn={turn} board={board} decisionBoard={decisionBoards?.[turn.turn] ?? null} runtime={runtime} ownName={ownName} />}
          </li>
        ))}
      </ol>
    </div>
  );
}
