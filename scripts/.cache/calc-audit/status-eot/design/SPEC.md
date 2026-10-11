# 2v2 status moves and end of turn: build spec (status-eot)

Branch `calc-2v2-status-eot`, cut from main `0ccce76`. This is the critic's synthesis of `status-move-architect.md` (the status design) and `eot-architect.md` (the EOT design), both in this folder. Ground truth is pinned Showdown `c23d2e94` (`node_modules/.cache/champions/pokemon-showdown-c23d2e94…`, cited below as `PS/…`). The runnable copy is `scripts/.cache/calc-audit/showdown`.

The user asked: "do the status moves and end of turn". That lifts the two v1 defaults from the 2v2 SPEC §11, "stop after the moves" and "status moves not estimated".

House rules, unchanged:
- a result is exact against Showdown, or it is "not estimated" with a short fact;
- facts only in the UI;
- 1v1 output stays byte-equal;
- every random event is branched exactly or guarded.

Generated companion: `spec-classify.ts` → `spec-classify.md`. It holds the per-move table for all 271 catalog Status moves, with each move's kind and its text for this turn or its guard. It fails if any catalog move is unclassified. §2.2 summarises it.

---

## 0. Decisions in one page

1. **Two levels of "not estimated".**
   - A moves-phase guard makes the whole turn not estimated, as today.
   - The end of turn has its own status: a ready turn gains `endOfTurn`, which is either `ready` (HP after the whole turn plus the residuals in Showdown order) or `not-estimated` with a reason.
   - `hp` keeps its meaning, "after the moves", so every current test and all 556 stored oracle results stay valid.
2. **Status moves.**
   - 122 are modelled exactly (M) and 6 are modelled under a condition (C).
   - 20 have no effect this turn (N), and are exact by doing nothing.
   - 7 are switch moves (S).
   - 76 are not modelled in this build (L). They keep today's behaviour: the turn is not estimated when a later living action follows. If one is the last action, only the end of turn is not estimated.
   - 1 is a presence guard (P), and 39 keep their current handling (X).
   - The cut keeps everything common in VGC: the major statuses, confusion, Taunt, stat-stage moves, heals, HP costs, Substitute vs status, Endure, Destiny Bond, After You, Quash, Safeguard, redirection and Magic Bounce. It defers the families that need new engine-wide machinery: positions (Ally Switch), item and ability changes, type changes, and party cures.
3. **The BeforeMove chain** runs in pinned priority order, with exact branches: sleep/freeze 10, flinch 8, Disable 7, Gravity/Throat Chop 6, Taunt 5, Imprison 4, confusion 3 (a 33/100 self-hit with exact 16-roll damage), paralysis 1, Destiny Bond −1. "No move" is Splash and runs the chain too.
4. **Statuses from before the turn are exact.**
   - Sleep, Champions freeze and confusion take an `attempts` count, and the engine uses the exact posterior hazard.
   - SV, SwSh and USUM freeze is memoryless (1/5).
   - The calculator gets compact 2v2-only counters (Q1). Training passes public counts from its tracker, never Showdown's hidden counters.
5. **One residual phase** runs on every finished world (all three walks and E2), in pinned `fieldEvent('Residual')` order: order, then priority, then Speed, then subOrder.
   - Ties are permuted exactly when they interact.
   - Faints resolve after every handler.
   - There is an Update after the weather and a final Update.
   - The per-Pokémon amounts live in a new pure `residuals.ts`. The 1v1 `UsesSearch.residuals()` becomes an adapter over it, gated by golden-1v1 staying byte-equal.
6. **UI.**
   - The card shows HP after the turn (`After the turn · …`) whenever the end of turn is ready.
   - The panel gains an End of turn list.
   - The fact `End-of-turn effects are not applied.` goes away.
7. **Training (Champions only, verified: `sim/bridge.ts` liveBuild returns null otherwise).**
   - E2 returns outcomes after the turn plus `endOfTurn: "applied" | { notEstimated }`. The residual pass is added only when the end of turn was not applied.
   - The bridge passes the carried state from the tracker's public counts.
   - Fewer cells go to rollouts.
8. **Oracle.**
   - `sim-dfs.ts` runs the residual action, records HP after the turn and the per-target status lines, and expands hidden counters by their exact posterior.
   - About 90 new cases are added.
   - All 556 stored results are re-run: their after-the-moves fields must be byte-equal.

---

## 1. Review of the two designs

### 1.1 Verified against code and pinned Showdown (kept)

**Residual sort and handler rules (`PS/sim/battle.ts`):**
- The residual sort is `comparePriority` at `:404-411`: order ascending, priority descending, speed descending, subOrder ascending, then effectOrder.
- effectOrder is set only for SwitchIn and RedirectTarget (`:993-1000`), so exact residual ties are shuffled (`speedSort`, `:429-458`).
- Handlers are collected and sorted once (`fieldEvent`, `:484-567`).
- A handler is skipped when its holder has fainted (unless it is a slot condition) or its effect state has been replaced.
- `faintMessages()` runs after every handler.
- The EOT design's §1 is correct.

**Speed:**
- The residual speed is `pokemon.speed`, from `updateSpeed()` at the residual start (`:2811-2817`) via `getActionSpeed()`.
- Trick Room uses `10000 − speed` with the 13-bit wrap (`PS/sim/pokemon.ts:641-649`).
- Champions uses `−speed` (`PS/data/mods/champions/scripts.ts:46-53`).
- Field and side holders have speed 0.

**Weather:**
- Rain, sun and the strong weathers always call `eachEvent('Weather')`.
- Sand, hail and snow do so only under `field.isWeather` (`PS/data/conditions.ts:506-746`).
- `eachEvent('Weather')` is followed by `eachEvent('Update')` in gen 7+ (`PS/sim/battle.ts:465-478`).
- The final Update and the Emergency Exit check come after the residual (`:2860-2866`).

**Status mechanics (`PS/data/conditions.ts`):**
- Sleep:
  - SV, SwSh and USUM: `random(2,5)` (`:61`).
  - Champions: `sample([2,3,3])` (`PS/data/mods/champions/conditions.ts:22-24`).
  - Early Bird decrements twice (`:66-70`).
  - The `attempts` posteriors match probe `status-probes-4.out` exactly: SV 0, 1/3, 1/2, 1; Champions 0, 1/3, 1; Early Bird 1/3, 1.
- Confusion:
  - `random(min 2 or 3 for Axe Kick, 6)` (`:173-174`).
  - Snap-out hazard 0, 1/4, 1/3, 1/2, 1.
  - Self-hit `randomChance(33,100)`.
  - Damage from `getConfusionDamage` (`PS/sim/battle-actions.ts:1850-1862`): stored Atk and Def with stages, Wonder Room swapping Def (`PS/sim/pokemon.ts:568-575`), a 16-bit wrap, and the randomizer.
  - Unaware does nothing, since its holder returns early on itself (`PS/data/abilities.ts:5214-5229`).
- Champions freeze: start 3, `time--`, thaws at ≤ 0 or with 1/4 (`mods/champions/conditions.ts:31-55`).
- Champions paralysis: 1/8.

**Pipeline order:**
- `trySpreadMoveHit` steps are invulnerability, TryHit, type immunity (status moves ignore it unless `ignoreImmunity: false`), TryImmunity (powder, the move's own, Prankster vs Dark), accuracy, and so on (`PS/sim/battle-actions.ts:550-689`).
- `runMoveEffects` order is boosts, heal, status, forceStatus, volatileStatus, side, slot, weather, terrain, pseudoWeather, forceSwitch, then onHit (`:1186-1316`).

**Status-move numbers:** heal formulas, Pain Split, Strength Sap, Belly Drum, Fillet Away, Substitute, Rest, Memento, Destiny Bond, Wish and Leech Seed, from the status design's §1 probes and spot checks of `PS/data/moves.ts`.

**Already in the tracker:** the public counts Training needs exist in `app/(app)/training/sim/tracker.ts`:
- `statusElapsed` counts `cant slp|frz` lines and toxic ticks (`:566`, `:432`);
- confusion `elapsed` counts `-activate confusion` (`:770`);
- `lastMove` and `lastMoveTarget` (`:399-400`);
- Leech Seed and Yawn `sourceKey` (`:747`);
- perish and stockpile layers.

### 1.2 Corrections (the spec uses these)

| # | Design | Claim | Pinned truth |
|---|---|---|---|
| C1 | status | Clangorous Soul costs `floor(maxhp/3)` | `directDamage(pokemon.maxhp * 33 / 100)`, which floors (`clampIntRange`, `PS/sim/battle.ts:2215`), and fails at `hp <= maxhp*33/100` (`PS/data/moves.ts` clangoroussoul onTry). |
| C2 | status | Endure acts "after Sturdy and Sash" | Endure `onDamagePriority −10` runs **before** False Swipe (−20), Sturdy (−30) and Focus Sash (−40) (`PS/data/moves.ts:4828`, `PS/data/abilities.ts:4680`, `PS/data/items.ts:2255`). With Endure up, Sturdy never activates and the Sash is **not** used. |
| C3 | status | Laser Focus is C, Focus Energy and Charge change this turn's crits/damage | Each acts on its **user's** later moves. The user has one action, so they change nothing this turn (Instruct and Dancer stay guarded). Laser Focus is N. Focus Energy and Charge change only the E2 build, plus Charge's Sp. Def +1. |
| C4 | status | Ghost Curse targets a random foe | `target: "normal"`: the chosen foe. Aimed at its ally, it goes to a random foe (onModifyMove). The user's cost is directDamage and can faint it. |
| C5 | status | No move "rolls exactly as in Showdown" (unqualified) | It does, as Splash, and Splash has the `gravity` flag. Gravity (BeforeMove 6) and Taunt (5, a status move) stop it **before** confusion (3): a confused No-move Pokémon under Gravity or Taunt never hurts itself. Today's `berryConfusion` skips No-move holders, a latent divergence this model fixes. |
| C6 | status | Missing | Prankster status moves meet Dazzling, Queenly Majesty and Armor Tail in TryMove (`PS/data/abilities.ts:864-877` onFoeTryMove). `foeSide` moves pass, and so do `all` moves except Perish Song, Flower Shield and Rototiller. Existing `moveFailure` covers damaging moves only; it must run for status moves too. Armor Tail is common in VGC. |
| C7 | status | eventGuards' Emergency Exit / Wimp Out check after any action | Emergency Exit is triggered only from damaging-move paths (`PS/sim/battle-actions.ts:530,542,1015,1132,1395`) and after the residual (`PS/sim/battle.ts:2861-2866`). A status-move HP change (Belly Drum, Pain Split, Substitute) or a confusion self-hit never triggers it. The check must not guard those. |
| C8 | status | Training needs `carried.taunt/disabled/imprisoning/encore` | Showdown's requests already forbid the choices they block (onDisableMove, onFoeDisableMove, Encore's forced move). Only effects that land **this** turn matter, and the engine follows them. These carried fields are cut. |
| C9 | EOT | Tied handlers on the same Pokémon commute | They commute for HP but not for which residual is credited with the KO. Partial trap + Salt Cure (both order 13, Condition subOrder 2, same holder) tie and are shuffled. Since `DoublesResidual.koChance` is per handler, such ties are permuted. |
| C10 | EOT | `fieldTurns` absent = "lasts", silently | The weather's duration ticks before it acts (`fieldEvent` duration check). If the calculator does not know the turns left, it must say so: turn fact `Assumes the {Weather} does not end this turn.` The terrain heal (5.2) comes before the terrain's own countdown (27.7), so the terrain needs no input. |
| C11 | EOT | Champions note "uses −speed instead" | Correct. Field and side holders (speed 0) then sort ahead of Pokémon at the same order under Champions Trick Room. Only the weather is order 1, so nothing changes. |
| C12 | both | Heal Block carried is fine | `healblock` is in `IGNORED_VOLATILES` today, a latent error (Sitrus and drain heals are modelled while blocked). With the end of turn applied, it would also mis-heal Leftovers and Grassy Terrain. The bridge makes a carried `healblock` a rollout. A Psychic Noise this turn as the last action is followed by the end of turn (`EotState.healBlock`). |
| C13 | status | DoublesCarried with substitute HP | Substitute HP is hidden from the opponent. Training keeps `substitute` as a rollout, as today. The calculator has no Substitute input, so a Substitute exists only when it was made this turn. |
| C14 | EOT | 1v1 adapter emits the shared keys | The 1v1 `orders` are coarse integers (1, 5, 9, 10, 13, 28) used by its walker. The adapter maps the exact key to `Math.floor(order)` and keeps names and UPDATE positions, for golden byte-equality. |

### 1.3 Conflicts resolved

