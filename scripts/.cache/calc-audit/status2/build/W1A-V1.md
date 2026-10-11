# Wave 1a, Track V1: the oracle cases of wave 1a (ADDENDUM2 §7, SPEC2 §7.1)

Branch `calc-2v2-status-2` (checked before and after the work). Files changed: everything under
`scripts/.cache/calc-audit/2v2/verify/` named below, `status2/build/changed-cases.ts` (new), this file, and the generated
`tests/unit/doubles-turn-showdown.test.ts`. No app file, no frozen file, nothing of another track was edited.

## The cases (pinned Showdown c23d2e94, every one with a stored oracle in `verify/results/`)

604 wave-1a cases in nine files, all appended to the status-eot set (`cases-se.ts` imports `WAVE1A_CASES`), ids per spec:

| File | Families | Owner of each (cases-wave1a.ts `OWNER`) |
|---|---|---|
| `cases-in.ts` | IN-STL, IN-CHG, IN-LSF, IN-DBD, IN-ENT, IN-STK, IN-ATR, IN-ACC, IN-SFG, IN-MST, IN-SPT, IN-SEC, IN-NBL, IN-PRT, IN-RC, IN-SU, IN-FO | N, H, kernel, A1, A2, A3, W |
| `cases-cq.ts` | CQ-STK, CQ-ETT-03, CQ-STL, CQ-DBD, CQ-SKD, CQ-ENT, CQ-ALY | A1, E1, N, H |
| `cases-t2e.ts`, `cases-t2m.ts` | T2E-SI, T2M-SI, FA, FS, SB, SP, ALE, FB, BE, AR, GW, AS, SG, RI | H, S, W |
| `cases-cr.ts` | CR-01…CR-08 (the carried state) | A1, A2, E1, D |
| `cases-sat.ts` | SAT-ACU, PSY, SWP, SPD, SPL, TRK, TOP, STK, CHK, TID, NRT, AUT, MIN, GEO, PLM, FLS, ROT, SKS, RPL, ENT, SBM, WSD, GAS, DDL, TRF, IMP | A1 |
| `cases-f2.ts` | F2-SK … F2-G (types, Electrify, Ion Deluge, Tar Shot, Foresight, Attract, Powder, Protean, Roost…) | A2 |
| `cases-fs.ts` | FS01…FS2x (Magic Coat, Snatch, Mat Block, Mist, Lucky Chant, Court Change, Recycle, Teatime…) | A3 |
| `cases-g4.ts` | G4-OPP, HRV, PKP, STP, FLG, OHK, SPH, BZK, HBK, PER, STF, WHR, LOZ, LMV, ENC, GLV | D, E1 |

`case-kit.ts` holds the builders; `status2-removed.ts` the reasons this build removes (owner and wave each; now also
`Symbiosis is not modelled in 2v2.` for D) and `REEXPECT_TO`; `cases.ts` drops a stored case's removed reason only under
`STATUS2_REEXPECT=1a` (or `1a,1b`).

## Harness additions (each with a regression test in `verify/v1/harness.test.ts`, 18 tests)

- `prepare()`: every new carried state (Stockpile written directly, stall counter, recharge, Destiny Bond, Laser Focus, Glaive
  Rush, a charge from last turn aimed at the case's target and locked, Taunt/Encore/Disable/Heal Block/Embargo/Telekinesis
  turns, Lock-On/Octolock/Attract sources, types and added type, last item, not its first turn, a used Protean, once-a-battle
  flags, a pending copy, a locked Berry), the field and sides from earlier turns, field turns left, the bench, `entryOrder`
  (ability states re-made in rank order), Struggle (0 PP) and No move at Splash's real index.
- A move used last turn is both `lastMove` and `lastMoveUsed` (useMoveInner sets both; Conversion 2 reads `lastMoveUsed`:
  F2-C22 was a false "fails" before).
- E2's `transform`: Showdown has no volatile (`pokemon.transformed`); the oracle now records it (CR-03, SAT-TRF re-run).
- CHANCE_EFFECTS gains `focusband`, `stall`, `harvest`, `attract`.
- `compare.ts`: E2 stages both ways with accuracy and evasion; `compareOutcomeState2` (ability, species, types, Stockpile,
  stored stats, last item where reported, turns left, pending copy, Berserk lock, the status2 volatiles) for results this
  harness writes; the protecting fact only without a carried stall counter; a copy fact (`Opportunist: X copies +1 …`)
  counts for its copier by name and side, not for the user (G4-OPP-11: two Espathra).
- `gen-tests.ts`: the new inputs; E2's status2 state per row (`s2`, the same rules as compare.ts, `checkState2` in the test);
  a stage in a list matches `[.,]`; `--compare=`, `--keep=` (rows never leave the file), `--out=`; the table in parts of 400
  (one 1,400-row literal is TS2590 for tsc).
