import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BoardView, LogTurn } from "../model/view-types";
import AIReadPanel from "./AIReadPanel";
import { TurnLines, turnTitle } from "./TurnLines";

/** The latest resolved turn above the board (hidden from 64rem, where the log column shows it). */
export default function LastTurn({ turn, runtime, showRead, board, ownName }: {
  turn: LogTurn | null; runtime: BattleRuntime; showRead: boolean; board: BoardView | null; ownName(key: string): string | null;
}) {
  if (!turn) return null;
  return (
    <section data-training-last-turn aria-label={`Last turn · ${turnTitle(turn.turn)}`} className="min-w-0 rounded-xl border border-line bg-panel p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Last turn · {turnTitle(turn.turn)}</p>
      <div className="mt-1"><TurnLines lines={turn.lines} /></div>
      {showRead && <AIReadPanel turn={turn} board={board} runtime={runtime} ownName={ownName} />}
    </section>
  );
}
