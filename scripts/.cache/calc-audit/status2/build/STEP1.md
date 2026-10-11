# Step 1: the correctness fixes (status2)

SPEC2 §8.2's eight rows and ADDENDUM2 §8.2's #9–#16, each reproduced on its oracle cases against pinned Showdown c23d2e94
(`scripts/.cache/calc-audit/2v2/verify/cases-status2-step1.ts`, wired into the oracle set through `cases-se.ts` as
`cases-review.ts` is; every case's `results/<id>.json` stored), fixed, confirmed and pinned by unit tests. Every number is the
pinned simulator's in sv, champions, swsh and usum; texts are facts, Pokémon named by name.

## Status

Done: all 16 fixes, their 64 oracle cases (62 run by the oracle, 2 checked by their not-estimated reason), the unit tests, and
the gates (last section). Nothing was committed or pushed (the harness forbids it, so "one commit each" is not done: the fixes
sit in the working tree with Step 0's); no branch was switched; `.claude/` and `node_modules` untouched; no `next build`,
nothing against live Supabase.

From here the frozen-file rule of SPEC2 §8.2 / ADDENDUM2 §8.2 applies: `doubles-turn.ts`, `doubles-status.ts`,
`doubles-world.ts`, `doubles-types.ts`, `types.ts`, `doubles-actions.ts`, `uses-to-ko.ts`, `hit-loop.ts`,
`engine-corrections.cjs`, `model.ts`, `mechanics.ts`, `doubles-targets.ts`, `intimidate.ts`, `doubles-positions.ts` are the
integrator's (agreed one-line changes, reviewed); `status-table.ts` is only regenerated.

## The fixes

"main" is 4008ee8 (the scratch `headtree`, the app through `TSX_TSCONFIG_PATH`) against the stored oracle; "now" this tree.

| # | Fix | Where | Cases (main → now) | Tests |
|---|---|---|---|---|
| 1 | Ally targets in the pairwise step: no Defiant / Competitive, no Opportunist copy (F4 F1) | `doubles-turn.ts searchFor`: `extra.allies` when the target is the attacker's ally | G4-ALY-01-sv 15 mismatches, -02-swsh 12, -03-champions 15 → match; -04-sv matches on main too (compare.ts reads only the E2 stage keys the oracle has, so Espathra's +0 is the unit test's) | `doubles-guards-ally.test.ts` (5: the three Kowtow Cleave / Scald ranges, Espathra +0 in E2, a foe's Bulldoze control) |
| 2 | Champions: a Sheer Force hit locks a Berserk / Anger Shell holder's healing Berry (F4 F2) | `doubles-guards.ts sheerForceLock` (Berry read as Leftovers in the step, put back with `vol.berryLocked: "sheerforce"`), `noMoveUnlock` (its own No move: AfterMoveSecondary resets it, the Berry due); called from `doubles-turn.ts singleStep` / `execute` and `doubles-spread.ts`; `lockedBerryGuard` names the source (`REASONS.berryLockedSheerForce`); `doubles-status.ts hitOne` guards the holder's own status move into itself | G4-SFL-01-champions 1 → not estimated with `Sitrus Berry held by Berserk after a Sheer Force hit is not modelled in 2v2.` (the later Body Slam's reset is D's); -02b-champions 33 → match; -02-champions, -03-sv, -03-usum match on both | `status2-step1.test.ts` #2 |
| 3 | Color Change (F2 §4) | `doubles-typing.ts colorChange` from the afterHit hook: a damaging hit that reached it (not a Substitute, not a Sheer Force skip, not "???", not its own type), Terastallized excluded; a Curse-queued Ghost change not estimated; hit fact `Color Change: {Name} becomes {Type} type.` | F2-CC1-usum 11, F2-CC4-usum 12 → match; F2-CC2 (Substitute), F2-CC3 (Sheer Force) match on both | #3 |
| 4 | Trace's facts read the copied ability (F4 F3) | `doubles-status.ts turnFacts(input, suppressed, settled)` from `doubles-turn.ts turnFacts(input, settle)`; `doubles-prep.ts` carriedOptions reads `tracedAbility` | G4-TRC-01-sv, -02-usum match on both (compare reads no turn facts): main's `Assumes Gardevoir lost no turns to sleep before this one.` beside the cure fact is gone | #4 |
| 5 | Ghost Curse: the cost is a loss on the user's card, its faint a step fact | `doubles-status.ts` Curse handler: `kernel.lossFact(user, "{Name} loses {n} HP (Curse).")` | G4-CRS-01-sv, -02-champions match on both (facts); stored ER20, S26d, VE-F4-2 change their fact only (listed below) | #5 |
| 6 | canStatus: the type immunity before Comatose | `doubles-status.ts canStatus` | — (text) | #6: a Steel-Terastallized Komala against Toxic says `Komala is immune.` |
| 7 | Rapid Spin / Mortal Spin clear the pre-turn hazards (`hazardsFrom: null`); `nextClock` reads it and a Safeguard set this turn | `doubles-eot.ts` Rapid Spin block (one line, see deviations); `ai/evaluate.ts nextClock`, `SET_THIS_TURN.safeguard` | S1-RSP-champions (Starmie Rapid Spin), S1-RSP-sv (Glimmora Mortal Spin): 2 → match (pre-turn hazards in the harness, below) | `training-status2-step1.test.ts` #7 |
| 8 | Training: accuracy and evasion stages from earlier turns into `carried.stages` (F4 F4); a positive one under Stored Power / Power Trip not estimated until D | `sim/bridge.ts carriedOf`; `doubles-guards.ts hiddenStageGuard` names it (`REASONS.hiddenStagesEarlier`) | — | training #8; `status2-step1.test.ts` #8 |
| 9 | Unburden at the turn's first Update (T2P §5.1) | `doubles-status.ts turnStartUpdate`: `abilityActive: true`, no throw; and USUM's frozen order reads the status a Berry cures at that Update: `calculate.ts settleItems` gen-7 block sets `firstTurnSpeed.status`, `turnSpeed` (and the 1v1 `speed()`) read it; `types.ts` `firstTurnSpeed.status` | T2P-UNB-02-usum, -04-usum (Mold Breaker) 4 → match; -05-usum (Quick Feet Jolteon, burned: 225 before Crobat's 182) 5 → match; -01-sv, -03-champions match (main had no throw; the throw was Step 0's code); stored FE-FX02b changes (below) | #9 |
| 10 | Crash damage (C24) | `doubles-hidden.ts crash` from `doubles-turn.ts damagingMove` (`hitSomething`: a target's HP or Substitute changed); generated `CRASH_MOVES` (`gen-status-table.ts`, `dex-dump.ts`'s `hasCrashDamage`); loss `{Name} loses {n} HP ({Move}).` | FX-CR-01…05 10–13 → match (FX-CR-06-sv: not estimated, semi-invulnerable after Fly, as listed); CQ-CRS-01a, -02-sv, -02-usum 10 → match; CQ-CRS-01b, -03 match on both | #10 |
| 11 | The earlier-this-turn flags (C19) | `sim/tracker.ts PublicCounts.thisTurn` (non-zero `-boost`/`-unboost`, Belly Drum's `-setboost`, an item used or eaten; cleared at `\|turn\|N` for N ≠ 1), `sim/services.ts earlierOf` (tracker ∪ the prelude copy's flags, cleared before it runs), `sim/bridge.ts` `earlierThisTurn` and, with `usedItem`, `lastItem` (the engine asks for the item; else a rollout); oracle `prepare()` clears the flags | CQ-ETT-02-sv, -champions 12 → match | training #11 (tracker lines; leads' Intimidate on turn 1, none on turn 2; Sneasler's White Herb: `usedItem` with `lastItem`; a switch-in's Intimidate through the prelude) |
| 12 | Burning Jealousy and Alluring Voice | `doubles-reactions.ts volatileSecondary` (burn through `statusLands` / `giveStatus`, confusion through `doubles-status.ts moveConfusion`) when the target's stats rose this turn before the hit (`applyStep`'s `raisedBefore`); turn fact `Assumes {Name}'s stats did not rise earlier this turn.` for a given stage with no `earlierThisTurn.statsRaised` | FX-BJ-01-sv, -02-champions 6 → match; T2M-VS-01-sv/-swsh, -03-sv/-champions not estimated → match; CQ-ETT-01-sv/-champions 18 → match | #12 |
| 13 | Spectral Thief | `doubles-reactions.ts beforeStep`: the steal after the type-immunity probe (`kernel.applyBoosts` on the user, `writeStages` zeroes the target), hit fact `Spectral Thief: {User} takes {Name}'s +2 Attack.` | FX-ST-01-swsh/-usum 1 → match; T2M-VS-04-swsh/-usum not estimated → match; -04b-swsh (Normal type, immune, nothing stolen) matches on both; stored VE-M1-3 gains the fact (below) | #13 |
| 14 | Training: a Pokémon that switched in takes no action | `sim/bridge.ts`: `switchedIn` for the switched slots; the Payback and Analytic rollouts and the FIRST_IN_A_SWITCHED_SLOT override go (the engine's `contextFor` reads `switchedIn`) | IN-SW01-sv/-champions 3 → match; IN-SW02…04 match on both (the engine side is Step 0c's); CQ-ETT-04-sv/-champions 18 → match | training #14; `status2-step1.test.ts` #14 |
| 15 | Training: the prelude's ties and samples enumerated | `sim/prelude.ts runPreludeWorlds` (≤ `PRELUDE_WORLDS_BOUND` = 8 weighted worlds), `sim/services.ts` bridges and splits each | — | training #15: TR04 rain / sun ½ each, TR05 sand / sun ½ each, four tied switches a rollout |
| 16 | Training: Cud Chew carried | `sim/tracker.ts PublicCounts.cudChew` (the Berry eaten this stint, until Cud Chew's `-activate` and its re-eat line, or a switch-out; not `[from] stealeat`), `sim/belief-battle.ts` restores the ability state (counter 1), `sim/bridge.ts` `carried.cudChew: true` from it (E2's end of turn not estimated: the simulated residual) | — | training #16 |

