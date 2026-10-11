# Integration: 2v2 status moves and end of turn (status-eot)

Branch `calc-2v2-status-eot`. This covers SPEC §8 "Integration" and ADDENDUM §8 "Integration (additions)", after tracks A–E.
Ground truth is pinned Showdown c23d2e94. Nothing was committed or pushed, no branch was switched, `next build` was not
run, nothing touched live Supabase, and `.claude/` and `node_modules` were left alone. The dev server already on port 3005
(not this session's) was left running.

## Gates (exact output lines, final runs on 2026-10-08)

| Gate | Command | Output |
|---|---|---|
| Lint, types, unit tests | `npm run check` | eslint and `tsc --noEmit` clean; `Test Files  215 passed (215)`, `Tests  5303 passed (5303)` |
| Source tests | `npm run test:battle-data:source` | `Test Files  8 passed (8)`, `Tests  128 passed (128)` |
| 1v1 golden | `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check` | `golden-1v1: 254 cases byte-equal (3505 ms)` (final run, after every change) |
| Oracle vs app, every case | `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts` | `1001/1001 cases match.` (994 of Track D's + 7 integration cases) |
| Earlier oracle results | `node scripts/.cache/calc-audit/2v2/verify/regress.mjs scripts/.cache/calc-audit/2v2/verify/results` | `549/552 byte-equal after the moves (status-eot fields, ms and the walk bookkeeping stripped); differ: 3; missing: 0`. The 3 are M24i, M24j and M29c, whose `before-status-eot` baselines are stale files from an older harness (no `truncated` field; M29c without its Sitrus), as TRACK-D.md proved with the pre-status-eot harness. |
| Every oracle case rerun | 8 parallel `sim-dfs.ts` shards into `build/int-results`, then `node scripts/.cache/calc-audit/status-eot/build/int-diff-results.mjs` | `939/940 rerun results equal to the stored ones (ms stripped); differ: 1; new: 55`. The one is INT05, whose stored result is the fixed recorder's (below); the shard ran before that fix. The 55 new are reason-only cases run with `--all` (6 of them cannot run in the oracle: a mid-turn switch request, or Uproar's choice). |
| App side, earlier cases | `node scripts/.cache/calc-audit/2v2/verify/app-diff.mjs` | `0 unexplained` (510 byte-equal after the moves; 37 + 2 add only assumption facts; 33 keep their reason; 5 became ready by design; F14a's Sleep Talk reason; 2 stale files) |
| Generated test | `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts` | `wrote 653 cases to …tests\unit\doubles-turn-showdown.test.ts (0 cases that do not agree with the app left out)`; with `doubles-outcomes.test.ts`: `Tests  657 passed (657)` |
| Bench | `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/bench.ts` | turn p50 3.64 ms, p95 8.06 ms, max 24.07 ms (E30c) against 30 / 120 / 400; Moves pane p50 12.90 ms, max 23.53 ms against 25; reference equality 30/30; 1 208 turns: 1 099 ready, 105 not estimated, 4 issues (the same 4 fuzz inputs as before status-eot); the 7 bench turns 3.7–13.3 ms, all with the end of turn ready |
| Training conformance | `npm run conformance:training` | every gate PASS: 1 640/640; 2a 220/220; 2b 100.00% / 100.00%; 2c 212/212; 3 215/215, 215/215; 4a 0 over 320; 4b `43397/43397 (100.00%) over 2353/2400 engine cells`; 4c (report) `1846/2353 engine cells (78.45%)`; 5 `33.7% / 35.0% / 25.1%`; 6 18398/18446; 7 0; 8 `Tests  657 passed (657)`; 9a 30/30; 9b 30/30; runner errors 0 |
| Training leak | `npm run leak:training` | every gate PASS: L1 0 differences in every family (sp 194, nature 231, item 247, ability 253, moves 289, bench 305, hp 152, dice 70, choice 129); `L2 … 0 hits in 502 messages over 40 battles`; saved battles 40 replays, 40 of 40 boards equal |
| Training eval | `npm run eval:training -- --gates --scale 1 --shards 8 --run integration` (quiet machine, 13 m 27 s) | 20 PASS, 2 FAIL. PASS: legality open/closed/perfect `0 errors, 0 engine issues, 0 fallbacks, 0 capped` (n 2600 / 200 / 400); vs RandomLegal `98.0% [95.0%, 99.2%]`; vs MaxDamage `63.2%`; Reads vs MaxDamage `72.3%`; self-play `49.0%`; closed sheets `98.0%`; information cost `-1.8 pts`; **turn decision `p50 361 ms p95 776 ms max 1369 ms`** (limit p95 800: passes now); preview/replacement `83 ms / 11 ms`; work budget `engine 240, rollouts 160, builds 4`; dropped 0; pool S `89.5%` engine + prelude; exploitability `0.01%`; determinism `20/20`; A1.4; A1.5 ×3. **FAIL:** `Reads you − Plays safe, both vs HabitBot`: `0.8 pts [-3.3, 4.8] n=400` (≥ +5); `Belief update per turn`: `closed 23 ms, open 8.75 ms` (open ≤ 8; the worst run is safe-maxdamage-usage, the other eight open runs 6.24–6.93 ms). Both are analysed under "Still open". |
| Server render | `npx vitest run --config scripts/.cache/calc-audit/status-eot/build/int-render.config.mts` | `Tests  1 passed (1)`; text in `build/int-logs/render.txt` |

Logs of every run: `build/int-logs/` (compare-1/2/3, oracle-0…7 and oracle-reasons, bench-1, conformance, leak, eval, check,
source, render.txt).

## Fixes made (each minimal; file and what)

### Engine
1. **E25b, a draining move whose hits all met a Substitute** (`uses-to-ko.ts` `hitEnd`, frozen part path; Track E item 0):
   `if (group.drained) return group.drained.states[landed ? group.drained.to(0, dealt) : 0];`. With `landed` 0 no 0-damage
   `hitStep` runs, so no Rough Skin, Rocky Helmet or Mummy-family swap. Test: `doubles-substitute.test.ts` "a draining
   contact move into a Substitute meets no Rough Skin (E25b)". E25b now matches; golden byte-equal.
2. **ER21c, Psychic Noise and an HP Berry** (Track B item 8, Track D): `doubles-turn.ts` `psychicNoiseKeepsBerry` — when
   Psychic Noise's Heal Block lands (secondaryLands; no Aroma Veil on the target's side) on a target holding a working
   Sitrus, Oran, Berry Juice or Figy-family Berry, `singleStep`'s search reads the Berry as Leftovers (`searchFor` opts
   `healBlocked`, in the memo key) and the step puts the Berry back: pinned runs the secondary before the hit's Update,
   where the Berry's TryHeal fails. Enigma Berry (eaten in the Hit event) is not stood in. Track B's
   `{Berry} after Psychic Noise is not modelled in 2v2.` guard in `doubles-eot.ts afterHit` is removed. Test:
   `doubles-eot.test.ts` "Psychic Noise and a Sitrus Berry" (now ready, the Berry kept in E2). ER21c now matches.
