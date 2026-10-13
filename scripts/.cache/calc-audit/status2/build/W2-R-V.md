# Wave 2, Track R-V: the oracle for switch-outs with a replacement (ADDENDUM2 §7, §8.7; SPEC2 §4.8, §7)

This track worked on branch `calc-2v2-status-2`. The branch was checked before the work and again before this report. The
files changed are everything under `scripts/.cache/calc-audit/2v2/verify/` named below, `status2/build/changed-cases.ts`,
this file, and the generated `tests/unit/doubles-turn-showdown.test.ts`. No app file, no frozen file and no other track's
file was edited. Nothing was committed, pushed or switched.

## 1. For R-E: your cases and how to run them

The oracle side of **every wave 2 case is stored** (pinned Showdown c23d2e94, `verify/results/<id>.json`). Run the app
against them as follows:

```
npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v3/run.ts --wave2 [--quiet] [--report=name]   # app vs stored oracle
npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v3/run.ts G4-SWX-05                          # one family
npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v3/show-r.ts G4-SWX-05-sv [more ids]         # an oracle result, readable
```

There are **87 cases in 46 families** (`cases-r.ts`, gathered by `cases-wave2.ts`, wired into `cases-se.ts`). Each runs in
SV and in one other game where its mechanic exists. The exceptions are Assist and Pursuit (USUM only: two USUM cases each),
Commander and the B13 gas end (SV only), and Wimp Out and the burned Golisopod (no Golisopod or Wimpod in SV). Each case is
exhaustive and was checked with `--validate` against whole-turn replays.

| Family | Games | What it pins |
|---|---|---|
| G4-SWX-01 | sv, champions | U-turn brings in an Intimidate newcomer; a later foe move meets it at −1 (B2) |
| G4-SWX-02 | champions, sv | Parting Shot with `replacement` (the second bench Pokémon); a later Dragon Claw into it |
| G4-SWX-03 | sv, usum | Stealth Rock on the newcomer (1/2 for Charizard) (B3) |
| G4-SWX-04 | swsh, sv | Roar over two bench Pokémon at 1/2 each; each one's Leftovers (`DoublesResidual.id`) (B5) |
| G4-SWX-05 | sv, swsh | Two Eject Packs from one Icy Wind: the second at the first newcomer's switch-in (B1) |
| G4-SWX-06 | usum, sv | A Drought newcomer: Chlorophyll re-sorted in SV, frozen in USUM (B7) |
| G4-SWX-07 | sv, champions | Regenerator on the leaver (Chilly Reception) (B6) |
| G4-SWX-08 | champions, sv | Eject Button: the holder's own move is cancelled; the later move meets the newcomer |
| G4-SWX-09 | sv, usum | Baton Pass passes +2 Attack and +1 evasion (B4a) |
| G4-SWX-10 | champions, swsh | Emergency Exit mid-turn, before the holder's own move (B10) |
| G4-SWX-11 | sv, swsh | Red Card drags at random from two (B9) |
| G4-SWX-12 | champions, usum | Emergency Exit **after the residual** (burn): the newcomer meets Stealth Rock (`endOfTurn.replaced`, `hpEntered`) |
| G4-SWX-13 | sv, swsh | Eject Pack at the end of turn (Syrup Bomb in SV, Octolock in SwSh) |
| G4-SWX-14 | sv, swsh | A newcomer under a foe's Neutralizing Gas: no Intimidate |
| G4-SWX-15 | sv, swsh | A gas newcomer: the kept reason `Weezing-Galar's Neutralizing Gas coming in is not modelled in 2v2.` |
| G4-SWX-16 | sv, champions | An Imposter newcomer transforms into the foe across (p2b) and faints to its super-effective Dragon Claw |
| G4-SWX-17 | sv, champions | A Drizzle newcomer: the later Flamethrower is weakened; the newcomer takes a spread Rock Slide (B11) |
| G4-SWX-18 | sv, usum | Both Pokémon of a side U-turn: the second gets the next bench Pokémon; Natural Cure on the leaver; full paralysis 1/4 |
| G4-SWX-19 | sv, champions | Shed Tail's Substitute on the newcomer, broken by the later Body Slam |
| G4-SWX-20 | sv | A Tatsugiri newcomer beside Dondozo: the kept reason `Commander is not modelled in 2v2.` |
| G4-SWX-21 | swsh, usum | Teleport (−6, SwSh): the newcomer before the residual; USUM's Teleport fails (no switch) |
| G4-SWX-22 | sv, champions | Volt Switch into a Ground type: no switch; Dragon Tail drags at random |
| G4-SWX-23 | sv, usum | U-turn into an Eject Button holder: the holder leaves, the U-turn user stays (B8) |
| G4-SWX-24 | sv, swsh | Parting Shot sets off no Eject Pack (B12) |
| G4-SWX-25 | sv | An Eject Button sends a gas holder out: the kept `Neutralizing Gas ending is not modelled in 2v2.` (B13) |
| G4-SWX-26 | sv, champions | The U-turn user faints to Rough Skin: no switch; the later move is retargeted |
| G4-SWX-27, -28 | sv, champions | Volt Switch and Flip Turn that switch |
| G4-SWX-29 | swsh, usum | Wimp Out mid-turn |
| G4-SWX-30 | sv, swsh | An Intimidate newcomer sets off a foe's Eject Pack: a second request, from the other side |
| IN-BNC-01, -02 | sv, champions | U-turn with no Replacement (the default and its fact); Parting Shot with one chosen (no fact) |
| IN-HZD-01 | sv; swsh | Stealth Rock + 2 Spikes on Arcanine; G-Max Steelsurge + Spikes on Snorlax |
| IN-HZD-02 | sv, usum | Toxic Spikes: 2 layers bad poison (SV), 1 poison (USUM), and the end of turn's poison |
| IN-HZD-03 | sv, usum | A Poison-type newcomer absorbs Toxic Spikes |
| IN-HZD-04 | sv, champions | Sticky Web on a Defiant newcomer (−1 Speed, +2 Attack) |
| IN-HZD-05 | sv, swsh | Heavy-Duty Boots |
| IN-FSL-02 | sv, champions | Future Sight from a bench Pokémon of the input (`futureMove.benchId` in the case; the app gets its build) |
| T2E-BL-01, -02 | sv + champions / usum | A Future Sight and a Wish landing on a position whose Pokémon U-turned out: the newcomer takes it |
| T2E-BL-03 | sv, champions | The landing's user left (Chilly Reception): it lands from the bench (no item, no ability, its own stats) |
| T2P-AST-01, -02 | usum | Assist over the ally's and the bench's moves; noassist moves left out (bench `moves`) |
| T2P-BTR-01 | sv, champions, swsh | Beat Up over the bench (a paralysed member does not hit) |
| CQ-PUR-R-01, -02 | usum | Pursuit at the U-turn user's BeforeSwitchOut, 80 power, even when aimed at the other foe |

