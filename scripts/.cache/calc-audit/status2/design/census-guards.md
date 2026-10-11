# CENSUS 2: every "not estimated" path still reachable in 2v2

Design only. Branch `calc-2v2-status-2` (main 4008ee8); no app code, test or doc changed. Ground truth: pinned Pokémon
Showdown c23d2e94; `PS/...` is `node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353/...`.

Files in `scripts/.cache/calc-audit/status2/design/`:
- `census-guards.json`: every entry below, machine-readable, with its measured frequencies.
- `census-guards.data.mjs` (the entries) and `census-guards.build.mjs` (writes the json and this file).
- `census-usage.ts` → `census-usage.out(.json)`: per trigger, catalog presence in the four games and its Champions usage share.
- `census-sim.ts` → `census-sim.out(.json)`: 8000 usage-weighted Champions turns and 2000 Scarlet/Violet Random Battle Doubles turns run through today's `calculateDoublesTurn`, with the histogram of reasons.
- `census-probes.ts` → `census-probes.out`: pinned-Showdown protocol for the guards the user named (Matcha Gotcha's per-target drain, U-turn's mid-turn request, Opportunist's timing, Eject Pack, Imposter's target, Harvest twice in one turn, Pickup, Stored Power reading evasion, Red Card's random drag).

## 1. Summary

- **101 entries** in 11 families (switch 9, named 7, final 8, status 18, kernel 29, presence 7, track-e 4, eot 6, settle 4, row 3, training 6); sizes XL 10, M 35, S 49, L 3, - 4. Each of the 39 REASONS keys in `doubles-actions.ts` has a live call site (127 call sites, notIn2v2 alone 50; ADDENDUM's `substituteHit` is gone); the other texts are literals (the start settle, the 1v1 rows, the pairwise step, Training).
- **How often, Champions** (usage-weighted sample, 8000 turns, every Pokémon with a move of any category, random legal targets): **14.2 % of turns are not estimated** and 3.1 % more have the end of turn not estimated: 17.3 % lose something.

| Family | Turn not estimated | End of turn only |
|---|---|---|
| Switch-out, replacement unknown | 336 (4.20 %) | 222 (2.77 %) |
| Spread heal (Matcha Gotcha, Parabolic Charge, Shell Bell) | 278 (3.48 %) | - |
| Disable / Encore without the last move (calculator input) | 228 (2.85 %) | - |
| Type change (Protean, Libero, Roost, Burn Up, Double Shock) | 71 (0.89 %) | - |
| L status moves (census 1) | 39 (0.49 %) | 30 (0.38 %) |
| Trace's random copy (an input the calculator has) | 31 (0.39 %) | - |
| Spread move's effect on its user (Spicy Spray...) | 29 (0.36 %) | - |
| A priority shield or Psychic Terrain against an ally's move | 29 (0.36 %) | - |
| Semi-invulnerable after a charge turn | 13 (0.16 %) | - |
| Imposter | 12 (0.15 %) | - |
| Round, Beat Up, Mirror Coat (presence moves) | 20 (0.25 %) | - |
| Unnerve and a resist Berry | 11 (0.14 %) | - |
| Imprison without the user's moves (input) | 11 (0.14 %) | - |
| Instruct (calling moves) | 7 (0.09 %) | - |
| Fling | 6 (0.07 %) | - |
| One-hit KO moves | 6 (0.07 %) | - |
| Everything else | 6 (0.07 %) | - |

- **Scarlet/Violet proxy** (Random Battle Doubles sets: damaging moves, default abilities, no items; 98 turns had input issues): 11.2 % not estimated, 4.0 % end of turn. The switch family dominates (U-turn, Volt Switch, Flip Turn are common there); Harvest and Shields Down there are artifacts of the proxy (no item, Minior's Core form at full HP).

| Family | Turn not estimated | End of turn only |
|---|---|---|
| Switch-out, replacement unknown | 155 (7.75 %) | 30 (1.50 %) |
| Spread heal (Matcha Gotcha, Parabolic Charge, Shell Bell) | 9 (0.45 %) | - |
| Type change (Protean, Libero, Roost, Burn Up, Double Shock) | 1 (0.05 %) | - |
| Spread move's effect on its user (Spicy Spray...) | 10 (0.50 %) | - |
| Semi-invulnerable after a charge turn | 11 (0.55 %) | - |
| Round, Beat Up, Mirror Coat (presence moves) | 4 (0.20 %) | - |
| Everything else | 33 (1.65 %) | 50 (2.50 %) |

- **Training** (Champions only): 7.4–10.9 % of evaluated cells in scripts/.cache/training/eval/final (byMethod; per-reason counts are not recorded). Every engine reason sends its cell to a rollout (`evaluate.ts:271`); the bridge adds its own (family K).
- **The user's named guards are rare except one**: spread heals (Sinistcha's Matcha Gotcha) are the largest single reason in Champions (3.48 % of turns). Eject Pack and Mirror Herb do not exist in Champions; Opportunist is Espathra's alone; Harvest, Pickup, Fling, one-hit KO moves and Stored Power after an evasion rise are each under 0.1 %.
- **Biggest wins by frequency**: the switch-out family (7.0 % of Champions turns; XL), spread heals (M), the calculator's missing last-move input for Encore and Disable (S, no mechanics), world types for Protean / Libero / Roost (M).
- **Hardest**: (1) slot replacement (a slot's Pokémon changes mid-turn: entry effects, hazards, Intimidate chains, the bench as input in the calculator and as policy or belief in Training, E2 reporting two Pokémon for one slot); (2) the field-change re-settle (Protosynthesis, Quark Drive, Booster Energy, Forecast, Mimicry, Ice Face, Seeds, common in SV); (3) ability changes mid-turn (Neutralizing Gas ending, Skill Swap family, Receiver, Core Enforcer: each new ability's Start); (4) the 73 L moves (census 1).
- **One correctness gap that is not a guard**: a Trace holder that copied a curing ability is not cured as the turn starts (FINAL.md open item; `doubles-status.ts` ownCuresAtStart reads `abilityId`, not `tracedAbility`). Fix it first.

## 2. The guards the user named

| Guard | Reason (exact) | Games | How often | What Showdown does | Modelling | Size |
|---|---|---|---|---|---|---|
| Eject Pack switching out mid-turn | `{Name} switches out: the replacement is not known.` | sv, swsh | no usage data for sv, swsh | A drop marks it; at the move's AfterMove it is used and the holder's player picks a replacement mid-turn (not in Champions). | Slot replacement (chosen) at the action's end; stage events for the drop. | XL |
| Opportunist / Mirror Herb copying a stat rise | `{Opportunist\|Mirror Herb} copying a stat rise is not modelled in 2v2.` | champions, sv | not sampled; its trigger is on < 0.01 % Champions team slots | The foe's positive changes are summed and copied at the end of that action (AfterMove), at a switch-in, or at residual 29; Mirror Herb is then used up. | Stage events with amounts; apply the copy through applyBoosts after the action; Mirror Herb's use. | M |
| Harvest | `Harvest is not modelled in 2v2.` | all four | 0.70 % of SV proxy turns (the proxy number is an artifact: its sets hold no item; in play the guard needs a Berry eaten earlier) | Residual 28.2: in sun, or 1/2 otherwise, a Berry eaten earlier comes back; the final Update can eat it again. | Item history (last Berry), a 28.2 handler with the 1/2 branch, setItem. | M |
| Pickup | `Pickup is not modelled in 2v2.` | all four | not sampled; its trigger is on < 0.01 % Champions team slots | Residual 28.2: an item another active Pokémon used up this turn, picked at random among them. | Item history (used, not taken), a uniform branch, setItem. | M |
| Stored Power / Power Trip / Punishment after an accuracy or evasion change | `{Move} with {Name}'s accuracy or evasion stage from this turn is not modelled in 2v2.` | all four | not sampled; its trigger is on 0.06 % Champions team slots | Stored Power, Power Trip and Punishment count accuracy and evasion stages; the engine counts Attack to Speed. | A base-power override from the hidden stages, 2v2 only. | S |
| Fling | `Fling is not verified for this game. / Fling is not verified for Champions.` | all four | 0.07 % of sampled Champions turns | Power from the item's fling data; the item is gone at the Update; Berries, Herbs, Orbs, Light Ball, King's Rock act on the target. | A verified 1v1 Fling first; then the item loss (Unburden, Symbiosis) and the target's effect. | M |
| one-hit KO moves | `One-hit KO move: no damage range.` | all four | 0.07 % of sampled Champions turns | Fails on a higher level, Dynamax, Sturdy, an Ice type (Sheer Cold) or a type immunity; otherwise deals the target's HP (Endure, Sash, Substitute, Disguise still act). | A target's-HP hit in 2v2 under the hit rule. | S |
| spread heals | `{Move} heals from more than one target: not modelled.` | all four | 3.48 % of sampled Champions turns | Each target's drain heal right after its damage, in hit order; Shell Bell once from the total. | Follow the attacker through the spread steps (drain per target, Shell Bell from the sum). | M |
| (3) the ~73 status moves still not estimated | `{Move} is not modelled and comes before another move. / End of turn: {Move} is not modelled.` | all four | 0.86 % of sampled Champions turns | Census 1. | Census 1. | XL |

## 3. FINAL.md's open list (status-eot build)

| Item | Kind | How often | Modelling | Size |
|---|---|---|---|---|
| Berserk lock reset by a status move, and the lock carried to the next turn | berryLocked | not sampled; its trigger is on 0.06 % Champions team slots | Leftovers stand-in during later hits, berryDue at the action's Update; DoublesCarried.berryLocked for the next turn. | S |
| Psychic Noise before a later action (a seeder's drain) | notIn2v2 | 0.40 % of SV proxy turns | Heal Block through every later step (attacker and target side). | M |
| a Starf eaten by the attacker inside the pairwise engine | step+settle | no usage data for sv, swsh, usum | Branch the world from the step's or the start's eaten Starf. | S |
| Trace-copied curing ability | none (wrong, not guarded) | not sampled; its trigger is on 0.06 % Champions team slots | Read tracedAbility in ownCuresAtStart and the facts (a correctness fix). | S |
| Ghost Curse user's KO chance | none (display) | not sampled; its trigger is on 0.23 % Champions team slots | Record the cost as a loss and the faint as another faint. | S |
| perish projection | none (oracle harness) | not sampled; its trigger is on 1.10 % Champions team slots | compare.ts projects the count after the moves. | S |
| White Herb residual reads Attack to Speed only; end-of-turn Lansat text | none (residual details) | not sampled | Read the hidden stages; settledFocusEnergy. | S |
| canStatus Comatose order | none (fact text) | not sampled | Swap the checks (text only). | S |
| Eject Pack mid-turn, Opportunist / Mirror Herb, the spread heal, Fling, one-hit KO, accuracy and evasion stages, Harvest, Pickup | also named by the user | section 2 | section 2 | - |

## 4. The switch-out family ("{Name} switches out: the replacement is not known.")

One reason, 9 trigger groups, both phases: with a later living action the whole turn is not estimated
(`doubles-turn.ts` eventGuards, hitReactions, afterHit; `doubles-status.ts` switchOut); with none the moves are
estimated and the end of turn is not (`World.leaving` → `doubles-eot.ts:209`).

| Trigger | Who picks the replacement | When it happens | What passes to the newcomer | Games | Champions sample |
|---|---|---|---|---|---|
| U-turn, Volt Switch, Flip Turn | the player (switch request mid-turn) | after the action | nothing | all four | turn 2.16 %, end 0.63 % |
| Parting Shot | the player | after its drops (none if nothing fell and no Mirror Armor) | nothing | all four | turn 1.86 %, end 1.79 % |
| Teleport (gen 8+), Baton Pass, Shed Tail, Chilly Reception | the player | after the action | Baton Pass: stages and passable volatiles; Shed Tail: its Substitute | Baton Pass all four; Teleport SV and SwSh (USUM's fails, modelled); Shed Tail and Chilly Reception SV and Champions | turn 0.13 %, end 0.05 % |
| Roar, Whirlwind | random (uniform over the living bench) | end of the action (dragIn) | nothing | all four | turn 0.04 %, end 0.27 % |
| Dragon Tail, Circle Throw | random | end of the action | nothing | all four | turn 0.01 %, end 0.04 % |
| Eject Button | the holder's player | after the hit (AfterMoveSecondary) | nothing | all four (no Champions usage) | not met |
| Eject Pack | the holder's player | the action's AfterMove after a drop | nothing | SV, SwSh | not met |
| Red Card | random (the attacker's side) | end of the action | nothing | all four (no Champions usage) | not met |
| Emergency Exit, Wimp Out | the holder's player | after the damaging action; after the residual | nothing | Champions, SwSh, USUM (Golisopod, Wimpod) | not met |

What pinned Showdown does (all of them): the leaver's queued action is cancelled (`PS/sim/battle-actions.ts:107`
cancelAction), its ability and item End run, its volatiles clear (Baton Pass and Shed Tail copy first,
`copyVolatileFrom`); the newcomer enters at the same position (`switchIn`, `PS/sim/battle-actions.ts:62-160`), runs
`runSwitch` (`:175-191`: one `fieldEvent('SwitchIn')` with the hazards' onSwitchIn and every switch-in ability and item Start, by handler priority and Speed: Intimidate and its
reactions, weather and terrain setters, Neutralizing Gas, Unnerve, Trace, Imposter, Download, Air Lock, Hospitality,
Costar, Commander, Supersweet Syrup, Zero to Hero's form, Booster Energy, the Seeds, Air Balloon); it has no action this
turn; every later move aimed at that position meets it (`census-probes.out` P2, P4, P9); from generation 8 the queue is
re-sorted after the action, so a newcomer's weather or Tailwind changes the order. A chosen replacement is a switch
request mid-turn (`PS/sim/battle.ts:2876-2914`); a forced one is `dragIn` with `getRandomSwitchable` (`PS/sim/battle.ts:1570-1585`,
`:2821-2829`). The leaver's switch-out effects run (Regenerator's 1/3, Natural Cure, Zero to Hero). No switch happens with no Pokémon to send.

What the engine needs (the replacement enabler):
- **World**: a slot's occupant changes identity: the leaver leaves the factors (its HP kept for the bench outcome), the
  newcomer joins with its own HP factor and state; positions (Ally Switch) and `occupant()` stay positional; the
  newcomer has no pending action; budgets grow by the bench size for random drags.
- **Entry pipeline**: hazards (Stealth Rock by type, Spikes layers, Toxic Spikes, Sticky Web with its reactions; Heavy-Duty
  Boots, Levitate, Magic Guard), then the entry abilities and items in Speed order through the existing hooks
  (Intimidate through `foeDrop` with Defiant, Competitive, Mirror Armor, Guard Dog, Rattled, Clear Amulet, Eject Pack:
  chains of switches are possible), weather and terrain setters through the field-change re-settle.
- **Switch-out**: Regenerator, Natural Cure, the leaver's Neutralizing Gas or Unnerve ending (exists), Commander.
- **Results**: DoublesTurnResult and the card name both Pokémon of the slot ("{Leaver} switches out; {Newcomer} comes
  in."), the leaver's HP when it left, the newcomer's after the turn; E2 (`DoublesOutcome`) reports the slot's new
  occupant and the leaver's bench state, so Training's `postFromOutcome` places the leaver on the bench and the newcomer in the slot.

The calculator needs: per side a bench (the team source's other members, or builds entered there; its HP and status),
a replacement choice per switching Pokémon (an input; no default beyond the bench's first, stated as a fact), the
hazards on each side (new field inputs), and for random drags nothing more than the bench (one branch per member).

Training needs: the AI's own bench is exact; the player's is the belief world's bench (no hidden information beyond the
belief). The chosen replacement is a policy: for the AI the same `ReplacePolicy` the rollouts use
(`sim/rollout.ts:15-41`), for the player the rollouts' healthiest-bench rule (or each option as its own engine world);
random drags branch uniformly over the world's living bench. Hazards come from the battle's public side conditions
(`bridge.ts` ignores them today). `prelude.ts:50`'s "A replacement is needed before the moves." (an entry Intimidate
setting off Eject Pack) is the same piece.

## 5. Cross-cutting enablers

| Enabler | What it is | Entries it unlocks |
|---|---|---|
| replacement | Slot replacement: a slot's Pokémon changes identity mid-turn (a chosen or random bench Pokémon comes in, the leaving one goes to the bench with its HP and its switch-out effects), entry effects run, later moves aimed at that position meet the newcomer, the end of turn and E2 read it. | switch-uturn-voltswitch-flipturn, switch-partingshot, switch-teleport-batonpass-shedtail-chillyreception, switch-roar-whirlwind, switch-dragontail-circlethrow, switch-ejectbutton, switch-ejectpack, switch-redcard, switch-emergencyexit-wimpout, hp-status-moves, face-guards, tr-splits-prelude |
| types | World types: a Pokémon's current types as world state the calculations read (BattleBuild types override into the engine's Pokemon), for Protean, Libero, Burn Up, Double Shock, Roost, Soak, Forest's Curse, Trick-or-Treat, Magic Powder, Reflect Type, Conversion, Conversion 2, Camouflage. | l-moves, roost-type, field-change, type-change-protean, type-change-burnup, tr-ability-changed |
| abilityChange | Ability change mid-turn: a new or suppressed ability as world state with its Start/End run (Skill Swap, Role Play, Entrainment, Worry Seed, Simple Beam, Gastro Acid, Doodle, Core Enforcer, Receiver, Power of Alchemy, Neutralizing Gas ending, Trace). | l-moves, gas-changing-moves, volatile-secondaries, receiver-alchemy, gas-ends-shield, tr-volatiles, tr-ability-changed |
| grounding | Grounding state the calculations read: Smack Down and Thousand Arrows grounding, Ingrain, Magnet Rise, Telekinesis, Roost, as a build flag the pair's calculation takes (the 1v1 search already tracks smackedDown for later uses). | grounding-change, smackdown-later, tr-volatiles, tr-moves-state |
| stageEvents | Boost events with amounts: World.boosted records the stage changes per stat (accuracy and evasion included) for every boost() call, damaging steps included, so AfterBoost readers (Opportunist, Mirror Herb, Eject Pack) act on exact amounts. | switch-ejectpack, copies-rise, cotton-down |
| healBlockSteps | Heal Block through later steps: a heal-blocked Pokémon's drain, Shell Bell, HP Berries and absorbing abilities heal nothing in every later pair step (attacker and target side), as psychicNoiseKeepsBerry does for the hit itself. | psychic-noise, tr-volatiles |
| itemHistory | Item history: per Pokémon its last used item and whether it used one this turn (lastItem, usedItemThisTurn), from Berries eaten, Gems, Focus Sash, Herbs, Seeds, Eject Button, Red Card, Fling, Booster Energy; not from Knock Off, Thief, Trick or Bug Bite. | harvest, pickup, fling, bestow-recycle, symbiosis |
| followAttacker | Spread attacker following: a spread move's per-target steps applied one after another with the attacker's HP followed (drain heal, Shell Bell, per-target retaliation and statuses composed in hit order), the damage still from the state before the move. | spread-heal, spread-effect |
| lastMoveInput | Last-move input in the calculator: a per-slot "last move" (none since it came in, or a move) and, where it matters, the move list; Training already has both from the public log. | needs-last-move, presence-calling |

## 6. Every entry, by family

How-often fields: "Champions sample" is the share of the 8000 sampled turns whose reason (turn, or end of turn
when the moves were estimated) is this entry's; "Champions usage" is the share of team slots that carry the trigger
(training-usage.json) and of fields where one of the four does; "SV proxy" is the Random Battle sample; oracle cases are
the stored corpus's app results with this reason (the corpus was written to exercise the guards: it is coverage, not
frequency).

### A. Switch-out with an unknown replacement (REASONS.switchesOut)

#### switch-uturn-voltswitch-flipturn (XL)

- Reason: `{Name} switches out: the replacement is not known.` (switchesOut; turn+end)
- Where: app/lib/battle/doubles-turn.ts:2322-2326 (afterHit, SWITCH_MOVES); app/lib/battle/doubles-eot.ts:209 (worldGuard: World.leaving)
- Fires: U-turn, Volt Switch or Flip Turn lands a hit (a Substitute's included) and its user is still in: with a later living action the turn is not estimated; with none the moves are estimated and the end of turn is not.
- Games: all four. How often: Champions sample: turn 2.16 %, end 0.63 %; SV proxy: turn 7.75 %, end 1.05 %; Champions usage: 3.54 % of team slots carry it (13.4 % of fields), basculegion 1.97%, staraptor 0.21%, rotomwash 0.18%; oracle cases: 4 (E32a, E32b, R13, S48-UTurn-last).
- Showdown: PS/data/moves.ts:20269 uturn, :20433 voltswitch, :5788 flipturn (selfSwitch); PS/sim/battle-actions.ts:1311-1313 sets switchFlag once the move did something; PS/sim/battle.ts:2876-2914 asks for a switch right after the action (midTurn), the player picks; PS/sim/battle-actions.ts:62-160 switchIn (cancelAction for the leaver, runSwitch: hazards, entry abilities and items); the newcomer has no action this turn and takes later moves aimed at its position (census-probes P2). No switch when the side has no Pokémon to send (battle.ts:2884-2892) or a target's Eject Button fired first (PS/data/items.ts:1680-1698).
- Modelling: Slot replacement with a chosen replacement (calculator input; Training policy), entry effects, the newcomer as the slot's Pokémon for the later moves and the end of turn; the leaver to the bench with Regenerator / Natural Cure / Zero to Hero. Enablers: replacement.

#### switch-partingshot (XL)

- Reason: `{Name} switches out: the replacement is not known.` (switchesOut; turn+end)
- Where: app/lib/battle/doubles-status.ts:1446-1452 (switchMove partingshot), :1912-1919 (switchOut); app/lib/battle/doubles-eot.ts:209
- Fires: Parting Shot lowered a stat (or met Mirror Armor) and the side can switch: with a later living action the turn, otherwise the end of turn.
- Games: all four. How often: Champions sample: turn 1.86 %, end 1.79 %; Champions usage: 5.39 % of team slots carry it (19.9 % of fields), incineroar 4.19%, grimmsnarl 1.19%, morpeko 0.01%; oracle cases: 1 (S48-PartingShot-before).
- Showdown: PS/data/moves.ts:13166 partingshot: onHit boosts the target, returns false (no switch) when nothing changed and no Mirror Armor; selfSwitch; Eject Pack does not react to its drops (PS/data/items.ts:1712). Chosen replacement as U-turn.
- Modelling: As U-turn (slot replacement, chosen). Incineroar alone is 4.2 % of Champions team slots. Enablers: replacement.

#### switch-teleport-batonpass-shedtail-chillyreception (XL)

- Reason: `{Name} switches out: the replacement is not known.` (switchesOut; turn+end)
- Where: app/lib/battle/doubles-status.ts:1436-1445, :1875-1879, :1912-1919
- Fires: Teleport (generation 8 on; USUM's fails, modelled), Baton Pass, Shed Tail (after its cost), Chilly Reception (after its snow) with a Pokémon left to switch in.
- Games: all four. How often: Champions sample: turn 0.13 %, end 0.05 %; Champions usage: 0.24 % of team slots carry it (1.0 % of fields), espathra 0.09%, maushold 0.01%, umbreon 0.00%; oracle cases: 1 (VE-M2-1).
- Showdown: PS/data/moves.ts:19168 teleport (priority -6), :1092 batonpass (selfSwitch copyvolatile: the newcomer takes the stages and passable volatiles, PS/sim/battle-actions.ts:114 copyVolatileFrom), :16162 shedtail (selfSwitch shedtail: only the Substitute passes), :2396 chillyreception (snow, then the switch). Chosen replacement.
- Modelling: Slot replacement, chosen; Baton Pass copies stages and volatiles (confusion, Leech Seed, Substitute, Focus Energy, Ingrain, Aqua Ring, Magnet Rise, Perish Song, Curse...), Shed Tail the Substitute only. Enablers: replacement.

#### switch-roar-whirlwind (XL)

- Reason: `{Name} switches out: the replacement is not known.` (switchesOut; turn+end)
- Where: app/lib/battle/doubles-status.ts:1453-1461 (roar, whirlwind), :1912-1919
- Fires: Roar or Whirlwind drags out a target that Suction Cups, Guard Dog, Ingrain or Dynamax does not keep in, with a Pokémon to come in on its side.
- Games: all four. How often: Champions sample: turn 0.04 %, end 0.27 %; Champions usage: 0.43 % of team slots carry it (1.7 % of fields), farigiraf 0.25%, incineroar 0.05%, archaludon 0.03%.
- Showdown: PS/data/moves.ts:15158 roar, :20761 whirlwind (forceSwitch); PS/sim/battle-actions.ts:1353-1365 forceSwitch sets forceSwitchFlag; PS/sim/battle.ts:2821-2829 dragIn at the end of the action; PS/sim/battle-actions.ts:162-174 dragIn takes PS/sim/battle.ts:1570-1585 getRandomSwitchable: uniform over the side's living bench. No request: the replacement is random.
- Modelling: Slot replacement, random: one world per living bench Pokémon at equal mass (calculator: the bench list; Training: the AI's own bench, the belief world's for the player). Enablers: replacement.

#### switch-dragontail-circlethrow (XL)

- Reason: `{Name} switches out: the replacement is not known.` (switchesOut; turn+end)
- Where: app/lib/battle/doubles-turn.ts:2327-2334 (afterHit, DRAG_MOVES)
- Fires: Dragon Tail or Circle Throw lands on a target that is not Dynamaxed and has no unbroken Suction Cups or Guard Dog.
- Games: all four. How often: Champions sample: turn 0.01 %, end 0.04 %; SV proxy: end 0.45 %; Champions usage: 0.17 % of team slots carry it (0.7 % of fields), garchomp 0.14%, milotic 0.02%, dragapult 0.00%.
- Showdown: PS/data/moves.ts:4209 dragontail, :2451 circlethrow (forceSwitch, priority -6): random replacement as Roar (PS/sim/battle.ts:2821-2829).
- Modelling: As Roar (random replacement). Enablers: replacement.

#### switch-ejectbutton (XL)

- Reason: `{Name} switches out: the replacement is not known.` (switchesOut; turn+end)
- Where: app/lib/battle/doubles-turn.ts:2237-2246 (hitReactions)
- Fires: A damaging hit on a working Eject Button holder that stays in, with a later living action (none: the end of turn).
- Games: all four. How often: Champions usage: 0.00 % of team slots carry it (0.0 % of fields).
- Showdown: PS/data/items.ts:1680 ejectbutton onAfterMoveSecondary: switchFlag on the holder (the player picks), the attacker's own selfSwitch cancelled; not for a status move, a future move, or with no Pokémon to send.
- Modelling: Slot replacement, chosen (the holder's side). Enablers: replacement.

#### switch-ejectpack (XL; named by the user: Eject Pack switching out mid-turn)

- Reason: `{Name} switches out: the replacement is not known.` (switchesOut; turn+end)
- Where: app/lib/battle/doubles-turn.ts:1161-1168 (eventGuards); app/lib/battle/doubles-eot.ts:209
- Fires: A stage drop on a working Eject Pack holder in the action (any boost() drop, accuracy and evasion included; not Parting Shot's), with a later living action; with none, the end of turn.
- Games: sv, swsh. How often: oracle cases: 3 (RS-RV03, RS-RV03b, RS-RV17b).
- Showdown: PS/data/items.ts:1705 ejectpack: onAfterBoost marks it, onAnyAfterMove / onAnySwitchIn / onAnyAfterMega / onResidual (29) uses it, onUseItem needs a Pokémon to send and no other switchFlag; onUse sets switchFlag (the player picks). Champions has no Eject Pack (PS/data/mods/champions/items.ts:282 isNonstandard Past). census-probes P4: after Icy Wind the request comes before the next action, the newcomer takes the later Tackle.
- Modelling: Slot replacement, chosen, at the action's AfterMove (two holders dropped by one spread move: only the first switches, onUseItem). Also at order 29 of the end of turn after a residual drop (today a fact there). Enablers: replacement, stageEvents.

#### switch-redcard (XL)

- Reason: `{Name} switches out: the replacement is not known.` (switchesOut; turn+end)
- Where: app/lib/battle/doubles-turn.ts:2238, :2246
- Fires: A damaging hit on a working Red Card holder that stays in: its attacker, still in, is dragged out (with a later living action; else the end of turn).
- Games: all four. How often: Champions usage: 0.00 % of team slots carry it (0.0 % of fields).
- Showdown: PS/data/items.ts:5142 redcard onAfterMoveSecondary: the item is used even against Ingrain or Suction Cups (DragOut decides), forceSwitchFlag on the attacker; random replacement at the end of the action (census-probes P9: drag, then the newcomer takes the later Tackle).
- Modelling: Slot replacement, random (the attacker's side), the Red Card used up either way. Enablers: replacement.

#### switch-emergencyexit-wimpout (XL)

- Reason: `{Name} switches out: the replacement is not known.` (switchesOut; turn+end)
- Where: app/lib/battle/doubles-turn.ts:1166-1168 (eventGuards, damaging actions only); app/lib/battle/doubles-eot.ts:235-246, 1041-1045 (after the residual: a fact)
- Fires: A damaging move takes an Emergency Exit or Wimp Out holder from above half to half or below, with a later living action; after the residual it is the fact "Switches out after the turn.".
- Games: champions, swsh, usum. How often: Champions usage: 0.00 % of team slots carry it (0.0 % of fields).
- Showdown: PS/data/abilities.ts:1250 emergencyexit, :5493 wimpout (switchFlag; the player picks); runEvent('EmergencyExit') from PS/sim/battle-actions.ts:530, 542, 1015, 1132, 1395 and after the residual PS/sim/battle.ts:2858-2874.
- Modelling: Slot replacement, chosen. Enablers: replacement.

### B. The other guards the user named

#### copies-rise (M; named by the user: Opportunist / Mirror Herb copying a stat rise)

- Reason: `{Opportunist|Mirror Herb} copying a stat rise is not modelled in 2v2.` (copiesRise; turn+end+start)
- Where: app/lib/battle/doubles-turn.ts:1147-1153 (eventGuards); app/lib/battle/doubles-eot.ts:1027-1036 (afterChecks); app/lib/battle/calculate.ts:3291-3296 (settleDoublesStart: an entry Berry's rise)
- Fires: A living foe of a Pokémon whose stage rose in the action (World.boosted rose, or a damaging step raised a stage) has Opportunist or a working Mirror Herb; likewise for a residual rise (Speed Boost) and for a Berry eaten as the turn starts.
- Games: champions, sv. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), espathra 0.00%; oracle cases: 4 (BB18, F22a, RS-RV05, VE-H2-13).
- Showdown: PS/data/abilities.ts:3041 opportunist: onFoeAfterBoost sums every positive change (after ChangeBoost and the cap: the boost table AfterBoost gets, PS/sim/battle.ts:2083), skips copies of Opportunist and Mirror Herb, then boosts itself at onAnyAfterMove (the end of that action), onAnySwitchIn, onAnyAfterMega, onAnyAfterTerastallization or onResidual 29. PS/data/items.ts:4146 mirrorherb: the same events, useItem (item gone: Unburden, Symbiosis, Pickup's usedItemThisTurn). census-probes P3: Espathra's +2 Attack lands right after the foe's Swords Dance, before the next action. Opportunist exists only in SV and Champions (Espathra), Mirror Herb only in SV.
- Modelling: Record the amounts (stageEvents), then at the action's end apply the summed rise to each copier through applyBoosts (its own Contrary, Simple, cap; no copy of the copy); Mirror Herb used up; residual 29 and the start settle the same way. The damaging steps need their per-stat rises (the pairwise step's boost() has no event; the stage difference is exact while no stat both rose and fell in one step). Enablers: stageEvents.

#### harvest (M; named by the user: Harvest)

- Reason: `Harvest is not modelled in 2v2.` (notIn2v2; end)
- Where: app/lib/battle/doubles-eot.ts:218 (worldGuard: a holder with no item after the moves); app/lib/battle/doubles-eot.ts:798-806 (harvestGuard: a Berry eaten inside the residual)
- Fires: A Harvest holder with HP and no item at the end of turn (an item from before the turn: any reason; a Berry eaten in the residual).
- Games: all four. How often: SV proxy: end 0.70 %; Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), trevenant 0.00%; oracle cases: 4 (ER41c, RT-RV21, VT-VE07, VT-VE18); the proxy number is an artifact: its sets hold no item; in play the guard needs a Berry eaten earlier.
- Showdown: PS/data/abilities.ts:1800 harvest onResidual (order 28, subOrder 2, Speed order among the 28.2 handlers): in sun or Desolate Land (field.isWeather: Cloud Nine and Air Lock suppress it, Utility Umbrella does not) or randomChance(1, 2), a holder with HP, no item and a Berry as lastItem gets it back (setItem); the final Update then eats it again if due (census-probes P6: Exeggutor heals twice in one turn).
- Modelling: Item history (lastItem: a Berry eaten this turn, or a carried "last Berry" input; Training reads it from the log), a 28.2 handler with a 1/2 branch outside sun, setItem, then the final Update's Berry check (already modelled). E2 reports the restored Berry. Enablers: itemHistory.

#### pickup (M; named by the user: Pickup)

- Reason: `Pickup is not modelled in 2v2.` (notIn2v2; end)
- Where: app/lib/battle/doubles-eot.ts:219-221 (worldGuard); app/lib/battle/doubles-eot.ts:808-818 (pickupGuard)
- Fires: A Pickup holder with no item while another Pokémon that held one at the turn's start (or the residual's) holds none.
- Games: all four. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), gourgeistsuper 0.00%, dedenne 0.00%, diggersby 0.00%; oracle cases: 4 (ER41b, RT-RV22, VT-VE10, VT-VE11).
- Showdown: PS/data/abilities.ts:3262 pickup onResidual (28.2): with no item, it takes, from a random other active Pokémon (sample) with lastItem and usedItemThisTurn, that item (setItem; the target's lastItem cleared). Knocked-off, stolen or Tricked items do not count (no usedItemThisTurn). census-probes P7: Zigzagoon takes the ally's eaten Sitrus at 28.2.
- Modelling: Item history (used this turn vs taken), a uniform branch over the candidates, setItem with its Start (a picked Berry is eaten at the final Update if due, a Choice item locks nothing this turn). Enablers: itemHistory.

#### hidden-stages (S; named by the user: Stored Power / Power Trip / Punishment after an accuracy or evasion change)

- Reason: `{Move} with {Name}'s accuracy or evasion stage from this turn is not modelled in 2v2.` (hiddenStages; turn)
- Where: app/lib/battle/doubles-turn.ts:546-557 (hiddenStageGuard, from searchFor)
- Fires: Stored Power or Power Trip whose user, or Punishment whose target, has an accuracy or evasion stage above 0 set this turn (Double Team, Coil, Hone Claws, Minimize and Acupressure once modelled, Contrary against an accuracy or evasion drop). Not Z-Move or Max Move.
- Games: all four. How often: Champions usage: 0.06 % of team slots carry it (0.3 % of fields), malamarmega 0.03%, slowbromega 0.01%, klefki 0.00%; oracle cases: 2 (VE-H2-12, VE-ST-1).
- Showdown: PS/data/moves.ts:18111 storedpower, :13852 powertrip (basePower + 20 × positiveBoosts), :14325 punishment (60 + 20 × the target's positiveBoosts, at most 200); PS/sim/pokemon.ts:1201 positiveBoosts counts every boost, accuracy and evasion included (census-probes P8: Speed +1 and evasion +1 give Stored Power 60). @smogon/calc counts Attack to Speed only (node_modules/@smogon/calc/dist/mechanics/util.js:590 countBoosts).
- Modelling: Pass the positive accuracy and evasion stages of the reader (MoveVolatiles.stages; carried ones are not an input today) to the turn's calculation as a base-power override (resolve-move.ts overrides.basePower, as Return uses), 2v2 only: 1v1 never sets it.

#### fling (M; named by the user: Fling)

- Reason: `Fling is not verified for this game. / Fling is not verified for Champions.` (row; turn)
- Where: app/lib/battle/calculate.ts:52-69 (HISTORY_MOVES.fling), :1790-1792; app/lib/battle/doubles-turn.ts:1973 / 2503 (rowReason)
- Fires: Any Fling that reaches a target (the row is needs-context in every game).
- Games: all four. How often: Champions sample: turn 0.07 %; Champions usage: 0.10 % of team slots carry it (0.4 % of fields), sneasler 0.07%, weavile 0.01%, tinkaton 0.01%; oracle cases: 1 (RE43).
- Showdown: PS/data/moves.ts:5734 fling: onPrepareHit fails with no item, an item it cannot take or with no fling data, Klutz, Embargo or Magic Room (ignoringItem); base power = item.fling.basePower; a Berry is eaten by the target (Eat, Cud Chew of the user), item.fling.effect runs on the target (White Herb, Mental Herb), item.fling.status / volatileStatus becomes a 100% secondary (Flame Orb burn, Toxic Orb, Poison Barb, Light Ball paralysis, King's Rock and Razor Fang flinch); the user's fling volatile removes the item at the Update (lastItem, usedItemThisTurn, AfterUseItem: Unburden activates, Symbiosis passes).
- Modelling: First the 1v1 calculation (a verified 1v1 fix across the four games: power from the item's fling data, the effect on the target, the failures; golden-1v1 rows change only with that verification), then in 2v2 the item lost at the user's Update (Unburden for Sneasler's White Herb Fling, Symbiosis, Pickup) and the target's effect (status, flinch, Berry, Herb). Enablers: itemHistory.

#### ohko (S; named by the user: one-hit KO moves)

- Reason: `One-hit KO move: no damage range.` (row; turn)
- Where: app/lib/battle/calculate.ts:1789; app/lib/battle/doubles-turn.ts:1973 (rowReason)
- Fires: Fissure, Guillotine, Horn Drill or Sheer Cold reaching a target (not a Substitute: the turn reads the row first).
- Games: all four. How often: Champions sample: turn 0.07 %; Champions usage: 0.08 % of team slots carry it (0.3 % of fields), snorlax 0.05%, vanilluxe 0.02%, mrrime 0.01%; oracle cases: 1 (RE01b).
- Showdown: PS/sim/battle-actions.ts:696-708: fails on a semi-invulnerable target, a Dynamaxed one, a higher-level one, Sheer Cold on an Ice type (gen 7+); accuracy 30 + level gap (20 for a non-Ice Sheer Cold user), which the turn's hit rule sets aside; PS/sim/battle-actions.ts:1606 damage = target.maxhp (gen 4+), then the Damage event: Sturdy blocks it in TryHit (PS/data/abilities.ts:4673), Endure, Focus Sash at full HP, Focus Band save it, a Substitute breaks, Disguise takes it; type immunity (Fissure into Flying or Levitate) applies.
- Modelling: 2v2 only (1v1 keeps its text unless verified): a hit dealing the target's HP (maxhp capped at its HP) through the existing damage path (Endure, Sash, Sturdy's TryHit, a Substitute's HP, Disguise), with the hit rule's "Every move hits". Fact on the hit: "{Move} is a one-hit KO move.".

#### spread-heal (M; named by the user: spread heals)

- Reason: `{Move} heals from more than one target: not modelled.` (spreadHeal; turn)
- Where: app/lib/battle/doubles-turn.ts:2454 (spreadStep)
- Fires: A draining move (Matcha Gotcha, Parabolic Charge) or any damaging move with a working Shell Bell that reaches more than one target (spreadStep), Explosion's family aside.
- Games: all four. How often: Champions sample: turn 3.48 %; SV proxy: turn 0.45 %; Champions usage: 3.91 % of team slots carry it (14.8 % of fields), sinistcha 3.91%, torkoal 0.00%, bastiodon 0.00%; oracle cases: 2 (RE04, RE05).
- Showdown: PS/sim/battle.ts:2090-2186 spreadDamage: per target in hit order, the damage dealt (capped at its HP), then heal(round(damage × drain)) on the user (Big Root ×1.3, Heal Block, the target's Liquid Ooze damages instead: order matters only with Liquid Ooze; a heal is capped at the maximum, so positive heals add). census-probes P1: two -heal lines, one per foe. PS/data/items.ts:5646 shellbell: one heal of move.totalDamage / 8 after the move (onAfterMoveSecondarySelf).
- Modelling: Follow the attacker through a spread move's steps (followAttacker): each target's step from the pre-move calculation, the attacker's HP updated after it (drain; Liquid Ooze in hit order), Shell Bell once from the summed damage (a convolution of the targets' dealt damage), then Life Orb and the Update. Champions: Sinistcha's Matcha Gotcha alone is 3.4 % of sampled turns, the largest single reason. Enablers: followAttacker.

### C. FINAL.md's open list

#### berry-locked (S; FINAL.md open: Berserk lock reset by a status move, and the lock carried to the next turn)

- Reason: `{Item} after a confusion self-hit with {Ability} is not modelled in 2v2.` (berryLocked; turn)
- Where: app/lib/battle/doubles-turn.ts:1707-1720 (lockedBerryGuard) from applyStep:2018 (a later hit on the holder); app/lib/battle/doubles-status.ts:1334-1341 (a status move reaching the holder)
- Fires: A Berserk or Anger Shell holder hurt itself in confusion (MoveVolatiles.berryLocked), has a healing Berry at or under its line, and a later damaging hit or a status move reaches it.
- Games: all four. How often: Champions usage: 0.06 % of team slots carry it (0.2 % of fields), drampamega 0.05%, drampa 0.01%; oracle cases: 5 (VE-H1-1, VE-H1-2, VE-H1-3, VE-H1-4, VE-H1-C1).
- Showdown: PS/data/abilities.ts:414 berserk, :143 angershell: onDamage sets checked false for a Move effect (the self-hit's), onTryEatItem fails for a healing Berry while false, onAfterMoveSecondary (after any move that reaches it, status moves included: PS/sim/battle-actions.ts:1005) sets it true; the action's Update then eats the Berry. effectState lives on: a lock not reset by the end of turn is carried into the next turn.
- Modelling: In a later hit's step the held healing Berry reads as Leftovers (no eating inside the move, as healBlocked does), then the lock clears and berryDue eats it at the action's Update; a status move clears it and berryDue runs at its Update. Carry the lock: DoublesCarried.berryLocked (E2 volatile, Training bridge from abilityState.checkedBerserk === false / checkedAngerShell, a calculator input for completeness).

#### psychic-noise (M; FINAL.md open: Psychic Noise before a later action (a seeder's drain))

- Reason: `Psychic Noise is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:2418-2435 (volatileGuard)
- Fires: Psychic Noise's Heal Block lands (not stopped by Aroma Veil, Mental Herb cures it) and any living Pokémon still has an action.
- Games: champions, sv. How often: SV proxy: turn 0.40 %; Champions usage: 0.19 % of team slots carry it (0.7 % of fields), farigiraf 0.11%, slowkinggalar 0.05%, oranguru 0.01%; oracle cases: 1 (RT-RV05).
- Showdown: PS/data/moves.ts:14080 psychicnoise: secondary volatileStatus healblock (2 turns); the healblock condition stops heal-flag moves at BeforeMove (modelled: doubles-status.ts healBlockCheck), TryHeal for drain, Shell Bell, HP Berries (onTryEatItem), Leftovers, the absorbing abilities' heals, Pollen Puff onto it, Leech Seed's gain (the end of turn models it).
- Modelling: Heal Block through later steps (healBlockSteps): the pairwise step gets a heal-blocked attacker (no drain, Shell Bell or attacker HP Berry) and target (HP Berry kept, as psychicNoiseKeepsBerry), absorbEffect heals nothing; then remove the guard. Enablers: healBlockSteps.

#### starf-random (S; FINAL.md open: a Starf eaten by the attacker inside the pairwise engine)

- Reason: `Starf Berry raises a random stat` (step+settle; turn)
- Where: app/lib/battle/uses-to-ko.ts:3822, :3835 (the attacker eats a Starf Berry inside a pair step; stop); app/lib/battle/calculate.ts:3290 (settleDoublesStart: a Starf Berry eaten as the turn starts)
- Fires: An attacker eats its own Starf Berry in its step (its recoil, Life Orb or the target's retaliation takes it to its line), or eats one with Bug Bite / Pluck; or a Starf Berry is due at the turn's start.
- Games: sv, swsh, usum. How often: oracle cases: 2 (BB17, VE-F1-15).
- Showdown: PS/data/items.ts:5985 starfberry: +2 (Ripen +4) to one stat below +6 at random (this.sample).
- Modelling: Return the Starf as an outcome of the step (the attacker's eaten item) and branch the world over the open stats (ateBerry already does for the target); at the start, branch the root worlds (the 1v1 has starfOutcomes, calculate.ts:2689).

#### trace-curing-ability (S; FINAL.md open: Trace-copied curing ability)

- Reason: `(no reason: the turn is estimated without the cure)` (none (wrong, not guarded); turn)
- Where: app/lib/battle/doubles-status.ts:190-206 (ownCuresAtStart reads build.abilityId, not tracedAbility); app/lib/battle/doubles-status.ts:648-667 (turnFacts)
- Fires: A Trace holder whose copied ability cures its status (Immunity, Limber, Insomnia, Vital Spirit, Water Veil, Water Bubble, Thermal Exchange, Own Tempo, Oblivious, Pastel Veil) starts the turn with that status.
- Games: all four. How often: Champions usage: 0.06 % of team slots carry it (0.2 % of fields), gardevoir 0.03%, alakazammega 0.02%, meowsticfmega 0.01%.
- Showdown: PS/data/abilities.ts:5118 trace: setAbility; the copied ability's onUpdate cures at the turn's first Update (as an own one: status-eot's turnStartUpdate).
- Modelling: Read the effective ability (tracedAbility when abilityId is trace) in ownCuresAtStart, the turn facts and the UI control for what the ability cures. A correctness gap (the only one here that is not a guard): fix first.

#### ghost-curse-ko-chance (S; FINAL.md open: Ghost Curse user's KO chance)

- Reason: `(no reason: the user's card shows no KO chance from its own Curse)` (none (display); turn)
- Where: app/lib/battle/doubles-status.ts:1740-1746 (curse handler: a step fact and cost)
- Fires: A Ghost-type Curse user whose half-HP cost can knock it out.
- Games: all four. How often: Champions usage: 0.23 % of team slots carry it (0.9 % of fields), mudsdale 0.10%, mimikyu 0.06%, dragapult 0.02%.
- Showdown: PS/data/moves.ts:3266 curse: directDamage(maxhp / 2) on the user, which can faint it.
- Modelling: Record the cost as a loss outside any step (kernel.lossFact, DoublesHP.losses) and the faint in otherFaints, so the card's HP KO chance carries it without a reached hit (compare.ts's status-hit reach stays).

#### perish-projection (S; FINAL.md open: perish projection)

- Reason: `(no reason: compare.ts does not check a perish count after the moves)` (none (oracle harness); end)
- Where: scripts/.cache/calc-audit/2v2/verify/compare.ts (E2 with the end of turn not estimated)
- Fires: E2 after the moves with a perish count, the end of turn not estimated.
- Games: all four. How often: Champions usage: 1.10 % of team slots carry it (4.3 % of fields), gengarmega 0.58%, politoed 0.45%, altaria 0.03%.
- Showdown: PS/data/moves.ts:13234 perishsong: perish count 3 after this turn's residual (order 24).
- Modelling: compare.ts projects outcomeMon.perishCount after the moves (count - 1 of the residual not run) and a case covers it. Harness only.

#### eot-white-herb-lansat-text (S; FINAL.md open: White Herb residual reads Attack to Speed only; end-of-turn Lansat text)

- Reason: `(no reason)` (none (residual details); end)
- Where: app/lib/battle/doubles-eot.ts (White Herb at 29 reads Attack to Speed; the end-of-turn Lansat sets focusEnergy)
- Fires: White Herb at order 29 with a lowered accuracy or evasion stage made while items did not work; a Lansat Berry eaten at an end-of-turn Update (the text names Focus Energy).
- Games: all four. How often: not met in the samples or the stored cases.
- Showdown: PS/data/items.ts:7654 whiteherb onUpdate restores every lowered boost, accuracy and evasion included; PS/data/items.ts:3249 lansatberry adds the focusenergy volatile.
- Modelling: Read MoveVolatiles.stages in the residual White Herb; set settledFocusEnergy for the residual Lansat as ateBerry does. Exactness of rare paths.

#### comatose-order (S; FINAL.md open: canStatus Comatose order)

- Reason: `(no reason: only the fact text could differ)` (none (fact text); turn)
- Where: app/lib/battle/doubles-status.ts:2116-2127 (canStatus: Comatose before the type immunity)
- Fires: A status move into a Comatose holder of an immune type (no such species).
- Games: all four. How often: not met in the samples or the stored cases.
- Showdown: PS/sim/pokemon.ts setStatus: runStatusImmunity before the SetStatus handlers.
- Modelling: Swap the two checks; no number changes.

### D. Status-move guards (doubles-status.ts)

#### l-moves (XL; named by the user: (3) the ~73 status moves still not estimated)

- Reason: `{Move} is not modelled and comes before another move. / End of turn: {Move} is not modelled.` (notModelledBefore / notModelled; turn / end)
- Where: app/lib/battle/doubles-status.ts:778-786 (statusMove: kind L); app/lib/battle/doubles-eot.ts:208 (World.endGuard)
- Fires: Any of the 73 L status moves is used: with a later living action the turn; as the last action the end of turn (it does nothing in the moves).
- Games: all four. How often: Champions sample: turn 0.49 %, end 0.38 %; Champions usage: 0.96 % of team slots carry it (3.8 % of fields), malamarmega 0.04%, politoed 0.02%, alcremie 0.01%; oracle cases: 11 (S48-Attract-before, S48-Attract-last, S48-Bestow-before-usum, S48-Bestow-last-usum, S48-SkillSwap-before, S48-SkillSwap-last, …).
- Showdown: The 73 L status moves (status-table.ts kind L) are census 1's (the move-by-move design); listed here for the guard path only.
- Modelling: The 73 L status moves (status-table.ts kind L) are census 1's (the move-by-move design); listed here for the guard path only. Enablers: types, abilityChange.

#### hp-status-moves (M)

- Reason: `{Move} is not modelled.` (notModelled; turn)
- Where: app/lib/battle/doubles-actions.ts:59-63 (HP_STATUS_MOVES); app/lib/battle/doubles-status.ts:457 (presenceGuards)
- Fires: Revival Blessing (kind P), Purify, Stuff Cheeks, Swallow or Teatime chosen by any Pokémon (presence: wherever it comes).
- Games: all four. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), simisage 0.00%.
- Showdown: PS/data/moves.ts:15111 revivalblessing (a fainted party member back at half: a slot switch request), :14347 purify, :18253 stuffcheeks (eats its Berry, +2 Def), :18574 swallow (Stockpile layers), :19036 teatime (every active Pokémon eats its Berry).
- Modelling: Census 1 (L moves). Revival Blessing needs the bench (replacement enabler). Enablers: replacement.

#### bestow-recycle (S)

- Reason: `{Move} is not modelled.` (notModelled; end)
- Where: app/lib/battle/doubles-status.ts:782-784
- Fires: Bestow (USUM) giving an item its receiver uses at the Update, or Recycle with no item, as the last action.
- Games: all four. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), appletun 0.00%, simipour 0.00%; oracle cases: 2 (S48-Bestow-before-usum, S48-Bestow-last-usum).
- Showdown: PS/data/moves.ts:1237 bestow, :14822 recycle (needs lastItem).
- Modelling: Census 1; Recycle needs item history. Enablers: itemHistory.

#### needs-last-move (S)

- Reason: `{Move} needs {Name}'s move from the last turn.` (needsLastMove; turn)
- Where: app/lib/battle/doubles-status.ts:1349-1361 (lastMoveFailure)
- Fires: Disable or Encore into a Pokémon still to act whose lastMove is not given. The calculator never gives lastMove (doubles-prep.ts:287-292 doublesSlotInput); Training does (bridge.ts:344).
- Games: all four. How often: Champions sample: turn 2.85 %; Champions usage: 5.48 % of team slots carry it (20.2 % of fields), whimsicott 3.01%, ninetalesalola 0.65%, sableye 0.48%; oracle cases: 1 (S48-Encore-noLastMove); every sampled case is the calculator's missing input.
- Showdown: PS/data/moves.ts:3649 disable, :4725 encore read target.lastMove (fail with none).
- Modelling: No mechanics missing: a calculator input (lastMoveInput). Champions: 2.9 % of sampled turns (Whimsicott's Prankster Encore), all from the missing input. Enablers: lastMoveInput.
- UI: Per slot: "Last move" (none since it came in, or one of its moves).

#### encore-change (M)

- Reason: `Encore changes {Name}'s move: not modelled.` (encoreChange; turn)
- Where: app/lib/battle/doubles-status.ts:1651
- Fires: Encore lands on a Pokémon still to act whose queued move differs from its last move (no Mental Herb).
- Games: all four. How often: Champions usage: 5.48 % of team slots carry it (20.2 % of fields), whimsicott 3.01%, ninetalesalola 0.65%, sableye 0.48%; oracle cases: 1 (S44e).
- Showdown: PS/data/moves.ts:4725 encore condition onOverrideAction: when the target's action runs, PS/sim/battle-actions.ts:227-234 runMove swaps in the encored move, keeps the chosen move's priority (its bracket stays) and picks a random target for it (getRandomTarget).
- Modelling: At the target's runMove: the encored move with the old priority and a random target (one world per legal target, as randomNormal), its calculations the encored move's. Needs the encored move to be one the engine can calculate.

#### needs-moves (S)

- Reason: `Imprison needs {Name}'s moves.` (needsMoves; turn)
- Where: app/lib/battle/doubles-status.ts:1580-1585
- Fires: Imprison lands while a foe still has an action and the user's moves are not given. The calculator gives the Imprison user's move slots (doubles-prep.ts:289-291); Training gives every moves list.
- Games: all four. How often: Champions sample: turn 0.14 %; Champions usage: 0.71 % of team slots carry it (2.8 % of fields), farigiraf 0.44%, sinistcha 0.19%, chandelure 0.02%; oracle cases: 1 (S48-Imprison-noMoves); the sampler gives no moves list; the app always does.
- Showdown: PS/data/moves.ts:9490 imprison.
- Modelling: Input only; reachable from the app only through an empty move slot. Keep.

#### grounding-change (M)

- Reason: `{Move} changes whether {Name} is grounded: later moves are not modelled.` (groundingChange; turn)
- Where: app/lib/battle/doubles-status.ts:1556-1571 (Ingrain on an ungrounded user, Magnet Rise on a grounded one, with a later damaging move)
- Fires: Ingrain used by an ungrounded Pokémon or Magnet Rise by a grounded one, while a living Pokémon still has a damaging move.
- Games: all four. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), klefki 0.00%, steelixmega 0.00%, scovillain 0.00%; oracle cases: 2 (S39b, S39d).
- Showdown: PS/data/moves.ts:9610 ingrain (grounds: PS/sim/pokemon.ts isGrounded), :10854 magnetrise (Ground immunity).
- Modelling: Grounding enabler: the later calculations take the grounded state (a Ground move into the Ingrained Flying type, none into the Magnet Rise user; Grassy Terrain, Psychic Terrain and Misty Terrain reads already use grounded()). Enablers: grounding.

#### roost-type (M)

- Reason: `Roost changes {Name}'s type: later moves are not modelled.` (typeChange; turn)
- Where: app/lib/battle/doubles-status.ts:1419-1425
- Fires: A Flying user (not Terastallized) uses Roost while a living Pokémon still has a damaging move.
- Games: all four. How often: Champions sample: turn 0.20 %; Champions usage: 1.96 % of team slots carry it (7.6 % of fields), staraptormega 1.63%, corviknight 0.21%, altariamega 0.03%; oracle cases: 1 (S48-Roost-flying).
- Showdown: PS/data/moves.ts:15429 roost condition onType: Flying removed until the turn ends (a pure Flying type becomes Normal from gen 5).
- Modelling: World types (the later calculations read the types without Flying; pure Flying → Normal). Champions: Staraptor-Mega and Corviknight, 0.2 % of turns. Enablers: types.

#### pain-split-dynamax (S)

- Reason: `Pain Split with a Dynamaxed Pokémon is not modelled in 2v2.` (withDynamax; turn)
- Where: app/lib/battle/doubles-status.ts:1789
- Fires: Pain Split where the user or the target is Dynamaxed (Sword/Shield).
- Games: swsh. How often: oracle cases: 1 (S48-PainSplit-dynamax-swsh).
- Showdown: PS/data/moves.ts:13129 painsplit: getUndynamaxedHP on both, sethp scaled (PS/sim/pokemon.ts sethp with Dynamax).
- Modelling: Undynamaxed HP arithmetic in mapJoint (the end of turn already has undynamaxed()).

#### face-self-hit (S)

- Reason: `Disguise against a confusion self-hit is not modelled in 2v2.` (faceSelfHit; turn)
- Where: app/lib/battle/doubles-status.ts:401-404 (confusionHit)
- Fires: A confused Mimikyu with an intact Disguise (not transformed) hurts itself.
- Games: all four. How often: Champions usage: 0.17 % of team slots carry it (0.7 % of fields), mimikyu 0.17%; oracle cases: 1 (S48-Disguise-selfhit).
- Showdown: PS/data/abilities.ts:970 disguise onDamage: any Move-type effect while intact (the confusion self-hit is one) becomes 0, busted form at the Update, 1/8 chip from gen 8.
- Modelling: As faceHit for the self-hit: no damage, busted form, the chip (gen 8+), no Berry check other than the chip's.

#### sleep-talk-uproar (M)

- Reason: `Sleep Talk is not modelled in 2v2. / Uproar is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-status.ts:458-468 (presenceGuards); app/lib/battle/doubles-status.ts:762-767 (statusMove); app/lib/battle/doubles-turn.ts:801 (Comatose Sleep Talk)
- Fires: Sleep Talk used asleep (with a wake chance below 1) or with Comatose; Uproar while a Pokémon sleeps or a sleep can start this turn.
- Games: all four. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), typhlosionhisui 0.00%, slowbromega 0.00%, aromatisse 0.00%; oracle cases: 4 (F14a, F14c, S47b, S47c).
- Showdown: PS/data/moves.ts:16867 sleeptalk: a random move among the user's (no noSleepTalk, no charge moves); PS/data/moves.ts:20211 uproar: wakes every sleeper, stops sleep while it lasts (3 turns, locked).
- Modelling: Sleep Talk: the user's moves (Training has them; the calculator's move slots) and a uniform branch over the callable ones, each run as the called move. Uproar: its volatile on the field (Uproar's onAnySetStatus / onAnyStart wake and block), the wake at its use.

#### safeguard-damaging-status (S)

- Reason: `Safeguard is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-status.ts:534-539 (afterHit)
- Fires: Safeguard set this turn on the target's side, and a later foe's damaging move gives its every-use status there (no Infiltrator).
- Games: all four. How often: Champions usage: 0.02 % of team slots carry it (< 0.1 % of fields), meowstic 0.02%, sableye 0.01%, vivillon 0.00%.
- Showdown: PS/data/moves.ts:15576 safeguard onSetStatus (a move's status from another Pokémon, Infiltrator passes).
- Modelling: The pair's step takes the side's Safeguard (a UsesEnv flag that blocks its every-use statuses), or the turn strips the status after the step. Training also: Safeguard up from an earlier turn is a rollout (bridge.ts:282, MAPPED_SIDE lacks it).

#### helping-hand-twice (S)

- Reason: `Helping Hand is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-status.ts:849-851
- Fires: A second Helping Hand on the same Pokémon in one turn (only through a called or copied Helping Hand: every calling move is guarded first).
- Games: all four. How often: not met in the samples or the stored cases.
- Showdown: PS/data/moves.ts:8574 helpinghand: onRestart adds another 1.5x.
- Modelling: Unreachable while the calling moves stay guarded; keep as a defensive guard.

#### ate-redirect (S)

- Reason: `{Ability} is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-status.ts:1058-1068 (targetsOf)
- Fires: A status move whose type an -ate ability, Normalize or Liquid Voice changed, with a Lightning Rod or Storm Drain holder of either type in.
- Games: all four. How often: not met in the samples or the stored cases.
- Showdown: PS/data/abilities.ts:2343 lightningrod / :4636 stormdrain onAnyRedirectTarget read move.type after ModifyType.
- Modelling: Pass the used type to the kernel's redirection (redirect reads usedType for damaging moves only).

#### unburden-start-berry (S)

- Reason: `{Item} is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-status.ts:173-175 (turnStartUpdate)
- Fires: An Unburden holder eats a curing Berry at the turn's first Update.
- Games: all four. How often: Champions usage: 2.76 % of team slots carry it (10.6 % of fields), sneasler 2.75%, sceptile 0.01%, hawlucha 0.00%.
- Showdown: PS/data/abilities.ts:5235 unburden onAfterUseItem: doubled Speed once the item is used.
- Modelling: Set abilityActive with the eaten Berry (as cureConfusionBerry already does mid-turn) before the first sort; gen 7's frozen order reads the start Speed.

#### field-change (L)

- Reason: `A weather or terrain change this turn would change {Name}.` (fieldChange; turn+end)
- Where: app/lib/battle/doubles-status.ts:928-936 (fieldGuard: weather and terrain moves); app/lib/battle/doubles-eot.ts:1098-1105 (fieldChangeGuard: the weather ending, a strong weather's holder fainting); app/lib/battle/uses-to-ko.ts:3142, 3446, 3150-3156 (staleField: a damaging move setting or ending the field: Max Moves, Ice Spinner, Steel Roller, Seed Sower)
- Fires: The weather or terrain changes during the turn while a living Pokémon has Forecast, Mimicry, Protosynthesis, Quark Drive, Flower Gift or Ice Face, or holds a Terrain Seed or Booster Energy.
- Games: all four. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), castform 0.00%, stunfiskgalar 0.00%; oracle cases: 2 (M24i, M24j).
- Showdown: PS/data/abilities.ts:3513 protosynthesis, :3650 quarkdrive (onWeatherChange / onTerrainChange: start or end the boost, Booster Energy used when the field ends), :1470 forecast, :2581 mimicry, :1382 flowergift, :1969 iceface (snow re-forms it), PS/data/items.ts:1795 electricseed and kin (onTerrainChange: used), :622 boosterenergy.
- Modelling: Re-settle each field-settled holder when the field changes (the 1v1 settle's rules, per world): Protosynthesis / Quark Drive start (the highest stat), end (unless Booster Energy, then used), Forecast and Mimicry types (types enabler), Flower Gift, Ice Face back to its intact form in snow, a Seed used. SV: Protosynthesis and Quark Drive are common, so any weather or terrain move there meets it. Enablers: types.

#### activates (S)

- Reason: `{Move} would activate {Name}.` (activates; turn)
- Where: app/lib/battle/doubles-status.ts:937-945
- Fires: Tailwind with a Wind Rider or Wind Power holder on its side; Trick Room with a Room Service holder in.
- Games: sv, swsh. How often: not met in the samples or the stored cases.
- Showdown: PS/data/abilities.ts:5527 windrider onSideConditionStart tailwind (+1 Attack), :5509 windpower (charge); PS/data/items.ts:5306 roomservice (onAnyPseudoWeatherChange: −1 Speed, used).
- Modelling: Apply the stage (selfBoost; Room Service used: Unburden, Symbiosis) or the charge as Tailwind or Trick Room starts.

#### gas-changing-moves (L)

- Reason: `{Move} with Neutralizing Gas is not modelled in 2v2.` (withGas; turn)
- Where: app/lib/battle/doubles-status.ts:775-776 (GAS_CHANGING_MOVES); app/lib/battle/doubles-turn.ts:783-784 (an ability replacer under gas)
- Fires: Under Neutralizing Gas: Gastro Acid, Worry Seed, Simple Beam, Entrainment, Skill Swap, Role Play, Doodle, Transform, Roar, Whirlwind, Trick, Switcheroo, Bestow, Corrosive Gas, Embargo or Magic Room; or Mummy, Lingering Aroma or Wandering Spirit present.
- Games: sv, swsh. How often: oracle cases: 3 (NG21, VG24, VG39).
- Showdown: PS/data/abilities.ts:2905 neutralizinggas (onEnd re-runs every other ability's Start, PS/sim/pokemon.ts ignoringAbility).
- Modelling: Ability-change enabler with the gas: which abilities are suppressed recomputed when an ability or an Ability Shield changes. SV and SwSh only (no Neutralizing Gas in Champions or USUM). Enablers: abilityChange.

### E. Damaging-move and third-party guards (doubles-turn.ts)

#### type-change-protean (M)

- Reason: `{Protean|Libero} changes {Name}'s type: later moves are not modelled.` (typeChange; turn)
- Where: app/lib/battle/doubles-status.ts:680-687 (proteanGuard, from damagingMove:1827, statusMove's prepareHit)
- Fires: An unused Protean or Libero holder (not Terastallized) uses a move of another type (not a future or calling move) while a living Pokémon still has a damaging move.
- Games: all four. How often: Champions sample: turn 0.68 %; Champions usage: 0.24 % of team slots carry it (0.9 % of fields), meowscarada 0.14%, greninjamega 0.08%, greninja 0.02%; oracle cases: 1 (R02).
- Showdown: PS/data/abilities.ts:3497 protean, :2318 libero onPrepareHit: setType(move type), once per switch-in from gen 9 (abilityState.protean).
- Modelling: World types (types enabler) and the build's used flag. Training: a Protean already used this stint is a rollout (bridge.ts:297) for the same reason; the types enabler removes both. Champions: Meowscarada and Greninja-Mega, 0.6 % of turns. Enablers: types.
- Training: bridge.ts:297 rollout `{Name}: {ability} was used this stint.`

#### type-change-burnup (S)

- Reason: `{Burn Up|Double Shock} changes {Name}'s type: later moves are not modelled.` (typeChange; turn)
- Where: app/lib/battle/doubles-turn.ts:2335-2339 (afterHit)
- Fires: Burn Up or Double Shock hits (a Substitute's included), the user not Terastallized, with a later damaging move.
- Games: all four. How often: Champions sample: turn 0.01 %; SV proxy: turn 0.05 %; Champions usage: 0.01 % of team slots carry it (< 0.1 % of fields), typhlosionhisui 0.01%, arcanine 0.00%, armarouge 0.00%; oracle cases: 2 (R03, R07).
- Showdown: PS/data/moves.ts:2092 burnup, :3946 doubleshock self.onHit setType (the type removed; '???' when none is left).
- Modelling: World types. Enablers: types.

#### glaive-rush (M)

- Reason: `Glaive Rush doubles the damage {Name} takes: later moves are not modelled.` (takesDouble; turn)
- Where: app/lib/battle/doubles-turn.ts:2340-2341
- Fires: Glaive Rush hits with a later damaging move (SV, Champions).
- Games: champions, sv. How often: SV proxy: turn 0.20 %; Champions usage: 0.00 % of team slots carry it (0.0 % of fields); oracle cases: 1 (R14).
- Showdown: PS/data/moves.ts:6648 glaiverush self volatile: onSourceModifyDamage 2x, every move hits it, until its next move.
- Modelling: A defender flag the pair's calculation reads (2x final damage, applied in the right modifier slot; the engine may need a field for it).

#### semi-invulnerable (M)

- Reason: `{Name} is semi-invulnerable after {Move}: later moves are not modelled.` (semiInvulnerable; turn)
- Where: app/lib/battle/doubles-turn.ts:1877-1891 (chargeTurn)
- Fires: Fly, Dig, Dive, Bounce, Phantom Force or Shadow Force charges (no Power Herb) while a living Pokémon still has an action.
- Games: all four. How often: Champions sample: turn 0.16 %; SV proxy: turn 0.55 %; Champions usage: 0.27 % of team slots carry it (1.1 % of fields), annihilape 0.14%, dragapult 0.08%, mimikyu 0.03%.
- Showdown: PS/data/moves.ts fly, dig, dive, bounce condition onInvulnerability: every move misses it but Gust, Twister, Sky Uppercut, Thunder, Hurricane, Smack Down, Thousand Arrows (Fly, Bounce), Earthquake and Magnitude (Dig), Surf and Whirlpool (Dive); then 2x: onSourceModifyDamage for Gust and Twister on Fly, Earthquake and Magnitude on Dig, Surf and Whirlpool on Dive, onSourceBasePower for Gust and Twister on Bounce; phantomforce and shadowforce onInvulnerability false (no exception); No Guard and Lock-On pass any of them; a spread move keeps its spread modifier for the others (move.spreadHit is set before the hit steps).
- Modelling: A hidden state the later hits read: a miss fact for the moves that cannot reach it (the step stops), the exceptions with their 2x (an engine modifier), No Guard. Phantom Force and Shadow Force have no exception: the easy half.

#### smackdown-later (S)

- Reason: `{Smack Down|Thousand Arrows} is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:2309 (afterHit: outcome.target.smackedDown with a later action)
- Fires: Smack Down or Thousand Arrows grounds an ungrounded target while a living Pokémon still has an action.
- Games: all four. How often: Champions usage: 0.02 % of team slots carry it (< 0.1 % of fields), snorlax 0.02%, mudsdale 0.00%, toxapex 0.00%.
- Showdown: PS/data/moves.ts:16955 smackdown, :19332 thousandarrows: the smackdown volatile grounds it (Ground moves hit, Magnet Rise and Telekinesis end).
- Modelling: Grounding enabler (the end of turn already reads eot.smackedDown). Enablers: grounding.

#### volatile-secondaries (M)

- Reason: `{Core Enforcer|Burning Jealousy|Alluring Voice|Spectral Thief} is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:2418-2435 (volatileGuard; Psychic Noise is its own entry)
- Fires: With a later living action: Core Enforcer on a target that has moved, Burning Jealousy or Alluring Voice on a target whose stats rose this turn, Spectral Thief's stolen rises.
- Games: all four. How often: Champions usage: 0.06 % of team slots carry it (0.2 % of fields), torkoal 0.01%, milotic 0.01%, jolteon 0.01%.
- Showdown: PS/data/moves.ts:2874 coreenforcer (gastroacid volatile if the target has moved), :2071 burningjealousy and :282 alluringvoice (100% burn / confusion if statsRaisedThisTurn), :17415 spectralthief (stealsBoosts before the damage).
- Modelling: Burning Jealousy: giveStatus; Alluring Voice: confusion (status pipeline exists); Core Enforcer: ability change (suppressed); Spectral Thief: the stolen stages onto the user's build after the step. Enablers: abilityChange.

#### spread-effect (M)

- Reason: `{Move}'s effect on {Name} from more than one target is not modelled.` (spreadEffect; turn)
- Where: app/lib/battle/doubles-turn.ts:2533-2541 (spreadStep: the attacker's state after each target's step differs)
- Fires: A spread move whose per-target steps leave the attacker in different states: a target's Spicy Spray burn (Champions' Scovillain-Mega), Rocky Helmet or Rough Skin on a contact spread move, a resist Berry the attacker eats... Not the HP (spreadStep sums the retaliation).
- Games: all four. How often: Champions sample: turn 0.36 %; SV proxy: turn 0.50 %.
- Showdown: PS/sim/battle-actions.ts spreadMoveHit: the damage of every target first, then each target's DamagingHit and secondaries in target order (a status lands once: the second fails; stages add with the cap).
- Modelling: Compose the attacker's per-target changes in hit order (status: the first; stages: summed through boost(); items: once) instead of requiring one state (followAttacker). Champions: 0.4 % of turns, nearly all Scovillain-Mega's Spicy Spray. Enablers: followAttacker.

#### spread-contact-ko (S)

- Reason: `{Protecting move} is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:2472-2476 (spreadStep contact); app/lib/battle/doubles-turn.ts:1640-1646 (protectContact through a Z-Move or Max Move with the attacker's HP followed)
- Fires: A contact spread move whose protecting-move contact effect (Spiky Shield's 1/8) can knock the attacker out before it hits the rest; Spiky Shield's damage through protection with the attacker's HP followed.
- Games: all four. How often: not met in the samples or the stored cases.
- Showdown: PS/sim/battle-actions.ts:550-577 trySpreadMoveHit: the protection's TryHit for every target first; the hit loop reads no user HP, so the fainted attacker still hits the rest.
- Modelling: The rest's hits from the pre-move state with the attacker fainted afterwards (the faint batch order), and the Z/Max case's loss ordered before the step's own (followAttacker).

#### ally-effect (S)

- Reason: `{Queenly Majesty|Dazzling|Armor Tail|Psychic Terrain} against an ally's move is not modelled.` (allyEffect; turn)
- Where: app/lib/battle/doubles-turn.ts:1914-1920 (moveFailure)
- Fires: A priority move aimed at the user's own ally while that ally has a priority shield, or Psychic Terrain is up.
- Games: all four. How often: Champions sample: turn 0.36 %; Champions usage: 4.24 % of team slots carry it (15.9 % of fields), farigiraf 3.76%, tsareena 0.48%; the sampler aims a third of single-target moves at the ally; in play this is rare.
- Showdown: PS/data/abilities.ts:3716 queenlymajesty, :864 dazzling, :215 armortail onFoeTryMove (foes only); PS/data/moves.ts:14096 psychicterrain onTryHit (foes' moves only). The engine's own calculation blocks from any side.
- Modelling: Calculate an ally's priority move with the shield stood in (GAS_STAND_IN for the target's ability) and the terrain block off. (The sampler's 0.4 % is inflated: it aims a third of single-target moves at the ally.)

#### redirect-tie (S)

- Reason: `{Follow Me|Rage Powder|Spotlight|Lightning Rod|Storm Drain} is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:1356-1361 (redirect)
- Fires: Two redirection handlers of equal priority and equal Speed on different Pokémon (their order is the ability's effectOrder, which the turn does not know).
- Games: all four. How often: Champions usage: 6.72 % of team slots carry it (24.3 % of fields), sinistcha 3.86%, maushold 1.11%, scovillainmega 0.79%.
- Showdown: PS/sim/battle.ts:413-419 the handler order: priority, then Speed, then effectOrder (switch-in order).
- Modelling: An input (which entered first) or keep: a fact-only tie. Keep.

#### unnerve-resist (S)

- Reason: `{Unnerve|As One} is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:1524-1543 (unnerveGuard / resistUnnerve), :3046-3049 and :3068 (pairRows)
- Fires: A resist Berry the calculation would eat, where the turn's Unnerve differs from the engine's (a third Pokémon's Unnerve stops it; the attacker's own Unnerve against its ally's Berry does not).
- Games: all four. How often: Champions sample: turn 0.14 %; Champions usage: 0.40 % of team slots carry it (1.6 % of fields), aerodactyl 0.40%, corviknight 0.00%, tyranitar 0.00%; oracle cases: 2 (F30d, M29c).
- Showdown: PS/data/abilities.ts:5258 unnerve onFoeTryEatItem: any active foe of the holder stops its Berries.
- Modelling: Stand-ins for the calculation: the target's resist Berry as Leftovers when a third Pokémon's Unnerve stops it; the attacker's Unnerve as a stand-in ability when it hits its own ally. Champions: Aerodactyl, 0.1 % of turns.

#### unnerve-recoil (S)

- Reason: `{Unnerve|As One} is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:2102-2113 (applyStep)
- Fires: A followed attacker with recoil or a self-cost knocks out a foe's Unnerve holder and ends at or under its own Berry's line.
- Games: all four. How often: Champions usage: 0.40 % of team slots carry it (1.6 % of fields), aerodactyl 0.40%, corviknight 0.00%, tyranitar 0.00%.
- Showdown: PS/sim/battle-actions.ts:967 the Update after the hit (Unnerve gone) comes before recoil (applyRecoilDamage).
- Modelling: Split the attacker's HP change in the step into before and after the hit's Update (the step's attackerHeals already orders retaliation and recoil).

#### ripen-stolen (S)

- Reason: `Ripen is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:2207-2211 (stolenFacts)
- Fires: A Ripen user eats a resist Berry with Bug Bite or Pluck while a later damaging move follows.
- Games: champions, sv, swsh. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), appletun 0.00%, flapple 0.00%.
- Showdown: PS/data/abilities.ts:3842 ripen onSourceModifyDamage: berryWeaken halves the next hit of that type.
- Modelling: A one-hit halving mark on the build that the next calculation reads.

#### cotton-down (S)

- Reason: `Cotton Down is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:2231
- Fires: A hit lands on a Cotton Down holder (Sword/Shield).
- Games: swsh. How often: not met in the samples or the stored cases.
- Showdown: PS/data/abilities.ts:725 cottondown onDamagingHit: −1 Speed on every other active Pokémon.
- Modelling: foeDrop on the others in Speed order after the step (Eject Pack, Defiant, Mirror Armor react). Enablers: stageEvents.

#### flower-pastel-veil (S)

- Reason: `{Flower Veil|Pastel Veil} is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:2271-2289 (veilGuard)
- Fires: A foe's damaging move drops a stat of, or poisons, a Pokémon whose side has Flower Veil (on a Grass type) or Pastel Veil.
- Games: all four. How often: SV proxy: turn 0.10 %; Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), floetteeternal 0.01%, florges 0.00%.
- Showdown: PS/data/abilities.ts:1419 flowerveil onAllyTryBoost / onAllySetStatus, :3189 pastelveil onAllySetStatus.
- Modelling: Undo the step's drop or status on the protected Pokémon (they are the step's secondaries; the step's own damage does not read them), or give the pair's step the side's veil.

#### battle-bond (S)

- Reason: `Battle Bond is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:2308
- Fires: A Battle Bond Greninja knocks a Pokémon out and is still in (SV, USUM).
- Games: champions, sv, usum. How often: SV proxy: turn 0.05 %; Champions usage: 0.00 % of team slots carry it (0.0 % of fields).
- Showdown: PS/data/abilities.ts:362 battlebond onSourceAfterFaint: +1 Attack, Sp. Atk and Speed once (gen 9).
- Modelling: selfBoost once per battle (an input for "already used").

#### aftermath-innardsout (M)

- Reason: `{Aftermath|Innards Out} is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:2310-2314
- Fires: A contact hit knocks out an Aftermath holder, or any hit an Innards Out holder.
- Games: all four. How often: Champions sample: turn 0.04 %; SV proxy: turn 0.25 %; Champions usage: 0.06 % of team slots carry it (0.2 % of fields), victreebelmega 0.06%.
- Showdown: PS/data/abilities.ts:78 aftermath (1/4 of the attacker's maximum HP), :2140 innardsout (the HP the holder had) onDamagingHit with !target.hp.
- Modelling: A loss on the attacker inside the step (Innards Out reads the target's HP before the hit: the joint target–attacker factor).

#### receiver-alchemy (M)

- Reason: `{Receiver|Power of Alchemy} is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:1228-1230 (faint)
- Fires: The partner of a Receiver or Power of Alchemy holder faints.
- Games: all four. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), passimian 0.00%.
- Showdown: PS/data/abilities.ts:3787 receiver, :3400 powerofalchemy onAllyFaint: copy the fainted ally's ability (setAbility, its Start runs).
- Modelling: Ability-change enabler. Enablers: abilityChange.

#### symbiosis (S)

- Reason: `Symbiosis is not modelled in 2v2.` (notIn2v2; turn+end)
- Where: app/lib/battle/doubles-turn.ts:1155-1159 (eventGuards); app/lib/battle/doubles-items.ts:108-110; app/lib/battle/doubles-eot.ts:1037-1040
- Fires: A Pokémon uses up its item (not one Trick moved) while its partner has Symbiosis and an item.
- Games: all four. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), floetteeternal 0.00%, florges 0.00%, oranguru 0.00%.
- Showdown: PS/data/abilities.ts:4837 symbiosis onAllyAfterUseItem: gives its item to the ally (setItem: its Start).
- Modelling: Item transfer at the use (item history marks the use), the received item's Start (doubles-items.ts receive). Enablers: itemHistory.

#### face-guards (M)

- Reason: `{Disguise|Ice Face} is not modelled in 2v2. / {Disguise|Ice Face} against a multi-hit move is not modelled in 2v2.` (notIn2v2 / faceMultiHit; turn)
- Where: app/lib/battle/doubles-turn.ts:2249-2255 (rowReason); :2615-2622 (faceHit: reactive items, unsafe moves, Magician); :2694, :2714, :2721 (faceProbe, neutralRow)
- Fires: An intact Disguise or Ice Face hit by a multi-hit move (or Parental Bond), by a move with an effect of its own (Knock Off, U-turn, the trapping moves...), by a Magician user, or holding an item that acts on a 0-damage hit (Rocky Helmet, Air Balloon, Kee/Maranga, Eject Button, Red Card...).
- Games: all four. How often: Champions sample: turn 0.03 %; SV proxy: turn 0.05 %; Champions usage: 0.17 % of team slots carry it (0.7 % of fields), mimikyu 0.17%; oracle cases: 3 (E40-Disguise, S48-Disguise-selfhit, VF16).
- Showdown: PS/data/abilities.ts:970 disguise, :1969 iceface: the first hit's damage becomes 0 (onDamage), the busted form at the Update; the later hits of a multi-hit move deal damage; DamagingHit and the move's effects still run with damage 0.
- Modelling: Multi-hit: the first hit through faceHit, the rest as a step into the busted form with one hit fewer (TurnStepPart, as the Substitute's split does). The rest: run the item or move effect with damage 0 per its handler (Knock Off still takes the item, U-turn still switches: the replacement enabler). Enablers: replacement.

#### focus-band (M)

- Reason: `Focus Band is not modelled.` (focusBand; turn)
- Where: app/lib/battle/doubles-turn.ts:2257-2264; app/lib/battle/doubles-status.ts:411 (confusion self-hit)
- Fires: A hit or a self-hit that can knock out a working Focus Band holder.
- Games: all four. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), excadrill 0.00%, vileplume 0.00%, lycanrocdusk 0.00%.
- Showdown: PS/data/items.ts:2249 focusband onDamage: randomChance(1, 10) leaves 1 HP.
- Modelling: A 10 % branch per KO hit (the 1v1's uses-to-ko says "Focus Band: 10% to survive each KO hit": the 2v2 step branches like a Sash; multi-hit: per hit).

#### berry-between-hits (M)

- Reason: `{Item} between the hits of {Move} is not modelled in 2v2.` (berryBetweenHits; turn)
- Where: app/lib/battle/doubles-turn.ts:1722-1740
- Fires: A multi-hit move whose earlier hits can take a target holding a Starf, Ganlon, Apicot (or Lansat with Cheek Pouch) Berry to its line before the last hit.
- Games: sv, swsh, usum. How often: oracle cases: 2 (VE-F1-10, VE-F1-13).
- Showdown: PS/sim/battle-actions.ts:967 eachEvent('Update') between hits: the Berry is eaten mid-move and the later hits read its stage (Ganlon Def, Apicot SpD, Starf random).
- Modelling: The pairwise search's per-hit Update for these Berries (the 1v1 search eats HP Berries between hits; the stat ones need the stage applied to the later hits; Starf branches).

#### aria-faint (S)

- Reason: `Sparkling Aria's burn cure after {Name} faints in the move is not modelled in 2v2.` (ariaFaint; turn)
- Where: app/lib/battle/doubles-turn.ts:1094-1099
- Fires: A Life Orb Sparkling Aria user faints in its move with a burned target hit.
- Games: all four. How often: Champions usage: 0.00 % of team slots carry it (0.0 % of fields); oracle cases: 1 (VE-H5-6).
- Showdown: PS/data/moves.ts:17358 sparklingaria onAfterMove: the cure runs while a user Life Orb knocked out has not fainted yet; one knocked out during the hits has.
- Modelling: Tag the faint's cause in the step (Life Orb after the hits vs during them). Rare.

#### gale-wings-gen7 (S)

- Reason: `Gale Wings is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:1813-1818
- Fires: USUM: a Gale Wings move whose frozen priority differs from the priority it would have now, into a priority shield or Psychic Terrain.
- Games: usum. How often: not met in the samples or the stored cases.
- Showdown: Gen 7 sorts once (PS/sim/battle.ts:2919 needs gen 8); the shields and Psychic Terrain read move.priority as ModifyPriority sets it at use.
- Modelling: Calculate with the frozen priority for the shield and terrain checks.

#### assurance-own-hp (S)

- Reason: `Assurance is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:1510-1515 (contextFor)
- Fires: Assurance into a target that only its own move's followed HP (recoil, Life Orb, retaliation, drain) may have hurt this turn.
- Games: all four. How often: Champions usage: 0.06 % of team slots carry it (0.2 % of fields), incineroar 0.04%, scizor 0.01%, grimmsnarl 0.00%.
- Showdown: PS/data/moves.ts:643 assurance: doubled when target.hurtThisTurn (any damage).
- Modelling: Track hurt per HP branch (a world split where the own step's loss was positive).

#### gmax-effects (M)

- Reason: `{G-Max move} is not modelled in 2v2. / {G-Max move}'s random status is not modelled in 2v2. / Max Guard is not modelled.` (notIn2v2 / randomStatus / maxGuard; turn)
- Where: app/lib/battle/doubles-turn.ts:2745 (maxEffects); :810-816 (RANDOM_STATUS_MAX_MOVES); :808 (a Dynamaxed Pokémon's status move); app/lib/battle/calculate.ts:1770 (a hit into a Dynamaxed protector)
- Fires: Sword/Shield: G-Max Smite, Gold Rush, Cuddle, Chi Strike, Replenish with a later action, G-Max Finale always; G-Max Befuddle and Stun Shock with another move; a Dynamaxed Pokémon's status move (Max Guard).
- Games: swsh. How often: oracle cases: 1 (R16).
- Showdown: PS/data/moves.ts gmax* self.onHit (confusion, infatuation, a crit stage, a Berry restored at random, a 1/6 heal), gmaxbefuddle / gmaxstunshock (a random status per foe); maxguard (blocks every move, Max Moves included, but G-Max One Blow and Rapid Flow).
- Modelling: Confusion and the crit stage are plain; infatuation and Replenish (1/2 per Berry) need their states; random statuses branch per foe; Max Guard is a protect kind.

#### gas-ends-shield (L)

- Reason: `Neutralizing Gas ending is not modelled in 2v2. / An Ability Shield change under Neutralizing Gas is not modelled in 2v2.` (gasEnds / gasShield; turn+end)
- Where: app/lib/battle/doubles-turn.ts:1190-1200 (gasEnds: faint, switch, Core Enforcer); :1202-1211 (gasShieldGuard)
- Fires: The last Neutralizing Gas holder leaves while a Pokémon it suppressed is in; an Ability Shield lost or Magic Room changing under the gas.
- Games: sv, swsh. How often: oracle cases: 13 (ER41a, NG17, NG18, NG19, NG20, NG22, …).
- Showdown: PS/data/abilities.ts:2905 neutralizinggas onEnd: every other active Pokémon's ability Start runs again (Speed order: Intimidate, Hospitality...), the suppressed abilities act from then on.
- Modelling: Ability-change enabler: restore the stand-ins and run the Starts that matter (Intimidate drops, weather/terrain setters: field change). SV and SwSh only; the most frequent reason in the stored oracle cases (11) because the gas cases were written for it. Enablers: abilityChange.

#### too-many (-)

- Reason: `Too many cases to follow.` (tooMany; turn+end)
- Where: app/lib/battle/doubles-turn.ts:60, 533, 944 (worlds 1 500, entries 200 000, calculations 160); app/lib/battle/doubles-eot.ts:173-176, 279 (a tie group above 5); app/lib/battle/uses-to-ko.ts:4074 TURN_TOO_MANY
- Fires: A budget runs over.
- Games: all four. How often: not met in the samples or the stored cases.
- Showdown: Not a mechanic.
- Modelling: Keep (a budget). Each new branch above adds pressure: the replacement's random drags and Pickup's samples, Sleep Talk's and Focus Band's branches.

#### engine-error (-)

- Reason: `This matchup could not be calculated: {message}` (literal; turn)
- Where: app/lib/battle/doubles-turn.ts:604-607; app/lib/battle/calculate.ts:1711, 2582, 3012, 3064
- Fires: The engine throws.
- Games: all four. How often: not met in the samples or the stored cases.
- Showdown: Not a mechanic.
- Modelling: Keep.

### F. Presence guards, known before the walk

#### presence-commander (M)

- Reason: `Commander is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:781-782
- Fires: A Commander Tatsugiri next to a Dondozo (Scarlet/Violet).
- Games: sv. How often: not met in the samples or the stored cases.
- Showdown: PS/data/abilities.ts:604 commander: Tatsugiri commanding (its action cancelled, untargetable: PS/data/conditions.ts:809 commanded, :826 commanding), Dondozo +2 to every stat once, cannot switch.
- Modelling: Tatsugiri not in play this turn (no action, not a target, spread moves skip it), Dondozo's stages from the input. SV only.

#### presence-poisonpuppeteer (S)

- Reason: `Poison Puppeteer is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-actions.ts:230-233 (PRESENCE_THIRD_PARTY); app/lib/battle/doubles-turn.ts:785-789
- Fires: Pecharunt with Poison Puppeteer anywhere in the turn (Scarlet/Violet).
- Games: sv. How often: SV proxy: turn 0.60 %.
- Showdown: PS/data/abilities.ts:3357 poisonpuppeteer onAnyAfterSetStatus: a poison Pecharunt's move gives also confuses (not itself).
- Modelling: In setStatus / giveStatus: psn or tox from Pecharunt's move adds a fresh confusion (Own Tempo, Misty Terrain, Safeguard rules as for confusion). The SV sampler's most frequent presence reason (0.6 %).

#### presence-dancer (M)

- Reason: `Dancer is not modelled.` (notModelled; turn)
- Where: app/lib/battle/doubles-turn.ts:794-795
- Fires: A dance move with another Pokémon's Dancer in (SV, USUM: Oricorio).
- Games: sv, usum. How often: not met in the samples or the stored cases.
- Showdown: PS/sim/battle-actions.ts:317-345: after the dance, every Dancer (Speed order, not semi-invulnerable) uses it at once (externalMove), at the dancer's target choice rule.
- Modelling: Extra actions inserted after the dance (the walk's execute with a synthetic action).

#### presence-moves (M)

- Reason: `{Move} is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-actions.ts:65-71 (PRESENCE_MOVES, PENDING_MOVES); app/lib/battle/doubles-turn.ts:798
- Fires: Spotlight, Round, Beak Blast, Shell Trap, Beat Up, Fusion Bolt, Fusion Flare, Counter, Mirror Coat, Metal Burst, Comeuppance, Flame Burst or Sky Drop chosen by any Pokémon.
- Games: all four. How often: Champions sample: turn 0.25 %; SV proxy: turn 0.20 %; Champions usage: 0.31 % of team slots carry it (1.2 % of fields), maushold 0.15%, sylveon 0.04%, zoroarkhisui 0.02%; oracle cases: 1 (E40-FlameBurst-usum).
- Showdown: PS/data/moves.ts:15499 round (another queued Round moves next, 2x: onTry prioritizeAction), :1150 beatup (one hit per healthy party member), :6354 fusionbolt / :6373 fusionflare (2x after the other this turn), :2987 counter / :11984 mirrorcoat / :11656 metalburst / :2681 comeuppance (2x / 1.5x the damage last taken this turn, aimed at its source), :1119 beakblast (burns contact attackers from the turn's start), :16277 shelltrap (moves right after a physical hit), :17764 spotlight, :5564 flameburst (1/16 to the target's ally), :16681 skydrop.
- Modelling: Round: no guard without a second Round; with one, the order change and 2x (easy). Fusion Bolt/Flare: 2x read from the last move used (easy). Flame Burst: a fixed splash loss (easy). Counter family: the damage taken this turn from a foe is known per world (medium). Spotlight: the centre machinery exists (easy). Beat Up: the party input (Training has it) and per-hit Justified (medium). Beak Blast, Shell Trap: start-of-turn volatiles and an order change (medium). Sky Drop: two semi-invulnerable Pokémon (hard).

#### presence-calling (M)

- Reason: `{Move} is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-actions.ts:84-85 (CALLING_MOVES); app/lib/battle/doubles-turn.ts:799-801
- Fires: Assist, Copycat, Me First, Metronome, Mirror Move, Nature Power, Instruct, or Sleep Talk with Comatose, chosen by any Pokémon.
- Games: all four. How often: Champions sample: turn 0.09 %; Champions usage: 0.10 % of team slots carry it (0.4 % of fields), oranguru 0.10%, liepard 0.00%, sylveon 0.00%; oracle cases: 2 (F21a, R10).
- Showdown: PS/data/moves.ts:12599 naturepower (the terrain's move, else Tri Attack: deterministic), :2849 copycat (the battle's last move: the previous action's, or the last turn's), :11528 mefirst (the target's queued attack at 1.5x), :9642 instruct (the target repeats its last move at once), :12028 mirrormove, :608 assist (random party move), :11785 metronome (random from all).
- Modelling: Nature Power: map and run (easy). Copycat, Mirror Move: the last move (this turn's from the walk, an earlier one from lastMove). Me First: run the target's move as the user's with 1.5x. Instruct: an inserted action. Metronome, Assist: keep (a branch over the whole move pool or the party). Enablers: lastMoveInput.

#### presence-pledges (M)

- Reason: `{Move} with {Other} is not modelled in 2v2.` (pledges; turn)
- Where: app/lib/battle/doubles-turn.ts:802-807
- Fires: Two different Pledge moves from partners (SV, SwSh, USUM).
- Games: sv, swsh, usum. How often: oracle cases: 1 (R09).
- Showdown: PS/data/moves.ts:5380 firepledge and kin onPrepareHit: the first waits for the partner (prioritizeAction), the second becomes a 150-power combined move with a side condition (sea of fire, rainbow, swamp).
- Modelling: Reorder, the combined move's damage and its side condition (the rainbow doubles secondary chances: below 100 % stays out; the sea of fire 1/8 at the end of turn; the swamp quarters Speed).

#### presence-custap (S)

- Reason: `Custap Berry is not modelled in 2v2.` (notIn2v2; turn)
- Where: app/lib/battle/doubles-turn.ts:809
- Fires: A Custap Berry holder with Quick Draw or Mycelium Might.
- Games: all four. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), slowbrogalar 0.00%.
- Showdown: PS/data/items.ts:1235 custapberry onFractionalPriority with PS/data/abilities.ts:3735 quickdraw, :2794 myceliummight.
- Modelling: fractionalOutcomes with the Berry eaten only in the outcomes where it raised the priority. Rare.

### G. Positions, items, Substitute (Track E)

#### darts-aim-self (S)

- Reason: `Dragon Darts aimed where its user now stands is not modelled in 2v2.` (dartsAimSelf; turn)
- Where: app/lib/battle/doubles-turn.ts:1456-1457; app/lib/battle/doubles-positions.ts:146 (start row)
- Fires: Dragon Darts aimed at the user's ally's position after that ally's Ally Switch.
- Games: champions, sv, swsh. How often: Champions usage: 0.10 % of team slots carry it (0.4 % of fields), dragapult 0.10%; oracle cases: 1 (E03-DragonDarts).
- Showdown: PS/sim/battle.ts:2456-2462 getTarget; Dragon Darts' smart targeting from the user's own position (ADDENDUM A2, p1:149).
- Modelling: Follow the smart-target rule from the new position. Rare.

#### received-item (S)

- Reason: `{Item} received by {Name} is not modelled in 2v2.` (received; turn)
- Where: app/lib/battle/doubles-items.ts:111-114
- Fires: Trick or Switcheroo gives a Terrain Seed in its terrain, Room Service under Trick Room, or Booster Energy to a Protosynthesis or Quark Drive holder.
- Games: all four. How often: Champions usage: 0.00 % of team slots carry it (0.0 % of fields); oracle cases: 2 (E22b, E22c).
- Showdown: PS/sim/pokemon.ts:1868-1889 setItem runs the item's Start: the Seed and Room Service use themselves, Booster Energy activates.
- Modelling: Run the item's use at setItem (stage, Unburden, Symbiosis) and Booster Energy's activation (the paradox boost: field-change settle). 

#### into-substitute (M)

- Reason: `{What} into a Substitute is not modelled in 2v2.` (intoSubstitute; turn)
- Where: app/lib/battle/doubles-substitute.ts:62-80 (narrowGuards); :233, :242
- Fires: Into a Substitute: a Max Move, a signature Z-Move with an effect of its own, Mind Blown, Magician taking an item, Parental Bond's second hit, a multi-hit move with recoil, drain or a self-cost.
- Games: all four. How often: Champions usage: 1.16 % of team slots carry it (4.6 % of fields), delphoxmega 0.37%, gengarmega 0.31%, gholdengo 0.03%; oracle cases: 4 (E40-Magician, E40-MaxMove-swsh, E40-MindBlown-usum, E40-ParentalBond-usum).
- Showdown: PS/data/moves.ts:18305 substitute onTryPrimaryHit: the damage goes to the Substitute; the user's own effects follow per their handlers (ADDENDUM §4.13).
- Modelling: Per move (each a short rule from ADDENDUM §4.13.2). Rare.

#### sub-per-hit (M)

- Reason: `{Move} into {Name}'s Substitute with {What} is not modelled in 2v2.` (subPerHit; turn)
- Where: app/lib/battle/doubles-substitute.ts:196-211
- Fires: A multi-hit move into a Substitute whose holder has an effect the engine's per-hit damages read (Multiscale, Shadow Shield, Stamina, Weak Armor, Water Compaction, Mummy and the contact ones, a resist Berry, Luminous Moss).
- Games: all four. How often: Champions usage: 0.85 % of team slots carry it (3.4 % of fields), delphoxmega 0.37%, gengarmega 0.31%, gholdengo 0.03%; oracle cases: 4 (E40-DualWingbeat-Mummy-swsh, E40-IcicleSpear-Multiscale, E40-IcicleSpear-Stamina, E40-IcicleSpear-YacheBerry).
- Showdown: Behind a Substitute no DamagingHit fires (the Pokémon keeps its HP and Berry): the hits after the first are not what the engine's multi-hit loop computes.
- Modelling: Per-hit calculations with the holder's state frozen while the Substitute stands (calculate the later hits as separate one-hit calculations). Rare.

### H. End of turn only (doubles-eot.ts)

#### eot-landing (M)

- Reason: `{Move} landing is not modelled in 2v2.` (landing; end)
- Where: app/lib/battle/doubles-eot.ts:213
- Fires: A carried Future Sight or Doom Desire lands on a slot this turn.
- Games: all four. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), slowkinggalar 0.00%, hatterene 0.00%, slowking 0.00%; oracle cases: 1 (ER41e).
- Showdown: PS/data/conditions.ts:379 futuremove onResidual (order 3, before every other residual): the stored move hits the Pokémon now at that slot, from its user (the stored source if it is gone; its stats as stored at the use).
- Modelling: A residual hit: a calculation from a carried attacker build (Training: the belief build of the user; calculator: an input) into the slot's occupant. 

#### eot-cudchew (S)

- Reason: `Cud Chew is not modelled in 2v2.` (notIn2v2; end)
- Where: app/lib/battle/doubles-eot.ts:214
- Fires: A carried Cud Chew Berry is due this end of turn.
- Games: champions, sv. How often: Champions usage: 0.02 % of team slots carry it (< 0.1 % of fields), farigiraf 0.02%, taurospaldeablaze 0.00%, taurospaldeaaqua 0.00%; oracle cases: 1 (ER41d).
- Showdown: PS/data/abilities.ts:742 cudchew: a Berry eaten (not by Bug Bite or Pluck) sets a counter of 2; onResidual (28.2) counts down and at 0 runs the Berry's Eat again (its effect; no item needed).
- Modelling: A residual that runs the Berry's eat effect (HP, stage, cure) on the holder; Training carries it (bridge.ts:241-242).

#### eot-moody-starf-e2 (S)

- Reason: `Moody is not modelled in 2v2. / Starf Berry is not modelled in 2v2.` (notIn2v2; end (E2 only))
- Where: app/lib/battle/doubles-eot.ts:222, :924
- Fires: E2 (calculateDoublesOutcomes): a Moody holder at the residual; a Starf Berry eaten at an end-of-turn Update.
- Games: all four. How often: Champions usage: < 0.01 % of team slots carry it (< 0.1 % of fields), scovillain 0.00%.
- Showdown: PS/data/abilities.ts:2701 moody (+2 one random stat, −1 another); PS/data/items.ts:5985 starfberry.
- Modelling: Branch the outcomes (5 × 4 for Moody, the open stats for Starf); the calculator's fact stays.

#### eot-overtime (S)

- Reason: `{G-Max move}'s damage over time is not modelled in 2v2.` (overTime; end)
- Where: app/lib/battle/doubles-eot.ts:217
- Fires: Sword/Shield: G-Max Vine Lash, Wildfire, Cannonade, Volcalith, Centiferno or Sandblast landed this turn.
- Games: swsh. How often: oracle cases: 1 (ER41h-swsh).
- Showdown: PS/data/moves.ts:7365 gmaxvinelash and kin: a foe-side condition for 4 turns, onResidual 5.1: baseMaxhp / 6 to each Pokémon not of the immune type; Centiferno and Sandblast: a partial trap.
- Modelling: A side residual at its order (5.1) and the trap (exists).

#### eot-form-change (S)

- Reason: `{Ability} changing {Name}'s form is not modelled in 2v2.` (formChange; end)
- Where: app/lib/battle/doubles-eot.ts:948-960
- Fires: Zen Mode, Shields Down, Schooling or Power Construct whose holder's HP after the residual can be on the other side of its form line.
- Games: sv, swsh, usum. How often: SV proxy: end 1.80 %; oracle cases: 1 (ER41g-usum); the proxy number is an artifact: createBuild gives Minior its Core form at full HP.
- Showdown: PS/data/abilities.ts:5585 zenmode, :4239 shieldsdown, :4044 schooling, :3385 powerconstruct onResidual (order 29): formeChange (stats; Power Construct heals the HP difference).
- Modelling: Change the species in the world at order 29 (the E2 build; HP scaled as formeChange does). (The SV sampler's Minior hits are an artifact: it starts the Core form at full HP.)

#### eot-liquidooze-healblock (S)

- Reason: `Liquid Ooze is not modelled in 2v2.` (notIn2v2; end)
- Where: app/lib/battle/doubles-eot.ts:668
- Fires: Leech Seed drains a Liquid Ooze holder into a heal-blocked seeder.
- Games: all four. How often: Champions usage: 0.00 % of team slots carry it (0.0 % of fields).
- Showdown: PS/data/abilities.ts:2402 liquidooze onSourceTryHeal (drain, leechseed, strengthsap: damage instead, heal 0) and the gainer's Heal Block onTryHeal (PS/data/moves.ts:8274 healblock condition: false) meet in one TryHeal runEvent; which runs first decides whether the seeder is damaged.
- Modelling: A probe for the handler order, then apply it. Rare.

### I. The start settle (calculate.ts settleDoublesStart)

#### settle-imposter (M)

- Reason: `Imposter is not modelled in 2v2.` (settle; start)
- Where: app/lib/battle/calculate.ts:3189-3191; app/lib/battle/calculate.ts:488-506 (withheld texts)
- Fires: Ditto (or any Imposter holder) in the turn.
- Games: all four. How often: Champions sample: turn 0.15 %; Champions usage: 0.04 % of team slots carry it (0.2 % of fields), ditto 0.04%.
- Showdown: PS/data/abilities.ts:2115 imposter onSwitchIn: transforms into the foe across (foe.active[length − 1 − position]; census-probes P5).
- Modelling: Transform into the foe across as the turn starts (an assumption fact: it copied that foe), with the 1v1 imposter.ts rules (stats, stages, moves, types, Tera); Training: a transformed Ditto is a rollout (bridge.ts:300) and needs the same.
- Training: bridge.ts:300 `{Name} is transformed.`

#### settle-trace-random (S)

- Reason: `Trace copies a random foe's ability. / Trace copying Intimidate is not modelled in 2v2.` (settle; start)
- Where: app/lib/battle/calculate.ts:3218-3224
- Fires: A Trace holder with no copied ability given facing two foes with different copyable abilities; Trace copying Intimidate.
- Games: all four. How often: Champions sample: turn 0.39 %; Champions usage: 0.06 % of team slots carry it (0.2 % of fields), gardevoir 0.03%, alakazammega 0.02%, meowsticfmega 0.01%; the sampler never sets the copied ability (the calculator's input).
- Showdown: PS/data/abilities.ts:5118 trace onUpdate: sample over the adjacent foes with copyable abilities, setAbility (its Start runs: Intimidate activates).
- Modelling: Random: an input (the calculator has "Ability Trace copied", PokemonPanel.tsx:199; Training reads it: bridge.ts:78-81) — keep the reason as the prompt-free fact. Intimidate: apply its drop as the calculator's applyIntimidateToFoes does for an entry Intimidate (an assumption fact).

#### settle-two-act (M)

- Reason: `{A} and {B} both act on {C} as the turn starts.` (settle; start)
- Where: app/lib/battle/calculate.ts:3200-3209
- Fires: Two different Pokémon each supply something the 1v1 settle reads from "the other battler" for one slot (Unnerve from one foe, Cloud Nine from another; a weather negator and a paradox field setter).
- Games: all four. How often: not met in the samples or the stored cases.
- Showdown: Each of those effects reads every active Pokémon.
- Modelling: Settle each effect from its own source (the 1v1 settle takes one representative). Rare.

#### settle-download (S)

- Reason: `Download is not modelled with {Foe}'s entry boost.` (settle; start)
- Where: app/lib/battle/calculate.ts:3266-3277
- Fires: Download against a foe whose own entry boost changed its Defense or Sp. Def, or a transformed foe.
- Games: sv, swsh, usum. How often: not met in the samples or the stored cases.
- Showdown: PS/data/abilities.ts:1017 download onStart: the foes' Defense and Sp. Def totals with their boosts as they stand at the holder's Start.
- Modelling: Order the entry effects (whose Start comes first) — an input for which entered first. Rare.

### J. Row and step reasons read from the 1v1 calculation

#### row-history-moves (M)

- Reason: `Needs the defender's switching state. / Needs whether an ally fainted last turn. / Needs the consecutive-use count. / Needs the consecutive-use count and Defense Curl state. / Needs the consecutive-turn use count. / Needs the number of Stockpile uses. / Needs the move's remaining PP. / Random damage or healing, not modelled. / Needs the random Magnitude power. / Needs the damage stored over earlier turns.` (row; turn)
- Where: app/lib/battle/calculate.ts:52-69 (HISTORY_MOVES), :1790-1792
- Fires: Pursuit, Retaliate, Fury Cutter, Rollout, Ice Ball, Echoed Voice, Spit Up, Trump Card, Present, Magnitude or Bide in the turn (Counter, Mirror Coat, Metal Burst and Comeuppance are presence-guarded first).
- Games: all four. How often: not met in the samples or the stored cases.
- Showdown: Each reads state from earlier turns (counts, PP, Stockpile) or a random power (Present 40/80/120 or a heal, Magnitude 4-10).
- Modelling: Inputs (counts: the calculator could take them as the 1v1 does not; Training has them) and branches (Present, Magnitude: a few outcomes). Echoed Voice also counts this turn's earlier Echoed Voice. Low frequency; 1v1 shares the rows.

#### row-engine-limits (-)

- Reason: `Friend Guard with {n} other damage modifiers: not calculated (their order can change the damage by 1 HP). / Supreme Overlord with {n} other power boosts: not calculated (…). / Beat Up into {X}: not calculated. / Body Press under Wonder Room into Unaware with a Sp. Def stage: not calculated. / Stance Change needs a verified Blade Forme. / This move's damage is not verified in the {game} engine. / This move's Max Move type is not verified. / No verified G-Max move for this species. / Status Z-Moves are not calculated. / Hidden Power's declared type does not match the innate IVs. / Needs the hit count ({min}–{max}). / Rivalry needs both Pokémon's genders. / Stellar first-use reason / Z-Move and mechanic input errors` (row; turn)
- Where: app/lib/battle/calculate.ts:1770-1796, 1849, 1914, 2156-2170, 2247, 2270; app/lib/battle/resolve-move.ts:47-140
- Fires: The 1v1 calculation cannot give a number for the pair (engine modifier-order limits, unverified moves, missing inputs, invalid Z-Move set-ups).
- Games: all four. How often: Champions sample: turn 0.01 %; oracle cases: 1 (R16).
- Showdown: Each is a 1v1 engine limit, not a 2v2 mechanic.
- Modelling: Out of scope for (4): 1v1 work (golden-1v1). Friend Guard's modifier order is the one a 2v2 meets most (Maushold Friend Guard is common in Champions: 0.01 % of sampled turns).

#### step-stops (-)

- Reason: `A later use cannot be calculated / {a later rerun's row reason} / A weather or terrain change this turn would change {X}.` (step; turn)
- Where: app/lib/battle/uses-to-ko.ts:3935-3950 (turnFailure: a rerun of the pair's calculation inside the step fails); app/lib/battle/doubles-turn.ts:2052, 2693 (failed)
- Fires: Inside a pair's step a later calculation (after a stage or field change) has no number.
- Games: all four. How often: not met in the samples or the stored cases.
- Showdown: Not a mechanic.
- Modelling: Follows the row reasons above.

### K. Training's rollout reasons (bridge.ts, splits.ts, prelude.ts)

#### tr-volatiles (M)

- Reason: `{Name}: {volatile id} is not modelled.` (rollout; rollout)
- Where: app/(app)/training/sim/bridge.ts:32-42 (IGNORED_VOLATILES, MAPPED_VOLATILES), :294
- Fires: An active Pokémon carries a volatile the bridge neither maps nor ignores: healblock (Psychic Noise from an earlier turn), smackdown, magnetrise, telekinesis, gastroacid, stockpile, minimize, glaiverush, twoturnmove (a charging move's next turn), uproar, attract, octolock, noretreat, tarshot, powertrick, lockon, embargo, nightmare, foresight, miracleeye, electrify, powder...
- Games: champions. How often: not met in the samples or the stored cases.
- Showdown: Each is a condition in PS/data/moves.ts or conditions.ts with effects on later turns.
- Modelling: Map each that the engine models once (3) and (4) land: healblock (healBlockSteps; eot.healBlock exists), smackdown and magnetrise (grounding), gastroacid (abilityChange), glaiverush, twoturnmove (the forced move), stockpile (Spit Up / Swallow counts), minimize (Stomp 2x). Public: each volatile's -start line. Enablers: healBlockSteps, grounding, abilityChange.

#### tr-ability-changed (M)

- Reason: `{Name}: its ability was changed ({id}). / {Name} is transformed. / {Name} has an Illusion. / {Name}: {ability} was used this stint. / {Name}: {ability} is not modelled.` (rollout; rollout)
- Where: app/(app)/training/sim/bridge.ts:295-301; app/(app)/training/ai/evaluate.ts:138-147 (foreignAbility)
- Fires: Skill Swap / Role Play / Entrainment / Worry Seed / Simple Beam left an ability not of its species; a transformed Pokémon; an active Illusion; a used Protean or Libero; an entry-stage ability (Intrepid Sword, Dauntless Shield, Embody Aspect, Wind Rider) or Download, Protosynthesis, Quark Drive.
- Games: champions. How often: Champions usage: 0.28 % of team slots carry it (1.1 % of fields), meowscarada 0.14%, greninjamega 0.08%, greninja 0.02%.
- Showdown: The engine's builds are validated by species (model.ts) and take Protean unused only.
- Modelling: Allow a foreign ability on a build in the turn input (validation flag for E2), the types enabler for Protean, the Imposter transform for Ditto; Illusion stays (hidden identity). The paradox abilities need the field-settled state as an input. Enablers: types, abilityChange.

#### tr-field-side (S)

- Reason: `Weather {id} is not modelled. / Field effect {id} is not modelled. / Magic Room ending this turn is not modelled. / Side effect {id} is not modelled.` (rollout; rollout)
- Where: app/(app)/training/sim/bridge.ts:270-283
- Fires: An unmapped weather or pseudo-weather, Magic Room with one turn left and a late item in, a side condition other than the screens, Tailwind and the hazards (Safeguard from an earlier turn, Mist, Lucky Chant, G-Max side conditions).
- Games: champions. How often: Champions usage: 0.02 % of team slots carry it (< 0.1 % of fields), meowstic 0.02%, sableye 0.01%, vivillon 0.00%.
- Showdown: Each side condition's handlers.
- Modelling: Map Safeguard (the engine models the side flag: SideState.safeguard), give Magic Room its turns left (an input the end of turn reads at 27.6).

#### tr-moves-state (S)

- Reason: `{Name}: recharging while confused is not modelled. / {Name}: struggle|sleeptalk is not modelled. / {Name}: {move} is not in its catalog moves. / {Name} must recharge. / {Name}: {move} after its first turn while confused is not modelled. / Payback into a Pokémon that switched in. / Analytic with a switch this turn. / {Name}: Ingrain on a Pokémon that is not grounded otherwise is not modelled.` (rollout; rollout)
- Where: app/(app)/training/sim/bridge.ts:304-336
- Fires: The listed action states.
- Games: champions. How often: not met in the samples or the stored cases.
- Showdown: Recharge stops at BeforeMove priority 11 before confusion; Struggle; Fake Out failing after the first turn is not Splash; Payback and Analytic read a switch-in's order.
- Modelling: Engine "no move" variants that skip confusion (recharge, a failing Fake Out), Struggle as a move, Payback / Analytic contexts from the prelude, Ingrain via the grounding enabler. Enablers: grounding.

#### tr-carried (S)

- Reason: `{Name}: {what} needs the public counts. / {Name}: Leech Seed from an ally is not modelled. / {Name}: a trap from an ally is not modelled. / {Name}: Syrup Bomb from an ally is not modelled. / {Name}: a G-Max trap is not modelled. / {Name}: its Substitute's HP after a hit is not public.` (rollout; rollout)
- Where: app/(app)/training/sim/bridge.ts:172-252 (carriedOf)
- Fires: Carried state the engine cannot take: an ally as the seeder, trapper or Syrup Bomb source; a Substitute already hit (its HP is hidden).
- Games: champions. How often: not met in the samples or the stored cases.
- Showdown: -
- Modelling: Allow an ally source in DoublesCarried (validation only); the Substitute's HP stays a rollout (hidden information: Training never reads it).

#### tr-splits-prelude (S)

- Reason: `{Move} under Gravity while confused: its failing world is not modelled. / Speed tie between switches with an entry effect. / Trace enters against two different abilities. / Prelude failed: {message} / The battle ended before the moves. / A replacement is needed before the moves.` (rollout; rollout)
- Where: app/(app)/training/sim/splits.ts:53; app/(app)/training/sim/prelude.ts:27, 33, 44, 50
- Fires: A Protect that may fail its stall check under Gravity while confused; switch-ins tied with an entry effect; Trace entering against two abilities; a mid-turn replacement before the moves (Eject Pack after an entry Intimidate, Emergency Exit).
- Games: champions. How often: not met in the samples or the stored cases.
- Showdown: The failing Protect is not Splash (no Gravity stop before confusion); the switch-in order is a Speed tie; Trace samples.
- Modelling: A "failed stall" no-move variant; branch the tied entry order and Trace's sample in the prelude (it is a Showdown run: one prelude per branch); the replacement before the moves needs the replacement enabler. Enablers: replacement.


## 7. Method and caveats

- The Champions sampler draws four species by their share of the usage sets (no species twice on a side), each with
  an ability, item and spread by weight, and one move by its set share (Protect included), at a random legal target:
  a third of single-target moves go to the user's ally, which inflates the ally-targeting reasons (allyEffect) and
  takes a third of single-target hits off the foes. Weather and terrain come from the slowest setter drawn; Intimidate is not
  pre-applied; no state from earlier turns is set; lastMove is never given (as in the calculator), so Encore and Disable
  show the calculator's gap; moves lists are not given (Imprison's count is the sampler's, the app always gives them).
- The Scarlet/Violet sample uses the catalog's Random Battle Doubles sets: damaging moves only, default abilities, no
  items. It says which damaging-move guards SV meets; it under-counts status moves, items and the field-change guard
  (Protosynthesis and Quark Drive with weather or terrain moves, common in SV play).
- Sword/Shield and USUM ship no usage data; their columns are catalog presence (carrier counts in census-guards.json).
- Training's per-reason rollout counts are not recorded by the eval; only the method shares are.
- Each reason is the first guard a turn meets: a turn can carry more than one.
