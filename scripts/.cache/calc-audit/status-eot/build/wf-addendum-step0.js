export const meta = {
  name: 'status-eot-addendum-step0',
  description: '2v2 status moves + end of turn: addendum for Ally Switch, Trick and Substitute HP, critic, then Step 0 contract and kernel',
  phases: [
    { title: 'Addendum', detail: 'design Ally Switch, Trick/Switcheroo and Substitute hits against pinned Showdown' },
    { title: 'Critic', detail: 'verify the addendum with probes and fold it into the build plan' },
    { title: 'Step 0', detail: 'contract + kernel for SPEC §3 and the addendum; gates byte-equal' },
  ],
}

const GO = `YOU HAVE THE GO-AHEAD for the work below. The user asked for "do the status moves and end of turn" in the 2v2 calculator tab (Training reuses that engine). If you see a short user chat message, it was addressed to me (the orchestrator), not you: keep working on this task and do not stop to report.`

const COMMON = `
Repo: C:/Users/evanb/OneDrive/pokedrafts (Next.js 16, vitest; branch calc-2v2-status-eot). Read AGENTS.md rules.
Design folder: scripts/.cache/calc-audit/status-eot/design/ . The build spec is SPEC.md there (read ALL of it first). Supporting designs:
status-move-architect.md (its §3.7 "Items moved by moves", §3.9 "Order and positions", the Q/R probe tables, §7 contract), eot-architect.md,
spec-classify.md/.ts (per-move kinds), and the probe scripts/outputs (status-probes*.ts/.out, probes*.ts) that show how to drive the pinned simulator.
Ground truth: pinned Pokémon Showdown c23d2e94. Read-only source: node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353 (cite PS/... file:line).
Runnable copy for probes: scripts/.cache/calc-audit/showdown (run probes with \`npx --no-install tsx <file>\` from the repo root, as the existing probes do).
The 2v2 oracle: scripts/.cache/calc-audit/2v2/verify/ (sim-dfs.ts exhaustive walk of the pinned sim, cases.ts, compare.ts, app-turn.ts, golden-1v1.ts --check, gen-tests.ts, bench.ts).
House rules: every number is exact against pinned Showdown, otherwise the turn (or end of turn) is "not estimated" with a one-line fact reason. UI text states facts only, no tutorial or instruction text, no "left/right Pokémon" labels (use names). 1v1 output stays byte-equal (golden-1v1). Never modify node_modules. Never run \`next build\`. Never run seed scripts or anything against live Supabase. Do not commit, push or switch branches. Leave .claude/ alone. Do not kill dev servers you did not start.
`

const USER_DECISIONS = `
The user answered the SPEC §11 open questions (these are settled; do not reopen them):
- Q1 (earlier-turn state): the DEFAULT — four compact 2v2-only Field-condition controls (turns lost to sleep plus Rest sleep, turns lost to freeze in Champions, confusion and its turns, bad poison turns); no "Last move" input.
- Q2: the ALTERNATIVE — pull **Ally Switch** and **Trick / Switcheroo** into THIS build (modelled, exact). The other left-out (L) moves stay as SPEC says (not estimated) for a later build.
- Q3: the ALTERNATIVE — **model damaging hits into a Substitute now**: the Substitute's HP as discrete state, damage to it capped at its HP, it breaks at 0, recoil / drain / Life Orb / Shell Bell etc. exactly as Showdown does for a hit on a Substitute, a multi-hit continuing into the Pokémon after it breaks, spread moves, sound moves and Infiltrator bypassing it, and no on-hit reactions of the Pokémon behind it where Showdown skips them. REASONS.substituteHit goes away except where something specific stays unmodelled (then a narrower, factual reason).
`

