# Integration 2 (status2, ADDENDUM2 §8.7 item 3)

Wave 2 (switch-outs with a replacement, the user's Q1 = R) merged into this tree: Step 2's contract, the four tracks R-U, R-E,
R-T and R-V, and the gap fixer's pass, with every track's one-line ask resolved and STEP2's integrator ask 7 done. Every case
that loads was then run against pinned Showdown c23d2e94 and the app, and the gates were run. Integration 2 was three agents in
turn (oracle and code; census and layout; Training), then a last pass that re-ran the code gates on the final tree and wrote
this file. "main" means 4008ee8: the scratch worktree `$SP/maintree`, run through `TSX_TSCONFIG_PATH`. "1b" means the tree
INTEGRATION-1B.md left, "Step 2" the tree after STEP2.md, and "wave 2" the wave-2 agents' final tree (checkpoint a580e13).
`$SP` is the session scratchpad, `/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad`; every
gate log is in `$SP/int2/logs/`.

## Status

- **Branch:** `calc-2v2-status-2`, checked at the start and before the report by each of the four agents.
- **What did not happen:** nothing was committed, pushed, switched or merged. No stub (all 20 still begin with
  `// CLOUD-SESSION STUB`), no `.claude/`, `node_modules`, CastMirror or RaidCard file was touched. No `next build` ran,
  nothing ran against live Supabase, no seed script ran, no credentials were typed. `design/census-sim.out.json` was put back
  after the census run and is still main's baseline (sha256 01e7a49f…).
- **Line endings:** every file edited at integration 2 is LF in this checkout and stays LF (CR count 0); this file too.
- **Record:** the edits were made in place, not as patch scripts. `build/int2/int2.diff` is the whole change against a580e13
  (19 tracked files and the 2 new ones). The gate scripts are in `build/int2/` (bench, golden row diff, source-test overlay),
  `build/int2/census/`, `build/int2/render/`, `build/int2/tools/` and `build/int2/training/`; §3 names each.
- **Order:** the last app change is the Commander newcomer (`doubles-switch.ts`, 03:21 UTC); the last change of any code is the
  Training conformance harness fix (`scripts/training/conformance.ts`, `scripts/training/lib/engine-range.ts`, 04:04), which no
  app file and no oracle tool imports. The last pass re-ran on the final tree: the oracle, changed-cases, the regeneration
  (dry run: no row changes), `npm run check`, `npm run test:battle-data:source` (in place and with the scratch cache),
  golden-1v1, the wave 2 runner, the harness tests, the bench and the layout check. The census sample, the budget probe and
  every Training gate ran after the last app change; `leak:training` and `eval:training` ran before the conformance-only fix,
  which neither imports, and `conformance:training` ran again after it (§3).
- **Missing files and coverage.** This cloud tree lacks gitignored folders that were not pushed from the user's machine:
  `2v2/fix-engine`, `2v2/review-engine`, `2v2/fainted-engine`, `zmove-status`, `serene-arceus`, `forms-iceface-fling`,
  `ngas-pp`, `status-eot/{fix-engine,verify-engine,review,build/verify-eot-probes}` (their 20 case files are empty stubs), and
  also `verify/v1/fixtures`, `v3/gen`, `v3/gen-r`, `v3/logs`, `v3/tools`, `v3/tsc`, `v3/app-hz`, F's `fling/golden-before`
  baseline and `fling/golden-diff.ts`, and most of `status2/build/int1b` (only `tools/`). So:
  - **544 of the 2331 stored oracle ids cannot load and were not run.** Every oracle count below is 1769 stored cases that load
    plus the 176 wave 2 cases: 1945 of 2331 + 176.
  - 282 of those 544 have rows in `tests/unit/doubles-turn-showdown.test.ts`; they are kept byte for byte and in place
    (`gen-tests.ts --keep-rows`), not regenerated, and they pass.
  - Four harness tests fail on missing files only (V1 ×2, V2 ×1, V3 ×1); they were not weakened (§3).
  - `node_modules/.cache/champions` holds only the pokemon-showdown archive and its extraction: the compiled dex
    (`showdown-dex-c23d2e94…`) and the damage-calc source archive (`damage-calc-e7fd7e59….tar.gz`) are missing. In place
    `npm run test:battle-data:source` fails 9 of 11 files before a test runs; with a scratch source cache 8 files run and pass
    (63 tests), and 3 files (91 tests) cannot run (§3).
  - The golden comparison against the golden from before wave 1a (`fling/golden-diff.ts`) cannot run; it is replaced by a row
    diff of main's golden against this tree's, which gives the same 110 Fling rows (§3).

## 1. The merge

### Wave 2 parts (what went in; each part's notes say how)

| Part | What went in | Notes |
|---|---|---|
| Step 2 | The R contract (`DoublesTurnInput.bench`, `replacement`, `hazards`; `DoublesTurnResult.replaced`, `hpEntered`; `DoublesEndOfTurn.hpEntered`, `replaced`; `DoublesHit.id`, `DoublesResidual.id`, `DoublesOutcomeMon.id`, `DoublesOutcome.benched`; `MonState.id`, `World.benched` / `bench` / `switching`), `sideCanSwitch` at every `canSwitch` reader, `syncOccupants`, the hooks R-E filled, `REASONS.entersWithGas`, `benchIssues`; behaviour unchanged (2331/2331 byte-equal) | STEP2.md |
| R-U | The calculator's Bench (per side, from its roster, at most four), Replacement (`Next on the bench` or a bench Pokémon), Hazards (Stealth Rock, Spikes, Toxic Spikes, Sticky Web, G-Max Steelsurge), `Lands this turn` over the bench, the mapping (`withBench`), the reset rules, and the switches on the cards and in the turn panel (`Switches after the turn`) | W2-R-U.md |
| R-E | `doubles-switch.ts` (replaceSlot, betweenActions, drags then request rounds in Speed order, the entry pipeline: hazards, entry abilities and items in Speed order, Imposter, the gas stand-in, a second Eject Pack, switch-out effects, Baton Pass and Shed Tail copies), identity (names, HP and the input view follow the occupant), the end of turn and E2 with benched Pokémon, Assist from the bench's moves, Beat Up over the bench, Pursuit at a switching target at 80 power, Red Card with Life Orb or Shell Bell kept as a reason, Sheer Force and the after-move items | W2-R-E.md |
| R-T | Training passes the real bench (the AI's exactly, the player's from the belief world), the replacements (the player's healthiest, the AI's ReplacePolicy), the hazards with layers, the prelude's replacement, a benched landing source; `inputKey` and `postFromOutcome` follow them; the tracker's chosen targets (INTEGRATION-1B open item 3) and Court Change; three fixes found by its fuzz | W2-R-T.md (with "Finish (cloud session)") |
| R-V | The oracle answers mid-turn and after-residual switch requests from the bench and takes one path per bench Pokémon for a drag; `compare.ts` checks `replaced`, `hpEntered`, the newcomers' hits and residuals by id, and E2 by identity; 129 wave 2 cases (G4-SWX-01…52, IN-BNC, IN-HZD, IN-FSL-02, T2E-BL, T2P-AST, T2P-BTR, CQ-PUR-R), each validated against whole-turn replays; `gen-tests.ts --keep-rows` | W2-R-V.md (with its Finish) |
| Gap fixer | The critic's 8 gaps: Eject Button and Red Card behind a face with a bench (R-E's faces diff), two Eject Button or Red Card holders in one spread move, Pursuit at a Baton Pass user (and C30 reading the turn's start), Supreme Overlord on a newcomer, Embody Aspect and a Terastallized Ogerpon newcomer, `DoublesStep.id` and `DoublesResidual.otherId` (the UI names the newcomer), the oracle checking a newcomer's own step and a second leave, `DoublesTurnInput.replacementOrder` (Training's player follows Q9 on a second pick); minor items (G4-SWX-67…81, the Bench's wider readers, Training's pending Healing Wish); 46 new cases (175 in all) | W2-GAPFIX.md |

**The tracks' asks, resolved:**
- STEP2's integrator ask 7 (the hazard facts with the pre-turn hazards): done here (fixes table).
- R-U: (1) `hpEntered[slot][id].start` stays the bench HP at the turn's start (R-V compares it so); (2) moves-phase switches are
  stated by their step facts (R-E's texts, and see the duplicate fixed below); (3) `DoublesStep.id`, `DoublesResidual.otherId`:
  the gap fixer's gap 6; (4) `turnBenchNames` with a null slot: open (§5); the docs' quoted texts: checked here (below); the
  signed-in live check: open (§5).
- R-E: need 1 (the faces diff): the gap fixer's gap 1; needs 2 and 3 (`exactMoves` as `moves`; the REEXPECT skip for wave 2
  cases): R-V's F1; need 4 (regenerate the generated test): done (§2). Checked here: all three are in the tree.
- R-T: the `DoublesOutcomeMon.id` doc line: applied by the gap fixer (checked); open 1 (a second switch on one side): the
  player's side follows Q9 through `replacementOrder` (gap 8), the AI's later pick stays an approximation (§5).
- R-V: `changed-cases.ts diff … --wave=all` at integration 2: done (§2); the contract gap and the Pledge / Round sourceEffects:
  open (§5).
- Gap fixer: the regeneration with `--keep-rows`: done (§2); the sync to `wip/status2-cache`: open (§5).

### The integrator's own changes (ADDENDUM2 §8.6 as for 1b, §8.7 item 3)

**Hazard facts (STEP2 ask 7).** `holdsHazards(w, side, kernel.baseInput.hazards)` (new, `doubles-world.ts`, there to avoid an
import cycle) counts this turn's hazards and the pre-turn ones the side holds now (through `SideState.hazardsFrom`: its own,
the other side's after Court Change, none once cleared). Court Change's `moved`, Defog's and G-Max Wind Rage's `… the hazards on
both sides are cleared.` and Tidy Up's `… the hazards are removed from both sides.` read it. Facts only; no number changes.

**Third-party sets** (`doubles-actions.ts`): the switch family (`ejectpack`, `ejectbutton`, `redcard`, `emergencyexit`,
`wimpout`) moves from `EVENT_THIRD_PARTY` to `MODELLED_THIRD_PARTY`; `EVENT_THIRD_PARTY` (and so `GUARDED_THIRD_PARTY`) is
now `{symbiosis}`. `tests/source/doubles-third-party.test.ts` expects the family modelled and the guarded set exactly
`[symbiosis]`.

**REASONS:** no key lost its last call site in wave 2, so none was removed. `switchesOut` keeps two call sites reachable
without a bench: `doubles-switch.ts:110 switchOut` (the leaver's side has no bench and an action comes after: the calculator
without a Bench; stored cases such as ER32a and E32a) and `doubles-eot.ts:311 worldGuard` on `w.leaving` (set only by that
no-bench branch). `needsParty`'s doc comment now says what it is (Assist with no bench, or a party member's moves not given);
stale wave-2 comments in `doubles-calling.ts` and `doubles-presence.ts` are updated (comments only).

**`status-table.ts`:** regenerated into scratch with `gen-status-table.ts`: byte-identical, the classification unchanged
(`{"M":186,"X":38,"C":19,"S":7,"N":20,"P":1}`), so not rewritten. **`status2-hooks.test.ts`:** no change needed (8/8).

**Docs** (`docs/champions-calculator.md`), checked against the app's texts from a probe:
- changed: Assist (`Assist needs the moves of Liepard's party.` only without a Bench or with unknown moves; with a Bench the
  turn fact `Assumes no Pokémon of Liepard's party fainted before this turn.`), Beat Up's party from the Bench, Pursuit at 80
  into a Pokémon switching out by its player's choice (not Baton Pass; USUM), the end-of-turn switch reason only with no Bench;
- added: the switch facts (`Ambipom switches out; Corviknight comes in.`, `Roar: Garchomp is dragged out; Corviknight comes
  in.`), the newcomer's entry (`Corviknight loses 21 HP (Stealth Rock).`, Heavy-Duty Boots and Magic Guard, grounding, entry
  abilities and items, Eject Pack), `Stealth Rock fails: it is already up on the opponent's side.`, and one sentence on the
  newcomer reasons that remain (a Neutralizing Gas newcomer; a Tatsugiri beside a Dondozo; a newcomer whose Shields Down,
  Schooling or Ice Face would change its form);
