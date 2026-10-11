# ADDENDUM2 to SPEC2.md: the Tier 2 guards, the earlier-turn inputs, and the merged build

Branch `calc-2v2-status-2`, cut from main `4008ee8`. This is the critic's paste-ready delta to `SPEC2.md` (same folder).
Section numbers mirror SPEC2's; a section not named here is unchanged. **Where this addendum and SPEC2 disagree, this
addendum wins; where it and one of the four Tier 2 designs disagree, this addendum wins.** USER-DECISIONS.md is final and
is folded in (§0).

It merges, under the user's answers:

| Short | File | Covers |
|---|---|---|
| T2M | `tier2-moves.md` | the moves-phase Tier 2 entries, crash damage, Q13 |
| T2P | `tier2-presence.md` | presence abilities and moves, calling moves, the Pledges, the start settle, the rows, field change |
| T2E | `tier2-eot-training.md` | the landing, Cud Chew, Moody, G-Max damage over time, forms at 29, Training's rollout reasons, budgets |
| IN | `inputs.md` | every earlier-turn input, the calculator's controls, Training's public sources |

Ground truth is pinned Showdown `c23d2e94` (`PS/…` = the read-only source
`node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353`; runnable copy
`scripts/.cache/calc-audit/showdown`). App line numbers are the tree at `4008ee8`.

**The critic's probes** (`critic2-probes-1.ts` → `critic2-probes-1.out`, `critic2-probes-1.err` empty; run from the repo
root with `npx --no-install tsx scripts/.cache/calc-audit/status2/design/critic2-probes-1.ts [CQ01 …]`; guards-sim.ts's
exact enumeration; 10 probe groups, 25 runs, each claim with its control). Citation form `q:N` = line N of
`critic2-probes-1.out`. The designs' own probe ids are kept (`T2-…`, `TPn·…`, `FS…`/`CC…`/`MO…`/`GX…`/`FC…`/`TR…`,
`IN-Pnn`).

---

## 0. Decisions in one page

1. **The user's answers (USER-DECISIONS.md, final).** Q1 = R (the replacement in the calculator and Training, wave 2).
   Q2 = "those plus more": SPEC2's three controls, the alternative's type / Infatuated by / Heal Block / accuracy and evasion
   / Berry locked / Mist / Lucky Chant / Sports controls, and every further input a Tier 2 entry needs (§5). Q3, Q4 =
   Unknown. **Q5 = later**: the eight ability moves under Neutralizing Gas and Neutralizing Gas ending keep their texts.
   **Q6 = every other census guard in this build**: §2.3 assigns each one. Q7 no new weights. Q8 Imposter as entered.
   Q9 the healthiest bench Pokémon. Q10 `needsGender`. Q11 the first quick move. Q12 the once-a-battle fact. **Q13 =
   modelled** (T2M §3.29: Max Moves, generic and signature Z-Moves, own-type moves, Ion Deluge only on Normal).
2. **Tier 2 result.** SPEC2 §2.3 kept 56 census entries and two parts of others (58 items). **47 are modelled wholly**;
   **4 are modelled but for one named part** (the calling moves: Metronome; received-item: Booster Energy by Trick;
   eot-form-change: Power Construct; step-stops: a field change between two hits of one move); **2 stay with Q5**
   (gas-ends-shield; the eight ability moves under Neutralizing Gas); **5 are kept as they are**, each justified:
   darts-aim-self (a move that hits its own user), needs-moves (an input-completeness text no app input triggers),
   row-engine-limits (the 1v1 engine's limits, byte-equal), and the two budget texts. The five kept parts' justifications are
   in §2.3: Metronome's 553–607-move pool against the 160-calculation budget; a three-condition chain for Booster Energy;
   a per-outcome maximum HP; one move's hits on one calculation. Narrow exact reasons stay inside modelled entries (§2.4):
   each is a fact about a missing input or a named corner, with a test that it fires only there.
3. **Silent wrong numbers today, fixed first (Step 1 grows from 8 to 16 commits, §8.2):** crash damage never applied
   (T2M IN-CRASH); Burning Jealousy and Alluring Voice as the last action (IN-BJ); Spectral Thief as the last action (IN-ST);
   the Unburden holder's first-Update Berry throws (T2P §5.1); Training's switched-in Pokémon running BeforeMove (T2E finding 1);
   Training's sampled Mega Evolution and switch ties (finding 2); Training's Cud Chew never carried (finding 3); and, **found by
   this critic**, the events earlier in the same turn (C19): Lash Out, Burning Jealousy, Alluring Voice and Pickup read flags that
   a switch-in's entry effects (and, on the battle's first turn, the leads') set before the first move, which no input carries
   (q:46-61, q:85-112: Lash Out 57 against 29, a burn against none). Training is wrong today on every such turn with Lash Out.
4. **One owner per state, one name per state, one module per hook** (§1.3). The five designs gave ten states two names each;
   the table there is the contract. The shared helpers: `kernel.useCalled` (every calling move, Sleep Talk included),
   `kernel.prioritize` / `insertAction` / `externalUse` (queue edits), `kernel.residualHit` (the landing), the continuation
   primitive (`TurnStepPart.fresh`, `dealt`, `stopAt`), start variants, `fieldchange.changed`, `history.entryTie`.
5. **Inputs** follow IN's rule (shown when read or while set; ambient states default to None with no fact; a history the
   turn's own move reads defaults to None with an `Assumes …` fact; Unknown keeps a narrow reason only where None would usually
   be wrong) with the critic's changes: a Cud Chew holder without a Berry defaults to None with a fact (C29); the protecting
   and Ally Switch counters take an explicit `1` (C23); a field effect's end is one checkbox; three per-Pokémon "earlier this
   turn" inputs (C19). Every control is NU's (§5.2); Training fills every input from public lines (§6).
6. **The build** (§8): Step 0 (0a kernel and hooks, 0b calculation plumbing, 0c the UI move; byte-equal) → Step 1 (16 fixes)
   → **wave 1a** (A1 A2 A3 D E1 F H S W N NU T1 U1 V1) → integration 1a → **wave 1b** (K M PR CL ST FC E2 T2 U2 V2) →
   integration 1b → wave 2 (R) → integration 2 → seven reviewers, at most two rounds → the final gate. Every track owns its
   files exclusively; after Step 1 the kernel files are frozen (integrator-only one-line changes); a wave 1a track's files are
   frozen in wave 1b unless the plan names their 1b continuation.
7. **Budgets unchanged** (1 500 worlds, 200 000 entries, 160 calculations). T2E's measurement (no sample turn over today,
   worst calculation load 58 of 160) is re-run at both integrations with every new family in (§10).
8. **Nothing is left for the user.** Every question the architects raised is settled by the user's answers or the house rules
   (§11). `userDecisions` is empty.

---

## 1. Review of the four Tier 2 designs

### 1.1 Verified (kept)

The four designs' probes (all `.err` files empty) were re-read; their key claims were checked in `PS/` and the conflicting or
risky ones re-run here:

| Id | Shows (control) | Decides |
|---|---|---|
| CQ01a sv | Contrary Shuckle: Stockpile ×2 counts `def −1, spd −1` then `−2, −2` while the stages fall; Swallow's End returns both to 0 (q:3-8) | C17: IN-C1 is right, SPEC2 §3.1's "+1 per layer Contrary lowered" is wrong |
| CQ01b sv | Simple Swalot at Def +5: one layer counts `−1, −1` (Def rose only 1); Spit Up's End lowers through Simple by 2 each: Def +4, SpD 0 (q:11-14) | the End goes through boost() with the holder's ability (A1) |
| CQ02 sv | Echoed Voice: 16 on turn 1; 31 and 31 for two users on turn 2; nothing on turn 3; 16 again on turn 4 (q:16-45) | C25: one input, the multiplier after last turn |
| CQ03a sv | Turn 1: the lead Intimidate drops Lasher and raises Kingambit (Defiant); Burning Jealousy burns Kingambit, Lash Out deals 57 (q:46-61) | C19 |
| CQ03b sv | The same on turn 2 (a turn of Splash first): no burn, Lash Out 29 (q:63-84) | C19 control |
| CQ03e sv | Turn 2: Incineroar switches in; its Intimidate drops Lasher and raises Kingambit; Lash Out 57, Kingambit burned (q:85-112) | C19: not only turn 1 |
| CQ03c, d sv | Turn 1: a lead Electric Seed used at entry is picked up by a foe's Pickup at turn 1's end (q:114-125); on turn 2 it is not (q:126-140) | C19 (Pickup) |
| CQ04a–e sv | High Jump Kick into Protect: −62 of 125; into Spiky Shield: −15 then −62; under Gravity: `cant`, no crash; Supercell Slam absorbed by Volt Absorb: −72 of 145; into a Substitute: no crash (q:141-195) | C24: T2M's failure set, absorbers included |
| CQ05a sv | Quick Guard on turn 1 (no roll) leaves stall 3; Protect on turn 2 works 1/3, fails 2/3 and deletes the counter (q:196-217) | C23 |
| CQ05b sv | Protect, Wide Guard (no roll, stall 9), Protect: 1/9 (q:218-242) | C23 |
| CQ06a, b sv | A carried Destiny Bond on an asleep Gengar: a faster knockout faints the attacker (q:243-254); a slower one after the aborted BeforeMove does not (q:255-265) | IN-C5, IN-DBD-03 |
| CQ07 sv | Shell Smash at +6 Atk/SpA/Spe: `-boost … 0` lines, only the drops land: no `statsRaisedThisTurn`, no burn from a later Burning Jealousy (q:266-282) | the rise flag needs a changed rise (`PS/sim/battle.ts:2083-2086`); Training counts non-zero lines only |
| CQ08, b usum | Sky Drop lifts a 7.5 kg Clefairy: its own Pound never runs, the partner's Tackle at the user misses, Gust hits it (q:283-300); `PS/data/moves.ts:16774-16784`: Gust and Twister ×2 power at either Pokémon, the pair exempt | C21 |
| CQ09 sv | Two equal-Speed Lightning Rods, one per side, at the lead: the older ability state (p1a's) takes a Thunderbolt from the other rod's ally (q:301-309) | IN-C3; the leads' order is p1a, p1b, p2a, p2b |
| CQ10a–d usum | A Bide from earlier turns releases at its BeforeMove: twice the damage stored (100 for 50, q:310-320); a Ghost is immune (q:321-332); **Protect does not block it** (q:333-344); a faster priority hit this turn adds to the store and becomes the target (168, q:345-355) | C41: T2P's kept carried Bide is modelled |

**Source read directly for this addendum:** `PS/data/moves.ts:17961-18008` (Stockpile), `:4404-4441` (Echoed Voice),
`:3483-3526` (Destiny Bond: BeforeMove −1, MoveAborted, PrepareHit), `:8582` (Helping Hand: `noassist`, `failcopycat`),
`:8909` (High Jump Kick `onMoveFail`), `:16681-16790` (Sky Drop), `:14500-14505` and `:20819-20824` (Quick Guard, Wide Guard:
`onTry` reads willAct only, `onHitSide` adds stall); `PS/data/conditions.ts:439-462` (stall); `PS/data/abilities.ts:742-771`
(Cud Chew: not for Bug Bite or Pluck; counter 1 when the queue is empty), `:3268` (Pickup reads `usedItemThisTurn`);
`PS/sim/battle.ts:413-419` (compareRedirectOrder, no shuffle), `:1670-1683` (nextTurn resets `usedItemThisTurn`,
`statsRaisedThisTurn`, `statsLoweredThisTurn`, `hurtThisTurn` only when `turn !== 1`), `:2083-2086` (the flags);
`PS/sim/battle-actions.ts:495-531` (no target: no MoveFail; every target failed: MoveFail), `:621-641` (the invulnerability
step: Helping Hand passes, `commanding` misses before the Poison-type Toxic and before the event No Guard answers);
`PS/data/moves.ts:294, 2083, 10059` and `PS/data/abilities.ts:3268`: the only readers of the three per-turn flags in these games.

### 1.2 Corrections (rows added to SPEC2 §1.2; the addendum uses these)

| # | Design | Claim | Pinned truth |
|---|---|---|---|
| C17 | SPEC2 §3.1, §5.2 | Stockpile counts "+1 per layer Contrary lowered it"; the calculator writes counters "equal the layers; Contrary −layers" | −1 for each layer whose boost changed the stat, Contrary included (CQ01a); −layers..0. The calculator passes no counts; the engine takes −layers each with the fact `Assumes each of {Name}'s Stockpile layers changed its Defense and Sp. Def.` (IN-C1). |
| C18 | F4 §6, census | Copycat reads a Pokémon's last move; redirect ties by "effectOrder, not known"; a failed Protect is No move; Destiny Bond carried as "used last turn"; type controls write the build | IN-C2…IN-C6 accepted: the battle's last move (IN-P11); the holders' ability-state order for every redirect handler, Follow Me included, no shuffle (IN-P08, CQ09); the engine rolls the stall counter (IN-P02, CQ05); the `destinybond` volatile (IN-P05, CQ06); the type controls write only the turn input's build copy. |
| C19 | all five | The turn starts with no stat rise, drop or item use | Showdown resets `statsRaisedThisTurn`, `statsLoweredThisTurn`, `usedItemThisTurn` at the start of each turn after the first (`PS/sim/battle.ts:1670-1683`); a player's switch-in this turn and its entry effects come after that reset (CQ03e), and on the battle's first turn so do the leads' (CQ03a, c). Lash Out (`:10059`), Burning Jealousy (`:2083`), Alluring Voice (`:294`) and Pickup (`abilities.ts:3268`) read them. New per-Pokémon input `earlierThisTurn` (§3.1); Training reads it from the prelude's world; the oracle harness clears the flags unless a case sets them (§7.1). |
| C20 | T2M §2.1 | `vol.hidden` (the move) beside `eot.hidden` (its end-of-turn view) | One field: `EotState.hidden` widens to the hidden move's id (`"fly" \| "bounce" \| "dig" \| "dive" \| "phantomforce" \| "shadowforce" \| "skydrop"`); its readers use `sheltered(id)` (Dig, Dive) where they read `"sheltered"` today (`doubles-eot.ts:383`). Two fields for one state would drift. |
| C21 | T2P §3.16 | Sky Drop is P's, on T2M's hidden state | H owns Sky Drop's charge turn (`eot.hidden = "skydrop"` on the user, `eot.lifted` on the target). Both are out of reach except to each other and to Gust, Twister, Sky Uppercut, Thunder, Hurricane, Smack Down, Thousand Arrows; Gust and Twister ×2 power at either (`PS/data/moves.ts:16774-16784`); the lifted target's queued move is lost (CQ08); 200 kg and more fails (`[heavy]`). A Sky Drop from an earlier turn has no input (the 2v2 note lists it). |
| C22 | IN §5.2 | `Battle Bond used`: sv, ch | SV only: Champions rejects Battle Bond (T2M §1.3), and USUM's Battle Bond changes the species (Greninja-Ash), which the build shows. `onceUsed` replaces T2M's `bondUsed`. |
| C23 | T2E §3.1 vs IN §3.1 | `stall?: 1 \| 3 …` vs `stall?: 3 …` | `stall?: 1 \| 3 \| 9 \| 27 \| 81 \| 243 \| 729`: 1 is an explicit "none last turn" (no fact); absent is assumed none with the existing fact. Quick Guard and Wide Guard raise the counter and never roll it (CQ05b); a failed roll deletes it (CQ05a). `DoublesCarried.allySwitch` gains `1` the same way. N owns the roll (not D). |
| C24 | T2M §3.1 | Crash "where no target got past the hit steps … an absorber" | Confirmed for Protect, Spiky Shield (its 1/8 first), an absorbing ability, a Substitute (none: it was hit), Gravity (none: stopped in BeforeMove) (CQ04). |
| C25 | T2P §9.1 vs IN §3.1 | `echoedVoiceTurns?: 0–4` vs `echoedVoice?: 0–5` multiplier | `echoedVoice?: 0–5`: the pseudo-weather's multiplier after last turn, 0 none. This turn's every use has `40 × min(5, m + 1)`, or 40 when m is 0 (CQ02). |
| C26 | T2M §3.28 | Helping Hand twice "reachable once a calling move is modelled" | Only through Instruct: Helping Hand is `failcopycat` and `noassist`, Sleep Talk calls it once, Metronome and Mirror Move cannot, and its target is the one ally. T2M-HH-01 is an Instruct case. |
| C27 | T2P §2.1, T2M §3.1 | Two invulnerability hooks at one site | One order (`PS/sim/battle-actions.ts:621-633`): Helping Hand passes everything; `commanding` misses (No Guard and the Poison-type Toxic do not pass it); then the Poison-type Toxic (gen 8+); then the Invulnerability event (the hidden kinds, No Guard, Lock-On, Sky Drop). `presence.invulnerable` is called before `hidden.misses`. |
| C28 | IN §0.5 vs T2E §4.4 | G-Max side conditions from earlier turns "not inputs" | They are (T2E GX06): `SideConditions.gmaxResidual` and four SwSh checkboxes. |
| C29 | IN §5.2 | Cud Chew with no item defaults to Unknown (a new reason) | Today that turn is estimated (the guard fires only with `carried.cudChew`); a due Berry exists only the turn after it was eaten, so None is usually right. Default None with `Assumes {Name} ate no Berry last turn.` (Q4's reasoning, the other way round); `cudChew: true` keeps `needsCudChewBerry`. |
| C30 | none | — | A USUM Pursuit user facing a Pokémon that switched in this turn (`switchedIn`) would have hit the leaving Pokémon before the switch and used its action: `combo("Pursuit", "a Pokémon that switched in this turn")`. |
| C31 | T2M §6 vs T2P §12 | Tracks P and S in both; `doubles-calls.ts` (C) and `doubles-calling.ts` (P); `doubles-start.ts` D's (SPEC2) and S's (T2P) | Renamed (§1.3): W (pairs), S (Substitute and faces), PR (presence), CL (calling: T2M's C and T2P's calling merged), ST (start settle, taking SPEC2 D's three start items), FC, N, NU. |
| C32 | census tr-carried | "Allow an ally source (validation only)" — designed by no one | `carriedIssues` accepts an ally as seeder, trapper and Syrup Bomb source (the handlers read positions and sources, not sides); T maps them; cases CQ-ALY. |
| C33 | T2E §3.1 vs IN §3.1 | `futureMove` and `cudChew` replaced vs widened | Widened (stored cases and today's inputs keep their meaning in Step 0): `futureMove?: string \| { move; source } \| { move; build }` (a bare id: `needsLandingUser`), `cudChew?: true \| string` (true: `needsCudChewBerry`). |
| C34 | T2E §4.7.1, §4.7.3 | Recharge in D's `beforeFirst`; Fake Out's first turn in D's `flingTry` | N's own hooks (`history.beforeMoveStart` at BeforeMove priority 11, `history.moveTry` after `guards.flingTry`): earlier-turn state has one owner. |
| C35 | T2E §8, IN §10 | Two different "Step 0c"s | Step 0c is IN's UI move only; T2E's kernel plumbing is part of Step 0a (§3.5, §8.1). |
| C36 | T2M §4.1, T2P §10 | `callNeedsMoves` added; `needsMoves` generalised | One key: `needsMoves(move, name)` (Imprison's text unchanged). |
| C37 | T2P §3.18 vs IN §3.1, §3.4 | `entryOrder: DoublesSlotId[]` and `presence.breakTie`, text "needs whether … came in first" vs ranks, `history.entryTie`, "have the same Speed; which entered first is not known" | IN's ranks (`Partial<Record<DoublesSlotId, number>>`: the calculator knows only the tie it shows) and N's hook; T2P's text (it names the reader and states no Speed, which for Dancer is stored Speed). |
| C38 | SPEC2 A1, IN | Geomancy's `charging`; `releasesNow` (N); `carriedHidden` (H) | `charging?: string` (any two-turn move); Step 0a's `carriedState` writes `vol.locked` and, for the six hidden moves, `eot.hidden`; the kernel's `chargesThisTurn` reads `vol.locked` (no hook); H owns what the hidden state does. Until H lands, a carried hidden move gives today's `semiInvulnerable` reason. |
| C39 | IN §5.2 | `Protecting moves in a row` and `Ally Switch in a row` share `data-doubles-in-a-row` | `data-doubles-stall` and `data-doubles-ally-switch`. |
| C40 | IN §3.5 | Taunt's carried state has no action issue | A taunted Pokémon cannot choose a status move but Me First, a heal-blocked one a heal-flag move (`PS/data/moves.ts` taunt and healblock `onDisableMove`; their BeforeMove lets the Z-Move and Max Move versions through): action issues (§3.7). |
| C41 | T2P §6.1 | A carried Bide is kept (`Needs the damage stored over earlier turns.`) | Modelled (PR) with one input, `carried.bide` (CQ10): the release is a fixed hit of 2 × stored at the last Pokémon that damaged it, Normal-type immunity read, Protect not read, this turn's earlier move damage added (the Counter family's `taken` mechanism). |
| C42 | T2P §0 | Dancer's Speed ties at the lead are random (1/2) | The Dancers' sort has no shuffle (`PS/sim/battle-actions.ts:331-333`): stored Speed, then the newest ability state first. An equal stored Speed is decided by the entry order (the leads': p1a, p1b, p2a, p2b), else `needsEntryOrder("Dancer", a, b)` as T2P §2.3 itself says. |

### 1.3 Conflicts resolved

**One name per state** (the contract is §3):

| State | SPEC2 | T2M | T2P | T2E | IN | ADDENDUM2 |
|---|---|---|---|---|---|---|
| a two-turn move charged last turn | `charging?: "geomancy"` | union of ids | — | — | `charging?: string` | `charging?: string` (C38) |
| hidden | `eot.hidden` sheltered/semi | `vol.hidden` + `eot.hidden` | `eot.hidden = "skydrop"` | `eot.hidden` | `eot.hidden` | `eot.hidden` = the move id (C20) |
| stall counter | — | — | — | `stall?: 1 \| 3 …` (D) | `stall?: 3 …` (N-E) | `stall?: 1 \| 3 …` (N, C23) |
| once a battle | — | `bondUsed` | — | — | `onceUsed` | `onceUsed` (C22) |
| Safeguard from before | `CaseSide.safeguard` | `SideConditions.safeguard` | — | the same | the same | `SideConditions.safeguard` |
| entry order | — | — | `DoublesSlotId[]` | — | ranks | ranks (C37) |
| Copycat's input | — | — | `lastMoveUsed` | — | `battleLastMove` | `battleLastMove` |
| Echoed Voice | — | — | `echoedVoiceTurns` | — | `echoedVoice` | `echoedVoice` 0–5 (C25) |
| landing | `futureMove?: string` | — | — | object | widened | widened (C33) |
| Cud Chew | `cudChew?: true` | — | — | `{ berry }` | `true \| string` | `true \| string` (C33) |
| field ends | — | — | — | `fieldTurns` + Turns left selects | `fieldTurns` + checkboxes | `fieldTurns`; checkboxes (§5.2) |
| the calling helper | — | `callMove` (C) | `kernel.useCalled` | — | — | `kernel.useCalled` (Step 0a) |
| the tie break | — | — | `presence.breakTie` | — | `history.entryTie` | `history.entryTie` (N) |
| G-Max over time on a side | — | — | — | `gmaxResidual` | "not an input" | `gmaxResidual` (C28) |

**Who owns what two designs both claimed:**

| Item | Claimed by | Owner |
|---|---|---|
| Sleep Talk, Uproar, Helping Hand twice | T2M C, T2P P | CL (`doubles-calling.ts`) |
| Pain Split into a Dynamaxed Pokémon | T2M C | M (`doubles-max.ts`) |
| Safeguard against a damaging move's status | T2M C | W (its `UsesEnv.safeguard`) |
| Sky Drop | T2P P (on H's state) | H (C21) |
| the start settle and SPEC2 D's three start items | SPEC2 D, T2P S | ST (`doubles-start.ts`, the whole `settleDoublesStart` moved by Step 0b) |
| the stall roll, recharge, Fake Out's first turn | T2E D, IN N-E | N (`doubles-history.ts`, C34) |
| the redirect tie | T2P P, IN N-E | N's `entryTie`; PR's Dancer and ST's Download call it |
| the release of a two-turn move | SPEC2 A1, T2M H, IN N-E | the kernel (`vol.locked`, Step 0a); H the hidden part (C38) |
| every calculator control for earlier turns | SPEC2 U, T2M U+, T2P U, T2E U, IN N-U | NU (`doubles-inputs.ts`, `EarlierTurnFields.tsx`) |
| apply actions (Commander, Trace's Intimidate) | T2P U | U (`doubles-prep.ts`, beside Intimidate's) |
| the 5.1 side-residual handler (G-Max, sea of fire) | T2E E, T2P E | E2 (one handler) |
| Booster Energy after a field ends (SPEC2's `boosterAfterRoom`) | SPEC2 A3, T2P FC | FC; A3 calls FC's hook at the room's end (stub: today's reason) |
| Forecast and Flower Gift gained mid-turn (SPEC2's `abilityStart`) | SPEC2 A1, T2P FC | FC's per-holder handler; A1's Start table calls `fieldchange.settleHolder` (stub: today's reason) |

**One hook per site, the order kept.** Where two owners act at one Showdown point, Step 0a inserts one call per owner in
Showdown's order (C27 at the invulnerability step; §3.5). `presenceGuards` (`doubles-turn.ts:774-818`) keeps its loop: each
guard line becomes a call to its owner's hook at the same place, so the first reason a slot gives is unchanged.

---

## 2. Scope (deltas)

### 2.1 Product (additions to SPEC2 §2.1)

- **2v2 turn.** Every Tier 2 entry of §2.3 is estimated where §2.3 says, in every game where it exists, with its step, hit,
  skip and condition facts (§5.1). The turn's first move now starts after what happened earlier in the same turn (C19): a
  Pokémon's `earlierThisTurn` flags (§3.1).
- **End of turn.** New rows: the landing (order 3), the G-Max side residuals and the sea of fire (5.1), Taunt, Encore and
  Disable counting down (15, 16, 17), the field effects from before the turn that end (27.2 Gravity, 27.6 Magic Room, 27.7
  the terrain), Cud Chew and Moody (28.2, in the one Speed-sorted 28.2 group with Harvest, Pickup and Speed Boost), Zen Mode,
  Shields Down and Schooling (29), Uproar's countdown, the Pledge countdowns, a field-settled holder re-settled when the end
  of turn changes the field (FC).
- **E2.** The new outcome fields of §3.1.
- **Earlier-turn state.** The calculator gets every control of §5.2, each shown only where the turn reads it or while set.
  Training passes every input from public lines (§6).
- **1v1.** Unchanged except SPEC2's Fling rows. Every field of §3.2 is set only by the 2v2 turn, Training or a 2v2 control.

### 2.2 Status moves (delta to SPEC2 §2.2)

| Move | SPEC2 | Now | Why |
|---|---|---|---|
| electrify, iondeluge | C, `combo(…, "Electrify")` / `"Ion Deluge"` | **M**, reason left — | Q13 modelled (T2M §3.29; the calculate.ts paths are Step 0b's). `combo` stays for Synchronoise with an added type and Natural Gift under Embargo or Heal Block. |
| magicroom | C, `boosterAfterRoom` | C in wave 1a, **M after integration 1b** | FC's Booster Energy path at the Update after the room ends (§4.3 FC); A3 calls `fieldchange.itemsAfterField` there (Step 0a stub: today's reason). |
| defog | C, `fieldChange` | C in wave 1a, **M after integration 1b** | FC re-settles a terrain-settled holder at Defog's terrain end. |
| skillswap, roleplay, entrainment, doodle, transform | C, `abilityStart` (Supreme Overlord; Forecast on Castform; Flower Gift on Cherrim) | C, `abilityStart` for **Supreme Overlord only** after 1b | A1's Start table calls `fieldchange.settleHolder` for Forecast and Flower Gift (stub: the reason). |
| geomancy | its own `charging: "geomancy"` | the generic two-turn release (C38) | `carried.charging` for every two-turn move; the turn fact generalised (§2.5). |
| stockpile, swallow | counters from the calculator | counts optional (C17) | the calculator passes layers only; the fact of §2.5. |

Counts after integration 1b: **A1 22 M + 8 C, A2 18 M + 4 C, A3 20 M + 1 C: 60 M, 13 C, 0 L.** The integrator flips
`magicroom` and `defog` in `status2/build/classify-a3.md` at integration 1b (two lines) and regenerates `status-table.ts`.

Damaging moves that read new state (no kind of their own; owners in §2.3): High Jump Kick, Jump Kick, Axe Kick, Supercell
Slam (crash, H); every move into a hidden Pokémon (H); Sky Drop (H); Burning Jealousy, Alluring Voice, Spectral Thief
(Step 1), Core Enforcer (K); Lash Out (`earlierThisTurn`, C19); Round, Fusion Bolt / Flare, Counter, Mirror Coat, Metal Burst,
Comeuppance, Beat Up, Flame Burst, the Pledges, Present, Magnitude, Pursuit, Retaliate, Fury Cutter, Rollout, Ice Ball,
Echoed Voice, Trump Card, Bide (PR); Assurance, Sparkling Aria (W); Fake Out, First Impression (N); Struggle (Step 0a kernel);
every Max Move, G-Max move and the moves under Electrify or Ion Deluge (M, Q13); Future Sight and Doom Desire landing (E2).

### 2.3 The census guards (replaces SPEC2 §2.3's "Kept" paragraph; SPEC2's 45 modelled entries stand)

"Wave" is where the owner track runs (§8). "Reason left" is the exact text the entry can still give; — means none.

| # | Entry | Games | Decision | Owner (wave) | Design | Reason left |
|---|---|---|---|---|---|---|
| 1 | semi-invulnerable | all four | **Model**: the hidden state, the invulnerability step for damaging and status moves, the ×2 exceptions, Gravity and Smack Down landing (the queued release cancelled), a release from last turn hidden from the turn's start, Sky Drop's charge turn (C21) | H (1a) | T2M §3.1, T2P §3.16 | — |
| 2 | crash damage (found) | all four | **Fix** (Step 1 #10) | H's module | T2M §3.1.7, C24 | — |
| 3 | volatile-secondaries | BJ sv ch swsh; AV sv ch; ST, CE swsh usum | **Model**: Burning Jealousy, Alluring Voice, Spectral Thief in Step 1 (#12, #13); Core Enforcer in K's first commit | Step 1; K (1b) | T2M §3.2 | — |
| 4 | spread-effect | all four | **Model**: reactions on the user listed by each target's step and replayed in hit order | K | T2M §3.3 | `spreadEffect` only for Dragon Darts whose second dart reads the first's reaction (a Cotton Down target and a Defiant or Competitive user: only after an ability change; no catalog Dragon Darts user has either) |
| 5 | spread-contact-ko | all four | **Model** | K | T2M §3.4 | — |
| 6 | ally-effect | all four | **Model** (`conditions.allyTarget`) | W (1a) | T2M §3.5 | — |
| 7 | redirect-tie | all four | **Model** with the entry order (IN-C3, CQ09) | N (1a) | IN §4.2, T2P §3.18 | `needsEntryOrder(by, a, b)` while the order is Unknown |
| 8 | unnerve-resist | all four | **Model** (stand-ins) | K | T2M §3.6 | — |
| 9 | unnerve-recoil | all four | **Model** (`TurnUnnerve.endsOnKO`) | K | T2M §3.7 | — |
| 10 | cotton-down | swsh | **Model** | K | T2M §3.8 | — |
| 11 | flower-pastel-veil | FV all four; PV swsh | **Model** (`UsesEnv.veil`) | K | T2M §3.9 | — |
| 12 | battle-bond | sv (boost), usum (Ash form) | **Model** | K | T2M §3.10, C22 | — |
| 13 | aftermath-innardsout | AM all four; IO ch swsh usum | **Model** (`koRetaliation`) | K | T2M §3.11 | — |
| 14 | receiver-alchemy | Rec all four; PoA sv usum | **Model** (A1's `setAbility`) | K | T2M §3.12 | A1's `abilityStart` for a copied Supreme Overlord |
| 15 | face-guards | all four | **Model**: multi-hit and Parental Bond through the continuation, every 0-damage item reaction and move effect | S (1a) | T2M §3.13 | — (an Eject Button or Red Card behind a face: the switch family until R) |
| 16 | focus-band | all four | **Model** (1/10 per knocking hit, the self-hit too) | W | T2M §3.14 | — |
| 17 | berry-between-hits | sv swsh usum | **Model** (`stopAt` and the continuation) | W | T2M §3.15 | — |
| 18 | aria-faint | all four | **Model** (`MonState.faintedInHits`) | W | T2M §3.16 | — |
| 19 | gale-wings-gen7 | usum | **Model** (`MoveContext.frozenPriority`) | W | T2M §3.17 | — |
| 20 | assurance-own-hp | all four | **Model** (`hurt` per world from one `ownLossSources` list) | W | T2M §3.18 | — |
| 21 | gmax-effects | swsh | **Model**, Max Guard included | M (1b) | T2M §3.19 | — |
| 22 | gas-ends-shield | sv swsh | **Kept (Q5)** | — | T2P §6.4 | `gasEnds`, `gasShield` |
| 23 | the eight ability moves under Neutralizing Gas | sv swsh | **Kept (Q5)** | — | SPEC2 §4.2 | `withGas` |
| 24 | presence-commander | sv | **Model** | PR (1b) | T2P §2.1 | — |
| 25 | presence-poisonpuppeteer | sv | **Model** | PR | T2P §2.2 | — |
| 26 | presence-dancer | sv usum | **Model** (inserted copies, `kernel.externalUse`) | PR | T2P §2.3 | `needsEntryOrder("Dancer", a, b)` for an equal stored Speed with the order Unknown |
| 27 | presence-moves | Spotlight usum; Round all; Beak Blast sv ch usum; Shell Trap swsh usum; Beat Up all; Fusion sv swsh usum; Counter, Mirror Coat, Metal Burst all, Comeuppance sv ch; Flame Burst usum | **Model** | PR | T2P §3.1–§3.8 | `intoBeakBlast` (a multi-hit contact move into a heating Beak Blast holder whose burn would land between the hits) |
| 28 | presence-calling | all four | **Model** Nature Power, Copycat, Mirror Move, Me First, Instruct, Sleep Talk; Assist in wave 2 (R-E); **keep Metronome** | CL (1b) | T2P §3.9–§3.15 | `needsLastMoveUsed` (Copycat moving before any action, `battleLastMove` Unknown), `needsLastMove` (Mirror Move, Instruct: the existing text, Q3), `needsLastTarget` (Instruct), `needsMoves` (Sleep Talk, moves absent), `needsParty` (Assist, wave 1); Metronome's `Metronome is not modelled in 2v2.` — **justification:** a uniform pick over 553–607 moves, 366–402 of them damaging (TP2·ME1), needs a calculation per damaging move and target, beyond the 160 of the budget on every turn; the text says exactly what the turn does not follow |
| 29 | presence-pledges | sv swsh usum | **Model** (the wait, the 150-power move, sea of fire, swamp, rainbow) | PR, E2 (5.1 and the countdowns) | T2P §3.17 | `combo(move, "the rainbow")` (a later added effect of that side whose doubled chance reaches 100 %), `combo(move, "the swamp")` (a later Gyro Ball or Electro Ball reading the swamped Speed) |
| 30 | presence-custap | sv swsh | **Model** (start variants) | ST (1b) | T2P §4.5 | — |
| 31 | darts-aim-self | sv ch swsh | **Kept** | — | T2M §3.20 | `dartsAimSelf` — **justification:** the one damaging move whose user is its own target (its first dart), which no pairwise calculation can be (attacker = defender); reachable only by aiming Dragon Darts at an ally that moves first with Ally Switch |
| 32 | received-item | Seeds all four, Room Service sv swsh; Booster Energy sv | **Model** the Seeds and Room Service; **keep** Booster Energy | A3 (1a) | T2M §3.21 | `received` for Booster Energy — **justification:** Trick fails with a Paradox Pokémon on either end (T2-RI03), so it needs a non-Paradox Protosynthesis or Quark Drive holder made so in battle (Trace, Skill Swap, Role Play, Receiver, Doodle) and a giver that could not use the item (Klutz, Embargo) |
| 33 | into-substitute | all four | **Model** Max Moves, signature Z-Moves, Mind Blown, Magician, Parental Bond | S | T2M §3.22 | `intoSubstitute` stays defensive: a multi-hit move with recoil, drain or a self-cost (none in any catalog; `doubles-substitute-census.test.ts` asserts it) |
| 34 | sub-per-hit | all four | **Model** constant-power multi-hit moves (`TurnStepPart.fresh`) | S | T2M §3.23 | `subPerHit` for Triple Axel and Triple Kick (a hit's power depends on its index, and no first-hit calculation at that power exists) and for Parental Bond in front of a per-hit effect |
| 35 | eot-landing | all four | **Model** (`kernel.residualHit`) | E2 (1b) | T2E §4.1 | `landingPartners` (a user not in battle with two holders of one partner boost on its side: a duplicate species only); `needsLandingUser` (a bare move id, C33) |
| 36 | eot-cudchew | sv ch | **Model** | E2 | T2E §4.2, C29 | `needsCudChewBerry` (`cudChew: true`) |
| 37 | Moody (E2) | all four | **Model** (E2 always branches; the calculator's walks only with a reader) | E2 | T2E §4.3 | — |
| 38 | eot-overtime | swsh | **Model** (+ `gmaxResidual`) | E2 | T2E §4.4, C28 | — |
| 39 | eot-form-change | all four | **Model** Zen Mode, Shields Down, Schooling; **keep** Power Construct | E2 | T2E §4.5 | `formChange("Power Construct", name)` where the HP can cross half — **justification:** its maximum HP changes in some outcomes and the final Update reads the new maximum (FC06), while `DoublesHP` has one maximum per Pokémon; Zygarde is in USUM and SwSh only and not in Training |
| 40 | settle-trace-random | all four | **Model** (1/k start variants as entered; Trace copying Intimidate) | ST | T2P §4.1 | `Trace copies a random foe's ability.` only for a candidate whose Start changes the field or HP as it enters (the input's field and HP are after the entry effects) |
| 41 | settle-two-act | all four | **Model** (`SettleReads`) | ST | T2P §4.2 | — |
| 42 | settle-download | sv swsh usum | **Model** (the lead's Start order; ties as variants) | ST | T2P §4.3 | — |
| 43 | row-history-moves | see T2P §6.1 | **Model** Present, Magnitude, Pursuit, Retaliate, Fury Cutter, Rollout, Ice Ball, Echoed Voice, Trump Card and a carried Bide (C41) | PR | T2P §6.1, C41 | the rows' own texts while their earlier-turn input is Unknown; `combo("Pursuit", "a Pokémon that switched in this turn")` (C30) |
| 44 | row-engine-limits | all four | **Kept** | — | T2P §6.2 | the 1v1 rows — **justification:** the 1v1 calculation's own limits for a pair, kept byte-equal by rule |
| 45 | step-stops | all four | **Model** the field part (FC, `UsesEnv.fieldFollowed`); keep the rest | FC | T2P §6.2, §5.2 | `fieldChange` only for a field change between two hits of one move; `A later use cannot be calculated` — **justification:** one move's hits are one pairwise calculation with one field |
| 46 | needs-moves | all four | **Kept** (`needsMoves`, generalised) | — | T2P §6.3 | **justification:** an input-completeness text; the calculator passes every Pokémon's quick moves and Training its move slots |
| 47 | pain-split-dynamax | swsh | **Model** | M | T2M §3.24 | — |
| 48 | face-self-hit | all four | **Model** | S | T2M §3.25 | — |
| 49 | sleep-talk-uproar | all four | **Model** | CL | T2M §3.26, T2P §3.14 | `needsMoves("Sleep Talk", name)` with its moves absent |
| 50 | safeguard-damaging-status | all four | **Model** (`UsesEnv.safeguard`; `SideConditions.safeguard`) | W | T2M §3.27 | — |
| 51 | helping-hand-twice | all four | **Model** (through Instruct, C26) | CL | T2M §3.28 | — |
| 52 | unburden-start-berry | all four | **Fix** (Step 1 #9) | Step 1 | T2P §5.1 | — |
| 53 | field-change | all four | **Model** (`fieldchange.changed` at every trigger, per world) | FC | T2P §5.2 | as #45 |
| 54 | activates | sv (wind), sv swsh (Room Service) | **Model** | FC | T2P §5.3 | — |
| 55 | tr-field-side | champions | **Model** Magic Room's end (`fieldTurns`), Safeguard, Mist, Lucky Chant; keep the id templates | T2 (1b), E2 | T2E §4.6 | `Weather {id} …`, `Field effect {id} …`, `Side effect {id} …` as defensive templates for an id the simulator adds later |
| 56 | tr-moves-state | champions | **Model** recharge, Struggle, Fake Out after the first turn, Payback and Analytic with a switch-in, Sleep Talk | N, Step 0a, T2 | T2E §4.7 | `{move} is not in its catalog moves.` (catalog data), `{Name} must recharge.` (defensive) |
| 57 | tr-splits-prelude | champions | **Model** the stall roll (N), the prelude's ties and Trace (Step 1 #15); the replacement in wave 2 (R-T) | N, Step 1, R-T | T2E §4.8 | `Prelude failed: {message}` (an engine error class), `The battle ended before the moves.` |
| 58 | too-many, engine-error | all four | **Kept** | — | T2E §4.9 | `Too many cases to follow.`; `This matchup could not be calculated: {message}` — **justification:** the exact fallback of a bounded search (measured, §10) and an error class (0 in 10 000 sample turns) |

**SPEC2's three Training entries, their remaining parts:** tr-volatiles (every volatile the contract now carries is mapped
by T1 or T2; `electrify` and `powder` cannot stand at a turn's start), tr-ability-changed (Illusion stays: a hidden identity),
tr-carried (an ally as seeder, trapper or Syrup Bomb source is modelled: C32; `its Substitute's HP after a hit is not public`
stays: hidden information; `needs the public counts` and `a G-Max trap` stay defensive: Champions has neither case).

### 2.4 REASONS deltas (`doubles-actions.ts`; delta to SPEC2 §2.4; exact text)

**Added** (Step 0a writes every key; a track starts calling it; the integrator removes a key at the integration where its last
site goes, `doubles-actions.ts` being frozen after Step 1):

```ts
  // status2 ADDENDUM2 §2.4
  /** N: a used Protean or Libero (abilityActive false) whose types the input does not give. */
  typeUnknown: (name: string, ability: string) => `${name}'s type after ${ability} is not known.`,
  /** N: a tie the entry order decides (a redirection at one Speed, Dancers at one stored Speed) with the order Unknown ("Follow Me", "Rage Powder", "Spotlight", "Lightning Rod", "Storm Drain", "Dancer"). */
  needsEntryOrder: (by: string, a: string, b: string) => `${by} needs whether ${a} or ${b} came in first.`,
  /** CL: Copycat before any action of the turn with battleLastMove absent. */
  needsLastMoveUsed: (move: string) => `${move} needs the last move used before this turn.`,
  /** CL: Instruct into a Pokémon whose last move is an earlier turn's single-target move with lastMoveTarget absent. */
  needsLastTarget: (move: string, name: string) => `${move} needs the target of ${name}'s last move.`,
  /** CL, wave 1 only: Assist (its party's moves come with R's bench). */
  needsParty: (move: string, name: string) => `${move} needs the moves of ${name}'s party.`,
  /** PR: a multi-hit contact move into a heating Beak Blast holder whose burn would land after the first hit. */
  intoBeakBlast: (move: string, name: string) => `${move} into ${name}'s Beak Blast is not modelled in 2v2.`,
  /** E2: a landing from a Pokémon not in battle with two holders of one partner boost on its side. */
  landingPartners: (move: string, ability: string) => `${move} landing with two ${ability} holders on its user's side is not modelled in 2v2.`,
  /** E2: a landing given as a bare move id (C33). */
  needsLandingUser: (move: string) => `${move} landing needs its user.`,
  /** E2: cudChew true (a Berry, not known which; C33). */
  needsCudChewBerry: (name: string) => `Cud Chew needs ${name}'s Berry from the last turn.`,
```

**Changed** (Imprison passes "Imprison", so its text is unchanged and Step 0 stays byte-equal; C36):

```ts
  needsMoves: (move: string, name: string) => `${move} needs ${name}'s moves.`,
```

**Reused:** `combo(move, what)` (SPEC2) for "the rainbow", "the swamp" and "a Pokémon that switched in this turn" (Pursuit, C30);
`needsLastMove` for Mirror Move and Instruct; `formChange` for Power Construct; `notIn2v2("Metronome")`.

**Removed** (each at the integration where its last site goes): `semiInvulnerable` (H; also its Step 0 stub for a carried
release), `focusBand`, `berryBetweenHits`, `ariaFaint`, `allyEffect` (W), `faceSelfHit`, `faceMultiHit` (S), `maxGuard`,
`randomStatus`, `withDynamax` (M), `pledges` (PR), `activates` (FC), `landing` (replaced by `needsLandingUser`), `overTime`
(E2); `boosterAfterRoom` (A3 → FC, 1b); the `notIn2v2` sites for Core Enforcer, Burning Jealousy, Alluring Voice, Spectral
Thief, Cotton Down, Flower Veil, Pastel Veil, Battle Bond, Aftermath, Innards Out, Receiver, Power of Alchemy, Unnerve and As
One, Disguise and Ice Face, Gale Wings, Assurance, the G-Max moves, Sleep Talk, Uproar, Safeguard, Helping Hand, Commander,
Custap Berry, the redirect tie, Cud Chew, Moody, Poison Puppeteer; `notModelled("Dancer")`; every `PRESENCE_MOVES` and
`PENDING_MOVES` member; `CALLING_MOVES` but Metronome (Assist leaves in wave 2); `fieldChange` at every site but between two
hits; the settle's `{A} and {B} both act on {C} as the turn starts.`, `Download is not modelled with {Foe}'s entry boost.` and
`Trace copying Intimidate is not modelled in 2v2.`; the Unburden throw at `doubles-status.ts:174`. The sets `PRESENCE_MOVES`,
`PENDING_MOVES`, `CALLING_MOVES`, `FACE_REACTIVE_ITEMS`, `FACE_UNSAFE_MOVES`, `RANDOM_STATUS_MAX_MOVES`, `FAINT_REACTIONS` and
the members of `EVENT_THIRD_PARTY` / `PRESENCE_THIRD_PARTY` the tracks model are emptied by the integrator; each track's hook
stops reading them as it models their members, so no track edits `doubles-actions.ts`.

**Kept (narrow), with the entry they belong to:** `spreadEffect` (#4), `subPerHit` (#34), `intoSubstitute` (#33), `received`
(#32), `dartsAimSelf` (#31), `formChange` (#39), `fieldChange` between hits (#45), `combo` (SPEC2 A2's, #29, #43), `abilityStart`
(Supreme Overlord), `notIn2v2("Metronome")` (#28), `notIn2v2("Ripen")` for a multi-hit move into a weakened Berry (SPEC2 D),
`needsEntryOrder`, `needsLastMoveUsed`, `needsLastTarget`, `needsParty` (wave 1), `needsMoves`, `needsLandingUser`,
`needsCudChewBerry`, `typeUnknown`, `intoBeakBlast`, `landingPartners`, the rows' needs-context texts while their input is
Unknown, `gasEnds`, `gasShield`, `withGas` (Q5), `tooMany`.

### 2.5 Turn facts (delta to SPEC2 §2.5; each only when it applies; exact)

New:
- `Assumes {Name} did not charge {Move} last turn.`: its action is a two-turn move that would charge this turn and there is no
  `carried.charging` (replaces SPEC2's Geomancy-only text).
- `Assumes each of {Name}'s Stockpile layers changed its Defense and Sp. Def.`: Swallow or Spit Up (or a Snatch user's stolen
  Swallow reading its own) with `carried.stockpile` and no counts (C17).
- `Assumes {Name} has not had Battle Bond act before in this battle.`: SV, a Greninja-Bond that can knock a foe out, without
  `onceUsed` holding `battlebond` (K; Q12's pattern).
- `Assumes {Tatsugiri} went inside {Dondozo} as they came in.`: the calculator's commanding pair (PR; Q8's pattern).
- `Assumes {Name}'s Trace copied as it came in: {A} from {Foe} or {B} from {Foe2}, 1/2 each.`: Trace unset with two
  candidates (ST).
- `Assumes {Name}'s {Move} has PP left.`: an Instruct target's move (CL).
- `Assumes {Name} did not use Uproar last turn.`: its action is Uproar and there is no `carried.uproar` (CL: an Uproar from
  last turn stops every sleep from the turn's start, a new one only from its hit).
- `Assumes {Name} did not use Bide on an earlier turn.`: USUM, its action is Bide and there is no `carried.bide` (PR, C41).
- `Assumes {Name} ate no Berry last turn.`: a Cud Chew holder holding no Berry, without `carried.cudChew` (E2, C29).
- `Assumes {Name}'s stats did not rise earlier this turn.`: a Burning Jealousy or Alluring Voice of the turn can reach it,
  `earlierThisTurn.statsRaised` is not set and it has a stage above 0 as the turn starts (C19).
- `Assumes {Name} used no item earlier this turn.`: a Pickup holder holding nothing is in the turn, it holds nothing, its
  `lastItem` is set and `earlierThisTurn.usedItem` is not (C19).
- Facts that are not assumptions: `{Name} switched in this turn and takes no action.`, `{Name} must recharge.` (T2E).

Given only while the input is absent (each now has a control): `Assumes no protecting move was used last turn.` (unless every
protecting or Endure user has `carried.stall`), `Assumes {Name} did not use Ally Switch last turn.`, `Assumes {Name} did not use
Destiny Bond last turn.`, `Assumes the attacker's first turn in battle.` (without `firstTurn`), `Assumes the {Weather} does not
end this turn.`, `Assumes the {Terrain} Terrain does not end this turn.`, `Assumes Gravity does not end this turn.`, `Assumes Magic
Room does not end this turn.`, `Assumes {side} has a Pokémon left to switch in.` (the box unticked and, under R, no bench).

Removed: `Moody raises one stat and lowers another.` (E2: residual facts instead); SPEC2's Geomancy-only charge fact.

---

## 3. Contract (deltas to SPEC2 §3, paste-ready; Step 0 writes all of it)

SPEC2's rule holds for every field below: optional, set only by the 2v2 turn, Training's bridge or a 2v2 calculator control;
no 1v1 input and no Step 0 world sets one, which keeps Step 0's gates byte-equal. Where a design's block is accepted as written
it is named; every change to it is spelled out here.

### 3.1 `app/lib/battle/doubles-types.ts`

```ts
export type DoublesCarried = {
  /* …existing, and SPEC2 §3.1's fields, with `stockpile` and `charging` replaced as below… */

  // ---- changed from SPEC2 §3.1 ----
  /** Stockpile from earlier turns: 1–3 layers and the counts its End reverses (PS/data/moves.ts:17961-18008 effectState.def
   *  / spd: −1 for each layer whose boost changed the stat, Contrary included; −layers..0: C17). Counts absent: −layers each
   *  (the turn fact). */
  stockpile?: { layers: 1 | 2 | 3; def?: number; spd?: number };
  /** A two-turn move it charged last turn (the twoturnmove volatile): its action is that move, released with no charge
   *  (Power Herb kept); Fly, Bounce, Dig, Dive, Phantom Force and Shadow Force hold it out of reach from the turn's start
   *  until its action (T2-SI12b, IN-P03). One of the game's CHARGE_TURN_MOVES, SEMI_INVULNERABLE_MOVES or Geomancy; never
   *  Sky Drop (C21). */
  charging?: string;
  /** (status-eot's field, widened) the Ally Switch counter; 1: not used last turn, no assumption (C23). */
  allySwitch?: 1 | 3 | 9 | 27 | 81 | 243 | 729;

  // ---- widened (C33): today's forms keep today's meaning in Step 0 ----
  /** A Future Sight or Doom Desire landing on this slot (a position) at this end of turn (PS/data/conditions.ts:379-421).
   *  A bare move id: its user not given (needsLandingUser). `source`: its user, a Pokémon of this turn (the slot it started
   *  in); `build`: its user not in battle now, as it is now (its ability, item and stages do not count:
   *  PS/sim/pokemon.ts:858-885). A `source` equal to the slot is valid: the landing does not hit its own user. */
  futureMove?: string
    | { move: "futuresight" | "doomdesire"; source: DoublesSlotId }
    | { move: "futuresight" | "doomdesire"; build: BattleBuild };
  /** Cud Chew re-eats this Berry at this end of turn (28.2); true: a Berry, not known which (needsCudChewBerry). */
  cudChew?: true | string;

  // ---- H ----
  /** Lock-On or Mind Reader from last turn at the Pokémon that started this turn in that slot (the lockon volatile). */
  lockOn?: DoublesSlotId;

  // ---- N (IN §3.1, with C23) ----
  /** The stall counter after its successful protecting moves in a row ending last turn (Protect, Detect, Endure, the
   *  shields, Max Guard; Quick Guard and Wide Guard raise it without rolling it: CQ05); 1: none last turn (no assumption).
   *  Its protecting move or Endure this turn works with 1/stall (PS/data/conditions.ts:439-462). */
  stall?: 1 | 3 | 9 | 27 | 81 | 243 | 729;
  /** It used a recharge move last turn (mustrecharge, BeforeMove priority 11): its action is No move. */
  mustRecharge?: true;
  /** Destiny Bond from last turn still up (it has not tried to act since: PS/data/moves.ts:3483-3526). */
  destinyBond?: true;
  /** SwSh, USUM: Laser Focus used last turn: every damaging hit it deals this turn is critical where one can be. */
  laserFocus?: true;
  /** Turns left before this end of turn's countdown (1: it ends at this end of turn): Taunt 15, Encore 16, Disable 17. */
  taunt?: 1 | 2 | 3;
  encore?: { move: string; turns: 1 | 2 | 3 };
  disable?: { move: string; turns: 1 | 2 | 3 | 4 };
  /** Generation 9 (SV, Champions): the once-a-battle effects it already had (bondTriggered, swordBoost, shieldBoost,
   *  syrupTriggered). Battle Bond only in SV (C22). */
  onceUsed?: readonly ("battlebond" | "intrepidsword" | "dauntlessshield" | "supersweetsyrup")[];

  // ---- CL ----
  /** An Uproar from an earlier turn: its turns left as this turn starts (1 or 2); its action is Uproar. */
  uproar?: 1 | 2;

  // ---- PR (T2P §9.1, with C41) ----
  /** Training only (an SV-format build): Tatsugiri inside its ally Dondozo. */
  commanding?: true;
  /** Fury Cutter: its uses in a row before this turn (4: the 160 cap). Rollout, Ice Ball: the lock's hits so far. */
  furyCutter?: 0 | 1 | 2 | 3 | 4;
  rollout?: 0 | 1 | 2 | 3 | 4;
  /** Defense Curl used since it came in (Rollout and Ice Ball ×2). */
  defenseCurl?: true;
  /** PP left before this turn's use, by move id (Trump Card; Instruct's fact). */
  ppLeft?: Record<string, number>;
  /** USUM: a Bide from earlier turns (PS/data/moves.ts:1264-1338): the damage stored so far, the Pokémon that last
   *  damaged it, and whether this turn is its release (else it stores, doing nothing at its BeforeMove). */
  bide?: { stored: number; source: DoublesSlotId | null; release: boolean };
};

export type DoublesPokemonInput = {
  /* …existing, and SPEC2's `moves` (move-slot order) and `lastItem`… */
  /** The target its lastMove was aimed at (Instruct); null: none chosen (a self, side or spread move). Absent: unknown. */
  lastMoveTarget?: DoublesSlotId | null;
  /** It switched in this turn before the moves (its player's switch, Training's prelude): no action (its action must be
   *  No move), no BeforeMove, `moved` from the start; Payback is not doubled into it, Bolt Beak and Fishious Rend are,
   *  Analytic does not wait for it, Core Enforcer and Helping Hand read it (pokemon.newlySwitched: T2E §4.7.4). */
  switchedIn?: true;
  /** Fake Out and First Impression: false, not its first turn since it came in (activeMoveActions > 1). Absent: its first
   *  (the existing fact). */
  firstTurn?: boolean;
  /** What happened to it earlier this turn, before the first move (a switch-in's entry effects; on the battle's first turn
   *  the leads'): pinned statsRaisedThisTurn, statsLoweredThisTurn, usedItemThisTurn, which nextTurn clears only from
   *  turn 2 and before the switches (PS/sim/battle.ts:1670-1683, 2083-2086; C19). Absent: none. */
  earlierThisTurn?: { statsRaised?: true; statsLowered?: true; usedItem?: true };
};

export type DoublesTurnInput = {
  /* …existing, and R's Step 2 fields in wave 2… */
  /** Turns left before this turn's countdown of a field effect up as the turn starts (1: it ends at this end of turn:
   *  Gravity 27.2, Magic Room 27.6, the terrain 27.7). Absent: it lasts (the existing facts). weatherTurns stays the weather's. */
  fieldTurns?: Partial<Record<"terrain" | "gravity" | "magicRoom", number>>;
  /** When each Pokémon's ability state began (abilityState.effectOrder: its switch-in, or a later ability change), smaller
   *  first; equal or missing ranks are not ordered against each other (C37). Absent: unknown. The leads of a battle's
   *  first turn are, in order, own-left, own-right, opponent-right, opponent-left (p1a, p1b, p2a, p2b: CQ09). */
  entryOrder?: Partial<Record<DoublesSlotId, number>>;
  /** The last move used in the battle before this turn, by any Pokémon (battle.lastMove: Copycat); null: none. */
  battleLastMove?: string | null;
  /** Per side: a Pokémon of the side fainted last turn (side.faintedLastTurn: Retaliate). Absent: unknown. */
  faintedLastTurn?: Partial<Record<DoublesSideId, boolean>>;
  /** The echoedvoice pseudo-weather's multiplier after last turn, 1–5; 0: none last turn. Absent: unknown (C25). */
  echoedVoice?: 0 | 1 | 2 | 3 | 4 | 5;
};

export type DoublesStep = {
  /* …existing… */
  /** A second step of the same Pokémon this turn: a Dancer's copy or an instructed move (T2P §2.3, §3.13). */
  copied?: "Dancer" | "Instruct";
};

export type DoublesOutcomeMon = {
  /* …existing and SPEC2 §3.1's… */
  /** The two-turn move it charged this turn (its release next turn); present exactly when volatiles has "twoturnmove". */
  charging?: string;
  /** Generation 9's once-a-battle effects after the turn. */
  onceUsed?: string[];
  /** G-Max Chi Strike layers (SwSh). */
  chiStrike?: 1 | 2 | 3;
  /** The Berry Cud Chew re-eats at the next end of turn. */
  cudChew?: string;
};
// SPEC2's DoublesOutcomeMon.turnsLeft keys gain "taunt" | "encore" | "disable" | "uproar".
// DoublesOutcomeMon.volatiles gain: the hidden move's id beside "twoturnmove", "skydrop", "lockon", "uproar",
// "gmaxchistrike", "commanding", "commanded"; "taunt", "encore", "disable" only while turns are left.
// DoublesOutcome.sides[side] gains: pledge?: Partial<Record<"fire" | "grass" | "water", number>> (turns left);
// gmax?: string[] (SwSh: the G-Max side conditions up).
```

### 3.2 `app/lib/battle/types.ts`

```ts
// BuildBase, calculation-only markers (beside SPEC2's; the 2v2 turn's calcBuild derives them; no input carries them):
  takenMods?: { minimize?: true; glaiveRush?: true; berryWeaken?: true;
    /** H: the defender is hidden by this move: Fly, Dig, Dive ×2 final damage for their move lists; Bounce and Sky Drop
     *  ×2 base power for Gust and Twister (PS/data/moves.ts:1703, 3586, 3748, 5895, 16774-16784). */
    hidden?: "fly" | "bounce" | "dig" | "dive" | "skydrop" };
  /** M: G-Max Chi Strike layers on it: +n critical-hit stage. */
  critBoost?: 1 | 2 | 3;
  /** N: Laser Focus from last turn: critical-hit ratio at least 5. */
  laserFocus?: true;

// MoveContext ("Set only by the 2v2 turn"), beside SPEC2's stockpile, retype, hiddenStages:
  frozenPriority?: number;              // W, generation 7 (T2M §3.17)
  helpingHands?: 2 | 3;                 // CL (T2M §3.28)
  basePower?: number;                   // PR: Round 120, a combined Pledge 150, Present, Magnitude, Fury Cutter, Rollout, Ice Ball, Echoed Voice, Trump Card
  powerMods?: number[];                 // PR: Fusion 8192, Me First 6144, Retaliate 8192 (as withPowerMods)
  retypeTo?: string; forceStab?: true;  // PR: a combined Pledge's type and its STAB
  switching?: false;                    // PR: Pursuit with no switching target

// BattleConditions ("Doubles turn only"), beside SPEC2's mudSport, waterSport, ionDeluge:
  /** W: the move's target is the user's ally: the priority shields' and Psychic Terrain's priority blocks do not apply. */
  allyTarget?: boolean;

// SideConditions ("Doubles turn only"), beside SPEC2's mist, luckyChant, protectName:
  /** Safeguard up on the side from an earlier turn. */
  safeguard?: boolean;
  /** SwSh: G-Max damage over time on the side from an earlier turn (onResidual 5.1). */
  gmaxResidual?: ("gmaxvinelash" | "gmaxwildfire" | "gmaxcannonade" | "gmaxvolcalith")[];
  /** The Grass Pledge + Water Pledge swamp: Speed ×0.25 (turnSpeed's ModifySpe chain). */
  swamp?: boolean;
```

`validateBuild` and `validateConditions` (model.ts) add §3.7's issues for the 2v2-only keys.

### 3.3 `app/lib/battle/doubles-world.ts` (internal)

```ts
// MoveVolatiles gains (one writer each):
  lockOn?: DoublesSlotId;                       // carriedState (H reads)
  /** The two-turn move it is locked into this turn (carried.charging), until its action (C38). */
  locked?: string;                              // carriedState; the kernel's chargesThisTurn reads it
  stall?: number;                               // N (readers rule: only with its own protecting move this turn)
  mustRecharge?: true;                          // carriedState (N reads)
  laserFocus?: true;                            // carriedState (calcBuild reads)
  onceUsed?: readonly string[];                 // carriedState; A1 (Q12) and K (Battle Bond) read and write
  uproar?: number;                              // CL: turns left after this one
  chiStrike?: 1 | 2 | 3;                        // M
  beakBlast?: true; shellTrap?: { hit: boolean }; usedTarget?: DoublesSlotId;   // PR
  bide?: { stored: number; source: DoublesSlotId | null; release: boolean };    // carriedState, PR

// EotState changes:
  /** (widened, C20) the hidden move of a charge or a carried release; sheltered(id) = Dig or Dive. */
  hidden?: "fly" | "bounce" | "dig" | "dive" | "phantomforce" | "shadowforce" | "skydrop";
  /** H: lifted by the Sky Drop user at this slot. */
  lifted?: DoublesSlotId;
  /** (widened, C33) */
  futureMove?: { move: "futuresight" | "doomdesire"; source: DoublesSlotId | null; build: BattleBuild | null } | { bare: string };
  cudChew?: true | { berry: string; counter: 1 | 2 };
  /** Turns left before this end of turn's countdown (N's inputs; a use this turn writes its fresh duration: Taunt 3, 4 when
   *  its target had moved; Encore 3, 4 when it had moved; Disable 5, 4 when it has not moved yet). */
  tauntLeft?: number; encoreLeft?: number; disableLeft?: number;
// EotState.trap gains gmax?: true (G-Max Centiferno, Sandblast: it outlives its source).

// MonState gains:
  faintedInHits?: true;                         // W (only with a Sparkling Aria user in the turn)
  /** The last hits from foes this turn (Counter family, a releasing Bide); only while one of them is queued on it. */
  taken?: Partial<Record<"physical" | "special" | "any", { from: DoublesSlotId; damage: number }>>;
  commanding?: DoublesSlotId; commanded?: DoublesSlotId;   // PR
  /** Its ability state's age (input entryOrder, then this turn's changes, each later than all before); only with a tie reader. */
  entry?: number;                               // N
// MonState.destinyBond (exists) from carried.destinyBond; statsRaised, statsLowered (exist) and SPEC2's usedItem from
// earlierThisTurn (startWorld).

// SideState gains: pledge?: Partial<Record<"fire" | "grass" | "water", number>> (PR sets, E2 counts down); gmax?: string[] (E2).
// PendingAction gains: source?: string (a pulled Round, the waiting Pledge, "instruct"); external?: true (a Dancer's copy).
// World gains: didSomething?: true; lastSuccessful?: string | null; lastMove?: string | null (each only with its reader).
```

**The readers rule (SPEC2 §4.9) for the new fields:** `vol.stall` only with the Pokémon's own protecting move or Endure this
turn; `MonState.entry` only with two possible redirectors of one move, two Dancers, or a Download holder (`ctx.entryReaders`);
`taken` only while a Counter-family user or a releasing Bide is queued on the Pokémon; `faintedInHits` only with a Sparkling
Aria user; `didSomething` and `lastSuccessful` only with a Dancer or a Fusion user; `World.lastMove` only with a Copycat user;
`chiStrike` only in SwSh; `eot.hidden` only by a charge or a carried release; the Cud Chew counter only inside `noteItemUse`
(gated by `tracksItems`); `earlierThisTurn.usedItem` only with a Pickup holder. Every new field enters `discreteKey` through
`mons`, `sides`, `field` and `World`'s keyed fields; `cloneWorld` copies them.

### 3.4 `status-table.ts`

Unchanged by this addendum except the integrator's two-row flip at integration 1b (§2.2).

### 3.5 Step 0a: modules, hooks and kernel plumbing (additions to SPEC2 §3.5)

SPEC2's modules stand, with one change: **`doubles-start.ts` holds the whole `settleDoublesStart`** (calculate.ts:3152-3306),
moved verbatim **by the Step 0b builder** (calculate.ts is 0b's); calculate.ts exports the 1v1 helpers it calls and re-exports
`settleDoublesStart`. Its owner is ST (SPEC2 D's three start items go with it). SPEC2's `fieldGuard` moves to
`doubles-fieldchange.ts` (FC), not `doubles-field.ts`; `fieldMove` stays A3's and calls FC's two hooks.

**New hook modules** (each imports the `TurnKernel` type only and may import other hook modules' exports; never
`doubles-turn.ts`):

| File | Owner | Step 0 contents (moved verbatim, or a stub reproducing today) |
|---|---|---|
| `doubles-hidden.ts` | H | T2M §2.2's row (`chargeHidden` moved from doubles-turn.ts:1884; stubs `misses`, `missesStatus`, `missesField`, `land`, `release`, `crash`), plus `carriedStart` (a carried hidden move: today's `semiInvulnerable` reason; C38) and `skyDrop` (null: today's `PENDING_MOVES` guard) |
| `doubles-reactions.ts` | K | T2M §2.2's row, plus `beforeStep` (null: Spectral Thief's steal before the target's calculation, called in singleStep and spreadStep's plans before `searchFor`) |
| `doubles-pairs.ts` | W | T2M §2.2's row, plus `safeguard` (moved from doubles-status.ts:534-539) |
| `doubles-faces.ts` | S | T2M §2.2's row |
| `doubles-max.ts` | M | T2M §2.2's row, plus `painSplitMax` (moved from doubles-status.ts:1789) |
| `doubles-presence.ts` | PR | T2P §9.3's presence rows: the guard lines of presenceGuards for Commander (doubles-turn.ts:782), Poison Puppeteer's PRESENCE_THIRD_PARTY line (785-789; Imposter stays the settle's), Dancer (795), PRESENCE_MOVES (798; Sky Drop's PENDING_MOVES half to H), the Pledges (802-807); stubs `turnStart`, `afterAction`, `statusMove`, `aim`, `tryMove`, `prepareHit`, `invulnerable` (false), `tracksHits` (false), `afterHit`, `onFaint`, `cannotLeave` (false), `afterSetStatus`, `context` (undefined), `bide` (the row's reason) |
| `doubles-calling.ts` | CL | the CALLING_MOVES guard line (doubles-turn.ts:801); doubles-status.ts presenceGuards' Sleep Talk and Uproar lines (458-468); the Sleep Talk branch of statusMove (762-767) as `statusMove`; the Helping Hand guard (849-850) as `helpingHand`; stubs `uproarSleep` (false), `context` (undefined) |
| `doubles-fieldchange.ts` | FC | `fieldGuard` moved verbatim (doubles-status.ts:928-946) as `beforeFieldMove`; the step's and the end of turn's field-change guard sites (doubles-turn.ts:2119; doubles-eot.ts:307, 524, 1099-1105) as `stepField` and `eotField`; stubs `afterFieldMove` (no-op), `changed` (today's guard), `sideStarted` (no-op), `pseudoWeatherChanged` (no-op), `itemsAfterField` (SPEC2's `boosterAfterRoom` reason), `settleHolder` (SPEC2's `abilityStart` reason) |
| `doubles-history.ts` | N | IN §4.2's hooks without `releasesNow` (C38): `stallPrepare` ([w]), `destinyBondBefore` (none), `entryTie` (null: today's guard), `entryChanged` (none), `proteanUsed` (none); plus `beforeMoveStart` (none; recharge at priority 11) and `moveTry` (null; Fake Out and First Impression after the first turn) |

`doubles-substitute.ts` becomes S's file as it is. The kernel's `TurnKernel` members that point at moved code keep their names
and delegate. `presenceGuards` keeps its loop and its order: each guard line calls its owner's hook in place (C27's rule).

**Hook calls Step 0a inserts** (in addition to SPEC2 §3.5's): every row of T2M §2.2's table, T2P §9.3's table and IN §4.2's
table, with these changes:
- the invulnerability step (hitChecks before Wide Guard; doubles-status.ts tryHit's targets; Perish Song's and A3's Teatime's
  own checks): `presence.invulnerable` then `hidden.misses` / `missesStatus` / `missesField` (C27);
- `carriedState` (doubles-turn.ts:861): writes `vol.locked` for `carried.charging` and, for the six hidden moves, `eot.hidden`;
  then `hidden.carriedStart` (stub: the reason) — no `hidden.carriedHidden`, no `history.releasesNow` (C38);
- `chargesThisTurn` (doubles-turn.ts:1866): false when `vol.locked === move.id` (and not a Z-Move or Max Move): kernel code,
  inert; A1's Geomancy reads the same;
- `redirection` (doubles-turn.ts:1349-1360): `history.entryTie` (not `presence.breakTie`); its stub is today's guard;
- `earlyBranch` (doubles-status.ts:822-835, after the `willAct` check, before `mon.protect` / Endure): `history.stallPrepare`
  (not `guards.stallCheck`);
- `beforeMove` (doubles-status.ts:124-152): after `guards.beforeFirst` (priority 100), `history.beforeMoveStart` (11:
  recharge); at −1 (after paralysis, before `focusCheck`) and on every stopped world, `history.destinyBondBefore`;
- `damagingMove` after `moveInfo`, after `guards.flingTry`: `history.moveTry`;
- singleStep and spreadStep's plans before `searchFor`: `reactions.beforeStep`;
- A3's `fieldMove` (moved by SPEC2's 0a): `fieldchange.beforeFieldMove` where `fieldGuard` is called today, and
  `fieldchange.afterFieldMove(kernel, w, slot, move, before)` after the side or field is set; Gravity's start calls
  `hidden.land` for every hidden Pokémon there;
- A3's room-end Update (A3 writes it in wave 1a): A3 calls `fieldchange.itemsAfterField(kernel, w, slot)` for a Booster
  Energy holder (stub: `boosterAfterRoom`); A1's Start table calls `fieldchange.settleHolder(kernel, w, slot)` for Forecast
  and Flower Gift (stub: `abilityStart`); A2's grounding write (Smack Down, Thousand Arrows) calls `hidden.land`. These four
  calls are written by the 1a tracks into their own files; the plan requires them (§8.3) and the hooks source test checks them;
- `presenceGuards` lines: Commander, Dancer, PRESENCE_MOVES, the Pledges → `presence.*`; Sleep Talk's and CALLING_MOVES →
  `calling.*`; Max Guard (808) and the random status (810-816) → `max.*`; Custap with Quick Draw or Mycelium Might (809) →
  `start.custapGuard` (ST); Sky Drop's PENDING_MOVES half → `hidden.skyDrop`.

**Kernel plumbing Step 0a writes** (inert: it reads only fields nothing sets yet; in addition to SPEC2 §3.5's):
- T2P §9.3's `TurnKernel` members: `prioritize` (today's After You `order()` moved out of doubles-status.ts:1822-1831),
  `insertAction`, `externalUse`, `useCalled` (the one calling helper: damagingMove or a new `runCalledStatus` with the given
  move, priority and Prankster flag, no BeforeMove, no PP; C36's helper for CL), `extraStep`; `World.didSomething`,
  `lastSuccessful`, `lastMove` written at runMove's end and at each external or called use (only with their readers);
  `MonState.taken` written in applyStep and the fixed-hit, face and Substitute paths (only with `presence.tracksHits`); the
  readers of `MonState.moved` that mean "has no action left" (flinch, doubles-turn.ts:2397) read `w.remaining`; `rootWorlds`
  takes `start.variants` (one settle today) and `presence.rootActions` (all actions today).
- T2E §3.5's rows (its "Step 0c" is this, C35): `TurnKernel.residualHit` and `inEndOfTurn`; `searchFor`'s `attackerBuild` and
  `attacker: null`; `conditionsFor`'s residual variant; `applyStep`'s `opts.residual`; the Cud Chew counter inside
  `noteItemUse`; the `switchedIn` slot with no action and `moved` true; Payback and Bolt Beak's contexts; Struggle as a legal
  action with its recoil; `turnFacts`' conditional facts; `outcomeOf`'s `cudChew`.
- IN §4.1's rows: `carriedState` for every new carried field (`stall`, `charging`, `destinyBond`, `laserFocus`, `taunt`,
  `encore`, `disable`, `cudChew`, `futureMove`, `onceUsed`, `lockOn`, `uproar`, `bide`, `furyCutter`, `rollout`,
  `defenseCurl`, `ppLeft`, `commanding`); `startWorld` (`safeguard`, `gmax` from `gmaxResidual`, `mudSport`, `waterSport`,
  `MonState.entry`, and C19's `statsRaised`, `statsLowered`, `usedItem` from `earlierThisTurn`); `createContext`'s
  `entryReaders`; `validate` / `carriedIssues` (§3.7); `turnFacts` (§2.5); `outcomeOf` (`turnsLeft`, the new volatiles).
- T2M §2.2's last two rows: `calcBuild`'s `takenMods.hidden` from `eot.hidden` (Fly, Bounce, Dig, Dive, Sky Drop), `critBoost`
  from `vol.chiStrike`, `laserFocus` from `vol.laserFocus`; `contextFor`'s `helpingHands` when `user.helpingHand >= 2`.
- `conditionsFor`: `allyTarget` when the target is the user's ally; the swamp from `SideState.pledge` for the Speed
  conditions; `SideConditions.safeguard` into `SideState.safeguard` (exists, today always false from the input).
- doubles-eot.ts (§3.5's lines only): `sheltered(eot.hidden)` at `:383`.

### 3.6 Step 0b additions (to SPEC2 §3.6)

| File | Change |
|---|---|
| `uses-to-ko.ts` | T2M §2.3–§2.5 (UsesEnv `focusBand`, `betweenHits`, `koRetaliation`, `veil`, `safeguard`, `spreadUser`; TurnStepOutcome `stopAt`, `reactions`, `attackerFaintedInHits`; TurnStepPart `fresh`, `dealt`); T2P §9.4 (`report.lastHit`, `TurnStepOutcome.lastHit`, `UsesEnv.fieldFollowed`). Turn mode only. |
| `hit-loop.ts` (joins 0b) | `HitLoopInput.koRetaliation`, `TurnUnnerve.endsOnKO` (T2M §2.3). |
| `calculate.ts` | T2M §2.3 (`takenMods.hidden` with Sky Drop as Bounce, `critBoost`, `frozenPriority`, `helpingHands`, Q13's three retype paths, `conditions.allyTarget`); T2P §9.4–§9.5 (`settleAbilities` / `settleItems` `reads?: SettleReads`; MoveContext `basePower`, `powerMods`, `retypeTo`, `forceStab`, `switching`; `turnSpeed` reads `SideConditions.swamp`); IN §4.4 (`critRatio`: `laserFocus` → ratio ≥ 5); **the move of `settleDoublesStart` into `doubles-start.ts`** (§3.5), with two stubs 0a calls: `variants` (one settle) and `custapGuard` (the Custap line of presenceGuards, verbatim). |
| `engine-corrections.cjs` | the final-chain `takenMods.hidden` entry (8192 for the listed moves). |
| `model.ts` | `validateConditions`' 2v2-only keys (§3.7). |

**Step 0b's unit tests add** (`tests/unit/status2-plumbing-t2.test.ts`): T2M §2.3's list (T2-SI01, SI03, SI05, O1, O1b,
BE01, AF01, AF03, IO02, UN03, FV01, SE02, Q01, Q03, Q06, Q16, GW01-usum, SP01), T2P's (a `report.lastHit` of a multi-hit move;
`reads` changing one settle; the swamp's ×0.25), IN's (`laserFocus` crit; Lucky Chant still blocks), and Sky Drop's Gust ×2
(CQ08b's 14 → the ×2 row).

### 3.7 Input issues (`validate()` / `carriedIssues()`, as `{Name}: …`; field-level ones in `issues.field`)

IN §3.5's table, T2E §3.1's list, T2M §2.1's and T2P §9.1's issues, with these changes and additions:
- `stockpile`: SPEC2's text replaced by IN's (`Stockpile has 1 to 3 layers.`, `Stockpile changes each stat at most once per layer.`).
- `stall`: `The protecting moves' counter is 1, 3, 9, 27, 81, 243 or 729.`; `allySwitch` likewise with 1 (C23).
- `charging`: IN's (`{Move} is not a two-turn move.`; action issue `It is locked into {Move}.`).
- `taunt` with a status-move action other than Me First (not as a Z-Move): action issue `{Name} is taunted: it cannot use
  {Move}.`; `healBlock` with a heal-flag move action (not as a Z-Move or Max Move): `{Name} is under Heal Block: it cannot use
  {Move}.` (C40).
- `bide`: outside USUM `Bide is not in this game.`; `stored` not a whole number from 0: `Bide's stored damage is a whole
  number.`; action not Bide: action issue `It is locked into Bide.`.
- `uproar`: action not Uproar: action issue `It is locked into Uproar.`.
- `mustRecharge` / `switchedIn` with a move action: T2E's texts; `switchedIn` with `firstTurn: false`: T2E's text.
- `earlierThisTurn.usedItem` without `lastItem` set: `An item used earlier this turn needs the item.`.
- Ally sources (C32): `leechSeed`, `trap.source`, `syrupBomb` may be the ally; the texts become `… is not a Pokémon of the
  turn.` for an empty or own slot.
- `onceUsed` with `battlebond` outside SV (C22): `Battle Bond counts once a battle in Scarlet/Violet only.`
- `entryOrder` (ranks): IN's text. `echoedVoice` outside 0–5: `Echoed Voice's multiplier is 0 to 5.`
- `futureMove.source` equal to the slot is valid (T2E, IN).

---

## 4. Engine algorithm (deltas to SPEC2 §4)

The designs hold each entry's mechanics with citations (T2M §3, T2P §2–§6, T2E §4, IN §4); this section fixes the merged order,
states every change to them, and names each track's part.

### 4.1 One pipeline order (additions to SPEC2 §4.1, in Showdown's order)

0. **Turn start.** The settle with start variants (ST: Trace's copy, Custap with Quick Draw, Download's Speed tie, SPEC2's
   start Starf; each variant a weighted root). `presence.rootActions`: a commanding Tatsugiri and a `switchedIn` Pokémon take no
   action. Carried state into the world (§3.5): a charged two-turn move (`vol.locked`; a hidden one's `eot.hidden` from the
   start), `vol.stall`, `MonState.destinyBond`, the `earlierThisTurn` flags (C19), Taunt / Encore / Disable with their turns.
   `presence.turnStart`: Beak Blast's heat, Shell Trap's set. Generation 7 keeps its frozen priorities (W reads them).
1. **BeforeMove** (SPEC2 §4.1 step 1 plus): 100 Glaive Rush ends (D) → **11 recharge** (N: `vol.mustRecharge` stops the
   action; the sleep counter does not move: TR01) → 10 sleep / freeze → … → 1 paralysis → **−1 Destiny Bond removed unless
   its move is Destiny Bond** (N) → Focus Punch. A stopped action runs MoveAborted: Destiny Bond removed (N), a releasing
   two-turn move stays hidden to the end of the turn (H, T2-SI12b), a Bide removed (PR). **A Sky Drop-lifted Pokémon's
   BeforeMove returns null** (H, CQ08). A releasing or storing Bide's own BeforeMove (PR, C41). A Dancer's copy and an
   instructed move run BeforeMove as their own actions (PR, CL).
2. **TryMove and the move's own Try:** SPEC2's, then Round's pull and Shell Trap's failure (PR), Echoed Voice's pseudo-weather
   (PR), Fake Out and First Impression after the first turn (N's `moveTry`), Spit Up and Fling (SPEC2), the two-turn charge or
   release (the kernel's `vol.locked`; H removes the hidden state at the release's TryMove).
3. **PrepareHit:** the move's own PrepareHit first (`PS/sim/battle-actions.ts:590-592, 826-828`): **the Pledge's wait** (PR),
   **the stall roll of a protecting move or Endure** (N: `history.stallPrepare`; a failed roll deletes the counter and the move
   fails before any Protean change), Destiny Bond failing while it is up (N); then the PrepareHit event: Protean / Libero (A2),
   Snatch at −1 (A3).
4. **The invulnerability step** (step 0 of the hit steps, after redirection; C27): Helping Hand passes; a commanding Tatsugiri is
   missed (PR; No Guard and the Poison-type Toxic do not pass it); the Poison-type Toxic passes (gen 8+); then the hidden kinds
   with their pass lists, No Guard on either side, Lock-On, Sky Drop's pair (H). A miss turns Dragon Darts' smart target off
   (H). Perish Song and Teatime read the same step per Pokémon (`missesField`).
5. **TryHit and the immunities** (SPEC2 §4.1 step 4) for every target that passed step 4. Then the hits; per hit: Focus Band's
   1/10 (W), a face's 0-damage hit and the continuation (S), a Berry between hits stopping the use at `stopAt` (W), the knocking
   hit's Aftermath or Innards Out and the Unnerve-gone Update (K, through hit-loop), the hits into a Substitute and the
   continuation with `fresh` (S).
6. **After the hits:** a spread move's reactions on the user replayed in target order (K, T2M §3.3); Spiky Shield's knockout
   of a spread user (K); Burning Jealousy, Alluring Voice (Step 1), Core Enforcer (K); Flame Burst's splash, Beak Blast's burn,
   Shell Trap's trigger, Order Up (PR); the Counter family's records (`MonState.taken`, kernel); G-Max effects (M); Struggle's
   recoil (kernel). **MoveFail when every target failed: crash damage** (H; CQ04: Protect, the shields after their contact
   effect, an absorbing ability, a type or ability immunity, a miss into a hidden target; not a Substitute hit, not a move
   stopped in BeforeMove, not a move with no target).
7. **AfterMove** (SPEC2 §4.1 step 7, then): Dancer's copies in ascending stored Speed (PR; a tie by `history.entryTie`, newest
   first); `World.didSomething`, `lastSuccessful` (Fusion), `lastMove` (Copycat) written (kernel); Sparkling Aria's cure unless
   `faintedInHits` (W).
8. **End of turn** (SPEC2 §4.1 step 8 plus, by order): **3 the landing** (E2, `kernel.residualHit`) → 5.1 **the G-Max side
   residuals and the sea of fire** (E2, one side-residual handler) → … → 11 Nightmare → 13 traps (a G-Max trap outlives its
   user) → 14 Octolock / Syrup Bomb → **15 Taunt, 16 Encore, 17 Disable count down** (E2) → 19–21 (SPEC2) → 26.x the side
   conditions and **the Pledges' countdowns** (E2) → **27.2 Gravity, 27.6 Magic Room, 27.7 the terrain end** when
   `fieldTurns` is 1 and the effect is the one from before the turn (E2), each through `fieldchange.changed` (FC) → **28.2: one
   Speed-sorted group** of Speed Boost, Harvest, Pickup, **Cud Chew, Moody** (E1, E2; Pickup reads `usedItem`, the
   `earlierThisTurn` flag included: C19) → 28.3 the Orbs → **29: Zen Mode, Shields Down, Schooling** beside SPEC2's copies,
   White Herb and Eject Pack, by Speed (E2) → Uproar's countdown (E2) → the final Update.

### 4.2 Track deltas, wave 1a

- **A1** (SPEC2 §4.2 plus): Stockpile's counts per C17 (the End through applyBoosts, so Simple doubles it: CQ01b);
  `vol.onceUsed` read and written for Q12's once-a-battle Starts (Training passes it); the generated ability table gains the
  `noreceiver` flag (K reads it); the Start table calls `fieldchange.settleHolder` for Forecast and Flower Gift and keeps
  `abilityStart` only for Supreme Overlord once FC lands; `history.entryChanged` at every `setAbility` (N's tie order).
- **A2** (SPEC2 §4.3 plus): Q13's `combo` rows go (the calculate.ts paths are Step 0b's); the grounding write of Smack Down
  and Thousand Arrows calls `hidden.land`; a used Protean or Libero with `types` set is SPEC2's model (N gives `typeUnknown`
  when they are not set).
- **A3** (SPEC2 §4.4 plus): T2M §3.21 (a received Seed in its terrain, Room Service under Trick Room, through A1's
  applyBoosts and D's `noteItemUse`); Teatime calls `hidden.missesField`; `fieldMove` keeps Step 0's two FC calls and calls
  `hidden.land` at Gravity's start; the room-end Update calls `fieldchange.itemsAfterField` for a Booster Energy holder.
- **D** (SPEC2 §4.5 minus the three start items, which go to ST, plus): `fixedHit` gains T2P §3.7's parts (Sturdy at full
  HP, contact retaliation, the type immunity and Wonder Guard before it, Parental Bond's two hits with the first's Update
  between them), which PR's Counter family and Bide call; `tracksItems` is also true with a Cud Chew holder (T2E §4.2.2), a
  Pickup holder whose neighbour has `earlierThisTurn.usedItem` (C19) and, in SwSh, a G-Max Replenish user (M).
- **E1** (SPEC2 §4.6, unchanged): its 28.2 handlers sit in the one group of §4.1 step 8.
- **F** (SPEC2 §4.7, unchanged).
- **H** (T2M §3.1, with C20, C21, C24, C27, C38): the invulnerability step's `misses`, `missesStatus`, `missesField`; the ×2
  exceptions through `takenMods.hidden`; landing by Gravity and Smack Down / Thousand Arrows (the queued release cancelled, step
  fact `{Name} falls to the ground ({Gravity}): {Move} is cancelled.`); the release from last turn (hidden from the turn's
  start; removed at its TryMove; kept to the end of the turn if stopped; E2 ends it at the residual with no HP); Lock-On; **Sky
  Drop's charge turn** (the user and the lifted target both hidden except to each other and the seven pass moves, Gust and
  Twister ×2 at either, the lifted target's action lost, fails into a Substitute, an ally, a fainted target or 200 kg and more;
  E2: both carry `twoturnmove` / `skydrop`); crash is Step 1's (#10), kept by H.
- **S** (T2M §3.13, §3.22, §3.23, §3.25): unchanged from the design.
- **W** (T2M §3.5, §3.14–§3.18, §3.27): unchanged from the design; its `stepEnv` sets `UsesEnv.safeguard` from
  `SideState.safeguard` (set this turn, or from `SideConditions.safeguard`).
- **N** (IN §4.2 without `releasesNow`, plus T2E §4.7.1 and §4.7.3, C23, C34): the stall roll (`stallPrepare`: pass 1/c with
  `vol.stall = min(729, 3c)`, fail 1 − 1/c with the counter deleted and `{Move} fails.`; Quick Guard and Wide Guard raise it
  without a roll; Max Guard through the same point once M lands); the carried Destiny Bond (CQ06); the entry ties (`entryTie`,
  `entryChanged`) for the kernel's redirection, PR's Dancer and ST's Download; `proteanUsed` (`typeUnknown`); the recharge
  (`beforeMoveStart`, priority 11); Fake Out and First Impression with `firstTurn: false` (`moveTry`: `{Move} fails: it is not
  {Name}'s first turn.`).

### 4.3 Track deltas, wave 1b

- **K** (T2M §3.2–§3.12): Core Enforcer first (its own commit, FX-CE cases), then spread-effect, spread-contact-ko, the two
  Unnerve entries, Cotton Down, the veils, Battle Bond (SV `vol.onceUsed`; USUM the Ash form), Aftermath and Innards Out,
  Receiver and Power of Alchemy (`allyFaint`, also from E's faints). The spread reactions list and its source test as T2M §3.3.
- **M** (T2M §3.19, §3.24): G-Max effects, Max Guard (its stall through N's `stallPrepare`), Pain Split into a Dynamaxed
  Pokémon.
- **PR** (T2P §2, §3.1–§3.8, §3.17, §6.1): as designed, with: Dancer's ties through `history.entryTie`; Sky Drop is H's;
  Copycat, Mirror Move, Me First, Instruct, Nature Power and Sleep Talk are CL's; the rows' 2v2 contexts (`basePower`,
  `powerMods`, `switching`) from `presence.context`; **a carried Bide** (C41: the release at its BeforeMove is D's `fixedHit`
  of 2 × (stored + this turn's move damage taken before it, from `MonState.taken`'s sum) at the last Pokémon that damaged it —
  this turn's last hitter if any, else `bide.source`; a Ghost is immune; Protect does not stop it (CQ10c); a source not in
  place: a random adjacent foe (`getRandomTarget`, one world each), none: `Bide fails.`; a storing turn: its BeforeMove's own
  stop, step fact `{Name} stores energy (Bide).`; E2 carries `bide`); **Pursuit with a switched-in foe** (USUM, C30): the
  `combo` reason.
- **CL** (T2P §3.9–§3.15 and T2M §3.26, §3.28 merged): every caller through `kernel.useCalled` (Step 0a); Sleep Talk asleep or
  Comatose, 1/k over its callable moves from `input.moves`, then the called move's random target; Uproar's wake at its hit,
  `vol.uproar`, the sleep block (`{Name} cannot fall asleep: Uproar.`, `Rest fails: Uproar.`), a carried Uproar from the
  turn's start; Helping Hand twice through Instruct (C26). Assist waits for wave 2 (R-E writes it in `doubles-calling.ts`).
- **ST** (T2P §4, SPEC2 D's start items): start variants; Trace's copy (1/k as entered) and its Intimidate; `SettleReads`;
  Download against a foe's entry boost (with `entryOrder` given, the order it gives; otherwise the lead's Start order by Speed
  with T2P §4.3's `assumes all four led together` fact; a Speed tie as two variants); Custap with Quick Draw or Mycelium Might; Imposter at the start (Q8); the start Starf; the start copies
  (pending in `MonState.copy`, applied by D's `afterMoveCopies` at the first action's end).
- **FC** (T2P §5.2–§5.3, plus): `changed` at every weather, terrain or effective-weather change (moves, steps after their last
  hit, faints, ability Starts and Ends, the end of turn's field ends); `sideStarted` (Wind Rider, Wind Power);
  `pseudoWeatherChanged` (Room Service); `itemsAfterField` (Booster Energy at the Update after the field is off, Magic Room's
  end included: `boosterAfterRoom` goes); `settleHolder` (Forecast, Flower Gift gained mid-turn: A1's `abilityStart` narrows).
- **E2** (T2E §4.1–§4.6, plus T2M §6.3's E+, T2P §12's E, IN §4.3): the landing; Cud Chew (C29's default fact); Moody; the
  G-Max side residuals and the sea of fire in one 5.1 handler; Zen Mode, Shields Down, Schooling (Power Construct keeps its
  reason); Taunt / Encore / Disable countdowns; the field ends from `fieldTurns`; Uproar's countdown and Yawn's sleep failing
  under it; a carried release that did not happen ending at the residual; Receiver's copy from a residual faint (K's
  `allyFaint`); the Pledge countdowns; `fieldchange.changed` at the end of turn's field changes.

### 4.4 Randomness (additions to SPEC2 §4.9's table)

| Event | Branches | Bound | Owner |
|---|---|---|---|
| Focus Band | 9/10, 1/10 per knocking hit (and confusion self-hit) | ×2 per knocking hit | W |
| A Starf Berry between hits | one per raisable stat | ≤ 5 continuations | W |
| The stall roll | 1/c, 1 − 1/c | ×2 per protecting action | N |
| Sleep Talk | 1/k over its callable moves, then the called move's targets | ≤ 4 × 2 | CL |
| Copycat, Me First, Nature Power, an Assist-called move | the called move's random target | ≤ 2 | CL |
| Present, Magnitude | 4 / 7 power worlds at their weights | ×7 | PR |
| A Round pulled among tied queued Rounds | 1/k | ≤ 3 | PR |
| A Bide release at an absent source | one per adjacent foe | ≤ 2 | PR |
| G-Max Befuddle, Stun Shock, Replenish | 1/3 per foe, 1/2 per foe, one 1/2 | ≤ 9 | M |
| Trace's start copy, Download's Speed tie at the lead, Custap with Quick Draw, the start Starf | start variants | ≤ 2 × 2 × 2 × 5 per pair | ST |
| Moody | one world per (raised, lowered) pair | ×20 (×42 in USUM) | E2 (E2 always; the calculator's walks only with a 29 reader) |
| Zen Mode, Shields Down, Schooling | the HP line | ×2, E2 only | E2 |
| Training's prelude: tied switch-ins and Mega Evolutions, Trace | 1/k! orders, 1/n | ≤ 8 prelude worlds per cell | Step 1 #15 |

No other input adds randomness, and Dancers add none (C42). The readers rule (§3.3) keeps every new field off the worlds that have no later reader, so a turn
with none of these mechanics keeps today's world count (the Step 0 and integration bench gates measure it).

---

## 5. UI (delta to SPEC2 §5; 2v2 only, 1v1 unchanged, facts only, names never positions, 375 px)

### 5.1 Facts (additions to SPEC2 §5.1)

Every text is a fact with names from `kernel.names` (`nameText`), sides as "your side" / "the opponent's side", no instruction
text. The texts are the designs': T2M §4.2, T2P §2–§5 ("Facts" and the step facts named there), T2E §4 (residual lines and
facts) and IN §6, with these changes and additions:
- **Steps:** `DoublesStep.copied` renders as the Pokémon's second step in turn order, headed by the copy's own step fact
  (`Dancer: {Name} copies {Move}.`, `Instruct: {Name} uses {Move} again.`).
- **Conditions on the card** (each only while it holds): `Out of reach ({Fly}).` (H; `({Sky Drop})` for both of Sky Drop's
  pair), `Lifted by {User} (Sky Drop).`, `Inside {Dondozo} (Commander).`, `Uproar: {n} more turns.`, `Laser Focus.`,
  `Destiny Bond.`, `Taunt: {n} more turns.`, `Encore ({Move}): {n} more turns.`, `Disable ({Move}): {n} more turns.`,
  `Bide: {n} HP stored.`, `Beak Blast heating.`, `Shell Trap set.`, `G-Max Chi Strike +{n}.`.
- **Residual lines** (`residualLine` effects): `Future Sight`, `Doom Desire` (the source as `other` when it is in the turn),
  `Cud Chew`, `Moody`, `G-Max Vine Lash` and its kin, `Sea of fire`, `Zen Mode`, `Shields Down`, `Schooling`, `Life Orb` on a
  landing's active source, and the ends with no HP: `Taunt ends · {Name}`, `Encore ends · {Name}`, `Disable ends · {Name}`,
  `Uproar ends · {Name}`, `Gravity ends.`, `Magic Room ends.`, `{Terrain} Terrain ends.`.
- **Losses** (`DoublesHP.losses`): `{Name} loses {n} HP ({High Jump Kick}).`, `{Name} loses {n} HP (Aftermath).`, `{Name}
  loses {n}–{m} HP (Innards Out).`, `{Name} loses {n} HP (Flame Burst).`, `{Name} loses {n} HP (Disguise).`, `{Name} loses {n}
  HP (Struggle).`.
- **Start rows:** one row per start variant when the variants disagree, with `If {Name}'s Trace copied {Ability}.` or `If
  {First} came in first.`.

### 5.2 Controls (replaces SPEC2 §5.2; NU owns them, in `EarlierTurnFields.tsx` and `doubles-inputs.ts`)

**The rule** (IN §0.1): a control is shown when this turn can read it **or while it is set**; its value is always passed when
set; ambient states default to None with no fact; a history the turn's own move reads defaults to None with its `Assumes …` fact
(§2.5); Unknown, keeping its narrow reason, only where None would usually be wrong (Q3, Q4: Last move, Item used earlier; the
entry order; the battle's last move; Retaliate's faint; Echoed Voice's streak; the rows' counts; a used Protean's type). A
fainted Pokémon shows none. With nothing set, a Pokémon whose turn reads nothing new shows exactly today's controls.

**Layout** (IN §5.1): Field conditions keeps its order (Weather and terrain, Critical hit, Shared field effects, the two side
fieldsets, the note); each side fieldset holds its side toggles, then one group per Pokémon (`data-doubles-carried`, its name
as the heading): checkboxes in the two-column grid, then selects in the compact fields grid.

**Per Pokémon, checkboxes** (data attribute `={slot}`):

| Label | Data attribute | Games | Shown when | Writes |
|---|---|---|---|---|
| `{Move} charged last turn` | `data-doubles-charged-last` | all | its action is a two-turn move (not as a Z-Move or Max Move; not Sky Drop) | `carried.charging` |
| `Destiny Bond from last turn` | `data-doubles-destiny-bond` | all | it learns Destiny Bond | `carried.destinyBond` |
| `Minimized` | `data-doubles-minimized` | all | it learns Minimize | `carried.minimize` |
| `Glaive Rush last turn` | `data-doubles-glaive-rush` | sv, ch | it learns Glaive Rush | `carried.glaiveRush` |
| `Laser Focus last turn` | `data-doubles-laser-focus` | swsh, usum | it learns Laser Focus and its action is damaging | `carried.laserFocus` |
| `Recharging` | `data-doubles-recharge` | all | its action is No move and it learns a recharge move | `carried.mustRecharge` |
| `Not its first turn` | `data-doubles-not-first-turn` | all | its action is Fake Out or First Impression | `firstTurn: false` |
| `Stats rose earlier this turn` | `data-doubles-raised-earlier` | sv ch swsh (Burning Jealousy), sv ch (Alluring Voice) | a Burning Jealousy or Alluring Voice of the turn can reach it | `earlierThisTurn.statsRaised` (C19) |
| `Used an item earlier this turn` | `data-doubles-item-earlier` | all | a Pickup holder holding nothing is in the turn, it holds nothing and its `Item used earlier` is set | `earlierThisTurn.usedItem` (C19) |
| `Tar Shot` | `data-doubles-tar-shot` | sv, swsh | a Pokémon of the turn learns Tar Shot | `carried.tarShot` |
| `Foresight`, `Miracle Eye`, `Nightmare` | `data-doubles-foresight`, `-miracle-eye`, `-nightmare` | usum | IN §5.2's rules | `carried.foresight`, `miracleEye`, `nightmare` |
| `Heal Block` | `data-doubles-heal-block` | sv, ch | a foe of the turn learns Psychic Noise | `carried.healBlock = 1` |
| `Berry locked` | `data-doubles-berry-locked` | all | Berserk or Anger Shell holding Sitrus, Oran or a Figy-family Berry | `carried.berryLocked` |
| `Power Trick` (Champions: `Power Shift`) | `data-doubles-power-trick` | all | it learns the move | `carried.powerTrick` / `powerShift` |
| `No Retreat` | `data-doubles-no-retreat` | sv ch swsh | its action is No Retreat | `carried.noRetreat` |
| `Battle Bond used` | `data-doubles-battle-bond` | **sv** (C22) | its ability is Battle Bond | `carried.onceUsed` gains `battlebond` |
| `Defense Curl` | `data-doubles-defense-curl` | all | its action is Rollout or Ice Ball | `carried.defenseCurl` |
| `Bide releases this turn` | `data-doubles-bide-release` | usum | its action is Bide and `Bide stored` is set | `carried.bide.release` |
| `Drowsy`, `Salt Cure`, `Aqua Ring`, `Ingrain`, `Cursed` | `data-doubles-drowsy`, `-salt-cure`, `-aqua-ring`, `-ingrain`, `-curse` | IN §5.2 | IN §5.2's rules | the status-eot carried fields |

**Per Pokémon, selects** (compact; the default first unless marked):

| Label | Data attribute | Games | Shown when | Options | Writes |
|---|---|---|---|---|---|
| `Stockpile` | `data-doubles-stockpile` | all | its action is Stockpile, Swallow or Spit Up; or (USUM) Snatch with one of those in the turn | 0–3 | `carried.stockpile.layers` (no counts, C17) |
| `Type`, `Second type`, `Added type` | `data-doubles-type`, `-type2`, `-added-type` | all | IN §5.2's rules | IN §5.2's | the turn input's build copy only (IN-C6) |
| `Infatuated by` | `data-doubles-attract` | all | IN §5.2 | None, each such Pokémon | `carried.attract` |
| `Heal Block turns left`, `Embargo turns left`, `Telekinesis turns left` | `data-doubles-heal-block-turns`, `-embargo`, `-telekinesis` | usum | IN §5.2 | None, 1–4 / 1–4 / 1–2 | `carried.healBlock`, `embargo`, `telekinesis` |
| `Octolock by` | `data-doubles-octolock` | ch, swsh | IN §5.2 | None, each such foe | `carried.octolock` |
| `Accuracy stage`, `Evasion stage` | `data-doubles-accuracy`, `-evasion` | all | IN §5.2 | −6..+6 (0) | `carried.stages` |
| `Locked on to` | `data-doubles-lock-on` | all | it learns Lock-On or Mind Reader | None, each foe | `carried.lockOn` |
| `Last move` | `data-doubles-last-move` | all | Disable, Encore, Instruct or Mirror Move in the turn can reach it; its own action is Conversion 2 | **Unknown**, None since it came in, its quick moves, its action's move | `lastMove` |
| `Last move's target` | `data-doubles-last-target` | all | an Instruct in the turn can reach it and its `Last move` is a single-target move | **Unknown**, each Pokémon of the turn | `lastMoveTarget` |
| `Item used earlier` | `data-doubles-last-item` | all | it holds no item, and its action is Recycle, its ability Harvest, a Pickup holder or a G-Max Replenish user is in the turn | **Unknown**, None, the game's items (Berries first) | `lastItem` |
| `Berry eaten last turn` | `data-doubles-cud-chew` | sv, ch | its ability is Cud Chew | None (fact without a Berry held, C29), the Berries | `carried.cudChew` |
| `Protecting moves in a row` | `data-doubles-stall` | all | its action is a protecting move, Endure, or Max Guard (a Dynamaxed status move) | — (absent: the fact), 0–6 (0 → 1, n → 3^n capped at 729) | `carried.stall` (C23) |
| `Ally Switch in a row` | `data-doubles-ally-switch` | sv, ch | its action is Ally Switch | — , 0–6 (as above) | `carried.allySwitch` |
| `Uproar turns left` | `data-doubles-uproar` | all | its action is Uproar | — (absent: the fact), 1, 2 | `carried.uproar` |
| `Fury Cutter uses in a row` | `data-doubles-fury-cutter` | sv swsh usum | its action is Fury Cutter | **Unknown**, 0–4 | `carried.furyCutter` |
| `Rollout hits so far` | `data-doubles-rollout` | sv swsh usum (Ice Ball usum) | its action is Rollout or Ice Ball | **Unknown**, 0–4 | `carried.rollout` |
| `PP left` | `data-doubles-pp-left` | usum | its action is Trump Card | **Unknown**, 1–8 | `carried.ppLeft[move]` |
| `Bide stored` | `data-doubles-bide-stored` | usum | its action is Bide | — (absent: a first use, the fact), a number from 0 | `carried.bide.stored` |
| `Bide from` | `data-doubles-bide-from` | usum | `Bide stored` is set | each Pokémon of the turn, None | `carried.bide.source` |
| `Lands this turn` | `data-doubles-future-move` | all | a Pokémon of the turn other than it (under R, a bench Pokémon too) learns Future Sight or Doom Desire | None, `Future Sight from {Name}`, `Doom Desire from {Name}` per learner | `carried.futureMove` (the object form) |
| `Leech Seed`, `Perish count`, `Trapped by`, `Syrup Bomb from`, `Wish lands` | IN §5.2's | IN §5.2's | IN §5.2's (an ally may be the source: C32) | IN §5.2's | the status-eot carried fields |

**Field and sides:**

| Label | Data attribute | Shown when | Options | Writes |
|---|---|---|---|---|
| `Weather ends this turn` | `data-doubles-weather-ends` | a weather other than the strong three | checkbox | `weatherTurns = 1` |
| `Terrain ends this turn` | `data-doubles-terrain-ends` | a terrain | checkbox | `fieldTurns.terrain = 1` |
| `Gravity ends this turn`, `Magic Room ends this turn` | `data-doubles-gravity-ends`, `-magic-room-ends` | the effect on | checkbox | `fieldTurns.gravity` / `magicRoom` = 1 |
| `Mud Sport`, `Water Sport` | `data-doubles-mud-sport`, `-water-sport` | USUM | checkbox | `field.mudSport` / `waterSport` |
| `Entered first` | `data-doubles-entered-first` | two Pokémon that can tie for one move's redirection, two Dancers, or a Download holder facing a foe with an entry boost | **Unknown**, each candidate by name | `entryOrder` (the chosen rank 0, the other candidates rank 1) |
| `Last move in the battle` | `data-doubles-battle-last-move` | a Copycat user in the turn | **Unknown**, None, the four Pokémon's quick moves | `battleLastMove` |
| `Echoed Voice turns in a row` | `data-doubles-echoed-voice` | an Echoed Voice user in the turn | **Unknown**, 0, 1, 2, 3, 4, 5 or more | `echoedVoice` = min(n, 5) (C25) |
| `Safeguard`, `Mist` (sv swsh usum), `Lucky Chant` (usum) | `data-doubles-side-safeguard`, `-side-mist`, `-side-lucky-chant` `={side}` | the game has the move | checkbox | the side's conditions |
| `G-Max Vine Lash`, `G-Max Wildfire`, `G-Max Cannonade`, `G-Max Volcalith` | `data-doubles-side-gmax={side}` (value the move id) | SwSh | checkbox each | `SideConditions.gmaxResidual` (C28) |
| `Lost a Pokémon last turn` | `data-doubles-fainted-last={side}` | a Retaliate user on that side | **Unknown**, Yes, No | `faintedLastTurn[side]` |
| `No Pokémon left to switch in` | `data-doubles-no-bench={side}` | always (wave 1; R's Bench replaces it) | checkbox | `canSwitch[side] = false` |
| `Switched in` (an action, after `No move` in the move select) | `data-doubles-switched-in={slot}` | always | — | `switchedIn: true`, action No move |

**Labels, names, accessibility, 375 px** (IN §5.3): every per-Pokémon label carries the sr-only `: {Name}`, every side control
`: your side` / `: the opponent's side`; no label or option says left, right, slot or position; options name Pokémon by
`names[slot]`. The UI test renders the busiest group (a Swalot with every control it can show, set) at 375 px and asserts
`scrollWidth <= clientWidth`.

**State and reset rules** (IN §5.4), plus: an action change drops `charging`, `stall`, `allySwitch`, `uproar`, `bide`,
`furyCutter`, `rollout`, `ppLeft`, `firstTurn` and `mustRecharge` unless the new action reads them; `Switched in` clears the
Pokémon's action-bound controls; a game change drops every control the new game does not have.

**Summary toggles** (IN §5.5), plus: `Recharging`, `Not its first turn`, `Stats rose earlier this turn`, `Used an item earlier
this turn`, `Locked on to`, `Bide stored`, the G-Max boxes and `Switched in` count when set; `Fury Cutter uses in a row`,
`Rollout hits so far`, `PP left`, `Uproar turns left` are history answers and do not.

**The 2v2 note** (`unmodelledDoublesStates`, IN §5.6), with C28 and C21: it drops the G-Max side conditions (now inputs) and
lists `A Sky Drop from an earlier turn`, `A Healing Wish or Lunar Dance waiting for the next Pokémon to come in`, `An ability
suppressed by Gastro Acid or replaced by {…}` (IN's line), `Torment or Throat Chop from an earlier turn`, `A move locked
in by Outrage, Petal Dance, Thrash or Raging Fury`.

**Apply actions** (U, `doubles-prep.ts` beside Intimidate's, T2P §8): `Commander` (Dondozo +2 to all five through boost()'s
rules) and Intimidate for a Trace holder that copied it (sets `copiedIntimidateStored`).

### 5.3 Wave 2 (R-U)

IN §5.7 as written (Bench, Replacement, Hazards with G-Max Steelsurge, their validation and names); the Bench replaces wave 1's
`No Pokémon left to switch in`; `Lands this turn` lists bench learners.

---

## 6. Training (delta to SPEC2 §6; Champions; public information only)

T1 (wave 1a) is SPEC2 §6 as written. T2 (wave 1b) adds every Tier 2 and input mapping below; Step 1 does four Training fixes
first (#11, #14–#16, §8.2). Every source is a public line, the tracker's counts, or the belief battle's replay of public lines; the
`leak:training` diff covers every new input field.

| Input | Public source | Bridge (`sim/bridge.ts`) | Rollout text that goes |
|---|---|---|---|
| `switchedIn` (Step 1 #14) | the switch actions the prelude ran (`switched`, `bridge.ts:304`) | `switchedIn: true`, action No move | `Payback into a Pokémon that switched in.`, `Analytic with a switch this turn.`, FIRST_IN_A_SWITCHED_SLOT |
| `earlierThisTurn` (Step 1 #11) | the prelude world's `statsRaisedThisTurn`, `statsLoweredThisTurn`, `usedItemThisTurn` after the switches; on the battle's first turn the leads' entry lines before `\|turn\|1` (a non-zero `-boost` / `-unboost`, an `-enditem` of a use or an eat: not Knock Off, a theft or `[from] stealeat`) | the three flags per Pokémon | — (silent today: Lash Out after a switch-in Intimidate, CQ03e) |
| prelude worlds (Step 1 #15) | the prelude's own speed-tie shuffles and `sample`s (T2E §4.8.2) | `runPreludeWorlds`: ≤ 8 weighted prelude worlds per cell | `Speed tie between switches with an entry effect.` (above the bound only), `Trace enters against two different abilities.` |
| `cudChew` | Step 1 #16: the tracker's `PublicMon.cudChew` (the last Berry eaten this stint, from `-enditem … [eat]`, not stolen; cleared by its re-eat and a switch-out) → `cudChew: true` (the end of turn not estimated: a rollout); T2: the Berry id | `carried.cudChew` | (none silent any more) |
| `stall` | tracker `protectStreak` (Wide and Quick Guard count) | `min(729, 3^streak)`, 1 for none, with a protecting action or Endure | splits.ts's Protect fork and `{Move} under Gravity while confused: its failing world is not modelled.` (`splitWorlds` stays the identity) |
| `mustRecharge` | the `mustrecharge` volatile (`cant … recharge` next turn) | `carried.mustRecharge`, action No move | `{Name}: recharging while confused is not modelled.` |
| Struggle | the request's Struggle | the action `struggle` | `{Name}: struggle is not modelled.` |
| `firstTurn` | the tracker's action count since it came in | `firstTurn: activeMoveActions === 0` with the real Fake Out or First Impression | `{Name}: {move} after its first turn while confused is not modelled.`, the FIRST_TURN_ONLY note |
| `charging`, `lockOn` | tracker `charging` (`-prepare`), `-activate … move: Lock-On\|[of]` | `carried.charging` (`twoturnmove` and the move's volatile mapped), `carried.lockOn` | `{Name}: twoturnmove / fly / dig / dive / bounce / phantomforce / shadowforce / lockon is not modelled.` |
| `destinyBond` | the belief battle's `destinybond` volatile | `carried.destinyBond` | `{Name}: destinybond is not modelled.` |
| `taunt`, `encore`, `disable` | the volatiles' `since`, `targetMovedFirst`, the moves used (IN §7) | turns left by each condition's duration rule | their `{id} is not modelled.` rollouts (they leave IGNORED_VOLATILES for MAPPED_VOLATILES) |
| `onceUsed` | the belief battle's `bondTriggered`, `swordBoost`, `shieldBoost`, `syrupTriggered` | `carried.onceUsed` | — |
| `uproar` | `-start … Uproar` and its turns | `carried.uproar` | `{Name}: uproar is not modelled.` |
| `futureMove` | the slot condition the belief battle rebuilt (`belief-battle.ts:261-270`) | `{ move, source }` for an active source, else `{ move, build: liveBuild(source) }` | `{Move} landing is not modelled in 2v2.` leaves the census |
| `fieldTurns` | `fieldClock` (`bridge.ts:109-130`) | terrain, Gravity, Magic Room turns | `Magic Room ending this turn is not modelled.` |
| `safeguard`, `mist`, `luckyChant` | `-sidestart` | `SideConditions` (MAPPED_SIDE) | `Side effect safeguard / mist / luckychant is not modelled.` |
| `entryOrder` | the belief battle's `abilityState.effectOrder` | ranks of the four actives | — |
| `battleLastMove`, `faintedLastTurn`, `lastMoveTarget` | `PublicState.lastMove`, `PublicSide.faintedLastTurn`, the tracker's last move line's target | the turn input | `{Name}: copycat / instruct is not modelled.` (CL) |
| `moves` | the AI's move slots; the player's as today's `bridge.ts:345` passes them (the leak gate covers it) | `moves` | `{Name}: sleeptalk is not modelled.` |
| ally sources (C32) | the seeder, trapper and Syrup Bomb `[of]` lines | the ally's slot | `{Name}: Leech Seed / a trap / Syrup Bomb from an ally is not modelled.` |
| Q2's and SPEC2's | SPEC2 §6, IN §7 | as there | as there |

**Kept rollouts** (exact fallbacks with fact texts): `{Name} has an Illusion.` (a hidden identity), `{Name}: its Substitute's HP
after a hit is not public.` (hidden information), `{Name}: {move} is not in its catalog moves.`, `{Name} must recharge.` (a
request offering only Recharge), `{Name}: {what} needs the public counts.`, `{Name}: a G-Max trap is not modelled.` (no Dynamax in
Champions), `Weather {id} …`, `Field effect {id} …`, `Side effect {id} …` (an id the bridge does not know), `Prelude failed:
{message}`, `The battle ended before the moves.`, and, until wave 2, `A replacement is needed before the moves.`

**`ai/evaluate.ts`:** `postFromOutcome` reads the new outcome fields (`charging`, `onceUsed`, `cudChew`, `turnsLeft`' new keys,
`sides.pledge`); `nextClock` reads `fieldTurns` (the field ends) as T2E §4.6.2 says. **`ai/value.ts`:** no new weights (Q7).
**Gates:** SPEC2 §6's, run at Step 1 (the four fixes' commits), integration 1a and 1b, and wave 2, each against main on the same
seeds; the HabitBot gate is reported beside main's. Expected movement: fewer rollouts, and corrected values for switch-in
sleepers (T2E finding 1), Mega and switch ties (finding 2), Cud Chew turns (finding 3) and Lash Out after a switch-in
Intimidate or on the battle's first turn (C19).

**Wave 2 (R-T):** SPEC2 §6's R part, plus the prelude's replacement (T2E §4.8, `A replacement is needed before the moves.`
goes), a benched landing source from the real bench, and Assist's party (CL's Assist through R-E).

---

## 7. Oracle (delta to SPEC2 §7; `scripts/.cache/calc-audit/2v2/verify`)

### 7.1 Harness (V1 in wave 1a, V2 in wave 1b; the Step 1 builder adds what its own cases need first)

SPEC2 §7.1, plus the harness parts of T2M §5, T2P §12 (V), T2E §7 and IN §8, plus:
- **C19, the turn's semantics:** `prepare()` (sim-dfs.ts 140-265) clears `statsRaisedThisTurn`, `statsLoweredThisTurn`,
  `usedItemThisTurn` and `hurtThisTurn` on every active Pokémon after the case's setup and before turn 1's choices, unless the
  case's `CaseMon.earlierThisTurn` sets them (then they are set true). The oracle's turn is then "a turn after these Pokémon came
  in", as the app's is. A switch-in case (`CaseAction.switchIn`, T2E §4.7.5) keeps the flags its own switch's entry effects set,
  and `app-turn.ts` maps them into `earlierThisTurn` from the simulator's state after the switch actions. A stored case with a
  reader of these flags after an entry event either was not estimated (its reason goes in this build, so it is on the changed
  list and is re-run with the clear) or would not agree today; `changed-cases.ts` asserts there is none of the second kind.
- **Bide** (C41): `addVolatile('bide')` with `duration`, `totalDamage` and `lastDamageSource` (CQ10's setup).
- **Ally sources** (C32): `leechseed` with an ally source slot, `partiallytrapped` from an ally, `syrupbomb` from an ally.
- **`entryOrder`:** IN §8's re-made ability states in rank order (the leads' default p1a, p1b, p2a, p2b otherwise).
- **`compare.ts`:** E2 also compares `charging`, `onceUsed`, `chiStrike`, `cudChew`, `turnsLeft` (`taunt`, `encore`,
  `disable`, `uproar`), `sides.pledge`, `bide`, the hidden move id and `skydrop` among the volatiles; `CHANCE_EFFECTS` already has
  `focusband` and `stall`.
- **`status2/build/changed-cases.ts`** lists the union of SPEC2 §7.1's, T2M §5's, T2E §7's and IN §9's stored cases, plus: the
  stored redirect-tie cases (their text becomes `needsEntryOrder`), every stored case with a crash move into a protected, immune,
  absorbed or missed target (found by searching the inputs; their numbers change by Step 1 #10), and any stored case whose Showdown
  turn had an entry event and a reader of C19's flags (expected none: asserted).

### 7.2 Cases

Every case runs the three walks and is exhaustive unless marked; each move SV has runs in SV and one other game where it exists,
each USUM-only (or SwSh-only) move in two cases of its games. **Each case lists the tracks it needs and gates at the first
integration after all of them have merged** (Step 1's fix cases at Step 1).

| File | Prefixes | About | Source | Gates |
|---|---|---|---|---|
| `cases-sat.ts`, `cases-f2.ts`, `cases-fs.ts`, `cases-g4.ts`, `cases-cr.ts` | SPEC2's | 300 (+11 SWX in wave 2) | SPEC2 §7.2 | Step 1, 1a, 2 |
| `cases-t2m.ts` | `T2M-`, T2M's `T2E-SI-01` and `T2E-UP-01`, `FX-` | 120 | T2M §5, renamed below | Step 1 (FX-CR, FX-BJ, FX-ST, T2M-VS-01/03/04), 1a (H, S, W), 1b (K, M, CL) |
| `cases-t2p.ts` | `T2P-` | 110 | T2P §2–§6 | 1b (Step 1 for T2P-UNB) |
| `cases-t2e.ts` | `T2E-`, `IN-RC`, `IN-SU`, `IN-FO`, `IN-SW` | 90 | T2E §4, renamed below | Step 1 (IN-SW), 1a (IN-RC, IN-FO, IN-SU), 1b (E2) |
| `cases-in.ts` | `IN-` | 70 (65 wave 1, 5 wave 2) | IN §8, merged below | 1a, 1b, 2 |
| `cases-cq.ts` | `CQ-` | 34 (18 ids) | this addendum | Step 1, 1a, 1b |

All wired into `cases-se.ts` as `cases-review.ts` is. SPEC2 §7.2's note that F4 §6's Tier 2 cases are not built stands: the
Tier 2 designs' cases above replace them (G4-GLV stays SPEC2's). Total: the 1264 stored cases plus about **720 new ones in wave 1** and about
**25 in wave 2** (SPEC2's SWX, IN-BNC, IN-HZD, IN-FSL-02, T2P's Assist cases, T2E's bench landings).

**Renames and merges** (one id per scenario across the files):

| Design id | Becomes | Why |
|---|---|---|
| T2M IN-CR-01…06 | FX-CR-01…06 | Step 1 #10's fix cases; frees the IN- prefix for inputs |
| T2M IN-BJ-01, 02 | FX-BJ-01, 02 | Step 1 #12 |
| T2M IN-ST-01 | FX-ST-01 | Step 1 #13; T2E's stall cases were IN-ST01/02 |
| T2M IN-CE-01 | FX-CE-01 | K's first commit |
| T2E IN-FT01–03 | dropped | IN-FLD-01…03 are the same scenarios (Magic Room, Misty Terrain, Gravity ending) |
| T2E IN-ST01, IN-ST02 | IN-STL-03 (exists), IN-STL-05-sv / -champions (stall 9 Detect; stall 1, no fact) | IN-STL is the stall family |
| T2E IN-SG01 | IN-SFG-02-champions / -sv (Will-O-Wisp and Spore into the side) | IN-SFG is the Safeguard family; T2M-SG-02 is IN-SFG-01 and is dropped |
| IN-BBD-01-champions | IN-BBD-02-sv (Battle Bond used; its ally's knockout gives nothing) | C22: no Battle Bond in Champions |

**The critic's cases** (`cases-cq.ts`, from §1.1's probes; ids name the probe):

| Id | Games | Case | Gates |
|---|---|---|---|
| CQ-STK-01 | sv, swsh | Contrary Shuckle's Stockpile ×2 then Swallow (CQ01a); swsh: Simple Swalot at Def +5, Stockpile then Spit Up (CQ01b) | 1a (A1) |
| CQ-ECV-01 | sv, swsh | `echoedVoice: 1`, two Echoed Voices this turn, both ×2 (CQ02's turn 2) | 1b (PR) |
| CQ-ETT-01 | sv, champions | `earlierThisTurn.statsRaised` on Defiant Kingambit; Burning Jealousy burns it (CQ03a) | Step 1 #12 |
| CQ-ETT-02 | sv, champions | `earlierThisTurn.statsLowered`; Lash Out at 2× (CQ03e) | Step 1 #11 |
| CQ-ETT-03 | sv, swsh | `earlierThisTurn.usedItem` and `lastItem` Electric Seed; a foe's itemless Pickup takes it (CQ03c) | 1a (E1) |
| CQ-ETT-04 | sv, champions | a switch-in case: Incineroar's Intimidate on entry, then Lash Out and Burning Jealousy (CQ03e as a case) | Step 1 #14 |
| CQ-CRS-01 | sv ×2 | Supercell Slam into Volt Absorb (CQ04d); High Jump Kick under Gravity: no crash (CQ04c) | Step 1 #10 |
| CQ-CRS-02 | sv, usum | High Jump Kick into Spiky Shield: 1/8, then the crash (CQ04b) | Step 1 #10 |
| CQ-STL-01 | sv, champions | Quick Guard last turn (`stall: 3`), Protect now (CQ05a) | 1a (N) |
| CQ-DBD-01 | sv, usum | a carried Destiny Bond on an asleep holder: a faster and a slower knockout (CQ06a, b) | 1a (N) |
| CQ-SKD-01, 02 | usum ×2 | Sky Drop lifts Clefairy: the lifted action is lost, Tackle misses, Gust ×2 (CQ08, CQ08b) | 1a (H) |
| CQ-ENT-01 | sv, champions | two equal-Speed Lightning Rods across the sides, `entryOrder` both ways (CQ09) | 1a (N) |
| CQ-BID-01…04 | usum ×4 | a Bide release: 50 stored; into a Ghost; into Protect; a faster Quick Attack first (CQ10a–d) | 1b (PR) |
| CQ-ALY-01 | sv, champions | Leech Seed, Fire Spin and (sv) Syrup Bomb from an ally (C32) | 1a (E1) |
| CQ-PUR-01, 02 | usum ×2 | Pursuit into a switched-in foe (the reason); Pursuit with no switch (40 power) | 1b (PR) |
| CQ-CMD-01 | sv ×2 | Commander against a No Guard attacker (still missed, C27); against Helping Hand (reached, fails) | 1b (PR) |

### 7.3 The census sample

SPEC2 §8.4 step 4's re-run (census-sim.ts: 8000 Champions and 2000 SV turns) and T2E's budget measurement
(tier2-eot-training-probes-3.ts, which copies whatever `app/lib/battle` holds) run at integrations 1a and 1b and 2, reporting the
not-estimated share by reason against census-guards' table and the budget table of T2E §4.9.1. Acceptance in §10.

---

## 8. Build plan (replaces SPEC2 §8; disjoint ownership)

### 8.1 Step 0: contract, hook modules, inert plumbing (behaviour unchanged)

Three builders with disjoint files. 0b starts once 0a's type files are written; 0c needs nothing from either.

| Part | Owns | Does | Commits (each gated) |
|---|---|---|---|
| 0a (builder X) | `doubles-types.ts`, `types.ts`, `doubles-world.ts`, `doubles-turn.ts`, `doubles-status.ts`, `doubles-eot.ts` (§3.5's lines only), `doubles-items.ts` (the Symbiosis hook line), `doubles-actions.ts`, every new hook module of SPEC2 §3.5 but `doubles-start.ts` and every module of §3.5 here, `status2/build/gen-status-table.ts`, the regenerated `status-table.ts` (kinds unchanged), `tests/source/doubles-status-moves.test.ts`, `tests/source/status2-hooks.test.ts` | SPEC2 §3.1–§3.5; §3.1, §3.3, §3.5, §3.7 here | 0a.1 SPEC2's contract and modules; 0a.2 H, K, W, S, M modules and hooks; 0a.3 PR, CL, FC modules with the queue, calling and memory kernel; 0a.4 N's module, T2E's and IN's kernel plumbing, C19's startWorld flags, C32's validation |
| 0b (builder Y) | `calculate.ts`, `engine-corrections.cjs`, `model.ts`, `uses-to-ko.ts`, `hit-loop.ts`, `mechanics.ts`, `doubles-targets.ts`, `intimidate.ts`, `doubles-start.ts` (the settle moved), `tests/unit/status2-plumbing.test.ts`, `tests/unit/status2-plumbing-t2.test.ts` | SPEC2 §3.6; §3.6 here | 0b.1 SPEC2's; 0b.2 T2M's; 0b.3 T2P's, IN's and the settle's move |
| 0c (builder Z) | `app/(app)/calculator/doubles-inputs.ts` (new), `app/(app)/calculator/EarlierTurnFields.tsx` (new), the moved lines and three call sites in `doubles-prep.ts` and `BattleConditions.tsx` | IN §10's UI move, verbatim, with the inert `history` and `turnEarlier` state | one |

**Order inside Step 0:** 0b starts after 0a.1's type files; 0a.3's calls into `doubles-start.ts` (`start.variants`,
`start.custapGuard`) land after 0b.3 has moved the settle there; 0c runs from the start.

**Gate:** SPEC2 §8.1's (`npm run check`; `golden-1v1 --check` byte-equal; `regress.mjs` and `app-diff.mjs` over all 1264 stored
cases, 0 differences, facts included; the 2v2 bench within 5 % of main); every Step 0b unit test (SPEC2's, §3.6's); T2E's
synthetic-input tests of the kernel plumbing (FS02, FS03b, FS07c, TR01, TR03, TR06a, TR09, TR10a); the hooks source test over
every row of §3.5; the UI tests and `calculator-doubles-carried-input.test.ts` unchanged after 0c.

### 8.2 Step 1: the correctness fixes (the Step 0 builders; one commit each, in this order, its cases stored)

| # | Fix | Where | Cases / tests |
|---|---|---|---|
| 1–8 | SPEC2 §8.2's eight | as there | as there |
| 9 | Unburden at the turn's first Update throws (T2P §5.1) | `doubles-status.ts:174` (`abilityActive: true`) | T2P-UNB-01-sv, -02-usum, -03-champions |
| 10 | Crash damage (T2M IN-CRASH; C24) | `doubles-hidden.ts crash` (H takes the file over); generated `CRASH_MOVES` | FX-CR-01…06, CQ-CRS-01, 02 |
| 11 | The earlier-this-turn flags (C19): Training passes them; the oracle's turn clears them | `sim/bridge.ts`; verify's `prepare()` and `app-turn.ts` | CQ-ETT-02, Training unit tests (a switch-in Intimidate and Lash Out; the leads' lines on turn 1) |
| 12 | Burning Jealousy and Alluring Voice (T2M IN-BJ: T2M §3.2's first two bullets, the whole model) | `doubles-reactions.ts volatileSecondary` (K takes the file over) | FX-BJ-01, 02, T2M-VS-01, T2M-VS-03, CQ-ETT-01 |
| 13 | Spectral Thief (T2M IN-ST: §3.2's third bullet) | `doubles-reactions.ts beforeStep` (A1's applyBoosts and writeStages, written in full in Step 0a) | FX-ST-01, T2M-VS-04 |
| 14 | Training: a Pokémon that switched in takes no action (T2E finding 1) | `sim/bridge.ts` (`switchedIn`) | IN-SW01…03 (champions, sv), IN-SW04 (swsh), CQ-ETT-04, Training unit tests |
| 15 | Training: the prelude's ties and Trace enumerated (finding 2) | `sim/prelude.ts`, `sim/services.ts` (`runPreludeWorlds`) | Training unit tests (TR04's and TR05's positions; the bound) |
| 16 | Training: Cud Chew carried (finding 3) | `sim/tracker.ts` (`PublicMon.cudChew`), `sim/bridge.ts` (`cudChew: true`: a rollout until E2 and T2) | Training unit tests |

**Gate:** Step 0's, except that the cases each fix changes are listed and match the oracle, and the Training gates for #11 and
#14–#16 against main on the same seeds. The Step 1 builders add the harness support their own cases need (case-types fields,
`prepare()`, `app-turn.ts`); V1 takes those files over.

**Frozen after Step 1** (only the integrator edits them, for agreed one-line changes, reviewed): `doubles-turn.ts`,
`doubles-status.ts`, `doubles-world.ts`, `doubles-types.ts`, `types.ts`, `doubles-actions.ts`, `uses-to-ko.ts`, `hit-loop.ts`,
`engine-corrections.cjs`, `model.ts`, `mechanics.ts`, `doubles-targets.ts`, `intimidate.ts`, `doubles-positions.ts`;
`status-table.ts` is only regenerated.

### 8.3 Wave 1a: tracks in parallel

| Track | Owns (exclusive) | Implements | Depends on | Gate (at integration 1a) |
|---|---|---|---|---|
| A1 | SPEC2's A1 files (with the generator's `noreceiver` flag) | SPEC2 §2.2's A1 rows, §4.2; §4.2 here | Step 1 | SAT, CQ-STK cases; its tests; golden byte-equal |
| A2 | SPEC2's A2 files | SPEC2's A2 rows, §4.3; §4.2 here | Step 1 | F2, CR-07 cases |
| A3 | SPEC2's A3 files (`doubles-field.ts`, `doubles-items.ts`) | SPEC2's A3 rows, §4.4; §4.2 here (with the four required hook calls of §3.5) | Step 1; D's `tracksItems` | FS, T2M-RI cases |
| D | `doubles-guards.ts`, `doubles-spread.ts`, `tests/unit/doubles-guards-*.test.ts` | SPEC2 §4.5 without the start items; §4.2 here | Step 1; F for Fling | G4 cases (moves) |
| E1 | `doubles-eot.ts`, `residuals.ts`, `tests/unit/residuals.test.ts`, `doubles-eot.test.ts` | SPEC2 §4.6 | D | G4 (end of turn), F2 residual, CR-01/02/05/09/11, CQ-ETT-03, CQ-ALY |
| F | SPEC2's F files | SPEC2 §4.7 | Step 0b | the sweep; golden differs only in the listed Fling rows |
| H | `doubles-hidden.ts`, `tests/unit/doubles-hidden.test.ts` | §4.2 H | Step 1 | T2M-SI, T2E-SI-01, CQ-SKD, IN-CHG-01 |
| S | `doubles-faces.ts`, `doubles-substitute.ts`, `tests/unit/doubles-faces.test.ts`, `tests/unit/doubles-substitute*.test.ts`, `tests/source/doubles-substitute-census.test.ts` | T2M §3.13, §3.22, §3.23, §3.25 | Step 0b | T2M-FA, -FS, -SB, -SP |
| W | `doubles-pairs.ts`, `tests/unit/doubles-pairs.test.ts` | T2M §3.5, §3.14–§3.18, §3.27 | Step 0b | T2M-ALE, -FB, -BE, -AR, -GW, -AS, -SG-01, IN-SFG |
| N | `doubles-history.ts`, `tests/unit/doubles-history.test.ts` | §4.2 N | Step 0a | IN-STL (but -04), IN-DBD, IN-ENT, IN-RC, IN-FO, IN-PRT, CQ-STL, CQ-DBD, CQ-ENT |
| NU | `app/(app)/calculator/doubles-inputs.ts`, `EarlierTurnFields.tsx`, `app/lib/battle/unmodelled-states.ts` (the 2v2 export only), `tests/unit/calculator-doubles-inputs.test.ts` | §5.2 | Step 0c; the contract | its tests; 375 px; a facts-only text review |
| T1 | `app/(app)/training/**`, `scripts/training/*`, `tests/unit/training-*` | SPEC2 §6 | the contract | the Training gates |
| U1 | SPEC2's U files (`doubles-prep.ts`, `BattleConditions.tsx`, `useDoublesView.tsx`, `doubles-format.ts`, `DoublesCard.tsx`, `DoublesTurn.tsx`, `calculator.module.css`, `docs/champions-calculator.md`, `tests/unit/calculator-doubles-ui.test.ts`) | SPEC2 §5.1; §5.2's apply actions | the contract (fixture results) | UI tests; 375 px |
| V1 | `scripts/.cache/calc-audit/2v2/verify/**`, `status2/build/changed-cases.ts`, the generated `tests/unit/doubles-turn-showdown.test.ts` | §7 for the 1a-gated cases | none (oracle side) | every 1a-gated case agrees |

A1, A2 and A3 write the four calls §3.5 requires of them (`fieldchange.settleHolder`, `hidden.land` twice,
`fieldchange.itemsAfterField`) against the stubs; their tests cover the stub behaviour; the 1b owners make the calls act.

### 8.4 Integration 1a (one builder)

1. Merge A1, A2, A3, D, F, N, H, S, W, E1, then T1, U1, NU, V1; regenerate `status-table.ts`; the integrator's one-line
   changes: SPEC2 §8.4's two (`GAS_CHANGING_MOVES`, `gasShieldGuard`), the REASONS keys whose last site went in 1a, the sets of
   §2.4 whose members 1a modelled, `status2-hooks.test.ts`'s removed guard rows.
2. Run every stored case and every 1a-gated case; `changed-cases.ts`; store the re-run results; regenerate the tests.
3. `npm run check`; `golden-1v1 --check` (only F's rows differ); the bench; `conformance:training`, `leak:training`,
   `eval:training`; §7.3's census sample and budget measurement.
4. A live check of `/calculator` 2v2 at 1280 and 375 px: SPEC2 §8.4 step 5's list, plus High Jump Kick into Protect (the crash
   loss), Dig then the ally's Earthquake, `{Move} charged last turn` with Fly, `Protecting moves in a row` with Protect, Focus
   Band on a knockout, Double Hit into Mimikyu, `Switched in` with Payback.

### 8.5 Wave 1b: tracks in parallel (wave 1a's files frozen, but E1's, T1's, U1's and V1's, which continue)

| Track | Owns (exclusive) | Implements | Depends on (merged in 1a) | Gate (at integration 1b) |
|---|---|---|---|---|
| K | `doubles-reactions.ts`, `tests/unit/doubles-reactions.test.ts`, `tests/source/doubles-spread-reactions.test.ts` | §4.3 K (FX-CE first) | A1, A3, D, E1 | T2M-VS-05, -SE, -SCK, -UN, -UNR, -CD, -FV, -BB, -AF, -IO, -RC, FX-CE |
| M | `doubles-max.ts`, `tests/unit/doubles-max.test.ts` | §4.3 M | A2, D, N | T2M-GM, -PS, IN-STL-04 |
| PR | `doubles-presence.ts`, `tests/unit/doubles-presence.test.ts` | §4.3 PR | D (`fixedHit`), A3 (reflection), N | T2P's presence and row cases, CQ-BID, CQ-PUR, CQ-CMD, CQ-ECV, IN-RTL, IN-ECV |
| CL | `doubles-calling.ts`, `tests/unit/doubles-calling.test.ts` | §4.3 CL | A2, E1, N | T2P-NAT, -CPY, -MIR, -MEF, -INS, T2M-ST, -UP, -HH, T2E-UP-01, IN-CPY |
| ST | `doubles-start.ts`, `tests/unit/doubles-start.test.ts` | §4.3 ST | A1, D, N | T2P-TRC, -TWO, -DWN, -CUS; SPEC2's start cases (G4's Imposter, start Starf, start copies) |
| FC | `doubles-fieldchange.ts`, `tests/unit/doubles-fieldchange.test.ts` | §4.3 FC | A1, A2, A3, D | T2P-FLD, -ACT; FS's Magic Room and Defog cases with field-settled holders |
| E2 | E1's files, continued | §4.3 E2 | E1, D, N, H | T2E-FS, -CC, -MO, -GX, -FC, IN-FLD, IN-TNT, IN-CUD, IN-FSL-01/03, IN-TLK, IN-HBK |
| T2 | T1's files, continued | §6's T2 rows | the contract | the Training gates |
| U2 | U1's files, continued | §5.1 here (steps, conditions, residual lines, losses, start rows) | fixtures | UI tests; 375 px |
| V2 | V1's files, continued | §7 for the 1b-gated cases | — | every 1b-gated case agrees |

The end of turn's faints go through the kernel's `faint`, whose Step 0 hook K implements (`reactions.allyFaint`), so E2 needs no
code for Receiver at the end of turn.

### 8.6 Integration 1b

As 1a with the 1b tracks, plus: the two `classify-a3.md` flips (§2.2); the REASONS keys and sets of §2.4 whose last site went in
1b; the census sample's not-estimated share, where every Tier 2 reason but §2.4's kept list must be gone; T2E's budget
acceptance (§10). Live check additions: Dancer copying Swords Dance, Instruct, a Fire + Grass Pledge, Future Sight landing from
a Pokémon of the turn and from a build, Cud Chew's Berry, Trace with two candidates (start rows per variant), a Bide release.

### 8.7 Wave 2: switch-outs with a replacement (Q1 = R; SPEC2 §8.5, plus)

1. **Step 2** (the integrator): SPEC2's R contract, with IN §3.1's `DoublesBenchPokemon` (`carried` with sleep, freeze,
   `onceUsed`) and `hazards.steelsurge`; gate: behaviour unchanged as Step 0's.
2. **Tracks:** R-E owns `doubles-switch.ts`, `doubles-turn.ts`, `doubles-world.ts`, `doubles-eot.ts`, and for the wave
   `doubles-calling.ts` (Assist from the bench's moves) and `doubles-presence.ts` (Beat Up from the bench, Commander's newcomer
   pair keeping `notIn2v2("Commander")`, Pursuit meeting a switching target at 80); Eject Button and Red Card behind a face,
   Emergency Exit after a crash and the U-turn family into a face reach `switch.switchOut` through calls S and H already make.
   R-U owns NU's files and `BenchFields.tsx` (IN §5.7, `Lands this turn` over the bench). R-T: SPEC2 §6's R part, the prelude's
   replacement, a benched landing source. R-V: the SWX cases, IN-BNC, IN-HZD, IN-FSL-02, T2P's Assist cases, T2E's bench
   landings.
3. **Integration 2:** as 1b, plus the SWX cases and the census sample's switch family.

### 8.8 Reviews and the final gate

Seven reviewers, each with §9's cross-family checklist, then one fixer; at most two rounds: (1) A1 with K; (2) A2, A3 with H;
(3) D, E1, E2 with F; (4) S, W with M; (5) PR, CL, ST with FC; (6) N, NU with U1 and U2; (7) T1, T2 with R. The final gate is
FINAL.md's (every oracle case, the generated tests, golden, the Training gates, the census sample, the live check), written up as
`status2/build/FINAL2.md`.

### 8.9 Who owns each file when

| File | Step 0 | Step 1 | Wave 1a | Wave 1b | Wave 2 |
|---|---|---|---|---|---|
| the frozen kernel files of §8.2 | 0a / 0b | Step 1 builder | integrator | integrator | Step 2; R-E (`doubles-turn.ts`, `doubles-world.ts`) |
| `calculate.ts` | 0b | Step 1 builder | F | integrator | integrator |
| `doubles-start.ts` | 0b | — | frozen | ST | frozen |
| `doubles-stages.ts`, `doubles-abilities.ts`, `ability-table.ts` | 0a | — | A1 | frozen | frozen |
| `doubles-typing.ts` | 0a | Step 1 (#3) | A2 | frozen | frozen |
| `doubles-field.ts`, `doubles-items.ts` | 0a | — | A3 | frozen | frozen |
| `doubles-guards.ts`, `doubles-spread.ts` | 0a | Step 1 (#1, #2) | D | frozen | frozen |
| `doubles-eot.ts`, `residuals.ts` | 0a (lines) | — | E1 | E2 | R-E (`doubles-eot.ts`) |
| `doubles-hidden.ts` | 0a | Step 1 (#10) | H | frozen | frozen |
| `doubles-reactions.ts` | 0a | Step 1 (#12, #13) | frozen | K | frozen |
| `doubles-pairs.ts` | 0a | — | W | frozen | frozen |
| `doubles-faces.ts`, `doubles-substitute.ts` | 0a | — | S | frozen | frozen |
| `doubles-max.ts` | 0a | — | frozen | M | frozen |
| `doubles-presence.ts`, `doubles-calling.ts` | 0a | — | frozen | PR, CL | R-E |
| `doubles-fieldchange.ts` | 0a | — | frozen | FC | frozen |
| `doubles-history.ts` | 0a | — | N | frozen | frozen |
| `doubles-switch.ts` | 0a | — | frozen | frozen | R-E |
| the calculator's U files | 0c (moves) | — | U1 | U2 | R-U (bench state in `doubles-prep.ts`) |
| `doubles-inputs.ts`, `EarlierTurnFields.tsx`, `unmodelled-states.ts` (2v2) | 0c | — | NU | frozen | R-U |
| `app/(app)/training/**` | — | Step 1 (SPEC2 #7, #8; #11, #14–#16) | T1 | T2 | R-T |
| `scripts/.cache/calc-audit/2v2/verify/**` | — | Step 1 (its cases) | V1 | V2 | R-V |
| `status2/build/classify-a1.md` … `-a3.md` | — | — | A1, A2, A3 | integrator (the a3 flip) | — |
| `tests/source/status2-hooks.test.ts` | 0a | Step 1 builder | integrator | integrator | integrator |

A track that needs a line in a file it does not own asks the integrator (one line, reviewed). No two parallel tracks share a file.

---

## 9. Test plan (additions to SPEC2 §9)

- **Step 0:** `tests/source/status2-hooks.test.ts` gains every row of §3.5 (each moved guard keeps a call site until its track
  removes it; each hook is called where §3.5 says; `presenceGuards`' lines in today's order; the four calls the 1a tracks write
  are present at integration 1a); every `DoublesCarried` key has a `carriedState` mapping and a `carriedIssues` branch;
  `residualHit` is called only from `doubles-eot.ts`; `kernel.useCalled` is the only calling path. `status2-plumbing-t2.test.ts`:
  §3.6's list. The readers rule: a turn with none of the new mechanics has today's world count (`discreteKey` of every new field
  absent).
- **Step 1:** each fix's cases (§8.2) and, for #11 and #14–#16, Training unit tests from scripted public logs.
- **H:** T2M §3.1's `doubles-hidden.test.ts`, plus Sky Drop (the pair's exemption, Gust ×2 at either, the lost action, the
  failures) and C27's order (a commanding Tatsugiri is missed by a No Guard attacker; Helping Hand reaches it).
- **K, W, S, M:** T2M §3's tests per entry; the spread reactions source test; the continuation's bookkeeping (Life Orb once,
  Shell Bell over both parts, no per-use effect in a stopped part).
- **N:** IN §9's `doubles-history.test.ts`, plus the recharge (no sleep count: TR01), Fake Out after the first turn (TR07),
  the stall roll's place before Protean (a failed roll leaves Protean unused), C23's explicit 1.
- **PR, CL, ST, FC:** T2P §13's four test files, plus the Bide release (C41) and Pursuit's combo (C30) in PR's, Uproar and
  Helping Hand twice in CL's.
- **E1, E2:** SPEC2's, plus T2E §4's tests (the landing build per source kind, Cud Chew's counter on every eat path, Moody's
  readers rule, the forms' equal HP, the field ends only for the effect from before the turn) and IN §9's countdowns.
- **NU:** IN §9's `calculator-doubles-inputs.test.ts` over §5.2's merged table: every control's "Shown when" per game (a
  table-driven test over the four runtimes), "or while set", the option lists (names by `doublesNames`; no "left", "right",
  "slot" or "position" in any label or option), the mapping into `DoublesTurnInput` (types on a build copy only; `—`, Unknown and
  None mapped as §5.2 says), the reset rules, the summary count, unique accessible names, 375 px for the busiest group.
- **U1, U2:** SPEC2's, plus the new conditions, residual lines, losses, the `copied` steps and the start rows per variant.
- **T1, T2:** SPEC2's, plus every row of §6's table from a scripted public log (and that none reads a non-public field: the leak
  diff), splits.ts no longer forking a Protect, the prelude's worlds and their bound.
- **V1, V2:** every case of §7.2 agrees; `changed-cases.ts` lists exactly the stored cases that change; the C19 harness clear is
  on by default and off only with `earlierThisTurn` or a switch-in.
- **Cross-family checklist for reviewers (additions to SPEC2 §9's):** a carried Fly released into Gravity (cancelled) and into
  Smack Down; Spectral Thief against a foe's Opportunist (SV has no Spectral Thief: the ledger stays empty); a Dancer copying a
  dance into a hidden target; Instruct on a Pokémon with a carried Encore; Sleep Talk calling a two-turn move (not callable) and
  Uproar waking it; Focus Band on the hit Disguise takes (none: 0 damage); a Berry between hits on a Substitute's holder (none: no
  Update reaches it); Counter after a hit into a face (fails); Cud Chew re-eating a Berry Bug Bite took (not counted); the landing
  into a Pokémon that Protected this turn (hit) and into one charging Dig (missed); Trace copying Intimidate beside a Defiant ally
  of the foe; a terrain ending at 27.7 with a Quark Drive holder (FC re-settles it); Lash Out after a switch-in Intimidate in
  Training (C19).
- **1v1:** `golden-1v1.full.json.gz` byte-equal except F's rows; `calculator-uses-to-ko*` unchanged; the 1v1 rows' Tier 2 texts
  ("Focus Band: 10% to survive each KO hit", HISTORY_MOVES' needs-context texts) unchanged.

---

## 10. Risks (additions to SPEC2 §10)

1. **Step 0's size** grows by nine modules, about 60 contract fields and the queue, calling and residual kernel. Mitigation:
   three builders with disjoint files; eleven commits each gated byte-equal (§8.1); every reader keyed on a field nothing sets;
   the hooks source test; T2E's and §3.6's synthetic-input tests before any track starts.
2. **The continuation primitive** (T2M §2.5: faces, Berries between hits, hits behind a Substitute): Life Orb once, Shell Bell
   over both parts, the stopped part's per-use effects. Pinned by T2M-BE, -FA, -SP and the re-run VE-F1-10, VE-F1-13, E40 cases.
3. **The spread reactions list** (T2M §3.3): a reaction applied and listed would count twice. The source test checks every
   attacker-side write in uses-to-ko's afterHit against the list.
4. **Inserted actions and calling** (Dancer, Instruct, every caller through `kernel.useCalled`): every reader of `MonState.moved`
   and of `input.pokemon[slot].action` is listed in the hooks test; the T2P-DAN, -INS, -NAT, -CPY cases pin the order and the
   inherited priority.
5. **World growth.** Start variants (Trace × Custap × Download × Starf, ≤ 40 per pair), the Counter family's split by damage,
   a Bide release's split by its store, Moody ×20 in E2, Focus Band ×2 per knocking hit, a Starf between hits ×5, the stall roll
   ×2, Sleep Talk's k × targets, Befuddle ×9. The readers rule keeps each off the turns without its reader. **Acceptance at each
   integration (§7.3):** no ready sample turn of today's census sample becomes `Too many cases to follow.` through these families;
   SPEC2's spread-heal joint within SPEC2 risk 5 (T2E measured 4 of 278 guarded Matcha Gotcha turns over, 0.05 % of Champions
   turns); the calculation load (today worst 58 of 160) stays at or under 160 on every sample turn, else the family that pushes it
   over gets an exact reduction designed separately. Nothing approximate.
6. **Numbers users see change** by design: crash damage (High Jump Kick into Protect is common in VGC practice), Burning Jealousy
   and Spectral Thief as the last action, Training's switch-in sleepers, ties and Lash Out turns. Each is a listed Step 1 commit
   with its cases; `changed-cases.ts` finds every stored case they move.
7. **Training's numbers move** as rollouts become engine cells (two-turn releases, the stall roll, Uproar, Safeguard, Sleep Talk,
   the landing, Cud Chew, Moody, Magic Room's end, recharge, Struggle, Fake Out, Payback and Analytic with a switch-in): the
   conformance and eval gates at every integration against main on the same seeds; HabitBot reported beside main's.
8. **C19's harness clear** changes what the oracle's turn is. Mitigation: a stored case it could change is either on the
   changed list (re-run) or would disagree today (asserted none by `changed-cases.ts`); the clear is the app's meaning ("a turn after they came in"),
   and the cases that want the flags set them.
9. **Many controls** (§5.2). The show-when rule keeps a typical turn at today's controls; the 375 px test covers the busiest group;
   names are unique for assistive technology.
10. **Wave 1a/1b dependencies.** A 1a track calls a 1b hook's stub (four calls); its tests cover the stub behaviour; integration
    1b's cases cover the real one. A 1b track that finds a 1a file needs a change asks the integrator.
11. **Wave 2's identity change** (R) also touches PR's and CL's modules (Beat Up, Assist, Commander's newcomers): R-E owns them for
    the wave; the SWX cases and T2P's Assist cases gate it.

---

## 11. Settled points (every open question of the five designs; none is left for the user)

| Question | Raised by | Settled | By |
|---|---|---|---|
| The release turn of a two-turn move: a calculator control and Training mapping | T2M §7.2 Q1 | Yes, both (`{Move} charged last turn`; Training's `-prepare`) | Q2 ("plus any further earlier-turn input the Tier 2 guards need") |
| Safeguard from an earlier turn as a side toggle | T2M Q2 | Yes, both | Q2 |
| Dragon Darts aimed at its user's spot | T2M Q3 | Kept with its justification | Q6 allows a kept narrow reason with a justification; §2.3 #31 |
| Booster Energy received by Trick | T2M Q4 | Kept with its justification | Q6; §2.3 #32 |
| Triple Axel, Triple Kick, Parental Bond behind a Substitute before a per-hit effect | T2M Q5 | `subPerHit` kept for them | Q6; §2.3 #34 |
| Who owns the calling helper | T2M Q6 | `kernel.useCalled` (Step 0a); CL owns every caller | §1.3 |
| Power Construct | T2E §9 Q1 | Kept with its justification | Q6; §2.3 #39 |
| Calculator controls beyond the guards' needs (stall, recharge, first turn, switched in, field ends, Safeguard, G-Max) | T2E Q2 | Included, each shown only where read | Q2 ("those plus more") |
| The ten status-eot field controls; the presence rows' inputs | IN §12 | Included (the engine already reads them; Tier 2 models Copycat, Echoed Voice, Retaliate) | Q2 |
| Commander in the calculator; Trace unset | T2P §11 | Derived as entered with a fact; Trace as 1/k start variants with a fact | Q8's pattern |
| Defaults of the new history inputs | T2P §11, IN §0.1 | Unknown where None would usually be wrong (the rows' counts, the entry order, the battle's last move, Retaliate, Echoed Voice, a used Protean's type); None with a fact for the turn's own move's history (stall, Ally Switch, Uproar, Bide, a charge); Cud Chew without a Berry None with a fact (C29) | Q3, Q4 and their reasoning |
| Battle Bond's once-a-battle flag outside SV | IN §5.2 | SV only | C22 (the app's validation) |
| The battle's first turn and a switch-in's entry effects | this addendum | `earlierThisTurn`; Training exact; the oracle's turn clears the flags; the calculator's two controls and Lash Out's existing toggle | C19 and the house rule (exact, else a stated fact) |
| A carried Bide | T2P §6.1 (kept) | Modelled with `carried.bide` | Q6 and Q2 (C41) |
| Track and module names | T2M §6, T2P §12 | §1.3 | C31 |

`userDecisions`: none.