3. **A fainted Pokémon keeps its Substitute** (Track E item 3): `doubles-turn.ts faint()` clears `vol.substitute`
   (clearVolatile); `doubles-positions.ts outcomeMon` reports nothing for a fainted Pokémon. Test: `doubles-substitute.test.ts`
   "a Pokémon that faints loses its Substitute"; oracle case INT05 (E2).
4. **A Figy-family Berry eaten as the turn starts** (Track A item 4): the `Confusion is not modelled in 2v2.` guard in
   `calculate.ts settleDoublesStart` is deleted, and `doubles-turn.ts startWorld` gives the holder a fresh confusion
   (`{ attempts: 0, min: 2 }`) unless it carries one. Tests: `doubles-status.test.ts` INT01 row, `doubles-turn-guards.test.ts`;
   oracle case INT01.
5. **Battle end during the moves** (Track B item 6): `doubles-turn.ts battleOver` — a side with `canSwitch: false` whose
   every Pokémon in place has fainted ends the battle (sim/battle.ts checkWin): no later action runs; its step gets the skip
   fact `The battle ends before it moves.`; the end of turn already passed such a world through. Test: `doubles-eot.test.ts`
   "…ends the battle: no later action runs"; oracle case INT02 (with E2).
6. **Parting Shot and Eject Pack** (Track A item 6): `eventGuards(…, ejectPack)` — `runMove` passes
   `move.id !== "partingshot"` (data/items.ts ejectpack onAfterBoost). Oracle case INT03 (with E2).
