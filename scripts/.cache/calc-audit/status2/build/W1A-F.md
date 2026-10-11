# Wave 1a, Track F: Fling, the verified 1v1 fix (SPEC2 §4.7, guards.md §4.5)

Branch `calc-2v2-status-2`. Nothing committed, pushed or switched; `.claude/` and `node_modules` untouched; no `next build`.

## Status

Done and verified. Fling is calculated in all four games (it was "Fling is not verified for this game." / "… for Champions."):
every one of 8 134 sweep rows, 66 targeted rows and the 111 calculated golden-1v1 Fling rows agrees with the exact oracle on
pinned Showdown c23d2e94 (rolls, the hit's KO chance, the first use's outcome and Uses to KO); 169 423 item/species TakeItem pairs
agree. golden-1v1 differs from the stored golden only in the 110 Fling rows listed below (regenerated; `--check` byte-equal).

## What changed

| File | Change |
|---|---|
| `scripts/lib/champions-data/transform.ts` | `flingData(row)`: an item's Fling data from the pinned mod's Dex row (`basePower`, `status`, `volatileStatus`, `effect` "whiteherb"/"mentalherb", `berry` from `isBerry`); an unmodelled shape throws. `ResolvedItem.fling`; Champions items emit `fling` before `unsupported`. |
| `scripts/build-champions-data.ts`, `scripts/lib/battle-data/{snapshot,transform,types}.ts` | The snapshots read `flingData(row)`; native items emit `fling`. |
| `data/champions/{catalog,manifest}.json`, `data/battle/*/{catalog,manifest}.json` | Regenerated (`npm run data:champions`, `npm run data:battle`; both `--check` verified). Only the items' `fling` field and the catalogSha256 changed. |
| `data/champions/{move-usage,training-usage}.json` | Re-stamped by `npm run data:champions:move-usage` (they carry the Champions catalogSha256); byte-identical but that hash (checked). |
| `app/lib/battle/fling.ts` (new) | `FlingData`, `flingData`, `flingFailure` (Showdown's order: Embargo / Magic Room, Klutz, then no item, TakeItem through `itemTakeable`, no fling data; Primal Orbs skip ignoringItem), `FLING_FAILS`, `flungEffect`, `flungFact`, `flungStatusLands`, `HP_STATUSES`, `firstUseWalk`, `FLING_ENGINE_NAME`. |
| `app/lib/battle/calculate.ts` | `fling` out of HISTORY_MOVES; `flingPlan` (a Seed used on its terrain on entry counts as no item); the failure rows (zero rows, before Protect); Flower Sweet's 0 power; the neutral-name rebuild at the item's power; `flungOutcome` (facts); `flingUses` / `flungAfterUse` / `maxFlingUses` in matchupRows; the Mirror Herb "either" row. |
| `tests/unit/fling-1v1.test.ts` (new) | 16 tests: the catalog data, the failure rule and rows, power and hits, the facts, the status landing, Uses to KO, the first-use walk, Max Fling, the Mirror Herb row. |
| `scripts/.cache/calc-audit/2v2/verify/golden-1v1.{json,full.json.gz}` | Regenerated with the 110 Fling rows; the old pair is in `fling/golden-before/`. |

## How (and deviations from SPEC2 §4.7)

1. **Power: no engine patch.** SPEC2 asks for an engine correction `withFlingPower` patching `items_1.getFlingPower`.
   engine-corrections.cjs is frozen, and a scoped patch would miss uses-to-ko's engine-only reruns (`trace.engine`). Instead the
   row rebuilds the move under a neutral name (`Fling (item power)`, the codebase's Bolt Beak / Knock Off pattern) with
   `basePower` = the item's pinned power. The engine has no other Fling branch (only calculateBasePower's `case 'Fling'`), and
   with a nonzero `move.bp` its Tera 60-power floor now applies as Showdown's does (`getDamage` reads `move.basePower` set in
   onPrepareHit): Tera Dark Weavile flinging a White Herb is 76–90 (60 power), oracle-verified. The row keeps the name Fling and
   shows the item's power.
2. **Failure rows are zero rows** (`kind: "calculated"`, 0 damage, the fact as assumption and description, Uses to KO
   "no-damage"), not "status" rows: the codebase's other move failures (Snore, Double Shock, restricted moves) are zero rows, and
   a "status" row would show "Status moves do not have a direct-damage HP preview." Texts are SPEC2's, plus
   `Fling fails: {Name} is under Embargo.` (D uses the same) and `Fling throws Flower Sweet for no damage (0 power).` (its
   fling.basePower is 0: Showdown throws it and deals none; guards.md listed it as failing).
3. **Names**: the attacker's own species (a transformed one's from before Transform); a cosmetic form is named as its family
   (runtime.ts `cosmeticFamily`: "Alcremie"), so calculator-cosmetic-forms.test.ts keeps its byte-equal rows.
4. **Facts** only where they hold on a target the hit leaves in: a Berry (`{Item}: {Target} eats it.`), a status that lands
   (Shield Dust and Covert Cloak, Mold Breaker ignoring breakable abilities, types with Corrosion, the SetStatus abilities,
   Misty Terrain on the ground, Safeguard, a curing Berry at once unless Unnerve), a flinch (not through Shield Dust, Covert
   Cloak, Inner Focus or Dynamax), White Herb with a lowered stat. Mental Herb's volatiles never exist in a 1v1 build: no fact.
