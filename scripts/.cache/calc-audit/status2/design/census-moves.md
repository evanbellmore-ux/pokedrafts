# CENSUS 1: the 73 kind-L status moves (status2 design)

Branch `calc-2v2-status-2` (from main 4008ee8), design only. The user asked to "do 3 and 4"; this census is item 3's ground:
every status move `app/lib/battle/status-table.ts` marks `kind:"L"` (73), what pinned Showdown c23d2e94 does with it in each
game that has it, what state it changes, what reads that state later in the same turn and at the end of turn, what the engine
already has, the randomness, and an exactness risk. CENSUS 2 (the narrow guards, item 4) shares this folder; its files are
`census-probes.*`, `census-sim.*`, `census-usage.*`. This census's files all start with `census-moves`.

Citations: `PS/` is the read-only pinned source `node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353`.
`K<n>` is a probe in `census-moves-probes.out`; `status-eot Q<n>/P<n>/T9b` are the earlier design's probes
(`scripts/.cache/calc-audit/status-eot/design/status-probes-*.out`, `addendum-probes-2.out`).

## Files

| File | What |
|---|---|
| `census-moves.md` | This census. The per-move part is generated. |
| `census-moves.json` | The same per move, machine-readable, with the summary counts. |
| `census-moves-data.ts` | The hand-written census records (one per move). |
| `census-moves-build.ts` | Merges the records with the generated facts; writes the JSON and this file (`--check` lists the citations against the handlers). |
| `census-moves-head.md` | This head section (the generator prepends it). |
| `census-moves-src.ts` → `.out`, `-src-text.out` | Each L move's block in `PS/data/moves.ts` and the champions, gen8 and gen7 mods (`--text` prints the blocks). |
| `census-moves-dex.ts` → `.out` | Per game from the four mods and the app's catalogs: learners, each move's handlers as the mod resolves them, the ability flags (cantsuppress, failroleplay, failskillswap, noentrain, notrace, notransform), the abilities and items with Start/End/Update handlers. |
| `census-moves-probes.ts` → `.out` | 79 exact probes (K1–K57) on the earlier design's harness (`status-eot/design/addendum-sim.ts`), with controls. |
| `census-moves-cites.ts` | Checks that every `PS/…:line` citation in the records points into the entry it names. |

Reproduce from the repo root: `npx --no-install tsx scripts/.cache/calc-audit/status2/design/census-moves-<src|dex|probes>.ts > …out`,
then `npx --no-install tsx scripts/.cache/calc-audit/status2/design/census-moves-build.ts`.

## Counts

- **73 moves.** By game: Scarlet/Violet 41, Champions 40 (39 with a learner: no Champions species learns Power Shift),
  Sword/Shield 52, Ultra Sun/Ultra Moon 62. In all four games: 29. USUM only: 17 (Bestow, Camouflage, Captivate, Embargo,
  Foresight, Heal Block, Ion Deluge, Lucky Chant, Miracle Eye, Mud Sport, Nightmare, Odor Sleuth, Powder, Rototiller, Snatch,
  Telekinesis, Water Sport). SV only: Doodle. Champions only: Power Shift.
- **By family:** stat stages 18, volatiles acting on later moves or the end of turn 10, types 8, abilities 7, items 6, side
  conditions 6, stored stats 5, cures/transfers/heals 5, field conditions 4, move type changes 2, copying moves 2.
- **By exactness risk:** low 48, medium 20, high 5 (Skill Swap, Transform, Electrify, Forest's Curse, Trick-or-Treat).
- **Most learned** (species over the four catalogs): Attract 1614, Psych Up 895, Captivate 541, Skill Swap 439, Defog 428,
  Magic Coat 394, Role Play 296, Worry Seed 286, Wonder Room 279, Recycle 265. In Champions: Attract 116, Psych Up 92,
  Skill Swap 71, Wonder Room 52, Magic Room 35, Guard Swap 24, Entrainment 22, Power Swap 21, Stockpile 18, Worry Seed 18.
- **Per-game differences in the moves' own code** (the mods; `census-moves-dex.out` handler prints): Defog (gen 7 keeps the
  terrain: `PS/data/mods/gen7/moves.ts:125-147`, K45), Heal Bell (gen 7 checks only Soundproof, the user too:
  `PS/data/mods/gen7/moves.ts:303-318`, K42), Purify and Swallow (gen 7's failure return value only), Stuff Cheeks (Champions
  drops onDisableMove: choice legality only). Everything else differs by generation branches in `PS/sim` (the gen 8+ re-sort
  and priority recomputation after each action, `PS/sim/battle.ts:2642-2647, 2919-2926`; Tera in SV; Dynamax in SwSh), by
  which abilities and items each catalog has (the ability flag lists differ: e.g. failskillswap SV 23, Champions 6, SwSh 14,
  USUM 12), and by PP (Acupressure, Corrosive Gas in Champions).

## Today

Every L move goes through `doubles-status.ts statusMove`'s last branch: with a later living action the whole turn is not
estimated (`REASONS.notModelledBefore`); as the last action the moves are estimated and only the end of turn is not
(`w.endGuard = REASONS.notModelled`). On top of that:
- Purify, Stuff Cheeks, Swallow and Teatime are presence guards wherever they come (`HP_STATUS_MOVES`, `presenceGuards`).
- Bestow is a whole-turn guard when the item it gives would act at the receiver's Update (`bestowActs`); Recycle when its user
  holds no item.
- With Neutralizing Gas from the turn's start, the ability, item and Ability Shield movers are guarded whatever follows
  (`GAS_CHANGING_MOVES`: Gastro Acid, Worry Seed, Simple Beam, Entrainment, Skill Swap, Role Play, Doodle, Transform, Bestow,
  Corrosive Gas, Embargo, Magic Room).
- A Z status move (USUM) is "Status Z-Moves are not calculated." (`resolve-move.ts:71`); that stays out of this census.

## What the families need (shared building blocks)

The engine already holds per world: the build (species, ability, item, stages, status, mechanic), `MoveVolatiles` (accuracy and
evasion stages, Substitute HP, sleep/confusion counters...), `EotState`, side flags, the field (weather, terrain, Gravity, Trick
Room, Magic Room, Wonder Room), positions. The calculation reads the build and `conditionsFor(w)`. The end of turn reads
`residualMon` (types, ability, working item, grounded, Heal Block). So a move that changes something the world already holds
is cheap; the work is where the world has no field for it.

| Building block | Exists | New | Moves |
|---|---|---|---|
| Stage writes and boost events | `applyBoosts` (Contrary, Simple, cap, Clear Body family, Mirror Armor, Defiant/Competitive per stat, White Herb, World.boosted for Eject Pack/Opportunist), `vol.stages` | A uniform sample (Acupressure); direct writes without events (swaps, Topsy-Turvy, Psych Up) | Acupressure, Autotomize, Captivate, Flower Shield, Gear Up, Magnetic Flux, Geomancy, Minimize, No Retreat, Stockpile, Tar Shot, Tidy Up, Topsy-Turvy, Guard Swap, Power Swap, Heart Swap, Psych Up, Rototiller |
| Per-world types | `typesOf` is the single source (`doubles-turn.ts:1402-1405`); `makePokemon(…, types)` takes a one-type override (Mimicry) | A `types`/added-type field read by `typesOf`; two-type override into the calculation; a **third type** (the vendored calculation reads `types[0..1]` only: `@smogon/calc/dist/mechanics/gen789.js:300-302`) | Soak, Magic Powder, Reflect Type, Conversion, Conversion 2, Camouflage; third type: Forest's Curse, Trick-or-Treat (and Reflect Type copying an added type) |
| Per-world stored stats | `kernel.buildStats` (model.ts getBuildStats) feeds Speed, Strength Sap, the confusion self-hit | A stored-stat override read by `buildStats`/`speedOf` and given to the calculation (rawStats with a clone hook, as `withTypes` does) | Power Split, Guard Split, Speed Swap, Power Trick, Power Shift (and Transform) |
| Ability change | `build.abilityId` per world feeds everything; `defaultAbilityActive`; `GAS_STAND_IN` + `gasEnds`; `unnerveEnds`; intimidate.ts | One helper: End, swap, fresh ability state, Start, with a table of the Starts/Ends that act (Intimidate, Download, weather/terrain setters, Air Lock/Cloud Nine, Unnerve, Screen Cleaner, Curious Medicine, Pastel Veil; guard the rest) and the per-game flag tables | Skill Swap, Role Play, Entrainment, Simple Beam, Worry Seed, Gastro Acid, Doodle (and Transform) |
| Move type | `usedType` (ModifyType), the calculation's move `overrides.type` (Hidden Power, Terrain Pulse), `withPowerMods` | ModifyType priority −2 after the -ate abilities; an -ate/Normalize 4915/4096 kept on a retyped move (K55) | Electrify, Ion Deluge |
| Calculation hooks | `engine-corrections.cjs`: `withPowerMods` (base-power chain, order-exact), the `getMoveEffectiveness` wrapper, `defenderSide.isForesight` | A final-chain ×2 (Minimize), an effectiveness +1 on the first type (Tar Shot), Psychic into Dark at 1 (Miracle Eye) | Minimize, Tar Shot, Miracle Eye, Foresight/Odor Sleuth (exists), Mud Sport, Water Sport (base power exists) |
| Items | `swapItems`/`unburden`/`receive` (doubles-items.ts), Knock Off's removal, `ateBerry`/`berryArithmetic`/`pouchHeal` (Bug Bite's forced eat), `itemWorks` | One-way give; per-world `lastItem`; a per-Pokémon item suppression that Knock Off still sees | Bestow, Corrosive Gas, Recycle, Stuff Cheeks, Teatime, Embargo |
| Side and field flags | `SideState` (screens, Tailwind, Wide/Quick Guard, Safeguard, hazards), `w.field.magicRoom/wonderRoom`, `fieldGuard` | Crafty Shield, Mat Block, Lucky Chant, Mist flags; Mud/Water Sport and Ion Deluge field flags; the swaps | Crafty Shield, Mat Block, Lucky Chant, Mist, Court Change, Defog, Magic Room, Wonder Room, Mud Sport, Water Sport, Ion Deluge |
| Gates and residuals | BeforeMove chain (paralysis, Taunt...), `moveFailure` (TryMove), `grounded` with `eot.magnetRise`, `eot.healBlock` everywhere (Psychic Noise), the residual phase | Attract's gate (priority 2), Powder's TryMove, a telekinesis flag in `grounded`, Nightmare (order 11) and Octolock (order 14) residuals | Attract, Powder, Telekinesis, Heal Block (readers all exist), Nightmare, Octolock |
| Cures and heals | `cureStatus`, `canStatus`/`setStatus`, `healWorlds` | Bench cures in E2 | Aromatherapy, Heal Bell, Psycho Shift, Purify, Swallow |
| Re-routing a use | `bounce` (Magic Bounce) runs a use from another holder | Magic Coat as a bounce source (with its pranksterBoosted); a PrepareHit hook that hands the next snatchable move to the Snatch user | Magic Coat, Snatch |
| Whole-build copy | calculate.ts `transformedFrom` (Imposter, 1v1) | A per-world transformed build plus the ability helper's Start; Imposter is a presence guard in 2v2 today | Transform |

## Randomness

- **New branches (5):** Acupressure (`sample` over the stats below +6, 1/n each: status-eot Q14), Conversion 2 (`sample` over
  the qualifying types: K4, 1/2 each for Normal into a Bug/Rock user), Attract (1/2 stop at each BeforeMove of the infatuated
  Pokémon: status-eot P9), Skill Swap (a gained Trace's `sample` over its foes), Transform (a copied Trace's).
- **Existing branches they ride (11):** Speed ties after a Speed change, a Berry's own (Starf, the Figy family) for Recycle,
  Stuff Cheeks and Teatime, the moved or cured status's (Psycho Shift, Heal Bell, Aromatherapy, Worry Seed), Nightmare (the
  target's wake), Snatch (the stolen move's), Octolock (its tie with Syrup Bomb at order 14).
- **None:** the other 57.

## Inputs

- **Needed for the move's own use this turn (11):** Attract and Captivate (genders: the calculator's Gender field may be
  "Unknown"), Conversion (the first move slot: `DoublesPokemonInput.moves` is not Showdown's slot order), Conversion 2 (the
  target's last move unless it moved earlier this turn, and that move's type as used), Swallow (Stockpile layers and the
  per-stat counters), Recycle (the item used before the turn unless one was used this turn), Mat Block (its first turn out,
  as Fake Out), Geomancy (a charge last turn), No Retreat, Stockpile and Power Trick (an earlier use; default none, a fact).
- **For state from earlier turns only (most of the rest):** a type change, stored-stat change, Gastro Acid, Minimize, Tar Shot,
  Embargo, Nightmare, Attract, Foresight/Miracle Eye, Telekinesis, Octolock, Lucky Chant, Mist, Mud/Water Sport... Each move
  used this turn starts its own state, so the calculator can model it without one; Training maps the public volatiles.

## The hardest items

