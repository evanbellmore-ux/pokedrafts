# Step 2: R's contract, stubs and hooks (status2 wave 2, ADDENDUM2 §8.7 step 1)

The user's Q1 = R (USER-DECISIONS.md): switch-outs with a replacement in the 2v2 calculator and in Training. This step writes
SPEC2 §4.8 / §8.5's R contract (guards.md §5.4 as amended by inputs.md §3.1 and §5.7, ADDENDUM2 §5.3 and §8.7), the inert
kernel plumbing that reads only the new fields, and the stubs R-E fills, each keyed on a field nothing sets yet (the bench,
the hazards, MonState.id, World.benched / bench / switching). Behaviour does not change: every gate below is byte-equal.

## Status

- **Branch:** `calc-2v2-status-2`, checked before the work and again before this report. Nothing was committed, pushed or
  switched. `.claude/`, `node_modules`, CastMirror and RaidCard files were not touched. No `next build`, nothing against live
  Supabase, no browser, no credentials.
- **Line endings:** every edited file keeps its own (the CRLF files `doubles-types.ts`, `doubles-world.ts`, `doubles-switch.ts`,
  `doubles-actions.ts`, `doubles-use.ts`, `doubles-faces.ts`; the LF files `doubles-turn.ts`, `doubles-eot.ts`,
  `doubles-field.ts`, `doubles-max.ts`, `doubles-presence.ts`, `doubles-status.ts`, `tests/source/status2-hooks.test.ts`):
  checked by counting CRs against the pre-step snapshot.
