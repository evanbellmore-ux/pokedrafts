"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { beatUpPartyOptions } from "@/app/lib/battle/count-moves";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { allyOf, DOUBLES_SLOTS, doublesNames, foesOf, relativePosition, SLOT_POSITION, slotSide, type DoublesSideId, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { movesSpeciesId } from "@/app/lib/battle/imposter";
import { mimicryState } from "@/app/lib/battle/mimicry";
import { fieldItemChoice, roomItemChoice, validateConditions } from "@/app/lib/battle/model";
import type { BattleBuild, BattleConditions, BattleMechanic } from "@/app/lib/battle/types";
import type { BuildSettings } from "./BuildSettings";
import type { CalculatorTab } from "./CalculatorTabs";
import type { DoublesCardView } from "./DoublesCard";
import DoublesMoves from "./DoublesMoves";
import DoublesSettings from "./DoublesSettings";
import DoublesSummary from "./DoublesSummary";
import {
  activateDoublesMoveSlot, applyDoublesIntimidate, chooseDoublesMove, dismissDoublesReplacement, doublesBuildIssues, doublesFainted, doublesIntimidateResult,
  doublesRosterDisabled, doublesTurnAction, equipDoublesRequiredMove, focusDoublesMoves, getDoublesTurnInput, intimidateFoes, replaceDoublesMove,
  selectDoublesRoster, setDoublesCharged, setDoublesField, setDoublesMovesInto, setDoublesTarget, toggleDoublesMechanic, toggleDoublesMega,
  updateDoublesBuild, updateDoublesHP, updateDoublesMoveContext, type CalculatorState, type DoublesMatchup,
} from "./doubles-prep";
import { cardReached, relativeName } from "./doubles-format";
import { getBuildHealth, getSettledHealth, type DamageRollMode } from "./hp-preview";
import KeepWhileHidden from "./KeepWhileHidden";
import { RosterPicker } from "./LeagueMatchupPicker";
import MoveResults, { type MoveResultsHandle } from "./MoveResults";
import PokemonPanel from "./PokemonPanel";
import ResultsFeedback, { hasResultsFeedback, previewBlockedReason } from "./results-feedback";
import { getMoveOwner, sameMoveOwner, type Combatant, type MoveOwner, type MoveReplacement, type RosterChoice, type RosterPanel, type RosterRole } from "./roster-prep";
import { buildSectionKey, fieldSectionKey, NO_SETTINGS_SECTIONS, setSectionOpen, trackSectionIssues } from "./settings-sections";
import { doublesIdentity, useDoublesCalculation, type DoublesEngine } from "./useDoublesCalculation";
import { errorMessage } from "./useMatchupCalculation";

type EngineState =
  | { status: "loading" }
  | { status: "ready"; engine: DoublesEngine }
  | { status: "error"; message: string };

/** CalculatorClient's navigation: a pending reveal runs once its tab, or the opened section, has rendered. */
export type DoublesNavigation = {
  /** Drops a pending reveal (a newer action replaces it). */
  cancelPending: () => void;
  visit: (tab: CalculatorTab, action: () => void) => void;
  /** Runs `action` after the next render, without changing tabs. */
  afterRender: (action: () => void) => void;
  reveal: (element: HTMLElement, includeSummary?: boolean) => void;
  selectTab: (tab: CalculatorTab) => void;
};

type Params = {
  prefix: string;
  calc: CalculatorState;
  setCalc: Dispatch<SetStateAction<CalculatorState>>;
  /** 2v2 is the view shown. */
  active: boolean;
  /** 2v2 has been shown: its tree renders and its engine loads. */
  mounted: boolean;
  rosterPanels: Record<RosterRole, RosterPanel>;
  desktopRosters: boolean;
  rollMode: DamageRollMode;
  onRollModeChange: (mode: DamageRollMode) => void;
  navigation: DoublesNavigation;
};

export type DoublesView = {
  summary: ReactNode;
  settings: ReactNode;
  moves: ReactNode;
  rails: Record<DoublesSideId, ReactNode>;
  notice: ReactNode;
  feedback: ReactNode;
  /** Restores focus to a 2v2 roster shortcut after the 1280px layout moves it (CalculatorClient's roster focus effect). */
  restoreRosterFocus: (slot: DoublesSlotId, choiceKey: string, canRestore: () => boolean) => void;
};

const NONE: Omit<DoublesView, "restoreRosterFocus"> = { summary: null, settings: null, moves: null, rails: { own: null, opponent: null }, notice: null, feedback: null };

