# Review R2-A2A3-H, round 1 (ADDENDUM2 §8.8 reviewer 2: A2, A3 with H)

Branch `calc-2v2-status-2` (checked at start and end). Read-only: no repo file changed but this note.
Scope: `doubles-typing.ts`, `engine-corrections.cjs` (A2), `doubles-field.ts`, `doubles-items.ts` (A3), `doubles-hidden.ts` (H),
and the kernel lines they touch (`doubles-switch.ts` newcomer path, `doubles-status.ts` Snatch/Protean call sites,
`calculate.ts` hidden marks, `doubles-max.ts` G-Max Sweetness for the shared root cause).

Probe harness (nothing stored): `/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad/reviews/R2-A2A3-H-r1/`
`probes.ts` (35 case builders, 48 runs; 5 runs were inputs the app refuses by learnset: RA-MR-SCARF-swsh, RA-MC-DOUBLE-swsh,
RA-CC-CURSE*, not findings) and `run.ts` (pinned oracle `sim-dfs.ts` + `app-turn.ts` + `compare.ts`, as the
critic's run-probes.ts). Run from the repo root:
`npx --no-install tsx /tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad/reviews/R2-A2A3-H-r1/run.ts <id prefix> [-v]`

Unit tests of the families (`--config vitest.unit.config.ts`): doubles-typing, doubles-family2, engine-corrections-effectiveness,
doubles-field-side-items, doubles-hidden, doubles-items: 6 files, 196 passed, 1 skipped.

## Findings

1. **Defog aimed at the user's own ally clears the foe side's hazards** (A3, `doubles-field.ts:522`). Pinned Defog removes
   hazards from `target.side` and `source.side` only (PS/data/moves.ts:3463, :3470; gen 7 PS/data/mods/gen7/moves.ts:133, :140):
   with an ally target both are the user's side, so the foe side keeps them. The app clears both sides unconditionally (and
   states "the hazards on both sides are cleared"). Probes `RA-DEFOG-ALLY-sv`, `RA-DEFOG-ALLY7-usum`: Stealth Rock on the
   opponent's side, Defog at the own ally, a slower opponent U-turn brings Charizard in: Showdown 77 HP (76 Stealth Rock), app
   153 HP, ready with no reason; E2 opponent hazard stealthrock expected 1, got 0. Wrong number, no reason.
2. **A party cure does not reach a newcomer from the cured bench** (A3 `teamCure` + R's `doubles-switch.ts newcomer`; same root
   cause in M's G-Max Sweetness, `doubles-max.ts:304`). Heal Bell, Aromatherapy and G-Max Sweetness cure every party member
   (PS/data/moves.ts healbell / aromatherapy: `target.side.pokemon`; gmaxsweetness `source.side.pokemon`), but the app only sets
   `SideState.benchCured` (an E2 flag) and the newcomer is built from the input's bench status (`doubles-switch.ts:892`
   `newcomer`, `:758`). F3 §11 (field-side-items.md:1080) says the bench model applies it per member. Probes
   `RA-HB-BENCH-sv/-usum/-champions`, `RA-AT-BENCH-swsh`, `RA-GMAX-SWEET-BENCH-swsh`: a poisoned (burned) bench Snorlax cured
   earlier in the turn comes in by U-turn: Showdown no residual, 235 HP; app Poison −29 (Burn −14), 206 (221) HP and E2
   status psn (brn), ready with no reason, while the step fact says the bench is cured.

No other defect survived: every other probe below matches pinned Showdown.

## Cross-family checklist (SPEC2 §9 and ADDENDUM2 §9 items that involve A2, A3 or H)

