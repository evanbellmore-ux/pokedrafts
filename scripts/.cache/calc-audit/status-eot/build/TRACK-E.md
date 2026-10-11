# Track E: positions, items, Substitute

Branch `calc-2v2-status-eot`. Builds ADDENDUM §3.6, §4.10, §4.11, §4.12 and §4.13 in Track E's own files. Nothing in
`doubles-turn.ts`, `doubles-world.ts` or the Step 0 turn API of `uses-to-ko.ts` was edited. Nothing was committed.

## What was built

### `app/lib/battle/hit-loop.ts`: `SubCost` and `subHit` (§3.6)

These are appended at the end of the file. No existing line changed, and `golden-1v1 --check` stays byte-equal (254 cases).

`subHit` takes the attacker through one hit into a Substitute, in pinned order:
- **Recoil:** `round(taken × recoil)`, at least 1.
- **Self-cost:** `round(maxHP / 2)` for Steel Beam and Chloroblast.
  - Rock Head stops recoil and Chloroblast's cost (both are the `'recoil'` effect), but not Steel Beam's.
  - Magic Guard stops each.
- **Drain:** `ceil(taken × drain)`.
  - The target's Liquid Ooze deals the raw amount instead: no Big Root, and at full HP too (K2).
  - Otherwise the attacker heals, with Big Root at 5324/4096, and nothing at full HP.
- **The hit's Update:** the attacker's HP or pinch Berry, as `hitStep` eats it.

No DamagingHit handler of the target runs.

### `app/lib/battle/doubles-substitute.ts` (§4.13)

**Which hits it handles.** `single` (from singleStep) and `plan` (from spreadStep) take a hit that meets a Substitute:
- the target has `vol.substitute`, and the attacker is not the target;
- the move has no `bypasssub` flag and is not a sound move (`PASSING_MOVES`), and the attacker has no Infiltrator.

A row with no damage returns null, so it stays today's no-damage hit (type immunity and TryHit come first).

**Narrow guards** (`REASONS.intoSubstitute`):
- Max Moves;
- a signature Z-Move in `Z_MOVE_EFFECTS`;
- Mind Blown;
- Magician, when the attacker holds nothing and `itemTakeable` says it could take the target's item;
- Parental Bond (a move it doubles shows more than one hit in `turnCases`).

**Calculation.** `kernel.searchFor(…, { behindSubstitute: true })`.

**Parts by HP.** The world is split by `targetHPClass`, and also by `attackerHPClass` for a followed search whose damage reads the attacker's HP.

**The prefix** (`subPrefix`) walks every case of `turnCases` and every roll:
- each hit takes `taken = min(value, s)`; at `s = 0` the Substitute breaks, and the remaining hits continue into the Pokémon (`skip`);
- classes with equal `(case, skip, s)` merge.

**Per class:**
- the Substitute's HP is set (deleted at 0);
- `subStat` records the class, with the fact `Its Substitute breaks.` when it breaks;
- the attacker's HP goes through `subHit` with `mapHP`. Only a one-hit case can change it; the census proves it.

**Outcomes of the prefix:**
- **The attacker faints in the prefix:** no step. A Gem is spent, the target's Air Balloon pops (with Unburden), and `kernel.faint` runs.
- **The prefix ate the attacker's Berry:** `kernel.ateBerry` runs, then the search re-runs on the new build.
- **Otherwise:** `kernel.applyStep(…, { caseIndex, skip })`.

**After the step:**
- the resist Berry, Chilan Berry and Disguise / Ice Face stand-ins are put back;
- the fact `{Move} hits {Name} after its Substitute breaks.` is added when a hit got through;
- `koBoost` and Final Gambit's faint (single-target only).

**Speed-up.** When the prefix leaves the attacker unchanged, the classes of one `(case, skip)` share a single step, and its worlds are then split by the Substitute's HP. The worlds are the same; there are fewer `turnStep` calls.

