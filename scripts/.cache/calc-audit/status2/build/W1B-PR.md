# Track PR (wave 1b): presence, Commander, Dancer and the history rows (`app/lib/battle/doubles-presence.ts`)

Branch `calc-2v2-status-2`, checked before the work and before this report. Owned files only:
`app/lib/battle/doubles-presence.ts`, `tests/unit/doubles-presence.test.ts`. Scratch work in `status2/build/w1b-pr/`.
Nothing committed, pushed or switched; no `next build`; nothing against live Supabase; `node_modules` and `.claude/`
untouched; no CastMirror or RaidCard file opened. Spec: ADDENDUM2 §4.3 PR; T2P §2, §3.1–§3.8, §3.17, §6.1; C25, C30, C41.

## What is modelled now (pinned Showdown c23d2e94)

| Mechanic | Model | Fact / reason texts |
|---|---|---|
| Commander (SV) | Tatsugiri (Commander, not transformed, not under the gas) with an ally Dondozo goes inside as they come in (`MonState.commanding` / `commanded`): its action is dropped, every move misses it (`invulnerable`), neither can leave, Dondozo's faint ends it. Neutralizing Gas from the lead stops it (sim/pokemon.ts ignoringAbility: suppressed before Commander's onUpdate; PR-CMD-02). Order Up: +1 Atk / Def / Spe by Tatsugiri's form. | `Assumes {Tatsugiri} went inside {Dondozo} as they came in.` (turn); `Inside {Dondozo} (Commander).` (skip); `{Move} misses {Tatsugiri} (Commander).`; `Order Up: {Dondozo} +1 Attack.` |
| Poison Puppeteer (SV) | `afterSetStatus`: a poison it gives confuses (unless Own Tempo or confused). | `Poison Puppeteer: {Name} becomes confused.` (on the hit once setStatus passes the use) |
| Dancer | After a dance's AfterMove that did something (self dances: a boost changed; Feather Dance: the target's Attack fell; Teeter Dance: a new confusion; Lunar Dance: the user fainted; a damaging dance: a hit landed): each other Dancer, stored Speed ascending, a tie by entry order (`entryTie`, else `needsEntryOrder`), copies it as an inserted action with its own BeforeMove at `!target.isAlly(dancer) && user.isAlly(dancer) ? target : user`. | `Dancer: {Name} copies {Move}.`; `Dancer needs whether {A} or {B} came in first.` (REASONS.needsEntryOrder) |
| Round | A later Round pulled next (`kernel.prioritize`, source "round"): 120 power. | `Round: {Name} moves next.` |
| Fusion Bolt / Flare | ×2 after the other's `lastSuccessfulMoveThisTurn` (moveDidSomething: a hit landed or met a Substitute). A No move acting between them: `Fusion Bolt with No move is not modelled in 2v2.` until the kernel resets it (nomove line), and after that while the No move's paralysis or infatuation is not rolled. | |
| Beak Blast, Shell Trap | Heat from the turn's start (not Z / Max): a contact hit burns the attacker (multi-hit contact: REASONS.intoBeakBlast); Shell Trap triggers on a foe's physical hit (moves next), fails otherwise. | `Beak Blast: {Name} is burned.`; `Shell Trap: {Name} moves next.`; `Shell Trap fails: {Name} took no physical hit.` |
| Flame Burst | The target's adjacent ally loses max(1, floor(baseMaxHP/16)) (not Magic Guard), with its afterLoss. | `{Name} loses {n} HP (Flame Burst).` |
| The Pledges | A partner's queued Pledge waits (pulled next); the second combines at 150 power, the pair's type, forced STAB; sea of fire / swamp on the target's side, rainbow on the user's (`SideState.pledge[kind] = 4`). Rainbow's doubled secondaries and the swamp's Gyro Ball / Electro Ball keep a reason. | `{Move} waits for {Ally}'s {Other}.`; `{Other} and {Move} combine: {Type}, 150 power.`; `The sea of fire / A swamp / A rainbow starts on {side}.` |
| Counter, Mirror Coat, Metal Burst, Comeuppance | The last hit from a foe this turn (per world: the step reports `lastHit`), by category; the Pokémon now in the recorded position (Ally Switch), centres first; a fainted one: Counter / Mirror Coat no target, Metal Burst / Comeuppance a random living foe. 2× / floor(1.5×), at least 1, as a fixed hit (`MoveContext.fixedDamage`). Parental Bond keeps a reason. | `{Move} fails: {Name} took no physical hit / special hit / took no damage from a foe this turn.`; `{Move}: twice / 1.5 times the {n} HP {Name} took.`; `{X} fainted: {Move} hits {Y}.` |
| Spotlight (USUM) | Through the status pipeline (spotlight lines): the target is the centre of attention for its foes' moves. | `Spotlight: {Name} is the centre of attention.`; `Spotlight: {Name} takes {Move}.` |
| Bide (USUM; C41) | First use stores (turn fact); a storing turn uses no move; a release (`carried.bide.release`): twice the stored total (input plus this turn's damage from any other Pokémon) at the last damager (a fainted one: a random foe) through tryMoveHit (no Protect, Ghost immune, Substitute: reason; Sturdy, Endure, Sash, Disguise, contact retaliation act). The release counts as its use (its unsilenced `-end`). | `Assumes {Name} did not use Bide on an earlier turn.`; `{Name} stores energy (Bide).`; `{Name} unleashes the energy (Bide): twice the {n} HP stored.`; `Bide fails: {Name} stored no damage.`; `Bide fails: no Pokémon damaged {Name}.` |
| Present, Magnitude | Split worlds: Present heal 2/10 (round(baseMaxHP/4), through the hit checks, Wonder Guard, Ghost), 40/80/120 at 4/3/1 tenths; Magnitude's ten powers by random(100). | `Present: {Name} regains HP.`; `Present fails: {Name} is at full HP.` |
| History rows | Retaliate (input `faintedLastTurn`), Fury Cutter 40×min(4,2^n) cap 160, Rollout / Ice Ball 30×2^hits ×2 Defense Curl, Echoed Voice 40×min(5,m+1), Trump Card by the PP after this use and a foe target's Pressure (0 left: fails), Pursuit 40 with no switching target. | `Trump Card fails: {Name} has no PP left for it.` |
| Beat Up | The party at the use (partner alive, no status), the input party. | |

Narrow guards (each a fact reason with a test): `{Move} with the rainbow …`, `{Move} with the swamp …`, `Pursuit with a
Pokémon that switched in this turn …`, a retyped row move into an absorbing / redirecting ability of the new type
(`{Move} with {Ability / Electrify / Ion Deluge} …`), `Beat Up with {Partner}'s hit first …` (a user at Showdown
position 1 behind a partner hitting with a different power), `Flame Burst with {Ally}'s HP …` (a splash loss whose
afterLoss splits), `Bide with {Protean / Libero} …`, `Bide with {Name}'s Substitute …`, `Counter with Parental Bond …`,
`Fusion Bolt with No move …`. Kept: `Spotlight / Counter / Mirror Coat / Metal Burst / Comeuppance is not modelled in
2v2.` until their lines land (`KEPT_MOVES`).

## Verification

- Oracle cases `w1b-pr/cases.ts` (42, `w1b-pr/run.ts`): live tree 28/42 (the rest wait for the lines: CTR, SPL, FUS-04,
  PUP-01's fact); with the integrator's lines (`w1b-pr/tree.sh`, all groups) 42/42.
- Gates (V2's `verify/compare.ts`, T2P-CMD -PUP -DAN -SPL -RND -BKB -STP -BTU -FUS -CTR -FLB -PLG -ROW, CQ-BID -PUR -CMD
  -ECV, IN-RTL -ECV; 105): live 72/105; with the lines 103/105. Also 103/105 on a tree with CL's (`cl/patch-int.cjs`) and
  M's (`w1b-m/patch-int.cjs`) lines applied first. The two left are V2's (below): T2P-BKB-02-champions, T2P-CTR-10-usum.
- Whole stored set (2314): stub presence file 2080, this file 2149, with the lines 2180. Newly failing against the stub:
  E40-FlameBurst-usum and R09 only, both stored not-estimated expectations; with them re-expected the oracle agrees
  (`run.ts --stored --reexpect --oracle E40-FlameBurst-usum R09`: 2/2). The lines fail nothing that passes without them.
- Unit: `tests/unit/doubles-presence.test.ts` 37 pass + 7 `it.fails` on the live tree; on the patched tree (integrator.py
  flips the `it.fails` and deletes the two interim reason tests) 42/42. `tsc --noEmit`: no error in the PR files.
- Timing (earlier A/B on an alternating subset): this file 2099 / 1766 ms against the stub's 2382 / 1880 ms.

## For the integrator (exact; `w1b-pr/integrator.py [group …]` applies each group and its test flips; default all)

Order: `fixed` before `spotlight` (both edit `KEPT_MOVES`). The `outcome` and `nomove` lines also apply after M's M-17
and CL's No-move line (the script tries those forms). After `spotlight`, regenerate `status-table.ts`
(`gen-status-table.ts`; `tree.sh` shows the command).

1. **fixed** (Counter family and Bide's fixed hit). Failing tests: `the Counter family's reads > Counter returns twice the
   hit it took…`, `Bide > a release: twice the damage stored…`; gates T2P-CTR-01…12, CQ-BID-01…04.
   - types.ts `MoveContext`: `fixedDamage?: number;` after `ohko?: true;`.
   - uses-to-ko.ts `CalcTrace`: `fixedDamage?: number;`; four sites `run.trace.ohko ? …` become
     `run.trace.fixedDamage !== undefined ? run.trace.fixedDamage : run.trace.ohko ? …` (turnCases, turn rows, hits, extended hits).
   - calculate.ts: historyAnswered `if (["counter", "mirrorcoat", "metalburst", "comeuppance", "bide"].includes(id)) return
     context.fixedDamage !== undefined;`; the zero-power check gains `!(context?.fixedDamage !== undefined && !resolved.transformed)`;
     a fixed branch before `FIXED_HP_MOVES` (a power-1 probe for immunities, `trace.fixedHP`, `trace.fixedDamage`) and
     `fixedDamageRow` before `fixedHPDamage` (integrator.py FIXED_BRANCH, FIXED_FN).
   - doubles-turn.ts searchFor: `const presenceReport = presenceHooks.stepReport(kernel, w, attacker, target, moveId);`
     merged into `report`; applyStep: `const signature = outcome.lastHit ? \`${keyed}|${outcome.lastHit.damage}|${outcome.lastHit.category}|${outcome.dealt ?? -1}\` : keyed;`.
   - doubles-presence.ts: `KEPT_MOVES` → `new Set(["spotlight"])`; delete the test `is not estimated until the fixed hit lands…`.
2. **status**: doubles-status.ts setStatus `presenceHooks.afterSetStatus(kernel, w, slot, status, source, opts.use);`.
   Failing test: `Poison Puppeteer > the confusion's hit fact…`; gates T2P-PUP-01, -02, -03, -05.
3. **outcome**: doubles-turn.ts outcomeOf `..., ...presenceHooks.outcomeVolatiles(kernel, world, slot)])].sort();`.
   Failing test: `Commander > E2 carries commanding and commanded…`; gates T2P-CMD-03, -04, -04b, -05, -05b, -07.
4. **nomove**: doubles-turn.ts executeUsed, No move: `if (ctx.historyReaders.didSomething) for (const world of go)
   world.lastSuccessful = null;`. Failing test: `Fusion … > does not after a No move between them…`; gate T2P-FUS-02-sv.
   (Optional, A's file: doubles-status.ts beforeMove rolls no paralysis or infatuation for No move; with Fusion readers it
   changes the memory, so presence keeps its reason there.)
5. **copies**: doubles-turn.ts `StepStats.from?: number`; `TurnKernel.extraStep(…, from?: number)`; makeKernel passes it;
   extraStep finds a known step only with `step.from === from` and keeps `from`. Failing test: `Dancer > two dances
   copied by one Dancer are two steps…`; gate T2P-DAN-04-sv.
6. **spotlight**: classify-a3.md `| spotlight | M |` (regenerate status-table.ts); doubles-status.ts volatile
   `case "spotlight": { mon.centre = "spotlight"; hitFact(kernel, use, slot, \`${move.name}: ${name} is the centre of attention.\`, w); return true; }`;
   `KEPT_MOVES` → `new Set([])`; delete the test `is not estimated until the status pipeline has its volatile…`.
   Failing test: `Spotlight > makes its target the centre of attention…`; gates T2P-SPL-01, -02, -02b, -03.

## Tests in other files that change (integrator / owners)

- tests/unit/doubles-turn-guards.test.ts `names each move not modelled in 2v2`: Beat Up, Round, Beak Blast, Fusion Bolt /
  Flare, Shell Trap are modelled; Spotlight and Counter keep the reason until their lines (then none).
- tests/unit/doubles-turn-guards.test.ts `names Imposter and Commander…`: Commander with Dondozo is modelled (ready); the
  Imposter part is another track's.
- tests/unit/doubles-turn-guards.test.ts `Dancer when a dance move is used`: modelled (Oricorio copies Fiery Dance).
- tests/unit/calculator-ngas-2v2.test.ts:258 `still names Commander … under the gas`: ready (the gas stops Commander;
  oracle PR-CMD-02 agrees).
- tests/unit/doubles-turn-fixes.test.ts R09 (Fire Pledge with Grass Pledge): ready, oracle agrees; V2's stored R09 too.
- tests/unit/doubles-start-rows.test.ts SR41, SR61, SR62, SR63 (Spotlight's reason) once the spotlight lines land.

## For other tracks

- **V2**: re-expect stored E40-FlameBurst-usum and R09 (both agree with the oracle); mark T2P-CTR-10-usum not estimated
  `Counter with Parental Bond is not modelled in 2v2.`; T2P-BKB-02-champions `endNotEstimated` (Dragon Tail's drag with
  no bench is the switch-out guard, wave 2 / integrator).
- **E2**: `SideState.pledge[kind]` is the turns left before this turn's countdown (4 when set; 3 after the end of turn).
- **CL**: keep `{Caller} with Fusion Flare/Bolt …`: presence's afterAction reads the action's own move id, so a called
  Fusion move (Showdown's active move) is not remembered; Instruct may pass `from` to `extraStep` (copies lines) for one
  step per source.
- **U2**: the fact and reason texts in the table above.

## Deviations

- The Counter family, Bide's release and Spotlight are not estimated in the live tree until their lines land (KEPT_MOVES
  and the calc's historyAnswered); with the lines all agree with the oracle.
- Counter with Parental Bond keeps a narrow reason (two full fixed hits).
- Fusion after a No move: a reason (not a number) until the nomove line, and afterwards where the No move's paralysis
  or infatuation could stop it (Track A's BeforeMove does not roll them for No move).
