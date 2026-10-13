# Wave 2, Track R-T: Training's bench, replacements, hazards and prelude (SPEC2 §6 R, ADDENDUM2 §6 R-T)

Branch `calc-2v2-status-2`, checked before the work and before this report. Only this track's files were edited:
`app/(app)/training/**`, `scripts/training/*` (with `scripts/training/lib/match.ts`), `tests/unit/training-*`. Nothing was
committed, pushed or switched; `.claude/`, `node_modules`, CastMirror and RaidCard files untouched; no `next build`, nothing
against live Supabase, no browser.

Scratch: `status2/build/w2-rt/` (`pre/`: the snapshot of this track's files before the work; `w2-rt.diff`: the whole change
against it; `rt-fuzz.ts`; `frozen-gates.sh`, `sync-frozen.sh`; `logs/`).

## The frozen tree (how the gates ran while R-E works)

R-E is editing `doubles-turn.ts` and `doubles-world.ts` in the shared tree (at 16:28 `doubles-turn.ts` called
`switchHooks.exitWorlds`, which `doubles-switch.ts` does not export yet: every engine call threw, and tsc failed in
`app/lib/battle`). The Training gates need a working engine, so they ran on a **frozen tree** in the session scratchpad: a copy
of the working tree (node_modules by junction) whose `doubles-turn.ts` and `doubles-world.ts` are Step 2's final versions,
rebuilt from `step2/pre` + `step2/step2.diff` (`patch -p0`, both hunks sets applied cleanly; they are the only engine files
changed since STEP2.md). There the R stubs keep today's rule, so the engine's numbers are integration 1b's and every movement is
this track's. `sync-frozen.sh` copies this track's files in. At integration 2 the same gates must run on the real tree with R-E's
engine (below: what to expect).

## What Training passes now

| Input / change | Source (public, or the AI's own) | Where |
|---|---|---|
| `bench.own`, `bench.opponent` | each side's living non-active party in party order (`side.pokemon`, the order a switch request lists it), id = the Pokémon's MonKey (`own:<member>`, `opponent:<member>`). The AI's exactly (its request); the player's from the belief world (believed sets; HP and status public). Build = `liveBuild` (a used Protean / Libero is unused again: Showdown's switch-in gives it a fresh ability state, while the benched Pokémon's old state still holds the flag); `carried.sleep` / `freeze` (the public counts, which last through a switch) and `onceUsed`; `moves` = its move slots (Assist's party; Champions has no Assist). A bench Pokémon the engine would refuse is the rollout `{Name} on the bench: {message}` (none in any run) | `sim/bridge.ts benchOf` (cached per battle: `benchesOf`) |
| `replacement` | for each present slot of a side with a bench: the player's healthiest bench Pokémon by HP share, the first in party order among equals (the rollouts' rule, Q9: `healthiestOf`); the AI's own pick by its ReplacePolicy (`ai/switches.ts replacePolicy`, as its rollouts apply it), passed from the evaluator through `services.engineWorlds(cell, replace)`; without a policy (direct callers, conformance, leak's hash) none for the AI's side (the engine's default) | `bridge.ts`, `services.ts`, `evaluate.ts worldsOf` |
| `hazards` | the side conditions with their layers (Stealth Rock, Spikes 1–3, Toxic Spikes 1–2, Sticky Web); IGNORED_SIDE became HAZARD_SIDE (mapped). Champions has no G-Max Steelsurge | `bridge.ts hazardsOf` |
| the prelude's replacement | a switch request before the first move (Emergency Exit after entry hazards; Eject Button / Pack after an entry) is answered as the rollouts answer one (`sim/rollout.ts replacementChoice`, now exported: the AI's ReplacePolicy, its first bench Pokémon without one; the player's healthiest) and the copy runs on to its first move. `A replacement is needed before the moves.` no longer reaches a cell (it stays only for a direct `runPreludeWorlds` call with no answer) | `sim/prelude.ts`, `services.ts` |
| a benched landing source | `futureMove: { move, build }` as before: the build is `liveBuild` of the benched user, which equals its bench entry's build (HP not read); test below | `bridge.ts carriedOf` |
| `inputKey` | adds `bench`, `replacement`, `hazards` (a prelude switch changes the bench; the AI's pick follows it) | `ai/evaluate.ts` |
| `postFromOutcome` | a slot's occupant at the end is `mons[slot].id` (a MonKey) where given: its own maximum, no residual pass of its own (it was not in battle); each `benched[side]` entry (id `slot:{slot}` → the slot's starting Pokémon) goes back on the bench with its HP and build as it left, its sleep counter and carried state; nobody twice | `ai/evaluate.ts` |
| `TurnServices.engineWorlds(cell, replace?)` | one memo per policy (a WeakMap) and one without; the policy's picks memoised per (side, slots, options) | `model/ai-view.ts`, `services.ts` |
| Chilly Reception's volatile | a prelude copy holds `chillyreception` from the turn's start (its priorityChargeCallback; the condition only prints `-prepare`): ignored, not `{Name}: chillyreception is not modelled.` (found by the fuzz, 24 cells) | `bridge.ts IGNORED_VOLATILES` |