- **`EotState` vs `MoveVolatiles`.** Both stay, as separate fields of `MonState` (`eot`, `vol`) with one writer per field (§3.4). Shared helpers have one owner each: Track A owns `canStatus`, `applyBoosts`, `healSlot` and `lossDist`; Track B owns `updateAll`, `mapJoint` and the residual code. Step 0 writes their signatures as stubs.
- **E2 volatiles shape.** The status design's `DoublesVolatiles` object is replaced by what Training's value function reads (`app/(app)/training/ai/value.ts:144-156`, `PostMon`): `volatiles: string[]` (Showdown ids), plus `sleepTurns` and `perishCount`.
- **`fieldTurns` → `weatherTurns`.** Only the weather's countdown changes HP this turn (C10). Terrain, rooms, screens and Tailwind countdowns stay with Training's `nextClock`.
- **Positions.** Ally Switch is cut (L), so `World.swapped`, `occupant()` and position-keyed Leech Seed and Wish are not built. Slots are positions.
- **Moody, Starf at an end-of-turn Update, Harvest, Pickup, Cud Chew, Power Construct and the HP-line forms, G-Max residual damage:** guarded at the end-of-turn level (§2.3). The EOT design modelled several of them, but they are rare and each needs its own branching or form plumbing.
- **Instruct, Spotlight, Revival Blessing:** presence guards, as today.

---

## 2. Scope

### 2.1 Product

- **2v2 turn.** The steps, each Pokémon a status move reaches with what it did (hit kind `effect`, its HP change, its facts), and why moves were skipped (sleep, freeze, confusion, Taunt, Disable, Imprison).
- **End of turn.** Every residual in Showdown order, with HP changes and KO chances. The card shows HP after the turn.
- **State from earlier turns.** In the calculator: turns lost to sleep (and Rest), turns lost to freeze (Champions), confusion and its turns, and the bad poison stage (Q1). In Training: all the carried state in §3.1.
- **1v1:** unchanged.

### 2.2 Status moves (exact list: `spec-classify.md`)

- **M (122):**
  - Major status: darkvoid, grasswhistle, hypnosis, lovelykiss, sing, sleeppowder, spore, yawn, thunderwave, glare, stunspore, willowisp, toxic, poisonpowder, poisongas, toxicthread.
  - Confusion: confuseray, supersonic, sweetkiss, teeterdance, swagger, flatter.
  - Stages: every pure boost and drop move, including the accuracy and evasion drops, and haze.
  - Heals: recover family, moonlight family, shoreup, healpulse, floralhealing, lifedew, junglehealing, lunarblessing, strengthsap, painsplit, rest, wish.
  - Costs: bellydrum, filletaway, clangoroussoul, curse, substitute.
  - Faint: memento, healingwish, lunardance, destinybond.
  - Order: afteryou, quash.
  - Side: safeguard, endure.
  - Volatiles: taunt, yawn, leechseed, aquaring, perishsong, charge, focusenergy, dragoncheer.
  - Cures: refresh, takeheart.

  Full M list:
  `acidarmor afteryou agility amnesia aquaring aromaticmist babydolleyes barrier bulkup calmmind charge charm coaching coil confide confuseray cosmicpower cottonguard cottonspore darkvoid decorate defendorder defensecurl doubleteam dragoncheer dragondance eerieimpulse endure faketears featherdance flash flatter focusenergy glare grasswhistle growl growth harden haze honeclaws howl hypnosis irondefense kinesis leer lovelykiss meditate metalsound nastyplot nobleroar playnice poisongas poisonpowder quash quiverdance refresh rockpolish safeguard sandattack scaryface screech sharpen shellsmash shelter shiftgear sing sleeppowder smokescreen spicyextract spore stringshot stunspore supersonic swagger sweetkiss sweetscent swordsdance tailglow tailwhip takeheart taunt tearfullook teeterdance thunderwave tickle toxic toxicthread venomdrench victorydance willowisp withdraw workup yawn bellydrum clangoroussoul curse filletaway floralhealing healingwish healorder healpulse junglehealing lifedew lunarblessing lunardance memento milkdrink moonlight morningsun painsplit recover rest shoreup slackoff softboiled strengthsap substitute synthesis wish destinybond leechseed perishsong`
- **N (20):** no effect on this turn's HP or order.
  `block fairylock grudge happyhour holdhands laserfocus lockon meanlook mimic mindreader sketch spiderweb spite torment celebrate splash spikes stealthrock stickyweb toxicspikes`

  The hazard moves report where they land in E2 (`sides[side].hazards`). Magic Bounce sends them back.
- **C (6):** modelled when the condition holds; otherwise the guard text in §2.4.
  - **disable, encore** (§4.5):
    - If the target has already acted, nothing happens this turn.
    - If the target is still to act, the engine needs `lastMove`. Disable makes an equal queued move fail. With Encore, an equal queued move is unchanged and a different one is guarded.
    - With `lastMove` null, the move fails.
  - **imprison:** needs `moves`.
  - **ingrain, magnetrise:** guarded when the user's grounding changes and a later damaging move could reach it.
  - **roost:** guarded when a Flying user loses Flying and a later damaging move could reach it.
- **L (76):** not modelled in this build. They use today's `{Move} is not modelled and comes before another move.` when a later living action follows, and end-of-turn `{Move} is not modelled.` when none follows.
  `acupressure allyswitch aromatherapy attract autotomize bestow camouflage captivate conversion conversion2 corrosivegas courtchange craftyshield defog doodle electrify embargo entrainment flowershield foresight forestscurse gastroacid gearup geomancy guardsplit guardswap healbell healblock heartswap iondeluge luckychant magiccoat magicpowder magicroom magneticflux matblock minimize miracleeye mist mudsport nightmare noretreat octolock odorsleuth powder powershift powersplit powerswap powertrick psychoshift psychup purify recycle reflecttype roleplay rototiller simplebeam skillswap snatch soak speedswap stockpile stuffcheeks swallow switcheroo tarshot teatime telekinesis tidyup topsyturvy transform trick trickortreat watersport wonderroom worryseed`
