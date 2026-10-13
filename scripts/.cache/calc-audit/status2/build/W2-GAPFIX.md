# Wave 2 gap fixer (status2, Track R; cloud session 2026-10-12)

The wave 2 completeness critic listed 8 gaps (1 blocking, 7 "should") and 4 minor items after R-E, R-T and R-V finished.
This pass checked each one against pinned Showdown c23d2e94, fixed the real ones with a regression test and, for engine
behaviour, stored oracle cases. It also resolved the tracks' one-line asks.

- **Branch:** `calc-2v2-status-2`, checked before the work and before this report. Nothing was committed, pushed, switched or
  merged. No CastMirror, RaidCard, `.claude/` or `node_modules` file was touched, and no stub was edited. No `next build`,
  nothing against live Supabase, no seed script.
- **Line endings kept:** every app, test and doc file is LF, as it was. In the harness, `compare.ts` and `case-types.ts` stay
  CRLF; `sim-dfs.ts`, `cases-r.ts` and `w2-rt/rt-fuzz.ts` stay LF.
- **Scratch:** `/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad/gapfix/` (`$GF` below):
  `cases-gf.ts` and `run-gf.ts` (the probe cases run before storing), `order.ts`, `embody2.ts`, `ui-names.ts`, the oracle
  re-runs (`oracle-after/`, `validate*/`) and the gate logs.

## Gaps: verdict and fix

