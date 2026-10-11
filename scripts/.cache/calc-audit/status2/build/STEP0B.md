# Step 0b: the shared calculation plumbing (status2)

SPEC2 §8.1 row 0b, SPEC2 §3.6 and ADDENDUM2 §3.6 (0b.1 SPEC2's; 0b.2 tier2-moves §2.3–§2.5; 0b.3 tier2-presence §9.4–§9.5,
inputs §4.4 and the move of `settleDoublesStart` into `doubles-start.ts`). Every reader is keyed on a field that no stored input,
no Step 0a world and no 1v1 path sets, so the gates below are byte-equal; each field's numbers are pinned Showdown c23d2e94's,
reproduced by the unit tests from the probes in this folder.

## Status

Done. Every field of SPEC2 §3.6 and ADDENDUM2 §3.6 is read by the calculation, the turn step and the validation; every probe
of SPEC2 §3.6, tier2-moves §2.3, tier2-presence §9.4 and inputs §4.4 is reproduced against the pinned simulator; every gate is
green (last section). Nothing was committed or pushed; no branch was switched; `.claude/` and `node_modules` untouched.

## Files

| File | What changed |
|---|---|
| `app/lib/battle/calculate.ts` | makePokemon's world types (`types`, `addedType`; Tera stays the engine's), `storedStats`, `weighthg` (own form only) and markers (non-enumerable, kept by `clone()`); `calculate()` opens `withTurnMarks` from the defender's markers and the row's scope (`rowScope`: Helping Hands, `powerMods`, the Sports, an Electrify-kept -ate boost, hidden stages; a Bounce target's Gust ×2); `calculateMove` opens the scope (`rowScopeFor`, null in 1v1); `calculateMoveRow`: Lucky Chant, `helpingHands`, `basePower`, Spit Up's layers, `retypeTo`, `forceStab`, `switching`, the three retype paths, Mat Block's `protectName`, `allyTarget`, the pinned and floating defender, `laterHit` for Ripen's first-hit-only ×0.5; `critRatio` (`critBoost`, `laserFocus`); `usedPriority` (`frozenPriority`); `itemOff` / `itemIgnored` (Embargo) at the Magic Room and Klutz sites; `settleAbilities` / `settleItems` `reads?: SettleReads`; `turnSpeed`'s swamp (`swampSpeed`); `settleDoublesStart` moved out (type re-export only) and the helpers it needs exported. |
| `app/lib/battle/engine-corrections.cjs` | `setTurnMarks` / `turnMarksOf` (the markers on an engine Pokémon) and `withTurnMarks(marks, run)`: the wrapped `getMoveEffectiveness` (an added third type at the first-type call, Tar Shot's +1, Miracle Eye, a pinned Flying type), `isGrounded` (`ungrounded`, `pinned`, `floating`), `checkItem` (`itemSuppressed`), `chainMods` (the final chain only: `takenMods` ×2 entries every hit, Ripen's 2048 on the first) and `countBoosts` (`extraBoosts`). |
| `app/lib/battle/model.ts` | `getBuildStats`: `{ hp, ...storedStats }` (a transformed build's HP from its own species); `validateBuild`: the world-state issues and `abilityChanged`; `validateConditions`: the 2v2-only side and field keys. |
| `app/lib/battle/uses-to-ko.ts` | `UsesEnv` (`allies`, `mist`, `report`, `focusBand`, `betweenHits`, `koRetaliation`, `veil`, `safeguard`, `spreadUser`, `fieldFollowed`), `TurnStepOutcome` (`rises`, `used`, `dealt`, `starf`, `stopAt`, `reactions`, `attackerFaintedInHits`, `lastHit`), `TurnStepPart` (`fresh`, `dealt`); `attItemOn` / `defItemOn` read `itemSuppressed`; `boost()` (`allies`, Flower Veil, Mist, `report.rises`); `types`, `grounded` and the exported `turnEffectiveness` read the build's world types and markers; `toBuild` through `withSpecies` on a form change; Starf with `report.starf` marks the outcome; the search's per-roll loop is HEAD's (the plain path) unless the step asks for the Focus Band, a Berry between hits or the last hit. All turn mode only. |
| `app/lib/battle/hit-loop.ts` | `HitLoopInput.koRetaliation` (Aftermath, Innards Out on the knocking hit) and `TurnUnnerve.endsOnKO` (the hit's Update with the target's Unnerve gone). |
| `app/lib/battle/mechanics.ts` | `buildTypes(build, runtime)`: a Tera type, else the world types and the added type. |
| `app/lib/battle/doubles-targets.ts`, `intimidate.ts` | Curse's target and Intimidate's type checks through `buildTypes`. |
| `app/lib/battle/doubles-start.ts` (new) | `settleDoublesStart` (verbatim, with `UNNERVE_ABILITIES`, `WEATHER_NEGATORS` and the types `DoublesStartSlot`, `DoublesGas`, `DoublesSettle`), and the two hooks: `variants(kernel, settle)` (the stub: one settle at weight 1) and `custapGuard(kernel, w, slot)` (presenceGuards' Custap line, verbatim). |
| `app/lib/battle/doubles-turn.ts` (0a's; integration lines only) | `settleDoublesStart` imported from `./doubles-start`; `startHooks = { ...startNs }`; presenceGuards' Custap line is `startHooks.custapGuard(kernel, w, slot)`; `rootWorlds` takes `startHooks.variants` (one variant at weight 1 is today's `rootWorldsOf`, the old body); searchFor's step environment is typed `UsesEnv` (the `Parameters<typeof prepareUses>[5]` cast is gone). |
| `app/lib/battle/doubles-items.ts`, `tests/unit/doubles-names.test.ts` | `settleDoublesStart` from `./doubles-start`. |
| `tests/source/status2-hooks.test.ts` | MOVED rows for `settleDoublesStart`, `custapGuard`, `variants`; CALLS `rootWorlds` → `startHooks.variants(`, `rootWorldsOf(`; `rootWorldsOf` keeps `proteanUsed`, `rootActions`; PRESENCE_ORDER's Custap entry is `startHooks.custapGuard(`; `doubles-start.ts` joins HOOK_MODULES (no runtime import of the kernel). |
| `tests/unit/status2-plumbing.test.ts` (new) | SPEC2 §3.6's probes and the validation, 12 tests. |
| `tests/unit/status2-plumbing-t2.test.ts` (new) | tier2-moves §2.3's list, tier2-presence §9.4–§9.5's, inputs §4.4's, 22 tests. |
| `scripts/.cache/calc-audit/status2/build/step0b-probes.ts`, `step0b-step-probes.ts` (new) | The probes: each scenario on the pinned simulator (`design/guards-sim.ts`) beside the app's calculation or turn step. |
| `scripts/.cache/calc-audit/status2/build/step0b-moves-bench.ts` (new) | The moves pane in one process (first, minimum and median pass), for A/B runs against a tree through `TSX_TSCONFIG_PATH`. |

## Contract notes for the tracks

- **The 2v2 build's fields** reach the engine through `makePokemon` only when the build keeps its form (`speciesId` its own):
  `withSpecies` (doubles-world.ts) drops them, and so do `toBuild` and the calculation for another form (Stance Change's
  Blade Forme reads its own stats). `types` win over Mimicry; Tera stays the engine's `teraType`, so a Terastallized build's
  `types` change nothing (buildTypes reads the Tera type first).
- **Markers** (`takenMods`, `tarShot`, `revealed`, `grounding`, `itemSuppressed`) sit on the engine Pokémon, so every engine run
  of the row reads them, Parental Bond's second strike and Beat Up's later strikes included (they set `laterHit`: Ripen's
  weakened Berry ×0.5 is the first hit's only). `grounding: "floating"` makes a Ground move other than Thousand Arrows a zero row,
  `Earthquake has no effect: the target is not grounded.` (the 2v2 fact reads `{Move} has no effect on {Name}.`), unless Gravity or
  a working Iron Ball. `"pinned"` grounds through the Flying type, Levitate, Eelevate and Air Balloon (stand-ins Run Away and
  Leftovers, neither with a damage effect).
- **The row's scope** (`rowScopeFor`): built only from `helpingHands`, a non-empty `powerMods`, `mudSport` / `waterSport`,
  `hiddenStages` (Stored Power, Power Trip, Punishment; not a Z-Move or Max Move) and `retype`. A scoped row clears
  `trace.engine`, so a later use recalculates it whole (an engine-only rerun would not open the scope). `powerMods` entries
  carry the line `{Move}: {factor}x power this turn.`; two Helping Hands `Helping Hand twice: 2.25x power.` (9216), three
  `Helping Hand three times: 3.375x power.` (13824), with the side's `helpingHand` flag off for that row.
- **HISTORY_MOVES answered** (`historyAnswered`): Spit Up with `stockpile`, Pursuit with `switching: false`, Present, Magnitude,
  Fury Cutter, Rollout, Ice Ball, Echoed Voice and Trump Card with `basePower`, and Retaliate with `powerMods` given (`[8192]`
  after an ally fainted last turn, `[]` otherwise: the convention PR should keep).
- **Retype** (`MoveContext.retype`; `retypeTo` wins): `retypePlan` picks one path. A plain move: the user's ModifyType chain
  (`modifyTypeChain`: Normalize at priority 1, then an -ate ability on a Normal move or Liquid Voice on a sound move; none on a
  damaging Z-Move or a Terastallized Tera Blast; a Max Move ignores the noModifyType list) gives the type before Electrify;
  Electrify makes it Electric, Ion Deluge only a Normal one; the move is then the engine's own with `type: "Electric"`, the user's
  type-changing ability Run Away in every run and its 4915 kept in the scope with the line `{Ability}: 1.2x power (the move is
  Electric type).` (none for Liquid Voice or a Max Move). A Galvanize move is Electric already: untouched. A Max Move is picked
  from Electric (Max Lightning, or the Electric G-Max move), no -ate boost. A Z-Move is rebuilt by its own name as Electric with
  its Z power and category, keeping its name (`Breakneck Blitz` under Ion Deluge: `zRetyped` skips `usedMoveName`'s rename). An
  own-type move (Weather Ball, Terrain Pulse, Judgment, Multi-Attack, Techno Blast, Revelation Dance, Natural Gift, Hidden
  Power, Aura Wheel, Raging Bull, Ivy Cudgel, a Terastallized Tera Blast, Terapagos-Stellar's Tera Starstorm) is probed
  unretyped into a typeless stand-in target (no immunity cuts its power short), and, when Electrify or a Normal type at use
  applies, rebuilt as the carrier `"{Move} (type and power at use)"` with the move's data, Electric, the power, category and
  target it had; Raging Bull's run has the screens off. An own-type move as a Max Move under either: `{Move} as a Max Move
  under Electrify is not estimated.` (Ion Deluge likewise).
- **Lucky Chant**: the field's critical hit, a certain ratio, `willCrit` and Merciless (stand-in) are all off; the row says
  `Lucky Chant: no critical hit.` only when it stopped one. **Laser Focus**: ratio at least 5; **G-Max Chi Strike**: `critBoost`
  added to the stage (certain at 3+ through `certainCrit`).
- **Mat Block**: `protectName` names the protection in protectOutcome's four lines and the blocked row (`{Name} blocks {Move}.`),
  and skips the Max Guard guard.
- **allyTarget** with a used priority above 0: the target's own Dazzling, Queenly Majesty and Armor Tail are Run Away and the
  target carries `ungrounded` on Psychic Terrain (no defender-grounded read but Psychic Terrain's applies to a priority move).
- **SettleReads** (`reads?`, the last parameter of `settleAbilities` and `settleItems`): `weatherNegated` (the name of a working
  Cloud Nine or Air Lock, or null) replaces the Ice Face, Forecast, paradox and Booster Energy reads; `unnerved` the Berries';
  `fieldSetter` (an ability id or null) the paradox field setter's; `traceSource: { build, name }` the Trace source and its
  name in the line. Absent, each read is today's.
- **The turn step's environment** (`UsesEnv`, read only with `turn: true`): `focusBand` branches each knocking hit 9/10 knocked,
  1/10 left at 1 HP, after Endure, False Swipe, Sturdy and Focus Sash, in every mode, the Band kept; `betweenHits` sends the
  mass at or under the target's Berry line after a hit before the last to an outcome with `stopAt` (the Berry still held, the
  target's per-hit effects of those hits applied, none of the user's per-use effects: its self stages after the move, Throat
  Spray, Life Orb, recoil, Shell Bell, White Herb, Magician, Pickpocket, Kee and Maranga, Anger Shell, Charge's end), and the
  kernel continues with `TurnStepPart { caseIndex, skip }` (a random hit count with `betweenHits`: `A Berry between the hits of a
  random hit count is not followed in 2v2.`); `fresh` reads the continuation's hits as the case's first ones (constant power:
  Triple Kick and Triple Axel give `{Move}: hits of different power after a Substitute are not modelled in 2v2.`); `dealt` adds
  the stopped part's damage to the continuation's Shell Bell total; `koRetaliation` reaches hit-loop's knocking hit and makes
  the step follow the attacker's HP (`attackerFaintedInHits` when it faints in the hits); `veil` ("flowerveil": the target's
  drops and statuses fail; "pastelveil": poison fails); `safeguard` (the move's statuses fail); `spreadUser` lists the target's
  stage reactions on the user (Gooey, Tangling Hair) in `reactions`, in hit order, unapplied (the attacker's HP in a spread step
  is the kernel's: `retaliation()`); `fieldFollowed` turns `staleField` off after the move's last hit; `mist` drops a drop from
  the other battler after Mirror Armor and Flower Veil (an Infiltrator's move goes through); `allies` keeps Defiant,
  Competitive, Opportunist and Mirror Herb off; `report` asks each outcome for `rises` (no copy then), `used` (an item gone
  that neither moved to the other battler nor was taken by Knock Off, Thief, Covet, Bug Bite, Pluck, Incinerate or Corrosive
  Gas), `dealt`, `starf` (the attacker's Starf: `starf: "att"` instead of STARF_REASON) and `lastHit` (`{ damage, category }`).
  An outcome's reported parts are its state's `report`, which the node keys read only when present, so outcomes split by them
  and every other key is today's.
- **`turnEffectiveness(gen, result)`** (exported): the move's effectiveness on the calculation's defender with the markers, for
  Enigma Berry, Weakness Policy and the kernel's facts.
- **`doubles-start.ts`**: `variants(kernel, settle)` returns `{ weight, settle }[]` (weights summing to 1); `rootWorlds` gives each
  variant's root worlds at its weight (one variant at weight 1 is today's path, no clone). `custapGuard(kernel, w, slot)` is
  presenceGuards' Custap line. Both are S's to fill.

## Decisions and deviations

- **Sky Drop's Gust ×2 (ADDENDUM2 §3.6, C21, CQ08b).** The design reads `PS/data/moves.ts` skydrop `onAnyBasePower` as "×2 at
  either Pokémon". The handler's `target` is the BasePower event's target, which `runEvent('BasePower', source, target, …)` makes
  the **attacker** (`sim/battle.ts` runEvent: `args = [relayVar, target, source, effect]`): it doubles a Gust or Twister used by
  the Sky Drop user or the lifted Pokémon (the user into its lifted target exempt), never one into them. CQ08b's 14 (175 → 161)
  is the unboosted hit: the app gives 14–17 with `takenMods.hidden: "skydrop"`, Showdown 14–17 at the lowest and highest rolls
  (step0b-probes.ts CQ08b). So a `skydrop` defender adds nothing, Bounce's ×2 (`onSourceBasePower`: the defender) stays
  (T2-SI05 22–27), and the unit test asserts the unboosted row. H should model Sky Drop's ×2 on the pair's own Gust if it ever
  arises (the lifted Pokémon cannot move; the Sky Drop user is charging).
- **The swamp** is not `withSpeedMods`: `getFinalSpeed` calls util.js's `chainMods` by its local binding, which no wrapper
  reaches, so `turnSpeed` uses `swampSpeed`, the engine's function line for line with the 1024 in its chain (every other speed
  modifier is a multiple of 4 in 4096ths, so the chain divides exactly). `withSpeedMods` and the wrapper's speed state are gone.
- **No value re-export of `settleDoublesStart` from calculate.ts**: doubles-start.ts imports calculate.ts at runtime, so a value
  re-export would be a runtime cycle (tests/source/status2-hooks.test.ts rejects it). The three importers take it from
  `./doubles-start`; calculate.ts re-exports its types only.
- `SettleReads.weatherNegated` is the negator's name or null (tier2-presence §4.2 says boolean): the settle's Booster Energy line
  names it. `traceSource` carries the name for the same reason.
- `UsesEnv.veil` is `"flowerveil" | "pastelveil"` (tier2-moves §2.4 gives the effect, not the shape); `report` gains `lastHit`
  (tier2-presence §9.4).
- `report.lastHit` widens the step's layer key by a 4096 slot only while it is asked for (the dealt damage's slot is 16777216
  then, else 4096: every other key is today's).
- The 0a source test rows are updated as the test asks ("a track that moves a call updates its row here").

## Probes (pinned Showdown c23d2e94, the app beside it; lowest–highest roll)

`npx --no-install tsx scripts/.cache/calc-audit/status2/build/step0b-probes.ts` (every line `OK`, then `every probe agrees`):

| Id | Scenario | Showdown | App |
|---|---|---|---|
| SA13 | Snorlax Body Slam into a Minimized Jolteon behind Reflect | 104–124 | 104–124 |
| CR10 | the same into a Snorlax with Minimize and Glaive Rush | 200–235 | 200–235 |
| TV03 | Ice Beam into Swampert with an added Grass type | 98–116 | 98–116 |
| TV11 | Ember into a Tar Shot Scizor (8x) | 104–128 | 104–128 |
| TV12 / TV13 | Body Slam into a Foresight Gengar; Psychic into a Miracle Eye Umbreon | 78–93; 52–63 | same |
| CR07 | Earthquake (spread) into a Smack Down Skarmory; a Magnet Rise Snorlax; a Smack Down Levitate Bronzong | 80–96; 0; 92–110 | same |
| TV15 | Earthquake into an Embargoed Air Balloon Snorlax | 75–88 | 75–88 |
| F75 / F35 | Galvanize Body Slam under Mud Sport; Frost Breath into Lucky Chant | 54–66; 15–18 | same |
| SA06 / SA19c | Body Slam into a Guard Split Shuckle under Wonder Room; Low Kick into a 182.8 kg Rhyperior | 9–11; 51–60 | same |
| SA09 / D | Spit Up at 3 layers; Stored Power at +2 evasion | 115–136; 40–48 | same |
| K55 / K55c | Electrified Pixilate / Cute Charm Hyper Voice into Gyarados | 136–160; 112–132 | same |
| TW02 / TW02f | Ion Deluge on a Normalize Body Slam / Flamethrower | 136–160; 104–124 | same |
| T2-SI01 / SI03 / SI05 | Earthquake into Dig; Gust into Fly; Gust into Bounce | 116–138; 22–28; 22–27 | same |
| CQ08b | the lifted Pokémon's partner's Gust into the Sky Drop user | 14–17 | 14–17 |
| T2-Q01 / Q03 / Q06 / Q16 | Max Lightning; Weather Ball in sun; Inferno Overdrive; Raging Bull through Reflect (all Electric) | 50–59; 116–140; 62–73; 52–62 | same |
| T2-Q04 / Q05 / Q07 / Q09 / Q09b | Breakneck Blitz (Ion Deluge); Pulverizing Pancake into Garchomp; Judgment; Weather Ball no weather; in rain | 92–109; 0; 41–49; 14–17; 40–48 | same |
| LV / GAL | Liquid Voice Hyper Voice; Galvanize Body Slam, under Electrify | 28–34; 94–112 | same |
| IN-LF / IN-LC | Laser Focus Body Slam; into Lucky Chant | 111–132; 75–88 | same |
| HH2 / CHI | two Helping Hands; three Chi Strike layers | 165–195; 111–132 | same |
| MATBLOCK / PLEDGE / ROUND / PURSUIT | Z-Move through Mat Block; a combined Pledge (Grass, 150, forced STAB); Round at 120; Pursuit, no switch | 11–14; 69–82; 45–54; 23–28 | same |
| ALLY-PT / ALLY-DZ / T2-GW01-usum | Quick Attack into the ally on Psychic Terrain; into a Dazzling ally; a frozen +1 Brave Bird into Dazzling | 34–42; 33–40; 0 | same |
| SWAMP | Jolteon's Speed in the swamp | 37 | 37 |

`npx --no-install tsx scripts/.cache/calc-audit/status2/build/step0b-step-probes.ts` (the turn step): O1 Focus Band
{0: 0.9, 1: 0.1}; O1b {0: 0.99, 1: 0.01}; BE01b the stop at hit 1 (51–58) then the continuation at +1 Defense, combined, equal to
Showdown's distribution 17–30 mass for mass; AF01 hitStep 110 after Aftermath 45 and the Sitrus Berry; AF03 attacker 114
(Aftermath, then the recoil); IO02 attacker 121; UN03 attacker 112 (Rocky Helmet, Sitrus with Unnerve gone, recoil); FV01
Venusaur keeps its Sp. Atk, Comfey −1; SE02 `reactions: [{ source: "Gooey", stages: { spe: -1 } }]`; SP01b a fresh continuation
after a 1 HP Substitute equals Showdown's {148: 0.3125, 149: 0.25, 150: 0.25, 151: 0.1875}; lastHit 42 of 84 (lowest), 49 of 98
(highest).

## Performance

Earlier rounds put the moves pane (bench.ts's cold, one-run-per-job p50) 8–15% above the Step 0a tree. A tree with 0b's
calculation files and HEAD's `uses-to-ko.ts` / `hit-loop.ts` measured as the 0a tree, so the cost was in the search's code.
Three changes, with byte-equal results: `loopInput` sets `koRetaliation` after its object literal (no fourth spread on the
common path); the search's per-roll loop keeps HEAD's body verbatim (checked equal) as the plain path, with status2's body
(Focus Band's branch, the Berry's stop, the last hit's slot) a second loop taken only when the step's `UsesEnv` asks for one of
them; `turnMarksOf` is read once per module (an import from a `.cjs` module is a getter under tsx). Steady state (in-process,
`step0b-moves-bench.ts`, five alternating processes, 8 passes each) the moves pane was already equal to HEAD (min 98.9 vs 99.8 ms).

## Gates (final code; exact output lines)

1. `npm run check` (castmirror check, eslint, `tsc --noEmit`, vitest unit): `CastMirror parity verified: 862458f / castmirror-vercel-v1`;
   eslint and tsc print nothing; ` Test Files  233 passed (233)` / `      Tests  5931 passed (5931)` (Step 0a's 231 / 5897 plus
   `status2-plumbing.test.ts`, 12 tests, and `status2-plumbing-t2.test.ts`, 22 tests); exit 0.
2. `npm run test:battle-data:source`: ` Test Files  9 passed (9)` / `      Tests  141 passed (141)` (`status2-hooks.test.ts` with the
   new rows).
3. `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal (2777 ms)`.
4. Stored 2v2 app results (all 1264 cases), `step0a-run-app.ts <scratch>` then `step0a-diff-app.mjs`:
   - against HEAD's app results (Step 0a's `base-app`, run from `4008ee8`; `git diff 4008ee8 HEAD -- app/lib/battle` is empty):
     `1264/1264 byte-equal (ms removed); differ: 0; missing: 0; extra: 0` (the whole result JSON, facts included);
   - against the stored `verify/app-results`: `1264/1269 byte-equal (ms removed); differ: 0; missing: 5; extra: 0` (Step 0a's 5
     stale files of cases no longer in cases.ts).
5. `app-diff.mjs`: its report over the new results is byte-identical (`cmp`) to its report over HEAD's results, against its
   status-eot baseline (`424  ready, byte-equal after the moves…`, `87 unexplained`, present at HEAD) and against the stored
   app-results (`1168  ready, byte-equal…`, `10 unexplained`, likewise). 0 differences introduced.
6. `regress.mjs scripts/.cache/calc-audit/2v2/verify/results`: `549/552 byte-equal after the moves (status-eot fields, ms and the
   walk bookkeeping stripped); differ: 3; missing: 0` (it reads no app code: M24i, M24j, M29c, as at HEAD).
7. Oracle comparison, `step0a-compare.ts`: `1264/1264 cases match.`
8. The probes: `step0b-probes.ts`: 47 lines `OK`, then `every probe agrees`; `step0b-step-probes.ts` as listed above (the unit tests
   pin each number).
9. Bench (`verify/bench.ts`; `results/bench.json` restored after each run), four rounds alternating HEAD (the bench with `@/`
   pointed at the HEAD tree through `TSX_TSCONFIG_PATH`), a Step 0a-only tree (this tree with HEAD's 0b-owned files) and this tree,
   on the final code (before the last change, the blocked row's protection name, which no bench case sets):
   ```
   H1 turn p50 2.37 p95 6.05 | moves p50 10.63    A1 turn p50 2.34 p95 6.17 | moves p50 8.72    C1 turn p50 2.46 p95 6.51 | moves p50 10.18
   H2 turn p50 2.57 p95 6.58 | moves p50 9.79     A2 turn p50 2.52 p95 6.69 | moves p50 9.95    C2 turn p50 2.65 p95 6.78 | moves p50 10.37
   H3 turn p50 2.58 p95 6.62 | moves p50 10.20    A3 turn p50 2.52 p95 6.48 | moves p50 9.70    C3 turn p50 2.55 p95 6.78 | moves p50 10.52
   H4 turn p50 2.60 p95 6.68 | moves p50 11.21    A4 turn p50 2.52 p95 6.59 | moves p50 9.93    C4 turn p50 2.62 p95 6.85 | moves p50 10.22
   ```
   Means against main (HEAD): turn p50 2.530 → 2.570 ms (+1.6%), p95 6.483 → 6.730 ms (+3.8%), moves pane p50 10.46 → 10.32 ms
   (−1.3%); against the Step 0a tree: +3.8%, +3.8%, +7.8%. Statuses equal in every run (ready 1340, not-estimated 127, issues 4);
   reference mode 30/30. The moves pane's p50 is one cold run per job (23 jobs): HEAD's own four runs span 9.79–11.21 ms.

Not run, as Step 0 forbids it: `next build`, seed scripts, live Supabase. Nothing was committed or pushed.