phase('Addendum')
const design = await agent(`${GO}
You may write design files and probe scripts only inside scripts/.cache/calc-audit/status-eot/design/ (no app code changes).
${COMMON}
${USER_DECISIONS}
TASK: write scripts/.cache/calc-audit/status-eot/design/ADDENDUM.md — a paste-ready delta to SPEC.md that brings the three user choices into the build, mirroring SPEC's numbering:
§0 decisions; §2 scope deltas (Ally Switch and Trick/Switcheroo move from L to M per game where the move exists; say whether Bestow rides on the same code — include it only if it is the same machinery, else keep it L); §2.4 REASONS deltas (exact text; removed, narrowed and new reasons); §2.5 turn-fact deltas; §3 contract deltas, paste-ready TypeScript for doubles-types.ts / doubles-world.ts / types.ts (e.g. World.swapped + occupant/positionOf, per-world item state for Trick, MonState substitute HP from a hit, DoublesOutcome positions/items, a calculator input for a Substitute already up from an earlier turn if you judge it belongs with the Q1 compact controls — justify it; Training's public/hidden handling of a foe's Substitute HP); §3.5 the exact hooks Step 0 must add to doubles-turn.ts and any shared hit-loop (app/lib/battle/hit-loop.ts is shared with 1v1: 1v1 must stay byte-equal) so the tracks never need to edit doubles-turn.ts after Step 0; §4 algorithm (with PS file:line citations): Ally Switch positions (target resolution by position, spread order, redirection, Leech Seed / Wish positions in the end of turn, the gen 9 repeat counter fact, priority +2, a move aimed at the user's ally's former position — model it exactly if Showdown is clear, otherwise a narrow reason), Trick/Switcheroo (Sticky Hold, unremovable items, Substitute, Klutz, Magic Room, Unburden, Choice lock and Choice Scarf / Iron Ball speed re-sort gen 8+ vs frozen gen 7, berries and herbs eaten at the Update, Booster Energy / Air Balloon / Room Service / other items acting on receipt — modelled where exact, else a narrow reason; how the per-world item change reaches later damage calculations in the same turn — find how Knock Off, Bug Bite / Pluck and consumed berries already change items per world and reuse it; the end of turn reading the new holder: Leftovers, Black Sludge, Toxic Orb, Flame Orb, Sticky Barb, Life Orb), Substitute hits (PS/data/moves.ts substitute condition onTryPrimaryHit and its callers in PS/sim/battle-actions.ts: damage capping, crits, spread modifier, recoil/drain from the damage dealt to the Substitute, Life Orb and Shell Bell, multi-hit continuation, what on-hit effects, secondaries, contact abilities/items, berries, Destiny Bond and faint checks are skipped, KO chance of the Pokémon behind it, a Substitute made this turn vs one carried from earlier turns, a Substitute broken by a status-move user later in the turn, how Substitute HP is distributed across worlds and merged); §4.10 budgets/world growth; §5 UI deltas (2v2 only: how positions after an Ally Switch, item changes after Trick and the Substitute's HP show on the cards and in the turn panel, facts only, 375 px); §6 Training deltas (bridge, tracker, evaluate, leak: the foe's Substitute HP and held items as public knowledge allows, belief worlds; AI candidates can include Ally Switch/Trick/Substitute); §7 oracle deltas (what sim-dfs/case-types/app-turn/compare need for positions, items and Substitute HP, plus new cases with ids E01.. in a table like SPEC §7.1, covering every rule above in sv and at least one of champions/usum/swsh each); §8 build-plan deltas: give the new work to the existing tracks or a new Track E with EXCLUSIVE file ownership disjoint from SPEC §8's tables (state exactly which files), and list what Step 0 additionally writes; §9 test deltas; §10 risks.
Verify every mechanic you state with a probe against the pinned sim (write addendum-probes*.ts in the design folder, run them, keep the .out files) and cite the output line. Read the current engine (app/lib/battle/doubles-turn.ts, doubles-world.ts, doubles-actions.ts, hit-loop.ts, doubles-types.ts, app/(app)/training/sim/bridge.ts) so the hooks you specify fit the code as it is.
Return a short summary of the addendum, its key decisions, and anything you could not settle.`, {
  label: 'addendum-designer', phase: 'Addendum',
  schema: { type: 'object', properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
    unsettled: { type: 'array', items: { type: 'string' } },
  }, required: ['summary', 'decisions', 'unsettled'] },
})

