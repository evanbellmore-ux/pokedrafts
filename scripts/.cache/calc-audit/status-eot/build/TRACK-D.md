# Track D: validation (status-eot)

Branch `calc-2v2-status-eot`. Owner of `scripts/.cache/calc-audit/2v2/verify/*` and the generated
`tests/unit/doubles-turn-showdown.test.ts`. Built SPEC §7 and ADDENDUM §7 against pinned Showdown c23d2e94 (runnable copy
`scripts/.cache/calc-audit/showdown`). No engine file was edited.

## What was built

### Oracle (`verify/sim-dfs.ts`)
- **The residual phase runs** (`ra.call` on the residual action, then the faints, the final Update and Emergency Exit).
  - HP and state are read when the residual is picked ("after the moves", as before) and once the action returns
    ("after the turn"). The walk then stops before `endTurn`.
  - The residual's random events (Healer, Shed Skin, Ally Switch's counter, residual tie shuffles, Moody's and Yawn's
    samples) are decisions appended to the path.
  - The after-the-moves tally is recorded only on the path's first residual variant, with the weight at the residual's
    start. So it is the same sum in the same order as before; the bookkeeping (runs, decision counts) is kept apart.
  - A switch request after the last action (U-turn, Eject Button, Emergency Exit) ends the path with no residual
    (`afterTurn.noResidual`).
- **Residual log by effect** (`OracleResult.residuals`, `WalkResult.afterTurn.residuals`).
  - Each residual handler is wrapped (`fieldEvent` → `speedSort`), so every log line knows the handler that wrote it.
  - Groups are per Pokémon, effect and other Pokémon: chance, min/max HP change, KO chance, the non-HP lines as facts,
    and the mean order.
  - Leech Seed's gain is its own group. A Perish Song faint counts as its HP change.
