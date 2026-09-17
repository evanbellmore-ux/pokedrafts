"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, RotateCcw } from "lucide-react";
import { Alert, Button, EmptyState, PageHeader } from "@/app/components/ui";
import { champions, speciesById } from "@/app/lib/battle/catalog";
import { validateBuild, validateConditions } from "@/app/lib/battle/model";
import type { BattleBuild } from "@/app/lib/battle/types";
import { linkClassName } from "@/app/lib/theme";
import BattleConditions, { describeConditions } from "./BattleConditions";
import MatchupSummary from "./MatchupSummary";
import MoveResults, { type MoveResultsHandle } from "./MoveResults";
import PokemonPanel from "./PokemonPanel";
import LeagueMatchupPicker, { RosterPicker } from "./LeagueMatchupPicker";
import useCalculatorRosters from "./useCalculatorRosters";
import { getBuildHealth } from "./hp-preview";
import type { CalculatorRosterState } from "./roster-data";
import { createMatchup, reconcileRosters, resetMatchup, selectMatchupMove, selectRosterPokemon, swapMatchup, updateMatchupBuild, type BattleSide, type RosterChoice } from "./roster-prep";
import styles from "./calculator.module.css";

export { createMatchup, swapMatchup };

type CalculateMatchup = typeof import("@/app/lib/battle/calculate").calculateMatchup;
type EngineState =
  | { status: "loading" }
  | { status: "ready"; calculate: CalculateMatchup }
  | { status: "error"; message: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "An unexpected calculator error occurred.";
}