const perSlot = <T,>(value: (slot: DoublesSlotId) => T) => Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, value(slot)])) as Record<DoublesSlotId, T>;

/**
 * The foe straight across (data/abilities.ts imposter: foe.active[length - 1 - position]): your left faces the opponent's
 * left. When that one has fainted, the other foe if it has not.
 */
function acrossFrom(slot: DoublesSlotId, fainted: Record<DoublesSlotId, boolean>): DoublesSlotId {
  const [left, right] = foesOf(slot);
  const [across, other] = slot.endsWith("left") ? [left, right] : [right, left];
  return fainted[across] && !fainted[other] ? other : across;
}

function slotOf(doubles: DoublesMatchup, owner: MoveOwner): DoublesSlotId | null {
  return DOUBLES_SLOTS.find((slot) => sameMoveOwner(getMoveOwner(doubles.slots[slot]), owner)) ?? null;
}

function findChoice(picker: HTMLElement | null, choiceKey: string, slot?: DoublesSlotId) {
  const buttons = picker ? [...picker.querySelectorAll<HTMLButtonElement>("[data-roster-choice]:not(:disabled)")].filter((button) => !slot || button.dataset.rosterSlot === slot) : [];
  return buttons.find((button) => button.dataset.rosterChoice === choiceKey) ?? buttons.find((button) => button.getAttribute("aria-pressed") === "true") ?? buttons[0];
}

/**
 * Every 2v2 handler and the 2v2 parts of the page: the summary (four cards and the turn), the four Build settings and
 * Field conditions, the Moves pane, the desktop rails, the notice and the loading / error / Fix settings feedback.
 * CalculatorClient places them; nothing renders before 2v2 is first shown, and the doubles engine
 * (app/lib/battle/doubles-turn.ts) loads then.
 */
