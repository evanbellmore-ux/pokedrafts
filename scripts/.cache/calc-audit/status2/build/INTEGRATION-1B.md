# Integration 1b (status2, ADDENDUM2 §8.6)

The nine wave-1b tracks (K, M, PR, CL, ST, FC, E2, T2, U2) and V2 merged into this tree, with every `needsFromOthers` and
`needsFromIntegrator` item resolved, and integration 1a's leftovers for the integrator done (Symbiosis, D's Fling ask 2, the
constant `WIRED` / `pipeline` branches, H's Smack Down guard). Every case was then run against pinned Showdown c23d2e94 and the
app, and the gates were run. "main" means 4008ee8: the scratch `headtree`, run through `TSX_TSCONFIG_PATH`. "1a" means the
tree integration 1a left (INTEGRATION-1A.md), and "perf" the tree after PERF-1B.md.

## Status

- **Branch:** `calc-2v2-status-2`, checked before the work and again before this report.
- **What did not happen:** nothing was committed, pushed or switched. `.claude/` and `node_modules` were not touched. No
  `next build` ran, and nothing ran against live Supabase. No CastMirror or RaidCard file was opened. No credentials were typed.
- **Line endings:** every edit kept the file's line endings (`int1b/tools/patchlib.py`; checked against the pre-merge snapshot
  `int1b/pre/`, which holds `app/lib/battle`, the calculator, Training, `tests/` and the docs as the tracks left them).
- **Scripts:** every patch is a script in `build/int1b/tools/`: exact single-match replacements, so each applies once or stops.
  They serve as the record; the tables below name them. The last code change is the landing fix (`c-userless.py`, §1);
  every gate in §2 and §3 but the bench and the census sample (each says why) ran after it.

## 1. The merge

### Track lines (the asks, in merge order)

