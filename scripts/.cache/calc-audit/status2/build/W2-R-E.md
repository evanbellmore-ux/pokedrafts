# Wave 2, Track R-E: the switch-out engine (status2; SPEC2 §4.8, guards.md §5.4, ADDENDUM2 §8.7)

This is the finish of R-E in the cloud session of 2026-10-11. The previous session's R-E agent left no notes; its engine was
read from the files (doubles-switch.ts and the R-E sites of doubles-turn.ts, doubles-world.ts, doubles-eot.ts,
doubles-calling.ts, doubles-presence.ts) and its probe folder `build/w2-re/`.

- **Branch:** `calc-2v2-status-2`, checked before the work and before this report. Nothing was committed, pushed, switched
  or merged. No `.claude/`, `node_modules`, CastMirror or RaidCard file, no frozen app file and no other track's file was
  edited (the Training files that show in `git status` are R-T's). No `next build`, nothing against live Supabase.
- **Line endings:** every file I edited is LF in this checkout (the CR count of each is 0 before and after).
- **Record:** `w2-re/finish.diff` (this finish's change to my files; the orchestrator's WIP checkpoint 20b40b6 holds them), `w2-re/probes4.ts` + `run-probes4.ts` (R-E's quick
  oracle, the previous agent's `oracle.ts`, with this finish's probes), `w2-re/cases-re.ts` + `run-cases.ts` (extra cases on
  the verify harness: `sim-dfs.ts oracle()` and `compare.ts compareCase`, nothing stored), `w2-re/show-cases.ts` (the app
  result of any case, the numbers the unit tests pin), `w2-re/faces-ask.diff` (the integrator's lines, below).

## 1. State at the start (measured)

- `v3/run.ts --wave2 --quiet`: `85/87 cases match.`; only T2P-AST-01-usum and T2P-AST-02-usum failed (`Assist needs the
  moves of Liepard's party.`).
- The previous agent's probes (`w2-re/run-probes.ts`, 52 specs): 46 pass; R-GAS-NEWCOMER, R-IMPOSTER, R-CHILLY and
  R-SYRUP-PACK stop at the quick oracle's 40 000-run cap (each is a stored case that agrees: G4-SWX-14, -16, -07, -13);
  R-WISH fails on the quick oracle's own setup (its Wish is added with duration 2, so it does not land this turn; the stored
  T2E-BL-02 lands it and agrees).
- Unit: only `status2-r-contract.test.ts` "keeps today's switch-out until R-E models the replacement" failed (Step 2's stub).
- `npx eslint` on my files: 6 errors (`react-hooks/rules-of-hooks` on a function named `useItem` in doubles-switch.ts) and 1
  warning (doubles-turn.ts `outcomeOf`'s unused `gas`).

## 2. What this finish changed

| Change | File | Pinned source | Proof |
|---|---|---|---|
| Pursuit at a switching target: base power 80 (MoveContext.basePower) instead of a 2× modifier, so Technician (60 or less) does not boost it; the Technician guard is gone | doubles-presence.ts `context` | moves.ts pursuit basePowerCallback; abilities.ts technician | RE-PUR-TECH-usum, R4-PURSUIT-TECH, CQ-PUR-R-01/02 |
| The leaver's Destiny Bond ends at its BeforeSwitchOut, before the Pursuit runs | doubles-switch.ts `beforeSwitchOut` | moves.ts pursuit condition: `pokemon.removeVolatile('destinybond')` | RE-PUR-DB-usum, R4-PURSUIT-DESTINYBOND |
| A Sheer Force move with secondaries sets off no Eject Button and no Red Card (single and spread hits) | doubles-turn.ts `applyStep` → `hitReactions(…, sheerForce)` | battle-actions.ts afterMoveSecondaryEvent | RE-SF-RC, RE-SF-EB (sv, champions), R4-SF-SPREAD-EB |
| Red Card against an attacker with a working Life Orb (no Magic Guard) or Shell Bell: not estimated, `Red Card with Life Orb is not modelled in 2v2.` (REASONS.combo). Showdown sets forceSwitchFlag in AfterMoveSecondary and Life Orb / Shell Bell (AfterMoveSecondarySelf) then do nothing, while the step took the Life Orb loss with its hit. With a bench at the action's end (`resolve`, a non-inert drag); without one where the attacker leaves after the turn (`redCardDrags`: canSwitch, DragOut, the holder not dragged by the hit's own Dragon Tail); in `hitReactions` for an attacker the step's Life Orb knocked out (Showdown's card read its HP before) | doubles-switch.ts `switchOut`, `resolve`, `redCardDrags`, `selfItemsAfterRedCard`; doubles-turn.ts `hitReactions` | items.ts redcard, lifeorb, shellbell | RE-RC-LO, RE-RC-LO-KO, RE-RC-LO-NB (reason), RE-RC-LO-NB2 (today's switchesOut), RE-RC-DT (ready: the holder is dragged first, the Life Orb loss stands) |
| A landing (Future Sight) on a Red Card holder with the user's side's bench: its user dragged after the turn takes no Life Orb loss (the drag is a pending switch, not `leaving`) | doubles-eot.ts `landingHandler` (`switchHooks.dragSet`), doubles-switch.ts `dragSet` | conditions.ts futuremove onEnd → lifeorb (!forceSwitchFlag) | RE-FS-RC-LO-sv |
| Assist with a bench: the turn fact `Assumes no Pokémon of {Name}'s party fainted before this turn.` (pinned assist reads side.pokemon, fainted members too; the bench lists the living) | doubles-calling.ts `callingGuard` | moves.ts assist onHit | unit test |
| Lint: `useItem` → `consumeItem` (doubles-switch.ts); `outcomeOf`'s unused `gas` parameter removed (ctx.gas is the same object, the occupants' view) | doubles-switch.ts, doubles-turn.ts | — | eslint, compare |
| Docstrings: requestRound and beforeSwitchOut (Pursuit is followed) | doubles-switch.ts | — | — |
| `tests/unit/doubles-switch.test.ts` (new, 48 tests), `status2-r-contract.test.ts` (the switch modelled, hazardFails with pre-turn hazards), `tests/source/status2-hooks.test.ts` (4 MOVED rows: exitWorlds, afterTurn, flagStanding, dragSet; CALLS rows for resolve and requestRound; `redCardDrags(` in switchOut's row) | tests | — | §5 |

## 3. Checklist (each R-E item: code, test, case)

Cases: `cases-r.ts` ids (stored, agree on `v3/run.ts --wave2`), `RE-` = `w2-re/cases-re.ts` (agree on `run-cases.ts`),
`R4-`/`R-` = quick probes. Tests: `tests/unit/doubles-switch.test.ts` (DS) and `status2-r-contract.test.ts` (RC).

| Item | Code | Test | Case |
|---|---|---|---|
| replaceSlot (the flag set in the action, the items' rules) | switch.ts `replaceSlot` | DS (every switch) | G4-SWX-01…30 |
| the switch as the action ends (drags, then requests round by round, Speed order) | `betweenActions`, `resolve`, `tail`, `dragIn`, `requestRound`, `switchRound`, `swapIn` | DS | G4-SWX-05, -18, -30 |
| default replacement + `Assumes {Newcomer} comes in for {Name}.`; chosen = no fact | `switchRound` | DS "U-turn…", "a chosen replacement" | G4-SWX-01, -02, IN-BNC-01/02 |
| random drags, one branch per living bench Pokémon (Roar, Whirlwind, Dragon Tail, Circle Throw, Red Card) | `dragIn` | DS Roar, Red Card, Volt Switch/Dragon Tail | G4-SWX-04, -11, -22 |
| hazards: Stealth Rock, Spikes, Toxic Spikes (absorb), Sticky Web, G-Max Steelsurge, Heavy-Duty Boots, Magic Guard, grounding | `hazards`, `toxicSpikes`, `hazardsOn` | DS entry pipeline | G4-SWX-03, -12, IN-HZD-01…05; R-HZD-*, R-BALLOON |
| hazardFails with the pre-turn hazards | `hazardFails` | RC | S1-RSP (stored) |
| entry abilities in Speed order (abilityStart "entered"), Intimidate, weather/terrain setters, re-sort | `entry`, `entrantHandlers`, `abilityEntry` | DS Intimidate, Drought, Drizzle | G4-SWX-01, -06, -17, -30 |
| entry items (Seeds, Room Service, Booster Energy; Orbs kept) | `itemEntry` | — | R-SEED, R-BOOSTER |
| Neutralizing Gas newcomer: `entersWithGas` (kept) | `abilityEntry` | DS reasons | G4-SWX-15 |
| a newcomer under a foe's gas: the stand-in | `underGas`, doubles-turn.ts `gasView` | DS gas | G4-SWX-14 |
| Imposter | `imposter` | DS Imposter | G4-SWX-16 |
| Commander keeps `notIn2v2("Commander")` | `abilityEntry` | DS reasons | G4-SWX-20 |
| foes' pending copies at SwitchIn (−3) | `entry` (guardHooks.afterMoveCopies) | — | R4-WEB-MIRRORHERB |
| a second Eject Pack at SwitchIn (−4, B1) | `ejectAtSwitchIn`, `tryEjectPack` | DS Eject Packs, Intimidate → Eject Pack | G4-SWX-05, -30, R-INTIM-PACK, R-WEB-PACK |
| the leaver's gas end (kept `gasEnds`) and Unnerve end (B13) | `swapIn` (kernel.gasEnds, unnerveEnds) | DS reasons | G4-SWX-25, R-UNNERVE |
| switch-out effects: Regenerator, Natural Cure, Zero to Hero | `switchOutEffects` | DS Regenerator, both U-turn | G4-SWX-07, -18, -19, R-HERO |
| Baton Pass and Shed Tail copies | `copiedState` | DS Baton Pass, Shed Tail | G4-SWX-09, -19, R-BPASS-VOL |
| identity: MonState.id, names/HP/input view follow the occupant, later moves hit the newcomer | `swapIn`, turn.ts `syncOccupants`, `occupantView`, `gasView` | DS (hit ids) | every SWX |
| Leech Seed / Wish / Future Sight positions | `forget`, `swapIn` (slot conditions stay) | DS landings | T2E-BL-01/02, R4-SEED-SEEDER-LEAVES, R4-SEED-SEEDED-LEAVES |
| benched landing source | eot.ts `standsAt`, `landingUser` | DS T2E-BL-03 | T2E-BL-03, IN-FSL-02 |
| player-picked triggers: U-turn, Volt Switch, Flip Turn, Parting Shot, Teleport, Baton Pass, Shed Tail, Chilly Reception, Eject Button, Eject Pack, Emergency Exit, Wimp Out | turn.ts afterHit / hitReactions / eventGuards, status.ts switchOut → `switchOut` | DS | G4-SWX-01, -02, -07, -08, -09, -10, -19, -21, -23, -24, -27, -28, -29 |
| Eject Button / Red Card behind a face | faces.ts afterMoveItems → `switchOut` | DS `it.fails` ×2 | RE-FACE-EB-UT, RE-FACE-EB, RE-FACE-RC: **need the integrator's lines** (§7) |
| Emergency Exit / Wimp Out after the residual | eot.ts (switchOut "exit"), `afterTurn` | DS G4-SWX-12 | G4-SWX-12, R-EE-RES |
| Emergency Exit after a crash | hidden.ts crash → afterLoss → eventGuards | — | no Emergency Exit or Wimp Out holder learns a crash move in the four games: not reachable |
| the U-turn family into a face | turn.ts afterHit (a face hit counts) | — | R4-FACE-UTURN |
| the end of turn with the newcomer (residuals by id) | eot.ts `occupantIds`, Recorder ids | DS Roar, Teleport, Toxic Spikes | G4-SWX-04, -21, IN-HZD-02 |
| E2 with benched Pokémon (`DoublesOutcome.benched`, `mons[slot].id`) | turn.ts `outcomeOf`, switch.ts `benchedOutcome` | DS U-turn, Roar, Baton Pass, EE after residual | every case with `outcomes: true` |
| Assist from the bench's moves (noassist left out; USUM) | calling.ts `assist`, `NO_ASSIST` (= pinned gen 7 list, `w2-re/noassist.ts`) | DS Assist ×3 | T2P-AST-01/02 (with the ally's moves: §7) |
| Beat Up over the bench | presence.ts `beatUpContext`, `benchParty` | DS Beat Up | T2P-BTR-01 (sv, champions, swsh) |
| Pursuit at a switching target (80, BeforeSwitchOut, USUM) | switch.ts `beforeSwitchOut`, presence.ts `context` | DS Pursuit ×3 | CQ-PUR-R-01/02, RE-PUR-TECH, RE-PUR-DB |
| Red Card and Life Orb / Shell Bell; Sheer Force and the after-move items | §2 | DS after-move items | RE-RC-*, RE-SF-* |

## 4. The kept reasons (step 3)

- `REASONS.switchesOut` (`{Name} switches out: the replacement is not known.`):
  - doubles-switch.ts `switchOut`: only where the leaver's side has **no bench** in the input (`input.bench[side]` absent:
    a caller that gives none, the stored cases); with a bench, `replaceSlot` models it, and an empty bench is no Pokémon
    left (no switch at all: sideCanSwitch false).
  - doubles-eot.ts `worldGuard` (`w.leaving`): `leaving` is set only by `switchOut`'s no-bench branch (the switch after the
    turn of a side without a bench).
