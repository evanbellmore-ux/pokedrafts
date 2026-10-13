# Review 2, round 1: the fixer's notes

The review fixer of ADDENDUM2 §8.8, round 1. Each pass appends its part here.

## Pass A: R1-A1K-01..05, R2-A2A3-H-1/-2, R3-1..R3-6

### Where it started

A previous run of this fixer was cut off by a usage limit. Its edits are in the WIP checkpoint f0f695e. Its task list said
R1 and R2 were finished and R3 was in progress. It left no notes and stored no oracle cases.

This pass did the following:

- Checked every R1 and R2 edit by re-running its reviewer's and verifier's probes. The app now matches the oracle in each.
- Added the regression tests that were missing (R1-A1K-01, -02, -03 and -04's positive case).
- Reviewed and finished the partial R3 edits.
- Did R3-5 and R3-6.
- Stored every finding's turns as oracle cases.

The before set is `$SP/reviews/FIX-r1/app-results-before`, taken before any review fix and left unmodified.
`$SP` = `/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad`. This pass's probes and logs are in
`$SP/fixA`: `probes.ts` and `run.ts` (oracle and app), plus the logs named below.

### The findings

| Id | Outcome | Fix | Files | Test | Cases (RV2-…) |
|---|---|---|---|---|---|
| R1-A1K-01 | fixed (in f0f695e; checked) | `shielded` is `abilityshield && !magicRoom && !itemSuppressed`. That is pinned hasItem for an ignoreKlutz item (`data/items.ts:2-17`, `sim/pokemon.ts:885`): Klutz does not stop the Shield, Magic Room and Embargo do. The docstring says so. | doubles-abilities.ts | doubles-stats-abilities "review 2 R1-A1K-01 (K1-KLUTZ-SHIELD)": Skill Swap (Body Slam 81–96), Simple Beam (−1 Sp. Atk), Gastro Acid. It fails on the old check. | K1-KLUTZ-SHIELD, -SBM, -GA, V1-KS-WS, V1-KS-CTRL (sv only: Ability Shield is a generation 9 item, and no other catalog has it) |
| R1-A1K-02 | fixed (in f0f695e; checked) | setAbility takes `actingBreaker`. With no use, `changeOf`'s breaker is `(holder !== user \|\| gen < 8) && !shielded`. doubles-reactions `knockingBreaker`: the acting move's user when its ability is in MOLD_BREAKERS, the move is in IGNORE_ABILITY_MOVES, or it is Mycelium Might on a status move (`sim/battle.ts:365-368`, the faint batch inside the move at `sim/battle-actions.ts:974`). It covers allyFaint's receive and spreadUser's stashed receive. There is none at the end of turn (kernel.acting null). | doubles-abilities.ts, doubles-reactions.ts | doubles-reactions "sv: Receiver inside a Mold Breaker or Teravolt user's knocking move…": Iron Head, Teravolt and Rock Slide give −1, the Garchomp control keeps Clear Body (50–59). It fails without the breaker. | K2-RC-MOLD (sv, swsh, usum, champions), -CTRL, -MA, V2-RC-GD, V2-RC-SPREAD (sv, champions), V2-RC-TERAVOLT (sv, swsh) |
| R1-A1K-03 | fixed (in f0f695e; checked) | entry(): every Pastel Veil holder in play that is not a newcomer gets an onAnySwitchIn handler (priority 0, subOrder 7, its Speed). `pastelVeilAgain` runs A1's Start again and puts the cure fact on the cause (**Pastel Veil: Snorlax (yours) is cured of its poison.**). The comment that lists the onAnySwitchIn handlers is updated. | doubles-switch.ts | doubles-switch "Pastel Veil's onAnySwitchIn…": a poisoned newcomer on its own side, and a badly poisoned one on the opponent's side. It fails without the handler. | K1-PASTEL-NEWCOMER, -NEWCOMER2, V3-PV-TOX (swsh only: no other catalog has Pastel Veil) |
| R1-A1K-04 | fixed (in f0f695e; this pass added the positive test and the docs) | The `transformMax` reason and REASONS.transformMax are removed, along with the docstring clause. The docs drop the line from the not-estimated list. There is no Gigantamax reason either: pinned keeps the base species. | doubles-abilities.ts, doubles-actions.ts, docs | doubles-stats-abilities "review 2 R1-A1K-04 (K1-TRF-DMAX-swsh)": the Body Slam into Ditto is 42–49 and Ditto ends at 74–81. "the narrow texts" asserts the reason is gone. | K1-TRF-DMAX, V4-TRF-DMAX-SPD, V4-TRF-GMAXK (swsh only: Dynamax) |
| R1-A1K-05 | fixed (in f0f695e; checked, with more probes) | spreadRetaliation puts its loss on World.spread as a `SPREAD_LOSS` marker. spreadStep and drainingStep add it to the first loss group with Rough Skin and Rocky Helmet, before the Update after the hits, so the faint and the Berry come from `settle`. The reason stays only where the Innards Out HP differs between entries. | doubles-reactions.ts, doubles-spread.ts | doubles-reactions K-IO-05: the Innards Out Rock Slide with a Sitrus is ready (178), and Aftermath's 45 then the Sitrus is 110. | K2-AF-BREAKING, K2-RH-BREAKING, K2-AF-BREAKING-NOBERRY, V5-AF-BREAKING-SW, V5-IO-BREAKING, V5-IO-BREAKING2, PA-AF-SPREAD-KO (the loss knocks the user out), PA-AF-RH-SPREAD (sv, swsh: Rocky Helmet + Aftermath cross the line together), PA-IO-SPREAD-KO (swsh, usum) |
| R2-A2A3-H-1 | fixed (in f0f695e; checked) | defog() clears `{target side, user side}` (`data/moves.ts:3463, 3470`; gen 7 `data/mods/gen7/moves.ts:125-145`). `landed` reads those sides. The fact names the side by the user when it is one side (**Defog: the hazards on Corviknight's side are cleared.**). | doubles-field.ts | doubles-field-side-items "status2 R (integration 2): the hazards from before the turn…" (review 2 lines): the ally Defog fact, E2 hazardsFrom, and no fact when only the foe side has hazards | RA-DEFOG-ALLY (sv), RA-DEFOG-ALLY7 (usum), V-DEFOG-SPK (sv, swsh), V-DEFOG-FOE (sv), V-DEFOG-BOTH (usum) |
| R2-A2A3-H-2 | fixed (in f0f695e; checked) | `cureBench` (doubles-world.ts) sets benchCured. It also cures every World.benched entry still out with HP, dropping its sleep, freeze and toxic counters. teamCure and G-Max Sweetness call it. newcomer() enters an input bench member with no status when benchCured is set. A Pokémon skipped while active (Soundproof…) is not touched. | doubles-world.ts, doubles-field.ts, doubles-max.ts, doubles-switch.ts | doubles-switch "a party cure reaches the bench…": a Heal Bell newcomer, and a leaver dragged back in | RA-HB-BENCH (sv, usum, champions), RA-AT-BENCH (swsh), RA-GMAX-SWEET-BENCH (swsh), V-HB-TOX (sv), V-HB-BRN (usum), V-HB-CTRL (sv), V-HB-OPP (sv), V-SWEET (swsh), V-HB-CHAMP (champions). The leaver-back turn (FX-HB-BACK) cannot be stored: the oracle says "Ambipom came in a second time this turn: not followed by the oracle". Its unit test covers the app side. |
| R3-1 | fixed (in f0f695e; checked, plus a test) | doubles-start itemsOf: a carried `berryLocked` with Berserk or Anger Shell (the entered ability, so not under Neutralizing Gas's stand-in) and a BERSERK_BERRIES item is hidden from settleItems and put back after (`data/abilities.ts:150-155, 421-426`). | doubles-start.ts | doubles-guards-lock "RD-BZK-START-sv": start and end 70 | RD-BZK-START (sv, swsh, usum), V1-AS-START (sv), V1-BZK-ORAN (usum) |
| R3-2 | fixed (in f0f695e; checked, plus a test) | doubles-guards `berryTakenFirst`: Bug Bite, Pluck and Incinerate into a Berry, and Thief or Covet from an itemless user, take the real item before the hit's Update, so there is no Leftovers stand-in (`searchFor` opts `berryTaken`). This covers singleStep and spreadStep. Sticky Hold, unless broken, keeps the stand-in. uses-to-ko follows the attacker's HP for a taken HP or pinch Berry. Two narrow reasons are kept. **Magician** takes the item at AfterMoveSecondarySelf, after the hit's Update, where the step holds the stand-in (REASONS.combo). **Thief or Covet** stays not estimated where a Rough Skin or Iron Barbs loss could knock the user out before AfterHit. | doubles-guards.ts, doubles-turn.ts, doubles-spread.ts, uses-to-ko.ts | doubles-guards-lock "RD-BZK-THIEF2-sv / RD-BZK-BUGBITE2-sv / RD-HB-BUGBITE-sv" (108, 136, 36–50, 136) and "FX-MAGICIAN-LOCK-sv" (the reason) | RD-BZK-THIEF, -THIEF2, -BUGBITE, -BUGBITE2 (sv, swsh, usum), RD-HB-BUGBITE (sv, usum), V2-PLUCK-HB (sv), PA-PLUCK-ZERK (swsh, usum), FX-THIEF-PLAIN (sv), FX-COVET-LOCK (sv, usum), FX-INCIN-HB (swsh, usum), PA-THIEF-STICKY-HB (sv), FX-MAGICIAN-LOCK (sv, notEstimated) |
| R3-3 | fixed with a fact reason (in f0f695e; checked, plus a test) | Turn mode: when the attacker's own Starf is eaten at a hit's Update before its last landed hit, the turn is not estimated: **Starf Berry between the hits of Double Kick is not modelled in 2v2.** This is the finding's own interim fix. Exactness would need the hit loop (uses-to-ko.ts / hit-loop.ts walkHits) to branch over the random stat between hits. Only the attacking stat's +2 (1/5) changes the later hits, but the hit loop has no per-hit world split. A Starf after the last hit keeps starfRise. | uses-to-ko.ts, docs | doubles-guards-misc "RD-STARF-MULTI-sv…": the reason, with the Low Kick and Liechi controls ready | RD-STARF-MULTI (sv, swsh, notEstimated), RD-STARF-TGT, V3-LIECHI-MULTI, V3-STARF-SINGLE (sv) |
| R3-4 | fixed with a fact reason (guard in f0f695e; narrowed this pass) | doubles-guards `parentalOhkoGuard`: Parental Bond's one-hit KO move into a target its first hit leaves standing is not estimated: **Fissure with Parental Bond is not modelled in 2v2.** The first hit leaves it standing behind a Substitute, a working Focus Sash or Focus Band, an intact Disguise or Ice Face, or Endure. This is the finding's own alternative. This pass skips the guard when ohkoStep's immunities stop the move (PA-OHKO-PB-IMMUNE: a Flying Sash holder was needlessly not estimated). Exactness would need the calculation's one-hit KO row (calculate.ts ohkoDamage, one fixed hit) to be a two-hit row through uses-to-ko's hit loop, the Substitute part and the face path. Only USUM's Mega Kangaskhan has both, with Fissure (a Virtual Console transfer): `$SP/fixA/pb.ts` lists every Parental Bond learner of an OHKO move in the four catalogs. | doubles-guards.ts, doubles-turn.ts, docs | doubles-guards-misc "review 2 R3-4…": the Sash reason, no saver gives a KO of 1, the immune target is ready | RD-OHKO-PB, -DISGUISE, -SUB, PA-OHKO-PB-BAND (notEstimated), PA-OHKO-PB-PLAIN, PA-OHKO-PB-IMMUNE (usum only) |
| R3-5 | fixed | The flung-Custap guard and REASONS.flungCustap are gone. Pinned `custapberry onEat() { }` (`data/items.ts:1235-1256`), and FractionalPriority is read only as an action is queued (`sim/battle-queue.ts:249`). The flungBerry docstring and the docs say so. | doubles-guards.ts, doubles-actions.ts, docs | doubles-guards-fling "review 2 R3-5 (RD-FLING-CUSTAP-sv)": the eat fact, Body Slam 75–88, and Cheek Pouch ready | RD-FLING-CUSTAP (sv, swsh), V5-CUSTAP-IDLE, -POUCH, -POUCH-IDLE, -AFTER (sv). Champions has no Custap Berry. |
| R3-6 | fixed | encoreRewrites raises REASONS.encoreChange only where pinned's kept values are read. The step otherwise uses the encored move's own priority and Prankster flag. (1) The priority as used and the encored move's own priority lie on different sides of 0.1, there is no gen 7 frozen priority (the step already reads the queued one), and a reader is in play (`encorePriorityRead`): Quick Guard on a side, Psychic Terrain, or an Armor Tail, Dazzling or Queenly Majesty holder. (2) Outside Champions from gen 7, a Prankster user whose queued and encored moves differ in being Status (pinned keeps pranksterBoosted, `sim/battle-actions.ts:225-233`; hitStepTryImmunity reads it) with a Dark-type foe in play. Before this, an attack inheriting the boost was ready and wrong even at an equal priority. (3) Champions keeps the old rule on any priority difference: its Encore moves the queued action as it starts (`data/mods/champions/moves.ts` encore onStart). Each reader probe fails without the reason: 31–36 mismatches, or 14 for Prankster (`$SP/fixA` NOGUARD run). | doubles-guards.ts, docs | doubles-guards-misc "review 2 R3-6…": RD-ENC-PRIO ready (66–78 and 81–96 at 1/2 each); the Quick Guard, Armor Tail and Psychic Terrain reasons; USUM's Quick Guard ready; the Prankster reason, and no reason without a Dark foe | RD-ENC-PRIO (sv, swsh, usum), V6-ENC-NOPRIO, PA-ENC-NOREADER (sv, usum), PA-ENC-QG (usum ready; sv notEstimated), PA-ENC-PT (sv, swsh), PA-ENC-AT (sv), PA-ENC-PRANK (sv, usum; notEstimated), PA-ENC-PRANK-NODARK (sv) |

No finding was wrong on closer reading. Each reviewer's and verifier's repro probe now gives the oracle's answer, except
where a fact reason is kept as above:

- `R1-A1-K-r1/run-probes.ts`: 12/12. The verifier's set is 75/80; the other 5 are malformed inputs, not findings: K1-TRACE-DEF, K1-TRF-FOCUS, K1-MIST-INT-MA, V1-EMB-SHIELD (Embargo is not in SV) and V4-TRF-GMAX (G-Max Replenish's own reason).
- R2: `R2-A2A3-H-r1/run.ts` 7/7 and the verifier's 10/10.
- R3: `R3-DE-F-r1/run.ts`: every R3-1/-2/-5/-6 probe matches, and R3-3/-4 give their reason. The verifier's set is all ready and matching, except V2-COVET (Lopunny is not in SV: an input issue).

### Stored cases

`scripts/.cache/calc-audit/2v2/verify/cases-review2.ts` is new, LF like cases-r.ts. It is wired into `cases-wave2.ts` as
WAVE2_CASES `[...R_CASES, ...REVIEW2_CASES]`, with OWNER_2 `/^RV2-/` → "review2 fixer".

- 110 cases: 97 estimated and 13 notEstimated (FX-MAGICIAN-LOCK, RD-STARF-MULTI ×2, RD-OHKO-PB ×3, PA-OHKO-PB-BAND, PA-ENC-QG-sv, PA-ENC-PT ×2, PA-ENC-AT, PA-ENC-PRANK ×2).
- Oracle first: `v3/run.ts RV2- --oracle --shard=i/4` (i = 0…3) wrote `results/RV2-*.json` (97). Logs `$SP/fixA/oracle-{0..3}.log`: 28 + 28 + 27 + 27 = `110/110` match.
- `sim-dfs.ts <the 97 ids> --exact --validate --out=$SP/fixA/validate` (`validate-{0..3}.log`) gives 291 `equal to N whole-turn replays` lines (97 × 3 walks) and none that differ. The validated results equal the stored ones (`97 equal, 0 differ`, ms, warnings and runs aside).
- App side: `v3/run.ts RV2- --store --quiet` gives `110/110 cases match.`, written to `app-results/RV2-*.json`.

Not stored: PA-BZK-START-GAS. Under Neutralizing Gas its numbers agree, but its E2 `berryLocked` differs: the oracle keeps
checkedBerserk false and the app clears it. That is outside these findings (see open).

### Gates (pass A, final tree)

`git branch --show-current` printed `calc-2v2-status-2` before and after. Each line is as printed; logs are in `$SP/fixA`.

1. `npx tsc --noEmit`: exit 0, no output. The first run caught a test type error, which is fixed.
2. `npx eslint` on the 19 app and test files changed since 3938e5a: exit 0, no output.
3. `npx vitest run --config vitest.unit.config.ts tests/unit/doubles-*.test.ts`: `Test Files  43 passed (43)` / `Tests  3339 passed | 1 skipped (3340)`.
4. `npx vitest run --config vitest.unit.config.ts tests/unit/training-*.test.ts tests/unit/calculator-doubles-*.test.ts tests/unit/status2-*.test.ts`: `Test Files  74 passed (74)` / `Tests  1069 passed (1069)`.
5. `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts` writes app-results and `results/compare.json`: `2055/2055 cases match.` That is the 1945 cases that loaded at integration 2 plus the 110 RV2 cases; the 544 stub ids are not run.
6. `changed-cases.ts diff $SP/reviews/FIX-r1/app-results-before verify/app-results --wave=all`: `2055 cases: 1945 unchanged, 0 stored cases changed, 0 failing the gate.` `int2/tools/app-diff-facts.mjs` over the same two sets gives `2622 files: 0 changed, 110 new`, the new ones being the RV2 cases. No case outside them changed its app result.
7. `v3/run.ts --wave2 --quiet`: `286/286 cases match.`, the same with `STATUS2_REEXPECT=1a,1b`. That is 176 wave 2 + 110 RV2.
8. `v3/run.ts A1- K- FS G4-ENC G4-BZK G4-SFL G4-OHK G4-FLG D- INT-IO SAT- T2P-RC FX- --quiet` (the touched families) gives `249/252 cases match.` The 3 are G4-SFL-01-champions, FX-CR-06-sv and FS08e-sv, whose reasons waves 1a and 1b removed, so they need STATUS2_REEXPECT. With `STATUS2_REEXPECT=1a,1b` it gives `252/252 cases match.` Every case with `STATUS2_REEXPECT=1a,1b v3/run.ts --quiet`: `2055/2055 cases match.`
9. `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal (8830 ms)`.
10. Harness tests (`v3/vitest.v3.config.mts`): `Tests  1 failed | 24 passed (25)`. The one failure is the stub's `no case ZS16`, as before.

### Open (pass A)

- `tests/unit/doubles-turn-showdown.test.ts` is not regenerated, so the RV2 cases are not in it yet. Regenerate it with `gen-tests.ts --keep-rows` at the next integration. Its 282 stub rows are untouched.
- PA-BZK-START-GAS (above): under Neutralizing Gas, the app's E2 drops a carried Berserk lock that pinned keeps. The numbers agree.
- R3-3 and R3-4 keep a fact reason, as the findings allow. Exactness needs a per-hit branch in the hit loop (Starf) and a two-hit one-hit KO row (Parental Bond).
- Two narrow R3-2 reasons are kept: Magician, and Thief or Covet that a Rough Skin or Iron Barbs loss could knock out first.

## Pass B: R4-1..R4-6 (the S/W/M reviewer's findings)

This pass's probes, logs and scratch files are in `$SP/fixB`. Before any edit, the reviewer's `R4-SW-M-r1/run-r4.ts` gave
67/87 (`r4-before.log`), the same set the review reported.

### The findings

| Id | Outcome | Fix | Files | Test | Cases (RV2-…) |
|---|---|---|---|---|---|
| R4-1 | fixed | spreadStep's attacker-HP probe is now the first unblocked target whose calculation reads the attacker's HP. Before, it was the first unblocked target, whatever its row. An intact face's row is the face's reason and has no search. Its hit's calculation reads the attacker the way the same hit into the busted form does, through the new `faceNs.faceSearch`, which is faceProbe's own search, memoised. The world is split by that search's `attackerHPClass`, as before. The face target then takes the part's HP (R4-5). | doubles-spread.ts, doubles-faces.ts | doubles-faces "review 2 (R4-1, R4-5)… R4-1". The face is at opponent-right, Showdown's p2a. Eruption at 77 HP gives the Snorlax 16–19 (216–219). Blaze Heat Wave at 30 HP gives 31–37 (sv, usum). Water Spout at 100 HP gives 22–27 (swsh). The test fails on the old code. | R4-S-ERUPTKYU (sv), R4-S-SPREADBLAZEKYU (sv, usum), R4-S-SPREADROWAPLO (sv), V1-WSPOUT (usum, swsh), R4-S-ERUPTKYU2 (sv, the control with the face at opponent-left). The verifier's V1-WSPOUT-sv/-CTL-sv are malformed: Wailord is not in SV. |
| R4-2 | fixed with a fact reason | finaleGuard adds a living foe holding Gulp Missile in its Cramorant-Gulping or Cramorant-Gorging form: **G-Max Finale with Cramorant-Gulping's Gulp Missile is not modelled in 2v2.** This is the finding's "minimum". **Why exactness is out of reach:** Finale's heal is self.onHit (selfDrops, `sim/battle-actions.ts:1096`) and comes before DamagingHit (`:1121`). The pair's step, uses-to-ko.ts's hit loop, already applies the target's DamagingHit loss on the user, and maxEffects then heals the world after the step. Exactness needs the selfDrops heal inside that hit loop, between the damage and the user's loss. The existing reasons for Life Orb, Shell Bell, Jaboca, Rowap and Innards Out stay for the same reason. A Max Move never makes contact: getActiveMaxMove keeps the Max Move's own flags (`sim/battle-actions.ts:1494-1513`). So finaleGuard's contact branches cannot fire, and Gulp Missile (`data/abilities.ts:1745-1749`, no contact check) was the one missing DamagingHit source. | doubles-max.ts, docs | doubles-max "review 2… (R4-2)" checks both reasons. A base-form Cramorant is estimated: Alcremie 260 heals to the 280 cap, and Cramorant ends at 46–61. | R4-M-FINALEGULP, V2-FINALEGORGE (swsh, notEstimated); PB-FINALECRAM (swsh, the control). Dynamax exists in SwSh only. |
| R4-3 | fixed with a fact reason | maxEffects' new `orderGuard` raises a reason in two cases. (1) G-Max Foam Burst's −2 Speed meets the target's own Speed rise in DamagingHit: Weak Armor on a physical move (`data/abilities.ts:5451`), Steam Engine on a Fire or Water move, or Rattled on a Bug, Dark or Ghost move. (2) A Max Move's Speed rise on the user's partner (Max Airstream) meets the target's Cotton Down (`:734`). The partner's Contrary and Simple are read, and a Mirror Armor partner sends the drop back. The reason fires only where a ±6 cap makes the order matter. `capOrder` checks every stage before the step that gives the stage after it, and asks whether the two orders end apart. The texts are **G-Max Foam Burst with Skarmory's Weak Armor is not modelled in 2v2.** and **Max Airstream with Eldegoss's Cotton Down is not modelled in 2v2.** There is no reason where the Substitute took the hit alone (subOnly passes `behindSubstitute`, since there is no DamagingHit). Same-direction pairs need no reason, because both orders give the same stage: Max Strike's −1 and Cotton Down's −1 on the other foe, and Defiant. The target's own Max drop and the user's own rise are already in the step's order; R4-M-STRIKEWA and V3-AIRCOTTONSELF agree. **Why exactness is out of reach:** the stages and the G-Max effects of the self.onHit (`:1096`) would have to run inside the pair's step, before the target's reactions. The step keeps neither the reaction's unclamped change nor the state before it. | doubles-max.ts, doubles-substitute.ts, doubles-turn.ts (the kernel's maxEffects `opts`), docs | doubles-max "review 2… (R4-3)" checks the reasons at +5 and +6 (Foam Burst) and at +6 and −6 (the partner, Max Airstream). Away from the caps the turns are estimated. Skarmory at Speed 0: 58–71, Speed 0 and Defense −1. The partner: Speed 0, and the other foe −1. Max Strike into +5 ends at +6. The user at +6 ends at +5. | R4-M-FOAMWA, V3-FOAMWA6, R4-M-AIRCOTTON, V3-AIRCOTTONLOW (swsh, notEstimated); PB-FOAMWA0, PB-AIRCOTTON0, V3-AIRCOTTONSELF, V3-STRIKEWA5 (swsh controls). R4-M-FOAMWAORDER gets FOAMWA's reason. |
| R4-4 | fixed | useCalled gives a called damaging move's action the priority it is used with as `PendingAction.calledPriority`. That is the caller's priority: gen 7's frozen one, else priorityOf the caller's action. This follows `sim/battle-actions.ts:410-411` (move.priority = activeMove.priority). W's frozenContext returns it first, as `MoveContext.frozenPriority`. calculate.ts usedPriority then applies it to the partner shields (`data/abilities.ts:872`: move.priority > 0.1) and to Psychic Terrain (`data/moves.ts:14116-14117`). A frozen priority also turns off Grassy Glide's +1 and its "Grassy Glide: +1 priority." assumption. Only a called Grassy Glide reaches this: no queued move has both a frozen priority and Grassy Glide. | doubles-world.ts, doubles-turn.ts, doubles-pairs.ts, calculate.ts | doubles-calling "review 2 (R4-4)…". A full-HP Gale Wings Talonflame's called Brave Bird hits the Dazzling Bruxish (sv, usum) or the Armor Tail Farigiraf (sv) for 76–91, with recoil (123–128). A Prankster Whimsicott's called Moonblast meets Psychic Terrain (sv, usum): no damage. | R4-W-SLPTALKGW (sv, usum), V4-SLPTALKAT (sv), R4-W-SLPTALKPT (sv, usum), R4-W-SLPTALKPR (sv, the control: the kernel's own shield already read it) |
| R4-5 | fixed | neutralRow takes the attacker's HP and sets `currentHP` from it, as searchFor does (baseHP: a Dynamax HP scaled back, null at full). faceHit and faceAfterSub split the world by the attacker-HP classes the face hit's calculation reads (`byAttacker`, through faceSearch). A spread step passes its part's HP (`FaceHitOptions.attackerHP`), or the maximum when it reads none. | doubles-faces.ts, doubles-spread.ts | doubles-faces "review 2 (R4-1, R4-5)… R4-5". The face hits: Eruption 33–40, Water Spout 24–28, Blaze 79–94 (sv, usum), Overgrow 75–88, Water Shuriken 26–80. Behind a 20 HP Substitute, the hits after the break come to at most 3 × 16. The harness compares no hit.min/max for a case with a Substitute record, so the Torrent per-hit 13–16 is the anchor. | R4-S-BLAZEKYU1 (sv, swsh, usum), R4-S-TORRENTKYU (sv), V5-OVERGROWKYU (sv), PB-TORRENTSUBKYU (sv), and the spread cases above |
| R4-6 | fixed | W's stepEnv asks the stopped step for `report.dealt` where the move has recoil or the user holds a working Shell Bell (`readsTotal`). applyStep keeps stopped outcomes with different damage so far apart. continueHits passes `TurnStepPart.dealt` (the damage of the earlier parts) and drops `info.recoil \|\| shellBell` from the reason. The user-fainted corner keeps it. The continuation's recoil (afterHitsLosses) and Shell Bell read dealt plus the part's own hits, once, as move.totalDamage does (`sim/battle-actions.ts:965, 981-982`; `data/items.ts:5653-5655`). The node memo key carries the part's dealt. searchFor now merges a hook's report with PR's last-hit report instead of replacing it. | doubles-pairs.ts, doubles-turn.ts, uses-to-ko.ts | doubles-pairs "review 2 (R4-6)…" replaces W-BEX-01/-02's pinned reasons with the oracle's numbers. Double-Edge: 116–125. Take Down: 143–149. Shell Bell Dual Wingbeat: 108–110 (sv, swsh). Shell Bell Double Hit: 68–69. W-BEX-03 (Rough Skin knocks the user out) keeps its reason. | R4-W-GANLONSB (sv, swsh), R4-W-PBRECOIL (usum), V6-PBTAKEDOWN (usum), V6-DHSB (sv). Champions has no Ganlon, Apicot, Starf or Lansat Berry. |

No finding was wrong on closer reading. Each new test fails on the pre-fix sources. I checked this by putting HEAD's versions of
the 8 changed source files back and running the four test files: `Tests  7 failed | 103 passed (110)`, the 7 being the new tests.

The reviewer's probes after the fixes (`R4-SW-M-r1/run-r4.ts`, `$SP/fixB/r4-after.log`) give `78/87 cases match.` The other 9
are as follows:

- 5 give this pass's fact reasons: FINALEGULP, FINALEGULP2, FOAMWA, FOAMWAORDER and AIRCOTTON.
- 3 are the review's malformed inputs: COUNTER, COPYGW and SPREADBLAZESLOWKYU.
- 1 is the review's harness convention: G-Max Snooze.

The verifier's probes (`run-v.ts`, `$SP/fixB/v-after.log`) give `10/15`. The other 5 are as follows:

- 3 give the reasons: V2-FINALEGORGE, V3-FOAMWA6 and V3-AIRCOTTONLOW.
- 2 are malformed: V1-WSPOUT-sv and V1-WSPOUTCTL-sv, because Wailord is not in the SV catalog.

### Stored cases

`cases-review2.ts` has a pass B section with 35 cases: 29 estimated and 6 notEstimated. REVIEW2_CASES now holds 145. The
wiring is unchanged (cases-wave2.ts, OWNER_2 `/^RV2-/` → "review2 fixer").

- I ran the oracle first: `v3/run.ts <the 29 ids> --exact --oracle-only --shard=i/4`, logs `$SP/fixB/oracle-{0..3}.log`. It wrote
  `results/RV2-*.json` for every estimated case. A Champions Parental Bond case was dropped because Champions has no Ganlon
  Berry, so the app refused the input.
- `sim-dfs.ts <ids> --exact --validate` gives `equal to N whole-turn replays` for all three walks on 25 of the 29: 75 lines,
  none that differ. The logs are `$SP/fixB/validate-{0..3}.log` and `validate-extra2.log`. The validated results equal the stored
  ones: `25 equal, 0 differ` (`$SP/fixB/valcmp.mjs`, ms, warnings and runs aside).
- The four Sleep Talk cases cannot be validated: R4-W-SLPTALKGW-sv and -usum, V4-SLPTALKAT-sv and R4-W-SLPTALKPR-sv.
  sim-dfs's replay walk stops at its cap: `RV2-R4-W-SLPTALKGW-sv FAILED: Error: over 200000 runs` (walkReplay). SLPTALKGW-usum
  and SLPTALKPR-sv stop the same way. SLPTALKAT-sv is the same turn with Armor Tail Farigiraf (45090 DFS runs). I stopped its
  replay after 38 minutes, before it reached the cap. The asleep user's sleep counts, Sleep Talk's pick and the random target
  each branch every whole-turn replay. Their stored results are the exhaustive DFS oracle's (`--oracle-only`, 25k–45k runs), as
  for every case. The app agrees with them, and their HP and hit numbers equal the reviewer's and verifier's independent
  oracle runs (`R4-SW-M-r1/out/R4-W-SLPTALK*.oracle.json`).
- App side: every case through `STATUS2_REEXPECT=1a,1b v3/run.ts --store --quiet` (below). That wrote `app-results/RV2-*.json`.

### Gates (pass B, final tree)

`git branch --show-current` printed `calc-2v2-status-2` at the start and at the end. Each line below is as printed; the logs are
in `$SP/fixB`.

1. `npx tsc --noEmit`: exit 0, no output.
2. `npx eslint` on the 13 app and test files this pass changed: exit 0, no output.
3. `npx vitest run --config vitest.unit.config.ts tests/unit/doubles-*.test.ts`: `Test Files  43 passed (43)` / `Tests  3346 passed | 1 skipped (3347)`.
   A first run was made while the four validate processes held every CPU. In it, W-ALE-01 hit the 5 s test timeout and the
   Moves-pane perf budget failed. Both pass on the quiet rerun above.
4. `npx vitest run --config vitest.unit.config.ts tests/unit/training-*.test.ts tests/unit/calculator-doubles-*.test.ts tests/unit/status2-*.test.ts`: `Test Files  74 passed (74)` / `Tests  1069 passed (1069)`.
5. `npx vitest run --config vitest.battle-data.config.ts tests/source/status2-hooks.test.ts`: 8 passed. The two source tests that
   need the compiled pinned dex (`doubles-substitute-census`, `doubles-spread-reactions`) cannot load here:
   `showdown-dex-c23d2e94…/data/abilities.js` is missing in this container (`npm run data:champions`). That is an environment
   gap, not a test result.
6. `STATUS2_REEXPECT=1a,1b v3/run.ts --store --quiet --shard=i/2`: `1045/1045 cases match.` twice, so 2090/2090. That is the 2055
   cases of pass A plus the 35 new ones; the 544 stub ids are not run.
7. `STATUS2_REEXPECT=1a,1b compare.ts` (writes `results/compare.json` and the app results): `2090/2090 cases match.`
8. `changed-cases.ts diff $SP/fixB/app-results-passA verify/app-results --wave=all`: `2090 cases: 2055 unchanged, 0 stored cases changed, 0 failing the gate.`
   Against the round's before set (`$SP/reviews/FIX-r1/app-results-before`): `2090 cases: 1945 unchanged, 0 stored cases changed, 0 failing the gate.`
   `int2/tools/app-diff-facts.mjs` gives `2657 files: 0 changed, 35 new` (against pass A) and `0 changed, 145 new` (against
   the before set). No stored case's app result changed byte for byte.
9. `v3/run.ts --wave2 --quiet`: `321/321 cases match.` That is 176 wave 2 cases plus 145 RV2 cases.
10. `v3/run.ts T2M-FA T2M-FS T2M-SB T2M-SP T2M-ALE T2M-FB T2M-BE T2M-AR T2M-GW T2M-AS T2M-SG T2M-GM T2M-PS T2M-ST T2P-ST IN-SFG IN-STL-04 S48-PainSplit VE-F1-10 VE-F1-13 VE-H5-6 E40- --quiet`
    covers the S, W, M and CL families. It gives `107/118 cases match.` without STATUS2_REEXPECT. The 11 are older cases
    whose reasons waves 1a and 1b removed: E40-* and S48-PainSplit-dynamax. With `STATUS2_REEXPECT=1a,1b` it gives `118/118 cases match.`
11. `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal (17826 ms)`.
12. Harness tests (`v3/vitest.v3.config.mts`): `Tests  1 failed | 24 passed (25)`. The one failure is the stub's `no case ZS16`,
    as in pass A.

### Open (pass B)

- `tests/unit/doubles-turn-showdown.test.ts` is still not regenerated. The 145 RV2 cases go in with `gen-tests.ts --keep-rows`
  at the next integration. Its 282 stub rows are untouched.
- R4-2 and R4-3 keep narrow fact reasons. Exactness needs the Max Move's self.onHit inside the pair's step (uses-to-ko.ts hit
  loop), between the damage and the target's DamagingHit. That covers Finale's heal, the partner's and the other foe's stages,
  and the G-Max per-foe effects. The pre-existing Finale reasons (Life Orb, Shell Bell, Jaboca, Rowap, Innards Out) would go
  with the same change.
- finaleGuard's contact branches (Rough Skin, Iron Barbs, Rocky Helmet) can never fire, because a Max Move makes no contact. I
  left them in place; they are harmless.
- The four Sleep Talk cases above have no `--validate` cross-check. The replay walk's 200000 cap is below what their turns
  branch to.
- Two source tests cannot run in this container because the compiled pinned dex is missing (gate 5).

## Pass C: R5-1..R5-7 (the PR/CL/ST/FC reviewer's findings)

This pass's probes, logs and scratch files are in `$SP/fixC`: `probes.ts` and `run.ts` (oracle and app, sharded), the logs
named below, and `pre/` and `post/` (the changed sources before and after this pass). Before any edit the reviewer's runner
over the findings' probes gave `1/16 cases match.` (`r5-before.log`, the control R5-INS-PP3 the one match).

### The findings

| Id | Outcome | Fix | Files | Test | Cases (RV2-…) |
|---|---|---|---|---|---|
| R5-1 | fixed | afterHit keeps a dance's `target` mark on every hit that met its target, a Substitute's included (`hitAny`), not only on a landed one. Pinned `sim/battle-actions.ts:693` sets activeTarget in hitStepAccuracy, before the Substitute; `:334-340` aims an ally Dancer's copy at it. | doubles-presence.ts | doubles-presence "review 2 … R5-1 (RV2-R5-DAN-SUB)" (sv, usum): the copy's hit is on the Substitute's Snorlax, Volcarona keeps 160. | R5-DAN-SUB (sv, usum), V1-DAN-SUB (sv, usum), V1-DAN-SUB2 (sv) |
| R5-2 | fixed | A status dance's success is marked where its own effect is applied, as pinned's moveDidSomething is useMove's result (`sim/battle-actions.ts:304`, read at `:319`; runMoveEffects' didSomething from boost's success, `sim/battle.ts:2020-2083`, and addVolatile's). New `danceEffect` (presence), called by doubles-status.ts: a boost that changed a stage (`effects`, Clangorous Soul's onHit), Teeter Dance's confusion added (`volatile` true), Lunar Dance's user fainted (selfdestruct). That is before Defiant or Competitive, White Herb at AfterMove (`data/items.ts:7695-7697`) and a Persim or Lum Berry at the Update (`:4522-4526`). The net-state check (`danceState`/`danceDid`, read at afterAction) is gone; the `before` mark is now `dance` (a Dancer could copy it). Unchanged failures: a ±6 cap, Clear Body, Mirror Armor (the target's boost is emptied: null), Own Tempo, a confusion already up; a bounced or snatched use marks nothing. | doubles-presence.ts, doubles-status.ts | doubles-presence "R5-2 (RV2-R5-DAN-WH)" (sv, usum: Body Slam 36–43 after the copy's −2) and "R5-2 (RV2-R5-DAN-DEF, RV2-R5-DAN-TEETER)" (Defiant, Persim: copied; Mirror Armor, −6: no copy) | R5-DAN-WH (sv, usum), R5-DAN-TEETER, R5-DAN-DEF, PC-DAN-MIRROR, PC-DAN-CAP, PC-DAN-CLANG, PC-DAN-CONTRARY (sv; Contrary Swords Dance whose −2 its own White Herb restores: copied) |
| R5-3 | fixed (this turn's lock exact; an earlier turn's lock a narrow fact reason) | The Choice lock (`data/items.ts:995-997` onModifyMove adds choicelock for any move used, a Dancer's copy included; `data/conditions.ts:324-348`). doubles-status.ts beforeMove: at its end, the first move a working Choice item holder uses this turn sets `MoveVolatiles.choiceLock` (the move as used: info.id/name), not while Dynamaxed, under Klutz, Embargo or Magic Room (itemWorks), and only where a second move of its can come (`choiceReader`: a Dancer, or an Instruct, Copycat, Sleep Talk or Assist in the turn: the readers rule). `choiceLockCheck` at priority 0 (after paralysis, before Destiny Bond and Focus Punch's callback): a holder whose item is no longer a Choice item loses the lock; else any other move but Struggle is used and fails (the step counts it moved, as pinned's addMove then -fail): **Hurricane fails: Oricorio is locked into Quiver Dance by Choice Scarf.** A No move whose Splash sets a lock runs Attract and paralysis too (a Splash they stop sets none). The instructed move goes through the same BeforeMove, so an Instruct on a slower Choice holder whose own move differs now fails that move (PC-INS-SCARF). An earlier turn's lock (presence `carriedChoiceLock`, before each copy): none for a Pokémon that switched in or has `lastMove` null, nor where its action is not its last move (the lock lets it pick no other); a last move given or `firstTurn` false otherwise: **Dancer needs whether Oricorio is locked into a move by Choice Scarf.** (new `REASONS.needsChoiceLock`; whether it held the item when it used that move is not an input); neither given: its first turn, as for Fake Out, stated: **Assumes Oricorio is not locked into a move by Choice Scarf from an earlier turn.** Why not exact there: the oracle (and the input) has no carried choicelock, and a Trick or Switcheroo since its last move leaves no lock. `CHOICE_ITEMS` moved to doubles-actions.ts (no runtime import cycle). | doubles-status.ts, doubles-presence.ts, doubles-actions.ts, doubles-world.ts, docs | doubles-presence "R5-3 (RV2-R5-DAN-SCARF, -SCARF2)" and "R5-3: a lock from an earlier turn…" (the reason, the fact, Magic Room) | R5-DAN-SCARF, R5-DAN-SCARF2 (sv), PC-DAN-SCARF-SD, -SD2 (sv, usum), PC-DAN-SCARF-MR, -OTHER, -NONE (sv), PC-DAN-SCARF-LAST (sv, notEstimated), PC-INS-SCARF (sv, usum) |
| R5-4 | fixed | doubles-calling.ts `spendPP` keeps `MoveVolatiles.ppSpent` by move where an Instruct reads it (the move's PP given in `carried.ppLeft`, and an Instruct, Copycat, Sleep Talk or Assist in the turn): one as an own or instructed use passes BeforeMove (`sim/battle-actions.ts:281` deductPP; not a Dancer's copy, a called, bounced or snatched use), and one for each living foe with Pressure among the Pokémon it is aimed at after redirection (`:467-482` getMoveTargets' pressureTargets; `data/abilities.ts:3441-3444`): the kernel's damagingMove after resolveTargets (own uses only: `called` undefined), the status pipeline's runUse after targetsOf (`Use.spendsPP`, set by runStatusMove for a non-external action), and a target-"all" field move at statusMove. instruct fails when `ppLeft − ppSpent <= 0` (`data/moves.ts:9654-9660`): **Instruct fails: Garchomp's Dragon Claw has no PP left.** **Assumes … has PP left.** only when ppLeft is not given. | doubles-calling.ts, doubles-status.ts, doubles-turn.ts, doubles-use.ts, doubles-world.ts, docs | doubles-calling "R5-4 (RV2-R5-INS-PP, -PRESS)": 1 PP: no second use (139–154); 2 PP into Pressure: none (140–146); 3 into Pressure and 2 into a Snorlax: used again, no assumption | R5-INS-PP (sv, usum), R5-INS-PP3 (sv), R5-INS-PRESS (sv; usum with Aerodactyl), PC-INS-PRESS3, PC-INS-PRESS-ALLY, PC-INS-PRESS-EQ (sv) |
| R5-5 | fixed | applyStep: a strong weather whose last holder's faint in the step ended it (faint: `data/abilities.ts:954-963` onEnd clearWeather, re-settled there by FC) stays ended: `kept` holds where `STRONG_WEATHERS[w.field.weather]` and the field after the faints has none (no move sets another weather while a strong one stands, so the step's weather is that one). FC's stepField after the step's field line now compares with the field after the faints, so a faint's change is not re-settled twice. Pre-existing on main 4008ee8 (the reviewer's main-tree run). | doubles-turn.ts | doubles-fieldchange "review 2 (R5-5)…" (usum): Water Pulse 28–34, Flamethrower 25–30, E2 weather none | R5-FC-PRIMAL, R5-FC-PRIMAL2, V5-KYOGRE (usum only: Primal Reversion is a USUM mechanic) |
| R5-6 | fixed | callingGuard's Dancer and Fusion checks read each caller's own pool (`callablePool`): Sleep Talk its moves but the nosleeptalk and charge ones (not given: null, the reason kept); Nature Power its terrain moves (no dance, no Fusion move); Assist the ally's and the bench's moves (not given: null); Copycat the battle's last move before the turn (given) and the other Pokémon's actions and last moves (Instruct can repeat one); Mirror Move the others' actions and last moves; Me First the foes' actions. | doubles-calling.ts | doubles-calling "R5-6 (RV2-R5-ST-DANCER)": followed with Body Slam only; with Swords Dance among its moves the reason stays (the existing guard test keeps both of its reasons) | R5-ST-DANCER (sv, usum), PC-ST-DANCE (sv, notEstimated) |
| R5-7 | fixed (exact) | runCalledStatus sends a called Instruct (not bounced or snatched) to doubles-calling.ts `calledInstruct`: the direct handling (`aimed`, then `instruct`) at the target the caller gave (callRandom's foe split), with the caller's priority and Prankster flag. `readsLastMove` (doubles-status.ts) now also keeps `vol.usedMove` with a Sleep Talk, Copycat or Assist in the turn, so a called Instruct reads a target's move this turn. | doubles-status.ts, doubles-calling.ts, docs | doubles-calling "R5-7 (RV2-V7B-CPY-INSTR, -V7C-ST-INSTR)" | V7B-CPY-INSTR (sv, usum), V7C-ST-INSTR (sv, usum), R5-CPY-INSTR (sv) |

No finding was wrong on closer reading. Each of the 9 new tests fails on the pre-fix sources: the 7 changed source files'
pass B versions (`$SP/fixC/pre`: doubles-presence/-status/-calling/-use at HEAD, this pass's hunks taken out of
doubles-actions/-world/-turn) put back, the three test files filtered to the new tests gave `Tests  9 failed | 111 skipped (120)`
(`prefix-check.log`), and the post versions were put back (cmp-checked).

Probes after the fixes: the reviewer's whole set (`R5-PRCLST-FC-r1/run-probes.ts`, `$SP/fixC/r5-after.log`) gives
`35/43 cases match.`. The other 8 are the review's own non-findings: the malformed R5-CTR-DISG, R5-MB-DISG, R5-MC-DISG,
R5-FC-SNOW-ICE, R5-INS-FAINTED, R5-U-DAN-SCARF-usum and R5-INS-BB (a move Scovillain does not learn), and the observation
R5-TRC-IS (a traced Intrepid Sword's once-a-battle flag in E2), all as in the review's logs. The verifier's set
(`R5-PRCLST-FC-r1-verify/vrun.ts`, `v-after.log`) gives 22 of 23 matching; V6B-NP-DANCER is its malformed Nature Power probe.

### Stored cases

`cases-review2.ts` has a pass C section with 44 cases, 42 estimated and 2 notEstimated (PC-DAN-SCARF-LAST-sv: the new reason;
PC-ST-DANCE-sv: the kept Sleep Talk reason). REVIEW2_CASES now holds 189. The wiring is unchanged (cases-wave2.ts, OWNER_2
`/^RV2-/` → "review2 fixer"). Games: sv plus usum where the mechanic exists there (Dancer, Instruct, Pressure, Sleep Talk,
Copycat); R5-5's Primal Reversion is USUM-only. A Delta Stream probe was dropped: the harness gives no prepared moves, so the app
refuses a Rayquaza-Mega without Dragon Ascent (an input issue).

- The oracle first: `v3/run.ts <the 42 ids> --exact --oracle-only --shard=i/3` (`oracle-{0,1,2}.log`, each `EXIT 0`) wrote
  `results/RV2-*.json` for the 42. RV2-R5-DAN-TEETER-sv took 419 s and 107512 runs.
- `sim-dfs.ts <ids> --exact --validate` (`validate-{0,1,2}.log`, `validate-b.log`) gives `equal to N whole-turn replays` for all
  three walks on 41 of the 42: 123 lines, none that differ. The validated results equal the stored ones: `41 equal, 0 differ`
  (`$SP/fixB/valcmp.mjs`, ms, warnings and runs aside).
- RV2-R5-DAN-TEETER-sv cannot be validated: `RV2-R5-DAN-TEETER-sv FAILED: Error: over 200000 runs` (walkReplay), as pass B's
  Sleep Talk cases. Its stored result is the exhaustive DFS oracle's, the app agrees with it, and the reviewer's and verifier's
  independent Teeter Dance probes (R5-DAN-TEETER-sv, V2-DAN-TEETER-sv) match the app too.
- App side: every case through `STATUS2_REEXPECT=1a,1b v3/run.ts --store --quiet` (below), which wrote `app-results/RV2-*.json`.

### Gates (pass C, final tree)

`git branch --show-current` printed `calc-2v2-status-2` at the start and at the end. Each line below is as printed; the logs are
in `$SP/fixC`.

1. `npx tsc --noEmit`: exit 0, no output.
2. `npx eslint` on the 10 app and test files this pass changed (doubles-presence, -status, -calling, -use, -actions, -world,
   -turn; the presence, calling and fieldchange tests): exit 0, no output.
3. `npx vitest run --config vitest.unit.config.ts tests/unit/doubles-*.test.ts`: `Test Files  43 passed (43)` / `Tests  3355 passed | 1 skipped (3356)` (`vitest-doubles-2.log`).
4. `npx vitest run --config vitest.unit.config.ts tests/unit/training-*.test.ts tests/unit/calculator-doubles-*.test.ts tests/unit/status2-*.test.ts`: `Test Files  74 passed (74)` / `Tests  1069 passed (1069)`.
5. `npx vitest run --config vitest.battle-data.config.ts tests/source/status2-hooks.test.ts`: `Tests  8 passed (8)` (no runtime
   import cycle: CHOICE_ITEMS lives in doubles-actions.ts).
6. `STATUS2_REEXPECT=1a,1b v3/run.ts --store --quiet --shard=i/3`: `712/712`, `711/711`, `711/711 cases match.`, so 2134/2134:
   the 2090 cases of pass B plus the 44 new ones; the 544 stub ids are not run.
7. `STATUS2_REEXPECT=1a,1b compare.ts` (writes `results/compare.json` and the app results): `2134/2134 cases match.`
8. `changed-cases.ts diff $SP/fixC/app-results-passB verify/app-results --wave=all`: `2134 cases: 2090 unchanged, 0 stored cases changed, 0 failing the gate.`
   Against the round's before set (`$SP/reviews/FIX-r1/app-results-before`): `2134 cases: 1945 unchanged, 0 stored cases changed, 0 failing the gate.`
   `int2/tools/app-diff-facts.mjs`: `2701 files: 0 changed, 44 new` (against pass B) and `0 changed, 189 new` (against the before
   set). No stored case's app result changed byte for byte.
9. `v3/run.ts --wave2 --quiet`: `365/365 cases match.` That is 176 wave 2 cases plus 189 RV2 cases.
10. `v3/run.ts T2P- IN-CPY IN-RTL IN-ECV IN-INS CQ- T2M-ST T2M-UP T2M-HH ER S13 S26 S29 --quiet` covers the PR, CL, ST and FC
    families (Dancer, Instruct, the callers, Commander, the start, the field changes, Teeter Dance, Clangorous Soul, Lunar Dance).
    It gives `304/310 cases match.` without STATUS2_REEXPECT. The 6 are ER41b, -c, -d, -e, ER41g-usum and ER41h-swsh, older
    cases whose end-of-turn reasons waves 1a and 1b removed (`endOfTurn status: expected "not-estimated", got "ready"`; their app
    results are byte-equal to pass B's). With `STATUS2_REEXPECT=1a,1b` it gives `310/310 cases match.`
11. `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal (8716 ms)`.
12. Harness tests (`v3/vitest.v3.config.mts`): `Tests  1 failed | 24 passed (25)`. The one failure is the stub's `no case ZS16`,
    as in passes A and B.

### Open (pass C)

- `tests/unit/doubles-turn-showdown.test.ts` is still not regenerated. The 189 RV2 cases go in with `gen-tests.ts --keep-rows`
  at the next integration. Its 282 stub rows are untouched.
- RV2-R5-DAN-TEETER-sv has no `--validate` cross-check (the replay walk's 200000 cap).
- R5-3 keeps one narrow fact reason, **Dancer needs whether Oricorio is locked into a move by Choice Scarf.**, for a Choice item
  Dancer copying another dance where a lock from an earlier turn may hold it (a last move given and equal to its action, or
  firstTurn false with no last move). Exactness needs a carried choicelock input (and an oracle case kit field for it); neither
  the input nor the oracle has one. With neither lastMove nor firstTurn given the turn assumes no lock and says so.
- Noticed in passing, not changed: a Pokémon's own move with `ppLeft` 0 is still used (only Trump Card fails with no PP; pinned
  deductPP fails any move, `sim/battle-actions.ts:281-285`); the calculator offers **PP left** only for Trump Card, so only a
  hand-made input reaches it.

## Pass D: R6-1..R6-7 (the N/NU/U reviewer's findings) and R7-1..R7-3 (the T/R reviewer's findings)

This pass's probes, logs and scratch files are in `$SP/fixD`: `probes.ts` and `run.ts` (oracle and app), `probes-extra.ts`
(the Heal Block afterLoss probe found in passing), `sd/ts.ts` (Showdown directly: Toxic Spikes and Stealth Rock in both
orders), `notes.ts` (the 2v2 note per game), the logs named below, and `pre/tree.tar` (the sources this pass changed, before
it). Before any edit the reviewers' probes gave the findings' mismatches (R7: BP-HB2/-HB3 22 each, UNNERVE 13 each,
WEBSR-DEF-PRE 40, -TURN 2; R6: INS-PROT-STL3 22; the calculator probes' reasons), as in their logs.

### The findings

| Id | Outcome | Fix | Files | Test | Cases (RV2-…) |
|---|---|---|---|---|---|
| R7-1 | fixed | The kernel's `berryDue` keeps an HP Berry under Heal Block (`HEALING_BERRIES` and `eot.healBlock`: `data/items.ts` sitrusberry onTryEatItem runs TryHeal, `data/moves.ts` healblock condition onTryHeal returns false; Baton Pass copies healblock, `sim/pokemon.ts` copyVolatileFrom), as doubles-eot.ts updateSlot does; a pinch Berry is still eaten, its Cheek Pouch heal 0. Found in passing and fixed with it: the kernel's `afterLoss` (a fixed loss outside the hits: Spiky Shield, a spread retaliation) had the same gap (`X-HB-SPIKY`: the app 159, Showdown 101 with the Sitrus kept). Pre-existing on main for the kernel's own unnerveEnds (the verifier's V-PN-UNNERVE). | doubles-turn.ts | doubles-switch "review 2 (R7-1..R7-3) … Heal Block keeps an HP Berry …" (0–5 HP, KO 0.5625; 80 kept; Liechi eaten, no pouch; Spiky Shield 101 with the Sitrus) | R7-BP-HB2 (sv), R7-BP-HB3 (champions), R7-UNNERVE-HB (sv, usum), R7-UNNERVE-UT-HB (sv), V-PN-UNNERVE (sv), PD-HB-POUCH (sv), PD-HB-SPIKY (sv, champions) |
| R7-2 | fixed (exact with the order; a narrow fact reason without it) | `hazards()` (doubles-switch.ts) runs each hazard in the order it went up (`hazardOrder`: those from before the turn first, by the new `DoublesHazards.order`, then this turn's in landing order; a later Spikes or Toxic Spikes layer keeps its first layer's place, `sim/battle.ts` resolvePriority/initEffectState effectOrder), applying Toxic Spikes and Sticky Web only where the losses before them left the newcomer in (`fieldEvent` runs faintMessages after each handler and skips a fainted holder's; `sd/ts.ts`: Stealth Rock first, the Toxic Spikes stay); the losses stay one Update's. Toxic Spikes' restore keeps the order (and `SideState.hazardsUnordered` for an unordered input). Training passes the order (`bridge.ts hazardsOf`: the belief battle's effectOrder, which the public -sidestart order gives). The calculator's **Hazards** give none: where the order decides whether Toxic Spikes (a grounded Poison type) or Sticky Web (Mirror Armor, or Defiant, Competitive or Contrary with a foe's Opportunist or Mirror Herb) acts before a knock-out the hazards could cause, the turn is not estimated: **The order Stealth Rock and Sticky Web went up on your side is not known.** (`REASONS.hazardOrder`). Why not exact there: an order control would need a ranking of up to five hazards; the reason fires only with two or more hazards from before the turn, a newcomer in knock-out range and a reader. The harness (`app-turn.ts`, `gen-tests.ts`, the two generated test files' mappings) passes the case's order. | doubles-switch.ts, doubles-types.ts, doubles-world.ts, doubles-field.ts (Court Change carries hazardsUnordered), doubles-actions.ts, training/sim/bridge.ts, docs | doubles-switch "hazards act in the order they went up …" (147–174 and 61–88 web first, 75–88 and 147–160 rock first, Mirror Herb used; the reason; none out of range) and "Toxic Spikes taken away … only when they went up first" (usum); training-status2-r "the entry hazards …" (the order, reversed) | R7-WEBSR-DEF-TURN, R7-WEBSR-DEF-PRE, R7-SRWEB-DEF-PRE (sv), V-TS-SR-POISON, PD-SR-TS-POISON (sv, usum), PD-WEB-MIRROR-SR (sv) |
| R7-3 | fixed | benchIssues refuses a bench build with a Dynamax mechanic: **Bench Snorlax (yours, 2): a Pokémon on the bench is not Dynamaxed.** (`data/conditions.ts` dynamax onBeforeSwitchOut; `sim/battle.ts` runDynamax is a chosen action's). The calculator's `benchBuild` leaves out a Dynamax or Gigantamax the session build kept from a slot and keeps Terastallization. A Dynamaxed leaver is already not estimated (swapIn), so benchState needs nothing. App only: Showdown cannot hold the state. | doubles-turn.ts, calculator/doubles-inputs.ts, docs | doubles-switch "a bench build with a Dynamax mechanic is refused …"; calculator-doubles-bench "passes a bench build without a Dynamax …" | none (app only) |
| R6-1 | fixed | `Last move` shows on a Pokémon a Conversion 2 of the turn is aimed at (or with no target), not on the Conversion 2 user (`data/moves.ts` conversion2 reads target.lastMoveUsed). ADDENDUM2 and inputs.md rows updated. | calculator/doubles-inputs.ts, docs | calculator-doubles-inputs "offers Conversion 2's Last move on its target …" (sv, usum: the reason, then ready) | R6-CONV2 (sv, usum) |
| R6-2 | fixed | `doubles-prep.ts movesRead` passes a Pokémon's quick moves where another action reads them: Assist's partner, a Snatch or Copycat user where Conversion may be used this turn (an action, a last move, the battle's last move), an Instruct target whose last move is Imprison, Conversion or Sleep Talk; the live hook (`useDoublesCalculation`) uses it too. Every other input is as before. | calculator/doubles-prep.ts, calculator/useDoublesCalculation.ts | calculator-doubles-inputs "passes the moves another Pokémon's action reads …" (Assist with a Bench, Snatch→Conversion, Copycat→Conversion ready; no moves elsewhere) | R6-SNT-CONV (usum), R6-COPY-CONV (sv, usum) |
| R6-3 | fixed | `calledStall` (doubles-turn.ts): an Instruct aimed at a Pokémon whose last move is a protecting move or Endure, or its Sleep Talk with one among its moves, reads `carried.stall` (carriedState) and states **Assumes no protecting move was used last turn.** when it is not given; the Sleep Talk guard (**Sleep Talk with Protect is not modelled in 2v2.**) is gone: the called move rolls in earlyBranch's stallPrepare. The calculator shows **Protecting moves in a row** for them and keeps it in afterDoublesAction (`calledProtect`); Training passes the public streak for them (bridge.ts). compare.ts's fact rule follows. | doubles-turn.ts, doubles-calling.ts, calculator/doubles-inputs.ts, training/sim/bridge.ts | doubles-history "review 2 (R6-3) …" (sv, usum: 147–235, average 181.04, 2/3 fails; the assumption; Sleep Talk 1/6 blocked); calculator-doubles-inputs "asks Protecting moves in a row of an Instruct target …" | R6-INS-PROT-STL3 (sv, usum), R6-INS-PROT-NONE (sv), PD-INS-ENDURE-STL9 (sv), R6-STALK-STL3 (sv, usum), R6-STALK-NONE (sv) |
| R6-4 | fixed | The 2v2 note keeps **Grounding or lifting from Smack Down, Thousand Arrows or Magnet Rise on an earlier turn** and **Stats shared or swapped by Power Split, Guard Split or Speed Swap on an earlier turn** (per game's moves); inputs.md §5.6 updated. | unmodelled-states.ts, docs | calculator-doubles-inputs "drops what 2v2 sets or works out …" | none (UI list) |
| R6-5 | fixed | `switchDoublesIn` clears every carried state a switch ends (all but sleep, freeze, Wish, a landing, onceUsed, ppLeft and the accuracy and evasion stages: `sim/pokemon.ts` clearVolatile, `data/conditions.ts` tox onSwitchIn); a Switched in Pokémon's slot controls keep only its history, Battle Bond, PP, Wish, Lands this turn, Replacement and the accuracy and evasion stages, and its card loses confusion, Substitute and bad poison turns (`switchedInOptions`). carriedIssues: **A Pokémon that switched in this turn has none of last turn's effects that a switch ends.** It allows what this turn's entries before the moves set: the accuracy and evasion stages (Supersweet Syrup; the T2 fuzz's first run met 4 such cells, an evasion −1 on a newcomer, before this was allowed) and Commander's pair. The issue also found a Training bug (the R-T fuzz, seed 101, battle 56): a badly poisoned Pokémon switched in at the prelude carried its earlier stint's public count (`toxic: 1`), where pinned tox onSwitchIn starts the stage at 0; the bridge now passes 0 for a switched-in slot. | calculator/doubles-inputs.ts, calculator/doubles-prep.ts, calculator/useDoublesView.tsx, doubles-turn.ts, training/sim/bridge.ts, docs | calculator-doubles-inputs "Switched in clears and hides every state a switch ends …" (Weavile's KO chance 0; the issue); training-bridge "starts a badly poisoned Pokémon's stage again …" | none (Showdown cannot hold the state) |
| R6-6 | fixed | `applyDoublesIntimidate` (plain and Trace's) lets the Intimidate user's partner copy the targets' rises (`intimidate.ts` now returns them: `rises`, AfterBoost's capped positive changes of the targets) through its Opportunist in effect and its Mirror Herb (not under Magic Room or Klutz; used up; Unburden), as Commander's copies (`copyRises`). Pre-existing on main for the plain button. | intimidate.ts, calculator/doubles-prep.ts, docs | calculator-doubles-ui "lets the Intimidate user's partner copy a foe's Defiant rise …" (TRC-DEF-OPP −1/+1/+1/−1; INT-MH-ALLY +2, Herb used; Magic Room) | none (the apply action: the reviewer's apply-probes and the verifier's v-apply against Showdown now agree) |
| R6-7 | fixed | `calledMoves` (doubles-inputs.ts) adds an Instruct target's last move and a Me First user's target's move (every foe's with none given), so the Bench (and Hazards) show for an instructed U-turn and a Me First of a U-turn; `choosesSwitch` reads them too, so Replacement shows. | calculator/doubles-inputs.ts, docs | calculator-doubles-bench "reads an instructed U-turn …" (the Bench, Replacement, the turn ready with Corviknight in; USUM Me First) | V-INSU-BENCH (sv; usum with Skarmory) |

No finding was wrong on closer reading. Each of the 17 new or changed tests fails on the pre-fix sources: the 14 changed app
files' pre-pass versions (`$SP/fixD/pre/tree.tar`) put back, the six test files filtered to them gave
`Tests  17 failed | 368 skipped (385)` (`prefix-check.log`), and the post versions were put back (each differs from its pre
version; tsc clean). The Training toxic test added after that check fails with the bridge line taken out (`Tests  1 failed`)
and passes with it.

Probes after the fixes: the R7 reviewer's whole set (`R7-T-R-r1/run-r7.ts`, `$SP/fixD/r7-after.log`) gives `30/34 cases match.`;
the other 4 are the review's own malformed probes (R7-PS-MIST-champions, R7-REGEN-BACK, R7-PAYBACK-NEW, R7-WEB-CONTRARY, as in
its notes). The R6 reviewer's oracle set (`R6-NNU-U-r1/run-probes.ts`, `r6-after.log`) gives `14/14 cases match.`; its
calculator probes (`ui-probes.ts`, `r6-ui-after.log`): Conversion 2's Last move on the target, Assist, Snatch→Conversion and
Copycat→Conversion ready, the Bench shown for the instructed U-turn, and no Destiny Bond control on a Switched in Pokémon (the
probe then stops at its own `set`). The R6 apply probes (`apply-probes.ts`, the verifier's `v-apply.ts`) agree with Showdown on
TRC-DEF-OPP, INT-MH-ALLY and TRC-MH-ALLY.

### Stored cases

`cases-review2.ts` has a pass D section with 31 cases, all estimated. REVIEW2_CASES now holds 220. The wiring is unchanged
(cases-wave2.ts, OWNER_2 `/^RV2-/` → "review2 fixer"). Games: sv plus usum or Champions where the mechanic exists (Heal Block,
Instruct, Sleep Talk, Toxic Spikes, Conversion, Copycat; Snatch is USUM's; Mirror Herb and Opportunist SV's). R7-3, R6-4, R6-5
and R6-6 have none: Showdown cannot hold a Dynamaxed bench Pokémon or a Switched in Pokémon with last turn's volatiles, the note is
a UI list, and the apply action is checked against Showdown by the reviewers' apply probes.

- The oracle first: `v3/run.ts <the 29 ids> --exact --oracle-only --shard=i/2` (`oracle-{0,1}.log`, `15/15`, `14/14`, each
  `EXIT 0`), then the 2 PD-HB-SPIKY cases (`oracle-2.log`), wrote `results/RV2-*.json` for the 31. The slowest: RV2-V-INSU-BENCH-sv,
  6179 ms and 2368 runs.
- `sim-dfs.ts <ids> --exact --validate --out=$SP/fixD/validate` (`validate-{0,1,2}.log`) gives `equal to N whole-turn replays` for
  all three walks of all 31: 93 lines, none that differ. The validated results equal the stored ones: `31 equal, 0 differ`
  (`$SP/fixB/valcmp.mjs`, ms, warnings and runs aside).
- App side: every case through `STATUS2_REEXPECT=1a,1b v3/run.ts --store --quiet` (below), which wrote `app-results/RV2-*.json`.

### Harness changes

- `app-turn.ts caseHazards`, `gen-tests.ts`'s template and the two generated mappings (`tests/unit/doubles-turn-showdown.test.ts`,
  `tests/unit/doubles-outcomes.test.ts`): `DoublesHazards.order` from the case's hazards when it has two or more (sim-dfs adds them
  in that order). `gen-tests.ts --keep-rows=… --out=$SP/fixD/gen-check.test.ts` writes the same first 400 lines as the test file
  (its 282 stub rows untouched; it reports `G4-WHR-01-swsh has a different row now`, a row older than this pass: its app result
  is pass C's byte for byte).
- `compare.ts`: the fact rule for "Assumes no protecting move was used last turn." also covers an instructed or Sleep
  Talk-called protecting move (R6-3).
- `changed-cases.ts listChangedReview2`: R6-3's fact on a stored case (T2M-ST-01-sv, -champions: a Sleep Talk user with Protect).
- `v3/harness.test.ts`: caseHazards' expected order.
- Line endings: `compare.ts`, `gen-tests.ts` and `changed-cases.ts` are CRLF; an edit of this pass wrote them LF, and they were put
  back to CRLF (every line, as the cache branch and the gap fixer's copy have them). `ADDENDUM2.md` and `inputs.md` (CRLF) were
  edited in place.

### Gates (pass D, final tree)

`git branch --show-current` printed `calc-2v2-status-2` at the start and at the end. Each line below is as printed; the logs are
in `$SP/fixD`.

1. `npx tsc --noEmit`: exit 0, no output.
2. `npx eslint` on the 14 app files and 9 test files this pass changed: exit 0, no output.
3. `npx vitest run --config vitest.unit.config.ts tests/unit/doubles-*.test.ts`: `Test Files  43 passed (43)` / `Tests  3363 passed | 1 skipped (3364)` (`vitest-doubles-4.log`). One run under the fuzzes' load had `doubles-turn-perf` "lists a full learnset in the Moves pane within the budget" at 99.8 ms against 75 (`vitest-doubles-3.log`); on the idle machine it passes.
4. `npx vitest run --config vitest.unit.config.ts tests/unit/training-*.test.ts tests/unit/calculator-doubles-*.test.ts tests/unit/status2-*.test.ts`: `Test Files  74 passed (74)` / `Tests  1077 passed (1077)` (`vitest-tc-3.log`).
5. `npx vitest run --config vitest.battle-data.config.ts tests/source/status2-hooks.test.ts`: `Tests  8 passed (8)`.
6. `STATUS2_REEXPECT=1a,1b v3/run.ts --store --quiet --shard=i/3`: `722/722`, `722/722`, `721/721 cases match.`, so 2165/2165: the 2134 of pass C plus the 31 new; the 544 stub ids are not run (`final-{0,1,2}.log`).
7. `STATUS2_REEXPECT=1a,1b compare.ts`: `2165/2165 cases match.` (`compare.log`).
8. `changed-cases.ts diff $SP/fixD/app-results-passC verify/app-results --wave=all`: `2165 cases: 2131 unchanged, 2 stored cases changed, 0 failing the gate.` (T2M-ST-01-sv, -champions: R6-3's fact, listed, matching the oracle). Against the round's before set (`$SP/reviews/FIX-r1/app-results-before`): `2165 cases: 1942 unchanged, 2 stored cases changed, 0 failing the gate.` `int2/tools/app-diff-facts.mjs` against pass C: `2732 files: 3 changed, 31 new` (the two T2M-ST-01 facts; IN-HZD-01-swsh's newcomer losses in the order its hazards went up, a wave 2 case), and `3 changed, 220 new` against the before set.
9. `v3/run.ts --wave2 --quiet`: `396/396 cases match.` That is 176 wave 2 cases plus 220 RV2 cases.
10. `v3/run.ts G4-SWX IN-BNC IN-HZD IN-SW T2E-BL CQ-PUR-R IN-HBK G4-HBK F2-HB IN-FLD IN-STL CQ-STL T2P-INS T2P-CPY IN-CPY T2M-ST F2-C T2P-AST T2P-MEF CR- G4-TRC T2P-TRC SAT-ENT CQ-ENT IN-ENT T2M-SI --quiet` (the switch and hazard families, Heal Block, the stall roll, Instruct and the callers, Conversion, Assist, Me First, Trace and the entries): `342/342 cases match.`, with and without `STATUS2_REEXPECT=1a,1b`.
11. `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal (11195 ms)`.
12. Harness tests (`v3/vitest.v3.config.mts`): `Tests  1 failed | 24 passed (25)`. The one failure is the stub's `no case ZS16`, as in passes A to C.
13. Training (R7-2's order, R6-3's streak and R6-5's toxic reset reach the bridge):
    - `status2/build/t2-fuzz.ts 60 101`: `"decisions": 1335`, `"mismatches": 188`, `"logsClean": 794`, `"logsSame": 794`, `"issues": 0`, `"notEstimated": 24` (`t2-fuzz-101.log`); `t2-fuzz-all.ts 60 101`: 188 notes, every one a ` pp: ` line, 0 of another kind (integration 2: 188, 0 issues).
    - `status2/build/w2-rt/rt-fuzz.ts 60`: `"decisions": 1199`, `"mismatches": 0`, `"benchChecked": 2356`, `"hazardsChecked": 2356`, `"logsClean": 1013`, `"logsSame": 1013`, `"engineCells": 7001`, `"issues": 0`, `"notEstimated": 14`, `"ready": 7988`, `"policyIssues": 0` (`rt-fuzz-1.log`).
    - `rt-fuzz.ts 60 101` (integration 2's seed): `"decisions": 1108`, `"mismatches": 0`, `"benchChecked": 2210`, `"hazardsChecked": 2210`, `"logsClean": 941`, `"logsSame": 941`, `"engineCells": 6520`, `"issues": 0`, `"notEstimated": 6`, `"ready": 7609`, `"policyIssues": 0` (`rt-fuzz-101.log`; equal to integration 2's counts for seed 101).

### Open (pass D)

- `tests/unit/doubles-turn-showdown.test.ts` is still not regenerated; the 220 RV2 cases go in with `gen-tests.ts --keep-rows` at the
  next integration (its mapping already passes the hazards' order; the 282 stub rows untouched). The generator reports
  `G4-WHR-01-swsh has a different row now`, older than this pass.
- R7-2 keeps one narrow fact reason, **The order Stealth Rock and Sticky Web went up on your side is not known.**, for the
  calculator only (Training passes the order): two or more hazards from before the turn, a newcomer the damage hazards can knock
  out, and a reader of the order (a grounded Poison type and Toxic Spikes; Sticky Web with Mirror Armor, or Defiant, Competitive or
  Contrary with a foe's Opportunist or Mirror Herb). Exactness there needs an order control on **Hazards**.
- R6-3 covers an Instruct the turn's input aims (or leaves unaimed) and Sleep Talk; a called Instruct (Copycat, Sleep Talk or
  Assist calling Instruct at a random foe whose last move is Protect) still rolls with no counter and states nothing.
- R6-5 clears the carried states; a Switched in Pokémon's history (its **Last move**, its types) is not cleared, though pinned
  clearVolatile resets them too.
- Two stray logs, `/wave2.log` and `/vitest-tc-2.log`, were written at the filesystem root by a mis-scoped shell variable; copies
  are in `$SP/fixD`. The session's safety check refused their removal: they need removing by hand.

## Final pass: the open items and the gates

This pass resolved the open items that were small, exact fixes, then ran every gate on the final tree. Its probes, logs and
scratch files are in `$SP/fixE`: `probes.ts` and `run.ts` (oracle and app), `orc.ts` (the oracle's E2 lock per walk), `sd.ts`
(one turn in pinned Showdown with its log), `post/` (the changed sources after this pass) and the logs named below. Before any
edit it copied pass D's app results to `$SP/fixE/app-results-passD`.

### The open items

| Open item (pass) | Outcome | Fix | Files | Test | Cases (RV2-…) |
|---|---|---|---|---|---|
| PA-BZK-START-GAS: under Neutralizing Gas the app's E2 dropped a carried Berserk lock that pinned keeps (pass A) | fixed | The lock is the ability's state (`data/abilities.ts:414-444` berserk, angershell: `effectState.checkedBerserk`), and a suppressed ability runs no handler (`sim/pokemon.ts` ignoringAbility: Gastro Acid, Neutralizing Gas; `sim/battle.ts:882`). pinned keeps abilityState, so the lock stays. New `lockActs` (doubles-guards.ts): the lock acts only where the build does not hold GAS_STAND_IN. Where the ability is suppressed, the lock keeps no Berry and nothing ends it. That covers each read: lockReset, lockedBerryGuard's end-of-turn reason, sheerForceLock, noMoveUnlock, the kernel's berryDue, afterLoss and Struggle's reason, spreadStep's Liquid Ooze loss and settle, and doubles-eot's unlock, updateSlot and berryDue. lockReset still eats a Berry due at the action's Update (Gastro Acid on a holder under half). The probes found that a faster holder's own No move comes before Gastro Acid and its working Berserk ends the lock (`sd.ts`: `checkedBerserk` true). The app already had this, and the SV Gastro Acid cases keep it as a control. Neutralizing Gas ending mid-turn stays not estimated, as before (USER-DECISIONS: LATER). | doubles-guards.ts, doubles-turn.ts, doubles-spread.ts, doubles-eot.ts, docs | doubles-guards-lock "review 2 final pass: a lock under a suppressed Berserk stays and keeps nothing": GAS-BZK-IDLE (120, lock 1), GAS-BZK-HIT (92–103, lock 1), GA-KLAWF-LOW (106, lock 1; the faster Moltres-Galar 111, lock 0) | PE-BZK-START-GAS, PE-GAS-BZK-IDLE, PE-GAS-BZK-HIT (sv, swsh), PE-GA-BZK-HIT, PE-GA-BZK-LOW (sv, usum), PE-GA-KLAWF-LOW (sv) |
| R6-5: a Switched in Pokémon's history (its Last move, its types) was not cleared (pass D) | fixed | pinned clearVolatile sets lastMove null and calls setSpecies(baseSpecies) as a Pokémon leaves (`sim/pokemon.ts` clearVolatile; `sim/battle-actions.ts:117`). The calculator's `switchDoublesIn` now clears the history's Last move, its target and its types. Switched in no longer shows Last move or Last move's target (SWITCHED_IN_CONTROLS). `withSlotHistory` passes `lastMove: null` and no types for a Switched in Pokémon. The engine refuses a hand-made input with a last move on one: **A Pokémon that switched in this turn has used no move since it came in.** (Disable, Encore and Conversion 2 read `entry.lastMove` directly; Instruct's lastMoveOf already treated it as none.) Training is unaffected: the tracker clears lastMove when a Pokémon leaves (tracker.ts clearStint). ADDENDUM2's reset rule is updated, with CRLF kept. | calculator/doubles-inputs.ts, doubles-turn.ts, docs, ADDENDUM2.md | calculator-doubles-inputs "Switched in drops its Last move and its types from before: Instruct at it fails" | none: the oracle refuses a switch-in with a last move ("a switch-in keeps only its status counters"), as Showdown cannot hold it |

Both fixes' four new tests fail on the pre-fix behaviour, and the fixed files were put back afterwards (`cmp`-checked against `post/`). The pre-fix behaviour was the old lock semantics, the Switched in hunks taken out and the issue disabled. The run gave `Tests  4 failed | 109 skipped (113)`.

Stored cases: `cases-review2.ts` has a final pass section with 11 cases, all estimated, so REVIEW2_CASES now holds 231.

- The oracle ran first: `v3/run.ts RV2-PE- --oracle` (`oracle-pe.log`): `11/11 cases match.`, `EXIT 0`.
- `sim-dfs.ts <the 11 ids> --exact --validate --out=$SP/fixE/validate` (`validate-pe.log`) gives 33 `equal to N whole-turn replays` lines and none that differ. The validated results equal the stored ones: `11 equal, 0 differ`.

Left open, not small:

- **R6-3's called Instruct.** This is Copycat, Sleep Talk or Assist calling Instruct at a random foe whose last move is a protecting move. Exactness needs the same "a called Instruct can come" rule in five places: the engine's calledStall, the calculator's calledProtect (the readers rule), the Training bridge's streak, compare.ts's fact rule and changed-cases.
- **A Pokémon's own move with PP left 0 is still used** (pass C). An input issue would be wrong for a locked move (a charge, an Outrage lock), which pinned uses with no PP. The calculator offers PP left only for Trump Card.
- **The kept fact reasons.** These are R3-3, R3-4, R4-2, R4-3, R5-3's carried lock and R7-2 without an order, plus R3-2's Magician and Thief/Covet corners. The reasons why each stays are in passes A to D.
- **The two stray logs, `/wave2.log` and `/vitest-tc-2.log`.** Both are byte-equal to their copies in `$SP/fixD`. The safety check refused their removal again, so they need deleting by hand.
- **The source tests that need the compiled pinned dex** (`npm run data:champions`, which writes under node_modules). They were not run.

### All 36 findings

| Lens | Id | Severity | Outcome | Fix | Test | Cases (RV2-…) |
|---|---|---|---|---|---|---|
| R1-A1-K | R1-A1K-01 | blocking | fixed | Ability Shield works under Klutz (`shielded`: not Magic Room or Embargo) | doubles-stats-abilities "review 2 R1-A1K-01" | K1-KLUTZ-SHIELD, -SBM, -GA, V1-KS-WS, V1-KS-CTRL |
| R1-A1-K | R1-A1K-02 | blocking | fixed | Receiver and Power of Alchemy inside a Mold Breaker or Teravolt move take its breaker (`actingBreaker`, `knockingBreaker`) | doubles-reactions "sv: Receiver inside a Mold Breaker or Teravolt user's knocking move…" | K2-RC-MOLD (4 games), -CTRL, -MA, V2-RC-GD, V2-RC-SPREAD, V2-RC-TERAVOLT |
| R1-A1-K | R1-A1K-03 | blocking | fixed | Pastel Veil's onAnySwitchIn cures a poisoned newcomer (`pastelVeilAgain`) | doubles-switch "Pastel Veil's onAnySwitchIn…" | K1-PASTEL-NEWCOMER, -NEWCOMER2, V3-PV-TOX |
| R2-A2A3-H | R2-A2A3-H-1 | blocking | fixed | Defog clears the target's and the user's sides only | doubles-field-side-items (review 2 lines) | RA-DEFOG-ALLY, -ALLY7, V-DEFOG-SPK, -FOE, -BOTH |
| R2-A2A3-H | R2-A2A3-H-2 | blocking | fixed | `cureBench`: a party cure reaches the bench and a newcomer from it | doubles-switch "a party cure reaches the bench…" | RA-HB-BENCH, RA-AT-BENCH, RA-GMAX-SWEET-BENCH, V-HB-TOX, -BRN, -CTRL, -OPP, V-SWEET, V-HB-CHAMP |
| R3-DE-F | R3-1 | blocking | fixed | the start settle hides a carried-lock Berserk or Anger Shell Berry | doubles-guards-lock "RD-BZK-START-sv" | RD-BZK-START, V1-AS-START, V1-BZK-ORAN |
| R3-DE-F | R3-2 | blocking | fixed (two narrow reasons kept: Magician; Thief or Covet a Rough Skin or Iron Barbs loss could knock out first) | `berryTakenFirst`: no Leftovers stand-in where the Berry is taken before the Update | doubles-guards-lock "RD-BZK-THIEF2-sv / …", "FX-MAGICIAN-LOCK-sv" | RD-BZK-THIEF, -THIEF2, -BUGBITE, -BUGBITE2, RD-HB-BUGBITE, V2-PLUCK-HB, PA-PLUCK-ZERK, FX-THIEF-PLAIN, FX-COVET-LOCK, FX-INCIN-HB, PA-THIEF-STICKY-HB, FX-MAGICIAN-LOCK |
| R3-DE-F | R3-3 | blocking | fixed with a fact reason (**Starf Berry between the hits of Double Kick is not modelled in 2v2.**) | an attacker's own Starf eaten before its last hit: not estimated | doubles-guards-misc "RD-STARF-MULTI-sv…" | RD-STARF-MULTI (ne), RD-STARF-TGT, V3-LIECHI-MULTI, V3-STARF-SINGLE |
| R3-DE-F | R3-4 | blocking | fixed with a fact reason (**Fissure with Parental Bond is not modelled in 2v2.**) | `parentalOhkoGuard`, narrowed to targets the move can affect | doubles-guards-misc "review 2 R3-4…" | RD-OHKO-PB, -DISGUISE, -SUB, PA-OHKO-PB-BAND (ne), PA-OHKO-PB-PLAIN, -IMMUNE |
| R4-SW-M | R4-1 | blocking | fixed | spreadStep probes the attacker's HP from the first target whose calculation reads it (a face through `faceSearch`) | doubles-faces "review 2 (R4-1, R4-5)… R4-1" | R4-S-ERUPTKYU, -ERUPTKYU2, R4-S-SPREADBLAZEKYU, R4-S-SPREADROWAPLO, V1-WSPOUT |
| R4-SW-M | R4-2 | blocking | fixed with a fact reason (**G-Max Finale with Cramorant-Gulping's Gulp Missile is not modelled in 2v2.**) | finaleGuard adds Gulp Missile | doubles-max "review 2 … (R4-2)" | R4-M-FINALEGULP, V2-FINALEGORGE (ne), PB-FINALECRAM |
| R4-SW-M | R4-3 | blocking | fixed with a fact reason (Foam Burst / Max Airstream against a reaction at a ±6 cap) | `orderGuard` with `capOrder` | doubles-max "review 2 … (R4-3)" | R4-M-FOAMWA, V3-FOAMWA6, R4-M-AIRCOTTON, V3-AIRCOTTONLOW (ne); PB-FOAMWA0, PB-AIRCOTTON0, V3-AIRCOTTONSELF, V3-STRIKEWA5 |
| R4-SW-M | R4-4 | blocking | fixed | a called move has its caller's priority (`calledPriority`, `frozenPriority`) | doubles-calling "review 2 (R4-4)" | R4-W-SLPTALKGW, V4-SLPTALKAT, R4-W-SLPTALKPT, R4-W-SLPTALKPR |
| R4-SW-M | R4-5 | blocking | fixed | a face hit's calculation reads the attacker's HP (`neutralRow`, `byAttacker`) | doubles-faces "… R4-5" | R4-S-BLAZEKYU1, R4-S-TORRENTKYU, V5-OVERGROWKYU, PB-TORRENTSUBKYU |
| R5-PRCLST-FC | R5-1 | blocking | fixed | Dancer aims at the dance's target when a Substitute took the hit | doubles-presence "R5-1" | R5-DAN-SUB, V1-DAN-SUB, V1-DAN-SUB2 |
| R5-PRCLST-FC | R5-2 | blocking | fixed | a dance's success is marked as its effect applies (`danceEffect`) | doubles-presence "R5-2" | R5-DAN-WH, R5-DAN-TEETER, R5-DAN-DEF, PC-DAN-MIRROR, -CAP, -CLANG, -CONTRARY |
| R5-PRCLST-FC | R5-3 | blocking | fixed (an earlier turn's lock a narrow reason: **Dancer needs whether Oricorio is locked into a move by Choice Scarf.**) | the Choice lock this turn (`choiceLock`, `choiceLockCheck`) | doubles-presence "R5-3", "R5-3: a lock from an earlier turn" | R5-DAN-SCARF, -SCARF2, PC-DAN-SCARF-SD, -SD2, -MR, -OTHER, -NONE, -LAST (ne), PC-INS-SCARF |
| R5-PRCLST-FC | R5-4 | blocking | fixed | Instruct reads the PP spent this turn, Pressure included (`spendPP`) | doubles-calling "R5-4" | R5-INS-PP, -PP3, -PRESS, PC-INS-PRESS3, -PRESS-ALLY, -PRESS-EQ |
| R5-PRCLST-FC | R5-5 | blocking | fixed | a strong weather its holder's faint ends stays ended | doubles-fieldchange "review 2 (R5-5)" | R5-FC-PRIMAL, -PRIMAL2, V5-KYOGRE |
| R7-T-R | R7-1 | blocking | fixed | Heal Block keeps an HP Berry in berryDue and afterLoss | doubles-switch "… Heal Block keeps an HP Berry …" | R7-BP-HB2, -HB3, R7-UNNERVE-HB, -UT-HB, V-PN-UNNERVE, PD-HB-POUCH, PD-HB-SPIKY |
| R7-T-R | R7-2 | blocking | fixed (without an order, a narrow reason: **The order Stealth Rock and Sticky Web went up on your side is not known.**) | hazards act in the order they went up (`hazardOrder`, `DoublesHazards.order`; Training passes it) | doubles-switch "hazards act in the order they went up …", "Toxic Spikes taken away …"; training-status2-r "the entry hazards …" | R7-WEBSR-DEF-TURN, -DEF-PRE, R7-SRWEB-DEF-PRE, V-TS-SR-POISON, PD-SR-TS-POISON, PD-WEB-MIRROR-SR |
| R7-T-R | R7-3 | blocking | fixed | a bench build with a Dynamax mechanic is refused; the calculator drops it | doubles-switch "a bench build with a Dynamax mechanic is refused …"; calculator-doubles-bench "passes a bench build without a Dynamax …" | none (app only) |
| R1-A1-K | R1-A1K-04 | should | fixed | the transformMax reason is removed | doubles-stats-abilities "review 2 R1-A1K-04" | K1-TRF-DMAX, V4-TRF-DMAX-SPD, V4-TRF-GMAXK |
| R1-A1-K | R1-A1K-05 | should | fixed | the spread Aftermath and Innards Out loss joins the first loss group (`SPREAD_LOSS`) | doubles-reactions K-IO-05 | K2-AF-BREAKING, K2-RH-BREAKING, -NOBERRY, V5-AF-BREAKING-SW, V5-IO-BREAKING, -2, PA-AF-SPREAD-KO, PA-AF-RH-SPREAD, PA-IO-SPREAD-KO |
| R3-DE-F | R3-5 | should | fixed | the flung-Custap reason is removed | doubles-guards-fling "review 2 R3-5" | RD-FLING-CUSTAP, V5-CUSTAP-IDLE, -POUCH, -POUCH-IDLE, -AFTER |
| R3-DE-F | R3-6 | should | fixed | the Encore reason only where a reader of the kept priority or Prankster flag is in play | doubles-guards-misc "review 2 R3-6…" | RD-ENC-PRIO, V6-ENC-NOPRIO, PA-ENC-NOREADER, PA-ENC-QG, PA-ENC-PT, PA-ENC-AT, PA-ENC-PRANK, -PRANK-NODARK |
| R4-SW-M | R4-6 | should | fixed | W's continuation reads the dealt damage for recoil and Shell Bell | doubles-pairs "review 2 (R4-6)" | R4-W-GANLONSB, R4-W-PBRECOIL, V6-PBTAKEDOWN, V6-DHSB |
| R5-PRCLST-FC | R5-6 | should | fixed | callingGuard reads each caller's own pool (`callablePool`) | doubles-calling "R5-6" | R5-ST-DANCER, PC-ST-DANCE (ne) |
| R5-PRCLST-FC | R5-7 | should | fixed | a called Instruct is handled (`calledInstruct`) | doubles-calling "R5-7" | V7B-CPY-INSTR, V7C-ST-INSTR, R5-CPY-INSTR |
| R6-NNU-U | R6-1 | should | fixed | Conversion 2's Last move control is on its target | calculator-doubles-inputs "offers Conversion 2's Last move on its target …" | R6-CONV2 |
| R6-NNU-U | R6-2 | should | fixed | `movesRead` passes the moves another action reads | calculator-doubles-inputs "passes the moves another Pokémon's action reads …" | R6-SNT-CONV, R6-COPY-CONV |
| R6-NNU-U | R6-3 | should | fixed (a called Instruct still open, above) | `calledStall`: an instructed or Sleep Talk-called protecting move reads the counter, with the assumption fact | doubles-history "review 2 (R6-3) …"; calculator-doubles-inputs "asks Protecting moves in a row …" | R6-INS-PROT-STL3, R6-INS-PROT-NONE, PD-INS-ENDURE-STL9, R6-STALK-STL3, R6-STALK-NONE |
| R6-NNU-U | R6-4 | should | fixed | the 2v2 note keeps grounding and the stat splits per game | calculator-doubles-inputs "drops what 2v2 sets or works out …" | none (a UI list) |
| R6-NNU-U | R6-6 | should | fixed | the Intimidate user's partner copies a rise (Opportunist, Mirror Herb) | calculator-doubles-ui "lets the Intimidate user's partner copy …" | none (apply probes) |
| R6-NNU-U | R6-7 | should | fixed | `calledMoves` reads an instructed and a Me First U-turn: the Bench and Replacement show | calculator-doubles-bench "reads an instructed U-turn …" | V-INSU-BENCH |
| R6-NNU-U | R6-5 | minor | fixed (pass D; its history part in this pass) | Switched in clears every state a switch ends, its Last move and types included | calculator-doubles-inputs "Switched in clears and hides …", "Switched in drops its Last move …"; training-bridge "starts a badly poisoned …" | none (Showdown cannot hold the state) |

(ne): stored as not estimated, with the fact reason.

### Gates (final pass, final tree)

`git branch --show-current` printed `calc-2v2-status-2` at the start and at the end. Each line below is as printed; the logs
are in `$SP/fixE`.

1. Oracle cases and changed cases:
   - `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts` (writes `results/compare.json` and `app-results/`): `2176/2176 cases match.` (`compare.log`). That is pass D's 2165 plus the final pass's 11. The 544 stub ids do not load.
   - `changed-cases.ts diff $SP/reviews/FIX-r1/app-results-before scripts/.cache/calc-audit/2v2/verify/app-results --wave=all`: `2176 cases: 1942 unchanged, 2 stored cases changed, 0 failing the gate.` (`changed-cases.log`). The two are T2M-ST-01-sv and T2M-ST-01-champions: R6-3's fact **Assumes no protecting move was used last turn.**, `matches the oracle`. Pass D's `listChangedReview2` lists them; this pass changed no other stored case, so it adds no row.
   - Against pass D's app results (`app-results-passD`): `2176 cases: 2165 unchanged, 0 stored cases changed, 0 failing the gate.` (`changed-cases-passD.log`).
   - `int2/tools/app-diff-facts.mjs` gives `2743 files: 0 changed, 11 new` against pass D. Against the before set it gives `2743 files: 3 changed, 231 new`: the two T2M-ST-01 facts, and IN-HZD-01-swsh, a wave 2 case whose newcomer losses now come in the order its hazards went up (R7-2).
2. The Showdown test file:
   - `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts --keep-rows=tests/unit/doubles-turn-showdown.test.ts` gave `keep-rows: 2157 rows before, 282 kept as they were (their case does not load), 210 new` and `wrote 2367 cases to /home/user/pokedrafts/tests/unit/doubles-turn-showdown.test.ts (0 cases that do not agree with the app left out)` (`gen-tests.log`).
   - The diff against the file before is 210 added lines and none removed or changed. The 282 stub rows and every other row are byte-equal.
   - The 210 new rows are the 231 RV2 cases less the 21 stored as not estimated (no row).
   - No `has a different row now` line was printed. The one pass D saw (`G4-WHR-01-swsh`) appears only without `STATUS2_REEXPECT`. A run without it gives `G4-WHR-01-sv has a different row now`, `G4-WHR-01-swsh has a different row now` and `FS08e-sv loads but has no row now`. Those are the wave 1a and 1b cases whose reasons were removed, re-expected by `STATUS2_REEXPECT`, and no review fix touched them.
   - `npx vitest run --config vitest.unit.config.ts tests/unit/doubles-turn-showdown.test.ts`: `Test Files  1 passed (1)` / `Tests  2367 passed (2367)` (`vitest-showdown.log`).
3. The rest:
   - `npm run check` (lint, `tsc --noEmit`, the unit suite): `Test Files  261 passed (261)` / `Tests  8270 passed | 1 skipped (8271)`, `EXIT 0` (`check.log`). eslint and tsc printed nothing.
   - `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal (8381 ms)` (`golden.log`).
   - The Training unit tests, `npx vitest run --config vitest.unit.config.ts tests/unit/training-*.test.ts`: `Test Files  60 passed (60)` / `Tests  711 passed (711)` (`vitest-training.log`).
   - `status2/build/t2-fuzz.ts 60 101`: `"decisions": 1335`, `"mismatches": 188`, `"logsClean": 794`, `"logsSame": 794`, `"issues": 0`, `"notEstimated": 24` (`t2-fuzz-101.log`). `t2-fuzz-all.ts 60 101` lists 188 notes, every one a ` pp: ` line (`t2-fuzz-all-101.log`): the 188 known PP mismatches, as at integration 2 and pass D.
   - `status2/build/w2-rt/rt-fuzz.ts 60`: `"decisions": 1199`, `"mismatches": 0`, `"benchChecked": 2356`, `"hazardsChecked": 2356`, `"logsClean": 1013`, `"logsSame": 1013`, `"engineCells": 7001`, `"issues": 0`, `"notEstimated": 14`, `"ready": 7988`, `"policyIssues": 0` (`rt-fuzz-1.log`), equal to pass D's. A shell variable scoped to a background job wrote this log to `/rt-fuzz-1.log` first. The copy is in `$SP/fixE`, and the root file needs deleting by hand, like pass D's two.
   - The harness tests (`npx vitest run --config scripts/.cache/calc-audit/2v2/verify/v3/vitest.v3.config.mts`): `Tests  1 failed | 24 passed (25)`. The one failure is the stub's `Error: no case ZS16`, as in passes A to D (`harness.log`).
   - `npx vitest run --config vitest.battle-data.config.ts tests/source/status2-hooks.test.ts`: `Tests  8 passed (8)` (no import cycle: doubles-guards.ts already imported calculate.ts).