7. **Terrains and a semi-invulnerable Pokémon** (Track B to Track A): Misty and Electric Terrain do not block a status or
   confusion/Yawn volatile on a Pokémon in Dig, Dive, Fly, Bounce, Phantom Force or Shadow Force (`eot.hidden`), as pinned
   onSetStatus / onTryAddVolatile return for `isSemiInvulnerable()`; Psychic Terrain's TryHit likewise. Five places in
   `doubles-status.ts` (canStatus, the volatile switch with a separate `onTerrain`, Dynamic Punch's confusion, the Figy Berry,
   Psychic Terrain). Oracle cases INT04a (Electric) and INT04b (Misty), both with E2; a negative check (reverting canStatus's
   line) makes both fail with `E2 own-left asleep (sleepTurns given): expected 1, got 0`.
8. **Carried trap names** (Track B item 5): `DoublesCarried.trap.move` and `EotState.trap.move`; `carriedState` copies it;
   `validate` checks it is a move of the game; the bridge passes the volatile's source move (public `-activate` line;
   `effects.ts` builds it from the tracker) when it is a catalog move. The residual reads `Fire Spin` and the condition
   `Trapped by Fire Spin.` instead of `Partial trap` / `Partially trapped.`. Tests: `doubles-eot.test.ts`,
   `training-bridge.test.ts`; oracle case INT06 (Whirlpool). Track D's `app-turn.ts`, `gen-tests.ts` and
   `doubles-outcomes.test.ts` pass the case's trap move too.
9. **Curse's target rule** (Track A item 5): `doubles-targets.ts` gives a non-Ghost user's Curse `{ kind: "none", scope:
   "self" }` (pinned sim/pokemon.ts getMoves nonGhostTarget), with the turn's type rule (a Tera type, else the species').
   Tests: `doubles-targets.test.ts`; `tests/source/doubles-third-party.test.ts` expects the nonGhostTarget for its non-Ghost
   user.
10. **`MoveVolatiles.encore`** (Track A item 7) in `doubles-world.ts`; `doubles-status.ts`'s `Vol` is now that type.
11. **REASONS** `sleep`, `freeze`, `confusion`, `pollenPuff` and `substituteHit` deleted (Track A item 8, Track E item 2,
    ADDENDUM §8); no stub path is left in `doubles-substitute.ts`.
12. **The Ally Switch fact after TryMove** (Track E item 4, optional): `Resolution.swap` carries
    `Ally Switch: {Move} hits {Occupant} in {Chosen}'s place.`, stated only once TryMove and Try pass (damaging moves in
    `damagingMove`, status moves in Track A's `runUse`); a Sucker Punch failing on the new occupant no longer says it hits.
    `doubles-positions.test.ts` E12 updated.
13. **The self-faint fact behind a Substitute** (Track E item 6, optional): `selfFaintFact` leaves out Rough Skin, Iron
    Barbs, Rocky Helmet and a Jaboca or Rowap Berry of a target whose Substitute a one-hit move met
    (`doubles-substitute.ts meetsSubstitute`, exported; `LossSnapshot.substitute`). Test: `doubles-substitute.test.ts`.

### UI
14. Track C's two patches applied as written: `useDoublesCalculation.ts` (carried state and an Imprison user's moves reach the
    engine) and `DoublesSettings.tsx` (the toggle count includes Confused, Rest sleep and Substitute).
15. **No moves chosen, but the end of turn acts** (Track C item 4): `doubles-format.ts actsWithoutMoves`; `DoublesTurn` and
    `DoublesSummary` show the turn (End of turn list, HP after the turn) when no Pokémon chose a move but a residual, an
    end-of-turn fact, a No-move self-hit or an end of turn not estimated is there; otherwise `No moves chosen.` as before.
    Test: `calculator-doubles-ui.test.ts` "shows an end of turn that acts when no Pokémon chose a move".

### Training
16. `sim/services.ts` passes `publicOf` to `bridgeTurn` (Track B item 1): confusion, Rest sleep and the other public counts
    reach the bridge.
17. `sim/splits.ts` no longer forks sleep and freeze (Protect stays); `SPLITS_BRANCH_SLEEP = false` (Track B item 2): the
    engine's BeforeMove branches wake and thaw from `carried.sleep` / `carried.freeze`, so a frozen Pokémon, an Early Bird
    sleeper and a frozen Pokémon facing a Fire move are engine cells. Conformance gate 5 still measures pinned Showdown's
    rates and passes. New narrow rollout: a confused Protect user under Gravity with a protect streak (its failing world is
    No move, which Gravity stops before confusion). Test: `training-bridge.test.ts`.

