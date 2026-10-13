# Review R6-NNU-U, round 1: N (doubles-history.ts), NU (the earlier-turn controls), U1 and U2 (the calculator UI, with R-U)

Read-only review (ADDENDUM2 §8.8). Branch `calc-2v2-status-2` checked at the start and the end; no repo file changed except
this notes file. Scope: `app/lib/battle/doubles-history.ts` and its call sites (`doubles-status.ts` beforeMove / earlyBranch,
`doubles-turn.ts` carriedState, redirect, rootWorlds, turnFacts), `app/(app)/calculator/doubles-inputs.ts`,
`EarlierTurnFields.tsx`, `BenchFields.tsx`, `unmodelled-states.ts` (2v2), `doubles-prep.ts` (apply actions, `doublesSlotInput`),
`useDoublesCalculation.ts`, `useDoublesView.tsx`, `DoublesSettings.tsx`, `BattleConditions.tsx`, `doubles-format.ts`,
`DoublesCard.tsx`, `DoublesTurn.tsx`, `DoublesSummary.tsx`, `docs/champions-calculator.md`. Ground truth: pinned Showdown c23d2e94.

`$SP` = `/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad`; everything below is in
`$SP/reviews/R6-NNU-U-r1/`, run from the repo root with `npx --no-install tsx <file> [names]`:
- `run-probes.ts` + `probe-cases.ts`: oracle (`sim-dfs.ts oracle()`) vs app (`app-turn.ts`), `compare.ts compareCase` (nothing stored).
- `ui-probes.ts`: the calculator's own path (DoublesMatchup → `getDoublesTurnInput` → `calculateDoublesTurn`, and the
  controls of `earlierSlotControls` / `benchSideView`), named probes `conv2 assist snatchconv copyconv benchreaders switchdbd`.
