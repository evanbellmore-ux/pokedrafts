# Wave 1a, Track A3: field, side, reflection and item moves (SPEC2 §2.2 A3 rows, §4.4; ADDENDUM2 §4.2)

Branch `calc-2v2-status-2` (checked before and after the work). Files changed:

- `app/lib/battle/doubles-field.ts` (A3's file, rewritten from the Step 0 stub: fieldMove with clocks, Snatch, Magic Coat,
  Crafty Shield, Mist's TryBoost, the 21 handlers).
- `app/lib/battle/doubles-items.ts` (A3's file: received Seeds / Room Service used at once; exported helpers for the item moves).
- `app/lib/battle/status-table.ts` (regenerated only: `gen-status-table.ts dex-dump.json dex-flags.json`, all three fragments;
  counts `{"M":183,"X":39,"C":21,"S":7,"N":20,"P":1}`, no L left; re-run at the end, byte-equal to the file).
- `scripts/.cache/calc-audit/status2/build/classify-a3.md` (18 M + 3 C: magicroom, defog, recycle).
- `tests/unit/doubles-field-side-items.test.ts` (new: 38 tests; 37 pass and the Mat Block blocking test is
  `skipIf(!integrated)` until I1 lands; all 38 pass on the scratch tree with I1–I6).

Build-folder helpers (this folder, prefix `w1a-a3-`): `w1a-a3-cases.ts` (77 cases), `w1a-a3-run.ts` (oracle into
`w1a-a3-results/`, never V1's results; `--v1`, `--drop-reason`, `--facts`), `w1a-a3-itree.sh` (scratch copy of app/lib with
I1–I6 applied), `w1a-a3-itest.config.mts` + `w1a-a3-itest/` (A3's unit test on that tree), `w1a-a3-t10c.config.mts` +
`w1a-a3-t10c/` (the proposed doubles-items.test.ts T10c replacement, verified), `w1a-a3-changed.ts` (the stored cases A3
changes), `w1a-a3-outcomes.ts` (which generated case is not ready under doubles-outcomes.test.ts's input), `w1a-a3-dbg.ts`,
`w1a-a3-learners.ts`, `w1a-a3-items.ts`, `w1a-a3-dump.ts`, `w1a-a3-attrib.ts`, `w1a-a3-gen-ready.ts`, outputs `*.out`.
Nothing else was edited (no frozen file, no other track's file).

## What A3 models (pinned Showdown c23d2e94)

| Move | Rule | Facts (exact) |
|---|---|---|
| Magic Coat | volatile; `tryHitSide` for any other user's reflectable move into the holder (ally too, F05), not while the holder is semi-invulnerable or lifted, not twice (`bounced`); the reflection is the holder's own use through `kernel.useCalled` at the original user, with the holder's Prankster (F02: fails on a Dark type); hazards: onAllyTryHitSide lands on the user's side (F04); a faster Magic Bounce takes a hazard first. Crafty Shield before Magic Coat (F25). | `Magic Coat: {Move} goes back to {User}.`, `Magic Coat: Stealth Rock goes back to {User}'s side.` |
| Snatch | volatile; on a snatchable move's PrepareHit the fastest living other holder (not Sky Dropped; ties: worlds 1/k) takes it, its volatile removed, through `useCalled` (`snatched`); the stolen move's own Try runs for the thief (Wide/Quick Guard willAct, Aurora Veil weather, Mat Block first turn); Wide Guard, Quick Guard and Tailwind go to the thief's side (earlyBranch's fieldMove with the thief's slot). | `Snatch: {Thief} takes {Move}.` |
| Crafty Shield | side flag for the turn; blocks Status moves whose target is not self/all into its side (the user's own ally included); fails as the last action. | `Crafty Shield blocks {Move}.` |
| Mat Block | first turn only (`firstTurn` false: fails; absent: the existing `Assumes the attacker's first turn in battle.`); fails as the last action; sets `matBlock`. Blocking itself is the kernel's hitChecks (I1, I2). | `Mat Block: damaging moves aimed at {Name}'s side are blocked this turn.`, `Mat Block fails: it is not {Name}'s first turn.` |
| Lucky Chant, Mist, Safeguard | side condition with a fresh clock (`clock[flag] = "set"`); already up fails. Mist: `mistBlocks` (exported) stops a drop from another Pokémon on its side; a foe's Infiltrator move passes (not a protecting move's contact effect, not at the end of turn); Mirror Armor reflects first (F40). Lucky Chant: no critical hit into the side (Frost Breath, Merciless included). | `{Move} starts on {Name}'s side.`, `{Move} fails: it is already up on {Name}'s side.` |
| Mud Sport, Water Sport | pseudo-weather with `World.fieldSet`; FC's `pseudoWeatherChanged`; already up fails. | `{Move} starts.`, `{Move} fails: it is already up.` |
| Magic Room, Wonder Room | toggle with `World.fieldSet`; `pseudoWeatherChanged` on start; Magic Room's end: White Herb at once, then per Pokémon the onUpdate items: Booster Energy with its field down → FC's `itemsAfterField` (C until 1b), Mental Herb (attract/taunt/encore/disable/heal block), curing Berries against a status from before (Lum/Persim vs confusion), HP Berries via `kernel.berryDue`. | `{Move} starts.`, `{Move} ends.`, `White Herb: {Name}'s lowered stats are restored.`, `Mental Herb: {Name}'s Taunt ends.` |
| Court Change | swaps the side conditions with their clocks, hazards, `hazardsFrom`, Pledges, G-Max; Wide/Quick Guard, Crafty Shield, Mat Block, benchCured stay; fact only when a known condition moved. | `Court Change: the two sides' conditions are swapped.` |
| Defog | evasion −1 (not behind a Substitute without Infiltrator); target side's screens, Safeguard, Mist end with their clocks; hazards both sides; generation 8+: the terrain ends (FC's `changed`: a terrain-settled holder gives FC's reason, C). | `Defog: {Cond} ends on {Name}'s side.`, `Defog: the {T} Terrain ends.` |
| Corrosive Gas | every adjacent Pokémon's item (ally too), not Sticky Hold (unless broken), not behind a Substitute, not an unremovable item. | `Loses its {Item}.` |
| Bestow | fails: target holds an item, user holds none, item cannot be moved; else gives it (Unburden, the receiver's Start: received Seed/Room Service, White Herb; Berries at the Update). | `Bestow: {Target} gets {Item}; {User} holds no item.` |
| Recycle | at onHit: holds an item → fails; its last item from the world (item history) or the input's `lastItem` (`null`: none → fails); unknown → C reason `Recycle needs {Name}'s item from an earlier turn.`; a held-at-start item lost this turn with the turn not tracking items → not in 2v2. | `Recycle: {Name} gets {Item} back.`, `Recycle fails: {Name} has used no item.` |
| Teatime | every active Pokémon in getAllActive order: `presence.invulnerable` / `hidden.missesField` → miss; Good as Gold; Psychic Terrain vs priority; a Berry is eaten at once (no line), with its source the user (Mist/Clear Body/Mirror Armor/Defiant for a stage, Safeguard vs a Figy's confusion from another), Ripen, Cheek Pouch; under Magic Room no effect. | `Teatime misses {Name}.`, `Eats its {Berry}.`, `Eats its {Berry}: no effect (Magic Room).` |
| Stuff Cheeks | no Berry fails; Def +2, then the Berry eaten at once (at +6: nothing eaten). | `Stuff Cheeks fails: {Name} holds no Berry.`, `Its Defense cannot go higher.` |
| Heal Bell, Aromatherapy | user and ally cured, bench `benchCured`; generation 7 Heal Bell: Soundproof on all (user too); 8+: others' Soundproof / Sap Sipper (Aromatherapy: +1 Atk at TryHitSide) / Good as Gold unless broken; Aromatherapy skips a Substitute. | `Its {status} is cured.` |
| Purify | target without status fails; cure; user heals ceil(maxHP / 2). | `Purify fails: {Name} has no status.` |
| Psycho Shift | user without status fails; the move takes the user's status (Safeguard, type immunity, Synchronize/Lum interplay), then cures the user. | `Psycho Shift fails: {Name} has no status.` |
| fieldMove | verbatim, with `clock[flag] = "set"` for Tailwind and the screens, `World.fieldSet` for Trick Room / Gravity; FC's before/after calls and `hiddenHooks.land` at Gravity kept in order. | (unchanged) |
| received items | (doubles-items.ts `receive`, T2M §3.21) a Seed in its terrain / Room Service under Trick Room used at once: boost from the holder (`effect: "item"`), item gone, item history, Unburden; a hit fact on a target, a step fact naming the user. Booster Energy keeps `REASONS.received`. | `Its Electric Seed is used up on Electric Terrain: +1 Defense.`, `Its Room Service is used up under Trick Room: −1 Speed.` |

## Verification

- A3's own cases (`w1a-a3-cases.ts`, 77, each against `oracle()` + `compareCase()`): **71/77** on the real tree, **73/77**
  with I1–I6 (scratch tree). Remaining: A3-SN-03 (compare.ts START_FACTS `/substitute/i` counts `Snatch: Absol takes
  Substitute.` as a Substitute start: 0.25 expected vs 1; the app's facts are right: V1), A3-DF-03, A3-MC-06 (E2 evasion stage
  not emitted: A1/D), A3-TT-05 (E2 `twoturnmove` volatile for the Fly user: H's I7). A3-MB-01/02 need I1/I2.
- V1's FS and T2M-RI cases (`--v1`, oracle fresh into this folder): **60/67** real tree, **61/67** with I1–I6. T2M-RI-01/02
  (4) match. FS04a needs I1/I2. FS08a–d: E2 evasion (A1/D). FS14c: the case needs `lastItem: null` on Bronzong (the app gives
  the fact reason `Recycle needs Bronzong's item from an earlier turn.`, as FS14d expects). FS06b and FS08e match with V1's
  current cases.
- Stored cases A3 changes (`w1a-a3-changed.ts`), run in full (`--drop-reason`) against a fresh oracle: S48-Bestow-before-usum,
  S48-Bestow-last-usum, E22b, E22c, VT-VT06, S35a, RT-RV02, RT-RV03, T2E-SI-01b-sv/-champions, T2M-SG-01-sv/-champions all
  match. VG39 stays not estimated with a new reason after I5: `An Ability Shield change under Neutralizing Gas is not modelled
  in 2v2.` (V1: update its notEstimated). VE-H1-3 is now ready and matches, but its lock reason lives in doubles-guards.ts
  (not A3's change).
- Unit: `tests/unit/doubles-field-side-items.test.ts` 37 passed + 1 skipped (38/38 on the scratch tree). tsc clean for A3's
  files.
- Failing tests not A3's: doubles-status.test.ts "gives each where its turn meets it" (a non-A3 row), doubles-engine-verify
  (Berserk lock; Stored Power stages), doubles-turn-showdown generated cases whose stored reasons are removed (incl.
  S48-Bestow-last-usum: now ready, matches the oracle: V1 regenerates), status2-hooks (doubles-eot copierEndOfTurn,
  doubles-faces healStandIn), doubles-status-moves kinds counts (integrator), doubles-items.test.ts T10c (below),
  doubles-outcomes 955/956: S48-Attract-last is not ready because doubles-outcomes.test.ts's `Mon`/`caseBuild` do not map
  `gender` (`Attract needs Garchomp's gender.`; Attract is A2's C move).

## needsFromIntegrator (frozen files; each verified on the scratch tree `w1a-a3-itree.sh`)

- **I1** doubles-turn.ts hitChecks (line ~2074):
  `if (side.matBlock && isFoe(attacker, slot) && !info.isZ && !info.isMax && info.flags.protect) return { slot, block: { by: moveName(ctx, "matblock") } };`
  → `if (side.matBlock && slot !== attacker && !passes()) return { slot, block: { by: moveName(ctx, "matblock") } };`
  (the engine move has no `protect` flag; matblock onTryHit checks no source: an ally's move too, F31). Test: the skipped
  `A3-MB-01, -02` in tests/unit/doubles-field-side-items.test.ts (auto-enabled when the line is present); cases A3-MB-01/02,
  FS04a.
- **I2** doubles-turn.ts conditionsFor (line ~742): `... && moveId && isFoe(attacker, target)) {` → `... && moveId && target !== attacker) {`.
- **I3** useCalled pass-through: TurnKernel `useCalled(..., opts?: { priority?: number; prankster?: boolean; snatched?: true; bounced?: true })`
  (doubles-turn.ts ~400 and ~1513); the call at ~1520 spreads `...(opts?.snatched ? { snatched: true as const } : {}), ...(opts?.bounced ? { bounced: true as const } : {})`;
  doubles-status.ts runCalledStatus opts gains the two fields and `makeUse(..., opts.priority, !!opts.bounced, target, opts.prankster); if (opts.snatched) use.snatched = true;`.
  doubles-field.ts already passes them (`called()`); its `running` flag keeps the behaviour equal until then.
- **I4** doubles-status.ts prepareHit (~1046) and sideOrField (~1746): `if (!use.bounced)` → `if (!use.bounced && !use.snatched)`
  before `typingHooks.proteanGuard` (protean onPrepareHit skips sourceEffect snatch).
- **I5** doubles-actions.ts GAS_CHANGING_MOVES (line 153): drop `"bestow", "corrosivegas", "embargo", "magicroom"` (SPEC2 §8.4). VG39's text then changes (above).
- **I6** after I3: delete doubles-field.ts line 251
  `if (move.id === "swallow" && !w.mons[by]!.vol.stockpile) kernel.notEstimated(REASONS.notIn2v2(\`${move.name} taken by ${kernel.moveName("snatch")}\`));`
  (A1's Swallow then reads `use.snatched`).
- tests/source/doubles-status-moves.test.ts: kinds now `183 M, 20 N, 21 C, 0 L, 7 S, 1 P, 39 X` (all fragments).
- tests/source/status2-hooks.test.ts §3.5 rows for A3's new calls: `["doubles-hidden.ts", "missesField", "doubles-field.ts", "teatime", "hiddenHooks.missesField("]`,
  `["doubles-presence.ts", "invulnerable", "doubles-field.ts", "teatime", "presenceHooks.invulnerable("]`,
  `["doubles-fieldchange.ts", "itemsAfterField", "doubles-field.ts", "roomEnd", "fieldChangeHooks.itemsAfterField("]`,
  `["doubles-fieldchange.ts", "pseudoWeatherChanged", "doubles-field.ts", "sport", "fieldChangeHooks.pseudoWeatherChanged("]`,
  `["doubles-fieldchange.ts", "pseudoWeatherChanged", "doubles-field.ts", "room", "fieldChangeHooks.pseudoWeatherChanged("]`.
- tests/unit/doubles-items.test.ts T10c (no track owns it): replace the two `toThrow(... received by Snorlax ...)`
  expectations with the used-at-once check; the full replacement is `w1a-a3-t10c/t10c.txt` (fixture kernel gains
  `applyBoosts`, `noteItemUse`, `hitFact`, `moveName`), verified 16/16 with `w1a-a3-t10c.config.mts`.
- tests/unit/doubles-outcomes.test.ts: map `gender` in its `Mon` and `caseBuild` as doubles-turn-showdown.test.ts's cases carry it (S48-Attract-last).
- At 1b: flip `magicroom` and `defog` to M once FC's `itemsAfterField` and terrain re-settle land.

## needsFromOthers

- **A1**: E2 outcome stages for accuracy/evasion (`vol.stages`) are not emitted (A3-DF-03, A3-MC-06, FS08a–d); Swallow should
  read `use.snatched` (I6).
- **D**: `symbiosisAfterAction` should skip `w.itemsTaken`; `vol.berryWeaken` consumption and the multi-hit Ripen guard; a
  flung Berry should go through `items.forceEat(..., { flung: true })`.
- **E1**: `roomFact` should read `!w.fieldSet?.magicRoom`; Octolock's drop goes through `applyBoosts` with effect "move"
  (`mistBlocks` treats the end of turn as non-infiltrating).
- **H**: E2 `twoturnmove` for a Fly user this turn (A3-TT-05; H's I7).
- **FC**: `itemsAfterField` (Booster Energy after Magic Room: A3-MR-06 pins the C reason until then); `pseudoWeatherChanged`
  for Room Service.
- **M**: G-Max Resonance's Aurora Veil clock (`clock.auroraVeil = "set"`).
- **V1**: FS14c `lastItem: null`; VG39 text after I5; compare.ts START_FACTS `/substitute/i` vs `Snatch: … takes Substitute.`;
  the changed-cases list above; A3's 77 cases are available in `w1a-a3-cases.ts` for cases-fs.ts.

## Deviations

- Snatch and Magic Coat run the stolen / reflected move through `kernel.useCalled` with a module reentrancy flag (`running`)
  until I3 carries `snatched` / `bounced`.
- Safeguard's handler is A3's (`sideCondition`) so its clock is set like Mist and Lucky Chant.
- Mat Block's first-turn assumption reuses the existing turn fact; blocking needs I1/I2.
- Recycle's checks run at onHit (Showdown's order), not moveTry.
- A snatched Swallow without Stockpile is not estimated until I3/I6.
- The received Seed / Room Service fact on a target is a hit fact (`Its … is used up …`), on the user a step fact naming it.
- Snatch never takes its own user's move (the thief is another holder).
