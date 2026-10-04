"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type SetStateAction } from "react";
import { ArrowLeftRight, RotateCcw } from "lucide-react";
import { Button, Field, PageHeader, Select } from "@/app/components/ui";
import { BATTLE_GAMES, BATTLE_PROFILES, isBattleGame } from "@/app/lib/battle/profiles";
import { beatUpPartyOptions } from "@/app/lib/battle/count-moves";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { movesSpeciesId } from "@/app/lib/battle/imposter";
import { fieldItemChoice, roomItemChoice, validateBuild, validateConditions } from "@/app/lib/battle/model";
import { DOUBLES_SLOTS, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleBuild, BattleGame, BattleMechanic } from "@/app/lib/battle/types";
import { teamNameLabel } from "@/app/lib/league/labels";
import { linkClassName } from "@/app/lib/theme";
import BattleConditions, { describeConditions } from "./BattleConditions";
import CalculatorTabs, { calculatorTabIds, type CalculatorTab } from "./CalculatorTabs";
import CalculatorModeSwitch, { type CalculatorMode } from "./CalculatorModeSwitch";
import { createDoubles, followShared, resetDoubles, type CalculatorState } from "./doubles-prep";
import { useDoublesView } from "./useDoublesView";
import KeepWhileHidden from "./KeepWhileHidden";
import ResultsFeedback, { hasResultsFeedback, previewBlockedReason } from "./results-feedback";
import BuildSettingsSections, { type BuildSettings } from "./BuildSettings";
import SettingsDisclosure from "./SettingsDisclosure";
import MatchupSummary from "./MatchupSummary";
import MoveResults, { type MoveResultsHandle } from "./MoveResults";
import PokemonPanel from "./PokemonPanel";
import PokePasteImporter from "./PokePasteImporter";
import { MyTeamPicker, OpponentPicker, RosterPicker } from "./LeagueMatchupPicker";
import useCalculatorRosters from "./useCalculatorRosters";
import { useDesktopRosterLayout } from "./useDesktopRosterLayout";
import { errorMessage, useMatchupCalculation, type CalculateMatchup } from "./useMatchupCalculation";
import { getBuildHealth, getSettledHealth, type DamageRollMode } from "./hp-preview";
import { buildSectionKey, fieldSectionKey, NO_SETTINGS_SECTIONS, setSectionOpen, trackSectionIssues } from "./settings-sections";
import type { CalculatorRosterState } from "./roster-data";
import { activateMoveSlot, applyMatchupIntimidate, applyTeamPaste, intimidateResult, changeBattleGame, changeTeamSource, createMatchup, dismissMoveReplacement, equipRequiredMove, getAttackView, getTeamPanel, getTeamSourceOwner, reconcileRosters, removeTeamPaste, replaceMatchupMove, resetMatchup, sameMoveOwner, selectMatchupMove, selectRosterPokemon, swapMatchup, toggleMatchupMechanic, toggleMatchupMega, updateImportDraft, updateMatchupBuild, updateMatchupHP, updateMatchupMoveContext, type BattleSide, type MoveOwner, type MoveReplacement, type PasteImport, type PreparedMatchup, type RosterChoice, type RosterRole, type TeamSourceOwner } from "./roster-prep";
import styles from "./calculator.module.css";

export { createMatchup, swapMatchup };

type EngineState =
  | { status: "loading" }
  | { status: "ready"; calculate: CalculateMatchup }
  | { status: "error"; message: string };

/** `slot`: a 2v2 shortcut, from its button (rail) or its picker (Build settings). */
type RosterFocus = { pickerId: string; choiceKey: string; element: HTMLButtonElement; slot?: DoublesSlotId };
/** A pending reveal, run once its tab (or, without one, the opened settings section) has rendered. */
type NavigationRequest = { tab: CalculatorTab | null; reveal: () => void };
type GameLoad = { request: number; status: "idle" | "loading" | "error"; target?: BattleGame; message?: string };

