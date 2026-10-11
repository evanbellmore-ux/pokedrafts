# Engine fixes after the status-eot review

Branch `calc-2v2-status-eot`, uncommitted working tree. Ground truth: pinned Showdown c23d2e94. The findings are in
`review/reviews.json`. Nothing was committed, pushed or switched. `next build` was not run. Nothing touched live Supabase.
`.claude/` and `node_modules` were left alone.

## Files changed (engine fixer's own)

- `app/lib/battle/doubles-status.ts`
- `app/lib/battle/doubles-turn.ts`
- `app/lib/battle/doubles-world.ts`
- `app/lib/battle/doubles-actions.ts`
- `app/lib/battle/doubles-substitute.ts`
- `app/lib/battle/stat-moves.ts`
- `app/lib/battle/hit-loop.ts`
- `app/lib/battle/uses-to-ko.ts`
- `app/lib/battle/calculate.ts`

Tests:
- `tests/unit/doubles-engine-fixes.test.ts` (new, 26 tests)
- `tests/source/doubles-status-moves.test.ts` (accuracy-drop table and G-Max Tartness against the pinned Dex)

Oracle tooling:
- `scripts/.cache/calc-audit/2v2/verify/compare.ts`: the hit-rule turn fact is the certain-crit wording when the oracle
  recorded a `crit` effect.
- New `scripts/.cache/calc-audit/status-eot/fix-engine/`:
  - `cases.ts`, `run.ts`: FX01–FX10 oracle cases.
  - `balloon-1v1.ts`: 1v1 probe for Air Balloon.
  - `golden-row.ts`: prints one golden-1v1 case's rows.

## Gates (final runs)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `eslint app/lib/battle` + the two test files | clean |
| `vitest --config vitest.unit.config.ts` (whole suite) | `Test Files 218 passed (218)`, `Tests 5354 passed (5354)` |
| `vitest --config vitest.battle-data.config.ts` | `Test Files 8 passed (8)` (the status-move file: 18 tests) |
| `golden-1v1.ts --check` | `254 cases byte-equal` |
| `compare.ts` (all oracle cases) | `1001/1001 cases match.` |
| `fix-engine/run.ts` | `12/12 cases match.` |
| `review/status-move/run.ts` | 28/34 match. The rest:<br>- guarded or not estimated by design: RV01, RV02 (end of turn), RV05<br>- the oracle cannot run a mid-turn switch (the app now says the holder switches out): RV03, RV03b, RV17b |
| `npm run conformance:training` | every gate PASS (1 670/670; 2a 229/229; 2b 100.00%; 2c 208/208; 3 240/240; 4a 0 over 320; 4b 40653/40653; 5 33.7/35.0/25.1%; 6 18842/18847; 7 0; 8 657 passed; 9a 30/30; 9b 30/30; runner errors 0) |
| `review/track-e/run.ts` | 47 of the 53 cases with a stored oracle result match, RE60–RE64b, RE80, RE81 and RE85–RE88 among them. RE21 now returns the Assault Vest issue (the oracle aborts there too). The other 6 do not involve these fixes:<br>- RE01: the case's move is not in the learnset<br>- RE01b: one-hit KO move<br>- RE04, RE05: spread heal<br>- RE43: Fling not verified<br>- RE45: its stored oracle result is stale, from an earlier version of the case; the reviewer's batch2.log shows the same 22 differences, and RE45b matches |
| `review/ui/impossible-states.ts` | all 6 rows now equal Showdown's cures. Snorlax 206 and 235, Psychic and Scald always come, Floatzel 160, Earth Power hits. |
| `bench.ts` | turn p50 3.3 ms, p95 7.7 ms, max 22.9 ms; Moves pane max 17.2 ms; reference 30/30 |

## Per finding

### status lens