| Track | What went in | Script |
|---|---|---|
| CL | CL-1 (afterHit calls `callingHooks.afterHit`), CL-2 (canStatus: no sleep under Uproar), CL-3 (`usedMove` for Mirror Move and Instruct; a Dancer's copy is no last move), CL-4 (`ownsLastMove`; a No move past BeforeMove is Splash), CL-5 (a called kind-X move runs the early branch: Sleep Talk's Protect, Copycat's Tailwind), CL-6 (an instructed move takes no place in the order); CL-7 as `CALLS_MOVE` (below) | `cl/patch-int.cjs`, `tools/u2-cl7.json` |
| M | M-1 … M-17 (Max Guard as a protect kind, its priority, BeforeMove, pass list and blocks; `maxEffects` returning worlds at its five sites; Pain Split's undynamaxed arithmetic; Chi Strike's condition and E2 volatile); `WIRED` all true | `w1b-m/patch-int.cjs` |
| PR | every group of `integrator.py`: `fixed` (MoveContext / CalcTrace `fixedDamage`, the fixed-hit branch in `calculate.ts`, `stepReport`, the last-hit child key), `status` (Poison Puppeteer's use), `outcome` (Commander's volatiles after M's), `nomove` (after CL's), `copies` (`StepStats.from`), `spotlight` (the volatile, `classify-a3.md`); its `it.fails` flipped and its two interim tests deleted | `w1b-pr/integrator.py` |
| K | line 1 (`calcStandIns` in searchFor), line 2 (`selfFaintFact` names Innards Out and Aftermath); ask 4's sets (below) | `w1b-k/asks.json` |
| ST | ST-1 (a variant's weight at its root; the start's own fractional outcomes), ST-2 (a start copy pending), ST-3 (`rowsByVariant` at both start-row sites), ST-4 (the start's turn facts) | `w1b-st/patch-int.cjs` |
| FC | I1 (`afterFieldMove` after the move's fact, with the action: 5 sites), I2 (Defog's terrain end), I3, I4, I5, I6, I7 (each call with the field before and the source), I8a (`fieldChangeHooks.fainted`), I8b and I8c together (`stepEnv`, `stepField`); I9 and I10 (below). E1–E3 were already E2's in `doubles-eot.ts` | `tools/fc.sh` |
| E2 | item 1 (a residual hit never follows its user's HP: searchFor with `attackerBuild`), item 2 (Taunt, Encore and Disable's fresh durations), item 3 (null-safe, below); the interim `REASONS.landing` site deleted; item 4 (`classes.diff`) and item 5 (D-FLG-18) | `e2/int-patch.cjs`, `tools/e2-landing.json`, `tools/t-misc2.py` |
| U2 | the Minimize hit fact (`MINIMIZE_MOVES` exported; afterHit's line) | `tools/u2-cl7.json` |
| T2 | no frozen-file line was asked | — |
| V2 | the generated test regenerated after the last compare run (§2) | — |

### The integrator's own changes (ADDENDUM2 §8.6, §2.2, §2.4; INTEGRATION-1A §4)

**Status table and classification.** `classify-a3.md` flips `magicroom` and `defog` to M and adds `spotlight` (PR) as M:
A3 is 21 M + 1 C. `status-table.ts` is regenerated (`gen-status-table.ts`): `{"M":186,"X":38,"C":19,"S":7,"N":20,"P":1}`.

**REASONS removed** (each whose last site went in 1b): `landing`, `overTime` (E2), `maxGuard`, `randomStatus`, `withDynamax`
(M, with its `WIRED` fallbacks), `pledges` (PR), `activates`, `boosterAfterRoom` (FC's I9). `berryBetweenHits` stays: W's
continuation keeps two narrow corners (`continueHits`).

**§2.4's sets** (`doubles-actions.ts`):
- removed: `PRESENCE_MOVES` (every member modelled; `movesGuard` is now a no-op hook), `PRESENCE_THIRD_PARTY` (Poison Puppeteer,
  Imposter; `thirdPartyGuard` a no-op hook), `FAINT_REACTIONS`, `RANDOM_STATUS_MAX_MOVES`, `GMAX_EFFECTS` (no reader since M;
  the source test reads doubles-max.ts instead);
- `CALLING_MOVES` becomes `CALLS_MOVE` (pinned callsMove, without Instruct): CL-7 in `doubles-typing.ts proteanGuard` reads it
  from `doubles-actions.ts`, since importing `doubles-calling.ts` there would make an import cycle; `doubles-calling.ts`
  re-exports it, and CL's `Instruct with Protean` guard goes;
- `MODELLED_THIRD_PARTY` gains Flower Veil, Pastel Veil, Aftermath, Innards Out, Cotton Down, Battle Bond, Receiver, Power of
  Alchemy (K), Dancer, Commander, Poison Puppeteer (PR), Imposter, Opportunist, Mirror Herb (ST, D), Room Service (FC), Pickup;
- `EVENT_THIRD_PARTY` keeps the switch family (Eject Pack, Eject Button, Red Card, Emergency Exit, Wimp Out: wave 2) and
  Symbiosis (guarded but after a Fling).
`tools/c-actions.py`.

**Constant branches** (INTEGRATION-1A §4 item 6): `doubles-pairs.ts` loses `WIRED` and every fallback it kept (the Spicy Spray
Safeguard reason, the frozen-priority and between-hits guards); `doubles-faces.ts` calls the kernel's `afterHit` member
directly (the `!pipeline` accuracy-drop and flinch branch goes); `doubles-calling.ts` and `doubles-max.ts` lose their `WIRED`
flags and fallbacks. `tools/c-pairs.py`, `c-faces.py`, `c-calling.py`, `c-max.py`.

**`status2-hooks.test.ts`:** 21 MOVED rows for the 1b call sites (ST's `turnFacts`, `rowsByVariant`; K's `calcStandIns`; PR's
`stepReport`, `outcomeVolatiles`; M's `usedStatus` ×3, `maxGuardAction` ×2, `passesMaxGuard`, `maxGuardBlocks`, `painSplitHP`,
`conditions`, `outcomeVolatiles`; CL's `afterHit`, `uproarSleep`, `ownsLastMove`; FC's `fainted`, `stepEnv`, `stepField`), and
the CALLS orders of searchFor, faint, applyStep and afterHit. The import-cycle check passes. `tools/t-hooks.py`.

### Fixes the integration needed (beyond the asks)

Each is exact against pinned Showdown; each new oracle case is in `verify/cases-int1b.ts` (wired into `cases-wave1b.ts`, owner
"integrator (1b)").

| Fix | Why (pinned source) | Cases | Script |
|---|---|---|---|
| E2's ask 3 read a `lastMove: null` as unknown (`entry.lastMove ?? carried.encore.move`): S44d gave `Encore needs Blastoise's move from the last turn.` The carried Encore's move is read only when `lastMove` is undefined | encore onStart | S44d, IN-TNT-02-sv | `k-lastmove.py` |
| **Symbiosis** after a Fling took its user's item: the partner's item moves at once (takeItem, its TakeItem toward the user, setItem; no item history), the user's Unburden off while it holds it, `Symbiosis: Oranguru passes Sneasler its Sitrus Berry.`. Kept narrow, `Fling with Symbiosis is not modelled in 2v2.`, where the passed item acts at once or after the hit (a due Berry, White Herb, Mental Herb, a Seed, Room Service, Booster Energy, Life Orb, Shell Bell). Symbiosis after any other item use stays guarded | abilities.ts symbiosis onAllyAfterUseItem; moves.ts fling condition onUpdate | G4-FLG-09-sv, INT-SYM-01-sv, INT-SYM-02-sv | `c-symbiosis.py` |
| **D's Fling ask 2:** the turn step leaves a flung item out after the hit (no Life Orb recoil, no Shell Bell heal, no HP Berry of it), `uses-to-ko.ts afterMove` in turn mode only; D's `lifeOrbBack` and its Shell Bell and Substitute / face Life Orb guards go; `doubles-faces.ts` takes no Life Orb for a flung one. 1v1 is unchanged (golden byte-equal) | fling condition onUpdate at the hit's Update (battle-actions.ts:967) | INT-FLG-01…04-sv, G4-FLG-01…10 | `c-fling.py` |
| **H's Smack Down guard:** Smack Down and Thousand Arrows land a Fly or Bounce user they reach even on the ground already (Iron Ball, not Flying type); the queued release is cancelled | moves.ts smackdown condition onStart (`applies` after removeVolatile('fly')) | INT-SMK-01-sv | `c-smackdown.py` |
| A drag or a selfSwitch with no Pokémon to come in (`canSwitch` false on that side) switches nothing out (V2's T2P-BKB-02-champions) | battle-actions.ts forceSwitch `canSwitch(target.side)`; :1290 selfSwitch | T2P-BKB-02-champions | `c-switch.py` |
| Echoed Voice's new pseudo-weather uses a held Room Service under Trick Room (FC's ask of PR); `World.fieldSet.echoedVoice`, kept only with a Room Service holder in the turn | field.ts addPseudoWeather: PseudoWeatherChange; items.ts roomservice | unit test (doubles-presence.test.ts) | `c-echoed.py` |
| A Dancer's copy sorted before the dance it copies (its step had no position: mean 0): `externalUse` gives a copy CL-6's position, after the action that set it off | — (the steps' order only) | the Dancer render page | in `doubles-turn.ts` |
| Uproar's E2 volatile `uproar` (CL's ask of E2) | moves.ts uproar condition | T2M-UP-01-sv/-swsh, T2E-UP-01-sv/-champions | in `doubles-eot.ts` |
| **Census:** `Innards Out with earlier damage this turn is not modelled in 2v2.` (ADDENDUM2 §2.3 #13 keeps no reason): a single hit into an Innards Out holder whose HP differs between entries is stepped once per HP (Final Gambit's split), so K's `koRetaliation` reads one value | abilities.ts innardsout onDamagingHit | INT-IO-01-swsh (K-IO-06) | `c-innards.py` |
| **A crash, found by T2's fuzz (seed 101, battle 12, turn 22):** a Future Sight or Doom Desire landing whose user is not in battle (fainted, or a build) runs as an action at the first slot of the user's side (`residualHit`). Where that slot is empty (Training after the user fainted and nothing came in; the calculator with a side's first slot empty) every landing the target survives threw `TypeError: Cannot read properties of undefined (reading 'build')` in `secondaryLands` (K's Flower Veil fact in `koRetaliationAfter`); where another Pokémon stands there, A2's Color Change read it as the user (a Normalize Pokémon there made Kecleon Normal). Now `PendingAction.userless` marks that action: no Flower Veil fact (a landing move drops nothing), and Color Change takes the move's own type | conditions.ts futuremove onEnd: trySpreadMoveHit from data.source with no ModifyType event; Normalize only for an active source (sim/pokemon.ts ignoringAbility) | INT-FUT-01-sv, INT-FUT-02-usum, INT-FUT-03-usum; the probe `int1b/userless-probe.ts` (SV and SwSh; 712 landings into 89 targets with an item or ability that reacts to a hit, the slot empty or holding a Sheer Force Feraligatr, the user fainted or on the bench; 254 are not in that game's catalog): 140 throws before, 0 after (`logs/userless-probe.before.log`, `.after.log`) | `c-userless.py`, `v-userless-cases.py` |
| **Census:** `spreadEffect` beyond §2.3 #4's Dragon Darts corner: a spread target's stage reaction on the user (a Gulping Cramorant's Gulp Missile, Def −1; a Mirror Armor holder reflecting the move's certain drop) is replayed through `applyBoosts` from the holder in target order; a Mirror Armor holder with nothing to reflect and a Cramorant not Gulping are targets with no reaction. Two stage reactions with no target to compose from keep `spreadEffect` (before, two Mirror Armor holders gave one drop instead of two, with no reason) | abilities.ts mirrorarmor onTryBoost, gulpmissile onDamagingHit | INT-SPE-01…05 | `c-spread-stages.py`, `c-spread-stages2.py` |

**Case data fixed** (the 1b tracks' asks of V2):
- T2P-INS-06-sv: Garchomp Brave with 0 Speed IVs (96, slower than Oranguru's 112), so the reason is reached (CL).
- T2P-TRC-03-sv: Gardevoir Brave with 0 Speed IVs (76 against Incineroar's 80): the start is modelled; T2P-TRC-03b-sv keeps the
  faster Gardevoir with `Trace copies a random foe's ability.` (ST).
- T2P-CTR-10-usum: `Counter with Parental Bond is not modelled in 2v2.` (PR).
- `tools/v-cases.py`.

**Harness conventions** (V2's files, from the tracks' asks):
- `compare.ts`:
  - a status copy's hit the app does not record is skipped, as `compareStatusHits` does (CL: T2M-HH-01);
  - a Dynamaxed Pokémon's status move counts as a protecting move for the stall fact (M: T2M-GM-09, IN-STL-04);
  - a step fact in `aboutSlot`'s forms counts for the Pokémon it names, where it has no hit entry (FC: T2P-ACT-02…05, T2P-FLD-04);
  - a not-estimated turn whose start gave the reason (`result.start` null) needs no start row (ST: T2P-TRC-03b).
- `gen-tests.ts` mirrors the third, and compares an Encore rewrite into a status move as the move used (its hits are not
  damage hits; G4-LMV-01).
- `changed-cases.ts` gains the 1b integrator rows (the Minimize hit fact, Symbiosis and Fling's per-use item, a switch with no
  Pokémon to come in, Smack Down into Fly, Echoed Voice with Room Service). It runs without `STATUS2_REEXPECT` (the variable
  rewrites the stored cases' reasons, which the rows are found from).
- `cases-int1b.ts`: the 16 integrator cases (INT-SYM, INT-FLG, INT-IO, INT-SPE, INT-SMK, INT-FUT), owner "integrator (1b)".
- `tools/v-gentests.py` and inline edits.

**Tests updated to what 1b models:** doubles-turn-guards (every presence, start, field-change, Max Guard, Cotton Down and
G-Max guard now ready; Beat Up keeps its row's `Beat Up: party needed.`), doubles-turn-fixes (R09, R10, F21a modelled; F30d
ready with pinned values; F14a/F14c `Sleep Talk needs …'s moves.`), doubles-turn-mechanics (M29c), doubles-moves-pane (the
foe across as the representative), calculator-doubles-inputs (Max Guard is no control), doubles-status, doubles-guards-fling
(D-FLG-18, the flung Shell Bell), doubles-field-side-items (the classification; A3-DF-05 and A3-MR-06 ready),
calculator-ngas-2v2 (Commander under the gas), doubles-start-rows (SR41, SR61–63 ready), doubles-outcomes (the 1b case
inputs), doubles-hidden (Smack Down into Fly), doubles-reactions (K-IO-06 ready), doubles-pairs, doubles-max, doubles-calling,
doubles-fieldchange (their flags and source-reading gates gone), the tracks' `it.fails` flipped (K 4, ST 4, E2 2, U2 1,
CL 15), doubles-presence (Echoed Voice and Room Service), and the source tests doubles-residuals (E2's CLASSES),
doubles-status-moves (the kinds), doubles-third-party (the veils and Pickup modelled, the switch family guarded).

**Docs** (`docs/champions-calculator.md`, checked against the strings the tracks landed): the Symbiosis sentence (modelled
after a Fling), Beat Up's example (`Beat Up: 2 hits (Absol 18, Garchomp 18 power).`, the row's real text), Room Service with any
field effect started under Trick Room. CL's `Sleep Talk fails: {Name} has no move it can call.`, E2's `{Move} does not hit:
{Name} is its user.`, the Dancer, Instruct, Pledge and Cud Chew examples match the app's text as rendered (§4).

## 2. The oracle

- **Every case, `STATUS2_REEXPECT=1a,1b`.** Command:
  `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts`. Stored in `results/compare.json`
  and `app-results/` (integration 1a's are kept in `int1b/app-results-before-1b/`, `int1b/compare-before-1b.json`). Output:
  ```
  2331/2331 cases match.
  ```
  2331 = the 2314 V2 left, plus T2P-TRC-03b and the 16 integrator cases. V2's last run had 2220/2314. (Before the landing
  fix: `2328/2328 cases match.`; the fix changed no case's app output but the three INT-FUT cases': `v2/app-int1b` before
  and after, `ms` aside, are equal on the other 2328, `int1b/app-int1b-before-userless/`.)
- **`changed-cases.ts diff <int1b/app-results-before-1b> <v2/app-int1b> --wave=all`** (base: integration 1a's `app-results`;
  new: the same run in four shards, `v2/run.ts --shard=i/4 --store-dir=v2/app-int1b`, each `583/583` or `582/582 cases match.`):
  ```
  2331 cases: 1895 unchanged, 44 stored cases changed, 0 failing the gate.
  ```
  0 changed stored cases are NOT LISTED; every listed one matches the oracle (or is not estimated as listed). The 44 are the
  11 cases integration 1a left open, the stored cases whose 1b reasons went (F21a, F30d, R09, R10, S47c, S48-PainSplit-dynamax,
  E40-FlameBurst, ER41d–h, FS08e, G4-WHR-01 ×2, M24i/j, M29c …), the Taunt / Encore / Disable turns left, F14a/c and S47b's
  `needsMoves`, and the Minimize hit fact (CR-10a/b ×2 games, SAT-MIN-2/2b ×2 games).
- **`gen-tests.ts --keep=v2/emitted-ids-v2.txt`:**
  ```
  wrote 1985 cases to C:\Users\evanb\OneDrive\pokedrafts\tests\unit\doubles-turn-showdown.test.ts (0 cases that do not agree with the app left out)
  ```
  Every one of V2's 1884 ids is kept; 101 join (98 in `int1b/emitted-ids-1b.txt`, then the three INT-FUT cases; the file
  before 1b is `int1b/doubles-turn-showdown.before-1b.test.ts`, before the landing fix `.before-userless.test.ts`: the diff
  is the three added cases). `vitest run --config vitest.unit.config.ts tests/unit/doubles-turn-showdown.test.ts`:
  `Tests  1985 passed (1985)`.

## 3. Gates

- **`npm run check`** (lint, typecheck, unit tests; the last run, after every change, `int1b/logs/check-2.log`, real 1m56.6s):
  ```
   Test Files  255 passed (255)
        Tests  7699 passed | 1 skipped (7700)
  ```
  (Before the landing fix: `Tests  7696 passed | 1 skipped (7697)`; the 3 are the INT-FUT cases in the generated test.)
- **`npm run test:battle-data:source`:**
  ```
   Test Files  11 passed (11)
        Tests  153 passed (153)
  ```
- **golden-1v1:**
  - `golden-1v1.ts --check` (after every change): `golden-1v1: 254 cases byte-equal (3705 ms)`.
  - Against the golden from before 1a (`GOLDEN_BEFORE=fling/golden-before/golden-1v1.full.json.gz fling/golden-diff.ts`):
    `110 Fling rows changed; 0 other differences`. The ids and rows equal F's `fling/golden-changed.json`
    (`int1b/golden-changed.json`).
- **Bench** (`int1b/bench.sh`, 4 alternating rounds over the cases before wave 1a and wave 1b's, main through
  `TSX_TSCONFIG_PATH`; `int1b/bench.log`):
  ```
  benchH-4 turn p50 2.55 p95 6.63 max 140.6 | moves p50 9.91 | statuses {"ready":1526,"not-estimated":394,"issues":4} | reference 30/30
  benchC-4 turn p50 3.02 p95 7.16 max 142.3 | moves p50 9.90 | statuses {"ready":1850,"not-estimated":70,"issues":4} | reference 30/30
  paired ready turns 1525: main p50 3.01 p95 6.95 | now p50 2.98 p95 7.08 | per-turn ratio median 0.975 p90 1.387
  newly ready 325: p50 3.32 max 22.1 ms
  moves pane p50 main 9.91 now 9.90; max now 17.5
  ```
  - Over the turns both trees calculate, the median per-turn cost is −2.5 % against main (1a: +9.3 %; perf: +4.0 %).
  - Across the four rounds the turn p50 is 2.35–2.55 ms on main and 3.02–3.14 ms on this tree (the newly ready turns are in
    it); the worst turn is 133–159 ms on main and 142–164 ms here. Reference mode is 30/30 in every run.
  - The one turn main gives ready and this tree does not is INT-SPE-02-sv: main's number there was wrong with no reason (one
    reflected drop instead of two); it is now `Electroweb's effect on Kilowattrel from more than one target is not modelled.`
  - The bench ran before the landing fix and was not run again: the fix changes no stored case's output (§2), and the bench
    runs those cases.
- **The Training gates** ran twice: before the landing fix (`int1b/training-gates.sh`: `eval.log`, `conformance.log`,
  `leak.log`) and after it, on the final tree (`int1b/training-gates-2.sh`: `eval-2.log`, `conformance-2.log`, `leak-2.log`,
  then `eval-paired.sh`). The machine was in use by other programs (a game among them) during both, so the times vary
  between runs; the decisions do not (below).
- **`eval:training --gates --scale 1 --shards 8`**, run as `--run s1-step1` (main's seeds; the runs are in
  `scripts/.cache/training/eval/int1b-s1seeds-run1` and `int1b-s1seeds`, Step 1's `s1-step1` put back). First run, 21 PASS
  and 1 FAIL:
  ```
  | Reads you − Plays safe, both vs HabitBot | ≥ +5 points (same seeds) | 2.8 pts [-1.3, 6.8] n=400 | FAIL |
  | Turn decision time (Node, worst run) | p50 ≤ 400, p95 ≤ 800, max ≤ 2,000 ms | p50 317 ms p95 682 ms max 1458 ms (n=16073) | PASS |
  | Cell methods on pool S (soft) | engine + prelude ≥ 80% | 99.8% of 23268 | PASS |
  | A1.4 status moves used (pool U) | Tailwind, Trick Room, Follow Me, Rage Powder each chosen on some turns | chosen turns {"tailwind":42,"trickroom":12,"followme":2,"ragepowder":1} of usable turns {"tailwind":185,"trickroom":49,"followme":36,"ragepowder":1} | PASS |
  ```
  - HabitBot fails as on main (`4.0 pts [-0.1, 8.1]`) and in 1a (`2.8 pts [-1.4, 6.9]`).
  - A1.4 passes now; it failed on main and in 1a.
  - Decision time: main p50 274 / p95 577 / max 1181; 1a 303 / 675 / 1837; perf 267 / 592 / 1273; now 317 / 682 / 1458.
  - Pool S: main 88.5 % of 23175, 1a 96.9 % of 23340, now 99.8 % of 23268.
  - The other rows: legality 0 errors, 0 engine issues, 0 fallbacks, 0 capped (open, closed, perfect); vs RandomLegal 99.0 %;
    vs MaxDamage 63.0 %; Reads vs MaxDamage 73.8 %; self-play 51.0 %; closed team sheets 99.0 %; open vs perfect −4.0 points;
    preview / replacement 72 ms / 12 ms; belief closed 19 ms, open 7.83 ms; budget 240 / 160 / 4; dropped 0; exploitability
    0.01 %; determinism 20/20; the A1.5 rows pass.

  Second run, on the final tree (`eval-2.log`, real 13m51.1s): every line but the times equal to the first run's (the same
  decisions, win rates, intervals, cells, budgets and hashes). 20 PASS and 2 FAIL, the second a time:
  ```
  | Turn decision time (Node, worst run) | p50 ≤ 400, p95 ≤ 800, max ≤ 2,000 ms | p50 326 ms p95 723 ms max 1763 ms (n=16073) | PASS |
  | Belief update per turn | p95 ≤ 30 ms (closed), ≤ 8 ms (open) | closed 25 ms, open 8.42 ms | FAIL |
  ```
  Every run's p50 is 10–25 % above the first run's (safe-habitbot-open 282 against 234 ms, safe-safe-open 285 against 232).
  The belief row's 8.42 ms is safe-random-open's, the first run of the evaluation; the same run in the paired check below
  gives 5.96–6.47 ms.

  **Paired check** (`int1b/eval-paired.sh 3`, `eval-paired.log`): the two runs with the highest p95, on main's seeds, main
  (the scratch headtree) and this tree alternating, three rounds, right after the second run:

  | Run (decisions) | main p50 / p95 / max (ms) | now p50 / p95 / max (ms) | belief p95 main / now (ms) |
  |---|---|---|---|
  | safe-random-open (main 1060, now 1072) | 266 / 533 / 961; 264 / 530 / 915; 268 / 536 / 1008 | 268 / 560 / 1032; 263 / 549 / 1070; 266 / 566 / 1175 | 5.56–5.77 / 5.96–6.47 |
  | safe-maxdamage-suggested (main 421, now 425) | 304 / 687 / 1138; 291 / 621 / 1030; 296 / 617 / 1000 | 300 / 670 / 1229; 304 / 676 / 1306; 294 / 646 / 1153 | 4.85–5.02 / 4.89–6.14 |

  The p50s are equal; the median p95 is 5.1 % (safe-random-open) and 7.9 % (suggested) above main's in the same minutes
  (SPEC2 §6's 634 ms is main's 577 × 1.1); main itself gave 687 ms once. The cell share is main's 88.5 % of 23175 and this
  tree's 99.8 % of 23268 (more cells the engine answers).
- **`conformance:training`** (both runs): every gated row passes. Second run (`conformance-2.log`, real 8m27.6s):
  ```
  | 1. Tracker parity | 100% | 840/840 (100.00%) | PASS |
  | 4a. Bridge stats/HP mismatches | 0 | 0 over 400 Pokémon | PASS |
  | 4b. Clean rollouts inside the E2 support | ≥ 99% | 57662/57662 (100.00%) over 2994/3000 engine cells | PASS |
  | 8. E2 vs Showdown (doubles-outcomes + doubles-turn-showdown tests) | all pass | Test Files  2 passed (2); Tests  1989 passed (1989) | PASS |
  | Runner errors | 0 | 0 | PASS |
  ```
  - The other rows: belief 297/297; requests 100 % / 100 %; one-turn logs 289/289; default settings 288/288, 288/288; splits
    33.7 / 35.0 / 25.1 %; choice strings 23737/23785; effect census 0; saved battles 30/30, Resume 30/30, Illusion and
    Transform 6/6.
  - Against the first run only two cells differ: E2 vs Showdown 1989 (1986 before the three INT-FUT cases joined the
    generated test) and "largest record 48 KB" (44 KB: a saved battle's log holds each decision's `elapsedMs`).
  - Against 1a: clean rollouts 57662/57662 over 2994/3000 cells (1a 56527/56527 over 2936/3000); E2 vs Showdown 1989 (1a 1592).
- **`leak:training`** (first run, `leak.log`, real 21m29.9s): every row passes.
  ```
  | L1-sp | ≥ 50 compared, 0 differences | 0 differences in 189 | PASS |
  | L2 (your direction, youSee closed) | 0 hits over 40 battles | 0 hits in 506 messages over 40 battles (8 forfeited on a locked turn) | PASS |
  ```
  - L1: `-nature 0 differences in 232`, `-item 243`, `-ability 247`, `-moves 289`, `-bench 316`, `-hp 144`, `-dice 71`,
    `-dice-eot 72`, `-choice 129`. The two settings work: `161/201 differ`, `65/128 differ`.
  - L2 saved battles: `40 replays (272 boards; 40 of 40 equal to the battle's boards), 10 resumed, 232 checkpoints sealed`.
  - L2 Illusion and Transform: `0 hits in 198 messages over 16 battles; 5 Illusions ended, 16 with a Transform, 3 look-alike
    decisions; 16/16 replays equal, 4 resumed`.
  Second run, on the final tree (`leak-2.log`, real 20m52.5s): every row passes; the L1 rows equal the first run's, the L2
  rows vary in their counts as in 1a (`0 hits in 509 messages over 40 battles (8 forfeited on a locked turn)`; saved battles
  `40 replays (268 boards; 40 of 40 equal to the battle's boards), 10 resumed, 228 checkpoints sealed`; Illusion and
  Transform `0 hits in 184 messages over 16 battles; 7 Illusions ended, 16 with a Transform, 3 look-alike decisions; 16/16
  replays equal, 4 resumed`).
- **T2's fuzz** (`status2/build/t2-fuzz.ts 60 101`, the seed whose engine exception T2 put down to K's work in progress;
  `t2-fuzz-all.ts` is the same printing every note, `t2-fuzz-dump.ts` writes the input that throws, `t2-fuzz-lines.ts`
  prints a differing one-turn log): before the fix `"mismatches": 192` with that exception (the landing crash, §1); after it
  (`int1b/logs/t2-fuzz-101-after.log`):
  ```
   "mismatches": 191,
   "logsClean": 794,
   "logsSame": 791,
   "issues": 0,
  ```
  The 191 are 188 PP counts (T2's known tracker counting, W1B-T2.md) and 3 one-turn logs after Instruct (§5 item 3).

### ADDENDUM2 §7.3: the census sample and T2E's budget acceptance

**Census sample.** Command: `census-sim.ts --n=8000 --sv=2000`, seed 7 (`int1b/census/run.sh`; `design/census-sim.out.json`
put back). The reasons by family, main → 1a → 1b: `int1b/census/census-diff.out` (`diff-census.mjs`).

| Sample | Ready (main → 1a → 1b) | Not estimated | End of turn not estimated |
|---|---|---|---|
| Champions (8000, usage-weighted) | 6867 → 7296 → 7391 | 1133 (14.16 %) → 704 (8.80 %) → 609 (7.61 %) | 252 → 233 → 235 |
| SV (2000, Random Battle Doubles sets) | 1679 → 1712 → 1746 | 223 (11.15 %) → 190 (9.50 %) → 156 (7.80 %) | 80 → 81 → 45 |

Every reason left is one §2.4 keeps or wave 2's:

| Reason (family) | Champions | SV | Kept as |
|---|---|---|---|
| `{Name} switches out: the replacement is not known.` | 349 (end 235) | 156 (end 31) | wave 2 (Q1 = R) |
| `Encore needs {Name}'s move from the last turn.` / `Disable needs …` | 206 / 24 | 0 | `needsLastMove` (Q3) |
| `Imprison needs {Name}'s moves.` | 12 | 0 | `needsMoves` (#46) |
| `Trace copies a random foe's ability.` | 9 | 0 | #40: every one a candidate whose Start changes the field or HP (Drought, Sand Stream, Hospitality) |
| `Beat Up: party needed.` | 8 | 0 | the row's needs-context text while its input is Unknown |
| `Friend Guard with 2 other damage modifiers: not calculated …` | 1 | 0 | #44 row-engine-limits (1v1) |
| `Harvest needs {Name}'s item from an earlier turn.` (end) | 0 | 14 | Q4 |

Gone since 1a: Imposter 12, Round 11, Unnerve 11, Beat Up's presence 8, Instruct 7, Innards Out 3 + 2, Mirror Coat 1, every
`… effect on {Name} from more than one target` (Champions 30, SV 10), Cud Chew 1 (end); SV: Poison Puppeteer 12, Aftermath 5,
Fusion Bolt / Flare 4, Flower Veil 2, Battle Bond 1, Shields Down's form at the end 36. No reason in either sample names a
position. Issues: Champions 0, SV 98, as on main (the sampler's sets).

**Budget measurement** (`int1b/census/budget-probe.ts`: integration 1a's copy of `tier2-eot-training-probes-3.ts`, its output
folder changed; the spread-heal guard's anchor stays optional, as in 1a; its header line still says "integration 1a"). Output:
`int1b/census/budget.out`.

| | 1a | 1b |
|---|---|---|
| `Too many cases to follow.` (Champions: turn, end, E2; SV: turn, end) | 0, 0, 0; 0, 0 | 0, 0, 0; 0, 0 |
| Engine errors / throws | 0 / 0 | 0 / 0 |
| Champions worlds, entries (max) | 26, 24870 | 26, 24870 |
| Champions calculations (max of 160) | 58 | 58 |
| SV worlds, entries, calculations (max) | —, 14460, 20 | 12, 14460, 20 |
| Spread heal (C12 joint) ready turns, worst world-state load | 350, 0.1244 | 357, 0.1244 (over if ×9; ×20 over on 2 turns) |
| Headroom for a landing's 16 rolls (end-of-turn entries ×16 over 200 000) | Champions 2 (0.03 %), SV 1 (0.06 %) | Champions 2 (0.03 %), SV 1 (0.06 %) |
| Future Sight users in the sample | — | none |

The census sample and the budget probe ran before the landing fix and were not run again: neither sets up a landing
(`census-sim.ts` carries no `futureMove`; the probe's headroom row is for "the end-of-turn families that the sample never sets
up"), so the fix reaches none of their turns.

The acceptance holds (ADDENDUM2 §10 risk 5): no ready sample turn becomes `Too many cases to follow.`; the calculation load
stays at or under 160 on every turn (worst 58); the spread-heal joint is inside SPEC2 risk 5. The ×16 landing rolls: no sample
turn has a landing; on the 2 + 1 spread-heal turns that would cross 200 000 entries if one landed, the result is
`Too many cases to follow.`, SPEC2 risk 5's exact fallback (E2's and PERF-1B's decision; nothing approximate).

## 4. Layout check (static render in the Browser pane)

`int1b/render-1b.test.tsx` (`render.config.mts`) renders the 2v2 summary and Field conditions, as integration 1a's did, for
ADDENDUM2 §8.6's list. The pages used the app's CSS module and globals and were served on 127.0.0.1:4337 (no sign-in, no
credentials). The facts each page shows are in `scratchpad/int1b/render/facts.txt`.
- **At 375 px and 1280 px** every page has scrollWidth equal to clientWidth (375 / 375 emulated, 360 / 360 in a 375 frame,
  1265 / 1265 at 1280) and no element past the edge.
- **Dancer copying Swords Dance:** Garchomp's Swords Dance, then `Dancer: Oricorio copies Swords Dance.` with `+2 Attack.` as
  its own later step. The first render listed the copy before the dance (fixed above).
- **Instruct:** `Instruct: Garchomp uses Dragon Claw again.` as Garchomp's second step, 81–96 again; the turn fact
  `Assumes Garchomp's Dragon Claw has PP left.`
- **Fire + Grass Pledge:** `Fire Pledge waits for Venusaur's Grass Pledge.`, `Fire Pledge and Grass Pledge combine: Fire, 150
  power.`, `The sea of fire starts on the opponent's side.`, Snorlax 78–93, and the end of turn's `Fire Pledge · Blastoise
  −19 HP`, `· Snorlax −29 HP`.
- **Future Sight landing from a Pokémon of the turn:** the landing on Snorlax, 82–97. **From a build:** `Espeon is not in
  battle: its ability, item and stat changes do not count.`, 78–93.
- **Cud Chew's Berry:** Snorlax's Body Slam, then `Cud Chew · Eats its Sitrus Berry again.` and `Sitrus Berry +48`.
- **Trace with two candidates:** `Assumes Gardevoir's Trace copied as it came in: Levitate from Bronzong or Thick Fat from
  Snorlax, 1/2 each.`; with the turn not estimated (Incineroar's Parting Shot first), the start rows per variant:
  `Earthquake · Bronzong → Gardevoir: 0 damage … · If Gardevoir's Trace copied Levitate.`, `… 36–43 damage … · If Gardevoir's
  Trace copied Thick Fat.`, and Fire Punch 44–52 / 22–27 the same way.
- **Bide's release (USUM):** `Snorlax (yours) unleashes the energy (Bide): twice the 50 HP stored.`, 100 into Snorlax.
- The server is stopped, the tab is closed and the viewport is reset. No text names a position.
- The renders ran before the landing fix. Its two Future Sight pages land on Snorlax with both slots of the user's side
  filled, where the fix changes nothing (it reaches a Color Change target or an empty first slot only).

## 5. Open

1. **Training decision time against SPEC2 §6's p95 ≤ 634 ms.** Not met as an absolute: the worst run's p95 is 682 ms (first
   run) and 723 ms (second run, the machine busier), and 646–676 ms in the paired check, where main gave 617–687 ms in the
   same minutes. eval's own gate (p50 ≤ 400, p95 ≤ 800, max ≤ 2000) passes in both runs (max 1458 and 1763 ms). Against
   main on the same machine the median p95 is 5–8 % higher, with 11 points more of pool S's cells answered by the engine.
   The second run's belief row (open 8.42 ms against 8) is the same load: 5.96–6.47 ms in the paired check. A quiet-machine
   rerun of `eval:training` is the way to settle both.
2. **HabitBot** (`Reads you − Plays safe, both vs HabitBot`, ≥ +5 points) fails as on main and in 1a; SPEC2 §6 reports it
   with main on the same seeds (sampling spread, FINAL.md §4).
3. **Training's belief battle after Instruct** (T2's tracker, not an engine number): in T2's fuzz (seed 101) 3 of 794
   one-turn logs differ, each an instructed move the belief battle aims elsewhere than Showdown's `lastMoveTargetLoc` (the
   chosen target): a Future Sight whose line has no target (`|move|…|Future Sight||[still]`, the slot already holding one:
   the tracker keeps no target, Showdown the chosen slot; battle 53, turns 10 and 13), and a Giga Drain that hit the other
   foe after its chosen target fainted (the tracker keeps the line's target; battle 5, turn 15). The engine is not affected
   (the bridge gives no target and the cell is `Instruct needs the target of {Name}'s last move.`); only the rollouts' battle.
   Both are the AI's own Pokémon, whose chosen target is its own earlier choice (not hidden), which the belief battle could
   take instead. The fuzz's other 188
   differences are T2's known PP counting (a Pressure holder that a line does not name, W1B-T2.md).
4. **A called Instruct** (Sleep Talk or Copycat calling it: pinned Instruct has no `failcopycat` or `nosleeptalk` flag)
   keeps `Instruct is not modelled in 2v2.` (`runCalledStatus`: kind X with no early branch); 1 cell in the fuzz.
5. **The Moves pane under a third Pokémon's Unnerve or As One** keeps `As One (Spectrier) is not modelled in 2v2.` where the
   turn is ready (F30d: K's stand-ins run in the turn's searches only; the pane reads the attacker's own ability).
6. **Kept narrow, each with its reason:** Symbiosis after any item use but a Fling (`EVENT_THIRD_PARTY`), and after a Fling
   where the passed item acts at once (`Fling with Symbiosis is not modelled in 2v2.`); two stage reactions with no plain
   target in one spread move (`{Move}'s effect on {Name} from more than one target is not modelled.`, INT-SPE-02); a spread
   user's Berry with Innards Out or Aftermath (`Rock Slide with Innards Out is not modelled in 2v2.`, K-IO-05); a landing into
   Cotton Down or a knocked-out Innards Out holder (`Future Sight with Cotton Down is not modelled in 2v2.`) and into an intact
   Disguise (`Intact Disguise takes the first hit.`); W's two `berryBetweenHits` corners.
7. **Wave 2:** the switch family (`{Name} switches out: the replacement is not known.`, Eject Pack, Eject Button, Red Card,
   Emergency Exit, Wimp Out) and the bench.
8. **Census reasons §2.4 keeps:** Champions `Encore needs …` 206, `Disable needs …` 24, `Imprison needs …` 12, Trace's random
   foe 9, `Beat Up: party needed.` 8, Friend Guard's row limit 1; SV `Harvest needs …` 14 (§3).
9. **Landing ×16 on a spread-heal turn:** on the 2 + 1 sample turns whose end of turn would pass 200 000 entries with a
   landing's 16 rolls, the result would be `Too many cases to follow.` (SPEC2 risk 5's fallback); no sample turn has a landing.
10. **Optional items not done:** E2's item 7 (the landing's `side` on `futureMove`), T2's `validate()` for a charged move its
    Pokémon cannot learn.
11. **Cosmetic:** the budget probe's header line still says "integration 1a" (`int1b/census/budget-probe.ts`).
12. **Not checked live:** the 2v2 page signed in (static renders only, §4).
