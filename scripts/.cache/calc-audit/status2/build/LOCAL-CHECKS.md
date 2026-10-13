# LOCAL-CHECKS: status2's checks on the local machine (13 Oct 2026)

These are the checks the cloud session could not run (HANDOFF-local.md, "What is left"). They ran on `main` at 92ff69f
(`Merge status2: …`). Every log named below is in `build/local-checks/`.

**Result:** every check passes, and no status2 regression was found. So no fix branch was made, and nothing was committed to
`main` or merged. The cache branch got two new commits: 863da67 (the local-only folders) and the one after it (this file and
its logs).

## Setup

### Getting up to date (HANDOFF "Get the local machine up to date")

- `git fetch origin`, then `git checkout main`, then `git pull --ff-only`: fast-forward cb5b2b5 → 92ff69f.
- `git branch -D calc-2v2-status-2` was skipped. The handoff marks it optional, and the local copy still holds WIP commit
  fec03d5.
- Integration 1b's app results were set aside before the extraction, in `../status2-1b` (2336 files, from d12f052).
- `git archive origin/wip/status2-cache scripts | tar -x` was run with **`git -c core.autocrlf=false archive …`**, for both
  archives.
  - This repo has `core.autocrlf=true`, so a plain `git archive` writes every LF text file as CRLF. For example,
    `before-status-eot/results/BB08.json` came out as 9857 bytes instead of 9249, and such files are byte-different from the
    cloud's.
  - The flag keeps the branch's exact bytes.
- Checked before the extraction:
  - All 20 local-only case files are real (none starts with `// CLOUD-SESSION STUB`), and none is in the archive.
  - Neither are the harness folders v1/fixtures, v3/{gen,gen-r,logs,tools,tsc,app-hz} or `status2/build/fling`.
  - Every local file the archive replaced equals its d12f052 copy, except four Training gate outputs. Those were copied first
    to the session scratchpad (`pre-extract-backup/`): `training/conformance/conformance-SVA.{json,txt}` and
    `training/leak/leak.{json,txt}`.

### Where the checks ran

18 s after the pull (`HEAD@{10:49:38}`), another session ran `git checkout -b feat/castmirror-native-execution` in this same
working tree. It then edited:
- CastMirror files, `package.json` and `package-lock.json` (moving `pg` into dependencies);
- `eslint.config.mjs`, `public/castmirror.html` and `vendor/castmirror/**`.

Its branch and files were not touched. Instead, the checks ran in a **detached worktree, `C:\Users\evanb\s2check` at
92ff69f**:
- `node_modules` is a junction to the main tree's;
- `.env.local` and `next-env.d.ts` were copied;
- `scripts/.cache` was copied (102,492 files), leaving out `training/eval` and `calc-audit/trim-howto`, which no check reads.

Two checks also touched the main tree:
- **The first compare ran in the main tree.** That happened before the switch was noticed; only `package.json` and
  `package-lock.json` differed from 92ff69f then. It printed the same `2876/2876 cases match.` (`compare-maintree.log`).
- **Results agree across both trees.** The worktree's 2881 app results equal the main tree's apart from `ms`, and the two
  `compare.json` files are equal apart from `ms`.

## 1. The 544 stored cases

| # | Command (repo root of the worktree) | Exact output | Expected (HANDOFF) | Status |
|---|---|---|---|---|
| 1a | `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts` | `2876/2876 cases match.` (18.4 s; `compare.log`) | about 2331 + 545, every case `match` | pass |
| 1b | `npx --no-install tsx scripts/.cache/calc-audit/status2/build/changed-cases.ts diff ../status2-1b/scripts/.cache/calc-audit/2v2/verify/app-results scripts/.cache/calc-audit/2v2/verify/app-results --wave=all` | `2876 cases: 2328 unchanged, 3 stored cases changed, 0 failing the gate.` (`changed-cases-vs-1b.log`) | `0 failing the gate`, any change listed | pass |
| 1c | `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts --keep-rows=tests/unit/doubles-turn-showdown.test.ts` | `keep-rows: 2489 rows before, 0 kept as they were (their case does not load), 0 new` / `wrote 2489 cases to …doubles-turn-showdown.test.ts (0 cases that do not agree with the app left out)` (`gen-tests.log`) | no `has a different row now`; the 282 kept rows now come from their cases | pass |
| 1d | `npx vitest run --config vitest.unit.config.ts tests/unit/doubles-turn-showdown.test.ts` | `Test Files  1 passed (1)` / `Tests  2489 passed (2489)` (`vitest-showdown.log`) | — | pass |
| 1e | `npm run check` | `CastMirror parity verified: af7d034 / castmirror-vercel-v2`; eslint and tsc print nothing; `Test Files  268 passed (268)` / `Tests  8803 passed \| 1 skipped (8804)`; `EXIT 0` (2m28.6s; `check.log`) | — | pass |
| 1f | `npx vitest run --config scripts/.cache/calc-audit/2v2/verify/v1/vitest.v1.config.mts` | `Tests  18 passed (18)` (`harness-v1.log`) | G4-OPP-11 and RT-RV02 pass | pass |
| 1g | the same for `v2/vitest.v2.config.mts` | `Tests  26 passed (26)` (`harness-v2.log`) | R09 passes | pass |
| 1h | the same for `v3/vitest.v3.config.mts` | `Tests  1 failed \| 24 passed (25)`, the failure `Error: spawnSync npx ENOENT` (`harness-v3.log`) | ZS16 passes | ZS16 passes; one failure is a harness bug on Windows (below) |
| 1h' | v3 with only that spawn call changed, in a scratch copy | `Test Files  1 passed (1)` / `Tests  25 passed (25)` (`harness-v3-winpatch.log`) | — | pass |

