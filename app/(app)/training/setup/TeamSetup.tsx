"use client";

import { useCallback, useEffect, useId, useMemo } from "react";
import { Alert, Button } from "@/app/components/ui";
import type useCalculatorRosters from "@/app/(app)/calculator/useCalculatorRosters";
import type { DoublesSideId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { SetupDraft, TeamSourceDraft, TrainingSetup, TrainingSnapshot } from "../model/view-types";
import type { TrainingSession } from "../training-session";
import DifficultyField from "./DifficultyField";
import FormatFacts from "./FormatFacts";
import HabitTrends from "./HabitTrends";
import InfoSettingsPanel from "./InfoSettingsPanel";
import { resolveSetup } from "./team-draft";
import TeamSourcePanel from "./TeamSourcePanel";
import styles from "./setup.module.css";

export type TeamSetupProps = {
  runtime: BattleRuntime;
  rosters: ReturnType<typeof useCalculatorRosters>;
  snapshot: Pick<TrainingSnapshot, "draft" | "validation" | "engine" | "habits" | "trendsOpen" | "setupError" | "suggestions" | "moveOptions">;
  session: Pick<TrainingSession, "updateDraft" | "validate" | "suggest" | "loadMoveOptions" | "start" | "clearHabits" | "setTrendsOpen" | "retryEngine">;
};

/** Start is allowed once both teams have six members with sets, no local blocker, and Showdown's validator found no problem. */
export function canStart(snapshot: TeamSetupProps["snapshot"], setup: TrainingSetup | null, key: string | null) {
  const validation = snapshot.validation;
  if (!setup || !key || snapshot.engine.status !== "ready" || validation.status !== "ready" || validation.key !== key) return false;
  const clean = (problems: { team: string[]; members: Record<string, string[]> }) => !problems.team.length && Object.values(problems.members).every((list) => !list.length);
  return clean(validation.own) && clean(validation.opponent);
}

export default function TeamSetup({ runtime, rosters, snapshot, session }: TeamSetupProps) {
  const id = useId();
  const { draft, validation, engine, habits, trendsOpen, setupError, suggestions, moveOptions } = snapshot;
  const resolved = useMemo(() => resolveSetup(draft, rosters.state, suggestions, runtime), [draft, rosters.state, suggestions, runtime]);
  const { own, opponent, setup, key } = resolved;
  // The habit counts decay by 0.9 per battle (ai/habits.ts): whole turns for display.
  const habitTurns = Math.round(habits.turns);

  // The worker suggests sets for the chosen league members and validates complete teams; the store drops repeats by key.
  useEffect(() => {
    for (const team of [own, opponent]) if (team.suggestKey) session.suggest(team.role, team.suggestKey, team.suggestMembers);
  }, [own, opponent, session]);
  useEffect(() => {
    if (engine.status === "ready" && setup && key) session.validate(setup, key);
  }, [engine.status, setup, key, session]);

  const update = (change: (draft: SetupDraft) => SetupDraft) => session.updateDraft(change);
  const onSource = (role: DoublesSideId) => (change: (source: TeamSourceDraft) => TeamSourceDraft) => update((current) => {
    const next = change(current[role]);
    return next === current[role] ? current : { ...current, [role]: next };
  });
  const loadMoves = useCallback((speciesId: string) => session.loadMoveOptions(speciesId), [session]);
  const checking = !!key && validation.status === "checking" && validation.key === key;
  const current = validation.status !== "idle" && validation.key === key ? validation : null;
  const startable = canStart(snapshot, setup, key);
  const blockers = [...own.blockers.map((text) => `Your team: ${text}`), ...opponent.blockers.map((text) => `Opponent: ${text}`)];
  const problems = current?.status === "ready" ? current : null;
  const problemCount = problems ? [problems.own, problems.opponent].reduce((sum, team) => sum + team.team.length + Object.values(team.members).reduce((each, list) => each + list.length, 0), 0) : 0;

  return (
    <div data-training-screen="setup" className="space-y-4">
      <div className={styles.teams}>
        <TeamSourcePanel role="own" team={own} source={draft.own} ownMode={draft.own.mode} rosters={rosters} runtime={runtime} visibility={null}
          problems={problems?.own ?? null} moveOptions={moveOptions} onSource={onSource("own")} onLoadMoves={loadMoves}
          onRetrySuggest={() => own.suggestKey && session.suggest("own", own.suggestKey, own.suggestMembers, true)} />
        <TeamSourcePanel role="opponent" team={opponent} source={draft.opponent} ownMode={draft.own.mode} rosters={rosters} runtime={runtime} visibility={draft.info.youSee}
          problems={problems?.opponent ?? null} moveOptions={moveOptions} onSource={onSource("opponent")} onLoadMoves={loadMoves}
          onRetrySuggest={() => opponent.suggestKey && session.suggest("opponent", opponent.suggestKey, opponent.suggestMembers, true)} />
      </div>

      <section aria-labelledby={`${id}-battle`} className="min-w-0 space-y-4 rounded-xl border border-line bg-panel p-3 sm:p-4">
        <h2 id={`${id}-battle`} className="text-lg font-semibold text-text">Battle</h2>
        <FormatFacts info={draft.info} />
        <div className={styles.battleFields}>
          <div className="min-w-0 space-y-3">
            <DifficultyField value={draft.difficulty} onChange={(difficulty) => update((current) => ({ ...current, difficulty }))} />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span data-training-habits className="text-text">Habits: {habitTurns} {habitTurns === 1 ? "turn" : "turns"} in this browser</span>
              <Button variant="secondary" size="sm" className="min-h-11" disabled={!habits.turns} onClick={() => session.clearHabits()}>Clear habits</Button>
            </div>
            <HabitTrends data={habits.data} runtime={runtime} open={trendsOpen} onToggle={(open) => session.setTrendsOpen(open)} />
            <label htmlFor={`${id}-read`} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text">
              <input id={`${id}-read`} type="checkbox" checked={draft.showRead} onChange={(event) => update((current) => ({ ...current, showRead: event.target.checked }))}
                className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" />
              Show the AI&apos;s read after each turn
            </label>
          </div>
          <InfoSettingsPanel info={draft.info} onChange={(info) => update((current) => ({ ...current, info }))} />
        </div>

        <div className="space-y-2">
          {(engine.status === "idle" || engine.status === "loading") && <p role="status" className="text-sm text-muted">Loading battle rules…</p>}
          {engine.status === "error" && (
            <Alert variant="error" title={`Battle rules unavailable: ${engine.message ?? "the battle engine did not load."}`}
              action={<Button variant="secondary" size="sm" className="min-h-11" onClick={() => session.retryEngine()}>Retry</Button>} />
          )}
          {setupError && <Alert variant="error" title="Battle stopped">{setupError}</Alert>}
          {!!blockers.length && (
            <ul className="space-y-0.5 text-sm text-text">{blockers.map((blocker) => <li key={blocker} data-training-blocker>{blocker}</li>)}</ul>
          )}
          {checking && <p role="status" className="text-sm text-muted">Checking teams with Showdown rules…</p>}
          {current?.status === "error" && <p data-training-blocker className="wrap-anywhere text-sm text-danger">Showdown check failed: {current.message}</p>}
          {problems && problemCount > 0 && <p data-training-blocker className="text-sm text-danger">Showdown rules: {problemCount} problem{problemCount === 1 ? "" : "s"}.</p>}
          {startable && <p role="status" className="text-sm text-success">Teams valid for VGC 2026 Reg M-C.</p>}
        </div>
        <Button data-training-start size="lg" className="min-h-11 w-full sm:w-auto" disabled={!startable} onClick={() => setup && session.start(setup)}>Start battle</Button>
      </section>
    </div>
  );
}
