# Earlier-turn inputs for the 2v2 turn and Training (status2, INPUTS ARCHITECT)

Design only. Branch `calc-2v2-status-2` (main `4008ee8`); no app code, test or doc changed. This is a delta to SPEC2.md
(section numbers `SPEC2 §n` are its), written for the critic's ADDENDUM2. USER-DECISIONS.md is final: Q1 = R (bench,
replacement, hazards in the calculator and Training), Q2 = "those plus more", Q3 / Q4 = Unknown, Q6 = the Tier 2 guards in
this build, Q12 = the once-a-battle fact.

Ground truth is pinned Showdown `c23d2e94` (`PS/…` = `node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353`).
Files in this folder:

| File | What |
|---|---|
| `inputs-probes-1.ts` → `inputs-probes-1.out` (`.err` empty) | 19 probes `IN-P01`…`IN-P19`, 55 scenarios, each probe with a control; run `npx --no-install tsx scripts/.cache/calc-audit/status2/design/inputs-probes-1.ts` from the repo root (guards-sim.ts harness; IN-P08 fixes the tie shuffles instead of enumerating them) |
| `inputs-probes-usage.ts` → `inputs-probes-usage.out` | per candidate input: catalog carriers in the four games and the Champions usage share of team slots (training-usage.json, as census-usage.ts) |

Names in texts are `kernel.names` / `doublesNames` (doubles-types.ts `nameText`), sides are "your side" / "the opponent's
side", never left or right; labels and texts are facts, no instruction text.

---

## 0. Decisions in one page

1. **One rule for every input.** A control is *shown* when this turn can read it **or when it is set** (so a set value is
   never hidden), its value is *always passed* when set, and its default is the state that makes no guessed number:
   - **"None"** for an ambient state (infatuation, Heal Block, a type change, Mist…): a visible control at None is an input
     like the status select at Healthy, so it states no fact;
   - **"None" with an `Assumes …` turn fact** where this turn's own move reads a history precondition (Stockpile layers for
     Swallow, a charge last turn for a two-turn move, the protect streak for Protect, Destiny Bond last turn…: SPEC2 §2.5's
     pattern, generalised in §6);
   - **"Unknown"** that keeps the narrow reason where "None" would usually be wrong: Last move (Q3), Item used earlier
     (Q4), Entered first, the battle's last move, Retaliate's faint, Echoed Voice's streak, a used Protean's type.
2. **Q2's controls**, per Pokémon in its side's fieldset: `Stockpile` 0–3; `Last move` (Unknown); `Item used earlier`
   (Unknown); `Type`, `Second type`, `Added type`; `Infatuated by`; `Heal Block turns left` (USUM 1–4) / `Heal Block`
   (SV, Champions: Psychic Noise, 1 turn left); `Accuracy stage`, `Evasion stage`; `Berry locked`. Per side: `Mist`,
   `Lucky Chant`. Field: `Mud Sport`, `Water Sport` (USUM).
3. **Further inputs, each because a guard, a family or an existing turn fact reads it** (§2 has the whole inventory):
   - `Protecting moves in a row` / `Ally Switch in a row` (0–6): 71.2 % of Champions team slots carry a protecting move and
     today's `Assumes no protecting move was used last turn.` sits on nearly every turn. The engine branches the stall
     counter exactly (IN-P01; a failed Protect is not No move: IN-P02), which also replaces Training's splits.ts fork.
   - `{Move} charged last turn`: a two-turn move released this turn (5.46 % of Champions slots carry one; IN-P03): no
     charge, and Fly, Bounce, Dig, Dive, Phantom Force and Shadow Force out of reach until the action. Generalises SPEC2's
     `charging: "geomancy"`.
   - `Destiny Bond from last turn` (its volatile, not its last move: IN-P05, IN-C5), `Laser Focus last turn` (SwSh, USUM:
     IN-P04), `Minimized`, `Glaive Rush last turn`, `Tar Shot`, `Foresight`, `Miracle Eye`, `Nightmare`, `Embargo turns left`,
     `Telekinesis turns left` (IN-P06), `Octolock by`, `Power Trick` / `Power Shift`, `No Retreat`, `Battle Bond used`,
     `Berry eaten last turn` (Cud Chew: IN-P09), `{Move} lands` (Future Sight / Doom Desire from a Pokémon in the turn:
     IN-P10).
   - Field: `Weather ends this turn`, `Terrain ends this turn`, `Gravity ends this turn`, `Magic Room ends this turn` (the
     end of turn's existing `Assumes … does not end this turn.` facts become inputs: IN-P07); `Entered first` (a redirect
     tie goes to the older ability state, Follow Me included: IN-P08, IN-C3); `Last move in the battle` (Copycat: IN-P11),
     `Echoed Voice turns in a row` (IN-P13). Per side: `Safeguard`, `Lost a Pokémon last turn` (Retaliate: IN-P12), `No
     Pokémon left to switch in` (today's `Assumes {side} has a Pokémon left to switch in.` becomes an input: the existing
     `canSwitch`, which ends the battle when that side's last Pokémon in play faints).
   - Training only (no calculator control): Taunt, Encore and Disable turns left (IN-P17; E2's value reads taunt and
     encore), the once-a-battle flags, the entry order, the field's turns left.
4. **The status-eot carried fields without a calculator control get one in the same style** (recommended, UI only: the
   engine already models them exactly when carried): `Leech Seed`, `Drowsy`, `Perish count`, `Trapped by`, `Salt Cure`,
   `Syrup Bomb from`, `Aqua Ring`, `Ingrain`, `Cursed`, `Wish lands` (IN-P19 pins their amounts). Perish Song (1.10 % of
   Champions slots), Yawn (0.91 %), partial traps (0.58 %) and Leech Seed (0.34 %) outweigh several Q2 controls.
5. **Not inputs, with the reason** (§2): Throat Chop and Torment (legality only: the request already removes the move;
   nothing else reads them); Trick Room, Wonder Room, the Sports and every side condition's turns left (their end comes at
   orders 26–27, after which nothing of this turn reads them; speeds are fixed at the residual's start,
   `PS/sim/battle.ts:2811-2816`); Dynamax turns left (it ends in `endTurn`, `PS/sim/battle.ts:1622-1640`, after everything
   this turn shows: IN-P14); Truant (the action is the input); the rampage and Uproar locks (Training keeps them as
   today); G-Max side conditions from earlier turns and a Healing Wish waiting at a position (the 2v2 note lists them);
   Commander (its state follows from who is in play; Tier 2 presence decides its fact).
6. **Wave 2 (R):** per side `Bench` (from the slot's roster source; default empty, which keeps today's
   `{Name} switches out: the replacement is not known.`), per switching Pokémon `Replacement` (default: the first bench
   Pokémon with `Assumes {Newcomer} comes in for {Name}.`, Q1), per side `Stealth Rock`, `Spikes` 0–3, `Toxic Spikes`
   0–2, `Sticky Web`, `G-Max Steelsurge` (SwSh), shown only when a Pokémon of that side can come in this turn.
