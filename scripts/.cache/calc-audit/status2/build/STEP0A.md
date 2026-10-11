# Step 0a: contract, hook modules, kernel plumbing (status2)

Branch state: the working tree at main `4008ee8` (the checked-out branch is `feat/castmirror-live-parity`, which points at
`4008ee8`; `calc-2v2-status-2` points at the same commit; no branch was switched, nothing was committed by this step). During
the step another session committed `14bbe27` ("Bring hosted CastMirror reference controls to the live site") on this branch:
it touches CastMirror files only (`git diff --stat 4008ee8 14bbe27 -- app/lib/battle data` is empty), so `4008ee8`'s engine is
the baseline of every comparison below. This covers SPEC2 §8.1
row 0a and ADDENDUM2 §8.1 row 0a (0a.1–0a.4). Behaviour does not change: every stub reproduces today's result, every new
reader is keyed on a field no stored input or Step 0 world sets, and the gates below are byte-equal.

## Status

- **Type files DONE (Step 0b may start):** `app/lib/battle/doubles-types.ts`, `app/lib/battle/types.ts`,
  `app/lib/battle/doubles-world.ts` hold the whole contract of SPEC2 §3.1–§3.3 and ADDENDUM2 §3.1–§3.3 (every new input
  field, outcome field and world state). Their types have not changed since that note; only the bodies of `cloneWorld` and
  `discreteKey` were tuned for speed (same results, see "Performance").
- **Step 0a DONE:** the hook modules, the kernel plumbing (SPEC2 §3.5, ADDENDUM2 §3.5, T2E §3.5, IN §4.1, T2P §9.3, T2M §2.2),
  the REASONS deltas, the status table through its new generator, `tests/source/status2-hooks.test.ts` and a unit test of the
  plumbing. Every gate is green (last section). Two items wait for Step 0b (see "Waiting on Step 0b").

## Files

