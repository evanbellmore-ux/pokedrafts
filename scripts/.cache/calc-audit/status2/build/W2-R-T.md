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

GATES_PLACEHOLDER

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