- **Record:** `step2/step2.diff` (this step's whole change, against the snapshot taken first), `step2/pre/app/lib/battle`
  (that snapshot, the A/B tree of the timing check), `step2/logs/` (the gate logs), `step2/learners.ts` (the learner probe the
  unit test's Pokémon came from).

## Files

| File | Change |
|---|---|
| `app/lib/battle/doubles-types.ts` | the R contract (below): `DoublesBenchPokemon`, `DoublesHazards`, `DoublesReplaced`, `DoublesBenchedMon`; `DoublesTurnInput.bench`, `replacement`, `hazards`; `DoublesTurnResult.replaced`, `hpEntered`; `DoublesEndOfTurn.hpEntered`, `replaced`; `DoublesHit.id`, `DoublesResidual.id`, `DoublesOutcomeMon.id`, `DoublesOutcome.benched`; `startId`, `sideCanSwitch`, `benchNameParts`, `doublesBenchNames`, `turnBenchNames`; `NameParts.number` widened to `number \| null` |
| `app/lib/battle/doubles-world.ts` | `MonState.id`, `BenchedMon`, `PendingSwitch`, `World.benched`, `World.bench`, `World.switching`; `cloneWorld` copies them, `discreteKey` adds one entry while one is set |
| `app/lib/battle/doubles-actions.ts` | `REASONS.entersWithGas` (SPEC2 §2.4's exact text) |
| `app/lib/battle/doubles-switch.ts` | `switchOut` routes a side with a bench to `replaceSlot`; the stubs `replaceSlot`, `betweenActions`, `benchedOutcome`, `hazardFails` |
| `app/lib/battle/doubles-turn.ts` | kernel `benchNames`, `startNames`, `nameOf`; `syncOccupants` (names and HP follow the occupant); `betweenActions` after each action; `benchIssues` in `validate`; `outcomeOf` emits `id` and `benched`, `mergeOutcomes` keys and mixes them; `battleOver` and `afterHit` read `sideCanSwitch` |
| `app/lib/battle/doubles-use.ts`, `doubles-eot.ts`, `doubles-faces.ts`, `doubles-field.ts`, `doubles-max.ts`, `doubles-presence.ts` | every read of `input.canSwitch` goes through `sideCanSwitch` (one line each; doubles-eot.ts three) |
| `app/lib/battle/doubles-status.ts`, `doubles-max.ts`, `doubles-eot.ts` | the `hazardFails` hook at the three places a hazard lands |
| `tests/unit/status2-r-contract.test.ts` (new) | 11 tests: sideCanSwitch, a bench as canSwitch (Healing Wish, U-turn), the bench names, every new input issue, the World fields, the stubs |
| `tests/source/status2-hooks.test.ts` | 6 MOVED rows, 4 CALLS rows (walk, validate, outcomeOf, switchOut), and "every canSwitch reader goes through sideCanSwitch" |

## The contract (doubles-types.ts, doubles-world.ts)

Every field is optional and absent in every input and world today; nothing sets one yet.

**Input** (`DoublesTurnInput`, doubles-types.ts:362-380):
- `bench?: Partial<Record<DoublesSideId, readonly DoublesBenchPokemon[]>>`: each side's living bench, in order. Where given it
  takes `canSwitch`'s place (`sideCanSwitch`: a Pokémon is left exactly when the list is not empty; an empty list is
  `canSwitch` false), and that side's switch-outs go to `replaceSlot`. Absent: not known (today's `switchesOut` / leaving).
- `replacement?: Partial<Record<DoublesSlotId, string>>`: the bench id that comes in for the Pokémon that started the turn in
  that slot when its player picks (the twelve chosen triggers). Absent with a bench: the first bench Pokémon not in play (the
  turn fact `Assumes {Newcomer} comes in for {Name}.`, R-E's). Random drags read none.
- `hazards?: Partial<Record<DoublesSideId, DoublesHazards>>`, `DoublesHazards = { stealthRock?: true; spikes?: 1 | 2 | 3;
  toxicSpikes?: 1 | 2; stickyWeb?: true; steelsurge?: true }` (IN §3.1's `steelsurge`, SwSh).
- `DoublesBenchPokemon = { id; build; carried?: Pick<DoublesCarried, "sleep" | "freeze" | "onceUsed">; moves? }` (doubles-types.ts:398):
  IN §3.1's shape (no `toxic`: its stage restarts on entry) plus `moves` (below). Ids are the caller's; `slot:…` is reserved.

**Result** (doubles-types.ts:419-436, 590-630):
- `DoublesTurnResult.replaced?: Partial<Record<DoublesSlotId, DoublesReplaced>>`, `hpEntered?: Partial<Record<DoublesSlotId,
  Record<string, DoublesHP>>>` (after the moves); `DoublesEndOfTurn` (ready) gains the same two: `hpEntered` after the whole
  turn, `replaced` for the switches after the residual (Eject Pack at order 29, Emergency Exit, Wimp Out).
- `DoublesReplaced = { left: { id; hp: DoublesHP; chance }[]; entered: { id; chance }[] }`.
- `DoublesHit.id?`, `DoublesResidual.id?`: the Pokémon reached or acted on when it is not the slot's starting Pokémon.
- E2: `DoublesOutcomeMon.id?` (the occupant at the end, when a newcomer) and `DoublesOutcome.benched?:
  Partial<Record<DoublesSideId, DoublesBenchedMon[]>>`, `DoublesBenchedMon = DoublesOutcomeMon & { id; slot }`.
- `startId(slot)` = `slot:{slot}`: the id a slot's starting Pokémon goes by in these fields (MonState.id absent).

**Names** (doubles-types.ts:83-117, 453): `benchNameParts(base, bench)` names each side's bench after the four slots'
names, which it does not change: the side word when a Pokémon of the other side (in play or benched) has the name, a number
when one of its own side before it (the slots, then its bench in order) has it (one more than their count). `doublesBenchNames`
(by species name) and `turnBenchNames(input)` (empty without a bench) give the texts; `NameParts.number` is `number | null` now.

**World** (doubles-world.ts:229-260, 368-374):
- `MonState.id?: string`: absent for the slot's starting Pokémon, the bench id for a newcomer; `mons[slot]` is the occupant.
- `World.benched?: Partial<Record<DoublesSideId, BenchedMon[]>>`, `BenchedMon = { id; slot; mon: MonState; hp: [hp, mass][] }`:
  the leavers with their state and HP marginal as they left (arrays, so the discrete key holds them).
- `World.bench?: Partial<Record<DoublesSideId, string[]>>`: the ids still on the bench (absent: the input's whole bench).
- `World.switching?: PendingSwitch[]`, `PendingSwitch = { slot; how: SwitchHow; moveId }`: the switch-outs set during the
  current action, made as it ends.
- `cloneWorld` copies the three (shallow; replace the lists, never push into them); `discreteKey` adds
  `{ benched, bench, switching }` as one more entry only while one is set (today's key otherwise: the plumbing test pins it).

**REASONS.entersWithGas** (doubles-actions.ts:250): `{Name}'s Neutralizing Gas coming in is not modelled in 2v2.`

**Deviations from guards.md §5.4 / inputs.md §3.1, each for a reason:**
- `DoublesReplaced.left` is a list with an id string (`startId` for the starting Pokémon, not `null`), a `DoublesHP` and the
  share of the turn in which it left: a newcomer can leave the same slot again (an entrant's Eject Pack after a foe's entry
  Intimidate: guards.md B1's chain), a switch can happen in only some outcomes (a U-turn that misses), and the card's leaver
  line reads a DoublesHP. E2's per-Pokémon distribution is `DoublesBenchedMon.hp`.
- `World.benched` holds the whole `MonState` and the marginal as `[hp, mass]` pairs (guards.md: `build`, a Map, `eot…`), so
  the discrete key compares it and a returning leaver keeps its state.
- `DoublesBenchPokemon.moves`: ADDENDUM2 §8.7 has R-E's Assist read the bench's moves (pinned assist reads each party member's
  moveSlots); IN §3.1 had no place for them, and doubles-types.ts is frozen to R-E.
- `DoublesHit.id`, `DoublesResidual.id`, `DoublesEndOfTurn.hpEntered` / `replaced` are not in the designs: a slot's hits and
  residuals can be split between two Pokémon, and the end of turn has its own switches; R-E cannot add them to the frozen types
  file. They are optional and may stay unused.
- `World.switching`, `betweenActions`, `syncOccupants`, `hazardFails` are this step's hooks (below), not in the designs.

## Hooks and stubs (doubles-switch.ts: R-E's file in wave 2)

| Export | Signature | Step 2 | Call sites |
|---|---|---|---|
| `switchOut` | `(kernel, w, slot, how: SwitchHow, action: PendingAction \| null)` | today's rule; with the leaver's side's bench given: `replaceSlot` | doubles-turn.ts:1725 eventGuards (Eject Pack, Emergency Exit, Wimp Out); 3059, 3060 hitReactions (Eject Button, Red Card); 3112, 3122 afterHit (U-turn family, Dragon Tail / Circle Throw); doubles-status.ts:1817 switchOut (Parting Shot, Baton Pass, Shed Tail, Teleport, Chilly Reception, Roar, Whirlwind; `action` names the move); doubles-faces.ts:301, 306 (Eject Button, Red Card behind a face); doubles-eot.ts:2179 ejectPack ("residual": returns first, as today) |
| `replaceSlot` | `(kernel, w, slot, how, action)` | stub: today's rule (`switchesOut` with a later living action, else `kernel.leaving`), so a bench given before R-E lands changes no number | doubles-switch.ts switchOut |
| `betweenActions` | `(kernel, w): World[] \| null` | stub: null (this world goes on unchanged) | doubles-turn.ts:1357 walk, after each `execute`, before the weather check (a newcomer's Drought counts as the action's `weatherSet`) |
| `benchedOutcome` | `(kernel, w, entry: BenchedMon): DoublesBenchedMon` | `{ id, slot, hp, build, protected: false, moved }` | doubles-turn.ts:4398 outcomeOf, per `World.benched` entry |
| `hazardFails` | `(kernel, w, side, hazard): string \| null` | stub: null (each hazard lands, as today) | doubles-status.ts:1760 sideOrField (a hazard move: the text is its failure fact, then `[w]`); doubles-max.ts:138 gmaxEffect (Steelsurge, Stonesurge); doubles-eot.ts:2333 afterHit (Ceaseless Edge, Stone Axe) |

`SwitchHow` stays `"ejectpack" | "exit" | "ejectbutton" | "redcard" | "selfswitch" | "drag" | "status" | "residual"`; for
"status" R-E reads `action.moveId` (Roar and Whirlwind drag the target: random; the others are the user's own: chosen).

## Kernel plumbing (doubles-turn.ts; reads only the new fields)

- **`sideCanSwitch` everywhere.** battleOver (1407), afterHit's `switchable` (3109), doubles-use.ts `canSwitch` (145: the
  status moves' fails and foesLeft), doubles-eot.ts (390 commute, 459 Emergency Exit / Eject Pack, 476 over), doubles-faces.ts
  (292), doubles-field.ts (709 Aromatherapy's bench fact), doubles-max.ts (303 G-Max Sweetness), doubles-presence.ts (86). The
  source test fails on any new `input.canSwitch` read outside doubles-types.ts.
- **Names and HP follow the occupant.** `Ctx.names` and `Ctx.hp` are the context's own copies (the input's `names` object is
  never written); `syncOccupants(ctx, w)` (1380) writes a newcomer's name (`benchNames`) and `turnHP` into them for the world the
  walk is at (1346, once per world before its next action) and puts the starting Pokémon's back (`startNames`, `startHP`) after
  the walk (1369). It returns at once unless `w.benched` is set or a newcomer's names are in. This holds because every world
  of one action has the same occupants: a switch-out is made only as the action ends (`betweenActions`), which is Showdown's
  order (sim/battle.ts:2821-2914: phazing's dragIn, faintMessages, the Update and Emergency Exit, then the switch requests).
  So the ~330 `kernel.names[slot]` and the `kernel.hp[slot]` reads in the frozen hook modules name and size the occupant.
- **Kernel members:** `benchNames` (turnBenchNames), `startNames` (the starting Pokémon's names, for text about a leaver),
  `nameOf(w, slot)` (the occupant's name in a given world, for code that holds several worlds).
- **validate → `benchIssues`** (3393; IN §5.7 and carriedIssues' texts): field issues `bench.{side}` `A bench holds at most four
  Pokémon.`; `bench.{side}.{i}` `{Name} is already in play.` (a `slot:` id), `Two bench Pokémon have the same id.`, `Bench
  {Name}: {validateBuild's message}` (a used Protean's issue aside: it resets on entry), `Bench {Name}: turns lost to sleep need
  the Asleep status.` and the other sleep, freeze and once-a-battle texts of carriedIssues, `Bench {Name}: its moves list a move
  twice.`; `hazards.{side}.spikes` `Spikes have 1 to 3 layers.`, `.toxicSpikes` `Toxic Spikes have 1 or 2 layers.`,
  `.steelsurge` `G-Max Steelsurge is not in this game.` (and `{Hazard} is not in this game.`, which no game of the four meets);
  the Pokémon's own issue `{ field: "replacement", message: "Its replacement is not on its side's bench." }` (an empty slot's
  replacement is not read). A bench Pokémon at 0 HP is validateBuild's `Current HP must be a whole number from 1 to {max}.`
- **E2:** `outcomeOf` sets `entry.id` from `MonState.id` (4389) and `benched` from `World.benched` through `benchedOutcome`,
  emitted last and only when not empty (4417); `mergeOutcomes` keys the occupant's `id` and the leavers without their HP and
  sleep counters, and mixes those as the occupants' are (4474-4505).

## The hook map for the four tracks

### R-E (engine: doubles-switch.ts, doubles-turn.ts, doubles-world.ts, doubles-eot.ts; for the wave doubles-calling.ts, doubles-presence.ts)

1. **replaceSlot** (guards.md §5.4 steps 1-7): record `{ slot, how, moveId }` in `w.switching` (the leaver stays in place until
   the action ends; Eject Button's "none already switching" and Emergency Exit's "not already switching" read it), and do the
   rest in **betweenActions**: drags first (a random drag: one world per living bench Pokémon at 1/k; `World.bench` and the
   leavers of `World.benched` are the candidates, guards.md B1), then the chosen switches in Speed order (instaswitch: both
   sides' requests at once). Per switch: the leaver's queued action out of `remaining`; its switch-out effects (Regenerator via
   mapHP with Heal Block ignored, Natural Cure, Zero to Hero for its next entry, the gas or Unnerve end: `kernel.gasEnds` as
   today until A1's Starts follow it, B13); Baton Pass's copy and Shed Tail's Substitute; the leaver to `World.benched` with
   `marginal(w, slot)` as `hp` and its factor digit freed (a point factor for the newcomer's HP); the newcomer's `MonState` (`id`,
   build for entry, `moved: true`, `vol`/`eot` from its `carried`: sleep, freeze, onceUsed); then **syncOccupants** for the world
   and the entry pipeline: hazards, then `abilityStart(kernel, w, slot, "entered")` (doubles-abilities.ts, A1) in Speed order,
   Imposter across, the gas stand-in for a newcomer under Neutralizing Gas, `REASONS.entersWithGas` for a gas newcomer,
   `notIn2v2("Commander")`, `fieldChange` for a weather or terrain newcomer with a field-settled holder in; then the foes'
   onAnySwitchIn (pending copies, a second Eject Pack chaining another switch). Remove `w.switching`. Turn fact
   `Assumes {Newcomer} comes in for {Name}.` when the replacement is the default; step fact `{Leaver} switches out; {Newcomer}
   comes in.` / `{Move}: {Newcomer} is dragged in.`
2. **hazardFails** with the pre-turn hazards: the side's own (`hazardsFrom` absent), the other side's (`hazardsFrom` = it, after
   Court Change), none (`null`: Defog, Tidy Up, Rapid Spin, Mortal Spin, G-Max Wind Rage), plus `SideState.hazards` (this
   turn's, Spikes and Toxic Spikes counted by layer). The same reading gives the entry's hazards.
3. **Identity beyond names and HP.** syncOccupants is the place to also swap `kernel.input` for a view whose `pokemon[slot]` is
   the newcomer's entry (`switchedIn: true` semantics: no action, `lastMove: null`, `contexts: {}`, `moves` from the bench), so
   the frozen modules' `kernel.input.pokemon[slot]` reads (Payback, Bolt Beak, Encore's last move, Instruct, Imprison, Pursuit,
   Sleep Talk…) see it; caches keyed by the input object (`readersOf`, `settleOf`, `maxGuardAction`) then miss or must key on
   the original. `ctx.gas.abilities[slot]` is the starting Pokémon's real ability: outcomeOf would hand it to a newcomer under
   the gas stand-in. The memo keys (speedOf, priorityOf, moveInfo, searches) read the build, so a newcomer misses them correctly.
4. **Results:** `hpRecords` reads `marginal(world, slot)` of the occupant; for `hp[slot]` (the starting Pokémon) use the
   starting Pokémon's marginal where it is in and its `benched` marginal where it left; build `replaced` and `hpEntered` from
   the finished worlds' `benched` and `mons[slot].id`; split a slot's `HitStats` and residuals by Pokémon (`DoublesHit.id`,
   `DoublesResidual.id`); `conditionStats` and the end of turn run per world: call syncOccupants there too.
5. **End of turn and E2:** the residual's Eject Pack (`how` "residual", doubles-eot.ts:2179) and Emergency Exit / Wimp Out after
   the residual switch after the turn (`DoublesEndOfTurn.replaced`, E2's `mons[slot]` the newcomer and `benched` the leaver);
   `w.leaving` and doubles-eot.ts:296's `switchesOut` stay only for a side without a bench. `benchedOutcome` adds the bench
   state (the sleep counter as `sleepTurns`, onceUsed).
6. **doubles-calling.ts / doubles-presence.ts:** Assist from `bench[side][i].moves`, Beat Up from the bench's builds (status,
   fainted), Commander's newcomer pair, Pursuit into a switching target at 80 (`w.switching`).
7. **Asks of the integrator (frozen files, facts only; the numbers already follow `hazardsFrom`):** Tidy Up
   (doubles-abilities.ts:961), Defog (doubles-field.ts:522), G-Max Wind Rage (doubles-max.ts:339) give their "hazards removed"
   fact only for hazards landed this turn, and Court Change's `moved` (doubles-field.ts:473) reads only this turn's; with
   `input.hazards` each should count the pre-turn hazards the side holds (the hazardFails reading).

### R-U (calculator: NU's files, BenchFields.tsx, the bench state in doubles-prep.ts)

- Write `bench[side]` from the Bench rows (roster-prep.ts getRosterPanel / getTeamPanel's members not in play, in roster order;
  each `{ id, build (the shared cache's, the row's HP and status), moves (its quick moves) }`), `replacement[slot]` from the
  Replacement selects (default: no key, so the engine's default and its fact), and `hazards[side]`. The Bench replaces wave 1's
  `No Pokémon left to switch in` (doubles-inputs.ts:862, 940-941): a ticked box with an empty bench is `canSwitch[side] = false`
  (or `bench[side] = []`, the same to the engine); a non-empty bench needs no `canSwitch`.
- Names: `doublesBenchNames(pokemon, bench, runtime)` (texts) or `benchNameParts` (parts for PokemonName); the slots' names are
  unchanged by a bench.
- Issues to place: `issues.field` keys `bench.{side}`, `bench.{side}.{index}`, `hazards.{side}.{spikes|toxicSpikes|steelsurge}`;
  `issues.pokemon[slot]` field `replacement`.
- Render: `result.replaced[slot]` (the leaver line `{Name} switches out at {hp} HP.` from `left[i].hp`, the newcomer's card from
  `hpEntered[slot][id]`), `endOfTurn.hpEntered` / `replaced`, `DoublesHit.id` and `DoublesResidual.id` where a slot's rows
  are split by Pokémon. `Lands this turn` lists bench learners (IN §5.7).

### R-T (Training: app/(app)/training/**)

- `sim/bridge.ts`: `bench` from each side's non-active living party (beside `canSwitch` at 582-585, 611-613): the AI's exactly,
  the player's from the belief world (HP and status public); `carried.sleep` / `freeze` / `onceUsed` of each; `moves` from
  `moveSlots` (the AI's) and the belief sets (the player's). `hazards` from the side conditions (IGNORED_SIDE at 56 becomes
  mapped: layers from `sideConditions[id].layers`; G-Max Steelsurge has no Champions form). `replacement[slot]`: the AI's from
  `ReplacePolicy` (ai/switches.ts:131, as `sim/rollout.ts:15-41` applies it), the player's the healthiest bench Pokémon by HP
  share (rollout.ts:29, Q9). The `leak:training` diff must cover the four new input fields.
- `ai/evaluate.ts:88` `inputKey` must add `bench`, `replacement` and `hazards` (it is the cache key of engine results).
- `postFromOutcome` (evaluate.ts:192): `mons[slot].id` (the occupant) and `benched` (each leaver back on the bench with its HP
  and state); `nextClock` (101) as today (`hazardsFrom`).
- `sim/prelude.ts:136` `A replacement is needed before the moves.` goes (an entry Intimidate setting off Eject Pack is the same
  replacement); a benched landing source is `futureMove: { build }` as today.

### R-V (oracle: scripts/.cache/calc-audit/2v2/verify/**)

- `case-types.ts`: today's `bench` (248-249) is the oracle's one Snorlax per side with a status or ability, and `hazards`
  (192-196) is one layer per id that the app input does not receive. Extend them (`bench` members as CaseMons with ids,
  `replacement` by slot, hazards with layers) and pass them through `app-turn.ts caseInput` (143-173) as `bench`,
  `replacement`, `hazards`. Passing Step 1 #7's stored `hazards` cases (S1-RSP) into the input changes nothing the stubs read,
  but R-E's hazardFails and entry will read them: list them in changed-cases.ts.
- `sim-dfs.ts`: answer the mid-turn switch request (1356-1372, today `a mid-turn switch is not supported`) with the case's
  replacement (a bench index; the default the first bench Pokémon not active), the bench set up in prepare (402-414) from the
  case's members.
- `compare.ts`: compare `replaced`, `hpEntered` (both phases) and E2's `benched` and `mons[slot].id`.
- Cases: guards.md §5.4's G4-SWX-01…11, IN-BNC, IN-HZD, IN-FSL-02, T2P's Assist cases, T2E's bench landings.

## Gates (final code; exact output lines)

1. `npm run check` (`step2/logs/check.log`): eslint and tsc print nothing; ` Test Files  256 passed (256)` /
   `      Tests  7710 passed | 1 skipped (7711)` (1b: 255 / 7699: the new file's 11 tests).
2. `npm run test:battle-data:source`: ` Test Files  11 passed (11)` / `      Tests  154 passed (154)` (1b: 153: the new canSwitch
   check).
3. `golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal (2987 ms)`; against the golden from before wave 1a
   (`GOLDEN_BEFORE=…/fling/golden-before/golden-1v1.full.json.gz fling/golden-diff.ts`): `110 Fling rows changed; 0 other
   differences` (the accepted Fling rows only).
4. Stored app results: `step0a-run-app.ts` into a snapshot before any edit (`wrote 2331 cases`), then after the last edit,
   `step0a-diff-app.mjs`: `2331/2331 byte-equal (ms removed); differ: 0; missing: 0; extra: 0` (facts and E2 outcomes
   included: the whole app JSON).
5. `STATUS2_REEXPECT=1a,1b compare.ts --no-write` (`step2/logs/compare.log`): `2331/2331 cases match.` (as integration 1b).
6. Timing (`microbench-ab.ts` against the snapshot tree `step2/pre`, 10 alternating passes over the stored turns):
   `head min 5104 median 5767 | current min 4839 median 5521 | ratio min 0.948 median 0.957` (no cost measurable).

## Notes for the integrator

- With a bench given before R-E lands, every result equals the same input with `canSwitch` set from the bench (the unit test
  checks Healing Wish and U-turn): R-U and R-T can wire and test their inputs in parallel with R-E.
- `kernel.names` / `ctx.names` are now the context's own copies; `doubles-positions.ts` and `turnFacts` still read `turnNames(input)`
  (the starting Pokémon's), which is right for facts about the turn's start.
- `inputs.md` §5.7's `{Name} is already in play.` is read in the engine as a bench id of the reserved `slot:` form; the UI's own
  check (a roster entry in play) gives the same text.
