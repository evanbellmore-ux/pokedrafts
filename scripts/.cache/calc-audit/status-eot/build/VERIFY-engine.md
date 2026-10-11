# Independent check of the engine fixes (status-eot review)

Branch `calc-2v2-status-eot`, uncommitted working tree. Ground truth: pinned Showdown c23d2e94 through the 2v2 oracle
(`2v2/verify/sim-dfs.ts`), compared with `compare.ts compareCase`. Nothing was committed, pushed or switched. `next build`
was not run. Nothing touched live Supabase. `.claude/` and `node_modules` were left alone. I edited only the engine
fixer's files (listed below) and my own test and probe files.

## Verdict

- All 22 listed findings reproduce as fixed (or guarded, as the fixer said) against pinned Showdown.
- Probing around those fixes found **9 more gaps**. I fixed all 9. Each one has an oracle case and a unit test.

| # | Near | What was wrong (oracle vs app before my change) | Now |
|---|---|---|---|
| V1 | status H1 | A status move that reaches a locked Berserk or Anger Shell holder runs AfterMoveSecondary, which resets the lock; the action's last Update then eats the Sitrus Berry. The app kept it. VE-H1-1, Spore: Showdown 80–102 (avg 86.87), app 63–80 (avg 74.99). The same happened with Pain Split, a Trick'd Sitrus and USUM Thunder Wave on Drampa (VE-H1-2/3/4). | guard |
| V2 | H2, H8 | White Herb ignored accuracy and evasion drops (data/items.ts whiteherb onStart reads every stage). The app kept the White Herb after Sand Attack and after Mud-Slap, a Disguise hit included (VE-H2-9, VE-H2-10, VE-H8-5). With Unburden the turn order was also wrong: in VE-H2-11 Showdown's Hitmonlee knocks Gengar out before it moves, and the app had Gengar move. | exact |
| V3 | H2, H8 | Punishment, Stored Power and Power Trip count accuracy and evasion stages. The app never stored those stages. VE-H2-12 (USUM, Double Team then Punishment): Showdown 79–94, app 60–72. | guard |
| V4 | M1 | Clear Smog's clearBoosts makes no boost event. The app saw the +1 going to 0 as a drop, so it set off Eject Pack and returned "Snorlax switches out" (VE-M1-1, VE-M1-2). | exact |
| V5 | H5 | When Life Orb knocks out a Sparkling Aria user, the faint is processed after AfterMove, so Showdown still cures the burn. The app did not cure it, and its end of turn kept a −14 burn (VE-H5-6). | guard |
| V6 | ui F1 | USUM, paralysed Limber Hitmonlee against Venusaur. The oracle's SetStatus never lets the paralysis land, so the order uses full Speed and Hitmonlee moves first: own-left 55–67, Venusaur 30–45. The app froze generation 7's order at the paralysed Speed: Venusaur first, 77–85 (VE-UI-1). | exact |
| V7 | F1 | The target's own Lansat or Starf Berry, after a damaging hit it survives. The app ate a Lansat Berry only at the end of turn, too late for the holder's own later move. VE-L1-1: Showdown's Night Slash is a critical hit for 43–51, the app had 29–34 and "no critical hits". The app never ate a Starf Berry here. VE-F1-6: Showdown's Garchomp ends at 54–128 (avg 111.24), the app's at 117–128 (avg 122.88). | exact |
| V8 | F1 | A Starf, Ganlon or Apicot Berry (or a Cheek Pouch Lansat) eaten between two hits of one move: the later hits read the new Defense. VE-F1-10, Starf: KO chance 0.12 in Showdown, 0.15 in the app. VE-F1-13, Ganlon: 0 and 0.15. The Ganlon part is already on main. | guard |
| V9 | F1, L1 | The kernel recorded a Lansat Berry it ate as the move's Focus Energy (`focusEnergy`), though types.ts keeps Lansat on `settledFocusEnergy`. The certain-crit fact then read "Focus Energy" where it should read "the Lansat Berry". | exact |

Guard wording, as the fixer's guards: one-line fact reasons (REASONS):
- `berryLocked` (existing): `Sitrus Berry after a confusion self-hit with Anger Shell is not modelled in 2v2.`
- `hiddenStages` (new): `Punishment with Jolteon's accuracy or evasion stage from this turn is not modelled in 2v2.`
- `ariaFaint` (new): `Sparkling Aria's burn cure after Primarina faints in the move is not modelled in 2v2.`
- `berryBetweenHits` (new): `Starf Berry between the hits of Bullet Seed is not modelled in 2v2.`

## Changes

### Files (all from the engine fixer's list)

- `app/lib/battle/doubles-status.ts`
  - `hitOne`: after a status move's effects on a locked holder, it calls `kernel.lockedBerryGuard` (V1).
  - `applyBoosts`:
    - accuracy and evasion are stored as this turn's stages (`MoveVolatiles.stages`) and capped from them;
    - White Herb fires on, and restores, any stage below 0 (V2, V3).
  - Haze clears the stored stages.
  - `ownCuresAtStart` is split out of `turnStartUpdate`. It holds the own-ability part and changes nothing else (V6).
  - `ateFacts` reads `settledFocusEnergy` (V9).
