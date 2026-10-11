# Wave 1a, Track U1: the calculator UI (status2)

Branch `calc-2v2-status-2` checked at the start and the end; nothing committed, pushed or switched; no frozen file, no other
track's file, `.claude/`, `node_modules`, CastMirror or RaidCard file touched; no `next build`, nothing against Supabase.

Scope (ADDENDUM2 §8.3 row U1): SPEC2 §5.1 (the facts the 2v2 tab shows) and ADDENDUM2 §5.2's apply actions (Commander, and
Intimidate for a Trace holder that copied it). The earlier-turn controls are NU's (ADDENDUM2 §1.3, §5.2); U1 added only the
state plumbing in `doubles-prep.ts` that IN §5.4 / STEP0C.md put there.

## Files

- `app/(app)/calculator/doubles-prep.ts`
  - `applyDoublesIntimidate` also takes a Trace holder whose Trace copies Intimidate as it comes in (`traceCopiesIntimidate`):
    the copied Intimidate through `applyIntimidateToFoes` with the holder as an Intimidate user, both foes in adjacentFoes
    order; the holder keeps Trace and gets `copiedIntimidateStored` = the foes' `intimidatedKey`, in that order, joined by
    `","`; first line `{Name}'s Intimidate (copied by Trace):`.
  - `traceCopiesIntimidate(doubles, slot)`: Trace, not fainted or transformed, not under its own Ability Shield outside Magic
    Room (pinned trace onStart: seek false), not under another Pokémon's Neutralizing Gas (`carriedAbilityOn`); the copied
    ability is `tracedAbility` when chosen, else the one ability every living foe Trace can copy has (the settle's rule).
  - `commanderAlly(doubles, slot)` and `applyDoublesCommander(state, key)`: SV only by data (Tatsugiri is only in SV's
    catalog); Tatsugiri (any form, base species) with Commander in effect (`carriedAbilityOn`: the gas comes out first at the
    lead unless its Ability Shield works) beside a living, untransformed Dondozo, with a living foe (boost()'s
    foePokemonLeft). Dondozo gets `boost({atk:2, def:2, spa:2, spd:2, spe:2})` through ChangeBoost (Contrary, Simple) and
    the cap, on its real stages (stored + the entry boosts the engine adds, intimidate.ts `entryBoosts`; stored back without
    them, as intimidate.ts `finish`); each of Dondozo's living foes then copies the capped positive changes: an Opportunist in
    effect (`carriedAbilityOn`) and a Mirror Herb not under Magic Room or Klutz (used up; Unburden activates), each through
    its own boost(). Lines like the Intimidate button's, grouped per run of equal results
    (`Dondozo's Attack, Defense, Sp. Atk, Sp. Def and Speed rise to +2.`, `won't go higher`).
  - The result record stays `DoublesMatchup.intimidate` (one apply result per slot; `withApplied` counts presses in a row);
    `doublesIntimidateResult` gives it for any of the three buttons.
  - `doublesSlotInput` passes `moves` (quick moves in slot order, then the chosen move) when the action reads its user's
    moves: `MOVES_READERS` = Imprison, Conversion (its first move: the first quick move, Q11), Sleep Talk (CL, wave 1b). Every
    other input is unchanged (see Deviations).
  - IN §5.4 state plumbing: `onSlot`'s `anotherPokemon` clears `history[slot]` and drops the slot from `turnEarlier.entered`;
    `setDoublesField` drops each `…Ends` answer whose effect is off (`earlierForField`; a strong weather never runs out);
    new setters `setDoublesHistory(state, key, history)` and `setDoublesTurnEarlier(state, revision, earlier)` (same state
    when unchanged; empty answers are `NO_HISTORY` / `NO_TURN_EARLIER`).
- `app/(app)/calculator/useDoublesView.tsx`: `applyAction(slot)` and, after the Pokémon's PokemonPanel in its Build settings,
  `<div data-doubles-apply={slot}>` with the button (`Apply Commander to Dondozo`, `Apply Trace's Intimidate to both foes` /
  `… to {Name}` with one foe left) and its `role="status"` result. PokemonPanel (not a U file) keeps its own Intimidate button
  for an Intimidate holder; the new block uses the same classes (`max-w-full whitespace-normal! wrap-anywhere`), so it wraps
  at 375 px.
- `app/(app)/calculator/DoublesTurn.tsx`: the step item's key adds `-{copied}` for a Dancer's or Instruct's copy (DoublesStep
  .copied), so a Pokémon's second step of the same move has its own key (U2 renders the copy in 1b; the key would collide).
