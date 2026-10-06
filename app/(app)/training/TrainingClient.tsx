"use client";

import { useEffect } from "react";
import { Button, PageHeader } from "@/app/components/ui";
import useCalculatorRosters from "@/app/(app)/calculator/useCalculatorRosters";
import { championsRuntime } from "@/app/lib/battle/runtime";
import BattleScreen from "./BattleScreen";
import { TRAINING_LABEL } from "./model/format-facts";
import TeamPreview from "./preview/TeamPreview";
import TeamSetup from "./setup/TeamSetup";
import { useTrainingSession } from "./useTrainingSession";
import styles from "./training.module.css";

/** The Training tab: Setup, Team preview, then the battle (SPEC 12.3 screen selection). */
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
  // A reload ends the battle (nothing is saved): the browser's own leave-page prompt while one is in progress.
  useEffect(() => {
    if (!inProgress) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [inProgress]);

  let screen;
  if (!battle) {
    screen = <TeamSetup runtime={runtime} rosters={rosters} snapshot={snapshot} session={session} />;
  } else if (battle.phase.kind === "starting" || battle.phase.kind === "preview") {
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
