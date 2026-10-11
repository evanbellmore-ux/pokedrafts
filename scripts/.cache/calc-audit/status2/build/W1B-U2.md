# Wave 1b, Track U2: the calculator UI (status2)

Branch `calc-2v2-status-2`, checked at the start and before this report. Nothing committed, pushed or switched; no frozen
file, no other track's file, `.claude/`, `node_modules`, CastMirror or RaidCard file touched; no `next build`, nothing
against Supabase. Line endings kept (every file I edited is LF, as it was).

Scope (ADDENDUM2 §8.5 row U2): §5.1 for every wave-1b family (steps, card conditions, residual lines, losses, start rows
per variant), INTEGRATION-1A §4's cosmetic items (item 7: a fixed hit's `100–100%`, a certain KO summed in floats as
`>99.99%`), the Minimize hit fact (item 6), and the docs.

## Files

- `app/(app)/calculator/doubles-format.ts`
  - `percentText(row)`: one percent where both ends format the same (`235 damage (100% of max HP)`, Seismic Toss
    `50 damage (32.47% of max HP)`); otherwise 1v1's `damagePercent` (1v1 itself is untouched: golden byte-equal).
    `hitLine` and `startRowLine` (2v2 only) use it.
  - `koChanceText(chance, certain)`: with `certain` (the Pokémon's HP record has `koChance === 1`, the engine's exact
    certainty) a chance above `1 − 1e-9` reads `100%`; otherwise `chanceText` as before (`>99.99%` stays for a chance the
    engine keeps uncertain). `hitLine(…, certain)` (5th argument) and `residualLine(…, certain)` (3rd) take it.
  - `conditionsLine`: Bide's `Bide: {n} HP stored.` merges into one range like a Substitute's HP (`Bide: 40–48 HP stored`;
    prefix and suffix both must match, so a Substitute and a Bide stay apart); turn counts (`Taunt: 2 more turns.`) and
    layer counts (`Stockpile 1.`) keep each value with its share.
  - `copiedTargets(step, runtime)`: a copied step's heading scope for a move with no Pokémon target (`Targets itself` for
    Quiver Dance), else null (the heading then names what the copy reached).
  - `copiedFact(step)`: the copy's own step fact (the first fact starting `Dancer: ` / `Instruct: ` on a step with
    `copied`) and the remaining facts; nothing for an own step.
  - `cardReached`: a hit with a calculation (`row`) counts as a damaging hit even when the step's move is a status move
    (Sleep Talk, Copycat, Nature Power, Me First, Mirror Move calling an attack), so the card shows the KO chance.
- `app/(app)/calculator/DoublesTurn.tsx`
  - A copied step: `data-doubles-copied={copied}`; its first line is the copy's fact (`<p data-doubles-copy-fact>`,
    `wrap-anywhere`, with its share); its heading's targets come from `copiedTargets` or its hits, never the Pokémon's own
    action; **Show move** only when the Pokémon learns the move (its action, its quick moves or its species' moves: a
    Dancer can copy a dance it does not know, and the Moves pane would then show nothing).
  - Step keys gain the index (two copies of one move by one Pokémon: a Dancer copying two Swords Dances).
  - A status move's `no effect` wording for a blocked or no-damage hit only when no hit of the step has a calculation
    (a calling move that called an attack reads `no damage`).
  - Hits pass `certain = turn.hp[slot].koChance === 1`; residual lines `certain = endOfTurn.hp[slot].koChance === 1`.
