# Wave 1b, Track M: G-Max effects, Max Guard, Pain Split into a Dynamaxed Pokémon (status2)

Branch `calc-2v2-status-2`, checked at the start and before this report. Nothing committed, pushed or switched; no frozen file,
no other track's file, `.claude/`, `node_modules`, CastMirror or RaidCard file touched; no `next build`, nothing against
Supabase. Owned files only: `app/lib/battle/doubles-max.ts` (rewritten), `tests/unit/doubles-max.test.ts` (new). Scratch work in
`status2/build/w1b-m/` (scripts, cases, snapshots, logs).

Spec: ADDENDUM2 §4.3 M (T2M §3.19, §3.24; ADDENDUM2 §1.3's Pain Split move to M, §4.4's random branches, §2.5's stall fact),
ground truth pinned Showdown c23d2e94.

## What `doubles-max.ts` does

| Part | Model (PS = pinned Showdown) | Needs kernel lines |
|---|---|---|
| Max Moves' partner and other-foe stages | unchanged (MAX_MOVE_EFFECTS) | — |
| G-Max Foam Burst, Tartness, Volt Crash, Malodor | unchanged (each foe, position order) | — |
| G-Max Smite, Gold Rush | addVolatile('confusion') on each foe, source the user: none if confused, Own Tempo (breakable), Misty Terrain under a grounded foe not hidden, Safeguard unless the user's Infiltrator; Persim / Lum at the hit's Update (fact `{Name} eats its Persim Berry: its confusion ends.`) | — |
| G-Max Cuddle | addVolatile('attract'): infatuated already, Oblivious, Aroma Veil (breakable), the genders vs the user (genderless none; unset on a two-gender species: `G-Max Cuddle needs {Name}'s gender.`); Destiny Knot back; Mental Herb at the hit's Update | — |
| G-Max Chi Strike | `vol.chiStrike` +1 (at most 3) on the user and its living ally (the kernel's calcBuild gives `critBoost`) | card / E2 text: M-16, M-17 |
| G-Max Finale | heal trunc(maxhp / 6) on the user and its ally (Dynamax maximum; Heal Block none; full HP none); `G-Max Finale: +n HP.` | — |
| G-Max Finale's narrow reason | `G-Max Finale with {Life Orb / Shell Bell / X's Jaboca Berry / X's Rowap Berry / X's Innards Out} is not modelled in 2v2.`: the heal is in self.onHit, before the user's post-hit HP changes, while the pair's step gives the user's HP after the whole use (order matters at full HP and at a faint) | — |
| G-Max Sweetness | the ally's cure clears its sleep / freeze / toxic counters; `SideState.benchCured` (E2) with Aromatherapy's fact | — |
| G-Max Resonance | Aurora Veil on a fresh clock (`clock.auroraVeil = "set"`) | — |
| G-Max Gravitas | Gravity as Gravity's own start: `fieldSet.gravity`, H's `land` for hidden Pokémon, A2's `gravityGrounds` | — |
| G-Max Wind Rage | the foe side's Safeguard and Mist end (clocks with them; the step ends the screens and the terrain); the hazards of both sides go (`hazards: []`, `hazardsFrom: null`); `G-Max Wind Rage: Safeguard ends on the opponent's side.` | — |
| G-Max Steelsurge, Stonesurge | `gmaxsteelsurge` / `stealthrock` on the foe side (once a turn) | — |
| G-Max Terror | trapped (A1's state: `vol.trapped`, `trappers` = the user) on each foe but a Ghost type or one trapped already | — |
| G-Max Meltdown | Torment on each foe not Dynamaxed (Aroma Veil blocks): Mental Herb used up at the hit's Update | — |
| G-Max Befuddle, Stun Shock | per foe 1/3 slp / par / psn (1/2 par / psn), through the kernel's giveStatus (sleep too: canStatus has its immunities), Chesto at the Update; one world per pick | worlds: M-13 |
| G-Max Replenish | one 1/2 for the move; each item-less Pokémon of the side whose last item (MonState.lastItem, else the input's; unknown: `G-Max Replenish needs {Name}'s item from an earlier turn.`) is a Berry gets it back (A3's `restore`), then the hit's Update (a curing Berry, else `kernel.berryDue`) | worlds: M-13 |
| G-Max Depletion, Snooze, One Blow, Rapid Flow, Drum Solo, Fireball, Hydrosnipe | no state this turn reads (Trump Card is not in SwSh; Snooze is a 1/2 Yawn: the turn's rule), or the calculation's | — |
| Max Guard | a Dynamaxed Pokémon's status action (not as a Z-Move; not a Dancer's copy or a second use) is Max Guard: priority 4 (+1 Prankster), BeforeMove as Max Guard (Taunt stops it; no sound or heal flag), the protect path with kind `maxguard` (willAct, N's stall roll: `Max Guard fails.`), blocking every move into its user but its 27-move pass list (no protect flag read: Unseen Fist does not pass; Max Moves blocked; Feint and G-Max One Blow / Rapid Flow pass at full damage; Feint leaves it up), status moves too (`Max Guard blocks Thunder Wave.`), Gear Up / Magnetic Flux / Flower Shield / Teatime's TryHit too; no contact effect; the step's `effectiveName` "Max Guard"; the stall counter input and the `Assumes no protecting move was used last turn.` fact | M-1 … M-12, M-15 |
| Pain Split into a Dynamaxed Pokémon | `painSplitHP`: t = ceil(hp × baseMaxhp / maxhp) while Dynamaxed, average floor((t + a) / 2) or 1, the target's sethp(hp − (t − average)), the user's sethp(average) (truncated, 1..max); without Dynamax the same numbers as today | M-14 |

`WIRED = { worlds, maxGuard, painSplit, chiStrike }` (all false in the live tree) keeps today's reasons for the parts whose
kernel lines are not in yet (`Max Guard is not modelled.`, `{G-Max move}'s random status is not modelled in 2v2.`,
`Pain Split with a Dynamaxed Pokémon is not modelled in 2v2.`, Replenish's `notIn2v2` while a later action follows); the
integrator sets each to true with its lines (as doubles-pairs.ts WIRED). New exports the lines call: `usedStatus`,
`maxGuardAction`, `passesMaxGuard`, `maxGuardBlocks`, `MAX_GUARD_PASS`, `painSplitHP`, `conditions`, `outcomeVolatiles`.
New runtime imports: doubles-hidden, doubles-items, doubles-typing, doubles-use, doubles-world (none reaches doubles-max,
doubles-status, doubles-field or doubles-abilities: no cycle; tests/source/status2-hooks.test.ts passes on the live tree and
on the patched snapshot c).

## Integrator lines (frozen files), exact

All of them are in `w1b-m/patch-int.cjs` as exact single-match replacements (it makes the scratch tree `w1b-m/int/` or patches
a given dir; line endings kept). Summary:

- **M-1** `doubles-actions.ts`: `PROTECT_MOVES` gains `maxguard: "maxguard"`; `PROTECT_CONTACT` gains `maxguard: null`.
- **M-2** `doubles-world.ts`: `ProtectKind` gains `| "maxguard"`.
- **M-3** `doubles-turn.ts` priorityOf: `const move = maxHooks.usedStatus(kernelOf(ctx), w, action, ctx.runtime.movesById.get(action.moveId)!);`
- **M-4** `doubles-status.ts` beforeInfo: `const move = maxHooks.usedStatus(kernel, w, action, kernel.runtime.movesById.get(action.moveId)!);`
- **M-5** `doubles-turn.ts` runMove: `statusHooks.statusMove(kernelOf(ctx), w, action, maxHooks.usedStatus(kernelOf(ctx), w, action, move))`
  (the action keeps its own move: noteHistory / Copycat, exitsAfter, the step's moveId).
- **M-6** `doubles-turn.ts` carriedState: `… || ownMove === "quickguard" || maxHooks.maxGuardAction(ctx.input, slot));` (for `ownMove === "maxguard"`).
- **M-7** `doubles-turn.ts` hitChecks: `if (target.protect && !(target.protect === "maxguard" ? maxHooks.passesMaxGuard(kernel, w, action, info, slot) : passes())) return …;`
- **M-8** `doubles-turn.ts` conditionsFor: `protect: !residual && receiver.protect !== null && receiver.protect !== "maxguard",`
- **M-9** `doubles-turn.ts` Feint: `if (world.mons[check.slot]!.protect !== "maxguard") world.mons[check.slot]!.protect = null;`
- **M-10** `doubles-status.ts` tryHit, after the protecting moves' block: `const guarded = maxHooks.maxGuardBlocks(kernel, w, slot, move); if (guarded) return no(guarded);`
- **M-11** `doubles-abilities.ts` plusMinus and flowerShield loops, after `reach(...)`: `if (w.mons[slot]!.protect === "maxguard") { hitFact(kernel, use, slot, \`${kernel.moveName("maxguard")} blocks ${use.move.name}.\`, w); continue; }`
- **M-12** `doubles-field.ts` teatime, before the Berry test: `if (mon.protect === "maxguard") { stop(\`${kernel.moveName("maxguard")} blocks ${move.name}.\`); continue; }`
- **M-13** maxEffects returns `World[]`: the TurnKernel member's type; singleStep `if (info.isMax && landed > 0) return maxHooks.maxEffects(…).flatMap((each) => (check.through ? protectContact(ctx, each, …) : [each]));`;
  doubles-faces.ts `worlds = worlds.flatMap((next) => kernel.maxEffects(next, …))`; doubles-spread.ts (both) `return info.isMax && hit ? out.flatMap((world) => kernel.maxEffects(world, …)) : out;`;
  doubles-substitute.ts subOnly returns `World[]` (maxEffects moved to its end: `return info.isMax && !spread ? kernel.maxEffects(w, action, info, target) : [w];`) and stepped's loop goes on with each world.
- **M-14** `doubles-status.ts` painSplit: drop `const maxUser … maxTarget …;` and the two arithmetic lines for `const [toUser, toTarget] = maxHooks.painSplitHP(kernel, w, user, slot, a, b);` (byte-equal without Dynamax).
- **M-15** `doubles-turn.ts` turnFacts: `(!!PROTECT_MOVES[…] || maxHooks.maxGuardAction(input, slot)) && …carried?.stall === undefined` (ADDENDUM2 §2.5: Max Guard is a protecting move).
- **M-16** `doubles-turn.ts` conditionFacts: `…, ...maxHooks.conditions(kernel, w, slot),` (`G-Max Chi Strike +{n}.`, ADDENDUM2 §5.1).
- **M-17** `doubles-turn.ts` outcomeOf volatiles: `…, ...maxHooks.outcomeVolatiles(kernel, world, slot)` (`gmaxchistrike`, ADDENDUM2 §3.1).
- **WIRED**: `export const WIRED = { worlds: true, maxGuard: true, painSplit: true, chiStrike: true };` with the lines (or delete the
  flags and the fallbacks they guard, with REASONS `maxGuard`, `randomStatus`, `withDynamax`, and doubles-actions.ts
  `GMAX_EFFECTS` / `RANDOM_STATUS_MAX_MOVES`, which doubles-max.ts no longer reads; tests/source/doubles-status-moves.test.ts:264
  reads GMAX_EFFECTS["G-Max Tartness"]).

Tests the lines change (frozen owners' tests; exact):
- `tests/unit/doubles-turn-guards.test.ts:241-246`: the Dynamaxed Charizard's Protect is Max Guard: `expect(calculateDoublesTurn(turn(swsh, {…})).status).toBe("ready")`.
- `tests/unit/doubles-turn-guards.test.ts:338-342`: G-Max Befuddle with another action: ready (that test already fails on the
  live tree at its Cotton Down line, K's).
- `tests/unit/doubles-status.test.ts:477`: `expect(calculateDoublesTurn(dynamax).status).toBe("ready");` (S48-PainSplit-dynamax-swsh agrees with pinned Showdown).
- `tests/unit/calculator-doubles-inputs.test.ts:759`: `[...Object.keys(PROTECT_MOVES).filter((id) => id !== "maxguard"), "endure"]` (Max Guard is a Dynamaxed status move, not a chosen one: the table's isMaxActive branch).
- `tests/unit/doubles-max.test.ts`'s `wired(...)` tests run as `it` once WIRED is true (12 `it.fails` today).

## Ground truth and gates

Driver `w1b-m/run.ts` (oracle via sim-dfs.ts into `w1b-m/oracle/`, V2's stored results first; app via app-turn.ts with the tree
TSX_TSCONFIG_PATH maps; compare.ts compareCase). Cases: V2's T2M-GM-01…09, T2M-PS-01/02, IN-STL-04, and Track M's own
`w1b-m/cases-m.ts` M-MG-01…08, M-GM-03b, -10…-24, M-PS-03 (Feint, status moves and Coaching, stall 3, the failure, priority and
Prankster, One Blow, Unseen Fist; Wind Rage + Safeguard, Meltdown + Mental Herb + Knock Off, Misty Terrain, Own Tempo + Persim,
Safeguard, Destiny Knot, Mental Herb, Electric Terrain + Insomnia + Chesto, Chesto + later moves, Stun Shock immunities,
Replenish's Sitrus at the Update, Sweetness, Gravitas + Earthquake, Terror, Stonesurge, Finale + Life Orb).

- **With the lines (scratch tree `w1b-m/int`, snapshot c):** 30 of the 38 agree; the 8 others are two harness points
  (needsFromOthers V2), and S48 agrees once re-expected:
  - T2M-GM-08, M-GM-19: the oracle forces G-Max Replenish's randomChance(1, 2) to fail (restored always): sim-dfs.ts keys
    CHANCE_EFFECTS on `this.effect?.id`, which is undefined there (the effect is the move's `self` object:
    `w1b-m/probe-replenish.ts` prints `randomChance(1, 2) effect.id=undefined activeMove=gmaxreplenish`). The app has 1/2.
  - T2M-GM-09, M-MG-01/02/05/06/07/08: compare.ts's PROTECT_FACT rule (PROTECT_FAMILY by move name) does not count a Dynamaxed
    status move (Max Guard) as protecting; the app gives `Assumes no protecting move was used last turn.` per ADDENDUM2 §2.5.
  - S48-PainSplit-dynamax-swsh (stored, `notEstimated`): with STATUS2_REEXPECT=1a,1b its fresh oracle result agrees.
- **Live tree (WIRED false):** T2M-GM-01, -02, -05 agree; GM-04 but for M-17's E2 volatile; the rest keep today's reasons.
- **A/B/C over every stored case (2308, one moment; `w1b-m/abc/`):** a = live with Step 0's doubles-max.ts, b = live, c = b +
  the lines. a vs b: 5 differ, exactly T2M-GM-01…05 (now modelled). b vs c: 9 differ, exactly IN-STL-04, S48-PainSplit-dynamax,
  T2M-GM-04, -06, -07, -08, -09, T2M-PS-01, -02. No other stored case changes.
- **Unit tests:** `tests/unit/doubles-max.test.ts` live: 13 passed, 12 expected fail; on the patched tree
  (`w1b-m/vitest.int.config.mts`): 25 passed. The doubles-/calculator-/status2 unit files on snapshots a and c fail the same
  tests (other tracks' work in progress) but the two listed above (doubles-turn-guards Max Guard, calculator-doubles-inputs's
  table); a few UI tests time out only under two parallel runs and pass alone.
- `golden-1v1 --check`: 254 cases byte-equal on snapshots a and c (TSX_TSCONFIG_PATH=`abc/tsconfig.{a,c}.json`).
- tsc: no error; eslint clean on both files; tests/source/status2-hooks.test.ts passes on the live tree and on snapshot c
  (a copy under `abc/c/tests/source/` with `abc/vitest.source-c.config.mts`, removed after the run).

## Notes for others

- **PR (Dancer):** a Dynamaxed Pokémon's dance move is Max Guard (`maxGuardAction(input, slot)` / `usedStatus`): no Dancer copy
  (Showdown's Dancer reads the move used; Max Guard has no dance flag). PR's presence guards and afterAction read the queued
  move id.
- **CL:** `vol.usedMove` is "maxguard" for Max Guard (Showdown's lastMove is the Max Guard, isMax: Mirror Move fails); Copycat
  copies the base move (battle.lastMove's baseMove): World.lastMove stays the queued move (M-5 leaves runMove's `move`).
- Calling moves, Sleep Talk etc. of a Dynamaxed Pokémon are Max Guard; their presence guards may still give their reason
  (harmless: not estimated).