- Contract: `app/lib/battle/doubles-types.ts`, `app/lib/battle/types.ts`, `app/lib/battle/doubles-world.ts`.
- Kernel and Track files (0a's lines only where so marked): `app/lib/battle/doubles-turn.ts`, `app/lib/battle/doubles-status.ts`,
  `app/lib/battle/doubles-eot.ts` (§3.5's lines: `sheltered`, `eotField`, the D guards, `switchOut` "residual", `withSpecies`,
  `loseItem`'s `noteItemUse`, the futureMove/charging widening), `app/lib/battle/doubles-items.ts` (the Symbiosis hook line and
  White Herb's `noteItemUse`), `app/lib/battle/doubles-actions.ts` (REASONS, `HP_STATUS_MOVES`, `SELF_COST_MOVES` export),
  `app/lib/battle/status-table.ts` (regenerated: header, the `snatch` flag type, 87 `snatch:true` flags; kinds unchanged:
  M125 L73 X39 S7 N20 C6 P1).
- New hook modules: `doubles-use.ts` (shared helpers), `doubles-stages.ts` (A1), `doubles-abilities.ts` (A1), `doubles-typing.ts`
  (A2), `doubles-field.ts` (A3), `doubles-fieldchange.ts` (FC), `doubles-guards.ts` (D), `doubles-spread.ts` (D),
  `doubles-switch.ts` (R), `doubles-hidden.ts` (H), `doubles-reactions.ts` (K), `doubles-pairs.ts` (W), `doubles-faces.ts` (S),
  `doubles-max.ts` (M), `doubles-presence.ts` (PR), `doubles-calling.ts` (CL), `doubles-history.ts` (N).
- Type-only follow-ons: `app/(app)/calculator/BattleConditions.tsx`, `tests/unit/doubles-outcomes.test.ts`,
  `tests/unit/doubles-turn-showdown.test.ts`, `tests/unit/training-bridge.test.ts`, `scripts/.cache/calc-audit/2v2/verify/gen-tests.ts`.
- Tests: `tests/source/status2-hooks.test.ts` (new), `tests/unit/status2-kernel-plumbing.test.ts` (new; named apart from 0b's
  `status2-plumbing*.test.ts`), `tests/source/doubles-status-moves.test.ts` (snatch flag, `HP_STATUS_MOVES`),
  `tests/unit/doubles-status.test.ts` (`needsMoves(move, name)`), `tests/unit/doubles-kernel.test.ts` (C32's ally sources and
  C23's counter 1: the two input-check texts that changed by design).
- Build folder (`scripts/.cache/calc-audit/status2/build/`): `gen-status-table.ts`, `dex-dump.ts` (+ `dex-dump.json`,
  `dex-flags.json`), `step0a-run-app.ts`, `step0a-diff-app.mjs`, `step0a-compare.ts` (now passes E2's outcomes as compare.ts
  does), `microbench.ts`, `microbench-ab.ts`, `microbench-fuzz.ts`, `microbench-moves.ts` (A/B timing against a HEAD tree),
  `tr-probe.ts` (the TR06a/TR09/TR10a checks the unit test pins), this file.

## Contract notes for Step 0b and the tracks

- `BuildBase` (types.ts) gains `types`, `addedType`, `storedStats`, `weighthg`, `abilityChanged`, `itemSuppressed` (world
  state) and the calculation-only markers `takenMods` (`minimize`, `glaiveRush`, `berryWeaken`, `hidden`), `tarShot`,
  `revealed`, `grounding`, `critBoost`, `laserFocus`. The kernel's `calcBuild` derives the markers in `turnMarks`
  (doubles-turn.ts:622), none while no state sets them; `speedOf` reads the build without them (it reads none).
- `MoveContext` gains `stockpile`, `retype`, `hiddenStages`, `frozenPriority`, `helpingHands`, `basePower`, `powerMods`,
  `retypeTo`, `forceStab`, `switching`. `BattleConditions` gains `mudSport`, `waterSport`, `ionDeluge`, `allyTarget` (set by
  `conditionsFor` for a target that is the user's ally). `SideConditions` gains `mist`, `luckyChant`, `protectName`
  (Mat Block's, for a Z-Move or Max Move), `safeguard`, `gmaxResidual`, `swamp`.
- `doubles-world.ts` exports `Stage`, `sheltered(hidden)` (Dig, Dive) and `withSpecies(build, speciesId)` (drops
  `storedStats`, `weighthg`, `types`, `addedType`; keeps the key order).
- `EotState.hidden` is widened to the hidden move's id (C20); `EotState.futureMove` is `{ move, source, build } | { bare }`
  and `EotState.cudChew` is `true | { berry, counter }` (C33). `DoublesCarried.futureMove` / `cudChew` / `allySwitch` are
  widened as ADDENDUM2 §3.1 says; a bare id and `true` keep today's meaning.
- `World.boosted[slot].rose` is the summed positive parts by stat (truthy as before).
- Every new `SideState` and `World` field is optional (absent = off); `cloneWorld` copies the new World fields only when
  present; `discreteKey` appends one entry `{ fieldSet, didSomething, lastSuccessful, lastMove }` only while one of them is
  set, so a world with none of them has today's key exactly.
- `searchFor` (doubles-turn.ts:779) takes `attacker: null`, `opts.attackerBuild`, `opts.attackerHealBlocked`; the step's
  environment `{ mist, report, …K's and W's stepEnv }` enters the memo key and `prepareUses`' options only when non-empty, and
  is passed to `prepareUses` through a cast (`Parameters<typeof prepareUses>[5]`) until 0b adds `UsesEnv.mist` and `report`.
- `applyStep` (doubles-turn.ts:2555) takes `opts.residual: { attacker, build? }` (T2E §3.5).
- The BeforeMove gates `guards.beforeFirst`, `history.beforeMoveStart`, `typing.beforeAttract` and the after-move hooks
  `abilities.afterMove`, `guards.afterMoveCopies`, `presence.afterAction` return **null for "this world goes on unchanged"**
  (or a Gate / the worlds): the stubs then allocate nothing per world (see "Performance").

## Hook modules: every export, its signature, Step 0's behaviour and its call sites

"today's code" is moved verbatim (each at its old site); a stub's Step 0 result is given. Line numbers are the working tree's.
The A1 stubs `setAbility`, `skillSwap`, `abilityStart`, `abilityEnd`, `intimidateStart`, `transformBuild` have no caller in
Step 0 and give SPEC2's reasons (`abilityStart`, `abilityEnd`, `transformMax`/`imposterAcross`) if called. The shared helpers of
`doubles-use.ts` (`STATS`, `STAGE_NAMES`, `signed`, `stageFact`, `Gate`, `Vol`, `setVol`, `setEot`, `gameOf`, `generation`,
`tableEntry`, `sleepPrior`, `wakeChance`, `sleepTurnsLeft`, `snapChance`, `Use` (with `snatched?`), `StatusHandler`, `hitFact`,
`aboutSlot`, `breaks`, `canSwitch`) are imported by name by doubles-status.ts and the hook modules.

| Module (owner) | Export | Signature | Step 0 | Call sites (file:line function) |
|---|---|---|---|---|
| doubles-stages.ts (A1) | `applyBoosts` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, changes: StatusStages, source: DoublesSlotId \| null, opts: { use?: Use; effect?: "move" \| "ability" \| "item" \| null; reflected?: boolean; broken?: boolean; report?: boolean; by?: string } = {}): Partial<Record<Stage, number>>` | today's code | doubles-turn.ts:559 makeKernel; doubles-stages.ts:80 applyBoosts; doubles-stages.ts:120 applyBoosts; doubles-stages.ts:175 selfBoost; doubles-stages.ts:184 foeDrop |
| doubles-stages.ts (A1) | `whiteHerbAfterMove` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, use: Use \| undefined)` | today's code | doubles-stages.ts:124 applyBoosts; doubles-stages.ts:161 writeStages |
| doubles-stages.ts (A1) | `writeStages` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, stages: Partial<Record<Stage, number>>, use?: Use)` | today's code | (no caller in Step 0) |
| doubles-stages.ts (A1) | `foesLeft` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId): boolean` | today's code | doubles-stages.ts:37 applyBoosts |
| doubles-stages.ts (A1) | `selfBoost` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, changes: Partial<Record<CombatStat, number>>, action: PendingAction \| null)` | today's code | doubles-turn.ts:556 makeKernel; doubles-turn.ts:589 selfBoost |
| doubles-stages.ts (A1) | `foeDrop` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, changes: StatusStages, source: DoublesSlotId \| null, broken = false, reflected = false)` | today's code | doubles-turn.ts:557 makeKernel; doubles-turn.ts:591 foeDrop |
| doubles-abilities.ts (A1) | `HANDLERS` | `: Readonly<Record<string, StatusHandler>> = {};` | data | doubles-status.ts:82 bigRoot |
| doubles-abilities.ts (A1) | `setAbility` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, ability: string, opts: { source: DoublesSlotId; how: AbilityChange; use?: Use }): World[]` | stub: kernel.notEstimated(REASONS.abilityStart(kernel.abilityName(ability), kernel.names[slot])) | (no caller in Step 0) |
| doubles-abilities.ts (A1) | `skillSwap` | `(kernel: TurnKernel, w: World, user: DoublesSlotId, target: DoublesSlotId, use: Use): World[]` | today's code | (no caller in Step 0) |
| doubles-abilities.ts (A1) | `abilityStart` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, why: "gained" \| "entered"): World[]` | today's code | (no caller in Step 0) |
| doubles-abilities.ts (A1) | `abilityEnd` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, ability: string): World[]` | stub: kernel.notEstimated(REASONS.abilityEnd(kernel.abilityName(ability), kernel.names[slot])) | (no caller in Step 0) |
| doubles-abilities.ts (A1) | `intimidateStart` | `(kernel: TurnKernel, w: World, holder: DoublesSlotId, use?: Use): World[]` | today's code | (no caller in Step 0) |
| doubles-abilities.ts (A1) | `transformBuild` | `(kernel: TurnKernel, w: World, user: DoublesSlotId, target: DoublesSlotId): BattleBuild` | stub: kernel.notEstimated(REASONS.notIn2v2(`Transform into ${kernel.names[target]}`)) | (no caller in Step 0) |
| doubles-abilities.ts (A1) | `updateCures` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | stub: no-op | doubles-status.ts:1933 updateAll |
| doubles-abilities.ts (A1) | `damagingTry` | `(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, info: TurnMoveInfo): string \| null` | stub: null | doubles-turn.ts:2266 damagingMove |
| doubles-abilities.ts (A1) | `afterMove` | `(kernel: TurnKernel, w: World, action: PendingAction): World[] \| null` | stub: null | doubles-turn.ts:1430 runMove |
| doubles-typing.ts (A2) | `HANDLERS` | `: Readonly<Record<string, StatusHandler>> = {};` | data | doubles-status.ts:82 bigRoot |
| doubles-typing.ts (A2) | `setTypes` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, types: string[]): boolean` | today's code | (no caller in Step 0) |
| doubles-typing.ts (A2) | `addType` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, type: "Grass" \| "Ghost"): boolean` | stub: false | (no caller in Step 0) |
| doubles-typing.ts (A2) | `proteanGuard` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, moveId: string, type: () => string)` | today's code | doubles-status.ts:782 earlyBranch; doubles-status.ts:1031 prepareHit; doubles-status.ts:1728 sideOrField; doubles-turn.ts:593 proteanGuard |
| doubles-typing.ts (A2) | `roost` | `(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId)` | today's code | doubles-status.ts:1298 effects |
| doubles-typing.ts (A2) | `ingrainGuard` | `(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId, grounded: boolean)` | today's code | doubles-status.ts:1444 volatile |
| doubles-typing.ts (A2) | `magnetRiseGuard` | `(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId, grounded: boolean)` | today's code | doubles-status.ts:1452 volatile |
| doubles-typing.ts (A2) | `ateRedirectGuard` | `(kernel: TurnKernel, w: World, use: Use)` | today's code | doubles-status.ts:969 targetsOf |
| doubles-typing.ts (A2) | `groundingAfterHit` | `(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo)` | today's code | doubles-turn.ts:2859 afterHit |
| doubles-typing.ts (A2) | `afterHit` | `(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo, ownAny: boolean)` | today's code | doubles-turn.ts:2882 afterHit; doubles-turn.ts:2923 residualReactions |
| doubles-typing.ts (A2) | `psychicNoiseKeepsBerry` | `(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: TurnMoveInfo): string \| null` | today's code | doubles-turn.ts:2469 singleStep |
| doubles-typing.ts (A2) | `psychicNoiseGuard` | `(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo)` | today's code | doubles-turn.ts:2906 afterHit |
| doubles-typing.ts (A2) | `beforeAttract` | `(kernel: TurnKernel, w: World, action: PendingAction): Gate \| null` | stub: null | doubles-status.ts:148 beforeMove |
| doubles-typing.ts (A2) | `powderTryMove` | `(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, type: () => string): World[] \| null` | stub: null | doubles-status.ts:911 runUse; doubles-turn.ts:2300 damagingMove |
| doubles-typing.ts (A2) | `retypeStatus` | `(kernel: TurnKernel, w: World, user: DoublesSlotId, move: ChampionsMove, entry: StatusEntry, type: string): string` | stub: type | doubles-status.ts:682 statusType |
| doubles-typing.ts (A2) | `comboGuard` | `(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, info: TurnMoveInfo)` | stub: no-op | doubles-turn.ts:2265 damagingMove |
| doubles-field.ts (A3) | `HANDLERS` | `: Readonly<Record<string, StatusHandler>> = {};` | data | doubles-status.ts:82 bigRoot |
| doubles-field.ts (A3) | `fieldMove` | `(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): boolean` | today's code | doubles-status.ts:834 earlyBranch; doubles-status.ts:1765 sideOrField |
| doubles-field.ts (A3) | `snatch` | `(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, use?: Use): World[] \| null` | stub: null | doubles-status.ts:804 earlyBranch; doubles-status.ts:1033 prepareHit; doubles-status.ts:1730 sideOrField |
| doubles-field.ts (A3) | `tryHitSide` | `(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): { pass: boolean; worlds: World[] } \| null` | stub: null | doubles-status.ts:1108 tryHit |
| doubles-field.ts (A3) | `mistBlocks` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, source: DoublesSlotId, opts: { use?: Use; effect?: "move" \| "ability" \| "item" \| null }): boolean` | stub: false | doubles-stages.ts:84 applyBoosts |
| doubles-guards.ts (D) | `noteRise` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, boost: Partial<Record<Stage, number>>)` | today's code | doubles-stages.ts:90 applyBoosts |
| doubles-guards.ts (D) | `copierGuard` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | today's code | doubles-turn.ts:1582 eventGuards |
| doubles-guards.ts (D) | `copierEndOfTurn` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, startBoosts: BattleBuild["boosts"])` | today's code | doubles-eot.ts:1046 afterChecks |
| doubles-guards.ts (D) | `afterMoveCopies` | `(kernel: TurnKernel, w: World, action: PendingAction): World[] \| null` | stub: null | doubles-turn.ts:1432 runMove |
| doubles-guards.ts (D) | `symbiosisAfterAction` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, was: { itemId: string })` | today's code | doubles-turn.ts:1585 eventGuards |
| doubles-guards.ts (D) | `symbiosisReceived` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, used: () => boolean)` | today's code | doubles-items.ts:115 receive |
| doubles-guards.ts (D) | `symbiosisEndOfTurn` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, startItem: string \| undefined)` | today's code | doubles-eot.ts:1047 afterChecks |
| doubles-guards.ts (D) | `lockedBerryGuard` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | today's code | doubles-turn.ts:505 makeKernel; doubles-turn.ts:2564 applyStep |
| doubles-guards.ts (D) | `hiddenStageGuard` | `(kernel: TurnKernel, w: World, attacker: DoublesSlotId \| null, target: DoublesSlotId, moveId: string, context: MoveContext \| undefined)` | today's code | doubles-turn.ts:781 searchFor |
| doubles-guards.ts (D) | `ripenGuard` | `(kernel: TurnKernel, w: World, holder: DoublesSlotId, weakens: boolean)` | today's code | doubles-turn.ts:2787 stolenFacts |
| doubles-guards.ts (D) | `glaiveRushAfter` | `(kernel: TurnKernel, w: World, action: PendingAction, ownAny: boolean)` | today's code | doubles-turn.ts:2884 afterHit |
| doubles-guards.ts (D) | `encoreGuard` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, last: string)` | today's code | doubles-status.ts:1534 lastMoveVolatile |
| doubles-guards.ts (D) | `beforeFirst` | `(kernel: TurnKernel, w: World, action: PendingAction): Gate \| null` | stub: null | doubles-status.ts:135 beforeMove |
| doubles-guards.ts (D) | `ohkoStep` | `(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, check: HitCheck): ((world: World) => World[]) \| null` | stub: null | doubles-spread.ts:85 spreadStep; doubles-turn.ts:2464 singleStep |
| doubles-guards.ts (D) | `flingTry` | `(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, info: TurnMoveInfo): string \| null` | stub: null | doubles-turn.ts:2296 damagingMove |
| doubles-guards.ts (D) | `flingAfter` | `(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo)` | stub: no-op | doubles-turn.ts:2911 afterHit |
| doubles-guards.ts (D) | `tracksItems` | `(input: DoublesTurnInput): boolean` | stub: false | doubles-turn.ts:3035 readersOf |
| doubles-guards.ts (D) | `stepReport` | `(kernel: TurnKernel): { rises?: true; used?: true; dealt?: true; starf?: true }` | stub: {} | doubles-turn.ts:807 searchFor |
| doubles-guards.ts (D) | `encoreRewrite` | `(kernel: TurnKernel, w: World, action: PendingAction): PendingAction` | stub: action | doubles-turn.ts:1343 execute |
| doubles-spread.ts (D) | `spreadStep` | `(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, checks: HitCheck[], multiple: boolean, attackerHP?: number, prior = 0): World[]` | today's code | doubles-turn.ts:2336 damagingMove; doubles-turn.ts:2983 dartsStep; doubles-spread.ts:39 spreadStep; doubles-spread.ts:59 spreadStep; doubles-spread.ts:72 spreadStep |
| doubles-switch.ts (R) | `switchOut` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, how: SwitchHow, action: PendingAction \| null)` | today's code | doubles-eot.ts:1011 ejectPack; doubles-status.ts:1803 switchOut; doubles-turn.ts:1594 eventGuards; doubles-turn.ts:2821 hitReactions; doubles-turn.ts:2822 hitReactions; doubles-turn.ts:2870 afterHit; doubles-turn.ts:2879 afterHit |
| doubles-hidden.ts (H) | `chargeHidden` | `(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove)` | today's code | doubles-turn.ts:2383 chargeTurn |
| doubles-hidden.ts (H) | `carriedStart` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | today's code | doubles-turn.ts:1040 presenceGuards |
| doubles-hidden.ts (H) | `skyDrop` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | stub: no-op | doubles-turn.ts:1050 presenceGuards |
| doubles-hidden.ts (H) | `misses` | `(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, slot: DoublesSlotId): HitCheck \| null` | stub: null | doubles-turn.ts:2046 hitChecks |
| doubles-hidden.ts (H) | `missesStatus` | `(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): string \| null` | stub: null | doubles-status.ts:1094 tryHit |
| doubles-hidden.ts (H) | `missesField` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove): boolean` | stub: false | (no caller in Step 0) |
| doubles-hidden.ts (H) | `land` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | stub: no-op | doubles-field.ts:60 fieldMove |
| doubles-hidden.ts (H) | `release` | `(kernel: TurnKernel, w: World, action: PendingAction)` | stub: no-op | doubles-turn.ts:1409 runMove |
| doubles-hidden.ts (H) | `crash` | `(kernel: TurnKernel, worlds: World[], action: PendingAction, info: TurnMoveInfo, landedAny: boolean): World[]` | stub: worlds | doubles-turn.ts:2342 damagingMove |
| doubles-reactions.ts (K) | `afterKnockOut` | `(kernel: TurnKernel, w: World, action: PendingAction, outcome: TurnStepOutcome)` | today's code | doubles-turn.ts:2858 afterHit |
| doubles-reactions.ts (K) | `koRetaliationAfter` | `(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo)` | today's code | doubles-turn.ts:2860 afterHit; doubles-turn.ts:2922 residualReactions |
| doubles-reactions.ts (K) | `allyFaint` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | today's code | doubles-turn.ts:1656 faint |
| doubles-reactions.ts (K) | `cottonDown` | `(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId)` | today's code | doubles-turn.ts:2810 hitReactions |
| doubles-reactions.ts (K) | `veil` | `(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, was: BattleBuild)` | today's code | doubles-turn.ts:2666 applyStep |
| doubles-reactions.ts (K) | `unnerveRecoil` | `(kernel: TurnKernel, next: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo, before: { user: BattleBuild; receiver: BattleBuild }, follow: boolean)` | today's code | doubles-turn.ts:2653 applyStep |
| doubles-reactions.ts (K) | `unnerveStand` | `(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId)` | today's code | doubles-turn.ts:553 makeKernel; doubles-turn.ts:2483 singleStep |
| doubles-reactions.ts (K) | `resistUnnerve` | `(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId): string \| null` | today's code | doubles-turn.ts:3493 pairRows; doubles-reactions.ts:89 unnerveStand |
| doubles-reactions.ts (K) | `volatileSecondary` | `(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo, hitAny: boolean)` | today's code | doubles-turn.ts:2905 afterHit |
| doubles-reactions.ts (K) | `contactKO` | `(kernel: TurnKernel, world: World, action: PendingAction, contact: HitCheck[], rest: HitCheck[], loss: number)` | today's code | doubles-spread.ts:58 spreadStep |
| doubles-reactions.ts (K) | `spreadUser` | `(kernel: TurnKernel, world: World, action: PendingAction, info: TurnMoveInfo, states: string[])` | today's code | doubles-spread.ts:125 spreadStep |
| doubles-reactions.ts (K) | `stepEnv` | `(kernel: TurnKernel, w: World, attacker: DoublesSlotId \| null, target: DoublesSlotId, moveId: string, spread: boolean): Record<string, unknown>` | stub: {} | doubles-turn.ts:809 searchFor |
| doubles-reactions.ts (K) | `beforeStep` | `(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, check: HitCheck): World \| null` | stub: null | doubles-spread.ts:84 spreadStep; doubles-turn.ts:2459 singleStep |
| doubles-pairs.ts (W) | `focusBand` | `(kernel: TurnKernel, w: World, target: DoublesSlotId, row: MoveDamageResult)` | today's code | doubles-turn.ts:552 makeKernel; doubles-turn.ts:2477 singleStep |
| doubles-pairs.ts (W) | `selfHitBand` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, values: number[])` | today's code | doubles-status.ts:420 confusionHit |
| doubles-pairs.ts (W) | `betweenHits` | `(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, entry: SearchEntry)` | today's code | doubles-turn.ts:2565 applyStep |
| doubles-pairs.ts (W) | `allyShield` | `(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, priority: number)` | today's code | doubles-turn.ts:2414 moveFailure |
| doubles-pairs.ts (W) | `frozenPriority` | `(kernel: TurnKernel, world: World, action: PendingAction, priority: number, resolution: Resolution)` | today's code | doubles-turn.ts:2289 damagingMove |
| doubles-pairs.ts (W) | `assurance` | `(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId): boolean` | today's code | doubles-turn.ts:1994 contextFor |
| doubles-pairs.ts (W) | `ariaFaint` | `(kernel: TurnKernel, w: World, action: PendingAction, hit: DoublesSlotId[], cures: (slot: DoublesSlotId) => boolean)` | today's code | doubles-turn.ts:1532 sparklingAria |
| doubles-pairs.ts (W) | `safeguard` | `(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo)` | today's code | doubles-status.ts:535 afterHit |
| doubles-pairs.ts (W) | `stepEnv` | `(kernel: TurnKernel, w: World, attacker: DoublesSlotId \| null, target: DoublesSlotId, moveId: string, spread: boolean): Record<string, unknown>` | stub: {} | doubles-turn.ts:809 searchFor |
| doubles-pairs.ts (W) | `hurt` | `(kernel: TurnKernel, next: World, action: PendingAction, outcome: TurnStepOutcome, info: TurnMoveInfo, follow: boolean)` | stub: no-op | doubles-turn.ts:2702 applyStep |
| doubles-faces.ts (S) | `faceTaken` | `(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, row: MoveDamageResult, move: ChampionsMove): FaceKind \| null` | today's code | doubles-turn.ts:548 makeKernel; doubles-turn.ts:2472 singleStep; doubles-turn.ts:2979 dartsStep |
| doubles-faces.ts (S) | `multiHit` | `(kernel: TurnKernel, w: World, target: DoublesSlotId, row: MoveDamageResult, move: ChampionsMove): string \| null` | today's code | doubles-turn.ts:2827 rowReason |
| doubles-faces.ts (S) | `selfHit` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | today's code | doubles-status.ts:413 confusionHit |
| doubles-faces.ts (S) | `faceHit` | `(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, face: FaceKind, multiple: boolean, inSpread = false): World[]` | today's code | doubles-turn.ts:549 makeKernel; doubles-turn.ts:2473 singleStep |
| doubles-faces.ts (S) | `faceProbe` | `(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, multiple: boolean, faceName: string): { outcome: TurnStepOutcome; row: MoveDamageResult; berry: string } \| null` | today's code | doubles-faces.ts:66 faceHit |
| doubles-faces.ts (S) | `neutralRow` | `(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, move: ChampionsMove, conditions: BattleConditions, context: MoveContext \| undefined, faceName: string): { row: MoveDamageResult; berry: string }` | today's code | (no caller in Step 0) |
| doubles-max.ts (M) | `maxEffects` | `(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId)` | today's code | doubles-turn.ts:555 makeKernel; doubles-turn.ts:2490 singleStep |
| doubles-max.ts (M) | `statusMove` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | today's code | doubles-turn.ts:1056 presenceGuards |
| doubles-max.ts (M) | `randomStatusGuard` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | today's code | doubles-turn.ts:1060 presenceGuards |
| doubles-max.ts (M) | `painSplitMax` | `(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId)` | today's code | doubles-status.ts:1675 painSplit |
| doubles-presence.ts (PR) | `commanderGuard` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | stub: no-op | doubles-turn.ts:1034 presenceGuards |
| doubles-presence.ts (PR) | `thirdPartyGuard` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | today's code | doubles-turn.ts:1038 presenceGuards |
| doubles-presence.ts (PR) | `dancerGuard` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, moveId: string)` | today's code | doubles-turn.ts:1045 presenceGuards |
| doubles-presence.ts (PR) | `movesGuard` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove)` | stub: no-op | doubles-turn.ts:1049 presenceGuards |
| doubles-presence.ts (PR) | `pledgeGuard` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove)` | stub: no-op | doubles-turn.ts:1054 presenceGuards |
| doubles-presence.ts (PR) | `rootActions` | `<T extends { slot: DoublesSlotId }>(kernel: TurnKernel, actions: T[]): T[]` | stub: actions | doubles-turn.ts:1242 rootWorlds |
| doubles-presence.ts (PR) | `turnStart` | `(kernel: TurnKernel, w: World)` | stub: no-op | doubles-turn.ts:1270 walk |
| doubles-presence.ts (PR) | `afterAction` | `(kernel: TurnKernel, w: World, action: PendingAction): World[] \| null` | stub: null | doubles-turn.ts:1450 runMove |
| doubles-presence.ts (PR) | `statusMove` | `(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): World[] \| null` | stub: null | doubles-status.ts:713 statusMove |
| doubles-presence.ts (PR) | `aim` | `(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo): Resolution[] \| null` | stub: null | doubles-turn.ts:2279 damagingMove |
| doubles-presence.ts (PR) | `tryMove` | `(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, priority: number, info: TurnMoveInfo): string \| null` | stub: null | doubles-turn.ts:2296 damagingMove |
| doubles-presence.ts (PR) | `prepareHit` | `(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo): World[] \| null` | stub: null | doubles-turn.ts:2304 damagingMove |
| doubles-presence.ts (PR) | `invulnerable` | `(kernel: TurnKernel, w: World, attacker: DoublesSlotId, slot: DoublesSlotId): string \| null` | stub: null | doubles-status.ts:1094 tryHit; doubles-turn.ts:2044 hitChecks |
| doubles-presence.ts (PR) | `tracksHits` | `(kernel: TurnKernel): boolean` | stub: false | (no caller in Step 0) |
| doubles-presence.ts (PR) | `afterHit` | `(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo)` | stub: no-op | doubles-turn.ts:2912 afterHit |
| doubles-presence.ts (PR) | `onFaint` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | stub: no-op | doubles-turn.ts:1666 faint |
| doubles-presence.ts (PR) | `cannotLeave` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId): boolean` | stub: false | doubles-switch.ts:33 switchOut |
| doubles-presence.ts (PR) | `afterSetStatus` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, status: BattleStatus, source: DoublesSlotId \| null)` | stub: no-op | doubles-status.ts:2074 setStatus |
| doubles-presence.ts (PR) | `context` | `(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo): MoveContext \| undefined` | stub: undefined | doubles-turn.ts:2013 contextFor |
| doubles-presence.ts (PR) | `bide` | `(kernel: TurnKernel, w: World, action: PendingAction): World[] \| null` | stub: null | (no caller in Step 0) |
| doubles-calling.ts (CL) | `callingGuard` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | today's code | doubles-turn.ts:1052 presenceGuards |
| doubles-calling.ts (CL) | `presence` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | today's code | doubles-status.ts:467 presenceGuards |
| doubles-calling.ts (CL) | `statusMove` | `(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): World[] \| null` | today's code | doubles-status.ts:713 statusMove |
| doubles-calling.ts (CL) | `helpingHand` | `(kernel: TurnKernel, w: World, action: PendingAction, ally: DoublesSlotId)` | today's code | doubles-status.ts:819 earlyBranch |
| doubles-calling.ts (CL) | `uproarSleep` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId): boolean` | stub: false | (no caller in Step 0) |
| doubles-calling.ts (CL) | `context` | `(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo): MoveContext \| undefined` | stub: undefined | doubles-turn.ts:2013 contextFor |
| doubles-fieldchange.ts (FC) | `beforeFieldMove` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove)` | today's code | doubles-field.ts:43 fieldMove; doubles-field.ts:49 fieldMove; doubles-field.ts:71 fieldMove; doubles-field.ts:80 fieldMove; doubles-status.ts:741 statusMove |
| doubles-fieldchange.ts (FC) | `afterFieldMove` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove, before: { field: FieldState; side: SideState })` | stub: no-op | doubles-field.ts:45 fieldMove; doubles-field.ts:52 fieldMove; doubles-field.ts:61 fieldMove; doubles-field.ts:73 fieldMove; doubles-field.ts:82 fieldMove |
| doubles-fieldchange.ts (FC) | `changed` | `(kernel: TurnKernel, w: World)` | today's code | doubles-fieldchange.ts:60 eotField |
| doubles-fieldchange.ts (FC) | `eotField` | `(kernel: TurnKernel, w: World)` | today's code | doubles-eot.ts:319 resolveFaints; doubles-eot.ts:536 weatherHandler |
| doubles-fieldchange.ts (FC) | `stepField` | `(kernel: TurnKernel, w: World, before: FieldState)` | stub: no-op | doubles-turn.ts:1663 faint |
| doubles-fieldchange.ts (FC) | `sideStarted` | `(kernel: TurnKernel, w: World, side: DoublesSideId, flag: string)` | stub: no-op | (no caller in Step 0) |
| doubles-fieldchange.ts (FC) | `pseudoWeatherChanged` | `(kernel: TurnKernel, w: World, id: string)` | stub: no-op | (no caller in Step 0) |
| doubles-fieldchange.ts (FC) | `itemsAfterField` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId): World[]` | stub: kernel.notEstimated(REASONS.boosterAfterRoom) | (no caller in Step 0) |
| doubles-fieldchange.ts (FC) | `settleHolder` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId): World[]` | today's code | (no caller in Step 0) |
| doubles-history.ts (N) | `stallPrepare` | `(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): { pass: World[]; fail: World[] }` | stub: { pass: [w], fail: [] } | doubles-status.ts:788 earlyBranch |
| doubles-history.ts (N) | `destinyBondBefore` | `(kernel: TurnKernel, w: World, action: PendingAction, stopped: boolean)` | stub: no-op | doubles-status.ts:151 beforeMove; doubles-status.ts:154 beforeMove |
| doubles-history.ts (N) | `entryTie` | `(kernel: TurnKernel, w: World, a: DoublesSlotId, b: DoublesSlotId): DoublesSlotId \| null` | stub: null | doubles-turn.ts:1798 redirect |
| doubles-history.ts (N) | `entryChanged` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | stub: no-op | (no caller in Step 0) |
| doubles-history.ts (N) | `proteanUsed` | `(kernel: TurnKernel, w: World, slot: DoublesSlotId)` | stub: no-op | doubles-turn.ts:1238 rootWorlds |
| doubles-history.ts (N) | `beforeMoveStart` | `(kernel: TurnKernel, w: World, action: PendingAction): Gate \| null` | stub: null | doubles-status.ts:136 beforeMove |
| doubles-history.ts (N) | `moveTry` | `(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, info: TurnMoveInfo): string \| null` | stub: null | doubles-turn.ts:2297 damagingMove |

