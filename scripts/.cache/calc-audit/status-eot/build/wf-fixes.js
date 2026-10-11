export const meta = {
  name: 'status-eot-fixes',
  description: '2v2 status moves + end of turn: fix the 31 verified review findings (engine, end of turn + Training, UI), verify each fix against pinned Showdown, then run every gate',
  phases: [
    { title: 'Fix', detail: 'three fixers on disjoint files' },
    { title: 'Verify', detail: 'one independent verifier per fixer' },
    { title: 'Gates', detail: 'review cases into the oracle set, all gates, regenerated tests' },
  ],
}

const GO = `YOU HAVE THE GO-AHEAD TO CHANGE CODE in the files this prompt gives you. The user asked for "do the status moves and end of turn" in the 2v2 calculator tab (Training reuses that engine), including Ally Switch, Trick/Switcheroo and modelled hits into a Substitute; the build is done and four reviewers found verified problems that you now fix. If you see a short user chat message, it was addressed to me (the orchestrator), not you: keep working and do not stop to report.`

const COMMON = `
Repo: C:/Users/evanb/OneDrive/pokedrafts (branch calc-2v2-status-eot; the uncommitted working tree is the build). Spec: scripts/.cache/calc-audit/status-eot/design/SPEC.md + ADDENDUM.md (ADDENDUM wins). Build notes: scripts/.cache/calc-audit/status-eot/build/STEP0.md, TRACK-A..E.md, INTEGRATION.md.
THE FINDINGS: scripts/.cache/calc-audit/status-eot/review/reviews.json (reviews[].lens, findings[] with id, severity, title, repro, evidence, file, fix). Each reviewer's probes, case files and runners are under scripts/.cache/calc-audit/status-eot/review/<folder>/ (status lens: status-move/ with run.ts + cases.ts + log-probe.ts; eot-training lens: eot-training/; positions-items-sub lens: track-e/ with run.ts; ui lens: ui/). Use them to reproduce each finding BEFORE fixing and to confirm it AFTER (oracle sim-dfs vs app-turn via compare, or the probe's own check). A reviewer's proposed fix is a suggestion: implement what pinned Showdown actually does.
Ground truth: pinned Pokémon Showdown c23d2e94 (read-only source node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353; runnable copy scripts/.cache/calc-audit/showdown; \`npx --no-install tsx <file>\` from the repo root). Oracle: scripts/.cache/calc-audit/2v2/verify/ (sim-dfs.ts, app-turn.ts, compare.ts, golden-1v1.ts --check, gen-tests.ts, bench.ts); existing cases must keep agreeing (compare.ts over all cases).
House rules: every number exact against pinned Showdown, otherwise "not estimated" with a one-line fact reason (a narrow guard is acceptable where exact modelling is out of reach — say so). UI text facts only (no tutorial/instruction text, no left/right labels in NEW text; use names). 1v1 output stays byte-equal (golden-1v1 --check) unless a fix corrects a verified 1v1 mismatch with Showdown: then list every changed golden row, verify each against pinned Showdown, and refresh only those rows. Never modify node_modules. Never run \`next build\`. Nothing against live Supabase. Do not commit, push or switch branches. Leave .claude/ alone. Do not kill dev servers you did not start. The user said: "Do not remove the Battle states that cannot be set here I will be fixing those later."
PARALLEL WORK: three fixers edit the same working tree at once, each only in its own files (listed below). Failures in another fixer's files are their work in progress — run your own tests by path (npx vitest run <paths>), re-run tsc later, never edit another fixer's files; put cross-area needs in needsFromOthers. Add a regression test (unit test or oracle case) for every finding you fix.
`

const RESULT = { type: 'object', properties: {
  summary: { type: 'string' },
  perFinding: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, outcome: { type: 'string', enum: ['fixed', 'guarded', 'not-a-bug', 'not-fixed'] }, detail: { type: 'string' },
  }, required: ['id', 'outcome', 'detail'] } },
  filesChanged: { type: 'array', items: { type: 'string' } },
  tests: { type: 'string' },
  needsFromOthers: { type: 'array', items: { type: 'string' } },
}, required: ['summary', 'perFinding', 'filesChanged', 'tests', 'needsFromOthers'] }