- `v1/run.ts`: `--store-dir=`, `--compare-out=` (a new app-results set and a compare report without touching
  `app-results/` or `results/compare.json`).

## changed-cases.ts (status2/build)

`list [--wave=] [--c19]`, `diff <base app-results> <new app-results> [--wave=]`, `oracle-ids [--wave=]`. A stored case is
listed for (1) a removed reason, (2) a crash move into a blocker, (3) the new chance events, (4) C19 (flags the case gives as
`earlierThisTurn` excluded: CQ-ETT-01/02), (5) the app's new output: the Minimize and charge assumption facts, E2's
sides.clock / fieldSet / lastItem / turnsLeft, accuracy and evasion stages and status2 volatiles, Protean's type change in the
world, Syrup Bomb's residual. Now: 1328 stored, 298 listed (312 rows for 1a, 17 for 1b), C19 readers 0, 65 oracle re-runs
(done). `diff app-results v1/app-now3`: 229 stored cases changed, every one listed and agreeing with the oracle; the 132
gate failures are wave-1a cases still waiting for their track.

## Where it stands (`v1/reports/all-3.json`, live tree; `all-wired-2.json`, the integrator wiring below on a copy)

Live: 472/604 wave-1a cases agree, 1319/1328 stored. With the outcomeOf wiring applied to a copy of `app/lib/battle`
(`v1/wired/`, `v1/wire-patch.py`): 537/604 and 1321/1328 (FE-FX09, VE-ST-3 then agree), the diff gate still clean.
To repeat it: `cp -r app/lib/battle v1/wired/battle`, `python v1/wire-patch.py v1/wired/battle/doubles-turn.ts`, then
`run.ts` with `TSX_TSCONFIG_PATH=scripts/.cache/calc-audit/2v2/verify/v1/wired/tsconfig.json` (the copy was removed after).
The generated test has 1457 rows (956 before, none dropped), all passing; tsc clean.

Left after the wiring (owner: ids):
- integrator (outcomeOf, model.ts, kernel): IN-PRT-01/01b (sv, champions), F2-PR2-champions; IN-CHG-02-sv, IN-CHG-03-champions;
  IN-NBL-01 (sv, champions); VG39 (GAS_CHANGING_MOVES).
- N: IN-DBD-02-sv, IN-ENT-02c-sv.
- H: CQ-SKD-01/02-usum.
- S: T2M-FA-10/11 (sv, champions), T2M-FS-01/02 (sv, usum), T2M-SB-03-usum; stored S48-Disguise-selfhit, E40-MindBlown-usum.
- W: T2M-FB-03 (sv, swsh), T2M-BE-01/02/03, T2M-AR-01 (sv, champions), T2M-GW-02-usum; stored VE-H5-6, VE-F1-10, VE-F1-13.
- E1: CR-01a/b, CR-02a/b, G4-PKP-01-sv, G4-PKP-05-champions, G4-WHR-01 (sv, swsh).
- A1: SAT-NRT-2 (sv, swsh).
- A2: F2-ID1/2-usum.
- A3: FS04a-swsh.
- D: G4-OPP-07, CR-08a/b/c, G4-FLG-09, G4-OHK-01/03/05/06/07/08/09, G4-BZK-01/02/04/05/07, G4-STF-02, G4-LMV-01/02,
  G4-ENC-01, SAT-IMP-1 (sv, swsh); stored RE01b.

## Deviations

- CQ-STK-01 (Contrary Stockpile): no Contrary Stockpile/Swallow user exists in any catalog; built with Simple Numel (sv, usum).
- SAT-ACU-4b (Acupressure at a fainted ally) not built: the app input cannot aim at an empty slot (doubles-targets.ts).
- SAT-SBM-1/1b-champions expect A1's `Simple Beam giving Simple is not modelled in 2v2.` (no Simple in Champions data).
- FS14c gives Bronzong `lastItem: null` (no item on an earlier turn), else Recycle rightly needs it.
- Game and species substitutions where a learnset or catalog lacks one (Champions: no Tackle, Lapras, Chansey, Audino…; SV:
  no Shuckle, Drampa, Shedinja, Zigzagoon…), Download leads carry `boosts` with `appBoosts: {}`, Transform targets carry an
  extra move slot (the deserializer), F2-DS uses Stomping Tantrum (a spread Earthquake ran out of memory).

## Tools (verify/v1)

`run.ts` (oracle and app sides, owner, report), `app1.ts`, `show-case.ts`, `counts.ts`, `ids-with.ts`, `factdiff.mjs`,
`pathdiff.mjs`, `unclassified.ts`, `rerun.ts`, `pick.mjs` (learners), `who.mjs`, the `fix-*.py` edit scripts, logs and
`reports/`. Re-run everything: `STATUS2_REEXPECT=1a npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v1/run.ts
--quiet --report=all --store-dir=… --compare-out=…`, then `changed-cases.ts diff`, then `gen-tests.ts --compare=… --keep=…`.