- no new text names a side or position (left or right) or gives an instruction. The "Battle states that cannot be set here"
  list is untouched.

**`tests/unit/doubles-outcomes.test.ts`** (conformance check 8; it failed the first `npm run check` with a TypeError on the
wave 2 rows): its input builder now mirrors the generated test (a `benchId` landing, `exactMoves`, and bench, replacement and
hazards through `benchInput`). With a bench it compares `hp` by identity (the starting Pokémon from `DoublesOutcome.benched`,
`slot:{slot}`) and each newcomer's E2 HP against `hpEntered` (`endOfTurn.hpEntered` when the end of turn applied). 171 bench
rows run, 147 with newcomers.

### Fixes the integration needed (beyond the asks)

Each engine change is exact against pinned Showdown c23d2e94; each fix has a regression test that fails on the code before it
(checked by restoring the earlier files temporarily: the hazard tests `2 failed | 62 passed`; doubles-switch `3 failed | 58
skipped (61)`; calculator-doubles-bench `1 failed | 32 skipped (33)`; the conformance-range test 2 failed).

| Fix | Why (pinned source) | Cases | Test |
|---|---|---|---|
| **Hazard facts with the pre-turn hazards** (above; `doubles-world.ts holdsHazards`, `doubles-field.ts` courtChange and defog, `doubles-abilities.ts` Tidy Up, `doubles-max.ts` windRage) | PS/data/moves.ts courtchange, defog, tidyup, gmaxwindrage move or remove the side conditions whatever turn set them | FS08c-champions (stored; listed by R-V's `listChanged2`; matches the oracle) | `doubles-field-side-items.test.ts` (Defog FS08c-like, Court Change with only pre-turn Stealth Rock and its E2 `hazardsFrom`, Tidy Up), `doubles-max.test.ts` (G-Max Wind Rage): `2 failed \| 62 passed` on the four HEAD files, `64 passed` now |
| **A Tatsugiri newcomer with no Dondozo beside it** (found by the census sample with a bench, 1 SV turn): `abilityEntry` returns with no effect after the pair check (`if (ability === "commander") return [w];`); before, `Commander starting on Tatsugiri is not modelled in 2v2.`. A Tatsugiri beside a Dondozo keeps `notIn2v2("Commander")` (G4-SWX-20) | abilities.ts commander onStart → onUpdate: no ally, a fainted one or one that is not a Dondozo returns | G4-SWX-82-sv (new, `cases-r.ts`): oracle 306 runs; `--validate` equal to 1, 1 and 88 whole-turn replays; the app matches. The census turn itself: not estimated before, ready after | `doubles-switch.test.ts` "a Tatsugiri newcomer beside a Pokémon that is not a Dondozo…" (Body Slam 78–93, no commanding volatile in E2) |
| **No `Assumes {Name} has not used Minimize.` for a newcomer** (`doubles-abilities.ts minimizeFacts` skips `entered`) | moves.ts minimize condition `noCopy`; a volatile ends as its holder switches out, so a newcomer has none | text only: 71 wave 2 app results lose the fact (74 lines); no number changes | `doubles-switch.test.ts` "a newcomer has not used Minimize…" |
| **A status move's switch is stated once with a bench**: the plain `{Name} switches out.` of `doubles-status.ts switchOut` is only for a side with no bench. Before, Parting Shot read `Incineroar switches out.` then `Incineroar switches out; Farigiraf comes in.`, and Roar `Garchomp switches out.` then `Roar: Garchomp is dragged out; …`; with no Pokémon left nothing switches, so the plain fact was wrong there too | one switch is one event; with no Pokémon to come in Showdown switches nothing out (battle-actions.ts forceSwitch `canSwitch(target.side)`, :1290 selfSwitch) | text only: 24 wave 2 app results lose the fact | `doubles-switch.test.ts` "a status move's switch with a bench is stated once…" (and without a bench the fact stays) |
| **The turn panel shows a newcomer's entry losses** (`DoublesTurn.tsx`): `hpEntered[slot][id].losses` (`Corviknight loses 21 HP (Stealth Rock).`) are listed with the turn's losses, and an after-residual newcomer's (`endOfTurn.hpEntered`) under its `{Name} comes in.` in `Switches after the turn`. Before, they were in the result and in the docs but shown nowhere (found by the layout check) | — (display of the engine's own record) | the hazards page (§4) | `calculator-doubles-bench.test.ts` "lists each newcomer's losses as it came in…" (real engine: U-turn onto Stealth Rock + Spikes; Eject Pack after Syrup Bomb onto Stealth Rock) |
| **Conformance 4b counted a correct engine result as outside its range** (Training harness, not the engine): a bench Pokémon that comes in on only some of E2's paths had no range on the paths where it stays on the bench. Cell #48 (Champions, pool E): the AI's Espeon uses Baton Pass while Gengar's Shadow Ball targets it at a Speed tie (both Timid, 32 Speed points, −1): Sneasler comes in and takes 39–54 (1/2), or Espeon faints and Sneasler stays at 157 (1/2); 4b had Sneasler at [39, 54] and counted the 15 samples where Gengar moved first as outside. New `scripts/training/lib/engine-range.ts widenWithOutcome`: occupants and leavers as before, plus each input bench Pokémon not seen in that outcome at `build.currentHP ?? max HP` (as `postFromOutcome` keeps it) | — (the outcome's own bench state) | conformance-SVA cell #48: 1532/1547 → 1547/1547; the whole 4b 57295/57310 → 57310/57310 | `tests/unit/training-conformance-range.test.ts` (2 tests; both fail without the fix, the first with `expected [ 39, 54 ] to deeply equal [ 39, 157 ]`) |

