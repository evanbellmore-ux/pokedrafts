# Integration 1a (W1A-NU.md needsFromOthers to U1: DoublesCard.tsx): the card's "Switched in" choice beside No move. It sets
# doubles-inputs setDoublesSwitchedIn (No move, the action-bound states cleared, switchedIn in the turn input: the Pokémon
# switched in this turn and takes no action); choosing a move or No move ends it (doubles-prep chooseDoublesMove).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
C = "app/(app)/calculator/DoublesCard.tsx"
M = "app/(app)/calculator/DoublesSummary.tsx"
V = "app/(app)/calculator/useDoublesView.tsx"
CSS = "app/(app)/calculator/calculator.module.css"
apply([
 (C, '''  /** Its HP is 0: it fainted before the turn, so the card shows no move or target and the turn leaves it out. */
  fainted?: boolean;''', '''  /** Its HP is 0: it fainted before the turn, so the card shows no move or target and the turn leaves it out. */
  fainted?: boolean;
  /** status2: it switched in this turn (No move, doubles-inputs switchDoublesIn): the card's Switched in choice is on. */
  switchedIn?: boolean;''', "view: switchedIn"),
 (C, '''  onChooseMove: (owner: MoveOwner, moveId: string | null) => void;
  onShowMoves: (owner: MoveOwner) => void;''', '''  onChooseMove: (owner: MoveOwner, moveId: string | null) => void;
  /** status2: Switched in on or off for the Pokémon with this Combatant key (doubles-inputs setDoublesSwitchedIn); absent: no such choice. */
  onSwitchedIn?: (key: number, on: boolean) => void;
  onShowMoves: (owner: MoveOwner) => void;''', "handlers: onSwitchedIn"),
 (C, '''onActivateMove, onChooseMove, onShowMoves, onTargetChange }: Props) {
  const id = useId();
  const { id: slotId, slot, action, rule, hp, reached, issues, mimicry, rosterPanel, rosterDisabled, fainted = false, afterTurn = false } = view;''', '''onActivateMove, onChooseMove, onSwitchedIn, onShowMoves, onTargetChange }: Props) {
  const id = useId();
  const { id: slotId, slot, action, rule, hp, reached, issues, mimicry, rosterPanel, rosterDisabled, fainted = false, afterTurn = false, switchedIn = false } = view;''', "props"),
 (C, '''        <div className={`${styles.doublesQuickMoves} mt-1`}>
          <button type="button" data-doubles-no-move={slotId} aria-label={`${label}: no move`} aria-pressed={action.moveId === null} onClick={() => onChooseMove(owner, null)}
            className={`min-h-11 min-w-0 rounded-lg border px-1.5 font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${action.moveId === null ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}><span className="text-xs">No move</span></button>''', '''        <div className={`${styles.doublesQuickMoves} ${onSwitchedIn ? styles.doublesQuickMovesThree : ""} mt-1`}>
          <button type="button" data-doubles-no-move={slotId} aria-label={`${label}: no move`} aria-pressed={action.moveId === null && !switchedIn} onClick={() => onChooseMove(owner, null)}
            className={`min-h-11 min-w-0 rounded-lg border px-1.5 font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${action.moveId === null && !switchedIn ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}><span className="text-xs">No move</span></button>
          {onSwitchedIn && (
            <button type="button" data-doubles-switched-in={slotId} aria-label={`${label}: switched in this turn`} aria-pressed={switchedIn} onClick={() => onSwitchedIn(slot.key, !switchedIn)}
              className={`min-h-11 min-w-0 rounded-lg border px-1.5 font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${switchedIn ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}><span className="wrap-anywhere text-xs">Switched in</span></button>
          )}''', "the Switched in button"),
 (M, '''  const { onBuildChange, onHPChange, onRosterSelect, onToggleMega, onToggleMechanic, onActivateMove, onChooseMove, onShowMoves, onTargetChange } = props;''', '''  const { onBuildChange, onHPChange, onRosterSelect, onToggleMega, onToggleMechanic, onActivateMove, onChooseMove, onSwitchedIn, onShowMoves, onTargetChange } = props;''', "summary: destructure"),
 (M, '''    onChooseMove: (owner, moveId) => { aim(owner); onChooseMove(owner, moveId); },''', '''    onChooseMove: (owner, moveId) => { aim(owner); onChooseMove(owner, moveId); },
    ...(onSwitchedIn ? { onSwitchedIn } : {}),''', "summary: pass onSwitchedIn"),
 (V, '''        fainted: fainted[slot],
        issues: issues[slot],''', '''        fainted: fainted[slot],
        switchedIn: !!doubles.history[slot].switchedIn,
        issues: issues[slot],''', "view: switchedIn"),
 (V, '''          onChooseMove={(owner: MoveOwner, moveId: string | null) => update((state) => chooseDoublesMove(state, owner, moveId))}
          onShowMoves={showMoves}''', '''          onChooseMove={(owner: MoveOwner, moveId: string | null) => update((state) => chooseDoublesMove(state, owner, moveId))}
          onSwitchedIn={(key: number, on: boolean) => update((state) => setDoublesSwitchedIn(state, key, on))}
          onShowMoves={showMoves}''', "view: onSwitchedIn"),
 (CSS, '''.doublesQuickMoves {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem;
}''', '''.doublesQuickMoves {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem;
}

/* status2: No move, Switched in and All moves in one row. */
.doublesQuickMovesThree {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}''', "CSS: three quick choices"),
])
