# Wave 1b, track ST: the start of a doubles turn (ADDENDUM2 §4.3 ST, T2P §4, SPEC2 D's start items, Q8)

Branch `calc-2v2-status-2`, checked before the work and before this report. Nothing was committed, pushed or switched;
`.claude/`, `node_modules` and every other track's file are untouched; no `next build`; nothing against live Supabase.

## Files

| File | What |
|---|---|
| `app/lib/battle/doubles-start.ts` | the track's module (CRLF kept, as Step 0b left it) |
| `tests/unit/doubles-start.test.ts` | new: 34 tests (30 `it`, 4 `it.fails` that wait on the integrator lines below) |
| `status2/build/w1b-st/` | scratch: the probe cases (`cases-st.ts`) and their pinned-Showdown results (`oracle/`), `st-oracle.ts`, the A/B trees (`make-trees.sh`: `base` = wave 1b's start tree, `st` = base + this file, `int` = st + the integrator lines from `patch-int.cjs`), `run-app.ts`, `compare-all.ts`, `show-app.ts`, `settle-bench.ts`, `vitest-scratch.config.mts` |

## What the start models now

`settleDoublesStart` returns the start of the turn; when the start has random parts it also returns **start variants**
(`DoublesSettle.variants`: weighted settles the walk begins from, weights summing to 1) and **row variants**
(`rowVariants`: the same without a Starf Berry's random stat, which the 1v1 rows' Starf outcomes already cover). `settle.slots`
is the first row variant; each slot whose start differs between them carries the variant's label as a line, so the moves
pane (`calculateDoublesMoves`, which reads one start) says which start its rows are.

| Item | Model (pinned source) | Facts / labels | Reason left |
|---|---|---|---|
| Trace, unset, two foes with different copyable abilities | one start per foe, 1/2 each, settled with `SettleReads.traceSource` (`PS/data/abilities.ts:5118-5150`: `sample` over the adjacent foes at its Start) | turn fact `Assumes {Name}'s Trace copied as it came in: {A} from {Foe} or {B} from {Foe2}, 1/2 each.`; label `If {Name}'s Trace copied {Ability}.` | `Trace copies a random foe's ability.` for (a) a candidate whose Start changes the field, HP or stages as it enters (T2P §4.1's set: weather / terrain setters, Hospitality, Screen Cleaner, Curious Medicine, Costar, Supersweet Syrup), (b) a foe's own Trace that may copy first (not slower at the lead), (c) **new**: a candidate that changes what a foe's Intimidate does to its holder (Defiant, Competitive, Contrary, Simple, Guard Dog, Clear Body family, Hyper Cutter, Inner Focus / Own Tempo / Oblivious / Scrappy, Mirror Armor, Rattled, Flower Veil) while a foe's Intimidate comes after the Trace at the lead (not faster) — see Deviations |
| Trace or Imposter copying Intimidate | its Start against both foes in `adjacentFoes()` order with their reactions (`intimidate.ts applyIntimidateToFoes`, the calculator's apply action; the 1v1's `settleEntry` rule), unless `copiedIntimidateStored` lists them; an item it uses up (White Herb, Mirror Herb, Adrenaline Orb) is gone from the start and not this turn's (`items.build` keeps it for `startWorld`'s `usedItem`) | line `{Name}'s Intimidate (copied by Trace) is applied.` and the drop lines | `REASONS.notIn2v2("Trace copying Intimidate beside Flower Veil")` where a Grass-type foe's partner has Flower Veil (the drop's model has no partner) |
| Two Pokémon acting on one | each need read from the Pokémon that has it, all four looked at (`SettleReads`: `weatherNegated`, `unnerved`, `fieldSetter`, `traceSource`); the representative is the Imposter's target, else the field's setter (the settle names it), else the foe across. Only where no one Pokémon meets every need: every turn the old `pick` settled is unchanged | — | — (`{A} and {B} both act on {C} as the turn starts.` is gone) |
| Download at the lead | each foe's Defense and Sp. Def at Download's Start: a Dauntless Shield (switch-in priority 0) counted when that foe is faster at the lead (`intimidate.ts leadSpeed`), a Seed (−1) and an Embody Aspect (Terastallization) never, an Imposter foe's transformation counted by the same order (into the Download holder: after it, the 1v1's rule); `entryOrder` decides where both ranks are given and differ; an exact Speed tie: every order of the tied group, 1/k! each (`sim/battle.ts:994-1013` speedOrder) | `{Name}'s Download raised its {Stat}: it read {Foe}'s Defense after its Dauntless Shield rise (assumes all four led together, {Foe} first: {a} Speed against {b}).` / `before …` / `Speed tie at {a}` / `({Foe} came in first)`; label `If {First} came in first.`; with no such foe effect, today's line | `Download needs {Foe}'s Defense and Sp. Def as it came in.` for a foe transformed before this turn and for Necrozma-Ultra / Zygarde-Complete whose possible entry forms have other defenses (was `Download is not modelled with {Foe}'s entry boost.`) |
| Custap Berry with Quick Draw or Mycelium Might | `FractionalPriority` from 0 (`sim/battle-queue.ts:249`; `PS/data/items.ts:1235-1256`): Mycelium Might with a status move (or No move): the Berry is not eaten; Quick Draw with an attack and the Berry at its line: two starts, 0.3 (Berry kept, `DoublesStartSlot.fractional` = Quick Draw's 0.1 with its fact) and 0.7 (eaten, 0.1 without it) | `Quick Draw: {Name} moves first in its priority bracket.` at 0.3; labels `If {Name}'s Quick Draw activated.`, `If {Name} ate its Custap Berry.` | — (`custapGuard` stops nothing) |
| Imposter (Q8) | transformed into the Pokémon across from it (`PS/data/abilities.ts:2115-2128`) by the 1v1's `settleAbilities` rules (its withheld texts stay) | turn fact `Assumes {Imposter} transformed into {Target} as both entered.` | `REASONS.imposterAcross(name)` with the slot across empty |
| A Starf Berry at the turn's first Update | one start per stat below +6 (`PS/data/items.ts` starfberry onEat: `sample`), its +amount (Ripen, Contrary, Simple as settleItems scales it); generation 7's Speed start keeps the order's Speed (`firstTurnSpeed`) | label `If {Name}'s Starf Berry raised its {Stat}.` (walk only) | — (`STARF_REASON` is no longer the settle's) |
| The start copies | a rise at that Update (a pinch Berry's `items.raised`, a Starf Berry's) reaches each foe's Opportunist (in effect) and working Mirror Herb (not Magic Room, Klutz, Embargo): pending in `DoublesStartSlot.copy` with a copy carried from last turn, applied at the first action's end by D's `afterMoveCopies` | turn fact `Assumes no Pokémon Terastallizes or Mega Evolves this turn.` when a start copy waits and a Tera build or a Mega form is in the turn (`onAnyAfterTerastallization`, `onAnyAfterMega`) | `REASONS.copiesRise("Opportunist with Mirror Herb")` for one Pokémon with both |

