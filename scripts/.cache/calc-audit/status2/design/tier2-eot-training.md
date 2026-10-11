# Tier 2 design: the end of turn, Training's rollout reasons, the budgets (status2)

Branch `calc-2v2-status-2` (main `4008ee8`). Design only: no app code, test or doc changed. This file designs the Tier 2
entries USER-DECISIONS Q6 brings into this build that sit at the end of turn, in Training's bridge, splits and prelude, and
in the count budgets:

| Census entry (census-guards.md §6) | Today's text | Decision |
|---|---|---|
| eot-landing (H) | `{Move} landing is not modelled in 2v2.` | **Modelled** (§4.1); one narrow corner keeps a new text |
| eot-cudchew (H) | `Cud Chew is not modelled in 2v2.` | **Modelled** (§4.2), and Training starts carrying it (it never did: §2 finding 3) |
| Moody, E2 (part of eot-moody-starf-e2, H) | `Moody is not modelled in 2v2.` (E2) / the fact `Moody raises one stat and lowers another.` | **Modelled** (§4.3); the fact goes |
| eot-overtime (H, SwSh) | `{G-Max move}'s damage over time is not modelled in 2v2.` | **Modelled** (§4.4), with a SwSh side input for one from an earlier turn |
| eot-form-change (H) | `{Ability} changing {Name}'s form is not modelled in 2v2.` | **Modelled** for Zen Mode, Shields Down, Schooling; **kept** for Power Construct (§4.5) |
| tr-field-side (K) | `Weather {id} …` / `Field effect {id} …` / `Magic Room ending this turn …` / `Side effect {id} …` | Magic Room's end and Safeguard **modelled** (new inputs); the three id templates **kept** as defensive (§4.6) |
| tr-moves-state (K) | eight rollout texts | Recharge, Struggle, a failing Fake Out, Payback and Analytic after a switch **modelled**; two **kept** (catalog, defensive); Sleep Talk follows T2M; Ingrain is SPEC2's (§4.7) |
| tr-splits-prelude (K) | six rollout texts | The Protect stall and the prelude's random events **modelled**; three **kept** (§4.8); the replacement is wave 2 (R-T) |
| too-many, engine-error (kernel) | `Too many cases to follow.` / `This matchup could not be calculated: {message}` | **Kept**, measured (§4.9) |

The spec this builds on: SPEC2.md (all of it), USER-DECISIONS.md (final). ADDENDUM2.md does not exist yet; where it lands
it wins over this file as over SPEC2. Ground truth: pinned Showdown `c23d2e94`, `PS/…` the read-only source
`node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353`. App line numbers are the tree at
`4008ee8`.

**Probes** (all in this folder; run from the repo root with `npx --no-install tsx scripts/.cache/calc-audit/status2/design/<file>`;
every `.err` is empty):

| File | Ids | Runs on |
|---|---|---|
| `tier2-eot-training-probes-1.ts` → `.out` | FS01–FS17 (landing), CC01–CC10 (Cud Chew), MO01–MO07 (Moody), GX01–GX06 (G-Max), FC01–FC06 (forms) | pinned Showdown through `guards-sim.ts` (exact enumeration) |
| `tier2-eot-training-probes-2.ts` → `.out` | TR01–TR11 (recharge, switch-ins, the stall check, prelude ties, Payback, Fake Out, Magic Room, Struggle, Analytic) | pinned Showdown, Champions unless stated |
| `tier2-eot-training-probes-3.ts` → `.out` (+ `.out.json`) | budgets | today's engine, copied at run time into `.t2-engine/` with recorders on every budget check (deleted after the run), on census-sim's sample (seed 7: 8000 Champions turns, 2000 SV turns), calculateDoublesTurn and E2 |
| `tier2-eot-training-probes-4.ts` → `.out` | AP01–AP05 | today's app engine on the inputs Training's bridge builds |

---

## 1. Decisions in one page

1. **Future Sight and Doom Desire land** (§4.1): an order-3 residual hit from a source that is a Pokémon of the turn (alive:
   its state now; fainted: none of it) or one not in battle (a build the input gives), into the Pokémon now at the slot,
   through one new kernel entry `TurnKernel.residualHit` that runs the pairwise step with no attacker side. Every rule was
   probed: the source's ability, item and stat stages count only while it is active (FS03, FS08, FS09, FS16); Helping Hand
   received this turn counts (FS17); a fainted source loses Tera and reverts a Mega (FS05); Protect and Endure from this turn
   are removed (FS06); Life Orb recoils even when the landing is immune (FS07c), Shell Bell does nothing (FS07b); a
   semi-invulnerable target is missed (FS14); the target's Berry is eaten at the hit's Update, before Wish and Leftovers
   (FS01). One text stays for one calculator-only corner (§4.1.8).
2. **Cud Chew** (§4.2): `carried.cudChew` names its Berry; a 28.2 handler re-eats it (`singleEvent('Eat')`: no item needed, no
   TryEatItem, so Unnerve does not stop it, Heal Block stops the heal: CC04); every Berry a Cud Chew holder eats this turn
   sets its counter (2 during the moves, 1 during the end of turn: CC01–CC03, CC10, FS13); E2 reports the Berry still due.
3. **Moody** (§4.3): one world per (raised, lowered) pair, uniform (gen 8+: 5 × 4, USUM: 7 × 6 with accuracy and evasion:
   MO01–MO03), through `applyBoosts` so White Herb, Opportunist, Mirror Herb and Eject Pack read it at 29 (MO04, MO05). E2
   always branches; the calculator's walks branch only where a later reader exists and otherwise record the stage facts by
   mass (the readers rule, SPEC2 §4.9).
4. **G-Max damage over time** (§4.4, SwSh): the four side conditions set by a hit that landed, a Substitute's or a Protect's
   quarter included (GX02, GX03); 1/6 at 5.1 to each Pokémon of that side without the type (GX01, GX04); Centiferno and
   Sandblast trap every foe and the trap outlives its user (GX05). A side input carries one from an earlier turn (GX06).
5. **Forms at 29** (§4.5): Zen Mode, Shields Down and Schooling change the species (`withSpecies`, SPEC2 §3.3) where the HP
   crosses the line (FC01–FC05); their maximum HP never changes, so the world's HP stays valid. **Power Construct stays
   guarded**: it changes the maximum HP and the final Update reads the new one (FC06), which one `DoublesHP.maximum` per
   Pokémon cannot show.
6. **Training** (§4.6–§4.8): six new engine inputs replace rollouts with exact cells: `switchedIn`, `firstTurn`,
   `carried.mustRecharge`, `carried.stall`, `fieldTurns`, `SideConditions.safeguard`; Struggle becomes an engine move; the
   prelude enumerates its own random events (switch-in and Mega Evolution ties, Trace) instead of sampling one with a seed.
7. **Budgets** (§4.9): unchanged (1 500 worlds, 200 000 entries, 160 calculations; the step's 48 reruns). Measured: no sample
   turn runs over today; the world-state load is at most 1/34 of the budget on the worst of 8 546 ready turns, so no end-of-turn
   family here (×20 at most, Moody in E2) can push a sample turn over. The calculation budget is the tight one (worst 58 of
   160). SPEC2's spread-heal joint (C12) is over 200 000 entries for 1.44 % of the guarded Matcha Gotcha turns (0.05 % of
   Champions turns), inside SPEC2's acceptance.
8. **Three silent Training errors today** (§2): a Pokémon that switched in runs BeforeMove (it can wake: AP01 vs TR02); a
   Mega Evolution tie with an entry effect is a seeded sample (TR05); Cud Chew is never carried (the belief battle's
   ability state is fresh). Each is fixed by the inputs above.

---

## 2. Findings beside the entries (fix with this design)

