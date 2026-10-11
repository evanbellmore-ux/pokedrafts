# FAMILY 2: types and volatiles (status2 design)

Branch `calc-2v2-status-2` (main 4008ee8), design only: nothing under `app/`, `tests/` or `docs/` changed, nothing committed.
The user asked to "do 3 and 4". This family covers the 22 kind-L status moves the brief names: Soak, Magic Powder, Reflect Type,
Conversion, Conversion 2, Camouflage, Trick-or-Treat, Forest's Curse, Electrify, Ion Deluge, Tar Shot, Foresight, Odor Sleuth,
Miracle Eye, Telekinesis, Embargo, Heal Block, Nightmare, Octolock, Attract, Captivate, Powder. It also covers the guards that
depend on the types enabler. Those are Protean and Libero, Roost, Burn Up and Double Shock (`REASONS.typeChange`), the
ate-redirect guard, and the Psychic Noise guard (FINAL.md open item, through "Heal Block in later steps"). It also fixes one silent
bug: Color Change is not followed at all.

Ground truth is pinned Showdown c23d2e94 (`PS/` = `node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353`).
Probes: `TVnn` = `types-volatiles-probes.out`, `TWnn` = `types-volatiles-probes-2.out`, `Kn` = `census-moves-probes.out`.

## Files (all in `scripts/.cache/calc-audit/status2/design/`)

| File | What |
|---|---|
| `types-volatiles.md` | This design. |
| `types-volatiles-probes.ts` → `.out` | 93 pinned-Showdown runs (TV01–TV26), most with a control. |
| `types-volatiles-probes-2.ts` → `.out` | 27 follow-up runs (TW01–TW20): Lightning Rod after Electrify, Normalize's kept boost, the Curse glitch per generation, Telekinesis across turns, Shell Bell and Leech Seed under Heal Block, Heavy Rain before Powder, Color Change behind a Substitute, Tera and the added type, Protean per game. |
| `types-volatiles-app.ts` → `.out` | Today's app on six turns of the family (the verify harness's `appTurn`): the Color Change bug, the Protean, Roost and Psychic Noise guards. |

Reproduce from the repo root: `npx --no-install tsx scripts/.cache/calc-audit/status2/design/<file>.ts > <file>.out`.

---

## 0. Decisions

1. **World types live on the build.** `BattleBuild` gains `types?: string[]` (the base types after `setType`) and
   `addedType?: "Grass" | "Ghost"`, set only by the 2v2 turn, by Training's bridge, and by the 2v2 calculator's earlier-turn
   control. Every reader that takes a build (the status pipeline's immunities, `canStatus`, the end of turn's
   `residualMon`, the calculation, the pairwise search, E2) sees them without a new parameter. `typesOf(build)` becomes the
   single typing rule: a Tera type that is not Stellar wins, then `build.types ?? species.types`, then `addedType`. This
   is `PS/sim/pokemon.ts:2138-2146` getTypes. Roost is a world volatile (`eot.roosted`) and is folded in by a new
   `typesIn(w, slot)`.
2. **The calculation gets the types through `makePokemon`.** The engine Pokémon's `types` becomes `[...base, added]`
   (three entries when a type is added), so the engine's own `hasType`, `hasOriginalType` (STAB) and Flying checks read
   it. The engine's effectiveness multiplies only `types[0]` and `types[1]`
   (`@smogon/calc/dist/mechanics/gen789.js:300-302`, `champions.js:169-171`). So a scoped correction in
   `engine-corrections.cjs` multiplies in the third entry (a two-type Pokémon's added type; a one-type Pokémon's added type
   is `types[1]`, which the engine reads itself) at the first-type call, and Tar Shot and Miracle Eye ride the same hook. This generalises today's `neutralEffectiveness` wrapper.
3. **Per-Pokémon calculation modifiers come from `calcBuild(w, slot)`** (`doubles-turn.ts:444`), the one function that hands
   a build to every calculation. It adds derived, calculation-only fields from the world: Roost's types, `tarShot`,
   `revealed` (Foresight or Miracle Eye), `floating` (Telekinesis), `itemSuppressed` (Embargo). `calculate.ts` turns these
   into markers on the engine Pokémon. A single scope in its `calculate()` (`calculate.ts:316`, which says "Every engine
   calculation of the app goes through here") installs the corrections for that run.
4. **Electrify and Ion Deluge are a move context, not a build.** `MoveContext.retype?: "electrify" | "iondeluge"` is
   derived by `contextFor` and `usedRow`. `calculate.ts` overrides the move's type to Electric. It stands in for the user's
   type-changing ability (Normalize, the -ate abilities, Liquid Voice), and adds back the 4915/4096 boost
   `typeChangerBoosted` keeps (K55, TV09b, TV09f, TW02) through `withPowerMods`. Moves whose type is set by their own
   ModifyType (Weather Ball and its kin), Z-Moves and Max Moves stay guarded, each with one narrow reason.
5. **Heal Block reaches later steps.** Today's `psychicNoiseKeepsBerry` stand-in is generalised to any heal-blocked target
   and attacker: an HP Berry or Shell Bell reads as Leftovers in the pair's calculation, absorbing abilities heal nothing,
   and draining moves already stop at BeforeMove 6. The `Psychic Noise is not modelled in 2v2.` guard goes.
6. **New volatiles are world state.** `MoveVolatiles` gains `attract`, `tarShot`, `revealed`, `electrify`, `powder`,
   `curseGlitch`, `usedType`. `EotState` gains `nightmare`, `octolock`, `telekinesis`, `embargo` and `healBlockLeft`.
   `FieldState` gains `ionDeluge`. Each has its hook (§2.7), its end of turn, its E2 volatile id and its Training mapping.
7. **The four type-change guards go** (Protean and Libero, Roost, Burn Up, Double Shock). Each becomes a `setType` on the
   world (Showdown's rules: no change while Terastallized, Arceus and Silvally keep their types, gen 9 Protean once per
   entry). `REASONS.typeChange` is deleted.
8. **Color Change is fixed, not guarded.** Today the turn reads Kecleon's species type after a hit (`types-volatiles-app.out`
   APP-colorchange: Earthquake 70–84 and a 12.9 % KO, where Showdown is 2x and a certain KO, TV25). It becomes a `setType`
   in `afterHit`, on hits that reached the Pokémon (TW17: none behind a Substitute) and not after a Sheer Force move.
9. **Every form change resets the world types.** This follows `PS/sim/pokemon.ts:1388-1396` setSpecies: `setType(species.types, true)`,
   `addedType = species.addedType || ''`. The reset applies to Stance Change, a busted Disguise or Ice Face, Hunger Switch and
   any form the pairwise search changes. Terastallizing clears the added type (`PS/sim/battle-actions.ts:1948`, TW18).
10. **Remaining guards are narrow and exact** (§9). No guard reads "not modelled" for a whole move of this family any more.

---

## 1. Verified ground truth