### Tests updated (old expectations other tracks' work made stale)
- `doubles-turn-guards.test.ts`: Skill Swap replaces Taunt as the L move before another move, and as the last action under
  Trick Room (`endOfTurn` "Skill Swap is not modelled."); Roost, Substitute, Belly Drum and Pain Split ready, Revival
  Blessing still guarded; Pollen Puff heals the ally (`Pollen Puff fails: Charizard is at full HP.`, +76 at 50 HP); sleep
  (`Asleep.` 1 with the assumption fact), Champions freeze (`Frozen.` 0.75, `Thaws.` 0.25) and the Figy confusion ready.
- `doubles-turn-fixes.test.ts`: R01, R15, F14b moved to a "status-eot models" list (ready; exact rows in
  `doubles-turn-showdown.test.ts`); F14a's reason `Sleep Talk is not modelled in 2v2.`.
- `doubles-start-rows.test.ts` SR44: Gengar's Skill Swap for Weavile's Taunt.
- `doubles-kernel.test.ts`: the end of turn is applied; a hit into a Substitute is kind `"substitute"`.
- `doubles-turn-mechanics.test.ts`: the stub fact is absent.
- `tests/fixtures/doubles-turn.ts`: no stub fact; its end of turn `Too many cases to follow.`; the not-estimated fixture is
  Worry Seed (Sleep Powder is modelled now), with `calculator-doubles-ui.test.ts`'s three texts;
  `calculator-doubles-fainted.test.ts`'s empty turn has a ready end of turn.

### Oracle (Track D's harness)
- `sim-dfs.ts`: a battle that ends during the moves (`b.ended`, checkWin) ends the path with the turn as the moves left it
  (no residual), where it used to throw; a carried Yawn is added while the terrain is lifted at prepare (Electric Terrain
  refused it there); a Substitute gone with no `-end` line (its holder fainted to a move that passed it) is not a hit on it.
- `cases-int.ts` (new, wired into `cases-se.ts`): INT01 Figy at the start, INT02 battle end, INT03 Parting Shot + Eject Pack,
  INT04a/b Yawn under Electric/Misty Terrain on a Dig user, INT05 a fainted Pokémon's Substitute, INT06 a carried Whirlpool.
  All run in the oracle, all match (INT02–INT05 with E2 outcomes).
- `results/M24i.json`, `M24j.json`, `M29c.json` refreshed from the rerun (they were stale, TRACK-D.md).
- `app-results/` and `results/compare.json` rewritten by the final `compare.ts`; `tests/unit/doubles-turn-showdown.test.ts`
  regenerated (653 cases).

