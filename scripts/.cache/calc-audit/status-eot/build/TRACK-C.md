# Track C: 2v2 UI for status moves and end of turn

Branch `calc-2v2-status-eot`. This covers SPEC §5 and ADDENDUM §5. Only 2v2 changes; 1v1 is unchanged.

Files edited (all Track C's):
- `app/(app)/calculator/doubles-format.ts`
- `app/(app)/calculator/DoublesCard.tsx`
- `app/(app)/calculator/DoublesTurn.tsx`
- `app/(app)/calculator/BattleConditions.tsx` (its 2v2 section)
- `app/(app)/calculator/doubles-prep.ts`
- `app/(app)/calculator/useDoublesView.tsx`
- `tests/unit/calculator-doubles-ui.test.ts`

`calculator.module.css` did not need a change. Nothing in the frozen files was touched, and nothing was committed.

## What was built

### `doubles-format.ts`
- `turnHP(turn)` picks the HP to show. It is `endOfTurn.hp` (`afterTurn: true`) when the end of turn is ready, otherwise `hp` (after the moves). The cards and the live summary both use it.
- `cardHPLabel(projected, mode, mechanic, afterTurn = false)` gives `After the turn · {roll}` or `After the moves · {roll}`.
- `turnSummary` (the live region) reads `turnHP`. When the end of turn is not estimated, it adds the sentence `End of turn not estimated: {reason}`.
- `cardReached` also counts a residual that takes HP from the Pokémon, and a KO chance in `endOfTurn.hp`. The card then shows the KO chance.
- `hpChangeText(min, max)` formats HP changes with U+2212 for minus:
  - `+163`, `−87`
  - `+12–20`
  - `−11–22` (a loss of 11 to 22)
  - `−30 to +40` (Pain Split, either way)
- `hitLine(hit, names, chosen, status)`:
  - kind `effect`: `{Name}`, plus `: +77 HP` from `change` when there is one, plus ` · reaches it 50%`;
  - a status move's `blocked` or `no-damage` hit: `{Name}: no effect` (the category comes from the runtime);
  - kind `substitute`: `substituteLine`.
- `substituteLine(hit)`: `{Name}'s Substitute: −26–31 HP`, then `, breaks 25%`, then ` · reaches it 87.5%`. The reach uses `substitute.chance`. A `calculated` hit that also met a Substitute shows this line first, then the damage line.
- `residualLine(r)`: `{effect} · {Name}: −13 HP (from {Other}) (50%), KO chance 6.25%`. Without an HP change it is `{effect} · {Name} (from …) (…)`. See deviation 1.
- `conditionsLine(conditions)` builds the card's line, for example `Paralysed · Confused (67%) · Substitute: 15–19 HP (50%)`:
  - each fact loses its full stop and gains its chance when below 1;
  - facts that differ only by an HP value (`Substitute: 15 HP.`, `Substitute: 19 HP.`) merge into one range, with their summed chance. See needsFromOthers for Track E.
- `endNotEstimatedText(reason)`.

### `DoublesCard.tsx`
- `DoublesCardView.afterTurn?` is new, and optional, so the shared fixture still types.
- The label reads `After the turn` or `After the moves`, and the meter's `aria-valuetext` says `… HP after the turn` or `… after the moves`.
- Under the HP bar sits one muted line, `<p data-doubles-conditions={slot} class="… wrap-anywhere …">`, built from `hp.conditions`. The card shows the record its HP comes from: the after-the-turn conditions when the end of turn is ready.

### `DoublesTurn.tsx`
The panel shows, in order:
1. The steps as today. Status-move hits use the lines above, the Substitute's line comes before a calculated hit's line (`data-doubles-substitute-hit`), and skip and step facts render as today.
2. The `DoublesHP.losses` lines (`<li data-doubles-loss={slot}>`, `factLine`).
3. The end of turn:
   - When ready, with residuals or facts: `<div data-doubles-end>` holds `<h4>End of turn</h4>`, then `<ul aria-labelledby>` with one `<li data-doubles-residual={slot}>` per residual and its facts muted below it, then `endOfTurn.facts` (`aria-label="End-of-turn facts"`).
   - When not estimated: `<p data-doubles-end-not-estimated>End of turn not estimated: {reason}</p>`.
   - When ready with no residuals and no facts: nothing.
4. The turn facts, last as today.

### `BattleConditions.tsx` (2v2 only)
- **`CarriedControl`** is a new type, with `slot`, `side`, `name`, `options`, `value`, `issues` and `onChange`. Controls come from the new `carried` prop, or else from the new `DoublesCarriedContext` (`useDoublesCarried()`). The 1v1 variant never shows them.
- **One block per Pokémon** in its side's fieldset: `role="group"` named by the Pokémon's name, `data-doubles-carried={slot}`. It holds:
  - checkboxes:
    - its **Charge**, moved into the block;
    - **Confused** (`data-doubles-confused`);
    - **Rest sleep** (`data-doubles-rest`), when Asleep;
    - **Substitute** (`data-doubles-substitute`), when floor(maxHP/4) ≥ 1;
  - compact `Field`+`Select` counts, each shown only when it applies:
    - **Turns lost to sleep** (Asleep): 0 to the most that build allows (SV 0–3; Champions or Rest 0–2; Early Bird 0–1);
    - **Turns lost to freeze** (Champions, Frozen): 0–2;
    - **Confusion turns so far** (ticked): 0–4;
    - **Bad poison turns so far** (Badly poisoned): 0–15;
  - **Substitute HP** (`NumberInput`, ticked): 1 to floor(maxHP/4), defaulting to floor(maxHP/4).
- **Accessible names.** Visible labels are short ("Confused"). An sr-only `: {Name}` makes each accessible name unique, for example "Confused: Garchomp".
- **Input issues.** The turn's issues on `carried.*` show as the control's error, `{Name}: {message}`, with `aria-invalid` set. "Fix settings" (`fixSettings`) finds that control through `[aria-invalid=true]`.
- **Toggle count.** `describeDoublesConditions(value, charged, carried = [])` also counts Confused, Rest sleep and Substitute when they are ticked.
- **Width.** Every new element is `min-w-0` / `wrap-anywhere`. The grids are `grid-cols-2` (minmax 0) or `.fields`, and the controls are `w-full`, so there is no horizontal overflow at 375 px.

### `doubles-prep.ts`
- `DoublesMatchup.carried: Record<slot, DoublesCarried>` starts as `{}`.
- `carriedOptions(build, runtime, rest)` lists the controls a build can use, and `sleepTurnsMax` gives the sleep bound (the same rule as `carriedIssues`). `NO_CARRIED_OPTIONS` hides every control for a fainted Pokémon; its state is kept.
- `reconcileCarried(carried, build, runtime)`:
  - drops what no longer applies (the sleep, freeze or bad-poison count after a status change, freeze outside Champions);
  - bounds each count (Early Bird or Rest lowers the sleep bound);
  - drops a count at 0, which leaves the turn's assumption;
  - clamps the Substitute to floor(maxHP/4), and keeps it while the build's stats are invalid mid-edit;
  - returns the same object when nothing changes.
- `onSlot` resets `carried` for another Pokémon, as `charged` is reset, and otherwise reconciles it on every build change.
- `setDoublesCarried(state, key, carried)` is new.
- `doublesSlotInput(combatant, charged, action, carried)` builds a slot's turn input. It adds `carried` only when non-empty, and `moves` only for an Imprison user (the quick moves plus the chosen move). It never sets `lastMove`. `getDoublesTurnInput` uses it.
- `carriedIssueTexts(issues, name)` maps `carried.*` issues to the controls.

### `useDoublesView.tsx`
- The cards take `turnHP(ready)` and `afterTurn`.
- `carriedControls()` builds the four controls. It wraps `<DoublesSettings>` in `<DoublesCarriedContext.Provider>`, because DoublesSettings is not Track C's file and renders BattleConditions.

## Tests

`tests/unit/calculator-doubles-ui.test.ts`: **53 passed** (it had 26).
- Two existing assertions on the live summary now include the end-of-turn sentence. They derive it from the fixture's `endOfTurn` (`fixtureEnd()`), so they keep passing when the integrator changes `tests/fixtures/doubles-turn.ts`.
- New fixtures in the file cover a sand turn with:
  - Thunder Wave (`effect`);
  - Heat Wave into a carried Substitute (`substitute`) and into Pikachu;
  - Leech Seed (`effect`);
  - a confusion loss;
  - six residuals (sand ×3, Leech Seed both ways, Toxic Orb);
  - after-the-turn HP and conditions;
  - plus not-estimated and empty variants.
- New tests cover:
  - every new text function (minus sign, HP ranges, residual lines, the merged conditions line, the hit kinds);
  - the card labels and screen-reader text, after the turn and after the moves;
  - the conditions line under the bar;
  - the panel order (steps → losses → End of turn → turn facts) and the not-estimated line;
  - no section without residuals;
  - the two-line hit into a Substitute;
  - facts only and names, not positions;
  - `wrap-anywhere` on every new line;
  - the Field-condition controls: grouping, accessible names, the bounds per game, status and ability (Champions and SV), every callback's carried value, a fainted Pokémon, the Substitute HP bounds, the issue fact with `aria-invalid`, the toggle count, and prop vs context;
  - the prep state: bounds, reconciling on status, ability and Rest changes, the reset for another Pokémon, the Substitute clamp and the mid-edit keep, the Imprison `moves`, and the engine's real `carried.sleep` issue mapped to its control (Step 0's frozen `validate`).

