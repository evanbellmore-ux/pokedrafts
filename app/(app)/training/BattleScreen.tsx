"use client";

import { useEffect, useId, useRef } from "react";
import { Alert, Button } from "@/app/components/ui";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { useTurnControls } from "./actions/useTurnControls";
import AIStatusPill from "./board/AIStatusPill";
import BattleBoard from "./board/BattleBoard";
import type { CardPlay } from "./board/BattleCard";
import BenchStrip from "./board/BenchStrip";
import { remaining } from "./board/board-format";
import PlaybackBar from "./board/PlaybackBar";
import { cardLabels, highlightColour, spokenName, stepAnnouncement } from "./board/playback";
import TurnPopup from "./board/TurnPopup";
import { useTurnPlayback } from "./board/useTurnPlayback";
import BattleEnd from "./end/BattleEnd";
import { announcement, latestResolved, logText } from "./log/announcement";
import BattleAnnouncer from "./log/BattleAnnouncer";
import BattleLog from "./log/BattleLog";
import LastTurn from "./log/LastTurn";
import type { HabitsData } from "./model/habits-data";
import type { BoardView, TrainingBattle } from "./model/view-types";
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { TrainingSession } from "./training-session";
import styles from "./training.module.css";

export type BattleScreenProps = {
  runtime: BattleRuntime;
  battle: TrainingBattle;
  session: Pick<TrainingSession, "choose" | "forfeit" | "rematch" | "changeTeams">;
  /** The stored habits now, for the battle end's comparison with battle.habitsBefore. */
  habits: HabitsData;
};

const EMPTY_BOARD: BoardView = {
  turn: 0,
  active: { "own-left": null, "own-right": null, "opponent-left": null, "opponent-right": null },
  team: { own: [], opponent: [] },
  field: { weather: null, terrain: null, rooms: [], sides: { own: [], opponent: [] } },
  megaUsed: { own: false, opponent: false },
};

/**
 * Turns, forced switches and the end: header, last turn, board with your controls, bench, log, one live region. A turn that
 * resolves plays on the board first, one step at a time (board/useTurnPlayback.ts): a popup with the move, then its results
 * on the cards. Your controls come back after it.
 */
