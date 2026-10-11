# Wave 1b, Track V2: the oracle cases of wave 1b (ADDENDUM2 §7)

Branch `calc-2v2-status-2` (checked before and after the work). Files changed: everything under `scripts/.cache/calc-audit/2v2/verify/`
named below, `status2/build/changed-cases.ts`, this file, and the generated `tests/unit/doubles-turn-showdown.test.ts` (§5).
No app file, no frozen file, nothing of another track was edited.

## 1. For the engine tracks: your cases and how to run them

The oracle side of **every wave 1b case is stored** (pinned Showdown c23d2e94, `verify/results/<id>.json`; 0 missing:
`v2/missing.ts`). From the repo root:

```
npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v2/run.ts <id or prefix>...      # the app vs the stored oracle
npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v2/run.ts --wave1b T2P-CMD         # only wave 1b cases, by prefix
npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/show.ts <id>                       # a case's oracle, readable (V1's)
STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v2/run.ts R09 # a stored case with its 1b reason dropped
```

`v2/run.ts` writes nothing under `app-results/` (unless `--store`); `--store-dir=<dir>` and `--report=<name>` (into
`v2/reports/`) keep a run; `--shard=i/n` splits it. The owner is `cases-wave1b.ts OWNER_1B` (`v2/count.ts` prints the counts).

| Owner | Prefixes | Cases |
|---|---|---|
| K | T2M-VS-05, FX-CE-01, T2M-SE, -SCK, -UN, -UNR, -CD, -FV, -BB, -AF, -IO, -RC, IN-BBD-02 | 49 |
| M | T2M-GM, T2M-PS, IN-STL-04 | 12 |
| CL | T2M-ST, -UP, -HH, T2E-UP-01, T2P-NAT, -CPY, -MIR, -MEF, -INS, IN-CPY | 36 |
| PR | T2P-CMD, -PUP, -DAN, -SPL, -RND, -BKB, -STP, -BTU, -FUS, -CTR, -FLB, -PLG, -ROW, CQ-BID, -PUR, -CMD, -ECV, IN-RTL, IN-ECV | 105 |
| ST | T2P-TRC, -TWO, -DWN, -CUS | 16 |
| FC | T2P-FLD, T2P-ACT | 19 |
| E2 | T2E-FS, -CC, -MO, -GX, -FC, IN-FLD, IN-TNT, IN-CUD, IN-FSL, IN-TLK, IN-HBK | 103 |
| integrator (owners frozen) | T2M-Q (A2 / calculate.ts, Q13: 22), T2P-RDT and IN-STL-05 (N: 9), T2P-SKD (H: 2), IN-SFG-02 (W: 2) | 35 |

**375 cases** (379 written; 4 dropped as unbuildable, §6). The last ones added cross families: T2P-DAN-11, T2P-INS-07 (Instruct
on an encored ally), T2M-ST-03 / -04 (Sleep Talk with Uproar), T2E-CC12, T2P-TWO-01b. Plus the stored and wave 1a cases that
1b changes (§4).

## 2. Where it stands (latest run: `v2/reports/all-2-*`, 11:42, the live tree mid-wave, `STATUS2_REEXPECT=1a,1b`)

