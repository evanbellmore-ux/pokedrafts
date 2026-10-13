# Review R4-SW-M, round 1: S (faces, Substitute hits), W (the pair's environment, the continuation), M (G-Max, Max Guard, Pain Split)

Read-only review (ADDENDUM2 §8.8). Branch `calc-2v2-status-2` checked at the start and the end; no repo file changed except
this notes file. Scope: `doubles-faces.ts`, `doubles-substitute.ts` (S), `doubles-pairs.ts` (W), `doubles-max.ts` (M), T2M
§2.5's continuation, and the kernel lines they touch (`doubles-turn.ts` singleStep / applyStep / contextFor, `doubles-spread.ts`
spreadStep's face and Max lines, `calculate.ts` usedPriority). Ground truth: pinned Showdown c23d2e94.

Probes (nothing stored): `$SP/reviews/R4-SW-M-r1/cases-r4.ts`, run from the repo root with
`npx --no-install tsx $SP/reviews/R4-SW-M-r1/run-r4.ts <id-prefix> [-v]` (`$SP` = the session scratchpad
`/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad`; pinned oracle `sim-dfs.ts oracle()` vs
`app-turn.ts`, `compare.ts compareCase`; each oracle result kept in `out/<id>.oracle.json`, the last full run in `out/all.log`).
87 probe runs: 67 match; 3 are inputs the app rejects (below); 1 is a harness convention (G-Max Snooze); the rest are the findings.

Stored cases of the three families (`STATUS2_REEXPECT=1a,1b v3/run.ts T2M-FA T2M-FS T2M-SB T2M-SP T2M-ALE T2M-FB T2M-BE T2M-AR
T2M-GW T2M-AS T2M-SG T2M-GM T2M-PS IN-SFG IN-STL-04 S48-PainSplit VE-F1-10 VE-F1-13 VE-H5-6 E40-`): 108/108 agree.
Unit files (`vitest --config vitest.unit.config.ts` doubles-faces, doubles-pairs, doubles-max, doubles-substitute*): 105/105.

## Cross-family checklist (SPEC2 §9 + ADDENDUM2 §9), items that involve S, W or M

