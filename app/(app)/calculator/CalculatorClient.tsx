"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, RotateCcw } from "lucide-react";
import { Alert, Button, EmptyState, Field, PageHeader, Select } from "@/app/components/ui";
import { BATTLE_GAMES, BATTLE_PROFILES, isBattleGame } from "@/app/lib/battle/profiles";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { validateBuild, validateConditions } from "@/app/lib/battle/model";
import type { BattleBuild, BattleGame, BattleMechanic } from "@/app/lib/battle/types";
import { teamNameLabel } from "@/app/lib/league/labels";
import { linkClassName } from "@/app/lib/theme";
import BattleConditions, { describeConditions } from "./BattleConditions";
import CalculatorTabs, { calculatorTabIds, type CalculatorTab } from "./CalculatorTabs";
import MatchupSummary from "./MatchupSummary";
import MoveResults, { type MoveResultsHandle } from "./MoveResults";
import PokemonPanel from "./PokemonPanel";
import PokePasteImporter from "./PokePasteImporter";
import { MyTeamPicker, OpponentPicker, RosterPicker } from "./LeagueMatchupPicker";
import useCalculatorRosters from "./useCalculatorRosters";
import { useDesktopRosterLayout } from "./useDesktopRosterLayout";
import { getBuildHealth, type DamageRollMode } from "./hp-preview";
import type { CalculatorRosterState } from "./roster-data";
import { activateMoveSlot, applyTeamPaste, changeBattleGame, changeTeamSource, createMatchup, dismissMoveReplacement, getAttackView, getTeamPanel, getTeamSourceOwner, reconcileRosters, removeTeamPaste, replaceMatchupMove, resetMatchup, sameMoveOwner, selectMatchupMove, selectRosterPokemon, swapMatchup, toggleMatchupMechanic, toggleMatchupMega, updateImportDraft, updateMatchupBuild, updateMatchupHP, updateMatchupMoveContext, type BattleSide, type MoveOwner, type MoveReplacement, type PasteImport, type PreparedMatchup, type RosterChoice, type RosterRole, type TeamSourceOwner } from "./roster-prep";
import styles from "./calculator.module.css";

export { createMatchup, swapMatchup };

type CalculateMatchup = typeof import("@/app/lib/battle/calculate").calculateMatchup;
type EngineState =
  | { status: "loading" }
  | { status: "ready"; calculate: CalculateMatchup }
  | { status: "error"; message: string };

type RosterFocus = { pickerId: string; choiceKey: string; element: HTMLButtonElement };
type NavigationRequest = { tab: CalculatorTab; reveal: () => void };
type GameLoad = { request: number; status: "idle" | "loading" | "error"; target?: BattleGame; message?: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "An unexpected calculator error occurred.";
}

function rosterFocusTarget(picker: HTMLElement | null) {
  return picker?.querySelector<HTMLButtonElement>("[data-roster-choice][aria-pressed=true]:not(:disabled)")
    ?? picker?.querySelector<HTMLButtonElement>("[data-roster-choice]:not(:disabled)");
}

