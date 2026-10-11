# VERIFY-ui: independent check of the UI fixer's work (status-eot review, lens "ui")

Verifier for `build/FIX-ui.md` (F1 UI side, F2 UI side, F3, F4, F5, F6, F7). Ground truth: pinned Showdown c23d2e94
(read-only source and `design/status-sim.ts` over the runnable copy). My probes are in `build/verify-ui-probes/` and their
outputs in `build/verify-ui-probes/out/`.

**Verdict.** All seven fixes hold. The rules match pinned Showdown in every game and variant I probed (200 of 200
start-cure rows). I found one more F7-type line in the neighbourhood and fixed it: a Ghost Curse lists its own user as a hit
it never reaches. Three more gaps belong to the engine fixers (see "Open for others"). 1v1 stays byte-equal.

## How to re-run

- `npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/verify-ui-probes/start-cures.ts` (F1/F2 rule against
  Showdown: 4 games × curing abilities × Neutralizing Gas foe/ally/fainted × Ability Shield × Magic Room, with controls).
- `npx --no-install tsx …/verify-ui-probes/{trace-cure,mega-cure,start-berries,battle-forms}.ts` (neighbourhood).
- `npx vitest run --config scripts/.cache/calc-audit/status-eot/build/verify-ui-probes/vitest.config.mts` (render probes:
  `render.test.ts`, `zero-reach*.test.ts`. They render the turn through DoublesSummary, and `cardReached` gets the runtime
  as `useDoublesView` passes it).
- The fixer's copies: `npx vitest run --config …/build/fix-ui-probes/vitest.config.mts` and its three tsx probes.

## Per finding

### F1 (UI side): no count for a status the Pokémon's own ability cures at the first Update — confirmed

- Repro re-run (`fix-ui-probes/impossible-states.ts`, same output as the fixer's): `carriedOptions` gives `toxic:false` for
  Immunity Snorlax and `sleep:null` for Insomnia Hypno.
- Rule checked against pinned Showdown:
  - `data/abilities.ts` onUpdate cures are exactly immunity and pastelveil (psn, tox), insomnia and vitalspirit (slp),
    limber (par), magmaarmor (frz), owntempo (confusion), and waterveil, waterbubble and thermalexchange (brn). The other
    onUpdate abilities (commander, disguise, iceface, trace, oblivious) cure no carried state.
  - No `champions`, `gen8` or `gen7` mod overrides these abilities.
  - `sim/battle.ts:2860`: in gen 5 and later, an Update runs after every action except `start`, so also after
    `beforeTurn`, before any Mega Evolution or move.
  - `sim/pokemon.ts:858-877` ignoringAbility: Neutralizing Gas from any active (non-fainted) Pokémon; an Ability Shield
    counts only through `hasItem`, which Magic Room switches off.
- `start-cures.out`: **200/200 rows agree** across sv, champions, swsh and usum. The variants are plain, Magic Room without
  gas, gas foe, gas ally, fainted gas holder, gas plus Ability Shield (foe or ally), gas plus Ability Shield plus Magic
  Room, and Ability Shield plus Magic Room without gas. Controls are a Pressure Pokémon asleep or confused, which keeps its
  counts.
  - One row first disagreed: swsh Pastel Veil, fainted gas holder. That was a probe artifact. When the gas ends, Pastel
    Veil's own onStart cures the poison (neutralizinggas onEnd restarts abilities), which is still before any move. The
    probe now records a cure that happens during its setup.
  - Champions has neither Neutralizing Gas nor Ability Shield, so only the plain and Magic Room rows apply there.
- Battle forms (`battle-forms.out`, `mega-cure.out`): Mega Mewtwo Y (USUM, Insomnia) is cured by the Update after the Mega
  Evolution, before any move. The UI reads the Mega form's ability and offers no count, which agrees.
- State transitions: the fixer's tests cover these, and I re-ran them. Gas gained, lost, or fainted with; Ability Shield
  gained; Magic Room on and off; Own Tempo set; Insomnia set on a Rest sleep.
- Still open (engine, not UI): `impossible-states.ts` still shows Hypno "Asleep." at 66.67%, Magcargo "Frozen." at 80%,
  and the Snorlax and Floatzel residuals.
- Gap in the rule (engine and UI together): a **Trace** user that copies Insomnia is cured before any move in pinned
  Showdown (`trace-cure.out`: `|-activate|p1a: Gardevoir|ability: Insomnia`, then `|-curestatus|…|slp`). The UI reads the
  build's own ability ("trace") and offers the sleep count. I left the UI rule as it is so that it stays identical to the
  one the engine fixer was asked to implement; see Open for others.

### F2 (UI side): no Confused control for Own Tempo — confirmed

- `fix-ui-probes/own-tempo.ts`: `carriedOptions(...).confusion` is false.
- `start-cures.out`: Own Tempo in all four games is cured in Showdown without gas or with an Ability Shield. The
  confusion stands under gas, and under gas plus Ability Shield plus Magic Room. The UI offers Confused in exactly those
  cases.
- Engine side still open: the fixer's needsFromOthers stands (a carried confusion that reaches the engine directly still
  gets a self-hit).

