# Track N (wave 1a): the turn's history from earlier turns (`app/lib/battle/doubles-history.ts`)

Branch `calc-2v2-status-2` (checked before and after the work). Owned files only: `app/lib/battle/doubles-history.ts`,
`tests/unit/doubles-history.test.ts`. Nothing committed. Spec: ADDENDUM2 §4.2 N (with IN §4.2 without `releasesNow`, T2E
§4.7.1 and §4.7.3, C23, C34, C37), §2.4 (`typeUnknown`, `needsEntryOrder`), §4.4 (the stall roll's branches).

## What the hooks do now

| Hook (call site) | Model | Pinned source |
|---|---|---|
| `stallPrepare` (doubles-status.ts earlyBranch, after the willAct check) | With a carried counter c (`vol.stall`, from `carried.stall`; 1 is none, C23): pass 1/c, fail 1 − 1/c with the counter deleted and the step fact `{Move} fails.` (ADDENDUM2 §4.2's text). A pass restarts the counter (×3, cap 729) only for a later reader (an Instruct in the turn: CL); without a reader nothing is kept (readers rule). No counter: every world passes (3 written only for a later reader). | PS/data/conditions.ts:439-462, data/moves.ts:13973-13978 |
| `stallRaise` (new export; for earlyBranch's Quick Guard / Wide Guard branch: N-4) | The guard's addVolatile('stall') with no roll: 3, or ×3 to 729, only for a later reader. | data/moves.ts:14500-14505, 20819-20824; CQ05 |
| `destinyBondBefore` (beforeMove −1 on going worlds; every stopped world) | Removed unless the move is Destiny Bond (not as Max Guard); removed on any stopped action (MoveAborted); No move (Splash) removes it. | data/moves.ts:3483-3526 |
| `destinyBondPrepare` (new export; for earlyBranch's Destiny Bond branch: N-1) | One still up: removed, the move fails: `Destiny Bond fails: it was used last turn.` (IN §4.2's text). | destinybond onPrepareHit |
| `entryTie` (redirect; PR's Dancer and ST's Download in 1b) | The smaller rank wins (MonState.entry, else the input's rank: startWorld writes `entry` only with the kernel's `entryReaders`); a rank missing or two equal: null (C37). An ability state that began this turn (a rank above every input rank) is newer than any Pokémon's without one. The caller gives the reason. | sim/battle.ts:413-419 (no shuffle) |
| `entryChanged` (A1's setAbility, R's replaceSlot) | `entry` = 1 + the highest input rank or entry so far; only while a tie can read it (two redirectors, two Dancers with a dance move, a Download holder, as the world's abilities are now). Call it after the build holds the new ability. | sim/pokemon.ts setAbility → initEffectState |
| `proteanUsed` (rootWorlds) | A used Protean or Libero (abilityActive false) without `types` (not a non-Stellar Tera): `notEstimated(REASONS.typeUnknown(name, ability))`. Reachable only with N-3. | IN §4.2 |
| `beforeMoveStart` (beforeMove, priority 11) | `vol.mustRecharge`: deleted, the action stops (no sleep count, no confusion self-hit or turn: TR01, TR11); the turn fact is the kernel's. | data/conditions.ts:364-378 |
| `moveTry` (damagingMove, after flingTry) | Fake Out, First Impression (not their Z-Move or Max Move) fail with `{Move} fails: it is not {Name}'s first turn.` when `firstTurn` is false, or on a second action of the turn (`action.source === "instruct"`, `action.external`: runMove counts each, sim/battle-actions.ts:217). | data/moves.ts:5097-5100, 5483-5486 |

## Ground truth (`W1A-N-probes.ts` → `W1A-N-probes.out`, `.err` empty)

N01 the stall counter 3 / 9 / 729 in all four games (Protect into Facade: 1/3, 1/9, 1/729 protected), N02 Endure with 9 (1 HP in
1/9), N03 confused under Gravity with 3 (self-hit 0.33 first, then 0.4467 failed, 0.2233 protected), N04 Quick Guard then
Protect (1/3), N05a–e Destiny Bond carried (faster KO faints the attacker; gone after No move, after a stopped action, after a
second Destiny Bond, which fails), N06 the Lightning Rod tie in all four games (older state takes it; re-made, the other), N07
Follow Me ×2 (sv, usum; one trace: a Speed tie among the actives shuffles at every eachEvent), N08 the recharge (asleep: stays
asleep; confused: no self-hit), N09 Fake Out / First Impression after the first turn (TR07; not flinched; First Impression),
N10 Protean after a failed roll (Water/Dark kept: 7/12 KO by Thunderbolt). `W1A-N-protean.ts`: a used Protean's STAB (below).

## Gates

- `tests/unit/doubles-history.test.ts`: **51 passed, 4 expected fail** (`npx vitest run --config vitest.unit.config.ts
  tests/unit/doubles-history.test.ts`). The four `it.fails` are the integrator lines N-1, N-2, N-3, N-5: each passes on a scratch
  engine with the lines applied (so vitest reports "expected to fail"), which is the signal to flip them to `it()`.
- `tsc --noEmit`: 0 errors. `eslint` on both files: clean. `golden-1v1 --check`: only Track F's Fling rows differ (the same with
  this file stubbed).
- **A/B over every stored case** (`W1A-N-int/`: three snapshots of `app/lib/battle` taken at one moment, A = Step 0's stub
  `doubles-history.ts`, B = this track's, C = B plus N-1 … N-5 (`W1A-N-patch-int.cjs`); `run-app.ts` with `TSX_TSCONFIG_PATH`
  → `tsconfig.{a,b,c}.json`; `step0a-diff-app.mjs`):
  - A vs B, 1705 cases (V1's new ones included): 1676 byte-equal; the 29 that differ are exactly this track's gate cases (CQ-DBD,
    CQ-ENT, CQ-STL, IN-DBD, IN-ENT, IN-FO, IN-RC, IN-STL) plus SAT-SBM-1 / -1b-champions, which are app errors in all three
    (Audino not in the Champions engine) whose stack paths differ. Every other stored case is byte-equal.
  - B vs C: the same 1705 but exactly IN-DBD-02-sv, IN-ENT-02c-sv, IN-PRT-01 / -01b (sv, champions) (and the two SAT error paths).
  - Oracle (`compare-all.ts`, compare.ts's compareCase with E2) over IN-STL, IN-DBD, IN-ENT, IN-RC, IN-FO, IN-PRT, CQ-STL, CQ-DBD,
    CQ-ENT: **B 32/38**, **C 38/38**. B's six: IN-DBD-02-sv (N-1), IN-ENT-02c-sv (N-2), IN-PRT-01 / -01b sv and champions (N-3).
- The same unit files (doubles-start-rows, -status, -kernel, status2-kernel-plumbing, status2-step1, doubles-turn-guards) on A,
  B and C: the same 12 failures in all three (other tracks' work in progress); none is this track's. SR45's reason changes with
  N-2 (below). `tests/source/status2-hooks.test.ts`: the import / cycle rule passes; its two failures are in E1's and D's files.

## Integrator lines (frozen files), exact

**N-1** `doubles-status.ts` earlyBranch, the Destiny Bond branch (IN-DBD-02, IN-P05b):
```ts
  // Destiny Bond (data/moves.ts destinybond): a foe's move that knocks its user out this turn faints that foe too
  // (onKnockOut); its own PrepareHit fails it while one from last turn is still up (doubles-history.ts destinyBondPrepare).
  if (move.id === "destinybond") {
    if (historyHooks.destinyBondPrepare(kernel, w, action)) return [w];
    mon.destinyBond = true;
```
Until then a carried Destiny Bond with a Destiny Bond action gives a wrong turn (the volatile stays: IN-DBD-02's attacker faints).

**N-2** `doubles-turn.ts` redirect (the tie):
```ts
  if (found?.ties.length) {
    // status2 N (C37): the oldest ability state among the tied holders (doubles-history.ts entryTie), pairwise; not known: not estimated.
    let first = found.taken.slot;
    for (const tie of found.ties) {
      const older = historyHooks.entryTie(kernelOf(ctx), w, first, tie);
      if (older === null) notEstimated(REASONS.needsEntryOrder(found.taken.by, ctx.names[first], ctx.names[tie]));
      first = older;
    }
    return first === found.taken.slot ? found.taken : found.tied[found.ties.indexOf(first)];
  }
```
It removes the `notIn2v2` redirect-tie site (§2.4) and decides three-way ties too. `tests/unit/doubles-start-rows.test.ts` SR45's
reason becomes `Lightning Rod needs whether Manectric or Raichu came in first.` (checked: `W1A-N-sr45.ts` on B and C).

**N-3** `doubles-turn.ts` validate (IN-PRT-01, -01b):
```ts
    // status2 N (IN §4.2): a used Protean or Libero is the 2v2 turn's (doubles-history.ts proteanUsed; its types BuildBase.types).
    const used = entry.build.abilityId === "protean" || entry.build.abilityId === "libero";
    const found = [...validateBuild(entry.build, runtime).filter((issue) => !(used && issue.field === "abilityActive")), ...carriedIssues(input, slot)];
```
Apply it only with the used-Protean STAB fix in `calculate.ts` (Track F's file in 1a; below): today the engine
(@smogon/calc util.js getStabMod) gives a Protean or Libero holder STAB on every move, so with N-3 alone a used generation-9
Protean's off-type move is over-estimated (`W1A-N-protean.ts`: Greninja used to Water, Dark Pulse into Snorlax: Showdown 29–35,
the app 43–52). Also: for a typeUnknown turn the start rows read the species' types for that Pokémon; consider leaving out the rows
into and from it (compare.ts's "non-empty start rows" check for not-estimated cases would need the same exception).

**N-4** `doubles-status.ts` earlyBranch, the Wide Guard / Quick Guard branch, after the side condition is set:
```ts
    // status2 N: the guard raises the stall counter with no roll (doubles-history.ts stallRaise; kept only for a later reader).
    historyHooks.stallRaise(kernel, w, action);
```
Inert without an Instruct in the turn (CL's instructed Protect reads it).

**N-5** `doubles-status.ts` earlyBranch: Protean / Libero (the PrepareHit event) after a protecting move's own PrepareHit
(PS/sim/battle-actions.ts:591-592): remove the top-level `typingHooks.proteanGuard(kernel, w, slot, move.id, () => move.type);`
(and its comment) above `const protect = PROTECT_MOVES[move.id];`, call it first inside `for (const world of roll.pass) {` as
`typingHooks.proteanGuard(kernel, world, slot, move.id, () => move.type);`, and once more for the other early moves just before
`// A snatchable move here (Quick Guard, Wide Guard; …)`. With A2's Protean model (doubles-typing.ts setTypes) the live tree
types a failed Protect's user Normal: N10 (Greninja Protect with stall 3 into Jolteon's Thunderbolt) gives KO 0, Showdown 7/12.

## Deviations and notes

- `{Move} fails.` for the failed roll (ADDENDUM2 §4.2), not IN's `{Move} fails: a protecting move was used last turn.`
- Two new exports beyond Step 0a's stubs (`stallRaise`, `destinyBondPrepare`): their call sites are N-4 and N-1.
- `moveTry` also fails an instructed or external Fake Out (CL sets `source: "instruct"`). An instructed Destiny Bond would get
  `… it was used last turn.` from N-1 (CL may want its own text).
- Champions disables Fake Out and First Impression after the first turn (data/mods/champions/moves.ts:322-329, 354-362
  onDisableMove), so `firstTurn: false` with them is not a choice a Champions player has; the engine still gives Showdown's onTry
  failure (TR07, IN-FO01-champions).
- An input gap (no change asked): `switchedIn` with carried volatiles (`destinyBond`, `stall`, `charging` …) is contradictory in
  Showdown (a switch clears them); carriedIssues has the check only for `mustRecharge` and `firstTurn`.
