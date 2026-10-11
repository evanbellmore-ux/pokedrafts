# Wave 1a, Track D: the moves-phase guards (SPEC2 §4.5, ADDENDUM2 §4.2 D)

Branch `calc-2v2-status-2` (checked before the work and before this report). Files changed: `app/lib/battle/doubles-guards.ts`,
`app/lib/battle/doubles-spread.ts`, `tests/unit/doubles-guards-copies.test.ts`, `tests/unit/doubles-guards-lock.test.ts`,
`tests/unit/doubles-guards-spread-heal.test.ts`, `tests/unit/doubles-guards-misc.test.ts`, `tests/unit/doubles-guards-fling.test.ts`.
Build folder (this one): `w1a-d-cases.ts` (58 oracle cases), `w1a-d-run.ts` (oracle + compare, results in `w1a-d-results/`),
`w1a-d-stored.ts` (V1's stored results against the app), `w1a-d-rerun.ts` (stored reason cases with the reason taken off),
`w1a-d-print.ts`, `w1a-d-learners.ts`, `w1a-d-ab.mjs`, `w1a-d-trees/` (old/new snapshots for the A/B), `w1a-d-old/` (the D
files as Step 1 left them). Nothing else was edited. The start items (Imposter, start Starf, start copies) are ST's (wave 1b).

## What is modelled (pinned Showdown c23d2e94)

| Area | Rule | Where |
|---|---|---|
| Opportunist, Mirror Herb | Ledger with amounts: every boost() table's positive parts (after ChangeBoost, cap, TryBoost) into each living foe copier's `MonState.copy` (`noteRise`, the step's `report.rises` via `stepRises`; a spread attacker's once). Applied at the action's AfterMove in Speed order (`afterMoveCopies`): Opportunist boosts itself (effect ability), Mirror Herb is used (source the action's user; item gone, Unburden, item history); a held Herb that does not work keeps it pending; a copy is not copied back (`copying`). Fact `Opportunist: {Name} copies +2 Attack, +2 Sp. Atk.` / `…'s stats cannot go higher.` | PS/data/abilities.ts:3041-3082, items.ts:4146-4190 |
| Berserk / Anger Shell lock | In a later single-hit step the locked healing Berry reads as Leftovers (`sheerForceLock`), put back with the lock where the hit reached; the move's AfterMoveSecondary resets it and the action's Update eats it (`lockReached` → `lockReset` → `berryDue`); a multi-hit move resets it at the first hit; a status move reaching the holder resets it; a Champions Sheer Force move with secondaries keeps it (`keepsLock`); the holder's own No move unlocks (`noMoveUnlock`). End of turn keeps the old guard. | abilities.ts:143-173, :414-444; champions abilities.ts:2-13; battle-actions.ts:811-816, :1005 |
| Spread heals | Per target in hit order: drain `round(dealt × ratio)` (≥1) through TryHeal (Big Root per heal; Liquid Ooze the raw amount, not past Magic Guard), capped; Substitute hits first; Shell Bell once, `trunc(Σ dealt / 8)` (≥1) after Life Orb, a Substitute's damage out, none after Sheer Force; joint attacker/target kept (pseudo slot `shellbell`), mixtures merged canonically; over budget `Too many cases to follow.` | sim/battle.ts:2091-2186, battle-actions.ts drain/AfterMoveSecondarySelf |
| Hidden stages | Stored Power / Power Trip / Punishment read accuracy and evasion stages through `contextFor` → `hiddenStages` (guard is a no-op). | moves.ts storedpower etc.; pokemon.ts positiveBoosts |
| Glaive Rush | `vol.glaiveRush` after a hit (Substitute included) while the user lives; ×2 taken (`takenMods.glaiveRush`); removed at its next BeforeMove (`beforeFirst`, priority 100). | moves.ts glaiverush |
| Ripen | `vol.berryWeaken` from a resist Berry eaten (Bug Bite, Pluck, a flung one), cleared by a non-resist Berry; consumed by the next damage calculation into it (Substitute's included). Multi-hit into it: `Ripen is not modelled in 2v2.` | abilities.ts ripen |
| Starf (attacker in a step) | `report.starf` → `starfRise` mark → one world per stat below +6 at the action's end (+4 with Ripen). | items.ts starfberry |
| Encore | `encoreRewrites`: the queued move's priority and Prankster kept; target by getRandomTarget; none for Z/Max/Struggle/external. `encoreRewrite` (wired) follows one rewrite; two living foes for a single-target move stay `Encore changes {Name}'s move: not modelled.` until the kernel takes the branches. Fact `Encore: {Name} uses {Move}.` | battle-actions.ts:223-234; moves.ts encore |
| One-hit KO immunities | Sturdy, Wonder Guard, the type immunity (Ground/Levitate/Ring Target/Gravity/Iron Ball…, Scrappy/Mind's Eye/Foresight), then [ohko]: Dynamax, higher level, Sheer Cold into Ice (gen 7+). Facts `{Ability}: {Name} is immune.`, `{Name} is immune to {Move}.` The damage path itself waits for F's row (below). | battle-actions.ts:696-708; abilities.ts sturdy, wonderguard |
| Fling | `flingTry`: fling.ts `flingFailure` (Embargo, Magic Room, Klutz, no item, cannot be flung); marks the user. `flingAfter` → `flingHit`: the step's Life Orb recoil given back (and hurtThisTurn), the effect on a target the hit reached and left in: Berry eaten (heal, Cheek Pouch, cures, boost() from the user, Figy confusion, Lansat, Starf mark, Ripen, Cud Chew counter 2; no lastItem on the target), status as a certain secondary (Shield Dust, Covert Cloak stop it; Sheer Force does not; kernel `giveStatus` with Synchronize and curing Berries), flinch (Inner Focus, Shield Dust, Covert Cloak, Dynamax, Focus Punch), White Herb (accuracy/evasion too), Mental Herb; then the item gone at the hit's Update (`flingEnd`: lastItem, usedItem, Unburden; Symbiosis is eventGuards'), else at the action's Update (Protect, immunity). Facts: fling.ts `flungFact` plus forceEat's wording for the Berry's effects. | moves.ts:5734-5787; battle-actions.ts:967; battle.ts:2861 |
| Readers | `tracksItems`: Harvest, Pickup, Symbiosis, Cud Chew (Trace's copy resolved), Recycle, Fling, SwSh Gigantamax Snorlax. `stepReport`: rises / starf / dealt only when needed (8 frozen objects). | SPEC2 §4.9 |

Narrow reasons kept (each a one-line fact): `Fling with Shell Bell is not modelled in 2v2.` (the step heals with it); `Fling
with Life Orb …` into a Substitute, Disguise or Ice Face, or when the user is at 0 HP after the step; `Fling with {Berry} …`
when its heal comes before the target's own HP-line Berry the step ate, or before a Berserk / Anger Shell rise it would have
stopped; `Fling with {Item} …` when the step itself used the thrown item; `Fling with {Mold Breaker} …` where a broken status
guard would differ; `Custap Berry flung at {Name} is not modelled in 2v2.` with a later action of that target;
`Opportunist with Mirror Herb …` on one Pokémon; Ripen multi-hit; Encore with two foes.

## Verification

- `w1a-d-run.ts` (58 cases): 53 agree. The 5 others are not D's code: G4-BZK-03 (the start settle eats a carried-locked
  Berry: start 91 vs 55, final HP agrees; ST), G4-BZK-04-usum (Berserk's own rise missing in uses-to-ko; integrator),
  G4-GLV-01/-03 (E2 does not emit the `glaiverush` volatile; integrator), G4-ENC-01 (compare expects a hit entry for the
  encored Protect; V1).
- D-FLG-01…19 (Fling, all four target effects, Protect, Sheer Force, Synchronize, Lum, Figy confusion, Starf, Mental Herb on
  attraction, the Cud Chew target, the own-Berry order guard): all agree.
- V1's stored G4 results (`w1a-d-stored.ts`): G4-FLG-01…10 agree but G4-FLG-09 (Symbiosis not modelled); G4-OPP-01…11,
  G4-SPH-01…09, G4-STF-01/03/04, G4-ENC-02, G4-OHK-02/04/10/11, G4-SFL-02/02b/03 agree. Not D's: G4-OHK-01/03/05…09
  (`One-hit KO move: no damage range.`: F's row), G4-STP-01…04 (E2 `stages`), G4-BZK-01/02/04/05/07 (Berserk rise, E2
  `berryLocked`), G4-GLV-01/02 (E2 volatile), G4-OPP-07 and G4-STF-02 (start; ST), G4-LMV-01/02 and G4-ENC-01 (compare;
  two-foe Encore), G4-SFL-01-champions (stored reason now obsolete: V1 re-runs it; the app matches the oracle without it).
- Unit: `tests/unit/doubles-guards-*.test.ts` 60 pass (ally 5, copies 8, lock 4, spread-heal 10, misc 14, fling 19).
- Source: `tests/source/status2-hooks.test.ts` keeps two failures that are E1's (copierEndOfTurn call removed) and S's (faces).
- Not run: the bench (it writes V1's results/bench.json), `next build`, golden-1v1 (no 1v1 code changed).

## Tests other tracks own that D's model changes (expected "not-estimated", now "ready" and oracle-exact)

- `tests/unit/doubles-engine-fixes.test.ts` "guards Opportunist copying Defiant's rise … (H3, RV05)".
- `tests/unit/doubles-engine-verify.test.ts` "is not estimated when a status move then reaches the locked holder …" and
  "does not estimate Stored Power and Punishment reading a positive accuracy or evasion stage".
- `tests/unit/doubles-turn-fixes.test.ts` R14 (Glaive Rush) and F22a (Steadfast + Opportunist).
- `tests/unit/doubles-turn-guards.test.ts` "a Starf Berry eaten as the turn starts, and Opportunist copying a rise" (its
  Opportunist half) and "a spread move healing from several targets …" (Shell Bell Heat Wave).
- `tests/unit/doubles-status.test.ts` "gives each where its turn meets it": the row `Encore changes Garchomp's move: not
  modelled.` (Earthquake is a spread move: one rewrite, now modelled).
- `tests/source/status2-step1.test.ts` #2 (G4-SFL-01 ready) and #8 (Stored Power with a carried stage ready).

## For the integrator (frozen files)

1. uses-to-ko.ts: one-hit KO moves as a fixed hit of the target's maximum HP in the turn step's fixed branches (the ones
   that read `row.fixed` near :2736, :2848, :2912), so `ohkoStep` can return null for a hittable target.
2. uses-to-ko.ts: Fling's per-use item effects (no Life Orb recoil, no Shell Bell heal, no attacker Berry after the item's
   Update); D then drops `lifeOrbBack` and the Shell Bell guard.
3. uses-to-ko.ts: Berserk's +1 Sp. Atk when a hit takes the holder from above half to half or less (mirroring Anger Shell's
   rule; not after a Sheer Force move outside Champions; the locked Berry held).
4. doubles-turn.ts status2Mon / outcomeOf: emit `stages` (accuracy, evasion), `berryLocked` and the `glaiverush` volatile.
5. doubles-turn.ts execute: call `guardHooks.encoreRewrites` and run each `{ world, action }` (then `encoreRewrite`'s guard
   for two rewrites goes).
6. Remove REASONS keys with no site left: `hiddenStages`, `hiddenStagesEarlier`, `spreadHeal`, `takesDouble` (keep
   `berryLocked`, `berryLockedSheerForce`, `copiesRise`).
7. Update the tests listed above and status2-hooks.test.ts's copierEndOfTurn row.