export default function CalculatorClient() {
  const prefix = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const movesRef = useRef<MoveResultsHandle>(null);
  const [matchup, setMatchup] = useState(() => createMatchup());
  const [engine, setEngine] = useState<EngineState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const receiveRosters = useCallback((state: CalculatorRosterState) => {
    setMatchup((current) => reconcileRosters(current, state));
  }, []);
  const rosters = useCalculatorRosters(receiveRosters);
  const attacker = matchup.attacker.build;
  const defender = matchup.defender.build;
  const teamsId = `${prefix}-teams`;
  const buildsId = `${prefix}-builds`;
  const fieldId = `${prefix}-field`;
  const controls = { attacker: `${prefix}-build-${matchup.attacker.key}`, defender: `${prefix}-build-${matchup.defender.key}`, moves: `${prefix}-moves` };

  useEffect(() => {
    let current = true;
    import("@/app/lib/battle/calculate").then(
      ({ calculateMatchup }) => { if (current) setEngine({ status: "ready", calculate: calculateMatchup }); },
      (error: unknown) => { if (current) setEngine({ status: "error", message: errorMessage(error) }); },
    );
    return () => { current = false; };
  }, [attempt]);

  useEffect(() => {
    const root = rootRef.current;
    const summary = summaryRef.current;
    if (!root || !summary) return;
    const updateHeight = () => root.style.setProperty("--calculator-summary-height", `${summary.getBoundingClientRect().height}px`);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(summary);
    return () => observer.disconnect();
  }, []);

  const reveal = useCallback((element: HTMLElement) => {
    // Native disclosures keep the original editors mounted, including invalid raw input.
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    element.focus({ preventScroll: true });
    const navHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-nav-height")) || 0;
    const summary = summaryRef.current;
    const stickyHeight = summary && getComputedStyle(summary).position === "sticky" ? summary.getBoundingClientRect().height + 8 : 0;
    window.scrollTo({ top: Math.max(0, window.scrollY + element.getBoundingClientRect().top - navHeight - stickyHeight - 16) });
  }, []);

  const calculation = useMemo(() => {
    if (engine.status !== "ready") return null;
    try {
      return { result: engine.calculate(attacker, defender, matchup.field, matchup.contexts), error: null };
    } catch (error) {
      return { result: null, error: errorMessage(error) };
    }
  }, [engine, attacker, defender, matchup.field, matchup.contexts]);

  const issues = calculation?.result?.issues ?? {
    attacker: validateBuild(attacker),
    defender: validateBuild(defender),
    field: validateConditions(matchup.field),
  };
  const buildIssueCount = issues.attacker.length + issues.defender.length;
  const invalid = buildIssueCount > 0 || issues.field.length > 0;
  const attackerSpecies = speciesById.get(attacker.speciesId);
  const defenderSpecies = speciesById.get(defender.speciesId);
  const rows = invalid ? [] : calculation?.result?.results ?? [];
  const selectedRow = rows.find((row) => row.moveId === matchup.selectedMoveId);
  const currentHP = getBuildHealth(defender)?.current ?? null;
  const league = rosters.state.leagues.find((entry) => entry.id === rosters.state.selectedLeagueId);
  const teamsLoading = rosters.state.status === "loading" || rosters.state.teamsStatus === "loading";
  const teamsFailed = rosters.state.status === "error" || rosters.state.teamsStatus === "error";
  const teamSummary = teamsLoading ? "Loading your leagues and teams…"
    : teamsFailed ? "Teams unavailable — retry or use manual Pokémon."
      : rosters.state.status === "signed-out" ? "Sign in to use league rosters. Manual Pokémon still work."
        : league ? `${league.name}${rosters.state.opponentId ? " · Opponent selected" : " · Choose an opponent"}` : "Choose a league, or use manual Pokémon.";
  const blockedReason = engine.status === "loading" ? "HP preview paused while the calculator loads."
    : engine.status === "error" || calculation?.error ? "HP preview unavailable. Retry the calculator below."
      : invalid ? "HP preview paused. Fix the highlighted build or field settings." : undefined;

  function retry() {
    setEngine({ status: "loading" });
    setAttempt((value) => value + 1);
  }

  function updateBuild(side: BattleSide, build: BattleBuild) {
    setMatchup((current) => updateMatchupBuild(current, side, build));
  }

  function chooseRosterPokemon(side: BattleSide, choice: RosterChoice) {
    setMatchup((current) => selectRosterPokemon(current, side, choice));
  }

  function edit(side: BattleSide, target: "pokemon" | "hp") {
    const panel = document.getElementById(controls[side]);
    const element = target === "hp" ? panel?.querySelector<HTMLElement>("[data-calculator-hp]")
      : panel?.querySelector<HTMLElement>("[data-calculator-pokemon] button:not(:disabled), [data-calculator-pokemon] input[type=search]");
    if (element) reveal(element);
  }

  function showSettings(id: string) {
    const panel = document.getElementById(id);
    const element = panel?.querySelector<HTMLElement>("[aria-invalid=true]")
      ?? panel?.querySelector<HTMLElement>("select:not(:disabled), input:not(:disabled)")
      ?? panel?.querySelector<HTMLElement>("summary");
    if (element) reveal(element);
  }

  function fixSettings() {
    const id = issues.attacker.length ? controls.attacker : issues.defender.length ? controls.defender : fieldId;
    const panel = document.getElementById(id);
    const element = panel?.querySelector<HTMLElement>("[aria-invalid=true]") ?? panel?.querySelector<HTMLElement>("summary");
    if (element) reveal(element);
  }

  let feedback: ReactNode;
  if (engine.status === "loading") {
    feedback = <Alert variant="info" title="Loading the Champions engine">You can edit builds while the calculator loads. Calculations run locally once loaded.</Alert>;
  } else if (engine.status === "error" || calculation?.error) {
    feedback = (
      <Alert variant="error" title="Calculator unavailable">
        <p>{engine.status === "error" ? engine.message : calculation?.error}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={retry}>Retry calculator</Button>
      </Alert>
    );
  } else if (invalid) {
    feedback = (
      <div>
        <p role="status" className="sr-only">Results paused. Check the highlighted build or field settings.</p>
        <EmptyState title="Check the highlighted settings" description="Invalid or unsupported builds cannot produce damage results. Fix the messages in the Pokémon or field settings to continue." action={<Button variant="secondary" onClick={fixSettings}>Fix settings</Button>} />
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`${styles.root} space-y-5`}>
      <PageHeader
        eyebrow="Pokémon Champions · Level 50"
        title="Damage Calculator"
        description="Pick a move. See damage and remaining HP."
        actions={
          <>
            <Button variant="secondary" onClick={() => setMatchup(swapMatchup)}><ArrowLeftRight className="h-4 w-4" aria-hidden="true" />Swap</Button>
            <Button variant="secondary" onClick={() => setMatchup(resetMatchup)}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reset</Button>
          </>
        }
      />
      <p role="status" className="sr-only">{matchup.notice}</p>
      <div ref={summaryRef} className={styles.summary}>
        <MatchupSummary
          attacker={matchup.attacker}
          defender={matchup.defender}
          selectedMoveId={matchup.selectedMoveId}
          selectedRow={selectedRow}
          blockedReason={blockedReason}
          controls={controls}
          onEdit={edit}
          onShowMove={() => { if (matchup.selectedMoveId) movesRef.current?.showMove(matchup.selectedMoveId); }}
        />
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" aria-controls={teamsId} onClick={() => showSettings(teamsId)}>Teams</Button>
          <Button variant="secondary" size="sm" aria-controls={fieldId} onClick={() => showSettings(fieldId)}>Field settings{issues.field.length > 0 && " · Check settings"}</Button>
          <span className="text-xs text-muted">{describeConditions(matchup.field)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className={`wrap-anywhere text-xs ${teamsFailed ? "text-danger" : "text-muted"}`}>{teamSummary}</p>
          {teamsFailed && <Button variant="secondary" size="sm" onClick={rosters.refresh}>Retry teams</Button>}
        </div>
      </div>
      <MoveResults
        key={matchup.revision}
        ref={movesRef}
        id={controls.moves}
        rows={rows}
        selectedMoveId={matchup.selectedMoveId}
        onSelectMove={(moveId) => setMatchup((current) => selectMatchupMove(current, moveId))}
        contexts={matchup.contexts}
        onContextChange={(moveId, context) => setMatchup((current) => ({ ...current, contexts: { ...current.contexts, [moveId]: context } }))}
        sourceMoveCount={attackerSpecies?.moves.length ?? 0}
        abilityId={attacker.abilityId}
        itemId={attacker.itemId}
        attackerName={attackerSpecies?.name ?? "Attacker"}
        defenderName={defenderSpecies?.name ?? "Defender"}
        defenderHP={currentHP}
        feedback={feedback}
        onReveal={reveal}
      />
      <details id={teamsId} className="rounded-xl border border-line bg-panel">
        <summary className="cursor-pointer rounded-xl px-4 py-4 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:px-5">
          League and opponent<span className="ml-2 font-normal text-muted">{league?.name ?? "Manual matchup"}</span>
          {teamsFailed && <span className="ml-2 text-danger">Could not load teams</span>}
        </summary>
        <div className="px-4 pb-4 sm:px-5 sm:pb-5"><LeagueMatchupPicker state={rosters.state} onLeagueChange={rosters.selectLeague} onOpponentChange={rosters.selectOpponent} onRefresh={rosters.refresh} /></div>
      </details>
      <details id={buildsId} className="rounded-xl border border-line bg-panel">
        <summary className="cursor-pointer rounded-xl px-4 py-4 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:px-5">
          Pokémon and build settings
          {buildIssueCount > 0 && <span className="ml-2 text-danger">{buildIssueCount} settings to check</span>}
        </summary>
        <div className="grid items-start gap-4 px-4 pb-4 sm:px-5 sm:pb-5 lg:grid-cols-2">
          {/* Keys travel with builds so raw numeric edits also survive a Swap. */}
          {(["attacker", "defender"] as const).map((side) => {
            const slot = matchup[side];
            const ownership = slot.role === "own" ? "Your team" : "Opponent's team";
            return (
              <PokemonPanel
                key={slot.key}
                panelId={controls[side]}
                side={side}
                build={slot.build}
                issues={issues[side]}
                editorRevision={slot.editorRevision}
                provenance={slot.source ? `${ownership} · ${slot.source.name}` : undefined}
                onChange={(build) => updateBuild(side, build)}
                roster={<RosterPicker state={rosters.state} role={slot.role} side={side} activeSource={slot.source} onSelect={(choice) => chooseRosterPokemon(side, choice)} />}
              />
            );
          })}
        </div>
      </details>
      <BattleConditions id={fieldId} value={matchup.field} issues={issues.field} onChange={(field) => setMatchup((current) => ({ ...current, field }))} />
      <details className="rounded-xl border border-line bg-panel">
        <summary className="cursor-pointer rounded-xl px-4 py-4 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:px-5">Coverage and v1 assumptions</summary>
        <div className="space-y-4 px-4 pb-4 text-sm text-muted sm:px-5 sm:pb-5">
          <p>Catalog snapshot: {champions.coverage.species} Pokémon/forms and {champions.coverage.moves} moves. {champions.coverage.unsupportedSpecies} Pokémon/forms and {champions.coverage.unsupportedMoves} moves have source or engine data gaps. Further mechanics limitations are reported on builds and individual moves.</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Source availability is not a regulation or team-legality check. Unsupported catalog entries remain selectable and explain why they cannot be calculated.</li>
            <li>Champions only, fixed level 50. Stats use Stat Points and nature; displayed training stats do not include in-battle stages, abilities or items.</li>
            <li>Select a Mega form directly to supply its required stone. This does not simulate transformation timing.</li>
            <li>Weather and terrain must be set explicitly. Conditional ability switches apply only the named condition; do not manually apply the same entry-stage change twice.</li>
            <li>One move use only. Variable multihit moves need an explicit hit count unless Skill Link fixes it; fixed multihit moves are handled automatically. State-dependent mechanics without supported context are not reported as zero damage.</li>
            <li>KO chances, when available, are conditional on hitting and use the selected current HP. Move details retain the engine’s roll groups and assumptions, without guessed future-turn chances.</li>
            <li>The top HP preview subtracts eligible damage rolls from current HP without changing either build. It is not a turn simulation: survival-sensitive selections and multihit results have no remaining-HP estimate. Recoil, healing and later turns are not included.</li>
          </ul>
          <div className="space-y-2 text-xs">
            <p>Engine revision: <a href={champions.sources.engine.url} target="_blank" rel="noreferrer" className={`${linkClassName} break-all text-accent-text underline`}>{champions.sources.engine.revision}</a></p>
            <p>Champions data revision: <a href={champions.sources.showdown.url} target="_blank" rel="noreferrer" className={`${linkClassName} break-all text-accent-text underline`}>{champions.sources.showdown.revision}</a></p>
          </div>
          <details>
            <summary className="cursor-pointer rounded py-2 font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Source coverage notes</summary>
            <ul className="mt-2 list-disc space-y-2 wrap-anywhere pl-5 text-xs">{champions.coverage.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
          </details>
        </div>
      </details>
    </div>
  );
}