New hooks for the kernel (`doubles-turn.ts` calls them only after the integrator lines): `turnFacts(settle)`,
`rowsByVariant(settle, rows)` (a pair's row once where every row variant gives it alike, with the assumptions all give;
otherwise each variant's row with its label as `DoublesStartRow.fact`). `variants(kernel, settle)` now returns the start
variants (memoised per settle).

## Integrator lines (doubles-turn.ts; exact text in `w1b-st/patch-int.cjs`, applied and tested on the scratch tree `int`)

- **ST-1** `rootWorlds` / `rootWorldsOf`: `return variants.flatMap(({ weight, settle: one }) => rootWorldsOf(ctx, one, weight));`;
  `function rootWorldsOf(ctx: Ctx, settle: DoublesSettle, weight = 1)` with `base.mass = weight;` after `startWorld` (today a
  variant's fractional facts are bumped before its weight is applied: two variants count Quick Draw's 0.3 twice); and
  `const outcomes = settle.slots[action.slot]?.fractional ?? fractionalOutcomes(ctx, build, action.moveId, base.field.magicRoom);`.
  Test: `(integrator ST-1) STP-CUS-01-sv`.
- **ST-2** `startWorld`, after `if (state.mon) Object.assign(mons[slot]!, state.mon);`:
  `if (start.copy) mons[slot]!.copy = { stages: { ...start.copy.stages }, by: start.copy.by };`. Tests: `(integrator ST-2)
  CR-08a-sv / G4-OPP-07-sv`; the stored cases CR-08a-sv and G4-OPP-07-sv agree only with it.
- **ST-3** `calculateDoublesTurn`, both start-row sites: `startRows(input, settle)` → `startHooks.rowsByVariant(settle, (one) =>
  startRows(input, one))`. Test: `(integrator ST-4) its turn fact; (ST-3) the start rows per copy`.
- **ST-4** `turnFacts`, before `const targetless = targetlessSlots(input);`: `facts.push(...startHooks.turnFacts(settle));`.
  Tests: both `(integrator ST-4)`.

Not asked: running `presenceGuards` per start variant. No guard known before the walk reads what the starts differ by (a
traceable ability: Commander and Poison Puppeteer are `notrace`, PR's `dancerGuard` is a no-op in 1b; stages; a Custap Berry
held or eaten); `variants()`'s doc says so.

## Gates (run now, on the scratch trees; the live tree has other tracks' work in progress)

- **The 1a leftovers**, `STATUS2_REEXPECT=1a compare.ts`: `int` **7/7** (CR-08a/b/c-sv, G4-OPP-07-sv, SAT-IMP-1-sv/swsh,
  G4-STF-02-usum); `st` (no integrator lines) 5/7: CR-08a-sv and G4-OPP-07-sv need ST-2.
- **V2's stored T2P start cases**: `int` **14/15** (T2P-TRC-01..05, -TWO-01/02, -DWN-01..04, -CUS-01 sv/swsh, -03, -04); the one
  is T2P-TRC-03-sv (Deviations).
- **The track's probes** (`st-oracle.ts`, 18 cases, pinned Showdown with V2's `startRandom` / `keepStartBoosts`, compare.ts
  with E2): **18/18** on `int` (Trace sv/usum, Trace's Intimidate with a slow Trace and with a sure copy, the White Herb it uses
  up and a Pickup that finds nothing (STP-TRC-04-sv: without the `items.build` marker Pickup takes it and the case disagrees), two
  acting on one, Download faster / slower / tied / against a Seed / against an Imposter that transformed first or later, Custap with
  Quick Draw sv/swsh and Mycelium Might both ways, Imposter, Imposter copying Intimidate).
