# Tier 2: presence guards, calling moves, the start settle, the row reasons (tier2-presence)

Design only. Branch `calc-2v2-status-2` (main `4008ee8`). This file designs the Tier 2 entries USER-DECISIONS Q6 put in
this build and the TIER 2 ARCHITECT (presence) brief assigned: the seven presence entries, redirect-tie, the three settle
entries, the three row entries, needs-moves, unburden-start-berry, field-change, activates and gas-ends-shield. It is a
delta on SPEC2.md (and ADDENDUM2.md once written); every name it uses from SPEC2 (tracks A1–V, Step 0a/0b, D's `fixedHit`,
A2's world types, A3's reflection, R's bench) is SPEC2's.

Ground truth is pinned Showdown `c23d2e94`: `PS/…` is the read-only source
`node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353`. Probes run on the runnable copy
through `guards-sim.ts` (exact enumeration), from the repo root:

| File | Sections (probe ids are `TPn·id`) |
|---|---|
| `tier2-presence-probes-catalog.ts/.out` | which triggers each game's app catalog has, and their learners |
| `tier2-presence-probes-1.ts/.out` | C Commander, P Poison Puppeteer, D Dancer, R Round, F Fusion, S Spotlight, B Flame Burst, K Beak Blast / Shell Trap |
| `tier2-presence-probes-2.ts/.out` | C Counter family, BU Beat Up, N Nature Power, CC Copycat, MF Me First, I Instruct, MM Mirror Move, ST Sleep Talk, AS Assist, ME Metronome's pool, PL Pledges, CU Custap |
| `tier2-presence-probes-3.ts/.out` | FU follow-ups, RT redirect ties, TR Trace, DL Download, UB Unburden, AC Wind Rider / Wind Power / Room Service, FC field change, RW row moves |
| `tier2-presence-probes-4.ts/.out` | TR5 Trace sampled mid-turn, DL4 Download first, UB2 Unburden at the first Update, FC2b/3b/3c/11/12, RT4b/RT5, RW8–10, SD Sky Drop |
| `tier2-presence-probes-5.ts/.out` | E1–E8: Counter edge cases, Round and a fainted Round, Pledge into Protect, Dancer and Fusion |

Every final probe run wrote nothing to stderr. App line numbers are the tree at `4008ee8`.

---

## 0. Decisions in one page

| Entry | Decision | Games | Track | Narrow reason left (exact) |
|---|---|---|---|---|
| presence-commander | **Model** | sv | P | — |
| presence-poisonpuppeteer | **Model** | sv | P | — |
| presence-dancer | **Model** (inserted copies) | sv usum | P | `Dancer needs whether {A} or {B} came in first.` (stored-Speed tie, entry order unknown) |
| presence-moves: Spotlight | **Model** | usum | P | — |
| Round | **Model** | all four | P | — |
| Beak Blast | **Model** | sv ch usum | P | `{Move} into {Name}'s Beak Blast is not modelled in 2v2.` (a multi-hit contact move whose burn lands after its first hit) |
| Shell Trap | **Model** | swsh usum | P | — |
| Beat Up | **Model** (wave 1 from the move's party context; wave 2 from R's bench) | all four | P | the 1v1 row's own `Beat Up into {X}: not calculated.` |
| Fusion Bolt / Fusion Flare | **Model** | sv swsh usum | P | — |
| Counter, Mirror Coat, Metal Burst, Comeuppance | **Model** (step reports the last hit; D's `fixedHit`) | all four (Comeuppance sv ch) | P (+ Step 0b, D) | — |
| Flame Burst | **Model** | usum | P | — |
| Sky Drop | **Model** on tier2-moves' semi-invulnerable state | usum | P | `Sky Drop is not modelled in 2v2.` only if tier2-moves keeps semi-invulnerable narrow |
| presence-calling: Nature Power | **Model** | swsh usum | P | — |
| Copycat | **Model** | all four | P | `Copycat needs the last move used before this turn.` (it can move first and the input does not give it) |
| Mirror Move | **Model** | usum | P | the existing `Mirror Move needs {Name}'s move from the last turn.` (Q3 Unknown) |
| Me First | **Model** | usum | P | — |
| Instruct | **Model** (inserted prioritised action) | all four | P | `Instruct needs the target of {Name}'s last move.` (an earlier turn's single-target move, target unknown) |
| Sleep Talk (asleep or Comatose) | **Model** | all four | P | `Sleep Talk needs {Name}'s moves.` (moves not given) |
| Assist | **Model in wave 2** (R's bench moves) | usum | P / R-E | wave 1: `Assist needs the moves of {Name}'s party.` |
| Metronome | **Keep** (§3.14) | sv swsh usum | — | `Metronome is not modelled in 2v2.` |
| presence-pledges | **Model** (wait, combined move, sea of fire / swamp / rainbow) | sv swsh usum | P (+ E residual) | `{Move} with the rainbow is not modelled in 2v2.`; `{Move} with the swamp is not modelled in 2v2.` (§3.17) |
| presence-custap | **Model** (start variants) | sv swsh | S | — |
| redirect-tie | **Model** (entry order input) | all four | P (kernel hook) | `{By} needs whether {A} or {B} came in first.` (entry order unknown) |
| settle-trace-random | **Model** (1/k start variants, as entered); Trace copying Intimidate **modelled** | all four | S | `Trace copies a random foe's ability.` only when a candidate's Start sets the field or HP (§4.1) |
| settle-two-act | **Model** (per-need reads) | all four | S (+ Step 0b) | — |
| settle-download | **Model** (lead Start order; ties as variants) | sv swsh usum | S | — |
| row-history-moves | **Model** Present, Magnitude, Pursuit (wave 1: no switch), Retaliate, Fury Cutter, Rollout, Ice Ball, Echoed Voice, Trump Card; **keep** a carried Bide | see §6.1 | P (+ Step 0b) | the row's own reason while its earlier-turn input is unknown; Bide's `Needs the damage stored over earlier turns.` |
| row-engine-limits | **Keep** (1v1 engine limits, byte-equal) | — | — | the 1v1 rows |
| step-stops | field part **modelled** with field-change; **keep** the rest | — | FC (+ Step 0b) | `A weather or terrain change this turn would change {Name}.` only between two hits of one move; `A later use cannot be calculated` |
| needs-moves | **Keep** (input completeness) | all four | — | `Imprison needs {Name}'s moves.` (and Sleep Talk's) |
| unburden-start-berry | **Model** (a Step 1 fix) | all four | Step 1 | — |
| field-change | **Model** (re-settle every field-settled holder per world) | all four | FC | as step-stops |
| activates | **Model** (Wind Rider, Wind Power, Room Service) | sv (wind), sv swsh (Room Service) | FC | — |
| gas-ends-shield | **Keep** (needs Q5's per-world gas stand-ins) | sv swsh | — | `Neutralizing Gas ending is not modelled in 2v2.`, `An Ability Shield change under Neutralizing Gas is not modelled in 2v2.` |

Shared machinery this tier adds (each one owner, all in Step 0's contract):

1. **Queue edits** (kernel, Step 0a): `kernel.prioritize(w, action, source?)` (today's After You `order()`, moved out of
   doubles-status.ts, used by Round, the Pledges, Shell Trap and Instruct), `kernel.insertAction(w, action)` (Instruct's new
   action), `kernel.externalUse(w, action)` (Dancer: BeforeMove and the move, no `moved`, no position, no last move) and a
   `PendingAction.source` (Showdown's `action.sourceEffect`: "round", the Pledge that waited, "instruct").
2. **Calling** (kernel, Step 0a): `kernel.useCalled(w, action, moveId, { target, priority, prankster })` runs a called move
   as Showdown's `useMove` does: no BeforeMove, no PP, the caller's priority and Prankster flag, then TryMove, PrepareHit,
   the hits; damaging through `damagingMove`, status through a new `doubles-status.ts runCalledStatus`.
3. **Did something** (kernel, Step 0a): `World.didSomething?: true`, set during an action when its move "did something"
   (Showdown's `moveDidSomething`, `PS/sim/battle-actions.ts:308`), cleared after; written only when a Dancer or a Fusion
   user is in the turn (the readers rule).
4. **Battle memory** (kernel, Step 0a): `World.lastSuccessful?: string | null` (Fusion) and `World.lastMove?: string | null`
   (Copycat), each written only while its reader is in the turn.
5. **Hits taken** (Step 0b + kernel): `TurnStepOutcome.lastHit?` (the damage of the move's last hit on the Pokémon, as
   `PS/sim/battle-actions.ts:950-996` records it) and `MonState.taken?` (Counter, Mirror Coat, Metal Burst, Comeuppance),
   written only while one of those four is queued on the hit Pokémon.
6. **Start variants** (S, Step 0a): `DoublesSettle.variants?` — weighted alternative settles; `rootWorlds` makes root
   worlds from each. Trace's random copy, Custap with Quick Draw, Download's Speed tie and SPEC2 D's start Starf all use it.
7. **Entry order** (input, the inputs architect's control): `DoublesTurnInput.entryOrder?` — the order the four came in
   (Showdown's `abilityState.effectOrder`), which breaks redirection ties and the Dancers' stored-Speed ties.
8. **Field re-settle** (FC, Step 0a hooks): `fieldchange.changed(kernel, w, before)` at every weather, terrain or
   effective-weather change (moves, steps, faints, ability changes, the end of turn).

Randomness this tier adds, all branched exactly: Copycat's, Sleep Talk's, Assist's and Me First's random targets (1/n of
the adjacent foes), Sleep Talk's and Assist's move pick (1/n), Trace's start copy (1/k of the adjacent foes), Download's
and Dancer's Speed ties at the lead (1/2), Present (2/10, 4/10, 3/10, 1/10), Magnitude (5/10/20/30/20/10/5 %), a
Round pulled among tied queued Rounds (1/k). Budgets unchanged; "Too many cases to follow." stays the only fallback.

Nothing here needs a user decision: every default follows Q3/Q4 ("Unknown keeps the narrow reason") or Q8 ("as entered,
stated as a fact"); §11 lists them.

---

## 1. What the probes settle

| Probe | Shows | Used in |
|---|---|---|
| TP1·C1 | At the lead Commander activates (Dondozo +2 to all five). A foe's Dragon Claw at Tatsugiri misses; Earthquake misses Tatsugiri and hits the rest; Tatsugiri has no action | §2.1 |
| TP1·C2 | Dondozo knocked out first: at the next Update Tatsugiri stops commanding and the later Dragon Claw hits it (KO); it still does not move | §2.1 |
| TP1·C3 | Sand and poison reach a commanding Tatsugiri at the end of turn | §2.1 |
| TP1·C4 | Order Up: +1 Atk (Curly), +1 Def (Droopy), +1 Spe (Stretchy) | §2.1 |
| TP1·C5 | Roar into Dondozo fails; Dragon Tail damages it, no drag; Perish Song misses Tatsugiri | §2.1 |
| TP1·C6 | Neutralizing Gas at the lead (Weezing faster or slower: gas priority 2): Commander does not activate; Tatsugiri moves | §2.1 |
| TP1·C7 | Icy Wind misses Tatsugiri; Dondozo −1 Spe | §2.1 |
| TP1·P1–P6 | Pecharunt's Toxic and Poison Gas confuse each poisoned target (its own ally too); Own Tempo, an existing confusion, Misty Terrain, an ally's Toxic: none; Lum cures both, Persim the confusion at the Update | §2.2 |
| TP1·D1–D9 | A dance copied at once by every Dancer but the user, slowest stored Speed first; its target rule; BeforeMove runs (paralysis 1/4, sleep counts down, Taunt stops it); a failed dance (Swords Dance at +6) is not copied; Petal Dance does not lock the Dancer; a Dancer that already moved copies too | §2.3 |
| TP1·R1–R5, TP5·E4 | Round pulls the next queued Round (ally or foe) to move next at 120 power; chains; a fully paralysed first Round pulls nothing; a fainted Pokémon's queued Round is pulled (it does nothing) and the living one then is not | §3.2 |
| TP1·F1–F6, TP3·FU5 | Fusion Bolt 2x right after a Fusion Flare that did something (a KO included); any move in between that reached its own move resets it (Splash, Swords Dance, a failed Swords Dance); a fully paralysed Pokémon in between does not; a Flare blocked by Protect does not count | §3.6 |
| TP1·S1–S4 | Spotlight's redirection (priority 2 over Follow Me), on a foe or an ally; Magic Bounce reflects it onto the user | §3.1 |
| TP1·B1–B5 | Flame Burst: the target's partner loses floor(base max HP / 16) at the hit, also through a Substitute; Magic Guard none; into the user's ally the splash hits the user; absorbed (Flash Fire): none | §3.8 |
| TP1·K1–K3, TP3·FU7 | Beak Blast's heat from the turn's start: a contact move into it burns the attacker; non-contact none; after a full paralysis the heat stays to the end of turn; a multi-hit contact move: burned after the first hit (Dual Wingbeat 24 then 12; Guts 24 then 36) | §3.3 |
| TP1·K4–K7 | Shell Trap: a foe's physical hit makes it move next; an ally's or a special hit, or a hit into its Substitute: it fails | §3.4 |
| TP2·C1–C13, TP3·FU4, TP5·E1–E3 | Counter 2x the last physical hit from a foe (the last hit of a multi-hit move; the later of two attackers), Mirror Coat the special one; Metal Burst / Comeuppance floor(1.5x) of the last damage from a non-ally; at the slot the attacker hit from (Ally Switch); Follow Me takes it; fails with no hit, an ally's hit, a hit into a Substitute, a hit Disguise took; immune: Counter into Ghost, Mirror Coat into Dark; the recorded attacker fainted: no target; Parental Bond: two full hits | §3.7 |
| TP2·BU1–BU3 | Beat Up: one hit per party member alive with no status (the user always), each 5 + floor(base Atk / 10); Justified per hit | §3.5 |
| TP2·N1–N3 | Nature Power: Thunderbolt / Energy Ball / Moonblast / Psychic / Tri Attack at the chosen target; the called move redirected (Lightning Rod); a Prankster Nature Power into a Dark type fails | §3.9 |
| TP2·CC1–CC5, TP3·FU2 | Copycat: the last move used in the battle (this turn's, or last turn's when it moves first), at a random foe; Protect and the like fail it; a blocked move is still copied | §3.10 |
| TP2·MF1–MF2 | Me First: the target's queued damaging move at 1.5x (78 → 118); fails after the target moved or on a status move; a spread move is copied as spread | §3.12 |
| TP2·I1–I4, TP3·FU3 | Instruct: the target uses its last move again at once (same target; retargeted if that one fainted); before its own action, its last move from an earlier turn; Protect blocks Instruct; no last move: fails | §3.13 |
| TP2·MM1–MM2 | Mirror Move: the target's last move (this turn's or an earlier turn's), at the target | §3.11 |
| TP2·ST1–ST2 | Sleep Talk: uniform over its moves but Sleep Talk and charge moves; the called move at a random foe; Comatose too | §3.14 |
| TP2·AS1 | Assist: uniform over the partner's and the bench's moves but noassist ones | §3.14 |
| TP2·ME1 | Metronome's pool: sv 581 (402 damaging), swsh 553 (366), usum 607 (402) | §3.14 |
| TP2·PL1–PL6, TP3·FU1, TP5·E5 | The Pledges: the first waits, the ally's moves next at 150 with the combined type; sea of fire 1/8 at this end of turn, swamp Speed ×0.25 for the whole target side (the gen 8+ re-sort reads it; gen 7 does not), rainbow on the user's side; same Pledge, a foe's Pledge: none; into Protect: no side condition | §3.17 |
| TP2·CU1–CU2b | Custap with Quick Draw: 30% Quick Draw (Custap kept), 70% Custap eaten; Mycelium Might with a status move: not eaten; with an attack: eaten | §4.5 |
| TP3·RT1–RT4, TP4·RT4b–RT5 | Equal-Speed redirection: the holder that came in first takes the move (two Lightning Rods, two Follow Me users); a holder that came in again later loses the tie | §3.18 |
| TP3·TR1–TR4, TP4·TR5 | Trace: uniform over the adjacent foes with a copyable ability (sampled mid-turn: 1/2 each); copying Intimidate runs its Start (both foes −1 Atk, Defiant +2) | §4.1 |
| TP3·DL1–DL3, TP4·DL4 | Download at the lead reads both foes' Defense and Sp. Def with stages: after a faster Zamazenta's Dauntless Shield (+1 Def counted: Sp. Atk), before it when Download is faster (Attack) | §4.3 |
| TP4·UB2 | An Unburden holder's Lum Berry at the turn's first Update: sv and Champions sort after it (doubled Speed); usum's frozen order keeps the start Speed | §5.1 |
| TP3·AC1–AC6 | Tailwind: Wind Power charges and Wind Rider +1 Atk on the user's side only; Trick Room starting: Room Service −1 Spe, used (Clear Body does not stop it) | §5.3 |
| TP3·FC1–FC10, TP4·FC2b–FC12 | Field-settled holders on a mid-turn change: Protosynthesis / Quark Drive start (best stat) and end; Booster Energy at the next Update after the field ends; Seeds used; Ice Face restored; Mimicry's type; Forecast's form; Cloud Nine suppresses and its faint restores | §5.2 |
| TP3·RW1–RW7, TP4·RW8–RW10 | Present 2/4/3/1 tenths (heal round(base max HP / 4), through a Substitute; a Ghost type immune to all); Echoed Voice's power from earlier turns only (two this turn: equal); Retaliate 2x after a faint last turn; Pursuit 40, 80 into a U-turner | §6.1 |
| TP4·SD1–SD2 | Sky Drop lifts the target: its own move is lost, the partner's move at the user misses; a 200 kg target: fails | §3.16 |

---

## 2. Presence abilities

### 2.1 Commander (SV)

**Showdown.** Commander (`PS/data/abilities.ts:604-640`): when Tatsugiri (base species) and an ally Dondozo (base species)
are both in, Tatsugiri's action is cancelled, it gets `commanding` and Dondozo `commanded` (`PS/data/conditions.ts:807-844`):
Dondozo +2 to all five stages once (`onStart` boost), neither can be dragged out or switched by an item or a switching
move (`PS/data/items.ts:1690, 1741`; `PS/sim/battle-actions.ts:1291, 1311`; `PS/data/moves.ts:1102, 16173`), and every move
through the hit steps misses Tatsugiri (`PS/sim/battle-actions.ts:625`; Perish Song through `onInvulnerability`). A
commanding Tatsugiri chooses no move (`PS/sim/side.ts:1312, 1345`) and `onBeforeTurn` cancels any action. Order Up
(`PS/data/moves.ts:13041`) gives Dondozo +1 by Tatsugiri's form. When Dondozo faints, Tatsugiri's `onUpdate` ends the
command. Neutralizing Gas does not suppress a commanding Tatsugiri (`PS/sim/pokemon.ts:871`), and at the lead the gas
(switch-in priority 2) is out first, so Commander never activates under it (TP1·C6).

**Model** (2v2, SV).
- *Start.* `commanding(slot)` holds when the slot's settled build is Tatsugiri (base species, Commander, not the gas
  stand-in, not transformed) and its partner is a present, living Dondozo (base species), or when Training carries it
  (`DoublesCarried.commanding`, §7). `MonState.commanding = partner` and the partner's `MonState.commanded = slot`.
- *No action.* `rootWorlds` (`doubles-turn.ts:893`) leaves a commanding slot's action out of the queue
  (`presence.rootActions`), so `laterAction`, willMove reads (Helping Hand, Sucker Punch, Payback) never see it. Its step
  (if its input had a move) is all `skipped`: `Inside {Dondozo} (Commander).`
- *Invulnerable.* A new hit-step check before Wide Guard in `hitChecks` (`doubles-turn.ts:1558`) and in the status
  pipeline's targets (`doubles-status.ts targetsOf / hitOne`), and Perish Song's and Teatime's own Invulnerability reads:
  `presence.invulnerable(kernel, w, attacker, target, info)` → a miss, hit fact `{Move} misses {Tatsugiri}: it is inside
  {Dondozo}.` (Helping Hand is the one move that reaches it: `PS/sim/battle-actions.ts:622`; it then fails `Helping Hand
  fails: {Tatsugiri} has no action.`). A spread move misses it and hits the rest with the spread modifier (the target count
  is the move's: TP1·C1).
- *Locks.* Dondozo and Tatsugiri: Roar and Whirlwind fail (`{Move} fails: {Dondozo} cannot be dragged out.`), Dragon Tail
  and Circle Throw do not drag, Eject Button, Eject Pack and Red Card stay held and do nothing, U-turn and the other
  switching moves of Dondozo do not switch (`presence.cannotLeave(w, slot)`, read at the five switch-out sites SPEC2 §3.5
  moves into `doubles-switch.ts`).
- *Order Up.* After its hit, with Dondozo commanded: `selfBoost` +1 Atk / Def / Spe for Tatsugiri / Tatsugiri-Droopy /
  Tatsugiri-Stretchy (A1's applyBoosts: Contrary, Simple, the cap, the ledger, a foe's Opportunist). Fact `Order Up:
  {Dondozo} +1 Attack.`
- *Dondozo faints.* `presence.onFaint` (from `faint`, `doubles-turn.ts:1218`) clears `commanding` at once: the next
  Update comes before any later action, and a spread move's invulnerability checks ran before its damage (TP1·C2).
  Tatsugiri still has no action.
- *End of turn.* Nothing new: residuals reach it (TP1·C3).
- *E2.* `volatiles` gain "commanding" (Tatsugiri) and "commanded" (Dondozo).
- *Stages.* Dondozo's +2 is in its stages as the input gives them (stages are after entry effects, as for Intimidate);
  the calculator gets a Commander apply action beside Intimidate's (U, §8) that adds the +2 through boost()'s rules.
- *Facts.* Calculator only (derived, not carried): turn fact `Assumes {Tatsugiri} went inside {Dondozo} as they came in.`
- *Removed.* `notIn2v2("Commander")` (`doubles-turn.ts:782`). R keeps it for a mid-turn newcomer pair (SPEC2 §4.8).

**Cases.** Commander is SV-only: T2P-CMD-01-sv (C1: single and spread at Tatsugiri), -02-sv (C2), -03-sv (C3 with C7's
Icy Wind), -04-sv (C4 Droopy), -05-sv (C5 Roar and Dragon Tail), -06-sv (C6: gas, Tatsugiri acts), -07-sv (E2 outcomes).

### 2.2 Poison Puppeteer (SV)

**Showdown.** `PS/data/abilities.ts:3357-3368`: after a status lands (`onAnyAfterSetStatus`), if its source is the holder
(base species Pecharunt), the target is not the holder, the effect is a Move and the status is psn or tox, the target gets
a fresh confusion (`addVolatile`: Own Tempo and Misty Terrain stop it; an existing confusion stays). Pecharunt's only
certain poisoners in SV are Toxic and Poison Gas (its damaging moves' poison is 50 % at most: catalog probe), so under
the hit rule the hook is the status pipeline's.

**Model.** `presence.afterSetStatus(kernel, w, target, status, source)` called at the end of `doubles-status.ts
setStatus` (status moves; a reflected Toxic's source is the reflector). With the conditions above: the confusion branch
of `volatile("confusion")` (`doubles-status.ts:1512-1519`) without its Safeguard check (the status already passed it),
then the action's Update cures it with Persim or Lum as today. Hit fact `Poison Puppeteer: {Name} becomes confused.`
Removed: `poisonpuppeteer` from `PRESENCE_THIRD_PARTY` (`doubles-actions.ts:231-233`). A rainbow (§3.17) could make
Malignant Chain's 50 % certain: that case is the rainbow's reason.

**Cases.** SV-only: T2P-PUP-01-sv (P1: the later mover's confusion check branches), -02-sv (P2), -03-sv (P3), -04-sv (P4),
-05-sv (P5 into its own ally).

### 2.3 Dancer (SV, USUM)

**Showdown.** `PS/sim/battle-actions.ts:317-345`, after the dance's AfterMove (`:310-311`, so after White Herb,
Opportunist and Eject Pack's onAnyAfterMove): when the move has the dance flag, `moveDidSomething` and is not itself an
external use, every other active Dancer holder (`hasAbility`: not suppressed) that is not semi-invulnerable copies it, in
ascending stored Speed (`storedStats.spe`: after Speed Swap and Power Trick, before stages and items), equal stored Speed
newest ability state first (`b.abilityState.effectOrder - a.abilityState.effectOrder`). The battle-over check runs before
each; a fainted Dancer is skipped. Target: the dance's last target if that is not the Dancer's ally and the user is,
else the user (`:337-340`). Each copy is `runMove(…, { externalMove: true })`: BeforeMove runs (sleep counts down,
paralysis, flinch, confusion, Taunt: TP1·D4, D6, D8), no PP, no `moveUsed` (the Dancer's last move is unchanged), no
lock (Petal Dance: `:294-295`, `:346`), `lastSuccessfulMoveThisTurn` set after it.

**Model.** `presence.afterAction(kernel, w, action)` at the end of `runMove` (`doubles-turn.ts:1055`, after eventGuards):
- "Did something" (`World.didSomething`, §9.3) and the dance flag (`DANCE_MOVES`); the copy itself is never copied.
- Dancers in order: stored Speed from `kernel.buildStats(build).spe` (SPEC2's storedStats included); a tie reads the entry
  order (§3.18, newest first); unknown → `Dancer needs whether {A} or {B} came in first.`
- For each: `kernel.externalUse(w, { index: extra, slot, moveId: dance, target, fractional: 0, external: true })` →
  `beforeMove` then `runMove`; no `moved`, no position statistics, no `vol.usedMove`, no lock.
- Its target: §above; a random-target dance (Petal Dance) picks among foes as the turn does.
- *Statistics.* Each copy is its own step (`DoublesStep.copied: "Dancer"`, step fact `Dancer: {Name} copies {Move}.`),
  keyed `dancer:{slot}:{dance action index}`.
- *Interactions.* A copy can trigger a foe's Opportunist (its rise), the copied Fiery Dance hits normally; the copy sets
  Fusion's and Copycat's memories (§3.6, §3.10).
- Removed: `notModelled("Dancer")` (`doubles-turn.ts:795`).

**Cases.** T2P-DAN-01-sv (D1), -02-usum (D1), -03-sv (D2), -04-sv (D3), -05-sv (D4 paralysis), -06-usum (D6 sleep counter
twice), -07-sv (D5), -08-usum (D7 Teeter Dance), -09-sv (D8 Taunt), -10-sv (equal stored Speed with `entryOrder`).

---

## 3. Presence moves and calling moves

### 3.1 Spotlight (USUM)

**Showdown.** `PS/data/moves.ts:17764-17795`: priority 3, protect and reflectable, on any adjacent Pokémon; its volatile
redirects the moves of the target's foes to it (`onFoeRedirectTargetPriority: 2`). TP1·S1–S4.

**Model.** `presence.statusMove` (a dispatcher Step 0 inserts at the top of `doubles-status.ts statusMove`, before the
Sleep Talk branch at `:762`): Spotlight goes through `runUse`'s targeting and A3's Magic Coat / Magic Bounce reflection
(the reflected use lands on its user), the Protect family, then sets `mon.centre = "spotlight"` on the target. The
existing `redirection` (`doubles-turn.ts:1335`, CENTRES priority 2) does the rest. Step fact `Spotlight: {Name} is the
centre of attention.` Removed from `PRESENCE_MOVES`.

**Cases.** T2P-SPL-01-usum (S1), -02-usum (S2 with S3's Follow Me), -03-usum (S4 Magic Bounce).

### 3.2 Round (all four)

**Showdown.** `PS/data/moves.ts:15499-15524`: Round's `onTry` (after TryMove, before PrepareHit) pulls the first queued
Round action in queue order (not Z or Max; a fainted Pokémon's included: TP5·E4) to move next (`prioritizeAction`, order
3, `PS/sim/battle-queue.ts:277-287`) with source Round, which then has 120 power (`basePowerCallback`). Each pulled Round
pulls the next (TP1·R3). A first Round stopped at BeforeMove pulls nothing (TP1·R5).

**Model.** `presence.tryMove(kernel, w, action, move, info)` called in `damagingMove` after `moveFailure` (`doubles-turn.ts
:1823`): the first queued Round among `w.remaining` in sort order (`keyOf`; equal keys: one world each, 1/k, as the
shuffled queue leaves them), fainted users included → `kernel.prioritize(w, it, "round")`. `contextFor` sets
`MoveContext.basePower = 120` for an action with source "round" (§9.5). Step fact `Round: {Name} moves next.` Removed
from `PRESENCE_MOVES`.

**Cases.** T2P-RND-01-sv (R1), -02-champions (R2 a foe's Round), -03-sv (R3), -04-swsh (R5 paralysis), -05-usum (gen 7's
frozen order: the pulled Round first), -06-sv (E4 a fainted Round pulled).

### 3.3 Beak Blast (SV, Champions, USUM)

**Showdown.** `PS/data/moves.ts:1119-1146`: `priorityChargeCallback` adds `beakblast` at the turn's start to every user
whose action is the move (not its Z or Max: as Focus Punch); while it stands, any contact hit into it calls
`source.trySetStatus('brn', holder)` (contact by `checkMoveMakesContact`: Long Reach, Protective Pads, Punching Glove);
it ends at its own AfterMove, or at the end of turn when the move never ran (TP1·K2). The burn lands between the hits
of a multi-hit move (TP1·K3, TP3·FU7).

**Model.**
- `presence.turnStart(kernel, w)` (after `turnStartUpdate`, `doubles-turn.ts:923`): `vol.beakBlast = true` on each such
  user.
- `presence.afterHit` (from `afterHit`, `doubles-turn.ts:2304`): a landed contact hit into a heating holder →
  `kernel.giveStatus(w, attacker, "brn", holder)` (its immunities, Safeguard, Misty Terrain, Synchronize back).
- Its own AfterMove (`runMove` end) deletes the volatile; nothing else does before the end of turn.
- *Kept:* a multi-hit contact move into a heating holder whose burn would land (`giveStatus` would set it): the pairwise
  step cannot change the attacker between hits → `REASONS.intoBeakBlast(move, name)`: `{Move} into {Name}'s Beak Blast
  is not modelled in 2v2.`
- Hit fact `Beak Blast: {Attacker} is burned.` Removed from `PRESENCE_MOVES`.

**Cases.** T2P-BKB-01-sv (K1), -02-champions (K2 with Dragon Tail), -03-usum (a Synchronize attacker), -04-sv (K3: the
reason).

### 3.4 Shell Trap (SwSh, USUM)

**Showdown.** `PS/data/moves.ts:16277-16312`: `shelltrap` at the turn's start; a physical hit from a non-ally on the
Pokémon (its Hit event: not a Substitute's) sets `gotHit` and, if its action is still queued, prioritises it; at its own
TryMove it fails without `gotHit` (TP1·K4–K7).

**Model.** `presence.turnStart` sets `vol.shellTrap = { hit: false }`; `presence.afterHit` on a landed physical hit
(the used category: Shell Side Arm, Photon Geyser follow the calculation's `effectiveCategory`) from a foe → `hit: true`
and `kernel.prioritize` of its queued action (step fact `Shell Trap: {Name} moves next.`); `presence.tryMove` fails it
otherwise: step fact `Shell Trap fails: {Name} took no physical hit.` Instruct fails on it (§3.13). Removed from
`PRESENCE_MOVES`.

**Cases.** T2P-STP-01-usum (K4), -02-swsh (K7), -03-usum (K5), -04-swsh (K6 Substitute).

### 3.5 Beat Up (all four)

**Showdown.** `PS/data/moves.ts:1150-1172`: one hit per `side.pokemon` member that is the user or alive with no status,
in side order (the two in place by position, then the bench), each `5 + floor(base Atk / 10)` of that member's set
species, the user's Attack. TP2·BU1–BU3.

**Model.** The pairwise step already runs Beat Up from `MoveContext.party` (`count-moves.ts beatUpPlan`).
- *Wave 1:* `contextFor` builds the party per world: the partner if alive with no status at the use (its team species),
  then the members of the input's `party` context other than the partner's species (the bench as the user gave it),
  in side order (an Ally Switch swaps the first two).
- *Wave 2 (R):* the bench from `DoublesTurnInput.bench` (alive, no status) in roster order; the context's party is not
  read.
- Step fact `Beat Up: {n} hits ({Names}).` The 1v1 row's `Beat Up into {X}: not calculated.` stays (an engine limit).
- Removed from `PRESENCE_MOVES`.

**Cases.** T2P-BTU-01-sv (BU1), -02-champions (BU3 Justified), -03-swsh (the partner badly poisoned first: one hit fewer),
-04-usum.

### 3.6 Fusion Bolt and Fusion Flare (SV, SwSh, USUM)

**Showdown.** `PS/data/moves.ts:6354-6390`: 2x power (`chainModify(2)` on the base power) when
`lastSuccessfulMoveThisTurn` is the other move. That field is set after every `runMove` that reached `useMove`
(`PS/sim/battle-actions.ts:308`): the active move's id when it did something, else null; a runMove stopped at
BeforeMove, Focus Punch's callback or PP leaves it; it is null at the turn's start (`PS/sim/battle.ts:1625`).

**Model.** `World.lastSuccessful` (only with a Fusion user in the turn): written at the end of `runMove` (and of each
external or called use) from `World.didSomething`: the move as used (its Z-Move's or Max Move's id, a called move's id);
an action stopped in BeforeMove writes nothing; No move that passes BeforeMove writes null (it is Splash in the oracle:
TP1·F2). `contextFor`: Fusion Bolt after "fusionflare" (and the reverse) → `MoveContext.powerMods = [8192]` (§9.5). Hit
fact `Fusion Bolt: 2x power after Fusion Flare.` Removed from `PRESENCE_MOVES`.

**Cases.** T2P-FUS-01-sv (F1), -02-sv (F2 Splash between), -03-swsh (F4 blocked Flare), -04-usum (FU5 paralysed between),
-05-sv (F6 KO), -06-swsh (F3b failed Swords Dance between).

### 3.7 Counter, Mirror Coat, Metal Burst, Comeuppance (all four; Comeuppance SV and Champions)

**Showdown.** Counter (`PS/data/moves.ts:2987-3030`) and Mirror Coat (`:11984-12025`): a volatile from the turn's start
whose `onDamagingHit` records, for each physical (special) hit from a non-ally, the attacker's slot and `2 × damage` (the
hit's own damage: the last hit of a multi-hit move: TP2·C2); the move fails with nothing recorded; its damage is that
value (`|| 1`); it is aimed at the recorded slot's Pokémon now (TP2·C12) by its own redirect at priority −1, below Follow
Me's (TP2·C4). Metal Burst (`:11656-11685`) and Comeuppance (`:2681-2710`): the last `attackedBy` entry from a non-ally
this turn (`PS/sim/pokemon.ts:917-942`, recorded after the hit loop with the last hit's damage:
`PS/sim/battle-actions.ts:950-996`), `floor(1.5 × damage)` (TP3·FU4), at that slot. A hit into a Substitute or one
Disguise took records nothing they can use (TP2·C11, TP5·E2). Damage callbacks skip every modifier
(`PS/sim/battle-actions.ts getDamage`): no STAB, no type multiplier, no item or ability modifier, no Berry; the type
immunity, Wonder Guard, protection, Sturdy, Focus Sash, Focus Band, Endure, a Substitute and Disguise still act;
contact retaliation acts (Counter, Comeuppance). With the recorded Pokémon fainted: no target (TP5·E1). Parental Bond
hits twice for the full amount (TP5·E3).

**Model.**
- *Step 0b:* `UsesEnv.report.lastHit` makes `turnStep` give each outcome `lastHit: { damage, category }` — the damage
  of the move's last hit on the Pokémon (not its Substitute), with the used category.
- *Kernel (Step 0a):* while a Pokémon has one of the four queued (`presence.tracksHits`), `applyStep` (and D's
  `fixedHit`, the face and Substitute paths) write `MonState.taken = { physical?, special?, any? }`, each
  `{ from: positionOf(attacker), damage }`, for hits from foes. Outcome classes split by `lastHit` (a discrete world field).
- *The move:* `presence.aim` (before `resolveTargets` in `damagingMove`, `doubles-turn.ts:1805`): nothing recorded → step
  fact `Counter fails: {Name} took no physical hit.` (Mirror Coat: special; Metal Burst, Comeuppance: `took no damage
  from a foe this turn`); else the aimed target is `occupant(w, from)`, then the centres' redirection (Follow Me, Rage
  Powder, Spotlight); a fainted one: `{Move} fails: no target.`
- *The damage:* D's `fixedHit(w, action, info, target, amount)` (SPEC2 §4.5, F4 §4.6 step 6), extended by D with
  Sturdy's onDamage at full HP (not only the OHKO immunity) and contact retaliation; the type immunity (Counter into
  Ghost, Mirror Coat into Dark) and Wonder Guard before it. Parental Bond: two `fixedHit`s of the same amount, the
  first's Update between them.
- Hit facts: `{Move}: twice the {n} HP {Name} took.` / `1.5 times the {n} HP {Name} took.` Removed from `PRESENCE_MOVES`.

**Cases.** T2P-CTR-01-sv (C1 all rolls), -02-champions (Mirror Coat), -03-sv (C2 last hit), -04-sv (C3 the later
attacker), -05-champions (C4 Follow Me), -06-sv (FU4 Metal Burst rounding), -07-champions (C8 Comeuppance), -08-usum
(C10 immunities), -09-sv (C12 Ally Switch), -10-usum (E3 Parental Bond), -11-sv (E1 no target), -12-swsh (C11 Substitute),
-13-sv (E2 Disguise).

### 3.8 Flame Burst (USUM)

**Showdown.** `PS/data/moves.ts:5564-5585`: on the hit (`onHit`) or a Substitute's (`onAfterSubDamage`), each adjacent
ally of the target loses `baseMaxhp / 16` (at least 1) from a condition (Magic Guard stops it). TP1·B1–B5.

**Model.** `presence.afterHit` on a landed or Substitute hit: `kernel.afterLoss(w, partnerOfTarget, max(1,
floor(baseMaxHP / 16)))` unless Magic Guard (the target's partner is the user when it hits its own ally: TP1·B4); loss
fact `{Name} loses {n} HP (Flame Burst).` Absorbed, blocked or immune: none. Removed from `PRESENCE_MOVES`.

**Cases.** T2P-FLB-01-usum (B1 Sitrus), -02-usum (B2b Substitute, Magic Guard), -03-usum (B4).

### 3.9 Nature Power (SwSh, USUM)

**Showdown.** `PS/data/moves.ts:12599-12623` (and `PS/data/mods/gen8/moves.ts` flags): its TryHit calls Thunderbolt,
Energy Ball, Moonblast, Psychic or Tri Attack by the field's terrain at its target (`useMove`, `PS/sim/battle-actions.ts
:376-470`: the called move takes the caller's priority and Prankster flag, then its own TryMove, PrepareHit and hits,
redirection again). Nature Power's own Prankster check against a Dark type comes first (TP2·N3).

**Model.** `calling.statusMove` (P's second module, same dispatcher): Nature Power through its targeting and immunities,
then `kernel.useCalled(w, action, terrainMove, { target, priority: its priority, prankster })`. The step's
`effectiveName` / `effectiveType` are the called move's (as for a Z-Move). Removed from `CALLING_MOVES`.

**Cases.** T2P-NAT-01-swsh (N1, N2 Lightning Rod), -02-usum (N1 Psychic Terrain), -03-usum (N1 no terrain, N3).

### 3.10 Copycat (all four)

**Showdown.** `PS/data/moves.ts:2849-2868`: `this.lastMove` — the active move at the end of the last action that was not
stopped (`PS/sim/battle.ts:376-385 clearActiveMove`): this turn's, or last turn's last when Copycat moves first (TP3·FU2);
a Max Move's base move; fails for failcopycat moves (the Protect family) and Z-Moves; the called move has no chosen
target (`getRandomTarget`, `PS/sim/battle.ts:2490-2520`: a single-target move at a random adjacent foe, TP2·CC1).

**Model.** `World.lastMove` (only with a Copycat user in the turn), written at each action's end that was not stopped in
BeforeMove (the called move for a caller, the copy for a Dancer's action). Before any such action it reads the new input
`DoublesTurnInput.lastMoveUsed` (absent → `Copycat needs the last move used before this turn.`; null → fails `Copycat
fails: no move has been used.`). Called through `kernel.useCalled` with a random target (one world per adjacent foe).
Step fact `Copycat calls {Move}.` Removed from `CALLING_MOVES`.

**Cases.** T2P-CPY-01-sv (CC1), -02-champions (FU2 with `lastMoveUsed`), -03-sv (CC3), -04-swsh (CC4), -05-usum.

### 3.11 Mirror Move (USUM)

**Showdown.** `PS/data/moves.ts:12028-12045`: the target's `lastMove` (its `moveUsed`: this turn's or an earlier turn's;
TP2·MM2) if it has the mirror flag and is not a Z-Move or Max Move, at the target.

**Model.** The target's `vol.usedMove` this turn (SPEC2 keeps it while a reader is in the turn: Mirror Move joins
`readsLastMove`), else `DoublesPokemonInput.lastMove` (Q3: Unknown keeps `Mirror Move needs {Name}'s move from the last
turn.`); `kernel.useCalled` at the target. Removed from `CALLING_MOVES`.

**Cases.** T2P-MIR-01-usum (MM1), -02-usum (MM2 from the input).

### 3.12 Me First (USUM)

**Showdown.** `PS/data/moves.ts:11528-11560`: the target's queued move if it is a damaging move (not Z, Max, failmefirst;
no Must Recharge), used by the user at the target with 1.5x power (`onBasePowerPriority 12`); spread moves stay spread
(TP2·MF2).

**Model.** `calling.statusMove`: the target's pending action in `w.remaining`; `kernel.useCalled(w, action, its move,
{ target })` with `MoveContext.powerMods = [6144]`. Failure texts `Me First fails: {Name} has moved.`, `Me First fails:
{Name}'s move is not an attack.` Removed from `CALLING_MOVES`.

**Cases.** T2P-MEF-01-usum (MF1 and MF1c), -02-usum (MF2).

### 3.13 Instruct (all four)

**Showdown.** `PS/data/moves.ts:9642-9672`: fails with no last move, Dynamax, a Z-Move, Max Move, failinstruct, charge or
recharge move, a Beak Blast, Focus Punch or Shell Trap heat, or no PP; otherwise the target's last move at its last
target location is prioritised as a new action (`PS/sim/battle-queue.ts:277`), a full runMove (BeforeMove, PP,
moveUsed). A target that has not moved keeps its own action after it (TP3·FU3); a fainted target location retargets
(TP2·I4).

**Model.** `calling.statusMove`: the last move is `vol.usedMove` (this turn) else `lastMove` (input; Q3), its target
`vol.usedTarget` (a new MoveVolatiles field kept with `usedMove`) else the new input `DoublesPokemonInput.lastMoveTarget`
(absent for a single-target move → `Instruct needs the target of {Name}'s last move.`); `kernel.insertAction(w, {
index: extra, slot: target, moveId, target, fractional: 0, source: "instruct" })` then `kernel.prioritize`. Its step is
the target's second step (`DoublesStep.copied: "Instruct"`, step fact `Instruct: {Name} uses {Move} again.`). Turn fact
`Assumes {Name}'s {Move} has PP left.` `MonState.moved`'s readers that mean "has no action left" (flinch: `doubles-turn.ts
:2397`) read `w.remaining` instead. Removed from `CALLING_MOVES`.

**Cases.** T2P-INS-01-sv (I1), -02-champions (FU3 earlier turn's Earthquake), -03-swsh (I3), -04-champions (I4), -05-usum
(`lastMoveTarget` given).

### 3.14 Sleep Talk, Assist, Metronome

**Sleep Talk** (all four; `PS/data/moves.ts:16867-16900`): asleep or Comatose, uniform over its moves but nosleeptalk and
charge moves, Z-Moves with power, Max Moves; the called move at a random target (TP2·ST1–ST2). Model: the existing
sleep branch (`doubles-status.ts:763-767`, `wakeChance` worlds) then one world per callable move (`DoublesPokemonInput.moves`,
which SPEC2's U passes for every Pokémon; absent → `Sleep Talk needs {Name}'s moves.` through a generalised
`REASONS.needsMoves(move, name)`), each through `kernel.useCalled` with the random-target worlds. Step fact `Sleep Talk calls
{Move}.` Removed: the Sleep Talk `notIn2v2` sites (`doubles-status.ts:460, 764`; `doubles-turn.ts:801`). The Uproar
interaction is tier2-moves'.

**Assist** (USUM; `PS/data/moves.ts:608-640`): uniform over every move of the other party members (TP2·AS1). Wave 1:
`Assist needs the moves of {Name}'s party.`; wave 2: R's bench entries carry their moves, and Assist is modelled as Sleep
Talk is (R-E, from `doubles-calling.ts`).

**Metronome** (SV, SwSh, USUM): **kept**, `Metronome is not modelled in 2v2.` Justification (TP2·ME1): a uniform pick over
553–607 moves, 366–402 of them damaging, needs a calculation per damaging move and target; the turn's budget is 160
calculations, so the turn would end "Too many cases to follow." every time. The explicit text says the same more
precisely.

### 3.15 The calling machinery (kernel)

- `kernel.useCalled(w, action, moveId, opts)`: damaging → `damagingMove(ctx, w, { ...action, moveId, target, called:
  opts })` with `priorityOf` replaced by `opts.priority` (Quick Guard, Psychic Terrain and the priority shields read it:
  `PS/sim/battle-actions.ts:408-411`) and no BeforeMove; status → `statusHooks.runCalledStatus(kernel, w, action, move,
  opts)` (Step 0a: `runStatusMove` with the given move, priority and Prankster flag, the caller's action for statistics).
- Protean: the called move's PrepareHit (the caller's own is skipped: `CALLING_MOVES` in `proteanGuard`).
- Encore and Disable read the caller (`moveUsed` is the caller); Copycat and Fusion read the called move.

### 3.16 Sky Drop (USUM)

**Showdown.** `PS/data/moves.ts:16681-16760`: the charge turn lifts the target (fails on a fainted target, an ally, a
Substitute, 200 kg or more: TP4·SD2); both are semi-invulnerable to all but Gust, Twister, Sky Uppercut, Thunder,
Hurricane, Smack Down and Thousand Arrows; the lifted target's BeforeMove returns null (TP4·SD1); Gravity ends it.

**Model.** On tier2-moves' semi-invulnerable state (`eot.hidden`): P sets `eot.hidden = "skydrop"` on the user and
`eot.lifted = user` on the target (its hit list as above), the target's BeforeMove skip `Lifted by {User} (Sky Drop).`,
the failures as step facts; E2 volatiles "twoturnmove" and "skydrop". If tier2-moves keeps semi-invulnerable narrow,
Sky Drop keeps `Sky Drop is not modelled in 2v2.` (`PENDING_MOVES`).

**Cases.** T2P-SKD-01-usum (SD1), -02-usum (SD2).

### 3.17 The Pledges (SV, SwSh, USUM)

**Showdown.** `PS/data/moves.ts:5380, 7579, 20519`: at the first Pledge's PrepareHit (after BeforeMove and TryMove), an
active, living ally's queued different Pledge (not Z or Max) is prioritised with this move as its source and this move
stops silently (`-waiting`). The ally's Pledge is then 150 power, with forced STAB, typed and placing a side condition by
the pair (`onModifyMove`): Fire + Grass → Fire, sea of fire on the target's side (residual 5.1: 1/8 to non-Fire types,
4 turns, this one included: TP2·PL1); Grass + Water → Grass, swamp on the target's side (Speed ×0.25 for that side:
TP3·FU1); Water + Fire → Water, rainbow on the user's side (added effects' chances ×2). The side condition needs the
move to hit (TP2·PL6, TP5·E5).

**Model.**
- `presence.prepareHit` (a hook Step 0a inserts at the PrepareHit point of `damagingMove`, before `proteanGuard`,
  `doubles-turn.ts:1827`): the wait (`kernel.prioritize(w, allyAction, move.id)`; step fact `{Move} waits for {Ally}'s
  {Other}.`), then the action ends.
- The ally's action with a Pledge source: `MoveContext.basePower = 150`, `MoveContext.retypeTo` (the pair's type) and
  `MoveContext.forceStab` (§9.5); hit fact `{Other} and {Move} combine: {Type}, 150 power.`
- Side conditions (A3's SideState pattern): `SideState.pledge = { fire?, grass?, water? }` (turns left), set after a hit;
  facts `The sea of fire starts on {side}.`, `A swamp starts on {side}.`, `A rainbow starts on {side}.`
- *Sea of fire:* E's residual key 5.1 (`doubles-eot.ts`, `residuals.ts`): `damage(baseMaxhp / 8)` to non-Fire types, Magic
  Guard none; the countdowns at 26.7–26.9.
- *Swamp:* `SideConditions.swamp` (Step 0b) multiplies Speed by 1024/4096 in `turnSpeed`'s ModifySpe chain; the gen 8+
  re-sort reads it, gen 7's frozen keys do not. A later Gyro Ball or Electro Ball that reads a swamped Speed: the engine's
  own Speed does not have the swamp → `{Move} with the swamp is not modelled in 2v2.`
- *Rainbow:* a later move this turn by that side with an added effect whose doubled chance reaches 100 % (50 %, or 25 %
  with Serene Grace but flinch) → `{Move} with the rainbow is not modelled in 2v2.`; otherwise nothing this turn.
- E2: `DoublesOutcome.sides[side].pledge` (turns left after this turn).
- Removed: `REASONS.pledges` and its site (`doubles-turn.ts:802-807`).

**Cases.** T2P-PLG-01-sv (PL1), -02-swsh (PL2), -03-usum (PL3 gen 7), -04-sv (FU1 the re-sort), -05-sv (PL4 same Pledge),
-06-swsh (PL6 Protect), -07-usum (the first user asleep: no combination).

### 3.18 Redirection ties (all four)

**Showdown.** RedirectTarget handlers sort by `compareRedirectOrder` (`PS/sim/battle.ts:413-419`, no shuffle:
`:788-794`): priority, Speed, then the holder's `abilityState.effectOrder` (lower first), a counter set when the ability
state is created (`PS/sim/battle.ts:3322-3333`): at a switch-in (`PS/sim/battle-actions.ts:142`), a `setAbility`
(`PS/sim/pokemon.ts:1925`: Skill Swap, Role Play, Entrainment, Simple Beam, Worry Seed, Doodle, Trace, Transform,
Imposter, a form change with a new ability: Mega Evolution, Primal Reversion, a Tera form). Two centres tie the same way
(TP3·RT1–RT4, TP4·RT4b–RT5).

**Model.** `DoublesTurnInput.entryOrder?: DoublesSlotId[]` (earliest first; the inputs architect's control; Training from
the belief battle's effectOrders, a replay of public lines). `World.entryOrder` copies it and moves a slot to the end
when its ability state is renewed this turn (A1's `setAbility`, R's newcomers, a Mega Evolution or Tera form this turn:
SPEC2 F4 §4.1's AfterMega point). `presence.breakTie(kernel, w, handlers)` at `doubles-turn.ts:1352` picks the earliest;
with no input → `REASONS.needsEntryOrder(by, a, b)`: `{By} needs whether {A} or {B} came in first.` The start rows keep
their "or" fact when the order is unknown. Removed: the `notIn2v2(found.taken.by)` site (`doubles-turn.ts:1359`).

**Cases.** T2P-RDT-01-sv (RT1 with `entryOrder`), -02-champions (RT4b two Follow Me users), -03-usum (two Storm Drains),
-04-swsh (RT5 re-entered holder), -05-sv (no input: the reason).

---

## 4. The start settle (track S)

Step 0a moves `settleDoublesStart` (`calculate.ts:3152-3306`) verbatim into `doubles-start.ts` (S's file;
`calculate.ts` exports the 1v1 helpers it calls and re-exports `settleDoublesStart`). SPEC2's three start items owned by
D (Imposter at the start, the start Starf, the start copies) move with the file to S.

### 4.0 Start variants

`DoublesSettle.variants?: { weight: number; slots: Record<DoublesSlotId, DoublesStartSlot | null>; facts: string[] }[]`
(weights sum to 1); absent = one settle. `rootWorlds` builds the root worlds of each variant with its weight (the
fractional outcomes inside each); `startRows` runs per variant and gives a row once when every variant agrees, else one
row per variant with `fact: "If {Name}'s Trace copied {Ability}."` (or `"If {First} came in first."`). Products of
variants multiply (Trace × Custap × Download × Starf: at most 2 × 2 × 2 × 5 per pair, the budget's `worlds` bound).

### 4.1 Trace (all four)

**Showdown.** `PS/data/abilities.ts:5118-5150`: at its Start, `sample` over the adjacent foes whose ability has no notrace
flag (TP4·TR5: 1/2 each), then `setAbility` with that ability's Start (Intimidate: TP3·TR3).

**Model.**
- `tracedAbility` given (Training always; the calculator's "Ability Trace copied"): as today.
- Not given, candidates with different abilities: one variant per candidate Pokémon, weight 1/k, each settled with that
  `tracedAbility`. Turn fact `Assumes {Name}'s Trace copied as it came in: {A} from {Foe} or {B} from {Foe2}, 1/2 each.`
- Copying Intimidate (given or in a variant): the settle applies the doubles Intimidate to both foes in Showdown's
  adjacentFoes order with their reactions (`intimidate.ts applyIntimidateToFoes`, as the calculator's button does),
  unless the holder's `copiedIntimidateStored` matches (the 1v1's rule, `calculate.ts:570`; the 2v2 Intimidate button for
  a Trace holder sets it: U, §8); its lines are start facts.
- *Kept:* a variant whose copied ability's Start changes the field or HP as it enters (a weather or terrain setter,
  Hospitality): `Trace copies a random foe's ability.` (the input's field and HP are after entry effects).
- Removed: `Trace copying Intimidate is not modelled in 2v2.` (`calculate.ts:3222`).

**Cases.** T2P-TRC-01-sv (two foes, 1/2), -02-usum, -03-sv (Intimidate with Defiant), -04-swsh (copiedIntimidateStored),
-05-champions.

### 4.2 Two Pokémon acting on one (all four)

**Showdown.** Each start effect reads every active Pokémon: Unnerve and As One (any foe), Cloud Nine and Air Lock (any
Pokémon), the paradox field's setter, the Trace source.

**Model.** Step 0b adds an optional `reads?: SettleReads` to `settleAbilities` and `settleItems` (`calculate.ts:425, 675`;
the 1v1 never passes it, so golden stays byte-equal): `{ weatherNegated?: boolean; unnerved?: boolean;
fieldSetter?: string | null; traceSource?: BattleBuild }`, each replacing the read of `other` for that need. The reads of
`other` in the two functions, all routed: `settleAbilities` `calculate.ts:443` (gas: moot under the 2v2 stand-ins), `:468`
(Ice Face's negator), `:474-481` (the Trace source), `:486-541` (Imposter's target: Q8's foe across), `:544-545`
(Forecast's negator and blocker); `settleItems` `:690` (Klutz), `:696-697` (Unnerve, gas), `:754` (Misty Terrain
grounding), `:802` (the Seeds' and paradox's negator), `:815-816` (Cloud Nine against Booster Energy), `:824` (the field
setter), `:841` (paradoxStat). S computes each from all four (the setter: the one whose Start came first at the lead, by
Speed; a tie as two variants). The representative (`pick`, `calculate.ts:3201-3209`) is then only the "foe across"
default. Removed: `{A} and {B} both act on {C} as the turn starts.`

**Cases.** T2P-TWO-01-sv (Eiscue-Noice in snow beside a Cloud Nine Golduck and facing an Unnerve foe while holding a
Berry), -02-swsh (Castform with Cloud Nine and Unnerve on different foes).

### 4.3 Download at the lead (SV, SwSh, USUM)

**Showdown.** `PS/data/abilities.ts:1017-1031`: the sum over the foes of `getStat('def' / 'spd', false, true)` (stages in,
modifiers out) when Download's Start runs. At the lead the Starts run by priority then Speed: a foe's Dauntless Shield
(priority 0) counts when that foe is faster (TP3·DL1–DL2; TP4·DL4: Download first reads the unboosted Defense and picks
Attack); a Seed (switch-in priority −1) never; a tie is random.

**Model.** S's Download phase computes each foe's Defense and Sp. Def at Download's turn in the lead order: a foe's own
Dauntless Shield in (faster), out (slower), a tie two variants; a transformed foe (Q8's Imposter across) its stats
before or after the transformation by the same order. Lines as the 1v1's (`calculate.ts:600-640`): `{Name}'s Download
raised its {Stat}: it read {Foe}'s Defense after its Dauntless Shield rise (assumes all four led together, {Foe} first:
{a} Speed against {b}).` Removed: `Download is not modelled with {Foe}'s entry boost.` (`calculate.ts:3272, 3275`).

**Cases.** T2P-DWN-01-sv (DL1 slower Download), -02-sv (DL4 faster), -03-swsh (a Speed tie: two variants), -04-usum (an
Electric Seed foe: not counted).

### 4.4 Commander's start

The commanding pair (§2.1) is derived in the settle: `DoublesStartSlot.commanding?: DoublesSlotId`.

### 4.5 Custap Berry with Quick Draw or Mycelium Might (SV, SwSh)

**Showdown.** `PS/sim/battle-queue.ts:249`: FractionalPriority from 0, Quick Draw and Mycelium Might (priority −1) before
Custap (`PS/data/items.ts:1235-1255`, −2), which eats only while the value is at most 0 and returns early for a
Mycelium Might status move (TP2·CU1–CU2b).

**Model.** S's item phase: Mycelium Might with a status move keeps the Custap (not eaten: item, HP as entered, no
Unburden, no Cheek Pouch heal). Quick Draw with an attack at the Custap's line: two variants, 0.3 (the Berry kept, the
fractional 0.1 "Quick Draw") and 0.7 (eaten, as today); `fractionalOutcomes` (`doubles-turn.ts:753`) reads the variant's
build instead of splitting Quick Draw again for that slot. Removed: `notIn2v2("Custap Berry")` (`doubles-turn.ts:809`).

**Cases.** T2P-CUS-01-sv (CU1), -02-swsh (CU1), -03-sv (CU2), -04-sv (CU2b).

---

## 5. Start Update, field change, activations

### 5.1 Unburden at the turn's first Update (all four; Step 1)

`doubles-status.ts:174` throws for an Unburden holder whose curing Berry is eaten at the first Update. Showdown: Unburden
activates (`PS/data/abilities.ts:5235`), the gen 8+ first sort reads the doubled Speed, gen 7's order is frozen before the
Update (TP4·UB2). Fix: `abilityActive: true` there (as `cureConfusionBerry` does, `:545`). Cases T2P-UNB-01-sv, -02-usum,
-03-champions.

### 5.2 Field change (all four; track FC)

**Showdown.** WeatherChange and TerrainChange run on every active Pokémon in Speed order when the field changes (a move,
an ability's Start or End, a holder of a strong weather or Cloud Nine / Air Lock leaving or fainting, the end of turn):
Protosynthesis (`PS/data/abilities.ts:3513`) and Quark Drive (`:3650`) start with `getBestStat(false, true)` (stages in,
ties Attack, Defense, Sp. Atk, Sp. Def, Speed) or end unless from Booster Energy; Booster Energy (`PS/data/items.ts:622`)
at the next Update after the field is off; Forecast (`:1470`) and Flower Gift (`:1382`) change form by the holder's
effective weather; Mimicry (`:2581`) sets the terrain's type or its own; Ice Face (`:1969`) restores the face in snow or
hail; the Seeds (`PS/data/items.ts:1795, 2591…`) are used. TP3·FC1–FC10, TP4·FC2b–FC12.

**Model.** `doubles-fieldchange.ts`:
- `changed(kernel, w, before: { weather, effective, terrain })`: for each living holder in Speed order, its handler on
  the world build: `abilityActive` / `settledBoostedStat` (Protosynthesis, Quark Drive), `withSpecies` (Forecast, Flower
  Gift, Ice Face; A2's world types follow the species), A2's `setTypes` (Mimicry), the Seed through A3's `useItem` path
  (A1's boost(), Unburden, D's Symbiosis and item history), Booster Energy at the Update that follows.
- Call sites (Step 0a hooks, each with today's guard as the stub): the weather and terrain moves (`fieldMove` in A3's
  `doubles-field.ts`, today's `fieldGuard` at `doubles-status.ts:928-936`); the step's field (`applyStep`,
  `doubles-turn.ts:2119`); `faint` (a strong weather or a Cloud Nine / Air Lock holder); A1's ability Start and End
  (a weather or terrain setter, Cloud Nine); the end of turn (`doubles-eot.ts:307, 524, 1099-1105`).
- Step 0b: `UsesEnv.fieldFollowed: true` turns the step's `staleField` (`uses-to-ko.ts:3141-3156, 3445`) off after the
  move's last hit; between two hits of one move it stays (`A weather or terrain change this turn would change {Name}.`).
- Facts: `Protosynthesis: {Name}'s {Stat} is boosted.`, `Protosynthesis ends on {Name}.`, `{Name}'s Booster Energy is used:
  {Ability} boosts its {Stat}.`, `Forecast: {Name} becomes {Form}.`, `Mimicry: {Name} becomes {Type} type.`, `Mimicry:
  {Name}'s types return.`, `Ice Face: {Name}'s face is restored.`, `Flower Gift: {Name} becomes Cherrim-Sunshine.`,
  `{Seed}: {Name} +1 {Stat}.`
- A3's `boosterAfterRoom` can use `changed`'s Booster Energy path at Magic Room's end (A3's choice).
- Removed: `REASONS.fieldChange` at the move, step and end-of-turn sites but the one between hits.

**Cases.** T2P-FLD-01-sv (FC1), -02-sv (FC2, FC2b), -03-sv (FC3b, FC3c), -04-sv (FC4 with Unburden), -05-sv (FC5), -06-
champions (FC6), -07-champions (FC7), -08-swsh (Flower Gift and Sunny Day), -09-sv (FC12), -10-swsh (Max Flare sun with a
Flower Gift ally), -11-usum (Forecast, Rain Dance).

### 5.3 Activations: Wind Rider, Wind Power, Room Service

**Showdown.** `PS/data/abilities.ts:5527` and `:5509`: Tailwind starting on the holder's side: Wind Rider +1 Attack
(boost on itself), Wind Power the Charge volatile (TP3·AC1–AC2). `PS/data/items.ts:5306`: any pseudo-weather change
while Trick Room is up: the holder uses Room Service, −1 Speed (a self drop: Clear Body does not stop it; TP3·AC3, AC6).

**Model.** FC's `sideStarted(kernel, w, side, "tailwind")` (from A3's `fieldMove`, today's `fieldGuard` at
`doubles-status.ts:937-942`): holders on that side by Speed, `selfBoost` (A1) or `charged = true`; FC's
`pseudoWeatherChanged(kernel, w)` (Trick Room, Gravity, the rooms, the Sports set or ended; A3's Magic Room end): with
Trick Room up, each working Room Service by Speed: A3's `useItem`, `selfBoost(spe −1)`. Facts `Wind Rider: {Name} +1
Attack.`, `Wind Power: {Name} is charged.`, `Room Service: {Name} −1 Speed.` Removed: `REASONS.activates`.

**Cases.** T2P-ACT-01-sv (AC1), -02-sv (AC2), -03-sv (AC3), -04-swsh (Room Service), -05-sv (AC6).

---

## 6. Rows, needs-moves, gas-ends-shield

### 6.1 row-history-moves (`calculate.ts:53-69` HISTORY_MOVES)

The 1v1 rows keep their reasons (golden byte-equal); the 2v2 turn sets a 2v2-only `MoveContext` (§9.5) instead:

| Move | Games | 2v2 model | Earlier-turn input (inputs architect) | Absent |
|---|---|---|---|---|
| Present | sv swsh usum | four worlds: 40 (4/10), 80 (3/10), 120 (1/10), heal round(base max HP / 4) (2/10; through a Substitute, fails at full HP, Ghost immune) (TP3·RW1, TP4·RW8–9; `PS/data/moves.ts:13920`) | — | — |
| Magnitude | usum | seven worlds, power 10–150 at 5/10/20/30/20/10/5 % (`PS/data/moves.ts:10891`; the harness fixes `random(100)`, so the weights are the source's) | — | — |
| Pursuit | usum | 40 power: no switch action exists in the turn; under R a switching target meets it first at 80 (TP3·RW7: R-E) | — | — |
| Retaliate | sv swsh usum | `powerMods [8192]` with a faint on its side last turn (TP3·RW5) | per side "fainted last turn" | the row's reason |
| Fury Cutter | sv swsh usum | 40 × 2^n, at most 160 | consecutive uses before | the row's reason |
| Rollout, Ice Ball | sv swsh usum; usum | 30 × 2^n, ×2 after Defense Curl | the lock's turn, Defense Curl | the row's reason |
| Echoed Voice | sv swsh usum | 40 × m, m = 1 + earlier consecutive turns (at most 5), every use this turn the same (TP3·RW3–4, TP4·RW10; `PS/data/moves.ts:4404-4441`) | turns in a row it was used | the row's reason |
| Trump Card | usum | by PP left after this use | PP left | the row's reason |
| Bide | usum | **kept** for a carried Bide (`Needs the damage stored over earlier turns.`); a first-turn Bide does nothing this turn | — | — |
| Spit Up | all four | SPEC2 A1 (Stockpile) | — | — |

Cases: T2P-ROW-01-sv (Present), -02-swsh (Present's heal into a Substitute), -03-usum (Magnitude), -04-sv (Echoed Voice
input 1), -05-swsh (two Echoed Voices), -06-sv (Retaliate), -07-usum (Pursuit), -08-swsh (Fury Cutter 2), -09-usum (Rollout
with Defense Curl), -10-usum (Trump Card 1 PP).

### 6.2 row-engine-limits and step-stops: kept

Every row-engine-limits text is the 1v1 calculation's own limit for a pair (modifier order, an unverified move, Max Move
types, G-Max, status Z-Moves, Hidden Power IVs, an unchosen hit count, Rivalry genders, Stellar, Z / mechanic errors);
the 2v2 reads the row unchanged under the byte-equal rule. step-stops follows the rows ("A later use cannot be
calculated" and a rerun's own reason); its field part is §5.2's.

### 6.3 needs-moves: kept

`Imprison needs {Name}'s moves.` (`doubles-status.ts:1583-1585`) fires only when an input omits `moves`: the calculator
passes its quick moves for every Pokémon (SPEC2 §5.2) and Training its move slots. It is an exact input-completeness
reason; `REASONS.needsMoves(move, name)` generalises it for Sleep Talk with the same Imprison text.

### 6.4 gas-ends-shield: kept (Q5)

Both texts need the gas stand-ins to change during the turn: they are fixed at the settle (`ctx.gas`, `doubles-turn.ts
:124-125`), and making them per world is Q5's Neutralizing Gas tracking, which the user put LATER. An Ability Shield
lost, or Magic Room starting or ending, changes which ability the gas suppresses from then on with no Start or End event
(`PS/sim/pokemon.ts:858-877 ignoringAbility`): the same per-world stand-ins. Both stay with Q5.

---

## 7. Training (Champions)

What applies in Champions: Round, Beak Blast, Beat Up, the Counter family, Comeuppance, Copycat, Instruct, Sleep Talk,
Trace, the redirection ties, Unburden, Forecast, Mimicry, the Seeds, Quick Draw (no Custap). Public sources only:

- `entryOrder`: the belief battle's actives ordered by `abilityState.effectOrder` (it replays the public switch and
  ability lines).
- `lastMoveUsed`: the belief battle's `battle.lastMove`; `lastMoveTarget`: the tracker's last move line target.
- `moves` for Sleep Talk: the AI's own move slots; the player's only when all are revealed (else the narrow reason).
- Beat Up's party: the AI's bench exactly; the player's bench from team preview with public statuses.
- `carried.commanding` / Dondozo's: not in Champions (no Commander); the bridge maps "commanding" and "commanded" for
  SV-format Training builds if they ever come.
- `IGNORED_VOLATILES`: "beakblast", "shelltrap" stay ignored (one turn).
- The bridge's rollout reasons for the calling moves (`{id} is not modelled.`) go for Copycat, Instruct and Sleep Talk.

---

## 8. UI (2v2 only)

- Steps: `DoublesStep.copied?: "Dancer" | "Instruct"` renders as a second step of that Pokémon in turn order.
- Controls (the inputs architect's design, compact, shown only where read): Came in first (redirect and Dancer ties),
  Last move before this turn (Copycat), Last move's target (Instruct), Fainted last turn (Retaliate), Uses in a row (Fury
  Cutter, Rollout, Ice Ball, Echoed Voice), Defense Curl (Rollout, Ice Ball), PP left (Trump Card). Every default
  Unknown (Q3/Q4).
- Apply actions beside Intimidate's (`doubles-prep.ts:609-631`): Commander (+2 ×5 to Dondozo through boost()'s rules)
  and Intimidate for a Trace holder that copied it (sets `copiedIntimidateStored`).
- Facts as listed in §2–§5; names from `kernel.names`, sides as "your side" / "the opponent's side".

---

## 9. Contract deltas (Step 0; every field optional and unset by any 1v1 path)

### 9.1 `doubles-types.ts`

```ts
// DoublesTurnInput:
  /** The order the Pokémon in place came in (Showdown abilityState.effectOrder), earliest first. Absent: unknown. */
  entryOrder?: DoublesSlotId[];
  /** The last move used in the battle before this turn (Copycat); null: none; absent: unknown. */
  lastMoveUsed?: string | null;
  /** Per side: a Pokémon of that side fainted last turn (Retaliate). Absent: unknown. */
  faintedLastTurn?: Partial<Record<DoublesSideId, boolean>>;
  /** Consecutive earlier turns with an Echoed Voice (0-4). Absent: unknown. */
  echoedVoiceTurns?: number;
// DoublesPokemonInput:
  /** The target its lastMove was aimed at (Instruct); null: none chosen. Absent: unknown. */
  lastMoveTarget?: DoublesSlotId | null;
// DoublesCarried:
  commanding?: true;                 // Tatsugiri inside its ally Dondozo (Training)
  furyCutter?: 1 | 2 | 3 | 4;        // consecutive earlier uses
  rollout?: { turn: 1 | 2 | 3 | 4 }; defenseCurl?: true;
  ppLeft?: Record<string, number>;   // Trump Card
// DoublesStep:
  copied?: "Dancer" | "Instruct";
// DoublesOutcome.sides[side]: pledge?: Partial<Record<"fire" | "grass" | "water", number>>;
// DoublesOutcomeMon.volatiles gains "commanding", "commanded" (and Sky Drop's "twoturnmove", "skydrop").
```

Issues: `entryOrder` not a permutation of the present slots (`"The entry order lists each Pokémon once."`);
`lastMoveTarget` not a slot of the turn; `echoedVoiceTurns` outside 0–4; `furyCutter`, `rollout` without the move in its
moves; `commanding` on a Pokémon that is not Tatsugiri beside Dondozo.

### 9.2 `doubles-world.ts`

```ts
// MonState:
  commanding?: DoublesSlotId; commanded?: DoublesSlotId;
  /** The last hits from foes this turn (Counter family; only while one of them is queued on it). */
  taken?: Partial<Record<"physical" | "special" | "any", { from: DoublesSlotId; damage: number }>>;
// MoveVolatiles:
  beakBlast?: true; shellTrap?: { hit: boolean }; usedTarget?: DoublesSlotId;
// PendingAction:
  /** Showdown action.sourceEffect: a pulled Round, the Pledge that waited, an instructed move. */
  source?: string;
  /** A Dancer's copy (runMove externalMove). */
  external?: true;
// World:
  didSomething?: true; lastSuccessful?: string | null; lastMove?: string | null; entryOrder?: DoublesSlotId[];
// SideState:
  pledge?: Partial<Record<"fire" | "grass" | "water", number>>;
```

### 9.3 Kernel (Step 0a, `doubles-turn.ts`)

`TurnKernel` gains `prioritize`, `insertAction`, `externalUse`, `useCalled`, `extraStep(key, slot, moveId)`; the hook calls:

| Site at `4008ee8` | Hook | Stub |
|---|---|---|
| `presenceGuards` (`:774-818`) | `presence.presenceGuards` (the guards moved verbatim) | today's |
| `rootWorlds` (`:893`) | `presence.rootActions`, `start.variants` | all actions; one settle |
| `fractionalOutcomes` (`:753`) | the variant's Custap build | today's |
| `walk` after `turnStartUpdate` (`:923`) | `presence.turnStart` (Beak Blast, Shell Trap) | no-op |
| `runMove` end (`:1074-1080`) | `presence.afterAction` (Dancer, Fusion and Copycat memories) | no-op |
| `statusMove` top (`doubles-status.ts:741`) | `presence.statusMove`, `calling.statusMove` | null (today's Sleep Talk branch moved into `calling`) |
| `damagingMove` before `resolveTargets` (`:1805`) | `presence.aim` (Counter family) | null |
| `damagingMove` after `moveFailure` (`:1823`) | `presence.tryMove` (Round, Shell Trap) | null |
| `damagingMove` before `proteanGuard` (`:1827`) | `presence.prepareHit` (Pledges) | null |
| `hitChecks` (`:1558`), `targetsOf` / `hitOne` | `presence.invulnerable` (Commander) | false |
| `applyStep` (`:2016`) | `presence.tracksHits` and the `taken` writes | none |
| `afterHit` (`:2304`) | `presence.afterHit` (Beak Blast, Shell Trap, Flame Burst, Order Up) | no-op |
| `faint` (`:1218`) | `presence.onFaint` (Commander) | no-op |
| `redirection` (`:1349-1353`) | `presence.breakTie` | today's tie |
| the switch-out sites (SPEC2 `doubles-switch.ts`) | `presence.cannotLeave` | false |
| `setStatus` end (`doubles-status.ts`) | `presence.afterSetStatus` (Poison Puppeteer) | no-op |
| `fieldGuard` (`doubles-status.ts:928-946`, SPEC2 moves it to `doubles-field.ts`) | `fieldchange.changed`, `fieldchange.sideStarted`, `fieldchange.pseudoWeatherChanged` | today's guards (moved into `doubles-fieldchange.ts`) |
| `applyStep` field (`:2119`), `faint` weather, `doubles-eot.ts:307, 524, 1099` | `fieldchange.changed` | today's guard |
| `contextFor` (`:1500`) | `presence.context` (Round, Fusion, Pledge, Me First, rows) | undefined |
| `doubles-status.ts order()` (`:1822-1831`) | becomes `kernel.prioritize` | same behaviour |
| `calculate.ts settleDoublesStart` | moved to `doubles-start.ts` | verbatim |

### 9.4 Step 0b (`uses-to-ko.ts`, `calculate.ts`)

- `UsesEnv.report.lastHit` and `TurnStepOutcome.lastHit?: { damage: number; category: "Physical" | "Special" }`.
- `UsesEnv.fieldFollowed?: true` (§5.2).
- `settleAbilities` / `settleItems` `reads?: SettleReads` (§4.2).

### 9.5 `types.ts` (MoveContext, 2v2 only; calculate.ts reads them in Step 0b)

```ts
  /** Set only by the 2v2 turn: a base power that replaces the move's (Round 120, a combined Pledge 150, Present, Magnitude, Fury Cutter, Rollout, Ice Ball, Echoed Voice, Trump Card). */
  basePower?: number;
  /** Set only by the 2v2 turn: chained base-power modifiers (Fusion 8192, Me First 6144, Retaliate 8192), as withPowerMods. */
  powerMods?: number[];
  /** Set only by the 2v2 turn: a combined Pledge's type and its forced STAB. */
  retypeTo?: string; forceStab?: true;
  /** Set only by the 2v2 turn: Pursuit with no switching target. */
  switching?: false;
// SideConditions ("Doubles turn only"): swamp?: boolean (Speed x0.25 in turnSpeed).
```

`forceStab`: the attacker's types for that run gain the combined type (the vendored engine reads the attacker's types
only for STAB: `@smogon/calc/dist/mechanics/gen789.js` stab).

---

## 10. REASONS deltas (`doubles-actions.ts`)

Added:

```ts
  needsEntryOrder: (by: string, a: string, b: string) => `${by} needs whether ${a} or ${b} came in first.`,
  needsLastMoveUsed: (move: string) => `${move} needs the last move used before this turn.`,
  needsLastTarget: (move: string, name: string) => `${move} needs the target of ${name}'s last move.`,
  needsParty: (move: string, name: string) => `${move} needs the moves of ${name}'s party.`,
  intoBeakBlast: (move: string, name: string) => `${move} into ${name}'s Beak Blast is not modelled in 2v2.`,
  // needsMoves becomes (move, name) => `${move} needs ${name}'s moves.` (Imprison's text unchanged)
  // SPEC2's combo(move, what) gives "{Move} with the rainbow …", "{Move} with the swamp …", "Counter with Parental Bond …" (unused: modelled)
```

Removed: `pledges`; `notIn2v2` for Commander, Custap Berry, the redirect tie, Sleep Talk; `notModelled("Dancer")`;
`poisonpuppeteer` from `PRESENCE_THIRD_PARTY`; every `PRESENCE_MOVES` entry; `CALLING_MOVES` but Metronome (and Assist in
wave 1); `fieldChange` but between hits; `activates`; the settle's two-act and Download texts and Trace copying
Intimidate; the Unburden start guard. Kept: Metronome's, Sky Drop's (conditional, §3.16), `gasEnds`, `gasShield`,
`needsMoves`, the row and engine-limit texts.

---

## 11. Defaults (no user decision needed)

- Commander in the calculator: derived from the pair with a turn fact (Q8's "as entered, stated as a fact").
- Trace unset: 1/k variants as entered, stated (Q8's rule; the input overrides).
- Download and Dancer ties at the lead: variants or `entryOrder` (exact; Unknown keeps the reason).
- Every new earlier-turn input: Unknown keeps the row's or the new narrow reason (Q3/Q4).

---

## 12. Tracks and file ownership (disjoint from SPEC2 §8.3)

| Track | Owns | Implements | Depends on |
|---|---|---|---|
| P Presence and calling | `app/lib/battle/doubles-presence.ts` (new), `app/lib/battle/doubles-calling.ts` (new), `tests/unit/doubles-presence.test.ts`, `tests/unit/doubles-calling.test.ts` | §2, §3, §6.1's 2v2 contexts | Step 0 hooks; D's `fixedHit` (Counter family); A3's reflection (Spotlight); tier2-moves (Sky Drop); R (Assist) |
| S Start settle | `app/lib/battle/doubles-start.ts` (from D, with SPEC2's start items), `tests/unit/doubles-start.test.ts` | §4 and SPEC2 D's Imposter at the start, start Starf, start copies | Step 0a's move of `settleDoublesStart`; Step 0b's `reads` |
| FC Field change | `app/lib/battle/doubles-fieldchange.ts` (new), `tests/unit/doubles-fieldchange.test.ts` | §5.2, §5.3 | A1 (boost, ability Start/End), A2 (setTypes, withSpecies), A3 (useItem, Magic Room's end), D (Symbiosis, item history) |
| Step 1 | `doubles-status.ts` (frozen after) | §5.1 Unburden | — |
| D (addition) | `doubles-guards.ts` | `fixedHit` with Sturdy's onDamage, retaliation and a hit count | — |
| E (addition) | `doubles-eot.ts`, `residuals.ts` | sea of fire 5.1, the Pledge countdowns, `fieldchange.changed` at the end of turn | P's SideState.pledge |
| U (addition) | its files | §8 controls and apply actions | the inputs architect's design |
| T (addition) | `app/(app)/training/**` | §7 | — |
| V (addition) | `2v2/verify/cases-t2p.ts` (new, wired into `cases-se.ts`), the harness's `entryOrder` (lead order), `lastMoveUsed`, `lastMoveTarget`, bench moves, the row inputs | the T2P cases | — |

---

## 13. Tests

- `doubles-presence.test.ts`: Commander's misses, locks, Order Up and end on a faint; Poison Puppeteer's conditions;
  Dancer's order, target rule, BeforeMove and the no-copy cases; Round's pull (fainted included); Beak Blast's burn and
  its reason; Shell Trap's three outcomes; Beat Up's party per world; Fusion's memory; the Counter family's records,
  aim and amounts; Flame Burst's splash; the Pledges' wait, combination, side conditions and the two reasons; the tie
  break.
- `doubles-calling.test.ts`: each caller's pick, target worlds, inherited priority and Prankster, failures; the new reasons.
- `doubles-start.test.ts`: variants (weights, start rows), Trace and Intimidate, the reads, Download's order, Custap.
- `doubles-fieldchange.test.ts`: each holder's handler per trigger, Speed order, Booster Energy's Update, the between-hits
  reason.
- `tests/source`: every `PRESENCE_MOVES` / `CALLING_MOVES` member is modelled or kept with its listed text; the hooks of
  §9.3 are called where listed.

---

## 14. Risks

1. **Inserted actions** (Dancer, Instruct) add steps per slot to the result and touch every reader of `MonState.moved`
   and `input.pokemon[slot].action`; the hooks' source test lists them, the T2P-DAN and T2P-INS cases pin the order.
2. **The Counter family's world split** by the last hit's damage (≤ 16 values per hit, multi-hit sums aside) adds worlds
   only while a Counter-family user is the hit Pokémon (readers rule); measured at integration on the T2P-CTR cases.
3. **Start variants multiply** root worlds (Trace × Custap × Download × Starf); bounded by the budget's 1 500 worlds.
4. **Field re-settle breadth**: every holder's handler in Speed order at every trigger, through A1, A2, A3 and D's
   helpers; the T2P-FLD cases cover each holder once, both directions.
5. **Calling** reuses `damagingMove` and the status pipeline with an inherited priority: the priority shields, Quick
   Guard and Psychic Terrain read the caller's (T2P-NAT-03, T2P-CPY).
6. **Moving `settleDoublesStart`** out of calculate.ts in Step 0a: verbatim, byte-equal gates (golden, 1264 cases).
7. **Dependencies**: Sky Drop on tier2-moves, the Counter family on D, Assist on R, Spotlight on A3, the swamp's Speed on
   Step 0b's `turnSpeed`.
