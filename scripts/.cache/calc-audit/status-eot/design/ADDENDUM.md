# ADDENDUM to SPEC.md: Ally Switch, Trick / Switcheroo, hits into a Substitute

Branch `calc-2v2-status-eot`. This is a paste-ready delta to `SPEC.md` (same folder). Section numbers mirror SPEC's; a
section not named here is unchanged. Ground truth is pinned Showdown `c23d2e94` (read-only source cited `PS/…`); every
mechanic below was run in the runnable copy and is cited by probe output line. Where this addendum and SPEC disagree,
this addendum wins.

**The user's answers to SPEC §11 (settled):**
- **Q1, the default.** The four compact 2v2-only Field-condition controls, no "Last move" input.
- **Q2, the alternative.** Ally Switch and Trick / Switcheroo are modelled in this build. The other L moves stay L (Bestow included).
- **Q3, the alternative.** Damaging hits into a Substitute are modelled now, with the Substitute's HP as discrete state.

**Probes (this addendum):**
- Harness `addendum-sim.ts`: status-sim.ts's exact enumeration and forcing, plus an `inspect` hook read when the residual is picked and at the turn's end.
  - A multiaccuracy move's later hits are forced to hit, as the oracle does (`2v2/verify/sim-dfs.ts:234`).
  - No two Pokémon of a case share a Speed.
- `addendum-probes-1.ts` → `addendum-probes-1.out`: A1–A11, Ally Switch.
- `addendum-probes-2.ts` → `addendum-probes-2.out`: T1–T12, Trick, Switcheroo (T9b records Bestow for the later build).
- `addendum-probes-3.ts` → `addendum-probes-3.out`: U1–U17, Substitute hits.
- `critic-probes-1.ts` → `critic-probes-1.out`: K1–K8, the critic's checks (Rage Fist's count, Liquid Ooze with Big Root, Shed Tail's Substitute, tracking moves after Ally Switch, Mummy, Knock Off, Steel Beam and Shell Bell, Rocky Helmet after a break).
- Earlier probes reused: `status-probes-2.out` Q1, Q4, Q6, Q6b; `status-probes-3.out` R11, R11b, R19.

Citation form: `p1:N` = `addendum-probes-1.out` line N, and likewise `p2:N`, `p3:N`; `k:N` = `critic-probes-1.out` line N.

---

## 0. Decisions in one page (delta to SPEC §0)

1. **Positions (Ally Switch) are modelled.**
   - A slot id stays the Pokémon as it started the turn: factors, `ctx.hp`, steps, cards and outcomes are keyed by it.
   - `World.swapped` records a side whose two Pokémon swapped. `positionOf` and `occupant` map between Pokémon and positions.
   - Every position read goes through them: chosen targets, spread order, the across-fallback, Leech Seed's gainer, Wish's slot.
   - The gen 9 repeat counter is branched exactly. The calculator states a fact; Training passes the public streak.
2. **Items moved by Trick and Switcheroo are modelled.**
   - In all four games. Bestow stays L (Q2: the other L moves are for a later build).
   - The item change is per world (`MonState.build.itemId`), exactly as Knock Off, Bug Bite / Pluck and eaten Berries already change it. Every later calculation, Speed sort and the end of turn read the new holder.
   - Items that act on receipt are modelled where exact. A Terrain Seed in its terrain, Room Service under Trick Room, and Booster Energy for a Protosynthesis / Quark Drive holder get a narrow reason.
3. **Hits into a Substitute are modelled.**
   - The Substitute's HP is discrete state, `MonState.vol.substitute`. The damage taken is capped at its HP, and it breaks at 0.
   - The attacker's recoil, drain and self-cost come from the damage the Substitute took, inside that hit. Life Orb applies once per move; recoil from the hits after the break, Shell Bell and a second self-cost need damage to the Pokémon.
   - A multi-hit move continues into the Pokémon. Spread moves hit it with the spread modifier. Sound moves and Infiltrator pass it.
   - None of the target's on-hit reactions run, except an Air Balloon popping. Once a hit after the break reaches the Pokémon, its hit count (Rage Fist) takes every hit of the move.
   - A Substitute from Shed Tail keeps its maker's HP.
   - `REASONS.substituteHit` goes away. Two narrow reasons, `intoSubstitute` and `subPerHit`, cover what stays unmodelled (§2.4).
4. **One more calculator control, beside Q1's four:** a per-slot `Substitute` checkbox with its HP, for a Substitute from an earlier turn.
   - Q3 asks for the Substitute's HP as discrete state. Without this input the calculator could hit only a Substitute made earlier in the same turn, which needs the Substitute user to move before its attacker, the rare case. The common case is a Substitute made last turn and attacked this turn.
   - It is state from an earlier turn in the same form as Q1's four controls; it is not the rejected "Last move" input.
   - Unticked means "no Substitute": no assumption fact, and nothing changes for users who leave it alone.
5. **Classification.** M 122 → 125 (`allyswitch`, `trick`, `switcheroo`); L 76 → 73 (`bestow` stays L).
6. **A new Track E** owns three new engine modules plus `subHit` in `hit-loop.ts` (§8). Step 0 additionally writes:
   - the position plumbing in `doubles-turn.ts`;
   - the hook points;
   - the turn-only Substitute part path in `uses-to-ko.ts`, in full, with its own unit tests.

   After Step 0, no track edits `doubles-turn.ts` or the part path, as in SPEC.
7. **Corrections found on the way** (§1.2):
   - SPEC §7.2's Wish `startingTurn` is off by one (C15).
   - Rapid Spin and Mortal Spin end their user's Leech Seed and partial trap; SPEC's end-of-turn hooks missed this (C16).
   - Flame Burst's splash damage is neither modelled nor guarded in 2v2 today (C17).
   - A Micle Berry eaten at the end of turn by a Cheek Pouch holder heals it; SPEC treats Micle as state only (C18).
   - SPEC C13 and §1.3 "Positions" are superseded (C13′).

---

## 1. Review (delta to SPEC §1)

### 1.2 Corrections (rows added to SPEC's table; the addendum uses these)

| # | Where | Claim | Pinned truth |
|---|---|---|---|
| C13′ | SPEC C13, §1.3 "Positions" | No Substitute HP and no positions in this build. | Superseded by Q2 and Q3: §3, §4.11–4.13. A Substitute's HP is `floor(maker.maxhp / 4)`, where the maker is the Shed Tail user for a Substitute Shed Tail passed (`PS/data/moves.ts:16162-16195` volatileStatus on the user, `PS/sim/pokemon.ts:1246-1266` copyVolatileFrom; k:339: 44 HP on a 1-HP Shedinja). |
| C15 | SPEC §7.2 (oracle) | Wish: `startingTurn = turn − 1`. | The residual needs `getOverflowedTurnCount() > startingTurn`, and on turn 1 the count is 0 (`PS/sim/battle.ts:3318-3320`). A Wish landing this turn therefore needs `startingTurn = getOverflowedTurnCount() − 1` (−1 on turn 1): A7. |
| C16 | SPEC §3.5 `eot.afterHit`, §2.3 | The listed moves are what change the end of turn. | Rapid Spin and Mortal Spin also end their user's Leech Seed and partial trap, on a hit and on a hit into a Substitute, while their user has HP and unless Sheer Force removed their effects (`PS/data/moves.ts:14704-14735`; Mortal Spin likewise at 12315-12356). Track B's `eot.afterHit` clears `eot.leechSeed` and calls `endTrap` on the user. These deletions are exceptions to SPEC §1.3's one-writer rule for `leechSeed` (writer A) and `trap` (writer B); so is Track A's Substitute ending a trap (U13). |
| C17 | 2v2 today | (none) | Flame Burst (USUM catalog only) damages the target's ally by 1/16 on a hit and on a hit into a Substitute (`PS/data/moves.ts:5564-5585` flameburst onHit, onAfterSubDamage). No code models or guards it today, and no stored oracle case uses it. Track A adds `flameburst` to `PRESENCE_MOVES`: `Flame Burst is not modelled in 2v2.` |
| C18 | SPEC §2.3 (end of turn) | Micle Berry is state only (EOT design §2: "S"). | Micle Berry's onResidual has no order, so it runs after every ordered residual (`PS/sim/battle.ts:404-411`, order 4294967296), and eats at `hp <= maxhp/4` (`<= maxhp/2` with Gluttony) through `eatItem` (Unnerve and As One stop it). Eating it runs Cheek Pouch's onEatItem, `heal(baseMaxhp/3)` (`PS/data/items.ts:4068-4080`, `PS/data/abilities.ts:492-496`), and AfterUseItem (Unburden). Track B models it as the residual `micleberry` (§2.3 delta); the 1v1 adapter leaves it out, so golden-1v1 stays byte-equal. |

### 1.4 Verified for this addendum (probe → claim → pinned source)

**Ally Switch (A).**