**Multi-hit guard (`SUB_PER_HIT`, §4.13.6).** It applies to a case with more than one hit, in front of:
- Multiscale or Shadow Shield at full HP (a breaker passes Multiscale);
- Stamina, Weak Armor (physical), Water Compaction (Water), Seed Sower or Sand Spit;
- Mummy, Lingering Aroma or Wandering Spirit on a contact move;
- a working resist Berry for the move's type (Chilan for Normal), or Luminous Moss (Water).

An intact Disguise, or an intact Ice Face against a physical move, gets `faceMultiHit` (a breaker passes both). A Focus Band gets `focusBandGuard`.

**`DoublesHit.min` and `max` for a continuation.** The part path lists the run's own row, which is the whole move's damage. `continuationRows` moves that share in `HitStats.met` to the continuation's own damage: the sum of the case's hits from `skip` on. Example, U4: 20–26, not 50–65.

**Conditions:** `Substitute: {HP} HP.` per world (the chance comes from the aggregator).

### `app/lib/battle/doubles-positions.ts` (§4.11)

**`allySwitchPrepare`** (Scarlet/Violet and Champions only; generations 8 and 7 have no PrepareHit):
- with no counter: `vol.allySwitch = 3`;
- with a carried counter c, the world splits:
  - 1/c passes, with the counter at `min(729, 3c)`;
  - 1 − 1/c fails, the volatile deleted, with `Ally Switch fails: it was used last turn.`

**`allySwitchHit`:**
- A world whose PrepareHit failed passes through unchanged. `allySwitchStopped` tells Track A which worlds those are.
- The ally's slot empty: `…: its ally has fainted.`; the ally fainted: `Ally Switch fails: {Partner} has fainted.`
- Otherwise it toggles `w.swapped[side]` (deleting the key when it is false) and adds `Ally Switch: {User} and {Partner} swap places.`

**`startRoute`** (§4.11.7). It is gated on `mayComeAfter`, rebuilt from `priorityOf`, `speedOf` and the fractional outcomes (generation 7 uses the first-turn Speed):
- a move aimed at a Pokémon whose partner chose Ally Switch gets a conditional row into the partner, with the fact. There is none when a redirection takes the move, and none for Dragon Darts at a foe (it meets the same two Pokémon either way);
- a move aimed at the attacker's own ally that chose Ally Switch gets the row `{Move} fails if {Partner}'s Ally Switch comes first.`; Dragon Darts gets `dartsAimSelf`.

**Facts and outcomes:**
- `conditions`: `Swapped places with {Partner}.`
- `turnFacts`: `Assumes {Name} did not use Ally Switch last turn.`
- `outcomeMon`: kept as Step 0 wrote it.

### `app/lib/battle/doubles-items.ts` (§4.12)

**`swapItems`** runs in this order:
1. Both item-less: it fails (`{Move} fails: neither holds an item.`).
2. An item that cannot be moved: `itemTakeable(…, true)` on the target's item first, then the user's. The fact is `{Move} fails: {Holder}'s {Item} cannot be moved.`
3. The swap: `w.itemsMoved`, plus the step fact (in its three forms).
4. Unburden: on for a holder that had an item (or had Unburden on) and now has none.
5. Receipt, the target first, then the user. Nothing happens for an item its holder ignores (Klutz, Magic Room):
   - White Herb with a lowered stage restores the stages, leaves no item, sets Unburden, and adds the fact `White Herb: {Name}'s lowered stats are restored.`;
   - a Seed in its terrain, Room Service under Trick Room, and Booster Energy for a Protosynthesis or Quark Drive holder give `REASONS.received`.

**`conditions`:** `Holds {Item}.` or `Holds no item.` when the world's item differs from the item the settled start build held. The settled items come from `settleDoublesStart`, cached per input.


**Symbiosis on a received item.** A received item that its holder uses in the same action triggers a partner's Symbiosis. `usedThisAction` tells when:
- White Herb with a lowered stage, at receipt;
- at the action's Update: Mental Herb against Taunt, Encore, Disable or Heal Block;
- a curing Berry against its status (Lum and Persim against confusion too);
- an HP or pinch Berry with some HP at or under its line, unless a foe's Unnerve or As One stops it.

