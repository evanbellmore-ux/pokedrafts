# FIX-ui: status-eot review, lens "ui" (F1-F7; F8 left to the naming pass)

Owner: UI fixer. Files changed: `app/(app)/calculator/doubles-prep.ts`, `useDoublesView.tsx`, `BattleConditions.tsx`,
`doubles-format.ts`, `DoublesTurn.tsx`; tests `tests/unit/calculator-doubles-ui.test.ts` (2 expectations updated, 7 new
tests) and the new `tests/unit/calculator-doubles-carried-input.test.ts` (client render in the fake DOM). 1v1 is untouched:
`describeConditions`, the 1v1 field editor and every engine file are unchanged.

Reproduction and confirmation: the reviewer's probes are copied to `build/fix-ui-probes/` with their outputs redirected to
`build/fix-ui-probes/out/` (the reviewer's `review/ui/out/` is left as evidence). Run them with
`npx vitest run --config scripts/.cache/calc-audit/status-eot/build/fix-ui-probes/vitest.config.mts` and
`npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/fix-ui-probes/{impossible-states,own-tempo,rockblast-sub}.ts`.
`diff review/ui/out/scenarios.txt build/fix-ui-probes/out/scenarios.txt` shows exactly the F3, F6 and F7 changes.

## F1 (UI side): no counts for a status the Pokémon's own ability cures at the first Update — fixed

- Pinned Showdown: the turn's first `eachEvent('Update')` runs after the `beforeTurn` action, before any Mega Evolution or
  move (sim/battle.ts runAction, gen >= 5). The `onUpdate` of immunity, pastelveil (psn, tox), insomnia, vitalspirit (slp),
  limber (par), magmaarmor (frz), waterveil, waterbubble, thermalexchange (brn) cures the holder (data/abilities.ts; no
  Champions, gen 7 or gen 8 mod overrides). Neutralizing Gas stops it (sim/pokemon.ts ignoringAbility); Ability Shield
  outside Magic Room keeps it.
- `doubles-prep.ts`: `START_CURES` table; `carriedAbilityOn(doubles, slot)` (no other living Neutralizing Gas holder, or an
  Ability Shield outside Magic Room: the same rule as calculate.ts settleDoublesStart's gas); `carriedOptions(build,
  runtime, rest, abilityOn = true)` returns `sleep: null`, `freeze: null`, `toxic: false` for a status its ability cures
  while on. `reconcileCarried(..., abilityOn)` drops the stale count, and a new `reconcileAllCarried` runs it for all four
  slots after every slot transition (`onSlot`: a slot gaining, losing or fainting with Neutralizing Gas changes the
  others) and after `setDoublesField` (Magic Room switches Ability Shield off). `setDoublesCarried` passes `abilityOn`.
- `useDoublesView.tsx`: the controls use `carriedOptions(..., carriedAbilityOn(doubles, slot))`.
- Confirmed: `build/fix-ui-probes/out/impossible-states.out` now prints `toxic:false` for Immunity Snorlax and
  `sleep:null` for Insomnia Hypno (before: `toxic:true`, `sleep:{max:3}`).
- Not mine, still open: the engine models the build's own status as standing (Hypno "Asleep." 66.67%, Magcargo "Frozen."
  80%, Snorlax and Floatzel residuals). The status comes from the build, not from `carried`, so only the engine can cure
  it (see needsFromOthers).
- Tests: "offers no count for a status its own ability cures …", "reads a Neutralizing Gas …", "drops a confusion or count
  the ability ends …" (Insomnia drops a sleep count; Magic Room and Ability Shield cases).

## F2 (UI side): no Confused control for an Own Tempo Pokémon — fixed

- `carriedOptions(...).confusion` is `!(abilityOn && abilityId === "owntempo")`: offered again while a Neutralizing Gas
  suppresses Own Tempo (then the confusion stands, as in Showdown). `reconcileCarried` drops `carried.confusion` when the
  option is false (setting Own Tempo, or the gas leaving or fainting, clears it; `setDoublesCarried` of a confusion on
  Own Tempo returns the same state).
- Confirmed: `out/own-tempo.out` prints `carriedOptions(Own Tempo Slowbro).confusion = false`. Through the calculator's
  own state, an Own Tempo Slowbro's turn input has no `carried`, and Scald reaches Garchomp in 100% with no confusion fact
  (new test, matches pinned Showdown 131/183 every run).
- Not mine: the engine still models a self-hit when `carried.confusion` reaches it directly (Training, tests); see
  needsFromOthers.

## F3: no hit count on the hits that got past a Substitute — fixed

- `doubles-format.ts hitLine`: `hitRangeText` only when `!hit.substitute`. The row's count (2-5) is the whole move's,
  while the damage is that of the hits that reached the Pokémon (pinned Showdown: 1-4 hits after a 30 HP Substitute).
  The Substitute line and the "… after its Substitute breaks (x%)" fact already state the split. Applies to a chosen
  count too.
- Confirmed: `out/rockblast-sub.out` and scenarios: "Snorlax: 25–124 damage (10.64–52.77% of max HP) · KO chance 0%".
  Without a Substitute the line keeps "2–5 hits".
- Test: "gives no hit count to the hits that got past a Substitute (ui F3)".

## F4: a fainted Pokémon's kept state shows no stray select and counts no toggles — fixed

- `BattleConditions.tsx CarriedFields`: the Confusion turns select and the `counts` block read
  `options.confusion ? value.confusion : undefined`. `carriedToggles` counts a ticked Confused, Rest sleep or Substitute
  only when its option is offered; `describeDoublesConditions` takes `Pick<CarriedControl, "options" | "value">`.
- Confirmed: `out/controls.txt` 2b now reads "own-right: Venusaur Charge" and "0 toggles on" (before: a "Confusion turns
  so far" select and "2 toggles on"); the state is still kept.
- Tests: "counts and shows only the controls a Pokémon has …" (new); "counts the ticked … checkboxes" now gives its Rest
  sleep Pokémon the Asleep status it needs (the old fixture counted a Rest sleep that was not shown).

## F5: Substitute HP typed past its bounds — fixed (field states which HP the turn uses)

- A remount (`key`) would drop focus while typing, and NumberInput is a shared component, so `CarriedFields` keeps the
  typed value when the bound equals the stored HP (the only case NumberInput does not resync) and shows the field error
  "{Name}: a Substitute has at most {max} HP; the turn uses {max}." (or "at least 1 HP; the turn uses 1."). It sets
  aria-invalid and aria-describedby through Field. Blur (NumberInput clamps) or any in-range value clears it.
- 375 px: `build/fix-ui-probes/layout/page.html` with the error shown: `scrollWidth 375`, 0 overflowing elements; the
  error wraps inside its field.
- Test: `tests/unit/calculator-doubles-carried-input.test.ts` (real useDoublesView in the fake DOM: "380", blur, "12",
  "120", "0" at 1 HP, cleared).

## F6: no KO chance on a card only a status move reached — fixed

- `doubles-format.ts cardReached(turn, slot, runtime?)`: a status move's hit (kind "effect", or with `runtime` a Status
  move's "no-damage"/"blocked" hit) counts only when it takes HP (`change.min < 0`: Pain Split, Belly Drum). Damaging
  moves, residuals and the step's own KO chance are unchanged. `useDoublesView` passes the runtime.
- Confirmed: scenarios: Thunder Wave, Swords Dance, Perish Song, Wish, Ally Switch and Trick cards no longer show
  "KO chance: 0%"; Pain Split's target and Belly Drum's user keep it.
- Tests: "shows no KO chance on a card only a status move reached …" (new); the EOT not-estimated card test updated
  (Charizard, reached only by Thunder Wave, shows no KO chance).

## F7: status-move hits with nothing to state — part (a) fixed; part (b) needs the engine

- (a) `doubles-format.ts listedHits(step)`: when the step has facts, an "effect" hit with no HP change, no Substitute, no
  fact and a share of 1 is left out (its line would be the name alone). `DoublesTurn.tsx` lists `listedHits(step)` and
  renders no hit list when none is left. Confirmed: scenarios lose the lone "Clefable" (Wish), "Alakazam" (Ally Switch)
  and "Snorlax" (Trick) lines. Test: "leaves out a status move's hit that states nothing …".
- (b) Will-O-Wisp into Charizard ("Charizard" + "Charizard is immune.") vs Spore into Venusaur ("Venusaur: no effect" +
  "Venusaur is immune."): the UI cannot tell a refusal fact from a success fact without text matching. Both are `-immune`
  in pinned Showdown (setStatus runStatusImmunity vs TryImmunity powder). The UI already prints "{Name}: no effect" for a
  status move's "no-damage" hit (existing test), so the fix is the engine returning kind "no-damage" for a canStatus
  refusal (needsFromOthers). Not done here.

## F8: not in scope (the user's naming pass).

## Checks

- `npx tsc --noEmit -p .`: clean. eslint on the changed files: clean.
- `npx vitest run --config vitest.unit.config.ts tests/unit/calculator-doubles-*.test.ts tests/unit/calculator-ui.test.ts
  tests/unit/calculator-layout.test.ts tests/unit/calculator-labels.test.ts tests/unit/calculator-tabs.test.ts
  tests/unit/doubles-moves-pane.test.ts tests/unit/calculator-ngas-2v2.test.ts tests/unit/calculator-ngas-2v2-verify.test.ts
  tests/unit/calculator-intimidate.test.ts`: 15 files, 366 tests pass (the new carried-input file included).
  `build/int-render.test.ts`: passes. The copied reviewer probes (`build/fix-ui-probes/`): 6 files pass.
- No engine file changed, so golden-1v1 and the oracle compare are unaffected by this fix.