## Files (Step 1's; the working tree also holds Step 0's)

- Engine: `app/lib/battle/doubles-turn.ts` (#1, #2, #4, #10, #12), `doubles-status.ts` (#2, #4, #5, #6, #9, `moveConfusion`),
  `doubles-guards.ts` (#2, #8), `doubles-typing.ts` (#3), `doubles-reactions.ts` (#12, #13), `doubles-hidden.ts` (#10),
  `doubles-spread.ts` (#2), `doubles-eot.ts` (#7, one line), `doubles-world.ts` (`berryLocked: "sheerforce"`),
  `doubles-actions.ts` (`REASONS.berryLockedSheerForce`, `hiddenStagesEarlier`), `calculate.ts` and `types.ts` (#9:
  `firstTurnSpeed.status`), `status-table.ts` (regenerated: `CRASH_MOVES`; generator `gen-status-table.ts`, `dex-dump.ts`).
- Calculator: `app/(app)/calculator/doubles-prep.ts` (#4).
- Training: `app/(app)/training/ai/evaluate.ts` (#7), `sim/bridge.ts` (#8, #11, #14, #16), `sim/tracker.ts` (#11, #16),
  `sim/belief-battle.ts` (#16), `sim/prelude.ts` (#15), `sim/services.ts` (#11, #15).
- Tests: `tests/unit/doubles-guards-ally.test.ts` (new, 5), `status2-step1.test.ts` (new, 13), `training-status2-step1.test.ts`
  (new, 13), `training-bridge.test.ts` (runPreludeWorlds), `doubles-engine-verify.test.ts` (FX02b), the generated
  `doubles-turn-showdown.test.ts` (956 cases, 62 new).
- Oracle (`scripts/.cache/calc-audit/2v2/verify`): `cases-status2-step1.ts` (new), `cases-se.ts`, `case-types.ts`, `sim-dfs.ts`,
  `app-turn.ts`, `compare.ts`, `gen-tests.ts`, `results/` (62 new, FE-FX02 and FE-FX02b re-run, `compare.json`),
  `app-results/`; `status-eot/fix-engine/cases.ts` (FX02, FX02b).
- Build scripts (`status2/build`): `step1-run.ts` (run cases on both sides), `step1-changed.ts` (the gate's list),
  `step1-c19-scan.ts`, `step1-facts.ts`, `step1-learners.ts`, `step1-probe-berserk.ts`, `step1-prelude-probe.ts`,
  `step1-prelude-dbg.ts`, `step1-prelude-dbg2.ts`, `step1-training-issues.ts`, `step1-dbg.ts`, `step1-dbg-sw.ts`.

## Cases each fix changes (the gate's list)

`step1-changed.ts <Step 0 app results> <this tree's>` (both from `step0a-run-app.ts`) lists every case whose app result changed
or is new, with its fix, and compares each with its stored oracle result:

```
S26d: #5 Ghost Curse: the cost is a loss on the user's card, its faint the step fact: 4 paths changed (result.steps.0, result.hp.own-left, result.endOfTurn.hp); matches the oracle
ER20: #5 Ghost Curse: the cost is a loss on the user's card (the step fact moves to hp.losses): 3 paths changed (…); matches the oracle
FE-FX02b: #9 USUM's frozen order reads the paralysis a Lum Berry cures at the first Update (the case now sets the status silently: silentStatus, oracle re-run): 63 paths changed (…); matches the oracle
VE-F4-2: #5 Ghost Curse: the cost is a loss on the user's card: 3 paths changed (…); matches the oracle
VE-M1-3: #13 Spectral Thief: the steal's hit fact (the numbers were already Showdown's): 1 paths changed (result.steps.0); matches the oracle
G4-ALY-01-sv: #1: new case; matches the oracle
… (one line per new case: 62 "matches the oracle", G4-SFL-01-champions and FX-CR-06-sv "not estimated as listed")
1328 cases: 1259 unchanged, 69 listed (64 new Step 1 cases), 0 failing the gate.
```

The full output: scratch `s1/changed-2.txt`. The 1264 stored cases: 1259 byte-equal to Step 0, the 5 above changed by a listed
fix, every one matching its oracle.

## Harness support (the Step 1 builders' share; V takes these files over)

- `case-types.ts`: `CaseMon.earlierThisTurn`, `appBoosts` (a switch-in case's app stages after its entry), `silentStatus` (the
  status set with no SetStatus event, so a curing Berry waits for the turn's first Update); `CaseCarried.stages`;
  `CaseAction.switchIn`; `CaseSide.hazards` (pre-turn hazards, one layer).
- `sim-dfs.ts prepare()`: C19, the per-turn flags (`statsRaisedThisTurn`, `statsLoweredThisTurn`, `usedItemThisTurn`,
  `hurtThisTurn`) cleared after the setup and set from `earlierThisTurn` (`opts.keepEntryFlags` keeps them;
  `step1-c19-scan.ts`: "1310 cases; 21 with a flag the leads' entry set; 0 with a reader of it", so no stored result moves); a
  switch-in slot starts as a Splash Snorlax placeholder with the case's Pokémon on the bench (`pendingSwitchIn`, read by
  `monOf` until it enters; `Ctx.switching` keeps it out of the step tallies); `carried.stages`; `silentStatus`; pre-turn
  hazards.
- `app-turn.ts`: `appBoosts`, `carried.stages`, `earlierThisTurn`, `switchedIn`.
- `compare.ts`: a hazard stands after the turn where it landed this turn or the side's `hazardsFrom` is not null (pre-turn
  ones); `gen-tests.ts` the same, and the new fields in the generated test's input.
- `status-eot/fix-engine/cases.ts` FX02 / FX02b: `silentStatus: true`, oracle re-run (see deviations).

## Decisions and deviations

- **#9 grew a second part.** `abilityActive: true` alone left T2P-UNB-02/04-usum 4 mismatches each: generation 7 sorts the turn
  once before its first Update, so the order reads the paralysis the Lum Berry then cures (TP4·UB2: "usum's frozen order keeps
  the start Speed"). `firstTurnSpeed.status` carries it (paralysis, or any status under Quick Feet). It changes one stored case,
  FE-FX02b, whose oracle had never held the Lum Berry (`setStatus` at the setup ate it: its warning `own-left: Showdown item
  (none) at the start, case Lum Berry`); FX02 and FX02b now set the paralysis silently and were re-run: FX02 (sv) unchanged,
  FX02b Venusaur first, as its own `checks` text says. `tests/unit/doubles-engine-verify.test.ts`'s FX02b test is updated to
  that order. The 1v1 first-turn order (`calculate.ts` speed()) reads it the same way; golden-1v1 stays byte-equal (no golden
  case is a gen-7 status cured by an item at the first Update). T2P-UNB-05-usum (Quick Feet) is added to pin the other branch.
- **#7's line is in `doubles-eot.ts`** (Track E's file; the Rapid Spin / Mortal Spin block sets `hazardsFrom: null` beside
  `hazards: []`), not outcomeOf: that block is where the clear happens.
- **#4's UI line** is in `doubles-prep.ts` (U's file): the carried options read the copied ability.
- **#15's prelude** branches only what can matter: besides the queue's move actions (as designed) it does not branch an
  eachEvent tie (Update, BeforeTurn, WeatherChange…) among Pokémon of which at most one has a handler for the event, nor
  getRandomTarget's sample while the queue resolves an action or reads its Speed (spread and random-target moves; picked again
  when they run). Without that, two idle Snorlaxes at one Speed or a Heat Wave plus Earthquake gave 16–64 worlds and every such
  cell a rollout (training-bridge's Mega prelude test: 4 worlds of ¼).
- **#11 needs the item with `usedItem`.** The engine refuses `earlierThisTurn.usedItem` without `lastItem` (Step 0a's
  validation). The first eval run (bridge without it) failed Legality with 6332 / 1583 / 663 engine issues (open / closed /
  perfect): every one `An item used earlier this turn needs the item.` (`step1-training-issues.ts`: 17 of 965 engine worlds over
  six seat battles; 0 after). The bridge now passes `lastItem` (the belief battle's or the prelude copy's, public) with the flag,
  and rolls out if it is unknown.
- **T2M-VS-04** uses Bisharp (Pressure) as the robbed Pokémon: Lucario fainted to the +2 steal, so its later move never ran.
- **CQ-ETT-02/-04's Lash Out user** is Grimmsnarl (the 2v2 preflight checks learnsets; Snorlax does not learn it).
- **Magic Guard's crash** has no case: no Magic Guard Pokémon learns a crash move in the four games.
- **Not estimated until D** (as designed): G4-SFL-01-champions (the later hit's reset), a positive carried accuracy / evasion
  stage under Stored Power / Power Trip (#8).
- Speed ties: `lax(20)` and `lax(24)` are both 53 outside Champions; those cases enumerate the tie (slower oracle runs only).

## Findings outside Step 1 (for the tracks)

- **Berserk's rise after a hit is not in the step** (D / A1): `step1-probe-berserk.ts` PB-1-usum, Drampa hit to half then its
  Dragon Pulse: the app 58–69, Showdown 85–102 (+1 Sp. Atk). Not one of Step 1's rows; no stored case reaches it.
- **compare.ts reads only the E2 stage keys the oracle has** (V): an app stage the oracle lacks is not flagged (G4-ALY-04 at
  main); the generated test inherits it. The Step 1 unit test pins Espathra's +0.

## Gates (final code; exact output lines)

1. `npm run check`: `CastMirror parity verified: 862458f / castmirror-vercel-v1`; eslint and tsc print nothing;
   ` Test Files  236 passed (236)` / `      Tests  6024 passed (6024)` (Step 0b's 233 / 5931 plus the three new files, 5 + 13 + 13
   tests, and the generated file's 62 new rows); exit 0.
2. `npm run test:battle-data:source`: ` Test Files  9 passed (9)` / `      Tests  141 passed (141)`.
3. `golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal (3039 ms)`.
4. The cases each fix changes (`step0a-run-app.ts` into scratch, then `step1-changed.ts` against Step 0's `base-app`):
   `1328 cases: 1259 unchanged, 69 listed (64 new Step 1 cases), 0 failing the gate.`; `step0a-diff-app.mjs`: `1259/1264
   byte-equal (ms removed); differ: 5 ER20.json,FE-FX02b.json,S26d.json,VE-F4-2.json,VE-M1-3.json; missing: 0; extra: 64`.
5. `app-diff.mjs`: against its status-eot baseline the report is byte-identical (`cmp`) to Step 0's (`424  ready, byte-equal
   after the moves…`, `87 unexplained`); against the stored app-results (before this step stored its own) `1166  ready,
   byte-equal…` and `12 unexplained` where Step 0's was 1168 and 10: the two are FE-FX02b (#9) and VE-M1-3 (#13), listed above.
6. `regress.mjs …/verify/results`: `549/552 byte-equal after the moves (status-eot fields, ms and the walk bookkeeping stripped);
   differ: 3; missing: 0` (M24i, M24j, M29c, as at Step 0; the re-run FE-FX02 / FE-FX02b are not in its baseline).
7. `compare.ts` (stores `app-results/` and `results/compare.json`): `1328/1328 cases match.`; `step0a-compare.ts`: `1328/1328
   cases match.`; `gen-tests.ts`: `wrote 956 cases to …/tests/unit/doubles-turn-showdown.test.ts (0 cases that do not agree
   with the app left out)` (894 before).
8. Bench (`verify/bench.ts`, `results/bench.json` restored after each run; scratch `s1/bench1.sh`), two sessions of four rounds
   alternating main (headtree through `TSX_TSCONFIG_PATH`) and this tree:
   ```
   H1 turn p50 2.56 p95 6.66 | moves p50 11.15    C1 turn p50 2.52 p95 7.21 | moves p50 10.71
   H2 turn p50 2.55 p95 6.90 | moves p50 9.97     C2 turn p50 2.63 p95 7.04 | moves p50 11.56
   H3 turn p50 2.46 p95 6.75 | moves p50 8.67     C3 turn p50 2.63 p95 7.05 | moves p50 11.09
   H4 turn p50 2.52 p95 6.72 | moves p50 9.21     C4 turn p50 2.62 p95 7.07 | moves p50 11.01
   (final code)
   H1 turn p50 2.40 p95 6.06 | moves p50 8.62     C1 turn p50 2.41 p95 6.62 | moves p50 9.30
   H2 turn p50 2.33 p95 5.97 | moves p50 9.20     C2 turn p50 2.46 p95 6.40 | moves p50 10.44
   H3 turn p50 2.34 p95 6.00 | moves p50 9.48     C3 turn p50 2.48 p95 6.31 | moves p50 11.42
   H4 turn p50 2.32 p95 6.02 | moves p50 9.02     C4 turn p50 2.44 p95 6.30 | moves p50 9.30
   ```
   Means against main: turn p50 +3.1 % / +4.3 %, p95 +5.0 % / +6.6 %, moves pane p50 +13.8 % / +11.4 % (Step 0b measured +1.6 %,
   +3.8 %, −1.3 %). Statuses main ready 1397 / not-estimated 134 / issues 4, this tree 1403 / 128 / 4 (six cases main gives up on
   are computed now); reference mode 30/30 in every run. The moves pane's p50 is one run per job (23 jobs) and main's own runs
   span 8.62–11.15 ms. In one process, warm, alternating passes (`microbench-ab.ts`, `microbench-moves.ts` against headtree):
   turn ratio min 0.969 / 0.946, median 0.946 / 0.970; moves ratio min 0.966, 0.999, 0.944, 0.965, median 1.064, 0.923, 0.893,
   0.937 (this tree not slower). Across processes (`step1-moves-proc.ts`, three each): all turns 3545–3661 ms on main against
   3728–3761 ms (+3.4 %), the moves pane's first pass 238.7–251.5 against 249.1–264.9 ms (+5.6 %). No Step 1 code is on a hot
   path without an early exit (each new hook returns at its first test: the move id, the ability, Champions); the cross-process
   p95 and moves-pane numbers sit at or over the 5 % line, so I report them for the integrator rather than call them inside it.
9. Training gates (Champions; this tree and main on the same seeds: `--run s1-step1` for both, since eval's teams and seeds
   follow the run name; main run from the HEAD tree itself, as eval's shards pass `--tsconfig tsconfig.json`):
   - `eval:training --gates --scale 1 --shards 8`: this tree 20 PASS, 2 FAIL; main the same 20 and the same 2. The two:
     `Reads you − Plays safe, both vs HabitBot` (≥ +5): this tree `3.0 pts [-1.2, 7.2] n=400`, main `4.0 pts [-0.1, 8.1] n=400`
     (the gate SPEC2 §6 says sits near its sampling spread); `A1.4 status moves used (pool U)`: on these seeds Rage Powder is
     usable on 3 turns and never chosen, in both trees (`usable turns {"tailwind":189,"trickroom":51,"followme":37,"ragepowder":3}`
     both; chosen this tree `{"tailwind":43,"trickroom":13,"followme":1}`, main `{"tailwind":43,"trickroom":14,"followme":2}`).
     This tree: Legality `0 errors, 0 engine issues, 0 fallbacks, 0 capped` (open n=2600, closed 200, perfect 400); vs
     RandomLegal 99.0 %; vs MaxDamage 63.7 % (main 64.3 %); Reads vs MaxDamage 71.8 % (72.0 %); self-play 51.0 % (51.0 %);
     closed 99.0 %; open vs perfect −3.5 pts (−3.3); decision time `p50 282 ms p95 582 ms max 1219 ms (n=16038)` (main 274 /
     577 / 1181); preview / replacement 63 ms / 7.74 ms; belief closed 17 ms, open 6.03 ms; budget 240 / 160 / 4; dropped 0;
     pool S engine + prelude 89.0 % of 23175 (main 88.5 %); exploitability 0.01 %; determinism 20/20; the A1.5 rows pass.
   - `conformance:training`: every gated row PASS on this tree (tracker parity 840/840; belief 297/297; bridge 0 mismatches;
     clean rollouts 56527/56527 over 2936/3000 engine cells, main 2925; splits 33.7 / 35.0 / 25.1 %; choice strings
     23737/23785; census 0; E2 vs Showdown `Tests 960 passed (960)`, main 898; saved battles 30/30, Resume 30/30, Illusion 6/6;
     runner errors 0), as on main.
   - `leak:training`: every row PASS (L1-sp 0 differences in 190, -nature 231, -item 248, -ability 245, -moves 291, -bench 309,
     -hp 152, -dice 69, -dice-eot 73, -choice 129; the two settings work 160/200 and 65/129; L2 0 hits in 508 messages over 40
     battles; saved battles 40 replays equal, 10 resumed, 239 checkpoints sealed; Illusion and Transform 0 hits in 89 messages).
   The first eval run, before the bridge passed `lastItem` (decisions above), failed Legality with engine issues; that run and a
   main run that had not reached the HEAD tree (the shards' `--tsconfig`) are discarded.

Not run, as the task forbids: `next build`, anything against live Supabase. Nothing was committed or pushed; no branch was
switched; `.claude/` and `node_modules` untouched.
