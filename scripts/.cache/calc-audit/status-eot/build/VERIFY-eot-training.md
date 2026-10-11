# VERIFY-eot-training: independent check of the EOT-training fixer's work (status-eot review, lens "eot-training")

Verifier for `build/FIX-eot-training.md` (EOT-1 to EOT-6, plus the fixer's extra Roost, Misty Terrain and Gravity fixes).
Ground truth: pinned Showdown c23d2e94 (read-only source; the oracle `2v2/verify/sim-dfs.ts` over the runnable copy).
Branch `calc-2v2-status-eot`, working tree only: nothing committed, no branch switched, no `next build`, nothing against
live Supabase, `.claude/` and `node_modules` untouched. My probes are in `build/verify-eot-probes/` and their outputs in
`build/verify-eot-probes/out/`.

**Verdict.** All six fixes hold. Every repro now agrees with pinned Showdown, or is "not estimated" with a fact reason
where the fixer chose a narrow guard (EOT-1, EOT-2). The neighbourhood probes across sv, champions, swsh and usum agree
(cases VE01–VE21). I found one more gap of the EOT-3 kind and fixed it: **Magic Room** from before the turn counts down
at order 27.6, before the Orbs, Sticky Barb, White Herb and the final Update's Berries. The calculator now states the
assumption, and Training sends that turn to a rollout. 1v1 stays byte-equal, and the oracle corpus still matches
1001/1001.

## How to re-run

- Review repros: `npx --no-install tsx scripts/.cache/calc-audit/status-eot/review/eot-training/check.ts [--verbose]`,
  `…/review/eot-training/texts.ts`, `npx vitest run --config scripts/.cache/calc-audit/status-eot/review/eot-training/vitest.config.mts future-sight`.
- Fixer cases: `npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/fix-eot-check.ts --verbose`.
- My neighbourhood cases (oracle vs app): `npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/verify-eot-probes/check.ts [ids] [--verbose]`
  (cases in `verify-eot-probes/cases.ts`, VE01–VE21).
- My app text probes: `…/verify-eot-probes/texts.ts` (VT01–VT09).
- Pinned field-end probe (Magic Room, Misty Terrain, Gravity with 1 or 5 turns left, four games): `…/verify-eot-probes/field-end-probe.ts`.
- E2 profile: `node --cpu-prof --cpu-prof-dir=<dir> --import tsx scripts/.cache/calc-audit/status-eot/review/eot-training/e2-prof.ts 200`,
  then `node …/verify-eot-probes/prof-abs.mjs <file> calculateDoublesOutcomes endOfTurn speedOf`.

## Gates I re-ran

| Gate | Result |
|---|---|
| `2v2/verify/compare.ts --no-write` (before my change / after) | 1001/1001 / 1001/1001 |
| `golden-1v1.ts --check` (before / after) | 254 byte-equal / 254 byte-equal |
| Review `check.ts` | 20 ok. RV01, RV21 and RV22 are not estimated by the fixer's guards. RV05 is another fixer's turn-level guard. RV24: the oracle cannot set it up. |
| Review `texts.ts` | RT01, RT02 and RT04 now state `Assumes the Rain|Sun does not end this turn.`; RT03 unchanged |
| Review Future Sight probe | turn 2: no `futureMove`, E2 applied, Showdown lands: false; turn 3: carried, Showdown lands: true |
| Fixer `fix-eot-check.ts` | FX01, FX02 ok; the status probe gives `brn` / `tox` as the oracle |
| My `check.ts` VE01–VE21 | 13 ok; the 8 others are all "not estimated" by the EOT-1 and EOT-2 guards, as expected (below). Pinned differs from the old exact output in 7 of them; VE04 is a conservative over-guard. |
| Unit: `training-*`, `doubles-eot`, `residuals`, `doubles-outcomes` | 55 files, 633 passed |
| Unit: `doubles-*`, `calculator-doubles*`, `uses-to-ko*`, `hit-loop*` | 28 files, 1260 passed |
| Source: `tests/source/doubles-residuals.test.ts` | 3/3 |
| `npx tsc --noEmit -p .`, eslint on my changed files | clean |
| Conformance, pool E only (`--pools E --eot 0 --battles 30 --containment 4 --saved 0 --skipE2 --run verify-eot-E`, new seeds) | every gate PASS: 1 646/646; 2b 100%/100%; 2c 232/232; 4b 74162/74162 |
| Conformance, default (`--run verify-eot-SVA`, new seeds, after my change) | every gate PASS (see "Training gates") |
| Leak (`npm run leak:training` equivalent, after my change) | every gate PASS; dice-eot 0 differences in 73 |
| Final re-run at the end (tree as it stands) | compare 1001/1001, golden 254 byte-equal, my two test files 41/41 |

## Per finding

### EOT-1: a weather replaced and set again this turn. Guard confirmed; narrow but conservative

- **Repro.** RV01 is now `not-estimated (Rain Dance after Sunny Day is not modelled in 2v2.)` in the calculator and E2.
  Before the fix the app showed 100 as exact; pinned gives 109.
- **Why a guard.** `FieldState` does not record when its weather was set, and the setters are in other fixers' files. I
  agree that the exact fix needs a flag there (needsFromOthers, kept from the fixer).
- **Neighbourhood** (oracle vs app):
  - VE01: the Rain Dance user is faster, so its Rain Dance fails, then Sunny Day sets a new sun. Solar Power acts. Exact, ok.
  - VE02: `weatherTurns` 2. The new rain and the old one give the same HP. Exact, ok.
  - VE03: Sand Spit sets sand on a hit, then Rain Dance. Guard fires (`Rain Dance after Sand Spit`). Pinned: Rain Dish +9.
  - VE05 (SwSh): Max Flare, then Max Geyser. Guard fires (`Max Geyser after Max Flare`). Pinned: a new rain.
  - VE06 (Champions): Sunny Day, then Politoed's Rain Dance. Guard fires. Pinned: Pelipper's Rain Dish +8.
  - VE04: the Sunny Day user is asleep from Rest and cannot wake, so its Sunny Day never runs. Rain Dance fails and the
    old rain ends (pinned: no Rain Dish). The app is **not estimated** here. That is conservative, not wrong: `moved` is
    set before BeforeMove (doubles-turn.ts `execute`), so a setter that was stopped at BeforeMove still counts as acting.
    Tightening it exactly needs the same per-world flag. I left it as it is and give it to the same need.
- I checked every place the moves change `w.field.weather` (doubles-status.ts weather moves, doubles-turn.ts step
  conditions: Max Moves and Sand Spit; the face probe; `kernel.faint` ending a strong weather). `weatherSetters` covers
  every weather they can set. The ability changers (Skill Swap, Role Play, Entrainment, Doodle) are guard moves ("L"),
  so they cannot set a weather by an ability Start. Receiver and Power of Alchemy are not estimated in `kernel.faint`.

### EOT-2: Harvest and Pickup after a Berry eaten inside the residual. Guard confirmed

- **Repro.** RV21 is `not-estimated (Harvest is not modelled in 2v2.)`. RV22 is `not-estimated (Pickup is not modelled in 2v2.)`.
- **Neighbourhood:**
  - VE07: Harvest in sun with a Lum Berry eaten at a carried Yawn's sleep (order 23). Not estimated. Pinned: Harvest
    restores the Lum (100% in sun).
  - VE10: Pickup takes a Lum Berry eaten at a Yawn's sleep. Not estimated. Pinned: `Pickup item:lumberry`.
  - VE11 (Champions, Diggersby): Pickup takes a *foe's* Sitrus. Not estimated. Pinned: Diggersby picks it.
  - VE18 (Champions, Trevenant): Harvest after the sand's Update. Not estimated.
  - Controls that stay exact and match: VE08 (the Harvest holder keeps its Sitrus) and VE09 (the Pickup holder holds
    Leftovers).
- **Rule checked against pinned `data/abilities.ts`.**
  - Pickup: `getAllActive()` (no fainted), `lastItem && usedItemThisTurn`, `isAdjacent` (never itself; every active Pokémon in doubles).
  - Harvest: `pokemon.hp && !pokemon.item && lastItem.isBerry`.
  - `pickupGuard` and `harvestGuard` follow both.
- **Possible miss, checked and closed.** A Pokémon that used an item and then received another one keeps its `lastItem`
  and `usedItemThisTurn` (sim/pokemon.ts sets them only in useItem and eatItem). Pickup can still take from it, and the
  guard reads only "now has no item". To get an item back, though, someone else must lose one: Trick, Switcheroo, Bestow
  or Symbiosis. That Pokémon holds no item now, so the guard fires on it. I found no reachable miss.
- **Over-guarding.** The guard fires on a Pokémon that lost its item without using it (Knock Off, a Trick into an empty
  hand). It is conservative; Pickup holders are rare.

### EOT-3: missing "Assumes the {Weather} does not end this turn." Confirmed. One more sibling found and fixed (Magic Room)

- **Repro.** RT01, RT02 and RT04 state the fact. With `weatherTurns` given there is none. RV23 and VE14 (Champions,
  rain's last turn) match pinned: no cure, burn 12. VE15 (USUM, 2 left) matches pinned: cured.
- **Neighbourhood:**
  - VE13: a rain set this turn by Rain Dance. Cured, and no fact (correct, the new rain lasts 5 turns). Matches the oracle.
  - VE12: Leaf Guard with a Flame Orb in sun with one turn left. Burned at 28.3. Matches.
  - VT08: Hydration with a Utility Umbrella. No cure, no fact; burn 12.
  - VT09 (USUM, Harsh Sunshine): a strong weather has no fact.
- **Fixer's Misty Terrain and Gravity facts.**
  - Pinned check (`field-end-probe.ts`): with one turn left, Misty Terrain (27.7) ends and a Toxic Orb poisons; Gravity
    (27.2) ends and a Corviknight in Misty Terrain is burned. With five turns left, neither. The same in sv, champions,
    swsh and usum.
  - The app states both facts (VT07, fixer's unit test).
- **New: Magic Room (same class, not covered).** Pinned `data/moves.ts` magicroom: `onFieldResidualOrder: 27,
  onFieldResidualSubOrder: 6`. Item handlers are collected whatever the room does, and suppressed only as they run
  (`ignoringItem`). So with one turn left the room ends at 27.6, and what comes after it acts. `field-end-probe.ts`,
  identical in all four games:

| Held item (Snorlax) | Magic Room 1 turn left | 5 turns left |
|---|---|---|
| Flame Orb | burned (28.3) | no status |
| Sitrus Berry at 100/235 | eaten at the final Update, 158 | 100 |
| Sticky Barb at 200 | 171 (−29 at 28.3) | 200 |
| Lum Berry, burned | burn 14 at 10, then cured at the final Update | stays burned |
| White Herb at −1 Def | restored (29) | −1 Def |
| Leftovers at 100 (5.4, before 27) | 100 | 100 |

  - Before my fix the app showed the 5-turns-left numbers as exact, with no fact (VT01–VT03). The input has no turns
    left for Magic Room.
  - **Fix in `app/lib/battle/doubles-eot.ts`** (`roomFact`, `lateItemActs`, `berryDue`, called from `afterChecks` on each
    final world). The fact is `Assumes Magic Room does not end this turn.` It is added when Magic Room from before is
    still up and a Pokémon with HP holds an item that would act after 27.6 if items worked:
    - a Flame Orb or Toxic Orb whose status `canStatus` allows;
    - Sticky Barb (not with Magic Guard);
    - White Herb with a lowered stage;
    - Mental Herb with Taunt, Disable, Encore or Heal Block;
    - Booster Energy on an unboosted Protosynthesis or Quark Drive holder;
    - a Micle Berry at its line;
    - a Berry the final Update would eat, using `updateSlot`'s conditions (Unnerve, Heal Block, curing and HP lines).
  - Leftovers, and a Sitrus above its line, get no fact.
  - **Fix in `app/(app)/training/sim/bridge.ts`.** Training ignores facts, and the bridge knows the room's duration. So
    with `magicroom.duration === 1`, any active Pokémon holding a Berry, White Herb, Mental Herb, Booster Energy, an Orb
    or Sticky Barb makes the cell a rollout: `Magic Room ending this turn is not modelled.` Champions has no Orbs or
    Sticky Barb (catalog query), so Misty Terrain and Gravity need no Training guard. Training builds only Champions
    (`liveBuild`).
  - **Tests:**
    - `doubles-eot.test.ts` "states that Magic Room from before goes on when an item would act after its countdown
      (order 27.6)": SV Flame Orb, Sticky Barb, Sitrus at its line, Lum with a burn; Champions Sitrus. Controls:
      Leftovers, Sitrus above half, no Magic Room (the Orb burns).
    - `training-bridge.test.ts` "Magic Room with one turn left and an item that acts after its countdown: a rollout":
      Sitrus and White Herb give a rollout. Two turns left, Leftovers, or no room give the engine.
  - **Negative check.** With `roomFact` and the bridge reason disabled, both tests fail. Restored after.
  - compare.ts stays 1001/1001: the corpus has two Magic Room cases, and they still match.

### Fixer's Roost fix (order 25). Confirmed

- FX01 and FX02 match pinned: `brn` and `tox`, in the residual and in the E2 status.
- **Neighbourhood:**
  - VE19 (USUM, Skarmory, Flame Orb, Misty): burned. Matches.
  - VE20: a carried Yawn (23) in Misty Terrain after Roost. Still grounded at 23, no sleep. Matches.
  - VE16: Tera Flying Corviknight uses Roost in Grassy Terrain. Pinned roost onStart returns false while Terastallized,
    so there is no heal. Matches.
  - VE17: Roost at full HP with a carried Yawn in Electric Terrain. Pinned: no Roost volatile when the heal fails, so it
    falls asleep. The app agrees.
- The key `{ order: 25, subOrder: 2 }` matches pinned resolvePriority (a Pokémon volatile Condition gets subOrder 2), and
  the gen8 mod roost only changes PP.

### EOT-4: Future Sight landing in the bridge. Confirmed

- The reviewer's probe gives turn 2: no `futureMove`, E2 applied; turn 3: carried, Showdown lands it.
- Pinned `data/conditions.ts` futuremove: `endingTurn = (turn − 1) + 2`, and it lands when `getOverflowedTurnCount() >=
  endingTurn`. `getOverflowedTurnCount` is `trunc(turn − 1, 8)` from gen 8, the same as the bridge's `(battle.turn − 1) %
  256`. Training builds only Champions (gen 9), so the gen 7 form (no modulo) is never reached.
- Wish keeps `overflowed > startingTurn` (data/moves.ts wish onResidual), as before.
- Doom Desire shares the slot condition (`future.move`). The tracker's upkeep removal covers both, and Wish one turn after its use.
- The bridge test "carries a Future Sight only on the turn it lands" passes.

### EOT-5: gate coverage and the four Training bugs. Confirmed

- **Pool-E conformance on new seeds** (`verify-eot-E`): every gate passes (tracker parity 646/646, 2b 100%/100%, 2c
  232/232, 4b 74162/74162). 4d shows the carried fields exercised: allySwitch 81, futureMove 576, saltCure 223, wish 30, yawn 62 and others.
- **Code read:**
  - Tracker `choiceMove`. pinned choicelock: onStart keeps `activeMove.id`. A Struggle-started lock ends at the next
    DisableMove (`!hasMove`). A Choice item's onStart removes the lock. The tracker follows all three: the first move
    after an item arrives, a Struggle start replaced, `-item [from]` (not Frisk) clearing it. A `cant` turn never reaches
    onModifyMove, and there is no `move` line then, which agrees.
  - Syrup Bomb source, with duration 4 (pinned syrupbomb condition `duration: 4`, source the user).
  - Leech Seed `sourcePosition`: pinned addVolatile sets `sourceSlot = source.getSlot()` as it is added.
  - Wish and Future Sight removed at the resolving upkeep.
- Gate 4b by Pokémon (`lib/starting-mons.ts`) reads the clone's starting Pokémon objects, which persist through the turn.
- I changed none of these.

### EOT-6: end-of-turn Speed and allocation. Confirmed (behaviour unchanged)

- **Behaviour unchanged:** compare 1001/1001, golden byte-equal, and every unit suite passes.
- **Code read.** Each change is equivalent:
  - `speeds` are computed once from the start world. The weather handler (order 1) is always first, so its eachEvent
    order is the same as before, and pinned updateSpeed runs once (sim/battle.ts:2814).
  - `merge` of a single world returns it as it is.
  - `resolveFaints` and `splitZero` skip only slots that no world has at 0 HP.
  - `sub` and `NO_KEY` are read only by the Recorder.
  - `guardOf` calls `moveInfo` only for Gigantamax builds, and only they have G-Max moves.
- **Profile.** My run (`e2-prof.ts 200`, with a conformance run on the same machine): 0.68 ms per E2 call. Per 1000
  calls, endOfTurn is 99 ms inclusive; the review had 159 and the fixer 85–87. This agrees with the fixer within the
  machine's noise.
- The eval's belief p95 and the HabitBot gate are the integrator's (needsFromOthers, unchanged).

## Observations, not changed

- **E2 after the moves and a carried Yawn** (VE07, VE10: compare reports `E2 own-left volatile yawn: expected 1, got 0`).
  - This shows only when the end of turn is not estimated. `outcomeMon` then lists only this turn's Yawn (`yawn === 2`),
    by Track B's convention ("a Yawn landed this turn is still to come"). The oracle's state after the moves still has
    the carried one.
  - It is outside the six fixes, and the cases are not estimated anyway. It is noted for the owner of compare.ts's E2 check.
- **The oracle's `CHANCE_EFFECTS` lacks `harvest`** (VE18: no Harvest line in the oracle).
- **compare.ts does not check status-only residual facts.** Both are already in the fixer's needs, and I confirm them.

## Training gates

The runs used my working tree, with the Magic Room changes in, and new seeds. The machine was shared with the other
fixers' runs.

- **Conformance, default** (`npx tsx scripts/training/conformance.ts --run verify-eot-SVA`: pools S, V, A plus 10 pool E
  battles per mode, 7 m 8 s). Every gate passes:
  - 1: 870/870.
  - 2a: 276/276.
  - 2b: 100% / 100% of 276.
  - 2c: 247/247.
  - 3: 306/306, 306/306.
  - 4a: 0 over 400.
  - 4b: 54213/54213 over 2783/3000 engine cells.
  - 5: 33.7% / 35.0% / 25.1%.
  - 6: 24650/24666, with 16 shown as unavailable.
  - 7: 0.
  - 8: 657 passed.
  - 9a: 30/30.
  - 9b: 30/30.
  - Runner errors: 0.
- **Conformance, pool E only** (`verify-eot-E`, 8 m 27 s). Every gate passes:
  - 1: 646/646.
  - 2b: 100% / 100% of 249.
  - 2c: 232/232.
  - 4b: 74162/74162 over 3261/3570 engine cells.
  - 6: 18223/18223.
  - 7: 0.
- **Leak** (`npx tsx scripts/training/leak.ts`, 18 m 1 s). Every gate passes:
  - L1 sp 194, nature 231, item 247, ability 253, moves 289, bench 305, hp 152, dice 70, dice-eot 73, choice 129, all with 0 differences.
  - The settings still work: sp-open 161/201, hp-exact 73/139.
  - L2: 0 hits in 510 messages.
  - Saved battles: 40/40 boards equal.
- **Eval.** Not re-run: 14 minutes on 8 shards. Its two failing rows (belief open p95, Reads − Plays safe vs HabitBot)
  are not on the end-of-turn path, as the fixer measured, and my change only adds rollouts when Magic Room has one turn
  left. No fixture team uses Magic Room.

## Files I changed

- `app/lib/battle/doubles-eot.ts`: `roomFact`, `lateItemActs`, `berryDue`; `afterChecks` calls `roomFact`.
- `app/(app)/training/sim/bridge.ts`: `AFTER_ROOM_ITEMS` and the Magic Room rollout reason.
- `tests/unit/doubles-eot.test.ts`, `tests/unit/training-bridge.test.ts`: one regression test each.
- Probes, not product code: `build/verify-eot-probes/` (cases.ts, check.ts, texts.ts, field-end-probe.ts,
  catalog-query.ts, learners.ts, prof-abs.mjs, out/).

## Needs from others (kept or added)

1. **EOT-1 exact** (owners of doubles-world.ts, doubles-status.ts, doubles-turn.ts). Fixer's need, confirmed: a
   `FieldState.weatherSet` flag set wherever the moves change the weather. With it, the guard (and VE04's conservative
   over-guard) goes away.
2. **Oracle harness** (Track D, `2v2/verify/`):
   - add `harvest` to `sim-dfs.ts` CHANCE_EFFECTS;
   - compare status-only residual facts and E2 statuses (FX01, FX02 and VE12, VE19 would then be checked);
   - compare.ts's E2 volatile check after the moves (not-estimated end of turn) disagrees with `outcomeMon`'s Yawn
     convention for a carried Yawn (VE07, VE10). Decide which side is intended.
   - VE01–VE21 (`build/verify-eot-probes/cases.ts`) can join the corpus as they are.
3. **Integrator**: eval's belief open p95 and the HabitBot gate, as the fixer reported (unchanged).
