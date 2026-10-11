# Wave 1b, Track E2: the end of turn, continued (ADDENDUM2 §4.3 E2)

Branch `calc-2v2-status-2`, checked before the work and before this report. Files changed: `app/lib/battle/doubles-eot.ts`,
`app/lib/battle/residuals.ts`, `tests/unit/doubles-eot.test.ts`, `tests/unit/residuals.test.ts` (each kept its line endings:
doubles-eot.ts and its test LF, residuals.ts and its test CRLF). Nothing else was edited; nothing committed. Build folder:
`status2/build/e2/` (scripts below; `before/` holds the four files as E2 found them).

## What the end of turn now models (pinned Showdown c23d2e94)

| Order | Rule | Source |
|---|---|---|
| 3 | **Future Sight / Doom Desire landing** (`landingHandler`): the slot condition ends and hits the Pokémon now at the slot (`kernel.occupant`: after an Ally Switch the partner; nothing for a fainted occupant; `{Move} does not hit: {Name} is its user.`). Protect (the `protect` volatile only) and Endure from this turn are removed first. The user: an **active Pokémon of the turn** reads its `calcBuild` (stages, item, ability, Tera, Helping Hand received this turn — the kernel's residual conditions leave it out, E2 puts it back, FS17 — Analytic as last); one that **fainted** this turn, or a **build not in battle**, reads its build with the ability as the stand-in, no item, stages 0 (a fainted one also loses Tera and Dynamax and a Mega or Primal form reverts: `{Name} has fainted: …`, `{Name} is back to {Base} after fainting.`, `{Name}'s Terastallization ended as it fainted.`; a build: `{Species} is not in battle: its ability, item and stat changes do not count.`). Then the hit steps: the invulnerability step (`{Move} misses {Name}.` unless No Guard on either side), Telepathy against an ally's landing, the type immunity (the row's no-damage fact), a **Substitute** taking it (`landingIntoSubstitute`: S's `subPrefix` over the search's cases behind a Substitute; an active Infiltrator user passes it and Light Screen), else `kernel.residualHit` (the Berry at the hit's Update, Focus Sash, Sturdy, Weakness Policy, Berserk…). An active user's working **Life Orb** then costs 1/10 (Magic Guard none), hit or not, unless the target's **Red Card** dragged it out (forceSwitchFlag: its line `Red Card · Dragged out after the turn.`, the drag being after the turn). Lines: the move's (no HP, its facts) and the damage alone (part `hit`, the oracle's `futuremove` line), recorded per HP value of the target on discarded clones with its HP/stat Berry taken off for the hit and put back for the hit's Update (`updateSlot` records the Berry's own line); a Berry so eaten is marked for a later eat this end of turn (Cud Chew, Harvest: one Berry line per path). | conditions.ts:379-421 futuremove; battle-actions.ts trySpreadMoveHit; pokemon.ts:858-885 ignoringAbility/ignoringItem; battle.ts faintMessages; items.ts lifeorb, redcard |
| 5.1 | **G-Max Vine Lash / Wildfire / Cannonade / Volcalith and the Fire Pledge's sea of fire** (`sideResidualHandler`, one handler per active Pokémon of the side by its Speed): 1/6 (sea of fire 1/8) of the base maximum HP unless the spared type (Grass, Fire, Water, Rock; Fire), Magic Guard none. `afterHit`'s `gmaxAfterHit` sets the side condition when the G-Max move hit (a Substitute or a protection's quarter included; target fainted or not) and Centiferno / Sandblast trap every foe in with HP not trapped (Binding Band 1/6), a trap that **outlives its user** (`trapHandler`: `trap.gmax`). `SideConditions.gmaxResidual` (startWorld) carries one from an earlier turn. | moves.ts gmax* self.onHit, condition onResidual 5.1; firepledge condition; conditions.ts partiallytrapped gmaxEffect |
| 15, 16, 17 | **Taunt, Encore, Disable** count down from the input's turns (or a use this turn's fresh duration: the integrator's lines, below); at 0 the volatile ends (`Taunt ends`, `Encore ends`, `Disable ends`; E2 `turnsLeft` after the countdown). | battle.ts fieldEvent duration; moves.ts taunt/encore/disable |
| 26.7–26.9 | **The Pledges' side conditions** count down (`SideState.pledge`: PR's 4 when set; E2 `sides.pledge` 3 after the turn, as the oracle's `firepledge:3`). | moves.ts waterpledge, firepledge, grasspledge onSideResidualOrder 26 |
| 27.2, 27.6, 27.7 | **Gravity, Magic Room and the terrain from before the turn** end when `fieldTurns` is 1 (`fieldEnds`: not set again this turn, World.fieldSet; for the terrain, the input's, and no Pokémon of the turn able to clear it and set it again — `terrainResettable`, else the kept reason `{Terrain} Terrain ending is not modelled in 2v2.`). Facts `Gravity ends.`, `Magic Room ends.`, `{Terrain} Terrain ends.`; later handlers read the field as it is (the Orbs at 28.3 grounded or out of Misty Terrain, the items Magic Room held back: `itemFreed` collects them). The `Assumes … does not end this turn.` facts are not given when the turns are given. The terrain's end calls FC's `eotField` with the field before it. Integration 1a's stopgap reason is gone. | moves.ts gravity, magicroom, the terrains onFieldResidualOrder 27 |
| 28.1 | **Uproar's upkeep**: CL's `vol.uproar` (turns left after this one) ends at 0 or under Throat Chop (`Uproar ends`). **Yawn's sleep fails** while any active Pokémon has the volatile (`Yawn · Cannot fall asleep: Uproar.`). | moves.ts uproar condition (duration 3, onResidual, onAnySetStatus) |
| 28.2 | **Cud Chew** (`cudChewHandler`, every holder, in the one Speed-sorted group): counter 2 → 1 (eaten in the moves), 1 → 0 re-eats the Berry: the Berry's onEat with nothing held (`stolenEat`: heal — Heal Block stops it, none at full HP —, cures, Lum/Persim confusion, stat Berries through boost() and the copiers' ledger, Figy confusion, Lansat's focus, Starf one world per open stat), suppressed under Embargo or Magic Room, Unnerve does not stop it; no item used, no lastItem. Lines `Cud Chew · Eats its {Berry} again.` and the Berry's own (summed per path with an earlier eat: `Recorder.again`). C29's fact `Assumes {Name} ate no Berry last turn.` for a holder holding no Berry and no `carried.cudChew`. | abilities.ts:742-771 cudchew |
| 28.2 | **Moody** (`moodyHandler`): +2 to a stat below +6, −1 to another above −6 (generation 7: accuracy and evasion too), one world per pair at the product of the uniform picks, through boost(). **Readers rule:** E2 always branches; the calculator's walks only with a later reader (`moodyRead`: its White Herb, Eject Pack, Starf or stat Berry; a foe's Opportunist or Mirror Herb), else they record each pair's stage facts at its mass on a clone. The old fact `Moody raises one stat and lowers another.` is gone. | abilities.ts:2701-2733; mods/gen7 |
| 29 | **Zen Mode, Shields Down, Schooling** (`formHandler`/`formAt`): the form across the HP line through `withSpecies`, HP unchanged (equal base HP); not for a transformed holder or Schooling under level 20; a Dynamaxed holder keeps `REASONS.formChange`. E2 splits on the line; the calculator's walks do not (nothing later reads the form) and record `Becomes {Form}.` with the flipping share. **Power Construct keeps** `formChange` (`formGuard`). | abilities.ts zenmode, shieldsdown, schooling |
| after the residual | A carried two-turn release that did not happen ends hidden (`releaseEnds`: twoturnmove's duration, no order). | conditions.ts twoturnmove |
| Updates | **Booster Energy** at an Update with its holder's field down calls FC's `itemsAfterField` (the field ended in this end of turn, or Magic Room or Embargo let the item work again). | items.ts boosterenergy onUpdate |

**FC's end-of-turn sites:** the weather's end at order 1, the terrain's end at 27.7 and a residual faint that ends a strong
weather or a Cloud Nine / Air Lock's suppression now pass `before` (the field before the change) and a fact sink to
`fieldChangeHooks.eotField` (FC's re-settle, T2P-FLD-03 and -03b now agree); a residual faint's kernel `faint` also calls FC's
`stepField`, so FC's resettle runs twice there (idempotent for the weather).

**Reasons now:** a bare landing id `{Move} landing needs its user.`; a build user whose side the input does not give where it
changes the hit (a living partner-boost holder on either side, Telepathy on the position's side) the same text; two holders
of one partner boost on a build user's side `REASONS.landingPartners`; `cudChew: true` `Cud Chew needs {Name}'s Berry from the
last turn.`; Power Construct's `formChange`; a terrain the turn could set again `{Terrain} Terrain ending is not modelled in
2v2.`; and, until the integrator's searchFor lines land, a landing whose user's search would follow its HP (a Life Orb or Shell
Bell user) `REASONS.landing` (`doubles-eot.ts:856`, then dead).

## Verification

- **Oracle** (`e2/e2-run.ts`: sim-dfs.ts `oracle()` into `e2/oracle/`, then app-turn.ts and compare.ts `compareCase`). V2's
  E2 cases (T2E-FS, -CC, -MO, -GX, -FC, IN-FLD, IN-TNT, IN-CUD, IN-FSL-01/03, IN-TLK, IN-HBK) plus G4-LMV, G4-ENC-01, G4-WHR:
  **102/109 on this tree; 109/109 with the integrator's lines** (`e2/tree.sh` builds a scratch tree with them,
  `TSX_TSCONFIG_PATH=…/e2tree/tsconfig.json`; G4-WHR with `--drop-end`, its stale `endNotEstimated`). The 7: G4-WHR-01-sv/-swsh
  (case data), G4-LMV-01/02, G4-ENC-01 (the fresh durations), T2E-FS14-sv/-champions (the unfollowed residual search).
- **E2's extra cases** (`e2/e2-extra-cases.ts`, `e2-run.ts --extra` on the patched tree): an active Life Orb landing, Doom
  Desire from an active Jirachi, Telepathy against an ally's landing, a fresh Taunt (early and late), a late Disable and Encore,
  Cud Chew's Liechi beside Unnerve, Magic Room's end with White Herb and Sticky Barb, Gravity with 2 turns left: **10/11**; the
  11th (E2X-FS-RC, the Red Card drag) agrees on everything but the dragged slot's HP, where the oracle's afterTurn reads the
  dragged-in Pokémon (a harness semantics question for V2; no Life Orb loss in Showdown either).
- **Stored cases** (`e2/ab.sh`: every case's app result with E2's two files as before vs now, both copied at one instant): 106 of
  2313 differ — E2's own 1b cases, and R09, ER41d–h, G4-WHR-01 ×2, T2P-DAN-09-sv, T2P-PLG-01…07, T2P-FLD-03/03b. Every one
  agrees with its stored oracle result (`STATUS2_REEXPECT=1a,1b e2-run.ts --stored`; V2's REEXPECT_TO already has ER41d/e's texts).
- **Reference mode** (`e2/e2-reference.ts`: DOUBLES_REFERENCE on vs off, the end of turn's HP, residual lines and E2's
  mixtures): 109/109 equal.
- **Tests:** `tests/unit/doubles-eot.test.ts` 79 + 2 `it.fails` (the integrator's lines; they pass on the patched tree and are
  to flip to `it`), `tests/unit/residuals.test.ts` 15. The Training project (59 files, 686 tests) passes. Of the unit project's
  failures, E2 causes only D-FLG-18-sv (D's test asserting the old Cud Chew guard) and doubles-turn-showdown's ER41d/e/g/h and
  G4-WHR-01 ×2 (generated expectations; `e2/vitest.A.config.mts` runs the files on the pre-E2 tree to tell the rest are other
  tracks' work in progress). tsc and eslint clean on E2's files; `tests/source/status2-hooks.test.ts` 7/7.
- **golden-1v1:** 254 cases byte-equal. **Bench** (`e2/bench.sh`, int1a's bench-stored over 1904 turns, pre-E2 vs now,
  paired): per-turn ratio median 0.978, p90 1.358 (noise; statuses equal; reference 30/30).
- **Budget / readers rule:** the landing multiplies only the target's factor (the kernel joins nothing else); its per-value
  recording runs on discarded clones (no world growth); E2 writes no unread state. A landing on Matcha Gotcha's drain joint
  (`e2/budget-landing.ts`, Champions and SV) stays ready (≤ 54 ms). PERF-1B's worst sample worlds (24 870 / 14 460 entries) would
  pass 200 000 with ×16 only if a landing met them; there the exact fallback is `Too many cases to follow.` (SPEC2 risk 5). The
  census sample carries no landing, so no sample turn changes. Moody (×20, ×42) and the forms (×2) branch only in E2 or with a
  reader.

## For the integrator (exact; `e2/int-patch.cjs` applies each, verified by `e2/tree.sh` + `e2-run.ts`)

1. **`doubles-turn.ts` searchFor: a residual hit's search never follows its user's HP** (T2E-FS14-sv/-champions; the
   `it.fails` "a landing whose user's search would follow its HP"; then delete `doubles-eot.ts:856`
   `if (entry.follow) return kernel.notEstimated(REASONS.landing(move.name));` and REASONS.landing):
   - `    ...(extraSet ? [extra] : [])]);` → `    ...(extraSet ? [extra] : []), ...(opts?.attackerBuild ? ["residual"] : [])]);`
   - `      }, spread ? false : undefined);` → `      }, spread || opts?.attackerBuild ? false : undefined);`
   - `      entry = { row, search, follow: !spread && search.needsAttackerHP(), trace };` →
     `      entry = { row, search, follow: !spread && !opts?.attackerBuild && search.needsAttackerHP(), trace };`
2. **`doubles-status.ts`: a use this turn writes its fresh duration** (G4-LMV-01-champions, G4-LMV-02-sv, G4-ENC-01-sv; the
   `it.fails` "Taunt, Encore and Disable used this turn get their fresh duration"):
   - `      setVol(w, slot, { taunt: true });` → `      setVol(w, slot, { taunt: true }); setEot(w, slot, { tauntLeft: !kernel.input.pokemon[slot]?.switchedIn && !w.remaining.some((entry) => entry.slot === slot) ? 4 : 3 });`
   - `    setVol(w, slot, { disabled: last });` → `    setVol(w, slot, { disabled: last }); setEot(w, slot, { disableLeft: w.remaining.some((entry) => entry.slot === slot) ? 4 : 5 });`
   - `  setVol(w, slot, { encore: last } as Partial<Vol>);` → `  setVol(w, slot, { encore: last } as Partial<Vol>); setEot(w, slot, { encoreLeft: w.remaining.some((entry) => entry.slot === slot) ? 3 : 4 });`
3. Optional, exact (`doubles-status.ts` lastMoveFailure): `  const last = used ?? entry.lastMove;` →
   `  const last = used ?? entry.lastMove ?? entry.carried?.encore?.move;` (a Pokémon under a carried Encore last used its Encore
   move; IN-TNT-02 without its `lastMove` field).
4. **`tests/source/doubles-residuals.test.ts` CLASSES** (`e2/source/classes.diff`; the copy runs 3/3 with
   `npx vitest run --config scripts/.cache/calc-audit/status2/build/e2/source/e2-source.config.mts`; the current file fails its
   second test on E2's new keys until then): futuremove, the five 5.1 side residuals (`sideresidual`), uproar, taunt/encore/
   disable, the three Pledges' onSideResidual (`pledgewater`, `pledgefire`, `pledgegrass`), gravity, magicroom, the four
   terrains (`terrain`), cudchew, moody, schooling, shieldsdown, zenmode modelled; powerconstruct stays guarded.
5. **`tests/unit/doubles-guards-fling.test.ts` D-FLG-18-sv** (D's, frozen): the flung Sitrus eaten by Farigiraf is now due at
   the next end of turn (`e2/flg18.ts`: end of turn ready, E2 `cudChew` "sitrusberry" at chance 1):
   `const input = turn(runtime, […same mons…]); expect(ready(input).endOfTurn.status).toBe("ready"); const out = calculateDoublesOutcomes(input); expect(out.status === "ready" && out.outcomes.every((o) => o.mons["own-right"]!.cudChew === "sitrusberry")).toBe(true);`
6. **REASONS** with no site left: `overTime` (and `landing` after item 1); `tests/unit/doubles-status.test.ts:452,454` assert
   their texts. The `notIn2v2` sites for Cud Chew and Moody are gone.
7. **Contract, optional:** `DoublesCarried.futureMove`'s build form gains `side?: DoublesSideId` (its user's side; E2 already
   reads it, `landingSide`), for Training's benched users beside a partner-boost holder or a Telepathy target.
8. `tests/unit/doubles-turn-showdown.test.ts` regenerated (gen-tests.ts) once V2 stores ER41d–h and G4-WHR-01's fresh results.

## For other tracks

- **V2:** cases-g4.ts G4-WHR-01's `endNotEstimated` line goes ("Drop this line at integration 1b"; agrees without it). The
  oracle's afterTurn of a slot a residual Red Card dragged reads the dragged-in Pokémon (E2X-FS-RC); the app keeps the dragged
  user's HP with its fact, as the residual Eject Pack's. Optional: RESIDUAL_ALIASES `futuremove: ["futuresight", "doomdesire"]`
  (the damage line now matches by values). E2's extra cases may join the set (`e2/e2-extra-cases.ts`).
- **FC:** E2 calls `eotField(kernel, w, before, sink)` at the weather's end (1), the terrain's end (27.7) and a residual faint
  (with the kernel's own `stepField` there, twice: idempotent for the weather), and `itemsAfterField(kernel, w, slot, sink)` for
  a Booster Energy holder with its field down at every end-of-turn Update.
- **PR:** `SideState.pledge[kind]` is the turns left before this end of turn's countdown (4 when set; E2 makes it 3).
- **CL:** E2 reads `vol.uproar` as the turns left after this one (ends at 0 or under Throat Chop at 28.1) and fails Yawn's sleep
  while any active Pokémon has it, independent of `uproarSleep`.
- **T2:** E2 reads `carried.futureMove` `{ move, source }` / `{ move, build, side? }`, `carried.cudChew` (the Berry),
  `fieldTurns`, the Taunt / Encore / Disable turns, `carried.uproar`, `SideConditions.gmaxResidual`.
- **U2:** new residual lines and facts: `Future Sight` (its facts line and its damage line), `Life Orb`, `Red Card` ("Dragged out
  after the turn."), `G-Max Wildfire` and kin, `Fire Pledge`, `Taunt ends`, `Encore ends`, `Disable ends`, `Uproar ends`,
  `Yawn` ("Cannot fall asleep: Uproar."), `Cud Chew` ("Eats its {Berry} again.") with the Berry's line, `Moody` (stage facts),
  `Zen Mode` / `Shields Down` / `Schooling` ("Becomes {Form}."), FC's facts on the holder's line; end-of-turn facts
  `Gravity ends.`, `Magic Room ends.`, `{Terrain} Terrain ends.`; the turn fact `Assumes {Name} ate no Berry last turn.`.