### F3: no hit count on the hits that got past a Substitute — confirmed

- `fix-ui-probes/rockblast-sub.ts`: "Snorlax: 25–124 damage (10.64–52.77% of max HP) · KO chance 0%". In pinned
  Showdown, 1–4 hits reach Snorlax, never 2–5.
- Neighbourhood (`render.txt`): every line that met a Substitute shows no count. The count stays on the same moves with no
  Substitute ("75–93 damage …, 3 hits").
  - Skill Link Bullet Seed: always 5 hits.
  - A chosen 3-hit Rock Blast. Only 1–2 hits can reach the Pokémon behind a 30 HP Substitute: 25–62, the app's range.
  - Population Bomb (10 hits) and Dual Wingbeat.
  - Rock Blast in Champions and SwSh, and Skill Link Icicle Spear in USUM.
  - A Substitute met in only some outcomes: a faster Rock Slide may break it first, and the line reads "reaches it 56.25%".
  - A Substitute that sometimes holds.
- Same rule, different path (engine): the **start rows of a turn that is not estimated** ignore a carried Substitute.
  `render.txt` shows "Rock Blast · Tyranitar → Snorlax: 50–155 damage (21.28–65.96% of max HP), 2–5 hits" into a Snorlax
  behind a 30 HP Substitute; pinned Showdown deals at most 124, by 1–4 hits. See Open for others.

### F4: a fainted Pokémon's kept state shows no stray select and counts no toggles — confirmed

- `fix-ui-probes/out/controls.txt` 2b: "own-right: Venusaur Charge" and "0 toggles on", and the state is kept.
- The code gates the confusion select and the counts block on `options.confusion`. `carriedToggles` counts only controls
  that are shown, and its only caller (DoublesSettings) passes the controls with their options.

### F5: Substitute HP typed past its bounds — confirmed

- `tests/unit/calculator-doubles-carried-input.test.ts`, re-run in the fake DOM: typing 380, blur, 12, 120, 0 at 1 HP, and
  clearing the field.
- NumberInput parses with `parseInt` (integers only). On blur it calls `onValueChange(clamped)`, which clears the error.
- The paths where a stale error could remain need a state change without a blur (Substitute unticked, EVs changed). A
  real click or tab blurs the field first, so I left the fix as it is.
- 375 px, re-checked myself in the browser pane on `fix-ui-probes/layout/page.html`: clientWidth 375, scrollWidth 375,
  0 overflowing elements. The error text "Squawkabilly: a Substitute has at most 20 HP; the turn uses 20." wraps inside
  its field (right edge 338 px).

### F6: no KO chance on a card only a status move reached — confirmed

- The scenarios match the fixer's: Thunder Wave, Swords Dance, Perish Song, Wish, Ally Switch and Trick show no KO chance.
- Neighbourhood (`render.txt`):
  - Cards that **keep** their KO chance:
    - the Substitute (move) user, "Jolteon: −35 HP";
    - Memento's user (100%);
    - Toxic, Curse and Leech Seed targets, through their end-of-turn residual;
    - Pokémon a damaging move reached, including one Protect blocked.
  - Cards that **show none**:
    - Pain Split's target when it gains HP;
    - Thunder Wave into Protect, and into Magic Bounce (both cards);
    - Spore into a Substitute;
    - the Leech Seed user, healed at the end of turn.
- Called moves, where a Status-category step could have a damaging hit: Metronome, Sleep Talk, Nature Power, Copycat and
  the rest are not estimated in 2v2 (`doubles-turn.ts:781`, `doubles-status.ts:733`). So the category test cannot hide a
  damaging hit's KO chance.
- Consistent with HEAD's rule for recoil and Life Orb, a Pokémon that only hurts itself in confusion (Confuse Ray's target)
  shows no "KO chance: 0%" unless it can faint.
- Gap (engine representation): **a Ghost type's Curse user** loses half its HP (135 → 68), but its card shows no KO chance,
  while Belly Drum's user does. The cost is only a step fact ("Curse: Gengar loses 67 HP.", `doubles-status.ts:1726-1731`),
  and the user appears only as an unreached hit. See Open for others.

### F7: status-move hits with nothing to state — (a) confirmed and extended; (b) still open (engine)

- (a) The scenarios lose the lone "Clefable" (Wish), "Alakazam" (Ally Switch) and "Snorlax" (Trick) lines.
  - Neighbourhood: Switcheroo (SwSh) and Helping Hand lose their lone lines too; each step's own fact names the Pokémon.
    Coaching, Taunt, Leech Seed and Curse keep their hits, which carry facts.