| # | Gap | Verdict | Fix | Proof |
|---|---|---|---|---|
| 1 | Eject Button / Red Card behind a face, with a bench (blocking) | real: RE-FACE-* did not agree | `w2-re/faces-ask.diff` applied to `doubles-faces.ts afterMoveItems`. It drops `selfSwitch` and the SWITCH_MOVES import. With a bench on the leaver's side it leaves the item to R's `switchOut`, and it passes Red Card's holder as `switchOut`'s 6th argument. The two `it.fails` in `doubles-switch.test.ts` are now `it`. | G4-SWX-53/54/55 (sv, usum); DS face tests |
| 2 | A spread move into two Eject Button (or two Red Card) holders | real: CR-EB-SPREAD 74 mismatches, CR-RC-SPREAD 2 | `doubles-switch.ts`: `replaceSlot` records a second holder's Eject Button or Red Card in the same AfterMoveSecondary event. The event key is the action index plus the attacker (`Pending.by`), and a rival in that event is not a standing flag yet. The new `contested()` runs in `resolve()` before the items are used up. It orders each event's rival holders by Speed (`speedOrders`: one world per order of a tie). The first holder acts and the others keep their items. Eject Button and Red Card do not stop each other: the button sets no forceSwitchFlag and the card comes after it. An inert Red Card, whose attacker cannot be dragged, stops nothing. A holder whose card was already used this action does not use it again. | G4-SWX-56 (sv, champions), -57 (sv, tie), -58 (sv, champions); DS ×3 |
| 3 | Pursuit at a Baton Pass user (USUM) | real: 44 mismatches | `beforeSwitchOut` skips a leaver whose pending switch is Baton Pass or Shed Tail. These are pinned's only `skipBeforeSwitchOutEventFlag` setters (moves.ts:1108-1111, 16189-16192; battle.ts:2894-2896). That Pursuit then hits the newcomer at 40 power. **Also found:** the turn's C30 guard in `doubles-presence.ts aim` read `kernel.input.pokemon[foe].switchedIn`. That is the occupant view, where every mid-turn newcomer has `switchedIn`, so a Pursuit at a newcomer was not estimated (`Pursuit with a Pokémon that switched in this turn ...`). The guard now reads `kernel.baseInput`, the switch before the moves, which is what C30 guards. | CQ-PUR-R-03 (Baton Pass), -04 (Pursuit after a Red Card drag), -05 (Parting Shot, from the critic) (usum; no Pursuit in SV/Champions); DS ×2 |
| 4 | Supreme Overlord on a newcomer was not estimated | real | `abilityEntry`: Supreme Overlord on a newcomer returns `[w]`. Pinned onStart only stores `effectState.fallen`, which only its own onBasePower reads, and a newcomer uses no move this turn. A1's guard stays for the ability gained mid-turn. | G4-SWX-59 (sv, champions); DS |
| 5 | Embody Aspect on a Terastallized Ogerpon newcomer | real. **Also found:** a bench Ogerpon with mechanic "tera" came in as its mask form with the mask's ability. The calculator's bench build is the mask form plus "tera", so a Water move would have been absorbed by Water Absorb. | `newcomer()`: a Terastallized Ogerpon is its mask's Tera form with that form's ability (`specialTeraForm`, as the start settle does; every Ogerpon form has the same stats). Terapagos is left as it was: Tera Shift's guard stays. `embodyEntry` gives +1 to the aspect's stat from itself at each entry, for the matching Tera form while Terastallized. The oracle (`sim-dfs.ts`) now supports a bench member with `choice: "terastallize"`, Terastallized earlier: terastallize's state and Ogerpon's permanent Tera form. | G4-SWX-60 (Wellspring by U-turn), -61 (Teal by Roar, 1/2), -62 (not Terastallized) (sv only: Tera exists only in SV); DS |
| 6 | The UI named the Pokémon that left | real | Contract: `DoublesStep.id`, the step Pokémon's MonState.id. It is set by `extraStep`, whose key now includes it, so a newcomer's Dancer copy is its own step. Contract: `DoublesResidual.otherId`, set in `doubles-eot.ts Recorder.act` from the occupant at `other`. It is null where that occupant differs between paths; the entry's key is unchanged, so the oracle comparison is unchanged. UI: `stepNames()` names the step's slot after `step.id`, and each slot it reaches after the newcomer when every hit there reached the same one (this also covers minor item 4). `stepHeading`, the Show move sr-only text and the hits aria-label use it. A newcomer's step has no Show move: the Pokémon has no card. `residualLine(…, benchNames)` names `other` by `otherId` (null: no "from"). | calculator test "names a newcomer's own step…"; `$GF/ui-names.ts` gives `Swords Dance · Oricorio → itself`, `Leech Seed · Snorlax (opponent's, 2): −29 HP (from Snorlax (yours, 2))`, `Body Slam · Snorlax (opponent's) → Oricorio` |
| 7 | The oracle harness could not check a newcomer's own step, or a newcomer that leaves again | real (harness) | `sim-dfs.ts`: a Dancer copy by a bench Pokémon is recorded under its slot with `ActionRec.id`, and `WalkResult.copies` is keyed with the id (`case-types.ts`: `id?` on copies). `replacedExpected` gives a leaver that is a newcomer its own start and maximum, from its entered record. `monState` reads a benched starter's `swapped` from the newcomer standing for its slot. `compare.ts`: copies are matched by `DoublesStep.id`, a copy's newcomer hits go through `compareEnteredHits`, and the default-replacement fact is counted per chosen newcomer, not per slot. | G4-SWX-63 (Dancer, sv, usum), -64 (Emergency Exit newcomer leaves again, champions, usum), -65 (Ally Switch then U-turn, sv, usum), -66 (Sticky Web Eject Pack newcomer, sv, swsh). Every stored wave 2 result is byte-equal (`ms` aside) when run again with these changes (125/125), and the oracle without a bench is byte-equal to `sim-dfs-pre-r.ts` (10 loaded cases, a Dancer case among them) |
| 8 | Training: the player's second replacement on one side did not follow Q9 | real | Contract: `DoublesTurnInput.replacementOrder?: Partial<Record<DoublesSideId, "healthiest" \| readonly string[]>>`. It is validated (`A replacement order names a Pokémon that is not on its side.`) and is part of the engine memo key (`evaluate.ts inputKey`). Engine (`switchRound` → `healthSplit` + `switchPicked`): with "healthiest", each pick is the bench Pokémon with the highest HP share at that switch, a Pokémon that left earlier this turn included. Ties go to team order, and a side's leavers pick in their positions' order. A leaver whose marginal HP decides the pick splits the world: by groups of values with one candidate, by values with more. A list gives the first id still on the bench. Neither states a fact. Bridge: `own: "healthiest"` with no per-slot replacement for the player. The AI keeps its per-slot ReplacePolicy pick and adds the policy's ranking of its whole living party (bench ids and its starters' start ids), asked for its first slot in play: an approximation for later picks, since the ranking does not follow the slot. `healthiestOf` is gone (no reader). | `training-status2-r.test.ts` "both player Pokémon U-turn…" agrees with the real battle answered by `replacementChoice` (Incineroar 60% in, then Rillaboom back in); DS ×3 (split chances, list, validation) |

## Minor items

| Item | Verdict | Fix |
|---|---|---|
| Stored cases for the critic's agreeing probes and R-V's open entry effects | done | `cases-r.ts` G4-SWX-67…81: Champions Eject Button with U-turn, Champions Red Card, Electric Surge with Quark Drive, Protosynthesis in sun, Rapid Spin, Court Change, Roar into Magic Bounce, Dragon Tail and U-turn into a Substitute, Whirlwind into Wind Rider, Room Service (sv, swsh), Dauntless Shield (sv, swsh), Psychic Surge (sv, usum), Mirror Herb at the SwitchIn (sv), Wimp Out after the residual (swsh, usum). CQ-PUR-R-05 is Parting Shot. |
| The calculator Bench was not offered for some sides | real | `doubles-inputs.ts benchRead` also reads: its own Roar or Whirlwind at a Magic Bounce holder or a Magic Coat user; an ally's Red Card when its partner's damaging move hits allies (`allAdjacent`); a switching move that Sleep Talk (its prepared moves), Copycat or Mirror Move may call (this turn's actions, the battle's last move, the Pokémon's last moves); a drag move such a calling move may call, for the foe side. Test: "reads a Roar sent back by Magic Bounce or Magic Coat, …" in `calculator-doubles-bench.test.ts`. Doc updated. |
| Training dropped a pending Healing Wish / Lunar Dance | real | `tracker.ts`: the user's faint inside its own Healing Wish or Lunar Dance adds the side condition (layers = position + 1), and the `-heal … [from] move: Healing Wish` line removes it. `belief-battle.ts` rebuilds it as the slot condition, so rollouts now heal too. The bridge adds the rollout reason `A Healing Wish waits for a Pokémon at {Name}'s place.` (or Lunar Dance) while one stands on a side with a Pokémon left to switch in. `board.ts` names both conditions. Test: "a Healing Wish waiting at a position" (real battle → tracker → belief battle → reason). |
| The step heading named the Pokémon that left as a later move's target | real | Covered by gap 6's `stepNames`: a slot whose hits all reached one newcomer is named after it; mixed outcomes keep the chosen target's name. Test in the same calculator test. |

## The tracks' one-line asks

- **R-E's faces diff:** applied (gap 1).
- **R-T's doc line on `DoublesOutcomeMon.id`:** applied (`… or startId(other slot) when that slot's starting Pokémon came back in here`).
- **R-V's `app-turn.ts` exactMoves and `cases.ts` REEXPECT asks:** R-V had done them already.
- **Not one-liners (integration 2's):** conformance, leak, eval, the regeneration with `--keep-rows`, and syncing `.cache` to
  `wip/status2-cache`. Those stay with the integrator. Two of them now need more:
  - The sync has more to carry: the edited harness files (`sim-dfs.ts`, `compare.ts`, `case-types.ts`, `cases-r.ts`,
    `w2-rt/rt-fuzz.ts`), the 46 new `results/*.json`, and this file.
  - The regeneration will add rows for the 46 new cases.

## Doc

`docs/champions-calculator.md` covers the Bench's wider readers, the newcomer names (a newcomer's step, its targets, Leech
Seed's heal), and C30's narrower scope (a Pokémon that switched in before the moves). The "Battle states that cannot be set
here" list is untouched.

## Not changed, with reasons

- **Terapagos on the bench Terastallized:** the newcomer keeps its build's form. Tera Shift's guard (`REASONS.abilityStart`)
  still makes that turn not estimated, so nothing wrong is estimated.
- **An AI's later pick in Training:** this uses a ranking asked for its first slot in play, not per slot. The ReplacePolicy
  scores per slot, so this is the documented approximation in the bridge comment.
- **G4-SWX-57 (the speed tie):** stored without a whole-turn `--validate`. Its holders' Speed tie also ties every other Speed
  sort of the turn, so the unmerged replays pass the 200 000-run cap. The first version stopped at `over 200000 runs`. For the level 1
  version, `--validate` did not finish within 10 minutes, and its lowest walk alone did not finish within 15. The merged
  oracle and the app agree.

## Gates (final code)

These ran on the final tree, with `git branch --show-current` printing `calc-2v2-status-2` before and after. Each line is
copied as printed; the logs are in `$GF`.

1. `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v3/run.ts --wave2 --quiet`: `175/175 cases match.` (129 before
   this pass, plus 46 new). The same with `STATUS2_REEXPECT=1a,1b`: `175/175 cases match.`
2. `STATUS2_REEXPECT=1a,1b … v3/run.ts --quiet --store-dir=$GF/app-final --compare-out=$GF/compare-final.json` covers every
   case that loads: `1944/1944 cases match.` That is the 1769 stored cases and the 175 wave 2 cases. The 544 stub ids are not
   run, because their case folders are stubs in this tree.
3. `changed-cases.ts diff <wip/status2-cache app-results> $GF/app-final --wave=all`: `1944 cases: 1769 unchanged, 0 stored
   cases changed, 0 failing the gate.` R-V's app-final against this pass's, for the 1898 cases both have: `1898 equal, 0
   differ` (`ms` aside).
4. Oracle:
   - The 125 stored wave 2 results run again with the edited `sim-dfs.ts` give `125 equal, 0 differ` (`ms` aside).
   - `sim-dfs-pre-r.ts` against `sim-dfs.ts` without a bench is `byte-equal` on all 10 loaded cases tried: E31c, ER32a,
     S1-RSP-champions, T2P-CMD-05-sv, T2P-CMD-05b-sv, T2P-BKB-02-champions, S48-Teleport-noSwitch, E32a, ER29c, T2P-DAN-01-sv.
   - `--validate` on the 46 new cases: 45 cases give `equal to N whole-turn replays` in all three walks, and their validated
     results equal the stored ones (`45 equal, 0 differ`, warnings aside). G4-SWX-57 is the exception: its whole-turn
     replays pass the cap ("Not changed").
5. `npx tsc --noEmit`: exit 0, no output.
6. `npx eslint` on the 18 changed app and test files: exit 0, no output. The edited harness files were type-checked with a
   scratch tsconfig: no error is on an edited line. The errors left are R-V's §7 older ones (`compare.ts` 142, 179 and 694;
   `sim-dfs.ts` `ch`).
7. `npx vitest run --config vitest.unit.config.ts tests/unit/doubles-*.test.ts tests/unit/training-*.test.ts
   tests/unit/calculator-doubles-*.test.ts tests/unit/status2-*.test.ts`: `Test Files  116 passed (116)` / `Tests  4214
   passed | 1 skipped (4215)`. This includes doubles-switch (58), training-status2-r (29) and calculator-doubles-bench (32).
   An earlier run under the oracle jobs' load failed only `doubles-turn-perf` "lists a full learnset" (79 ms against 75). It
   passed alone and in this final run.
8. `npx vitest run --config vitest.battle-data.config.ts tests/source/status2-hooks.test.ts`: `Tests  8 passed (8)`. The
   other `tests/source` suites fail here before any test runs: `Offline source archive missing:
   pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353.tar.gz`. The handoff's restore deletes `pinned/` after extracting
   it. This is the environment, not this pass (integrator's need).
9. `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal
   (8617 ms)`.
10. Harness tests (`v3/vitest.v3.config.mts`): `Tests  1 failed | 24 passed (25)`. The one failure is the stub's `no case
    ZS16`, as R-V reported.
11. Regeneration dry-run:
    - Command: `STATUS2_REEXPECT=1a,1b gen-tests.ts --compare=$GF/compare-final.json
      --keep-rows=tests/unit/doubles-turn-showdown.test.ts --out=$GF/gen/doubles-turn-showdown.test.ts`.
    - Output: `keep-rows: 1985 rows before, 282 kept as they were (their case does not load), 171 new` / `wrote 2156 cases`.
      No row was logged as different.
    - Every old row is byte-equal and in place. Only R-V's two code lines differ.
    - Run from `v3/gen` (then removed): `Tests  2156 passed (2156)`.
    - The first dry-run failed G4-SWX-64 and -66 on the generated default-fact count. `gen-tests.ts benchRow` now counts as
      `compare.ts` does.
    - sha256 `c5eeff3149a83b9e400b36ae070fa444395d29a8bd6ff16cf21289574f0b0e2f`.
12. R-T's fuzz (`w2-rt/rt-fuzz.ts 20 1`, its replacement check updated for `replacementOrder`):
    - Counts: `"issues": 0`, `"notEstimated": 0`, `"ready": 2862`, `"policyIssues": 0`, `"mismatches": 0`,
      `"secondPick": 108`, `"secondPickOwn": 50`.
    - No notes.