**H1 — fixed, with a narrow guard on the end of turn.**
- Model: a confusion self-hit on a Berserk or Anger Shell holder sets `MoveVolatiles.berryLocked`. Showdown's onDamage sets
  `checkedBerserk` false for an effect of type Move.
- While the lock holds, the TryEatItem of its healing Berry fails at every Update:
  - covered Berries: `hit-loop.ts BERSERK_BERRIES`. Berry Juice is not on the list: it is used, not eaten.
  - covered paths: `confusionHit`, `berryDue` (Pain Split, a received item, Unnerve ending).
- `afterLoss` (damage from something other than a move) clears the lock, as onDamage does.
- Guard: if a locked holder holds such a Berry at or under its line, a later damaging step into it is not estimated, and so
  is the end of turn, with `REASONS.berryLocked`: `Sitrus Berry after a confusion self-hit with Anger Shell is not modelled
  in 2v2.`
- Why the guard: doubles-eot.ts's Updates would eat the Berry. Showdown keeps it until a residual's damage resets the lock.
- RV01 and RV02 now equal Showdown after the moves (63–80, 70–85, no Sitrus heal). Their end of turn is guarded.
- Test: `H1, RV01, RV02`.

**H2 — fixed.**
- `doubles-status.ts applyBoosts` records each boost() event on `World.boosted`: a rise or a drop in the table AfterBoost
  reads (after ChangeBoost, the cap and TryBoost), accuracy and evasion included.
- `doubles-turn.ts eventGuards` reads the record:
  - status actions: the record only;
  - damaging actions: the record plus the step's stage diff. The pairwise engine records no events.
- Eject Pack now ejects after Sand Attack (RV03, RV03b), and after Mud-Slap (H8).
- RV03b is not estimated for the whole turn, as Eject Button and U-turn already are, because No-move actions are still
  queued. Those Pokémon still run BeforeMove: a replacement's Intimidate would change a later No-move confusion self-hit.
  The reviewer expected the end of turn alone.
- Test: `H2, H8`.

**H3 — fixed (guard).**
- With the record above, Defiant's +2 after Charm's −2 is a rise.
- A foe's Opportunist or Mirror Herb is then not estimated, with `REASONS.copiesRise`, as for every other copy. Opportunist
  copying is not modelled in this build.
- Test: `H3, RV05`.

**H4 — fixed.**
- `doubles-status.ts breaks`: a status move from a Mycelium Might user ignores breakable abilities
  (data/abilities.ts myceliummight onModifyMove). A working Ability Shield is the exception.
- RV12 and RV12b match.
- Test: `H4, RV12`.

**H5 — fixed.**
- `doubles-turn.ts sparklingAria` runs at the move's AfterMove from `World.hitTargets`. `applyStep` and `faceHit` record
  those targets.
- Rules, as data/moves.ts sparklingaria onAfterMove does:
  - the user must still be in, and must not have Sheer Force;
  - each burned target that was hit is cured;
  - with one target, the cure needs `secondaryLands` (Shield Dust, Covert Cloak);
  - with more than one target, Shield Dust is passed.
- Fact: `Sparkling Aria: its burn is cured.`
- RV13, RV13b, FX08 (one target, Shield Dust: no cure) and FX08b (two targets: cured) match.
- Test: `H5`.

**H6 — fixed.**
- `targetsOf` for adjacentAllyOrSelf follows sim/battle.ts getTarget:
  - the Pokémon now standing at the aimed position;
  - the user, if that Pokémon is a fainted ally;
  - the user, if the position is empty.
- Facts:
  - `Snorlax has fainted: Gogoat uses Milk Drink on itself.`
  - `Ally Switch: Milk Drink hits Alakazam in Gogoat's place.`
- The `atAlly` early failure is now for adjacentAlly only.
- RV15, RV15b and FX06 (aimed at its own position after Ally Switch: heals the ally) match.
- Test: `H6`.

