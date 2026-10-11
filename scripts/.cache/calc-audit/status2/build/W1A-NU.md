# Wave 1a, Track NU: the 2v2 calculator's earlier-turn controls (ADDENDUM2 §5.2)

Branch `calc-2v2-status-2` checked before and after. Only NU's files changed: `app/(app)/calculator/doubles-inputs.ts`,
`app/(app)/calculator/EarlierTurnFields.tsx`, `app/lib/battle/unmodelled-states.ts` (a new 2v2 export; the 1v1 export
unchanged), `tests/unit/calculator-doubles-inputs.test.ts` (new). Scratch: `w1a-nu-probe*.ts`, `w1a-nu-tw.mjs` here.
Nothing committed, pushed or switched; no frozen file, no engine file, no `node_modules`, no `.claude/` touched.

## What is built

**doubles-inputs.ts** (pure, no engine import: the page's first bundle gains only small tables):
- `earlierSlotControls(doubles, slot, issues?)`: every per-Pokémon checkbox and select of ADDENDUM2 §5.2 (and IN §5.2's
  rules where the table defers to them), in the table's order, each shown when the turn reads it **or while set**; none
  for a fainted Pokémon. Each control: `key`, `label`, `attr` / `attrValue` (the data attribute and its slot), its
  `issue` text, whether it counts as a `toggle`, and `set(value)` → an `EarlierChange` (`(doubles) => doubles`, read
  against the latest state).
- `earlierSideControls(doubles, side)`: Safeguard, Mist, Lucky Chant (where the game has the move), the four G-Max side
  conditions (SwSh, `data-doubles-side-gmax={side}` with `value` the move id), No Pokémon left to switch in (always), Lost a
  Pokémon last turn (a Retaliate user on the side).
- `earlierFieldControls(doubles, "weather" | "shared")`: Weather / Terrain ends this turn; Mud Sport, Water Sport (USUM),
  Gravity / Magic Room ends this turn (while on), Entered first, Last move in the battle, Echoed Voice turns in a row.
- Defaults as USER-DECISIONS / ADDENDUM2: Last move and Item used earlier **Unknown** (Q3, Q4); Entered first, Last move
  in the battle, Echoed Voice, Lost a Pokémon, Fury Cutter, Rollout, PP left Unknown; Protecting moves in a row, Ally
  Switch in a row, Uproar turns left, Bide stored `—` (absent: the turn's fact); Cud Chew None (C29); ambient ones None.
- Mapping: `withSlotHistory` (lastMove, lastMoveTarget, lastItem, firstTurn false, earlierThisTurn, switchedIn with
  action No move; types / addedType on a **copy** of the build only, only for the species they were given for, not under a
  non-Stellar Tera type, addedType not when Terastallized, never on Arceus / Silvally: IN-C6) and `withTurnEarlier`
  (weatherTurns 1 but for the strong three, fieldTurns 1 only while the effect is up, entryOrder ranks of present slots,
  battleLastMove, echoedVoice ≤ 5, faintedLastTurn, canSwitch false). Both return their input object when nothing is set,
  so every turn with nothing set is byte-for-byte today's input.
- Writes: stall / allySwitch `—` → absent, n → 3^n (0 → 1, C23); Stockpile layers only (C17); Lands this turn
  `{ move, source }`; Trapped by `{ source, bindingBand (the source's item), move (its one quick trapping move) }`; Wish
  lands floor(maxHP / 2) of the chosen Pokémon (history `wishFrom` keeps it in step); Battle Bond adds / removes only
  `battlebond` in `onceUsed`; Foresight and Miracle Eye exclusive; Heal Block (SV, Champions) 1.
- `DoublesSlotHistory` gains `typesOf`, `firstTurn`, `earlierThisTurn`, `switchedIn`, `wishFrom`.
- Reset rules: `clearSlotEarlier` (another Pokémon: carried and history clear, the entry order drops it — all of it when it
  was the first — and Attract, Octolock, Lock-On, a partial trap, Syrup Bomb, a Future Sight user and a Bide source naming
  it end; Leech Seed and Wish are positions and stay), `reconcileEarlier` (types per species, Tera, Arceus; a trap's
  Binding Band, a Wish's HP), `afterDoublesAction` (charging, stall, allySwitch, uproar, bide, furyCutter, rollout, ppLeft,
  mustRecharge, firstTurn unless the new action reads them; Switched in ends), `afterDoublesField` (each `…Ends` with its
  effect off), `switchDoublesIn` / `setDoublesSwitchedIn` (No move, action-bound state and Recharging cleared),
  `reconcileCarried` gains the bounds of IN §5.4 (Nightmare, Berry lock, Cud Chew, Laser Focus, Heal Block / Embargo /
  Telekinesis per game, Stockpile 1–3 with counts −layers..0, stages −6..6).
- `earlierTurnToggles(doubles)`: the summary count of everything new (ADDENDUM2 §5.2 / IN §5.5; history answers do not
  count); `earlierIssueTexts(issues, name)`: the engine's issue fields to control keys; `applyDoublesEarlier(state, change)`.
- `EARLIER_TABLES`: the move tables, checked against the engine's sets by the test.

**EarlierTurnFields.tsx**: `EarlierTurnContext` / `useEarlierTurn` (`{ doubles, issues, apply }`); the default export now
renders, per side fieldset, the side's controls (labels read `: your side` / `: the opponent's side`) and then each
Pokémon's group with today's controls followed by its new checkboxes (2-column grid) and selects / numbers (compact
`styles.fields` grid), every label with the sr-only `: {Name}`; `EarlierFieldFields({ id, part })` for the field. Without
the context only today's controls render (a group with nothing new is today's markup exactly: tested).

**unmodelled-states.ts**: `unmodelledDoublesStates(runtime)` (IN §5.6 with C21, C28): the ability line (Gastro Acid and
Core Enforcer suppress; Worry Seed … Doodle replace; "on an earlier turn"), A Sky Drop from an earlier turn (USUM), A
Healing Wish or Lunar Dance waiting for the next Pokémon to come in, Torment or Throat Chop from an earlier turn, A move
locked in by Outrage, Petal Dance, Thrash or Raging Fury; each with the 1v1 note's entry rules (names present in the game).

## Tests (`tests/unit/calculator-doubles-inputs.test.ts`, 98 tests, green)

Table-driven "Shown when" over the four runtimes for all 66 control keys (shown in the spec's games, absent elsewhere,
absent without the reader); Alluring Voice / Burning Jealousy reach; no charge control for a Z-Move, Max Move or Sky Drop;
Max Guard and Endure read the stall counter; Protean Unknown, Tera, Arceus; "or while set"; fainted shows none; labels and
options free of positions (`positionalIn`) in every game, slot options by `doublesNames`; option lists (Last move, Item
used earlier Berries first / Berries only, Lands this turn); the mapping of each control into `getDoublesTurnInput`
(IN-C6: the Combatant's build unchanged); the reset rules; the summary count; unique ids, `for` / aria references and
accessible names over the whole rendered set in every game; the 375 px structure (each checkbox label `min-w-0
wrap-anywhere` in a 2-column grid, every select inside a `styles.fields` grid, no fixed widths); today's markup kept; the
issue shown at its control; the tables equal to the engine's; **every value each control writes passes the engine's
`validate` in every game** (`calculateDoublesTurn` gives no `issues`); the 2v2 note per game.

Other suites run by path: calculator-doubles-ui, -carried-input, -shell, -prep, -fainted, -renders, -shared, naming-guard:
153 pass; the whole `tests/unit/calculator-*` set too (see the report).

375 px in a real browser: the built-in browser pane cannot open a local file, and starting a dev server needs
`.claude/launch.json` (left alone), so the live 375 px check is integration 1a's (ADDENDUM2 §8.4 step 4). A rendered
busiest-group page with the compiled Tailwind is in the scratchpad (`nu-375.html`, `globals.out.css`) for that check.

## Deviations (each a fact-preserving choice)

- `Rollout hits so far` reads `Ice Ball hits so far` when the action is Ice Ball (the move's own name).
- Power Trick and Power Shift are two checkboxes (`data-doubles-power-trick`, `data-doubles-power-shift`), each shown when
  the Pokémon learns that move (no Champions Pokémon learns Power Shift in the pinned catalog).
- "A Pokémon of the turn learns X" for a move that cannot target its user (Tar Shot, Yawn, Soak, Magic Powder, Forest's
  Curse, Trick-or-Treat, Heal Block, Embargo, Telekinesis, Ghost Curse, Leech Seed, the traps, Syrup Bomb) reads another
  Pokémon of the turn; Perish Song counts its user too.
- Leech Seed, Trapped by and Syrup Bomb from list the foes, then the ally (C32).
- G-Max Replenish shows Item used earlier on the user's own side only (it restores its side's Berries).
- Gravity / Magic Room ends this turn sit after the Shared field effects toggles (one `EarlierFieldFields` call), not
  inside each toggle's cell.
- Entered first is one select over every candidate (Follow Me / Rage Powder pairs, two Lightning Rod, Storm Drain or
  Dancer holders, a Download holder with each Dauntless Shield foe: T2P §4.3); the choice ranks 0, the others 1.
- Type controls are hidden (and not passed) under a non-Stellar Tera type; the value is kept for when Tera is off.
- `clearSlotEarlier` also ends the states that name the replaced Pokémon as their source (they need it in battle).

## Wiring the other tracks' files need (exact; see the final report's needsFromOthers)

1. `useDoublesView.tsx` (U1): provide the context around `DoublesSettings`.
2. `BattleConditions.tsx` (U1): place `EarlierFieldFields` twice, use `unmodelledDoublesStates` in 2v2, add the count to
   `describeDoublesConditions`.
3. `DoublesSettings.tsx` (integrator): pass `earlierTurnToggles`.
4. `doubles-prep.ts` (U1): the four reset calls; `moves` for every slot.
5. `DoublesCard.tsx` (U1): the `Switched in` option after `No move`.
6. `useDoublesCalculation.ts` (integrator): pass each slot's history and wrap in `withTurnEarlier`.
