# FAMILY 3 design: field, side, reflection and items (status2, items 3 and 4)

Branch `calc-2v2-status-2` (from main 4008ee8). Design only. Nothing under `app/`, `tests/` or `docs/` changed and nothing
was committed. Every file of this design is in `scripts/.cache/calc-audit/status2/design/`, and every name starts with
`field-side-items`.

**Scope (23 moves).** The orchestrator named 20 moves. The census places three more in the same families: Stuff Cheeks
and Embargo (items) and Swallow (cures).

| Group | Moves |
|---|---|
| Reflection | Magic Coat, Snatch |
| Side | Crafty Shield, Mat Block, Lucky Chant, Mist, Court Change, Defog |
| Field | Magic Room, Wonder Room, Mud Sport, Water Sport |
| Items | Corrosive Gas, Bestow, Recycle, Teatime, Stuff Cheeks, Embargo |
| Cures | Aromatherapy, Heal Bell, Purify, Psycho Shift, Swallow |

Swallow consumes the Stockpile state, which belongs to the stages family. Section 5.5.5 states the contract between the two.

**Citations.**
- `PS/` is the read-only pinned source `node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353`.
- `F<nn>` is a probe in `field-side-items-probes.out`. `K<nn>` is CENSUS 1's (`census-moves-probes.out`). App lines are at
  main 4008ee8.

## 0. Files

| File | What it holds |
|---|---|
| `field-side-items.md` | This design. |
| `field-side-items-probes.ts` → `.out` (`.err` empty) | 82 probe ids (112 runs with their controls) on the earlier design's exact harness (`status-eot/design/addendum-sim.ts`). |
| `field-side-items-dex.ts` → `.out` | Per game: the family's learners, the catalog status moves with `flags.snatch`, the onUpdate, onAnyAfterMove and onEnd items, the Berries (all known to `hit-loop.ts stolenEat`), and the abilities the handlers read. |

To reproduce, run from the repo root:

```
npx --no-install tsx scripts/.cache/calc-audit/status2/design/field-side-items-probes.ts > scripts/.cache/calc-audit/status2/design/field-side-items-probes.out
npx --no-install tsx scripts/.cache/calc-audit/status2/design/field-side-items-dex.ts > scripts/.cache/calc-audit/status2/design/field-side-items-dex.out
```

## 1. Decisions in one table

Every move leaves kind L. The "New state" column names the fields in section 3. "Hook" names the function the mechanic
lives in: `S:` is doubles-status.ts, `K:` is doubles-turn.ts (the kernel), `I:` is doubles-items.ts and `C:` is
calculate.ts or uses-to-ko.ts.

| Move | Games (learners) | New kind / handler | New state | Hook | Randomness | Left as a guard |
|---|---|---|---|---|---|---|
| Magic Coat | swsh 155, usum 239 | M, `magicCoat` (volatile) | `vol.magicCoat` | S: volatile, tryHit (priority 2), sideOrField (foeSide bouncer), bounce | none | none |
| Snatch | usum 180 | M, `snatch` (volatile) | `vol.snatch`, `Use.snatched` | S: prepareHit, sideOrField, earlyBranch, fieldMove | none (two Snatch users at one Speed: 1/2 each) | none |
| Crafty Shield | swsh 7, usum 6 | M, side `craftyshield`, fails `willAct` | `SideState.craftyShield` | S: sideOrField, tryHit (priority 3); K: Feint | none | none |
| Mat Block | swsh 1, usum 5 | M, side `matblock`, fails `matBlock` | `SideState.matBlock` | S: sideOrField; K: hitChecks, conditionsFor (Z/Max quarter), Feint | none | none |
| Lucky Chant | usum 74 | M, side `luckychant` | `SideState.luckyChant` | K: conditionsFor; C: calculateMoveRow (no crit) | none | none |
| Mist | sv 68, swsh 73, usum 74 | M, side `mist` | `SideState.mist` | S: applyBoosts TryBoost; K: searchFor → C: UsesEnv.mist, boost() | none | none |
| Court Change | sv 2, ch 1, swsh 1 | M, `courtChange` (field) | side `clock`, `hazardsFrom` (E2) | S: sideOrField | existing Speed ties after the swap | none |
| Defog | sv 50, ch 15, swsh 134, usum 229 | M, `defog` | side `hazardsFrom` (E2) | S: onHit, applyBoosts, fieldGuard | none | `fieldChange` while a terrain-settled holder is in (until the re-settle enabler) |
| Magic Room | all four | M, `room` | `World.fieldSet` | S: sideOrField, roomEnd Update | existing (Starf at that Update) | Booster Energy waking after the room ends (SV) |
| Wonder Room | all four | M, `room` | `World.fieldSet` | S: sideOrField | none | none |
| Mud Sport, Water Sport | usum 90 / 73 | M, `sport` | `FieldState.mudSport`, `waterSport` | S: sideOrField; C: calculate() power chain | none | the existing power-chain order issue |
| Corrosive Gas | ch 7, swsh 17 | M, `corrosiveGas` | `World.itemsTaken` | S: onHit; I: take | none | none |
| Bestow | usum 43 | M, `bestow` | none | I: give (swapItems' one-way half) | the received Berry's own | none (the `bestowActs` guard is removed) |
| Recycle | sv 22, ch 13, swsh 90, usum 140 | M, `recycle`, fails `recycle` | itemHistory: `MonState.lastItem`, `usedItem`; input `lastItem` | S: onHit; K: consumption paths, applyStep | the restored Berry's own | `needsLastItem` (input absent) |
| Teatime | sv 3, ch 2, swsh 2 | M, `teatime` (field) | none | S: sideOrField; K: forceEat | Starf, Figy | Ripen on a resist Berry before a later hit (existing text) |
| Stuff Cheeks | sv 8, ch 4, swsh 2 | M, `stuffCheeks`, fails `berry` | none | S: onHit; K: forceEat | Starf | as Teatime |
| Embargo | usum 118 | M, `embargo` (volatile) | `BattleBuild.embargoed`, carried `embargo` | K: itemWorks; C: one item gate | none | decision 1 (section 14) |
| Aromatherapy, Heal Bell | swsh 54 / sv 5, ch 2, swsh 58, usum 101 | M, `teamCure` (allyTeam) | `SideState.benchCured` (E2) | S: sideOrField | removes later sleep, freeze and paralysis branches | none |
| Purify | swsh 1, usum 2 | M, `purify` | none (removed from HP_STATUS_MOVES) | S: onHit | none | none |
| Psycho Shift | swsh 18, usum 27 | M, `psychoShift`, fails `userStatus` | none | S: hitOne own TryHit, effects | the moved status's existing branches | none |
| Swallow | all four | M, `swallow`, fails `stockpile` | `vol.stockpile` (stages family), carried `stockpile` | S: onHit, applyBoosts | none | needs the Stockpile input when carried |

"ch" is Champions. Learner counts come from `field-side-items-dex.out`.

**Usage.** In the Champions usage sample every one of these moves sits at 0.00 % of team slots
(`census-usage.out`). No usage data exists for SV, SwSh or USUM. Learner counts are high there: Magic Coat, Defog, Wonder
Room, Mist, Recycle, Heal Bell, Embargo and Snatch each have more than 70 learners in at least one game.

## 2. What the probes add

The census's K25–K31, K39 and K41–K53 already show each move's first-order effect. The table lists the behaviours this
model depends on that no earlier probe showed, and the ones where the pinned code differs from what the census said.

| Probe | Finding | Model consequence |
|---|---|---|
| F01 | A reflected spread move is the holder's own use at its own targets (both foes); the holder's ally still takes the original. | `bounce` runs the use with the holder's targets (it already does for Magic Bounce). |
| F02 | Gen 7+: a Prankster Magic Coat's reflection fails on a Dark-type target. The control (Chansey) paralyses it. | The bounced use carries the Magic Coat use's `pranksterBoosted`. |
| F03 | Mold Breaker does not pass Magic Coat but does pass Magic Bounce. | Magic Coat's check has no `breaks()`. |
| F04, F05 | Stealth Rock comes back to the user's side. An **ally's** reflectable move into the holder comes back too. | foeSide bouncer; the onTryHit check excludes only `target === source`. |
| F06, F07 | A reflected Defog strips the original user's side and clears the terrain. A reflected Purify cures the original user and heals the holder. | Generic: the bounced use is the holder's. |
| F10–F17 | Snatch takes an ally's move and only the first snatchable move. The original user's Protean still acts (PrepareHit before Snatch, priority −1). A snatched Substitute is paid by the Snatch user and Recover heals it. A Snatch user knocked out first takes nothing. Paralysis is checked only at the Snatch action (3/4 and 1/4). A Tailwind goes to the Snatch user's side. A snatched Swallow heals 1/4 and the original user keeps its Stockpile. | Section 5.1.2. |
| F20–F26 | Crafty Shield fails after three +4 Protects. It blocks a spread status move but not Stealth Rock, Haze or Body Slam. It blocks Acupressure aimed at its own user. It runs before Magic Coat (no reflection). Feint removes it. | Section 5.2.1. |
| F30–F32 | A Max Move gets through Mat Block at a quarter (`-zbroken`) and its foe drop still lands. The Mat Block user's **own ally's** Earthquake does not hit it. On the second turn out Mat Block fails. | Section 5.2.2. |
| F35, F36 | Lucky Chant stops Merciless's certain crit and a stage-4 crit. | No crit at all into its side. |
| **F40** | **Mirror Armor runs before Mist.** The Growl into Corviknight is reflected onto Snorlax even under Mist. | Side-condition handlers have no Speed (`PS/sim/battle.ts:1216-1231`, effectHolder is the side), so they sort after the Pokémon's own TryBoost (`comparePriority`). |
| F41–F45 | Mist stops an ally's drop (Spicy Extract's Defense −2, not its Attack +2). An Infiltrator foe passes. Parting Shot drops nothing and does not switch. Mist on the attacker's side stops King's Shield's and Gooey's drops. | Section 5.2.4. |
| F140 | Memento's user faints even when Mist or Clear Body stop every drop. | Today's `faintUser` order is right. |
| F50–F53, F142 | Court Change moves layers and durations; the moved Tailwind keeps its turns. With nothing to move it fails. Wide Guard does not move. Wind Rider does not activate. | Section 5.2.5. |
| F55–F61 | Defog's evasion drop comes first, and Mist on that side stops it before Mist is removed. Into a Substitute there is no drop, but Reflect still goes. Into its own ally, its own side's screens and the terrain go. With nothing to remove, Defog "fails" and the terrain is still cleared. Defiant gets +2. **Quark Drive ends with Electric Terrain** (Drain Punch: 134 vs 176). Champions: hazards go on both sides, Reflect and Safeguard on the target's side. | Section 5.2.6. |
| F65, F143 | Magic Room ended mid-turn: White Herb acts at the AfterMove, then at the Update Sitrus, Lum (a confusion from before) and Mental Herb (a Taunt from before) act. | The room-end Update (section 5.3.1). |
| F66, F68, F69 | Magic Room started mid-turn grounds an Air Balloon holder, and gen 9 re-sorts (Choice Scarf off). Ended and restarted in one turn, it has 5 turns (4 after the countdown). | `fieldSet`. |
| **F67, F67b** | **Magic Room's item End calls do nothing.** The room is in `pseudoWeather` before `FieldStart` (`PS/sim/field.ts:200-210`), so `singleEvent('End')` on the ignored item is suppressed (`PS/sim/battle.ts:607-611`). Utility Umbrella's `inactive` stays unset and Cherrim keeps its form. | The census's "Utility Umbrella re-runs WeatherChange" does not happen: no guard. |
| F72 | Wonder Room ended mid-turn: the later Body Slam into Chansey does 135 again. | Toggle. |
| F75, F76 | Mud Sport reads the type after ModifyType (Galvanize Body Slam: 54 vs 162). Water Sport chains with Technician, Charcoal and Helping Hand: 5 vs 13. | calculate() power chain. |
| F80–F85 | Sticky Hold keeps its item; Mold Breaker takes it. A Champions Mega Stone stays and a Substitute blocks. Unburden re-sorts (Drifblim before Garchomp). A removed Air Balloon lets Earthquake hit. **Symbiosis does not act on takeItem.** Magic Bounce reflects inside the original's TryHit, and the bounced use clears the items first. | Section 5.4.1. |
| F88 | Bestow's Sitrus is eaten at the action's Update. Bestow passes Protect. | Section 5.4.2. |
| F90–F96 | Knock Off, a popped Air Balloon and Bug Bite leave no `lastItem`. A Sitrus eaten mid-turn, a Sitrus eaten on an earlier turn and a Focus Sash used this turn all come back. | itemHistory (section 4.1). |
| F100–F103 | Teatime under Magic Room: every Berry is eaten with no effect, but Cheek Pouch heals. It reaches a Protecting Pokémon and misses one in Dig. Unnerve does not stop it. A Figy Berry confuses a Modest eater. Heal Block stops the Sitrus heal. Ripen doubles it. | forceEat (section 5.4.4). |
| F105–F108 | Stuff Cheeks at +6 Defense eats nothing. With Contrary it gives −2 and eats. Under Magic Room: +2 Defense, eaten, no heal. Unnerve does not stop it. | Section 5.4.5. |
| F110–F113 | Psycho Shift: bad poison moves with a fresh stage (1/16). Synchronize passes nothing back. Safeguard stops it and the user stays burned. The target's Lum cures the moved status at the Update. | Section 5.5.4. |
| F115, F116 | Purify at full HP heals nothing. Against Comatose it fails. | Section 5.5.3. |
| F120–F126 | **The bench is cured** (abilities off the field are ignored, `PS/sim/pokemon.ts:859`: Sap Sipper and Soundproof there are cured). An ally behind a Substitute is not cured by Aromatherapy. An active Good as Gold ally is immune to Heal Bell. Gen 7: the Soundproof user stays poisoned. Mold Breaker passes Soundproof. A snatched Heal Bell cures the Snatch user's team, bench included. | Section 5.5.1. |
| F130–F133 | Embargo: Air Balloon off. Knock Off keeps its 1.5x (45 = 45). Magic Coat reflects Embargo, and Leftovers then heals nothing. Fling fails. | Section 5.4.6. |
| F135 | Swallow on 3 layers heals in full, then −3/−3 and the Stockpile ends. | Section 5.5.5. |