| # | What | Evidence | Fix |
|---|---|---|---|
| 1 | Training gives a Pokémon that switched in this turn "No move" (`bridge.ts:302-304`), which the engine runs through BeforeMove (`doubles-status.ts:124-150`: sleep, freeze, flinch, Gravity, confusion). A sleeping newcomer wakes in 1/3 of the engine's worlds (AP01: `Status cured.` 0.3333; E2 1/3 awake); in Showdown it takes no BeforeMove and keeps its counter (TR02: 3/3 kept; in place 2/3). Champions freeze likewise. Not guarded. | AP01, TR02, `PS/sim/battle-queue.ts` (a switch action is not a move action) | `DoublesPokemonInput.switchedIn` (§3.1, §4.7.4) |
| 2 | `prelude.ts:19-28` checks Speed ties between switches only. Two Mega Evolutions with entry effects at one Speed (megaEvo order 104, ties shuffled by the prelude's seeded PRNG: `PS/sim/battle-queue.ts:174-197`) give the cell one sampled order: Charizard Mega Y and Tyranitar Mega leave sun or sand at 1/2 each (TR05), and the cell sees one of them. Not guarded. | TR05 | the prelude's enumeration (§4.8.2) |
| 3 | `bridge.ts:241-242` reads Cud Chew's `abilityState.berry` and `counter` from the belief battle, which builds every ability state fresh (`belief-battle.ts:181`): Training never passes `carried.cudChew`, so a due re-eat is silently missing from Training's cells (and its guard never fires). | code | the tracker's public Cud Chew state (§4.2.3) |
| 4 | Training passes `weatherTurns` but no terrain, Gravity or Magic Room turns; the engine assumes they last (turn facts Training does not read). Magic Room is caught by its rollout; the terrain and Gravity facts change no Champions number (Champions has no Flame Orb or Toxic Orb, the only items they reach after 27). | `bridge.ts:349-356`, `doubles-eot.ts:845-852` | `fieldTurns` (§4.6.2); exactness for SV/SwSh/USUM calculator users too |

---

## 3. Contract (paste-ready; a Step 0c that the Step 0 builder writes, behaviour unchanged)

Every field below is optional and set only by Training's bridge or a 2v2 calculator control; nothing in Step 0, Step 1 or
the 1v1 sets one. This joins SPEC2 §3 (its Step 0); §8 gives the gate.

### 3.1 `app/lib/battle/doubles-types.ts`

```ts
export type DoublesCarried = {
  /* …existing and SPEC2 §3.1… */
  // ---- Tier 2 (E): replaces `futureMove?: string` ----
  /**
   * A Future Sight or Doom Desire landing on this slot (a position) at this end of turn (pinned futuremove slot condition,
   * endingTurn reached: PS/data/conditions.ts:379-421). `source`: its user, a Pokémon of this turn (the slot it started
   * in); `build`: its user not in battle now (benched, or fainted on an earlier turn) as it is now, whose ability, item and
   * stat stages the landing does not read (PS/sim/pokemon.ts:858-885 ignoringAbility, ignoringItem: gen ≥ 5, !isActive).
   */
  futureMove?: { move: "futuresight" | "doomdesire"; source: DoublesSlotId } | { move: "futuresight" | "doomdesire"; build: BattleBuild };
  // ---- Tier 2 (E): replaces `cudChew?: true` ----
  /** Cud Chew re-eats this Berry at this end of turn (pinned cudchew abilityState: berry, counter 1 as the residual starts). */
  cudChew?: { berry: string };
  // ---- Tier 2 (D, T) ----
  /**
   * The Protect family's stall counter from its uses in a row (pinned stall condition: 3 per success, at most 729,
   * PS/data/conditions.ts:439-462): this turn's Protect, Detect, Endure… works with 1/stall. 1: none last turn (no
   * assumption). Absent: assumed none (the turn fact).
   */
  stall?: 1 | 3 | 9 | 27 | 81 | 243 | 729;
  /** It used a recharge move last turn (pinned mustrecharge, PS/data/conditions.ts:364-378): its action is the recharge. */
  mustRecharge?: true;
};

export type DoublesPokemonInput = {
  /* …existing and SPEC2 §3.1… */
  /**
   * It switched in this turn before the moves (its player's switch; Training's prelude): it takes no action this turn
   * (no BeforeMove, no place in the order), and the moves that read a newcomer do so (pinned pokemon.newlySwitched:
   * Payback is not doubled, Bolt Beak and Fishious Rend are, Core Enforcer passes it, Helping Hand onto it works;
   * Analytic does not wait for it). Its action must be No move.
   */
  switchedIn?: true;
  /** Fake Out and First Impression: false, not its first turn since it came in (pinned activeMoveActions > 1: they fail at their own Try). Absent: assumed its first turn (the turn fact). */
  firstTurn?: boolean;
};

export type DoublesTurnInput = {
  /* …existing… */
  /**
   * Turns left before this turn's countdown for a field effect up before the turn, as weatherTurns is for the weather
   * (1: it ends at this end of turn: Gravity 27.2, Magic Room 27.6, the terrain 27.7; PS/data/moves.ts gravity,
   * magicroom, electricterrain… onFieldResidualOrder 27). Absent: it lasts (the turn facts that say so).
   */
  fieldTurns?: Partial<Record<"terrain" | "gravity" | "magicRoom", number>>;
};

export type DoublesOutcomeMon = {
  /* …existing and SPEC2 §3.1… */
  /** The Berry Cud Chew re-eats at the next end of turn (counter 1 after this one). */
  cudChew?: string;
};
```

`carriedIssues` (`doubles-turn.ts:2850`), as `{Name}: …` on the slot: `futureMove.move` not in the game (`"Doom Desire is not
in this game."`); a `source` that is not a Pokémon of the turn (`"Future Sight's user is not in the turn."`); a `build` that
fails validateBuild (`"Future Sight's user: {issue}"`); `cudChew` on a Pokémon without Cud Chew, or `cudChew.berry` not a
Berry of the game (`"Cud Chew needs a Berry it ate."`); `stall` outside the list (`"Protects in a row: 0 to 6."`);
`mustRecharge` with a move action (`"A Pokémon that must recharge takes no move."`); `switchedIn` with a move action
(`"A Pokémon that switched in this turn takes no move."`) or with `mustRecharge` (`"A Pokémon that switched in this turn
does not recharge."`); `firstTurn` false with `switchedIn` (`"A Pokémon that switched in this turn is on its first turn."`);
`fieldTurns` for an effect that is not up (`"Magic Room is not up."`, and the like) or outside 1–8 for the terrain, 1–5 for
Gravity and Magic Room (`"Gravity lasts 1 to 5 more turns."`, and the like). A `source` equal to the slot itself is accepted:
its user stands at the position it aimed at, and the landing does not hit (§4.1.5).

### 3.2 `app/lib/battle/types.ts`

```ts
// SideConditions ("Doubles turn only", beside SPEC2's mist, luckyChant, protectName):
  /** Safeguard up on the side from an earlier turn (doubles-world.ts SideState.safeguard as the turn starts). */
  safeguard?: boolean;
  /** Sword/Shield: G-Max damage over time on the side from an earlier turn (PS/data/moves.ts gmaxvinelash and kin: onResidual 5.1). */
  gmaxResidual?: ("gmaxvinelash" | "gmaxwildfire" | "gmaxcannonade" | "gmaxvolcalith")[];
```

### 3.3 `app/lib/battle/doubles-world.ts`

```ts
// EotState: replaces `futureMove?: string; cudChew?: true;`
  /** Carried (E's landing): the move, its source's starting slot when it is a Pokémon of the turn, else its build. */
  futureMove?: { move: "futuresight" | "doomdesire"; source: DoublesSlotId | null; build: BattleBuild | null };
  /** Cud Chew's Berry and counter (pinned abilityState.berry / counter): carried 1; a Berry eaten in the moves 2, in the end of turn 1. */
  cudChew?: { berry: string; counter: 1 | 2 };
// EotState.trap gains:
  /** G-Max Centiferno or Sandblast (pinned partiallytrapped onResidual: it continues after its user leaves). */
  gmax?: true;
// MoveVolatiles gains (D):
  mustRecharge?: true;
  stall?: number;
// SideState gains (E; absent = none; discreteKey through `sides`):
  /** G-Max side conditions up on the side (move ids). */
  gmax?: string[];
```

`startWorld` (`doubles-turn.ts:824-859`): `safeguard` from the input's side conditions (today `false`), `gmax` from
`gmaxResidual`; `carriedState` (`:861-884`): `futureMove`, `cudChew` (counter 1), `stall`, `mustRecharge`.

### 3.4 `app/lib/battle/doubles-actions.ts` (REASONS; exact texts)

```ts
  // status2 Tier 2
  /** E: a landing from a Pokémon not in battle beside two holders of one partner power boost (only with a duplicate species). */
  landingPartners: (move: string, ability: string) => `${move} landing with two ${ability} holders on its user's side is not modelled in 2v2.`,
```

Removed (by E, each with its last site): `landing` (`doubles-eot.ts:213`), `overTime` (`:217`), the `notIn2v2` sites for Cud
Chew (`:214`) and Moody (`:222`). `formChange` stays, its site narrowed to Power Construct (§4.5).

### 3.5 Kernel plumbing (Step 0c; `doubles-turn.ts`, `doubles-status.ts`; inert until a track calls it or an input sets a field)

| Where | Change |
|---|---|
| `TurnKernel` (new) | `residualHit(w, hit)` (§4.1.4) and `readonly inEndOfTurn: boolean` (true while `endOfTurnOf` runs) |
| `searchFor` (568) | `opts.attackerBuild?: BattleBuild` read instead of `calcBuild(w, attacker)`; `attacker: null` allowed (no attacker exclusion in `fieldSettled`, `turnUnnerve` without an attacker) |
| `conditionsFor` (483) | a `residual` variant: the attacker side's Helping Hand and Charge only from an active source's own MonState (FS17), no protect flag on the target, the partner boosts from the source's side's living Pokémon (§4.1.3) |
| `applyStep` (2016) | `opts.residual?: { attacker: DoublesSlotId \| null }`: follow false, no write to an attacker that is not alive, no `koBoost` unless alive, no Eject Button, no Destiny Bond (`statusHooks.onKnockOut` skipped: `!effect.flags['futuremove']`), no stats (`stepOf` null) |
| `noteItemUse` (SPEC2 §3.5) | a Berry eaten (not stolen) by a Cud Chew holder sets `eot.cudChew = { berry, counter: inEndOfTurn ? 1 : 2 }` |
| `createContext` (2769), `rootWorlds` (893), `startWorld` | a `switchedIn` slot gets no action; its `MonState.moved` is true from the start |
| `contextFor` (1500) | Payback: `doubled = !willMove(target) && !switchedIn(target)`; Bolt Beak and Fishious Rend: `turnOrder = willMove(target) \|\| switchedIn(target) ? "first" : "last"` |
| `doubles-status.ts earlyBranch` (815) | after the `willAct` check, for a protecting move or Endure: `guards.stallCheck(kernel, w, action, move)` (D; stub `{ go: [w], failed: [] }`) |
| `damagingMove` (1788) | Struggle: after its hits, in each world where a hit landed or met a Substitute, `afterLoss(attacker, max(1, round(baseMaxHP / 4)))` as directDamage (Magic Guard does not stop it; TR09, TR09b, TR09c) |
| `validate` (2809) | `struggle` is a legal action for any Pokémon; `switchedIn` / `mustRecharge` with a move action are issues (§3.1) |
| `turnFacts` (3294) | `Assumes no protecting move was used last turn.` only without `carried.stall`; `Assumes the attacker's first turn in battle.` only without `firstTurn`; new: `{Name} switched in this turn and takes no action.`, `{Name} must recharge.` |
| `outcomeOf` / `mergeOutcomes` (3548, 3586) | `cudChew` from `eot.cudChew` with counter 1 after the turn (merge key) |
| `doubles-eot.ts` | none in Step 0c (E's file; the end-of-turn facts of §4.6 move there with E) |

---

## 4. The entries

### 4.1 eot-landing: Future Sight and Doom Desire landing

#### 4.1.1 What pinned Showdown does

`futuremove` is a slot condition (`PS/data/conditions.ts:379-421`): `onResidualOrder: 3` (before Wish at 4 and every
Pokémon residual); at `endingTurn = (use turn − 1) + 2` it is removed and `onEnd(target)` runs on the Pokémon now at the slot
(`getAtSlot(targetSlot)`). `target.fainted` or `target === data.source` → no hit (a hint). Otherwise Protect and Endure are
removed, Infiltrator and Normalize of the source (gen ≥ 6, `hasAbility`) change the stored move data, and
`trySpreadMoveHit([target], data.source, hitMove, true)` runs the hit steps (`PS/sim/battle-actions.ts:550-620`):
invulnerability, TryHit, type immunity, TryImmunity, accuracy, the hit loop with its Update (`:967`). Then, only for an active
source holding Life Orb, `AfterMoveSecondarySelf` of Life Orb (gen ≥ 5) — no other AfterMoveSecondarySelf (Shell Bell),
whether or not the hit landed. The moveData has `ignoreImmunity: false` (Future Sight is blocked by a Dark type at the
landing though its use was not) and no `protect` flag.

The source is `data.source`, the Pokémon object: `ignoringAbility()` and `ignoringItem()` are true while it is not active
(`PS/sim/pokemon.ts:858-885`); its stats are read with its stages as they stand (0 off the field: `clearVolatile` on switch-out
and faint, `:1508-1559`). A source that fainted is `isActive: false`, has lost its Terastallization, and a Mega or Primal form
reverts to the set's species (`PS/sim/battle.ts:2535-2575` faintMessages: formeRegression, `delete pokemon.terastallized`).

Probes (sv unless stated):

| Id | Shows |
|---|---|
| FS01 / FS02 | Used on turn 1, lands at the end of turn 3; the landing's Sitrus is eaten at the hit's Update (`150 → 42 → 100`), before the partner's Leftovers (5.4). The set-up landing of FS02 gives FS01's turn-3 distribution exactly (81–100, 14 values): the oracle's prepare can set it up. |
| FS03 | Choice Specs Hatterene active: 160–190; on the bench: 108–127, equal to FS03c (active, no item). |
| FS04, FS17 | The active source's Calm Mind this turn counts (45–75 left, ×1.5); so does Helping Hand it received this turn (45–75: the helpinghand volatile lasts to the residual's end). |
| FS05 | Tera Psychic Clefable active: 135–151 left; knocked out this turn: 179 (no STAB, = FS05d not Terastallized); on the bench, still Terastallized: 151 (STAB kept). FS05e usum: a Mega Gardevoir knocked out this turn hits as base Gardevoir (Sp. Atk 194: 133 left, = FS05g); alive, as the Mega (238: 111 left, FS05f). |
| FS06 | Into a Dark type: `-immune`. Into a 40-HP Substitute: the Substitute breaks, the Pokémon is untouched. A Protect this turn: hit (127). Endure this turn at 30 HP: it faints. |
| FS07 | Active Life Orb source: ×1.3 (95 left) and −13 (1/10 of 132). Shell Bell at 50 HP: no heal. Life Orb into a Dark type: −13 anyway (FS07c). |
| FS08 champions | Active Infiltrator Meowstic-F into Light Screen and a 40-HP Substitute: 142–157 to the Pokémon (= FS08d, no screen); benched: the Substitute takes it (FS08b); benched under Light Screen: 173–183 (FS08c). |
| FS09 swsh | Active Analytic Beheeyem: 79–103 left (×1.3: no one will move); benched: 115–133. |
| FS10 usum | Doom Desire from an active Jirachi: 150 → 29–48. |
| FS11 | After an Ally Switch on the target's side the Pokémon now at the slot is hit (Partner 96); the user standing at its own target slot: `-hint … the target is the user`, no hit. |
| FS12 | Psychic Terrain boosts the landing of a grounded source active or benched (70–96 both). |
| FS13 | A Cud Chew target's Sitrus eaten at the landing (110 → 33 → 81) is eaten again at 28.2 the same turn (129): see §4.2. |
| FS14 | A target charging Fly: `-miss`. |
| FS15 | Weakness Policy (+2 Atk, +2 SpA) and Berserk (+1 SpA) act as on any hit. |
| FS16 | A source that fainted on an earlier turn still hits (108–127, no item or ability). |

#### 4.1.2 State

- **Input.** `DoublesCarried.futureMove` (§3.1) on the slot it lands on. Calculator: the `Future Sight lands` control (§5).
  Training: `bridge.ts carriedOf` reads the slot condition the belief battle rebuilt from public conditions
  (`belief-battle.ts:261-270`: `source: setter`): `source.isActive && !source.fainted` → `{ move, source: slotOfPokemon(source) }`;
  else `{ move, build: liveBuild(source) }` (a benched member, or one that fainted: its current form, which after a faint is its
  base form). The belief world's sets are its particle's: no hidden information beyond the belief.
- **World.** `EotState.futureMove` (§3.3) on the MonState of the Pokémon that started the turn in that slot, read through
  `kernel.occupant(w, slot)` as Wish is (`doubles-eot.ts:452-460`).

#### 4.1.3 The landing build and its field

| Source | Build the calculation reads | Partner boosts (Battery, Power Spot, Steely Spirit) | Life Orb, Moxie family |
|---|---|---|---|
| alive in the world (a turn slot) | `kernel.calcBuild(w, source)`: stages, item, ability, Tera as now; `MonState.helpingHand` and Charge as for its own move | its living partner (conditionsFor) | Life Orb: `max(1, floor(baseMaxHP/10))` after the landing in every world, hit or not, unless Magic Guard, Klutz, Embargo, Magic Room (FS07, FS07c); a knockout's rise (`koBoost`) |
| fainted (a turn slot) | its world build with the ability as `GAS_STAND_IN`, no item, stages 0, no Tera (mechanic dropped), a Mega or Primal form back to its base species (`withSpecies`) | its side's living Pokémon (`side.allies()` of an inactive Pokémon: the side's actives) | none |
| `build` (not in battle) | the given build with the ability as `GAS_STAND_IN`, no item, stages 0 (its form and Tera as given) | both living Pokémon of its side; two holders of one boost → `REASONS.landingPartners` (§4.1.8) | none |