- `app/(app)/calculator/DoublesSummary.tsx`: `effectiveMove` (the card's Z / Max / called name and type) reads the
  Pokémon's own step, not a copy of the same move that comes before it (`!entry.copied`).
- `docs/champions-calculator.md` (2v2 section): see "Docs" below.
- `tests/unit/calculator-doubles-ui.test.ts`: four describe blocks, 15 tests + 1 `it.fails` (below).
- Scratch: `status2/build/u2/` (`u2-probes.ts`, `u2-learners.ts`, `u2-species.ts`, `render-u2.test.tsx` +
  `render.config.mts`, `battle-min/` = K's 1a base copy with the Minimize line, `u2-probes-min.ts`), this file.

## ADDENDUM2 §5.1: what each family's text needs from the UI

Every §5.1 text is an engine fact that reaches the page through the existing lists; the tests pin each kind with the
designs' exact templates:

| §5.1 item | Path | UI change |
|---|---|---|
| Steps: `DoublesStep.copied` (Dancer, Instruct) | the step list | heading fact, targets, key, Show move, card's effective move (above) |
| Conditions (`Out of reach ({Fly}).`, `Lifted by {User} (Sky Drop).`, `Inside {Dondozo} (Commander).`, `Uproar: {n} more turns.`, `Laser Focus.`, `Destiny Bond.`, `Taunt: {n} more turns.`, `Encore ({Move}): {n} more turns.`, `Disable ({Move}): {n} more turns.`, `Bide: {n} HP stored.`, `Beak Blast heating.`, `Shell Trap set.`, `G-Max Chi Strike +{n}.`) | `DoublesHP.conditions` → `conditionsLine` | Bide's HP merge only |
| Residual lines (`Future Sight` / `Doom Desire` with `other`, `Cud Chew`, `Moody`, `G-Max Vine Lash` and kin, `Sea of fire`, `Zen Mode`, `Shields Down`, `Schooling`, `Life Orb`, `Taunt ends` / `Encore ends` / `Disable ends` / `Uproar ends`) | `residualLine` + its facts | none (the certain KO only) |
| `Gravity ends.`, `Magic Room ends.`, `{Terrain} Terrain ends.` | `endOfTurn.facts` (as the weather's `{Weather} ends.`, T2E §4.6.2) | none |
| Losses (`{Name} loses {n} HP ({High Jump Kick}).`, Aftermath, `{n}–{m}` Innards Out, Flame Burst, Disguise, Struggle) | `DoublesHP.losses` → the losses list | none |
| Start rows per variant (`If {Name}'s Trace copied {Ability}.`, `If {First} came in first.`) | `DoublesStartRow.fact` → `startRowLine` | none (one row each, in order) |

## Showdown / app checks (this tree)

- `u2-probes.ts ohko ch-ohko`: Sheer Cold into Snorlax (SV and Champions): hit `235-235 (100-100%) ko=1`; the line now
  reads `Snorlax: 235 damage (100% of max HP) · KO chance 100%`.
- `u2-probes.ts mimikyu ch-mimikyu2`: Bullet Seed into a 10 HP Mimikyu: hit `ko=0.9999999999999999` (the engine's
  `uncertain`: Mimikyu is in `otherFaints` through the Disguise chip), card `ko=1`; the line now reads `KO chance 100%`.
- `u2-probes.ts minimize minimize0` (SV): Body Slam into a carried-minimized Blissey `416-492` against `208-246`
  unminimized (the ×2 is exact today), no hit fact; with the integrator's line (below) on K's 1a base copy
  (`u2-probes-min.ts`): `facts=[{"text":"Minimize: double damage.","chance":1}]`, the unminimized case unchanged.

## Tests (new in `tests/unit/calculator-doubles-ui.test.ts`)

- "status2 wave 1b: copied steps": the copy's fact heads its step (with its share), a later step of the same Pokémon,
  distinct keys (also two copies of one move); Show move only for a learned move; the card's move from the own step
  (a Dynamaxed Dancer: `Move: Max Guard`); `copiedTargets` / `copiedFact`; a calling move's calculated hit (Sleep Talk
  calling Body Slam): KO chance on the card, `no damage` for its blocked hit, `no effect` kept for Thunder Wave.
- "card conditions, residual lines, losses and start rows": every §5.1 condition on one line, Bide's range, turns value
  by value; the residual lines and their facts; `Gravity ends.` and kin as end facts; the six losses in slot order with
  shares; three start rows with their `If …` facts; facts only, names, `wrap-anywhere`, ids at a phone's width.
- "a fixed hit's percent and a certain KO's chance": `percentText` (and Seismic Toss's start row); Sheer Cold into Snorlax
  through the Champions engine and the summary; Bullet Seed into a 10 HP Mimikyu through the engine (the hit 100%, the card
  100%, `>99.99%` without `certain`); a residual that knocks out on every outcome.
- "the hit fact of a minimize-flag move": `it.fails` until the integrator's line lands (then flip it to `it`).

## Gates run (this tree, 2026-10-11)

- `npx vitest run --config vitest.unit.config.ts tests/unit/calculator-doubles-ui.test.ts`: 91 passed, 1 expected fail
  (76 before).
- The other calculator-doubles files, `doubles-final-gate`, `doubles-start-rows`, `naming-guard`, `champions-calculator`,
  `battle-native-controls`, `calculator-arceus-forms`: 313 passed (12 + 1 files).
- `npx tsc --noEmit`: none in my files (other tracks' work in progress only: `doubles-eot.ts`, `doubles-fieldchange.ts`,
  `doubles-start.ts`). `npx eslint` on my four edited files: no output.
- 375 px and 1280 px (Browser pane, static pages from `render-u2.test.tsx` served on 127.0.0.1:4327 from the scratchpad,
  no sign-in): `u2-busy` (copies, every new condition on one card, three losses, the residual lines and field ends, two
  Charizards for the longest names), `u2-start-variants`, `u2-sheercold`, `u2-mimikyu`: `scrollWidth === clientWidth`
  (375 / 375; 1265 / 1265 at 1280), no element past the edge.
- Facts-only text review: the only new page text is the engine's copy fact and the existing `Targets itself`; no
  instruction, no position word (`positionalIn` empty in the tests).

## Docs (`docs/champions-calculator.md`, 2v2), written for the page after integration 1b (each sentence from the spec)

- **Turn:** the losses list's sources and shares; copied steps; one percent for a fixed hit; the certain KO's 100%; start
  rows per variant.
- **Before each move:** Sleep Talk calling its moves and Uproar's wake and sleep block, with their facts and **Uproar
  turns left** (replacing `Sleep Talk is not modelled in 2v2.` / `Uproar is not modelled in 2v2.`).
- **Status moves:** Safeguard keeping a damaging move's added status off its side (W modelled it in 1a; the docs still said
  `Safeguard is not modelled in 2v2.`).
- **The status2 status moves:** Forecast / Flower Gift gained mid-turn and Booster Energy after Magic Room / Defog's
  terrain end leave the not-estimated list (FC, with the `classify-a3.md` flips at integration 1b).
- **Tier 2 mechanics** (new bullet): the census guards modelled in 1a and 1b (H, N, W, S, K, M, PR, CL, ST, FC) with their
  facts and controls, and the narrow kept reasons (Metronome with its justification, Assist, Dragon Darts aimed at its
  user, Booster Energy by Trick, Beak Blast between hits, the swamp and rainbow, Pursuit with a switched-in Pokémon, a
  field change between two hits, Trace's field-changing copy, the Unknown answers' needs texts, `typeUnknown`).
- **End of turn:** the field ends from `fieldTurns` (replacing `Magic Room ending is not modelled in 2v2.`), Moody's
  outcomes (replacing `Moody raises one stat and lowers another.`), and E2's residuals (the landing, the G-Max side
  residuals and sea of fire, the countdowns, Cud Chew, the forms at 29); the reasons list keeps Power Construct
  (`formChange`), `landingPartners`, Neutralizing Gas ending and the budget.
- To check at integration 1b against what lands: the Symbiosis sentences stay (G4-FLG-09-sv is the integrator's), and
  every Tier 2 text quoted from the designs (CL's `Sleep Talk fails: {Name} has no move it can call.`, PR's
  `Beat Up: {n} hits ({Names}).`, E2's `{Move} does not hit: {Name} is its user.`, …) should match the tracks' strings.

## Deviations

- Show move on a copied step is hidden when its Pokémon does not learn the move (the spec says only "renders as the
  Pokémon's second step"); otherwise the button would open the Moves pane on nothing.
- The copy's fact is a line above the step's usual heading (position · move · Pokémon → targets) rather than replacing it,
  so the step keeps its number and targets.
- The certain-KO rule reads the card's exact `koChance === 1` with a 1e-9 tolerance on the hit's or residual's chance,
  not a blanket rounding: a chance the engine keeps below 1 for a Pokémon that does not faint on every outcome still
  reads `>99.99%` (`chanceText`, shared with Uses to KO, is unchanged).

## For the integrator (exact changes; none in a U2 file)

1. The Minimize hit fact (A1 F1 §4.2; INTEGRATION-1A §4 item 6), two one-line changes:
   - `app/lib/battle/doubles-abilities.ts:823`: `const MINIMIZE_MOVES: ReadonlySet<string> = …` → `export const
     MINIMIZE_MOVES: ReadonlySet<string> = …`.
   - `app/lib/battle/doubles-turn.ts` `afterHit`, after `const ownAny = !info.transformed && hitAny;` (line 3013):
     `if (ownAny && receiver.vol.minimize && abilityHooks.MINIMIZE_MOVES.has(id)) hitFact(ctx, action, target, "Minimize: double damage.", w.mass);`
   - Failing test: `tests/unit/calculator-doubles-ui.test.ts` "Body Slam into a minimized Blissey (Scarlet/Violet):
     Minimize: double damage." is `it.fails` today; with the lines it passes (checked on K's 1a base copy,
     `u2-probes-min.ts minimize`), so flip it to `it`. Stored cases with a minimize-flag move into a minimized Pokémon
     (`cases-sat.ts` SA13's Minimize-then-Body-Slam and the earlier-turn Stomp / Heavy Slam cases; `cases-cr.ts` CR-10a/b)
     gain the hit fact: `compare.ts` does not compare a damaging step's hit facts, so they
     still agree; `changed-cases.ts` / `app-diff.mjs` will list them as a fact change.
