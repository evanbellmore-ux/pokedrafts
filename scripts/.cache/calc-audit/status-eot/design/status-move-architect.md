# 2v2 status moves — status-move architect design (status-eot)

Branch `calc-2v2-status-eot` from main `0ccce76`. Design step only: no `app/` or `tests/` edits. Ground truth: pinned Showdown
`c23d2e94` (`node_modules/.cache/champions/pokemon-showdown-c23d2e94…`, cited as `PS/…`), runnable copy
`scripts/.cache/calc-audit/showdown`. User request (verbatim): "do the status moves and end of turn". The v1 default "status moves
not estimated" (SPEC §11 Q2) is lifted: every status move a Pokémon in the four catalogs can use in doubles is modelled exactly or
guarded with a short fact, with every random event branched.

**Scope boundary.** The end-of-turn architect (`eot-architect.md`, same folder) owns the residual phase, `MonState.eot`
(`EotState`), `DoublesCarried`'s end-of-turn fields, `DoublesEndOfTurn`, the End of turn UI and the residual oracle cases. This
design owns what status moves (and the status conditions they leave) do **during the moves**: the BeforeMove chain, the status-move
pipeline, the moves-phase volatiles, the pre-turn sleep/freeze/confusion counters, and it **writes** the `EotState` fields the
residual phase reads (Leech Seed, Aqua Ring, Ingrain, Curse, Nightmare, Octolock, Yawn, Perish, Roost, Magnet Rise, Telekinesis,
Heal Block, a new "tox" stage 0). It provides `canSleep` (and `canStatus`) to the residual phase (Yawn at order 23).

**Probes** (all in this folder, run from the repo root with `npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/<file>`):
- `status-sim.ts`: harness — whole turns, **every random decision enumerated exactly** by decision-prefix replay (rolls optionally
  fixed at lowest), turn run **through** the residual (HP read at the residual pick and at the turn's end), forcing as the oracle
  (every move hits, chances below 100% fail, crits only when certain).
- `status-probes.ts` → `status-probes-1.out` (P1–P9), `status-probes-2.ts` → `status-probes-2.out`, `-2b`, `-2c`, `-2d` (Q1–Q28),
  `status-probes-3.ts` → `status-probes-3.out`, `-3b`, `-3c`, `-3d` (R1–R21), `status-probes-4.ts` → `status-probes-4.out` (counter
  posteriors), `status-probes-5.ts` → `status-probes-5.out` (D1–D2).
- `status-census.ts` → `status-census.out`: every Status-category move in the four catalogs (271) with pinned data (target, flags,
  boosts, status, volatile, conditions, handlers) and today's 2v2 handling. `status-classify.ts` → `status-classify.md`: the
  classification below (fails if a catalog move is unclassified). `status-residual-census.ts` → `status-residual-census.out`:
  the residual orders the moves' volatiles use (cross-check of `inventory.out`).

---

## 0. Summary of decisions

1. **One status-move pipeline in Showdown's order** (`PS/sim/battle-actions.ts` runMove 210 → useMoveInner 377 → trySpreadMoveHit
   550-620 → spreadMoveHit 1023-1137 → runMoveEffects 1186-1316), table-driven: BeforeMove chain → targets (redirection,
   retargeting) → Try/PrepareHit → per target: TryHit (guards, protection, reflection, absorbing abilities) → type immunity →
   TryImmunity (powder, move checks, Prankster vs Dark) → Substitute → effects in runMoveEffects order (boosts, heal, status,
   volatile, side/slot/field, onHit) → the action's Update (curing Berries, Mental Herb, HP Berries after a cost).
2. **The BeforeMove chain gets its full priority order with exact branches**: sleep and freeze (10), flinch (8), Disable (7),
   Gravity / Heal Block / Throat Chop (6), Taunt (5), Imprison (4), confusion (3, 33/100 self-hit with exact 16-roll damage),
   infatuation (2, 1/2), paralysis (1). "No move" runs it too (it is Splash: a confused Pokémon choosing No move can hurt itself).
3. **Status conditions from this turn are exact**: an inflicted sleep cannot end at its first BeforeMove (Early Bird: 1/3 does),
   a fresh confusion cannot end at its first, burn/paralysis/poison feed the pair engine through the build (halving, Speed re-sort
   from gen 8, Venoshock, Hex, Facade, Guts), and Lum/Chesto/Cheri/Pecha/Rawst/Persim cure at once.
4. **Statuses from before the turn**: freeze is exact in SV/SwSh/USUM with no input (1/5 per BeforeMove, memoryless); sleep,
   Champions freeze and confusion take an optional `attempts` counter and the engine uses the exact posterior (verified, §5); with
   no input the calculator assumes 0 attempts and says so in a turn fact; Training passes the public count.
