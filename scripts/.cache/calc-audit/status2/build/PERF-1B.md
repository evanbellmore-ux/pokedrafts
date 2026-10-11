# Perf pass 1b (status2, before wave 1b)

INTEGRATION-1A.md §4 items 1, 2 and 5: Training's slowest decisions (all with Sinistcha's Matcha Gotcha, now modelled), the
bench's +7 % / +10 %, and the spread-heal worlds that 1b's ×16 landing rolls could push past 200 000 entries. This pass makes
the engine faster without changing any result: every number is computed by the same floating-point operations, in the same
order, as before. Every check below is byte-equal against this tree as it stood after integration 1a ("before").

## Status

- **Branch:** `calc-2v2-status-2`, checked before the work and again before this report.
- **Files changed (only these four, as allowed):** `app/lib/battle/doubles-world.ts`, `doubles-turn.ts`, `doubles-spread.ts`,
  `uses-to-ko.ts`. Line endings kept (CRLF). The diffs against the pre-pass files are in `perf1b/diff/*.diff`; the pre-pass
  engine copy (all of `app/lib/battle` as it stood) is `perf1b/engine-orig/`, used by every A/B below.
- **Frozen files:** three of the four are wave 1b's frozen kernel (`doubles-turn.ts`, `doubles-world.ts`, `uses-to-ko.ts`)
  and one is wave 1a's (`doubles-spread.ts`); this pass was the stated exception, before 1b starts. No other file of the app
  changed, no hook, signature, text or behaviour changed, and `status-table.ts` was not regenerated.
- **Not done:** nothing committed, pushed or switched; `.claude/`, `node_modules`, CastMirror and RaidCard files untouched; no
  `next build`; nothing against live Supabase.
- **Where things are:** the scripts and logs in `build/perf1b/` (`tools/`, `caps/` with the captured Training inputs, `diff/`,
  `census/`, `bench3.sh`, `repro.sh`, `training-gates.sh`, `abhash.ts`). `tools/rb.sh` and `tools/ab.sh` are as run from this
  session's scratch folder (they name its bundles).

## 1. Where the time went

**Reproduction.** `int1a/one-battle.ts safe-maxdamage-open safe maxdamage 134` (Training's eval battle 134, turn 2). To
time the engine alone, `perf1b/tools/capture-doubles-turn.ts` (a `TSX_TSCONFIG_PATH` alias of `@/app/lib/battle/doubles-turn`)
records every `calculateDoublesOutcomes` input of the battle, its result's sha1 and time: 256 calls (turn 1: 100, turn 2: 114,
turn 3: 42). `perf1b/tools/replay.ts` replays them (warm, the least of N rounds) and checks each result's hash; it is bundled
with esbuild once against this tree and once against `engine-orig` (`tools/ab.sh` alternates the two).

**Profile before** (CPU profile of the replay's five heaviest cells, bundle line numbers mapped back to the source files:
`tools/proflines.mjs`, `callers.mjs`, `callees.mjs`; shares of `calculateDoublesOutcomes`):

