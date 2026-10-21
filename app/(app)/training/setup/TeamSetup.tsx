"use client";

import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { Alert, Button } from "@/app/components/ui";
import { RefreshTeamsButton, SourceFeedback } from "@/app/(app)/calculator/LeagueMatchupPicker";
import type useCalculatorRosters from "@/app/(app)/calculator/useCalculatorRosters";
import type { DoublesSideId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { usesTestSettings } from "../model/info";
import type { EngineLoad, SetupDraft, TeamSourceDraft, TrainingSetup, TrainingSnapshot } from "../model/view-types";
import type { TrainingSession } from "../training-session";
import DifficultyField, { DIFFICULTY_LABEL } from "./DifficultyField";
import FormatFacts from "./FormatFacts";
import HabitTrends from "./HabitTrends";
import InfoSettingsPanel from "./InfoSettingsPanel";
import { opponentQuickPicks, type NextMatch } from "./next-opponent";
import { pendingSets, resolveSetup, sharedNames, untouched, withMode, type ResolvedTeam } from "./team-draft";
import { problemCount, problemsFact } from "./TeamMemberRow";
import TeamSourcePanel, { sharedRows } from "./TeamSourcePanel";
import styles from "./setup.module.css";

export type TeamSetupProps = {
  runtime: BattleRuntime;
  /** `nextMatch`: your next scheduled match in the selected league (useNextOpponent), the Opponent picker's "Next match". */
  rosters: ReturnType<typeof useCalculatorRosters> & { nextMatch?: NextMatch | null };
  snapshot: Pick<TrainingSnapshot, "draft" | "picks" | "validation" | "engine" | "habits" | "trendsOpen" | "setupError" | "suggestions" | "moveOptions">;
  session: Pick<TrainingSession, "updateDraft" | "validate" | "suggest" | "loadMoveOptions" | "start" | "clearHabits" | "setTrendsOpen" | "retryEngine">;
};

/** Start is allowed once both teams have six members with sets, no local blocker, and Showdown's validator found no problem. */
export function canStart(snapshot: TeamSetupProps["snapshot"], setup: TrainingSetup | null, key: string | null) {
  const validation = snapshot.validation;
  if (!setup || !key || snapshot.engine.status !== "ready" || validation.status !== "ready" || validation.key !== key) return false;
  return !problemCount(validation.own) && !problemCount(validation.opponent);
}

/** Looks unavailable while it stays focusable (aria-disabled), so Start reads its own state and what it waits on. */
const UNAVAILABLE = "aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-accent";

const LOADING_RULES = "Loading battle rules…";
const CHECKING = "Checking teams with Showdown rules…";
const VALID = "Teams valid for VGC 2026 Reg M-C.";
const engineError = (engine: EngineLoad) => `Battle rules unavailable: ${engine.message ?? "the battle engine did not load."}`;
const showdownCount = (name: string, count: number) => `${name}: ${problemsFact(count)}`;
const checkFailed = (message: string) => `Showdown check failed: ${message}`;

/** One side's lines Start waits on: why it has nothing to choose from, its suggested sets loading or unavailable, its blockers. */
function sideLines(team: ResolvedTeam, name: string): { text: string; blocker: boolean }[] {
  const pending = pendingSets(team);
  return [
    ...(team.fact ? [{ text: `${name}: ${team.fact}`, blocker: false }] : []),
    ...(pending ? [{ text: `${name}: ${pending === "loading" ? "Suggesting sets…" : "Suggested sets unavailable."}`, blocker: false }] : []),
    ...team.blockers.map((blocker) => ({ text: `${name}: ${blocker}`, blocker: true })),
  ];
}

type StartLine = { text: string; side: DoublesSideId | null; tone: "muted" | "text" | "danger" };
const TONE = { muted: "text-muted", text: "text-text", danger: "text-danger" } as const;

/** The side's heading takes the keyboard focus (and scrolls in below the nav). */
function focusSide(side: DoublesSideId) {
  document.querySelector<HTMLElement>(`[data-training-team-heading="${side}"]`)?.focus();
}

/** The bar's fact in two lines at most (its whole text in its title), in a row as tall as Start: the bar keeps one height. */
const CLAMP = "line-clamp-2 wrap-anywhere";
const FACT_ROW = "flex min-h-11 min-w-0 items-center gap-1";

/**
 * The Start bar's one fact: the first line Start waits on (in the status region's order, with the engine's and the Showdown
 * check's errors) and how many more there are, or the teams' validity. A side's line is a button to that side (its Choose 6
 * list opens).
 */
function StartFact({ lines, startable, onSide }: { lines: StartLine[]; startable: boolean; onSide(side: DoublesSideId): void }) {
  if (startable) return <p title={VALID} className={`${FACT_ROW} text-success`}><span className={CLAMP}>{VALID}</span></p>;
  const [first, ...rest] = lines;
  if (!first) return null;
  const side = first.side;
  return (
    <p data-training-start-fact className={FACT_ROW}>
      {side ? (
        <button type="button" title={first.text} data-training-start-side={side} onClick={() => onSide(side)}
          className={`min-h-11 min-w-0 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${TONE[first.tone]}`}>
          <span className={`${CLAMP} underline decoration-dotted underline-offset-2`}>{first.text}</span>
        </button>
      ) : <span title={first.text} className={`min-w-0 ${CLAMP} ${TONE[first.tone]}`}>{first.text}</span>}
      {rest.length > 0 && <span className="shrink-0 text-muted">· {rest.length} more</span>}
    </p>
  );
}

export default function TeamSetup({ runtime, rosters, snapshot, session }: TeamSetupProps) {
  const id = useId();
  const { draft, validation, engine, habits, trendsOpen, setupError, suggestions, moveOptions } = snapshot;
  const resolved = useMemo(() => resolveSetup(draft, rosters.state, suggestions, runtime), [draft, rosters.state, suggestions, runtime]);
  const { own, opponent, setup, key } = resolved;
  const shared = useMemo(() => sharedNames(own, opponent), [own, opponent]);
  // The Start bar's side fact opens that side's Choose 6 list (below 64rem) as its heading takes the focus.
  const [reveal, setReveal] = useState({ own: 0, opponent: 0 });
  const showSide = (side: DoublesSideId) => {
    setReveal((current) => ({ ...current, [side]: current[side] + 1 }));
    focusSide(side);
  };
  // The habit counts decay by 0.9 per battle (ai/habits.ts): whole turns for display.
  const habitTurns = Math.round(habits.turns);

  // The worker suggests sets for the chosen league members and validates complete teams; the store drops repeats by key.
  useEffect(() => {
    for (const team of [own, opponent]) if (team.suggestKey) session.suggest(team.role, team.suggestKey, team.suggestMembers);
  }, [own, opponent, session]);
  useEffect(() => {
    if (engine.status === "ready" && setup && key) session.validate(setup, key);
  }, [engine.status, setup, key, session]);
  // An account without leagues (its remembered setup read): each side as it started opens on PokéPaste; League team stays.
  const noLeagues = rosters.state.status === "ready" && !rosters.state.leagues.length && snapshot.picks?.userId === rosters.state.userId;
  useEffect(() => {
    if (!noLeagues) return;
    session.updateDraft((current) => {
      const [ownSide, opponentSide] = [current.own, current.opponent].map((source) => untouched(source) ? withMode(source, "paste") : source);
      return ownSide === current.own && opponentSide === current.opponent ? current : { ...current, own: ownSide, opponent: opponentSide };
    });
  }, [noLeagues, session]);

  const update = (change: (draft: SetupDraft) => SetupDraft) => session.updateDraft(change);
  const onSource = (role: DoublesSideId) => (change: (source: TeamSourceDraft) => TeamSourceDraft) => update((current) => {
    const next = change(current[role]);
    return next === current[role] ? current : { ...current, [role]: next };
  });
  const loadMoves = useCallback((speciesId: string) => session.loadMoveOptions(speciesId), [session]);
  const checking = !!key && validation.status === "checking" && validation.key === key;
  const current = validation.status !== "idle" && validation.key === key ? validation : null;
  const startable = canStart(snapshot, setup, key);
  const sides = [{ team: own, name: "Your team" }, { team: opponent, name: "Opponent" }] as const;
  const problems = current?.status === "ready" ? current : null;
  const habitsText = `${habitTurns} ${habitTurns === 1 ? "turn" : "turns"}`;
  const loadingRules = engine.status === "idle" || engine.status === "loading";
  // What Start waits on, in the status region's order (the engine's and the Showdown check's errors where they stand).
  const lines: StartLine[] = [
    ...(loadingRules ? [{ text: LOADING_RULES, side: null, tone: "muted" as const }] : []),
    ...(engine.status === "error" ? [{ text: engineError(engine), side: null, tone: "danger" as const }] : []),
    ...sides.flatMap(({ team, name }) => sideLines(team, name).map((line) => ({ text: line.text, side: team.role, tone: "text" as const }))),
    ...(checking ? [{ text: CHECKING, side: null, tone: "muted" as const }] : []),
    ...(problems ? sides.flatMap(({ team, name }) => {
      const count = problemCount(problems[team.role]);
      return count > 0 ? [{ text: showdownCount(name, count), side: team.role, tone: "danger" as const }] : [];
    }) : []),
    ...(current?.status === "error" ? [{ text: checkFailed(current.message), side: null, tone: "danger" as const }] : []),
  ];
  // Both teams known: "Kingco and the Breezys vs Feralinatr · Plays safe" (as the Resume prompt names a battle).
  const testOn = usesTestSettings(draft.info.aiKnows) || usesTestSettings(draft.info.youSee);
  const matchup = own.candidates.length && opponent.candidates.length
    ? `${own.label} vs ${opponent.label} · ${DIFFICULTY_LABEL[draft.difficulty]}${testOn ? " · Test settings on" : ""}`
    : null;
  // A start against a league opponent is remembered as that league's recent opponent.
  const { selectedLeagueId, opponentId } = rosters.state;
  const leagueOpponent = draft.opponent.mode === "league" && selectedLeagueId && opponentId ? { leagueId: selectedLeagueId, opponentId } : null;
  // The Opponent picker's quick picks: your next scheduled match in the league and the opponents of your last starts there.
  const nextMatch = rosters.nextMatch ?? null;
  const picks = snapshot.picks && snapshot.picks.userId === rosters.state.userId ? snapshot.picks : null;
  const recent = picks?.recent[selectedLeagueId];
  const quick = useMemo(() => opponentQuickPicks(rosters.state, nextMatch, recent ?? []), [rosters.state, nextMatch, recent]);
  // Start is described by what it waits on: the rules' error, the status region, the failed Showdown check.
  const describedBy = [engine.status === "error" && `${id}-engine`, `${id}-state`, current?.status === "error" && `${id}-check`].filter(Boolean).join(" ");

  return (
    <div data-training-screen="setup" className={`${styles.setup} space-y-4`}>
      {/* The league rosters both teams read: one Refresh teams and their status, said once (below 40rem the status takes the
          row and Refresh teams the line under it). Its lines are not live: the status beside Start says them per team. */}
      {(draft.own.mode === "league" || draft.opponent.mode === "league") && (
        <div data-training-rosters className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1 space-y-2 empty:hidden max-sm:basis-full"><SourceFeedback state={rosters.state} loginNext="/training" live={false} /></div>
          <RefreshTeamsButton state={rosters.state} onRefresh={rosters.refresh} className="ml-auto shrink-0" />
        </div>
      )}
      {/* From 64rem the two panels share their rows, so each part sits level with the other side's (setup.module.css .team). */}
      <div className={styles.teams} style={{ "--team-rows": sharedRows([own, opponent]) } as CSSProperties}>
        <TeamSourcePanel role="own" team={own} source={draft.own} ownMode={draft.own.mode} rosters={rosters} runtime={runtime} visibility={null}
          problems={problems?.own ?? null} moveOptions={moveOptions} shared={shared} reveal={reveal.own} onSource={onSource("own")} onLoadMoves={loadMoves}
          onRetrySuggest={() => own.suggestKey && session.suggest("own", own.suggestKey, own.suggestMembers, true)} />
        <TeamSourcePanel role="opponent" team={opponent} source={draft.opponent} ownMode={draft.own.mode} rosters={rosters} runtime={runtime} visibility={draft.info.youSee}
          problems={problems?.opponent ?? null} moveOptions={moveOptions} shared={shared} reveal={reveal.opponent} quick={quick} onSource={onSource("opponent")} onLoadMoves={loadMoves}
          onRetrySuggest={() => opponent.suggestKey && session.suggest("opponent", opponent.suggestKey, opponent.suggestMembers, true)} />
      </div>

      <section aria-labelledby={`${id}-battle`} className="min-w-0 space-y-4 rounded-xl border border-line bg-panel p-3 sm:p-4">
        <h2 id={`${id}-battle`} className="text-lg font-semibold text-text">Battle settings</h2>
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

        <div className="space-y-2">
          {engine.status === "error" && (
            <Alert variant="error" title={<span id={`${id}-engine`}>{engineError(engine)}</span>}
              action={<Button variant="secondary" size="sm" className="min-h-11" onClick={() => session.retryEngine()}>Retry</Button>} />
          )}
          {setupError && <Alert variant="error" title="Battle stopped">{setupError}</Alert>}
          {/* One live region for what Start waits on (its description); additions are read, not the whole list again. */}
          <div id={`${id}-state`} role="status" aria-atomic="false" data-training-readiness className="space-y-0.5 text-sm">
            {loadingRules && <p className="text-muted">{LOADING_RULES}</p>}
            <ul className="space-y-0.5 text-text empty:hidden">
              {sides.flatMap(({ team, name }) => sideLines(team, name).map((line) => (
                <li key={line.text} data-training-side={team.role} data-training-blocker={line.blocker || undefined}>{line.text}</li>
              )))}
            </ul>
            {checking && <p className="text-muted">{CHECKING}</p>}
            {problems && sides.map(({ team, name }) => {
              const count = problemCount(problems[team.role]);
              return count > 0 && <p key={team.role} data-training-blocker className="text-danger">{showdownCount(name, count)}</p>;
            })}
            {startable && <p className="text-success">{VALID}</p>}
          </div>
          {current?.status === "error" && <p id={`${id}-check`} role="alert" data-training-blocker className="wrap-anywhere text-sm text-danger">{checkFailed(current.message)}</p>}
        </div>
      </section>

      {/* Start in reach at every scroll position: the matchup (from 40rem, one line), the fact Start waits on, Start. One
          height at each width (one fact row; the matchup's row kept from 40rem). Not a live region. */}
      <div data-training-start-bar className={`${styles.startBar} flex items-center gap-2 border-t border-line bg-panel px-3 py-2`}>
        <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center text-sm sm:min-h-16">
          {matchup && <p data-training-matchup title={matchup} className="hidden truncate font-medium text-text sm:block">{matchup}</p>}
          <StartFact lines={lines} startable={startable} onSide={showSide} />
        </div>
        <Button data-training-start size="lg" className={`min-h-11 shrink-0 max-sm:px-4 max-sm:text-sm ${UNAVAILABLE}`} aria-disabled={!startable || undefined}
          aria-describedby={describedBy} onClick={() => { if (startable && setup) session.start(setup, leagueOpponent); }}>Start battle</Button>
      </div>
    </div>
  );
}