7. **Training** fills every input from public information (§7): the tracker's counts (protect streak, charging, lastMove,
   volatiles' `since`, item history, side and field conditions) and the belief battle's replay of public lines (ability-state
   order, Destiny Bond, Berserk lock, Cud Chew's Berry). Rollouts that go: `{Name}: destinybond is not modelled.`,
   `{Name}: twoturnmove is not modelled.`, `Side effect safeguard is not modelled.`, `Magic Room ending this turn is not
   modelled.`, `{Name}: {ability} was used this stint.` (with SPEC2's types). splits.ts's Protect fork and its
   `… under Gravity while confused: its failing world is not modelled.` go: the engine takes `carried.stall`.
8. **Corrections to SPEC2** (§1.3): IN-C1 Stockpile's counters are −1 per layer that changed the stat, Contrary
   included; IN-C2 Copycat reads the battle's last move, not a Pokémon's; IN-C3 redirect ties (Follow Me and Rage Powder
   too) are the holders' ability-state order; IN-C4 a failed Protect is not No move; IN-C5 Destiny Bond's input is its
   volatile; IN-C6 the type controls must not touch the shared build cache.
9. **Ownership** (§10): new wave-1 tracks **N-E** (`doubles-history.ts`) and **N-U** (`doubles-inputs.ts`,
   `EarlierTurnFields.tsx`, the 2v2 list in `unmodelled-states.ts`); Step 0a gains the contract and kernel hook lines,
   Step 0b one calculation marker, a small Step 0c moves today's carried UI code verbatim into N-U's files; E, T and V get
   listed additions in their own files; R-U takes N-U's files in wave 2.

---

## 1. Ground truth

### 1.1 Probes (`inputs-probes-1.out`)

| Id | Game | Shows (control in brackets) | Decides |
|---|---|---|---|
| IN-P01 | sv, champions | A carried stall counter 3: Protect works 1/3 (fails `-fail`, the Tackle lands 2/3); counter 9: 1/9 [none: certain]. Champions' protect is `inherit` with pp 5 only (`PS/data/mods/champions/moves.ts:733-736`) | `carried.stall`, `Protecting moves in a row` |
| IN-P02 | sv | A confused Garchomp under Gravity with stall 3: confusion runs first (self-hit 0.33), the failed Protect is `move …Protect …[still] / -fail` (0.4467), Protect works 0.2233 [No move: Gravity stops Splash before confusion, no self-hit] | IN-C4: the engine, not a No-move stand-in, takes the failed Protect |
| IN-P03 | sv | Dig charged on turn 1: on turn 2 a faster Night Slash into Garchomp `[miss]`, Dig released `[from] lockedmove`, then Earthquake hits it normally [Dig chosen on turn 2: Night Slash hits, Dig charges] | `carried.charging`, semi-invulnerable from the turn's start |
| IN-P03b | sv | Solar Beam charged on turn 1 releases on turn 2 with no sun: 63 damage. (Its Phantom Force half met a Normal-type target: `-immune`, a type immunity, not a Protect result) | release = the move with no charge |
| IN-P04 | usum, swsh | Laser Focus with 1 turn left: Close Combat `-crit`, a KO; the volatile ends at this residual [none: 206 damage] | `carried.laserFocus`, `BuildBase.laserFocus` |
| IN-P05 | sv | Gengar's Destiny Bond on turn 1 (last to move) still up on turn 2: a faster Weavile KOs it and faints too (`-activate … Destiny Bond`, `faint Weavile`) [Splash on turn 1: Weavile lives]. IN-P05b: a second Destiny Bond with the volatile up fails | `carried.destinyBond` |
| IN-P06 | usum | Telekinesis with 1 turn left ends at 19; Yawn's sleep at 23 meets Electric Terrain (`-activate … Electric Terrain`, no sleep) [2 left: asleep] | `Telekinesis turns left` matters at the end of turn |
| IN-P07 | sv | Misty Terrain with 1 turn left ends (27.7) before Flame Orb (28.3): burned [2 left: not]. Magic Room with 1 left: Flame Orb burns and a Sitrus is eaten at the final Update (+58) [2 left: neither]. Gravity with 1 left under Misty Terrain: the Flying Flame Orb holder is burned [2 left: not] | `Terrain / Gravity / Magic Room ends this turn` |
| IN-P08 | sv | Two equal-Speed Follow Me users: the Tackle goes to the one whose ability state is older (A at the leads); re-making A's ability state hands it to B although A's Follow Me came first. Lightning Rod on both sides: the older holder (p1b at the leads) takes the Thunderbolt; re-made, the foe's does. Both tie-shuffle policies gave the same results | IN-C3: `entryOrder`, `Entered first` |
| IN-P09 | sv | Cud Chew: Sitrus eaten during turn 1's moves (counter 2), turn 1 ends at counter 1, turn 2's 28.2 re-eats it (+48) | `carried.cudChew` = the Berry eaten last turn |
| IN-P10 | sv | Future Sight lands two turns after its use from the user as it is then: +2 Sp. Atk gained after the use counts (162 damage) [no boost: 82]; a user switched out hits with its bench state (82). IN-P10b: a second Future Sight into the pending position fails | `futureMove.user` is a Pokémon, not a snapshot |
| IN-P11 | sv | Copycat on turn 2 calls Shuckle's Splash, the last move used in the battle on turn 1, not its target's Ember or Tackle | IN-C2: `battleLastMove` |
| IN-P12 | sv | Retaliate after its side lost a Pokémon last turn: 90 damage [no faint: 45] | `faintedLastTurn` |
| IN-P13 | sv | Echoed Voice on turn 2 by Sylveon's ally after Sylveon's on turn 1: 37 damage [no Echoed Voice on turn 1: 19] | `echoedVoice` (field-level) |
| IN-P14 | swsh | Dynamax lasts three turns and its HP is scaled back (227/470 → 114/235) only after turn 3's end, in `endTurn` | Dynamax turns left: not an input |
| IN-P15 | sv | Psychic Noise's Heal Block: duration 2, 1 left on the next turn (Leftovers blocked), ends at 20; Leftovers heals on turn 3 | SV / Champions `Heal Block` = 1 turn left |
| IN-P16 | sv | Acupressure with a carried evasion +6 picks among six stats (1/6 each) [evasion 0: seven] | carried stages change a 1/n |
| IN-P17 | sv | Taunt with 1 turn left ends at 15 this turn (`-end … Taunt`); a Taunt into it fails [2 left: stays, 1 after] | `carried.taunt` turns, E2 |
| IN-P18 | sv | Battle Bond: +1 Atk, SpA, Spe on a KO [bondTriggered set: nothing] | `onceUsed` |
| IN-P19 | sv | Leech Seed −29, Salt Cure −29, the drowsy one falls asleep, perish count 1 faints (Snorlax, 235 HP) | §0 item 4's amounts |

Source facts read for this design (beyond SPEC2 §1.1): the stall condition (`PS/data/conditions.ts:439-462`), Protect's
PrepareHit (`PS/data/moves.ts:13973-13978`), Quick Guard and Wide Guard add `stall` too (`:14503-14505`, `:20822-20824`;
the tracker's `PROTECT_FAMILY` already counts them); Destiny Bond (`:3483-3526`: noCopy, removed at the holder's
BeforeMove priority −1 unless the move is Destiny Bond, and on MoveAborted; PrepareHit fails while it stands); Cud Chew
(`PS/data/abilities.ts:742-766`: not for Bug Bite or Pluck; counter 2, 1 when eaten with the queue empty); Future Sight's
slot condition (`PS/data/conditions.ts:379-423`: `endingTurn = turn − 1 + 2`; it hits from `data.source` as it is then);
Taunt duration 3 +1 when the target had moved, order 15; Encore 3 (+1), order 16, ends at PP 0; Disable 5 (−1 when the
target has not moved), order 17; Telekinesis 3, 19; Laser Focus 2, no order (ends with the residual); Throat Chop 2, 22
(`PS/data/moves.ts:18975, 4725, 3649, 19115, 10013, 19390`); `compareRedirectOrder` (`PS/sim/battle.ts:413-419`, used for
fastExit events at `:789-792`); lead ability states made p1a, p1b, p2a, p2b (`:2689-2699` then
`PS/sim/battle-actions.ts:142`); Dancer ties by the newest ability state (`PS/sim/battle-actions.ts:331-333`); the field's
residual orders (Trick Room 27.1, Gravity 27.2, Water Sport 27.3, Mud Sport 27.4, Wonder Room 27.5, Magic Room 27.6,
terrains 27.7) and the sides' (26.x); speeds updated once at the residual's start and used by the final Update
(`PS/sim/battle.ts:2811-2816, 2860-2861`); Dynamax's end in `endTurn` (`:1622-1640`); Stockpile's counters
(`PS/data/moves.ts:17974-18007`, noCopy).

### 1.2 How often (Champions team slots carrying a setter, `inputs-probes-usage.out`)

| Input | Champions | Other games | | Input | Champions | Other games |
|---|---|---|---|---|---|---|
| Protecting moves in a row | 71.18 % | all | | Taunt (Training) | 1.62 % | all |
| Encore (Last move, Training turns) | 4.91 % | all | | Perish count | 1.10 % | all |
| two-turn moves (charged last turn) | 5.46 % | all | | Yawn (Drowsy) | 0.91 % | all |
| accuracy / evasion setters | 4.54 % | all | | Disable | 0.70 % | all |
| Follow Me, Rage Powder (Entered first) | 6.55 % | all | | partial traps | 0.58 % | all |
| Throat Chop (not an input) | 2.16 % | all | | Leech Seed | 0.34 % | all |
| Heal Block (Psychic Noise) | 0.19 % | sv, usum | | Ghost Curse | 0.23 % | all |
| Protean, Libero (type controls) | 0.24 % | all | | Ally Switch in a row | 0.19 % | all |
| Destiny Bond | 0.16 % | all | | Lightning Rod, Storm Drain | 0.17 % | all |
| type setters (Soak…) | 0.16 % | all | | Stockpile family | 0.14 % | all |
| Minimize | 0.08 % | all | | Salt Cure | 0.02 % | sv |
| Berserk, Anger Shell | 0.06 % | all | | Cud Chew | 0.02 % | sv |
| Mist | Past | sv, swsh, usum | | Laser Focus | — | swsh, usum |
| Lucky Chant, the Sports, Embargo, Telekinesis, Nightmare, Foresight, Miracle Eye | — | usum | | Retaliate, Echoed Voice, Rollout family | — | sv, swsh, usum |

### 1.3 Corrections (the design uses these)

| # | Where | Claim | Pinned truth |
|---|---|---|---|
| IN-C1 | SPEC2 §3.1 `stockpile` doc, §5.2 | "−1 per layer that raised the stat, +1 per layer Contrary lowered it"; "counters equal the layers; Contrary −layers" | Each layer whose boost **changed** the stat counts −1, Contrary included (`PS/data/moves.ts:17983-17994`; F1's SA09c: Contrary Shuckle, `def -1, spd -1`; SA09b: at +6 Def the Def count stays 0). Counters are in −layers..0; the End boosts by them (Contrary inverts it back). The calculator passes no counters; the engine takes −layers each with a fact (§6) |
| IN-C2 | census-guards presence-calling, F4 §6 | Copycat reads "World.lastMoveUsed (this turn's, else the input's last-turn move: lastMoveInput)" | It reads the battle's last move by any Pokémon (`this.lastMove`), kept across turns: IN-P11 called Shuckle's Splash. The input is turn-level (`battleLastMove`), not a Pokémon's `lastMove` |
| IN-C3 | census-guards redirect-tie, F4 §6 ("keep: effectOrder, not known"), doubles-turn.ts:1331 | the tie's order is the ability's effectOrder for Lightning Rod and Storm Drain | `compareRedirectOrder` reads the **holders'** ability-state order for every redirect handler, Follow Me and Rage Powder included, with no shuffle (IN-P08). An input (`entryOrder`) makes all of it exact; Training has it exactly from the belief battle |
| IN-C4 | splits.ts:44-58 | a Protect that fails its stall roll is approximated by No move | Not the same turn: No move is Splash, stopped by Gravity before confusion; a failed Protect has passed BeforeMove (IN-P02). The engine branches the roll in the protecting move's PrepareHit |
| IN-C5 | doubles-status.ts:663 fact, SPEC2 §2.5 | Destiny Bond "after a use last turn" | The PrepareHit failure and the carried KO take-down both read the `destinybond` volatile, which ends at the holder's next action attempt (stopped or not). `lastMove === "destinybond"` does not imply it (a sleep turn since removes it and leaves lastMove) |
| IN-C6 | F2 §8 ("Type… writes build.types") | the type controls write the build | The 2v2 slot builds share the roster cache with 1v1 (`roster-prep.ts cacheCombatant`); a `types` there would reach a 1v1 calculation through Step 0b's `makePokemon`. The controls keep their value in the 2v2 state and add it only to the turn input's build (§5.4) |

---

## 2. Inventory: every earlier-turn state and its decision

"C" = a calculator control (§5), "T" = Training passes it (§7), "—" = neither. "Readers" = what in this turn changes with it.

| State | Games | Readers this turn | C | T | Default; fact or reason |
|---|---|---|---|---|---|
| Stockpile layers (+ counters) | all | Stockpile (fails at 3), Swallow, Spit Up; a Snatch user's own (C1 of SPEC2) | yes | yes | 0; SPEC2's `Assumes {Name} has not stockpiled.`; counters absent → `Assumes each of {Name}'s Stockpile layers changed its Defense and Sp. Def.` |
| Last move (a Pokémon's) | all | Disable, Encore, Conversion 2 (SPEC2), Instruct, Mirror Move (presence) | yes | yes (exists) | Unknown; `{Move} needs {Name}'s move from the last turn.` |
| Item used earlier | all | Recycle, Harvest | yes | yes | Unknown; `needsLastItem` |
| Types, added type | all | every calculation into or from it; Protean, Libero, Color Change, Reflect Type, Conversion 2, Synchronoise | yes | yes | its species' own; a used Protean / Libero with no type set: `{Name}'s type after {Ability} is not known.` |
| Infatuated by | all | its BeforeMove 1/2 (SPEC2 A2) | yes | yes | None |
| Heal Block turns left | usum (1–4), sv, champions (1) | every heal; its end at 20 and the final Update's Berries (CR01, IN-P15) | yes | yes | None |
| Accuracy, evasion stages | all | Stored Power, Power Trip, Punishment, Acupressure's pool (IN-P16), Psych Up, Heart Swap, Topsy-Turvy, Spectral Thief, Haze, White Herb, Baton Pass (R) | yes | yes (Step 1 #8) | 0 |
| Berry locked | all | its healing Berry's TryEatItem (SPEC2 D) | yes | yes | off |
| Mist, Lucky Chant (side) | sv swsh usum / usum | drops from others; critical hits into the side | yes | — (not in Champions) | off |
| Mud Sport, Water Sport (field) | usum | Electric / Fire power ×1352/4096 | yes | — | off |
| Safeguard (side) | all | foes' statuses and confusion (SPEC2 A, Tier 2 moves' damaging-status) | yes | yes | off |
| Stall counter | all | its protecting move or Endure works 1/c (IN-P01) | yes | yes (replaces splits.ts) | 0; existing `Assumes no protecting move was used last turn.` |
| Ally Switch counter | sv, champions | its Ally Switch works 1/c (exists) | yes | yes (exists) | 0; existing `Assumes {Name} did not use Ally Switch last turn.` |
| Two-turn move charged last turn | all | the release (no charge; Power Herb kept), out of reach until its action (IN-P03) | yes | yes | off; `Assumes {Name} did not charge {Move} last turn.` |
| Destiny Bond up | all | a foe that KOs it before it acts faints; a Destiny Bond now fails (IN-P05) | yes | yes | off; existing `Assumes {Name} did not use Destiny Bond last turn.` (its move is Destiny Bond) |
| Laser Focus last turn | swsh, usum | every hit it deals is critical (IN-P04) | yes | — | off |
| Minimize | all | the minimize-flag moves ×2 (SPEC2 C6) | yes | yes | off; SPEC2's `Assumes {Name} has not used Minimize.` |
| Glaive Rush last turn | sv, champions | damage into it ×2 until its BeforeMove (SPEC2 C5) | yes | yes | off |
| Tar Shot | sv, swsh | Fire into it +1 effectiveness | yes | — | off |
| Foresight / Odor Sleuth, Miracle Eye | usum | Normal and Fighting into Ghost; Psychic into Dark | yes | — | off |
| Nightmare | usum | residual 11 | yes | — | off |
| Embargo turns left | usum | its item; its end at 21 (CR02) | yes | — | None |
| Telekinesis turns left | usum | Ground moves, grounding at the end of turn (IN-P06) | yes | — | None |
| Octolock source | champions, swsh | residual 14 | yes | yes | None |
| Power Trick / Power Shift | all / champions | its Attack and Defense everywhere | yes | yes | off; SPEC2's fact when its move is Power Trick |
| No Retreat | sv ch swsh | its No Retreat fails | yes | yes | off; SPEC2's fact |
| Gastro Acid | all | its ability | — | yes (SPEC2) | the note lists it |
| Taunt, Encore, Disable turns | all | the same move into it fails (IN-P17); the end of turn's countdown; E2 (value reads taunt and encore) | — (legality) | yes | — |
| Torment, Throat Chop | all | legality only | — | — (kept ignored) | — |
| Once-a-battle (Battle Bond, Intrepid Sword, Dauntless Shield, Supersweet Syrup) | sv, champions (gen 9 rule) | Battle Bond's KO boost (IN-P18), an entry boost gained mid-turn or on entry (Q12, R) | Battle Bond only | yes | unused; Q12's `Assumes {Name} has not had {Ability} before in this battle.` (A1, R) |
| Cud Chew Berry | sv, champions | residual 28.2 (IN-P09) | yes | yes | None (holding a Berry), Unknown with no item: `Cud Chew needs {Name}'s Berry from the last turn.` |
| Future Sight / Doom Desire landing now | all | residual 3 from its user (IN-P10) | yes (users in the turn or, under R, on the bench) | yes (user's slot or belief build) | None |
| Future Sight pending, landing later | all | this turn's Future Sight into that position fails (IN-P10b) | — | yes | — (fact-only difference) |
| Field ends this turn (weather, terrain, Gravity, Magic Room) | all | the end of turn after 27 (IN-P07); the weather's own (exists) | yes | yes | lasts; existing `Assumes the {Weather} does not end this turn.`, `Assumes the {Terrain} Terrain does not end this turn.`, `Assumes Gravity does not end this turn.`, `Assumes Magic Room does not end this turn.` |
| Trick Room, Wonder Room, Sports, side conditions turns left | all | nothing this turn (ends at 26–27; speeds fixed at the residual's start) | — | — (nextClock has them) | — |
| Entry order | all | redirect ties (IN-P08), Dancer ties, Download vs an entry boost | yes (ties only) | yes | Unknown; the tie keeps its reason |
| Battle's last move | all | Copycat (IN-P11) | yes | yes | Unknown; Copycat keeps its reason |
| Side's faint last turn | sv swsh usum | Retaliate (IN-P12) | yes | yes | Unknown; the row's `Needs whether an ally fainted last turn.` |
| Echoed Voice streak | sv swsh usum | Echoed Voice's power (IN-P13) | yes | — (not in Champions) | Unknown; the row's `Needs the consecutive-turn use count.` |
| Leech Seed, Yawn, perish, trap, Salt Cure, Syrup Bomb, Aqua Ring, Ingrain, Ghost Curse, Wish | all (Salt Cure, Syrup Bomb: sv, ch) | the end of turn (exists) | yes (§0 item 4) | yes (exists) | None |
| Dynamax turns left | swsh | none this turn (IN-P14) | — | — | existing `Assumes Dynamax started this turn.` stays |
| Truant loafing | sv swsh usum | the action (No move) | — | — | — |
| Rampage lock, Uproar | all | the action is forced; fatigue confusion after it | — | — (as today) | — |
| G-Max Vine Lash family on a side | swsh | residual 5.1 | — | — | the 2v2 note |
| Healing Wish / Lunar Dance waiting | all | the next Pokémon to enter there (R) | — | yes (R-T) | the 2v2 note |
| Commander | sv | presence (Tier 2 presence) | — | (belief battle volatiles) | — |
| No Pokémon left to switch in (`canSwitch`) | all | the battle's end (`battleOver`), the switch moves, Healing Wish, Lunar Dance, Roar, Whirlwind | yes | yes (exists) | unticked; existing `Assumes {side} has a Pokémon left to switch in.` |
| Bench, replacement, hazards (R) | all | wave 2 | yes | yes | §5.7 |

---

## 3. Contract (paste-ready deltas to SPEC2 §3; Step 0a writes them)

Every field is optional and set only by the 2v2 turn, Training's bridge or a 2v2 calculator control; no 1v1 input and no
Step 0 world sets one.

### 3.1 `app/lib/battle/doubles-types.ts`

```ts
export type DoublesCarried = {
  /* …existing and SPEC2 §3.1 fields… */
  // SPEC2's `stockpile` becomes (IN-C1):
  /** Stockpile from earlier turns: 1–3 layers and the counts its End reverses (PS/data/moves.ts:17974-18007 effectState.def
   *  / spd: −1 per layer whose boost changed the stat, Contrary included; −layers..0). Counts absent: −layers each (a turn fact). */
  stockpile?: { layers: 1 | 2 | 3; def?: number; spd?: number };
  // SPEC2's `charging?: "geomancy"` becomes:
  /** A two-turn move it charged last turn (twoturnmove: Solar Beam, Solar Blade, Meteor Beam, Electro Shot, Skull Bash, Sky
   *  Attack, Razor Wind, Freeze Shock, Ice Burn, Geomancy, Fly, Bounce, Dig, Dive, Phantom Force, Shadow Force): its action is
   *  that move, released with no charge; Fly, Bounce, Dig, Dive, Phantom Force and Shadow Force hold it out of reach until then. */
  charging?: string;
  // ---- N: history ----
  /** The stall counter after consecutive successful protecting moves ending last turn (Protect family, Endure, Max Guard, Quick
   *  Guard, Wide Guard: PS/data/conditions.ts:439-462): its protecting move or Endure this turn works with 1/stall. */
  stall?: 3 | 9 | 27 | 81 | 243 | 729;
  /** Destiny Bond from last turn still up (it has not tried to act since): a foe's move that knocks it out before its next
   *  action faints that foe; a Destiny Bond this turn fails (PS/data/moves.ts:3483-3526). */
  destinyBond?: true;
  /** SwSh, USUM: Laser Focus used last turn (1 turn left): every damaging hit it deals this turn is critical where one can be. */
  laserFocus?: true;
  /** Turns left before this end of turn's countdown (1: it ends at this end of turn): Taunt (15), Encore (16), Disable (17). */
  taunt?: 1 | 2 | 3;
  encore?: { move: string; turns: 1 | 2 | 3 };
  disable?: { move: string; turns: 1 | 2 | 3 | 4 };
  /** Generation 9's once-a-battle effects it already had (pokemon.bondTriggered, swordBoost, shieldBoost, syrupTriggered). */
  onceUsed?: readonly ("battlebond" | "intrepidsword" | "dauntlessshield" | "supersweetsyrup")[];
  // Widened (true / a bare move id keep today's meaning: the end of turn not estimated):
  /** Cud Chew: the Berry it ate last turn, re-eaten at this end of turn (28.2); true: a Berry, not known which. */
  cudChew?: true | string;
  /** A Future Sight or Doom Desire landing on this slot now; the bare id: its user not given (the end of turn not estimated). */
  futureMove?: string | { move: "futuresight" | "doomdesire"; user: DoublesSlotId | { build: BattleBuild } };
};

export type DoublesTurnInput = {
  /* …existing, SPEC2's and R's (Step 2) fields… */
  /** Turns left before this end of turn's countdown of the field effects up as the turn starts (1: it ends at this end of
   *  turn): the terrain (27.7), Gravity (27.2), Magic Room (27.6). Absent: it lasts (the existing turn facts). weatherTurns
   *  stays the weather's. */
  fieldTurns?: Partial<Record<"terrain" | "gravity" | "magicRoom", number>>;
  /** When each Pokémon's ability state began (its switch-in; a changed ability counts from the change), smaller first; two
   *  slots with equal ranks, or one without a rank, are not ordered against each other. Redirect ties
   *  (PS/sim/battle.ts:413-419), Dancer ties and Download read it. Absent: unknown. */
  entryOrder?: Partial<Record<DoublesSlotId, number>>;
  /** The last move used in the battle before this turn, by any Pokémon (battle.lastMove: Copycat); null: none; absent: unknown. */
  battleLastMove?: string | null;
  /** A Pokémon of the side fainted last turn (side.faintedLastTurn: Retaliate). Absent: unknown. */
  faintedLastTurn?: Partial<Record<DoublesSideId, boolean>>;
  /** The echoedvoice field condition's multiplier after last turn (1–5); 0: no Echoed Voice last turn; absent: unknown. */
  echoedVoice?: number;
};

// R (Step 2, SPEC2 §4.8 / F4 §5.4), amended:
/** toxic is not carried: bad poison's stage restarts at 0 on entry (PS/data/conditions.ts tox onSwitchIn). */
export type DoublesBenchPokemon = { id: string; build: BattleBuild; carried?: Pick<DoublesCarried, "sleep" | "freeze" | "onceUsed"> };
//   hazards gain `steelsurge?: true` (SwSh: G-Max Steelsurge, Steel-type Stealth Rock).

export type DoublesOutcomeMon = {
  /* …existing and SPEC2's… */
  // SPEC2's turnsLeft keys gain "taunt" | "encore" | "disable" (after this turn's countdown; absent once ended).
};
```

### 3.2 `app/lib/battle/types.ts`

```ts
// SideConditions ("Doubles turn only", beside SPEC2's mist and luckyChant):
  /** Safeguard up on the side from before the turn. */
  safeguard?: boolean;
// BuildBase (calculation-only marker; set only by the 2v2 turn's calcBuild from carried.laserFocus):
  /** Laser Focus from last turn: its critical-hit ratio is 5 (PS/data/moves.ts laserfocus onModifyCritRatio), so every hit is critical. */
  laserFocus?: true;
```

### 3.3 `app/lib/battle/doubles-world.ts`

```ts
// EotState gains (Step 0a's carriedState maps the carried ones; a use this turn writes its fresh duration; E counts them down):
  /** Turns left before this end of turn's countdown. A use this turn: Taunt 3 (4 when its target had moved), Encore 3 (4 when
   *  it had moved), Disable 5 (4 when it has not moved yet): PS/data/moves.ts:18975, 4725, 3649. */
  tauntLeft?: number; encoreLeft?: number; disableLeft?: number;
// MoveVolatiles gains:
  /** The stall counter (carried.stall; tripled by a protecting move that works this turn; deleted by one that fails). Kept only
   *  while a reader exists: the Pokémon's own protecting move or Endure in this turn (readers rule). */
  stall?: number;
  /** Released this turn: the two-turn move it is locked into (carried.charging), until its action. */
  locked?: string;
  /** Generation 9's once-a-battle effects it already had (carried.onceUsed; A1's Q12 Start and Tier 2's Battle Bond read it). */
  onceUsed?: readonly string[];
// EotState widens cudChew to `true | string` (the Berry) and futureMove to DoublesCarried's form.
// MonState gains:
  /** Its ability state's age (input entryOrder, then this turn's ability changes and newcomers in the order they happen,
   *  each later than every earlier one). Written only when a tie reader is in the turn (readers rule). */
  entry?: number;
// MonState.destinyBond (exists) is set from carried.destinyBond as the turn starts.
```

### 3.4 REASONS (`doubles-actions.ts`; exact text)

```ts
  // status2 inputs (N)
  /** N-E: a used Protean or Libero (abilityActive false) whose type is not given (build.types absent). */
  typeUnknown: (name: string, ability: string) => `${name}'s type after ${ability} is not known.`,
  /** N-E: a redirect, Dancer or Download tie between Pokémon whose entry order is not given. */
  entryTie: (a: string, b: string) => `${a} and ${b} have the same Speed; which entered first is not known.`,
  /** E (via N's input): a Cud Chew holder with no item and no carried Berry, as the end of turn's reason. */
  needsCudChewBerry: (name: string) => `Cud Chew needs ${name}'s Berry from the last turn.`,
```

`entryTie` replaces `notIn2v2({Follow Me|Rage Powder|Spotlight|Lightning Rod|Storm Drain})` at `doubles-turn.ts:1359`
once N-E resolves ties (the stored redirect-tie cases change text: changed-cases.ts lists them). Copycat (`battleLastMove`
absent), Retaliate and Echoed Voice keep their present texts (presence's and the rows').

### 3.5 Input issues (`validate()` / `carriedIssues()`, shown as `{Name}: …`; field-level ones in `issues.field`)

| Input | Issue (exact) |
|---|---|
| `stockpile` | layers outside 1–3: `Stockpile has 1 to 3 layers.`; a count outside −layers..0: `Stockpile changes each stat at most once per layer.` |
| `stages` | outside −6..6: `Accuracy and evasion stages are −6 to +6.` |
| `charging` | not a two-turn move of this game: `{Move} is not a two-turn move.`; action not that move: action issue `It is locked into {Move}.` |
| `stall` | not 3, 9, 27, 81, 243, 729: `The protecting moves' counter is 3, 9, 27, 81, 243 or 729.` |
| `laserFocus` | game without Laser Focus: `Laser Focus is not in this game.` |
| `taunt`, `encore`, `disable` | out of range: `Taunt lasts 1 to 3 more turns.` / `Encore lasts 1 to 3 more turns.` / `Disable lasts 1 to 4 more turns.`; Encore with another action: action issue `Encore locks it into {Move}.`; the disabled move as its action: action issue `{Move} is disabled.` |
| `taunt`, `encore`, `disable`, `attract`, `healBlock` with a working Mental Herb as the turn starts | `Mental Herb would have cured it.` |
| `cudChew` (string) | not a Berry: `Cud Chew re-eats a Berry.`; ability not Cud Chew: `Only Cud Chew re-eats a Berry.` |
| `futureMove` (object) | a user slot that is empty in the turn: `Its Future Sight's user is not in the turn.`; move not in this game: `{Move} is not in this game.` (a user standing at the position itself is valid: the landing does not hit, `PS/data/conditions.ts:398-401`) |
| `onceUsed` | an id outside the four or outside generation 9: `Only generation 9 counts once-a-battle effects.` |
| `fieldTurns` | the effect not up: `Gravity is not up.` (and kin); not a positive integer: `Turns left are 1 or more.` |
| `entryOrder` | a rank that is not a whole number 0 or above: `Entry ranks are whole numbers from 0.` |
| `battleLastMove` | not in the catalog: `The battle's last move is not in this game.` |
| `echoedVoice` | outside 0–5: `Echoed Voice's multiplier is 0 to 5.` |
| `field.attackerSide/defenderSide.safeguard`, `mist`, `luckyChant`, `field.mudSport/waterSport` | game without the move: `Mist is not in this game.` (and kin; `validateConditions`, 2v2 only) |

SPEC2 §3.1's issues stand; its `stockpile` text changes per IN-C1.

---

## 4. Engine: the readers the inputs add

### 4.1 As the turn starts (Step 0a kernel plumbing; `doubles-turn.ts`)

- `carriedState` (`:861`): `stall` → `vol.stall`; `charging` → `vol.locked` and, for Fly, Bounce (`eot.hidden = "semi"`), Dig, Dive
  (`"sheltered"`), Phantom Force and Shadow Force (`"semi"`), the same state `chargeTurn` leaves today (`eotHooks.charging`);
  `destinyBond` → `MonState.destinyBond = true`; `laserFocus` → the build marker in `calcBuild` (`:444`);
  `taunt` → `vol.taunt = true`, `eot.tauntLeft`; `encore` → `vol.encore = move`, `eot.encoreLeft`; `disable` →
  `vol.disabled = move`, `eot.disableLeft`; `cudChew` string → `eot.cudChew` (the Berry); `futureMove` object →
  `eot.futureMove` with its user; `onceUsed` → `vol.onceUsed`.
- `startWorld` (`:842-850`): `safeguard` from each side's conditions; `mudSport` / `waterSport` (SPEC2); `MonState.entry`
  from `input.entryOrder` when a tie reader is in the turn.
- `createContext` (`:2769`): `ctx.entryReaders` (two possible redirectors of one move, two Dancers, a Download holder).
- `validate` / `carriedIssues` (`:2809`, `:2850`): §3.5.
- `turnFacts` (`:3294`) and `doubles-status.ts turnFacts` (`:648`): §6.
- `outcomeOf` (`:3548`): `turnsLeft.taunt / encore / disable`; `volatiles` "taunt", "encore", "disable" only while turns are left.

### 4.2 `doubles-history.ts` (new; N-E), its hooks and call sites (Step 0a inserts the calls with today's stubs)

| Hook | Call site (`4008ee8`) | Stub (today) | N-E model |
|---|---|---|---|
| `stallPrepare(kernel, w, action, move): World[]` | `doubles-status.ts earlyBranch` (`:822-835`), after the `willAct` check, before `mon.protect` / Endure | `[w]` | With `vol.stall` c: worlds `pass` (1/c, `vol.stall = min(729, 3c)`) and `fail` (1 − 1/c, `vol.stall` deleted, step fact `{Move} fails: a protecting move was used last turn.`, no protection, no Endure); without: pass with `vol.stall = 3` only when a later reader exists (none this turn: not written). Max Guard goes through the same point once Tier 2 moves models it (today `REASONS.maxGuard` guards a Dynamaxed status move). Quick Guard and Wide Guard do not roll (their onTry reads willAct only) |
| `releasesNow(kernel, w, slot, move): boolean` | `doubles-turn.ts chargesThisTurn` (`:1866`), first; and A1's Geomancy handler | `false` | `vol.locked === move.id` (not a Z-Move or Max Move): no charge; Power Herb is not used; Meteor Beam / Electro Shot / Skull Bash do not boost again; `vol.locked` and `eot.hidden` are deleted as the move is used (`useMove`), and also when its action is stopped (sleep, freeze, flinch, confusion's self-hit, paralysis: twoturnmove's onMoveAborted). Moves aimed at it before then meet `eot.hidden`: Tier 2 moves' semi-invulnerable model (until it lands, today's `REASONS.semiInvulnerable` guard stays for them) |
| `destinyBondBefore(kernel, w, action): void` | `doubles-status.ts beforeMove` (`:124-150`) at priority −1 (after paralysis, before `focusCheck`), and on every `stopped` world | none | Deletes `MonState.destinyBond` unless its move is Destiny Bond; on a stopped action deletes it (MoveAborted). `earlyBranch`'s Destiny Bond (`:860-864`): with `destinyBond` already up the use fails (`Destiny Bond fails: it was used last turn.`) and the volatile goes (PrepareHit's removeVolatile). `onKnockOut` (`:476`) reads it as today |
| `entryTie(kernel, w, a, b): DoublesSlotId \| null` | `doubles-turn.ts redirect` (`:1357-1360`) before the guard; Tier 2 presence's Dancer and Download | `null` (guard as today) | The older `MonState.entry` (smaller) wins; unknown for either: `REASONS.entryTie(names[a], names[b])` |
| `entryChanged(kernel, w, slot): void` | A1's `setAbility` (`doubles-abilities.ts`), R's `replaceSlot` | none | `MonState.entry = ++ctx.entryClock` (later than every input rank) when `ctx.entryReaders` |
| `proteanUsed(kernel, w, slot): void` | `rootWorlds` (`:893`), once per present slot | none | Protean or Libero with `abilityActive` false and no `build.types`: `notEstimated(REASONS.typeUnknown(name, ability))`. With `types` set it is the state SPEC2 A2 models: in SV and Champions no further change this stint; in SwSh and USUM it changes again on its next move (A2's `proteanType`). `doublesBuildIssues` (2v2 only) stops reporting `Only unused Protean/Libero with unchanged typing is supported.`; 1v1's `validateBuild` keeps it |

`doubles-history.ts` imports the `TurnKernel` type only and is called by the kernel and by A1 (`entryChanged`).

### 4.3 End of turn (Track E additions, its own files)

| Key | Rule |
|---|---|
| 15, 16, 17 (no HP) | `eot.tauntLeft` / `encoreLeft` / `disableLeft` count down; at 0 the volatile ends (`vol.taunt` / `encore` / `disabled` deleted); Encore also ends when its move's PP is out (Training only passes that as turns 1). Residual lines `Taunt ends · {Name}`, `Encore ends · {Name}`, `Disable ends · {Name}` |
| 27.2, 27.6, 27.7 (no HP) | `fieldTurns.gravity / magicRoom / terrain === 1` and the effect still the one from before the turn (not `fieldSet`, not changed): it ends there; later handlers read the new field (the Orbs at 28.3 under Misty Terrain and grounding: IN-P07a, c; Magic Room's late items: White Herb at 29, the Orbs, Sticky Barb, Micle, the final Update's Berries, Mental Herb, Booster Energy: IN-P07b, F3 §5.3.1's room-end code). The existing `Assumes … does not end this turn.` facts are given only when the turns are absent. A terrain ending with a Mimicry, Quark Drive or Seed holder in keeps `REASONS.fieldChange` (fieldChangeGuard extended to the terrain's end) |
| 3, 28.2 | Future Sight landing and Cud Chew: Tier 2 end of turn's handlers, reading `eot.futureMove.user` and `eot.cudChew` (the Berry) |

### 4.4 Calculation (Step 0b, `calculate.ts critRatio` `:1273`)

`if (build.laserFocus) { ratio = Math.max(ratio, 5); sources.push("Laser Focus"); }` before the items; `certainCrit` then
makes every hit critical, and the existing crit blockers (Battle Armor, Shell Armor, Lucky Chant via `conditionsFor`) stand.
1v1 never sets the marker.

### 4.5 Readers owned by other designs (the input only is this design's)

Copycat (`battleLastMove`), Instruct and Mirror Move (`lastMove`), Retaliate (`faintedLastTurn`), Echoed Voice
(`echoedVoice`), Dancer and Download ties (`entryTie`): Tier 2 presence. Battle Bond (`onceUsed`) and the semi-invulnerable
hits: Tier 2 moves. Future Sight landing, Cud Chew: Tier 2 end of turn. Q12's once-a-battle Start (`onceUsed` makes it exact
for Training): A1 and R. Stockpile, Recycle, Harvest, types, Attract, Heal Block, stages, Berserk lock: SPEC2's tracks.

### 4.6 Randomness and the readers rule

New branches: the stall roll (×2 per protecting move or Endure with a carried counter). The Ally Switch roll exists. No
other input adds randomness. Written only with a reader: `vol.stall` (its own protecting move this turn), `MonState.entry`
(`ctx.entryReaders`), `eot.tauntLeft / encoreLeft / disableLeft` (always while the volatile stands: E2 and the end of turn
read them; they come only from Training or a use this turn).

---

## 5. UI (2v2 only; 1v1 unchanged)

### 5.1 Layout

Field conditions keeps its order: Weather and terrain, Critical hit, Shared field effects, the two side fieldsets, the note.

- **Weather and terrain** fieldset: under the Weather select a checkbox `Weather ends this turn` (a non-strong weather set),
  under Terrain `Terrain ends this turn` (a terrain set).
- **Shared field effects**: `Mud Sport`, `Water Sport` (USUM) join the toggles; `Gravity ends this turn` and `Magic Room ends
  this turn` show under their toggles while on. Then, when a reader is in the turn: `Entered first` (select), `Last move in
  the battle` (select), `Echoed Voice turns in a row` (select).
- **Each side fieldset** (`Your side` / `Opponent's side`): the side toggles (Reflect, Light Screen, Aurora Veil, Tailwind),
  then `Safeguard`, `Mist`, `Lucky Chant` where the game has them; `Lost a Pokémon last turn` (Retaliate on that side); then
  one group per Pokémon (data-doubles-carried, its name as the heading, as today): **checkboxes** in the 2-column grid (the
  existing Charge, Confused, Rest sleep, Substitute, then the new ones), **selects** in the compact fields grid (the existing
  counts, then the new ones). Under R (wave 2): `Bench`, `Hazards` and each Pokémon's `Replacement` (§5.7).
- Every control shows only per §5.2's "Shown when" **or while it is set**; a fainted Pokémon shows none (NO_CARRIED_OPTIONS).
  With nothing set, a Pokémon whose turn reads nothing new shows exactly today's controls.

### 5.2 Controls

"Learns" = its species' learnset has the move; "in the turn" = the Pokémon present in the four slots.

**Per Pokémon, checkboxes**

| Label | Data attribute | Games | Shown when | Writes |
|---|---|---|---|---|
| `{Move} charged last turn` | `data-doubles-charged-last` | all | its action is a two-turn move (CHARGE_TURN_MOVES ∪ SEMI_INVULNERABLE_MOVES ∪ Geomancy), not as a Z-Move or Max Move | `carried.charging = action` |
| `Destiny Bond from last turn` | `data-doubles-destiny-bond` | all | learns Destiny Bond | `carried.destinyBond` |
| `Minimized` | `data-doubles-minimized` | all | learns Minimize | `carried.minimize` |
| `Glaive Rush last turn` | `data-doubles-glaive-rush` | sv, ch | learns Glaive Rush | `carried.glaiveRush` |
| `Laser Focus last turn` | `data-doubles-laser-focus` | swsh, usum | learns Laser Focus and its action is damaging | `carried.laserFocus` |
| `Tar Shot` | `data-doubles-tar-shot` | sv, swsh | a Pokémon in the turn learns Tar Shot | `carried.tarShot` |
| `Foresight` | `data-doubles-foresight` | usum | a Ghost type, and a Pokémon in the turn learns Foresight or Odor Sleuth | `carried.foresight` |
| `Miracle Eye` | `data-doubles-miracle-eye` | usum | a Dark type, and a Pokémon in the turn learns Miracle Eye | `carried.miracleEye` |
| `Nightmare` | `data-doubles-nightmare` | usum | Asleep or Comatose, and a foe in the turn learns Nightmare | `carried.nightmare` |
| `Heal Block` | `data-doubles-heal-block` | sv, ch | a foe in the turn learns Psychic Noise | `carried.healBlock = 1` |
| `Berry locked` | `data-doubles-berry-locked` | all | Berserk or Anger Shell holding Sitrus, Oran or a Figy-family Berry | `carried.berryLocked` |
| `Power Trick` (Champions: `Power Shift`) | `data-doubles-power-trick` | all | learns the move | `carried.powerTrick` / `powerShift` |
| `No Retreat` | `data-doubles-no-retreat` | sv ch swsh | its action is No Retreat | `carried.noRetreat` |
| `Battle Bond used` | `data-doubles-battle-bond` | sv, ch | its ability is Battle Bond | `carried.onceUsed += battlebond` |
| `Drowsy` | `data-doubles-drowsy` | all | no status, and a Pokémon in the turn learns Yawn | `carried.yawn` |
| `Salt Cure` | `data-doubles-salt-cure` | sv, ch | a foe in the turn learns Salt Cure | `carried.saltCure` |
| `Aqua Ring`, `Ingrain` | `data-doubles-aqua-ring`, `-ingrain` | all | learns the move | `carried.aquaRing` / `ingrain` |
| `Cursed` | `data-doubles-curse` | all | a Ghost type in the turn learns Curse | `carried.curse` |

**Per Pokémon, selects** (compact; options in this order, default first unless marked)

| Label | Data attribute | Games | Shown when | Options | Writes |
|---|---|---|---|---|---|
| `Stockpile` | `data-doubles-stockpile` | all | its action is Stockpile, Swallow or Spit Up; or (USUM) its action is Snatch and one of those is in the turn | 0, 1, 2, 3 | `carried.stockpile.layers` (no counts) |
| `Type`, `Second type` | `data-doubles-type`, `-type2` | all | not Terastallized (but Stellar), not Arceus or Silvally, and: Protean, Libero or Color Change; or learns Reflect Type, Conversion, Conversion 2, Camouflage, Burn Up or Double Shock; or a Pokémon in the turn learns Soak or Magic Powder | `Type`: its own first type (default), the game's types, `???`; `Second type`: its own second (default; `None` for one type), `None`, the types, `???`. A Protean or Libero holder with `Protean unused since switch-in` unticked: `Type` starts at `Unknown` and any pick, its own type included, sets the types | `history.types` (§5.4) |
| `Added type` | `data-doubles-added-type` | all | not Terastallized, and a Pokémon in the turn learns Forest's Curse (`Grass`) or Trick-or-Treat (`Ghost`) | None, Grass, Ghost (each where the move exists) | `history.addedType` |
| `Infatuated by` | `data-doubles-attract` | all | another Pokémon in the turn of the opposite gender learns Attract or has Cute Charm | None, each such Pokémon by name | `carried.attract` |
| `Heal Block turns left` | `data-doubles-heal-block` | usum | a Pokémon in the turn learns Heal Block | None, 1, 2, 3, 4 | `carried.healBlock` |
| `Embargo turns left` | `data-doubles-embargo` | usum | a Pokémon in the turn learns Embargo | None, 1–4 | `carried.embargo` |
| `Telekinesis turns left` | `data-doubles-telekinesis` | usum | a Pokémon in the turn learns Telekinesis | None, 1, 2 | `carried.telekinesis` |
| `Octolock by` | `data-doubles-octolock` | ch, swsh | a foe in the turn learns Octolock | None, each such foe | `carried.octolock` |
| `Accuracy stage`, `Evasion stage` | `data-doubles-accuracy`, `-evasion` | all | its action or a move into it this turn is Stored Power, Power Trip, Punishment, Acupressure, Psych Up, Heart Swap, Topsy-Turvy, Spectral Thief or Haze (any Pokémon's, aimed at it or a spread one) | −6..+6, default 0 | `carried.stages` |
| `Last move` | `data-doubles-last-move` | all | Disable, Encore, Instruct or Mirror Move in the turn can reach it; its own action is Conversion 2 | `Unknown` (default), `None since it came in`, its quick moves, its action's move | `history.lastMove` |
| `Item used earlier` | `data-doubles-last-item` | all | it holds no item, and its action is Recycle or its ability is Harvest | `Unknown` (default), `None`, the game's items (Berries only for a Harvest holder whose action is not Recycle; Berries first otherwise) | `history.lastItem` |
| `Berry eaten last turn` | `data-doubles-cud-chew` | sv, ch | its ability is Cud Chew | holding a Berry: `None` (default), the Berries; no item: `Unknown` (default), `None`, the Berries | `carried.cudChew` |
| `Protecting moves in a row` | `data-doubles-in-a-row` | all | its action is a protecting move (Protect family, Endure, Max Guard as a Dynamaxed status move) | 0–6 | `carried.stall = 3^n` (n ≥ 1) |
| `Ally Switch in a row` | `data-doubles-in-a-row` | sv, ch | its action is Ally Switch | 0–6 | `carried.allySwitch = 3^n` |
| `{Move} lands` | `data-doubles-future` | all | a Pokémon in the turn (other than it) or, under R, on a bench learns Future Sight or Doom Desire | `No`, `From {Name}` per learner (the move it learns; Future Sight first) | `carried.futureMove = { move, user }` |
| `Leech Seed` | `data-doubles-leech-seed` | all | a foe in the turn learns Leech Seed, and it is not a Grass type | None, `Heals {Foe}` per foe (the Pokémon standing there heals) | `carried.leechSeed` |
| `Perish count` | `data-doubles-perish` | all | a Pokémon in the turn learns Perish Song or has Perish Body | None, 3, 2, 1 | `carried.perish` |
| `Trapped by` | `data-doubles-trap` | all | a foe in the turn learns a partial trapping move | None, each such foe | `carried.trap` (Binding Band from the foe's item; `move` when its quick moves hold exactly one trapping move) |
| `Syrup Bomb from` | `data-doubles-syrup-bomb` | sv, ch | a foe in the turn learns Syrup Bomb | None, each such foe | `carried.syrupBomb` |
| `Wish lands` | `data-doubles-wish` | all | it or its ally learns Wish | None, `From {Name}` | `carried.wish = floor(that Pokémon's maximum HP / 2)` |

**Field and sides**

| Label | Data attribute | Shown when | Options | Writes |
|---|---|---|---|---|
| `Weather ends this turn` | `data-doubles-weather-ends` | a weather but Harsh Sunshine, Heavy Rain, Strong Winds | checkbox | `weatherTurns = 1` |
| `Terrain ends this turn` | `data-doubles-terrain-ends` | a terrain | checkbox | `fieldTurns.terrain = 1` |
| `Gravity ends this turn`, `Magic Room ends this turn` | `data-doubles-gravity-ends`, `-magic-room-ends` | the effect on | checkbox | `fieldTurns.gravity / magicRoom = 1` |
| `Mud Sport`, `Water Sport` | `data-doubles-mud-sport`, `-water-sport` | USUM | checkbox | `field.mudSport / waterSport` |
| `Entered first` | `data-doubles-entered-first` | two Pokémon that can tie for one move's redirection (two foes of an attacker with Follow Me or Rage Powder actions, or two Lightning Rod or Storm Drain holders), two Dancers, or a Download holder facing a foe with an entry boost | `Unknown` (default), each candidate by name | `turnEarlier.entered` (the chosen one rank 0, the other candidates rank 1: not ordered among themselves) |
| `Last move in the battle` | `data-doubles-battle-last-move` | a Copycat user in the turn | `Unknown` (default), `None`, the four Pokémon's quick moves (once each) | `battleLastMove` |
| `Echoed Voice turns in a row` | `data-doubles-echoed-voice` | an Echoed Voice user in the turn | `Unknown` (default), 0–4 (`echoedVoice` = that number; 0: none) | `echoedVoice` |
| `Safeguard`, `Mist` (sv swsh usum), `Lucky Chant` (usum) | `data-doubles-side-safeguard` (and kin) `={side}` | the game has the move | checkbox | the side's conditions |
| `Lost a Pokémon last turn` | `data-doubles-fainted-last` `={side}` | a Retaliate user on the side | `Unknown` (default), `Yes`, `No` | `faintedLastTurn[side]` |
| `No Pokémon left to switch in` | `data-doubles-no-bench` `={side}` | always (each side fieldset; the battle's end, the switch moves, Healing Wish, Lunar Dance, Roar and Whirlwind read it) | checkbox | `canSwitch[side] = false` (the contract field exists; Training passes it today) |

### 5.3 Labels, names, accessibility, 375 px

- Every per-Pokémon label carries the existing `Whose` suffix (sr-only `: {Name}`), so accessible names are unique
  (`Stockpile: Swalot`); every new side control carries an sr-only `: your side` / `: the opponent's side`
  (`Safeguard: your side`); options name Pokémon by `names[slot]` (`Infatuated by` → `Garchomp (opponent's)`).
- No label says left, right, slot or position; `Leech Seed`'s options are `Heals {Foe}` (the Pokémon standing there now).
- Errors render with each control as today (`Field error=`), from `carriedIssueTexts` extended with the new issue fields
  (`carried.stockpile`, `carried.stages`, `carried.charging`, `carried.stall`, `history.types`, …).
- 375 px: the two-column checkbox grid with `wrap-anywhere`, the compact fields grid (`styles.fields`); no new widths; the
  longest label (`Protecting moves in a row`) wraps within one column. The UI test renders the busiest group (a Swalot with
  every control set) at 375 px and asserts `scrollWidth <= clientWidth`.

### 5.4 State and reset rules (`doubles-prep.ts` DoublesMatchup; logic in `doubles-inputs.ts`)

- State: `carried` (today's, now with every new field), `history: Record<DoublesSlotId, { lastMove?: string | null;
  lastItem?: string | null; types?: string[]; addedType?: "Grass" | "Ghost" }>`, `turnEarlier: { weatherEnds?, terrainEnds?,
  gravityEnds?, magicRoomEnds?, entered?: Partial<Record<DoublesSlotId, number>>, battleLastMove?, echoedVoice?,
  faintedLastTurn?, noneLeft?: Partial<Record<DoublesSideId, true>> }`; the field's new keys live in `doubles.field` (the 2v2's own BattleConditions, which 1v1 never reads).
- Input: `doublesSlotInput` adds `history.lastMove` / `lastItem` to the slot input and `history.types` / `addedType` to a copy
  of its build (IN-C6: the Combatant's build and the roster cache never get them); `getDoublesTurnInput` adds `weatherTurns`,
  `fieldTurns`, `entryOrder`, `battleLastMove`, `echoedVoice`, `faintedLastTurn` and `canSwitch` (false for a `noneLeft` side). `moves` is passed for every slot (its quick
  moves in slot order, SPEC2 §5.2).
- Another Pokémon in a slot (`anotherPokemon`): its `carried` and `history` clear (as `carried` today); `turnEarlier.entered`
  drops it; its `Replacement` (R) clears.
- A build change (`reconcileEarlier`, extending `reconcileCarried`): a species change (form change included) drops `types`
  and `addedType` (setSpecies, SPEC2's `withSpecies`); Terastallizing drops `addedType` (and hides `types` unless Stellar);
  Arceus and Silvally drop both; `nightmare` without Asleep or Comatose, `berryLocked` without its ability and Berry,
  `cudChew` without Cud Chew, `heal block` / `embargo` / `telekinesis` turns outside the game's range, `laserFocus` outside
  SwSh and USUM go; `stockpile` and `stages` are bounded.
- An action change (`chooseDoublesMove`): `charging` goes unless the new action is that move; `stall` / `allySwitch` go
  unless the new action reads them.
- A field change (`setDoublesField`): each `…Ends` flag goes when its effect is off (or the weather becomes a strong one).
- A game or account change: fresh 2v2 (exists). A roster change (R): bench entries whose source is gone are removed.

### 5.5 Summary toggles (`describeDoublesConditions`)

A toggle counts when it puts a condition on the field or on a Pokémon: each new checkbox ticked; `Stockpile` above 0; a
changed `Type` pair (once); `Added type`, `Infatuated by`, a turns-left select, `Octolock by`, `Leech Seed`, `Perish count`,
`Trapped by`, `Syrup Bomb from`, `Wish lands`, `{Move} lands` not None; a non-zero stage; `Safeguard`, `Mist`, `Lucky
Chant`, the Sports, `No Pokémon left to switch in`, each hazard. History answers do not count: `Last move`, `Item used earlier`, `Berry eaten last turn`, the
`in a row` selects, `Entered first`, `Last move in the battle`, `Echoed Voice turns in a row`, `Lost a Pokémon last turn`,
the `… ends this turn` checkboxes.

### 5.6 The note "Battle states that cannot be set here" in 2v2

`unmodelledBattleStates(runtime)` stays as is for 1v1. A new `unmodelledDoublesStates(runtime)` (same file, same entry
rules) drops what 2v2 can now set or work out (Wide Guard and its kin, a partner's Battery and kin, the Ruin abilities and
Neutralizing Gas, Foresight and Miracle Eye, Glaive Rush, a semi-invulnerable target, Minimize, a Substitute, grounding, the
stat swaps, the Doubles order) and lists: `An ability suppressed by Gastro Acid or replaced by {…}` (its Gastro Acid half
only), `G-Max Vine Lash, Wildfire, Cannonade or Volcalith on a side` (SwSh), `A Healing Wish or Lunar Dance waiting for the
next Pokémon to come in`, `Torment or Throat Chop from an earlier turn`, `A move locked in by Outrage, Petal Dance, Thrash,
Raging Fury or Uproar`. `BattleConditions` calls it for `variant="doubles"`.

### 5.7 Wave 2 (R): Bench, Replacement, Hazards

- **Bench** (each side fieldset, `data-doubles-bench={side}`; shown when the side's roster panel has entries beyond the two in
  play and a reader exists: a switching move, an Eject Button, Eject Pack or Red Card, Emergency Exit or Wimp Out, a foe's
  Roar, Whirlwind, Dragon Tail or Circle Throw, Healing Wish, Lunar Dance; or when set). It replaces wave 1's `No Pokémon left
  to switch in` checkbox: an empty bench with that box ticked is `canSwitch[side] = false`. A
  select `Add to bench` lists that side's roster entries not in play and not benched (by name); each bench Pokémon is a row:
  its name, `HP` (number, 1 to its maximum; default its cached build's), `Status` (select), and a button `Remove {Name}`. At
  most four. Its build is its roster entry's as prepared (the shared cache), with the row's HP and status. Default: empty, so
  `canSwitch` and the switch family stay as today (`Assumes {side} has a Pokémon left to switch in.`, `switchesOut`). A
  non-empty bench sets `bench[side]` and `canSwitch[side]`.
- **Replacement** (each Pokémon that can switch out by its player's choice this turn: its action is U-turn, Volt Switch,
  Flip Turn, Parting Shot, Teleport, Baton Pass, Shed Tail or Chilly Reception, or it holds an Eject Button or Eject Pack, or
  has Emergency Exit or Wimp Out; `data-doubles-replacement={slot}`): a select of its side's bench by name, default the first
  (the turn's fact `Assumes {Newcomer} comes in for {Name}.` while left at the default); the second switcher of a side
  defaults to the next bench Pokémon.
- **Hazards** (each side fieldset; shown when a Pokémon of that side can come in this turn per Bench's rule and the bench is
  set, or when set): `Stealth Rock`, `Spikes` (0–3), `Toxic Spikes` (0–2), `Sticky Web`, `G-Max Steelsurge` (SwSh);
  `data-doubles-hazard-{stealth-rock|spikes|toxic-spikes|sticky-web|steelsurge}={side}`.
- **Validation** (R's Step 2, shown on the row): `A bench holds at most four Pokémon.`; `{Name} is already in play.`; the
  bench build's own issues as `Bench {Name}: …`; a replacement not on its side's bench: `Its replacement is not on its side's
  bench.`; `Spikes have 1 to 3 layers.`, `Toxic Spikes have 1 or 2 layers.`; `G-Max Steelsurge is not in this game.`
- **Names**: bench Pokémon are named by `duplicateNameParts` over the four slots then the bench in roster order (R's Step 2
  extends `turnNames`; a same-named bench Pokémon gets the next number).

---

## 6. Facts each default produces (turn facts; each only when it applies; exact)

New (N):
- `Assumes {Name} did not charge {Move} last turn.`: its action is a two-turn move that would charge this turn
  (`chargesThisTurn` true) and there is no `carried.charging`. It replaces SPEC2's `Assumes {Name} did not charge Geomancy
  last turn.` (the same text with Geomancy).
- `Assumes each of {Name}'s Stockpile layers changed its Defense and Sp. Def.`: its action is Swallow or Spit Up (or a
  Snatch user's stolen Swallow reads its own) with `carried.stockpile` and no counts.
- `Assumes {Newcomer} comes in for {Name}.` (R, SPEC2 §2.5): unchanged.

Kept as they are, now each with its control: `Assumes no protecting move was used last turn.` (given unless every
Pokémon whose action is a protecting move or Endure has `carried.stall`), `Assumes {Name} did not use Ally Switch last
turn.`, `Assumes {Name} did not use Destiny Bond last turn.` (its action is Destiny Bond and no
`carried.destinyBond`), SPEC2's `Assumes {Name} has not stockpiled.`, `… has no Power Trick from an earlier turn.`,
`… has not used No Retreat.`, `… has not used Minimize.`, the end of turn's `Assumes the {Weather} does not end this turn.`,
`Assumes the {Terrain} Terrain does not end this turn.`, `Assumes Gravity does not end this turn.`, `Assumes Magic Room does
not end this turn.`, `Assumes {side} has a Pokémon left to switch in.` (the box unticked, no bench). The ambient controls (§0 item 1) state
none. The Unknown defaults keep their reasons: `{Move} needs {Name}'s move from the last turn.`, `Recycle / Harvest needs
{Name}'s item from an earlier turn.`, `Cud Chew needs {Name}'s Berry from the last turn.`, `{A} and {B} have the same Speed;
which entered first is not known.`, `{Name}'s type after {Ability} is not known.`, Copycat's, and the rows'
`Needs whether an ally fainted last turn.` / `Needs the consecutive-turn use count.`.

---

## 7. Training (Champions; `sim/bridge.ts`, `sim/splits.ts`, `sim/tracker.ts`; T's files)

| Input | Public source | Bridge |
|---|---|---|
| `stall` | tracker `protectStreak` (counts Wide and Quick Guard too, `tracker.ts:39-41, 634`) | `carried.stall = min(729, 3^streak)` when the streak is above 0 and its action is a protecting move or Endure; splits.ts drops its Protect fork (`:44-58`) and its Gravity rollout |
| `allySwitch` | exists | — |
| `charging` | tracker `charging` (the `-prepare` line) | `carried.charging`; `twoturnmove` and the move's volatile move from rollout to mapped (`MAPPED_VOLATILES`) |
| `destinyBond` | the belief battle's `destinybond` volatile (a replay of `-singlemove` and the holder's later action lines) | `carried.destinyBond`; `destinybond` mapped |
| `taunt`, `encore`, `disable` | tracker volatiles' `since`, `targetMovedFirst`, `movesUsed` (PP) | turns left = the condition's duration rule (§1.1) minus the ends since; Encore with its move's PP out: 1; `encore` and `taunt` and `disable` leave `IGNORED_VOLATILES` for `MAPPED_VOLATILES` |
| `onceUsed` | the belief battle's `bondTriggered`, `swordBoost`, `shieldBoost`, `syrupTriggered` (each set by a public line) | `carried.onceUsed` |
| `cudChew` | the belief battle's Cud Chew `abilityState.berry` with counter 1 (the `-enditem … [eat]` line of last turn) | `carried.cudChew = berry id` (today `true`, `bridge.ts:241-242`) |
| `futureMove` | the slot condition (the `-start … Future Sight` line) and its source | `{ move, user }`: the source's slot when active, else `{ build: liveBuild(source) }` with stages 0 |
| `entryOrder` | the belief battle's `abilityState.effectOrder` (a replay of the public switch and ability lines) | ranks of the four actives |
| `fieldTurns` | `fieldClock` (`bridge.ts:109-130`) | terrain, Gravity, Magic Room turns; the rollout `Magic Room ending this turn is not modelled.` (`:275-280`) goes once E lands §4.3 |
| `safeguard` | the side condition (`-sidestart`) | `SideConditions.safeguard`; `safeguard` joins `MAPPED_SIDE` (the rollout `Side effect safeguard is not modelled.` goes) |
| `battleLastMove` | `PublicState.lastMove` | the turn input |
| `faintedLastTurn` | `PublicSide.faintedLastTurn` | the turn input (no Retaliate in Champions; passed for completeness) |
| types, used Protean | the `typechange` / `typeadd` lines (SPEC2 §6) | `build.types`, `abilityActive` false: the rollout `{Name}: {ability} was used this stint.` (`:297`) goes |
| Q2's (`stockpile`, `lastItem`, `attract`, `healBlock`, `stages`, `berryLocked`) | SPEC2 §6 | as SPEC2 |

Never read: the opponent's PP beyond public uses, a Substitute's HP after a hit, sampled hidden items' durations other than
the belief world's own. `leak:training` diffs the new fields; the leak gate must show them from public lines only.

---

## 8. Oracle cases (`IN-`; file `scripts/.cache/calc-audit/2v2/verify/cases-in.ts`, wired into `cases-se.ts`)

Harness (V's files): `CaseCarried` gains §3.1's fields; `prepare()` sets `stall` (`addVolatile('stall')`, counter),
`twoturnmove` with the move (the charge turn run as a first turn, or `addVolatile('twoturnmove', p, move)` plus the move's
volatile), `destinybond`, `laserfocus` (duration 1), `taunt` / `encore` / `disable` with durations, `bondTriggered`, Cud
Chew's `abilityState.berry` and `counter 1`, the `futuremove` slot condition with `source`, `moveData` and `endingTurn`,
`abilityState` re-made in `entryOrder` order, the field durations, `side.faintedLastTurn`, `battle.lastMove`, the
`echoedvoice` pseudo-weather multiplier, Safeguard with a source; compare.ts compares E2's `turnsLeft` taunt / encore /
disable.

| Id | Case | Probe |
|---|---|---|
| IN-STL-01-sv, -champions | Garchomp Protect with stall 3; a slower foe's Tackle | IN-P01 |
| IN-STL-02-sv | Endure with stall 9 into a KO hit | IN-P01 rule |
| IN-STL-03-sv | confused Protect user under Gravity with stall 3 | IN-P02 |
| IN-STL-04-swsh | Max Guard with stall 3 | IN-P01 rule |
| IN-CHG-01-sv, -champions | Dig released; a faster Night Slash misses (with Tier 2's semi-invulnerable model; before it, the guard) | IN-P03 |
| IN-CHG-02-sv | Solar Beam released without sun; Power Herb held stays | IN-P03b |
| IN-CHG-03-champions | Electro Shot released without rain (Archaludon) | IN-P03 rule |
| IN-CHG-04-usum | Geomancy released (A1) | SPEC2 A1 |
| IN-LSF-01-usum, -swsh | Laser Focus last turn: Close Combat crits | IN-P04 |
| IN-LSF-02-usum | Laser Focus into a Lucky Chant side: no crit | IN-P04, F35 |
| IN-DBD-01-sv, -champions | Destiny Bond up: a faster KO faints the attacker | IN-P05 |
| IN-DBD-02-sv | Destiny Bond up and Destiny Bond again: fails | IN-P05b |
| IN-DBD-03-usum | Destiny Bond up, holder asleep (MoveAborted), then a slower KO: no faint | IN-P05 rule |
| IN-TLK-01-usum, -02-usum | Telekinesis 1 / 2 left with Yawn under Electric Terrain | IN-P06 |
| IN-FLD-01-sv, -usum | Misty Terrain ends this turn; Flame Orb (sv), Toxic Orb (usum) | IN-P07a |
| IN-FLD-02-sv, -champions | Magic Room ends this turn; Flame Orb and Sitrus | IN-P07b |
| IN-FLD-03-sv, -swsh | Gravity ends this turn; Flying Flame Orb holder under Misty Terrain | IN-P07c |
| IN-FLD-04-champions | Rain ends this turn (weatherTurns 1) with Rain Dish | existing rule |
| IN-ENT-01-sv, -champions | two equal-Speed Follow Me (sv) / Rage Powder (champions) users; each entry order | IN-P08a |
| IN-ENT-02-sv, -usum | Lightning Rod (sv) / Storm Drain (usum) on both sides; each order; and order unknown (the reason) | IN-P08b |
| IN-CUD-01-sv, -champions | Cud Chew re-eats a Sitrus eaten last turn | IN-P09 |
| IN-FSL-01-sv | Future Sight lands from its user at +2 Sp. Atk | IN-P10 |
| IN-FSL-02-sv | Future Sight lands from a benched user (R) | IN-P10 |
| IN-FSL-03-champions | Future Sight lands on the Pokémon standing there after an Ally Switch | IN-P10 rule, ADDENDUM A5 |
| IN-TNT-01-sv, -champions | Taunt 1 left (ends; Taunt again fails) / 2 left (E2 taunt 1) | IN-P17 |
| IN-TNT-02-sv | Encore 2 left; Encore again fails; E2 encore 1 | IN-P17 rule |
| IN-TNT-03-champions | Disable 1 left; ends at 17 | IN-P17 rule |
| IN-STK-01-sv, -swsh | Stockpile 2 with Swallow, counts given; Contrary Shuckle (swsh) counts −2 | SA09, SA09c |
| IN-STK-02-champions | Stockpile 3 with Spit Up, counts absent (the fact) | SA09 |
| IN-ATR-01-sv, -champions | Infatuated by the foe, 1/2 at its BeforeMove | SPEC2 A2 |
| IN-HBK-01-sv | Heal Block (Psychic Noise) 1 left: Leftovers blocked, ends at 20, Sitrus at the final Update | IN-P15, CR01 |
| IN-HBK-02-usum | Heal Block 3 left, Grassy Terrain | CR01 rule |
| IN-ACC-01-sv, -champions | Acupressure with evasion +6 (six branches) | IN-P16 |
| IN-ACC-02-sv | Stored Power with a carried evasion +2 (D) | F4 D |
| IN-SFG-01-sv, -usum | Safeguard from before the turn against Thunder Wave and a Nuzzle | SPEC2 A |
| IN-MST-01-sv, -swsh | Mist from before the turn against Icy Wind's drop | F40 |
| IN-SPT-01-usum, -02-usum | Mud Sport with Thunderbolt; Water Sport with Flamethrower | F75 |
| IN-RTL-01-sv, -swsh | Retaliate after the side lost a Pokémon last turn | IN-P12 |
| IN-ECV-01-sv, -swsh | Echoed Voice from last turn (×2) by another user | IN-P13 |
| IN-CPY-01-sv, -usum | Copycat calls the battle's last move | IN-P11 |
| IN-BBD-01-sv, -champions | Battle Bond used: no boost on a KO | IN-P18 |
| IN-SEC-01-sv, -champions | Leech Seed, Salt Cure, Drowsy, Perish 1 through the calculator path (app-turn mapping) | IN-P19 |
| IN-NBL-01-sv, -champions | a side with no Pokémon left: its last two fall to the first two moves, the third action does not happen | existing `battleOver` |
| IN-PRT-01-sv, -champions | used Protean with `types` set (Meowscarada as Dark) into a Fighting move; and with no type (the reason) | SPEC2 A2 |
| IN-BNC-01-sv, -champions (wave 2) | U-turn with a two-Pokémon bench, no Replacement chosen (the fact); Parting Shot with one chosen | F4 B2 |
| IN-HZD-01-sv, -swsh (wave 2) | Stealth Rock and two Spikes on the newcomer; G-Max Steelsurge (swsh) | F4 B3 |

73 cases: 68 in wave 1, 5 in wave 2 (IN-FSL-02, IN-BNC, IN-HZD need R's bench). Each runs the three walks and is
exhaustive. Every input has a case in SV and one in another game where it exists; the USUM-only and SwSh / USUM-only ones
have two cases in their games (SPEC2 §7.2's rule). IN-STL-04 needs Tier 2 moves' Max Guard and IN-CHG-01 its
semi-invulnerable model; before those land they keep today's reasons (`REASONS.maxGuard`, `REASONS.semiInvulnerable`).

---

## 9. Tests

- **N-E `tests/unit/doubles-history.test.ts`:** the stall branch masses (1/3, 1/9, 1/729 at the cap) and facts; a Protect
  with no later action fails before the roll (no branch); Endure and Max Guard through the same hook; the release (no
  charge, Power Herb kept, `eot.hidden` from the turn's start, cleared at its action or a stopped one); Laser Focus's crit
  through `critRatio` (Shell Armor and Lucky Chant still block); the carried Destiny Bond (a KO before it acts faints the
  attacker; removed at its BeforeMove −1, kept for its own Destiny Bond which then fails; removed on a stopped action);
  `entryTie` (ranks, unknown, a changed ability or newcomer later than every rank); `typeUnknown`; the readers rule (no
  `vol.stall` / `entry` written without a reader: Step 0's world counts unchanged).
- **E additions** (`doubles-eot.test.ts`): the 15 / 16 / 17 countdowns and E2 `turnsLeft`; the field ends at 27.2 / 27.6 /
  27.7 with the IN-P07 outcomes; the facts only when turns are absent.
- **Step 0b** (`status2-plumbing.test.ts`): `laserFocus` makes `certainCrit` non-null; 1v1 untouched.
- **N-U `tests/unit/calculator-doubles-inputs.test.ts`:** every control's "Shown when" per game (a table-driven test over
  the four runtimes), "or while set"; the option lists (names by `doublesNames`, no "left"/"right"/"slot"/"position" in any
  label or option); the mapping into `DoublesTurnInput` (history types on a build copy only: the Combatant's build and the
  cache unchanged; `No Pokémon left to switch in` → `canSwitch[side] = false`; the `… ends this turn` boxes → `weatherTurns`
  / `fieldTurns` 1; `Entered first` → ranks 0 and 1); the reset rules of §5.4; the summary count of §5.5; accessible names unique across the page (all
  `label` texts with their sr-only parts distinct); 375 px no horizontal scroll for the busiest group; the existing
  `calculator-doubles-carried-input.test.ts` passes unchanged after Step 0c's move.
- **T** (`tests/unit/training-bridge-*.test.ts`): each §7 row from a scripted public log; splits.ts no longer forks a
  Protect when `carried.stall` is passed; the removed rollouts; `leak:training` shows the new fields from public lines.
- **V:** every §8 case agrees; `changed-cases.ts` lists the stored redirect-tie cases whose text becomes `entryTie` and the
  stored cases with `Magic Room ending this turn …` / `Side effect safeguard …` in Training fixtures.
- **Source** (`tests/source/status2-hooks.test.ts`, Step 0a's): §4.2's six hook call sites exist; every `DoublesCarried`
  key has a `carriedState` mapping and a `carriedIssues` branch.

---

## 10. Build plan and ownership (additions to SPEC2 §8)

| Part | Owns (exclusive) / adds | Does |
|---|---|---|
| Step 0a (adds) | §3.1–§3.4 in its type files; the §4.1 kernel plumbing (`carriedState`, `startWorld`, `createContext`, `validate`, `carriedIssues`, `turnFacts`, `outcomeOf`); the §4.2 hook calls with stubs in `doubles-turn.ts` (`chargesThisTurn`, `redirect`, `rootWorlds`) and `doubles-status.ts` (`earlyBranch`, `beforeMove`); `doubles-history.ts` with the stubs | behaviour unchanged |
| Step 0b (adds) | `calculate.ts critRatio`: the `laserFocus` marker; `validateConditions` (model.ts): §3.5's field issues for the new 2v2-only keys | behaviour unchanged |
| Step 0c (new, the Step 0a builder) | moves verbatim: `CarriedFields`, `Whose`, `carriedToggles` from `BattleConditions.tsx` into `EarlierTurnFields.tsx`; `CarriedOptions`, `NO_CARRIED_OPTIONS`, `sleepTurnsMax`, `START_CURES`, `carriedAbilityOn`, `carriedOptions`, `substituteMax`, `reconcileCarried`, `CARRIED_ISSUE_FIELDS`, `carriedIssueTexts` from `doubles-prep.ts` into `doubles-inputs.ts` (re-exported from doubles-prep.ts); inert state (`history`, `turnEarlier` = {}) and the three call sites (`doublesSlotInput`, `getDoublesTurnInput`, BattleConditions' render) | UI tests and `calculator-doubles-carried-input.test.ts` unchanged |
| **N-E** (wave 1) | `doubles-history.ts`, `tests/unit/doubles-history.test.ts` | §4.2 |
| **N-U** (wave 1) | `app/(app)/calculator/doubles-inputs.ts`, `app/(app)/calculator/EarlierTurnFields.tsx`, `app/lib/battle/unmodelled-states.ts` (the new 2v2 export only), `tests/unit/calculator-doubles-inputs.test.ts` | §5.1–§5.6 |
| E (adds, its files) | `doubles-eot.ts`, `residuals.ts` | §4.3 rows |
| T (adds, its files) | `sim/bridge.ts`, `sim/splits.ts`, `tests/unit/training-*` | §7 |
| V (adds, its files) | `case-types.ts`, `sim-dfs.ts`, `compare.ts`, `app-turn.ts`, `cases-in.ts` (new), `changed-cases.ts` | §8 |
| U | one line each where Step 0c's call sites need a new prop (the side's `names`, the game) | no new logic |
| **R-U** (wave 2) | `doubles-inputs.ts`, `EarlierTurnFields.tsx` (N-U is done), a new `BenchFields.tsx`, the bench state in `doubles-prep.ts` | §5.7 |

Dependencies: N-E needs Step 0a; N-U needs Step 0c and the contract (fixture results); E's §4.3 rows need N-E's `fieldTurns`
plumbing (Step 0a); T needs the contract; V's IN-CHG-01 needs Tier 2 moves' semi-invulnerable model, IN-ENT's Dancer half
Tier 2 presence. Gate for N-E and N-U: their tests, the IN cases via V, golden-1v1 byte-equal, the 1264 stored cases
agreeing except `changed-cases.ts`'s list.

---

## 11. Risks

1. **Training's numbers move** where the stall roll moves into the engine (exact failed-Protect worlds instead of No move:
   IN-C4) and where carried Taunt and Encore now reach E2's value (their weights already exist; Q7 adds none). Gate: the
   eval and conformance runs against main on the same seeds; splits.ts's removal is its own commit.
2. **Discoverability vs clutter.** Show-when keeps a typical turn at today's controls; the rule "or while set" means a value is
   never hidden. The 375 px test covers the busiest group. If the critic wants fewer controls, §0 item 4's ten (status-eot
   fields) are the ones to drop: no engine change depends on them.
3. **IN-C6**: a 2v2-only build field reaching the shared cache would change 1v1. The type controls write `history`, not the
   build; N-U's test asserts the Combatant build and the cache are unchanged; golden-1v1 is the backstop.
4. **Entry order** needs every ability-state re-make this turn (A1's `setAbility`, R's newcomers) to call `entryChanged`, or a
   tie reads a stale rank. The hooks source test checks both call sites; IN-ENT covers a changed ability.
5. **Release state across families**: `vol.locked` / `eot.hidden` meet Tier 2's semi-invulnerable model and SPEC2 A1's
   Geomancy; the one writer is `carriedState`, the one clearer `releasesNow`'s use and the stopped action.
6. **Widened `cudChew` / `futureMove`** stay backward compatible (`true` / a bare id keep today's reason), so Step 0 is
   byte-equal and Training keeps working until T passes the Berry and the user.

---

## 12. For the user

Nothing needs a decision: Q1–Q4 and Q12 settle every default here. Two scope notes the orchestrator or critic may trim
without a user question: §0 item 4 (the ten status-eot fields' controls, UI only) and the presence rows' inputs
(`Last move in the battle`, `Echoed Voice turns in a row`, `Lost a Pokémon last turn`), which are worth building only if
Tier 2 presence models Copycat, Echoed Voice and Retaliate.