**H7 — fixed.**
- `typeImmunity` passes a working Ring Target (sim/pokemon.ts runImmunity NegateImmunity).
- RV19 matches.
- Test: `H7`.

**H8 — fixed.**
- New `stat-moves.ts ACCURACY_DROPS`, with `accuracyDrop` (certain at 100% of the chance, Serene Grace doubling it). The
  source test checks it against each game's pinned Dex.
- `doubles-turn.ts afterHit` and `faceHit` apply the drop through `foeDrop`, which now takes accuracy and evasion. That runs
  Keen Eye, Mind's Eye, Illuminate, Clear Body, Mirror Armor, Defiant, Competitive, Eject Pack and `statsLowered`.
- Same family:
  - `doubles-actions.ts GMAX_EFFECTS` gains G-Max Tartness's evasion −1 on each foe (FX10; source-tested).
  - `applyStep`'s `hiddenDrop`: a foe's drop of the stat Defiant or Competitive then raises still counts as a drop, for
    Eject Pack and Lash Out (FX05).
- RV17, FX05, FX09 and FX10 match. RV17b is not estimated: Snorlax switches out.
- 1v1 is unchanged: the table is read only by the 2v2 kernel.
- Test: `H8, RV17`, `FX05`, `FX09`, `FX10`.

**M1 — fixed** by the H2 record: Haze's clearBoosts records nothing. RV04 matches. Test: `M1, RV04`.

**M2 — fixed.**
- `moveTry`: Teleport fails in generation 7, with the step fact `Teleport fails.` (data/mods/gen7/moves.ts onTry false).
- RV11 and RV11b match.
- Test: `M2`.

**M3 — fixed.**
- `applyBoosts` TryBoost: Illuminate keeps accuracy from falling, generation 9 only (SV, Champions).
- RV06 matches, with `Illuminate: its accuracy is not lowered.`
- Test: `M3, RV06`.

**M4 — fixed.**
- Yawn's own TryHit fails only on an existing status. The Comatose branch is dropped.
- RV07 matches, with `Becomes drowsy.` and the E2 yawn volatile.
- Test: `M4, RV07`.