**K43 was not valid evidence.** CENSUS 1's K43 ("the bench cured") calls `setStatus` on a bench Pokémon. That returns
false for an inactive one, so the bench never had a status and Aromatherapy failed (`-fail` in its output). F120 sets the
status directly and shows the cure. The census's claim is right; its probe was not.

## 3. New state

### 3.1 doubles-world.ts

```ts
// MoveVolatiles (doubles-world.ts:22-54) gains:
/** Magic Coat this turn (PS/data/moves.ts:10703-10733): reflectable moves aimed at it go back; `prankster` is the Magic
 *  Coat use's pranksterBoosted (gen 7+), which the reflected single-target use keeps (F02). */
magicCoat?: { prankster: boolean };
/** Snatch this turn (PS/data/moves.ts:17116-17133): the next snatchable move of any Pokémon is this Pokémon's. */
snatch?: true;
/** Stockpile (stages family; PS/data/moves.ts:17961 stockpile condition): layers and the per-stat counters onEnd boosts by. */
stockpile?: { layers: 1 | 2 | 3; def: number; spd: number };

// MonState (doubles-world.ts:92-129) gains (itemHistory, section 4.1; kept only while the turn has a reader):
/** The item it last used or ate (sim/pokemon.ts:1800, 1841 lastItem), set this turn. Absent: none this turn. */
lastItem?: string;
/** It used or ate an item this turn (usedItemThisTurn: Pickup, Symbiosis). */
usedItem?: true;

// SideState (doubles-world.ts:131-137) gains:
craftyShield: boolean; matBlock: boolean;          // this turn only (duration 1)
mist: boolean; luckyChant: boolean;                // 5 turns; luckyChant is USUM only
/** The clock each condition up on this side now runs on (section 4.3); absent key: this side's own pre-turn clock. */
clock?: Partial<Record<SideClockFlag, DoublesSideId | "set">>;
/** The pre-turn hazards this side holds now: absent its own, the other side's after an odd number of Court Changes,
 *  null when Defog, Rapid Spin, Mortal Spin or Tidy Up cleared them. `hazards` stays the list that landed this turn. */
hazardsFrom?: DoublesSideId | null;
/** Aromatherapy or Heal Bell cured this side's Pokémon not in battle (PS/data/moves.ts:566-585, 8250-8268; F120-F126). */
benchCured?: true;

// FieldState (doubles-world.ts:138) adds "mudSport" | "waterSport" to its Pick (BattleConditions gains them, section 3.3).

// World (doubles-world.ts:158-198) gains:
/** Rooms, Sports, Gravity and Trick Room that are up now and were set during this turn (a fresh duration), for the end of turn's
 *  turn facts (doubles-eot.ts roomFact) and the next turn's clock (E2). */
fieldSet?: Partial<Record<"magicRoom" | "wonderRoom" | "trickRoom" | "gravity" | "mudSport" | "waterSport", true>>;
/** During one action: the Pokémon whose item a takeItem removed (Corrosive Gas; Knock Off, Thief, Covet, Bug Bite later):
 *  no Symbiosis (F84). eventGuards reads and clears it, as itemsMoved. */
itemsTaken?: DoublesSlotId[];

type SideClockFlag = "reflect" | "lightScreen" | "auroraVeil" | "tailwind" | "safeguard" | "mist" | "luckyChant";
```

`cloneWorld` (doubles-world.ts:328-340) copies `fieldSet` and `itemsTaken`. `discreteKey` (:449-453) adds `fieldSet`.
`sides` and `mons` are already in the key, so the new side and mon fields are too. `startWorld` (doubles-turn.ts:842-845)
starts every new side flag at false.

### 3.2 doubles-types.ts (contract)

```ts
// DoublesCarried (doubles-types.ts:95-137) gains:
/** USUM: Embargo from an earlier turn (its turns left do not matter within the turn). */
embargo?: true;
/** Stockpile from earlier turns: layers and the counted Defense and Sp. Def changes (negative: each layer that changed the stat). */
stockpile?: { layers: 1 | 2 | 3; def: number; spd: number };

// DoublesPokemonInput (doubles-types.ts:139-151) gains:
/** The item it last used or ate before this turn (pinned pokemon.lastItem); null: none; absent: unknown. Recycle reads it. */
lastItem?: string | null;

// DoublesOutcome.sides[side] (doubles-types.ts:376-382) gains:
mist?: boolean; luckyChant?: boolean;
clock?: Partial<Record<SideClockFlag, DoublesSideId | "set">>;
hazardsFrom?: DoublesSideId | null;
benchCured?: true;
// DoublesOutcome (doubles-types.ts:372-388) gains:
fieldSet?: Partial<Record<"magicRoom" | "wonderRoom" | "trickRoom" | "gravity" | "mudSport" | "waterSport", true>>;
// DoublesOutcome.field picks mudSport and waterSport too (USUM; always false elsewhere).
// DoublesOutcomeMon.volatiles: "embargo" is added while an Embargo stands (USUM).
```

### 3.3 types.ts (shared, all optional, so 1v1 stays byte-equal)

```ts
// BattleConditions (types.ts:272-296), "Doubles turn only":
mudSport?: boolean; waterSport?: boolean;
// SideConditions (types.ts:239-269), "Doubles turn only":
luckyChant?: boolean;
/** The protection a Z-Move or Max Move breaks at a quarter, when it is not the target's own (Mat Block). */
protectName?: string;
// BattleBuild (types.ts), "Doubles turn only":
/** USUM: its item has no effect (Embargo, PS/sim/pokemon.ts:879-886 ignoringItem); Knock Off and Bug Bite still find it. */
embargoed?: true;
```

### 3.4 status-table.ts and its generator

- `StatusFlags` gains `snatch`. The generator's `FLAGS` (`status-eot/build/track-a-gen-status-table.ts:41`) adds `"snatch"`.
  The per-game lists are in `field-side-items-dex.out`. USUM has 75 snatchable status moves; its Howl targets `self`, while
  gen 9's targets `allies`. Only USUM has Snatch, but the flag is emitted for every game.
- Kinds: a status2 classification overrides the 23 rows (L → M). The `HANDLERS` and `FAILS` keys are:

| Move | handler | fails |
|---|---|---|
| magiccoat | magicCoat | — |
| snatch | snatch | — |
| craftyshield | craftyShield | willAct |
| matblock | matBlock | matBlock |
| luckychant | luckyChant | — |
| mist | mist | — |
| mudsport, watersport | sport | sport |
| magicroom, wonderroom | room | — |
| courtchange | courtChange | — |
| defog | defog | — |
| corrosivegas | corrosiveGas | — |
| bestow | bestow | — |
| recycle | recycle | recycle |
| teatime | teatime | — |
| stuffcheeks | stuffCheeks | berry |
| embargo | embargo | — |
| aromatherapy, healbell | teamCure | — |
| purify | purify | — |
| psychoshift | psychoShift | userStatus |
| swallow | swallow | stockpile |

- `tests/source/doubles-status-moves.test.ts` checks the new flag and keys per game against the pinned dex.

## 4. Shared building blocks

### 4.1 itemHistory (`lastItem`, `usedItem`), shared with the guards family

CENSUS 2's enabler (`census-guards.md` §5 itemHistory) is needed by Recycle here, and later by Harvest, Pickup, Symbiosis
and Fling.

**Pinned behaviour.** Only `eatItem` and `useItem` set `lastItem` and `usedItemThisTurn` (`PS/sim/pokemon.ts:1768-1849`).
These do not: `takeItem` (Knock Off, Thief, Covet, Bug Bite, Pluck, Incinerate, Corrosive Gas), Trick, Switcheroo, Bestow,
a Sticky Barb moving, and a popped Air Balloon (`PS/data/items.ts:197-199` airballoon onDamagingHit clears `item` directly). The
probes show each case (F90–F96). `lastItem` survives switching from gen 5 (`PS/sim/battle-actions.ts:127-130` copies it
only in gen 4).

**Cost.** Turn it on only where it is read. `Ctx.tracksItems` is true when any action is Recycle (later also: a Harvest or
Pickup holder, a Symbiosis holder). Worlds then carry `lastItem` and `usedItem`, which split merges. Other turns are
unchanged byte for byte.

**Where the engine consumes an item (each sets `lastItem = <item>; usedItem = true`).** The kernel exposes one helper,
`kernel.noteItemUse(w, slot, item)`, a no-op unless `tracksItems`.