When that holds and the receiver's living partner has Symbiosis and an item, the turn gives `notIn2v2("Symbiosis")`.

## Tests (all pass)

| File | Tests | What it pins |
|---|---|---|
| `tests/unit/hit-loop-substitute.test.ts` | 12 | **Values:** U2 (10, 27), U2c (18; Big Root 23), Liquid Ooze 10 with and without Big Root, at 40 HP and full HP (K2). **Costs:** Steel Beam's and Chloroblast's halves, Rock Head, Magic Guard. **Rest:** the Update's Berry (and Unnerve); no DamagingHit. |
| `tests/unit/doubles-substitute.test.ts` | 31 | `subPrefix` on fixed rolls (capped, broken, `skip`, random counts); the U and K probe values below; the narrow guards and `SUB_PER_HIT`; reference mode equal to the normal mode on 10 Substitute turns. |
| `tests/unit/doubles-positions.test.ts` | 17 | **Positions:** `positionOf` and `occupant`; the targeting rules (A1, A1b, A2, A3, A4, A5, K4, E12). **Counter:** A8, A9, A11, ×3 to 729, none in gen 8/7. **Other:** start rows; the handler on a kernel fixture. |
| `tests/unit/doubles-items.test.ts` | 16 | **Swap:** facts and failures (T5, T6 in four games); Switcheroo (T9); `itemTakeable` both ways. **Later reads:** T1 re-sort (gen 8+) vs frozen order (gen 7); Iron Ball (T2); Air Balloon (T10); Life Orb (T3). **Unburden:** T7, T7b, four cases on the fixture. **Receipt:** White Herb, Klutz, Seeds, Magic Room, Room Service, Booster Energy. **Other:** Symbiosis (T11, E23, a used Berry); `itemsMoved` across `cloneWorld`; the "Holds" conditions. |
| `tests/source/doubles-items-takeable.test.ts` | 4 | In each of the four games, every catalog item with a pinned `onTakeItem` equals `itemTakeable`, holder × receiver. Sources: the compiled dex, the Champions mod, and the gen 8 mod's Griseous Orb read from the TypeScript source. |
| `tests/source/doubles-substitute-census.test.ts` | 6 | **Classified or unreachable:** every `onAfterSubDamage` handler (moves, items, abilities) and every item or ability reading `hitSub` or the substitute volatile. **`PASSING_MOVES`** equals the catalog's bypasssub non-sound damaging moves. **`SUB_PER_HIT`** equals the per-hit reads parsed from @smogon/calc, less Gooey, Tangling Hair, Contrary/Simple (they only modify the items' rises), and `AFTER_MOVE_ITEMS` read from calculate.ts. **No catalog move** has multihit with recoil, drain or a self-cost. |

The positions and items tests run through Track A's dispatch, which landed during this track. The temporary `vi.mock` dispatch they first used is gone.

**Probe values checked in `doubles-substitute.test.ts`:**
- **U1:** Substitute HP 18 / 16 / 19 / 15 at 0.375 / 0.3125 / 0.25 / 0.0625, in four games.
- **U2:** 143 and 126. **U2c:** 58 and 63. **U2d and K2:** 30 and 160.
- **U3:** Life Orb 77, Shell Bell 100, the Gem spent.
- **U4:** 215, and the continuation's damage 20–26. **U4b:** breaks 1, untouched share 0.35. **U4c:** 188. **U4d:** the Sash saves, then a KO.
- **U5:** the spread damage equals the twin's, 162 / 197.
- **U6, U7, U8, U9; U11** (with Flower Trick); **U12** (200 left, broken, 250 left); **U14.**
- **K1:** Rage Fist at 300 vs 50. **K6.** **K7.** **K8:** Rocky Helmet once.

**E cases against Track D's oracle.** `track-e/run-e.ts` checks every E case:
- through Track D's `caseInput` and `compareCase` (with E2);
- plus its own checks: `swapped`, `DoublesHit.substitute` vs `HitResult.sub`, and the item and Substitute mixtures.

**113 of 124 agree.** The 11 that do not:

| Cases | Owner | Why |
|---|---|---|
| E16a, E16b, E16d, E16e, E16h | Track A | A received item is not used at the action's Update (Sitrus, Lum, Mental Herb, Figy, the user's Sitrus), because `updateAll` only reacts to a status or volatile gained this action. See Needs. |
| E25b | integrator | A bug in the frozen part path: a draining contact move into a Substitute in front of Rough Skin takes Rough Skin's damage. See Needs from the integrator, item 0. |
| E40-IcicleSpear-OccaBerry | Track D (case) | An Ice move never triggers Occa (a Fire Berry), so the engine is exact and the turn is ready. A `subPerHit` Berry representative needs a matching type, e.g. Bullet Seed into a Rindo Berry Gastrodon. |
| E40-BoosterEnergy | Track D (case) | Great Tusk is a Paradox Pokémon, so Trick fails (T6) and the turn is correctly ready. `received` for Booster Energy needs a non-Paradox holder with Protosynthesis or Quark Drive; `doubles-items.test.ts` pins it on a kernel fixture. |
| E22b, E22c | Track D (compare rule) | The `received` reasons match. The cases have no damaging move, hence no start rows, and `compareCase` requires one for a not-estimated case. |
| E03-AromaticMist | Track D / A | The app's target rule gives Aromatic Mist no chosen target (`This move takes no chosen target.`), and the case passes `target: own-right`. |

**My own cross-check.** `track-e/cross.ts` compares each slot's HP and Substitute-HP marginals with an exact all-rolls enumeration of the probe harness (after the turn, since Track B now applies the end of turn).
- **Agree exactly** (7 cases): Brave Bird + Sitrus at 90 HP; Draining Kiss + Big Root into Liquid Ooze; Super Fang at 200 HP behind 30; Ice Beam then Dragon Claw into one Substitute; Knock Off into a Colbur Gengar; Body Slam + Life Orb at 100 HP; Champions Dragon Claw.
- **Too slow for this harness** (spread and multi-hit, every roll): these are covered by Track D's exhaustive E27 and E28, which agree.

**Other gates:**
- `golden-1v1 --check`: 254 cases byte-equal (re-run after every change).
- `tsc --noEmit`: clean for the whole project at the last run.
- eslint: clean on every Track E file.

**Bench.** My own timings, with `track-e/bench-e.ts` and `bench-e3.ts`; `bench.ts` is Track D's.

| Case | Turn, median | Turn, max | Outcomes |
|---|---|---|---|
| ADDENDUM: Ally Switch + Snipe Shot + Follow Me | 9.2 ms | 47.6 ms | 3.8 ms |
| ADDENDUM: Trick Choice Scarf + four movers + Quick Claw | 7.1 ms | 14.2 ms | 2.4 ms |
| ADDENDUM: carried Substitute + Icicle Spear + Rock Slide | 11.6 ms | 17.5 ms | 4.7 ms |
| Stress: two Substitutes + Bullet Seed + Rock Slide | 45 ms | | 36 ms |