## INTEGRATION-1B's open item 3: the belief battle's lastMoveTargetLoc

The AI's seat now knows its own choices: `PublicTracker.chose(choice)` records, for each of the viewer's actives, the target
loc its move was chosen at (`move N T`); its own next move line this turn (no `[from]`, not an instructed one) sets
`lastMoveTarget` to that loc and clears `lastTargetUnknown` (pinned `runMove → moveUsed(move, targetLoc)`: the action's loc,
whatever the line names). This fixes the three fuzz logs: a Future Sight line with no target (`|move|…|Future Sight||[still]`,
`attrLastMove` blanks it) and a retarget after the chosen target fainted. It also makes the AI's own Pokémon exact after a Follow
Me / Rage Powder, a Lightning Rod or Storm Drain redirection, an Ally Switch or an Encore begun that turn (the bridge then passes
`lastMoveTarget` for them; the player's Pokémon keep `lastTargetUnknown`). Two more tracker rules from pinned Showdown: an
instructed move (`-singleturn|X|move: Instruct`) keeps its user's last target (Instruct queues it at `lastMoveTargetLoc`), and a
`cant` drops the pending choice. Wired in the worker (`send`, and Resume's replayed steps), `scripts/training/lib/match.ts`
(each seat's own accepted choices) and the test fixture (`seatBattle.step`). The viewer's own choices are its own knowledge,
never the other side's.

**Court Change (found by the R-T fuzz, a tracker bug from before):** the tracker ignored `|-swapsideconditions|`, so after a
Court Change the belief battle held each side's conditions on the other side (hazards, screens, Tailwind, Safeguard, Mist, Lucky
Chant). Now the listed conditions (pinned courtchange onHitField's list) swap with their own state (layers, start, setter); the
slot conditions stay.

## Tests

`tests/unit/training-status2-r.test.ts` (new, 24 tests): the tracker's chosen targets (a `[still]` Future Sight, a retarget,
Lightning Rod and Follow Me, an instructed move before and after its own action, a `cant`, a switch); two real battles where the
belief battle's `lastMoveTargetLoc` equals Showdown's; the bench (party order, ids, builds, moves, `canSwitch` kept), the
player's bench from the belief world's sets (not the real battle's), the replacements (healthiest, ties, the AI's policy pick, none
without, one memo per policy), `healthiestOf`, the hazards with layers and orientation, `benchOf`'s sleep / onceUsed and its
rollout reason, a Future Sight landing from a benched user, `inputKey`, the bench build = liveBuild and an unused-again Libero,
Court Change in the tracker (the belief battle's side conditions = the real battle's), the prelude answering Emergency Exit (the
AI's pick, the player's healthiest) and the services' prelude cell, `postFromOutcome` with a newcomer and a leaver (and the
residual pass only for those who stayed), a direct `bridgeTurn` call, and Chilly Reception's prelude volatile. Four tests also
call `calculateDoublesOutcomes` on the bridged inputs (no issue): they pass on the frozen tree and fail on the shared tree only
while R-E's engine throws.
`tests/unit/training-sim-fixtures.ts`: `seatBattle.step` tells the AI seat's tracker its own choice.

`status2/build/w2-rt/rt-fuzz.ts` (scratch): random legal battles between four teams built on the switch family (U-turn, Volt
Switch, Flip Turn, Parting Shot, Baton Pass, Shed Tail, Chilly Reception, Eject Button, Red Card, Emergency Exit, Roar,
Whirlwind, Dragon Tail, Circle Throw), hazards and their removers (Stealth Rock, Spikes, Toxic Spikes, Sticky Web; Defog, Rapid
Spin, Mortal Spin, Court Change, Tidy Up), Future Sight and Instruct. At each AI decision: the belief battle against the real one
(HP, status, and the AI's own `lastMoveTargetLoc` after a move chosen at a target), the bridge's bench (species, HP, status in
party order) and hazards against the real battle's, the player's replacement against the healthiest, one-turn logs, and six cells
through the services to the engine (no issue, no throw; every outcome id on a bench).

The gates of the session above ran on the frozen tree (its logs: `w2-rt/logs/`); the gates on the real tree, with R-E's engine,
are in "Finish (cloud session)" below.

## For integration 2 (what to expect once R-E's engine lands)

- Cells with a switch-out stop being `{Name} switches out: the replacement is not known.` (the fuzz's largest reason: 1781–1896
  engine cells and 1039–1178 ends of turn per 60 battles on the frozen tree) wherever R-E models the newcomer.
- `conformance:training` 4b now follows the replacements: `preResidualHP` answers a mid-turn switch request (and, for a read after
  the turn, one after the residual for a living Pokémon: Emergency Exit) as the engine input names the replacement (the
  player's healthiest; the AI's first bench Pokémon, since conformance's services pass no policy), reads every Pokémon's HP by its
  engine key, and compares each key the engine gives a range: the starting Pokémon, the newcomers (`mons[slot].id`) and the
  leavers (`benched`). A voluntary switch still leaves a sample out; so does a side that replaces twice in one turn (one pick per
  slot in the input). Without this, a U-turn cell that R-E makes ready would have been compared at the switch request (the turn
  stopped there). The new report key `turn.replacement` counts clean samples with an answered switch or a drag.
- The four engine-calling assertions in `training-status2-r.test.ts` and every Training test that calls the engine pass again
  once the engine stops throwing.

## Finish (cloud session)

Cloud session of 2026-10-11 (Linux, 4 shared CPUs), branch `calc-2v2-status-2` checked before the work and before this report.
Only this track's files were edited: `app/(app)/training/ai/evaluate.ts`, `app/(app)/training/sim/services.ts`,
`app/(app)/training/sim/bridge.ts`, `scripts/training/conformance.ts`, `tests/unit/training-status2-r.test.ts`; and this
track's scratch (`w2-rt/rt-fuzz.ts`, this file). Nothing committed, pushed or switched; no engine file touched (R-E edited `doubles-switch.ts`, `doubles-turn.ts`,
`doubles-eot.ts`, `doubles-calling.ts`, `doubles-presence.ts` during the session); no `next build`, nothing against Supabase.
Scratch logs: the session scratchpad's `rt/` (not kept).

### Re-verified on the real tree (R-E's engine; the frozen tree is gone)

Every claim above holds with R-E's engine: the 24 tests of `training-status2-r.test.ts` (the four engine-calling ones included)
and the worker test pass unchanged. Item by item (SPEC2 §6 R, ADDENDUM2 §6 R-T, STEP2's R-T list):

| Item | Code | Test | Fuzz (60 battles × 3 seeds) |
|---|---|---|---|
| the real bench: the AI's own exactly, the player's from the belief world (believed sets; HP and status public), party order, MonKey ids, `liveBuild`, sleep / freeze / onceUsed, `moves` | `bridge.ts benchOf` / `benchesOf` | bench, belief-world bench, sleeper, Libero | bench = the real battle's in party order with HP and status: 2210 / 2372 / 2384 checks, 0 differences |
| the replacement: the player's healthiest bench Pokémon (Q9, the rollouts' rule), the AI's own ReplacePolicy pick (none without one) | `bridge.ts` (bridgeTurn), `services.ts`, `evaluate.ts` | replacements, `healthiestOf`, direct `bridgeTurn` | 0 differences from the healthiest; with a policy for the AI's side: 7615 / 8101 / 8405 engine worlds, 0 issues |
| hazards with layers, engine orientation | `bridge.ts hazardsOf` | hazards | 2210 / 2372 / 2384 checks, 0 differences (Court Change included) |
| the prelude's replacement (`A replacement is needed before the moves.` goes) | `prelude.ts`, `services.ts` | Emergency Exit (AI's pick, player's healthiest), services' prelude cell, **new:** Eject Pack | the reason does not occur (2523 / 2529 / 2672 prelude cells) |
| a benched landing source | `bridge.ts carriedOf` (`futureMove: { move, build }`) | landing from a benched user | — |
| Assist's party | bench `moves` | bench test | (Champions has no Assist) |
| Beat Up's party (R-E reads it from the bench) | **new:** no listed party in the turn's input (`bridge.ts`) | **new:** Beat Up | (no Beat Up user in the fuzz's teams) |
| INTEGRATION-1B open item 3 (lastMoveTargetLoc after a `[still]` Future Sight and after a retarget) | `tracker.ts chose`, worker, `match.ts` | tracker and real-battle tests, worker test | T2 fuzz: one-turn logs 794/794 equal (1b: 791/794) |
| `postFromOutcome` with newcomers and leavers | `evaluate.ts` | **new:** start ids | **new:** 10176 outcomes through `postFromOutcome` (seed 101), every Pokémon once under a belief-world key |

### Three fixes (each with a regression test)

1. **A replacement made in the prelude acted with its predecessor's move.** An Eject Pack set off before the moves (a switch-in's
   Intimidate; STEP2: "an entry Intimidate setting off Eject Pack is the same replacement") is answered in the prelude, but the
   newcomer took the cell's action of the Pokémon it replaced (Garchomp used Snorlax's chosen Protect) and was not
   `switchedIn`. Pinned `switchIn` cancels the leaver's queued action (sim/battle-actions.ts, `queue.cancelAction(oldActive)`);
   the newcomer has none. Now `services.ts` adds to `switched` every slot whose Pokémon in the prelude copy is not world 0's
   (`cameIn`): no action, `switchedIn: true`. Test: `a Pokémon that leaves before the moves by Eject Pack…` (every prelude world;
   the real battle shows the Eject Pack, Garchomp in, and no move of Garchomp's that turn). The fuzz's teams hold no Eject Pack:
   0 prelude newcomers there.
2. **An outcome id can be the other slot's start id.** R-E's engine brings a Pokémon that left back in when the input bench is
   used up (its default pick, `switchRound`: the input bench first, then the leavers): `mons["own-right"].id = "slot:own-left"`.
   `postFromOutcome` took every id for a MonKey (a post-turn Pokémon keyed `slot:own-left`, the real one left at its old place),
   and conformance 4b dropped those samples (no HP by that key). Now `engineIdKey(id, world)` (exported from `evaluate.ts`) maps a
   start id to the world's key of that slot, a bench id to itself; `postFromOutcome` (occupants and `benched`, the maximum from
   `start` of the slot it started in) and conformance 4b use it. Tests: a synthetic outcome (Incineroar back in at own-right),
   and the engine's own outcomes for Corviknight's U-turn then Garchomp's Eject Button with one bench Pokémon (Corviknight back
   at own-right, as in the real battle answered by the rollouts' rule). The fuzz found it: R-T's `rt-fuzz.ts` check "outcome id
   not on a bench" gave 115 notes on seed 101, every one a start id of the same side's other slot (115 / 129 / 113 per seed).
3. **Beat Up's party was the list from the turn's start.** The bridge passed `contexts.beatup.party` (the side's Pokémon not
   fainted and with no status as the turn starts), which takes precedence over R-E's party from the bench
   (`doubles-presence.ts beatUpContext`: `contexts.beatup?.party ?? benchParty`). After a mid-turn switch the list is stale: a
   partner burned by Will-O-Wisp that then U-turns out still hit (pinned beatup onModifyMove: no fainted or statused ally,
   at the use). The bridge now leaves `contexts.beatup` out of the turn's input (the bench is always passed); `startInput` (the
   damage rows, no bench) keeps it. Test: `Beat Up's party comes from the bench…`: with no switch before it the outcomes are
   byte-equal to the listed party's; after Will-O-Wisp, U-turn and Garchomp in, the engine's Snorlax range holds the real
   battle's HP (3 hits, `|-hitcount|p2b: Snorlax|3`), which the listed party's range (4 hits) does not. Champions has Beat Up
   (Farigiraf, Maushold, Whimsicott, Kangaskhan...), not Assist or Pursuit.