**2220 of 2314 cases agree: 294 of the 375 wave 1b cases, 1926 of the 1939 before wave 1b** (the 13 that do not are 1b work
below). The disagreements, by owner (each is the app's side; the oracle is pinned Showdown):

### K (4)
- T2M-UN-01-sv/-champions, T2M-UN-02-sv/-usum: `Unnerve is not modelled in 2v2.` (T2M §3.6). Stored F30d (`As One (Spectrier)`)
  likewise.

### M (8, plus stored S48)
- IN-STL-04-swsh, T2M-GM-09-swsh: `Max Guard is not modelled.` (T2M §3.19).
- T2M-GM-04-swsh: E2 volatile `gmaxchistrike` missing on Machamp and its ally (Showdown: the side volatile, layers 1).
- T2M-GM-06-swsh (Befuddle), T2M-GM-07-swsh (Stun Shock): the statuses are not given (the end of turn's poison and the
  9 / 4 status worlds missing: 36 mismatches each; e.g. GM-06 opponent-left end-of-turn average 225.33 expected, 235 got).
- T2M-GM-08-swsh: `G-Max Replenish is not modelled in 2v2.` (the oracle enumerates its 1/2 per Pokémon.)
- T2M-PS-01-swsh, T2M-PS-02-swsh, stored S48-PainSplit-dynamax-swsh: `Pain Split with a Dynamaxed Pokémon is not modelled in 2v2.`

### CL (25, plus stored R10, S47c)
- Copycat (T2P-CPY-01, -02, -03, -04, -05, IN-CPY-01-sv/-usum, -01b, stored R10): `Copycat with No move is not modelled in 2v2.`
  fires even where every No move comes after Copycat (T2P-CPY-01-sv: Garchomp 154, Clefable 80, the No-move Snorlax 51 and 52).
  In the oracle a No move is Splash (SPEC C13), so a No move before Copycat makes Copycat call Splash; after it, it changes
  nothing. T2P-CPY-02b-sv expects `Copycat needs the last move used before this turn.` (Copycat first, `battleLastMove` absent).
- Instruct (T2P-INS-01, -02, -04, -05, -06, -07, T2M-HH-01-sv/-champions): `Instruct is not modelled in 2v2.`; T2P-INS-06-sv
  expects `Instruct needs the target of Garchomp's last move.`. For the order: the oracle gives an instructed move no position
  (it is the target's copied record); the target's own action keeps its place among the slots with a move (T2P-INS-02).
  T2P-INS-07: Encore limits the choice only; the instructed move is the last move (Dragon Claw again).
- Uproar (T2M-UP-01-sv/-swsh, T2E-UP-01-sv/-champions, T2M-ST-04-sv, stored S47c): `Uproar is not modelled in 2v2.`
  (T2M-ST-04: a faster foe's Uproar wakes the Sleep Talk user, whose Sleep Talk then fails.)
- T2M-ST-01-sv/-champions: `Protect is not modelled in 2v2.`: Sleep Talk may call Protect (1/3), which Showdown runs (it is
  callable: no nosleeptalk flag).
- T2P-MIR-01-usum: `Mirror Move is not modelled in 2v2.` (MIR-02 agrees).

### PR (33)
- Commander: T2P-CMD-03, -04, -04b, -05, -05b, -07 (all sv): E2 volatiles `commanding` (Tatsugiri) and `commanded` (Dondozo)
  missing. (The turns agree.)
- T2P-PUP-01, -02, -03, -05: the confusion Poison Puppeteer gives has no fact on the hit (the E2 confusion is there): the
  oracle's `start:confusion` is compared with the hit's facts (START_FACTS /confus/).
- T2P-DAN-04-sv: two dances copied by one Dancer (its ally's Fiery Dance at foe A, then the foe's at the Dancer's ally) are
  two copies in Showdown (and in ADDENDUM2 §2.3's "each copy is its own step"); the app gives one copied step with both hits
  (`Dancer:own-left:fierydance:opponent-left` missing).
- T2P-FUS-02-sv: a Pokémon's No move (Splash in the oracle, SPEC C13) between Fusion Flare and Fusion Bolt is a successful
  move: `lastSuccessfulMoveThisTurn` becomes splash and Bolt is not boosted. The app keeps the boost (opponent-right koChance
  1 expected 0, low 46 expected, got 0: 15 mismatches).
- T2P-SPL-01, -02, -02b, -03 (usum): `Spotlight is not modelled in 2v2.`
- T2P-CTR-01…12 (no -13, §6): `Counter / Mirror Coat / Metal Burst / Comeuppance is not modelled in 2v2.`
- CQ-BID-01…04 (usum): `Needs the damage stored over earlier turns.`: the release from `carried.bide` (C41).
- T2P-BKB-02-champions: the end of turn gives `Toucannon switches out: the replacement is not known.` for a Dragon Tail into
  a Pokémon whose side has no bench (`canSwitch.own: false`): Showdown does not drag it (no Pokémon to switch in). This is the
  switch-out guard, not Beak Blast: integrator (doubles-switch / kernel).

### ST (1, plus wave 1a CR-08a, G4-OPP-07)
- T2P-TRC-03-sv: `Trace copies a random foe's ability.`: the candidates are Incineroar (Intimidate) and Kingambit (Defiant);
  T2P §4.1 keeps that text only for a candidate whose Start changes the field or HP. Wave 1a CR-08a-sv and G4-OPP-07-sv (start
  copies) still disagree: E2 own-left stage `atk:1` expected 1, got 0 (CR-08b/c, SAT-IMP-1, G4-STF-02 now agree).

### FC (8, plus stored M24i, M24j, wave 1a FS08e)
- T2P-ACT-02, -03, -04, -05: the Wind Rider rise, and Room Service's −1 Speed, have no fact (the oracle's boost lines are
  compared with step facts that name the Pokémon: `{Effect}: {Name} ±n {Stat}.`).
- T2P-FLD-04-sv: the Grassy Seeds' +1 Def have no fact (as above; on own-right and opponent-right).
- T2P-FLD-02b, -02c (Quark Drive), -10 (Flower Gift): `A weather or terrain change this turn would change …`. Stored M24i
  (Mimicry), M24j (Electric Seed) and wave 1a FS08e-sv (Quark Drive) likewise. (FLD-03 / -03b agree now.)

### E2 (2, plus wave 1a G4-LMV-01/02, G4-ENC-01)
- T2E-FS14-sv/-champions: the end of turn's `Future Sight landing is not modelled in 2v2.` for an active Shell Bell source: T2E
  §4.1.1 (FS07b): only Life Orb's AfterMoveSecondarySelf runs for a landing; Shell Bell heals nothing.
- Wave 1a G4-LMV-01-champions, G4-LMV-02-sv, G4-ENC-01-sv: E2 `turnsLeft.encore` 2 expected 1, got 0 (still open).

### Integrator
- G4-FLG-09-sv: `Symbiosis is not modelled in 2v2.` (owner frozen).
- T2P-BKB-02-champions's switch-out with no bench (above).

## 3. Harness changes (V2's files; each has a test in `verify/v2/harness.test.ts`, 26 tests, all pass)

Run: `npx vitest run --config scripts/.cache/calc-audit/2v2/verify/v2/vitest.v2.config.mts` (30 s).

- `case-types.ts`: `CaseCarried.uproar`, `furyCutter`, `rollout`, `defenseCurl`, `ppLeft`, `bide`; `futureMove` widened
  (`{ move, source }`, `{ move, bench, benchSide, fainted?, terastallized? }`); `cudChew: true | string`; `CaseMon.lastMoveTarget`,
  `exactMoves`; `Case.battleLastMove`, `faintedLastTurn`, `echoedVoice`, `startRandom`, `keepStartBoosts`;
  `CaseSide.gmaxResidual`; `SlotResult.charging`, `cudChew`, `onceUsed`, `chiStrike`; `WalkResult.copies`.
- `sim-dfs.ts`:
  - `prepare()`: the new carried state as an earlier turn leaves it (the uproar, furycutter, rollout / iceball, defensecurl,
    bide volatiles with their durations; a slot's PP; Cud Chew's `abilityState.berry` and counter 1; `lastMoveTargetLoc`); the
    landings (`futuremove` slot condition, probes-1's `land()`; a bench user on its side's bench before the Snorlax, fainted at 0
    HP with `pokemonLeft` adjusted, Terastallized); `battle.lastMove`, `side.faintedLastTurn`, the `echoedvoice` pseudo-weather
    (multiplier, 1 turn left), G-Max side conditions (3 turns left).
  - `startRandom`: the battle's start (Trace's sample, a Speed tie's shuffle) runs under a chooser and every start path is a
    weighted sub-case, as the hidden counters are (`prepareAll`). `keepStartBoosts` keeps Showdown's start stages (the app gets
    `appBoosts`). `exactMoves`: no Splash slot (Sleep Talk's pool).
  - `choice()`: a commanding Tatsugiri passes (side.ts auto-pass); a locked move (Rollout, Uproar, Bide from `carried`) and a
    random-target move (`randomNormal`) take no target.
  - The walk: a Dancer's copy is its own record (`copies["Dancer:<slot>:<move>:<dance user>"]`; the dance's own record ends where
    the first copy starts); an instructed move is its target's copied record (Instruct's `prioritizeAction` tags it; no
    position); a commanding Tatsugiri has no action (the first move's HP and the positions skip it); Bide's release (no `|move|`
    line) counts as moved and its damage as reached. Magnitude's `random(100)` by its seven bands; `gmaxreplenish` joins
    CHANCE_EFFECTS (its 1/2 per Pokémon only: the roll is told apart from the crit roll); a damage callback's damage is
    floored as Showdown applies it (Metal Burst's 1.5×).
- `app-turn.ts`: the new carried fields (move names to ids; a bench landing user as its build with Tera as the mechanic),
  `lastMoveTarget`, `battleLastMove`, `faintedLastTurn`, `echoedVoice`, `gmaxResidual`; an `appBuild.configuration` now adds to
  the set's gender and Tera type instead of replacing them (G-Max Cuddle's gender; no stored case had both).
- `compare.ts`: copied steps are compared with the oracle's copies (paired in turn order by the source's position: moves, the
  stopped share, hits); a calling move (Nature Power, Copycat, Me First, Mirror Move, Sleep Talk) compares as the moves it
  called (`usedmove:<called>:<caller>`); a step fact `{Effect}: {Name} ±n {Stat}.` counts for the Pokémon it names; E2:
  `charging`, `cudChew`, `onceUsed` (generation 9 only, C22), `chiStrike`, Uproar's turns left, the 1b volatiles (hidden move
  ids, `skydrop`, `uproar`, `gmaxchistrike`, `commanding`, `commanded`, `bide`, `disable`), `sides.pledge` and `sides.gmax`, each
  only for oracle results that record the 1b fields.
- `gen-tests.ts`: the same inputs; the copied steps apart from the slots' own (their count, by copies picked, and moves).
- `status2-removed.ts`: the field's end (`{Magic Room|Gravity|… Terrain} ending is not modelled in 2v2.`) is E2's in 1b;
  REEXPECT_TO: ER41d `Cud Chew needs Farigiraf's Berry from the last turn.`, ER41e `Future Sight landing needs its user.`, F14a and
  S47b `Sleep Talk needs Snorlax's moves.`, F14c `Sleep Talk needs Komala's moves.` (C33, the generalised needsMoves).
- `cases.ts`: under `STATUS2_REEXPECT` with 1b, a wave 1a case's 1b reason is dropped too (FS08e-sv, G4-WHR-01).
- `cases-se.ts`: appends `WAVE1B_CASES` (from `cases-wave1b.ts`, which gathers `cases-t2m-1b.ts`, `cases-t2p.ts`,
  `cases-t2e-1b.ts`, `cases-in-1b.ts`, `cases-cq-1b.ts`; kit in `case-kit2.ts`).
- Every stored oracle result is unchanged by these: re-running IN-STL-01-sv, T2M-SI-12b-sv and G4-OPP-07-sv gives byte-equal
  walks but for the four new empty SlotResult maps; no stored case uses Magnitude, G-Max Replenish, Dancer, Instruct, Commander,
  Bide or a damage callback (`v2/touched.ts`).

## 4. changed-cases.ts (wave 1b)

`--wave=1b` (or `1a,1b`): the cases before wave 1b are the stored set (1939, wave 1a's included). Rows: the 1b reasons (REMOVED,
REEXPECT_TO), the 11 cases integration 1a left open (with owners), the 1b random events, and `newOutput1b` (ADDENDUM2 §2.5's 1b
facts, E2's new fields, Moody's residual facts, the start variants and Download's lead order, Wind Rider / Wind Power, the field
ends, the landings, the Pledges, G-Max over time). `list --wave=1b`: 354 stored cases listed (344 rows for wave 1a, 71 for 1b).
`diff app-results v2/app-all-2 --wave=1a,1b`: 2314 cases, 1917 unchanged, **22 stored cases changed, every one listed (none NOT
LISTED)**, 84 failing the gate (the §2 work).

## 5. The generated test

`tests/unit/doubles-turn-showdown.test.ts` regenerated with `STATUS2_REEXPECT=1a,1b` from `--compare=v2/reports/compare-all-2.json`
and `--keep=v2/emitted-ids-before.txt` (the 1588 ids it had): **1884 cases, every earlier id kept** (0 dropped, 296 added: 290
wave 1b, and CR-08b/c, E40-FlameBurst-usum, G4-STF-02-usum, SAT-IMP-1-sv/-swsh that now agree). The ids are in
`v2/emitted-ids-v2.txt`; the previous file is `v2/tmp/doubles-turn-showdown.before-v2.test.ts`.
`npx vitest run --config vitest.unit.config.ts tests/unit/doubles-turn-showdown.test.ts`: 1884 passed. `tsc --noEmit`: no error in
it. At integration 1b, regenerate it the same way after the last compare run (cases that agree by then join it).

## 6. Deviations

- Not built (no legal set in the app's catalogs): T2P-CTR-13 (Mimikyu has no Counter), T2P-MEF-01c (Absol has no Dragon Claw
  in USUM), CQ-CMD-01b (Dondozo has no Helping Hand: the one Pokémon that could aim it at a commanding Tatsugiri), T2M-SE-05-usum
  (no contact spread move in USUM).
- Species and moves swapped where a catalog lacks one (each said in the case's checks): Milotic (Competitive) for Kingambit's
  Breaking Swipe; Annihilape / Farigiraf / Aggron for Wobbuffet and Bastiodon; Espeon for Alakazam (SV); Garbodor, Drifblim for
  Drifblim, Electrode; Annihilape for Exploud (SV, Champions); Cetitan for Baxcalibur's Ice Spinner; Espathra and Audino for
  Indeedee's and Clefable's Ally Switch; Jigglypuff, Skeledirge, Azelf for Snorlax's Round (SV); Braviary for Garchomp's Dual
  Wingbeat (SV); Florges for Comfey (Champions); Thievul and Toxapex in SwSh's Beat Up; Arcanine (Justified) for Herdier;
  Blissey for Snorlax's Echoed Voice; Clefable for Liepard; Absol for Snorlax's Quick Attack; Blaziken for Garchomp's Detect;
  Clefable's Thunder Wave for Spore in Champions; Blastoise for Ludicolo; Curse for Snorlax's Swords Dance (SwSh); T2M-Q-09
  (Revelation Dance) USUM only; T2P-TWO-02 in USUM (no Castform in SwSh); T2M-ST-02 twice in USUM (Komala); Grimmsnarl for
  Bisharp (T2P-BTU-03: poison-immune); Porygon-Z for Zamazenta (T2P-DWN-03's Speed tie in SwSh).
- Runaway walks swapped: T2P-MEF-02 and T2E-GX03 use Rock Slide / Stone Edge, not Earthquake (the oracle walk did not end).
- T2E-FC02: Darmanitan-Zen starts in its Zen form as a set species (Showdown keeps it); T2E-FC03 / FC04 start Minior and
  Wishiwashi in the forms the lead gives them (`appSpecies`).
- T2P-DAN-10b and T2P-RDT-05 name the two Pokémon in slot order (own-left, own-right, opponent-left, opponent-right), as N's
  IN-ENT-02c does.

## 7. Tools (`verify/v2/`)

`run.ts` (v1/run.ts with `--wave1b`, `--shard=i/n`, the 1b owners), `summary.ts` (a report set by owner), `notw1b.ts` (the
failing cases before wave 1b), `preflight.ts` (the app's catalog check of the 1b cases: 0 issues), `count.ts`, `missing.ts`,
`reasons.ts` (every expected reason with its REMOVED entry), `shard.ts`, `touched.ts`, `audit.ts`, `brief.ts`, `harness.test.ts` +
`vitest.v2.config.mts`, `vitest.gen.config.mts` (a generated test written with `gen-tests.ts --out=v2/tmp/gen/…`), `tsc/`
(a type check of V2's files), logs, reports.