### Housekeeping
- Line endings: `hit-loop.ts` (Track E's appended LF lines in a CRLF file) and `doubles-turn-fixes.test.ts` normalised to CRLF.
- Integration scripts in `build/`: `int-shards.ts`, `int-reason-ids.ts`, `int-diff-results.mjs`, `int-render.test.ts` and
  `int-render.config.mts` (the gates), `int-belief-bench.ts` and `int-calc-bench.ts` (the eval timing analysis).
- Scratch eval outputs: `scripts/.cache/training/eval/integration/`, `integration-hb-trackbseeds/` and `int-belief-a/`;
  Track B's `trackb-final/` was restored byte-for-byte from its backup after the same-seed rerun.

## Every needsFromOthers / needsFromIntegrator item

| Track | Item | Resolution |
|---|---|---|
| A | guards, fixes, SR44 tests | Done (above). |
| A | Figy at the turn's start | Done (fix 4). |
| A | non-Ghost Curse target | Done (fix 9). |
| A | Eject Pack after Parting Shot | Done (fix 6). |
| A | `MoveVolatiles.encore` | Done (fix 10). |
| A | delete the five REASONS | Done (fix 11). |
| A | confirm the Champions certain-crit fix | Confirmed: `data/mods/champions/scripts.ts` is `gen: 9`, so `sim/battle-actions.ts:1623-1641` uses critMult `[0, 24, 8, 2, 1]`: ratio 4 (stage +3) always crits. Kept; golden byte-equal. |
| A | allowed stored diffs F14a, F14b, M11b, R01, R15, V36b–d | `app-diff.mjs`: 0 unexplained (they are in its allowed classes). |
| A | optional: lift Psychic Noise's guard before a later action | Not done: later hits on (and by) a heal-blocked Pokémon would need the part path to read Heal Block for drain, Shell Bell and every Berry; only the last-action case is exact now (fix 2). |
| A → D | lastMove, moves, targets in the S/E rows | Done by Track D (doubles-outcomes 4/4). |
| A → D | effect facts case-insensitive; gross vs net `change` | Done by Track D; compare matches all. |
| A → C | new fact texts | Rendered (server-render check). |
| B | `publicOf` in services | Done (fix 16). |
| B | splits.ts forks; `SPLITS_BRANCH_SLEEP` | Done (fix 17). |
| B | doubles-kernel, doubles-turn-mechanics stubs | Done. |
| B | carried trap names | Done (fix 8). |
| B | battle end during the moves | Done (fix 5). |
| B | optional: fold `PublicCounts` into `model/public-state.ts` | Not done: a refactor with no behaviour change. |
| B | Psychic Noise and the hit's Update | Done (fix 2). |
| B | old expectations | Done. |
| B | eval timing on a quiet machine | Rerun (eval row above). |
| B → A | canStatus under a terrain and a semi-invulnerable target | Done (fix 7). |
| B → A/D | S49 slightly different | `compare.ts` reports S49 matching (an `oracle: "modes"` case: KO chance within 1.5 points, average within 4 standard errors). |
| B → E | E25b | Done (fix 1). |
| B → C, D | residual texts and names | Rendered; compare matches every residual. |
| C | useDoublesCalculation, DoublesSettings patches | Applied (fix 14). |
| C | the fixture's stub fact | Done. |
| C | optional: end of turn with no moves | Done (fix 15). |
| C → E | `Substitute: {hp} HP.` per world | Already so; the card merges them (render: `Substitute: 15–19 HP`). |
| D | E25b, ER21c, rerun compare and gen-tests | Done: 1001/1001, 653 generated cases. |
| D | Moves pane bench | 23.53 ms max (target 25). |
| E | hitEnd | Done (fix 1). |
| E | doubles-kernel Substitute test | Done. |
| E | delete `substituteHit` | Done (fix 11). |
| E | faint clears the Substitute | Done (fix 3). |
| E | optional: the Ally Switch fact after TryMove | Done (fix 12). |
| E | optional: Air Balloon under Klutz or Magic Room | Not done: the line (`uses-to-ko.ts` afterHit `if (def.itemId === "airballoon" && hitAny)`) predates status-eot and is 1v1's too; adding `&& this.m.defItemOn` changes 1v1 (Knock Off's 1.5x after a Klutz holder's Balloon), which this build keeps byte-equal. A follow-up. |
| E | optional: the self-faint fact | Done (fix 13). |
| E → B | Micle Berry and Symbiosis at the end of turn | Already guarded: `doubles-eot.ts` after-phase guard (an item used up with a Symbiosis partner). |

## Server-render check (`build/int-logs/render.txt`)

The real engine through `DoublesSummary` (cards as useDoublesView builds them) and `BattleConditions` with the carried controls:
- **Thunder Wave + Body Slam** (Champions): `Charizard` / `Is paralysed.`, then Body Slam's damage; the card's conditions
  line `Paralysed`; all cards `After the turn · Average estimate`.
- **Spore with a carried sleep counter** (SV, Snorlax asleep, 1 turn lost): `Garchomp` / `Falls asleep.`; Snorlax's step
  `Asleep (66.67%).`, `Wakes up (33.33%).` and its Body Slam `reaches it 33.33%`; conditions `Status cured (33.33%)`, `Asleep`.
- **Sand + Leftovers** (Champions, with Rock Slide and with no move chosen): `End of turn` with `Sandstorm · Snorlax: −14 HP`,
  `Leftovers · Snorlax: +14 HP`…; the fact `Assumes the Sandstorm does not end this turn.`.
- **Leech Seed**: `Garchomp` / `Is seeded.`; `Leech Seed · Garchomp: −22 HP (from Venusaur)`; conditions `Leech Seed`.
- **End of turn not estimated** (Skill Swap last under Trick Room): `End of turn not estimated: Skill Swap is not modelled.`;
  the cards `After the moves · Average estimate`.
- **Ally Switch + Aqua Jet**: `Ally Switch: Alakazam and Garchomp swap places.`, `Ally Switch: Aqua Jet hits Garchomp in
  Alakazam's place.`, conditions `Swapped places with Garchomp` / `Swapped places with Alakazam`, and the turn fact
  `Assumes Alakazam did not use Ally Switch last turn.`.
- **Trick Choice Scarf onto a slower foe**: `Trick: Snorlax gets Choice Scarf; Alakazam gets nothing.`; Snorlax (75 with the
  Scarf) moves before Azumarill (70); conditions `Holds no item` / `Holds Choice Scarf`.
- **Carried Substitute + Icicle Spear** (SV, 45 HP): `Garchomp's Substitute: −45 HP, breaks 100%`, then the hits that reached
  Garchomp, `Its Substitute breaks.`, `Icicle Spear hits Garchomp after its Substitute breaks.`.
- **The new controls** (Champions and SV): one block per Pokémon in its side's fieldset with Confused, Rest sleep and
  Substitute checkboxes and `Turns lost to sleep`, `Turns lost to freeze` (Champions only), `Bad poison turns so far`,
  `Confusion turns so far`, `Substitute HP`, each with a screen-reader name `: {Name}`.
- **Facts only:** no instruction text and no `left/right Pokémon` label in any turn panel or card text. The one exception
  found is main's Pokémon chooser dialog (`Change your left Pokémon`, `Find your left Pokémon`, PokemonChooser.tsx), which
  names the slot it fills and predates this build.
- The 375 px width cannot be checked without a browser (left to the live check); the new lines carry `wrap-anywhere` / `min-w-0`.

## Still open

- **eval: `Reads you − Plays safe, both vs HabitBot` fails on this run's seeds, and on main's code too.** The team pairs and
  seeds come from the run name (`lib/teams.ts mirroredPair(run, …)`), so each run is a different sample of 400 battles.
  - Same seeds as Track B's run (`--run trackb-final --only safe-habitbot-open,reads-habitbot-open`, with Track B's
    folder backed up and restored; output kept in `scripts/.cache/training/eval/integration-hb-trackbseeds/`): the current
    code gives Track B's numbers exactly, safe 62.5% (250 / 150), reads 71.5% (286 / 114), `9.0 pts [5.0, 13.0]` PASS.
  - This run's seeds (`--run integration`) on main 0ccce76 (a temporary `git worktree`, node_modules joined, removed
    afterwards): `2.5 pts [-1.4, 6.4] n=400` FAIL as well (`build/int-logs/eval-hb-main-integration-seeds.log`).
  - Earlier runs of the gate on main ranged 1.8–6.5 points; the status-eot runs 7.0, 9.0 and 0.8. The gate's threshold is
    near the size of its sampling spread across seed samples; status-eot does not move it on a fixed sample.
