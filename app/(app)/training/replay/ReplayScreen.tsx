"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Alert, Button } from "@/app/components/ui";
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import BattleBoard from "../board/BattleBoard";
import type { CardPlay } from "../board/BattleCard";
import BenchStrip from "../board/BenchStrip";
import { boardNames, remaining } from "../board/board-format";
import { cardLabels, highlightColour, spokenName, stepAnnouncement } from "../board/playback";
import TurnPopup from "../board/TurnPopup";
import AIReadPanel from "../log/AIReadPanel";
import BattleAnnouncer from "../log/BattleAnnouncer";
import BattleLog from "../log/BattleLog";
import { TurnLines, turnTitle } from "../log/TurnLines";
import { infoFact } from "../model/info";
import { resultText, turnsText, type ReplayState } from "../model/saved-battle";
import type { BoardView, LogTurn } from "../model/view-types";
import { downloadText, isoTime, savedDate } from "../saved/download";
import type { TrainingSession } from "../training-session";
import styles from "../training.module.css";
import { positionText, replayTurns, stepRole, type ReplaySpeed } from "./replay-playback";
import { useReplayPlayback } from "./useReplayPlayback";

export type ReplayScreenProps = {
  runtime: BattleRuntime;
  replay: ReplayState;
  session: Pick<TrainingSession, "closeReplay" | "exportSaved">;
};

const DIFFICULTY = { safe: "Plays safe", reads: "Reads you" } as const;
/** Looks disabled while it stays focusable (aria-disabled): a disabled button would drop keyboard focus at the first or last turn. */
const UNAVAILABLE = "aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

/** The saved battle's facts: when, the teams, the result, the turns, the difficulty and what you saw. */
function ReplayFacts({ replay }: { replay: ReplayState }) {
  const { summary, setup } = replay;
  return (
    <div className="min-w-0 space-y-0.5 text-sm">
      <p className="wrap-anywhere text-text">{summary.own} vs {summary.opponent}</p>
      <p className="wrap-anywhere tabular-nums text-muted">
        <time dateTime={isoTime(summary.createdAt)}>{savedDate(summary.createdAt)}</time>
        {` · ${resultText(summary)} · ${turnsText(summary)} · ${DIFFICULTY[setup.difficulty]}${summary.source === "imported" ? " · Imported" : ""}`}
      </p>
      <p className="wrap-anywhere text-xs text-muted">You saw: {infoFact(setup.info.youSee)}</p>
    </div>
  );
}