The field: `conditionsFor` with the defender side as for any hit (screens, Friend Guard of the target's partner, the target's
Flower Gift), the Ruin abilities and auras as `has()` reads them, the terrain (the source's grounding read from its landing
build: no Air Balloon or Levitate off the field), no protect flag. Infiltrator and Normalize come with an active source's
build (the engine's own handling of those abilities: screens and the Substitute for Infiltrator, FS08a). Context:
`turnOrder: "last"` (Analytic, FS09). The type and power are the move's (Psychic 120 / Steel 140; Future Sight 120 in gen 9
and every game here: `PS/data/moves.ts:6392-6428`, `:3847-3880`).

#### 4.1.4 `TurnKernel.residualHit` (Step 0c; E calls it)

```ts
/**
 * One damaging hit at the residual (pinned futuremove onEnd: trySpreadMoveHit(…, notActive)), into the Pokémon at
 * `position`: the pair's step from `build` with no attacker side. `attacker`: the source's slot while it is a Pokémon of
 * the turn (alive: Life Orb, Moxie and its kin, Rowap and Jaboca Berries, a Red Card's drag apply to it; fainted: nothing),
 * null for one not in battle. Checks, in this order: the semi-invulnerable miss (eot.hidden), Telepathy (a source on the
 * target's side), the type immunity and Wonder Guard (the calculation's no-damage row); no Protect, Endure, Wide Guard or
 * Quick Guard, no redirection. Then singleStep's path: the Substitute (doubles-substitute.ts single), Disguise and Ice Face
 * (faceTaken), the Berry stand-ins (Heal Block, psychicNoiseKeepsBerry), applyStep with opts.residual, afterHit (Color
 * Change; the hooks of SPEC2 §3.5). Returns the child worlds and, per world, whether the hit reached the Pokémon.
 */
residualHit(w: World, hit: {
  move: string; position: DoublesSlotId; attacker: DoublesSlotId | null; side: DoublesSideId; build: BattleBuild;
  conditions: BattleConditions; context?: MoveContext;
}): { world: World; landed: number }[];
```

It reuses `searchFor` (with `opts.attackerBuild`) and `applyStep` (with `opts.residual`), so every reaction the moves' steps
know (Sitrus at the hit's Update, Focus Sash and Sturdy against a Move effect, Multiscale, Weakness Policy, Berserk and its
lock, Stamina, a resist Berry, Air Balloon popping, Seed Sower, Sand Spit, Cotton Down's and Innards Out's guards) applies as
there, with no new code. The calculations count against `BUDGET.calculations` as any other.

#### 4.1.5 E's handler (`doubles-eot.ts`)

- `collect`: for every MonState with `eot.futureMove` (the position = its starting slot), `at = kernel.occupant(w, slot)`;
  `add(RESIDUAL_KEYS.futuremove, at, [at, …source], [at, …source], landingHandler)` (holder Speed: the occupant's; a slot
  condition runs for a fainted occupant too, and hits nothing).
- `landingHandler(p, w, position, key)`: clear `eot.futureMove`; `target = occupant(position)`; no hit when the target has
  fainted, or when `source` is the Pokémon now at the position (FS11b: fact `{Move} does not hit: {Name} is its user.`).
  Otherwise build the landing (§4.1.3) and call `kernel.residualHit`. An active source with a working Life Orb then takes its
  loss in every child world (FS07c) through E's `changeHP` (a residual line `Life Orb` on it); no Update follows inside the
  residual after the hit (its own Updates, `PS/sim/battle-actions.ts:967, 1003`, came before), so its Berry waits for the final
  Update as any residual damage's does (not `kernel.afterLoss`, whose
  Update is the moves').
- **Recording** (the "all" walk only): the DoublesResidual line on the target (effect `Future Sight` / `Doom Desire`,
  `other` the source slot when it is a Pokémon of the turn) needs each path's HP change: for each HP value of the target's
  marginal, `residualHit` on a clone conditioned on that value (memoised calculations; the clones are discarded), the
  changes and knockouts recorded with their mass; the real world goes through one `residualHit`. The walks stay identical.