export default function CalculatorClient() {
  const prefix = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const movesRef = useRef<MoveResultsHandle>(null);
  const pendingNavigation = useRef<NavigationRequest | null>(null);
  const rosterFocusRef = useRef<RosterFocus | null>(null);
  const rememberRosterFocus = useCallback(() => {
    rosterFocusRef.current = null;
    const element = document.activeElement;
    if (!(element instanceof HTMLButtonElement) || !rootRef.current?.contains(element) || element.disabled) return;
    const picker = element.closest<HTMLElement>("[data-calculator-roster]");
    if (picker?.id && element.dataset.rosterChoice !== undefined) {
      rosterFocusRef.current = { pickerId: picker.id, choiceKey: element.dataset.rosterChoice, element };
    }
  }, []);
  const desktopRosters = useDesktopRosterLayout(rememberRosterFocus);
  const [navigation, setNavigation] = useState<{ tab: CalculatorTab; request: number }>({ tab: "moves", request: 0 });
  const [matchup, setMatchup] = useState(() => createMatchup());
  const gameRequest = useRef(0);
  const [gameLoad, setGameLoad] = useState<GameLoad>({ request: 0, status: "idle" });
  const runtime = matchup.runtime;
  const { catalog, speciesById } = runtime;
  const [rollMode, setRollMode] = useState<DamageRollMode>("average");
  const [engine, setEngine] = useState<EngineState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const rosterAccount = useRef<{ id: string | null } | null>(null);
  const receiveRosters = useCallback((state: CalculatorRosterState) => {
    if (state.userId !== null || state.status !== "loading") {
      if (rosterAccount.current && rosterAccount.current.id !== state.userId) {
        const request = ++gameRequest.current;
        setGameLoad({ request, status: "idle" });
        pendingNavigation.current = null;
        rosterFocusRef.current = null;
      }
      rosterAccount.current = { id: state.userId };
    }
    setMatchup((current) => reconcileRosters(current, state));
  }, []);
  const rosters = useCalculatorRosters(receiveRosters);
  const attacker = matchup.attacker.build;
  const defender = matchup.defender.build;
  const fieldId = `${prefix}-field`;
  const controls = { attacker: `${prefix}-build-${matchup.attacker.key}`, defender: `${prefix}-build-${matchup.defender.key}`, moves: `${prefix}-moves` };
  const rosterControls = { attacker: `${prefix}-roster-${matchup.attacker.key}`, defender: `${prefix}-roster-${matchup.defender.key}` };

  useEffect(() => {
    let current = true;
    import("@/app/lib/battle/calculate").then(
      ({ calculateMatchup }) => { if (current) setEngine({ status: "ready", calculate: calculateMatchup }); },
      (error: unknown) => { if (current) setEngine({ status: "error", message: errorMessage(error) }); },
    );
    return () => { current = false; };
  }, [attempt]);

  useEffect(() => () => { gameRequest.current += 1; }, []);

  useEffect(() => {
    const root = rootRef.current;
    const summary = summaryRef.current;
    if (!root || !summary) return;
    const updateHeight = () => {
      const height = summary.getBoundingClientRect().height;
      const navHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-nav-height")) || 0;
      root.style.setProperty("--calculator-summary-height", `${height}px`);
      root.dataset.summaryFits = String(window.innerHeight - navHeight - height - 24 >= 200);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(summary);
    window.addEventListener("resize", updateHeight);
    return () => { observer.disconnect(); window.removeEventListener("resize", updateHeight); };
  }, []);

  const reveal = useCallback((element: HTMLElement, includeSummary = true) => {
    if (!element.isConnected || !rootRef.current?.contains(element) || element.closest("[hidden]") || element.matches(":disabled")) return;
    // Native disclosures keep the original editors mounted, including invalid raw input.
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    if (!element.getClientRects().length) return;
    element.focus({ preventScroll: true });
    const navHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-nav-height")) || 0;
    const summary = summaryRef.current;
    const stickyHeight = includeSummary && summary && getComputedStyle(summary).position === "sticky" ? summary.getBoundingClientRect().height + 8 : 0;
    window.scrollTo({ top: Math.max(0, window.scrollY + element.getBoundingClientRect().top - navHeight - stickyHeight - 16) });
  }, []);

  const visit = useCallback((tab: CalculatorTab, action: () => void) => {
    pendingNavigation.current = { tab, reveal: action };
    // A fresh request also processes repeated shortcuts to an already-active tab.
    setNavigation((current) => ({ tab, request: current.request + 1 }));
  }, []);

  const selectTab = useCallback((tab: CalculatorTab) => {
    pendingNavigation.current = null;
    setNavigation((current) => current.tab === tab ? current : { ...current, tab });
  }, []);

  useEffect(() => {
    const pending = pendingNavigation.current;
    if (!pending || pending.tab !== navigation.tab) return;
    pendingNavigation.current = null;
    pending.reveal();
  }, [navigation]);

  useEffect(() => {
    const focused = rosterFocusRef.current;
    rosterFocusRef.current = null;
    if (!focused) return;
    const canRestore = () => document.activeElement === document.body || document.activeElement === focused.element;
    if (!canRestore()) return;
    const restore = () => {
      if (!canRestore()) return;
      const picker = document.getElementById(focused.pickerId);
      const sameChoice = picker && [...picker.querySelectorAll<HTMLButtonElement>("[data-roster-choice]:not(:disabled)")]
        .find((button) => button.dataset.rosterChoice === focused.choiceKey);
      const target = sameChoice ?? rosterFocusTarget(picker);
      if (target) reveal(target, !desktopRosters);
    };
    if (desktopRosters) {
      pendingNavigation.current = null;
      restore();
    } else visit("builds", restore);
  }, [desktopRosters, reveal, visit]);

  const attackView = useMemo(() => getAttackView(matchup), [matchup]);
  const calculation = useMemo(() => {
    if (engine.status !== "ready") return null;
    const identity = { source: attackView.owner, receiver: attackView.receiverOwner };
    try {
      return { identity, result: engine.calculate(attackView.source.build, attackView.receiver.build, attackView.field, attackView.contexts, runtime), error: null };
    } catch (error) {
      return { identity, result: null, error: errorMessage(error) };
    }
  }, [engine, attackView, runtime]);

  // Editors and stored side conditions keep their physical left/right identity.
  const issues = {
    attacker: validateBuild(attacker, runtime),
    defender: validateBuild(defender, runtime),
    field: validateConditions(matchup.field, runtime),
  };
  const buildIssueCount = issues.attacker.length + issues.defender.length;
  const invalid = buildIssueCount > 0 || issues.field.length > 0;
  const resultsBlocked = engine.status !== "ready" || !!calculation?.error || invalid;
  const sourceSpecies = speciesById.get(attackView.source.build.speciesId);
  const receiverSpecies = speciesById.get(attackView.receiver.build.speciesId);
  const currentBatch = calculation && sameMoveOwner(calculation.identity.source, attackView.owner) && sameMoveOwner(calculation.identity.receiver, attackView.receiverOwner);
  const rows = !resultsBlocked && currentBatch ? calculation.result?.results ?? [] : [];
  const selectedRow = rows.find((row) => row.moveId === attackView.moveId);
  const currentHP = getBuildHealth(attackView.receiver.build, runtime)?.current ?? null;
  const replacement = matchup.replacement;
  const league = rosters.state.leagues.find((entry) => entry.id === rosters.state.selectedLeagueId);
  const currentTeams = rosters.state.teamsStatus === "ready" && rosters.state.data?.leagueId === league?.id ? rosters.state.data : null;
  const ownMember = currentTeams?.members.find((member) => member.id === league?.memberId);
  const opponent = currentTeams?.members.find((member) => member.id === rosters.state.opponentId);
  const rosterPanels = { own: getTeamPanel(matchup, rosters.state, "own"), opponent: getTeamPanel(matchup, rosters.state, "opponent") };
  const usesLeague = matchup.teams.own.mode === "league" || matchup.teams.opponent.mode === "league";
  const onlyLeague = matchup.teams.own.mode === "league" && matchup.teams.opponent.mode === "league";
  const teamsLoading = usesLeague && (rosters.state.status === "loading" || rosters.state.teamsStatus === "loading");
  const teamsFailed = usesLeague && (rosters.state.status === "error" || rosters.state.teamsStatus === "error");
  const describeTeam = (role: RosterRole) => rosterPanels[role].teamName ?? (matchup.teams[role].mode === "paste" ? "Import a PokéPaste" : rosterPanels[role].message);
  const teamSummary = !onlyLeague ? `Your team: ${describeTeam("own")} · Opponent: ${describeTeam("opponent")}` : teamsLoading ? "Loading your leagues and teams…"
    : teamsFailed ? "Teams unavailable — retry or use manual Pokémon."
      : rosters.state.status === "signed-out" ? "Sign in to use league rosters. Manual Pokémon still work."
        : league ? `${teamNameLabel(ownMember ? ownMember.team_name : league.teamName)} — ${league.name} · ${opponent ? `Facing ${teamNameLabel(opponent.team_name)}` : "Choose an opponent"}`
          : "Choose My team, or use manual Pokémon.";
  const blockedReason = engine.status === "loading" ? "HP preview paused while the calculator loads."
    : engine.status === "error" || calculation?.error ? "HP preview unavailable. Retry the calculator."
      : invalid ? "HP preview paused. Fix the highlighted build or field settings." : undefined;

  function restoreGameSelectorFocus(control: HTMLElement | null) {
    if (control && document.activeElement === control) document.getElementById(`${prefix}-game`)?.focus({ preventScroll: true });
  }

  function cancelGameLoad() {
    if (gameLoad.status === "idle") return;
    const request = ++gameRequest.current;
    setGameLoad({ request, status: "idle" });
  }

  function chooseGame(game: BattleGame, retryLoad = false) {
    if (game === runtime.profile.id) {
      cancelGameLoad();
      return;
    }
    if (!retryLoad && !window.confirm(`Switch both Pokémon to ${BATTLE_PROFILES[game].label}? Builds, field edits, active mechanics and preparation caches will reset. Team documents, drafts and league selections will be kept.`)) return;
    const request = ++gameRequest.current;
    const revision = matchup.revision;
    const identity = runtime.identity;
    pendingNavigation.current = null;
    rosterFocusRef.current = null;
    setGameLoad({ request, status: "loading", target: game });
    loadBattleRuntime(game).then((nextRuntime) => {
      if (request !== gameRequest.current) return;
      restoreGameSelectorFocus(document.getElementById(`${prefix}-cancel-game-${request}`));
      setMatchup((current) => current.revision === revision && current.runtime.identity === identity
        ? changeBattleGame(current, nextRuntime) : current);
      setGameLoad({ request, status: "idle" });
    }, (error: unknown) => {
      if (request !== gameRequest.current) return;
      restoreGameSelectorFocus(document.getElementById(`${prefix}-cancel-game-${request}`));
      setGameLoad({ request, status: "error", target: game, message: errorMessage(error) });
    });
  }

  function retry() {
    setEngine({ status: "loading" });
    setAttempt((value) => value + 1);
  }

  function updateCombatant(key: number, update: (current: PreparedMatchup, side: BattleSide) => PreparedMatchup) {
    pendingNavigation.current = null;
    setMatchup((current) => {
      const side = current.attacker.key === key ? "attacker" : current.defender.key === key ? "defender" : null;
      return side ? update(current, side) : current;
    });
  }

  function updateBuild(key: number, build: BattleBuild) {
    updateCombatant(key, (current, side) => updateMatchupBuild(current, side, build));
  }

  function updateHP(key: number, text: string) {
    updateCombatant(key, (current, side) => updateMatchupHP(current, side, text));
  }

  function chooseRosterPokemon(key: number, choice: RosterChoice) {
    updateCombatant(key, (current, side) => selectRosterPokemon(current, side, choice));
  }

  function renderRoster(side: BattleSide, variant: "inline" | "rail") {
    const slot = matchup[side];
    return <RosterPicker pickerId={rosterControls[side]} variant={variant} panel={rosterPanels[slot.role]} role={slot.role} side={side} activeSource={slot.source} onSelect={(choice) => chooseRosterPokemon(slot.key, choice)} />;
  }

  function focusTeamSource(role: RosterRole) {
    visit(role === "own" ? "team" : "opponent", () => {
      const button = document.getElementById(`${prefix}-source-${role}`)?.querySelector<HTMLButtonElement>("[aria-pressed=true]");
      if (button) reveal(button);
    });
  }

  function applyPaste(owner: TeamSourceOwner, input: PasteImport) {
    setMatchup((current) => applyTeamPaste(current, owner, input));
    focusTeamSource(owner.role);
  }

  function removePaste(owner: TeamSourceOwner) {
    setMatchup((current) => removeTeamPaste(current, owner));
    focusTeamSource(owner.role);
  }

  function renderTeamSource(role: RosterRole) {
    const owner = getTeamSourceOwner(matchup, role);
    const selection = matchup.teams[role];
    return (
      <>
        <div id={`${prefix}-source-${role}`} role="group" aria-label={`${role === "own" ? "My team" : "Opponent"} source`} className="flex flex-wrap gap-2">
          {(["league", "paste"] as const).map((mode) => (
            <Button key={mode} data-team-source={role} data-team-mode={mode} variant={selection.mode === mode ? "primary" : "secondary"} aria-pressed={selection.mode === mode} onClick={() => {
              pendingNavigation.current = null;
              setMatchup((current) => changeTeamSource(current, owner, mode));
            }}>{mode === "league" ? "League team" : "PokéPaste"}</Button>
          ))}
        </div>
        {selection.mode === "paste" ? (
          <fieldset disabled={gameLoad.status === "loading"} className="min-w-0">
            <PokePasteImporter key={`${owner.revision}:${role}:${owner.epoch}:${gameLoad.request}`} runtime={runtime} role={role} owner={owner} applied={selection.paste}
              draft={matchup.drafts[role]} onDraftChange={(draft) => setMatchup((current) => updateImportDraft(current, owner, draft))}
              onApply={applyPaste} onRemove={removePaste} onReveal={reveal} />
          </fieldset>
        ) : role === "own" ? (
          <MyTeamPicker state={rosters.state} onLeagueChange={rosters.selectLeague} onRefresh={rosters.refresh} />
        ) : (
          <OpponentPicker state={rosters.state} onOpponentChange={rosters.selectOpponent} onLeagueChange={matchup.teams.own.mode === "paste" ? rosters.selectLeague : undefined} onRefresh={rosters.refresh} />
        )}
      </>
    );
  }

  function fixSettings() {
    const tab = issues.attacker.length || issues.defender.length ? "builds" : "field";
    const id = issues.attacker.length ? controls.attacker : issues.defender.length ? controls.defender : fieldId;
    visit(tab, () => {
      const panel = document.getElementById(id);
      const element = panel?.querySelector<HTMLElement>("[aria-invalid=true]:not(:disabled)")
        ?? panel?.querySelector<HTMLElement>("select:not(:disabled), input:not(:disabled), summary, [tabindex]")
        ?? document.getElementById(calculatorTabIds(prefix, tab).panelId);
      if (element) reveal(element);
    });
  }

  function activateQuickMove(owner: MoveOwner, slotIndex: number) {
    pendingNavigation.current = null;
    setMatchup((current) => activateMoveSlot(current, owner, slotIndex));
    selectTab("moves");
  }

  function toggleMega(owner: MoveOwner, formId: string) {
    pendingNavigation.current = null;
    setMatchup((current) => toggleMatchupMega(current, owner, formId));
  }

  function toggleMechanic(owner: MoveOwner, mechanic: BattleMechanic) {
    pendingNavigation.current = null;
    setMatchup((current) => toggleMatchupMechanic(current, owner, mechanic));
  }

  function updateReplacement(replacement: MoveReplacement, moveId?: string) {
    pendingNavigation.current = null;
    setMatchup((current) => moveId === undefined ? dismissMoveReplacement(current, replacement) : replaceMatchupMove(current, replacement, moveId));
    const button = summaryRef.current?.querySelector<HTMLButtonElement>(`[data-move-owner="${replacement.owner.key}:${replacement.owner.epoch}"][data-move-slot="${replacement.slotIndex}"][data-move-session="${replacement.session}"]`);
    if (button) reveal(button, false);
  }

  function showMove() {
    const moveId = attackView.moveId;
    const ownerId = `${attackView.owner.key}:${attackView.owner.epoch}`;
    if (!moveId) return;
    if (replacement) setMatchup((current) => dismissMoveReplacement(current, replacement));
    visit("moves", () => movesRef.current?.showMove(moveId, ownerId));
  }

  function panelProps(tab: CalculatorTab) {
    const ids = calculatorTabIds(prefix, tab);
    return {
      id: ids.panelId,
      role: "tabpanel",
      "aria-labelledby": ids.tabId,
      "data-calculator-panel": tab,
      hidden: navigation.tab !== tab,
      tabIndex: 0,
      className: `${styles.panel} min-w-0 space-y-5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus`,
    };
  }

  let feedback: ReactNode;
  if (engine.status === "loading") {
    feedback = <Alert variant="info" title={runtime.profile.id === "champions" ? "Loading the Champions engine" : "Loading the battle engine"}>You can edit builds while the calculator loads. Calculations run locally once loaded.</Alert>;
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
        <EmptyState title="Check the highlighted settings" description="Invalid or unsupported builds cannot produce damage results. Fix the messages in Build settings or Field conditions to continue." action={<Button variant="secondary" onClick={fixSettings}>Fix settings</Button>} />
      </div>
    );
  }

  return (
    <div ref={rootRef} data-calculator-layout={desktopRosters ? "desktop" : "compact"} className={`${styles.root} space-y-5`}>
      <PageHeader
        eyebrow={`${runtime.profile.label} · ${runtime.profile.id === "champions" ? "Level 50" : "Native levels, EVs and IVs"}`}
        title="Damage Calculator"
        description="Choose your teams, pick a move, and preview damage and remaining HP."
        actions={
          <>
            <Button variant="secondary" onClick={() => { pendingNavigation.current = null; cancelGameLoad(); setMatchup(swapMatchup); }}><ArrowLeftRight className="h-4 w-4" aria-hidden="true" />Swap</Button>
            <Button variant="secondary" onClick={() => { selectTab("moves"); cancelGameLoad(); setMatchup(resetMatchup); setRollMode("average"); }}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reset</Button>
          </>
        }
      />
      <section aria-label="Battle game rules" className="rounded-xl border border-line bg-panel p-4">
        <Field id={`${prefix}-game`} label="Battle game" help="One game's rules apply to both Pokémon. Changing game resets preparation, not your team documents.">
          <Select value={runtime.profile.id} onChange={(event) => { if (isBattleGame(event.target.value)) chooseGame(event.target.value); }}>
            {BATTLE_GAMES.map((game) => <option key={game} value={game}>{BATTLE_PROFILES[game].label}</option>)}
          </Select>
        </Field>
        {gameLoad.status === "loading" && <div className="mt-2 flex flex-wrap items-center gap-2">
          <p role="status" className="text-sm text-muted">Loading {gameLoad.target ? BATTLE_PROFILES[gameLoad.target].label : "game rules"}… Current rules stay active until ready.</p>
          <Button id={`${prefix}-cancel-game-${gameLoad.request}`} size="sm" variant="secondary" onClick={(event) => {
            restoreGameSelectorFocus(event.currentTarget);
            cancelGameLoad();
          }}>Cancel game change</Button>
        </div>}
        {gameLoad.status === "error" && <div className="mt-2">
          <p role="alert" className="text-sm text-danger">Could not load game rules: {gameLoad.message} Your current matchup was kept.</p>
          <p className="mt-2 text-sm text-muted">A failed game download can stay cached in this tab. If Retry fails again, reload the calculator to retry the download. Reloading clears this page’s imported teams, drafts and preparation.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {gameLoad.target && <Button size="sm" variant="secondary" onClick={(event) => {
              restoreGameSelectorFocus(event.currentTarget);
              chooseGame(gameLoad.target!, true);
            }}>Retry game rules</Button>}
            <Button size="sm" variant="secondary" onClick={() => {
              if (window.confirm("Reload the calculator? This clears this page’s imported teams, drafts, game selection and preparation. Cancel to keep your current matchup.")) window.location.reload();
            }}>Reload calculator</Button>
          </div>
        </div>}
      </section>
      <CalculatorTabs prefix={prefix} activeTab={navigation.tab} onSelect={selectTab} issues={{ builds: buildIssueCount, field: issues.field.length }} />
      <p role="status" className="sr-only">{matchup.notice}</p>
      <div data-calculator-workspace className={desktopRosters ? styles.withRosters : undefined}>
        <div data-calculator-center className={`${styles.center} space-y-5`}>
          <div ref={summaryRef} className={styles.summary}>
            <MatchupSummary
              runtime={runtime}
              onToggleMechanic={toggleMechanic}
              attacker={matchup.attacker}
              defender={matchup.defender}
              attack={matchup.attack}
              replacement={matchup.replacement}
              resultIdentity={calculation?.identity}
              selectedRow={selectedRow}
              onActivateMove={activateQuickMove}
              onToggleMega={toggleMega}
              rollMode={rollMode}
              onRollModeChange={setRollMode}
              blockedReason={blockedReason}
              issues={issues}
              movesControl={controls.moves}
              rosterPanels={rosterPanels}
              onBuildChange={updateBuild}
              onHPChange={updateHP}
              onRosterSelect={chooseRosterPokemon}
              onShowMove={showMove}
            />
          </div>
          <div className="space-y-2 text-xs text-muted">
            <p>{describeConditions(matchup.field)}</p>
            <div className="flex flex-wrap items-center gap-2">
              <p role="status" className={`wrap-anywhere ${teamsFailed ? "text-danger" : ""}`}>{teamSummary}</p>
              {teamsFailed && <Button variant="secondary" size="sm" disabled={teamsLoading} onClick={rosters.refresh}>Retry teams</Button>}
            </div>
          </div>
          {feedback && <div data-calculator-feedback>{feedback}</div>}
          <div>
            <div {...panelProps("team")}>
              {renderTeamSource("own")}
            </div>
            <div {...panelProps("moves")}>
              <MoveResults
                key={matchup.revision}
                ref={movesRef}
                runtime={runtime}
                sourceBuild={attackView.source.build}
                id={controls.moves}
                rows={rows}
                moveIds={sourceSpecies?.moves ?? []}
                ownerId={`${attackView.owner.key}:${attackView.owner.epoch}`}
                selectedMoveId={attackView.moveId}
                onSelectMove={(moveId) => setMatchup((current) => selectMatchupMove(current, moveId, attackView.owner))}
                contexts={attackView.contexts}
                onContextChange={(moveId, context) => setMatchup((current) => updateMatchupMoveContext(current, attackView.owner, moveId, context))}
                replacement={replacement ? {
                  slotIndex: replacement.slotIndex,
                  moves: attackView.source.moves,
                  onReplace: (moveId) => updateReplacement(replacement, moveId),
                  onDone: () => updateReplacement(replacement),
                } : undefined}
                abilityId={attackView.source.build.abilityId}
                itemId={attackView.source.build.itemId}
                attackerName={sourceSpecies?.name ?? "Source Pokémon"}
                defenderName={receiverSpecies?.name ?? "Receiving Pokémon"}
                sourcePosition={attackView.sourceSide === "attacker" ? "left" : "right"}
                defenderHP={currentHP}
                blocked={resultsBlocked}
                onReveal={reveal}
              />
              <details className="rounded-xl border border-line bg-panel">
                <summary className="cursor-pointer rounded-xl px-4 py-4 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:px-5">Coverage and v1 assumptions</summary>
                <div className="space-y-4 px-4 pb-4 text-sm text-muted sm:px-5 sm:pb-5">
                  <p>Catalog snapshot: {catalog.coverage.species} Pokémon/forms and {catalog.coverage.moves} moves. {catalog.coverage.unsupportedSpecies} Pokémon/forms and {catalog.coverage.unsupportedMoves} moves have source or engine data gaps. Further mechanics limitations are reported on builds and individual moves.</p>
                  <ul className="list-disc space-y-2 pl-5">
                    <li>Each team can use league roster names or imported PokéPaste sets. Imports keep the specified builds and ordered moves, including status moves and empty slots. Imports and edits stay in this page session; Reset keeps the original imported teams but clears session edits.</li>
                    <li>Quick moves on non-imported builds are editable starting assumptions, not a discovered opponent moveset. Champions defaults use August 2026 Smogon Pokémon Showdown Champions usage at rating cutoff 1630: VGC Reg M-B for Doubles and Battle Stadium Reg M-B for Singles. Other games use legal suggestions, not Champions usage or claimed per-species popularity. Changing Singles/Doubles keeps existing picks.</li>
                    <li>Click a quick move on either Pokémon to calculate against the other without moving the cards. Replace updates that slot, selects the new move and keeps the slot editable. Assigned moves are hidden from replacement choices. Done or Escape closes editing while keeping the selected calculation; ordinary move browsing does not rewrite your prepared moves.</li>
                    <li>Source availability is not a regulation or team-legality check. Unsupported catalog entries remain selectable and explain why they cannot be calculated.</li>
                    <li>Champions uses fixed level 50 and Stat Points. Native games preserve levels, EVs and IVs; a native paste with no level defaults to 100. Displayed training stats exclude stages, abilities and items. The Battle game selector applies to both sides and is independent of paste spread encoding and league pool rules.</li>
                    <li>Imported Tera types, Dynamax levels and Gigantamax factors are configuration, not activation. Use the game-specific controls to activate an effect. Z use is assumed still available; Stellar boosts need explicit first-use context. Status-Z bonuses, G-Max residual turns and battle-wide consumption are not simulated. Unverified effects are labelled instead of falling back to ordinary damage.</li>
                    <li>Dynamax keeps the HP editor in base/pre-Dynamax units and displays effective HP separately. Changing game resets active preparation and caches but retains original team text for revalidation. No future Champions mechanic is enabled until its engine and rules are verified.</li>
                    <li>Mega buttons beside each Pokémon’s name change its form, ability, required stone and stats without resetting training, HP or moves. Click the active form again to restore the base ability and item; a directly chosen Mega returns to base defaults. Unsupported forms retain their warnings. This does not simulate transformation timing, entry effects or automatic weather/terrain.</li>
                    <li>Weather and terrain must be set explicitly. Conditional ability switches apply only the named condition; do not manually apply the same entry-stage change twice.</li>
                    <li>One move use only. Variable multihit moves need an explicit hit count unless Skill Link fixes it; fixed multihit moves are handled automatically. State-dependent mechanics without supported context are not reported as zero damage.</li>
                    <li>KO chances, when available, are conditional on hitting and use the selected current HP. Move details retain the engine’s roll groups and assumptions, without guessed future-turn chances.</li>
                    <li>The top HP bar previews the selected Low, Average or High damage roll without changing either build. Average uses the mean of all damage rolls, rounded to whole HP before subtracting from current HP. It is not a turn simulation: survival-sensitive selections and multihit results have no remaining-HP estimate. Recoil, healing and later turns are not included.</li>
                  </ul>
                  <div className="space-y-2 text-xs">
                    <p>Engine revision: <a href={catalog.sources.engine.url} target="_blank" rel="noreferrer" className={`${linkClassName} break-all text-accent-text underline`}>{catalog.sources.engine.revision}</a></p>
                    <p>Game data revision: <a href={catalog.sources.showdown.url} target="_blank" rel="noreferrer" className={`${linkClassName} break-all text-accent-text underline`}>{catalog.sources.showdown.revision}</a></p>
                  </div>
                  <details>
                    <summary className="cursor-pointer rounded py-2 font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Source coverage notes</summary>
                    <ul className="mt-2 list-disc space-y-2 wrap-anywhere pl-5 text-xs">{catalog.coverage.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
                  </details>
                </div>
              </details>
            </div>
            <div {...panelProps("builds")}>
              <section aria-labelledby={`${prefix}-builds-heading`} className="rounded-xl border border-line bg-panel">
                <h2 id={`${prefix}-builds-heading`} className="px-4 py-4 text-sm font-semibold text-text sm:px-5">
                  Pokémon and build settings
                  {buildIssueCount > 0 && <span className="ml-2 text-danger">{buildIssueCount} settings to check</span>}
                </h2>
                <div className={`${styles.builds} grid items-start gap-4 px-4 pb-4 sm:px-5 sm:pb-5`}>
                  {/* Keys travel with builds so raw numeric edits also survive a Swap. */}
                  {(["attacker", "defender"] as const).map((side) => {
                    const slot = matchup[side];
                    const ownership = slot.role === "own" ? "Your team" : "Opponent's team";
                    return (
                      <PokemonPanel
                        key={slot.key}
                        runtime={runtime}
                        panelId={controls[side]}
                        side={side}
                        build={slot.build}
                        issues={issues[side]}
                        editorRevision={slot.editorRevision}
                        provenance={slot.source ? `${ownership} · ${slot.source.name}` : undefined}
                        onChange={(build) => updateBuild(slot.key, build)}
                        hpInput={slot.hpInput}
                        onHPChange={(text) => updateHP(slot.key, text)}
                        onReveal={reveal}
                        roster={desktopRosters ? undefined : renderRoster(side, "inline")}
                      />
                    );
                  })}
                </div>
              </section>
            </div>
            <div {...panelProps("field")}>
              <BattleConditions runtime={runtime} id={fieldId} value={matchup.field} issues={issues.field} onChange={(field) => setMatchup((current) => current.revision === matchup.revision ? { ...current, field } : current)} />
            </div>
            <div {...panelProps("opponent")}>
              {renderTeamSource("opponent")}
            </div>
          </div>
        </div>
        {desktopRosters && (["attacker", "defender"] as const).map((side) => (
          <aside key={side} data-calculator-roster-rail={side} aria-label={`${side === "attacker" ? "Left Pokémon" : "Right Pokémon"} team shortcuts`} className={`${styles.rail} ${side === "attacker" ? styles.attackerRoster : styles.defenderRoster}`}>
            {renderRoster(side, "rail")}
          </aside>
        ))}
      </div>
    </div>
  );
}