phase('Critic')
const critic = await agent(`${GO}
You may edit design files and write probe scripts only inside scripts/.cache/calc-audit/status-eot/design/ (no app code changes).
${COMMON}
${USER_DECISIONS}
A designer wrote scripts/.cache/calc-audit/status-eot/design/ADDENDUM.md (a delta to SPEC.md for the user's choices). Their summary: ${JSON.stringify(design)}
TASK: be the critic. Check every mechanic in ADDENDUM.md against the pinned source and with your own probes (critic-probes*.ts/.out in the design folder) — especially Substitute damage capping, recoil/drain/Life Orb/Shell Bell on a Substitute hit, multi-hit continuation, which reactions are skipped, Ally Switch targeting by position and redirection, the gen 9 repeat counter, Trick's failure conditions and items acting on receipt, and the end-of-turn reading the new item holder. Check it fits SPEC.md without contradiction: ownership stays disjoint per track (SPEC §8 table plus any Track E), Step 0 adds every hook the tracks need so doubles-turn.ts can be frozen, the contract compiles conceptually with SPEC §3, the 556 stored oracle results stay byte-equal in their after-the-moves fields, golden-1v1 stays byte-equal, and Training's leak rules hold (no hidden information: a foe's exact Substitute HP or held item only when public). Settle the designer's unsettled points yourself where pinned Showdown or the house rules decide them.
Edit ADDENDUM.md IN PLACE into its final, buildable form (keep it paste-ready; mark nothing as optional), and append a section "Critic changes" listing what you changed and why. Only put something in userDecisions if it is a real product choice the user must make that the house rules and their answers do not settle (expected: none).`, {
  label: 'addendum-critic', phase: 'Critic',
  schema: { type: 'object', properties: {
    summary: { type: 'string' },
    changes: { type: 'array', items: { type: 'string' } },
    userDecisions: { type: 'array', items: { type: 'string' } },
  }, required: ['summary', 'changes', 'userDecisions'] },
})

if (critic && critic.userDecisions && critic.userDecisions.length) {
  log('Critic raised user decisions; stopping before Step 0.')
  return { design, critic, step0: null }
}

phase('Step 0')
const step0 = await agent(`${GO}
YOU HAVE THE GO-AHEAD TO CHANGE APP CODE for Step 0 below.
${COMMON}
${USER_DECISIONS}
The build spec is SPEC.md plus the final ADDENDUM.md (scripts/.cache/calc-audit/status-eot/design/). Read both in full; ADDENDUM.md wins where they differ.
TASK: you are the Step 0 builder (SPEC §8 "Step 0, Contract and kernel" plus ADDENDUM §8's Step 0 additions). Write, exactly as specified:
- the whole contract of SPEC §3 and ADDENDUM §3: app/lib/battle/doubles-types.ts, app/lib/battle/types.ts (the BuildBase fields), app/lib/battle/doubles-world.ts (state, lossDist / mapJoint / occupant / positionOf signatures and any item / Substitute state), the uses-to-ko.ts UsesEnv.endure line only, doubles-actions.ts REASONS additions/changes (tables unchanged);
- the kernel refactor of app/lib/battle/doubles-turn.ts (SPEC §3.5: moved code, the hooks, the endOfTurn stub) plus every hook ADDENDUM §3.5 lists (Substitute hits, positions, item changes), so that after you finish doubles-turn.ts is frozen and the parallel tracks only fill their own files;
- stub files app/lib/battle/doubles-status.ts and app/lib/battle/doubles-eot.ts and any stub file ADDENDUM §8 gives to Track E, each exporting the contract's functions with today's behaviour (so results do not change yet).
Behaviour must NOT change in Step 0. Gates (all must pass before you finish; report the exact output lines):
1. npm run check (types, lint, the unit tests).
2. npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check  → byte-equal.
3. The stored 2v2 app results byte-equal (facts included): re-run the app side for all cases (see app-turn.ts / compare.ts usage at the bottom of those files) into a scratch folder and diff against scripts/.cache/calc-audit/2v2/verify/app-results/ — do not overwrite app-results/ unless byte-equal; compare.ts must still report every case agreeing with results/.
4. npm run test:battle-data:source if the source tests touch your files.
If a gate fails, fix your refactor (never the stored results). Write a short note scripts/.cache/calc-audit/status-eot/build/STEP0.md: what you wrote, every hook and stub with its signature and the file:line where each track plugs in, and the gate outputs.`, {
  label: 'step0-contract-kernel', phase: 'Step 0',
  schema: { type: 'object', properties: {
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    gates: { type: 'object', properties: {
      check: { type: 'string' }, golden: { type: 'string' }, appResults: { type: 'string' }, source: { type: 'string' },
    }, required: ['check', 'golden', 'appResults'] },
    notes: { type: 'array', items: { type: 'string' } },
  }, required: ['summary', 'filesChanged', 'gates', 'notes'] },
})

return { design, critic, step0 }