5. **Uses to KO (single use) and the first use's outcome** without touching the frozen uses-to-ko.ts:
   - the count is recounted from the state the hit leaves: `prepareUses` with the attacker's item gone (no Life Orb recoil,
     Shell Bell, Sticky Barb, Leftovers, own Berry or Orb after the hit) and a burn or poison it gives already set (it acts first
     at that end of turn; the hit's damage stays the row's: Marvel Scale verified). Without this the app said 0 where Showdown
     says 0.3125 (Life Orb Weavile at 10 HP into a Snorlax at 55 HP in sand).
   - a flung Berry's heal and Cheek Pouch's come in the hit's onHit: `firstUseWalk` recomputes the first use's outcome with them
     (then the target's Enigma Berry, its own HP Berry at the Update); it is used only where the same walk without them equals
     uses-to-ko's own outcome (else no outcome). The count stands where no sequence is knocked out at that end of turn (a heal or
     cure cannot add one, but a Poison Heal holder's cured poison); else not estimated: `The flung {Item} heals it`,
     `Cheek Pouch heals it as it eats the flung {Item}`, `The flung {Item} cures its status`.
   - a Dynamaxed attacker (Max Darkness, then Fling): not estimated (`The flung {Item} burns it` and kin) only where a count
     reaches the Fling use and its item can change the target's HP; the Iron Ball Max Fling of calculator-max-fling.test.ts is
     now counted: guaranteed 4, fewest 2, 0.921143 (Bisharp 0.993652), Showdown's.
   - an attacker's Mirror Herb that copies the target's rise before or after Fling (the order unknown): the row is
     `Fling: needs the turn order ({Name}'s Mirror Herb is used before or after it).` (before: Fling fails, no item; after: thrown).

## Verification (all under `scripts/.cache/calc-audit/status2/build/fling/`)

- `oracle.ts`: zmove-status/verify/u-oracle2.ts's exact walk for any app matchup (EVs / Stat Points, natures, levels, HP,
  status, stages, Tera, Dynamax, Mega forms, weather, terrain, rooms, screens; a Doubles row as a Doubles battle with its Helping
  Hand and Friend Guard partners, partners' ties fixed); `getDamage` captured for the rolls. `check.ts` compares a row.
- `sweep.ts <game>` (guards.md §4.5 step 7): every catalog item × Weavile, Hawlucha (Unburden) into Gengar with a Colbur Berry,
  a Shield Dust Vivillon/Ribombee, a Snorlax at 20 % in sand, a Cheek Pouch Dedenne for Berries; and Weavile at 10 HP into a
  Snorlax at 55 HP in sand. Results: champions 1 218, scarlet_violet 1 849, sword_shield 2 584, ultra_sun_ultra_moon 2 483 rows,
  all agree (`sweep-*.out`).
- `extras.ts`: 66 targeted rows (failures, Tera floor, Technician, Sheer Force, statuses at partial KO chances, Mold Breaker,
  Corrosion, Misty Terrain, Magic Guard, Poison Heal, curing Berries, Unnerve, Marvel Scale, Berries with own Berries, Ripen,
  Cheek Pouch, Enigma, Focus Sash, Klutz targets, attacker-side items, Max Fling): all agree (`extras.out`; a 67th, Arceus with its plate, is skipped: Arceus
  learns no Fling in the catalogs).
- `takeitem.ts`: every catalog item with an onTakeItem × every catalog species as its own user, Showdown's handler against
  `itemTakeable`: 169 423 pairs, 0 differ (`takeitem.out`).
- `golden-check.ts`: all 112 golden Fling rows; 111 calculated agree, 1 is the Mirror Herb turn-order row (`golden-check.out`).
- `golden-diff.ts`: against `golden-before/`: 110 Fling rows changed, 0 other differences (`golden-changed.json`).
- `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check`: 254 cases byte-equal (after regenerating).
- Generators: `build-champions-data.ts --check`, `build-battle-data.ts --check`, `import-champions-move-usage.mjs --check` pass.
- Unit: fling-1v1 16/16; battle-data, champions-data-integrity, champions-move-usage-import, training-usage-data,
  calculator-cosmetic-forms pass; calculator-max-fling fails only its first test (now counted: integrator change below).
  tsc and eslint clean on my files.

## The changed golden rows (the only allowed golden differences)

champions (26): random:0, 1, 2, 6, 7, 8, 11, 12, 13; targeted:5, 6, 7, 11 (each Singles and Doubles).
ultra_sun_ultra_moon (24): random:1, 3, 4, 5, 10, 12, 18; targeted:4, 5, 6, 7, 15 (each Singles and Doubles).
sword_shield (26): random:0, 2, 8, 10, 11, 13, 15, 20; targeted:4, 5, 6, 7, 15 (each Singles and Doubles).
scarlet_violet (34): random:9, 10, 11, 13, 14, 15, 16; targeted:1, 2, 3, 4, 5, 6, 7, 11, 13, 15 (each Singles and Doubles).
Each id is `<game>:<case>:<Singles|Doubles>|fling`; the full list with before/after rows is `fling/golden-changed.json`.
Unchanged Fling rows: sword_shield:random:7 (both; Max Darkness, "Harvest may regrow its Berry").

## 2v2 (Track D's) state

The 2v2 step now gets Fling's damage from the row (its hits agree with the stored G4-FLG oracle results). What remains is D's
flingTry / flingAfter: the user's item gone (no Life Orb recoil: G4-FLG-01; no own Flame Orb: -04), the target's Berry (-02),
White Herb (-03), the status (-06), the flinch (-07), a Z-Crystal failing before targeting (-08), E2's item and Unburden (-05).
RE43 (Flame Orb into a Substitute) agrees with its stored oracle result once its `notEstimated: "Fling is not verified for this
game."` expectation is dropped (`fling/re43.ts`).