Other runs:
- `npx vitest run tests/unit/calculator-`: 90 files, **1965 passed**.
- `tsc --noEmit`: clean. `eslint app/(app)/calculator tests/unit/calculator-doubles-ui.test.ts`: clean.
- **Patches verified.** The calculator-doubles tests (6 files) plus two checks ran against both integrator patches below, through a scratch vitest config that aliases the patched files: **119 passed**. The checks:
  - the patched hook passes `carried`, and its input equals `getDoublesTurnInput`;
  - the patched DoublesSettings counts the toggles.
- **Server-render check.** A scratch vitest test ran the real current engine (Track B's end of turn already lands) through `DoublesSummary`. For sand + Leftovers + Heat Wave it rendered "After the turn · Average estimate" on all four cards, then an End of turn list (`Sandstorm · Charizard: −9 HP` … `Leftovers · Venusaur: +9 HP`), then "Assumes the Sandstorm does not end this turn.". Thunder Wave is still Track A's "not modelled" guard, and rendered as such.
- **Seen in passing (not Track C's).** `doubles-turn-mechanics.test.ts` (2 tests) and `doubles-outcomes.test.ts` (1 test) fail on Track B's work in progress. They still expect "End-of-turn effects are not applied.".

No live browser check, as instructed.

## Deviations

1. **`residualLine` order.** SPEC lists the pieces as HP, `, KO chance`, ` (from …)`, ` (50%)`. I write HP, `(from …)`, `(share)`, then `, KO chance` (`Leech Seed · Pikachu: −13 HP (from Venusaur) (50%), KO chance 6.25%`). This keeps the bracketed share on the HP change rather than on the KO chance, and keeps "from" next to the HP it describes.
2. **`moves` only for an Imprison user.** SPEC §5 says `useDoublesView` passes the quick moves plus the chosen move.
   - Imprison is the only reader (§4.2), so passing them only for an Imprison user gives the same results.
   - It also keeps every other input identical, which two existing tests not owned by Track C rely on: `calculator-doubles-prep.test.ts:601` (an exact `toEqual`) and `calculator-doubles-shell.test.ts:234`.
3. **The Q1 controls are bounded per build**, not a fixed 0–3. Champions and Rest allow 0–2, Early Bird 0–1, matching `carriedIssues`. A stale value is clamped when the build changes, so the engine's issue should not arise from the UI. If it does, it shows on the control.
4. **Charge moved into each Pokémon's block.** It reads "Charge", with the sr-only ": {Name}". A Charge toggle without carried controls still renders as before, "Charge: {Name}".
5. **The End of turn section also shows when it has facts but no residuals.** SPEC says no section without residuals; this way no end-of-turn fact is ever dropped.
6. **The UI does not filter out "End-of-turn effects are not applied."** It is Track B's stub fact, which Track B removes in the engine.

## Open items

- **Integrator: `useDoublesCalculation.ts`.** It builds its own input today, so until the patch lands the controls do not reach the engine. Patch: `build/TRACK-C-useDoublesCalculation.patch`.
- **Integrator: `DoublesSettings.tsx`** needs a 2-line patch for the toggle count. Patch: `build/TRACK-C-DoublesSettings.patch`.
- **Integrator: `tests/fixtures/doubles-turn.ts`** still carries the stub fact and stub `END_OF_TURN`. Track C's tests do not depend on that text.
- **No moves.** With every Pokémon on No move, the panel still says "No moves chosen." and the cards show current HP, as before. This is DoublesSummary's `projected` and DoublesTurn's `noMoves`. An end of turn (sand, Leftovers) is therefore not shown without a move. This is unchanged behaviour; a follow-up could show it.
- **Training:** nothing needed. Training imports only `relativeLabel` and `actionFact` from `doubles-format`, both unchanged. Its playback reads the Showdown log.
