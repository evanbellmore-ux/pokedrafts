# Wave 1a, Track T1: Training (SPEC2 §6, ADDENDUM2 §6's T1 rows)

Branch `calc-2v2-status-2`. Files (T1's only): `app/(app)/training/sim/{tracker,belief-battle,effects,bridge}.ts`,
`app/(app)/training/ai/{evaluate,value}.ts`, `app/(app)/training/model/ai-view.ts`, `tests/unit/training-status2-t1.test.ts`
(new), `tests/unit/training-bridge.test.ts`, `tests/unit/training-ai-evaluate.test.ts`. Scratch probes:
`status2/build/t1-probe-champions.ts`, `t1-probe-items.ts`, `t1-explore.ts`, `t1-debug.ts`, `t1-copy.ts`. Nothing committed; no
frozen file touched; no other track's file touched.

## What the bridge now passes (every source a public line, the tracker's counts, or the belief battle's replay of them)

| Input | Source | Where |
|---|---|---|
| `carried.stockpile` {layers, def, spd} | tracker `StockpileVolatile` counts: −1 per layer whose `-boost`/`-unboost` line changed the stat (0: none; Contrary counts: C17), carried to the next layer; effects.ts builds the belief battle's effectState with them | tracker, effects, bridge |
| `carried.powerTrick` / `powerShift` | the volatile; the input build's stored Atk/Def **unswapped** (doubles-turn.ts carriedState swaps it back). A swap a form change undid with the volatile up (Stance Change, Mega) or redone after: rollout `{Name}: Power Trick across a form change is not modelled.` (tracker `stored` toggles since the last form change) | bridge |
| `carried.noRetreat`, `minimize`, `gastroAcid`, `trapped`, `glaiveRush` | the volatiles (Minimize has no `-start` line: the tracker adds it at the move line). Gastro Acid on a cantsuppress belief ability: rollout | tracker, bridge |
| `carried.healBlock` | the volatile's duration (effects.ts: Psychic Noise 2, Heal Block 5, minus the countdowns since), 1–4 | bridge |
| `carried.attract` | its source's slot (in battle; else a rollout) | bridge |
| `carried.octolock` | its user's slot (tracker now records Octolock's `[of]`; effects.ts gives the belief battle's volatile that source); a user gone or with no active turn: nothing (it ends at order 14 with no drop); an ally user: rollout | tracker, effects, bridge |
| `carried.berryLocked` | Champions' checkedBerserk / checkedAngerShell false, rebuilt by belief-battle.ts `abilityStateOf` from the tracker's `berserk` mark: a confusion self-hit, or the last single hit with secondaries from a belief-world Sheer Force user (a multi-hit hit, other damage, a switch reset it); a move that reached it without damage since: `unknown` → rollout `{Name}: whether {Berry} is locked by {Ability} is not known.` | tracker, belief, bridge |
| `carried.berryWeaken` | Ripen's berryWeaken: a resist Berry `[eat]` line with no `[weaken]` line after it (Teatime, a flung Berry, a stolen one by its eater), until the next damage calculation into it | tracker, belief, bridge |
| `carried.copy` | Opportunist's abilityState.boosts: foes' rises after `\|upkeep\|` (the final Update), cleared at a switch-in, a Mega Evolution, a move (CR-style probe `t1-copy.ts`: a Liechi Berry eaten after the residual, copied after the next turn's first move) | tracker, belief, bridge |
| `lastItem` | every Pokémon: pinned `pokemon.lastItem` (tracker `lastItem`: `[eat]`, useItem's line, `[from] gem`, Fling; not a popped Air Balloon nor a stolen Berry; kept across switches; Recycle and Harvest clear it; Pickup clears its target's, unknown between two candidates of one item → absent); null for none | tracker, belief, bridge |
| build `types`, `addedType` | Showdown's `pokemon.types` / `addedType` where they are not the species' (Mimicry's terrain type left to the engine; another type on Mimicry: rollout). The tracker now ends `typechange`/`typeadd` at a form change and an added type at any type change (setType), and Reflect Type copies its target's (types the target's as they stand, `sourceKey`) | tracker, belief, bridge |
| build `storedStats` | Showdown's stored stats where not the form's own: the belief battle replays the stint's Power Split, Guard Split, Speed Swap, Power Trick toggles and Transform in log order (tracker `stored`, each partner's own chain at that moment) | tracker, belief, bridge |
| build `weighthg`, `abilityChanged`, `transformedFrom` | Showdown's weight; an ability not its species' (Skill Swap, Role Play, Entrainment...); a transformed Pokémon as its target's species with its own HP and spread (the belief battle untransforms its own lead Imposter first, then transforms into the public target; the stages and crit volatiles are the tracker's, which now copies them at `-transform`) | belief, bridge |
| a used Protean / Libero | abilityActive false with its public type; the belief battle's flag only from its own `[from] ability: Protean` change (tracker `typeChanger`), not a Soak on it | tracker, belief, bridge |

A build carrying any of these that `validateBuild` refuses is a rollout with the old text (`{Name} is transformed.`, `{Name}:
{ability} was used this stint.`, `{Name}: its ability was changed ({id}).`) or `{Name}: {issue}`, never an engine issue.

Rollouts that went: `{Name}: {ability} was used this stint.` (while the engine accepts the build), `{Name}: its ability was
changed ({id}).`, `{Name} is transformed.`, `{Name}: Ingrain on a Pokémon that is not grounded otherwise is not modelled.`, and
`{Name}: {id} is not modelled.` for stockpile, powertrick, powershift, noretreat, minimize, gastroacid, attract, octolock,
healblock, glaiverush, trapped. Kept: Illusion, twoturnmove, a Substitute after a hit, the bridge's other reasons.

## Belief-battle fixes the fuzz found (all public-line state the bridge now reads)

`status2/build/t1-fuzz.ts` plays random legal Champions battles between four teams built on these states and, at every p2 turn
decision, compares the belief battle (truth world) with the real battle field by field (species, transformed, ability, stored
stats, types, added type, stages, lastItem, weight, the mapped volatiles with Heal Block's duration, Stockpile's counts and
Attract / Octolock's sources, checkedBerserk, berryWeaken, Opportunist's boosts, Protean's flag), runs the bridge (no engine
issue may come back) and, with no hidden counter in play, plays both on one seed. Found and fixed:

- Transform: the belief battle's own lead Imposter transformed into the wrong Pokémon at construction (now untransformed first);
  a target that fainted since refused transformInto (now up for the call); the copied ability was the target's current one (now
  the one it had then: the AI's request, or the tracker's snapshot); the copied moves' PP were 5 (now the request's or 5 less the
  uses); its types were the target's current ones (now its public change copied at `-transform`, else the target's form then);
  its stages and crit volatiles were the target's current ones (the tracker now copies them at `-transform`); its fresh ability
  state lost Protean's flag (rebuilt after the copy).