- `apply-probes.ts`: the 2v2 apply actions (`applyDoublesIntimidate`, Trace's copy) against pinned Showdown's stages after the
  leads come in (its own Battle with Trace's `sample` forced to the Intimidate foe).
- `note-lists.ts`: the 1v1 and 2v2 "Battle states that cannot be set here" lists per game.
- `main-probe/int-opp.ts`: the same apply probe on main (`cd $SP/maintree`) to separate what is pre-existing.

## Gates read

- Stored cases of N / NU's inputs (`v3/run.ts IN-STL IN-DBD IN-ENT IN-RC IN-FO IN-PRT CQ-STL CQ-DBD CQ-ENT IN-CHG IN-LSF IN-TNT
  IN-ATR IN-STK IN-ACC IN-SFG IN-MST IN-SPT IN-CPY IN-ECV IN-RTL IN-BBD IN-SEC IN-NBL IN-FLD IN-CUD IN-FSL IN-HBK IN-TLK IN-BNC
  IN-HZD`): **119/119 agree**. Checklist-related (`CR-04 CR-06 CR-10 T2E-SI T2E-FS T2P-FC IN-CHG IN-HBK IN-MST IN-FLD SAT-`):
  **203/203**. `F2-C22 T2P-AST`: 3/3 (the engine is exact when the input carries the target's last move / the partner's moves).
- Unit files by path (`doubles-history`, `calculator-doubles-inputs`, `calculator-doubles-bench`, `calculator-doubles-ui`):
  4 files, 278 tests pass.

## Cross-family checklist (SPEC2 §9 + ADDENDUM2 §9), items that involve N, NU, U1, U2

| Item | Evidence | Result |
|---|---|---|
| Snatch steals Stockpile / Swallow (C1; NU's Stockpile control on a USUM Snatch user) | stored CR-04-usum, SAT Swallow cases; the control shows for Snatch with a Stockpile move in the turn (doubles-inputs.ts:618) | match |
| Snatch steals Conversion | R6-SNT-CONV-usum (oracle path, moves given): match; the calculator path: finding 2 | finding |
| Heal Block / Embargo 1 turn left with a Sitrus (C3, C4; NU's turns-left controls) | stored IN-HBK-01/02, IN-FLD | match |
| Mist against a mid-turn Intimidate (C10; NU's Mist toggle) | stored CR-06, IN-MST | match |
| Glaive Rush on a holder that moves first (C5; NU's Glaive Rush control) | stored CR-10a/b | match |
| A carried Fly released into Gravity (cancelled) and into Smack Down (NU's `{Move} charged last turn`) | R6-FLY-GRAV-sv, -champions, R6-FLY-SMACK-sv | match |
| The landing into a Pokémon that Protected this turn / charging Dig (NU's Lands this turn) | stored T2E-FS (in the 203) | match |
| Trace copying Intimidate beside a Defiant ally of the foe (U1's apply action) | apply-probes TRC-DEF: Showdown Gardevoir −1, Snorlax −1, Incineroar −1, Kingambit +1; the calculator after both presses the same | match |
| … with an Opportunist ally of the Trace holder | apply-probes TRC-DEF-OPP | finding 6 |
| A terrain ending at 27.7 with a Quark Drive holder (NU's Terrain ends this turn) | R6-TERR-QD2-sv (R6-TERR-QD: the harness consumes the Booster Energy before the terrain is set; still equal) | match |
| N §9: the recharge, Fake Out after the first turn, the stall roll before Protean, C23's explicit 1 | stored IN-RC, IN-FO, IN-STL (N10), IN-STL-01b | match |
| N: a carried Destiny Bond on a Dancer whose copy runs first (the copy's BeforeMove removes it) | R6-DBD-DANCER-sv and its control R6-DBD-NODANCE-sv | match |
| N: entryChanged on R's newcomer (a Lightning Rod newcomer vs a lead holder at one Speed) | R6-ENT-NEW-sv | match |
| N: a protecting move reached through a caller (Instruct, Sleep Talk) reads last turn's stall | R6-INS-PROT-STL3-sv, R6-STALK-STL3 / -NONE-sv | finding 3 |
| NU: every control's "Shown when" against the engine's readers | code read of every DoublesCarried / DoublesPokemonInput / DoublesTurnInput field against its engine readers | findings 1, 3, 7 |
| NU: the 2v2 note keeps every state 2v2 cannot set | note-lists.ts | finding 4 |
| NU: reset rules, "or while set", option lists, names never positions, unique names, summary count | code read; calculator-doubles-inputs.test.ts (98) and calculator-doubles-bench.test.ts | match, but finding 5 (Switched in keeps volatiles) |
| U1: `moves` for the readers of a Pokémon's own moves | ui-probes assist, snatchconv, copyconv; oracle R6-COPY-CONV-sv (match with moves) | finding 2 |
| U2 / R-U: the Bench's readers | ui-probes benchreaders | finding 7 |
| Docs: facts only, no instruction | the diff read; the Assist sentence is contradicted by finding 2 | finding 2 |

## Findings

1. **Conversion 2's `Last move` control is on its user; the engine reads its target's.** `doubles-inputs.ts:706` shows
   `Last move` for a Pokémon whose own action is Conversion 2, and on another Pokémon only for Disable, Encore, Instruct or
   Mirror Move (`:313`). Pinned Conversion 2 reads `target.lastMoveUsed` (`PS/data/moves.ts:2823-2828`), as the engine does
   (`doubles-typing.ts:278-286`). ui-probes `conv2` (SV and USUM): Porygon2's Conversion 2 into a slower Snorlax is "Conversion 2
   needs Snorlax's move from the last turn."; the target's controls hold no Last move; with the target's `lastMove` set (no
   control can) the turn is ready. Stored F2-C22-swsh shows the engine exact with the target's last move. The user's own
   control is read by nothing.
2. **The calculator passes `moves` only for Imprison, Conversion and Sleep Talk users (`doubles-prep.ts:178`), so Assist,
   a snatched Conversion and a Copycat-called Conversion are always not estimated in the calculator.** SPEC2 §5.2 and IN §5.4
   pass `moves` for every slot (U1's recorded deviation). Engine readers of another action's moves: Assist reads its partner's
   (`doubles-calling.ts:352-354`; pinned `PS/data/moves.ts:610-614`), Conversion the move slots of whoever uses it
   (`doubles-typing.ts:260`; pinned `PS/data/moves.ts:2805` `target.moveSlots[0]`). ui-probes: `assist` (USUM, bench set) →
   "Assist needs the moves of Liepard's party." (ready with the partner's quick moves); `snatchconv` (USUM) → "Conversion needs
   Absol's first move."; `copyconv` (SV) → "Conversion needs Azumarill's first move." (ready with them). Oracle with moves:
   T2P-AST-01/02-usum, R6-SNT-CONV-usum, R6-COPY-CONV-sv match. `docs/champions-calculator.md:78` says Assist is calculated with
   a Bench, which the calculator never reaches.
3. **A protecting move reached through a caller ignores last turn's stall counter, with no fact.** carriedState writes
   `vol.stall` only when the Pokémon's own action is protecting (`doubles-turn.ts:1347-1348`); the turn fact (`:4281`) and the
   `Protecting moves in a row` control (`doubles-inputs.ts:744-746`) have the same rule. Pinned: an instructed or Sleep Talk-called
   Protect runs its onPrepareHit `StallMove` (`PS/data/moves.ts:13973-13978`, `PS/data/conditions.ts:439-462`; Instruct
   `:9652-9668`). R6-INS-PROT-STL3-sv: Oranguru Instructs Snorlax, whose Protect worked last turn (stall 3), before a foe's Body
   Slam: Showdown protects 1/3 (Snorlax 147–235, average 181), the app ignores the given counter and protects always (235), no
   reason; R6-INS-PROT-NONE-sv (no input) agrees with Showdown's no-stall world but states no assumption. R6-STALK-NONE-sv: an
   asleep Snorlax (Protect, Body Slam) Sleep Talks: the app's facts have no "Assumes no protecting move was used last turn."
   while Showdown with stall 3 leaves it untouched in 1/6, not 1/2 (R6-STALK-STL3: the app's combo reason "Sleep Talk with
   Protect is not modelled in 2v2." where Showdown only rolls 1/c).
4. **The 2v2 note "Battle states that cannot be set here" dropped two states 2v2 still cannot set.** `unmodelledDoublesStates`
   (`unmodelled-states.ts:79-84`) removes "Grounding or lifting from Smack Down, Thousand Arrows, Ingrain, Roost, Magnet Rise or
   Telekinesis" and "Stats swapped or shared by …" whole; main's 2v2 showed both (the 1v1 list). No input carries a Smack Down
   or Thousand Arrows grounding or a Magnet Rise from an earlier turn, nor Power Split, Guard Split or Speed Swap's stored stats
   (DoublesCarried, carriedState): only Ingrain, USUM's Telekinesis and Power Trick / Power Shift have controls. Pinned these
   persist (`PS/data/moves.ts:10854` magnetrise duration 5; smackdown `:16955`; powersplit / guardsplit / speedswap
   `:13760, :7950, :17431` set stored stats). `note-lists.ts`. `tests/unit/calculator-doubles-inputs.test.ts:790` pins the
   omission (`not.toMatch(/…Grounding|swapped or shared…/)`).
5. **`Switched in` keeps the carried volatiles the switch would have cleared.** `switchDoublesIn` (`doubles-inputs.ts:1553-1559`)
   clears only the action-bound states and Recharging; the Destiny Bond, Minimized, Glaive Rush, Laser Focus, Tar Shot,
   Foresight, Nightmare, Octolock, Infatuated, No Retreat, Stockpile, Drowsy, Salt Cure, Syrup Bomb … checkboxes stay shown and
   passed, and `carriedIssues` checks only `mustRecharge` and `firstTurn` (`doubles-turn.ts:3832-3834`). Pinned: switching out
   clears every volatile (`sim/battle-actions.ts:117`), so a Pokémon that switched in this turn has none. ui-probes `switchdbd`:
   Gengar `Switched in` with `Destiny Bond from last turn` ticked: Weavile's KO makes Weavile faint (KO chance 1); impossible in
   Showdown. (N's notes raised it as an input gap.)
6. **The apply action's Intimidate (now also Trace's copy) leaves out the Intimidate user's ally's Opportunist / Mirror Herb
   copying a Defiant or Competitive rise.** apply-probes TRC-DEF-OPP: Gardevoir (Trace → Intimidate) + Espathra (Opportunist)
   against Incineroar + Kingambit (Defiant): Showdown Espathra +1 Atk (−1, then Opportunist copies Kingambit's +2:
   `PS/data/abilities.ts:3041` opportunist onFoeAfterBoost), the calculator −1 and a ready turn with no fact. U1 models this
   copying for Commander (`doubles-prep.ts` applyDoublesCommander) but not for the Intimidate path (`applyDoublesIntimidate`,
   `intimidate.ts` stores only the source's own Mirror Herb). The plain Intimidate button gives the same on main 4008ee8
   (`main-probe/int-opp.ts`: identical output in both trees), so this is pre-existing there and new for Trace's copy.
7. **The Bench (and so Hazards and Replacement) is not offered for an instructed U-turn, so its turn stays not estimated.**
   `benchRead` / `calledMoves` (`doubles-inputs.ts:880-922`) read Sleep Talk, Copycat and Mirror Move callers but not an
   Instruct target's last move (nor USUM's Me First copying a U-turn). ui-probes `benchreaders` (SV, Trick Room so Instruct
   comes first): Oranguru Instructs Ambipom (last move U-turn at the foe): "Ambipom switches out: the replacement is not
   known." with Bench not shown; the same roster with Ambipom's own U-turn shows the Bench. Pinned Instruct re-runs the last
   move as a new action (`PS/data/moves.ts:9652-9668`), U-turn's selfSwitch follows.

## Not findings (pre-existing on main, noted for the fixer)

- The 2v2 Intimidate apply's Flower Veil partner: apply-probes INT-FV: Showdown blocks Venusaur's drop through its partner
  Comfey's Flower Veil (`|-block|p2a: Venusaur|ability: Flower Veil|[of] p2b: Comfey`), the calculator stores −1 with the line
  "Venusaur: assumes no partner with Flower Veil." although the partner is in the matchup (`intimidate.ts` 1v1 text). Same on
  main's Intimidate button.
- Neither note lists Taunt, Encore or Disable from an earlier turn (no calculator input; Training only); the 1v1 list never had them.

## Branch

`calc-2v2-status-2` at the start and at the end; `git status` clean apart from the untracked scratch (this file is gitignored).
