# Handoff: status2 back to the local machine

Written on 2026-10-13, at the end of the cloud session that finished status2. **status2 is merged into `main`.** What is left
is checks the cloud container could not run, plus non-blocking open items. This file is gitignored; it travels on
`wip/status2-cache`.

## Where things are

| Ref | Commit | What it holds |
|---|---|---|
| `main` | `92ff69f` | `Merge status2: …` (`--no-ff`) on top of `cb5b2b5`. Every CastMirror commit on main is kept; status2 touches no CastMirror or RaidCard file. |
| `calc-2v2-status-2` | `c9eb1ac` | One squashed commit, `Model the 2v2 status moves left out and remove the remaining narrow guards (status2)`. It was force-pushed because the squash replaced the WIP commits. It is merged and finished: start any new work on a new branch from `main`. |
| `wip/status2-cache` | `015bc78` + this file | An orphan branch holding the gitignored working files (never merge it): specs, every build note, the 2v2 oracle harness with all stored results, Training gate outputs, and the pinned Showdown archive (`pinned/`, from 11 Oct). |
| `feat/castmirror-live-parity` | — | Not this work; ignore. |

`HANDOFF-status2.md` was removed from the repo in the squash; this file replaces it.

## Get the local machine up to date (from the repo root, Git Bash)

```bash
git fetch origin
git checkout main
git pull --ff-only                       # → 92ff69f
git branch -D calc-2v2-status-2          # optional; the local copy still holds the old WIP commit fec03d5

# Keep integration 1b's app results: the "before" set for changed-cases (step 1 below).
mkdir -p ../status2-1b && git archive d12f052 scripts/.cache/calc-audit/2v2/verify/app-results | tar -x -C ../status2-1b

# Bring in the cloud session's working files. tar overwrites only the files that are on the branch, so the
# local-only case folders listed below are left alone.
git archive origin/wip/status2-cache scripts | tar -x
```

- No `npm ci` is needed: no dependency changed (main changed only `package.json` scripts).
- Do not re-extract `pinned/`; the local `node_modules/.cache/champions` is complete.
- `.claude/launch.json` stays untracked.

**The local machine has files the cloud never had.** These 20 case files were empty stubs in the cloud. The stubs were
never pushed, so the archive does not overwrite the real files. Paths are relative to `scripts/.cache/calc-audit/`:

- `2v2/fix-engine/cases3.ts`, `2v2/review-engine/cases.ts`, `2v2/fainted-engine/cases-fainted.ts`
- `zmove-status/fix/cases-zs.ts`, `zmove-status/verify/cases-zv.ts`
- `serene-arceus/fix/cases-sa.ts`
- `forms-iceface-fling/fix/cases-fif.ts`, `forms-iceface-fling/verify/cases-v.ts`
- `ngas-pp/fix/cases-ng.ts`, `ngas-pp/verify/cases-vg.ts`, `ngas-pp/verify/cases-vgx.ts`
- `status-eot/review/{status-move,eot-training,track-e}/cases.ts`
- `status-eot/fix-engine/cases.ts`, `status-eot/verify-engine/cases{,2,3,4}.ts`
- `status-eot/build/verify-eot-probes/cases.ts`

Also missing in the cloud:
- the harness folders `2v2/verify/v1/fixtures`, `v3/gen`, `v3/gen-r`, `v3/logs`, `v3/tools`, `v3/tsc` and `v3/app-hz`;
- F's `fling/golden-before` and `fling/golden-diff.ts`;
- most of `status2/build/int1b`;
- in `node_modules/.cache/champions`, the compiled dex `showdown-dex-c23d2e94…` and `damage-calc-e7fd7e59….tar.gz`.

## What the cloud session did

Read these first, in `scripts/.cache/calc-audit/status2/build/`:

- **`FINAL2.md`:** the final gate, with every gate's exact output, the reviews, decision time and what is left. Its Status
  section predates the merge; the merge is described below.
- `INTEGRATION-2.md`, `REVIEW2-FIX-1.md`, `REVIEW2-FIX-2.md`, `REVIEW2-<lens>-r1.md`, and the wave 2 track notes
  `STEP2.md`, `W2-R-E.md`, `W2-R-U.md`, `W2-R-T.md`, `W2-R-V.md`, `W2-GAPFIX.md`.

In order:
1. **Wave 2 (switch-outs with a replacement)** was finished: R-E engine, R-T Training, R-V oracle, then a completeness critic
   and a gap fix.
2. **Integration 2** was run with every gate.
3. **Two review rounds** (ADDENDUM2 §8.8; seven reviewers each, every finding independently verified):
   - round 1: 36 findings (22 blocking), all fixed;
   - round 2: 25 findings, all fixed.
   - Nine round-1 fixes and three round-2 fixes keep a narrow one-line fact reason, listed in REVIEW2-FIX-1/2.md.
   - 369 review oracle cases are stored in `2v2/verify/cases-review2.ts` (`RV2-…`).
4. **The final gate.** On the cloud's coverage:
   - 2314/2314 loadable oracle cases agree (1769 stored + 545 wave 2 and review cases);
   - 3 stored cases changed since 1b, all listed and matching the oracle;
   - the generated test has 2489 rows;
   - `npm run check` passed: 262 files, 8415 tests;
   - golden-1v1 is byte-equal except the 110 Fling rows;
   - census, budget and the static layout at 375 and 1280 px pass;
   - conformance and leak pass;
   - eval: HabitBot fails at 3.3 pts, as on main (4.0); its time rows cannot pass on 4 CPUs (main fails them there too).