export default function BattleScreen({ runtime, battle, session, habits }: BattleScreenProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const board = battle.board ?? EMPTY_BOARD;
  const phase = battle.phase;
  const controls = useTurnControls({ runtime, board, phase, ai: battle.ai, onSubmit: session.choose });
  const ended = phase.kind === "ended";
  const playback = useTurnPlayback(battle);
  const playing = playback.playing;
  const shown = playback.board ?? board;
  const step = playback.step;
  // The popup first (the move's user framed), then the targets framed in the move's colour with their results.
  const resolving = playback.beat !== "announce";
  const cardPlay = (slot: DoublesSlotId): CardPlay | null => step ? {
    role: resolving && step.step.targets.includes(slot) ? "target" : step.step.actor === slot ? "actor" : null,
    colour: highlightColour(step.step),
    labels: resolving ? cardLabels(step.step, slot) : [],
    animate: !playback.reducedMotion,
  } : null;
  const skip = () => {
    playback.skip();
    headingRef.current?.focus({ preventScroll: true });
  };
  const requestId = phase.kind === "choose" || phase.kind === "switch" ? phase.request.id : null;
  const error = phase.kind === "choose" || phase.kind === "switch" ? phase.error : undefined;
  // A new request moves focus to the turn heading when focus was on the page body or inside the form, never out of the log.
  useEffect(() => {
    if (requestId === null) return;
    const active = document.activeElement;
    if (!active || active === document.body || formRef.current?.contains(active)) headingRef.current?.focus();
  }, [requestId]);
  // A turn that starts playing brings the board into view at once when its top is off screen (on a phone the last turn's text
  // sits above it), so its first popup is seen. When it ends, focus left on Skip (or anywhere the playback removed) goes to
  // the turn heading without scrolling away from the board and your controls.
  const boardRef = useRef<HTMLDivElement>(null);
  const wasPlaying = useRef(playing);
  useEffect(() => {
    if (playing && !wasPlaying.current && boardRef.current) {
      const top = boardRef.current.getBoundingClientRect().top;
      const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-nav-height")) || 0;
      if (top < nav || top > window.innerHeight / 2) boardRef.current.scrollIntoView({ block: "start" });
    }
    if (wasPlaying.current && !playing) {
      const active = document.activeElement;
      if (!active || active === document.body) headingRef.current?.focus({ preventScroll: true });
    }
    wasPlaying.current = playing;
  }, [playing]);
  const ownNames = new Map(battle.setup.own.members.map((member) => [member.key, member.name]));
  const ownName = (key: string) => ownNames.get(key) ?? null;
  const showRead = battle.setup.showRead;
  const turn = step ? step.turn : Math.max(1, board.turn);

  return (
    <div data-training-screen="battle" className={styles.battle}>
      <div className={styles.main}>
        <header data-training-turn className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 ref={headingRef} tabIndex={-1} className="rounded text-xl font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Turn {turn}</h2>
            {battle.board && <p className="text-sm tabular-nums text-muted">You: {remaining(shown, "own")} left · AI: {remaining(shown, "opponent")} left</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AIStatusPill ai={battle.ai} />
            {!ended && battle.board && <Button variant="secondary" size="sm" className="min-h-11" onClick={() => { if (window.confirm("Forfeit this battle?")) session.forfeit(); }}>Forfeit</Button>}
          </div>
        </header>
        {error && <Alert variant="error" title="Choice not accepted">{error}</Alert>}
        {ended && !playing && <BattleEnd battle={battle} onRematch={session.rematch} onChangeTeams={session.changeTeams} logText={logText(battle.log)} habits={habits} />}
        <div className={styles.lastTurn}><LastTurn turn={latestResolved(battle)} runtime={runtime} showRead={showRead} board={battle.board} ownName={ownName} /></div>
        {battle.board ? (
          <form ref={formRef} aria-label={`Turn ${turn} actions`} {...controls.formProps}>
            {/* While a turn plays, your controls wait and Skip stays usable (the fieldset is not disabled). */}
            <fieldset disabled={!playing && (phase.kind === "waiting" || ended)} className="min-w-0">
              <legend className="sr-only">Turn {turn}</legend>
              <BattleBoard ref={boardRef} board={shown} renderControls={ended || playing ? undefined : controls.renderSlot} cardTarget={ended || playing ? undefined : controls.cardTarget}
                cardPlay={playing ? cardPlay : undefined} popup={step && !resolving ? <TurnPopup key={`${step.turn}:${step.index}`} step={step.step} actorName={step.step.actor ? shown.active[step.step.actor]?.name ?? null : null} /> : undefined}
                playbackBar={step ? <PlaybackBar turn={step.turn} step={playback.index + 1} count={playback.count} onSkip={skip} /> : undefined} />
              {!playing && controls.submitBar}
            </fieldset>
          </form>
        ) : <p role="status" className="text-sm text-muted">{battle.resumed ? "Resuming battle…" : "Starting battle…"}</p>}
        {battle.board && <BenchStrip board={shown} />}
      </div>
      <aside aria-labelledby={`${id}-log`} className={styles.logColumn}>
        <BattleLog log={battle.log} runtime={runtime} showRead={showRead} board={battle.board} ownName={ownName} headingId={`${id}-log`} />
      </aside>
      {/* While a turn plays, each step is read once as its popup shows (named from the board as the step began, so the text holds
          through its beats); then the next request (the turn's recap only after Skip). */}
      <BattleAnnouncer message={step ? stepAnnouncement(step.step, (slot, key) => spokenName(playback.stepStart ?? shown, slot, key)) : announcement(battle, { heard: playback.heard })} />
    </div>
  );
}