| Path | Line | Item |
|---|---|---|
| The start settle (the folded build lost its item) | doubles-turn.ts `startWorld` :824-851 | The input item unless it is Air Balloon. `usedItem` only for `items.usedAtUpdate` (the turn's first Update; entry uses were last turn's). |
| `turnStartUpdate` curing Berry | doubles-status.ts:175 | the Berry |
| `kernel.ateBerry` | doubles-turn.ts:1687 | every HP or pinch Berry the kernel eats (afterLoss, berryDue, confusionHit) |
| confusionHit's Focus Sash | doubles-status.ts:434 | focussash |
| `cureConfusionBerry`, updateAll's cures and Mental Herb, `receivedItem` | doubles-status.ts:545, 2010-2025, 2059-2075 | the item |
| `giveStatus` curing Berry (target and source) | doubles-status.ts:2205, 2214 | the Berry |
| applyBoosts White Herb | doubles-status.ts:2327 | whiteherb |
| `receive` White Herb | doubles-items.ts:118 | whiteherb |
| The end of turn (eatCuring, updateSlot's eat, whiteHerb, ejectPack, micleBerry) | doubles-eot.ts:874-1016 | the item (for the E2 outcome only) |
| forceEat (Teatime, Stuff Cheeks) | section 5.4.4 | the Berry |

**Inside the pairwise step** (`applyStep` doubles-turn.ts:2016-2165) the step returns builds and does not say how an item
went. Classify each item X that the attacker or target held before and not after:
- **No lastItem** when X was taken: the move is Knock Off (own id, not transformed) and X was not a resist Berry the hit
  ate (`entry.trace.result.rawDesc.defenderItem` with `getBerryResistType`, as `stolenInStep` reads it); or `stolenInStep`
  returned X (Bug Bite, Pluck, Incinerate); or Thief or Covet moved X to the attacker; or X is Air Balloon on the target;
  or X is a Sticky Barb that moved to the attacker.
- **Otherwise X was used or eaten** (Sitrus mid-hit, resist Berries, Focus Sash, Weakness Policy, Kee, Maranga, Absorb Bulb,
  Cell Battery, Luminous Moss, Snowball, Enigma, Jaboca, Rowap, a Gem, Throat Spray, Power Herb, White Herb,
  Red Card, Eject Button): `noteItemUse`.

### 4.2 forceEat (Teatime, Stuff Cheeks): one kernel helper

`kernel.forceEat(w, slot, use)` is pinned `eatItem(true)` (`PS/sim/pokemon.ts:1768-1809`): no TryEatItem, so no
Unnerve, no HP line, and no Berserk lock. The steps:
1. `UseItem`. Nothing in the four catalogs stops it.
2. `singleEvent('Eat')`, skipped when the holder ignores its item (Magic Room, Klutz, Embargo: `PS/sim/battle.ts:607-611`;
   F100, F107). The effect table is `hit-loop.ts stolenEat(item, { baseMaxHP, ability, ignoresItem })`. Every catalog
   Berry is known to it (`field-side-items-dex.out` `unknownToStolenEat` is empty).
   - The heal goes through `healWorlds` (none at full HP or under Heal Block: F102; Ripen ×2: F103).
   - Stages go through `selfBoost` (pinch Berries, Kee, Maranga; Ripen ×2; Contrary and Simple).
   - Cures cover the status and, for Lum and Persim, confusion.
   - A Figy-family Berry confuses through `berryConfusion`.
   - Lansat sets `settledFocusEnergy`.
   - Starf branches, one world per stat: `ateBerry`'s existing loop.
3. `runEvent('EatItem')`. Cheek Pouch heals `floor(baseMaxHP/3)` even when the Eat was skipped (F100: Dedenne 50 → 97;
   Heal Block stops it). Ripen marks a resist Berry: with a later damaging move, the existing `REASONS.notIn2v2("Ripen")`
   (as `stolenFacts`, doubles-turn.ts:2211).
4. The item is gone (`itemId ""`), then `noteItemUse`, then AfterUseItem: Unburden active, and the Symbiosis guard in
   `eventGuards` (doubles-turn.ts:1155-1159) applies as is.

`ateBerry` (doubles-turn.ts:1687-1705) already does the item loss, pinch rise, Figy confusion, Lansat and Starf.
forceEat calls it after the heal and cures, with a `suppressed` flag that skips the rise, confusion, Lansat and Starf, and
adds Kee and Maranga's +1.

### 4.3 Side clocks, hazards and `fieldSet` in E2 (and a latent Training fix)

Training's `nextClock` (`app/(app)/training/ai/evaluate.ts:95-131`) counts each side condition from the decision's clock.
It treats `before > 0 ? before − 1 : SET` as the rule, and it adds the hazards that landed. That is wrong after:
- **Court Change.** The Tailwind now on a side runs on the *other* side's clock (F50, F51).
- **Defog, Rapid Spin, Mortal Spin, Tidy Up.** The pre-turn hazards are gone, yet `next = { ...before }` keeps them. Rapid
  Spin and Mortal Spin are in Champions today (Rapid Spin has 15 learners), so this is a **latent Training error now**.
- **A room or condition removed and set again in one turn** (F69). Its clock is fresh.

The engine reports provenance:
- Each side condition set this turn gets `clock[flag] = "set"`. The writers are: fieldMove SIDE_MOVES (doubles-status.ts
  :879-887), sideOrField Safeguard (:1847-1852), Mist, Lucky Chant, and G-Max Resonance's Aurora Veil in maxEffects.
- **Court Change** swaps the flags and their `clock` entries. An absent entry moves as the explicit side it came from. It
  also swaps `hazards` and `hazardsFrom` (absent becomes the explicit side id).
- **A hazard clear** sets `hazards = []` and `hazardsFrom = null`. The writers are Defog (section 5.2.6) and today's Rapid
  Spin and Mortal Spin path (doubles-eot.ts:1150-1155), which today empties only `hazards`. Tidy Up follows when the
  stages family models it.
- **A room or Sport set this turn** sets `fieldSet[flag] = true`, and removing it deletes the entry. The writers are the
  `room` and `sport` handlers here, and today's Trick Room and Gravity in fieldMove (doubles-status.ts:889-899).

`outcomeOf` (doubles-turn.ts:3570-3578) copies these fields. `mergeOutcomes` (:3590-3595) already keys on `outcome.sides`
and `outcome.field`, and adds `fieldSet`.

Training (`nextClock`): a condition up after the turn takes `source = clock?.[flag] ?? side`. Then `"set"` gives
`SET_THIS_TURN`, and otherwise `clock.sides[source][flag]` with the countdown. The hazards start from
`hazardsFrom === undefined ? own : hazardsFrom === null ? none : clock.sides[hazardsFrom]`, and the landed ones are added
on top. Rooms use `fieldSet` to tell a fresh room from a continuing one. Safeguard currently ignores the outcome
(`safeguard: Math.max(0, before.safeguard − 1)`); it gets the same rule (found on the way, section 13).

### 4.4 TryHit order for status moves (doubles-status.ts tryHit :1209-1249)

Pinned TryHit sorts left to right (`PS/sim/battle.ts:421-426`): order, then priority, then index. The index follows
collection order: volatiles, then the ability, then the item, then side conditions, then field conditions
(`PS/sim/battle.ts:1049-1090`). The order after this design:
1. Wide Guard and Quick Guard (side, 4), then Psychic Terrain (field, 4). Unchanged.
2. The Protect family (volatile, 3). Unchanged.
3. **Crafty Shield** (side, 3; PS/data/moves.ts:3162-3166). New.
4. **Magic Coat** (volatile, 2; :10711-10721). New.
5. Magic Bounce, Overcoat, the absorbing abilities, Good as Gold, Soundproof, Oblivious, Safety Goggles. Unchanged.

For damaging moves, `hitChecks` (doubles-turn.ts:1558-1583) runs Wide Guard and Quick Guard (4), then the target's Protect
(3), then **Mat Block** (3, side, after the volatile), then Telepathy and the absorbers.

### 4.5 TryBoost order (applyBoosts doubles-status.ts:2258-2286)

Pinned TryBoost uses `speedSort` with `comparePriority`. Clear Amulet has priority 1. The target's ability handlers (Clear
Body, Hyper Cutter, Mirror Armor...) and an ally's Flower Veil carry their holder's Speed. **Mist carries none**
(`PS/sim/battle.ts:1216-1231`: a side condition's effectHolder is the side), so it runs last at priority 0 (F40). Mist goes
after the existing checks and after Mirror Armor's reflection:

```ts
// after the Mirror Armor block (doubles-status.ts:2274-2285):
const mistBlocks = other && w.sides[slotSide(slot)].mist && !(opts.effect === "move" && use?.infiltrates && kernel.isFoe(source!, slot));
if (mistBlocks && Object.values(boost).some((amount) => amount! < 0)) {
  for (const stat of Object.keys(boost) as Stage[]) if (boost[stat]! < 0) delete boost[stat];
  facts.push(`${kernel.moveName("mist")}: its stats are not lowered.`);
}
```

Pinned Mist prints its message only for a move without secondaries (`PS/data/moves.ts:12095`). The fact is shown only when
`use` is a status move's use. The infiltrates exception covers a move only (`effect.effectType === 'Move'`): for a foeDrop
from a damaging path, pass `use` as `null` and the attacker's Infiltrator through a new `opts.infiltrates`.

## 5. The moves

Each move's entry gives the Showdown behaviour (cites and probes), the model, its hooks, what it does at the end of turn,
in E2 and in Training, its facts, the guards it leaves, and its oracle ids. Facts follow the house rules: facts only,
names from `kernel.names`, the existing phrasing patterns.

### 5.1 Reflection

#### 5.1.1 Magic Coat (SwSh, USUM)

**Showdown.** PS/data/moves.ts:10692-10738; gen 8 mod restores it (PS/data/mods/gen8/moves.ts:396-399).
- Priority +4, self. Its volatile lasts this turn.
- onStart stores the use's `pranksterBoosted` (:10705-10709).
- onTryHit (priority 2) on a reflectable move from **any other Pokémon** (an ally too, F05), not one already bounced, not
  while the holder is semi-invulnerable. The holder `useMove`s it back at the source with that `pranksterBoosted`, and the
  original stops for this target (`return null`; :10712-10721; F01, F02, K49).
- onAllyTryHitSide does the same for side moves (hazards), with `pranksterBoosted` false (:10722-10732; F04).
- It is not an ability, so Mold Breaker passes nothing (F03).

**Model.**
- `volatile()` (doubles-status.ts:1497) adds `case "magiccoat"`: `setVol(w, slot, { magicCoat: { prankster: use.prankster } })`.
  `use.prankster` is makeUse's gen 7+ Prankster flag (:974).
- `tryHit()` puts its check after Crafty Shield (section 4.4):

```ts
if (mon.vol.magicCoat && slot !== user && !use.bounced && flags.reflectable && !mon.eot.hidden) {
  blocked(kernel, use, slot, w, `${kernel.moveName("magiccoat")}: ${move.name} goes back to ${kernel.names[user]}.`);
  return { pass: false, worlds: bounce(kernel, w, use, slot, { prankster: mon.vol.magicCoat.prankster }) };
}
```

- `bounce` (:1276-1280) and `makeUse` (:964-979) take an optional `prankster` override (Magic Bounce keeps false). The
  reflected use's `tryImmunity` (:1307) then makes a Dark-type target immune (F02).
- `sideOrField`'s foeSide bouncer (:1853-1862) adds the foe side's `vol.magicCoat` holders beside the Magic Bounce holders.
  When both are present, the fact names the first in pinned order: Speed descending (Magic Bounce uses its holder's
  unboosted Speed, `PS/sim/battle.ts:1004-1007`; Magic Coat its action Speed), then volatile before ability. The hazard
  lands on the user's side either way.

**Interactions.** A bounced use runs every family's handler from the holder: Defog (F06), Purify (F07), Embargo (F132),
Soak, Entrainment and the rest. `use.bounced` keeps a second bounce out (Magic Bounce or another Magic Coat). Crafty
Shield on the holder's side comes first (F25).

**Randomness.** None. **End of turn.** Nothing. **E2.** Nothing; the volatile ends with the turn.

**Facts.**
- Step: `Magic Coat: reflectable moves aimed at {name} go back to their users this turn.`
- Hit: `Magic Coat: {Move} goes back to {user}.`
- Side bounce: `Magic Coat: {Move} goes back to {user}'s side.`

**Guards left.** None (semi-invulnerable holders are already guarded: `REASONS.semiInvulnerable`).

**Oracle.**
- FS01a-swsh: F01 with Snorlax's later Body Slam at −1 Atk.
- FS01b-usum: F02 with Lapras Body Slam.
- FS01c-swsh: an ally's Thunder Wave (F05) with a later move of the paralysed ally.
- FS01d-usum: Stealth Rock reflected (`outcomes: true`).

#### 5.1.2 Snatch (USUM)

**Showdown.** PS/data/moves.ts:17105-17138; gen 7 mod (PS/data/mods/gen7/moves.ts:887-890).
- Priority +4, self, bypasssub. Its volatile lasts this turn.
- `onAnyPrepareHit` (priority −1, :17121-17132) catches the next move with `flags.snatch` from any Pokémon (its own ally's
  too: F10), but not a Z-Move or Max Move, not a snatched one (`sourceEffect === 'snatch'`), and not while the Snatch user
  is Sky Dropped.
- The volatile is removed and the Snatch user `useMove`s it with no target: self, its own side, its own team (F11, F13,
  F16, F126). The original stops (`return null`).
- The original user's own PrepareHit handlers run first (priority 0): a Protean Greninja still becomes Normal (F12).
- The stolen use runs no BeforeMove (F15); a Snatch user knocked out first takes nothing (F14).
- Swallow's onTry lets a snatched use pass without Stockpile, and its heal reads the Snatch user's own Stockpile or 1 layer
  (:18584, 18588; F17).

**Model.**
- `volatile()` adds `case "snatch"`: `setVol(w, slot, { snatch: true })`.
- `Use` (doubles-status.ts:690-710) gains `snatched?: true`.
- A helper in doubles-status.ts:

```ts
/** The Snatch user that takes this use (PS/data/moves.ts:17121-17132), or null; two at one Speed: one world each. */
function snatchers(kernel: TurnKernel, w: World, use: Use): { world: World; by: DoublesSlotId }[] | null
// Candidates: living slots with vol.snatch, other than use.user. Applies when use.entry.flags.snatch, !use.snatched,
// !use.bounced, and the status move is not a Z-Move. Highest kernel.speedOf first; tied ones split equally (speedSort's
// shuffle).
```

  For each stealing world, delete `vol.snatch`, add the step fact on the original action, and run the use from the Snatch
  user:
  `makeUse(kernel, w, use.action, by, move, entry, use.priority, false, null)` with `snatched: true`, then `runUse(…, null)`.
  The statistics stay on the original action, as for a bounce. No BeforeMove runs.
- **Where the hook runs: at each PrepareHit point**, after the move's own Try checks, so pinned order is kept.
  - `prepareHit` (:1134-1145), after `proteanGuard`: the pipeline's self, allies and ally targets.
  - `sideOrField` (:1846), after `proteanGuard`: Safeguard, Mist, Lucky Chant, Mat Block, Aromatherapy, Heal Bell, Gear Up,
    Magnetic Flux.
  - `earlyBranch` (:837-840), after the `willAct` check: Wide Guard and Quick Guard.
  - `fieldMove` (:879-887), after Aurora Veil's hail check and **before** the "already up" check, which then reads the
    Snatch user's side: Reflect, Light Screen, Aurora Veil, Tailwind.
- A fainted Pokémon's MoveVolatiles end (sim faint clears volatiles). `faint` (doubles-turn.ts:1218-1236) clears
  `vol.snatch` and `vol.magicCoat` as it already clears `vol.substitute`.

**Interactions.** It steals every family's snatchable move: Stockpile, Swallow, Minimize, Power Trick, Conversion,
Camouflage, Gear Up, Magnetic Flux, Healing Wish, Lunar Dance, Wish, Ingrain, Aqua Ring, Magnet Rise, Imprison, Recycle,
Heal Bell, Aromatherapy, the screens, Tailwind, Safeguard, Mist, Lucky Chant and Mat Block. Each runs that family's handler
from the Snatch user. Gen 7 keeps its frozen order: a stolen Tailwind changes no order this turn.

**Randomness.** None of its own. Two Snatch users at one Speed: 1/2 each. A stolen move brings its own randomness.

**End of turn.** Only what the stolen move set up (Aqua Ring, Ingrain, a screen...). **E2.** That state.

**Facts.**
- Step: `Snatch: {name} takes the next move that can be snatched this turn.`
- On the stolen action: `Snatch: {snatcher} takes {Move}.`
- The stolen effects are hit facts on the Snatch user: `Jolteon: +2 Attack.` (aboutSlot).

**Guards left.** None. Sky Drop is already a presence guard.

**Oracle (usum only).**
- FS02a: a foe's Swords Dance taken, then the Snatch user attacks.
- FS02b: a foe's Reflect taken, then hits into both sides.
- FS02c: a paralysed Snatch user (F15) with a later hit.
- FS02d: a Substitute taken, then a hit into the Snatch user.
- FS02e: a snatched Heal Bell (F126, `outcomes: true`).

### 5.2 Side

#### 5.2.1 Crafty Shield (SwSh, USUM)

**Showdown.** PS/data/moves.ts:3143-3173.
- Priority +3, allySide. It lasts this turn. onTry is `!!queue.willAct()`: it fails after three +4 Protects (F20). A
  second one in a turn fails (addSideCondition, no restart).
- onTryHit (priority 3) blocks every Status move whose `target` is not `self` or `all` into its side, from foes and allies
  (:3164; K47). That includes Acupressure aimed at its own user (F24) and a spread status move (F21).
- Side moves are not blocked (they use TryHitSide, not TryHit; F21), and neither are damaging moves (F23).
- It comes before Magic Coat (F25). Feint removes it (`PS/sim/battle-actions.ts:764-768`; F26).

**Model.**
- In `sideOrField`, `entry.side === "craftyshield"`: the `willAct` failure (`!w.remaining.length`), then the
  already-up failure, then set `SideState.craftyShield`.
- In `tryHit`, after the Protect family:

```ts
if (side.craftyShield && use.move.category === "Status" && !["self", "all"].includes(use.targetType)) return no(`${kernel.moveName("craftyshield")} blocks ${move.name}.`);
```

  `use.targetType` is the dex target as used (Acupressure's `adjacentAllyOrSelf` is blocked on its own user).
- The Feint block in `damagingMove` (doubles-turn.ts:1841-1847) also clears `craftyShield` and `matBlock`, as the pinned
  list does.

**Facts.**
- `Crafty Shield: status moves aimed at {name}'s side are blocked this turn.`
- `Crafty Shield blocks {Move}.`
- `Crafty Shield fails: no Pokémon moves after it.`

**E2.** Nothing.

**Oracle.**
- FS03a-swsh: Thunder Wave and Growl blocked, with a later Body Slam.
- FS03b-swsh: Feint breaks it (F26).
- FS03c-usum: before Magic Coat (F25), and it fails as the last action.

#### 5.2.2 Mat Block (SwSh, USUM)

**Showdown.** PS/data/moves.ts:10984-11027.
- Priority 0, allySide, snatch. onTry fails after the user's first turn out (`activeMoveActions > 1`; F32) and with no
  action after it.
- onTryHit (priority 3) blocks any move whose target is not self and that `checkMoveBypassesProtect(…, false)` does not
  pass (PS/sim/battle.ts:1300-1309): damaging moves with the protect flag. Status moves pass (K48).
- It blocks its user's own ally's Earthquake (F31: a side condition).
- A Z-Move or Max Move sets `bypassProtect` and does a quarter (PS/sim/battle-actions.ts:1828-1834). Its own effect still
  lands (F30: 27 vs 109, then Max Wyrmwind's Attack drop).

**Model.**
- In `sideOrField`, `side === "matblock"`: the first-turn rule is a turn fact. `FIRST_TURN_MOVES` (doubles-turn.ts:74)
  adds `matblock`, so the existing "Assumes the attacker's first turn in battle." covers it. Then the `willAct` check and
  the already-up check, then set the flag.
- In `hitChecks`, after the target's own protect:

```ts
if (w.sides[slotSide(slot)].matBlock && !passes()) return { slot, block: { by: "Mat Block" } };
```

- `conditionsFor` (doubles-turn.ts:516-523) sets `defenderSide.protect` and `protectName: "Mat Block"` only for a Z-Move or
  Max Move into a Mat Block side (moveId given). That is exactly the quarter. Payback reads `defenderSide.protect`
  (calculate.ts:1649), so the flag is never set otherwise.
- `protectOutcome` (calculate.ts:1042-1056) uses `protectName` in its line: `Mat Block: {Move} breaks through at 1/4 damage.`

**Facts.**
- `Mat Block: damaging moves aimed at {name}'s side are blocked this turn.`
- `Mat Block blocks {Move}.`
- `Mat Block fails: no Pokémon moves after it.`

**Oracle.**
- FS04a-swsh: Body Slam blocked, Thunder Wave lands, a Max Move at a quarter (F30).
- FS04b-usum: a Z-Move at a quarter, and the ally's Earthquake (F31).

#### 5.2.3 Lucky Chant (USUM)

**Showdown.** PS/data/moves.ts:10502-10529; gen 7 mod :538-541.
- allySide, 5 turns, snatch. `onCriticalHit: false` on its side: no crit at all, a certain one included (K52: Frost
  Breath; F35: Merciless; F36: stage 4).
- The side residual (26.6) counts it down; no HP.

**Model.**
- `sideOrField` sets `SideState.luckyChant` and `clock.luckyChant = "set"` (it fails while up).
- `conditionsFor` puts `defenderSide.luckyChant` for hits into that side and sets `critical: false` for that pair.
- `calculateMoveRow` (calculate.ts:1641-1644): with `defenderSide.luckyChant`, skip `certainCrit` and resolve with
  `isCrit: false`, and clear the engine move's `isCrit`. gen789's crit gate reads `move.isCrit` or Merciless
  (`@smogon/calc/dist/mechanics/gen789.js`), so the engine attacker's Merciless becomes the Run Away stand-in (Merciless
  does nothing else in a calculation).
- 1v1 never sets the field, so it stays byte-equal.

**Facts.** `Lucky Chant starts on {name}'s side.` Row assumption: `Lucky Chant: no critical hit.`

**E2.** `sides.luckyChant` and `clock`. USUM has no Training.

**Input from an earlier turn.** An optional side control (decision 2). Absent means not up, as for Safeguard today.

**Oracle (usum).**
- FS05a: Frost Breath and Merciless.
- FS05b: the field's Critical hit toggle on, Lucky Chant on one side only.

#### 5.2.4 Mist (SV, SwSh, USUM; Past in Champions)

**Showdown.** PS/data/moves.ts:12072-12113.
- allySide, 5 turns, snatch.
- onTryBoost (:12084-12099) deletes every drop from another Pokémon (allies too: F41). The exception is an infiltrating
  **move** from a foe (F42).
- The message shows only for a move without secondaries.
- Mirror Armor acts before it (F40, section 4.5).
- It stops a status move's drops (Growl, Parting Shot with no switch after: F43), damaging secondaries (Snarl: K51),
  contact drops from another Pokémon (King's Shield: F44; Gooey: F45), Octolock's residual drop (the next-move family),
  Defog's evasion drop (F55) and G-Max foe drops.
- Memento's user faints even when nothing falls (F140).

**Model.**
- `sideOrField` sets `SideState.mist` and `clock.mist = "set"` (it fails while up).
- `applyBoosts` gets the check in section 4.5.
- **In the pairwise step**, `UsesEnv` (uses-to-ko.ts:361) gains `mist?: { att?: boolean; def?: boolean }`. `searchFor`
  (doubles-turn.ts:568-611) computes it per pair and adds it to the memo key (:585):
  - `def`: the target's side has Mist and the attacker is another Pokémon, unless the attacker is a foe whose
    move infiltrates (Infiltrator).
  - `att`: the attacker's side has Mist (drops from the target: Gooey, Tangling Hair, a Mirror Armor reflection).
- `boost()` (uses-to-ko.ts:4669-4696) adds, after the Mirror Armor line in the `amount < 0 && byFoe` block:
  `if (who === "def" ? m.env.mist?.def : m.env.mist?.att) continue;`.
  The step's `byFoe` means "from the other battler", which is the rule Mist needs.
- With no env (1v1) nothing changes.

**Facts.** `Mist starts on {name}'s side.` The drop blocked: `Mist: its stats are not lowered.` (hit fact, status moves
only.)

**E2.** `sides.mist` and `clock`.

**Oracle.**
- FS06a-sv: Snarl's drop stopped, then a special hit.
- FS06b-swsh: Mist with Mirror Armor (F40); the reflected drop changes the attacker's later physical hit.
- FS06c-usum: Parting Shot stays in, and King's Shield's drop is stopped.

#### 5.2.5 Court Change (SV, Champions, SwSh)

**Showdown.** PS/data/moves.ts:3032-3098.
- Target all, onHitField, no protect flag.
- It swaps these between the two sides with their state (durations, layers): Mist, Light Screen, Reflect, Spikes,
  Safeguard, Tailwind, Toxic Spikes, Stealth Rock, the three Pledge fields, Sticky Web, Aurora Veil, Lucky Chant and the
  G-Max side conditions (F50, F51).
- It fails with none (F52). Wide Guard, Quick Guard, Crafty Shield and Mat Block stay (F53).
- It runs no SideConditionStart, so Wind Rider does not activate (F142).
- Gen 8+ re-sorts after it (K46).

**Model.** In `sideOrField`, handler `courtChange`:
- Swap `reflect`, `lightScreen`, `auroraVeil`, `tailwind`, `safeguard`, `mist`, `luckyChant` and their `clock` entries.
- Swap `hazards` and `hazardsFrom` (section 4.3).
- Leave `wideGuard`, `quickGuard`, `craftyShield`, `matBlock` and `faintedThisTurn`.
- The re-sort is the walk's own: `speedOf` reads `w.sides`.
- The failure needs the pre-turn hazards, which only Training has. It changes no number, so no failure fact is given.

**Facts.** `Court Change: the two sides' conditions are swapped.`

**E2 and Training.** The provenance in section 4.3. The Pledge and G-Max side conditions are not inputs (Training rolls
them out), so there is nothing to swap.

**Oracle.**
- FS07a-sv: the opponent's Tailwind moves (order) and own Reflect moves (damage).
- FS07b-champions: `outcomes: true` with hazards and Tailwind; checks `clock` and `hazardsFrom`.
- FS07c-swsh: Wide Guard stays.

#### 5.2.6 Defog (all four)

**Showdown.** PS/data/moves.ts:3448-3482; gen 7 mod PS/data/mods/gen7/moves.ts:125-147.
- protect, reflectable, bypasssub; target normal, so an ally works (F57).
- onHit, in order:
  1. Evasion −1 from the user unless the target has a Substitute and the move does not infiltrate (F56). It goes through
     boost: Mist (F55), Clear Body, Mirror Armor, Defiant (F59), Eject Pack and White Herb.
  2. The target's side loses Reflect, Light Screen, Aurora Veil, Safeguard, Mist and its hazards.
  3. The user's side loses its hazards.
  4. Gen 8+: `clearTerrain()` runs whatever the result (F58). Gen 7 keeps the terrain (K45 usum).
- The move "fails" (`-fail`) when only screens or Mist went (F55, F56), but they are still gone.

**Model.** Handler `defog` in `onHit`:
- `if (!target.vol.substitute || use.infiltrates) applyBoosts(kernel, w, slot, { evasion: -1 }, user, { use, effect: "move", report: true })`.
- Then clear the target side's flags and their `clock` entries.
- Clear the hazards on both sides (`hazards = []`, `hazardsFrom = null`).
- Gen ≥ 8 with a terrain up: `fieldGuard`, extended with Defog's terrain end, then `w.field.terrain = ""`.

  `fieldGuard` (doubles-status.ts:928-946) reads `FIELD_MOVES` only. A `terrainEnds` argument applies the same check for a
  terrain ending, so Quark Drive (F60), Mimicry, Booster Energy and the Seeds give `REASONS.fieldChange`. The re-settle
  enabler (CENSUS 2 field-change, L) later replaces the guard for terrain moves and Defog together.
- Evasion goes to `vol.stages` (hiddenStageGuard reads only positive stages).

**Facts.**
- The target's `−1 evasion.` (applyBoosts).
- `Defog: {Condition} ends on {name}'s side.` for each removed screen, Safeguard or Mist.
- `Defog: the {Terrain} Terrain ends.`
- `Defog: the hazards on both sides are cleared.`

**End of turn.** No Grassy heal once Grassy Terrain is cleared (doubles-eot.ts reads `w.field.terrain`).

**E2 and Training.** Champions has Defog, so `hazardsFrom = null` matters to Training's clock. Safeguard from an earlier
turn is a rollout today (`bridge.ts:282`), which CENSUS 2's tr-field-side covers.

**Oracle.**
- FS08a-sv: Reflect and Electric Terrain cleared, then a physical hit and an Electric hit.
- FS08b-usum: the terrain stays.
- FS08c-champions: Defiant Kingambit and hazards both sides (`outcomes`).
- FS08d-sv: into a Substitute, and into its own ally.
- FS08e-sv: expected `fieldChange` with Iron Hands (Quark Drive).

### 5.3 Field

#### 5.3.1 Magic Room (all four)

**Showdown.** PS/data/moves.ts:10755-10798.
- Target all, pseudoWeather, 5 turns. Persistent's 7 is gen 4 only.
- A second use ends it (`onFieldRestart` :10784-10786; F65, F69).
- onFieldStart calls each active item's End **after** the room is up, which suppresses it (F67, F67b). Nothing happens at
  the start beyond the suppression itself.
- Suppression (`ignoringItem` PS/sim/pokemon.ts:879-886): every later calculation, Berries at Updates, Speed (gen 8+
  re-sort: F68), grounding (F66) and the end of turn (K25).
- **Ended mid-turn**, its items act again: White Herb at that move's AfterMove (`PS/data/items.ts:7654` onAnyAfterMove),
  then at the action's Update the onUpdate items (`field-side-items-dex.out` items.onUpdate): the HP, pinch and curing
  Berries (Lum against a confusion too: F143), Mental Herb, Booster Energy and Utility Umbrella. Umbrella is a no-op, since
  its End never ran. Leppa needs a move at 0 PP, which never happens within a turn.
- Fractional priorities stay as they were queued (`PS/sim/battle.ts:2619-2650` adds the stored `fractionalPriority`).

**Model.** Handler `room` in `sideOrField`:
- `w.field = { ...w.field, magicRoom: !w.field.magicRoom }`.
- When it starts, `fieldSet.magicRoom = true`; when it ends, delete the entry.
- When it ends, the room-end Update runs on each living Pokémon (`roomEnd(kernel, w, use)` in doubles-status.ts, then the
  action's `updateAll`):
  1. White Herb with a lowered stage (applyBoosts' White Herb branch).
  2. `kernel.berryDue(w, slot)`, extended so Lum and Persim cure a confusion (doubles-turn.ts:1774 reads only `status`).
  3. Mental Herb against Taunt, Encore, Disable or Heal Block (`receivedItem`'s branch, doubles-status.ts:2057-2063).
  4. A Booster Energy held by a Protosynthesis or Quark Drive holder whose field is down: not followed (the `started`
     state is not known).
- Every other reader already reads `w.field.magicRoom` through `itemWorks`, `conditionsFor`, `speedOf`, `priorityOf` and
  `grounded`.
- `GAS_CHANGING_MOVES` (doubles-actions.ts:145-148) drops `magicroom`: `gasShieldGuard` (doubles-turn.ts:1207-1211) already
  catches the Ability Shield change under Neutralizing Gas.
- doubles-eot.ts `roomFact` (:1058-1063) reads `!w.fieldSet?.magicRoom`. A room set this turn has 5 turns, so the turn fact
  "Assumes Magic Room does not end this turn." does not apply.

**Facts.** `Magic Room starts.` / `Magic Room ends.` (as Trick Room). After the room ends, the eaten Berries' heals and
the herbs' facts come from the existing paths.

**Guards left.** `Booster Energy after Magic Room ends is not modelled in 2v2.` (SV, Protosynthesis or Quark Drive holder
whose field is down).

**E2 and Training.** `field.magicRoom` and `fieldSet` (section 4.3). The bridge's ROOMS and its "Magic Room with one turn
left" guard (`bridge.ts:275-280`) stay.

**Oracle.**
- FS09a-sv: start: Life Orb, Sitrus and Leftovers off (K25), Air Balloon (F66), Choice Scarf re-sort (F68).
- FS09b-champions: ended mid-turn (F65 with Champions items: Sitrus, Mental Herb, Lum).
- FS09c-swsh: ended and restarted (F69, `outcomes: true`, `fieldSet`).
- FS09d-usum: start in gen 7 (frozen order) with Leftovers off.

#### 5.3.2 Wonder Room (all four)

**Showdown.** PS/data/moves.ts:20970-21018.
- Target all, 5 turns; a second use ends it.
- Defense and Sp. Def swap in `calculateStat` (PS/sim/pokemon.ts:567-575); Body Press uses the other stat (:20989-20996).
- K53: 135 → 28. F72: ended, 135 again.
- `getStat(stat, true, true)` (Beast Boost, Download) does not swap the stored stat (PS/sim/pokemon.ts:597-610), so the
  engine's `koBoost` is right as it is.

**Model.** Handler `room`: toggle `w.field.wonderRoom` and set `fieldSet`. The calculation already reads
`conditions.wonderRoom`, and so does `confusionRolls` (doubles-status.ts:381).

**Facts.** `Wonder Room starts.` / `Wonder Room ends.`

**Oracle.**
- FS10a-sv: start, with a later Body Slam and a Body Press.
- FS10b-champions: ended mid-turn (F72).

#### 5.3.3 Mud Sport, Water Sport (USUM)

**Showdown.** PS/data/moves.ts:12456-12489 and :20628-20661.
- Target all, pseudoWeather, 5 turns; fails while up (no onFieldRestart).
- onBasePower (priority 1) on Electric or Fire moves: ×1352/4096. The type is the one after ModifyType (F75: Galvanize).
- Field residual 27.4 and 27.3; no HP.

**Model.**
- Handler `sport` sets `FieldState.mudSport` or `waterSport` and `fieldSet` (fails while up). They reach the calculation
  through `...w.field` in `conditionsFor` (doubles-turn.ts:507).
- `makeField` (calculate.ts) attaches them to the engine field as a side object.
- `calculate()` (calculate.ts:316-335) adds `1352` to the base-power chain through `withPowerMods`
  (engine-corrections.cjs:107-120) when the probe's `move.type` is Electric or Fire. The existing order check stays: a chain
  of 3 or more whose order changes the damage gives the existing issue text with the Sport's name. F76's Technician,
  Charcoal and Helping Hand chain gives 3651 or 3650 by order, and the same base power 36, so it is exact.

**Facts.**
- `Mud Sport starts.` / `Water Sport starts.`
- Row assumption: `Mud Sport: Electric moves at 1352/4096 power.` / `Water Sport: Fire moves at 1352/4096 power.`

**Input from earlier turns.** Optional field controls (decision 2).

**Oracle (usum).**
- FS11a: Mud Sport (K39, F75).
- FS11b: Water Sport chain (F76).

### 5.4 Items

#### 5.4.1 Corrosive Gas (Champions, SwSh)

**Showdown.** PS/data/moves.ts:2914-2934; both mods restore it.
- allAdjacent (the user's ally too), protect, reflectable. Each target's `takeItem(source)`:
  - Sticky Hold keeps the item (breakable: Mold Breaker takes it; F80a, F80b).
  - Items whose onTakeItem refuses stay: Mega Stones, Z-Crystals, owned items, a Paradox Pokémon's Booster Energy (F81).
  - A Substitute blocks it (F81).
- The taken item's End runs, and AfterTakeItem: Unburden (`onTakeItem`, PS/data/abilities.ts:5240-5242; F82).
- Symbiosis does nothing (F84). The item is not used, so no lastItem.
- Magic Bounce reflects it inside the original's TryHit (F85).

**Model.** Handler `corrosiveGas` in `onHit` per target:
- No item: `Corrosive Gas fails: {name} holds no item.`
- Sticky Hold (`!breaks`): `Sticky Hold: {name} keeps its item.` (Trick's text).
- `!itemTakeable(runtime, paradox, item, holder, user, false)` (uses-to-ko.ts, as Knock Off reads it):
  `Corrosive Gas fails: {name}'s {Item} cannot be removed.`
- Otherwise `itemId ""`, Unburden active, and `w.itemsTaken` gets the slot.
- `eventGuards` (doubles-turn.ts:1155-1159) skips Symbiosis for `itemsTaken` as it does for `itemsMoved`. The same list
  later fixes the over-guard for Knock Off, Thief and Covet (section 13).
- The spread targets, Wide Guard and the bounce are the pipeline's.
- `GAS_CHANGING_MOVES` drops `corrosivegas`: `gasShieldGuard` catches a lost Ability Shield.

**Facts.** Hit: `Loses its {Item}.` The failures as above.

**End of turn.** Leftovers, Black Sludge, the Orbs and Sticky Barb are gone (residualMon reads the build).

**E2.** Builds.

**Oracle.**
- FS12a-champions: ally and foes, a Mega Stone, a Substitute, Leftovers at the end of turn.
- FS12b-swsh: Sticky Hold and Mold Breaker, Unburden re-sort, Air Balloon and Earthquake (F80–F83).

#### 5.4.2 Bestow (USUM)

**Showdown.** PS/data/moves.ts:1237-1263.
- No protect flag (it passes Protect: F88b), bypasssub; target normal.
- Fails if the target holds an item, if the user has none, or if the user's TakeItem refuses. The user's own Sticky Hold
  lets go (source === holder, PS/data/abilities.ts:4626), as do the item's onTakeItem toward the receiver and setItem.
- The receiver's Start, then the action's Update eats a due Berry (F88a: 80 → 131). The giver's Unburden comes from
  `onTakeItem`.

**Model.** Handler `bestow`, `doubles-items.ts give(kernel, w, action, target, move)` (swapItems' one-way half):
- The failures as above (`itemTakeable(…, thief true)`, as Trick).
- `holder.build.itemId = a`, `giver.build.itemId = ""`, then `unburden(giver)` and `receive(target)`.
- `w.itemsMoved = [target, user]`: the receiver's Update goes through `receivedItem`, and the giver's loss is not a
  Symbiosis use.
- `bestowActs` and its guard (doubles-status.ts:782-812) go.

**Facts.**
- `Bestow: {target} gets {Item}; {user} holds no item.`
- `Bestow fails: {target} already holds an item.`
- `Bestow fails: {user} holds no item.`
- `Bestow fails: {user}'s {Item} cannot be moved.`

**Oracle (usum).**
- FS13a: a Sitrus to an ally at 80 (F88a) with a later hit.
- FS13b: through Protect, with Unburden (frozen order).
- The stored S48-Bestow-before-usum and S48-Bestow-last-usum change from reason checks to full oracle runs (section 11).

#### 5.4.3 Recycle (all four)

**Showdown.** PS/data/moves.ts:14822-14842.
- Self, snatch. It fails while the user holds an item, or with no `lastItem`.
- `setItem(lastItem)` (Start), then the Update eats a due Berry (K28).
- `lastItem` is section 4.1's (F90–F96).

**Model.** Handler `recycle`, fails key `recycle`:
- The user holds an item: `Recycle fails: {name} holds an item.`
- `last = mon.lastItem ?? input.lastItem`:
  - `undefined` (nothing this turn and the input absent): not estimated, `REASONS.needsLastItem(name)`.
  - `null`: `Recycle fails: {name} has used no item.`
- Otherwise `itemId = last`, delete `mon.lastItem`, Unburden off (the holder has an item), `receive(user)` and
  `w.itemsMoved = [user]`. `receive` already guards Symbiosis when the item is used in the action.
- `Ctx.tracksItems` is set (section 4.1).
- Snatch: the Snatch user recycles its own lastItem.

**Facts.** `Recycle: {name} gets {Item} back.` The eaten Berry's heal appears in the heals list.

**Guards left.** `Recycle needs {name}'s item from an earlier turn.` (`REASONS.needsLastItem`).

**Input.**
- Calculator: optional per-slot "item used before this turn" (decision 2).
- Training: the tracker's public `lastItem` (section 8).

**Oracle.**
- FS14a-sv: a Sitrus eaten this turn (K28, F92).
- FS14b-champions: input lastItem (F93 as one turn).
- FS14c-swsh: Knock Off first, so it fails.
- FS14d-sv: expected `needsLastItem`.

#### 5.4.4 Teatime (SV, Champions, SwSh)

**Showdown.** PS/data/moves.ts:19036-19066.
- Target all, bypasssub, no protect flag (F101: it reaches a Protecting Pokémon).
- For each active Pokémon in `getAllActive` order: own-left, own-right, opponent-right, opponent-left (`SHOWDOWN_POSITION`
  after Ally Switch).
  - Invulnerability: a semi-invulnerable or sheltered one is missed (F101: Dig).
  - TryHit: Good as Gold refuses (K30); the absorbers by type (a Galvanize Teatime); Psychic Terrain against a Prankster
    use.
  - Then the ones whose `getItem().isBerry` eat with `eatItem(true)` (section 4.2).
- It fails with no eater.

**Model.** Handler `teatime` in `sideOrField`, `perishSong`'s pattern (doubles-status.ts:1888-1909): per Pokémon, `hidden`
means a miss, then `tryHit`, then `kernel.forceEat`. `HP_STATUS_MOVES` (doubles-actions.ts:63) drops `teatime`.

**Facts.**
- Per eater: `Eats its {Item}.` When the item is ignored: `Eats its {Item}: no effect ({Magic Room | Embargo | Klutz}).`
- The heal appears in the heals list (`Sitrus Berry: +58 HP.`, `Cheek Pouch: +47 HP.`).
- Stage, cure and confusion facts come from ateFacts.
- `Teatime misses {name}.`
- `Teatime fails: no Pokémon holds a Berry.`

**Randomness.** Starf (one world per stat). **E2.** Builds, `lastItem` when tracked.

**Guards left.** Ripen on a resist Berry with a later damaging move (existing `REASONS.notIn2v2("Ripen")`).

**Oracle.**
- FS15a-sv: K30 (Sitrus, Lum on a paralysed Pokémon, Good as Gold) with later moves.
- FS15b-champions: under Magic Room, Unnerve, Figy (F100, F102).
- FS15c-swsh: Ripen and Cheek Pouch.

#### 5.4.5 Stuff Cheeks (SV, Champions, SwSh)

**Showdown.** PS/data/moves.ts:18253-18274. Champions drops onDisableMove, which only affects choice legality
(PS/data/mods/champions/moves.ts:953-956).
- Self, snatch. onTry needs `getItem().isBerry`, which a suppressed item still passes (F107).
- onHit is `if (!this.boost({ def: 2 })) return null`: at +6 nothing is eaten (F105); Contrary's −2 is a change, so it eats
  (F106).
- Then `eatItem(true)` (Unnerve does not stop it: F108; Magic Room means no effect: F107).

**Model.** Handler `stuffCheeks`, fails `berry` (`Stuff Cheeks fails: {name} holds no Berry.`):
- `applyBoosts(self, { def: 2 })`. If nothing changed, stop: "Its Defense cannot go higher." comes from applyBoosts.
- Else `kernel.forceEat`. `HP_STATUS_MOVES` drops it.

**Facts.** As Teatime, after the stage fact.

**Oracle.**
- FS16a-sv: K29 with a later Body Slam into it.
- FS16b-champions: under Magic Room.
- FS16c-swsh: at +6 and with Contrary.

#### 5.4.6 Embargo (USUM)

**Showdown.** PS/data/moves.ts:4680-4707.
- protect, reflectable (F132). A volatile for 5 turns; residual 21 counts it down.
- Its onStart item End is suppressed, as in F67b.
- `ignoringItem()` (PS/sim/pokemon.ts:879-886, Primal Orbs aside) is true. The held item does nothing (K26: Sitrus; F130:
  Air Balloon; F132: Leftovers at the end of turn; F133: Fling fails). It can still be taken and Knock Off still gets 1.5x
  (F131: 45 = 45). The calc engine's Knock Off reads `disabledItem` for this
  (`@smogon/calc/dist/mechanics/gen789.js:778-779`).

**Model.**
- `BattleBuild.embargoed`. The `embargo` volatile sets it on the build. `carried.embargo` sets it in `carriedState`
  (doubles-turn.ts:861).
- `itemWorks` (doubles-turn.ts:306) becomes `!w.field.magicRoom && build.abilityId !== "klutz" && !build.embargoed`. Every
  kernel, status and end-of-turn item read goes through it: Berries, herbs, grounding, Leftovers, the Orbs, Eject Pack...
- **In the calculation** (calculate.ts and uses-to-ko.ts): one gate,
  `itemIgnored(build, other, conditions) = conditions.magicRoom || klutzActive(build, other) || !!build.embargoed`
  (Klutz's ignoreKlutz exceptions stay Klutz's). It replaces the ~16 `conditions.magicRoom || klutzActive(...)` sites
  (calculate.ts:690-694, 972, 1016, 1286, 1479, 1497, 1512, 1827-1834, 3016, 3089, 3299) and `attItemOn` and `defItemOn`
  (uses-to-ko.ts:368-369).
- The engine Pokémon gets `disabledItem = item; item = undefined`, as `checkItem` does for Magic Room
  (`@smogon/calc/dist/mechanics/util.js:202-211`). That keeps Knock Off's 1.5x and Thief's take, and gives Acrobatics no
  doubling (the item is still held).
- 1v1 never sets `embargoed`.
- `GAS_CHANGING_MOVES` drops `embargo`, since USUM has no Neutralizing Gas.

**Facts.** Hit: `Embargo: its {Item} has no effect.` (`Embargo starts.` with no item.) Conditions: `Embargo.`

**E2.** Volatile `embargo`.

**Guards left.** Decision 1: if the calc gate is not wanted, the narrow guard
`Embargo on {name} before a later move is not modelled in 2v2.` replaces it.

**Oracle (usum).**
- FS17a: Sitrus (K26) and Air Balloon (F130).
- FS17b: Knock Off's 1.5x (F131), with Leftovers at the end of turn.

### 5.5 Cures and heals

#### 5.5.1 Aromatherapy (SwSh, USUM), Heal Bell (all four)

**Showdown.** Aromatherapy PS/data/moves.ts:556-590; Heal Bell :8241-8273; gen 7 Heal Bell PS/data/mods/gen7/moves.ts:303-318.
- allyTeam, snatch (F126). The loop runs over `target.side.pokemon`, **the bench included**.
- Off the field, abilities are ignored (`PS/sim/pokemon.ts:859`), so Sap Sipper and Soundproof there are cured (F120–F122).
- An active Pokémon other than the user, unless the move's Mold Breaker suppresses it (`suppressingAbility`; F123):
  - Heal Bell, gen 8+: Soundproof or Good as Gold is immune (F121).
  - Aromatherapy: Sap Sipper or Good as Gold is immune; a Substitute without Infiltrator is skipped (F120).
- Gen 7 Heal Bell checks only Soundproof, and on everyone, the user included (K42 usum, F122).
- `cureStatus` needs HP above 0.
- With both actives and the bench cured, sleep, freeze and paralysis stop later (K42 sv).

**Model.** Handler `teamCure` in `sideOrField` (`use.targetType === "allyTeam"`):
- For each living Pokémon of the user's side (pinned order is side.pokemon, which is the position order): the immunity
  rules by game and move, `breaks(kernel, w, use, slot)` for the suppression, then `cureStatus(kernel, w, use, slot)`.
- Then `w.sides[side].benchCured = true`.

**Facts.**
- Per cured active: `Its {status} is cured.` (existing).
- Immune: `{Ability}: {name} is not affected.` Skipped: `{name} is behind a Substitute.`
- Bench: `{Move} also cures the statuses of your side's Pokémon not in battle.` (or `the opponent's side's`). It is left out
  when the input says that side has no Pokémon left to switch in.

**Randomness.** It removes later sleep, freeze and paralysis branches.

**End of turn.** No poison or burn damage; the bad poison stage is gone (cureStatus clears `eot.toxic`).

**E2 and Training.** `sides.benchCured`. Training's `postFromOutcome` (evaluate.ts:198) cures that side's bench members
with HP above 0. The cures are public (`-curestatus|p1: Bench|psn|[msg]`).

**Oracle.**
- FS18a-swsh: the ally's sleep cured before it moves, a Substitute ally not cured, bench (`outcomes`).
- FS18b-usum: a Sap Sipper ally.
- FS19a-sv: Good as Gold ally, bench, a sleeping ally's Body Slam (K42 sv).
- FS19b-usum: the gen 7 Soundproof user.
- FS19c-champions: bench (F125, `outcomes`).
- FS19d-usum: snatched (F126, `outcomes`).
- The bench status needs the harness change in section 11.

#### 5.5.2 Psycho Shift (SwSh, USUM)

**Showdown.** PS/data/moves.ts:14188-14211.
- protect, accuracy 100. Status moves ignore type immunity to the move.
- onTryHit fails without a user status; otherwise `move.status = source.status`. The status step then runs trySetStatus:
  its immunities, Safeguard (F111), the terrains, an existing status, a Fire type against burn (K57).
- Only a status that lands cures the user (`self.onHit` runs only for targets that did not fail).
- Bad poison starts at stage 0 (F110). Synchronize tries to pass it back and fails, since the user still has the status
  (F110). The target's Lum cures it at the Update (F113).

**Model.**
- The own TryHit in `hitOne`'s single block (doubles-status.ts:1318-1327) fails with
  `Psycho Shift fails: {user} has no status.`
- Handler `psychoShift` in `effects`: `canStatus(kernel, w, slot, status, user, { move: true, primary: true, infiltrates, breaks })`.
  On a refusal it gives its fact and stops; the user keeps its status.
- Otherwise `setStatus(target)`, then `cureStatus(user)`, in that order, so Synchronize sees the user still statused.

**Facts.** `Is burned.` and the rest (STATUS_GIVEN) on the target. `{user}'s burn is cured.` (aboutSlot.)

**Oracle.**
- FS21a-usum: K41 (Body Slam halved, burn at the end of turn).
- FS21b-swsh: bad poison with Synchronize and a Lum target.
- FS21c-usum: Safeguard, and a Fire-type target.

#### 5.5.3 Purify (SwSh, USUM)

**Showdown.** PS/data/moves.ts:14347-14369; gen 7 mod :739-745 (failure return value only).
- protect, reflectable (F07), heal flag (Heal Block stops it at BeforeMove; Triage +3). Target normal, so an ally works.
- `target.cureStatus()`, else it fails: Comatose has no status (F116).
- Then `heal(ceil(source.maxhp / 2), source)`: none at full HP (F115; K44: 50 → 120).

**Model.** Handler `purify`:
- The target has no status: `Purify fails: {name} has no status.`
- Else `cureStatus(target)`, then `healWorlds(kernel, w, user, Math.ceil(kernel.hp[user].maxHP / 2), { use, source: "Purify" })`.
- `HP_STATUS_MOVES` drops it.

**Oracle.**
- FS20a-swsh: K44, and bounced by Magic Coat (F07).
- FS20b-usum: at full HP.

#### 5.5.4 Swallow (all four), with the stages family's Stockpile

**Showdown.** PS/data/moves.ts:18574-18599; gen 7 mod :941-951 (return value only).
- Self, snatch (F17), heal flag.
- onTry needs Stockpile, unless the use is snatched.
- `heal(modify(maxhp, [0.25, 0.5, 1][layers − 1]))`, then `removeVolatile('stockpile')` **even when nothing was healed**.
  The Stockpile's onEnd (PS/data/moves.ts:17961 stockpile condition) runs `boost({ def, spd })` with the counted amounts:
  each layer that changed the stat counts −1, Contrary and Simple included (F135: −3/−3).

**Model.**
- **Contract with the stages family:** `vol.stockpile = { layers, def, spd }` with exactly the pinned counters, from this
  turn's Stockpile or `carried.stockpile`.
- Handler `swallow`, fails `stockpile` (`Swallow fails: {name} has no Stockpile.`, not for a snatched use):
  - `healWorlds(user, modify(maxHP, [0.25, 0.5, 1][(layers ?? 1) − 1]))`.
  - `applyBoosts(user, { def, spd }, user)` for the nonzero counters. That is a self drop: Eject Pack and White Herb react
    and Defiant does not.
  - Delete `vol.stockpile`.
- `HP_STATUS_MOVES` drops it.
- Without the carried input, a Pokémon that stockpiled on an earlier turn is not known (decision 2).

**Facts.** The heal in the heals list (`Swallow: +59 HP.`) and the stage facts.

**Oracle.**
- FS22a-sv: F135 (carried 3 layers).
- FS22b-champions: carried 1 layer, with a later hit.
- FS22c-usum: snatched (F17).

## 6. Interactions with the other families

| With | What | Where |
|---|---|---|
| Stages (Stockpile, Tar Shot, Captivate, Acupressure...) | Mist stops their drops from others; Crafty Shield blocks those aimed at its side; Snatch steals the self ones; Swallow reads Stockpile. Topsy-Turvy, the swaps and Psych Up set stages directly: Mist does not stop them. | applyBoosts, tryHit, snatchers, `vol.stockpile` |
| Types (Soak, Magic Powder, Reflect Type...) | Magic Coat reflects the reflectable ones from the holder; Crafty Shield blocks them; Snatch steals Conversion and Camouflage. | bounce, tryHit, snatchers |
| Abilities (Skill Swap...) | Magic Coat reflects Entrainment, Worry Seed, Simple Beam and Gastro Acid. Magic Room and Embargo change Ability Shield under Neutralizing Gas (gasShieldGuard reads `embargoed`). | bounce, gasShieldGuard |
| Next-move volatiles (Attract, Heal Block, Octolock...) | Mist stops Octolock's residual drop from a foe; the Mental Herb room-end Update also cures Attract once that family adds it. | applyBoosts, roomEnd |
| Field-change re-settle (CENSUS 2, L) | Defog's terrain end uses the terrain moves' guard until the re-settle enabler replaces both. | fieldGuard |
| itemHistory (Harvest, Pickup, Symbiosis, Fling: guards) | Recycle defines `lastItem` and `usedItem`; those guards read the same state. | section 4.1 |
| Replacement (switch-outs, Revival Blessing) | Party cures set `benchCured`; the bench model, when it exists, applies it per member. | E2 |
| Track E (Trick, Ally Switch, Substitute) | Bestow is swapItems' one-way half; Teatime and Snatch use positions; Defog, Purify and Corrosive Gas read the Substitute rules. | doubles-items.ts |

## 7. End of turn (doubles-eot.ts)

- **No HP from the countdowns.** Lucky Chant (26.6), Mist (26.4), Mud Sport (27.4), Water Sport (27.3), Wonder Room (27.5),
  Magic Room (27.6) and Embargo (21). The engine counts none of them; E2 gives `fieldSet` and `clock` for the next turn.
- **Magic Room.**
  - Set this turn: items stay off at the end of turn (K25), and `roomFact` is silent (`fieldSet`).
  - Ended this turn: items act (Leftovers, the Orbs, Sticky Barb, White Herb, the final Update's Berries).
  - From before and still up: today's turn fact.
- **Embargo:** `residualMon.item` is `""` through `itemWorks` (F132).
- **Cures:** no poison or burn damage (Heal Bell, Aromatherapy, Purify, Psycho Shift's user); the moved bad poison does
  1/16 (F110).
- **Defog:** no Grassy heal once Grassy Terrain is gone.
- **Recycle, Bestow:** a restored or received Leftovers heals, and a restored Sitrus is eaten at the final Update when it is
  due.
- **Corrosive Gas:** Leftovers, Black Sludge, the Orbs and Sticky Barb are gone.
- **Snatch:** the stolen Aqua Ring or Ingrain heals the Snatch user.
- `worldGuard` (doubles-eot.ts:207-225) loses the `endGuard` from these 23 moves.

## 8. E2 and Training

Champions has 10 of the 23 moves: Magic Room, Wonder Room, Court Change, Defog, Corrosive Gas, Recycle, Teatime, Stuff
Cheeks, Heal Bell and Swallow. All sit at 0.00 % usage.

| Item | Engine (E2) | Training |
|---|---|---|
| Side clocks, hazards | `sides.clock`, `hazardsFrom` (section 4.3) | `nextClock` reads them. This also fixes Rapid Spin, Mortal Spin and Tidy Up today (section 13). |
| Rooms | `fieldSet` | `nextClock`: `SET_THIS_TURN.room` for a fresh room. |
| Party cures | `sides.benchCured` | `postFromOutcome` cures the side's bench members with HP. The `-curestatus` lines are public. |
| Recycle | build | The tracker (`app/(app)/training/sim/tracker.ts:864-884`) gains `PublicMon.lastItem` (section 8.1). `bridgeTurn` (bridge.ts:341-346) passes `lastItem`. |
| Swallow | `vol.stockpile` from `carried.stockpile` | The public `-start stockpileN` and its `-boost` lines give layers and counters (effects.ts:136 builds the volatile today). `carriedOf` passes them. This is the stages family's. |
| Teatime, Stuff Cheeks, Corrosive Gas | builds | none |
| Embargo, Mist, Lucky Chant, Sports, Snatch, Magic Coat, Crafty Shield, Mat Block, Bestow, Psycho Shift, Purify, Aromatherapy | — | not in Champions |

### 8.1 The tracker's `lastItem`

A public `-enditem` without `[from] move:` and without `[from] stealeat` is the Pokémon's last item, unless the item is
Air Balloon (a pop). A `-enditem … [from] move: Fling` is one too (the fling volatile, PS/data/moves.ts:5734).
`-item … [from] move: Recycle` and `[from] ability: Harvest` clear it. Pickup's `-item` names no target: when exactly one
Pokémon used an item that turn, clear its lastItem; otherwise the AI takes an approximation note. `lastItem` survives
switching.

Training never reads the belief battle's `lastItem`, since that is not public.

## 9. UI facts (exact texts)

Name placeholders use `kernel.names`, never positions. Side words follow the existing pattern
(`your side` / `the opponent's side`).

| Where | Text |
|---|---|
| Magic Coat step | `Magic Coat: reflectable moves aimed at {name} go back to their users this turn.` |
| Magic Coat hit | `Magic Coat: {Move} goes back to {user}.` / `Magic Coat: {Move} goes back to {user}'s side.` |
| Snatch step | `Snatch: {name} takes the next move that can be snatched this turn.` |
| Stolen action | `Snatch: {snatcher} takes {Move}.` |
| Crafty Shield | `Crafty Shield: status moves aimed at {name}'s side are blocked this turn.` / `Crafty Shield blocks {Move}.` / `Crafty Shield fails: no Pokémon moves after it.` |
| Mat Block | `Mat Block: damaging moves aimed at {name}'s side are blocked this turn.` / `Mat Block blocks {Move}.` / row `Mat Block: {Move} breaks through at 1/4 damage.` / `Mat Block fails: no Pokémon moves after it.` |
| Lucky Chant, Mist | `Lucky Chant starts on {name}'s side.` / row `Lucky Chant: no critical hit.` / `Mist starts on {name}'s side.` / hit `Mist: its stats are not lowered.` / `{Move} fails: it is already up on {name}'s side.` (existing) |
| Court Change | `Court Change: the two sides' conditions are swapped.` |
| Defog | `Defog: {Reflect \| Light Screen \| Aurora Veil \| Safeguard \| Mist} ends on {name}'s side.` / `Defog: the {Electric \| Grassy \| Misty \| Psychic} Terrain ends.` / `Defog: the hazards on both sides are cleared.` |
| Rooms, Sports | `Magic Room starts.` / `Magic Room ends.` / `Wonder Room starts.` / `Wonder Room ends.` / `Mud Sport starts.` / `Water Sport starts.` / `{Move} fails: it is already up.` / rows `Mud Sport: Electric moves at 1352/4096 power.`, `Water Sport: Fire moves at 1352/4096 power.` |
| Corrosive Gas | hit `Loses its {Item}.` / `Corrosive Gas fails: {name} holds no item.` / `Sticky Hold: {name} keeps its item.` / `Corrosive Gas fails: {name}'s {Item} cannot be removed.` |
| Bestow | `Bestow: {target} gets {Item}; {user} holds no item.` / `Bestow fails: {target} already holds an item.` / `Bestow fails: {user} holds no item.` / `Bestow fails: {user}'s {Item} cannot be moved.` |
| Recycle | `Recycle: {name} gets {Item} back.` / `Recycle fails: {name} holds an item.` / `Recycle fails: {name} has used no item.` |
| Teatime, Stuff Cheeks | hit `Eats its {Item}.` / `Eats its {Item}: no effect (Magic Room).` (or Embargo, Klutz) / `Teatime misses {name}.` / `Teatime fails: no Pokémon holds a Berry.` / `Stuff Cheeks fails: {name} holds no Berry.` |
| Embargo | hit `Embargo: its {Item} has no effect.` / `Embargo starts.` / condition `Embargo.` |
| Party cures | `Its {status} is cured.` (existing) / `{Move} also cures the statuses of your side's Pokémon not in battle.` |
| Purify, Psycho Shift, Swallow | `Purify fails: {name} has no status.` / `Psycho Shift fails: {name} has no status.` / `{user}'s {status} is cured.` / `Swallow fails: {name} has no Stockpile.` |

docs/champions-calculator.md's 2v2 section lists these moves as modelled and gives the new facts and the one new reason.

## 10. REASONS

**Removed.**
- `notModelledBefore` and `notModelled` for the 23 moves (statusMove's L branch, doubles-status.ts:778-786).
- The `HP_STATUS_MOVES` presence guards for Purify, Stuff Cheeks, Swallow and Teatime (Revival Blessing stays).
- The `bestowActs` guard and the Recycle no-item guard (:782-784).
- `withGas` for Magic Room, Corrosive Gas, Bestow and Embargo (`gasShieldGuard` covers the real case).

**Added, each narrow, in exact text.**
1. `needsLastItem: (name) => \`Recycle needs ${name}'s item from an earlier turn.\``: the user holds nothing, used nothing
   this turn, and the input `lastItem` is absent.
2. `boosterAfterRoom: "Booster Energy after Magic Room ends is not modelled in 2v2."`: SV, a living Protosynthesis or Quark
   Drive holder of Booster Energy whose field is down when Magic Room ends.
3. Decision 1 only: `embargoed: (name) => \`Embargo on ${name} before a later move is not modelled in 2v2.\``.

**Reused.**
- `REASONS.fieldChange(name)`: Defog ending the terrain with a terrain-settled holder.
- `REASONS.notIn2v2("Ripen")`: a forced resist Berry with a later damaging move.
- The existing partner-power order issue, with the Sport's name.
- `REASONS.notIn2v2("Symbiosis")`: a recycled or forced-eaten item with a Symbiosis partner.
- `REASONS.gasShield`.

## 11. Oracle cases and harness

### 11.1 Cases

The new cases live in `scripts/.cache/calc-audit/2v2/verify/cases-fs.ts`, with ids `FS<nn><variant>-<game>`: sv plus one
other game for every move SV has, two games where SV lacks the move, and USUM only for the USUM-only moves.

| Id | Move | Checks |
|---|---|---|
| FS01a-swsh, FS01b-usum, FS01c-swsh, FS01d-usum | Magic Coat | spread reflection, Prankster vs Dark, an ally's move, hazards (`outcomes`) |
| FS02a–FS02e-usum | Snatch | Swords Dance, Reflect, paralysis, Substitute, Heal Bell (`outcomes`) |
| FS03a-swsh, FS03b-swsh, FS03c-usum | Crafty Shield | blocks, Feint, Magic Coat order, last action |
| FS04a-swsh, FS04b-usum | Mat Block | blocks, Max and Z quarter, ally Earthquake |
| FS05a-usum, FS05b-usum | Lucky Chant | Frost Breath, Merciless, the crit toggle |
| FS06a-sv, FS06b-swsh, FS06c-usum | Mist | Snarl, Mirror Armor, Parting Shot, King's Shield |
| FS07a-sv, FS07b-champions, FS07c-swsh | Court Change | Tailwind order, Reflect, `clock` and `hazardsFrom` (`outcomes`), Wide Guard |
| FS08a-sv, FS08b-usum, FS08c-champions, FS08d-sv, FS08e-sv | Defog | screens and terrain, gen 7 terrain, Defiant and hazards, Substitute and ally, `fieldChange` |
| FS09a-sv, FS09b-champions, FS09c-swsh, FS09d-usum | Magic Room | start, mid-turn end, restart (`outcomes`), gen 7 |
| FS10a-sv, FS10b-champions | Wonder Room | start with Body Press, mid-turn end |
| FS11a-usum, FS11b-usum | Mud Sport, Water Sport | Galvanize, the chain |
| FS12a-champions, FS12b-swsh | Corrosive Gas | Mega Stone, Substitute, Sticky Hold, Unburden, Air Balloon |
| FS13a-usum, FS13b-usum | Bestow | Sitrus to an ally, Protect, Unburden |
| FS14a-sv, FS14b-champions, FS14c-swsh, FS14d-sv | Recycle | this turn, input, Knock Off, `needsLastItem` |
| FS15a-sv, FS15b-champions, FS15c-swsh | Teatime | K30, Magic Room and Unnerve and Figy, Ripen and Cheek Pouch |
| FS16a-sv, FS16b-champions, FS16c-swsh | Stuff Cheeks | K29, Magic Room, +6 and Contrary |
| FS17a-usum, FS17b-usum | Embargo | Sitrus, Air Balloon, Knock Off, Leftovers |
| FS18a-swsh, FS18b-usum | Aromatherapy | Substitute, bench (`outcomes`), Sap Sipper |
| FS19a-sv, FS19b-usum, FS19c-champions, FS19d-usum | Heal Bell | Good as Gold, gen 7 Soundproof, bench, snatched |
| FS20a-swsh, FS20b-usum | Purify | K44 and Magic Coat, full HP |
| FS21a-usum, FS21b-swsh, FS21c-usum | Psycho Shift | K41, bad poison with Synchronize and Lum, Safeguard and Fire |
| FS22a-sv, FS22b-champions, FS22c-usum | Swallow | 3 layers, 1 layer, snatched |

### 11.2 Harness extensions

These are design notes for the verify harness. Today's types are at `2v2/verify/case-types.ts:52-120` and `sim-dfs.ts:210-264`.

| Extension | What it adds |
|---|---|
| `CaseSide` | `safeguard`, `mist`, `luckyChant`, and `hazards: { spikes?, toxicSpikes?, stealthRock?, stickyWeb? }` (`addSideCondition` per layer). |
| `CaseField` | `mudSport`, `waterSport` (`addPseudoWeather` with a source: F-probes' `addPseudoWeather(id, pokemon)`). |
| `CaseCarried` | `lastItem` (`p.lastItem = id`), `embargo` (`addVolatile('embargo')`), `stockpile` (`addVolatile('stockpile')` per layer, then the counters). |
| `Case.bench` | `{ status, ability }` per side. The status is set directly (`p.status`, `statusState`), as `benchStatus` in the probes; `setStatus` refuses an inactive Pokémon. |
| compare.ts (E2) | `benchCured` against the bench's statuses after the turn; `clock`, `hazardsFrom` and `fieldSet` against the side and field conditions' durations (a condition set this turn has its base duration less one after the countdown). |

### 11.3 Stored cases that change

- S48-Bestow-before-usum and S48-Bestow-last-usum (`cases-s.ts:851-860`) lose `notEstimated` and `endNotEstimated` and
  become full oracle runs.
- The generated `tests/unit/doubles-turn-showdown.test.ts:573` row is regenerated (`gen-tests.ts`).
- Every other stored case uses none of the 23 moves (grep of `cases*.ts`). The 1264 keep agreeing, and the regress run
  checks it.

## 12. Tests

- **`tests/source/doubles-status-moves.test.ts`:** the snatch flag and the new handler and fails keys per game.
- **`tests/unit/doubles-field-side-items.test.ts` (new):** one test per mechanic.
  - The facts' exact texts.
  - The guards left and their texts: `needsLastItem`, `boosterAfterRoom`, Defog's `fieldChange`.
  - E2's new fields: `clock` after Court Change, `hazardsFrom` after Defog and Rapid Spin, `fieldSet` after a restart,
    `benchCured`, `embargo`.
  - `tracksItems` off when no Recycle is in the turn (`discreteKey` unchanged).
- **`tests/unit/training-*.test.ts`:**
  - `nextClock`: Court Change, Defog, Rapid Spin, a room restarted, Safeguard set this turn.
  - `postFromOutcome`: `benchCured`.
  - Tracker: `lastItem` for each line kind in section 8.1.
  - Bridge: passes `lastItem` and `stockpile`.
- **golden-1v1:** byte-equal. calculate.ts's new fields (`luckyChant`, `protectName`, `mudSport`, `waterSport`, `embargoed`)
  are optional and absent in 1v1.
- **The 2v2 oracle regress:** the 1264 cases plus the FS cases.

## 13. Found on the way

1. **Training keeps the hazards Rapid Spin or Mortal Spin cleared (Champions, today).** `nextClock` starts from the
   decision's clock and only adds landed hazards (evaluate.ts:114-127). E2 reports only `hazards` landed this turn. So
   after the AI's own Rapid Spin, its value function still sees the Stealth Rock. `hazardsFrom: null` (section 4.3) fixes
   it.
2. **Training's clock ignores a Safeguard set this turn** (`safeguard: Math.max(0, before.safeguard − 1)`, evaluate.ts:120).
   Next turn the bridge rolls out on Safeguard (bridge.ts:282) anyway, but the value function reads the clock. Section 4.3
   gives it the same rule as the screens.
3. **K43 was invalid evidence** (section 2). F120 replaces it.
4. **No guard is needed for Magic Room and Utility Umbrella:** pinned Showdown runs nothing at the room's start (F67,
   F67b), contrary to the census.
5. **Mist acts after Mirror Armor** (F40). The census's Mist entry did not cover the reflection.
6. **The engine over-guards Symbiosis on taken items.** `eventGuards` (doubles-turn.ts:1155-1159) treats Knock Off,
   Thief, Covet and Bug Bite removals as uses, but takeItem runs no AfterUseItem (F84; PS/data/abilities.ts:4837-4851). The
   numbers are not wrong; the turn is not estimated for no reason. `w.itemsTaken` fixes it for those moves too, in the
   guards family's symbiosis entry.
7. **Hyperspace Hole and Hyperspace Fury break Protect too** (`breaksProtect`, PS/sim/battle-actions.ts:755-779). The
   engine removes protections and guards only for Feint (doubles-turn.ts:1841-1847), so a later move into the Hoopa
   target's protector stays blocked. USUM Hoopa only. Small.
8. **Defog "fails" while it still acts** (F55, F56, F58: screens, Mist and the terrain go). Only Stomping Tantrum and Temper
   Flare next turn read that failure (bridge.ts:138, `moveLastTurnResult`). Training reads it from the real battle, so
   nothing is needed now.

## 14. Risks and decisions

**Riskiest points.**
1. **Embargo's calc gate (medium).** About 18 item-suppression sites in calculate.ts and uses-to-ko.ts move to one
   `itemIgnored`. 1v1 stays byte-equal, since no 1v1 build sets `embargoed`. It is USUM only.
2. **itemHistory inside the pairwise step (medium).** The used, taken or popped classification of a step's item loss. It
   runs only when a Recycle is in the turn. The oracle cases FS14 and the probes F90–F96 pin each class.
3. **Snatch's four dispatch points (medium).** Each must sit after its move's own Try and before "already up". USUM only;
   FS02 covers all four.
4. **The E2 contract and Training's clock (medium).** New outcome fields, plus `nextClock` and `postFromOutcome` changes.
   These consumers are Training only, and the change fixes a latent error.
5. **Mist in the step (low to medium).** One line in `boost()` after Mirror Armor, plus the memo key.
6. **The Magic Room room-end Update (low to medium).** White Herb, then the Berries (incl. confusion), then Mental Herb,
   before `updateAll`, which must not cure twice.
7. **Lucky Chant's no-crit and the Merciless stand-in, the Sports' chain, the Mat Block quarter text (low).**

**For the user to decide.**
1. **Embargo (USUM):** the exact calc gate in section 5.4.6, or the narrow guard
   `Embargo on {name} before a later move is not modelled in 2v2.`
2. **Calculator inputs for earlier-turn state.** Without them the defaults hold: assumed absent, with Recycle's one narrow
   reason and Swallow's Stockpile unknown.
   - Per slot: "Item used before this turn" (Recycle), Embargo (USUM), Stockpile layers (with the stages family).
   - Side: Mist, Lucky Chant (USUM).
   - Field: Mud Sport, Water Sport (USUM).
3. **Training scope now:** the E2 fields plus `nextClock`, `postFromOutcome`, the tracker's `lastItem` and the bridge (fixes
   section 13.1–2). Or the E2 fields only, with Training later. Champions usage of these 10 moves is 0.00 %, but the Rapid
   Spin hazard error is live.
4. **Who builds Swallow:** here, given the Stockpile contract, or the stages family together with Stockpile.
5. **Narrowing `GAS_CHANGING_MOVES`:** take out Magic Room, Corrosive Gas, Bestow and Embargo, with `gasShieldGuard`
   reading `embargoed`. This is an exact narrowing, since the remaining guard catches every Ability Shield change.
