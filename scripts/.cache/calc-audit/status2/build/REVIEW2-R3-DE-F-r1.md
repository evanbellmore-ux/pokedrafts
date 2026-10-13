# Review R3-DE-F, round 1 (ADDENDUM2 §8.8 reviewer 3: D, E1, E2 with F)

Branch `calc-2v2-status-2` (checked at start and end). Read-only: no repo file changed but this note.
Scope: `doubles-guards.ts`, `doubles-spread.ts` (D), `doubles-eot.ts`, `residuals.ts` (E1, E2), `fling.ts` and its sites in
`calculate.ts` / `uses-to-ko.ts` (F), and the kernel lines they touch (`doubles-turn.ts` applyStep / searchFor stand-ins,
`doubles-start.ts` item settle for D's carried lock, `uses-to-ko.ts` attackerAte / OHKO fixed hit).

Probe harness (nothing stored): `/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad/reviews/R3-DE-F-r1/`
`probes.ts` (cases) and `run.ts` (pinned oracle `sim-dfs.ts` + `app-turn.ts` + `compare.ts`, as R2's). From the repo root:
`npx --no-install tsx /tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad/reviews/R3-DE-F-r1/run.ts <id prefix> [-v]`

Gates run here: stored family cases `v3/run.ts G4- CR- T2E- IN-FLD IN-TNT IN-CUD IN-FSL IN-TLK IN-HBK CQ-ETT-03 CQ-ALY IN-SEC IN-ACC-02`:
400/403 (the 3 are the known stale expectations G4-SFL-01-champions `notEstimated`, G4-WHR-01 ×2 `endNotEstimated`, which
integration re-expects); `golden-1v1.ts --check`: 254 cases byte-equal; unit: doubles-eot, residuals, doubles-guards-* (6),
fling-1v1, calculator-max-fling: 178/178; calculator-uses-to-ko* (7 files, unchanged since main): 203/203; doubles-turn-guards
20/20; tests/source/status2-hooks 8/8 (doubles-residuals and stolen-berries need the compiled pinned dex, absent in this
container: environment, not a finding).

## Findings

1. **A carried Berserk / Anger Shell lock is ignored by the turn-start settle** (`doubles-start.ts:541-547`: `hidden` covers a
   kept Custap and a carried Heal Block only). With `carried.berryLocked` (the calculator's "Berry locked" control,
   `doubles-inputs.ts:593`; Training's bridge) and HP at half or less, the app eats the locked Sitrus at the turn's first
   Update. Pinned: `PS/data/abilities.ts:421-426` berserk onTryEatItem returns `checkedBerserk` (false) for the healing
   Berries (angershell `:150-155`), so `PS/data/items.ts:5748-5750` sitrusberry onUpdate's eatItem fails; nothing resets it
   while the holder only attacks a foe. Probe `RD-BZK-START-sv/-swsh/-usum`: start and final HP 70 in Showdown, 111 / 108 in
   the app, ready, no reason. Wrong number.
2. **The locked Berry's Leftovers stand-in is visible to item-reading moves** (`doubles-guards.ts:309-318` sheerForceLock →
   `doubles-turn.ts:2807-2808` → searchFor `:903-905`; spread `doubles-spread.ts:102-103`). Thief / Covet take "Leftovers",
   Bug Bite / Pluck (and Incinerate) find no Berry. Pinned: `PS/data/moves.ts:19312-19322` thief onAfterHit takes the held
   Sitrus; `PS/data/moves.ts:1920-1928` bugbite onHit eats it (the lock only stops the holder's own TryEatItem). Probes
   `RD-BZK-THIEF2-sv/-swsh/-usum` (the thief at 70 HP: Showdown eats the Sitrus, 108 / 106; app 70, then Leftovers +9 at the
   end of turn, E2 item "leftovers"), `RD-BZK-BUGBITE2-sv/-swsh/-usum` (Scizor 136 in Showdown, 100 in the app; the holder 50
   vs 91, the app's holder keeps and later eats the Sitrus). Same root cause in C14's heal-block stand-in
   (`doubles-turn.ts:897, :905` healStandIn; A2/A3's): `RD-HB-BUGBITE-sv/-usum` (Scizor 136 vs 100). stepItems then also books
   the holder's real Berry as used (`doubles-turn.ts:3124-3130`). Wrong numbers, no reason.
3. **The attacker's Starf Berry eaten between a multi-hit move's hits does not raise the later hits** (`uses-to-ko.ts:4103-4105`
   attackerAte marks `report.starf` and the loop goes on; `doubles-guards.ts` starfRise applies the stat at the action's end).
   Pinned: `PS/sim/battle-actions.ts:967` eachEvent('Update') after every hit; starfberry onEat (`PS/data/items.ts:5985`) raises a random stat by 2 in place for
   the next hit. Probe `RD-STARF-MULTI-sv/-swsh` (Cinderace at 60 HP with Starf, Double Kick into a Rocky Helmet Snorlax):
   Snorlax min 101 / average 143.975 in Showdown, 143 / 151.75 in the app; hit max 134 vs 92. Ready, no reason. (The target's
   Starf between hits is right: `RD-STARF-TGT-sv` matches.)
4. **Parental Bond with a one-hit KO move loses its second hit** (D's OHKO model: `doubles-guards.ts:488` ohkoStep → the row
   `calculate.ts:2758-2768`, the fixed hit `uses-to-ko.ts:2807, :2912`). Pinned: `PS/data/abilities.ts:3170-3176` parentalbond
   makes any non-excluded move hit twice (OHKO moves are not excluded), `PS/sim/battle-actions.ts:1606` each hit deals
   `target.maxhp`. Probes (USUM Mega Kangaskhan's Fissure) `RD-OHKO-PB-usum` (Focus Sash Snorlax: knocked out in Showdown, 1 HP
   in the app), `RD-OHKO-PB-DISGUISE-usum` (Mimikyu: KO vs 130), `RD-OHKO-PB-SUB-usum` (Substitute: KO vs 235). Wrong numbers,
   no reason.
5. **Needless reason: a flung Custap Berry** (`doubles-guards.ts:734`, REASONS.flungCustap). Pinned custapberry's `onEat() { }`
   is empty (`PS/data/items.ts:1235-1256` custapberry): the target eats it with no effect, its later action runs as queued
   (guards.md §4.5's premise is wrong). Probe `RD-FLING-CUSTAP-sv`: oracle ready; app "Custap Berry flung at Snorlax
   (opponent's, 1) is not modelled in 2v2." Minor.
6. **Needless reason: an Encore rewrite whose priority differs with no reader present** (`doubles-guards.ts:414`). Pinned
   `PS/sim/battle-actions.ts:227-234` keeps the queued priority; only Quick Guard, Psychic Terrain, the priority shields and
   Prankster-into-Dark read it, none in play. Probe `RD-ENC-PRIO-sv` (Prankster Encore into Scizor, queued Bullet Punch, last
   move X-Scissor): oracle ready; app "Encore changes Scizor's move: not modelled." Minor.

## Cross-family checklist (SPEC2 §9 and ADDENDUM2 §9 items that involve D, E1, E2 or F)

| Item | Evidence |
|---|---|
| Octolock into Defiant beside a foe's Opportunist (C9) | stored CR-05-champions, CR-05-swsh (agree) |
| Syrup Bomb into Defiant beside a foe's Opportunist (C9) | probe `RE-SB-DEF-sv` match |
| Teatime with Pickup and Harvest in play (C8) | stored CR-09a-sv, CR-09a-champions, CR-09b-sv |
| Heal Block / Embargo with 1 turn left and a Sitrus (C3, C4) | stored CR-01a/b/c-sv, CR-02a/b/c-usum |
| Glaive Rush on a holder that moves first (C5) | stored CR-10e; probe `RE-FS-GLV-sv/-champions` (a landing into this turn's Glaive Rush user: ×2) match |
| Mist against a mid-turn Intimidate (C10) | A3's; stored CR-06 (agrees) |
| Spectral Thief against a foe's Opportunist | no game has both (Opportunist and Mirror Herb: SV, Champions; Spectral Thief: SwSh, USUM; learner check): the ledger cannot meet it |
| Cud Chew re-eating a Berry Bug Bite took (not counted) | stored cases-t2e-1b.ts:212 (T2E Bug Bite case) |
| The landing into a Pokémon that Protected (hit) / charging Dig (missed) | stored cases-t2e-1b.ts FS06c, FS14 |
| A terrain ending at 27.7 with a Quark Drive holder | stored T2P-FLD-03/03b (E2 → FC's eotField) |
| Focus Band on the hit Disguise takes | W's (doubles-pairs focusBand); not probed here |
| 1v1: golden byte-equal except F's rows; calculator-uses-to-ko* unchanged | `golden-1v1 --check` 254 byte-equal; no calculator-uses-to-ko test changed since 4008ee8, 203/203 pass |
| D: the copier ledger from a newcomer (readers) | probe `RD-OPP-NEW-sv/-champions` match |
| E1: Harvest with the sun ending at order 1 | probe `RE-HRV-SUNEND-sv` match |
| E2: Cud Chew Berry eaten at the sand's Update, re-eaten at 28.2 | probe `RE-CUD-SAND-sv` match; stored CC02 |
| E2: Cud Chew re-eat under Magic Room | probe `RE-CUD-MR-sv` match |
| E2: Moody beside a foe's Opportunist | probe `RE-MOODY-OPP-sv` match; stored MO05 |
| E2: fresh Taunt on a mid-turn newcomer (activeTurns 0) | probe `RE-TAUNT-NEW-sv` match |
| E1: Speed Boost on a mid-turn newcomer | probe `RE-SPB-NEW-sv/-swsh` match |
| E1: Octolock's source leaving by Eject Button | probe `RE-OCTO-LEAVE-swsh/-champions` match |
| D: OHKO with Mold Breaker into Sturdy; level gap; Ice Face | probes `RD-OHKO-MB-sv`, `RD-OHKO-LVL-usum`, `RD-OHKO-ICEFACE-sv` match |
| D: Fling under a foe's Neutralizing Gas with Klutz | probe `RD-FLING-KLUTZ-GAS-sv` match |
| D: Fling Life Orb into a Substitute / Ice Face; Fling Shell Bell | probes `RD-FLING-LO-SUB-sv`, `RD-FLING-LO-ICEFACE-sv`, `RD-FLING-BELL-sv` match |
| D: spread drain into a Liquid Ooze Substitute | probe `RD-SPH-SUBOOZE-sv` match |
| D/E2: Ripen's weakened Berry and a landing | probe `RD-RIPEN-FS-sv` match |

## Looked at, no finding

- Texts of the five files: facts with `kernel.names`, sides as "your side" / "the opponent's side", no instructions.
- Readers rule: stepReport (rises / starf / dealt) and tracksItems read the occupant views and the bench (readersOf); Moody and the
  forms branch only in E2 or with a reader; the landing's per-value recording runs on discarded clones.
- E1's Leech Seed / Liquid Ooze / Heal Block tie is deterministic (subOrder), as E1 found against SPEC2's table.
