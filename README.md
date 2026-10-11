# Handoff: 2v2 status moves part 2 + remaining guards (status2)

Work in progress, moved to a cloud session on 2026-10-11 because the local weekly usage limit was nearly used up.
**Delete this file before merging to main.**

## Branches

| Branch | What it holds |
|---|---|
| `calc-2v2-status-2` | the app code and tests (this file's branch), from main `4008ee8`; one WIP commit, not merged |
| `wip/status2-cache` | an orphan branch with the gitignored working files the build needs (never merge it): the specs and build notes, the 2v2 Showdown oracle harness with its stored results, the runnable pinned Showdown copy, and the pinned Showdown source archive |
| `feat/castmirror-live-parity` | not this work: another project's session committed CastMirror files there. Ignore CastMirror and RaidCard files. |

## Restore the working files (first thing in a fresh clone)

```bash
git fetch origin wip/status2-cache
git archive origin/wip/status2-cache scripts | tar -x
mkdir -p node_modules/.cache/champions
git archive origin/wip/status2-cache pinned | tar -x
tar -xzf pinned/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353.tar.gz -C node_modules/.cache/champions
mv pinned/*.json.gz node_modules/.cache/champions/ && rm -rf pinned
npm ci
```

Check: `node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353/` exists, and
`npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check` prints `254 cases byte-equal`.
`scripts/.cache/` and `node_modules/` stay gitignored; never commit them to this branch.

## The request and the user's decisions

The user asked to "do 3 and 4":
- **3:** model the 73 status moves 2v2 left out.
- **4:** remove the remaining narrow "not estimated" guards.

Their answers are final and are in `scripts/.cache/calc-audit/status2/design/USER-DECISIONS.md`:
- Switch-outs are modelled with a replacement, in the calculator (bench, replacement pick, hazards) and in Training.
- "Those plus more" earlier-turn inputs.
- The ~56 Tier 2 guards are included.
- Neutralizing Gas with the ability-changing moves is LATER.

**The spec:** `scripts/.cache/calc-audit/status2/design/SPEC2.md` + `USER-DECISIONS.md` + `ADDENDUM2.md` (ADDENDUM2 wins). Its §8 is the build plan and §8.9 the file-ownership table.

## Where it stands

**Done and green at integration 1b** (`scripts/.cache/calc-audit/status2/build/INTEGRATION-1B.md`):
- Step 0a/0b/0c, Step 1 (16 correctness fixes), wave 1a (14 tracks), the perf pass, and wave 1b (10 tracks).
- All 2331 oracle cases agree with pinned Showdown c23d2e94.
- `npm run check`: 255 files, 7699 tests.
- golden-1v1 is byte-equal except 110 verified Fling rows.
- The Training conformance and leak gates pass.
- The eval passes except the HabitBot row, which fails on main too on the same seeds.
- The Champions not-estimated share fell from 14.16 % to 7.61 %.

**Wave 2, switch-outs (stopped part-way; `npx tsc --noEmit` is clean on this commit, nothing else was run after the stop):**

| Part | State | Notes |
|---|---|---|
| Step 2 | done | the R contract; behaviour unchanged; `build/STEP2.md` has the hook map |
| R-U | done | calculator Bench, Replacement and Hazards; `build/W2-R-U.md` |
| R-E | in progress | engine: `doubles-switch.ts`, the entry pipeline, identity |
| R-T | in progress | Training's real bench and the Instruct target fix; `build/W2-R-T.md` |
| R-V | in progress | oracle SWX cases; `build/W2-R-V.md` |

Read each track's notes and its files' current state before continuing. Partial work is in the tree.

## What is left, in order

1. **Finish wave 2** (ADDENDUM2 §8.7):
   - R-E: `doubles-switch.ts`, `doubles-turn.ts`, `doubles-world.ts`, `doubles-eot.ts`, plus Assist in `doubles-calling.ts` and Beat Up / Commander / Pursuit in `doubles-presence.ts`.
   - R-T: Training's bench, the replacement policy (the healthiest bench Pokémon for the player), hazards, the prelude replacement, and the belief battle's Instruct target.
   - R-V: `sim-dfs` answering mid-turn switch requests and random drags; the SWX, IN-BNC, IN-HZD, IN-FSL-02 and Assist cases.
2. **Integration 2:**
   - all oracle cases (`compare.ts`) and `status2/build/changed-cases.ts`;
   - regenerate `tests/unit/doubles-turn-showdown.test.ts` (`gen-tests.ts`);
   - `npm run check` and `npm run test:battle-data:source`;
   - `golden-1v1 --check` (only the accepted Fling rows differ from main), and the bench;
   - `npm run conformance:training`, `leak:training`, and `eval:training -- --gates --scale 1 --shards 8 --run s1-step1` (main's seeds);
   - the census sample and the budget check;
   - write `build/INTEGRATION-2.md`.
3. **Reviews** (ADDENDUM2 §8.8): seven reviewers, then one fixer, at most two rounds. Then the final gate, written up as `status2/build/FINAL2.md`. Check the decision-time p95 on a quiet machine: it was 682–723 ms against SPEC2's 634 ms, while the eval gate of 800 ms passes.
4. **Live check:** the 2v2 calculator at 1280 px and 375 px. It needs the user signed in; never type credentials.
5. **Then stop and report.** Commit, push or merge to main only when the user says "commit push merge". When they do:
   - remove this file;
   - squash the WIP commit into a real message;
   - merge with `--no-ff` into main.

## House rules

- **Numbers:** exact against pinned Showdown in sv, champions, swsh and usum. Otherwise the turn is "not estimated", with a one-line fact as the reason.
- **Text:**
  - UI text states facts only, with no tutorial or instruction text.
  - Pokémon are named by name (`nameText`), never as left or right.
- **Regression:**
  - 1v1 stays byte-equal.
  - The stored oracle cases keep agreeing; any change is listed by `changed-cases.ts`.
- **Training:** never reads hidden information.
- **Never:** run `next build`; modify `node_modules`; run anything against live Supabase or run seed scripts.
- **Keep:** the "Battle states that cannot be set here" list.
- **Commits:** keep `.claude/launch.json` untracked (`git add -A -- . ':!.claude'`).