/** The board with the replay's controls: Previous / Play–Pause / Next turn, the turn slider and 1× / 2×. */
function ReplayBoard({ runtime, replay, boards }: { runtime: BattleRuntime; replay: ReplayState; boards: NonNullable<ReplayState["boards"]> }) {
  const id = useId();
  const turns = useMemo(() => replayTurns(replay.log, boards), [replay.log, boards]);
  const playback = useReplayPlayback(turns, boards.end);
  const { board, step, position } = playback;
  const resolving = !!step && position.beat !== "announce";
  const cardPlay = (slot: DoublesSlotId): CardPlay | null => step ? {
    role: stepRole(step.step, slot, resolving),
    colour: highlightColour(step.step),
    labels: resolving ? cardLabels(step.step, slot) : [],
    animate: !playback.reducedMotion,
  } : null;
  // As in the battle: before a turn's steps play, the last turn that resolved (its lines and the AI's read came after it);
  // while they play, that turn; after the end, the last one.
  const shown = (entry: LogTurn) => entry.lines.length > 0 || !!entry.read;
  const resolvedBefore = (turn: number) => replay.log.filter((entry) => entry.turn < turn && shown(entry)).at(-1) ?? null;
  const shownTurn = playback.turn === null ? replay.log.filter(shown).at(-1) ?? null
    : position.beat === "idle" ? resolvedBefore(playback.turn)
      : replay.log.find((entry) => entry.turn === playback.turn) ?? null;
  // The board as that turn's read was shown: right after the turn resolved. Its slots are named by the turn's occupants, or
  // (a battle saved before they were recorded) by the board its actions were chosen on.
  const readBoard = shownTurn ? boards.starts[shownTurn.turn + 1] ?? boards.end : boards.end;
  const decisionBoard = shownTurn ? boards.starts[shownTurn.turn] ?? null : null;
  const where = positionText(turns, position);
  const atStart = position.at === 0 && position.beat === "idle";
  const atEnd = position.at >= turns.length;
  const stepText = step ? ` · step ${step.index + 1} of ${turns[position.at]?.steps.length ?? 0}` : "";
  // The live region: each step once as its popup shows (as in a battle), else where the replay stands.
  const announce = step && position.beat === "announce"
    ? stepAnnouncement(step.step, (slot, key) => spokenName(playback.stepStart ?? board, slot, key))
    : position.playing && step ? "" : playback.turn === null ? `End. ${resultText(replay.summary)}.` : `${where}.`;
  const ownNames = new Map(replay.setup.own.members.map((member) => [member.key, member.name]));
  const speeds: ReplaySpeed[] = [1, 2];
  return (
    <>
      <div className={styles.main}>
        <div data-training-replay-controls className="min-w-0 space-y-2 rounded-xl border border-line bg-panel p-2 sm:p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" className={`min-h-11 ${UNAVAILABLE}`} aria-label="Previous turn" aria-disabled={atStart || undefined}
              onClick={() => { if (!atStart) playback.previous(); }}>
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />Previous
            </Button>
            {position.playing
              ? <Button size="sm" className="min-h-11" onClick={playback.pause}><Pause aria-hidden="true" className="h-4 w-4" />Pause</Button>
              : <Button size="sm" className="min-h-11" disabled={!turns.length} onClick={playback.play}><Play aria-hidden="true" className="h-4 w-4" />Play</Button>}
            <Button variant="secondary" size="sm" className={`min-h-11 ${UNAVAILABLE}`} aria-label="Next turn" aria-disabled={atEnd || undefined}
              onClick={() => { if (!atEnd) playback.next(); }}>
              Next<ChevronRight aria-hidden="true" className="h-4 w-4" />
            </Button>
            <div role="group" aria-label="Speed" className="ms-auto flex gap-1">
              {speeds.map((speed) => (
                <Button key={speed} variant={playback.speed === speed ? "primary" : "secondary"} size="sm" className="min-h-11 min-w-11" aria-pressed={playback.speed === speed}
                  onClick={() => playback.setSpeed(speed)}>{speed}×</Button>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <label htmlFor={`${id}-turn`} className="shrink-0 text-sm font-medium text-text">Turn</label>
            <input id={`${id}-turn`} type="range" min={0} max={turns.length} step={1} value={position.at} aria-valuetext={where}
              onChange={(event) => playback.seek(Number(event.target.value))}
              className="h-11 min-w-0 flex-1 basis-40 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" />
            <output htmlFor={`${id}-turn`} data-training-replay-position className="shrink-0 text-sm tabular-nums text-muted">{where}{stepText}</output>
          </div>
          <p className="text-sm tabular-nums text-muted">You: {remaining(board, "own")} left · AI: {remaining(board, "opponent")} left</p>
        </div>
        <BattleBoard board={board} cardPlay={step ? cardPlay : undefined}
          popup={step && position.beat === "announce" ? <TurnPopup key={`${step.turn}:${step.index}`} step={step.step} actorName={step.step.actor ? boardNames(board)[step.step.actor] || null : null} /> : undefined} />
        <BenchStrip board={board} />
        {shownTurn && (
          <section data-training-replay-turn aria-label={turnTitle(shownTurn.turn)} className="min-w-0 rounded-xl border border-line bg-panel p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{turnTitle(shownTurn.turn)}</p>
            <div className="mt-1"><TurnLines lines={shownTurn.lines} /></div>
            {replay.setup.showRead && <AIReadPanel turn={shownTurn} board={readBoard} decisionBoard={decisionBoard} runtime={runtime} ownName={(key) => ownNames.get(key) ?? null} />}
          </section>
        )}
      </div>
      <BattleAnnouncer message={announce} />
    </>
  );
}

/** A saved battle replayed turn by turn on the board you saw (your channel and "You see" only), with its log and the AI's reads as shown. */
export default function ReplayScreen({ runtime, replay, session }: ReplayScreenProps) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [exported, setExported] = useState<string | null>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const ownNames = new Map(replay.setup.own.members.map((member) => [member.key, member.name]));
  const exportFile = async () => {
    const file = await session.exportSaved(replay.id);
    if (file) setExported(downloadText(file.name, file.text) ? `Exported ${file.name}.` : "The browser did not save the file.");
  };
  const end: BoardView | null = replay.boards?.end ?? null;
  return (
    <div data-training-screen="replay" className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h2 ref={heading} tabIndex={-1} className="rounded text-xl font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Replay</h2>
          <ReplayFacts replay={replay} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" className="min-h-11" onClick={() => void exportFile()}>Export</Button>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={session.closeReplay}>Close replay</Button>
        </div>
      </header>
      <div role="status" className="text-sm text-text empty:hidden">{exported ?? ""}</div>
      {replay.status === "loading" && <p role="status" className="text-sm text-muted">Re-running the battle…</p>}
      {replay.status === "log" && replay.message && <Alert variant="warning" title={replay.message} />}
      <div className={styles.battle}>
        {replay.status === "board" && replay.boards ? <ReplayBoard runtime={runtime} replay={replay} boards={replay.boards} /> : <div className={styles.main} />}
        <aside aria-labelledby={`${id}-log`} className={styles.logColumn}>
          <BattleLog log={replay.log} runtime={runtime} showRead={replay.setup.showRead} board={end} decisionBoards={replay.boards?.starts} ownName={(key) => ownNames.get(key) ?? null} headingId={`${id}-log`} />
        </aside>
      </div>
    </div>
  );
}
