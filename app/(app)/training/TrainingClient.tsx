"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, PageHeader } from "@/app/components/ui";
import useCalculatorRosters from "@/app/(app)/calculator/useCalculatorRosters";
import { championsRuntime } from "@/app/lib/battle/runtime";
import BattleScreen from "./BattleScreen";
import { TRAINING_LABEL } from "./model/format-facts";
import TeamPreview from "./preview/TeamPreview";
import ReplayScreen from "./replay/ReplayScreen";
import SavedBattles, { LastBattle, ResumePrompt, type SavedActions } from "./saved/SavedBattles";
import SetupModeSwitch from "./setup/SetupModeSwitch";
import SituationSetup from "./setup/SituationSetup";
import TeamSetup from "./setup/TeamSetup";
import { useNextOpponent } from "./setup/useNextOpponent";
import { useRememberedPicks } from "./setup/useRememberedPicks";
import { useTrainingSession } from "./useTrainingSession";
import styles from "./training.module.css";

/**
 * The Training tab: Setup (a full battle's teams, or Situations; with Saved battles), Team preview, then the battle (SPEC 12.3
 * screen selection); or a replay. A situation has no team preview: its battle screen waits for the dealt position.
 */
export default function TrainingClient() {
  const [snapshot, session] = useTrainingSession();
  // The calculator's rosters; Training restores the league you last picked, and its Opponent picker starts on the opponent you
  // last picked there, else your next scheduled opponent, else the only other coach. Your picks are remembered per account.
  // The schedule's next match also comes back as the picker's "Next match" quick pick (rosters.nextMatch).
  const calculatorRosters = useCalculatorRosters();
  const { status, userId } = calculatorRosters.state;
  const picks = snapshot.picks?.userId === userId ? snapshot.picks : null;
  const rosters = useRememberedPicks(useNextOpponent(calculatorRosters, picks?.opponents ?? null), picks, session);
  const runtime = championsRuntime;
  useEffect(() => {
    if (status !== "loading") session.bindAccount(userId);
  }, [status, userId, session]);
  const battle = snapshot.battle;
  const inProgress = !!battle && battle.phase.kind !== "ended";
  // Closing a replay back to Setup gives the keyboard focus back to the Replay button that opened it: the Last battle card's,
  // else its row's in Saved battles. A replay left for a battle (its header's Rematch) returns nowhere.
  const replayId = snapshot.replay?.id ?? null;
  const [shownReplay, setShownReplay] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<{ id: string; fromCard: boolean } | null>(null);
  /** The battle whose replay the Last battle card opened (a row's Replay clears it). */
  const [cardReplay, setCardReplay] = useState<string | null>(null);
  if (replayId !== shownReplay) {
    setShownReplay(replayId);
    setReturnTo(replayId === null && shownReplay !== null && !battle ? { id: shownReplay, fromCard: shownReplay === cardReplay } : null);
  }
  const returned = useCallback(() => setReturnTo(null), []);
  const cardSession = useMemo(() => ({
    rematchSaved: session.rematchSaved,
    openReplay: (id: string) => { setCardReplay(id); session.openReplay(id); },
  }), [session]);
  const listSession = useMemo<SavedActions>(() => ({
    openReplay: (id) => { setCardReplay(null); session.openReplay(id); },
    resume: session.resume, rematchSaved: session.rematchSaved, deleteSaved: session.deleteSaved, deleteAllSaved: session.deleteAllSaved,
    exportSaved: session.exportSaved, importSaved: session.importSaved,
  }), [session]);
  // Change teams (team preview or the battle's end) gives the keyboard focus, left on the page body, to Your team's heading
  // (Situations' in that mode): tracked from the battle back to Setup without an error (a stopped battle's alert speaks for
  // itself), never on first load.
  const view = snapshot.replay ? "replay" : battle ? "battle" : "setup";
  const [shownView, setShownView] = useState(view);
  const [teamsReturn, setTeamsReturn] = useState(false);
  if (view !== shownView) {
    setShownView(view);
    setTeamsReturn(shownView === "battle" && view === "setup" && !snapshot.setupError);
  }
  const mode = snapshot.situations.settings.mode;
  useEffect(() => {
    if (!teamsReturn) return;
    const active = document.activeElement;
    const heading = mode === "situations" ? "[data-training-situations-heading]" : '[data-training-team-heading="own"]';
    if (!active || active === document.body) document.querySelector<HTMLElement>(heading)?.focus();
  }, [teamsReturn, mode]);
  // A reload ends the battle; Resume rebuilds it from its last autosave (each resolved turn). Until this battle has one
  // (team preview, turn 1, or storage failed), the browser's own leave-page prompt.
  const autosaved = !!battle && snapshot.saved.autosaved?.battleId === battle.id;
  useEffect(() => {
    if (!inProgress || autosaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [inProgress, autosaved]);

  let screen;
  if (snapshot.replay) {
    screen = <ReplayScreen runtime={runtime} replay={snapshot.replay} session={session} />;
  } else if (!battle) {
    screen = (
      <>
        <ResumePrompt saved={snapshot.saved} session={session} />
        <LastBattle saved={snapshot.saved} session={cardSession} />
        <SetupModeSwitch mode={mode} onChange={(next) => session.updateSituations((current) => (current.mode === next ? current : { ...current, mode: next }))} />
        {mode === "situations"
          ? <SituationSetup runtime={runtime} snapshot={snapshot} session={session} />
          : <TeamSetup runtime={runtime} rosters={rosters} snapshot={snapshot} session={session} />}
        <SavedBattles saved={snapshot.saved} session={listSession} returnTo={returnTo?.id ?? null} fromCard={!!returnTo?.fromCard} onReturned={returned} />
      </>
    );
  } else if (!battle.setup.situation && ((battle.phase.kind === "starting" && !battle.resumed) || battle.phase.kind === "preview")) {
    const phase = battle.phase;
    screen = (
      <>
        <TeamPreview runtime={runtime} setup={battle.setup} request={phase.kind === "preview" ? phase.request : null} lastPreview={battle.lastPreview}
          error={phase.kind === "preview" ? phase.error : undefined} ai={battle.ai} onConfirm={session.choose} />
        <Button variant="secondary" size="sm" className="min-h-11" onClick={session.changeTeams}>Change teams</Button>
      </>
    );
  } else {
    screen = <BattleScreen runtime={runtime} battle={battle} session={session} habits={snapshot.habits.data} deal={snapshot.situations.deal} />;
  }

  return (
    <div className={`${styles.root} space-y-6`}>
      <PageHeader title={TRAINING_LABEL} eyebrow="Champions · VGC 2026 Reg M-C" />
      {screen}
    </div>
  );
}
