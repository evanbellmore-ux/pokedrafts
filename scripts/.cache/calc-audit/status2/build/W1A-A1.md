# Wave 1a, Track A1: stats, abilities and Transform (SPEC2 §2.2 A1 rows, §4.2; ADDENDUM2 §4.2)

Branch `calc-2v2-status-2` (checked before and after the work). Files changed: `app/lib/battle/doubles-stages.ts`,
`app/lib/battle/doubles-abilities.ts`, `app/lib/battle/ability-table.ts` (generated, new), `app/lib/battle/status-table.ts`
(regenerated only, by `gen-status-table.ts` with the three fragments), `tests/unit/doubles-stats-abilities.test.ts` (new),
`tests/source/doubles-ability-table.test.ts` (new). Build folder (this one): `classify-a1.md`, `gen-ability-table.ts`, this
file, and the tools `a1-run.ts`, `a1-cases.ts` (A1's oracle set, ids `A1-…`; results in `a1-results/`), `a1-dbg.ts`,
`a1-dex-show.ts`, `a1-ability-dump.ts`, `a1-who.ts`, `a1-diff.mjs`. Nothing else was edited.

## What is modelled (pinned Showdown c23d2e94; sv, champions, swsh, usum)

- **The thirty status moves** (classify-a1.md: 22 M, 8 C): Acupressure, Psych Up, Power/Guard/Heart Swap, Speed Swap,
  Power/Guard Split, Power Trick, Power Shift, Topsy-Turvy, Stockpile, Swallow (snatched: the Snatch user's layers, C1),
  Tidy Up, No Retreat, Autotomize, Minimize, Geomancy (Power Herb; the charge as `charging`), Gear Up, Magnetic Flux,
  Flower Shield, Rototiller; Skill Swap, Role Play, Entrainment, Simple Beam, Worry Seed, Gastro Acid (the stand-in
  `runaway` plus `vol.gastroAcid`), Doodle, Transform (C2; an inert copy of a notransform or form ability). Spit Up's
  failure and its Stockpile End at AfterMove (`damagingTry`, `afterMove`).
- **Stages** (`doubles-stages.ts`): Intimidate's TryBoost chain (Guard Dog before Clear Amulet; Inner Focus, Oblivious and
  Own Tempo from generation 8, breakable; Scrappy not), Mirror Armor and Defiant recursion with `intimidate: false`, Rattled
  and Adrenaline Orb after an Intimidate drop, White Herb deferred to the move's end (`herb: false`), `writeStages` for the
  direct writes, `breakHolder` for a Mold Breaker read at the move's start.
- **Ability changes**: `setAbility` with End then Start (ABILITY_ENDS, ABILITY_STARTS: every Start and End of the table is
  classified, the source test checks it), `historyHooks.entryChanged` at every change, `fieldChangeHooks.changed` for a
  weather, effective weather or terrain change, Forecast / Flower Gift through FC, once-a-battle Starts of generation 9
  (`Assumes {Name} has not had {Ability} before in this battle.`), Trace gained mid-turn, Unnerve's End (the Update's
  Berries), the Update cures of a changed ability (`updateCures`), Ability Shield, Neutralizing Gas, Electromorphosis.
- **Since the last report**: the trapped volatile (`HANDLERS.trap` for Block, Mean Look, Spider Web; linked to its user, a
  faint ends it; Ghost types fail; No Retreat then adds no volatile: SAT-NRT-2) and `trapAfterHit` for Jaw Lock, Anchor Shot,
  Spirit Shackle and Thousand Waves (both need the integrator: I1, I6); an ability the game's data does not list is not
  estimated (`Simple Beam giving Simple is not modelled in 2v2.`: Champions has no Pokémon with Simple, so the engine has no
  entry for it; SAT-SBM-1-champions threw before).

## Gate (integration 1a)

With the integrator's I1–I3 simulated on a scratch copy of `app/lib/battle` (scratch `patch-status.mjs`, the generator
change below), V1's runner `v1/run.ts SAT- IN-STK- CQ-STK- IN-ACC-01 CR-04 CR-06 CR-08`: **137/150 match**. The 13 left:

| Cases | Why | Owner |
|---|---|---|
| SAT-TRF-1 (sv, champions), SAT-TRF-2 (sv, usum), SAT-TRF-3b (sv, swsh) | E2 volatile `transform`: the oracle has none (Showdown keeps `pokemon.transformed`, not a volatile); the app reports `transform` as SPEC2 §3.1 lists it | V1: compare maps `transformed` to `transform` |
| SAT-SBM-1, SAT-SBM-1b (champions) | now not estimated by design (above) | V1: mark them `notEstimated` with the reason |
| SAT-IMP-1 (sv, swsh) | `Imposter is not modelled in 2v2.`: Imposter at the start is D's (SPEC2 §4.2, `doubles-start.ts`) | D |
| CR-08a, CR-08b, CR-08c (sv) | `Opportunist copying a stat rise is not modelled in 2v2.` from `doubles-start.ts` (the start copy is D's, SPEC2 §4.2 "The start copy waits for the first action's end"); A1's part, Opportunist's End deleting the pending copy (C7), is in `endBefore` and unit-tested | D |

A1's own set (`a1-run.ts`, 130 cases, wired): 118 match; the 12 left are the same `transform` volatile (7 A1-TRF cases) and
V1's compare counting the stages of a Pokémon that fainted in some outcomes (A1-PSY-1, A1-GEO-1, A1-ENT-1 ×2, A1-SWP-3:
"expected 0.75, got 1" where it faints at 1/4; Showdown's faint clears the boosts). Every damage number, order, KO chance and
HP agrees.

The stored cases A1 changes: S48-SkillSwap-before, S48-SkillSwap-last, S48-Transform-before, S48-Transform-last are estimated
now and agree with V1's fresh oracle results (4/4, wired and unwired); every ready case where a minimize-flag move can reach a
Pokémon with no `carried.minimize` gains the turn fact `Assumes {Name} has not used Minimize.` (SPEC2's list; 203 of the 1705
app results, nothing else differs in them). Tests whose L Skill Swap is now exact were checked against the oracle with A1
cases: A1-SR44-sv (doubles-start-rows SR44) and A1-GRD-1-champions (doubles-turn-guards' first test; Flamethrower 26–31 at 0
SP) both match.

Golden 1v1 (`golden-1v1.ts --check`): 110 rows differ, every one Fling (`fling.ts` / `calculate.ts`, not A1's); no A1 module
is imported by the 1v1 path.

## Needs from the integrator (frozen files)

- **I1** `scripts/.cache/calc-audit/status2/build/gen-status-table.ts`, then regenerate `status-table.ts` (3 lines change):
  in HANDLERS after `doodle: "doodle",` add `block: "trap", meanlook: "trap", spiderweb: "trap",`; in `entryOf`'s caller
  change `(kind === "M" || kind === "C")` to `(kind === "M" || kind === "C" || kind === "N")` for `handler` only (no other N
  move has a HANDLERS key). doubles-status.ts line 936 already dispatches an N move with a handler.
- **I2** `doubles-turn.ts` outcomeOf: after `const a = statusHooks.outcomeMon(…), b = …, e = …;` add
  `const f = abilityHooks.outcomeMon(kernel, world, slot);`; add `...f.volatiles` to `volatiles`; after it
  `if (f.build) entry.build = f.build;`; and `Object.assign(entry, status2Mon(mon), f.fields);`.
- **I3** `doubles-status.ts` conditions: before `return out;` add `out.push(...abilityHooks.conditions(kernel, w, slot));`.
- **I4** `doubles-world.ts` MoveVolatiles: `transform?: { into?: DoublesSlotId; inert?: string }` and
  `trappers?: DoublesSlotId[]` (A1Vol extends it locally today).
- **I5** tests: `tests/source/doubles-status-moves.test.ts` KINDS (A1's 22 to M, 8 to C, with A2's and A3's; the merged
  counts M 183, X 39, C 21, S 7, N 20, P 1, L 0); `tests/unit/doubles-turn-showdown.test.ts` S48-SkillSwap-* and
  S48-Transform-* (exact now); `tests/unit/doubles-start-rows.test.ts` SR44 out of GUARDED (its start rows stay);
  `tests/unit/doubles-turn-guards.test.ts` "is not estimated when the move comes before another move…" (no L move is left:
  Skill Swap is ready in both turns).
- **I6** (optional) the hit pipeline: call `abilityHooks.trapAfterHit(kernel, w, action, user, target, moveId)` where a
  damaging move's onHit runs (Anchor Shot and Spirit Shackle only where their secondary applies), and the hit fact
  `Minimize: double damage.` where `takenMods.minimize` doubles a minimize-flag move (F1 §4.2; the ×2 itself is exact today).

`tests/unit/doubles-stats-abilities.test.ts` "status2 A1 after the integrator's changes" (I1–I3) fails until they land; with
them simulated (scratch config `a1-int.config.mts` aliasing `@/app/lib/battle/`) all 46 tests pass, and the doubles, status2
and Training suites show no new failure.

## Needs from other tracks

- **V1**: compare.ts: drop A1's moves from L_MOVES; map Showdown's `transformed` to the E2 volatile `transform`; skip the
  stages of an outcome Pokémon that fainted (or the integrator zeroes them in outcomeOf); mark SAT-SBM-1/1b-champions
  `notEstimated: "Simple Beam giving Simple is not modelled in 2v2."`; a fact for a Pokémon the use did not reach is a step
  fact naming it (`Snorlax (1): −1 Attack.`); case conventions: Download and Intrepid Sword at the lead are settled by the app
  (`boosts` with the rise, `appBoosts` without), an entry Intimidate uses an Adrenaline Orb, Supersweet Syrup's entry evasion
  stays; Transform cases need `walkReplay` (sim/state.ts cannot deserialize a transformed Pokémon mid-turn).
- **D**: the start copy (CR-08) and Imposter at the start (SAT-IMP-1).
- **A3**: Snatch passes `use.snatched`; A1's Swallow handler reads it. **FC**: `fieldChangeHooks.changed` and `settleHolder`
  are called from A1. **N**: `historyHooks.entryChanged` is called at every ability change.

## Deviations

- Illusion's End is "nothing" (the disguise is display-only in the turn); Transform with an Illusion holder is
  `Transform with Illusion is not modelled in 2v2.`.
- A Trace gained mid-turn that finds nothing to copy is guarded only when a later ability change could give it a target.
- Facts about a Pokémon the use did not reach are step facts naming it (doubles-use.ts `hitFact`).
- `Assumes {Name} has not used Minimize.` is said for a minimize-flag move's aimed Pokémon and a foe that is a centre of
  attention (every minimize-flag move has one target; a Lightning Rod redirection of Supercell Slam is absorbed).
- E2's `truant` is not emitted. The status table was regenerated with all three fragments (A2's and A3's rows included).
- Simple Beam in Champions is not estimated (above) until the Champions data lists Simple.
