# Track B: end of turn + Training (status-eot)

Branch `calc-2v2-status-eot`. SPEC §4.7–§4.9, §6 and ADDENDUM's B work (§2.3 delta, C16, C18, §4.11.5, §6, §6.0).
Ground truth pinned Showdown c23d2e94; every number below was checked against it through Track D's in-progress oracle
(`2v2/verify/sim-dfs.ts`, read-only use) with `build/trackb-check.ts`.

## What I built

### `app/lib/battle/residuals.ts` (new, pure)
SPEC §4.8's contract: `ResidualKey`, `ResidualMon`, `ResidualId`, `OwnResidual`, `weatherResiduals`, `ownResiduals`,
`badDreamsDamage`, `leechSeedDamage`, `bigRoot`, `RESIDUAL_KEYS` (every handler key the engines use, resolvePriority's
default subOrders included), plus `residualPart` and `LAST_ORDER` (no-order handlers: Micle Berry).
Magic Guard stops damage, Heal Block every heal (Poison Heal's too, which then also takes no damage).

### `uses-to-ko.ts` `residuals()` (the 1v1 adapter only)
Builds a `ResidualMon` from the 1v1 side (status "" once Hydration cures it), calls `weatherResiduals`/`ownResiduals`,
inserts the foe's Bad Dreams before Sticky Barb, keeps today's names through `RESIDUAL_PHRASES` and today's coarse orders
and UPDATE positions (C14). **golden-1v1: 254 cases byte-equal** (full corpus), `calculator-uses-to-ko*` 203/203 unchanged.
The §4.8 fallback was not needed. Pre-existing 1v1 corner kept for byte equality: Bad Dreams still reads a sleep that
Hydration cures at 5.3 (rain + Hydration + asleep + a Bad Dreams foe); pinned Showdown would not damage it.

### `app/lib/battle/doubles-eot.ts` (the phase; was the Step 0 stub)
- `endOfTurn(kernel, worlds)`: guards first (the reason with the most mass, ties alphabetical: `endGuard`, `leaving` →
  `switchesOut`, carried Future Sight → `landing`, carried Cud Chew, a Harvest holder with no item, Pickup with an item used,
  a G-Max over-time move that landed (SwSh) → `overTime`, Moody in E2), then per world: handlers collected once at the
  residual start with `(order, priority, Speed, subOrder)` keys (`kernel.speedOf`: Trick Room, Tailwind as the moves left
  them), tie groups run once when they commute (reads/writes per handler) else every order as its own world at mass/k!
  (k ≤ 5, else `tooMany`; reference mode always permutes), `faintMessages` after every handler (split by HP, `kernel.faint`),
  the weather's own Update (before its faints: a Pokémon at 0 HP neither eats nor stops a Berry), the final Update, then
  Emergency Exit / Wimp Out facts (split by HP at the residual start). Merges after every group; the budget checked after
  every group and every original world.
- Battle end: a world where a side with `canSwitch: false` has every present Pokémon fainted is over (Showdown's checkWin);
  it passes through the residual unchanged (no handler, no Update). `canSwitch` undefined: the turn fact `Assumes {your
  side|the opponent's side} has a Pokémon left to switch in.` when that wipe happens.
- Handlers: weather (duration countdown with `weatherTurns`, Cloud Nine, always-call weathers, Speed order, Update), Wish
  (by occupant, A7), Grassy Terrain, Healer (Champions 1/2, else 3/10), Hydration, Shed Skin (33/100), Leftovers, Black
  Sludge, Aqua Ring, Ingrain, Leech Seed (gainer = occupant of the seeder position, A6; joint map; Big Root; Liquid Ooze;
  Magic Guard; its own position after an Ally Switch), poison/bad poison (stage rises even under Magic Guard)/Poison Heal,
  burn, Curse, partial trap (source check), Salt Cure, Syrup Bomb (removed before the residual when its source fainted in
  the moves), Yawn (sleep through Track A's `canSleep`/`setStatus`; Lum at once via AfterSetStatus), Perish, Bad Dreams,
  Speed Boost, Moody (calculator fact; E2 not estimated), Sticky Barb, Flame/Toxic Orb (Track A's `canStatus`), form lines
  (Zen Mode, Shields Down, Schooling, Power Construct → `formChange`), Hunger Switch, White Herb, Eject Pack (fact), Micle
  Berry (C18, last, Cheek Pouch), the Updates' Berries (HP and pinch Berries, Lansat, Starf (E2 not estimated), curing
  Berries, Persim; Unnerve from holders with HP; Heal Block stops HP Berries and Cheek Pouch).
- After-phase guards: Opportunist / Mirror Herb copying a residual rise, Symbiosis after an item used up, a strong
  weather or the weather ending with a field-settled ability or item in (`fieldChange`), Liquid Ooze into a heal-blocked
  seeder (`notIn2v2("Liquid Ooze")`, the TryHeal order is not followed).
- Statistics (recording walk only): `DoublesResidual` per (slot, effect, other), per event; mutual Leech Seed keeps the
  drain and the heal as two entries. Sorted by first key. Effect names below.
- Facts: turn facts through `kernel.turnFact` (`Assumes the {Weather} does not end this turn.` when an old weather with no
  `weatherTurns` changes HP; `Assumes this is {Name}'s first turn of bad poison damage.`; `Assumes Dynamax started this
  turn.` (SwSh); `Moody raises one stat and lowers another.`); `endOfTurn.facts`: `{Weather} ends.`. `endFacts` returns [].
- Hooks: `afterHit` (trap from the trapping moves with the move kept for the name, Salt Cure and Syrup Bomb via
  `secondaryLands`, Psychic Noise's Heal Block with Aroma Veil and Mental Herb, Smack Down; C16 Rapid Spin / Mortal Spin
  end the user's Leech Seed, trap and its side's new hazards; Ceaseless Edge / Stone Axe hazards on the foes' side),
  `charging` (`eot.hidden`), `leaving`, `conditions` (`Leech Seed.`, `Trapped by {Move}.` / `Partially trapped.`, `Salt
  Cure.`, `Aqua Ring.`, `Ingrain.`, `Cursed.`, `Heal Block.`, `Drowsy.`, `Perish count N.`: after the moves the count shown,
  after the turn the count after its countdown), `outcomeMon` (volatiles leechseed, partiallytrapped, saltcure, aquaring,
  ingrain, curse, healblock, syrupbomb, yawn, perishsong; `perishCount` after this turn). Worlds the phase returned are
  marked (a WeakSet) so these two read them as after the turn.

### Training
- `sim/tracker.ts`: public counts kept on the exported PublicMon (`PublicCounts`: `restSleep`, `allySwitchStreak`,
  `itemSince`), Axe Kick's confusion (`moveId: "axekick"`), Substitute stints (`sourceKey` = maker, `hits` from
  `-activate|X|move: Substitute|[damage]`; Baton Pass / Shed Tail copy them).
- `sim/effects.ts`: Substitute HP = the maker's quarter while no hit has met it (else the old approximation, rollouts only);
  `allyswitch` volatile `{ counter: 3^streak ≤ 729, duration: 1 }`; Axe Kick's confusion 3–5; no Choice lock when the Choice
  item arrived by Trick/Switcheroo during or after its last move.
- `sim/bridge.ts`: `SPLITS_BRANCH_SLEEP = true` (exported): while `sim/splits.ts` still forks the sleeper's wake and the
  frozen Pokémon's thaw before the engine, the bridge carries no sleep or freeze count (the forked worlds' "awake" status ""
  with a carried freeze made E2 return issues, and both would branch the same roll twice); a frozen Pokémon and an Early
  Bird sleeper are rollouts until the integrator removes those forks and flips the flag (needs). `carriedOf` (public counts:
  sleep + Rest and Champions freeze once the flag is false, confusion + Axe Kick, bad poison; belief
  battle per world: Leech Seed position, a trap that still damages now (duration > 1, source in; Binding Band), Salt Cure,
  Aqua Ring, Ingrain, Curse, Syrup Bomb, Yawn landing now, perish, Wish and Future Sight landing at its position, Cud Chew due,
  Substitute with no hit, Ally Switch counter); `lastMove`, `moves`, `canSwitch`, `weatherTurns`, `build.focusEnergy`,
  `build.dragonCheer`. IGNORED_VOLATILES trimmed to SPEC §6's list; mapped volatiles in MAPPED_VOLATILES; Heal Block,
  Attract, Destiny Bond, Magnet Rise, Telekinesis, Nightmare, Octolock are rollout reasons now. New rollout reasons: a
  remapped No move while confused (Recharge, Fake Out after the first turn), Ingrain on a Pokémon not grounded otherwise,
  a Substitute after a hit, Leech Seed / a trap / Syrup Bomb from an ally (contract: sources must be foes), a G-Max trap,
  and a count the bridge needs without `publicOf` (see needs).
- `ai/evaluate.ts` `postFromOutcome`: `endOfTurn: "applied"` → no residual pass (read lazily, only for outcomes not applied);
  `PostMon.volatiles`, `sleepTurns`, `perishCount` from the outcome; hazards from `outcome.sides[side].hazards` (the
  HAZARD_MOVES inference is gone); `positions` "swapped" exchanges the side's two slots; PostState.endOfTurn "applied".
- `scripts/training/conformance.ts`: gate 4b reads Showdown's HP after the whole turn for engine cells whose every world
  applied the end of turn; new row 4c (report): applied share of engine cells and the decisions' cells by method.
- `scripts/training/leak.ts`: unchanged. L1 compares each decision's AiInputs and output; the bridge's new inputs are a
  function of AiInputs and the belief worlds only (public counts, belief-world values), so L1's equality covers them.

## Tests
- `tests/unit/residuals.test.ts` (11): every id's amount and key, immunities, Magic Guard, Heatproof, Big Root 22→29 and
  19→25, bad poison stages, Champions Salt Cure, Heal Block, Bad Dreams, Leech Seed.
- `tests/unit/doubles-eot.test.ts` (26): nothing acts ⇒ endOfTurn.hp = hp; sand + weather Update Sitrus + Leftovers order;
  weatherTurns 1; hit KO + residual KO = after-turn KO; E2 mixture = endOfTurn.hp; reference mode; mutual Leech Seed (C9);
  commuting tie; Healer/Shed Skin; Leech Seed Big Root/Liquid Ooze; trap source fainting; Yawn → sleep → Bad Dreams, Lum;
  perish + Wish + conditions + E2 volatiles; Micle + Cheek Pouch (C18); Emergency Exit; Speed Boost and Orbs (E2 builds);
  Fire Spin this turn; Psychic Noise (+ Mental Herb; a Sitrus Berry the hit's Update may eat: not estimated); Rapid Spin (C16); Ceaseless Edge hazards (E2); Dig/Fly; guards
  (switch-out last, Future Sight, Cud Chew, Harvest, Shields Down form line, Moody); Ally Switch then Leech Seed / Wish by
  position.
- `tests/unit/doubles-outcomes.test.ts`: outcomes compared with endOfTurn.hp when applied (else hp), the applied/not
  estimated status agreeing (Moody/Starf: E2 only); its case builder now mirrors doubles-turn-showdown.test.ts's (carried
  state, Substitute, last move, moves, weatherTurns, canSwitch, no chosen target for a move that takes none), so all 644
  stored cases are ready in both. 4/4.
- `tests/source/doubles-residuals.test.ts` (3): every pinned residual handler (base + Champions dex) classified;
  modelled ones' keys equal `RESIDUAL_KEYS`; "unreachable" only for what no catalog has.
- Training: `training-tracker` (+1: Rest, Axe Kick, Substitute maker/hits, Ally Switch streak incl. plain -fail and a skipped
  turn, Trick arrival), `training-bridge` (+1 mapping test; containment reads after the turn when applied; rollout reasons
  updated), `training-belief-battle` (+1: maker's quarter, Ally Switch counter, Axe Kick, Choice lock after Trick),
  `training-ai-evaluate` (+3: applied ⇒ no residual read, volatiles/perish/sleep/hazards, positions; the rollout test now
  uses Worry Seed).
- Track B's set (residuals, doubles-eot, doubles-outcomes, every training-*, calculator-uses-to-ko*, doubles-turn-showdown):
  62 files, 1460/1460; `tests/source/doubles-residuals.test.ts` 3/3 (battle-data config).
- Full unit suite: 5274/5288; the 14 failures are stale expectations in files Track B does not own: the Step 0 stub
  assertions (doubles-kernel "end of turn is not applied", doubles-turn-mechanics END_FACT ×2: needs 3, 4) and guards
  other tracks' work now models (doubles-kernel Substitute hit, doubles-start-rows SR44 Taunt, doubles-turn-fixes R01 /
  R15 / F14a / F14b confusion and sleep, doubles-turn-guards ×5 status moves, sleep/freeze/confusion).
- Oracle spot checks (`build/trackb-check.ts`, oracle + app + E2 + reference mode on every case):
  - own cases B01–B54 (`build/trackb-cases.ts`): 54/54;
  - every ready case of Track D's corpus (`--stored`, 930): 926 after the whole turn (average, KO, min, max, low, high; E2;
    reference); the 4 others below;
  - Track D's ER cases (`--er`): 73/75 (ER21c not estimated, ER41f Moody E2-only; see Gates below).
- `npm run check`-level: `tsc --noEmit` 0 errors; eslint clean on every Track B file.

### Gates (final runs, 2026-10-08)
- `npm run conformance:training`: every gate PASS. 4b 43397/43397 (100.00%) over 2353/2400 engine cells, read after the
  whole turn where every world applied the end of turn; 4c (report) 1846/2353 engine cells applied (78.45%); 7 effect
  census 0 approximations but Substitute HP; 8 E2 vs Showdown 648/648.
- `npm run leak:training`: every gate PASS; L1 0 differences in every family (sp 194, nature 231, item 248, ability 253,
  moves 289, bench 305, hp 152, dice 70, choice 129); L2 0 hits in 530 messages over 40 battles; saved battles 40/40.
- `npm run eval:training -- --gates`: run `trackb-final` (`--scale 1 --shards 8`). PASS: legality open/closed/perfect 0 errors, 0 engine
  issues, 0 fallbacks (the 336/130/50 engine issues of the first run were the splits.ts sleep/freeze forks meeting carried
  counts, fixed by `SPLITS_BRANCH_SLEEP`); vs RandomLegal 97.0%; vs MaxDamage 63.5%; Reads you vs MaxDamage 70.3%; Reads −
  Plays safe +9.0 pts; self-play 52.0%; closed sheets 98.5%; information cost 0.5 pts; work budget; dropped 0; engine +
  prelude 92.4% of 23305 (was 89.9% in my first run); exploitability 0.01%; determinism 20/20; A1.4; A1.5. FAIL, timing
  only: turn decision p50 358 / p95 803 / max 1295 ms (limit p95 800) and belief update open 8.45 ms (limit 8; closed 23).
  The machine was shared with the other tracks' runs (CPU 50% busy with other node processes after mine ended): preview
  p95 was 85 ms here against 66 / 74 ms in the fixer and integrate gate runs, code Track B does not touch, the same 1.3×
  as belief (8.45 vs 6.35 / 7.79). A CPU profile of real matches (`build/trackb-e2time.ts` under `--cpu-prof`) puts the
  end of turn at 3.3% of all CPU inclusive (7% of E2's 46%); E2 on Training's inputs p50 1.38 ms, p95 2.64 ms per call.
  Worth rerunning the timing rows on a quiet machine at integration.
- Oracle, all of Track D's ready cases (`verify/cases.ts`, 930): 926 agree after the whole turn (app, E2, reference
  mode). The 4 others: S49 (Teeter Dance + Quick Claw tie: after the moves, not Track B), E25b (Draining Kiss into a
  Substitute with Big Root: after the moves, Track E), ER41f (Moody: E2 not estimated by design), ER21c (Psychic Noise then
  the hit's own Sitrus Update: now not estimated, `Sitrus Berry after Psychic Noise is not modelled in 2v2.`; exact needs
  the step, see needs). ER set 73/75, own B01–B54 54/54.
- golden-1v1 `--check`: 254 byte-equal.

## Deviations from the spec
1. `endFacts` returns []: the end of turn's input-level facts depend on the walk (whether the old weather acts), so they come
   from the phase through `kernel.turnFact`.
2. `DoublesResidual` entries are per event; one (slot, effect, other) acting twice on one path happens only with mutual
   Leech Seed, kept as two entries (drain, heal).
3. Starf Berry at an end-of-turn Update in the calculator: eaten with no stage (fact `Raises one random stat by 2.`); E2:
   `Starf Berry is not modelled in 2v2.`
4. Lum Berry cures a status the end of turn gives at once (pinned lumberry onAfterSetStatus), before Bad Dreams; SPEC S04's
   text says "Lum at the final Update". The other curing Berries wait for the final Update (onUpdate only).
5. A trap from before the turn is named "Partial trap" until `DoublesCarried.trap` / `EotState.trap` carry the move (needs).
6. Without `publicOf` the bridge reads the tox stage (and, once `SPLITS_BRANCH_SLEEP` is false, Champions freeze) from the
   belief battle, which is built from the same public counts; sleep (Rest flag) and confusion need `publicOf` and are
   rollouts without it.
7. Leech Seed into an empty seeder position: the bridge omits it (no drain, exact), since validate() rejects an empty-slot
   source.
8. Battle end inside the residual: a world whose side with `canSwitch: false` is wiped stops there (Showdown's checkWin),
   so later handlers do not run in it; SPEC §4.7 does not say this. The kernel does not do the same mid-moves (needs).
9. `SPLITS_BRANCH_SLEEP` (bridge): sleep/freeze are not carried while splits.ts forks them (see Training above).
10. Psychic Noise into an HP Berry holder: when the Berry was held at the turn's start and is gone after the hit, the turn
    is not estimated (`{Berry} after Psychic Noise is not modelled in 2v2.`): the step eats the Berry at the hit's Update
    before Track B's afterHit sets Heal Block, and pinned Showdown runs the secondaries first (ER21c). A Berry eaten
    earlier in the turn also trips it (conservative).

## Open items / needs

### For the integrator (frozen files or files no track owns)
1. `app/(app)/training/sim/services.ts:128`: pass the tracker counts to the bridge:
   `const bridged = bridgeTurn(battle, cell, { runtime, keys: world0.keys, aiSide: ai, switched, publicOf });`
   Failing check today: a confused Pokémon's cell is a rollout ("…: its confusion needs the public counts.").
2. `sim/splits.ts`: drop the sleep and freeze forks (keep Protect) and set `SPLITS_BRANCH_SLEEP = false` in bridge.ts; the
   engine then branches the wake/thaw itself from `carried.sleep`/`carried.freeze` (Rest flag from `countsOf(pub)`). Failing
   check today: a frozen Pokémon's or an Early Bird sleeper's cell is a rollout.
3. `tests/unit/doubles-kernel.test.ts:141-148` (Step 0 stub assertions): `expect(result.endOfTurn.status).toBe("ready")`,
   `expect(result.facts).not.toContain("End-of-turn effects are not applied.")`, `expect(outcomes.endOfTurn).toBe("applied")`.
4. `tests/unit/doubles-turn-mechanics.test.ts:51/92/216`: drop `END_FACT` from the expected facts.
5. Carried trap names: add `move?: string` to `EotState.trap` (doubles-types.ts) and `DoublesCarried.trap`, and copy it in
   doubles-turn.ts `carriedState`; the bridge then passes the Showdown source effect id and the residual reads
   `Trapped by {Move}.` instead of `Partial trap` for a trap from an earlier turn.
6. Kernel: Showdown ends the battle when a side with `canSwitch: false` is wiped during the moves (checkWin after each
   faint); the later actions should not run. The residual already stops (deviation 8).
7. Optional: fold `PublicCounts` / `SubstituteVolatile` (sim/tracker.ts) into `model/public-state.ts`'s PublicMon.
8. Psychic Noise and the hit's Update: in doubles-turn.ts `applyStep` (or the step's target side), when Psychic Noise's
   secondary lands (`secondaryLands`, no Aroma Veil on the target's side, no Mental Herb), the step must not eat the
   target's HP Berry (Sitrus, Oran, Berry Juice, Figy family) at the hit's Update (sim/battle-actions.ts
   hitStepMoveHitLoop: spreadMoveHit's secondaries, then eachEvent('Update'); data/items.ts onTryEatItem TryHeal). Then
   drop the guard in doubles-eot.ts afterHit (deviation 10). Failing case: ER21c (oracle Snorlax 99 / 94.0625 / 89 after
   the turn; the app ate the Sitrus: 157 / 152.0625 / 147); `tests/unit/doubles-eot.test.ts` "Psychic Noise and a Sitrus
   Berry" asserts the guard today.

### For Track A
- `canStatus` under Misty / Electric Terrain should skip a semi-invulnerable (`eot.hidden`) target as the pinned
  onSetStatus does (Yawn landing at the residual on a Pokémon in Dig/Fly is the visible case).

### For Track E
- E25b (Draining Kiss into a Substitute, Big Root): after the moves the app has Alcremie 61 / 66, the oracle 78 / 83 (the
  drain from the damage the Substitute took is missing).

### For Track A / Track D
- S49 (Teeter Dance, Quick Claw, four movers, a tie; the oracle's budget case, `oracle: "modes"`): after the moves the
  averages differ slightly (own-left app 89.809, oracle 90.288); not the end of turn.

### For Track C (texts the phase emits)
- Residual effect names: Sandstorm, Hail, Ice Body, Rain Dish, Dry Skin, Solar Power, Wish, Grassy Terrain, Leftovers,
  Black Sludge, Aqua Ring, Ingrain, Leech Seed, Liquid Ooze, Poison, Bad poison, Poison Heal, Burn, Curse, the trap move's
  name (or Partial trap), Salt Cure, Syrup Bomb, Perish Song, Bad Dreams, Sticky Barb, the Berries, Cheek Pouch.
- Facts: `{Berry} after Psychic Noise is not modelled in 2v2.` (reason), `{Weather} ends.`, `Assumes the {Weather} does not end this turn.`, `Assumes this is {Name}'s first turn of bad
  poison damage.`, `Assumes Dynamax started this turn.`, `Moody raises one stat and lowers another.`, `Cures its {status}.`,
  `Speed −1.`, `Perish count N.`, `Micle Berry: eaten.`, `Switches out after the turn.`, `Assumes {your side|the opponent's
  side} has a Pokémon left to switch in.`; conditions `Leech Seed.`, `Trapped by {Move}.`, `Partially trapped.`, `Salt
  Cure.`, `Aqua Ring.`, `Ingrain.`, `Cursed.`, `Heal Block.`, `Drowsy.`.

### For Track D (oracle)
- Effect-name mapping between the app's residual names and Showdown's `[from]` effects (Sandstorm/Hail, Poison ↔ psn,
  Bad poison ↔ tox, Burn ↔ brn, the trap move ↔ partiallytrapped, Healer/Hydration/Shed Skin facts, Berries); mutual Leech
  Seed is two entries (drain, heal) on one path where the oracle sums per path; Healer's entry is on the ally with
  `other` = the holder.
- ER cases: 73/75 agree after the whole turn now; ER21c is not estimated (the step, integrator need 8) and ER41f (Moody)
  is E2-only not estimated by design (the calculator states the fact).
