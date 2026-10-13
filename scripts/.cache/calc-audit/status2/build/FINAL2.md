# FINAL2: status2 final gate (2v2 status moves part 2 and the remaining guards, after both review rounds)

Branch `calc-2v2-status-2`, HEAD 6c1ca23 (the last WIP checkpoint), with one uncommitted two-file fix made at this gate (§3.4).
Ground truth: pinned Pokémon Showdown c23d2e94. ADDENDUM2 §8.8's final gate ran as three agents in turn: the code gates
(12 Oct 21:40–23:00 UTC), the Training gates (23:04–04:35), and this write-up, which first re-ran the cheap code gates on the
final tree (13 Oct 04:39–04:50). "main" means 4008ee8, a detached worktree at `$SP/maintree` run through
`TSX_TSCONFIG_PATH`. "1b" means the tree INTEGRATION-1B.md left. "Integration 2" means INTEGRATION-2.md's tree (3938e5a).
"Round 1" and "round 2" mean REVIEW2-FIX-1.md and REVIEW2-FIX-2.md. `$SP` is the session scratchpad,
`/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad`. The logs are in `$SP/final/logs/`
(code and Training gates) and `$SP/final2/logs/` (this write-up's re-run). The gate scripts are in `build/final2/`.

## Status

- **Branch and HEAD:** `calc-2v2-status-2` at 6c1ca23, checked at the start and at the end by each of the three agents.
- **Working tree:** `git status --short` shows only ` M vitest.unit.config.ts` and `?? tests/unit/vitest-unit-groups.test.ts`,
  the gate's test-configuration fix (§3.4). No app file changed at this gate. The Training agent hashed the 1025 files under
  `app/`, `scripts/training/`, `tests/` and `lib/` before and after its gates: byte-equal. The re-run's `git status` and the two
  files' sha256 were the same at its start and end.
- **What did not happen:** nothing was committed, pushed, switched or merged. No stub was touched: all 20 sha256 are unchanged
  at every agent's start and end, and each file still begins with `// CLOUD-SESSION STUB`. Nothing was written to `.claude/`,
  and nothing to `node_modules` except vitest's own results cache. No CastMirror or RaidCard file was touched. No `next build`
  ran, nothing ran against live Supabase, no seed script ran, and no credentials were typed. `design/census-sim.out.json` was
  put back after the census run (sha256 01e7a49f…, main's baseline).
- **Main has moved.** The local and remote `main` are at 9a3115e, 10 commits after 4008ee8 (CastMirror PRs #23 to #27,
  10–11 Oct). Those commits touch 26 files, none of the 159 files this branch changes. Every comparison in this file is against
  4008ee8, as the spec says. The merge result has not been checked (§5).
- **Missing files and coverage.** This cloud tree lacks gitignored folders that were never pushed from the user's machine:
  - The 20 case files of `2v2/fix-engine`, `2v2/review-engine`, `2v2/fainted-engine`, `zmove-status`, `serene-arceus`,
    `forms-iceface-fling`, `ngas-pp` and `status-eot/{fix-engine,verify-engine,review,build/verify-eot-probes}` are empty stubs
    (`$SP/stubs/list.txt`).
  - **544 stored oracle ids cannot load** (`$SP/missing-ids.txt`). The oracle, changed-cases and the regeneration did not run
    them. Every oracle count below is 2314: the 1769 stored cases that load, plus 176 wave 2 cases and 369 review cases.
  - Those 544 ids have 282 rows in `tests/unit/doubles-turn-showdown.test.ts`. The rows are kept byte for byte, and they pass.
  - Also missing: `verify/v1/fixtures`, `v3/gen`, `v3/gen-r`, `v3/logs`, `v3/tools`, `v3/tsc`, `v3/app-hz`, F's
    `fling/golden-before` baseline and `fling/golden-diff.ts`, and most of `status2/build/int1b`. Four harness tests fail on
    these files only (§3.7).
  - `node_modules/.cache/champions` lacks the compiled pinned dex and the damage-calc source archive. So
    `npm run test:battle-data:source` runs 8 of its 11 files (63 tests) only through a scratch source cache. The other 3 files
    (91 tests) cannot run (§3.5).
  - The container has 4 CPUs. eval's three absolute time rows cannot pass on it, for main either. The decision time is
    therefore measured against main and scaled to the reference machine (§4).
  - The signed-in 2v2 calculator was not checked live. The layout check is static renders only (§3.10).

## Gates (exact output lines; final tree)

"Then" gives the same gate at 1b, integration 2 or round 2, and main where it applies. Every log named is in
`$SP/final/logs/` unless it says `final2/`.

| # | Gate | Command | Output | Then | Status |
|---|---|---|---|---|---|
| 1 | Types (re-run) | `npx tsc --noEmit` | no output, `EXIT 0` (`final2/tsc.log`) | — | pass |
| 2 | Lint, types, unit tests, tree as found | `npm run check` (twice) | `FAIL  \|unit\| tests/unit/calculator-uses-to-ko.test.ts … Error: Hook timed out in 10000ms.` / `Test Files  1 failed \| 260 passed (261)` / `Tests  8345 passed \| 70 skipped (8415)` / `EXIT 1` | round 2: `261 passed (261)` / `8414 passed \| 1 skipped (8415)` | **fail: fixed (§3.4)** |
| 2' | Lint, types, unit tests, after the fix | `npm run check` (code gates twice; re-run once) | `Test Files  262 passed (262)` / `Tests  8415 passed \| 1 skipped (8416)` / `EXIT 0` (7m9.4s, 7m8.3s); re-run the same two lines, `EXIT 0` (8m22.6s, `final2/check.log`) | 1b 255 / 7699; integration 2 261 / 8010 | pass |
| 3 | Oracle, every case that loads | `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts` | `2314/2314 cases match.` (code gates; re-run the same, `final2/compare.log`) | 1b `2331/2331`; integration 2 `1945/1945`; round 2 `2314/2314` | pass (544 stub ids not run) |
| 4 | Wave 2 and review cases, v3 runner | `v3/run.ts --wave2 --quiet`, with and without `STATUS2_REEXPECT=1a,1b` | `545/545 cases match.` (both) | integration 2 `176/176` | pass |
| 5 | changed-cases against the pre-review set | `changed-cases.ts diff $SP/reviews/FIX-r1/app-results-before …/app-results --wave=all` | `2314 cases: 1942 unchanged, 2 stored cases changed, 0 failing the gate.` (code gates; re-run the same) | — | pass |
| 6 | changed-cases against 1b's app results | the same against `origin/wip/status2-cache`'s `app-results` | `2314 cases: 1766 unchanged, 3 stored cases changed, 0 failing the gate.` | — | pass |
| 7 | changed-cases against the set before this gate's compare | the same against `$SP/final/app-results-before` and `$SP/final2/app-results-pre` | `2314 cases: 2314 unchanged, 0 stored cases changed, 0 failing the gate.` (both); app-diff-facts `2881 files: 0 changed, 0 new` | — | pass |
| 8 | Generated Showdown test | `STATUS2_REEXPECT=1a,1b … gen-tests.ts --keep-rows=tests/unit/doubles-turn-showdown.test.ts --out=<scratch>`, `cmp`, vitest | `keep-rows: 2489 rows before, 282 kept as they were (their case does not load), 0 new`; byte-equal (sha256 117f4f00…); `Tests  2489 passed (2489)` (code gates and re-run) | 1b 1985 rows; integration 2 2157 | pass |
| 9 | 1v1 golden | `golden-1v1.ts --check` | `golden-1v1: 254 cases byte-equal (8002 ms)`; re-run `(8485 ms)` | the same at every step | pass |
| 10 | 1v1 rows against main | `golden-1v1.ts` in scratch for main and now, `int2/golden-rowdiff.mjs` | `254 cases, 18152 rows compared: 110 rows differ (110 Fling rows, 0 other rows); 0 other differences` | the same 110 rows as integration 2 | pass |
| 11 | Source tests in place | `npm run test:battle-data:source` | `Test Files  9 failed \| 2 passed (11)` / `Tests  30 passed \| 91 skipped (121)` | 1b `11 passed (11)` / `153 passed (153)`; integration 2 as now | not run (environment) |
| 11' | Source tests, scratch source cache | `SOURCE_CACHE=$SP/int2/srccache npx vitest run --config …/int2/vitest.source-overlay.config.mts` | `Test Files  3 failed \| 8 passed (11)` / `Tests  63 passed \| 91 skipped (154)`; the 8 alone `Tests  63 passed (63)` | integration 2 the same | pass for 8 of 11 files |
| 12 | Oracle harness tests | `npx vitest run --config …/verify/{v1,v2,v3}/vitest.*.config.mts` | v1 `Tests  2 failed \| 16 passed (18)`; v2 `1 failed \| 25 passed (26)`; v3 `1 failed \| 24 passed (25)` | integration 2 and both rounds the same | pass (stub failures only) |
| 13 | Bench, cross-process, 4 rounds | `build/final2/bench.sh 4` | per-turn ratio median `1.159`, `1.088`, `1.083`, `1.096`; now turn p50 7.43–7.99 ms, p95 16.98–18.09, max 44.6–50.8 (targets 30 / 120 / 400); `reference 30/30` | integration 2 1.056–1.231 | pass |
| 14 | Bench, in process | `int2/paired-ab.ts <tree> 5` | main `per-turn ratio median 1.091`; 1b's engine `1.013`; integration 2's engine `0.997` | integration 2: main 1.078, 1b 0.991 | pass |
| 15 | Census sample, no bench | `build/final2/census/run.sh` (`census-sim.ts --n=8000 --sv=2000 --seed=7`) | Champions `not estimated 609 (7.61 %)`; SV `not estimated 156 (7.80 %)` | main 14.16 % / 11.15 %; integration 2 the same as now | pass |
| 16 | Census sample with a bench | `census-bench.ts --n=8000 --sv=2000 --seed=7` | `Champions bench: 8000 turns, ready 7740, not estimated 260 (3.25 %)`; `SV bench: 2000 turns, ready 1901, not estimated 1 (0.05 %)` | integration 2 the same | pass |
| 17 | Budget probe | `build/final2/census/budget-probe.ts` (plain and `--bench`) | `"Too many cases to follow." today: turn 0, end of turn 0, E2 0`; calculations max 58 (Champions), 46 (SV, bench) of 160 | integration 2 the same maxima | pass |
| 18 | Static layout, 375 px and 1280 px | `render.config.mts`, `check-layout.mjs` | `11 pages × 2 widths: every check passes` | integration 2: 9 pages | pass (static only) |
| 19 | Training conformance | `npm run conformance:training` | every row PASS; 4b `57310/57310 (100.00%) over 2994/3000 engine cells`; 8 `Tests  2493 passed (2493)`; `EXIT 0` | integration 2 every row PASS, check 8 2161 | pass |
| 20 | Training leak | `npm run leak:training` | all 15 rows PASS; `0 hits in 516 messages over 40 battles` | integration 2 all PASS (511 messages) | pass |
| 21 | Training eval, main's seeds | `npm run eval:training -- --gates --scale 1 --shards 8 --run s1-step1` | 18 PASS, 4 FAIL: HabitBot `3.3 pts [-0.7, 7.2] n=400`, and the three time rows | integration 2 the same 18 / 4, every battle hash equal; main's HabitBot 4.0 | pass with note (§3.11) |
| 22 | Decision time, quiet, paired with main | `build/final2/training/eval-quiet-*.sh` | worst-run p95 now/main `median ×1.106` → `scaled 638 ms (range 617–720)` against SPEC2's 634 and the gate's 800 | integration 2 650–675 ms | 800 holds; 634 not settled (§4) |
| 23 | T2 fuzz | `t2-fuzz.ts 60 101`, `t2-fuzz-all.ts 60 101` | `"mismatches": 188` (every one a ` pp: ` note), `"issues": 0`, `"notEstimated": 24` | round 2 the same | pass |
| 24 | R-T fuzz | `rt-fuzz.ts 60` and `60 101` | `"mismatches": 0`, `"issues": 0`, `"policyIssues": 0` (both seeds) | rounds 1 and 2 the same | pass |

## 1. What status2 delivers

### The request and the decisions

The user asked to **"do 3 and 4"**:
- **3:** model the 73 status moves that the 2v2 turn still left "not estimated".
- **4:** remove the remaining narrow "not estimated" guards: Eject Pack switching out mid-turn, Opportunist and Mirror Herb
  copying a stat rise, Harvest and Pickup, Stored Power, Power Trip and Punishment after an accuracy or evasion change, Fling,
  one-hit KO moves, spread heals, and the rest of FINAL.md's open list.

The user's answers (`design/USER-DECISIONS.md`, final):
- **Q1 = R:** switch-outs are modelled with a replacement, in the calculator (a Bench per side, a Replacement pick, Hazards)
  and in Training (its real bench).
- **Q2 = "those plus more":** SPEC2's three controls, the alternative's controls, and every further earlier-turn input a
  Tier 2 entry needs.
- **Q6:** the other census guards (about 56) are in this build, each modelled or kept with a narrow, exact reason and a
  written justification.
- **Q5 = later:** Neutralizing Gas with the eight ability-changing moves, and Neutralizing Gas ending, keep their texts.

Taken with SPEC2's defaults (consistent with the house rules): Q3 Last move Unknown; Q4 Item used earlier Unknown; Q7 no new
Training weights; Q8 Imposter transformed as entered; Q9 the player's replacement is the healthiest bench Pokémon; Q10
`{Move} needs {Name}'s gender.`; Q11 Conversion's first quick move, stated; Q12 a once-a-battle ability gained mid-turn,
stated; Q13 Electrify and Ion Deluge on self-typing, Z and Max moves modelled where exact.

### What is now modelled, by family

Every number is exact against pinned Showdown in each game where the mechanic exists (sv, champions, swsh, usum). Otherwise
the turn, or only its end, is "not estimated" with a one-line fact. Each part's notes in `build/` give the detail.

| Family (owner) | Modelled now | Still a reason (kept, §1's last table) |
|---|---|---|
| Step 1's correctness fixes (16; STEP1.md) | The silent wrong numbers on main: ally-target Defiant, Competitive and Opportunist in the pairwise step; a Champions Sheer Force hit and the Berserk lock; Color Change; Trace's facts; the Ghost Curse cost; the Comatose order; Rapid Spin and Mortal Spin hazards and a Safeguard set this turn in Training; Training's accuracy and evasion stages; Unburden at the first Update; crash damage; the earlier-this-turn flags (C19); Burning Jealousy and Alluring Voice; Spectral Thief; a switched-in Pokémon takes no action in Training; Training's prelude ties; Cud Chew carried | — |
| The 73 status moves (A1, A2, A3; SPEC2 §2.2) | No move is left unmodelled: 56 exact (M) and 17 exact under a condition (C). A1: Acupressure, Psych Up, the swaps and splits, Power Trick and Power Shift, Topsy-Turvy, Stockpile, Swallow and Spit Up, Tidy Up, No Retreat, Autotomize, Minimize, Geomancy, Gear Up, Magnetic Flux, Flower Shield, Rototiller; Skill Swap, Role Play, Entrainment, Simple Beam, Worry Seed, Gastro Acid, Doodle, Transform. A2: Soak, Magic Powder, Forest's Curse, Trick-or-Treat, Reflect Type, Camouflage, Tar Shot, Foresight, Odor Sleuth, Miracle Eye, Telekinesis, Embargo, Heal Block, Nightmare, Octolock, Powder; Conversion, Conversion 2, Electrify, Ion Deluge, Attract, Captivate. A3: Magic Coat, Snatch, Crafty Shield, Mat Block, Lucky Chant, Mist, Mud Sport, Water Sport, Wonder Room, Magic Room, Court Change, Defog, Corrosive Gas, Bestow, Recycle, Teatime, Stuff Cheeks, Aromatherapy, Heal Bell, Purify, Psycho Shift | the C moves' narrow facts: an unknown last move (Q3), an unknown earlier item (Q4), a missing gender (Q10), Conversion with no moves given, A1's `{Ability} starting on {Name} is not modelled in 2v2.` for the Starts it lists (`Simple Beam giving Simple` in Champions), Q5's gas texts |
| The guards the user named (D, E, F, wave 2) | Opportunist and Mirror Herb (a stage ledger with amounts); Harvest and Pickup (item history, in Speed order); Stored Power, Power Trip and Punishment with accuracy and evasion stages; Fling (the verified 1v1 fix, its 2v2 effects, Symbiosis after a Fling); one-hit KO moves (a fixed full-HP hit with every immunity); spread heals (Matcha Gotcha, Parabolic Charge, Shell Bell: drains in hit order); Eject Pack mid-turn (the replacement) | Harvest while its earlier item is Unknown (Q4) |
| Tier 2 census guards (Q6; ADDENDUM2 §0 item 2 and §2.3) | 47 entries wholly and 4 but for one named part. Wave 1a: H (the semi-invulnerable turn, Sky Drop, Gravity and Smack Down landing), S (Disguise and Ice Face against multi-hit moves and Parental Bond, hits behind a Substitute, a face's self-hit), W (ally effects, Focus Band, a Berry between hits, Sparkling Aria after a faint, USUM's Gale Wings, Assurance with its own HP, Safeguard against a damaging move's status), N (the redirect tie with the entry order, the stall roll), A3 (the Seeds and Room Service received). Wave 1b: K (spread effects and a spread contact knock-out, Unnerve, Cotton Down, Flower Veil, Pastel Veil, Battle Bond, Aftermath, Innards Out, Receiver, Power of Alchemy, Core Enforcer), M (G-Max effects, Max Guard, Pain Split with Dynamax), PR (Commander, Poison Puppeteer, Dancer, Spotlight, Round, Beak Blast, Shell Trap, Beat Up, the Fusion moves, Counter, Mirror Coat, Metal Burst, Comeuppance, Flame Burst, the Pledges, the history rows: Present, Magnitude, Pursuit, Retaliate, Fury Cutter, Rollout, Ice Ball, Echoed Voice, Trump Card, a carried Bide), CL (Nature Power, Copycat, Mirror Move, Me First, Instruct, Sleep Talk, Uproar waking a sleeper, Helping Hand twice; Assist in wave 2), ST (Custap start variants, Trace 1/k as entered, two Pokémon acting at the start, Download), FC (a field change at every trigger, the wind abilities, Room Service), E2 (Future Sight and Doom Desire landings, Cud Chew, Moody in E2, G-Max damage over time, Zen Mode, Shields Down, Schooling), T2 (Training: Magic Room's end, Safeguard, Mist, Lucky Chant, recharge, Struggle, Fake Out, Payback and Analytic) | the 4 named parts, each justified in ADDENDUM2 §2.3: Metronome (a pick over 553–607 moves, beyond the 160-calculation budget), Booster Energy received by Trick, Power Construct (its maximum HP changes in some outcomes), a field change between two hits of one move; Q5's 2 entries; and 5 kept entries: Dragon Darts aimed at its own user, needs-moves, the 1v1 row-engine limits, the two budget texts |
| Earlier-turn inputs (Q2; NU, U1, U2, T1, T2) | The calculator's 2v2 controls, each shown only where the turn reads it: Stockpile layers, Last move, Item used earlier, the type controls, Infatuated by, Heal Block turns left, accuracy and evasion stages, Berry locked, Mist, Lucky Chant, the Sports, protecting moves in a row, Switched in, a charge from last turn, the field ends. Training fills every one from public lines only | Last move and Item used earlier while Unknown (Q3, Q4) |
| Switch-outs with a replacement (wave 2: R-U, R-E, R-T, R-V; INTEGRATION-2) | The calculator's Bench, Replacement and Hazards; the self-switch moves (the U-turn family, Parting Shot, Baton Pass, Shed Tail), the drags (Roar and its kin, Red Card), Eject Button, Eject Pack, Emergency Exit and Wimp Out; the entry pipeline (hazards, entry abilities and items in Speed order, Imposter, Neutralizing Gas's stand-in); Pursuit at a switching target; Beat Up and Assist from the bench; the end of turn and E2 with benched Pokémon; Training's real bench and replacement policy | `{Name} switches out: the replacement is not known.` only for a side with no Bench; Commander beside a Dondozo; a newcomer with Neutralizing Gas; a newcomer's form-changing Start |
| The review rounds (§2) | 61 confirmed findings fixed: 36 in round 1 and 25 in round 2; 369 oracle cases stored | 10 narrow reasons kept inside modelled families (§2) |

### The not-estimated share, main → final

From `$SP/final/logs/census-diff.out` (census-sim's 8000 Champions turns, usage-weighted, and 2000 SV turns from Random
Battle Doubles sets; seed 7). census-sim gives no bench, so its switch reasons are the calculator's fact for a side without a
Bench. The 1b figures come from INTEGRATION-1B's table, because its census JSON is not in this checkout.

| Sample | main | 1a | 1b | integration 2 | final |
|---|---|---|---|---|---|
| Champions ready | 6867 | 7296 | 7391 | 7391 | 7391 |
| Champions not estimated | 1133 (14.16 %) | 704 (8.80 %) | 609 (7.61 %) | 609 (7.61 %) | **609 (7.61 %)** |
| Champions end of turn not estimated | 252 | 233 | 235 | 235 | 235 |
| SV ready | 1679 | 1712 | 1746 | 1746 | 1746 |
| SV not estimated | 223 (11.15 %) | 190 (9.50 %) | 156 (7.80 %) | 156 (7.80 %) | **156 (7.80 %)** |
| SV end of turn not estimated | 80 | 81 | 45 | 45 | 45 |

With 2 bench Pokémon per side (`census-bench.ts`, the same turns, the bench from a second random stream): Champions
`ready 7740, not estimated 260 (3.25 %), end not estimated 0`; SV `ready 1901, not estimated 1 (0.05 %), end not estimated
17`. The hazards run (Stealth Rock and 1 Spikes layer on both sides) gives the same counts. Issues: Champions 0; SV 98 in
every run, as on main (the sampler's sets: Terastal-only forms and prepared moves).

Reason families gone since main (turn reasons, Champions + SV): Matcha Gotcha's heal 269 + 9, Protean 54, Armor Tail and
Queenly Majesty against an ally 25 + 4, Trace 31 → 9 (the 9 left copy a random foe), Roost 16, the semi-invulnerable turn
13 + 11, Imposter 12, Poison Puppeteer 12, Round 11, Unnerve 11, the spread effects from more than one target 29 + 10,
Parabolic Charge and Heat Wave's heal 9, Psychic Noise 8, Instruct 7, Fling 6, one-hit KO 6, Aftermath 5, Glaive Rush 4,
Fusion Bolt and Fusion Flare 4, Innards Out 3, Disguise 3, Flower Veil 2, Burn Up and Double Shock 2, Battle Bond 1, Mirror
Coat 1, and every status move that "comes before another move" (Skill Swap 8, Psych Up 6, Minimize 5, Worry Seed 5,
Entrainment 3, No Retreat 3, Speed Swap 3, Stockpile 3, Soak 2, Reflect Type 1). `Beat Up is not modelled in 2v2.` 8 became
the row's `Beat Up: party needed.` 8 (ready with a bench). End-of-turn reasons gone: the status moves' 30, Shields Down
changing form 36, and Harvest "not modelled" 14 (now the Q4 input text). The switch reason grew (Champions 336 → 349) where a
reason that came first is gone.

### The reasons that stay, with "Kept as"

| Reason (family) | Champions | SV | Kept as |
|---|---|---|---|
| `{Name} switches out: the replacement is not known.` | 349 (end of turn 235) without a bench; 0 with one | 156 (end 31); 0 | the calculator's fact for a side with no Bench (STEP2 hook map item 5); census-sim gives none |
| `Encore needs {Name}'s move from the last turn.` / `Disable needs …` | 206 / 24 (207 / 24 with a bench) | 0 | needsLastMove: the Last move input is Unknown (Q3) |
| `Imprison needs {Name}'s moves.` | 12 | 0 | needsMoves (#46): the moves are not given |
| `Trace copies a random foe's ability.` | 9 | 0 | #40: the copy is random between two foes with different abilities |
| `Beat Up: party needed.` | 8 without a bench; 0 with one | 0 | the row's needs-context text while the party is Unknown |
| `Friend Guard with 2 other damage modifiers: not calculated …` | 1 | 0 | #44: the 1v1 row engine's limits (1v1 stays byte-equal) |
| `Harvest needs {Name}'s item from an earlier turn.` (end of turn) | 0 | 14 (17 with a bench) | Q4: Item used earlier is Unknown |
| `Simple Beam giving Simple is not modelled in 2v2.` | 3 with a bench | 0 | A1's guard: the Champions data has no Simple (W1A-A1) |
| `Beat Up with {Name}'s hit first is not modelled in 2v2.` | 3 with a bench | 0 | PR's: count-moves puts the user's hit first |
| `Beat Up into Colbur Berry: not calculated.` | 1 with a bench | 0 | count-moves' row limit (in the docs) |
| `Shields Down starting on {Name} is not modelled in 2v2.` | 0 | 1 with a bench | A1's Start guard reached by a newcomer (INTEGRATION-2 open item 7) |

No reason in any run names a position; `Too many cases to follow.` is 0 in every mode. Every other kept reason (Q5's gas
texts, wave 2's narrow newcomer reasons, the review rounds' 10 narrow reasons in §2) has 0 turns in the sample.

## 2. The reviews (ADDENDUM2 §8.8)

Seven reviewers, each with §9's cross-family checklist and a verifier, then one fixer; two rounds, the most allowed. Every
finding was confirmed by its verifier, and again by the fixer's probes, before the fix; none was wrong on closer reading. Every
fix has a regression test (round 1 checked each against the pre-fix sources, where they fail), and every fix whose turn
Showdown can hold has oracle cases in `verify/cases-review2.ts` (owner "review2 fixer", ids `RV2-…`); R6-4, R6-5, R6-6 and
R7-3 have none (a UI list, a state Showdown cannot hold, the apply action checked by the reviewers' probes, an app-only
refusal). The fixers' notes are
REVIEW2-FIX-1.md (round 1: passes A to D and a final pass) and REVIEW2-FIX-2.md (round 2). The reviewers' round 1 reports are
`build/REVIEW2-R*-r1.md`; their round 2 probes are in `$SP/reviews/R*-r2*/`.

| Lens (ADDENDUM2 §8.8) | Round 1: blocking / should / minor | Round 2: blocking / should / minor |
|---|---|---|
| R1-A1-K (A1 with K) | 3 / 2 / 0 | 2 / 0 / 0 |
| R2-A2A3-H (A2, A3 with H) | 2 / 0 / 0 | 1 / 0 / 0 |
| R3-DE-F (D, E1, E2 with F) | 4 / 2 / 0 | 5 / 2 / 1 |
| R4-SW-M (S, W with M) | 5 / 1 / 0 | 1 / 1 / 0 |
| R5-PRCLST-FC (PR, CL, ST with FC) | 5 / 2 / 0 | 5 / 1 / 1 |
| R6-NNU-U (N, NU with U1, U2) | 0 / 6 / 1 | 0 / 2 / 2 |
| R7-T-R (T1, T2 with R) | 3 / 0 / 0 | 0 / 1 / 0 |
| **Total** | **22 / 13 / 1 = 36** | **14 / 7 / 4 = 25** |

Round 1 by kind: 22 wrong numbers, 8 needless reasons, 3 missing reasons, 1 text, 1 hidden information (the 2v2 note), 1
other. Stored cases: round 1 231 (110 + 35 + 44 + 31 + 11 by pass), round 2 138, so 369 in all, 37 of them as not estimated
with their reason. Every estimated one was run in the exhaustive oracle first; `sim-dfs.ts --validate` gave `equal to N
whole-turn replays` for all three walks of all but 7, whose replay walk passes its cap (four Sleep Talk cases, Teeter Dance,
and two Spotlight cases); their stored results are the exhaustive DFS oracle's, which the app matches.

### Round 1 (36 findings)

| Id | Severity | Outcome |
|---|---|---|
| R1-A1K-01 | blocking | fixed: Ability Shield works under Klutz (not under Magic Room or Embargo) |
| R1-A1K-02 | blocking | fixed: Receiver and Power of Alchemy inside a Mold Breaker or Teravolt move take its breaker (round 2 R2-A1K-01/02 completed it) |
| R1-A1K-03 | blocking | fixed: Pastel Veil's onAnySwitchIn cures a poisoned newcomer |
| R1-A1K-04 | should | fixed: the Transform-into-Dynamax reason removed |
| R1-A1K-05 | should | fixed: a spread move's Aftermath and Innards Out loss joins the first loss group |
| R2-A2A3-H-1 | blocking | fixed: Defog clears the target's and the user's sides only |
| R2-A2A3-H-2 | blocking | fixed: a party cure reaches the bench and a newcomer from it |
| R3-1 | blocking | fixed: the turn-start settle keeps a carried Berserk lock's Berry |
| R3-2 | blocking | fixed; two narrow reasons kept (Magician; Thief or Covet that a Rough Skin or Iron Barbs loss could knock out first; round 2 R3DEF-R2-7 narrowed Magician) |
| R3-3 | blocking | fixed with a fact reason: `Starf Berry between the hits of Double Kick is not modelled in 2v2.` |
| R3-4 | blocking | fixed with a fact reason: `Fissure with Parental Bond is not modelled in 2v2.` (narrowed in round 2, R3DEF-R2-8) |
| R3-5 | should | fixed: the flung Custap reason removed |
| R3-6 | should | fixed: the Encore reason only where the kept priority or Prankster flag is read |
| R4-1 | blocking | fixed: a spread move probes the attacker's HP from the first target whose calculation reads it |
| R4-2 | blocking | fixed with a fact reason: `G-Max Finale with Cramorant-Gulping's Gulp Missile is not modelled in 2v2.` |
| R4-3 | blocking | fixed with a fact reason at a ±6 cap; replaced in round 2 by R4-r2-1's order replay |
| R4-4 | blocking | fixed: a called move has its caller's priority |
| R4-5 | blocking | fixed: a face hit's calculation reads the attacker's HP |
| R4-6 | should | fixed: the continuation reads the damage dealt for recoil and Shell Bell |
| R5-1 | blocking | fixed: Dancer aims at the dance's target when a Substitute took the hit |
| R5-2 | blocking | fixed: a dance's success is marked as its effect applies |
| R5-3 | blocking | fixed this turn; an earlier turn's lock keeps `Dancer needs whether Oricorio is locked into a move by Choice Scarf.` |
| R5-4 | blocking | fixed: Instruct reads the PP spent this turn, Pressure included |
| R5-5 | blocking | fixed: a strong weather its holder's faint ends stays ended (pre-existing on main) |
| R5-6 | should | fixed: callingGuard reads each caller's own pool |
| R5-7 | should | fixed: a called Instruct is handled |
| R6-1 | should | fixed: Conversion 2's Last move control is on its target |
| R6-2 | should | fixed: the moves another action reads are passed |
| R6-3 | should | fixed: an instructed or Sleep Talk-called protecting move reads the counter, with `Assumes no protecting move was used last turn.`; the called Instruct part was finished in round 2 (R6-r2-2) |
| R6-4 | should | fixed: the 2v2 "Battle states that cannot be set here" note keeps grounding and the stat splits per game |
| R6-5 | minor | fixed: Switched in clears every state a switch ends, its Last move and types included |
| R6-6 | should | fixed: the Intimidate user's partner copies a rise (Opportunist, Mirror Herb; pre-existing on main) |
| R6-7 | should | fixed: an instructed or Me First U-turn shows the Bench and Replacement |
| R7-1 | blocking | fixed: Heal Block keeps an HP Berry in berryDue and afterLoss |
| R7-2 | blocking | fixed: hazards act in the order they went up; without that order in the calculator, `The order Stealth Rock and Sticky Web went up on your side is not known.` |
| R7-3 | blocking | fixed: a bench build with a Dynamax mechanic is refused, and the calculator drops it |

The round 1 final pass also fixed two of its own open items: a Berserk lock under a suppressed ability stays (PA-BZK-START-GAS)
and a Switched in Pokémon's history is cleared.

### Round 2 (25 findings)

| Id | Severity | Outcome |
|---|---|---|
| R2-A1K-01 | blocking | fixed: Receiver reads the move as it runs (a Z or Max form, a called move's category) |
| R2-A1K-02 | blocking | fixed: a switch request's newcomer meets no breaker |
| R2-A2A3-H-r2-1 | blocking | fixed: a received Choice item clears the lock |
| R5r2-1 | blocking | fixed (the same change: Trick, Switcheroo, Bestow, Recycle) |
| R5r2-2 | blocking | fixed: the Choice lock holds wherever a Dancer is in the turn |
| R5r2-3 | blocking | fixed: Trump Card reads the PP spent; a use with no PP left is skipped |
| R5r2-4 | minor | fixed: the `mustpressure` moves count every foe's Pressure |
| R5r2-5 | blocking | fixed: a spread move's later target keeps a strong weather an earlier faint ended |
| R5r2-6 | should | fixed: Me First's pool is the foes' damaging moves without failmefirst |
| R5r2-7 | blocking | fixed: Gorilla Tactics' lock |
| R3DEF-R2-1 | blocking | fixed with a fact reason: `Dragon Darts with Dragapult's Liechi Berry is not modelled in 2v2.` |
| R3DEF-R2-2 | blocking | fixed: an Encore rewrite into Perish Song, Flower Shield or Rototiller has the queued priority |
| R3DEF-R2-3 | blocking | fixed: Pickpocket takes the heal-blocked attacker's real item |
| R3DEF-R2-4 | blocking | fixed with a fact reason: `Thief with Cramorant-Gulping's Gulp Missile is not modelled in 2v2.` |
| R3DEF-R2-5 | blocking | fixed: a Berry gained in the step is checked at once |
| R3DEF-R2-6 | minor | fixed: a carried Gastro Acid lets the start settle eat the locked Berry |
| R3DEF-R2-7 | should | fixed: no Magician reason where Sticky Hold keeps the item |
| R3DEF-R2-8 | should | fixed: Parental Bond's one-hit KO guard counts a Focus Sash only at full HP |
| R4-r2-1 | blocking | fixed with a fact reason where pinned's order and the app's differ: `G-Max Foam Burst with Skarmory's Salac Berry is not modelled in 2v2.`, `Max Airstream with Snorlax (yours)'s White Herb is not modelled in 2v2.` |
| R4-r2-2 | should | fixed: a turn where both orders give one stage is estimated |
| R6-r2-1 | should | fixed: Snatch or Copycat users' moves passed where Conversion or Imprison may be used |
| R6-r2-2 | should | fixed: every way an Instruct can reach a Pokémon reads the stall counter (`instructCanReach`) |
| R6-r2-3 | minor | fixed: Switched in drops the states other Pokémon carry from it |
| R6-r2-4 | minor | fixed: Conversion 2's Last move shows on every other Pokémon |
| R7-r2-1 | should | fixed: one hazard from before the turn has its place in the order |

### The narrow reasons the reviews kept

Each fires only in its corner (the stored cases check that it does not fire elsewhere), and each fixer's notes say why
exactness is out of reach:
- R3-2: Magician with a locked or heal-blocked Berry (not with Sticky Hold); Thief or Covet where a Rough Skin or Iron Barbs
  loss could knock the user out before AfterHit.
- R3-3: `Starf Berry between the hits of Double Kick is not modelled in 2v2.` (the hit loop has no per-hit world split).
- R3-4: `Fissure with Parental Bond is not modelled in 2v2.` (only USUM's Mega Kangaskhan can reach it).
- R4-2: `G-Max Finale with Cramorant-Gulping's Gulp Missile is not modelled in 2v2.`
- R4-r2-1: a Max or G-Max move's self.onHit where pinned's order gives other stages (Salac, Starf, Weak Armor, Steam Engine,
  Cotton Down, White Herb).
- R5-3: `Dancer needs whether Oricorio is locked into a move by Choice Scarf.` (no carried Choice lock input exists).
- R7-2: `The order Stealth Rock and Sticky Web went up on your side is not known.` (calculator only; Training passes the order).
- R3DEF-R2-1: `Dragon Darts with Dragapult's Liechi Berry is not modelled in 2v2.`
- R3DEF-R2-4: `Thief with Cramorant-Gulping's Gulp Missile is not modelled in 2v2.`

Stored cases the reviews changed: T2M-ST-01-sv and T2M-ST-01-champions gain `Assumes no protecting move was used last turn.`
(R6-3, listed by `changed-cases.ts listChangedReview2`, matching the oracle), and the wave 2 case IN-HZD-01-swsh lists its
newcomer's losses in the order its hazards went up (R7-2). No number of a stored case changed.

## 3. Every gate

### 3.1 The oracle

- **Every case that loads** (`compare.log`, 33.1 s; re-run `final2/compare.log`, 34.7 s):
  ```
  2314/2314 cases match.
  ```
  2314 = the 1769 stored cases that load + 545 (176 wave 2 and 369 review cases). The 544 stub ids are not run. Before each
  compare the app results were copied: `$SP/final/app-results-before` (code gates) and `$SP/final2/app-results-pre` (re-run).
  `results/compare.json` equals the copy apart from `ms`. 1b: `2331/2331 cases match.` (every stored case then); integration 2:
  `1945/1945`; round 2: `2314/2314`.
- **The v3 runner** (`v3-wave2.log`, `v3-wave2-plain.log`): `545/545 cases match.` with and without `STATUS2_REEXPECT=1a,1b`.

### 3.2 changed-cases (`build/changed-cases.ts diff <before> verify/app-results --wave=all`)

- Against the set before any review fix (`$SP/reviews/FIX-r1/app-results-before`; `changed-cases-a.log`, re-run
  `final2/changed-cases-vs-prereview.log`):
  ```
  T2M-ST-01-sv: review2 fixer: review 2 R6-3: "Assumes no protecting move was used last turn." for own-left (a called or instructed protecting move): 4 paths changed (result.facts.1, result.facts.2, result.facts.3, result.facts.4); matches the oracle
  T2M-ST-01-champions: review2 fixer: review 2 R6-3: "Assumes no protecting move was used last turn." for own-left (a called or instructed protecting move): 4 paths changed (result.facts.1, result.facts.2, result.facts.3, result.facts.4); matches the oracle
  2314 cases: 1942 unchanged, 2 stored cases changed, 0 failing the gate.
  ```
  `int2/tools/app-diff-facts.mjs` (which also lists wave 2 and review cases): `2881 files: 3 changed, 369 new`: the two
  T2M-ST-01 facts and IN-HZD-01-swsh's reordered losses. This equals REVIEW2-FIX-2's result.
- Against 1b's app results (`git archive origin/wip/status2-cache` of `verify/app-results`; `changed-cases-b.log`):
  ```
  FS08c-champions: R-E / integrator: the input's pre-turn hazards (own: spikes; opponent: stealthrock) now reach the app (hazardFails, the hazard facts): 1 paths changed (result.steps.0); matches the oracle
  T2M-ST-01-sv: … matches the oracle
  T2M-ST-01-champions: … matches the oracle
  2314 cases: 1766 unchanged, 3 stored cases changed, 0 failing the gate.
  ```
  The 1b set has 2336 files: the 1769 stored cases that load (all present), the 544 stub ids, and 23 stale ids that no case
  list holds here. app-diff-facts: `2881 files: 3 changed, 545 new` (`+ Defog: the hazards on both sides are cleared.` and
  `+ Assumes no protecting move was used last turn.` ×2). **No number of a stored case changed since 1b.**
- Against the sets taken just before this gate's compare runs (`changed-cases-c.log`; re-run
  `final2/changed-cases-vs-final-before.log` and `final2/changed-cases-vs-pre.log`): `2314 cases: 2314 unchanged, 0 stored
  cases changed, 0 failing the gate.` each; app-diff-facts `2881 files: 0 changed, 0 new` each.

### 3.3 The generated Showdown test

`STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts
--keep-rows=tests/unit/doubles-turn-showdown.test.ts --out=<scratch>` (`gen-tests.log`; re-run `final2/gen-tests.log`):
```
keep-rows: 2489 rows before, 282 kept as they were (their case does not load), 0 new
wrote 2489 cases to …/doubles-turn-showdown.regen.test.ts (0 cases that do not agree with the app left out)
```
The output is byte-equal to the tree's file (sha256 117f4f000dc7c5b655661eaecfd137fcfade476bb5353540fd2ca470e9bceed3, both
runs), so the file was not rewritten. No `has a different row now` line. `npx vitest run --config vitest.unit.config.ts
tests/unit/doubles-turn-showdown.test.ts`: `Tests  2489 passed (2489)` (code gates and re-run). An independent row check
(`rowcheck.log`): against 1b's file `before 1985 rows, now 2489; unchanged 1985, changed 0, gone 0; stub rows 282,
byte-equal 282; order kept true; new 504`; against integration 2's `before 2157 rows, now 2489; unchanged 2157, …, new 332`
(the 369 review cases less the 37 stored as not estimated).

### 3.4 `npm run check`: the one gate that failed, and its fix

**On the tree as found it failed twice in a row on the quiet machine** (`check.log` 6m50s, `check-2.log` 7m2s; eslint and tsc
clean):
```
 FAIL  |unit| tests/unit/calculator-uses-to-ko.test.ts … Error: Hook timed out in 10000ms.
 ❯ tests/unit/calculator-uses-to-ko.test.ts:22:1
 Test Files  1 failed | 260 passed (261)
      Tests  8345 passed | 70 skipped (8415)
```
- **Cause:** the regenerated `tests/unit/doubles-turn-showdown.test.ts` is now 7.5 MB (main's is 1.4 MB, integration 2's
  6.0 MB). Vitest transforms it on its shared module server for about 15 s, and any file running beside it waits that long for
  its own imports. calculator-uses-to-ko's `beforeAll` (loading three runtimes) then passes the 10 s hook limit. That hook
  takes 362 ms here alone and 368 ms on main (`load-time.log`). The test file is unchanged from main and passes alone
  (`Tests  69 passed (69)`, `uses-to-ko-alone.log`). Vitest's cached order (failed first, then longest) puts the two files
  side by side, so the failure repeats. Running only those two files reproduces it every time
  (`uses-to-ko-with-showdown.log`: `Error: Hook timed out in 10000ms.` / `Test Files  1 failed | 1 passed (2)`). Round 2's
  passing run had a different file order.
- **Fix** (`vitest.unit.config.ts`, uncommitted): the generated file moves to a third vitest group, `showdown`
  (`include: ["tests/unit/doubles-turn-showdown.test.ts"]`, `groupOrder: 2`), excluded from `unit`, so it runs alone after the
  unit and training groups. A comment in the config gives the reason. No app file and no number changed.
- **Regression test** `tests/unit/vitest-unit-groups.test.ts` (new): the generated file is matched only by the `showdown`
  project, whose group comes after every other, and calculator-uses-to-ko stays in `unit`, group 0. Against the old config
  (`groups-test-before.log`): `AssertionError: expected [ 'unit' ] to deeply equal [ 'showdown' ]`; against the new one
  (`groups-test-after.log`): `Tests  1 passed (1)`.
- **Reruns after the fix:**
  - the two-file reproduction (`uses-to-ko-with-showdown-fixed.log`): `Test Files  2 passed (2)` / `Tests  2558 passed (2558)`;
  - `npm run check` twice (`check-3.log` 7m9.4s, `check-4.log` 7m8.3s), each `EXIT 0`:
    ```
     Test Files  262 passed (262)
          Tests  8415 passed | 1 skipped (8416)
    ```
  - conformance check 8's own vitest command (`conformance-check8-cmd.log`): `Test Files  2 passed (2)` / `Tests  2493 passed
    (2493)`; and the whole `conformance:training` afterwards (§3.11);
  - this write-up's re-run on the final tree (`final2/check.log`, 8m22.6s, eslint and tsc print nothing):
    `Test Files  262 passed (262)` / `Tests  8415 passed | 1 skipped (8416)` / `EXIT 0`.
- The extra group adds little wall time: 7m9s and 7m8s against 6m50s–7m2s before (this write-up's re-run took 8m22.6s,
  its vitest `Duration  407.74s` against 346.83s; the group order is the same, so that is machine variance). History: 1b 255
  files / 7699 tests;
  integration 2 261 / 8010; round 2 261 / 8414 (1 skipped); now 262 / 8415 (1 skipped).

### 3.5 `npm run test:battle-data:source`

In place (`battle-data-source.log`), the environment, not the code:
```
 Test Files  9 failed | 2 passed (11)
      Tests  30 passed | 91 skipped (121)
```
Every error is a missing pinned file: `The pinned Showdown dex is missing (…/showdown-dex-c23d2e94…/data/abilities.js|items.js|moves.js); run npm run data:champions.`
and `Offline source archive missing: damage-calc-e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d.tar.gz.` With integration 2's
scratch source cache (`SOURCE_CACHE=$SP/int2/srccache npx vitest run --config
scripts/.cache/calc-audit/status2/build/int2/vitest.source-overlay.config.mts`; `battle-data-source-overlay.log`):
```
 Test Files  3 failed | 8 passed (11)
      Tests  63 passed | 91 skipped (154)
```
The 8 that run pass alone (`Test Files  8 passed (8)` / `Tests  63 passed (63)`): doubles-third-party, status2-hooks,
doubles-residuals, doubles-items-takeable, doubles-spread-reactions, doubles-substitute-census, stolen-berries,
training-format. **Not run, 91 tests:** battle-data (66), doubles-ability-table (6), doubles-status-moves (19); all three need
the damage-calc archive. `status-table.ts` regenerated with `gen-status-table.ts` is byte-identical (sha256 cca92aff…) and
unchanged since integration 2. 1b: `Test Files  11 passed (11)` / `Tests  153 passed (153)`; integration 2 as now.

### 3.6 The 1v1 golden

- `golden-1v1.ts --check` (`golden-check.log`; re-run `final2/golden-check.log`): `golden-1v1: 254 cases byte-equal (8002 ms)`
  and `(8485 ms)`. The stored `golden-1v1.json` and `full.json.gz` are unchanged (sha256 checked).
- Against main (the script copied into scratch folders; main from the maintree with `TSX_TSCONFIG_PATH`;
  `golden-vs-main.log`): main `golden-1v1: wrote 254 cases (18152 rows) in 7488 ms`, now `… in 7486 ms`, then
  ```
  254 cases, 18152 rows compared: 110 rows differ (110 Fling rows, 0 other rows); 0 other differences
  ```
  The 110 rows (Champions 26, USUM 24, SwSh 26, SV 34) are byte-equal as a set to integration 2's `int2/golden-changed.json`.
  Main against the stored golden gives the same 110 rows; now against the stored golden, `0 rows differ`. So 1v1 is
  byte-equal to main except the 110 verified Fling rows.

### 3.7 The oracle harness tests

`npx vitest run --config scripts/.cache/calc-audit/2v2/verify/{v1,v2,v3}/vitest.{v1,v2,v3}.config.mts` (`harness-v*.log`):
```
v1: Tests  2 failed | 16 passed (18)
v2: Tests  1 failed | 25 passed (26)
v3: Tests  1 failed | 24 passed (25)
```
Only the known failures on missing files, the same as integration 2 and both rounds; nothing was weakened: V1
`ENOENT … v1/fixtures/G4-OPP-11-sv.oracle.json` and RT-RV02's `expected '' to match /fieldSet/` (a stub id); V2 `R09: expected
false to be true` (a stub id); V3 `Error: no case ZS16` (zmove-status is a stub).

### 3.8 The bench

- **Cross-process, 4 rounds** (`build/final2/bench.sh 4`, main and this tree alternating; 1910 turns: 1703 cases, 7 BENCH and
  200 fuzz turns; `bench.log`). Round 4:
  ```
  benchH-4 turn p50 4.58 p95 14.72 max 43.7 | moves p50 23.81 | statuses {"ready":1168,"not-estimated":738,"issues":4} | reference 30/30
  benchC-4 turn p50 7.99 p95 17.90 max 44.6 | moves p50 22.43 | statuses {"ready":1817,"not-estimated":89,"issues":4} | reference 30/30
    round 4: paired ready turns 1154: main p50 7.16 p95 16.58 | now p50 7.85 p95 17.94 | per-turn ratio median 1.096 p90 1.815
    round 4: newly ready 663: p50 8.72 max 43.7 ms
  ```
  Per-turn ratio median by round: 1.159, 1.088, 1.083, 1.096 (integration 2: 1.231, 1.126, 1.122, 1.056). Now: turn p50
  7.43–7.99 ms (target 30), p95 16.98–18.09 (target 120), max 44.6–50.8 (target 400). Reference mode is 30/30 in every run.
  The Moves pane p50 is main 22.10–27.59 ms and now 22.43–27.46 ms against its 25 ms target: both cross it on some rounds on
  this slow machine.
- **In process** (`int2/paired-ab.ts <engine tree> 5`, the minimum of 5 alternating runs per turn; `paired-ab-*.log`):
  ```
  main: paired ready turns 973 …: head p50 4.85 p95 9.81 | now p50 5.45 p95 11.17 | per-turn ratio median 1.091 p90 1.249; sum ratio 1.124
        ready now and not in head: 771; ready in head and not now: F2-G3-usum, INT-SPE-02-sv
  1b:   paired ready turns 1744 …: head p50 5.58 p95 11.11 | now p50 5.69 p95 11.62 | per-turn ratio median 1.013 p90 1.069; sum ratio 1.018
  int2: paired ready turns 1744 …: head p50 5.51 p95 11.06 | now p50 5.51 p95 11.34 | per-turn ratio median 0.997 p90 1.050; sum ratio 1.001
  ```
  The Moves pane (`microbench-moves-main.log`): `ratio min 1.018 median 1.020` against main. The whole stored set
  (`microbench-turns-main.log`): `ratio min 1.597 median 1.651`, because this tree calculates 771 more turns. So the review
  rounds add no per-turn cost (×0.997 against integration 2's engine), and the +9 % against main was already in 1b's engine
  (1b measured −2.5 % cross-process on its Windows machine). The two turns main gives ready and this tree does not are kept
  reasons: INT-SPE-02-sv (main's number was wrong) and F2-G3-usum (`Natural Gift with Embargo is not modelled in 2v2.`).

### 3.9 The census sample and the budgets (ADDENDUM2 §7.3, §10 risk 5)

- **Census sample** (`build/final2/census/run.sh`; `census-sim.final.out`, `census-diff.out`):
  ```
  == Champions (usage): 8000 turns, ready 7391, not estimated 609 (7.6%), issues 0; end of turn not estimated 235
  ```
  and SV `ready 1746, not estimated 156 (7.80 %), end not estimated 45, issues 98`. `census-sim.final.json` equals
  `census-sim.int2.json` apart from `ms`. The table and the reasons are in §1.
- **With a bench** (`census-bench.ts`, `bench-report.ts`; `census-bench-report.out`): as in §1; its plain run equals
  census-sim's (`→ equal`), and the report equals integration 2's apart from timing. `reasons naming a position: none` in
  every run.
- **Budget probe** (`build/final2/census/budget-probe.ts`, plain and `--bench`; `budget.out`, `budget-bench.out`):
  ```
  tier2 budgets probe: seed 7, 8000 Champions + 2000 Scarlet/Violet turns, 133386 ms (… final gate; mode plain)
    "Too many cases to follow." today: turn 0, end of turn 0, E2 0
    calcs      p50 2 p90 5 p99 11 max 58
  ```
  With a bench: `E2 statuses: {"ready":7740,"not-estimated":260}; E2 throws 0; E2 calculations max 58; E2 rounds max 1,
  combos max 8`. SV: `"Too many cases to follow." today: turn 0, end of turn 0`, calculations max 20 (plain) and 46 (bench).
  Every calculation load is at or under 160; engine errors and throws 0; the spread-heal joint 357 / 378 ready, worst load
  0.1244, inside SPEC2 risk 5 as in 1b; the landing headroom unchanged (Champions 2, SV 1). Turn by turn against integration
  2's probe: no status or reason changes; calculations up by at most 2 on 191 Champions turns (204 with a bench) and by 1 on 9
  SV turns (11), with the maxima unchanged. **The acceptance holds.**

### 3.10 The static layout check (375 px and 1280 px)

`RENDER_OUT=$SP/final/render npx vitest run --config scripts/.cache/calc-audit/status2/build/final2/render/render.config.mts`,
then `check-layout.mjs` with Playwright's Chromium on 127.0.0.1 (no sign-in) at both widths, loaded and with every `<details>`
open (`render-3.log`, `layout.log`):
```
11 pages × 2 widths: every check passes
```
Each line reads like `ok   instructed-uturn @375: loaded scrollWidth 375 / clientWidth 375 (body 375), past the edge 0; open
scrollWidth 375 / clientWidth 375 (body 375), past the edge 0; 149 named nodes, 149 controls, duplicate names in one context
none, unnamed none; position words: text none, names none`. The pages are integration 2's nine (U-turn with a chosen
replacement, Parting Shot, Eject Button, Red Card, Roar, Emergency Exit, a newcomer onto Stealth Rock and Spikes, a
Neutralizing Gas newcomer, a newcomer under the gas) and two for review-fixed behaviour:
- **conversion2-target** (R6-1): Porygon2's Conversion 2 at Snorlax; `Last move control on: Gardevoir, Snorlax, Garchomp`,
  not on Porygon2.
- **instructed-uturn** (R6-7): Oranguru instructs Ambipom, whose last move is U-turn, under Trick Room, with Corviknight on the
  bench: `Bench : your side`, `Replacement : Ambipom`, `Instruct: Ambipom uses U-turn again.` and `Ambipom switches out;
  Corviknight comes in.`.

The nine old pages have identical `facts.txt` and layout lines; their HTML differs from integration 2's only by R6-4's two new
items in the 2v2 note (Smack Down and Magnet Rise grounding; Power, Guard and Speed Split). The only repeated accessible name
in one group is `Tera Type` on the 2v2 cards, which the naming guard allows (as on main). One tool-only change: the copied
scripts' position check now lets "PP left" pass, since `Assumes Ambipom's U-turn has PP left.` tripped it and the repo's
naming guard accepts that text.

### 3.11 The Training gates (each alone on the machine, after the config fix; logs `conformance.log`, `leak.log`, `eval.log`)

- **`npm run conformance:training`** (19m5.7s, `EXIT 0`): every row passes.
  ```
  | 1. Tracker parity | 100% | 840/840 (100.00%) | PASS |
  | 4b. Clean rollouts inside the E2 support | ≥ 99% | 57310/57310 (100.00%) over 2994/3000 engine cells | PASS |
  | 8. E2 vs Showdown (doubles-outcomes + doubles-turn-showdown tests) | all pass | Test Files  2 passed (2); Tests  2493 passed (2493) | PASS |
  | 9a. Saved battles … | 100% of 30 | 30/30 hash, 30/30 boards and result (6 forfeited) | PASS |
  | Runner errors | 0 | 0 | PASS |
  ```
  The other rows: 2a `297/297`; 2b `100.00% / 100.00% of 297`; 2c `289/289 (100.00%)`; 3 `288/288, 288/288`; 4a `0 over 400
  Pokémon`; 4c (report) `2481/2994 engine cells (82.87%)`; 5 `33.7% / 35.0% / 25.1%`; 6 `23737/23785; unavailable (hidden
  trap shown) 48`; 7 `0`; 9b `30/30; largest record 43 KB`; 9c `6/6 hash, 6/6 boards and result; Resume 6/6`. Equal to
  integration 2's except check 8 (2493 tests against 2161: the regenerated 2489 rows and doubles-outcomes' 4, run under the new
  config) and the time-dependent 9a and 9b (6 forfeited and 43 KB against 5 and 41 KB), which vary between runs on main too.
  1b: 4b `57662/57662`, check 8 1989.
- **`npm run leak:training`** (51m26.5s, `EXIT 0`): all 15 rows pass.
  ```
  | L1-sp | ≥ 50 compared, 0 differences | 0 differences in 197 | PASS |
  | L1-bench | ≥ 50 compared, 0 differences | 0 differences in 310 | PASS |
  | L2 (your direction, youSee closed) | 0 hits over 40 battles | 0 hits in 516 messages over 40 battles (8 forfeited on a locked turn) | PASS |
  ```
  Every L1 count equals integration 2's (nature 236, item 240, ability 246, moves 282, hp 137, dice 70, dice-eot 72, choice
  131; the settings work: `174/214 differ`, `83/144 differ`). L2's counts move slightly: saved battles `40 replays (283 boards;
  40 of 40 equal to the battle's boards), 10 resumed, 243 checkpoints sealed` (integration 2: 281 / 241); Illusion and
  Transform `0 hits in 201 messages over 16 battles; 5 Illusions ended, 16 with a Transform, 9 look-alike decisions; 16/16
  replays equal, 4 resumed` (integration 2: 190 messages, 6 ended, 3 look-alikes). Every hit count is 0: **Training reads no
  hidden information.**
- **`npm run eval:training -- --gates --scale 1 --shards 8 --run s1-step1`** (main's seeds; 61m35.9s, `EXIT 1`; the run moved
  to `scripts/.cache/training/eval/final2-s1seeds`): 18 PASS, 4 FAIL.
  ```
  | Reads you − Plays safe, both vs HabitBot | ≥ +5 points (same seeds) | 3.3 pts [-0.7, 7.2] n=400 | FAIL |
  | Turn decision time (Node, worst run) | p50 ≤ 400, p95 ≤ 800, max ≤ 2,000 ms | p50 1861 ms p95 4507 ms max 10311 ms (n=16058) | FAIL |
  | Preview / replacement time | p95 ≤ 150 / ≤ 60 ms | 259 ms / 65 ms | FAIL |
  | Belief update per turn | p95 ≤ 30 ms (closed), ≤ 8 ms (open) | closed 111 ms, open 44 ms | FAIL |
  ```
  Neither kind of failure is in the code. HabitBot fails as on main (4.0 pts), in 1b (2.8) and at integration 2 (3.3). The
  three time rows fail because 8 shards run on 4 CPUs (load about 11.5); main fails them the same way, and §4 is the quiet
  measurement. The rows that pass: legality open / closed / perfect `0 errors, 0 engine issues, 0 fallbacks, 0 capped`
  (n=2600 / 200 / 400); Plays safe vs RandomLegal `99.0% [96.4%, 99.7%]`; vs MaxDamage `62.0%`; Reads you vs MaxDamage
  `74.0%`; self-play `48.5%`; closed team sheets `99.0%`; information cost `-4.8 pts`; work budget `engine 240, rollouts 160,
  builds 4`; dropped 0; pool S `100.0% of 23262` (main 88.5 %); exploitability `0.01%`; determinism `20/20`; A1.4; the three
  A1.5 rows. **Every one of the 3200 battle hashes in the 11 runs equals integration 2's gate run, and n=16058 is the same**,
  so the review rounds changed no Training decision on these seeds (`eval-vs-int2.log`). The per-run p95 here is 5–13 %
  below integration 2's on the same games (machine variance).
- **T2's fuzz** (`t2-fuzz.ts 60 101`, 1m20.9s): `"decisions": 1335, "compared": 5004, "mismatches": 188, "logsClean": 794,
  "logsSame": 794, "cells": 8010, "engineCells": 7867, "issues": 0, "notEstimated": 24`; `t2-fuzz-all.ts 60 101` prints 188
  notes, every one a ` pp: ` line (T2's known PP counting, W1B-T2.md). Equal to round 2.
- **R-T's fuzz** (`w2-rt/rt-fuzz.ts`): seed 1 `"decisions": 1199, "mismatches": 0, "benchChecked": 2356, "hazardsChecked":
  2356, "logsClean": 1013, "logsSame": 1013, "engineCells": 7001, "issues": 0, "notEstimated": 14, "ready": 7988,
  "policyIssues": 0`, equal to rounds 1 and 2; seed 101 `"mismatches": 0, … "issues": 0, "notEstimated": 6, … "policyIssues":
  0, "postChecked": 10194`, equal to integration 2's but postChecked (10176), and equal to round 1 pass D's run. The 13 and 6
  not-estimated cells are R-E's kept `Red Card with Life Orb is not modelled in 2v2.`.

### 3.12 This write-up's re-run on the final tree

A gate agent changed code, so the cheap gates ran again, one after another, on the final tree (`$SP/final2/rerun.sh`, logs
`$SP/final2/logs/`; branch and HEAD checked at its start and end, all 20 stub sha256 `OK` at both):
- `npx tsc --noEmit`: no output, `EXIT 0`.
- `golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal (8485 ms)`.
- `STATUS2_REEXPECT=1a,1b compare.ts`: `2314/2314 cases match.` (34.7 s).
- changed-cases against the code gates' before set and against this run's own before set: `2314 cases: 2314 unchanged, 0
  stored cases changed, 0 failing the gate.` both; against the pre-review set: `2314 cases: 1942 unchanged, 2 stored cases
  changed, 0 failing the gate.` (T2M-ST-01 ×2, matching the oracle). app-diff-facts: `2881 files: 0 changed, 0 new` twice and
  `2881 files: 3 changed, 369 new`.
- gen-tests: `keep-rows: 2489 rows before, 282 kept as they were (their case does not load), 0 new`; `BYTE-EQUAL`, sha256
  117f4f00…; vitest `Tests  2489 passed (2489)`.
- `npm run check` (8m22.6s): eslint and tsc print nothing, then `Test Files  262 passed (262)` / `Tests  8415 passed | 1
  skipped (8416)` / `EXIT 0`.
- At the end: `calc-2v2-status-2`, 6c1ca23, the same two-file `git status`, both files' sha256 unchanged, all 20 stubs `OK`.

## 4. Decision time (HANDOFF item 3)

SPEC2 §6 asks for a worst-run decision p95 ≤ 634 ms (main's 577 ms on 1b's reference machine × 1.1); eval's own gate is p95
≤ 800 ms. 1b measured 682 and 723 ms on that machine (646–676 in its paired check, where main gave 617–687), and integration 2
estimated 650–675 ms. **The reference machine was not available here**, so every figure is a ratio against main on this
container, scaled by main's 577 ms there, as INTEGRATION-2 did.

- **Runs:** the three with the highest p95 on main's seeds in this gate's eval: safe-maxdamage-suggested (4507 ms),
  safe-random-closed (3428), safe-maxdamage-perfect (3380); integration 2's paired set.
- **Layout:** each shard through eval-ai.ts's own child mode with the gate's 8-shard split (habits carried as in the gate), at
  most 2 processes at a time. Each process uses about 1.35 cores (V8's GC threads), and top showed about 31 % idle, so the
  CPUs were not oversubscribed. Every battle hash equals the reference runs (final2-s1seeds for now, integration 2's paired
  main runs for main) and is equal round to round, so main and now play the same games in every round.
- **Three alternating rounds** (about 17-minute blocks; main first in rounds 1 and 3), p50 / p95 / max in ms:

  | Run (decisions main / now) | main r1; r2; r3 | now r1; r2; r3 | now/main p95 |
  |---|---|---|---|
  | safe-maxdamage-suggested (421 / 424) | 553/1141/1761; 512/1076/1991; 556/1201/2010 | 592/1261/2170; 608/1341/2230; 620/1341/2255 | ×1.105, ×1.247, ×1.116 |
  | safe-random-closed (1158 / 1143) | 506/1074/1793; 463/999/1766; 473/1015/1907 | 495/1026/2069; 516/1085/2736; 512/1062/2099 | ×0.955, ×1.086, ×1.046 |
  | safe-maxdamage-perfect (1911 / 1912) | 451/1015/1850; 439/979/1924; 437/972/1619 | 461/1034/1804; 481/1080/1769; 483/1093/1861 | ×1.018, ×1.104, ×1.124 |

  Suggested has the highest p95 in every round; scaled, its three rounds give 637, 719 and 644 ms (median 644).
- **Drift check, shards interleaved:** round 2 had main faster and now slower than round 1, which points to drift between
  blocks, so two more rounds ran main's and now's shards side by side. Suggested: main 559/1189/1924 and 584/1281/1942, now
  600/1315/2134 and 644/1371/2279; p95 ×1.106 and ×1.070, scaled 638 and 617 ms. Closed p95 ×1.081 and ×1.070; perfect
  ×1.048 and ×1.063.
- **One process at a time,** suggested, two rounds: main 563/1144/1777 and 581/1213/1992; now 601/1300/2121 and 606/1336/2018;
  p95 ×1.136 and ×1.102, scaled 656 and 636 ms. Two processes at a time do not inflate main's times (1076–1281 ms against
  1144–1213 alone).
- **Pooled over the 7 paired rounds** (`quiet-pooled.log`):
  ```
  p50: median ×1.073 range ×1.045–×1.188 → scaled 294 ms (range 286–326)
  p95: median ×1.106 range ×1.070–×1.247 → scaled 638 ms (range 617–720)
  max: median ×1.173 range ×1.013–×1.375 → scaled 1385 ms (range 1196–1624)
  ```
- **Per decision** (each decision's median time over the rounds): worst-run p95 ×1.168 (674 ms) for the alternating rounds,
  ×1.106 (638 ms) interleaved, ×1.155 (667 ms) one process at a time. On the same games (81/100, 115/200 and 309/400 battles)
  each decision's now/main ratio has a median of ×1.12–×1.19.
- **Where the time goes:** engine calls per decision up 4–6 % and preludes up 9–12 %, while rollouts fall from 12.6–16.2 to
  0.0–0.3 (wave 2's intended move to the engine). Time per engine or prelude call is equal or lower.
- **Absolute times here** cannot be read against the gate: even quiet, main's worst-run p95 on this machine is 1076–1281 ms
  and its max 1777–2203 ms, about 2× the reference machine; now's raw max is 2018–2766 ms.

**Result:** eval's gate holds in every estimate: p95 about 638 ms against 800, p50 about 294 against 400, max about 1385
against 2000. **SPEC2's 634 ms is at the edge and is not settled here:** the estimates straddle it (617–719, pooled median
638, per-decision 638–674), and main's own reference p95 varied 577–687 ms in 1b's paired check, so the 577 base is uncertain
too. One `npm run eval:training -- --gates --scale 1 --shards 8 --run s1-step1` on the quiet reference machine settles it; a
perf pass on the per-decision engine and prelude work is the alternative.

## 5. What is left for the user

1. **The missing case folders.** Copy them from the user's machine (they are not on `wip/status2-cache`, which holds only
   the files pushed on 11 Oct): the 20 stub files in `$SP/stubs/list.txt` (relative to `scripts/.cache/calc-audit/`), plus
   `2v2/verify/v1/fixtures`, `v3/gen`, `v3/gen-r`, `v3/logs`, `v3/tools`, `v3/tsc`, `v3/app-hz`, `fling/golden-before`,
   `fling/golden-diff.ts` and `status2/build/int1b`. Then, from the repo root:
   - `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts`: the 544 ids load again,
     so the count should be 1b's stored set (2331, less any case a later wave dropped on purpose) plus the 545 wave 2 and
     review cases, every one `match`.
   - `npx --no-install tsx scripts/.cache/calc-audit/status2/build/changed-cases.ts diff <1b's app-results>
     scripts/.cache/calc-audit/2v2/verify/app-results --wave=all`: `0 failing the gate`, with any change listed.
   - `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts
     --keep-rows=tests/unit/doubles-turn-showdown.test.ts`: the 282 kept rows then come from their cases; no `has a
     different row now` line expected. Then `npx vitest run --config vitest.unit.config.ts
     tests/unit/doubles-turn-showdown.test.ts` and `npm run check`.
   - The harness tests (§3.7): the four stub failures should pass.
2. **The two pinned files for `npm run test:battle-data:source`.** `node_modules/.cache/champions` needs the compiled dex
   `showdown-dex-c23d2e942c9c0daadb13a7162a385bf78e3c9353/` (`npm run data:champions`'s compile step) and
   `damage-calc-e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d.tar.gz` (pin sha256
   ca28c26b6728b1a0fe7c08189abe8f1da61d2f1eb1d9d1bf0fc36039ff9dae84; a codeload download gives other bytes). This session
   may not write `node_modules`. Until both are back, 91 tests do not run (battle-data 66, doubles-ability-table 6,
   doubles-status-moves 19); the other 8 files pass 63/63.
3. **Decision time on the reference machine** (§4): one `npm run eval:training -- --gates --scale 1 --shards 8 --run s1-step1`
   on the quiet reference machine, against SPEC2's 634 ms; the 800 ms gate holds in every estimate here. HabitBot (3.3 pts
   against +5) fails as on main and is reported beside main's.
4. **The live check** (HANDOFF item 4): the signed-in 2v2 calculator at 1280 px and 375 px, with the Bench, Replacement and
   Hazards, the instructed U-turn and Conversion 2's Last move. It needs the user signed in; credentials are never typed here.
5. **Stray root logs** from review round 1, which the session's safety check would not delete: `/wave2.log`,
   `/vitest-tc-2.log`, `/rt-fuzz-1.log` (copies in `$SP/fixD` and `$SP/fixE`). This gate created none.
6. **Sync `scripts/.cache` to `wip/status2-cache`** (this session was not allowed to push). The branch is at d12f052 (11 Oct),
   so everything since is unsynced: the build notes from W2-R-E.md on (W2-GAPFIX, INTEGRATION-2, REVIEW2-*, FINAL2), the
   records `build/int2/` and `build/final2/` (bench, census, render and training scripts; `int2-engine`), `build/w2-rt/`,
   `verify/cases-r.ts`, `cases-review2.ts`, `cases-wave2.ts`, the harness changes (`compare.ts`, `gen-tests.ts`,
   `changed-cases.ts`, `app-turn.ts`, `v3/harness.test.ts`), `verify/results/` (the wave 2 and RV2 oracle results and
   `compare.json`), `verify/app-results/`, the ADDENDUM2.md and inputs.md edits, and the Training run folders
   (`scripts/.cache/training/eval/final2-s1seeds`, `int2-s1seeds`, `int2-paired-now-r1`, `-r2`). Main's paired and quiet runs
   are only in the scratch maintree and `$SP/final/training/quiet*`.
7. **The merge** (HANDOFF item 5), only when the user says "commit push merge":
   - include the gate's config fix (`vitest.unit.config.ts`, `tests/unit/vitest-unit-groups.test.ts`);
   - remove `HANDOFF-status2.md`;
   - squash the seven WIP commits since 4008ee8 (fec03d5 … 6c1ca23) into one real message;
   - merge with `--no-ff` into main, keeping `.claude/launch.json` untracked (`git add -A -- . ':!.claude'`).
   Main is now 9a3115e (§Status); its 10 newer commits touch no file of this branch, but `npm run check` has not been run on
   the merge result.
8. **Open items kept from the notes** (none blocks the merge; each is a fact reason or a harness limit):
   - INTEGRATION-2 open items 7 (a newcomer's form-changing Start), 10 (R-V's contract gap for a dragged-in bench user of a
     landing; the Pledge and Round sourceEffects note; the AI's later replacement pick; `turnBenchNames` for a fainted slot)
     and 11 (polish: `Tera Type` names, a newcomer's Intimidate as plain stage facts, docs/training.md's gate 4b sentence);
   - round 2's open items: no bridge-level Training test for a called Instruct's stall streak (the engine's unit tests cover
     it); a move given 0 PP from the start uses Trump Card's own failure path (the oracle refuses that input); 7 review cases
     without a `--validate` replay cross-check (§2);
   - conformance 9a / 9b and leak L2's message, board and look-alike counts vary from run to run; this predates the branch
     (INTEGRATION-2 open item 12).