function rosterFocusTarget(picker: HTMLElement | null) {
  return picker?.querySelector<HTMLButtonElement>("[data-roster-choice][aria-pressed=true]:not(:disabled)")
    ?? picker?.querySelector<HTMLButtonElement>("[data-roster-choice]:not(:disabled)");
}

export default function CalculatorClient({ initialMode = "1v1" }: { initialMode?: CalculatorMode }) {
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
      const slot = [element.dataset.rosterSlot, picker.dataset.calculatorRoster].find((value): value is DoublesSlotId => DOUBLES_SLOTS.includes(value as DoublesSlotId));
      rosterFocusRef.current = { pickerId: picker.id, choiceKey: element.dataset.rosterChoice, element, ...(slot ? { slot } : {}) };
    }
  }, []);
  const desktopRosters = useDesktopRosterLayout(rememberRosterFocus);
  const [navigation, setNavigation] = useState<{ tab: CalculatorTab; request: number }>({ tab: "moves", request: 0 });
  const [sections, setSections] = useState(NO_SETTINGS_SECTIONS);
  const [calc, setCalc] = useState<CalculatorState>(() => ({ matchup: createMatchup(), doubles: createDoubles() }));
  const matchup = calc.matchup;
  // Every 1v1 update also keeps 2v2 consistent (doubles-prep followShared): game, account and team sources.
  const setMatchup = useCallback((update: SetStateAction<PreparedMatchup>) => {
    setCalc((current) => {
      const after = typeof update === "function" ? update(current.matchup) : update;
      return after === current.matchup ? current : { matchup: after, doubles: followShared(current.doubles, current.matchup, after) };
    });
  }, []);
  const [mode, setMode] = useState<CalculatorMode>(initialMode);
  const [doublesMounted, setDoublesMounted] = useState(initialMode === "2v2");
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
    setCalc((current) => {
      const after = reconcileRosters(current.matchup, state);
      const doubles = followShared(current.doubles, current.matchup, after, state);
      return after === current.matchup && doubles === current.doubles ? current : { matchup: after, doubles };
    });
  }, []);
  const rosters = useCalculatorRosters(receiveRosters);
  const attacker = matchup.attacker.build;
  const defender = matchup.defender.build;
  const attackerKey = matchup.attacker.key;
  const defenderKey = matchup.defender.key;
  const fieldId = `${prefix}-field`;
  const fieldKey = fieldSectionKey(matchup.revision);
  const controls = { attacker: `${prefix}-build-${attackerKey}`, defender: `${prefix}-build-${defenderKey}`, moves: `${prefix}-moves` };
  const rosterControls = { attacker: `${prefix}-roster-${attackerKey}`, defender: `${prefix}-roster-${defenderKey}` };

  useEffect(() => {
    let current = true;
    import("@/app/lib/battle/calculate").then(
      ({ calculateMatchup }) => { if (current) setEngine({ status: "ready", calculate: calculateMatchup }); },
      (error: unknown) => { if (current) setEngine({ status: "error", message: errorMessage(error) }); },
    );
    return () => { current = false; };
  }, [attempt]);

  useEffect(() => () => { gameRequest.current += 1; }, []);

  // Only the compact summary is measured: the settings sit below it, outside the pinned box.
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
    const stickyHeight = includeSummary && summary && !summary.contains(element) && !summary.closest("[hidden]") && getComputedStyle(summary).position === "sticky" ? summary.getBoundingClientRect().height + 8 : 0;
    const bounds = element.getBoundingClientRect();
    // Already in view, such as a quick move in the pinned summary: scrolling would only move the page.
    if (bounds.top >= navHeight + stickyHeight && bounds.bottom <= window.innerHeight) return;
    window.scrollTo({ top: Math.max(0, window.scrollY + bounds.top - navHeight - stickyHeight - 16) });
  }, []);

  const visit = useCallback((tab: CalculatorTab, action: () => void) => {
    pendingNavigation.current = { tab, reveal: action };
    // A fresh request also processes repeated shortcuts to an already-active tab.
    setNavigation((current) => ({ tab, request: current.request + 1 }));
  }, []);

  /** Opens a settings section (settings-sections.ts key), then runs the reveal once it has rendered. */
  const visitSection = useCallback((key: string, action: () => void) => {
    pendingNavigation.current = { tab: null, reveal: action };
    setSections((current) => setSectionOpen(current, key, true));
    setNavigation((current) => ({ ...current, request: current.request + 1 }));
  }, []);

  const cancelPending = useCallback(() => { pendingNavigation.current = null; }, []);

  /** Runs `action` once the next render is done, without changing tabs (2v2's settings sections). */
  const afterRender = useCallback((action: () => void) => {
    pendingNavigation.current = { tab: null, reveal: action };
    setNavigation((current) => ({ ...current, request: current.request + 1 }));
  }, []);

  const toggleSection = useCallback((key: string) => {
    setSections((current) => setSectionOpen(current, key, !current.open[key]));
  }, []);

  const selectTab = useCallback((tab: CalculatorTab) => {
    pendingNavigation.current = null;
    setNavigation((current) => current.tab === tab ? current : { ...current, tab });
  }, []);

  useEffect(() => {
    const pending = pendingNavigation.current;
    if (!pending || (pending.tab !== null && pending.tab !== navigation.tab)) return;
    pendingNavigation.current = null;
    pending.reveal();
  }, [navigation]);

  const rosterPanels = { own: getTeamPanel(matchup, rosters.state, "own"), opponent: getTeamPanel(matchup, rosters.state, "opponent") };
  const doubles = useDoublesView({
    prefix, calc, setCalc, active: mode === "2v2", mounted: doublesMounted, rosterPanels, desktopRosters, rollMode, onRollModeChange: setRollMode,
    navigation: { cancelPending, visit, afterRender, reveal, selectTab },
  });
  const restoreDoublesRosterFocus = doubles.restoreRosterFocus;

  useEffect(() => {
    const focused = rosterFocusRef.current;
    rosterFocusRef.current = null;
    if (!focused) return;
    const canRestore = () => document.activeElement === document.body || document.activeElement === focused.element;
    if (!canRestore()) return;
    if (focused.slot) {
      restoreDoublesRosterFocus(focused.slot, focused.choiceKey, canRestore);
      return;
    }
    const restore = () => {
      if (!canRestore()) return;
      const picker = document.getElementById(focused.pickerId);
      const sameChoice = picker && [...picker.querySelectorAll<HTMLButtonElement>("[data-roster-choice]:not(:disabled)")]
        .find((button) => button.dataset.rosterChoice === focused.choiceKey);
      const target = sameChoice ?? rosterFocusTarget(picker);
      if (target) reveal(target, !desktopRosters);
    };
    // Compact layouts keep the roster in that Pokémon's Build settings, which opens first.
    const key = desktopRosters ? undefined : [attackerKey, defenderKey].find((candidate) => focused.pickerId === `${prefix}-roster-${candidate}`);
    if (key === undefined) {
      pendingNavigation.current = null;
      restore();
    } else visitSection(buildSectionKey(key), restore);
  }, [desktopRosters, reveal, visitSection, prefix, attackerKey, defenderKey, restoreDoublesRosterFocus]);

  const attackView = useMemo(() => getAttackView(matchup), [matchup]);
  // Keyed on the builds, field and contexts, so a row click or an import-draft edit reuses the result.
  const calculation = useMatchupCalculation(engine.status === "ready" ? engine.calculate : null, matchup, attackView);

  // Editors and stored side conditions keep their physical left/right identity.
  const issues = {
    attacker: validateBuild(attacker, runtime),
    defender: validateBuild(defender, runtime),
    field: validateConditions(matchup.field, runtime),
  };
  const buildIssueCount = issues.attacker.length + issues.defender.length;
  const invalid = buildIssueCount > 0 || issues.field.length > 0;
  // Adjusted while rendering, like IntegerInput's text, so a new problem is never shown collapsed.
  const trackedSections = trackSectionIssues(sections, [
    { key: buildSectionKey(attackerKey), issues: issues.attacker },
    { key: buildSectionKey(defenderKey), issues: issues.defender },
    { key: fieldKey, issues: issues.field },
  ]);
  if (trackedSections !== sections) setSections(trackedSections);
  const resultsBlocked = engine.status !== "ready" || !!calculation?.error || invalid;
  // A transformed Imposter user lists its target's moves (imposter.ts).
  const sourceSpecies = speciesById.get(attackView.source.build.speciesId);
  const moveSpecies = speciesById.get(movesSpeciesId(attackView.source.build, attackView.receiver.build, matchup.field.magicRoom)) ?? sourceSpecies;
  const receiverSpecies = speciesById.get(attackView.receiver.build.speciesId);
  const currentBatch = calculation && sameMoveOwner(calculation.identity.source, attackView.owner) && sameMoveOwner(calculation.identity.receiver, attackView.receiverOwner);
  const rows = !resultsBlocked && currentBatch ? calculation.result?.results ?? [] : [];
  const settledHP = !resultsBlocked && currentBatch ? calculation.result?.settledHP : undefined;
  const selectedRow = rows.find((row) => row.moveId === attackView.moveId);
  // The rows start from the receiver's HP when the move starts (after a berry it ate before the move).
  const currentHP = (getSettledHealth(attackView.receiver.build, settledHP?.defender, runtime) ?? getBuildHealth(attackView.receiver.build, runtime))?.current ?? null;
  const replacement = matchup.replacement;
  const league = rosters.state.leagues.find((entry) => entry.id === rosters.state.selectedLeagueId);
  const currentTeams = rosters.state.teamsStatus === "ready" && rosters.state.data?.leagueId === league?.id ? rosters.state.data : null;
  const ownMember = currentTeams?.members.find((member) => member.id === league?.memberId);
  const opponent = currentTeams?.members.find((member) => member.id === rosters.state.opponentId);
  const usesLeague = matchup.teams.own.mode === "league" || matchup.teams.opponent.mode === "league";
  const onlyLeague = matchup.teams.own.mode === "league" && matchup.teams.opponent.mode === "league";
  const teamsLoading = usesLeague && (rosters.state.status === "loading" || rosters.state.teamsStatus === "loading");
  const teamsFailed = usesLeague && (rosters.state.status === "error" || rosters.state.teamsStatus === "error");
  const describeTeam = (role: RosterRole) => rosterPanels[role].teamName ?? (matchup.teams[role].mode === "paste" ? "Import a PokéPaste" : rosterPanels[role].message);
  const teamSummary = !onlyLeague ? `Your team: ${describeTeam("own")} · Opponent: ${describeTeam("opponent")}` : teamsLoading ? "Loading your leagues and teams…"
    : teamsFailed ? "Teams unavailable — retry or use manual Pokémon."
      : rosters.state.status === "signed-out" ? "Sign in to use league rosters."
        : league ? `${teamNameLabel(ownMember ? ownMember.team_name : league.teamName)} — ${league.name} · ${opponent ? `Facing ${teamNameLabel(opponent.team_name)}` : "Choose an opponent"}`
          : "Choose My team, or use manual Pokémon.";
  const results = { loading: engine.status === "loading", error: engine.status === "error" ? engine.message : calculation?.error || null, invalid };
  const blockedReason = previewBlockedReason(results);

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
    if (!retryLoad && !window.confirm(`Switch both Pokémon to ${BATTLE_PROFILES[game].label}? Builds, field edits, active mechanics and preparation caches will reset. Team documents, drafts and league selections will be kept.${doublesMounted ? " The 2v2 Pokémon reset too." : ""}`)) return;
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

  function changeMode(next: CalculatorMode) {
    pendingNavigation.current = null;
    setMode(next);
    if (next === "2v2") setDoublesMounted(true);
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
    return <RosterPicker pickerId={rosterControls[side]} variant={variant} panel={rosterPanels[slot.role]} role={slot.role} side={side} activeSource={slot.source} runtime={runtime} onSelect={(choice) => chooseRosterPokemon(slot.key, choice)} />;
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

  // The attacking Pokémon's team (league roster or import), offered first for Beat Up's party.
  const partyOptions = beatUpPartyOptions(rosterPanels[attackView.source.role].choices.flatMap((choice) => choice.speciesId ? [choice.speciesId] : []), runtime);

  /** The Build settings control that fixes a missing required move (e.g. Secret Sword). */
  function requiredMoveFix(slot: PreparedMatchup["attacker"]) {
    const required = runtime.speciesById.get(slot.build.speciesId)?.requiredMove;
    if (!required) return undefined;
    const name = (moveId: string) => runtime.movesById.get(moveId)?.name ?? moveId;
    return {
      name: name(required),
      slots: slot.moves.map((move) => move.moveId ? name(move.moveId) : "Empty"),
      onEquip: (slotIndex: number) => {
        setMatchup((current) => equipRequiredMove(current, slot.key, slotIndex));
        // The fix control unmounts once the move is prepared; continue from the updated quick move.
        const button = summaryRef.current?.querySelector<HTMLButtonElement>(`[data-move-owner="${slot.key}:${slot.moveEpoch}"][data-move-slot="${slotIndex}"]`);
        if (button) reveal(button, false);
      },
    };
  }

  function fixSettings() {
    const invalidControl = "[aria-invalid=true]:not(:disabled)";
    const firstControl = "select:not(:disabled), input:not(:disabled), summary, [tabindex]";
    const side = issues.attacker.length ? "attacker" : issues.defender.length ? "defender" : null;
    if (!side) {
      visitSection(fieldKey, () => {
        const panel = document.getElementById(fieldId);
        const element = panel?.querySelector<HTMLElement>(invalidControl) ?? panel?.querySelector<HTMLElement>(firstControl)
          ?? document.querySelector<HTMLElement>(`[aria-controls="${fieldId}"]`);
        if (element) reveal(element);
      });
      return;
    }
    const id = controls[side];
    visitSection(buildSectionKey(matchup[side].key), () => {
      const panel = document.getElementById(id);
      // The card above keeps a few controls of its own, such as the Tera type.
      const card = summaryRef.current?.querySelector<HTMLElement>(`[data-summary-combatant="${side}"]`);
      const element = panel?.querySelector<HTMLElement>(invalidControl) ?? card?.querySelector<HTMLElement>(invalidControl)
        ?? panel?.querySelector<HTMLElement>(firstControl) ?? document.querySelector<HTMLElement>(`[aria-controls="${id}"]`);
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

  function renderBuildEditor(side: BattleSide) {
    const slot = matchup[side];
    const other = matchup[side === "attacker" ? "defender" : "attacker"].build;
    return (
      <PokemonPanel
        runtime={runtime}
        gameType={matchup.field.gameType}
        roomItemChoice={roomItemChoice(slot.build, other, matchup.field)}
        fieldItemChoice={fieldItemChoice(slot.build, other, matchup.field, runtime)}
        magicRoom={matchup.field.magicRoom}
        requiredMove={requiredMoveFix(slot)}
        side={side}
        build={slot.build}
        issues={issues[side]}
        editorRevision={slot.editorRevision}
        onChange={(build) => updateBuild(slot.key, build)}
        onApplyIntimidate={() => updateCombatant(slot.key, (current, slotSide) => applyMatchupIntimidate(current, slotSide))}
        intimidateResult={intimidateResult(matchup, side)}
        hpInput={slot.hpInput}
        onHPChange={(text) => updateHP(slot.key, text)}
        roster={desktopRosters ? undefined : renderRoster(side, "inline")}
      />
    );
  }

  // Open state is keyed like the builds, so each Build settings follows its Pokémon on Swap.
  const builds: Record<BattleSide, BuildSettings> = {
    attacker: { id: controls.attacker, open: !!trackedSections.open[buildSectionKey(attackerKey)], onToggle: () => toggleSection(buildSectionKey(attackerKey)) },
    defender: { id: controls.defender, open: !!trackedSections.open[buildSectionKey(defenderKey)], onToggle: () => toggleSection(buildSectionKey(defenderKey)) },
  };

  const feedback = hasResultsFeedback(results) ? <ResultsFeedback {...results} champions={runtime.profile.id === "champions"} onRetry={retry} onFixSettings={fixSettings} /> : null;

  return (
    <div ref={rootRef} data-calculator-layout={desktopRosters ? "desktop" : "compact"} className={`${styles.root} space-y-5`}>
      <PageHeader
        eyebrow={`${runtime.profile.label} · ${runtime.profile.id === "champions" ? "Level 50" : "Native levels, EVs and IVs"}`}
        title="Damage Calculator"
        actions={
          <>
            {mode === "1v1" && <Button variant="secondary" onClick={() => { pendingNavigation.current = null; cancelGameLoad(); setMatchup(swapMatchup); }}><ArrowLeftRight className="h-4 w-4" aria-hidden="true" />Swap</Button>}
            <Button variant="secondary" onClick={() => {
              selectTab("moves");
              cancelGameLoad();
              if (mode === "1v1") setMatchup(resetMatchup);
              else setCalc(resetDoubles);
              setRollMode("average");
            }}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reset</Button>
          </>
        }
      />
      <CalculatorModeSwitch mode={mode} onChange={changeMode} />
      <section aria-label="Battle game rules" className="rounded-xl border border-line bg-panel p-4">
        <Field id={`${prefix}-game`} label="Battle game">
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
          <div className="mt-2 flex flex-wrap gap-2">
            {gameLoad.target && <Button size="sm" variant="secondary" onClick={(event) => {
              restoreGameSelectorFocus(event.currentTarget);
              chooseGame(gameLoad.target!, true);
            }}>Retry game rules</Button>}
            <Button size="sm" variant="secondary" onClick={() => {
              if (window.confirm("Reload the calculator? This clears this page’s imported teams, drafts, game selection and preparation.")) window.location.reload();
            }}>Reload calculator</Button>
          </div>
        </div>}
      </section>
      <CalculatorTabs prefix={prefix} activeTab={navigation.tab} onSelect={selectTab} />
      {mode === "1v1" ? <p key="1v1" role="status" className="sr-only">{matchup.notice}</p> : doubles.notice}
      <div data-calculator-workspace className={desktopRosters ? styles.withRosters : undefined} data-calculator-mode={mode}>
        <div data-calculator-center className={`${styles.center} space-y-5`}>
          <KeepWhileHidden active={mode === "1v1"} render={() => (
            <div ref={summaryRef} className={styles.summary} data-calculator-mode-only="1v1" hidden={mode !== "1v1"}>
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
                magicRoom={matchup.field.magicRoom}
                terrain={matchup.field.terrain}
                gameType={matchup.field.gameType}
                settledHP={settledHP}
              />
            </div>
          )} />
          <KeepWhileHidden active={mode === "1v1"} render={() => (
            <div data-calculator-settings className={`${styles.settings} overflow-hidden rounded-xl border border-line bg-panel`} data-calculator-mode-only="1v1" hidden={mode !== "1v1"}>
              <BuildSettingsSections runtime={runtime} attacker={matchup.attacker} defender={matchup.defender} issues={issues} builds={builds} renderEditor={renderBuildEditor} />
              <SettingsDisclosure
                kind="field"
                regionId={fieldId}
                open={!!trackedSections.open[fieldKey]}
                onToggle={() => toggleSection(fieldKey)}
                issueCount={issues.field.length}
                className={styles.fieldSection}
                label={<>
                  <span>Field conditions</span>
                  <span className="min-w-0 wrap-anywhere font-normal text-muted">{describeConditions(matchup.field)}</span>
                </>}
              >
                <BattleConditions runtime={runtime} names={{ attackerSide: speciesById.get(attacker.speciesId)?.name, defenderSide: speciesById.get(defender.speciesId)?.name }} value={matchup.field} issues={issues.field} onChange={(field) => setMatchup((current) => current.revision === matchup.revision ? { ...current, field } : current)} />
              </SettingsDisclosure>
            </div>
          )} />
          {doubles.summary}
          {doubles.settings}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <p role="status" className={`wrap-anywhere ${teamsFailed ? "text-danger" : ""}`}>{teamSummary}</p>
            {teamsFailed && <Button variant="secondary" size="sm" disabled={teamsLoading} onClick={rosters.refresh}>Retry teams</Button>}
          </div>
          {(mode === "1v1" ? feedback : doubles.feedback) && <div data-calculator-feedback>{mode === "1v1" ? feedback : doubles.feedback}</div>}
          <div>
            <div {...panelProps("team")}>
              {renderTeamSource("own")}
            </div>
            <div {...panelProps("moves")}>
              <KeepWhileHidden active={mode === "1v1"} render={() => (
                <div data-calculator-mode-only="1v1" hidden={mode !== "1v1"}>
                  <MoveResults
                    key={matchup.revision}
                    ref={movesRef}
                    runtime={runtime}
                    sourceBuild={attackView.source.build}
                    gameType={matchup.field.gameType}
                    id={controls.moves}
                    rows={rows}
                    moveIds={moveSpecies?.moves ?? []}
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
                    hitBattle={{ magicRoom: attackView.field.magicRoom, opponentAbilityId: attackView.receiver.build.abilityId }}
                    partyOptions={partyOptions}
                  />
                </div>
              )} />
              {doubles.moves}
              <details className="rounded-xl border border-line bg-panel">
                <summary className="cursor-pointer rounded-xl px-4 py-4 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:px-5">Coverage and sources</summary>
                <div className="space-y-4 px-4 pb-4 text-sm text-muted sm:px-5 sm:pb-5">
                  <p>Catalog snapshot: {catalog.coverage.species} Pokémon/forms and {catalog.coverage.moves} moves. {catalog.coverage.unsupportedSpecies} Pokémon/forms and {catalog.coverage.unsupportedMoves} moves have source or engine data gaps.</p>
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
            <div {...panelProps("opponent")}>
              {renderTeamSource("opponent")}
            </div>
          </div>
        </div>
        {desktopRosters && mode === "1v1" && (["attacker", "defender"] as const).map((side) => (
          <aside key={side} data-calculator-roster-rail={side} aria-label={`${side === "attacker" ? "Left Pokémon" : "Right Pokémon"} team shortcuts`} className={`${styles.rail} ${side === "attacker" ? styles.attackerRoster : styles.defenderRoster}`}>
            {renderRoster(side, "rail")}
          </aside>
        ))}
        {desktopRosters && mode === "2v2" && (["own", "opponent"] as const).map((side) => (
          <aside key={side} data-calculator-roster-rail={side} aria-label={`${side === "own" ? "Your" : "Opponent's"} team shortcuts`} className={`${styles.rail} ${side === "own" ? styles.attackerRoster : styles.defenderRoster}`}>
            {doubles.rails[side]}
          </aside>
        ))}
      </div>
    </div>
  );
}
