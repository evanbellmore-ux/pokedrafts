"use client";

import { useEffect, useId, useRef } from "react";
import { Alert, Button } from "@/app/components/ui";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { useTurnControls } from "./actions/useTurnControls";
import AIStatusPill from "./board/AIStatusPill";
import BattleBoard from "./board/BattleBoard";
import BenchStrip from "./board/BenchStrip";
import { remaining } from "./board/board-format";
import BattleEnd from "./end/BattleEnd";
import { announcement, latestResolved, logText } from "./log/announcement";
import BattleAnnouncer from "./log/BattleAnnouncer";
import BattleLog from "./log/BattleLog";
import LastTurn from "./log/LastTurn";
import type { HabitsData } from "./model/habits-data";
import type { BoardView, TrainingBattle } from "./model/view-types";
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

/** Turns, forced switches and the end: header, last turn, board with your controls, bench, log, one live region. */
export default function BattleScreen({ runtime, battle, session, habits }: BattleScreenProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const board = battle.board ?? EMPTY_BOARD;
  const phase = battle.phase;
  const controls = useTurnControls({ runtime, board, phase, ai: battle.ai, onSubmit: session.choose });
  const ended = phase.kind === "ended";
  const requestId = phase.kind === "choose" || phase.kind === "switch" ? phase.request.id : null;
  const error = phase.kind === "choose" || phase.kind === "switch" ? phase.error : undefined;
  // A new request moves focus to the turn heading when focus was on the page body or inside the form, never out of the log.
  useEffect(() => {
    if (requestId === null) return;
    const active = document.activeElement;
    if (!active || active === document.body || formRef.current?.contains(active)) headingRef.current?.focus();
  }, [requestId]);
  const ownNames = new Map(battle.setup.own.members.map((member) => [member.key, member.name]));
  const ownName = (key: string) => ownNames.get(key) ?? null;
  const showRead = battle.setup.showRead;
  const turn = Math.max(1, board.turn);

  return (
    <div data-training-screen="battle" className={styles.battle}>
      <div className={styles.main}>
        <header data-training-turn className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 ref={headingRef} tabIndex={-1} className="rounded text-xl font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Turn {turn}</h2>
            {battle.board && <p className="text-sm tabular-nums text-muted">You: {remaining(board, "own")} left · AI: {remaining(board, "opponent")} left</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AIStatusPill ai={battle.ai} />
            {!ended && <Button variant="secondary" size="sm" className="min-h-11" onClick={() => { if (window.confirm("Forfeit this battle?")) session.forfeit(); }}>Forfeit</Button>}
          </div>
        </header>
        {error && <Alert variant="error" title="Choice not accepted">{error}</Alert>}
        {ended && <BattleEnd battle={battle} onRematch={session.rematch} onChangeTeams={session.changeTeams} logText={logText(battle.log)} habits={habits} />}
        <div className={styles.lastTurn}><LastTurn turn={latestResolved(battle)} runtime={runtime} showRead={showRead} board={battle.board} ownName={ownName} /></div>
        {battle.board ? (
          <form ref={formRef} aria-label={`Turn ${turn} actions`} {...controls.formProps}>
            <fieldset disabled={phase.kind === "waiting" || ended} className="min-w-0">
              <legend className="sr-only">Turn {turn}</legend>
              <BattleBoard board={board} renderControls={ended ? undefined : controls.renderSlot} cardTarget={ended ? undefined : controls.cardTarget} />
              {controls.submitBar}
            </fieldset>
          </form>
        ) : <p role="status" className="text-sm text-muted">Starting battle…</p>}
        {battle.board && <BenchStrip board={board} />}
      </div>
      <aside aria-labelledby={`${id}-log`} className={styles.logColumn}>
        <BattleLog log={battle.log} runtime={runtime} showRead={showRead} board={battle.board} ownName={ownName} headingId={`${id}-log`} />
      </aside>
      <BattleAnnouncer message={announcement(battle)} />
    </div>
  );
}