| Share | Where |
|---|---|
| 27 % + 9 % | `applyStep`'s own work, and the `sideKey` texts it builds: per outcome a `JSON.stringify` signature holding two whole side texts; `RADIX ** index` and `indexOf` per key digit |
| 23 % (19 % of it `factorKey`) | `mergeWorlds`: `factorKey` (sorting every table's keys and printing every mass) for every factor of every world, even a world alone in its key |
| 19 % | `turnStep`: one call per group of `applyStep`'s extras, each rebuilding `loopInput`, the entry nodes' keys (`restKey` text) and string-keyed nodes |
| 8 % | `splitFactor`: two map passes per slot, also for slots that cannot split |
| rest | `canonicalJoin` / `dropBell` re-keying through `hpIn` and `**`, `sideFaintedChance`, the calculations |

**The worst cell** (#162: Gallade Psycho Cut, Azumarill Play Rough, Garchomp Earthquake, Sinistcha Matcha Gotcha): after the
drain, Sinistcha's HP is joined with both targets' (SPEC2 C12). Azumarill's Play Rough into Garchomp (Rough Skin) follows the
attacker's HP, so `applyStep` joins a four-slot factor of **15 222 entries** and calls `turnStep` once per pair of the other
two HPs: **657 calls, 22 853 outcomes, 80 093 entries** in one step. The drain itself (`drainingStep`) was no longer the main
cost once `mergeWorlds` stopped printing tables; the step after it is.

## 2. The changes (each exact)

| Change | File | Why the result is the same |
|---|---|---|
| `mergeWorlds` compares factor tables directly (`sameTable`: same size, same keys, masses `===`, NaN equal to NaN) and only between worlds of one discrete key; a single world returns at once | doubles-world | Two `factorKey` texts are equal exactly when the tables have the same key set and each mass prints the same, i.e. is the same number (0 and −0 print alike and are `===`; NaN prints alike). Which worlds merge, in which order, and every mixture's arithmetic (`m * entry.mass / total`, then the other's) are unchanged; a lone world was only ever pushed (dropped at mass ≤ 0, NaN kept, as before) |
| `RADIX ** index` read from a table (`radixPow`), digits read at precomputed indexes (`digitAt`), in `withHP`, `product`, `marginal`, `splitFactor`, `applyStep`, `canonicalJoin`, `dropBell`, `sideFaintedChance` | world, turn, spread | The table holds the same powers of two; every key is the same expression with the same operands, summed in the same order |
| `splitFactor` skips a slot whose HPs do not all have the same number of entries (`evenSupport`), for factors of up to four slots | doubles-world | The size test `own.size × others.size === size` passes only when the support is the full product, which gives every HP of the slot the same count; a skipped slot is one the size test would skip. Five places or more (keys past 2^53) and empty tables keep the old path |
| Two-slot factors split with arrays by HP (`splitPair`) | doubles-world | The same sums in table order, the same size and tolerance tests, the same tables in first-met order. The second slot reads the same two marginals (each a sum over the same entries in the same order), so it splits exactly when the first does; keys that are not two digits take the general path |
| `applyStep`: the outcomes' sides and conditions as ids per step (one id per distinct `sideKey` / field text), the child key as one number within bounds (else the parts' JSON texts: `childKey`), each row's `damageKey` once per step | doubles-turn | Two children are the same exactly when every part's JSON text was the same, as in the `JSON.stringify` array; the children keep their first-met order (one map). The search's node states, conditions and rows are not changed once made (no writer in the battle files) |
| `applyStep`: with at most four places, the extras' part of each key summed once per group | doubles-turn | Every key is below 2^48, so the integer sum is exact in any order: the same keys as `keyFor`. Five places keep `keyFor` |
| `turnStep`'s entry nodes kept by mode, `follow` and the attacker's HP (`entryNode`) | uses-to-ko | `node()` interns by a key that reads only those (`restKey` does not read the HPs), and nodes are never dropped, so the kept node is the one `node()` returns |
| `hits()` in turn mode: `loopInput` memoised on the node (`nodeLoopInput`) | uses-to-ko | `loopInput` reads the node's state (fixed once made, as the existing `walks` memo already relies on), the run, the case, the HP and the search's own fields; nothing writes the input. 1v1 keeps `loopInput` |
| `afterHitNode`'s turn-mode key a negative number within bounds (`turnHitKey`, 50 bits), else the old text; `Collector.to` with `landed` keyed by numbers | uses-to-ko | One key per tuple, equal only for equal tuples (1v1 keys are not negative); the collector returns its groups in the order made, as the map's values did |