Notes on step 1:

- **The 3 stored cases changed since 1b** are the cloud's same three, each `matches the oracle`. No number changed.
  - `FS08c-champions`: R-E / integrator, the input's pre-turn hazards now reach the app (1 path, `result.steps.0`).
  - `T2M-ST-01-sv` and `T2M-ST-01-champions`: review 2 R6-3's `Assumes no protecting move was used last turn.` (4 paths each).
- **The 544 ids that were stubs in the cloud** are all among the 2328 unchanged since 1b.
- **gen-tests rewrote nothing.** Its output is byte-equal to the committed file: sha256
  `117f4f000dc7c5b655661eaecfd137fcfade476bb5353540fd2ca470e9bceed3`, the cloud's hash, and `git diff` is empty.
- **The first gen-tests run is an artifact.** That run (`gen-tests-crlf-input.log`) printed `has a different row now` for all
  2489 rows. It read the worktree's CRLF checkout of the test file (autocrlf), so the row text carried a `\r`. Run on the
  committed LF bytes (1c), there is no such line. Anyone running gen-tests on this Windows checkout sees the same artifact
  until the file is LF.
- **The v3 failure (1h) is the harness, not the app.**
  - `v3/harness.test.ts:246` and `:253` call `execFileSync("npx", …)`. On Windows `npx` is `npx.cmd`, which `execFileSync`
    cannot start without a shell.
  - In a scratch copy, running tsx's CLI through `process.execPath` instead (no assertion changed) gives 25/25.
  - The harness file was left as it is.
- **The two castmirror-transport tests the handoff lists as failing on main pass here**, inside the 8803.

## 2. Source tests

| Command | Exact output | Status |
|---|---|---|
| `npm run test:battle-data:source` | `Test Files  11 passed (11)` / `Tests  154 passed (154)` (28.8 s; `battle-data-source.log`) | pass |
| `npx vitest run --config vitest.battle-data.config.ts tests/source/battle-data.test.ts tests/source/doubles-ability-table.test.ts tests/source/doubles-status-moves.test.ts` | `Test Files  3 passed (3)` / `Tests  91 passed (91)` (`battle-data-source-3files.log`) | pass |

The cloud ran 8 of the 11 files (63 tests). The other 3 files run here and pass, which is exactly the 91 tests that never ran
(battle-data 66, doubles-ability-table 6, doubles-status-moves 19). The local `node_modules/.cache/champions` has the
compiled dex `showdown-dex-c23d2e94…` and `damage-calc-e7fd7e59….tar.gz`.

## 3. Decision time on main's seeds

**Command:** `npm run eval:training -- --gates --scale 1 --shards 8 --run s1-step1`. It ran in the worktree, 11:11–11:22,
taking 11m26.8s, and ended `EXIT 1` (the HabitBot row) (`eval.log`). The run is copied to
`scripts/.cache/training/eval/local-s1seeds`; Step 1's own `s1-step1` is unchanged.

**21 PASS, 1 FAIL.** The two rows the handoff asks for:

```
| Turn decision time (Node, worst run) | p50 ≤ 400, p95 ≤ 800, max ≤ 2,000 ms | p50 297 ms p95 629 ms max 1374 ms (n=16058) | PASS |
| Reads you − Plays safe, both vs HabitBot | ≥ +5 points (same seeds) | 3.3 pts [-0.7, 7.2] n=400 | FAIL |
```

