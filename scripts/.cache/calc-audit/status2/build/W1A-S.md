# Track S (wave 1a): faces and Substitute hits

Branch `calc-2v2-status-2`. Owner files: `app/lib/battle/doubles-faces.ts`, `app/lib/battle/doubles-substitute.ts`,
`tests/unit/doubles-faces.test.ts`, `tests/unit/doubles-substitute*.test.ts`, `tests/source/doubles-substitute-census.test.ts`.
Spec: T2M §3.13 (face-guards), §3.22 (into-substitute), §3.23 (sub-per-hit), §3.25 (face-self-hit) as ADDENDUM2 assigns them.
Ground truth: pinned Showdown `c23d2e94` (verify harness `sim-dfs.ts oracle()`; scratch cases in `build/w1a-s/cases.ts`).

## What S models

| Part | Where | Showdown |
|---|---|---|
| A multi-hit move or a Parental Bond move into an intact Disguise / Ice Face: hit 1 is the face's (getDamage's neutral damage, no crit, `{Face}: {Name} takes no damage.`), the busted form at the Update (Disguise's 1/8 chip from generation 8, its Berry there; the chip can knock it out: no later hit, the hit's knockout), the later hits a continuation into the busted form (TurnStepPart skip = 1; the random hit counts each). | `faceHit` → `faceSeveral` / `faceContinue` / `stepContinued` | disguise / iceface onDamage, onCriticalHit, onEffectiveness, onUpdate |
| The 0-damage hit's own reactions: Rocky Helmet (contact, 1/6), Jaboca / Rowap (by category, 1/8, Magic Guard, Unnerve), Air Balloon, Kee / Maranga (AfterMoveSecondary), Sticky Barb, Cell Battery / Snowball / Absorb Bulb / Luminous Moss, Chilan Berry (the only resist Berry the neutral hit eats), Eject Button and Red Card (used up; the switch-out through R's `switchOut`; none when the move drags or switches its user), Knock Off (itemTakeable, Z-Crystals stay), Thief / Covet, Bug Bite / Pluck (the user eats it: `stolenEat`), Incinerate, Smelling Salts / Wake-Up Slap cures, Max Moves' foe drops on the face holder, stat moves' target drops and status, Magician, Life Orb, Throat Spray, Rocky Helmet knocking the user out at the face's hit (no later hit). | `zeroHit`, `afterMoveItems`, `magician`, `faceOnce` | items.ts / moves.ts handlers (census table `FACE_HIT_ITEMS`) |
| Every other effect of the face's hit (traps, Salt Cure, drags, U-turn, Throat Chop, Clear Smog…): the kernel's own `afterHit` with the hit's outcome (landed 1, no damage), feature-detected (`kernel.afterHit`); until the integrator adds it, `FACE_UNSAFE_MOVES` keeps the face's reason for them. | `faceOnce` → `kernel.afterHit` | battle-actions.ts afterMoveSecondaryEvent |
| The busted form's resist Berry for the move's type: the face's neutral hit leaves it, the first hit into the busted form eats it: a fresh continuation (TurnStepPart.fresh) for constant-power moves (S-FA-32, S-FA-33). | `resistFirst` | resist Berries' onSourceModifyDamage (typeMod > 0) |
| A confused Mimikyu's self-hit into Disguise: no damage, busted form, chip from generation 8, the skip fact `Hurts itself in confusion; Disguise takes the hit.` (no-move loss `{Name} hurts itself in confusion; Disguise takes the hit.`, chip loss `{Name} loses {n} HP (Disguise).`). Ice Face never (the self-hit has no category). | `selfHit(kernel, w, action)` (confusionHit) | conditions.ts:193-194 |
| Max Moves into a Substitute: the self / ally / foe stages, weather, terrain, field clears and cures (`MAX_MOVE_EFFECTS` every field, plus `kernel.maxEffects`); Z-Moves: Splintered Stormshards clears the terrain (onAfterSubDamage), Genesis Supernova sets Psychic Terrain (its secondary.self runs behind the Substitute: oracle-confirmed). | `subOnly` | moves.ts self.onHit, onAfterSubDamage |
| Magician (single target) into a Substitute: takes the item (hitTargets); Parental Bond into a Substitute (both strikes, Power-up Punch +2); Mind Blown: each Substitute's round(maxHP/2) cost and the end cost only when a target took damage or the move failed (with D's spread lines). | `plan`, `single` | battle-actions.ts trySpreadMoveHit, mindblown onAfterMove |
| Constant-power multi-hit moves into a Substitute that breaks: the prefix into the Substitute frozen (hits[k] := hits[0]), the hits after the break a fresh continuation (Multiscale, Stamina, Weak Armor, Mummy, resist Berries, Luminous Moss, face behind a Substitute). | `perHitReads`, `frozenCases`, `stepped` | HIT_SUBSTITUTE |

## Narrow reasons kept (tests in doubles-faces.test.ts / doubles-substitute*.test.ts)

