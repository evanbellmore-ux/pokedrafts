# FIX: eot-training lens (EOT-1 to EOT-6)

Branch `calc-2v2-status-eot`, working tree only. Nothing was committed, no branch was switched, `next build` was not run,
nothing touched live Supabase, `.claude/` and `node_modules` were left alone. Ground truth is pinned Showdown c23d2e94.

Files changed, all in this fixer's set:
- engine: `app/lib/battle/doubles-eot.ts`, `app/lib/battle/residuals.ts`;
- Training: `app/(app)/training/sim/bridge.ts`, `sim/tracker.ts`, `sim/effects.ts`, `model/public-state.ts`;
- gate scripts: `scripts/training/conformance.ts`, `leak.ts`, `lib/leak-l1.ts`, `lib/oracle.ts`, `lib/teams.ts`, new
  `lib/starting-mons.ts`; fixture `tests/fixtures/training-teams.ts` (new pool E);
- tests: `tests/unit/doubles-eot.test.ts`, `training-bridge.test.ts`, `training-tracker.test.ts`,
  `training-belief-battle.test.ts`, `training-leak.test.ts`, `training-teams.test.ts`, new `training-starting-mons.test.ts`,
  `tests/source/doubles-residuals.test.ts`.

Probes of this fix: `build/fix-eot-*.ts`; their outputs in `build/fix-eot-results/`.

## Per finding

### EOT-1 (high): a weather replaced and set again this turn ended as the old one. Guarded (narrow), exact fix needs others

- **Reproduced.** `review/eot-training/check.ts RV01`: the app showed Tentacruel at 100 with `Rain ends.`. The oracle has
  109 (Rain Dish 9).
- **Why not exact here.** The world records only the weather now. It does not record when it was set.
  - `FieldState` lives in `doubles-world.ts`, and its setters are in `doubles-status.ts` (weather moves) and
    `doubles-turn.ts` (a step's conditions, the face probe, a strong weather ending).
  - None of those are this fixer's files, and `doubles-eot.ts` gets no hook from a status move.
  - The exact fix is in needsFromOthers.
- **Guard** (`doubles-eot.ts` `setAgain`, `weatherSetters`). It fires only in the case where the HP can differ. All of these
  must hold:
  - the weather is the input's, it is not strong, and `weatherTurns` is 1;
  - the turn has a setter of that weather that acted (`moved`) and a setter of another weather that acted. Setters are the
    weather moves, the Max Moves that set a weather, and Sand Spit on a Pokémon a hit reached.
  - Reason: `{Setter} after {Other} is not modelled in 2v2.`, for example `Rain Dance after Sunny Day is not modelled in
    2v2.` The moves stay estimated.
  - With no setter of another weather acting, every setter of the input's weather failed (`sim/field.ts setWeather`: the
    weather is already up), so the weather is the one from before and its end is exact.
  - With `weatherTurns` absent or 2 or more, a re-set weather and the old one give the same HP. The assumption fact is kept.
- **Confirmed.** RV01 is now `not-estimated (Rain Dance after Sunny Day is not modelled in 2v2.)`, in the calculator and in E2.
- **Test.** `doubles-eot.test.ts`: "a weather from before with one turn left that the moves may have set again after
  another". It also covers Rain Dance alone (it fails, the rain ends, no Rain Dish) and Sunny Day alone (a new sun, no fact).
- **Negative check.** Disabling the guard fails the test.

### EOT-2 (high): Harvest and Pickup after a Berry eaten at the weather's Update. Guarded (exact reason)

- **Reproduced.** RV22: the app showed Ambipom at 66 as exact. The oracle has 103 (Pickup takes the Sitrus, which is eaten at
  the final Update). RV21: the app showed 80 for certain. Plain pinned sampling gives 80 and 122 at 50% each.
- **Fix.** Two handlers at RESIDUAL_KEYS.harvest and .pickup (28.2), with the pinned conditions (`data/abilities.ts`):
  - **`harvestGuard`**: the holder has HP, holds no item, and held a Berry as the residual started (eaten in it: the
    weather's Update, or a Lum Berry at a Yawn's sleep).
  - **`pickupGuard`**: the holder holds no item, and another living Pokémon (all are adjacent in doubles) held an item at the
    turn's start or as the residual started and holds none now.
  - Either makes `kernel.notEstimated(REASONS.notIn2v2(Harvest | Pickup))`.
  - The guards before the phase (no item after the moves) are unchanged.