- **Found and fixed:** a Ghost type's Curse listed "Gengar: no effect · reaches it 0%" under its step in SV, Champions and
  USUM (`zero-reach.txt`). This is an engine-listed hit the move never reaches; pinned `data/moves.ts` curse uses
  `target: "normal"`, and nonGhostTarget "self" applies only to a non-Ghost user.
  - Across Follow Me, Lightning Rod, a retargeted move, a user that faints first and non-Ghost Curse, it is the only hit
    the engine gives with a reach of 0.
  - `doubles-format.ts listedHits` now also leaves out a hit with a reach of 0, no fact of its own and no Substitute
    record. It returns the same array when nothing is left out.
  - `cardReached` already ignores such hits.
  - New test in `tests/unit/calculator-doubles-ui.test.ts`: "leaves out a hit the move never reached, with nothing of its
    own to state (a Ghost type's Curse and its user)". It uses fixtures and the real engine, and it keeps a hit with a
    reach above 0 or with its own fact.
- (b) Not fixed (engine): Will-O-Wisp into a Fire type, and Thunder Wave bounced by Magic Bounce into an Electric Pikachu,
  still read "{Name}" then "{Name} is immune.". Spore into a Grass type reads "{Name}: no effect". The fixer's
  needsFromOthers (kind "no-damage" for a canStatus type immunity) stands.

## Evidence files I overwrote and restored

By mistake I ran the reviewer's own `review/ui/vitest.config.mts` once (22:55). Its probes rewrite `review/ui/out/`.

- Restored to the reviewer's text: `scenarios.txt` and `controls.txt`. I rebuilt them from the diff recorded before the
  run. Diffing them against `build/fix-ui-probes/out/` again gives exactly the F3/F6/F7 and F4 hunks as before.
- Same content as before: `cards.txt` and `substitute-input.txt` were byte-equal to the fixer's copies before the run, so
  the rewritten files have the same content.
- Regenerated with post-fix output, originals lost: `controls-default.html`, `controls-fainted.html`,
  `controls-statuses.html` and `residual-zero.txt`. `controls-fainted.html` no longer has the stray select; the F4
  evidence is in `reviews.json` and the restored `controls.txt`.
- Not touched: the tsx outputs (`impossible-states.out`, `own-tempo.out`, `rockblast-sub.out`, `left-right-grep.txt`).

## Checks

- `npx tsc --noEmit -p .`: clean. eslint on the five calculator files and both test files: clean.
- Unit tests:
  - `npx vitest run --config vitest.unit.config.ts` over tests/unit/calculator-doubles-*.test.ts, calculator-ui,
    calculator-layout, calculator-labels, calculator-tabs, doubles-moves-pane, calculator-ngas-2v2,
    calculator-ngas-2v2-verify and calculator-intimidate: 15 files, 367 tests pass (366 plus the new one).
  - The other tests that render the turn panel: calculator-arceus-forms, bug-bite, ice-face, item-forms, serene-grace,
    zmax-identity, zmove-effects and zmove-items, plus doubles-eot, doubles-items, doubles-kernel, doubles-outcomes and
    doubles-positions: 13 files, 169 tests pass.
  - `build/int-render.test.ts` passes; `build/fix-ui-probes`: 6 files pass; `build/verify-ui-probes`: 3 files pass.
- `golden-1v1.ts --check`: 254 cases byte-equal, both before and after my change.
- `compare.ts --no-write` over all cases: 999/1001 match.
  - S19c and S19e-champions differ only in a turn fact: "Every move hits; critical hits only where certain; …" against
    the expected "… no critical hits; …".
  - That text is not from a UI file; it is another fixer's work in progress.

## Open for others

1. **Engine (F1/F2): cure at the first Update.** Still not modelled (`impossible-states.ts` unchanged). Keep the rule
   identical to `doubles-prep.ts` `carriedAbilityOn` + `START_CURES` + Own Tempo. If it should also cover a Trace user's
   copied ability (pinned Showdown cures it, `trace-cure.out`), the UI's `carriedOptions` must take the same effective
   ability. Tell the UI owner so both change together.
2. **Engine (Curse):** record a Ghost Curse's HP cost on its user as that hit's `change` (as Belly Drum's and
   Substitute's cost are), instead of only a step fact and an unreached "no-damage" hit. The user's card then shows its KO
   chance under the F6 rule.
3. **Engine (start rows / Moves pane):** a carried Substitute is ignored in the not-estimated turn's start rows ("50–155
   damage …, 2–5 hits" into a 30 HP Substitute; Showdown's most is 124, by 1–4 hits). `doubles-turn.ts startRows` and
   `calculateDoublesMoves` should say so with the row's `fact`, or leave the row out.
4. **Status engine (F7 b):** as in the fixer's needsFromOthers.

Not changed, recorded: a Pokémon holding a curing Berry still gets the sleep, bad-poison and Confused counts
(`start-berries.out`). The engine eats the Berry at the turn's start as pinned Showdown does (Chesto, Lum and Persim:
Body Slam hits, 206/128), so the count changes nothing and every number agrees. Hiding it would mean copying the Unnerve,
Magic Room and Klutz rules into the UI.
