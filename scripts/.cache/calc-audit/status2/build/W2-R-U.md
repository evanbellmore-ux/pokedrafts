# Wave 2, Track R-U: the calculator's Bench, Replacement and Hazards (status2, ADDENDUM2 §5.3, IN §5.7)

The user's Q1 = R (USER-DECISIONS.md): switch-outs with a replacement in the 2v2 calculator. This track writes the
calculator's half: a Bench per side from the roster its Pokémon come from, a Replacement per Pokémon that can switch out
by its player's choice, the Hazards, `Lands this turn` over the bench, their mapping into Step 2's contract
(`DoublesTurnInput.bench`, `replacement`, `hazards`), the reset rules, and the switches on the cards and in the turn panel
(`DoublesTurnResult.replaced`, `hpEntered`, `DoublesEndOfTurn.replaced` / `hpEntered`, `DoublesHit.id`, `DoublesResidual.id`).

## Status

- **Branch:** `calc-2v2-status-2`, checked at the start and again before the report. Nothing committed, pushed or switched.
  No frozen file, no other track's file, `node_modules`, `.claude/`, CastMirror or RaidCard file touched. No `next build`,
  nothing against Supabase, no credentials. The Browser pane was used only on `127.0.0.1:4347` (static pages I served; server
  stopped, tab closed, viewport reset).
- **Line endings:** every edited file keeps its own (CRLF: `EarlierTurnFields.tsx`, `doubles-prep.ts`, `useDoublesView.tsx`,
  `useDoublesCalculation.ts`, `doubles-format.ts`, `DoublesCard.tsx`, `DoublesTurn.tsx`, `DoublesSummary.tsx`,
  `docs/champions-calculator.md`; LF: `doubles-inputs.ts`); the new `BenchFields.tsx` and the new test are LF (autocrlf
  normalises them).