- **S (7):** `batonpass chillyreception partingshot roar shedtail teleport whirlwind`.
  - With a later living action, the turn is not estimated: `{Name} switches out: the replacement is not known.` (existing; for Roar and Whirlwind the name is the target's).
  - With none, the moves are estimated and the end of turn is not estimated with the same text.
  - A switch that fails is modelled:
    - no Pokémon to switch in (`canSwitch`);
    - Suction Cups, Guard Dog, Ingrain, Dynamax, or Wind Rider absorbing Whirlwind;
    - Parting Shot lowering nothing without Mirror Armor (its onHit deletes `selfSwitch`);
    - Shed Tail at `hp <= ceil(maxhp/2)`.
  - Parting Shot's drops and Chilly Reception's snow are modelled before the switch.
- **P (1):** `revivalblessing`, with today's presence guard.
- **X (39):** today's handling:
  - the protecting moves, Wide Guard, Quick Guard, Helping Hand, Follow Me, Rage Powder, Tailwind, Trick Room, Gravity, the weather and terrain moves and the screens;
  - the calling moves, Instruct, Spotlight and Max Guard.

  These now also act on status moves where pinned Showdown says so:
  - Wide Guard: spread status moves.
  - Quick Guard: priority > 0.1.
  - Follow Me and Rage Powder: single-target status moves.
  - Electric Terrain: sleep and Yawn.
  - Misty Terrain: status, confusion and Yawn.
  - Psychic Terrain: priority status moves from foes into grounded Pokémon.

### 2.3 End of turn (EOT phase): modelled vs guarded

**Modelled.** Key = order.subOrder (`inventory.out`). In Speed order within an order, Speed comes before subOrder.

| Key | Handler | Rule (citations in the EOT design §2) |
|---|---|---|
| 1 | Weather | Sand/hail −1/16 (Rock/Ground/Steel; Ice for hail; Overcoat, Sand Force/Rush/Veil, Snow Cloak, Ice Body; Safety Goggles; Magic Guard; a Dig/Dive user on its charge turn); Ice Body +1/16 (hail, snow); Rain Dish +1/16, Dry Skin +1/8 (rain); Dry Skin/Solar Power −1/8 (sun); Utility Umbrella cancels sun/rain effects; then the Update. Not when the weather ends now (`weatherTurns` 1) or Cloud Nine/Air Lock is in with HP (no damage; the Update still runs for rain/sun). |
| 4 | Wish (carried) | heals `carried.wish` on the slot's living Pokémon |
| 5.2 | Grassy Terrain | +1/16 if grounded (`grounded()` + EotState: Ingrain/Smack Down/Gravity/Iron Ball ground; Flying (unless Roosted), Levitate, Magnet Rise, Air Balloon do not) and not semi-invulnerable |
| 5.3 | Healer | cures the ally's status: Champions 1/2, else 3/10 (branch) |
| 5.3 | Hydration | cures in rain or Heavy Rain by `effectiveWeather` (Umbrella holder: no) |
| 5.3 | Shed Skin | 33/100 (branch) |
| 5.4 | Leftovers / Black Sludge | +1/16; Black Sludge −1/8 for a non-Poison type |
| 6 / 7 | Aqua Ring / Ingrain | +1/16, Big Root ×5324/4096 |
| 8 | Leech Seed | −floor(baseMaxhp/8) (at least 1, capped at HP) to the seeded; the seeder at that slot gains the HP taken (Big Root); Liquid Ooze on the seeded damages the seeder instead; none if the seeder slot is empty or fainted; Magic Guard: nothing |
| 9 | Poison / bad poison / Poison Heal | −1/8; `clampIntRange(baseMaxhp/16, 1) × stage` after the stage rises (max 15); Poison Heal +1/8 |
| 10 | Burn | −1/16 (Heatproof: floor of the clamped value / 2, at least 1) |
| 12 | Curse | −1/4 |
| 13 | Partial trap | −1/8 (Binding Band 1/6) while the trapper is in with HP; otherwise it ends with no damage |
| 13 | Salt Cure | SV/SwSh −1/8 (Water/Steel 1/4); Champions −1/16 (1/8) |
| 14 | Syrup Bomb | Spe −1 from the source while it is in (stage only: E2) |
| 23 | Yawn | carried (1): sleep via `canSleep` (Safeguard does not block it; Electric/Misty Terrain, Sweet Veil, Insomnia, Vital Spirit, an existing status do); this turn's (2): no sleep |
| 24 | Perish | the count drops; at 0 it faints |
| 28.2 | Bad Dreams | −1/8 to each sleeping or Comatose foe while the holder has HP; Magic Guard |
| 28.2 | Speed Boost | Spe +1 if `activeTurns` (the stage only: E2) |
| 28.2 | Hunger Switch | form toggle (E2 build) |
| 28.3 | Sticky Barb | −1/8 |
| 28.3 | Flame Orb / Toxic Orb | status (no damage this turn) |
| 29 | White Herb | restores lowered stages (after Syrup Bomb) (E2) |
| after | Final Update | HP and pinch Berries, curing Berries (Lum after Yawn's sleep or an Orb's status), Cheek Pouch, Ripen, Gluttony; Unnerve/As One only from holders with HP |
| after | Emergency Exit / Wimp Out / Eject Pack | facts: `Switches out after the turn.` (HP above half at the residual start, half or below now; Eject Pack after a residual drop) |

**State the moves leave, read by the phase:**
- Toxic, Will-O-Wisp, Thunder Wave, the sleep moves and Toxic Thread this turn; bad poison set this turn starts at stage 0.
- Leech Seed, Aqua Ring, Ingrain, Ghost Curse, Yawn (2) and Perish Song (4) this turn.
- Traps from the trapping damaging moves and Salt Cure, a 100% secondary that Sheer Force removes and Shield Dust and Covert Cloak stop.
- Syrup Bomb, Smack Down and Thousand Arrows grounding, Roost, Magnet Rise.
- Psychic Noise's heal block: no residual heals, and no healing Berry at either Update, since the `onTryEatItem` TryHeal fails.
- Weather and terrain set this turn.
- Tailwind and Trick Room set this turn, through the Speeds.

**Not estimated (end of turn only; the moves stay estimated).** Shown as `End of turn not estimated: {reason}`:

| Trigger | Reason |
|---|---|
| An L move used with no later living action | `{Move} is not modelled.` |
| A Pokémon left during the moves with no later action (S moves, U-turn/Volt Switch/Flip Turn, Eject Button, Eject Pack, Red Card, Emergency Exit, Wimp Out, Dragon Tail, Circle Throw) | `{Name} switches out: the replacement is not known.` |
| Carried Future Sight or Doom Desire landing | `{Move} landing is not modelled in 2v2.` |
| Carried Cud Chew; a Harvest holder with no item; a Pickup holder with no item when another Pokémon used up an item this turn | `Cud Chew is not modelled in 2v2.` / `Harvest is not modelled in 2v2.` / `Pickup is not modelled in 2v2.` |
| Zen Mode, Shields Down, Schooling or Power Construct whose holder's HP after the residual can be on the other side of its form line | `{Ability} changing {Name}'s form is not modelled in 2v2.` |
| G-Max Vine Lash, Wildfire, Cannonade or Volcalith, or G-Max Centiferno or Sandblast, landing this turn (SwSh) | `{Move}'s damage over time is not modelled in 2v2.` |
| E2 only: Moody (sample ×2) or a Starf Berry eaten at an end-of-turn Update | `Moody is not modelled in 2v2.` / `Starf Berry is not modelled in 2v2.` (the calculator shows the fact `Moody raises one stat and lowers another.` and applies no change) |
| The weather ends now or a strong-weather holder faints while a field-settled ability or item is in | `A weather or terrain change this turn would change {X}.` (existing) |
| Neutralizing Gas's last holder faints in the residual while a Pokémon it suppressed is still in | `Neutralizing Gas ending is not modelled in 2v2.` (existing) |
| Receiver / Power of Alchemy on a residual faint; Opportunist / Mirror Herb copying a residual rise; Symbiosis | existing reasons |
| Over budget in the phase | `Too many cases to follow.` |

### 2.4 New and changed "not estimated" reasons (moves phase; exact text)

Additions to `REASONS` in `doubles-actions.ts`:

```ts
needsLastMove: (move: string, name: string) => `${move} needs ${name}'s move from the last turn.`,   // Disable, Encore on a Pokémon still to act, lastMove undefined
encoreChange: (name: string) => `Encore changes ${name}'s move: not modelled.`,                    // lastMove differs from its queued move
needsMoves: (name: string) => `Imprison needs ${name}'s moves.`,                                     // the Imprison user's moves undefined
substituteHit: (name: string) => `Hits on ${name}'s Substitute are not modelled.`,                   // a damaging move without bypasssub (and no Infiltrator) into a Substitute made this turn
groundingChange: (move: string, name: string) => `${move} changes whether ${name} is grounded: later moves are not modelled.`, // Ingrain (ungrounded user), Magnet Rise, with a later damaging move into it
withDynamax: (move: string) => `${move} with a Dynamaxed Pokémon is not modelled in 2v2.`,            // Pain Split
faceSelfHit: (ability: string) => `${ability} against a confusion self-hit is not modelled in 2v2.`,  // an intact Disguise or Ice Face
landing: (move: string) => `${move} landing is not modelled in 2v2.`,                                 // EOT
formChange: (ability: string, name: string) => `${ability} changing ${name}'s form is not modelled in 2v2.`, // EOT
overTime: (move: string) => `${move}'s damage over time is not modelled in 2v2.`,                     // EOT
```

Reused texts:
- `typeChange("Roost", name)`: Roost on a Flying user with a later damaging move into it.
- `notIn2v2("Uproar")`: an Uproar used this turn while a Pokémon is asleep, a sleep move or Rest is used, or a Yawn is in place.
- `notIn2v2("Sleep Talk")`: Sleep Talk while asleep (calling).

Removed:
- `REASONS.sleep`, `REASONS.freeze`, `REASONS.confusion` and their presence guards;
- `REASONS.pollenPuff` (Pollen Puff on an ally becomes a heal of `floor(baseMaxhp/2)`, Heal Block aside);
- the `HP_STATUS_MOVES` presence guard (only Revival Blessing remains, as P);
- Destiny Bond's guard in `hitReactions`.

### 2.5 Turn facts (`DoublesTurnResult.facts`; each only when it applies)

- `Every move hits; no critical hits; added effects below 100% do not happen.` (unchanged)
- **Removed:** `End-of-turn effects are not applied.`
- **Sleep, freeze, bad poison:**
  - `Assumes {Name} lost no turns to sleep before this one.`: status Asleep, no `carried.sleep`, and it has a move or is confused.
  - `Assumes {Name} lost no turns to freeze before this one.`: Champions, Frozen, no `carried.freeze`, and it has a move.
  - `Assumes this is {Name}'s first turn of bad poison damage.`: Badly poisoned, no `carried.toxic`, and the end of turn acts on it.
- **Field and switching:**
  - `Assumes the {Weather} does not end this turn.`: a weather from before the turn acts at the end of turn, and there is no `weatherTurns`.
  - `Assumes {your side|the opponent's side} has a Pokémon left to switch in.`: `canSwitch` absent and read.
- **Earlier turns:**
  - `Assumes {Name} did not use Destiny Bond last turn.`: Destiny Bond is chosen.
  - `Assumes no protecting move was used last turn.`: now also for Endure.
- `Assumes Dynamax started this turn.` (SwSh: a Dynamaxed Pokémon and the end of turn applied)
- `Moody raises one stat and lowers another.` (a Moody holder alive at the residual; the calculator only)

---

## 3. Contract (paste-ready; Step 0 writes all of it)

### 3.1 `app/lib/battle/doubles-types.ts`

```ts
/**
 * State from earlier turns a Pokémon brings into this turn. Training passes it from the public log
 * (sim/tracker.ts counts); the calculator passes only sleep, freeze, confusion and toxic. Absent fields: none of it.
 */
export type DoublesCarried = {
  /** With build.status "slp": BeforeMoves it has spent asleep since it fell asleep (public `|cant|…|slp` lines) and whether Rest put it to sleep. Absent: 0, not Rest (turn fact). */
  sleep?: { attempts: number; rest: boolean };
  /** With build.status "frz", Champions only: BeforeMoves it has spent frozen. Absent: 0 (turn fact). */
  freeze?: { attempts: number };
  /** Confused from an earlier turn: BeforeMoves it has spent confused (public `-activate|…|confusion` lines); Axe Kick's lasts at least 3. */
  confusion?: { attempts: number; axeKick?: true };
  /** With build.status "tox": the stage before this end of turn (end-of-turn ticks this stint), 0–15. Absent: 0 (turn fact). */
  toxic?: number;
  /** Seeded by the Pokémon at this slot (Leech Seed's sourceSlot). */
  leechSeed?: DoublesSlotId;
  /** Partially trapped by the Pokémon at `source` (Fire Spin, Whirlpool, Bind…); Binding Band: 1/6. */
  trap?: { source: DoublesSlotId; bindingBand: boolean };
  saltCure?: true;
  aquaRing?: true;
  ingrain?: true;
  /** Ghost-type Curse on it. */
  curse?: true;
  /** Syrup Bomb from the Pokémon at this slot. */
  syrupBomb?: DoublesSlotId;
  /** Drowsy from a Yawn that landed last turn: it falls asleep at this end of turn. */
  yawn?: true;
  /** The perish count shown before this turn: this end of turn lowers it; 1 faints now. */
  perish?: 1 | 2 | 3;
  /** A Wish landing on this slot at this end of turn: the HP it restores (half the wisher's maximum HP, truncated). */
  wish?: number;
  /** A Future Sight or Doom Desire landing on this slot now (its move id): the end of turn is not estimated. */
  futureMove?: string;
  /** A Berry Cud Chew re-eats at this end of turn: the end of turn is not estimated. */
  cudChew?: true;
};

export type DoublesPokemonInput = {
  /* …existing: build, contexts, charged, action… */
  carried?: DoublesCarried;
  /** The move it used last before this turn (pinned pokemon.lastMove); null: none since it came in; absent: unknown. */
  lastMove?: string | null;
  /** Every move it has (Imprison reads its user's): the calculator's quick moves plus its chosen move; Training's set. Absent: unknown. */
  moves?: readonly string[];
};

export type DoublesTurnInput = {
  /* …existing: runtime, field, pokemon… */
  /** Turns the weather has left before this turn's countdown (1: it ends at this end of turn without acting). Absent: it lasts (turn fact when it acts). */
  weatherTurns?: number;
  /** Whether each side has a Pokémon left to switch in (S moves, Healing Wish, Lunar Dance, Roar, Whirlwind). Absent: true (turn fact when read). */
  canSwitch?: Partial<Record<DoublesSideId, boolean>>;
};

export type DoublesHit = {
  /* …existing… */
  /** "effect": a status move reached it and acted (its facts say what, failures included); "blocked": a TryHit blocker
   *  (protection, guards, absorbing abilities, Magic Bounce, Good as Gold, Soundproof, powder blockers); "no-damage":
   *  immune (types, Prankster vs Dark, a move's own immunity, Substitute). */
  kind: "calculated" | "blocked" | "no-damage" | "effect";
  /** HP a status move changed on it over every outcome (heal +, cost −, Pain Split either); absent when none. */
  change?: { min: number; max: number };
};

export type DoublesHP = {
  /* …existing… */
  /** HP it lost outside any step: a No-move Pokémon's confusion self-hit ("Garchomp hurts itself in confusion: 23–28 HP."). */
  losses?: DoublesFact[];
  /** Its statuses and volatiles at this point, with chances ("Paralysed.", "Confused.", "Drowsy.", "Leech Seed.", "Perish count 3.", "Substitute: 35 HP."). Absent: none. */
  conditions?: DoublesFact[];
};

/** One residual on one Pokémon, aggregated over the turn's worlds. */
export type DoublesResidual = {
  slot: DoublesSlotId;
  /** "Sandstorm", "Leftovers", "Burn", "Bad poison", "Leech Seed", "Fire Spin", "Bad Dreams", "Healer", "Sitrus Berry"... */
  effect: string;
  /** The other Pokémon of a two-Pokémon residual: Leech Seed's seeder or seeded, the Bad Dreams or Healer holder. */
  other?: DoublesSlotId;
  /** Share of the turn in which it acted on this Pokémon. */
  chance: number;
  /** HP change where it acted (negative = damage); null when it changes no HP. */
  min: number | null;
  max: number | null;
  /** Hits' and residuals' KO chances add up to endOfTurn.hp[slot].koChance. */
  koChance: number;
  /** "Cures its poison.", "Falls asleep.", "Speed +1.", "Perish count 2.", "Switches out after the turn." */
  facts: DoublesFact[];
};
export type DoublesEndOfTurn =
  | { status: "ready"; hp: Record<DoublesSlotId, DoublesHP | null>; residuals: DoublesResidual[]; facts: string[] }
  | { status: "not-estimated"; reason: string };

// DoublesTurnResult "ready" gains:   endOfTurn: DoublesEndOfTurn;      (hp stays "after the moves")

export type DoublesOutcomeMon = {
  /* …existing: hp, build, protected, moved — after the turn when endOfTurn is "applied"… */
  /** Showdown volatile ids the next turn's value reads: confusion, taunt, encore, yawn, leechseed, perishsong, substitute, curse, saltcure, aquaring, ingrain, partiallytrapped. Absent: none. */
  volatiles?: string[];
  /** Asleep: expected remaining sleep counter (Showdown statusState.time; Early Bird counts each BeforeMove twice). */
  sleepTurns?: number;
  /** Perish count after this turn (3, 2, 1). */
  perishCount?: number;
};
// DoublesOutcome.sides[side] gains:  safeguard?: boolean; hazards?: string[]   (hazard move ids that landed on this side this turn; absent: none)
// DoublesOutcomesResult "ready" gains: endOfTurn: "applied" | { notEstimated: string }
```

**`validate()` issues** are reported as `{Name}: …` on the slot, never a crash:
- `carried.sleep` without status Asleep;
- `freeze` without Frozen or outside Champions;
- `confusion.attempts` outside 0–4 (Axe Kick: 0–4);
- `toxic` without Badly poisoned or outside 0–15;
- a `leechSeed`, `trap` or `syrupBomb` source on its own side or an empty slot;
- `perish` outside 1–3;
- `wish` outside 1..maxHP;
- `lastMove` not a catalog move;
- `moves` with duplicates.

### 3.2 `app/lib/battle/types.ts` (BuildBase; 1v1 never sets them)

```ts
  /** Set only by the 2v2 turn and Training: the focusenergy volatile from the move (+2 critical-hit ratio). Lansat keeps settledFocusEnergy. */
  focusEnergy?: true;
  /** Set only by the 2v2 turn and Training: Dragon Cheer's critical-hit stages (+2 when the Pokémon was a Dragon type as it started). */
  dragonCheer?: 1 | 2;
```

`calculate.ts` `critRatio` adds them, with the sources "Focus Energy" and "Dragon Cheer". Focus Energy fails while `settledFocusEnergy`, `focusEnergy` or `dragonCheer` is set. Dragon Cheer fails while `settledFocusEnergy` or `focusEnergy` is set (`PS/data/moves.ts` dragoncheer and focusenergy onStart).

### 3.3 `uses-to-ko.ts` (Step 0)

`UsesEnv.endure?: true` applies in turn mode only. In the hit loop, before the False Swipe line (`uses-to-ko.ts:2695`): `if (env.endure && damage >= hp && damage > 0) damage = hp - 1;`. It sets no `SASH_USED` and no `SAVED` (C2). The memo key of `searchFor` includes it.

### 3.4 `app/lib/battle/doubles-world.ts` (internal)

```ts
/** Moves-phase volatiles (Track A writes; the end of turn reads only sleep for Bad Dreams via build.status). */
export type MoveVolatiles = {
  sleep?: { elapsed: number; rest: boolean };            // with build.status "slp": the counter's total decrease (attempts × 1, Early Bird × 2)
  freeze?: { attempts: number };                         // Champions, with build.status "frz"
  confusion?: { attempts: number; min: 2 | 3 };          // T uniform on min..5; fresh: attempts 0
  taunt?: true;
  disabled?: string;                                     // the move Disable stops (set only when it can still act)
  imprisoning?: true;
  substitute?: number;                                   // HP left (made this turn)
  endure?: true;
  usedMove?: string;                                     // its move this turn passed BeforeMove (lastMove for later reads)
};
/** End-of-turn state (one writer per field: A = status engine, B = end-of-turn engine). */
export type EotState = {
  toxic?: number;                                        // A (setStatus "tox": 0) / carried
  leechSeed?: DoublesSlotId;                             // A / carried
  trap?: { source: DoublesSlotId; divisor: 6 | 8 };      // B (trapping damaging moves) / carried
  saltCure?: true;                                       // B / carried
  aquaRing?: true; ingrain?: true; curse?: true;         // A / carried
  syrupBomb?: DoublesSlotId;                             // B / carried
  yawn?: 1 | 2;                                          // A (2) / carried (1)
  perish?: number;                                       // A (4) / carried (1–3)
  wish?: number;                                         // carried
  roosted?: true; magnetRise?: true;                     // A
  smackedDown?: true;                                    // B
  healBlock?: true;                                      // B (Psychic Noise)
  hidden?: "sheltered" | "semi";                         // B (charge turn: Dig/Dive vs Fly/Bounce/Phantom Force/Shadow Force)
  futureMove?: string; cudChew?: true;                   // carried
};
// MonState gains: vol: MoveVolatiles; eot: EotState.
// SideState gains: safeguard: boolean; hazards: string[].
// World gains: leaving?: DoublesSlotId[]; endGuard?: string (an L move as the last action, or another EOT-level guard set during the moves).
// PendingAction gains: order?: number (absent = 200; After You 3, Quash 201).
```

`cloneMon` copies `vol` and `eot` shallowly; their values are immutable. `discreteKey` already serialises `mons` and `sides`.

`keyOf` returns `{ order, priority, speed }`. `topGroup` compares order ascending first (`PS/sim/battle-queue.ts:277-287`, `PS/data/moves.ts:195-216`, `:14455-14472`). The gen 7 frozen keys keep `order` too: After You moves the action next, and Quash (`PS/data/mods/gen7/moves.ts:750-766`, inserted before the residual) is order 201, last.

New helpers:
- `lossDist(w, slot, dist, tags)`: Track A. It convolves a loss distribution into the slot's factor, with afterLoss-style fainted and ate tags.
- `mapJoint(w, [a, b], fn)`: Track B. It joins the factors, rewrites the table and re-splits exactly. It serves Leech Seed and Pain Split.

### 3.5 The kernel (Step 0, `doubles-turn.ts`)

`export type TurnKernel` is an object of closures over the private `Ctx`. Both new modules import only its type:
- **World state:** `alive`, `faint`, `speedOf`, `typesOf`, `grounded` (extended with `eot.ingrain`, `smackedDown`, `roosted` and `magnetRise`), `itemWorks`.
- **Moves:** `breaks`, `priorityOf`, `moveInfo`, `resolveTargets`, `redirect`, `protectPasses`, `moveFailure` (C6).
- **HP and Berries:** `afterLoss`, `berryDue`, `ateBerry`, `pouchHeal`, `noteHeal`.
- **Stats:** `stepFact`, `hitFact`, `skipFact`, `hitStats`.
- **Guards:** `snapshot`, `eventGuards`, `notEstimated`.
- **Build data:** `buildStats` (getBuildStats: stored stats).
- **Context:** `names`, `hp`, `runtime`, `gen7`, `champions`, `mode` and `reference`.

Step 0 also moves `statusMove`, `fieldMove`, `fieldGuard`, `stanceChange`, `proteanGuard`, `selfBoost`, `foeDrop`, `statusLands` and `giveStatus` **verbatim** into `doubles-status.ts`. It replaces the inline BeforeMove block of `execute()` with `beforeMove(kernel, w, action)`, which reproduces today's behaviour. It inserts these hook calls with no-op stubs:
- `status.beforeHit(kernel, w, action, target, info)`: Substitute, in `singleStep` and `spreadStep` before the search;
- `status.onKnockOut(kernel, w, attacker, target)`: Destiny Bond, in `hitReactions`;
- `status.endureFor(w, target)`: in `searchFor`'s env;
- `eot.afterHit(kernel, w, action, target, outcome, info)`: trap, Salt Cure, Syrup Bomb, Psychic Noise, Smack Down;
- `eot.charging(w, slot, move)`: in `chargeTurn`;
- `eot.leaving(w, slot)`: at the existing switch-out points with no later action;
- `endOfTurn(kernel, worlds)`: after each `walk()`, returning the worlds unchanged and `{ status: "not-estimated", reason: "End-of-turn effects are not applied." }` until Track B lands.

The gate for Step 0: golden-1v1 byte-equal, every existing test green, and the 556 stored app results byte-equal.

---

## 4. Engine algorithm

### 4.1 Files

- `app/lib/battle/status-table.ts` (new, data only, Track A).
  - `STATUS_MOVE_TABLE: Record<moveId, StatusEntry>` with fields `{ kind, flags: { protect, reflectable, powder, sound, bypasssub, heal, wind }, target, ignoreImmunity?, boosts?, selfBoosts?, status?, volatile?, side?, handler?, fails?, games?: Partial<Record<BattleGame, Partial<StatusEntry>>> }`, generated once from the pinned dex with the mods applied.
  - It also holds `FAILENCORE_MOVES` and `DEFROST_MOVES`.
  - `MODELLED_STATUS_MOVES`, `NO_EFFECT_MOVES` and `HP_STATUS_MOVES` in doubles-actions.ts are derived from its kinds.
- `app/lib/battle/doubles-status.ts` (new, Track A): BeforeMove, the pipeline and the status helpers.
- `app/lib/battle/residuals.ts` (new, pure, Track B): per-Pokémon residual rules and keys (§4.8).
- `app/lib/battle/doubles-eot.ts` (new, Track B): the phase.

### 4.2 BeforeMove (`beforeMove`; `PS/sim/battle-actions.ts` runMove → `runEvent('BeforeMove')`, which stops at the first false)

It runs for every living Pokémon whose action is picked, **including No move**, which is Splash: status category, gravity flag. The checks run in this order; each random one splits the world by weight.

1. **Sleep (10).**
   - With e = `vol.sleep.elapsed` before this BeforeMove and d = 2 with Early Bird (1 otherwise), the wake hazard is `h = P(e < S ≤ e+d) / P(S > e)`. Then `elapsed += d`.
   - The prior of S:
     - SV, SwSh and USUM: {2, 3, 4} uniform;
     - Champions: {2: 1/3, 3: 2/3};
     - Rest: S = 3.
   - In the wake world, the status is cured and the move goes on. A woken Snore fails its own onTry.
   - In the stay world: `Asleep.`, and the move stops, unless the move is sleep-usable (Snore; Sleep Talk is guarded).
   - A sleep set earlier this turn starts at e = 0.
2. **Freeze (10).**
   - A defrost move (`DEFROST_MOVES`; Burn Up only for a Fire type) thaws its user.
   - Otherwise: SV, SwSh and USUM thaw with 1/5. In Champions the counter before this BeforeMove is `3 − attempts`: it decrements, thaws at ≤ 0, and otherwise thaws with 1/4. Then `attempts += 1`.
   - Facts: `Thaws.` / `Frozen.`
3. **Flinch (8).** Existing, including Steadfast.
4. **Disable (7).** `vol.disabled === move` and not a Z-Move → `Disable: {Move} cannot be used.` In Champions, cantusetwice moves pass (`mods/champions/moves.ts` disable).
5. **Gravity (6).** Existing; Splash included (C5).
6. **Throat Chop (6).** Existing.
7. **Taunt (5).** A status move (not Z/Max, not Me First) → `Taunt: {Move} cannot be used.` Splash included.
8. **Imprison (4).** A foe of this Pokémon has `vol.imprisoning`, and that foe's `moves` include this move (not Struggle, not Z/Max) → `Imprison: {Move} cannot be used.`
9. **Confusion (3).**
   - If confused: `attempts += 1`, and a is the new value.
   - The snap-out hazard is `P(T = a) / P(T ≥ a)` over T uniform on min..5 (fresh: 0 at a = 1). When it snaps out: `Snaps out of confusion.`, and the move goes on.
   - Otherwise:
     - 0.67: the move goes on.
     - 0.33: the self-hit (§4.4). The action ends, `moved` stays true, and no move is used: skip fact `Hurts itself in confusion: {min}–{max} HP.`
       - For No move, the self-hit goes into `DoublesHP.losses` as `{Name} hurts itself in confusion: {min}–{max} HP.`, with its chance.
       - Then the self-hit runs the action's Update: afterLoss with Berries; no Emergency Exit (C7).
10. **Paralysis (1).** Existing (1/4; Champions 1/8). Not for No move, which changes nothing.
11. **Destiny Bond (−1).** `destinyBond` is cleared when the user starts a move other than Destiny Bond, and when its move stops at BeforeMove (onMoveAborted).
12. **Focus Punch's `beforeMoveCallback`.** Existing.

A sleeping, frozen or self-hit Pokémon still counts as having moved (Payback, Sucker Punch, Helping Hand). The lowest and highest walks take the lowest or highest self-hit roll, as the oracle's `randomizer` does.

### 4.3 Status-move pipeline (`statusMove`)

1. **Early branches** (moved code, unchanged): the ally-only failure; Protean; the Protect family, which now includes Endure; Wide and Quick Guard; Helping Hand; Follow Me and Rage Powder; Destiny Bond; `fieldMove`.
   - Endure sets `vol.endure` and fails with `!w.remaining.length`.
   - Safeguard is a side flag that fails while up.
   - Haze resets every Pokémon's stages (Opportunist sees no rise).
   - Perish Song gives `eot.perish = 4` to each Pokémon that passes Invulnerability and TryHit. Soundproof blocks it unless the Pokémon is the user (`target !== source`); a Pokémon already counting is unchanged. Perish Song has no protect flag.
2. **Kind.**
   - N → return.
   - L → if a later living action follows, `notEstimated(REASONS.notModelledBefore(move))`; otherwise set `w.endGuard ??= REASONS.notModelled(move)` and return.
   - S → the move's effects first (Parting Shot's drops, Chilly Reception's weather), then the switch rule (§2.2). A switch that happens sets `w.leaving`.
   - C → check the condition, then guard or model.
   - P and X → existing handling.
3. **TryMove** (`useMoveInner`). `moveFailure` now runs for status moves too: Dazzling, Queenly Majesty and Armor Tail, with the `foeSide` and `all` exceptions (C6), and Damp. The move's own `onTry` failures come from the table's `fails`:
   - Dark Void (not Darkrai);
   - Rest: full HP, already asleep, Comatose, or sleep-immune per `canSleep`;
   - Belly Drum: `hp <= maxhp/2` or +6 Atk;
   - Fillet Away: `hp <= maxhp/2`;
   - Clangorous Soul: C1;
   - Substitute: up already or `hp <= maxhp/4`;
   - Healing Wish and Lunar Dance: no `canSwitch`;
   - Focus Energy and Dragon Cheer: §3.2;
   - After You and Quash: no queued action for the target;
   - Magnet Rise: Ingrain, Smack Down, Gravity, or already up.
4. **Targets.** By the dex target type (table, per game):
   - **No redirection:** `self`, `allies` (user and living ally), `adjacentAlly`, and `adjacentAllyOrSelf` on itself.
   - **Through `kernel.resolveTargets`:** `normal`, `any`, `adjacentFoe`, `allAdjacentFoes`, `allAdjacent`, `randomNormal`, and Ghost Curse aimed at its ally, which becomes `randomNormal`. Here Follow Me and Rage Powder apply (Rage Powder not from powder-immune users), Lightning Rod and Storm Drain take a status move of their type, retargeting happens, and spreads follow `spreadTargets()` order.
5. **TryHit, per target**, in handler priority order (step-major across targets, as `trySpreadMoveHit` runs each step for all targets before the next):
   1. Wide Guard on a spread move; Quick Guard at priority > 0.1.
   2. The Protect family, for moves with the `protect` flag.
   3. **Magic Bounce** (breakable; not the holder's own move; not already bounced; `reflectable`; the holder not semi-invulnerable). The holder uses the move with no BeforeMove and no PP:
      - a single-target move goes back at the original user;
      - a spread move goes at the user's side.

      The bounced move runs this pipeline from step 4, with `bounced = true` and `pranksterBoosted = false` (`PS/data/abilities.ts:2437-2462`), so its own redirection (Follow Me on the user's side) applies. Hazards that a bounced move sends to the user's side go into `sides.hazards`. Hit kind for the holder: `blocked` (`Magic Bounce: {Move} goes back to {User}.`).
   4. Absorbing abilities through the existing `ABSORBING` and `absorbEffect`, by the move's type and the wind flag, with the fact `{Ability}: {Move} has no effect, and it regains HP.` for heals. Stage absorbers keep their existing text.
   5. Good as Gold: from another Pokémon, breakable.
   6. Soundproof: sound flag, from another Pokémon, breakable.
   7. Overcoat or Safety Goggles: powder, gen 6+.
   8. Psychic Terrain: priority > 0.1 from a foe into a grounded, not semi-invulnerable target.
   9. Yawn's onTryHit: the target has a status or `!canSleep`.
6. **Type immunity.** Only for `ignoreImmunity: false` moves (Thunder Wave vs Ground).
7. **TryImmunity.** Powder vs Grass (gen 6+); the move's own (Leech Seed vs Grass); Prankster-boosted vs a Dark foe (`PS/sim/battle-actions.ts:666-689`). Hit kind `no-damage`, with `{Name} is immune.` or `Prankster: {Name} is not affected.`
8. **Substitute** (`TryPrimaryHit`). A target other than the user, behind `vol.substitute`, without `bypasssub` or the user's Infiltrator → `no-damage`, `{Name} is behind a Substitute.`
9. **Effects**, in `runMoveEffects` order, then `onHit` (the table's `handler`), then `self`:
   - boosts → `applyBoosts`;
   - heal → `healSlot`;
   - status → `setStatus`;
   - volatile:
     - confusion: blockers Own Tempo, Misty Terrain (grounded), Safeguard (from any other Pokémon), already confused;
     - taunt: blockers Oblivious, Aroma Veil;
     - leechseed: blocker already seeded; sets `eot.leechSeed = user`;
     - yawn: blockers Safeguard, Electric/Misty Terrain (grounded), Sweet Veil, Insomnia, Vital Spirit; sets `eot.yawn = 2`;
     - curse: sets `eot.curse`;
     - aquaring, ingrain: set `eot`;
     - substitute: `vol.substitute = floor(maxhp/4)`;
     - imprison: sets `vol.imprisoning`;
     - focusenergy, dragoncheer: set build fields;
   - side: Safeguard, hazards;
   - onHit:
     - the heal families (§4.4);
     - Pain Split;
     - Strength Sap (Atk −1 first, then the heal; fails at −6);
     - Venom Drench (only on psn or tox);
     - Belly Drum (cost, then Atk to +6, or −6 under Contrary);
     - Fillet Away and Clangorous Soul (cost, then boosts);
     - Ghost Curse (cost via directDamage: no Sturdy, Endure or Magic Guard; it can faint the user, and then faint runs);
     - Memento (the user faints only if the move hit);
     - Healing Wish and Lunar Dance (the user faints);
     - Rest (full HP, sleep with `rest: true`, status cured; `vol.sleep = { elapsed: 0, rest: true }`);
     - Take Heart, Refresh, Jungle Healing and Lunar Blessing cures;
     - After You and Quash (`order` 3 or 201 on the target's queued action);
     - Charge (`charged`, Sp. Def +1);
     - Disable and Encore (§4.5).
10. **After the action.**
    - Facts.
    - `kernel.eventGuards`, with EE/Wimp Out checked only after damaging moves (C7), and `gasShieldGuard`.
    - Then **the action's Update**, `updateAll`: curing Berries (Lum also cures confusion), Mental Herb (Taunt, Encore, Disable), and HP and pinch Berries after a cost or self-hit. Unnerve and As One stop Berries from living foes.
    - Today's `unnerveEnds` stays in `runMove`.

### 4.4 Status helpers (Track A)

**`canStatus(w, slot, status, source, effect) → string | null`.** It returns the blocking fact, or null (`PS/sim/pokemon.ts:1684-1748`). It is exported to the end-of-turn phase as `canSleep`. Blockers:
- **Already statused:** `{Move} fails: {Name} is already {asleep|paralysed|burned|poisoned|badly poisoned|frozen}.` Comatose also blocks.
- **Types:** Fire (brn); Electric (par, gen 6+); Poison and Steel (psn, tox) unless the source has Corrosion; Ice (frz).
- **Safeguard:** blocks status from any other Pokémon. An Infiltrator foe passes. A Yawn already in place passes, because `onSetStatus` returns for `effect.id === 'yawn'`.
- **Terrains:** Misty Terrain (any status, grounded); Electric Terrain (sleep, grounded).
- **Abilities:** each is breakable by Mold Breaker, Teravolt, Turboblaze and ignoreAbility moves unless an Ability Shield protects the holder (existing `breaks`):
  - Leaf Guard: sun by `effectiveWeather`, so Utility Umbrella cancels it;
  - Shields Down: Meteor form;
  - Purifying Salt;
  - Insomnia and Vital Spirit: sleep;
  - Limber: paralysis;
  - Water Veil, Water Bubble and Thermal Exchange: burn;
  - Immunity: poison and bad poison;
  - Pastel Veil: poison and bad poison, on the holder and its ally;
  - Sweet Veil: sleep, on the holder and its ally;
  - Flower Veil: Grass types on its side, against other Pokémon.

**`setStatus`.** It sets the status (`tox` also sets `eot.toxic = 0`; `slp` sets `vol.sleep = { elapsed: 0, rest }`). Then:
- Synchronize passes psn, tox, par or brn back to a living source;
- a curing Berry eats at the Update;
- Cheek Pouch heals.

Today's `statusLands` and `giveStatus` become its callers.

**`applyBoosts(w, target, boosts, source, effect)`** merges `selfBoost` and `foeDrop` (`PS/sim/battle.ts:2020`).
- **Order:**
  1. `onTryBoost`, for drops from another Pokémon (allies included): Clear Amulet; Clear Body and White Smoke (breakable); Full Metal Body; Hyper Cutter (Atk); Big Pecks (Def); Keen Eye and Mind's Eye (accuracy); Flower Veil (Grass on its side); Mirror Armor (breakable; drops not already at −6 go back onto a living source, once).
  2. Contrary, then Simple.
  3. The ±6 cap.
  4. Defiant (+2 Atk) and Competitive (+2 Sp. Atk) on a fall caused by a **foe** (`target.isAlly(source)` returns).
  5. `statsLowered` and `statsRaised`.
  6. White Herb after the move.
  7. Eject Pack: guard, existing.
- **Accuracy and evasion** stages are not stored, since no calculation reads them (every move hits). Their reactions still run, and their facts read `−1 accuracy.` and `−2 evasion.`.
- Growth gives +2/+2 in sun or Harsh Sunshine by `effectiveWeather`.

**`healSlot(w, slot, amount, effect)`.** It truncates the amount to at least 1. It heals nothing at 0 HP or at full HP. It is blocked under `eot.healBlock`. Amounts (`modify` is calculate.ts's 4096-based rounding):

| Move | Amount |
|---|---|
| Recover, Slack Off, Soft-Boiled, Heal Order, Milk Drink, Roost | `round(baseMaxhp/2)` |
| Life Dew | `round(baseMaxhp/4)` on the user and its living ally |
| Heal Pulse, Floral Healing | `ceil(baseMaxhp/2)`; Mega Launcher `modify(baseMaxhp, 0.75)`; Floral Healing in Grassy Terrain `modify(baseMaxhp, 0.667)` |
| Moonlight, Morning Sun, Synthesis | `modify(maxhp, f)`, with f = 0.667 in sun or Desolate Land, 0.25 in rain, Heavy Rain, sand, hail or snow, else 0.5, by `effectiveWeather(undefined, true)` (Umbrella) |
| Shore Up | `modify(maxhp, 0.667)` in sand, else 0.5 |
| Jungle Healing, Lunar Blessing | `modify(maxhp, 0.25)` on each of the user and its ally, and a cure |
| Strength Sap | the target's `getStat('atk', boosted, unmodified)`; Big Root `modify(·, 5324/4096)`; Liquid Ooze on the target damages the user by that amount instead |
| Pain Split | `mapJoint` both to `floor((a+b)/2) \|\| 1`; Berries at the Update |
| Rest | to maximum |
| Pollen Puff on an ally | `floor(baseMaxhp/2)` |

Triage gives +3 priority to status moves with the `heal` flag. `turnPriority` reads the table flag, which makes today's comment at `calculate.ts:3029` obsolete.

**`confusionHit(w, slot)`.**
- **Damage.**
  - `A = calculateStat(stored atk, boosts.atk)` and `D = calculateStat(stored def, boosts.def)`, from `kernel.buildStats`. Under Wonder Room, D is the stored Sp. Def. The stage table is `[1, 1.5, 2, 2.5, 3, 3.5, 4]` with floor.
  - L is 50 in Champions, and the level otherwise.
  - `base = tr(tr(tr(tr(2L/5+2)·40·A)/D)/50)+2`, then `% 65536`.
  - The rolls are `tr(base·(85..100)/100)`, each at least 1.
- **Application, through the Damage event:**
  - Endure (C2);
  - Sturdy and Focus Sash at full HP (the Sash is used);
  - an intact Disguise or Ice Face is guarded (`faceSelfHit`);
  - Focus Band: existing guard;
  - Magic Guard and Multiscale do not stop it.
- **Effects:**
  - It sets `hurt` (Assurance).
  - It adds no `damagedBy` and no `timesAttacked`, and triggers no Emergency Exit.
  - It enters the factor as a `lossDist` (deduplicated rolls), followed by the action's Update.

### 4.5 Effects on later actions

- **Taunt, Disable and Imprison:** through BeforeMove (§4.2). Mental Herb cures Taunt and Disable at the Update.
- **Encore and Disable on a target still to act** need `lastMove`:
  - Encore fails with `null`, a Dynamaxed target, or a `failencore` or Z/Max last move.
  - Disable fails with `null`, a Z/Max last move, or Struggle.
  - If `lastMove` equals the target's queued move: Encore changes nothing (base onOverrideAction; Champions does not change the action when the ids match), and Disable sets `vol.disabled`.
  - Otherwise: Encore → `encoreChange`; Disable has no effect this turn.
  - On a target that has already acted, both have no effect this turn. E2 gets `encore` in `volatiles`.
- **Substitute** (`status.beforeHit`). A damaging move into `vol.substitute`, without `bypasssub` (sound moves have it) or Infiltrator, and not by the user itself → `substituteHit`.
- **Endure:** `status.endureFor` returns `vol.endure` for the target's searches.
- **Destiny Bond** (`status.onKnockOut`). When a foe's move (not a future move) knocks the user out while `destinyBond` is set, the attacker's HP goes to 0 via `mapHP` after the target's faint in the same batch. Then `faint` runs (Soul-Heart, faint count, strong weather). A Dynamaxed attacker is immune. The attacker's step gets the fact `Destiny Bond: {Name} faints too.`
- **Speed changes** (Agility, Scary Face, String Shot, Thunder Wave, Curse Spe −1, Toxic Thread, Shell Smash) re-sort from gen 8 automatically, because `speedOf` reads the build. Gen 7 keeps its frozen order.
- **Burn, paralysis and poison** reach later steps through `build.status`: halving, Guts, Facade, Hex, Venoshock, Quick Feet, Speed.
- **Grounding** changes go through `kernel.grounded`: terrain checks, Psychic Terrain, Grassy Terrain at the end of turn. Changes the pair engine cannot follow are guarded (C list).

### 4.6 Statuses from before the turn

`startWorld` maps `carried` into `vol` and `eot`:
- **sleep:** `elapsed = attempts × d`; Rest S = 3.
- **freeze:** `attempts`, Champions only.
- **confusion:** `{ attempts, min: axeKick ? 3 : 2 }`.
- **toxic:** the stage.
- **the other EOT fields:** copied.

A Figy-family Berry's nature confusion (`berryConfusion`) becomes a fresh confusion (`attempts: 0`) instead of a guard. Lum and Persim cure it at the Update. Own Tempo and Misty Terrain block it, as today.

### 4.7 The end-of-turn phase (`endOfTurn(kernel, worlds)`, Track B)

Per finished world:

1. **Guards** (§2.3). If any world carries `endGuard` or `leaving`, or a carried guard field, the end of turn is not estimated. The reason is the guard with the most mass, ties alphabetical.
2. **Speeds.** `kernel.speedOf` for every living Pokémon, as the moves left the world (Trick Room and Tailwind set this turn count). The HP at the residual start (undynamaxed) is recorded for Emergency Exit.
3. **Collect the handlers** once, each with key `(order, priority, speed, subOrder)` (`RESIDUAL_KEYS`) and its holder:
   - the weather (one handler, order 1);
   - Wish;
   - for each living Pokémon, the `ownResiduals` of §4.8, wrapped to re-read the world when they run (holder alive, same status, same working item);
   - the two-Pokémon handlers: Leech Seed, partial trap (source check), Healer, Bad Dreams, Syrup Bomb;
   - Yawn, Perish, Speed Boost, Hunger Switch, the Orbs, White Herb and Eject Pack.
4. **Sort and group exact ties.** A tie group runs once in key order when no two of its handlers touch the same Pokémon's HP, status or stages, and none reads whether a Pokémon another one hurts is still in. Otherwise every permutation becomes its own world at mass/k! (k ≤ 4), and `mergeWorlds` collapses equal results (C9; E29a/b).
5. **Run each handler on every world.** After each handler:
   - **faint resolution:** a slot holding both 0 and positive HP mass is split with `condition`, and the 0 side runs `kernel.faint`;
   - an optional lazy skip, when nothing later reads that slot's presence (never in reference mode);
   - merge and the budget check.

   The weather handler applies its per-Pokémon ops in Speed order, then runs `updateAll` when it called `eachEvent('Weather')`.
6. **Final Update** (`updateAll`), then the Emergency Exit, Wimp Out and Eject Pack facts.
7. **E2 only:** the stage, status and form changes of S handlers into the builds; `mergeOutcomes` merges equal builds.

`EndNotEstimated(reason)` is thrown inside the phase. Any `NotEstimated` raised inside it is converted, so the moves stay estimated.

Per-handler rules not spelled out in §2.3:
- The damage of a residual is `clampIntRange(floor(x), 1)`, capped at HP.
- A heal is `trunc(x)`, at least 1, as TryHeal applies: Big Root, Liquid Ooze, Heal Block.
- Every residual uses base maximum HP, Dynamax included.
- Bad poison's stage rises even under Magic Guard.

### 4.8 Shared residual code (`residuals.ts`, Track B)

```ts
export type ResidualKey = { order: number; subOrder: number; priority: number };
export type ResidualMon = {
  baseMaxHP: number; types: readonly string[]; ability: string; /** the item that works (caller applies Klutz, Magic Room) */ item: string;
  status: BattleStatus; toxicStage: number; grounded: boolean; semiInvulnerable: boolean; sheltered: boolean;
  saltCure?: boolean; aquaRing?: boolean; ingrain?: boolean; curse?: boolean; trapDivisor?: 6 | 8; healBlocked?: boolean;
};
export type ResidualId = "sandstorm" | "hail" | "icebody" | "raindish" | "dryskin" | "solarpower" | "grassyterrain" | "leftovers"
  | "blacksludge" | "aquaring" | "ingrain" | "poisonheal" | "psn" | "tox" | "brn" | "curse" | "partiallytrapped" | "saltcure" | "stickybarb";
export type OwnResidual = { id: ResidualId; key: ResidualKey; amount: number };   // + heal, − damage, before the HP cap
export function weatherResiduals(mon: ResidualMon, weather: BattleConditions["weather"]): OwnResidual[];   // the effective weather
export function ownResiduals(mon: ResidualMon, env: { terrain: BattleConditions["terrain"]; champions: boolean }): OwnResidual[];
export function badDreamsDamage(target: ResidualMon): number;
export function leechSeedDamage(seeded: ResidualMon): number;
export function bigRoot(amount: number): number;                                  // tr((tr(amount*5324) + 2047) / 4096)
export const RESIDUAL_KEYS: Readonly<Record<string, ResidualKey>>;                 // checked against pinned Showdown (source test)
```

**The 1v1 adapter.** `UsesSearch.residuals()` (`uses-to-ko.ts:3577-3615`) keeps its signature and output. It:
- builds a `ResidualMon` from its `Side`: status `""` when `hydrated()`, `endWeather` as the weather, sheltered and semi from `charging`;
- calls the two functions;
- inserts Bad Dreams from the other side;
- emits `{ops, names, orders}`, with names from a `RESIDUAL_PHRASES` map that holds today's strings, orders = `Math.floor(key.order)` (C14), and UPDATE after the weather ops and at the end.

The walker stays 1v1-only. The gate is golden-1v1 full corpus byte-equal plus every `calculator-uses-to-ko*` test unchanged. If the gate cannot be met in Track B's step, the fallback is to leave 1v1 untouched and add a source test that asserts both implementations give equal amounts on a grid of Pokémon and fields.

### 4.9 Results

- **`calculateDoublesTurn`.**
  - The three walks each run `endOfTurn`.
  - `endOfTurn.hp` is built like `hp` from the post-residual worlds: low and high from the lowest and highest walks; `start`, `maximum`, `settled`, `heals` and `faintsBeforeMoving` copied from `hp`; `koChance` and `conditions` recomputed.
  - `residuals` comes from the all-walk stats, in first-key order.
- **`calculateDoublesOutcomes` (E2).**
  - With the end of turn applied: outcomes after the turn and `endOfTurn: "applied"`.
  - Otherwise: today's outcomes and `{ notEstimated }`.
  - New fields on each outcome:
    - `volatiles` from `vol` and `eot`;
    - `sleepTurns`: the expected remaining counter from the posterior, `E[S − e | S > e]` with d = 1, or `ceil(·/2)` per BeforeMove with Early Bird;
    - `perishCount`;
    - `sides.hazards`;
    - `safeguard`.

### 4.10 Budgets

- `BUDGET` is unchanged: 1 500 worlds, 200 000 entries, 160 calculations.
- No new damage calculations: status checks and residuals are arithmetic. Confusion damage reads stored stats, not the calc.
- **Moves-phase branching:** at most 2 worlds per BeforeMove check per Pokémon (sleep, freeze, confusion end, self-hit, paralysis). The self-hit is a factor distribution, not extra worlds.
- **End-of-turn branching:** Healer and Shed Skin double per holder; tie permutations are at most 24 per group; faint splits happen after each handler. The budget is checked after each group.
- **Bench gate** (SPEC §9, unchanged): p50 ≤ 30 ms, p95 ≤ 120 ms, any case ≤ 400 ms (today's p50 is 3.3 ms). New bench cases: Teeter Dance + four movers + Quick Claw + ties; Swagger into Sitrus; Spore + Lum + Early Bird; sand + four Leech Seeds + Healer.
- `DOUBLES_REFERENCE` (no merges, no splits, every tie permuted) must equal the normal mode on 30 status and end-of-turn turns.
- **Training:** decision p95 ≤ 634 ms (576 ms + 10%).

---

## 5. UI (2v2 only; 1v1 unchanged)

- **`doubles-format.ts`:**
  - `cardHPLabel` gives `After the turn · {roll}` when the end of turn is ready, else `After the moves · {roll}`.
  - `turnSummary` reads after-turn HP when ready.
  - `hitLine` for kind `effect`: `{Name}`, then `: +163 HP` or `: −87 HP` from `change`, then ` · reaches it 50%`. The facts follow on their own lines (existing rendering).
  - A `blocked` or `no-damage` hit of a status move prints `{Name}: no effect` (move category from the runtime).
  - New `residualLine(r)`:
    - `{effect} · {Name}: −11 HP`, as `{min}–{max}` when they differ;
    - `, KO chance 12.5%` when above 0;
    - ` (from {Other})` for two-Pokémon residuals;
    - ` (50%)` via the chance when below 1;
    - with no HP change: `{effect} · {Name}`.
    - The minus sign is U+2212.
- **`DoublesCard.tsx`:**
  - Uses `endOfTurn.hp[slot]` when ready, otherwise `hp[slot]`.
  - The screen-reader text says `after the turn` or `after the moves`.
  - Under the HP bar: one muted line `data-doubles-conditions={slot}`, `Paralysed · Confused (67%)`, which wraps (`wrap-anywhere`).
- **`DoublesTurn.tsx`:**
  - Steps as today: kind `effect`, the new skip facts, step facts.
  - `DoublesHP.losses` lines (`data-doubles-loss={slot}`) before the turn facts.
  - Then an **End of turn** section (`data-doubles-end`, heading `End of turn`): one `data-doubles-residual={slot}` line per residual, its facts muted below, then `endOfTurn.facts`.
  - When not estimated: `<p data-doubles-end-not-estimated>End of turn not estimated: {reason}</p>`.
  - No section when the end of turn is ready with no residuals.
- **Field conditions** (`BattleConditions.tsx` 2v2 section, beside the per-slot Charge checkbox; Q1 default):
  - per slot, shown only when relevant:
    - `Turns lost to sleep` select 0–3 and a `Rest sleep` checkbox (status Asleep);
    - `Turns lost to freeze` 0–2 (Champions, Frozen);
    - `Confused` checkbox with `Confusion turns so far` 0–4;
    - `Bad poison turns so far` 0–15 (Badly poisoned).
  - **State:** `doubles-prep.ts` `carried: Record<DoublesSlotId, DoublesCarried>`. It resets when the slot's Pokémon changes, as `charged` does (`doubles-prep.ts:251`), and a status change clears the stale fields.
  - **Passing:** `useDoublesView.tsx` passes `carried`, `moves` (the quick moves plus the chosen move) and no `lastMove`.
  - **Width:** 375 px with no horizontal scroll; the controls reuse the compact select style.

---

## 6. Training (Champions)

- **`sim/bridge.ts`** (`bridgeTurn` gains `publicOf(key)` from services.ts:98).
  - **Carried state from public counts:**
    - `carried.sleep`: `statusElapsed`, plus `rest` from a new tracker flag (`-status|X|slp|[from] move: Rest`);
    - `freeze`: `statusElapsed`;
    - `confusion`: the volatile's `elapsed`, plus `axeKick` from a new tracker flag (a `-start confusion` in an Axe Kick action);
    - `toxic`: the toxic `statusElapsed`.
  - **Carried state from the belief battle**, exact per belief world:
    - `leechSeed`: from `sourceKey`, only while the source is active;
    - `trap`: source and Binding Band;
    - `saltCure`, `aquaRing`, `ingrain`, `curse`;
    - `syrupBomb`;
    - `yawn`: the volatile with duration 1;
    - `perish`: the count;
    - `wish`: the slot condition's hp, landing now;
    - `futureMove`, `cudChew`.
  - **Other inputs:**
    - `lastMove`: the tracker's;
    - `moves`: the belief set's `moveSlots`;
    - `canSwitch`: a living bench per side, public;
    - `weatherTurns`: `weatherState.duration`;
    - `build.focusEnergy` and `build.dragonCheer`: from the volatiles. The Dragon Cheer value comes from the volatile state's `hasDragonType`, which is public: the type at its start.
  - **`IGNORED_VOLATILES` keeps** only what has no effect the engine reads: choicelock, lockedmove, encore, taunt, disable, torment, throatchop, imprison, stall, laserfocus, protect, helpinghand, followme, ragepowder, endure, charge, flashfire, unburden, slowstart, trapped, trapper.
  - **Moved out:**
    - mapped: confusion, leechseed, yawn, perishsong, partiallytrapped, saltcure, aquaring, ingrain, curse, syrupbomb, focusenergy, dragoncheer;
    - rollout reasons now: healblock (C12), substitute, attract, destinybond, magnetrise, telekinesis, nightmare, octolock.
  - **New rollout reasons:**
    - a remapped No move (Recharge, a first-turn move after the first turn) by a confused Pokémon. Recharge stops at BeforeMove 11 before confusion, and Fake Out is not Splash under Gravity.
    - `ingrain` on an ungrounded Pokémon.
- **`ai/evaluate.ts` `postFromOutcome`.**
  - `endOfTurn === "applied"` → no residual change. Otherwise today's.
  - `PostMon.volatiles = outcome.volatiles`, and `sleepTurns` and `perishCount` from the outcome.
  - Hazards: from `outcome.sides[side].hazards`. They replace the `HAZARD_MOVES`-by-action inference (`evaluate.ts:83, 196-199`).
  - `residual()` is called only for outcomes that were not applied.
- **`scripts/training/conformance.ts`.**
  - Gate 4b reads Showdown HP after the residual's final Update for cells whose outcomes are all applied, and before the residual otherwise.
  - A new informational row reports the end-of-turn-applied share and the byMethod engine share.
  - Gate 7's census adds the new status moves.
  - Gate 8 uses the regenerated tests.
- **`scripts/training/leak.ts`** diffs the new input fields: `carried`, `lastMove`, `moves`, `canSwitch`, `weatherTurns`. It must still show 0 differences.
- **Gates** (`npm run eval:training`, `conformance:training`, `leak:training`):
  - vs RandomLegal ≥ 90%;
  - vs MaxDamage ≥ 60%;
  - self-play 50 ± 7;
  - conformance and leak pass;
  - decision p95 ≤ 634 ms.

---

## 7. Oracle (`scripts/.cache/calc-audit/2v2/verify`)

1. **`sim-dfs.ts`.**
   - On the residual action: record HP after the moves (as today), then `ra.call(this, action)` and record HP after the turn after it returns (final Update and EE included). Then stop.
   - The residual log becomes `residuals[slot]` mass by `effect:amount` key.
   - `CHANCE_EFFECTS` gains `healer` and `shedskin`.
   - Sleep, confusion and Champions sleep already enumerate through `random` and `sample`, and tie shuffles through `prng.shuffle`.
   - The forcing is unchanged: accuracy passes, chances below 100% fail, crits happen only when certain.
2. **`prepare()` applies `CaseMon.carried`** (exact hidden values from step 3):
   - sleep: `statusState.time` and `startTime`;
   - confusion: `addVolatile('confusion')` and `.time`;
   - Champions freeze: `time = 3 − attempts`;
   - toxic: `statusState.stage`;
   - Leech Seed, trap (`boundDivisor`), Salt Cure, Aqua Ring, Ingrain, Curse and Syrup Bomb: volatiles with their source;
   - Yawn: duration 1;
   - perish: duration;
   - Wish: slot condition, `hp`, and `startingTurn = turn − 1`;
   - `field.weatherState.duration`;
   - `p.lastMove`, with the move in `moveSlots` via `CaseMon.moves`.
3. **Hidden-counter expansion.** `CaseMon.carried.sleep|confusion` yields weighted sub-cases, one per hidden value consistent with `attempts`:
   - sleep S over its prior, restricted to S > e;
   - confusion T over min..5, restricted to T > attempts.

   Each sub-case runs exactly, and `Tally` mixes them with prior weights. The app receives the public `carried`, and equality within 1e-9 validates §4.2.
4. **Per-target status lines.** `Recorder` keeps the mass, per action and target, of these lines:
   - `-status` and `-curestatus`;
   - `-start` and `-end` for confusion, Taunt, Leech Seed, Curse, perishN, Substitute, Yawn and Disable;
   - `-boost`, `-unboost`, `-setboost` and `-clearallboost`;
   - `-heal` and `-sethp` (amount from the HP difference);
   - `-activate` for Safeguard, Magic Bounce, Destiny Bond and After You/Quash;
   - `-immune` and `-fail`;
   - `cant` with slp, frz, Taunt, Disable, Imprison, Gravity and Dazzling.

   These become `StepResult.effects[target]: Record<key, mass>` with stable keys (`status:par`, `boost:atk:-2`, `cant:slp`, …).
5. **`compare.ts`:**
   - `EFFECT_FACTS` maps each oracle key to an app fact category (`status:par` ↔ `Is paralysed.`, `boost:atk:-2` ↔ `−2 Attack.`, `cant:slp` ↔ skipped `Asleep.`). Chances agree within 1e-9.
   - It also compares `change` min and max with the HP deltas, `kind` with reached and landed, and `endOfTurn.hp` and each `DoublesResidual` (chance, min, max, koChance) with the residual log.
   - For a reason-only case it checks the reason and that the after-the-moves values still match.
   - `END_FACT` is dropped.
6. **Other scripts:**
   - `case-types.ts`: `CaseMon.carried`, `CaseMon.moves`, `CaseMon.lastMove`, `Case.weatherTurns` and `Case.canSwitch`, plus `StepResult.effects` and `OracleResult.afterTurn` and `residuals`.
   - `app-turn.ts`: maps them. `canSwitch` is true, since there is one bench Pokémon per side.
   - `gen-tests.ts`: emits `endOfTurn` and effect expectations into `tests/unit/doubles-turn-showdown.test.ts`, and the volatiles, hazards and endOfTurn into the E2 test.
7. **Regression.**
   - Re-run all 556 cases. Their after-the-moves fields must be byte-equal to `results/` and `app-results/`.
   - The allowed differences are listed by a script:
     - the turn facts (the removed fact and the new assumptions);
     - cases that were not estimated with the sleep, freeze, confusion, HP-status or `notModelledBefore` reason of an M or C move, which become ready and are validated by the oracle;
     - cases whose last action is a switch-out, which gain end-of-turn not estimated.

### 7.1 Cases

All cases run three walks and are exhaustive unless marked. The games shown are the cases' games.

**Status (S):**

| Id | Games | Setup | Checks |
|---|---|---|---|
| S01 | sv champions usum swsh | Hypnosis/Spore into a slower attacker; Early Bird variant | no wake at the first BeforeMove; Early Bird 1/3 |
| S02 | sv champions | Spore into Grass, Overcoat, Safety Goggles; Electric Terrain grounded vs Flying; Misty Terrain | powder and terrain blocks |
| S03 | sv | Sleep Powder into a Chesto/Lum holder that moves later; Thunder Wave into Lum; a foe's Unnerve stops it | cured at the Update |
| S04 | sv | Yawn this turn (E2 `yawn`); carried Yawn → sleep at 23 → Bad Dreams → Lum at the final Update | order 23/28.2/final Update |
| S05 | sv champions usum swsh | Thunder Wave on a faster foe | re-sort gen 8+, frozen gen 7; 1/4 vs 1/8 |
| S06 | sv | Thunder Wave into Ground, Electric, Limber, Volt Absorb, Motor Drive, a Lightning Rod partner | immunity, absorb, redirect |
| S07 | sv | Glare into Ghost; Stun Spore into Grass; Poison Powder into Steel; Corrosion Toxic into Steel | type rules |
| S08 | sv | Will-O-Wisp then physical hits (Guts, Facade); into Flash Fire, Well-Baked Body, Water Veil | halving; absorbers |
| S09 | sv champions | Toxic, Toxic Thread (−1/−2), Poison Gas; Purifying Salt; Synchronize; Pastel Veil ally; Immunity | setStatus |
| S10 | sv champions usum | Confuse Ray, then the target attacks | 33% × 16 rolls; lowest/highest walks |
| S11 | sv | Swagger (+2 self-hit), Flatter; Own Tempo; Safeguard; Misty Terrain | boosts land, confusion blocked |
| S12 | sv | Self-hit into Sturdy, Focus Sash, Endure; Magic Guard + Sitrus; Assurance after | Damage event; no EE |
| S13 | sv | Teeter Dance (ally + foes; Own Tempo), then each moves; one No move; one No move under Gravity; one Taunted No move | Splash rules (C5) |
| S14 | sv | Taunt then a status move; Oblivious; Aroma Veil ally; Mental Herb; Taunt on a target that already moved | cant Taunt |
| S15 | sv champions | Charm/Fake Tears/Screech into Clear Body, Clear Amulet, Mirror Armor, Defiant, Competitive, Contrary, Simple, Hyper Cutter, Big Pecks; an ally's Spicy Extract into Defiant and Clear Body | applyBoosts |
| S16 | sv | Growl/Leer/String Shot/Cotton Spore spread (Grass immune to powder); Wide Guard; Soundproof foe; Venom Drench on one poisoned foe | spread status |
| S17 | sv | Sweet Scent into Defiant, Competitive, Mirror Armor; Sand Attack into Keen Eye and Clear Body | unstored stages react |
| S18 | sv | Iron Defense / Calm Mind / Cotton Guard then a slower hit; Agility (E2 Speed); Growth in sun; Shell Smash + White Herb then a hit | self boosts read |
| S19 | sv champions | Coaching, Decorate, Aromatic Mist, Howl (Soundproof ally); Dragon Cheer on a Dragon ally with Scope Lens + Night Slash (certain crit) and on a non-Dragon (not) | ally boosts; crit |
| S20 | sv | Haze before a +2 attacker; Haze and Opportunist | reset |
| S21 | sv usum | After You on a slow ally (and on a target that moved: fails); Quash on the fastest foe; two quashed actions | order |
| S22 | sv champions | Recover/Slack Off at low HP; Triage Recover (+3); Roost (non-Flying user); Milk Drink on the ally (Champions); Moonlight in sun/rain/sand with Umbrella; Shore Up in sand | heal amounts |
| S23 | sv | Heal Pulse (Mega Launcher), Floral Healing in Grassy Terrain, Life Dew, Jungle Healing (cures), Pollen Puff on an ally | ally heals |
| S24 | sv | Strength Sap on a +2 Atk foe; Big Root; Liquid Ooze target; at −6 | Strength Sap |
| S25 | sv | Pain Split with a Sitrus on the higher one | joint map + Update |
| S26 | sv | Belly Drum + Sitrus; at exactly half (fails); Fillet Away; Clangorous Soul at maxhp not divisible by 100 (C1); Ghost Curse that faints its user; non-Ghost Curse re-sort | costs |
| S27 | sv | Substitute, then a foe's Thunder Wave (fails), Sing (passes, sound), an Infiltrator Taunt (passes) | status vs Substitute |
| S28 | sv | Memento then the target attacks; Memento into Protect (the user stays) | faint ifHit |
| S29 | sv | Healing Wish, Lunar Dance; `canSwitch` false (fails) | faint; fact |
| S30 | sv | Rest at 1/3 poisoned, then a foe's hit; Rest at full (fails) | Rest |
| S31 | sv | Endure + a KO hit; + a multi-hit; + Focus Sash (Sash kept); Endure last (fails) | C2 |
| S32 | sv swsh | Destiny Bond then a KO (Soul-Heart, faint count); a Dynamaxed attacker (immune); an ally's KO (no) | Destiny Bond |
| S33 | sv | Magic Bounce vs Thunder Wave; vs String Shot (user's side); vs Taunt with Follow Me on the user's side (bounced move redirected); Mold Breaker passes; vs Stealth Rock (E2 hazards) | reflection |
| S34 | sv | Prankster Thunder Wave into a Dark foe and a Dark ally; into a grounded target on Psychic Terrain; vs Quick Guard; vs Armor Tail and Dazzling (TryMove); Prankster Perish Song vs Dazzling | C6 |
| S35 | sv | Safeguard vs Swagger, Thunder Wave, Yawn; an Infiltrator foe passes; vs the ally's Teeter Dance | Safeguard |
| S36 | sv | Good as Gold vs a foe's and an ally's status move; Soundproof vs Sing and Perish Song (user with Soundproof still counts) | TryHit |
| S37 | sv | Follow Me + Thunder Wave/Spore; Rage Powder vs a Grass user's Spore; Lightning Rod partner vs Eerie Impulse; Sap Sipper vs Spore; Stalwart user | redirection, absorb |
| S38 | sv | Leech Seed this turn → drain; into Grass; into a Substitute; Liquid Ooze; Big Root | with EOT |
| S39 | sv | Aqua Ring + Ingrain this turn; Ingrain on a Flying user then Earthquake (guard); Magnet Rise then Earthquake (guard); Magnet Rise in Grassy Terrain, no later hit (no heal) | C rules |
| S40 | sv champions | Perish Song (E2 counts) | perish |
| S41 | sv champions usum | carried sleep attempts 0, 1, 2; Early Bird; Rest | posterior vs expansion |
| S42 | sv champions | carried freeze (SV 1/5; Champions 0, 1, 2); Flare Blitz thaws its user; a Fire hit thaws the target | thaw |
| S43 | sv | carried confusion 0–4 vs expansion; Axe Kick; Persim, Lum | snap-out |
| S44 | sv champions | Disable/Encore with `lastMove`: still to act (equal → fails / unchanged; different Encore → guard); already acted; `null` (fails) | C rules |
| S45 | sv champions | Imprison with `moves`: a foe's Protect fails | cant Imprison |
| S46 | sv | Charge (Sp. Def +1) then a special hit; Focus Energy twice (fails) | E2 builds |
| S47 | sv | Uproar with a sleeper (guard); Sleep Talk asleep (guard); Snore asleep and after waking | guards, Snore |
| S48 | sv | Reason-only: an L representative of each family with a later action and as the last action (Ally Switch, Trick, Skill Swap, Soak, Attract, Transform); Encore without `lastMove`; Imprison without `moves`; a hit into a Substitute; Pain Split + Dynamax (swsh); Disguise self-hit; Roost guard; Parting Shot with a later action; Parting Shot into Clear Body (modelled, no switch); Teleport with `canSwitch` false (modelled) | exact reasons + start rows |
| S49 | sv | Teeter Dance + Quick Claw + four movers + ties (`oracle: "modes"` above 200k runs) | budget |
| S50 | sv | Toxic, Will-O-Wisp, Spore this turn, then the end of turn (stage 0, burn, Bad Dreams on the new sleeper) | moves → EOT |

**End of turn (R).** Ids keep the EOT design's numbers where a case was kept. R24, R26, R30, R33, R35, R36 and R42–R44 were cut or merged (into S04, R11, R21 and R41).

| Id | Checks |
|---|---|
| R01 | sand immunities: types, Overcoat, Sand Veil, Safety Goggles, Magic Guard |
| R02 | USUM hail; R03 SV snow (Ice Body heals, no damage) |
| R04 | rain: Rain Dish, Dry Skin, Hydration; Utility Umbrella |
| R05 | sun: Dry Skin, Solar Power; Umbrella |
| R06 | Cloud Nine holder alive vs knocked out during the moves |
| R07 | the weather's Update (Sitrus after sand), then Leftovers |
| R08 | final Update; a Salt Cure KO before a Berry due from poison (no Update between) |
| R09 | order 5 Speed before subOrder; Trick Room reversed; Champions Trick Room |
| R10 | Grassy grounding: Flying, Levitate, Air Balloon, Iron Ball, Gravity, Smack Down this turn; Dig/Fly charge turns |
| R11 | weather/terrain set this turn act; `weatherTurns` 1 ends without acting; the assumption fact |
| R12 | Leftovers, Black Sludge (Poison and not), Sticky Barb |
| R13 | burn, Heatproof |
| R14 | poison, carried stage 3, Poison Heal, Toxic Orb (no damage this turn) |
| R15 | Baneful Bunker / Burning Bulwark status this turn → the end of turn |
| R16 | carried Leech Seed; seeder knocked out in the moves; seeder faints to sand first; Big Root; Liquid Ooze; empty seeder slot |
| R17 | mutual Leech Seed at equal Speed (permutations) |
| R18 | Fire Spin this turn and carried; Binding Band; trapper knocked out (no damage); trapper faints to sand first |
| R19 | Salt Cure (Champions 1/16, SV 1/8; Water/Steel); Sheer Force; Covert Cloak; trap + Salt Cure tie on one Pokémon (C9) |
| R20 | Ghost Curse carried and this turn |
| R21 | carried Aqua Ring and Ingrain + Big Root; Psychic Noise this turn blocks them, Leftovers and a Sitrus at the final Update |
| R22 | Healer (Champions 1/2, SV 3/10) before poison; holder faints to sand first |
| R23 | Shed Skin 33% before burn |
| R25 | Bad Dreams: holder at 0 HP; Comatose target; Magic Guard |
| R27 | carried perish 1 (faints) and 3 → 2 |
| R28 | carried Wish; full HP (no heal) |
| R29 | Speed Boost (E2); carried Syrup Bomb with Mirror Armor, White Herb, Eject Pack fact |
| R31 | Emergency Exit at the end of turn (fact); a Sitrus at the final Update keeps it above half (none) |
| R32 | reason-only: U-turn, Eject Button, Emergency Exit on the last action |
| R34 | Dynamax in sand (base max HP; fact) (swsh) |
| R37 | Tailwind this turn reorders the residuals |
| R38 | an Unnerve holder at 0 HP: Berries eaten at the final Update |
| R39 | a commuting tie (two burned at equal Speed) |
| R40 | Soul-Heart on a residual faint |
| R41 | reason-only: Neutralizing Gas holder faints in the residual; Pickup; Harvest itemless; carried Cud Chew; carried Future Sight; Moody (E2); Zen Mode line; G-Max Wildfire (swsh) |
| R45 | Desolate Land holder fainting in the residual ends the sun (E2 field) |

---

## 8. Build plan (disjoint ownership)

**Step 0, Contract and kernel (one builder, before everything).**
- Owns §3 in full:
  - `doubles-types.ts`;
  - `types.ts` (the two fields);
  - `doubles-world.ts` (state, `lossDist` and `mapJoint` signatures);
  - `doubles-turn.ts` (kernel, moved code, hooks, endOfTurn stub);
  - `uses-to-ko.ts` (the `UsesEnv.endure` line only);
  - `doubles-actions.ts` (REASONS additions; tables unchanged);
  - stub files `doubles-status.ts` and `doubles-eot.ts`.
- **Gate:** `npm run check`, golden-1v1 byte-equal, and the 556 app results byte-equal (facts included).

After Step 0, `doubles-turn.ts` is frozen. Only the integrator edits it, for agreed one-line fixes.

| Track | Owns (exclusive) | Depends on | Gate |
|---|---|---|---|
| A. Engine: status | `doubles-status.ts`, `status-table.ts`, `doubles-actions.ts` (tables, derived sets), `calculate.ts` (Triage, `critRatio` fields), `tests/unit/doubles-status.test.ts`, `tests/source/doubles-status-moves.test.ts`, `doubles-third-party.test.ts` | Step 0 | unit + source tests; golden byte-equal; existing doubles tests; S cases pass once D runs them |
| B. Engine: end of turn + Training | `residuals.ts`, `doubles-eot.ts`, `uses-to-ko.ts` (`residuals()` adapter), `app/(app)/training/sim/bridge.ts`, `sim/tracker.ts` (Rest and Axe Kick flags), `ai/evaluate.ts`, `scripts/training/conformance.ts`, `scripts/training/leak.ts`, `tests/unit/residuals.test.ts`, `doubles-eot.test.ts`, `doubles-outcomes.test.ts`, `training-*` tests, `tests/source/doubles-residuals.test.ts` | Step 0 (Training part after A's statusMove lands) | golden byte-equal after the adapter; R cases; Training gates |
| C. UI | `doubles-format.ts`, `DoublesCard.tsx`, `DoublesTurn.tsx`, `BattleConditions.tsx` (2v2 section), `doubles-prep.ts`, `useDoublesView.tsx`, `calculator.module.css`, `tests/unit/calculator-doubles-ui.test.ts` | Step 0 (contract only; fixture results) | UI tests; 375 px no overflow; facts-only text review |
| D. Validation | `scripts/.cache/calc-audit/2v2/verify/*` (sim-dfs, case-types, cases, compare, app-turn, gen-tests, bench), generated `tests/unit/doubles-turn-showdown.test.ts` | oracle side: none; app comparison: A and B | all cases pass; 556 regression; bench; reference equality |

**Order:**
1. Step 0.
2. A, B, C and D in parallel. D builds the oracle side, prepares the cases and runs the oracle immediately. B's Training part waits for A's pipeline: both write `bridge.ts` inputs that A's engine reads, so B starts Training after A's first green S run.
3. **Integration** (one builder):
   - run all cases (556 + S + R) and regenerate the tests;
   - `npm run check`;
   - golden;
   - bench;
   - `conformance:training`, `leak:training`, `eval:training`;
   - a live check of `/calculator` 2v2: Thunder Wave + Body Slam; Spore with an asleep carried counter; sand + Leftovers; Leech Seed; the not-estimated end-of-turn line; 375 px.
4. **Review:** three reviewers (status engine, end of turn + Training, UI), then one fixer. Reviews are capped at 2 rounds.

---

## 9. Test plan

- **Unit (tests/unit):**
  - **`doubles-status.test.ts`:**
    - BeforeMove order and facts, including No move under Gravity and Taunt;
    - the posterior tables of §4.2 exactly, including Early Bird, Rest and Axe Kick;
    - the `canStatus` blocker matrix, one row per blocker, with Mold Breaker and Ability Shield;
    - `applyBoosts` (Mist excluded): Clear Body, Mirror Armor, Defiant (foe only), Contrary, Simple, the cap, accuracy and evasion;
    - each heal formula at an odd maximum HP;
    - confusion damage: Snorlax 23–28, +2 Atk 46–55, Wonder Room;
    - Clangorous Soul at maxhp 301;
    - order keys for gens 8+ and 7;
    - every new REASONS text;
    - reference equality on 20 status turns;
    - contract validation issues.
  - **`residuals.test.ts`:** each id's amount and key; Magic Guard; Heatproof; Big Root rounding (22 → 29, 19 → 25).
  - **`doubles-eot.test.ts`:**
    - `endOfTurn.hp` equals `hp` when nothing acts;
    - hit KO + residual KO equals the after-turn koChance;
    - E2 mixture equals `endOfTurn.hp`;
    - a guard keeps the moves;
    - ties are permuted only when they interact (C9);
    - reference mode gives the same results.
  - **`doubles-outcomes.test.ts`:** volatiles, sleepTurns, perishCount, hazards (Magic Bounce), safeguard, endOfTurn.
  - **`doubles-turn-guards.test.ts`:** updated texts.
  - **`calculator-doubles-ui.test.ts`:** labels (After the turn / After the moves), effect hit lines, losses, conditions, the End of turn list and its not-estimated line, the Q1 controls and their facts, no overflow at 375 px.
  - **Training:** bridge mapping (public counts only; rollout reasons), evaluate (applied → no residual; volatiles; hazards).
- **Source (tests/source):**
  - **`doubles-status-moves.test.ts`:**
    - every catalog Status move has exactly one table entry, with the kind of `spec-classify.ts`;
    - per game, the pinned dex's flags, target, priority, boosts, self-boosts, status, volatile and `ignoreImmunity` equal the table's;
    - a move with an `onHit`, `onTry`, `onTryHit`, `onHitField` or condition handler has a `handler` or kind L, N, S, P or X;
    - the BeforeMove priorities equal the pinned `onBeforeMovePriority` values: slp/frz 10, flinch 8, disable 7, gravity and throatchop 6, taunt 5, imprison (onFoe) 4, confusion 3, par 1, destinybond −1.
  - **`doubles-residuals.test.ts`:** every pinned residual handler (as `inventory.ts` lists them) is classified as modelled (keys equal `RESIDUAL_KEYS`), state-only, guarded, or unreachable in the four catalogs.
  - **`doubles-third-party.test.ts`:** Sweet Veil, Pastel Veil, Flower Veil (status and drops), Magic Bounce, Good as Gold, Oblivious, Own Tempo, Synchronize, Early Bird, Healer, Hydration, Shed Skin, Bad Dreams and Big Root move to modelled. Pickup, Harvest, Cud Chew and Moody (E2) are guarded.
- **1v1:** `golden-1v1.full.json.gz` byte-equal; `calculator-uses-to-ko*` unchanged.
- **Oracle:** §7 (556 + 50 S + ~38 R).
- **Bench:** §4.10.

---

## 10. Risks

- **Interaction volume.** Status moves touch many abilities and items. Mitigations:
  - the per-game table is source-tested against the pinned dex;
  - every unmodelled interaction has a named guard;
  - S48, R32 and R41 pin the guard texts.
- **The Step 0 refactor of `doubles-turn.ts`** (moved code, hooks, kernel) could change behaviour silently. Its gate is byte-equality of all 556 app results and golden before any track starts.
- **1v1 extraction.** The adapter must reproduce today's ops, names and orders (C14). The golden gate catches drift, and there is a fallback (§4.8).
- **World growth.** Per-Pokémon BeforeMove branches, Healer and Shed Skin, tie permutations and faint splits all add worlds. They are bounded by BUDGET; S49 and the bench measure them. The lazy faint split is an optimisation and never applies in reference mode.
- **Hidden information in Training.** Counters come only from the tracker's public counts, never `statusState.time`. The leak gate covers the new fields. Belief-world values (Wish HP, Binding Band, moves) are exact per belief world, as items already are.
- **Behaviour changes users will see:**
  - the card's HP becomes after-the-turn;
  - a U-turn or Parting Shot as the last action now shows "End of turn not estimated" where today the turn shows no end of turn at all;
  - status moves that were "not estimated" become estimated, and their numbers can differ from what users assumed.

  The labels and the panel state each of these as a fact.
- **Pre-existing gaps the build fixes on the way:** a confused No-move Pokémon's self-hit (C5); a carried Heal Block silently ignored (C12).

---

## 11. Open questions for the user (each with a recommended default)

1. **Calculator inputs for state from earlier turns.**
   - **Default:** four compact 2v2-only controls in Field conditions: turns lost to sleep (plus Rest sleep), turns lost to freeze (Champions), confusion and its turns, and bad poison turns. Left alone, each gives an `Assumes …` fact. Leech Seed, traps, Salt Cure, Curse, Aqua Ring, Ingrain, Yawn, Perish, Wish and the last move have no calculator input: the calculator assumes none of them, and Training passes them.
   - **Alternative A:** also add a per-slot "Last move" select, so Encore and Disable on a Pokémon still to act are estimated in the calculator.
   - **Alternative B:** no controls; always assume 0, with the facts.
2. **The 76 status moves left out of this build** keep today's "not estimated" when they come before another move, and get an end-of-turn "not estimated" when they are the last action. They include Ally Switch, Trick/Switcheroo, Skill Swap and the other ability changers, Attract, Magic Coat, Crafty Shield, Psych Up, Defog, the rooms and the type changers.
   - **Default:** a follow-up build ("status moves 2") that starts with Ally Switch (position-aware targeting across the engine) and Trick (items acting on receipt).
   - **Alternative:** pull Ally Switch and Trick into this build, which adds that machinery to Track A.
3. **Damaging hits into a Substitute.**
   - **Default:** not estimated (`Hits on {Name}'s Substitute are not modelled.`), while status moves into a Substitute are modelled.
   - **Alternative, as a follow-up:** model the Substitute's HP as discrete state, with recoil, drain and Life Orb from the damage dealt to it, and a multi-hit continuing into the Pokémon.