- `{Face} is not modelled in 2v2.`: a resist Berry after the face for Triple Axel / Triple Kick (varying power), Parental Bond's ×0.25 strike, or a Gem the face's hit spent (no Gem of a resisted type exists in the four catalogs); a stat move's userSecondary after a chip knockout; a spread Magician; a spread Sticky Barb; a face's retaliation in a spread step until D adds `{ retaliation: "caller" }`; Neutralizing Gas or a critical in the neutral row; and (until integration) `FACE_UNSAFE_MOVES`.
- `REASONS.subPerHit` kept for Triple Axel / Triple Kick, Parental Bond doubled strikes and a Gem's first hit behind a Substitute (T2M §3.23).
- `REASONS.intoSubstitute` kept for a multi-hit move with recoil, drain or a self-cost; Mind Blown until D passes `{ costs: true }`; Magician in a spread move.
- `Disguise against a confusion self-hit is not modelled in 2v2.` until confusionHit passes the action (below).

## For the integrator (frozen files; tested in `build/w1a-s/tree` via sync-tree.mjs)

1. doubles-turn.ts, TurnKernel type after `applyStep(...)`: `afterHit(w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo, raisedBefore?: boolean): void;` and in makeKernel after `applyStep: ...`: `afterHit: (w, action, target, outcome, info, raisedBefore) => afterHit(ctx, w, action, target, outcome, info, raisedBefore),`.
2. doubles-status.ts confusionHit: replace `faceHooks.selfHit(kernel, w, slot);` with `const faced = faceHooks.selfHit(kernel, w, action);` + `if (faced) return faced;`.
3. tests/source/status2-hooks.test.ts line 144: `["doubles-faces.ts", "faceHit", ["kernel.healStandIn(", "withSpecies("]]` → `"faceOnce"` (faceHit dispatches now).
4. tests/unit/doubles-faces.test.ts: after 1 and 2, flip the three `it.fails` (Fire Spin / Salt Cure, self-hit, Dragon Tail) to `it` and delete the "today" test (all four verified in the patched tree).
5. tests/unit/doubles-turn-guards.test.ts:247 "a multi-hit move into an intact Disguise" fails now (ready by design, T2M §3.13): replace its `expectReason(turn(...), "Disguise against a multi-hit move is not modelled in 2v2.", ["own-left"])` with `expect(calculateDoublesTurn(turn(championsRuntime, {...same slots...})).status).toBe("ready");`.
6. doubles-actions.ts: `REASONS.faceMultiHit` and `FACE_REACTIVE_ITEMS` are unused now; `FACE_UNSAFE_MOVES` and `REASONS.faceSelfHit` (+ doubles-status.test.ts:453) after 1 and 2.

## For other tracks

- D (doubles-spread.ts spreadStep / drainingStep): `substituteHooks.plan(kernel, w, action, info, check, multiple, attackerHP, { costs: true })`; `if (sub) { hit = true; retaliation += sub.cost ?? 0; ... }`; face branch `retaliation += faceNs.faceRetaliation(kernel, w, action, info, target);` and `faceNs.faceHit(kernel, world, action, info, target, face, multiple, true, { retaliation: "caller" })`; Mind Blown's end cost only `if (mindBlown && !guarded && (damaged || failed))` with `damaged = plans.some((p) => p.entry?.search)`, `failed = plans.every((p) => p.check.block || (p.entry && !p.entry.search))`. Verified: S-SB-03, S-FA-19 match in the patched tree.
- V1 (compare.ts): a Disguise self-hit (effects `activate:disguise`, `damage:confusion:0`) has no range: expect the skip fact; noMove's selfHitOf misses `damage:confusion:0`. Changed cases (reason → ready, oracle-matched): E40-Disguise, E40-DualWingbeat-Mummy-swsh, E40-IcicleSpear-*, E40-Magician, E40-MaxMove-swsh, E40-ParentalBond-usum, VF16, T2M-FA-02…13, T2M-SB-01…05b, T2M-SP-01…03.
- R / kernel: a normal hit's Red Card is not used up in E2 (S-FA-17d control); a drag or Red Card switch with no later action leaves the replacement out (S-FA-17b, S-FA-36: the oracle has the bench Pokémon in).

## Verification (2026-10-11)

- Scratch cases (`run.ts`): current tree 88/101 (the rest wait for 1, 2, D or the switch family); patched tree (+1, 2, D) 95/101 (S-FS-01 ×2 = compare.ts above; S-FA-17b, -17d, -36 ×2 = switch family).
- V1's T2M-FA/FS/SB/SP: current 42/51, patched 47/51 (the four T2M-FS = compare.ts above).
- Base-vs-now app results over all 1932 stored cases: 48 differ, every one reason → ready and oracle-matched; no ready case changed.
- Unit suite: the only failure my files add is item 5 above; the others fail with the base files too (other tracks' WIP).