- `app/lib/battle/doubles-turn.ts`
  - New kernel member `lockedBerryGuard` (V1).
  - New `hiddenStageGuard`, called by `searchFor` for every pair calculation (V3).
  - `afterHit`: Clear Smog clears the stored stages and marks `World.boosted[target].reset`. `eventGuards` then counts no stage-difference drop for that Pokémon (V4).
  - `sparklingAria`: a user that fainted while holding a working Life Orb, with a burned target it would cure, is not estimated (V5).
  - `rootWorlds`: generation 7 runs `ownCuresAtStart` before freezing its order (V6).
  - `applyStep`:
    - eats the target's Lansat or Starf through `berryDue` after the hit (V7);
    - `berryBetweenHitsGuard` (V8).
  - `ateBerry`: Lansat sets `settledFocusEnergy` (V9).
- `app/lib/battle/doubles-world.ts`: `MoveVolatiles.stages`, and `World.boosted`'s `reset` flag.
- `app/lib/battle/doubles-actions.ts`: `REASONS.hiddenStages`, `REASONS.ariaFaint`, `REASONS.berryBetweenHits`.
- `app/lib/battle/doubles-items.ts`: a received White Herb also reads the stored accuracy and evasion stages. It is used at once (sim/pokemon.ts setItem runs its Start; VE-ST-5).

### Tests

- New `tests/unit/doubles-engine-verify.test.ts`, 13 tests. The numbers are the oracle's.
- New oracle cases in `scripts/.cache/calc-audit/status-eot/verify-engine/`:
  - cases: `cases.ts`, `cases2.ts`, `cases3.ts`, `cases4.ts` (99 cases);
  - runner: `run.ts`;
  - probes: `log-probe.ts`, `facts-probe.ts`, `outcome-probe.ts`, `crit-probe.ts`, `re45-probe.ts`;
  - case-picking helpers: `learners.ts`, `holders.ts`.

## Each listed finding, re-run

The reviewer runners were re-run after my last change.

- `review/status-move/run.ts`: 28/34, the same six as the fixer's (RV01, RV02, RV03, RV03b, RV05, RV17b).
- `review/track-e/run.ts --reuse`: 49 match. The other 7: RE01, RE01b, RE04, RE05, RE21, RE43, RE45.
- `fix-engine/run.ts`: 12/12.

| Finding | Re-run | Neighbourhood probed (verify-engine ids) | Result |
|---|---|---|---|
| H1 | RV01/RV02: the moves equal Showdown; the end of turn is guarded. | VE-H1-1..7, VE-H1-C1/C2 (Champions), Neutralizing Gas (VE-H1-5 matches) | **V1** fixed |
| H2 | RV03/RV03b/RV17b: switch-out reason; the oracle cannot run a mid-turn switch. | Keen Eye, Contrary, Mirror Armor, Magic Room, Sweet Scent (Trick Room), Kinesis (USUM), SwSh Smokescreen into Illuminate, White Herb | all match; **V2**, **V3** fixed |
| H3 | RV05 guarded | +6 Swords Dance (no rise: VE-H3-1 ready, matches); Double Team with Opportunist (guarded) | ok |
| H4 | RV12/RV12b match | Magic Bounce, Overcoat, Ability Shield, Sweet Veil ally, Grass powder immunity | all match |
| H5 | RV13/RV13b match | Storm Drain absorbing (one hit target), Covert Cloak alone and beside another target, burned ally, USUM through a Substitute, Life Orb faint | **V5** fixed; the rest match |
| H6 | RV15/RV15b match | Substitute ally, ally at full HP, aimed at itself after its ally fainted | match. Aiming at an empty position is an input issue in the app, so not compared. |
| H7 | RV19 matches | Magic Room, USUM Normalize into Ghost with and without Ring Target, SwSh Gastrodon | all match |
| H8 | RV17 matches | Sheer Force (Landorus), Covert Cloak, SwSh Bisharp, USUM Competitive, Disguise + White Herb, Mold Breaker / Clear Body + Eject Pack, SwSh Mirror Armor | **V2** fixed; the rest match |
| M1 | RV04 matches | Clear Smog (+1 Eject Pack, later and last), Spectral Thief (SwSh, Trick Room), Clear Smog then Lash Out | **V4** fixed |
| M2 | RV11/RV11b match | SwSh Teleport (switch, end of turn not estimated); USUM with no Pokémon to switch in | ok |
| M3 | RV06 matches | SwSh Smokescreen (no TryBoost), Champions Mud-Slap | match |
| M4 | RV07 matches | USUM Komala, a target already asleep, Insomnia, Electric Terrain | all match |
| L1 | RV10* match | Lansat eaten mid-turn, then Super Luck Night Slash (VE-L1-1); SwSh Wicked Blow | **V7**, **V9** fixed |
| L2 | FX07 matches | Soundproof block counts as a result (VE-L2-1); one new count | match |
| L3 | — | No-move sleeper with and without a carried count, with Chesto, Insomnia; Champions freeze (facts-probe.ts) | Facts appear only where the count is assumed, as designed. |
| F1 | RE60–RE63, RE87, RE88 match | target Starf / Lansat after a hit, Gluttony, Ripen via Trick, Lansat after a self-hit, Starf at all +6, Unnerve attacker, multi-hit, Cheek Pouch, spread, attacker's Lansat / Starf after Rough Skin | **V7**, **V8** fixed. VE-F1-5 (all +6) now matches as well. |
| F2 | RE64-swsh, RE64b-swsh match | USUM self-hit with Unnerve, SwSh Pain Split | match |
| F3 | RE80/81/85/86 match | Magic Room Earthquake; a control where the balloon pops. `fix-engine/balloon-1v1.ts` re-run: Showdown keeps the balloon, app 1v1 84–98. | match |
| F4 | RE21: input issue; the oracle aborts too | Klutz Golurk's Curse (oracle accepts, app ready, match) | ok. A Magic Room Trick cannot be checked: the oracle makes its request before Magic Room is set. |
| ui F1/F2 | `review/ui/impossible-states.ts`: all 6 rows equal Showdown | USUM and SV Limber against Venusaur; Neutralizing Gas; SwSh Pastel Veil; Thermal Exchange; USUM Water Bubble; Own Tempo under the gas; Insomnia + Chesto; Vital Spirit + Lum + confusion; Ability Shield under the gas; Magma Armor; SwSh Limber + Lum | **V6** fixed; the rest match |