**Census instruments** (record, not app): `int2/census/diff-census.ts` replaces int1a/int1b's `diff-census.mjs` (missing here)
and folds every name with the runtimes' species names; `census-bench.ts` runs census-sim's own turns (drawn verbatim: its plain
run equals `census-sim.int2.json`) with 2 bench Pokémon per side from a second random stream, once plain and once with Stealth
Rock + 1 Spikes layer, drawing only bench Pokémon the engine accepts (the first draw added 97 input issues: Terastal forms,
Keldeo-Resolute, Meloetta-Pirouette); `budget-probe.ts` is int1a's probe on a copy of this tree's `app/lib/battle`, with
recorders for wave 2's request rounds and healthiest-pick combinations and a `--bench` mode; `int2/tools/app-diff-facts.mjs`
lists the wave 2 app results that change (changed-cases prints only stored ones).

## 2. The oracle

The last pass ran these on the final tree; the earlier runs of the two integrator agents are given with them.

- **Every case that loads, `STATUS2_REEXPECT=1a,1b`.** Command:
  `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts` (writes `results/compare.json`
  and `app-results/`; the sets before each run are kept in `$SP/int2/app-results-before` (the oracle/code agent's),
  `app-results-before-2` (the census agent's) and `app-results-before-3` (the last pass's)). Output (`compare-3.log`, 25.8 s):
  ```
  1945/1945 cases match.
  ```
  **1945 = the 1769 stored cases that load + the 176 wave 2 cases** (175 + G4-SWX-82-sv). The 544 stub ids (of 2331 stored) are
  not run. Earlier: `1944/1944 cases match.` (oracle/code agent, before G4-SWX-82), `1945/1945 cases match.` (census agent).
  1b had `2331/2331 cases match.`; wave 2's own last run, `1944/1944`.
- **`changed-cases.ts diff <before> verify/app-results --wave=all`** (without `STATUS2_REEXPECT`, as in 1b):
  - against the oracle/code agent's set, taken before integration 2's first compare (`changed-cases-3.log`):
    ```
    FS08c-champions: R-E / integrator: the input's pre-turn hazards (own: spikes; opponent: stealthrock) now reach the app (hazardFails, the hazard facts): 1 paths changed (result.steps.0); matches the oracle

    1945 cases: 1768 unchanged, 1 stored cases changed, 0 failing the gate.
    ```
    The one change is the hazard-fact fix: the step fact `Defog: the hazards on both sides are cleared.` is added; no number
    changed. 0 changed stored cases are NOT LISTED.
  - against the last pass's set (`changed-cases-3b.log`): `1945 cases: 1945 unchanged, 0 stored cases changed, 0 failing the
    gate.`
  - `changed-cases.ts` prints no wave 2 case (they are new to its stored set), so `int2/tools/app-diff-facts.mjs` lists them:
    against the census agent's set (`app-diff-2.log`) `2512 files: 89 changed, 1 new`, every change a removed fact (74
    `Assumes {Name} has not used Minimize.` lines in 71 results, 24 `{Name} switches out.` in 24, 6 results with both), the new
    one G4-SWX-82-sv; no number changed. Against the last pass's set (`app-diff-3.log`): `2512 files: 0 changed, 0 new`.
    Against the first set (`app-diff-3-vs-before.log`): `2512 files: 1 changed, 176 new` (FS08c-champions).
- **The generated test,** `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts
  --keep-rows=tests/unit/doubles-turn-showdown.test.ts`:
  - oracle/code agent (`gen-tests.log`): `keep-rows: 1985 rows before, 282 kept as they were (their case does not load), 171
    new` / `wrote 2156 cases to /home/user/pokedrafts/tests/unit/doubles-turn-showdown.test.ts (0 cases that do not agree with
    the app left out)`; sha256 c5eeff31… equals W2-GAPFIX's dry run;
  - census agent (`gen-tests-2.log`): `keep-rows: 2156 rows before, 282 kept as they were (their case does not load), 1 new` /
    `wrote 2157 cases …`; the new row is G4-SWX-82-sv; sha256 72a4070e…;
  - last pass, dry run into scratch (`--out=$SP/int2/doubles-turn-showdown.regen-3.test.ts`, `gen-tests-3.log`):
    `keep-rows: 2157 rows before, 282 kept as they were (their case does not load), 0 new` / `wrote 2157 cases …`; byte-equal
    to the file in the tree (sha256 72a4070ed1174a0ddbe7ea3a5783f43456a117f3053083fd782e66f45bd45e01), so it was not written
    again. No run logged a row as `has a different row now`.
  - An independent row check (`$SP/int2/rowcheck.mjs`, `rowcheck-3.log`) against the file before integration 2 (and against
    HEAD's): `before 1985 rows, now 2157; unchanged 1985, changed 0, gone 0; stub rows 282, byte-equal 282; order kept true;
    new 172`. The code lines differ in two places only (the `exactMoves` line and `CASES_6`).
  - `npx vitest run --config vitest.unit.config.ts tests/unit/doubles-turn-showdown.test.ts`: `Tests  2157 passed (2157)`
    (`gen-test-run-2.log`; 1b: 1985).
- **Wave 2 cases on the v3 runner** (`npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v3/run.ts --wave2 --quiet`, and
  with `STATUS2_REEXPECT=1a,1b`; `v3-wave2-3.log`, `v3-wave2-reexpect-3.log`): `176/176 cases match.` both times (oracle/code
  agent: `175/175 cases match.`; census agent: `176/176 cases match.`). The new case: `v3/run.ts G4-SWX-82 --oracle` gives
  `G4-SWX-82-sv: oracle 1264 ms, 306 runs` / `G4-SWX-82-sv [R-E]: ready: match`, and `sim-dfs.ts G4-SWX-82-sv --validate`
  `equal to 1 whole-turn replays` (lowest), `equal to 1` (highest), `equal to 88 whole-turn replays` (all).

## 3. Gates

- **`npm run check`** (lint, typecheck, unit tests), final run by the last pass (`check-5.log`, real 7m4.9s, exit 0); eslint and
  tsc print nothing:
  ```
   Test Files  261 passed (261)
        Tests  8010 passed | 1 skipped (8011)
  ```
  History: the oracle/code agent's first run failed only `doubles-outcomes.test.ts` (`Test Files  1 failed | 259 passed (260)` /
  `Tests  1 failed | 8002 passed | 1 skipped (8004)`, the TypeError on the wave 2 `benchId` landing rows, fixed in §1), then
  260 / 8003; the census agent 260 / 8008 (3 doubles-switch tests, 1 bench UI test, 1 generated row); the Training agent 261 /
  8010 (the new conformance-range file, 2 tests). 1b: 255 / 7699; Step 2: 256 / 7710.
- **`npm run test:battle-data:source`** cannot pass in this container (the environment, not the code). In place
  (`battle-data-source-3.log`):
  ```
   Test Files  9 failed | 2 passed (11)
        Tests  30 passed | 91 skipped (121)
  ```
  Every failure is a missing file in `node_modules/.cache/champions`, which this session may not write: `The pinned Showdown
  dex is missing (…/showdown-dex-c23d2e942c9c0daadb13a7162a385bf78e3c9353/data/abilities.js); run npm run data:champions.`
  (and items.js, moves.js) and `Offline source archive missing: damage-calc-e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d.tar.gz.`
  With a scratch source cache (`SOURCE_CACHE=$SP/int2/srccache npx vitest run --config
  scripts/.cache/calc-audit/status2/build/int2/vitest.source-overlay.config.mts`, `battle-data-source-overlay-3.log`):
  ```
   Test Files  3 failed | 8 passed (11)
        Tests  63 passed | 91 skipped (154)
  ```
  The scratch cache holds symlinks to the pinned files (the pokemon-showdown archive's sha256 matches its pin, 640e41b1…) and
  the dex compiled by `int2/compile-dex.mjs` (build-champions-data's `compileShowdownDex` verbatim); `int2/sources-overlay.mjs`
  points the source tests at it. The 8 files that run pass: doubles-third-party, status2-hooks, doubles-residuals,
  doubles-items-takeable, doubles-spread-reactions, doubles-substitute-census, stolen-berries, training-format (the 8 alone:
  `Test Files  8 passed (8)` / `Tests  63 passed (63)`, `battle-data-source-overlay-8b.log`). **Not run, 91 tests:**
  battle-data.test.ts (66), doubles-ability-table.test.ts (6), doubles-status-moves.test.ts (19): all three need the
  damage-calc archive (pin sha256 ca28c26b6728b1a0fe7c08189abe8f1da61d2f1eb1d9d1bf0fc36039ff9dae84; a codeload download gave
  b3e03aaa…, not the pinned bytes, and was deleted). `status-table.ts` is unchanged (§1), which keeps the risk on
  doubles-status-moves low. 1b: `Test Files  11 passed (11)` / `Tests  153 passed (153)`; Step 2: 154 (the same 154 here,
  63 run + 91 not).
- **golden-1v1:**
  - `golden-1v1.ts --check` (last pass, `golden-check-3.log`): `golden-1v1: 254 cases byte-equal (8500 ms)` (oracle/code agent
    8611 ms, census agent 8620 ms).
  - Against main (the script copied into scratch folders so the stored golden is not overwritten; main run from the
    maintree with `TSX_TSCONFIG_PATH`; `int2/golden-rowdiff.mjs` on the two `full.json.gz`): main
    `golden-1v1: wrote 254 cases (18152 rows) in 8690 ms` (`golden-main.log`); this tree, last pass
    `golden-1v1: wrote 254 cases (18152 rows) in 8633 ms` (`golden-now-3.log`), then (`golden-vs-main-3.log`)
    ```
    254 cases, 18152 rows compared: 110 rows differ (110 Fling rows, 0 other rows); 0 other differences
    ```
    110 cases differ in one row each, every one moveId fling: Champions 26, USUM 24, SwSh 26, SV 34. The ids and rows are in
    `int2/golden-changed.json`; the last pass's list is byte-equal to the oracle/code agent's (`golden-vs-main-2.log`, the same
    line), and so is main against the stored golden. F's `fling/golden-changed.json` is missing here, so they could not be
    matched to it by id. This tree's summary `golden-1v1.json` is byte-equal to the stored one.
- **Bench** (`int2/bench.sh 4`: int1a's `bench-stored.ts` set rule, every loaded case but wave 1a's: 1334 cases + 7 BENCH + 200
  fuzz turns; main and this tree alternating in separate processes, 4 rounds). Final run by the last pass (`bench-3.log`,
  2m17s):
  ```
  benchH-4 turn p50 5.76 p95 16.73 max 64.5 | moves p50 21.45 | statuses {"ready":1056,"not-estimated":481,"issues":4} | reference 30/30
  benchC-4 turn p50 8.64 p95 21.35 max 50.2 | moves p50 31.84 | statuses {"ready":1485,"not-estimated":52,"issues":4} | reference 30/30
    round 4: paired ready turns 1055: main p50 8.16 p95 18.18 | now p50 8.17 p95 21.41 | per-turn ratio median 1.056 p90 1.823
    round 4: newly ready 430: p50 9.68 max 50.2 ms
    round 4: moves pane p50 main 21.45 now 31.84; max now 64.2
  ```
  - Per-turn ratio median over the 4 rounds: 1.231, 1.126, 1.122, 1.056 (p90 1.82–2.09); the oracle/code agent's run before
    the census-found fixes (`bench.log`): 1.094, 1.191, 1.030, 1.097. Turn p50: main 5.19–5.76 ms, now 8.64–9.44 ms (the 430
    newly ready turns are in it). Worst turn: main 39–65 ms, now 50–69 ms. Moves pane p50: main 21.5–25.5 ms, now 25.2–31.8
    ms. Reference mode is 30/30 in every run. The one case more than in the first run (481 + 1485) is G4-SWX-82-sv.
  - This cloud machine is about 2× slower than 1b's Windows machine and the cross-process timings are noisy, so two in-process
    checks were added (`int2/paired-ab.ts`: each engine's time per turn is the minimum of 5 alternating runs, over the 1769
    cases without a bench, both engines calculating the same input). Against main, last pass (`paired-ab-main-3.log`):
    ```
    paired ready turns 973 (min of 5 alternating runs each): head p50 5.19 p95 10.66 | now p50 5.72 p95 11.74 | per-turn ratio median 1.078 p90 1.247; sum ratio 1.109
    ready now and not in head: 771; ready in head and not now: F2-G3-usum, INT-SPE-02-sv
    ```
    (oracle/code agent: median 1.089, p90 1.271, sum 1.115). Against 1b's engine (`step2/pre`, oracle/code agent,
    `paired-ab-1b.log`): `paired ready turns 1744 …: head p50 5.84 p95 11.90 | now p50 5.80 p95 11.66 | per-turn ratio median
    0.991 p90 1.052; sum ratio 0.989` / `ready now and not in head: 0; ready in head and not now: none`. The moves pane in
    process (`microbench-ab.ts … moves`): against main median 0.993, against 1b 0.972.
  - So wave 2 adds no per-turn cost over 1b's engine; the +8 % against main on this machine was already there in 1b's engine
    (1b's own report measured −2.5 % cross-process on Windows). The two turns main gives ready and this tree does not are
    kept reasons: INT-SPE-02-sv (1b: `Electroweb's effect on Kilowattrel from more than one target is not modelled.`, main's
    number was wrong) and F2-G3-usum (`Natural Gift with Embargo is not modelled in 2v2.`, wave 1a's types-volatiles guard).
  - The whole stored set in process (`microbench-turns-main.log`) takes ×1.61 main's time (median of passes): this tree
    calculates 771 more turns. Against 1b's engine the same set is ×0.972 (`microbench-turns.log`).
- **Harness tests** (last pass; `harness-v1-3.log`, `harness-v2-3.log`, `harness-v3-3.log`):
  ```
  v1: Tests  2 failed | 16 passed (18)
  v2: Tests  1 failed | 25 passed (26)
  v3: Tests  1 failed | 24 passed (25)
  ```
  Only the known stub failures, as R-V's F4 lists them; nothing was weakened: V1 `ENOENT … v1/fixtures/G4-OPP-11-sv.oracle.json`
  and RT-RV02's `expected '' to match /fieldSet/` (a stub id); V2 `R09: expected false to be true` (a stub id); V3
  `Error: no case ZS16` (zmove-status is a stub).

**Training gates** (the Training agent, each alone on the machine, after the last app change; leak and eval before the
conformance-only harness fix, which neither imports; conformance again after it; logs in `$SP/int2/logs/`, scripts in
`build/int2/training/`):

- **`npm run conformance:training`** (defaults, run `conformance-SVA`). Final run after the 4b fix (`conformance-2.log`, real
  23m25.3s, exit 0): every row passes.
  ```
  | 1. Tracker parity | 100% | 840/840 (100.00%) | PASS |
  | 2c. One-turn logs, no hidden duration | ≥ 99.5% | 289/289 (100.00%); with one: 7/8 (report); turn: requests 252/252, logs 245/245; switch: requests 45/45, logs 44/44 | PASS |
  | 4a. Bridge stats/HP mismatches | 0 | 0 over 400 Pokémon | PASS |
  | 4b. Clean rollouts inside the E2 support | ≥ 99% | 57310/57310 (100.00%) over 2994/3000 engine cells | PASS |
  | 8. E2 vs Showdown (doubles-outcomes + doubles-turn-showdown tests) | all pass | Test Files  2 passed (2); Tests  2161 passed (2161) | PASS |
  | Runner errors | 0 | 0 | PASS |
  ```
  - The other rows: belief battles 297/297; requests 100.00 % / 100.00 % of 297; default settings 288/288, 288/288; 4d
    (report) `carried.charging 30, carried.disable 69, carried.ingrain 30, carried.saltCure 24, carried.stall 707,
    turn.replacement 2712, turn.substitute 1322, turn.substitutehit 130, turn.trick 2326`; 4c (report) `2481/2994 engine cells
    (82.87%)`; splits 33.7 % / 35.0 % / 25.1 %; choice strings `23737/23785; unavailable (hidden trap shown) 48`; effect census
    0; 9a `30/30 hash, 30/30 boards and result (5 forfeited)`; 9b `30/30; largest record 41 KB`; 9c `6/6 hash, 6/6 boards and
    result; Resume 6/6`.
  - The first run (`conformance.log`, 20m0.8s, exit 0) differed only in 4b, `57295/57310 (99.97%)` with 4d `outside.other 15`
    (all 15 from cell #48: the harness fix in §1), and in the time-dependent cells (9a 6 forfeited, 9b 44 KB). A probe
    (`int2/training/saved-probe.ts`; `saved-probe-{a,b,main-a,main-b}.log`) shows the saved check's 30 battles differ between two
    processes on main too, so that variation predates this branch; within a run, replay and Resume equal the original.
  - Against 1b: 4b 57662/57662 over 2994/3000; check 8 1989 tests (now 2161: the 2157 generated rows and doubles-outcomes' 4).
- **`npm run leak:training`** (defaults; `leak.log`, real 55m24.8s, exit 0): all 15 rows pass.
  ```
  | L1-sp | ≥ 50 compared, 0 differences | 0 differences in 197 | PASS |
  | L1-bench | ≥ 50 compared, 0 differences | 0 differences in 310 | PASS |
  | L2 (your direction, youSee closed) | 0 hits over 40 battles | 0 hits in 511 messages over 40 battles (8 forfeited on a locked turn) | PASS |
  ```
  - L1: `-nature 0 differences in 236`, `-item 240`, `-ability 246`, `-moves 282`, `-hp 137`, `-dice 70`, `-dice-eot 72`,
    `-choice 131`; the two settings work: `174/214 differ`, `83/144 differ`.
  - L2 saved battles: `40 replays (281 boards; 40 of 40 equal to the battle's boards), 10 resumed, 241 checkpoints sealed`.
  - L2 Illusion and Transform: `0 hits in 190 messages over 16 battles; 6 Illusions ended, 16 with a Transform, 3 look-alike
    decisions; 16/16 replays equal, 4 resumed`.
  - L1's diff stringifies `services.engineWorlds(cell)`, so the bench, the replacements, `replacementOrder` and the hazards are
    in it. 1b: L1-sp 189, L1-bench 316, L2 506 messages; every row passed.
- **`npm run eval:training -- --gates --scale 1 --shards 8 --run s1-step1`** (main's seeds; `eval.log`, real 67m11.7s, exit 1;
  the run moved to `scripts/.cache/training/eval/int2-s1seeds`, so `s1-step1` is absent): 18 PASS, 4 FAIL.
  ```
  | Reads you − Plays safe, both vs HabitBot | ≥ +5 points (same seeds) | 3.3 pts [-0.7, 7.2] n=400 | FAIL |
  | Turn decision time (Node, worst run) | p50 ≤ 400, p95 ≤ 800, max ≤ 2,000 ms | p50 2125 ms p95 4947 ms max 11324 ms (n=16058) | FAIL |
  | Preview / replacement time | p95 ≤ 150 / ≤ 60 ms | 323 ms / 66 ms | FAIL |
  | Belief update per turn | p95 ≤ 30 ms (closed), ≤ 8 ms (open) | closed 123 ms, open 48 ms | FAIL |
  | Cell methods on pool S (soft) | engine + prelude ≥ 80% | 100.0% of 23262 | PASS |
  | A1.4 status moves used (pool U) | Tailwind, Trick Room, Follow Me, Rage Powder each chosen on some turns | chosen turns {"tailwind":42,"trickroom":13,"followme":5,"ragepowder":1} of usable turns {"tailwind":185,"trickroom":48,"followme":38,"ragepowder":1} | PASS |
  ```
  - HabitBot fails as on main (`4.0 pts`) and in 1b (`2.8 pts`).
  - The three time rows fail because of the machine: 8 shards on 4 CPUs, each shard at about 49 % CPU. Main fails them the
    same way in the paired check below (main's own p50 1.36–1.83 s against the 400 ms gate).
  - The other rows pass: legality 0 errors, 0 engine issues, 0 fallbacks, 0 capped (open n=2600, closed n=200, perfect
    n=400); vs RandomLegal 99.0 %; Plays safe vs MaxDamage 62.0 % (1b 63.0 %); Reads you vs MaxDamage 74.0 % (1b 73.8 %);
    self-play 48.5 % (1b 51.0 %); closed team sheets 99.0 %; open vs perfect −4.8 points; work budget 240 / 160 / 4; dropped
    0; exploitability 0.01 %; determinism 20/20; the three A1.5 rows (keeps 0.0 % each; R1/R2 100.0 %; per-turn 62.0 % against
    first-chance 62.5 %, −0.5 points). Pool S: main 88.5 %, 1b 99.8 %, now 100.0 %.
  - **Paired check** (`int2/training/eval-paired.sh 2 safe-maxdamage-suggested,safe-maxdamage-perfect,safe-random-closed`,
    main and this tree alternating, two rounds, the gate's 8-shard layout, main's seeds; `eval-paired.log`,
    `eval-paired-stats.log`):

    | Run (decisions main / now) | main p50 / p95 / max (ms), r1; r2 | now p50 / p95 / max (ms), r1; r2 | other rows main / now |
    |---|---|---|---|
    | safe-maxdamage-suggested (421 / 424) | 1827 / 4239 / 6351; 1775 / 4040 / 5720 | 2059 / 4938 / 7322; 2013 / 4781 / 7640 | belief p95 37, 37 / 39, 37; preview p95 314, 273 / 342, 296 |
    | safe-maxdamage-perfect (1911 / 1912) | 1385 / 3188 / 6017; 1364 / 3205 / 5960 | 1551 / 3610 / 6866; 1510 / 3560 / 6568 | — |
    | safe-random-closed (1158 / 1143) | 1479 / 3360 / 6327; 1455 / 3269 / 7337 | 1656 / 3661 / 8242; 1750 / 3764 / 8631 | closed belief p95 116, 111 / 132, 135; replacement (switch) p95 68, 64 / 60, 62 |

    Each tree's decisions are identical round to round and equal to the gate run. The code's share, now / main: median p50
    ×1.11–1.16, p95 ×1.12–1.17 (1b: p95 +5–8 %). The cause is wave 2's intended move to the engine: rollouts per decision
    fall from 12.6–16.2 to 0.0–0.3, while engine calls rise from 78–85 to 83–90 and preludes from 28–30 to 31–34 per decision.
    Scaled to 1b's reference machine (main p95 577 ms), now would be about 650–675 ms: under eval's 800 ms gate, above
    SPEC2's 634 ms target (§5).
- **T2's fuzz** (`status2/build/t2-fuzz.ts 60 101`, `t2-fuzz-101.log`, 91 s, exit 0):
  ```
   "mismatches": 188,
   "logsClean": 794,
   "logsSame": 794,
   "issues": 0,
   "notEstimated": 25,
  ```
  `t2-fuzz-all.ts 60 101` prints 188 notes, every one a ` pp: ` line (T2's known PP counting, W1B-T2.md), 0 of another kind.
  1b: `"mismatches": 191`, `"logsSame": 791` (the 3 Instruct logs R-T fixed). Reasons: the Speed tie between switches with an
  entry effect 143 (rollout), terrains ending 29 (end of turn), `Instruct needs the target of …'s last move.` 17 (the player's
  Pokémon), Encore 4, `Instruct with No move is not modelled in 2v2.` 3, a called Instruct 1.
- **R-T's fuzz** (`status2/build/w2-rt/rt-fuzz.ts 60 101`, `rt-fuzz-101.log`, 133 s, exit 0): `"decisions": 1108`,
  `"mismatches": 0`, `"benchChecked": 2210`, `"hazardsChecked": 2210`, `"logsClean": 941`, `"logsSame": 941`, `"engineCells":
  6520`, `"issues": 0`, `"notEstimated": 6` (`Red Card with Life Orb is not modelled in 2v2.`, R-E's kept reason), `"ready":
  7609`, `"replacedOutcomes": 2797`, `"preludeCells": 2523`, `"secondPick": 181`, `"secondPickOwn": 88`, `"policyIssues": 0`,
  `"postChecked": 10176`; equal to R-T's Finish counts for seed 101. The rollouts: the Speed tie between switches 113,
  Substitute HP 15.
- **Training unit tests** (`npx vitest run --config vitest.unit.config.ts tests/unit/training-`, `unit-training.log`):
  `Test Files  60 passed (60)` / `Tests  710 passed (710)`.
- **Which Training gates the last pass re-ran, and why not the others:** none needed re-running. No app file and no Training
  app file changed after the Training gates began (the last app change, 03:21, precedes the first conformance run, about
  03:38); the only later change is the conformance harness fix, after which `conformance:training` was run again in full.
  `leak:training` and `eval:training` do not import `scripts/training/conformance.ts` or `engine-range.ts` (only conformance
  and its test do). The Training unit tests ran again inside the last pass's `npm run check` (261 / 8010).

### ADDENDUM2 §7.3: the census sample and T2E's budget acceptance

The census agent ran these after its engine fixes (the census sample from 03:13, the bench census from 03:15, the budget probe
from 03:20); the app's engine files are the same now (`cmp` against its `post-census-fix` copies). Outputs are in
`build/int2/census/`.

**Census sample** (`census-sim.ts --n=8000 --sv=2000 --seed=7`, unchanged; `int2/census/run.sh`, 1m57s; output copied to
`census-sim.int2.json` / `.out`, `design/census-sim.out.json` put back). The reasons by family, main → 1a → 2, from
`int2/census/diff-census.ts census-sim.main.json int1a/census/census-sim.after.json census-sim.int2.json` (`census-diff.out`):
```
== Champions (usage): 8000 turns, ready 7391, not estimated 609 (7.6%), issues 0; end of turn not estimated 235
== SV (Random Battle Doubles sets): 2000 turns, ready 1746, not estimated 156 (7.8%), issues 98; end of turn not estimated 45
```

| Sample | Ready (main → 1a → 1b → 2) | Not estimated | End of turn not estimated |
|---|---|---|---|
| Champions (8000, usage-weighted) | 6867 → 7296 → 7391 → 7391 | 1133 (14.16 %) → 704 (8.80 %) → 609 (7.61 %) → 609 (7.61 %) | 252 → 233 → 235 → 235 |
| SV (2000, Random Battle Doubles sets) | 1679 → 1712 → 1746 → 1746 | 223 (11.15 %) → 190 (9.50 %) → 156 (7.80 %) → 156 (7.80 %) | 80 → 81 → 45 → 45 |

Every by-family count equals INTEGRATION-1B's: Champions `{Name} switches out: the replacement is not known.` 349 (end 235),
Encore 206, Disable 24, Imprison 12, Trace 9, `Beat Up: party needed.` 8, Friend Guard 1; SV the switch-out 156 (end 31),
Harvest 14. census-sim gives no bench, so the switch family stays `{Name} switches out: the replacement is not known.`: that is
the calculator's own fact for a side without a Bench (STEP2 hook map item 5, W2-R-E.md §4: `switchesOut` stays only where the
input gives the side no bench), not a reason wave 2 left. Issues: Champions 0, SV 98, as on main (the sampler's sets).

**The census sample's switch family, with a bench** (`int2/census/census-bench.ts --n=8000 --sv=2000 --seed=7`, then
`bench-report.ts`; `census-bench-report.out`, 5m8s). The same turns (its plain run equals `census-sim.int2.json`: `ready 7391,
not estimated 609, end not estimated 235, issues 0 → equal`, and the same for SV), with 2 bench Pokémon per side from a second
random stream (bench seed 1000010), once plain and once with Stealth Rock + 1 Spikes layer on both sides:
```
== Champions bench: 8000 turns, ready 7740, not estimated 260 (3.25 %), end not estimated 0, issues 0, throws 0; turns with a switch 581
== SV bench: 2000 turns, ready 1901, not estimated 1 (0.05 %), end not estimated 17, issues 98, throws 0; turns with a switch 186
```
The hazards run gives the same counts; no reason in any run names a position; the engine throws 0 times in every run. Turns
from not estimated to ready: Champions 345 + 235 (end of turn) + 4 (`Beat Up: party needed.`), SV 153 + 30 (end).

| Reason left with a bench (family) | Champions | SV | Kept as |
|---|---|---|---|
| `{Name} switches out: the replacement is not known.` | 0 | 0 | — (gone with a bench) |
| `Encore needs {Name}'s move from the last turn.` / `Disable needs …` | 207 / 24 | 0 | `needsLastMove` (Q3); one more than without a bench, where a switch reason came first |
| `Imprison needs {Name}'s moves.` | 12 | 0 | `needsMoves` (#46) |
| `Trace copies a random foe's ability.` | 9 | 0 | #40 |
| `Simple Beam giving Simple is not modelled in 2v2.` | 3 | 0 | wave 1a's A1 guard: the Champions data has no Simple (W1A-A1); a switch reason came first before |
| `Beat Up with {Name}'s hit first is not modelled in 2v2.` | 3 | 0 | PR's (count-moves puts the user's hit first); the bench now gives Beat Up a party |
| `Beat Up into Colbur Berry: not calculated.` | 1 | 0 | count-moves' row limit (in the docs) |
| `Friend Guard with 2 other damage modifiers: not calculated …` | 1 | 0 | #44 row-engine-limits (1v1) |
| `Harvest needs {Name}'s item from an earlier turn.` (end) | 0 | 17 | Q4; 3 more than without a bench, where a switch reason came first |
| `Shields Down starting on {Name} is not modelled in 2v2.` | 0 | 1 | A1's Start guard, which R-E's `abilityEntry` reaches for a newcomer (Minior); not in ADDENDUM2 §8.7's list (§5) |

Every other wave 2 reason has 0 turns in the sample: `entersWithGas`, the Commander pair, Red Card with Life Orb or Shell Bell,
two Emergency Exits in one move, an Eject Pack waiting for a later move, a Mold Breaker drag, a Pursuit knock-out setting off a
switch, switching out while Dynamaxed, Zero to Hero without its form, Baton Pass with Gastro Acid, Power Trick or Power Shift,
Tera Shift, the Primal Orbs, the gas ending, `Too many cases to follow.`. The first bench run also had 1 SV turn
`Commander starting on Tatsugiri is not modelled in 2v2.` (a Tatsugiri coming in beside a Snorlax): fixed (§1; that exact turn
was checked not estimated before and ready after).

**Budget measurement** (`int2/census/budget-probe.ts`: int1a's copy of `tier2-eot-training-probes-3.ts`, on a copy of this
tree's `app/lib/battle` made at run time into `.t2-engine` and deleted after, with recorders for wave 2's request rounds and
healthiest-pick combinations and a `--bench` mode with census-bench's benches; `budget.out` 2m15s, `budget-bench.out` 2m21s):
```
tier2 budgets probe: seed 7, 8000 Champions + 2000 Scarlet/Violet turns, 133007 ms (engine copy of this tree's app/lib/battle, integration 2; mode plain)
  "Too many cases to follow." today: turn 0, end of turn 0, E2 0
tier2 budgets probe: seed 7, 8000 Champions + 2000 Scarlet/Violet turns, 139549 ms (engine copy of this tree's app/lib/battle, integration 2; mode bench)
  E2 statuses: {"ready":7740,"not-estimated":260}; E2 throws 0; E2 calculations max 58; E2 rounds max 1, combos max 8
```

| | 1b | 2 (no bench) | 2 (bench) |
|---|---|---|---|
| `Too many cases to follow.` (Champions: turn, end, E2; SV: turn, end) | 0, 0, 0; 0, 0 | 0, 0, 0; 0, 0 | 0, 0, 0; 0, 0 |
| Engine errors / throws (E2 throws) | 0 / 0 | 0 / 0 (0) | 0 / 0 (0) |
| Champions worlds, entries (max) | 26, 24870 | 26, 24870 | 26, 24870 |
| Champions calculations (max of 160; E2) | 58 | 58; 58 | 58; 58 |
| SV worlds, entries, calculations (max) | 12, 14460, 20 | 12, 14460, 20 | 19, 14460, 46 |
| Spread heal (C12 joint) ready turns, worst world-state load | 357, 0.1244 | 357, 0.1244 (over if ×9; ×20 over on 2 turns) | 378, 0.1244 (the same) |
| Switch family (self-switch, drag, Eject Button / Pack, Red Card, Emergency Exit, Wimp Out): turns, ready, worst calculation load | — | Champions 791, 428, 0.056 | Champions 791, 774, 0.194; SV 220, 204, 0.287 |
| Request rounds (recorded max; the guard stops past 8) / healthiest-pick combinations (max of 256) | — | 0 / 0 | 1 (a second round) / 8 (E2) |
| Headroom for a landing's 16 rolls (end-of-turn entries ×16 over 200 000) | Champions 2 (0.03 %), SV 1 (0.06 %) | Champions 2 (0.03 %), SV 1 (0.06 %) | Champions 2 (0.03 %), SV 1 (0.05 %) |

The spread-heal guard's anchor is absent in this tree (`anchor gone in this tree, not recorded`), as in 1a and 1b: S models
spread heals.

The acceptance holds (ADDENDUM2 §10 risk 5): no ready sample turn becomes `Too many cases to follow.`, with or without a bench;
the calculation load stays at or under 160 on every turn (worst 58 for Champions, 46 for SV with a bench); the spread-heal
joint is inside SPEC2 risk 5 as in 1b; wave 2's own bounds stay far from their guards.

## 4. Layout check (static render, Playwright's Chromium)

`int2/render/render-2.test.tsx` (`render.config.mts`) renders 9 2v2 pages from the real engine, as `useDoublesView` builds
them, with the app's CSS module and its globals compiled by the app's `@tailwindcss/postcss` (`int2/render/globals.mjs`);
`int2/render/check-layout.mjs` serves them on 127.0.0.1 (4357 for the census agent, 4359 for the last pass; no sign-in, no
credentials; the server closes with the script) and checks them with Playwright's Chromium (1.56.1, `/opt/pw-browsers`) at
375 px and 1280 px, as loaded and with every `<details>` open. The pages: U-turn with a chosen replacement, Parting Shot, Eject
Button, Red Card, Roar, Emergency Exit, a newcomer onto Stealth Rock + 2 Spikes, a Neutralizing Gas newcomer (kept reason) and a
newcomer under Neutralizing Gas.

- The census agent's last run (`layout-4.log`, after its fixes) and the last pass's re-run on the final tree (`render-5.log`,
  `layout-5.log`, pages in `$SP/int2/render-3`; every page's HTML, the CSS and `facts.txt` byte-equal to the census agent's,
  and the log equal to `layout-4.log`) end with:
  ```
  9 pages × 2 widths: every check passes
  ```
  Each line reads like `ok   eject-button @375: loaded scrollWidth 375 / clientWidth 375 (body 375), past the edge 0; open
  scrollWidth 375 / clientWidth 375 (body 375), past the edge 0; … duplicate names in one context none, unnamed none; position
  words: text none, names none`, and the same at 1280 / 1280.
- **Width:** scrollWidth equals clientWidth on every page (375 / 375, 1280 / 1280) and nothing is past either edge.
- **Names:** accessible names are unique within their group under the naming guard's rule; the only repeat in one group is
  `Tera Type` on the 2v2 cards (F5, allowed by `tests/unit/naming-guard.test.ts`, already so on main); other repeats are across
  separately named groups.
- **Position words:** none in the visible text or in any accessible name. Every leaver and newcomer is named by name.
- **What the pages state** (facts only; `facts.txt`, the per-page `*-375.txt`):
  - U-turn with a chosen replacement: `Ambipom switches out; Gyarados comes in.`, Gyarados's Intimidate (`Snorlax: −1 Attack.`,
    `Garchomp: −1 Attack.`), Snorlax's Body Slam into Gyarados 42–51; the card `Ambipom switches out at 150 HP.`, `Gyarados
    comes in.`, `After the turn · Average estimate 124 / 170 HP`, `Turn start: 170 / 170`. No default-replacement fact.
  - Parting Shot (Champions): `Assumes Farigiraf comes in for Incineroar.`, `Incineroar switches out; Farigiraf comes in.`
    stated once (the duplicate plain fact is gone, §1), Kingambit's Iron Head into Farigiraf 78–93.
  - Eject Button: Corviknight's Brave Bird `Switches out before it moves.`; `Corviknight switches out; Amoonguss comes in.`.
  - Red Card: `Red Card: Garchomp is dragged out; Corviknight comes in.` and `… Amoonguss comes in.`, 1/2 each; the card
    `Corviknight comes in (50%).`, `Amoonguss comes in (50%).`.
  - Roar: `Roar: Garchomp is dragged out; Corviknight comes in (50%).` / `… Gyarados comes in (50%).`, and Gyarados's
    Intimidate on that path (`Arcanine: −1 Attack.`, `Snorlax: −1 Attack.`, 1/2 each).
  - Emergency Exit (Champions): `Emergency Exit: Golisopod switches out.`, `Golisopod switches out; Farigiraf comes in.`.
  - Hazards: `Ambipom switches out; Charizard comes in.`, then `Charizard loses 76 HP (Stealth Rock).` in the turn (shown since
    the fix in §1; Spikes do not reach a Flying type), Body Slam into Charizard 64–76, the card `1–13 HP`.
  - Gas newcomer: `Turn not estimated: Weezing-Galar's Neutralizing Gas coming in is not modelled in 2v2.`.
  - Under the gas: `Neutralizing Gas suppresses the abilities of Ambipom, Gardevoir and Garchomp.`, Gyarados comes in with no
    Intimidate, Dragon Claw into Gyarados 69–82.
- Screenshots (`*-375.png`, `*-1280.png`, `-open` variants), texts and names are in `$SP/int2/render` and `$SP/int2/render-3`.
- Not checked live: the signed-in page (§5).

## 5. Open

1. **Training decision time against SPEC2 §6's p95 ≤ 634 ms.** Not measurable as an absolute here: this container fails eval's
   three time rows for main too (8 shards on 4 CPUs). In the paired check the code's share against main is p50 ×1.11–1.16 and
   p95 ×1.12–1.17 (1b: p95 +5–8 %), from wave 2's intended move to the engine (rollouts per decision 12.6–16.2 → 0.0–0.3;
   engine calls and preludes up). Scaled to 1b's reference machine (main p95 577 ms) that is about 650–675 ms: under eval's
   800 ms gate, above 634 ms. A rerun of `eval:training` on a quiet reference machine settles it (HANDOFF item 3, the final
   gate), or a perf pass.
2. **HabitBot** (`Reads you − Plays safe, both vs HabitBot`, ≥ +5 points): 3.3 points; fails as on main (4.0) and in 1b (2.8).
3. **`test:battle-data:source` in place:** `node_modules/.cache/champions` needs `damage-calc-e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d.tar.gz`
   (pin sha256 ca28c26b6728b1a0fe7c08189abe8f1da61d2f1eb1d9d1bf0fc36039ff9dae84; codeload's bytes differ) and the compiled dex
   `showdown-dex-c23d2e94…` (`npm run data:champions`'s compile step, or `int2/compile-dex.mjs` aimed at that directory).
   Someone allowed to write `node_modules` has to restore both; until then 91 tests do not run (battle-data 66,
   doubles-ability-table 6, doubles-status-moves 19). The other 8 files pass 63/63 with the scratch cache.
4. **Coverage of the missing folders:** the 544 stored stub ids were not run by the oracle, changed-cases or the
   regeneration (their 282 generated rows are kept byte-equal and pass); the stub-only harness failures stay (V1 G4-OPP-11 and
   RT-RV02, V2 R09, V3 ZS16). Restoring the folders listed in Status from the user's machine (or `wip/status2-cache`, if they
   are there) lets FINAL2 run all 2331 + 176.
5. **Golden ids:** F's `fling/golden-changed.json` is missing, so the 110 differing golden rows are identified as moveId fling
   only (`int2/golden-changed.json`; main against the stored golden gives the same set).
6. **Bench on this machine:** in process, +8 % per turn against main (median 1.078–1.089), ±1 % against 1b's engine (0.991):
   wave 2 adds nothing, but INTEGRATION-1B measured −2.5 % against main on Windows. To be read again on the reference machine.
7. **A newcomer's form-changing Start** (Shields Down, Schooling, Ice Face) stays not estimated: A1's Start guard, which R-E's
   `abilityEntry` reaches for a newcomer (1 SV turn in the bench census, `Shields Down starting on Minior-… is not modelled in
   2v2.`). The guard also fires where pinned Showdown changes nothing (Minior at or below half HP, Eiscue-Noice without snow,
   Wishiwashi below level 20), a conservative fallback. Modelling it needs its own oracle cases; ADDENDUM2 §8.7 does not list
   it. The docs say it (§1).
8. **Reasons the bench exposes** (kept, each a fact; the census table in §3): Champions `Beat Up with {Name}'s hit first is not
   modelled in 2v2.` 3 (PR's), `Beat Up into Colbur Berry: not calculated.` 1 (count-moves), and `Simple Beam giving Simple is
   not modelled in 2v2.` 3 (A1's, no Simple in the Champions data), which a switch reason used to hide.
9. **The census sample gives no bench:** `census-sim.ts` keeps the switch family as the calculator-without-a-Bench fact
   (Champions 349 / end 235, SV 156 / end 31); the switch family's measurement is the new `int2/census/census-bench.ts` (the
   same turns, the bench from a second random stream). FINAL2 should run both.
10. **Wave 2 notes still open** (not integrator one-liners):
    - R-V's contract gap: a landing whose user is a bench Pokémon that a drag brings in before the residual lands from an
      active Pokémon; `futureMove: { build }` cannot say it is that bench Pokémon, so no case is built;
    - R-V's note on the Pledges' and Round's queued sourceEffects crossing a snapshot in `sim-dfs.ts` (their stored cases agree);
    - R-T's open 1, the AI's later pick: ranked by its ReplacePolicy as for its first slot in play (the player's side follows
      Q9 through `replacementOrder`);
    - R-U's note: `turnBenchNames` names bench Pokémon after `input.pokemon`, which is null for a fainted slot, so a bench
      Pokémon of a fainted slot's species has the same text as that slot.
11. **Polish, not changed:** `Tera Type` is the same accessible name on each 2v2 card (as on main; the naming guard's F5 allows
    it); a newcomer's Intimidate shows as plain step facts (`Arcanine: −1 Attack.`) without naming Intimidate (R-E's tested
    format); `docs/training.md`'s gate 4b sentence (line 156) does not mention the newcomers, the leavers or the bench Pokémon
    that stay (outside this build's doc scope; one clause could be added).
12. **Conformance 9a / 9b / 9c** forfeit counts and record sizes vary from run to run (6 → 5 forfeits, 44 → 41 KB). The saved
    check's battles also differ between processes on main (`int2/training/saved-probe.ts`), so this predates the branch;
    within a run, replay and Resume equal the original.
13. **INTEGRATION-1B's open items:** 3 (the belief battle after Instruct) is fixed by R-T (T2 fuzz one-turn logs 794/794); 7
    (wave 2) is this integration; 11 (the probe's header) now reads "integration 2". Items 4 (a called Instruct: still 1 cell
    in the T2 fuzz), 5 (the Moves pane under a third Pokémon's Unnerve or As One), 6 (the narrow corners kept) and 10 (E2's
    item 7, T2's `validate()`) were not in wave 2's scope and were not re-checked here.
14. **Sync to `wip/status2-cache`** (still to do, by someone allowed to push): the new `build/int2/` record (`int2.diff`,
    `census/`, `render/`, `tools/`, `training/`, the bench and golden scripts), `verify/cases-r.ts` (G4-SWX-82),
    `verify/results/G4-SWX-82-sv.json`, the regenerated `verify/results/compare.json` and `verify/app-results/`, the wave 2
    harness files W2-GAPFIX lists, the wave 2 notes and this file, and the Training run folders
    (`scripts/.cache/training/eval/int2-s1seeds`, `int2-paired-now-r1`, `int2-paired-now-r2`; main's paired runs are only in
    the scratch maintree).
15. **Not checked live:** the 2v2 page signed in at 1280 px and 375 px (HANDOFF item 4), with R-U's Add to bench; here static
    renders only (§4).
16. **Next:** the seven reviews and the fixer (ADDENDUM2 §8.8), then the final gate written up as `FINAL2.md`.