**Decision time:**
- **The worst-run p95 is 629 ms**, set by safe-maxdamage-suggested (`gates.json`: p50 297, p95 629, max 1169, n=424); the
  1374 ms max is safe-safe-open's.
- **Against SPEC2's 634 ms** (main's 577 ms × 1.1): 629 ≤ 634, a pass by 5 ms. 629 / 577 = ×1.090.
- **Against the cloud's paired estimate** of 638 ms (range 617–720), this figure is inside the range.
- **The eval gate's 800 ms** passes too. So do the other two time rows: `59 ms / 8.70 ms` against 150 / 60, and `closed 18 ms,
  open 6.46 ms` against 30 / 8.
- **The same run, earlier steps** (safe-maxdamage-suggested p95): int1a 675, perf1b 592, int1b 721; main 577 (INTEGRATION-1A,
  PERF-1B).

**HabitBot, beside main's:**

| Tree | Result |
|---|---|
| main 4008ee8 (INTEGRATION-1A, the same seeds) | `4.0 pts [-0.1, 8.1]` |
| here, 92ff69f | `3.3 pts [-0.7, 7.2] n=400` |
| the cloud's integration 2 and final gate | 3.3 |
| 1b | 2.8 |

It fails the +5 gate as main does.

**The same games:** `eval-hashes.log` shows `3240 battles, 3240 hash equal, 0 differ` against the cloud's
`final2-s1seeds`, and the same against `int2-s1seeds`. Against int1a's run of main's seeds, 758 of 3240 differ: status2
changes decisions, as expected.

**Machine load** (`eval-load.tsv`, sampled every 30 s):
- 23 samples, total CPU mean 74.0 % of 16 logical CPUs.
- Other processes, outside the eval, used a mean of 1.58 cores (max 2.04): OneDrive sync about 1 core, then cli-proxy-api,
  Edge and Discord.
- No other node or test process ran; the other Claude session ran nothing during the eval.

## 4. Live check: the signed-in 2v2 calculator, 1280 px and 375 px

**Setup:**
- `next dev` from the worktree (92ff69f) on port 3006, through a temporary `.claude/launch.json` entry and a temporary
  `turbopack.root` in the worktree's `next.config.ts`. Both were removed afterwards, and no `next build` ran.
- The user signed in; no credentials were typed.
- Game: Scarlet and Violet, 2v2.
- Teams came from pasted Showdown text, which is session-only (the calculator only reads league rosters from Supabase):
  - your side: Ambipom, Gardevoir, Oranguru, Porygon2, Corviknight, Gyarados;
  - the opponent: Snorlax, Garchomp.
- **1280 px:** desktop layout, Pokémon placed from the roster rails.
- **375 px:** a fresh load with mobile emulation (Android user agent, touch). The compact layout was rebuilt from scratch,
  with Pokémon placed through each slot's Build settings roster.

**Every scenario gave identical text at both widths.**

| Scenario | What was checked | Seen |
|---|---|---|
| U-turn, no bench | Ambipom U-turn into Snorlax, Gardevoir Moonblast into Garchomp, Snorlax Body Slam into Ambipom, Garchomp Dragon Claw into Gardevoir | `Turn not estimated: Ambipom switches out: the replacement is not known.`; the Bench shows for your side only |
| Bench and Replacement | add Corviknight and Gyarados (and Porygon2) | `Bench : your side`, rows with HP and Status; `Replacement: Ambipom` with `Next on the bench` and the bench Pokémon; default: `Ambipom switches out; Corviknight comes in.` with `Assumes Corviknight comes in for Ambipom.` (at 375 px with Porygon2 on the bench, team order: Porygon2) |
| U-turn with a chosen replacement | Replacement Gyarados | `Ambipom switches out; Gyarados comes in. Snorlax: −1 Attack. Garchomp: −1 Attack.`; the assumption line is gone; Snorlax's Body Slam now targets Gyarados; card `Ambipom switches out at 135 HP.` (Life Orb) |
| Hazards | Stealth Rock and Spikes 2 on your side; Gyarados, then Porygon2 | `Hazards : your side` with Stealth Rock, Sticky Web, Spikes 0–3, Toxic Spikes 0–2; Gyarados (Flying): `Gyarados loses 42 HP (Stealth Rock).` only; Porygon2: `Porygon2 loses 20 HP (Stealth Rock).` `Porygon2 loses 26 HP (Spikes).` and `Porygon2: +1 Attack.` (Download) |
| Instructed U-turn | Trick Room; Oranguru Instruct into Ambipom; Ambipom Double Hit into Snorlax with Last move U-turn at Snorlax; Snorlax Body Slam into Ambipom; Garchomp No move; bench Corviknight | Last move on Ambipom, Snorlax, Garchomp (not Oranguru); Replacement appears only once Ambipom's Last move is U-turn: `Replacement: Ambipom`; `Instruct: Ambipom uses U-turn again.`; `Ambipom switches out; Corviknight comes in.`; `Ambipom switches out at 39–54 HP.` (Body Slam 81–96 and Life Orb 15 of 150); the facts `Trick Room: slower Pokémon move first.`, `Assumes Ambipom's U-turn has PP left.` (oracle case RV2-V-INSU-BENCH) |
| Conversion 2's Last move on its target | Porygon2 Conversion 2 into Snorlax; Snorlax Body Slam into Porygon2; Gardevoir and Garchomp No move | Last move on Gardevoir, Snorlax, Garchomp, not on Porygon2; with Snorlax's Unknown: `Turn not estimated: Conversion 2 needs Snorlax's move from the last turn.`; with Body Slam: `Porygon2 becomes Ghost type (33.33%).` / Rock / Steel, then Body Slam `19–23 damage` and `Body Slam has no effect on Porygon2 (33.33%).` (oracle case R6-CONV2) |
| Layout, every state above | loaded and with every `<details>` open; Field conditions open | 1280 px: `scrollWidth 1265 / clientWidth 1265` (scrollbar), 0 elements past either edge; 375 px: `scrollWidth 375 / clientWidth 375`, 0 past the edge; no position word (left, right, slot, position; the cloud's regex) in the visible text or in the 250–262 control names; no unnamed control |
| Kept list | Field conditions | "Battle states that cannot be set here" is there, with R6-4's grounding and stat-split items |
| Errors | console, server log | no console errors; `No server errors found.` |

Screenshots: `live-1280-conversion2.jpg`, `live-375-uturn-hazards.jpg`.

## 5. Push to `wip/status2-cache`

**Commit:** `863da67 Add the local-only status2 case files and harness folders`, on 8a31560. Pushed as a fast-forward:
`8a31560..863da67`. Nothing was merged.

**How it was built:** with a temporary index (`GIT_INDEX_FILE`), so the shared working tree's index was not used.

**Contents:** 5272 new files and no changed ones.
- the 20 case files;
- `2v2/verify/v1/fixtures` (2) and `2v2/verify/v3/{gen,gen-r,logs,tools,tsc,app-hz}` (28);
- `status2/build/fling`: 26 files, golden-before and golden-diff.ts with the files it imports;
- `status2/build/int1b`: 5196 files (its other 39 were already on the branch and are identical).

**Checks:**
- The secret scan found only SQL role names in copies of the repo's `tests/db` files.
- A sample of 44 pushed blobs is byte-equal to the local files.

**A second commit, on 863da67:** this file and `build/local-checks/` (the logs and the two screenshots), at the user's request.
Still not pushed: the eval run (`training/eval/local-s1seeds`) and the two pinned `node_modules/.cache/champions` files.

## Observations, none a status2 regression

1. **A step that never moves is listed first, as `1 ·`.**
   - Example: the instructed U-turn shows `1 · Double Hit · Ambipom … Switches out before it moves.` and then `2 · Body Slam`,
     though Body Slam's position is 1.
   - **Cause:** `doubles-turn.ts` sorts steps by mean position, with 0 for a step that never moved, and `DoublesTurn.tsx`
     numbers them by index.
   - **Not a numbers issue:** the steps' `order` positions are right.
   - **Predates status2:** both lines are the same on 4008ee8, where `Faints before it moves.` behaves the same way.
2. **The v3 harness test spawns `npx` without a shell** (1h). It fails on Windows only.
3. **gen-tests `--keep-rows` on a CRLF checkout** reports every row as different (1c note).
4. **`git archive … | tar -x` on this machine needs `-c core.autocrlf=false`** to keep the branch's bytes.

## Cleanup and what is left in place

- **The worktree `C:\Users\evanb\s2check` was removed** at the user's request, after its outputs were copied here.
  - Its `node_modules` junction was deleted first, with `(Get-Item …).Delete()`. The main tree's `node_modules` kept all 338
    entries.
  - Then `git worktree remove --force` and `git worktree prune` ran; `git worktree list` shows only the main tree.
- **The other session's branch, `feat/castmirror-native-execution`, and its uncommitted files** in the main tree are
  untouched.
- **`../status2-1b`** (1b's app results) and the scratchpad backup of the four Training gate files.
- **The local `calc-2v2-status-2` branch**, at fec03d5.
