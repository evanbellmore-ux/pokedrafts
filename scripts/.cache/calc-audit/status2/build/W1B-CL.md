# Track CL (wave 1b): the calling moves (`app/lib/battle/doubles-calling.ts`)

Branch `calc-2v2-status-2`, checked before the work and before this report. Owned files only:
`app/lib/battle/doubles-calling.ts`, `tests/unit/doubles-calling.test.ts`. Scratch work in `status2/build/cl/`. Nothing
committed, pushed or switched; no `next build`; nothing against live Supabase; `node_modules` and `.claude/` untouched; no
CastMirror or RaidCard file opened. Spec: ADDENDUM2 §4.3 CL, §2.3 #28 / #49 / #51, §2.4, §2.5; T2P §3.9–§3.15; T2M §3.26, §3.28.

## What is modelled now (pinned Showdown c23d2e94)

| Move | Model | Source |
|---|---|---|
| Nature Power (SwSh, USUM) | Its own use: targets (redirection), TryMove (the priority shields), its hit steps at the target (invulnerability: PR's commanding and H's hidden; Quick Guard, Psychic Terrain, the protecting moves only with the protect flag — none here; A3's Crafty Shield; Good as Gold; Prankster into a Dark foe), then the terrain's move at its target through `kernel.useCalled` with its priority and Prankster flag. Its own hit is reached once (the union with the called move's, as the oracle's sets) and an effect where the called move did not reach it (a Lightning Rod took it). Step fact `Nature Power calls {Move}.`; `effectiveName` / `effectiveType` are the called move's while one move is called. | moves.ts naturepower; battle-actions.ts useMoveInner, trySpreadMoveHit, spreadMoveHit (the move's own TryHit before the Substitute) |
| Copycat (all four) | The battle's last move (`World.lastMove`, else `battleLastMove`; absent before any action: `needsLastMoveUsed`), a Max Move's base move; `null`: `Copycat fails: no move has been used.`; failcopycat or a Z-Move: `Copycat fails: it cannot copy {Move}.`; Splash (a No move, SPEC C13): nothing. The called move at `getRandomTarget`'s pick (one world per living adjacent foe). Copycat's own hit on its user is reached and an effect. | moves.ts copycat; battle.ts clearActiveMove, getRandomTarget |
| Mirror Move (USUM) | The target's last move (this turn's `vol.usedMove`, else the input's; absent: `needsLastMove`; null or a switched-in target: fails), with the mirror flag and not a Z-Move or Max Move, at the target. | moves.ts mirrormove |
| Me First (USUM) | The target's queued move (No move is Splash): not an attack, failmefirst, a Z-Move, a Max Move, a Dynamaxed or recharging target: fails; else used at the target with 1.5x (`context`: `powerMods: [6144]`, onBasePower priority 12); a spread move stays spread. | moves.ts mefirst |
| Instruct (all four) | The target's last move (as Mirror Move's), its aim (this turn's action target, else `lastMoveTarget`; a single-target move's absent: `needsLastTarget`); fails for no last move, Dynamax, failinstruct / charge / recharge, a Z-Move or Max Move, a target charging Beak Blast, Focus Punch or Shell Trap, `ppLeft` 0. A move with a beforeTurnCallback (Counter, Mirror Coat, Pursuit, Chilly Reception) is queued as that callback alone: `Instruct: {Name}'s {Move} is not used again.`. Otherwise a new action `{ source: "instruct", order: 3 }` (generation 7: before every queued order, prioritize's rule) with `kernel.extraStep("Instruct", …)`; its step fact `Instruct: {Name} uses {Move} again.`; turn fact `Assumes {Name}'s {Move} has PP left.` (unless `ppLeft` > 3). | moves.ts instruct; battle-queue.ts prioritizeAction, resolveAction (`[0]`) |
| Sleep Talk (all four) | Asleep (after BeforeMove's sleep check) or Comatose: 1/k over its move slots (`moves`; absent: `needsMoves`) but nosleeptalk and charge moves; none: `Sleep Talk fails: {Name} has no move it can call.`; each called at `getRandomTarget`'s pick. Awake: today's fail fact. | moves.ts sleeptalk |
| Every call | ModifyMove first: Gravity, Heal Block, Throat Chop stop a called gravity / heal / sound move (`{Effect}: {Move} cannot be used.`); a called Counter or Mirror Coat fails (no beforeTurnCallback volatile); Metal Burst and Comeuppance (PR's records) not followed; a Prankster caller's damaging call into a Dark foe it picks is immune (`Prankster: {Name} is not affected.`), a spread or random-target one with a Dark foe, or a pick with a redirector on the field, not followed; a random-target move given a caller's target (Me First, Mirror Move) not followed. The called move becomes the battle's last move (also where the call stops before useCalled). | gravity / healblock / throatchop onModifyMove; battle-actions.ts:408-412 (priority, pranksterBoosted), hitStepTryImmunity |
| Uproar | `afterHit` (CL-1): after a hit that landed or met a Substitute, every sleeper in battle wakes (`build.status`, `vol.sleep`, Nightmare), fact `Uproar: {Name} wakes up.`; the user's `vol.uproar = 2` unless one stands. `uproarSleep` (CL-2): true while a Pokémon in battle (not fainted, not leaving) has `vol.uproar`. Turn fact `Assumes {Name} did not use Uproar last turn.` without `carried.uproar`. | moves.ts uproar onTryHit, self volatile, condition onAnySetStatus |
| Helping Hand twice | The kernel's count and `MoveContext.helpingHands` (C26: only through Instruct); the hook no longer guards. | moves.ts helpinghand onRestart |
| Metronome, Assist | Kept: `Metronome is not modelled in 2v2.` (ADDENDUM2 §2.3 #28's justification); `Assist needs the moves of {Name}'s party.` (wave 2). | |

Narrow guards added (each a fact reason, each with a test): `Copycat with a Z-Move is not modelled in 2v2.` (USUM: the
history keeps a Z-Move's base move); `{Caller} with Dancer is not modelled in 2v2.` and `{Caller} with Fusion Flare/Bolt …`
(a called move is the action's active move after it, which PR's Dancer and Fusion read as the caller's); `Me First with
Dancer …` (its 1.5x lasts the turn); `Instruct with Protean / Libero …` (doubles-typing.ts proteanGuard skips Instruct: CL-7;
no catalog Pokémon has both); `Sleep Talk with Protect …` with `carried.stall` > 1 (N's counter is kept for the own action
only); `Instruct with Encore …` where an Encore changed the target's move this turn; `{Caller} with No move …` for a Mirror
Move / Instruct target whose this-turn No move is Splash; a called Uproar (Copycat's) keeps `Uproar is not modelled in 2v2.`
until CL-1 and CL-2.

## Integrator lines (frozen files), exact — `cl/patch-int.cjs` applies all of them to a scratch copy

Each sets its `WIRED` flag in `doubles-calling.ts` in the same change; until then the guard stands (the reasons in brackets).

- **CL-1** `doubles-turn.ts` afterHit, last line: `callingHooks.afterHit(kernel, w, action, target, outcome, info);`
  (`WIRED.uproarHit`; until then Uproar with a sleeper or a sleep that can start keeps `Uproar is not modelled in 2v2.`)
- **CL-2** `doubles-status.ts` canStatus, after the Comatose line:
  `if (status === "slp" && callingHooks.uproarSleep(kernel, w, slot)) return from.rest ? "{Move} fails: Uproar." : \`${name} cannot fall asleep: Uproar.\`;`
  (`WIRED.uproarSleep`; with CL-1.)
- **CL-3** `doubles-status.ts`: `readsLastMove` adds `|| id === "mirrormove" || id === "instruct"`, and the usedMove line reads
  `if (action.moveId !== null && !action.external && (…))` (a Dancer's copy is no lastMove: battle-actions.ts runMove
  `if (!externalMove) … moveUsed`). (`WIRED.usedMove`; until then Mirror Move / Instruct at a Pokémon that already acted:
  `{Move} is not modelled in 2v2.`)
- **CL-4** `doubles-turn.ts` noteHistory: `if (ctx.historyReaders.lastMove && !callingHooks.ownsLastMove(moveId)) w.lastMove = moveId;`
  and executeUsed's No-move branch writes `world.lastMove = "splash"` on its go worlds (with `historyReaders.lastMove`).
  (`WIRED.history`; until then Copycat with another caller or a No move in the turn: `Copycat with {Move|No move} …`.)
- **CL-5** `doubles-status.ts` runCalledStatus, before the kind check: a called X move (and Endure, Destiny Bond), not bounced or
  snatched, runs `earlyBranch` (Sleep Talk's Protect, Copycat's Tailwind). No flag: until then such a call is
  `{Move} is not modelled in 2v2.`.
- **CL-6** `doubles-turn.ts` execute: an action with `source === "instruct"` does not advance `w.executed` (the order counts each
  Pokémon's own action, as the oracle's) and adds `(w.executed + 0.5) × mass` to its step's position for the sort.
  (`WIRED.instructOrder`; until then an Instruct that would insert an action: `Instruct is not modelled in 2v2.`)
- **CL-7** `doubles-typing.ts` proteanGuard (A2, frozen): read `callingHooks.CALLS_MOVE` (pinned callsMove, without Instruct) in
  place of `CALLING_MOVES`, and do not empty `CALLING_MOVES` (§2.4) before that line; then the Instruct + Protean guard can go.

## Gates

- `tests/unit/doubles-calling.test.ts`: this tree **28 passed, 15 expected fail** (`npx vitest run --config vitest.unit.config.ts
  tests/unit/doubles-calling.test.ts`); the scratch tree with CL-1 … CL-6 **42 passed, 1 skipped** (the unwired-only reason test)
  (`node cl/patch-int.cjs cl/int/app/lib/battle`, then `CL_INT=1 npx vitest run --config cl/int.config.mts tests/unit/doubles-calling.test.ts`).
  The 15 `needs(...)` tests are the failing tests for CL-1 … CL-6; flip them to `it()` with the lines.
- `tsc --noEmit` and eslint on both files: clean. `tests/source/status2-hooks.test.ts`: 7 passed (no import cycle).
  `golden-1v1 --check`: 254 byte-equal.
- **Oracle, V2's CL cases** (`cl/run.ts`: verify/sim-dfs.ts oracle cached in `cl/results`, verify/compare.ts compareCase), scratch
  tree: **26/33 match**. The 7: `T2M-UP-01-sv/-swsh`, `T2E-UP-01-sv/-champions` only `E2 volatile uproar` (E2's outcome list),
  `T2M-HH-01-sv/-champions` only the copy's missing Helping Hand hit (V2's compareCopies), `T2P-INS-06-sv` (V2's case: Garchomp
  122 outspeeds Oranguru 112, so Instruct reads this turn's Dragon Claw and the reason is never met). This tree (no lines):
  NAT ×4, MEF ×2, MIR-02, ST-02/02b, INS-03, CPY-02b match; the others give their guard reason.
- **Extra cases** (`cl/cases-extra.ts`, `run.ts --extra`): Gravity under Mirror Move, Prankster Copycat into a Dark foe, Copycat
  after Sleep Talk's call and after a No move, Me First into Outrage (reason), Uproar then Spore: all match but CL-X-GRV's
  `cant:gravity (skipped)` (a convention: the caller moved; its called move's `cant` is a step fact, see V2 below).
- **A/B/C over every stored case** (`cl/snap.sh`, `cl/run-all.ts`, `cl/diff.cjs`; one snapshot: A = Step 0's stub, B = this
  file, C = B + CL-1…CL-6): A→B 2282/2308 byte-equal, the 26 that differ are CL's own cases plus F14a, F14c, S47b (now
  `Sleep Talk needs {Name}'s moves.`, V2's status2-removed.ts has them), F21a (ready) and R10 (`Copycat with No move …`);
  B→C 2283/2308, the 25 are CL's cases plus R10 and S47c (ready). R10, F21a and S47c run through the oracle with their
  reason dropped (`cl/run-stored.ts`): all three match.

## Tests in other files that change (integrator / owners)

- `tests/unit/doubles-status.test.ts:463`: `"Sleep Talk is not modelled in 2v2."` → `"Sleep Talk needs Snorlax's moves."`
  (line 464 Uproar stays until CL-1/CL-2, then the row goes: modelled).
- `tests/unit/doubles-turn-fixes.test.ts` GUARDED: F14a → `"Sleep Talk needs Snorlax's moves."`, F14c →
  `"Sleep Talk needs Komala's moves."`, F21a → ready (oracle agrees: move it out of GUARDED), R10 →
  `"Copycat with No move is not modelled in 2v2."` until CL-4, then ready (oracle agrees). (R09 there fails from PR's Pledges.)
- `tests/unit/doubles-eot.test.ts:1112` skips its Uproar test while the reason stands: with CL-1/CL-2 it runs (E2's).
