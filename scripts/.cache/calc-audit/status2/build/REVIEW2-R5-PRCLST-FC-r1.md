# Review R5-PRCLST-FC, round 1: PR (presence, Commander, Dancer, rows), CL (calling moves), ST (the start) with FC (field changes)

Read-only review (ADDENDUM2 §8.8 reviewer 5). Branch `calc-2v2-status-2` checked at the start and the end; no repo file
changed except this notes file. Scope: `doubles-presence.ts` (PR), `doubles-calling.ts` (CL), `doubles-start.ts` (ST),
`doubles-fieldchange.ts` (FC), and the kernel lines they touch (`doubles-turn.ts` faint / applyStep / runMove end /
externalUse / useCalled / prioritize / extraStep, `doubles-status.ts` beforeMove / runCalledStatus, `doubles-switch.ts`
field re-settle). Ground truth: pinned Showdown c23d2e94 (`PS/` = node_modules/.cache/champions/pokemon-showdown-c23d2e94…).

Probes (nothing stored): `/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad/reviews/R5-PRCLST-FC-r1/probe-cases.ts`,
run from the repo root with
`npx --no-install tsx /tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad/reviews/R5-PRCLST-FC-r1/run-probes.ts <id-prefix> [-v]`
(the critic's runner: pinned oracle `sim-dfs.ts oracle()` vs `app-turn.ts`, `compare.ts compareCase`). Logs `run1.log` …
`run12.log` in the same folder. 44 probe runs: 20 match (R5-QD-END-BE among them, with an oracle start warning), 8
malformed (learnsets, an item rule, an unknown last move), the rest are the findings and observations below. Stored cases of the four families
(`v3/run.ts T2P- IN-CPY IN-RTL IN-ECV CQ-CMD CQ-ECV T2M-ST T2M-UP T2M-HH`): 185/185 match (`stored-run.log`).
Unit tests by path (`doubles-presence`, `-calling`, `-start`, `-fieldchange`): 143/143 pass; no `it.fails` left.

## Cross-family checklist (SPEC2 §9 + ADDENDUM2 §9), items that involve PR, CL, ST or FC

| Item | Evidence | Result |
|---|---|---|
| A Dancer copying a dance into a hidden target | stored T2P-DAN-11-sv (Petal Dance copy at a Fly user); R2's RH-DANCER-LOCKON | match |
| Instruct on a Pokémon with a carried Encore | stored T2P-INS-07-sv | match |
| Sleep Talk calling a two-turn move (not callable) | stored T2M-ST-03-sv | match |
| Uproar waking it | stored T2M-ST-04-sv, T2M-UP-01-sv/-swsh | match |
| A terrain ending at 27.7 with a Quark Drive holder (FC re-settles) | probe R5-QD-END-sv; stored T2P-FLD-03/03b-sv (sun); Mimicry at the terrain end probe R5-MIM-END-swsh | match |
| Trace copying Intimidate beside a Defiant ally of the foe | stored T2P-TRC-03-sv (modelled), T2P-TRC-03b-sv (the kept reason) | match |
| Counter after a hit into a face (fails) | unreachable with valid inputs: no Disguise or Ice Face holder learns Counter, Mirror Coat, Metal Burst or Comeuppance in any of the four catalogs (`learns.ts`); note: pinned Showdown would NOT fail it (Disguise's 0 is a number: DamagingHit and attackedBy record 0, so Counter/Metal Burst do `0 || 1` = 1), so the checklist's "(fails)" is wrong but no input reaches it | n/a |
| A carried Fly released into Gravity / Smack Down | R2's RA-FLY-GRAV probes; stored INT-SMK-01-sv | (H's; covered) |
| Mist against a mid-turn Intimidate, Snatch, Magic Coat, Transform, Glaive Rush, Spectral Thief, Focus Band, Berry between hits, Cud Chew, the landing | other families (R1–R4) | not mine |
| Lash Out after a switch-in Intimidate in Training | T's (R7) | not mine |
| Test plan: Bide release (C41), Pursuit's combo (C30) in PR's tests; Uproar and Helping Hand twice in CL's | `doubles-presence.test.ts:133, :414`; `doubles-calling.test.ts:314-385, :629`; stored CQ-BID-01..05, CQ-PUR-01/02, T2M-HH-01 | present, pass |

## Further probes that match

R5-DAN-CTRL (control), R5-DAN-DISG (a dance into Disguise is copied), R5-DAN-FAINTED (a foe Dancer's copy at a fainted user
retargets), R5-DAN-EMPTY (empty slot), R5-CTR-STURDY / -SASH (Counter after Sturdy / Focus Sash: 2 × (max HP − 1)),
R5-CTR-UTURN / R5-MB-UTURN (Counter and Metal Burst at a U-turn newcomer), R5-INS-PP3 (control), R5-INS-BB2 (Instruct into
Burning Bulwark), R5-PUP-MC / -SB (Poison Puppeteer through a damaging move's poison), R5-TRC-DL (traced Download),
R5-FC-TURBO-ICE (Turboblaze Snowscape: no Ice Face), R5-FC-WR-MOLD (Teravolt Tailwind: no Wind Rider), R5-FC-FG-MOLD-swsh
(Mold Breaker Sunny Day: Cherrim stays), R5-CPY-NOFOE (Copycat with no foe left).

## Findings

1. **Dancer copies a damaging dance at the dance's user when the dance hit a Substitute** (`doubles-presence.ts:716`
   marks the dance's `target` only when `outcome.landed > 0`; `:242` `last = hit ?? user`; `:248`). Pinned:
   `PS/sim/battle-actions.ts:693` (hitStepAccuracy sets `activeTarget` to the target), `:334-340` (`targetOf1stDance =
   activeTarget`; an ally Dancer copies at it). Probe R5-DAN-SUB-sv / R5-U-DAN-SUB-usum: Volcarona's Fiery Dance into a
   Snorlax's Substitute; ally Oricorio's copy hits Volcarona in the app (108–117 left of 160), the Substitute's Snorlax in
   Showdown (Volcarona untouched). Wrong number, no reason. SV and USUM.
2. **A dance whose effect is undone before the action's end is not copied** (`doubles-presence.ts:197-213 danceDid`, read
   at afterAction `:799` from the net stages and confusion). Pinned: `PS/sim/battle-actions.ts:304` (moveDidSomething is
   useMove's result) and `:317`; White Herb restores at AfterMove (`PS/data/items.ts:7695-7697`, before the Dancer block at
   `battle-actions.ts:310-311`), Persim at the hit's Update (`items.ts:4522-4526`, `battle-actions.ts:967`), Defiant's +2
   nets a Feather Dance to 0. Probes: R5-DAN-WH-sv / R5-U-DAN-WH-usum (Feather Dance into a White Herb Snorlax: its later
   Body Slam 70–84 in the app, 36–43 in Showdown after the copy's −2), R5-DAN-TEETER-sv (Teeter Dance with Persim Berries:
   Oricorio's KO chance 0.754 vs 0.338; the Snorlaxes' self-hits missing), R5-DAN-DEF-sv (the copy step missing).
3. **A Choice-item Dancer's copy ignores the Choice lock** (no choicelock in any `doubles-*.ts`; `doubles-presence.ts:250-253`
   externalUse). Pinned: `PS/data/items.ts:995-997` (Choice Scarf onModifyMove adds choicelock for the copy too),
   `PS/data/conditions.ts:324-348` (onStart takes the active move; onBeforeMove fails any other move). Probes:
   R5-DAN-SCARF-sv (Scarf Oricorio copies Quiver Dance, then its own Hurricane fails in Showdown; the app's Hurricane
   leaves the foe at 135–151 of 235), R5-DAN-SCARF2-sv (the copy after its own Hurricane fails in Showdown; the app gives
   +1 Sp. Atk / Sp. Def / Speed in E2).
