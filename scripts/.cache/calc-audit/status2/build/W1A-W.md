# Track W (status2 wave 1a): the pair's environment

Branch `calc-2v2-status-2` (checked before and after the work). Owns `app/lib/battle/doubles-pairs.ts` and
`tests/unit/doubles-pairs.test.ts` only. Implements tier2-moves.md §3.5, §3.14–§3.18, §3.27 as ADDENDUM2 assigns them (§2.3
#6, #16–#20, #50), plus two silent wrong numbers found on the way (Gale Wings in generation 8+, Spicy Spray through the user's
side's Safeguard). Nothing committed; no frozen file edited; node_modules, `.claude/`, CastMirror and RaidCard files untouched.

Working files: `scripts/.cache/calc-audit/status2/build/w1a-w/` (cases-w.ts, run-w.ts, make-tree.py, make-base.py,
kernel-lines.patch, the configs, results/).

## 1. What is modelled, and where it stands

Pinned Showdown c23d2e94 is the ground truth of every rule (PS/ = the read-only source).

| Entry | Model | Needs a kernel line? | Today (no line) |
|---|---|---|---|
| ally-effect (#6) | `allyShield` is a no-op: the kernel's priorityShield reads foes only, and the calculation reads `BattleConditions.allyTarget` (conditionsFor already sets it; calculate.ts skips the ally's Dazzling/Queenly Majesty/Armor Tail and Psychic Terrain's block) | no | **live, exact** |
| focus-band (#16), a damaging hit | `stepEnv` sets `UsesEnv.focusBand` for a target with a working Focus Band (singleStep, spreadStep, a hit after a Substitute, a residual landing); `focusBand` is a no-op | no | **live, exact** |
| focus-band, its fact | `hurt`: on a one-hit move, the saved mass is a ninth of the knocked-out mass (each knocking roll 9/10 knocked, 1/10 at 1 HP): `Focus Band: {Name} keeps 1 HP.` | L2 (`target`, `before`) | no fact |
| focus-band, the confusion self-hit | `selfHitBand(…, dist)` rewrites the self-hit's loss distribution (1/10 of each knocking loss becomes −loss), `bandedLoss` keeps 1 HP after Endure/Sturdy/Sash; loss fact `Focus Band: {Name} keeps 1 HP.` with its chance | L6–L8 | `Focus Band is not modelled.` |
| berry-between-hits (#17) | `stepEnv` sets `UsesEnv.betweenHits` (a move that can hit more than once into a working Ganlon, Apicot, Starf, or Lansat + Cheek Pouch that no foe's Unnerve stops); `continueHits` (L1) eats the Berry at the stopped hit's Update (`berryDue`: Cheek Pouch, ateBerry's rise with Ripen/Contrary/Simple, Starf one world per raisable stat at 1/n, Unburden), records the stopped part (field, stat flags, a Gem used), and continues with `applyStep(…, { caseIndex, skip })` on the search for the new build; hit fact `{Name} eats its {Berry} after hit {h}: +1 Defense.`; a random hit count is split by `hitCounts` (L11) into one world per count at Showdown's chance (`MoveDamageResult.hitChances`), the count given through the context hook (L4: `MoveContext.hits`) | L1, L3, L4, L11, flag `continuation` | today's guard, `{Berry} between the hits of {Move} is not modelled in 2v2.` |
| aria-faint (#18) | `MonState.faintedInHits` written by `hurt` (Destiny Bond after the step; a knocked Destiny Bond holder; `outcome.attackerFaintedInHits` from the step, asked for with `report.faintedInHits`) and by `userLosses` (D's spreadStep: a faint in the first loss group); `ariaFaint`: fainted in the hits or no working Life Orb: no cure; else Life Orb knocked it out after the hits: it cures as a living user does | L2, L3, L9, L10, D's spreadStep line, flag `faintedInHits` | Destiny Bond **live, exact**; Life Orb: today's guard `Sparkling Aria's burn cure after {Name} faints in the move is not modelled in 2v2.` |
| gale-wings-gen7 (#19) | `frozenContext` → `MoveContext.frozenPriority` (calculate.ts usedPriority reads it): generation 7, the priority sorted at the turn's start for a Gale Wings user's Flying move (or a priority that differs from the one it has now); **generation 8+, the priority it has now** (see §3) | L4, flag `frozenContext` | today's guard `Gale Wings is not modelled in 2v2.` (gen 7); gen 8+ silently wrong (§3) |
| assurance-own-hp (#20) | `hurt` sets the followed user's `hurt` where one of its own-loss sources dealt damage (`ownLoss`: recoil not Rock Head, Steel Beam/Chloroblast, Life Orb after any hit (not Sheer Force with secondaries; Pickpocket took it first: none; Thief/Covet took one: yes); with `target`/`before` also Rough Skin, Iron Barbs, Rocky Helmet on contact, a Jaboca/Rowap it ate (not Bug Bite/Pluck/Incinerate), Liquid Ooze on a drain, Gulp Missile, Wandering Spirit's swapped Rough Skin from hit 2, Aftermath/Innards Out on the knocking hit) and drops `ownHP` wherever it can tell, so `assurance`'s guard narrows by itself | attacker-side sources: no; target-side: L2 | recoil, Life Orb, self-cost **live, exact**; the rest today's guard |
| safeguard-damaging-status (#50) | `stepEnv` sets `UsesEnv.safeguard` when the target's side has Safeguard (this turn or `SideConditions.safeguard`) and the user is another Pokémon (an ally's move too: `target !== source`) without an Infiltrator move into a foe; `safeguard` is a no-op | no | **live, exact** |
| Spicy Spray vs the user's side's Safeguard (found) | the calculation's Spicy Spray reads `conditions.attackerSide.safeguard` (L12 + F's calculate.ts line) | L12 + F | narrow guard `Spicy Spray with Safeguard is not modelled in 2v2.` (was silently wrong) |

The flags (`doubles-pairs.ts` `WIRED`) keep each part's today's behaviour until its lines are in; `hurt` and
`selfHitBand` read their new arguments themselves (their flags only tell the tests).

Narrow reasons kept inside the modelled entries (each fires only there; tests in doubles-pairs.test.ts):
- `berryBetweenHits(item, move)` when the stopped hits reach a **recoil** (Parental Bond Double-Edge) or a **Shell Bell**
  (the continuation part's recoil and Shell Bell read only its own hits' damage: uses-to-ko.ts afterHitsLosses, and
  `TurnStepPart.dealt` is not in the node key), and when the **user faints at the stopped hit** (Rough Skin, Iron Barbs, Gulp
  Missile with one of these Berries: the move ends at that Update, which a part cannot give). **Keep the REASONS key.**
- uses-to-ko's `A Berry between the hits of a random hit count is not followed in 2v2.` now only for a random count whose row
  has `attackerFaintsOnHit` (hitCounts does not split it).
- `notIn2v2("Assurance")` (with L2): only where Magic Guard changed during the hits (Mummy, Lingering Aroma, Wandering Spirit)
  and a target-side source was in play.

## 2. Kernel lines for the integrator (exact; `w1a-w/kernel-lines.patch`, validated by make-tree.py)

`kernel-lines.patch` is the unified diff of the snapshot `w1a-w/live/battle` against `w1a-w/tree/battle` (CR ignored).
`make-tree.py` applies each line with an exact single-match replacement; `python make-tree.py` then
`TSX_TSCONFIG_PATH=…/w1a-w/tsconfig.tree.json` runs the harness, `npx vitest run --config …/w1a-w/vitest.tree.config.mts` the tests.

doubles-turn.ts:
- **L1** applyStep, right after `receiver.build = targetStandIn ? … : fromSide(receiver.build, outcome.target);`:
  `if (outcome.stopAt !== undefined) { out.push(...pairHooks.continueHits(kernel, next, action, target, entry, info, outcome, before, part)); continue; }`
- **L2** applyStep: `pairHooks.hurt(kernel, next, action, outcome, info, follow);` → `pairHooks.hurt(kernel, next, action, outcome, info, follow, target, before);`
- **L3** applyStep's child signature: append `, outcome.stopAt, outcome.attackerFaintedInHits` after `outcome.conditions.defenderSide.auroraVeil` (so a stopped use and a faint in the hits are not merged with other outcomes).
- **L4** contextFor, after the `helpingHands` line:
  `const paired = pairHooks.context(kernelOf(ctx), w, action, info); if (paired) Object.assign(context, paired);`
- **L11** damagingMove: `else after = singleStep(ctx, world, action, info, checks[0]);` →
  `else after = pairHooks.hitCounts(kernel, world, action, info, checks[0]).flatMap((part) => singleStep(ctx, part.world, part.action, info, checks[0]));`
- **L12** conditionsFor's `side()`: after `if (state.luckyChant) out.luckyChant = true;` add `if (state.safeguard) out.safeguard = true;`
  (also what F's Fling already reads: `conditions.defenderSide.safeguard` in flungStatusLands).

doubles-status.ts (confusionHit):
- **L6** `pairHooks.selfHitBand(kernel, w, slot, values);` → `pairHooks.selfHitBand(kernel, w, slot, values, dist);`
- **L7** `let damage = loss, used = false;` → `let damage = Math.abs(loss), used = false;`
- **L8** after the Sturdy/Sash line: `damage = pairHooks.bandedLoss(loss, hp, damage);`

uses-to-ko.ts:
- **L9** `TurnReportAsk` gains `faintedInHits?: true`.
- **L10** `if (m.koRetaliation && end.hp <= 0) state.report = …` → `if ((m.koRetaliation || m.report?.faintedInHits) && end.hp <= 0) state.report = …`

doubles-pairs.ts: set `WIRED` to all `true` with the lines (or delete the flag and the fallbacks it guards:
`betweenHits`' guard body, `frozenPriority`'s guard body, `ariaFaint`'s `notEstimated`, the Spicy Spray guard in `stepEnv`,
`selfHitBand`'s `!dist` branch). Once wired, `pairHooks.frozenPriority(…)` in damagingMove and `pairHooks.betweenHits(…)` in
applyStep are no-ops and may be removed with their status2-hooks.test.ts rows.

Failing tests that pass once the lines are in (run on the patched tree: 21/21): doubles-pairs.test.ts's wired branches
(`WIRED.*` true): the Focus Band fact, the self-hit, Rocky Helmet and drain Assurance, Gale Wings USUM and SV, every Berry
between hits test (Ganlon, Bonemerang, Starf ×2, Lansat + Cheek Pouch, Apicot, Water Shuriken's random count, the three
corners), Sparkling Aria with Life Orb (spread and single), Spicy Spray with Safeguard.

Tests outside W's files to update at integration:
- `tests/unit/doubles-turn-guards.test.ts` "Focus Band when a hit into it can knock out, and Max Guard": the Focus Band half
  is now estimated (Snorlax at 20 HP @ Focus Band vs Dragon Claw: KO 0.9, 1 HP 0.1); keep the Max Guard half.
  "Psychic Terrain or the target's own priority shield against its ally's priority move": both now estimated (Ice Shard hits
  the ally). (Live now: W's no-op allyShield and the Focus Band env.)
- `tests/unit/doubles-engine-verify.test.ts` (once wired): "is not estimated where it would be eaten between two hits of one
  move (VE-F1-10, VE-F1-13)" → ready; VE-F1-10 oracle: opponent-left 100 → 0–60, KO 0.12, average 35.695529785156246, own-left
  Cinccino 0–150 (KO 0.16097656249999776, average 64.69158447265644); VE-F1-13: opponent-left 3–60, average 40.13306884765624,
  own-left 57–72, average 64.9375. "is not estimated where Life Orb may be what knocked the user out (VE-H5-6)" → ready, the
  burn cured, opponent-left 136–152 (average 144.5), opponent-right 103–111 (average 107.25).
- `tests/source/status2-hooks.test.ts`: CALLS rows for the new calls (`pairHooks.continueHits(` in applyStep after
  `reactionHooks.unnerveRecoil(`'s predecessor line, `pairHooks.context(` in contextFor before `presenceHooks.context(`,
  `pairHooks.hitCounts(` in damagingMove, `pairHooks.userLosses(` in doubles-spread.ts spreadStep); the MOVED rows stay valid
  (every export kept).
- REASONS (doubles-actions.ts): `allyEffect` has no site left (remove); `focusBand` and `ariaFaint` lose their last site once
  `selfHitBand` and `faintedInHits` are wired; **keep** `berryBetweenHits` (the three corners); the `notIn2v2` sites for Gale
  Wings and Safeguard go with the wiring / now; Assurance's stays (narrow); `combo` gains the Spicy Spray site until L12 + F.

## 3. Found on the way

- **Gale Wings in generation 8+ (silent wrong number, live today):** the calculation reads Gale Wings at full HP (calcBuild's
  build holds no HP), so a Talonflame hit before it moves still gets +1 in the calculation: SV Brave Bird into Armor Tail
  Farigiraf after a faster Extreme Speed is 0 damage in the app, 76–91 in Showdown (W-GW-01-sv: Showdown re-sorts, priority 0);
  likewise on Psychic Terrain (W-GW-03-sv). `frozenContext` gives the calculation the kernel's own priority (L4).
- **Spicy Spray through the user's side's Safeguard (Champions, silent wrong number):** `source.trySetStatus('brn', target)` is
  stopped by the user's side's Safeguard (`target !== source`); calculate.ts spicySprayFirstBurnedHit does not read it
  (W-SGX-01-champions: Showdown no burn, the app burns). Narrow guard now; L12 + F's line model it.
- The Step 1 kernel's Struggle recoil goes through afterLoss, which sets `hurt`; Showdown's struggle recoil is directDamage,
  which sets no hurtThisTurn (an Assurance into a Struggle user after its Struggle). Not W's file; noted for the integrator.

## 4. Requests to other tracks

- **D** (doubles-spread.ts spreadStep): take the user's losses through W's `userLosses` (the line in kernel-lines.patch:
  `import * as pairNs from "./doubles-pairs"; const pairHooks = { ...pairNs };` and
  `out.push(...(losses.length ? pairHooks.userLosses(kernel, world, action, info, losses) : [world]));`). It splits only for a
  Sparkling Aria user (a faint in the first group is one in the hits); every other move is `kernel.afterLoss` as now.
  Also: D's OHKO fixed hit and the Counter family's fixed hits are Move damage, which a Focus Band holds 1/10.
- **F** (calculate.ts spicySprayFirstBurnedHit): `if (conditions.attackerSide.safeguard) return null;` after its first line (with L12).
- **V1** (compare.ts, cases): (a) a stopped use (the target's Berry eaten between two hits: `|-enditem|<target>|<Berry>|[eat]`
  between two `-damage` lines of one move) has path-dependent sums; the app's hit is the calculations it met: apply the same
  covering rule as `truncated` (T2M-BE-02-swsh, T2M-BE-03 usum/swsh, VE-F1-10, VE-F1-13: every number else agrees);
  (b) T2M-FB-03 (No-move self-hit at 10 HP): `losses (confusion self-hit range)` compares the capped HP delta (9–10) with the
  app's raw self-hit damage (23–28, the skipped fact's convention); compare raw, or give the Snorlax an action (W-FB-03 does
  and agrees); (c) the E2 stage mixture should skip outcomes where the Pokémon fainted (Showdown clears a fainted Pokémon's
  stages; VE-F1-10's Starf worlds that faint keep +2 in the app's build); (d) changed cases with the wiring: VE-F1-10,
  VE-F1-13, VE-H5-6 (now estimated; they agree but for (a) and (c)); live now: IN-SFG-01, T2M-ALE, T2M-AS, T2M-FB-01/02,
  T2M-SG-01 (all agree).
- **K**: in a W continuation the outcome's `subHits` counts the stopped part's hits on the Pokémon (not a Substitute's), so a
  per-hit reaction counted from `landed` alone (Cotton Down) needs `landed + subHits` there.

## 5. Verification

- V1's stored oracle results for W's gate (`compare.ts T2M-ALE T2M-FB T2M-BE T2M-AR T2M-GW T2M-AS T2M-SG IN-SFG --no-write`):
  live tree 23/32 (the rest are the wired parts' today's texts and T2M-GW-02's reverse Gale Wings case, wrong today);
  patched tree 27/32, the five left being V1's (a) T2M-BE-02-swsh, T2M-BE-03-usum/-swsh (`hit.min/max` only) and (b)
  T2M-FB-03-sv/-swsh (the losses text range only): every HP, KO chance, average, low, high and E2 value agrees.
- W's own cases (`w1a-w/cases-w.ts`, 39, run-w.ts with V's comparator): live 18/19 unwired (W-GW-01-sv is §3's live bug);
  patched tree 35/39: the 4 left are V1's (a); W-BEX-01…03 give the corner texts.
- Every stored case (1932, step0a-run-app.ts): W's file against the Step 0 doubles-pairs.ts on one snapshot: only IN-SFG-01,
  T2M-ALE, T2M-AS, T2M-FB-01/02, T2M-SG-01 change (all agree with the oracle); with the kernel lines also T2M-AR-01,
  T2M-BE, T2M-FB-03, T2M-GW-02, VE-F1-10, VE-F1-13, VE-H5-6.
- Unit tests: doubles-pairs.test.ts 20/20 live, 21/21 (with wired.test.ts) on the patched tree. The doubles, status2 and
  calculator suites: with W's file against the Step 0 file, the only new failures are the two doubles-turn-guards rows above;
  on the patched tree also the two doubles-engine-verify rows above. tsc: no error in W's files (the tree too); eslint clean.