| Claim | Evidence | Showdown source |
|---|---|---|
| Soak replaces the types and clears an added type; Flying lost: a 4x Thunderbolt becomes 2x, the ally's Earthquake hits, Grassy Terrain heals it; sand and Black Sludge follow | TV01 (+control), TV01b, TV01e, TW13 (SwSh, USUM), K1 | `PS/data/moves.ts:17196-17204`; `PS/sim/pokemon.ts:2121-2124` |
| Soak fails on Arceus, on a Water type alone, on any Terastallized target (Stellar too); Water Absorb takes it | TV01c, TV01d, K3b | `PS/sim/pokemon.ts:2109-2119` |
| Magic Powder makes Gengar Psychic (Close Combat 0.5x, immune before); a Grass type is immune, Safety Goggles block; Magic Bounce sends it back | TV02 (+control), TV02b, TW09 | `PS/data/moves.ts:10748-10751` |
| Forest's Curse adds Grass: effectiveness with three types, STAB for the target's Grass move (1.497x), Spore then immune; fails on Grass and Terastallized | K2, TV03 (+control), TV03b | `PS/data/moves.ts:6135-6139`; `PS/sim/pokemon.ts:2132-2146`; `PS/sim/battle-actions.ts:1765` |
| Trick-or-Treat adds Ghost (Shadow Ball 2x, Close Combat immune) and replaces an added Grass | K2b, TV04 (+control), TV04b | `PS/data/moves.ts:19923-19927` |
| A queued non-Ghost Curse whose user became Ghost goes to a random foe (gens 8, 9; position 0 in gen 7); at Showdown position 1 in gen 7 the glitch aims it at the ally; a Ghost Curse user that loses Ghost uses the non-Ghost Curse | TV04c, TV04d, TW05 (SwSh, USUM), TW15, TV04e | `PS/data/moves.ts:19928-19934`, `:3276-3289`; `PS/data/mods/gen8/moves.ts:98-106`; `PS/data/mods/gen7/moves.ts:117-120` |
| Reflect Type copies base types and the added type; a Terastallized target gives its Tera type; a Terastallized user fails; ??? is dropped and ??? alone fails | K3, TV05, TV05b, TV05c, TV05d, TW14 (Champions), TW18 | `PS/data/moves.ts:14893-14910` |
| Terastallizing clears the added type | TW18 | `PS/sim/battle-actions.ts:1948` |
| Conversion takes the first move slot's dex type | TV06 | `PS/data/moves.ts:2804-2808` |
| Conversion 2 reads `lastMoveUsed` as used (Pixilate Hyper Voice: Fairy), samples the resisting types it lacks, reads last turn's move, fails with none | K4, TV07, TV07b | `PS/data/moves.ts:2823-2843` |
| Camouflage: terrain type, Normal without terrain (Kecleon: fails) | K54, TV08, TV08b | `PS/data/moves.ts:2164-2178` |
| Electrify makes the target's move Electric (Ground immune, Max Lightning, an Electric Breakneck Blitz); Lightning Rod then takes it (ModifyType before getMoveTargets); Volt Absorb takes an electrified Yawn; fails on a Pokémon that moved; not on one that switched in this turn | K32, K32b, TV09c, TV09d, TV09e, TV09g, TW01 (SwSh, Champions), TW12, TV09 (Lightning Rod took Jolteon's own Electrify) | `PS/data/moves.ts:4568-4583`; `PS/sim/battle-actions.ts:438` (ModifyType) before `:467` (getMoveTargets) |
| Electrify keeps Pixilate's and Normalize's 1.2x; with Charge and Electric Terrain the electrified move is boosted | K55, TV09b, TV09f vs TW02 (104 vs 88), TW04 | `PS/data/abilities.ts:3296` pixilate, `:2986` normalize (typeChangerBoosted) |
| Ion Deluge: Normal moves Electric after the -ate abilities (Pixilate stays Fairy), Normalize Electric with its 1.2x; status moves too; Lightning Rod redirects | K33, K56, TV10 (+control), TV10b, TW11 | `PS/data/moves.ts:9687-9700` |
| Tar Shot: +1 on the first type once (Ferrothorn 4x to 8x); Speed −1 even on a Terastallized target, whose volatile fails; a tarred Pokémon that Terastallizes later takes it on its Tera type | K16, TV11 (+control), TV11b, TV11c | `PS/data/moves.ts:18956-18967` |
| Foresight and Odor Sleuth (one volatile): Fighting hits Gengar at 0.5x; Foresight fails on a Miracle Eye target; Miracle Eye: Psychic into Dark/Steel 0.5x | K38, K38b, TV12 (+control), TV12b, TV13 (+control) | `PS/data/moves.ts:6104-6120`, `:11962-11978` |
| Telekinesis: Earthquake misses; no Grassy heal; a priority move then passes Psychic Terrain; Diglett immune; fails on an Ingrained target; Gravity stops it at BeforeMove and, when it starts, ends it | K37, TV14b (+control), TW06 (+control), TV14c, TV14d, TW10 | `PS/data/moves.ts:19126-19162`; `PS/sim/pokemon.ts:2148-2160` |
| Embargo: no Sitrus, no Leftovers, no Life Orb boost or recoil, Air Balloon ignored (Earthquake hits, the balloon stays), Knock Off keeps 1.5x | K26, TV15, TV15b, TV15c, TV15d (each +control) | `PS/data/moves.ts:4691-4702`; `PS/sim/pokemon.ts:879-886` |
| Heal Block (spread): Recover and Giga Drain stop at BeforeMove 6; Volt Absorb takes the hit but heals nothing; Sitrus not eaten; Shell Bell and Leech Seed's seeder heal nothing; Aroma Veil blocks; Mental Herb cures at the Update | K35, TV16, TV16b, TV16c, TV16d, TW07 | `PS/data/moves.ts:8285-8343`; `PS/data/items.ts:3885-3912` |
| Nightmare: fails awake; a quarter at order 11; ends with the sleep (silent); Comatose works | K36, TV17, TV17b, TV17c | `PS/data/moves.ts:12708-12720`; `PS/sim/pokemon.ts:1677` |
| Octolock: Ghost immune; Def/SpD −1 at order 14 (Defiant +2 each); Clear Body keeps the stages, the lock stays; ends silently when its source has fainted | K17, TV18, TV18b, TV18c (Champions) | `PS/data/moves.ts:12971-12992` |
| Attract: same gender and genderless immune (TryImmunity); Oblivious immune; Destiny Knot infatuates back; 1/2 at BeforeMove 2; ends at the Update after its source faints; Aroma Veil blocks | P9, K40, TV19, TV19b, TV19c, TV19d, TV19e, TV19f (Champions) | `PS/data/moves.ts:716-756`; `PS/data/items.ts:1390-1404`; `PS/data/abilities.ts:3008-3031`, `:234-244` |
| Captivate: SpA −2 on opposite-gender foes only (genderless immune, Oblivious immune) | K20, TV20 | `PS/data/moves.ts:2194-2196` |
| Powder: a Fire move fails and its user loses round(maxhp/4), status moves too (Will-O-Wisp); Grass immune; Magic Guard keeps the HP; Heavy Rain fails the move first (no loss) | K34, TV21, TV21b, TW08 | `PS/data/moves.ts:13671-13685` |
| Protean (SV, Champions: once per entry; SwSh: every move) and Libero change the type at PrepareHit; Acrobatics makes it Flying (Earthquake misses) | TV22 (+control), TV22b, TW19, TW20 | `PS/data/abilities.ts:3497-3510`, `:2318-2331`; `PS/data/mods/gen8/abilities.ts:556, 776` |
| Roost: pure Flying is Normal (Close Combat 2x), Flying/Steel is Steel (Earthquake hits), back at the end of turn | TV23, TV23b | `PS/data/moves.ts:15442-15460` (onType 15454-15458) |
| Burn Up: pure Fire to ???; Double Shock: Electric/Fighting to ???/Fighting | TV24, TV24b | `PS/data/moves.ts:2108-2113`, `:3962-3967` |
| Color Change: Kecleon hit by Thunderbolt is Electric (Earthquake 2x); not behind a Substitute | TV25 (+control), TW17 | `PS/data/abilities.ts:563-585` |
| Soak on turn 1, Tera Steel on turn 2: Water STAB (pre-Tera types), Steel defence | TV26 (+control) | `PS/sim/battle-actions.ts:1765` |
| **Today's app:** Color Change is silently wrong; Protean, Roost and Psychic Noise are guarded | `types-volatiles-app.out` | — |

---

## 2. Shared state and plumbing

### 2.1 World types

**State.** `BattleBuild.types?: string[]` holds one or two of the game's type names or `"???"`, never Stellar. It is the base
types after the last `setType`. Absent means the species' types. `BattleBuild.addedType?: "Grass" | "Ghost"` is the added
type. Both are documented in `types.ts` as "Set only by the 2v2 turn and Training, and the 2v2 calculator's
state-from-earlier-turns control". `focusEnergy` and `dragonCheer` use the same pattern (`types.ts:198-201`). `validateBuild`
(`model.ts:345`) checks them:

- types: 1–2 distinct names of the game's chart, or `"???"`;
- addedType: only in games where Forest's Curse or Trick-or-Treat exists, and not with `mechanic: "tera"`, since
  Terastallizing clears it (TW18);
- neither field on Arceus or Silvally (setType never changes their types);
- issue text, as the field rules read: `"Types are one or two of this game's types."`, `"An added type is Grass or Ghost."`,
  `"A Terastallized Pokémon has no added type."`.

**The typing rule** goes in one helper, `buildTypes(build, runtime)`, in `mechanics.ts`. That file has no engine imports, so
`doubles-targets.ts` can use it. `PS/sim/pokemon.ts:2138-2146`:

```ts
/** A build's types as pinned getTypes reads them: a Tera type (not Stellar) alone; else its types now (build.types, or its
 *  species') and its added type. */
export function buildTypes(build: BattleBuild, runtime: BattleRuntime): string[] {
  const tera = build.mechanic === "tera" && build.configuration?.teraType && build.configuration.teraType !== "Stellar" ? build.configuration.teraType : null;
  if (tera) return [tera];
  const base = build.types ?? runtime.speciesById.get(build.speciesId)?.types ?? [];
  return build.addedType ? [...base, build.addedType] : [...base];
}
```

It replaces every species-type reader:

| Site | Today |
|---|---|
| `doubles-turn.ts:1402-1405` typesOf | Tera or species |
| `doubles-turn.ts:1313-1318` powderImmune | duplicate rule → `kernel.typesOf` |
| `doubles-turn.ts:2275-2289` veilGuard (2282) | species only, a latent miss of Tera too |
| `doubles-targets.ts:32-37` Curse's request target | Tera or species |
| `intimidate.ts:248-251` (Flower Veil's Grass) | Tera or species |
| `uses-to-ko.ts:3615-3619` the search's `types(state, who)` | `state[who].speciesId === build.speciesId ? buildTypes(build) : species(state.speciesId)` (a form change inside the search resets them) |
| `calculate.ts:1683-1689` Burn Up and Double Shock's early gate | Tera, mimicry or species |
| `calculate.ts:1933` the late type gate | engine Pokémon types: correct once makePokemon carries the world types |

**Roost** stays `eot.roosted` (`doubles-world.ts:80`; the end of turn ends it at order 25, `doubles-eot.ts:493`). It is folded in
by a new kernel helper:

```ts
/** Its types in this world: buildTypes, then Roost's Type event (PS/data/moves.ts:15454-15458; none left: Normal, PS/sim/pokemon.ts:2143). */
typesIn(w: World, slot: DoublesSlotId): string[]
```

- `grounded()` (`doubles-turn.ts:1387-1399`) reads `typesIn(w, slot).includes("Flying")` in place of
  `typesOf(...).includes("Flying") && !(roosted && !tera)`.
- `calcBuild` sets `types` to the roosted base types while `eot.roosted` (TV23: Close Combat 2x into a roosted Tornadus;
  TV23b: Earthquake into a roosted Corviknight).
- Reflect Type reads `typesIn` without the added type, since `getTypes(true)` runs the Type event.

**setType and addType** go in one module (`doubles-typing.ts`, a hook module like `doubles-items.ts`). It is used by this
family and offered to the abilities and field families (Forecast, Mimicry, Transform):

```ts
/** pinned setType (PS/sim/pokemon.ts:2109-2129): false for a Terastallized Pokémon (any Tera type), Arceus and Silvally, or a
 *  Stellar type; otherwise build.types = types (absent when they are its species'), addedType cleared. */
export function setTypes(kernel: TurnKernel, w: World, slot: DoublesSlotId, types: string[]): boolean
/** pinned addType (2132-2136): false while Terastallized; else addedType = type. */
export function addType(kernel: TurnKernel, w: World, slot: DoublesSlotId, type: "Grass" | "Ghost"): boolean
/** setSpecies' reset (PS/sim/pokemon.ts:1392-1394): a form change clears build.types and addedType. */
export function formChanged(build: BattleBuild): BattleBuild
```

`formChanged` is called wherever the turn changes `speciesId`:

- `doubles-status.ts:948-953` stanceChange;
- `doubles-turn.ts:2645` faceHit's busted form;
- `doubles-eot.ts:964-975` hungerSwitch;
- `uses-to-ko.ts:4617-4629` toBuild when `side.speciesId !== base.speciesId`. In 1v1 neither field is ever set, so this is
  byte-equal;
- `calculate.ts`, when it computes an attacking Aegislash in its Blade form (Stance Change before its own hit): that
  calculation drops `build.types`.

**The calculation.**

- `calculate.ts:181-187` withTypes is generalised from one type to `string[]`. `makePokemon` (189-224) takes
  `[...buildTypes base, addedType]` when `build.types` or `build.addedType` is set; otherwise today's Mimicry override. The
  world types win over `mimicryTypes`, which then returns no line: the Pokémon's type was set after the terrain. Tera stays
  the engine's `teraType`, so `hasType` reads it first (`@smogon/calc/dist/pokemon.js:75-83`). `hasOriginalType` reads all
  entries, which is the STAB of TV03 and TV26.
- `engine-corrections.cjs:131` (the getMoveEffectiveness wrapper) gains a scoped state, set by `calculate()` around each
  engine run, `{ first, added, tarShot, miracleEye }`:
  - `first` is the defender's Tera type when Terastallized (not Stellar), else `types[0]`.
  - `added` is the engine Pokémon's `types[2]`: the added type of a two-type Pokémon. A one-type Pokémon's added type is
    `types[1]`, which the engine multiplies itself (gen789.js:301-302), so `added` is unset then, and unset when
    Terastallized (Terastallizing clears it anyway).
  - With the state set, the corrected function multiplies its own result by `corrected(gen, move, added, ...)` whenever
    `type === first`. This is the type-1 call of `gen789.js:300`, `champions.js:169` and the Collision Course call at
    `gen789.js:839`. It runs the same corrected function, so `neutralEffectiveness` (Disguise, Ice Face) makes the added
    type neutral too.
  - It multiplies by 2 at `type === first` for a Fire move with `tarShot` (`PS/data/moves.ts:18961-18967`: +1 on
    `getTypes()[0]` only).
  - It returns 1 for a Psychic move into `type === "Dark"` with `miracleEye`.
  - The engine discards the type-1 product for a Tera defender and recomputes on `teraType` (`gen789.js:305-306`). So
    `first` = teraType keeps Tar Shot right there (TV11c), and `added` is unset.
  - `uses-to-ko.ts:4641-4645` effectiveness() runs outside the scope over all the defender's types. It reads the same
    markers through one exported helper (`turnEffectiveness(gen, move, pokemon)`), so the added type is counted once.

### 2.2 Calculation-only modifiers (calcBuild)

`calcBuild(w, slot)` (`doubles-turn.ts:444-450`) returns, besides today's Plus and Minus:

| Field (BattleBuild, "Set only by the 2v2 turn") | From | Read by |
|---|---|---|
| `types` (roosted) | `eot.roosted` | everything above |
| `tarShot?: true` | `vol.tarShot` | the effectiveness scope |
| `revealed?: "foresight" \| "miracleeye"` | `vol.revealed` | `foresight`: the engine's `defenderSide.isForesight` (gen789.js:297; makeField sets it for that defender); `miracleeye`: the effectiveness scope |
| `floating?: true` | `eot.telekinesis` (and later the grounding family's `eot.magnetRise`) | §2.4 |
| `itemSuppressed?: true` | written on the world build with `eot.embargo` (its turns), and cleared with it, so `itemWorks(build)` and E2 see it | §2.5 |

The fields go into every memo key (searchFor's key at `doubles-turn.ts:585` already JSON-serialises `xb` and `tb`). `pairRows`
(`doubles-turn.ts:2962`) merges them into its attacker and defender builds, so the start rows and the Moves pane read
carried Tar Shot, Embargo and the rest. `makePokemon` copies them onto the engine Pokémon as a non-enumerable marker that
survives `clone()` (the withTypes pattern). `calculate()` (`calculate.ts:316`) reads the attacker's and defender's markers
and runs `engineCalculate` inside the scopes.

### 2.3 Move retyping (Electrify, Ion Deluge)

- `MoveContext.retype?: "electrify" | "iondeluge"` (`types.ts:304`; "Set only by the 2v2 turn") is derived:
  - by `contextFor` (`doubles-turn.ts:1500-1522`) when `w.mons[attacker].vol.electrify`, or when `w.field.ionDeluge`;
  - by `usedRow` (1278-1287, which redirection, absorption and Protean read through `usedType`), which takes the same
    context.
- In `calculate.ts`, before resolving the move, it works out the type after the user's ModifyType chain. For a move whose
  type is fixed (not in OWN_TYPE_MOVES below) that is:
  - Normalize (gen 7+, `PS/data/abilities.ts:2986`): Normal, boosted;
  - Liquid Voice on a sound move: Water;
  - Pixilate, Refrigerate, Aerilate, Galvanize, Dragonize on a Normal move: their type, boosted;
  - else the dex type.

  Then Electrify gives Electric. Ion Deluge gives Electric only when the type at that point is Normal (K56: a Pixilate
  move stays Fairy). The engine runs with `overrides.type: "Electric"`, the user's type-changing ability as `GAS_STAND_IN`
  for that run (else the engine's own Normalize branch, gen789.js:279, would turn it Normal again), and
  `withPowerMods([4915])` when the boost is kept. The partner-boost chain machinery in `calculate()` (316-340) already
  handles the order question for three or more power modifiers.
- `statusType` (`doubles-status.ts:721-729`) applies the same last step (TV09c, TV10b, TW16: an electrified or Ion Deluge
  Yawn goes to Volt Absorb).
- **Redirection reads the used type for status moves too:** `redirection()` (`doubles-turn.ts:1335`) takes an optional
  `type`. `targetsOf` (`doubles-status.ts:1058`) passes `use.type`, and its ate-redirect guard (1061-1068) is deleted. That
  guard is census-guards "ate-redirect": the -ate abilities, Normalize and Liquid Voice on status moves are then exact too.
- **Guarded, one reason each** (§9), and only when the turn would otherwise retype the move:
  - OWN_TYPE_MOVES (their own onModifyType or a type the engine computes from the field or the user): Weather Ball,
    Terrain Pulse, Judgment, Multi-Attack, Techno Blast, Revelation Dance, Natural Gift, Hidden Power, Aura Wheel, Raging
    Bull, Ivy Cudgel, Tera Blast (Terastallized), Tera Starstorm. TW03 shows Showdown keeps the doubled Weather Ball power;
    the engine re-types it by name.
  - a Z-Move (USUM: picked before ModifyType, TV09e), a Max Move (SwSh: picked after it, TV09d).

### 2.4 Grounding: floating (Telekinesis)

- `grounded()` (`doubles-turn.ts:1387-1399`) adds `if (mon.eot.telekinesis) return false;` after Magnet Rise, following
  `PS/sim/pokemon.ts:2148-2160`: Gravity, Ingrain, Smack Down and Iron Ball come first.
- `calcBuild` sets `floating`. In the engine:
  - `util.isGrounded` is wrapped in `engine-corrections.cjs` the same way. The engine reads it at call time
    (`gen789.js:177, 192, 374, 641, 645, 709, 816, 822, 852, 860`); a floating marker gives false unless `field.isGravity`
    or Iron Ball.
  - `calculate.ts`'s own `isGrounded` calls (754, 1010, 1097) go through an app helper that reads the marker.
  - A Ground move into a floating defender that is not Thousand Arrows is a zero-damage row,
    `"{Move} has no effect on {Name}."`, decided in `calculateTurnMove` before the engine (Air Balloon's place, gen789.js:370).
  - Thousand Arrows ignores the immunity (`ignoreImmunity: {Ground: true}`), so it is calculated as the engine does, and its
    smackdown volatile then removes the Telekinesis. That last part belongs to the grounding family's Smack Down; until
    then their `smackdown-later` guard stays.
- `uses-to-ko.ts:3659-3663` the search's `grounded()` reads `build.floating`.

### 2.5 Item suppression (Embargo)

Embargo is Magic Room for one Pokémon (`PS/sim/pokemon.ts:879-886`: `this.volatiles['embargo'] || magicroom`).

- `kernel.itemWorks(w, build)` (`doubles-turn.ts:306`) becomes `!w.field.magicRoom && !build.itemSuppressed && abilityId !== "klutz"`.
  The world build carries `itemSuppressed` from `eot.embargo` (set in `startWorld` and when Embargo lands), so every
  end-of-turn and status-pipeline read follows.
- The engine's `checkItem(pokemon, magicRoom)` (`util.js:202-211`) is wrapped: a suppressed marker clears the item into
  `disabledItem`, as Magic Room does. Knock Off reads `disabledItem` (gen789.js:779-780), so its 1.5x stays (TV15b).
- Every app site that reads `conditions.magicRoom` for one build's item reads `itemIgnored(build, conditions) = conditions.magicRoom || !!build.itemSuppressed`:
  - `calculate.ts:394, 690-694, 972, 1016-1021, 1100, 1144, 1167, 1286, 1479, 1497, 1512, 1829`;
  - `uses-to-ko` prepareUses' `attItemOn` and `defItemOn`;
  - `turnSpeed` and `turnPriority` (Choice Scarf, Iron Ball, Quick Powder, Macho Brace; Quick Claw, Lagging Tail and Full
    Incense in `fractionalOutcomes`, `doubles-turn.ts:753-768`, for a carried Embargo);
  - `doubles-turn.ts:1040, 1164, 2235`;
  - `validate()`'s Assault Vest check (2831-2835): an embargoed vest allows status moves.
- 1v1 never sets the field, so golden-1v1 is byte-equal.

### 2.6 Heal Block in later steps (and Psychic Noise)

`searchFor` (`doubles-turn.ts:568-611`) takes `opts.healBlocked` for the target when `receiver.eot.healBlock` and adds
`opts.attackerHealBlocked` for the attacker when `user.eot.healBlock`. `singleStep` (1968) and `spreadStep` compute both.

- A working HP Berry (`HEALING_BERRIES` but Enigma) reads as Leftovers, as `psychicNoiseKeepsBerry` does today
  (`doubles-turn.ts:2381-2389`). The Berry's TryEatItem runs TryHeal, which Heal Block fails (`PS/data/items.ts`
  sitrusberry onTryEatItem).
- So does an attacker's Shell Bell. Shell Bell heals through `this.heal`, which TryHeal fails (TW07).
- The caller puts the real item back after the step (1982-1984).
- The Lansat, Starf and stat pinch Berries are no heals and stay.
- `absorbEffect` (1586-1609): a heal-blocked absorber heals nothing (`"{Ability}: no damage."`), as TV16's `-immune [from] ability: Volt Absorb` shows.
- Draining moves and every heal-flag move already stop at BeforeMove 6 (`doubles-status.ts:299-303`, TV16).
- Pollen Puff onto it and every residual heal already read `eot.healBlock`.
- Natural Gift with a heal-blocked user holding an HP Berry is guarded (§9); the stand-in would change its type and power.
- `volatileGuard`'s Psychic Noise branch (`doubles-turn.ts:2424-2435`, `VOLATILE_SECONDARY_MOVES`) is removed. Psychic Noise's
  Heal Block (`doubles-eot.ts:1137-1146`) then reaches every later step.
- `EotState.healBlockLeft?: number`: turns left before this end of turn's countdown, from the input. Psychic Noise this turn
  starts at 2 and the Heal Block move at 5; neither ends this turn. Residual `healblock: {order: 20, subOrder: 2}` ends a
  Heal Block with 1 left, so the final Update's Sitrus and anything after order 20 heal again.

### 2.7 New hooks and handlers

| Hook | Where | For |
|---|---|---|
| `attractCheck` | `doubles-status.ts:124-150` beforeMove chain, after `confusionCheck` (priority 3), before `paralysisCheck` (1): `onBeforeMovePriority: 2`, `PS/data/moves.ts:742-748`. Skipped for No move, like paralysis (Splash does nothing either way) | Attract |
| `powderTryMove` | `doubles-turn.ts:1823` after `moveFailure` returns null (TryMove handlers above priority −1: Heavy Rain and Desolate Land at 1, Damp, the shields; TW08), and in `doubles-status.ts:1001-1004` runUse after `priorityShield`; returns the worlds after the loss | Powder |
| `typeOnHit` | `doubles-turn.ts:2304-2363` afterHit (Burn Up, Double Shock at 2335-2339; Color Change per target with `outcome.landed > 0`, not Sheer Force) | Burn Up, Double Shock, Color Change |
| `proteanType` | in place of `proteanGuard` (`doubles-status.ts:680-687`; call sites `doubles-turn.ts:1827`, `doubles-status.ts:821, 1135, 1846`) | Protean, Libero |
| residual `nightmare` | `doubles-eot.ts:444-508` collect; key `{order: 11, subOrder: 2}` in `residuals.ts:55` | Nightmare |
| residual `octolock` | collect, after syrupBomb (484-489); key `{order: 14, subOrder: 2}`; handler as `syrupBombHandler` (721-728) with `{def: −1, spd: −1}` | Octolock |
| residual countdowns | `telekinesis {19,2}`, `healblock {20,2}`, `embargo {21,2}`: end when 1 turn is left | carried Telekinesis, Heal Block, Embargo |
| `volatile()` cases | `doubles-status.ts:1497-1620`: tarshot, foresight, miracleeye, telekinesis, embargo, healblock, nightmare, octolock, attract, electrify, powder | the volatile moves |
| `onHit()` cases | `doubles-status.ts:1659-1754`: soak, magicPowder, addType (Forest's Curse, Trick-or-Treat), reflectType, conversion, conversion2, camouflage, ionDeluge (`sideOrField`, 1834) | the type moves |
| `tryImmunity` | `doubles-status.ts:1298-1309`: Attract and Captivate genders, Octolock's trapped immunity (Ghost) | Attract, Captivate, Octolock |
| `tryHit` | `doubles-status.ts:1209-1249`: Oblivious for Attract and Captivate (`PS/data/abilities.ts:3024-3029`), today Taunt only | Attract, Captivate |
| `updateAll` / `receivedItem` | `doubles-status.ts:1992-2084`: Mental Herb cures attract and healblock too (`PS/data/items.ts:3904-3912`, all six at once); Oblivious cures attract | Attract, Heal Block |

### 2.8 Contract (paste-ready)

```ts
// doubles-world.ts MoveVolatiles
/** Infatuated by the Pokémon that started the turn in this slot (Attract, Destiny Knot; ends at the Update after it faints). */
attract?: DoublesSlotId;
/** Tar Shot's volatile: Fire +1 effectiveness on its first type. */
tarShot?: true;
/** Foresight / Odor Sleuth ("foresight") or Miracle Eye ("miracleeye"); each fails on the other. */
revealed?: "foresight" | "miracleeye";
/** This turn: Electrify on it (its move is Electric). */
electrify?: true;
/** This turn: Powder on it (its Fire move fails, a quarter lost). */
powder?: true;
/** Generation 7: Trick-or-Treat or Color Change gave it a type at Showdown position 1 with its Curse queued (targetLoc −1). */
curseGlitch?: true;
/** The type its move had as used this turn (kept only while a Conversion 2 user is in the turn, as usedMove is). */
usedType?: string;

// doubles-world.ts EotState
nightmare?: true;
/** Octolock from the Pokémon that started the turn in this slot. */
octolock?: DoublesSlotId;
/** Turns left before this end of turn's countdown (Telekinesis 3, Embargo 5 when set this turn). */
telekinesis?: number; embargo?: number;
/** With healBlock: turns left before this end of turn's countdown; absent: it lasts past this turn. */
healBlockLeft?: number;

// doubles-world.ts FieldState (and BattleConditions, "Doubles turn only"; ends at this end of turn)
ionDeluge?: true;

// doubles-types.ts DoublesCarried (from earlier turns; the calculator's controls, Training's bridge)
tarShot?: true;
foresight?: true; miracleEye?: true;
telekinesis?: 1 | 2;
embargo?: 1 | 2 | 3 | 4;
/** Heal Block or Psychic Noise's: turns left, 1 to 4 (1: ends at this end of turn). */
healBlock?: 1 | 2 | 3 | 4;
nightmare?: true;
/** The Pokémon at this slot set it (Octolock: a foe; Attract: any other Pokémon in the turn). */
octolock?: DoublesSlotId;
attract?: DoublesSlotId;

// types.ts BattleBuild: types, addedType (§2.1); tarShot, revealed, floating, itemSuppressed (§2.2, derived only)
// types.ts MoveContext: retype (§2.3)
```

`carriedState` (`doubles-turn.ts:861-883`) maps the new carried fields. `carriedIssues` (2850-2889) adds:

- `"Octolock's source is not a foe in the turn."`;
- `"Attract's source is not in the turn."`;
- `"Infatuation needs opposite genders."`;
- `"Nightmare needs the Asleep status or Comatose."`;
- `"Tar Shot is not in this game."` (and the like, per game);
- `"Foresight and Miracle Eye cannot both be on it."`;
- `"Heal Block lasts 1 to 4 more turns."` (Psychic Noise: 1).

`discreteKey` already covers `mons`, `field` and `sides`, so worlds stay distinct. `outcomeMon` lists the new volatiles (§7).

---

## 3. Per move

Each entry: what Showdown does (cited), the model, randomness, end of turn, E2 and Training, the UI facts, what stays
guarded, the oracle cases (§10 has the full list) and the tests. "Kind" is the new `status-table.ts` kind. The generator
(`status-eot/build/track-a-gen-status-table.ts`) takes the kind from a status2 classification file and the handler and fails
keys from its `HANDLERS` and `FAILS` (21-44).

### 3.1 Soak (sv, champions, swsh, usum) — kind M, handler `soak`

- **Showdown** (`PS/data/moves.ts:17196-17204`): fails (`-fail`) when `getTypes().join() === "Water"` (added types and Tera
  count) or setType fails (Arceus, Silvally, any Terastallized target: TV01c, TV01d, K3b). Otherwise types = Water and the
  added type is cleared (TV01e, TW13). Water Absorb, Dry Skin and Storm Drain take it as a Water status move (TV01c), and
  Storm Drain redirects it. Both are existing pipeline steps.
- **Model:**

  ```
  if (typesIn(w, slot).join() === "Water") return fail(`${name} is already Water type`)
  if (!setTypes(kernel, w, slot, ["Water"])) return fail(arceus ? `${name}'s type cannot change` : `${name} is Terastallized`)
  ```
- **Later this turn:** every calculation into it (effectiveness, the Ground immunity of a Flying type lost, TV01), its own
  STAB, the status immunities (`canStatus`, `typeImmunity`, `tryImmunity`), `grounded` (Grassy Terrain, Misty and Electric
  Terrain, Psychic Terrain's shield), Tar Shot's first type, a queued Curse's Ghost check.
- **End of turn:** sand and hail immunities, Black Sludge (TV01b), Grassy Terrain heal (TV01). All of these come through
  `residualMon` (`doubles-eot.ts:377-386`).
- **Randomness:** none. **E2:** `build.types = ["Water"]`. **Training:** §7.
- **Facts:** hit `"Becomes Water type."`; fails `"Soak fails: Garchomp is already Water type."`, `"Soak fails: Arceus's type cannot change."`, `"Soak fails: Garchomp is Terastallized."`.
  Condition `"Type: Water."`.
- **Guards left:** none.

### 3.2 Magic Powder (sv, champions, swsh) — M, `magicPowder`

As Soak with Psychic (`PS/data/moves.ts:10748-10751`). It has the powder flag, so `tryHit` and `tryImmunity` (Overcoat,
Safety Goggles, Grass) already stop it (TV02b), and it is reflectable (TW09: Magic Bounce gives Jolteon Psychic). Its failure
is `return false`, so the fact is the same `"Magic Powder fails: ..."`. TV02: Gengar Psychic, Close Combat 0.5x.

### 3.3 Forest's Curse (sv, champions, swsh, usum) — M, `addType`

- **Showdown** (6135-6139): fails on `hasType('Grass')` (Tera's type, the added type) or when addType fails
  (Terastallized). Otherwise `addedType = Grass` (replacing an added Ghost).
- **Model:**

  ```
  if (typesIn(w, slot).includes("Grass")) fail(`${name} is already Grass type`)
  else if (!addType(kernel, w, slot, "Grass")) fail(`${name} is Terastallized`)
  ```
- **Later:** three-type effectiveness (K2: Ice Beam 45 → 90), the target's Grass STAB (TV03: 235 vs 157), powder and Leech
  Seed immunity (TV03: Spore immune), Flower Veil's and Flower Shield's Grass checks.
- **Facts:** hit `"Grass type added."`; condition `"Type: Water/Flying/Grass."` (a cursed Gyarados).
- **Guards left:** Synchronoise from a two-type Pokémon with an added type (§9): the engine compares only the user's
  `types[0]` and `types[1]` (gen789.js:315-317).

### 3.4 Trick-or-Treat (champions, swsh, usum) — M, `addType`

- As Forest's Curse with Ghost (19923-19927). It replaces an added Grass (TV04b). The Ghost type makes Normal and Fighting
  moves miss and Ghost moves 2x (K2b, TV04). It gives Octolock's trapped immunity and the Ghost Curse.
- **The Curse glitch** (19928-19934): `target.side.active.length === 2 && target.position === 1` and its queued action is
  Curse → `targetLoc = -1`.
  - Generation 7's Curse has target `normal` and no ally rule (`PS/data/mods/gen7/moves.ts:117-120` inheriting
    `gen8/moves.ts:100-104`), so its Ghost Curse goes to the ally (TW05 usum: Shuckle cursed).
  - In generation 8 (target `randomNormal`) and 9 (the ally rule sends it to a random foe) the glitch changes nothing
    (TV04c, TW05 swsh).
  - Model: when the target's Showdown position (`SHOWDOWN_POSITION[positionOf(w, target)].position === 1`) is 1 and a Curse
    of it is still in `w.remaining`, set `vol.curseGlitch` in gen 7.
  - `makeUse` (`doubles-status.ts:964-979`), for Curse from a user that is now Ghost:
    - its action aimed at nothing (chosen as a non-Ghost, `doubles-targets.ts:33-37`) → gen 7 with `curseGlitch`: the
      ally (the existing `normal` flow onto an ally);
    - otherwise `randomNormal` in every generation. Showdown's `getRandomTarget` for targetLoc 0 (TV04d, TW15) uses the
      existing random-foe branch with redirection (1048-1057).
  - A Ghost Curse user that lost Ghost (Soak, Magic Powder) already becomes the non-Ghost Curse through `typesOf` (TV04e).
- **Facts:** `"Ghost type added."`. **Randomness:** the random foe (1/2 each with two). **Guards left:** none.

### 3.5 Reflect Type (sv, champions, swsh, usum) — M, `reflectType`

- **Showdown** (14893-14910), on the target with the effect on the user:
  - the user (`source`) fails as Arceus or Silvally, or when Terastallized (TV05b);
  - `newBaseTypes = target.getTypes(true).filter(t => t !== '???')`: a Terastallized target gives `[teraType]`; Roost's
    Type event applies (use `typesIn` without the added type);
  - with none left: `['Normal']` if the target has an added type, else fail (TV05c);
  - `source.setType(newBaseTypes); source.addedType = target.addedType` (TV05, TW14). A Terastallized target has no added
    type (TW18).
- **Model:** `setTypes(user, base)` then `user.build.addedType = target.addedType` (unset clears it). bypasssub; not
  reflectable.
- **Facts:** hit on the target `"Lapras becomes Water/Flying/Grass type."` (the user's name: the change is the user's);
  fails `"Reflect Type fails: Jolteon's type cannot change."` / `"... Jolteon is Terastallized."` / `"... Arcanine has no type to copy."`.
- **Training's public view:** Showdown's line has no types (`-start|p1a|typechange|[from] move: Reflect Type|[of] ...`); the
  silent display line at endTurn completes it (`PS/sim/battle.ts:1712-1722`, TV05, TW14). The tracker already reads it
  (`tracker.ts:754-758`).

### 3.6 Conversion (sv, swsh, usum) — M, `conversion`

- **Showdown** (2804-2808): `type = dex.moves.get(moveSlots[0].id).type`. That is the dex type: a Hidden Power or Weather
  Ball in slot 1 gives Normal. It fails on `hasType(type)` (added and Tera count) or a failed setType (TV06).
- **Input:**
  - Training passes `moves` in move-slot order (`bridge.ts:350`, `mon.moveSlots`).
  - The calculator's quick moves are its four move slots (`doubles-prep.ts:287-291` sends them only for Imprison today).
    For Conversion it sends the four slots in order, and `DoublesPokemonInput.moves` is documented "in move-slot order".
  - With no moves, or an empty first slot: `REASONS.needsFirstMove`.
  - Turn fact (the reading, as the sleep counters'): `"Assumes Thunderbolt is Porygon's first move."` only for the
    calculator (Training's is the set).
- **Facts:** step `"Porygon becomes Electric type."`; fails `"Conversion fails: Porygon is already Electric type."`.

### 3.7 Conversion 2 (sv, swsh, usum) — M, `conversion2`

- **Showdown** (2823-2843):
  - The target's `lastMoveUsed` (the ActiveMove, its type after ModifyType: TV07 Pixilate gives Fairy). None: fail (TV07b
    turn 1).
  - Types = every standard type the user lacks (`source.hasType`) whose `damageTaken[attackType]` is 2 or 3 (resist or
    immune). Stellar never resists (`PS/data/typechart.ts:436`); `names()` drops nonstandard types.
  - `sample` over them (TV07: 1/3 each; K4: 1/2), then setType (it fails while Terastallized).
- **Model:**
  - The target moved earlier this turn: its `vol.usedType` (set at its use, from `usedType` or the status pipeline's
    `use.type`, kept only while a Conversion 2 user is in the turn, as `usedMove` is, `doubles-status.ts:148`).
  - Otherwise `DoublesPokemonInput.lastMove`:
    - undefined: `REASONS.needsLastMove` (existing text `"Conversion 2 needs Snorlax's move from the last turn."`);
    - null: fails `"Conversion 2 fails: Snorlax has used no move."`;
    - a move in OWN_TYPE_MOVES (§2.3), or a move that was a Z-Move or Max Move: `REASONS.needsLastMoveType`;
    - else its type as the target's current ability types it (the §2.3 rule without Electrify or Ion Deluge, which last
      only one turn). A last turn with an ability change is the abilities family's.
  - The chart comes from the game's own type chart (the engine's `gen.types`, minus ??? and Stellar).
  - One world per type, mass/n.
- **Randomness:** new: a uniform branch, at most 7 types. **Facts:** step `"Shuckle becomes Steel type."` (chance each),
  fails `"Conversion 2 fails: no type resists Normal that Porygon lacks."`.

### 3.8 Camouflage (usum) — M, `camouflage`

Terrain gives Electric, Grass, Fairy or Psychic, else Normal; it fails when `getTypes().join()` already is that type or
setType fails (2164-2178; K54, TV08, TV08b). It reads `w.field.terrain`. Facts: step `"Kecleon becomes Grass type."` /
`"Camouflage fails: Kecleon is already Normal type."`.

### 3.9 Electrify (champions, swsh, usum) — M, volatile `electrify`, fails `electrify`

- **Showdown** (4568-4583):
  - onTryHit fails when `!queue.willMove(target) && target.activeTurns`. Engine: no living queued action of the target
    → `"Electrify fails: Jolteon has already moved."` (K32b, TV09g). A Pokémon that switched in this turn (Training's
    prelude: its action is No move, still queued) does not fail (TW12), and nothing changes either way.
  - Volatile for this turn: every move of the target but Struggle is Electric at ModifyType −2.
  - Flags: protect only. A Substitute stops it, Magic Bounce does not reflect it, Volt Absorb, Motor Drive and Lightning
    Rod take it (TV09: Lightning Rod redirected Jolteon's own Electrify).
- **Model:**
  - `vol.electrify = true`.
  - Damaging moves through `MoveContext.retype` (§2.3): Ground immunity (K32), Lightning Rod (TW01), Volt Absorb, Motor
    Drive, Electric Terrain 1.3x for a grounded user, Charge 2x (TW04), STAB for an Electric user, the kept -ate or
    Normalize 1.2x (TV09b, TV09f vs TW02).
  - Status moves through `statusType` (TV09c).
  - Protean reads the used type (PrepareHit after ModifyType).
  - Powder reads it (an electrified Fire move is no Fire move).
- **E2:** not listed (ends this turn).
- **Facts:** hit `"Electrify: its move is Electric type this turn."`.
- **Guards left:** `"{Move} with Electrify is not modelled in 2v2."` for OWN_TYPE_MOVES, Z-Moves, Max Moves (named by the
  move used).

### 3.10 Ion Deluge (usum) — M, `ionDeluge` (sideOrField)

- **Showdown** (9687-9700): priority +1, target all, a pseudo-weather for this turn. Every move whose type after the
  -ate abilities is Normal becomes Electric: Pixilate stays Fairy (K56), Normalize goes Electric with its 1.2x (TV10). That
  covers status moves (TV10b) and Lightning Rod (TW11).
- **Model:** `w.field.ionDeluge = true` (a second use: nothing new). It is read by `contextFor`, `usedRow` and `statusType`.
  It ends at the end of turn and is never in E2.
- **Facts:** step `"Ion Deluge: Normal moves are Electric type this turn."`.
- **Guards left:** as Electrify's, with "with Ion Deluge", only for moves that would be Normal at ModifyType.

### 3.11 Tar Shot (sv, swsh) — M, volatile `tarshot`

- **Showdown** (18956-18971):
  - boosts `{spe: −1}` first, through applyBoosts: Clear Body, Mirror Armor, Defiant, Competitive, Eject Pack, White Herb
    (runMoveEffects order: boosts before the volatile);
  - the volatile fails on a Terastallized target (TV11b);
  - effectiveness +1 for Fire on `getTypes()[0]` (`PS/data/moves.ts:18961-18967`; TV11: 8x into Ferrothorn); for a Pokémon that Terastallized later, its
    Tera type (TV11c).
- **Model:** `vol.tarShot`, then `calcBuild.tarShot` (§2.1, §2.2). Expert Belt, Filter, Solid Rock, Prism Armor and Tinted
  Lens read the engine's product, as do the resist Berries. Speed: gen 8+ re-sorts already.
- **E2:** volatile `"tarshot"`. **Training:** not in Champions.
- **Facts:** hit `"−1 Speed."` (existing), `"Tar Shot: Fire is twice as effective against it."`; Tera: `"Tar Shot fails: Garchomp is Terastallized."` after the Speed fact.
  Condition `"Tar Shot."`.

### 3.12 Foresight, Odor Sleuth (usum) — M, volatile `foresight`

- Fails on a Miracle Eye target (TV12b). The volatile negates the Ghost type's Normal and Fighting immunity
  (6104-6120): Fighting into Gengar 0.5x (TV12), via the engine's `defenderSide.isForesight` (gen789.js:297-298, the
  `revealed` marker). Positive evasion is ignored, but every move hits in the oracle.
- **Facts:** `"Foresight: Normal and Fighting moves can hit it."`, `"Foresight fails: Umbreon is under Miracle Eye."`; condition `"Foresight."`; E2 `"foresight"`.

### 3.13 Miracle Eye (usum) — M, volatile `miracleeye`

Psychic hits a Dark type at 1 on that type (11962-11978; TV13: Dark/Steel 0.5x), through the effectiveness scope (§2.1). It
fails on a foresighted target. Facts: `"Miracle Eye: Psychic moves can hit it."`; E2 `"miracleeye"`.

### 3.14 Telekinesis (usum) — M, volatile `telekinesis`

- **Showdown** (19126-19162):
  - The gravity flag already stops it at BeforeMove under Gravity (TV14d), and onTry does too.
  - onStart:
    - the immune species (Diglett, Dugtrio, Sandygast, Palossand, Mega Gengar) give `-immune` (TV14c);
    - a smackdown or ingrain volatile fails it (TV14c).
  - 3 turns, ended at residual order 19.
  - Ground immunity; `isGrounded` false after Gravity, Ingrain, Smack Down and Iron Ball.
- **Later:** Earthquake misses (K37), Psychic Terrain does not shield it (TW06), Electric and Misty Terrain no longer act
  on it, no Grassy heal (TV14b), terrain boosts for its own moves (§2.4).
- **Gravity starting** (`PS/data/moves.ts` gravity onFieldStart, TW10) removes `telekinesis` (and `magnetRise`) from every
  active Pokémon: `fieldMove` (`doubles-status.ts:895-900`).
- **Facts:** `"Telekinesis: Snorlax floats."` (Magnet Rise's form); `"Diglett is immune."`; `"Telekinesis fails: Snorlax is held to the ground."`; condition `"Telekinesis."`; E2 `"telekinesis"`.

### 3.15 Embargo (usum) — M, volatile `embargo`

- 5 turns, ends at order 21. onStart runs the item's End: only Eject Pack, Mirror Herb and Utility Umbrella have one, and
  none is in USUM.
- `ignoringItem()` (§2.5): no Sitrus (K26), no Leftovers (TV15d), no Life Orb (TV15c), Air Balloon ignored (TV15: grounded,
  and not popped), Knock Off 1.5x kept (TV15b).
- The Z-Move is still allowed (`PS/sim/battle-actions.ts:1450-1456`: no ignoringItem check). Mega Evolution happens at
  the turn's start.
- `GAS_CHANGING_MOVES` keeps Embargo (USUM has no Neutralizing Gas, so that guard never fires).
- **Facts:** `"Embargo: its item has no effect."`; condition `"Embargo."`; E2 `"embargo"`.
- **Guards left:** Natural Gift by an embargoed user (§9). Fling is already guarded.

### 3.16 Heal Block (usum) and Psychic Noise (sv, champions) — M, volatile `healblock`

- **Showdown** (8285-8343):
  - allAdjacentFoes;
  - already heal-blocked: Heal Block fails (onRestart), Psychic Noise's restart does nothing;
  - Aroma Veil on the target's side blocks it (TV16c);
  - Mental Herb cures it at the Update (TV16d);
  - BeforeMove 6 stops heal-flag moves (existing);
  - TryHeal fails every heal but Z-power (§2.6; TV16, TV16b, TW07).
- **Model:** the `volatile()` case sets `eot.healBlock`, `healBlockLeft` 5 (Psychic Noise 2, `doubles-eot.ts:1144`). Then
  §2.6.
- **Facts:** `"Heal Block: it cannot heal."`, `"Heal Block fails: it is already up on Bronzong."`, `"Aroma Veil: Snorlax is not affected."`, `"Mental Herb: its Heal Block ends."`; condition `"Heal Block."` (exists).
- **E2:** `"healblock"` (exists). **Training:** maps `healblock` with its turns left (§7).

### 3.17 Nightmare (usum) — M, volatile `nightmare`

- onStart fails unless asleep or Comatose (TV17, TV17c). Residual 11: `damage(baseMaxhp/4)` (Magic Guard stops it). It ends
  when the sleep ends (`PS/sim/pokemon.ts:1677`, `cureStatus`; TV17b: wakes at its BeforeMove, no damage).
- **Model:** `eot.nightmare` is cleared by every sleep cure in the engine (sleepCheck's wake 209-231, `cureStatus`, the
  Berries, Heal Bell).
- The handler is `ownResiduals`-style with the existing wake branches. No new randomness: it rides the target's wake
  chance.
- **Facts:** `"Nightmare starts."`, `"Nightmare fails: Snorlax is awake."`; residual effect `"Nightmare"`; condition `"Nightmare."`; E2 `"nightmare"`.

### 3.18 Octolock (champions, swsh) — M, volatile `octolock`

- onTryImmunity: `getImmunity('trapped')`, so Ghost types are immune (TV18; the added Ghost counts). Already locked: fails.
- Residual 14:
  - its source gone, fainted or with `activeTurns` 0 → ends silently (TV18b). In the calculator the source has always
    been in; in Training a prelude switch-in has `activeTurns` 0.
  - else `boost({def: −1, spd: −1}, target, source, octolock)`: Defiant and Competitive per stat lowered (K17: +4), Mirror
    Armor back to the source, Clear Body (TV18c: the lock stays), Mist (the side family's), White Herb at 29.
  - Ties with Syrup Bomb at 14 go by Speed (existing tie machinery, `doubles-eot.ts:269-300`).
- **Facts:** `"Octolock starts."`, `"Gengar is immune."`; residual `"Octolock"` with `"Defense −1."`, `"Sp. Def −1."`; condition `"Octolock."`; E2 `"octolock"`.
- **Training:** maps the source (public `[of]`).

### 3.19 Attract (sv, champions, swsh, usum) — M, volatile `attract`

- **Showdown** (716-756):
  - onTryImmunity: opposite genders only (TV19: `-immune`);
  - Oblivious onTryHit `-immune` (TV19b, breakable);
  - onStart rechecks genders, then `runEvent('Attract')`: Destiny Knot gives the source `attract` back (TV19b), unless it
    already has it or its Oblivious immunity (onImmunity 'attract') or Aroma Veil (onAllyTryAddVolatile) stops it;
  - Aroma Veil on the target's side blocks (TV19e);
  - bypasssub;
  - onUpdate ends it once its source is not active (TV19d: at the Update after the source fainted, no roll);
  - BeforeMove priority 2: 1/2 `cant` (TV19c, TV19f);
  - Mental Herb cures it at the Update (K40).
- **Genders:** `getBuildGender` (`mechanics.ts:52-54`): the configuration's, else a fixed species gender. Unknown for a
  species with both: `REASONS.needsGender`.
- **Model:** `vol.attract = source`; `attractCheck` (§2.7):
  - if `!alive(w, source)` (or it left), clear;
  - else one world with mass/2 stopped (`skipFact "Infatuated."`) and one going on.
- **Randomness:** new: 1/2 per BeforeMove of an infatuated Pokémon.
- **Facts:** `"Becomes infatuated."`, `"Destiny Knot: Lapras becomes infatuated too."`, `"Snorlax is immune."` (genders), `"Oblivious: Snorlax is not affected."`, `"Aroma Veil: Snorlax is not affected."`; skip `"Infatuated."`; condition `"Infatuated."`; E2 `"attract"`.
- **Training:** Champions' most-learned L move (116 species). Map it with its source (§7).

### 3.20 Captivate (usum) — M

`onTryImmunity` genders (2194-2196: genderless immune, TV20), then `boosts {spa: −2}` through applyBoosts. Oblivious is
immune (TryHit). Spread over adjacent foes; Wide Guard applies (existing). Facts are those of the stage pipeline, plus
`"Magnezone is immune."`. Unknown gender: `REASONS.needsGender`.

### 3.21 Powder (usum) — M, volatile `powder`

- Priority +1; powder flag (Grass, Overcoat and Safety Goggles immune: TV21b); reflectable; bypasssub.
- For this turn, `onTryMovePriority −1`: a move of type Fire (the used type) fails and its user takes
  `clampIntRange(round(maxhp/4), 1)` (TV21: Will-O-Wisp too; K34).
- Magic Guard: no loss, still fails (TV21b). Heavy Rain fails the Fire move first, with no loss (TW08).
- A move whose own onTryMove fails first (Burn Up from a user that is not Fire type) loses nothing.
- A Fire Z-Move fails the same way (its Z-power is used).
- **Model:** `powderTryMove` (§2.7) → step fact `"Powder: Flare Blitz fails."` and `afterLoss` (Berries at the Update),
  lossFact `"Powder: Arcanine loses 41 HP."`.
- **Facts:** hit `"Powder: its Fire move fails this turn."`. **Randomness:** none. **E2:** none (one turn).

---

## 4. The type guards this family removes, and the Color Change bug

| Guard today | Where | New model | Evidence |
|---|---|---|---|
| `Protean changes {Name}'s type: later moves are not modelled.` (and Libero) | `doubles-status.ts:680-687` from `doubles-turn.ts:1827`, `doubles-status.ts:821, 1135, 1846` | `proteanType`: at PrepareHit, unless the move bounced, is a future move, is Snatched, or calls another; type = the used type (not ???); `typesOf().join() !== type`; setTypes (fails Terastallized). Gen 9 and Champions: once per entry (`build.abilityActive` false once used, the app's "unused" flag, `model.ts:67-68`); gen 7 and 8 every move (TW19, TW20) | TV22, TV22b |
| `Roost changes {Name}'s type: ...` | `doubles-status.ts:1420-1425` | `eot.roosted` folded by `typesIn` and `calcBuild` (§2.1); not for a Terastallized user (its onStart fails) | TV23, TV23b |
| `Burn Up changes ...`, `Double Shock changes ...` | `doubles-turn.ts:2335-2339` | `typeOnHit`: `getTypes(true)` (no added type) with Fire (Electric) → ???; setTypes clears the added type; not for a Terastallized user | TV24, TV24b |
| ate-redirect (`{Ability} is not modelled in 2v2.`) | `doubles-status.ts:1058-1068` | redirection with the used type (§2.3) | census-guards ate-redirect |
| `Psychic Noise is not modelled in 2v2.` | `doubles-turn.ts:2424-2435` | Heal Block in later steps (§2.6) | TV16, TV16b, TW07 |
| (none: a silent error) Color Change | — | `typeOnHit`: a hit that reached the Pokémon (`outcome.landed > 0`), it still has HP, a damaging move, used type not ??? and not `hasType`, no Sheer Force skip, setTypes; the gen 7 Curse glitch flag as §3.4 | TV25, TW17, `types-volatiles-app.out` |

`REASONS.typeChange` and `TYPE_LOSS_MOVES`' guard use are deleted. The Training bridge's
`"{Name}: {ability} was used this stint."` (`bridge.ts:297`) goes too: the build carries the type and the used flag.

---

## 5. Interactions with the other families

- **Abilities (Skill Swap, Role Play, Entrainment, Worry Seed, Simple Beam, Gastro Acid, Doodle, Transform):**
  - Protean, Libero and Color Change gained or lost mid-turn follow `build.abilityId`, which their enabler updates.
  - Oblivious gained cures attract and taunt at the Update.
  - Transform copies `getTypes(true, true)` or Roost's `typeWas`, and the added type (`PS/sim/pokemon.ts:1294-1296`):
    their `transformInto` should call `setTypes` with `enforce`.
- **Field change (Forecast, Mimicry, Protosynthesis...):** Forecast and Mimicry types go through `setTypes` (Mimicry's
  terrain end restores the species types: onTerrainChange `setType(baseSpecies.types)`).
- **Grounding (Smack Down, Thousand Arrows, Ingrain, Magnet Rise):** the `floating` marker (§2.4) is theirs to reuse for
  Magnet Rise. Smack Down's volatile removes Telekinesis. "Pinned" (forced grounded) is theirs to define on the same scope.
- **Items (Bestow, Corrosive Gas, Recycle, Stuff Cheeks, Teatime):** every item read goes through `kernel.itemWorks`, which
  now includes Embargo.
- **Stages and stored stats:** Tar Shot's and Captivate's stages use the shared `applyBoosts`. Octolock's residual drop
  uses the stage-events enabler for Eject Pack and Opportunist.
- **Switch-outs:** an infatuation or Octolock whose source switches out ends at the Update (Attract onUpdate, Octolock at
  14). The replacement enabler must clear them.
- **Magic Coat** (census "next-move" family) is not in this brief: it is a bounce source with its own pranksterBoosted
  (`doubles-status.ts:1276-1280`) and sits with Snatch.

---

## 6. Randomness and branch weights

| Move | New branches | Weight |
|---|---|---|
| Conversion 2 | one world per qualifying type (`this.sample`) | 1/n |
| Attract | each BeforeMove of an infatuated Pokémon, while its source is in | 1/2 stopped, 1/2 goes on |
| Trick-or-Treat → Curse | the Ghost Curse's random foe (gens 8, 9; gen 7 without the glitch) | 1/2 each with two living foes, then redirection |
| Nightmare | rides the target's wake branches | — |
| Octolock | ties with Syrup Bomb at order 14 by Speed (existing) | — |

---

## 7. Training

**Bridge** (`app/(app)/training/sim/bridge.ts`):

- `liveBuild` (61-81):
  - `types` when `pokemon.types.join() !== species.types.join()`, and `addedType`, from the belief battle. These are
    public: typechange and typeadd lines, and the gen 7+ silent display line (`PS/sim/battle.ts:1712-1722`; the tracker
    already rebuilds them, `belief-battle.ts:212-223`).
  - Protean and Libero used: `abilityActive` false, with the type.
  - This closes census 1's latent gap. Today the engine silently reads the species types after Soak, Magic Powder, Reflect
    Type, Forest's Curse, Trick-or-Treat, Burn Up or Double Shock from an earlier turn.
- `MAPPED_VOLATILES` (38-41) adds `attract`, `octolock`, `healblock`, `tarshot`. The USUM-only ones never occur in Champions.
- `carriedOf` (154-252) maps:
  - attract: `effectState.source` (public: the Attract user's move line, `[of]` for Destiny Knot and Cute Charm), its
    slot; the source must be active;
  - octolock: `effectState.source`, a foe, active;
  - healblock: `Math.min(4, duration)`. Psychic Noise's 2-turn count is public from its use turn (`tracker.ts`
    healblock moveId).
- `electrify` and `powder` never carry (duration 1).

**E2** (`doubles-types.ts:345-371` DoublesOutcomeMon):

- `build` carries the world types.
- The volatile ids gain `attract`, `octolock`, `tarshot`, `foresight`, `miracleeye`, `telekinesis`, `embargo`, `nightmare`
  (`doubles-status.ts:627-641`, `doubles-eot.ts:1210-1230`).
- `postFromOutcome` passes them through (`evaluate.ts:194`). The value function ignores ids it does not weigh
  (`value.ts:144-157`); whether to weigh infatuation is a Training choice.

**No hidden information:** types, infatuation, Octolock and Heal Block are all on public lines. Conversion 2's last-move
type in a belief world comes from the belief world's ability, never the true one (the bridge already runs one engine input
per belief world).

---

## 8. Calculator UI

The state-from-earlier-turns group (`BattleConditions.tsx:125-218`, `doubles-prep.ts:204-261` carriedOptions and
reconcileCarried) gains controls. Each shows only where its move exists in the game and where it can apply; labels name the
Pokémon (`Whose`). Facts only.

| Control | Games | Label | Writes |
|---|---|---|---|
| Type, Second type (selects: its own, or a game type, ???) | all | `Type`, `Second type` | `build.types` |
| Added type (none, Grass, Ghost) | sv, champions, swsh, usum (Forest's Curse); not when Terastallizing | `Added type` | `build.addedType` |
| Infatuated + `by` (the other Pokémon of opposite gender) | all | `Infatuated`, `Infatuated by` | carried.attract |
| Octolock + `by` (a foe) | champions, swsh | `Octolock`, `Octolock by` | carried.octolock |
| Heal Block + turns left 1–4 (Psychic Noise: 1) | all | `Heal Block`, `Heal Block turns left` | carried.healBlock |
| Tar Shot | sv, swsh | `Tar Shot` | carried.tarShot |
| Foresight, Miracle Eye, Telekinesis (turns left), Embargo (turns left), Nightmare (asleep only) | usum | as named | carried |

- Turn facts are only for what the turn reads and might not hold: Conversion's first move (§3.6). Nothing is added for
  types left at "its own", as for every other control.
- Card conditions (`DoublesHP.conditions`, conditionFacts `doubles-turn.ts:3486-3491`) gain `"Type: Water."` (when
  `typesIn` differs from the species' at that point), `"Tar Shot."`, `"Foresight."`, `"Miracle Eye."`, `"Telekinesis."`,
  `"Embargo."`, `"Nightmare."`, `"Octolock."`, `"Infatuated."`.
- `describeDoublesConditions` counts the new checkboxes as toggles.

---

## 9. REASONS

**Added** (`doubles-actions.ts:254-310`), exact text:

```ts
/** Electrify or Ion Deluge on a move whose type is set as it is used (Weather Ball, Terrain Pulse, Judgment, Multi-Attack,
 *  Techno Blast, Revelation Dance, Natural Gift, Hidden Power, Aura Wheel, Raging Bull, Ivy Cudgel, Tera Blast and Tera
 *  Starstorm of a Terastallized user), or on a Z-Move or Max Move (named as used); Synchronoise from a two-type Pokémon
 *  with an added type; Natural Gift with Embargo or Heal Block. */
combo: (move: string, what: string) => `${move} with ${what} is not modelled in 2v2.`,
/** Conversion: no move-slot order (the calculator without its quick moves). */
needsFirstMove: (name: string) => `Conversion needs ${name}'s first move.`,
/** Conversion 2: the last move's type as used is not known (an own-type move, a Z-Move or Max Move last turn). */
needsLastMoveType: (move: string, name: string) => `${move} needs the type of ${name}'s last move.`,
/** Attract, Captivate: a species with both genders and no gender set. */
needsGender: (move: string, name: string) => `${move} needs ${name}'s gender.`,
```

Example texts:

- `"Weather Ball with Electrify is not modelled in 2v2."`
- `"Max Strike with Electrify is not modelled in 2v2."`
- `"Breakneck Blitz with Ion Deluge is not modelled in 2v2."`
- `"Synchronoise with an added type is not modelled in 2v2."`
- `"Natural Gift with Embargo is not modelled in 2v2."`
- `"Conversion needs Porygon's first move."`
- `"Conversion 2 needs the type of Sylveon's last move."`
- `"Attract needs Snorlax's gender."`

`needsLastMove` is reused for Conversion 2.

**Removed:**

- `typeChange` (all four uses);
- the `notIn2v2("Psychic Noise")` and ate-redirect `notIn2v2` call sites;
- `notModelledBefore` and `notModelled` for these 22 moves (their L branch, `doubles-status.ts:778-786`; the keys stay
  while other families' L moves remain).

---

## 10. Oracle

**Harness additions** (`scripts/.cache/calc-audit/2v2/verify/`):

- `case-types.ts` CaseMon gains `types?: string[]`, `addedType?: string`. CaseCarried gains the fields of §2.8.
- `sim-dfs.ts` `prepare`/`applyCarried` (210-265):
  - `setType(types, true)` and `addedType`;
  - `addVolatile` for tarshot, foresight, miracleeye, telekinesis, embargo and healblock, each with
    `volatiles[id].duration` from the turns left;
  - nightmare;
  - octolock and attract with `source`.
- The oracle's slot snapshot (569-581) records `getTypes()` per slot after the moves and after the turn.
- `app-turn.ts` caseBuild and caseCarried map them.
- `compare.ts` (374-450) adds:
  - an E2 types mixture (each outcome's `buildTypes`) against the oracle's;
  - the new volatile ids in its list (with `healblock`, missing today);
  - the condition facts for types.

**Cases** (prefix `F2-`; each sv plus another game where the move exists; USUM-only moves get two USUM cases). The checks
summarise the probe each is built on.

| Id | Game | Turn | Checks |
|---|---|---|---|
| F2-SK1 | sv | Azumarill Soak Gyarados; Lapras Thunderbolt into Gyarados; Gyarados's partner Earthquake; Grassy Terrain | 2x, Earthquake hits, Grassy heal (TV01) |
| F2-SK2 | champions | Araquanid Soak Gyarados; Thunderbolt; sand | Champions types and sand (K1) |
| F2-SK3 | sv | Soak into a Tera Garchomp; into Arceus | the failures (TV01c, TV01d) |
| F2-SK4 | usum | Soak into a Black Sludge Gengar | Black Sludge at the end of turn (TV01b) |
| F2-MP1 | sv | Hatterene Magic Powder Gengar; Close Combat | Psychic, 0.5x (TV02) |
| F2-MP2 | champions | Hatterene Magic Powder Venusaur, then into Espeon (Magic Bounce) | powder immunity, bounce (TV02b, TW09) |
| F2-FC1 | sv | Trevenant Forest's Curse Gyarados; Ice Beam | three types (K2) |
| F2-FC2 | champions | Trevenant Forest's Curse Snorlax; Snorlax Seed Bomb; later Spore | STAB, powder immunity (TV03) |
| F2-FC3 | sv | Forest's Curse on a Tera target; then Soak | failure, Soak clears it (TV03b, TV01e) |
| F2-TT1 | champions | Gourgeist Trick-or-Treat Lucario; Shadow Ball | Ghost 2x (TV04) |
| F2-TT2 | swsh | Trick-or-Treat after Forest's Curse | Grass replaced (TV04b) |
| F2-TT3 | champions | Trick-or-Treat into a position-1 Snorlax with Curse | Ghost Curse to a random foe (TV04c) |
| F2-TT4 | usum | the same | Curse glitch: the ally (TW05) |
| F2-TT5 | swsh | Trick-or-Treat into a position-0 Curse user | random foe (TW15) |
| F2-RT1 | sv | Gengar Reflect Type on a Forest's-Cursed Gyarados; Ice Beam into Gengar | base and added copied (TV05) |
| F2-RT2 | champions | Stunfisk Reflect Type the same | Champions (TW14) |
| F2-RT3 | sv | Reflect Type on a Tera Water target; Tera user fails | (TV05b) |
| F2-RT4 | champions | Reflect Type on a Burn Up Arcanine | ??? fails (TV05c) |
| F2-CV1 | sv | Porygon2 (Thunderbolt first) Conversion; Earthquake | first slot (TV06) |
| F2-CV2 | usum | Porygon Conversion with Hidden Power first | dex Normal |
| F2-C21 | sv | Sylveon Hyper Voice; Porygon-Z Conversion 2 on it | Fairy resisters, 1/3 (TV07) |
| F2-C22 | swsh | Conversion 2 on a target with lastMove Body Slam (input) | last turn's move (TV07b) |
| F2-CM1 | usum | Kecleon Camouflage on Grassy Terrain | (TV08) |
| F2-CM2 | usum | Camouflage with no terrain | fails (TV08b) |
| F2-EL1 | champions | Heliolisk Electrify Snorlax; Body Slam into Garchomp | immune (K32) |
| F2-EL2 | champions | Electrify; Body Slam aimed at Lightning Rod's ally | redirect (TW01) |
| F2-EL3 | champions | Electrify a Pixilate Sylveon; Hyper Voice | 1.2x kept (TV09b) |
| F2-EL4 | swsh | Electrify; Yawn into Volt Absorb | status move absorbed (TV09c) |
| F2-EL5 | swsh | Electrify; Charge and Electric Terrain | boosts (TW04) |
| F2-EL6 | usum | Electrify Normalize Delcatty; Thunderbolt | Normalize 1.2x (TV09f, TW02) |
| F2-EL7 | swsh | Electrify after the target moved | fails (TV09g) |
| F2-ID1 | usum | Lanturn Ion Deluge; Normalize Thunderbolt; Pixilate Hyper Voice | (TV10, K56) |
| F2-ID2 | usum | Ion Deluge; Body Slam into Lightning Rod's ally; Yawn into Volt Absorb | (TW11, TV10b) |
| F2-TS1 | sv | Coalossal Tar Shot Ferrothorn; Flamethrower | 8x, −1 Speed (TV11) |
| F2-TS2 | swsh | Tar Shot; the Speed re-sort and Fire | gen 8 |
| F2-TS3 | sv | Tar Shot into a Tera target; carried Tar Shot with Tera | (TV11b, TV11c) |
| F2-FS1 | usum | Foresight Gengar; Close Combat | (TV12) |
| F2-FS2 | usum | Odor Sleuth; Miracle Eye on a foresighted target | same volatile, failure (TV12, TV12b) |
| F2-ME1 | usum | Miracle Eye Bisharp; Psychic | (TV13) |
| F2-TK1 | usum | Telekinesis Snorlax; Earthquake; Grassy Terrain | (K37, TV14b) |
| F2-TK2 | usum | carried Telekinesis; Psychic Terrain priority; Gravity | (TW06, TW10) |
| F2-EM1 | usum | Embargo on Sitrus, Air Balloon and Life Orb holders | (K26, TV15, TV15c) |
| F2-EM2 | usum | Embargo; Knock Off; Leftovers | (TV15b, TV15d) |
| F2-HB1 | usum | Heal Block; Recover; Giga Drain; Volt Absorb | (K35, TV16) |
| F2-HB2 | usum | Heal Block; Sitrus kept; Shell Bell; Leech Seed | (TV16b, TW07) |
| F2-HB3 | usum | Heal Block with Aroma Veil and Mental Herb | (TV16c, TV16d) |
| F2-PN1 | sv | Psychic Noise into a Sitrus holder; a later hit and its Recover | the guard gone |
| F2-PN2 | champions | Farigiraf Psychic Noise before a Volt Absorb hit and a drain | Champions |
| F2-NM1 | usum | Nightmare on a sleeper; Komala | (K36, TV17c) |
| F2-NM2 | usum | Nightmare; the sleeper wakes at its move | ends (TV17b) |
| F2-OL1 | champions | Grapploct Octolock a Defiant foe; Clear Body | (K17, TV18c) |
| F2-OL2 | swsh | Octolock; source faints; Ghost immune | (TV18, TV18b) |
| F2-AT1 | sv | Attract; Body Slam (1/2); Mental Herb | (TV19c, K40) |
| F2-AT2 | champions | Attract; Destiny Knot; Oblivious | (TV19b, TV19f) |
| F2-AT3 | swsh | Attract; the source faints first; Aroma Veil | (TV19d, TV19e) |
| F2-AT4 | usum | carried infatuation; genderless and same gender | (TV19) |
| F2-CP1 | usum | Captivate; genderless foe; Oblivious | (K20, TV20) |
| F2-CP2 | usum | Captivate into Defiant and Competitive | stage reactions |
| F2-PW1 | usum | Vivillon Powder; Flare Blitz; Will-O-Wisp | (K34, TV21) |
| F2-PW2 | usum | Powder; Grass immune; Magic Guard; Heavy Rain | (TV21b, TW08) |
| F2-PR1 | sv | Greninja Protean Ice Beam; Flamethrower into it | (TV22) |
| F2-PR2 | champions | Greninja Protean on turn 2 (carried used) | once per entry (TW19) |
| F2-PR3 | swsh | Cinderace Libero Acrobatics; Earthquake | Flying (TV22b) |
| F2-RO1 | sv | Tornadus Roost; Close Combat | Normal (TV23) |
| F2-RO2 | champions | Corviknight Roost; Earthquake; the end of turn | Steel; back at 25 (TV23b) |
| F2-BU1 | champions | Arcanine Burn Up; Hydro Pump into it | ??? (TV24) |
| F2-DS1 | sv | Pawmot Double Shock; Earthquake | ???/Fighting (TV24b) |
| F2-DS2 | champions | the same | Champions |
| F2-CC1 | usum | Thunderbolt into Kecleon (Color Change); Earthquake | the bug fixed (TV25) |
| F2-CC2 | usum | the same behind a Substitute | no change (TW17) |
| F2-TY1 | sv | carried Soak types and Tera next turn | pre-Tera STAB (TV26) |
| F2-TY2 | champions | carried added Ghost; Close Combat; Octolock | carried types |
| F2-G1… | per guard | each §9 reason, `notEstimated` | exact texts |

**The 1264 stored cases** must keep agreeing. No stored case uses these moves except the guarded ones (`S48-Attract-*`, R02,
R03, R07, S48-Roost-flying, RT-RV05). Those change from `notEstimated` to estimated and need fresh oracle runs (their
expectation moves from the reason to the numbers). The rest are unaffected: no `types` field is set and the shared code
paths are byte-equal without the new fields. compare.ts's new E2 types check runs only where the oracle result records
`types` (fresh runs).

---

## 11. Tests

- `tests/unit/doubles-typing.test.ts`:
  - buildTypes and typesIn (Tera wins, Stellar keeps the base, Roost's pure Flying → Normal, added type last);
  - setTypes and addType (Arceus, Silvally, Tera, Stellar refuse);
  - formChanged on Stance Change, a busted Disguise, Hunger Switch;
  - Terastallizing clears the added type.
- `tests/unit/engine-corrections-effectiveness.test.ts`:
  - a two-type Pokémon's added type at the first-type call, once, in gen789 and champions; a one-type Pokémon's read
    natively as `types[1]`;
  - Tar Shot on the first type and on a Tera type;
  - Miracle Eye on Dark only;
  - neutralEffectiveness keeps the added type neutral;
  - Collision Course reads the product;
  - uses-to-ko effectiveness() agrees with the engine's product.
- `tests/unit/doubles-family2.test.ts`: one test per move above (the facts' exact texts, the E2 volatiles, the residual
  orders 11, 14, 19, 20, 21), the §9 guards, the Curse targets per generation, Attract's 1/2 and its end, Powder's loss
  order.
- `tests/source/`:
  - `doubles-status-moves.test.ts`: the new kinds and handlers against the pinned dex;
  - REASONS keys live (`typeChange` gone);
  - a check that the vendored engine calls `getMoveEffectiveness` only at the sites §2.1 lists (gen789.js:300, 302, 306,
    839; champions.js:169, 171; gen12, gen3, gen4, gen56 never reached by these games);
  - `isGrounded` read through `util` at call time.
- golden-1v1 `--check` byte-equal; the generated `doubles-turn-showdown.test.ts` regenerated with the F2 cases.

---

## 12. Riskiest points, and what only the user can decide

**Risks**

1. **The effectiveness scope depends on the vendored engine's call order** (type 1 first, then type 2, then Tera). An engine
   upgrade that adds a call site would double or drop the third type. Mitigation: the source test of §11, and the oracle
   cases F2-FC*, F2-TT*, F2-TS*, F2-ME1.
2. **Embargo touches roughly 15 `conditions.magicRoom` sites shared with 1v1.** A missed site gives a quiet USUM-only error;
   a wrong site could break golden-1v1. Mitigation: the field is never set in 1v1, so the golden check and the F2-EM cases
   pin both sides.
3. **Electrify and Ion Deluge stand in for the user's type-changing ability for one run and add 4915 to the power chain.**
   With three or more power modifiers the chain's order question is the existing partner-boost one (`calculate.ts`
   316-340). It must report through the same issue path, not pass silently.
4. **Form changes inside the pairwise search must clear the world types** (uses-to-ko toBuild, Stance Change in
   `calculate.ts`). A Soaked Aegislash is the case that would expose a miss.
5. **Training's bridge now sends type-changed and infatuated Pokémon to the engine** instead of rollouts. That moves the
   Training conformance and eval numbers (gate 4b's engine-cell share should rise). The HabitBot gate already sits near
   its sampling spread (FINAL.md §4).

**For the user to decide**

1. **Calculator UI scope (§8).** Recommended: Type, Second type and Added type, Infatuated by, and Heal Block turns left
   in all games, Tar Shot in SV and SwSh, and the USUM volatiles only in USUM. The alternative is engine and Training
   only, with the calculator assuming "none" as today.
2. **Fix the Color Change bug first, separately.** It is a silent wrong number today (USUM only, Kecleon). A one-line guard
   is possible before this build lands.
3. **Attract or Captivate with a species of both genders and no gender set:** not estimated (recommended), or assume
   opposite genders and state it.
4. **Conversion in the calculator:** treat the first quick-move slot as Showdown's first move slot, with the turn fact
   (recommended), or always ask.
5. **Electrify or Ion Deluge on own-type moves, Z-Moves and Max Moves:** stay guarded (recommended: under 0.01 % of turns),
   or model the Max Move's re-pick and Weather Ball's kept power.
6. **Training's value function:** whether infatuation, Octolock or Heal Block get weights (today's `volatilesOf` would
   ignore them).