const FIXERS = [
  { key: 'engine', owns: `app/lib/battle/doubles-status.ts, status-table.ts, doubles-turn.ts, doubles-world.ts, doubles-actions.ts, doubles-targets.ts, stat-moves.ts, calculate.ts, uses-to-ko.ts, hit-loop.ts, doubles-items.ts, doubles-substitute.ts, doubles-positions.ts, doubles-types.ts, and their tests under tests/unit and tests/source (not the calculator-doubles-ui test, not residuals/doubles-eot/training tests)`,
    ids: `status lens: H1 H2 H3 H4 H5 H6 H7 H8 M1 M2 M3 M4 L1 L2 L3; positions-items-sub lens: F1 F2 F3 F4; ui lens: F1 (engine side: a start status or confusion the Pokémon's own ability cures at the first Update — Immunity, Pastel Veil, Insomnia, Vital Spirit, Limber, Magma Armor, Water Veil, Water Bubble, Thermal Exchange, and Own Tempo for confusion (ui F2's engine side) — must be cured at the turn's first Update exactly as Showdown does, with a fact, ability suppression respected)`,
    extra: `For positions-items-sub F3 (Air Balloon under Klutz / Magic Room) fix it in turn mode and in 1v1 if 1v1 has the same mismatch (verify with a 1v1 probe vs Showdown and follow the golden rule above). For status H8 (already on main) fix it too. Group H2/H3/M1/M3 (stat-change event recording for Eject Pack, Opportunist, Mirror Herb, Defiant/Competitive, Illuminate) into one design.` },
  { key: 'eot-training', owns: `app/lib/battle/residuals.ts, doubles-eot.ts, app/(app)/training/** (sim/bridge.ts, tracker.ts, effects.ts, services.ts, splits.ts, ai/evaluate.ts and the rest of Training), scripts/training/conformance.ts, leak.ts, eval scripts, tests/unit/residuals.test.ts, doubles-eot.test.ts, doubles-outcomes.test.ts, training-* tests, tests/source/doubles-residuals.test.ts`,
    ids: `eot-training lens: EOT-1 EOT-2 EOT-3 EOT-4 EOT-5 EOT-6`,
    extra: `After EOT-6 (compute each slot's Speed once at the residual start, as pinned updateSpeed does), re-measure the belief update p95 in the eval (npm run eval:training -- --gates --scale 1 --shards 8 --run fixes) and in a single process; reduce other avoidable allocation on the end-of-turn path if the eval p95 is still above 8 ms. For the "Reads you − Plays safe vs HabitBot" gate: do not change the gate; report its result on this run and on the seeds Track B used (--run trackb-final), and on main for the same seeds if cheap (git archive main into the scratchpad as the reviewer did; never switch branches). For EOT-5 extend conformance and leak gate coverage to the new Training fields and make gate 4b position-aware after Ally Switch.` },
  { key: 'ui', owns: `app/(app)/calculator/** (doubles-format.ts, DoublesCard.tsx, DoublesTurn.tsx, DoublesSummary.tsx, DoublesSettings.tsx, BattleConditions.tsx, doubles-prep.ts, useDoublesView.tsx, useDoublesCalculation.ts, calculator.module.css) and tests/unit/calculator-doubles-ui.test.ts (plus other calculator UI tests)`,
    ids: `ui lens: F2 (UI side: no Confused control for an Own Tempo Pokémon; reconcileCarried drops it), F1 (UI side: carriedOptions offers no sleep/freeze/bad-poison counter control for a Pokémon whose own ability would cure that status at the first Update), F3 F4 F5 F6 F7`,
    extra: `Do NOT do ui F8 (the left/right wording inventory) — that is a separate naming pass the user will decide on. Keep 1v1 UI unchanged. 375 px with no horizontal overflow; accessible names.` },
]

