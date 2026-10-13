# Review R1-A1-K, round 1: A1 (stats, abilities, Transform) with K (the reactions to a hit)

Read-only review (ADDENDUM2 §8.8 reviewer 1). Branch `calc-2v2-status-2` checked at the start and the end; no repo file
changed except this notes file. Scope: `doubles-stages.ts`, `doubles-abilities.ts`, `ability-table.ts`, `intimidate.ts`
(A1) and `doubles-reactions.ts` (K), with the kernel lines they touch (`doubles-turn.ts` faint/koBoost/singleStep,
`doubles-switch.ts` entry, `doubles-use.ts`). Ground truth: pinned Showdown c23d2e94.

Probes (nothing stored): `/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad/reviews/R1-A1-K-r1/probe-cases.ts`,
run from the repo root with
`npx --no-install tsx /tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad/reviews/R1-A1-K-r1/run-probes.ts <id-prefix> [-v]`
(the critic's run-probes.ts: pinned oracle `sim-dfs.ts oracle()` vs `app-turn.ts`, `compare.ts compareCase`). Logs `run1.log` … `run13.log`
in the same folder. 66 probe runs; 59 match, the rest are the findings below (or malformed probes noted).

## Cross-family checklist (SPEC2 §9 + ADDENDUM2 §9), items that involve A1 or K

| Item | Evidence | Result |
|---|---|---|
| Snatch steals Stockpile | probe K1-SNATCH-STK-usum (Snatch is USUM only in the four catalogs) | match |
| Snatch steals Swallow (C1) | stored CR-04-usum, SAT-STK-2f-usum | stored |
| Snatch steals Minimize | probe K1-SNATCH-MIN-usum (the ×2 on the Snatch user) | match |
| Snatch steals Power Trick | probe K1-SNATCH-PTR-usum | match |
| Magic Coat / Magic Bounce: Simple Beam | probes K1-MB-SBM-sv (Magic Bounce), K1-MC-SBM-swsh (Magic Coat) | match |
| … Gastro Acid | probe K1-MB-GAS-sv | match |
| … Worry Seed | probe K1-MB-WSD-sv | match |
| … Topsy-Turvy | probe K1-MB-TOP-sv | match |
| … Entrainment | probe K1-MC-ENT-usum | match |
| Transform after a type change (this turn) | probes K1-TRF-SOAK-sv, -swsh; stored CR-03 (earlier turn) | match |
| Transform after a stored-stat change | probes K1-TRF-PTR-sv (Power Trick), K1-TRF-SPLIT-sv (Guard Split) | match |
| Transform after a Minimize | probe K1-TRF-MIN-sv (evasion copied, no ×2) | match |
| A Skill Swapped Protean (fresh state) | probes K1-SKS-PROTEAN-sv, -champions, K1-SKS-PROTEAN-USED-sv, K1-SKS-PROTEAN7-usum | match |
| Octolock / Syrup Bomb into Defiant beside a foe's Opportunist (C9) | probe K1-SYRUP-OPP-sv; stored CR-05 (Champions Octolock) | match |
| Mist against a mid-turn Intimidate (C10) | probe K1-MIST-INT-sv; stored FS06b (Mirror Armor then Mist) | match |
| Spectral Thief against a foe's Opportunist | unreachable: Spectral Thief is in SwSh/USUM only, Opportunist in SV/Champions only (`has.ts` over the four runtimes) | n/a |
| Trace copying Intimidate beside a Defiant ally of the foe | stored T2P-TRC-03-sv (ST's start Trace); A1's mid-turn Trace needs a Trace holder that found nothing at entry (K1-TRACE-DEF was malformed: the oracle's start Trace copies at once) | stored |
| Lash Out after a switch-in Intimidate in Training (C19) | Training's (T), not this family | not covered here |

## Further probes (A1 and K)

All match: K1-DOODLE-SLOW (Slow Start gained mid-turn: the re-sort and the halved Attack), K1-INT-ADREN (Adrenaline Orb
re-sort), K1-INT-MOLD (a Mold Breaker Skill Swap user's Intimidate passes Inner Focus / Clear Body), K1-DOODLE-EMPTY,
K1-SKS-EMPTYFOE (empty slots), K1-WORRY-YAWN, K1-COSTAR-RP, K1-CURIOUS-RP, K1-WINDRIDER-RP, K1-DOWNLOAD-WR (Wonder Room),
K1-INT-EJECTPACK (mid-turn Intimidate into Eject Pack with a bench), K1-PASTEL-NEWCOMER2; K2-RC-BOTH, K2-RC-GASTRO,
K2-RC-MIST, K2-RC-SHIELD, K2-BB-ALLY, K2-BB-SPREAD, K2-AF-SPREAD-SITRUS, K2-AF-BREAKING-NOBERRY, K2-RH-BREAKING,
K2-ASONE-ALLY, K2-ASONE-ALLY-SP (As One stand-in with a knockout's Chilling/Grim Neigh), K2-OHKO-AF, K2-OHKO-IO,
K2-SHEERCOLD-IO, K2-CE-NEWCOMER-usum/-swsh (Core Enforcer on a mid-turn newcomer), K2-IO-MAGICGUARD, K2-AF-MAGICGUARD,
K2-IO-SUB, K2-RC-MOLD-CTRL.

Unit tests by path: `tests/unit/doubles-stats-abilities.test.ts`, `tests/unit/doubles-reactions.test.ts`: 110/110 pass; no
`it.fails` left.

## Findings

1. **Ability Shield on a Klutz holder is treated as not working** (`doubles-abilities.ts:107-111 shielded` uses
   `kernel.itemWorks`, which is false for Klutz). Pinned `data/items.ts:8 abilityshield ignoreKlutz: true` and
   `sim/pokemon.ts:885 ignoringItem` keep the Shield working under Klutz (the rest of the app checks only Magic Room).
   Probe K1-KLUTZ-SHIELD-sv: Wyrdeer's Skill Swap with Golurk (Klutz, Ability Shield) fails in Showdown; the app swaps, the
   new Intimidate drops Wyrdeer's side and Snorlax's later Body Slam reads 54–64 where Showdown has 81–96. Also
   K1-KLUTZ-SHIELD-SBM-sv (Simple Beam), K1-KLUTZ-SHIELD-GA-sv (Gastro Acid). Wrong number, no reason. SV only.
2. **Receiver / Power of Alchemy's copied Start ignores the active move's Mold Breaker** (`doubles-reactions.ts:453-457
   receive` → `doubles-abilities.ts setAbility` with no `use`, so `changeOf`'s breaker is `() => false`). Pinned: the
   faint batch runs inside the knocking move (`sim/battle-actions.ts:976`), so `sim/battle.ts:365-368 suppressingAbility`
   still holds for the attacker's move with `ignoreAbility` (`data/abilities.ts:2693 moldbreaker onModifyMove`), and
   `sim/battle.ts:836-840` skips breakable TryBoost handlers (Clear Body, Mirror Armor, Hyper Cutter, Inner Focus…) of the
   attacker's side. Probe K2-RC-MOLD-sv: Excadrill (Mold Breaker) knocks out Incineroar, Passimian receives Intimidate,
   Metagross's Clear Body is suppressed in Showdown (its Body Slam 34–40), the app blocks the drop (50–59). K2-RC-MOLD-MA-sv:
   Mirror Armor suppressed (23–28 vs the app's 34–41). Control K2-RC-MOLD-CTRL-sv (no Mold Breaker) matches.
3. **Pastel Veil's onAnySwitchIn is not modelled for a newcomer** (`doubles-switch.ts:1021-1024` lists White Herb, the
   copies and Eject Pack as everyone's onAnySwitchIn; `data/abilities.ts:3204-3206 pastelveil onAnySwitchIn` re-runs the
   holder's Start, curing a poisoned newcomer). Probe K1-PASTEL-NEWCOMER-swsh: the poisoned U-turn newcomer beside
   Galarian Rapidash takes 29 poison damage at the end of turn in the app; Showdown cures it at the switch-in (no residual).
   SwSh only (Pastel Veil is in no other catalog). Owner of the line: R-E; the Start itself is A1's table.
4. **Needless reason: Transform into a Dynamaxed target** (`doubles-abilities.ts:742 REASONS.transformMax`). Pinned
   `sim/pokemon.ts:1270-1279 transformInto` has no Dynamax check and no mod overrides it; the copy is the ordinary one.
   Probe K1-TRF-DMAX-swsh: the oracle runs it plainly; the app is not estimated.
5. **Needless reason: a spread move's Aftermath with a Berry on the user** (`doubles-reactions.ts:384-399
   spreadRetaliation`, `berry` → reason). Pinned order (`data/abilities.ts:78-84 aftermath`, the Update after the hits in
   `sim/battle-actions.ts:967`) is the same as Rocky Helmet's, which the app follows exactly with a Sitrus (control
   K2-RH-BREAKING-sv matches; K2-AF-BREAKING-NOBERRY-sv matches). Probe K2-AF-BREAKING-sv: "Breaking Swipe with Aftermath
   is not modelled in 2v2." Documented as deliberate in W1B-K.md; a lesser defect.

Malformed probes (not findings): K1-TRACE-DEF (the oracle's start Trace copies at the lead), K1-TRF-FOCUS (Kingambit has
no Focus Energy), K1-MIST-INT-MA (Stantler is not in SwSh).