| Item | Evidence |
|---|---|
| Snatch steals Stockpile | probe `RA-SN-STOCK-usum` match |
| Snatch steals Swallow (C1) | stored CR-04, SAT C1 case (cases-sat.ts:206) |
| Snatch steals Minimize | probe `RA-SN-MIN-usum` match (Body Slam ×2 into the thief) |
| Snatch steals Power Trick | probe `RA-SN-PT-usum` match |
| Snatch steals Conversion | probe `RA-SN-CONV-usum` match (thief's own first move: Dark) |
| Snatch steals Camouflage | probe `RA-SN-CAMO-usum` match |
| Snatch steals Recycle | probe `RA-SN-RECY-usum` match (Sitrus back, eaten after the later hit) |
| Snatch steals Heal Bell | stored FS F126 (cases-fs.ts:58, :340) |
| Snatch and a Z-status move | probe `RA-SNATCH-Z-usum`: the app does not calculate status Z-Moves (existing reason), not A3's |
| Magic Coat bounces Soak, Entrainment | probe `RA-MC-SOAK-ENT-swsh/-usum` match |
| Magic Coat bounces Simple Beam, Worry Seed | probe `RA-MC-BEAM-SEED-swsh/-usum` match |
| Magic Coat bounces Gastro Acid, Topsy-Turvy | probe `RA-MC-ACID-TT-swsh/-usum` match |
| Magic Coat bounces Embargo | stored FS F132 |
| Magic Coat bounces Defog | probe `RA-MC-DEFOG-swsh/-usum` match |
| Magic Coat bounces Purify | stored FS K44 |
| Magic Coat sends Stealth Rock back, then a newcomer | probe `RA-MC-SR-NEW-swsh/-usum` match |
| Transform after a type change | stored CR-03 (stored-stat change and Minimize are A1's rows) |
| A Skill Swapped Protean (fresh state) | probe `RA-SS-PROTEAN-sv/-champions` match |
| Octolock / Syrup Bomb into Defiant beside Opportunist (C9) | stored CR-05 (champions, swsh) |
| Mist against a mid-turn Intimidate (C10) | stored CR-06; probe `RA-MIST-NEWINTIM-sv/-usum` (a U-turn newcomer's Intimidate into Mist) match |
| Teatime with Pickup and Harvest (C8) | stored CR-09a |
| Heal Block / Embargo with 1 turn left and a Sitrus (C3, C4) | stored cases-cr.ts:16, :21 |
| Glaive Rush on a holder that moves first (C5) | stored CR-10e (D's) |
| A carried Fly released into Gravity (cancelled) | probe `RA-FLY-GRAV-sv/-usum` match |
| A carried Fly released into Smack Down | stored int1b (cases-int1b.ts:96), T2-SI04d |
| A Dancer copying a dance into a hidden target | probe `RH-DANCER-LOCKON-sv` match (Lock-On lets the original through, the copy misses) |
| The landing into a Pokémon charging Dig / Fly | stored cases-t2e-1b.ts:105, :110 |
| H: Sky Drop pair, Gust at either, lost action, failures | stored CQ Sky Drop, TP4·SD1, SD2; probes `RH-SKYDROP-GUST-usum` (Gust into the lifted one not doubled: onAnyBasePower reads the attacker), `RH-SKYDROP-GRAV-usum` (Gravity frees the lifted Pokémon, its Pound runs) match |
| H: C27 commanding Tatsugiri missed by No Guard | stored cases-cq-1b.ts:62 (Helping Hand into it changes no number) |
| H: Dive and Surf ×2 (ModifyDamage) in a spread | probe `RH-DIVE-SURF-sv` match |

Other probes (all match): `RA-TK-DUG-usum` (Telekinesis immune species), `RA-CC-SAFE-NEW-sv` (Court Change moves Spikes onto a
newcomer's side), `RA-MR-SCARF-sv` (Magic Room at priority 0 and the gen 9 re-sort), `RA-EMB-SCARF-usum` (Embargo, gen 7 keeps the
order), `RA-CG-SCARF-swsh/-champions` (Corrosive Gas takes a Scarf, re-sort), `RA-LIB-MAX-swsh` (Libero on a Max Move),
`RA-PRO-Z-usum` (Protean on a Z-Move).

## Looked at, no finding

- Color Change's Curse glitch (PS/data/abilities.ts colorchange: position 1, every generation) is guarded in gen 7
  (`doubles-typing.ts colorChange`) though Showdown is simple there; unreachable in USUM by learnset (Kecleon does not learn
  Curse), so not reported.
- `World.fieldSet` is written whenever a room or Sport is set (not only with an E2 run or a room fact); worlds that differ
  only in it need a room ended and restarted in some worlds only: no measurable growth, not reported.
- Texts of the three files: facts with `kernel.names`, no position words, no instructions.