| Item | Evidence | Result |
|---|---|---|
| Focus Band on the hit Disguise takes (none: 0 damage) | R4-S-FBFACE-sv (the chip knocks out a 10 HP Focus Band Mimikyu: no Band), R4-S-FBFACE2-sv (hit 2 into the busted form: Band 1/10) | match |
| A Berry between hits on a Substitute's holder (none: no Update reaches it) | R4-S-SUBBIGGANLON-sv; with the break: R4-S-SUBGANLON-sv (Ganlon after hit 4 at 0.39) | match |
| Counter after a hit into a face | unreachable: no Mimikyu or Eiscue learns Counter, Mirror Coat, Metal Burst or Comeuppance in SV / SwSh (learns.ts); the app rejects the action (R4-S-COUNTER-sv "This Pokémon does not learn that move."); Counter is failcopycat / noassist and Metronome is not modelled | n/a |
| Continuation: Life Orb once | R4-S-LOFACE, R4-S-LOFACEKO (chip knockout ends the move), R4-S-SUBLO, R4-W-GANLONLO | match |
| Continuation: Shell Bell over both parts | S's paths: R4-S-SBFACE, R4-S-SUBSB match; W's stopped part: R4-W-GANLONSB gives a reason (finding 6) | partly |
| Continuation: recoil over both parts | R4-W-PBRECOIL-usum gives a reason (finding 6) | finding |
| Continuation: no per-use effect in a stopped part | R4-W-SCALESHOT90, R4-W-SCALEDICE (Scale Shot's self stages once, random counts), R4-W-STARFCOUNT | match |
| Safeguard against a damaging move's status (W) | R4-W-SGSYNC (Synchronize stopped), R4-W-SGALLY (an ally's Nuzzle), R4-W-SGINFALLY (Infiltrator into an ally), R4-W-SGTSPIKES (a newcomer's Toxic Spikes); stored T2M-SG-01 | match |
| Gale Wings / frozen priority | stored T2M-GW-01/02 (USUM), R4-W-GWSV-sv; called moves: R4-W-SLPTALKGW, R4-W-SLPTALKPT (finding 5) | finding |

## Further probes (all match)

Faces: R4-S-ASSFACE-sv/-usum (Assurance after a face hit: the gen 8 chip sets hurtThisTurn, USUM none), R4-S-HELMFACE,
R4-S-SPREADKEE, R4-S-SPREADJAB, R4-S-SPREADROWAP, R4-S-DARTSFACE / -2 (Dragon Darts into Ice Face), R4-S-SCALEFACE,
R4-S-AXELFACE, R4-S-DMAXKYU-swsh (a Dynamaxed Mimikyu), R4-S-MAXKYU-swsh (Max Darkness into a face), R4-S-TERAKYU-sv.
Substitutes: R4-S-SUBHELM, R4-S-SUBFACE, R4-S-ERUPTSUB. W: R4-W-FBSPREAD, R4-W-FBSTURDY, R4-W-FBLAND (Future Sight landing),
R4-W-FBSELF (self-hit), R4-W-GLUTGANLON, R4-W-PBGANLON, R4-W-UNNERVEGANLON, R4-W-RIPENGANLON, R4-W-ALLYGANLON. M: R4-M-MGROAR
(Roar passes Max Guard, Dynamax keeps it in), R4-M-MGDARTS, R4-M-MGPUFF, R4-M-STEELSURGE (a newcomer takes it),
R4-M-SWEETBENCH (bench cure reaches a newcomer), R4-M-WINDRAGEHZ, R4-M-BEFSYNC, R4-M-SMITESUB, R4-M-VOLTSUB, R4-M-BEFSUB,
R4-M-FINALESUB, R4-M-CUDDLESUB, R4-M-SWEETGORGE, R4-M-SANDSPIT (Max Geyser then Sand Spit), R4-M-STRIKEWA, R4-M-PHANTSTAM,
R4-M-ABSENT (an empty foe slot).

Not findings: R4-M-SNOOZE-swsh (E2 yawn: the oracle's forced `randomChance` false gives G-Max Snooze's Yawn, while the app
follows its stated rule "added effects below 100% do not happen"; a harness convention, not an app number). R4-W-COPYGW and
R4-S-SPREADBLAZESLOWKYU were malformed probes (a move not learned; EVs above 252).

## Findings

1. **Spread move into an intact face at Showdown position 0 with HP-reading damage: the other target at full-HP damage, no
   reason.** `doubles-spread.ts:78` picks the attacker-HP probe as the first unblocked check; a face's searchFor row is the
   face's reason (no search), so the HP split (`:79-87`) is skipped and every other target's search runs at the attacker's
   full HP. R4-S-ERUPTKYU-sv: Typhlosion at 77/155 HP, Eruption into Mimikyu (opponent-right = p2a) and a Snorlax: app Snorlax
   31-37 (power 150), Showdown 16-19 (75; `PS/data/moves.ts:4893-4894`); R4-S-SPREADBLAZEKYU-sv: Blaze at 30 HP, app 19-24,
   Showdown 31-37 (`PS/data/abilities.ts:463,470`). Control R4-S-SPREADBLAZEKYU2 / R4-S-ERUPTKYU2 (face at p2b): the Snorlax is
   right. Fix: take the probe from a check whose entry has a search (skip face rows), or split by the attacker's HP whenever
   any target's search reads it.
2. **A face hit's calculated range ignores the attacker's HP.** `doubles-faces.ts:730-736` neutralRow calculates with
   `kernel.calcBuild(w, attacker)` (no HP): R4-S-BLAZEKYU1-sv 52-63 shown, Showdown's getDamage 79-94 (Blaze);
   R4-S-ERUPTKYU2-sv 66-78 vs 33-40; R4-S-TORRENTKYU-sv hit 1 of Water Shuriken. Shown numbers only (the face takes 0).
3. **G-Max Finale's heal is applied after Gulp Missile's damage.** `doubles-max.ts:273-287` heals after the step, and
   finaleGuard (`:486-503`) lists Life Orb, Shell Bell, Jaboca, Rowap, Innards Out and contact sources but not a Gulping or
   Gorging Cramorant target (non-contact, every Max Move). Pinned: self.onHit at `sim/battle-actions.ts:1096`, DamagingHit at
   `:1121`, `PS/data/abilities.ts:1745-1749`. R4-M-FINALEGULP-swsh (full HP Alcremie): app 280, Showdown 245;
   R4-M-FINALEGULP2-swsh: app 251, Showdown 245.
4. **Max Moves' and G-Max moves' stage effects are applied after the target's DamagingHit reactions.** maxEffects runs after
   the step (`doubles-turn.ts:2833`, `doubles-spread.ts:184`, `doubles-faces.ts:425`); pinned self.onHit comes first
   (`sim/battle-actions.ts:1096` vs `:1121`). At a stage cap the order changes the stage: R4-M-FOAMWA-swsh (G-Max Foam Burst
   into Weak Armor Skarmory at Spe +5: app +4, Showdown +5); R4-M-FOAMWAORDER-swsh (the same under the user's Tailwind: Skarmory
   moves 3rd instead of 2nd, Arcanine's Crunch KO 0 vs 0.80, Skarmory "faints (recoil)" 0.80 in the app); R4-M-AIRCOTTON-swsh
   (Max Airstream's partner +1 then Cotton Down -1 at +6: app +6, Showdown +5).
5. **A called move's priority in the calculation is its own, not its caller's.** `doubles-pairs.ts:289-295` frozenContext gives
   no priority for a called move ("a called move is CL's") and `calculate.ts:1244-1258` usedPriority then reads Gale Wings /
   the move's own priority; pinned useMoveInner sets `move.priority = this.battle.activeMove.priority`
   (`sim/battle-actions.ts:410-411`). R4-W-SLPTALKGW-sv: a full-HP Gale Wings Talonflame's Sleep Talk Brave Bird is "blocked
   by Dazzling (+1 priority)" in the app, hits 76-91 in Showdown (priority 0); R4-W-SLPTALKPT-sv: a Prankster Grimmsnarl's Sleep
   Talk Spirit Break (+1) hits 70-84 in the app, Psychic Terrain blocks it in Showdown (`PS/data/moves.ts:14116-14117`). The
   kernel's own shield reads the caller's priority (R4-W-SLPTALKPR matches).
6. **W's continuation keeps a reason for Shell Bell and recoil.** `doubles-pairs.ts:176-177` (`info.recoil || shellBell`)
   gives "Ganlon Berry between the hits of … is not modelled in 2v2." where pinned Showdown sums every hit into
   `move.totalDamage` (`sim/battle-actions.ts:965`) and applies recoil (`:981-982`) and Shell Bell (`PS/data/items.ts:5653-5655`)
   once; T2M §2.5 specified `TurnStepPart.dealt` for it and ADDENDUM2 §9 lists "Shell Bell over both parts". R4-W-GANLONSB-sv,
   R4-W-PBRECOIL-usum. `tests/unit/doubles-pairs.test.ts:295-303` pins the reason.

Minor, not separately reported: G-Max Finale's narrow reasons with Life Orb / Shell Bell / Jaboca / Rowap / Innards Out
(`doubles-max.ts:486-503`) would go with finding 3's fix (heal before the step's user losses: pinned is simple); the
"user faints at the stopped hit" corner of `continueHits` keeps its reason.
