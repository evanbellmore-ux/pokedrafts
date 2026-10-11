# Wave 1a, Track E1: the end of turn (SPEC2 §4.6)

Branch `calc-2v2-status-2` (checked before and after the work). Files changed: `app/lib/battle/doubles-eot.ts`,
`app/lib/battle/residuals.ts`, `tests/unit/doubles-eot.test.ts`, `tests/unit/residuals.test.ts`. Build folder (this one):
`e1-probes.ts` (+ `.out`), `e1-stored.ts` (+ `.out`), `e1-residuals-classes.test.ts` with `e1-source.config.mts` (the
integrator's source-test change, verified), this file. Nothing else was edited.

## What the end of turn now models (pinned Showdown c23d2e94)

| Order | Handler | Rule | Source |
|---|---|---|---|
| 11 | Nightmare (`nightmareHandler`, residuals.ts `nightmare`) | `damage(baseMaxhp / 4)` (truncated, at least 1); Magic Guard none; only while asleep or Comatose, otherwise the volatile has ended (cureStatus) and goes silently. The eot's own cureStatus (Healer, Hydration, Shed Skin, curing Berries) now also ends it. | PS/data/moves.ts:12697-12720, sim/pokemon.ts cureStatus |
| 14 | Octolock (`octolockHandler`) | source gone, fainted or switched in this turn (`activeTurns` 0): ends silently; else `boost({def: −1, spd: −1})` from the source with the move as effect: Clear Body and kin, Mirror Armor back onto the source, Mist (A3's hook), Defiant/Competitive per stat, D's ledger. Ties with Syrup Bomb by Speed (one holder: a tie group). | PS/data/moves.ts:12961-12990 |
| 19, 20, 21 | Telekinesis, Heal Block, Embargo (`countdown`) | turns left −1; at 0 the volatile ends (residual line "{X} ends", no HP): grounded again for the Orbs' Misty Terrain at 28.3; heals and the final Update's HP Berries act; Embargo clears `build.itemSuppressed` so Sticky Barb, the Orbs, White Herb, Mirror Herb, Eject Pack, Micle and the final Update act (item handlers are collected whatever ignoringItem says, as sim/battle.ts does). A Heal Block with no turns given does not count down. Psychic Noise now writes `healBlockLeft: 2` (durationCallback). | sim/battle.ts:511-521 fieldEvent, PS/data/moves.ts healblock/embargo/telekinesis conditions |
| 28.2 | Harvest (`harvestHandler`) | holder with HP and no item, its lastItem a Berry: in sun or Harsh Sunshine (not suppressed) certain, else 1/2; setItem, lastItem ""; a failed 1/2 keeps lastItem (E2). lastItem: the world's (item history), else the input's (`null`: none), else unknown → `Harvest needs {Name}'s item from an earlier turn.` (Q4). Relying on the sun from before: the weather's `Assumes … does not end this turn.` | PS/data/abilities.ts harvest |
| 28.2 | Pickup (`pickupHandler`, `receiveAtResidual`) | holder with no item: the other living Pokémon with usedItem and lastItem (earlierThisTurn included, C19), 1/k; the candidate's lastItem cleared; the new item's Start: a Seed in its terrain and Room Service under Trick Room used at once (boost, item gone, item history, Unburden; Symbiosis: D's guard), White Herb with a lowered stage; Booster Energy for an unboosted Protosynthesis/Quark Drive holder keeps `REASONS.received`. C19 fact `Assumes {Name} used no item earlier this turn.` | PS/data/abilities.ts pickup; sim/pokemon.ts setItem/useItem |
| 29 | Opportunist (7), Mirror Herb (8) (`copyHandler`) | apply `MonState.copy` (D's ledger accumulates it at every boost() of a foe, the end of turn's included); Mirror Herb boosts while held, then is used (item history, Unburden). The copy's own boost is taken back from the other Pokémon's pending copies (onFoeAfterBoost skips effect Opportunist/Mirror Herb). Residual "copies +4 Attack." | PS/data/abilities.ts opportunist, PS/data/items.ts mirrorherb |
| 29 | White Herb | also accuracy and evasion (`vol.stages`); the end of turn's boosts pass A1's `herb: false`, so White Herb acts at 29, not at the drop (Octolock at 14 into a White Herb holder: the herb's line is at 29, as pinned). | PS/data/items.ts whiteherb |
| final Update | Berries | every Berry through `kernel.ateBerry`: Lansat's `settledFocusEnergy`, Starf's one world per stat in every walk (the E2 guard is gone; facts "Attack +2." per stat at 1/k); Mental Herb against attraction, Taunt, Encore, Disable, Heal Block (reachable once Embargo ends or after Pickup). A rise there stays in a copier's `MonState.copy` → E2 `pendingCopy` and the card's `Opportunist: copies +1 Attack next turn.` (A11). | PS/data/items.ts |
| 8 | Leech Seed into a heal-blocked seeder with Liquid Ooze | TryHeal's handlers in speedSort order: the seeded faster → Liquid Ooze deals the drain; otherwise Heal Block stops both. **At one Speed Heal Block goes first** (a volatile's subOrder 2 before an ability's 7; sim/battle.ts resolvePriority, comparePriority) — not a 1/2 tie: E1-LOZ-tie (oracle: Venusaur 60, no Ooze). | PS/data/moves.ts leechseed, PS/data/abilities.ts liquidooze |

Also: Speed Boost does not act on a Pokémon that switched in this turn (`activeTurns` 0: E1-SPB-01); the residual reads the
world types (`kernel.typesIn`: set and added types, Roost; byte-equal without them); `roomFact` is silent for a Magic Room set
this turn (`fieldSet`); E2 volatiles gain `nightmare`, `octolock`, `telekinesis`, `embargo`; card conditions `Nightmare.`,
`Octolock.`, `Telekinesis.`, `Embargo.`.

**Statistics:** a Berry a Harvest or Pickup holder ate earlier in this end of turn and eats again (RT-RV21: the Sitrus at the
sand's Update, Harvest, the final Update) is one residual per path as the oracle sums it (`Recorder.again`, with a
recording-walk-only mark `EotMon.eotAte` dropped before the phase returns): Sitrus 42..84 at chance 1.

**Fallback:** with no item history in the turn (`kernel.tracksItems` false) Harvest and Pickup keep today's guards; D's
`tracksItems` is true with a Harvest or Pickup holder, so they are modelled.

## Verification

- `e1-probes.ts` (30 cases, each against `oracle()` and `compareCase()`; Harvest/Pickup with D's `tracksItems` on disk):
  29 agree. E1-MH-01 (a taunted Mental Herb holder under Embargo) is rejected by the input check `Mental Herb would have cured
  it.` (doubles-turn.ts:3329, integrator item 4); its mechanics are covered by E1-MH-02 (via Pickup), which agrees.
- Stored oracle results (V1): CQ-ETT-03-sv/-swsh, CQ-ALY-01-sv/-champions, CR-05-champions/-swsh, CR-09a/b-sv,
  CR-09a-champions, CR-11a/b-usum, CR-01c-sv, CR-02c-usum match. **CR-01a/b-sv, CR-02a/b-usum** fail before the end of turn:
  the start settle eats the Sitrus at 100/235 under the carried Heal Block / Embargo (start 158; integrator item 3). The end
  of turn's part is pinned by E1-HB-01..03 and E1-EM-01..04 (130 HP, sand to 116), which agree.
- `e1-stored.ts`: the stored cases whose end-of-turn reason goes (Harvest, Pickup), re-run in the oracle without it:
  ER41b, RT-RV21, RT-RV22, VT-VE07, VT-VE10, VT-VE11, VT-VE18 agree; ER41c now gives `Harvest needs Exeggutor's item from an
  earlier turn.` (its input has no lastItem: Q4's Unknown default).
- Tests: `tests/unit/doubles-eot.test.ts` (58) and `tests/unit/residuals.test.ts` (12) pass; the existing EOT-2 test's
  RV21/RV22 now assert the modelled numbers (pinned 80/122 and 75 → 103). `doubles-turn-perf`, `doubles-turn-reference`,
  `doubles-outcomes` (but one count: another track's turn), `training-bridge`, `training-status2-step1`, `calculator-doubles-ui`,
  `calculator-doubles-prep` pass. tsc and eslint clean on my files.

## For the integrator (exact)

1. `tests/source/doubles-residuals.test.ts` CLASSES (verified: `npx vitest run --config scripts/.cache/calc-audit/status2/build/e1-source.config.mts`):
   - `"move:nightmare:onResidual": { modelled: "nightmare" }, "move:octolock:onResidual": { modelled: "octolock" }` (Uproar stays guarded);
   - the state list loses `"telekinesis", "healblock", "embargo"` and gains
     `...Object.fromEntries(["telekinesis", "healblock", "embargo"].map((id) => [\`move:${id}:onResidual\`, { modelled: id }])),`;
   - `"ability:harvest:onResidual": { modelled: "harvest" }, "ability:pickup:onResidual": { modelled: "pickup" }`;
   - `"ability:opportunist:onResidual": { modelled: "opportunist" }, "item:mirrorherb:onResidual": { modelled: "mirrorherb" }`.
2. `tests/source/status2-hooks.test.ts` MOVED: delete `["doubles-guards.ts", "copierEndOfTurn", "doubles-eot.ts", "afterChecks", "guardHooks.copierEndOfTurn("]`
   (the copies are modelled at 29; D's `copierEndOfTurn` has no caller).
3. `app/lib/battle/doubles-start.ts settleDoublesStart`, the last loop (CR-01a/b-sv, CR-02a/b-usum): a carried Embargo ignores
   the item at the turn's first Update and a carried Heal Block fails an HP Berry's TryEatItem:
   ```ts
   const carried = input.pokemon[slot]!.carried;
   const held = entered[slot].itemId;
   const embargoed = carried?.embargo !== undefined;
   const blocked = carried?.healBlock !== undefined && HEALING_BERRIES.has(held);   // import from ./hit-loop
   const settling = embargoed ? { ...entered[slot], itemSuppressed: true as const } : blocked ? { ...entered[slot], itemId: "" } : entered[slot];
   const settled = settleItems(settling, entered[reps[slot]] ?? entered[slot], field, runtime, { label: labels[slot] }, names[slot], ownCure);
   const items = blocked ? { ...settled, build: { ...settled.build, itemId: held } } : settled;
   …
   const itemOn = !field.magicRoom && !klutzActive(build, build) && !embargoed;
   ```
4. `app/lib/battle/doubles-turn.ts:3329`: `const mentalHerb = … && build.abilityId !== "klutz" && carried.embargo === undefined;`
   (an embargoed herb cannot have cured it; it acts at the final Update once Embargo ends: E1-MH-01).
5. Optional: `TurnKernel.applyBoosts`'s `opts` type gains `herb?: false` (A1's option, already passed through), so
   doubles-eot.ts `eotBoost` can drop its cast.

## Notes for other tracks

- **D:** E1 relies on `noteRise` accumulating each living foe copier's `MonState.copy` at every boost() (as doubles-guards.ts
  does now, including the end of turn's), and on `tracksItems` being true with a Harvest or Pickup holder (as now). If D
  later applies copies through its own exclusion (`copying`), an export such as `applyingCopy(run)` would let E1 drop its
  restore of the other pending copies.
- **A1:** E1 passes `herb: false` to applyBoosts for every end-of-turn boost (White Herb at 29).
- **A3:** Pickup's item Start is E1's `receiveAtResidual` (Seeds, Room Service, White Herb; Booster Energy's reason). If A3's
  `receive` is exported for a residual (no action), E2 can switch to it.
- **V1:** store the re-run results of ER41b, RT-RV21, RT-RV22, VT-VE07, VT-VE10, VT-VE11, VT-VE18 (now ready) and ER41c
  (`endNotEstimated: "Harvest needs Exeggutor's item from an earlier turn."`); the G4 end-of-turn and F2 residual cases can
  start from e1-probes.ts's scenarios. compare.ts's per-path residual sums hold (E1 sums a re-eaten Berry per path).
- **T1:** E2 now reports `turnsLeft` for Heal Block (Psychic Noise: 1 after the turn), Embargo and Telekinesis after the
  countdown, `pendingCopy` after a final-Update rise, `lastItem` kept by a failed Harvest.