- **eval: open belief update p95 8.75 ms (limit 8).** On identical recorded inputs the belief update costs the same on main and
  on the branch (`build/int-belief-bench.ts`, 980 observes: mean 1.46 / 1.46 ms, p95 3.44–3.50 / 3.46–3.51 ms), and
  `calculateTurnMove` costs the same (`build/int-calc-bench.ts`, 400 rounds: 26.2 vs 25.8 µs). In the eval process it is
  higher: the same 100 pool-U battles (`--run int-belief-a`) give main 7.15 / 7.60 / 6.88 ms and the branch 8.25 / 9.83 /
  8.16 ms (and 7.75 with the Champions certain-crit lines reverted, within that spread). Those battles run 5% longer on the
  branch (6.4 vs 6.1 turns) and each decision's E2 does more work (the end of turn), which the p95 of a short phase in the
  same process picks up; the cause is not pinned to one line. Track B measured 8.45 and 8.62 ms on its runs. Needs a
  decision: accept, raise the open limit, or profile the eval process's allocation pressure.
- The live `/calculator` 2v2 check in a browser (yours), including 375 px.
- Psychic Noise before a later action stays not estimated (above).
- Air Balloon under Klutz or Magic Room in the shared part path (above).
- `PublicCounts` refactor (above).
- Not estimated by design and unchanged: the 73 L moves, Sleep Talk, Uproar, the R41 end-of-turn guards.
