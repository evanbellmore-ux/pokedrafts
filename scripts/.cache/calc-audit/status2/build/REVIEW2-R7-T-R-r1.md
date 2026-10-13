# Review R7-T-R, round 1: T1, T2 (Training) with R (wave 2 switch-outs with a replacement)

Read-only review (ADDENDUM2 §8.8). Branch `calc-2v2-status-2`, checked at the start and at the end; no repo file changed except
this notes file. Scope: `app/(app)/training/**` and `scripts/training/**` (T1, T2, R-T: bench, replacement policy,
`replacementOrder`, hazards, prelude replacement, tracker `chose`, Court Change, Healing Wish), `doubles-switch.ts` and R-E's
sites in `doubles-turn.ts`, `doubles-world.ts`, `doubles-eot.ts`, `doubles-calling.ts`, `doubles-presence.ts`, R-U's Bench
(`doubles-inputs.ts`, `BenchFields.tsx`, `doubles-prep.ts addDoublesBench`). Ground truth: pinned Showdown c23d2e94
(`PS/` = `node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353`).

Probes (nothing stored): `$SP/reviews/R7-T-R-r1/cases-r7.ts`, run from the repo root with
`npx --no-install tsx $SP/reviews/R7-T-R-r1/run-r7.ts <id-prefix> [-v]` (`$SP` = the session scratchpad
`/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad`; pinned oracle `sim-dfs.ts oracle()` vs
`app-turn.ts`, `compare.ts compareCase`; oracle results in `out/<id>.oracle.json`, the full run in `out/all.log`). Direct
Showdown scripts: `$SP/reviews/R7-T-R-r1/sd/webs.ts`, `webs2.ts` (hazard order). App-only: `$SP/reviews/R7-T-R-r1/app-only.ts`.
34 probe runs: 23 match; 4 are my malformed probes (below, not findings); 7 are the findings.

Gates re-run here: `vitest --config vitest.unit.config.ts` on `training-status2-{t1,t2,r,r-worker,step1}` and
`training-bridge`: 6 files, 106 tests pass; `doubles-switch`, `status2-r-contract`, `calculator-doubles-bench`: 3 files, 105
tests pass.

## Cross-family checklist (SPEC2 §9 + ADDENDUM2 §9), items that involve T or R

| Item | Evidence | Result |
|---|---|---|
| T: the bridge (public sources only; new mappings; removed rollouts) | `training-status2-t1/t2/r` and `training-bridge` (106 pass); INTEGRATION-2 `leak:training` all 15 rows pass (L1 hashes `engineWorlds`, so bench, replacement, `replacementOrder`, hazards are in it). Read: the player's bench, HP and the "healthiest" pick come from the belief world; `tracker.chose` is fed only the seat's own choices (worker `trackers.p2`, `match.ts` per side) | ok |
| T: the tracker's Stockpile counters | `training-status2-t1` | ok |
| T: `postFromOutcome` and `nextClock` (+ R: newcomers, `benched`, `engineIdKey`) | `training-status2-step1` #7, `training-status2-r` (start ids, newcomer and leaver) | ok |
| T1/T2: splits.ts no longer forks a Protect; the prelude's worlds and their bound | `splits.ts` is the identity; `training-status2-step1` #15 (TR04, TR05, four tied switches above the bound) | ok |
| Lash Out after a switch-in Intimidate in Training (C19) | `training-status2-step1` "#11 / #14 a switch-in this turn: its Intimidate's flags" (statsLowered on the foes, the newcomer switchedIn) | ok |
| Mist against a mid-turn Intimidate (C10), via R's newcomer | R7-MIST-INTIM-sv, -usum; R7-MIST-PACK-sv (no drop, no Eject Pack); R7-MIST-WEB-sv (Mist keeps Sticky Web's drop off) | match |
| Heal Block or Embargo with 1 turn left and a Sitrus (C3, C4), via Baton Pass | Embargo: R7-BP-EMB-usum match. Heal Block: R7-BP-HB-sv, R7-BP-HB2-sv, R7-BP-HB3-champions | **finding 1** |
| Trace copying Intimidate beside a Defiant ally of the foe, via a newcomer | R7-TRACE-INTIM-sv | match |
| Transform / Skill Swapped Protean / Glaive Rush / Octolock passed from Training | `training-status2-t1` (belief = real battle for each) | ok |
| Magic Coat / Magic Bounce sending back a drag (R) | stored CR-ROAR-BOUNCE (G4-SWX) | stored |

## Further probes (all match)