The stress case takes 13 ms without the Substitutes. The extra time is world count (the Substitutes' HP is discrete state); the profile shows `discreteKey`, `mergeWorlds` and `applyStep` on top.

The scratch scripts (`harness`, `probe-u`, `one-e`, `run-e`, `cross`, the benches) are in `scripts/.cache/calc-audit/status-eot/build/track-e/`.

## Deviations from the spec

1. **Substitute conditions are per world.** `conditions` is per world, and the frozen `conditionStats` merges by identical text. So a mixture shows one `Substitute: N HP.` fact per HP value, each with its chance. The `{min}–{max}` card text of §4.13.11 / §5 is left for Track C to merge (see Needs).
2. **"Holds …" covers every item change.** `items.conditions` reports any difference from the settled start item: Knock Off, eaten Berries, a used Sash or Gem, a popped Balloon. This follows §5's "only when the item differs from the start". Limiting it to Trick and Switcheroo would be a one-line change.
3. **A Symbiosis guard for received items** (not in the spec). `eventGuards` exempts the slots in `itemsMoved` for the whole action, so a receiver using its new item this action would otherwise pass unseen. It is limited to `usedThisAction`; E23 (a Sitrus Berry at full HP) and T11 (a Choice Scarf) stay ready.
4. **White Herb's fact text** (`White Herb: {Name}'s lowered stats are restored.`) is mine; the spec gives none.
5. **`subHit` does not read Heal Block.** It cannot occur in the moves phase: Psychic Noise is guarded while a later action follows, and a carried Heal Block is a rollout.
6. **`SUB_PER_HIT` conditions.** Each is applied only where the engine's per-hit read can change a value; they follow checkMultihitBoost's own conditions and the type and full-HP tests of its `hitCount === 0` terms:
   - Water Compaction and Luminous Moss only on Water moves;
   - Weak Armor only on physical moves;
   - Multiscale and Shadow Shield only at full HP;
   - a resist Berry only for its own type;
   - Ice Face only against physical moves;
   - a breaker passes Multiscale and the faces.

   E40-IcicleSpear-OccaBerry is affected (see the table above). The spec's literal list, which drops these conditions, is a one-line change if preferred.
7. **The Gem in the prefix-faint path.** When the attacker faints in the prefix, its Gem is still spent (`onSourceTryPrimaryHit` comes before the recoil).
8. **New exports:** `PASSING_MOVES`, `SUB_PER_HIT`, `subPrefix` and `SubClass` (substitute); `allySwitchStopped` (positions).

## Needs from other tracks

**Track A.** The dispatch landed and matches the contract below. One part is still open: the action's Update after Trick or Switcheroo has to use the received items.
- **Where:** in `updateAll`, for each slot in `w.itemsMoved` that is alive and whose item works. `itemsMoved` is deleted only in `runMove`, after `statusMove` returns, so it is still there.
- **What:**
  - `kernel.berryDue(w, slot)` (HP and pinch Berries at their lines, curing Berries by status), unless `kernel.berryStopped(w, slot)`;
  - Lum and Persim against an existing confusion;
  - Mental Herb against an existing Taunt, Disable or Encore.
- **Cases:** E16a (Sitrus at 80/182: +45), E16b (Lum cures an earlier paralysis), E16d (Mental Herb ends a Taunt), E16e (Figy at ¼, then confusion), E16h (the user's received Sitrus at 60/130).

**The dispatch contract:**
- **Ally Switch** (`allySwitch`):
  - after BeforeMove passes, set `vol.usedMove = "allyswitch"`;
  - call `positions.allySwitchPrepare`, then `positions.allySwitchHit` on every world it returns. A world whose PrepareHit failed passes through; `allySwitchStopped` tells which ones they are.
- **Trick and Switcheroo** (`swapItems`):
  - first the pipeline: the Protect family, Good as Gold, Prankster + Psychic Terrain, Sticky Hold's TryImmunity, Prankster vs Dark, a Substitute, and Neutralizing Gas's `withGas` before all of them;
  - then `items.swapItems(kernel, w, action, target, move)`, with `target` the Pokémon the move reaches;
  - then the action's Update.
- **Also relied on:**
  - the `adjacentAlly` failure after the ally's Ally Switch;
  - Substitute: `vol.substitute = floor(maxhp/4)` and `endTrap` (U13);
  - Leech Seed's `eot.leechSeed = positionOf(w, user)`;
  - this turn's Wish slot = `positionOf`.

**Track C.**
- On the card's conditions line, merge the `DoublesHP.conditions` facts matching `/^Substitute: (\d+) HP\.$/` into one `Substitute: {min}–{max} HP` (`{min}` alone when equal), with the chances summed.
- `Holds {Item}.`, `Holds no item.` and `Swapped places with {Partner}.` come from the engine as they are.

**Track D.**
- Change the E40-IcicleSpear-OccaBerry and E40-BoosterEnergy cases.
- E22b and E22c need no start rows.
- E03-AromaticMist's target (see the table above).
- For a continuation, `DoublesHit.min` and `max` are the hits that reached the Pokémon (§3.1), not the row's whole-move damage.

**Track B.** A Micle Berry eaten at the end of turn runs AfterUseItem too, so a Symbiosis partner then passes its item. This needs a guard in the end-of-turn phase.

## Needs from the integrator

0. **High: a bug in the frozen part path (`uses-to-ko.ts`), found by E25b.** A draining contact move whose every hit met a Substitute still meets the target's DamagingHit handlers: Rough Skin, Iron Barbs, Rocky Helmet, and the Mummy, Lingering Aroma or Wandering Spirit swap.
   - **Cause:** `emit` calls `hitEnd(group, at, landed = 0, dealt = 0)`, and for a one-hit draining group `hitEnd` returns `group.drained.to(0, 0)`: one `hitStep` with 0 damage, DamagingHit included.
   - **Fix** at `uses-to-ko.ts:723`, in `hitEnd`. 1v1 never reaches `emit` with `landed` 0 for such a group, so golden is unaffected:
     ```ts
     if (group.drained) return group.drained.states[landed ? group.drained.to(0, dealt) : 0];
     ```
   - **Failing test,** for `tests/unit/doubles-substitute.test.ts` once fixed:
     ```ts
     it("a draining contact move into a Substitute meets no Rough Skin (E25b)", () => {
       const kiss = (ability: string) => ready(calculateDoublesTurn(pair({ id: "alcremie", ability: "sweetveil", hp: 60, move: "drainingkiss" },
         idle("garchomp", { ability, ...sub(23) })))).hp["own-left"]!.min;
       expect(kiss("sandveil")).toBe(78);
       expect(kiss("roughskin")).toBe(78); // today 61: Rough Skin's 17
     });
     ```
1. **`tests/unit/doubles-kernel.test.ts` (Step 0's file).** The test "a damaging hit into a Substitute is not estimated; a sound move passes it" expects `Hits on Blastoise's Substitute are not modelled.`, but with Track E the turn is ready. Expect `status: "ready"` and `steps[0].hits[0]` to match `{ kind: "substitute" }` instead.
2. **Delete `REASONS.substituteHit`** (ADDENDUM §8). Nothing uses it now.
3. **A fainted Pokémon keeps its Substitute in the E2 outcome** (`volatiles: ["substitute"]`). Showdown clears volatiles on a faint.
   - **Fix:** one line in `doubles-turn.ts` `faint()`, after `mon.fainted = true;`:
     ```ts
     if (mon.vol.substitute) mon.vol = { ...mon.vol, substitute: undefined };
     ```
   - **Failing case (SV):** Sylveon (Pixilate) uses Hyper Voice into a 1-HP Garchomp with `carried: { substitute: 40 }`. Its outcome has `hp [{ hp: 0 }]` with `volatiles ["substitute"]`; it should have neither `volatiles` nor `substitute`.
4. **Optional: the swap fact before a failure.** `resolveTargets` adds `Ally Switch: {Move} hits {Occupant} in {Chosen}'s place.` before TryMove, so a Sucker Punch that then fails on the new occupant shows both facts (E12 in `doubles-positions.test.ts` pins this). Adding the swap fact only once `moveFailure` passes would read better.
5. **Optional, pre-existing: Air Balloon under Klutz or Magic Room.** The part path pops an Air Balloon without checking that the item works: `uses-to-ko.ts` `afterHit` has `if (def.itemId === "airballoon" && hitAny)`. Adding `&& m.defItemOn` fixes it. `doubles-substitute.ts`'s own faint path already checks.
6. **Optional: a fact text.** `selfFaintFact` lists the target's Rough Skin or Rocky Helmet among the sources for a user that faints from recoil into a Substitute, though they did not act. Only the text is affected.

## Open items

- **Re-run the E cases.** Run `track-e/run-e.ts` again after Track A's Update change and the part-path fix.
- **White Herb and accuracy or evasion drops.** Showdown's White Herb also restores lowered accuracy and evasion, which the engine does not store (Track A). A White Herb tricked onto a Pokémon whose only drop is accuracy or evasion is not seen as used.
- **Shed Tail Substitute against an OHKO move** (rare). When the Substitute is larger than its holder's own quarter, the engine's OHKO damage reads the current HP, while Showdown's reads `maxhp`.