- `REASONS.needsParty` (`Assist needs the moves of {Name}'s party.`), doubles-calling.ts: `callingGuard` where the user's
  side has no bench; `assist` where a party member's moves are not in the input: an empty partner slot (a Pokémon that fainted
  on an earlier turn), a partner or bench Pokémon without `moves`.
- Beat Up: no reason of R-E's; without a bench and without `contexts.beatup.party` the calculation's row reason stays
  (`Beat Up: party needed.`, count-moves.ts).
- Pursuit: the Technician combo is gone; `REASONS.combo("Pursuit", "a switch it sets off")` stays (a Pursuit knock-out that
  sets off another switch inside BeforeSwitchOut), and PR's `Pursuit with a Pokémon that switched in this turn` (C30) is
  not R's.
- R-E's other narrow reasons (each a fact): switching out while Dynamaxed; two Emergency Exits in one move; an Eject Pack
  still waiting for a later move; a Mold Breaker drag move with hazards or a breakable Start; Baton Pass with Gastro Acid,
  Power Trick or Power Shift; a Neutralizing Gas newcomer; Tera Shift's Start; Commander's pair; Primal Reversion's Orbs;
  Zero to Hero without its form in the runtime; Red Card with Life Orb or Shell Bell (new).

## 5. Gates (final code)