5. **The merge** (the user said "commit push merge"): the handoff file was removed, the WIP commits were squashed, and the
   squash was merged `--no-ff` onto `main` (`cb5b2b5`). Checks on the merge result:
   - CastMirror parity, lint and typecheck pass;
   - 8801 tests pass; the only failures are the two noted below;
   - golden-1v1 is byte-equal.

   Two test-timing fixes went into the squash, with no assertion and no app code changed:
   - `tests/unit/calculator-after-use.test.ts`: the single-hit sweep (over 5000 rows) gets a 30 s timeout. It took
     4.5–5.5 s against the 5 s default, on main too.
   - `tests/unit/naming-guard.test.ts`: `settled()` also waits, in real time with a 20 s deadline, while the page shows
     `HP preview paused while the calculator loads.`. Run on its own, the file read the page before status2's larger engine
     had loaded. The source-scan test gets a 30 s timeout.

   The final gate had already moved the 7.5 MB generated `doubles-turn-showdown.test.ts` into its own vitest group
   (`showdown`, run last; `tests/unit/vitest-unit-groups.test.ts`).

**Not status2's:** on `main`, `tests/unit/castmirror-transport.test.ts` fails "HTTP 429 …" and "HTTP 503 honors 500/1000ms
waits…" at line 160 (`vi.getTimerCount()` 0, expected 1). It fails identically on `cb5b2b5` without status2. It belongs to
the CastMirror work; status2 does not touch it.

## What is left, in order

1. **Run the 544 stored cases the cloud could not load.**
   ```bash
   STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts
   npx --no-install tsx scripts/.cache/calc-audit/status2/build/changed-cases.ts diff ../status2-1b/scripts/.cache/calc-audit/2v2/verify/app-results scripts/.cache/calc-audit/2v2/verify/app-results --wave=all
   STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts --keep-rows=tests/unit/doubles-turn-showdown.test.ts
   npx vitest run --config vitest.unit.config.ts tests/unit/doubles-turn-showdown.test.ts
   npm run check
   ```
   Expected:
   - compare: every case matches, about 2331 + 545 cases;
   - changed-cases: `0 failing the gate`, any change listed;
   - gen-tests: no `has a different row now`; the 282 rows kept for those cases should now come out the same from their
     cases;
   - the harness tests' four stub failures (v1 G4-OPP-11 and RT-RV02, v2 R09, v3 ZS16) pass.

   Any case that does not match is a real regression of status2 against pinned Showdown. Fix it exactly, with a test and the
   case, on a new branch from `main`.
2. **`npm run test:battle-data:source`.** All 11 files should run here: the cloud ran only 8 (63 tests), and 91 tests never
   ran (battle-data 66, doubles-ability-table 6, doubles-status-moves 19).
3. **Decision time on the quiet reference machine** (FINAL2 §4):
   `npm run eval:training -- --gates --scale 1 --shards 8 --run s1-step1`.
   - The cloud's paired estimate scaled to this machine is a worst-run p95 of 638 ms (range 617–720), against SPEC2's 634 ms.
     The eval gate's 800 ms holds in every estimate.
   - Report HabitBot beside main's.
4. **Live check:** the signed-in 2v2 calculator at 1280 px and 375 px. Cover the Bench, Replacement and hazard controls, a
   U-turn with a chosen replacement, an instructed U-turn, and Conversion 2's Last move on its target. Never type
   credentials.
5. **Push the local-only folders** (the 20 case files and the harness folders above) to `wip/status2-cache`, so a future cloud
   session has them.
6. **Open items, none blocking** (FINAL2 §5 item 8):
   - a newcomer's form-changing Start (Shields Down, Schooling, Ice Face) stays not estimated;
   - R-V's contract gap: a landing whose user is a bench Pokémon dragged in before the residual;
   - the Pledge and Round sourceEffects note in sim-dfs;
   - the AI's later replacement pick is ranked as for its first slot;
   - `turnBenchNames` with a fainted slot;
   - no bridge-level Training test for a called Instruct's stall streak;
   - seven review cases have no `--validate` replay cross-check (replay cap);
   - polish: Tera Type names, a newcomer's Intimidate shown as plain stage facts, the docs/training.md gate 4b sentence.

## House rules (unchanged)

- **Numbers:** exact against pinned Showdown c23d2e94 in sv, champions, swsh and usum. Otherwise the turn is "not
  estimated", with a one-line fact as the reason.
- **Text:**
  - UI text states facts only, with no tutorial or instruction text.
  - Pokémon are named by name (`nameText`), never as left or right.
- **Regression:**
  - 1v1 stays byte-equal, except the 110 accepted Fling rows.
  - The stored oracle cases keep agreeing; any change is listed by `changed-cases.ts`.
- **Training:** never reads hidden information.
- **Never:** run `next build`; modify `node_modules`; run anything against live Supabase or run seed scripts; touch
  CastMirror or RaidCard files.
- **Keep:** the "Battle states that cannot be set here" list.
- **Commits:** keep `.claude/launch.json` untracked (`git add -A -- . ':!.claude'`). Commit, push or merge to `main` only
  when the user says so.