## Kernel members added (TurnKernel, doubles-turn.ts:371-424; implementations in makeKernel and below)

| Member | Signature | Implementation | Step 0 |
|---|---|---|---|
| `tracksItems` | `readonly tracksItems: boolean` | `readersOf` (3033) → `guards.tracksItems(input)` | false |
| `inEndOfTurn` | `readonly inEndOfTurn: boolean` | data property, set by `endOfTurnOf` (3892) | true only in the end of turn |
| `noteItemUse` | `(w, slot, item): void` | 1878: `lastItem`, `usedItem`, Cud Chew `{ berry, counter: inEndOfTurn ? 1 : 2 }` | no-op (tracksItems false) |
| `typesIn` | `(w, slot): string[]` | 1861: Tera alone; world or species types, Roost's Type event, Normal if empty, then `addedType` | today's types |
| `prioritize` | `(w, slot, "next" \| "last"): boolean` | 1466: doubles-status.ts `order()`'s queue edit, moved (gen 7's frozen order) | today's |
| `insertAction` | `(w, action): void` | 584 | no caller |
| `externalUse` | `(w, slot, moveId, target, index): World[]` | 1487: own BeforeMove, then `runMove` | no caller |
| `useCalled` | `(w, action, moveId, target, opts?: { priority?, prankster? }): World[]` | 1498: `damagingMove(…, priority)` or `statusHooks.runCalledStatus` (doubles-status.ts), then the history | no caller |
| `extraStep` | `(key, slot, moveId): number` | 1512: a `StepStats` with `copied` (DoublesStep.copied in the output) | no caller |
| `residualHit` | `(w, hit: ResidualHit): { world, landed }[]` | 2509: hidden miss, Telepathy, `searchFor(attackerBuild)`, `applyStep(residual)` | no caller (E2's) |
| `unfollowed` | `(before, after, standIn?): BattleBuild` | existing; `standIn` puts a heal-block stand-in back | today's |
| `healStandIn` | `(w, slot, attacker): boolean` | 884 (C14) | false (no Heal Block in a step today) |
| `fromSide`, `sideKey`, `flinchCheck`, `countCalculation`, `noteMet`, `noteFirst`, `usedMove`, `turnUnnerve`, `applyBoosts` | as typed | the kernel's own helpers, exposed for the moved code (faces, spread, max, reactions) and D/E | today's |
| changed: `conditionsFor` | `(w, attacker \| null, target, multiple, moveId?, residual?)` | 681: residual variant; `luckyChant`, swamp, `allyTarget`, Mat Block | today's values |
| changed: `searchFor`, `applyStep` | as typed | see Contract notes | today's |

## Hook call sites (file:line, by function)

- `doubles-turn.ts` makeKernel: 505 `guardHooks.lockedBerryGuard`, 548 `faceHooks.faceTaken`, 549 `faceHooks.faceHit`, 552 `pairHooks.focusBand`, 553 `reactionHooks.unnerveStand`, 555 `maxHooks.maxEffects`, 556 `stageHooks.selfBoost`, 557 `stageHooks.foeDrop`, 559 `stageHooks.applyBoosts`
- `doubles-turn.ts` selfBoost: 589 `stageHooks.selfBoost`
- `doubles-turn.ts` foeDrop: 591 `stageHooks.foeDrop`
- `doubles-turn.ts` proteanGuard: 593 `typingHooks.proteanGuard`
- `doubles-turn.ts` searchFor: 781 `guardHooks.hiddenStageGuard`, 807 `guardHooks.stepReport`, 809 `reactionHooks.stepEnv`, 809 `pairHooks.stepEnv`
- `doubles-turn.ts` presenceGuards: 1034 `presenceHooks.commanderGuard`, 1038 `presenceHooks.thirdPartyGuard`, 1040 `hiddenHooks.carriedStart`, 1045 `presenceHooks.dancerGuard`, 1049 `presenceHooks.movesGuard`, 1050 `hiddenHooks.skyDrop`, 1052 `callingHooks.callingGuard`, 1054 `presenceHooks.pledgeGuard`, 1056 `maxHooks.statusMove`, 1060 `maxHooks.randomStatusGuard`
- `doubles-turn.ts` rootWorlds: 1238 `historyHooks.proteanUsed`, 1242 `presenceHooks.rootActions`
- `doubles-turn.ts` walk: 1270 `presenceHooks.turnStart`
- `doubles-turn.ts` execute: 1343 `guardHooks.encoreRewrite`
- `doubles-turn.ts` runMove: 1409 `hiddenHooks.release`, 1430 `abilityHooks.afterMove`, 1432 `guardHooks.afterMoveCopies`, 1450 `presenceHooks.afterAction`
- `doubles-turn.ts` sparklingAria: 1532 `pairHooks.ariaFaint`
- `doubles-turn.ts` eventGuards: 1582 `guardHooks.copierGuard`, 1585 `guardHooks.symbiosisAfterAction`, 1594 `switchHooks.switchOut`
- `doubles-turn.ts` faint: 1656 `reactionHooks.allyFaint`, 1663 `fieldChangeHooks.stepField`, 1666 `presenceHooks.onFaint`
- `doubles-turn.ts` redirect: 1798 `historyHooks.entryTie`
- `doubles-turn.ts` contextFor: 1994 `pairHooks.assurance`, 2013 `presenceHooks.context`, 2013 `callingHooks.context`
- `doubles-turn.ts` hitChecks: 2044 `presenceHooks.invulnerable`, 2046 `hiddenHooks.misses`
- `doubles-turn.ts` damagingMove: 2265 `typingHooks.comboGuard`, 2266 `abilityHooks.damagingTry`, 2279 `presenceHooks.aim`, 2289 `pairHooks.frozenPriority`, 2296 `presenceHooks.tryMove`, 2296 `guardHooks.flingTry`, 2297 `historyHooks.moveTry`, 2300 `typingHooks.powderTryMove`, 2304 `presenceHooks.prepareHit`, 2336 `spreadHooks.spreadStep`, 2342 `hiddenHooks.crash`
- `doubles-turn.ts` chargeTurn: 2383 `hiddenHooks.chargeHidden`
- `doubles-turn.ts` moveFailure: 2414 `pairHooks.allyShield`
- `doubles-turn.ts` singleStep: 2459 `reactionHooks.beforeStep`, 2464 `guardHooks.ohkoStep`, 2469 `typingHooks.psychicNoiseKeepsBerry`, 2472 `faceHooks.faceTaken`, 2473 `faceHooks.faceHit`, 2477 `pairHooks.focusBand`, 2483 `reactionHooks.unnerveStand`, 2490 `maxHooks.maxEffects`
- `doubles-turn.ts` applyStep: 2564 `guardHooks.lockedBerryGuard`, 2565 `pairHooks.betweenHits`, 2653 `reactionHooks.unnerveRecoil`, 2666 `reactionHooks.veil`, 2702 `pairHooks.hurt`
- `doubles-turn.ts` stolenFacts: 2787 `guardHooks.ripenGuard`
- `doubles-turn.ts` hitReactions: 2810 `reactionHooks.cottonDown`, 2821 `switchHooks.switchOut`, 2822 `switchHooks.switchOut`
- `doubles-turn.ts` rowReason: 2827 `faceHooks.multiHit`
- `doubles-turn.ts` afterHit: 2858 `reactionHooks.afterKnockOut`, 2859 `typingHooks.groundingAfterHit`, 2860 `reactionHooks.koRetaliationAfter`, 2870 `switchHooks.switchOut`, 2879 `switchHooks.switchOut`, 2882 `typingHooks.afterHit`, 2884 `guardHooks.glaiveRushAfter`, 2905 `reactionHooks.volatileSecondary`, 2906 `typingHooks.psychicNoiseGuard`, 2911 `guardHooks.flingAfter`, 2912 `presenceHooks.afterHit`
- `doubles-turn.ts` residualReactions: 2922 `reactionHooks.koRetaliationAfter`, 2923 `typingHooks.afterHit`
- `doubles-turn.ts` dartsStep: 2979 `faceHooks.faceTaken`, 2983 `spreadHooks.spreadStep`
- `doubles-turn.ts` readersOf: 3035 `guardHooks.tracksItems`
- `doubles-turn.ts` pairRows: 3493 `reactionHooks.resistUnnerve`
- `doubles-status.ts` beforeMove: 135 `guardHooks.beforeFirst` (hook), 136 `historyHooks.beforeMoveStart` (hook), 148 `typingHooks.beforeAttract` (hook), 151 `historyHooks.destinyBondBefore`, 154 `historyHooks.destinyBondBefore`
- `doubles-status.ts` confusionHit: 413 `faceHooks.selfHit`, 420 `pairHooks.selfHitBand`
- `doubles-status.ts` presenceGuards: 467 `callingHooks.presence`
- `doubles-status.ts` afterHit: 535 `pairHooks.safeguard`
- `doubles-status.ts` statusType: 682 `typingHooks.retypeStatus`
- `doubles-status.ts` statusMove: 713 `presenceHooks.statusMove`, 713 `callingHooks.statusMove`, 741 `fieldChangeHooks.beforeFieldMove`
- `doubles-status.ts` earlyBranch: 782 `typingHooks.proteanGuard`, 788 `historyHooks.stallPrepare`, 804 `fieldHooks.snatch`, 819 `callingHooks.helpingHand`, 834 `fieldHooks.fieldMove`
- `doubles-status.ts` runUse: 911 `typingHooks.powderTryMove`
- `doubles-status.ts` targetsOf: 969 `typingHooks.ateRedirectGuard`
- `doubles-status.ts` prepareHit: 1031 `typingHooks.proteanGuard`, 1033 `fieldHooks.snatch`
- `doubles-status.ts` tryHit: 1094 `presenceHooks.invulnerable`, 1094 `hiddenHooks.missesStatus`, 1108 `fieldHooks.tryHitSide`
- `doubles-status.ts` effects: 1298 `typingHooks.roost`
- `doubles-status.ts` volatile: 1444 `typingHooks.ingrainGuard`, 1452 `typingHooks.magnetRiseGuard`
- `doubles-status.ts` lastMoveVolatile: 1534 `guardHooks.encoreGuard`
- `doubles-status.ts` painSplit: 1675 `maxHooks.painSplitMax`
- `doubles-status.ts` sideOrField: 1728 `typingHooks.proteanGuard`, 1730 `fieldHooks.snatch`, 1765 `fieldHooks.fieldMove`
- `doubles-status.ts` switchOut: 1803 `switchHooks.switchOut`
- `doubles-status.ts` updateAll: 1933 `abilityHooks.updateCures`
- `doubles-status.ts` setStatus: 2074 `presenceHooks.afterSetStatus`
- `doubles-eot.ts` resolveFaints: 319 `fieldChangeHooks.eotField`
- `doubles-eot.ts` weatherHandler: 536 `fieldChangeHooks.eotField`
- `doubles-eot.ts` ejectPack: 1011 `switchHooks.switchOut`
- `doubles-eot.ts` afterChecks: 1046 `guardHooks.copierEndOfTurn`, 1047 `guardHooks.symbiosisEndOfTurn`
- `doubles-items.ts` receive: 115 `guardHooks.symbiosisReceived`
- `doubles-spread.ts` spreadStep: 58 `reactionHooks.contactKO`, 84 `reactionHooks.beforeStep`, 85 `guardHooks.ohkoStep`, 125 `reactionHooks.spreadUser`
- `doubles-field.ts` fieldMove: 43 `fieldChangeHooks.beforeFieldMove`, 45 `fieldChangeHooks.afterFieldMove`, 49 `fieldChangeHooks.beforeFieldMove`, 52 `fieldChangeHooks.afterFieldMove`, 60 `hiddenHooks.land`, 61 `fieldChangeHooks.afterFieldMove`, 71 `fieldChangeHooks.beforeFieldMove`, 73 `fieldChangeHooks.afterFieldMove`, 80 `fieldChangeHooks.beforeFieldMove`, 82 `fieldChangeHooks.afterFieldMove`
- `doubles-stages.ts` applyBoosts: 84 `fieldHooks.mistBlocks`, 90 `guardHooks.noteRise`
- `doubles-switch.ts` switchOut: 33 `presenceHooks.cannotLeave`

Item history (`kernel.noteItemUse`, F3 §4.1's paths; a no-op while `tracksItems` is false): doubles-turn.ts `ateBerry` (2184),
`startWorld` (the settle's used item), `applyStep` → `stepItems` (2732, 2738: each lost item used or taken, `World.itemsTaken`);
doubles-status.ts 186 (`turnStartUpdate`), 443 (confusionHit's Focus Sash), 542 (`cureConfusionBerry`), 1898/1906/1916
(`updateAll`'s cures and Mental Herb), 1957/1969 (`receivedItem`), 2105/2115 (`giveStatus`); doubles-stages.ts 139
(`whiteHerbAfterMove`); doubles-items.ts 125 (`receive`'s White Herb); doubles-eot.ts `loseItem` (900) for every end-of-turn use.

## presenceGuards (doubles-turn.ts:1025): the loop and today's order, each line its owner's hook (C27)

1034 `presence.commanderGuard` → 1036 the Ability Shield replacer under Neutralizing Gas (kernel) → 1038
`presence.thirdPartyGuard` → 1040 `hidden.carriedStart` → (targetless or No move: next slot) → 1045 `presence.dancerGuard` → 1047
`status.presenceGuards` (A; CL's Sleep Talk and Uproar lines inside through `calling.presence`) → 1049 `presence.movesGuard` →
1050 `hidden.skyDrop` → 1052 `calling.callingGuard` → 1054 `presence.pledgeGuard` → 1056 `max.statusMove` → 1058 Custap with
Quick Draw or Mycelium Might (inline until 0b.3's `start.custapGuard`) → 1060 `max.randomStatusGuard`.

## Decisions and deviations

- **Kept out of Step 0 so behaviour stays (each its track's):** the Berserk-lock stand-in (`vol.berryLocked` is set today and
  `lockedBerryGuard` stands); writing `fieldSet` and side `clock` (they would change E2 outcomes); SPEC2 §2.5's move-keyed
  "Assumes…" facts (they would change stored facts); the outcome fields for state today's turn already sets
  (`DoublesOutcomeMon.stages` from `vol.stages`, `berryLocked`): emitting them would split today's E2 outcomes, so `status2Mon`
  (doubles-turn.ts:4058) emits only the fields of new state (stockpile, charging, onceUsed, chiStrike, pendingCopy, lastItem,
  berryWeaken, cudChew's Berry, turnsLeft); A1 and D add the other two with their models. `MonState.taken` (the Counter
  family's) is not written: the damage taken differs per HP entry of a child world, so its writer needs PR's split
  (`presence.tracksHits` stays false).
- **Changed on purpose (ADDENDUM2 §3.7, 0a.4):** C32 (an ally may be the seeder, trapper or Syrup Bomb source; the texts
  become "… is not a Pokémon of the turn." for the Pokémon itself or an empty slot) and C23 (Ally Switch's counter accepts 1:
  "Ally Switch's counter is 1, 3, 9, 27, 81, 243 or 729 (Scarlet/Violet and Champions)."). No stored case has either; the
  two assertions of `tests/unit/doubles-kernel.test.ts` were updated.
- **Inert but with consequences once 0b's engine reads them:** `calcBuild`'s `grounding` marker from carried or move Ingrain and
  Smack Down (stored cases have only a carried Ingrain on a grounded Venusaur), `takenMods.hidden` from a charge's `eot.hidden`,
  Roost's types while roosted, `allyTarget` in the conditions of an ally target, `luckyChant` / `swamp` on the sides.
- **Deviations from the spec text:** `hidden.carriedStart` is called from `presenceGuards` (with today's semi-invulnerable
  reason), not `carriedState` (which also runs for the start rows and the moves pane, with no not-estimated path);
  `history.stallPrepare` returns `{ pass, fail }` (the protecting move's worlds and the failed roll's); the invulnerability
  step's miss is `{ by: "miss", hidden: label }` with blockedHit's fact "{Move} misses {Name} ({label})."; the hooks' `stepEnv`
  take the move id; the BeforeMove gates and after-move hooks may return null (Performance); `guards.flingTry` and
  `history.moveTry` take the target, so they run per resolution beside `moveFailure` (TryMove's place), while
  `typing.comboGuard` and `abilities.damagingTry` run right after `moveInfo`; Mat Block's block in `hitChecks` reads the move's
  `protect` flag from the engine's move flags (A3 confirms the flag's presence when it sets `matBlock`).
- **`residualHit`** (T2E §4.1.4) follows the hidden miss, Telepathy, the calculation's no-damage row, `applyStep(residual)` and
  the target's reactions (Aftermath, Innards Out, A2's type change); a Substitute or an intact Disguise / Ice Face in the way is
  not estimated yet (E2's landing models them). The attacker of a source not in battle is a slot of its side that the step never
  writes (`writes` false).
- **Heal Block stand-ins (C14):** `searchFor` reads a heal-blocked target's HP Berry (and an attacker's HP Berry or Shell Bell)
  as Leftovers from `eot.healBlock`; `applyStep`, `spreadStep` (attacker) and `faceHit` (attacker) put the item back
  (`unStandIn`, `unfollowed(…, standIn)`); `absorbEffect` and `pouchHeal` heal nothing under Heal Block. Today no step meets a
  Heal Block (Psychic Noise's guard stands), so none of this acts.
- **`typesOf`** reads `build.types` and `addedType` locally (the integrator may switch it to 0b's `mechanics.buildTypes`).

## Performance (the bench runs under tsx, whose esbuild output makes each `import * as ns` member a getter over a getter)

Profiling (node --cpu-prof, the bench and an in-process A/B against a HEAD tree extracted with `git archive`) found the Step 0
hook calls costing ~20% at first. The fixes, all with byte-equal results:
- the hook namespaces are copied once into plain objects in each calling module (`const guardHooks = { ...guardNs }`, with a
  note; no module of the graph is in a runtime cycle, which the source test checks);
- `speedOf`, `priorityOf` and `moveInfo` build their memo keys from the field itself (the same values `ownConditions` gave) and
  build the conditions only on a miss; `speedOf`'s key adds the swamp flag (0b's `turnSpeed` reads it);
- `hitChecks` builds a target's conditions only where a protection asks; `applyStep` reads the conditions' weather only where
  the step's weather is empty (today's order);
- `turnMarks` returns null at once while no marker state stands; the readers (`tracksItems`, `entryReaders`,
  `historyReaders`) are worked out once per input; `carriedState` returns early with nothing carried; the new BeforeMove gates
  and after-move hooks return null for an unchanged world; a few closures became plain references.

## Waiting on Step 0b (not done here, by the plan)

- `start.variants` and `start.custapGuard` (0b.3 moves `settleDoublesStart` into `doubles-start.ts`): `rootWorlds` still builds
  one settle, and presenceGuards' Custap line stays inline (1058).
- `UsesEnv.mist` / `report` and the engine readers of the markers (`withTurnMarks`): the kernel passes them already; `prepareUses`'
  options go through a cast until 0b's `UsesEnv` has them.

## Gates (final code; exact output lines)

1. `npm run check` (castmirror check, eslint, `tsc --noEmit`, vitest unit):
   `CastMirror parity verified: 862458f / castmirror-vercel-v1`; eslint and tsc print nothing;
   ` Test Files  231 passed (231)` / `      Tests  5897 passed (5897)`; exit 0.
2. `npm run test:battle-data:source`: ` Test Files  9 passed (9)` / `      Tests  141 passed (141)` (with `status2-hooks.test.ts`, 7
   tests, and `doubles-status-moves.test.ts`).
3. `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal (3317 ms)`.
4. Stored 2v2 app results (all 1264 cases), `step0a-run-app.ts <scratch>` then `step0a-diff-app.mjs`:
   - against HEAD's app results (run from `4008ee8` before any change): `1264/1264 byte-equal (ms removed); differ: 0; missing: 0; extra: 0`
     (facts included: the whole result JSON);
   - against the stored `verify/app-results`: `1264/1269 byte-equal (ms removed); differ: 0; missing: 5; extra: 0` (the 5 are
     stale stored files of cases no longer in cases.ts: E40-BoosterEnergy, E40-IcicleSpear-OccaBerry, ER16e, SA05, SA13).
5. `app-diff.mjs`: its report over the new results is byte-identical to its report over HEAD's results, both against its
   status-eot baseline (`424 ready, byte-equal after the moves…`, `87 unexplained`: the naming pass's and later fixes' known
   changes, present at HEAD) and against the stored app-results (`10 unexplained`: its own crit-fact normalisation when both
   sides are equal files). 0 differences introduced.
6. `regress.mjs scripts/.cache/calc-audit/2v2/verify/results`: `549/552 byte-equal after the moves (status-eot fields, ms and the
   walk bookkeeping stripped); differ: 3; missing: 0` — it compares the oracle's own results with its status-eot baseline and
   reads no app code, so its output is HEAD's (the 3 are the oracle results' pre-existing differences from that baseline: M24i,
   M24j, M29c).
7. Oracle comparison, `step0a-compare.ts` (compare.ts's `compareCase` with E2's outcomes): `1264/1264 cases match.`
8. Bench (`verify/bench.ts`, `results/bench.json` restored after each run), four rounds alternating HEAD (the same bench with
   `@/` pointed at a `git archive` of `4008ee8` through `TSX_TSCONFIG_PATH`) and this tree, on the final code:
   ```
   benchH-1 turn p50 2.68 p95 6.91 | moves p50 10.93      benchC-1 turn p50 2.81 p95 7.19 | moves p50 11.15
   benchH-2 turn p50 2.69 p95 6.80 | moves p50 11.16      benchC-2 turn p50 2.78 p95 7.11 | moves p50 10.72
   benchH-3 turn p50 2.72 p95 7.13 | moves p50 10.76      benchC-3 turn p50 2.78 p95 7.02 | moves p50 12.01
   benchH-4 turn p50 2.84 p95 7.12 | moves p50 11.01      benchC-4 turn p50 2.97 p95 7.43 | moves p50 11.03
   ```
   Means: turn p50 2.733 → 2.835 ms (+3.7%), p95 6.99 → 7.19 ms (+2.8%), moves pane p50 10.97 → 11.23 ms (+2.4%); statuses
   equal (ready 1340, not-estimated 127, issues 4); reference mode 30/30 equal. An earlier four-round batch on the same code
   but the Dancer reader's narrowing gave p50 +0.6%, p95 +0.7% (HEAD 2.705 / 6.695, this tree 2.72 / 6.74); the machine's
   load moves single runs by ±5%. In-process A/B at steady state (final code, 10 alternating passes each) the moves pane is
   0.947 (min) / 0.955 (median) of HEAD (`microbench-moves.ts`), the 1264 stored turns 0.916 / 0.951 (`microbench-ab.ts`)
   and bench.ts's 200 fuzzed turns 0.971 / 0.951 (`microbench-fuzz.ts`).

Not run, as Step 0 forbids it: `next build`, seed scripts, live Supabase. Nothing was committed or pushed.
