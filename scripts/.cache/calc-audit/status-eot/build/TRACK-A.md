# Track A: status moves (status-eot SPEC §4.2–§4.6, ADDENDUM A)

Branch `calc-2v2-status-eot`. Nothing committed. Frozen files (`doubles-turn.ts`, the Step 0 turn API in `uses-to-ko.ts`, `doubles-world.ts`) are untouched.

## What was built

### `app/lib/battle/status-table.ts` (new, generated)

- Holds all 271 catalog Status moves.
- Each entry has:
  - the build's kind (`spec-classify.md` plus the ADDENDUM change: Ally Switch, Trick and Switcheroo are M);
  - the dex fields from pinned c23d2e94: target, priority, type, the eight flags the pipeline reads, `ignoreImmunity: false`, boosts, self boosts, self volatile, status, volatile, side, slot, heal, selfdestruct;
  - per-game overrides (Scarlet/Violet as the base; Champions, Sword/Shield and Ultra Sun/Ultra Moon overrides);
  - a `handler` key and a `fails` key where needed.
- Also exports `FAILENCORE_MOVES`, `DEFROST_MOVES`, `CANTUSETWICE_MOVES`, `THAWING_MOVES` and `healFlag`.
- Kind counts: M 125, N 20, C 6, L 73, S 7, P 1, X 39.
- To regenerate:
  ```
  npx --no-install tsx build/track-a-dex-dump.ts --flags <flags.json> > <dump.json>
  npx --no-install tsx build/track-a-gen-status-table.ts <dump.json> <flags.json> > app/lib/battle/status-table.ts
  ```

### `app/lib/battle/doubles-status.ts` (rewritten): `beforeMove`

The checks run in pinned handler priority:

| Priority | Check |
|---|---|
| 10 | sleep, freeze |
| 8 | flinch (Steadfast) |
| 7 | Disable (Champions lets `cantusetwice` moves through) |
| 6 | Gravity, Throat Chop, Heal Block |
| 5 | Taunt |
| 4 | Imprison |
| 3 | confusion (exact snap-out posterior, 0.33 self-hit) |
| 1 | paralysis |

- Focus Punch's callback runs after them.
- No move is treated as Splash.
- Snore and Sleep Talk are usable while asleep.
- The turn's first Update runs before the first BeforeMove. Curing Berries eat a status or confusion carried into the turn, unless Unnerve stops them. An Unburden holder is guarded.
- Posteriors:
  - Sleep: SV, SwSh and USUM {2, 3, 4}; Champions {2: 1/3, 3: 2/3}; Rest 3; Early Bird counts each turn as 2.
  - Confusion: uniform on 2..5 (Axe Kick: 3..5).
  - Freeze: Champions uses its counter; SV thaws 1/5.
- Confusion self-hit damage: stored Attack and Defense with their stages; Wonder Room uses Sp. Def; the 16 rolls.
- Disguise or Ice Face against a self-hit gets `faceSelfHit`. Focus Band, Endure, Sturdy, Focus Sash and Berries are handled.
- Exported: `sleepPrior`, `wakeChance`, `sleepTurnsLeft`, `snapChance`.

### `app/lib/battle/doubles-status.ts`: `statusMove`, the pipeline for M, C, N and S moves

1. adjacentAlly failures: the ally has fainted, or the ally used Ally Switch (A).
2. Targets:
   - self, allies, adjacentAlly, adjacentAllyOrSelf;
   - Curse: a non-Ghost user targets itself; a Ghost user aimed at its ally hits a random foe (gen 9+), then redirection;
   - otherwise the kernel's `resolveTargets`;
   - the move's type after Normalize, Liquid Voice or an -ate ability; Lightning Rod and Storm Drain against a changed type are guarded.