`w2-rt/rt-fuzz.ts` now accepts start ids (`seen.startIdBack`), runs each cell again with a ReplacePolicy for the AI's side, runs
every ready outcome through `postFromOutcome`, and counts the prelude newcomers and the outcomes where a side switched out twice.

### Gates (real tree)

- `npx vitest run --config vitest.unit.config.ts tests/unit/training-`: before the fixes ` Test Files  59 passed (59)` /
  `      Tests  703 passed (703)`; after: ` Test Files  59 passed (59)` / `      Tests  706 passed (706)` (1m45s).
  After the Beat Up fix: ` Test Files  59 passed (59)` / `      Tests  707 passed (707)` (2m15s); `training-status2-r.test.ts`
  28 tests (24 + 4), `training-status2-r-worker.test.ts` 1.
- `npx tsc --noEmit`: exit 0, no output. `npx eslint "app/(app)/training" scripts/training tests/unit/training-*.ts`: exit 0.
- **T2 fuzz** `t2-fuzz.ts 60 101` (1m25s): `"mismatches": 188`, `"logsClean": 794`, `"logsSame": 794`, `"issues": 0`,
  `"notEstimated": 25` (INTEGRATION-1B: 191 = 188 PP + 3 Instruct logs). `t2-fuzz-all.ts 60 101` prints all 188: every one a
  ` pp: ` line (T2's known PP counting, W1B-T2.md); the 3 Instruct logs are gone, no new class. Its reasons are the frozen run's
  (Instruct needs the target of a Pokémon's last move: 17 cells, every one the player's Pokémon, checked by side: its chosen
  target is not public; terrains ending: 29 ends of turn; Encore 4).
- **R-T fuzz** `w2-rt/rt-fuzz.ts 60 {101, 7, 23}` (about 2 min each):

  | | seed 101 | seed 7 | seed 23 |
  |---|---|---|---|
  | decisions / cells / engine cells | 1108 / 6648 / 6520 | 1187 / 7122 / 7008 | 1192 / 7152 / 7029 |
  | mismatches, engine issues (also with an AI policy) | 0, 0 | 0, 0 | 0, 0 |
  | one-turn logs equal | 941/941 | 1003/1003 | 1023/1023 |
  | engine worlds ready | 7609 | 8099 | 8381 |
  | outcomes with a replacement (`benched`) | 2797 | 2818 | 2917 |
  | not estimated | 6 (`Red Card with Life Orb is not modelled in 2v2.`) | 2 (`Instruct needs the target of Farigiraf's last move.`: the player's) | 24 (`Red Card with Life Orb…`) |
  | rollouts | 113 Speed tie between switches with an entry effect; 15 Substitute HP | 109; 5 | 123 |

  `Red Card with Life Orb is not modelled in 2v2.` is R-E's guard, added during this session (seeds 101 and 7 gave 0 before
  it; a rerun of seed 7 after it: 17 such cells, and the 2 Instruct cells are the player's Farigiraf, checked by side).
- **`{Name} switches out: the replacement is not known.`**: 0 engine cells and 0 ends of turn in all three seeds (frozen tree:
  1781 / 1896 engine cells, 1039 / 1102 ends of turn per 60 battles). Why none is left: the bridge always passes both sides'
  `bench` (an empty list when nobody is left), so every switch-out goes to R-E's `replaceSlot` (`switchOut`: `REASONS.switchesOut`
  only without a bench, as the calculator without a Bench), and the end of turn's Eject Pack / Emergency Exit are followed too.
- **conformance smoke** `npx --no-install tsx scripts/training/conformance.ts --battles 1 --eot 1 --saved 0 --saved-illusion 0
  --skipE2 --run rt-smoke` (1m14s): every row PASS; `4b. … 1765/1765 (100.00%) over 120/120 engine cells`, `turn.replacement 284`.
  A larger one, `--battles 8 --eot 2 --saved 2 --saved-illusion 1 --skipE2 --run rt-mid` (3m50s): every row PASS; `1. Tracker
  parity 186/186`, `2c 56/56` (switch requests 10/10, logs 10/10), `4a 0 over 80`, `4b. … 11582/11582 (100.00%) over 597/600
  engine cells`, `turn.replacement 548`, `6. 5553/5558; unavailable (hidden trap shown) 5`, `7. 0`, `9a 2/2`, `9b 2/2`,
  `9c 1/1`, runner errors 0. (Reports in `scripts/.cache/training/conformance/rt-smoke.*`, `rt-mid.*`.) The smoke and the first
  `rt-mid` ran after fixes 1 and 2; `rt-mid` again after fix 3 (3m53s): every row the same (largest record 22 KB against 23),
  and `rt-fuzz.ts 60 101` again: the same counts as above.

### For integration 2 (commands, runtimes on 4 shared CPUs)

- `npm run conformance:training` (defaults: `--battles 40 --eot 10 --containment 2 --saved 30 --saved-illusion 6`, run name
  `conformance-SVA`, check 8 spawns vitest on `doubles-outcomes` + `doubles-turn-showdown`): about 20–30 min here (the 8+2 battle
  run with 3 saved battles took 3m50s; integration 1b's took 8m28s on the Windows machine). Expect 4b near 100 % with
  `turn.replacement` in the thousands; a side that switches out twice in one turn is left out of 4b (below).
- `npm run leak:training` (defaults `--battles 40` (dice 60) `--l2 40 --l2-illusion 16 --seat safe`): not run; 21 min in 1b and
  31.5 min on R-T's frozen tree (Windows); expect 30–45 min here. Its L1 diff stringifies `services.engineWorlds(cell)`, so the
  bench, the replacements and the hazards are in it.
- `npm run eval:training -- --gates --scale 1 --shards 8 --run s1-step1`: not run; 13m51s in 1b on Windows; with 8 shards on 4
  CPUs expect 30–45 min. Keep `--shards 8`: each shard carries the seats' habits from one battle to the next, so the shard count
  changes the battles (main's numbers are 8 shards). R-T's frozen-tree attempt died on Windows (`shard 0 exited 3221225794`,
  0xC0000142, a child process that could not start under load), not a gate result. Its decision-time p95 is the open item 1 of 1b.

### Open

1. **A side that switches out twice in one turn** (two Pokémon of one side, or a newcomer leaving again, or a drag then a U-turn):
   the input names one pick per slot for the slot's starting Pokémon, so the second pick is the engine's default (the input
   bench in party order, then the leavers; its turn fact `Assumes {Newcomer} comes in for {Name}.`), where the rollouts (Q9)
   take the player's healthiest at that moment and the AI's policy assignment over both slots. Not hidden information, a
   modelling difference: engine worlds with an outcome where a side has two leavers: 209 / 233 / 238 per 60 battles (117 / 90 /
   106 on the player's side), of about 7600–8400 ready ones. Conformance 4b leaves those samples out. Exact would need a
   contract change (a per-side preference order for the picks, R-E's `switchRound`); not asked for this wave.
2. `DoublesOutcomeMon.id`'s doc comment says "(a newcomer: its bench id)"; the engine also gives the other slot's start id
   (fix 2 above). A one-line doc fix in `doubles-types.ts` (frozen for this track) is asked of the integrator.
3. The 188 PP differences of the T2 fuzz (W1B-T2.md) stay as they were.