Not done, because it would change bits: merging drain states before the full table is built, splitting the drain joint into
smaller factors, or scaling one transition by many masses. The masses are products and sums whose rounding depends on the
order of operations (each mixture merge rescales every entry, `scaled()` multiplies by the case's chance before the rolls'
weights, a split factor's later sums run over its marginal rather than over the joint), so any of these gives other last
bits, and the stored results carry those bits (`koChance`, `average`, the outcomes' chances).

## 3. Measurements

### The reproduction (battle 134)

**Engine calls of the battle, replayed** (`tools/ab.sh`: warm, the least of 5 rounds, the two bundles alternating three
times; every result's hash equal to the capture's in both). Main's own capture of the same battle (`caps/cap-134-main.json`,
247 calls; its turn 2 makes 105 calls, 18 of them not estimated) is replayed the same way.

| | Before | Now | Main |
|---|---|---|---|
| All calls (256; main 247) | 861–916 ms | 381–391 ms | 177 ms |
| Turn 2 (114 calls; main 105) | 741 ms | 285 ms | 82 ms |
| Turn 1 / turn 3 | 98 / 24 ms | 91 / 24 ms | — |
| Worst cell (#162: Matcha Gotcha, then Play Rough into Rough Skin) | 216–220 ms | 62–65 ms | (Matcha Gotcha's cells not estimated) |

**The decision in the battle** (`perf1b/repro.sh`: `int1a/one-battle.ts` in a fresh process per run, so the first turns run
cold; three rounds, main / before / now alternating; `perf1b/repro.log`):

| p2's decision | Main | Before | Now |
|---|---|---|---|
| Battle 134 turn 2 (INTEGRATION-1A's case) | 315–317 ms | 1030–1060 ms | 577–590 ms |
| Battle 134 turn 1 / turn 3 | 350–371 / 58–65 ms | 382–395 / 64–70 ms | 379–381 / 60–62 ms |
| Battle 126 turn 1 (the S01 team's other heavy turn) | 730–745 ms (another line of play) | 981–994 ms | 619–635 ms |

The turn-2 gap to main that remains is the cells main does not estimate (Matcha Gotcha's spread heal was a guard there).

### Ten more battles with the Matcha Gotcha teams

Battles 16, 17, 58, 66, 67, 104, 126, 135, 176 and 196 of `safe-maxdamage-open` (each with S01, V02 or V08, whose
Sinistcha has Matcha Gotcha), captured on this tree (3 612 calls in all) and replayed with both bundles: **0 hash mismatches
in either**. Engine time per battle (the least of 3 rounds):

| Battle | 16 | 17 | 58 | 66 | 67 | 104 | 126 | 135 | 176 | 196 | All |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before (ms) | 327 | 231 | 194 | 262 | 249 | 293 | 1007 | 287 | 175 | 342 | 3 367 |
| Now (ms) | 263 | 214 | 178 | 229 | 220 | 261 | 562 | 262 | 159 | 321 | 2 668 |
| Slowest call, before → now (ms) | 14.8 → 4.3 | 1.8 → 2.0 | 1.7 → 1.9 | 1.4 → 1.1 | 1.7 → 1.3 | 9.3 → 4.6 | 110.5 → 29.5 | 1.8 → 1.7 | 3.5 → 2.7 | 1.7 → 1.5 | |

The battles without a heavy cell gain 5–15 % (the merges, the splits and the keys are on every turn's path); the heavy cells
gain 3–4×.

### Bench (`perf1b/bench3.sh`: `int1a/bench-stored.ts`, 4 alternating rounds of main, before and now; `bench-paired3.mjs`)

```
benchH-1 turn p50 2.38 p95 5.81 max 124.9 | benchO-1 turn p50 2.83 p95 6.84 max 147.2 | benchN-1 turn p50 2.65 p95 6.76 max 124.1
benchH-2 turn p50 2.42 p95 6.07 max 120.5 | benchO-2 turn p50 2.76 p95 6.58 max 128.9 | benchN-2 turn p50 2.64 p95 6.42 max 117.2
benchH-3 turn p50 2.42 p95 6.02 max 121.7 | benchO-3 turn p50 2.73 p95 6.54 max 135.4 | benchN-3 turn p50 2.61 p95 6.39 max 117.7
benchH-4 turn p50 2.45 p95 6.10 max 124.5 | benchO-4 turn p50 2.80 p95 6.82 max 130.1 | benchN-4 turn p50 2.61 p95 6.47 max 119.7
statuses: main {"ready":1397,"not-estimated":134,"issues":4}; before and now {"ready":1454,"not-estimated":77,"issues":4}; reference 30/30 in every run
main → before: 1397 turns ready in both; main p50 2.28 p95 5.09 | before p50 2.57 p95 5.91 | per-turn ratio median 1.094 p10 0.984 p90 1.242
main → now:    1397 turns ready in both; main p50 2.28 p95 5.09 | now    p50 2.43 p95 5.79 | per-turn ratio median 1.040 p10 0.894 p90 1.174
before → now:  1454 turns ready in both; before p50 2.59 p95 5.92 | now  p50 2.47 p95 5.79 | per-turn ratio median 0.945 p10 0.839 p90 1.028
```
(H main, O before, N now; the paired rows take each turn's least time over the four rounds.)
- Over main, the median per-turn cost is now +4.0 % (1a: +9.4 % in the same runs); against the tree before, −5.5 %.
- The worst turn (`RS-RVP1`) is 117–124 ms (before 129–147, main 121–125).
- **Moves pane:** the bench times each of its 23 calls once, right after the turns, so its p50 moves by a millisecond between
  rounds (before 8.61–10.56, now 9.20–9.73, main 8.59–9.30). Timed warm (the same 23 calls, the least of 12 rounds, bundled
  against both engines, alternating) they are the same: before 71.7–74.3 ms in all, p50 2.89–3.03 ms; now 71.6–74.1 ms, p50
  2.92–3.02 ms. The pane's calls run no doubles world and no turn step.
- **1v1:** `golden-1v1 --check` bundled against both engines, alternating: before 2 373–2 408 ms, now 2 337–2 400 ms.

### The census sample, hashed (`perf1b/abhash.ts`, `abcmp.mjs`)

Every turn of census-sim.ts's sampler (int1a's budget probe draws, seed 7: 8 000 usage-weighted Champions turns and 2 000
Scarlet/Violet Random Battle Doubles turns; and seed 11: 4 000 + 1 000), through `calculateDoublesTurn` and, for Champions,
`calculateDoublesOutcomes`, each result's JSON hashed, on `engine-orig` and on this tree:

```
seed 7:  10000 turns: 10000 equal (turn and E2 hashes), 0 differ; sample mismatches 0
seed 11:  5000 turns:  5000 equal (turn and E2 hashes), 0 differ; sample mismatches 0
```
Timed back to back on a quiet machine (seed 7, `ab-s7-quiet.cmp`; each turn run once):

| | Before | Now |
|---|---|---|
| Turns: total / p50 / p99 / max | 39.1 s / 3.59 / 10.25 / 240.9 ms | 37.7 s / 3.54 / 9.56 / 96.2 ms |
| E2: total / p99 / max | 11.2 s / 5.66 / 219.7 ms | 10.3 s / 4.84 / 91.7 ms |
| The 417 spread-heal turns (Matcha Gotcha, Parabolic Charge, Draining Kiss), turn + E2: total / p95 / max | 3 974 ms / 18.8 / 460.7 ms | 3 124 ms / 14.3 / 187.9 ms |
| The other 9 583, turn + E2: total / p99 / max | 46.4 s / 12.7 / 53.5 ms | 44.9 s / 11.9 / 44.5 ms |

### T2E's budget probe (`perf1b/census/budget-probe.ts`, int1a's probe with its output folder moved)

`perf1b/census/budget.out`. Its output is **identical to int1a's** `census/budget.out` past the first line, and every one of
its 10 000 per-turn peaks (worlds, entries, calculations, end-of-turn worlds and entries, reruns, states, ties) is equal
(`tier2-eot-training-probes-3.out.json`):

| | Integration 1a | Now |
|---|---|---|
| `Too many cases to follow.` (Champions turn, end, E2; SV turn, end) | 0, 0, 0; 0, 0 | 0, 0, 0; 0, 0 |
| Champions worlds, entries (max) | 26, 24 870 | 26, 24 870 |
| SV worlds, entries (max) | 12, 14 460 | 12, 14 460 |
| Calculations (max of 160): Champions, SV | 58, 20 | 58, 20 |
| Spread heal (C12 joint): ready turns, worst world-state load | 350, 0.1244 (×20 over on 2) | 350, 0.1244 (×20 over on 2) |
| Headroom for a landing's 16 rolls (end-of-turn entries ×16 over 200 000) | Champions 2, SV 1 | Champions 2, SV 1 |
| Wall time of the probe | 69 s | 43 s |

The entries cannot fall in an exact pass: a world's tables are the arithmetic (§2's last paragraph), so the same masses in
the same order are the same entries. This pass makes each entry cheaper, not fewer.

### Training's gates (`perf1b/training-gates.sh`, seeds of `s1-step1`, as 1a ran them)

`perf1b/eval.log` (`eval-ai.ts --gates --scale 1 --shards 8 --run s1-step1`, moved to `scripts/.cache/training/eval/perf1b-s1seeds`;
Step 1's `s1-step1` put back). **Every line but the times is identical to int1a's `eval.log`** (win rates, intervals, budgets,
cells, legality, held and chosen status moves, Mega shares, determinism 20/20): the same decisions on the same seeds.

| Turn decision time (Node, worst run) | p50 | p95 | max |
|---|---|---|---|
| Main (int1a's run of main's seeds) | 274 ms | 577 ms | 1 181 ms |
| Integration 1a | 303 ms | 675 ms | 1 837 ms |
| **Now** | **267 ms** | **592 ms** | **1 273 ms** |

The gate is p50 ≤ 400, p95 ≤ 800, max ≤ 2 000: PASS, with 727 ms of headroom at the max (1a: 163 ms). The other gates are
1a's: 20 PASS, and the same 2 FAIL as main (HabitBot `2.8 pts [-1.4, 6.9]`; A1.4, Rage Powder never chosen). Preview /
replacement 68 ms / 8.40 ms; belief closed 18 ms, open 6.98 ms.

`perf1b/conformance.log`: every gated row as int1a's (tracker 840/840, belief 297/297, bridge 0 over 400, clean rollouts
56527/56527 over 2936/3000 cells, splits 33.7 / 35.0 / 25.1 %, choice strings 23737/23785, census 0, E2 vs Showdown 1592/1592,
saved battles 30/30, Resume 30/30, Illusion and Transform 6/6). The one other difference is "largest record 46 KB" (1a 47 KB):
a saved battle's log holds each decision's `elapsedMs`, and shorter times print in fewer digits. `leak:training` was not run
(no change reaches what Training reads; its unit rows are in `npm run check`).

## 4. Gates

- **Stored app results:** `step0a-run-app.ts` into a scratch folder, then `step0a-diff-app.mjs` against the same run before
  the pass: `1939/1939 byte-equal (ms removed); differ: 0; missing: 0; extra: 0`. Against `2v2/verify/app-results`:
  `1939/1944 byte-equal (ms removed); differ: 0; missing: 5` (E40-BoosterEnergy, E40-IcicleSpear-OccaBerry, ER16e, SA05,
  SA13: stored files of cases no longer in the case list; the same before the pass). No stored case changed, so
  `changed-cases.ts` has nothing new to list.
- **compare.ts:** `STATUS2_REEXPECT=1a compare.ts --no-write`: `1928/1939 cases match.` The same 11 as 1a (CR-08a/b/c-sv,
  G4-OPP-07-sv, SAT-IMP-1-sv/swsh, G4-STF-02-usum, G4-FLG-09-sv, G4-LMV-01/02, G4-ENC-01-sv); `perf1b/compare.log`.
- **golden-1v1 --check:** `golden-1v1: 254 cases byte-equal`.
- **npm run check** (`perf1b/check.log`): lint clean, typecheck clean,
  `Test Files  248 passed (248)` / `Tests  7003 passed | 1 skipped (7004)`.
- **test:battle-data:source:** `Test Files  10 passed (10)` / `Tests  149 passed (149)`.
- **Training captures:** 3 868 `calculateDoublesOutcomes` calls (battle 134 and the ten above) hash-equal on both engines.
- **The census sample:** 15 000 turns hash-equal (turn and E2) on both engines.

## 5. Open (for wave 1b)

1. **The ×16 landing on a spread-heal joint** (INTEGRATION-1A §4 item 5) is unchanged by an exact pass: 2 Champions turns and
   1 SV turn of the sample would cross 200 000 entries if a landing's 16 rolls multiplied their largest world (24 870 and
   14 460 entries). Each entry is cheaper now (the worst sample turn runs in under half the time), so for E2 the question is
   the budget, not the time: the readers rule on these turns, or `Too many cases to follow.` there, as SPEC2 risk 5 has it.
2. **What is left in the heavy cells** is the work on the joint itself: `applyStep`'s child tables, `turnStep`'s per-call
   setup (one call per pair of the other HPs, 657 in #162), the splits of 3- and 4-slot children and the mixture merges. Each
   is order-dependent arithmetic, so a further cut must keep every mass's operations. Running the per-group steps as lanes of
   one shared walk of the hits would, but that rewrites uses-to-ko.ts's hit loop, past this pass.
3. **An edge kept as it was:** a factor of four Pokémon plus Shell Bell's running sum has keys past 2^53, where digits need
   not decompose exactly. This pass leaves that path's arithmetic as it was (the new shortcuts stop at four places). It is
   reachable only with a Shell Bell spread move that hits three Pokémon whose HPs are already joined with the user's.
4. **Wave 1b's frozen files:** none of this pass's lines is a hook or a kernel member, and no signature changed;
   `kernel.sideKey` is the same function. The 1b tracks' anchors in the four files may need re-finding (`perf1b/diff/`).