| Probe | Claim | Source |
|---|---|---|
| A1 sv champions swsh usum (p1:5, 16, 27, 38) | Priority +2 in all four games. A +1 move aimed at the switcher's old position hits the Pokémon now standing there (Snorlax 235→207, not Jolteon). | `PS/data/moves.ts:309`; gen 8 mod keeps it (`PS/data/mods/gen8/moves.ts:2-6`); `PS/sim/battle.ts:1588-1607` swapPosition |
| A1b (p1:59) | Fake Out (+3) comes first: the switcher flinches, no swap. | BeforeMove flinch |
| A2 (p1:76, 94, 112, 130) | After its ally's Ally Switch, a user aiming at its ally stands at the aimed position. Body Slam, Heal Pulse, Pollen Puff and Aromatic Mist (adjacentAlly) then fail `[notarget]`. | `PS/sim/battle.ts:2456-2462` getTarget returns null for adjacentAlly/any/normal at the user's own loc; `PS/sim/battle-actions.ts:463-467` |
| A2 Dragon Darts (p1:149-150) | Dragon Darts in that spot hits its user and the ally. | `PS/sim/battle.ts:2449-2454` (smartTarget before the self check); `PS/sim/pokemon.ts:756-768` |
| K4 (k:128-134, 146-152, 164-171) | Snipe Shot and a Stalwart user aimed at their own ally that switched hit that ally (Lapras 205→176, 205→150); a plain Body Slam fails `[notarget]`. | `PS/sim/battle.ts:2444-2447`: the original target, still active, is returned before the self-position failure |
| A3 (p1:166, 170) | Follow Me follows the Pokémon: a move aimed at its old position goes to it at its new one. | getMoveTargets RedirectTarget (`PS/sim/pokemon.ts:830`) |
| A4 (p1:180, 191; plain Body Slam p1:202) | Stalwart and Snipe Shot keep the Pokémon chosen at queue time; a plain move hits the new occupant. | `PS/sim/battle-queue.ts:268` originalTarget; `PS/sim/battle.ts:2440-2447` |
| A5 (p1:213) | A spread move hits the foes in their new position order. | `PS/sim/pokemon.ts:732-735`, `:809-814` |
| A6, A6b (p1:233, 252) | Leech Seed heals whoever stands at the seeder's slot (Snorlax, which moved in), and drains the seeded Pokémon wherever it stands. | `PS/data/moves.ts:10218-10227` getAtSlot(sourceSlot) |
| A7 (p1:271) | A Wish heals whoever stands at its slot (Snorlax +70, the wisher Jolteon's half). | `PS/data/moves.ts:20925-20942` slotCondition; swapPosition moves side.active, not slotConditions |
| A8 sv champions (p1:291, 314); swsh usum (p1:319-356) | A second use the next turn works 1/3 in SV and Champions, and always in SwSh and USUM. | `PS/data/moves.ts:311-313`, `:332-352`; `PS/data/mods/gen8/moves.ts:2-6` (gen 7 inherits gen 8) |
| A9, A9b (p1:369, 388) | Ally Switch fails with a fainted ally: fainted before the turn, or earlier this turn. | `PS/data/moves.ts:322-328` |
| A10 (p1:401) | A random-target move after a swap picks among the living foes, 1/2 each. | getRandomTarget |
| A11 (p1:417-425, 428ff) | The counter rolls at PrepareHit, before onHit's fainted-ally failure. A pass gives counter 9 and `-fail\|X\|move: Ally Switch`; a fail gives a plain `-fail\|X` and the volatile is gone. The volatile has duration 2. | `PS/data/moves.ts:311-313`, `:338-352`, `:333` |

**Items moved by moves (T).**

| Probe | Claim | Source |
|---|---|---|
| T1 sv champions swsh (p2:9, 20, 31) vs usum (p2:42) | A Choice Scarf tricked onto Snorlax (50→75) moves it ahead of Chansey (70) from gen 8. Gen 7 keeps the start order. | Choice Scarf onModifySpe; gen 8+ re-sort (SPEC §2.2) |
| T2 (p2:53, 63) | Iron Ball halves Speed (re-sort) and grounds its holder: Earthquake then hits Gyarados. | `PS/sim/pokemon.ts` isGrounded |
| T3 (p2:89) | Life Orb moves with the item: the receiver's later hit costs it 1/10 (23 of 235). | `PS/data/items.ts:3400-3415` |
| T4 (p2:106, 128, 147, 170, 196) | On receipt: Sitrus is eaten at ½ HP; Lum cures paralysis; White Herb restores lowered stages inside setItem's Start; Mental Herb ends Taunt; a Figy Berry is eaten at ¼ HP and confuses a −Atk nature (then a 1/3 self-hit). | `PS/sim/pokemon.ts:1868-1889` setItem → Start; the item's onUpdate at the Update |
| T4b (p2:210, 229) | A Klutz receiver or Magic Room: the Sitrus is held, not eaten. | itemWorks; singleEvent skips an ignored item |
| T5 (p2:253, 269, 288, 303, 323) | Mold Breaker does not pass Sticky Hold (immune). A Substitute, Protect and both item-less make Trick fail. A Sticky Hold user may Trick its own item away. | `PS/data/moves.ts:19875-19877` (hasAbility, not breakable); `PS/data/abilities.ts:4622-4630` (source === pokemon passes) |
| T6 (p2:329-504) | Fail: a Plate from Arceus or to Arceus; Booster Energy to a Paradox Pokémon; a Mega Stone from or to its species (Champions); Rusted Sword from Zacian; a Z-Crystal. Booster Energy to a non-Paradox holder does nothing (p2:399ff). | `PS/data/moves.ts:19879-19893` (takeItem with the holder, singleEvent TakeItem with the receiver); `PS/data/items.ts:2163, 793, 643, 5415, 1822` |
| T7, T7b (p2:512, 523) | Unburden: losing the item and getting none doubles Speed at once (Hawlucha re-sorted ahead of Dragapult). Receiving one stops it while held; the volatile stays. | `PS/data/abilities.ts:5235-5252` |
| T8 (p2:532, 543, 558, 569, 576) | The end of turn reads the new holder: Leftovers +14; Black Sludge −29 on a non-Poison type; Toxic Orb and Flame Orb give their status with no damage this turn; Sticky Barb −29. | residuals by holder |
| T9 (p2:597) | Switcheroo is Trick (gen 7's Switcheroo mod is equivalent: `PS/data/mods/gen7/moves.ts:952-983`). | `PS/data/moves.ts:18645-18690` |
| T9b usum (p2:615, 633, 652, 670) | Bestow, recorded for the later build (it stays L): it passes Protect and a Substitute, fails into a holder, and Sticky Hold does not stop it. | `PS/data/moves.ts:1236-1258` |
| T10 (p2:690-693) | A received Air Balloon makes a later Earthquake miss. | Air Balloon onStart; isGrounded |
| T10b, T10c (p2:715, 729; 761, 782) | A Seed or Room Service can only arrive unused from a giver that cannot use it (Klutz). The receiver then uses it inside setItem: Room Service Spe −1, Electric Seed Def +1. | items' onStart |
| T11 (p2:742) | Symbiosis does not pass an item after Trick. | `PS/data/abilities.ts:4837-…` onAllyAfterUseItem; Trick runs takeItem/setItem, no useItem |
| T12 (p2:810-812) | The Trick user receiving a Sitrus below ½ eats it at once. | as T4 |

**Hits into a Substitute (U, K).**

| Probe | Claim | Source |
|---|---|---|
| U1 (p3:9-12) | Damage into a Substitute is capped at its HP. Ice Beam left a 40-HP one at 15–19 with the roll shares; Snorlax's HP is unchanged. | `PS/data/moves.ts:18342-18372` onTryPrimaryHit |
| U2, U2b (p3:22, 40) | Recoil comes from the damage the Substitute took: round(30·33/100)=10, round(81·33/100)=27. | `:18363-18365` applyRecoilDamage(damage); `PS/sim/battle-actions.ts:1379-1398` |
| U2c (p3:58, 76) | Drain is ceil(23·3/4)=18, not the round (17) a hit on the Pokémon uses. Big Root gives 23. | `:18366-18368` Math.ceil; `PS/sim/battle.ts:2170-2172` round |
| U2d (p3:98); K2 (k:81, 99, 117) | The target's Liquid Ooze deals the drain amount to the attacker instead: the unmodified `ceil(taken·drain)` (10 with and without Big Root), and also at full HP. | Liquid Ooze onSourceTryHeal `PS/data/abilities.ts:2402-2410` gets TryHeal's value before Big Root's chainModify is applied; TryHeal runs before heal()'s full-HP check (`PS/sim/battle.ts:2271-2275`) |
| U3 (p3:116, 134, 158); K7 (k:289-313) | Life Orb costs 1/10. Shell Bell heals nothing (Talonflame 137→110: recoil 27 only). A Gem is spent. Steel Beam costs ½ once (139→61). | `PS/sim/battle-actions.ts:535-545` AfterMoveSecondarySelf on a move that hit; `:958-965` totalDamage counts no Substitute damage; `:981-982` recoil after the hits only with totalDamage; `PS/data/items.ts:5646-5657` |
| U4 (p3:162-178); U4b (p3:183-199); U4c (p3:206-221); U4d (p3:226-242) | A multi-hit move puts its hits into the Substitute until it breaks, then the rest into the Pokémon. | each hit runs spreadMoveHit → TryPrimaryHit while the volatile is up (`PS/sim/battle-actions.ts:947`, `:1057-1064`) |
| ↳ U4 | Icicle Spear: 3 hits into a 30-HP Substitute, 2 into Snorlax. | |
| ↳ U4b | Bullet Seed 2–5: 2 hits into a 50-HP Substitute, the rest into Snorlax (the 2/3/4/5-hit shares). | |
| ↳ U4c | Triple Axel keeps its absolute-index powers 40, 60 after a 20-BP break. | |
| ↳ U4d | A Focus Sash at full HP saves the Pokémon on the first hit into it. | |
| K8 (k:321, 330-332) | A contact multi-hit move whose first hit breaks the Substitute meets Rocky Helmet once, for the one hit on the Pokémon (Scizor 145→121). | DamagingHit only for the Pokémon's hits (`PS/sim/battle-actions.ts:1121`) |
| K1 (k:9, 21, 32, 40, 51) | Once a hit after the break reaches the Pokémon, its hit count takes every hit of the move (5, Rage Fist then at 300 power: Shuckle 95→2); while every hit met the Substitute it takes none (0: 95→79). | `PS/sim/battle-actions.ts:990-996`: gotAttacked and `timesAttacked += hit - 1` for the last hit's targets, null after a hit on the Substitute |
| U5 (p3:253) | A spread move hits the Substitute with the spread modifier (38 = the other identical Snorlax's 38). | getDamage spreadHit |
| U6 (p3:272, 291) | Hyper Voice (sound) and Infiltrator pass it. | `PS/data/moves.ts:18343` |
| U7 (p3:301-452); K6 (k:238, 255, 272) | Behind it, none of these act: Rough Skin, Rocky Helmet, Weakness Policy, Stamina. A resist Berry is neither eaten nor halves (Occa 196 = 196 without it; Colbur 146 = Leftovers 146). Knock Off keeps ×1.5 for any removable item, the Berry included (146 vs 100 with no item), and takes nothing. Air Balloon pops. | targets[i] = null after HIT_SUBSTITUTE (`PS/sim/battle-actions.ts:1062-1064`): no DamagingHit, Hit, AfterHit, AfterMoveSecondary on it; `PS/data/items.ts:365…7775` hitSub checks; `PS/data/moves.ts:9969-9975` Knock Off onBasePower; `PS/data/items.ts:203-210` Air Balloon onAfterSubDamage |
| K5 (k:182, 196-206, 220) | Behind a Substitute the target's Mummy does not act, so the attacker keeps Technician for every hit (Dual Wingbeat 22 + 22); without it, hit 2 deals 15 after Mummy. The engine's multi-hit loop swaps the ability after hit 1 on contact. | no DamagingHit; `@smogon/calc dist/mechanics/util.js` checkMultihitBoost (ability swap at its end) |
| U8 (p3:468-469, 487, 506, 521, 541, 549, 567, 586) | The user's own effects still happen: Close Combat's drops, Flame Charge's Spe +1, U-turn switches out, Rapid Spin ends the user's Leech Seed and gives Spe +1, Ice Spinner ends the terrain. None happen on the target: Fake Out's flinch, Nuzzle's paralysis, Dragon Tail's drag. | `PS/sim/battle-actions.ts:1317-1334` selfDrops and `:1336-1351` secondaries skip only `false`; `:1290-1296`, `:1311-1312` selfSwitch; `:1353-1369` forceSwitch needs a target; `PS/data/moves.ts:14720-14735`, `:9430-9434` onAfterSubDamage |
| U9 (p3:598) | An intact Disguise behind it does not neutralise the hit, and Mimikyu stays disguised. | `PS/data/abilities.ts:979-1001` hitSub returns |
| U10, U10b (p3:615, 642) | A Substitute broken this turn lets a later Will-O-Wisp burn the Pokémon. One still standing blocks it. | |
| U11 (p3:659) | A certain crit crits the Substitute. | getDamage |
| U12 (p3:672, 689, 706) | Super Fang deals half the Pokémon's HP (100 of 200), capped at the Substitute's (a 30-HP one breaks). Seismic Toss deals 50. | damageCallback reads the Pokémon |
| U13 (p3:731) | Starting a Substitute ends a partial trap. | `PS/data/moves.ts:18336-18339` |
| U14 (p3:751) | Focus Punch behind a Substitute keeps its focus. | the focuspunch condition's onHit needs the Hit event (`PS/data/moves.ts:6022-6029`) |
| U15 (p3:767) | Magician takes an item through a Substitute. | `PS/data/abilities.ts:2477-2496` reads move.hitTargets |
| U16 champions usum swsh (p3:772-840) | The same in every game. | |
| U16b usum (p3:852) | A Z-Move hits the Substitute. | |
| U16c swsh (p3:865) | A Max Move hits it and still sets its weather. | |
| U17 (p3:893, 910-913, 932-934) | Steel Beam into a Substitute costs ½ once. Mind Blown into a Substitute plus another Pokémon costs ½ twice: once in the Substitute's hit, once after the hits because a Pokémon took damage. | `PS/sim/battle-actions.ts:1382`, `:981-983` |
| K3 (k:339) | A Substitute passed by Shed Tail keeps its maker's HP: 44 (Cyclizar's 177/4) on a 1-HP Shedinja. | C13′ |

---

## 2. Scope (deltas)

### 2.1 Product (additions)

- **2v2 turn.** Positions after Ally Switch, items after Trick / Switcheroo, and every hit into a Substitute: its HP, whether it breaks, and the hits that continue into the Pokémon.
- **State from earlier turns.** The calculator adds a per-slot Substitute HP. Training adds the Substitute HP when it is public and the Ally Switch streak.

### 2.2 Status moves (delta)

L → M:

| Move | Games | This turn |
|---|---|---|
| allyswitch | champions sv swsh usum | swaps its user with its ally (§4.11); +2; SV and Champions repeat counter |
| trick | champions sv swsh usum | swaps the two items (§4.12) |
| switcheroo | champions sv swsh usum | as Trick |

The new L list (73):
`acupressure aromatherapy attract autotomize bestow camouflage captivate conversion conversion2 corrosivegas courtchange craftyshield defog doodle electrify embargo entrainment flowershield foresight forestscurse gastroacid gearup geomancy guardsplit guardswap healbell healblock heartswap iondeluge luckychant magiccoat magicpowder magicroom magneticflux matblock minimize miracleeye mist mudsport nightmare noretreat octolock odorsleuth powder powershift powersplit powerswap powertrick psychoshift psychup purify recycle reflecttype roleplay rototiller simplebeam skillswap snatch soak speedswap stockpile stuffcheeks swallow tarshot teatime telekinesis tidyup topsyturvy transform trickortreat watersport wonderroom worryseed`

- `spec-classify.ts` changes these three to `M` with the texts above. Track A's `status-table.ts` gives them handler keys `allySwitch` and `swapItems` (§4.1).
- Bestow (USUM only) and Corrosive Gas also move items. They stay L, for "status moves 2" (T9b records Bestow's rules).

**Substitute (status move, SPEC M).** Its Substitute is now hit by damaging moves (§4.13). Starting one ends a partial trap on its user (U13, p3:731). Track A's handler calls `endTrap` (§3.4).

### 2.3 End of turn (delta)

| Key | Handler | Delta |
|---|---|---|
| 4 | Wish (carried) | Heals `occupant(w, slot)`: the Pokémon standing at the Wish's slot (A7). |
| 8 | Leech Seed | The HP goes to `occupant(w, eot.leechSeed)`. `eot.leechSeed` is a position: the seeder's when it seeded, or the carried slot (A6). `DoublesResidual.other` is that Pokémon. |
| 5.4, 28.3 | Leftovers, Black Sludge, Sticky Barb, Toxic Orb, Flame Orb | Read the world's holder after Trick or Switcheroo (T8). No new code: `residuals.ts` reads `build.itemId`. |
| 13 | Partial trap | Ended by its holder's Substitute starting this turn (U13), and by its holder's Rapid Spin or Mortal Spin hitting anything, a Substitute included, while the holder has HP and without Sheer Force (C16). The trap's source is a Pokémon, not a position (`PS/data/conditions.ts` partiallytrapped effectState.source). |
| last | Micle Berry (new, C18) | After every ordered handler (ties by Speed): a holder whose item works, with no living foe's Unnerve or As One, at `hp <= maxhp/4` (`<= maxhp/2` with Gluttony) eats it. The world splits by HP like the other Berry handlers. Item `""`, Unburden active; Cheek Pouch heals `trunc(baseMaxhp/3)`, at least 1 (none under `eot.healBlock`). Fact `Micle Berry: eaten.` Residual id `micleberry`, 2v2 only. |

### 2.4 "Not estimated" reasons (delta to SPEC §2.4; exact text)

**Removed.** `substituteHit` (SPEC §2.4). Step 0's stub keeps using it until Track E lands; the integrator then deletes the key (§8).

**New**, in `doubles-actions.ts` `REASONS`:

```ts
dartsAimSelf: "Dragon Darts aimed where its user now stands is not modelled in 2v2.",          // after its ally's Ally Switch (A2, p1:149)
received: (item: string, name: string) => `${item} received by ${name} is not modelled in 2v2.`, // a Terrain Seed in its terrain, Room Service under Trick Room, Booster Energy for a Protosynthesis / Quark Drive holder (T10c)
intoSubstitute: (what: string) => `${what} into a Substitute is not modelled in 2v2.`,           // "Max Moves", "Parental Bond", "Magician", "Mind Blown", a signature Z-Move with an effect of its own (§4.13.2)
subPerHit: (move: string, name: string, what: string) => `${move} into ${name}'s Substitute with ${what} is not modelled in 2v2.`, // a multi-hit move, and the Pokémon has an effect the engine's per-hit damages read (§4.13.6)
```

**Reused:**
- `notIn2v2("Flame Burst")` (C17, presence).
- `withGas(move)`: Trick and Switcheroo under Neutralizing Gas, already in `GAS_CHANGING_MOVES`.
- `switchesOut(name)`: U-turn into a Substitute with a later action (U8, p3:549).
- `faceMultiHit(ability)`: a multi-hit move into a Substitute in front of an intact Disguise or Ice Face.

### 2.5 Turn facts (delta)

- **New.** `Assumes {Name} did not use Ally Switch last turn.` Shown in SV and Champions when the Pokémon chooses Ally Switch and has no `carried.allySwitch` (A8).
- No fact for the Substitute input: absent means no Substitute, as for Leech Seed.

---

## 3. Contract (deltas, paste-ready; Step 0 writes all of it)

### 3.1 `app/lib/battle/doubles-types.ts`

```ts
export type DoublesCarried = {
  /* …SPEC §3.1 fields. leechSeed and wish are positions (Leech Seed's sourceSlot, Wish's slot condition); trap.source and
     syrupBomb are Pokémon (their effectState.source). As the turn starts each position holds the Pokémon of that slot id,
     so the input is the same; they differ only after an Ally Switch this turn… */
  /**
   * Its Substitute from an earlier turn: the HP it has left (pinned substitute condition hp, PS/data/moves.ts:18335):
   * at most floor(maxHP/4) of the Pokémon that made it, which for a Substitute Shed Tail passed is the Shed Tail user
   * (C13′). Absent: no Substitute.
   */
  substitute?: number;
  /**
   * Scarlet/Violet and Champions: it used Ally Switch last turn (the allyswitch volatile, duration 2, PS/data/moves.ts:333):
   * its use this turn works with 1/allySwitch, then the counter triples (at most 729). Absent: not used last turn (a turn
   * fact when it uses Ally Switch).
   */
  allySwitch?: 3 | 9 | 27 | 81 | 243 | 729;
};

export type DoublesHit = {
  /* …SPEC §3.1… */
  /**
   * …SPEC's kinds, plus "substitute": every outcome of this move met a Substitute in front of this Pokémon and none reached
   * the Pokémon itself (min, max, minPercent, maxPercent null; koChance 0; row: the calculation into the Substitute).
   */
  kind: "calculated" | "blocked" | "no-damage" | "effect" | "substitute";
  /**
   * The hits that met its Substitute (PS/data/moves.ts:18342-18372): `chance`, the share of the turn in which they did;
   * `min`/`max`, the HP the Substitute lost over those outcomes (capped at its HP); `breaks`, the share in which it broke.
   * With kind "calculated", min/max/koChance are the hits that reached the Pokémon (no Substitute, or after it broke).
   * Absent: it never met one.
   */
  substitute?: { chance: number; min: number; max: number; breaks: number };
};

// DoublesTurnResult "ready" gains:
//   /** Ally Switch: the chance each side's two Pokémon stand swapped after the moves; absent when 0. Slots stay the Pokémon as they started. */
//   swapped?: Partial<Record<DoublesSideId, number>>;

export type DoublesOutcomeMon = {
  /* …SPEC §3.1… build.itemId is the world's item after Trick, Switcheroo, Knock Off or an eaten Berry. volatiles gains
     "substitute" while one stands and "allyswitch" after a use this turn that passed its PrepareHit (Scarlet/Violet, Champions)… */
  /** Its Substitute's HP after the turn, chances summing to 1; present exactly when volatiles has "substitute". */
  substitute?: { hp: number; chance: number }[];
  /** Scarlet/Violet, Champions: the Ally Switch counter after this turn's use (the next use works 1/counter). */
  allySwitch?: number;
};
export type DoublesOutcome = {
  /* …SPEC §3.1… */
  /** Ally Switch: each side's two Pokémon stand swapped after the turn, or not. mons stay keyed by the slot each started in. */
  positions: Record<DoublesSideId, "kept" | "swapped">;
};
```

New `validate()` issues, reported as `{Name}: …` on the slot:
- `carried.substitute` not a whole number of at least 1: `{Name}: a Substitute has at least 1 HP.` (No upper bound from the holder: a Shed Tail Substitute keeps its maker's quarter, C13′.)
- `carried.allySwitch` outside Scarlet/Violet and Champions, or not one of 3, 9, 27, 81, 243, 729: `{Name}: Ally Switch's counter is 3, 9, 27, 81, 243 or 729 (Scarlet/Violet and Champions).`

### 3.2 `app/lib/battle/types.ts`

No change.
- Items, Unburden (`abilityActive`), stages and status are already build fields, and the per-world builds carry them (§4.12).
- A Substitute's HP and the positions are turn state, not build state: they live in `MonState.vol` and `World`. E2 reports them beside the build (§3.1).

### 3.3′ `app/lib/battle/uses-to-ko.ts` (Step 0, written in full; turn mode only, 1v1 never calls these)

```ts
/** One case of a use as a doubles turn's Substitute prefix reads it: its chance and each hit's distinct damages with their shares. */
export type TurnCase = { chance: number; hits: { values: number[]; weights: number[] }[] };
/**
 * A turn step after hits into a Substitute: only case `caseIndex` of the run (chance 1), its first `skip` hits already
 * dealt to the Substitute (their recoil, drain and self-cost are in the entries' attackerHP, doubles-substitute.ts), the
 * hits from `skip` on dealt to the target. skip may equal the case's hit count: the target is untouched.
 */
export type TurnStepPart = { caseIndex: number; skip: number };
// TurnStepOutcome gains: subHits: number;   // the part's skip (0 without a part); landed stays the hits on the target

// class UsesSearch gains:
/** The cases of the run at a state with these HPs (fixed damage, Super Fang's and Endeavor's, read at targetHP), each hit's
 *  values and weights as hits() walks them in `mode` (lowest / highest: one value per hit). */
turnCases(attackerHP: number, targetHP: number, mode: Mode): TurnCase[] | { failed: string };
/** The part of the target's HP range the damage reads (hpKey, as attackerHPClass for the attacker). */
targetHPClass(hp: number): string;
/** SPEC's turnStep; with `part` given, the step of §3.3′'s part semantics. */
turnStep(entries: TurnStepEntry[], mode: Mode, follow: boolean, part?: TurnStepPart): TurnStepResult;

/** takeable's rule without a matchup: thief (Thief, Covet, Trick, Switcheroo) runs the item's onTakeItem for the taker too. */
export function itemTakeable(runtime: BattleRuntime, paradox: (speciesId: string) => boolean, itemId: string, holder: string, taker: string, thief: boolean): boolean;
```

**`part` semantics inside `afterHit` and `attackerAfterUse`.** Let `dealt` be the damage dealt to the target (the hits from `skip` on) and `hitAny = landed + part.skip > 0`.

*Run on `hitAny`* — the user's per-use effects, which pinned Showdown runs for a hit on a Substitute (U3, U8, U16c):
- self stages (`statMove(own).self`, `preHit`), and `userSecondary` once per hit of the move, `max(1, landed + skip)` times, via selfDrops and secondaries with a null target (`PS/sim/battle-actions.ts:1317-1351`);
- the selfBoost after the move (`:520`);
- a Gem spent; Charge used up; Stellar Tera Blast's drop;
- Life Orb's 1/10 (`:535-545`), alone of `afterHitsLosses`' terms;
- Ice Spinner and Steel Roller ending the terrain (onAfterSubDamage);
- the target's Air Balloon popping (`PS/data/items.ts:203-210`), with Unburden through `itemsLost`.

*Run only when `dealt > 0`* (`move.totalDamage`, `PS/sim/battle-actions.ts:958-965`, `:981-982`):
- recoil, `round(dealt × recoil)`, at least 1;
- the self-cost of Steel Beam, Chloroblast and Mind Blown (`afterHitsLosses`' `SELF_COST_MOVES` term): the cost of a hit into a Substitute is the prefix's (§3.6), so a sub-only use pays it once (K7, U17);
- Shell Bell (`PS/data/items.ts:5652-5654`: none at `move.totalDamage` 0, K7).

*Run only when `landed > 0`* (hits on the target) — every effect on the target:
- statuses, stages, Clear Smog, Salt Cure, Smack Down;
- Knock Off, Thief, Covet, Bug Bite, Pluck, Incinerate, Sticky Barb;
- retaliation, `HIT_ABILITIES`, `HIT_ITEMS`, Kee and Maranga, Pickpocket, Anger Shell, Spicy Spray.

*The attacker's HP after the use* is computed on `hitAny` even with no damage to the target: `end` is `walkHits` over the hits from `skip` on, or, with none, the entry's state (its `attackerHP` after the prefix).

*Rows met:* with a part, `TurnStepResult.rows` lists the run's row only for outcomes in which a hit reached the target. So `HitStats.met`, and with it `DoublesHit.min` and `max`, holds only calculations that damaged the Pokémon.

*Without a part:* exactly today's code.

`takeable` delegates to `itemTakeable`, so 1v1 stays byte-equal.

### 3.4 `app/lib/battle/doubles-world.ts` (delta)

```ts
// MoveVolatiles (SPEC §3.4):
//   substitute?: number;   // HP left: from carried.substitute or this turn's Substitute; hits lower it (Track E); deleted at 0
//   allySwitch?: number;   // Scarlet/Violet, Champions: the Ally Switch counter (carried, or 3 after a first use this turn)
// World gains:
//   /** Ally Switch: this side's two Pokémon stand swapped (PS/sim/battle.ts:1588-1607). */
//   swapped?: Partial<Record<DoublesSideId, true>>;
//   /** During one action: the Pokémon whose item Trick or Switcheroo moved (eventGuards: no Symbiosis, T11). Cleared after the action. */
//   itemsMoved?: DoublesSlotId[];

/** Where the Pokémon that started the turn in `slot` stands now. */
export function positionOf(w: World, slot: DoublesSlotId): DoublesSlotId {
  return w.swapped?.[slotSide(slot)] ? allyOf(slot) : slot;
}
/** The Pokémon (its starting slot) standing at `position` now. In doubles the swap is its own inverse, so this is positionOf's map. */
export function occupant(w: World, position: DoublesSlotId): DoublesSlotId {
  return w.swapped?.[slotSide(position)] ? allyOf(position) : position;
}
/** A partial trap ends on `slot` (its Substitute starting: PS/data/moves.ts:18336-18339; its Rapid Spin, Mortal Spin: C16). */
export function endTrap(w: World, slot: DoublesSlotId): void {
  const mon = w.mons[slot];
  if (mon?.eot.trap) mon.eot = { ...mon.eot, trap: undefined };
}
```

- `cloneWorld` copies `swapped` and `itemsMoved` (a Berry at the action's Update clones the world before `eventGuards` reads `itemsMoved`).
- `discreteKey` adds `world.swapped ?? null`. `itemsMoved` is transient and stays out of the key; `runMove` deletes it before the walk merges.
- `slotSide` and `allyOf` are imported from `doubles-types.ts`, which has no engine imports.

### 3.5 Kernel and hooks (Step 0, `doubles-turn.ts`, current line numbers)

**Kernel additions** (beside SPEC §3.5's):
- `occupant`, `positionOf`;
- `searchFor(w, attacker, target, moveId, conditions, context, spread, attackerHP, opts?: { behindSubstitute?: true })` (§4.13.3);
- `applyStep(w, action, target, entry, info, spread, part?: TurnStepPart)`;
- `subStat(action, target, mass, taken, broke)`;
- `conditionsFor`, `contextFor`, `calcBuild`, `rowReason`, `focusBandGuard`, `unnerveGuard`, `koBoost` (what `singleStep` and `spreadStep` read before a step);
- `itemWorks`, `berryDue`, `ateBerry`, `faint`, `selfBoost` (already listed in SPEC §3.5).

**Position plumbing, written in full by Step 0.** It is behaviour-neutral while `swapped` is unset, so the 556 byte-equal gate holds.
1. **`resolveTargets` (1237-1276).**
   - The chosen target is `occupant(w, action.target)`, unless `tracksTarget`. Then it is `action.target` itself: the Pokémon chosen at queue time (`PS/sim/battle-queue.ts:268`, `PS/sim/battle.ts:2444-2447`; A4, K4), the user's own ally included.
   - **New rule, first:** when the user is not tracking, the chosen slot is not a foe's, and `occupant(w, action.target) === action.slot`:
     - target types `adjacentAlly`, `any` and `normal` give no target, with step fact `{Move} fails: after Ally Switch, {Name} stands in {Partner}'s place.` (A2);
     - Dragon Darts gives `notEstimated(REASONS.dartsAimSelf)` (A2, p1:149).
   - The fainted-target fact names the occupant: `{Occupant} fainted: {Move} hits {Other}.`
   - The across-fallback (1257) reads `occupant(w, across(positionOf(w, attacker)))`.
2. **`spreadTargets` (1189-1193) and `maxEffects`' foe order (2359)** sort by `SHOWDOWN_POSITION[positionOf(w, slot)].position` (A5).
3. **`singleStep` (1660).** After the block check and the Final Gambit split, before `conditionsFor`:
   `const behind = substitute.single(kernel, w, action, info, check, attackerHP); if (behind) return behind;`
4. **`spreadStep` plans (2122-2134).**
   - First in each plan: `const sub = substitute.plan(kernel, w, action, info, check, multiple, attackerHP); if (sub) return { check, entry: null, face: null, sub };`
   - In the loop (2139-2154): `if (sub) { hit = true; worlds = worlds.flatMap((world) => sub.apply(world)); continue; }`
   - It adds no retaliation; Life Orb stays spreadStep's, once per move.
5. **`applyStep` (1713)** takes `part?: TurnStepPart` and passes it to `turnStep` (1746).
   - The receiver's bookkeeping (1810-1819) and `hitReactions` stay on `outcome.landed > 0`, with `receiver.timesAttacked += outcome.landed + outcome.subHits`: Showdown counts every hit of the move once the last hit reached the Pokémon (K1; `PS/sim/battle-actions.ts:990-996`).
   - With a part, `stats.calculated` (1831-1834) counts only outcomes with `landed > 0`.
   - `firsts` (1771) is still noted, so a kind `"substitute"` hit has its `row`.
6. **`afterHit` (1949)** with `const hitAny = outcome.landed + outcome.subHits > 0`:
   - **user rules on `hitAny`:** the switch moves (1964-1967); `TYPE_LOSS_MOVES` (1977); Glaive Rush (1981); `volatileGuard` for Core Enforcer (onAfterSubDamage, `PS/data/moves.ts:2889-2893`) and Spectral Thief (its boosts are stolen before the hit loop, Substitute or not: `PS/sim/battle-actions.ts:781-797`);
   - **target rules on `outcome.landed > 0`, as today:** Smack Down's guard, Aftermath and Innards Out, Dragon Tail's drag, flinch, Throat Chop, the confusing moves, the other `volatileGuard` moves.
   - `eot.afterHit` receives `outcome` and reads `subHits` (§6.0, Track B).
7. **`eventGuards` (701-730).** The Symbiosis branch (717-719) skips slots in `w.itemsMoved`. `runMove` (666-680) deletes `w.itemsMoved` after its `eventGuards` call.
8. **`startRoutes` (2730-2786).** Inside the per-target loop, after the centred-world block (so spread and tracking moves, which return earlier, get none):
   `const swap = positions.startRoute(kernel, w, slot, move, info, target, routed); if (swap) routes.push(swap);`
   `StartRoute` is exported for the hook.
9. **`HitStats`** gains `sub: { mass: number; breaks: number; min: number; max: number }`; `kernel.subStat` feeds it.
   - Assembly (2925-2937): `kind = stats.calculated > 0 ? "calculated" : stats.sub.mass > 0 ? "substitute" : …`, with `substitute` from `stats.sub`.
   - The Substitute hook does not raise `calculated` for hits that met only the Substitute.
10. **`startWorld` (479-501)** maps `carried.substitute` → `vol.substitute` and `carried.allySwitch` → `vol.allySwitch`.
11. **`turnFacts` (2822)** adds the Ally Switch fact (§2.5).
12. **`calculateDoublesTurn`** sets `swapped` from the finished worlds' `swapped` mass. `DoublesHP.conditions` comes from one aggregator, `conditionFacts(kernel, w, slot)`, which concatenates:
    - `status.conditions` and `eot.conditions` (SPEC);
    - `positions.conditions`, `items.conditions` and `substitute.conditions` (Track E stubs).
13. **`outcomeOf` (2985) and `mergeOutcomes` (3010):**
    - `positions` from `w.swapped`;
    - `substitute` from `vol.substitute`;
    - `allySwitch` from `vol.allySwitch`;
    - `volatiles` also `"substitute"` and `"allyswitch"`;
    - the merge key adds `positions`, `volatiles` and `allySwitch`; `substitute` merges as a mixture (equal volatiles: one stands in every merged world).

**Status-move dispatch.** Track A's `doubles-status.ts` calls Track E through the table's handler keys at PrepareHit and onHit:
- `positions.allySwitchPrepare` and `positions.allySwitchHit`;
- `items.swapItems`.

`doubles-turn.ts` needs no other hook.

**Stubs (Step 0)** reproduce today's behaviour exactly:
- `positions.*` and `items.*` throw `REASONS.notModelledBefore(move)` while a later living action follows, and otherwise set `w.endGuard ??= REASONS.notModelled(move)`.
- `substitute.single` and `substitute.plan` return null when no `vol.substitute` stands, and otherwise throw `REASONS.substituteHit(name)`.
- `*.conditions` and `positions.startRoute` return nothing.

**Step 0 gate additions:**
- `turnStep(entries, mode, follow, { caseIndex: i, skip: 0 })`, mixed over the cases by chance, equals `turnStep(entries, mode, follow)` on 20 rows, multi-hit and random-count ones included.
- `itemTakeable` agrees with `takeable` on every catalog item × holder × taker in the four games.
- `tests/unit/uses-to-ko-turn-part.test.ts` (Step 0's) pins the part path on fixed rows: with `skip` equal to the hit count, Life Orb costs 1/10 and there is no recoil, no Shell Bell heal and no second Steel Beam cost (K7); `userSecondary` counts every hit; the Air Balloon pops; no target effect runs; with a continuation, Focus Sash at full HP saves on the first hit after the break (U4d) and Rocky Helmet hits back for the continuation's hits only (K8).

### 3.6 `app/lib/battle/hit-loop.ts` (Track E; a new export, nothing existing changes)

```ts
/** What a hit into a Substitute costs its user besides recoil from a fraction: Steel Beam and Chloroblast, half the maximum HP. */
export type SubCost = { recoil: [number, number] } | { half: "steelbeam" | "chloroblast" } | null;
/**
 * The attacker through one hit into a Substitute (PS/data/moves.ts:18342-18372): `taken`, the HP the Substitute lost (the
 * hit's damage capped at its HP). When taken > 0, applyRecoilDamage first (PS/sim/battle-actions.ts:1379-1398):
 * round(taken × recoil), at least 1, or round(maxHP / 2) for Steel Beam and Chloroblast. Rock Head stops recoil and
 * Chloroblast's (both the 'recoil' effect: battle-actions.ts:1391; data/abilities.ts rockhead onDamage), not Steel Beam's
 * (its own condition); Magic Guard stops each. Then drain, d = ceil(taken × drain): the target's Liquid Ooze deals d to
 * the attacker (Magic Guard stops it), at full HP too and with no Big Root (TryHeal hands it the value before Big Root's
 * modifier, and runs before heal()'s full-HP check: PS/data/abilities.ts:2402-2410, PS/sim/battle.ts:2271-2275; K2);
 * otherwise a heal of d, Big Root 5324/4096, none at full HP, none under Heal Block. Then the hit's Update (its HP or
 * pinch Berry, as hitStep). The target's DamagingHit handlers do not run: no Rough Skin, Iron Barbs, Rocky Helmet,
 * Jaboca or Rowap Berry, Gulp Missile, Mummy, Wandering Spirit.
 */
export function subHit(input: HitLoopInput, prev: HitState, taken: number, cost: SubCost): HitOutcome;
```

No move in the four catalogs has both a multi-hit count and recoil, drain or a self-cost outside Parental Bond (guarded, §4.13.2); `tests/source/doubles-substitute-census.test.ts` asserts it. So a prefix that changes the attacker's HP never has hits after it.

---

## 4. Engine algorithm (additions)

### 4.1 Files (additions)

- `app/lib/battle/doubles-positions.ts` (new, Track E). Ally Switch, the start-row route, the position facts.
- `app/lib/battle/doubles-items.ts` (new, Track E). Trick, Switcheroo, receipt rules, Unburden, item facts.
- `app/lib/battle/doubles-substitute.ts` (new, Track E). Hits into a Substitute: the prefix, the parts, the stats, the facts.
- `app/lib/battle/hit-loop.ts` (Track E). `subHit` only.

### 4.11 Ally Switch (`doubles-positions.ts`)

1. **Order.** Priority +2 in all four games, by its table entry (A1); Prankster gives +3. No Quick Guard, Protect or priority shield applies:
   - it has no protect flag (`PS/sim/battle.ts:1300-1309`);
   - its target is itself (Dazzling's `source` is its own target);
   - Psychic Terrain returns for `target === 'self'`.

   Track A's pipeline applies BeforeMove as for any status move: sleep, Taunt, Disable, Imprison, confusion, paralysis.
2. **PrepareHit (`allySwitchPrepare`; SV and Champions only, gen 8/7 skip it).**
   - With `vol.allySwitch = c` from `carried`, the world splits:
     - **1/c passes:** `vol.allySwitch = min(729, 3c)`;
     - **1 − 1/c fails:** `delete vol.allySwitch`, and the step fact `Ally Switch fails: it was used last turn.`
   - With no counter, the use is certain and `vol.allySwitch = 3` (`PS/data/moves.ts:333-352`; A8, A11).
3. **onHit (`allySwitchHit`).**
   - The ally slot empty, or its Pokémon fainted, fails: `Ally Switch fails: {Partner} has fainted.`, or `…: its ally has fainted.` for an empty slot (A9, A9b; `PS/data/moves.ts:322-328`).
   - Otherwise `w.swapped[side] = !w.swapped[side]` (deleted when false), with the step fact `Ally Switch: {User} and {Partner} swap places.`
   - The counter already moved at PrepareHit (A11).
4. **Effects on the rest of the turn** (all through §3.5's plumbing):
   - **Moves aimed at a position** hit its occupant (A1, Q4). That includes their reads of the target's queued move (Sucker Punch, Upper Hand, Payback, Bolt Beak) through `contextFor` on the resolved target.
   - **Tracking moves:** Stalwart, Propeller Tail and Snipe Shot keep the Pokémon (A4), their user's own ally included (K4).
   - **Redirection** follows the Pokémon (A3).
   - **Spread order** is by the new positions (A5); random targets pick among the living foes (A10).
   - **A move its user aims at its own ally** after the ally's Ally Switch fails `[notarget]` (A2). Damaging, `normal` and `any` moves go through `resolveTargets`; Track A's own `adjacentAlly` path (Aromatic Mist, Hold Hands, Dragon Cheer; Helping Hand's +5 always comes first) applies the same rule with `kernel.occupant(w, action.target) === action.slot`, beside SPEC §4.3's ally-only failure, with the same fact. Dragon Darts gets `dartsAimSelf`.
   - **When the hit lands somewhere else**, the step fact is `Ally Switch: {Move} hits {Occupant} in {Chosen}'s place.`, with its chance.
5. **End of turn (Track B).**
   - Leech Seed's gainer is `occupant(w, eot.leechSeed)` (A6).
   - Wish heals `occupant(w, slot)` (A7).
   - Healer, Bad Dreams, the trap source and Syrup Bomb's source do not read positions in doubles.
6. **E2 and facts.**
   - `DoublesOutcome.positions` and `DoublesOutcomeMon.allySwitch`.
   - The condition fact `Swapped places with {Partner}.` (with its chance), on each swapped Pokémon.
7. **Start rows (`startRoute`).** Only when the target's partner chose Ally Switch and `mayComeAfter(attacker, partner)`:
   - a damaging move aimed at a Pokémon whose partner chose Ally Switch gets a conditional row into the partner, with fact `Ally Switch: {Partner} takes {Move} if Ally Switch comes first.`;
   - a move aimed at the attacker's own ally that chose Ally Switch gets the row `{Move} fails if {Partner}'s Ally Switch comes first.`, and Dragon Darts the row reason `REASONS.dartsAimSelf`.

### 4.12 Trick, Switcheroo (`doubles-items.ts`)

1. **Pipeline (Track A).**
   - Protect flag yes; not reflectable; no bypasssub.
   - TryHit: the Protect family, Good as Gold, and Psychic Terrain for a Prankster use into a grounded foe.
   - TryImmunity: Sticky Hold by `hasAbility`, which Mold Breaker does not pass (`PS/data/moves.ts:19875-19877`; T5 p2:253). Hit kind `no-damage`, fact `Sticky Hold: {Name} keeps its item.`
   - Prankster vs a Dark target; Substitute (T5 p2:269); then `swapItems`.
2. **`swapItems(kernel, w, action, target, move)`** (`PS/data/moves.ts:19878-19906`). With a = the user's world item, b = the target's:
   - **Both "": fail,** `{Move} fails: neither holds an item.` (T5 p2:303).
   - **Fail when an item cannot move,** `{Move} fails: {Holder}'s {Item} cannot be moved.` (T6). Each held item x must pass `itemTakeable(runtime, paradox, x, holderSpecies, receiverSpecies, true)`, which covers:
     - the holder's TakeItem (`takeItem` → runEvent);
     - the receiver's (`singleEvent('TakeItem', x, …, receiver)`, `:19886-19893`);
     - Z-Crystals; Mega Stones for their family; Plates, Memories and Drives (holder or receiver); Booster Energy for a Paradox Pokémon; Rusted Sword and Shield; Origin items; Primal Orbs; Masks; Zygardite.

     Species are base species as `takeable` reads them; a transformed Pokémon keeps its own.
   - **Otherwise** both builds' `itemId` swap, and `w.itemsMoved = [user, target]`. Step fact:
     - `{Move}: {User} gets {B}, {Target} gets {A}.`;
     - `{Move}: {Target} gets {A}; {User} gets nothing.`;
     - `{Move}: {User} gets {B}; {Target} gets nothing.`
3. **Unburden** (`PS/data/abilities.ts:5235-5252`; T7, T7b).
   - For each Pokémon with Unburden in effect: `abilityActive = (it held an item before this move, or abilityActive was already true) && newItem === ""`.
   - A later loss of the received item reactivates it, as today (`ateBerry`; the pair step's `itemsLost`).
4. **Receipt** (setItem's Start, `PS/sim/pokemon.ts:1868-1889`), in onHit order: the target first, then the user.
   - **White Herb** with a lowered stage is used at once: lowered stages to 0, item "", Unburden active (T4 p2:147).
   - **A Terrain Seed in its terrain, Room Service under Trick Room,** when the receiver's item works: `REASONS.received(item, name)`. They are used inside setItem (T10c). A held one reaching Trick unused means its giver could not use it (Klutz, Magic Room's `itemUsedBeforeRoom`), which the settle reads per holder, so the receiver's use is guarded.
   - **Booster Energy:** `REASONS.received` for a receiver whose ability in effect is Protosynthesis or Quark Drive. Otherwise nothing (T6 p2:399ff).
   - **Air Balloon, Choice items, Utility Umbrella, Metronome:** nothing this turn's numbers read beyond the build.
     - Air Balloon ungrounds through `grounded()` (T10).
     - A Choice item's onStart removes a choicelock (`PS/data/items.ts:989-994`), which is next turn's.
     - Utility Umbrella's WeatherChange would change only Forecast's form, and no catalog has both Castform and Utility Umbrella; Cherrim's Sunshine form changes no number, and Flower Gift reads each ally's own Umbrella (`flowerGift`).
     - A received Metronome starts its count at 0 (`PS/data/items.ts:3995-4003`), and a turn's first use already reads 0 (`calculateTurnMove`).
   - **Quick Claw, Custap Berry, Lagging Tail, Full Incense:** nothing this turn. The fractional priority is fixed at queue time (`PS/sim/battle-queue.ts:249`; `rootWorlds`).
   - **A Klutz receiver or Magic Room:** nothing acts (`itemWorks`; singleEvent skips an ignored item; T4b).
5. **The action's Update** (Track A's `updateAll`, run for every status move): Berries and Mental Herb as due.
   - Sitrus, Oran and Berry Juice at ½. The Figy family at ¼, with nature confusion, which is now a fresh confusion (SPEC §4.6).
   - Pinch Berries at ¼.
   - Lum, Cheri, Chesto, Pecha, Rawst and Aspear by status; Persim by confusion; Mental Herb by Taunt, Encore, Disable, Heal Block and Torment.
   - The holder's foes' Unnerve and As One stop Berries.
   - Probes: T4, T12; R11 (`status-probes-3.out`).
6. **Later in the turn** everything reads the world build:
   - Speed: gen 8+ re-sorts through `speedOf` (T1, T2, T7); gen 7 keeps the frozen keys (T1 usum).
   - Damage: Choice Band/Specs, Life Orb (×1.3 and its 1/10, T3), Expert Belt, a resist Berry.
   - Grounding: Iron Ball, Air Balloon (T2, T10).
   - `breaks()`: Ability Shield.
   - `chargesThisTurn`: Power Herb.
   - Focus Sash, Weakness Policy, Rocky Helmet.
   - Eject Button, Red Card, Eject Pack: existing guards.
   - Sticky Barb on contact: the pair step.
   - The end of turn (T8; Micle Berry, C18).
7. **Symbiosis** does not act (T11): `itemsMoved`. **Neutralizing Gas:** the existing `withGas` guard.

### 4.13 Hits into a Substitute (`doubles-substitute.ts`)

1. **When.**
   - The target has `vol.substitute` in this world, and the attacker is not the target.
   - The move does not pass it: no `bypasssub` flag (sound moves have it), and the attacker's ability in effect is not Infiltrator (`PS/data/moves.ts:18343`; Infiltrator sets `move.infiltrates`, `PS/data/abilities.ts:2133`; U6).
   - Type immunity and TryHit come first (`trySpreadMoveHit` step order, `PS/sim/battle-actions.ts:550-577`): a blocked or immune hit is today's.
   - A Substitute made this turn (Track A: `floor(maxhp/4)` after its HP cost), a carried one and one Shed Tail passed are the same state.
   - A Pokémon behind a Substitute that breaks is then hit normally by later moves (U10).
2. **Narrow guards** (`REASONS.intoSubstitute`):
   - Max Moves: their user and foe effects on Pokémon behind a Substitute (U16c).
   - Parental Bond: the second hit's ×0.25 and self effects per hit.
   - Magician, when the attacker holds nothing and the target holds an item it could take (U15).
   - Mind Blown: one cost per Substitute hit, plus one after the hits (U17).
   - A signature Z-Move with an effect of its own (`Z_MOVE_EFFECTS`).

   Type Z-Moves are modelled (U16b).
3. **The calculation.** `kernel.searchFor(…, { behindSubstitute: true })`, with the target's build changed for this calculation only:
   - a resist Berry or Chilan Berry that works becomes `leftovers`, an ordinary held item: their `onSourceModifyDamage` returns for hitSub (`PS/data/items.ts:365…7775`, `:909`; U7 p3:359 vs 376), while Knock Off's ×1.5 and Poltergeist's onTry still see a held item (`PS/data/moves.ts:9969-9975`, `:13605-13606`; K6: 146 with Colbur or Leftovers, 100 with none). Leftovers changes no damage, and the turn's search runs no end of turn;
   - an intact Disguise or Ice Face (the forms `faceTaken` reads) becomes `GAS_STAND_IN`: their onEffectiveness and onCriticalHit return for hitSub (`PS/data/abilities.ts:979-1001`, `:1985-2002`; U9).

   Everything else is the target's real calculation: Multiscale and Tera Shell read the Pokémon's HP (no hitSub check), and so do Friend Guard and screens. The memo key carries the flag.

   A non-calculated row gives today's `rowReason`; a no-damage row is today's no-damage hit.
4. **Parts by HP.**
   - The world is split by `search.targetHPClass(hp)` of the target's HP: Super Fang, Endeavor, OHKO moves and Multiscale read it (U12).
   - When `search.readsAttackerHP()`, it is also split by `attackerHPClass`, as `spreadStep` does.
   - Final Gambit keeps `singleStep`'s split by the attacker's HP.
5. **The prefix.** For each part, and each case i of `search.turnCases(xHP, tHP, ctx.mode)`:
   - Walk the hits h = 0, 1, … over the rolls of hit h, with the Substitute's HP s (start: `vol.substitute`):
     - `taken = min(v, s)`, `s -= taken`;
     - when the attacker's HP is followed (recoil, drain, Steel Beam, Chloroblast, or its HP Berry can act), its state goes through `subHit(loop, state, taken, cost)` (§3.6; U2, U17, K2).
   - Stop at s = 0. Hits remain → a **continuation from hit h+1**; none remain → done.
   - Also stop when the hits end with s > 0, or when the attacker faints (`PS/sim/battle-actions.ts:968-971`).
   - Mass = the case's chance × the rolls' weights.
   - Equal `(i, j = hits into the Substitute, s, attacker state)` merge.
6. **Multi-hit guard** (`SUB_PER_HIT`). It applies when a multi-hit move (a case with more than one hit) meets a Substitute, whether or not the Substitute breaks, and the Pokémon has an effect that the engine's per-hit damages read as if each earlier hit had reached it (@smogon/calc `checkMultihitBoost` and the `hitCount === 0` terms of `calculateFinalModsSMSSSV`):
   - an ability in effect: Multiscale, Shadow Shield, Stamina, Water Compaction, Weak Armor, Seed Sower, Sand Spit; Mummy, Lingering Aroma or Wandering Spirit on a contact move (K5);
   - a working item: a resist Berry, a Chilan Berry, Luminous Moss.

   Result: `REASONS.subPerHit(move, name, that ability or item)`; an intact Disguise or Ice Face gets `faceMultiHit(ability)`.
   - **Why:** behind a Substitute those effects do not fire (no DamagingHit, the Pokémon stays at full HP and keeps its Berry), so the engine's values for the hits after the first, into the Substitute or after it breaks, are off: Showdown's Multiscale halves every hit while the Pokémon stays at full HP (`PS/data/abilities.ts:2760-2765`), Technician stays behind a Mummy (K5).
   - The other target reactions (Weakness Policy, Absorb Bulb, Cell Battery, Snowball, Justified, Rattled, Steam Engine, Thermal Exchange, Gooey, Tangling Hair) change no damage the attacker deals in the move, and Kee and Maranga Berry act only after the whole move, which `calculate.ts` already keeps out of the hits between (`AFTER_MOVE_ITEMS`, `calculate.ts:82-84`). `afterHit` applies them for the hits on the Pokémon (`landed`), which is exact.
   - What the slice keeps exact: absolute-index effects (Triple Axel's powers, U4c; a Gem's first hit), and Tera Shell, whose resistance covers every hit of the move from hit 1 at full HP in both (`PS/sim/pokemon.ts:2220-2231`).
7. **Apply each class** (world clone with its mass):
   - `vol.substitute = s`, deleted at 0. Hit fact `Its Substitute breaks.` with its chance.
   - The followed attacker's HP gets the prefix map (`mapHP`, deterministic per class). When the prefix's Update ate the attacker's HP or pinch Berry (a single-hit move's recoil or Steel Beam's cost), `kernel.ateBerry` applies it to the world (item "", Unburden, the pinch rise, Cheek Pouch), and `searchFor` runs again with the attacker's new build before the step (memoised).
   - **The attacker fainted in the prefix** (recoil, Steel Beam's or Chloroblast's cost, Liquid Ooze; single-hit moves only, §3.6): no step runs; the target's Air Balloon pops if it holds one (onAfterSubDamage runs after the recoil), and `kernel.faint` runs for the attacker.
   - Otherwise `kernel.applyStep(w′, action, target, entry, info, spread, { caseIndex: i, skip: j })`, with the entry's attackerHP being the attacker's HP after the prefix.
     - The search applies the user's per-use effects once, and the target's only for continuation hits (§3.3′): Life Orb once (U3), self drops (U8), U-turn's switch (doubles `afterHit` on `hitAny`, U8 p3:549), Ice Spinner's terrain (U8 p3:586).
     - Recoil, a second self-cost and Shell Bell read only the continuation's damage (none without it: K7).
     - The continuation's hits run the full pair machinery: Focus Sash and Sturdy at full HP (U4d), Rocky Helmet (K8), Berries, KO chance (U4, U4b).
     - After the step, the target's `itemId` and `abilityId` are put back from the world before it when §4.13.3 put a stand-in in (a continuation in front of a stand-in is guarded in step 6, so nothing in the step changed them).
     - The receiver's hit count takes `landed + subHits` (§3.5.5; K1).
   - Final Gambit's user faints whatever the target (its damageCallback faints it).
   - A protecting move's contact effect on a Z-Move that breaks through (`check.through`) does not act on a hit into a Substitute: the protect condition's onHit needs the Hit event (`PS/sim/battle-actions.ts:1283`).
   - `kernel.subStat(action, target, mass, s0 − s, s === 0)`.
8. **Nothing of the Pokémon behind it reacts** (U7, U8) while every hit meets the Substitute. It keeps its HP, hurt, `damagedBy`, `timesAttacked`, `focusLost` (U14), item, status, stages and volatiles. That means:
   - no flinch, no secondary, no Throat Chop, Salt Cure, Smack Down or trap;
   - no Knock Off, Thief, Covet, Bug Bite or Incinerate (Knock Off still has ×1.5: U7 p3:393 vs 410);
   - no Rough Skin, Rocky Helmet, Weakness Policy, Stamina, Cotton Down, Eject Button, Red Card, Destiny Bond or Emergency Exit.

   Only the Air Balloon pops.
9. **Spread (`plan(…).apply`).** Steps 3–8 with `spread = true`. The attacker's state from `applyStep(…, spread)` joins `world.spread` like the other targets'; Life Orb is spreadStep's once.
10. **Moves with their own `onAfterSubDamage`** (census, §9 source test):
    - **Modelled:** Ice Spinner, Steel Roller (terrain); Rapid Spin, Mortal Spin (the user's Leech Seed, trap and hazards: Track B C16; E2 hazards); Ceaseless Edge, Stone Axe (E2 hazards); Shell Side Arm (a hint only).
    - **Existing guards:** Core Enforcer (`volatileGuard`); Flame Burst (C17).
    - **Guarded:** G-Max Snooze (Max Moves); Splintered Stormshards (signature Z).
11. **Facts.**
    - Hits: `DoublesHit.substitute` and kind `"substitute"` (§3.1).
    - `{Move} hits {Name} after its Substitute breaks.` when a continuation reached it, with its chance.
    - Conditions on the card: `Substitute: {min}–{max} HP.` with the chance that one stands. A break is the hit's fact, not a condition.

### 4.10 Budgets (delta)

- **No new calculations** beyond one `behindSubstitute` search per pair, memoised (and the attacker's re-run after a Berry the prefix ate).
- **Worlds.**
  - A hit into a Substitute splits a world by the Substitute's remaining HP: at most 16 values plus broken. Worlds with equal `vol.substitute` merge.
  - A spread move into two Substitutes gives at most 17² before merges.
  - Ally Switch's counter gives 2 worlds per use; Trick gives none.
  - The budget is unchanged: over it is `Too many cases to follow.`, never a wrong number. There is no late merge.
- **Bench cases (new):**
  - carried Substitute + Icicle Spear + Rock Slide;
  - Ally Switch + Snipe Shot + Follow Me;
  - Trick Choice Scarf + four movers + Quick Claw.

  Gates unchanged (SPEC §4.10).

---

## 5. UI (delta; 2v2 only, 375 px, facts only, names not positions)

- **`doubles-format.ts`:**
  - `hitLine` for kind `"substitute"`: `{Name}'s Substitute: −{min}–{max} HP`, then `, breaks {pct}` when `breaks > 0`, then ` · reaches it {pct}` as today. Minus signs are U+2212; `{min}` alone when equal.
  - Kind `"calculated"` with `substitute`: that line first, then today's damage line (the hits that reached the Pokémon).
  - Facts come from the engine (§4.11–4.13), rendered as today with their chances.
- **`DoublesCard.tsx`.** The card stays with its Pokémon. Its conditions line (SPEC §5) shows, with chances:
  - `Substitute: 15–19 HP`;
  - `Swapped places with {Partner}`;
  - `Holds {Item}` / `Holds no item`, only when the item differs from the start.
- **`DoublesTurn.tsx`.**
  - Steps list the Ally Switch and Trick facts.
  - Leech Seed's residual line names the Pokémon that gains (`DoublesResidual.other` = the occupant).
  - Start rows show the Ally Switch conditional rows (§4.11.7).
- **Field conditions (`BattleConditions.tsx`, 2v2 section)**, per slot, beside Q1's controls:
  - A `Substitute` checkbox (`data-doubles-substitute={slot}`). Ticked, it shows a `Substitute HP` number field, 1 to floor(maxHP/4), default floor(maxHP/4), in the compact control style. A Shed Tail Substitute larger than that is Training's only (§6).
  - **State:** `doubles-prep.ts` `carried[slot].substitute`. It resets when the slot's Pokémon changes, and is clamped when the maximum HP falls below it.
  - **Passing:** `useDoublesView.tsx` passes it through `carried`.
  - **Width:** no horizontal scroll at 375 px.
- **Names.** `doublesNames` stays fixed for the turn: a duplicate-species suffix (`Garchomp (your left)`) names the Pokémon by where it started, as its card does; the swapped Pokémon's conditions line says `Swapped places with {Partner}`.

---

## 6. Training (delta; Champions)

- **`sim/tracker.ts` (Track B):**
  - **Substitute stint.** The substitute volatile entry gains `maker` (the key of the Pokémon on whose `-start|X|Substitute` line it began) and `hits`: `-start` sets `hits` 0, each `-activate|X|move: Substitute|[damage]` adds 1, and `-end|X|Substitute` ends it. Baton Pass and Shed Tail copy the entry with its `maker` and `hits` (the tracker already copies the volatile, `tracker.ts:343-365`).
  - **`allySwitchStreak`** (A11):
    - it adds 1 on a turn whose `|move|X|Ally Switch` is followed by `|swap|X|…|[from] move: Ally Switch` or `-fail|X|move: Ally Switch`;
    - it is reset by a plain `-fail|X` after that move, by a turn without its use (a `cant` line included), and by switching out.
  - The `|swap|` positions are already tracked (`tracker.ts:532-533`).
- **`sim/bridge.ts`:**
  - **`carried.substitute`:** `floor(maxhp/4)` of the stint's `maker` in that belief world when `hits === 0`. A foe's maxHP is the belief set's, exact per belief world as items are. Otherwise the rollout reason `{Name}: its Substitute's HP after a hit is not public.` The `-activate` line shows no number, so the HP after a hit is hidden for both sides.
  - **`carried.allySwitch`:** `min(729, 3^streak)` while the `allyswitch` volatile stands.
  - `IGNORED_VOLATILES`: `substitute` and `allyswitch` become mapped, no longer rollouts.
  - Items come from `liveBuild` (`pokemon.item`) as today; Trick's `-item|X|…|[from] move: Trick` lines reveal both items.
- **`sim/effects.ts` (assign to Track B; not in SPEC §8's tables):**
  - The belief battle's Substitute HP is `floor(maxhp/4)` of the stint's `maker` when `hits === 0` (today `effects.ts:109-111` uses the holder's). Otherwise today's approximation stays, for rollouts only.
  - `allyswitch` is built as `{ counter: 3^streak, duration: 1 }`.
  - The derived choicelock (`effects.ts:54-55`) is not added when the holder's Choice item arrived through Trick or Switcheroo (`-item|X|…|[from] move: Trick`) during or after its last move this stint. Showdown's lock comes from onModifyMove while holding it, and a Choice item's onStart removes a lock (`PS/data/items.ts:989-994`, `PS/data/conditions.ts` choicelock): the Trick user locked into Trick that receives a Choice item is free too.
- **`ai/evaluate.ts` `postFromOutcome`:**
  - `outcome.positions[side] === "swapped"` swaps the two PostMons' `slot` of that side.
  - `PostMon.volatiles` takes `outcome.volatiles` (SPEC), now with `substitute`.
  - The hazards from `sides.hazards` include Ceaseless Edge and Stone Axe into a Substitute.
- **`ai/value.ts`:** unchanged. It already weighs `substitute` (`value.ts:153`).
- **AI candidates:** `candidates.ts` already lists Ally Switch and Substitute. Trick cells become engine cells instead of rollouts.
- **`scripts/training/leak.ts`:** diffs `carried.substitute` and `carried.allySwitch` too, and must still show 0 differences.
- **`scripts/training/conformance.ts`:** the census adds the three moves; gate 4b covers outcomes with `positions`.

### 6.0 End-of-turn hook delta (Track B, `doubles-eot.ts`)

- `eot.afterHit` acts on `outcome.landed > 0` for the target rules: trap, Salt Cure, Syrup Bomb, Psychic Noise, Smack Down.
- It acts on `landed + subHits > 0` for the user rules:
  - Rapid Spin and Mortal Spin clear the user's `eot.leechSeed`, and call `endTrap`, while the user has HP and without Sheer Force (C16);
  - Ceaseless Edge and Stone Axe set E2 hazards.
- The Micle Berry residual (C18).

---

## 7. Oracle (delta; `scripts/.cache/calc-audit/2v2/verify`)

1. **`sim-dfs.ts`:**
   - **Identity.** `prepare()` sets `p.m.caseSlot = slot` on each case Pokémon. `State` serialises `m`: it is not in the POKEMON skip set, `PS/sim/state.ts:45-48`.
     - `slotOf(p)` returns `p.m.caseSlot`.
     - `pokemonAt(b, slot)` becomes `monOf(b, slot)`, the active Pokémon with that `caseSlot`.
     - The Recorder takes an actor's log ident at `begin` (`${p.getSlot()}: ${p.name}`), and a target's by name and slot when the line is written.
     - Without a swap, identity equals position, so stored results stay byte-equal.
   - `CHANCE_EFFECTS` gains `allyswitch`.
   - **`prepare()`** also applies:
     - `CaseMon.substitute`: `addVolatile('substitute')`, then `.hp` (any positive value: E47 sets a Shed Tail one);
     - `CaseMon.carried.allySwitch`: `addVolatile('allyswitch')`, then `.counter` and `duration = 1`;
     - Wish per C15: `startingTurn = b.getOverflowedTurnCount() − 1`.
   - **Recorder, per action and target:** `sub = { mass, takenMin, takenMax, breaks }`, from `volatiles.substitute?.hp` at `begin` and `finish` and the `-end|…|Substitute` line.
     - The `getDamage` tally stays and also counts the calculation into a Substitute. `compare` reads `sub` for a hit the app calls `"substitute"`.
   - **`SlotResult`** gains `item: Record<string, number>` (item ids after the moves, with mass), `sub: [hp, mass][]` and `timesAttacked: Record<string, number>`.
   - **`WalkResult`** gains `swapped: Partial<Record<"own" | "opponent", number>>`.
2. **`case-types.ts`:** `CaseMon.substitute?`, `CaseMon.carried.allySwitch?`, `HitResult.sub?`, `SlotResult.item?`, `SlotResult.sub?`, `SlotResult.timesAttacked?`, `WalkResult.swapped?`.
3. **`app-turn.ts`** maps `substitute` and `allySwitch` into `DoublesCarried`. For cases with items or a Substitute, it also runs `calculateDoublesOutcomes`, for the items' and Substitutes' mixtures.
4. **`compare.ts`**, each within 1e-9:
   - `swapped` vs `DoublesTurnResult.swapped`;
   - E2 item mixture vs `SlotResult.item`;
   - `DoublesHit.substitute` (chance, min, max, breaks) vs `HitResult.sub`;
   - kind `"substitute"` ↔ reached, `sub` mass, no Pokémon damage;
   - `DoublesOutcomeMon.substitute` vs `SlotResult.sub`;
   - start rows for the Ally Switch routes;
   - reason-only cases: the exact reason.
5. **`gen-tests.ts`** emits these expectations.
6. **Regression.** All 556 rerun byte-equal in their after-the-moves fields. No stored case uses Ally Switch, Trick, Switcheroo, Substitute or Flame Burst (`cases.ts`), so none of the allowed differences below occurs among them; the list is kept for the script:
   - `notModelledBefore` or `notModelled` of Ally Switch, Trick or Switcheroo;
   - `substituteHit`.

   Cases with these reasons become ready and are validated by the oracle.

### 7.1 Cases (new: E)

All run three walks and are exhaustive.

**Ally Switch.**

| Id | Games | Setup | Checks |
|---|---|---|---|
| E01 | sv champions swsh usum | Ally Switch; a foe's Aqua Jet aimed at the switcher's old position (A1) | +2 everywhere; the occupant takes it |
| E02 | sv | Fake Out into the switcher (A1b) | flinch, no swap |
| E03 | sv | the user aims Body Slam / Heal Pulse / Pollen Puff / Aromatic Mist at its ally, which Ally Switches (A2); Dragon Darts the same | `[notarget]` fact, Track A's adjacentAlly path included; `dartsAimSelf` |
| E04 | sv | Follow Me after its partner's Ally Switch (A3) | redirection follows the Pokémon |
| E05 | sv | Stalwart, Snipe Shot, plain Body Slam after a foe swap (A4) | tracking keeps the Pokémon |
| E06 | sv | Rock Slide after a foe swap, with a Sitrus holder at ½ on each foe (A5) | hit order, faint order |
| E07 | sv champions | carried Leech Seed; the seeder's partner Ally Switches; the seeded Ally Switches (A6, A6b) | the gainer is the occupant (end of turn) |
| E08 | sv | carried Wish; Ally Switch into its slot (A7) | the occupant heals |
| E09 | sv champions | `carried.allySwitch` 3 (A8); and swsh usum with none twice | 1/3 split; no counter in gen 8/7; fact without carried |
| E10 | sv | the ally absent; the ally knocked out by Extreme Speed first, with carried 3 (A9, A11) | fails; the counter still rolls |
| E11 | sv | Thrash after a foe swap (A10); a move at a fainted foe after the user's own swap (across-fallback) | random target; across by position |
| E12 | sv | Sucker Punch aimed at a position after its occupant changed | reads the occupant's queued move |
| E46 | sv | Snipe Shot and a Stalwart user aimed at their own ally, which Ally Switches (K4) | the ally is hit, no failure |

**Trick, Switcheroo.**

| Id | Games | Setup | Checks |
|---|---|---|---|
| E13 | sv champions swsh usum | Trick Choice Scarf onto a slower foe (T1) | gen 8+ re-sort; gen 7 frozen |
| E14 | sv | Trick Iron Ball onto Gyarados; Earthquake (T2) | Speed halved, grounded |
| E15 | sv | Trick Life Orb; Trick Choice Band onto a later attacker (T3) | ×1.3 and 1/10; ×1.5 |
| E16 | sv | Trick Sitrus / Lum / White Herb / Mental Herb / Figy (T4); Klutz, Magic Room (T4b); the user receives Sitrus (T12) | receipt at the Update; White Herb in Start |
| E17 | sv | Mold Breaker into Sticky Hold; into a Substitute; into Protect; both item-less; a Sticky Hold user (T5) | failures and their facts |
| E18 | sv champions swsh usum | Plate, Booster Energy, Mega Stone, Rusted Sword, Z-Crystal (T6) | `itemTakeable` both ways |
| E19 | sv | Unburden loses its item / gets one (T7, T7b) | Speed re-sort |
| E20 | sv | Trick Leftovers, Black Sludge, Toxic Orb, Flame Orb, Sticky Barb (T8); Trick a Micle Berry onto a Cheek Pouch holder at ¼ HP (C18) | end of turn reads the holder; Micle eaten last, Cheek Pouch heal |
| E21 | sv usum | Switcheroo (T9) | as Trick |
| E22 | sv | Air Balloon received, then Earthquake (T10); a Klutz giver's Electric Seed and Room Service (T10c) | grounding; `received` reason |
| E23 | sv | Trick with a Symbiosis partner (T11) | no Symbiosis, no guard |

**Hits into a Substitute.**

| Id | Games | Setup | Checks |
|---|---|---|---|
| E24 | sv champions usum swsh | carried Substitute; a single hit, every roll (U1, U16) | HP distribution, breaks share |
| E25 | sv | Brave Bird (30 and 200), Draining Kiss (23; Big Root; Liquid Ooze with and without Big Root, at full HP), Steel Beam (U2, U17, K2, K7) | recoil, ceil drain, Liquid Ooze's raw amount, self-cost once |
| E26 | sv | Life Orb, Shell Bell (with Brave Bird), Normal Gem into a Substitute (U3, K7) | once; none; spent |
| E27 | sv champions usum swsh | Icicle Spear (Skill Link), Bullet Seed 2–5, Triple Axel, Focus Sash behind (U4, U16); Dual Wingbeat into Rocky Helmet after a break (K8) | continuation, KO chance, Sash, one Rocky Helmet hit |
| E28 | sv | Rock Slide into a Substitute and a twin (U5) | spread modifier |
| E29 | sv | Hyper Voice, Infiltrator (U6) | pass it |
| E30 | sv | Rough Skin, Rocky Helmet, Weakness Policy, Occa, Knock Off ×2, Stamina, Air Balloon behind it (U7) | no reactions; Balloon pops |
| E31 | sv | Close Combat, Flame Charge, Fake Out, Nuzzle, Dragon Tail, Rapid Spin with carried Leech Seed, Ice Spinner on Psychic Terrain (U8) | user effects only; Rapid Spin's end-of-turn effect (C16) |
| E32 | sv | U-turn into a Substitute as the last action, and with a later action (U8) | end-of-turn `switchesOut`; turn `switchesOut` |
| E33 | sv | Mimikyu behind a Substitute (U9) | full damage, Disguise kept |
| E34 | sv | Substitute this turn, broken, then Will-O-Wisp; a standing one blocks it (U10) | made this turn; status after the break |
| E35 | sv | Frost Breath into a Substitute (U11) | certain crit |
| E36 | sv | Super Fang into 300 and 30 HP; Seismic Toss (U12) | split by the Pokémon's HP |
| E37 | sv | a trapped Pokémon uses Substitute (U13) | trap ends (end of turn) |
| E38 | sv | Focus Punch behind a Substitute (U14) | focus kept |
| E39 | usum | type Z-Move into a Substitute (U16b); a Z-Move through Spiky Shield into a Substitute | modelled; no contact damage |
| E43 | sv | Icicle Spear into Annihilape behind 30-HP and 300-HP Substitutes, then its Rage Fist (K1) | `timesAttacked` 5 and 0 (`SlotResult.timesAttacked`), Rage Fist damage |
| E44 | sv | Knock Off into a Colbur Berry holder behind a Substitute; Poltergeist into a Kasib Berry holder behind one (K6) | ×1.5 kept, Berry kept, Poltergeist hits |
| E47 | sv | carried Substitute of 44 HP on a Pokémon whose quarter is lower (a Shed Tail one, K3), then Ice Beam | the HP is accepted and capped as any Substitute |

**Reasons only.**

| Id | Games | Setup | Checks |
|---|---|---|---|
| E40 | sv swsh usum | Magician (U15); Max Move (U16c); Parental Bond (usum Mega Kangaskhan); Mind Blown (U17); Icicle Spear into a Substitute in front of Multiscale, of Stamina and of an Occa Berry, and Dual Wingbeat in front of Mummy (`subPerHit`, K5), and of an intact Disguise (`faceMultiHit`); Flame Burst (C17); Booster Energy to a Protosynthesis holder | exact reasons, start rows |
| E45 | sv | Icicle Spear into a Substitute that breaks, in front of Garchomp's Weakness Policy and of a Kee Berry; the same with a Substitute that holds | modelled (no `subPerHit`): Weakness Policy on the first hit after the break, Kee Berry after the move; neither while every hit meets the Substitute |

**Mixed.**

| Id | Games | Setup | Checks |
|---|---|---|---|
| E41 | sv | Trick then Ally Switch then a hit into a carried Substitute, in one turn | the three together |
| E42 | sv | E2 outcomes for E07, E13, E24, E27 | positions, items, Substitute mixtures |


---

## 8. Build plan (delta)

**Step 0 additionally writes:**
- §3.1, §3.3′, §3.4 and §3.5 in full. That includes:
  - the position plumbing;
  - the hooks;
  - `applyStep`'s `part` and the hit count `landed + subHits`;
  - `afterHit`'s `hitAny` split;
  - the Symbiosis exemption and `cloneWorld`'s `itemsMoved`;
  - `HitStats.sub`, kind `"substitute"`;
  - the outcome fields and merge key;
  - the `conditionFacts` aggregator;
  - the kernel additions.
- `uses-to-ko.ts`: `turnCases`, `targetHPClass`, `TurnStepPart` with `subHits`, the part semantics of §3.3′ in full, `itemTakeable`; and `tests/unit/uses-to-ko-turn-part.test.ts`.
- `doubles-actions.ts`: the final REASONS set, keeping `substituteHit` for the stub.
- Stub files `doubles-positions.ts`, `doubles-items.ts`, `doubles-substitute.ts`, with today's behaviour.
- **Gate:** SPEC's gate plus §3.5's three gates.

After Step 0, as in SPEC:
- `doubles-turn.ts` is frozen.
- In `uses-to-ko.ts`, Track B owns the `residuals()` adapter alone; the Step 0 turn API (`turnCases`, `targetHPClass`, the part path, `itemTakeable`) is frozen like `doubles-turn.ts`. Only the integrator edits it, for agreed fixes Track E reports with a failing test.

| Track | Owns (exclusive; disjoint from SPEC §8) | Depends on | Gate |
|---|---|---|---|
| E. Engine: positions, items, Substitute | `app/lib/battle/doubles-positions.ts`, `app/lib/battle/doubles-items.ts`, `app/lib/battle/doubles-substitute.ts`, `app/lib/battle/hit-loop.ts` (`subHit` only), `tests/unit/doubles-positions.test.ts`, `tests/unit/doubles-items.test.ts`, `tests/unit/doubles-substitute.test.ts`, `tests/unit/hit-loop-substitute.test.ts`, `tests/source/doubles-items-takeable.test.ts`, `tests/source/doubles-substitute-census.test.ts` | Step 0 | unit and source tests; golden-1v1 byte-equal (hit-loop.ts); E cases once D runs them; bench |

**Added to existing tracks, in files they already own:**
- **A.**
  - `status-table.ts`: the three moves become M, with handler keys and games.
  - `doubles-status.ts`:
    - dispatch at PrepareHit and onHit;
    - the Sticky Hold TryImmunity row for Trick and Switcheroo;
    - the `adjacentAlly` failure after the ally's Ally Switch (§4.11.4);
    - Substitute's `endTrap`;
    - Leech Seed's `eot.leechSeed = positionOf(w, user)`;
    - this turn's Wish slot = `positionOf`.
  - `doubles-actions.ts` tables: `PRESENCE_MOVES += flameburst` (C17).
- **B.**
  - `doubles-eot.ts` and `residuals.ts`: Wish and Leech Seed by `occupant`; §6.0; the Micle Berry residual (C18, 2v2 only: the 1v1 adapter leaves it out).
  - Training: §6, now also `sim/effects.ts`.
- **C.** §5.
- **D.**
  - §7, including the identity change in `sim-dfs.ts`;
  - C15;
  - E01–E47;
  - S48's reason-only representatives: drop Ally Switch and Trick (now modelled) and keep Skill Swap, Soak, Attract and Transform; add Bestow (usum) as an L representative.

**Order.**
1. Step 0.
2. A, B, C, D and E in parallel. E tests its handlers directly on kernel fixtures until A's dispatch lands.

**Integration (additions).**
- Delete `REASONS.substituteHit` and its stub path: one line, the integrator's.
- E cases.
- The live `/calculator` 2v2 check adds:
  - Ally Switch + Aqua Jet;
  - Trick Choice Scarf onto a slower foe;
  - a carried Substitute + Icicle Spear;
  - the Substitute control at 375 px.

---

## 9. Test plan (delta)

- **Unit (Step 0):** `uses-to-ko-turn-part.test.ts` (§3.5 gates).
- **Unit (Track E):**
  - **`doubles-positions.test.ts`:**
    - `positionOf` and `occupant`;
    - each targeting rule of §4.11.4 on fixtures, the tracking moves at their own ally included;
    - the counter split (exactly 1/c; ×3 capped at 729);
    - the fainted-ally failure after the roll;
    - start-row routes.
  - **`doubles-items.test.ts`:**
    - the swap and the failure facts;
    - `itemTakeable` both ways;
    - Unburden's four cases;
    - each receipt row of §4.12.4;
    - `itemsMoved`, across a cloned world.
  - **`doubles-substitute.test.ts`:**
    - the prefix DP on fixed rolls: capped, broken, continuation `skip`;
    - ceil drain vs round; Liquid Ooze's raw amount at full HP;
    - Steel Beam's cost once;
    - the resist-Berry and face stand-ins and their restoration;
    - the attacker fainting in the prefix; a Berry the prefix ate;
    - the hit count `landed + subHits`;
    - the narrow guards and `SUB_PER_HIT`'s exact set;
    - stats into `DoublesHit.substitute`;
    - reference mode equals normal mode on 10 Substitute turns.
  - **`hit-loop-substitute.test.ts`:** `subHit` arithmetic (U2 values: 10, 27, 18, 23; Liquid Ooze 10 with and without Big Root, K2), Rock Head vs Steel Beam and Chloroblast, Magic Guard.
- **Source (Track E):**
  - **`doubles-items-takeable.test.ts`:** every catalog item with a pinned `onTakeItem`, holder × receiver species, equals `itemTakeable`.
  - **`doubles-substitute-census.test.ts`:**
    - every pinned `onAfterSubDamage` handler (moves and items) and every `hitSub` check (items, abilities) is classified in §4.13.10, or as unreachable in the four catalogs;
    - `SUB_PER_HIT` equals the target abilities and items the engine's per-hit loop reads (@smogon/calc `checkMultihitBoost`, the `hitCount === 0` terms of `calculateFinalModsSMSSSV`), less the Parental Bond-only ones (Gooey, Tangling Hair) and the items `calculate.ts` withholds between hits (`AFTER_MOVE_ITEMS`: Kee Berry, Maranga Berry, White Herb);
    - no catalog move has a multi-hit count together with recoil, drain or a self-cost (§3.6).
- **Existing tests touched:**
  - `doubles-turn-guards.test.ts`: `substituteHit` cases become ready or narrow.
  - `calculator-doubles-ui.test.ts` (C): the Substitute control, the conditions facts, kind `"substitute"` lines.
  - Training (B): bridge `carried.substitute` (the maker's quarter after Shed Tail and Baton Pass) / `allySwitch` and the rollout text; `evaluate` positions; the choicelock rule after Trick.
  - `doubles-eot.test.ts` (B): the Micle Berry residual.
- **1v1:** `golden-1v1.full.json.gz` byte-equal after `hit-loop.ts` and `uses-to-ko.ts` change.
- **Oracle:** §7.1.

---

## 10. Risks (delta)

- **Position plumbing reaches every target read.** It is written once in Step 0 and is behaviour-neutral without `swapped`; the 556 gate and §3.5's gates catch drift. E01–E12 and E46 cover each rule, and reference-mode equality runs on 10 Ally Switch turns.
- **The `part` path inside `uses-to-ko.ts`** is the subtlest addition: user vs target effects on a hit into a Substitute, and which of the after-hits losses need damage to the Pokémon.
  - It was verified against U3, U8 and K7.
  - Step 0's own test file pins it before it is frozen.
  - The census test pins the `onAfterSubDamage` handlers.
  - E25, E26, E30 and E31 run each class.
  - It is unreachable from 1v1.
- **Stand-ins in the calculation into a Substitute** (Leftovers for a resist Berry, Run Away for a face) must never reach the world: §4.13.7 puts the real item and ability back, and `doubles-substitute.test.ts` checks it.
- **World growth from Substitute HP.** It is bounded by BUDGET, and the bench measures it.
- **A multi-hit move into a Substitute** is exact only without the per-hit effects of §4.13.6. The guard set is the engine's own per-hit reads, so the reason is narrow and never a wrong number.
- **Training.**
  - A Substitute's HP after a hit is not public on either side, so it is a rollout.
  - The choicelock derivation after Trick must change (§6), or the next decision's belief battle would lock a Pokémon Showdown leaves free.
  - The leak gate covers the new fields.
- **Pre-existing gaps fixed on the way:** Flame Burst (C17), Rapid Spin's end-of-turn effect (C16), the oracle's Wish setup (C15), Micle Berry with Cheek Pouch (C18).

---

## 11. Settled points

Each was open in the designer's draft; pinned Showdown, the house rules or the user's answers decide it.

1. **The Substitute control** (§0.4) is in this build. Q3 models the Substitute's HP as state; without the control the calculator reaches it only in the rare same-turn case. It is state from an earlier turn in Q1's form, not the rejected "Last move" input, and unticked it changes nothing.
2. **Training: a Substitute that has taken a hit is a rollout.** The HP after a hit is hidden on both sides (the `-activate` line has no number), and a rollout is Training's form of "not estimated".
3. **The narrow reasons that remain** are factual and rare in VGC: Max Moves, Parental Bond, Magician, Mind Blown and a signature Z-Move into a Substitute; a multi-hit move into a Substitute in front of one of §4.13.6's per-hit effects; received Seeds, Room Service and Booster Energy; Dragon Darts aimed at its user's own spot.
4. **Duplicate-species names after Ally Switch** keep the suffix of the starting position: names are identity labels fixed for the turn, as the cards are, and the swap is stated as a condition fact. Changing them would change existing outputs.
5. **`uses-to-ko.ts` ownership:** Step 0's turn API is frozen after Step 0, with integrator-only fixes; Track B owns the `residuals()` adapter alone (§8).
6. **World growth:** no late merge. The budget's `Too many cases to follow.` covers the worst case, and the bench gate measures the common ones.
7. **Flame Burst:** a presence guard owned by Track A (C17).
8. **Bestow** stays L, per Q2.

---

## Critic changes

What the critic changed in the designer's draft, and why. Probes: `critic-probes-1.ts` → `critic-probes-1.out` (`k:N`).

1. **Bestow moved back to L.** The user's Q2 answer pulls in Ally Switch and Trick / Switcheroo and says the other L moves stay L. The draft had pulled Bestow in too. Changed: classification M 125 / L 73, §2.2, §3.5's dispatch and stubs, §4.12 (Bestow's function removed), §6 census, E21, S48. T9b's facts stay recorded for the later build.
2. **Rage Fist's hit count.** Showdown adds every hit of the move, the Substitute's included, to `timesAttacked` once the last hit reached the Pokémon (K1: 5 after a Substitute that broke on hit 2; 0 when no hit got through). The draft kept `timesAttacked += landed`. Fixed in §0.3, §3.5.5 and §4.13.7; oracle field `SlotResult.timesAttacked`, case E43.
3. **The after-hits losses with a part.** The draft ran `afterHitsLosses`' "rest" on any hit. That term includes Steel Beam's and Chloroblast's self-cost, which a hit into a Substitute already paid in its own hit, and today's code gives recoil and Shell Bell at least 1 HP even at 0 damage. Showdown needs `move.totalDamage > 0` for recoil, a second self-cost and Shell Bell (K7: Steel Beam ½ once, Brave Bird + Shell Bell no heal). §3.3′ now splits the terms: Life Orb on `hitAny`; recoil, self-cost and Shell Bell on `dealt > 0`. It also defines the attacker's HP after a use with no damage to the target. `userSecondary` counts every hit of the move. Step 0 gets a test file that pins this before the path is frozen.
4. **The resist Berry stand-in.** The draft removed the Berry for the calculation into the Substitute. That also drops Knock Off's ×1.5 and fails Poltergeist, which Showdown still gives for a held Berry behind a Substitute (K6: Colbur 146 = Leftovers 146 vs no item 100). The stand-in is now `leftovers`, as `calculate.ts` already uses one. Both stand-ins are put back after the step so they never reach the world (§4.13.3, §4.13.7, E44).
5. **`SUB_PER_HIT` made exact.** Mummy, Lingering Aroma and Wandering Spirit were added: behind a Substitute the attacker keeps Technician for every hit, while the engine's multi-hit loop swaps the ability after hit 1 (K5). Water Compaction and Luminous Moss were added from `checkMultihitBoost`. Removed:
    - the reactions that change no damage the attacker deals;
    - Kee and Maranga Berry, which `calculate.ts` already withholds between hits (`AFTER_MOVE_ITEMS`).

    `afterHit` applies these exactly for the hits on the Pokémon (E45). Faces get `faceMultiHit` whenever the Substitute is there (§2.4 and §4.13.6 now agree). The census test checks that the set is equal to the engine's per-hit reads, not just a superset.
6. **Liquid Ooze in `subHit`.** It deals the raw `ceil(taken·drain)`, unchanged by Big Root, and acts at full HP too (K2: 10 with and without Big Root, 170→160 at full). The draft's "Big Root …, none at full HP, Liquid Ooze instead" ordering read otherwise (§3.6).
7. **Shed Tail Substitutes.** A passed Substitute keeps its maker's quarter (K3: 44 on a 1-HP Shedinja). The draft's validation bound, `floor(maxHP/4)` of the holder, would have rejected Training's legal state. The bound is now "at least 1" (C13′, §3.1). The tracker keeps `maker` and `hits` per Substitute stint, through Baton Pass and Shed Tail, and the bridge and `effects.ts` use the maker's maxHP (§6, E47).
8. **Tracking moves at their own ally after Ally Switch** were verified (K4: Snipe Shot and Stalwart hit the ally). The draft's exemption stands and is now cited. Track A's own `adjacentAlly` path gets the same `[notarget]` failure, since `resolveTargets` does not see those moves (§4.11.4, E03).
9. **The prefix that changes the attacker.** A Berry the prefix ate is written to the world, and the search re-runs for the new build. An attacker that faints in the prefix skips the step, but the Air Balloon still pops. A Z-Move breaking through Protect meets no contact effect on a hit into a Substitute (§4.13.7, E39). The census asserts that no multi-hit move has recoil, drain or a self-cost, so a prefix that changes the attacker's HP never has hits after it (§3.6).
10. **Smaller fixes.**
    - `cloneWorld` copies `itemsMoved`.
    - Outcomes merge on `volatiles` and `allySwitch`, so a `substitute` mixture's chances sum to 1.
    - The kernel lists what `doubles-substitute.ts` calls.
    - The card shows no "Its Substitute breaks" condition; a break is the hit's fact.
    - C16 has Showdown's HP and Sheer Force conditions.
    - The comment in `DoublesCarried` separates positions (Leech Seed, Wish) from Pokémon (trap source, Syrup Bomb).
    - The choicelock rule after Trick covers the Trick user itself.
    - §4.12.4 says why Utility Umbrella and Metronome need nothing: no catalog has both Castform and Utility Umbrella, and a turn's first use reads a Metronome count of 0.
11. **C18 added (Micle Berry).** A Cheek Pouch holder eating a Micle Berry at the end of turn heals `baseMaxhp/3`. SPEC listed Micle as state only, and Trick can now deliver one. Track B models it as the last residual, in 2v2 only (§2.3, E20).
12. **The draft's unsettled points are settled** in §11. The Substitute control stays (Q3), the late merge is dropped (budget-guarded), the duplicate-species suffix stays as identity, and the `uses-to-ko.ts` turn API is frozen after Step 0. Nothing is optional.