- `docs/champions-calculator.md` (2v2 section): the Curse cost as a loss; the gas sentence (the eight ability moves, Q5); the
  conditions list pointer; Stored Power / Power Trip / Punishment reading accuracy and evasion; the "Status moves not
  estimated" bullet replaced by "The status2 status moves" (the 73, their narrow reasons, conditions, facts and the modelled
  guards of SPEC2 §2.3); the end of turn's new rows and the removed reasons; the apply actions; the earlier-turn controls'
  rule and the reset rules; the moves readers.
- `tests/unit/calculator-doubles-ui.test.ts`: four new describe blocks (12 tests) and a `stepKeys` recorder in the file's
  jsx-runtime mock.
- Scratch: `status2/build/u1-apply-probes.ts` (+ `.out`), `status2/build/u1-trace-settle.ts`, this file.

## SPEC2 §5.1 (facts): what the UI needed

Every §5.1 text is an engine fact that reaches the page through the existing lists (step facts, hit facts, skipped, heals,
`DoublesHP.losses`, `DoublesHP.conditions`, residual lines and their facts, turn facts); no list needed new layout. The tests
pin that each kind renders, with names, `wrap-anywhere` and no positional word: the card conditions (`Type: Water`,
`Glaive Rush: double damage taken (50%)`, `Ability: Intimidate`, `Opportunist: copies +1 Attack next turn`, `Stockpile 1
(50%) · Stockpile 2 (50%)`, `Transformed into Charizard`, `Nightmare`, …; Stockpile's counts are not merged as HP), the
heals (`Swallow: +70 HP.`), the Curse loss line and its KO chance on the card, the residual lines (`Nightmare · Blastoise:
−38 HP`, `Octolock · Pikachu (from Venusaur)` with `Defense −1.`, `Harvest · Venusaur (50%)` with `Harvest: Sitrus Berry back
(50%).`, `Pickup · Charizard (from Venusaur)`, `Opportunist · Venusaur (25%)`, `Heal Block ends · Blastoise`), the turn facts
(`Assumes Venusaur has not stockpiled.`), and `cardReached` (a residual's HP loss shows a KO chance, Swallow's heal none).

## Showdown checks (`u1-apply-probes.out`, pinned c23d2e94, SV doubles, the leads)

- U1-CMD-1: Commander: Dondozo +2 ×5; a foe's Opportunist +2 ×5; a foe's Mirror Herb +2 ×5, used up.
- U1-CMD-2: a foe's Neutralizing Gas: no Commander.
- U1-CMD-3: Tatsugiri's Ability Shield under the gas: Commander acts; the foe's Opportunist is suppressed.
- U1-CMD-4: a Simple Mirror Herb holder copies +4 ×5.
- U1-TRC-1: Trace copies Intimidate: both foes −1 (the trace holder's lines after the foes' own Intimidates).
- U1-TRC-2: Trace with its own Ability Shield copies nothing.
The unit tests reproduce each (the cap case: Dondozo at +5 Attack rises by 1, the copies take +1 Attack and +2 to the rest).

## Gates run (this tree, 2026-10-11)

- `npx vitest run --config vitest.unit.config.ts tests/unit/calculator-doubles-ui.test.ts`: 76 passed (64 before + 12).
- The seven `calculator-doubles-*` files: 146 passed before Track F's in-progress `calculate.ts` landed a `flingPlan`
  reference; at the end 145 passed and 1 failed with `ReferenceError: flingPlan is not defined` (calculator-doubles-fainted's
  engine test, `calculate.ts:1943`), as do the engine-backed tests of other `calculator-*` files: F's work in progress.
- `naming-guard`, `champions-calculator`, `battle-native-controls`: 66 passed.
- `npx tsc --noEmit`: my files clean (other tracks' in-progress errors only: `doubles-inputs.ts` earlier, `training/sim/belief
  -battle.ts` at the end).
- `npx eslint` on `doubles-prep.ts`, `useDoublesView.tsx`, `calculator-doubles-ui.test.ts`: no output.
- 375 px: the new block and every new fact line carry `wrap-anywhere` (asserted); no live render (integration 1a's live check).

## Deviations

- `moves` is passed only where an action reads it (Imprison, Conversion, Sleep Talk), not to every slot as SPEC2 §5.2 /
  IN §5.4 say: every other turn input stays byte-equal (`tests/unit/calculator-doubles-prep.test.ts` asserts the exact
  input of a Thunderbolt user, and that file is not U1's), and every engine reader of `input.moves` reads its own user's
  (Imprison, Conversion, Sleep Talk; Encore's `does not have` check needs none, the Last move control offering only the
  target's quick moves and chosen move). A later reader of another Pokémon's moves adds its move to `MOVES_READERS`.
- The apply buttons render after PokemonPanel in `useDoublesView.tsx` (PokemonPanel.tsx is not a U file; its Intimidate
  button is gated on `abilityId === "intimidate"`).
- `copiedIntimidateStored` for two foes is a comma list (one foe: the 1v1's single key). The readers need inclusion (below).

## For the integrator and the other tracks (exact changes; none in a U1 file)

1. `app/(app)/calculator/useDoublesCalculation.ts` (no owner; STEP0C.md's note): the page builds its own turn input, so once
   NU's `withSlotHistory` / `withTurnEarlier` act, pass them, or the page and `getDoublesTurnInput` differ
   (`calculator-doubles-shell.test.ts:240`):
   `const { runtime, field, slots, actions, charged, carried, history, turnEarlier, moves } = doubles;`, the four
   `history[slot]` as the fifth argument of each `doublesSlotInput(…)`, the whole `doublesTurnInput(…)` wrapped in
   `withTurnEarlier(…, turnEarlier)` (import from `./doubles-inputs`), and the four histories and `turnEarlier` in the memo deps.
2. `app/lib/battle/doubles-start.ts:133` (frozen in 1a; ST's in 1b): a stored copy settles as the holder's Intimidate:
   `else if (copied === "intimidate" && !copiedIntimidateStored(build, foes(slot).map((foe) => shown[foe]!), runtime)) fail(…)`
   with `function copiedIntimidateStored(build: BattleBuild, foes: BattleBuild[], runtime: DoublesTurnInput["runtime"]) { const
   keys = build.copiedIntimidateStored?.split(",") ?? []; return foes.length > 0 && foes.every((foe) => keys.includes(
   intimidatedKey(foe, runtime))); }` (`intimidatedKey` from `./intimidate`). Failing today:
   `npx --no-install tsx scripts/.cache/calc-audit/status2/build/u1-trace-settle.ts` prints `after apply: not-estimated: Trace
   copying Intimidate is not modelled in 2v2.`; after the line, `ready`. ST's 1b settle reads the same list per foe.
3. `app/lib/battle/calculate.ts:789` (F's in 1a): 1v1's settleEntry compares `copiedIntimidateStored === intimidatedKey(foe)`;
   with the 2v2 list it must be `!!shown[side].copiedIntimidateStored?.split(",").includes(intimidatedKey(shown[foeSide],
   runtime))`, or a 2v2-stored copy is applied again in 1v1 (the shared roster cache). Golden unchanged (no list in it).
4. `app/(app)/calculator/roster-prep.ts:399` (no owner): the same inclusion test in `toggleMatchupMega`.
5. NU's controls: `setDoublesHistory(state, key, history)` and `setDoublesTurnEarlier(state, doubles.revision, earlier)` exist
   in `doubles-prep.ts`; `onSlot` already clears `history[slot]` and the slot's `turnEarlier.entered` rank, and
   `setDoublesField` drops an `…Ends` answer whose effect is off. Still to wire once NU names them: `useDoublesView.tsx`'s
   `carriedControls()` filling NU's new `CarriedControl` fields (values from `doubles.history[slot]` / `doubles.turnEarlier`,
   handlers through the two setters), NU's build-change reconcile beside `reconcileCarried` in `reconcileAllCarried`, and
   NU's action-bound drops where `onSlot` changes the action (`chooseDoublesMove`).
6. The docs' 2v2 bullets describe wave 1a per SPEC2 / ADDENDUM2 (the 73 moves, the narrow reasons, the modelled guards, the
   end-of-turn rows, the controls' rule): check each against what the 1a tracks landed.