4. **Instruct ignores the PP the target used this turn** (`doubles-calling.ts:587-588` fails only `ppLeft === 0 &&
   !thisTurn`; `:613` then states `Assumes {Name}'s {Move} has PP left.`). Pinned: `PS/data/moves.ts:9654-9660`
   (`moveSlot.pp <= 0` fails), PP spent at `PS/sim/battle-actions.ts:281` and Pressure's extra at `:474-482`. Probes:
   R5-INS-PP-sv (1 PP left, used this turn: the instructed Dragon Claw takes the foe to 43–73; Showdown 139–154),
   R5-INS-PRESS-sv (2 PP into Pressure: 107–119 vs 140–146). Control R5-INS-PP3-sv matches.
5. **A strong weather whose holder is knocked out by a hit does not end** (`doubles-turn.ts:3046-3047` faint clears it and
   runs FC's stepField, then `:3057-3059` writes the step's `outcome.conditions.weather` back, since the pre-step world's
   weather is not ""). Pinned: `PS/data/abilities.ts:954-963` (desolateland onEnd clearWeather; primordialsea and
   deltastream alike). Probes R5-FC-PRIMAL2-usum / -PRIMAL3-usum (Primal Groudon knocked out; Blastoise's later Water Pulse:
   no damage in the app, 28–34 in Showdown), R5-FC-PRIMAL-usum (Castform's Weather Ball 31–37 vs 21–25; E2 weather).
   Pre-existing on main 4008ee8 (same numbers on the main tree), but it is FC's trigger (T2P §5.2) and FC's re-settle runs on
   a weather the step then puts back. USUM only.
6. **Needless reason: a caller beside a Dancer when any Pokémon dances** (`doubles-calling.ts:201-205` pools every action's
   move, so Sleep Talk and Nature Power, which can never call another Pokémon's dance, are stopped). Probe R5-ST-DANCER-sv:
   `Sleep Talk with Dancer is not modelled in 2v2.` where the Sleep Talk user's only move is Body Slam; the oracle runs it.
   The Fusion line `:206-207` has the same shape. Lesser.
7. **A called Instruct says `Instruct is not modelled in 2v2.`** (`doubles-status.ts:852` runCalledStatus for an X move
   earlyBranch does not take). Instruct is modelled; the text is not a fact, and Showdown's called Instruct is the direct
   one at getRandomTarget's foe. Probe R5-CPY-INSTR-sv (Copycat after a failed Instruct). Lesser.

Observations (not findings): a traced Intrepid Sword's once-a-battle flag is not in E2 (R5-TRC-IS-sv; no Champions species
has it, so Training never reads it); Order Up has `hasSheerForceBoost` (`PS/data/moves.ts:13066`), so a Sheer Force Dondozo
still gets its rise, which `doubles-presence.ts:766` skips (no Dondozo can have Sheer Force with valid inputs); the
`doubles-presence.test.ts:16` header still speaks of `it.fails`.

Malformed probes: R5-DAN-WH/TEETER/DEF first form (Snorlax does not learn the dances), R5-CTR/MB/MC-DISG (no face holder learns
the moves), R5-FC-SNOW-ICE, R5-QD-END-BE (oracle start used the Energy), R5-INS-FAINTED (the retargeted foe's last move not
given), R5-U-DAN-SCARF-usum (Pom-Pom has no Quiver Dance in USUM).
