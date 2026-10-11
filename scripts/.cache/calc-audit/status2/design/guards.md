# FAMILY 4: the narrow guards (status2 design)

Design only. Branch `calc-2v2-status-2` (main 4008ee8); no app code, test or doc changed. Ground truth: pinned Pokémon
Showdown c23d2e94. `PS/...` is `node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353/...`.
Line numbers in `doubles-turn.ts`, `doubles-status.ts`, `doubles-eot.ts`, `uses-to-ko.ts` and `calculate.ts` are at 4008ee8.

Files (all in `scripts/.cache/calc-audit/status2/design/`):
- `guards-sim.ts`: the probe harness (status-eot's exact enumeration, plus a bench of any size, mid-turn switch requests
  answered, forced or enumerated chance effects, an `inspect` hook).
- `guards-probes-1.ts` → `.out`: A (Opportunist, Mirror Herb), B (the switch-out family).
- `guards-probes-2.ts` → `.out`: C (Harvest, Pickup), D (Stored Power and kin), E (Fling), F (one-hit KO moves), G (spread
  heals), H (the Berserk lock), I (Trace), J (Ghost Curse), K (Heal Block in later steps), L (an attacker's Starf), M (White Herb).
- `guards-probes-3.ts` → `.out`: Big Root with Liquid Ooze, Focus Band, Glaive Rush, an ally's priority move, Round, Fling by a
  Sheer Force user (E9).
- `guards-q-catalog.ts` → `.out`: which species of each app catalog learn the moves and hold the abilities the cases need.
- `guards-probes-fling.ts` → `.out`: every catalog item's Fling data, Showdown against `@smogon/calc`.
- `guards-app-probes.ts` → `.out`: today's app engine against the 2v2 oracle (sim-dfs.ts) on eight cases (GA1–GA5b).

Probe ids (A1, GA5b…) are cited as `[A1]`.

---------------------------------------------------------------------------------------------------------------------------

## 0. Decisions (one page)

1. **Four correctness fixes come first; they are not guards** (§2). The app is silently wrong today in three of them:
   - **F1**: the pairwise step treats its target as a foe. It gives Defiant or Competitive a rise from an **ally's** drop. In
     [GA5b], Bulldoze into a Defiant Kingambit partner, then Kowtow Cleave: the app shows 175–207 damage and a 65 % knockout.
     Showdown deals 88–105 with no knockout. The step also copies its attacker's rise onto an ally Opportunist [GA3].
   - **F2 (Champions)**: a Sheer Force hit on a Berserk or Anger Shell holder locks its healing Berry.
     `PS/data/mods/champions/abilities.ts:2-13` drops the Sheer Force clause, and Sheer Force skips AfterMoveSecondary. The
     app eats the Berry at the hit's Update. [GA2]: knockout chance 1.95 % in Showdown, 0 in the app.
   - **F3, Trace copying a curing ability**: the census and FINAL.md are wrong about the engine. The settle replaces `abilityId`
     with the copied ability, so the cure works [GA1]. Only the text and the UI read the input's "trace". [GA1b] shows two
     contradictory facts: "Assumes Gardevoir lost no turns to sleep…" and "Insomnia: Gardevoir is cured…".
   - **F4 (Training)**: the bridge drops accuracy and evasion stages from earlier turns (`liveBuild`). Stored Power, Power Trip
     and Punishment are then silently wrong.
2. **Model every guard the user named, exactly, in all four games where it exists.**
   - Opportunist and Mirror Herb: a stage-event ledger with each copy's amounts, applied at the right time.
   - Harvest and Pickup: an item history plus a 1/2 or uniform branch.
   - Stored Power, Power Trip and Punishment: an engine correction counts positive accuracy and evasion stages.
   - Fling: a verified 1v1 fix (catalog fling data plus an engine correction), then the item's loss and its effect on the
     target in 2v2.
   - One-hit KO moves: a fixed-damage hit of the target's maximum HP in 2v2, with every immunity applied.
   - Spread heals: per-target drain in hit order. Shell Bell heals once from the summed damage. This is a new "dealt" output
     of the step.
   - Kept narrow: a flung Custap Berry with a later action of its target (one new text), and the existing budgets.
3. **The FINAL.md open list is modelled the same way**:
   - The Berserk lock: a status move or the holder's own self-targeting move resets it; it is carried to the next turn.
   - Psychic Noise before a later action: a heal-blocked attacker or target in every later step.
   - The attacker's own Starf Berry in a step: branched.
   - The Ghost-type Curse cost: a loss on the user's card.
   - White Herb at order 29 reading accuracy and evasion; the Lansat text; the Comatose order.
   - The perish projection: harness only.
   - Liquid Ooze against a heal-blocked seeder: the two holders' Speed decide [GA4].
4. **The switch-out family is the user's decision** (§5). The probes [B1–B13] settle what Showdown does.
   - **Option K**: keep the one reason. It costs nothing, but 7.0 % of Champions turns stay not estimated.
   - **Option R**: model the replacement.
     - A bench per side and a "Replacement" choice per Pokémon that can switch out.
     - Exact for the switch itself, the newcomer's hazards, its entry abilities and items, later moves into its position and
       the end of turn.
     - Narrow reasons stay where another family's enabler is missing: field re-settle, Neutralizing Gas, Imposter.
     - Cost XL.
   - **Option R0**: Option R for Training and E2 only; the calculator keeps the reason. Cost L.
   - **Recommended**: R0 first, then R's calculator UI as its own track.
5. **Inputs only the user can approve** (§11):
   - "Last move" for Disable and Encore. 2.85 % of Champions turns; no mechanics are missing.
   - "Berry eaten earlier" for a Harvest holder with no item.
   - Carried accuracy and evasion stages.
   - The replacement choice under Option R.

   Each gets a recommended default and states it as a fact.

---------------------------------------------------------------------------------------------------------------------------

## 1. What the probes settle, and where the census was wrong

| # | Finding | Probe |
|---|---|---|
| 1 | Opportunist copies only the positive parts of each boost() table, after ChangeBoost, the cap and TryBoost (`PS/sim/battle.ts:2032-2034, 2080`), summed over every rise of its foes, and applies them at the action's AfterMove before the next action | A1, A2, A6 |
| 2 | A Defiant rise is a foe's rise too (its own boost() has effect Defiant, not excluded) | A3 |
| 3 | In one hit, Breaking Swipe's −1 comes before Weakness Policy's +2/+2: the copy is +2 Atk +2 SpA, the stage difference +1 Atk +2 SpA, so the step must report its rises | A4 |
| 4 | Mirror Herb's copy goes through its holder's own boost(): Contrary turns +2 into −2; the Herb is used | A5 |
| 5 | An ally's rise is not copied (onFoeAfterBoost); the app's step copies Flame Charge's rise onto the user's ally Espathra (E2 shows Speed +1, Showdown none) | A7, GA3 |
| 6 | A copy is not copied back (effect named Opportunist / Mirror Herb) | A8 |
| 7 | Speed Boost (residual 28.2) is copied at residual 29 | A9 |
| 8 | A Berry's rise at the turn's first Update is copied at the first AfterMove (no Mega or Tera: the copier's own first move reads no copy) or at AfterMega before any move (Champions Mega) | A10, A10b |
| 9 | A rise at the final Update (a burn, then a Liechi Berry) is copied at the next turn's first AfterMove: a pending copy is carried | A11 |
| 10 | Two Eject Pack holders dropped by one Icy Wind **both** switch before the next action: the second Pack is used at the first newcomer's SwitchIn (`PS/data/items.ts:1721-1725`); the census said only the first switches. The Pokémon that just left may be the second one's replacement | B1 |
| 11 | A mid-turn Intimidate replacement drops the foes at once; the later foe move reads it | B2 |
| 12 | Stealth Rock hurts the newcomer at entry, mid-turn | B3 |
| 13 | Baton Pass passes accuracy and evasion stages too; Shed Tail passes its Substitute (its maker's quarter) | B4a, B4b |
| 14 | Roar and Red Card drag a uniformly random living bench Pokémon (`PS/sim/battle.ts:1570-1585`) | B5, B9 |
| 15 | Regenerator heals the leaver 1/3 on the way out (`PS/data/abilities.ts:3833`; `pokemon.heal`: Heal Block does not stop it) | B6 |
| 16 | From generation 8 the newcomer's Drought re-sorts the queue (a Chlorophyll partner moves earlier); USUM keeps the start order | B7 |
| 17 | Eject Button: the holder switches, the U-turn user stays | B8 |
| 18 | Emergency Exit's switch comes right after the damaging action; a later move aimed at it hits the newcomer | B10 |
| 19 | A Neutralizing Gas holder's U-turn ends the gas before it leaves: the foe's Intimidate drops the leaver and its partner | B13 |
| 20 | Harvest: in sun 1, otherwise (Cloud Nine in sun included: `field.isWeather`) 1/2; lastItem stays when it fails, so it tries again next turn; a flung Berry counts (Fling's volatile sets lastItem), a Bug-Bitten one does not | C1–C4 |
| 21 | Pickup: uniform over the other active Pokémon with lastItem and usedItemThisTurn; a knocked-off item and its own item are not candidates; a Lum eaten at the turn's first Update is | C5–C8 |
| 22 | Stored Power and Power Trip count accuracy and evasion stages (positiveBoosts sums stage values); **Punishment exists only in USUM** (Past in SV, SwSh, Champions), capped at 200 | D |
| 23 | Fling: the held item's own damage effects apply to its damage (Life Orb ×1.3 with no recoil, Black Glasses ×1.2, Choice Band ×1.5 at 10 power); the item goes at the hit's Update; Symbiosis then passes the partner's item at once | E1, E6 |
| 24 | A flung Berry is eaten by the target through singleEvent Eat: a foe's Unnerve does not stop it | E2 |
| 25 | A flung White Herb clears the target's lowered stages; a Mental Herb ends its Taunt; Flame Orb, Toxic Orb, Light Ball, Poison Barb give their status and King's Rock, Razor Fang a flinch as 100 % secondaries (Shield Dust and a Substitute stop them, the item is still used) | E3, E4, E4b, E7 |
| 26 | Fling fails with no item, with Klutz, under Magic Room | E5, E5b |
| 26b | A Sheer Force user's Fling still gives the item's status and gets no Sheer Force boost: the secondary is added in onPrepareHit, after Sheer Force's onModifyMove | E9 |
| 27 | `@smogon/calc`'s getFlingPower differs from Showdown for 31 SV, 87 Champions, 46 SwSh and 80 USUM catalog items (mostly 0 where Showdown has 30–90: every Mega Stone 80, Memories 50, Drives 70; SwSh's TR24 and kin 120 vs 85; Flower Sweet fails in Showdown) | fling |
| 28 | One-hit KO moves: damage = maxhp (any HP); immune: Sheer Cold into an Ice type, a higher level, Dynamax (`[ohko]`), Sturdy, Levitate, Air Balloon, a Ghost type, Wonder Guard; Focus Sash and Endure leave 1 HP (the Sitrus then eaten); a Substitute takes it and ends; Disguise takes it (chip 1/8); all four games, Champions included | F1–F15 |
| 29 | Spread drain: each target's heal right after its damage, in hit order; Liquid Ooze's damage there; Big Root per heal; Liquid Ooze deals the raw amount (not Big Root's); a knocked-out target's drain is from its HP; Parabolic Charge drains from the user's ally too | G1–G8 |
| 30 | A Rowap Berry's damage comes after both drains (DamagingHit), before the Update | G3 |
| 31 | Shell Bell on a spread move: one heal of trunc(totalDamage / 8); damage into a Substitute does not count | G4, G4b |
| 32 | A heal-blocked Pokémon's drain move is stopped at BeforeMove (it has the heal flag): drain under Heal Block never happens; Shell Bell, an HP Berry, Volt Absorb's heal and an ally's Pollen Puff onto it fail | G5, K1–K5 |
| 33 | Leech Seed from a heal-blocked seeder into Liquid Ooze: the faster holder's handler runs first (Ooze faster: the seeder takes the drain as damage; slower: nothing) | GA4a, GA4b |
| 34 | The Berserk lock: a later single hit eats the Berry at that action's end, a multi-hit move between its hits, a status move reaching it at its Update; the lock lasts through the end of turn into the next turn; in SV a Sheer Force hit resets it at onDamage, in Champions it **creates** one; the holder's own Splash (No move) resets it | H1–H6b, GA2, GA2b |
| 35 | Trace's copied Limber cures at the turn's first Update (the app already does) | I1, GA1 |
| 36 | A Ghost type's Curse at under half HP faints its user | J1 |
| 37 | An attacker's own Starf Berry after its recoil: +2 to one of the five stats below +6, uniform | L1 |
| 38 | White Herb at order 29 restores accuracy and evasion drops (made under a Magic Room that ended at 27.6) | M1 |
| 39 | Focus Band: 1/10 per knockout hit, multi-hit per hit (two hits: 1/100) | O1, O1b |
| 40 | Glaive Rush doubles later damage to its user (27 → 54) | Q1 |
| 41 | Psychic Terrain and Armor Tail do not stop an ally's priority move | R1 |
| 42 | Round: a second Round user moves right after the first, at 2x | N1 |

---------------------------------------------------------------------------------------------------------------------------

## 2. Correctness fixes (first, each its own commit; no guard involved)

### F1. The pairwise step's foe-only reactions on an ally target

- **Showdown.** Defiant and Competitive act only on a foe's drop: `PS/data/abilities.ts:901-918` (defiant onAfterEachBoost:
  `if (!source || target.isAlly(source)) return`) and `:645` (competitive). Opportunist and Mirror Herb copy only a foe's rise
  (onFoeAfterBoost, `:3042`, `PS/data/items.ts:4152`). The other boost guards act against any other Pokémon (Clear Body,
  Big Pecks, Mirror Armor: `if (source && target === source) return`), so they stay as they are.
- **App today.** In `uses-to-ko.ts:4668-4697`, boost()'s `byFoe` means "from the other battler of the step". Line 4689 raises
  Defiant and Competitive for any `byFoe` drop. Lines 4691-4696 copy the attacker's rise onto the target's Opportunist or
  Mirror Herb whatever the sides are. The 2v2 step calls it with the attacker's own partner as the target: Bulldoze,
  Earthquake, Parabolic Charge, Surf, Discharge, Lava Plume, Boomburst, or any single-target move aimed at the ally. [GA5],
  [GA5b], [GA3].
- **Fix.**
  - `UsesEnv` (prepareUses' turn options, `doubles-turn.ts:594`) gains `allies?: true`, set when
    `!isFoe(attacker, target) && attacker !== target`.
  - With `m.allies`, boost() skips line 4689 and lines 4691-4696.
  - `searchFor`'s memo key (`:585`) gains it.
  - 1v1 never sets it, so golden-1v1 stays byte-equal.
  - The kernel already checks the side for its own Defiant (`doubles-status.ts:2316`, `isFoe`) and for hiddenDrop
    (`doubles-turn.ts:2140`).
- **Cases.**
  - G4-ALY-01-sv: GA5b, Bulldoze into the Defiant partner, then Kowtow Cleave.
  - G4-ALY-02-swsh: Bulldoze into a Competitive Milotic partner, then its Scald.
  - G4-ALY-03-champions: Aerodactyl's Bulldoze into a Defiant Kingambit partner, then its Kowtow Cleave. Bulldoze
    learners and Defiant holders are from `guards-q-catalog.out`.
  - G4-ALY-04-sv: GA3 with E2, the ally's stages.
- **Test.** `tests/unit/doubles-guards-ally.test.ts`: the Defiant partner keeps +0 Attack, and the ally Espathra keeps +0 Speed
  (E2 build).

### F2. Champions: a Sheer Force hit locks a Berserk or Anger Shell holder's Berry

- **Showdown.**
  - `PS/data/mods/champions/abilities.ts:2-13`: onDamage sets `checked = !(effectType === "Move" && !multihit)`, with no
    Sheer Force clause.
  - `PS/sim/battle-actions.ts:811-816`: a Sheer Force move with secondaries skips AfterMoveSecondary, so nothing resets the
    lock.
  - The healing Berry (Sitrus, Oran, the Figy family; `hit-loop.ts:26` BERSERK_BERRIES) stays held until a reset. A reset is
    one of:
    - a later move that reaches the holder (its AfterMoveSecondary);
    - a non-move damage;
    - a multi-hit's damage;
    - the holder's own self-targeting move [GA2b].
  - [H6] (Champions) against [H6b] (SV, eaten at the hit's Update).
- **App today.** The pairwise step reads the Berry as eaten at the hit's Update. [GA2]: Drampa (Berserk, Sitrus Berry) takes
  Feraligatr's Sheer Force Crunch, then Snorlax's Body Slam. The app gives KO 0 and average 47.94; Showdown gives KO 0.0195,
  average 47.21, and +1 Sp. Atk in 43.75 %.
- **Fix.** The lock design of §4.8, with a new lock source:
  - a Champions damaging hit whose attacker has Sheer Force and whose move has secondaries;
  - on a holder of a healing Berry (`fromSide`'s target build has the Berry still held and the ability Berserk or Anger
    Shell);
  - the step reads the Berry as Leftovers, as `psychicNoiseKeepsBerry` does (`doubles-turn.ts:2381`);
  - after the step, `MoveVolatiles.berryLocked` is set.
  - SV, SwSh and USUM keep the Sheer Force clause, so their step stays as it is.
- **Cases.** G4-SFL-01-champions (GA2), G4-SFL-02-champions (GA2b, matches today), G4-SFL-03-sv (the same hit in SV: no lock).
  Two games are in each pair.

### F3. Trace's copied curing ability: the facts and the UI

- **Engine.** Already exact [GA1]: calculate.ts settleAbilities (`:472-484`) writes the copied ability into `abilityId`, so
  `ownCuresAtStart` (`doubles-status.ts:190-206`) cures. FINAL.md's "not cured in the engine" is wrong.
- **Text.** `doubles-status.ts:turnFacts` (`:648-667`) reads `entry.build.abilityId` ("trace"), so a Trace holder that copied
  Insomnia or Vital Spirit gets "Assumes {Name} lost no turns to sleep before this one." next to the cure fact [GA1b].
  - **Fix**: read `effective = build.abilityId === "trace" ? build.tracedAbility ?? (settle's copy) : build.abilityId`.
  - Take the settle's copy from `settleOf(input).slots[slot].build.abilityId`. The kernel passes it; turnFacts gains the
    settle argument.
- **UI.** The FIX-ui F1/F2 controls for "what the ability cures" (BattleConditions' carried sleep and freeze fields) hide the
  counters for an own-cure ability. They must read the same effective ability: `PokemonPanel.tsx:199` already exposes
  "Ability Trace copied".
- **Cases.** G4-TRC-01-sv (GA1b's facts), G4-TRC-02-usum (Trace copying Limber, paralysed, moves).

### F4. Training: accuracy and evasion stages from earlier turns

- **Today.** `bridge.ts:83` liveBuild maps `boosts` atk..spe only. A Pokémon carrying +1 evasion (Double Team, a Baton Pass
  [B4a], a Minimize) into a turn where it, or its Punishment target, uses Stored Power or Power Trip is estimated with the
  wrong power.
- **Fix.**
  - `DoublesCarried.stages?: { accuracy?: number; evasion?: number }` (−6..6).
  - The bridge fills it from the belief battle's `boosts.accuracy` and `boosts.evasion`. They are public: `-boost` and
    `-unboost` lines.
  - carriedState (`doubles-turn.ts:861`) writes `vol.stages`.
  - It joins the hidden-stage model (§4.4).
- **Interim** (if §4.4 lands later): the bridge adds the rollout reason
  `{Name}: an accuracy or evasion stage from an earlier turn is not modelled.` when a slot's move is Stored Power or Power Trip
  and it carries one, or its Punishment target does.

---------------------------------------------------------------------------------------------------------------------------

## 3. Shared state and enablers (contract deltas)

Every field is immutable as MoveVolatiles' are (replace, never mutate; `cloneMon` copies shallowly). Each new World field joins
`cloneWorld` and `discreteKey` (`doubles-world.ts:328-341, 449-453`) so worlds that differ in it never merge.

### 3.1 Stage events with amounts (stageEvents)

- **State.**
  - `World.boosted` (`doubles-world.ts:189`) becomes
    `Partial<Record<DoublesSlotId, { rose?: Partial<Record<Stage, number>>; fell?: true; reset?: true }>>`.
  - `rose` is the sum of the positive parts of every boost() table that reached the Pokémon in the action: after
    ChangeBoost, the cap and TryBoost, with accuracy and evasion included.
  - Its truthiness keeps today's readers.
- **Writers.**
  - `doubles-status.ts:2290-2291` applyBoosts adds `boost`'s positive parts.
  - The pairwise step reports its own: `TurnStepOutcome` gains `rises: { att: StageChanges; def: StageChanges }`, the summed
    `raised` maps of every boost() call in the step (`uses-to-ko.ts:4673-4688`), in turnMode only.
  - applyStep (`doubles-turn.ts:2062-2075`) adds them to the signature (`:2063`) and writes them into `next.boosted` for the
    attacker and the target.
  - This removes eventGuards' stage-difference inference for rises (`:1144`), which [A4] shows is wrong.
- **Readers.** Opportunist and Mirror Herb (§4.1). Eject Pack (§5) keeps `fell`.

### 3.2 Pending copies (Opportunist, Mirror Herb)

- **State.**
  - `MonState.copy?: { stages: StageChanges; by: "opportunist" | "mirrorherb" }`: the copier's effectState.boosts
    (`PS/data/abilities.ts:3044-3051`, `PS/data/items.ts:4154-4162`).
  - `DoublesCarried.copy?: StageChanges`: a copy pending from the last turn's final Update [A11].
  - `DoublesOutcomeMon.pendingCopy?: StageChanges` (E2).
- **Application points** (each the pinned handler):
  - the end of each action, in runMove before eventGuards (onAnyAfterMove);
  - the turn's start when a Pokémon Terastallizes or Mega Evolves this turn (onAnyAfterTerastallization, onAnyAfterMega;
    §4.1);
  - residual order 29 (onResidual);
  - a newcomer's SwitchIn under Option R (onAnySwitchIn priority −3).

### 3.3 Item history (itemHistory; shared with family 3's Recycle and Bestow)

- **State.**
  - `MonState.lastItem?: string`: pokemon.lastItem. It is set by eatItem and useItem (`PS/sim/pokemon.ts:1800, 1841`) and by
    Fling's volatile (`PS/data/moves.ts:5777`), never by takeItem (Knock Off, Thief, Bug Bite's steal, Trick: `:1851-1865`).
  - `MonState.usedItem?: true`: usedItemThisTurn, reset at the turn's end (`PS/sim/battle.ts:1677`), so a fresh world has none.
  - `DoublesCarried.lastItem?: string`: an item used on an earlier turn (Harvest's Berry, Recycle's item).
  - `DoublesOutcomeMon.lastItem?: string`.
- **Writers** (kernel):
  - ateBerry (`doubles-turn.ts:1687`), berryDue's cure branch (`:1775`), turnStartUpdate (`doubles-status.ts:175`);
  - cureConfusionBerry (`:545`), giveStatus' Berry (`:2205`);
  - White Herb (`doubles-status.ts:2327`, `doubles-eot.ts:983`), Mental Herb, Eject Pack and Eject Button, Red Card,
    Mirror Herb (§4.1);
  - Booster Energy and the Seeds (the settle's `entry.seed`, calculate.ts:3302), Focus Sash, a Gem, Fling (§4.5);
  - not the Air Balloon. Popped, it is set to "" directly with no lastItem and no usedItemThisTurn, but AfterUseItem runs, so
    Unburden and Symbiosis act (`PS/data/items.ts:197-211`);
  - in the step: applyStep sets `lastItem` and `usedItem` where `before.receiver.itemId` or `before.user.itemId` went to "" by
    use, not by `stolenInStep` or Knock Off. The step outcome gains `used: { att?: string; def?: string }` (its "consumed"
    paths, `uses-to-ko.ts` eaten / attackerAte / Gem / Sash / resist Berry).
  - doubles-eot.ts loseItem (`:886`) gains the item it used.
- **Readers.** Harvest (§4.2), Pickup (§4.3), Recycle (family 3), Symbiosis (§6).

### 3.4 Heal Block in later steps (healBlockSteps; shared with family 2's Heal Block move)

`UsesEnv.healBlocked?: { attacker?: true; target?: true }`, from `eot.healBlock` of each side, in searchFor's key. In the
pairwise search (turnMode only):
- the attacker's Shell Bell heals nothing;
- its own HP Berries are not eaten;
- the target's HP Berries are not eaten (it keeps the Berry);
- Cheek Pouch heals nothing.

The drain needs no case: a heal-blocked user cannot use a draining move [G5]. The kernel paths:
- absorbEffect (`doubles-turn.ts:1586-1609`): the heal part does nothing, and the fact becomes
  `{Ability}: no damage; {Name} cannot heal.`;
- afterLoss and berryDue (`:1655, 1769`): no HP Berry while `eot.healBlock`;
- pouchHeal (`:1176`): no heal under Heal Block;
- `doubles-status.ts` singleHit for Pollen Puff onto a heal-blocked ally fails as Showdown's `cant` [K5]:
  `Heal Block: Pollen Puff cannot be used.`

### 3.5 A spread move's dealt damage (followAttacker for spreads)

- `turnStep(entries, mode, follow, part, opts?: { dealt: true })`: each outcome gains
  `dealt: Map<number /*target HP after*/, Map<number /*dealt*/, number /*mass*/>>`.
- `dealt` is the damage the hit took from the target before any heal: the Damage event's result, so Sturdy, a Sash and Endure
  are already applied.
- The kernel calls it with one target HP per entry (point masses), so the joint (HP before, dealt, HP after) is exact.
- It exists only for single-hit moves. No spread move hits more than once (`PS/sim/battle-actions.ts:1009` comment), and
  Dragon Darts' smart targets are separate steps.

### 3.6 Hidden stages read by the calculations

- `MoveContext.hiddenStages?: number`: the positive accuracy and evasion stages of the Pokémon the move reads (the user's for
  Stored Power and Power Trip, the target's for Punishment).
- It is set only by contextFor in 2v2 (§4.4) and read by an engine correction.

### 3.7 The Berserk lock (generalised)

- `MoveVolatiles.berryLocked` keeps its meaning: the healing Berry's TryEatItem fails.
- New sources: F2.
- New resets: §4.8.
- `DoublesCarried.berryLocked?: true`.
- `DoublesOutcomeMon.berryLocked?: true`.

### 3.8 The replacement (Option R only): §5.4.

---------------------------------------------------------------------------------------------------------------------------

## 4. The guards, one by one

Every section names the pinned behaviour, the state, the hooks (with today's lines), randomness, the end of turn, E2 and
Training, the UI facts, the reasons that stay, cases (prefix `G4-`, ids `G4-<topic>-<n>-<game>`) and tests. "Removed" names a
guard call site that goes.

### 4.1 Opportunist and Mirror Herb copying a rise (copiesRise)

**Showdown** `PS/data/abilities.ts:3041-3082`, `PS/data/items.ts:4146-4190` [A1–A11]:
- At every boost() of a foe, the copier's handler adds the positive amounts. Copies are skipped (effect Opportunist or Mirror
  Herb).
- At AfterMove of any action (the user's move; a status move's too), at AfterMega, AfterTerastallization, any SwitchIn
  (priority −3) and residual order 29, it boosts itself with the sum and clears it:
  - Opportunist: `this.boost(boosts, holder)` with effect Opportunist (the copier's Contrary and Simple act; a foe's Clear
    Amulet does not, since the boost is its own);
  - Mirror Herb: `useItem()` (needs its item to work: Klutz, Magic Room, Embargo stop it), then onUse boosts.
- Mirror Herb exists only in SV (Champions Past: `PS/data/mods/champions/items.ts:646`).
- Opportunist exists in SV and Champions (Espathra).

**Model.**
- **Accumulate.** After each boost() event (§3.1), for each living foe F of the boosted Pokémon P: if F's ability is
  Opportunist (not suppressed: gas stand-in, Core Enforcer) or F holds a working Mirror Herb, add the positive amounts of
  the event to `F.copy`. The event's effect must not be a copy.
  - applyBoosts gets `opts.copied`, set when it applies a copy.
  - In a turn (UsesEnv.turn) the step never copies: boost()'s copy branch (`uses-to-ko.ts:4691-4696`) runs only outside
    turnMode. The kernel copies instead, so the step's `rises` are never copies.
  - In 1v1 the step still copies in-step: the copier is the foe, and the copy applies after the move's damage, so 1v1 is
    unchanged.
- **Apply at the action's end.** New `doubles-status.ts` hook `afterMoveCopies(kernel, w)`, called from runMove
  (`doubles-turn.ts:1074-1081`) for each out world before eventGuards:
  - every Pokémon with `copy`, in AfterMove handler order: Speed, ties as worlds at 1/k! (none matters unless an Eject Pack
    or Symbiosis reads it; commute rule as `doubles-eot.ts:284`);
  - Opportunist: applyBoosts(self, stages, self, { effect: "ability", by: "Opportunist", copied: true });
  - Mirror Herb: lastItem "mirrorherb", usedItem, no item; Unburden then applyBoosts(…, { effect: "item", by: "Mirror Herb",
    copied: true }); Symbiosis (§6);
  - then delete `copy`.
  - The facts on the action's step: `Opportunist: {Name} copies +2 Attack.` / `Mirror Herb: {Name} copies +2 Attack.`
    (one per copier, each stage as stageFact writes it; a capped copy as "+1 Attack."; a copy that changes nothing:
    "Mirror Herb: {Name}'s stats cannot go higher." The Herb is still used).
- **The turn's start.**
  - settleDoublesStart (`calculate.ts:3291-3297`) records `copy` for each foe copier of a slot whose start Berry raised a
    stat (`items.raised`, after boost()), instead of failing.
  - It waits for the first action's end [A10]. A Terastallization or Mega Evolution this turn would apply it before the
    moves (AfterTerastallization, AfterMega [A10b]).
  - The turn input does not say either happens this turn: a build with mechanic "tera", or a Mega form, may have changed on
    an earlier turn, and BattleMechanic has no Mega. So the turn assumes neither does. Where a start copy exists and a Tera
    build or a Mega form is present, the turn fact is `Assumes no Pokémon Terastallizes or Mega Evolves this turn.`
  - Training: the prelude already ran Mega Evolution and Terastallization in Showdown (`sim/prelude.ts`), so the clone's
    stages are exact. A copy still pending there (no Mega, no Tera) goes in as `DoublesCarried.copy`, read from the clone's
    `abilityState.boosts` or `itemState.boosts` (the belief world's own replay of public `-boost` lines).
- **Residual 29.** doubles-eot.ts collect (`:444-506`) adds a handler for each copier with `copy`, which applies it:
  RESIDUAL_KEYS.opportunist exists (residuals.ts:79, order 29); Mirror Herb gets a key at order 29 beside whiteherb and
  ejectpack. afterChecks' copy guard (`:1029-1036`) goes.
- **After the final Update.** A Berry rise there [A11] stays in `copy` → `DoublesOutcomeMon.pendingCopy`, carried by
  Training's postFromOutcome into the next turn's `carried.copy`. The calculator's result shows the condition fact
  `Opportunist: copies +1 Attack next turn.` (DoublesHP.conditions).
- **Removed.** eventGuards' copier check (`doubles-turn.ts:1147-1154`), afterChecks (`doubles-eot.ts:1029-1036`), settle
  (`calculate.ts:3292-3296`).
- **Interactions.**
  - Family 1's stat moves (Psych Up, Heart Swap, Topsy-Turvy, Power Swap…) use setBoost or swaps with no boost event, so
    there is nothing to copy. Family 1 states it per move; Acupressure is a boost() event.
  - Family 1's ability changes: a copier whose ability is replaced loses its `copy` (onEnd deletes it, `:3080`); one that
    gains Opportunist starts with none.
  - Eject Pack in the same AfterMove: its switch comes after the copies (§5).
- **Randomness.** None beyond the existing ties.
- **Reasons that stay.** REASONS.copiesRise goes from every current site. One narrow use is kept: a copier whose foe's rise
  happened in a step that also failed to report its rises (none known). Kept as a defensive throw in afterMoveCopies when
  `rises` is missing.
- **Cases.**
  - G4-OPP-01-sv: Shell Smash [A1].
  - G4-OPP-02-sv: Howl, summed [A2].
  - G4-OPP-03-sv: Icy Wind and a foe's Defiant [A3].
  - G4-OPP-04-sv: Breaking Swipe and Weakness Policy [A4].
  - G4-OPP-05-sv: Mirror Herb with Contrary [A5].
  - G4-OPP-06-sv: capped [A6].
  - G4-OPP-07-sv: a start Liechi, Espathra's Stored Power first [A10].
  - No oracle case Mega Evolves on the turn with a start copy pending. The app assumes no Mega Evolution there (its fact),
    and the oracle's Mega would apply the copy before the moves [A10b]. A10b stays the probe that backs the fact.
  - G4-OPP-09-champions: Speed Boost copied at 29 [A9].
  - G4-OPP-10-sv: carried copy, E2 [A11].
  - G4-OPP-11-sv: two Espathra, no copy back [A8].
- **Tests.** `tests/unit/doubles-guards-copies.test.ts`: amounts, timing (before the next action), the copier's own move
  reading none at the start, residual 29, the pending copy in E2.

### 4.2 Harvest

**Showdown** `PS/data/abilities.ts:1800-1816` [C1–C4, P6]:
- Order 28 subOrder 2.
- Holder with HP and no item, `lastItem` a Berry.
- In sun or Desolate Land (field.isWeather: Cloud Nine or Air Lock suppress it [C2]; Utility Umbrella does not, since it is
  the field's weather) the Berry comes back for certain; otherwise with 1/2.
- setItem then `lastItem = ""`. The final Update (`PS/sim/battle.ts:2860`) eats it if due.
- A failed 1/2 keeps lastItem, so it tries again next turn [C4].

**Model.**
- **Handler.** doubles-eot.ts harvestGuard (`:802-806`) becomes `harvestHandler` at RESIDUAL_KEYS.harvest (exists):
  - if `alive`, no item, and `lastItem` (§3.3: a Berry eaten this turn, or `carried.lastItem` for one from an earlier turn)
    is a Berry;
  - the chance is 1 when `w.field.weather` is Sun or Harsh Sunshine and no living Cloud Nine or Air Lock holder, else two
    worlds at 1/2;
  - in the restoring world: `build.itemId = lastItem`, lastItem "";
  - the recorder fact `Harvest: {Berry} back.` (DoublesResidual effect "Harvest", chance, no HP);
  - the final Update (updateAll) eats it, as today.
- **Removed.** worldGuard's Harvest line (`doubles-eot.ts:218`) and harvestGuard.
- **Inputs.**
  - The calculator: a Harvest holder with no item at the turn's start can have eaten a Berry before the turn. New control
    under the holder's carried state: `Berry eaten earlier` (a Berry of the catalog, or none). Default none, with the turn
    fact `Assumes {Name} ate no Berry before this turn.` only when Harvest holds no item.
  - Training: from the tracker. The last `-enditem|…|[eat]` or `[from] move: Fling` of the Pokémon since it came in,
    unless a later `-item` (Harvest, Recycle, Pickup, Trick) or another used item replaced it: all public.
- **E2.** `DoublesOutcomeMon.lastItem` (a failed Harvest leaves it for the next turn); the restored Berry is in `build.itemId`.
- **Interactions.**
  - Cud Chew (`PS/data/abilities.ts:742`) also re-eats; the existing landing guard stays where Cud Chew is carried.
  - Family 3's Recycle shares lastItem.
  - Pickup (§4.3) clears the source's lastItem when it takes an item.
- **Budget.** At most one 1/2 split per holder per turn.
- **Cases.**
  - G4-HRV-01-sv: C1, not in sun.
  - G4-HRV-02-usum: sun, eaten again.
  - G4-HRV-03-swsh: sun under Cloud Nine, 1/2.
  - G4-HRV-04-sv: a flung Berry in sun [C3a].
  - G4-HRV-05-sv: carried lastItem.
  - G4-HRV-06-champions: Trevenant's Harvest after a Sitrus Berry, not in sun. Champions has Arboliva and Trevenant with
    Harvest (`guards-q-catalog.out`).
  - The oracle's `CHANCE_EFFECTS` already has `harvest` (status-sim) but compare.ts's does not (FINAL.md); compare.ts's set
    gains it.
- **Tests.** The 1/2 branch and its mass, sun certain, the Berry eaten at the final Update, the carried lastItem.

### 4.3 Pickup

**Showdown** `PS/data/abilities.ts:3262-3281` [C5–C8, P7]:
- Order 28.2.
- With no item: candidates are the other active Pokémon (`isAdjacent`; in doubles every other one) with `lastItem` and
  `usedItemThisTurn`.
- `sample` (uniform); take the candidate's lastItem, which is cleared.
- setItem; the final Update can use it (a Berry due).

**Model.**
- **Handler.** pickupGuard (`doubles-eot.ts:813-819`) becomes `pickupHandler`:
  - candidates from §3.3 (`usedItem && lastItem`, the holder excluded);
  - one world per candidate at 1/k;
  - setItem through doubles-items.ts's receive path (the item's Start: a Seed in its terrain, Room Service, Booster Energy;
    today's received guards stay narrow).
  - Recorder: `Pickup: picks up {Item}.` with `other` = the candidate.
- **Removed.** worldGuard's Pickup lines (`doubles-eot.ts:219-221`), pickupGuard.
- **Exactness note.** Candidates and non-candidates:
  - A Pokémon that used an item at the turn's first Update (a Lum Berry) is a candidate [C7].
  - So is one whose item the moves used: Sitrus, Gems, Focus Sash, Weakness Policy, White Herb, Eject Button and Eject
    Pack, Booster Energy.
  - A popped Air Balloon is not (§3.3).
  - A knocked-off or stolen item is not [C6].
- **Training.** Every input is this turn's (no carried state).
- **Cases.**
  - G4-PKP-01-sv: two candidates [C5].
  - G4-PKP-02-sv: Knock Off [C6].
  - G4-PKP-03-usum: Lum at the first Update [C7].
  - G4-PKP-04-swsh: its own item, not a candidate [C8].
  - G4-PKP-05-champions: Dedenne's Pickup after a foe's Sitrus Berry (Champions has Dedenne, Diggersby and Gourgeist with
    Pickup).

### 4.4 Stored Power, Power Trip, Punishment after an accuracy or evasion stage (hiddenStages)

**Showdown.**
- `PS/data/moves.ts:18111` storedpower, `:13852` powertrip: 20 + 20 × positiveBoosts of the user.
- `:14325` punishment: min(200, 60 + 20 × the target's).
- positiveBoosts sums every positive stage, accuracy and evasion included (`PS/sim/pokemon.ts:1201-1208`) [D, P8].
- Punishment exists only in USUM [D].
- `@smogon/calc` (`gen789.js:580-583, 607-610`; `champions.js:354, 380`) counts countBoosts over atk..spe.

**Model.**
- contextFor (`doubles-turn.ts:1500-1522`): for storedpower and powertrip (not transformed), `context.hiddenStages` = Σ of
  the user's positive `vol.stages`; for punishment, the target's.
- calculateTurnMove (calculate.ts) wraps the engine call in a new engine correction `withExtraBoosts(n, run)`
  (engine-corrections.cjs, the getMoveEffectiveness pattern, `:120-140`). It patches `util.countBoosts` at call time to add
  `n` for the one call inside the move's base power.
- 1v1 never sets it.
- The Z-Move and Max Move have their own power (unchanged).
- **Removed.** hiddenStageGuard (`doubles-turn.ts:552-557`) and its call (`:570`).
- **Carried stages.** F4's `DoublesCarried.stages` feeds `vol.stages` at the start. The calculator gets two optional numbers
  per Pokémon, `Accuracy stage` and `Evasion stage` (−6 to +6, default 0). Shown in its carried state when any of its own or
  its foes' moves is Stored Power, Power Trip or Punishment, or when the user opens them. Training fills them (F4).
- **E2.** `DoublesOutcomeMon.stages?: { accuracy?, evasion? }`, so the next turn's Stored Power reads them.
- **Cases.**
  - G4-STP-01-sv: Double Team, then Stored Power (Espathra).
  - G4-STP-02-champions: Speed Boost and Minimize-free evasion from a Baton Pass carried stage.
  - G4-STP-03-usum: Punishment into a +2 evasion target.
  - G4-STP-04-swsh: Power Trip with carried +1 accuracy.
- **Tests.** The power over the matrix of [D].

### 4.5 Fling

Fling is a verified 1v1 fix first. The golden-1v1 rows change only with that verification. Then come the 2v2 effects.

**Showdown** `PS/data/moves.ts:5734-5787` [E1–E8]:
- Base power 0.
- onPrepareHit fails on any of:
  - ignoringItem(true): not active, Embargo, Magic Room, Klutz from generation 5;
  - the item's TakeItem fails: a Mega Stone held by its own user, Z-Crystals, Memories and Drives for their users, plates for
    Arceus, the Rusted items, the Masks for Ogerpon, Booster Energy on a Paradox, Griseous Core, the Origin orbs;
  - no `fling` data (Poké Balls, Normal Gem, Z-Crystals, Flower Sweet…).
- Then `basePower = item.fling.basePower`.
- A Berry: onHit makes the target eat it (singleEvent Eat, then EatItem: no TryEatItem, so Unnerve does not stop it [E2]; Heal
  Block stops the heal itself, through TryHeal). The user's Cud Chew counts the Berry.
- `fling.effect`: White Herb, Mental Herb [E3].
- Else `fling.status` or `fling.volatileStatus` as a 100 % secondary [E4]: Shield Dust, Covert Cloak and a Substitute stop it
  [E4b, E7].
- The item stays held through the damage: its own damage effects apply [E1].
- The volatile `fling` removes it at the next Update (the hit's) and sets lastItem and usedItemThisTurn. AfterUseItem runs:
  Unburden activates, Symbiosis passes [E6]. A Life Orb's recoil and a Shell Bell's heal never run (no item by then).

**1v1 (calculate.ts; the verified fix).**
1. **Catalog data.** Every game's catalog item gains `fling?: { basePower: number; status?: string; volatileStatus?: string;
   effect?: "whiteherb" | "mentalherb" }`, from pinned Showdown's mod for that game (the generator that builds the catalogs;
   [fling] lists the differences). Berries are the target eating it.
2. **Power.** Engine correction `withFlingPower(power, run)` patches `items_1.getFlingPower` at call time (the champions and
   gen789 mechanics read it through the module object: `champions.js:410`, `gen789.js:656`).
3. **Failure rows.** These conditions give a "status"-kind row with the fact:
   - `Fling fails: {Name} has no item.`
   - `Fling fails: {Item} cannot be flung.`
   - `Fling fails: {Name} has Klutz.`
   - `Fling fails under Magic Room.`
   - Embargo is family 2's (the volatile).
4. **The held item stays.** For the damage the item keeps all its effects (Life Orb's ×1.3 boost); no Life Orb recoil, no
   Shell Bell heal, no Metronome count after (`uses-to-ko.ts` per-use item effects read Fling as having thrown it).
5. **Uses to KO.** The second use fails (`uses-to-ko.ts:230` already says "Fling throws its item away").
6. **The target's effect.** Row facts (assumptions), each as text:
   - `{Item}: {Target} eats it.` (Sitrus, Oran, the Figy family: its heal, the confusion rule; a pinch Berry's rise: these act
     on later uses);
   - `{Item}: {Target} is burned.`, `… is badly poisoned.`, `… is poisoned.`, `… is paralysed.`;
   - `{Item}: {Target} flinches if it has not moved.`;
   - `White Herb: {Target}'s lowered stats are restored.`;
   - `Mental Herb: {Target}'s Taunt, Encore, Disable, Torment, Heal Block and attraction end.`
   - Fling's second use fails, so Uses to KO is the first use alone. A status it gave counts in that use's end of turn as
     any 100 % secondary's status does.
7. **The sweep (verification).** u-oracle (`scripts/.cache/calc-audit/bugbite/verify/u-oracle.ts`) over:
   - every catalog item with fling data or a failure;
   - × 2 attackers (one physical-boosting item user, one with Klutz-free Unburden);
   - × 2 defenders (one with a resist Berry, one Shield Dust);
   - × the four games.

   It compares rolls, KO chances and Uses to KO. golden-1v1's Fling rows move from "Fling is not verified…" to calculated.
   The changed rows are listed by id in the fix's report: the only allowed golden changes.

**2v2 (doubles-turn.ts).**
- damagingMove, before resolveTargets (`:1805`): the failure check (same rules, the world's item and field) gives the step fact
  `Fling fails: …` and no target.
- After the step (afterHit, `:2304`, new `flingAfter` in doubles-items.ts, Track E's owner):
  - **The user.** lastItem = item, usedItem; no item; Unburden (`abilityActive`); Symbiosis.
  - **The target, when a hit landed** (`outcome.landed > 0`; a Substitute in front stops all of it [E7]):
    - a Berry: ateBerry's effects run on the target through a new `eatFlung` kernel helper. Sitrus / Oran / the Figy
      family heal (none under Heal Block), with the Figy confusion; the curing Berries cure; Lum cures confusion too; the
      pinch Berries raise through applyBoosts (Opportunist copies); Lansat sets settledFocusEnergy; Starf branches over
      the open stats (§4.13); Kee and Maranga raise; the rest change nothing. The target's lastItem is **not** set (it
      did not hold it). Its Cud Chew sets `eot.cudChew` for the next turn. Unnerve does not stop it.
    - status: giveStatus(target, status, attacker) behind Shield Dust and Covert Cloak.
      - Not Sheer Force: Fling's secondaries are added in onPrepareHit, after Sheer Force's onModifyMove, so a Sheer Force
        user still gives the status, and its Fling gets no Sheer Force boost [E9: 17 damage and a burn with Sheer Force,
        the same with Poison Point].
      - So secondaryLands' Sheer Force clause (`doubles-turn.ts:2368`) must not apply to Fling.
    - flinch: flinchCheck (`:2395`) with FLINCH set from the item.
    - White Herb: the target's lowered stages to 0, accuracy and evasion too.
    - Mental Herb: the moves-phase volatiles taunt, encore, disabled end; eot.healBlock ends.
  - Pickup and Harvest read the lastItem (§4.2, §4.3).
- **Randomness.** None; a Starf through the target eats branches.
- **Reasons.** The row reason disappears in 2v2. A flung Custap Berry (its onEat gives the target's next move first in its
  bracket) is the one narrow reason: `Custap Berry flung at {Name} is not modelled in 2v2.`, with a later action of that
  target.
- **E2.** Builds without the item, lastItem, the target's status and Berry.
- **Cases.**
  - G4-FLG-01-sv: Life Orb.
  - G4-FLG-02-sv: Sitrus onto the ally past Unnerve [E2].
  - G4-FLG-03-sv: White Herb.
  - G4-FLG-04-sv: Flame Orb into Shield Dust.
  - G4-FLG-05-champions: Iron Ball with Unburden Sneasler, Speed doubled for its next turn (E2).
  - G4-FLG-06-champions: Light Ball paralysis.
  - G4-FLG-07-swsh: King's Rock flinch on a slower target.
  - G4-FLG-08-usum: a Z-Crystal fails.
  - G4-FLG-09-sv: Symbiosis passes the partner's item [E6].
  - G4-FLG-10-sv: into a Substitute [E7].
- **Tests.** The failure rules, the power table against the catalog, the target effects.

### 4.6 One-hit KO moves (Fissure, Guillotine, Horn Drill, Sheer Cold)

**Showdown** [F1–F15]:
- `PS/sim/battle-actions.ts:696-708`: the accuracy step makes the target immune (`-immune [ohko]`) if:
  - it is Dynamaxed;
  - its level is above the user's;
  - Sheer Cold hits an Ice type (generation 7+).
- Accuracy itself is 30 + level gap (20 + gap for a non-Ice user of Sheer Cold). The turn's hit rule sets that aside:
  "Every move hits".
- A semi-invulnerable target keeps the miss (the semi-invulnerable guard).
- The hit steps run in this order (`PS/sim/battle-actions.ts:556-577`):
  1. invulnerability;
  2. TryHit: protection, Sturdy's TryHit (`PS/data/abilities.ts:4673-4679`; breakable), Wonder Guard (neutral is blocked
     [F11]);
  3. the type immunity: Fissure into Flying, Levitate, Air Balloon, Magnet Rise; Guillotine and Horn Drill into Ghost unless
     Scrappy, Mind's Eye or Foresight; Ring Target removes it;
  4. TryImmunity;
  5. the accuracy step with its `[ohko]` immunities above.
- The kernel keeps that order, so the first that applies gives the fact.
- Damage `target.maxhp` (`:1606`, gen 4+) with no modifier.
- The Damage event: Focus Sash at full HP leaves 1 [F7], Endure leaves 1 [F8] (then an HP Berry at the Update), Focus Band
  1/10 [O1], False Swipe-like none.
- A Substitute takes it and breaks [F9].
- Disguise takes it, then the busted form and the 1/8 chip [F10].
- All four games, Champions included.

**Model** (2v2 only; 1v1 keeps "One-hit KO move: no damage range."):
- **ohkoStep.** singleStep (`doubles-turn.ts:1949`) and spreadStep (OHKO moves are single-target) call `ohkoStep` before
  searchFor when `info.effective.ohko` (the catalog's flag) and not transformed:
  1. (after hitChecks' protection, as today) Sturdy and Wonder Guard, then the type immunity, computed by the kernel. calculate.ts returns the OHKO row before any calculation (`:1789`), so no row
     says it.
     - The used type follows statusType's rule (`doubles-status.ts:721-729`): Normalize; the -ate abilities turn a Normal
       Guillotine or Horn Drill into Flying, Fairy, Ice, Electric or Dragon, so a Ghost type is then hit.
     - Ground (Fissure): `grounded(w, target)` false is immune. Ring Target and family 2's Telekinesis and grounding
       states apply through grounded() and a Ring Target check. Earth Eater and the other absorbers are hitChecks' already
       (`doubles-turn.ts:1576-1580`).
     - Normal into a Ghost type is immune unless the user has Scrappy or Mind's Eye, or the target is identified
       (family 2's Foresight and Odor Sleuth).
     - The fact is `{Name} is immune to {Move}.`
  2. the `[ohko]` immunities (Dynamax `isMaxActive`, level from `build.native.level` / 50 in Champions, Sheer Cold vs Ice
     with typesOf): hit fact `{Name} is immune to {Move}.`
  3. (checked in step 1, before the type immunity) Sturdy (not broken), and Wonder Guard: not super effective by the
     runtime's type chart for the used type, against the target's types (typesOf). Fact: `{Ability}: {Name} is immune.`
  4. Substitute (substituteHooks: the HP goes to the Substitute: `taken = sub HP`, broke).
  5. Disguise: faceHit with the busted form and chip.
  6. otherwise a fixed loss `maxHP` through a new kernel `fixedHit(w, action, target, amount)`:
     - Focus Sash at full HP leaves 1;
     - Endure leaves 1 (`endureFor`);
     - Focus Band leaves 1 with 1/10 (§6);
     - else 0, and it faints;
     - at 1 HP, the Update's Berry (berryDue).
  7. The hit's reactions run as any landed hit: afterHit, hitReactions (a Rocky Helmet on the target, a Red Card), koBoost,
     Destiny Bond.
- **Hit fact.** `{Move}: a one-hit KO move; it deals {Name}'s full HP.` The DoublesHit is "calculated" with min = max =
  maxHP. Its row is a fixed row built as uses-to-ko's fixedRow does (`uses-to-ko.ts:1206-1214`): min = max = rolls = maxHP,
  the move's name, type and category.
- **Removed.** rowReason's path for this row (the 1v1 row's reason no longer reaches 2v2).
- **Cases.**
  - G4-OHK-01-sv: Sheer Cold at partial HP.
  - G4-OHK-02-sv: into Glalie (immune).
  - G4-OHK-03-champions: Vanilluxe's Sheer Cold.
  - G4-OHK-04-swsh: into a Dynamaxed target.
  - G4-OHK-05-usum: Guillotine.
  - G4-OHK-06-sv: Sash.
  - G4-OHK-07-sv: Endure and Sitrus.
  - G4-OHK-08-sv: Substitute.
  - G4-OHK-09-sv: Disguise.
  - G4-OHK-10-swsh: Fissure into an Air Balloon.
  - G4-OHK-11-sv: Wonder Guard.
- **Tests.** Each immunity and survivor.

### 4.7 Spread heals: Matcha Gotcha, Parabolic Charge, Shell Bell (spreadHeal)

**Showdown** [G1–G8, P1]:
- In spreadDamage (`PS/sim/battle.ts:2090-2186`), per target in hit order: its damage, then (gen 5+)
  `heal(round(damage × drain), source, target, 'drain')`. The damage is the target's actual loss, capped at its HP [G6].
- The heal:
  - runs TryHeal: Liquid Ooze first deals the **raw** amount to the user and heals 0 [G8]; Big Root ×5324/4096 on each heal
    on its own [G2]; Heal Block cannot occur [G5];
  - is capped at the maximum (none at full HP; Liquid Ooze acts at full HP too).
- After spreadDamage: DamagingHit per target (Rough Skin, Rocky Helmet, Jaboca, Rowap: the attacker's damage) [G3], then the
  hit's Update (`PS/sim/battle-actions.ts:1003`: the user's HP Berry once), then AfterMoveSecondarySelf: Life Orb, and Shell
  Bell `heal(totalDamage / 8)` once (trunc, at least 1; damage into a Substitute excluded [G4]).
- Champions: Sinistcha's Matcha Gotcha is 3.48 % of sampled turns, the largest single reason.

**Model.** spreadStep (`doubles-turn.ts:2447-2566`) gains a followed path when the move drains or the user has a working
Shell Bell. It replaces the guard at `:2454`.
1. **Plans** as today (`:2494-2509`), each target's search created with `follow = false` and called with `{ dealt: true }`
   (§3.5).
2. **Composition** in hit order (`plans`), on the world's joined factor of [attacker, each landed target]:
   - for each joint entry and each target's step outcome entry (t_before → (dealt, t_after) with mass);
   - the attacker's HP after the drains: x ← for each target in order:
     - with Liquid Ooze (not breakable: flags {}; Neutralizing Gas suppresses it as a stand-in): x − round(dealt × ratio), at
       least 0;
     - else min(max, x + bigRoot?(round(dealt × ratio))), skipped at 0 HP or 0 dealt;
   - Σ dealt over targets not behind a Substitute for Shell Bell.
   - This is a convolution: |x| × Π|t_i| × outcome masses, within the entry budget. It is the same joint-table machinery as
     applyStep's (`:2026-2075`), extended to two targets.
3. **Then**, as today: the targets' retaliation summed (`:2559`), Mind Blown none here, then the Update; Life Orb
   (`:2556`); then Shell Bell trunc(Σ/8) at least 1 (none at full, none under Heal Block). These run through afterLoss with a
   heal step: afterLoss gains signed groups (`(number | number[])[]` with negative numbers as heals, capped). Its tag keeps
   the Berry eaten.
4. **The attacker's own HP Berry** is read once at the Update after the retaliation (as today), never between the drains.
5. **Spread effects.** The other per-target differences of the attacker's state (§6 spread-effect) still go through
   `world.spread`.

- **Facts.** The heals list gets `Drain: +a–b HP.` and `Shell Bell: +a–b HP.` (noteHeal; today's names for single steps).
  Liquid Ooze's loss is a step fact `Liquid Ooze: {Name} loses a–b HP.` (the existing text of the single-target path).
- **Removed.** REASONS.spreadHeal and `:2454`.
- **Cases.**
  - G4-SPH-01-champions: Matcha Gotcha into two foes, Sinistcha at 50 %.
  - G4-SPH-02-sv: one Liquid Ooze target first [G1].
  - G4-SPH-03-sv: second [G1b].
  - G4-SPH-04-sv: Big Root [G2].
  - G4-SPH-05-sv: a Rowap Berry and the user's Sitrus [G3].
  - G4-SPH-06-swsh: Shell Bell Rock Slide, one Substitute [G4].
  - G4-SPH-07-usum: Parabolic Charge with the ally [G7].
  - G4-SPH-08-champions: a knockout target [G6].
  - G4-SPH-09-champions: Matcha Gotcha at full HP (no heal).
- **Tests.** Order sensitivity with caps (a target pair whose order changes the result), Big Root rounding, Shell Bell's sum.

### 4.8 The Berserk / Anger Shell lock (berryLocked), carried

**Showdown.**
- `PS/data/abilities.ts:414-444`, `:143-173`; Champions `PS/data/mods/champions/abilities.ts:2-13`.
- **Locked.** A damage whose effect is a Move, not multi-hit, not (outside Champions) a Sheer Force move with secondaries. The
  confusion self-hit is one; in Champions any Sheer Force hit (F2).
- **Reset** (checked true):
  - any other damage: residuals, recoil, Life Orb, Rocky Helmet;
  - a multi-hit's damage (between its hits [H2]);
  - AfterMoveSecondary of any move that reaches the holder: damaging or status; its own self-targeting move or Splash
    [GA2b]; not a Sheer Force move [H5 in SV resets at onDamage instead].
- The Berry is eaten at the Update after the reset [H1, H3].
- The state lives in effectState and lasts into the next turn [H4b].

**Model.**
1. **A later hit in a step** (`lockedBerryGuard`, `doubles-turn.ts:1713-1720`, called at `:2018`). The step runs with the
   held healing Berry read as Leftovers: a searchFor `opts.locked` stand-in for the target, as `opts.healBlocked` is.
   - **A single-hit move.** This covers any move but a Champions Sheer Force one; Sheer Force outside Champions resets at
     onDamage [H5].
     - The lock clears after the step, and berryDue eats the Berry at the action's Update: the runMove end, before
       afterMoveCopies.
     - Showdown eats it either at that hit's Update (Sheer Force outside Champions) or at the action's end (any other move,
       after AfterMoveSecondary [H1]).
     - Nothing changes the target's HP or stages between those two points of one move, so both give the HP and stages the
       stand-in path gives.
     - Berserk's and Anger Shell's AfterMoveSecondary rise reads the HP before the Berry, as the pairwise step's Anger Shell
       rule already does (`uses-to-ko.ts:2683-2686`).
   - **A multi-hit move.** No stand-in. The lock clears at the first hit's onDamage, and the step eats the Berry at that
     hit's Update, between hits [H2], as for any holder. The holder may be at or under its line before the first hit; the
     critic checks that uses-to-ko does not eat it before the first hit.
   - **A Champions Sheer Force hit.** The stand-in, and the lock stays (F2).
2. **A status move reaching it** (`doubles-status.ts:1338-1340`): the lock clears in hitOne's effects and berryDue runs at
   the use's Update (updateAll, `:1992`). This includes the holder's own self-targeting status move and No move (a Splash:
   beforeMove's `go` worlds for a null move run berryDue on its user when locked).
3. **Residual damage** (`doubles-eot.ts:400-416` unlock): unchanged.
4. **Carried.**
   - `DoublesCarried.berryLocked`: Training reads the belief battle's `abilityState.checkedBerserk === false` /
     `checkedAngerShell === false`. The belief world replays only public events; the lock follows public lines: a confusion
     self-hit, or a Champions Sheer Force hit, with no later move reaching it.
   - The calculator: a checkbox `Berry locked (Berserk)` in the holder's carried state, shown for a Berserk or Anger Shell
     holder of a healing Berry. Default off: no fact, since nothing is assumed.
   - E2 `DoublesOutcomeMon.berryLocked` after the turn (no reset).
- **Removed.** REASONS.berryLocked's two call sites.
- **Kept narrow.** The verifier's chain (FINAL.md): the lock with a foe's Unnerve ending in the same action. Here berryDue at
  the Update reads `berryStopped`, so it is modelled too; the reason can be deleted.
- **Cases.**
  - G4-BZK-01-sv: H1.
  - G4-BZK-02-sv: H2.
  - G4-BZK-03-sv: H3.
  - G4-BZK-04-sv: carried, H4b's turn 2 as its own turn with `carried.berryLocked`.
  - G4-BZK-05-champions: Drampa with a Sheer Force hit, then a later Body Slam (GA2).
  - G4-BZK-06-champions: the holder's own No move (GA2b).
  - G4-BZK-07-usum: Berserk Drampa (USUM has Drampa) with a confusion self-hit and a later status move.

### 4.9 Trace's copied curing ability: F3 (§2).

### 4.10 The Ghost-type Curse user's KO chance

- **Showdown.** `PS/data/moves.ts:3266` curse onHit `directDamage(maxhp / 2)` to the user [J1].
- **Model.** The curse handler (`doubles-status.ts:1740-1746`) records the cost as a loss (`kernel.lossFact(user, "{Name} loses
  {n} HP (Curse).", mass)`, DoublesHP.losses) instead of a step fact. cost's afterLoss already faints it through
  `kernel.faint` without `byHit`, so the slot is in otherFaints and its card's KO chance includes it (hpRecords `:3469`).
  compare.ts's status-hit reach (no hit on the user) is unchanged.
- **Case.** G4-CRS-01-sv: J1. G4-CRS-02-champions: Mimikyu Curse at 40 %.

### 4.11 Psychic Noise before a later action

- **Showdown.** The healblock condition (`PS/data/moves.ts:8274-8343`) [K1–K5, G5]:
  - a heal-flag move is stopped at BeforeMove (the existing healBlockCheck);
  - TryHeal false for drain (moot), Shell Bell [K4], HP Berries (onTryEatItem's TryHeal) [K2], the absorbing abilities' heal
    (still immune [K3]), Cheek Pouch, an ally's Pollen Puff [K5];
  - Leftovers, Grassy Terrain, Aqua Ring, Ingrain, Leech Seed's gain at the end of turn (modelled).
- **Model.** healBlockSteps (§3.4). volatileGuard (`doubles-turn.ts:2424-2435`) drops psychicnoise from its list (VOLATILE_
  SECONDARY_MOVES keeps coreenforcer, burningjealousy, alluringvoice, spectralthief, §6).
- **Training.** A Heal Block from an earlier turn: `DoublesCarried.healBlock?: true` (the turn after Psychic Noise:
  duration 2, its `-start` public). It sets `eot.healBlock` at the start, and bridge.ts maps the healblock volatile (today a
  rollout).
- **Cases.**
  - G4-HBK-01-sv: K2.
  - G4-HBK-02-champions: Farigiraf's Psychic Noise, then a foe's later Sitrus-holder hit.
  - G4-HBK-03-sv: K3.
  - G4-HBK-04-sv: K4.
  - G4-HBK-05-champions: K5.
  - G4-HBK-06-sv: carried healBlock (E2 → next turn).

### 4.12 The perish projection (oracle harness)

compare.ts, for E2 with the end of turn not estimated: each outcome Pokémon's `perishCount` against the oracle's after-the-
moves volatile duration − 1 (`outcomeMon` already projects it, `doubles-eot.ts:1227`). A case G4-PER-01-sv: Perish Song
with an L move last (end not estimated).

### 4.13 Starf Berry: the attacker's in a step, and at the turn's start

- **Showdown.** `PS/data/items.ts:5985` starfberry: `sample` over the five stats below +6, +2 (Ripen +4) [L1].
- **Model.**
  - **In the step.** uses-to-ko.ts attackerAte and ateStolen (`:3822, :3835`) stop the search (STARF_REASON). In turnMode
    they instead mark the outcome `starf: "att"`, with the eaten Berry recorded and no stage. applyStep then branches the
    child world over the open stats at 1/k through ateBerry's existing Starf branch (`doubles-turn.ts:1696-1704`).
    1v1 keeps its reason.
  - **At the start.** settleDoublesStart's STARF_REASON (`calculate.ts:3290`) becomes the root worlds' branch (rootWorlds
    `doubles-turn.ts:893`): the folded build without the stage, a world per stat. The 1v1 starfOutcomes logic
    (`calculate.ts:2689`) gives the list.
  - E2's Starf at an end-of-turn Update (`doubles-eot.ts:924`): the same branch (the E2 guard goes).
- **Cases.** G4-STF-01-sv (L1), G4-STF-02-usum (a Starf at the start), G4-STF-03-swsh (Bug Bite eating a Starf),
  G4-STF-04-sv (E2 at the end of turn).

### 4.14 White Herb at order 29 and the end-of-turn Lansat

- **White Herb.** doubles-eot.ts whiteHerb (`:977-986`) also restores `vol.stages` below 0 [M1]. Its condition reads them.
- **Lansat.** updateSlot (`:942`) sets `settledFocusEnergy` (as ateBerry does, `doubles-turn.ts:1695`), not `focusEnergy`
  (the move's), so the fact names the Berry.
- **Case.** G4-WHR-01-sv: M1. G4-WHR-02-swsh: the same.

### 4.15 canStatus's Comatose order

doubles-status.ts canStatus (`:2116-2127`): the type immunity before Comatose (sim/pokemon.ts setStatus' runStatusImmunity
first). Text only; no case changes numbers.

### 4.16 Liquid Ooze into a heal-blocked seeder (end of turn)

- **Showdown.** One TryHeal with two handlers: the seeder's Heal Block onTryHeal and the seeded's Liquid Ooze onSourceTryHeal.
  The holders' Speed (updateSpeed at the residual) orders them [GA4a: Ooze faster, the seeder loses 19; GA4b: slower, nothing].
- **Model.** leechSeedHandler (`doubles-eot.ts:659`, the guard at `:668`) compares `speeds[seeded]` and `speeds[gainer]`.
  The faster runs first; a tie gives two worlds at 1/2.
- **Cases.** G4-LOZ-01-sv (GA4a), G4-LOZ-02-sv (GA4b), G4-LOZ-03-usum (a tie).

---------------------------------------------------------------------------------------------------------------------------

## 5. The switch-out family ("{Name} switches out: the replacement is not known.")

### 5.1 What pinned Showdown does

Probes B1–B13 and census-probes P2, P4, P9.

**Triggers and who picks.**
- The player picks (a switch request mid-turn, `PS/sim/battle.ts:2876-2914`): U-turn, Volt Switch, Flip Turn, Parting Shot
  (after a drop or Mirror Armor), Teleport (gen 8+), Baton Pass, Shed Tail, Chilly Reception, Eject Button (`:1680`), Eject
  Pack (`:1705`), Emergency Exit and Wimp Out.
- Random over the side's living bench (dragIn, `PS/sim/battle-actions.ts:162-174`): Roar, Whirlwind, Dragon Tail, Circle
  Throw, Red Card [B5, B9].

**When.**
- After the action. Eject Button and Red Card after the hit's AfterMoveSecondary.
- Eject Pack at the next AfterMove or SwitchIn: two Packs from one move both go, the second at the first newcomer's
  SwitchIn [B1].
- Emergency Exit after the damaging action [B10].

**Leaving.**
- The leaver's queued action is cancelled.
- Its switch-out effects:
  - Regenerator's 1/3 [B6];
  - Natural Cure;
  - Zero to Hero's form;
  - its Neutralizing Gas or Unnerve ends: the gas ends **before** it leaves, so a suppressed Intimidate drops the leaver and
    its partner [B13].
- Its volatiles go: Baton Pass copies stages (accuracy and evasion included) and passable volatiles [B4a]; Shed Tail its
  Substitute [B4b].

**Entering** (`PS/sim/battle-actions.ts:62-191` switchIn, runSwitch):
- hazards: Stealth Rock [B3], Spikes, Toxic Spikes, Sticky Web; Heavy-Duty Boots;
- the switch-in abilities and items by Speed: Intimidate [B2], weather and terrain setters [B11], Neutralizing Gas, Unnerve,
  Trace, Imposter, Download, Air Lock, Hospitality, Costar, Commander, Supersweet Syrup, Zero to Hero, Booster Energy, the
  Seeds, Air Balloon;
- a pending Healing Wish or Lunar Dance;
- the foes' pending Opportunist copy and Eject Pack (onAnySwitchIn).

**Later this turn.**
- The newcomer has no action.
- Every later move aimed at that position meets it, spread moves included [B10, B11].
- From generation 8 the queue is re-sorted: the newcomer's weather moves a Chlorophyll partner [B7]. USUM keeps the order.
- No switch happens with no Pokémon left (`battle.ts:2884-2892`, the existing canSwitch).

### 5.2 Option K: keep the reason

- **Cost.** None.
- **Effect.** The reason stays on 7.0 % of sampled Champions turns: 4.2 % the turn, 2.8 % the end of turn. On the SV proxy it
  is 7.75 % + 1.50 %. Training falls back to rollouts there: 7.4–10.9 % of its cells for every reason together.
- Every other §4 design works unchanged under K. Eject Pack's drop still feeds `World.leaving` (§3.1's `fell`).

### 5.3 Option R0: the replacement for Training and E2 only

- The engine half of R (§5.4).
- Training's bridge supplies the bench and the choice.
- The calculator passes no bench, so `REASONS.switchesOut` stays there whenever a switch happens with a later action or
  before the end of turn.
- **Cost L.** Engine (one track) + bridge (half a track) + oracle extension.

### 5.4 Option R: model the replacement

**Contract** (doubles-types.ts):

```ts
/** A Pokémon on a side's bench (not in play): its build and state from earlier turns, under an id the caller keeps. */
export type DoublesBenchPokemon = { id: string; build: BattleBuild; carried?: Pick<DoublesCarried, "toxic" | "sleep" | "freeze"> };
export type DoublesTurnInput = {
  // …
  /** Each side's living bench. Absent: unknown (a switch with a later action is not estimated, as today). */
  bench?: Partial<Record<DoublesSideId, readonly DoublesBenchPokemon[]>>;
  /**
   * The Pokémon that comes in for a slot whose own player picks a replacement mid-turn (U-turn, Eject Button...): a bench id.
   * Absent with a bench: the first bench Pokémon not already in (a turn fact). Random drags (Roar, Dragon Tail, Red Card) read none.
   */
  replacement?: Partial<Record<DoublesSlotId, string>>;
  /** Hazards on each side (Stealth Rock, Spikes layers, Toxic Spikes layers, Sticky Web). Absent: none. */
  hazards?: Partial<Record<DoublesSideId, { stealthRock?: true; spikes?: 1 | 2 | 3; toxicSpikes?: 1 | 2; stickyWeb?: true }>>;
};
/** A slot whose Pokémon left during the turn (DoublesTurnResult.replaced; E2 lists the leavers in DoublesOutcome.benched). */
export type DoublesReplaced = { left: { id: string | null; hp: DoublesHP | { hp: number; chance: number }[] }; entered: { id: string; chance: number }[] };
```

- `bench` takes `canSwitch`'s place where given: `canSwitch[side] = bench.length > 0`.
- `canSwitch` stays for callers without a bench.
- `hazards` is new for the calculator. Training has them: `bridge.ts` IGNORED_SIDE spikes and kin become mapped.

**World** (doubles-world.ts):
- `MonState.id`: the Pokémon's id (a slot's starting Pokémon: `slot:<slot>`; a newcomer: its bench id).
- `World.benched?: Partial<Record<DoublesSideId, { id: string; build: BattleBuild; hp: Map<number, number>; eot… }[]>>`: the
  leavers with their HP marginal at leaving. That is exact for E2's per-Pokémon marginals; the joint with the others no
  longer matters this turn.
- `World.bench` (ids still on the bench).
- The slot's factor digit is reused by the newcomer (a point factor at its HP, split from the joint).
- `mons[slot]` is replaced; `occupant` and `positionOf` stay positional.
- `discreteKey` adds `benched` and the ids.
- The budgets grow by the bench size for random drags.

**The replacement point** (one kernel function `replaceSlot(w, slot, how: "chosen" | "random")`). It replaces every
switchesOut throw and `leaving()` call:
- `doubles-turn.ts:1167-1168` (eventGuards: Eject Pack, Emergency Exit, Wimp Out);
- `:2239-2246` (hitReactions: Eject Button, Red Card);
- `:2322-2334` (afterHit: U-turn and kin, Dragon Tail, Circle Throw);
- `doubles-status.ts:1912-1919` (switchOut: Parting Shot, Baton Pass, Shed Tail, Teleport, Chilly Reception, Roar,
  Whirlwind);
- `doubles-eot.ts:989-997` (order 29 Eject Pack: the switch after the turn, which E2 reports as a replacement before the
  next turn) and the Emergency Exit fact (`:1041-1045`).

Each call does:
1. The leaver's queued action is removed from `remaining`.
2. Its switch-out effects:
   - Regenerator: HP + floor(baseMax/3) via mapHP, Heal Block ignored [B6];
   - Natural Cure: status "";
   - Zero to Hero: the form change for its next entry, E2;
   - the gas or Unnerve end through gasEnds and unnerveEnds. A suppressed Intimidate then starts: the abilityChange enabler
     (family 1). Until it exists that stays `REASONS.gasEnds`.
3. Baton Pass copies stages, `vol.stages`, confusion, Substitute, Leech Seed, Ingrain, Aqua Ring, Curse, Perish, Focus
   Energy, Magnet Rise, Power Trick (PS/data/conditions.ts and moves.ts `noCopy` flags); Shed Tail the Substitute.
4. The newcomer: chosen = `input.replacement[slot]` (validated: a bench id not in play; the Pokémon that left this turn is
   allowed [B1]); random = one world per living bench Pokémon at 1/k.
5. Its MonState: build settled for entry (below), `moved: true` (no action), HP factor at its HP.
6. **The entry pipeline**, in Showdown's order:
   - hazards (Stealth Rock by typeEffectiveness of Rock, 1/8 × 2^…; Spikes 1/8, 1/6, 1/4 when grounded; Toxic Spikes
     poison or bad poison when grounded, absorbed by a grounded Poison type; Sticky Web −1 Speed through foeDrop from the
     web's side, so Defiant, Mirror Armor, Eject Pack; Heavy-Duty Boots; Magic Guard for the damage), each through afterLoss
     (HP Berries) and faint;
   - then the switch-in abilities and items in Speed order, through the existing settle rules for one Pokémon in the current
     world. A new `settleEntrant(world, slot)` in calculate.ts reuses settleAbilities and settleItems with the world's other
     three as "the others":
     - Intimidate: foeDrop on each foe with its reactions;
     - Download: from the foes' current stages;
     - Trace: random if two copyable foe abilities differ, one world each, uniform;
     - weather and terrain setters: World.field, weatherSet, then the field re-settle (`fieldGuard` today);
     - Hospitality; Costar; Curious Medicine; Supersweet Syrup; Air Lock;
     - Unnerve: berry readers already read the world;
     - Air Balloon; the Seeds; Booster Energy;
     - Protosynthesis and Quark Drive with the field;
     - Intrepid Sword and Dauntless Shield, once per battle: an "already used" bench field, default unused, a fact;
     - Embody Aspect;
     - Wind Rider under Tailwind;
     - Screen Cleaner;
     - Commander, Imposter and Neutralizing Gas: narrow reasons until family 1's enablers exist (below);
   - then the foes' onAnySwitchIn: pending copies (§4.1), a pending Eject Pack (chains to another replaceSlot [B1]).
7. The result statistics: the step that caused it gets `{Leaver} switches out; {Newcomer} comes in.` (random:
   `{Move}: {Newcomer} is dragged in.` with its chance).

**Exact, with a chosen replacement.**
- the switch itself, the newcomer's hazards, every entry effect the turn-start settle already models;
- later moves aimed at that position (resolveTargets reads `occupant` and `mons`) and spread moves;
- the re-sort (topGroup reads speeds each step; gen 7 frozen);
- the newcomer's end of turn (its residuals);
- Regenerator.

**Narrow reasons that stay** (new exact texts):
- `{Name} comes in under Neutralizing Gas or ends it: not modelled in 2v2.`: until family 1's abilityChange covers the gas.
- `Imposter is not modelled in 2v2.` (as today): family 1's Transform.
- `A weather or terrain change this turn would change {Name}.` (REASONS.fieldChange, as today): the newcomer's setter with a
  field-settled holder in.
- `Commander is not modelled in 2v2.`
- With no Pokémon left to come in there is no switch, as today (canSwitch), so no reason is needed there.

**Results.**
- `DoublesTurnResult.replaced?: Partial<Record<DoublesSlotId, DoublesReplaced>>`: the slot's starting Pokémon's HP when it
  left (+Regenerator), each newcomer with its chance.
- `hp[slot]` stays the starting Pokémon's.
- New `hpEntered?: Partial<Record<DoublesSlotId, Record<string, DoublesHP>>>` for the newcomers after the moves and the end of
  turn.
- E2: `DoublesOutcome.mons[slot]` is the occupant at the end with `id`, and `DoublesOutcome.benched` lists the leavers'
  DoublesOutcomeMon with ids.

**Calculator UI** (2v2 only):
- **Bench.** Per side, "Bench" in Field conditions: up to four Pokémon from the slot's roster source (the drafted team or
  PokéPaste the slot came from: roster-prep's source). Each with its build editor collapsed and HP; the default list is the
  roster's other members, in roster order, alive.
- **Replacement.** Per Pokémon that can switch out by its player's choice this turn (its move is a switch move; it holds an
  Eject Button or Eject Pack; it has Emergency Exit or Wimp Out), a select `Replacement` listing the bench by name. Default:
  the first, with the turn fact `Assumes {Newcomer} comes in for {Name}.`
- **Hazards.** Per side: Stealth Rock, Spikes (0–3), Toxic Spikes (0–2), Sticky Web, in Field conditions.
- **Result.** The slot's card shows the leaver's line, `{Name} switches out at {hp} HP.`, then the newcomer's card below it.

**Training.**
- Bench: the AI's own bench exactly (team, HP, status).
- The player's bench: the belief world's (its members' sampled sets; HP and status public).
- The chosen replacement:
  - the AI's: `ReplacePolicy` (rollout.ts:15-41), the same as the rollouts use, applied to the engine world's candidates;
  - the player's: the rollouts' healthiest-bench rule. Or, recommended for strength, each legal choice as its own engine
    input, folded with the AI's worst case or the player-model weights. That is a value-function decision for the
    Training owner.
- Hazards from the public side conditions.
- `postFromOutcome` places `benched` on the bench with their HP and the newcomer in the slot.
- prelude.ts's `A replacement is needed before the moves.` goes too: an entry Intimidate setting off Eject Pack is the same
  replaceSlot.
- The Training public-information rule holds: only the player's public HP and status and the belief world's sets.

**The oracle extension** (2v2/verify):
- `Case.bench?: { own?: CaseMon[]; opponent?: CaseMon[] }` (default: today's one Snorlax).
- `Case.replacement?: Partial<Record<SlotId, number>>` (a bench index).
- `Case.hazards`.
- sim-dfs.ts answers switch requests mid-turn from them (today's `:876-892` "a mid-turn switch is not supported").
- `sample` in dragIn is already a decision.
- compare.ts compares `replaced`, `hpEntered`, and E2's `benched`.

**Cost.**
- Engine XL: World identity, replaceSlot, the entry pipeline, result fields.
- UI L: bench, replacement, hazards, result card.
- Training M.
- Oracle M.
- Three tracks with disjoint files: engine (doubles-turn.ts, doubles-world.ts, a new doubles-switch.ts), UI (calculator),
  Training plus oracle.

**Cases.**
- G4-SWX-01-sv: U-turn into an Intimidate bench Pokémon [B2].
- G4-SWX-02-champions: Parting Shot (Incineroar) with a chosen replacement and a later foe move into it.
- G4-SWX-03-sv: Stealth Rock [B3].
- G4-SWX-04-swsh: Roar with two bench Pokémon [B5].
- G4-SWX-05-sv: two Eject Packs [B1].
- G4-SWX-06-usum: Drought replacement, frozen order [B7].
- G4-SWX-07-sv: Regenerator [B6].
- G4-SWX-08-champions: Eject Button.
- G4-SWX-09-sv: Baton Pass with evasion [B4a].
- G4-SWX-10-champions: Golisopod's Emergency Exit (Champions has Golisopod: `guards-q-catalog.out`).
- G4-SWX-11-sv: Red Card [B9].

---------------------------------------------------------------------------------------------------------------------------

## 6. The other guards the census lists (decision per entry)

"Model" entries are this family's unless a family is named; "keep" keeps the exact text. Frequencies are census-guards.md's.

| Census entry | Decision | Design |
|---|---|---|
| needs-last-move (2.85 %) | **Model by input** (user to approve: §11 Q1) | doubles-prep.ts doublesSlotInput (`:287-292`) passes `lastMove` from a new per-slot control `Last move` (the slot's move slots, "None since it came in", "Unknown"), shown when a turn move reads it (Disable, Encore; Copycat, Mirror Move under §6 calling). Default: "None since it came in" with the turn fact `Assumes {Name} used no move before this turn.`, or "Unknown" (today's reason). Training has it already. Cases G4-LMV-01-champions (Whimsicott Encore into a foe that used Protect last turn), G4-LMV-02-sv. |
| encore-change | Model | At the target's runMove (`PS/sim/battle-actions.ts:227-234`): its action's move becomes the encored one with its old priority and a random target for it (one world per legal target, uniform; resolveTargets with a `randomNormal`-like pick of `getRandomTarget`). Kernel: execute (`doubles-turn.ts:973`) reads `vol.encore` before runMove. Cases G4-ENC-01-sv, -02-champions. |
| needs-moves (Imprison) | Keep | Reachable only from the sampler; the app always gives moves. |
| grounding-change, smackdown-later | Family 2's grounding enabler | Consumer: grounded() (`doubles-turn.ts:1387`) reads EotState already; the calculations need a build flag. Family 2 owns it. |
| roost-type, type-change-protean (0.68 %), type-change-burnup | Family 2's types enabler | Consumers: proteanGuard (`doubles-status.ts:680-687`), roost (`:1420-1425`), afterHit (`doubles-turn.ts:2337-2339`) set world types instead of throwing. bridge.ts:297's used-Protean rollout goes with them. |
| glaive-rush | Model | MonState.glaiveRush (until its next move); searchFor adds a defender flag the engine applies as 2x final damage (an engine correction `withFinalMods([2], run)` like withPowerMods) [Q1]; every move hits it (moot under the hit rule). E2 volatile "glaiverush" (Training maps it). Cases G4-GLV-01-sv, -02-champions (Baxcalibur). |
| semi-invulnerable | Model | MonState.eot.hidden exists (`doubles-eot.ts:1164-1168`). Later hits: a miss fact `{Name} is out of reach ({Move}).` unless the move hits it (Gust, Twister, Sky Uppercut, Thunder, Hurricane, Smack Down, Thousand Arrows into Fly/Bounce; Earthquake, Magnitude into Dig; Surf, Whirlpool into Dive), with its 2x (onSourceModifyDamage, onSourceBasePower for Bounce); No Guard and Lock-On pass; Phantom Force and Shadow Force none. Cases G4-SMI-01-sv (Dig, Earthquake), -02-champions (Fly, Hurricane). Its next turn's forced move: Training maps twoturnmove. |
| volatile-secondaries | Model three, family 1 one | Burning Jealousy (burn) and Alluring Voice (confusion) when statsRaised: giveStatus / the confusion path. Spectral Thief: the stolen positive stages onto the user (stealsBoosts before damage: the step's calculation reads them; a new step pre-effect). Core Enforcer: family 1's ability suppression. |
| spread-effect (0.36 %) | Model with §4.7's composition | The attacker's per-target changes composed in hit order: a status (a target's Spicy Spray burns the attacker: the first lands, the second fails), stages (summed through applyBoosts), an item (once). spreadStep (`:2533-2541`). Cases: G4-SPE-01-champions (Rock Slide into a Scovillain-Mega with Spicy Spray and its partner), -02-sv (Rocky Helmet and Rough Skin on a contact spread move: summed today, kept). |
| spread-contact-ko | Model | The rest's hits from the pre-move state, the attacker fainted afterwards in the faint batch order. `:2472-2476`. Rare. |
| ally-effect (0.36 %) | Model | moveFailure (`:1914-1920`): an ally's priority move is calculated with the target's and its partner's priority shield as GAS_STAND_IN and with conditions.terrain without Psychic for the calculation (the engine's block), not for the field [R1]. Cases G4-ALE-01-sv (R1), -02-champions (Farigiraf). |
| redirect-tie | Keep | Its order is effectOrder (switch-in order), not known. |
| unnerve-resist (0.14 %), unnerve-recoil | Model | Stand-ins in searchFor: the target's resist Berry as Leftovers where a third Pokémon's Unnerve stops it; the attacker's Unnerve as GAS_STAND_IN-like "unnerve on" when it hits its own ally (the engine's own check). unnerve-recoil: split the step's attacker change before and after the hit's Update (the step's attackerHeals order exists). |
| ripen-stolen | Model | A one-hit halving mark (`MonState.berryWeaken: type`) the next calculation into the user reads (engine correction ×0.5 final). Rare. |
| cotton-down | Model (SwSh) | foeDrop on each other active Pokémon in Speed order after the step (§3.1 events). |
| flower-pastel-veil | Model | Undo the step's drop or status on the protected Pokémon (they are its secondaries; its damage does not read them). |
| battle-bond | Model | selfBoost +1 Atk, SpA, Spe once (gen 9: `PS/data/abilities.ts:362`); a carried "already used" (Training public). |
| aftermath-innardsout | Model | A loss on the attacker in the step's joint factor: Aftermath 1/4 of its max HP on contact KO; Innards Out the HP the target had before the hit (the joint target–attacker table). |
| receiver-alchemy | Family 1 | abilityChange. |
| symbiosis | Model with §3.3 | At an item use (a used item, not Trick's): the partner's item moves to the user (doubles-items.ts receive with its Start), the partner's Unburden; Fling [E6]. eventGuards (`:1155-1159`), doubles-items.ts:108-110, doubles-eot.ts:1037-1040 removed. |
| face-guards (multi-hit, effects) | Model multi-hit; keep the item reactions | Multi-hit: the first hit through faceHit, the rest as a step into the busted form with one hit fewer (TurnStepPart as the Substitute's split). The reactive items (Rocky Helmet on a 0-damage hit…) stay `{Disguise\|Ice Face} is not modelled in 2v2.` until each is probed. |
| focus-band | Model | 1/10 per knockout hit [O1, O1b]: a branch in the step (uses-to-ko's per-hit KO check gains a 1/10 survive at 1 HP in turnMode; the 1v1 keeps its fact). |
| berry-between-hits | Model | The step's per-hit Update for Starf (branch), Ganlon, Apicot, Lansat with Cheek Pouch: the stage applied to the later hits (turnMode). |
| aria-faint | Keep | `Sparkling Aria's burn cure after {Name} faints in the move is not modelled in 2v2.` (the faint's cause is not followed; rare). |
| gale-wings-gen7 | Model | Calculate with the frozen priority for the shield and terrain checks. |
| assurance-own-hp | Model | Track hurt per HP branch: a world split where the own step's loss was positive (the step's outcome knows the attacker's loss). |
| gmax-effects (SwSh) | Model all but G-Max Replenish | Confusion, infatuation (family 2's Attract state), the crit stage plain; G-Max Befuddle and Stun Shock: one world per foe status (uniform over 3 / 2); Max Guard: a protect kind. G-Max Replenish (each Berry 1/2) is a branch per eaten Berry with item history (§3.3). |
| gas-ends-shield, gas-changing-moves | Family 1 | abilityChange. |
| too-many, engine-error | Keep | Budgets. |
| presence-commander | Keep | `Commander is not modelled in 2v2.` (SV only; Tatsugiri out of play, Dondozo +2 all once: possible later). |
| presence-poisonpuppeteer | Model (SV) | giveStatus: psn or tox from Pecharunt's move also confuses (Own Tempo, Misty Terrain, Safeguard rules). 0.6 % of the SV proxy. |
| presence-dancer | Model | An inserted synthetic action after the dance (execute with the Dancer's target rule). |
| presence-moves | Model Round, Fusion Bolt/Flare, Flame Burst, Spotlight, Counter family; keep Beat Up (USUM row), Beak Blast, Shell Trap, Sky Drop | Round [N1]: the second Round user moves next (order key 3 as After You) at 2x (base-power context). Fusion: 2x when the other was the last move used this turn (World.lastMoveUsed). Flame Burst: a fixed 1/16 splash on the target's ally. Counter, Mirror Coat, Metal Burst, Comeuppance: the damage taken this turn from a foe (MonState.lastDamage per source and category) ×2 / ×1.5 to that foe. Spotlight: the centre machinery exists. |
| presence-calling | Model Nature Power, Copycat, Mirror Move, Me First, Instruct; keep Metronome, Assist | Nature Power: the terrain's move (else Tri Attack) run as the user's. Copycat: World.lastMoveUsed (this turn's, else the input's last-turn move: lastMoveInput). Mirror Move: the target's lastMove. Me First: the target's queued damaging move at 1.5x before it. Instruct: an inserted action of the target's lastMove. Metronome (all moves) and Assist (party moves) keep `{Move} is not modelled in 2v2.` |
| presence-pledges | Model | Reorder (the first waits), 150-power combined move, its side condition: sea of fire (1/8 end of turn), rainbow (secondary chances ×2: below 100 % stays out except those reaching 100 %), swamp (Speed ×1/4). |
| presence-custap | Keep | `Custap Berry is not modelled in 2v2.` (with Quick Draw or Mycelium Might; rare). |
| darts-aim-self, received-item, into-substitute, sub-per-hit | Model received-item (Seeds, Room Service, Booster Energy at setItem: their use); keep the others | Track E's narrow texts stay for Dragon Darts' self-aim and the Substitute ones (each a one-rule probe later). |
| eot-landing | Model | A residual hit (order 3) from a carried user build: `DoublesCarried.futureMove` gains `{ move; user: BattleBuild }` (Training: the belief build; calculator: an input "Future Sight from" a Pokémon). |
| eot-cudchew | Model | Order 28.2 handler running the Berry's eat effect on its holder (Training carries it, bridge.ts:241). |
| eot-moody-starf-e2 | Model | E2 branches: Moody 5 × 4 worlds (+2 one stat below +6 of the five, −1 another above −6; `PS/data/abilities.ts:2701`); Starf §4.13. |
| eot-overtime (SwSh) | Model | Side residual 5.1 for G-Max Vine Lash and kin (baseMaxhp/6, the immune type), Centiferno and Sandblast as partial traps. |
| eot-form-change | Model | Species change at order 29 (Zen Mode, Shields Down, Schooling, Power Construct: HP scaled as formeChange; Power Construct heals the difference). |
| eot-liquidooze-healblock | Model | §4.16. |
| settle-imposter, settle-two-act, settle-download | Family 1 (Imposter); keep two-act and Download's order | Two-act and Download's entry order need who entered first: unknown inputs. |
| settle-trace-random | Keep | The calculator has "Ability Trace copied"; Training reads it. The reason is the prompt-free fact. |
| row-history-moves | Keep (1v1 rows) | Inputs a 1v1 change would add; out of scope for 2v2. |
| row-engine-limits | Keep | 1v1 engine limits. |
| tr-volatiles, tr-ability-changed, tr-field-side, tr-moves-state, tr-carried, tr-splits-prelude | Training maps what the families model | This family: healblock (§4.11), glaiverush, the hidden stages (F4), the Berserk lock (§4.8), pending copy (§4.1), lastItem (§4.2); the replacement before the moves (§5). The Substitute's hidden HP after a hit stays a rollout (hidden information). |

---------------------------------------------------------------------------------------------------------------------------

## 7. REASONS deltas (doubles-actions.ts:254-310)

| Key | Today | After this family |
|---|---|---|
| copiesRise | 4 sites | removed |
| hiddenStages | 1 site | removed |
| spreadHeal | 1 site | removed |
| berryLocked | 2 sites | removed |
| focusBand | 2 sites | removed |
| allyEffect | 1 site | removed |
| takesDouble (Glaive Rush) | 1 site | removed |
| semiInvulnerable | 1 site | removed |
| spreadEffect | 1 site | removed (§4.7 composition) |
| switchesOut | 7 sites | Option K/R0 (calculator): kept; Option R: removed, with three new narrow texts (§5.4) |
| notIn2v2("Harvest" / "Pickup" / "Psychic Noise" / "Unnerve" / "Ripen" / "Cotton Down" / "Flower Veil" / "Pastel Veil" / "Battle Bond" / "Aftermath" / "Innards Out" / "Symbiosis" / "Poison Puppeteer" / "Liquid Ooze" / "Moody" / "Starf Berry" / "Cud Chew" / "Assurance" / "Gale Wings" / "Round"…) | many | removed for each modelled one |
| kept | — | redirect ties, Commander, Custap with Quick Draw / Mycelium Might, Metronome, Assist, Beat Up, Beak Blast, Shell Trap, Sky Drop, Sparkling Aria's faint, Dragon Darts' self-aim, the Substitute guards, Trace's random copy, two-act, Download order, too-many, engine errors |
| new | — | `Custap Berry flung at {Name} is not modelled in 2v2.` (§4.5); Option R's three (§5.4) |

The row texts (calculate.ts): "Fling is not verified for this game." / "…for Champions." go after the verified 1v1 fix; "One-hit
KO move: no damage range." stays for 1v1 and does not reach 2v2.

## 8. Facts (exact texts; names, never positions)

- Opportunist / Mirror Herb: `Opportunist: {Name} copies +2 Attack.`; `Mirror Herb: {Name} copies +2 Attack.`; condition
  `Opportunist: copies +1 Attack next turn.`; turn fact `Assumes no Pokémon Terastallizes or Mega Evolves this turn.`
- Harvest: residual `Harvest: {Berry} back.`; turn fact `Assumes {Name} ate no Berry before this turn.`
- Pickup: residual `Pickup: picks up {Item}.`
- Fling (row and hit facts): `Fling fails: {Name} has no item.`; `Fling fails: {Item} cannot be flung.`; `Fling fails: {Name}
  has Klutz.`; `Fling fails under Magic Room.`; `{Item}: {Target} eats it.`; `{Item}: {Target} is burned.` (badly poisoned,
  poisoned, paralysed); `{Item}: {Target} flinches if it has not moved.`; `White Herb: {Target}'s lowered stats are restored.`;
  `Mental Herb: {Target}'s Taunt, Encore, Disable, Torment, Heal Block and attraction end.`
- One-hit KO: `{Move}: a one-hit KO move; it deals {Name}'s full HP.`; `{Name} is immune to {Move}.`; `{Ability}: {Name} is
  immune.`
- Spread heals: heals `Drain: +a–b HP.`, `Shell Bell: +a–b HP.`; step fact `Liquid Ooze: {Name} loses a–b HP.`
- Heal Block: `{Ability}: no damage; {Name} cannot heal.`; `Heal Block: Pollen Puff cannot be used.`
- Curse: loss `{Name} loses {n} HP (Curse).`
- Switch (Option R): `{Leaver} switches out; {Newcomer} comes in.`; `{Move}: {Newcomer} is dragged in.`; `{Name} switches out
  at {hp} HP.`; turn fact `Assumes {Newcomer} comes in for {Name}.`
- Last move: turn fact `Assumes {Name} used no move before this turn.`
- Controls (labels): `Last move`, `Berry eaten earlier`, `Accuracy stage`, `Evasion stage`, `Berry locked (Berserk)` (Anger
  Shell: `Berry locked (Anger Shell)`), `Bench`, `Replacement`, `Stealth Rock`, `Spikes`, `Toxic Spikes`, `Sticky Web`.

## 9. Training deltas

- **bridge.ts carriedOf.** Adds:
  - `stages` (F4);
  - `healBlock` (§4.11);
  - `lastItem` from the tracker (§4.2);
  - `copy` from the prelude clone (§4.1);
  - `berryLocked` (§4.8);
  - the glaiverush and twoturnmove volatiles (§6).
  - The rollout reasons for those volatiles go.
- **Under R0/R.** The bench, the replacement policy and the hazards (§5.4).
- **evaluate.ts postFromOutcome** reads `pendingCopy`, `lastItem`, `berryLocked`, `stages`, and under R `benched` and the
  new occupants.
- Every read is public or the belief world's replay of public lines; no hidden HP (the Substitute stays a rollout).

## 10. Tests and oracle

- **Unit tests** (new files, `tests/unit/`):
  - doubles-guards-ally.test.ts (F1)
  - doubles-guards-copies.test.ts (§4.1)
  - doubles-guards-items.test.ts (§4.2, §4.3, §4.5 2v2)
  - doubles-guards-ohko.test.ts
  - doubles-guards-spread-heal.test.ts
  - doubles-guards-lock.test.ts (§4.8, F2)
  - doubles-guards-healblock.test.ts
  - doubles-guards-misc.test.ts (§4.10, §4.13–4.16)
  - doubles-switch.test.ts (R)
  - fling-1v1.test.ts (the 1v1 fix; the power table against the catalog)
- **Oracle.** The cases of §2–§6 in a new `2v2/verify/cases-g4.ts` (CASES gains them).
  - Every family-4 case runs in SV and at least one other game.
  - compare.ts adds E2 boosts and stages (today it compares HP, items, Substitutes, positions and volatiles: a stage bug like
    GA3 passed with 0 mismatches) and `harvest` to its chance effects.
  - The 1264 stored cases must keep agreeing.
- **golden-1v1** byte-equal except the verified Fling rows (listed by id).

## 11. Questions only the user can decide (each with a recommended default)

1. **Disable and Encore's last move in the calculator** (2.85 % of Champions turns). Recommended: a `Last move` control,
   default "None since it came in", with the fact `Assumes {Name} used no move before this turn.`. Alternative: default
   "Unknown", which keeps today's reason until set.
2. **The switch-out family.**
   - K: keep the reason.
   - R0: Training and E2 only (cost L).
   - R: calculator too, with Bench, Replacement and hazards controls (cost XL).

   Recommended: R0 now, R's UI as its own track after.
3. **Under R, the player's replacement in Training's evaluation.** Recommended: the rollouts' healthiest-bench rule (as
   today). Alternative: each choice as its own world (stronger, more E2 calls).
4. **A Harvest holder's earlier Berry in the calculator.** Recommended: the control with default none and its fact.
5. **Carried accuracy and evasion stages in the calculator.** Recommended: two optional numbers, shown when a move reads them.
6. **The Berserk lock checkbox in the calculator.** Recommended: yes, default off, shown only for a Berserk or Anger Shell
   holder of a healing Berry.
7. **Terastallization and Mega Evolution timing** (one fact). Recommended: the fact `Assumes no Pokémon Terastallizes or Mega Evolves this turn.` where a
   start copy depends on it, rather than a new "Mega Evolves this turn" input.

## 12. Risks

1. **F1 changes today's numbers** for any spread or ally-aimed move into a Defiant or Competitive partner. They are fixes
   (GA5b), but stored oracle cases with that shape must be re-run: none are known; compare.ts never checked E2 stages.
2. **The spread drain composition can grow the factor.** §4.7 makes the attacker's HP after the move depend on each
   target's dealt damage, so the attacker joins each target's factor: (x, t1, t2).
   - The table holds every joint entry. Today it is the product of the factors the step joins.
   - Matcha Gotcha's user usually enters at one HP (it has not been hit), so |x| = 1 and the table is |t1|·|t2|·(dealt
     outcomes), the size of today's two independent target factors times the drain's outcomes.
   - A Sinistcha hit earlier in the turn enters with many HPs. 16 × 200 × 200 = 640 000 entries would pass the 200 000
     entries budget (`doubles-turn.ts:60`). Such turns become "Too many cases to follow." rather than wrong.
   - Splitting afterwards (`splitFactor`) restores independence only where it is exact.
   - The critic sizes it on the Champions sample: Sinistcha is on 3.9 % of team slots; the budget reason must stay rare.
     Mitigation where needed: compose x with each target's dealt marginal in turn. That is exact, since the per-target
     outcomes are independent given each t_before. Join (x, t_i) only for the Berry check, which reads x alone.
3. **Stage events from the step** (§3.1) change the step's outcome signature: more children per step, so more worlds. They
   are only distinct where a copier, Eject Pack or a statsRaised reader exists; the signature can include `rises` only when
   such a reader is in the turn.
4. **Fling's 1v1 fix changes golden-1v1**: the verification sweep is the gate; the catalogs gain a field (data pipeline).
5. **Option R's World identity** touches every hook that keys by slot. `mons[slot]` stays the occupant, but statistics
   (StepStats by action index) and `names` (fixed per turn) need the newcomer's name. turnNames gets the bench names, with
   duplicateNameParts over all six.
6. **Hidden-stage engine correction**: `util.countBoosts` must be patched at call time only inside the move's base power. If
   the vendored calc calls countBoosts elsewhere for the same move, the critic greps; today only the BP switch calls it.