**Where it stands** (live tree, `v3/reports/live-2.json`, 17:15): **66 of 87 agree**. The 21 that do not are R-E's work in
progress, listed in §5.

## 2. What the oracle records (the semantics compare.ts checks; SPEC2 §4.8 and STEP2's contract)

A case with a bench is a case with `Case.bench.{side}.members` on either side. Only then do the following hold:

- **Identity.** `slots[slot]` and `hp[slot]` are the slot's starting Pokémon wherever it is. When it left, its HP is the HP
  it left with, after its switch-out effects (Regenerator, Natural Cure). `monOf` finds it on the bench (`p.m.keep`).
  A newcomer's key is `<slot>|<bench id>`.
- **`replaced[slot]`** (`WalkResult.replaced`, `OracleResult.expectedReplaced`). `left` is each leaver in leaving order:
  `slot:<slot>` first, then any newcomer that left again. Each has the mass of the paths where it left and its HP as it
  left, conditional on leaving. Its `start` and `maximum` are the starting Pokémon's. `entered` is each newcomer with its
  mass; `chosen` is the share where its player picked it (not a drag).
- **`hpEntered[slot][id]`** (`expectedEntered`). This is the newcomer's HP after the moves, conditional on its having come
  in. `start` is its HP on the bench before the turn and `maximum` its maximum HP. A newcomer that left again is read as it
  left.
- **After the turn.** `afterTurnReplaced` holds **only the switches after the residual** (Emergency Exit, Wimp Out, Eject
  Pack at 29). They are answered like mid-turn switches, and their newcomers come in (hazards, entry abilities) before the
  oracle reads the state; the next turn never starts. `afterTurnEntered` holds every newcomer of the turn after the whole
  turn. A fainted Pokémon's replacement after the residual is the next turn's, so it is not answered. If one is flagged
  beside a living switcher, the oracle refuses the case (none is built).
- **The default replacement.** When `Case.replacement` does not name the slot, the replacement is the first bench member
  in case order that is neither in play nor fainted nor already picked in that request. A Pokémon that left this turn is
  never the default (IN §5.7: "the second switcher of a side defaults to the next bench Pokémon"). compare.ts expects one
  `Assumes {Newcomer} comes in for {Name}.` per slot whose chosen switch happened with no Replacement given, after the moves
  or after the residual, and none otherwise.
- **Random drags** (Roar, Whirlwind, Dragon Tail, Circle Throw, Red Card) go through `getRandomSwitchable`'s `sample` and
  take one path per living bench Pokémon at 1/k (decision kind `drag`).