### Notes on the fixer's report

- **RE45 is not a stale oracle file.** I regenerated it, and it still differs. The cause is the oracle's stand-in for No move: it uses Splash, and Assault Vest disables Splash, so in Showdown Snorlax Struggles into Smeargle (`re45-probe.ts`). This is the oracle's No-move convention, not an app error.
- **FX02b's `checks` text is wrong.** It says "Venusaur moves first". In fact the oracle's prepared state has the Lum Berry already eaten and no status, so Garchomp moves first. The app agrees, and the case matches.
- The 2v2 reason `Starf Berry raises a random stat` has no final period, unlike every REASONS text. This is already on main (`tests/unit/doubles-turn-guards.test.ts`), so I left it.

## Gates (after my last change)

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` on the 5 changed engine files and the new test | clean |
| `vitest --config vitest.unit.config.ts`, 30 engine test files by path: `doubles-*` (the new file, 13 tests, included), `hit-loop-substitute`, `uses-to-ko-turn-part`, `calculator-uses-to-ko*`, `calculator-bug-bite`, `calculator-target-berry` | 30 passed, 1 376 tests |
| the same config: `training-*`, `calculator-doubles-*`, `residuals` | 60 files, 722 tests. Run beside conformance, `training-saved-flow` failed once on timing (1.4 s); alone it passes. |
| `vitest --config vitest.battle-data.config.ts` | 8 passed, 133 tests |
| `golden-1v1.ts --check` | 254 cases byte-equal |
| `compare.ts` (all oracle cases) | 1001/1001 |
| `verify-engine/run.ts` (all cases) | 99/99: oracle match, or the stated guard reason |
| `fix-engine/run.ts` | 12/12 |
| `bench.ts` | p50 3.4 ms, p95 7.8 ms, max 22.5 ms; Moves pane max 23.6 ms (run beside conformance); reference 30/30 |
| `npm run conformance:training` | every gate PASS: 1 840/840; 2a 297/297; 2b 100%; 2c 289/289; 3 288/288; 4a 0 over 400; 4b 56527/56527; 5 33.7/35.0/25.1%; 6 23737/23785; 7 0; 8 657 passed; 9a 30/30; 9b 30/30; runner errors 0. The second run, on the final code (7 min 57 s), has the same results (9b's largest record 50 KB). |

The first track-e run left out `--reuse`. It rewrote the reviewer's `review/track-e/results/*.oracle.json` and `*.app.json` up to RE64-swsh. Those files are the same pinned oracle re-run; RE45's file now carries the Struggle explained above.

## Left open (rare; noted, not changed)

- **H1, rare chain.** A locked holder whose Berry a foe's Unnerve stops, then a status move hits it (Showdown resets the lock), then the Unnerve holder faints later in the turn. `unnerveEnds` still keeps the Berry.
- **H1 lock under Magic Room.** With the lock up and Magic Room ending in the residuals, `lockedBerryGuard` returns early while items do not work.
- **doubles-eot.ts (Track B, not my file):**
  - its White Herb residual (order 29) reads atk..spe only, not `MoveVolatiles.stages`. That matters only for a White Herb kept while items did not work.
  - its end-of-turn Lansat sets `focusEnergy`, not `settledFocusEnergy`. Text only.
- **UI fixer's file.** `doubles-prep.ts carriedOptions` now returns `confusion: false` for an Own Tempo Pokémon (impossible-states.ts output). The user said: "Do not remove the Battle states that cannot be set here I will be fixing those later." The engine cures it at the first Update either way.