- **Confirmed.** RV21 is `not-estimated (Harvest is not modelled in 2v2.)` and RV22 is `not-estimated (Pickup is not modelled
  in 2v2.)`, in both the calculator and E2.
- **Test.** `doubles-eot.test.ts`: "Harvest and Pickup after a Berry eaten at the weather's Update". Its control case
  (Snorlax kept above half, so Pickup finds nothing) stays ready at 75 − 9.
- **Negative check.** The test fails without the handlers.
- **Oracle.** Adding `harvest` to `sim-dfs.ts` CHANCE_EFFECTS is left to the oracle's owner (needs). No stored case reaches
  it, and the app is not estimated in every case where it could act.

### EOT-3 (medium): missing "Assumes the {Weather} does not end this turn." fact. Fixed

- **Reproduced.** `review/eot-training/texts.ts`: RT01 (Hydration), RT02 (Leaf Guard and a carried Yawn) and RT04 (Leaf
  Guard and a Flame Orb) had no assumption fact. RT03 (Rain Dish) did.
- **Fix.** `lastingFact` (a weather from before, no `weatherTurns`, not strong) is now added in two more places:
  - in `cureHandler` when Hydration cures;
  - in `setStatus` when a Yawn's sleep or an Orb's status is refused only because of the weather. The check is the same call
    on the world without the weather.
