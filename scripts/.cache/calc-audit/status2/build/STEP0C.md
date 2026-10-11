# Step 0c: the earlier-turn UI move (status2)

ADDENDUM2 §8.1 row 0c = IN §10 "Step 0c": today's state-from-earlier-turns code moved verbatim into Track NU's two new
files, with the inert `history` and `turnEarlier` state and its three call sites. Behaviour unchanged. Branch
`calc-2v2-status-2` checked before and after; nothing committed, pushed or switched; no frozen file touched; `.claude/`,
`node_modules`, CastMirror and RaidCard files untouched; no `next build`, nothing against Supabase.

## What moved

| From | To | Items (verbatim) |
|---|---|---|
| `app/(app)/calculator/doubles-prep.ts` | `app/(app)/calculator/doubles-inputs.ts` (new) | `CarriedOptions`, `NO_CARRIED_OPTIONS`, `sleepTurnsMax`, `START_CURES`, `carriedAbilityOn`, `carriedOptions`, `substituteMax`, `reconcileCarried`, `CARRIED_ISSUE_FIELDS`, `carriedIssueTexts`; with them `clamp` (reconcileCarried's private helper), `NO_CARRIED` (reconcileCarried returns it; now exported, doubles-prep imports it) and `isFaintedBuild` (carriedAbilityOn calls it; see Deviations) |
| `app/(app)/calculator/BattleConditions.tsx` | `app/(app)/calculator/EarlierTurnFields.tsx` (new) | `CarriedFields`, `Whose`, `carriedToggles` (now exported); with them `range` (CarriedFields' helper), and the `CarriedControl` and `ChargeToggle` types (see Deviations) |

Checked mechanically: `step0c` cut scripts (scratchpad) removed each block from its old file only after finding it,
line for line, in the new file (CRLF-normalised; the one difference is the doc reference `(BattleConditions CarriedControl)`
→ `(EarlierTurnFields CarriedControl)`, and `export` added to `Whose` / `CarriedFields`). 133 lines left doubles-prep.ts and
106 BattleConditions.tsx.

Every old import path keeps working: doubles-prep.ts re-exports `carriedAbilityOn`, `carriedIssueTexts`, `carriedOptions`,
`isFaintedBuild`, `NO_CARRIED_OPTIONS`, `reconcileCarried`, `sleepTurnsMax`, `type CarriedOptions`; BattleConditions.tsx
re-exports `type CarriedControl`, `type ChargeToggle`. No test, `useDoublesView.tsx`, `useDoublesCalculation.ts` or
`DoublesSettings.tsx` import changed.

Module graph: doubles-inputs.ts imports only `import type { DoublesMatchup } from "./doubles-prep"` (type-only, erased), so
there is no runtime cycle; EarlierTurnFields.tsx imports nothing from BattleConditions.tsx (it keeps its own copy of the
checkbox class text, identical to BattleConditions').

## The inert state (IN §5.4; ADDENDUM2 §5.2's `lastMoveTarget` added)

`doubles-inputs.ts`:

```ts
export type DoublesSlotHistory = { lastMove?: string | null; lastMoveTarget?: DoublesSlotId | null; lastItem?: string | null; types?: string[]; addedType?: "Grass" | "Ghost" };
export const NO_HISTORY: DoublesSlotHistory = {};
export type DoublesTurnEarlier = { weatherEnds?: true; terrainEnds?: true; gravityEnds?: true; magicRoomEnds?: true;
  entered?: Partial<Record<DoublesSlotId, number>>; battleLastMove?: string | null; echoedVoice?: number;
  faintedLastTurn?: Partial<Record<DoublesSideId, boolean>>; noneLeft?: Partial<Record<DoublesSideId, true>> };
export const NO_TURN_EARLIER: DoublesTurnEarlier = {};
```

`DoublesMatchup` gains `history: Record<DoublesSlotId, DoublesSlotHistory>` (each `NO_HISTORY`) and
`turnEarlier: DoublesTurnEarlier` (`NO_TURN_EARLIER`), set in `createDoubles` (so `freshDoubles`, Reset, a game or account
change start them empty). Nothing writes either yet.

## The three call sites

1. **`doublesSlotInput`** (doubles-prep.ts) gains an optional fifth parameter `history: DoublesSlotHistory = NO_HISTORY` and
   returns `withSlotHistory(entry, history)`; `slotInputs` passes `doubles.history[slot]`. `withSlotHistory`
   (doubles-inputs.ts) is NU's place to put `lastMove` / `lastItem` / `lastMoveTarget` on the slot input and `types` /
   `addedType` on a build copy (IN-C6); Step 0c: returns `entry`.
2. **`getDoublesTurnInput`** returns `withTurnEarlier(doublesTurnInput(…), doubles.turnEarlier)`. `withTurnEarlier` is NU's
   place for `weatherTurns`, `fieldTurns`, `entryOrder`, `battleLastMove`, `echoedVoice`, `faintedLastTurn`, `canSwitch`;
   Step 0c: returns `input`.
3. **BattleConditions' render**: inside each side fieldset, after the side's toggles, one
   `<EarlierTurnFields id={`${prefix}-carried`} side={side} carried={carried} charge={charge} />` (the default export of
   EarlierTurnFields.tsx) in place of the inline `carried.filter(side).map(<CarriedFields …/>)`; it renders the same groups
   with the same ids (`{prefix}-carried-{slot}`), so NU can add per-side and per-Pokémon controls in its own file.
   `describeDoublesConditions` calls `carriedToggles` from EarlierTurnFields.tsx.

## Gates (all run on this tree, 2026-10-11)

- `npx tsc --noEmit`: exit 0.
- `npx eslint "app/(app)/calculator/"`: exit 0, no warnings.
- UI tests unchanged: all 94 `tests/unit/calculator-*.test.ts` files plus `battle-native-controls`, `naming-guard`,
  `champions-calculator`: 2047 tests pass (baseline before the move: the 12 doubles/UI files, 291 tests, also green).
  `calculator-doubles-carried-input.test.ts` passes unchanged. Whole `unit` project: 173 files, 5172 tests pass.
- Markup byte-equal: `step0c-markup.test.tsx` (`npx vitest run --config
  scripts/.cache/calc-audit/status2/build/step0c-markup.config.mts`) renders the pre-move BattleConditions (HEAD's file plus
  Step 0's two hunks, rebuilt by `step0c-make-old.cjs` into `step0c-old/BattleConditions.tsx`) and the new one with
  `renderToStaticMarkup` over 6 scenarios × 4 games (1v1 Singles, 1v1 Doubles with legends, 2v2 nothing set, 2v2 with
  sleep / Rest / freeze / toxic / confusion / Substitute and issue texts and a fainted Pokémon, Charge toggles without
  controls, no carried): 24 / 24 identical strings, and `describeDoublesConditions` equal.
- `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check`: 254 cases byte-equal.
- Stored oracle cases: not re-run; the oracle harness (`app-turn.ts`, `gen-tests.ts`, `sim-dfs.ts`) imports no calculator
  file and no engine file changed, so every stored case's app result is untouched (the generated
  `doubles-turn-showdown.test.ts` is inside the 173 passing files).

## Deviations

- `isFaintedBuild` moved with `carriedAbilityOn` (which calls it) so doubles-inputs.ts needs no runtime import from
  doubles-prep.ts (a runtime import cycle otherwise); re-exported from doubles-prep.ts, body unchanged. `NO_CARRIED` and
  `clamp` moved for the same reason (reconcileCarried uses both; `NO_CARRIED` stays one shared object).
- `CarriedControl` and `ChargeToggle` (the props of `CarriedFields`) moved into EarlierTurnFields.tsx and are re-exported
  from BattleConditions.tsx: NU extends `CarriedControl` with its controls' values and handlers in wave 1a, when
  BattleConditions.tsx is U1's; every importer still reads them from BattleConditions.
- The render call site is a small wrapper component (`EarlierTurnFields`, the file's default export), not the bare
  `CarriedFields` call, so the per-side render point is in NU's file.

## For the next tracks (NU, U1)

- `useDoublesCalculation.ts` builds the page's turn input on its own (four `doublesSlotInput` calls and `doublesTurnInput`,
  memoised per field) and does not see `history` or `turnEarlier`. Inert today (identical inputs), but once NU makes
  `withSlotHistory` / `withTurnEarlier` act, that file must pass `doubles.history[slot]` as the fifth argument (with the
  four histories in the memo deps) and wrap the result in `withTurnEarlier(…, doubles.turnEarlier)`; otherwise the page and
  `getDoublesTurnInput` differ (`calculator-doubles-shell.test.ts:240` asserts they are equal). The file has no owner in
  ADDENDUM2 §8.3; U1's calculator area is the natural one.
- IN §5.4's reset rules need one-line calls in doubles-prep.ts (U1's in wave 1a), logic in doubles-inputs.ts (NU):
  `onSlot`'s `anotherPokemon` clears `history[slot]` (beside `carried`) and drops the slot from `turnEarlier.entered`;
  a build change runs NU's `reconcileEarlier` (extending `reconcileAllCarried`); `chooseDoublesMove` drops the action-bound
  carried fields; `setDoublesField` drops each `…Ends` flag whose effect is off; and the setters (`setDoublesHistory`,
  `setDoublesTurnEarlier`, keyed as `setDoublesCarried`).
- `retarget`'s full-slot input uses `slotInputs` (so it gets `withSlotHistory`) but not `withTurnEarlier`; target rules read
  neither today.
- `useDoublesView.tsx` (U1) builds the `CarriedControl[]`; NU's new values reach `EarlierTurnFields` through new
  `CarriedControl` fields (NU's type now) that U1 fills there, or a context NU adds in its own file.

## Files

- New: `app/(app)/calculator/doubles-inputs.ts`, `app/(app)/calculator/EarlierTurnFields.tsx`.
- Changed: `app/(app)/calculator/doubles-prep.ts`, `app/(app)/calculator/BattleConditions.tsx`.
- Scratch (gitignored): `status2/build/STEP0C.md`, `step0c-make-old.cjs`, `step0c-old/BattleConditions.head.tsx`,
  `step0c-old/BattleConditions.tsx`, `step0c-markup.test.tsx`, `step0c-markup.config.mts`.
