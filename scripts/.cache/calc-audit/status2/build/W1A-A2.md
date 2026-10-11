# Wave 1a, Track A2: types, volatiles and grounding (SPEC2 §2.2 A2 rows, §4.3; ADDENDUM2 §4.2)

Branch `calc-2v2-status-2` (checked before and after the work). Files changed: `app/lib/battle/doubles-typing.ts` (rewritten),
`app/lib/battle/status-table.ts` (regenerated only: A2's 22 rows through `classify-a2.md`), `tests/unit/doubles-family2.test.ts`,
`tests/unit/doubles-typing.test.ts`, `tests/unit/engine-corrections-effectiveness.test.ts` (all new). Build folder: `classify-a2.md`,
this file, and the scratch tools in `a2/` (below). Nothing else was edited.

## What is modelled (pinned Showdown c23d2e94; sv, champions, swsh, usum)

- **World types** (SPEC2 §4.3.1): `setTypes` / `addType` follow pinned setType / addType (a Terastallized Pokémon, Arceus and
  Silvally, Stellar fail; an added type is replaced, cleared by setType); the kernel's typesIn and the calculation read them.
- **The 22 status moves** (classify-a2.md: 18 M, 4 C) through `HANDLERS`: Soak, Magic Powder, Forest's Curse, Trick-or-Treat
  (generation 7's Curse glitch at Showdown position 1: the ally; otherwise the random foe; `curseRetarget`), Reflect Type
  (base and added types, a Tera target's Tera type, ??? alone fails), Conversion (`moves[0]`; none: `needsFirstMove`),
  Conversion 2 (the target's move used this turn, else `lastMove`; `needsLastMove` / `needsLastMoveType`; one world per
  type), Camouflage (terrain; Normal with none in USUM), Electrify, Ion Deluge, Tar Shot, Foresight and Odor Sleuth, Miracle
  Eye, Telekinesis (Diglett/Dugtrio/Sandygast/Palossand and Mega Gengar immune), Embargo, Heal Block (Aroma Veil, Mental
  Herb), Nightmare, Octolock, Attract (Oblivious, Aroma Veil, Mental Herb, Destiny Knot, the source fainted; `needsGender`),
  Captivate, Powder (a quarter, Magic Guard none, Heavy Rain, Burn Up from a non-Fire user).
- **Hooks**: Attract at BeforeMove 2 (`beforeAttract`, 1/2 stopped), Powder at TryMove −1 (`powderTryMove`), a status move's
  Electrify / Ion Deluge type (`retypeStatus`), Protean and Libero at PrepareHit (`proteanGuard`: generation 9 and Champions
  once per entry through abilityActive; not for a future move, a calling move, or a snatched use), Roost (no guard),
  Smack Down / Thousand Arrows grounding (`groundingAfterHit`, calls `hidden.land`), Burn Up and Double Shock (`afterHit`),
  Color Change with the retyped type, Psychic Noise's kept Berry, `gravityGrounds` (for A3), `comboGuard` (Synchronoise with
  an added type; Natural Gift under Embargo or with Heal Block on a healing Berry; Electrify / Ion Deluge only where the kernel
  reads a type it does not retype yet), `conditions` and `outcomeVolatiles` (wired by P4 and P5).
- **Guards gone** (SPEC2 §2.4): typeChange (Protean, Roost, Burn Up, Double Shock), groundingChange (Ingrain, Magnet Rise),
  Smack Down's later-action guard, Psychic Noise's. The moved functions keep their names and call sites (status2-hooks rows);
  `ingrainGuard`, `magnetRiseGuard`, `psychicNoiseGuard` are empty, `ateRedirectGuard` stays until P2.

## Gate (V1's stored F2 and CR-07 results)

`compare.ts <F2-… CR-07…> --no-write` over V1's 90 F2 and 7 CR-07 stored results:

| Tree | Match | Left |
|---|---|---|
| working tree | 77/90 F2, 7/7 CR-07 | F2-ID1, -ID2 (P1/P2), F2-TS1, -TS2, -FS1, -FS2, -FS2b, -ME1, -AT1, -AT2, -AT3, -AT4 (E2 volatiles: P5), F2-PR2-champions (P10, P11) |
| with P1–P11 (scratch copy) | 90/90 F2, 7/7 CR-07 | none |

Over all 1932 stored cases, P1–P11 change no matching case and make 17 more match (the F2 above and IN-PRT-01, -01b sv and
champions). `golden-1v1 --check`: 254 byte-equal, with and without the patches.

Stored expectations A2 makes stale (all match a fresh oracle run, `a2/run.ts <ids> --stored`): R02, R03, R07, S39b, S39d,
S48-Soak-before, S48-Soak-last, S48-Attract-before, S48-Attract-last, S48-Roost-flying, RT-RV05 (V1 re-stores them).

Scratch cases (`a2/cases-a2.ts`, 98, run by `a2/run.ts` with V1's oracle and compareCase): 82 match in the working tree; the 16
left are P1–P9's (ID1, ID3, EL8, ATE1, C22, AT3, TS4, ME4, PW4, HB1, EM5, EM7), A3's Gravity start (GR1), the oracle's own
limit (EM6, V1 below), and two that are not A2's: ME3 and X1 (below). With the patches and A3's Gravity line every A2 case
the oracle runs matches. EM7 (a carried Embargo on a Quick Claw holder: the order still has the Claw) is wrong as it stands,
as it was before A2 (Step 1's tree gives the same); P9 is its fix.

## needsFromIntegrator (frozen files; exact text in `a2/integrator-patches.py`, run on a copy by `a2/kt.sh`)

| Patch | File | Change | Tests that pass after it |
|---|---|---|---|
| P1 | doubles-turn.ts usedRow | Electrify / Ion Deluge give `context.retype` (the kernel's type reads) | family2 P1 ×3; F2-ID1 |
| P2 | doubles-turn.ts resolveTargets, redirect; doubles-status.ts targetsOf, Curse | status-move redirection by the use's type; the `ateRedirectGuard` call goes | family2 P2; F2-ID2 |
| P3 | doubles-status.ts readsLastMove | `|| id === "conversion2"` | family2 P3 |
| P4 | doubles-turn.ts conditionFacts | `...typingHooks.conditions(kernel, w, slot)` | family2 P4 |
| P5 | doubles-turn.ts outcomeOf | `...typingHooks.outcomeVolatiles(kernel, world, slot)` | family2 P5; 10 F2 E2 cases |
| P6 | doubles-status.ts statusMove early branch | `typingHooks.powderTryMove` before `earlyBranch` | family2 P6 |
| P7 | doubles-turn.ts absorbEffect | Heal Block: the hit's mass `blocked` → `noDamage` | family2 P7 |
| P9 | doubles-turn.ts hitReactions, fractionalOutcomes, validate | `itemWorks` for Eject Button / Red Card; no order item while `itemSuppressed`; a carried Embargo lets an Assault Vest holder use a status move | family2 P9 ×2 |
| P10 | doubles-turn.ts validate, calculateDoublesMoves | drop validateBuild's used-Protean issue (N's typeUnknown or SPEC2's types read it) | family2 P10 ×2; IN-PRT-01, -01b |
| P11 | engine-corrections.cjs getStabMod wrapper + calculate.ts engineMarks `proteanSpent` | a used Protean / Libero (gen 9, Champions) adds no STAB of its own | family2 P11; F2-PR2-champions |

With them: delete `tests/unit/doubles-typing.test.ts`' block "the guards that stay until the integrator's P1–P3" (3 tests);
status2-hooks.test.ts' `ateRedirectGuard` row after P2 (and the empty `ingrainGuard`, `magnetRiseGuard`, `psychicNoiseGuard`
with their calls when convenient); REASONS `typeChange` / `groundingChange` have no caller left (doubles-status.test.ts still
pins their texts). doubles-status-moves.test.ts kinds: A2 moves 22 rows from L (18 to M, 4 to C). tests/unit/doubles-turn-
fixes.test.ts R02, R03, R07 expect the removed typeChange reason: they are now estimated and match the oracle (re-point them
to the stored results). P4 adds "Type: …" and "Infatuated." condition facts to cards (no stored number changes).

Not A2's (found on the way): a super-effective hit that faints a Weakness Policy holder: E2 says the Policy was used and +2/+2
in the fainted outcomes (Showdown: useItem fails at 0 HP). A2-X1-sv and A2-ME3-usum reproduce it (uses-to-ko.ts trace).

## needsFromOthers

- A3: Gravity's start (doubles-field.ts fieldMove) calls `typing.gravityGrounds(kernel, w, each)` for each living Pokémon
  (PS gravity onFieldStart ends Magnet Rise and Telekinesis): A2-GR1-usum, family2 "A3's Gravity start". Snatch: A3's I3 and
  I4 are compatible with `proteanGuard`'s own snatched-use check (A2-SN1-usum matches with and without them).
- Owner of calculate.ts: P11b (`engineMarks` sets `proteanSpent` for a used Protean or Libero in sv and champions), with P11a.
- V1: the oracle's turn request is made before the carried state (a carried Embargo leaves an Assault Vest holder's status
  moves disabled: A2-EM6-usum fails in the oracle); Conversion's move slots (the harness puts the action's move first, so
  Conversion's own type is the only first move a case can give); `lastMove` for Conversion 2 (lastMoveUsed); re-store the
  stale stored cases above.
- E1: done (Nightmare, Octolock, the Telekinesis / Heal Block / Embargo countdowns, Psychic Noise's two turns).

## Tools (`a2/`)

`run.ts` (oracle + app + compareCase; `--cached`, `--stored`, `--show`), `cases-a2.ts`, `integrator-patches.py`, `kt.sh` (a copy
of app/lib/battle with the patches; tsx through TSX_TSCONFIG_PATH), `a2-patched.config.mts` / `a2-base.config.mts` (vitest on
the patched copy / on A2's Step 1 state), `ab.sh`, `base-table.py`, `gen-status-table-a2only.ts`, `learners.ts`, probes.
