"use client";

import { useId } from "react";
import { Alert } from "@/app/components/ui";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { TrainingSnapshot } from "../model/view-types";
import type { TrainingSession } from "../training-session";
import BattleSettingsFields from "./BattleSettingsFields";
import SituationsPanel from "./SituationsPanel";

export type SituationSetupProps = {
  runtime: BattleRuntime;
  snapshot: Pick<TrainingSnapshot, "draft" | "engine" | "habits" | "trendsOpen" | "setupError" | "situations">;
  session: Pick<TrainingSession, "updateDraft" | "clearHabits" | "setTrendsOpen" | "updateSituations" | "startSituation" | "retryEngine">;
};

/** Setup in Situations mode: the situations (each starts at once), then the Battle settings a situation battle uses. */
export default function SituationSetup({ runtime, snapshot, session }: SituationSetupProps) {
  const id = useId();
  return (
    <div data-training-screen="situations" className="space-y-4">
      <SituationsPanel snapshot={snapshot} session={session} />
      <section aria-labelledby={`${id}-battle`} className="min-w-0 space-y-4 rounded-xl border border-line bg-panel p-3 sm:p-4">
        <h2 id={`${id}-battle`} className="text-lg font-semibold text-text">Battle settings</h2>
        <BattleSettingsFields runtime={runtime} snapshot={snapshot} session={session} />
        {snapshot.setupError && <Alert variant="error" title="Battle stopped">{snapshot.setupError}</Alert>}
      </section>
    </div>
  );
}