5. **Classification of all 271 catalog status moves**: 167 modelled (M), 19 no effect this turn (N), 25 modelled under a condition
   or input else guarded (C), 23 guarded (G), 37 unchanged (X: today's modelled set, calling moves, Max Guard). The generic
   fallback `{Move} is not modelled and comes before another move.` becomes unreachable for catalog moves (source test).
6. **Two-level not-estimated stays the EOT architect's**: moves-phase guards make the whole turn not estimated (as today); a
   status move whose only unknown is what happens at the end (a switch-out with no later action) makes only the end of turn not
   estimated.
7. **Contract**: `DoublesHit.kind` gains `"effect"` (a status move reached and acted) with `change` (HP from a status move) and its
   facts; `DoublesStep` gains `repeat` (Instruct); `DoublesHP.conditions` (statuses/volatiles after the moves, as facts);
   `DoublesPokemonInput` gains `lastMove`, `moves`; `DoublesCarried` gains the moves-phase fields (`sleep`, `freeze`, `confusion`,
   `infatuation`, `substitute`, `taunt`, `disabled`, `stockpile`, `noRetreat`, `focusEnergy`, `dragonCheer`, `imprisoning`);
   `DoublesOutcome` gains `positions` (Ally Switch), per-mon `volatiles`, per-side `hazards`, `wish`, `partyCured`.
8. **Training**: fewer rollouts (status-move cells become engine cells), bridge maps the moves-phase volatiles into `carried`
   from the public tracker (attempt counts, never Showdown's hidden counters), E2 outcomes carry the volatiles the value function
   weighs; conformance and leak gates stay.
9. **Oracle**: the residual-running `sim-dfs.ts` (EOT §10) plus: `CHANCE_EFFECTS` += `attract`; carried moves-phase volatiles in
   `prepare()`; **hidden-counter expansion** (posterior over Showdown's `time`/`startTime` from `attempts`, mixed by weight) to
   validate §5; per-target status lines tallied and compared with the app's hit facts; ~70 new `S` cases.

---

## 1. Verified ground truth (probe → claim → Showdown source)

| Probe | Claim | Source |
|---|---|---|
| P1 (sv, champions, usum) | A sleep inflicted this turn never ends at the target's first BeforeMove; Early Bird: 1/3 wakes at once | `PS/data/conditions.ts:47-82` slp (`random(2,5)`, time--, Early Bird twice), `PS/data/mods/champions/conditions.ts:11-30` (`sample([2,3,3])`) |
| P2, R17 | Yawn: no sleep at this end of turn; sleep at the next (order 23), then Bad Dreams (28.2) the same residual | `PS/data/moves.ts:21132-21160` |
| P3 | Thunder Wave on a faster foe: from gen 8 (SwSh, SV, Champions) it moves after a slower Pokémon; gen 7 keeps the start order | `PS/data/conditions.ts:20-46` par onModifySpe; `PS/sim/battle.ts` re-sort (SPEC §2.2) |
| P4 | Confusion: self-hit 33/100 at BeforeMove; 40 BP from **stored** Atk/Def with stages, 16 rolls (Snorlax 23–28; +2 Atk 46–55) | `PS/data/conditions.ts:162-197`; `PS/sim/battle-actions.ts:1850-1862` getConfusionDamage; `PS/sim/pokemon.ts:560-596` calculateStat (Wonder Room swaps Def/SpD) |
| P5 | Taunt: a later status move fails at BeforeMove (`cant … move: Taunt`) | `PS/data/moves.ts:18975-19011` |
| P6 | Will-O-Wisp halves a later physical hit (52 → 26) and burns 1/16 at the end (235 → 221) | getDamage burn; `PS/data/conditions.ts:2-19` |
| P7 | Full paralysis 1/4 (SV), 1/8 (Champions) for a paralysis inflicted this turn | `PS/data/conditions.ts:39-45`; `PS/data/mods/champions/conditions.ts:2-10` |
| P8 | Freeze from before the turn: SV thaws 1/5 at each BeforeMove (0.8, 0.64, 0.512 still frozen); Champions 1/4, 1/4, then certain | `PS/data/conditions.ts:83-122`; `PS/data/mods/champions/conditions.ts:31-55` |
| P9 | Attract: 1/2 immobilised | `PS/data/moves.ts:706-760` (onBeforeMovePriority 2, line 742) |
| Q1 | Trick a Choice Scarf onto a slower foe: it now moves before the slower ally (gen 9 re-sort) | `PS/data/moves.ts:19866-19911` |
| Q2 | Skill Swap's new Intimidate acts at once (old End, new Start); Worry Seed cures sleep, the target then moves | `PS/sim/pokemon.ts:1908-1959` setAbility; `PS/data/moves.ts:21051` |
| Q3 | Quash → last; After You → next (gen 9 and gen 7) | `PS/data/moves.ts:195-216, 14455-14472`; `PS/data/mods/gen7/moves.ts:750-766`; `PS/sim/battle-queue.ts:277-287` |
| Q4 | Ally Switch: a move aimed at a position hits whoever stands there after the swap | `PS/data/moves.ts:302-345`; `PS/sim/battle.ts:1588` swapPosition |
| Q5a–e | Heal Pulse ceil(1/2) (164 from 1); Life Dew round(1/4) both (52, 25); Moonlight in sun modify 0.667 (114), Umbrella 0.5 (86); Recover round(1/2) (119); Strength Sap = stat with stages (14 → 140 capped), Atk −1; Pain Split floor(sum/2) (112); Floral Healing in Grassy modify 0.667 (218); Jungle Healing modify(maxhp, 0.25) + cure; Roost: a later Earthquake hits | `PS/data/moves.ts:8400, 10287, 12243, 18175, 13129, 5819, 9857, 15429` |
| Q6, Q6b, R19 | Substitute costs floor(maxhp/4); a status move into it fails (Volt Absorb still absorbs Thunder Wave in TryHit); a sound move passes; a hit breaks it; a multi-hit continues into the Pokémon | `PS/data/moves.ts:18305-18375` |
| Q7 | Psych Up copies stages and Focus Energy | `PS/data/moves.ts:14212-14238` |
| Q8, Q8b | Magic Bounce sends Thunder Wave back at its user; a spread String Shot is reflected onto the user's whole side (the other foe still takes the original) | `PS/data/abilities.ts:2437-2462` |
| Q9 | Prankster status move into a Dark foe: immune | `PS/sim/battle-actions.ts:666-689` |
| Q10, Q10b | Electric Terrain stops sleep on a grounded Pokémon; Sweet Veil (ally) blocks sleep | `PS/data/moves.ts` electricterrain onSetStatus; `PS/data/abilities.ts:4786-4805` |
| Q11 | Chesto Berry cures a sleep at once; the Pokémon then moves | `PS/data/items.ts:877` |
| Q12 | Ghost Curse: user −floor(maxhp/2), target −floor(maxhp/4) at the end (order 12); Belly Drum −floor(maxhp/2), Atk 6 | `PS/data/moves.ts:3266, 1216` |
| Q13 | Memento: target −2/−2, user faints at once, no replacement until the turn ends | `PS/data/moves.ts:11621` (selfdestruct ifHit) |
| Q14 | Acupressure: one of 7 stats (accuracy and evasion included) uniformly, +2 | `PS/data/moves.ts:137` |
| Q15 | Teeter Dance confuses the ally and both foes; Own Tempo immune | `PS/data/moves.ts:19100` |
| Q16, R20 | Endure: a KO hit leaves 1 HP (priority +4) | `PS/data/moves.ts:4806` |
| Q17 | Crafty Shield blocks the user's own ally's Heal Pulse too (USUM) | `PS/data/moves.ts:3143` |
| Q18 | Instruct: the target repeats its move at once (it moved this turn) | `PS/data/moves.ts:9642-9672` |
| Q19 | Encore on a Pokémon that has moved: no effect this turn | `PS/data/moves.ts:4725-4782` |
| Q20 | Heal Block (USUM): Sitrus and Leftovers blocked | `PS/data/moves.ts:8274` |
| Q21 | Focus Energy + Scope Lens (stage 4): every later hit crits (certain) | crit table gen 7+ |
| Q22, Q22b | Rest: full HP, sleep, poison cured; Synchronize returns Toxic as bad poison; both take 1/16 | `PS/data/moves.ts:14958`; `PS/data/abilities.ts:4857` |
| Q23 | Champions Healer 1/2, Shed Skin 1/3 | `PS/data/mods/champions/abilities.ts:26-36`; `PS/data/abilities.ts:4187` |
| Q24 | Good as Gold blocks a foe's Thunder Wave and its ally's Heal Pulse | `PS/data/abilities.ts:1630` |
| Q25, Q25b | Lightning Rod takes a foe's Thunder Wave (+1 Sp. Atk, no status); Sap Sipper absorbs Spore (+1 Atk) | `PS/data/abilities.ts:2343, 4023` |
| Q26 | Follow Me takes a single-target status move | `PS/data/moves.ts` followme |
| Q27 | Wide Guard blocks a spread status move | `PS/data/moves.ts` wideguard |
| Q28 | Toxic this turn: 1/16 at this end; Toxic Thread Spe −1 (SV) / −2 (Champions) then poison | `PS/data/mods/champions/moves.ts` toxicthread |
| R1a–d | Confusion self-hit: Sturdy keeps full-HP Pokémon at 1; Disguise takes it (busted, then 1/8); Magic Guard does **not** stop it; Sitrus eaten at the action's Update; Assurance doubles after it (hurtThisTurn) | `PS/data/abilities.ts:4673, 970`; `PS/sim/battle.ts:2138` |
| R2 | Thunder Wave: Ground immune (ignoreImmunity false); Glare hits Ghost | `PS/data/moves.ts:19602` |
| R3 | Will-O-Wisp activates Flash Fire; Well-Baked Body +2 Def | `PS/data/abilities.ts:1341, 5459` |
| R4, R4b | Psychic Terrain and Quick Guard stop a Prankster status move | `PS/data/moves.ts` psychicterrain, quickguard |
| R5, R5b | Safeguard: Swagger's +2 lands, confusion and Thunder Wave blocked; Mist blocks Screech; Infiltrator passes Mist | `PS/data/moves.ts:15576, 12072` |
| R6, R6b | Clear Body, Defiant (+2 on a drop), Mirror Armor (Charm back onto its user) | `PS/data/abilities.ts:523, 901, 2657` |
| R7 | Oblivious stops Taunt; Mental Herb ends Taunt at once (the status move then works) | `PS/data/abilities.ts:3008`; `PS/data/items.ts:3885-3912` |
| R8a–c | Insomnia, Limber, Purifying Salt, Own Tempo (Swagger: +2 lands), Leaf Guard in sun, Water Veil | abilities.ts as listed in §3.6 |
| R9, R9b | Encore / Disable on a Pokémon still to move use its **last move** (Encore: random target, `sample`) | `PS/data/moves.ts:4725, 3649`; `PS/data/mods/champions/moves.ts:277-313` |
| R10 | Imprison: a foe's move that the user knows fails | `PS/data/moves.ts:9490-9523` |
| R11, R11b | Trick hands a Sitrus to a foe below half: eaten at once; Sticky Hold makes it fail | `PS/data/moves.ts:19866-19911` |
| R12 | Charge: Sp. Def +1, the next Electric move doubles | `PS/data/moves.ts:2264` |
| R13 | Defog: the target's side screens and the terrain (gen 8+) end | `PS/data/moves.ts:3448` |
| R14 | Magic Room set mid-turn: a later Sitrus is not eaten | `PS/data/moves.ts:10755` |
| R15 | Belly Drum fails at exactly half; non-Ghost Curse +1/+1/−1 | `PS/data/moves.ts:1216, 3266` |
| R16 | After You on a Pokémon that has moved fails | `PS/data/moves.ts:195-216` |
| R18 | Leech Seed this turn drains at this end; Liquid Ooze hurts the seeder; Big Root ×1.3 | `PS/data/moves.ts:10203-10230`; `PS/data/items.ts:482` |
| R21 | Perish Song: count 3 at this end of turn; Soundproof immune | `PS/data/moves.ts:13234` |
| status-probes-4 | Posterior wake/snap chances per attempt k = 1..: sleep SV/USUM 0, 1/3, 1/2, 1; Champions 0, 1/3, 1; Early Bird 1/3, 1; confusion 0, 1/4, 1/3, 1/2, 1 | §5 formulas |
| D1 | Destiny Bond: the foe that knocks its user out faints too | `PS/data/moves.ts:3483-3530` |
| D2 | Stuff Cheeks: Def +2 then the Berry eaten at any HP; Teatime: every Pokémon eats its Berry at any HP | `PS/data/moves.ts:18253, 19036` |

---

## 2. The pipeline (what the engine mirrors)

### 2.1 BeforeMove (`PS/sim/battle-actions.ts` runMove → `runEvent('BeforeMove')`, stops at the first `false`)

Handlers by priority (highest first), each a branch where random. "Skipped" facts go in `DoublesStep.skipped`.

| Priority | Check | Engine state | Outcome / branch weight | Skip fact |
|---|---|---|---|---|
| 11 | Recharge (`PS/data/conditions.ts:364`) | Training only (No move) | — | — |
| 10 | Sleep (`slp`): time −= 1 (Early Bird −2), wakes at ≤ 0 (`conditions.ts:66-81`) | `vol.sleep { elapsed, rest }` | wake with h = P(e < S ≤ e+d) / P(S > e) (§5) → status cleared, Nightmare ends, continues; else stopped unless the move is sleep-usable (Snore; Sleep Talk stays guarded) | `Asleep.` (+ step fact `Wakes up.` with its chance) |
| 10 | Freeze (`frz`): a defrost move thaws its user; else SV/SwSh/USUM 1/5, Champions time −= 1, thaw at ≤ 0 or 1/4 | `vol.freeze { attempts }` (Champions) | thaw → continues; else stopped | `Frozen.` / `Thaws.` |
| 9 | Truant | unchanged (not in this scope) | — | — |
| 8 | Flinch | exists | — | `Flinches (Fake Out).` |
| 7 | Disable (`moves.ts:3698`): the disabled move (not a Z-Move) | `vol.disabled` | stopped | `Disable: {Move} cannot be used.` |
| 6 | Gravity (exists); Heal Block (`moves.ts:8308`): a `heal`-flag move (not Z); Throat Chop (exists) | `eot.healBlock` | stopped | `Heal Block: {Move} cannot be used.` |
| 5 | Taunt (`moves.ts:19005`): a status move (not a Z-Move; Me First passes) | `vol.taunt` | stopped | `Taunt: {Move} cannot be used.` |
| 4 | Imprison (foe's, `moves.ts:9512`): a move the Imprison user knows (not Z/Max) | `vol.imprisoning` on a foe | stopped | `Imprison: {Move} cannot be used.` |
| 3 | Confusion (`conditions.ts:179-196`): time −= 1, ends at 0; else 33/100 self-hit | `vol.confusion { attempts }` | snap-out with h = P(T = k+1) / P(T > k); then hit 0.33 / 0.67 | `Hurts itself in confusion.` (+ `Snaps out of confusion.`) |
| 2 | Infatuation (`moves.ts:742`): source still active | `vol.infatuated` (slot) | 1/2 stopped | `Infatuated (Attract).` |
| 1 | Paralysis (exists) | — | 1/4, Champions 1/8 | `Fully paralysed.` |
| −1 | Destiny Bond ends when its user moves again | exists | — | — |

Rules:
- The chain runs for **No move** too (Showdown runs Splash): a confused or infatuated Pokémon choosing No move rolls exactly as
  Showdown does (oracle cases use Splash, Q15). Its skip facts go on a step only if the slot has a move; for No move the self-hit
  appears as a step-less HP change with the fact `{Name} hurts itself in confusion.` under the turn (`DoublesHP.heals` style list
  `losses`, see §7).
- Order of random draws doesn't matter for weights (independent events), but each check runs only if the earlier ones passed.
- A sleeping or frozen Pokémon is still "moved" for queue purposes (Payback, Sucker Punch fail, Helping Hand) — as today for a
  flinch (`moved: true`).
- `focusLost` / `flinched` checks keep their places.

### 2.2 Targets
Status moves use the existing `resolveTargets()` (they are moves): a single-target status move is redirected by Follow Me, Rage
Powder (not to powder-immune users) and Spotlight (Q26), and by Lightning Rod / Storm Drain for an Electric / Water status move
(Q25: Thunder Wave, Soak) — `onAnyRedirectTarget` reads `move.type` only (`PS/data/abilities.ts:2343-2366`); a move aimed at a
fainted foe goes to the other foe; spread status moves (`allAdjacentFoes`, `allAdjacent`) hit in `spreadTargets()` order. Target
types with no Pokémon (`self`, `allies`, `allySide`, `foeSide`, `all`, `allyTeam`, `adjacentAllyOrSelf` chosen self) skip
redirection. `allies` (Life Dew, Howl, Jungle Healing, Lunar Blessing) = user + living ally, no TryHit per ally
except Soundproof/Good as Gold where the move's handler checks (Heal Bell).

### 2.3 Try / PrepareHit
- Move `onTry` failures (table field `tryFails`): Dark Void not Darkrai; Rest at full HP / sleep-immune (Insomnia, Vital Spirit,
  Comatose, Electric/Misty Terrain grounded, Sweet Veil ally); Belly Drum at ≤ 1/2 HP or +6 Atk (`hp <= maxhp/2`); Fillet Away
  same; Clangorous Soul `hp <= maxhp*33/100`; Substitute when one is up or HP ≤ maxhp/4; Stockpile at 3; Swallow/Spit Up at 0;
  Stuff Cheeks without a Berry; Teleport/Healing Wish/Lunar Dance with no Pokémon to switch in (`canSwitch`, §7 input);
  No Retreat while its volatile is up; Wish while one is pending in the slot; Magnet Rise while grounded by Ingrain/Smack Down/
  Gravity or already up; Mat Block not on its first turn (fact); Endure/Protect stall (fact); Ally Switch gen 9 counter (fact).
- Protean/Libero (exists, `proteanGuard`); King's Shield Stance Change (exists).

### 2.4 Per target, in Showdown's hit-step order (`PS/sim/battle-actions.ts:550-620`)
0. Invulnerability: semi-invulnerable targets are guarded already; Commander target (guarded presence).
1. **TryHit** (`runEvent('TryHit')`, handler priority order):
   - Wide Guard (priority 4 handler) vs a spread status move (Q27); Quick Guard vs priority > 0.1 (Prankster, Q4b/R4b);
     **Crafty Shield** (`PS/data/moves.ts:3143-3170`) vs any status move into its side whose target type is not `self`/`all`
     (the ally's too, Q17); Protect family vs the `protect` flag (status moves **without** it, from the census: Play Nice,
     Tearful Look, Mean Look, Block, Psych Up, After You, Role Play, Decorate, Acupressure, Aromatic Mist, Coaching, Heal Bell,
     the self/side/field moves — table flag `protect`), Mat Block only damaging.
   - **Magic Coat** (holder, priority 2) / **Magic Bounce** (priority 1, breakable): a `reflectable` move not already bounced, not
     from the holder → the move is re-used by the holder at the original user (single target) or at the user's side (spread,
     `onAllyTryHitSide` for side moves: hazards land on the user's side); `pranksterBoosted` false on Magic Bounce (Q8, Q8b).
   - Absorbing abilities (breakable; not from the holder itself): Volt Absorb / Lightning Rod / Motor Drive (Electric), Water Absorb /
     Storm Drain / Dry Skin (Water), Sap Sipper (Grass), Flash Fire / Well-Baked Body (Fire), Earth Eater (Ground), Wind Rider
     (wind flag: Whirlwind) — same effects as for damaging moves (`ABSORBING`), with the move's type (Q6, Q25b, R3).
   - **Good as Gold** (breakable): any status move from another Pokémon (Q24); **Soundproof** (breakable): sound flag;
     **Overcoat** and **Safety Goggles** (gen 6+): powder; Psychic Terrain: a priority move from a foe into a grounded target (R4);
     Telepathy only damaging.
2. **Type immunity**: status moves ignore it (`ignoreImmunity` defaults true for Status, `battle-actions.ts:654-664`) except
   `ignoreImmunity: false` (Thunder Wave: Ground immune, R2). Table field.
3. **TryImmunity** (`battle-actions.ts:666-689`): powder vs Grass types (gen 6+); move `onTryImmunity` (Attract/Captivate gender,
   Leech Seed vs Grass, Trick/Switcheroo vs Sticky Hold, Worry Seed vs Truant/Insomnia, Octolock vs Ghost (`getImmunity('trapped')`)
   — table); Prankster's
   boosted status move into a non-ally Dark type (Q9; a bounced move is never Prankster-boosted).
4. Accuracy: every move hits (existing assumption, `Every move hits; …`).
5. **Substitute** (`TryPrimaryHit`, `moves.ts:18339-18343`): a status move into a target behind a Substitute fails unless the
   target is the user, the move has `bypasssub`, or the user has Infiltrator (`move.infiltrates`) — census list of `bypasssub`
   status moves in §3.
6. **Effects** (`runMoveEffects`, `battle-actions.ts:1186-1316`), in this order per target: `boosts` (via `boost()`), `heal`,
   `status` (`trySetStatus`), `forceStatus`, `volatileStatus`, side / slot / weather / terrain / pseudo-weather, `forceSwitch`,
   `onHit`; then `self` effects (Toxic Thread is boosts-then-status; Swagger boosts-then-confusion; Memento's user faints after a
   hit; Parting Shot drops then switch).
7. **The action's Update** (`PS/sim/battle.ts:2860`): curing Berries (Lum also confusion, `items.ts:3533-3552`; Chesto, Cheri,
   Pecha, Rawst, Aspear, Persim), Mental Herb (attract, taunt, encore, torment, disable, heal block, `items.ts:3885-3912`), HP and
   pinch Berries after a cost or a confusion self-hit, Cheek Pouch; Unnerve/As One stop Berries (existing `berryStopped`).

### 2.5 `boost()` for status moves (`PS/sim/battle.ts:2020`)
Existing `foeDrop`/`selfBoost` extended into one `applyBoosts(ctx, w, target, boosts, source, move)`:
- Order of `onTryBoost`: Mist (side, others' drops; Infiltrator foes pass), Flower Veil (Grass ally: drops from others, breakable),
  Clear Amulet, Clear Body / White Smoke / Full Metal Body (others' drops, breakable except Full Metal Body), Hyper Cutter (Atk),
  Big Pecks (Def), Keen Eye / Mind's Eye (accuracy), Mirror Armor (reflects the drops onto a living source, R6b), then Contrary,
  Simple (`onChangeBoost`), ±6 cap.
- After: Defiant (+2 Atk) / Competitive (+2 Sp. Atk) on any drop from a foe (accuracy and evasion drops included), `statsLowered`
  (Lash Out), `statsRaised` (Burning Jealousy, Alluring Voice), Opportunist / Mirror Herb (guarded, existing), Eject Pack (switch
  guard), White Herb (existing timing).
- Accuracy and evasion stages: not stored (no calculation reads them: every move hits) but the reactions above run (Sweet Scent
  into Defiant → +2 Atk).
- Ally-sourced boosts are "from another Pokémon": Clear Body and Mirror Armor apply to an ally's drop too (`target !== source`).

### 2.6 `setStatus` for status moves (`PS/sim/pokemon.ts:1684-1748`)
`canStatus(ctx, w, slot, status, source, effect)` (also used by the EOT phase for Yawn) returns the blocking fact or null:
already a status (`{Move} fails: {Name} is already {status}.`, the same status, Rest excepted), Comatose, `runStatusImmunity` types
(Fire–brn, Electric–par from gen 6, Poison/Steel–psn/tox unless the source has Corrosion, Ice–frz), Safeguard (side, from any other
Pokémon, an Infiltrator foe passes; it blocks the Yawn volatile at `onTryAddVolatile` but **not** the sleep a Yawn already in place
gives at the end of turn: `onSetStatus` returns early for `effect.id === 'yawn'`, `PS/data/moves.ts:15595-15607`), Misty Terrain (grounded, any status), Electric
Terrain (grounded, sleep), Uproar in play (sleep: guarded, §3.3), Leaf Guard in sun (effectiveWeather, Umbrella), Shields Down
Meteor form, Purifying Salt, Insomnia / Vital Spirit (slp), Limber (par), Water Veil / Water Bubble / Thermal Exchange (brn),
Immunity / Pastel Veil (psn, tox; Pastel Veil on the ally too), Sweet Veil (slp, the ally too), Flower Veil (Grass on its side,
others' status), all breakable by Mold Breaker / ignoreAbility moves unless Ability Shield. Then: Synchronize returns psn/tox/par/
brn to the source (Q22b), the curing Berry eats it at once (Lum, Chesto, …; Unnerve stops), Cheek Pouch.

---

## 3. Every status move (the exact list)

### 3.1 Classification table (generated: `status-classify.md`)

Kinds: **M** modelled exactly; **N** no effect on this turn (exact by doing nothing; what it leaves is listed); **C** modelled when
its condition/input holds, otherwise guarded with the fact shown; **G** guarded (the fact); **X** unchanged (today's modelled set,
calling moves, Max Guard). "Today" is the current handling (`before-guard` = `{Move} is not modelled and comes before another
move.` with a later action).

| Move | Games (learners) | Today | Design | Effect this turn / guard fact |
|---|---|---|---|---|
| acidarmor | champions:20 sv:43 swsh:38 usum:35 | before-guard | M | Def +2 |
| acupressure | champions:8 sv:20 swsh:19 usum:17 | before-guard | M | +2 to one random stat among the 7 below +6 (sample): one world per stat, 1/n each |
| afteryou | champions:18 sv:32 swsh:84 usum:121 | before-guard | M | target's action order 3 (next); fails if it has moved; gen 7: moved to the front of the frozen queue |
| agility | champions:105 sv:281 swsh:185 usum:182 | before-guard | M | Spe +2 (re-sort from gen 8) |
| allyswitch | champions:31 sv:32 swsh:164 usum:190 | before-guard | M | the two Pokémon swap positions (priority +2): chosen targets are positions; gen 9 fact `Assumes Ally Switch was not used last turn.` |
| amnesia | champions:46 sv:117 swsh:123 usum:127 | before-guard | M | Sp. Def +2 |
| aquaring | champions:13 sv:47 swsh:47 usum:63 | before-guard | M | 1/16 heal at the end of turn (order 6, Big Root) |
| aromatherapy | swsh:54 usum:86 | before-guard | M | cures the user's and its team's statuses except a Sap Sipper, Good as Gold or (without Infiltrator) Substitute Pokémon other than the user; the bench's in the E2 outcome |
| aromaticmist | champions:14 sv:25 swsh:29 usum:9 | before-guard | M | ally Sp. Def +1 |
| attract | champions:116 sv:24 swsh:623 usum:851 | before-guard | M | infatuation (opposite genders; Oblivious, Aroma Veil; Destiny Knot back; Mental Herb) |
| autotomize | swsh:27 usum:47 | before-guard | C | Spe +2; its weight -100 kg changes Low Kick, Grass Knot, Heat Crash, Heavy Slam: guarded only when one of those later hits it or is its own (`Autotomize changes {Name}'s weight: later moves are not modelled.`) |
| babydolleyes | champions:41 sv:51 swsh:46 usum:53 | before-guard | M | Atk -1 (priority +1) |
| barrier | usum:47 | before-guard | M | Def +2 |
| bestow | usum:43 | before-guard | M | gives its item to an itemless target (USUM) |
| block | champions:19 sv:43 swsh:110 usum:143 | before-guard | N | trap only |
| bulkup | champions:74 sv:137 swsh:90 usum:116 | before-guard | M | Atk +1 Def +1 |
| calmmind | champions:122 sv:253 swsh:177 usum:261 | before-guard | M | Sp. Atk +1 Sp. Def +1 |
| camouflage | usum:50 | before-guard | G | as Soak |
| captivate | usum:541 | before-guard | M | Sp. Atk -2 on opposite-gender foes (Oblivious immune) |
| charge | champions:30 sv:81 swsh:55 usum:51 | before-guard | M | Sp. Def +1 and charged (its next Electric move this turn doubles; MonState.charged) |
| charm | champions:111 sv:238 swsh:159 usum:168 | before-guard | M | Atk -2 |
| coaching | champions:38 sv:57 swsh:53 | before-guard | M | ally Atk +1 Def +1 |
| coil | champions:7 sv:17 swsh:9 usum:17 | before-guard | M | Atk +1 Def +1 (accuracy +1 not read) |
| confide | sv:4 swsh:640 usum:1013 | before-guard | M | Sp. Atk -1 (sound) |
| confuseray | champions:94 sv:200 swsh:97 usum:119 | before-guard | M | confusion (fresh: no snap-out this turn) |
| conversion | sv:4 swsh:3 usum:4 | before-guard | G | as Soak |
| conversion2 | sv:4 swsh:3 usum:4 | before-guard | G | as Soak |
| corrosivegas | champions:7 swsh:17 | before-guard | G | `Corrosive Gas is not modelled in 2v2.` |
| cosmicpower | champions:14 sv:42 swsh:28 usum:57 | before-guard | M | Def +1 Sp. Def +1 |
| cottonguard | champions:18 sv:11 swsh:11 usum:29 | before-guard | M | Def +3 |
| cottonspore | champions:5 sv:11 swsh:9 usum:18 | before-guard | M | Spe -2 on both foes (powder) |
| courtchange | champions:1 sv:2 swsh:1 | before-guard | M | swaps the two sides' screens, Tailwind, Safeguard, Mist, Lucky Chant (and hazards) |
| craftyshield | swsh:7 usum:6 | before-guard | M | side flag: blocks every status move into its side whose target type is not self or all, from any Pokémon (its ally's too, Q17); fails with no action after it (queue.willAct) |
| darkvoid | sv:1 usum:2 | before-guard | M | slp on both foes; only Darkrai (onTry), else fails |
| decorate | champions:9 sv:10 swsh:9 | before-guard | M | target Atk +2 Sp. Atk +2 |
| defendorder | sv:2 swsh:1 usum:2 | before-guard | M | Def +1 Sp. Def +1 |
| defensecurl | sv:80 swsh:142 usum:219 | before-guard | C | Def +1; guarded only when its own later Rollout or Ice Ball follows (`Defense Curl is not modelled with Rollout.`) |
| defog | champions:15 sv:50 swsh:134 usum:229 | before-guard | M | target's side screens/Safeguard/Mist and both sides' hazards cleared, the terrain ended (gen 8+); evasion -1 on the target |
| disable | champions:46 sv:79 swsh:79 usum:103 | before-guard | C | target moved this turn: no effect; else needs `lastMove` (`Disable needs {Name}'s move from the last turn.`); its queued move = lastMove fails |
| doodle | sv:2 | before-guard | M | user and ally copy the target's ability (SV) |
| doubleteam | champions:58 sv:74 swsh:643 usum:1012 | before-guard | M | evasion +1: nothing read (every move hits) |
| dragoncheer | champions:34 sv:63 | before-guard | M | ally crit stage +1 (+2 if Dragon): new build field `dragonCheer`; only a certain crit changes damage |
| dragondance | champions:35 sv:84 swsh:63 usum:52 | before-guard | M | Atk +1 Spe +1 (dance) |
| eerieimpulse | champions:29 sv:71 swsh:40 usum:20 | before-guard | M | Sp. Atk -2 |
| electrify | champions:1 swsh:3 usum:3 | before-guard | C | guarded when the target still moves (`Electrify changes {Move}'s type: not modelled.`) |
| embargo | usum:118 | before-guard | C | items off for its target: guarded when an item of the target acts later (incl. end of turn) (`Embargo is not modelled.`), else no effect |
| encore | champions:81 sv:182 swsh:132 usum:108 | before-guard | C | target moved this turn: no effect; else needs `lastMove`; the action becomes lastMove at a random valid target (Champions recomputes priority, data/mods/champions/moves.ts) |
| endure | champions:395 sv:914 swsh:769 usum:631 | before-guard | M | survives every damaging hit this turn at 1 HP (turn-mode env in the hit loop); stall fact as Protect |
| entrainment | champions:22 sv:35 swsh:26 usum:30 | before-guard | M | gives its ability to the target (Start runs) |
| extremeevoboost | usum:0 | before-guard | X | Z-Move: no learner |
| fairylock | champions:1 sv:2 swsh:1 usum:2 | before-guard | N | trap only |
| faketears | champions:80 sv:145 swsh:97 usum:83 | before-guard | M | Sp. Def -2 |
| featherdance | champions:25 sv:62 swsh:22 usum:47 | before-guard | M | Atk -2 (dance: Dancer guarded) |
| flash | usum:418 | before-guard | M | accuracy -1 (as Sand Attack) |
| flatter | champions:18 sv:46 swsh:29 usum:36 | before-guard | M | Sp. Atk +1 then confusion |
| flowershield | swsh:4 usum:11 | before-guard | M | every Grass type Def +1 |
| focusenergy | champions:67 sv:92 swsh:120 usum:122 | before-guard | M | crit stage +2 (build.settledFocusEnergy; same volatile as Lansat, no stack): only a certain crit (stage 4 from gen 7) changes damage |
| foresight | usum:88 | before-guard | C | guarded when a later Normal/Fighting move hits a Ghost target (USUM) |
| forestscurse | champions:1 sv:3 swsh:2 usum:3 | before-guard | G | as Soak |
| gastroacid | champions:8 sv:20 swsh:29 usum:49 | before-guard | M | target's ability suppressed (stand-in ability) |
| gearup | swsh:3 usum:3 | before-guard | M | Plus/Minus Pokémon on its side Atk +1 Sp. Atk +1 |
| geomancy | swsh:1 usum:2 | before-guard | M | charge turn (no effect) unless Power Herb: Sp. Atk/Sp. Def/Spe +2 |
| glare | champions:6 sv:12 swsh:10 usum:15 | before-guard | M | par (hits Ghost) |
| grasswhistle | usum:49 | before-guard | M | slp (sound: Soundproof) |
| growl | sv:174 swsh:138 usum:207 | before-guard | M | Atk -1 on both foes (sound) |
| growth | champions:24 sv:79 swsh:47 usum:67 | before-guard | M | Atk +1 Sp. Atk +1, +2 each in sun (effectiveWeather, Utility Umbrella) |
| grudge | swsh:30 usum:33 | before-guard | N | PP only |
| guardsplit | champions:7 sv:12 swsh:24 usum:28 | before-guard | G | `Guard Split is not modelled in 2v2.` |
| guardswap | champions:24 sv:12 swsh:64 usum:37 | before-guard | M | Def/Sp. Def stages swapped |
| happyhour | sv:2 swsh:15 usum:18 | before-guard | N | nothing |
| harden | sv:69 swsh:71 usum:112 | before-guard | M | Def +1 |
| haze | champions:39 sv:101 swsh:81 usum:90 | before-guard | M | every stage to 0 |
| healbell | champions:2 sv:5 swsh:58 usum:101 | before-guard | M | cures the user's and ally's statuses (Soundproof / Good as Gold ally excepted); the bench's in the E2 outcome |
| healblock | usum:47 | before-guard | C | heal moves fail at BeforeMove; heals blocked at the end of turn; guarded while a heal the pair engine reads can happen in a later step (`Heal Block on {Name} is not modelled with a later heal.`) |
| heartswap | sv:2 usum:3 | before-guard | M | all stages swapped |
| holdhands | swsh:4 usum:8 | before-guard | N | nothing |
| honeclaws | sv:49 swsh:141 usum:206 | before-guard | M | Atk +1 |
| howl | champions:23 sv:44 swsh:37 usum:44 | before-guard | M | Atk +1 to the user and its ally (gen 8+ target allies; Champions sound: a Soundproof ally is immune) |
| hypnosis | champions:30 sv:58 swsh:65 usum:74 | before-guard | M | slp |
| imprison | champions:73 sv:172 swsh:153 usum:85 | before-guard | C | a foe's later move the user knows fails (onFoeBeforeMove): needs the user's moves (`moves` input; complete); else `Imprison needs {Name}'s moves.` |
| ingrain | champions:13 sv:36 swsh:35 usum:50 | before-guard | C | 1/16 heal at the end of turn (order 7); grounds its user: guarded when a later Ground move could hit an ungrounded user |
| iondeluge | usum:11 | before-guard | C | guarded when a later Normal move follows (`Ion Deluge is not modelled.`) |
| irondefense | champions:113 sv:210 swsh:225 usum:267 | before-guard | M | Def +2 |
| kinesis | swsh:2 usum:4 | before-guard | M | accuracy -1 (as Sand Attack) |
| laserfocus | swsh:183 usum:283 | before-guard | C | next attack crits: guarded when its own later attack follows (`Laser Focus is not modelled.`), else no effect |
| leer | sv:189 swsh:179 usum:220 | before-guard | M | Def -1 on both foes |
| lockon | champions:1 sv:17 swsh:26 usum:26 | before-guard | N | every move hits |
| lovelykiss | swsh:1 usum:2 | before-guard | M | slp |
| luckychant | usum:74 | before-guard | M | side flag: no crits into it (matters with the Critical hit toggle) |
| magiccoat | swsh:155 usum:239 | before-guard | M | reflects reflectable status moves (single target: at the source; spread: the source's side) |
| magicpowder | champions:1 sv:2 swsh:1 | before-guard | G | as Soak |
| magicroom | champions:35 sv:11 swsh:66 usum:74 | before-guard | M | Magic Room toggles (a second use ends it) |
| magneticflux | champions:3 sv:10 swsh:4 usum:8 | before-guard | M | Plus/Minus Pokémon on its side Def +1 Sp. Def +1 |
| magnetrise | champions:8 sv:17 swsh:87 usum:128 | before-guard | C | guarded when a later Ground move could hit it (`Magnet Rise is not modelled.`), else no effect |
| matblock | swsh:1 usum:5 | before-guard | M | side flag: blocks damaging moves with the protect flag into its side (Z/Max at 1/4); first-turn fact |
| maxguard | swsh:0 | before-guard | X | `Max Guard is not modelled.` |
| meanlook | champions:22 sv:42 swsh:40 usum:57 | before-guard | N | trap only |
| meditate | usum:23 | before-guard | M | Atk +1 |
| metalsound | champions:29 sv:61 swsh:64 usum:62 | before-guard | M | Sp. Def -2 (sound) |
| mimic | sv:13 swsh:279 usum:466 | before-guard | N | moveset only |
| mindreader | swsh:22 usum:34 | before-guard | N | every move hits |
| minimize | champions:7 sv:15 swsh:16 usum:17 | before-guard | C | evasion +2; guarded only when a later Stomp-family move hits it (minimize onSourceModifyDamage 2x: `Minimize doubles the damage {Name} takes: later moves are not modelled.`) |
| miracleeye | usum:21 | before-guard | C | guarded when a later Psychic move hits a Dark target (USUM) |
| mist | sv:68 swsh:73 usum:74 | before-guard | M | side flag: drops from other Pokémon blocked (Infiltrator foes pass) |
| mudsport | usum:90 | before-guard | C | guarded when a later Electric move follows (USUM) |
| nastyplot | champions:85 sv:167 swsh:133 usum:99 | before-guard | M | Sp. Atk +2 |
| nightmare | usum:103 | before-guard | M | volatile on a sleeping target: 1/4 at the end of turn (order 11) |
| nobleroar | champions:6 sv:21 swsh:13 usum:14 | before-guard | M | Atk -1 Sp. Atk -1 (sound) |
| noretreat | champions:2 sv:2 swsh:1 | before-guard | M | +1 all five; fails while its volatile is up (pre-turn input) |
| octolock | champions:1 swsh:1 | before-guard | M | trap (no switch this turn) and Def/Sp. Def -1 at the end of turn (order 14) |
| odorsleuth | usum:72 | before-guard | C | as Foresight |
| playnice | sv:34 swsh:31 usum:38 | before-guard | M | Atk -1 (no protect flag) |
| poisongas | sv:20 swsh:12 usum:18 | before-guard | M | psn on both foes |
| poisonpowder | champions:28 sv:54 swsh:21 usum:60 | before-guard | M | psn (powder) |
| powder | usum:23 | before-guard | G | `Powder is not modelled in 2v2.` (USUM) |
| powershift | champions:0 | before-guard | G | `Power Shift is not modelled in 2v2.` |
| powersplit | champions:8 sv:14 swsh:23 usum:26 | before-guard | G | `Power Split is not modelled in 2v2.` (raw stats) |
| powerswap | champions:21 sv:8 swsh:69 usum:34 | before-guard | M | Atk/Sp. Atk stages swapped |
| powertrick | champions:5 sv:5 swsh:13 usum:22 | before-guard | G | `Power Trick is not modelled in 2v2.` |
| psychoshift | swsh:18 usum:27 | before-guard | M | moves its status to the target, then cured (USUM/SwSh) |
| psychup | champions:92 sv:241 swsh:216 usum:346 | before-guard | M | copies the target's stages and Focus Energy / Dragon Cheer (Laser Focus copied: guarded as Laser Focus) |
| quash | champions:9 sv:15 swsh:26 usum:59 | before-guard | M | target's action order 201 (last); gen 7: priority -7.1 at the end (data/mods/gen7) |
| quiverdance | champions:21 sv:33 swsh:8 usum:37 | before-guard | M | Sp. Atk/Sp. Def/Spe +1 (dance) |
| recycle | champions:13 sv:22 swsh:90 usum:140 | before-guard | C | an item used earlier this turn comes back: modelled; one used before the turn: `Recycle needs the item {Name} used before.` |
| reflecttype | champions:4 sv:8 swsh:12 usum:19 | before-guard | G | as Soak |
| refresh | usum:141 | before-guard | M | cures its own psn/par/brn (USUM) |
| roar | champions:105 sv:213 swsh:165 usum:266 | before-guard | G | drags the target out (as Shed Tail): Suction Cups, Guard Dog, Ingrain, Dynamax stop it |
| rockpolish | champions:9 sv:35 swsh:95 usum:130 | before-guard | M | Spe +2 |
| roleplay | champions:15 sv:14 swsh:97 usum:170 | before-guard | M | copies the target's ability (Start runs) |
| rototiller | usum:27 | before-guard | M | every grounded Grass type Atk +1 Sp. Atk +1 |
| safeguard | champions:109 sv:71 swsh:240 usum:360 | before-guard | M | side flag: status and confusion from other Pokémon blocked (Infiltrator foes pass); Yawn blocked |
| sandattack | sv:82 swsh:90 usum:122 | before-guard | M | accuracy -1 (no stage read; the reactions as Sweet Scent) |
| scaryface | champions:162 sv:382 swsh:193 usum:167 | before-guard | M | Spe -2 |
| screech | champions:72 sv:119 swsh:169 usum:169 | before-guard | M | Def -2 (sound) |
| sharpen | usum:10 | before-guard | M | Atk +1 |
| shellsmash | champions:8 sv:25 swsh:20 usum:26 | before-guard | M | Def/Sp. Def -1, Atk/Sp. Atk/Spe +2 (White Herb) |
| shelter | champions:1 sv:3 | before-guard | M | Def +2 |
| shiftgear | champions:1 sv:6 swsh:11 usum:10 | before-guard | M | Spe +2 Atk +1 |
| simplebeam | champions:4 sv:6 swsh:22 usum:23 | before-guard | M | target becomes Simple |
| sing | champions:9 sv:28 swsh:47 usum:67 | before-guard | M | slp (sound) |
| sketch | sv:1 usum:1 | before-guard | N | moveset only |
| skillswap | champions:71 sv:133 swsh:104 usum:131 | before-guard | M | abilities swapped; old End and new Start run (setAbility): guarded when an ability with an acting Start is involved |
| sleeppowder | champions:26 sv:42 swsh:22 usum:51 | before-guard | M | slp (powder) |
| smokescreen | sv:33 swsh:27 usum:33 | before-guard | M | accuracy -1 (as Sand Attack) |
| snatch | usum:180 | before-guard | G | `Snatch is not modelled in 2v2.` (presence, USUM) |
| soak | champions:10 sv:40 swsh:30 usum:30 | before-guard | G | `Soak changes {Name}'s type: not modelled.` |
| speedswap | champions:4 sv:2 swsh:28 usum:6 | before-guard | G | `Speed Swap is not modelled in 2v2.` (raw Speed, not a stage) |
| spicyextract | champions:2 sv:2 | before-guard | M | target Atk +2 Def -2 |
| spiderweb | usum:8 | before-guard | N | trap only (USUM) |
| spite | champions:74 sv:158 swsh:130 usum:168 | before-guard | N | PP only |
| spore | champions:0 sv:8 swsh:4 usum:9 | before-guard | M | slp (powder) |
| stockpile | champions:18 sv:61 swsh:41 usum:61 | before-guard | C | Def +1 Sp. Def +1 and a layer; the layers before the turn are an input (default 0, a turn fact), fails at 3 |
| stringshot | champions:25 sv:36 swsh:34 usum:93 | before-guard | M | Spe -2 on both foes |
| stunspore | champions:27 sv:62 swsh:26 usum:62 | before-guard | M | par (powder) |
| supersonic | sv:70 swsh:59 usum:97 | before-guard | M | confusion (sound) |
| swagger | champions:68 sv:80 swsh:652 usum:1009 | before-guard | M | Atk +2 then confusion |
| sweetkiss | champions:24 sv:47 swsh:49 usum:42 | before-guard | M | confusion |
| sweetscent | champions:29 sv:68 swsh:68 usum:94 | before-guard | M | evasion -2 (-1 gen 7) on both foes: no stage the calculation reads, but Defiant/Competitive, Lash Out, Clear Body, Mirror Armor, Eject Pack react |
| switcheroo | champions:26 sv:49 swsh:28 usum:42 | before-guard | M | as Trick |
| swordsdance | champions:116 sv:264 swsh:196 usum:288 | before-guard | M | Atk +2 (dance) |
| tailglow | sv:3 usum:4 | before-guard | M | Sp. Atk +3 |
| tailwhip | sv:99 swsh:84 usum:112 | before-guard | M | Def -1 on both foes |
| takeheart | sv:3 | before-guard | M | Sp. Atk +1 Sp. Def +1 and cures its status |
| tarshot | sv:2 swsh:1 | before-guard | C | Spe -1; guarded when a later Fire move hits it (`Tar Shot doubles Fire damage on {Name}: later moves are not modelled.`) |
| taunt | champions:135 sv:338 swsh:225 usum:294 | before-guard | M | later status move (not a Z-Move) fails at BeforeMove (priority 5); Oblivious, Aroma Veil, Mental Herb |
| tearfullook | champions:13 sv:27 swsh:12 usum:25 | before-guard | M | Atk -1 Sp. Atk -1 (no protect flag) |
| teeterdance | champions:6 sv:22 swsh:24 usum:37 | before-guard | M | confusion on all adjacent, its ally too (Dancer stays guarded) |
| telekinesis | usum:218 | before-guard | C | as Magnet Rise (USUM) |
| thunderwave | champions:121 sv:249 swsh:237 usum:319 | before-guard | M | par; ignoreImmunity false: Ground immune |
| tickle | champions:40 sv:77 swsh:90 usum:99 | before-guard | M | Atk -1 Def -1 |
| tidyup | champions:2 sv:7 | before-guard | M | Atk +1 Spe +1; removes every Substitute and the hazards |
| topsyturvy | champions:3 sv:3 swsh:3 usum:3 | before-guard | M | target's stages inverted |
| torment | champions:31 sv:44 swsh:137 usum:209 | before-guard | N | no BeforeMove handler: changes only the next choice |
| toxic | champions:39 sv:96 swsh:643 usum:1014 | before-guard | M | tox (stage 0: 1/16 at this end of turn) |
| toxicthread | champions:1 sv:3 usum:3 | before-guard | M | Spe -1 (-2 Champions) then psn |
| transform | champions:1 sv:3 swsh:2 usum:3 | before-guard | G | `Transform is not modelled in 2v2.` |
| trick | champions:86 sv:176 swsh:142 usum:177 | before-guard | M | items swapped (Sticky Hold, unremovable items fail); Berries due at the Update; Unburden; guarded for items acting on receipt |
| trickortreat | champions:4 swsh:8 usum:9 | before-guard | G | as Soak |
| venomdrench | swsh:48 usum:42 | before-guard | M | Atk/Sp. Atk/Spe -1 on poisoned foes only |
| victorydance | sv:2 | before-guard | M | Atk/Def/Spe +1 (dance) |
| watersport | usum:73 | before-guard | C | guarded when a later Fire move follows (USUM) |
| whirlwind | champions:37 sv:41 swsh:36 usum:64 | before-guard | G | as Roar (wind: Wind Rider absorbs) |
| willowisp | champions:75 sv:141 swsh:112 usum:154 | before-guard | M | brn; Flash Fire / Well-Baked Body absorb it |
| withdraw | sv:29 swsh:28 usum:26 | before-guard | M | Def +1 |
| wonderroom | champions:52 sv:13 swsh:108 usum:106 | before-guard | M | Wonder Room toggles |
| workup | sv:34 swsh:211 usum:342 | before-guard | M | Atk +1 Sp. Atk +1 |
| worryseed | champions:18 sv:61 swsh:73 usum:134 | before-guard | M | target becomes Insomnia, its sleep cured |
| yawn | champions:47 sv:89 swsh:74 usum:104 | before-guard | M | yawn volatile: no sleep this turn (duration 2, order 23); fails on a statused or sleep-immune target (onTryHit); leaves `drowsy` for the next end of turn |
| assist | usum:24 | calling | X | `{Move} is not modelled in 2v2.` |
| copycat | champions:41 sv:70 swsh:45 usum:60 | calling | X | as Assist |
| instruct | champions:1 sv:2 swsh:1 usum:2 | calling | C | target uses its last move again at once: modelled when it moved this turn (its action repeated, prioritizeAction); else needs `lastMove` (`Instruct needs {Name}'s move from the last turn.`) |
| mefirst | usum:57 | calling | X | as Assist |
| metronome | sv:146 swsh:69 usum:71 | calling | X | as Assist |
| mirrormove | usum:43 | calling | X | as Assist |
| naturepower | swsh:98 usum:171 | calling | X | as Assist |
| sleeptalk | champions:395 sv:917 swsh:767 usum:1014 | calling | X | as Assist (asleep or Comatose; fails otherwise) |
| bellydrum | champions:14 sv:40 swsh:47 usum:51 | hp-guard | M | loses floor(maxhp/2), Atk to +6; fails at <= 1/2 HP or +6 |
| clangoroussoul | champions:1 sv:2 swsh:1 | hp-guard | M | loses floor(maxhp/3), +1 all five |
| curse | champions:132 sv:283 swsh:296 usum:413 | hp-guard | M | Ghost: loses floor(maxhp/2), target cursed (1/4 at the end of turn, order 12); other: Atk +1 Def +1 Spe -1 |
| filletaway | sv:2 | hp-guard | M | loses floor(maxhp/2), Atk/Sp. Atk/Spe +2 (SV) |
| floralhealing | sv:2 swsh:1 usum:2 | hp-guard | M | target heal ceil(1/2) (Grassy modify 0.667) |
| healingwish | champions:15 sv:43 swsh:29 usum:30 | hp-guard | M | user faints; heals its replacement (fact only) |
| healorder | usum:2 | hp-guard | M | heal round(1/2) |
| healpulse | champions:25 sv:37 swsh:42 usum:46 | hp-guard | M | target heal ceil(1/2) (Mega Launcher modify 0.75) |
| junglehealing | sv:3 swsh:2 | hp-guard | M | user and ally heal modify(maxhp, 0.25) and cure |
| lifedew | champions:21 sv:39 swsh:41 | hp-guard | M | user and ally heal round(1/4) |
| lunarblessing | sv:2 | hp-guard | M | user and ally heal modify(maxhp, 0.25) and cure |
| lunardance | sv:2 swsh:1 usum:2 | hp-guard | M | as Healing Wish |
| memento | champions:23 sv:81 swsh:46 usum:49 | hp-guard | M | target Atk -2 Sp. Atk -2, the user faints at once (no replacement until the turn ends) |
| milkdrink | champions:1 sv:3 swsh:1 usum:4 | hp-guard | M | heal round(1/2) (Champions: itself or its ally) |
| moonlight | champions:6 sv:20 swsh:22 usum:28 | hp-guard | M | modify(maxhp, 0.5 / 0.667 sun / 0.25 rain-sand-hail-snow), effectiveWeather |
| morningsun | champions:5 sv:19 swsh:29 usum:37 | hp-guard | M | as Moonlight |
| painsplit | champions:72 sv:137 swsh:108 usum:139 | hp-guard | M | both set to floor((a + b) / 2) (undynamaxed HP) |
| purify | swsh:1 usum:2 | hp-guard | M | cures the target's status, user heals round(1/2) (USUM/SwSh) |
| recover | champions:29 sv:81 swsh:56 usum:76 | hp-guard | M | heal round(1/2) |
| rest | champions:395 sv:915 swsh:769 usum:1008 | hp-guard | M | full HP, sleep with counter 3 (cannot wake this turn), status cured; fails at full HP or sleep-immune |
| revivalblessing | champions:1 sv:2 | hp-guard | G | `Revival Blessing is not modelled in 2v2.` |
| roost | champions:39 sv:67 swsh:80 usum:146 | hp-guard | C | heal round(1/2); loses Flying for the turn: guarded when a later damaging move hits it (`Roost removes {Name}'s Flying type: later moves are not modelled.`) |
| shedtail | champions:4 sv:4 | hp-guard | G | switch: `{Name} switches out: the replacement is not known.` (the end of turn only when no action follows) |
| shoreup | sv:3 swsh:2 usum:3 | hp-guard | M | modify(maxhp, 0.5 / 0.667 sand) |
| slackoff | champions:10 sv:19 swsh:9 usum:13 | hp-guard | M | heal round(1/2) |
| softboiled | champions:0 sv:3 swsh:9 usum:10 | hp-guard | M | heal round(1/2) |
| strengthsap | champions:8 sv:21 swsh:13 usum:13 | hp-guard | M | user heals the target's Attack (stages, no modifiers; Big Root, Liquid Ooze), target Atk -1 |
| stuffcheeks | champions:4 sv:8 swsh:2 | hp-guard | M | eats its Berry at any HP (HP, pinch, curing Berries) then Def +2; other Berries guarded |
| substitute | champions:395 sv:916 swsh:769 usum:1015 | hp-guard | M | loses floor(maxhp/4), Substitute with floor(maxhp/4) HP; later status moves fail; later hits into it guarded (`Hits on {Name}'s Substitute are not modelled.`) unless sound/Infiltrator |
| swallow | champions:15 sv:54 swsh:38 usum:58 | hp-guard | C | needs the Stockpile layers (input): heal 1/4, 1/2, full; else `Swallow needs Stockpile from earlier turns.` |
| synthesis | champions:27 sv:102 swsh:66 usum:128 | hp-guard | M | as Moonlight |
| teatime | champions:2 sv:3 swsh:2 | hp-guard | M | every Pokémon eats its Berry at any HP; other Berries guarded |
| wish | champions:39 sv:66 swsh:62 usum:93 | hp-guard | M | no HP this turn; heals its slot at the next end of turn (E2 carries it) |
| auroraveil | champions:9 sv:14 swsh:25 usum:14 | modelled | X | modelled |
| banefulbunker | champions:1 sv:2 swsh:1 usum:2 | modelled | X | modelled |
| burningbulwark | sv:2 | modelled | X | modelled |
| destinybond | champions:35 sv:52 swsh:56 usum:66 | modelled | M | the foe whose move knocks the user out faints too (onFaint; Dynamax immune): replaces today's guard |
| detect | champions:41 sv:56 swsh:120 usum:171 | modelled | X | modelled |
| electricterrain | champions:29 sv:103 swsh:40 usum:21 | modelled | X | modelled; now also blocks sleep (grounded) |
| followme | champions:5 sv:23 swsh:21 usum:26 | modelled | X | modelled; now also redirects single-target status moves |
| grassyterrain | champions:37 sv:155 swsh:41 usum:64 | modelled | X | modelled; end of turn heal |
| gravity | champions:33 sv:128 swsh:95 usum:149 | modelled | X | modelled |
| hail | swsh:176 usum:223 | modelled | X | modelled |
| helpinghand | champions:259 sv:579 swsh:273 usum:296 | modelled | X | modelled |
| kingsshield | champions:2 swsh:2 usum:3 | modelled | X | modelled |
| lightscreen | champions:161 sv:337 swsh:260 usum:356 | modelled | X | modelled |
| mistyterrain | champions:44 sv:94 swsh:45 usum:44 | modelled | X | modelled; now also blocks status and confusion (grounded) |
| obstruct | swsh:1 | modelled | X | modelled |
| protect | champions:395 sv:917 swsh:769 usum:1018 | modelled | X | modelled |
| psychicterrain | champions:32 sv:83 swsh:40 usum:17 | modelled | X | modelled; now also stops priority status moves into grounded foes |
| quickguard | champions:33 sv:53 swsh:56 usum:63 | modelled | X | modelled; now also stops priority status moves |
| ragepowder | champions:26 sv:42 swsh:6 usum:37 | modelled | X | modelled; as Follow Me (not on powder-immune users) |
| raindance | champions:294 sv:653 swsh:478 usum:703 | modelled | X | modelled |
| reflect | champions:101 sv:247 swsh:257 usum:323 | modelled | X | modelled |
| sandstorm | champions:88 sv:243 swsh:190 usum:261 | modelled | X | modelled |
| silktrap | sv:2 | modelled | X | modelled |
| snowscape | champions:47 sv:109 | modelled | X | modelled |
| spikyshield | champions:4 sv:12 swsh:2 usum:8 | modelled | X | modelled |
| sunnyday | champions:294 sv:643 swsh:438 usum:702 | modelled | X | modelled |
| tailwind | champions:52 sv:147 swsh:102 usum:193 | modelled | X | modelled |
| trickroom | champions:64 sv:143 swsh:118 usum:157 | modelled | X | modelled |
| wideguard | champions:28 sv:50 swsh:51 usum:73 | modelled | X | modelled; now also stops spread status moves |
| celebrate | sv:32 swsh:46 usum:44 | no-effect | N | nothing |
| leechseed | champions:30 sv:96 swsh:63 usum:94 | no-effect | M | seeded (Grass immune, Substitute blocks): drains at THIS end of turn (order 8; Liquid Ooze, Big Root) |
| perishsong | champions:11 sv:46 swsh:24 usum:54 | no-effect | M | count 3 on every Pokémon hearing it (Soundproof immune) at this end of turn; no HP |
| spikes | champions:33 sv:75 swsh:38 usum:45 | no-effect | N | hazard (E2 reports where it lands: Magic Bounce reflects it) |
| splash | sv:39 swsh:37 usum:50 | no-effect | N | nothing |
| stealthrock | champions:68 sv:196 swsh:143 usum:211 | no-effect | N | as Spikes |
| stickyweb | champions:3 sv:19 swsh:14 usum:17 | no-effect | N | as Spikes |
| toxicspikes | champions:34 sv:63 swsh:41 usum:44 | no-effect | N | as Spikes |
| spotlight | usum:8 | presence | M | centre of attention on its target (redirection exists); reflected by Magic Coat/Bounce |
| batonpass | champions:79 sv:183 swsh:106 usum:111 | switch | G | switch (as Shed Tail) |
| chillyreception | champions:2 sv:3 | switch | M | snow modelled; then the switch as Shed Tail |
| partingshot | champions:11 sv:22 swsh:31 usum:23 | switch | M | drops (Atk -1 Sp. Atk -1) modelled; then the switch as Shed Tail |
| teleport | sv:13 swsh:49 usum:64 | switch | G | switch (as Shed Tail) |

Counts: 271 classified — M 167, N 19, C 25, G 23, X 37.

### 3.2 Switch moves with the end of turn
Baton Pass, Teleport, Shed Tail, Parting Shot (after its drops), Chilly Reception (after its snow), Roar, Whirlwind: with a later
living action the whole turn stays not estimated (`{Name} switches out: the replacement is not known.`, today's text); with no
later action the moves are estimated and only the end of turn is not estimated (EOT architect §3.2, `World.leaving`). Healing Wish,
Lunar Dance and Memento faint their user (no mid-turn replacement: the slot stays empty through the residual, Q13) — modelled.

### 3.3 New "not estimated" reasons (whole turn, moves phase) — exact text
`REASONS` additions in doubles-actions.ts (placeholders filled from the turn):
- `needsLastMove: (move, name) => \`${move} needs ${name}'s move from the last turn.\`` (Encore, Disable, Instruct on a Pokémon still
  to move, with `lastMove` undefined).
- `needsMoves: (name) => \`Imprison needs ${name}'s moves.\``
- `substituteHit: (name) => \`Hits on ${name}'s Substitute are not modelled.\``
- `typeChange` (existing text `{By} changes {Name}'s type: later moves are not modelled.`) for Soak, Magic Powder, Forest's Curse,
  Trick-or-Treat, Reflect Type, Conversion, Conversion 2, Camouflage, and Roost with a later hit on the user.
- `takesDouble` (existing) for Minimize (Stomp family), Tar Shot (Fire).
- `notIn2v2` for Speed Swap, Power Split, Guard Split, Power Trick, Power Shift, Corrosive Gas, Transform, Snatch, Powder,
  Revival Blessing.
- `weightChange: (name) => \`Autotomize changes ${name}'s weight: later moves are not modelled.\``
- `notModelled` (existing `{Move} is not modelled.`) for Laser Focus with a later attack of its user, Embargo with a later item use,
  Ion Deluge / Electrify / Mud Sport / Water Sport with an affected later move, Magnet Rise / Telekinesis / Ingrain with a later
  Ground move whose hit depends on it, Foresight / Odor Sleuth / Miracle Eye with an affected later move, Defense Curl with Rollout.
- `healBlockLater: (name) => \`Heal Block on ${name} is not modelled with a later heal.\`` (a later step of the pair engine could heal
  it: its HP Berry, its draining move or Shell Bell, an absorbing ability's heal).
- `recycleBefore: (name) => \`Recycle needs the item ${name} used before.\``
- `stockpileBefore: (move) => \`${move} needs Stockpile from earlier turns.\`` (Swallow / Spit Up with no layers known).
- `abilityStart: (ability, name) => \`${ability} would act as ${name} gets it: not modelled.\`` (Skill Swap, Role Play, Entrainment,
  Doodle when the ability given has a Start that changes the turn: Intimidate, Download, Trace, Imposter, Neutralizing Gas, the
  weather and terrain setters, Screen Cleaner, Curious Medicine, Pastel Veil (cure), Hospitality, Costar, Supersweet Syrup,
  Embody Aspect, Intrepid Sword, Dauntless Shield, Zero to Hero, Commander, Slow Start, Truant, Wind Rider with Tailwind,
  Protosynthesis/Quark Drive (field), Air Lock/Cloud Nine… — `ENTRY_START_ABILITIES` table, source-checked against `onStart`).
- `allySwitchAim: (move, name) => \`Ally Switch changes where ${name}'s ${move} goes: not modelled.\`` (a move aimed at its own ally's
  former position after its side's Ally Switch).
- `encorePriority: (name) => \`Encore changes ${name}'s move to one of another priority: not modelled.\`` (SV/SwSh/USUM only).
- `uproarSleep` → `notIn2v2("Uproar")` when an Uproar is in play and a sleep is set or a sleeper moves.
- `itemOnReceipt: (move, item) => \`${move} giving ${item} is not modelled.\`` (Trick/Switcheroo/Bestow handing an item whose Start or
  Update acts: Booster Energy, terrain Seeds, Room Service, White Herb, Mental Herb, Mirror Herb, Air Balloon (its message only:
  modelled), Eject Pack/Button, Red Card, Blunder Policy…).
- `berryEaten: (move, item) => \`${move} with ${item} is not modelled.\`` (Stuff Cheeks / Teatime with Starf, Micle, Custap, Lansat,
  Jaboca, Rowap, Kee, Maranga, Enigma).
- Existing reasons removed or narrowed: `REASONS.sleep` / `REASONS.freeze` presence guards (§5), `REASONS.confusion` (now modelled;
  kept for a confused Pokémon whose recharge Training sends as No move — bridge rollout instead), `HP_STATUS_MOVES` presence guard
  (only Revival Blessing remains), Destiny Bond's guard in `hitReactions`, Pollen Puff on an ally (now a heal `floor(baseMaxhp/2)`, §8.1).

### 3.4 "No move" and recharge
"No move" (moveId null) is Splash (oracle): it runs BeforeMove (§2.1). Training's Recharge (`mustrecharge`, BeforeMove 11) stops
before confusion: the bridge sends a recharging confused/infatuated Pokémon to a rollout (rare).

### 3.5 HP-changing status moves (exact arithmetic, `mapHP` / joint map)
- Heal helper `healSlot(ctx, w, slot, amount, source, effect)`: `trunc`, ≥ 1, Heal Block (`eot.healBlock`) → 0, none at 0 HP or full
  (`PS/sim/battle.ts:2261-2295`); Big Root for Strength Sap only among status moves; Liquid Ooze on Strength Sap's target turns it
  into damage to the user (`PS/data/abilities.ts` liquidooze onSourceTryHeal: drain, leechseed, strengthsap). Heals go to
  `DoublesHP.heals` (`Heal Pulse: +163 HP.`) and the hit's `change`.
- Amounts (verified Q5): Recover, Slack Off, Soft-Boiled, Heal Order, Roost, Milk Drink: `round(baseMaxhp/2)`; Life Dew
  `round(baseMaxhp/4)`; Heal Pulse / Floral Healing `ceil(baseMaxhp/2)` (Mega Launcher `modify(baseMaxhp, 0.75)`, Grassy
  `modify(baseMaxhp, 0.667)`); Moonlight / Morning Sun / Synthesis `modify(maxhp, f)` with f by `effectiveWeather(undefined, true)`
  (0.667 sun/Desolate Land, 0.25 rain/Primordial Sea/sand/hail/snow, 0.5 otherwise; Utility Umbrella neutralises sun/rain;
  Cloud Nine); Shore Up `modify(maxhp, 0.667 sand / 0.5)`; Jungle Healing, Lunar Blessing `modify(maxhp, 0.25)` + cure; Purify
  `round(baseMaxhp/2)` to the user after curing the target; Strength Sap = target's `getStat('atk', boosted, unmodified)`; Rest =
  to maximum; Swallow 1/4, 1/2, full by layers. `modify(x, f)` is Showdown's `tr((tr(x * tr(f * 4096)) + 2048 - 1) / 4096)` — reuse
  the engine's `pokeRound`/`modify` helper from calculate.ts.
- Costs (directDamage: no Damage event, Magic Guard and Sturdy do not stop them): Belly Drum and Fillet Away `floor(maxhp/2)`,
  Clangorous Soul `floor(maxhp/3)`, Substitute `floor(maxhp/4)`, Ghost Curse `floor(maxhp/2)` (Q12, Q6). Then the action's Update:
  Sitrus/pinch Berries (`afterLoss`, Belly Drum + Sitrus), Gluttony, Ripen.
- Pain Split: `mapJoint(w, [user, target], (a, b) => avg = floor((a + b)/2) || 1)`; a Dynamaxed participant (SwSh) is guarded
  (`Pain Split with a Dynamaxed Pokémon is not modelled.` via `notIn2v2`); Berries of either at the Update.
- Memento, Healing Wish, Lunar Dance: user's HP → 0 at once (existing `faint` path; Memento only if it hit), Healing Wish/Lunar Dance
  need a Pokémon to switch in (`canSwitch` input, §7; default true with fact `Assumes a Pokémon is left to switch in.`).
- Confusion self-hit: `confusionHit(ctx, w, slot)`: stored Atk/Def (Wonder Room: Sp. Def), stages via ModifyBoost (no Unaware
  effect on its own hit), level (Champions 50), `baseDamage = tr(tr(tr(tr(2L/5+2) * 40 * A) / D) / 50) + 2`, 16-bit wrap, 16 rolls
  `tr(base * (85..100) / 100)`, `max(1, ·)`; applied through the Damage event: Sturdy / Focus Sash at full HP (Sash used), Disguise
  (busted, 1/8 chip from gen 8: R1b), Endure, Focus Band (guard, existing reason); not Magic Guard (R1c), not Multiscale, not Ice
  Face; `hurt` set (Assurance, R1d), no `damagedBy`, no `timesAttacked`, Focus Punch focus kept; then the action's Update (Sitrus,
  R1c). As a loss distribution: `lossDist(w, slot, [{loss, p}])` (new world helper: convolution on the slot's factor), tagged
  fainted/ate as `afterLoss` does.
- Stuff Cheeks / Teatime: `eatNow(ctx, w, slot)` = `berryArithmetic` eat at any HP (Sitrus 1/4, Oran 10, Berry Juice 20, Figy family
  1/3 gen 7+… with nature confusion: modelled now), pinch stat Berries (+1, Ripen +2), curing Berries, Cheek Pouch; the guarded
  Berries listed in §3.3.

### 3.6 Statuses, volatiles and their blockers (who can block what)
| Effect | Blocked by (breakable marked ʙ) | Source |
|---|---|---|
| slp | Insomnia ʙ, Vital Spirit ʙ, Sweet Veil ʙ (self, ally), Flower Veil ʙ (Grass on its side), Comatose, Purifying Salt ʙ, Leaf Guard ʙ (sun), Shields Down (Meteor), Electric/Misty Terrain (grounded), Safeguard, Uproar (guard), an existing status | abilities.ts 2168, 5315, 4786, 1419, 588, 3618, 2291, 4239 |
| par | Limber ʙ, Electric type (gen 6+), Thunder Wave: Ground (type immunity), plus the general ones | 2368 |
| brn | Water Veil ʙ, Water Bubble ʙ, Thermal Exchange ʙ, Fire type; Flash Fire / Well-Baked Body absorb Will-O-Wisp in TryHit | 5429, 5377, 4990 |
| psn/tox | Immunity ʙ, Pastel Veil ʙ (self, ally), Poison/Steel types unless Corrosion | 2096, 3189 |
| confusion | Own Tempo ʙ, Misty Terrain (grounded), Safeguard | 3144 |
| attract | Oblivious ʙ, Aroma Veil ʙ (ally), genderless or same gender | 3008, 234 |
| taunt | Oblivious ʙ (gen 6+), Aroma Veil ʙ | 3008, 234 |
| encore/disable/torment/heal block | Aroma Veil ʙ | 234 |
| yawn | Sweet Veil ʙ, Safeguard, Electric/Misty Terrain (at onTryHit `runStatusImmunity('slp')` — terrain via SetStatus at the end), a status | moves.ts 21142-21146 |
| drops | Mist (side), Clear Amulet, Clear Body ʙ / White Smoke ʙ / Full Metal Body, Hyper Cutter ʙ, Big Pecks ʙ, Flower Veil ʙ, Mirror Armor ʙ (reflects) | abilities.ts 523, 2657 |
| any status move | Good as Gold ʙ (from others), Magic Bounce ʙ / Magic Coat (reflectable), Crafty Shield (side), Protect family (protect flag), Substitute (no bypasssub), Soundproof ʙ (sound), powder immunity | 1630, 2437, 4436, 3108 |

Mold Breaker / Teravolt / Turboblaze and the ignoreAbility moves bypass ʙ abilities unless the holder has an Ability Shield
(existing `breaks()`).

### 3.7 Items moved by moves (Trick, Switcheroo, Bestow)
`swapItems(ctx, w, user, target, move)`: fails when the target has Sticky Hold (onTryImmunity, not breakable via Mold Breaker —
`hasAbility`), either item cannot be taken (Mega Stones for their species, Z-Crystals, Plates/Memories/Drives/Masks for their
species, Rusted Sword/Shield, Booster Energy on Paradox (`onTakeItem` false) — table `UNREMOVABLE` from pinned `onTakeItem`), both
hold nothing, or a Substitute (no bypasssub). Then each Pokémon: Unburden activates on losing an item (`abilityActive` true while
itemless: the build's flag is set to `!itemId` for Unburden holders), the received item's Start (only guarded items act, §3.3),
and at the action's Update `berryDue` (Sitrus at ≤ 1/2 eaten at once, R11; curing Berries; Cheek Pouch). Choice items: no effect
within the turn (locks the next choice). Speed/grounding/calculation changes are read from the build (Q1: Choice Scarf re-sort).
Klutz and Magic Room (`itemWorks`) respected.

### 3.8 Ability changes (Skill Swap, Role Play, Entrainment, Simple Beam, Worry Seed, Gastro Acid, Doodle)
`changeAbility(ctx, w, slot, ability, source)`: the move's own failure rules (pinned `onTryHit`: cantsuppress / failskillswap /
failroleplay / noentrain flags — table from pinned ability flags; Simple Beam vs Simple/Truant; Worry Seed vs Insomnia/Truant; Gastro
Acid vs cantsuppress), Ability Shield (`SetAbility` event), Dynamax (Skill Swap fails on a Dynamaxed target in SwSh); then
`abilityActive = defaultAbilityActive(ability)` (lost Flash Fire/Unburden/Protean states reset as Showdown's new `abilityState`),
the old ability's End (Neutralizing Gas end → existing `gasEnds`; Unnerve/As One end → `unnerveEnds`; Air Lock/Cloud Nine end:
weather read from living holders already), the new ability's Start: `ENTRY_START_ABILITIES` → guard (§3.3), otherwise nothing.
Worry Seed cures sleep (Q2b). Gastro Acid: `abilityId = GAS_STAND_IN` (the Run Away stand-in Neutralizing Gas uses), original kept
for E2 outcomes. Existing guards: Neutralizing Gas in play → `REASONS.withGas` (GAS_CHANGING_MOVES) stays.

### 3.9 Order and positions
- After You / Quash: `PendingAction.order` (Showdown's `action.order`, `PS/sim/battle-queue.ts:277-287`; moves are 200):
  After You → 3, Quash → 201 (gen 8+). `keyOf` compares `order` before priority (comparePriority). Gen 7 (frozen queue): After You
  moves the action to the front (order 3 with its frozen key), Quash sets frozen priority −7.1 (`PS/data/mods/gen7/moves.ts:750-766`).
  Fails (`{Move} fails: {Name} has already moved.`) when the target has no queued action.
- Instruct (C): `prioritizeAction(resolveAction({ moveid: lastMove, targetLoc: lastMoveTargetLoc }))` — when the target used its move
  this turn (MonState.lastUsed { moveId, target position }), a new PendingAction `{ index: actions.length + n, order: 3, instructed:
  true, fractional: 0 }` repeats it next (own priority/Quick Claw not re-rolled: order 3 wins). Fails for charge, recharge,
  `failinstruct` moves, Z/Max, Dynamax target, Beak Blast/Focus Punch/Shell Trap (table). With `lastMove` input and the target not
  yet moved: modelled the same way with its last move at its last target position (`lastMove.target`) — else guarded.
  `DoublesStep.repeat: "instruct"` for the extra step.
- Ally Switch: `World.swapped: Record<DoublesSideId, boolean>`; `occupant(w, position)` / `positionOf(w, slot)`. Pokémon identity
  stays the slot id (factors, `ctx.hp`, steps); chosen foe targets are **positions**: `resolveTargets` maps `action.target` through
  `occupant` (Q4), `spreadTargets` sorts by current position, `across` by position; adjacentAlly moves still go to the ally
  (`getRandomTarget` adjacentAllies); a `normal`/`any` move aimed at its own ally's former position after its side swapped is
  guarded (`allySwitchAim`). Leech Seed's `eot.leechSeed` and Wish are positions (the EOT phase reads `occupant`). Fact
  `Ally Switch: {A} and {B} swap places.`; gen 9 (SV, Champions) turn fact `Assumes Ally Switch was not used last turn.`
  (`allyswitch` volatile counter, `PS/data/moves.ts:302-345`; gen 8 mod removes it, `PS/data/mods/gen8/moves.ts:2-6`).
- Speed changes from status moves re-sort from gen 8 automatically (`speedOf` reads the build): Agility, Rock Polish, Scary Face,
  String Shot, Cotton Spore, Thunder Wave, Stun Spore, Glare, Trick/Switcheroo of a Choice Scarf or Iron Ball, Curse (Spe −1),
  Shell Smash, Shift Gear, Toxic Thread, Simple Beam/Skill Swap of Unburden/Swift Swim/etc. (abilities read by `turnSpeed`).
  Gen 7: frozen (P3).

---

## 4. Randomness and branch weights

| Event | Showdown call | Branches (weights) | Where |
|---|---|---|---|
| Full paralysis | `randomChance(1,4)` / Champions `(1,8)` | stop / go | exists |
| Wake from sleep | slp `time` (`random(2,5)` → 2..4; Champions `sample([2,3,3])`; Rest 3) | wake h(e,d) / stay (§5) | BeforeMove |
| Thaw | `randomChance(1,5)`; Champions counter + `(1,4)` | thaw / stay | BeforeMove |
| Confusion end | confusion `time` (`random(2,6)` → 2..5; Axe Kick 3..5) | end h(k) / stay | BeforeMove |
| Confusion self-hit | `randomChance(33,100)` | 0.33 hit (then 16 rolls as a loss distribution, deduplicated) / 0.67 | BeforeMove |
| Infatuation | `randomChance(1,2)` | stop / go | BeforeMove |
| Acupressure | `sample` of the stats below +6 (of 7) | 1/n each (accuracy/evasion worlds merge with "no stage change" only where the reactions are equal) | effect |
| Encore target (with lastMove) | `getRandomTarget` → `sample(adjacent foes)` | 1/2 each living foe (1 if one) | action change |
| Ally Switch (repeat) | `randomChance(1, counter)` | not branched: first use certain (fact) | — |
| Endure / Protect stall | `randomChance(1, counter)` on repeats | not branched (fact) | — |
| Sleep length on infliction | random/sample | not branched now: the wake hazard reads the prior at each BeforeMove (§5) | — |
| Speed ties | `prng.shuffle` | exists (uniform at every sort from gen 8) | — |

No branch is approximated: each world carries its exact mass; equal discrete states merge (`mergeWorlds`).

---

## 5. Statuses from before the turn (exact counters)

Verified by `status-probes-4.out` (P(first event at attempt k | not before)).

- **Sleep** (`slp`): S = startTime, prior: SV/SwSh/USUM uniform {2,3,4} (`random(2,5)`, `PS/data/conditions.ts:61`); Champions
  {2: 1/3, 3: 2/3} (`sample([2,3,3])`, `PS/data/mods/champions/conditions.ts:23-24`); Rest: S = 3 (`PS/data/moves.ts:14958`, sets
  `time = startTime = 3`). Each BeforeMove decrements by d (1, Early Bird 2: `conditions.ts:68-70`). With e = total decrement so
  far (attempts × d), P(wake at this attempt | asleep) = P(e < S ≤ e + d) / P(S > e). Probe: SV 0, 1/3, 1/2, 1; Champions 0, 1/3, 1;
  Early Bird 1/3, 1. An inflicted sleep is e = 0 (P1).
  Input: `carried.sleep = { attempts, rest }` (attempts = turns it has tried to move while asleep: public `|cant|…|slp` count since
  the `-status slp`). Engine state `vol.sleep = { elapsed: attempts × d, rest }`, `elapsed += d` per BeforeMove asleep.
  Calculator default when the build's status is Sleep and nothing is given: attempts 0, rest false, fact
  `Assumes {Name} has not tried to move since it fell asleep.` (stated only when it has a move this turn).
- **Freeze**: SV/SwSh/USUM: 1/5 per BeforeMove, no counter (`conditions.ts:96-104`) — the guard `Freeze thaws at random.` goes
  away. Champions: thaw if `time − 1 ≤ 0` else 1/4, time starts 3 (`mods/champions/conditions.ts:43-53`): hazard = 1 at attempt 3,
  else 1/4 (P8). Input `carried.freeze = { attempts }`; default 0 with fact `Assumes {Name} has not tried to move since it was
  frozen.` (Champions). A defrost move thaws its user (`flags.defrost`: Flame Wheel, Sacred Fire, Flare Blitz, Fusion Flare, Scald,
  Steam Eruption, Burn Up (Fire user), Pyro Ball, Scorching Sands, Matcha Gotcha — table); a Fire damaging hit thaws the target
  (`frz onDamagingHit`), Scald/Steam Eruption/Scorching Sands thaw (`thawsTarget`).
- **Confusion**: T prior uniform {2,3,4,5} (`random(2,6)`, `conditions.ts:174`), Axe Kick {3,4,5}. Snap out at attempt n iff T = n:
  P(snap at attempt k+1 | confused after k) = P(T = k+1) / P(T > k) (probe: 0, 1/4, 1/3, 1/2, 1). Input
  `carried.confusion = { attempts, axeKick? }`. A Figy-family Berry's confusion as the turn starts is fresh (attempts 0) — today's
  guard (`berryConfusion`) is replaced by the model. Lum and Persim cure it at the Update.
- **Infatuation** from before: `carried.infatuation = position`; ends at an Update when that Pokémon is not active
  (`PS/data/moves.ts:737-741` onUpdate `!source.isActive`).
- **Bad poison stage**: EOT architect (`carried.toxic`).
- Training passes the public counts (tracker), never Showdown's `statusState.time` (leak gate).

---

## 6. Facts (UI text, exact)

Step skip facts (`DoublesStep.skipped`): `Asleep.`, `Frozen.`, `Hurts itself in confusion.`, `Infatuated (Attract).`,
`Taunt: {Move} cannot be used.`, `Disable: {Move} cannot be used.`, `Imprison: {Move} cannot be used.`,
`Heal Block: {Move} cannot be used.` (existing: `Faints before it moves.`, `Flinches (Fake Out).`, `Fully paralysed.`, Gravity,
Throat Chop, Focus Punch).

Step facts (`DoublesStep.facts`, with chances): `Wakes up.`, `Thaws.`, `Snaps out of confusion.`, `{Name} hurts itself in confusion:
{min}–{max} HP.`, `Magic Bounce: {Move} goes back to {User}.`, `Magic Coat: …`, `{Move} fails: {reason}.` (`no Pokémon moves after
it`, `{Name} has already moved`, `it is already up on {Name}'s side`, `{Name} is at full HP`, `{Name} cannot lose that much HP`,
`{Name} is not Darkrai`, `no Pokémon is left to switch in`, `{Name} has no Berry`), `Ally Switch: {A} and {B} swap places.`,
`After You: {Name} moves next.`, `Quash: {Name} moves last.`, `Instruct: {Name} uses {Move} again.`, `{Name} faints (Memento).`,
`Healing Wish: the Pokémon that replaces {Name} is healed.`, `Wish: {Name}'s position is healed at the end of the next turn.`,
`Destiny Bond: {Name} faints too.` (on the attacker's step), `Trick: {A} gets {Item}, {B} gets {Item}.`,
`{Ability}: {Name} gets {Ability}.` (Skill Swap…), `{Name} uses its Berry: {effects}.`

Hit facts (`DoublesHit.facts`, kind `"effect"`): `Falls asleep.`, `Is paralysed.`, `Is burned.`, `Is poisoned.`,
`Is badly poisoned.`, `Becomes confused.`, `Falls in love.`, `Becomes drowsy (falls asleep at the end of the next turn).`,
`Taunted.`, `Leech Seed planted.`, `Cursed.`, `Perish count 3.`, stage changes `+2 Attack.` / `−1 Defense.` (STAT_NAMES, the
existing `+N Stat.` style; `Attack +6 (Belly Drum).`), `Its status is cured.`, `Its stages are copied.`, `Its stages are reset.`,
blockers `{Ability}: {Name} is not affected.`, `Safeguard: {Name} is not affected.`, `Mist: {Name}'s stats are not lowered.`,
`Misty Terrain: {Name} is not affected.`, `Electric Terrain: {Name} does not fall asleep.`, `{Name} is immune.` (type),
`Prankster: {Name} is not affected.`, `{Name} is behind a Substitute.`, `{Move} fails: {Name} is already {asleep|paralysed|burned|
poisoned|confused}.`, Berry/herb `Lum Berry: {Name}'s sleep is cured.`, `Mental Herb: {Name}'s Taunt ends.`,
`Synchronize: {User} is paralysed too.`, absorbers as today (`Volt Absorb: no damage, and it regains HP.` → for status moves
`Volt Absorb: {Move} has no effect, and it regains HP.`).

Turn facts (`DoublesTurnResult.facts`), each only when it applies: `Assumes {Name} has not tried to move since it fell asleep.`,
`Assumes {Name} has not tried to move since it was frozen.` (Champions), `Assumes no protecting move was used last turn.` (now also
Endure), `Assumes Ally Switch was not used last turn.` (SV, Champions), `Assumes the attacker's first turn in battle.` (also Mat
Block), `Assumes a Pokémon is left to switch in.` (Healing Wish, Lunar Dance), `Assumes no Stockpile from earlier turns.`
(Stockpile with no `carried.stockpile`; Swallow and Spit Up without layers are guarded instead), `Every move hits; …` unchanged.

---

## 7. Contract changes (paste-ready; with the EOT architect's §7)

```ts
// doubles-types.ts

/** DoublesCarried (EOT architect §5.2) gains the moves-phase state a Pokémon brings into the turn. Absent: none. */
export type DoublesCarried = {
  /* …EOT fields: toxic, leechSeed, trap, saltCure, aquaRing, ingrain, curse, nightmare, octolock, syrupBomb, yawn, perish, wish,
     futureMove, lastBerry, cudChew… */
  /** Sleep: BeforeMoves it has had asleep since it fell asleep [public `|cant|slp` count], and whether Rest put it to sleep.
   *  Absent with status "slp": attempts 0, not Rest (a turn fact). */
  sleep?: { attempts: number; rest: boolean };
  /** Champions freeze: BeforeMoves frozen. Absent: 0 (a turn fact). Other games need none. */
  freeze?: { attempts: number };
  /** Confusion from earlier turns [confusion volatile]: BeforeMoves confused so far; Axe Kick's minimum of 3. */
  confusion?: { attempts: number; axeKick?: boolean };
  /** Infatuated with the Pokémon at this position [attract volatile source]. */
  infatuation?: DoublesSlotId;
  /** Taunted [taunt]: its status moves fail. Heal Block is EotState/carried `healBlock`. */
  taunt?: true;
  /** Disabled move [disable effectState.move]. */
  disabled?: string;
  /** Its Substitute's HP [substitute volatile hp]. */
  substitute?: number;
  /** Stockpile layers [stockpile layers] 1–3. */
  stockpile?: number;
  /** No Retreat already used [noretreat]. Magnet Rise / Telekinesis are EOT fields too (grounding). */
  noRetreat?: true;
  /** Critical-hit stages from volatiles: Focus Energy [focusenergy] (+2), Dragon Cheer [dragoncheer] (+1, +2 for a Dragon type). */
  focusEnergy?: true; dragonCheer?: 1 | 2;
  /** It is Imprisoning [imprison]: needs `moves` (complete) to be followed. */
  imprisoning?: true;
};

export type DoublesPokemonInput = {
  /* …existing… */
  carried?: DoublesCarried;
  /** The move it used last and the position it aimed at [lastMove, lastMoveTargetLoc]; null: none since it came in; absent: unknown
   *  (Encore, Disable, Instruct on a Pokémon still to move are then not estimated). */
  lastMove?: { moveId: string; target: DoublesSlotId | null } | null;
  /** Its moves (Imprison): the calculator's four quick moves (complete), Training's revealed ones (complete only when all four are). */
  moves?: { ids: string[]; complete: boolean };
};

export type DoublesTurnInput = {
  /* …existing, fieldTurns (EOT)… */
  /** Whether each side has a Pokémon left to switch in (Healing Wish, Lunar Dance, Teleport fail without one). Absent: true (a turn fact when read). */
  canSwitch?: Partial<Record<DoublesSideId, boolean>>;
};

export type DoublesHit = {
  /* …existing… */
  /** "effect": a status move reached it and acted (its facts say what); the others as today. */
  kind: "calculated" | "blocked" | "no-damage" | "effect";
  /** HP a status move changed (heal +, cost −, Pain Split either), over every outcome; absent when none. */
  change?: { min: number; max: number };
};

export type DoublesStep = {
  /* …existing… */
  /** The extra use Instruct gives (a second step of the same slot). */
  repeat?: "instruct";
};

export type DoublesHP = {
  /* …existing (after the moves)… */
  /** HP it lost outside any step (a confusion self-hit on No move), as facts ("Hurts itself in confusion: 23–28 HP."). */
  losses?: string[];
  /** Its statuses and volatiles after the moves, with chances ("Asleep.", "Confused.", "Leech Seed.", "Substitute (35 HP)."). */
  conditions?: DoublesFact[];
};

/** E2: what the next turn reads of a Pokémon beyond its build (Training's PostMon.volatiles and value terms). */
export type DoublesVolatiles = {
  sleep?: { attempts: number; rest: boolean }; confusion?: { attempts: number }; infatuation?: DoublesSlotId;
  taunt?: true; disabled?: string; substitute?: number; stockpile?: number; focusEnergy?: true; dragonCheer?: 1 | 2;
  /* EOT: toxic, leechSeed, yawn, perish, healBlock, aquaRing, ingrain, curse, saltCure, trap… (EotState after the residual) */
};
export type DoublesOutcomeMon = { /* …existing… */ volatiles: DoublesVolatiles };
export type DoublesOutcome = {
  /* …existing… */
  /** Ally Switch: the side's two Pokémon stand swapped after the turn. */
  positions: Record<DoublesSideId, "kept" | "swapped">;
  sides: Record<DoublesSideId, { /* …existing… */ safeguard: boolean; mist: boolean; luckyChant: boolean;
    /** Hazards set on this side this turn (Magic Bounce sends them back). */ hazards: string[];
    /** A Wish pending on each position (heals at the next end of turn). */ wish: Partial<Record<DoublesSlotId, number>>;
    /** Heal Bell / Aromatherapy cured the side's bench too. */ partyCured: boolean }>;
};
```

`validate()` adds issues: `carried.sleep` without status "slp", `freeze` without "frz" or outside Champions, `confusion.attempts`
outside 0–4, `infatuation` on its own side or an empty position, `substitute` outside 1..floor(maxhp/4), `stockpile` outside 1–3,
`lastMove` not in the species' learnset, `moves` duplicates (each `{Name}: …` on that slot, never a crash).

---

## 8. Engine changes

### 8.1 Files
- `app/lib/battle/status-table.ts` (new, data only, no engine imports — like doubles-actions.ts): `STATUS_MOVE_TABLE:
  Record<moveId, StatusMoveEntry>` for every catalog status move: `{ kind: M|N|C|G|X; flags: { protect, reflectable, powder, sound,
  bypasssub, heal, dance, wind }; ignoreImmunity?: false; target?: (gen differences: Howl allies gen 8+); boosts?: per-game
  Stages incl. "accuracy"/"evasion"; self?: Stages; status?; volatile?; side?; handler?: HandlerKey; tryFails?: TryKey[];
  guard?: ReasonKey }`, `ENTRY_START_ABILITIES`, `UNREMOVABLE_ITEMS` (pinned onTakeItem), `DEFROST_MOVES`, `STOMP_MOVES`
  (minimize), `WEIGHT_MOVES`, `ABILITY_COPY_FLAGS` (from pinned ability flags). Source-checked (§11.3).
- `app/lib/battle/doubles-status.ts` (new): the pipeline, taking a `StatusKernel` (closures over doubles-turn.ts's `Ctx` like the EOT
  architect's `DoublesKernel`; one kernel type `TurnKernel` shared by both new modules): `beforeMove(kernel, w, action) → World[]`,
  `statusMove(kernel, w, action, move) → World[]`, `statusTargets`, `statusChecks`, `applyStatusEffects`, `applyBoosts`,
  `canStatus`/`setStatus`/`canSleep` (exported to doubles-eot.ts), `addVolatile`, `healSlot`, `loseHP`, `confusionHit`,
  `swapItems`, `changeAbility`, `eatNow`, `reflectMove`.
- `app/lib/battle/doubles-world.ts`: `MonState.vol: MoveVolatiles` (below), `World.swapped`, `PendingAction.order?`,
  `PendingAction.instructed?`, helpers `mapJoint` (shared with EOT), `lossDist` (convolution), `occupant`/`positionOf`.
- `app/lib/battle/doubles-turn.ts`: `execute()` calls `beforeMove()` (replacing the inline flinch/Gravity/Throat Chop/paralysis
  block and the sleep/freeze/confusion presence guards); `runMove()` routes status moves (`category === "Status" && !useZ`) to
  `doubles-status.ts`'s `statusMove()` (the existing protect/guard/Helping Hand/Follow Me/field branches move there unchanged);
  `keyOf()` adds `order`; `resolveTargets()` reads positions (Ally Switch); `hitReactions()` models Destiny Bond (attacker HP → 0
  via `mapHP`, Dynamax immune, `faint` after the target in the batch); `singleStep()`/`spreadStep()`: a target behind a Substitute
  → guard unless `bypasssub`/Infiltrator; `searchFor()`: `UsesEnv.endure` when the target has `vol.endure`; Pollen Puff on an ally
  → heal `floor(baseMaxhp/2)` (guard removed); `presenceGuards()` loses sleep/freeze/HP_STATUS (Revival Blessing stays) and gains
  Snatch/Transform presence; `turnFacts()` additions (§6).
- `app/lib/battle/calculate.ts`: `turnPriority()` adds Triage +3 for `heal`-flag status moves (table flag; today "Triage's status
  moves all change HP (the turn does not estimate them)" — no longer true); `certainCrit`/critRatio reads `build.dragonCheer`
  (`settledFocusEnergy` kept for Focus Energy and Lansat: one volatile, no stack); `GAS_STAND_IN` exported (exists).
- `app/lib/battle/types.ts` `BuildBase`: `dragonCheer?: 1 | 2` ("set only by the turn: Dragon Cheer's critical-hit stages").
  1v1 never sets it (golden unchanged).
- `app/lib/battle/uses-to-ko.ts` / `hit-loop.ts`: `UsesEnv.endure?: true` (turn mode only): in the hit loop, a hit that would take
  the target to 0 leaves 1 (`damage = hp - 1`), recorded like Sturdy's save (`SAVED` bit) but at any HP and for every hit of the
  turn (`PS/data/moves.ts:4806` onDamage priority −10 after Sturdy/Sash). 1v1 never sets it.
- `app/lib/battle/doubles-actions.ts`: tables move/merge (`MODELLED_STATUS_MOVES`, `NO_EFFECT_MOVES`, `HP_STATUS_MOVES` derive from
  `STATUS_MOVE_TABLE` kinds), `REASONS` additions (§3.3), `CALLING_MOVES` minus Instruct.

### 8.2 `MonState.vol` (moves-phase volatiles; `MonState.eot` is the EOT architect's)
```ts
export type MoveVolatiles = {
  sleep?: { elapsed: number; rest: boolean };        // with build.status "slp"
  freeze?: { attempts: number };                     // Champions only, with build.status "frz"
  confusion?: { attempts: number; axeKick?: true };  // fresh: 0
  infatuated?: DoublesSlotId;                        // position of the source
  taunt?: true; disabled?: string; imprisoning?: true;
  substitute?: number;                               // HP left
  endure?: true; magicCoat?: true;                   // this turn
  stockpile?: number; noRetreat?: true;
  minimized?: true; defenseCurl?: true; tarShot?: true; laserFocus?: true; electrified?: true; // guard markers
  lastUsed?: { moveId: string; target: DoublesSlotId | null }; // its move this turn (Instruct)
  usedItem?: string;                                 // its item used this turn (Recycle; EOT's usedItem/lastBerry kept in sync)
};
// SideState gains: safeguard, mist, luckyChant, craftyShield, matBlock (booleans), hazards: string[], wish (EOT: positions)
// World gains: swapped: Record<DoublesSideId, boolean>
// PendingAction gains: order?: number; instructed?: true
```
`cloneMon` copies `vol` shallowly (all fields immutable values); `discreteKey` already serialises `mons` and `sides`.

### 8.3 `beforeMove(kernel, w, action)` (replaces execute()'s inline checks)
For a living, not-flinch-skipped Pokémon (fainted/targetless paths unchanged), in priority order (§2.1), each random check
splits `w` into weighted worlds; worlds that stop record the skip fact and return; "Wakes up"/"Thaws"/"Snaps out" set state and
continue. The self-hit world calls `confusionHit` then returns (the action ends: `moved` true, no move). `Destiny Bond` volatile
cleared when its user starts another move. Runs for No move (moveId null) with the facts on the turn (`DoublesHP.losses`).

### 8.4 `statusMove(kernel, w, action, move)`
1. Existing early branches (ally-only failure, Protean, Protect family, Wide/Quick Guard, Helping Hand, Follow Me/Rage Powder,
   Destiny Bond, field moves) — Protect family gains Endure (`vol.endure`, same stall rule and `!w.remaining.length` failure);
   new side moves: Safeguard, Mist, Lucky Chant, Crafty Shield (+3 priority: before most), Mat Block (first-turn fact; fails after
   the user's first turn — assumption); field: Magic Room / Wonder Room toggles (`fieldGuard` for Room Service; `gasShieldGuard`
   already reads Magic Room), Court Change, Haze, Perish Song (each hearing Pokémon: `eot.perish = 4`), Teatime, Gear Up, Magnetic
   Flux, Flower Shield, Rototiller, Fairy Lock (N), hazards (N + `sides.hazards`, Magic Bounce side reflection).
2. Table entry by kind: N → no effect, return; G → `notEstimated(reason)` as the move is used, regardless of later actions (the
   end of turn reads everything), except the switch moves (Baton Pass, Teleport, Shed Tail, Roar, Whirlwind), which follow §3.2
   (a later living action: whole turn; none: `World.leaving`, end of turn only); C → condition check → model or guard; X → existing.
3. Targets (`statusTargets`): self / allies / ally / chosen / spread per target type, through `resolveTargets` for Pokémon targets
   (redirection only for `normal`/`any`/`adjacentFoe` single targets).
4. Try (`tryFails`), PrepareHit.
5. Per target `statusChecks` (§2.4) → blocked (hit kind "blocked" + fact), absorbed (absorber effect, existing `absorbEffect`),
   reflected (`reflectMove`: the holder uses the move at the source / source side with `bounced` set, recursion depth 1), immune
   (kind "no-damage" with the immunity fact, as today), or reached → effects (§2.4 step 6)
   in runMoveEffects order with the move's handler for `onHit` moves (heal, items, abilities, stage copy/swap/invert, Curse,
   Pain Split, Psycho Shift, Purify, Strength Sap, Defog, Ally Switch, After You, Quash, Instruct, Spotlight, Memento, Healing Wish,
   Wish, Charge, Focus Energy, Dragon Cheer, Rest, Substitute, Belly Drum, Fillet Away, Clangorous Soul, Stuff Cheeks, Take Heart,
   Tidy Up, Heal Bell, Aromatherapy, Refresh, Geomancy, Stockpile, Swallow, Recycle, Acupressure, Yawn, Leech Seed, Aqua Ring,
   Ingrain, Nightmare, Octolock, Imprison, Encore, Disable, Taunt, Attract, Captivate, Venom Drench, Spicy Extract…).
6. `eventGuards` (existing: Opportunist/Mirror Herb copying rises, Symbiosis, Eject Pack, Emergency Exit), `gasShieldGuard`,
   then the action's Update (`updateAll` shared with the EOT architect: curing Berries, Mental Herb, HP Berries) — today's
   `unnerveEnds` stays in `runMove`.

### 8.5 Budgets
Unchanged `BUDGET` (worlds 1 500, entries 200 000, calculations 160): status checks are arithmetic (no damage calculation) except
`usedType` reads for absorbers/redirection (memoised rows, already counted). New branching per turn ≤ 2 per BeforeMove check per
Pokémon (sleep/freeze/confusion/attract/paralysis) and ≤ 7 for Acupressure; the self-hit loss is a factor distribution, not
worlds. Bench additions: Teeter Dance + four confused movers + Quick Claw; Swagger into a Sitrus holder; Spore + Lum + Early Bird;
must stay within SPEC §9 (p50 ≤ 30 ms, p95 ≤ 120 ms, any ≤ 400 ms) — measured p50 today 3.3 ms. `DOUBLES_REFERENCE` (no merges,
no splits) gives the same results (test).

---

## 9. UI changes (2v2 only; 1v1 unchanged)

- `doubles-format.ts`: `hitLine` for kind `"effect"` prints the Pokémon's name, then `: +163 HP` / `: −87 HP` when `change` is set
  (`Chansey: +163 HP`), then `· reaches it 75%` when below 1; what the move did is the hit's facts, on their own lines below
  (existing rendering: `Is paralysed.`, `−2 Attack.`). A blocked or immune status hit (Crafty Shield, Magic Bounce, Good as Gold,
  a type immunity) prints `{Name}: no effect` instead of today's `{Name}: no damage` when the step's move is a status move (move
  category from the runtime). `stepHeading` unchanged (`1 · Thunder Wave · Jolteon (your left) →
  Snorlax (left foe)`). New `repeat` heading suffix ` (Instruct)`.
- `DoublesTurn.tsx`: step lists already render `skipped` + `facts` + hits; add `DoublesHP.losses` lines under the turn facts
  (`Jolteon hurts itself in confusion: 23–28 HP (33%).`).
- `DoublesCard.tsx`: under the HP bar, `DoublesHP.conditions` as one muted line (`Asleep · Confused 67%`); the screen-reader HP text
  appends them.
- `DoublesSettings` / `doubles-prep.ts` (2v2 slot settings, next to the status select): **Turns asleep** (0–3, shown when status
  is Asleep; plus a **Rest** checkbox), **Turns frozen** (0–2, Champions, Frozen), **Confused** checkbox + **Turns confused**
  (0–4), stored in slot state → `carried`; defaults produce the turn facts (§6). The EOT architect's Bad poison stage select sits
  in the same row. (Open question §13 Q1.)
- `useDoublesView.tsx`: passes each slot's quick moves as `moves: { ids, complete: true }` (the 2v2 slot's four moves) and
  `lastMove` absent (unknown).
- 375 px: new lines wrap (`wrap-anywhere`); selects reuse the existing compact control style.

---

## 10. Training impact

- **More engine cells, fewer rollouts**: today any status move outside the v1 list with a later action (Thunder Wave, Spore,
  Taunt, Will-O-Wisp, Trick, Swords Dance, Snarl's partner moves…) sends the cell to a rollout; after this change only the G/C
  guards do. Expected: the share of engine cells rises (measure in conformance: "byMethod" engine vs rollout); decision p95 within
  +10% of 576 ms (E2 is a few ms; rollouts are 3.8 ms each).
- **bridge.ts**: `carriedOf()` (EOT architect) also maps: `slp` → `sleep: { attempts, rest }` from the **tracker's public counts**
  (`|cant|…|slp` lines since the `-status` line; Rest from the `[from] move: Rest` tag), Champions `frz` → `freeze.attempts`,
  `volatiles.confusion` → `confusion.attempts` (`-activate … confusion` count since `-start`), `attract` → source position, `taunt`,
  `disable` (effectState.move: public from `-start …|Disable|{Move}`), `substitute` (hp: **hidden** to the opponent — public only
  that it exists; the belief battle's value is a belief draw, exact per belief world as for traps), `stockpile` (layers public),
  `noretreat`, `focusenergy`, `dragoncheer` (+2 if Dragon), `imprison` (+ `moves` complete only for the AI's own side or a fully
  revealed foe), `lastMove` (public `|move|` lines, with target position). `IGNORED_VOLATILES` loses the mapped ones; still
  rollout: `encore` with a different chosen move (request already forces the move — keep ignored), `electrify`, `powder`,
  `magnetrise`/`telekinesis` (EOT maps them), `minimize`, `defensecurl`, `tarshot`, `laserfocus`, `snatch`, `transform`,
  `mustrecharge` + confusion/attract (§3.4).
  Showdown's hidden counters (`statusState.time`, `volatiles.confusion.time`) are never read: `leak.ts` must still show 0
  differences (add the new fields to its diff).
- **engine-provider / candidates**: status moves the AI considers (already: Tailwind, Trick Room, Follow Me) can now include every
  M/C status move it holds; candidates.ts keeps its pruning, the evaluation becomes exact instead of rollout.
- **evaluate.ts `postFromOutcome`**: copy `outcome.mons[slot].volatiles` into `PostMon.volatiles` (SPEC 10.6 weights: sleep turns
  left from the posterior, confusion, taunt, substitute HP, Leech Seed, perish, Yawn), apply `positions` (Ally Switch: swap the
  side's PostMon slots), `sides.hazards` into `nextClock` (instead of HAZARD_MOVES by the user's side — Magic Bounce), `wish` into
  the clock, `partyCured` to bench statuses. `value.ts` `sleepTurns` reads the posterior's expected turns, not
  `statusState.time` (today `services.ts:150` reads the hidden time — a leak risk to fix with this change).
- **conformance.ts**: gate 4b's containment uses the after-turn HP when `endOfTurn` is applied (EOT §9); the effect census adds
  the new status moves; `HIDDEN_VOLATILES` (sleep/confusion/substitute "hidden in play") stays as the clean-sample filter.
- **Gates**: vs RandomLegal ≥ 90%, vs MaxDamage ≥ 60%, self-play 50 ± 7, conformance + leak pass; Training unit tests updated
  for the new outcome fields.

---

## 11. Oracle changes (scripts/.cache/calc-audit/2v2/verify) — on top of EOT §10

1. `sim-dfs.ts`: residual-running segments (EOT §10.1); `CHANCE_EFFECTS` += `attract` (and EOT's `healer`, `shedskin`, `harvest`);
   `sample` and `random` already enumerate Acupressure, sleep length, confusion length, Encore's random target. Keep forcing:
   accuracy passes, secondaries below 100% fail, crits only when certain.
2. **Carried moves-phase state** in `prepare()` from `CaseMon.carried`: `sleep: { time, startTime }` → `statusState.time/startTime`
   (exact hidden values), `freezeTime` (Champions), `confusion: { time }` → `addVolatile('confusion')` then `.time`, `attract:
   SlotId` → `addVolatile('attract', source)`, `taunt`, `disable: move` (`addVolatile('disable')` + `effectState.move` after
   setting `lastMove`), `substitute: hp`, `stockpile: n`, `focusEnergy`, `dragonCheer`, `lastMove: { move, target }` → `p.lastMove =
   dex.getActiveMove(id)`, `p.lastMoveTargetLoc`, and `p.moveSlots` includes it; `imprison`.
3. **Hidden-counter expansion** (validates §5): `CaseMon.attempts?: { sleep?: number; rest?: boolean; freeze?: number;
   confusion?: number }` → `expandHidden(c)` yields weighted sub-cases with every hidden value consistent with the attempts
   (posterior weights from the priors: sleep S ∈ {2,3,4} uniform or Champions {2,3,3}, minus those already woken; confusion
   T ∈ {2..5}), each run exactly with `time = S − elapsed` etc.; the oracle mixes their walks by weight (Tally accepts a
   per-run prior weight). The app side passes `carried.sleep = { attempts, rest }`. Equality within 1e-9 checks the formulas.
4. **Status lines per target**: `Recorder` keeps per action and per target the mass of `-status|X|slp|par|brn|psn|tox`,
   `-start|X|confusion|Attract|Taunt|Leech Seed|Curse|perish3|Substitute|…`, `-boost/-unboost|X|stat|n`, `-setboost`,
   `-clearallboost`, `-copyboost`, `-invertboost`, `-swapboost`, `-heal|X` (amount from HP diff), `-sethp`, `-curestatus`,
   `-activate|X|move: Safeguard|Mist|Crafty Shield|Magic Coat…`, `-immune|X`, `-fail`, `cant|X|slp|frz|move: Taunt|Disable|
   Imprison|Attract`, `-item/-enditem` (Trick), `-ability` (Skill Swap), `swap` (Ally Switch) → `StepResult.effects[target]:
   Record<key, mass>` with a stable key (`status:par`, `boost:atk:-2`, `cant:slp`…).
5. `compare.ts`: for status steps, each oracle effect key ↔ the app fact category (mapping table `EFFECT_FACTS` in compare.ts:
   `status:par` ↔ `Is paralysed.`, `boost:atk:-2` ↔ `−2 Attack.`, `cant:slp` ↔ skipped `Asleep.`, …) with chance within 1e-9;
   `change` min/max vs the HP deltas; `kind` "effect"/"blocked"/"no-damage" vs reached/landed; HP after the moves and after the
   turn as today/EOT.
6. `case-types.ts`: `CaseMon.carried`, `CaseMon.attempts`, `CaseMon.lastMove`, `CaseMon.moves` (extra moves for Imprison: the
   oracle `sdSet` gets them), `StepResult.effects`.
7. `app-turn.ts`: maps `carried`/`attempts`/`lastMove`/`moves` into `DoublesPokemonInput`; `canSwitch` from the bench (always true
   in the oracle: one bench Pokémon per side).
8. `gen-tests.ts`: emits the S cases into `tests/unit/doubles-turn-showdown.test.ts` and the E2 test (volatiles in outcomes).
9. All existing 556 results re-run: after-the-moves fields byte-equal except cases whose turn changes by design (today
   not-estimated status-move cases V35/V36-style become ready: listed and re-validated).

---

## 12. Test cases

### 12.1 Oracle cases (`S` series; all three walks; exhaustive unless marked)
| Id | Game | Setup | Checks |
|---|---|---|---|
| S01 | sv, champions, usum, swsh | Hypnosis into a slower attacker; Early Bird variant (P1) | no wake on the first; Early Bird 1/3; status after |
| S02 | champions, sv | Spore/Sleep Powder into Grass, Overcoat, Safety Goggles; into Electric Terrain grounded vs Flying | powder & terrain blocks |
| S03 | sv | Sleep Powder into a Chesto / Lum holder that moves later (Q11) | cure at once, then moves |
| S04 | sv | Yawn turn (P2); carried yawn 1 + Bad Dreams (R17, with EOT) | drowsy outcome; sleep at 23 |
| S05 | sv, champions, usum, swsh | Thunder Wave on a faster foe (P3) | re-sort gen 8+, frozen gen 7; 1/4 vs 1/8 |
| S06 | sv | Thunder Wave into Ground, Electric, Limber, Volt Absorb, Lightning Rod partner (R2, Q25) | immunities, redirection, +1 Sp. Atk |
| S07 | sv | Glare into Ghost; Stun Spore into Grass (R2) | type rules |
| S08 | sv | Will-O-Wisp then physical hits (P6); into Flash Fire / Well-Baked Body / Water Veil (R3, R8c) | halving; absorbers |
| S09 | sv, champions | Toxic / Toxic Thread (Q28), into Purifying Salt (R8b), Synchronize (Q22b), Corrosion into Steel | tox stage 0; Synchronize |
| S10 | sv, champions, usum | Confuse Ray then the target attacks (P4, rolls all) | 33% × 16-roll self-hit HP |
| S11 | sv | Swagger (+2) self-hit (P4b); Own Tempo (R8b); Safeguard (R5) | +2 read; immunities |
| S12 | sv | Swagger into Sturdy full HP (R1a); Disguise (R1b); Magic Guard + Sitrus (R1c); Assurance after (R1d) | self-hit handlers |
| S13 | sv | Teeter Dance (Q15) then every confused Pokémon moves (No move too) | per-Pokémon branches; No move self-hit |
| S14 | sv | Attract (P9); same gender; Oblivious; Destiny Knot; Mental Herb | 1/2; blocks |
| S15 | sv | Taunt then the target's status move (P5); Oblivious (R7); Mental Herb (R7); Aroma Veil partner | cant Taunt |
| S16 | sv, champions | Charm/Fake Tears/Screech into Clear Body, Mirror Armor, Defiant, Competitive, Contrary, Simple (R6) | boost rules |
| S17 | sv | Mist side vs Screech; Infiltrator (R5b) | Mist |
| S18 | sv | Growl/Leer/String Shot spread; Wide Guard (Q27); Magic Bounce one foe (Q8b) | spread status |
| S19 | sv | Sweet Scent into Defiant/Competitive (evasion drop reactions) | not-stored stages react |
| S20 | sv | Swords Dance, Nasty Plot, Dragon Dance then attack; Agility re-sort | self boosts read |
| S21 | sv | Shell Smash with White Herb | White Herb timing |
| S22 | champions | Coaching, Decorate, Howl (sound; Soundproof ally), Aromatic Mist | ally boosts |
| S23 | sv | Acupressure on the ally (Q14) then its attack | 1/7 branches |
| S24 | sv | Psych Up (Q7) on a +2 Focus Energy foe with Scope Lens: certain crit after | copy + crit |
| S25 | sv | Haze, Topsy-Turvy, Heart Swap, Guard Swap, Power Swap then attacks | stage ops |
| S26 | sv, usum | Quash (Q3), After You (Q3b) gen 9 and gen 7; After You on a moved target (R16) | order |
| S27 | sv | Ally Switch (Q4) with a foe aiming at the left position and a spread move after | positions |
| S28 | sv | Instruct the ally after it moved (Q18); Instruct a target not yet moved with `lastMove` | repeat step |
| S29 | sv, champions | Encore after the target moved (Q19); before it moved with `lastMove` (R9, random target) | needs lastMove; branches |
| S30 | sv, champions | Disable before the target's move with `lastMove` (R9b) | cant Disable |
| S31 | sv | Imprison with the user's moves (R10) | cant Imprison |
| S32 | sv | Trick Choice Scarf (Q1); Trick Sitrus to a low foe (R11); Sticky Hold (R11b); Unburden | items |
| S33 | sv | Skill Swap Intimidate (Q2 → guarded `abilityStart`), Skill Swap Levitate ↔ plain then Earthquake | ability change |
| S34 | sv | Worry Seed on a sleeper (Q2b); Simple Beam then a boost; Gastro Acid on Multiscale then a hit | ability effects |
| S35 | sv | Entrainment onto a Truant target (fails); Role Play of Huge Power then attack | copy rules |
| S36 | sv | Recover, Roost (Q5e → guarded with a later hit), Slack Off, Milk Drink (Champions ally) at low HP | heals |
| S37 | sv | Moonlight in sun/rain/sand, Umbrella (Q5b); Synthesis, Morning Sun; Shore Up in sand | weather heals |
| S38 | sv | Heal Pulse on the ally (Q5a), Mega Launcher; Floral Healing in Grassy (Q5d); Life Dew both | ally heals |
| S39 | sv | Strength Sap on +2 Atk foe (Q5c), Big Root, Liquid Ooze target | Strength Sap |
| S40 | sv | Pain Split (Q5c) with Sitrus on the higher one | joint HP + Berry |
| S41 | sv | Belly Drum with Sitrus (Q12); at exactly half fails (R15); Fillet Away, Clangorous Soul | costs + Update |
| S42 | sv | Ghost Curse (Q12) + end of turn; non-Ghost Curse re-sort | Curse |
| S43 | sv | Substitute then Thunder Wave fails, sound move passes (Q6); Infiltrator status move | sub blocks status |
| S44 | sv | Substitute then a later hit (Q6b) → not estimated `Hits on {Name}'s Substitute are not modelled.` | guard text |
| S45 | sv | Memento then the target attacks (Q13) | faint + drops |
| S46 | sv | Healing Wish user faints; Lunar Dance; `canSwitch` false → fails | fact |
| S47 | sv | Rest (Q22) poisoned at 1/3 then a foe's Body Slam | full HP, sleep 3 |
| S48 | sv | Endure + KO hit (Q16); Endure + multi-hit; Endure slowest fails (no action after) | endure env |
| S49 | sv | Destiny Bond then a KO (D1); Dynamax attacker (swsh) immune | DB modelled |
| S50 | usum | Crafty Shield vs ally Heal Pulse + foe Thunder Wave (Q17) | side block |
| S51 | swsh | Mat Block first turn vs foes' attacks | side block |
| S52 | swsh, usum | Magic Coat vs Taunt and String Shot | reflection |
| S53 | sv | Magic Bounce vs Thunder Wave (Q8), vs Stealth Rock (hazards on the user's side, E2) | reflection |
| S54 | sv | Prankster Thunder Wave into Dark (Q9), into Psychic Terrain grounded (R4), Quick Guard (R4b) | priority rules |
| S55 | sv | Safeguard vs Swagger/Thunder Wave (R5); Yawn into Safeguard | Safeguard |
| S56 | sv | Good as Gold vs foe and ally status moves (Q24) | TryHit block |
| S57 | sv | Follow Me + single-target Thunder Wave (Q26); Rage Powder vs Grass user's Spore | redirection |
| S58 | sv | Lightning Rod partner + Thunder Wave (Q25); Sap Sipper + Spore (Q25b); Storm Drain + Soak (guarded) | absorbers |
| S59 | sv | Leech Seed this turn (R18) into Grass (immune), into a Substitute (fails), Liquid Ooze, Big Root | with EOT |
| S60 | sv | Aqua Ring + Ingrain this turn; Ingrain user then Earthquake (Flying ingrained: guarded) | with EOT |
| S61 | sv | Perish Song (R21) with Soundproof | perish 3 outcome |
| S62 | sv | Charge then Thunderbolt the same turn (+ Sp. Def +1) | charged |
| S63 | sv, champions | Focus Energy + Scope Lens then attack (Q21); Dragon Cheer on a Dragon ally with Super Luck | certain crits |
| S64 | sv | Defog (R13) then a hit into the former Reflect side; Court Change swaps Tailwind (re-sort) | field ops |
| S65 | sv | Magic Room (R14) then a Sitrus hit; Wonder Room then a special hit | rooms |
| S66 | sv | Stuff Cheeks (D2) with Sitrus/Lum/Figy (nature confusion); Teatime both sides | eat at any HP |
| S67 | sv | Heal Bell / Aromatherapy (swsh) with a Soundproof / Sap Sipper ally | cures |
| S68 | sv, champions, usum | carried sleep attempts 0, 1, 2 (+ Early Bird, Rest) vs hidden-counter expansion | §5 posterior |
| S69 | sv, champions | carried freeze (SV no input; Champions attempts 0, 1, 2) (P8) | thaw hazard |
| S70 | sv | carried confusion attempts 0..4 vs expansion; Persim Berry | snap-out hazard |
| S71 | sv | Wish this turn (E2 pending); Wish carried (EOT) | wish |
| S72 | sv | Spotlight (usum) + Magic Bounce reflection | centre |
| S73 | sv | Teeter Dance + Quick Claw + four movers (bench case; `oracle: "modes"` if > 200k runs) | budget |
| S74 | sv | Pollen Puff on the ally (heal floor(1/2), Heal Block) | Pollen Puff |
| S75 | sv | Not-estimated texts: Soak, Speed Swap, Power Split, Transform, Revival Blessing, Laser Focus + attack, Disable without lastMove, Imprison without moves, Skill Swap Intimidate, Trick Booster Energy | exact reasons + start rows |

### 12.2 Unit tests (tests/unit)
- `doubles-status.test.ts` (new): the BeforeMove chain order and facts; posterior hazards (sleep/freeze/confusion tables of §5
  exactly, Early Bird, Rest, Axe Kick); `canStatus` blockers matrix (one test per row of §3.6, Mold Breaker and Ability Shield);
  `applyBoosts` (Mist, Clear Body, Mirror Armor, Defiant, Contrary/Simple, ±6, accuracy/evasion reactions); heal amounts (§3.5 each
  formula with odd max HP); confusion damage (P4 values: 23–28, 46–55; Wonder Room swap); `swapItems` rules; `changeAbility` rules
  and `ENTRY_START_ABILITIES` guard; order keys (After You/Quash gen 8+ and gen 7); Ally Switch target mapping; every new REASONS
  text exactly; `DOUBLES_REFERENCE` equality on 20 status turns; contract validation issues for bad `carried`.
- `doubles-outcomes.test.ts`: volatiles, positions, hazards (Magic Bounce), wish, partyCured.
- `doubles-turn-showdown.test.ts`: regenerated (S cases).
- 1v1: `golden-1v1.full.json.gz` byte-equal; `calculator-uses-to-ko*` unchanged (`UsesEnv.endure` and `dragonCheer` unset in 1v1).
- UI: `calculator-doubles-ui.test.ts` — effect hit lines (`Chansey: +163 HP`), skip facts, `losses`, conditions line, sleep/
  freeze/confusion controls and their facts, 375 px no overflow.
- Training: bridge mapping test (public counts only; leak diff fields), evaluate test (volatiles/positions/hazards/wish into the
  post state), engine-provider cell method counts on a status-heavy fixture.

### 12.3 Source tests (tests/source)
- `doubles-status-moves.test.ts` (new): every Status move in the four catalogs has exactly one `STATUS_MOVE_TABLE` entry; for each,
  per game, the pinned dex's `flags` (protect, reflectable, powder, sound, bypasssub, heal, dance, wind), `boosts`, `status`,
  `volatileStatus`, `target`, `priority`, `ignoreImmunity` equal the table's; a move with an `onHit`/`onTry`/`onTryHit`/condition
  handler must have a `handler` or `guard`; `ENTRY_START_ABILITIES` ⊇ every catalog ability with an `onStart` that is not
  message-only (allow-list of message-only Starts: Pressure, Mold Breaker, Teravolt, Turboblaze, Unnerve, As One, Comatose,
  Frisk, Anticipation, Forewarn, Air Lock/Cloud Nine (weather read live), Dark/Fairy Aura, Aura Break, the Ruins); `UNREMOVABLE_ITEMS`
  = items with `onTakeItem` returning false; BeforeMove priorities (§2.1) equal pinned `onBeforeMovePriority` values.
- `doubles-third-party.test.ts`: the status-move abilities (Magic Bounce, Good as Gold, Sweet Veil, Flower Veil, Pastel Veil, Aroma
  Veil, Oblivious, Own Tempo, Synchronize, Early Bird, Mirror Armor, Defiant, Competitive) move from guarded to modelled.

---

## 13. Open questions for the user (each with the recommended default)

1. **Sleep/freeze/confusion counters in the calculator.** Default: 2v2-only controls (Turns asleep + Rest, Turns frozen in
   Champions, Confused + turns) next to the status select; when left at 0 the turn says
   `Assumes {Name} has not tried to move since it fell asleep.` Alternative: no controls, always assume 0 (fact).
2. **Encore / Disable / Instruct on a Pokémon that has not moved yet.** Default: not estimated in the calculator
   (`{Move} needs {Name}'s move from the last turn.`); Training passes the last move. Alternative: a "Last move" select per slot.
3. **Substitute hits.** Default: a later hit into a Substitute is not estimated (status moves into it are modelled). Alternative:
   model hits on the Substitute (its HP as a discrete state; recoil/drain/Life Orb from the damage to it; multi-hits continuing
   into the Pokémon, R19) — a follow-up.

---

## 14. Build plan (fits the EOT architect's §12; disjoint ownership)

0. **Contract** (one owner, with EOT §12.0): §7 here + EOT §7/§5.2 into doubles-types.ts; `MoveVolatiles`, `World.swapped`,
   `PendingAction.order/instructed`, `TurnKernel` type, `lossDist`/`mapJoint`/`occupant` stubs in doubles-world.ts.
1. **Status table** (`status-table.ts`) + its source test — data only, parallel with everything.
2. **Status engine** (`doubles-status.ts` + doubles-turn.ts edits §8.1 + calculate.ts Triage/crit + hit-loop `endure`): depends on
   0 and 1. Gate: golden-1v1 byte-equal, existing doubles tests, `DOUBLES_REFERENCE` equality.
3. **Oracle S cases** (sim-dfs carried/expansion/effects, compare mapping, cases S01–S75): parallel with 2 (after EOT's residual
   segment lands, or rebased on it).
4. **UI** (doubles-format, DoublesTurn, DoublesCard, slot controls): parallel against the contract.
5. **Training** (bridge carried/lastMove/moves, evaluate volatiles/positions/hazards, value sleep posterior, conformance census,
   leak fields): after 2 and the EOT engine.
6. Integrator with the EOT build: compare all (556 + R + S), `npm run check`, golden, bench, conformance + leak + eval gates, live
   check; reviewers; fixer.

## 15. Risks
- **Interaction volume**: status moves touch many abilities/items; the source tests (table vs pinned dex, ENTRY_START, onTakeItem,
  BeforeMove priorities) catch drift, and every unmodelled interaction has a named guard.
- **World growth** from per-Pokémon BeforeMove branches (Teeter Dance + Quick Claw + ties): bounded by BUDGET; S73 measures.
- **Hidden information in Training**: counters only from the public log; leak gate extended to the new carried fields.
- **Ally Switch positions** touch target resolution everywhere; S27 + start-row tests + a reference-mode equality run.
- **Two architects, one World**: `MonState.eot` (EOT) vs `MonState.vol` (status) keep writers apart; the shared helpers
  (`updateAll`, `mapJoint`, `canSleep`, `TurnKernel`) have one owner each (EOT: `updateAll`, `mapJoint`; status: `canSleep`,
  `canStatus`, `lossDist`, `occupant`).