3. TryMove: the priority shields.
4. Try: each move's own failures (Rest, Belly Drum, Clangorous Soul, Fillet Away, Substitute, Shed Tail, Teleport, Magnet Rise, After You and Quash, Dark Void, Healing Wish) and `canSwitch`.
5. PrepareHit: Protean and Libero; Ally Switch's counter goes to Track E (`allySwitchPrepare`).
6. Per-target steps, each in Showdown's order:
   - TryHit, by handler priority: Wide Guard, Quick Guard, Psychic Terrain; Protect, Detect, Spiky Shield and Baneful Bunker (protect flag); Magic Bounce (the move is used back, side moves bounced to the user's side); Overcoat; the absorbing abilities (heal, a stage, Flash Fire); Good as Gold; Soundproof; Oblivious against Taunt; Safety Goggles.
   - Type immunity (only moves with `ignoreImmunity: false`).
   - TryImmunity: powder against Grass, Leech Seed against Grass, Sticky Hold, Prankster against Dark (gen 7+).
   - The move's own TryHit: Yawn, Curse, Disable and Encore's last move.
   - Substitute (bypasssub, Infiltrator).
   - runMoveEffects in order: boosts, heal, status, volatile, side, slot, onHit, selfdestruct.
   - The user's own effects (non-Ghost Curse).
7. The action's Update:
   - curing Berries for what the action gave;
   - Mental Herb;
   - ability cures after a Mold Breaker;
   - items Trick or Switcheroo moved, which now act on what their receiver already has: Sitrus, Lum, Persim, Mental Herb, Figy (Track E's need).

What the pipeline covers:
- The S moves: Baton Pass, Teleport, Shed Tail, Parting Shot, Roar, Whirlwind and Chilly Reception. A switch with a later action gets `switchesOut`; with no later action, the end of turn is not estimated.
- Hazards, Safeguard, Haze and Perish Song.
- L moves keep today's rule:
  - not estimated before a later living action;
  - as the last action, only the end of turn is not estimated.
  - Bestow is guarded for the whole turn only when the receiver uses the item at the Update.
  - Recycle with no item is guarded.
- X moves: today's early branches. Endure now sets `vol.endure` and fails when no Pokémon moves after it.

### `app/lib/battle/doubles-status.ts`: helpers

- **`canStatus`** (exported) checks, in order:
  - an existing status (Rest replaces one) and Comatose;
  - type immunities (Corrosion passes Poison and Steel);
  - Safeguard (an Infiltrator foe's move passes; Yawn's sleep passes);
  - Misty and Electric Terrain;
  - Leaf Guard, Shields Down (Meteor), Purifying Salt, Insomnia, Vital Spirit, Limber, Water Veil, Water Bubble, Thermal Exchange, Immunity;
  - Pastel Veil, Sweet Veil, Flower Veil on the side;
  - Mold Breaker passes the breakable ones; Ability Shield stops that (kernel `breaks`).
- **`canSleep`** and **`setStatus`**: bad poison starts at stage 0; sleep gets a counter; Synchronize passes the status back.
- **`statusLands`** and **`giveStatus`**: for damaging paths.
- **`applyBoosts`** follows `sim/battle.ts` boost:
  - foes' Pokémon left (gen 6+);
  - Contrary and Simple, then the cap;
  - TryBoost: Clear Amulet, Clear Body, White Smoke, Full Metal Body, Hyper Cutter, Big Pecks, Keen Eye, Mind's Eye, Flower Veil;
  - Mirror Armor reflects the drop;
  - each stat's fact, then Defiant and Competitive per lowered stat from a foe;
  - White Herb.
- **`selfBoost`** and **`foeDrop`**.
- Heals use modify, ceil or round exactly as each move does: Moonlight, Morning Sun, Synthesis, Shore Up, Heal Pulse (Mega Launcher), Floral Healing, Jungle Healing, Lunar Blessing, Strength Sap (Big Root, Liquid Ooze), Pain Split (Dynamax guarded), Rest, Wish (by position), Belly Drum, Fillet Away, Clangorous Soul, Ghost Curse, Substitute. Heal Block applies to all of them.
- Volatiles: confusion, Taunt, Yawn (`eot.yawn = 2`), Leech Seed (`eot.leechSeed = positionOf`), Curse, Aqua Ring, Ingrain (grounding guard), Magnet Rise (grounding guard), Substitute (`floor(maxhp/4)`, `endTrap`), Imprison (`needsMoves`), Focus Energy, Dragon Cheer, Charge, Disable, Encore (`needsLastMove`, `encoreChange`), Torment.
- After You and Quash order keys: generation 8 and later re-sort; generation 7 keeps a frozen queue.
- Destiny Bond (`onKnockOut`).
- Dynamic Punch's and Chatter's confusion, a hit thawing its target, and a Figy-family Berry's confusion.
- Pollen Puff on an ally (heal; Bulletproof; Life Orb; Heal Block on the user fails it at TryMove).
- Snore while awake fails.
- `conditions`, `outcomeMon` and `turnFacts`.

### `app/lib/battle/doubles-actions.ts`

- `MODELLED_STATUS_MOVES` = X modelled plus M and C. `NO_EFFECT_MOVES` = N. `HP_STATUS_MOVES` = P plus Purify, Stuff Cheeks, Swallow, Tea Time.
- `PRESENCE_MOVES` gains Flame Burst.
- Third-party sets:
  - into MODELLED: Sweet Veil, Good as Gold, Oblivious, Own Tempo, Synchronize, Early Bird, Hydration, Shed Skin, Big Root;
  - Pickup moves to EVENT.
- REASONS texts are untouched.

### `app/lib/battle/calculate.ts`

- Triage gives +3 to status moves with the heal flag (`turnPriority`).
- `critRatio` reads the 2v2 `focusEnergy` and `dragonCheer` build fields.
- Champions (profile generation 0) is no longer cut out of certain crits and `usesHelpers.critRatio`.

## Tests and results

All suites were run on 2026-10-08.

| Suite | Result |
|---|---|
| `tests/unit/doubles-status.test.ts` (new) | 61/61 |
| `tests/source/doubles-status-moves.test.ts` (new) | 13/13 |
| `tests/source/doubles-third-party.test.ts` (updated) | 8/8 |
| Whole source suite | 128/128 |
| `golden-1v1.ts --check` | 254 cases byte-equal |
| `tsc --noEmit` | clean |
| `eslint` on the owned files | clean |
| S cases (`track-a-compare-s.ts`, Track D's oracle results) | 206/208 |
| Track A's own probes TA01–TA56 (`--extra`, oracle via `sim-dfs.ts`) | 56/56 |
| E cases (Track E's `run-e.ts`) | 122/123 |
| Stored 2v2 cases, after-the-moves fields (`track-a-regress.mjs`) | 580/590 equal |
| Full unit suite | 15 failing, none in Track A's files |

`doubles-status.test.ts` covers:
- the posterior tables (Early Bird, Rest, Axe Kick);
- BeforeMove order and facts, including No move under Gravity and Taunt;
- the `canStatus` blocker matrix (29 rows, Mold Breaker, Ability Shield, Champions);
- Synchronize;
- `applyBoosts`: Clear Body, Defiant (foe only), Mirror Armor, Competitive, Contrary, Simple, the cap, accuracy and evasion;
- heals at an odd maximum HP;
- confusion damage: 23–28, 46–55, Wonder Room 16–19;
- Clangorous Soul at maxhp 301;
- the order keys in generation 8 and later, and in generation 7;
- the new REASONS texts and where each is given;
- Trick's Update;
- reference mode equal on 20 status turns;
- the contract's validation issues.

`doubles-status-moves.test.ts` covers:
- one entry per catalog Status move, with the build's kind;
- each game's dex fields against pinned data (SV and Champions from the compiled dex, merging the Champions mod's conditions; SwSh and USUM through `withVerifiedSources` `Dex.mod`);
- the failencore, defrost, cantusetwice and thawsTarget sets;
- the handler-coverage rule;
- the BeforeMove priorities in all four games.

S cases that do not match:
- **S25b and S26a.** The oracle's `change` is net of the Sitrus Berry eaten afterwards. The app's `DoublesHit.change` is the move's own gross change; the Berry shows in `heals`.

E cases that do not match:
- **E25b.** The integrator's part-path bug, listed in TRACK-E.md.
- E16a, b, d, e and h now agree after the received-item Update.

Stored cases that differ, all by design:

| Case | Change |
|---|---|
| F14a | reason is now "Sleep Talk is not modelled in 2v2." |
| F14b | Snore while asleep is ready |
| M11b | Dragon Dance has a hit entry |
| R01, R15 | confusion is modelled, so the turn is ready |
| V36b | Taunt has a hit |
| V36c | Taunt is ready |
| V36d | Roost is ready |

The 15 failing unit tests:
- **Track A's change makes them outdated:** `doubles-turn-guards` (5), `doubles-turn-fixes` (R01, R15, F14a, F14b), `doubles-start-rows` SR44. See Needs from the integrator.
- **Track B and Track E:** `doubles-kernel` (2) and `doubles-turn-mechanics` (2).
- **Track D's case list:** `doubles-outcomes` "every pinned Showdown case" (628/639). The S and E cases added to `doubles-turn-showdown.test.ts` lack `lastMove` and `moves`, and pass targets for moves that take none.

## Deviations from the spec

1. **Clangorous Soul and Fillet Away raise the stats first, then pay HP.** SPEC §4.3 says "cost, then boosts". Pinned `onTryHit` boosts first (the move fails if nothing rises), and `onHit` then calls directDamage.
2. **Effects on a Pokémon the move did not reach are step facts that name it.** These are Mirror Armor's reflected drop and Synchronize's status on the user, and their Defiant or White Herb. Examples: "Clefable: −2 Attack.", "Clefable is paralysed.", "Kingambit's Defiant: +2 Attack.". A hit entry with reach 0 would render as "no effect · reaches it 0%".
3. **Stage facts are in time order:** "−2 Attack." comes before "Defiant: +2 Attack.". At the cap: "Its Attack cannot go higher." or "Defiant: its Attack cannot go higher.".
4. **Ingrain and Magnet Rise are guarded with any later damaging move** (`kernel.laterDamaging`), not only one into that Pokémon. This is conservative.
5. **A Heal Block BeforeMove check was added** (priority 6: the heal flag, which covers the draining moves; Z-Moves and Max Moves excepted). SPEC §4.2 does not list it. It is unreachable today, because the kernel's `volatileGuard` stops Psychic Noise before a later action; it is ready for when that guard goes.
6. **Bestow is guarded for the whole turn only when the receiver uses the item at the action's Update:**
   - an HP or pinch Berry at or below its line on one of the move's actual targets;
   - a curing Berry, a Herb, a Seed, Booster Energy or Room Service.
   Otherwise Bestow stays L, so S48-Bestow-last-usum is ready. Recycle with no item is always guarded.
7. **Champions follows generation 9's rules in the pipeline** (its profile generation is 0): Prankster against Dark, Electric types immune to paralysis, Oblivious, Normalize, foes' Pokémon left, and Ghost Curse at an ally. Probe TA56 checks this against the oracle.
8. **calculate.ts: Champions certain crits.** A crit stage of 3 or more is now always a crit in Champions 1v1 too. This fixes a 1v1 Champions gap; golden is byte-equal.
9. **Snore while asleep:** "Asleep." is a step fact (the move is used), not a skipped fact.
10. **Pollen Puff:**
    - at full HP: "Pollen Puff fails: {Name} is at full HP.";
    - a user under Heal Block aiming at its ally: "Heal Block: Pollen Puff cannot be used." (`onTryMove`).
11. **L moves use the kernel's `laterAction`, which counts a later No-move Pokémon as an action.** An L move followed by a slower No move is "before another move".
12. **The table includes Extreme Evoboost and Max Guard,** both catalog Status moves, as X.

## Open items

- A Figy-family Berry eaten as the turn starts:
  - with a move: still "Confusion is not modelled in 2v2." (`calculate.ts` `settleDoublesStart`);
  - with No move: the confusion is dropped, though a No move now self-hits.
  This needs the integrator; see below.
- Psychic Noise stays guarded before a later action (the kernel, `VOLATILE_SECONDARY_MOVES`), because the hit loop's Berry heals do not read Heal Block. `healBlockCheck` is ready.
- `vol.encore` is stored through a local type (`Vol`); `MoveVolatiles` should declare `encore?: string`.
- Scratch helpers: `build/track-a-scratch/` (`dump.ts`, `learn.ts`, `showdown-cases.ts`).