Run in this order on the final tree (`git branch --show-current`: `calc-2v2-status-2`, before and after); logs in the
session scratchpad (`r-e/gates/`), the lines below copied exactly.

1. `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v3/run.ts --wave2 --quiet`: `85/87 cases match.` The two
   exceptions are T2P-AST-01-usum and T2P-AST-02-usum: `not-estimated (Assist needs the moves of Liepard's party.)`. That
   reason is a fact for the input the harness builds (the ally's move slots are not passed: need 2), and both cases agree
   with the oracle once the ally's moves are given (`0 mismatches` each, `w2-re/show-cases.ts --ally-moves`; DS's Assist
   tests pin those numbers).
2. `npx tsc --noEmit`: no output (exit 0).
3. `npx eslint` on doubles-switch.ts, doubles-turn.ts, doubles-world.ts, doubles-eot.ts, doubles-calling.ts,
   doubles-presence.ts and the three test files: no output (exit 0).
4. `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal (8950 ms)`.
5. `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts --no-write` (`--no-write`
   writes neither app-results/ nor results/compare.json): `1853/1856 cases match.` 1856 is every case whose definition
   loads (the case folders the cloud session lacks are stubs, so their 544 stored ids are not run). The 1769 stored cases
   that load all match; the 3 that differ are wave 2 cases: T2P-AST-01/02-usum (need 2) and G4-SWX-20-sv (need 3:
   REEXPECT drops its kept `Commander is not modelled in 2v2.`, which `v3/run.ts` agrees with).
