# Tier 2, moves phase: the remaining census guards (status2 design)

Design only (branch `calc-2v2-status-2`, main `4008ee8`; no app code, test or doc changed). Input: SPEC2.md (all of it),
USER-DECISIONS.md (final: Q6 "include the other census guards in THIS build: model each exactly, or keep it only with a
narrow, exact reason and a written justification"; Q13 Electrify / Ion Deluge "model these too where exact"),
census-guards.md/.json, the four family designs (guards.md §6 has a "model" row for most entries here) and their probes.
ADDENDUM2.md did not exist when this was written: where it later contradicts this file, ADDENDUM2 wins.

Ground truth is pinned Showdown `c23d2e94`: `PS/…` is the read-only source
`node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353`; probes run on the runnable copy
`scripts/.cache/calc-audit/showdown` through `guards-sim.ts`. App line numbers are the tree at `4008ee8`.

| File (this folder) | What |
|---|---|
| `tier2-moves-dex.ts` → `.out` | per game: presence and learner / holder counts of every move, ability, item and species below |
| `tier2-moves-probes-1.ts` → `.out` | `T2-SI*` semi-invulnerable family (14 probes, 5 controls), `T2-CR*` crash damage (5) |
| `tier2-moves-probes-2.ts` → `.out` | `T2-VS*` volatile secondaries, `T2-SE*` spread composition, `T2-SCK01`, `T2-CD*` Cotton Down, `T2-FV*` veils, `T2-AF*`/`T2-IO*` Aftermath / Innards Out, `T2-BB*` Battle Bond, `T2-RC*` Receiver / Power of Alchemy, `T2-UN*` Unnerve |
| `tier2-moves-probes-3.ts` → `.out` | `T2-FA*` faces (multi-hit, Parental Bond, 0-damage reactions, self-hit), `T2-FB01` Focus Band, `T2-BE*` Berries between hits, `T2-AR*` Sparkling Aria, `T2-GW01` gen 7 Gale Wings, `T2-AS01` Assurance, `T2-PS01` Pain Split, `T2-ST01` Sleep Talk, `T2-UP01` Uproar, `T2-SG01` Safeguard |
| `tier2-moves-probes-4.ts` → `.out` | `T2-SB*` into a Substitute, `T2-SP01` per-hit behind a Substitute, `T2-GM*` G-Max effects and Max Guard, `T2-RI*` received items |
| `tier2-moves-probes-5.ts` → `.out` | `T2-Q*` Q13: Electrify / Ion Deluge on own-type moves, Z-Moves (generic and signature), Max Moves (G-Max included) |
| `tier2-moves-app-probes.ts` → `.out` | today's app against the oracle: three silent gaps found in passing (§1.2) |

All `.err` files are empty. Run any probe file from the repo root with `npx --no-install tsx <file> [ID …]`.

---

## 0. Decisions in one page

**28 entries plus Q13. 26 are modelled exactly, 2 are kept with a written justification; 4 narrow residual reasons
remain inside modelled entries.** Every model is exact against pinned Showdown in each game where the entry exists; no
number is assumed.

| Entry | Games (catalogs) | Decision | Track | Residual reason |
|---|---|---|---|---|
| semi-invulnerable | all four | **Model**: a hidden state; the invulnerability step for damaging and status moves; ×2 exceptions; landing (Gravity, Smack Down); the release turn from an earlier turn | H | — |
| *(found)* crash damage | all four | **Fix** (silent wrong number today: §1.2) | H | — |
| volatile-secondaries | BJ sv ch swsh; AV sv ch; ST, CE swsh usum | **Model** all four | K | — |
| spread-effect | all four | **Model**: target reactions off in spread steps, replayed in hit order | K | `spreadEffect` only for Dragon Darts' two darts with a Defiant or Competitive user into Cotton Down |
| spread-contact-ko | all four | **Model** | K | — |
| ally-effect | all four | **Model** | P | — |
| unnerve-resist | all four | **Model** (stand-ins) | K | — |
| unnerve-recoil | all four | **Model** (the hit's Update reads Unnerve gone) | K | — |
| cotton-down | swsh | **Model** | K | — |
| flower-pastel-veil | FV all four; PV swsh | **Model** (the step takes the side's veil) | K | — |
| battle-bond | sv (boost), usum (Ash form); not usable in champions | **Model** | K | — |
| aftermath-innardsout | AM all four; IO ch swsh usum | **Model** (inside the hit) | K | — |
| receiver-alchemy | Rec all four; PoA sv usum | **Model** (A1's setAbility) | K | A1's `abilityStart` for a copied ability whose Start is not modelled |
| face-guards | all four (Ice Face sv swsh) | **Model** multi-hit, Parental Bond, every 0-damage item reaction and move effect | S | Eject Button / Red Card behind a face stay with the switch family (wave 2 R) |
| focus-band | all four | **Model** (1/10 per knockout hit, the self-hit too) | P | — |
| berry-between-hits | sv swsh usum | **Model** (a continuation from the Berry's hit) | P | — |
| aria-faint | all four | **Model** (the faint's cause is known) | P | — |
| gale-wings-gen7 | usum | **Model** (the frozen priority reaches the calculation) | P | — |
| assurance-own-hp | all four | **Model** (`hurt` exact per world) | P | — |
| gmax-effects | swsh | **Model** all, Max Guard included | M | — |
| darts-aim-self | sv ch swsh | **Keep** (§3.20) | — | `dartsAimSelf` |
| received-item | Seeds all four; Room Service sv swsh; Booster Energy sv | **Model** Seeds and Room Service; **keep** Booster Energy (§3.21) | A3 (+) | `received` for Booster Energy |
| into-substitute | all four | **Model** Max Moves, signature Z-Moves, Mind Blown, Magician, Parental Bond | S | `intoSubstitute` for a multi-hit move with recoil, drain or a self-cost (no catalog move: asserted) |
| sub-per-hit | all four | **Model** constant-power multi-hit moves | S | `subPerHit` for Triple Axel / Triple Kick and for Parental Bond in front of a per-hit effect |
| pain-split-dynamax | swsh | **Model** | C | — |
| face-self-hit | all four | **Model** | S | — |
| sleep-talk-uproar | all four | **Model** (Sleep Talk needs the user's moves) | C | `Sleep Talk needs {Name}'s moves.` (new, input missing) |
| safeguard-damaging-status | all four | **Model** (+ Safeguard from an earlier turn as an input) | C | — |
| helping-hand-twice | all four | **Model** (reachable only once a calling move is modelled) | C | — |
| Q13 Electrify / Ion Deluge | Electrify ch swsh usum; Ion Deluge usum | **Model** own-type moves, generic and signature Z-Moves, Max and G-Max Moves | M | — |

**Three silent wrong numbers found in passing** (§1.2; each an `IN-` commit before its track's work):
High Jump Kick, Jump Kick, Axe Kick and Supercell Slam never crash (into Protect, an immune target, or a miss);
Burning Jealousy as the last action into a Pokémon whose stats rose this turn gives no burn (the end of turn misses the
burn damage); Spectral Thief as the last action leaves E2 with the target's boosts and none on the user (Core Enforcer
as the last action is the same shape: guarded today only because a No move action counts as a later action).

**Build shape.** Six new tracks with their own new files (H, K, P, S, M, C), small additions to five SPEC2 tracks' own
files (A2, A3, E, T, U, V), and additions to SPEC2's Step 0 (0a: the modules and hook calls; 0b′: engine plumbing keyed
on fields nothing sets). No new kernel file is edited after Step 1 except by the integrator. §6 gives the table.

**One new shared primitive** (Step 0b′, `uses-to-ko.ts`): a step can stop a use at a hit and the kernel continues it
with a changed target (the existing `TurnStepPart`, plus `fresh` for a continuation whose first hit reads the target as a
first hit). Faces, Berries between hits, the hits behind a Substitute and Parental Bond into a Substitute all use it.

**New randomness, all branched:** Focus Band 1/10 per knockout hit (and per self-hit); a Starf Berry between hits 1/n;
Sleep Talk 1/k over its callable moves, then the called move's random target; G-Max Befuddle 1/3 and Stun Shock 1/2 per
foe; G-Max Replenish one 1/2 for the whole side. Budgets unchanged; "Too many cases to follow." stays the only fallback.

---

## 1. What the probes settle

### 1.1 Showdown facts this design rests on (each probe's run is in the `.out`)

| Probe | Game | Fact |
|---|---|---|
| T2-SI01 / c | sv | Dig: the ally's Earthquake hits the digger at 2× (138 vs 69) and still at the spread 0.75 (`PS/data/moves.ts:3586` dig condition `onInvulnerability`, `onSourceModifyDamage`) |
| T2-SI02, 02b | sv | Body Slam and Thunderbolt at a digger miss (`-miss`); the foe's Earthquake hits it at 2× and the others at 0.75 |
| T2-SI03 / c | sv | Fly: Gust at 2× (36 vs 18), Hurricane unchanged (60 both) (`:5895`) |
| T2-SI04 / c | ch | A spread Rock Slide misses the Fly user and hits its ally at 0.75 (58 both: `move.spreadHit` is set before the hit steps, `PS/sim/battle-actions.ts:550`) |
| T2-SI04d | ch | A foe's Earthquake misses the Fly user; Smack Down hits it (2×, Rock) and grounds it (`-start Smack Down`) |
| T2-SI05 / c | swsh | Bounce: Gust and Twister at 2× through base power (`:1703` `onSourceBasePower`) |
| T2-SI06 / c | usum | Dive: Surf at 2× (20 vs 10), the others at 0.75 |
| T2-SI07 | sv | Phantom Force: Earthquake misses; a No Guard user's Knock Off hits (`PS/data/abilities.ts:2970`) |
| T2-SI08-sv / -usum | sv, usum | A Poison type's Toxic hits a Fly user, a Snorlax's misses (gen 8+: `PS/sim/battle-actions.ts:627`; gen 7: the toxic volatile's `onSourceInvulnerability` returns 0, `PS/data/mods/gen7/moves.ts:1031-1047`) |
| T2-SI09 | sv | Gravity brings the Fly user down (`-activate … move: Gravity`); a later Thunderbolt hits (`:7755` gravity `onFieldStart` removes fly / bounce and `cancelMove`) |
| T2-SI10 | usum | Lightning Rod redirects into its digging holder first, then the move misses: no Sp. Atk rise (invulnerability is step 0, TryHit step 1: `PS/sim/battle-actions.ts:555-560`) |
| T2-SI11, 11b | sv | Thunder Wave and a spread Growl miss the Fly user (Growl still lowers its ally); its ally's Pollen Puff misses it; Perish Song misses it (`PS/data/moves.ts:13247`, explicit check), Haze reaches it (no check) |
| T2-SI12b / c | ch | A Fly user from last turn is hidden from the turn's start: a faster Thunderbolt misses; fully paralysed on its release, it stays hidden to the end of the turn (a slower Body Slam misses); released, a slower Body Slam hits |
| T2-SI13 | sv | Earthquake from the digger's own ally: 2× |
| T2-CR01–05 | sv, usum, ch | A miss into a semi-invulnerable target, Protect, a type immunity, Supercell Slam into Protect: the user loses `trunc(baseMaxhp / 2)` (`PS/data/moves.ts:8899` `onMoveFail`, run from `PS/sim/battle-actions.ts:527` when every target failed; no MoveFail with no target at all, `:504-508`); Magic Guard none |
| T2-VS01-sv / -swsh, c | sv, swsh | Burning Jealousy burns a foe whose stats rose this turn (Howl); its later Body Slam reads the burn (33 at +1 Atk burned, against 40 at +0 unburned in the control); burn damage at the end of turn (`PS/data/moves.ts:2071`) |
| T2-VS02 | sv | Alluring Voice confuses the raised foe (`:282`) |
| T2-VS03, 03b | swsh, usum | Spectral Thief steals every positive stage (evasion included) with `boost()` on the user, then sets the target's to 0, before the hit; through a Substitute too (`PS/sim/battle-actions.ts:781-806`) |
| T2-VS04 | usum | Core Enforcer suppresses a target that has moved (`-endability`), not one still to move; a later Earthquake hits the suppressed Levitate holder only (`:2874`) |
| T2-SE01 | ch | A spread move into Scovillain-Mega: one Spicy Spray burn, after both targets' damage |
| T2-SE02 | ch | Breaking Swipe into two Gooey Goodra: secondaries of both targets first, then each DamagingHit in order: Spe −1 and Defiant +2, twice (+4 Atk, −2 Spe) |
| T2-SE03 | ch | At Spe −6 both Gooey drops fail and Defiant does not rise: composing end states would give +4 (§3.3) |
| T2-SE04 | sv | Two Gooey drops, then White Herb restores once at the Update after the hits |
| T2-SCK01 | ch | Spiky Shield knocks the 20-HP user out before the hits; its other target is still hit and dropped |
| T2-CD01, 02 | swsh | Cotton Down: Spe −1 on every other active Pokémon in position order (`getAllActive`), per hit; Mirror Armor reflects to the holder; an ally of the user with Defiant rises +2 per hit |
| T2-FV01, 02 | sv | Flower Veil keeps Snarl's drop off its Grass ally (no message for a secondary), not off itself (Fairy); Mold Breaker passes it (`PS/data/abilities.ts:1419`) |
| T2-AF01–03 | sv | Aftermath: `trunc(baseMaxhp/4)` inside the hit, the attacker's Sitrus at the hit's Update, before recoil; Damp anywhere stops it (`:78`, `:811`) |
| T2-IO01–03 | swsh, ch | Innards Out deals the HP the holder had as the move started (one hit, a two-hit Dual Wingbeat, a spread Rock Slide after both damages) (`:2140`: `damage + move.totalDamage`, totalDamage summed after each hit) |
| T2-BB01, 02, 03 | sv, usum | SV: +1 Atk, SpA, Spe once (`bondTriggered`); USUM: `detailschange` to Greninja-Ash (`PS/data/mods/gen8/abilities.ts:104`); with no foe left none (`foePokemonLeft`, decremented before AfterFaint `PS/sim/battle.ts:2553, 2601`) |
| T2-RC01, 02 | sv, usum | Receiver takes the fainted ally's Intimidate, which then acts at once; Power of Alchemy takes Levitate; a later Earthquake misses it |
| T2-UN01 / c, 02, 03 | sv | A third Pokémon's Unnerve stops a Haban Berry (116 vs 58); the user's own Unnerve does not stop its ally's Shuca Berry; a Flare Blitz knockout of the Unnerve holder: the user's Sitrus at the hit's Update, before the recoil |
| T2-FA01-sv / -usum | sv, usum | Double Hit into Mimikyu: hit 1 no damage, the busted form at the Update, the 1/8 chip (gen 8+ only), hit 2 into the busted form (24) |
| T2-FA02 / c | swsh | Ice Face: hit 1 no damage, Noice at the Update, hit 2 equal to Noice's own hit (40) |
| T2-FA03 | ch | Parental Bond Crunch: strike 1 no damage, chip, strike 2 (×0.25) into the busted form (11) |
| T2-FA04–12 | sv | On the 0-damage face hit: Rocky Helmet hurts the attacker (1/6); Air Balloon pops; Kee Berry is eaten (+1 Def, after the move); Sticky Barb moves to the attacker; Knock Off and Thief take the item; Fire Spin traps; Salt Cure starts; Magician takes the item |
| T2-FA13-sv / -usum | sv, usum | A confusion self-hit (effectType Move) is taken by Disguise: busted, the chip in gen 9 only |
| T2-FB01 | sv | Focus Band saves a confusion self-hit 1/10 (`PS/data/items.ts:2249`) |
| T2-BE01, BE02 | sv, swsh | A Ganlon Berry eaten at the Update between two hits: hit 2 reads +1 Def (37 vs 55); Starf: one of five stats at random, hit 2 reads a +2 Def (survives at 27 in 1/5) |
| T2-AR01, 02 | sv | A Life Orb knockout after the hits still cures the burn; a Rowap Berry knockout during the hits does not (`PS/data/moves.ts:17358` `source.fainted`) |
| T2-GW01-usum / -sv | usum, sv | Talonflame hit by a faster Extreme Speed before it moves: USUM keeps the +1 sorted at the turn's start and Dazzling stops Brave Bird; SV re-sorts (priority 0) and it hits |
| T2-AS01 / c | sv | Assurance doubles after the target's own Flare Blitz recoil (61 vs 31) |
| T2-PS01 | swsh | Pain Split into a Dynamaxed Snorlax at 300/470: undynamaxed 150, average 125, target −25 (275), user 125 (`PS/data/moves.ts:13129`, `PS/sim/pokemon.ts:748`) |
| T2-ST01 | sv | Sleep Talk: uniform over Body Slam, Earthquake, Protect (1/3 each); Body Slam's target uniform over the two foes |
| T2-UP01 | sv | Uproar wakes a sleeping foe at its hit; Rest and Spore then fail (`-fail … [from] Uproar`) (`:20211`) |
| T2-SG01 | sv | Safeguard set this turn keeps a later Nuzzle's paralysis off its side (damage dealt) |
| T2-SB01–03 | swsh | A Max Move into a Substitute: Max Darkness still lowers every foe's SpD (the Substitute holder's too), Max Knuckle raises the user's side, Max Lightning sets Electric Terrain |
| T2-SB04, 05 | usum | Clangorous Soulblaze is a sound move (passes Substitutes); Splintered Stormshards ends the terrain through a Substitute (`onAfterSubDamage`) |
| T2-SB06 / b | ch | Parental Bond Power-Up Punch into a Substitute: two strikes, +1 Atk per strike (atk +2), whether or not the first breaks it |
| T2-SP01 / c | sv | Dual Wingbeat into a full-HP Multiscale Dragonite's 30-HP Substitute: hit 2 reads Multiscale (the Substitute breaks only on hit 2; the Pokémon takes none) |
| T2-GM01–09 | swsh | Smite, Gold Rush: every foe confused; Cuddle: the opposite-gender foe infatuated; Chi Strike: `gmaxchistrike` on the user's side; Finale: the side heals 1/6 (39 of 235); Befuddle: per foe slp / par / psn 1/3 each; Stun Shock: per foe par / psn 1/2; Replenish restores the side's Berries; Max Guard blocks a Max Move |
| T2-RI01–03 | sv | A Seed or Room Service is used by its giver first (so only a giver that cannot use it passes it on, status-eot T10c); Trick of Booster Energy with a Paradox Pokémon fails |
| T2-Q01–Q16 | swsh usum ch | Electrify: a Max Move becomes Max Lightning (Electric Terrain) or the Electric G-Max move (G-Max Volt Crash); every Z-Move keeps its name and becomes Electric (Breakneck Blitz, Inferno Overdrive, Pulverizing Pancake); every own-type move becomes Electric with the power it had as used (Weather Ball 100 in sun, Terrain Pulse 100, Judgment, Multi-Attack, Techno Blast, Revelation Dance, Natural Gift, Hidden Power, Aura Wheel, Raging Bull with its screen break). Ion Deluge only where the type is Normal at that point (Weather Ball with no weather: Electric; in rain: Water) |

Source order these rest on, read directly: `useMoveInner` (`PS/sim/battle-actions.ts:380-445`): Z conversion from the data
type (Weather Ball's own ModifyType first, `:393-397`), Max conversion after the move's own and the runEvent ModifyType
(`:402-408`), then ModifyType again on the converted move (`:430-438`); `getActiveZMove` / `getActiveMaxMove`
(`:1425-1515`); `trySpreadMoveHit` steps (`:549-592`); `hitStepMoveHitLoop` (`:857-1020`: the Update after each hit,
`totalDamage` after each hit, recoil after the loop); the Substitute's `onTryPrimaryHit` (`PS/data/moves.ts` substitute
condition: damage to it, `applyRecoilDamage` per hit into it, drain, `AfterSubDamage`).

### 1.2 Silent wrong numbers in today's app (`tier2-moves-app-probes.out`)

| Case | Today | Showdown | Fix |
|---|---|---|---|
| T2A-CR1 sv: High Jump Kick into a Protect user | kicker 125/125 | 63/125 (crash) | IN-CRASH (Track H, §3.1.6) |
| T2A-CR2 champions: High Jump Kick into Gengar | 153/153 | 77/153 | IN-CRASH |
| T2A-CR3 sv: Supercell Slam into Protect, the kicker's ally then Body Slams it | 84–98 (a Sitrus shown) | 0 (crash 67, then the Body Slam knocks it out) | IN-CRASH |
| T2A-VS1 sv: Burning Jealousy as the last action into a Lucario after its Swords Dance | end of turn 61–77 | 52–68 (burn 9) | IN-BJ (Track K, §3.2) |
| T2A-VS3 swsh: Spectral Thief as the last action into a +2 Atk Lucario | E2 user Atk 0 | Atk +2 | IN-ST (Track K, §3.2) |

Core Enforcer as the last action is the same gap (no later Pokémon's move reads the suppression, the end of turn does:
Poison Heal, Speed Boost, Rain Dish…): today a No move action of a slower Pokémon counts as a later action, so the
guard fires (T2A-VS2 is not estimated); with every slot faster it would be silent. Its model (§3.2) closes it.
The guards that fire today give these texts (T2A-SI1, T2A-AF1): `Garchomp is semi-invulnerable after Dig: later moves
are not modelled.`, `Aftermath is not modelled in 2v2.`

### 1.3 Where the census or guards.md was wrong or short

- **Battle Bond in Champions** (census: champions sv usum): the app does not accept it there (`validateBuild`: "Greninja
  with Battle Bond counts as Greninja-Bond, which is not available in Champions", T2A-BB1 preflight). Showdown's handler
  needs species `greninjabond`. So the entry is SV and USUM only.
- **Booster Energy received by Trick** (census received-item): Trick with a Paradox Pokémon on either end fails (T2-RI03,
  Booster Energy `onTakeItem`); a non-Paradox holder of Protosynthesis or Quark Drive exists only after an ability change
  (Trace, Skill Swap, Receiver, Doodle). Kept (§3.21).
- **Pastel Veil**: the only damaging poison the turn gives at 100% in SwSh is G-Max Malodor (kernel `giveStatus`, already
  through canStatus) or a 50% move under Serene Grace; the step-side part is real but tiny. Flower Veil's is the main part.
- **guards.md "Max Guard: a protect kind"** is right, and Max Guard is also what *any* Dynamaxed status move is
  (`getActiveMaxMove` with category Status), so the presence guard `maxGuard` (doubles-turn.ts:808) is the entry.
- **guards.md "aria-faint: keep"**: the cause is knowable (spreadStep's loss groups; the step's in-hit faint), so modelled.
- **guards.md "darts-aim-self: keep"** stands: the darts hit their own user (status-eot A2, `p1:149`), the one damaging
  move whose user is its target (§3.20).
- **Helping Hand twice** is unreachable only while every calling move is guarded; the presence architect may model some
  (Copycat, Instruct), so the model is cheap insurance (§3.28).
- **Semi-invulnerable "the easy half"**: not only later moves read the state: Perish Song and Teatime check it
  explicitly (T2-SI11b, `PS/data/moves.ts:19048`), Gravity and Smack Down end it and cancel a release-turn move, and the
  release turn of a two-turn move charged last turn starts hidden (T2-SI12b), which Training sends to rollouts today
  (`bridge.ts:294`: `fly is not modelled`).

---

## 2. Shared machinery (contract, Step 0 additions, engine plumbing)

Same rules as SPEC2 §3: every field is optional and set only by the 2v2 turn, Training's bridge or a 2v2 calculator
control; Step 0 writes all of it with stubs that reproduce today's behaviour, and every new reader is keyed on a field
nothing sets yet, so Step 0's gates stay byte-equal (golden-1v1, the 1264 stored cases with their facts, the bench).

### 2.1 Contract additions (paste into SPEC2 §3.1–§3.3)

```ts
// doubles-types.ts DoublesCarried (beside SPEC2's A1/A2/D blocks):
  // ---- H: two-turn moves ----
  /** SPEC2 A1's `charging?: "geomancy"` widens to any two-turn move charged last turn: this turn is its release (no
   *  charge); Fly, Bounce, Dig, Dive, Phantom Force and Shadow Force start the turn hidden (T2-SI12b). Its action must be
   *  that move (Showdown locks the choice). */
  charging?: "geomancy" | "fly" | "bounce" | "dig" | "dive" | "phantomforce" | "shadowforce" | "solarbeam" | "solarblade"
    | "meteorbeam" | "electroshot" | "skyattack" | "skullbash" | "razorwind" | "freezeshock" | "iceburn";
  /** Lock-On or Mind Reader from last turn at the Pokémon that started this turn in that slot (its moves at it pass
   *  semi-invulnerability: the lockon volatile's onSourceInvulnerability, PS/data/moves.ts:10395). */
  lockOn?: DoublesSlotId;
  // ---- K ----
  /** Scarlet/Violet: its Battle Bond acted in an earlier turn (pokemon.bondTriggered: no second boost). */
  bondUsed?: true;
  // ---- C ----
  /** An Uproar from an earlier turn: its turns left (1 or 2); no Pokémon falls asleep while it lasts; its action is Uproar. */
  uproar?: 1 | 2;

// doubles-types.ts DoublesPokemonInput: SPEC2's `moves` (move-slot order) is what Sleep Talk reads (§3.26).
// DoublesOutcomeMon gains:
  /** The two-turn move it charged this turn (its release next turn); present exactly when volatiles has "twoturnmove". */
  charging?: string;
  bondUsed?: true;
  /** G-Max Chi Strike layers (SwSh). */
  chiStrike?: 1 | 2 | 3;
// DoublesOutcomeMon.volatiles gains "uproar", "lockon", "gmaxchistrike", and the hidden move's id ("fly", "dig"…) beside
// SPEC2's "twoturnmove".
// SideConditions (types.ts, "Doubles turn only"): safeguard?: boolean  (a Safeguard from an earlier turn; §3.27).

// types.ts BuildBase (calculation-only markers, beside SPEC2's takenMods):
  takenMods?: { minimize?: true; glaiveRush?: true; berryWeaken?: true;
    /** H: the defender is hidden by this move (calcBuild from vol.hidden): Fly, Dig and Dive ×2 final damage for their
     *  move lists, Bounce ×2 base power for Gust and Twister (PS/data/moves.ts:1703, 3586, 3748, 5895). */
    hidden?: "fly" | "bounce" | "dig" | "dive" };
  /** M: G-Max Chi Strike layers on it: +n critical-hit stage (PS/data/moves.ts:6795 condition onModifyCritRatio). */
  critBoost?: 1 | 2 | 3;
// types.ts MoveContext:
  /** P, generation 7 only: the priority the queue sorted at the turn's start (no re-sort), which the priority shields and
   *  Psychic Terrain read (move.priority, PS/sim/battle.ts:2641-2649). */
  frozenPriority?: number;
  /** C: two or three Helping Hands on the user this turn: one modifier round(4096 × 1.5^n) (9216, 13824) in place of the
   *  side's helpingHand flag (PS/data/moves.ts:8574 onRestart multiplier × 1.5). */
  helpingHands?: 2 | 3;

// doubles-world.ts MoveVolatiles (one writer each):
  hidden?: "fly" | "bounce" | "dig" | "dive" | "phantomforce" | "shadowforce";   // H (eot.hidden stays its end-of-turn view)
  lockOn?: DoublesSlotId;                                                      // H (carried only)
  uproar?: number;                                                             // C: turns left after this one
  chiStrike?: 1 | 2 | 3;                                                       // M
// MonState gains:
  bondUsed?: true;                                                             // K
  /** P: during one action, the followed user reached 0 HP in the hits (retaliation, Rowap, Innards Out), before its
   *  AfterMoveSecondarySelf (Life Orb); Sparkling Aria reads it. Cleared after the action. */
  faintedInHits?: true;
```

`validate()` / `carriedIssues()` add (as `{Name}: …`): `charging` whose move is not the slot's action (`"{Name} must use
{Move} this turn: it charged it last turn."`) or not in the game; `lockOn` at its own slot or an empty one; `bondUsed`
without Battle Bond on Greninja-Bond in SV; `uproar` whose action is not Uproar (`"{Name} must use Uproar this turn."`).
`discreteKey` takes every new field through `mons` (SPEC2 §1.3 "World growth"). The readers rule (SPEC2 §4.9) holds:
`faintedInHits` is written only with a Sparkling Aria user in the turn, `vol.hidden` only by a charge or a carried release,
`chiStrike` only in SwSh.

### 2.2 Step 0a additions: modules and hook calls

Six new hook modules (each imports the `TurnKernel` type only, may import the other hook modules' exports, never
`doubles-turn.ts`):

| File | Track | Step 0 contents (moved verbatim, or a stub reproducing today) |
|---|---|---|
| `doubles-hidden.ts` | H | `chargeHidden` (the guard at doubles-turn.ts:1884 moved); stubs `misses` (null), `missesStatus` (null), `missesField` (false), `land` (no-op), `release` (no-op), `carriedHidden` (none), `crash` (the worlds unchanged) |
| `doubles-reactions.ts` | K | moved: `afterKnockOut` (Battle Bond guard 2308), `koRetaliationAfter` (2310-2314), `allyFaint` (1228-1230), `cottonDown` (2231), `veil` = veilGuard (2275-2289), `unnerveRecoil` (2102-2113), `unnerveStand` = unnerveGuard + resistUnnerve (1530-1543), `volatileSecondary` = volatileGuard's four moves (2424-2435; Psychic Noise's branch is A2's, SPEC2 §3.5), `contactKO` (doubles-spread.ts, from 2472-2476), `spreadUser` (doubles-spread.ts, from 2533-2541); stub `stepEnv` ({}) |
| `doubles-pairs.ts` | P | moved: `focusBand` = focusBandGuard (2258-2264), `selfHitBand` (doubles-status.ts:411), `betweenHits` = berryBetweenHitsGuard (1729-1740), `allyShield` (1914-1920), `frozenPriority` (1813-1818), `assurance` (1510-1515), `ariaFaint` (1094-1099); stubs `stepEnv` ({}), `hurt` (no-op) |
| `doubles-faces.ts` | S | moved: `faceTaken`, `faceHit`, `faceProbe`, `neutralRow` (2593-2724), `multiHit` (rowReason's face branch 2250-2255), `selfHit` (doubles-status.ts:402-404) |
| `doubles-max.ts` | M | moved: `maxEffects` (2734-2751), `statusMove` (the Max Guard guard 808), `randomStatusGuard` (810-816) |
| `doubles-calls.ts` | C | moved: `presence` (doubles-status.ts:458-468 and doubles-turn.ts:801), `sleepTalk` (doubles-status.ts:762-767), `painSplitMax` (1789), `safeguard` (534-539), `helpingHand` (849-850); stubs `callMove` (unreached), `stepEnv` ({}) |

`doubles-substitute.ts` (no SPEC2 owner) becomes Track S's file as it is. The kernel's `TurnKernel` members that point at
moved code (`faceTaken`, `faceHit`, `focusBandGuard`, `unnerveGuard`, `maxEffects`) keep their names and delegate.

**Hook calls Step 0 inserts** (call site at `4008ee8`; SPEC2's moved code keeps its own hooks):

| Call site | Hook | Step 0 |
|---|---|---|
| `chargeTurn` (doubles-turn.ts:1882) first | `hidden.chargeHidden(k, w, action, move)` | today's guard |
| `hitChecks` (1561), each target first | `hidden.misses(k, w, action, info, slot)` → a `HitCheck` with `block: { by: "miss", hidden }` | null |
| doubles-status.ts `tryHit` (1209), each target first | `hidden.missesStatus(k, w, use, slot)` → a skip reason | null |
| the Perish Song handler (doubles-status.ts) and A3's Teatime (doubles-field.ts), per Pokémon | `hidden.missesField(k, w, slot, move)` | false |
| `damagingMove` (1855), after a resolution's step worlds | `hidden.crash(k, worlds, action, info, landedAny)` | worlds |
| SPEC2 A3 `fieldMove` (Gravity starting) and A2's grounding write (Smack Down, Thousand Arrows) | `hidden.land(k, w, slot)` | no-op |
| `carriedState` (861) | `hidden.carriedHidden(k, slot, carried)` → `vol.hidden`, `vol.lockOn` | none |
| `runMove` (1055) before the move | `hidden.release(k, w, action)` | no-op |
| `calcBuild` (444) | `takenMods.hidden` from the defender's `vol.hidden` | absent |
| `afterHit` (2308, 2310) | `reactions.afterKnockOut`, `reactions.koRetaliationAfter` | today's guards |
| `faint` (1228) | `reactions.allyFaint(k, w, slot)` | today's guard |
| `hitReactions` (2231) | `reactions.cottonDown(k, w, attacker, target, landed)` | today's guard |
| `applyStep` (2102, 2121) | `reactions.unnerveRecoil`, `reactions.veil` | today's guards |
| `singleStep` (1980), spreadStep's plans (2507), `faceHit` (2625) | `reactions.unnerveStand(k, w, attacker, target)` → stand-ins | today's guard |
| `afterHit` (2360) | `reactions.volatileSecondary(k, w, action, target, info, hitAny)` | today's guard |
| `searchFor` (568): the step's env and its memo key | `{ ...reactions.stepEnv, ...pairs.stepEnv, ...calls.stepEnv }(k, w, attacker, target, info, spread)` | {} |
| doubles-spread.ts spreadStep (SPEC2 D's file): its contact block and its end check | `reactions.contactKO`, `reactions.spreadUser(k, world, action, info, states)` | today's guards |
| the `focusBandGuard` sites; doubles-status.ts:411 | `pairs.focusBand`, `pairs.selfHitBand` | today's guards |
| `applyStep` (2019) | `pairs.betweenHits(k, w, action, target, entry)` | today's guard |
| `moveFailure` (1914) | `pairs.allyShield(k, w, action, move, target, priority)` | today's guard |
| `damagingMove` (1815) | `pairs.frozenPriority(k, world, action, priority, resolution)` | today's guard |
| `contextFor` (1510) | `pairs.assurance(k, w, action, target)` | today's guard |
| `sparklingAria` (1094) | `pairs.ariaFaint(k, w, action, user, hit)` | today's guard |
| `applyStep` (2127) | `pairs.hurt(k, next, action, outcome, info, follow)` | no-op |
| `rowReason` (2250), confusionHit (402) | `faces.multiHit`, `faces.selfHit` | today's texts |
| presenceGuards (808, 810-816) | `max.statusMove`, `max.randomStatusGuard` | today's guards |
| doubles-status.ts presenceGuards (458-468), statusMove (762-767), doubles-turn.ts:801 | `calls.presence`, `calls.sleepTalk` | today's guards |
| doubles-status.ts painSplit (1789), afterHit (534), earlyBranch (849) | `calls.painSplitMax`, `calls.safeguard`, `calls.helpingHand` | today's guards |
| `contextFor` (1520) | `helpingHands` from `user.helpingHand` when ≥ 2 | unreached |

`tests/source/status2-hooks.test.ts` (Step 0's) gains every row above.

### 2.3 Step 0b′: engine plumbing (the Step 0b builder's second commit; keyed on fields nothing sets)

| File | Change |
|---|---|
| `uses-to-ko.ts` | `UsesEnv` gains `focusBand`, `betweenHits`, `koRetaliation`, `veil`, `safeguard`, `spreadUser` (§2.4); `TurnStepOutcome` gains `stopAt?`, `reactions?`, `attackerFaintedInHits?`; `TurnStepPart` gains `fresh?` and `dealt?` (§2.5). All only in turn mode (`m.turn`): the 1v1 never reads them. |
| `hit-loop.ts` | `HitLoopInput.koRetaliation?: { aftermath: boolean; innardsOut: number }` (the HP the target had as the move started) and `TurnUnnerve.endsOnKO?: true`, read in `hitStep` on the knocking hit (`knocked`): Aftermath `trunc(attacker.baseMaxHP / 4)` on contact, Innards Out the given amount, both before the hit's Update; then that Update's Berry check with Unnerve gone. |
| `calculate.ts` | `takenMods.hidden` (the final ×2 for Fly, Dig, Dive's lists through SPEC2's `withTurnMarks` final chain; Bounce's power ×2 for Gust and Twister through `withPowerMods([8192])`); `critBoost` (added to the crit stage, certain at 3+ as `certainCrit` reads); `frozenPriority` (read by `usedPriority` for the shield and Psychic Terrain checks, generation 7 only); `helpingHands` (`withPowerMods([9216 \| 13824])`, `attackerSide.helpingHand` off); Q13's three retype paths (§3.29). |
| `engine-corrections.cjs` | the final-chain hook's `takenMods` entry for `hidden` (8192 for the listed moves). |
| `types.ts` | §2.1's fields. |

Step 0b′'s unit tests (`tests/unit/status2-plumbing-t2.test.ts`, new) reproduce the probes: T2-SI01 (Earthquake ×2 into Dig),
T2-SI03 (Gust ×2 into Fly), T2-SI05 (Bounce, power ×2), O1 / O1b (Focus Band 0.9/0.1, 0.99/0.01), T2-BE01 (the Ganlon stop
at hit 1), T2-AF01 / AF03 (Aftermath before the Sitrus and the recoil), T2-IO02 (Innards Out = the start HP), T2-UN03 (the
Sitrus before the recoil), T2-FV01 (Flower Veil keeps the drop off), T2-SE02 (two reactions reported in order), T2-Q01,
Q03, Q06, Q16 (the retype paths), T2-GW01-usum (frozen +1 blocked), T2-SP01 (a fresh continuation reads Multiscale).

### 2.4 The step's new environment (`UsesEnv`, turn mode only)

| Field | Set by (kernel hook) | The step does |
|---|---|---|
| `focusBand?: true` | P `stepEnv`: the target's working Focus Band (`itemWorks`) | each hit with damage ≥ HP after Endure, False Swipe, Sturdy and Focus Sash branches 9/10 knocked, 1/10 left at 1 HP (`SAVED`); the Band stays; every mode branches (the oracle enumerates it) |
| `betweenHits?: true` | P `stepEnv`: a move with more than one hit, the target's working Ganlon, Apicot or Starf Berry, or Lansat with Cheek Pouch, not stopped by Unnerve | the mass whose HP after a hit (not the last) is at or under the Berry's line at that hit's Update leaves the use there, an outcome with `stopAt` = that hit and no per-use effect of the user applied (Life Orb, recoil, Shell Bell, Throat Spray, self stages after the move); the target's per-hit effects of the hits so far are applied |
| `koRetaliation?` | K `stepEnv`: the target's Aftermath (contact; no Damp on the field that the user's Mold Breaker does not break: `PS/sim/battle.ts:365`) or Innards Out (its HP at the move's start) | hit-loop's knocking hit: the user's loss before the Update (Magic Guard none) |
| `veil?` | K `stepEnv`: the target's side's Flower Veil on a Grass target (`typesIn`, Tera) or Pastel Veil, unbroken by the user | the move's drops on the target are removed before boost(); its statuses (poison only, for Pastel Veil) fail |
| `safeguard?: true` | C `stepEnv`: the target's side has Safeguard; the user is a foe without Infiltrator | the move's statuses and confusion on the target fail |
| `spreadUser?: true` | K `stepEnv`: a spread step | the target's reactions on the user are not applied to the user's side; they are listed in `outcome.reactions` (§3.3) |

`searchFor`'s memo key takes the env. The readers rule: each field is set only when its holder is present, so every other
turn's keys and worlds are unchanged.

### 2.5 The continuation primitive

A use can be cut at a hit and finished by the kernel against a changed target. Two existing pieces and two new fields:

1. `turnStep` with `betweenHits` returns outcomes with `stopAt = h` (§2.4).
2. The kernel applies the change to the world (P: the Berry, §3.15; S: the face's form, §3.13), makes the search for the
   changed target build (`searchFor`, memoised), and calls `applyStep` with the existing `TurnStepPart { caseIndex, skip: h }`:
   the case's hits from `h` on are dealt to the target, and the user's per-use effects act once there (Life Orb; recoil
   and drain: no catalog multi-hit move has them, `tests/source/doubles-substitute-census.test.ts`). `TurnStepPart.dealt`
   (new) carries the damage the stopped part dealt, which the continuation adds to its Shell Bell total
   (`move.totalDamage`, `PS/data/items.ts` shellbell).
3. `TurnStepPart.fresh?: true` (new): the continuation's first hit reads the target as a first hit (no per-hit effect of
   the hits before it: needed behind a Substitute, §3.23). Each hit keeps its absolute index only for constant-power moves;
   with `fresh` and a move whose hits differ in power (Triple Axel, Triple Kick) the step reports `failed` with the
   `subPerHit` reason (the kernel asks only for constant-power moves).

---

## 3. The entries, one by one

Each entry: Showdown (verified, §1.1), the model on the engine as SPEC2 leaves it, randomness, end of turn and E2, Training
(public information only), facts (§4 lists every text), oracle cases (§5), tests, owner. "k" is the `TurnKernel`.

### 3.1 semi-invulnerable, and crash damage (Track H, `doubles-hidden.ts`)

**Showdown.** A charge of Fly, Bounce, Dig, Dive, Phantom Force or Shadow Force adds the move's volatile (duration 2) and
`twoturnmove`. Until the release's TryMove removes it (`onTryMove: if (attacker.removeVolatile(move.id)) return;`) or the
next turn's residual ends it, the holder is out of reach. The invulnerability step is step 0 of `trySpreadMoveHit`
(`PS/sim/battle-actions.ts:555, 621-641`), so it applies to every move that resolves Pokémon targets (`useMoveInner`
`:504`: not `all`, `foeSide`, `allySide`, `allyTeam`), status moves included, after redirection (T2-SI10) and before
TryHit (Protect, absorbers), the type immunity and accuracy. It passes: Helping Hand (`:622`); Toxic from a Poison type
(gen 8+ `:627`; gen 7 the toxic volatile, T2-SI08-usum); No Guard on either side (`PS/data/abilities.ts:2970`); Lock-On or
Mind Reader from the user at it (lockon volatile). Otherwise the hidden move's `onInvulnerability`: Fly and Bounce let
Gust, Twister, Sky Uppercut, Thunder, Hurricane, Smack Down, Thousand Arrows through; Dig lets Earthquake and Magnitude;
Dive lets Surf and Whirlpool; Phantom Force and Shadow Force none. Damage bonuses: Fly ×2 final for Gust and Twister,
Dig ×2 final for Earthquake and Magnitude, Dive ×2 final for Surf and Whirlpool (`onSourceModifyDamage`), Bounce ×2 base
power for Gust and Twister (`onSourceBasePower`). A missed target leaves the move's targets; the spread modifier stays
(`move.spreadHit` is set before the steps, T2-SI04); Dragon Darts' smart target turns off and both darts go to the other
target. Perish Song and Teatime check invulnerability themselves (T2-SI11b; `PS/data/moves.ts:13247, 19048`); other
field and side moves (Haze) reach it. Gravity starting (`:7755`) and Smack Down / Thousand Arrows' condition start
(`:16955`) remove Fly and Bounce, `cancelMove` the holder's queued action and remove `twoturnmove`. When every target of a
move failed in the hit steps, `MoveFail` runs (`:527`): High Jump Kick, Jump Kick, Axe Kick and Supercell Slam
(`hasCrashDamage`) take `trunc(baseMaxhp / 2)` from their user (`:8899` `onMoveFail`; Magic Guard none; no MoveFail with
no target at all, `:504-508`).

**Model.**
1. State: `vol.hidden` = the move, set by `chargeHidden` at a charge (replacing the guard; `eotHooks.charging` keeps
   `eot.hidden`) and by `carriedHidden` from `carried.charging` (the release turn, T2-SI12b). `vol.lockOn` from
   `carried.lockOn`.
2. `misses(k, w, action, info, slot)` (hitChecks, before Wide Guard): no miss when the target is not hidden, is the user,
   or when: the move as used (its own id; a Z-Move or Max Move is neither list's) is in the hidden kind's pass list; the
   user's Toxic and the user is Poison type (`typesIn`); No Guard in effect on the user or the target; the user's
   `vol.lockOn` is this Pokémon. Else `{ slot, block: { by: "miss", hidden } }`: blockedHit's fact `{Move} misses {Name}
   ({Hidden move}).`, no contact effect, `HitStats.blocked`. `missesStatus` is the same in `tryHit` (Helping Hand passes;
   Toxic from a Poison type passes), for every target type that resolves Pokémon; `missesField` for Perish Song and A3's
   Teatime (a missed Pokémon gets neither).
3. Bonuses: calcBuild's `takenMods.hidden` (Fly, Bounce, Dig, Dive); calculate.ts applies them only for the listed moves
   (Step 0b′).
4. Spread: unchanged (`multiple` counts the hidden target as in place). Dragon Darts: dartsStep's `lands` is false for a
   miss, so both darts go to the other target (its existing one-target path).
5. Landing: `land(k, w, slot)` from Gravity's start (A3's fieldMove) and the grounding write of Smack Down and Thousand
   Arrows (A2): `vol.hidden` and `eot.hidden` cleared, its queued release this turn removed from `w.remaining` (step fact on
   that action: `{Name} falls to the ground ({Gravity}): {Move} is cancelled.`), E2 without `charging`.
6. Release: `release(k, w, action)` at runMove for a carried charge: no charge (SPEC2 A1's `charging` read generalised:
   `chargesThisTurn` false when `carried.charging === move.id`), `vol.hidden` removed at its TryMove. A release stopped in
   BeforeMove (sleep, freeze, paralysis, confusion, Attract) keeps it hidden to the end of the turn (T2-SI12b); E ends it at
   the residual (the volatile's duration; no HP).
7. Crash (fix IN-CRASH): `crash(k, worlds, action, info, landedAny)` after a damaging move's resolution with targets: for
   a crash move used as itself (`ownMoveId`; generated `CRASH_MOVES` from the dex's `hasCrashDamage`), in each world where
   no target got past the hit steps (every HitCheck blocked: a miss, protection, Wide Guard, Quick Guard, Mat Block,
   Telepathy, an absorber; or the row had no effect: a type or ability immunity), `afterLoss(k, w, user, trunc(baseMaxHP /
   2))` unless Magic Guard: loss fact `{Name} loses {n} HP ({Move}).`, `hurt`, a faint, its Berry at the action's Update;
   Emergency Exit and Wimp Out read it (the MoveFail path, `:528-531`: the switch family).

**Randomness:** none. **End of turn:** `eot.hidden` as today; a carried release that did not happen stays hidden through
the residuals. **E2:** `charging` (this turn's charge) with volatiles `twoturnmove` and the move; none after a release or
a landing. **Training:** the bridge maps `twoturnmove` with its move (`-prepare`: tracker `mon.charging`, public) to
`carried.charging`, `lockon` (`-activate … move: Lock-On|[of]`) to `carried.lockOn`; the rollouts `{Name}: fly is not
modelled.`, `twoturnmove`, `lockon` go; `postFromOutcome` writes `charging` back as the two volatiles. **Calculator:** a
`Charged last turn` toggle (U, §6) for a Pokémon whose move is a two-turn move (Geomancy shares it, SPEC2 A1); off keeps
today's charge, with the turn fact generalised from SPEC2's Geomancy one: `Assumes {Name} did not charge {Move} last
turn.`.

**Cases:** T2M-SI-01…14, IN-CR-01…06 (§5). **Tests:** `tests/unit/doubles-hidden.test.ts`: each pass list per kind, Toxic
per generation, No Guard either side, Lock-On, Helping Hand, the spread modifier kept, Dragon Darts to the other target,
Perish Song and Teatime, landing and its cancel, a stopped release, crash only with targets and only past no hit step.

### 3.2 volatile-secondaries (Track K, `doubles-reactions.ts`; fixes IN-BJ, IN-ST, IN-CE)

**Showdown.** Burning Jealousy's 100% secondary burns a target with `statsRaisedThisTurn` (`PS/data/moves.ts:2071`);
Alluring Voice's confuses one (`:282`; a sound move: it passes Substitutes); Spectral Thief's `stealsBoosts`
(`PS/sim/battle-actions.ts:781-806`, step 6, after accuracy and before the hits) boosts its user with every positive stage
of the target (accuracy and evasion too) through `boost(boosts, pokemon, pokemon)` and sets the target's to 0 (no event);
Core Enforcer's onHit and onAfterSubDamage add `gastroacid` to a target that is not `cantsuppress` and has moved
(`:2874`; T2-VS04).

**Model** (`volatileSecondary`, replacing the guard; each only where the move is used as itself):
- Burning Jealousy: after each target's step, for a target the hit reached (`landed > 0`) with `statsRaised` and
  `secondaryLands` (Sheer Force, Shield Dust, Covert Cloak): `giveStatus(brn, user)` (canStatus: Fire, Water Veil, Water
  Bubble, Thermal Exchange, Comatose, Leaf Guard in sun, a side's Flower Veil, Safeguard against a foe, grounded on Misty
  Terrain, a status already); a Lum or Rawst Berry at the hit's Update (giveStatus's existing cure). Spread: in target
  order after the hits (T2-SE02 order).
- Alluring Voice: the same gate; the confusion path the kernel has for Dynamic Punch (`statusHooks.afterHit`
  CONFUSING_MOVES: Own Tempo, Misty Terrain, Safeguard, already confused; Persim and Lum).
- Spectral Thief: `stealBoosts(k, w, action, info, target)` in singleStep before the target's calculation, when the hit
  passes its checks (not blocked, not immune: a Normal-type target is immune and nothing is stolen) and the target has a
  positive stage: A1's `applyBoosts(user, stolen, { source: user, effect: "move" })` (Contrary, Simple, the cap; D's ledger
  records the rises, so the target side's Opportunist and Mirror Herb copy them at AfterMove), then A1's `writeStages`
  sets the target's positive stages to 0 (no event: no Eject Pack, no `statsLowered`). The calculation then reads the new
  stages (the engine's own Spectral Thief branch, `gen789.js:411`, finds nothing left to steal).
- Core Enforcer: for each target hit (`landed > 0`, or a Substitute hit: `hitAny`) that has moved (no living action of it
  left) and is not `cantsuppress`: A1's Gastro Acid path (`vol.gastroAcid`, GAS_STAND_IN, the old ability's End from A1's
  table; Neutralizing Gas ending keeps `gasEnds`, Q5).

**End of turn:** the burn, the confusion (none at the residual), the suppressed ability (no Poison Heal, Speed Boost…)
are read by E as world state. This closes IN-BJ (T2A-VS1) and IN-CE (Core Enforcer last). **E2:** the status, `confusion`,
the stages (closes IN-ST, T2A-VS3), `gastroacid`. **Training (Champions):** Burning Jealousy and Alluring Voice cells reach
the engine. **Cases:** T2M-VS-01…06, IN-BJ-01/02, IN-ST-01, IN-CE-01. **Tests:** each gate (`statsRaised`, secondaryLands,
moved), Spectral Thief's order (steal, then the hit) and its ledger entry.

### 3.3 spread-effect (Track K)

**Showdown.** A spread move computes every target's damage first, then each target's secondaries, then each target's
DamagingHit in target order (T2-SE02); the user's state after the move is the pre-move state with each target's reaction
applied in that order, through boost() each time (T2-SE03: at −6 Speed both Gooey drops fail and Defiant does not rise;
composing the per-target end states would give +4).

**Model.** In a spread step (`spread` true) the step runs with `UsesEnv.spreadUser`: the target's reactions on the user
are not applied to the user's side but listed in `outcome.reactions`, in that target's DamagingHit order:
- `boost` (Gooey and Tangling Hair on contact, Cotton Down: Spe −1, source the target);
- `status` (Spicy Spray: burn, source the target);
- `ability` (Mummy and Lingering Aroma on contact; Wandering Spirit's swap);
- `perish` (Perish Body on contact: both get 3);
- `item` (Pickpocket takes the user's item when it holds none; a contact Sticky Barb moves to an itemless user).
Rough Skin, Iron Barbs, Rocky Helmet, Jaboca and Rowap stay today's summed `retaliation()`. With them out, every target's
step leaves the user in one state (the existing equality check stays as an assertion). `spreadUser(k, world, action,
info, states)` then replays the reactions of the targets, in spreadTargets order, on the user through the kernel's own
functions: A1's applyBoosts (source the target, effect its ability: Defiant and Competitive (foes), Mirror Armor
reflecting to that target, Clear Body and kin, Mist, White Herb once at the Update after the hits (T2-SE04), D's ledger),
giveStatus (the first burn lands, a second fails), A1's setAbility (the first contact Mummy; a later one sees Mummy),
E's perish state, A3's give / take. Then the retaliation HP, Mind Blown's cost and Life Orb as today.

**Kept:** `spreadEffect(move, name)` only where the darts of Dragon Darts both land (dartsStep → spreadStep) and a dart's
target reacts on a user whose next dart reads it (a Cotton Down target and a Defiant or Competitive user): the second
dart's damage reads the first's reaction, which a spread step does not have. No catalog Dragon Darts user has either
ability (Dragapult: Clear Body, Infiltrator, Cursed Body), so only an ability change reaches it.

**Cases:** T2M-SE-01…05. **Tests:** every attacker-side change in uses-to-ko's afterHit is either a listed reaction or the
same for every target (`tests/source/doubles-spread-reactions.test.ts`, new, owned by K); the replay order; the cap case.

### 3.4 spread-contact-ko (Track K)

**Showdown.** Every target's TryHit runs first (`PS/sim/battle-actions.ts:550-577`); Spiky Shield's 1/8 on contact (and
King's Shield, Obstruct, Silk Trap, Baneful Bunker, Burning Bulwark effects) comes before any hit; a user it knocks out
still hits the rest (`hitStepMoveHitLoop` reads no user HP; T2-SCK01) and faints in the batch after the hits; on a 0-HP
user Life Orb, recoil and Moxie (`boost` needs HP) do nothing.

**Model.** `contactKO` replaces the guard: the rest's plans run as today from the pre-move world; the protection's loss
joins `prior` as today (no Update before the hits); in the worlds where the user's HP is at or under `prior` (it is at 0
before the hits), `koBoost` is skipped and afterLoss's first group faints it (Life Orb's group then has no effect). The
Z-Move / Max Move case through a damage protection with the user's HP followed (`protectContact(…, followed)`): the loss
is applied to the user's HP before the step (`mapHP`, no Berry: there is no Update before the hit), and the step follows
from there; a user that enters the step at 0 HP lands its first hit and no more (`hitStepMoveHitLoop:971`), which the
step's followed-faint rule gives (checked by T2M-SCK-02).

**Cases:** T2M-SCK-01, 02. **Tests:** the rest hit, the faint order (the targets, then the user), no Moxie, the followed Z case.

### 3.5 ally-effect (Track P, `doubles-pairs.ts`)

**Showdown.** Queenly Majesty, Dazzling and Armor Tail stop only a foe's priority move (`onFoeTryMove`); Psychic Terrain
only a foe's (`onTryHit`: `target.isAlly(source)` returns) (guards-probes-3 R1: Quick Attack into its own Armor Tail
ally on Psychic Terrain hits). The engine's calculation blocks from any side.

**Model.** `allyShield` replaces the guard: a priority move into the user's own ally proceeds; its calculation runs with
`conditions.allyTarget` (Step 0b′, calculate.ts): the shield abilities' and Psychic Terrain's priority blocks are skipped
(the terrain's power boost and everything else kept), so no stand-in changes the target's build. **Cases:** T2M-ALE-01,
02. **Tests:** the flag reaches only the two blocks.

### 3.6 unnerve-resist (Track K)

**Showdown.** Unnerve and As One stop the Berries of their holder's foes that are in (`PS/data/abilities.ts:5258`
`onFoeTryEatItem`): a third Pokémon's stops a resist Berry (T2-UN01: 116 vs 58); the user's own does not stop its ally's
(T2-UN02). The engine's calculation stops a resist Berry for the attacker's own Unnerve only.

**Model.** `unnerveStand` replaces the guard with stand-ins for that calculation (the `behindSubstitute` pattern): a
third Pokémon's Unnerve stopping the target's working resist Berry → the target's item reads `leftovers` (Knock Off's 1.5×
and Poltergeist still see an item), put back after the step (the Berry stays held, uneaten); the user's Unnerve or As One
hitting its own ally → the user's ability reads `GAS_STAND_IN` for that calculation (As One's KO boost is the kernel's
`koBoost`, read from the real build). Also at faceHit's Chilan Berry. **Cases:** T2M-UN-01, 02.

### 3.7 unnerve-recoil (Track K; hit-loop `endsOnKO`)

**Showdown.** The Update after the hit that knocks out an Unnerve holder runs with the Unnerve gone, before recoil
(`applyRecoilDamage` after the loop) and before Steel Beam's cost: the user's Sitrus at 73 → 114, then recoil (T2-UN03).

**Model.** `unnerveRecoil` replaces the guard; K's `stepEnv` sets `unnerve.endsOnKO` when the target is a foe Unnerve or
As One holder whose Unnerve is the only one stopping the user's Berry (no third holder) and the step follows the user;
hit-loop's knocking hit then checks the user's Berry with Unnerve gone at that hit's Update. **Cases:** T2M-UNR-01, 02.

### 3.8 cotton-down (Track K; SwSh)

**Showdown.** Each damaging hit on the holder (DamagingHit, the knocking one too) lowers by 1 the Speed of every other
active Pokémon, in `getAllActive` order (side, then position), skipping fainted ones, with `boost(…, pokemon, target,
null, true)`: source the holder, effect Cotton Down (T2-CD01, CD02: per hit, Mirror Armor reflecting to the holder, an ally
of the user with Defiant rising).

**Model.** `cottonDown(k, w, attacker, target, landed)` replaces the guard: for each of the `landed` hits, for each other
active Pokémon in Showdown position order but the user (the user's own drop is the step's: `HIT_ABILITIES.cottondown`,
or a spread step's reaction, §3.3), A1's applyBoosts({spe: −1}, source holder, effect ability): Clear Body and kin,
Mirror Armor (to the holder), Mist (any source but itself: blocks), Defiant and Competitive (a foe of the holder), White
Herb at the Update, Eject Pack's `fell` (AfterMove), the ledger. Behind a Substitute no hit lands: none. **Kept:** none
(the Dragon Darts case is §3.3's). **Cases:** T2M-CD-01, 02 (SwSh only).

### 3.9 flower-pastel-veil (Track K)

**Showdown.** Flower Veil keeps a drop off a Grass-type Pokémon on its side from any source but that Pokémon
(`onAllyTryBoost`) and its statuses (`onAllySetStatus`, not Yawn); Pastel Veil its side's poison (`onAllySetStatus`,
`onSetStatus`); both breakable (T2-FV01, FV02: Snarl's drop kept off Venusaur, not off Fairy Comfey; Mold Breaker passes).

**Model.** `veil` (the moved veilGuard) is removed; K's `stepEnv` sets `UsesEnv.veil` for the target from its side's
living Flower Veil holder (the target Grass by `typesIn`, its Tera type when Terastallized) or Pastel Veil holder, unless
the user breaks it (`breaks`: Mold Breaker family, an ignoreAbility move; an Ability Shield on the holder keeps it); the
step then removes the drops before boost() (no Defiant, Competitive, Mirror Armor, `fell`) and fails the statuses. The
kernel-given ones (status moves, Max effects, giveStatus, foeDrop) already pass canStatus and applyBoosts with the veils.
SwSh's Pastel Veil step part has no catalog move today but one under Serene Grace (a 50% poison move): unit-tested on a
synthetic build. **Cases:** T2M-FV-01, 02.

### 3.10 battle-bond (Track K; SV and USUM; not usable in Champions, §1.3)

**Showdown.** On a move's knockout (`onSourceAfterFaint`, effect a Move), a Greninja-Bond (not transformed) still in,
whose foe side has a Pokémon left (`foePokemonLeft`, counted after the faint) and not `bondTriggered`: gen 9 +1 Atk, SpA,
Spe through `boost()` (T2-BB01); gen 7 `formeChange` to Greninja-Ash (T2-BB02; its Water Shuriken then 3 hits of 20: the
engine by species).

**Model.** `afterKnockOut(k, w, action, attacker, outcome, info)` replaces the guard, after the move's faint batch (with
`koBoost`): SV: A1's applyBoosts({atk: 1, spa: 1, spe: 1}, source self, effect Battle Bond) (Contrary, Simple, the cap; D's
ledger: the foes' Opportunist and Mirror Herb); USUM: `withSpecies(build, "greninjaash")` (HP base equal: maximum HP
unchanged); both set `MonState.bondUsed`. Not when `bondUsed` (carried or this turn), the user fainted, or the foes have
nothing left (no living foe in place and `canSwitch[foe] === false`; with `canSwitch` absent the existing fact assumes one
is left). A spread knockout of two is one batch: one boost. **Facts:** hit fact `Battle Bond: {Name} gets +1 Attack, +1 Sp.
Atk and +1 Speed.` / `Battle Bond: {Name} becomes Greninja-Ash.`; turn fact (SV, a Greninja-Bond that can knock out with
no `carried.bondUsed`): `Assumes {Name} has not had Battle Bond act before in this battle.` (Q12's pattern).
**E2:** `bondUsed`, the USUM species. **Cases:** T2M-BB-01…03.

### 3.11 aftermath-innardsout (Track K; hit-loop `koRetaliation`)

**Showdown.** In the knocking hit's DamagingHit (`onDamagingHitOrder` 1), before that hit's Update and before recoil and
Life Orb: Aftermath, on contact (Protective Pads none), `trunc(source.baseMaxhp / 4)` (T2-AF01: 45 of 183, then the
user's Sitrus; T2-AF03: before recoil), stopped by any active Damp (`onAnyDamage`, breakable: the user's Mold Breaker
passes it); Innards Out the HP the holder had as the move started (`damage + move.totalDamage`: T2-IO01, IO02 two hits,
IO03 spread), undynamaxed (`getUndynamaxedHP`). Magic Guard takes neither.

**Model.** K's `stepEnv` sets `koRetaliation` for the target (Aftermath in effect with a contact move and no unbroken
Damp; Innards Out in effect), which also makes the search follow the user (the loss depends on the target's HP); hit-loop
applies the loss on the knocking hit before its Update (Step 0b′). In spread steps (not followed) `koRetaliationAfter`
adds each knocked-out target's loss, in target order, to the user's first loss group (the Update after the hits), with
Innards Out per joint entry (`mapJoint` over the user and that target's pre-move HP). The guard goes; selfFaintFact's
sources gain Aftermath and Innards Out (§3.18's shared list). **Cases:** T2M-AF-01…03, T2M-IO-01…03.

### 3.12 receiver-alchemy (Track K)

**Showdown.** As a Pokémon faints (`onAllyFaint`, in the faint batch, in queue order), its partner with Receiver or Power
of Alchemy and HP takes its ability unless the ability has `noreceiver` or is No Ability: `setAbility(ability, target)`:
the SetAbility event (an Ability Shield on the receiver keeps its own), the old End, the new Start (T2-RC01: Intimidate
acts at once; T2-RC02: Levitate, then a later Earthquake misses).

**Model.** `allyFaint(k, w, slot)` replaces the guard: A1's `setAbility(partner, ability, { source: slot })` with A1's
generated per-game table (it gains the `noreceiver` flag); the Start through A1's Start table (its `abilityStart` reason
stays for a Start it does not follow; Q12's once-a-battle fact for Intrepid Sword and kin). From E's faints too (a
residual knockout's copy happens at the end of turn). **Fact:** card condition `Ability: {Ability}.` (SPEC2 §5.1) and
hit fact `Receiver: {Name} gets {Ability}.` / `Power of Alchemy: …`. **E2:** the build's ability, `abilityChanged`.
**Cases:** T2M-RC-01, 02.

### 3.13 face-guards (Track S, `doubles-faces.ts`)

**Showdown.** An intact Disguise (Mimikyu, any Move effect) or Ice Face (Eiscue, a physical move) takes the hit's damage
as 0 (`onDamage`); DamagingHit, the hit's effects and AfterMoveSecondary run with 0 damage (T2-FA04–FA12); at the Update
after that hit the form busts (Disguise: +`trunc(baseMaxhp/8)` chip from gen 8, none in gen 7; Ice Face: Noice and its
stats), and a multi-hit move's later hits go into the busted form (T2-FA01, FA02; Parental Bond's second strike, FA03).

**Model.**
1. Multi-hit and Parental Bond (`multiHit`, replacing `faceMultiHit`): hit 1 through `faceHit` (the existing 0-damage hit,
   the chip and its Berry at that Update), then the continuation (§2.5) `TurnStepPart { caseIndex, skip: 1 }` on the
   busted form's search (faceProbe's), from the HP after the chip: hits 2…n into the busted form, the user's per-use
   effects once there (Life Orb counts the face's hit as a hit), every hit in `timesAttacked`. Into a Substitute first
   (doubles-substitute.ts): the Substitute's prefix, then a face hit for the first continuation hit, then this
   continuation (S owns both files).
2. The 0-damage hit's item reactions (FACE_REACTIVE_ITEMS' guard goes), as kernel rules in Showdown's order:
   DamagingHit: Rocky Helmet (contact: `trunc(user.baseMaxHP / 6)` to the user, Magic Guard none: a loss), Air Balloon
   (pops; Unburden), Jaboca / Rowap (its category: eaten, `trunc(baseMaxHP / 8)`, Ripen `/4`), Sticky Barb (contact,
   itemless user, no unbroken Sticky Hold: moves), Cell Battery, Absorb Bulb, Luminous Moss, Snowball (their type: used,
   +1 through applyBoosts); AfterMoveSecondary: Kee / Maranga (category: eaten, +1, Ripen +2), Eject Button and Red Card
   (the switch family: with a later action `switchesOut` as for any hit, until wave 2 R).
3. The move's own effects on its 0-damage hit (FACE_UNSAFE_MOVES' guard goes): faceHit runs the kernel's `afterHit`
   pipeline for the target with the outcome `{ landed: 1, knocked: false, subHits: 0, target: the busted side }`, so every
   on-hit effect the kernel models acts (flinch, Throat Chop, Clear Smog, Salt Cure, the traps, Smack Down's grounding,
   Psychic Noise, §3.2's four, the hazard moves, U-turn and the drags through the switch family, Final Gambit's faint,
   Sparkling Aria's cure); the step-side item moves become kernel rules: Knock Off (removes a removable item unless an
   unbroken Sticky Hold), Thief and Covet (an itemless user takes it: `itemTakeable` with thief), Bug Bite and Pluck (the
   user eats the Berry: hit-loop `stolenEat`), Incinerate (a Berry or Gem burned); Smelling Salts and Wake-Up Slap cure
   the target's paralysis or sleep; Magician (an itemless user takes it after the move, T2-FA12).
**Kept:** none face-specific. **Facts:** existing `{Disguise}: {Name} takes no damage.`; §4's item lines. **Cases:**
T2M-FA-01…12. **Tests:** the continuation's skip and HP, each item rule, the afterHit pipeline on a 0-damage outcome.

### 3.14 focus-band (Track P)

**Showdown.** `onDamage` priority −40: `randomChance(1, 10) && damage >= target.hp && effect.effectType === 'Move'` →
`target.hp − 1`; not used up (each knocking hit: guards-probes-3 O1 0.9/0.1, O1b two hits 0.99/0.01); a confusion
self-hit is an effect of type Move (T2-FB01: 1/10). Endure (−10), Sturdy and Focus Sash at full HP come first.

**Model.** `focusBand` (the moved guard) is removed; P's `stepEnv` sets `UsesEnv.focusBand` (§2.4). `selfHitBand` in
confusionHit: for each self-hit value with damage ≥ HP (after Endure, Sturdy, Sash), 9/10 faints, 1/10 at 1 HP (one world
each, the Berry at the Update). **Fact:** hit fact / loss fact `Focus Band: {Name} keeps 1 HP.` with its chance.
**Cases:** T2M-FB-01…03.

### 3.15 berry-between-hits (Track P; the continuation primitive)

**Showdown.** The Update after each hit (`PS/sim/battle-actions.ts:967`) eats a target's pinch Berry at its line; a Ganlon
(+1 Def), Apicot (+1 SpD) or Starf (+2 to one of five random stats below +6) then changes the later hits (T2-BE01: 37 vs
55; T2-BE02: a Def +2 world survives at 27 in 1/5); Lansat with Cheek Pouch heals the holder there.

**Model.** `betweenHits` (the moved guard) is removed; P's `stepEnv` sets `UsesEnv.betweenHits` (§2.4); for each stopped
outcome (`stopAt = h`) the kernel eats the Berry with `ateBerry` (Unburden, Ripen ×2, Contrary, Simple through A1's
applyBoosts with effect the item, D's ledger, Cheek Pouch; Starf one world per raisable stat, 1/n), then the continuation
`TurnStepPart { caseIndex, skip: h, dealt }` on the search for the new target build (memoised; at most five Starf
searches). Unnerve or As One stopping the Berry: no `betweenHits` (today's step reads it held). **Fact:** hit fact
`{Name} eats its {Berry} after hit {h}: {+1 Defense}.` with its chance. **Cases:** T2M-BE-01…04; the stored VE-F1-10 and
VE-F1-13 are re-run (`changed-cases.ts`).

### 3.16 aria-faint (Track P)

**Showdown.** Sparkling Aria's onAfterMove cures unless `source.fainted` (`PS/data/moves.ts:17358`): a user knocked out in
the hits (Rowap, Innards Out, Destiny Bond: faintMessages runs in the hit loop) has fainted; one Life Orb knocks out after
them (AfterMoveSecondarySelf) has not (T2-AR01 cures, T2-AR02 does not).

**Model.** `ariaFaint` replaces the guard with `MonState.faintedInHits`: set by spreadStep when the user's first loss
group (the retaliation, Spiky Shield's `prior`, §3.11's knockout losses) takes it to 0, by applyStep from the step's
`attackerFaintedInHits` for a followed single target, and by `onKnockOut` (Destiny Bond). sparklingAria: a fainted user
without `faintedInHits` cures as a living one does; with it, none. Written only with a Sparkling Aria user in the turn.
**Cases:** T2M-AR-01, 02; the stored VE-H5-6 re-run.

### 3.17 gale-wings-gen7 (Track P; USUM)

**Showdown.** Generation 7 sorts the queue once (no re-sort, `PS/sim/battle.ts:2919` needs gen 8): a Gale Wings move sorted
at +1 keeps `move.priority` +1 though its user lost HP before it moved, so Dazzling stops it (T2-GW01-usum; SV re-sorts to
0 and it hits, T2-GW01-sv), and the reverse for a user healed to full before it moves.

**Model.** `frozenPriority` replaces the guard: contextFor sets `MoveContext.frozenPriority` (the frozen priority without its
fractional part) when it differs from `priorityOf` now; calculate.ts's `usedPriority` reads it for the partner-shield and
Psychic Terrain checks; the kernel's own `priorityShield` already reads the frozen value. **Cases:** T2M-GW-01, 02 (USUM).

### 3.18 assurance-own-hp (Track P)

**Showdown.** Assurance doubles when `target.hurtThisTurn` (any damage, `PS/data/moves.ts:643`): the target's own recoil
counts (T2-AS01: 61 vs 31), as do Life Orb, contact retaliation, Liquid Ooze and a self-cost.

**Model.** `hurt` (applyStep) sets `user.hurt` in every child of a followed step in which a hit landed and an own-loss
source applies, from one shared list `ownLossSources(k, w, action, info, targets)` (P's export; selfFaintFact calls it too):
recoil (not Rock Head, Magic Guard), Life Orb (working, not Sheer Force with secondaries, not Magic Guard), contact
Rough Skin / Iron Barbs / Rocky Helmet, Jaboca / Rowap by category, Liquid Ooze on a drain, Steel Beam / Mind Blown /
Chloroblast, a protection's contact damage through it, §3.11's Aftermath and Innards Out, Gulp Missile. Each source deals
damage exactly when its condition holds once a hit landed (none reads HP), so `hurt` is exact per world and `ownHP` no
longer gates Assurance; `assurance` (the moved guard) is removed. **Cases:** T2M-AS-01, 02.

### 3.19 gmax-effects and Max Guard (Track M, `doubles-max.ts`; SwSh)

**Showdown** (T2-GM01–09; `PS/data/moves.ts` gmax* `self.onHit`, they act through a Substitute as Max Moves' do, T2-SB01):
Smite and Gold Rush confuse every foe; Cuddle infatuates every opposite-gender foe; Chi Strike gives the user's side the
`gmaxchistrike` volatile (+1 crit stage per layer, at most 3); Replenish, unless one `randomChance(1, 2)` for the whole
move succeeds (then nothing), restores the Berry (`lastItem`, then cleared) of each Pokémon of the user's side holding
nothing (`PS/data/moves.ts:7095`); Finale heals the user's side `trunc(maxhp / 6)`; Befuddle gives each foe
slp, par or psn (1/3 each, then trySetStatus); Stun Shock par or psn (1/2 each). A Dynamaxed Pokémon's status move is Max
Guard (`:11157`: priority 4, a stalling move, blocks every move but its pass list (Acupressure, After You, Ally Switch,
Aromatherapy, Aromatic Mist, Coaching, Confide, Copycat, Curse, Decorate, Doom Desire, Feint, Future Sight, G-Max One
Blow, G-Max Rapid Flow, Heal Bell, Hold Hands, Howl, Jungle Healing, Life Dew, Mean Look, Perish Song, Play Nice, Power
Trick, Roar, Role Play, Tearful Look) and Max Moves included).

**Model** (maxEffects, moved): the `guard` rows of GMAX_EFFECTS go; Smite and Gold Rush through the kernel's confusion
path per foe; Cuddle through A2's Attract state (its gender rules and `needsGender`); Chi Strike `vol.chiStrike` +1 (max 3)
on the user and its living ally, which calcBuild turns into `critBoost` (certain at 3+: the turn's hit rule fact then
names it); Replenish one 1/2 world split: in one world nothing, in the other every eligible Pokémon gets D's `lastItem` Berry back
(`lastItem` cleared; absent history with nothing held: `needsLastItem("G-Max Replenish", name)`, SPEC2's text), then its
Update; Finale's heal through the kernel's heal
(Heal Block none); Befuddle and Stun Shock one world per foe status (≤ 9 worlds) through giveStatus. `randomStatusGuard`
goes. `statusMove`: the Max Guard guard goes; the action runs as Max Guard: earlyBranch's protect path with the kind
`maxguard` (PROTECT_MOVES gains it; its pass list as a generated set `MAX_GUARD_PASS`; Max Moves blocked; no contact
effect; fails with no action left; the stall fact). **E2:** `chiStrike`, the statuses, `confusion`, `attract`, items.
**Cases:** T2M-GM-01…08 (SwSh).

### 3.20 darts-aim-self: kept

Aimed at the ally's position after that ally's Ally Switch, Dragon Darts' smart targeting starts from its user's own
position: its first dart hits its user, the second its ally (status-eot A2, `addendum-probes-1.out:135-152`). The pairwise
step has no calculation whose attacker is its target, and no other damaging move in the turn hits its own user, so the
model would be a new pairwise path for a choice no player makes on purpose (aiming the darts at one's own ally while that
ally uses Ally Switch). Text unchanged: `Dragon Darts aimed where its user now stands is not modelled in 2v2.`

### 3.21 received-item: Seeds and Room Service modelled (A3 addition); Booster Energy kept

**Showdown.** `setItem` runs the received item's Start: a Seed in its terrain and Room Service under Trick Room are used at
once (status-eot T10c: a Klutz giver's Electric Seed gives the receiver +1 Def before the `-item` line). A giver that can
use the item has used it already (T2-RI01, RI02), so only a giver that cannot (Klutz, Embargo) passes one on.

**Model** (A3's `receive`, its own file): the received Seed in its terrain: +1 Def (Electric, Grassy) or +1 SpD (Misty,
Psychic) through A1's applyBoosts (effect the item; Contrary, Simple), the item used (D's `noteItemUse`: `lastItem`,
Symbiosis), Unburden; Room Service under Trick Room: Spe −1 the same way. Kept: Booster Energy (`received`): Trick with a
Paradox Pokémon on either end fails (T2-RI03), so a holder of Protosynthesis or Quark Drive that can receive it exists
only after an ability change in battle (Trace, Skill Swap, Role Play, Receiver, Doodle); its activation is the paradox
boost's own settle (the field-change entry's machinery). **Cases:** T2M-RI-01, 02.

### 3.22 into-substitute (Track S)

**Model** (narrowGuards' rows go, each as its Showdown rule):
- Max Moves: the hit meets the Substitute; `maxEffects` runs on `hitAny` (a Substitute hit counts): the user's side
  boosts, every foe's drop (the Substitute holder's too), weather and terrain, the G-Max effects (T2-SB01–03).
- Signature Z-Moves with an effect of their own (Z_MOVE_EFFECTS): per its handler: a `self` or `onAfterSubDamage` effect
  acts through the Substitute (Splintered Stormshards ends the terrain, T2-SB05); a secondary's `self` does not (Genesis
  Supernova's terrain is a `secondary.self`: no Psychic Terrain behind a Substitute, case T2M-SB-02b); Clangorous
  Soulblaze is a sound move (passes, T2-SB04).
- Mind Blown (SwSh, USUM): the user pays `round(maxhp / 2)` at each hit into a Substitute (the Substitute's
  `applyRecoilDamage` with `mindBlownRecoil`), in target order before the others' damage, and its own cost after the move
  (status-eot U17: 64, then 0, then the others hit); Life Orb and the rest as spreadStep.
- Magician: an itemless user takes the item of the Pokémon behind the Substitute after the move (status-eot U15).
- Parental Bond: both strikes walk the Substitute's prefix with their own values; Power-Up Punch's self boost per strike
  (T2-SB06, 06b: +2) — the step's per-strike self effects are per hit already; the oracle case decides (T2M-SB-05).
**Kept:** `intoSubstitute(move)` for a multi-hit move with recoil, drain or a self-cost: no catalog move has one
(`doubles-substitute-census.test.ts` asserts it); the reason stays as a defensive one. **Cases:** T2M-SB-01…05.

### 3.23 sub-per-hit (Track S; the continuation primitive with `fresh`)

**Showdown.** Behind a Substitute no DamagingHit fires: the Pokémon stays at full HP, keeps its Berry and ability, gets no
Stamina or Weak Armor stage; the hits into the Substitute and the first hit after it breaks read it as a first hit
(T2-SP01: Multiscale halves hit 2 too, the Substitute breaks only then and the Pokémon takes nothing).

**Model.** perHitGuard's rows go for constant-power multi-hit moves: the prefix (`subPrefix`) uses the first hit's values
of the behind-Substitute search for every hit into it (`hits[k] := hits[0]`), and the continuation after the break is
`TurnStepPart { caseIndex, skip: j, fresh: true }` against the real build (the resist Berry real again: its first hit
eats it; Multiscale at full HP; the Mummy family on contact from then on). **Kept:** `subPerHit(move, name, effect)` for
Triple Axel and Triple Kick (a hit's power depends on its index, so a frozen hit k needs a first-hit calculation at that
power, which no run gives) and for Parental Bond (its ×0.25 strike against a frozen holder) in front of a per-hit effect.
**Cases:** T2M-SP-01…03; the stored E40-IcicleSpear-Multiscale, -Stamina, -YacheBerry and E40-DualWingbeat-Mummy-swsh are
re-run.

### 3.24 pain-split-dynamax (Track C; SwSh)

**Showdown** (`PS/data/moves.ts:13129`, `PS/sim/pokemon.ts:748, 1655`): `tu = target.getUndynamaxedHP()` (ceil(hp ×
baseMaxhp / maxhp) while Dynamaxed), `avg = floor((tu + user.hp) / 2) || 1`, the target's `sethp(hp − (tu − avg))`
(trunc, at least 1, at most its maximum), the user's `sethp(avg)` (T2-PS01: 300/470 → 275, the user 125). The user is never
Dynamaxed (its status move is Max Guard).

**Model.** `painSplitMax` replaces the guard with this arithmetic in painSplit's `mapJoint` (the kernel's `hp[slot]` gives
both maxima). **Cases:** T2M-PS-01, 02 (SwSh).

### 3.25 face-self-hit (Track S)

**Showdown.** The confusion self-hit's effect is of type Move (`PS/data/conditions.ts:193-194`): an intact Disguise takes it
(0 damage), the busted form at the Update, the 1/8 chip in gen 8+ only (T2-FA13-sv, -usum).

**Model.** `selfHit` replaces the guard: no self-hit damage, `withSpecies(…busted…)`, the chip through afterLoss in gen 8+
(its Berry; `hurt`), nothing more (no Berserk lock: no damage of type Move landed). **Facts:** skip fact `Hurts itself in
confusion; Disguise takes the hit.`, the chip as a loss `{Name} loses {n} HP (Disguise).`. **Cases:** T2M-FS-01, 02.

### 3.26 sleep-talk-uproar (Track C, `doubles-calls.ts`)

**Sleep Talk.** Showdown (`PS/data/moves.ts:16867`): used asleep or with Comatose, it picks uniformly (`this.sample`) among
its move slots without `nosleeptalk`, `charge`, a damaging Z-Move or a Max Move, and uses it (`useMove` with no target:
`getRandomTarget`, a uniform living adjacent foe for a single-target move, T2-ST01); with none it fails. Model:
`sleepTalk` and `presence` replace the guards: a user that woke in BeforeMove fails it (today's `Sleep Talk fails: {Name} is
awake.`); asleep, the callable moves from `input.moves` (SPEC2; generated `SLEEP_TALK_UNCALLABLE` per game); none: `Sleep
Talk fails: {Name} has no move it can call.`; else one world per move (1/k) through `callMove(k, w, action, moveId, null)`:
the called move runs now as the action's (no BeforeMove, no PP; runMove's body: damagingMove or statusMove with the called
id; its target from `getRandomTarget`'s rule for its target type: one world per living candidate), its facts under Sleep
Talk's step with `Sleep Talk calls {Move}.`. No `moves`: `REASONS.callNeedsMoves("Sleep Talk", name)`. `callMove` is the
one helper for every calling move; the presence architect's (Copycat, Mirror Move, Nature Power, Me First, Instruct) use
it (§7 Q6).

**Uproar.** Showdown (`:20211`): its `onTryHit` (after a protection: a protected target gets none) wakes every asleep
active Pokémon on both sides; on hit `self.volatileStatus: 'uproar'` (3 turns, locked); while any active Pokémon has it,
`onAnySetStatus` fails sleep (T2-UP01: Rest and Spore fail), Yawn's included; Throat Chop on its user ends it. Model:
`presence` drops the guard; the hit wakes the sleepers (cureStatus; A2's Nightmare ends; `vol.sleep` deleted), the user
gets `vol.uproar = 2`; canStatus fails `slp` while any active Pokémon has `vol.uproar` (`{Name} cannot fall asleep:
Uproar.`), Rest fails (`Rest fails: Uproar.`), E's Yawn finds no sleep; carried `uproar` starts it. **E2:** `uproar` with
its turns. **Training:** `uproar` (`-start … Uproar`, public) to `carried.uproar`; Sleep Talk's rollout `{Name}: sleeptalk
is not modelled.` (bridge.ts:311) goes; the bridge already passes `moves` (bridge.ts:345, the leak gate covers it).
**Cases:** T2M-ST-01, 02, T2M-UP-01, T2E-UP-01.

### 3.27 safeguard-damaging-status (Track C)

**Showdown.** Safeguard stops a foe's move's status and confusion on its side (`onSetStatus`, Infiltrator passes; T2-SG01).
**Model.** `safeguard` (the moved guard) goes; C's `stepEnv` sets `UsesEnv.safeguard` when the target's side has
`safeguard` (set this turn, or `SideConditions.safeguard` from an earlier turn: §2.1) and the user is a foe without
Infiltrator in effect. **Inputs:** a per-side `Safeguard` toggle in Field conditions (U); Training maps the `safeguard`
side condition (MAPPED_SIDE; public `-sidestart`), with SPEC2 Step 1's clock. **Cases:** T2M-SG-01, 02.

### 3.28 helping-hand-twice (Track C)

`helpingHand` (the moved guard) goes: `user.helpingHand ≥ 2` sets `MoveContext.helpingHands` (Step 0b′: one modifier
round(4096 × 1.5^n), the side's flag off; `PS/data/moves.ts:8574` onRestart). Reachable only through a called Helping Hand
(Copycat, Instruct, Dancer: the presence entries); its oracle case T2M-HH-01 lands with the first modelled calling move,
a unit test on a synthetic world until then.

### 3.29 Q13: Electrify and Ion Deluge on own-type moves, Z-Moves and Max Moves (Step 0b′ calculate.ts; A2 addition)

**Showdown** (T2-Q01–Q16; `PS/sim/battle-actions.ts:393-438`):
- Max Moves are picked after the move's own and the runEvent ModifyType: under Electrify every Max Move is Max Lightning
  (Electric Terrain) or the user's Electric G-Max move (G-Max Volt Crash, G-Max Stun Shock), with the base move's
  `maxMove.basePower`; no -ate boost (a new active move).
- Z-Moves are picked from the data type (Weather Ball's own type first) and keep their name; ModifyType then runs on the
  Z-Move: Electrify makes any Z-Move Electric (Breakneck Blitz, Inferno Overdrive, Pulverizing Pancake: T2-Q05 immune
  Garchomp), Ion Deluge only a Normal one; the -ate abilities and Normalize skip damaging Z-Moves.
- Own-type moves get their type and power at use (Weather Ball 100 in sun, Terrain Pulse 100 on its terrain, Judgment,
  Multi-Attack, Techno Blast, Revelation Dance, Natural Gift by its Berry, Hidden Power, Aura Wheel, Raging Bull), then
  Electric (Ion Deluge: only where that type is Normal: Weather Ball with no weather, T2-Q09; in rain it stays Water,
  T2-Q09b); Raging Bull still breaks the screens (T2-Q16).

**Model** (calculate.ts, keyed on `MoveContext.retype`, Step 0b′):
1. Max Move: the base move retyped to Electric before the conversion (`resolveWith(…, { type: "Electric" })`, the existing
   Gigantamax Weather Ball pattern, calculate.ts:1718-1731), the user's type-changing ability as `GAS_STAND_IN` for that
   run (the engine's `getMaxMoveName` Normalize branch would force Max Strike), no 4915. The row's effective name (Max
   Lightning, G-Max Volt Crash) drives MAX_MOVE_EFFECTS and GMAX_EFFECTS through the kernel's `usedMove` (A2 passes the
   retype into `usedRow`, SPEC2 F2 §2.3).
2. Z-Move: the engine move built by the Z-Move's Showdown name (generic: `getZMoveName(base, the type it is picked by)`;
   signature: its own) with `overrides { type: "Electric", basePower: the base's zMove power (generic) or its own,
   category }` and no conversion; the signature Z-Moves keep their name-keyed engine branches.
3. Own-type move: the unretyped run's type and power (`result.move.type`, its base power as used), then a carrier engine
   move: the base move's category, flags, target, secondaries and recoil, named `"<Move> (type and power at use)"` (no
   name-keyed type branch fires: the `parentalBondStrike` Terrain Pulse precedent, calculate.ts:1111-1118), type Electric,
   that power; Raging Bull's screens off in that run's `defenderSide`; Natural Gift's Berry use as today's unretyped path.
4. Ion Deluge: each path only when the type at that point is Normal; otherwise the unretyped move.
A2 removes its `combo(move, "Electrify")` and `combo(move, "Ion Deluge")` rows (its own file); the key stays for
Synchronoise and Natural Gift with Embargo or Heal Block. **Facts:** A2's `Electrify: its move is Electric type this turn.`;
the row's own effective name and type. **Cases:** T2M-Q-01…14.

---

## 4. REASONS and facts

### 4.1 REASONS deltas (`doubles-actions.ts`; each removed by the track that models it, a key with its last site)

**Removed:** `semiInvulnerable` (H); `focusBand` (P); `berryBetweenHits` (P); `ariaFaint` (P); `allyEffect` (P);
`faceSelfHit`, `faceMultiHit` (S); `maxGuard`, `randomStatus` (M); `withDynamax` (C; Pain Split was its one site); the
`notIn2v2` sites for Core Enforcer, Burning Jealousy, Alluring Voice, Spectral Thief, Cotton Down, Flower Veil, Pastel
Veil, Battle Bond, Aftermath, Innards Out, Receiver, Power of Alchemy, Unnerve and As One (both sites), Disguise and Ice
Face (faceHit's three), Gale Wings, Assurance (K, P, S); the G-Max moves' `notIn2v2` (M); Sleep Talk and Uproar (C),
Safeguard and Helping Hand (C). `EVENT_THIRD_PARTY` and `FAINT_REACTIONS` lose the modelled ids; `FACE_REACTIVE_ITEMS`
and `FACE_UNSAFE_MOVES` go (S); GMAX_EFFECTS' `guard` field goes (M). The 1v1 rows' "Focus Band: 10% to survive each KO
hit" stays (1v1 unchanged).

**Narrowed, kept with their exact texts:** `spreadEffect` (Dragon Darts with a reacting second dart, §3.3), `subPerHit`
(Triple Axel, Triple Kick, Parental Bond, §3.23), `intoSubstitute` (multi-hit with recoil, drain or a self-cost: no
catalog move, §3.22), `received` (Booster Energy, §3.21), `dartsAimSelf` (§3.20).

**Added** (Step 0 writes the key; C starts calling it):

```ts
  /** C: a calling move (Sleep Talk; the presence entries' Copycat and kin) whose user's moves the input does not give. */
  callNeedsMoves: (move: string, name: string) => `${move} needs ${name}'s moves.`,
```

### 4.2 Facts (names from `kernel.names`; never positions; facts only)

| Where | Text |
|---|---|
| hit fact (H) | `{Move} misses {Name} ({Fly}).` |
| card condition (H) | `Out of reach ({Fly}).` while hidden |
| step fact (H, landing) | `{Name} falls to the ground ({Gravity}): {Move} is cancelled.` (a release cancelled); hit fact `{Name} falls to the ground.` (no release queued) |
| loss (H, crash) | `{Name} loses {n} HP ({High Jump Kick}).` |
| turn fact (H) | `Assumes {Name} did not charge {Move} last turn.` (SPEC2's Geomancy fact generalised; a two-turn move without `carried.charging`) |
| hit facts (K) | `Burning Jealousy: {Name} is burned.`; `Alluring Voice: {Name} is confused.`; `Spectral Thief: {User} takes {Name}'s +2 Attack and +1 evasion.`; `Core Enforcer: {Name}'s ability is suppressed.` |
| hit facts (K) | `Cotton Down: {Name}'s Speed falls.` (one line per Pokémon, with its chance); `Flower Veil: {Name}'s stats do not fall.` / `Pastel Veil: {Name} is not poisoned.` |
| hit facts (K) | `Battle Bond: {Name} gets +1 Attack, +1 Sp. Atk and +1 Speed.` / `Battle Bond: {Name} becomes Greninja-Ash.`; `Receiver: {Name} gets {Ability}.` / `Power of Alchemy: {Name} gets {Ability}.` |
| loss (K) | `{Name} loses {n} HP (Aftermath).`, `{Name} loses {n}–{m} HP (Innards Out).` (outside a followed step; inside it the step's HP shows it) |
| turn fact (K) | `Assumes {Name} has not had Battle Bond act before in this battle.` |
| hit facts (P) | `Focus Band: {Name} keeps 1 HP.`; `{Name} eats its {Ganlon Berry} after hit {h}: +1 Defense.` |
| hit facts (S) | `{Disguise}: {Name} takes no damage.` (exists); `Rocky Helmet: {User} loses {n} HP.` (as a loss on the user); `{Name}'s Air Balloon pops.`; `{Name} eats its {Kee Berry}: +1 Defense.`; `Sticky Barb moves to {User}.`; `{Move}: {User} takes {Name}'s {Item}.`; `{Move}: {Name}'s {Item} is knocked off.` |
| skip fact, loss (S) | `Hurts itself in confusion; Disguise takes the hit.`; `{Name} loses {n} HP (Disguise).` |
| hit facts (M) | `{G-Max Smite}: {Name} is confused.`; `G-Max Cuddle: {Name} is infatuated.`; `G-Max Chi Strike: {Name}'s critical-hit ratio rises.`; `G-Max Replenish: {Name}'s {Berry} comes back.`; `{G-Max Befuddle}: {Name} is {paralysed}.` (one per world) |
| step facts (C) | `Sleep Talk calls {Move}.`; `Sleep Talk fails: {Name} has no move it can call.`; `Uproar: {Name} wakes up.`; status fails `{Name} cannot fall asleep: Uproar.`, `Rest fails: Uproar.` |

---

## 5. Oracle cases (Track V adds `cases-t2m.ts`; every case runs the three walks, exhaustive unless marked)

Prefixes: `T2M-` moves-phase models, `T2P-` the pairwise step's new environment, `T2E-` end of turn and E2, `IN-` the fixes
found in passing. Every entry with an SV catalog presence has an SV case and one other game; an entry SV lacks has two
cases in its games. The probe each case grows from is named.

| Id | Game(s) | What (probe) |
|---|---|---|
| T2M-SI-01 | sv, ch | Dig + the ally's Earthquake ×2 (T2-SI01) |
| T2M-SI-02 | sv, ch | Dig: Body Slam misses, Earthquake ×2 and 0.75 (T2-SI02) |
| T2M-SI-03 | sv; ch | Fly: Hurricane hits, Gust ×2 (T2-SI03); ch: Hurricane hits, Thunderbolt misses |
| T2M-SI-04 | ch, sv | Fly: Rock Slide misses it, 0.75 on the ally (T2-SI04) |
| T2M-SI-05 | ch, sv | Fly: Smack Down grounds it, a later Earthquake hits (T2-SI04d reordered) |
| T2M-SI-06 | swsh, usum | Bounce: Gust ×2 through power (T2-SI05) |
| T2M-SI-07 | usum, sv | Dive: Surf ×2 (T2-SI06) |
| T2M-SI-08 | sv, ch | Phantom Force: Earthquake misses, No Guard hits (T2-SI07) |
| T2M-SI-09 | sv, usum | Toxic from a Poison type hits, from a Snorlax misses (T2-SI08) |
| T2M-SI-10 | sv, ch | Gravity lands the Fly user; a later Thunderbolt hits (T2-SI09) |
| T2M-SI-11 | usum, swsh | Lightning Rod takes the move into its digging holder, which misses (T2-SI10) |
| T2M-SI-12 | sv, ch | Thunder Wave and a spread Growl miss; Pollen Puff misses; Perish Song misses; Haze reaches (T2-SI11, 11b) |
| T2M-SI-13 | ch, sv | carried `charging` Fly: hidden at the start; released; fully paralysed it stays hidden (T2-SI12b, c) |
| T2M-SI-14 | sv, ch | Dragon Darts into a Fly target and its ally: both darts into the ally |
| T2E-SI-01 | ch, sv | E2: `charging` after a charge; none after Gravity's landing |
| IN-CR-01…06 | sv, ch, usum | crash: Protect, a Ghost, Jump Kick (usum), Supercell Slam then a later Body Slam, Magic Guard, a miss into Fly (T2-CR01–05, T2A-CR1–3) |
| T2M-VS-01 | sv, swsh | Howl, Burning Jealousy, the burned foe's halved Body Slam (T2-VS01) |
| IN-BJ-01, 02 | sv, ch | Burning Jealousy as the last action: the end-of-turn burn (T2A-VS1) |
| T2M-VS-03 | sv, ch | Howl, Alluring Voice, the confused foe's move (confusion chance enumerated) (T2-VS02) |
| T2M-VS-04 | swsh, usum | Spectral Thief then the target's Close Combat; usum through a Substitute (T2-VS03, 03b) |
| IN-ST-01 | swsh, usum | Spectral Thief as the last action, E2 stages (T2A-VS3) |
| T2M-VS-05 | usum, swsh | Trick Room: Core Enforcer suppresses the Pokémon that moved; a later Earthquake hits it (T2-VS04) |
| IN-CE-01 | usum, swsh | Core Enforcer as the last action into a toxic Poison Heal Gliscor (usum) / a Speed Boost user (swsh), E2 (T2A-VS2) |
| T2M-SE-01 | ch | Rock Slide into Scovillain-Mega (Spicy Spray) and a partner: one burn (T2-SE01) |
| T2M-SE-02 | sv, ch | Defiant Kingambit's Breaking Swipe into two Gooey Goodra (T2-SE02) |
| T2M-SE-03 | ch, sv | the same at Spe −6 (T2-SE03) |
| T2M-SE-04 | sv, ch | White Herb after two Gooey drops (T2-SE04) |
| T2M-SE-05 | swsh, usum | a contact spread move into Mummy (Cofagrigus) and Tangling Hair / Rough Skin targets |
| T2M-SCK-01 | ch, sv | Spiky Shield knocks the user out; its other target still hit (T2-SCK01) |
| T2M-SCK-02 | usum | a Z-Move through Spiky Shield with the user's Life Orb followed |
| T2M-ALE-01 | sv, ch | Quick Attack into its own Armor Tail ally on Psychic Terrain (guards-probes-3 R1) |
| T2M-ALE-02 | usum, sv | Aqua Jet into its own Dazzling ally on Tapu Lele's Psychic Terrain |
| T2M-UN-01 | sv, ch | a third Pokémon's Unnerve and a Haban Berry (T2-UN01) |
| T2M-UN-02 | sv, usum | the user's own Unnerve into its Shuca Berry ally (T2-UN02) |
| T2M-UNR-01, 02 | sv, ch | Flare Blitz knocks out the Unnerve holder: Sitrus before the recoil (T2-UN03) |
| T2M-CD-01, 02 | swsh | Cotton Down with Mirror Armor; two hits with a Defiant ally (T2-CD01, 02) |
| T2M-FV-01 | sv, usum | Snarl into Flower Veil's Grass ally (T2-FV01) |
| T2M-FV-02 | sv, ch | Mold Breaker Bulldoze passes Flower Veil (T2-FV02) |
| T2M-BB-01 | sv | Battle Bond's boost, then its ally's move (T2-BB01) |
| T2M-BB-02 | usum | Battle Bond's Ash form, then a hit into it (T2-BB02) |
| T2M-BB-03 | sv | no foe left: no boost (`canSwitch` false) (T2-BB03) |
| T2M-AF-01 | sv, ch | Aftermath: a quarter, the Sitrus at the hit's Update (T2-AF01) |
| T2M-AF-02 | sv, usum | Damp stops Aftermath (T2-AF02) |
| T2M-AF-03 | sv, swsh | Aftermath before recoil (T2-AF03) |
| T2M-IO-01 | swsh, usum | Innards Out on one hit (T2-IO01) |
| T2M-IO-02 | swsh | Innards Out after a two-hit move (T2-IO02) |
| T2M-IO-03 | ch, swsh | Innards Out in a spread move (T2-IO03) |
| T2M-RC-01 | sv, ch | Receiver takes Intimidate, which acts (T2-RC01) |
| T2M-RC-02 | usum, sv | Power of Alchemy takes Levitate; a later Earthquake misses (T2-RC02) |
| T2M-FA-01 | sv, usum | Double Hit into Mimikyu: chip (sv) / none (usum), hit 2 into the busted form (T2-FA01) |
| T2M-FA-02 | swsh, sv | Dual Wingbeat into Eiscue: hit 2 into Noice (T2-FA02) |
| T2M-FA-03 | ch, usum | Parental Bond Crunch into Mimikyu (T2-FA03) |
| T2M-FA-04…12 | sv; ch / usum | Rocky Helmet, Air Balloon, Kee Berry, Sticky Barb, Knock Off, Thief, Fire Spin, Salt Cure (sv, ch), Magician (T2-FA04–12) |
| T2M-FA-13 | sv, usum | Jaboca Berry, Cell Battery and Smelling Salts on a 0-damage face hit (their DamagingHit / onHit handlers; unprobed here, the oracle decides) |
| T2M-FS-01, 02 | sv, usum | a confusion self-hit into Disguise (T2-FA13) |
| T2M-FB-01 | sv, ch | Focus Band on a knockout hit (O1) |
| T2M-FB-02 | sv, usum | Focus Band per hit of a two-hit move (O1b) |
| T2M-FB-03 | sv, swsh | Focus Band on a confusion self-hit (T2-FB01) |
| T2M-BE-01 | sv, usum | Ganlon between two hits (T2-BE01) |
| T2M-BE-02 | swsh, sv | Starf between two hits (T2-BE02) |
| T2M-BE-03 | usum, swsh | Apicot with Water Shuriken (special, 2–5 hits) |
| T2M-BE-04 | sv, swsh | Lansat with Cheek Pouch between hits (Dedenne) |
| T2M-AR-01, 02 | sv, ch / usum | Sparkling Aria: a Life Orb knockout cures, a Rowap one does not (T2-AR01, 02) |
| T2M-GW-01, 02 | usum | Gale Wings frozen at +1 stopped by Dazzling (T2-GW01-usum); frozen at 0, healed to full, not stopped by Psychic Terrain |
| T2M-AS-01, 02 | sv, ch / usum | Assurance after the target's recoil (T2-AS01); after its Life Orb |
| T2M-GM-01…08 | swsh | Smite, Gold Rush, Cuddle, Chi Strike (then a Scope Lens ally's high-crit move: certain), Finale, Befuddle (9 worlds), Stun Shock, Replenish, Max Guard (T2-GM01–09) |
| T2M-RI-01 | sv, ch | a Klutz giver's Electric Seed in Electric Terrain (status-eot T10c) |
| T2M-RI-02 | swsh, sv | a Klutz giver's Room Service under Trick Room |
| T2M-SB-01 | swsh | Max Darkness, Max Knuckle, Max Lightning into a Substitute (T2-SB01–03) |
| T2M-SB-02 / 02b | usum | Splintered Stormshards ends the terrain through a Substitute (T2-SB05); Genesis Supernova sets none behind one |
| T2M-SB-03 | swsh, usum | Mind Blown into two Substitutes (status-eot U17) |
| T2M-SB-04 | sv, ch | Magician behind a Substitute (status-eot U15) |
| T2M-SB-05 | ch, usum | Parental Bond Power-Up Punch into a Substitute, with and without the break (T2-SB06, 06b) |
| T2M-SP-01 | sv, ch | Dual Wingbeat into a Multiscale Dragonite's Substitute (T2-SP01) |
| T2M-SP-02 | sv, swsh | Icicle Spear into a Stamina Mudsdale's Substitute |
| T2M-SP-03 | usum, sv | Bullet Seed into a resist-Berry holder's Substitute |
| T2M-PS-01, 02 | swsh | Pain Split into a Dynamaxed foe (T2-PS01); the Dynamaxed foe low, the user high |
| T2M-ST-01 | sv, ch | Sleep Talk: 1/3 each, Body Slam's random foe (T2-ST01) |
| T2M-ST-02 | usum, sv | Sleep Talk with Comatose (Komala) |
| T2M-UP-01 | sv, swsh | Uproar wakes, Rest and Spore fail (T2-UP01) |
| T2E-UP-01 | ch, sv | a carried Uproar: a Yawn's sleep at the end of turn fails; E2 turns left |
| T2M-SG-01 | sv, ch | Safeguard this turn and a later Nuzzle; an Infiltrator Chandelure's Inferno passes |
| T2M-SG-02 | sv, usum | Safeguard from an earlier turn (the new side input) |
| T2M-HH-01 | sv, ch | a called second Helping Hand (only once a calling move is modelled) |
| T2M-Q-01 | swsh | Max Lightning from a Pixilate Hyper Voice; G-Max Volt Crash (T2-Q01, Q02) |
| T2M-Q-02 | usum | Inferno Overdrive under Electrify (T2-Q06); Breakneck Blitz under Ion Deluge (T2-Q04) |
| T2M-Q-03 | usum | Pulverizing Pancake under Electrify into Garchomp (T2-Q05) |
| T2M-Q-04 | swsh, ch | Weather Ball in sun under Electrify (T2-Q03) |
| T2M-Q-05 | swsh, ch | Terrain Pulse on Psychic Terrain (T2-Q10) |
| T2M-Q-06…11 | usum (+ swsh where present) | Judgment, Multi-Attack, Techno Blast, Revelation Dance, Natural Gift, Hidden Power (T2-Q07, Q11, Q14, Q15, Q13, Q08) |
| T2M-Q-12 | swsh, ch | Aura Wheel (Hangry) (T2-Q12) |
| T2M-Q-13 | ch | Raging Bull through Reflect (T2-Q16) |
| T2M-Q-14 | usum | Ion Deluge and Weather Ball with no weather / in rain (T2-Q09, Q09b) |

About 120 new cases. `status2/build/changed-cases.ts` (SPEC2 V) adds the stored cases whose expected reason this design
removes: E40-Disguise, S48-Disguise-selfhit, VF16, E40-Magician, E40-MaxMove-swsh, E40-MindBlown-usum,
E40-ParentalBond-usum, E40-DualWingbeat-Mummy-swsh, E40-IcicleSpear-Multiscale, E40-IcicleSpear-Stamina,
E40-IcicleSpear-YacheBerry, E03-DragonDarts (stays: kept), E22b, E22c (Seed, Room Service), F14a, F14c, S47b, S47c (Sleep
Talk, Uproar), F30d, M29c (Unnerve), VE-F1-10, VE-F1-13, VE-H5-6, S48-PainSplit-dynamax-swsh, R16 (G-Max), and any stored
case with `is semi-invulnerable after`, `Focus Band is not modelled.`, `Max Guard is not modelled.`, `against an ally's
move`, the `notIn2v2` texts of §4.1; plus every stored case whose turn has a crash move into a protected, immune or missed
target (IN-CRASH changes its numbers: the script lists them by searching the inputs).

**Harness additions (V's own files):** `case-types.ts` `CaseCarried.charging`, `lockOn`, `bondUsed`, `uproar`;
`CaseSide.safeguard` (SPEC2 has it); `sim-dfs.ts prepare()`: a charge from last turn as `addVolatile('twoturnmove')` with
the move volatile (duration 1, the lock: the choice `move 1` without a target), `lockon` with its source, `uproar` with its
duration, `bondTriggered`; `compare.ts`: E2 `charging`, `uproar`, `chiStrike`, `bondUsed`; `CHANCE_EFFECTS` already has
`focusband`; G-Max sets need `gigantamax` (exists).

---

## 6. Tracks and file ownership (disjoint from SPEC2 §8.3; additions marked +)

### 6.1 Step 0 additions (SPEC2 §8.1's two builders)

| Part | Owns (as in SPEC2) | Adds |
|---|---|---|
| 0a | doubles-types.ts, types.ts, doubles-world.ts, doubles-turn.ts, doubles-status.ts, doubles-eot.ts lines, doubles-actions.ts, the new modules | §2.1's contract, §2.2's six modules (moved code and stubs) and hook calls, `callNeedsMoves`, the hooks source test rows |
| 0b′ (0b's second commit) | calculate.ts, engine-corrections.cjs, model.ts, uses-to-ko.ts, mechanics.ts | §2.3–§2.5 (the step's env, the outcome and part fields, hit-loop.ts's two fields: **hit-loop.ts joins 0b's files**), `tests/unit/status2-plumbing-t2.test.ts` |

Gate: SPEC2's Step 0 gate (golden byte-equal, the 1264 stored cases with their facts, the bench within 5 %), plus 0b′'s
unit tests reproducing the probes of §2.3.

### 6.2 New wave 1 tracks (each owns only its new files)

| Track | Owns (exclusive) | Implements | Depends on | Gate |
|---|---|---|---|---|
| H Hidden | `doubles-hidden.ts`, `tests/unit/doubles-hidden.test.ts` | §3.1 (+ IN-CRASH first, its own commit) | Step 1; A2 (`typesIn`), A3 (fieldMove's Gravity call: inserted by Step 0) | T2M-SI, T2E-SI, IN-CR cases |
| K Reactions | `doubles-reactions.ts`, `tests/unit/doubles-reactions.test.ts`, `tests/source/doubles-spread-reactions.test.ts` | §3.2–§3.4, §3.6–§3.12 (+ IN-BJ, IN-ST, IN-CE first) | A1 (applyBoosts, writeStages, setAbility, the Start table with `noreceiver`), A3 (give / take), D (ledger), E (perish) | T2M-VS/SE/SCK/UN/UNR/CD/FV/BB/AF/IO/RC, IN-BJ/ST/CE |
| P Pairs | `doubles-pairs.ts`, `tests/unit/doubles-pairs.test.ts` | §3.5, §3.14–§3.18 | Step 0b′ | T2M-ALE/FB/BE/AR/GW/AS |
| S Substitute and faces | `doubles-faces.ts`, `doubles-substitute.ts`, `tests/unit/doubles-faces.test.ts`, `tests/unit/doubles-substitute*.test.ts`, `tests/source/doubles-substitute-census.test.ts` | §3.13, §3.22, §3.23, §3.25 | Step 0b′ (`fresh`, the part fields); A3 (take / give for the item rules) | T2M-FA/FS/SB/SP |
| M Max | `doubles-max.ts`, `tests/unit/doubles-max.test.ts` | §3.19 | A2 (Attract), D (`lastItem`), Step 0b′ (`critBoost`) | T2M-GM |
| C Calls | `doubles-calls.ts`, `tests/unit/doubles-calls.test.ts` | §3.24, §3.26–§3.28 | Step 0b′ (`safeguard`, `helpingHands`), A2 (Nightmare's end), E (Yawn) | T2M-PS/ST/UP/SG/HH, T2E-UP |

### 6.3 Additions to SPEC2 tracks' own files

| Track | File (its own) | Addition |
|---|---|---|
| A1 + | `ability-table.ts` and its generator | the `noreceiver` flag per ability per game (K reads it); the Start table entry for a copied ability is A1's as for any `setAbility` |
| A2 + | `doubles-typing.ts`, `classify-a2.md` | Q13: the `combo` rows for Electrify and Ion Deluge go (§3.29); the grounding write calls `hidden.land` (Step 0 inserts the call) |
| A3 + | `doubles-items.ts`, `doubles-field.ts` | §3.21 (received Seeds and Room Service); Teatime calls `hidden.missesField` (Step 0 inserts it) |
| E + | `doubles-eot.ts` | a carried release that did not happen ends hidden at its residual (no HP); Uproar: Yawn's sleep fails while any active Pokémon has `vol.uproar`, the countdown and its E2 field; Receiver's copy from a residual faint (K's `allyFaint` is called by `faint`) |
| T + | `app/(app)/training/**` | bridge: `charging`, `lockOn`, `uproar` to carried, `safeguard` into MAPPED_SIDE; the rollouts `{Name}: fly / dig / dive / bounce / phantomforce / twoturnmove / lockon / uproar is not modelled.` and `{Name}: sleeptalk is not modelled.` go; `postFromOutcome` writes `charging` and `uproar` back; the conformance and leak gates cover the new fields |
| U + | `doubles-prep.ts`, `BattleConditions.tsx`, `useDoublesView.tsx`, `doubles-format.ts` | `Charged last turn` (CarriedFields; shown for a two-turn move: writes `carried.charging`; `data-doubles-charged`), a per-side `Safeguard` toggle (Field conditions; `data-doubles-safeguard`), the conditions `Out of reach ({Move}).` and the facts of §4.2; 375 px |
| V + | `scripts/.cache/calc-audit/2v2/verify/**` | `cases-t2m.ts` (§5), the harness additions of §5, the changed-case list entries |

### 6.4 Order

Step 0 (with §6.1) → Step 1 (SPEC2's fixes) → **IN-CRASH, IN-BJ, IN-ST, IN-CE** (H and K's first commits, each with its
cases; they change numbers today's app shows: listed) → wave 1 (SPEC2's A1 A2 A3 D E F T U V with the additions above, and
H K P S M C in parallel) → integration 1 (SPEC2 §8.4; merge H, K, P, S, M, C after A1–F, before T, U, V; re-run every
oracle case, the changed cases, golden, the bench, the Training gates; the census sample's not-estimated share by reason
reported against census-guards' table) → wave 2 (R: Eject Button and Red Card behind a face, the U-turn family into a
face, Emergency Exit after a crash, all already shaped as the switch family's).

---

## 7. Risks, and what only the user can decide

### 7.1 Riskiest points

1. **Step 0b′ in `uses-to-ko.ts`** (six env fields, three outcome fields, two part fields): the largest engine change.
   Every field is turn-mode-only and keyed on unset fields, so golden-1v1 and the 1264 cases pin today; 0b′'s unit tests
   pin each new behaviour to its probe numbers before any track uses it.
2. **The continuation's per-use bookkeeping** (§2.5): Life Orb once, Shell Bell's total across the two parts, the stopped
   part with no per-use effect. One mistake is a quiet wrong number on a multi-hit move. Pinned by T2M-BE-01…04,
   T2M-FA-01…03, T2M-SP-01…03 and the re-run VE-F1-10 / VE-F1-13 / E40 cases.
3. **The spread reactions list** (§3.3): a reaction the step still applies to the user would make the per-target states
   differ again (then `spreadEffect` fires: safe, not wrong); a reaction listed but also applied would double it (wrong).
   `tests/source/doubles-spread-reactions.test.ts` checks each attacker-side write in uses-to-ko's afterHit against the
   list.
4. **Faces running the kernel's afterHit on a 0-damage outcome** (§3.13): an afterHit rule that reads the damage or the
   target's HP change would misread it. Every afterHit rule is reviewed against T2-FA04–FA12; the source test lists them.
5. **Crash damage (IN-CRASH) changes numbers users see today** (High Jump Kick into Protect is common in VGC practice):
   the changed-cases script must find every stored case with a crash move that failed.
6. **Training's numbers move**: release turns, Uproar, Safeguard, Sleep Talk cells reach the engine instead of rollouts.
   The conformance and eval gates; HabitBot reported beside main on the same seeds (SPEC2 §6).
7. **`callMove` is shared with the presence architect's calling moves**: one owner (C), one contract (§3.26); a second
   design of the same helper would conflict.
8. **Budgets**: Focus Band doubles a knocking hit's outcomes, a Starf between hits makes up to five continuations,
   Befuddle nine worlds, Sleep Talk k × targets. All bounded; "Too many cases to follow." is the only fallback.

### 7.2 Questions only the user can decide (each with the recommended default)

1. **The release turn of a two-turn move charged last turn** (it starts hidden for Fly and kin). Recommended: model it in
   both, with a `Charged last turn` control in the calculator (default off: today's charge, with the fact `Assumes {Name}
   did not charge {Move} last turn.`) and Training mapping its public `-prepare`. Alternative: Training only (no control).
   Alternative: neither (Training's release turns stay rollouts; the semi-invulnerable model still covers this turn's
   charge).
2. **A Safeguard from an earlier turn as a side toggle** in the calculator. Recommended: yes (the step's Safeguard is then
   complete; Training maps it). Alternative: Training only.
3. **Dragon Darts aimed where its user now stands** (§3.20). Recommended: keep the reason. Alternative: a pairwise path
   for a move that hits its own user.
4. **Booster Energy received by Trick** (§3.21). Recommended: keep the reason (reachable only after an ability change;
   its activation belongs to the field-change settle). Alternative: model it with that settle once it exists.
5. **Triple Axel, Triple Kick and Parental Bond into a Substitute in front of a per-hit effect** (§3.23). Recommended: keep
   `subPerHit` for them. Alternative: a per-hit first-hit calculation at each hit's power.
6. **`callMove` ownership** with the presence design (Copycat, Instruct, Nature Power…). Recommended: Track C owns it and
   the presence tracks call it. Alternative: the presence track owns it and Sleep Talk waits for it.
