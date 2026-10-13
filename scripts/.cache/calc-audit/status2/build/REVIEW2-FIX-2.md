# Review 2, round 2: the fixer's notes

The review fixer of ADDENDUM2 §8.8, round 2 (the last round). It handled the 25 confirmed round-2 findings of the seven
lenses. The branch is calc-2v2-status-2; HEAD was e12be0f (the round-1 commit) when this pass started. This pass committed
nothing. The orchestrator's checkpoint 6c1ca23 (21:20 UTC) holds this pass's tracked files as they are now: `git status` is
clean after it. The scripts/.cache files (cases, harness, these notes) are not tracked.

`$SP` = `/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad`. This pass's probes, logs and
scratch files are in `$SP/fix2`:

- `run-cases.ts`: a runner that takes a probe module and runs its cases on the oracle and the app, writing nothing.
- `sec-*.ts`: the case sections added to cases-review2.ts.
- `pre/tree.tar`: the app, tests and training sources before this pass.
- `app-results-r1final`: the app results before this pass (round 1's final pass).
- The logs named below.

## The findings

Every finding was confirmed again on the current tree by its reviewer's and verifier's probes before the fix. None was wrong on
closer reading. "(ne)" marks a case stored as not estimated, with its fact reason.

| Lens | Id | Severity | Outcome | Fix | Files | Test | Cases (RV2-…) |
|---|---|---|---|---|---|---|---|
| R1-A1-K | R2-A1K-01 | blocking | fixed | The kernel keeps the move that is running (`Ctx.moving`, `TurnKernel.moving`; executeUsed sets it to `used` around runMove and restores it after). knockingBreaker reads it and tests the move as used (`infoOf(...).effective`: a Z or Max form's own ignoreAbility, `sim/battle-actions.ts:397-407`) and its category (a called move takes its caller's, `:422-425`). receive() takes no action any more, and spreadUser passes none. This is the verifier's fix.diff. | doubles-turn.ts, doubles-reactions.ts | doubles-reactions "Receiver reads the move as it runs…" (G-Max Fireball −1 and Body Slam 34–40; Max Steelspike +1 Defense only; Sleep Talk into Swift −1, own Swift 0) | Q2-RC-GMAX-DRUM, -GMAX-FIREBALL, -MAXSTEEL, V1-GMAX-HYDRO-HC, V1-MAXPHANTASM (swsh); Q2-RC-CORKSCREW, -SUNRAZE, V1-NEVERENDING (usum); Q2-RC-STALK-MYC-SWIFT, -MYC-SWIFT-DIRECT, -STALK-MYC (sv); Q2-RC-STALK-SUN, -SUN-DIRECT (sv, usum) |
| R1-A1-K | R2-A1K-02 | blocking | fixed | The same change. `moving` is null between moves, so a switch request's newcomer meets no breaker (`sim/battle.ts:2831` clearActiveMove). Pursuit at a switch-out runs through executeUsed and sets its own (`data/moves.ts:14432`). The knockingBreaker comment says that a drag keeps its move active and that dragIn rules a breaker's drag not estimated. | doubles-turn.ts, doubles-reactions.ts | doubles-switch "Receiver after the move…" (sv, usum: Eject Button newcomer, Body Slam 50–59 and Attack 0; USUM Pursuit −1) | Q2-RC-EJECT-SR2 (sv, swsh, usum), Q2-RC-EJECT-SR-CTRL, Q2-RC-MOLD-RH (sv), V2-EJECTPACK-SR (sv, swsh), Q2-RC-PURSUIT, V2-PURSUIT-CTRL (usum) |
| R2-A2A3-H | R2-A2A3-H-r2-1 | blocking | fixed | doubles-items.ts receive(): a received Choice item clears `choiceLock` before the itemWorks gate, since setItem's Start runs for an ignored item too (`sim/battle.ts:607`; `data/items.ts:965-970, 989-994, 1012-1017`). It also sets the new `MoveVolatiles.choiceFresh` where a Dancer is in the turn (the readers rule; `dancerInTurn`, shared with doubles-status.ts). carriedChoiceLock reads `choiceFresh`, so an earlier turn's lock is ended too. | doubles-items.ts, doubles-world.ts, doubles-presence.ts | doubles-presence "review 2 round 2 (R2-A2A3-H-r2-1, R5r2-1…)": the Trick copy +2 with no failure; Band copy then Trick, own Air Slash lands; the carried case ready, Air Slash fails locked into Swords Dance | RB-TRICK-LOCK (sv, usum), RB-TRICK-LOCK-PLAIN, RB-SWITCH-LOCK, RB-TRICK-CARRIED (sv), RB-BESTOW-LOCK, VT-SWITCHEROO-BAND (usum), VT-COPY-THEN-TRICK (sv, usum), VT-COPY-THEN-TRICK-T, -CTRL (sv) |
| R5-PRCLST-FC | R5r2-1 | blocking | fixed | The same fix as R2-A2A3-H-r2-1 (Trick and Switcheroo go through swapItems, Bestow through give, Recycle through restore: each reaches receive). | as above | as above | R2-DAN-TRICK-SD, -SD-LEFT, V1-SWITCH-SPECS (sv) |
| R5-PRCLST-FC | R5r2-2 | blocking | fixed | choiceReader keeps the lock where a Dancer is anywhere in the turn: in a slot or on a bench (`dancerInTurn`). A Choice holder that becomes a Dancer after its own move (Role Play, Doodle, Skill Swap, Entrainment, Receiver) is locked into that move, and its copy fails (`data/items.ts:995-997`; `data/conditions.ts:324-348`). | doubles-status.ts, doubles-items.ts | doubles-presence "R5r2-2 (RV2-R2-DAN-ROLEPLAY)": **Swords Dance fails: Greninja is locked into Role Play by Choice Scarf.** | R2-DAN-ROLEPLAY, -ROLEPLAY-LEFT, R2-DAN-DOODLE, V2-SKILLSWAP, -SKILLSWAP-LEFT (sv) |
| R5-PRCLST-FC | R5r2-3 | blocking | fixed | Trump Card's power reads `vol.ppSpent` where it is kept (this use's 1 and its Pressure, and an instructed use's before it); otherwise it reads PP left − 1 − Pressure as before. A new BeforeMove gate after Focus Punch, `noPPCheck`, skips an own or instructed use whose given PP an instructed use spent earlier this turn: `cant nopp`, `sim/battle-actions.ts:281-285`, with the skipped fact **No PP left for Trump Card.** A move given with no PP from the start keeps Trump Card's own failure; only a hand-made input reaches it. | doubles-presence.ts, doubles-status.ts | doubles-calling "R5r2-3…": instructed hit 35–42; Snorlax 179–188 with the own use skipped | R2-TC-INS, -INS4, -INS-FIRST, -INS-FIRST3, V3-TC-FIRST2 (usum) |
| R5-PRCLST-FC | R5r2-4 | minor | fixed | doubles-calling.ts adds the `mustpressure` flag table per game (catalog moves: SV imprison, spikes, stealthrock, terablast, toxicspikes; Champions and SwSh without Tera Blast; USUM with Snatch). spendPP counts every living foe's Pressure for such a move (`sim/pokemon.ts:846-853`). runUse spends PP for a foeSide move before sideOrField (none but for mustpressure). | doubles-calling.ts, doubles-status.ts | doubles-calling "R5r2-4 (RV2-R2-INS-TB)": no instructed use, Snorlax 206–211 | R2-INS-TB, R2-INS-SPK3, V4-TSPK (sv), R2-INS-SPK (sv, champions) |
| R5-PRCLST-FC | R5r2-5 | blocking | fixed | applyStep's `ended` also reads the step's conditions (`outcome.conditions.weather`, the move's start), so a spread move's later target keeps a strong weather an earlier target's faint ended (`data/abilities.ts:954-963`). | doubles-turn.ts | doubles-fieldchange "round 2 R5r2-5…": Water Pulse 28–34, E2 weather none | R2-FC-PRIMAL-RS1, -RS2, V5-KYOGRE-RS1, -RS2 (usum) |
| R5-PRCLST-FC | R5r2-6 | should | fixed | callablePool's Me First case keeps only the foes' damaging moves without failmefirst (`data/moves.ts:11542-11551`). | doubles-calling.ts | doubles-calling "R5r2-6 (RV2-R2-MF-DANCER)": Oricorio copies Swords Dance | R2-MF-DANCER (usum) |
| R5-PRCLST-FC | R5r2-7 | blocking | fixed | Gorilla Tactics' lock (`data/abilities.ts:1654-1690`) has the new `MoveVolatiles.gorillaLock`. beforeMove sets it from the first move that is not Z or Max powered or Struggle, where an instructed move can come (`gorillaReader`; the ability suppressed is GAS_STAND_IN in the build). choiceLockCheck fails any other move (`lockFails`: the step counts it used, then **Flare Blitz fails: Darmanitan-Galar is locked into Icicle Crash by Gorilla Tactics.**) and drops the lock when the ability is gone. | doubles-status.ts, doubles-world.ts | doubles-calling "R5r2-7 (RV2-R2-INS-GT)": opponent-left 145–159, Darmanitan unchanged | R2-INS-GT, V7-GT, R2-INS-SCARF (swsh) |
| R3-DE-F | R3DEF-R2-1 | blocking | fixed with a fact reason | doubles-spread.ts `dartsBerryGuard`: for Dragon Darts on two targets, where the attacker's Liechi or Starf Berry crosses its line through the loss the darts' targets bring (Jaboca, Innards Out), the turn is not estimated. A foe's Unnerve or an ignored item means no reason. The text is **Dragon Darts with Dragapult's Liechi Berry is not modelled in 2v2.** **Why exactness is out of reach:** dartsStep hands both darts to spreadStep, which builds each target's step from the attacker as the move started and applies the losses and the Berry once after both. Running the darts as two singleSteps would also apply Life Orb, the PP and the move's end per dart. The loss counted is the darts' sum (the first dart's at most), so the reason is on the safe side. | doubles-spread.ts, docs | doubles-guards-misc "R3DEF-R2-1…": the reason; ready at 150 HP, with Unnerve, with a Lansat | R2-LIECHI-DARTS-JABOCA (sv, swsh, ne), R2-LIECHI-DARTS-IO, R2-STARF-DARTS-IO (swsh, ne), R2-STARF-DARTS (sv, swsh), V1-DARTS-LIECHI-JABOCA-HIGH, -UNNERVE, V1-DARTS-LANSAT-JABOCA (sv) |
| R3-DE-F | R3DEF-R2-2 | blocking | fixed | encoreRewrites gives an Encore rewrite into Perish Song, Flower Shield or Rototiller the queued priority (`PendingAction.encoredPriority`; not in generation 7, whose frozen priority already is, nor in Champions). runStatusMove reads it (`sim/battle-actions.ts:225-233`). sideOrField's shield check covers all three moves (`SHIELD_READ_FIELD_MOVES`; `data/abilities.ts:216-227`). compare.ts's perish3 fact rule is narrowed to `/perish count/i`, so "Encore: Azumarill uses Perish Song." is no perish start (CRLF kept). | doubles-guards.ts, doubles-world.ts, doubles-status.ts, compare.ts, docs | doubles-guards-misc "R3DEF-R2-2…": no perish count with Armor Tail; four without; Champions four | R2-ENC-PERISH-AT, -NONE (sv), R2-ENC-PERISH-QM (swsh), R2-ENC-PERISH-DZ (sv, usum), V2-ENC-PERISH-AT-CH (champions) |
| R3-DE-F | R3DEF-R2-3 | blocking | fixed | applyStep: where the heal-blocked attacker's stand-in (Leftovers) went to an itemless target in the step (Pickpocket), the target gets the attacker's real item (`data/abilities.ts:3239-3255`). | doubles-turn.ts | doubles-guards-lock "RV2-R2-PICKPOCKET-HB-sv…": Weavile 68–81, no item | R2-PICKPOCKET-HB (sv), V3-PICKPOCKET-HB (swsh) |
| R3-DE-F | R3DEF-R2-4 | blocking | fixed with a fact reason | doubles-guards.ts `thiefGulpGuard`, called before every single-target step: Thief or Covet from an itemless user into a Cramorant-Gulping or -Gorging with an item, where some HP of the user is at most Gulp Missile's quarter (plus a Rocky Helmet's sixth on contact), is not estimated. The text is **Thief with Cramorant-Gulping's Gulp Missile is not modelled in 2v2.** **Why exactness is out of reach:** the step's AfterHit steal is in uses-to-ko.ts, shared with 1v1, and has no user-HP check. K applies Gulp Missile's loss after the step, so undoing the steal there would also need the step's facts, Unburden and the Berry's Update undone. | doubles-guards.ts, doubles-turn.ts, docs | doubles-guards-lock "RV2-R2-THIEF-GULP-PLAIN-sv…": the reason; at 100 HP ready, the Sitrus taken and eaten | R2-THIEF-GULP-PLAIN, -HB (sv, ne), V4-COVET-GORGING2 (swsh, ne), R2-THIEF-GULP-HB-SURVIVE (sv) |
| R3-DE-F | R3DEF-R2-5 | blocking | fixed | applyStep: a Berry the target gained in the step (Pickpocket at AfterMoveSecondary) goes through berryDue at once (the action's Update), before any later hit. | doubles-turn.ts | doubles-guards-lock "…-PLAIN-2HIT-sv": KO 0.84375, 0–6 | R2-PICKPOCKET-PLAIN, -PLAIN-2HIT (sv), V5-PICKPOCKET-2HIT (swsh) |
| R3-DE-F | R3DEF-R2-6 | minor | fixed | doubles-start.ts itemsOf: the carried lock hides the Berry only without a carried Gastro Acid (`sim/pokemon.ts` ignoringAbility). | doubles-start.ts | doubles-guards-lock "RV2-R2-GA-LOCK-START-sv": start 111 | R2-GA-LOCK-START (sv, swsh, usum), R2-GA-LOCK-HIT (swsh, usum), R2-GA-LOCK-KLAWF, R2-GA-NOLOCK-HIT (sv) |
| R3-DE-F | R3DEF-R2-7 | should | fixed | berryTakenFirst's Magician reason is skipped where Sticky Hold keeps the item (`data/abilities.ts:4622-4630`). | doubles-guards.ts, docs | doubles-guards-lock "RV2-R2-MAGICIAN-STICKY-HB-sv": ready, Sitrus kept | R2-MAGICIAN-STICKY-HB, V7-THIEF-STICKY-HB (sv) |
| R3-DE-F | R3DEF-R2-8 | should | fixed | parentalOhkoGuard counts a Focus Sash only where the target can be at full HP (`data/items.ts:2265-2276`). | doubles-guards.ts | doubles-guards-misc "R3DEF-R2-8…": KO 1 at 200 HP | R2-PB-SASH-NOTFULL, V8-OHKO-SASH-NOTFULL-NOPB (usum), V8-PB-SASH-FULL (usum, ne) |
| R4-SW-M | R4-r2-1 | blocking | fixed with a fact reason, where the orders differ | doubles-max.ts: orderGuard and capOrder are replaced by `orderReplay`, which every caller of maxEffects feeds with the world before the step (`opts.before`: singleStep, spreadStep, drainingStep, faceOnce). It replays pinned's order for each Pokémon the self.onHit changes: the self.onHit's stages, run by the kernel on a copy of `before` with a White Herb held back; then the step's DamagingHit changes (Weak Armor, Steam Engine, Rattled, Cotton Down from each other holder hit, or none where TryBoost stopped it); then the hit's Update Berry (Salac, Starf on Speed or elsewhere); then White Herb at AfterMove (`data/items.ts` whiteherb onAnyAfterMove). Each candidate must give the stages the step left. Where the pinned stages or the Herb differ from what maxEffects leaves, the reason names the cause (**G-Max Foam Burst with Skarmory's Salac Berry is not modelled in 2v2.**, **Max Airstream with Snorlax (yours)'s White Herb is not modelled in 2v2.**). **Why exactness is out of reach:** the self.onHit runs after the pair's step (uses-to-ko.ts, shared with 1v1). Writing pinned's stages afterwards would leave the step's facts, Defiant and the copy ledger in the wrong order. | doubles-max.ts, doubles-turn.ts, doubles-spread.ts, doubles-faces.ts, docs | doubles-max "review 2 round 2 (R4-r2-1, -2)…" | R2E-M-FOAMWASALACM5, -FOAMWASTARFM5, V-KESALACM5, -KESALACP6, V-SE160SALACM5, V-AIRCOTTONM6, V-AIRCOTTONWH, V-FOAMCOTTONWH (ne); R2E-M-FOAMWASALAC0, V-WASALACM4, V-KESALACP0, V-SE160SALACM4, V-KEWHITEHERB, V-WAWHITEHERB (swsh) |
| R4-SW-M | R4-r2-2 | should | fixed | The same replay reads the real stage before the step, so a turn where both orders give one stage is estimated. | as above | as above (Weak Armor +4, Steam Engine 0, the partner at −5) | V-FOAMWA4, V-FOAMWA3, V-FOAMSE0, V-AIRCOTTONM5 (swsh) |
| R6-NNU-U | R6-r2-1 | should | fixed | doubles-prep.ts movesRead passes a Snatch or Copycat user's quick moves where Conversion or Imprison may be used this turn (`SELF_READERS`), and every Assist user's. | calculator/doubles-prep.ts, calculator/useDoublesCalculation.ts | calculator-doubles-inputs "review 2 round 2 (R6-r2-1)…" | R6R2-SNT-IMP (usum), R6R2-COPY-IMP (sv, usum) |
| R6-NNU-U | R6-r2-2 | should | fixed | The engine's new `instructCanReach`, which calledStall uses. An Instruct reaches a Pokémon when it is aimed at it or has no target; when a foe uses it while a Spotlight is aimed at the Pokémon; or when a foe calls it with Sleep Talk (Instruct among its moves), Copycat (Instruct as the battle's last move, an action or a last move) or Assist (Instruct among the ally's or the bench's moves). This is mirrored in the calculator's calledProtect and calledMoves (`instructReaches`), in compare.ts's fact rule (CRLF kept), and in Training's bridge, which now asks the engine's calledStall on the whole input. | doubles-turn.ts, calculator/doubles-inputs.ts, training/sim/bridge.ts, compare.ts, docs | doubles-history "sv round 2 (R6-r2-2…)": 139–235, average 176.375; calculator-doubles-inputs "review 2 round 2 (R6-r2-2, -4)…" | R6R2-STALK-INS-STL3, -NONE (sv), R6R2-COPY-INS-STL3 (sv, usum), R6R2-SPOT-INS-STL3 (usum) |
| R6-NNU-U | R6-r2-3 | minor | fixed | The calculator's switchDoublesIn drops the Attract, Octolock, Lock-On, partial trap and Syrup Bomb the other Pokémon carry from it (`dropSourced`), and the source selects leave out a Switched in Pokémon. The engine's carriedState skips those states when their source switched in. | calculator/doubles-inputs.ts, doubles-turn.ts, docs | calculator-doubles-inputs "review 2 round 2 (R6-r2-3)…" (sv, usum; a kept trap does no damage) | R6R2-SWTRAP (sv, usum), R6R2-SWSYRUP (sv), R6R2-SWATTRACT (sv, usum) |
| R6-NNU-U | R6-r2-4 | minor | fixed | Conversion 2 joins `EARLIER_TABLES.lastMoveReaders`, so **Last move** shows on every other Pokémon when a Conversion 2 is in the turn. calledProtect, calledMoves and movesRead read the target the turn's input aims at (`aimedAt`: a fainted target's retarget) and Spotlight. ADDENDUM2's and inputs.md's rows are updated (CRLF kept). | calculator/doubles-inputs.ts, calculator/doubles-prep.ts, ADDENDUM2.md, inputs.md | calculator-doubles-inputs "…(R6-r2-2, -4)…", and R6-1's test (a Conversion 2 aimed elsewhere now offers it) | R6R2-CONV2-SPOT (usum) |
| R7-T-R | R7-r2-1 | should | fixed | hazardOrder copies `given`/`present` into `order`, so this turn's hazards no longer go into `unordered` (or into toxicSpikes()'s hazardsUnordered). One hazard from before the turn has its place. | doubles-switch.ts, docs | doubles-switch "one hazard from before the turn with no order has its place…" (sv Mirror Herb kept; usum hazards ['stealthrock']) | R2-SR1-WEBTURN-DEF, R2-SR1-TSTURN-POISON, V1-SP1-WEB-DEF (sv), R2-TS1-SRTURN-POISON (sv, usum), V2-TS1-SP-POISON (sv, usum, swsh, champions) |

