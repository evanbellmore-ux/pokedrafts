"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, PageHeader } from "@/app/components/ui";
import useCalculatorRosters from "@/app/(app)/calculator/useCalculatorRosters";
import { championsRuntime } from "@/app/lib/battle/runtime";
import BattleScreen from "./BattleScreen";
import { TRAINING_LABEL } from "./model/format-facts";
import TeamPreview from "./preview/TeamPreview";
import ReplayScreen from "./replay/ReplayScreen";
import SavedBattles, { ResumePrompt } from "./saved/SavedBattles";
import TeamSetup from "./setup/TeamSetup";
import { useTrainingSession } from "./useTrainingSession";
import styles from "./training.module.css";

/** The Training tab: Setup (with Saved battles), Team preview, then the battle (SPEC 12.3 screen selection); or a replay. */
export default function TrainingClient() {
  const [snapshot, session] = useTrainingSession();
  const rosters = useCalculatorRosters();
  const runtime = championsRuntime;
  const { status, userId } = rosters.state;
  useEffect(() => {
    if (status !== "loading") session.bindAccount(userId);
  }, [status, userId, session]);
  const battle = snapshot.battle;
  const inProgress = !!battle && battle.phase.kind !== "ended";
  // Closing a replay gives the keyboard focus back to its row in Saved battles.
  const replayId = snapshot.replay?.id ?? null;
  const [shownReplay, setShownReplay] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  if (replayId !== shownReplay) {
    setShownReplay(replayId);
    setReturnTo(replayId === null ? shownReplay : null);
  }
  const returned = useCallback(() => setReturnTo(null), []);
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
        <TeamSetup runtime={runtime} rosters={rosters} snapshot={snapshot} session={session} />
        <SavedBattles saved={snapshot.saved} session={session} returnTo={returnTo} onReturned={returned} />
      </>
    );
  } else if ((battle.phase.kind === "starting" && !battle.resumed) || battle.phase.kind === "preview") {
    const phase = battle.phase;
    screen = (
      <>
        <TeamPreview runtime={runtime} setup={battle.setup} request={phase.kind === "preview" ? phase.request : null} lastPreview={battle.lastPreview}
          error={phase.kind === "preview" ? phase.error : undefined} ai={battle.ai} onConfirm={session.choose} />
        <Button variant="secondary" size="sm" className="min-h-11" onClick={session.changeTeams}>Change teams</Button>
      </>
    );
  } else {
    screen = <BattleScreen runtime={runtime} battle={battle} session={session} habits={snapshot.habits.data} />;
  }

  return (
    <div className={`${styles.root} space-y-6`}>
      <PageHeader title={TRAINING_LABEL} eyebrow="Champions · VGC 2026 Reg M-C" />
      {screen}
    </div>
  );
}