R7-TSPIKES-SG (Safeguard keeps Toxic Spikes off), R7-MIRROR-WEB (Mirror Armor sends Sticky Web's drop to the foe at position 0,
whose Eject Pack is marked), R7-HZ-SITRUS-sv/-champions (Stealth Rock + 3 Spikes, Sitrus at the entry's Update), R7-TSPIKES-LUM,
R7-GRAV-SPIKES (Gravity grounds a Levitate newcomer), R7-TERA-SR (a Terastallized Steel bench Charizard takes 1/16), R7-WEB-WHITEHERB,
R7-INTIM-RATTLED-sv/-usum (gen gating), R7-RC-DMAX-swsh (Red Card used, Dynamaxed attacker stays), R7-DT-DMAX-swsh (no drag),
R7-SRWEB-PRE / R7-SRWEB-DEF-PRE (controls: Stealth Rock created first), R7-PS-MIST-sv (Parting Shot into Mist: no switch).

Not findings (my malformed probes): R7-WEBSR-TURN / R7-WEBSR-PRE (Corviknight is Flying: Sticky Web never applies; replaced by
the Kingambit probes), R7-PS-MIST-champions (Mist is not in Champions), R7-PAYBACK-NEW (Kingambit does not learn Payback in SV),
R7-WEB-CONTRARY (Spinda is not in SV), R7-REGEN-BACK (the oracle harness does not answer a request with a Pokémon that left
earlier: `no bench member left`).

## Findings

1. **Heal Block does not stop an HP Berry at the kernel's Update (`berryDue`): a newcomer that Baton Pass gave Heal Block, and a
   heal-blocked Pokémon freed by an Unnerve leaver or faint, eat their Sitrus.** `app/lib/battle/doubles-turn.ts:2547-2565`
   `berryDue` checks Unnerve, Klutz/Embargo (itemWorks) and the Berserk lock, never `eot.healBlock`; R's sites reach it:
   `doubles-switch.ts:1041` (the entry's Update), `:778` and `:508` (`kernel.unnerveEnds` as an Unnerve holder leaves), and the
   kernel's own `unnerveEnds` (`doubles-turn.ts:2534-2541`). Pinned: `PS/data/items.ts:5753-5754` (Sitrus onTryEatItem runs
   TryHeal), `PS/data/moves.ts:8325-8333` (healblock onTryHeal returns false), `PS/sim/pokemon.ts:1246-1253` (Baton Pass copies
   the healblock volatile with its duration: no noCopy). Repros: R7-BP-HB2-sv and R7-BP-HB3-champions (newcomer at 80 HP, the
   foe's later Body Slam): Showdown KO 56.25 %, Sitrus only after Heal Block ends at the residual; app eats it at entry
   (hpEntered 138, then 50–63, KO 0 %), 22 mismatches each. R7-UNNERVE-UT-HB-sv (Unnerve Corviknight U-turns out; the
   heal-blocked foe at 80): Showdown 80, app 138. R7-UNNERVE-HB-sv (Unnerve Tyranitar knocked out): Showdown 80, app 138. Champions
   has Baton Pass (56 learners) and Psychic Noise's Heal Block, so Training reaches it too.
2. **Entry hazards run in a fixed order, not in the order they were created.** `doubles-switch.ts:1361-1395 hazards()` sums
   Stealth Rock, Spikes and G-Max Steelsurge first, then Toxic Spikes, then Sticky Web (and skips both once the damage knocks the
   newcomer out). Pinned runs the side's SwitchIn hazards in creation order (`PS/sim/battle.ts:994-999` effectOrder,
   `:409` comparePriority, `:3322-3327` initEffectState); `boost()` returns at 0 HP (`:2029`), so a Sticky Web created first
   acts before a Stealth Rock knock-out. Repros: R7-WEBSR-DEF-TURN-sv (Ribombee's Sticky Web, then Garchomp's Stealth Rock this
   turn; Defiant Kingambit at 10 HP comes in: Showdown Defiant +2, the foe's Mirror Herb copies +2 and is used; app: E2
   opponent-left item none 0 vs 1, atk +2 0 vs 1). R7-WEBSR-DEF-PRE-sv (the same from before the turn; the Mirror Herb holder's
   later Body Slam into Snorlax: Showdown 147–174, app 75–88; 40 mismatches). Controls with Stealth Rock created first match.
   `DoublesHazards` carries no order, so the calculator and Training (whose `-sidestart` order is public) cannot pass it.
3. **A bench Pokémon with a Dynamax mechanic comes in Dynamaxed.** `doubles-switch.ts:892-918 newcomer()` keeps the bench build's
   `mechanic`; `doubles-turn.ts:3582ff benchIssues` accepts it (validateBuild only); the calculator's `addDoublesBench`
   (`doubles-prep.ts:362-376`) takes the session-cached build (`roster-prep.ts:689`), which keeps a Dynamax toggled while that
   Pokémon was in a slot. Pinned: Dynamax ends at BeforeSwitchOut (`PS/data/conditions.ts:780-782`) and starts only from a chosen
   move's runDynamax action (`PS/sim/battle.ts:2722`); a newcomer has none. Repro (app only; Showdown cannot hold the state):
   `npx --no-install tsx $SP/reviews/R7-T-R-r1/app-only.ts dmax swsh`: Liepard U-turns, the bench Snorlax comes in at 470 maximum
   HP, Garchomp's Dragon Claw 81–96 leaves 374–389, with the fact `Assumes Dynamax started this turn.`; a Snorlax newcomer has 235
   (139–154 after the hit).
