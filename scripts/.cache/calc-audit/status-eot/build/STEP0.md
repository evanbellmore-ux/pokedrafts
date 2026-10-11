# Step 0: contract and kernel (status-eot)

Branch `calc-2v2-status-eot`, from main `0ccce76`. This covers SPEC.md §8 "Step 0" and ADDENDUM.md §8's Step 0 additions.
Results do not change: every stub keeps today's behaviour, and the gates below are byte-equal.
After this step `app/lib/battle/doubles-turn.ts`, `app/lib/battle/doubles-world.ts` and the Step 0 turn API of
`app/lib/battle/uses-to-ko.ts` are frozen. Only the integrator edits them, for agreed fixes. Each track fills its own hook
file.

## Files

| File | What Step 0 wrote |
|---|---|
| `app/lib/battle/doubles-types.ts` | The SPEC §3.1 and ADDENDUM §3.1 contract: `DoublesCarried` (including `substitute` and `allySwitch`); `DoublesPokemonInput.carried`, `lastMove` and `moves`; `DoublesTurnInput.weatherTurns` and `canSwitch`; `DoublesHit.kind` gains `"effect"` and `"substitute"`, plus `change` and `substitute`; `DoublesHP.losses` and `conditions`; `DoublesResidual`; `DoublesEndOfTurn`. Ready results gain `endOfTurn` (required) and `swapped`. `DoublesOutcomeMon` gains `volatiles`, `sleepTurns`, `perishCount`, `substitute` and `allySwitch`. `DoublesOutcome` gains `positions` (required) and `sides[*].safeguard` and `hazards`. Ready outcomes gain `endOfTurn: "applied" \| { notEstimated }`. |
| `app/lib/battle/types.ts` | `BuildBase.focusEnergy?: true`, `dragonCheer?: 1 \| 2` (SPEC §3.2). Track A's `calculate.ts critRatio` reads them. |
| `app/lib/battle/doubles-world.ts` | Types: `MoveVolatiles` and `EotState`, with `MonState.vol` and `eot`; `SideState.safeguard` and `hazards`; `World.leaving`, `endGuard`, `swapped` and `itemsMoved`; `PendingAction.order`. `cloneMon` copies `vol` and `eot`. `cloneWorld` copies the four new world fields. `discreteKey` adds `swapped`, `endGuard` and `leaving`. New helpers: `positionOf`, `occupant`, `endTrap`, `lossDist` and `mapJoint`. The last two are implemented in full; they are pure world maths. |
| `app/lib/battle/doubles-actions.ts` | The `REASONS` additions from SPEC §2.4 and ADDENDUM §2.4 (exact texts). `sleep`, `freeze`, `confusion`, `pollenPuff` and `substituteHit` are kept, marked "Step 0's stub only". The tables are unchanged. |
| `app/lib/battle/doubles-turn.ts` | The kernel (details below). |
| `app/lib/battle/uses-to-ko.ts` | `UsesEnv.endure`; `TurnCase`; `TurnStepPart`; `TurnStepOutcome.subHits`; `turnStep(…, part?)` with the part semantics in full; `turnCases`; `targetHPClass`; `itemTakeable`, which `takeable` now delegates to. Details below. |
| `app/lib/battle/doubles-status.ts` | **Track A.** The moved code plus the hooks (below). |
| `app/lib/battle/doubles-eot.ts` | **Track B.** Hook stubs. |
| `app/lib/battle/doubles-positions.ts`, `doubles-items.ts`, `doubles-substitute.ts` | **Track E.** Hook stubs. |
| `tests/unit/uses-to-ko-turn-part.test.ts` (new) | The ADDENDUM §3.5 Step 0 gates (29 tests). |
| `tests/unit/doubles-kernel.test.ts` (new) | Positions, `endTrap`, cloning and keys, `lossDist`, `mapJoint`, the input checks, and the stubs' results (7 tests). |
| `tests/fixtures/doubles-turn.ts`, `tests/unit/calculator-doubles-fainted.test.ts`, `tests/unit/training-ai-evaluate.test.ts` | Their hand-built ready results and outcomes gain the now-required `endOfTurn` and `positions` (the stub's value). Nothing else changed. |

The hook modules import only `type`s from `doubles-turn.ts` (`TurnKernel`, `TurnMoveInfo`, `HitCheck`, `StartRoute`),
so there is no runtime import cycle. `doubles-turn.ts` imports them as
`statusHooks`, `eotHooks`, `positionHooks`, `itemHooks` and `substituteHooks`. Several functions there have locals named
`status` and `items`, so the namespaces need distinct names.

## The kernel (`doubles-turn.ts`)

`export type TurnKernel` is at `doubles-turn.ts:138`. It is built once per walk context by `kernelOf` and `makeKernel`
(`:326`, `:330`). Its members are the file's own helpers, so a hook changes the world exactly as the turn does:

- **Context:** `input`, `runtime`, `names`, `hp`, `gen7`, `champions`, `mode`; `reference` (a getter on `DOUBLES_REFERENCE.on`); `recording` (the statistics walk); `gas`; `budget`; `fieldSettledAbilities` and `fieldSettledItems`; `targetless(slot)`; `moveName`, `abilityName` and `itemName`.
- **World state:** `alive`, `isFoe`, `faint`, `speedOf`, `typesOf`, `grounded`, `itemWorks`, `effectiveWeather`, `laterDamaging`, `laterAction`, `occupant`, `positionOf`, `powderImmune`, `gasEnds`, `berryStopped`.
  - `grounded` now reads `eot.ingrain`, `eot.smackedDown`, `eot.roosted` (no Flying unless Terastallized) and `eot.magnetRise`, in `PS/sim/pokemon.ts:2148-2160` order.
- **Moves:** `breaks`, `priorityOf`, `moveInfo`, `usedType`, `usedTargetType`, `resolveTargets` (positions included), `redirect`, `spreadTargets`, `tracksTarget`, `protectPasses`, `moveFailure`, `priorityShield` (C6: the Queenly Majesty, Dazzling and Armor Tail part of `moveFailure`, split out), `hitChecks`, `focuses`, `secondaryLands`.
- **HP and Berries:** `afterLoss`, `berryDue`, `ateBerry`, `pouchHeal`, `noteHeal`, `noteBerry`, `unnerveEnds`, `absorbEffect`, `protectContact`.
- **Statistics:** these are no-ops outside the statistics walk.
  - `step`, `stepFact`, `hitFact`, `skipFact`, `hitStats`. `HitStats` gains `effect`, `change` and `sub`.
  - `subStat(action, target, mass, taken, broke)`.
  - `lossFact(slot, text, mass)`, which feeds `DoublesHP.losses`.
  - `turnFact(text)`: a turn fact found during the walk. It is appended after the input facts and deduplicated.
- **Guards:** `snapshot`, `eventGuards(before, w, damaging?)`, `gasShieldGuard`, `notEstimated`, `reasonOf(error)` (the reason of the file's private `NotEstimated`, else null), `leaving`.
- **Build data:** `buildStats` (`getBuildStats`).
- **Calculations:**
  - `calcBuild`, `conditionsFor`, `contextFor`.
  - `searchFor(…, spread?, attackerHP?, opts?: { behindSubstitute?: true })`. This is ADDENDUM §4.13.3's stand-ins, written in full. A working resist or Chilan Berry reads as `leftovers`; an intact Disguise or Ice Face reads as `GAS_STAND_IN`. The memo key carries the flag.
  - `applyStep(…, part?)` returns `StepChild[]`.
  - `blockedHit`, `faceTaken`, `faceHit`, `rowReason`, `noDamageFact`, `focusBandGuard`, `unnerveGuard`, `koBoost`, `maxEffects`.
- **Moved helpers:** `selfBoost`, `foeDrop` and `giveStatus` call Track A's moved code.

### Moved verbatim into `doubles-status.ts` (Track A)

`statusMove` (`:206`), `fieldMove` (`:277`), `fieldGuard` (`:331`), `stanceChange` (`:351`), `proteanGuard` (`:197`),
`selfBoost` (`:363`), `foeDrop` (`:385`), `statusLands` (`:423`), `giveStatus` (`:443`) and `berryConfusion` (`:159`).
In each, `ctx` became `kernel`. `doubles-turn.ts` keeps thin wrappers at `:425-431`. One line was added: `statusMove`
calls `kernel.leaving` for a switch move with no later action, which is a no-op until Track B.

### Position plumbing (ADDENDUM §3.5, written in full; neutral without `swapped`)

1. `resolveTargets` (`:1326`):
   - The chosen target is `occupant(w, action.target)`, or `action.target` for a tracking move.
   - There is a new first rule for a move aimed at the user's own ally's place, where the user now stands:
     - for `adjacentAlly`, `any` and `normal`, no target and the fact `{Move} fails: after Ally Switch, {Name} stands in {Partner}'s place.` (`Resolution.failed` suppresses "no target");
     - for Dragon Darts, `REASONS.dartsAimSelf`.
   - Other facts:
     - The fact `Ally Switch: {Move} hits {Occupant} in {Chosen}'s place.` is added unless redirection takes the move.
     - The fainted-target fact names the occupant.
     - The across-fallback reads `occupant(w, across(positionOf(w, attacker)))`.
2. `spreadTargets` (`:1266`) and `maxEffects`' foe order: by `showdownPosition(w, slot)`, the position after a swap.
3. `singleStep` (`:1782`): `substituteHooks.single` at `:1797`.
4. `spreadStep` (`:2210`): `substituteHooks.plan` at `:2260`, after the block check; `sub.apply` in the hit loop. It adds no retaliation; Life Orb stays once per move.
5. `applyStep` (`:1845`):
   - It takes `part` and passes it to `turnStep`.
   - The receiver's count becomes `timesAttacked += landed + subHits`.
   - With a part, `calculated` counts only outcomes with `landed > 0`.
   - `firsts` is still noted, so a `"substitute"` hit has its `row`.
6. `afterHit` (`:2095`):
   - `hitAny = landed + subHits > 0` gates the user rules: switch moves, `TYPE_LOSS_MOVES`, Glaive Rush, and `volatileGuard` for Core Enforcer and Spectral Thief.
   - The target rules stay on `landed > 0`.
7. `eventGuards` (`:1032`): Symbiosis skips `w.itemsMoved`. `runMove` (`:988`) deletes `itemsMoved` after its guards.
8. `startRoutes` (`:2922`): the centred-world block is now a closure. `positionHooks.startRoute` is at `:2969`, after it, inside the per-target loop. `StartRoute` is exported.
9. `HitStats.sub`: assembled as `kind = calculated ? "calculated" : sub.mass ? "substitute" : effect ? "effect" : blocked ? "blocked" : "no-damage"`, with `substitute` and `change` (`calculateDoublesTurn`, `:3078`).
10. `startWorld` (`:802`) and `carriedState` (`:836`) map `carried` into `vol` and `eot`, with the contract's defaults:
    - sleep: `vol.sleep = { elapsed: attempts × (Early Bird ? 2 : 1), rest }` for status `slp`, 0 without `carried`;
    - Champions freeze: `vol.freeze = { attempts }` for `frz`;
    - confusion: `{ attempts, min: axeKick ? 3 : 2 }`;
    - `eot.toxic` for `tox` (0 without `carried`);
    - the end-of-turn fields copied (trap divisor 6 with Binding Band, else 8; carried Yawn → `yawn: 1`);
    - `vol.substitute` and `vol.allySwitch`.
11. The Ally Switch turn fact: `positionHooks.turnFacts` at `:3050` (a hook, so no fact appears while Ally Switch is not modelled).
12. `calculateDoublesTurn` (`:3078`):
    - It sets `swapped` (`swappedShares`, `:3244`).
    - `DoublesHP.conditions` comes from `conditionFacts` (`:3219`): `statusHooks`, then `eotHooks`, `positionHooks`, `itemHooks`, `substituteHooks`.
    - `losses` comes from `kernel.lossFact`.
13. `outcomeOf` (`:3281`) and `mergeOutcomes` (`:3319`):
    - `positions` comes from `w.swapped`; `substitute` from `vol.substitute`.
    - `volatiles` is the sorted union of the three tracks' `outcomeMon` hooks plus `"substitute"`; `sleepTurns` is Track A's, `perishCount` Track B's, `allySwitch` Track E's.
    - `sides.safeguard` and `hazards` appear only when set.
    - The merge key adds `volatiles`, `perishCount`, `allySwitch` and `positions`. `hp`, `substitute` and `sleepTurns` merge as chance-weighted mixtures.

### Order (SPEC §3.4)

`keyOf` and `topGroup` (`:694`, `:701`) sort on `order` (absent = 200) first, then priority and Speed. Generation 7's frozen
keys keep `order`.

**Note to Track A:** `PendingAction` objects are shared between worlds, so never mutate one. Replace it, for example
`w.remaining = w.remaining.map((e) => e === target ? { ...e, order: 3 } : e)`. `execute` filters by identity on the
object it receives from `topGroup`, so a replacement in `w.remaining` works. The same rule applies to `vol`, `eot` and
`SideState.hazards`: replace the value, never mutate it in place (`mon.vol = { ...mon.vol, taunt: true }`).

## Hooks and their plug points

Each stub reproduces today's behaviour. Line numbers are those of `doubles-turn.ts` (call sites) and of the hook file (definitions).

### Track A — `doubles-status.ts`

| Hook (definition) | Called at | Stub (today) |
|---|---|---|
| `beforeMove(kernel, w, action): { go: World[]; stopped: World[] }` (`:32`) | `execute` `:933`, for every picked action of a living Pokémon, No move included. `stopped` worlds come first, then each `go` world's `runMove`. No move returns `[...stopped, ...go]`. | Flinch with Steadfast, Gravity, Throat Chop, paralysis (1/4, Champions 1/8), Focus Punch's lost focus. No move: `{ go: [w] }`. |
| `presenceGuards(kernel, w, slot)` (`:82`) | `presenceGuards` `:775`, for a slot with a move and a target, after Dancer | The sleep and freeze guards, `HP_STATUS_MOVES`, Pollen Puff on an ally. |
| `statusMove(kernel, w, action, move): World[]` (`:206`) | `runMove` `:993` | Moved verbatim. |
| `exitsAfter(kernel, action, move): boolean` (`:108`) | `runMove` `:999` → `eventGuards(…, damaging)` | `true`: Emergency Exit and Wimp Out are checked after every action. For C7, return false for status moves. |
| `tryMove(kernel, w, action, move, target, priority, info): string \| null` (`:139`) | `damagingMove` `:1657`, after `moveFailure` | `null` (for Snore after waking up). |
| `singleHit(kernel, w, action, info, check, attackerHP?): World[] \| null` (`:149`) | `singleStep` `:1789`, after the block check | `null` (for Pollen Puff's heal on an ally). |
| `endureFor(w, target): boolean` (`:114`) | `searchFor` `:562`: `UsesEnv.endure`, memo key | `!!vol.endure`, which is never set yet. |
| `onKnockOut(kernel, w, attacker, target)` (`:98`) | `hitReactions` `:2024` (after Cotton Down) | The Destiny Bond guard. |
| `afterHit(kernel, w, action, target, outcome, info)` (`:123`) | `afterHit` `:2137` (after Throat Chop, before `volatileGuard`) | The Dynamic Punch and Chatter confusion guard. |
| `berryConfusion(kernel, w, slot, item)` (`:159`) | `ateBerry` and `applyStep`, through the wrapper | Moved verbatim (the guard). |
| `conditions(kernel, w, slot): string[]` (`:169`) | `conditionFacts` `:3221` | `[]` |
| `outcomeMon(kernel, w, slot): { volatiles?, sleepTurns? }` (`:175`) | `outcomeOf` `:3294` | `{}` |
| `turnFacts(input): string[]` (`:181`) | `turnFacts` `:3050`, deduplicated (for Endure's "no protecting move" fact too) | `[]` |

SPEC §3.5's `status.beforeHit` (a Substitute in front of a damaging move) is superseded by ADDENDUM §3.5's
`substituteHooks.single` and `plan`, so it is not written. The hit-loop Endure line is in `uses-to-ko.ts` (`:2760`).

### Track B — `doubles-eot.ts`

| Hook (definition) | Called at | Stub (today) |
|---|---|---|
| `endOfTurn(kernel, worlds): EndOfTurnRun` (`:25`) | `endOfTurnOf` `:3168`, after each of the three walks in `calculateDoublesTurn` and after the one walk in `calculateDoublesOutcomes`. A `NotEstimated` thrown inside is converted. | `{ status: "not-estimated", reason: "End-of-turn effects are not applied." }` |
| `afterHit(kernel, w, action, target, outcome, info)` (`:35`) | `afterHit` `:2142`, last. It reads `outcome.landed` and `outcome.subHits` (C16). | no-op |
| `charging(w, slot, move)` (`:40`) | `chargeTurn` `:1719` | no-op |
| `leaving(w, slot)` (`:48`) | With no later living action: switch moves (`statusMove`); U-turn, Volt Switch and Flip Turn (`:2117`); Dragon Tail and Circle Throw (`:2125`); Eject Button and Red Card (`:2032-2033`); Eject Pack, Emergency Exit and Wimp Out (`:1060`); `kernel.leaving` | no-op |
| `endFacts(input): string[]` (`:53`) | `turnFacts` `:3030`, second place | `["End-of-turn effects are not applied."]` |
| `conditions(kernel, w, slot)` (`:59`) | `conditionFacts` `:3221` | `[]` |
| `outcomeMon(kernel, w, slot): { volatiles?, perishCount? }` (`:65`) | `outcomeOf` `:3294` | `{}` |

`EndOfTurnRun` is `{ status: "ready"; worlds; residuals; facts } | { status: "not-estimated"; reason }`.

- In `calculateDoublesTurn`, the end of turn is ready only when all three walks' runs are ready. `endOfTurn.hp` is then built by `hpRecords` (`:3184`) from the worlds after the residuals, the low and high values from the roll walks; start, settled, heals, losses and the faint before moving are copied from `hp`. `residuals` and `facts` come from the statistics walk's run.
- In E2, the outcomes come from the ready run's worlds (`endOfTurn: "applied"`), or else from the moves' worlds.

### Track E — `doubles-positions.ts`, `doubles-items.ts`, `doubles-substitute.ts`

| Hook (definition) | Called at | Stub (today) |
|---|---|---|
| `allySwitchPrepare(kernel, w, action, move): World[]`, `allySwitchHit(…)` (positions `:20`, `:26`) | Track A's dispatch (handler key `allySwitch`) | `notModelledBefore` with a later living action, otherwise `w.endGuard ??= notModelled`. |
| `swapItems(kernel, w, action, target, move): World[]` (items `:13`) | Track A's dispatch (handler key `swapItems`) | The same. |
| `startRoute(kernel, w, slot, move, info, target, routed): StartRoute \| null` (positions `:35`) | `startRoutes` `:2969` | `null` |
| `single(kernel, w, action, info, check, attackerHP?): World[] \| null` (substitute `:29`) | `singleStep` `:1797` | `null` when no Substitute is met. Otherwise `REASONS.substituteHit(name)`. A sound move, Hyperspace Fury and Hole, Spectral Thief, Infiltrator, or the user itself pass it (SPEC §4.5's rule). |
| `plan(kernel, w, action, info, check, multiple, attackerHP?): SubPlan \| null` (substitute `:36`) | `spreadStep` `:2260` | The same. |
| `conditions(…)` (positions `:41`, items `:21`, substitute `:43`) | `conditionFacts` `:3222` | `[]` |
| `outcomeMon(kernel, w, slot): { volatiles?, allySwitch? }` (positions `:51`) | `outcomeOf` `:3294` | `"allyswitch"` and the counter only when `vol.usedMove === "allyswitch"` and `vol.allySwitch` stands. A carried counter that is not used again ends with this turn, because its volatile has duration 2. |
| `turnFacts(input)` (positions `:58`) | `turnFacts` `:3050` | `[]` |

## `uses-to-ko.ts` (turn mode only; 1v1 never sets these)

- `UsesEnv.endure` (`:360`), read as `m.endure` (`:385`). In `hits()`, `if (endures && damage >= hp && damage > 0) damage = hp - 1;` sits before the False Swipe line (`:2760`). It sets no `SASH_USED` and no `SAVED`.
- `turnStep(entries, mode, follow, part?)` (`:1243`):
  - `this.turnPart` is set for the walk.
  - `hits()` takes `partCases` (`:1287`): case `caseIndex` of `casesFor(run, mode)` at chance 1, hits from `skip` on, keyed by its place in the run's cases.
  - Rows are recorded only when a hit reaches the target.
  - Node and variant keys add `,s{skip}` (`:2878`).
  - Each outcome's `subHits` is `skip`.
- The part semantics in `afterHit`, with `hitAny = damaged || subHits > 0` (`:3237`):
  - **On `hitAny`:** the self stages; `userSecondary` `max(1, landed + subHits)` times; the Gem, Charge and the Stellar drop (unconditional, as before); the Z-Move `selfBoost`; Ice Spinner and Steel Roller; the target's Air Balloon (Unburden through `itemsLost`); the hit walk (`loop`) and the attacker's HP after the use.
  - **Only for hits on the target:** everything else, including Spicy Spray (now gated on `landed > 0` under a part).
  - **Without damage to the target:** `attackerAfterUse` and `afterHitsLosses` take `noDamage` (`:3495`, `:3575`), so no recoil, no self-cost and no Shell Bell. Life Orb still applies.
  - Without a part the code is exactly today's.
- `turnCases(attackerHP, targetHP, mode)` (`:1308`) and `targetHPClass(hp)` (`:1325`, the `hpCode` that `hits()` splits by).
- `itemTakeable(runtime, paradox, itemId, holder, taker, thief)` (`:4690`). `takeable` delegates to it.

## Decisions and deviations (flag to the integrator)

1. **The `wish` input check.** SPEC §3.1 says "wish outside 1..maxHP". The check is "a whole number of at least 1", because a Wish is half its user's maximum HP, which can exceed the receiver's (Blissey into Pikachu). This follows the same reasoning as the critic's Substitute bound (C13′).
2. **Exact input-issue texts.** SPEC lists conditions only. The issue `message`s are lowercase sentences, which the UI shows as `{Name}: …`, matching the two exact ADDENDUM texts. One extra consistency check was added so that Track A's posterior never divides by zero: carried sleep attempts must satisfy `attempts × (Early Bird ? 2 : 1) < 4` (Champions or Rest: `< 3`), and Champions freeze attempts must be 0–2.
3. **Extra hooks beyond SPEC §3.5's list**, so that no track needs to edit `doubles-turn.ts`:
   - Track A: `presenceGuards`, `exitsAfter` (C7), `tryMove`, `singleHit`, `afterHit`, `berryConfusion`, `conditions`, `outcomeMon`, `turnFacts`.
   - Track B: `endFacts`, `conditions`, `outcomeMon`.
   - Track E: `positions.outcomeMon` and `turnFacts`.
4. **`discreteKey` also carries `endGuard` and `leaving`.** Otherwise worlds with different end-of-turn guards would merge, and SPEC §4.7 needs each guard's mass.
5. **Turn facts are deduplicated.** Today's facts have no duplicates, so this changes nothing.

## Gates (all run on the final code)

1. **`npm run check`:** lint clean, `tsc --noEmit` clean.
   ```
   Test Files  208 passed (208)
        Tests  4702 passed (4702)
   ```
   This includes the new `uses-to-ko-turn-part.test.ts` (29 tests) and `doubles-kernel.test.ts` (7 tests).
2. **`npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check`:**
   `golden-1v1: 254 cases byte-equal (4300 ms)`
3. **Stored 2v2 app results.** Every case was rerun with `appTurn` into a scratch folder by `step0-run-app.ts <out>`, then diffed with `step0-diff-app.mjs <out> scripts/.cache/calc-audit/2v2/verify/app-results --strip-eot`:
   `588/588 byte-equal (ms removed, endOfTurn stub removed); differ: 0; missing: 0; extra: 2; endOfTurn seen 549, not the stub: 0`
   - The 39 not-estimated results are byte-equal in full.
   - The 549 ready results differ only by the contract's new required `endOfTurn` key. Every one holds the stub value `{ status: "not-estimated", reason: "End-of-turn effects are not applied." }`.
   - The 2 extra stored files (`SA05`, `SA13`) are stale; they are not in `cases.ts`.
   - `app-results/` was **not** overwritten, because it is not byte-equal in full while the new key is present. Track D regenerates it.

   **Oracle comparison.** `step0-compare.ts` runs `compare.ts`'s `compareCase` for every case against `results/` and writes nothing into the verify folder. It reports `588/588 cases match.`
4. **`npm run test:battle-data:source`:** `Test Files  4 passed (4)`, `Tests  101 passed (101)`. `doubles-third-party.test.ts` reads `doubles-actions.ts`.

**Bench (a check, not a Step 0 gate):** `verify/bench.ts` was run twice. It rewrites `results/bench.json` by design.
- Turn: p50 3.8–3.9 ms, p95 8.3 ms, max 18–21 ms (targets 30 / 120 / 400).
- Moves pane: p50 13.3 ms, max 23–27 ms (target 25). The max varies between runs.

Not run, as Step 0 forbids it: `next build`, seed scripts, live Supabase. Nothing was committed.