- Facts on the line: `{Name} is not in battle: its ability, item and stat changes do not count.` (a `build` source);
  `{Name} has fainted: its ability, item and stat changes do not count.` (a fainted turn source); `{Name} is back to {Base}
  after fainting.` (a Mega or Primal source that fainted); `{Name}'s Terastallization ended as it fainted.`; `{Move} misses
  {Name}.` (semi-invulnerable); the step's no-damage fact for an immunity (`{Name} is immune.`); the Substitute's facts as
  for a hit.
- `guardOf` loses the `futureMove` line (`doubles-eot.ts:213`).

#### 4.1.6 Interactions

- SPEC2's Heal Block in later steps (C14) and Embargo's `itemSuppressed`: through `searchFor`'s stand-ins and `itemWorks`.
- Glaive Rush (`takenMods.glaiveRush`): the holder takes ×2 until its own next BeforeMove, so the landing is doubled
  (calcBuild's markers).
- Opportunist and Mirror Herb (SPEC2 C9): a Weakness Policy or Berserk rise at order 3 is in the ledger and is copied at 29.
- Cud Chew (§4.2): a Berry the landing makes the target eat sets counter 1 (`inEndOfTurn`), so 28.2 re-eats it (FS13).
- Emergency Exit and Wimp Out: the HP at the residual's start against the HP after (`afterChecks`), as today.
- Red Card on the target against an active source: Showdown drags the source out after the residual (`PS/sim/battle.ts:2819-2826`
  forceSwitchFlag): the fact `Red Card: {Source} is dragged out after the turn.` on the source, its card's last line; the turn's
  numbers do not change (as Emergency Exit's `Switches out after the turn.`).
- Under R (wave 2): a source on the bench comes from `DoublesTurnInput.bench` (its build); the occupant of the position may be
  a newcomer (positional, as Wish).

#### 4.1.7 E2, Training, the calculator

E2: nothing new (HP, the target's build after its reactions). Training: the landing cells become engine cells; the reason
`{Move} landing is not modelled in 2v2.` leaves the census. Calculator: §5's control.

#### 4.1.8 What stays

`REASONS.landingPartners` for a source not in battle with two Battery (or Power Spot, Steely Spirit) holders on its side: both
are its allies (`side.allies()`), each chains its boost, and the calculation's partner flag counts one. Only a duplicate
species can hold two of these abilities on one side (Charjabug, Stonjourner, Perrserker are their only holders in these
games), which VGC's species clause forbids and the calculator allows. Every other landing is exact.

#### 4.1.9 Cases and tests

Oracle (V; `CaseCarried.futureMove` with a `source` slot or a `bench: CaseMon`, possibly `fainted: true`; prepare as
`land()` in probes-1):

| Id | Game | Case |
|---|---|---|
| T2E-FS01-sv / -champions | sv, champions | active Hatterene into a Sitrus Snorlax at 150; the partner's Leftovers (FS01, FS02) |
| T2E-FS02-sv / -usum | sv, usum | Choice Specs Hatterene on the bench (sv, FS03b); Doom Desire from a benched Jirachi (usum) |
| T2E-FS03-sv / -champions | sv, champions | active source with Calm Mind and Helping Hand this turn (FS04, FS17) |
| T2E-FS04-sv / -usum | sv, usum | Tera Psychic Clefable knocked out this turn (FS05b); a Mega Gardevoir knocked out this turn: base Gardevoir's Sp. Atk (FS05e) |
| T2E-FS05-sv / -swsh | sv, swsh | an active Life Orb source into a Dark type: immune, −1/10 (FS07c) |
| T2E-FS06-sv / -champions | sv, champions | Protect this turn: hit; Endure this turn at 30 HP: faints (FS06c, FS06d) |
| T2E-FS07-sv / -champions | sv, champions | Ally Switch on the target's side (FS11a); FS07b-sv: the user at its own target slot (FS11b) |
| T2E-FS08-champions / T2E-FS08b-champions | champions | active Infiltrator Meowstic-F into Light Screen and a Substitute; benched (FS08a, FS08b) |
| T2E-FS09-swsh / T2E-FS09b-swsh | swsh | active and benched Analytic Beheeyem (FS09) |
| T2E-FS10-sv / -usum | sv, usum | a target charging Fly (sv), Dig (usum): missed (FS14) |
| T2E-FS11-sv / -champions | sv, champions | Weakness Policy (sv), Berserk Drampa (champions) (FS15) |
| T2E-FS12-sv / -champions | sv, champions | Psychic Terrain, benched grounded source (FS12b) |
| T2E-FS13-sv / -swsh | sv, swsh | a source fainted on an earlier turn, on the bench at 0 HP (FS16) |
| T2E-FS14-sv / -champions | sv, champions | an active Shell Bell source at 50 HP: no heal (FS07b) |

Tests (`tests/unit/doubles-eot.test.ts`, E): the landing build per row of §4.1.3; no hit for a fainted occupant and for the
user at the slot; the per-value recording equals the "all" walk's HP mixture; Life Orb's loss without a hit;
`carriedIssues`' texts. `tests/source/status2-hooks.test.ts`: `residualHit` is called only from `doubles-eot.ts`.

### 4.2 eot-cudchew: Cud Chew

#### 4.2.1 What pinned Showdown does

`PS/data/abilities.ts:742-771`: `onEatItem` of a Berry (not through Bug Bite or Pluck) sets `berry` and `counter = 2`, then
`counter--` when the queue is empty (the Berry was eaten during the residual); `onResidual` (28.2): with a Berry and HP,
`--counter <= 0` re-eats it: `singleEvent('Eat', item)` (the Berry's effect, no item needed, no TryEatItem), then
`runEvent('EatItem')` (which records the same Berry again with counter 1, deleted right after), then the berry and counter
are deleted.

| Id | Shows |
|---|---|
| CC01 sv | Eaten in the moves: counter 2 → 1 at this residual, no re-eat; re-eaten at the end of the next turn (+48 = floor(195/4)). |
| CC02 sv | Eaten at the weather's Update (order 1): counter 1, re-eaten at 28.2 the same turn (93 → 141 → 189). |
| CC03 sv | Eaten at the final Update (after Leech Seed): counter 1, re-eaten at the end of the next turn. |
| CC04 sv | Due now beside a foe's Unnerve: re-eaten (+48); under Heal Block: eaten, no HP. |
| CC05 champions | A Lum Berry re-eaten cures a status given this turn (after the poison damage at 9). |
| CC06 sv | A Liechi Berry re-eaten: +1 Attack, copied by a foe's Opportunist at 29. |
| CC07 champions | A Sitrus at full HP: eaten, no HP. |
| CC08 sv | A counter of 2 at a turn's start only counts down (it cannot happen: every Berry eaten before a turn leaves 1 or none). |
| CC09 sv | A Starf Berry re-eaten: one of the stats below +6, 1/4 each with Attack at +6. |
| CC10 sv | A Berry eaten in the moves replaces the due one: the carried Sitrus is not re-eaten, the Lum is due next turn. |
| FS13 sv | A Berry the landing makes it eat (order 3, queue empty) is re-eaten at 28.2. |

So, as a turn starts, a Cud Chew holder has a Berry due this turn or none: `carried.cudChew: { berry }` is all the state.

#### 4.2.2 Model

- `carriedState`: `eot.cudChew = { berry, counter: 1 }`.
- The counter writer: `noteItemUse` (§3.5) for every Berry a Cud Chew holder eats or is made to eat (at its Updates, at a
  hit's Update, by Teatime or Stuff Cheeks, a Berry flung at it); not a Berry it eats with Bug Bite or Pluck, and not one a
  foe's Bug Bite takes from it: counter 2 during the moves, 1 during the end of turn. D's `guards.tracksItems(input)` is also true with a Cud Chew
  holder in the turn (the readers rule).
- E's `collect`: a `cudchew` handler (RESIDUAL_KEYS.cudchew, 28.2, by Speed) for **every** Cud Chew holder, since a Berry may be
  eaten before 28.2 in this residual. `cudChewHandler`: with HP and `eot.cudChew`, counter − 1; at 0, delete it and apply the
  Berry's effect with no item consumed, no Unburden, no Symbiosis, no `lastItem` or `usedItem` (an Eat, not an eatItem), no
  TryEatItem (Unnerve passes), Heal Block stopping the heal (TryHeal):
  - HP Berries: the heal from `hit-loop.ts berryArithmetic` (Sitrus `trunc(baseMaxHP/4)`, Oran 10, the Figy family's by
    generation; Ripen cannot be the holder's ability); none at full HP; the Figy family's confusion by nature
    (`statusHooks.berryConfusion`);
  - curing Berries as `eatCuring` (Lum also confusion, Persim confusion), with no item to lose;
  - stat Berries (Liechi family, Kee, Maranga) through `kernel.selfBoost` (the ledger: Opportunist and Mirror Herb copy at 29,
    CC06); Lansat `focusEnergy`; Starf: one world per stat below +6 in E2, the fact `Raises one random stat by 2.` in the
    calculator's walks (SPEC2's Starf rule); Micle, Custap, Enigma, Jaboca, Rowap, the resist Berries and Leppa: nothing the turn
    reads.
- Residual line: effect `Cud Chew`; the HP change; facts `Eats its {Berry} again.` and the Berry's own (`Cures its {status}.`,
  `Snaps out of confusion.`, `Attack +1.`, `Becomes confused.`, `Raises one random stat by 2.`, `Raises its critical-hit ratio.`).
- E2: `DoublesOutcomeMon.cudChew` for a Berry still due (counter 1 after the turn).
- `guardOf` loses the Cud Chew line (`doubles-eot.ts:214`).

#### 4.2.3 Training (T)

The tracker gains `PublicMon.cudChew?: { berry: string; turn: number }`: the last Berry the Pokémon ate this stint, from its
`-enditem|…|{Berry}|[eat]` lines (not `[from] stealeat`), cleared by its `-activate|…|ability: Cud Chew` re-eat and by a
switch-out. The bridge replaces `bridge.ts:241-242` with: the active Pokémon's ability is Cud Chew and `pub.cudChew.turn` is the
previous turn → `carried.cudChew = { berry }`. Every part of that is public (finding 3).

#### 4.2.4 Cases

| Id | Game | Case |
|---|---|---|
| T2E-CC01-sv / -champions | sv, champions | carried Sitrus due now (CC04a without Unnerve) |
| T2E-CC02-sv / -champions | sv, champions | eaten in the moves: no re-eat; E2 `cudChew` (CC01 turn 1) |
| T2E-CC03-sv / -champions | sv, champions | eaten at the weather's Update: re-eaten at 28.2 (CC02; champions: Tyranitar's sand) |
| T2E-CC04-sv / -champions | sv, champions | eaten at the final Update: E2 `cudChew` (CC03 turn 1) |
| T2E-CC05-sv / -champions | sv, champions | due now beside a foe's Unnerve (CC04a) |
| T2E-CC06-sv / -champions | sv, champions | due now under Heal Block (CC04b) |
| T2E-CC07-champions / -sv | champions, sv | Lum re-eaten after a Toxic this turn (CC05) |
| T2E-CC08-sv, T2E-CC08b-sv | sv | Liechi re-eaten, a foe's Opportunist copies at 29 (CC06); the same without the copier. Champions has no Liechi Berry and Cud Chew is SV and Champions only, so both are SV |
| T2E-CC09-sv | sv, outcomes | Starf re-eaten (CC09); SV only: Champions has no Starf Berry |
| T2E-CC10-sv / -champions | sv, champions | a Lum eaten in the moves replaces the due Sitrus (CC10) |
| T2E-CC11-champions / -sv | champions, sv | due at full HP (CC07) |

### 4.3 Moody (E2 and the calculator)

#### 4.3.1 What pinned Showdown does

`PS/data/abilities.ts:2701-2733` (gen 8+): `sample` over Attack…Speed below +6 for +2, then `sample` over those above −6 but the
raised one for −1, then one `boost()` from the holder on itself. Gen 7 (`PS/data/mods/gen7/abilities.ts:39-64`) counts accuracy
and evasion. Order 28.2 by Speed (MO07: after a faster Speed Boost, before the Toxic Orb at 28.3).

| Id | Shows |
|---|---|
| MO01 sv, MO06 champions | 20 outcomes, 1/20 each. |
| MO02 usum | 42 outcomes (accuracy and evasion), 1/42 each. |
| MO03 sv | At Attack +6 and Speed −6: 4 rises, then 3 or 4 drops (1/12 and 1/16 paths). |
| MO04 sv | Its own White Herb restores the −1 at 29 and is used (5 outcomes). |
| MO05 sv | A foe's Opportunist copies the +2 at 29. |

#### 4.3.2 Model (E)

- `moodyHandler` (RESIDUAL_KEYS.moody, 28.2): the rise and drop candidates from the holder's stages (Attack…Speed from
  `build.boosts`; in gen 7 also `vol.stages.accuracy` and `.evasion`), one world per pair at the product of the two uniform
  choices, each through `kernel.selfBoost` (applyBoosts: Contrary, Simple, the caps; no Defiant, Competitive, Mist, Clear
  Amulet or Mirror Armor, which ignore a Pokémon's own boost; the ledger for Opportunist and Mirror Herb; `fell` for Eject Pack).
- **Readers rule.** E2 (`p.e2`) always branches (the outcome builds read the stages). The calculator's three walks branch only
  when something after 28.2 reads the holder's stages: its White Herb or Eject Pack, a foe's Opportunist or Mirror Herb, its own
  Starf Berry due at the final Update; otherwise the world stays as it is and the recording walk records the stage facts with
  their masses (each rise text 1/5, each drop text 1/5 from 0). Either way the HP is the same; only the stage-reading facts
  need the worlds.
- Residual line: effect `Moody`, facts `Attack +2.`, `Speed −1.` (`stageFacts`; gen 7 also `Accuracy +2.`, `Evasion −1.`).
  The turn fact `Moody raises one stat and lowers another.` goes.
- `guardOf` loses the E2 line (`doubles-eot.ts:222`).

#### 4.3.3 Cases

| Id | Game | Case |
|---|---|---|
| T2E-MO01-sv / -champions | sv, champions, outcomes | from 0 (MO01, MO06) |
| T2E-MO02-usum / T2E-MO02b-usum | usum, outcomes | from 0 (MO02); at evasion +6 |
| T2E-MO03-sv / -swsh | sv, swsh, outcomes | at Attack +6 and Speed −6 (MO03) |
| T2E-MO04-sv / -champions | sv, champions | its own White Herb (MO04) |
| T2E-MO05-sv / -champions | sv, champions | a foe's Opportunist (MO05) |

The calculator walk's facts are checked by `app-diff.mjs`'s fact lists; E2 by SPEC2 §7.1's stage comparison.

### 4.4 eot-overtime: G-Max damage over time (SwSh)

#### 4.4.1 What pinned Showdown does

G-Max Vine Lash, Wildfire, Cannonade, Volcalith (`PS/data/moves.ts:7365`, `:7463`, `:6735`, `:7403`): `self.onHit` adds a
4-turn side condition to the foe's side; its `onResidual` (order 5, subOrder 1) runs for each active Pokémon of that side, by
their Speed, `damage(baseMaxhp / 6)` unless it has Grass, Fire, Water, Rock respectively; the countdown is the side's 26.11, so
the turn it lands deals its first damage. G-Max Centiferno and Sandblast (`:6773`, `:7143`): `self.onHit` traps every active
foe (`addVolatile('partiallytrapped', source, …)`), whose `onResidual` (13) continues after the user leaves
(`PS/data/conditions.ts:222-260`: `gmaxEffect`).

| Id | Shows |
|---|---|
| GX01 | 1/6 (39 of 235) at 5.1, before Grassy Terrain (5.2) and Leftovers (5.4); set though the target fainted. |
| GX02, GX03 | Set by a hit into a Substitute, and by the quarter through Protect. |
| GX04 | A Magic Guard foe takes nothing; a Dynamaxed foe takes floor(235/6) = 39 of its 470. GX04b: a Water type takes nothing. |
| GX05 | Centiferno traps both foes; the user faints to a later Earthquake; each trap still deals 1/8 (29) at 13. |
| GX06 | One from an earlier turn (3 turns left): damage at 5.1. |

#### 4.4.2 Model (E)

- `afterHit` (`doubles-eot.ts:1122`, E's): when `info.isMax`, the effective move is one of the four and
  `outcome.landed + outcome.subHits > 0` (target alive or not), `w.sides[foeSide].gmax` gains its id (no duplicate). For
  Centiferno and Sandblast, every living foe of the attacker not already trapped gets `eot.trap = { source: attacker, divisor:
  bindingBand ? 6 : 8, move: id, gmax: true }`.
- `trapHandler` (`:709`): a `gmax` trap does not end when its source is gone.
- `collect`: for each living Pokémon of a side with `gmax`, a handler at `RESIDUAL_KEYS.gmaxresidual` (new in `residuals.ts`:
  `{ order: 5, subOrder: 1, priority: 0 }`) per id: `amountTo(−residualPart(baseMaxHP, 6))` unless the type (`kernel.typesOf`)
  or Magic Guard; recorded under the move's name, `other` the user when it was set this turn. One side-residual handler at 5.1
  (a side condition, the divisor and the type it spares) also serves the Fire Pledge's sea of fire (1/8, Fire spared:
  tier2-presence.md §3.17), so E writes it once for both.
- Input: `SideConditions.gmaxResidual` (SwSh), read by `startWorld` into `SideState.gmax`.
- `guardOf` loses the G-Max scan (`doubles-eot.ts:188-197`, `:217`) and GMAX_OVER_TIME goes.
- E2: not emitted (SwSh has no Training; the readers rule).

#### 4.4.3 Cases (SwSh only: two cases each)

| Id | Case |
|---|---|
| T2E-GX01-swsh / T2E-GX01b-swsh | Wildfire into a non-Fire pair with Grassy Terrain and Leftovers (GX01, no knockout); into a Substitute (GX02) |
| T2E-GX02-swsh / T2E-GX02b-swsh | Wildfire through Protect (GX03); Cannonade with a Magic Guard and a Dynamaxed foe (GX04) |
| T2E-GX03-swsh / T2E-GX03b-swsh | Centiferno, the user knocked out later (GX05); Sandblast with Binding Band (1/6) |
| T2E-GX04-swsh / T2E-GX04b-swsh | carried Vine Lash (GX06); carried Volcalith beside a Rock type |

### 4.5 eot-form-change: forms at order 29

#### 4.5.1 What pinned Showdown does

Zen Mode (`PS/data/abilities.ts:5585-5620`), Shields Down (`:4239-4272`), Schooling (`:4044-4076`), Power Construct
(`:3385-3399`), each `onResidualOrder: 29`, skipping a transformed holder (and Schooling under level 20). The first three call
`formeChange` without `isPermanent`: `setSpecies` (types, weight, stored stats; `PS/sim/pokemon.ts:1387-1418`), the HP and
maximum HP unchanged. Power Construct's is permanent: `updateMaxHp` (`:1499-1506`) sets `hp = newMax − (oldMax − hp)`.

| Id | Shows |
|---|---|
| FC01 usum | Darmanitan poisoned to 73/180 → Darmanitan-Zen (Fire/Psychic, Speed 115 → 75), HP 73/180. |
| FC02 usum | Zen above half (Leftovers to 96) → back to Darmanitan. |
| FC03 swsh | Darmanitan-Galar → Darmanitan-Galar-Zen (Ice/Fire). |
| FC04 sv | Minior-Blue (Meteor at the start) to half by Leech Seed → Minior-Blue (the set's Core), Speed 80 → 140. |
| FC05 swsh | Wishiwashi School to a quarter → Solo. |
| FC06 usum | Zygarde 85/183 → Zygarde-Complete 193/291; the final Update's Sitrus line is 145 of the new maximum (not eaten); under the old maximum (91) it would have been. |

The paired forms have equal base HP (Darmanitan 105 / Zen 105, Galar likewise; Minior 60 / 60; Wishiwashi 45 / 45: a unit test
pins it), so the kernel's maximum HP per slot (`kernel.hp`) stays right for them.

#### 4.5.2 Model (E)

- `formGuard` (`doubles-eot.ts:949-961`) becomes `formHandler` for Zen Mode, Shields Down and Schooling with `FORM_LINES`'
  rule: the target form is the line's other side (Zen: `darmanitanzen` / `darmanitangalarzen` and back; Shields Down: Meteor
  above half, else the core it started as, `minior` for a build that started as `miniormeteor` (every core has the same stats,
  types and weight); Schooling: School above a quarter).
- **Readers rule.** E2 splits the world on the line (`condition`) and gives the flipping side `withSpecies(build, form)`
  (SPEC2 §3.3: storedStats, weighthg, types, addedType dropped). Nothing after 29 in the turn reads the form (White Herb, Eject
  Pack, Micle and the final Update read neither types nor stats, and the maximum HP is the same), so the calculator's walks do
  not split: the recording walk records the fact with the mass of the marginal on the flipping side.
- Residual line: effect the ability's name, fact `Becomes {Form}.` (Hunger Switch's text, `doubles-eot.ts:972`).
- **Power Construct keeps** `REASONS.formChange` (`Power Construct changing Zygarde's form is not modelled in 2v2.`) where the
  HP can cross half. Its maximum HP changes per world (FC06), the final Update reads the new one, and `DoublesHP` has one
  maximum per Pokémon: a per-outcome maximum would be a contract change of the HP card. Zygarde with Power Construct is in
  USUM and SwSh only, and not in Training.

#### 4.5.3 Cases

| Id | Game | Case |
|---|---|---|
| T2E-FC01-usum / -swsh | usum, swsh, outcomes | Zen on (FC01); Galar Zen on (FC03) |
| T2E-FC02-usum / -swsh | usum, swsh, outcomes | Zen off above half (FC02) |
| T2E-FC03-sv / -usum | sv, usum, outcomes | Shields Down Meteor → Core (FC04) |
| T2E-FC04-swsh / -usum | swsh, usum, outcomes | Schooling School → Solo (FC05) |
| T2E-FC05-usum / -swsh | usum, swsh | Power Construct: `endNotEstimated` with the kept text (FC06) |

### 4.6 tr-field-side

#### 4.6.1 The four texts

| Text (`bridge.ts:270-283`) | Reachable in Champions | Decision |
|---|---|---|
| `Weather {id} is not modelled.` | no: `WEATHER` maps all eight weather ids of the pinned simulator | **kept** as a defensive template (a new id) |
| `Field effect {id} is not modelled.` | no: Champions has Trick Room, Gravity, Wonder Room, Magic Room and Fairy Lock (`ROOMS`; Fairy Lock only stops switch choices), and no Echoed Voice, Sports or Ion Deluge | **kept** as defensive |
| `Magic Room ending this turn is not modelled.` | yes | **modelled**: `fieldTurns.magicRoom` (§4.6.2) |
| `Side effect {id} is not modelled.` | `safeguard` yes; `mist`, `luckychant` have no move in Champions; Pledges none | **safeguard mapped** (`SideConditions.safeguard`); `mist` and `luckychant` mapped to SPEC2's `SideConditions.mist` / `luckyChant` (`luckychant` leaves IGNORED_SIDE: it stops always-critical moves); the template **kept** for other ids |

#### 4.6.2 `fieldTurns` (E, T, U)

TR08 (champions): Magic Room with 1 turn left ends at 27.6 and a Sitrus holder at 100/235 eats at the final Update (158);
with 2 left, nothing. E adds field handlers at `RESIDUAL_KEYS.gravity` (27.2), `.magicroom` (27.6), `.terrain` (27.7), only
for an effect from before the turn (`kernel.input.field`, not in SPEC2's `fieldSet`) with `fieldTurns[x] === 1`: the effect
ends there (`w.field`), the end-of-turn fact `Gravity ends.` / `Magic Room ends.` / `{Terrain} Terrain ends.` (as
`weatherHandler`'s `{Weather} ends.`), a terrain's end through `fieldChangeGuard` (a field-settled holder keeps
`fieldChange`). Later handlers then read the field as it is (the Orbs at 28.3, White Herb at 29, the final Update). The
turn facts `Assumes Magic Room does not end this turn.` (`roomFact`), `Assumes the {X} Terrain does not end this turn.` and
`Assumes Gravity does not end this turn.` (`doubles-eot.ts:845-852`) are not given when the effect's turns are given.
Training: `fieldTurns` from `fieldClock` (`bridge.ts:109-130`: the belief battle's durations from public `since` counts), and
the Magic Room rollout goes. E2's field after the turn shows the end; `nextClock` agrees (`count(1, false, …) = 0`).

#### 4.6.3 Safeguard

`SideConditions.safeguard` (§3.2) → `startWorld`'s `SideState.safeguard`; the engine already models what reads it (status
moves, Yawn's pass; a damaging move's every-use status into the side is the safeguard-damaging-status entry, another Tier 2
design's: tier2-moves.md asks for the same earlier-turn input, and this is to be the one field). Training maps `safeguard`
(MAPPED_SIDE).
Its countdown (26.3) reads nothing later in the turn that a Safeguard changes (Yawn's sleep and an Orb pass it), so no turns.

#### 4.6.4 Cases

| Id | Game | Case |
|---|---|---|
| IN-FT01-champions / -sv | champions, sv | `fieldTurns.magicRoom: 1`, a Sitrus holder (TR08); 2 (TR08b) |
| IN-FT02-sv / -usum | sv, usum | `fieldTurns.terrain: 1` (Misty) and a Toxic Orb holder: badly poisoned at 28.3 (status-eot `build/verify-eot-probes/out/field-end-probe.out` line 7; 5 left, line 15: none) |
| IN-FT03-sv / -swsh | sv, swsh | `fieldTurns.gravity: 1`, Misty Terrain and a Flame Orb Corviknight: burned at 28.3, Gravity having ended at 27.2 (the same probe, lines 8 and 16) |
| IN-SG01-champions / -sv | champions, sv | `SideConditions.safeguard`: Will-O-Wisp and Spore into the side fail |

### 4.7 tr-moves-state

| Text (`bridge.ts:304-336`) | Decision |
|---|---|
| `{Name}: recharging while confused is not modelled.` | **modelled**: `carried.mustRecharge` (§4.7.1) |
| `{Name}: struggle is not modelled.` | **modelled**: Struggle as an engine move (§4.7.2) |
| `{Name}: sleeptalk is not modelled.` | follows the Sleep Talk model of the sibling Tier 2 designs (tier2-presence.md §3.14, which also removes this rollout; tier2-moves.md's sleep-talk-uproar row); until it lands the text stays |
| `{Name}: {move} is not in its catalog moves.` | **kept**: catalog data, not a mechanic |
| `{Name} must recharge.` | **kept**, defensive: a request with Recharge offers no other move |
| `{Name}: {move} after its first turn while confused is not modelled.` | **modelled**: `firstTurn` (§4.7.3) |
| `Payback into a Pokémon that switched in.` / `Analytic with a switch this turn.` | **modelled**: `switchedIn` (§4.7.4) |
| `{Name}: Ingrain on a Pokémon that is not grounded otherwise is not modelled.` | SPEC2 (A2's grounding enabler) |

#### 4.7.1 Recharge

`mustrecharge` (`PS/data/conditions.ts:364-378`): `onBeforeMovePriority: 11`, returns null after `cant|…|recharge`: nothing
below 11 runs. TR01 (champions): put to sleep after its Hyper Beam, the recharge turn does not lower the sleep counter (2/2,
3/3 kept); TR11: a confused one takes no self-hit and its confusion's turn is not counted (time 4 kept). Model: D's
`guards.beforeFirst` (SPEC2 §3.5, priority 100 for Glaive Rush) then stops a Pokémon with `vol.mustRecharge` (from the carried
field): the turn fact `{Name} must recharge.`; its action is consumed (`moved`). Training: `carried.mustRecharge` from the
volatile, the action No move; the rollout goes. Calculator: the `Recharging` checkbox (§5).

#### 4.7.2 Struggle

`PS/data/moves.ts:18212-18233`: typeless (`onModifyMove` type `???`), 50 power, physical contact, `target: "randomNormal"`;
`struggleRecoil`: `clampIntRange(round(baseMaxhp / 4), 1)` as directDamage after a move that dealt damage
(`PS/sim/battle-actions.ts:1381-1389`). TR09: a random foe, 1/2 each; recoil 59 of 235. TR09b: into a Substitute, recoil.
TR09c: into Protect, none. The app's `calculateTurnMove` already gives its typeless damage (31–37 into Gengar, 29–35 into
Snorlax: the probe's lowest rolls 31 and 29). Model (Step 0c, §3.5): `struggle` a legal action, the random foe as any
`randomNormal` move, the recoil as above (in the moves, `afterLoss`: the move's own later Update eats a Berry for it,
`PS/sim/battle-actions.ts:1003`). Training passes the request's Struggle (its learnable check lets Struggle through); the
calculator offers no Struggle.

#### 4.7.3 Fake Out and First Impression after the first turn

Fake Out's own `onTry` (`PS/data/moves.ts:5097-5100`: `activeMoveActions > 1`) fails after BeforeMove and TryMove. TR07
(champions): a confused Incineroar under Gravity hurts itself in 0.33, then Fake Out fails; Splash ("No move", the bridge's
stand-in) would stop at Gravity's BeforeMove (TR03b). Model: `DoublesPokemonInput.firstTurn: false`; D's move Try hook (SPEC2's
`guards.flingTry` at damagingMove after moveInfo, which now also covers these two) fails them with the step fact `{Move} fails:
it is not {Name}'s first turn.`. Training passes the real move with `firstTurn: mon.activeMoveActions === 0` (public: the
tracker's action count); its note and rollout go. Calculator: `Not its first turn` (§5).

#### 4.7.4 A Pokémon that switched in

Showdown: a switch action is no move action; `newlySwitched` stays true for the turn (`PS/sim/pokemon.ts:1551`, reset at the
next turn `PS/sim/battle.ts:1673`): Payback is not doubled (`PS/data/moves.ts:13191-13198`; TR06a 51 against TR06b's 102), Bolt
Beak and Fishious Rend are (`:1606-1613`, `:5497-5504`), Core Enforcer passes it (`:2886-2891`), Helping Hand onto it works
(`:8585`); Analytic (`PS/data/abilities.ts:110-125`) does not wait for it (TR10a 76 against TR10b's 58); its sleep counter and
freeze do not move (TR02). Model (Step 0c): no action for a `switchedIn` slot, `moved` true, `contextFor`'s Payback and
Bolt Beak rules; the turn fact `{Name} switched in this turn and takes no action.`. Training: `switchedIn` for the slots in
`switched` (`bridge.ts:304`), FIRST_IN_A_SWITCHED_SLOT and both rollouts go (finding 1 fixed with them). Calculator: the
`Switched in` action (§5). Core Enforcer's own model belongs to the volatile-secondaries entry (another Tier 2 design); it reads
`switchedIn` there.

#### 4.7.5 Cases

| Id | Game | Case |
|---|---|---|
| IN-RC01-champions / -sv | champions, sv | `mustRecharge` and asleep (TR01 turn 2) |
| IN-RC02-champions / -sv | champions, sv | `mustRecharge` and confused (TR11) |
| IN-SU01-champions / -sv | champions, sv | Struggle, random foe, recoil (TR09) |
| IN-SU02-champions / -sv | champions, sv | Struggle into a Substitute (TR09b) and into Protect (TR09c) |
| IN-FO01-champions / -sv | champions, sv | `firstTurn: false` Fake Out, confused, under Gravity (TR07) |
| IN-SW01-champions / -sv | champions, sv | `switchedIn`, asleep (TR02) |
| IN-SW02-champions / -sv | champions, sv | Payback into a `switchedIn` foe (TR06a) |
| IN-SW03-champions / -sv | champions, sv | Analytic (Starmie; SV Porygon2) with a `switchedIn` foe (TR10a) |
| IN-SW04-swsh / IN-SW04b-swsh | swsh | Bolt Beak (Dracozolt) and Fishious Rend (Dracovish) into a `switchedIn` foe: doubled (both moves exist in SwSh only) |

V's harness: `CaseAction.switchIn: true` puts the case's Pokémon on the bench behind a placeholder (a Splash Snorlax at a
distinct Speed) that switches to it on turn 1; the app input is the Pokémon with `switchedIn: true`. Its entry ability must
be one the app's start settle also applies (cases use none).

### 4.8 tr-splits-prelude

| Text | Decision |
|---|---|
| `{Move} under Gravity while confused: its failing world is not modelled.` (`splits.ts:53`) | **modelled**: `carried.stall` in the engine (§4.8.1); the Protect fork leaves splits.ts |
| `Speed tie between switches with an entry effect.` (`prelude.ts:27`) | **modelled** by the prelude's enumeration (§4.8.2); the text stays above its bound |
| `Trace enters against two different abilities.` (`prelude.ts:33`) | **modelled** by the enumeration |
| `Prelude failed: {message}` | **kept**: an engine error class (the simulator threw) |
| `The battle ended before the moves.` | **kept**: no moves to estimate; the rollout returns the finished battle's result |
| `A replacement is needed before the moves.` | **wave 2 (R-T)**, as SPEC2 §6: the prelude answers the mid-prelude switch request with the replacement policy (the AI's `ReplacePolicy`, the player's healthiest-bench rule, Q9) and runs on to the first move (Emergency Exit after entry hazards in Champions; Eject Pack does not exist there) |

#### 4.8.1 The stall counter in the engine

`protect` (`PS/data/moves.ts:13962-13990`) and Endure (`:4806`): `onPrepareHit` returns `!!queue.willAct() &&
runEvent('StallMove')`, the stall volatile's `randomChance(1, counter)` (`PS/data/conditions.ts:447-455`), after the whole
BeforeMove (TR03: confusion's self-hit 0.33, then the Protect fails 0.4467 = 0.67 × 2/3 and works 0.2233). D's
`guards.stallCheck` (called by Step 0c's earlyBranch line) splits the world: `go` at `mass / stall` (the protect or endure
set), `failed` at the rest with the step fact `{Move} fails.`; the stall volatile is not carried further (E2 does not need it:
Training's next turn reads its public streak). Training: `carried.stall = min(729, 3^protectStreak)` (1 for none: no assumption)
(`effects.ts`'s R11 rule), and splits.ts no longer forks; `splitWorlds` stays as the identity. Calculator: `Protects in a row` (§5).
Wide Guard and Quick Guard do not check the counter from generation 7 (`doubles-turn.ts:3305-3306`), so `stallCheck` skips them.

#### 4.8.2 The prelude's random events

Today `runPrelude` reseeds the clone (`prelude.ts:35`) and rolls out on two of its random events. Its replacement
`runPreludeWorlds(json, choices)` runs the clone under a decision-prefix chooser (guards-sim.ts's `Chooser`), enumerating:

- the `speedSort` shuffles of the actions that run before the first move (switches 103, Mega Evolutions 104: TR04, TR05) and
  of the SwitchIn handlers (`fieldEvent('SwitchIn')`: entry abilities and items at one Speed), each order at 1/k!;
- `sample` (Trace's copy, Forewarn's pick), 1/n each;
- not the queue's move actions (order 200: the engine sorts and branches them itself), and no `randomChance` (Quick Claw's
  and Quick Draw's rolls at queue time are answered false: the engine's `fractionalOutcomes` branches them).

Each finished prelude world (stopped at its first action of order ≥ 200) goes through the bridge and the engine; the cell is
the weighted mixture (`EngineWorlds.worlds` already carries weights). A prelude world that rolls out makes the cell a rollout.
Bound: 8 prelude worlds per cell; above it, `Speed tie between switches with an entry effect.` as today (three or four tied
switches with entry effects). Any other random draw before the first move is a rollout `Prelude failed: random {kind} before
the moves.`. No hidden information: the enumeration runs on the belief world the reseeded prelude ran on. Cost: the work
budget counts each prelude world as a prelude (`PRELUDE_WORK`); ties are rare.

#### 4.8.3 Tests (T)

Unit: `runPreludeWorlds` on TR04's and TR05's positions gives two worlds of weight 1/2 with sun and rain (sand); a Trace
newcomer facing two abilities gives two; Quick Claw does not branch; above the bound the text. The stall: the engine's 1/3
with confusion under Gravity (IN-ST01). Conformance: gate 4b's cells move from splits to the engine with the same values.

| Id | Game | Case |
|---|---|---|
| IN-ST01-champions / -sv | champions, sv | `stall: 3`, confused, under Gravity (TR03) |
| IN-ST02-champions / -sv | champions, sv | `stall: 9` Detect; `stall: 1` (no fact) |

### 4.9 Budgets: too-many and engine-error

#### 4.9.1 Today (probes-3, census-sim's sample)

| | Champions (8000 turns; 6867 ready) | SV (2000; 1679 ready) |
|---|---|---|
| `Too many cases to follow.` | 0 (turn), 0 (end of turn), 0 (E2) | 0, 0 |
| `This matchup could not be calculated` | 0 | 0 |
| Worlds after an action, p50 / p99 / max (budget 1 500) | 1 / 4 / 26 | 1 / 6 / 12 |
| Factor entries, p50 / p99 / max (200 000) | 17 / 319 / 5 870 | 35 / 440 / 2 136 |
| End-of-turn entries, p99 / max | 281 / 5 870 | 408 / 2 136 |
| Calculations, p50 / p99 / max (160, three walks) | 2 / 9 / 58 | 5 / 10 / 20 |
| Step reruns (48) / states | 0 / ≤ 1.1 % | 0 / ≤ 0.7 % |
| Largest tied end-of-turn group | none | none |
| E2 outcomes, p99 / max | 3 / 10 | — |

World state (worlds and entries) never passes 1/34 of its budget on a ready sample turn; calculations reach 58 of 160 (8
Champions turns above 1/4 of the budget, 27 above 1/8, 63 above 1/16).

#### 4.9.2 The new families

| Family | Multiplier | Where | Measured pressure |
|---|---|---|---|
| Moody | ×20 (USUM ×42) worlds per holder, at 28.2 | E2 always; calculator walks only with a 29 reader | the worst end-of-turn load ×20 = 0.59: no sample turn over |
| Forms (Zen Mode, Shields Down, Schooling) | ×2 at 29, E2 only | E2 | none |
| Cud Chew | none (Starf's ≤ ×4 in E2) | both | none |
| G-Max over time | none (deterministic) | both | none |
| Landing | ≤ 16 entries on the target's factor; ≤ 1 calculation per distinct target build (memoised) | both | end-of-turn entries ×16: 0 sample turns over |
| Field ends, Safeguard, switch-ins, recharge, Fake Out | none | both | none |
| Stall check | ×2 worlds per stalling action | both | as Protect's split today, which Training made outside the engine |
| SPEC2's spread-heal joint (C12) | the joint |attacker| × Π(|target| × 16) | moves | over 200 000 in one world on 4 of the 278 guarded Champions turns (1.44 %; 0.05 % of Champions turns); 19 above 20 000; SV 0 of 9 |

So no family of this file can push a sample turn into `Too many cases to follow.`; only constructed turns (several branching
families together on large worlds) reach it, and then the existing exact fallback is the answer. SPEC2's C12 is the one real
pressure point, inside its acceptance (risk 5: ≤ a tenth of 3.48 % of Champions turns).

#### 4.9.3 Decision and bound

- Keep the budgets as they are, and both texts. `engine-error` stays a class, not a guard: it is 0 in 10 000 turns.
- The bounds this file adds: the readers rule for Moody and the forms in the calculator's walks; the landing's per-value
  recording on discarded clones (no world growth); the prelude's 8 worlds; the stall check's two worlds. Nothing approximate.
- The measurement stays: probes-3 copies whatever `app/lib/battle` holds, so integration 1 and 2 re-run it next to SPEC2 §8.4
  step 4's census and report the same table; acceptance: no ready sample turn of today becomes `Too many cases to follow.`
  through this file's families, and C12 within SPEC2's risk 5.

---

## 5. UI (U; 2v2 only; facts-only labels, names never positions, 375 px)

| Control | Where, shown when | Writes | Data attribute |
|---|---|---|---|
| `Future Sight lands` (`—`, `Future Sight from {Name}`, `Doom Desire from {Name}` for each other Pokémon of the turn that learns it; under R also the bench) | CarriedFields, every Pokémon in a game with the move | `carried.futureMove` | `data-doubles-future-move` |
| `Cud Chew Berry` (`—`, the game's Berries) | CarriedFields, a Cud Chew holder | `carried.cudChew` | `data-doubles-cud-chew` |
| `Protects in a row` (`—`, 0–6) | CarriedFields, its move is a stalling move or Endure | `carried.stall` (`—` absent, k → 3^k, 0 → 1) | `data-doubles-stall` |
| `Recharging` (checkbox) | CarriedFields, its action is No move | `carried.mustRecharge` | `data-doubles-recharge` |
| `Not its first turn` (checkbox) | CarriedFields, its move is Fake Out or First Impression | `firstTurn: false` | `data-doubles-not-first-turn` |
| `Switched in` (an action, after `No move`) | the move select | `switchedIn: true`, action No move | `data-doubles-switched-in` |
| `Turns left` (1–8 terrain, 1–5 Gravity and Magic Room; `—`) | Field conditions, beside an active terrain, Gravity, Magic Room | `fieldTurns` | `data-doubles-terrain-turns`, `-gravity-turns`, `-magic-room-turns` |
| `Safeguard` (checkbox per side) | Field conditions | `SideConditions.safeguard` | `data-doubles-safeguard` |
| `G-Max Vine Lash`, `G-Max Wildfire`, `G-Max Cannonade`, `G-Max Volcalith` (checkboxes per side) | Field conditions, Sword/Shield | `SideConditions.gmaxResidual` | `data-doubles-gmax-residual` |

Residual lines (`doubles-format.ts residualLine`): `Future Sight`, `Doom Desire`, `Cud Chew`, `Moody`, `G-Max Wildfire` and kin,
`Zen Mode`, `Shields Down`, `Schooling` as effects with §4's facts; `Life Orb` on a landing's source. Card facts: `{Name}
switched in this turn and takes no action.`, `{Name} must recharge.`. The summary counts a control only when set.

The three Future Sight / Cud Chew controls are the inputs the guards need (USER-DECISIONS Q2's "any further earlier-turn
input"); the others make exact what an assumption fact states today (§9 asks whether to keep them).

---

## 6. Training (T)

- `sim/bridge.ts`: `futureMove` with its source (§4.1.2); `cudChew` from the tracker (§4.2.3); `stall` (§4.8.1);
  `mustRecharge` (§4.7.1); `firstTurn` with the real Fake Out or First Impression (§4.7.3); `switchedIn` (§4.7.4); `fieldTurns`
  (§4.6.2); `safeguard`, `mist`, `luckyChant` into the side conditions; Struggle passed. Rollout texts removed: `recharging
  while confused`, `struggle is not modelled`, `{move} after its first turn while confused`, `Payback into a Pokémon that
  switched in.`, `Analytic with a switch this turn.`, `Magic Room ending this turn is not modelled.`, `Side effect safeguard /
  mist / luckychant is not modelled.`; the FIRST_TURN_ONLY note and FIRST_IN_A_SWITCHED_SLOT.
- `sim/tracker.ts`: `PublicMon.cudChew` (§4.2.3).
- `sim/splits.ts`: the Protect fork and its Gravity rollout go; `splitWorlds` is the identity (kept for its callers and tests).
- `sim/prelude.ts`, `sim/services.ts`: `runPreludeWorlds` and the weighted mixture (§4.8.2).
- `ai/evaluate.ts`: nothing new for these entries (`postFromOutcome` takes the builds as they come; no weights, Q7).
- Gates: SPEC2 §6's. Expected movement: fewer rollouts (landings, Cud Chew, Moody, Magic Room ends, recharge, Struggle,
  failing Fake Outs, Payback and Analytic after a switch, ties), a changed value for switch-in sleepers (finding 1) and Mega
  ties (finding 2), each a correction.

---

## 7. Oracle harness (V)

- `case-types.ts`: `CaseCarried.futureMove: { move; source: SlotId } | { move; bench: CaseMon & { fainted?: true } }`;
  `cudChew: { berry }`; `stall`; `mustRecharge`; `CaseMon.firstTurn`; `CaseAction.switchIn`; `Case.fieldTurns`;
  `CaseSide.safeguard`, `gmaxResidual`.
- `sim-dfs.ts prepare()`: the landing as probes-1's `land()` (the bench source added to the team after the default Bench; a
  fainted one at 0 HP, `side.pokemonLeft` adjusted); `abilityState.berry` / `counter = 1`; the stall volatile (`counter`,
  `duration 1`); `addVolatile('mustrecharge')` with the recharge choice; `activeMoveActions = 1`; the switch-in placeholder;
  `pseudoWeather[x].duration`, `terrainState.duration`; `addSideCondition('safeguard')`, the G-Max side condition with its user.
- `compare.ts`: E2's `cudChew`; the landing's and Cud Chew's residual lines through today's residual comparison.
- `status2/build/changed-cases.ts` (SPEC2 §7.1) also lists the stored cases whose reasons this file removes: ER41d (Cud Chew:
  the case gains a Berry), ER41e (Future Sight: the case gains a source), ER41f (Moody: the fact becomes residual facts),
  ER41g-usum (Zen Mode: now estimated), ER41h-swsh (G-Max Wildfire: now estimated), and any stored case carrying
  `Assumes Magic Room does not end this turn.` (unchanged without `fieldTurns`).
- New file `cases-t2e.ts` (the T2E- and IN- cases of §4), wired into `cases-se.ts` as SPEC2's files are.

---

## 8. Ownership and order

| Who | Files | What (Tier 2 additions) |
|---|---|---|
| **Step 0c** (the Step 0 builder, after 0a/0b, before Step 1) | 0a's and 0b's files: `doubles-types.ts`, `types.ts`, `doubles-world.ts`, `doubles-turn.ts`, `doubles-status.ts` (the stallCheck call), `doubles-actions.ts`, `tests/source/status2-hooks.test.ts`, `tests/unit/status2-plumbing.test.ts` | §3 entire: the contract, `residualHit` and its `searchFor` / `conditionsFor` / `applyStep` options, `inEndOfTurn`, the switch-in queue and contexts, Struggle, the Cud Chew writer in `noteItemUse`, carried mapping and issues, turn facts, outcome fields, `landingPartners`; stubs for D's `stallCheck` |
| **D** (doubles-guards.ts) | its own | `beforeFirst`'s recharge; `stallCheck`; Fake Out and First Impression in its move Try hook; `tracksItems` with a Cud Chew holder |
| **E** (doubles-eot.ts, residuals.ts) | its own | §4.1.5, §4.2.2, §4.3.2, §4.4.2, §4.5.2, §4.6.2; RESIDUAL_KEYS `gmaxresidual`, `gravity`, `magicroom`, `terrain` (shared with SPEC2's room keys: one table); the REASONS removals of §3.4 |
| **T** | `app/(app)/training/**` | §6 |
| **U** | SPEC2's U files | §5 |
| **V** | `scripts/.cache/calc-audit/2v2/verify/**` (+ `cases-t2e.ts`) | §7 and every case of §4 |

Step 0c's gate is Step 0's (§8.1 of SPEC2): `npm run check`, golden-1v1 byte-equal, the 1264 stored cases at 0 differences
(facts included), the bench within 5 %; plus unit tests that set each new field on synthetic inputs and reproduce FS02,
FS03b, FS07c, TR01, TR03, TR06a, TR09, TR10a. The tracks then run in SPEC2's wave 1. Nothing here depends on wave 2 except the
landing's bench sources and the prelude's replacement (R-T).

Dependencies: E's landing needs Step 0c's `residualHit`; E's Cud Chew needs D's `tracksItems` and Step 0c's writer; E's Moody
and the copies need D's ledger (SPEC2); T needs the contract only (it builds inputs).

---

## 9. Risks, and what only the user can decide

**Riskiest points.**
1. `residualHit` reaches into the kernel's step (a new attacker-less path through `searchFor`, `conditionsFor`,
   `applyStep`). Mitigation: written in Step 0c, unreached until E calls it, its options keyed off and tested against
   FS02/FS03b/FS07c in Step 0c's unit tests; every reaction comes from the existing step code.
2. Showdown's landing has several non-obvious rules (Helping Hand counts, Life Orb without a hit, Shell Bell not, a fainted
   Mega reverts, Infiltrator only while active): each has a probe and a case; a rule missed would be a wrong number, so the
   T2E-FS cases cover every row of §4.1.3.
3. Cud Chew's counter must be written on every eat path (a missed path leaves a due Berry out). The writer sits in SPEC2's
   `noteItemUse`, which already has to reach every consumption path; the source test that every path calls it covers Cud Chew.
4. Training's numbers move where today's cells were silently wrong (findings 1, 2) and where rollouts become engine cells:
   conformance and the eval gates (SPEC2 §6), with the HabitBot gate reported beside main's.
5. The prelude enumeration multiplies preludes for tied cells; bounded at 8 and counted in the work budget.

**For the user** (each with a recommended default; nothing below blocks the build):
1. **Power Construct stays not estimated** (USUM, SwSh): modelling it needs a maximum HP that differs between outcomes on one
   card. Recommended: keep. Alternative: a per-outcome maximum in `DoublesHP` (a UI contract change) for one form of one
   restricted Pokémon.
2. **Calculator controls beyond the guards' needs**: `Protects in a row`, `Recharging`, `Not its first turn`, `Switched in`,
   field `Turns left`, `Safeguard`, the SwSh G-Max side conditions. Each replaces an assumption fact (or a silent absence) with an
   exact input. Recommended: include (all compact, shown only where read). Alternative: Training-only inputs, the facts stay in the
   calculator.