- **Same gap, found here, also fixed.** The Orbs act at 28.3, after the terrain's and Gravity's countdowns at order 27
  (`data/moves.ts` mistyterrain, gravity `onFieldResidualOrder: 27`). The input gives no turns left for either.
  - A Misty Terrain from before the turn that stops an Orb's status now adds `Assumes the Misty Terrain does not end this
    turn.`
  - The grounding Gravity gives, when it stops an Orb's status, now adds `Assumes Gravity does not end this turn.`
  - Pinned probe `build/fix-eot-misty-probe.ts`: Misty Terrain with 1 turn left gives `brn`, with 5 gives no status. Gravity
    with 1 turn left (Corviknight in Misty Terrain) gives `brn`, with 5 gives no status.
  - A Yawn's sleep at 23 comes before 27, so it needs no terrain fact.
- **Confirmed.** RT01, RT02 and RT04 now state `Assumes the Rain|Sun does not end this turn.`. RV06 states the Misty Terrain
  fact. RV06, RV09, RV10, RV20 and RV23 still match the oracle.
- **Tests.** `doubles-eot.test.ts`:
  - "states that the weather from before goes on when Hydration's cure or Leaf Guard rely on it", with no fact once
    `weatherTurns` is given;
  - "states that Misty Terrain and Gravity from before go on when they stop an Orb's status". A Misty Terrain set this turn
    gives no fact.
- **Negative check.** Both tests fail without the facts.

### Found while fixing EOT-3: Roost's volatile ends at order 25, before the Orbs. Fixed (exact)

- **Bug.** Pinned `data/moves.ts` roost condition: `duration: 1, onResidualOrder: 25`. A Flying-type Roost user is grounded
  only until 25. The app kept `eot.roosted` through 28.3, so Misty Terrain stopped its Orb.
- **Oracle cases.** `build/fix-eot-cases.ts`, run with `build/fix-eot-check.ts`:
  - FX01: Corviknight, Roost, Flame Orb, Misty Terrain. Oracle `status:brn@100`.
  - FX02: Talonflame, Roost, Toxic Orb. Oracle `status:tox@100`.
- **Before.** `build/fix-eot-status-probe.ts`: no Orb residual and E2 status `""`. compare.ts reported "ok", because it
  compares neither status-only residual facts nor E2 statuses (needs).
- **Fix.** A handler at RESIDUAL_KEYS.roost `{ order: 25, subOrder: 2, priority: 0 }` clears `eot.roosted`.
  `tests/source/doubles-residuals.test.ts` now classifies `move:roost:onResidual` as modelled, and its key is checked against
  the pinned dex.
- **After.** `Is burned.` / `Is badly poisoned.` and E2 status `brn` / `tox`, equal to the oracle. Grassy Terrain at 5.2 (RV09)
  still grounds the user.
- **Test.** `doubles-eot.test.ts`: "Roost's volatile ends at order 25…". The negative check fails it.

### EOT-4 (medium): the bridge marked Future Sight as landing a turn early. Fixed

- **Reproduced.** `review/eot-training/future-sight.out`: turn 2 carried `futureMove` and E2 was not estimated, while Showdown
  lands it on turn 3.
- **Fix** (`bridge.ts carriedOf`): `(battle.turn − 1) % 256 >= endingTurn`, as pinned `data/conditions.ts` futuremove and
  `getOverflowedTurnCount` do. The Wish test now shares the same `overflowed`.
- **Confirmed.** The reviewer's probe (`vitest --config review/eot-training/vitest.config.mts future-sight`) now writes:
  - turn 2: no `futureMove`, E2 `"applied"`, Showdown lands it: false;
  - turn 3: `futureMove`, `Future Sight landing is not modelled in 2v2.`, Showdown lands it: true.
- **Test.** `training-bridge.test.ts`: "carries a Future Sight only on the turn it lands" plays a real seat battle. With the old
  condition it fails (`carried: "futuresight"` on turn 2).

### EOT-5 (low): the conformance and leak gates did not exercise the new fields; 4b read by position. Fixed

Coverage:
- **Pool E** (`tests/fixtures/training-teams.ts`). Two legal Reg M-C teams, checked by the bundled TeamValidator and
  parseTeamImport through `training-teams.test.ts`:
  - E01: Farigiraf with Ally Switch and Wish; Gholdengo with Choice Scarf and Trick; Venusaur with Big Root, Leech Seed and
    Ingrain; Garganacl with Salt Cure; Hydrapple with Syrup Bomb; Milotic with Aqua Ring.
  - E02: Snorlax with Curse and Yawn; Sneasler with Choice Scarf and Switcheroo; Gengar with Substitute and Perish Song;
    Sceptile with Shed Tail and Leech Seed; Espeon with Baton Pass, Future Sight and Yawn; Charizard with Binding Band and
    Fire Spin.
  - `parsePools` accepts E.
  - Conformance keeps its 40 battles on `S,V,A`, so the run is integration's own (`conformance-SVA`). It now adds
    `--eot 10` more battles in each mode, E01 against E02 (`teamPair(run + ":eot")`), and every gate counts them.
  - A first try that only added E to the pools drew E teams in 5 of 40 battles.
  - The eval's win-rate runs keep their pools (`S,V`, `U`, `S`), so their seeds and pairs are unchanged.
- **Gate 4b by Pokémon** (`scripts/training/lib/starting-mons.ts`). `preResidualHP` reads each starting slot's Pokémon object
  wherever it stands, matching E2's keys after an Ally Switch. Test `training-starting-mons.test.ts`: a real Ally Switch swaps
  Farigiraf and Snorlax, and the reading follows them.
- **New report row 4d.** It counts the 4b engine cells carrying each DoublesCarried field, and the clean samples with an Ally
  Switch swap, a Trick or Switcheroo, a Substitute made, or a Substitute hit.
- **Leak L1.**
  - `redrawDice` also redraws a Substitute's HP, a partial trap's turns left and the Champions freeze turns.
  - New field `dice-eot`: player E01; opponents E02, E02, V02, V04, A08; 60 battles like `dice`.
  - Every compared decision's key now includes a hash of the engine inputs the AI's services bridge for up to four
    no-prelude cells (carried, lastMove, moves, canSwitch, weatherTurns, positions, Substitute). The services memoise each
    cell, so the AI's own later call returns the same object and its work is unchanged.
  - Tests in `training-leak.test.ts`: `L1-dice-eot` at unit scale, and the redraw of Substitute HP, trap turns and freeze.
- **Gate 1's oracle** (`lib/oracle.ts`). It now reads Showdown's slot conditions as the tracker keeps them: `wish`, and
  `futuremove` named by its move, with layers = position + 1. Test `training-starting-mons.test.ts` uses a real Wish and
  Future Sight.

Training bugs pool E exposed, all fixed here (Training is this fixer's area):
1. **Choice lock after a forced Struggle** (gate 2b p2 was 95.27%).
   - Gholdengo was locked into Shadow Ball, Cursed Body disabled Shadow Ball, and Showdown offered only Struggle. The belief
     battle locked onto `lastMove` (`struggle`), which onDisableMove drops, so it offered every move.
   - The tracker now keeps `choiceMove` (PublicCounts): the first move this stint since an item last reached it. A Struggle
     lock is replaced by the next move. It is cleared by Trick, Switcheroo, Thief and other item arrivals, but not by a Frisk
     reveal.
   - `effects.ts` locks onto it. This replaces the `itemSince` test, which also wrongly locked after a `cant` turn.
   - Tests: `training-tracker.test.ts` and `training-belief-battle.test.ts`.
2. **Syrup Bomb's source.**
   - The tracker kept none, and `effects.ts` built the volatile through the generic countdown with source = the holder.
   - So the bridge always made it a rollout (`Syrup Bomb from an ally is not modelled.`), the belief log ended it at the wrong
     time (gate 2c), and the Speed drop came from the holder itself, which Defiant and Competitive read differently.
   - Now `sourceKey` is the move's user, and the volatile is built with a 4-turn duration and that source.
   - Tests in both files.
3. **Leech Seed's seeder position.**
   - `effects.ts` used `source.getSlot()`. For a seeder that fainted or was benched that is its party index (`p1d`), so the
     bridge carried no Leech Seed (the engine dropped the drain and the heal), and the belief battle's residual differed
     (gate 2c, #15).
   - It is also wrong after an Ally Switch.
   - The tracker now records `sourcePosition`, the seeder's position as it seeded (`PublicVolatile.sourcePosition`), and the
     slot is rebuilt from it.
   - Tests: `training-tracker.test.ts`, and `training-bridge.test.ts` "Leech Seed heals the position the seeder seeded from".
4. **A resolved Future Sight or Wish stayed in the tracker until the next `turn` line.** A replacement request at that
   upkeep showed it (gate 1). They are now removed at the `upkeep` of the residual that resolves them. Test:
   `training-tracker.test.ts`.

Gate results: see "Gates" below.

### EOT-6 (low): end-of-turn Speed lookups and garbage. Fixed

- **Speed once.** `run` computes each present Pokémon's Speed once per residual start (`speeds`, pinned
  `sim/battle.ts:2814` updateSpeed), and passes it to `collect` (handler sort keys) and `weatherHandler`
  (eachEvent('Weather') order). There are no `speedOf` calls in a comparator or per handler any more.
- **Other avoidable allocation on the end-of-turn path:**
  - no `mergeWorlds` (a JSON.stringify of the whole world) for a single world;
  - HP checks read the factor table (`someHP`) instead of building marginal maps;
  - `resolveFaints` and `splitZero` skip slots no world has at 0 HP;
  - statistics keys are not built when nothing records them (E2);
  - `over()` uses no filtered arrays;
  - `guardOf` calls `moveInfo` (a JSON key per call) only for a Gigantamax user, since only its moves can be G-Max Moves;
  - `updateAll` does not flatMap a single world.
- **Behaviour is unchanged**:
  - `compare.ts --no-write`: 1001/1001 after EOT-1 to 4 and 6, and 1001/1001 on the final code. One run in between was
    1000/1001: S12b threw `TypeError … flatMap` from `doubles-status.ts:428`, the status fixer's work in progress at that
    moment.
  - The reviewer's in-process battles replay with the same choice-log hash (`3740e3ffa6ed561a`).
  - Track B's and the new end-of-turn tests pass.
- **Profile** (`review/eot-training/e2-prof.ts 200`, 1 000 E2 calls; ms per 1 000 calls):

| Measure | Review | After Speed once | After all EOT-6 changes |
|---|---|---|---|
| endOfTurn | 159 ms | 120 ms | 85–87 ms |
| speedOf inside it | 41 ms | 32 ms | 10–21 ms |

  The machine was shared with other runs, so these are noisy.
- **Single process** (`build/fix-eot-gc-belief.ts plain 100 integration`, the reviewer's probe with outputs in the build
  folder): belief p95 4.78 ms, minor GC 1235 (2584 ms). The reviewer had 1253–1256 minor GCs (2.50–2.87 s) on the branch.
  - The end of turn is a small share of the garbage. The 2× minor GC against main comes from the rest of E2 and from more
    engine cells, which is outside the end-of-turn path.

## Gates (final code, 2026-10-08/09; the machine was shared with the other fixers' runs)

| Gate | Command | Result |
|---|---|---|
| Types, lint | `npx tsc --noEmit -p .`; eslint on every file above | clean |
| My unit tests | `npx vitest run --config vitest.unit.config.ts tests/unit/training-*.test.ts doubles-eot residuals doubles-outcomes` | 55 files, 630 tests passed |
| 2v2 and calculator tests | `tests/unit/doubles-*.test.ts calculator-doubles*.test.ts uses-to-ko*.test.ts hit-loop*.test.ts` | 27 files, 1246 tests passed |
| Residual source test | `npx vitest run --config vitest.battle-data.config.ts tests/source/doubles-residuals.test.ts` | 3/3 (Roost now modelled, key checked) |
| Oracle vs app, every case | `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts --no-write` | `1001/1001 cases match.` |
| 1v1 golden | `golden-1v1.ts --check` | `254 cases byte-equal` |
| Review cases | `review/eot-training/check.ts` | 20 match. RV01, RV21 and RV22 are not estimated by design (EOT-1, EOT-2). RV05 (Psychic Noise's known guard) and RV24 (the oracle cannot set it up) are unchanged. |
| Fixer cases | `build/fix-eot-check.ts` | FX01, FX02 match; `build/fix-eot-status-probe.ts` brn / tox as the oracle |
| Conformance (default: pools S,V,A plus 10 pool E battles per mode) | `npm run conformance:training` | every gate PASS (below) |
| Conformance, pool E only (30 battles, containment 4) | `npx tsx scripts/training/conformance.ts --pools E --eot 0 --battles 30 --containment 4 --saved 0 --skipE2 --run conformance-E` | every gate PASS (below) |
| Leak | `npm run leak:training` | every gate PASS (below) |
| Eval | `npm run eval:training -- --gates --scale 1 --shards 8 --run fixes` (13 m 50 s) | 20 PASS, 2 FAIL (below) |

Default conformance (`conformance-SVA`, with the pool E pass):
- 1: 840/840.
- 2b: 100.00% / 100.00% of 297.
- 2c: 289/289.
- 3: 288/288, 288/288.
- 4a: 0 over 400.
- 4b: 56527/56527 over 2925/3000 engine cells.
- 4d (report): carried.ingrain 30, carried.saltCure 10, turn.substitute 1267, turn.substitutehit 130, turn.trick 2356.
- 4c (report): 2243/2925.
- 5: 33.7% / 35.0% / 25.1%.
- 6: 23737/23785, with 48 shown as unavailable.
- 7: 0.
- 8: 657/657.
- 9a: 30/30.
- 9b: 30/30.
- Runner errors: 0.

Pool E conformance, 30 battles (`conformance-E`), after the fixes:

| Gate | Before the fixes | After |
|---|---|---|
| 1. Tracker parity | 460/608 | 608/608 |
| 2b. Requests equal, p2 | 95.27% | 100.00% |
| 2c. One-turn logs | 235/250 | 250/250 |

- 4b: 63078/63078 over 3357/3510 engine cells.
- 4d (report): carried.allySwitch 72, aquaRing 99, futureMove 410, ingrain 30, leechSeed 77, perish 41, saltCure 129, sleep 72,
  syrupBomb 20, trap 30, wish 150, yawn 139; turn.allyswitch 1761, turn.substitute 5665, turn.substitutehit 700, turn.trick 9208.
- 7: 0.

Leak:
- L1 0 differences in every field: sp 194, nature 231, item 247, ability 253, moves 289, bench 305, hp 152, dice 70, **dice-eot
  73** (new), choice 129.
- The settings still work: sp-open 161/201, hp-exact 73/139.
- L2: 0 hits in 512 messages over 40 battles.
- Saved battles: 40/40 boards equal.
- On the first run dice-eot had 49 compared with 40 battles (FAIL on the ≥ 50 count only). It now gets 60 battles, as dice
  does.

Eval (`fixes`):
- **PASS:**
  - legality open, closed and perfect: 0 errors, 0 engine issues, 0 fallbacks, 0 capped;
  - vs RandomLegal 98.0%;
  - vs MaxDamage 64.5%;
  - Reads you vs MaxDamage 68.5%;
  - self-play 47.0%;
  - closed sheets 99.0%;
  - information cost 0.0 pts;
  - turn decision p50 342, p95 765, max 1381 ms;
  - preview / replacement 87 / 14 ms;
  - work budget;
  - dropped 0;
  - pool S engine + prelude 89.0%;
  - exploitability 0.01%;
  - determinism 20/20;
  - A1.4 and A1.5 ×3.
- **FAIL: belief update, open p95 8.69 ms** (≤ 8; closed 26 ms passes).
  - The worst run is again safe-maxdamage-usage (pool U, 100 battles). The other open runs are 5.94–6.97 ms. The integration
    run had 8.75 ms.
  - In one process, back to back on the reviewer's battles (`build/fix-eot-gc-belief.ts plain 100 integration`; main from a
    `git archive main` copy):

| | Belief p95 | Minor GCs | Minor GC time |
|---|---|---|---|
| main | 4.42 ms | 1213 | 1442 ms |
| branch | 4.93 ms | 1230 | 2846 ms |

    The branch replays with the same choice-log hash as before these fixes (`3740e3ffa6ed561a`).
  - The scavenge *count* is the same, but each takes about twice as long. That points to more young objects surviving each
    scavenge, not more garbage.
  - The sampling heap profiler with collected objects (`build/fix-eot-alloc.ts`, 10–20 of those battles) puts the end of turn
    at 2.0–2.9% of all sampled allocation. E2 is 42–44% (its moves walk 30–31%), rollouts 9–10%, belief battles 5.5%, and the
    belief observe 3.1–3.3%.
  - So the end-of-turn path cannot bring this p95 under 8 ms. Its own share is already cut (EOT-6 above). The rest is the
    status-eot build's E2 work and what a decision keeps alive (needs).
- **FAIL: Reads you − Plays safe, both vs HabitBot** (the gate is unchanged; `build/fix-eot-habitbot.ts` runs the same child
  shards and writes to `build/fix-eot-results/habitbot/`):

| Seeds (run name) | Code | Plays safe | Reads you | Difference | Gate |
|---|---|---|---|---|---|
| `fixes` (this run) | branch (eval) | 68.0% (272) | 70.3% (281) | 2.3 pts [−1.9, 6.4] | FAIL |
| `fixes` | main 0ccce76 | 67.0% (268) | 71.3% (285) | 4.3 pts [0.4, 8.1] | FAIL |
| `trackb-final` (Track B's) | branch | 62.5% (250) | 71.5% (286) | 9.0 pts [5.0, 13.0] | PASS (equal to Track B's) |
| `trackb-final` | main 0ccce76 | 62.3% (249) | 70.3% (281) | 8.0 pts [3.9, 12.1] | PASS |

  - On the same seeds the branch and main differ by −2.0 and +1.0 points, inside the ±4-point intervals. The gate's result
    follows the seed sample on main as on the branch.

## Needs from others

1. **EOT-1, exact** (owners of `doubles-world.ts`, `doubles-status.ts`, `doubles-turn.ts`):
   - Add `weatherSet?: true` to `FieldState`. `discreteKey` and `cloneWorld` already carry `field`.
   - Set it wherever the moves change `w.field.weather`:
     - `doubles-status.ts` weather moves (`w.field = { ...w.field, weather }`);
     - `doubles-turn.ts` the step's `outcome.conditions.weather` (Max Moves, Sand Spit);
     - the face probe's `probe.conditions.weather`;
     - `kernel.faint` ending a strong weather.
   - Then in `doubles-eot.ts` `weatherHandler`: `fromBefore = !w.field.weatherSet && weather === kernel.input.field.weather &&
     !STRONG_WEATHERS[weather]`, and drop the `setAgain` guard (`weatherSetters`, `Phase.first` / `setters`). RV01 then reads
     109 (Rain Dish 9), as the oracle has.
2. **Oracle harness** (`scripts/.cache/calc-audit/2v2/verify/`, Track D's):
   - `sim-dfs.ts` CHANCE_EFFECTS lacks `harvest`, so its 1/2 is forced to fail (the app is now not estimated wherever it could
     act).
   - `compare.ts` compares neither a residual's status-only facts (oracle `status:brn`) nor E2 status mixtures. FX01 and FX02
     (`build/fix-eot-cases.ts`) "matched" while the app gave no status; they would make good corpus cases with that check.
   - RV24 cannot be set up there (Leaf Guard refuses the carried Yawn in sun at prepare).
3. **Eval belief p95** (integrator): the remaining open-p95 excess is not on the end-of-turn path. A decision's surviving
   young objects (E2 outcomes and the services' cell memo held through the matrix) are the next place to look. Otherwise
   accept or raise the open limit, as INTEGRATION.md already asked.