1. **Skill Swap, Role Play, Entrainment, Doodle (and Transform's ability):** the Start and End table. Gaining Intimidate drops
   the other side at once (status-eot Q2, K6, K9: two Intimidates for Doodle); losing Levitate makes Earthquake hit (K5); a
   copied Speed Boost acts at the end of turn (K9b). Every ability-driven read in later steps must see the new ability, and the
   abilities whose state is a flag (Flash Fire, Unburden, Protosynthesis, Slow Start) must reset as Showdown's fresh
   `abilityState` does. Gen 8+ also recomputes the queued actions' priority after each action (`PS/sim/battle.ts:2642-2647`),
   so a moved Prankster or Gale Wings changes later priorities (the engine's `priorityOf` is per world: it follows the build).
2. **Transform:** species, types (pre-Tera), stored stats but HP, stages, crit volatiles, moves and ability (Start) at once
   (K13); the 1v1 `transformedFrom` path is the base, but 2v2 has never run a transformed Pokémon (Imposter is a presence guard).
3. **Electrify and Ion Deluge:** retyping a damaging move inside the calculation. K55: an Electrified Pixilate Hyper Voice is
   Electric **and** keeps Pixilate's 4915/4096 (136 vs 112 damage into Gyarados); K56: Ion Deluge leaves a Pixilate move Fairy.
   Absorbing and redirecting abilities, STAB, terrain boosts and Charge all key on the used type.
4. **Forest's Curse, Trick-or-Treat:** a third type the vendored calculation cannot hold (K2: Ice Beam into a cursed Gyarados
   doubles; K2b: Close Combat into a Ghost-added Snorlax is immune); Trick-or-Treat also has the queued-Curse "glitch"
   (`PS/data/moves.ts:19928-19934`).
5. **The stored-stat moves:** no override exists anywhere (K10, K11, K12, K12b); Speed Swap reorders the rest of the turn in
   gen 8+ only (K10).
6. **Minimize, Tar Shot:** new modifiers inside the calculation's chains (K15 ×2 final damage; K16 ×2 effectiveness).
7. **Snatch:** the next snatchable move of anyone this turn is the Snatch user's (K50), side moves included.
8. **Recycle:** `lastItem` through every consuming path (K28: a Sitrus eaten at the turn's start comes back and is eaten again).

## Found on the way (outside the moves' own modelling)

- **Training's bridge misses earlier turns' type and stored-stat changes (Champions).** A type change is not a volatile
  (`pokemon.types` / `addedType`), nor is a Power/Guard Split or Speed Swap (`storedStats`); `bridge.ts liveBuild` rebuilds the
  Pokémon from its species and set, and `bridgeTurn` checks neither (it rolls out an unknown volatile, a changed ability and a
  transformed Pokémon). So after a Soak, Magic Powder, Reflect Type, Forest's Curse, Trick-or-Treat, Power Split, Guard Split
  or Speed Swap on an earlier turn (all in Champions), the engine silently reads the species' types and set stats. Burn Up and
  Double Shock's type loss (`setType` with '???': `PS/data/moves.ts:2108-2113` burnup self.onHit) is the same case (both in Champions). Today this is a
  latent Training error, independent of this build; the census's carried notes mark each move.
- **Psycho Shift whose status fails leaves the user's status** (K57); only a status that lands cures the user.
- **Defiant/Competitive act per stat lowered** (K17: Octolock's one boost() gives +4): `applyBoosts` already does this.
- **Power Shift is unreachable** (no Champions learner), but costs nothing once Power Trick exists.

## Per-move census

Generated by `census-moves-build.ts` (games from `status-table.ts`, learners from `census-moves-dex.out`, source ranges from the pinned dex; the rest from `census-moves-data.ts`). Probe ids are `census-moves-probes.out` unless prefixed.

| Move | Family | Games (learners) | Risk | Branches | Input for its own use |
|---|---|---|---|---|---|
| Skill Swap | abilities | sv:133 champions:71 swsh:104 usum:131 | high | new | — |
| Transform | copy | sv:3 champions:1 swsh:2 usum:3 | high | new | — |
| Electrify | move-type | champions:1 swsh:3 usum:3 | high | — | — |
| Forest's Curse | types | sv:3 champions:1 swsh:2 usum:3 | high | — | — |
| Trick-or-Treat | types | champions:4 swsh:8 usum:9 | high | — | — |
| Doodle | abilities | sv:2 | medium | — | — |
| Entrainment | abilities | sv:35 champions:22 swsh:26 usum:30 | medium | — | — |
| Gastro Acid | abilities | sv:20 champions:8 swsh:29 usum:49 | medium | — | — |
| Role Play | abilities | sv:14 champions:15 swsh:97 usum:170 | medium | — | — |
| Simple Beam | abilities | sv:6 champions:4 swsh:22 usum:23 | medium | — | — |
| Worry Seed | abilities | sv:61 champions:18 swsh:73 usum:134 | medium | existing | — |
| Snatch | copy | usum:180 | medium | existing | — |
| Recycle | items | sv:22 champions:13 swsh:90 usum:140 | medium | existing | the item used before the turn (unless one was used this turn) |
| Ion Deluge | move-type | usum:11 | medium | — | — |
| Minimize | stages | sv:15 champions:7 swsh:16 usum:17 | medium | — | — |
| Tar Shot | stages | sv:2 swsh:1 | medium | — | — |
| Guard Split | stored-stats | sv:12 champions:7 swsh:24 usum:28 | medium | — | — |
| Power Split | stored-stats | sv:14 champions:8 swsh:23 usum:26 | medium | — | — |
| Power Trick | stored-stats | sv:5 champions:5 swsh:13 usum:22 | medium | — | an earlier Power Trick (default none, a fact) |
| Speed Swap | stored-stats | sv:2 champions:4 swsh:28 usum:6 | medium | existing | — |
| Conversion | types | sv:4 swsh:3 usum:4 | medium | — | the first move slot |
| Conversion 2 | types | sv:4 swsh:3 usum:4 | medium | new | the target's last move (unless it moved earlier this turn) |
| Magic Powder | types | sv:2 champions:1 swsh:1 | medium | — | — |
| Reflect Type | types | sv:8 champions:4 swsh:12 usum:19 | medium | — | — |
| Soak | types | sv:40 champions:10 swsh:30 usum:30 | medium | — | — |
| Aromatherapy | cures | swsh:54 usum:86 | low | existing | — |
| Heal Bell | cures | sv:5 champions:2 swsh:58 usum:101 | low | existing | — |
| Psycho Shift | cures | swsh:18 usum:27 | low | existing | — |
| Purify | cures | swsh:1 usum:2 | low | — | — |
| Swallow | cures | sv:54 champions:15 swsh:38 usum:58 | low | — | Stockpile layers and counters |
| Magic Room | field | sv:11 champions:35 swsh:66 usum:74 | low | — | — |
| Mud Sport | field | usum:90 | low | — | — |
| Water Sport | field | usum:73 | low | — | — |
| Wonder Room | field | sv:13 champions:52 swsh:108 usum:106 | low | — | — |
| Bestow | items | usum:43 | low | — | — |
| Corrosive Gas | items | champions:7 swsh:17 | low | — | — |
| Embargo | items | usum:118 | low | — | — |
| Stuff Cheeks | items | sv:8 champions:4 swsh:2 | low | existing | — |
| Teatime | items | sv:3 champions:2 swsh:2 | low | existing | — |
| Attract | next-move | sv:24 champions:116 swsh:623 usum:851 | low | new | genders |
| Foresight | next-move | usum:88 | low | — | — |
| Heal Block | next-move | usum:47 | low | — | — |
| Magic Coat | next-move | swsh:155 usum:239 | low | — | — |
| Miracle Eye | next-move | usum:21 | low | — | — |
| Nightmare | next-move | usum:103 | low | existing | — |
| Octolock | next-move | champions:1 swsh:1 | low | existing | — |
| Odor Sleuth | next-move | usum:72 | low | — | — |
| Powder | next-move | usum:23 | low | — | — |
| Telekinesis | next-move | usum:218 | low | — | — |
| Court Change | side | sv:2 champions:1 swsh:1 | low | — | — |
| Crafty Shield | side | swsh:7 usum:6 | low | — | — |
| Defog | side | sv:50 champions:15 swsh:134 usum:229 | low | — | — |
| Lucky Chant | side | usum:74 | low | — | — |
| Mat Block | side | swsh:1 usum:5 | low | — | its first turn out |
| Mist | side | sv:68 swsh:73 usum:74 | low | — | — |
| Acupressure | stages | sv:20 champions:8 swsh:19 usum:17 | low | new | — |
| Autotomize | stages | swsh:27 usum:47 | low | — | — |
| Captivate | stages | usum:541 | low | — | genders |
| Flower Shield | stages | swsh:4 usum:11 | low | — | — |
| Gear Up | stages | swsh:3 usum:3 | low | — | — |
| Geomancy | stages | swsh:1 usum:2 | low | — | a charge on the last turn (else the charge turn) |
| Guard Swap | stages | sv:12 champions:24 swsh:64 usum:37 | low | — | — |
| Heart Swap | stages | sv:2 usum:3 | low | — | — |
| Magnetic Flux | stages | sv:10 champions:3 swsh:4 usum:8 | low | — | — |
| No Retreat | stages | sv:2 champions:2 swsh:1 | low | — | an earlier No Retreat (default none, a fact) |
| Power Swap | stages | sv:8 champions:21 swsh:69 usum:34 | low | — | — |
| Psych Up | stages | sv:241 champions:92 swsh:216 usum:346 | low | — | — |
| Rototiller | stages | usum:27 | low | — | — |
| Stockpile | stages | sv:61 champions:18 swsh:41 usum:61 | low | — | earlier layers (default 0, a fact) |
| Tidy Up | stages | sv:7 champions:2 | low | — | — |
| Topsy-Turvy | stages | sv:3 champions:3 swsh:3 usum:3 | low | — | — |
| Power Shift | stored-stats | champions:0 | low | — | — |
| Camouflage | types | usum:50 | low | — | — |

### Stat stages (18)

#### Acupressure (`acupressure`): low risk

- **Games (learners):** Scarlet/Violet 20, Champions 8, Sword/Shield 19, Ultra Sun/Ultra Moon 17. **Dex:** target adjacentAllyOrSelf, priority 0, Normal, flags none.
- **Source:** PS/data/moves.ts:137-167 (onHit 146-162).
- **Showdown:** Target adjacentAllyOrSelf, no protect or bypasssub flag (an ally's Substitute blocks it: K19; the user's own does not). onHit picks one of the seven stages below +6 (accuracy and evasion included) with this.sample and gives +2 through this.boost (Contrary, Simple, the cap; a foe's Opportunist or Mirror Herb copies the rise); fails with all seven at +6 (PS/data/moves.ts:146-162).
- **Per game:** Same handler in all four; Champions has 20 PP (30 elsewhere).
- **Changes:** stat stage (one of atk, def, spa, spd, spe, accuracy, evasion).
- **Read later this turn:** The stage the sample picked: the target's later attack (Atk/SpA), hits into it (Def/SpD), the Speed order from generation 8 (sv, champions, swsh re-sort; usum keeps the turn's start order); accuracy and evasion are read by nothing the engine calculates but Stored Power, Power Trip and Punishment (doubles-turn.ts hiddenStages guard).
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** The stage (E2 build boosts; accuracy/evasion in vol.stages). Public (-boost line).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** doubles-status.ts applyBoosts (Contrary, Simple, cap, World.boosted rise for the Opportunist/Mirror Herb guard), MoveVolatiles.stages, targetsOf for adjacentAllyOrSelf (already used by Champions' Milk Drink), one world per sampled stat (mass 1/n).
- **Engine needs:** A sample branch over the stats below +6 (1/n each); worlds whose only difference is an accuracy/evasion stage that nothing reads can merge only where the guards agree.
- **Randomness:** sample over the n stages below +6: one world each, 1/n (status-eot Q14: 1/7 each from all 0).
- **Risk:** low: Pure stage write through the existing boost path; the branch is a uniform sample. Probes: K19, status-eot Q14.

#### Autotomize (`autotomize`): low risk

- **Games (learners):** Sword/Shield 27, Ultra Sun/Ultra Moon 47. **Dex:** target self, priority 0, Steel, flags none.
- **Source:** PS/data/moves.ts:878-907 (onTryHit 888-893, onHit 897-902); PS/data/mods/gen8/moves.ts:25-28.
- **Showdown:** Self, snatch. onTryHit fails at +6 Speed (−6 with Contrary); boosts Spe +2; onHit: weighthg = max(1, weighthg − 1000) when above 1 (−100 kg, '-start Autotomize') (PS/data/moves.ts:888-902).
- **Per game:** SwSh and USUM only (gen8 mod restores it); same handler. USUM keeps the turn's start order after the Speed rise.
- **Changes:** Speed stage; weight (weighthg).
- **Read later this turn:** Speed order from generation 8 (swsh); its weight for later Low Kick and Grass Knot into it (target weight) and Heavy Slam and Heat Crash (user and target weight) from any Pokémon (K18: Low Kick 100 → 40 power, 62 → 26 damage).
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** The weight loss while it stays in (no volatile; '-start Autotomize' is public). Not in Champions.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** applyBoosts; the calculator's species weight (makePokemon overrides).
- **Engine needs:** A per-world weight change on MonState passed to the calculation as a weight override (2v2 only; Heavy Metal, Light Metal and Float Stone then apply on top as ModifyWeight does: PS/sim/pokemon.ts:685-688).
- **Inputs:** An Autotomize from an earlier turn would be a weight input (rare; else a fact).
- **Randomness:** none
- **Risk:** low: One number into the calculation; the weight modifiers stay the engine's own. Probes: K18.

#### Captivate (`captivate`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 541. **Dex:** target allAdjacentFoes, priority 0, Normal, flags protect, reflectable.
- **Source:** PS/data/moves.ts:2184-2204 (onTryImmunity 2194-2196); PS/data/mods/gen7/moves.ts:77-80.
- **Showdown:** allAdjacentFoes, protect, reflectable. onTryImmunity: opposite genders only (genderless never); boosts SpA −2 through boost() (Clear Body, Defiant/Competitive +2, White Herb); Oblivious onTryHit makes it -immune (PS/data/abilities.ts:3024-3029) (K20).
- **Per game:** USUM only (gen7 mod). Generation 7: no Mirror Armor, no Eject Pack.
- **Changes:** SpA stage.
- **Read later this turn:** The foes' later special attacks.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Stages (public).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** applyBoosts, bounce (Magic Bounce/Magic Coat), Wide Guard on spread status moves, the build's configuration.gender (getBuildGender).
- **Engine needs:** A gender check at TryImmunity; an unknown gender (the calculator's 'Unknown') of a species that has both is not estimated.
- **Inputs:** Genders of the user and both foes (the calculator has the Gender field; Training knows them).
- **Randomness:** none
- **Risk:** low: Existing stage path; only the gender input is new. Probes: K20.

#### Flower Shield (`flowershield`): low risk

- **Games (learners):** Sword/Shield 4, Ultra Sun/Ultra Moon 11. **Dex:** target all, priority 0, Fairy, flags none.
- **Source:** PS/data/moves.ts:5849-5881 (onHitField 5859-5876); PS/data/mods/gen8/moves.ts:141-144.
- **Showdown:** Target all (onHitField): every active Grass type (as its types are now), Max Guard checked through TryHit in SwSh, gets Def +1 through boost() with the user as source (a foe's Contrary gives −1); fails with no Grass type (PS/data/moves.ts:5859-5876) (K22).
- **Per game:** SwSh and USUM only; same handler.
- **Changes:** Def stage of each Grass type in play.
- **Read later this turn:** Physical hits into those Pokémon.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Stages.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** sideOrField (target all), applyBoosts, typesOf.
- **Engine needs:** Nothing beyond the handler; Grass-ness reads the per-world types once type changes exist.
- **Randomness:** none
- **Risk:** low: A field-target boost on the existing path. Probes: K22.

#### Gear Up (`gearup`): low risk

- **Games (learners):** Sword/Shield 3, Ultra Sun/Ultra Moon 3. **Dex:** target allySide, priority 0, Steel, flags bypasssub.
- **Source:** PS/data/moves.ts:6479-6505 (onHitSide 6489-6500); PS/data/mods/gen8/moves.ts:178-181.
- **Showdown:** allySide (onHitSide), snatch, bypasssub: each Pokémon on the user's side with Plus or Minus (hasAbility: not suppressed), Max Guard checked, gets Atk +1 SpA +1 (boost isSelf); fails with none (PS/data/moves.ts:6489-6500).
- **Per game:** SwSh and USUM only; same handler.
- **Changes:** Atk and SpA stages of Plus/Minus allies.
- **Read later this turn:** Those Pokémon's later attacks.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Stages.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** sideOrField, applyBoosts; Plus and Minus are already read for the calculation (MODELLED_THIRD_PARTY).
- **Engine needs:** The handler.
- **Randomness:** none
- **Risk:** low: Existing stage path; few holders.

#### Magnetic Flux (`magneticflux`): low risk

- **Games (learners):** Scarlet/Violet 10, Champions 3, Sword/Shield 4, Ultra Sun/Ultra Moon 8. **Dex:** target allySide, priority 0, Electric, flags bypasssub.
- **Source:** PS/data/moves.ts:10827-10853 (onHitSide 10836-10848).
- **Showdown:** allySide (onHitSide), snatch, bypasssub: Plus/Minus Pokémon on the user's side, Max Guard checked, get Def +1 SpD +1 (boost isSelf); fails with none (PS/data/moves.ts:10836-10848).
- **Per game:** Same in all four.
- **Changes:** Def and SpD stages of Plus/Minus allies.
- **Read later this turn:** Hits into those Pokémon.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Stages.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Gear Up.
- **Engine needs:** The handler.
- **Randomness:** none
- **Risk:** low: As Gear Up.

#### Geomancy (`geomancy`): low risk

- **Games (learners):** Sword/Shield 1, Ultra Sun/Ultra Moon 2. **Dex:** target self, priority 0, Fairy, flags none.
- **Source:** PS/data/moves.ts:6529-6559 (onTryMove 6539-6549); PS/data/mods/gen8/moves.ts:182-185.
- **Showdown:** Charge move (flags charge, nosleeptalk, failinstruct). onTryMove: without its volatile it prepares and runs ChargeMove: Power Herb (PS/data/items.ts:4771-4787) is used and the move goes on at once, else it adds twoturnmove and stops (charge turn). Boosts SpA, SpD, Spe +2 on the second (or Power Herb) use (PS/data/moves.ts:6539-6554) (K21).
- **Per game:** SwSh and USUM only; same handler. Re-sort after the Speed rise only in SwSh.
- **Changes:** SpA/SpD/Spe stages (Power Herb); Power Herb used (item gone, Unburden); twoturnmove volatile (charge turn).
- **Read later this turn:** With Power Herb: the stages (hits into it, Speed order in SwSh), its lost item (Unburden). Without: nothing this turn.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Charge turn: locked into Geomancy next turn (twoturnmove + geomancy volatiles); not in Champions.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** doubles-turn.ts Power Herb gate for charge moves (powerherb onChargeMove, ~doubles-turn.ts:1864-1874), applyBoosts, item loss with Unburden (doubles-items.ts unburden).
- **Engine needs:** The charge-turn branch for a status move (E2: the charging volatile).
- **Inputs:** Its second turn (the move released after a charge on the last turn) would be an input; absent, the charge turn.
- **Randomness:** none
- **Risk:** low: Deterministic; reuses the damaging charge moves' Power Herb rule. Probes: K21.

#### Minimize (`minimize`): medium risk

- **Games (learners):** Scarlet/Violet 15, Champions 7, Sword/Shield 16, Ultra Sun/Ultra Moon 17. **Dex:** target self, priority 0, Normal, flags none.
- **Source:** PS/data/moves.ts:11918-11950 (condition 11928-11942).
- **Showdown:** Self, snatch. Evasion +2 (boost) and volatile minimize: onSourceModifyDamage ×2 for moves with flags.minimize (Body Slam, Stomp, Dragon Rush, Heat Crash, Heavy Slam, Flying Press, Steamroller, Phantom Force, Shadow Force, Malicious Moonsault, Double Iron Bash, Supercell Slam...), onAccuracy true for them (PS/data/moves.ts:11928-11945) (K15: Body Slam 78 → 156).
- **Per game:** Same in all four.
- **Changes:** evasion stage; minimize volatile.
- **Read later this turn:** Every later minimize-flag hit into it doubles (a final ModifyDamage modifier, chained with the target's other ModifyDamage handlers); accuracy is not read (every move hits); evasion +2 is read by Stored Power/Power Trip (guard).
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** The volatile stays while it is in (noCopy). Training: 'minimize' is not mapped (rollout today).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** applyBoosts (evasion in vol.stages), the hiddenStages guard.
- **Engine needs:** A ModifyDamage ×2 (chainModify 2) into the engine's final-modifier chain for minimize-flag moves into a minimized target (the vendored @smogon/calc has no Minimize: engine-corrections.cjs-style hook on the final chain), with its order against Friend Guard, resist Berries, Multiscale and the screens.
- **Inputs:** A Minimize from an earlier turn (Training: map the volatile; calculator: a control, or the fact that none is assumed).
- **Randomness:** none
- **Risk:** medium: Needs a new modifier in the calculation's final chain; rounding order against other ModifyDamage handlers must match. Probes: K15.

#### No Retreat (`noretreat`): low risk

- **Games (learners):** Scarlet/Violet 2, Champions 2, Sword/Shield 1. **Dex:** target self, priority 0, Fighting, flags none.
- **Source:** PS/data/moves.ts:12788-12821 (onTry 12798-12803, condition 12804-12811).
- **Showdown:** Self, snatch. onTry fails while its noretreat volatile is up; if the user is already trapped the volatile is dropped (boosts only). Boosts all five +1 in one boost(); the volatile traps it (PS/data/moves.ts:12798-12818).
- **Per game:** SV, Champions, SwSh; same handler.
- **Changes:** Atk/Def/SpA/SpD/Spe stages; noretreat volatile.
- **Read later this turn:** Hits into it, the Speed order (all three games re-sort), a foe's Opportunist/Mirror Herb (guard today).
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** The volatile (trapped; a second use fails). Public (-start move: No Retreat).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** applyBoosts.
- **Engine needs:** The onTry failure from carried state.
- **Inputs:** Whether it used No Retreat before (Training: the volatile; calculator: assumed not, a fact).
- **Randomness:** none
- **Risk:** low: Stage moves already exact; one carried flag.

#### Stockpile (`stockpile`): low risk

- **Games (learners):** Scarlet/Violet 61, Champions 18, Sword/Shield 41, Ultra Sun/Ultra Moon 61. **Dex:** target self, priority 0, Normal, flags none.
- **Source:** PS/data/moves.ts:17961-18013 (onTry 17970-17972, condition 17974-18008).
- **Showdown:** Self, snatch. onTry fails at 3 layers. Volatile stockpile: each use adds a layer and boosts Def +1 SpD +1 from itself, counting in effectState.def/spd only the stats that changed; its End reverses exactly those (PS/data/moves.ts:17970-18008) (K31).
- **Per game:** Same in all four.
- **Changes:** Def/SpD stages; stockpile layers and per-stat counters.
- **Read later this turn:** Hits into it.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Layers and counters for Swallow, Spit Up and its switch-out. Tracker counts the layers from '-start stockpileN' (public); the per-stat counters follow from the public -boost lines.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** applyBoosts.
- **Engine needs:** The failure at 3 layers from carried layers; the counters in E2.
- **Inputs:** Layers from earlier turns (default 0 with a fact).
- **Randomness:** none
- **Risk:** low: Stage path; the carried counters are public. Probes: K31.

#### Tar Shot (`tarshot`): medium risk

- **Games (learners):** Scarlet/Violet 2, Sword/Shield 1. **Dex:** target normal, priority 0, Rock, flags protect, reflectable.
- **Source:** PS/data/moves.ts:18946-18974 (condition 18956-18968); PS/data/mods/champions/moves.ts:1001-1004.
- **Showdown:** protect, reflectable. Boosts Spe −1 (boost event: Clear Body, Mirror Armor, Defiant/Competitive, Eject Pack, White Herb) and volatile tarshot: onStart fails on a Terastallized target; onEffectiveness (priority −2) +1 for Fire moves on the target's first type only (PS/data/moves.ts:18956-18971) (K16: Flamethrower 25 → 50).
- **Per game:** SV and SwSh (Champions: Past). The Tera failure is SV only.
- **Changes:** Spe stage; tarshot volatile.
- **Read later this turn:** Later Fire hits into it (×2 effectiveness, read by Expert Belt, Filter/Solid Rock/Prism Armor, Tinted Lens), the Speed order (both games re-sort).
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** The volatile (no noCopy: Baton Pass passes it). Not in Champions.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** applyBoosts; engine-corrections.cjs's getMoveEffectiveness wrapper (neutralEffectiveness) shows the hook point.
- **Engine needs:** An effectiveness hook: Fire into a tarred target +1 on its first type (the calculation's type1 effectiveness ×2), exempt when the volatile failed (Tera).
- **Inputs:** Tar Shot from an earlier turn (SwSh/SV calculator: a control or a fact).
- **Randomness:** none
- **Risk:** medium: An effectiveness change inside the vendored calculation; the effectiveness-reading modifiers must see it. Probes: K16.

#### Tidy Up (`tidyup`): low risk

- **Games (learners):** Scarlet/Violet 7, Champions 2. **Dex:** target self, priority 0, Normal, flags none.
- **Source:** PS/data/moves.ts:19626-19655 (onHit 19635-19652).
- **Showdown:** Self. onHit removes every active Pokémon's Substitute and the hazards (Spikes, Toxic Spikes, Stealth Rock, Sticky Web, G-Max Steelsurge) on every side, then boosts Atk +1 Spe +1 (boost isSelf) (PS/data/moves.ts:19635-19652) (K24).
- **Per game:** SV and Champions; same handler.
- **Changes:** Substitutes removed; hazards removed; Atk/Spe stages.
- **Read later this turn:** Later hits into a former Substitute holder reach the Pokémon (K24); the Speed order (both games re-sort).
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** No Substitutes; hazards gone (E2 sides.hazards).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** vol.substitute (delete), World.sides.hazards, applyBoosts.
- **Engine needs:** The handler.
- **Randomness:** none
- **Risk:** low: Removes state the engine already holds. Probes: K24.

#### Topsy-Turvy (`topsyturvy`): low risk

- **Games (learners):** Scarlet/Violet 3, Champions 3, Sword/Shield 3, Ultra Sun/Ultra Moon 3. **Dex:** target normal, priority 0, Dark, flags protect, reflectable.
- **Source:** PS/data/moves.ts:19656-19680 (onHit 19665-19675).
- **Showdown:** protect, reflectable, no bypasssub. onHit negates every nonzero stage (all seven) by direct write: no boost event (no Defiant, no Eject Pack, no Opportunist); fails with all zero (PS/data/moves.ts:19665-19675) (K14).
- **Per game:** Same in all four.
- **Changes:** all stages of the target.
- **Read later this turn:** Every later calculation with the target, the Speed order (gen 8+).
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Stages.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** build.boosts and vol.stages written directly (not applyBoosts).
- **Engine needs:** The handler (no World.boosted entry, no reactions).
- **Randomness:** none
- **Risk:** low: Direct write. Probes: K14.

#### Guard Swap (`guardswap`): low risk

- **Games (learners):** Scarlet/Violet 12, Champions 24, Sword/Shield 64, Ultra Sun/Ultra Moon 37. **Dex:** target normal, priority 0, Psychic, flags protect, bypasssub.
- **Source:** PS/data/moves.ts:7973-8001 (onHit 7982-7996).
- **Showdown:** protect, bypasssub. onHit swaps Def and SpD stages of user and target with setBoost (no boost event) (PS/data/moves.ts:7982-7996).
- **Per game:** Same in all four.
- **Changes:** Def/SpD stages of both.
- **Read later this turn:** Later hits into either.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Stages.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** build.boosts.
- **Engine needs:** The handler.
- **Randomness:** none
- **Risk:** low: Direct write.

#### Power Swap (`powerswap`): low risk

- **Games (learners):** Scarlet/Violet 8, Champions 21, Sword/Shield 69, Ultra Sun/Ultra Moon 34. **Dex:** target normal, priority 0, Psychic, flags protect, bypasssub.
- **Source:** PS/data/moves.ts:13783-13811 (onHit 13792-13806).
- **Showdown:** protect, bypasssub. Swaps Atk and SpA stages with setBoost (PS/data/moves.ts:13792-13806).
- **Per game:** Same in all four.
- **Changes:** Atk/SpA stages of both.
- **Read later this turn:** Later attacks by either Pokémon.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Stages.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** build.boosts.
- **Engine needs:** The handler.
- **Randomness:** none
- **Risk:** low: Direct write.

#### Heart Swap (`heartswap`): low risk

- **Games (learners):** Scarlet/Violet 2, Ultra Sun/Ultra Moon 3. **Dex:** target normal, priority 0, Psychic, flags protect, bypasssub.
- **Source:** PS/data/moves.ts:8448-8476 (onHit 8457-8471); PS/data/mods/champions/moves.ts:460-463; PS/data/mods/gen8/moves.ts:338-341; PS/data/mods/gen7/moves.ts:364-367.
- **Showdown:** protect, bypasssub. Swaps all seven stages with setBoost (PS/data/moves.ts:8457-8471).
- **Per game:** SV and USUM (Past in Champions and SwSh: their mods).
- **Changes:** all stages of both.
- **Read later this turn:** Every later calculation with either; the Speed order (SV).
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Stages.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** build.boosts, vol.stages.
- **Engine needs:** The handler.
- **Randomness:** none
- **Risk:** low: Direct write.

#### Psych Up (`psychup`): low risk

- **Games (learners):** Scarlet/Violet 241, Champions 92, Sword/Shield 216, Ultra Sun/Ultra Moon 346. **Dex:** target normal, priority 0, Normal, flags bypasssub.
- **Source:** PS/data/moves.ts:14212-14244 (onHit 14221-14239).
- **Showdown:** bypasssub, no protect, not reflectable. onHit copies all seven stages onto the user (direct write) and replaces its crit volatiles with the target's Dragon Cheer (with hasDragonType), Focus Energy, G-Max Chi Strike (layers) and Laser Focus (PS/data/moves.ts:14221-14239) (status-eot Q7).
- **Per game:** Same in all four (G-Max Chi Strike only in SwSh).
- **Changes:** user's stages; user's crit volatiles.
- **Read later this turn:** Hits into the user (its stages). Its crit stage and Laser Focus would act only on its own later moves: none this turn.
- **Read at the end of turn:** Nothing (Laser Focus ends at the residual, duration 2 from its use: not this turn's).
- **Left for the next turn:** Stages and crit volatiles (build.focusEnergy / dragonCheer; G-Max Chi Strike layers in SwSh, Laser Focus).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** build.boosts, vol.stages, BattleBuild.focusEnergy / dragonCheer.
- **Engine needs:** The handler; E2 carries Laser Focus (not in the build) as a volatile.
- **Randomness:** none
- **Risk:** low: Direct write; the crit fields exist. Probes: status-eot Q7.

#### Rototiller (`rototiller`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 27. **Dex:** target all, priority 0, Ground, flags none.
- **Source:** PS/data/moves.ts:15465-15498 (onHitField 15475-15493); PS/data/mods/gen7/moves.ts:805-808.
- **Showdown:** Target all, nonsky (onHitField): an airborne Pokémon (runImmunity Ground fails) is -immune; each grounded Grass type gets Atk +1 SpA +1 (boost, the user as source); fails with no grounded Grass type and no airborne one (PS/data/moves.ts:15475-15493) (K23).
- **Per game:** USUM only.
- **Changes:** Atk/SpA stages of grounded Grass types.
- **Read later this turn:** Their later attacks.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Stages.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** sideOrField, applyBoosts, kernel.grounded, typesOf.
- **Engine needs:** The handler.
- **Randomness:** none
- **Risk:** low: Existing stage path. Probes: K23.

### Stored stats (5)

#### Power Split (`powersplit`): medium risk

- **Games (learners):** Scarlet/Violet 14, Champions 8, Sword/Shield 23, Ultra Sun/Ultra Moon 26. **Dex:** target normal, priority 0, Psychic, flags protect.
- **Source:** PS/data/moves.ts:13760-13782 (onHit 13769-13777).
- **Showdown:** protect, no bypasssub. onHit sets both Pokémon's stored Atk to floor((a + b) / 2) and stored SpA likewise (storedStats, not stages) (PS/data/moves.ts:13769-13777) (K12b).
- **Per game:** Same in all four.
- **Changes:** stored Atk and SpA of both.
- **Read later this turn:** Every later calculation that reads those raw stats: their attacks, Foul Play into either (the target's Atk), the confusion self-hit (stored Atk), Strength Sap, Photon Geyser / Shell Side Arm choices, Beast Boost at a KO (best stat).
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** The averaged stats while they stay in (no volatile, only '-activate'; the values are not shown). Training's bridge does not see it (liveBuild recomputes stats from the set): a latent gap today.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** kernel.buildStats (model.ts getBuildStats) is the engine's one stored-stat source; calculate.ts makePokemon builds the calculator's Pokémon.
- **Engine needs:** A per-world stored-stat override on MonState; buildStats and every reader go through it; the calculation's Pokémon takes it (rawStats/stats override with a clone hook, as calculate.ts withTypes does for types); the speed path (speedOf) too.
- **Inputs:** A split from an earlier turn: an input of the stats (Training: track the '-activate' and recompute from the belief builds; hidden values otherwise).
- **Randomness:** none
- **Risk:** medium: Many readers of stored stats; the calculation has no stat override today. Probes: K12b.

#### Guard Split (`guardsplit`): medium risk

- **Games (learners):** Scarlet/Violet 12, Champions 7, Sword/Shield 24, Ultra Sun/Ultra Moon 28. **Dex:** target normal, priority 0, Psychic, flags protect.
- **Source:** PS/data/moves.ts:7950-7972 (onHit 7959-7967).
- **Showdown:** protect, no bypasssub. Stored Def and SpD of both set to their floor averages (PS/data/moves.ts:7959-7967) (K12: Shuckle Def 250 → 165, Body Slam 10 → 13).
- **Per game:** Same in all four.
- **Changes:** stored Def and SpD of both.
- **Read later this turn:** Hits into either (Wonder Room swaps the stored Def/SpD at read time: PS/sim/pokemon.ts:568-575), Body Press by either (its Def), the confusion self-hit (stored Def).
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** As Power Split (latent Training gap).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Power Split.
- **Engine needs:** As Power Split.
- **Inputs:** As Power Split.
- **Randomness:** none
- **Risk:** medium: As Power Split. Probes: K12.

#### Speed Swap (`speedswap`): medium risk

- **Games (learners):** Scarlet/Violet 2, Champions 4, Sword/Shield 28, Ultra Sun/Ultra Moon 6. **Dex:** target normal, priority 0, Psychic, flags protect, bypasssub.
- **Source:** PS/data/moves.ts:17431-17450 (onHit 17440-17445).
- **Showdown:** protect, bypasssub. Swaps stored Speed of user and target (PS/data/moves.ts:17440-17445) (K10).
- **Per game:** Same handler; generation 8+ (sv, champions, swsh) re-sorts the remaining actions after it (PS/sim/battle.ts:2919-2926), USUM keeps the turn's start order (K10 sv vs usum).
- **Changes:** stored Speed of both.
- **Read later this turn:** The order of the remaining actions (gen 8+), Gyro Ball and Electro Ball, the end of turn's Speed order.
- **Read at the end of turn:** Residual handlers of equal order sort by the new Speed (PS/sim/battle.ts updateSpeed at the residual).
- **Left for the next turn:** As Power Split (latent Training gap).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** speedOf (memoised per world), the gen-7 frozen keys, residual speeds (doubles-eot.ts Speeds).
- **Engine needs:** The stored-stat override (as Power Split) read by speedOf.
- **Inputs:** As Power Split.
- **Randomness:** Speed ties it creates are shuffled (existing tie branches).
- **Risk:** medium: Order changes ripple through the walk; the override plumbing as Power Split. Probes: K10.

#### Power Trick (`powertrick`): medium risk

- **Games (learners):** Scarlet/Violet 5, Champions 5, Sword/Shield 13, Ultra Sun/Ultra Moon 22. **Dex:** target self, priority 0, Psychic, flags none.
- **Source:** PS/data/moves.ts:13812-13851 (condition 13822-13846).
- **Showdown:** Self, snatch. Volatile powertrick: onStart swaps stored Atk and Def; a second use removes it (onRestart) and its End swaps back (PS/data/moves.ts:13822-13846) (K11: Body Slam 6 → 55).
- **Per game:** Same in all four.
- **Changes:** stored Atk and Def of the user; powertrick volatile.
- **Read later this turn:** Hits into the user (its Def is the old Atk), Foul Play into it (its Atk), the confusion self-hit (no: its own move this turn is Power Trick).
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** The volatile (public '-start Power Trick'); Training: not mapped (rollout today).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Power Split.
- **Engine needs:** The stored-stat override; the onRestart toggle from carried state.
- **Inputs:** Power Trick active from an earlier turn.
- **Randomness:** none
- **Risk:** medium: As Power Split. Probes: K11.

#### Power Shift (`powershift`): low risk

- **Games (learners):** Champions 0. **Dex:** target self, priority 0, Normal, flags none.
- **Source:** PS/data/moves.ts:13721-13759 (condition 13732-13756); PS/data/mods/champions/moves.ts:717-720.
- **Showdown:** As Power Trick on the user's stored Atk and Def (volatile powershift) (PS/data/moves.ts:13732-13756).
- **Per game:** Champions only (champions mod sets isNonstandard null, PS/data/mods/champions/moves.ts:717-720); no Champions species learns it (0 learners in data/champions/catalog.json).
- **Changes:** stored Atk and Def of the user; powershift volatile.
- **Read later this turn:** As Power Trick.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** As Power Trick.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Power Trick.
- **Engine needs:** As Power Trick (free once Power Trick is built).
- **Randomness:** none
- **Risk:** low: Unreachable in the catalog; identical to Power Trick.

### Types (8)

#### Soak (`soak`): medium risk

- **Games (learners):** Scarlet/Violet 40, Champions 10, Sword/Shield 30, Ultra Sun/Ultra Moon 30. **Dex:** target normal, priority 0, Water, flags protect, reflectable.
- **Source:** PS/data/moves.ts:17187-17209 (onHit 17196-17204).
- **Showdown:** protect, reflectable. onHit: fails ('-fail', null) when the types are already exactly Water or setType fails: Arceus/Silvally from gen 5, a Terastallized target (PS/sim/pokemon.ts:2109-2129, 2119; K3b); setType replaces the types and clears addedType (PS/data/moves.ts:17196-17204) (K1).
- **Per game:** Same in all four; the Tera failure only in SV.
- **Changes:** types.
- **Read later this turn:** Effectiveness and immunity of later hits into it (K1: Thunderbolt into Garchomp, immune → 2x; Freeze-Dry), STAB of its own later move, grounding (a Flying type loses it: Ground moves, terrains), status immunities of later status moves (Poison/Steel, Electric, Fire, Grass powder and Leech Seed), Tar Shot's first type, Roost's typeWas.
- **Read at the end of turn:** Sand and hail immunities (K1: Garchomp now takes sand), Black Sludge (a holder that lost Poison loses 1/8), Grassy heal (grounding).
- **Left for the next turn:** The types while it stays in ('-start typechange Water', public). Training's bridge does not see it (types are not a volatile; liveBuild takes the species types): a latent gap.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** kernel.typesOf is the engine's single type source (doubles-turn.ts:1402-1405), read by grounded, the status immunities, ResidualMon.types; calculate.ts makePokemon already takes a types override (withTypes, Mimicry).
- **Engine needs:** A per-world types field on MonState read by typesOf (Tera still wins), passed to the calculation (generalise withTypes from one to two types).
- **Inputs:** A type change from an earlier turn (Training: the public typechange; calculator: a control, or none assumed).
- **Randomness:** none
- **Risk:** medium: One state field, but many readers (calculation, immunities, grounding, residuals) must all read it. Probes: K1, K3b.

#### Magic Powder (`magicpowder`): medium risk

- **Games (learners):** Scarlet/Violet 2, Champions 1, Sword/Shield 1. **Dex:** target normal, priority 0, Psychic, flags protect, reflectable, powder.
- **Source:** PS/data/moves.ts:10739-10754 (onHit 10748-10751).
- **Showdown:** As Soak with Psychic; powder flag (Grass types, Overcoat and Safety Goggles are immune) (PS/data/moves.ts:10748-10751).
- **Per game:** SV, Champions, SwSh; same handler.
- **Changes:** types.
- **Read later this turn:** As Soak (Psychic: Dark/Ghost/Bug weaknesses, Psychic STAB).
- **Read at the end of turn:** As Soak.
- **Left for the next turn:** As Soak (latent Training gap).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Soak; kernel.powderImmune.
- **Engine needs:** As Soak.
- **Inputs:** As Soak.
- **Randomness:** none
- **Risk:** medium: As Soak.

#### Forest's Curse (`forestscurse`): high risk

- **Games (learners):** Scarlet/Violet 3, Champions 1, Sword/Shield 2, Ultra Sun/Ultra Moon 3. **Dex:** target normal, priority 0, Grass, flags protect, reflectable.
- **Source:** PS/data/moves.ts:6126-6144 (onHit 6135-6139).
- **Showdown:** protect, reflectable. onHit: fails on a Grass type or when addType fails (Terastallized); adds Grass as a third type (addedType) (PS/data/moves.ts:6135-6139; PS/sim/pokemon.ts:2132-2146) (K2: Ice Beam into Gyarados 45 → 90).
- **Per game:** Same in all four; the Tera failure only in SV.
- **Changes:** added type.
- **Read later this turn:** Effectiveness with three types (K2), Grass immunities (powder moves, Leech Seed), its STAB for Grass moves (hasType includes the added type), Flower Shield/Rototiller targets.
- **Read at the end of turn:** Nothing type-specific (no residual reads Grass).
- **Left for the next turn:** The added type ('-start typeadd', public); latent Training gap as Soak.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Soak.
- **Engine needs:** A third type: the vendored calculation reads only types[0] and types[1] (node_modules/@smogon/calc/dist/mechanics/gen789.js:300-302), so its effectiveness and STAB need a hook (the getMoveEffectiveness wrapper of engine-corrections.cjs multiplies the third type in).
- **Inputs:** As Soak.
- **Randomness:** none
- **Risk:** high: The calculation cannot hold three types; every effectiveness and STAB reader must see the added one. Probes: K2.

#### Trick-or-Treat (`trickortreat`): high risk

- **Games (learners):** Champions 4, Sword/Shield 8, Ultra Sun/Ultra Moon 9. **Dex:** target normal, priority 0, Ghost, flags protect, reflectable.
- **Source:** PS/data/moves.ts:19913-19940 (onHit 19923-19935); PS/data/mods/champions/moves.ts:1039-1042; PS/data/mods/gen8/moves.ts:682-685.
- **Showdown:** protect, reflectable. Adds Ghost as a third type (fails on a Ghost type or Terastallized). 'Curse Glitch': a target in the second position of a doubles side with a queued Curse gets that Curse's targetLoc −1 (PS/data/moves.ts:19923-19935, the glitch at 19928-19934) (K2b: Close Combat immune).
- **Per game:** Champions, SwSh, USUM (not SV); same handler.
- **Changes:** added type; a queued Curse's target (glitch).
- **Read later this turn:** Normal and Fighting immunity, Ghost weakness and STAB, a queued Curse of the target becomes the Ghost Curse (half its HP, PS/data/moves.ts curse onModifyMove) aimed by the glitch.
- **Read at the end of turn:** The Ghost Curse's 1/4 if that Curse landed.
- **Left for the next turn:** The added type (public); latent Training gap as Soak.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Forest's Curse; the Curse handler (doubles-status.ts makeUse/onHit curse).
- **Engine needs:** As Forest's Curse, plus the glitch's retarget of a queued Curse.
- **Inputs:** As Soak.
- **Randomness:** none
- **Risk:** high: Three types in the calculation and the queued-Curse glitch. Probes: K2b.

#### Reflect Type (`reflecttype`): medium risk

- **Games (learners):** Scarlet/Violet 8, Champions 4, Sword/Shield 12, Ultra Sun/Ultra Moon 19. **Dex:** target normal, priority 0, Normal, flags protect, bypasssub.
- **Source:** PS/data/moves.ts:14884-14915 (onHit 14893-14910).
- **Showdown:** protect, bypasssub. onHit: fails for an Arceus/Silvally user or a Terastallized user; copies target.getTypes(true) (a Tera target gives its Tera Type; '???' dropped; with none left and an added type: Normal) and the added type onto the user (PS/data/moves.ts:14893-14910) (K3: Thunderbolt into Jolteon now immune).
- **Per game:** Same in all four; the Tera branches only in SV.
- **Changes:** user's types and added type.
- **Read later this turn:** Hits into the user; its status immunities.
- **Read at the end of turn:** As Soak for the user.
- **Left for the next turn:** As Soak (latent Training gap; the tracker completes 'typechange' with no types from endTurn's display line).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Soak.
- **Engine needs:** As Soak (an added type copied makes it a three-type case).
- **Inputs:** As Soak.
- **Randomness:** none
- **Risk:** medium: As Soak; the added-type copy is the Forest's Curse case. Probes: K3.

#### Conversion (`conversion`): medium risk

- **Games (learners):** Scarlet/Violet 4, Sword/Shield 3, Ultra Sun/Ultra Moon 4. **Dex:** target self, priority 0, Normal, flags none.
- **Source:** PS/data/moves.ts:2795-2813 (onHit 2804-2808); PS/data/mods/champions/moves.ts:141-144.
- **Showdown:** Self, snatch. The type of the user's first move slot (moveSlots[0]); fails when it already has that type or setType fails (PS/data/moves.ts:2804-2808).
- **Per game:** SV, SwSh, USUM (Past in Champions).
- **Changes:** user's types.
- **Read later this turn:** Hits into the user.
- **Read at the end of turn:** As Soak for the user.
- **Left for the next turn:** As Soak.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Soak.
- **Engine needs:** The move-slot order: DoublesPokemonInput.moves is 'the quick moves plus its chosen move', not Showdown's slot order.
- **Inputs:** Its first move (Training: moveSlots; calculator: the first move of the set as entered, or not estimated).
- **Randomness:** none
- **Risk:** medium: Type plumbing as Soak; the first-slot input.

#### Conversion 2 (`conversion2`): medium risk

- **Games (learners):** Scarlet/Violet 4, Sword/Shield 3, Ultra Sun/Ultra Moon 4. **Dex:** target normal, priority 0, Normal, flags bypasssub.
- **Source:** PS/data/moves.ts:2814-2848 (onHit 2823-2843); PS/data/mods/champions/moves.ts:145-148.
- **Showdown:** bypasssub, no protect. Needs target.lastMoveUsed (the ActiveMove: its type after ModifyType); picks with this.sample a type the user does not have that resists or is immune to that type; fails with none (PS/data/moves.ts:2823-2843) (K4: Normal → Steel or Ghost, 1/2 each).
- **Per game:** SV, SwSh, USUM (Past in Champions).
- **Changes:** user's types.
- **Read later this turn:** Hits into the user.
- **Read at the end of turn:** As Soak for the user.
- **Left for the next turn:** As Soak.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Soak; MoveVolatiles.usedMove and the step's effective type for a target that moved this turn.
- **Engine needs:** The last move's used type: this turn's from the target's step; before the turn, the input lastMove's type (exact only when its type is fixed: not Weather Ball, Hidden Power, Judgment, an -ate ability...).
- **Inputs:** The target's last move (input lastMove; absent: not estimated).
- **Randomness:** sample over the qualifying types: one world each, uniform.
- **Risk:** medium: Random type world per branch plus the used-type input. Probes: K4.

#### Camouflage (`camouflage`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 50. **Dex:** target self, priority 0, Normal, flags none.
- **Source:** PS/data/moves.ts:2154-2183 (onHit 2164-2178); PS/data/mods/gen7/moves.ts:73-76.
- **Showdown:** Self, snatch. Type from the terrain: Electric, Grass, Fairy, Psychic, else Normal; fails when already exactly that type or setType fails (PS/data/moves.ts:2164-2178) (K54).
- **Per game:** USUM only (gen7 mod).
- **Changes:** user's types.
- **Read later this turn:** Hits into the user.
- **Read at the end of turn:** As Soak for the user.
- **Left for the next turn:** As Soak (USUM: no Training).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Soak; w.field.terrain.
- **Engine needs:** As Soak.
- **Randomness:** none
- **Risk:** low: Single type set; no Tera in USUM. Probes: K54.

### Abilities (7)

#### Skill Swap (`skillswap`): high risk

- **Games (learners):** Scarlet/Violet 133, Champions 71, Sword/Shield 104, Ultra Sun/Ultra Moon 131. **Dex:** target normal, priority 0, Psychic, flags protect, bypasssub.
- **Source:** PS/data/moves.ts:16591-16607 (onHit 16600-16602).
- **Showdown:** protect, bypasssub. battle.skillSwap: fails for a fainted party, a Dynamaxed one (SwSh), a failskillswap ability on either side (per game: census-moves-dex.out), the same ability in gen ≤ 5; SetAbility on both (Ability Shield); End of both abilities, swap, fresh abilityState, then Start of both (PS/sim/battle.ts:1311-1345) (K5: Levitate moves, Earthquake hits Bronzong; status-eot Q2: Intimidate's Start drops the foes).
- **Per game:** Same handler; failskillswap lists differ by catalog (SV 23, Champions 6, SwSh 14, USUM 12 abilities). Gen 8+ recomputes the queued actions' priority after the action (PS/sim/battle.ts:2642-2647, 2919-2926): a moved Prankster, Gale Wings or Triage changes later priorities; USUM keeps them.
- **Changes:** abilities of both; ability states (Flash Fire, Unburden, Protosynthesis... reset); whatever the Starts and Ends do.
- **Read later this turn:** Everything ability-driven: later calculations (Huge Power, Thick Fat, Levitate, Filter, Multiscale...), absorbing and redirecting abilities, contact abilities, partner abilities (Friend Guard, Plus/Minus, Battery...), priority (gen 8+), Speed abilities and the re-sort, Neutralizing Gas suppression. Ends: Unnerve (Berries due at once), Air Lock/Cloud Nine (the weather acts again), Protosynthesis/Quark Drive (boost lost), Slow Start, Supreme Overlord, Flash Fire, Unburden, Gorilla Tactics, Illusion, Zen Mode. Starts: Intimidate, Download, Trace (random foe), weather and terrain setters, Air Lock/Cloud Nine, Screen Cleaner, Curious Medicine, Pastel Veil's cure, Costar, Hospitality, Supersweet Syrup, Intrepid Sword/Dauntless Shield (once a battle), Slow Start, Truant, Frisk/Anticipation/Forewarn (messages).
- **Read at the end of turn:** The swapped abilities' residuals (Speed Boost, Poison Heal, Rain Dish, Dry Skin, Ice Body, Solar Power, Magic Guard, Shed Skin, Hydration, Healer, Harvest, Pickup, Moody, Bad Dreams, Cud Chew, Hunger Switch).
- **Left for the next turn:** The new abilities (public between foes; allies' swap is not announced: PS/sim/battle.ts:1325-1331). Training's bridge rolls out an ability its form does not have.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled); with Neutralizing Gas from the turn's start: REASONS.withGas whatever follows (GAS_CHANGING_MOVES).
- **Engine reuse:** build.abilityId per world already feeds the calculation, the hooks and the end of turn; defaultAbilityActive; GAS_STAND_IN with kernel.gasEnds; kernel.unnerveEnds; intimidate.ts's Intimidate rules (applyIntimidate) and REASONS.withGas.
- **Engine needs:** One ability-change helper (End, swap, abilityState reset, Start) with a table of the Starts and Ends that act (modelled: Intimidate, Download, the weather and terrain setters with fieldGuard, Air Lock/Cloud Nine, Unnerve, Screen Cleaner, Curious Medicine, Pastel Veil; guarded: the rest), the per-game flag tables (failskillswap...), Trace's sample.
- **Randomness:** Trace gained: sample over the valid foes (1/2 with two); the Starts' own randomness (none else).
- **Risk:** high: The breadth of Start and End effects and of ability-driven reads; a wrong ability state silently changes damage. Probes: K5, status-eot Q2.

#### Role Play (`roleplay`): medium risk

- **Games (learners):** Scarlet/Violet 14, Champions 15, Sword/Shield 97, Ultra Sun/Ultra Moon 170. **Dex:** target normal, priority 0, Psychic, flags bypasssub.
- **Source:** PS/data/moves.ts:15324-15345 (onTryHit 15333-15336, onHit 15337-15340).
- **Showdown:** bypasssub, no protect (passes Protect). onTryHit: fails with the same ability, the target's failroleplay ability, the user's cantsuppress one; onHit source.setAbility(target.ability) (End of the old, Start of the new; SetAbility: Ability Shield) (PS/data/moves.ts:15333-15340; PS/sim/pokemon.ts:1908-1946) (K9b: Speed Boost acts at the end of turn).
- **Per game:** Same handler; failroleplay lists differ by catalog (SV 27, Champions 10, SwSh 18, USUM 18).
- **Changes:** user's ability.
- **Read later this turn:** As Skill Swap for the user.
- **Read at the end of turn:** The copied ability's residual (K9b).
- **Left for the next turn:** The ability (public -ability).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled); with Neutralizing Gas from the turn's start: REASONS.withGas whatever follows (GAS_CHANGING_MOVES).
- **Engine reuse:** As Skill Swap.
- **Engine needs:** As Skill Swap (one side).
- **Randomness:** As Skill Swap (Trace cannot be copied: failroleplay).
- **Risk:** medium: One-sided Skill Swap: same Start/End table. Probes: K9b.

#### Entrainment (`entrainment`): medium risk

- **Games (learners):** Scarlet/Violet 35, Champions 22, Sword/Shield 26, Ultra Sun/Ultra Moon 30. **Dex:** target normal, priority 0, Normal, flags protect, reflectable.
- **Source:** PS/data/moves.ts:4860-4888 (onTryHit 4869-4878, onHit 4879-4883).
- **Showdown:** protect, reflectable. onTryHit: fails into itself, a Dynamaxed target (SwSh), the same ability, a cantsuppress or Truant target, the user's noentrain ability; onHit target.setAbility(source.ability) (Start runs) (PS/data/moves.ts:4869-4883) (K6: Snorlax's new Intimidate lowers the user's side).
- **Per game:** Same handler; noentrain lists differ by catalog.
- **Changes:** target's ability.
- **Read later this turn:** As Skill Swap for the target (its Start: K6).
- **Read at the end of turn:** The given ability's residual.
- **Left for the next turn:** The ability.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled); with Neutralizing Gas from the turn's start: REASONS.withGas whatever follows (GAS_CHANGING_MOVES).
- **Engine reuse:** As Skill Swap.
- **Engine needs:** As Skill Swap.
- **Randomness:** none (Trace has noentrain).
- **Risk:** medium: As Role Play. Probes: K6.

#### Simple Beam (`simplebeam`): medium risk

- **Games (learners):** Scarlet/Violet 6, Champions 4, Sword/Shield 22, Ultra Sun/Ultra Moon 23. **Dex:** target normal, priority 0, Normal, flags protect, reflectable.
- **Source:** PS/data/moves.ts:16483-16505 (onTryHit 16492-16496, onHit 16497-16500).
- **Showdown:** protect, reflectable. Fails on cantsuppress, Simple or Truant; target.setAbility('simple') (End of the old; Simple has no Start) (PS/data/moves.ts:16492-16500) (K8: its Swords Dance gives +4).
- **Per game:** Same in all four.
- **Changes:** target's ability.
- **Read later this turn:** Later boosts and drops on it double (ChangeBoost: applyBoosts already reads Simple); its old ability's effects end (End table).
- **Read at the end of turn:** Its old ability's residual is gone.
- **Left for the next turn:** The ability.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled); with Neutralizing Gas from the turn's start: REASONS.withGas whatever follows (GAS_CHANGING_MOVES).
- **Engine reuse:** applyBoosts (Simple), the ability-change helper.
- **Engine needs:** The End half of the helper.
- **Randomness:** none
- **Risk:** medium: Only the lost ability's End matters, but it is the same table. Probes: K8.

#### Worry Seed (`worryseed`): medium risk

- **Games (learners):** Scarlet/Violet 61, Champions 18, Sword/Shield 73, Ultra Sun/Ultra Moon 134. **Dex:** target normal, priority 0, Grass, flags protect, reflectable.
- **Source:** PS/data/moves.ts:21051-21081 (onTryImmunity 21060-21066, onTryHit 21067-21071, onHit 21072-21076).
- **Showdown:** protect, reflectable. onTryImmunity: Truant and Insomnia fail (before accuracy); onTryHit: cantsuppress fails; target.setAbility('insomnia'); a sleeping target is cured (PS/data/moves.ts:21060-21076) (status-eot Q2b: it wakes and moves; K9c: a later Spore fails).
- **Per game:** Same in all four.
- **Changes:** target's ability; its sleep cured.
- **Read later this turn:** Its later move (no sleep check), later sleep moves and Yawn fail, its old ability's effects end.
- **Read at the end of turn:** Yawn's sleep fails; the old ability's residual is gone.
- **Left for the next turn:** The ability.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled); with Neutralizing Gas from the turn's start: REASONS.withGas whatever follows (GAS_CHANGING_MOVES).
- **Engine reuse:** cureStatus, canSleep, the ability-change helper.
- **Engine needs:** The End half of the helper.
- **Randomness:** Removes the sleep branch of a later action.
- **Risk:** medium: As Simple Beam. Probes: K9c, status-eot Q2b.

#### Gastro Acid (`gastroacid`): medium risk

- **Games (learners):** Scarlet/Violet 20, Champions 8, Sword/Shield 29, Ultra Sun/Ultra Moon 49. **Dex:** target normal, priority 0, Poison, flags protect, reflectable.
- **Source:** PS/data/moves.ts:6427-6461 (onTryHit 6437-6445, condition 6446-6456).
- **Showdown:** protect, reflectable. onTryHit: cantsuppress fails, Ability Shield blocks; volatile gastroacid: onStart runs the ability's End; ignoringAbility() is then true (PS/data/moves.ts:6437-6456; PS/sim/pokemon.ts:858-866) (K7: Levitate gone, Earthquake hits).
- **Per game:** Same in all four; Ability Shield only in SV (Past in Champions).
- **Changes:** target's ability suppressed (volatile).
- **Read later this turn:** As losing the ability: every later read, and its End (Unnerve, Air Lock/Cloud Nine, Neutralizing Gas's own End, Protosynthesis...).
- **Read at the end of turn:** Its ability's residuals are off.
- **Left for the next turn:** The volatile ('-endability', public); Training: tracker adds it, the bridge does not map it (rollout today).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled); with Neutralizing Gas from the turn's start: REASONS.withGas whatever follows (GAS_CHANGING_MOVES).
- **Engine reuse:** GAS_STAND_IN (calculate.ts:968): the Neutralizing Gas stand-in already makes an ability inert in the calculation and the hooks; kernel.gasEnds.
- **Engine needs:** The per-Pokémon stand-in plus the original for E2 (as Neutralizing Gas keeps it), the End table.
- **Inputs:** Gastro Acid from an earlier turn (Training: map the volatile).
- **Randomness:** none
- **Risk:** medium: Stand-in exists; the End effects are the shared table. Probes: K7.

#### Doodle (`doodle`): medium risk

- **Games (learners):** Scarlet/Violet 2. **Dex:** target adjacentFoe, priority 0, Normal, flags none.
- **Source:** PS/data/moves.ts:3814-3846 (onHit 3823-3843); PS/data/mods/champions/moves.ts:212-215.
- **Showdown:** adjacentFoe, flags {} (no protect: passes Protect; no bypasssub: a Substitute blocks it). Fails if the target's ability has failroleplay; then for the user and its ally (alliesAndSelf), each not already with it and not cantsuppress: setAbility(target.ability, null, move) (Start each) (PS/data/moves.ts:3823-3843) (K9: two Intimidates, the foes at −2).
- **Per game:** SV only (Past in Champions).
- **Changes:** user's and ally's abilities.
- **Read later this turn:** As Skill Swap for two Pokémon, each Start (K9).
- **Read at the end of turn:** The copied ability's residuals on both.
- **Left for the next turn:** The abilities.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled); with Neutralizing Gas from the turn's start: REASONS.withGas whatever follows (GAS_CHANGING_MOVES).
- **Engine reuse:** As Skill Swap.
- **Engine needs:** As Skill Swap, twice in order (user, then ally).
- **Randomness:** none
- **Risk:** medium: Two ability changes; 2 learners. Probes: K9.

### Items (6)

#### Bestow (`bestow`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 43. **Dex:** target normal, priority 0, Normal, flags bypasssub.
- **Source:** PS/data/moves.ts:1237-1263 (onHit 1247-1258); PS/data/mods/gen7/moves.ts:35-38.
- **Showdown:** bypasssub, no protect (status-eot T9b: passes Protect and a Substitute; Sticky Hold does not stop it). Fails if the target holds an item or the user's item cannot be taken (TakeItem single event); setItem on the target (its Start), the user loses its item (PS/data/moves.ts:1247-1258).
- **Per game:** USUM only (gen7 mod).
- **Changes:** items of both; Unburden.
- **Read later this turn:** The user's lost item and the target's new one in later calculations, the Speed order (USUM: frozen), grounding (Air Balloon, Iron Ball), Berries eaten at the action's Update (Sitrus, Lum...), Mental/White Herb.
- **Read at the end of turn:** The receiver's Leftovers/Black Sludge/Orb/Sticky Barb; the giver's none.
- **Left for the next turn:** Items (public).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled); also the whole turn when its item would be used at the receiver's Update (bestowActs); with Neutralizing Gas from the turn's start: REASONS.withGas whatever follows (GAS_CHANGING_MOVES).
- **Engine reuse:** doubles-items.ts swapItems's halves (unburden, receive, usedThisAction), REASONS.received; today's bestowActs guard.
- **Engine needs:** A one-way variant of swapItems.
- **Randomness:** none
- **Risk:** low: Trick already exact; Bestow is its one-way half. Probes: status-eot T9b.

#### Corrosive Gas (`corrosivegas`): low risk

- **Games (learners):** Champions 7, Sword/Shield 17. **Dex:** target allAdjacent, priority 0, Poison, flags protect, reflectable.
- **Source:** PS/data/moves.ts:2914-2934 (onHit 2924-2931); PS/data/mods/champions/moves.ts:149-152; PS/data/mods/gen8/moves.ts:90-93.
- **Showdown:** allAdjacent (its ally too), protect, reflectable. onHit target.takeItem(source): Sticky Hold (onTakeItem) and items that cannot be taken stay; the item's End and AfterTakeItem; not 'used' (no lastItem) (PS/data/moves.ts:2924-2931) (K27: three items gone, the ally's Life Orb too).
- **Per game:** Champions and SwSh (the base dex has it Unobtainable; both mods restore it).
- **Changes:** items removed; Unburden.
- **Read later this turn:** Each target's later calculations without the item (Life Orb, Choice, resist Berries...), Speed (Choice Scarf, Iron Ball, Unburden: re-sort in both games), grounding (Air Balloon, Iron Ball).
- **Read at the end of turn:** Leftovers, Black Sludge, the Orbs, Sticky Barb gone.
- **Left for the next turn:** No items (public -enditem).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled); with Neutralizing Gas from the turn's start: REASONS.withGas whatever follows (GAS_CHANGING_MOVES).
- **Engine reuse:** Knock Off's per-world item removal and Unburden in the damaging path; the unremovable-item table of doubles-items.ts.
- **Engine needs:** The handler over the spread targets (each Magic Bounce target sends it back at the user).
- **Randomness:** none
- **Risk:** low: Item removal already exact for Knock Off. Probes: K27.

#### Recycle (`recycle`): medium risk

- **Games (learners):** Scarlet/Violet 22, Champions 13, Sword/Shield 90, Ultra Sun/Ultra Moon 140. **Dex:** target self, priority 0, Normal, flags none.
- **Source:** PS/data/moves.ts:14822-14842 (onHit 14831-14837).
- **Showdown:** Self, snatch. Fails while holding an item or with no lastItem; lastItem is what eatItem/useItem consumed (Berries, Gems, Herbs, Focus Sash, Weakness Policy, Eject Button...), not what takeItem removed (Knock Off, Corrosive Gas, Trick) nor a popped Air Balloon (it clears the item directly: PS/data/items.ts:198-199) (PS/data/moves.ts:14831-14837; PS/sim/pokemon.ts:1800, 1841). setItem → Start, then the Update eats a due Berry again (K28: Sitrus eaten at the turn's start, Recycled, eaten again: 100 → 158 → 107 → 165).
- **Per game:** Same in all four.
- **Changes:** item restored.
- **Read later this turn:** The item in later calculations and at Updates (a due Berry at once).
- **Read at the end of turn:** The restored item's residual or Berry.
- **Left for the next turn:** lastItem cleared (public -item [from] move: Recycle).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled); also the whole turn when the user holds no item (the item it used before is not known).
- **Engine reuse:** ateBerry and the item-use paths record what was consumed this turn per world; berryDue; doubles-items.ts receive.
- **Engine needs:** A per-world lastItem (this turn's consumption) and lastItem from before the turn.
- **Inputs:** The item it used before the turn when none was used this turn (Training: public -enditem; calculator: an input or not estimated as today).
- **Randomness:** A restored Starf/Figy-family Berry eaten again brings its own branches (existing).
- **Risk:** medium: lastItem must be tracked through every consuming path. Probes: K28.

#### Stuff Cheeks (`stuffcheeks`): low risk

- **Games (learners):** Scarlet/Violet 8, Champions 4, Sword/Shield 2. **Dex:** target self, priority 0, Normal, flags none.
- **Source:** PS/data/moves.ts:18253-18274 (onDisableMove 18262-18264, onTry 18265-18267, onHit 18268-18271); PS/data/mods/champions/moves.ts:953-956 (onDisableMove 955).
- **Showdown:** Self, snatch. onTry: holding a Berry; onHit: Def +2 (boost), and only if that changed something the Berry is eaten with force (eatItem(true): no TryEatItem, so Unnerve does not stop it; an Embargo/Magic Room/Klutz holder eats it with no effect: singleEvent skips a suppressed item's Eat, PS/sim/battle.ts:607-609) (PS/data/moves.ts:18262-18271) (K29: Sitrus at 200 → 235, Def +2).
- **Per game:** SV, Champions, SwSh. Champions drops onDisableMove (PS/data/mods/champions/moves.ts:953-956): it only changes when it may be chosen.
- **Changes:** Def stage; HP or stages or status from the Berry; item gone (Unburden).
- **Read later this turn:** Its HP (the KO chances of later hits), stages, the cured status, Unburden.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** lastItem (Recycle, Harvest), ateBerry (Belch, Cud Chew).
- **Today:** presence guard wherever it comes (HP_STATUS_MOVES, doubles-status.ts presenceGuards: REASONS.notModelled); a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** The forced-eat path of Bug Bite / Pluck (kernel.ateBerry, berryArithmetic, pouchHeal: Cheek Pouch, Ripen), applyBoosts.
- **Engine needs:** Lift the presence guard (HP_STATUS_MOVES); force-eat at any HP for the user.
- **Randomness:** The Berry's own (Starf's random stat, existing).
- **Risk:** low: Reuses the forced-eat path that Bug Bite already makes exact. Probes: K29.

#### Teatime (`teatime`): low risk

- **Games (learners):** Scarlet/Violet 3, Champions 2, Sword/Shield 2. **Dex:** target all, priority 0, Normal, flags bypasssub.
- **Source:** PS/data/moves.ts:19036-19066 (onHitField 19045-19063).
- **Showdown:** Target all, bypasssub, no protect flag. onHitField: each active Pokémon in getAllActive order (side by side, position order, not Speed) that passes Invulnerability (semi-invulnerable: -miss) and TryHit (Good as Gold refuses: K30) and holds a Berry eats it with force (PS/data/moves.ts:19045-19063) (K30).
- **Per game:** SV, Champions, SwSh; same handler.
- **Changes:** HP, stages, statuses from each Berry; items gone.
- **Read later this turn:** Every eater's HP, stages, status (K30: Lum cures the paralysis), Unburden.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** lastItem, ateBerry for each eater.
- **Today:** presence guard wherever it comes (HP_STATUS_MOVES, doubles-status.ts presenceGuards: REASONS.notModelled); a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Stuff Cheeks; kernel.isFoe for Good as Gold.
- **Engine needs:** Lift the presence guard; the eating order in Showdown's side order (p1 then p2: the engine's own/opponent sides map to them per input).
- **Randomness:** Each Berry's own (Starf).
- **Risk:** low: As Stuff Cheeks, four times in a fixed order. Probes: K30.

#### Embargo (`embargo`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 118. **Dex:** target normal, priority 0, Dark, flags protect, reflectable.
- **Source:** PS/data/moves.ts:4680-4707 (condition 4691-4702); PS/data/mods/gen7/moves.ts:194-197.
- **Showdown:** protect, reflectable. Volatile embargo, 5 turns: onStart runs the item's End; ignoringItem() is true for the holder (PS/data/moves.ts:4691-4702; PS/sim/pokemon.ts:879-886): its item does nothing and cannot be eaten or used; residual order 21 counts down (K26: no Sitrus after the hit).
- **Per game:** USUM only (gen7 mod).
- **Changes:** target's item suppressed (volatile).
- **Read later this turn:** Its item in later calculations (Life Orb, Choice, resist Berries, Eviolite, Assault Vest...), Berries at Updates, Speed (Choice Scarf, Iron Ball: frozen order in USUM), grounding (Air Balloon, Iron Ball). Knock Off into it still gets its 1.5x (knockoff onBasePower reads getItem: PS/data/moves.ts:9969-9972).
- **Read at the end of turn:** Leftovers, Black Sludge, the Orbs, Sticky Barb off.
- **Left for the next turn:** The volatile (USUM: no Training).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled); with Neutralizing Gas from the turn's start: REASONS.withGas whatever follows (GAS_CHANGING_MOVES).
- **Engine reuse:** kernel.itemWorks (doubles-turn.ts:306: Magic Room and Klutz) is the one gate; the end of turn's item reads go through it.
- **Engine needs:** A per-Pokémon flag in itemWorks and a calculation input that drops the holder's item effects while Knock Off still sees the item (the calculation's Klutz-like stand-in).
- **Inputs:** Embargo from an earlier turn.
- **Randomness:** none
- **Risk:** low: One gate already exists; Knock Off's read is the only subtlety. Probes: K26.

### Status cures, transfers and heals (5)

#### Aromatherapy (`aromatherapy`): low risk

- **Games (learners):** Sword/Shield 54, Ultra Sun/Ultra Moon 86. **Dex:** target allyTeam, priority 0, Grass, flags none.
- **Source:** PS/data/moves.ts:556-590 (onHit 566-585); PS/data/mods/gen8/moves.ts:11-14.
- **Showdown:** allyTeam, snatch. Cures every Pokémon of the user's side, the bench included; others than the user are skipped with Sap Sipper or Good as Gold (unless the user's Mold Breaker suppresses them) or behind a Substitute without Infiltrator (PS/data/moves.ts:566-585) (K43: the bench cured).
- **Per game:** SwSh and USUM (gen8 mod restores it); the same base handler in both (no gen7 override).
- **Changes:** statuses of the user's side (bench too).
- **Read later this turn:** Cured actives: no sleep/freeze stop, no paralysis halving or full paralysis, no burn halving; the Speed order (SwSh re-sorts).
- **Read at the end of turn:** No poison/burn damage; Toxic's stage gone.
- **Left for the next turn:** Bench statuses (E2 outcome, public -curestatus).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** doubles-status.ts cureStatus; Sap Sipper and Good as Gold checks (MODELLED_THIRD_PARTY).
- **Engine needs:** The bench in the E2 outcome (the calculator has no bench: a fact).
- **Randomness:** Removes later sleep/freeze/paralysis branches.
- **Risk:** low: Cures already exact. Probes: K43.

#### Heal Bell (`healbell`): low risk

- **Games (learners):** Scarlet/Violet 5, Champions 2, Sword/Shield 58, Ultra Sun/Ultra Moon 101. **Dex:** target allyTeam, priority 0, Normal, flags sound, bypasssub.
- **Source:** PS/data/moves.ts:8241-8273 (onHit 8250-8268); PS/data/mods/gen7/moves.ts:303-318 (onHit 305-317).
- **Showdown:** allyTeam, sound, bypasssub. Cures the user's side, the bench included; others than the user with Soundproof or Good as Gold are immune unless suppressed (PS/data/moves.ts:8250-8268) (K42 sv: the sleeping ally moves).
- **Per game:** USUM uses data/mods/gen7/moves.ts:303-318: only Soundproof is checked and it applies to the user too (K42 usum: a Soundproof user stays poisoned).
- **Changes:** statuses of the user's side.
- **Read later this turn:** As Aromatherapy.
- **Read at the end of turn:** As Aromatherapy.
- **Left for the next turn:** As Aromatherapy.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Aromatherapy.
- **Engine needs:** As Aromatherapy, with the gen-7 rule.
- **Randomness:** As Aromatherapy.
- **Risk:** low: As Aromatherapy. Probes: K42.

#### Psycho Shift (`psychoshift`): low risk

- **Games (learners):** Sword/Shield 18, Ultra Sun/Ultra Moon 27. **Dex:** target normal, priority 0, Psychic, flags protect.
- **Source:** PS/data/moves.ts:14188-14211 (onTryHit 14198-14201, self 14202-14206); PS/data/mods/gen8/moves.ts:559-562.
- **Showdown:** protect. onTryHit: fails when the user has no status, else the move carries the user's status, set on the target by the status step (setStatus: its immunities, Safeguard, terrains, an existing status), then self.onHit cures the user (PS/data/moves.ts:14198-14206) (K41: the burn moves; Body Slam halved; burn damage at the end of turn).
- **Per game:** SwSh and USUM (gen8 mod restores it); same handler.
- **Changes:** target's status; user's status cured.
- **Read later this turn:** The target's later move (sleep/freeze stop; paralysis: Speed and full paralysis; burn halving), the Speed order (SwSh).
- **Read at the end of turn:** The target's poison/burn damage, Toxic from stage 0.
- **Left for the next turn:** Statuses; a moved sleep has a fresh counter (random(2,5)), which no BeforeMove this turn reads.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** canStatus/setStatus/cureStatus.
- **Engine needs:** The handler; a status the target refuses (an immunity, Safeguard, a status it has) leaves the user's status (K57: no cure).
- **Randomness:** A moved paralysis or sleep brings its existing branches; the fresh sleep counter matters only for E2 (prior as Spore's).
- **Risk:** low: Status path exists. Probes: K41, K57.

#### Purify (`purify`): low risk

- **Games (learners):** Sword/Shield 1, Ultra Sun/Ultra Moon 2. **Dex:** target normal, priority 0, Poison, flags protect, reflectable, heal.
- **Source:** PS/data/moves.ts:14347-14369 (onHit 14357-14364); PS/data/mods/champions/moves.ts:757-760; PS/data/mods/gen8/moves.ts:563-566; PS/data/mods/gen7/moves.ts:739-745 (onHit 741-744).
- **Showdown:** protect, reflectable, heal (Heal Block stops it; Triage +3). onHit: the target's status cured, else it fails; the user heals ceil(maxhp × 0.5) (PS/data/moves.ts:14357-14364) (K44: 50 → 120).
- **Per game:** SwSh and USUM; USUM's gen7 mod (PS/data/mods/gen7/moves.ts:739-745) returns false on failure instead of -fail/NOT_FAIL (same effect). Champions' mod changes only PP and Champions' catalog lacks the move.
- **Changes:** target's status cured; user's HP.
- **Read later this turn:** The target's later move unhindered; the user's HP for later hits.
- **Read at the end of turn:** No poison/burn damage on the target.
- **Left for the next turn:** Statuses, HP.
- **Today:** presence guard wherever it comes (HP_STATUS_MOVES, doubles-status.ts presenceGuards: REASONS.notModelled); a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** cureStatus, healWorlds (Heal Block via eot.healBlock).
- **Engine needs:** Lift the presence guard (HP_STATUS_MOVES).
- **Randomness:** none
- **Risk:** low: Cure and heal paths exist. Probes: K44.

#### Swallow (`swallow`): low risk

- **Games (learners):** Scarlet/Violet 54, Champions 15, Sword/Shield 38, Ultra Sun/Ultra Moon 58. **Dex:** target self, priority 0, Normal, flags heal.
- **Source:** PS/data/moves.ts:18574-18599 (onTry 18583-18586, onHit 18587-18594); PS/data/mods/gen7/moves.ts:941-951 (onHit 943-950).
- **Showdown:** Self, snatch, heal (Heal Block stops it; Triage +3). onTry: fails without Stockpile (unless snatched); onHit heals modify(maxhp, [0.25, 0.5, 1][layers − 1]), then removes the Stockpile: its End lowers Def and SpD by the counted amounts through boost() (Eject Pack and White Herb react; Contrary inverts) (PS/data/moves.ts:18583-18594) (K31: 100 → 159, then Def/SpD back to 0).
- **Per game:** USUM's gen7 mod (PS/data/mods/gen7/moves.ts:941-951) returns null on a failed heal instead of NOT_FAIL (same effect).
- **Changes:** user's HP; Def/SpD stages (Stockpile's end); Stockpile gone.
- **Read later this turn:** The user's HP and Def/SpD for later hits; an Eject Pack switch-out (guarded).
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** No Stockpile.
- **Today:** presence guard wherever it comes (HP_STATUS_MOVES, doubles-status.ts presenceGuards: REASONS.notModelled); a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** healWorlds, applyBoosts (self drop: no Defiant/Mirror Armor), the Eject Pack guard.
- **Engine needs:** Lift the presence guard; carried layers and per-stat counters.
- **Inputs:** Stockpile layers (and which of Def/SpD each layer raised) from earlier turns; absent: not estimated as today.
- **Randomness:** none
- **Risk:** low: Heal and stage paths exist; the counters are an input. Probes: K31.

### Volatiles that act on later moves or the end of turn (10)

#### Nightmare (`nightmare`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 103. **Dex:** target normal, priority 0, Ghost, flags protect.
- **Source:** PS/data/moves.ts:12697-12725 (condition 12708-12720); PS/data/mods/gen7/moves.ts:675-678.
- **Showdown:** protect. Volatile nightmare: onStart fails unless the target sleeps or has Comatose; residual order 11: damage(baseMaxhp / 4) (Magic Guard stops it); it ends when the sleep ends (PS/data/moves.ts:12708-12720; PS/sim/pokemon.ts:1677; PS/data/conditions.ts:62) (K36: 235 → 177).
- **Per game:** USUM only (gen7 mod).
- **Changes:** nightmare volatile.
- **Read later this turn:** Nothing (it ends if the target wakes at a later BeforeMove this turn).
- **Read at the end of turn:** A residual at order 11 (Condition subOrder 2): −floor(baseMaxHP / 4) while still asleep.
- **Left for the next turn:** The volatile (USUM: no Training).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** The residual phase (doubles-eot.ts collect/ownHandler), EotState, the sleep branches.
- **Engine needs:** EotState.nightmare, its residual key and handler, its removal on a cure or a wake.
- **Inputs:** Nightmare from an earlier turn.
- **Randomness:** Rides the target's existing wake branches.
- **Risk:** low: One residual like Curse's. Probes: K36.

#### Attract (`attract`): low risk

- **Games (learners):** Scarlet/Violet 24, Champions 116, Sword/Shield 623, Ultra Sun/Ultra Moon 851. **Dex:** target normal, priority 0, Normal, flags protect, reflectable, bypasssub.
- **Source:** PS/data/moves.ts:706-761 (condition 716-753, onTryImmunity 754-756).
- **Showdown:** protect, reflectable, bypasssub. onTryImmunity: opposite genders; volatile attract: onStart rechecks genders and runs the Attract event (Destiny Knot infatuates the source back: PS/data/items.ts:1390-1404); Oblivious (onTryHit -immune; onUpdate cures) and Aroma Veil block; Mental Herb cures at the Update (K40); onUpdate ends it when the source is no longer active; onBeforeMovePriority 2: a 1/2 chance to stop each move (PS/data/moves.ts:716-756) (status-eot P9).
- **Per game:** Same in all four.
- **Changes:** attract volatile (with its source).
- **Read later this turn:** The target's later move (BeforeMove 2: after confusion 3, before paralysis 1), stopped with 1/2; ended if its source faints or leaves.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** The volatile with its source (tracker: attract sourceKey); Training: not mapped (rollout today).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** doubles-status.ts beforeMove gate chain, Oblivious/Aroma Veil blockers (as Taunt), mentalHerbHeld, genders.
- **Engine needs:** An attract gate at BeforeMove priority 2 and its source check; Destiny Knot.
- **Inputs:** Genders; infatuation from an earlier turn (Training: map it; calculator: a control).
- **Randomness:** 1/2 stop per BeforeMove of the infatuated Pokémon.
- **Risk:** low: A BeforeMove gate like paralysis. Probes: K40, status-eot P9.

#### Foresight (`foresight`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 88. **Dex:** target normal, priority 0, Normal, flags protect, reflectable, bypasssub.
- **Source:** PS/data/moves.ts:6093-6125 (onTryHit 6104-6106, condition 6107-6120); PS/data/mods/gen7/moves.ts:247-250.
- **Showdown:** protect, reflectable, bypasssub. Fails on a Miracle Eye target. Volatile foresight: onNegateImmunity lets Normal and Fighting hit a Ghost; positive evasion ignored (PS/data/moves.ts:6104-6120) (K38: Body Slam hits Gengar).
- **Per game:** USUM only (gen7 mod).
- **Changes:** foresight volatile.
- **Read later this turn:** Later Normal/Fighting hits into a Ghost target.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** The volatile (USUM).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** The calculation's defenderSide.isForesight (node_modules/@smogon/calc/dist/mechanics/gen789.js:297-298).
- **Engine needs:** Pass isForesight for a foresighted target.
- **Inputs:** Foresight from an earlier turn.
- **Randomness:** none
- **Risk:** low: The calculation supports it. Probes: K38.

#### Odor Sleuth (`odorsleuth`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 72. **Dex:** target normal, priority 0, Normal, flags protect, reflectable, bypasssub.
- **Source:** PS/data/moves.ts:12996-13014 (onTryHit 13007-13009); PS/data/mods/gen7/moves.ts:683-686.
- **Showdown:** As Foresight (volatileStatus 'foresight'), allyanim (PS/data/moves.ts:13007-13009).
- **Per game:** USUM only.
- **Changes:** foresight volatile.
- **Read later this turn:** As Foresight.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** As Foresight.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Foresight.
- **Engine needs:** As Foresight.
- **Inputs:** As Foresight.
- **Randomness:** none
- **Risk:** low: As Foresight.

#### Miracle Eye (`miracleeye`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 21. **Dex:** target normal, priority 0, Psychic, flags protect, reflectable, bypasssub.
- **Source:** PS/data/moves.ts:11951-11983 (onTryHit 11962-11964, condition 11965-11978); PS/data/mods/gen7/moves.ts:583-586.
- **Showdown:** protect, reflectable, bypasssub. Fails on a Foresight target. Volatile miracleeye: onNegateImmunity lets Psychic hit a Dark type; positive evasion ignored (PS/data/moves.ts:11962-11978) (K38b: Psychic hits Umbreon).
- **Per game:** USUM only.
- **Changes:** miracleeye volatile.
- **Read later this turn:** Later Psychic hits into a Dark target.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** The volatile.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** engine-corrections.cjs's getMoveEffectiveness wrapper.
- **Engine needs:** An effectiveness hook (the calculation has no Miracle Eye): Psychic into Dark at 1.
- **Inputs:** Miracle Eye from an earlier turn.
- **Randomness:** none
- **Risk:** low: A one-case effectiveness hook. Probes: K38b.

#### Heal Block (`healblock`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 47. **Dex:** target allAdjacentFoes, priority 0, Psychic, flags protect, reflectable.
- **Source:** PS/data/moves.ts:8274-8348 (condition 8285-8343); PS/data/mods/gen7/moves.ts:319-322.
- **Showdown:** allAdjacentFoes, protect, reflectable. Volatile healblock, 5 turns: onBeforeMovePriority 6 stops heal-flag moves (not Z/Max); onTryHeal fails heals (not Z-power), so a Sitrus is not eaten (its onTryEatItem runs TryHeal: PS/data/items.ts:5753-5755); Aroma Veil blocks; Mental Herb cures (PS/data/moves.ts:8285-8343) (K35: Recover fails, no Leftovers).
- **Per game:** USUM only (Psychic Noise's 2-turn Heal Block is the same condition in the other games: PS/data/moves.ts:8287-8290).
- **Changes:** healblock volatile on each target.
- **Read later this turn:** Later heal moves of the targets fail at BeforeMove 6, drain and Shell Bell heal nothing, HP Berries stay, absorbing abilities heal nothing.
- **Read at the end of turn:** Every residual heal fails (Leftovers, Black Sludge's heal, Grassy, Aqua Ring, Ingrain, Leech Seed's gain, Rain Dish, Ice Body, Dry Skin).
- **Left for the next turn:** The volatile with its turns (USUM: no Training).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** EotState.healBlock and everything that reads it (healBlockCheck at BeforeMove 6, healWorlds, searchFor's healBlocked, berryDue, ResidualMon.healBlocked): built for Psychic Noise.
- **Engine needs:** Only the move's handler (5 turns, Aroma Veil, Mental Herb).
- **Randomness:** none
- **Risk:** low: All readers exist. Probes: K35.

#### Powder (`powder`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 23. **Dex:** target normal, priority 1, Bug, flags protect, reflectable, powder, bypasssub.
- **Source:** PS/data/moves.ts:13660-13690 (condition 13671-13685); PS/data/mods/gen7/moves.ts:703-706.
- **Showdown:** Priority +1, protect, reflectable, powder, bypasssub. Volatile powder (duration 1): onTryMove priority −1: the target's Fire move fails and it takes damage(clampIntRange(round(maxhp / 4), 1)) (Magic Guard stops it; Sturdy and Focus Sash do not: not a move) (PS/data/moves.ts:13671-13685) (K34: Arcanine 165 → 124).
- **Per game:** USUM only (gen7 mod). Heavy Rain's TryMove (priority 1) fizzles a Fire move first.
- **Changes:** powder volatile.
- **Read later this turn:** The target's later Fire move fails; its HP falls (faint, Berries at the Update).
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Nothing.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** kernel.moveFailure (TryMove: Damp, the priority shields), afterLoss, powderImmune.
- **Engine needs:** A TryMove failure with an HP loss.
- **Randomness:** none
- **Risk:** low: A TryMove failure plus a fixed loss. Probes: K34.

#### Telekinesis (`telekinesis`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 218. **Dex:** target normal, priority 0, Psychic, flags protect, reflectable, gravity.
- **Source:** PS/data/moves.ts:19115-19167 (onTry 19126-19133, condition 19134-19162); PS/data/mods/gen7/moves.ts:1021-1024.
- **Showdown:** protect, reflectable, gravity (fails under Gravity). Volatile telekinesis, 3 turns: immune species (Diglett, Dugtrio, Sandygast, Palossand, Mega Gengar), fails with Smack Down or Ingrain; Ground immunity; isGrounded false; every move but OHKO hits it (PS/data/moves.ts:19126-19162; PS/sim/pokemon.ts:2158) (K37: Earthquake misses).
- **Per game:** USUM only.
- **Changes:** telekinesis volatile.
- **Read later this turn:** Later Ground moves into it fail; terrains stop applying to it (Electric/Misty status blocks, Psychic Terrain's priority shield, Grassy's power for its own moves).
- **Read at the end of turn:** No Grassy heal (not grounded).
- **Left for the next turn:** The volatile with its turns.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** EotState.magnetRise and kernel.grounded / ResidualMon.grounded (Magnet Rise is modelled as C).
- **Engine needs:** A telekinesis flag read by grounded (after Iron Ball, as Showdown's order), the species exceptions.
- **Inputs:** Telekinesis from an earlier turn.
- **Randomness:** none
- **Risk:** low: Magnet Rise's machinery. Probes: K37.

#### Magic Coat (`magiccoat`): low risk

- **Games (learners):** Sword/Shield 155, Ultra Sun/Ultra Moon 239. **Dex:** target self, priority 4, Psychic, flags none.
- **Source:** PS/data/moves.ts:10692-10738 (condition 10703-10733); PS/data/mods/gen8/moves.ts:396-399.
- **Showdown:** Priority +4, self. Volatile magiccoat (duration 1): onTryHit (priority 2) reflects a reflectable move from another Pokémon back at its source (not one already bounced, not while the holder is semi-invulnerable); onAllyTryHitSide reflects side moves (hazards); the reflected move keeps the Magic Coat use's pranksterBoosted (gen 7+: a Prankster Magic Coat's reflection fails on Dark types) (PS/data/moves.ts:10703-10733) (K49: Thunder Wave comes back).
- **Per game:** SwSh and USUM (gen8 mod restores it).
- **Changes:** magiccoat volatile.
- **Read later this turn:** Later reflectable status moves into it (single and spread) go back to their users.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Nothing.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** doubles-status.ts bounce (Magic Bounce), makeUse with bounced uses.
- **Engine needs:** The volatile as a bounce source, with its pranksterBoosted flag.
- **Randomness:** none
- **Risk:** low: Magic Bounce's path; the Prankster flag is the one difference. Probes: K49.

#### Octolock (`octolock`): low risk

- **Games (learners):** Champions 1, Sword/Shield 1. **Dex:** target normal, priority 0, Fighting, flags protect.
- **Source:** PS/data/moves.ts:12961-12995 (onTryImmunity 12971-12973, condition 12975-12992); PS/data/mods/champions/moves.ts:673-676; PS/data/mods/gen8/moves.ts:543-546.
- **Showdown:** protect. onTryImmunity: trapping immunity (Ghost types); volatile octolock: traps while its source is in; residual order 14: ends if the source left, fainted or just came in, else boost({def −1, spd −1}) from the source (PS/data/moves.ts:12971-12992) (K17: Defiant +2 per stat lowered: +4).
- **Per game:** Champions and SwSh (gen8 and champions mods restore it); same handler.
- **Changes:** octolock volatile (with its source).
- **Read later this turn:** Nothing in HP (it traps; no switch is chosen mid-turn).
- **Read at the end of turn:** Order 14 (Syrup Bomb's order: ties by Speed): Def/SpD −1 through the boost events: Clear Body, Clear Amulet, Big Pecks, Mirror Armor (back to the source), Defiant/Competitive per stat, Contrary, Simple, Mist, then White Herb and Eject Pack at their residuals.
- **Left for the next turn:** The volatile with its source (public '-start Octolock [of]'); Training: not mapped (rollout today).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** doubles-eot.ts residual phase (stageFacts, whiteHerb, ejectPack), applyBoosts.
- **Engine needs:** EotState.octolock with its source, the residual handler at 14.
- **Inputs:** Octolock from an earlier turn (Training: map it).
- **Randomness:** Ties with Syrup Bomb at order 14 (existing tie handling).
- **Risk:** low: A residual stage drop on existing machinery. Probes: K17.

### Move type changes (2)

#### Electrify (`electrify`): high risk

- **Games (learners):** Champions 1, Sword/Shield 3, Ultra Sun/Ultra Moon 3. **Dex:** target normal, priority 0, Electric, flags protect.
- **Source:** PS/data/moves.ts:4557-4588 (onTryHit 4568-4570, condition 4571-4583); PS/data/mods/champions/moves.ts:265-268; PS/data/mods/gen8/moves.ts:128-131.
- **Showdown:** protect. onTryHit: fails when the target has no queued move and has been in (K32b); volatile electrify (duration 1): onModifyType priority −2 makes the target's move Electric (not Struggle) (PS/data/moves.ts:4568-4583) (K32: Body Slam into Garchomp immune). After Pixilate (ModifyType −1, typeChangerBoosted) the move is Electric and keeps Pixilate's 4915/4096 (K55: 112 → 136 into Gyarados).
- **Per game:** Champions, SwSh, USUM (not SV); same handler.
- **Changes:** target's move type this turn.
- **Read later this turn:** The target's later move: its type for effectiveness and immunities (Ground), Volt Absorb/Motor Drive/Lightning Rod (absorb and redirection), STAB, Electric Terrain's boost, Charge, the -ate boost kept (K55), Normalize's boost kept.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Nothing (one turn).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** kernel.usedType (ModifyType chain), the move-type override the calculation already takes (resolve-move.ts overrides.type: Hidden Power, Terrain Pulse), withPowerMods for a kept -ate boost, redirection by used type.
- **Engine needs:** ModifyType priority −2 in usedType after the -ate abilities; the calculation called with type Electric plus the -ate/Normalize 4915 when their mark stays.
- **Randomness:** none
- **Risk:** high: Retyping a damaging move inside the calculation with the -ate interactions (K55) and every type-keyed reader. Probes: K32, K32b, K55.

#### Ion Deluge (`iondeluge`): medium risk

- **Games (learners):** Ultra Sun/Ultra Moon 11. **Dex:** target all, priority 1, Electric, flags none.
- **Source:** PS/data/moves.ts:9676-9705 (condition 9687-9700); PS/data/mods/gen7/moves.ts:480-483.
- **Showdown:** Priority +1, target all, pseudoWeather iondeluge (duration 1): onModifyType priority −2 makes Normal moves Electric (PS/data/moves.ts:9687-9700) (K33: Body Slam into Garchomp immune; K56: a Pixilate Hyper Voice stays Fairy).
- **Per game:** USUM only (gen7 mod).
- **Changes:** field: Normal moves are Electric this turn.
- **Read later this turn:** Every later Normal move of anyone (after -ate: K56; after Normalize: Electric with Normalize's boost), status moves of Normal type too (their immunities).
- **Read at the end of turn:** Nothing (ends at the turn's end).
- **Left for the next turn:** Nothing.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Electrify.
- **Engine needs:** As Electrify, field-wide.
- **Randomness:** none
- **Risk:** medium: As Electrify, but only Normal moves and USUM only. Probes: K33, K56.

### Side conditions (6)

#### Crafty Shield (`craftyshield`): low risk

- **Games (learners):** Sword/Shield 7, Ultra Sun/Ultra Moon 6. **Dex:** target allySide, priority 3, Fairy, flags none.
- **Source:** PS/data/moves.ts:3143-3173 (onTry 3154-3156, condition 3157-3168); PS/data/mods/gen8/moves.ts:94-97.
- **Showdown:** Priority +3, allySide side condition (duration 1); onTry fails with no action after it (queue.willAct). onTryHit (priority 3) blocks every Status move whose target is not self or all into its side, from foes and allies alike (PS/data/moves.ts:3154-3168) (K47: a foe's Thunder Wave and the ally's Aromatic Mist are blocked).
- **Per game:** SwSh and USUM (gen8 mod restores it).
- **Changes:** side: Crafty Shield.
- **Read later this turn:** Later status moves into its side.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Nothing.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** SideState flags (wideGuard/quickGuard pattern), tryHit for status moves, the queue check of the protecting moves (earlyBranch).
- **Engine needs:** A side flag read in tryHit for status moves; its order against Magic Bounce and Protect in TryHit.
- **Randomness:** none
- **Risk:** low: A side flag like Wide Guard. Probes: K47.

#### Mat Block (`matblock`): low risk

- **Games (learners):** Sword/Shield 1, Ultra Sun/Ultra Moon 5. **Dex:** target allySide, priority 0, Fighting, flags none.
- **Source:** PS/data/moves.ts:10984-11027 (onTry 10996-11002, condition 11003-11022); PS/data/mods/gen8/moves.ts:400-403.
- **Showdown:** Priority 0, allySide side condition (duration 1), snatch; onTry fails after the user's first turn out (activeMoveActions > 1) and with no action after it. onTryHit (priority 3): moves with target other than self that checkMoveBypassesProtect(blockStatus false) does not pass: damaging moves with the protect flag; status moves pass (PS/data/moves.ts:10996-11022; PS/sim/battle.ts:1300-1309) (K48). Z/Max moves bypass it with the 1/4 rule.
- **Per game:** SwSh and USUM (gen8 mod restores it).
- **Changes:** side: Mat Block.
- **Read later this turn:** Later damaging moves into its side (from slower Pokémon: priority 0), Z/Max at 1/4, an Outrage lock reset.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Nothing.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** The protection machinery (protectPasses, turnProtectOutcome: Z/Max at 1/4), the first-turn rule of Fake Out (FIRST_TURN_MOVES).
- **Engine needs:** A side-wide protection flag.
- **Inputs:** Its first turn out (as Fake Out's).
- **Randomness:** none
- **Risk:** low: Protect's machinery side-wide. Probes: K48.

#### Lucky Chant (`luckychant`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 74. **Dex:** target allySide, priority 0, Normal, flags none.
- **Source:** PS/data/moves.ts:10502-10529 (condition 10513-10524); PS/data/mods/gen7/moves.ts:538-541.
- **Showdown:** allySide side condition, 5 turns, snatch: onCriticalHit false for its side; residual 26.6 counts down (PS/data/moves.ts:10513-10524) (K52: Frost Breath into Garchomp no critical hit, 112 → 76).
- **Per game:** USUM only.
- **Changes:** side: Lucky Chant.
- **Read later this turn:** Later attacks into its side cannot crit: the certain crits (Frost Breath, Storm Throw, crit stage 3+ in gen 7) and the calculator's Critical hit toggle.
- **Read at the end of turn:** Nothing.
- **Left for the next turn:** Side with its turns (USUM).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** The 'critical hits only where certain' rule and the Critical hit toggle (input.field.critical).
- **Engine needs:** A side flag that turns crits off into that side.
- **Inputs:** Lucky Chant from an earlier turn (a side control).
- **Randomness:** none
- **Risk:** low: A flag over an existing rule. Probes: K52.

#### Mist (`mist`): low risk

- **Games (learners):** Scarlet/Violet 68, Sword/Shield 73, Ultra Sun/Ultra Moon 74. **Dex:** target allySide, priority 0, Ice, flags none.
- **Source:** PS/data/moves.ts:12072-12113 (condition 12082-12108); PS/data/mods/champions/moves.ts:624-627.
- **Showdown:** allySide side condition, 5 turns, snatch: onTryBoost removes drops from other Pokémon (source ≠ target), but an infiltrating move from a foe passes (gen 6+); a secondary's drop silently (PS/data/moves.ts:12082-12108) (K51: Snarl lowers nothing).
- **Per game:** SV, SwSh, USUM (Past in Champions).
- **Changes:** side: Mist.
- **Read later this turn:** Every later drop from another Pokémon onto its side: status moves, damaging secondaries (Snarl, Icy Wind, Electroweb...), Parting Shot, Memento, an Intimidate from a gained ability, an ally's Spicy Extract drop.
- **Read at the end of turn:** Octolock's drops from a foe are blocked.
- **Left for the next turn:** Side with its turns.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** applyBoosts's TryBoost from another Pokémon (Clear Body, Clear Amulet...).
- **Engine needs:** A side flag in TryBoost, for the damaging moves' secondary drops too (stat-moves.ts / the step's afterHit).
- **Inputs:** Mist from an earlier turn (a side control).
- **Randomness:** none
- **Risk:** low: A TryBoost rule; the secondary-drop path must read it too. Probes: K51.

#### Court Change (`courtchange`): low risk

- **Games (learners):** Scarlet/Violet 2, Champions 1, Sword/Shield 1. **Dex:** target all, priority 0, Normal, flags none.
- **Source:** PS/data/moves.ts:3032-3098 (onHitField 3041-3095).
- **Showdown:** Target all (onHitField): swaps Mist, Light Screen, Reflect, Spikes, Safeguard, Tailwind, Toxic Spikes, Stealth Rock, the Pledges' fields, Sticky Web, Aurora Veil, Lucky Chant and the G-Max sides between the two sides, durations included; fails with none (PS/data/moves.ts:3041-3095) (K46: Tailwind moves, Lapras moves next).
- **Per game:** SV, Champions, SwSh; all three re-sort the queue after it.
- **Changes:** both sides' conditions.
- **Read later this turn:** Screens for later damage, Tailwind for the order (re-sort), Safeguard for statuses, Mist for drops, hazards (E2).
- **Read at the end of turn:** Nothing in HP (durations swap).
- **Left for the next turn:** Sides with their turns (Training's clocks swap).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** SideState flags (reflect, lightScreen, auroraVeil, tailwind, safeguard), sides.hazards.
- **Engine needs:** The swap; a Pledge field on either side (not an input) stays out.
- **Randomness:** none
- **Risk:** low: Flag swap. Probes: K46.

#### Defog (`defog`): low risk

- **Games (learners):** Scarlet/Violet 50, Champions 15, Sword/Shield 134, Ultra Sun/Ultra Moon 229. **Dex:** target normal, priority 0, Flying, flags protect, reflectable, bypasssub.
- **Source:** PS/data/moves.ts:3448-3482 (onHit 3457-3477); PS/data/mods/gen7/moves.ts:125-147 (onHit 127-146).
- **Showdown:** protect, reflectable, bypasssub. onHit: evasion −1 on the target unless it has a Substitute (no Infiltrator) (boost event: Defiant/Competitive, Clear Body, Mirror Armor, Eject Pack, White Herb, Mist); removes the target side's Reflect, Light Screen, Aurora Veil, Safeguard, Mist and hazards, the user side's hazards, and from gen 8 the terrain (PS/data/moves.ts:3457-3477) (K45 sv: terrain gone; Body Slam no longer halved).
- **Per game:** USUM: data/mods/gen7/moves.ts:125-147 keeps the terrain and has no G-Max Steelsurge (K45 usum: Electric Terrain stays).
- **Changes:** target's side conditions; hazards; terrain (gen 8+); target's evasion.
- **Read later this turn:** Later damage into the target's side (screens), statuses (Safeguard), drops (Mist), the terrain's reads (power, Psychic Terrain's shield, Electric/Misty blocks, Grassy Glide's priority from gen 8, Expanding Force, Rising Voltage, Seeds and Quark Drive: fieldGuard), Defiant/Competitive.
- **Read at the end of turn:** No Grassy heal (gen 8+).
- **Left for the next turn:** Sides, terrain (E2).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** SideState flags, w.field.terrain with fieldGuard, applyBoosts (evasion).
- **Engine needs:** The handler.
- **Randomness:** none
- **Risk:** low: Writes state the engine already has. Probes: K45.

### Field conditions (4)

#### Magic Room (`magicroom`): low risk

- **Games (learners):** Scarlet/Violet 11, Champions 35, Sword/Shield 66, Ultra Sun/Ultra Moon 74. **Dex:** target all, priority 0, Psychic, flags none.
- **Source:** PS/data/moves.ts:10755-10798 (condition 10765-10793).
- **Showdown:** Target all, pseudoWeather 5 turns (Persistent is gen 4 only); a second use ends it (onFieldRestart); onFieldStart runs every active item's End (Utility Umbrella re-runs WeatherChange; Eject Pack and Mirror Herb lose their pending state) (PS/data/moves.ts:10765-10793; PS/data/items.ts:7456-7462) (K25: Life Orb, Sitrus and Leftovers stop).
- **Per game:** Same in all four (Utility Umbrella from gen 8).
- **Changes:** field: Magic Room on or off.
- **Read later this turn:** Every item in every later calculation (conditions.magicRoom: the calculation already handles it), Berries at Updates, Speed (Choice Scarf, Iron Ball: re-sort gen 8+), grounding, Utility Umbrella holders' weather.
- **Read at the end of turn:** Items off (a room set this turn lasts: duration 5; ended this turn: items work again).
- **Left for the next turn:** Field with its turns (Training: ROOMS, nextClock).
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled); with Neutralizing Gas from the turn's start: REASONS.withGas whatever follows (GAS_CHANGING_MOVES).
- **Engine reuse:** World.field.magicRoom (already state), itemWorks reads it, roomFact; the bridge's Magic Room handling.
- **Engine needs:** The toggle and the End reactions (Utility Umbrella: the weather reads for the holder change).
- **Randomness:** none
- **Risk:** low: The field flag and its readers exist; the move only flips it. Probes: K25.

#### Wonder Room (`wonderroom`): low risk

- **Games (learners):** Scarlet/Violet 13, Champions 52, Sword/Shield 108, Ultra Sun/Ultra Moon 106. **Dex:** target all, priority 0, Psychic, flags none.
- **Source:** PS/data/moves.ts:20970-21018 (condition 20980-21013).
- **Showdown:** Target all, pseudoWeather 5 turns; a second use ends it. Def and SpD swap in calculateStat and getStat (PS/sim/pokemon.ts:568-575, 606-613); Body Press's overrideOffensiveStat swaps (PS/data/moves.ts:20980-21013) (K53: Body Slam into Chansey 135 → 28).
- **Per game:** Same in all four.
- **Changes:** field: Wonder Room on or off.
- **Read later this turn:** Every later calculation (conditions.wonderRoom: the calculation handles it), the confusion self-hit (doubles-status.ts confusionHit already swaps), Body Press.
- **Read at the end of turn:** Nothing (its countdown, 27.5).
- **Left for the next turn:** Field with its turns.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** World.field.wonderRoom, conditionsFor passes it.
- **Engine needs:** The toggle.
- **Randomness:** none
- **Risk:** low: A field flag the calculation already reads. Probes: K53.

#### Mud Sport (`mudsport`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 90. **Dex:** target all, priority 0, Ground, flags none.
- **Source:** PS/data/moves.ts:12456-12489 (condition 12467-12484); PS/data/mods/gen7/moves.ts:651-654.
- **Showdown:** Target all, nonsky, pseudoWeather 5 turns (fails while up): onBasePower (priority 1) Electric moves ×1352/4096 (PS/data/moves.ts:12467-12484) (K39: Thunderbolt 52 → 18).
- **Per game:** USUM only.
- **Changes:** field: Mud Sport.
- **Read later this turn:** Every later Electric move's power.
- **Read at the end of turn:** Nothing (countdown 27.4).
- **Left for the next turn:** Field with its turns.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** engine-corrections.cjs withPowerMods (base-power chain injection, order-exact).
- **Engine needs:** A field flag and its 1352 base-power modifier.
- **Inputs:** Mud Sport from an earlier turn (a field control).
- **Randomness:** none
- **Risk:** low: The base-power injection already exists. Probes: K39.

#### Water Sport (`watersport`): low risk

- **Games (learners):** Ultra Sun/Ultra Moon 73. **Dex:** target all, priority 0, Water, flags none.
- **Source:** PS/data/moves.ts:20628-20661 (condition 20639-20656); PS/data/mods/gen7/moves.ts:1068-1071.
- **Showdown:** As Mud Sport for Fire moves (PS/data/moves.ts:20639-20656).
- **Per game:** USUM only.
- **Changes:** field: Water Sport.
- **Read later this turn:** Every later Fire move's power.
- **Read at the end of turn:** Nothing (countdown 27.3).
- **Left for the next turn:** Field with its turns.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** As Mud Sport.
- **Engine needs:** As Mud Sport.
- **Inputs:** As Mud Sport.
- **Randomness:** none
- **Risk:** low: As Mud Sport.

### Copying moves (Transform, Snatch) (2)

#### Snatch (`snatch`): medium risk

- **Games (learners):** Ultra Sun/Ultra Moon 180. **Dex:** target self, priority 4, Dark, flags bypasssub.
- **Source:** PS/data/moves.ts:17105-17138 (condition 17116-17133); PS/data/mods/gen7/moves.ts:887-890.
- **Showdown:** Priority +4, self, bypasssub. Volatile snatch (duration 1): onAnyPrepareHit (priority −1): the next move with the snatch flag by any Pokémon (its ally's too; not Z/Max, not a snatched one, not while the Snatch user is Sky Dropped) is used by the Snatch user instead (useMove(move.id, snatchUser)) and the original fails; the volatile ends (PS/data/moves.ts:17116-17133) (K50: Swords Dance is the Snatch user's).
- **Per game:** USUM only.
- **Changes:** the next snatchable move's user.
- **Read later this turn:** That move's effect lands on the Snatch user (stages, heals, Substitute, side moves on its side: Reflect, Light Screen, Tailwind, Safeguard...), its original user's move fails.
- **Read at the end of turn:** Whatever the stolen move set up (Aqua Ring, Ingrain, a screen...).
- **Left for the next turn:** The stolen move's state.
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled).
- **Engine reuse:** statusMove's pipeline with another user (makeUse/runUse already run a bounced use from its holder).
- **Engine needs:** A PrepareHit hook in runStatusMove that re-runs the use from the Snatch holder; the snatch flags (dex) in status-table.ts.
- **Randomness:** The stolen move's own.
- **Risk:** medium: Re-routing any later snatchable move, side moves included. Probes: K50.

#### Transform (`transform`): high risk

- **Games (learners):** Scarlet/Violet 3, Champions 1, Sword/Shield 2, Ultra Sun/Ultra Moon 3. **Dex:** target normal, priority 0, Normal, flags none.
- **Source:** PS/data/moves.ts:19829-19845 (onHit 19838-19840).
- **Showdown:** No protect flag (passes Protect), no bypasssub. pokemon.transformInto: fails into a Substitute, an Illusion, a transformed target or user, Eternamax, the Ogerpon/Terapagos Tera cases, a Stellar user; copies species, weight, types (pre-Tera; Roost's typeWas), added type, stored stats but HP, moves (5 PP each), all stages, the crit volatiles (gen 6+), and the ability through setAbility (its Start runs when it differs) (PS/data/moves.ts:19838-19840; PS/sim/pokemon.ts:1270-1380) (K13: Ditto keeps 123 HP, takes Body Slam as Snorlax with +2 Def).
- **Per game:** Same handler; Champions' formeChange override (PS/data/mods/champions/scripts.ts:57) for Mega forms; the Tera restrictions only in SV.
- **Changes:** species/form; types; stored stats; stages; ability (Start); moves; weight; crit volatiles.
- **Read later this turn:** Every later calculation with the transformed Pokémon (as the copied species with its own HP), its Speed (re-sort gen 8+), its new ability's Start (Intimidate, Download...), type and ability immunities.
- **Read at the end of turn:** The copied ability's residuals, types (sand), item unchanged.
- **Left for the next turn:** Transformed (public -transform; tracker transformedInto); Training: rollout today ('is transformed').
- **Today:** a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled); with Neutralizing Gas from the turn's start: REASONS.withGas whatever follows (GAS_CHANGING_MOVES).
- **Engine reuse:** calculate.ts's transformed build (BattleBuild.transformedFrom: the target's species and training with the user's base HP, the Imposter path, imposter.ts), the ability-change helper (Skill Swap), the stage copy (Psych Up). PRESENCE_THIRD_PARTY guards Imposter in 2v2 today.
- **Engine needs:** A per-world transformed build (transformedFrom with the target's stats, types and ability), the Start through the ability helper, the failure rules.
- **Inputs:** Transformed from an earlier turn.
- **Randomness:** The copied ability's Start brings its own branches (Trace's sample).
- **Risk:** high: A whole-build copy with Start effects, forms and Tera rules; the 1v1 transformed path is the base but 2v2 has never run it. Probes: K13.