**L1 — fixed.**
- `applyStep` reads the calculation trace (`rawDesc.isCritical`, the field's Critical hit off) and adds a hit fact:
  - for a certain crit-ratio crit, the calculation's own text: `Every hit is a critical hit (critical-hit ratio +3: Night
    Slash, Super Luck and Scope Lens).`;
  - for an always-critical move: `{Move} is always a critical hit.`
- The turn's hit rule then reads `Every move hits; critical hits only where certain; added effects below 100% do not
  happen.`
- `compare.ts` expects that wording when the oracle recorded `crit` (V52, E35, RV10*).
- Test: `L1, RV10c`.

**L2 — fixed.**
- `perishSong`: only a new count or a TryHit block is a result, so `Perish Song fails.` can now appear.
- FX07 matches.
- Test: `L2, FX07`.

**L3 — fixed.**
- `turnFacts` states the sleep and Champions freeze assumptions whenever the counter is read, No move included.
- It skips a Pokémon whose own ability or Berry cures the status as the turn starts.
- Test: `L3`; ui F1's Hypno row.

### positions-items-sub lens

**F1 — fixed.**
- Lansat and Starf (`hit-loop.ts LANSAT_STARF`) are now eaten at every Update. Paths:
  - kernel `afterLoss` and `berryDue`;
  - `confusionHit`;
  - `receivedItem`;
  - Pain Split;
  - `hit-loop.ts hitStep` and `subHit`;
  - `uses-to-ko.ts attackerBerry`.
- Kernel `ateBerry` (now returns worlds):
  - Lansat gives focusEnergy, unless Focus Energy or Dragon Cheer is already up;
  - Starf splits the world 1/n over the stats below +6: +2, or +4 with Ripen.
- In the pairwise engine, the attacker's Starf stops the count with `STARF_REASON` (a narrow guard). `attackerAte` gives
  Lansat's focus.
- Facts: `Lansat Berry: Focus Energy, +2 critical-hit stages.`, `Starf Berry: +2 Attack.`
- 1v1: golden-1v1 stays byte-equal. The one row the change first touched (USUM random 13, Noibat's Wild Charge) gained only
  a "carried" sentence. `berryTexts` now names an attacker's Lansat only where its +2 makes a later use a certain crit, and
  that row is back to byte-equal.
- Limitation (not guarded): a Lansat eaten mid-move by an attacker whose remaining hits would reach a certain crit ratio.
- RE60–RE63, RE87 and RE88 match.
- Test: `F1, RE60, RE61`, `RE63, RE87`.

**F2 — fixed.**
- Berry Juice is exempt from Unnerve and As One in `receivedItem`, Pain Split and `confusionHit`. Kernel `afterLoss`
  already exempted it.
- RE64-swsh and RE64b-swsh match.
- Test: `F2, RE64b-swsh`.

**F3 — fixed, 1v1 included.**
- `uses-to-ko.ts`: an Air Balloon pops only while its holder's item works (`m.defItemOn`), since it is an item handler.
- golden-1v1 stays byte-equal.
- `fix-engine/balloon-1v1.ts`, in pinned Showdown: Poltergeist twice into a Klutz Golurk and into a Golurk under Magic
  Room. The balloon stays and both uses hit. The app's 1v1 output for the same pair is the same before and after the
  change (84–98, 2–3 uses), so no golden row changed.
- RE80, RE81, RE85 and RE86 match.
- Test: `F3, RE80, RE85`.

**F4 — fixed.**
- `validate`: `Assault Vest stops status moves.` for a Status move other than Me First, while the vest works (no Magic
  Room, no Klutz unless a Neutralizing Gas holder is in).
- Test: `F4, RE21`.

### ui lens (engine side)

**F1 and F2 — fixed.**
- `doubles-status.ts turnStartUpdate` now runs once per root world in `walk`: after generation 7 froze its order, before a
  later generation's first sort. It is no longer called from the first BeforeMove.
- `firstUpdated` gives the same world to the guards known before the walk.
- At that Update, a Pokémon's own ability cures first (`hit-loop.ts OWN_STATUS_CURES`), with no active move and the
  ability's handler before its item's:
  - Immunity and Pastel Veil: poison;
  - Insomnia and Vital Spirit: sleep;
  - Limber: paralysis;
  - Magma Armor: freeze;
  - Water Veil, Water Bubble and Thermal Exchange: burn;
  - Own Tempo: confusion.
- The cure drops the counters. A Neutralizing Gas holder's suppression stands in the build.
- Turn facts: `Immunity: Snorlax is cured of its bad poison as the turn starts.`, `Own Tempo: Slowbro is no longer
  confused.`
- `calculate.ts settleDoublesStart` no longer lets the curing Berry eat such a status (settleItems `ownCure`, 2v2 only).
  FX01b: Showdown keeps the Cheri Berry.
- FX01: inside a breaker's move (Teravolt Thunder Wave), Showdown eats the Berry. That move's Update runs while the breaker
  suppresses Limber, so `updateAll` keeps Berries first and only adds the freeze counter's clean-up.
- FX01, FX01b and FX04 match, and the six rows of `review/ui/impossible-states.ts`.
- Test: `ui F1, F2`, `FX01b, FX04`, `FX01`.
- The UI side (carriedOptions) is the UI fixer's.

## Open

- RV03b: the whole turn is not estimated while No-move actions are queued (see H2).
- H1: the end of turn is guarded. Exact would need doubles-eot.ts to honour `vol.berryLocked` and clear it on a residual's
  damage.
- The lock is not carried to the next turn (Showdown keeps checkedBerserk false until a reset).
- Starf eaten by the attacker inside the pairwise engine stops with `STARF_REASON`, not a split.