- **Per action and target, the lines as stable keys** (`StepResult.effects`): `status:par`, `boost:atk:-2`, `cant:slp`,
  `start:confusion`, `heal:sitrusberry:58`, `swap`, `item:choicescarf`, `activate:substitute:damage`, and so on.
  - Also per action: `change` (HP over the action), `moveChange` (the move's own HP lines over the paths where it moved),
    `selfHit` (the raw confusion damage from `getConfusionDamage`), `sides` (side and field lines).
  - `WalkResult.noMove`: a No-move Pokémon's lines (C5: its confusion self-hit, Gravity, Taunt).
- **State mixtures per slot** after the moves and after the turn: status, volatiles, stages, item, Substitute HP,
  `timesAttacked`, perish count, the hidden sleep counter, the toxic stage, the swapped position, Emergency Exit's flag.
  Plus `WalkResult.swapped` and `sideConditions` (hazards, Safeguard).
- **Carried state in `prepare()`** (SPEC §7 step 2, ADDENDUM §7.1):
  - sleep, Champions freeze, confusion and the toxic stage;
  - Leech Seed (`addVolatile` with the seeder), a trap (source, `boundDivisor`), Salt Cure, Aqua Ring, Ingrain, Curse,
    Syrup Bomb, Yawn (duration 1) and perish (duration);
  - Wish with C15's `startingTurn = getOverflowedTurnCount() − 1`;
  - `CaseMon.substitute`, the Ally Switch counter (duration 1), `lastMove` (in `moveSlots`), `CaseMon.moves`;
  - `Case.weatherTurns` (`weatherState.duration`), `Case.canSwitch: false` (no bench Pokémon on that side).
- **Hidden-counter expansion** (SPEC §7 step 3, `hiddenCases`).
  - Sleep S is drawn over its prior, restricted to S > attempts × (Early Bird ? 2 : 1). The priors are SV/SwSh/USUM {2,3,4},
    Champions {2: 1/3, 3: 2/3}, and Rest 3. A status "slp" with no `carried.sleep` counts as 0 attempts, as the app assumes.
  - Confusion T is uniform on min..5, restricted to T > attempts.
  - Each sub-case is its own start state with its prior weight (`OracleResult.hidden`).
- **Identity** (ADDENDUM §7.1): `p.m.caseSlot`, with `slotOf` and `monOf` by identity. Log idents are mapped through
  `|swap|` lines. Without a swap this equals the position, which keeps stored results byte-equal.
- **CHANCE_EFFECTS** gains `healer`, `shedskin` and `allyswitch`.
- **Two harness fixes found on the way:**
  1. A hit count is now a `random()` or `sample()` called by `hitStepMoveHitLoop` itself. Before, any call under it
     counted, so a sleep or confusion length set by a status move's effect was fixed to fewest or most in the lowest and
     highest walks. Stored results are unaffected (549/549, bookkeeping included).
  2. A non-Ghost Curse gets no Showdown target (`nonGhostTarget`).
- **New flags:** `--out=dir`, `--exact` (whole ids), `--all` (also run not-estimated cases).

### Cases (`verify/cases-s.ts`, `cases-er.ts`, `cases-e.ts`, `cases-se.ts`; wired into `cases.ts`)
- **S** (SPEC §7.1 S01–S50): 208 cases. 192 run in the oracle and 16 are reason-only.
  - The "-last" cases are the L moves as the last action (`endNotEstimated`).
  - S48 follows ADDENDUM §8: Skill Swap, Soak, Attract and Transform, plus Bestow in USUM. Ally Switch and Trick are dropped.
- **ER** (SPEC §7.1 R01–R45; R ids are taken by `review-engine/cases.ts`, so ERnn = SPEC Rnn): 75 cases, all run in the
  oracle; 9 have an end-of-turn reason.
- **E** (ADDENDUM E01–E47): 123 cases. 109 run in the oracle, 14 are reason-only (E40 and the guards).
- **E2:** 42 cases carry `outcomes: true` (E07a, E13, E24, E27a per E42, plus S and ER cases for volatiles, perish,
  sleep, hazards, stages and the field).
- **`STATUS_EOT_REEXPECT`:** the earlier cases whose expectation changed by design. V36c (Taunt), V36d (Roost last),
  R01 (Figy confusion), R15 (Dynamic Punch) and F14b (Snore asleep) are ready now and run in the oracle. F14a, Sleep Talk
  asleep, is now `Sleep Talk is not modelled in 2v2.`.
- **Duplicate ids** now throw.
- **Case-design helpers:** `verify/q.mjs` and `verify/qm.mjs` (catalog legality and learners), and `verify/show.ts` (a
  compact view of results).

### Comparison (`verify/compare.ts`, `verify/app-turn.ts`)
- **`app-turn.ts`** maps `carried`, `substitute`, `lastMove`, `moves`, `weatherTurns` and `canSwitch` (default true: one
  bench Pokémon per side).
  - A move the app takes no chosen target for gets `target: null` (`doublesTargetRule`).
  - `outcomes` cases also run `calculateDoublesOutcomes`.
- **`compare.ts`** adds:
  - **Status moves:** reach, then kind against reached and landed. Field-wide moves are skipped: they run `tryMoveHit`,
    which has no hit step.
  - **`hit.change`** against `moveChange`.
  - **EFFECT_FACTS:**
    - `status:X` ↔ "Is paralysed." (case-insensitive, so "{Name} is paralysed." for Synchronize);
    - `boost:s:n` ↔ "−2 Attack.";
    - `cant:slp|frz|taunt|disable|imprison|…` ↔ the skipped facts (a sleep-usable move has none);
    - the self-hit's raw range ↔ "Hurts itself in confusion: a–b HP.";
    - the volatiles started ↔ regexes.
    - L moves are not checked.
  - **No move:** a No-move self-hit ↔ `DoublesHP.losses`.
  - **The end of turn:**
    - `endOfTurn.hp` with the after-the-moves tolerances;
    - each residual by slot and effect, preferring the same min, max and sign, with name aliases;
    - an app residual Showdown never had;
    - the `endNotEstimated` reason;
    - paths without a residual must not be "ready".
  - **ADDENDUM:**
    - `swapped`;
    - `DoublesHit.substitute` (chance, min/max taken, breaks) and kind "substitute";
    - no damage check on a hit that met a Substitute: the app's min/max are the hits that reached the Pokémon.
  - **E2:** HP, item, Substitute, volatile, perish, sleep-counter mean, stage, swapped and weather mixtures, and hazards
    and Safeguard per side.
  - **Rules:**
    - a not-estimated case needs start rows only when it has a damaging move;
    - the End-of-turn fact must be gone when the end of turn is ready.
- A negative check (`scratch/neg-e2.ts`, a tampered oracle) confirms that the E2 comparisons fire.

### Regression scripts
- **`verify/regress.mjs` (oracle side):** compares the stored results field by field, with the status-eot additions and
  `ms` stripped and the bookkeeping compared apart.
- **`verify/app-diff.mjs` (app side):** compares the earlier app results with today's and lists the allowed differences
  of SPEC §7 step 7. The old files are backed up in `verify/before-status-eot/`.

### Generated test (`verify/gen-tests.ts` → `tests/unit/doubles-turn-showdown.test.ts`)
- **Cases:** the base 265 (the file's cases before status-eot, `gen-tests-base-ids.json`) and the status-eot ones, each
  only when it agrees in `results/compare.json`. A base case is dropped only for a mismatch its rows assert.
- **Each status-eot row also states:**
  - its end of turn (after-turn HP and the residuals by slot, min, max, chance and KO chance, or the reason);
  - its effect facts;
  - its Substitute hits;
  - `swapped`;
  - for `outcomes` cases, the E2 mixtures (items, Substitutes, volatiles, perish counts, stages, positions, hazards).
- The input mirrors `caseInput` (carried, canSwitch true, `doublesTargetRule`).

### Bench (`verify/bench.ts`)
- **`BENCH_CASES`:** SPEC §4.10's four turns (Teeter Dance + Quick Claw + four movers + a tie; Swagger into Sitrus; Spore
  + Lum + Early Bird; sand + four Leech Seeds + Healer) and ADDENDUM's three (a carried Substitute + Icicle Spear + Rock
  Slide; Ally Switch + Snipe Shot + Follow Me; Trick Choice Scarf + four movers + Quick Claw).
