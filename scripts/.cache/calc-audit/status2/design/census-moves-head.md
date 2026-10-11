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