## Stored cases

`cases-review2.ts` has a "Round 2" section (above the `// ROUND2-END` marker) with 138 cases, from the section files
`$SP/fix2/sec-a1k.ts`, `sec-g2.ts`, `sec-g3.ts`, `sec-g4.ts`, `sec-g6.ts` and `sec-g7.ts`. They ran in five groups: A1K 24, g2 37,
g3 36, g4 18, and g6 with g7 23. REVIEW2_CASES now holds 369 (231 + 138). The wiring is unchanged (cases-wave2.ts, OWNER_2 `/^RV2-/` →
"review2 fixer"). Games: sv plus swsh, usum or Champions where the mechanic exists (Z-Moves and Pursuit are USUM's, Max and
G-Max moves SWSH's, Snatch USUM's, Mycelium Might and Supersweet Syrup SV's); a Max or Z case with no SV form runs in its game only.

- The oracle first: `v3/run.ts <ids> --oracle --shard=i/n` per group (exhaustive walks) (`oracle-a1k-{0,1,2}.log` 8 + 8 + 8,
  `oracle-g2-{0..3}.log` 10 + 9 + 9 + 9, `oracle-g3-{0..3}.log` 9 × 4, `oracle-g4-{0,1,2}.log` 6 × 3, `oracle-g6-{0..3}.log`
  6 + 6 + 6 + 5; each `N/N cases match.` and `EXIT 0`) wrote `results/RV2-*.json` for the 122 estimated cases. A case stored
  as not estimated matches on its reason and has no oracle file.
- `sim-dfs.ts <ids> --exact --validate --out=$SP/fix2/validate` (`validate-ids-*-part-{aa,ab}.log`, `validate-g4.log`,
  `validate-one-*.log`) gives `equal to N whole-turn replays` for all three walks of 120 of the 122: 360 lines, none that
  differ. The validated results equal the stored ones: `120 equal, 0 differ` (`$SP/fixB/valcmp.mjs`).
- RV2-R6R2-SPOT-INS-STL3-usum and RV2-R6R2-CONV2-SPOT-usum cannot be validated, as round 1's Sleep Talk and Teeter Dance cases.
  The replay walk has no merging, so each random branch (the start's speed tie among them) multiplies its whole-turn replays.
  SPOT-INS-STL3's lowest walk alone passes 3000 replays, where the DFS walk takes 57 runs (`validate-lh-spot.log`:
  `Error: over 3000 runs`; `$SP/fix2/valtool/val-lh.ts` calls sim-dfs's walk, walkReplay and compareWalks). A `--validate` run of
  each ended at its 900 s timeout (`EXIT 124`, `validate-one-*.log`). An earlier run had spent 39 minutes on them. Their stored results are the exhaustive
  DFS oracle's (251 and 349 runs), and the app agrees with them.
- The 16 cases stored as not estimated have no oracle file. compare.ts checks the app's reason:
  RV2-R2-LIECHI-DARTS-IO-swsh, -LIECHI-DARTS-JABOCA-sv, -LIECHI-DARTS-JABOCA-swsh and -STARF-DARTS-IO-swsh (**Dragon Darts with
  Dragapult's Liechi Berry / Starf Berry is not modelled in 2v2.**); RV2-R2-THIEF-GULP-HB-sv, -THIEF-GULP-PLAIN-sv and
  RV2-V4-COVET-GORGING2-swsh (**Thief / Covet with Cramorant-Gulping's / Cramorant-Gorging's Gulp Missile …**);
  RV2-R2E-M-FOAMWASALACM5-swsh, -FOAMWASTARFM5-swsh, RV2-V-KESALACM5-swsh, -KESALACP6-swsh, -SE160SALACM5-swsh,
  -AIRCOTTONM6-swsh, -AIRCOTTONWH-swsh and -FOAMCOTTONWH-swsh (**G-Max Foam Burst / Max Airstream with {Name}'s Salac Berry /
  Starf Berry / Cotton Down / White Herb is not modelled in 2v2.**); RV2-V8-PB-SASH-FULL-usum (**Fissure with Parental Bond is
  not modelled in 2v2.**, the pre-existing guard where the target can be at full HP).
- App side: `STATUS2_REEXPECT=1a,1b compare.ts` (below) wrote `app-results/RV2-*.json` for all 138.

## Harness changes

- `compare.ts` (CRLF kept): START_FACTS gains `perish3: /perish count/i`. That is the perish count the oracle records as
  `perish3` when an Encore turns a move into Perish Song (R3DEF-R2-2's cases). And the fact rule for **Assumes no protecting move was used last turn.** now reads
  `reaches()`, a mirror of the engine's instructCanReach (R6-r2-2).
- `gen-tests.ts` (CRLF kept): the effect facts of a calling move whose called moves are all damaging. compare.ts compares such a
  step as damaging and checks none of its effects (`usedStatus` over `calledMoves`). gen-tests wrote every effect of a calling move
  as a fact check, so the two new rows RV2-Q2-RC-STALK-MYC-sv and -STALK-MYC-SWIFT-sv asserted a **−1 Attack** step fact for the
  Intimidate that Passimian receives after the knock-out. The app lists no fact for it; it shows the change in the outcome
  stages, which the rows check (`atk:-1` 0.5 and 1). Those two rows failed (`expected 0.5 / 1 to be less than or equal to
  1e-9`). The row now leaves out such a step's effects on its user's side and keeps those on the other side.
  The first try mirrored compare.ts outright. It changed two older rows: T2P-NAT-01-swsh lost its Lightning Rod **+1 Sp. Atk**
  check and T2P-AST-02-usum its burn check. The narrower rule changes no older row (`has a different row` is not printed).
- No other harness file changed. `changed-cases.ts listChangedReview2` needs no row: this pass changed no stored case.

## Gates (final tree)

`git branch --show-current` printed `calc-2v2-status-2` at the start and at the end. Each line below is as printed. The logs are
in `$SP/fix2`.

1. Oracle cases and changed cases:
   - `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts` (writes `results/compare.json`
     and `app-results/`): `2314/2314 cases match.`, `EXIT 0` (`compare.log`). That is round 1's 2176 plus this pass's 138.
   - `changed-cases.ts diff $SP/reviews/FIX-r1/app-results-before scripts/.cache/calc-audit/2v2/verify/app-results --wave=all`:
     `2314 cases: 1942 unchanged, 2 stored cases changed, 0 failing the gate.` (`changed-final-before.log`). The two are round
     1's T2M-ST-01-sv and T2M-ST-01-champions (R6-3's fact **Assumes no protecting move was used last turn.**, `matches the oracle`,
     listed by `listChangedReview2`).
   - Against round 1's final app results (`$SP/fix2/app-results-r1final`): `2314 cases: 2176 unchanged, 0 stored cases changed,
     0 failing the gate.` (`changed-final-r1.log`). This pass changed no stored case.
   - `int2/tools/app-diff-facts.mjs` gives `2881 files: 0 changed, 138 new` against round 1's final set. Against the before set
     it gives `2881 files: 3 changed, 369 new`: the two T2M-ST-01 facts and IN-HZD-01-swsh's losses in hazard order (round 1's R7-2).
   - Every case, `STATUS2_REEXPECT=1a,1b v3/run.ts --quiet --shard=i/4`: `579/579`, `579/579`, `578/578`, `578/578 cases match.`
     (`all-{0..3}.log`), so 2314/2314.
   - `STATUS2_REEXPECT=1a,1b v3/run.ts --wave2 --quiet`: `545/545 cases match.` (`wave2.log`): 176 wave 2 plus 369 RV2.
   - The touched families, `STATUS2_REEXPECT=1a,1b v3/run.ts T2P-DAN T2P-INS T2P-CPY T2P-AST T2P-MEF T2P-NAT T2P-TRC T2M-ST
     T2M-GM T2M-RC IN-RC IN-STL CQ-STL IN-HZD CR- IN-ENT CQ-ENT SAT-ENT G4-ENC G4-PKP G4-OHK G4-STF G4-SFL IN-ATR INT-TRP SAT-GAS
     VE-M IN-CPY IN-BNC IN-SW G4-SWX CQ-PUR SAT-STK T2M-SP --quiet`: `368/368 cases match.` (`families.log`).
2. The Showdown test file:
   - `STATUS2_REEXPECT=1a,1b npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts --keep-rows=tests/unit/doubles-turn-showdown.test.ts`
     (run on round 1's file, `showdown-before.test.ts`): `keep-rows: 2367 rows before, 282 kept as they were (their case does
     not load), 122 new` and `wrote 2489 cases to /home/user/pokedrafts/tests/unit/doubles-turn-showdown.test.ts (0 cases that do
     not agree with the app left out)` (`gen-tests.log`). No `has a different row now` line.
   - The diff against round 1's file is 125 added lines: the 122 rows, plus the new `CASES_7` part's two lines and the `CASES`
     line, which now lists `CASES_7`. That `CASES` line is the one changed line. The 282 stub rows and every other row are
     byte-equal. The 122 new rows are the 138 cases less the 16 stored as not estimated.
3. The rest:
   - `npx vitest run --config vitest.unit.config.ts tests/unit/doubles-*.test.ts`: `Test Files  43 passed (43)` /
     `Tests  3717 passed | 1 skipped (3718)` (`vitest-doubles-final.log`, on the regenerated Showdown file).
   - `npm run check` (lint, `tsc --noEmit`, the unit suite): `Test Files  261 passed (261)` / `Tests  8414 passed | 1 skipped
     (8415)`, `EXIT 0` (`check.log`). eslint and tsc printed nothing. A first run, alongside the fuzzes and a validation, had
     three tests over the 5000 ms timeout (calculator-after-use "give every single-hit row …", calculator-usum-hidden-power-ivs
     and naming-guard; `check-loaded.log`). On the quieter machine all passed.
   - `npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check`: `golden-1v1: 254 cases byte-equal (13074 ms)` (`golden.log`).
   - The Training unit tests, `npx vitest run --config vitest.unit.config.ts tests/unit/training-*.test.ts`: `Test Files  60
     passed (60)` / `Tests  711 passed (711)` (`vitest-training.log`). Earlier, with the calculator and status2 tests:
     `Test Files  74 passed (74)` / `Tests  1081 passed (1081)` (`vitest-tc.log`).
   - `status2/build/t2-fuzz.ts 60 101`: `"decisions": 1335`, `"mismatches": 188`, `"logsClean": 794`, `"logsSame": 794`,
     `"engineCells": 7867`, `"issues": 0`, `"notEstimated": 24` (`t2-fuzz-101.log`). `t2-fuzz-all.ts 60 101` lists 188 notes,
     every one a ` pp: ` line (`t2-fuzz-all-101.log`). These are the 188 known PP mismatches, as in round 1.
   - `status2/build/w2-rt/rt-fuzz.ts 60`: `"decisions": 1199`, `"mismatches": 0`, `"benchChecked": 2356`, `"hazardsChecked": 2356`,
     `"logsClean": 1013`, `"logsSame": 1013`, `"engineCells": 7001`, `"issues": 0`, `"notEstimated": 14`, `"ready": 7988`,
     `"policyIssues": 0` (`rt-fuzz-1.log`), equal to round 1's.
   - The harness tests (`npx vitest run --config scripts/.cache/calc-audit/2v2/verify/v3/vitest.v3.config.mts`):
     `Tests  1 failed | 24 passed (25)`. The one failure is the stub's `Error: no case ZS16`, as in round 1 (`harness.log`).
   - `npx vitest run --config vitest.battle-data.config.ts tests/source/status2-hooks.test.ts`: `Tests  8 passed (8)` (`hooks.log`).
   - Line endings: `compare.ts`, `gen-tests.ts`, `changed-cases.ts`, `ADDENDUM2.md` and `inputs.md` are CRLF on every line
     (971, 831, 374, 1381 and 781 lines). The app, test and docs files keep LF.

## Open

- Three fact reasons stay where pinned's order or a held item makes the turn depend on state that 2v2 does not split. They are
  R3DEF-R2-1 (Dragon Darts with a Liechi or Starf Berry whose pinch line a dart crosses), R3DEF-R2-4 (Thief or Covet against a
  Cramorant whose Gulp Missile fires, with a Berry it then steals), and R4-r2-1 (a Max or G-Max move's self.onHit, where pinned's
  order and the app's give different stages: Salac or Starf, Weak Armor, Steam Engine, Cotton Down, White Herb). Each one fires
  only in its narrow case; the cases above check that it does not fire elsewhere.
- No bridge-level Training test for a called Instruct's stall streak (R6-r2-2). The bridge calls the engine's `calledStall`,
  which the unit tests cover. Both fuzzes are unchanged.
- A move given 0 PP from the start still uses Trump Card's own failure path. The oracle refuses a 0 PP move in its input
  (`V3B-TC0`), so that cannot be checked.
- RV2-R6R2-SPOT-INS-STL3-usum and RV2-R6R2-CONV2-SPOT-usum are not validated by replay (above).
- Round 1's stray root logs `/wave2.log`, `/vitest-tc-2.log` and `/rt-fuzz-1.log` are still there and need deleting by hand.
  This pass wrote none.