export function useDoublesView({ prefix, calc, setCalc, active, mounted, rosterPanels, desktopRosters, rollMode, onRollModeChange, navigation }: Params): DoublesView {
  const { doubles } = calc;
  const { runtime, field } = doubles;
  const { cancelPending, visit, afterRender, reveal, selectTab } = navigation;
  const summaryRef = useRef<HTMLDivElement>(null);
  const movesRef = useRef<MoveResultsHandle>(null);
  const [engineState, setEngineState] = useState<EngineState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [sections, setSections] = useState(NO_SETTINGS_SECTIONS);
  const ids = {
    moves: `${prefix}-2v2-moves`,
    field: `${prefix}-2v2-field`,
    build: (key: number) => `${prefix}-2v2-build-${key}`,
    roster: (key: number) => `${prefix}-2v2-roster-${key}`,
    rail: (side: DoublesSideId) => `${prefix}-2v2-rail-${side}`,
  };
  const fieldKey = fieldSectionKey(doubles.revision);
  const slotKeys = DOUBLES_SLOTS.map((slot) => doubles.slots[slot].key).join(",");

  useEffect(() => {
    if (!mounted) return;
    let current = true;
    import("@/app/lib/battle/doubles-turn").then(
      (engine) => { if (current) setEngineState({ status: "ready", engine }); },
      (error: unknown) => { if (current) setEngineState({ status: "error", message: errorMessage(error) }); },
    );
    return () => { current = false; };
  }, [mounted, attempt]);

  const engine = engineState.status === "ready" ? engineState.engine : null;
  const calculation = useDoublesCalculation(engine, doubles, active);

  const visitSection = useCallback((key: string, action: () => void) => {
    setSections((current) => setSectionOpen(current, key, true));
    afterRender(action);
  }, [afterRender, setSections]);

  const restoreRosterFocus = useCallback((slot: DoublesSlotId, choiceKey: string, canRestore: () => boolean) => {
    if (desktopRosters) {
      cancelPending();
      const target = findChoice(document.getElementById(`${prefix}-2v2-rail-${slotSide(slot)}`), choiceKey, slot);
      if (target && canRestore()) reveal(target, false);
      return;
    }
    // Compact layouts keep the roster in that Pokémon's Build settings, which opens first.
    const key = Number(slotKeys.split(",")[DOUBLES_SLOTS.indexOf(slot)]);
    visitSection(buildSectionKey(key), () => {
      const target = findChoice(document.getElementById(`${prefix}-2v2-roster-${key}`), choiceKey);
      if (target && canRestore()) reveal(target);
    });
  }, [cancelPending, desktopRosters, prefix, reveal, slotKeys, visitSection]);

  const input = useMemo(() => getDoublesTurnInput(doubles), [doubles]);
  // Nothing is validated before 2v2 is first shown, so 1v1 does no extra work. HP 0 is a fainted Pokémon here, not an issue.
  const issues = useMemo(() => perSlot((slot) => mounted ? doublesBuildIssues(doubles.slots[slot].build, runtime) : []), [mounted, doubles.slots, runtime]);
  const fieldIssues = useMemo(() => mounted ? validateConditions(field, runtime) : [], [mounted, field, runtime]);
  // Adjusted while rendering, like 1v1's, so a new problem is never shown collapsed.
  const tracked = mounted ? trackSectionIssues(sections, [
    ...DOUBLES_SLOTS.map((slot) => ({ key: buildSectionKey(doubles.slots[slot].key), issues: issues[slot] })),
    { key: fieldKey, issues: fieldIssues },
  ]) : sections;
  if (tracked !== sections) setSections(tracked);

  if (!mounted) return { ...NONE, restoreRosterFocus };

  const update = (transition: (state: CalculatorState) => CalculatorState) => {
    cancelPending();
    setCalc(transition);
  };
  const names = doublesNames(doubles.slots, runtime);
  const fainted = doublesFainted(doubles.slots);
  const speciesName = (slot: DoublesSlotId) => runtime.speciesById.get(doubles.slots[slot].build.speciesId)?.name ?? "Pokémon";
  // The Pokémon the 1v1 helpers read as "the other" (room and field items, Mimicry, Imposter's moves): the engine's
  // representative, else (before it loads, or when two act on the slot) the foe across. Read only by the regions that
  // render (KeepWhileHidden), so a hidden 2v2 asks the engine nothing.
  const otherBuild = (slot: DoublesSlotId): BattleBuild => {
    let other: DoublesSlotId | null = null;
    try {
      other = engine?.doublesRepresentative(input, slot) ?? null;
    } catch {
      other = null;
    }
    return doubles.slots[other ?? acrossFrom(slot, fainted)].build;
  };

  const invalid = DOUBLES_SLOTS.some((slot) => issues[slot].length > 0) || fieldIssues.length > 0;
  const error = (engineState.status === "error" ? engineState.message : calculation?.turnError ?? calculation?.movesError ?? null) || null;
  // 1v1's wording for the same states (results-feedback.tsx).
  const results = { loading: engineState.status === "loading", error, invalid };
  const blockedReason = previewBlockedReason(results);
  const current = !blockedReason && calculation?.identity === doublesIdentity(doubles) ? calculation : null;
  const turn = current?.turn ?? null;

  function retry() {
    setEngineState({ status: "loading" });
    setAttempt((value) => value + 1);
  }

  function fixSettings() {
    const invalidControl = "[aria-invalid=true]:not(:disabled)";
    const firstControl = "select:not(:disabled), input:not(:disabled), summary, [tabindex]";
    const slot = DOUBLES_SLOTS.find((entry) => issues[entry].length > 0);
    if (!slot) {
      visitSection(fieldKey, () => {
        const panel = document.getElementById(ids.field);
        const element = panel?.querySelector<HTMLElement>(invalidControl) ?? panel?.querySelector<HTMLElement>(firstControl)
          ?? document.querySelector<HTMLElement>(`[aria-controls="${ids.field}"]`);
        if (element) reveal(element);
      });
      return;
    }
    const id = ids.build(doubles.slots[slot].key);
    visitSection(buildSectionKey(doubles.slots[slot].key), () => {
      const panel = document.getElementById(id);
      // The card keeps a few controls of its own, such as the Tera type.
      const card = summaryRef.current?.querySelector<HTMLElement>(`[data-doubles-slot="${slot}"]`);
      const element = panel?.querySelector<HTMLElement>(invalidControl) ?? card?.querySelector<HTMLElement>(invalidControl)
        ?? panel?.querySelector<HTMLElement>(firstControl) ?? document.querySelector<HTMLElement>(`[aria-controls="${id}"]`);
      if (element) reveal(element);
    });
  }

  /** Focus returns to the slot's quick move once it has rendered (a replaced or equipped move). */
  function revealQuickMove(owner: MoveOwner, slotIndex: number, session?: number) {
    const selector = `[data-move-owner="${owner.key}:${owner.epoch}"][data-move-slot="${slotIndex}"]${session === undefined ? "" : `[data-move-session="${session}"]`}`;
    const button = summaryRef.current?.querySelector<HTMLButtonElement>(selector);
    if (button) reveal(button, false);
  }

  function updateReplacement(replacement: MoveReplacement, moveId?: string) {
    update((state) => moveId === undefined ? dismissDoublesReplacement(state, replacement) : replaceDoublesMove(state, replacement, moveId));
    revealQuickMove(replacement.owner, replacement.slotIndex, replacement.session);
  }

  function showStep(owner: MoveOwner, moveId: string) {
    const slot = slotOf(doubles, owner);
    if (!slot) return;
    const { replacement } = doubles;
    setCalc((state) => {
      const focused = focusDoublesMoves(state, slot);
      return replacement ? dismissDoublesReplacement(focused, replacement) : focused;
    });
    visit("moves", () => movesRef.current?.showMove(moveId, `${owner.key}:${owner.epoch}`));
  }

  function showMoves(owner: MoveOwner) {
    const slot = slotOf(doubles, owner);
    if (!slot) return;
    setCalc((state) => focusDoublesMoves(state, slot));
    visit("moves", () => {
      const list = document.getElementById(ids.moves);
      const control = list?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), button:not(:disabled)");
      if (control) reveal(control);
    });
  }

  /** The Build settings control that fixes a missing required move (e.g. Secret Sword). */
  function requiredMoveFix(slot: Combatant) {
    const required = runtime.speciesById.get(slot.build.speciesId)?.requiredMove;
    if (!required) return undefined;
    const name = (moveId: string) => runtime.movesById.get(moveId)?.name ?? moveId;
    return {
      name: name(required),
      slots: slot.moves.map((move) => move.moveId ? name(move.moveId) : "Empty"),
      onEquip: (slotIndex: number) => {
        update((state) => equipDoublesRequiredMove(state, slot.key, slotIndex));
        revealQuickMove(getMoveOwner(slot), slotIndex);
      },
    };
  }

  /** Plus and Minus read the ally's ability in 2v2, so the editor states it instead of asking (a fainted ally counts for nothing). */
  function plusMinusFact(slot: DoublesSlotId): string | null | undefined {
    const ability = doubles.slots[slot].build.abilityId;
    if (ability !== "plus" && ability !== "minus") return undefined;
    const ally = allyOf(slot);
    if (fainted[ally]) return `Ally ${names[ally]} has fainted.`;
    const allyAbility = doubles.slots[ally].build.abilityId;
    return allyAbility === "plus" || allyAbility === "minus"
      ? `Ally ${names[ally]} has ${runtime.abilitiesById.get(allyAbility)?.name ?? allyAbility}.` : "Its ally has no Plus or Minus.";
  }

  function renderRoster(slot: DoublesSlotId) {
    const combatant = doubles.slots[slot];
    const position = SLOT_POSITION[slot];
    return (
      <RosterPicker pickerId={ids.roster(combatant.key)} variant="inline" panel={rosterPanels[combatant.role]} role={combatant.role} side={slot}
        activeSource={combatant.source} runtime={runtime} position={position} label={`${position.charAt(0).toUpperCase()}${position.slice(1)} Pokémon`}
        isDisabled={(choice) => doublesRosterDisabled(doubles, slot, choice)}
        onSelect={(choice) => update((state) => selectDoublesRoster(state, combatant.key, choice))} />
    );
  }

  /** "Apply Intimidate to both foes", or to the one foe left; none from a fainted Pokémon or with both foes fainted. */
  function intimidateLabel(slot: DoublesSlotId): string | null {
    const foes = intimidateFoes(doubles, slot);
    return foes.length === 2 ? "Apply Intimidate to both foes" : foes.length === 1 ? `Apply Intimidate to ${relativeName(names, slot, foes[0])}` : null;
  }

  function renderEditor(slot: DoublesSlotId) {
    const combatant = doubles.slots[slot];
    const other = otherBuild(slot);
    const intimidate = intimidateLabel(slot);
    return (
      <PokemonPanel
        runtime={runtime}
        gameType="Doubles"
        roomItemChoice={roomItemChoice(combatant.build, other, field)}
        fieldItemChoice={fieldItemChoice(combatant.build, other, field, runtime)}
        magicRoom={field.magicRoom}
        requiredMove={requiredMoveFix(combatant)}
        side={slotSide(slot) === "own" ? "attacker" : "defender"}
        position={SLOT_POSITION[slot]}
        build={combatant.build}
        issues={issues[slot]}
        editorRevision={combatant.editorRevision}
        onChange={(build) => update((state) => updateDoublesBuild(state, combatant.key, build))}
        onApplyIntimidate={intimidate ? () => update((state) => applyDoublesIntimidate(state, combatant.key)) : undefined}
        intimidateLabel={intimidate ?? undefined}
        intimidateResult={doublesIntimidateResult(doubles, slot)}
        abilityActivationFact={plusMinusFact(slot)}
        tracedUnsetLabel="Not chosen"
        hpInput={combatant.hpInput}
        onHPChange={(text) => update((state) => updateDoublesHP(state, combatant.key, text))}
        allowFainted
        roster={desktopRosters ? undefined : renderRoster(slot)}
      />
    );
  }

  function summaryCards() {
    const ready = turn?.status === "ready" ? turn : null;
    return perSlot((slot): DoublesCardView => {
      const combatant = doubles.slots[slot];
      // The action the turn uses: none for a fainted Pokémon (its own is kept for when its HP comes back).
      const action = doublesTurnAction(input, slot);
      return {
        id: slot, slot: combatant, action,
        rule: action.moveId ? doublesTargetRule(input, slot, action.moveId) : null,
        hp: fainted[slot] ? null : ready?.hp[slot] ?? null,
        reached: !fainted[slot] && cardReached(ready, slot),
        fainted: fainted[slot],
        issues: issues[slot],
        mimicry: mimicryState(combatant.build, otherBuild(slot), { terrain: field.terrain, magicRoom: field.magicRoom }),
        rosterPanel: rosterPanels[combatant.role],
        rosterDisabled: (choice: RosterChoice) => doublesRosterDisabled(doubles, slot, choice),
      };
    });
  }

  function renderSummary() {
    return (
      <div ref={summaryRef} data-calculator-mode-only="2v2" hidden={!active}>
        <DoublesSummary
          runtime={runtime}
          cards={summaryCards()}
          names={names}
          turn={turn}
          blockedReason={blockedReason}
          rollMode={rollMode}
          onRollModeChange={onRollModeChange}
          replacement={doubles.replacement}
          movesControl={ids.moves}
          magicRoom={field.magicRoom}
          terrain={field.terrain}
          onBuildChange={(key: number, build: BattleBuild) => update((state) => updateDoublesBuild(state, key, build))}
          onHPChange={(key: number, text: string) => update((state) => updateDoublesHP(state, key, text))}
          onRosterSelect={(key: number, choice: RosterChoice) => update((state) => selectDoublesRoster(state, key, choice))}
          onToggleMega={(owner: MoveOwner, formId: string) => update((state) => toggleDoublesMega(state, owner, formId))}
          onToggleMechanic={(owner: MoveOwner, mechanic: BattleMechanic) => update((state) => toggleDoublesMechanic(state, owner, mechanic))}
          onActivateMove={(owner: MoveOwner, slotIndex: number) => {
            update((state) => activateDoublesMoveSlot(state, owner, slotIndex));
            selectTab("moves");
          }}
          onChooseMove={(owner: MoveOwner, moveId: string | null) => update((state) => chooseDoublesMove(state, owner, moveId))}
          onShowMoves={showMoves}
          onTargetChange={(owner: MoveOwner, target: DoublesSlotId) => update((state) => setDoublesTarget(state, owner, target))}
          onShowStep={showStep}
          onFixSettings={fixSettings}
        />
      </div>
    );
  }

  function renderSettings() {
    const builds = perSlot((slot): BuildSettings => {
      const key = buildSectionKey(doubles.slots[slot].key);
      return { id: ids.build(doubles.slots[slot].key), open: !!tracked.open[key], onToggle: () => setSections((value) => setSectionOpen(value, key, !value.open[key])) };
    });
    return (
      <div data-calculator-mode-only="2v2" hidden={!active}>
        <DoublesSettings
          runtime={runtime}
          names={names}
          slots={doubles.slots}
          issues={issues}
          fieldIssues={fieldIssues}
          builds={builds}
          field={{ id: ids.field, open: !!tracked.open[fieldKey], onToggle: () => setSections((value) => setSectionOpen(value, fieldKey, !value.open[fieldKey])) }}
          renderEditor={renderEditor}
          conditions={field}
          onConditionsChange={(next: BattleConditions) => setCalc((state) => setDoublesField(state, doubles.revision, next))}
          charged={doubles.charged}
          onChargedChange={(slot: DoublesSlotId, charged: boolean) => setCalc((state) => setDoublesCharged(state, doubles.slots[slot].key, charged))}
        />
      </div>
    );
  }

  // The Moves pane: the slot's whole learnset into the chosen Pokémon, at the start of the turn.
  function renderMoves() {
    const paneSlot = doubles.moves.slot;
    const into = doubles.moves.into;
    const source = doubles.slots[paneSlot];
    const sourceOwner = getMoveOwner(source);
    const receiver = doubles.slots[into];
    const moveSpecies = runtime.speciesById.get(movesSpeciesId(source.build, otherBuild(paneSlot), field.magicRoom)) ?? runtime.speciesById.get(source.build.speciesId);
    const rows = current?.moves?.results ?? [];
    const settled = current?.moves?.settledHP?.defender;
    const receiverHP = (getSettledHealth(receiver.build, settled, runtime) ?? getBuildHealth(receiver.build, runtime))?.current ?? null;
    const replacement = doubles.replacement && sameMoveOwner(doubles.replacement.owner, sourceOwner) ? doubles.replacement : null;
    const partyOptions = beatUpPartyOptions(rosterPanels[source.role].choices.flatMap((choice) => choice.speciesId ? [choice.speciesId] : []), runtime);
    return (
      <div data-calculator-mode-only="2v2" hidden={!active}>
        <DoublesMoves
          names={names}
          focus={paneSlot}
          into={into}
          fainted={fainted}
          onFocusChange={(slot: DoublesSlotId) => update((state) => focusDoublesMoves(state, slot))}
          onIntoChange={(next: DoublesSlotId) => update((state) => setDoublesMovesInto(state, next))}
        >
          <MoveResults
            key={doubles.revision}
            ref={movesRef}
            runtime={runtime}
            sourceBuild={source.build}
            gameType="Doubles"
            id={ids.moves}
            rows={rows}
            moveIds={moveSpecies?.moves ?? []}
            ownerId={`${sourceOwner.key}:${sourceOwner.epoch}`}
            selectedMoveId={doubles.actions[paneSlot].moveId}
            onSelectMove={(moveId) => update((state) => chooseDoublesMove(state, sourceOwner, moveId))}
            contexts={source.contexts}
            onContextChange={(moveId, context) => update((state) => updateDoublesMoveContext(state, sourceOwner, moveId, context))}
            replacement={replacement ? {
              slotIndex: replacement.slotIndex,
              moves: source.moves,
              onReplace: (moveId) => updateReplacement(replacement, moveId),
              onDone: () => updateReplacement(replacement),
            } : undefined}
            abilityId={source.build.abilityId}
            itemId={source.build.itemId}
            attackerName={speciesName(paneSlot)}
            defenderName={speciesName(into)}
            positions={{ source: SLOT_POSITION[paneSlot], receiver: relativePosition(paneSlot, into).replace("-", " ") }}
            heading="Moves"
            turnOrderFromTurn
            defenderHP={receiverHP}
            blocked={!!blockedReason}
            onReveal={reveal}
            hitBattle={{ magicRoom: field.magicRoom, opponentAbilityId: receiver.build.abilityId }}
            partyOptions={partyOptions}
            faintedAtLeast={DOUBLES_SLOTS.filter((slot) => fainted[slot] && slotSide(slot) === slotSide(paneSlot)).length}
          />
        </DoublesMoves>
      </div>
    );
  }

  const rail = (side: DoublesSideId) => {
    const slots = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side);
    return (
      <RosterPicker pickerId={ids.rail(side)} variant="rail" panel={rosterPanels[side]} role={side} side={side} activeSource={null} runtime={runtime}
        onSelect={() => undefined}
        slots={slots.map((slot) => ({
          id: slot, position: SLOT_POSITION[slot], activeSource: doubles.slots[slot].source,
          onSelect: (choice: RosterChoice) => update((state) => selectDoublesRoster(state, doubles.slots[slot].key, choice)),
        }))} />
    );
  };

  return {
    restoreRosterFocus,
    notice: <p key="2v2" role="status" className="sr-only">{doubles.notice}</p>,
    feedback: hasResultsFeedback(results) ? <ResultsFeedback {...results} champions={runtime.profile.id === "champions"} onRetry={retry} onFixSettings={fixSettings} /> : null,
    rails: { own: rail("own"), opponent: rail("opponent") },
    // Hidden by 1v1, each region keeps its last render: 1v1 updates neither re-render nor recalculate it.
    summary: <KeepWhileHidden active={active} render={renderSummary} />,
    settings: <KeepWhileHidden active={active} render={renderSettings} />,
    moves: <KeepWhileHidden active={active} render={renderMoves} />,
  };
}