- **Record:** `w2-ru/w2-ru.diff` (the whole change against `w2-ru/pre`, the snapshot taken first), `w2-ru/probe.ts` (the
  engine probe), `w2-ru/engine/` + `w2-ru/engine.config.mts` (Step 2's engine tree, rebuilt from `step2/pre` + `step2.diff`,
  to run my engine tests while R-E's files were mid-edit), `w2-ru/render-ru.test.tsx` + `render.config.mts` (the static
  pages of the layout check; output in the scratchpad's `ru/render`).

## Files

| File | Change |
|---|---|
| `app/(app)/calculator/doubles-inputs.ts` | `DoublesBenchEntry`, `DoublesBench`, `NO_BENCH`, `benchOf`, `benchBuild`, `benchNamesOf`; `EARLIER_TABLES` gains `chosenSwitch`, `switchItems`, `switchAbilities`, `drag`, `benchReaders`, `onceEntry`, `hazards`; the readers `choosesSwitch` / `benchRead`; `benchSideView` (Bench rows), `hazardControls`, the Replacement select and the bench learners of `Lands this turn` in `earlierSlotControls`; the changes `addBenchEntry`, `removeBenchEntry`, `setBenchEntry`, `setBenchPick`, `setBenchHazards`, `mapBenchEntries` (all through `tidyBench`); `withBench` (the input mapping); `No Pokémon left to switch in` only while the side's bench is empty; hazards in `earlierTurnToggles`; `clearSlotEarlier` drops the slot's pick; `DoublesSlotHistory.futureFrom`; `EarlierNumber.max`; issue key `replacement` |
| `app/(app)/calculator/BenchFields.tsx` (new) | one side's Bench (Add to bench, rows, Remove) and Hazards |
| `app/(app)/calculator/EarlierTurnFields.tsx` | `EarlierTurnState.rosters` / `update`; renders `BenchFields` after the side's controls, before its Pokémon; exports `EarlierCheckbox`, `EarlierInput`, `split`, `controlId`, `SIDE_NAMES`; numbers take `max` |
| `app/(app)/calculator/doubles-prep.ts` | `DoublesMatchup.bench` (`NO_BENCH` in `createDoubles`); `getDoublesTurnInput` adds `withBench`; `addDoublesBench`; `selectDoublesRoster` takes a bench Pokémon off the bench; `reconcileDoublesRosters` removes / renames bench Pokémon; `followShared` follows session edits of a bench Pokémon's roster entry |
| `app/(app)/calculator/useDoublesCalculation.ts` | the memoised input adds `withBench` (dep `bench`) |
| `app/(app)/calculator/useDoublesView.tsx` | `rosters` and `update` in the context; `benchNames = turnBenchNames(input)`; each card's `switches`; `benchNames` to the summary |
| `app/(app)/calculator/doubles-format.ts` | `idName`, `namesFor`, `SlotSwitches`, `slotSwitches`, `leaverText`, `recordOf`; `turnSummary(…, benchNames)` reads the switches |
| `app/(app)/calculator/DoublesCard.tsx` | `DoublesCardView.switches`; `SwitchesBlock` (leaver lines, each newcomer's HP block) |
| `app/(app)/calculator/DoublesTurn.tsx` | hits and residuals named by `id` (with their own certain-KO records and distinct keys); `Switches after the turn` in the End of turn block; the live summary with `benchNames` |
| `app/(app)/calculator/DoublesSummary.tsx` | `benchNames` prop to the turn; no switches while the turn is not shown |
| `docs/champions-calculator.md` | 2v2: the switching sentence (without a Bench), a new **Bench, Replacement and Hazards** bullet |
| `tests/unit/calculator-doubles-bench.test.ts` (new) | 30 tests (below) |

Unchanged in my set: `BattleConditions.tsx` (the side fieldset renders `EarlierTurnFields`, which now holds the Bench),
`calculator.module.css` (no new widths), `unmodelled-states.ts` (its 2v2 note lists nothing the Bench now sets),
`DoublesSettings.tsx` (the integrator's: the hazards count through `earlierTurnToggles`), the existing tests.

## What is built (each behaviour has a test)

**State.** `DoublesMatchup.bench: DoublesBench = { own, opponent, picks, hazards }`, `NO_BENCH` until a control sets one, so
every turn without them is today's input object (`withBench` returns the same input; tested `toBe`). A bench entry is
`{ key (its roster source key = the input id), source, base (prepared build), moves (quick moves), hp?, status?, carried? }`;
`benchBuild` is the base with the row's HP and status.

**Bench** (`BenchFields`, `data-doubles-bench={side}`). Shown when the side's roster panel has an entry with a source that
is not in play on that side and not benched, and one of the side's Pokémon can come in this turn (`benchRead`): its Pokémon's
U-turn, Volt Switch, Flip Turn, Parting Shot, Teleport (not USUM), Baton Pass, Shed Tail, Chilly Reception (not as a Max Move,
nor a damaging one as a Z-Move), an Eject Button or Eject Pack, Emergency Exit or Wimp Out, Healing Wish, Lunar Dance, Assist,
Beat Up; any Pokémon's Roar, Whirlwind, Dragon Tail or Circle Throw aimed at one of the side's Pokémon (a foe's with no target
chosen); a foe's Red Card. Or while it holds a Pokémon. `Add to bench` (select, `—` then the entries by name, roster order)
adds through `addDoublesBench`: the entry is prepared exactly as a roster pick is (`selectRosterPokemon` on a stand-in of the
side's role: the shared cache's session build, else the paste's set or the default build with its roster ability and Hidden
Power IVs), the cache is not written, the entry goes in at its roster position, at most four (`A bench holds at most four
Pokémon.` while more are left), never twice, never one in play on its side; adding ends the side's `No Pokémon left to switch
in`. Each row: its name, `HP` (number 1..max, default the prepared build's), `Status` (the build editor's `STATUSES`), then
while they apply `Turns lost to sleep` (0..sleepTurnsMax) and `Rest sleep` (Asleep), `Turns lost to freeze` (Champions,
Frozen, 0..2), `{Ability} used` (SV and Champions: Intrepid Sword, Dauntless Shield, Supersweet Syrup), and `Remove {Name}`.
`boundBenchEntry` keeps them consistent (a status change drops the counters, HP is clamped). The engine's `bench.{side}.{i}`
issue shows on that row's HP control (`aria-invalid`), `bench.{side}` above the rows.

**Replacement** (`data-doubles-replacement={slot}`, in the Pokémon's group): for a Pokémon that `choosesSwitch` while its
side's bench holds a Pokémon, or while set: `Next on the bench` (no key: the engine's default, the first bench Pokémon not in
play then, with its turn fact `Assumes {Newcomer} comes in for {Name}.`) and each bench Pokémon by its bench name. It is a
choice, not a toggle.

**Hazards** (`data-doubles-hazards={side}`; `data-doubles-hazard-{stealth-rock|spikes|toxic-spikes|sticky-web|steelsurge}=
{side}`): Stealth Rock, Spikes 0–3, Toxic Spikes 0–2, Sticky Web, G-Max Steelsurge (SwSh), each where the game has the
move; shown for a side whose bench holds a Pokémon and one of whose Pokémon can come in, or while set; 0 / unticked removes;
each one set counts among the summary's toggles; the engine's `hazards.{side}.{flag}` issues show at their control.

**Lands this turn over the bench.** Each bench Pokémon of either side that learns Future Sight or Doom Desire is a choice
(`Future Sight from {BenchName}`); it writes `carried.futureMove = { move, build: benchBuild(entry) }` and
`history.futureFrom = key`; `tidyBench` keeps the build in step with the row and drops the landing when that Pokémon leaves
the bench; None or a slot source clears `futureFrom`.

**Mapping** (`withBench`): `bench[side]` only for a side that holds a Pokémon (`{ id, build, carried?, moves? }`, moves
deduplicated, absent when it has none), `replacement` only for picks on their side's bench, `hazards` for sides with any.
`canSwitch` is never written for a side with a bench (Step 2's `sideCanSwitch` reads the bench first).

**Names.** The UI names bench Pokémon with `turnBenchNames(input)` (the engine's own names: after the four slots, which keep
theirs), in labels (`HP: Snorlax (yours, 2)`), options, the card and the turn.

**Reset rules.** Another Pokémon in a slot drops that slot's pick (`clearSlotEarlier`); a bench Pokémon put into play leaves
the bench (`selectDoublesRoster`, notice `… {Name} is no longer on the bench.`); a roster, team-source or opponent change
removes the bench Pokémon no longer offered and renames renamed ones (`reconcileDoublesRosters` → `mapBenchEntries`), with
their picks and a landing from them; a session edit of a bench Pokémon's roster entry becomes its base (`followShared`, row
HP and status kept); 2v2 Reset, a game change and an account change give `NO_BENCH`.

**Results.** `slotSwitches(turn, slot, names, benchNames)` merges the moves' `replaced` and the end of turn's; each newcomer's
HP is `endOfTurn.hpEntered` when the end of turn is estimated, else `hpEntered`. The card (`data-doubles-switches`) shows
`{Leaver} switches out at {min–max} HP.` (with its share below 1), then per newcomer `{Name} comes in.` (share), its HP label
(`After the turn · Average estimate`), `{shown} / {max} HP`, a meter named `{Name} projected HP in place of {Card's Pokémon}`,
its conditions, `Turn start: {start} / {max}` and its KO chance. The turn panel names a hit's and a residual's newcomer
(`DoublesHit.id`, `DoublesResidual.id`; the certain KO from the newcomer's own record), lists `Switches after the turn`
(the end of turn's `replaced`, which no step owns), and the live summary adds the leaver line, `{Name} comes in.` and the
newcomer's `HP remaining`.

## Tests and gates (final code, this tree)

- `tests/unit/calculator-doubles-bench.test.ts` (30): the Bench's show rule (roster, readers, while set, in play, a duplicate
  name) and every reader kind over the four games (> 60 cases, Teleport in USUM, Max Move, damaging Z-Move, Z-Parting Shot);
  the tables equal the engine's `SWITCH_MOVES` and `DRAG_MOVES` + Roar / Whirlwind; `No Pokémon left to switch in` replaced;
  rows (HP bounds and default, statuses, sleep / Rest / freeze / once-a-battle per game, a status change dropping counters);
  the engine's row issue on the row (`aria-invalid`); Replacement (options and names, default, pick, while set, the pick going
  with its Pokémon and with another Pokémon in the slot); Hazards per game, show rule, layers, removal, toggles; Lands this
  turn over the bench (names, build form, following the row, removal, None) with the engine accepting it; the mapping (same
  input object without a bench, ids in roster order, moves, carried, picks only on the bench, `canSwitch` untouched, names);
  the cap of four, no duplicate, nothing in play; **every value each control writes passes the engine's validation in every
  game** (`calculateDoublesTurn` gives no issues; 14–15 values per game); the state rules through `doubles-prep` with league
  rosters (prepared as a roster pick, session edit restored, cache not written, roster order, cap, the pick into play with its
  notice, a roster change, a session edit followed with the row kept, Reset / game / account); the page (unique ids, `for`,
  references, labels; `: your side` / `: the opponent's side` / `: {Name}` suffixes; `Remove {Name}`; no position words); 375 px
  structure (checkbox labels `min-w-0 wrap-anywhere` in two columns, every select and number in a `styles.fields` grid, no
  fixed widths, every paragraph `wrap-anywhere`); Add to bench only with rosters and `update`; Remove; the switch helpers;
  the summary with a hand-built R turn (card lines, newcomer HP and meter, the turn's names by id, Switches after the turn,
  the live summary, unique meter names, no position words); the live summary without switches unchanged.
- `npx vitest run --config vitest.unit.config.ts tests/unit/calculator-doubles-*.test.ts`: `Test Files 9 passed (9)`,
  `Tests 290 passed (290)` (260 before: my 30).
- All calculator suites (`tests/unit/calculator-*.test.ts` and `doubles-names`): `Test Files 94 passed (94)`,
  `Tests 2152 passed (2152)`. The same set on Step 2's engine tree (`w2-ru/engine.config.mts`, while R-E's `exitWorlds` was
  not yet written): 95 files / 2160 tests passed.
- `golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal (4790 ms)`.
- `npx tsc --noEmit`: clean (an earlier run showed only R-E's in-progress `doubles-turn.ts` errors). `npx eslint` on my 11
  files: no output.
- `npm run test:battle-data:source`: 153 / 154; the one failure is `status2-hooks.test.ts`'s hook map at R-E's
  `doubles-switch.ts switchOut` (R-E's work in progress; STEP2 says R-E's walk changes need those rows updated).
- Browser pane, static pages (`ru-sv`: both benches, every row control, hazards, a pick, Eject Button, Roar, Red Card, a
  random drag of two newcomers and an end-of-turn switch on the cards; `ru-ch-full`: a full bench with the cap fact and the
  freeze counter; `ru-swsh`: Steelsurge): at 375 px and 1280 px `scrollWidth === clientWidth` (375 / 375 emulated, 360 / 360
  in a 375 frame, 1265 / 1265 at 1280) and no element past the edge.
- Facts-only review of every new text: `Bench`, `Add to bench`, `—`, `A bench holds at most four Pokémon.`, `Remove {Name}`,
  `HP`, `Status`, `Turns lost to sleep`, `Rest sleep`, `Turns lost to freeze`, `{Ability} used`, `Hazards`, the hazard moves'
  names, `Replacement`, `Next on the bench`, `{Move} from {Name}`, `{Name} switches out at {hp} HP.`, `{Name} comes in.`,
  `Turn start: …`, `Switches after the turn`, `{Name} is no longer on the bench.`: labels and facts, no instruction, no
  position word (the tests run `positionalIn`).

## Deviations (each for a reason)

1. **Replacement's default is an option `Next on the bench`** (no key), not the first bench Pokémon preselected by name. The
   engine's default is "the first bench Pokémon not in play then", which depends on which switcher goes first (Speed,
   priority, outcomes); a name preselected by the UI could contradict the turn. The turn fact names who came in.
2. **Bench rows also hold the bench state Step 2's contract carries** (`Turns lost to sleep`, `Rest sleep`, `Turns lost to
   freeze`, `{Ability} used`), beyond IN §5.7's name / HP / Status / Remove, each only where it applies: otherwise a sleeping
   or Intrepid Sword newcomer could only take the default assumption.
3. **`{Name} is already in play.` never comes from the UI:** an entry in play is not offered, and a bench Pokémon put into
   play leaves the bench (with a notice). The engine's text still shows on a row if an input carries it.
4. **The Bench reader adds Assist and Beat Up** (R-E reads the bench for both) to IN §5.7's list, and leaves out what cannot
   switch (Teleport in USUM, a Max Move, a damaging Z-Move).
5. **`No Pokémon left to switch in` stays among the side's checkboxes** while the side's bench is empty (today's place, always
   shown then) and goes once the bench holds a Pokémon; adding one unticks it.
6. **The leaver line gives the HP range** (`switches out at 98–130 HP.`) with its share below 1, as the cards' bands do.
7. **The turn panel lists only the end of turn's switches** (`Switches after the turn`); a moves-phase switch is stated by
   its step's facts (R-E's `{Leaver} switches out; {Newcomer} comes in.` / `{Move}: {Newcomer} is dragged in.`) and on the card.

## For the other tracks

- **R-E:** (1) the card labels a newcomer's `hpEntered[slot][id].start` as `Turn start` (its HP on the bench as the turn
  starts): please keep `start` that, not its HP after the entry hazards. (2) The turn panel relies on the step facts above for
  moves-phase switches. (3) `DoublesStep` has no `id`: a newcomer's own step (a Dancer copy by a newcomer) would be headed with
  the slot's starting Pokémon's name; `DoublesResidual.other` has no id either (a newcomer seeder). (4) `turnBenchNames(input)`
  names bench Pokémon after `input.pokemon`, which is null for a fainted slot, so a bench Pokémon of a fainted slot's species
  has the same text as that slot; the UI uses the engine's names so the two agree.
- **R-V:** the calculator's input is `bench[side] = [{ id: roster source key, build, carried?, moves? }]`, `replacement` only
  for ids on the side's bench, `hazards` per side; a side with an empty bench is never passed (its `canSwitch` stays today's,
  `false` with `No Pokémon left to switch in`).
- **Integration 2:** check the docs' quoted texts (`Assumes Corviknight comes in for Garchomp.`, the step facts) against R-E's
  strings; the live 375 px / 1280 px check of the signed-in page's Add to bench (here: static pages and unit tests only).