- **A/B over every case** (`run-app.ts`, 2308 cases, `step0a-diff-app.mjs`): base vs `int` 2291 byte-equal; the 17 that differ
  are exactly this track's (the 7 leftovers, T2P-CUS-01 sv/swsh, -03, T2P-DWN-01/02/03, T2P-TRC-01/02/05, T2P-TWO-02).
- `tests/unit/doubles-start.test.ts`: live tree and `st`: **30 passed, 4 expected fail**; `int`: 30 passed and the 4 `it.fails`
  pass (the signal to flip them to `it` once ST-1..ST-4 are in).
- `tests/source/status2-hooks.test.ts`: 7/7 (the import and cycle rule). `eslint` and `tsc --noEmit`: none in this track's files.
- `golden-1v1 --check` on `int`: 254 byte-equal.
- The settle's cost (`settle-bench.ts`, every case's input, 20 rounds): about 30 µs per input before, 34–38 µs now (one settle per
  input and turn, plus `doubles-items.ts startItemsOf`'s).

## Tests in other files that change (for the integrator)

On `st` (base + this file) against base, over `tests/unit/doubles-*`, `calculator-*`, `status2-*`:
- `tests/unit/doubles-turn-guards.test.ts`: four `expectReason`s now get `ready` (they asserted the old start reasons):
  line 125 (Imposter: Ditto transforms into the Venusaur across, fact `Assumes Ditto transformed into Venusaur as both entered.`);
  168–180 (Trace with Overgrow / Torrent foes: two starts, fact `Assumes Gardevoir's Trace copied as it came in: Overgrow from
  Venusaur or Torrent from Blastoise, 1/2 each.`; Trace copying Intimidate; Download against Zamazenta); 186–189 (the start Starf);
  203–206 (Flutter Mane between Unnerve Tyranitar and Cloud Nine Altaria). Each becomes `expect(calculateDoublesTurn(…).status).toBe("ready")`
  (or is removed: `doubles-start.test.ts` covers each).
- `tests/unit/doubles-moves-pane.test.ts:141`: `expect(doublesRepresentative(two, "own-left")).toBeNull()` →
  `.toBe("opponent-left")` (two act on Flutter Mane: the foe across stands for the rest).
- `tests/source/status2-hooks.test.ts` MOVED rows, once ST-3 / ST-4 are in: `["doubles-start.ts", "turnFacts", "doubles-turn.ts",
  "turnFacts", "startHooks.turnFacts("]`, `["doubles-start.ts", "rowsByVariant", "doubles-turn.ts", "calculateDoublesTurn",
  "startHooks.rowsByVariant("]`.

## Deviations

1. **T2P-TRC-03-sv stays not estimated** (`Trace copies a random foe's ability.`). Gardevoir (100 Speed) is faster than
   Incineroar (80), so in the Defiant start Incineroar's lead Intimidate meets Gardevoir's copied Defiant: −1 then +2 (V2's stored
   oracle: own-left `atk:-1` 0.5, `atk:1` 0.5). The input's stages are after the entry effects and can give only one of them, as
   T2P §4.1's kept reason says for field and HP; the reason is widened to abilities that change what a later foe Intimidate does.
   With Gardevoir slower than Incineroar the start is modelled (STP-TRC-02-sv agrees). Asked of V2 below.
2. `Download is not modelled with {Foe}'s entry boost.` is gone as T2P §4.3 says, but two narrow sites keep a reason, now
   `Download needs {Foe}'s Defense and Sp. Def as it came in.`: a foe transformed before this turn, and Necrozma-Ultra /
   Zygarde-Complete whose possible entry forms have other defenses. No stored case reaches either.
3. The moves pane reads one start (the first row variant), its slots labelled; the rows per start are the start rows (ST-3).