- Octolock's silent end once its user left (`-end|X|Octolock|[partiallytrapped]|[silent]`) removed a partial trap instead.
- Teatime's heal names its user (`[of]`): the tracker gave the user the eaten Berry; a Berry's effect right after it was eaten
  (Teatime, Bug Bite / Pluck, Fling) now names no holder.
- Reflect Type copies its target's form's types at the time (the target may leave or change later): recorded as `speciesId`.
- Gastro Acid: the suppressed ability's state is not written (Ripen, Berserk, Opportunist).

Final fuzz runs (this tree): 150 battles (seed 7) 2784 decisions, 10515 Pokémon compared, 0 mismatches, 2694/2694 clean one-turn
logs equal, 2034 engine cells, 0 engine issues; 200 battles (seed 101) 3583 decisions, 13557 compared, 0 mismatches, 3492/3492
logs equal, 2806 engine cells, 0 issues. Rollout reasons seen: `protean was used this stint` (the engine still refuses the
build: needsFromIntegrator), `whether Sitrus Berry is locked by Berserk is not known.`

## evaluate.ts, value.ts

- `foreignAbility` skips `abilityChanged` builds.
- `nextClock`: `sides.clock` (Court Change: the other side's pre-turn clock; "set": a fresh one), `hazardsFrom` naming the
  other side (its pre-turn hazards), `fieldSet` (a room or Gravity set during the turn: fresh). Safeguard goes through the same
  count (Step 1's results unchanged).
- `postFromOutcome`: `benchCured` cures the side's living bench members' status; `PostMon.carried` holds stockpile, stages,
  pendingCopy, lastItem, berryLocked, berryWeaken, turnsLeft (no value term reads them: Q7).
- value.ts `speedOf`'s cache key gains the stored Speed (turnSpeed reads storedStats).

## Tests

`tests/unit/training-status2-t1.test.ts` (23): real Champions seat battles on pinned Showdown, each belief battle (truth world)
checked against the real battle (stockpile effectState, stored stats after Power Trick + Power Split + Speed Swap, the volatiles,
types and added type, Reflect Type, Protean, Skill Swap, Transform, lastItem of four Pokémon, checkedBerserk with and without
Sheer Force, berryWeaken, Opportunist's pending boosts) and the bridge's input; tracker-only line tests for the marks; nextClock,
postFromOutcome and the Speed cache. `training-bridge.test.ts`: Ingrain on a Flying type now goes to the engine.
`training-ai-evaluate.test.ts`: its "unmodelled status move" is Revival Blessing (Worry Seed is A1's now).

- The AI's read text (`ai/engine-provider.ts readNames`) names a transformed Pokémon by its own species (the log's name), not
  its target's: with the belief battle's Ditto now transformed, the L2 Illusion/Transform slice had 5 hits ("Garchomp
  protected, not in the log") until this.
- `scripts/training/leak.ts`: the Illusion and Transform slice plays 16 battles by default (was 8). Its "look-alikes shown"
  condition needs the AI's Ditto replaced while Zoroark's Illusion stands; with transformed Pokémon valued by the engine the AI
  keeps Ditto in longer and battles 0–7 no longer reach one (0 hits either way: 8 battles 0 hits / 0 look-alikes; 16 battles 0
  hits / 8 look-alikes; 24 battles 0 hits / 10 look-alikes).

## Gates (this tree, other tracks' work in progress included)

- `vitest` `tests/unit/training-*`: 56 files, 651 tests pass. tsc: no error in T1's files (others' files: calculate.ts (F),
  doubles-field-side-items.test.ts (A3) at the time). eslint clean on T1's files.
- `conformance:training` (`--run t1-conformance-SVA`, defaults): every row PASS (tracker parity 854/854; belief 279/279;
  requests 100%/100%; one-turn logs 263/263; default settings 300/300; bridge 0 mismatches over 400; clean rollouts inside the E2
  support 56237/56237 over 2909/3000 engine cells; splits 33.7/35.0/25.1 %; choice strings 24918/24921 + 3 hidden-trap; census
  0; saved battles 30/30, Resume 30/30, Illusion/Transform 6/6; runner errors 0) **except row 8** (E2 vs Showdown, the generated
  `doubles-turn-showdown.test.ts`): 8 of 1458 failing at that moment, then 1 — the stored guard cases the engine tracks are
  making estimated (S48-SkillSwap-last, -Soak-last, -Attract-last, -Transform-last, ER41b/c, RT-RV21/22...), V1's to re-run; no
  Training code in it.
- `leak:training` (final code, defaults): every row PASS. L1 every field 0 differences (sp 190, nature 230, item 248, ability
  246, moves 291, bench 310, hp 147, dice 68, dice-eot 73, choice 129; the settings work 161/201, 65/129); L2 0 hits in 531
  messages over 40 battles; saved battles 40 replays equal, 10 resumed, 236 checkpoints sealed; Illusion and Transform 0 hits in
  204 messages over 16 battles, 7 Illusions ended, 16 with a Transform, 8 look-alike decisions, 16/16 replays equal.
- `eval:training --gates --scale 1 --shards 8` on the Step 1 seeds (`--run s1-step1`; results kept as
  `scripts/.cache/training/eval/t1-w1a-s1seeds`, Step 1's `s1-step1` restored), against main (4008ee8, the scratch `headtree`,
  same seeds): 20 PASS, 2 FAIL, the same two as main and Step 1: HabitBot ≥ +5 (this tree 2.8 pts [-1.4, 6.9], main 4.0, Step 1
  3.0) and A1.4 (Rage Powder usable 3 turns, never chosen: main the same). Legality 0 errors, 0 engine issues, 0 fallbacks
  (open n=2600, closed 200, perfect 400); vs RandomLegal 99.0 %; vs MaxDamage 63.2 % (main 64.3 %); Reads vs MaxDamage 72.3 %
  (72.0 %); self-play 49.5 % (51.0 %); closed 99.0 %; open vs perfect −4.0 pts (−3.3); decision time p50 290 p95 599 max 1929 ms
  (main 274 / 577 / 1181; the machine was shared with the other tracks' runs); preview / replacement 66 / 8.71 ms; belief 18 /
  6.66 ms; budget 240 / 160 / 4; dropped 0; **engine + prelude cells on pool S 96.9 % (main 88.5 %)**, 94.6–97.1 % in every run
  (main 88.5–95.5 %); exploitability 0.01 %; determinism 20/20; A1.5 rows pass.

## Needs

- **Integrator (model.ts, frozen):** `validateBuild` line 410 refuses every used Protean / Libero (`Only unused Protean/Libero
  with unchanged typing is supported.`), so the bridge keeps that cell a rollout (`{Name}: protean was used this stint.`: 719
  cells in the 150-battle fuzz). One line: `if (["protean", "libero"].includes(build.abilityId) && !build.abilityActive &&
  build.types === undefined) {` (no 1v1 build sets `types`; N's `proteanUsed` already takes a used holder with its types).
  Failing test (`tests/unit/training-status2-t1.test.ts`'s Protean case then takes its engine branch on its own):
  `expect(validateBuild({ ...createBuild("greninja", championsRuntime), abilityId: "protean", abilityActive: false, types:
  ["Ice"] }).filter((issue) => issue.field === "abilityActive")).toEqual([]);`
- **A1, A2, D, E1 (their handlers, at integration 1a):** Training now passes, from public lines, `carried.stockpile` (with
  counts), `powerTrick` (the build's stored Atk/Def unswapped: carriedState re-swaps), `noRetreat`, `minimize`, `gastroAcid`,
  `trapped`, `glaiveRush`, `healBlock` (turns), `attract`, `octolock`, `berryLocked`, `berryWeaken`, `copy`, `lastItem` (every
  Pokémon, null for none), and builds with `types`, `addedType`, `storedStats`, `weighthg`, `abilityChanged`, `transformedFrom`.
  While a hook is a Step 0 stub the engine reads some of them only in part (Attract's BeforeMove: A2 `beforeAttract`; Glaive
  Rush's end at its holder's BeforeMove: D `beforeFirst`; Heal Block's stand-ins: A2; Octolock's residual 14 drop: E1; the copy
  at the first AfterMove: D), which conformance's containment (100 %) did not catch on its sample; their exact models land
  with those tracks. A transformed input build (transformedFrom, its target's species, stored stats, ability and moves) is the
  Pokémon as it stands at the turn's start: A1 should take it as already transformed.