- **Hits and residuals on a newcomer.** A hit on a newcomer is in `StepResult.hitsEntered[slot][id]`, with the same fields
  as `hits` (its Substitute included); its lines are in `effectsEntered`. A residual on a newcomer is
  `ResidualResult.slot` plus `id`. They are compared with `DoublesHit.id` and `DoublesResidual.id`.
- **The order.** A move action that a switch-out cancelled (Eject Button, Emergency Exit, a drag) is never picked. Its step
  has `picked` 0 and the actions after it count one place less: the app's order counts the actions it runs. So the step's
  skipped facts must cover its share: `step.skipped (total)` = 1 − `moves`.
- **Pursuit at a switch-out** (moves.ts pursuit `onFoeBeforeSwitchOut`) is its user's own action, run inside the switching
  Pokémon's action: its own step, with its order position at that moment.
- **E2.** compare.ts views the outcomes by identity. Each slot's entry is its starting Pokémon, which is
  `DoublesOutcome.benched[side]` with id `slot:<slot>` where it left. Every existing E2 comparison runs on that view. Each
  newcomer (`mons[slot]` with its id, or `benched` again) is checked against `entered`: its absolute HP mixture, its item,
  and, where it never faints, its status, stages (accuracy and evasion through `stages`) and volatiles. Any app newcomer or
  leaver that Showdown does not have is a mismatch.
- **Hazards in the input.** `CaseSide.hazards` (with the new `layers`, and `gmaxsteelsurge`) now also reach the app as
  `DoublesTurnInput.hazards`, through `app-turn.ts caseHazards`. A pre-turn G-Max Steelsurge stands in E2 through
  `hazardsFrom`, as the other hazards do, or through `sides.gmax`.

## 3. Harness changes (each has a test in `verify/v3/harness.test.ts`: 22 tests, all pass)

Run the tests with `npx vitest run --config scripts/.cache/calc-audit/2v2/verify/v3/vitest.v3.config.mts` (5 s).
`RV_ENGINE_ROOT` points `@/` at another engine tree. V1's 18 and V2's 26 harness tests still pass.

- **`case-types.ts`.**
  - `CaseBenchMon` and `Case.bench.{side}.members`, the side's whole bench.
  - `Case.replacement`.
  - `CaseSide.layers`.
  - The `futureMove.benchId` form.
  - Result types: `ReplacedResult` (with `chosen`), `EnteredResult`, `StepResult.hitsEntered` and `effectsEntered`,
    `WalkResult.replaced` and `entered`, `AfterTurn.replaced` and `entered`, `ResidualResult.id`, and
    `OracleResult.expectedReplaced`, `expectedEntered`, `afterTurnReplaced` and `afterTurnEntered`.
- **`sim-dfs.ts`.**
  - `prepare()`:
    - The members take the Snorlax's place; each set's name is its id and its moves are exact, so Assist reads them.
    - Each member gets its HP and its status, set directly. A member's sleep length is a hidden sub-case,
      `bench:<id> sleep S`. Champions freeze, the reset bad poison and onceUsed are set too.
    - `checkBench` enforces the rules a bench must keep.
    - Hazard layers are set and checked, and an addSideCondition that Showdown refuses fails the case.
    - The landing user can be a bench member.
  - `install()`:
    - Its `switchIn` wrapper records each switch-out on the slot's anchor (`m.swEvents`, so it survives snapshots).
      It also marks the newcomer's `enteredFor` and a cancelled leaver.
    - Drags are a `drag` decision.
  - `runSegment()` answers switch requests from the bench, both mid-turn and after the last move (`switchAnswers`,
    `answerSwitch`), and after the residual too, with `endTurn` intercepted.
  - `restoreSwitchEffects`: pinned `sim/state.ts` writes a queued switch's `sourceEffect` as `[DataMove:<id>]`, which
    `fromRef` cannot read back. Through a snapshot, Baton Pass and Shed Tail therefore passed nothing. This was found by the
    whole-turn validation, and a bench case restores the effect after each deserialize.
  - `keyOf`, `idOf`, `splitKey`, `hpAll`, `newcomers`: the Recorder, the lines and the residuals are keyed by identity.
  - A cancelled action is left out of the later positions.
  - Pursuit at a switch-out is its own record.
  - `BenchTally` collects the bench results.
  - `oracle()` gives the four expected tables.
  - `compareWalks` (`--validate`) also compares the newcomers' and leavers' masses, HP and states.
- **`app-turn.ts`.** `caseBenchInput`, `benchPokemon` and `caseHazards` map bench, replacement and hazards into the input.
  A `benchId` landing becomes `{ move, build }`. `preflight` also checks the bench members' builds and moves.
- **`compare.ts`.**
  - `compareBench`: `replaced`, `hpEntered`, the end of turn's, and the default replacement's fact.
  - `compareEnteredHits`: the newcomer hits.
  - `identityOutcomes` and `compareOutcomeNewcomers` for E2.
  - The residuals match by id.
  - A pre-turn Steelsurge counts in `sides.gmax`.
  - A case without a bench must have no `replaced` or `hpEntered`.
