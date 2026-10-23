"use client";

import { useId } from "react";
import { Button } from "@/app/components/ui";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { SetupDraft, TrainingSnapshot } from "../model/view-types";
import type { TrainingSession } from "../training-session";
import DifficultyField from "./DifficultyField";
import FormatFacts from "./FormatFacts";
import HabitTrends from "./HabitTrends";
import InfoSettingsPanel from "./InfoSettingsPanel";
import styles from "./setup.module.css";

export type BattleSettingsFieldsProps = {
  runtime: BattleRuntime;
  snapshot: Pick<TrainingSnapshot, "draft" | "habits" | "trendsOpen">;
  session: Pick<TrainingSession, "updateDraft" | "clearHabits" | "setTrendsOpen">;
};

/**
 * Battle settings' fields, for a full battle (TeamSetup) and a situation (SituationSetup): AI difficulty, Show the AI's read,
 * the habits with Clear habits and Your trends, Information, then the format facts.
 */
export default function BattleSettingsFields({ runtime, snapshot, session }: BattleSettingsFieldsProps) {
  const id = useId();
  const { draft, habits, trendsOpen } = snapshot;
  const update = (change: (draft: SetupDraft) => SetupDraft) => session.updateDraft(change);
  // The habit counts decay by 0.9 per battle (ai/habits.ts): whole turns for display.
  const habitTurns = Math.round(habits.turns);
  const habitsText = `${habitTurns} ${habitTurns === 1 ? "turn" : "turns"}`;
  return (
    <>
      <div className={styles.battleFields}>
        <div className="min-w-0 space-y-3">
          <DifficultyField value={draft.difficulty} onChange={(difficulty) => update((current) => ({ ...current, difficulty }))} />
          <label htmlFor={`${id}-read`} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text">
            <input id={`${id}-read`} type="checkbox" checked={draft.showRead} onChange={(event) => update((current) => ({ ...current, showRead: event.target.checked }))}
              className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" />
            Show the AI&apos;s read after each turn
          </label>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span data-training-habits className="text-text">Habits: {habitsText} in this browser</span>
            <Button variant="secondary" size="sm" className="min-h-11" disabled={!habits.turns}
              onClick={() => { if (window.confirm(`Clear the AI's habits (${habitsText})?`)) session.clearHabits(); }}>Clear habits</Button>
          </div>
          <HabitTrends data={habits.data} runtime={runtime} open={trendsOpen} onToggle={(open) => session.setTrendsOpen(open)} />
        </div>
        <InfoSettingsPanel info={draft.info} onChange={(info) => update((current) => ({ ...current, info }))} />
      </div>
      <FormatFacts />
    </>
  );
}
