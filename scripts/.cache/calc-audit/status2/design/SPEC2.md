# 2v2 status moves, part 2, and the remaining narrow guards: build spec (status2)

Branch `calc-2v2-status-2`, cut from main `4008ee8`. This is the critic's synthesis of the four family designs in this
folder, written from the two censuses:

| Short | File | Covers |
|---|---|---|
| F1 | `stats-abilities-transform.md` | stat stages, stored stats, abilities, Transform and Imposter, Stockpile / Swallow / Spit Up |
| F2 | `types-volatiles.md` | world types, volatiles, Electrify / Ion Deluge, Heal Block in later steps, the type-change guards, Color Change |
| F3 | `field-side-items.md` | reflection, Snatch, side and field conditions, rooms, items, party cures |
| F4 | `guards.md` | the narrow guards the user named, FINAL.md's open list, the switch-out family |
| C1 | `census-moves.md` (+ `.json`) | the 73 kind-L status moves |
| C2 | `census-guards.md` (+ `.json`) | the 101 "not estimated" paths still reachable |

Ground truth is pinned Showdown `c23d2e94`: `PS/…` is the read-only source
`node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353`, and the runnable copy is
`scripts/.cache/calc-audit/showdown`. Probe ids: `SAnn` (F1), `TVnn`/`TWnn` (F2), `Fnn` (F3), `A1`…`R1`, `GAn` (F4),
`Kn`/`Pn` (the censuses), and **`CRnn`, this critic's** (`critic-probes-1.ts` → `critic-probes-1.out`, run with
`npx --no-install tsx scripts/.cache/calc-audit/status2/design/critic-probes-1.ts` from the repo root; 11 probes, 26 runs,
seven of them with a control; `critic-probes-1.err` is empty). App line numbers are the tree at `4008ee8`.

The user asked: **"do 3 and 4"**: (3) model the 73 status moves the 2v2 turn still leaves "not estimated", and (4) remove
the remaining narrow "not estimated" guards: Eject Pack switching out mid-turn, Opportunist / Mirror Herb copying a stat
rise, Harvest and Pickup, Stored Power / Power Trip / Punishment after an accuracy or evasion change, Fling, one-hit KO
moves, spread heals, and the rest of FINAL.md's open list.

House rules, unchanged:
- every number is exact against pinned Showdown in each game where the move exists (sv, champions, swsh, usum), or the
  turn (or only its end) is "not estimated" with a one-line fact;