- **`status2-removed.ts`.** `switchesOut` is now `wave: "kept"`, because a stored case has no bench and keeps its reason
  (`STATUS2_REEXPECT`'s "2" drops nothing). V1's harness test that expected `wave: "2"` was updated.
- **`gen-tests.ts`** (§6).
- **Tools** (`verify/v3/`):
  - `run.ts` (V2's run with `--wave2` and the R-E owner), `show-r.ts`, `count.ts`, `ab.ts`.
  - `sim-dfs-pre-r.ts`, the snapshot of `sim-dfs.ts` before this track, which `ab.ts` and the harness test compare
    against.
  - `inventory.ts`, `names.ts` and two debug probes.
  - `vitest.v3.config.mts`, `vitest.gen.config.mts`, `tsc/`, and `tools/*.py` (the exact-match patches, the record).

**Byte-equality for the cases without a bench.** `v3/ab.ts` runs the snapshot oracle and the current one fresh on every
case without a bench and requires equal JSON, with `ms` removed (§7 has the full run). The harness test pins ZS16 (Dragon
Tail with the Snorlax), ER32a (Eject Button) and S1-RSP-champions (hazards). `--validate` (`v3/logs/validate.log`) gives
"equal to N whole-turn replays" for every wave 2 case.

## 4. changed-cases.ts (wave 2)

`--wave=2` (or `1a,1b,2`) makes every case before wave 2 the stored set (`STORED_2`). `listChanged2` adds the stored cases
whose app input changes: their pre-turn hazards now reach the app as `DoublesTurnInput.hazards`. These are S1-RSP-sv,
S1-RSP-champions, FS07b-champions and FS08c-champions, owned by R-E or the integrator: hazardFails, and the Court Change /
Defog / Tidy Up / Wind Rage facts. Their numbers should not change, so no oracle re-run is needed. On the Step 2 engine all
four are byte-equal with the hazards passed (`v3/app-hz`). No stored case has a bench, so the switch family keeps its
reason, and no stored oracle result changes.

At integration 2, run `changed-cases.ts diff <app-results before> <after> --wave=1a,1b,2`.

## 5. Open (R-E's, from `v3/reports/live-2.json`)

- **G4-SWX-05 (sv, swsh), G4-SWX-18 (sv, usum).** The second switcher's default is the Pokémon that left earlier this turn
  (`entered slot:opponent-left`), not the next bench Pokémon. IN §5.7 and STEP2 say "the first bench Pokémon not in play",
  from the input's bench.
- **G4-SWX-08, -10, -23 (6 cases).** The holder's cancelled move has no skipped fact. The check is `step.skipped (total)`:
  expected 1, got 0.
- **G4-SWX-14 (sv, swsh).** `Incineroar coming in under Neutralizing Gas is not modelled in 2v2.` SPEC2 §4.8 models this
  case: the gas stand-in, so no Intimidate.
- **T2E-BL-03 (sv, champions).** The landing uses the newcomer standing in the source's slot (30–36 damage). The source is
  the starting Pokémon that left, which lands from the bench (93–111).
- **T2P-AST-01/02, T2P-BTR-01 ×3, CQ-PUR-R-01/02.** These still give the interim reasons: Assist and Beat Up from the
  bench, and Pursuit at a switch-out.

## 6. The generated test

- **What changed in `gen-tests.ts`.**
  - The input now passes bench, replacement and hazards with their layers (`benchInput`), as `app-turn.ts` does.
  - A bench case's row has `bench`, `replacement` and `r`.
  - `checkBench` (the generated mirror of `compareBench` and `compareEnteredHits`), `identity` and `checkNewcomers` (E2).
  - Residuals match by id.
- **Regeneration.** `tests/unit/doubles-turn-showdown.test.ts` was regenerated with `STATUS2_REEXPECT=1a,1b`, the
  integration 1b ids kept (`--keep=v3/gen/ids-before.txt`) and an empty compare report, so nothing joined.
  - The case table (5,002,007 characters) is byte-equal to integration 1b's.
  - Only the header and the checking code changed. The previous file is `v3/gen/doubles-turn-showdown.before-r-v.test.ts`.
- **Checks run.**
  - `vitest run --config vitest.unit.config.ts tests/unit/doubles-turn-showdown.test.ts`: `Tests 1985 passed (1985)` on
    the live tree. The same file on the Step 2 engine tree also passes 1985.
  - eslint: clean. tsc: no error.
- **R rows not yet exercised.** The R rows were generated and type-checked in a scratch file (`v3/gen-r/r.test.ts`, 74
  cases). They have not run against an agreeing engine, because none exists yet. At integration 2, regenerate after the
  last compare run, keeping `v3/gen/ids-before.txt`; the wave 2 cases that agree then join.

## 7. Gates run (final code)

- `v3/harness.test.ts`: 22 passed. V1's harness: 18 passed. V2's harness: 26 passed.
- **Full compare on the Step 2 engine tree** (`STATUS2_REEXPECT=1a,1b`, `TSX_TSCONFIG_PATH` = the scratch Step 2 tree,
  `v3/logs/compare-step2tree.log`): `2337/2418 cases match.` That is all 2331 stored cases, plus 6 wave 2 cases that need no
  R engine. The 81 that differ are all wave 2.
- **The wave 2 cases on the live tree:** 66/87 (§5).
- **`--validate`** (whole-turn replays without merging or snapshots): 219 "equal to" lines in `v3/logs/validate.log`, three
  walks for each of the 73 estimated cases of the first batch, and the same for G4-SWX-26…30 (run apart). There is no
  difference.
- **The A/B of the oracle on every case without a bench** (`v3/ab.ts`, 4 shards, `v3/logs/ab-*.log`): see the final line
  of each log.
- **Type check** (`v3/tsc`): no new error in the harness files. The errors left are older ones: `cases-cq-1b.ts`, two in
  `compare.ts` (the note argument) and the `.ts` import paths.

## 8. Deviations

- `Case.bench` keeps the Snorlax's `status` / `ability` and gains `members`, rather than the bench becoming CaseMon[], so
  the stored cases keep their meaning. `Case.replacement` holds bench ids, not indices, because the app's replacement is an
  id.
- The default replacement never picks a Pokémon that left this turn (IN §5.7). A Pokémon that would come in a second time
  in one turn, or a switch-out after the residual beside a faint replacement, makes the oracle refuse the case. No case
  needs either.
- `DoublesTurnResult.hpEntered`'s `start` is compared with the newcomer's bench HP before the turn.
- `DoublesEndOfTurn.replaced` is compared with the switches after the residual only.
- The Pursuit, Assist and Beat Up cases were not in guards.md's list. They cover R-E's wave 2 parts of
  `doubles-presence.ts` and `doubles-calling.ts`.
- **A contract gap.** A landing whose user is a bench Pokémon that a drag brings in before the residual lands from an
  active Pokémon (its item and ability count). `DoublesCarried.futureMove`'s `{ build }` cannot say it is that bench
  Pokémon, so no case is built for it.
- **Other queued sourceEffects.** The `restoreSwitchEffects` fix acts only on switch actions in bench cases, to keep every
  stored result byte-equal. The Pledges and Round also pass a move to `prioritizeAction` (moves.ts:5405, 7604, 15519,
  20547), and that action's sourceEffect may cross a snapshot as the same unreadable `[DataMove:…]`-style string. Their
  stored cases agree, but the integrator may want to look at it in a later wave.

## Finish (cloud session)

Track R-V was finished in the cloud session of 2026-10-11, after R-E's finish. `git branch --show-current` printed
`calc-2v2-status-2` before the work and again before this report. Nothing was committed, pushed, switched or merged. No app
file, no `tests/` file and no stub was edited. `tests/unit/doubles-turn-showdown.test.ts` was not regenerated: the
regeneration was dry-run into the scratchpad (F5). Line endings are kept: cases.ts and gen-tests.ts are CRLF on every line;
app-turn.ts, sim-dfs.ts, cases-r.ts and v3/harness.test.ts are LF. The scratchpad is
`/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad/r-v/` (`$RV` below).

**What this cloud tree lacks.** These are missing here:
- the gitignored case folders that are stubs (the orchestrator's list: 544 stored ids that do not load);
- `verify/v1/fixtures/`, and `v3/gen/`, `v3/gen-r/`, `v3/logs/`, `v3/tools/`, `v3/tsc/`, `v3/app-hz/`. Only the files directly
  under `v1/`, `v2/` and `v3/` were pushed.

So every compare below covers only the cases that load. The R rows of `v3/gen-r/r.test.ts` were run as part of the dry-run
regeneration instead (F5).

### F1. The start, and the harness side of R-E's three asks

- **Start:** `v3/run.ts --wave2` gave `85/87 cases match.` Only the two Assist cases differed (`Assist needs the moves of
  Liepard's party.`).
- **`app-turn.ts caseInput` and `gen-tests.ts` (R-E's ask 2).** A slot with `exactMoves` and no `moves` now passes its action
  move as `moves`: `...(m.moves || m.exactMoves ? { moves: [...] } : {})`. Its Showdown slots are exactly that (sim-dfs
  `sdSet`), and Assist reads the ally's slots. The only other `exactMoves` cases are wave 1b's Sleep Talk cases, and they all
  have `moves`, so their input is unchanged. Result: T2P-AST-01-usum and -02-usum agree, giving `87/87 cases match.`
- **`cases.ts` STATUS2_REEXPECT block (R-E's ask 3).** A wave 2 case (`WAVE2_CASES`) is skipped, as wave 1a's are, because
  it states wave 2's expectations. Without the skip, G4-SWX-20-sv's kept `Commander is not modelled in 2v2.` was dropped by
  a 1b removal pattern. Result: `STATUS2_REEXPECT=1a,1b v3/run.ts --wave2` agrees on every case.
- **R-E's ask 1** (doubles-faces.ts, `w2-re/faces-ask.diff`) is an app file, so it stays with the integrator. None of the
  stored cases depend on it.

### F2. A harness fix found by the new cases: a dragged newcomer's lines inside the move

**What was wrong.** `sim-dfs.ts parseLines` read every HP line of an action against the position map at the action's
start. A drag inside the action (Roar, Whirlwind, Dragon Tail, Circle Throw, Red Card) brings a newcomer in mid-action.
Its later lines in that same action (Stealth Rock damage, an Intimidate) were then counted as the slot's starting
Pokémon's. G4-SWX-31 (Whirlwind onto Stealth Rock) failed on `own-left→opponent-right hit.change: expected
{"min":-158,"max":-114}, got "absent"`. That change was the dragged newcomer's Stealth Rock damage, measured against the
dragged-out Snorlax's 235.

**The fix.** For a bench case's action records only, parseLines takes a `member` predicate. A `|switch|` or `|drag|` line
of a bench member now re-keys its position to `<slot>|<id>`. Its later lines then go to `effectsEntered`, and no
`moveChange` is recorded on the slot. Without a bench `member` is undefined, so nothing changes.

**Checks:**
- Every wave 2 case run again (`sim-dfs.ts … --out=$RV/oracle-after`): 103 of the 107 estimated results are byte-equal to the
  stored ones (`ms` aside). The 4 that changed are the new G4-SWX-31 and -32 (sv, champions), and their fixed results are
  stored.
- Without a bench (`$RV/ab-pin.ts`: `sim-dfs.ts` against `sim-dfs-pre-r.ts`), E31c, ER32a, S1-RSP-champions,
  T2P-CMD-05-sv, T2P-CMD-05b-sv, T2P-BKB-02-champions, S48-Teleport-noSwitch, E32a and ER29c are each `byte-equal`.

### F3. The switch family's coverage (census-guards.md §4, SPEC2 §4.8, guards.md §5.4 step 6)

**42 new cases** were added to `cases-r.ts`: 41 in 22 new families (G4-SWX-31…52) and G4-SWX-21-sv. Each one was run as follows:
- the oracle first (`v3/run.ts --oracle`, exhaustive);
- `--validate` (`sim-dfs.ts … --validate --out=$RV/oracle-validate*`): 132 `equal to N whole-turn replays` lines (3 walks ×
  44 runs: the 42 cases plus G4-SWX-36 ×2 again after its title change), and none differ. The validated results equal the
  stored ones (warnings and `ms` aside).
- the app: every one agrees.

G4-SWX-50-swsh first carried `onceUsed` on the bench Zacian. The app correctly refuses that input outside generation 9
(`Only generation 9 counts once-a-battle effects.`), so the case was split: SV has it used, SwSh has a plain entry.

| Trigger (census §4) | Cases (games) |
|---|---|
| U-turn | G4-SWX-01 (sv, champions), -03 (sv, usum), -18 (sv, usum), -23 (sv, usum), IN-BNC-01 (sv, champions), and most entry cases |
| Volt Switch | G4-SWX-27 (sv, champions); no switch into Ground: -22 (sv, champions) |
| Flip Turn | G4-SWX-28, **-38**, **-43** (sv, champions); not in USUM |
| Parting Shot | G4-SWX-02 (champions, sv), -24 (sv, swsh), IN-BNC-02 (sv, champions) |
| Teleport | G4-SWX-21 (swsh, usum: fails; **sv new**); Champions: isNonstandard Past |
| Baton Pass | G4-SWX-09 (sv, usum) |
| Shed Tail | G4-SWX-19 (sv, champions) |
| Chilly Reception | G4-SWX-07 (sv, champions), T2E-BL-03 (sv, champions) |
| Roar | G4-SWX-04 (swsh, sv); stopped by Ingrain **-47** (sv, champions) and by Suction Cups **-48** (swsh, usum; no holder in SV) |
| Whirlwind | **G4-SWX-31** (sv, champions): a random drag onto Stealth Rock |
| Dragon Tail | G4-SWX-22 (sv, champions); stopped by Guard Dog **-40** (sv, champions); into an Eject Button **-42** (sv, champions: the drag first, the button unused) |
| Circle Throw | **G4-SWX-32** (sv, champions): a random drag of an Intimidate newcomer |
| Eject Button | G4-SWX-08 (champions, sv), -23 (sv, usum), -25 (sv, kept reason), -42 |
| Eject Pack | G4-SWX-05 (sv, swsh), -13 (sv, swsh: after the residual), -24 (sv, swsh: not by Parting Shot), -30 (sv, swsh); none in Champions |
| Red Card | G4-SWX-11 (sv, swsh) |
| Emergency Exit | G4-SWX-10 (champions, swsh), -12 (champions, usum: after the residual); no Golisopod in SV |
| Wimp Out | G4-SWX-29 (swsh, usum); no Wimpod in SV |

| Entry or leaving effect | Cases (games) |
|---|---|
| Stealth Rock, Spikes, Toxic Spikes, Sticky Web, G-Max Steelsurge, Heavy-Duty Boots | G4-SWX-03, -12, **-31** (drag), IN-HZD-01…05 (sv with swsh, usum or champions; Steelsurge swsh only) |
| Air Balloon (not grounded: no Spikes, Earthquake immune) | **G4-SWX-39** (sv, champions) |
| Intimidate | G4-SWX-01 (sv, champions), -30 (sv, swsh), **-32** (sv, champions) |
| Weather setters, the re-sort | G4-SWX-06 Drought (usum, sv), -17 Drizzle (sv, champions) |
| Terrain setter | **G4-SWX-43** Grassy Surge (sv, champions: Earthquake halved, the terrain's heal) |
| Weather suppression | **G4-SWX-45** Cloud Nine (Golduck sv, Drampa champions) |
| Seeds | **G4-SWX-33** Electric Seed (sv, champions) |
| Booster Energy / Quark Drive | **G4-SWX-34** (sv only) |
| Trace (random among the foes) | **G4-SWX-36** (sv, champions) |
| Download | **G4-SWX-41** (sv, usum) |
| Hospitality | **G4-SWX-35** (sv, champions) |
| Unnerve newcomer | **G4-SWX-37** (sv, swsh) |
| Supersweet Syrup | **G4-SWX-44** (sv, champions) |
| Curious Medicine | **G4-SWX-46** (sv, champions) |
| Costar | **G4-SWX-49** (sv only) |
| Intrepid Sword | **G4-SWX-50** (sv: once used, no boost; swsh: +1 at every entry) |
| Wind Rider under Tailwind | **G4-SWX-51** (sv only) |
| Screen Cleaner | **G4-SWX-52** (champions, swsh; no Mr. Rime in SV) |
| Neutralizing Gas: newcomer under it, gas newcomer (kept), the leaver's gas ending (kept) | G4-SWX-14 (sv, swsh), -15 (sv, swsh), -25 (sv) |
| Imposter | G4-SWX-16 (sv, champions) |
| Commander (kept) | G4-SWX-20 (sv only) |
| A second Eject Pack at SwitchIn | G4-SWX-05, -30 |
| Leaving: Regenerator, Natural Cure, Zero to Hero | G4-SWX-07 (sv, champions), -18 (sv, usum), **-38** (sv, champions: Palafin-Hero on the bench) |
| Baton Pass stages, Shed Tail's Substitute | G4-SWX-09, -19 |
| Landings and Wish at a newcomer's position, a benched source | T2E-BL-01…03, IN-FSL-02 |
| Assist, Beat Up, Pursuit with the bench | T2P-AST-01/02 (usum), T2P-BTR-01 (sv, champions, swsh), CQ-PUR-R-01/02 (usum) |

**Still only in R-E's quick probes, not stored:**
- Room Service, a Protosynthesis newcomer in sun without Booster Energy, Embody Aspect, Dauntless Shield, Psychic and
  Electric Surge newcomers;
- the Mirror Herb copy at SwitchIn (R4-WEB-MIRRORHERB);
- Wimp Out after the residual (G4-SWX-12's Emergency Exit uses the same handler);
- Red Card in Champions.

R-E's own `w2-re/cases-re.ts` cases (Sheer Force with the after-move items, Red Card with Life Orb, Pursuit with Technician
or Destiny Bond) are still not stored. `tests/unit/doubles-switch.test.ts` pins their numbers.

Wave 2 is now `v3/count.ts`: `129 cases in 68 families; 4 not estimated (*); oracle results missing: none`.

### F4. Harness tests

`v3/harness.test.ts` gained 3 tests, now 25 in all:
- a newcomer dragged in inside the move owns its later lines (G4-SWX-31, -32);
- `exactMoves` passes the action move as `moves` (T2P-AST-01);
- `gen-tests.ts --keep-rows` keeps a stub's row in place and byte for byte (a child process into `os.tmpdir()`).

The 4 tests that fail here fail on missing files only. Each failing id or file is absent from this tree:

| Suite | Result | Failing test and its cause |
|---|---|---|
| v3 | `Tests  1 failed \| 24 passed (25)` | `without a bench the oracle is the one before wave 2`: `Error: no case ZS16` (zmove-status is a stub). F2's ab-pin covers the same check on loaded cases. |
| V1 | `Tests  2 failed \| 16 passed (18)` | `ENOENT … v1/fixtures/G4-OPP-11-sv.oracle.json`; `expected '' to match /fieldSet/` for RT-RV02 (a stub id) |
| V2 | `Tests  1 failed \| 25 passed (26)` | `R09: expected false to be true` (R09 is a stub id, review-engine) |

All three results are the same before and after this finish's edits.

### F5. The regeneration, dry-run (integration 2 runs it for real)

**`gen-tests.ts --keep-rows=<test file>`** (new) reads the rows of the existing test file:
- A row whose case does not load (a stub) is kept byte for byte, in its place.
- Every other row is generated again (its id joins KEEP), and the run logs any row that comes out different.
- A new row goes in CASES order among the generated ones.

**The dry-run** used `$RV/gen/before.test.ts`, a copy of today's `tests/unit/doubles-turn-showdown.test.ts`, and wrote
`$RV/gen/doubles-turn-showdown.test.ts`:

```
STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts --compare=$RV/compare-final.json --keep-rows=$RV/gen/before.test.ts --out=$RV/gen/doubles-turn-showdown.test.ts
keep-rows: 1985 rows before, 282 kept as they were (their case does not load), 125 new
wrote 2110 cases to …/r-v/gen/doubles-turn-showdown.test.ts (0 cases that do not agree with the app left out)
```

- **Rows.** All 1985 old rows are byte-equal and in their order, the 282 stub rows among them. The 125 new rows are wave 2's
  estimated cases (129 − 4 not estimated), after the old ones. No row was logged as different.
- **Code.** The checking code differs from today's file in two places only: the `exactMoves` line, and a sixth table part
  (`CASES_6`).
- **Checks.** Copied to `v3/gen/` for the run (then removed):
  - `vitest.gen.config.mts`: `Test Files  1 passed (1)`, `Tests  2110 passed (2110)`;
  - `tsc` (scratch tsconfig extending the root's): exit 0;
  - `eslint --no-ignore`: exit 0.
- **The file:** `$RV/gen/doubles-turn-showdown.test.ts`, sha256 `493817026f4f789331f8f8e66539a5a359359d9d7fe6b1d1c3f967c88b4ed76c`.

**For integration 2, after compare.ts (STATUS2_REEXPECT=1a,1b) has written results/compare.json:**

`STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts --keep-rows=tests/unit/doubles-turn-showdown.test.ts`

### F6. changed-cases.ts (wave 2)

- **Before set:** the committed `verify/app-results/` of `origin/wip/status2-cache`, 2336 files, extracted with `git
  archive` to `$RV/before-root/`. It is identical to the tree's copy.
- **After set:** `STATUS2_REEXPECT=1a,1b v3/run.ts --store-dir=$RV/app-final`, every case that loads.
- **Result:** `changed-cases.ts diff <before> $RV/app-final --wave=all` printed `1898 cases: 1769 unchanged, 0 stored cases
  changed, 0 failing the gate.` and exited 0.

So no stored case's app output changed in wave 2 (for the 1769 that load), and none is NOT LISTED. `listChanged2`'s four
hazard rows (S1-RSP ×2, FS07b/FS08c-champions) stay listed. Their output is unchanged, as §4 expected.

### F7. Gates (final code; the lines as printed)

1. `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v3/run.ts --wave2 --quiet`: `129/129 cases match.` The same
   with `STATUS2_REEXPECT=1a,1b`: `129/129 cases match.`
2. `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v3/run.ts --quiet` (every case that
   loads): `1898/1898 cases match.` That is 1769 stored cases and 129 wave 2 cases; the 544 stub ids are not run.
3. `--validate` on the 42 new cases: every walk `equal to N whole-turn replays` (F3).
4. changed-cases.ts: `1898 cases: 1769 unchanged, 0 stored cases changed, 0 failing the gate.` (F6).
5. The regeneration dry-run: `Tests  2110 passed (2110)`; tsc exit 0; eslint exit 0 (F5).
6. Harness tests: v3 `24 passed`, V1 `16 passed`, V2 `25 passed`. Their 4 failures are missing files (F4).
7. Type check of the edited harness files (scratch tsconfig with node types; app-turn, gen-tests, cases, cases-r, sim-dfs,
   v3/harness.test.ts, v3/run.ts, changed-cases.ts): no error in any edited line. The errors left are the older ones §7
   lists (cases-cq-1b.ts, compare.ts's note argument and `outcomes`, sim-dfs's `ch`, sim-dfs-pre-r.ts, cases.ts
   `sdNoTarget`) and the Showdown copy's own sources.