- **The reference check:** `DOUBLES_REFERENCE` with `USES_REFERENCE` against the normal mode on 30 status and end-of-turn
  cases.
- **Summaries:** the end-of-turn reasons are counted.

## Results

- **Oracle, new cases:** 381 run (376 S/ER/E + 5 re-expected), and every one has a stored result in `results/`. S26d
  first failed on the Curse target, then passed after the fix above.
  - **`--validate`** replays each turn whole, with no merging, and compares the after-the-turn distributions too. It
    agrees on every case it finished (`scratch/validate2.txt`, `scratch/validate3-*.txt`):
    - S01b (sv, champions), S04c, S10, S41a1, S41a2-champions, S43a2, S43b and S50;
    - ER19d, ER22a-sv, ER23, ER27, ER28 and ER41f;
    - E07a-sv, E09a-sv and E24-sv.
  - An earlier pass, before the last harness fixes, also agreed on S12b, S13a and ER09a.
  - **ER17 cannot be replayed whole.** Its two Venusaur have equal Speed, so every speed sort in the turn (each Update and
    each residual handler) is a 50:50 tie. Without merging, that is more than 5 000 replays per mode. The merged walk
    takes 74 runs, and it matches the app.
- **Regression (556 earlier):** `node verify/regress.mjs verify/results` →
  `549/552 byte-equal after the moves … walk bookkeeping also equal: 549/552`.
  - The 3 others are M24i, M24j and M29c, not-estimated cases whose stored files are stale. They were written by a harness
    older than this branch: there is no `truncated` field, and M29c's file has Garchomp at 68–70 with no Sitrus.
    - Not-estimated cases do not rerun without `--all`, which is why the files were never refreshed.
    - The harness as it was before status-eot (`before-status-eot/sim-dfs.ts`, run through `scratch/old-m29c.ts`) gives
      exactly today's distributions on all three (M29c: 115, the Sitrus eaten after the KO, as its checks say).
  - The 4 non-case files (bench, compare, reference-diffs, third-party-missing) are not results.
- **App side, earlier cases:** `node verify/app-diff.mjs` → **0 unexplained**.
  - 510 ready cases are byte-equal after the moves. The removed End-of-turn fact, the new `conditions`, the effect hits and
    the status-move step facts are set aside.
  - 39 add only assumption facts: 37 "Assumes Dynamax started this turn.", 2 "Assumes the Hail does not end this turn.".
  - 33 not-estimated cases keep their reason.
  - 5 became ready (Confusion ×2, Sleep, Taunt before another move, Roost).
  - F14a's guard became `Sleep Talk is not modelled in 2v2.`.
  - 2 are stale files of cases no longer in `cases.ts` (SA05, SA13). In all, 590 files.
- **Compare (all 994 cases, final run 17:52 on the engine as Tracks A, B and E left it):** **992/994 match**.
  - All 588 earlier cases match, and 404 of the 406 new ones (`results/compare.json`, `scratch/compare-final.txt`).
  - At 17:39, E16a, E16b, E16d, E16e and E16h did not match: a received item was not used at the action's Update. They
    match after Track A's received-item Update.
  - The 2 that do not match are engine issues (Needs below):
  - **ER21c (Track B, or the integrator):** Psychic Noise as the last action into a Sitrus holder at 150/235 that falls
    below half.
    - Showdown eats nothing: Heal Block is set at the secondary, before the Update, so the Berry's TryHeal fails. Snorlax
      is left at 89–99.
    - The app eats the Sitrus inside the hit (147–157), because the hit loop's Berry heal does not read Heal Block (Track A
      notes the same).
    - ER21b (Aqua Ring and Leftovers blocked at the end of turn) agrees.
  - **E25b (integrator):** two Draining Kiss users hit the Substitutes of two Rough Skin Garchomp.
    - Showdown: each heals its drain, 60 → 78, and with Big Root 60 → 83.
    - The app also takes Rough Skin's 17 (61 and 66), although every hit met the Substitute.
    - This is the frozen part-path bug Track E reported (TRACK-E.md, Needs from the integrator item 0): `hitEnd` with
      `landed` 0 runs `drained.to(0, 0)`, one `hitStep` with DamagingHit.
