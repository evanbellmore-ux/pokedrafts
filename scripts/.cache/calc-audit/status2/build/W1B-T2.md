# Wave 1b, Track T2: Training (ADDENDUM2 §6's T2 rows)

Branch `calc-2v2-status-2` (checked before the work and before this report). T1's files continued, T2's only:
`app/(app)/training/sim/{tracker,bridge,effects,belief-battle,splits}.ts`, `app/(app)/training/ai/evaluate.ts`,
`app/(app)/training/model/ai-view.ts`, `tests/unit/training-status2-t2.test.ts` (new), `tests/unit/training-bridge.test.ts`,
`tests/unit/training-status2-step1.test.ts`. Scratch: `status2/build/t2-debug.ts`, `t2-fuzz.ts`, logs in `build/t2/`. Nothing
committed; no frozen file and no other track's file touched; `.claude/`, `node_modules`, CastMirror and RaidCard untouched.

## What the bridge now passes (every source a public line, the tracker's counts, or the belief battle's replay of them)

| Input | Source | Rollout text that went |
|---|---|---|
| `carried.stall` | tracker `protectStreak` (Protect, Detect, Endure, the shields, Wide and Quick Guard): `min(729, 3^streak)`, 1 for none, only with a protecting action or Endure (the readers rule). `splitWorlds` is the identity (kept for its callers) | splits.ts's Protect fork, `{Move} under Gravity while confused: its failing world is not modelled.` |
| `carried.mustRecharge` | the `mustrecharge` volatile (`-mustrecharge`); the request's Recharge is No move | `{Name}: recharging while confused is not modelled.` |
| Struggle | the request's Struggle (`{ moveId: "struggle", target: null }`); an Encore whose move cannot be used (the request's Struggle) is not carried (it does nothing and ends at this end of turn) | `{Name}: struggle is not modelled.` |
| `firstTurn` | `activeMoveActions === 0` (the tracker's action count, which the belief battle carries) for every Pokémon that did not switch in this turn, so a called Fake Out reads it too; the real Fake Out / First Impression is passed | the FIRST_TURN_ONLY note and `{Name}: {move} after its first turn while confused is not modelled.` |
| `carried.charging` | the `twoturnmove` volatile (`-prepare`) for a move of CHARGE_TURN_MOVES or SEMI_INVULNERABLE_MOVES; its own volatile beside it is not a rollout. The release goes at the target it was charged at (pinned `side.ts chooseMove`: the move volatile's `targetLoc`), whichever target the cell names. **That target is hidden**: the charge turn's line is `|move|p1a: Aggron|Solar Beam||[still]` (target blank), so it is the belief world's (effects.ts draws it, as before) | `{Name}: twoturnmove / fly / dig / … is not modelled.` |
| `carried.lockOn` | tracker: `-activate|user|move: Lock-On|[of] target` (and Mind Reader) adds `lockon` with its source, ended after two countdowns (duration 2, no line); effects.ts builds it with that source; carried as the target's slot while the target is in battle | `{Name}: lockon is not modelled.` |
| `carried.destinyBond` | the `destinybond` volatile (`-singlemove`) | `{Name}: destinybond is not modelled.` |
| `carried.taunt`, `encore`, `disable` | the belief battle's durations (effects.ts: each condition's duration from its public `since` and `targetMovedFirst`); Encore's and Disable's move. They leave IGNORED_VOLATILES for MAPPED_VOLATILES | — (they were ignored: the request applied them) |
| `carried.uproar` | `-start … Uproar` and its `[upkeep]` restatements: 3 turns from its start, 1–2 as a turn starts | `{Name}: uproar is not modelled.` |
| `carried.futureMove` | `{ move, source }` for a user in battle (its slot), else `{ move, build }`: `liveBuild` of the user as it is now (out of battle its ability, item and stages do not count; currentHP null, its HP is not read). A build the engine would refuse stays the bare id | — (the bare id) |
| `carried.cudChew` | the Berry's id from the ability state (the belief battle's, restored from the tracker's eat line with counter 1; a prelude copy keeps it) | — (`true`) |
| `carried.onceUsed` | the belief battle's `bondTriggered`, `swordBoost`, `shieldBoost`, `syrupTriggered`, now from public lines (tracker `onceUsed`, below); Battle Bond only in SV | — |
| A2's | `tarShot`, `foresight`, `miracleEye`, `nightmare`, `telekinesis` (1–2), `embargo` (1–4) from their volatiles (no Champions move sets them) | `{Name}: {id} is not modelled.` |
| ally sources (C32) | an ally's Leech Seed, trap and Syrup Bomb go to the engine (a seed whose position the seeded Pokémon itself holds after an Ally Switch is a rollout: the engine refuses a seeder at its own slot) | `{Name}: Leech Seed / a trap / Syrup Bomb from an ally is not modelled.` |
| `fieldTurns` | `fieldClock`: the terrain's, Gravity's and Magic Room's turns before this turn's countdown | `Magic Room ending this turn is not modelled.` |
| `SideConditions.safeguard`, `mist`, `luckyChant` | `-sidestart` (MAPPED_SIDE; `luckychant` left IGNORED_SIDE) | `Side effect safeguard / mist / luckychant is not modelled.` |
| `entryOrder` | ranks of the actives' `abilityState.effectOrder` (below), for those with a public record, a prelude switch-in and a prelude Mega Evolution | — |
| `battleLastMove`, `faintedLastTurn` | the belief battle's `battle.lastMove` (the tracker's last move line: the same move as pinned `clearActiveMove`'s), `side.faintedLastTurn` | — |
| `lastMoveTarget` | the tracker's last move line's target, only when it is the chosen one (no `lastTargetUnknown`, below); null for a move whose target is not chosen (spread, self, random) | — |

New guards (facts; each a belief world or a cell that is not a battle state, so the engine's issue becomes a rollout):
`{Name} is locked into {Move}.` (a cell whose action is not the move a charge, an Encore or an Uproar locks it into: the
request offers only that one), `{Name}: Mental Herb would have cured its Taunt / Encore / Disable / Heal Block /
infatuation.` (a belief world's working Mental Herb beside one; the belief does not rule the herb out after a lasting Taunt),
`{Name}: its Encore's move is not known.`, `{Name}: its disabled move is not known.`, `{Name}: the target its {Move} was
charged at is not known.` (no targetLoc), `{Name}: its {Move} is aimed at an ally that fainted.` (pinned getTarget returns
null for it), `{Name}: Leech Seed draining into its own position is not modelled.`

Kept (ADDENDUM2 §6): Illusion, a Substitute after a hit, `{move} is not in its catalog moves.`, `{Name} must recharge.`,
`needs the public counts`, a G-Max trap, the Weather / Field effect / Side effect templates, `Prelude failed`, `The battle
ended before the moves.`, `A replacement is needed before the moves.`, Octolock from an ally (the engine refuses it).

## Tracker and belief battle (public lines only)

- `PublicCounts.entry`: a battle-wide count of ability states begun: every switch-in (leads in p1a, p1b, p2a, p2b order), a
  permanent form change (`detailschange`, not Mimikyu-Busted or Eiscue-Noice), `-mega`, `-transform`, Skill Swap (the line's
  Pokémon first: pinned `battle.skillSwap`, which Wandering Spirit also calls), an `-ability … [from]` (Trace, Receiver, Role
  Play, Entrainment, Simple Beam, Worry Seed), Mummy (`-activate|holder|ability: Mummy|<changed>|[ability] Old`, which also
  sets the changed Pokémon's ability to Mummy: T1's tracker missed it). Cleared as it leaves.
- belief-battle.ts gives the actives' ability states that order (fresh effectOrder values, newest last), so its rollouts
  break RedirectTarget and SwitchIn ties as Showdown does (pinned `resolvePriority` reads effectOrder only for those).
- `PublicCounts.onceUsed` (kept across switches): `-ability|X|Supersweet Syrup` / `Intrepid Sword` / `Dauntless Shield` with
  no [from], `-activate|X|ability: Battle Bond`. belief-battle.ts sets the four flags from it (they were "has entered
  before", wrong for a Pokémon that never had the ability and gains it mid-battle).
- `PublicCounts.lastTargetUnknown`: the move line's target may not be the chosen one (pinned `lastMoveTargetLoc`): a foe's
  Follow Me or Rage Powder up, a Lightning Rod / Storm Drain `-activate` in the move, a Pokémon of the target's side fainted
  earlier that turn (a retarget), an Encore begun that turn before it moved, an Ally Switch that turn.
- Lock-On's volatile (above).
- Found by `t2-fuzz.ts` (below), each a public line the tracker missed:
  - a broken protection (`-activate|X|move: Feint`, `-activate|X|move: Phantom Force|[broken]`) deletes the stall counter from
    generation 6 (PS/sim/battle-actions.ts breaksProtect): the streak ends;
  - a protecting move that fails (its stall roll: the counter deleted) ends the streak at once, so a second Protect the same
    turn (Instruct) starts from 3;
  - Gravity (`-activate|X|move: Gravity`) and Smack Down (`-start|X|Smack Down`) cancel a Fly or Bounce charge and end Magnet
    Rise and Telekinesis; another move of the charging Pokémon ends its charge (it was cancelled with no line of its own);
  - a Cud Chew record belongs to the ability state: a Skill Swap or Trace giving Cud Chew starts without the Berry.
- **A Trace holder's copied Intimidate is stored** (`build.copiedIntimidateStored` with the foes' keys): it acted as it was
  copied, and its drops are in the foes' stages, but the start settle (doubles-start.ts) applied it again unless stored.
  Conformance 4b's one cell outside the E2 support (V10 against V06, turn 1: Gardevoir tracing Incineroar's Intimidate,
  Fake Out into Kingambit 4–5 in E2, 5–6 in Showdown; `t2-conf4.ts`) is in now (5–6).

## evaluate.ts, ai-view.ts

- `postFromOutcome` keeps the outcome's `charging`, `onceUsed` and `cudChew` on `PostMon.carried` (no value term reads them,
  Q7; `turnsLeft`'s new keys were already copied). `sides.pledge`: no Pledge in Champions and FieldClock has no field for it;
  not read. `nextClock` needs nothing for `fieldTurns`: E2's field after the turn shows the end (`count(1, false, …) = 0`), and
  with the end of turn not estimated the clock still counts 1 down to 0.
- The engine memo's key (`inputKey`, exported for its test) holds the turn-level inputs (weatherTurns, canSwitch, fieldTurns,
  entryOrder, battleLastMove, faintedLastTurn, echoedVoice): two prelude worlds of one cell can differ only in their entry
  ranks (tied switch-ins), and they shared one result before.

## Tests

`tests/unit/training-status2-t2.test.ts` (27, new): real Champions seat battles on pinned Showdown, each belief battle (truth
world) checked against the real battle and the bridge's input against the real battle's state: the stall counter (3, 1, none;
splitWorlds the identity), the recharge (confused too), Struggle under Taunt with Taunt's turns, Fake Out's firstTurn (the real
activeMoveActions), a charged Solar Beam and Fly released at the belief world's target whatever the cell names (the charge
line hides it), a cell with another move (`locked into`), a charged move Disable forbids, Lock-On (its volatile, its source,
its end), Destiny Bond, Taunt after / before its target moved, Encore and Disable (the real durations; another move: locked),
Uproar, a belief world's Mental Herb beside a Taunt, Future Sight's user in battle and out of it (its stored Sp. Atk),
fieldTurns = the real durations, Safeguard, Mist and Lucky Chant, the entry order (leads; Skill Swap; the belief battle's own
order; a prelude switch-in newest), battleLastMove, faintedLastTurn, lastMoveTarget (chosen; null for a spread move; absent
after Follow Me), Supersweet Syrup's flag (belief = real), Cud Chew's Berry by id (and through a prelude copy), an ally's Leech
Seed, a Trace holder's stored Intimidate (E2's Flare Blitz range = Showdown's over 300 seeds), the tracker's lines (entry
order, Mummy, lastTargetUnknown's five causes, onceUsed across a switch, Lock-On's two countdowns, a broken or failed Protect,
Gravity / Smack Down / another move ending a charge, a Cud Chew record ending with Skill Swap), evaluate's memo key and
postFromOutcome's new fields.
Updated: `training-bridge.test.ts` (Struggle, the charge, Safeguard now engine; stall 1 on protecting moves; Future Sight's
user; Magic Room's turns; the engine's own 1/3 stall roll replaces the split's weights), `training-status2-step1.test.ts`
(Cud Chew's Berry by id).

`status2/build/t2-fuzz.ts` (scratch): random legal battles between four teams built on these states; at each p2 turn the
belief battle (truth world) against the real battle (taunt / encore / disable / uproar / lockon durations, moves and sources,
stall counters, twoturnmove, Leech Seed slots, the once flags, Cud Chew's state, activeMoveActions, the ability states' order,
the field and side durations, battle.lastMove, and HP, boosts, item, ability, stats, status), one-turn logs with no hidden
counter, and six of the AI's legal cells through the services to the engine. Final runs (this tree):
- seed 7, 60 battles: 1283 decisions, 4875 Pokémon compared, **0 mismatches**, 742/742 clean logs equal, 7459/7698 engine
  cells, **0 engine issues**;
- seed 101, 60 battles: 1335 decisions, 0 mismatches but one engine exception in K's work in progress (below), 0 issues;
- seed 23, 70 battles (with HP/stats/PP compared too): 0 mismatches in the T2 states; the PP of moves into a Pressure holder
  whose line names no target (a spread move's immune Pressure foe, a failed `[still]` line) is too high in the belief battle,
  and 2/937 one-turn logs differ by a damage roll after Instruct (both found, neither T2's: below).
`t1-fuzz.ts` (T1's) on this tree, 80 battles seed 7: 0 mismatches, 1339/1339 logs, 0 issues.

## Gates (this tree; other tracks' work in progress included)

- `vitest tests/unit/training-*` (final code): 57 files, 678 tests pass (`training-status2-t2` 27/27
  ). tsc: no error in T2's files (other tracks': doubles-eot.ts, doubles-fieldchange.ts, doubles-start.ts at the time).
  eslint clean on T2's files.
- `conformance:training --run t2-conformance-SVA` (final code): every row PASS but row 8 (E2 vs Showdown, the generated
  doubles-turn-showdown cases: 6 of 1592 failing, all E2's in progress: ER41d Cud Chew, ER41e Future Sight landing, ER41g Zen
  Mode, ER41h G-Max Wildfire, G4-WHR-01-sv/-swsh). Tracker parity 830/830; belief 287/287; requests 100 %/100 %; one-turn logs
  266/266; default settings 289/289; bridge 0 mismatches over 400; **clean rollouts inside the E2 support 55733/55733 over
  2989/3000 engine cells** (the first run, before the stored Intimidate: 55590/55733, one cell, `t2-conf4.ts`); carried.stall
  724, carried.charging 60 in 4b; splits 33.7/35.0/25.1 %; choice strings 24006/24031 + 25 hidden-trap; census 0; saved battles
  30/30, Resume 30/30, Illusion/Transform 6/6; runner errors 0. `build/t2/conformance-2.log`.
- `leak:training` (final code, defaults; `build/t2/leak-2.log`): every row PASS. L1 every field 0 differences (sp 189, nature 232, item 243, ability 247, moves 289, bench 316, hp 144, dice 71, dice-eot 72, choice 129; the settings work 163/203, 65/128); L2 0 hits in 516 messages over 40 battles; saved battles 40 replays equal, 10 resumed, 236 checkpoints sealed; Illusion and Transform 0 hits in 191 messages over 16 battles, 7 Illusions ended, 16 with a Transform, 4 look-alike decisions, 16/16 replays equal. Every new input field is in L1's hashed engine inputs (`bridgedHash`: the whole engine worlds JSON).
- `eval:training --gates --scale 1 --shards 8 --run s1-step1` (main's seeds; results kept as
  `scripts/.cache/training/eval/t2-w1b-s1seeds`, Step 1's `s1-step1` put back; `build/t2/eval.log`): **21 PASS, 1 FAIL** — the
  HabitBot row (2.8 pts [-1.3, 6.8]; 1a 2.8, main 4.0: it fails on main too). **A1.4 now passes** (Rage Powder chosen on its
  one usable turn; it failed on main and 1a). Legality 0 errors, 0 engine issues, 0 fallbacks (open 2600, closed 200, perfect
  400); vs RandomLegal 99.0 %; vs MaxDamage 63.0 % (main 64.3 %); Reads vs MaxDamage 73.8 % (main 72.0 %); self-play 50.0 %;
  closed 99.0 %; open vs perfect −4.0 pts; decision time p50 280 p95 628 max 1358 ms (worst run safe-maxdamage-suggested; perf
  pass 267 / 592 / 1273, main 274 / 577 / 1181; other tracks were running on the machine); preview / replacement 67 / 9.20 ms;
  belief 21 / 7.36 ms; budget 240 / 160 / 4; dropped 0; **engine + prelude cells on pool S 99.6 %** (1a 96.9 %, main 88.5 %),
  96.8–98.7 % in every run; exploitability 0.01 %; determinism 20/20; A1.5 rows pass.

## Deviations and open points

- **The charge's target is hidden.** ADDENDUM2 §6 maps `charging` without saying where the release goes. Pinned Showdown blanks
  the charge turn's target (`|move|p1a: Aggron|Solar Beam||[still]`), and `-prepare` names none, so the target is a belief
  world's draw (effects.ts, as before: the belief seed). The bridge releases at that target, the one the belief battle's own
  rollouts use (conformance 4b plays the belief battle, which agrees). The AI's own charge target is known to the AI in reality
  but not kept in AiInputs (it is drawn too, "Charging move's target drawn."): a follow-up would carry the AI's last choice.
- `onceUsed` passes non-empty lists only (an empty list changes no number, only the engine's assumption fact).
- `firstTurn` is passed for every Pokémon that did not switch in (a called Fake Out reads it), not only Fake Out users.
- `sides.pledge`: Champions has no Pledge and FieldClock has no field for one: not read.
- The Encore whose move's PP runs out this turn ends at this residual (data/moves.ts encore onResidual); the bridge passes its
  turns as the duration (E2's outcome `turnsLeft.encore` may then say it lasts; only the next turn's state, which no value term
  reads, Q7).
- Found, not T2's rows (pre-existing tracker R4 PP counting, `t2-fuzz.ts` seed 23 with PP compared): a move whose Pressure
  target the line does not name (a spread move into an immune Pressure foe, which `[spread]` does not list; a failed `[still]`
  line with its target blank) costs the extra PP in Showdown but not in the tracker, so the belief battle's PP can be higher
  (an Encore can then end a turn early in Showdown only, conformance has no such pool). Two one-turn logs after Instruct differ
  by a damage roll (Oranguru, seed 23 battle 5): not in any carried state (HP, boosts, stats, items equal).