const fixed = await pipeline(FIXERS,
  f => agent(`${GO}\n${COMMON}\nYOU ARE THE ${f.key.toUpperCase()} FIXER. You own: ${f.owns}.\nFix these findings: ${f.ids}.\n${f.extra}\nFor every finding: reproduce, fix (or guard narrowly with an exact REASONS text, or prove it is not a bug with a probe), add a regression test, confirm with the reviewer's repro. Write scripts/.cache/calc-audit/status-eot/build/FIX-${f.key}.md with the per-finding outcome.`,
    { label: `fix-${f.key}`, phase: 'Fix', schema: RESULT }),
  (r, f) => agent(`${GO}\n${COMMON}\nYOU ARE THE INDEPENDENT VERIFIER for the ${f.key.toUpperCase()} fixer, who owned: ${f.owns}; and fixed: ${f.ids}. Their result: ${JSON.stringify(r)}\nTASK: adversarially check each fix. Re-run every listed finding's repro (oracle vs app) and confirm it now agrees with pinned Showdown; then probe the neighbourhood of each fix (other games among sv/champions/swsh/usum, ability/item variants, the same rule in a different action order) with your own cases, and check that the fix did not break existing cases (compare.ts over the related existing cases) or 1v1 (golden-1v1 --check). Where a fix is wrong or incomplete, fix it yourself in the same files (the fixer is done; the other fixers may still be editing their own files — never touch those). Write scripts/.cache/calc-audit/status-eot/build/VERIFY-${f.key}.md.`,
    { label: `verify-${f.key}`, phase: 'Verify', schema: RESULT }).then(v => ({ key: f.key, fix: r, verify: v })),
)

phase('Gates')
const gates = await agent(`${GO}\nYOU ARE THE FINAL GATE KEEPER: the fixers and verifiers are done and you are the only editor now; you may edit any file of the build for integration fixes (minimal, noted).\n${COMMON.replace('three fixers edit the same working tree at once', 'the fixers have finished (this paragraph no longer restricts you)')}\nFix and verify results: ${JSON.stringify(fixed)}\nTASK:
1. Make every reviewer case that now agrees a permanent regression case in the oracle set (a cases-review.ts in scripts/.cache/calc-audit/2v2/verify wired in like cases-int.ts; store their oracle results), and finish RE70 / RE71 (Population Bomb / Surging Strikes into a Substitute), whose oracle had not finished during the review — run them in the background with a generous timeout and compare.
2. Run ALL oracle cases (compare.ts): every case agreeing; the earlier cases' after-the-moves fields byte-equal; regenerate app-results/ and tests/unit/doubles-turn-showdown.test.ts with gen-tests.ts.
3. npm run check green; npm run test:battle-data:source green; golden-1v1 --check byte-equal (or only verified, listed rows refreshed); bench within budget; npm run conformance:training PASS; npm run leak:training PASS (0 hits); npm run eval:training -- --gates --scale 1 --shards 8 --run final.
4. Write scripts/.cache/calc-audit/status-eot/build/FINAL.md with every gate's exact output line, all fixes, and anything still open.`,
  { label: 'final-gates', phase: 'Gates', schema: { type: 'object', properties: {
    summary: { type: 'string' },
    gates: { type: 'object', properties: {
      cases: { type: 'string' }, check: { type: 'string' }, source: { type: 'string' }, golden: { type: 'string' },
      bench: { type: 'string' }, conformance: { type: 'string' }, leak: { type: 'string' }, eval: { type: 'string' },
    }, required: ['cases', 'check', 'source', 'golden', 'bench', 'conformance', 'leak', 'eval'] },
    fixes: { type: 'array', items: { type: 'string' } },
    open: { type: 'array', items: { type: 'string' } },
  }, required: ['summary', 'gates', 'fixes', 'open'] } })

return { fixed, gates }