- UI text is facts only, with Pokémon names (`kernel.names`, `doubles-types.ts nameText`), never left/right;
- 1v1 output stays byte-equal (`golden-1v1 --check`), except a verified 1v1 fix (here: Fling only);
- the 1264 stored oracle cases keep agreeing;
- Training reads public information only (tracker counts, the belief world's replay of public lines).

---

## 0. Decisions in one page

1. **No status move stays L.** The 73 become **56 M** (exact; an unknown earlier-turn state is a stated `Assumes …` fact)
   and **17 C** (exact under a condition, else one narrow fact reason). §2.2 lists each with its owner track and the reason
   it may still give. Purify, Stuff Cheeks, Swallow and Teatime leave `HP_STATUS_MOVES`; Revival Blessing (P) stays.
2. **Every guard the user named is modelled**, in every game where it exists: Opportunist and Mirror Herb (a stage-event
   ledger with amounts), Harvest and Pickup (item history), Stored Power, Power Trip and Punishment (hidden stages in the
   power), Fling (a verified 1v1 fix, then its 2v2 effects), one-hit KO moves (a fixed full-HP hit with every immunity),
   spread heals (per-target drain composed in hit order; Shell Bell once from the sum) and Eject Pack mid-turn (the
   replacement model R, Q1). **FINAL.md's open list is modelled** (§2.3). So are the guards whose enabler this build
   creates anyway: Protean / Libero, Roost, Burn Up / Double Shock, the -ate redirect, Ingrain / Magnet Rise / Smack Down
   grounding, Glaive Rush, Symbiosis, Ripen's weakened Berry and Psychic Noise. The other census guards keep their exact
   texts (Tier 2, Q6).
3. **Seven shared enablers**, each with one owner, all in the Step 0 contract:
   (a) world types on the build (`types`, `addedType`; `typesIn` folds Roost);
   (b) stored stats and weight on the build (`storedStats`, `weighthg`);
   (c) ability changes (`setAbility` with a generated per-game ability table);
   (d) a stage-event ledger with amounts (`World.boosted.rose` by stat; the pairwise step reports its rises; the end of
   turn uses the same ledger);
   (e) item history (`lastItem`, `usedItem`, kept only while something reads them);
   (f) build stand-ins in later steps for Heal Block and the Berserk lock;
   (g) one engine-corrections scope for calculation-only markers: the third type, Tar Shot, Miracle Eye, grounding, item
   suppression, the final ×2 / ×0.5 modifiers, hidden stages, Electrify's retype, the Sports, Lucky Chant.
4. **Correctness fixes first (Step 1)**, each its own commit with oracle cases. The app is silently wrong today in five:
   ally-target Defiant / Competitive and Opportunist in the pairwise step (GA5b: 175–207 shown, Showdown 88–105); a
   Champions Sheer Force hit locking a Berserk Berry (GA2); Color Change (TV25: 70–84 and 12.9 % shown, Showdown a certain
   KO); Training keeping hazards that Rapid Spin or Mortal Spin cleared, and ignoring a Safeguard set this turn; Training
   dropping accuracy and evasion stages. Two are text: Trace's contradictory facts (GA1b), the Comatose order. One is
   display: the Ghost Curse user's KO chance.
5. **The critic's corrections** (§1.2) change the designs where the probes disagree: a snatched Swallow uses the Snatch
   user's own Stockpile (CR04); Transform copies `timesAttacked` and the world types (CR03); Heal Block and Embargo carry
   their turns left (CR01, CR02); Glaive Rush ends at its holder's next BeforeMove, No move included (CR10b); Minimize,
   Glaive Rush and Ripen share one final-modifier chain (CR10); a pending copy dies with its copier's ability (CR08);
   Pickup and Harvest run in Speed order on shared item history (CR09); a residual drop feeds the copy at order 29 (CR05);
   the grounding enabler nobody owned (CR07); one name for each state the families named twice.
6. **New randomness, all branched exactly:** Acupressure 1/n, Trace 1/k, Conversion 2 1/n, Attract 1/2 per BeforeMove,
   a Ghost Curse's random foe 1/2, Harvest 1/2, Pickup 1/k, Starf 1/k in a step and at the turn's start, two Snatch users
   1/2, a random drag 1/bench (R), the Liquid Ooze / Heal Block tie 1/2. Budgets are unchanged (200 000 entries); "Too many
   cases to follow." stays the only fallback. A world field is written only when a later reader exists (§4.9).
7. **State from earlier turns.** Training passes it from public information (§6). The calculator gains three compact
   2v2 controls by default (Q2): Stockpile layers, Last move, Item used earlier; under R also Bench, Replacement and
   Hazards. Everything else from earlier turns is assumed absent, as today.
8. **Switch-outs (Q1): recommended R**, the replacement modelled in the calculator and in Training, as a second wave.
   Eject Pack exists only in SV and SwSh, so a Training-only model (R0) would leave the user's own example guarded.
9. **1v1 stays byte-equal** except Fling's verified rows (listed by id). The 1264 stored cases keep agreeing; a script
   lists the stored guard cases this build makes estimated, and V re-runs them in the oracle.
10. **Build.** Step 0 (contract, hook modules holding today's code moved verbatim, inert plumbing; byte-equal gates) →
    Step 1 (the fixes) → wave 1: tracks A1 A2 A3 D E F T U V with disjoint files → integration 1 → wave 2 (R: Step 2
    contract, then R-E, R-U, R-T, R-V) → integration 2 → five reviewers, at most two rounds → the final gate (§8).

---

## 1. Review of the four designs

### 1.1 Verified against code and pinned Showdown (kept)

**The families' probes** were re-read and their key claims spot-checked in `PS/`:
- **F1** (SA01–SA27, 49 runs; K5–K31): Acupressure's 1/n over the seven stats below +6; Psych Up and the swaps writing
  stages with no boost event (no Opportunist, Mirror Herb, Eject Pack or Defiant; White Herb at AfterMove); stored-stat
  splits read by Foul Play, Body Press and Wonder Room in Showdown's order (SA06); Stockpile's counters (SA09b, SA09c);
  Minimize's ×2 chained with Reflect (SA13); Skill Swap's Trace, Flash Fire, Insomnia and Download reactions; Intimidate's
  gen-gated reactions (SA27); Transform's copy (SA19–SA19e).
- **F2** (TV01–TV26, TW01–TW20, 120 runs): setType / addType, the three-type effectiveness, Tar Shot on the first type,
  Electrify and Ion Deluge before targeting, Heal Block's reach, Telekinesis, Embargo, Nightmare, Octolock, Attract,
  Powder, Protean per game, Roost, Burn Up, Double Shock, the gen 7 Curse glitch, Color Change.
- **F3** (F01–F143, 112 runs): Magic Coat (Prankster vs Dark, no Mold Breaker, allies), Snatch (PrepareHit −1, no
  BeforeMove), Crafty Shield, Mat Block (quarter for Z and Max), Mist after Mirror Armor (F40), Court Change, Defog,
  Magic Room's mid-turn end, the Sports' chain, Corrosive Gas, Bestow, Recycle's item history (F90–F96), Teatime and
  Stuff Cheeks' forced eat, the bench cure (F120–F126).
- **F4** (A1–A11, B1–B13, C1–C8, D, E1–E9, F1–F15, G1–G8, H1–H6b, GA1–GA5b): Opportunist's timing and amounts, the
  switch-in pipeline, Harvest and Pickup, the hidden stages, Fling's data and effects, the one-hit KO immunities,
  spread drain order, the Berserk lock's resets, and today's app against the oracle on eight cases.

**Source facts this critic read directly:**
- Skill Swap (`PS/sim/battle.ts:1311-1345`): SetAbility on the target, then the user; both Ends (the user's, then the
  target's); the swap; fresh `abilityState` for both; then the Starts, the target's first.
- `setAbility` (`PS/sim/pokemon.ts` setAbility): cantsuppress checked unless a form change; the SetAbility event unless
  Transform; the old ability's End; a fresh `abilityState`; the new ability's Start unless Transform copied the same one.
- `transformInto` (`PS/sim/pokemon.ts`): fails on a fainted target, an Illusion on either, a Substitute, either
  transformed, Eternamax, Ogerpon / Terapagos with Tera, a Stellar user; copies the species, `weighthg`,
  `getTypes(true, true)` (Roost's `typeWas` while roosted), `addedType`, the stored stats, `timesAttacked`, the moves
  (5 PP), all seven stages, the crit volatiles; `setAbility(…, true, true)`.
- `isGrounded` (`PS/sim/pokemon.ts`): Gravity, Ingrain, Smack Down, Iron Ball, then Flying, Levitate, Magnet Rise,
  Telekinesis, Air Balloon. `ignoringItem`: Embargo, Magic Room, Klutz (Fling's own Klutz check from gen 5).
- `eatItem(force)` sets `lastItem` and `usedItemThisTurn`; a forced eat skips TryEatItem.
- Opportunist (`PS/data/abilities.ts` opportunist): onFoeAfterBoost sums positive parts (copies excluded); applies at
  onAnyAfterMove, AfterMega, AfterTerastallization, SwitchIn (priority −3) and residual order 29; **onEnd deletes the
  pending copy**. Gen 9 Protean keeps `abilityState.protean`, so a fresh ability state resets it.
- Conditions: Heal Block duration 5 (Psychic Noise 2), `onResidualOrder: 20`, no onResidual (it only counts down there);
  Embargo 5 / 21; Telekinesis 3 / 19; Octolock residual 14 with `boost({def: -1, spd: -1}, target, source,
  activeMove('octolock'))`; Magic Coat onTryHit priority 2, onAllyTryHitSide skipping allies; Snatch onAnyPrepareHit;
  Swallow: a snatched use skips onTry, heals by `pokemon.volatiles['stockpile']?.layers || 1` of **the Snatch user**,
  then removes **its** Stockpile (`PS/data/moves.ts:18574-18598`); Glaive Rush: onSourceModifyDamage ×2,
  `onBeforeMovePriority: 100` removes it; Minimize: onSourceModifyDamage ×2 for its move list.
- White Herb, Eject Pack and Mirror Herb all act at onAnyAfterMove (Speed order) and at residual 29.
- The vendored engine multiplies only `defender.types[0]`, `types[1]`, then replaces both with `teraType`
  (`@smogon/calc/dist/mechanics/gen789.js:299-306`); `countBoosts` is called at `:581` (Punishment), `:609` (Stored Power,
  Power Trip) and `:812` (Lash Out), so the hidden-stage scope is set only for those three moves; the final chain is
  `chainMods(finalMods, 41, 131072)` at `:481` and `:531`.

**The critic's probes** (`critic-probes-1.out`):

| Id | Shows | Decides |
|---|---|---|
| CR01 sv | A Heal Block with 1 turn left ends at residual 20, and a Sitrus at 100/235 is eaten at the final Update (+58); with 2 left nothing; Leftovers with 1 left heals nothing (5.4 comes before 20) | C3 |
| CR02 usum | The same for Embargo at 21 | C4 |
| CR03 sv | Transform into a Garchomp set to Water with an added Grass and hit 3 times: Ditto is Water/Grass (base Water, added Grass), `timesAttacked` 3, weight 950 | C2 |
| CR04 usum | Absol (2 layers) Snatches Swalot's Swallow (1 layer): Absol heals half (to full), −2 Def −2 SpD, its Stockpile ends; Swalot keeps 1 layer and heals nothing | C1 |
| CR05 champions | Octolock into a Defiant Kingambit: −1/−1 at 14, Defiant +2 twice (+4 Atk); the Octolock user's ally Espathra (Opportunist) copies +4 Atk at 29 | C9 |
| CR06 sv | Incineroar's Entrainment gives Snorlax Intimidate mid-turn: its drop on Incineroar is stopped by Incineroar's side's Mist; Corviknight's Mirror Armor reflects its drop first, so Snorlax takes −1 | C10 |
| CR07 sv | Smack Down, then the ally's Earthquake into Skarmory: 80 (2x; control immune); Skarmory's Ingrain, then Earthquake: hit; Magnet Rise, then Earthquake: immune | C11 |
| CR08 sv | A foe's Liechi at the first Update: Espathra copies +1 Atk at the first AfterMove (control); after its ally's Gastro Acid or Skill Swap the copy is gone | C7 |
| CR09 sv | Teatime eats Trevenant's Sitrus (lastItem set); in sun, Harvest restores it; with a faster Pickup Ambipom beside it, Pickup takes the Sitrus first and Harvest fails | C8 |
| CR10 sv | Body Slam under Reflect: Minimize ×2, Glaive Rush ×2, both ×4 (a KO from 62–73); CR10b: a faster Glaive Rush holder's own Splash ends the drawback (normal damage) | C5, C6 |
| CR11 usum | Heal Bell cures a sleeping ally whose Nightmare then ends silently; it then moves; control: −58 at residual 11 | F2's Nightmare model |

### 1.2 Corrections (the spec uses these)

| # | Design | Claim | Pinned truth |
|---|---|---|---|
| C1 | F1, F3 | A snatched Swallow "heals a quarter with no Stockpile" (F1) / "reads the Snatch user's own Stockpile" (F3), the Snatch user's Stockpile untouched | It heals by the Snatch user's own layers (1 without) **and removes the Snatch user's Stockpile** (its End lowers that user's counted stages through boost()); the original user keeps its own (CR04, `PS/data/moves.ts:18584-18592`). |
| C2 | F1 | Transform's copy list; `REASONS.transformTyped` until F2's types exist | It also copies `timesAttacked` (Rage Fist reads it). World types are in the Step 0 contract, so `transformTyped` is never added: Transform copies `build.types` (or Roost's `typeWas`) and `addedType` (CR03). |
| C3 | F4 | `DoublesCarried.healBlock?: true` | The turns left decide the end of turn (CR01). F2's `healBlock?: 1 \| 2 \| 3 \| 4` and `EotState.healBlockLeft` are the contract. |
| C4 | F3 | `DoublesCarried.embargo?: true` ("its turns left do not matter within the turn") | They matter at the final Update (CR02). F2's `embargo?: 1–4` and `EotState.embargo` (turns left). |
| C5 | F4 | Glaive Rush: `MonState.glaiveRush` "until its next move" | It ends at the holder's next BeforeMove at priority 100: before sleep, freeze and flinch, and for No move too (CR10b). A carried one ends as the holder's action starts. |
| C6 | F1, F4 | A Minimize final-chain hook (F1); `withFinalMods([2])` for Glaive Rush (F4) | One hook: the defender's `takenMods` append to the final chain; Minimize and Glaive Rush stack (CR10, ×4 together). Ripen's weakened Berry (×0.5 on the next hit, `PS/data/abilities.ts` ripen) uses it too. |
| C7 | F1 | The End table has no Opportunist row | Opportunist's End deletes its pending copy (CR08). A1's End table: `opportunist → delete MonState.copy`; Mirror Herb's copy is the item's and survives an ability change. |
| C8 | F4 | Harvest and Pickup "read item history" | Both are residual 28.2, one Speed-sorted group: a faster Pickup takes the eater's `lastItem` and clears it, so Harvest then has none (CR09). Each handler reads the world's item history when it runs. |
| C9 | F2, F4 | Octolock's drop "uses the stage-events enabler" | Its boost() sets off Defiant per stat and its rise is copied at 29 by a foe's Opportunist (CR05). The end of turn keeps the moves' ledger: rises before 29 are copied at 29; a rise after 29 (the final Update) is pending into E2 (A11). Mist stops the drop (the effect is a Move, with no infiltrates). |
| C10 | F1, F3 | Mist after Mirror Armor, shown for a status move | It holds for an ability's drop as well (CR06): F3's Mist check (a non-move effect is always blocked; the infiltrates exception is a move's) is right as written, and A1's mid-turn Intimidate goes through it. |
| C11 | F2, F4 | Grounding belongs to "the grounding family" (F2) / "Family 2's grounding enabler" (F4) | Neither designed it. A2 owns it (§4.3.6): `groundingChange` and the Smack Down guard go (CR07). |
| C12 | F4 | Spread-drain mitigation: "compose x with each target's dealt marginal in turn; that is exact" | Not exact in general: the attacker's HP after the move is correlated with each target's, and a later step between two of them reads the joint. The joint (attacker, targets) is kept; the budget is the fallback; integration measures it (§4.9, §10). |
| C13 | F1 | Skill Swap: "both Ends, the swap, …, the target's Start, the user's" | The Ends run the user's first, then the target's (`PS/sim/battle.ts:1333-1334`); it matters for two Unnerve-family Ends and for which Update cures first. |
| C14 | F2, F4 | `opts.healBlocked` for the attacker (F2) and `UsesEnv.healBlocked` (F4) | No UsesEnv field. The heal-blocked target's HP Berry and the attacker's HP Berry and Shell Bell read as Leftovers in that step (the existing `psychicNoiseKeepsBerry` stand-in, `doubles-turn.ts:577-578, 1968-1984`); Cheek Pouch then eats nothing; `absorbEffect` and `pouchHeal` read `eot.healBlock` in the kernel. |
| C15 | F3 | The tracker gains `PublicMon.lastItem` | It exists: `tracker.ts:869` keeps `item = { state: "gone", itemId, how: "consumed" }` and `belief-battle.ts:163-166` sets `lastItem` from it. The bridge reads that. |
| C16 | F4 §6 | Models about 45 further census entries (Dancer, Pledges, Round, the calling moves, G-Max effects, Focus Band…) | Outside the request ("the named guards and the rest of the open list"). Tier 2, kept with their exact texts (§2.3, Q6). |

### 1.3 Conflicts resolved

**One name per state.**

| State | F1 | F2 | F3 | F4 | SPEC2 |
|---|---|---|---|---|---|
| Item has no effect | — | `itemSuppressed`, derived in calcBuild | `BattleBuild.embargoed` | — | `BattleBuild.itemSuppressed` written on the world build while `EotState.embargo` (turns left) stands |
| Form change | `withSpecies` | `formChanged` | — | — | `withSpecies(build, speciesId)` (doubles-world.ts) drops `storedStats`, `weighthg`, `types`, `addedType` |
| Hazards cleared | `hazardsCleared` | — | `hazardsFrom` | — | `SideState.hazardsFrom: null` (Tidy Up, Defog, Rapid Spin, Mortal Spin) |
| Last item input | — | — | `DoublesPokemonInput.lastItem` | `DoublesCarried.lastItem` | `DoublesPokemonInput.lastItem?: string \| null` (absent: unknown), like `lastMove` |
| Heal Block carried | — | turns 1–4 | — | `true` | turns 1–4 (C3) |
| Embargo carried | — | turns 1–4 | `true` | — | turns 1–4 (C4) |
| Heal Block in a step | — | `opts.healBlocked` | — | `UsesEnv.healBlocked` | build stand-ins (C14) |
| Final modifiers | Minimize hook | — | — | `withFinalMods` | `takenMods` (C6) |
| Grounding marker | — | `floating` | — | — | `grounding?: "pinned" \| "floating"` |
| `snatch` flag | yes | — | yes | — | one generated flag |
| Accuracy / evasion carried | `stages` | — | — | `stages` | `DoublesCarried.stages` |

**Moves two families claimed.** Stuff Cheeks (F1, F3) → A3 (F3's forced eat with Cheek Pouch and the no-effect cases).
Swallow (F1, F3) → A1 with Stockpile, plus C1. Embargo (F2, F3) → A2 (F2's turns and residual, F3's calculation gate).

**Hook order.** §4.1 is the single merged order for BeforeMove, TryMove, PrepareHit, TryHit, TryBoost, AfterMove and the
residual rows. Where two families insert at one point, the order there is Showdown's priority, then effect type, as §4.1
gives it (Crafty Shield before Magic Coat before Magic Bounce; Protean before Snatch; Clear Amulet, the holder's ability,
an ally's Flower Veil, then Mist; the AfterMove handlers by Speed).

**Who owns a shared helper.** `applyBoosts`, `writeStages`, `selfBoost` and `foeDrop` move to A1's `doubles-stages.ts`
in Step 0; Mist (A3) and the ledger (D) enter it through hooks Step 0 inserts. `forceEat` is A3's (`doubles-items.ts`);
D's flung-Berry eat calls it with a `flung` flag. `abilityStart` is A1's; R's entry pipeline calls it. The settle
(`calculate.ts settleDoublesStart`) calls D's `doubles-start.ts` for Imposter, the start Starf and the start copies.

**World growth.** Every new field of `MonState`, `SideState`, `FieldState` and the build enters `discreteKey` through
`mons`, `sides` and `field`; the new `World` fields (`fieldSet`) are added to it. The readers rule (§4.9) keeps fields off
the worlds that have no later reader, so turns without the new mechanics keep today's world counts.

---

## 2. Scope

### 2.1 Product

- **2v2 turn.** All 73 moves are estimated (§2.2), with their step, hit and condition facts (§5.1). The guards of §2.3 go.
- **End of turn.** New residual rows (Nightmare, Octolock, the Telekinesis / Heal Block / Embargo countdowns, Harvest,
  Pickup, the copies at 29) and the items and heals that come back when Heal Block, Embargo or Magic Room end.
- **E2 outcomes** (`calculateDoublesOutcomes`): the new state the next turn reads (§3.1).
- **State from earlier turns.** Training: all of §3.1's carried fields from public information (§6). The calculator: the
  Q2 controls.
- **1v1:** unchanged, except the verified Fling fix (Track F).

### 2.2 The 73 status moves: final kinds

"Owner" is the wave 1 track (§8). "Reason left" is the exact text the move can still give; "—" means none. Every
"Assumes …" fact is a turn fact (§2.5), not a guard. The design sections give the full mechanics; §4 says where this spec
changes them.

| Move | Games | Kind | Owner | Model (design §) | Reason left |
|---|---|---|---|---|---|
| acupressure | sv ch swsh usum | M | A1 | one world per stat below +6 (accuracy and evasion included), 1/n each, applyBoosts +2 (F1 §4.1) | — |
| psychup | all four | M | A1 | writeStages of all seven and the crit volatiles; White Herb at AfterMove; no ledger entry (F1 §4.1) | — |
| powerswap, guardswap | all four | M | A1 | writeStages swap (F1 §4.1) | — |
| heartswap | sv usum | M | A1 | writeStages swap of all seven | — |
| speedswap | all four | M | A1 | `storedStats.spe` swap; the gen 8+ re-sort follows (F1 §4.2) | — |
| powersplit, guardsplit | all four | M | A1 | `storedStats` floor averages (F1 §4.2) | — |
| powertrick | all four | M | A1 | `storedStats` Atk/Def swap, `vol.powerTrick` toggles; carried (F1 §4.2) | — |
| powershift | ch | M | A1 | as Power Trick (no Champions species learns it) | — |
| topsyturvy | all four | M | A1 | writeStages negation (F1 §4.1) | — |
| stockpile | all four | M | A1 | +1/+1 through applyBoosts with the counters kept; carried layers (F1 §4.1) | — |
| swallow | all four | M | A1 | heal `modify(maxhp, [0.25, 0.5, 1][layers − 1])`, then the Stockpile End; snatched per C1 | — |
| tidyup | sv ch | M | A1 | Substitutes removed, `hazardsFrom: null` on both sides, +1 Atk +1 Spe | — |
| noretreat | sv ch swsh | M | A1 | +1 to all five, the volatile unless trapped; carried | — |
| autotomize | swsh usum | M | A1 | Spe +2, `weighthg − 1000` (at least 1) | — |
| minimize | all four | M | A1 | evasion +2; `vol.minimize` → `takenMods.minimize` (C6) | — |
| geomancy | swsh usum | M | A1 | Power Herb: the boosts now; else the charge turn; a carried charge releases | — |
| gearup | swsh usum | M | A1 | the Plus and Minus holders of the user's side +1 Atk +1 SpA | — |
| magneticflux | all four | M | A1 | as Gear Up, Def and SpD | — |
| flowershield | swsh usum | M | A1 | each active Grass type +1 Def, in getAllActive order | — |
| rototiller | usum | M | A1 | each grounded Grass type +1/+1; an airborne Pokémon is immune | — |
| skillswap | all four | C | A1 | `skillSwap` (C13) with the Start and End tables (F1 §3.4) | `{Ability} starting on {Name} is not modelled in 2v2.` (Supreme Overlord; Forecast on Castform; Flower Gift on Cherrim); `{Move} with Neutralizing Gas is not modelled in 2v2.` (Q5) |
| roleplay | all four | C | A1 | `setAbility(user, the target's)` | as Skill Swap |
| entrainment | all four | C | A1 | `setAbility(target, the user's)`; a given Intimidate meets Mist and Mirror Armor (C10) | as Skill Swap |
| simplebeam | all four | C | A1 | `setAbility(target, "simple")`; the old ability's End acts (SA16) | `{Ability} ending on {Name} is not modelled in 2v2.`; withGas |
| worryseed | all four | C | A1 | `setAbility(target, "insomnia")`; a sleeper is cured at the Update | as Simple Beam |
| gastroacid | all four | C | A1 | GAS_STAND_IN with `vol.gastroAcid`; the old ability's End (C7) | as Simple Beam |
| doodle | sv | C | A1 | the user and its ally get the target's ability, each with its Start | as Skill Swap |
| transform | all four | C | A1 | `transformBuild` (F1 §3.5 with C2); its ability's Start when it differs | `Transform into a Dynamaxed {Name} is not modelled in 2v2.` (SwSh); abilityStart; withGas |
| soak | all four | M | A2 | `setTypes(["Water"])` (F2 §3.1) | — |
| magicpowder | sv ch swsh | M | A2 | `setTypes(["Psychic"])`; the powder flag (F2 §3.2) | — |
| forestscurse | all four | M | A2 | `addType("Grass")` (F2 §3.3) | — |
| trickortreat | ch swsh usum | M | A2 | `addType("Ghost")`; the gen 7 Curse glitch (F2 §3.4) | — |
| reflecttype | all four | M | A2 | the base types and the added type copied (F2 §3.5) | — |
| conversion | sv swsh usum | C | A2 | the first move slot's dex type (F2 §3.6) | `Conversion needs {Name}'s first move.` |
| conversion2 | sv swsh usum | C | A2 | one world per resisting type the user lacks, 1/n (F2 §3.7) | `Conversion 2 needs {Name}'s move from the last turn.` (existing); `Conversion 2 needs the type of {Name}'s last move.` |
| camouflage | usum | M | A2 | the terrain's type, else Normal | — |
| electrify | ch swsh usum | C | A2 | `MoveContext.retype`; `statusType` (F2 §2.3, §3.9) | `{Move} with Electrify is not modelled in 2v2.` (own-type moves, Z-Moves, Max Moves) |
| iondeluge | usum | C | A2 | `FieldState.ionDeluge` (F2 §3.10) | `{Move} with Ion Deluge is not modelled in 2v2.` |
| tarshot | sv swsh | M | A2 | Spe −1; `vol.tarShot` → +1 on the first type (F2 §3.11) | — |
| foresight, odorsleuth | usum | M | A2 | `vol.revealed = "foresight"` (F2 §3.12) | — |
| miracleeye | usum | M | A2 | `vol.revealed = "miracleeye"` (F2 §3.13) | — |
| telekinesis | usum | M | A2 | `eot.telekinesis` 3; grounding `floating`; ends at 19 (F2 §3.14, §4.3.6) | — |
| embargo | usum | M | A2 | `itemSuppressed` with `eot.embargo` 5, ends at 21 (C4); F3's calculation gate (F3 §5.4.6) | — |
| healblock | usum | M | A2 | `eot.healBlock`, `healBlockLeft` 5; stand-ins in later steps (C14); ends at 20 (C3) | — |
| nightmare | usum | M | A2 | `eot.nightmare`; residual 11, a quarter; ends with the sleep (CR11) | — |
| octolock | ch swsh | M | A2 | `eot.octolock`; the residual-14 boost() through the ledger (C9) | — |
| attract | all four | C | A2 | `vol.attract`; BeforeMove 2, 1/2 (F2 §3.19) | `Attract needs {Name}'s gender.` |
| captivate | usum | C | A2 | SpA −2 into the opposite-gender foes (F2 §3.20) | `Captivate needs {Name}'s gender.` |
| powder | usum | M | A2 | `vol.powder`; TryMove −1 (F2 §3.21) | — |
| magiccoat | swsh usum | M | A3 | `vol.magicCoat` with its Prankster flag; the bounce path (F3 §5.1.1) | — |
| snatch | usum | M | A3 | `vol.snatch`; four PrepareHit dispatch points (F3 §5.1.2); Swallow per C1 | — |
| craftyshield | swsh usum | M | A3 | `SideState.craftyShield` (F3 §5.2.1) | — |
| matblock | swsh usum | M | A3 | `SideState.matBlock`; Z and Max at a quarter; the first-turn rule as the existing turn fact (F3 §5.2.2) | — |
| luckychant | usum | M | A3 | `SideState.luckyChant`: no critical hit into the side (F3 §5.2.3) | — |
| mist | sv swsh usum | M | A3 | `SideState.mist` in applyBoosts after Mirror Armor, and in the step (F3 §5.2.4) | — |
| mudsport, watersport | usum | M | A3 | `FieldState` flags; ×1352/4096 in the power chain (F3 §5.3.3) | — |
| magicroom | all four | C | A3 | toggle, `fieldSet`, the room-end Update (F3 §5.3.1) | `Booster Energy after Magic Room ends is not modelled in 2v2.` (SV) |
| wonderroom | all four | M | A3 | toggle, `fieldSet` (F3 §5.3.2) | — |
| courtchange | sv ch swsh | M | A3 | side flags, their clocks and the hazards swapped (F3 §5.2.5) | — |
| defog | all four | C | A3 | evasion −1; screens, Safeguard, Mist and hazards cleared; the gen 8+ terrain end (F3 §5.2.6) | `A weather or terrain change this turn would change {Name}.` (existing; a terrain-settled holder) |
| corrosivegas | ch swsh | M | A3 | takeItem per target; `World.itemsTaken` (F3 §5.4.1) | — |
| bestow | usum | M | A3 | `give`, Trick's one-way half (F3 §5.4.2) | — |
| recycle | all four | C | A3 | item history (F3 §5.4.3) | `Recycle needs {Name}'s item from an earlier turn.` |
| teatime | sv ch swsh | M | A3 | `forceEat` per Pokémon; Ripen's weakened Berry via `takenMods` (F3 §5.4.4) | — |
| stuffcheeks | sv ch swsh | M | A3 | Def +2, then `forceEat` (F3 §5.4.5) | — |
| aromatherapy | swsh usum | M | A3 | `teamCure`, the bench included (`benchCured`) (F3 §5.5.1) | — |
| healbell | all four | M | A3 | `teamCure` (gen 7: Soundproof checked on everyone) | — |
| purify | swsh usum | M | A3 | cure the target, heal `ceil(maxhp/2)` (F3 §5.5.3) | — |
| psychoshift | swsh usum | M | A3 | setStatus on the target, then cure the user (F3 §5.5.2) | — |

Counts: A1 22 M + 8 C, A2 16 M + 6 C, A3 18 M + 3 C: **56 M, 17 C, 0 L.** The classification lives in three fragments
that the generator merges (§3.4): `status2/build/classify-a1.md`, `classify-a2.md`, `classify-a3.md`.

Damaging moves that read the new state (no kind of their own): Spit Up (Stockpile; `MoveContext.stockpile`), the
minimize-flag moves (`takenMods`), Low Kick, Grass Knot, Heavy Slam and Heat Crash (`weighthg`), Foul Play and Body Press
(`storedStats`), Stored Power, Power Trip and Punishment (hidden stages), Fling (F, D), the one-hit KO moves (D),
Synchronoise and Natural Gift (A2's combo reasons), Rage Fist (`timesAttacked`, copied by Transform).

### 2.3 The narrow guards (census-guards' 101 entries)

**Modelled in this build** (45 entries, wholly or for the part named; with Q1's alternatives R0 or K the switch family's
nine stay in the calculator):

| Entry | Owner | How |
|---|---|---|
| copies-rise (Opportunist, Mirror Herb) | D, E | the ledger with amounts; copies at AfterMove, at 29, at a SwitchIn (R), pending into E2 (F4 §4.1 with C7, C9) |
| harvest, pickup | E | item history; 28.2 handlers in Speed order (F4 §4.2, §4.3 with C8) |
| hidden-stages | D | `MoveContext.hiddenStages` and the countBoosts scope (F4 §4.4) |
| fling | F, D | the verified 1v1 fix, then the 2v2 loss and effects (F4 §4.5) |
| ohko | D | `ohkoStep`: a fixed full-HP hit (F4 §4.6) |
| spread-heal | D | composition in hit order (F4 §4.7 with C12) |
| the switch family (9 entries) | R (wave 2) | the replacement (F4 §5.4; Q1) |
| berry-locked, psychic-noise, starf-random, trace-curing-ability, ghost-curse-ko-chance, perish-projection, eot-white-herb-lansat-text, comatose-order | D, E, A2, Step 1, V | FINAL.md's open list (F4 §2–§4) |
| l-moves (73) | A1, A2, A3 | §2.2 |
| hp-status-moves | A1, A3 | Purify, Stuff Cheeks, Swallow, Teatime estimated; Revival Blessing (P) keeps `{Move} is not modelled.` |
| bestow-recycle | A3 | Bestow modelled; Recycle's one narrow reason |
| needs-last-move, encore-change | U, D | the Last move control (Q3); an Encore that changes a queued move: the encored move at the old priority, at a uniform random legal target (F4 §6) |
| grounding-change, smackdown-later | A2 | the grounding enabler (§4.3.6) |
| roost-type, type-change-protean, type-change-burnup, ate-redirect | A2 | world types (F2 §4) |
| gas-changing-moves (Magic Room, Corrosive Gas, Bestow, Embargo) | integrator | out of `GAS_CHANGING_MOVES`; `gasShieldGuard`, extended to read `itemSuppressed`, catches every Ability Shield change (F3 decision 5) |
| glaive-rush | D | `vol.glaiveRush` → `takenMods.glaiveRush`; ends per C5 |
| ripen-stolen | D | `vol.berryWeaken` → `takenMods.berryWeaken` (×0.5 on the next damaging hit into it) |
| symbiosis | D | item history: at an item used (not taken: `World.itemsTaken`, `itemsMoved`) the partner's item moves (F4 §6) |
| eot-liquidooze-healblock | E | the faster holder's handler first; a tie 1/2 (F4 §4.16) |
| eot-moody-starf-e2 (its Starf part) | E | an E2 branch over the open stats; Moody stays |
| settle-imposter | D (F1's rule) | transformed into the foe across at the start (F1 §4.3; Q8) |
| tr-volatiles, tr-ability-changed, tr-carried (their new parts) | T | §6 |

**Kept, with their exact texts (Tier 2, Q6), 56 entries** (gas-changing-moves' eight ability moves and Moody are the kept
parts of two entries counted above): semi-invulnerable (0.16 % of the Champions sample),
volatile-secondaries (Core Enforcer, Burning Jealousy, Alluring Voice, Spectral Thief), spread-effect (0.36 %),
spread-contact-ko, ally-effect (0.36 %), redirect-tie (the switch-in order is not an input), unnerve-resist (0.14 %),
unnerve-recoil, cotton-down, flower-pastel-veil, battle-bond, aftermath-innardsout, receiver-alchemy, face-guards,
focus-band, berry-between-hits, aria-faint, gale-wings-gen7, assurance-own-hp, gmax-effects, gas-ends-shield, the eight
ability moves under Neutralizing Gas (Q5), the seven presence entries (Commander, Poison Puppeteer, Dancer, the presence
moves, the calling moves, the Pledges, Custap with Quick Draw or Mycelium Might), darts-aim-self, received-item,
into-substitute, sub-per-hit, eot-landing, eot-cudchew, Moody (E2), eot-overtime, eot-form-change, settle-trace-random,
settle-two-act, settle-download, the three row entries, needs-moves, pain-split-dynamax, face-self-hit,
sleep-talk-uproar, safeguard-damaging-status, helping-hand-twice, unburden-start-berry, field-change, activates,
tr-field-side, tr-moves-state, tr-splits-prelude, and the budgets (too-many, engine-error).

### 2.4 REASONS deltas (`doubles-actions.ts`; exact text)

**Added** (Step 0 writes every key; a track starts calling it):

```ts
  // status2 SPEC2 §2.4
  /** A1: an ability Start the turn does not follow (Supreme Overlord; Forecast on Castform, Flower Gift on Cherrim). */
  abilityStart: (ability: string, name: string) => `${ability} starting on ${name} is not modelled in 2v2.`,
  /** A1: an ability End it does not follow (Zen Mode, Illusion: Gastro Acid where the game allows it). */
  abilityEnd: (ability: string, name: string) => `${ability} ending on ${name} is not modelled in 2v2.`,
  /** A1, SwSh: Transform into a Dynamaxed target. */
  transformMax: (name: string) => `Transform into a Dynamaxed ${name} is not modelled in 2v2.`,
  /** D (the settle, F1's rule): an Imposter holder whose slot across is empty. */
  imposterAcross: (name: string) => `${name}'s Imposter with no Pokémon across is not modelled in 2v2.`,
  /** A2: Electrify or Ion Deluge on a move whose type is set as it is used, a Z-Move or a Max Move ("Electrify", "Ion
   *  Deluge"); Synchronoise from a two-type user with an added type ("an added type"); Natural Gift with "Embargo" or
   *  "Heal Block". */
  combo: (move: string, what: string) => `${move} with ${what} is not modelled in 2v2.`,
  /** A2: Conversion with no move-slot order. */
  needsFirstMove: (name: string) => `Conversion needs ${name}'s first move.`,
  /** A2: Conversion 2 when the last move's type as used is not known (an own-type move, a Z-Move or Max Move last turn). */
  needsLastMoveType: (move: string, name: string) => `${move} needs the type of ${name}'s last move.`,
  /** A2: Attract or Captivate between species that can be either gender, with no gender set. */
  needsGender: (move: string, name: string) => `${move} needs ${name}'s gender.`,
  /** A3 Recycle (the moves), E Harvest (the end of turn): the item it used before this turn is not known. */
  needsLastItem: (move: string, name: string) => `${move} needs ${name}'s item from an earlier turn.`,
  /** A3, SV: a Protosynthesis or Quark Drive holder of Booster Energy whose field is down when Magic Room ends. */
  boosterAfterRoom: "Booster Energy after Magic Room ends is not modelled in 2v2.",
  /** D: a flung Custap Berry with a later action of its target. */
  flungCustap: (name: string) => `Custap Berry flung at ${name} is not modelled in 2v2.`,
```

Under R, Step 2 adds:

```ts
  /** R: a Neutralizing Gas holder that comes in mid-turn (the other Pokémon's abilities would end). */
  entersWithGas: (name: string) => `${name}'s Neutralizing Gas coming in is not modelled in 2v2.`,
```

`needsLastMove` is reused by Conversion 2; `notIn2v2("Commander")` and `fieldChange` are reused by R's newcomers.

**Removed** (each by the track that models it; a key goes with its last site):
- `notModelledBefore` (no L move is left) and the L branch of `statusMove` (`doubles-status.ts:778-786`), with its
  end-of-turn `notModelled` use;
- `typeChange` (four sites), `groundingChange` (two), `copiesRise` (four), `hiddenStages`, `spreadHeal`, `berryLocked`
  (two), `takesDouble`;
- the `notIn2v2` sites for Psychic Noise (`volatileGuard`), an -ate ability on a status move (`doubles-status.ts:1066`),
  Smack Down and Thousand Arrows (`doubles-turn.ts:2309`), Ripen (`:2211`), Symbiosis (three sites), Liquid Ooze
  (`doubles-eot.ts:668`), Harvest and Pickup (`:218-221, 804, 817`), Starf at an end-of-turn Update (`:924`), Imposter and
  the start Starf (the settle);
- `notModelled` for Purify, Stuff Cheeks, Swallow, Teatime, Bestow and Recycle (`HP_STATUS_MOVES`, `bestowActs`);
- `withGas` for Magic Room, Corrosive Gas, Bestow and Embargo;
- in 2v2 only: the rows' "Fling is not verified …" (after F) and "One-hit KO move: no damage range." (1v1 keeps it);
- under R: `switchesOut` (K and R0 keep it for the calculator).

Kept: `notModelled` (Revival Blessing), `fieldChange`, `gasEnds`, `gasShield`, `withGas` (eight ability moves),
`berryBetweenHits`, `focusBand`, `allyEffect`, `spreadEffect`, `semiInvulnerable`, `faceMultiHit`, the Track E texts,
`tooMany`.

### 2.5 Turn facts (`DoublesTurnResult.facts`; each only when it applies)

New, each an assumption about earlier turns that the input does not give:
- `Assumes {Name} has not stockpiled.`: its move is Stockpile, Swallow or Spit Up, and there is no `carried.stockpile`.
- `Assumes {Name} has no Power Trick from an earlier turn.` (Power Shift likewise): its move is Power Trick.
- `Assumes {Name} has not used No Retreat.`: its move is No Retreat.
- `Assumes {Name} did not charge Geomancy last turn.`: its move is Geomancy (SwSh, USUM).
- `Assumes {Name} has not used Minimize.`: a minimize-flag move (Body Slam, Dragon Rush, Flying Press, Heat Crash, Heavy
  Slam, Malicious Moonsault, Steamroller, Stomp, Supercell Slam) can reach it, and there is no `carried.minimize`.
- `Assumes {Imposter} transformed into {Target} as both entered.`: an Imposter holder at the start (Q8).
- `Assumes {Name} has not had {Ability} before in this battle.`: Intrepid Sword, Dauntless Shield or Supersweet Syrup
  gained mid-turn by a Pokémon that did not start the turn with it (Q12).
- `Assumes {Move} is {Name}'s first move.`: the calculator's Conversion (its first quick move; Q11).
- `Assumes no Pokémon Terastallizes or Mega Evolves this turn.`: a start copy is pending and a Tera build or a Mega form
  is in the turn (F4 §4.1).
- Only with Q3's or Q4's alternative default: `Assumes {Name} used no move before this turn.`,
  `Assumes {Name} used no item before this turn.`
- Under R: `Assumes {Newcomer} comes in for {Name}.` (the Replacement left at its default).

Removed: none. `Assumes Magic Room does not end this turn.` is no longer given for a room set this turn (`fieldSet`).

---

## 3. Contract (paste-ready; Step 0 writes all of it)

Every field below is optional and set only by the 2v2 turn, Training's bridge or a 2v2 calculator control: no 1v1 input
and no Step 0 world sets one, which is what keeps Step 0's gates byte-equal.

### 3.1 `app/lib/battle/doubles-types.ts`

```ts
export type DoublesCarried = {
  /* …existing: sleep, freeze, confusion, toxic, leechSeed, trap, saltCure, aquaRing, ingrain, curse, syrupBomb, yawn, perish,
     wish, futureMove, cudChew, substitute, allySwitch… */

  // ---- A1: stats, abilities, Transform ----
  /**
   * Stockpile from earlier turns: 1–3 layers and the counted Defense and Sp. Def changes its End reverses
   * (PS/data/moves.ts:17961-18008 effectState.def / spd: −1 per layer that raised the stat, +1 per layer Contrary lowered it).
   */
  stockpile?: { layers: 1 | 2 | 3; def: number; spd: number };
  /** Power Trick (Power Shift) from an earlier turn: its stored Attack and Defense are swapped. */
  powerTrick?: true;
  powerShift?: true;
  noRetreat?: true;
  minimize?: true;
  /** Gastro Acid from an earlier turn: the build's ability (its real one) is suppressed. */
  gastroAcid?: true;
  /** Geomancy charged last turn: this turn's Geomancy is the release (no charge). */
  charging?: "geomancy";
  /** The trapped volatile (Block, Mean Look, Spider Web, Jaw Lock, Anchor Shot, Spirit Shackle, Thousand Waves): No Retreat then adds no volatile. */
  trapped?: true;
  /** Accuracy and evasion stages from earlier turns, −6..6. */
  stages?: { accuracy?: number; evasion?: number };

  // ---- A2: types and volatiles ----
  tarShot?: true;
  /** Foresight or Odor Sleuth; Miracle Eye (never both). */
  foresight?: true;
  miracleEye?: true;
  /** Turns left before this end of turn's countdown; 1: it ends at this end of turn (Telekinesis 19, Heal Block 20, Embargo 21). */
  telekinesis?: 1 | 2;
  healBlock?: 1 | 2 | 3 | 4;
  embargo?: 1 | 2 | 3 | 4;
  nightmare?: true;
  /** The Pokémon at this slot set it: Octolock's source is a foe; Attract's any other Pokémon in the turn. */
  octolock?: DoublesSlotId;
  attract?: DoublesSlotId;

  // ---- D: guards ----
  /** An Opportunist or Mirror Herb copy pending from the last turn's final Update (effectState.boosts): applied at this turn's first AfterMove. */
  copy?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe" | "accuracy" | "evasion", number>>;
  /** Berserk or Anger Shell: its healing Berry's TryEatItem fails until a reset (abilityState.checkedBerserk false). */
  berryLocked?: true;
  /** Glaive Rush last turn: the damage it takes is doubled until its own next BeforeMove (C5). */
  glaiveRush?: true;
  /** Ripen ate a resist Berry outside a hit: its next damaging hit taken is halved (abilityState.berryWeaken). */
  berryWeaken?: true;
};

export type DoublesPokemonInput = {
  /* …existing: build, contexts, charged, action, carried, lastMove… */
  /** Every move it has, in move-slot order (Imprison reads its user's, Conversion the first): the calculator's quick moves, Training's moveSlots. Absent: unknown. */
  moves?: readonly string[];
  /** The item it last used or ate (pinned pokemon.lastItem: Recycle, Harvest); null: none; absent: unknown. */
  lastItem?: string | null;
};

export type DoublesOutcomeMon = {
  /* …existing: hp, build (now with storedStats, weighthg, types, addedType, itemSuppressed, abilityChanged), protected,
     moved, volatiles, sleepTurns, perishCount, substitute, allySwitch… */
  /** Stockpile after the turn; present exactly when volatiles has "stockpile". */
  stockpile?: { layers: number; def: number; spd: number };
  /** Accuracy and evasion stages after the turn; absent when both are 0. */
  stages?: { accuracy?: number; evasion?: number };
  /** A transformed Pokémon's moves (its target's); present exactly when volatiles has "transform". */
  moves?: string[];
  /** An Opportunist or Mirror Herb copy still pending after the final Update (A11). */
  pendingCopy?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe" | "accuracy" | "evasion", number>>;
  /** The item it last used or ate this turn or before (item history; only when tracked). */
  lastItem?: string;
  berryLocked?: true;
  berryWeaken?: true;
  /** Turns left after this turn's countdown. */
  turnsLeft?: Partial<Record<"healblock" | "embargo" | "telekinesis", number>>;
};
// DoublesOutcomeMon.volatiles gains: "stockpile", "powertrick", "powershift", "noretreat", "minimize", "gastroacid",
// "transform", "trapped", "twoturnmove", "geomancy", "attract", "octolock", "tarshot", "foresight", "miracleeye",
// "telekinesis", "embargo", "nightmare", "glaiverush" ("healblock" exists).

// DoublesOutcome.sides[side] gains:
//   mist?: boolean; luckyChant?: boolean;
//   /** The clock each condition up on this side now runs on: absent key, this side's own pre-turn clock; "set", set this turn. */
//   clock?: Partial<Record<SideClockFlag, DoublesSideId | "set">>;
//   /** The pre-turn hazards this side holds now: absent its own; the other side's after an odd number of Court Changes; null once cleared. */
//   hazardsFrom?: DoublesSideId | null;
//   /** Aromatherapy or Heal Bell cured this side's Pokémon not in battle. */
//   benchCured?: true;
// DoublesOutcome gains:
//   /** Rooms, Sports, Gravity and Trick Room up now and set during this turn (a fresh duration). */
//   fieldSet?: Partial<Record<"magicRoom" | "wonderRoom" | "trickRoom" | "gravity" | "mudSport" | "waterSport", true>>;
// DoublesOutcome.field also picks "mudSport" | "waterSport".
export type SideClockFlag = "reflect" | "lightScreen" | "auroraVeil" | "tailwind" | "safeguard" | "mist" | "luckyChant";
```

**`validate()` / `carriedIssues()` issues** (as `{Name}: …` on the slot, never a crash): `stockpile` layers outside 1–3
or counters outside −layers..layers; `stages` outside −6..6; `powerShift` outside Champions; `geomancy`, `telekinesis`,
`embargo`, `foresight`, `miracleEye`, `nightmare`, `tarShot`, `octolock`, `attract` in a game without the move
(`"Tar Shot is not in this game."` and the like); `foresight` with `miracleEye` (`"Foresight and Miracle Eye cannot both
be on it."`); `nightmare` without the Asleep status or Comatose (`"Nightmare needs the Asleep status or Comatose."`);
`octolock` from a Pokémon that is not a foe in the turn (`"Octolock's source is not a foe in the turn."`); `attract` from
a Pokémon not in the turn or of the same gender (`"Attract's source is not in the turn."`, `"Infatuation needs opposite
genders."`); `healBlock` outside 1–4 (`"Heal Block lasts 1 to 4 more turns."`); `gastroAcid` on a cantsuppress ability;
`berryLocked` without Berserk or Anger Shell and a healing Berry; `berryWeaken` without Ripen; `copy` with a stat at 0 or
below; `lastItem` not a catalog item.

### 3.2 `app/lib/battle/types.ts`

```ts
// BuildBase (beside transformedFrom, focusEnergy, dragonCheer):
  /** Set only by the 2v2 turn, Training and a 2v2 calculator control: its types after a setType (Soak, Magic Powder,
   *  Reflect Type, Conversion, Conversion 2, Camouflage, Protean, Libero, Color Change, Burn Up, Double Shock, Transform).
   *  One or two of the game's type names, or "???"; never Stellar. Absent: its species'. A form change drops it. */
  types?: string[];
  /** Forest's Curse or Trick-or-Treat (sim/pokemon.ts addedType). Terastallizing clears it. */
  addedType?: "Grass" | "Ghost";
  /** Its stored stats (Showdown storedStats) when they are not the build's own: Power Split, Guard Split, Speed Swap,
   *  Power Trick, Power Shift, Transform. HP is never in it. A form change drops it. */
  storedStats?: Record<"atk" | "def" | "spa" | "spd" | "spe", number>;
  /** Its weight in hectograms when not the species' (Autotomize, Transform). A form change drops it. */
  weighthg?: number;
  /** Its ability is not its species' own (Skill Swap, Role Play, Entrainment, Simple Beam, Worry Seed, Doodle): validateBuild accepts any supported catalog ability. */
  abilityChanged?: true;
  /** Its item has no effect (Embargo: sim/pokemon.ts ignoringItem); it can still be taken, and Knock Off still gets 1.5x. */
  itemSuppressed?: true;
  // ---- calculation-only markers: the 2v2 turn's calcBuild derives them from the world; no input carries them ----
  /** Final modifiers on the damage it takes (C6): Minimize ×2 for the minimize-flag moves, Glaive Rush ×2, Ripen's weakened Berry ×0.5 (first hit). */
  takenMods?: { minimize?: true; glaiveRush?: true; berryWeaken?: true };
  tarShot?: true;
  revealed?: "foresight" | "miracleeye";
  /** sim/pokemon.ts isGrounded overrides: "pinned" (Smack Down, Ingrain: before the Flying check), "floating" (Magnet Rise, Telekinesis: after Levitate). */
  grounding?: "pinned" | "floating";

// MoveContext:
  /** Set only by the 2v2 turn: Spit Up's Stockpile layers (base power 100 × layers). */
  stockpile?: 1 | 2 | 3;
  /** Set only by the 2v2 turn: Electrify on the user, or Ion Deluge on the field (the move becomes Electric after its ModifyType chain). */
  retype?: "electrify" | "iondeluge";
  /** Set only by the 2v2 turn: the positive accuracy and evasion stages its power counts (Stored Power and Power Trip: the user's; Punishment: the target's). */
  hiddenStages?: number;

// BattleConditions ("Doubles turn only"):
  mudSport?: boolean; waterSport?: boolean; ionDeluge?: boolean;
// SideConditions ("Doubles turn only"):
  mist?: boolean; luckyChant?: boolean;
  /** Mat Block on the side, for a Z-Move or Max Move only (the quarter and its text): the protection's name. */
  protectName?: string;
```

`validateBuild` (model.ts:345) adds: `types` 1–2 distinct names of the game's chart or "???" (`"Types are one or two of
this game's types."`); `addedType` only in games with Forest's Curse or Trick-or-Treat and not with `mechanic: "tera"`
(`"An added type is Grass or Ghost."`, `"A Terastallized Pokémon has no added type."`); neither on Arceus or Silvally;
`storedStats` positive integers; `weighthg` ≥ 1; `itemSuppressed` only with an item.

### 3.3 `app/lib/battle/doubles-world.ts` (internal)

```ts
// MoveVolatiles gains (one writer each, as marked; values immutable):
  // A1
  stockpile?: { layers: 1 | 2 | 3; def: number; spd: number };
  powerTrick?: true; powerShift?: true; noRetreat?: true; minimize?: true;
  /** Gastro Acid: its real ability (the build holds GAS_STAND_IN). */
  gastroAcid?: string;
  charging?: "geomancy";
  trapped?: true;
  // A2
  /** Infatuated by the Pokémon that started the turn in this slot. */
  attract?: DoublesSlotId;
  tarShot?: true;
  revealed?: "foresight" | "miracleeye";
  /** This turn only. */
  electrify?: true; powder?: true;
  /** Gen 7: a type given at Showdown position 1 with its Curse queued (PS/data/moves.ts:19928-19934). */
  curseGlitch?: true;
  /** The type its move had as used this turn (kept only while a Conversion 2 user is in the turn). */
  usedType?: string;
  // A3
  magicCoat?: { prankster: boolean }; snatch?: true;
  // D
  glaiveRush?: true; berryWeaken?: true;

// EotState gains:
  nightmare?: true;                                   // A2
  octolock?: DoublesSlotId;                           // A2
  /** Turns left before this end of turn's countdown. */
  telekinesis?: number; embargo?: number;             // A2
  /** With healBlock: turns left before this end of turn's countdown (Psychic Noise this turn 2, Heal Block 5). */
  healBlockLeft?: number;                             // A2

// MonState gains:
  /** Item history (D's writers in the kernel; kept only while ctx.tracksItems): pokemon.lastItem and usedItemThisTurn. */
  lastItem?: string; usedItem?: true;
  /** Opportunist or Mirror Herb: the copy accumulated since its last application (effectState.boosts). */
  copy?: { stages: Partial<Record<Stage, number>>; by: "opportunist" | "mirrorherb" };

// SideState gains (absent = off, so Step 0's worlds and E2 outcomes are unchanged; outcomeOf emits each only when set):
  craftyShield?: true; matBlock?: true;               // A3, this turn only
  mist?: true; luckyChant?: true;                     // A3
  clock?: Partial<Record<SideClockFlag, DoublesSideId | "set">>;   // A3 (and fieldMove's screens and Tailwind)
  /** The pre-turn hazards this side holds now (DoublesOutcome.sides.hazardsFrom). */
  hazardsFrom?: DoublesSideId | null;                 // A1 Tidy Up, A3 Defog / Court Change, kernel Rapid Spin / Mortal Spin (Step 1)
  benchCured?: true;                                  // A3

// FieldState = Pick<BattleConditions, "weather" | "terrain" | "gravity" | "trickRoom" | "wonderRoom" | "magicRoom" | "mudSport" | "waterSport" | "ionDeluge">
// (the three new keys absent unless set; outcomeOf drops ionDeluge, which ends with the turn).

// World gains:
  /** Rooms, Sports, Gravity and Trick Room set during this turn and up now (A3; fieldMove's Trick Room and Gravity). */
  fieldSet?: Partial<Record<"magicRoom" | "wonderRoom" | "trickRoom" | "gravity" | "mudSport" | "waterSport", true>>;
  /** During one action: the Pokémon whose item a takeItem removed (no Symbiosis); cleared after the action, as itemsMoved. */
  itemsTaken?: DoublesSlotId[];
// World.boosted's entries become { rose?: Partial<Record<Stage, number>>; fell?: true; reset?: true } (rose: the summed
// positive parts of every boost() table that reached it in the action, after ChangeBoost, the cap and TryBoost); its
// truthiness keeps today's readers.

/** setSpecies' resets (PS/sim/pokemon.ts:1387-1420): every engine form change goes through it; Transform does not. */
export function withSpecies(build: BattleBuild, speciesId: string): BattleBuild {
  const { storedStats: _s, weighthg: _w, types: _t, addedType: _a, ...rest } = build;
  return { ...rest, speciesId };
}
```

`cloneWorld` copies `fieldSet` and `itemsTaken`; `discreteKey` adds `fieldSet`; `startWorld` (`doubles-turn.ts:842-845`)
sets `mist` and `luckyChant` only from the input's side conditions. **Every new field of every state object is absent until
set**: that is what keeps `discreteKey`, the merges and every E2 outcome of Step 0 byte-equal.

### 3.4 `app/lib/battle/status-table.ts` and its generator

- `StatusFlags` gains `"snatch"` (generated for every game; F3 §3.4's per-game lists).
- The generator moves to `scripts/.cache/calc-audit/status2/build/gen-status-table.ts` (a copy of
  `status-eot/build/track-a-gen-status-table.ts`). It reads `status-eot/design/spec-classify.md`, then the three status2
  fragments (`| move | kind |` rows; a later fragment wins; a move in two fragments is an error), and the HANDLERS and
  FAILS keys of §2.2 (F1 §4, F2 §3, F3 §3.4).
- Step 0 generates the table with every handler, fails key and flag, **and every kind still L** (the fragments are empty).
  A track's fragment flips its moves; the integrator regenerates the merged table.
- `tests/source/doubles-status-moves.test.ts` checks the flag, keys and kinds per game.

### 3.5 Step 0's module layout and hooks (behaviour unchanged)

Step 0 moves today's code **verbatim** into the module that will own it, inserts the hook calls below with stubs that
reproduce today's behaviour, and writes the inert plumbing (code that reads only the new fields). After Step 1 the
kernel files are frozen (§8).

**New modules** (owner → contents in Step 0):

| File | Owner | Step 0 contents |
|---|---|---|
| `doubles-stages.ts` | A1 | `applyBoosts`, `selfBoost`, `foeDrop` moved from doubles-status.ts (2236-2355, with `foesLeft`); `writeStages`, `whiteHerbAfterMove` (extracted from applyBoosts' White Herb block) |
| `doubles-abilities.ts` | A1 | `setAbility`, `skillSwap`, `abilityStart`, `abilityEnd`, `intimidateStart`, `transformBuild` (unreached stubs); `updateCures` (no change), `damagingTry` (null), `afterMove` (no-op); `HANDLERS = {}`. (`ability-table.ts` and its generator are A1's own, written in its track.) |
| `doubles-typing.ts` | A2 | `setTypes`, `addType` (unreached); moved verbatim: `proteanGuard` (doubles-status.ts:680-687), `roost` (1420-1432), the Ingrain / Magnet Rise grounding guards (1560-1568), the ate-redirect guard (1058-1068), Burn Up / Double Shock and Smack Down guards (doubles-turn.ts:2309, 2335-2339), `psychicNoiseKeepsBerry` (2381-2394) and `volatileGuard`'s Psychic Noise branch (2424-2435); `beforeAttract` (go), `powderTryMove` (null), `retypeStatus` (identity), `comboGuard` (no-op); `HANDLERS = {}` |
| `doubles-field.ts` | A3 | moved verbatim: `fieldMove`, `fieldGuard` (doubles-status.ts:874-946); `snatch` (null), `tryHitSide` (pass), `mistBlocks` (false); `HANDLERS = {}` |
| `doubles-guards.ts` | D | moved verbatim: eventGuards' copier block (doubles-turn.ts:1147-1154), the three Symbiosis guards (1155-1159; doubles-items.ts:108-110; doubles-eot.ts:1037-1040), `lockedBerryGuard` (1713-1727), `hiddenStageGuard` (552-557), the Ripen guard (2211), the Glaive Rush guard (2341), the copier guard of afterChecks (doubles-eot.ts:1029-1036), the `encoreChange` guard (doubles-status.ts lastMoveVolatile, 1635-1658) as `encoreGuard`; `noteRise` (records `rose` amounts), `afterMoveCopies` (no-op), `beforeFirst` (go), `ohkoStep` (null: today's row reason), `flingTry` (null), `flingAfter` (no-op), `tracksItems` (false), `stepReport` ({}), `encoreRewrite` (the action unchanged) |
| `doubles-spread.ts` | D | `spreadStep` moved verbatim (doubles-turn.ts:2447-2566) |
| `doubles-start.ts` | D | moved verbatim from calculate.ts settleDoublesStart: the Imposter failure (3189-3191), STARF_REASON (3290), the start-copy failure (3291-3297) |
| `doubles-switch.ts` | R (wave 2; frozen in wave 1) | `switchOut(kernel, w, slot, how, action)` holding today's five switch-out sites verbatim (doubles-turn.ts:1167-1168, 2245-2246, 2322-2334; doubles-status.ts:1912-1919; doubles-eot.ts:989-997) |

Hook modules import the `TurnKernel` type and may import each other's exports (no cycles, no import of doubles-turn.ts).

**Hook calls Step 0 inserts** (call site at `4008ee8` → hook):

| Call site | Hook (owner) | Step 0 |
|---|---|---|
| `doubles-status.ts` beforeMove (124-152), first | `guards.beforeFirst` (D): Glaive Rush's end, priority 100 | go |
| beforeMove, after `confusionCheck` | `typing.beforeAttract` (A2): Attract, priority 2; Conversion 2's `usedType` | go |
| `onHit`, `volatile`, `moveTry`, `sideOrField`, hitOne's own TryHit, `tryImmunity` | the family registries `{ ...abilities.HANDLERS, ...typing.HANDLERS, ...field.HANDLERS }` by `entry.handler` | none registered |
| `tryHit` (1209-1249), after the Protect family | `field.tryHitSide` (A3): Crafty Shield, Magic Coat | pass |
| `prepareHit` (1134), `sideOrField` (1846), `earlyBranch` (837), `fieldMove` (879) | `field.snatch` (A3) | null |
| `runUse` after `priorityShield` (1003); `doubles-turn.ts` damagingMove after `moveFailure` (1823) | `typing.powderTryMove` (A2) | null |
| `statusType` (721) | `typing.retypeStatus` (A2) | identity |
| `updateAll` (1992) | `abilities.updateCures` (A1) | none |
| `applyBoosts`, after Mirror Armor | `field.mistBlocks` (A3) | false |
| `applyBoosts`, the ledger write (2291) | `guards.noteRise` (D) | `rose` amounts |
| damagingMove after `moveInfo` | `typing.comboGuard` (A2), `abilities.damagingTry` (A1: Spit Up's Try), `guards.flingTry` (D) | none, null, null |
| singleStep (1949), `doubles-spread.ts` spreadStep: before searchFor | `guards.ohkoStep` (D) | null |
| afterHit (2304) | `typing.afterHit` (A2, the moved guards), `guards.flingAfter` (D) | today's guards; no-op |
| runMove (1074), before eventGuards | `abilities.afterMove` (A1: Spit Up's Stockpile End), then `guards.afterMoveCopies` (D) | no-op |
| createContext (2769) | `guards.tracksItems(input)` (D) | false |
| searchFor (594), the step's options | `guards.stepReport(kernel)` (D) | {} |
| execute (973), before runMove | `guards.encoreRewrite(kernel, w, action)` (D) | the action unchanged |
| the switch-out sites | `switch.switchOut` | today's |

**Inert plumbing Step 0 writes in the kernel** (reads only the new fields):
- `calcBuild` (444) derives the markers: Roost's `types`, `tarShot`, `revealed`, `grounding`, `takenMods` (minimize,
  glaiveRush, berryWeaken); the world build already carries `types`, `addedType`, `storedStats`, `weighthg`,
  `itemSuppressed`.
- `typesOf` (1402) reads `buildTypes`; a new `typesIn(w, slot)` folds Roost; `grounded` (1387) uses `typesIn` and adds
  Telekinesis after Magnet Rise; `powderImmune` (1313) and `veilGuard` (2275) read `typesOf`.
- `itemWorks` (306) adds `!build.itemSuppressed`.
- `conditionsFor` (483): the sides' `luckyChant`; `protectName: "Mat Block"` and `defenderSide.protect` for a Z-Move or
  Max Move into a Mat Block side; the field's `mudSport`, `waterSport`, `ionDeluge`.
- `contextFor` (1500): `stockpile` for Spit Up from `vol.stockpile`; `retype` from `vol.electrify` or `field.ionDeluge`;
  `hiddenStages` for Stored Power, Power Trip (the user's) and Punishment (the target's) from `vol.stages`.
- `searchFor` (568): `UsesEnv.mist` from the sides; the heal-block stand-ins (C14) from `eot.healBlock` for the target
  and the attacker, restored after the step as today (1982-1984); the Berserk-lock stand-in from `vol.berryLocked`; all in
  the memo key (585).
- `hitChecks` (1558): Mat Block after the target's own protection; the Feint block (1841-1847) also clears
  `craftyShield` and `matBlock`.
- `redirection` (1335) takes an optional used type.
- `applyStep` (2016): with `ctx.tracksItems`, each lost item is classed as used (`noteItemUse`) or taken (F3 §4.1); the
  step's `rises`, `used` and `dealt` are read when the search reports them.
- `noteItemUse(w, slot, item)` (no-op unless `ctx.tracksItems`) at every consumption path of F3 §4.1's table.
- `carriedState` (861) and `carriedIssues` (2850): every new carried field of §3.1 into `vol`, `eot` and the build.
- `outcomeOf` (3548), `mergeOutcomes` (3586): every new outcome field of §3.1.
- faceHit's busted form (2645), doubles-status.ts `stanceChange` (948), doubles-eot.ts `hungerSwitch` (964) and
  `formGuard` (949) through `withSpecies`.
- doubles-status.ts `updateAll` and `receivedItem`: Mental Herb also ends `attract` and `healBlock`; Oblivious ends
  `attract`. `bounce` and `makeUse` take an optional `prankster` (Magic Coat keeps its own).
- doubles-actions.ts: the §2.4 REASONS; `HP_STATUS_MOVES` = kind P plus those of Purify, Stuff Cheeks, Swallow and Teatime
  whose kind is still L, so a track's fragment lifts them.

### 3.6 Step 0b: shared calculation plumbing (keyed on fields nothing sets yet)

| File | Change |
|---|---|
| `engine-corrections.cjs` | `withTurnMarks(marks, run)`: one scope per engine run, read at call time by wrapped util functions: `getMoveEffectiveness` (the existing wrapper) multiplies in the defender's added type at the first-type call, +1 for a Fire move with Tar Shot on the first type (its Tera type when Terastallized), 1 for Psychic into Dark with Miracle Eye, 1 for Ground into a pinned Flying type; `isGrounded` (pinned true; floating false unless Gravity or Iron Ball); `checkItem` (suppressed: item → disabledItem, as Magic Room); `chainMods` for the final chain only (bounds 41, 131072: gen789.js:481, 531; champions.js:273, 318) appends `takenMods` (8192, 8192, 2048 on the first hit only); `countBoosts` adds `extraBoosts` (only for storedpower, powertrip, punishment). |
| `calculate.ts` | `makePokemon` (189-224): `storedStats` (rawStats and stats, a clone hook as `withTypes` has), `weighthg` (overrides.weightkg), `types` / `addedType` (`[...base, added]`; Tera stays the engine's teraType; the world types win over Mimicry), the markers (non-enumerable, kept by `clone()`); `calculate()` (316) opens `withTurnMarks` from both Pokémon's markers; Spit Up's context (100 × layers; its HISTORY_MOVES needs-context skipped when given); `retype` (F2 §2.3: the user's ModifyType chain, then Electric; the user's type-changing ability as GAS_STAND_IN for that run; `withPowerMods([4915])` when kept); Lucky Chant (no critical hit); Mat Block's `protectName` line `Mat Block: {Move} breaks through at 1/4 damage.`; the Sports (`withPowerMods([1352])` for Electric or Fire after ModifyType); `hiddenStages`; `itemIgnored(build, other, conditions)` replacing the ~16 `magicRoom \|\| klutzActive` sites (690-694, 972, 1016-1021, 1100, 1144, 1167, 1286, 1479, 1497, 1512, 1827-1834, 3016, 3089, 3299); a floating defender against a Ground move other than Thousand Arrows is the zero row `{Move} has no effect on {Name}.` |
| `model.ts` | `getBuildStats` (315): `{ hp, ...storedStats }` (a transformed build's HP from `transformedFrom`); `validateBuild` (345): §3.2's issues and `abilityChanged`. |
| `uses-to-ko.ts` | `UsesEnv` (361) gains `allies?: true`, `mist?: { att?: true; def?: true }`, `report?: { rises?: true; used?: true; dealt?: true; starf?: true }`; `boost()` (4668): `allies` skips Defiant / Competitive and the copy (Step 1 sets it), `mist` drops a drop from the other battler after Mirror Armor, `report.rises` makes the step sum its rises and copy nothing; `TurnStepOutcome` gains `rises?`, `used?`, `dealt?`, `starf?: "att"`; `attItemOn` / `defItemOn` (368-369) read `itemSuppressed`; `types` (3615), `grounded` (3659), `effectiveness` (4641, through one exported `turnEffectiveness`) read the build's types and markers; `toBuild` (4617) through `withSpecies` on a form change; STARF_REASON in turn mode with `report.starf` marks the outcome instead. |
| `mechanics.ts` | `buildTypes(build, runtime)` (F2 §2.1). `doubles-targets.ts:32-37` and `intimidate.ts:248-251` use it. |

Step 0b's unit tests set each field on synthetic builds and must reproduce the probes' numbers: SA13 (Minimize under
Reflect, 105), CR10 (×4 with Glaive Rush), TV03 (three types), TV11 (Tar Shot 8x), TV12 (Foresight), TV13 (Miracle Eye),
CR07 (pinned: Earthquake 2x into Skarmory; floating: immune), TV15 (Embargo and Air Balloon), F75 (Mud Sport after
Galvanize), F35 (Lucky Chant), SA06 (Guard Split under Wonder Room), SA19c (weight), SA09 (Spit Up 300), D (Stored Power
with evasion), K55 / TW02 (Electrify's kept 1.2x).

---

## 4. Engine algorithm

The family designs hold each move's full mechanics with citations. This section fixes the shared order, states every
change this spec makes to them, and gives the pieces no family designed.

### 4.1 One pipeline order (all families merged)

1. **BeforeMove** (`doubles-status.ts beforeMove`; `PS/sim/battle-actions.ts` runMove → `runEvent('BeforeMove')`, first
   false stops it), for every acting Pokémon, No move included unless marked:
   100 Glaive Rush ends (D; C5) → 10 sleep / freeze → 8 flinch → 7 Disable → 6 Gravity, Throat Chop, Heal Block → 5 Taunt
   → 4 Imprison → 3 confusion → **2 Attract** (A2; not for No move) → 1 paralysis (not for No move) → −1 Destiny Bond →
   Focus Punch. An Encore that changes the queued move (Q3) rewrites the action before BeforeMove
   (`PS/sim/battle-actions.ts:227-234`).
2. **TryMove** (`useMoveInner`): Heavy Rain / Desolate Land, Damp, Dazzling / Queenly Majesty / Armor Tail (existing),
   then **Powder** (priority −1, A2; TW08); the move's own onTry: Spit Up (A1), Fling (D), the A1/A3 `fails` keys.
3. **PrepareHit:** Protean / Libero (A2; `proteanType`), then **Snatch** (priority −1, A3; F12). A snatched use runs no
   BeforeMove (F15); Swallow per C1.
4. **TryHit, status moves** (`tryHit`; step-major across targets): Wide Guard / Quick Guard (side, 4) and Psychic Terrain
   (field, 4) → the Protect family (volatile, 3) → **Crafty Shield** (side, 3) → **Magic Coat** (volatile, 2) → Magic
   Bounce → the absorbing abilities by the used type → Good as Gold → Soundproof → Oblivious (Taunt, Attract, Captivate)
   → Overcoat / Safety Goggles → the move's own TryHit. **Damaging moves** (`hitChecks`): Wide / Quick Guard → the
   target's protection → **Mat Block** (side) → Telepathy → the absorbers. Then the type immunity (by the used type and
   `typesIn`, grounding included), TryImmunity, the `[ohko]` immunities (D), the Substitute.
5. **TryBoost** (`applyBoosts`, after ChangeBoost: Contrary, Simple, and the ±6 cap): Clear Amulet (priority 1) → the
   Pokémon's own ability (Clear Body family, Mirror Armor's reflection, the Intimidate-only blocks: A1) → an ally's Flower
   Veil → **Mist** (side, no Speed: last; F40, CR06). Then AfterEachBoost per stat (Defiant, Competitive: foes only),
   AfterBoost (Eject Pack's `fell`; the ledger's `rose` amounts for Opportunist and Mirror Herb; Rattled and Adrenaline
   Orb after an Intimidate).
6. **Direct stage writes** (`writeStages`, A1: Psych Up, the swaps, Topsy-Turvy, Transform, Costar, Curious Medicine) skip
   step 5's events entirely; White Herb restores a received drop at the action's AfterMove.
7. **AfterMove** (`runMove` end): the move's own onAfterMove (Spit Up's Stockpile End: A1), then the onAnyAfterMove
   handlers by Speed: Opportunist and Mirror Herb copies (D), White Herb, Eject Pack (its switch after the action: R);
   then `eventGuards`, `gasShieldGuard`.
8. **End of turn, new rows** (`residuals.ts` keys; Speed before subOrder within an order): 11 Nightmare; 14 Octolock (with
   Syrup Bomb, by Speed); 19 Telekinesis ends; 20 Heal Block ends; 21 Embargo ends; 26.x Mist and Lucky Chant count down
   (no HP); 27.3–27.6 the Sports and rooms count down (no HP); 28.2 Harvest and Pickup (one Speed-sorted group: C8);
   29 the Opportunist and Mirror Herb copies, White Herb (accuracy and evasion too), Eject Pack; the final Update (the
   Berries Heal Block or Embargo held back: C3, C4); a rise there stays pending (E2 `pendingCopy`).

### 4.2 Track A1: stats, abilities, Transform (F1, with C1, C2, C7, C13)

- **Stage writes.** `applyBoosts` (moved to `doubles-stages.ts`) keeps today's behaviour plus F1's `intimidate` option
  (Inner Focus, Oblivious, Own Tempo, Scrappy from gen 8; Guard Dog in SV; Rattled from gen 8; Adrenaline Orb; SA27,
  `PS/data/mods/gen7/abilities.ts:34-81`), the ledger (`guards.noteRise`) and Mist (`field.mistBlocks`). `writeStages`
  is F1 §3.1's direct write.
- **Stored stats and weight** (F1 §3.2, §3.3) through Step 0b's `makePokemon` and `getBuildStats`; every reader (Speed and
  the gen 8+ re-sort, `confusionRolls`, Strength Sap, Beast Boost, Download, Foul Play, Body Press, Low Kick and kin)
  follows. Writers take `kernel.buildStats(build)`, so an earlier override is included.
- **Abilities** (F1 §3.4): `setAbility` in Showdown's order (`PS/sim/pokemon.ts` setAbility: cantsuppress unless a form
  change; SetAbility (Ability Shield) unless Transform; the old ability's End; a fresh state; the new Start unless
  Transform copied the same ability). Skill Swap per C13. The End table gains **Opportunist → delete `MonState.copy`**
  (C7). Mimicry's Start is modelled with A2's types (its terrain's type through `setTypes`), so it leaves F1's
  `abilityStart` list. The Start of a once-a-battle ability gained mid-turn acts with the turn fact of §2.5 (Q12). The
  Neutralizing Gas guard stays for the eight ability moves (Q5).
- **The moves** (F1 §4): as F1, with these changes:
  - **Swallow** (C1): a snatched use heals `modify(maxhp, [0.25, 0.5, 1][(snatcher's layers ?? 1) − 1])` and ends the
    **Snatch user's** Stockpile (its End through applyBoosts); the original user's `vol.stockpile` is untouched.
  - **Transform** (C2): `transformBuild` also copies `MonState.timesAttacked`, the target's `types` (or Roost's `typeWas`:
    the species' types while `eot.roosted`) and `addedType` (`PS/sim/pokemon.ts` transformInto); no `transformTyped`.
  - **Minimize** sets `vol.minimize`; calcBuild turns it into `takenMods.minimize` for the minimize-flag moves (the list is
    generated from the dex; no mod changes the flag).
  - **Tidy Up** sets `hazardsFrom: null` on both sides (not F1's `hazardsCleared`).
- **Imposter** (F1 §4.3) is implemented by D in `doubles-start.ts` with F1's rules (Q8).

### 4.3 Track A2: types, volatiles, grounding (F2, with C3, C4, C11, C14)

1. **World types** (F2 §2.1): `buildTypes` (Step 0b) and `typesIn` (Step 0); `setTypes` and `addType` in
   `doubles-typing.ts` follow `PS/sim/pokemon.ts:2109-2136` (no change while Terastallized; Arceus and Silvally keep
   theirs; a Stellar type never set). Terastallizing clears the added type (`PS/sim/battle-actions.ts:1948`).
2. **The calculation** reads them through Step 0b (`makePokemon`'s types, `withTurnMarks`); F2 §2.1's effectiveness rules.
3. **Retyping** (F2 §2.3): `MoveContext.retype` for damaging moves, `retypeStatus` for status moves, and redirection by
   the used type (the -ate redirect guard goes). `combo` guards own-type moves, Z-Moves and Max Moves.
4. **Heal Block in later steps** (C14): the kernel's stand-ins act once A2 removes the moved Psychic Noise guard from
   `doubles-typing.ts`; `absorbEffect` heals nothing (`{Ability}: no damage.`); `pouchHeal` heals nothing; Pollen Puff onto a
   heal-blocked ally is `Heal Block: Pollen Puff cannot be used.` (`PS/data/moves.ts:8325-8330`). `healBlockLeft`: Psychic
   Noise 2, Heal Block 5; E ends it at 20 (C3).
5. **Embargo** (C4): Embargo sets `build.itemSuppressed` and `eot.embargo = 5`; the calculation reads it through Step 0b's
   `itemIgnored` and `checkItem` (F3 §5.4.6: Knock Off keeps 1.5x, the item can still be taken); E clears both at 21 when
   1 turn is left. `gasShieldGuard` reads `itemSuppressed` as an Ability Shield that does not work (USUM has no
   Neutralizing Gas, so it never fires there).
6. **The grounding enabler** (C11; no family designed it). Showdown: `isGrounded` checks Gravity, Ingrain, Smack Down,
   Iron Ball, then the Flying type, Levitate, Magnet Rise, Telekinesis, Air Balloon (`PS/sim/pokemon.ts` isGrounded);
   Smack Down and Thousand Arrows add `smackdown` and remove `magnetrise` and `telekinesis` (`PS/data/moves.ts` smackdown
   condition onStart); Gravity starting removes both (`gravity` onFieldStart).
   - **State** (exists or §3.3): `eot.ingrain`, `eot.smackedDown`, `eot.magnetRise`, `eot.telekinesis`.
   - **Kernel** `grounded()` (Step 0) already follows the order; calcBuild sets `grounding: "pinned"` with Ingrain or Smack
     Down (and no Gravity, which the engine reads itself), `"floating"` with Magnet Rise or Telekinesis and neither pin nor
     Iron Ball.
   - **Calculation** (Step 0b): pinned → `isGrounded` true and Ground into Flying neutral (as the engine's own Gravity
     branch, gen789.js:299); floating → `isGrounded` false and a Ground move other than Thousand Arrows is the zero row.
   - **Removed:** `groundingChange` (doubles-status.ts:1560, 1568) and the Smack Down / Thousand Arrows guard
     (doubles-turn.ts:2309); Training's rollout `Ingrain on a Pokémon that is not grounded otherwise is not modelled.`
   - **Cases** CR-07a–d (§7).
7. **The type-change guards** (F2 §4): Protean / Libero (`proteanType`: gen 9 and Champions once per entry through
   `abilityActive`, gen 7–8 every move; TW19, TW20), Roost (`typesIn`), Burn Up / Double Shock (`setTypes` with "???"),
   Color Change (Step 1).
8. **The volatile moves** (F2 §3.9–§3.21): as F2. Octolock's residual (E) goes through the ledger (C9). Nightmare ends
   with every sleep cure: the wake branches, `cureStatus`, the Berries, Heal Bell, Worry Seed (CR11).

### 4.4 Track A3: field, side, reflection, items (F3, with C1, C4, C10, C15)

As F3 §4–§5, with:
- **Swallow** is A1's; A3's Snatch dispatch hands the stolen use to A1's handler with `use.snatched` (C1).
- **Embargo** is A2's; A3 owns `forceEat`, `give`, Corrosive Gas's takeItem, Recycle and the item-history readers it needs.
- **Stuff Cheeks** is A3's (F3 §5.4.5).
- **Mist** (`field.mistBlocks`): F3 §4.5's check, for any effect from another Pokémon; the infiltrates exception only for a
  foe's move (CR06). In the step, `UsesEnv.mist` (Step 0b).
- **Court Change, Defog** move or clear `clock` and `hazardsFrom` (F3 §4.3). Rapid Spin and Mortal Spin's clear is Step 1.
- **Magic Room ending** (F3 §5.3.1): White Herb at AfterMove, then at the Update the Berries (Lum and Persim also against a
  confusion), Mental Herb (now also Attract and Heal Block, Step 0); `boosterAfterRoom` for SV.
- **Item history**: Recycle reads `mon.lastItem ?? input.lastItem` (absent: `needsLastItem`). `guards.tracksItems(input)`
  (D) is true when a Recycle user, a Harvest or Pickup holder, a Symbiosis holder or a Fling user is in the turn.
- **Teatime and Stuff Cheeks** with a Ripen eater of a resist Berry set `vol.berryWeaken` (D's marker) instead of today's
  Ripen guard; a later multi-hit move into it keeps `REASONS.notIn2v2("Ripen")` (only its first hit is halved).

### 4.5 Track D: the moves-phase guards (F4, with C5, C6, C7, C8, C12)

- **The ledger and copies** (F4 §3.1, §4.1): `noteRise` sums the positive parts by stat; the step reports its `rises`
  (Step 0b's `report.rises`, asked for by `guards.stepReport` whenever a copier is in the turn); `afterMoveCopies` applies each copier's sum in Speed order
  at the action's end (Opportunist through applyBoosts with effect Opportunist; Mirror Herb used, then the boost; ties as
  worlds, 1/k!, only when an Eject Pack or Symbiosis reads the order). The start copy (`doubles-start.ts`) waits for the
  first action's end, with the fact `Assumes no Pokémon Terastallizes or Mega Evolves this turn.` where it applies. A
  copier whose ability ends first loses its copy (C7). The copier guards go from all four sites.
- **Item history writers** (Step 0's `noteItemUse` paths and applyStep's classification) turn on with `tracksItems`.
- **Hidden stages** (F4 §4.4): `hiddenStageGuard` goes; Step 0's `contextFor` and Step 0b's scope compute the power.
- **One-hit KO moves** (F4 §4.6): `ohkoStep` with the kernel's checks in Showdown's order, then a fixed full-HP loss
  (Focus Sash at full HP, Endure, a Substitute, Disguise; the Update's Berry at 1 HP). Focus Band stays a Tier 2 guard.
- **Spread heals** (F4 §4.7) in `doubles-spread.ts`: the attacker joins every landed target's factor; per target in hit
  order its drain (`round(dealt × ratio)`; Big Root per heal; Liquid Ooze deals the raw amount), capped at the maximum;
  Shell Bell `trunc(Σ dealt / 8)` (at least 1), the Substitute's share excluded; the retaliation, the Update, Life Orb as
  today. The joint is kept (C12); over budget is `Too many cases to follow.`.
- **Fling in 2v2** (F4 §4.5 2v2 part), after F lands: `flingTry` (no item, Klutz, Magic Room, Embargo, an unflingable item:
  `Fling fails: …`), then `flingAfter` (the user's item gone, `lastItem`, Unburden, Symbiosis; the target's Berry through
  `forceEat(…, { flung: true })`, the status or flinch as a 100 % secondary that Shield Dust, Covert Cloak and a
  Substitute stop and Sheer Force does not remove (E9), White Herb, Mental Herb). `flungCustap` for a Custap Berry.
- **The Berserk lock** (F4 §4.8, F2 of Step 1): the stand-in in later steps, the reset by a status move reaching it
  (its Update), by the holder's own self-targeting move or No move; carried both ways.
- **Starf** (F4 §4.13): the step marks the attacker's Starf (`report.starf`), applyStep branches over the open stats;
  at the start, root worlds per stat.
- **Glaive Rush** (C5): the user's `vol.glaiveRush` after the move; `beforeFirst` deletes it at the holder's next
  BeforeMove; `takenMods.glaiveRush` meanwhile.
- **Ripen's weakened Berry**: the Ripen guard goes for single-hit moves (`vol.berryWeaken`, consumed by the next damaging
  hit into it); multi-hit keeps the reason.
- **Symbiosis** (F4 §6): at an item used (not one taken: `itemsTaken`, `itemsMoved`) the living partner's item moves
  through `doubles-items.ts receive` with its Start; the partner's Unburden; Fling's (E6).
- **Imposter** at the start (F1 §4.3; Q8) in `doubles-start.ts`.
- **Encore that changes the move** (with Q3's Last move): `guards.encoreRewrite` turns the target's queued action into the
  encored move at its old priority with a uniform random legal target (`PS/sim/battle-actions.ts:227-234`,
  `getRandomTarget`), one world per target; the move must be among its contexts, else `Encore changes {Name}'s move: not
  modelled.` stays (the moved `encoreGuard`).
- **The step's reports**: `guards.stepReport(kernel)` asks the step for `rises` when a copier is in the turn, `used` with
  `tracksItems`, `starf` when a Starf holder attacks; `doubles-spread.ts` asks for `dealt` itself.

### 4.6 Track E: the end of turn (`doubles-eot.ts`, `residuals.ts`)

New handlers and keys, each with its source:

| Key | Handler | Rule |
|---|---|---|
| 11 | Nightmare | `damage(baseMaxhp / 4)` while asleep or Comatose; Magic Guard none (`PS/data/moves.ts:12708-12720`) |
| 14 | Octolock | its source gone, fainted or with no active turn: ends silently; else boost({def: −1, spd: −1}) from the source with effect the move: Clear Body, Mirror Armor (back to the source), Mist (A3), Defiant / Competitive per stat, the ledger (C9) |
| 19, 20, 21 | Telekinesis, Heal Block, Embargo | the turns left count down; at 0 the volatile ends (Heal Block: later heals and the final Update's Berries act; Embargo: `itemSuppressed` cleared, the items after 21 act) |
| 28.2 | Harvest | holder with HP, no item, `lastItem` a Berry: in sun or Harsh Sunshine with no Cloud Nine or Air Lock, certain; else 1/2; restored, `lastItem` cleared; a failed one keeps it (F4's probe C4). With `input.lastItem` absent and no Berry this turn: `needsLastItem("Harvest", name)` for the end of turn only |
| 28.2 | Pickup | no item: the other active Pokémon with `usedItem` and `lastItem`, 1/k; their `lastItem` cleared (C8) |
| 29 | Opportunist, Mirror Herb | the copies accumulated since the last application (C9) |
| 29 | White Herb | lowered `vol.stages` too (M1) |
| after | the final Update | Lansat sets `settledFocusEnergy`; a Starf eaten there branches in E2 too |

Also: Leech Seed into a heal-blocked seeder with Liquid Ooze by the two holders' Speed, a tie 1/2 (F4 §4.16); the room
fact reads `fieldSet`; the residual stage events use the moves' ledger; every form change through `withSpecies`.

### 4.7 Track F: Fling, the verified 1v1 fix (F4 §4.5)

- The catalog generator gains each item's `fling` data from the game's pinned mod; `app/lib/battle/fling.ts` holds the
  power, the failure rules and the effects as data (unit-tested against `guards-probes-fling.out`).
- `calculate.ts` (F is its only owner after Step 0b): an engine correction `withFlingPower` (champions.js:410,
  gen789.js:656 read `getFlingPower` at call time); the failure rows (`Fling fails: {Name} has no item.`, `… {Item} cannot
  be flung.`, `… {Name} has Klutz.`, `Fling fails under Magic Room.`); the held item's own damage effects kept (Life Orb's
  boost without recoil); the target's effect as row facts; Uses to KO: the second use fails.
- The verification sweep (u-oracle) of F4 §4.5 step 7; the golden rows that change are listed by id and are the only
  allowed golden differences.

### 4.8 Track R: switch-outs with a replacement (wave 2; F4 §5.4, under Q1 = R)

As F4 §5.4, with:
- the entry abilities through A1's `abilityStart(kernel, w, slot, "entered")`, in Speed order among the entrants;
  onSwitchIn-only abilities: Imposter transforms into the foe across (A1's rule), a newcomer under Neutralizing Gas gets
  the gas stand-in, a Neutralizing Gas newcomer is `entersWithGas`, Commander keeps `notIn2v2("Commander")`, a weather or
  terrain newcomer with a field-settled holder keeps `fieldChange`;
- the foes' pending copies at SwitchIn (priority −3) and a second Eject Pack at SwitchIn (−4, chaining another switch: B1);
- the leaver's gas or Unnerve ending before it leaves (B13): with A1's ability Starts, `gasEnds` stays only for an ending
  gas while a Pokémon it suppressed is still in;
- R's contract (Step 2): `DoublesTurnInput.bench`, `replacement`, `hazards`; `DoublesReplaced`; `MonState.id`,
  `World.benched`, `World.bench` (F4 §5.4).

### 4.9 Randomness, the readers rule and budgets

| Event | Branches | Bound | Owner |
|---|---|---|---|
| Acupressure | one per stat below +6 | ≤ 7 per use | A1 |
| Trace gained mid-turn | one per copyable adjacent foe ability | ≤ 2 | A1 |
| Conversion 2 | one per resisting type the user lacks | ≤ 7 | A2 |
| Attract | stopped / goes, each BeforeMove of an infatuated Pokémon | ×2 per action | A2 |
| A Ghost Curse's random foe | gens 8–9; gen 7 without the glitch | ×2 | A2 |
| Harvest | 1/2 outside sun | ×2 per holder | E |
| Pickup | one per candidate | ≤ 3 | E |
| Starf (step, start, end of turn) | one per open stat | ≤ 5 | D, E |
| Two Snatch users at one Speed | 1/2 each | ×2 | A3 |
| Liquid Ooze vs a heal-blocked seeder at one Speed | 1/2 each | ×2 | E |
| AfterMove copies at one Speed (only with an Eject Pack or Symbiosis reader) | k! orders | ≤ 2 | D |
| Random drag (Roar, Whirlwind, Dragon Tail, Circle Throw, Red Card) | one per living bench Pokémon | ≤ 4 | R |

**The readers rule.** A world field is written only when something later in the turn or in E2 reads it: item history
only with `tracksItems`; `usedType` only with a Conversion 2 user; the step's `rises` only with a copier in the turn;
`fieldSet` only with an E2 run or a room fact; `vol.stages` as today. Worlds that differ only in an unread field would not
merge, and the budget would pay for nothing.

**Budgets** stay `{ worlds: 1500, entries: 200 000, calculations: 160 }` (`doubles-turn.ts:60`). The spread drain's joint
(C12) is the one known pressure point: a Matcha Gotcha user hit earlier (|x| about 30 HPs) into two targets hit earlier (16
each) with 16 rolls each reaches about 30 × 16 × 16 × 16 × 16 ≈ 2 million joint entries and is `Too many cases to
follow.`; an unhit user into unhit targets is at most 16 × 16 = 256. Integration measures the share (§10).

---

## 5. UI (2v2 only; 1v1 unchanged)

### 5.1 Facts

Every text is a fact with names from `kernel.names` (doubles-types.ts `nameText`), sides as "your side" / "the opponent's
side", never left or right, and no instruction text (docs/champions-calculator.md). They go through the existing lists:
step facts, hit facts, skip facts, `DoublesHP.losses`, `DoublesHP.conditions`, residual lines and turn facts. The exact
texts are the families': F1 §10.1, F2 §3 ("Facts" of each move) and §8, F3 §9, F4 §8. This spec changes these:
- **Swallow, snatched** (C1): the Snatch user's heal in its heals list (`Swallow: +70 HP.`), then its own stage facts and
  `{Snatcher}'s Stockpile ends.`; nothing on the original user.
- **Tidy Up:** `Tidy Up: {Name}'s Substitute is removed.`; `Tidy Up: the hazards are removed from both sides.` only when a
  hazard landed earlier this turn (hazards from before the turn are an input only under R).
- **Ghost Curse:** the user's cost moves from a step fact to a loss, `{Name} loses {n} HP (Curse).` (Step 1).
- **Heal Block in later steps:** `{Ability}: no damage; {Name} cannot heal.` (an absorber), `Heal Block: Pollen Puff cannot
  be used.`
- **Grounding:** a Ground move into a floating Pokémon is `{Move} has no effect on {Name}.` (as Air Balloon's row).
- **Conditions on the card** (`data-doubles-conditions`), each only when it holds at that point: `Stockpile {n}.`,
  `Power Trick.`, `Power Shift.`, `No Retreat.`, `Minimized.`, `Ability suppressed.`, `Ability: {Ability}.` (changed this
  turn), `Transformed into {Target}.`, `Charging Geomancy.`, `Type: {Types}.` (when `typesIn` differs from its species'),
  `Tar Shot.`, `Foresight.`, `Miracle Eye.`, `Telekinesis.`, `Embargo.`, `Heal Block.` (exists), `Nightmare.`, `Octolock.`,
  `Infatuated.`, `Glaive Rush: double damage taken.`, `Opportunist: copies +1 Attack next turn.` (a pending copy).
- **Residual lines** (`residualLine`): effects "Nightmare", "Octolock" (its stage facts), "Harvest" (`Harvest: {Berry}
  back.`), "Pickup" (`Pickup: picks up {Item}.`), "Opportunist", "Mirror Herb" (`copies +2 Attack.`), and the ends with no
  HP (`Heal Block ends · {Name}`, `Embargo ends · {Name}`, `Telekinesis ends · {Name}`).

### 5.2 Controls for state from earlier turns (Q2 default)

In CarriedFields (`BattleConditions.tsx:125-219`), offered by `carriedOptions` (`doubles-prep.ts:152-214`) only where the
turn reads them; compact selects as today; 375 px with no horizontal scroll:

| Control | Shown when | Writes | Data attribute |
|---|---|---|---|
| `Stockpile` (0–3) | its own move is Stockpile, Swallow or Spit Up | `carried.stockpile` (counters equal the layers; Contrary −layers) | `data-doubles-stockpile` |
| `Last move` (Unknown, None since it came in, its move slots) | a turn move reads it: Disable, Encore, Conversion 2 | `lastMove` (Unknown → absent, Q3) | `data-doubles-last-move` |
| `Item used earlier` (Unknown, None, the catalog's items, Berries first for Harvest) | it holds no item and its move is Recycle, or its ability is Harvest | `lastItem` (Unknown → absent, Q4) | `data-doubles-last-item` |

`useDoublesView.tsx` passes the quick moves in slot order as `moves` (Conversion reads the first: the turn fact of §2.5).
The summary's toggles count a control only when it is set. Under R (wave 2): `Bench` per side in Field conditions (the
slot's roster source, up to four, in roster order), `Replacement` per Pokémon that can switch out by its player's choice
this turn, and per-side `Stealth Rock`, `Spikes` (0–3), `Toxic Spikes` (0–2), `Sticky Web`; the card shows the leaver's
line `{Name} switches out at {hp} HP.` and the newcomer's card below it (F4 §5.4).

---

## 6. Training (Champions)

- **`sim/bridge.ts`.**
  - `MAPPED_VOLATILES` (38-41) gains `stockpile`, `powertrick`, `powershift`, `noretreat`, `minimize`, `gastroacid`,
    `attract`, `octolock`, `healblock`, `glaiverush`, and `trapped` moves there from `IGNORED_VOLATILES` (32-36).
  - `carriedOf` (154-252): `stockpile` (the tracker's layers, and counters from the `-boost|…|def|n` / `spd` lines of each
    Stockpile use: n 0 is not counted, Contrary's `-unboost` is), the flags above, `stages` (`boosts.accuracy`,
    `.evasion`: public `-boost` lines), `healBlock` (`Math.min(4, duration)`; Psychic Noise's two turns are public from its
    use), `attract` and `octolock` (their sources, public `[of]`; active only), `lastItem` (the tracker's
    `item.state === "gone" && how === "consumed"`, C15), `berryLocked` (the belief battle's
    `abilityState.checkedBerserk === false` / `checkedAngerShell === false`: a replay of public lines), `copy` (the belief
    battle's `abilityState.boosts` / `itemState.boosts`), `glaiveRush`, `berryWeaken` (a resist Berry eaten outside a hit,
    no damaging hit since: public).
  - `liveBuild` (59-87): `types` and `addedType` when they differ from the species' (the public typechange / typeadd lines
    and the gen 7+ display line, `belief-battle.ts:212-223`); `storedStats` when they differ from `getBuildStats(base)`;
    `weighthg`; `abilityChanged` when the ability is not its species' own; a transformed Pokémon as such (species, stored
    stats, the copied ability, `transformedFrom`, `moves` from `moveSlots`); Protean / Libero used: `abilityActive` false.
  - Rollout reasons that go: `{Name} is transformed.`, `{Name}: its ability was changed ({id}).`, `{Name}: {ability} was used
    this stint.` (297), `{Name}: Ingrain on a Pokémon that is not grounded otherwise is not modelled.` (336), and the
    `{id} is not modelled.` rollouts of every newly mapped volatile. Kept: `{Name} has an Illusion.`, `twoturnmove` (no
    Champions Geomancy), a Substitute's HP after a hit (hidden), and the bridge's other reasons.
- **`sim/tracker.ts`:** Stockpile's counters (above); nothing else is new (C15).
- **`ai/evaluate.ts`:** `foreignAbility` (138-147) skips `abilityChanged` builds. `postFromOutcome` reads `pendingCopy`,
  `lastItem`, `berryLocked`, `berryWeaken`, `stages`, `stockpile`, `turnsLeft`, `benchCured` (cures the side's bench members
  with HP above 0) and the builds' new fields; `nextClock` reads `clock`, `hazardsFrom` and `fieldSet` (F3 §4.3). Its Rapid
  Spin / Mortal Spin and Safeguard parts are Step 1's fix.
- **`ai/value.ts`:** no new weights by default (Q7); `volatilesOf` ignores ids it does not weigh, as today.
- **Under R (wave 2):** the bench (the AI's exactly; the player's from the belief world, HP and status public), the
  replacement (the AI's `ReplacePolicy`, `rollout.ts:15-41`; the player's: Q9), hazards mapped from the public side
  conditions (IGNORED_SIDE's hazards become mapped), `postFromOutcome` placing `benched` and the newcomers, and prelude.ts's
  `A replacement is needed before the moves.` going.
- **Gates** (`npm run eval:training`, `conformance:training`, `leak:training`): vs RandomLegal ≥ 90 %; vs MaxDamage ≥ 60 %;
  self-play 50 ± 7; conformance and leak pass (`0 differences`; the new input fields are in the leak diff); decision p95
  ≤ 634 ms. The HabitBot gate sits near its sampling spread (FINAL.md §4): it is reported with main on the same seeds.

---

## 7. Oracle (`scripts/.cache/calc-audit/2v2/verify`)

### 7.1 Harness (Track V)

- **`case-types.ts`:** `CaseMon.types`, `addedType`, `lastItem`; `CaseCarried` gains §3.1's fields; `CaseSide` gains
  `safeguard`, `mist`, `luckyChant` and (R) `hazards`; `CaseField` gains `mudSport`, `waterSport`; `Case.bench` (statuses,
  abilities; R: whole Pokémon), `Case.replacement` (R).
- **`sim-dfs.ts prepare()` (140-265):** `setType(types, true)`, `addedType`; `addVolatile` with a source and a duration for
  healblock, embargo, telekinesis, attract, octolock, tarshot, foresight, miracleeye, nightmare, powertrick, powershift,
  noretreat, minimize, gastroacid, trapped, glaiverush, `twoturnmove` with `geomancy`; `stockpile` per layer then
  `effectState.def/spd`; `boosts.accuracy/evasion`; `p.lastItem`; `abilityState.checkedBerserk = false`,
  `abilityState.berryWeaken`, `abilityState.boosts` (a pending copy); `addSideCondition` with a source (Mist, Lucky Chant,
  hazards per layer); `addPseudoWeather` with a source; a bench status set directly (`setStatus` refuses an inactive
  Pokémon: K43). Under R: mid-turn switch requests answered from `Case.replacement` (today `:876-892` throws).
- **`compare.ts`:** E2 now compares stages (atk..spe, accuracy, evasion: today unchecked, which let GA3 pass), the
  ability, species, `types` (`buildTypes`), `storedStats`, `weighthg`, `stockpile`, `lastItem`, `pendingCopy`,
  `berryLocked`, `benchCured`, `clock`, `hazardsFrom`, `fieldSet`, the new volatile ids; `CHANCE_EFFECTS` gains `harvest`;
  the perish projection for E2 with the end of turn not estimated (F4 §4.12).
- **`app-turn.ts`** maps every new field; **`gen-tests.ts`** emits the new cases into
  `tests/unit/doubles-turn-showdown.test.ts`.
- **`status2/build/changed-cases.ts`** (new): lists every stored case whose expected reason this build removes (by
  matching the stored `notEstimated` / `endNotEstimated` text and the S48 / REVIEW_REASONS keys against §2.4's removals),
  so V re-runs exactly those in the oracle and stores them; every other stored case must stay byte-equal after the moves
  (`app-diff.mjs`). Known members: S48-SkillSwap-*, S48-Transform-*, S48-Attract-*, S48-Roost-flying, S48-Bestow-*-usum,
  R02, R03, R07, RT-RV05, the review cases of REVIEW_REASONS (Eject Pack, Opportunist, Psychic Noise, Harvest, Pickup,
  spread heal, one-hit KO, Fling, Magic Room before another move), R41's Harvest and Pickup parts, and the stored cases with
  the texts of the census table (`Roost changes Dragonite's type…`, `Magnet Rise changes whether Magnezone is grounded…`,
  `Ingrain changes whether Venusaur is grounded…`, `Matcha Gotcha heals …`, `Rock Slide heals …`, `Starf Berry raises a
  random stat`, `One-hit KO move: no damage range.`, `Fling is not verified for this game.`, `Bestow is not modelled …`,
  `Magic Room is not modelled …`, `Opportunist copying a stat rise …`, `Psychic Noise is not modelled in 2v2.`, `Harvest is
  not modelled in 2v2.` ×4, `Pickup is not modelled in 2v2.` ×4) and, under R, the switch-out texts.

### 7.2 Cases

Every case runs the three walks and is exhaustive unless marked; each move SV has runs in SV and one other game where it
exists, each USUM-only move in two USUM cases. Files: `cases-sat.ts` (F1), `cases-f2.ts` (F2), `cases-fs.ts` (F3),
`cases-g4.ts` (F4), `cases-cr.ts` (this critic), all wired into `cases-se.ts` as `cases-review.ts` is.

| Prefix | Count | Source | Notes |
|---|---|---|---|
| `SAT-` | 52 | F1 §13.1 | SAT-STK-2 adds a snatched Swallow by a Snatch user with its own Stockpile (usum; C1) in place of F3's FS22c; SAT-TRF-1 adds the copied `timesAttacked` with a Rage Fist (C2) |
| `F2-` | 75 | F2 §10 | F2-CC1/CC2 (Color Change) run in Step 1 |
| `FS` | 55 | F3 §11.1 | FS22a–c (Swallow) move to SAT-STK (A1) |
| `G4-` | 95 wave 1 + 11 SWX (wave 2) | F4 §2–§6 | the ALY, SFL, TRC, CRS cases run in Step 1; LMV and ENC need Q3; the Tier 2 cases of F4 §6 (GLV aside) are not built |
| `CR-` | 11 | §1.1 | CR-01 (CR01, sv), CR-02 (CR02, usum), CR-03 (CR03, sv; +champions), CR-04 (CR04, usum), CR-05 (CR05, champions; +swsh), CR-06 (CR06, sv; +swsh), CR-07a–d (CR07, sv; +usum), CR-08 (CR08, sv; +champions), CR-09 (CR09, sv; +champions with Trevenant and Dedenne), CR-10 (CR10 and CR10b, sv; +champions), CR-11 (CR11, usum) |

The changed stored cases of §7.1 are re-run and stored. Total: the 1264 stored cases plus about 300 new ones (wave 1),
11 more in wave 2.

---

## 8. Build plan (disjoint ownership)

### 8.1 Step 0: contract, hook modules, inert plumbing (behaviour unchanged)

Two builders with disjoint files; 0b starts once 0a's type files (`doubles-types.ts`, `types.ts`, `doubles-world.ts`)
are written.

| Part | Owns | Does |
|---|---|---|
| 0a | `doubles-types.ts`, `types.ts`, `doubles-world.ts`, `doubles-turn.ts`, `doubles-status.ts`, `doubles-eot.ts` (§3.5's lines only), `doubles-items.ts` (the Symbiosis hook line), `doubles-actions.ts`, the new modules of §3.5 (moved code and stubs; `ability-table.ts` is A1's), `status2/build/gen-status-table.ts`, the regenerated `status-table.ts` (kinds unchanged), `tests/source/doubles-status-moves.test.ts`, `tests/source/status2-hooks.test.ts` (new: every moved guard still has its call site) | §3.1–§3.5 |
| 0b | `calculate.ts`, `engine-corrections.cjs`, `model.ts`, `uses-to-ko.ts`, `mechanics.ts`, `doubles-targets.ts`, `intimidate.ts`, `tests/unit/status2-plumbing.test.ts` (new) | §3.6 |

**Gate:** `npm run check`; `golden-1v1 --check` byte-equal; `regress.mjs` and `app-diff.mjs` over all 1264 stored cases:
0 differences, facts included; the 2v2 bench (`2v2/verify/bench.ts`) within 5 % of main; Step 0b's unit tests reproduce
the probe numbers of §3.6.

### 8.2 Step 1: the correctness fixes (the Step 0 builder; one commit each)

| # | Fix | Where | Cases / tests |
|---|---|---|---|
| 1 | Ally targets in the pairwise step: no Defiant / Competitive, no copy (F4 F1) | `searchFor` sets `UsesEnv.allies` when the target is the attacker's ally | G4-ALY-01-sv, -02-swsh, -03-champions, -04-sv; `doubles-guards-ally.test.ts` |
| 2 | Champions: a Sheer Force hit locks a Berserk / Anger Shell Berry (F4 F2) | the lock source in applyStep; the stand-in | G4-SFL-01/02-champions, -03-sv |
| 3 | Color Change (F2 §4): `setTypes` after a hit that reached it, not behind a Substitute, not a Sheer Force skip, not "???", not Terastallized | `doubles-typing.ts setTypes` (the builder writes it; A2 takes the file over) and the afterHit hook | F2-CC1-usum, F2-CC2-usum |
| 4 | Trace's facts read the copied ability (F4 F3) | doubles-status.ts `turnFacts` gains the settle | G4-TRC-01-sv, -02-usum |
| 5 | Ghost Curse: the cost is a loss on the user's card, its faint another faint | the curse handler | G4-CRS-01-sv, -02-champions |
| 6 | canStatus: the type immunity before Comatose (text) | canStatus | unit test |
| 7 | Training: `hazardsFrom: null` after Rapid Spin and Mortal Spin; `nextClock` reads it and a Safeguard set this turn | outcomeOf; `ai/evaluate.ts` | `S1-RSP-champions` (E2, new); training unit tests |
| 8 | Training: accuracy and evasion stages from earlier turns into `carried.stages` (F4 F4); a positive one under Stored Power or Power Trip is not estimated (today's guard) until D | `sim/bridge.ts` | training unit tests |

**Gate:** Step 0's, except that the cases each fix changes are listed and match the oracle. After Step 1 these files are
frozen; only the integrator edits them, for agreed one-line changes: `doubles-turn.ts`, `doubles-status.ts`,
`doubles-world.ts`, `doubles-types.ts`, `types.ts`, `doubles-actions.ts`, `uses-to-ko.ts`, `engine-corrections.cjs`,
`model.ts`, `mechanics.ts`.

### 8.3 Wave 1: tracks in parallel

| Track | Owns (exclusive) | Implements | Depends on | Gate |
|---|---|---|---|---|
| A1 Stats, abilities, Transform | `doubles-stages.ts`, `doubles-abilities.ts`, `ability-table.ts` and its generator (`status2/build/gen-ability-table.ts`), `status2/build/classify-a1.md`, `tests/unit/doubles-stats-abilities.test.ts`, `tests/source/doubles-ability-table.test.ts` | §2.2's A1 rows, §4.2 | Step 1 | its tests; SAT cases (via V); golden byte-equal |
| A2 Types, volatiles, grounding | `doubles-typing.ts`, `status2/build/classify-a2.md`, `tests/unit/doubles-typing.test.ts`, `doubles-family2.test.ts`, `engine-corrections-effectiveness.test.ts` | §2.2's A2 rows, §4.3 | Step 1 | F2 and CR-07 cases |
| A3 Field, side, items | `doubles-field.ts`, `doubles-items.ts`, `status2/build/classify-a3.md`, `tests/unit/doubles-field-side-items.test.ts` | §2.2's A3 rows, §4.4 | Step 1; D's `tracksItems` for Recycle | FS cases |
| D Guards (the moves) | `doubles-guards.ts`, `doubles-spread.ts`, `doubles-start.ts`, `tests/unit/doubles-guards-*.test.ts` | §4.5 | Step 1; F for Fling | G4 cases (moves) |
| E End of turn | `doubles-eot.ts`, `residuals.ts`, `tests/unit/residuals.test.ts`, `doubles-eot.test.ts` | §4.6 (A2's, A3's and D's rows) | Step 1; D's ledger and `tracksItems` | G4 (end of turn), F2 residual cases, CR-01/02/05/09/11 |
| F Fling 1v1 | `calculate.ts`, the catalog generator and catalogs (the `fling` field), `fling.ts`, `golden-1v1.full.json.gz`, `tests/unit/fling-1v1.test.ts` | §4.7 | Step 0b | the verification sweep; golden differs only in the listed Fling rows |
| T Training | `app/(app)/training/**`, `scripts/training/*`, `tests/unit/training-*` | §6 | the engine fields (start against the contract) | the Training gates |
| U UI | `doubles-prep.ts`, `BattleConditions.tsx`, `useDoublesView.tsx`, `doubles-format.ts`, `DoublesCard.tsx`, `DoublesTurn.tsx`, `calculator.module.css`, `docs/champions-calculator.md`, `tests/unit/calculator-doubles-ui.test.ts` | §5 | the contract (fixture results) | UI tests; 375 px; a facts-only text review |
| V Oracle | `scripts/.cache/calc-audit/2v2/verify/**` (harness, `cases-sat.ts`, `cases-f2.ts`, `cases-fs.ts`, `cases-g4.ts`, `cases-cr.ts`), `status2/build/changed-cases.ts`, the generated `tests/unit/doubles-turn-showdown.test.ts` | §7 | the oracle side: none; the app side: the tracks | every case agrees |

`status-table.ts` is generated: each track regenerates it locally from its fragment; the integrator regenerates the merged
table. A track that needs a line in a frozen file asks the integrator (one line, reviewed).

### 8.4 Integration 1 (one builder)

1. Merge A1, A2, A3, D, E, F, then T, U, V; regenerate `status-table.ts`; take Magic Room, Corrosive Gas, Bestow and
   Embargo out of `GAS_CHANGING_MOVES` and extend `gasShieldGuard` with `itemSuppressed` (the two integrator lines).
2. Run every oracle case (1264 + about 300) and `changed-cases.ts`; store the re-run results; regenerate the tests.
3. `npm run check`; `golden-1v1 --check` (only F's listed rows differ); the bench; `conformance:training`,
   `leak:training`, `eval:training`.
4. Re-run the census sample (`census-sim.ts`, 8000 Champions and 2000 SV turns) and report the not-estimated share by
   reason, against census-guards' table.
5. A live check of `/calculator` 2v2 at 1280 px and 375 px: Skill Swap giving Intimidate; Soak then Thunderbolt; Magic
   Coat against Thunder Wave; Matcha Gotcha into two foes; Sheer Cold into a Sturdy and a non-Sturdy foe; Fling with a
   Life Orb; Shell Smash into a foe's Opportunist; the Stockpile control with Swallow; the Last move control with Encore;
   the Item used earlier control with Recycle; Psychic Noise then Recover.

### 8.5 Wave 2: switch-outs with a replacement (Q1 = R)

1. **Step 2** (the integrator): R's contract (§4.8; `DoublesTurnInput.bench`, `replacement`, `hazards`,
   `DoublesReplaced`, `DoublesTurnResult.replaced` and `hpEntered`, `DoublesOutcome.benched`, `MonState.id`,
   `World.benched`, `World.bench`; `turnNames` over the bench), `entersWithGas`; gate: behaviour unchanged as Step 0's.
2. **Tracks:** R-E owns `doubles-switch.ts`, `doubles-turn.ts`, `doubles-world.ts` and `doubles-eot.ts` for the wave
   (replaceSlot, the entry pipeline, identity); R-U the calculator's Bench, Replacement and Hazards (§5.2); R-T Training's
   bench, replacement policy, hazards and prelude (§6); R-V the oracle's mid-turn switch answers and the G4-SWX cases.
3. **Integration 2:** as integration 1, plus the SWX cases and the census sample's switch family.

### 8.6 Reviews and the final gate

Five reviewers (A1; A2 with A3; D with E and F; T; U with R), each with the cross-family checklist of §9, then one fixer;
at most two rounds. The final gate is FINAL.md's: every oracle case, the generated tests, golden, the Training gates, the
live check, written up as `status2/build/FINAL2.md`.

---

## 9. Test plan

- **Step 0:** `tests/source/status2-hooks.test.ts` (every moved guard keeps a call site until its track removes it; every
  hook named in §3.5 is called where §3.5 says); `tests/unit/status2-plumbing.test.ts` (each new build and context field
  through `calculateTurnMove` on synthetic builds against §3.6's probe numbers; `withSpecies` drops all four fields;
  `discreteKey` with `fieldSet`; carriedIssues' texts).
- **A1:** F1 §14 (`doubles-stats-abilities.test.ts`: writeStages, storedStats through every reader and every clone,
  weighthg, setAbility's End / Start tables with Opportunist's End (C7), Intimidate's gen gating, transformBuild with
  `timesAttacked` and the world types (C2), Stockpile counters, a snatched Swallow (C1), Spit Up's context);
  `doubles-ability-table.test.ts` (every catalog ability with a Start, End or Update handler is modelled or guarded).
- **A2:** F2 §11 (`doubles-typing.test.ts`, `engine-corrections-effectiveness.test.ts`: the vendored engine calls
  `getMoveEffectiveness` only at gen789.js:300, 302, 306, 839 and champions.js:169, 171; `isGrounded` read through util at
  call time), plus the grounding enabler (pinned and floating in the kernel, the step and the calculation).
- **A3:** F3 §12 (`doubles-field-side-items.test.ts`), plus Snatch's four dispatch points each with one test.
- **D:** F4 §10's `doubles-guards-*.test.ts` (ally, copies, items, ohko, spread-heal, lock, healblock, misc) with C5, C6,
  C7, C12.
- **E:** `residuals.test.ts` (the new keys and amounts), `doubles-eot.test.ts` (Heal Block / Embargo ending before the final
  Update: C3, C4; Pickup before Harvest: C8; Octolock's rise copied at 29: C9).
- **F:** `fling-1v1.test.ts` (the power table against `guards-probes-fling.out`, the failure rows, Uses to KO).
- **T:** the bridge (public sources only; the new mappings and the removed rollouts), the tracker's Stockpile counters,
  `postFromOutcome` and `nextClock`.
- **U:** labels and controls (shown only where read), the new conditions and residual lines, names never positions, 375 px.
- **V:** every case of §7.2; `changed-cases.ts` lists exactly the stored cases that change.
- **Cross-family checklist for reviewers:** Snatch steals each family's snatchable move (Stockpile, Swallow per C1, Minimize,
  Power Trick, Conversion, Camouflage, Recycle, Heal Bell); Magic Coat bounces Soak, Entrainment, Simple Beam, Worry Seed,
  Gastro Acid, Topsy-Turvy, Embargo, Defog, Purify; Transform after a type change, a stored-stat change and a Minimize;
  a Skill Swapped Protean (fresh once-per-entry state); Octolock or Syrup Bomb into Defiant beside a foe's Opportunist (C9);
  Mist against a mid-turn Intimidate (C10); Teatime with Pickup and Harvest in play (C8); Heal Block or Embargo with 1
  turn left and a Sitrus (C3, C4); Glaive Rush on a holder that moves first (C5).
- **1v1:** `golden-1v1.full.json.gz` byte-equal except F's rows; `calculator-uses-to-ko*` unchanged.

---

## 10. Risks

1. **Step 0's size.** It moves code into nine modules, adds about 40 fields and plumbs them through the kernel, the
   calculation and the pairwise step. Mitigation: two builders with disjoint files; every new reader keyed on a field
   nothing sets yet; the byte-equal gate over golden and all 1264 cases (facts included) before any track starts; the
   hooks source test.
2. **The ability Start / End table's breadth** (F1 risk 1): a missed handler silently changes a later number. The table
   is generated, and its source test fails on any ability with a Start, End or Update handler that is neither modelled nor
   guarded.
3. **The effectiveness scope depends on the vendored engine's call order** (F2 risk 1): the source test pins the call
   sites; the F2-FC, TT, TS and ME cases cover the products.
4. **`itemIgnored` replaces about 16 shared sites** (F2, F3): golden byte-equal pins 1v1; the F2-EM and FS17 cases pin
   Embargo.
5. **The spread drain's joint** (C12): measured on the census sample at integration 1. Acceptance: Matcha Gotcha turns
   ending `Too many cases to follow.` stay at or under a tenth of their share of not-estimated turns today (3.48 % of
   Champions turns). Above that, an exact reduction (dropping the attacker from the joint where no later step or residual
   reads it with a target) is designed separately; nothing approximate is allowed.
6. **More worlds** from the step's `rises`, item history and the new branches: the readers rule (§4.9); the bench at each
   integration.
7. **Fling's golden rows** change by design: the verification sweep is their gate, and the list of row ids is the only
   allowed difference.
8. **Training's numbers move** as more cells reach the engine (types, transformed and ability-changed builds, Heal Block,
   infatuation): the conformance and eval gates; the HabitBot gate is reported beside main's on the same seeds.
9. **Wave 2's identity change** (R) touches every slot-keyed hook: its own Step 2 gate, R-E owning the kernel for the wave,
   and the SWX cases.
10. **Cross-family interactions** are new surface (Snatch, Magic Coat, Transform, the copies): the CR probes cover the
    conflicts found; the reviewers' checklist (§9) covers the rest.
11. **Behaviour changes users will see:** 73 moves and many guards become estimated; Color Change, ally Defiant, the
    Champions lock and the Ghost Curse KO chance give new numbers. Each is stated as facts on the result.

---

## 11. Open questions for the user (each with a recommended default)

1. **Switch-outs: model the replacement?** (7.0 % of Champions turns, 9.3 % of the SV proxy; Eject Pack is SV and SwSh only.)
   - **Recommended: R**, in wave 2: the calculator gets a Bench per side (from the roster the slot came from), a
     Replacement per Pokémon that can switch out by its player's choice (default: the first bench Pokémon, with the fact
     `Assumes {Newcomer} comes in for {Name}.`) and hazard controls; Training uses its own bench and the belief bench. Exact
     for the switch, the newcomer's hazards and entry abilities, later moves into that position and its end of turn. Cost XL.
   - Alternative R0: Training and E2 only (cost L); the calculator keeps `{Name} switches out: the replacement is not
     known.`, so the Eject Pack guard stays where the user meets it.
   - Alternative K: keep the reason everywhere (no cost).
2. **Calculator inputs for state from earlier turns.**
   - **Recommended:** three controls: `Stockpile` (Swallow and Spit Up cannot be estimated without it), `Last move`
     (Disable, Encore, Conversion 2: 2.85 % of Champions turns today), `Item used earlier` (Recycle, Harvest). Everything
     else (types, an added type, infatuation, Heal Block and Embargo turns, Tar Shot, Telekinesis, Mist, Lucky Chant, the
     Sports, accuracy and evasion stages, the Berserk lock, Power Trick, No Retreat, Minimize, Gastro Acid, a changed
     ability, split stats, a transform) is assumed absent, as today; Training passes the real state.
   - Alternative: also F2's type controls (`Type`, `Second type`, `Added type`), `Infatuated by`, `Heal Block turns left`,
     F4's `Accuracy stage`, `Evasion stage` and `Berry locked`, F3's Mist, Lucky Chant and Sport toggles.
   - Alternative: no new controls; the three moves' facts and reasons stand.
3. **`Last move`'s default.**
   - **Recommended: Unknown**: Disable, Encore and Conversion 2 keep today's `{Move} needs {Name}'s move from the last
     turn.` until the user picks; picking one makes them exact (with an Encore that changes the move).
   - Alternative: "None since it came in", with the fact `Assumes {Name} used no move before this turn.` (then Encore and
     Disable fail by default, often wrong for a Pokémon that has been in).
4. **`Item used earlier`'s default.**
   - **Recommended: Unknown**: an itemless Recycle user is `Recycle needs {Name}'s item from an earlier turn.` and an
     itemless Harvest holder's end of turn is `Harvest needs {Name}'s item from an earlier turn.` until set.
   - Alternative: None, with `Assumes {Name} used no item before this turn.` (usually wrong for a Harvest holder with no item).
5. **The eight ability moves under Neutralizing Gas** (SV and SwSh; F1's phase 6), and Neutralizing Gas ending.
   - **Recommended: keep** `{Move} with Neutralizing Gas is not modelled in 2v2.` and `Neutralizing Gas ending is not
     modelled in 2v2.` in this build; a follow-up once A1's ability Starts have run in practice.
   - Alternative: phase 6 now (per-world gas stand-ins; the NG cases of `ngas-pp` as regression).
6. **The other census guards** (Tier 2, §2.3: semi-invulnerable, ally-effect, spread-effect, the presence and calling
   moves, Dancer, the Pledges, Focus Band, the G-Max effects, Future Sight landing, the end-of-turn form changes…).
   - **Recommended:** a follow-up build ("guards 2"), most of them reusing this build's enablers.
   - Alternative: add F4 §6's "Model" rows to wave 1 (about two tracks more).
7. **Training's value function** for the new volatiles (infatuation, Octolock, Heal Block, Stockpile, Minimize, Glaive Rush).
   - **Recommended:** no new weights now (they are read by the engine next turn, not valued); a Training-owner decision later.
   - Alternative: weights in `value-weights.ts`, re-tuned with the eval gates.
8. **Imposter in the calculator.**
   - **Recommended:** assume it transformed into the foe across as both entered (the 1v1's rules), with that fact.
   - Alternative: keep `Imposter is not modelled in 2v2.`
9. **Under R, the player's replacement in Training's evaluation.**
   - **Recommended:** the rollouts' healthiest-bench rule, as today.
   - Alternative: each legal replacement as its own engine input, folded by the player model (stronger; more calls).
10. **Attract or Captivate with a species of both genders and no gender set.**
    - **Recommended:** not estimated, `{Move} needs {Name}'s gender.`
    - Alternative: assume opposite genders, with a fact.
11. **Conversion in the calculator.**
    - **Recommended:** the first quick-move slot is the first move slot, with `Assumes {Move} is {Name}'s first move.`
    - Alternative: always `Conversion needs {Name}'s first move.` in the calculator.
12. **A once-a-battle ability gained mid-turn** (Intrepid Sword, Dauntless Shield, Supersweet Syrup by Skill Swap, Role Play,
    Entrainment, Doodle or Transform).
    - **Recommended:** its Start acts, with `Assumes {Name} has not had {Ability} before in this battle.`
    - Alternative: `{Ability} starting on {Name} is not modelled in 2v2.`
13. **Electrify or Ion Deluge on an own-type move, a Z-Move or a Max Move.**
    - **Recommended:** keep `{Move} with Electrify is not modelled in 2v2.` (under 0.01 % of turns).
    - Alternative: model Weather Ball's kept power, the Max Move re-pick and the Electric Z-Move.