- **Generated test:** regenerated at 17:52 with 644 cases; the 2 above are left out.
  - `npx vitest run --config vitest.unit.config.ts tests/unit/doubles-turn-showdown.test.ts` → **644 passed** (5.4 s).
  - `npx tsc --noEmit` is clean (exit 0), and `eslint` on the file is clean. The file is 929 KB.
- **Bench** (`npx --no-install tsx verify/bench.ts`, final run 17:53; 1 201 turns = 994 cases + 7 bench + 200 fuzz):

  | Measure | Result | Target |
  |---|---|---|
  | Turn p50 | 3.8 ms | 30 ms |
  | Turn p95 | 8.4 ms | 120 ms |
  | Turn max | 21.4 ms (E30c) | 400 ms |
  | Moves pane p50 | 12.3 ms | |
  | Moves pane max | 19.2 ms | 25 ms |
  | Reference equality | 30/30 | |

  - An earlier run measured the Moves pane at 24.96 ms max. Step 0 measured 23–27 ms across runs. status-eot does not
    change `calculateDoublesMoves`, so this number is noise around the target.
  - The bench turns take 5.2–15.6 ms, and every one is ready with its end of turn ready: teeter 15.6, seeds 12.8,
    trick 8.2, swagger 7.2, substitute 7.2, allyswitch 5.3, spore 5.2.
  - **Statuses:** 1 092 ready, 105 not estimated, 4 issues. The issues are the same 4 fuzz inputs the bench rejected before
    status-eot (fuzz-17, -42, -78 and -117).
  - The end of turn is ready on 921 rows. The rest are the expected reasons:
    - switch-outs;
    - the L moves as the last action (Skill Swap, Soak, Attract, Transform, Bestow);
    - the R41 guards (Neutralizing Gas ending, Pickup, Harvest, Cud Chew, Future Sight, Zen Mode, G-Max Wildfire).

## Deviations from the spec
1. **Case ids.** SPEC's R cases are ER01–ER45, because R01–R17 exist in `review-engine/cases.ts`. E43 is split into
   E43-30 and E43-300.
2. **Rows not buildable as written:**
   - S09's Pastel Veil is in SwSh (S09e-swsh): no SV catalog Pokémon has it.
   - S16's Venom Drench is in USUM: it is not in the SV catalog.
   - S12's "self-hit into Endure" is not built: one Pokémon cannot use Endure and then hurt itself in the same turn.
   - S36's "the Soundproof Perish Song user still counts" is not built: no SV Pokémon has both.
   - S46's "Focus Energy twice" is one Focus Energy (one action per turn).
   - ER19's Sheer Force + Salt Cure is not built: no Salt Cure learner has Sheer Force.
   - E17's Mold Breaker into Sticky Hold and "a Sticky Hold user Tricks its own item" are not built: no SV Trick learner
     has either ability.
   - ER16e (an empty seeder slot) is dropped: `validate()` rejects an empty-slot source (contract §3.1). Track B's bridge
     omits it.
   - E40-BoosterEnergy is dropped: every Protosynthesis or Quark Drive holder is a Paradox Pokémon, so Trick fails (T6).
     Track E pins `received` on a kernel fixture.
   - E40's resist-Berry representative is a Yache Berry Garchomp; Occa never acts on an Ice move.
3. **Cases adjusted so the tested move is truly last.** The app counts a No-move Pokémon as a later living action, so the
   L "-last" cases, ER01c (Dive), ER10c (Smack Down), ER10d (Dig), ER10e (Fly, new) and ER21b/c (Psychic Noise, one user)
   have every other Pokémon faster.
4. **Lum at Yawn's sleep (S04b).** Showdown's Lum is eaten at AfterSetStatus, before Bad Dreams. S04c adds the Bad Dreams
   case without Lum. Track B made the same correction.
5. **The E2 expectations** go into `doubles-turn-showdown.test.ts` (Track D's file), not into Track B's
   `doubles-outcomes.test.ts`.
6. **The regression compares the walk bookkeeping apart** (it is not a result field). It is equal on 549/549 anyway.
7. **The games.** SPEC's R table names no games, so the ER cases were placed where the catalog has the Pokémon and
   abilities:
   - 63 of 75 are SV;
   - Champions: ER01d, ER09c, ER19a and ER22a;
   - USUM: ER02, ER31a, ER31b, ER32b, ER41g and ER45;
   - SwSh: ER34 and ER41h.
   The S and E cases carry the game variants their rows ask for.

## Open items
- **The 2 disagreeing cases** (ER21c, E25b) wait for Track B and the integrator (Needs). After those fixes, rerun
  `compare.ts`, then `gen-tests.ts` to add them to the test.
- **The integrator regenerates** `tests/unit/doubles-turn-showdown.test.ts` at integration:
  `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts && npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts`.
- **`app-results/`** is regenerated by `compare.ts`.
