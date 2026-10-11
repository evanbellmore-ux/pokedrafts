# FINAL: status-eot final gate (2v2 status moves and end of turn, after the review fixes)

Branch `calc-2v2-status-eot`, uncommitted working tree. Ground truth: pinned Pokémon Showdown c23d2e94. Nothing was committed or
pushed, no branch was switched, `next build` was not run, nothing touched live Supabase, `.claude/` and `node_modules` were left
alone (a scratch `git archive main` copy joined `node_modules` through a junction for one same-seed run; the junction was removed
with `rmdir` and the copy deleted). The dev server on port 3005 (not this session's) was left running. The "Battle states that
cannot be set here" note is unchanged (`app/lib/battle/unmodelled-states.ts` has no diff).

Logs of every run below: `build/final-logs/`.

## Gates (exact output lines; final code)

| Gate | Command | Output |
|---|---|---|
| Lint, types, unit tests | `npm run check` | eslint and `tsc --noEmit` clean; `Test Files  220 passed (220)`, `Tests  5618 passed (5618)` |
| Source tests | `npm run test:battle-data:source` | `Test Files  8 passed (8)`, `Tests  133 passed (133)` |
| 1v1 golden | `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check` | `golden-1v1: 254 cases byte-equal (2846 ms)` (no golden row refreshed) |
| Oracle vs app, every case | `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts` | `1264/1264 cases match.` (1001 earlier + 263 review regression cases) |
| Earlier oracle results | `node scripts/.cache/calc-audit/2v2/verify/regress.mjs scripts/.cache/calc-audit/2v2/verify/results` | `549/552 byte-equal after the moves (status-eot fields, ms and the walk bookkeeping stripped); differ: 3; missing: 0` (M24i, M24j, M29c: the stale `before-status-eot` baselines INTEGRATION.md and TRACK-D.md explain) |
| Earlier cases, app side | `node scripts/.cache/calc-audit/2v2/verify/app-diff.mjs` | `0 unexplained` (510 byte-equal after the moves; 37 + 2 add only assumption facts; 33 keep their reason; 5 became ready by design; F14a's Sleep Talk reason; 2 stale files) |
| Generated test | `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts` | `wrote 894 cases to …\tests\unit\doubles-turn-showdown.test.ts (0 cases that do not agree with the app left out)`; with `doubles-outcomes.test.ts`: `Tests  898 passed (898)` |
| Bench | `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/bench.ts` | turn p50 2.59 ms, p95 6.96 ms, max 139.09 ms (RS-RVP1) against 30 / 120 / 400; Moves pane p50 11.77 ms, max 20.09 ms against 25; reference 30/30; 1 471 turns: 1 340 ready, 127 not estimated, 4 issues; the 7 bench turns 3.5–15.7 ms, all with the end of turn ready |
| Training conformance | `npm run conformance:training` | every gate PASS: 1 `840/840`; 2a `297/297`; 2b `100.00% / 100.00% of 297`; 2c `289/289`; 3 `288/288, 288/288`; 4a `0 over 400 Pokémon`; 4b `56527/56527 (100.00%) over 2925/3000 engine cells`; 4d (report); 4c (report) `2243/2925 engine cells (76.68%)`; 5 `33.7% / 35.0% / 25.1%`; 6 `23737/23785`; 7 `0`; 8 `Test Files  2 passed (2); Tests  898 passed (898)`; 9a `30/30 hash, 30/30 boards and result (6 forfeited)`; 9b `30/30; largest record 40 KB`; runner errors 0 (rerun after the last generated test; the first run on the same engine code also passed every gate) |
| Training leak | `npm run leak:training` | every gate PASS: L1 `0 differences` in sp 194, nature 231, item 247, ability 253, moves 289, bench 305, hp 152, dice 70, dice-eot 73, choice 129 (sp-open 161/201, hp-exact 73/139 differ); `L2 … 0 hits in 528 messages over 40 battles (8 forfeited on a locked turn)`; saved battles `40 replays (280 boards; 40 of 40 equal to the battle's boards), 10 resumed, 240 checkpoints sealed` |
| Training eval | `npm run eval:training -- --gates --scale 1 --shards 8 --run final` (quiet machine, 10 m 31 s) | **21 PASS, 1 FAIL.** PASS: legality open / closed / perfect `0 errors, 0 engine issues, 0 fallbacks, 0 capped` (n 2600 / 200 / 400); vs RandomLegal `95.5% [91.7%, 97.6%]`; vs MaxDamage `63.2%`; Reads vs MaxDamage `67.0%`; self-play `48.5%`; closed sheets `97.0%`; information cost `0.3 pts`; turn decision `p50 261 ms p95 564 ms max 1191 ms`; preview / replacement `62 ms / 8.97 ms`; **belief update `closed 17 ms, open 6.17 ms` (passes now)**; work budget `engine 240, rollouts 160, builds 4`; dropped 0; pool S `89.1%`; exploitability `0.01%`; determinism `20/20`; A1.4; A1.5 ×3. **FAIL:** `Reads you − Plays safe, both vs HabitBot`: `2.8 pts [-0.6, 6.1] n=400` (≥ +5) |
| HabitBot, main on the same seeds | `npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/fix-eot-habitbot.ts --run final --root <git archive main> --label final-main` | `Reads you − Plays safe, both vs HabitBot (run final, final-main): 2.5 pts [-0.9, 5.9] n=400 → FAIL (≥ +5 points)` (main 266 / 276, the branch 266 / 277) |

## 1. The review cases as permanent oracle cases

`scripts/.cache/calc-audit/2v2/verify/cases-review.ts` (new), wired into `cases-se.ts` (`STATUS_EOT_CASES` ends with
`REVIEW_CASES_FINAL`) the way `cases-int.ts` is. It imports the cases where they were written and renames them so every id is
unique in the corpus (both the status and the end-of-turn lens used RV01…):

| Source | Ids | In the set |
|---|---|---|
| `review/status-move/cases.ts` | `RS-<id>` | 34 |
| `review/eot-training/cases.ts` (REVIEW_CASES and TEXT_CASES) | `RT-<id>` | 27 |
| `review/track-e/cases.ts` | `RE<n>` (unchanged) | 53 |
| `fix-engine/cases.ts` | `FE-<id>` | 12 |
| `verify-engine/cases*.ts` | `VE-<id>` (unchanged) | 99 |
| `build/fix-eot-cases.ts` | `FT-<id>` | 2 |
| `build/verify-eot-probes/cases.ts` (VERIFY_CASES and VERIFY_TEXTS) | `VT-<id>` | 30 |
| `build/final-cases.ts` (this gate's own fixes) | `FN01`–`FN06` | 6 |

263 cases: 241 with a stored oracle result in `results/`, 22 whole-turn guards (`notEstimated`: the reason and start rows are
checked), 7 with a guarded end of turn (`endNotEstimated`: the moves against the oracle, then the reason), 97 with E2 outcomes.
`REVIEW_REASONS` gives each guard its exact reason (H2's Eject Pack switch-outs, H3's Opportunist, Psychic Noise, Harvest,
Pickup, the spread-heal, one-hit KO and Fling guards, Magic Room before another move) and lifts the verifier's end-of-turn guard
on VE-H1-6 and VE-H1-C2, which the end of turn now follows (fix FG4).

Left out (`REVIEW_LEFT_OUT`, each with its reason):
- RE01: Garchomp does not learn Fissure in Scarlet/Violet (the app's input issue); RE01b covers the one-hit KO move into a Substitute.
- RE21: Assault Vest stops status moves (the app's input issue, `tests/unit/doubles-engine-fixes.test.ts`), and the oracle aborts on its Struggle.
- RE45: the oracle's No-move stand-in is Splash, which Assault Vest stops, so its Snorlax uses Struggle (an oracle artifact); RE45b covers the Trick.
- RT-RV24, RT-RT02: the oracle cannot set them up (Leaf Guard refuses the carried Yawn in sun at prepare); the fact is in `doubles-eot.test.ts`.

Oracle runs: `build/final-review-run.ts <shard> <N>` ran every candidate fresh in the pinned oracle (results in
`build/final-results/`, logs `final-logs/review-*.txt`), `build/final-copy-results.ts` copied the agreeing ones into `results/`,
and a last pass over all 268 candidates on the final code (`final-logs/review-all-final.log`) gives 263 match and the 5 left out.

- **RE70 (Population Bomb into a 30-HP Substitute)** ran in the background: exhaustive, 1 048 986 runs, 2 881 s (48 min);
  **RE71 (Surging Strikes into a Substitute)**: 344 runs, 0.4 s. Both match (`RE70: ready match`, `RE71: ready match`) and equal
  the verifier's 00:10 run of them except the walks' `ms`.
- **RS-RVP1** (four confused, paralysed Pokémon using spread moves; a Monte Carlo case) matched compare.ts with the default 10 000
  samples, but its sampled average (140.87 against the app's exact 140.15) was outside the generated test's 0.5 HP. Rerun with
  `--samples=100000` (1 828 s; Showdown 140.201): it matches both.

## 2. Every oracle case, the earlier cases, the generated test

- compare.ts over every case: `1264/1264 cases match.`; `app-results/` and `results/compare.json` rewritten.
- The earlier 1 001 cases' app results against the snapshot taken before this gate (`build/final-app-results-snapshot-2309/`, the
  last compare.ts write of 2026-10-08 23:09): 952 equal after the moves; 50 E cases differ only in a start row into a carried
  Substitute (FG1); S06a, S07b and S09e-swsh only in a type-immune status hit's kind (FG2); E16g only in the verifier's
  `Assumes Magic Room does not end this turn.`. Their end of turn is equal in all 1 001.
- regress.mjs and app-diff.mjs as in the gate table. app-diff.mjs now classes L1's certain-critical-hit facts (V52: `Wicked Blow
  is always a critical hit.` and the hit rule `critical hits only where certain`) with the byte-equal ones; it was its one
  unexplained difference.
- gen-tests.ts wrote 894 cases (653 before).

## 3. Fixes

### The reviewers' findings (fixers and verifiers; their reports have the detail)

- **Engine (FIX-engine.md, VERIFY-engine.md), status lens:** H1 Berserk / Anger Shell lock (the moves exact; the end of turn now
  exact, FG4); H2/H3/H8/M1/M3 boost events on `World.boosted`, accuracy and evasion included (Eject Pack after Sand Attack and
  Mud-Slap, Haze no event, Defiant's rise for Opportunist, Illuminate in gen 9, `ACCURACY_DROPS`, G-Max Tartness); H4 Mycelium
  Might; H5 Sparkling Aria's cure; H6 Milk Drink's target; H7 Ring Target; M2 Teleport in USUM; M4 Yawn into Comatose; L1
  certain-crit facts; L2 Perish Song failing; L3 sleep and freeze assumption facts.
- **Engine, positions-items-sub lens:** F1 Lansat and Starf at every Update; F2 Berry Juice beside Unnerve; F3 Air Balloon under
  Klutz or Magic Room (1v1 too, golden byte-equal); F4 Assault Vest's input issue.
- **Engine, ui lens:** F1 a Pokémon's own curing ability at the turn's first Update (gen 7 Speed order included); F2 Own Tempo.
- **Engine verifier's nine:** V1 a status move resetting the lock (guarded); V2 White Herb on accuracy and evasion; V3 Punishment,
  Stored Power and Power Trip with those stages (guarded); V4 Clear Smog's reset; V5 Sparkling Aria after a Life Orb faint
  (guarded); V6 USUM Limber order; V7 Lansat and Starf after a damaging hit; V8 a Berry between hits (guarded); V9 the Lansat fact.
- **End of turn and Training (FIX-eot-training.md, VERIFY-eot-training.md):** EOT-1 (guarded by the fixer; now exact, FG3); EOT-2
  Harvest and Pickup guards; EOT-3 the weather, Misty Terrain, Gravity and Magic Room assumption facts (Training: a Magic Room
  ending rollout); Roost's volatile ends at order 25; EOT-4 Future Sight's landing turn in the bridge; EOT-5 pool E, gate 4b by
  Pokémon, Wish and Future Sight in the oracle, the leak's dice-eot, and four Training bugs (Choice lock after Struggle, Syrup
  Bomb's source, Leech Seed's seeder slot, a resolved Wish or Future Sight); EOT-6 end-of-turn Speed and allocation.
- **UI (FIX-ui.md, VERIFY-ui.md):** F1/F2 controls for what the ability cures; F3 no hit count on hits that met a Substitute; F4
  the fainted Pokémon's kept state; F5 the Substitute HP field's error; F6 no KO chance on a card only a status move reached; F7 (a)
  and the verifier's zero-reach hits (b: FG2).

### The final gate's integration fixes (each minimal)

- **FG1, start rows and the Moves pane into a carried Substitute** (VERIFY-ui open item 3; `app/lib/battle/doubles-turn.ts`
  pairRows). A row whose move meets the Substitute (not a sound or bypassing move, no Infiltrator: `meetsSubstitute`) and that
  deals damage or needs a context is not estimated with `{Name} is behind a Substitute.` (its effective name, type, power and
  category kept); a row with no damage stays, since an immunity comes before the Substitute's TryPrimaryHit. Before, the
  not-estimated turn showed `Rock Blast · Tyranitar → Snorlax: 50–155 damage …, 2–5 hits` where Showdown deals at most 124 by
  1–4 hits. Tests: `tests/unit/doubles-final-gate.test.ts` (the start row and its line; Rock Blast and Crunch not estimated,
  Snarl calculated, Earthquake into a Flying type still no damage, no Substitute calculated).
- **FG2, ui F7 (b): a status move refused by a type immunity** (`app/lib/battle/doubles-status.ts` effects/rest). Will-O-Wisp
  into a Fire type, Toxic into a Poison or Steel type, Thunder Wave into an Electric type: the hit is `no-damage` with
  `{Name} is immune.` (sim/pokemon.ts setStatus adds `-immune` for a status move), as Spore into a Grass type is, so the card
  reads `{Name}: no effect`. Test: `doubles-final-gate.test.ts`.
- **FG3, EOT-1 exact** (the EOT fixer's and verifier's need; `doubles-world.ts` `World.weatherSet` with cloneWorld and
  discreteKey, `doubles-turn.ts` walk sets it when an action changes the weather, `doubles-eot.ts` weatherHandler reads a weather
  from before only without it and lastingFact states no assumption for a weather set this turn; the `setAgain` /
  `weatherSetters` guard and `Phase.first` / `setters` are removed). RT-RV01 (Tentacruel 109), VT-VE03, VT-VE04 (the verifier's
  over-guard: a sleeping Sunny Day user), VT-VE05 and VT-VE06 are now exact and match; FN05 and FN06 are new. Tests: the EOT-1
  test in `tests/unit/doubles-eot.test.ts` (now exact, with VE04) and two in `doubles-final-gate.test.ts`; with the flag
  disabled all three fail.
- **FG4, H1's end of turn exact** (the engine fixer's and verifier's need; `doubles-eot.ts`). updateSlot and berryDue do not eat
  a Berserk or Anger Shell holder's healing Berry while `vol.berryLocked` is set (onTryEatItem); `unlock` clears the lock where a
  residual damages the holder (changeHP where the HP falls; Leech Seed's seeded, and the gainer of a Liquid Ooze drain): onDamage
  with a non-move effect sets checkedBerserk (Champions' mod drops only the Sheer Force clause). `lockedBerryGuard` is no longer
  called for the end of turn (it stays for a later hit and for a status move that resets the lock in the moves). RS-RV01,
  RS-RV02, VE-H1-6 and VE-H1-C2 now match after the whole turn; FN01 (sand, SwSh), FN02 (poison), FN03 (Leech Seed) eat the
  Sitrus after the residual, FN04 (Grassy Terrain's heal) keeps it. Negative checks: without `unlock` FN01–FN03 fail; without the
  Update check RS-RV01, RS-RV02 and FN04 fail. Tests updated in `doubles-engine-fixes.test.ts` (H1) and
  `doubles-engine-verify.test.ts` (VE-H1-6), two added in `doubles-final-gate.test.ts`.
- **FG5, the oracle harness** (Track D's). `compare.ts`: E2 after the moves no longer expects a carried Yawn (decided for
  `outcomeMon`: after the moves E2 lists what the next turn reads, which Training's postFromOutcome projects forward; the carried
  Yawn resolves at this turn's end; VE07 and VE10); E2 now compares the status mixture of a Pokémon that never faints; a
  residual that gives a status (an Orb's, Yawn's sleep) is now required and its status fact compared (status-only residuals
  passed silently before; FT-FX01 and FT-FX02 are E2 cases and match). `gen-tests.ts`: an E2 row of a case whose end of turn is
  not estimated reads the oracle's state after the moves (it read the state after the turn: RT-RV21, RT-RV22, VT-VE10, VT-VE11,
  VT-VE18 failed in the generated test), the same Yawn convention, and the E2 status mixture of a Pokémon that never faints
  (527 rows; brn, psn, tox and slp among them). `app-diff.mjs`: L1's facts (above). All 1 001 earlier cases still match under
  the stronger checks.
- New files: `2v2/verify/cases-review.ts`, `build/final-cases.ts`, `build/final-review-run.ts`, `build/final-copy-results.ts`,
  `build/final-count.ts`, `tests/unit/doubles-final-gate.test.ts` (7 tests).

## 4. Still open

- **Eval: `Reads you − Plays safe, both vs HabitBot`** fails on this run's seeds (2.8 pts) and on main 0ccce76 with the same seeds
  (2.5 pts); the gate follows the seed sample (INTEGRATION.md and FIX-eot-training.md have the earlier same-seed runs: 9.0 / 8.0
  on Track B's seeds, 2.3 / 4.3 on `fixes`). Not a branch regression; the gate's threshold is near its sampling spread.
- The belief-update p95 that failed the fixer's and the integration's runs passes on this quiet run (open 6.17 ms).
- H1: the lock is not carried to the next turn (E2 and Training); a status move that resets the lock during the moves stays a
  guard (VE-H1-1…4, VE-H1-C1); the verifier's rare Unnerve chain and a Magic Room ending with the lock up.
- EOT-2: Harvest and Pickup stay guarded; the oracle's `CHANCE_EFFECTS` has no `harvest` (only guarded cases use it).
- Guards that stay (narrow, each with a fact reason): Eject Pack's mid-turn switch (the replacement is not known), Opportunist and
  Mirror Herb copying a rise, Psychic Noise before a seeder's drain, a Starf eaten by the attacker inside the pairwise engine,
  the spread heal (Matcha Gotcha, Shell Bell), Fling, one-hit KO moves, accuracy or evasion stages for Punishment and its kin.
- doubles-eot.ts's White Herb residual reads Attack to Speed only (it matters only for a drop made while items did not work), and
  its end-of-turn Lansat sets `focusEnergy` (text only).
- A Trace user that copies a curing ability is not cured at the turn's start in the engine or the UI (pinned Showdown cures it).
- A Ghost type's Curse: its user's half-HP cost is a step fact, so the user's card shows no KO chance (recording it as a reached
  hit would contradict compare.ts's status-hit reach, where Showdown has no hit on the user).
- canStatus checks Comatose before the type immunity (Showdown runs runStatusImmunity first); only the fact text could differ, and
  no Comatose species has an immune type.
- compare.ts does not project a perish count after the moves (E2 with the end of turn not estimated; no case has one).
- ui F8: left/right wording that predates this build (the user's naming pass).
