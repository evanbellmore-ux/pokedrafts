# 2v2 end of turn — architect design (status-eot)

Branch `calc-2v2-status-eot` from main `0ccce76`. Design step only (no app/ or tests/ edits). Ground truth: pinned Showdown
`c23d2e94` (`node_modules/.cache/champions/pokemon-showdown-c23d2e94…`, cited as `PS/…`), runnable copy
`scripts/.cache/calc-audit/showdown`. Every behavioural claim below is either cited or backed by a probe in this folder:

- `eotsim.ts` (harness: forced lowest rolls, no crits, every move hits, chances forced per effect, tie order forced, HP read when
  the residual action is picked **and** after the turn, residual log), `probes.ts` → `probes.out` (E1–E38), `probes2.ts` →
  `probes2.out` (F1–F7), `dyna.ts` (Dynamax turns), `inventory.ts` → `inventory.out` (every `onResidual` / `onFieldResidual` /
  `onSideResidual` handler in gen9 + champions + gen8 + gen7 data with its order, subOrder, priority).
- Run any of them from the repo root: `npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/probes.ts [E7]`.

Scope boundary with the status architect: they own what status moves do **during the moves** (Leech Seed landing, Toxic,
Will-O-Wisp, Spore, Yawn, Curse's HP cost, Roost, Ingrain, Aqua Ring, Wish, Perish Song...). This design owns the **end of turn**:
the state those moves leave for it (`MonState.eot`, §5, the shared contract both write against), the residual phase, the result
contract, UI, Training and the oracle. Where a status move is needed for an end-of-turn test, the case is tagged *(needs status
move X)*.

---

## 0. Summary of decisions

1. **One residual phase after the moves**, per finished world, in pinned Showdown's `fieldEvent('Residual')` order: every handler
   sorted by **order, priority, Speed, subOrder** (Speed *before* subOrder — probe E1), Speed being each Pokémon's
   `getActionSpeed()` after the moves (Trick Room and a Tailwind set this turn included — E2, E32); ties branched exactly where the
   tied handlers interact (mutual Leech Seed: E29a/b give different HP), otherwise applied in any order.
2. **Faints after every handler** (Showdown's `faintMessages`), the **Update after the weather** handler and the **final Update**
   after the residual (berries, Cheek Pouch, curing Berries), then Emergency Exit / Wimp Out as a fact (they switch after the turn).
3. **Shared rules, not a second copy**: a new pure module `app/lib/battle/residuals.ts` holds the per-Pokémon residual rules
   (amounts, immunities, sort keys) that `uses-to-ko.ts` `residuals()` builds today; the 1v1 search keeps its walker and becomes an
   adapter over the shared rules (golden-1v1 byte-equal gate). The 2v2 phase (`app/lib/battle/doubles-eot.ts`) adds the
   cross-Pokémon handlers (Leech Seed, Bad Dreams, Healer, traps' source check, Wish) on the world/factor model.
4. **The moves stay exact even when the end of turn cannot be**: a new `endOfTurn` part of the ready result is either
   `ready` (HP after the whole turn + the ordered residual list) or `not-estimated` with a short reason. `hp` keeps its meaning
   (after the moves), so every existing test and the 556 oracle results stay valid.
5. **Card shows HP after the turn** ("After the turn · Average estimate"); the turn panel gets an **End of turn** list (one line per
   effect per Pokémon, in Showdown order, with KO chances). When the end of turn is not estimated, the card keeps "After the moves"
   and the panel says `End of turn not estimated: {reason}`. The turn fact `End-of-turn effects are not applied.` goes away.
6. **E2 (`calculateDoublesOutcomes`)** returns outcomes after the turn plus `endOfTurn: "applied" | { notEstimated }`. Training
   drops its residual-clone delta for applied outcomes and keeps it only as the fallback; its bridge maps the carried
   end-of-turn state (toxic stage, Leech Seed, traps, Salt Cure, Yawn, Perish, Wish, field turns) into a new optional input.
7. **Oracle**: `sim-dfs.ts` runs the residual action instead of stopping at it, enumerates its random calls (Healer, Shed Skin,
   Harvest, Moody, tie shuffles), and records HP after the turn and each residual's change; all 556 existing cases are re-run
   (their after-the-moves values must not move) and ~50 new `R` cases cover every modelled residual.

---

## 1. How pinned Showdown runs the end of the turn

### 1.1 The residual action
- `PS/sim/battle.ts:2811-2817` (`case 'residual'`): `clearActiveMove(true)`, **`updateSpeed()`**, `residualPokemon = getAllActive()
  .map(p => [p, p.getUndynamaxedHP()])` (HP at the residual's start, for Emergency Exit), then `fieldEvent('Residual')`, then
  `|upkeep`.
- After it, the common tail of `runAction` (`PS/sim/battle.ts:2832-2867`): `faintMessages()`; `checkFainted()` (fainted slots flagged
  for replacement — the replacements come **after** the turn, so fainted slots stay empty through the residual); then (gen ≥ 5)
  **`eachEvent('Update')`** (the final Update: berries) and, for each Pokémon whose HP went from above half at the residual's start
  to at most half now, `runEvent('EmergencyExit')` (`:2860-2866`). Probe F6: a Sitrus eaten at that Update takes Golisopod back
  above half and no Emergency Exit happens; probe E12: without it, `-activate … Emergency Exit` and a switch request after the turn.
- `endTurn()` (`PS/sim/battle.ts:1623-1638`): Dynamax ends here for a Pokémon whose `dynamax` volatile has `turns === 3`
  (incremented by its residual at priority −100, `PS/data/conditions.ts:794-797`), setting `hp = getUndynamaxedHP()`
  (`:800-803`). A Dynamax started this turn has `turns` 1 after this turn's residual (probe `dyna.ts`: still 470/470 max after turn 1).

### 1.2 `fieldEvent('Residual')` (`PS/sim/battle.ts:484-567`)
- Collects, **once at the start**: field handlers `onFieldResidual` (weather, terrain/room countdowns), side handlers
  `onSideResidual` (screen/Tailwind countdowns), and for every active Pokémon (`side.active`, fainted ones included at collection)
  its status, volatiles, ability, item, species and **slot conditions** `onResidual`, the side's `onResidual` with that Pokémon as
  holder (G-Max Wildfire and its kin, Fire Pledge's sea of fire) and the field's `onResidual` with that Pokémon as holder (Grassy
  Terrain's heal).
- Sorts once with `speedSort(handlers)` → `comparePriority` (`PS/sim/battle.ts:404-411`): **order** ascending (no order = last),
  **priority** descending, **speed** descending, **subOrder** ascending, effectOrder. Ties (all keys equal) are shuffled
  (`speedSort` `:429-458`, `prng.shuffle`).
- `resolvePriority` (`PS/sim/battle.ts:950-1000`): a Pokémon holder's handler takes `speed = pokemon.speed` (set by `updateSpeed`
  → `getActionSpeed()`, `PS/sim/pokemon.ts:556-558, 641-649`: Trick Room's `10000 − speed` with the 13-bit wrap; Champions'
  `-speed`, `PS/data/mods/champions/scripts.ts` pokemon.getActionSpeed); field/side holders have no speed (0). Default subOrders
  when the effect gives none: Condition (volatile) 2, slot condition 3, side condition 4, field condition / Weather 5, Ability 7
  (Poison Touch/Perish Body 6), Item 8; a Status (`brn`, `psn`, `tox`) has none listed → 0.
- Runs each handler in that order; **a handler whose holder has fainted is skipped unless it is a slot condition** (`:509-513`);
  a handler whose effect state was replaced or removed is skipped (`:522-555`: a status cured by Healer/Hydration/Shed Skin, a
  trap ended); a handler with a `duration` is counted down first and **ends instead of acting** on reaching 0 (`:515-521`).
- **`faintMessages()` after every handler** (`:565`).

Probes:
- E1 (Champions, Grassy Terrain, four at half HP, Leftovers on two): Garchomp (fastest) gets Grassy Terrain *and* Leftovers
  before Tyranitar's and Toxapex's Grassy heals, then Snorlax's Grassy and Leftovers — Speed sorts before subOrder.
- E2: the same under Trick Room — Snorlax (slowest) first, Garchomp last.
- E32: Tailwind used this turn doubles that side's Speed for this sort (Toxapex and Snorlax's Leftovers first).
- E34: Aqua Ring (order 6) on the slower Blastoise before Ingrain (7) on the faster Venusaur — order before Speed.
- E26: two equal-Speed poisoned Garchomp: the order-9 tie is shuffled (no HP difference).
- E29a/b: mutual Leech Seed at equal Speed, one at 10 HP: tie order p1a first → p1a faints, p2a 155; p2a first → p1a ends at 10.
  **Tie order matters when tied handlers touch each other's HP.**

### 1.3 The weather handler and the two Updates
- Weather residual (`PS/data/conditions.ts`): rain `:505-509`, sun `:583-587`, Primordial Sea/Desolate Land/Delta Stream
  `:537-540, 619-622, 743-746` call `eachEvent('Weather')` always; sand `:654-660`, hail `:684-690`, snow `:720-723` only
  `if (this.field.isWeather(...))` (Cloud Nine/Air Lock make it false, `PS/sim/field.ts:100-116`).
- `eachEvent('Weather')` (`PS/sim/battle.ts:465-478`): every active Pokémon in Speed order (ties shuffled), `runEvent('Weather')`
  (sand/hail `onWeather` damage `baseMaxhp/16`, Ice Body, Rain Dish, Dry Skin, Solar Power); under Cloud Nine/Air Lock every
  Weather handler is skipped (`:886-892`); then **`eachEvent('Update')` in gen ≥ 7** — the Update after the weather. Probe E30:
  four sand damage lines, then Snorlax's Sitrus. Probe E7: Sitrus at that Update, before Leftovers would act. Probe E36 (Cloud
  Nine): `|-weather|Sandstorm|[upkeep]`, no damage.
- Weather damage immunity: `spreadDamage` skips a Pokémon whose `runStatusImmunity('sandstorm'/'hail')` fails
  (`PS/sim/battle.ts:2113-2117`): Rock/Ground/Steel (sand), Ice (hail), Overcoat, Sand Force/Rush/Veil, Snow Cloak, Ice Body,
  Safety Goggles, and a Dig/Dive user underground/underwater on its charge turn. Probe E16: Garchomp mid-Dig takes no sand; Charizard
  mid-Fly takes sand but no Grassy heal (`grassyterrain` heals only `isGrounded() && !isSemiInvulnerable()`, `PS/data/moves.ts:7712-7720`).
- Magic Guard stops every non-move damage (`PS/data/abilities.ts:2465-2472` onDamage) — weather, status, Leech Seed drain on it,
  traps (F1: Clefable), Salt Cure, Curse, Bad Dreams, Sticky Barb, Black Sludge. Utility Umbrella stops sun/rain effects on its
  holder (Dry Skin, Rain Dish, Solar Power, Hydration via `pokemon.effectiveWeather()`; F7) but not Harvest (`field.isWeather`).
- The final Update comes after `checkFainted` and after `|upkeep` (E38: Harvest's Sitrus eaten after `|upkeep`).
- **No Update between other handlers**: a Pokémon taken below its Berry line by poison (9) can be knocked out by Salt Cure (13)
  before it eats.

### 1.4 What the moves leave for the end of turn
- A status, volatile, weather or terrain set during the moves is collected at the residual's start and acts this turn: Toxic this
  turn → 1/16 (E15), Leech Seed this turn drains (E3), Fire Spin this turn traps and damages (E6: 225 → 196 = 235/8), Salt Cure
  this turn (E10: Champions 183/16 = 11), Ghost Curse this turn (E19: 183/4 = 45), Sandstorm and Grassy Terrain used this turn
  (E22), Ingrain/Aqua Ring this turn (E34), G-Max Wildfire this turn (E35: 155/6 = 25 and 154/6 = 25).
- Wish, Perish Song, Yawn and Future Sight used **this** turn change no HP this turn (E8: `perish3`; Wish and Yawn act at the end
  of the *next* turn — turn 2 shows the Wish heal and `|-status|…|slp`). Toxic Orb/Flame Orb at 28.3 give the status for the next
  turn (E28). Speed Boost acts on turn 1 (`activeTurns` is 1 then: E14).
- **A Pokémon that switches out during the moves is replaced before the residual** (E17: U-turn as the last action → switch request
  before the residual action is picked). The replacement (unknown to the calculator) takes the end of turn, and its entry ability
  can change everyone's (Drizzle, Sand Stream, Cloud Nine, Unnerve, Neutralizing Gas…).
- A Pokémon knocked out during the moves is replaced only after the turn: its slot is empty through the residual (E4, E6b: the
  trap ends silently, no Leech Seed drain into its slot).

### 1.5 Arithmetic (shared with 1v1, already validated there)
- Damage: `spreadDamage` floors and clamps to ≥ 1 before and after the Damage event (`PS/sim/battle.ts:2118-2131`), then
  `target.damage` caps at the current HP. Heatproof halves burn after the first clamp (1v1's `max(1, floor(floor(max/16)/2))`).
  Bad poison: `clampIntRange(baseMaxhp/16, 1) × stage`, stage += 1 first (max 15) (`PS/data/conditions.ts:154-160`; F3: stage 3
  carried → 4 × 14 = 56).
- Heal: `trunc`, ≥ 1, then the TryHeal event (`PS/sim/battle.ts:2261-2273`): Big Root ×5324/4096 on Leech Seed, Ingrain and Aqua
  Ring (`PS/data/items.ts:482`; E23: 22 → 29, 19 → 25), Liquid Ooze turns a Leech Seed heal into the same damage (E24), Heal Block
  returns false (`PS/data/moves.ts` healblock onTryHeal, after line 8274). No heal at full HP or 0 HP.
- Every residual divides the **base** maximum HP (Dynamax HP is not used: `dyna.ts`, Snorlax at 470 takes 14 = 235/16).

---

## 2. The residual table (pinned Showdown, four games)

Order.subOrder as Showdown sorts them (`inventory.out`). "Who" is the handler's holder (its Speed sorts it). Column **2v2**:
**M** modelled exactly, **S** state only (no HP; applied for E2 builds/facts), **G** end of turn not estimated when it acts,
**—** no effect this turn / not reachable in the four games.

| Key | Handler (who) | Effect | 2v2 | Source / probe |
|---|---|---|---|---|
| 1 (field) | Weather: sand, hail damage 1/16; Ice Body +1/16 (hail, snow); Rain Dish +1/16, Dry Skin +1/8 (rain); Dry Skin, Solar Power −1/8 (sun); each Pokémon in Speed order; then **Update** | HP, berries | M | conditions.ts:505-746; abilities.ts dryskin 1098, icebody 1955, raindish 3759, solarpower 4396; E7, E30, E36, F7 |
| 1 (field), duration | A weather with 1 turn left ends here with no effect | — | M (with `fieldTurns`) | battle.ts:515-521; E11 |
| 3 (slot) | Future Sight / Doom Desire landing | damage calc | G (carried only) | conditions.ts:389-417 |
| 4 (slot) | Wish from last turn heals `hp` (half the wisher's max) on the slot's Pokémon (not fainted) | HP | M (carried only) | moves.ts:20934-20945; F4 |
| 5.1 (side → each active) | G-Max Vine Lash/Wildfire/Cannonade/Volcalith 1/6 to non-type Pokémon (SwSh) | HP | M | moves.ts:7486 etc.; E35 |
| 5.1 | Fire Pledge's sea of fire | HP | — (pledge combos are presence-guarded) | moves.ts:5428 |
| 5.2 (field → each active) | Grassy Terrain +1/16, grounded and not semi-invulnerable | HP | M | moves.ts:7712-7720; E1, E16, E22 |
| 5.3 (ability) | Healer: each adjacent ally with a status, **Champions 1/2**, others 3/10 → cured | status | M (branch) | abilities.ts:1818-1829; mods/champions/abilities.ts healer; E9, E9b, E31 |
| 5.3 (ability) | Hydration: cured in rain / heavy rain (not under Umbrella, Cloud Nine) | status | M | abilities.ts:1926-1934 |
| 5.3 (ability) | Shed Skin: 33/100 → cured | status | M (branch) | abilities.ts:4188-4196; E21 |
| 5.4 (item) | Leftovers +1/16; Black Sludge +1/16 (Poison) / −1/8 | HP | M | items.ts:3340, 544; F5 |
| 6 (volatile) | Aqua Ring +1/16 (Big Root) | HP | M | moves.ts:480; E34 |
| 7 (volatile) | Ingrain +1/16 (Big Root) | HP | M | moves.ts:9624; E34 |
| 8 (volatile) | Leech Seed: −1/8 (capped at HP) from the seeded, healed into the Pokémon at `sourceSlot` if it has HP; Big Root, Liquid Ooze, Magic Guard | HP ×2 | M (joint) | moves.ts:10217-10226; E3, E4, E5, E23, E24, E29 |
| 9 (status) | Poison −1/8; bad poison −n/16 (n = stage+1 ≤ 15); Poison Heal +1/8 instead | HP | M | conditions.ts:133-160; abilities.ts:3331; E15, F3 |
| 10 (status) | Burn −1/16 (Heatproof 1/32) | HP | M | conditions.ts:15-18; abilities.ts:1833 |
| 11 (volatile) | Nightmare −1/4 while asleep (only where the game has it: Past in the gen 9 data) | HP | M | moves.ts:12716 |
| 12 (volatile) | Curse −1/4 | HP | M | moves.ts:3299; E19 |
| 13 (volatile) | Partial trap −1/8 (Binding Band 1/6) while its source is active with HP (G-Max Centiferno/Sandblast: always) | HP | M | conditions.ts:221-252; E6, E6b, E33, F1 |
| 13 (volatile) | Salt Cure −1/8 (Water/Steel 1/4); **Champions −1/16 (1/8)** | HP | M | moves.ts:15647; mods/champions/moves.ts saltcure; E10 |
| 14 (volatile) | Octolock Def/SpD −1; Syrup Bomb Speed −1 (while the source is active) | stages | S | moves.ts:12979, 18782 |
| 15–22 | Taunt, Encore, Disable, Magnet Rise, Telekinesis, Heal Block, Embargo, Throat Chop counters | none | — | inventory.out |
| 23 (volatile) | Yawn ends → `trySetStatus('slp')` (carried duration 1) | status | M (carried) | moves.ts:21153-21160; E13 |
| 24 (volatile) | Perish Song count; 0 → faint (carried 1) | faint | M (carried) | moves.ts:13268; E25 |
| 25 | Roost ends (Flying back) | type | S | moves.ts:15444 |
| 26.x (side) | Reflect, Light Screen, Safeguard, Mist, Tailwind, Lucky Chant, pledges, Aurora Veil, G-Max countdowns | none | — | inventory.out |
| 27.x (field) | Trick Room, Gravity, Water/Mud Sport, Wonder Room, Magic Room, terrains (27.7: **Grassy heals at 5.2 then ends**) | none | — (field changes after HP; see §3.2) | E11 |
| 28.1 (volatile) | Uproar upkeep | none | — | moves.ts:20237-20249 |
| 28.2 (ability) | Bad Dreams −1/8 on each sleeping / Comatose foe, holder with HP | HP | M | abilities.ts:321-331; E13, E27 |
| 28.2 (ability) | Harvest: sun/Desolate Land, else 1/2 → last Berry back (then eaten at the final Update if due) | item→HP | M (branch) | abilities.ts:1801-1812; E18, E38 |
| 28.2 (ability) | Speed Boost +1 Spe (activeTurns > 0) | stages | S | abilities.ts:4454; E14 |
| 28.2 (ability) | Moody +2 / −1, random (gen 9: 5 stats; gen 7: 7) | stages | S (E2 branch) | abilities.ts:2702; mods/gen7/abilities.ts moody; E20, F2 |
| 28.2 (ability) | Slow Start counter | state | S | abilities.ts:4316 |
| 28.2 (ability) | Cud Chew re-eats a Berry eaten **last** turn (counter 2 → 1 when eaten this turn) | HP | — (this turn) / G (carried) | abilities.ts:742-768 |
| 28.2 (ability) | Pickup: random adjacent item used this turn → its item | item→HP | G | abilities.ts:3263-3277 |
| 28.3 (item) | Sticky Barb −1/8 | HP | M | items.ts:6114; F5 |
| 28.3 (item) | Flame Orb / Toxic Orb → status (no damage this turn) | status | S | items.ts:2145, 6345; E28 |
| 29 (ability/item) | Zen Mode, Schooling, Shields Down (forms by HP line), Hunger Switch (form flip), Opportunist, Mirror Herb, White Herb, Eject Pack | form/stages | S (Eject Pack: fact) | inventory.out |
| 29 (ability) | Power Construct: Zygarde at half → Complete (max HP changes) | HP | G | abilities.ts:3385 |
| last (item) | Micle Berry eaten at ≤ 1/4 | item | S | items.ts:4076 |
| prio −100 | Dynamax turn count (ends in `endTurn` at 3) | HP | — (assumed this turn's Dynamax, §3.3) | conditions.ts:794; battle.ts:1629 |
| after | **Final Update** (berries); Emergency Exit / Wimp Out from above half to ≤ half | HP, switch | M (EE: fact) | battle.ts:2860-2866; E12, F6 |

---

## 3. Modelled vs still guarded

### 3.1 Modelled exactly (the end of turn is "ready")
Everything marked **M** and **S** in §2, with these details:
- Weather from before the turn (lasts unless `fieldTurns.weather === 1`) or set this turn; Cloud Nine/Air Lock from a Pokémon with
  HP at the weather handler; strong weathers; Utility Umbrella; Safety Goggles; Overcoat; Dig/Dive charge turn sheltered; the Update.
- Grassy Terrain (from before or set this turn, acts on its last turn); grounded per `PS/sim/pokemon.ts isGrounded`: Gravity,
  Ingrain, Smack Down, Iron Ball, Flying (not while Roosted), Levitate, Magnet Rise, Telekinesis, Air Balloon; not semi-invulnerable.
- Healer, Hydration, Shed Skin cures before poison/burn act; a cured Pokémon's status handler is skipped.
- Leech Seed couples the seeded and the source slot's Pokémon (joint HP), including faints within the residual.
- Burn, poison, bad poison (stage from `carried.toxic`, else 0), Poison Heal, Heatproof, Magic Guard.
- Salt Cure and partial traps set this turn by a damaging move (100% secondary for Salt Cure — Sheer Force removes it, Shield Dust
  and Covert Cloak stop it; move-level `volatileStatus` for traps, Binding Band from the trapper's working item) or carried.
- Curse, Nightmare, Ingrain, Aqua Ring, Yawn, Perish (set this turn by the status architect's moves, or carried).
- Wish (carried), Bad Dreams, Sticky Barb, Harvest, G-Max residual damage (SwSh).
- Faints (koChance, `faintedThisTurn`, Soul-Heart, a strong weather ending with its last holder, Unnerve/As One no longer stopping
  Berries at the next Update — `PS/sim/side.ts:389-394` `allies()` drops Pokémon with 0 HP, so a holder at 0 HP stops nothing at
  the weather's Update even before its faint message).
- Heal Block (Psychic Noise this turn, duration 2): residual heals give nothing; its healing Berries are not eaten (onTryEatItem).
- Facts only (no HP): Speed Boost, Moody, Octolock, Syrup Bomb, Toxic/Flame Orb, forms, Slow Start, Micle, Emergency Exit, Wimp
  Out and Eject Pack switching out after the turn, the weather/terrain ending (with `fieldTurns`).

### 3.2 End of turn not estimated (the moves stay estimated). Shown as `End of turn not estimated: {reason}`

| Trigger | Reason text |
|---|---|
| A Pokémon left during the moves with no later action (U-turn, Volt Switch, Flip Turn, Parting Shot, Teleport, Baton Pass, Shed Tail, Chilly Reception, Eject Button, Eject Pack, Red Card, Emergency Exit, Wimp Out, Dragon Tail, Circle Throw, Roar, Whirlwind) | `{Name} switches out: the replacement is not known.` (existing `REASONS.switchesOut`) |
| Future Sight or Doom Desire landing this turn (carried) | `{Move} landing is not modelled in 2v2.` (new `REASONS.landing`) |
| Neutralizing Gas's last holder faints in the residual while a Pokémon it suppressed is still in | `Neutralizing Gas ending is not modelled in 2v2.` (existing `REASONS.gasEnds`) |
| Pickup holder with no item and an adjacent Pokémon that used an item this turn | `Pickup is not modelled in 2v2.` |
| Cud Chew re-eating a Berry from last turn (carried) | `Cud Chew is not modelled in 2v2.` |
| Power Construct at half HP | `Power Construct is not modelled in 2v2.` |
| Receiver / Power of Alchemy on a residual faint; Symbiosis after a residual Berry; Opportunist / Mirror Herb copying a residual rise | existing reasons (`notIn2v2`, `copiesRise`) |
| The weather or terrain ends (`fieldTurns`) or a strong weather ends with its last holder in the residual while a field-settled ability or item is in (Protosynthesis, Quark Drive, Forecast, Mimicry, Flower Gift, Ice Face, a Seed, Booster Energy) | `A weather or terrain change this turn would change {X}.` (existing `REASONS.fieldChange`) |
| Over budget in the residual (§6.7) | `Too many cases to follow.` |

The moves-phase guards stay as they are; the switch-out marking (`World.leaving`) is new: today a switch-out with no later
action is silently allowed, and now it makes only the end of turn not estimated.

### 3.3 Assumptions (turn facts, shown only when they change a number)
- `Assumes bad poison's first turn of damage.` — a badly poisoned Pokémon takes bad poison damage this turn and the input gives
  no stage (only while Q2's control is absent, §13).
- `Assumes Dynamax started this turn.` — Sword/Shield, a Dynamaxed Pokémon in the turn (its Dynamax would otherwise end after this
  residual and its HP change back). Matches 1v1 `dynamaxTurns: 3` (`uses-to-ko.ts:902`).
- Removed: `End-of-turn effects are not applied.`

---

## 4. Randomness (every branch exact)

| Event | Showdown call | Branches and weights |
|---|---|---|
| Residual tie (equal order, priority, Speed, subOrder) | `prng.shuffle` in `speedSort` | k! orderings, 1/k! each — only when two tied handlers interact (§6.4); else one ordering |
| Weather per-Pokémon order | `speedSort` in `eachEvent` | never branched (no cross-Pokémon effect inside it) |
| Healer (per ally with a status) | `randomChance(1, 2)` Champions, `(3, 10)` others | cured / not |
| Shed Skin | `randomChance(33, 100)` | 0.33 / 0.67 |
| Harvest outside sun / Desolate Land | `randomChance(1, 2)` | back / not; in the sun no call (E38) |
| Moody | `sample(stats)` twice | uniform over the rise (≤ 5, gen 7 ≤ 7) then the drop among the rest: ≤ 20 (gen 7 ≤ 42) outcomes — **E2 only** (stages); calculateDoublesTurn records the fact and does not branch (no HP read follows) |
| Starf Berry eaten at an EOT Update | `sample(stats)` | E2 only, ≤ 5 outcomes; calc mode: fact |
| Sleep length from Yawn (Champions `sample([2,3,3])`, others `random(2,5)`) | at the status set | not branched (next turn only); E2 build gets `slp` |
| Partial trap duration `random(5,7)` (Grip Claw 8) | at trapping | not branched (this turn always damages: duration 5–6 → 4–5) |

The three walks (all / lowest / highest) each run the residual with these branches; low/high stay "most likely HP with every
roll lowest / highest" over everything else.

---

## 5. State carried

### 5.1 `MonState.eot` (doubles-world.ts) — the contract between the moves phase and the end of turn

```ts
/** What the end of turn reads (doubles-eot.ts), set by the moves phase or from DoublesPokemonInput.carried. Absent fields: none. */
export type EotState = {
  /** Bad poison's stage before this residual: carried.toxic ?? 0; a new "tox" status sets 0 (giveStatus). */
  toxic?: number;
  /** Leech Seed on it, draining into this slot (status architect: Leech Seed; carried). */
  leechSeed?: DoublesSlotId;
  /** A partial trap on it (this design: damaging moves; carried). source null: G-Max Centiferno/Sandblast (no source check). */
  trap?: { source: DoublesSlotId | null; divisor: 6 | 8 };
  saltCure?: true;                       // this design: Salt Cure's secondary; carried
  aquaRing?: true; ingrain?: true;       // status architect; carried
  curse?: true; nightmare?: true;        // status architect; carried
  octolock?: DoublesSlotId; syrupBomb?: DoublesSlotId;   // source slot (status architect / this design); carried
  /** Residuals until Yawn puts it to sleep: 2 when Yawn landed this turn (no sleep this turn), 1 when carried. */
  yawn?: number;
  /** Perish Song's duration before this residual: 4 when it landed this turn, carried 1–3 (1 faints now). */
  perish?: number;
  /** Roost this turn (status architect): not Flying until order 25 (grounded for Grassy Terrain). */
  roosted?: true;
  /** Smack Down / Thousand Arrows, Magnet Rise, Telekinesis (grounding; status architect or this design for Smack Down). */
  smackedDown?: true; magnetRise?: true; telekinesis?: true;
  /** Heal Block from Psychic Noise this turn (this design: the 100% secondary) or a status move. */
  healBlock?: true;
  /** Charge turn: "sheltered" (Dig, Dive) or "semi" (Fly, Bounce, Phantom Force, Shadow Force) at the residual. */
  hidden?: "sheltered" | "semi";
  /** Harvest: the Berry it ate, flung or Natural-Gifted this turn (`lastItem`), or carried. */
  lastBerry?: string;
  /** It used an item this turn (`usedItemThisTurn`): Pickup's guard. */
  usedItem?: true;
  /** A Wish landing on its slot now: the HP (carried). */
  wish?: number;
};
// MonState gains:  eot: EotState;
// World gains:     leaving?: DoublesSlotId[];   // switched out during the moves with no later action (EOT guard)
```

`discreteKey` already JSON-serialises `mons`, so worlds that differ in `eot` never merge. Writers in the moves phase
(this design, doubles-turn.ts): `giveStatus` resets `toxic` on a new "tox"; `applyStep`/`afterHit` set `trap` (move-level
`volatileStatus: 'partiallytrapped'`, target with HP, not already trapped), `saltCure`/`syrupBomb` (100% secondaries:
`secondaryLands`), `healBlock` (Psychic Noise — today `VOLATILE_SECONDARY_MOVES` guards it only with a later action; with the end
of turn it is followed instead), `smackedDown`; `chargeTurn` sets `hidden`; `ateBerry`/the Fling and Natural Gift paths set
`lastBerry`; any `useItem`/`eatItem` sets `usedItem`; the switch moves, Eject Button/Pack, Red Card, Emergency Exit/Wimp Out and the
drag moves push `w.leaving` when no later action follows (today they return silently). The status architect's moves set
`leechSeed` (on the target, value = user's slot), `aquaRing`, `ingrain`, `curse`, `nightmare`, `octolock`, `yawn: 2`, `perish: 4`,
`roosted`, `magnetRise`, `telekinesis`, `healBlock`.

### 5.2 Inputs (doubles-types.ts) — optional, so every current caller is unchanged

```ts
/**
 * End-of-turn state a Pokémon brings into the turn from earlier turns. The calculator sets only `toxic` (Q2); Training's bridge
 * sets what its belief battle holds. Pinned Showdown names in brackets.
 */
export type DoublesCarried = {
  /** Bad poison's stage [tox statusState.stage] 0–15, read with status "tox"; absent 0. */
  toxic?: number;
  /** Leech Seed on it, healing the Pokémon in this slot [leechseed sourceSlot]. */
  leechSeed?: DoublesSlotId;
  /** A partial trap [partiallytrapped]: the trapper's slot (null for G-Max Centiferno/Sandblast) and Binding Band (1/6). */
  trap?: { source: DoublesSlotId | null; bindingBand: boolean };
  saltCure?: true; aquaRing?: true; ingrain?: true; curse?: true; nightmare?: true;
  octolock?: DoublesSlotId; syrupBomb?: DoublesSlotId;
  /** Yawn's duration before this turn's countdown [yawn duration]: 1 falls asleep at this end of turn. */
  yawn?: number;
  /** Perish Song's duration before this turn's countdown [perishsong duration]: 1 faints at this end of turn. */
  perish?: number;
  /** A Wish landing on this slot at this end of turn: its HP [wish slot condition hp]. */
  wish?: number;
  /** Future Sight or Doom Desire landing on this slot at this end of turn [futuremove] (end of turn not estimated). */
  futureMove?: string;
  /** Harvest: the Berry it last used [lastItem]. */
  lastBerry?: string;
  /** Cud Chew: a Berry it eats again at this end of turn [cudchew counter 1] (end of turn not estimated). */
  cudChew?: string;
};
// DoublesPokemonInput gains:  carried?: DoublesCarried;
// DoublesTurnInput gains:
/** Turns left before this turn's countdown [weatherState.duration, terrainState.duration]; absent: lasts through the turn. */
fieldTurns?: { weather?: number; terrain?: number };
```

`validate()` adds issues for impossible carried state (toxic without "tox", a Leech Seed source that is empty or on its own side,
yawn/perish outside 1–4, a trap source that is its ally — `{Name}: …` facts, never a crash).

---

## 6. Engine changes

### 6.1 Shared residual rules — `app/lib/battle/residuals.ts` (new, pure, no engine imports)

```ts
export type ResidualKey = { order: number; subOrder: number; priority?: number };
/** One Pokémon as the end of turn reads it (both engines build it from their own state). */
export type ResidualMon = {
  baseMaxHP: number; types: readonly string[];
  /** Ability in effect ("" when suppressed); item when it works ("" under Klutz, Magic Room, Embargo). */
  ability: string; item: string;
  status: BattleStatus; toxic: number; grounded: boolean; hidden?: "sheltered" | "semi";
  saltCure?: boolean; aquaRing?: boolean; ingrain?: boolean; curse?: boolean; nightmare?: boolean; trapDivisor?: 6 | 8;
};
export type ResidualId = "sandstorm" | "hail" | "icebody" | "raindish" | "dryskin" | "solarpower" | "grassyterrain" | "leftovers"
  | "blacksludge" | "aquaring" | "ingrain" | "poisonheal" | "psn" | "tox" | "brn" | "nightmare" | "curse" | "partiallytrapped"
  | "saltcure" | "baddreams" | "stickybarb";
export type OwnResidual = ResidualKey & { id: ResidualId; amount: number };   // + heal / − damage, before the HP cap
/** The weather handler's part for one Pokémon (order 1): what it takes or regains, in the handler's own order. */
export function weatherResiduals(mon: ResidualMon, weather: Weather): OwnResidual[];
/** Every residual of the Pokémon on itself, sorted by key: weather (1), Grassy (5.2), Leftovers/Black Sludge (5.4), Aqua Ring (6),
 *  Ingrain (7), poison/Poison Heal (9), burn (10), Nightmare (11), Curse (12), trap and Salt Cure (13), Sticky Barb (28.3). */
export function ownResiduals(mon: ResidualMon, field: { weather: Weather; terrain: Terrain; champions: boolean }): OwnResidual[];
/** Bad Dreams' damage to one sleeping foe (28.2), 0 when it is immune (Magic Guard). */
export function badDreamsDamage(target: ResidualMon): number;
/** The table every handler's key comes from (tests/source checks it against pinned Showdown, §11.3). */
export const RESIDUAL_KEYS: Readonly<Record<string, ResidualKey>>;
```

The 1v1 `UsesSearch.residuals(state, who, charging)` (`uses-to-ko.ts:3577-3615`) becomes an adapter: it builds `ResidualMon` from
its `Side` (status passed as "" when `hydrated()`, `weather = endWeather(state)`, `hidden` from `charging`), calls `ownResiduals`,
inserts Bad Dreams from the other side, and converts to its `{ ops, names, orders }` with `UPDATE` after the weather ops and at the
end — the same arrays as today. Its walker (`TurnPlan`, `attackerTurn`, `fallOrder`, `afterTurn`) is 1v1-specific (one target HP
distribution with a followed attacker) and stays. The 1v1 texts ("Sandstorm damages", "its burn damages"…) move to a
`RESIDUAL_PHRASES` map keyed by `ResidualId` in uses-to-ko.ts. **Gate:** `golden-1v1.full.json.gz` byte-equal and every
`calculator-uses-to-ko*` test unchanged. Berry arithmetic stays shared through `hit-loop.ts` (`berryArithmetic`, `eatBerry`).

### 6.2 `app/lib/battle/doubles-eot.ts` (new) — the residual phase on worlds

`doubles-turn.ts` builds a `DoublesKernel` (closures over its `Ctx`: `alive`, `faint`, `speedOf`, `typesOf`, `grounded` (extended
with `eot` flags), `itemWorks`, `berryDue`, `ateBerry`, `pouchHeal`, `berryStopped`, `giveStatus`/`canSleep` (status architect's
sleep check), `selfBoost`, names, `ctx.hp`, mode, stats) and calls `endOfTurn(kernel, worlds)` after `walk()` in
`calculateDoublesTurn` (all three walks) and `calculateDoublesOutcomes`. It returns the worlds after the turn or throws
`EndNotEstimated(reason)` (a `NotEstimated` thrown inside the phase is caught and converted, so moves-phase helpers keep their guards).

Per world:
1. **Guards before**: `w.leaving` → `switchesOut`; any `eot.wish`/carried `futureMove`/`cudChew`/Pickup trigger per §3.2.
2. **Speeds**: `speedOf(ctx, w, slot)` for each slot with HP (Trick Room, Tailwind, paralysis, stages, Unburden, items, as the
   moves left them). Field/side holders: 0.
3. **Handlers**: for each present, non-fainted slot, `ownResiduals` (per-slot amounts) wrapped as handlers re-reading the world at
   run time (status still there? item still works? holder still not fainted?), plus the cross handlers: Wish (4, slot condition: runs
   even for a fainted holder but heals nothing then), G-Max side (5.1, SwSh), Healer (5.3), Hydration/Shed Skin (5.3), Leech Seed
   (8), trap source check (13), Octolock/Syrup Bomb (14), Yawn (23), Perish (24), Bad Dreams (28.2), Harvest (28.2), Speed Boost /
   Moody / Slow Start (28.2), Orbs (28.3), forms / Hunger Switch / White Herb / Eject Pack (29), Micle (last). The weather is one
   handler at order 1 (its per-Pokémon part in Speed order, then the Update).
4. **Sort and group** by `(order, −priority, −speed, subOrder)`; a group of equal keys is a tie (§6.4).
5. **Run** each handler on every current world; after each handler, **faint resolution** (§6.3); after the weather handler and at the
   end, **Update** (§6.5); merge equal worlds (`mergeWorlds`, mixtures in "all" mode); budget check (§6.7).
6. **After the final Update**: Emergency Exit / Wimp Out facts (HP at the residual's start above half, now ≤ half, with HP), Eject
   Pack fact; E2 extras (§6.6).

Each HP handler is a `mapHP` (one slot) or a joint map (Leech Seed). New world helper `mapJoint(w, [a, b], (ha, hb) => [ha', hb'])`
in doubles-world.ts: `join` the two factors, rewrite the table, `splitFactor` the result (exact independence test as today).
- Damage op `d`: `hp' = hp > 0 ? max(0, hp − d) : hp`. Heal op `h`: `hp' = hp > 0 && hp < max ? min(max, hp + h) : hp`; 0 under
  Heal Block. Bad poison reads `eot.toxic` then stores `toxic + 1` (≤ 15) — also when Magic Guard stops the damage.
- Leech Seed X → S: skipped if S's slot is empty or S fainted; `drained = min(hpX, d)` per joint entry, S healed by
  `bigRoot(drained)` (or damaged by it, Liquid Ooze on X), nothing when X has Magic Guard.
- Trap: condition on the source having HP (`condition(w, source, hp > 0)`); in the 0-HP part the trap ends (`eot.trap` cleared).
- Bad Dreams: condition on the holder's HP > 0, then each sleeping/Comatose foe with HP takes `badDreamsDamage`.
- Healer: per adjacent ally with HP and a status: two worlds (cured with the chance; `pouchHeal` not involved). Hydration: cure.
  Shed Skin: two worlds.
- Yawn (1 left): the status architect's `canSleep` (Electric/Misty Terrain grounded, Insomnia/Vital Spirit/Sweet Veil/Comatose/
  Purifying Salt/Leaf Guard in sun/Flower Veil..., an Uproar in progress, an existing status) → `slp`.
- Perish (1 left): HP → 0 (faint), `koChance` attributed to Perish Song.
- Harvest: holder with HP, no item, `eot.lastBerry` a Berry: certain in sun/Desolate Land (field weather, Cloud Nine respected),
  else two worlds; the restored Berry is eaten at the final Update when due.

### 6.3 Faint resolution (Showdown's `faintMessages` after each handler)
After a handler, every slot whose marginal now holds both 0 and positive HP is split with `condition(w, slot, hp > 0)`; the 0 part
runs the existing `faint(ctx, w, slot)` (side `faintedThisTurn`, Soul-Heart, strong weather end, Receiver/Power of Alchemy guard,
gas end guard → EndNotEstimated). A slot entirely at 0 faints without a split. **Optimisation the builder may add** (same results,
checked by `DOUBLES_REFERENCE` and the oracle): skip the split when nothing later reads that slot's life (no later handler with it
as Leech Seed source, Bad Dreams/Healer holder, trap/Octolock/Syrup source, Unnerve/As One/Neutralizing Gas/strong-weather holder,
and no E2 outcome) — the final KO mass is the same either way.

### 6.4 Ties
Two handlers in a tie group **commute** when neither writes what the other reads or writes. Reads/writes per handler:
own-HP handler on X: writes X.hp (and X's life); Leech Seed X→S: reads X, S life; writes X.hp, S.hp; Bad Dreams H: reads H life,
foes' status; writes foes' hp; Healer H: reads H life, ally status; writes ally status; trap on X from T: reads T life; writes X.hp;
cures/Yawn/Orbs on X: write X.status; stages: write X.stages; Harvest X: reads field weather; writes X.item. A group that
commutes runs once in Showdown order of slots (DOUBLES_SLOTS); otherwise every permutation runs as its own world with mass/k!
(k ≤ 4 Pokémon → ≤ 24), and `mergeWorlds` collapses equal results. Exact either way; commuting only saves work. Probe E29 is the
non-commuting case.

### 6.5 Updates
`updateAll(w, holdersAt0)`: each slot with HP, in Speed order (independent of each other), `berryDue` (HP/pinch Berries at or under
their line, curing Berries for the current status — e.g. Lum after Yawn's sleep or a Toxic Orb, Cheek Pouch, Ripen, Gluttony),
with Unnerve/As One read from foes **with HP** (`PS/sim/side.ts:389-394`), not merely not fainted. Run after the weather handler
when it called `eachEvent('Weather')` (rain/sun/strong weathers always; sand/hail/snow only unsuppressed; not when the weather
ended at this residual) and once at the end (after faints, `PS/sim/battle.ts:2843-2860`).

### 6.6 E2 extras (calculateDoublesOutcomes only; no HP effect)
Moody (branch per §4), Starf at an EOT Update (branch), Speed Boost, Octolock/Syrup Bomb drops (with Mirror Armor/Clear Amulet/White
Herb via `foeDrop`), Orbs' status, forms by HP line (Zen Mode, Schooling, Shields Down: `condition` on the line), Hunger Switch,
Slow Start counter, Micle eaten, toxic stage advanced, `eot` counters not needed by Training (yawn/perish advance are only for facts).
Applied at the end of the phase, after HP; `mergeOutcomes` merges equal builds. calculateDoublesTurn skips the branching ones and
keeps the facts.

### 6.7 Budgets and performance
- The phase reuses `BUDGET.worlds` (1 500) and `BUDGET.entries` (200 000), checked after each handler group's merge; tie
  permutations ≤ 24 per group; over budget → `EndNotEstimated("Too many cases to follow.")` (moves result kept). No new damage
  calculations (`BUDGET.calculations` untouched): every residual amount is arithmetic.
- `DOUBLES_REFERENCE.on`: no splitting/merging/commuting shortcuts (always permute ties), so `doubles-turn-reference.test.ts` can
  compare.
- Targets (bench.ts): unchanged SPEC §9 limits (turn p50 ≤ 30 ms, p95 ≤ 120 ms, any case ≤ 400 ms); expected cost < 1 ms p50 over
  today's 3.3 ms. Training: decision p95 within +10% of 576 ms (E2 grows by the residual; Training saves a sim residual pass per
  applied decision).

### 6.8 doubles-turn.ts edits (list)
- `startWorld`: `eot` from `input.pokemon[slot].carried` (+ `toxic` 0 default); `fieldTurns` into the Ctx.
- `giveStatus` ("tox" → `toxic: 0`); `afterHit`/`applyStep`/`spreadStep`: traps, Salt Cure, Syrup Bomb, Psychic Noise heal block,
  Smack Down; `chargeTurn`: `hidden`; `ateBerry` and Fling/Natural Gift: `lastBerry`, `usedItem`; `statusMove`/`eventGuards`/
  drag paths: push `w.leaving` when no later action follows.
- `volatileGuard`: Psychic Noise no longer guarded (followed); `NO_EFFECT_MOVES` loses `leechseed` (status architect models it).
- `turnFacts`: drop `End-of-turn effects are not applied.`; add §3.3 assumptions.
- `calculateDoublesTurn`: run `endOfTurn` on the three finished walks; build `endOfTurn` (hp via `distributions`/`modeOf` as today,
  residual entries from the "all" walk's statistics); `try/catch EndNotEstimated` → `{ status: "not-estimated", reason }`.
- `calculateDoublesOutcomes`: same phase; outcomes from the residual's worlds; `endOfTurn: "applied" | { notEstimated }`.
- doubles-actions.ts: `REASONS.landing`, `RESIDUAL_GUARDED` (`pickup`, `cudchew`, `powerconstruct`), `TRAP_MOVES`,
  `SALT_CURE_MOVES`, `GMAX_RESIDUAL` (by G-Max name → immune type); `MODELLED_THIRD_PARTY` comment for Bad Dreams/Healer updated,
  `pickup` moved to guarded.

---

## 7. Contract (paste-ready additions to `app/lib/battle/doubles-types.ts`)

```ts
/** One end-of-turn effect on one Pokémon, in pinned Showdown's residual order (sim/battle.ts fieldEvent('Residual')). */
export type DoublesResidual = {
  slot: DoublesSlotId;
  /** The effect as the game names it: "Sandstorm", "Grassy Terrain", "Leftovers", "Burn", "Poison", "Bad poison", "Leech Seed",
   *  "Salt Cure", "Fire Spin", "Bad Dreams", "Healer", "Sitrus Berry", "Perish Song"... */
  effect: string;
  /** The other Pokémon in it: Leech Seed's seeded foe (on the healed Pokémon) or its seeder (on the seeded one), a Bad Dreams or Healer holder. */
  other?: DoublesSlotId;
  /** Share of the turn in which it acted on this Pokémon (changed its HP, status, stages or item). */
  chance: number;
  /** HP change where it acted (negative: damage); null when it changes no HP. */
  min: number | null;
  max: number | null;
  /** Share of the turn in which it knocked this Pokémon out. Hits' and residuals' KO chances add up to endOfTurn.hp koChance. */
  koChance: number;
  /** What else it did ("Cures its poison.", "Falls asleep.", "Speed +1.", "Switches out after the turn."), with chances. */
  facts: DoublesFact[];
};

export type DoublesEndOfTurn =
  | {
    status: "ready";
    /** HP after the whole turn, as DoublesHP (low/average/high, min/max, koChance); `heals` and `faintsBeforeMoving` as in `hp`. */
    hp: Record<DoublesSlotId, DoublesHP | null>;
    /** In the order they act (mean position over the turn's outcomes); empty when nothing acts. */
    residuals: DoublesResidual[];
    /** The field after the turn's countdowns when fieldTurns says so ("Sandstorm ends."). */
    facts: string[];
  }
  | { status: "not-estimated"; reason: string };

// DoublesTurnResult "ready" gains:   endOfTurn: DoublesEndOfTurn;
// (hp keeps "after the moves"; DoublesHP's doc comment says so; the card reads endOfTurn.hp when ready.)

// DoublesOutcomesResult "ready" gains:
/** "applied": outcomes are after the turn; otherwise after the moves, with the reason the end of turn is not estimated. */
endOfTurn: "applied" | { notEstimated: string };
```

Plus `DoublesCarried`, `DoublesPokemonInput.carried?`, `DoublesTurnInput.fieldTurns?` from §5.2. `DoublesOutcome`'s doc: "One
outcome after the turn (after the moves when endOfTurn is not applied)".

---

## 8. UI

- **Card** (`DoublesCard.tsx`, `doubles-format.ts`): HP source `turn.endOfTurn.status === "ready" ? endOfTurn.hp[slot] : turn.hp[slot]`;
  `cardHPLabel(point: "turn" | "moves" | null, …)` → `After the turn · Average estimate` / `After the moves · Average estimate`;
  screen-reader text `… HP after the turn, …`. KO chance shown is the after-turn one (`cardReached` also true when a residual can KO).
- **Turn panel** (`DoublesTurn.tsx`): after the move steps, a section `data-doubles-end` headed **End of turn** with an ordered list
  `data-doubles-residual={slot}` of `residualLine(entry, names)`:
  - `Sandstorm · Garchomp: −11 HP`; `Leftovers · Snorlax: +14 HP`; `Bad poison · Snorlax: −28 HP, KO 12.5%`;
  - `Leech Seed · Garchomp: −22 HP` / `Leech Seed · Venusaur: +22 HP` (`other` shown as `(from Garchomp)` on the healed one);
  - a range when it varies: `Burn · Charizard: −9 HP` vs `Sitrus Berry · Snorlax: +58 HP (50%)` (chance in brackets when < 1);
  - facts under the line (`Healer · Venusaur: cures its poison (50%)`, `Speed Boost · Blaziken: Speed +1`,
    `Emergency Exit · Golisopod: switches out after the turn (25%)`).
  - When not estimated: `End of turn not estimated: {reason}` (`data-doubles-end-not-estimated`) and the cards keep "After the moves".
  - Nothing acts: no section.
- `turnSummary` (aria-live) reads after-turn HP when ready.
- Turn facts list: as §3.3.
- 2v2 slot settings (Q2 default): a **Bad poison stage** select (0–15, default 0) shown when the slot's status is Badly poisoned,
  stored in doubles-prep.ts slot state → `carried.toxic` (2v2 only; the 1v1 build is untouched).
- 375 px: lines wrap (`wrap-anywhere`), no new columns.

---

## 9. Training

- **evaluate.ts** `postFromOutcome`: takes the result's `endOfTurn`; when `"applied"` the residual delta is 0 (outcome HP is final);
  otherwise today's delta from `services.residual()`. `engineTerms` passes it through; `residualOf()` is then called only when some
  world was not applied (it is already lazy), so most decisions skip the residual sim pass.
- **bridge.ts**: new `carriedOf(mon, battle, aiSide)` mapping the belief battle's state into `DoublesCarried`: `statusState.stage`
  (tox), `volatiles.leechseed.sourceSlot` → slot, `partiallytrapped` (source slot, `boundDivisor === 6`, G-Max source null),
  `saltcure`, `aquaring`, `ingrain`, `curse`, `nightmare`, `octolock`/`syrupbomb` source, `yawn.duration`, `perishsong.duration`,
  `lastItem` (Berry), `slotConditions.wish` (`hp`, landing when `turn > startingTurn`), `futuremove` (→ carried, guarded), Cud Chew
  pending (→ carried, guarded); `fieldTurns` from `field.weatherState.duration` / `terrainState.duration` (0 or strong weather:
  omitted). `IGNORED_VOLATILES` keeps only volatiles with no end-of-turn or HP effect this turn (charge, flashfire, unburden,
  slowstart, choicelock, lockedmove, encore, taunt, disable, torment, throatchop, healblock→mapped, trapped/trapper, stall,
  focusenergy, laserfocus, dragoncheer, imprison, protect, helpinghand, followme, ragepowder, endure, mustrecharge); the mapped ones
  move out; anything else stays a rollout reason. A trap whose remaining duration the AI cannot know (belief drew it) is exact per
  belief world, as today's prelude/rollout worlds are.
- **services.ts**: unchanged API; `residual()` stays as the fallback (and as the conformance reference).
- **conformance.ts**: gate 4b ("clean rollouts inside the E2 support") reads Showdown HP **after the residual's final Update** when
  every engine world of the cell reports `endOfTurn: "applied"` (new `postResidualHP`: wrap `runAction` for `'residual'`, read after
  it returns), else the current pre-residual HP. Gate 8 (E2 vs Showdown corpus) runs on the regenerated tests (§10.4). New
  informational row: share of engine cells with the end of turn applied.
- **leak.ts**: unchanged; the bridge reads only the belief battle, whose end-of-turn state comes from the public tracker
  (`tracker.ts:275-325, 368, 431, 734-804`: Wish, tox elapsed, perish, Leech Seed/Yawn sources, traps). Must still show 0 differences.
- **Gates**: vs RandomLegal ≥ 90%, vs MaxDamage ≥ 60% and self-play 50 ± 7 re-run; conformance + leak pass.

---

## 10. Oracle changes (scripts/.cache/calc-audit/2v2/verify)

1. **sim-dfs.ts** `runSegment`: on `action.choice === 'residual'` record `hp/max` (after the moves, as today), then **run** the
   residual (`ra.call(this, action)` — faints, `checkFainted`, final Update, Emergency Exit), record `hpAfterTurn`, the residual
   log lines (`|-damage|…|[from] X`, `|-heal|…|[from] X`, `[silent]` Leech Seed heals, `-curestatus`, `-status`, `faint`) and stop.
   A switch request after the residual (fainted with bench, Emergency Exit) is fine: HP is read before it.
2. `CHANCE_EFFECTS` += `healer`, `shedskin`, `harvest`; Moody/Starf/Pickup `sample` already enumerate; residual tie shuffles already
   enumerate (`prng.shuffle`). The sleep `sample([2,3,3])` from Yawn enumerates (same HP; merges by state).
3. **Case shape** (case-types.ts): `CaseMon.carried?: { toxic?, leechSeed?, trap?, saltCure?, aquaRing?, ingrain?, curse?, yawn?,
   perish?, wish?, … }` and `CaseField.turns?: { weather?, terrain? }`, applied in `prepare()` (`statusState.stage`, `addVolatile`
   with source, `volatiles.x.duration`, `side.addSlotCondition('wish')` with hp/startingTurn, `weatherState.duration`).
4. **OracleResult** gains per walk `afterTurn: Record<SlotId, SlotResult>` and `residuals: { slot, effect, other?, chance, min,
   max, ko }[]` (deltas parsed from the log per run, weighted), and `expectedAfterTurn` (low = lowest walk's modeTieUp, high =
   highest walk's modeTieDown, as today).
5. **compare.ts**: when `result.endOfTurn.status === "ready"`: compare `endOfTurn.hp` with `expectedAfterTurn` (same tolerances:
   1e-9 exhaustive), each residual entry (chance, min, max, koChance) with the oracle's; `END_FACT` no longer expected; cases with
   `endNotEstimated` check the reason and that `hp`/`steps` still match the after-the-moves oracle.
6. **gen-tests.ts**: emits `endOfTurn` expectations into `tests/unit/doubles-turn-showdown.test.ts` (and the E2 test).
7. **Re-run all 556 results**: after-the-moves fields must be byte-equal to today's files (regression), after-turn fields new.

---

## 11. Tests

### 11.1 New oracle cases (verify/cases.ts `R` series; Champions unless noted)

| Id | Setup | Checks |
|---|---|---|
| R01 | Sand, four Pokémon: Rock, Steel, Overcoat, Safety Goggles, Magic Guard, a plain one | immunities, 1/16, Update |
| R02 | USUM Hail: Ice Body, Snow Cloak, Ice type, plain | hail damage/heal |
| R03 | SV Snow: Ice Body | heal only |
| R04 | Rain: Rain Dish, Dry Skin, Hydration on a burned Pokémon, Umbrella + Dry Skin | heals, cure before burn |
| R05 | Sun: Solar Power, Dry Skin, Umbrella (F7); Harsh Sunshine variant | sun damage |
| R06 | Cloud Nine in (E36); Cloud Nine KO'd in the moves (weather acts) | suppression read at the residual |
| R07 | Sitrus at the weather's Update, then Leftovers (E7, E30) | Update after weather |
| R08 | Burn to below half → Sitrus at the final Update (E7b); poison then Salt Cure KOs before the Berry | no Update between |
| R09 | E1 and E2 (order 5 speed before subOrder; Trick Room) | residual list order |
| R10 | Grassy: Flying, Levitate, Air Balloon, Iron Ball, Gravity; Fly/Dig charge turn (E16) | grounding, semi-invulnerable, sheltered |
| R11 | Sandstorm + Grassy Terrain used this turn (E22) | field set this turn acts |
| R12 | Leftovers at full HP; Black Sludge both ways; Sticky Barb; Magic Guard holder (F5) | items |
| R13 | Burn (build), Heatproof, Magic Guard; burned Pokémon KO'd in the moves | burn |
| R14 | Poison; bad poison carried stage 3 (F3); Poison Heal (E15); Toxic Orb (E28) | poison family |
| R15 | Baneful Bunker / Burning Bulwark contact this turn | status from the moves acts |
| R16 | Leech Seed this turn (E3)*; source KO'd later (E4)*; source faints to sand (E5)*; two seeds + Big Root (E23); Liquid Ooze (E24)*; Magic Guard seeded | coupling |
| R17 | Mutual Leech Seed at equal Speed (E29) | tie branch 1/2 |
| R18 | Fire Spin this turn (E6), trapper KO'd (E6b), trapper faints to sand (E33), Ghost + Magic Guard (F1), Binding Band | traps |
| R19 | Salt Cure (E10) incl. Water/Steel; SV 1/8, 1/4 | Champions numbers |
| R20 | Ghost Curse this turn (E19)* | 1/4 |
| R21 | Ingrain + Aqua Ring this turn (E34)*, Big Root | heals |
| R22 | Healer Champions (E9), SV (E9b), holder faints to sand (E31) | branch 1/2, 3/10 |
| R23 | Shed Skin on a burned Pokémon (E21) | branch 0.33 |
| R24 | Harvest outside sun (E18), in sun (E38) | Berry back + eaten |
| R25 | Bad Dreams vs a sleeping (no move) foe and Comatose; holder faints first (E27) | 28.2 |
| R26 | Carried Yawn 1 → sleep → Bad Dreams (E13); Lum Berry then cures at the final Update | sleep at 23 |
| R27 | Carried perish 1 after Leftovers (E25) | faint at 24 |
| R28 | Carried Wish (F4) | heal at 4 |
| R29 | Speed Boost (E14) — E2 build | facts/E2 |
| R30 | Moody gen 9 (E20) and USUM (F2) — E2 outcome count 20 / 42 | E2 branch |
| R31 | Emergency Exit after burn (E12); Sitrus back above half (F6) | fact, final Update first |
| R32 | U-turn last (E17); Eject Button on the last hit; Emergency Exit in the last move | EOT not estimated, moves exact |
| R33 | Sand and Grassy with one turn left (E11) | `fieldTurns` |
| R34 | SwSh G-Max Wildfire (E35) | 1/6 |
| R35 | SwSh Dynamax this turn in sand (`dyna.ts`) | base max HP, no end, assumption fact |
| R36 | Psychic Noise then Leftovers / Grassy / Sitrus | Heal Block |
| R37 | Tailwind set this turn reorders the residual list (E32) | Speed after the moves |
| R38 | Unnerve holder KO'd by sand → foe's Sitrus at the weather's Update; by poison → at the final Update | Unnerve life read |
| R39 | Equal-Speed poisoned pair (E26) | commuting tie |
| R40 | Soul-Heart on a residual faint (E2 build) | faint side effects |
| R41 | Neutralizing Gas holder faints to poison with a suppressed Pokémon | EOT not estimated |
| R42 | Pickup next to a Sitrus eater | EOT not estimated |
| R43 | Leech Seed source slot empty (fainted before the turn) | no drain |
| R44 | Toxic this turn → 1/16* ; Will-O-Wisp → 1/16*; Spore + Bad Dreams* | status moves meet the end of turn |
| R45 | Strong weather holder faints in the residual + Harvest | weather end inside the residual |

\* needs the status architect's move (Leech Seed, Curse, Ingrain, Aqua Ring, Toxic, Will-O-Wisp, Spore); until it lands, the case
sets the volatile/status in `carried` / the build instead.

### 11.2 Unit tests (tests/unit)
- `residuals.test.ts` (new): `ownResiduals`/`weatherResiduals` amounts, immunities, keys for each id; Champions Salt Cure; Heatproof;
  bad poison stage clamp.
- `doubles-eot.test.ts` (new): invariants — (1) no residual acts ⇒ `endOfTurn.hp` equals `hp`; (2) per slot, Σ hit KO + Σ residual
  KO = `endOfTurn.hp.koChance` (within 1e-12; certain KO stays 1); (3) `DOUBLES_REFERENCE` gives the same `endOfTurn`;
  (4) E2 outcomes' HP mixture = `endOfTurn.hp` distribution; (5) an EOT guard keeps `status: "ready"`, `steps`, `hp`, and gives
  `endOfTurn.status: "not-estimated"` with the exact reason; (6) carried validation issues; (7) tie permutation only when interacting.
- `doubles-turn-showdown.test.ts`, `doubles-outcomes.test.ts`: regenerated with `endOfTurn` (gen-tests.ts).
- `doubles-turn-guards.test.ts`: switch-out marks, Pickup/Cud Chew/Future Sight/Power Construct reasons.
- 1v1: every `calculator-uses-to-ko*` test unchanged; `golden-1v1` byte-equal.
- UI (`calculator-doubles-ui.test.ts`): "After the turn" label; End of turn list lines (Leech Seed pair, KO, chance); not-estimated
  line keeps "After the moves"; turnSummary; Bad poison stage select (if Q2).
- Training: `training-ai-evaluate.test.ts` (applied ⇒ no residual delta; fallback unchanged), a bridge test (carried mapping,
  `fieldTurns`, rollout for unknown volatiles), conformance gate 4b reads post-residual HP.

### 11.3 Source tests (tests/source)
- `doubles-residuals.test.ts` (new): parses every residual handler of pinned Showdown (gen9 + champions + gen8 + gen7, as
  `inventory.ts` does) and requires each to be in exactly one of: modelled (`RESIDUAL_KEYS` with the same order/subOrder/priority),
  state-only, guarded, or not reachable in the four catalogs — a new handler in a future pin fails the test.
- `doubles-third-party.test.ts`: Bad Dreams/Healer modelled, Pickup guarded.

---

## 12. Build plan (disjoint ownership)

0. **Contract** (first, one owner): §7 + §5.2 into doubles-types.ts; `EotState`, `MonState.eot`, `World.leaving`, `mapJoint` stub in
   doubles-world.ts. The status architect's moves write against `EotState`.
1. **Shared rules + 1v1 adapter**: residuals.ts, uses-to-ko.ts adapter, residuals.test.ts, source test. Gate: golden byte-equal,
   uses tests.
2. **End-of-turn engine**: doubles-eot.ts, doubles-turn.ts edits (§6.8), doubles-actions.ts; unit tests. Depends on 0 (and on 1 for
   `ownResiduals`; may start with a local stub replaced at integration).
3. **Oracle**: sim-dfs.ts/case-types.ts/compare.ts/gen-tests.ts + R cases + re-run of 556. Parallel with 2.
4. **UI**: DoublesCard, DoublesTurn, doubles-format, doubles-prep (Bad poison stage), UI tests. Parallel (against the contract).
5. **Training**: bridge.ts, evaluate.ts, conformance.ts, Training tests. After 2.
6. Integrator: compare all (old 556 after-moves byte-equal, new after-turn all equal), `npm run check`, golden, bench, conformance +
   leak + eval gates, live check. Then reviewers, fixer.

---

## 13. Open questions for the user (each with the recommended default)

1. **What the card shows.** Default: HP after the whole turn on the card; the turn panel's End of turn list shows each change in
   order (the moves' damage stays in the move lines). Alternative: both numbers on the card.
2. **Bad poison counter.** Default: a 2v2-only "Bad poison stage" select (0–15) next to the Badly poisoned status. Alternative: no
   control, assume the first turn of damage with the fact `Assumes bad poison's first turn of damage.`
3. **Dynamax (Sword/Shield).** Default: assume it started this turn (fact `Assumes Dynamax started this turn.`); no turn select.
4. **Leech Seed, Salt Cure, traps, Yawn, Perish counts, Wish from earlier turns** in the calculator. Default: not inputs in this
   change (Training passes them; the calculator covers what this turn sets).

---

## 14. Risks
- **World growth** from faint splits and tie permutations: bounded by §6.7; the lazy-split optimisation in §6.3 if the bench needs it.
- **1v1 regression** during the residuals.ts extraction: golden-1v1 full corpus byte-equal is the gate; the adapter keeps
  hydration filtering and phrase strings exactly.
- **Status-architect drift**: `EotState` is the single contract; the R cases marked * fall back to `carried` until the moves exist.
- **Training belief vs real hidden state** (trap duration, sleep length): exact per belief world; conformance 4b measures it.
- **Switch-outs at the last action** become "end of turn not estimated" (today: estimated with no end of turn): a visible change
  for U-turn turns; the moves stay estimated and the card keeps "After the moves".
