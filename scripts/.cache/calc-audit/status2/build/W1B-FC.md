# Track FC (wave 1b): field changes and their holders

Branch `calc-2v2-status-2` (checked before the work and before this report). Owner files: `app/lib/battle/doubles-fieldchange.ts`,
`tests/unit/doubles-fieldchange.test.ts`. Spec: ADDENDUM2 §4.3 FC (T2P §5.2-§5.3), §2.3 #45, #53, #54, §2.2 (magicroom, defog).
Ground truth: pinned Showdown `c23d2e94` (`PS/…` = `node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353`).
Nothing was committed, pushed or switched; no frozen file, no other track's file and nothing in `node_modules` or `.claude/` was
edited; no `next build`; nothing against live Supabase.

Build-folder helpers (`status2/build/w1b-fc/`): `probes-1.ts` (Room Service on every pseudo-weather), `cases.ts` (FC's own 14
cases), `run.ts` (V2's T2P-FLD / T2P-ACT, FS08–FS12 and M24i/j run in full, FC's cases: oracle into `w1b-fc/results/`, never V2's
results), `itree.sh` (a scratch copy of `app/lib` with the lines asked below applied), `itest/` + `itest.config.mts` (the unit test
on the scratch tree), `trees.sh` + `app-all.ts` + `diff.mjs` (every stored case's app result with FC's Step 0 stub against FC's
module, the other tracks' work in progress the same in both), `stub/` (the Step 0 stub), `before.config.mts`.

## What FC models

| Hook (caller) | Showdown | Facts |
|---|---|---|
| `beforeFieldMove` (A3 fieldMove) | today's guards (weather/terrain with a holder, Tailwind with Wind Rider / Wind Power, Trick Room with Room Service) gone | — |
| `afterFieldMove(…, before, action?)` (A3 fieldMove) | a weather or terrain change re-settles every holder, then the Update's Booster Energy; Tailwind starting: `sideStarted`; Trick Room or Gravity starting: Room Service. Returns true (I1 folds it into `return done(…) &&`) | the holders' facts after the move's own |
| `changed(kernel, w, before?, source?)` (A1 finish, A3 Defog, S subOnly) | the re-settle (with `before`); without it today's guard | as below |
| `eotField(kernel, w, before?, source?)` (E1/E2) | the re-settle without the Update (Booster Energy waits for the final Update: `itemsAfterField`) | the sink's |
| `stepField(kernel, w, before, action?)` (faint's strong weather; applyStep after I8c) | the re-settle and the Update | on the step (a hit entry where the Pokémon has one) |
| `fainted(kernel, w, slot)` (faint, I8a) | a Cloud Nine / Air Lock holder's End: WeatherChange with a suppressWeather source (Ice Face does not act) | none (no action) |
| `stepEnv(kernel, w, attacker, target, moveId, spread)` (searchFor, I8b) | `UsesEnv.fieldFollowed` with a holder in; not for a spread move, nor a move that can hit more than once (multihit, Beat Up, Parental Bond) into Seed Sower or Sand Spit (the change lands between two hits: the step's own `fieldChange` stop stays) | — |
| `sideStarted(…, source?)` | Tailwind: Wind Rider `boost({atk: 1})` from itself (Contrary/Simple read it; breakable), Wind Power the Charge volatile (`MonState.charged`) | `{Name}'s Wind Rider: +1 Attack.`, `Wind Power: {Name} is charged.` |
| `pseudoWeatherChanged(…, id, source?)` (A3 sport, room; afterFieldMove) | any pseudo-weather starting while Trick Room is up uses each working Room Service (−1 Speed from itself, item gone, Unburden); a removal none (probe RS3: Gravity, Wonder Room, Mud Sport, Echoed Voice, Ion Deluge use it; Magic Room's start does not, the item ignored) | `{Name}'s Room Service is used up under Trick Room: −1 Speed.` |
| `itemsAfterField(…, source?)` (A3 roomEnd; E2's final Update) | Booster Energy (PS/data/items.ts:633-643): a Protosynthesis / Quark Drive holder, its field down, not transformed, its item working: used, then the boost (fromBooster). A no-op otherwise | `{Name}'s Booster Energy is used up: {Ability} boosts its {Stat}.` |
| `settleHolder(…, source?)` (A1's Forecast / Flower Gift Start) | the holder's own WeatherChange handler | as below |

The re-settle (`resettle`): every living Pokémon (not World.ghost) by Speed; for a weather or effective-weather change
Protosynthesis (`isWeather('sunnyday')`: not Harsh Sunshine; getBestStat(false, true) through model.ts paradoxBestStat, Wonder
Room swapping the defensive stages; up already: nothing; field down: removed unless from Booster Energy), Forecast (its own
weather: a working Utility Umbrella takes sun and rain away; a base `castform` world build stands for the form its weather
before gave it, as the engine reads Forecast from the field), Flower Gift (Cherrim-Sunshine in its own sun or Harsh Sunshine),
Ice Face (Eiscue-Noice in hail or snow, not on a Cloud Nine / Air Lock change); for a terrain change Quark Drive, Mimicry (the raw
terrain's type or its base types, through A2's `setTypes`; a holder without world types stands for its terrain's type before),
then its Seed (useItem: `applyBoosts` from itself with `effect: "item"`, the item gone, `noteItemUse`, Unburden). Forms through
`withSpecies` (setSpecies' resets). A breakable ability (Flower Gift, Ice Face, Wind Rider) does not run during a move that
ignores abilities (its user's Mold Breaker, Teravolt, Turboblaze; Mycelium Might on a status move; not the user's own from
generation 8; not behind a working Ability Shield), and ChangeBoost (Contrary, Simple) on a Seed's or Room Service's boost is
suppressed the same way (`breakHolder`). Facts: `{Name}'s {Ability} boosts its {Stat}.`, `{Name}'s {Ability} ends.`,
`Forecast: {Name} becomes Castform-Rainy.`, `Flower Gift: {Name} becomes Cherrim-Sunshine.`, `Ice Face: {Name}'s face is
restored.`, `Mimicry: {Name} becomes Grass type.`, `Mimicry: {Name}'s types return.`, `{Name}'s Grassy Seed is used up on Grassy
Terrain: +1 Defense.` (A3's received-Seed form). The handlers of different Pokémon read and write only their own holder (a
Seed's rise reaches the copiers through D's ledger at AfterMove), so the Speed order orders the facts only.

**fromBooster** (no world field for it): a Paradox Pokémon's Booster Energy cannot be taken, moved or flung (onTakeItem), so it is
gone only once used, and its use always starts the boost. The boost is from it when the start settle used it (the input holds it,
the settle's folded build has none and a boost) or when it was held as the turn started and is gone now. A Booster Energy used
here that the Pokémon did not hold as the turn started (Recycle after the start settle used one with no effect) is not followed
(`REASONS.received`).

## Narrow reasons inside the model (each a fact about a corner; tests or cases pin them)

- `REASONS.fieldChange` stays (ADDENDUM2 §2.4 #45) for: a change between two hits of one move (uses-to-ko.ts's own stop, which
  `stepEnv` leaves on for a spread move and for a repeated hit into Seed Sower / Sand Spit); a caller that does not pass the field
  before the change (today's guard, until its line lands: Defog, A1's finish, S's subOnly, E1/E2's end of turn); a breakable
  holder (Flower Gift, Ice Face) or a Contrary / Simple Seed holder that would act on a change whose active move is unknown
  (a faint: Cloud Nine's End, a strong weather ending) while a Mold Breaker, Teravolt, Turboblaze or Mycelium Might holder is in
  (the KO-er's move may suppress it; faint has no action). Justification: the active move is not known at faint, and the
  combination needs Cherrim or Eiscue-Noice beside a weather negator or strong weather and a breaker.
- `REASONS.received` for the Recycle corner above.

## Verification

- **Real tree** (no asked line): `run.ts` — T2P-FLD-01, -04 … -08, -11, T2P-ACT-01 … -05, FS08a–d, FS09–FS12 agree in their
  numbers and E2 state; the others need the lines below. `diff.mjs` over all 2308 stored and V2 cases, stub against FC: only the
  13 T2P cases change (0 stored cases).
- **Scratch tree** (`itree.sh`: I1–I8 and E2's E1–E3): 50 cases, **every number and E2 state agrees** with pinned Showdown:
  T2P-FLD-01 … -11 (02/02b/02c re-run after V2 changed the Ice Spinner user to Cetitan), T2P-ACT-01 … -05, FS08e-sv and M24i/M24j
  run in full (now ready, both agree), FS08–FS12, FC-STP-01/02, FC-QDS-01, FC-PSY-01, FC-CNT-01/02, FC-MLD-01/02/03, FC-CLD-01/02/03,
  FC-MRB-01, FC-DEF-01. The 9 remaining mismatches are all compare.ts's effect attribution: a Seed's, Room Service's or Wind Rider's
  boost on a Pokémon the field move did not reach is a step fact naming it, which `compareEffects` reads only from hit entries
  (V2's ask below). `diff.mjs` stub against the scratch tree: FS08e-sv, M24i, M24j and the T2P cases change (all agree).
- **Unit**: `tests/unit/doubles-fieldchange.test.ts` 24 tests: real tree 19 pass + 5 skipped (gated on the asked lines); on the
  scratch tree (`itest.config.mts`) 24/24. The Room Service test under Trick Room and Magic Room (no oracle case: the harness
  cannot hold Room Service unused under Trick Room) is pinned by probe RS4 (`probes-1.ts RS4`). `tsc` and `eslint` clean for both files. `tests/source/status2-hooks.test.ts` passes.
- Tests that pin the old behaviour (frozen files, the integrator's at 1b): `doubles-turn-guards.test.ts` "a weather, terrain,
  Tailwind or Trick Room change…" (all three inputs are ready now) and, after I8, "a Max Move's terrain changing a third Pokémon's
  Mimicry or Electric Seed (M24i, M24j)" (ready, oracle-agreed); `doubles-field-side-items.test.ts` A3-MR-06 (ready: the Booster
  Energy is used; FC's test "A3-MR-06's scenario" pins it). The other failures in those files at the time of the run were other
  tracks' (PR, CL, ST, E2, K: checked against the stub tree).

## Asked of the integrator (frozen files; each verified on `itree.sh`'s copy)

- **I1** `doubles-field.ts` fieldMove, 5 sites: each `fieldChangeHooks.afterFieldMove(kernel, w, slot, move, before);` with the
  `return done(X);` after it becomes `return done(X) && fieldChangeHooks.afterFieldMove(kernel, w, slot, move, before, action);`
  (facts, after the move's own). Script: `w1b-fc/i1.mjs`.
- **I2** `doubles-field.ts` defog: `fieldChangeHooks.changed(kernel, w);` → `fieldChangeHooks.changed(kernel, w, { weather: w.field.weather, terrain }, use);` (FS08e-sv, FC-DEF-01).
- **I3** `doubles-field.ts` sport, room: `fieldChangeHooks.pseudoWeatherChanged(kernel, w, use.move.id);` → `…(kernel, w, use.move.id, use);` (2 sites).
- **I4** `doubles-field.ts` roomEnd: `fieldChangeHooks.itemsAfterField(kernel, world, slot)` → `…(kernel, world, slot, use)`.
- **I5** `doubles-abilities.ts` finish: `fieldChangeHooks.changed(kernel, w);` → `fieldChangeHooks.changed(kernel, w, c.field, c.use);`.
- **I6** `doubles-abilities.ts` abilityStartIn: `fieldChangeHooks.settleHolder(kernel, w, slot)` → `…(kernel, w, slot, c.use)`.
- **I7** `doubles-substitute.ts` subOnly: `fieldChangeHooks.changed(kernel, w);` → `fieldChangeHooks.changed(kernel, w, { weather: weather0, terrain: terrain0 }, action);`.
- **I8a** `doubles-turn.ts` faint: `fieldChangeHooks.fainted(kernelOf(ctx), w, slot);` before `const keeper = STRONG_WEATHERS[w.field.weather];` (FC-CLD-01/02/03, T2P-FLD-09's E2).
  **This fixes a silent wrong number in today's tree:** a Cloud Nine or Air Lock holder fainting under sun leaves a Protosynthesis
  holder unboosted (FC-CLD-01-sv: 44 mismatches on the real tree, Great Tusk's Headlong Rush 120–142 against Showdown's 156–184),
  and Cherrim's form (FC-CLD-03-swsh E2). No stored case has it (diff.mjs).
- **I8b** `doubles-turn.ts` searchFor: the `Object.assign(extra, …)` line gains `, fieldChangeHooks.stepEnv(kernel, w, attacker, target, moveId, spread)`.
- **I8c** `doubles-turn.ts` applyStep, after `next.field = { …, terrain: outcome.conditions.terrain };`:
  `if (next.field.weather !== w.field.weather || next.field.terrain !== w.field.terrain) fieldChangeHooks.stepField(kernel, next, w.field, action);`
  (I8b and I8c together: T2P-FLD-02/02b/02c/10, FC-STP-01/02, M24i/j.)
- **I9** `doubles-actions.ts`: REASONS `activates` and `boosterAfterRoom` have no caller left; `roomservice` leaves EVENT_THIRD_PARTY.
- **I10** `classify-a3.md`: `magicroom` and `defog` to M; regenerate `status-table.ts` (ADDENDUM2 §2.2).
- **I11** tests: the three rows above updated to ready; `status2-hooks.test.ts` CALLS gains `fieldChangeHooks.fainted(` (before
  `fieldChangeHooks.stepField(`) in doubles-turn.ts faint, `fieldChangeHooks.stepEnv(` in searchFor, `fieldChangeHooks.stepField(`
  in applyStep.

## Asked of other tracks

- **E2** (`doubles-eot.ts`): resolveFaints `fieldChangeHooks.eotField(kernel, w)` → `…(kernel, w, { weather, terrain: w.field.terrain })`;
  weatherHandler: `p.facts.add(\`… ends.\`)` before the call, which becomes `fieldChangeHooks.eotField(kernel, w, { weather, terrain:
  w.field.terrain }, { fact: (_x, _slot, text) => p.facts.add(text) })`; updateSlot after the Mental Herb line:
  `if (item === "boosterenergy") return fieldChangeHooks.itemsAfterField(kernel, w, slot, { fact: … });` (T2P-FLD-03); your terrain
  end at 27.7 calls `eotField` with the terrain before. (Your lateItemActs / receiveAtResidual read `!build.abilityActive` for a
  Booster Energy's due; the boost is `build.settledBoostedStat`.)
- **V2**: `compare.ts compareEffects`: for a target with no hit entry in the action's step, also count the step facts that begin
  with that Pokémon's name (`{Name}'s `, `{Name}: `, `{Name} `, the app's turnNames), as aboutSlot writes them (9 cases above).
  T2P-FLD-02c is right now (Electric Surge at the lead). FC's 14 cases in `w1b-fc/cases.ts` are yours to take.
- **PR** (Echoed Voice's pseudo-weather at its TryMove) and the owner of Ion Deluge: call
  `fieldChangeHooks.pseudoWeatherChanged(kernel, w, id, use)` when they add it (Room Service under Trick Room: probe RS3).
- **Observation (no owner in 1b):** a Utility Umbrella given to or taken from Castform or Cherrim in sun or rain mid-turn runs
  WeatherChange for its holder (PS/data/items.ts utilityumbrella onStart / onEnd); no item-change hook reaches FC, so E2's species
  for that holder is the old form (the calculations read Forecast and Flower Gift from the item: types and boosts stay right).
  No game's catalog has Castform or Cherrim with Utility Umbrella but SwSh's Cherrim.
- **T2 / E2** (observation): a Booster Energy used this turn leaves `itemId ""` with `settledBoostedStat`; a next-turn input built
  from that outcome loses the boost once its field is down (the settle reads Booster Energy only from a held one,
  calculate.ts:1039).