6. `npx vitest run --config vitest.battle-data.config.ts tests/source/status2-hooks.test.ts`: `Test Files  1 passed (1)` /
   `Tests  8 passed (8)`.
7. `npx vitest run --config vitest.unit.config.ts tests/unit/doubles-*.test.ts tests/unit/status2-*.test.ts` (this includes
   tests/unit/doubles-turn-showdown.test.ts, not regenerated: its 282 rows of stub cases are untouched): `Test Files  48
   passed (48)` / `Tests  3202 passed | 2 expected fail | 1 skipped (3205)`. The 2 expected fails are DS's face tests (need 1).
8. R-E's own cases (`w2-re/run-cases.ts`, pinned Showdown's exhaustive oracle, nothing stored): `13/16 cases match.`; the
   3 that differ are RE-FACE-EB-UT-sv, RE-FACE-EB-sv, RE-FACE-RC-sv (need 1), which match on a scratch copy of the tree with
   `w2-re/faces-ask.diff` applied (`3/3 cases match.`, and the two `it.fails` then fail as passing tests: `Expect test to fail`).
9. R-E's quick probes (`w2-re/run-probes4.ts`): every probe of probes4.ts passes (R4-PURSUIT-TECH, R4-PURSUIT-DESTINYBOND,
   R4-REDCARD-SHEERFORCE, R4-EJECTBUTTON-SHEERFORCE, R4-EJECTBUTTON-LIFEORB, R4-SEED-SEEDER-LEAVES, R4-SEED-SEEDED-LEAVES,
   R4-WEB-MIRRORHERB, R4-FACE-UTURN, R4-SF-SPREAD-EB) except R4-REDCARD-LIFEORB (now the kept reason, as RE-RC-LO),
   R4-FACE-EJECTBUTTON-UTURN (need 1) and R4-PURSUIT-TECH-STAY (the quick oracle's run cap; Pursuit at a target that stays
   is wave 1b's, unchanged).

## 6. Deviations

- **Red Card with Life Orb / Shell Bell is guarded, not modelled.** The step applies Life Orb inside its hit (with its loss
  fact); undoing it per world would leave the loss fact and cannot tell a Life Orb faint from a Rough Skin faint. The guard
  is conservative in two corners (a Shell Bell holder at full HP; an attacker that fainted to Rough Skin before the card).
- **Assist's new turn fact** (`Assumes no Pokémon of {Name}'s party fainted before this turn.`) is not in ADDENDUM2 §2.5: the
  input's bench lists the living Pokémon only, while pinned Assist reads fainted party members' moves too.
- **The faces' Eject Button and Red Card with a bench** are wrong on the live tree until the integrator's lines land (they
  take the item before `switchOut`, which then does nothing; and the face's Eject Button waits for a U-turn, which pinned
  Eject Button does not). Their tests are `it.fails`.
- **Emergency Exit after a crash** has no case: no Golisopod/Wimpod line learns a crash move in the four games.

## 7. Needs (one line each; a failing test or case for each)

1. **Integrator, doubles-faces.ts `afterMoveItems`** (`w2-re/faces-ask.diff`): drop `selfSwitch` (and the `SWITCH_MOVES`
   import), and with a bench on the leaver's side leave the item to R's switchOut (`takeItem` skips it) and pass Red Card's
   holder (`switchOut(kernel, w, attacker, "redcard", null, target)`). Failing: DS's two `it.fails` (flip to `it`),
   RE-FACE-EB-UT-sv, RE-FACE-EB-sv, RE-FACE-RC-sv (all three agree on a scratch copy of the tree with that diff applied, and the two `it.fails` then pass).
2. **R-V / integrator, verify/app-turn.ts `caseInput` (:164) and gen-tests.ts (:441):** a slot with `exactMoves` and no
   `moves` must pass `moves: [its action move]` (its Showdown move slots are exactly that): `...(m.moves || m.exactMoves ?
   { moves: [...new Set([...(moveId ? [moveId] : []), ...(m.moves ?? []).map(toID)])] } : {})`. Failing: T2P-AST-01-usum,
   T2P-AST-02-usum (`Assist needs the moves of Liepard's party.`); both agree with the ally's moves given
   (`w2-re/show-cases.ts --ally-moves`, and DS's Assist tests).
3. **R-V / integrator, verify/cases.ts STATUS2_REEXPECT block:** skip the wave 2 cases (`WAVE2_CASES`) as it skips wave 1a's,
   so a wave 2 case's kept reason that matches a 1b removal pattern stays expected. Failing: G4-SWX-20-sv under
   `STATUS2_REEXPECT=1a,1b compare.ts` (`expected "ready", got "not-estimated" (Commander is not modelled in 2v2.)`); it
   agrees on `v3/run.ts` (no REEXPECT).
4. **Integration 2:** changed-cases.ts lists none of the stored cases for this finish (all loaded stored cases match);
   regenerate doubles-turn-showdown.test.ts after 1–3 so the wave 2 cases join.
