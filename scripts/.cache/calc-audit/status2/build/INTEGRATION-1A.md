# Integration 1a (status2, ADDENDUM2 §8.4)

The 14 wave-1a tracks merged into this tree in the order A1, A2, A3, D, F, N, H, S, W, E1, then T1, U1, NU, V1, with every
`needsFromOthers` and `needsFromIntegrator` item resolved. Every case was then run against pinned Showdown c23d2e94 and the app,
and the gates were run. "main" means 4008ee8: the scratch `headtree`, with the app run through `TSX_TSCONFIG_PATH`.

## Status

- **Branch:** `calc-2v2-status-2`, checked before the work and again before this report.
- **What did not happen:** nothing was committed, pushed or switched. `.claude/` and `node_modules` were not touched. No
  `next build` ran, and nothing ran against live Supabase. No CastMirror or RaidCard file was opened.
- **Line endings:** each file kept the line endings it had (`int1a/apply.py`). Six CRLF files were briefly written as LF by the
  first patches; they were restored against the pre-merge snapshot (`int1a/eol.py`).

Every patch is a script in `build/int1a/`. Each applies exact single-match replacements, so it either applies once or stops.
The scripts serve as the record; the tables below name them.

## 1. The merge

### Track lines (the asks, in merge order)

| Track | What went in | Script |
|---|---|---|
| A1 | `outcomeOf` merges `abilityHooks.outcomeMon` (volatiles, `build`, fields); `conditions` pushes `abilityHooks.conditions`; `afterHit` wires `trapAfterHit` for Jaw Lock and Thousand Waves, and for Anchor Shot and Spirit Shackle when the secondary lands; the L branch is `notModelled(move)`; `applyBoosts` takes `herb?: false` | by hand (one `outcomeOf` / `conditionFacts` edit for all tracks), `lint1.py` |
| A2 | P1 (Electrify and Ion Deluge give `context.retype`); P2 (status-move redirection by the use's type, so the `ateRedirectGuard` call goes); P3 (`conversion2` in readsLastMove); P4 / P5 (typing conditions and outcome volatiles); P6 (`powderTryMove`); P7 (Heal Block absorb is `noDamage`); P9 (`itemWorks` for Eject Button / Red Card; no order item while `itemSuppressed`; a carried Embargo lets an Assault Vest holder use a status move); P10 (validate drops the used-Protean issue); P11 (`getStabMod` wrapper + `proteanSpent`) | `a2.py` |
| A3 | I1 (Mat Block against an ally's move); I2 (`conditionsFor` with `target !== attacker`); I3 (`useCalled` passes `snatched` / `bounced`); I4 (Protean skips a snatched or bounced use); I5 (`GAS_CHANGING_MOVES`, below); I6 (the snatched-Swallow guard goes, since A1's Swallow reads `use.snatched`); A2's Gravity start (`gravityGrounds`) and H's Teatime user in `doubles-field.ts` | `a3.py`, `a3-others.py` |
| D | `outcomeOf` emits `stages`, `berryLocked` and `glaiverush`; `execute` runs `guardHooks.encoreRewrites` and every rewrite world (`executeUsed`); one-hit KO moves are a fixed hit of the target's maximum HP in the turn (ask 1, with F's `calculate.ts` row: `ohko.py`); Berserk's +1 Sp. Atk (ask 3: `berserk.py`); REASONS `hiddenStages`, `hiddenStagesEarlier`, `spreadHeal` and `takesDouble` removed | `d.py`, `ohko.py`, `berserk.py` |
| F | The Spicy Spray `attackerSide.safeguard` line in `calculate.ts`; the docs' Fling bullet; the golden rows are F's (§3) | `w.py`, `docs.py` |
| N | N-1 (Destiny Bond's prepare check runs before Protean, `sim/battle-actions.ts:590-592`); N-2 (the redirect tie by the oldest ability state, `entryTie`); N-4 (Quick Guard and Wide Guard call `stallRaise`); N-5 (Protean inside the stall roll's pass loop and before the snatch line); N-3 is A2's P10 | `n.py` |
| H | I1–I4 and I6 (`hiddenHooks.beforeMove`, `skyDropHit`, the faint hook); I7 (`twoturnmove` in `outcomeOf`); Sky Drop's guard, `PENDING_MOVES` and `REASONS.semiInvulnerable` removed | `h.mjs`, `h2.py` |
| S | The kernel's `afterHit` member; `confusionHit` returns `faceHooks.selfHit`'s worlds; the `doubles-spread.ts` lines (a Substitute's Mind Blown cost and a face's retaliation join the user's first loss) in both `spreadStep` and D's `drainingStep`; the hooks test row `faceOnce`; the three `it.fails` flipped; `REASONS.faceMultiHit`, `FACE_REACTIVE_ITEMS`, `FACE_UNSAFE_MOVES` and `REASONS.faceSelfHit` removed | `s.mjs`, `s-spread.py`, `dead-sites.py` |
| W | L1–L4, L6–L12 and every `WIRED` flag set to true; `userLosses` in `spreadStep`; REASONS `allyEffect`, `focusBand` and `ariaFaint` removed (`berryBetweenHits` kept, as W asked) | `w.py`, `s-spread.py`, `dead-sites.py` |
| E1 | `doubles-start.ts`: at the turn's first Update the settle reads a carried Embargo (`itemSuppressed`) and a carried Heal Block (a healing Berry fails TryEatItem); `itemOn` excludes an embargoed item; Mental Herb with Embargo; the end of turn's boosts pass `herb: false`; `doubles-residuals.test.ts` CLASSES; the `copierEndOfTurn` hooks row removed | `e1-u1.py`, `tests-hooks.py` |
| T1 | `model.ts`: a used Protean or Libero with its types given is valid (1v1 never sets types, so it is unchanged) | `t1.py` |
| U1 | `useDoublesCalculation.ts` passes each slot's history and `withTurnEarlier`; `copiedIntimidateStored` in `doubles-start.ts`, with the include tests in `calculate.ts` and `roster-prep.ts`; the docs checked against what 1a landed | `ui-calc.py`, `e1-u1.py`, `docs3.py` |
| NU | `doubles-prep.ts` calls the reset rules (`clearSlotEarlier`, `reconcileEarlier`, `afterDoublesAction`; choosing a move ends Switched in); `EarlierFieldFields` in two fieldsets; the 2v2 note lists `unmodelledDoublesStates`; `describeDoublesConditions` and `DoublesSettings` count the earlier-turn toggles; `EarlierTurnContext.Provider`; the card's Switched in choice (`.doublesQuickMovesRow`) | `ui-prep.py`, `ui-conditions.py`, `ui-card.py` |
| V1 | `compare.ts` and `gen-tests.ts` conventions (below); `cases-int1a.ts`; its needsFromIntegrator 3 (the charge release) and 4 (battle over) as integrator fixes | `v-compare1..5.py`, `v-gentests.py` |

### The integrator's own one-line changes (ADDENDUM2 §8.4 step 1)

- `status-table.ts` is regenerated. `block`, `meanlook` and `spiderweb` now get `handler: "trap"`.
- `GAS_CHANGING_MOVES` drops `bestow`, `corrosivegas`, `embargo` and `magicroom`.
- `gasShieldGuard` (`gas.py`) also stops the turn in two cases, both read by `REASONS.gasShield`:
  - a suppressed slot whose Ability Shield works is in play: not under Magic Room, and not `itemSuppressed`;
  - a shielded Pokémon gets `itemSuppressed` (pinned `hasItem` → `ignoringItem`).
- **REASONS removed** (ADDENDUM2 §2.4, each whose last site went in 1a):
  - `notModelledBefore`, `groundingChange`, `hiddenStages`, `hiddenStagesEarlier`, `allyEffect`;
  - `spreadHeal`, `faceMultiHit`, `semiInvulnerable`, `typeChange`, `takesDouble`;
  - `faceSelfHit`, `focusBand`, `ariaFaint`.
- **§2.4 sets:** removed `PENDING_MOVES`, `FACE_REACTIVE_ITEMS` and `FACE_UNSAFE_MOVES`.
  - `TRACKS_TARGET_MOVES` gains `skydrop`.
  - `HP_STATUS_MOVES` = `kindOf("P")`.
- **`dead-sites.py`** removes the last three keys and the last set. Each of their sites was unreachable in this tree:
  - `selfHitBand` always gets its distribution (W's L6);
  - `ariaFaint`'s guard read `WIRED.faintedInHits`;
  - `faceHooks.selfHit` is called only with the action (S's line 2);
  - `faceOnce`'s `FACE_UNSAFE_MOVES` guard ran only without the kernel's `afterHit`.
  - `dead-sites2.py` drops `OWN_RULE_MOVES`, which only that guard read.
- `status2-hooks.test.ts` (`tests-hooks.py`):
  - removed guard rows: `ateRedirectGuard`, `copierEndOfTurn`, the L branch's `beforeFieldMove`, `skyDrop`;
  - new call-site rows: A1, A2, A3, D, H, S and W.

### Fixes the integration needed (beyond the asks)

| Fix | Why (pinned source) | Cases | Script |
|---|---|---|---|
| A Pickup can take an item the start settle ate at the turn's first Update (HP, pinch or curing Berry; a Custap Berry as its move is chosen): `usedItem` set. A Terrain Seed used on entry is not this turn's | `eatItem`: `usedItemThisTurn` | G4-PKP-01-sv, -05-champions | `start-used.py` |
| A terrain, Gravity or Magic Room the input says ends this turn (`fieldTurns` 1, NU's controls) is wave 1b's (E2): until then the end of turn is `{X} ending is not modelled in 2v2.`, rather than keeping the effect up. Also, `roomFact`'s White Herb reads the accuracy and evasion stages too | E1's White Herb at 29 | G4-WHR-01-sv | `eot-fieldturns.py` |
| A two-turn move charged last turn is released with no charge of its own (`MoveContext.released`). Its Power Herb is not used, and Meteor Beam and Electro Shot add no rise, so the input stage is lowered first, since @smogon/calc adds the +1 inside | `items.ts powerherb onChargeMove`; `moves.ts meteorbeam onTryMove` | IN-CHG-02-sv, IN-CHG-03-champions (V1's ask 3) | `release.py` |
| Once the battle is over, a fainted Pokémon's queued action gets the skip fact `Faints before it moves.` (no `faintsBeforeMoving` bump, as the oracle has it) | `battle.ts` runAction after the end | IN-NBL-01-sv (V1's ask 4) | `nbl.py` |
| One-hit KO moves in the turn: a fixed hit of `defender.maxHP()`, then the Damage events (Focus Sash, Endure, Focus Band, Substitute, Disguise). 1v1 keeps `One-hit KO move: no damage range.` | `battle-actions.ts getDamage`: `if (move.ohko) return target.maxhp` | G4-OHK-01/03/05..09, RE01b | `ohko.py` |
| Berserk's +1 Sp. Atk when a hit takes its holder to half or less (not after a Sheer Force move with secondaries), with the healing Berry held until that check. Turn mode only | `abilities.ts berserk onAfterMoveSecondary`, `onTryEatItem` | G4-BZK-01/02/04/05 | `berserk.py` |
| Struggle's recoil is `directDamage`: it sets no `hurtThisTurn` (Assurance is not doubled) and runs no Damage event. A locked user's recoil is not estimated (`combo`) | `battle-actions.ts:1388-1389`; `battle.ts:2138` | INT-STR-01-sv, -02-sv | `struggle.py` |
| An Encore that rewrites the queued move to a random target runs every rewrite world | `onOverrideAction` + `getRandomTarget` | G4-ENC-01-sv (numbers; turnsLeft is E2's, §2) | by hand (`execute` / `executeUsed`) |

**Case data fixed:**
- G4-PKP-03 gets `silentStatus`.
- G4-WHR-01 gets `endNotEstimated` (Magic Room ending).
- VG39 gets the `gasShield` reason (status2-removed.ts).
- `changed-cases.ts` learned two rules: A2's `Type:` condition and E2's `berryLocked`.
- The integrator's own lines have new cases in `cases-int1a.ts` (wired into `cases-wave1a.ts`):
  - INT-STR-01-sv, -02-sv;
  - INT-TRP-01-usum, -02-usum, -03-swsh, -04-usum;
  - INT-GAS-02-sv.
- INT-GAS-01 was dropped: no game has Corrosive Gas, Neutralizing Gas and an Ability Shield together.

**Harness conventions (V1's files, from the tracks' asks):**
- `compare.ts`:
  - residual chances are summed per source;
  - an Encore rewrite is compared as the move used;
  - a Disguise confusion self-hit is its own skip fact, with no range;
  - a No-move self-hit whose HP delta the oracle caps is checked by its chance;
  - a Berry eaten between two hits uses the covering rule of `truncated`;
  - E2's stage mixture counts only the living share, since Showdown clears a fainted Pokémon's stages.
- `gen-tests.ts` mirrors the last three.

**Tests updated to what 1a models:**
- doubles-turn-guards, doubles-engine-verify, doubles-outcomes (reads `CASES_1..n` and builds the generated file's inputs),
  doubles-status, doubles-status-moves, doubles-residuals, doubles-stats-abilities, doubles-faces, doubles-history,
  doubles-typing.
- doubles-turn-fixes, doubles-engine-fixes, status2-step1, doubles-start-rows, doubles-guards-misc, doubles-items (T10c).
- calculator-bug-bite, calculator-ngas-2v2 (+ -verify), calculator-max-fling, calculator-doubles-shared.
- status2-hooks.

## 2. The oracle

- **Every case, `STATUS2_REEXPECT=1a`.** Command:
  `STATUS2_REEXPECT=1a npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts`. The results are stored in
  `results/compare.json` and `app-results/`. Output:
  ```
  1928/1939 cases match.
  ```
- **`changed-cases.ts diff`** (without `STATUS2_REEXPECT`, base = the 02:50 `app-results`):
  ```
  1939 cases: 1078 unchanged, 250 stored cases changed, 11 failing the gate.
  ```
  - 0 changed stored cases are NOT LISTED.
  - The 11 that fail are the 11 new wave-1a cases below.
- **`gen-tests.ts --keep=int1a/emitted-ids-1a-before.txt`:**
  ```
  wrote 1588 cases to C:\Users\evanb\OneDrive\pokedrafts\tests\unit\doubles-turn-showdown.test.ts (11 cases that do not agree with the app left out)
  ```

The 11 cases still open (each is a 1b track's, or a narrow reason that 1a keeps):

| Case | App | Showdown | Owner |
|---|---|---|---|
| CR-08a-sv, CR-08b-sv, CR-08c-sv, G4-OPP-07-sv | `Opportunist copying a stat rise is not modelled in 2v2.` | ready | ST (1b) |
| SAT-IMP-1-sv, SAT-IMP-1-swsh | `Imposter is not modelled in 2v2.` | ready | ST (1b) |
| G4-STF-02-usum | `Starf Berry raises a random stat` | ready | ST / E2 (1b) |
| G4-FLG-09-sv | `Symbiosis is not modelled in 2v2.` | ready | D's guard (Symbiosis passing an item on: 1b) |
| G4-LMV-01-champions, G4-LMV-02-sv, G4-ENC-01-sv | ready | E2 `opponent-right turnsLeft.encore 2`: expected 1, got 0 | E2 (1b: Taunt / Encore / Disable turns left) |

## 3. Gates

- **`npm run check`** (lint, typecheck, unit tests; the run before `dead-sites.py`; the last run is under `leak:training` below):
  ```
   Test Files  248 passed (248)
        Tests  7003 passed | 1 skipped (7004)
  ```
- **`npm run test:battle-data:source`:**
  ```
   Test Files  10 passed (10)
        Tests  149 passed (149)
  ```
- **golden-1v1.**
  - `golden-1v1.ts --check`, against the golden F regenerated:
    ```
    golden-1v1: 254 cases byte-equal (2990 ms)
    ```
  - Against the golden from before 1a (`GOLDEN_BEFORE=fling/golden-before/golden-1v1.full.json.gz fling/golden-diff.ts`):
    ```
    110 Fling rows changed; 0 other differences
    ```
    These are the same 110 ids, with the same rows, as F's `fling/golden-changed.json`.
- **Bench** (`int1a/bench.sh`, 4 alternating rounds over the stored cases, main through `TSX_TSCONFIG_PATH`; `int1a/bench.log`):
  ```
  benchH-4 turn p50 2.66 p95 6.20 max 131.2 | moves p50 10.21 | statuses {"ready":1397,"not-estimated":134,"issues":4} | reference 30/30
  benchC-4 turn p50 2.99 p95 6.87 max 137.1 | moves p50 11.23 | statuses {"ready":1454,"not-estimated":77,"issues":4} | reference 30/30
  paired ready turns 1397: main p50 2.82 p95 6.30 | now p50 3.01 p95 6.92 | per-turn ratio median 1.093 p90 1.410
  newly ready 57: p50 3.71 max 22.5 ms
  moves pane p50 main 10.21 now 11.23; max now 17.7
  ```
  - Over the turns both trees calculate, the median per-turn cost is +9 %: p50 +7 %, p95 +10 %.
  - Across the four rounds the turn p50 is 2.58–2.66 ms on main and 2.92–3.02 ms on this tree.
  - The worst turn is 132–150 ms on main and 137–164 ms on this tree.
  - Reference mode is 30/30 in every run.
  - 57 turns that main gives up on are calculated now.
- **`eval:training --gates --scale 1 --shards 8`**, run as `--run s1-step1` so it uses the same seeds as main's results.
  This run's directory is `scripts/.cache/training/eval/int1a-s1seeds`, and Step 1's `s1-step1` was put back. Result:
  20 PASS and 2 FAIL, the same two that fail on main.
  ```
  | Reads you − Plays safe, both vs HabitBot | ≥ +5 points (same seeds) | 2.8 pts [-1.4, 6.9] n=400 | FAIL |
  | A1.4 status moves used (pool U) | ... | chosen turns {"tailwind":44,"trickroom":13,"followme":2} of usable turns {"tailwind":190,"trickroom":51,"followme":36,"ragepowder":3} | FAIL |
  | Turn decision time (Node, worst run) | p50 ≤ 400, p95 ≤ 800, max ≤ 2,000 ms | p50 303 ms p95 675 ms max 1837 ms (n=16056) | PASS |
  | Cell methods on pool S (soft) | engine + prelude ≥ 80% | 96.9% of 23340 | PASS |
  ```
  The same rows on main, same seeds:
  - HabitBot: `4.0 pts [-0.1, 8.1]`.
  - A1.4: `{"tailwind":43,"trickroom":14,"followme":2}`, with Rage Powder usable on 3 turns and never chosen in either tree.
  - Decision time: `p50 274 ms p95 577 ms max 1181 ms`.
  - Pool S: `88.5% of 23175`.

  The other rows on this tree:
  - Legality: 0 errors, 0 engine issues, 0 fallbacks, 0 capped.
  - Win rates: vs RandomLegal 99.0 %; vs MaxDamage 63.2 % (main 64.3 %); Reads vs MaxDamage 72.3 % (main 72.0 %).
  - Self-play 49.0 %; closed team sheets 99.0 %; open vs perfect −4.0 points.
  - Preview / replacement 71 ms / 8.79 ms; belief closed 18 ms, open 7.69 ms.
  - Budget 240 / 160 / 4; dropped 0; exploitability 0.01 %; determinism 20/20; the A1.5 rows pass.

  The decision-time max is §4's first open item.
- **`conformance:training`:** every gated row passes.
  - Tracker parity 840/840; belief 297/297; requests 100 % / 100 %.
  - Bridge: 0 mismatches over 400 Pokémon.
  - Clean rollouts 56527/56527 over 2936/3000 engine cells; splits 33.7 / 35.0 / 25.1 %.
  - Choice strings 23737/23785; effect census 0.
  - E2 vs Showdown: `Test Files  2 passed (2); Tests  1592 passed (1592)`. Step 1 had 960.
  - Saved battles 30/30, Resume 30/30, Illusion and Transform 6/6; runner errors 0.
- **`leak:training`:** every row passes (`real 24m56.835s`).
  - L1: `L1-sp 0 differences in 190`, `-nature 231`, `-item 245`, `-ability 248`, `-moves 291`, `-bench 310`, `-hp 145`,
    `-dice 68`, `-dice-eot 73`, `-choice 129`.
  - The two settings work: `161/201 differ`, `65/129 differ`.
  - L2: `0 hits in 493 messages over 40 battles (8 forfeited on a locked turn)`.
  - Saved battles: `40 replays (262 boards; 40 of 40 equal to the battle's boards), 10 resumed, 222 checkpoints sealed`.
  - Illusion and Transform: `0 hits in 191 messages over 16 battles; 7 Illusions ended, 16 with a Transform, 7 look-alike
    decisions; 16/16 replays equal, 4 resumed`.

**Order of the runs.** The Training gates, the census and the bench ran before `dead-sites.py` / `dead-sites2.py`. Those two
remove only unreachable lines. After them, these were run again:
- `npm run check`:
  ```
   Test Files  248 passed (248)
        Tests  7003 passed | 1 skipped (7004)
  ```
  The first run after the removal failed once: `training-saved-flow.test.ts`, `expected 4 to be 3` at the Resume board turn.
  It is a real-worker timing test; it passed in the run before the removal, 3/3 alone and in the full run after.
- `golden-1v1: 254 cases byte-equal (4322 ms)`;
- `test:battle-data:source` `10 passed (10)` / `149 passed (149)`;
- `STATUS2_REEXPECT=1a compare.ts --no-write`: `1928/1939 cases match.` The same 11 cases fail.

### ADDENDUM2 §7.3: the census sample and the budget measurement

**Census sample.** Command: `census-sim.ts --n=8000 --sv=2000`, seed 7.
- `design/census-sim.out.json` was put back; this run is in `int1a/census/census-sim.after.{out,json}`.
- The reasons diff is `int1a/census/census-diff.out`, against the stored `design/census-sim.out.json`.

| Sample | Ready (before → after) | Not estimated | End of turn not estimated |
|---|---|---|---|
| Champions (8000, usage-weighted) | 6867 → 7296 | 1133 (14.16 %) → 704 (8.80 %) | 252 → 233 |
| SV (2000, Random Battle Doubles sets) | 1679 → 1712 | 223 (11.15 %) → 190 (9.50 %) | 80 → 81 |

**Champions reasons now gone:**
- Matcha Gotcha's spread heal: 269 turns (3.36 %).
- Protean / Roost / Burn Up type change: 54 / 16 / 1.
- Armor Tail and Queenly Majesty against an ally's move: 25 / 4.
- Phantom Force semi-invulnerable: 13.
- Moves "not modelled and comes before another move":
  - Skill Swap 8; Psych Up 6; Worry Seed 5; Minimize 5;
  - Entrainment, No Retreat, Stockpile and Speed Swap 3 each;
  - Soak 2; Reflect Type 1.
- Parabolic Charge 8 and Heat Wave 1 spread heals.
- Fling in Champions 6; one-hit KO 6; Disguise 1 + 1.
- At the end of turn: Soak 8, Skill Swap 7, Psych Up 4, Minimize 3, Stockpile 3, Simple Beam 2, Topsy-Turvy 1,
  Trick-or-Treat 1, Entrainment 1.

**Champions reasons that grew.** These turns used to stop at an earlier reason and now reach a later one. All are existing,
narrow or needs-context texts:

| Reason | Before → after |
|---|---|
| `{Name} switches out: the replacement is not known.` (wave 2) | 336 → 344 (end of turn 222 → 232) |
| `Encore needs {Name}'s move from the last turn.` | 204 → 206 |
| `Imprison needs {Name}'s moves.` | 11 → 12 |
| `Matcha Gotcha's effect on Sinistcha from more than one target is not modelled.` (a Scovillain-Mega Spicy Spray, kept `spreadEffect` #4) | 0 → 3 |
| The same reason with Parabolic Charge | 0 → 1 |
| `Cud Chew is not modelled in 2v2.` (end of turn, 1b) | 0 → 1 |

**SV reasons now gone:**
- Matcha Gotcha 9; Psychic Noise 8.
- Phantom / Shadow Force 11; Glaive Rush 4; Double Shock 1; Disguise 1.
- At the end of turn, `Harvest is not modelled in 2v2.` (14) is now `Harvest needs Arboliva's item from an earlier turn.`
  (14). These Random Battle sets hold no item.

No reason in either sample names a position.

**Budget measurement.** `int1a/census/budget-probe.ts` is the design probe `tier2-eot-training-probes-3.ts`, copying this
tree's `app/lib/battle`. Two things changed: its output folder, and the spread-heal guard's anchor, which is now optional
(1a removed the guard, and the probe says so). Output: `int1a/census/budget.out`.

| | Before (design run, main) | After (this tree) |
|---|---|---|
| `Too many cases to follow.` (Champions: turn, end, E2; SV: turn, end) | 0, 0, 0; 0, 0 | 0, 0, 0; 0, 0 |
| Engine errors / throws | 0 / 0 | 0 / 0 |
| Champions worlds, entries (max) | 26, 5870 | 26, 24870 |
| Champions calculations (max of 160) | 58 | 58 |
| SV calculations (max) | 20 | 20 |
| Spread heal (C12 joint) ready turns, worst world-state load | 71, 0.0027 | 350, 0.1244 (over if ×9; ×20 over on 2 turns) |
| Headroom for a landing's 16 rolls (end-of-turn entries ×16 over 200 000) | 0 (0.00 %) | Champions 2 (0.03 %), SV 1 (0.06 %) |

The acceptance holds:
- no ready sample turn becomes `Too many cases to follow.`;
- the calculation load stays at or under 160 on every turn (worst 58);
- the spread-heal model is inside SPEC2 risk 5: 0 turns over the budget, where T2E predicted 4 of 278 guarded Matcha Gotcha
  turns.

The largest new world, 24870 entries, is a spread-heal turn. Those turns are the 2–3 sample turns where 1b's ×16 landing
rolls would cross 200 000 entries (§4).

## Layout check (static render in the Browser pane)

`int1a/render-2v2.test.tsx` (`render.config.mts`) renders the 2v2 summary and its Field conditions with the earlier-turn
controls: `DoublesSummary`, `BattleConditions` under `DoublesCarriedContext` and `EarlierTurnContext`.
- The HTML pages use the app's CSS module and globals, and were served on 127.0.0.1:4317. There was no sign-in and no
  credentials.
- Each page was checked at 375 px (viewport emulation, and a 375 px frame) and at 1280 px:
  - scrollWidth equals clientWidth on every page (375 / 375 emulated, 360 / 360 in the frame, 1265 / 1265 at 1280);
  - no element extends past the edge.
- One layout fix: the card's quick buttons wrapped `Switc/hed/in` at 375 px. They are now two columns, with All moves on the
  next row (`.doublesQuickMovesRow { grid-column: 1 / -1; }`).

**ADDENDUM2's additions.** Facts as rendered:
- **Dig, then the ally's Earthquake, with "Fly charged last turn" and "Protecting moves in a row 1":** both controls render
  with their values on the opponent's Pokémon.
- **High Jump Kick into Protect:** `Protect blocks High Jump Kick.` and `Hitmonlee loses 62 HP (High Jump Kick).`
- **A multi-hit move into Mimikyu:** Breloom's Bullet Seed, since neither Cinccino nor Ambipom learns Double Hit in SV.
  Shows `Disguise: Mimikyu takes no damage.`
- **Focus Band on a knockout** (Dragon Claw into a 20 HP Snorlax): `Focus Band: Snorlax keeps 1 HP (10%).` and KO chance
  90 %. The band's fact belongs to a one-hit move. A multi-hit move's band is in its numbers: 100 HP Mimikyu, Bullet Seed,
  KO 13.5 % = 15 % five hits × 9/10.
- **Switched in with Payback:** `Snorlax switched in this turn and takes no action.` and Payback at 51–61, not doubled.
  Only `Snorlax: switched in this turn` is pressed.

**SPEC2 §8.4 step 5's list:**
- **Skill Swap giving Intimidate:** `Wyrdeer gets Rough Skin; Garchomp gets Intimidate.`, `Garchomp's Intimidate activates.`,
  `Wyrdeer: −1 Attack.`, `Gardevoir: −1 Attack.`. Incineroar's Flare Blitz then meets Wyrdeer's Rough Skin: 35 / 170 left.
- **Soak then Thunderbolt:** `Becomes Water type.`, then Garchomp takes 120–144.
- **Magic Coat against Thunder Wave** (USUM; SV has no Magic Coat): `Magic Coat: Thunder Wave goes back to Jolteon.`,
  `Jolteon is immune.`
- **Matcha Gotcha into two foes:** Garchomp 46–55 and Incineroar 21–26; Sinistcha goes from 120 to 146 / 146.
- **Sheer Cold:** Snorlax takes `235 damage (100–100% of max HP) · KO chance 100%`; `Sturdy: Garganacl is immune.`
- **Fling with a Life Orb:** Snorlax takes 35–43, and Incineroar takes no recoil.
- **Shell Smash into Opportunist:** `Opportunist: Espathra copies +2 Attack, +2 Sp. Atk, +2 Speed.`
- **Stockpile control (2 layers) with Swallow:** +102 HP, `Its Stockpile ends.`, `−2 Defense.`, `−2 Sp. Def.`,
  `Assumes each of Clodsire's Stockpile layers changed its Defense and Sp. Def.`
- **Last move control (Dragon Claw) with Encore:** `Encore: Garchomp uses Dragon Claw.` with its random target, 50 % each.
- **Item used earlier control (Sitrus Berry) with Recycle:** `Recycle: Bronzong gets Sitrus Berry back.`, then
  `Sitrus Berry: +35 HP.`
- **Psychic Noise then Recover:** `Heal Block: Recover cannot be used.`
  - This is with Sweet Veil. With Alcremie's default here, Aroma Veil, the Heal Block is blocked and Recover heals 70, as in
    Showdown (`int1a/pn-debug.ts`).

No text names a position.

## 4. Open

1. **Training decision time.** The max went from 1181 ms on main to 1837 ms; the ceiling is 2000.
   - The 12 decisions over 1200 ms all come from the S01 team, whose Sinistcha carries Matcha Gotcha. Main guarded these
     cells; 1a models the spread heal, so they are engine cells now.
   - Reproduced in-process (`int1a/one-battle.ts`, safe-maxdamage-open battle 134, turn 2): 1011 ms on this tree against
     316 ms on main (engine calls 114 against 105).
   - The profile's time is in `doubles-spread.ts` `drainingStep` / `spreadStep` and `doubles-world.ts`
     `mergeWorlds` / `factorKey`.
   - The p50 / p95 rose 5–8 % in the runs before the census probes started; the last three runs shared the CPU with them.
   - The gate passes, but 1b's families add to these turns, so an exact reduction of the drain joint (S / D) is worth doing
     before 1b's gates.
2. **Bench:** +7 % at p50 and +10 % at p95 over main (per-turn ratio median 1.093). The newly calculated turns account for
   part of it.
3. **The 11 cases in §2:**
   - ST (1b): Opportunist ×4, Imposter ×2, Starf;
   - Symbiosis;
   - E2's Encore `turnsLeft` ×3.
4. **Field effects that end this turn.** A terrain, Gravity or Magic Room with `fieldTurns` 1 is
   `{X} ending is not modelled in 2v2.` until E2 lands their ends in 1b (T2E-FS, IN-FLD).
5. **The spread-heal worlds and 1b's ×16 landing rolls.** Up to 24870 entries in this sample; 2 Champions turns and 1 SV
   turn would cross 200 000 with ×16. 1b's Future Sight landing and Cud Chew need the readers rule on these turns.
6. **Left for their owners (not integrator lines):**
   - D's Fling per-use ask 2 (D's `lifeOrbBack` stands; the render shows no recoil);
   - the remaining `!WIRED` / `!pipeline` branches of `doubles-pairs.ts` and `doubles-faces.ts`, now constant;
   - the Minimize hit fact (A1's `takenMods.minimize`);
   - E1's White Herb edge;
   - H's Smack Down guard.
7. **Cosmetic:**
   - A fixed hit's percent prints as `100–100%` (`damagePercent`, unchanged from 1v1). The turn's new one-hit KO hits show
     it.
   - A sure knockout summed in floats can print `KO chance >99.99%`. Example: Bullet Seed into a 10 HP Mimikyu, where the
     hit's `koChance` is 0.9999999999999999 and the HP card's is 1. `chanceText` is shared with the Uses-to-KO cells, which
     test `>99.99%` on purpose, so it is left as is.
