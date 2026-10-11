# Track H (wave 1a): the hidden state

Branch `calc-2v2-status-2`. Owner files: `app/lib/battle/doubles-hidden.ts`, `tests/unit/doubles-hidden.test.ts`.
Spec: ADDENDUM2 §4.2 H (T2M §3.1 with C20, C21, C24, C27, C38), §2.3 #1 and #2. Ground truth: pinned Showdown `c23d2e94`
(`PS/…` = `node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353`).

## What H models

| Part | Hook (called from) | Showdown |
|---|---|---|
| The charge turn: no guard; `vol.charging` for every damaging two-turn charge (E2 `charging`); the turn fact `Assumes {Name} did not charge {Move} last turn.`; Cramorant's Dive form (Gulping above half its HP, Gorging at half) | `chargeHidden` (doubles-turn.ts chargeTurn) | twoturnmove onStart; dive onTryMove `formeChange` |
| The invulnerability step of damaging moves: a hidden target is missed (`{Move} misses {Name} ({Hidden move}).`, no contact effect, crash follows) unless No Guard on either Pokémon, the user's Lock-On at it, the move as used in the hidden move's list, or Sky Drop's pair | `misses` (hitChecks, after presence.invulnerable) | battle-actions.ts:621-641; fly/bounce/dig/dive/phantomforce/shadowforce onInvulnerability; noguard, lockon priority 1 |
| The same for status moves: Helping Hand passes, Toxic from a Poison-type user passes (gen 8+ the step; gen 7 the toxic volatile), Perish Song and Teatime check it, other side and field moves do not | `missesStatus` (doubles-status.ts tryHit, Perish Song through tryHit), `missesField` (A3's Teatime) | :621-641; moves.ts:13247, :19048; gen7 toxic |
| The ×2 damage | calcBuild's `takenMods.hidden` from `eot.hidden` (Step 0b's engine part) | onSourceModifyDamage / onSourceBasePower |
| A release from last turn: hidden from the turn's start, ends at its action (TryMove, or MoveAborted when BeforeMove stops it) | carriedState (kernel) writes it; `release` (runMove), `beforeMove` (BeforeMove 12, needs I1); `hiddenKind` treats a moved release as not hidden | fly onTryMove; twoturnmove onMoveAborted (probe H01, H02) |
| Landing: Gravity (Fly, Bounce, Sky Drop's user, freeing its target), Smack Down and Thousand Arrows (Fly, Bounce); the queued release cancelled with `{Name} falls to the ground ({Gravity}): {Move} is cancelled.` (the cancelled move keeps its place in the order); E2 no `charging` | `land(kernel, w, slot, cause?)` (A3's fieldMove, A2's groundingAfterHit); cause absent: Gravity while Gravity is up, else Smack Down | gravity onFieldStart; smackdown onStart; queue cancelMove |
| Sky Drop's charge turn: through the hit steps (a protection blocks it with no contact effect: the charge has no contact flag); fails into an ally, a Substitute or 200 kg and more (weight after Heavy Metal, Light Metal, Float Stone); the type immunity of a Normalize / Electrify Sky Drop; else both hidden (`eot.hidden = "skydrop"` on both, `eot.lifted` on the target), user `vol.charging = "skydrop"`; the lifted Pokémon's BeforeMove is null at priority 12 (`Lifted by {User} (Sky Drop).`); Follow Me / Rage Powder of a lifted user draw nothing; Gravity or the user fainting frees it | `skyDropHit` (needs I2), `beforeMove` (I1), `misses`, `land`, `fainted` (I6); I4 for tracksTarget | moves.ts:16681-16790 |
| Crash damage | `crash` (Step 1 #10, kept) | :8899 onMoveFail |

Helpers other tracks may read: `hiddenKind(w, slot)`, `semiInvulnerable(w, slot)` (pinned isSemiInvulnerable), `skyDropped(w, slot)`.

## Narrow reasons kept inside the model (each a named corner the calculation or a frozen file does not read; tests in doubles-hidden.test.ts)

All use existing REASONS keys (`combo`, `formChange`):
- a move that gets through into a hidden Pokémon on the ground on a terrain the engine reads as for a Pokémon not hidden:
  `{Move} with Grassy Terrain and {Name}'s {Hidden} …` (Earthquake, Bulldoze, Magnitude: grassyterrain onBasePower skips a
  semi-invulnerable target), `… Psychic Terrain …` (a foe's priority move through No Guard / Lock-On), `… Misty Terrain …`
  (a Dragon move, or any move through No Guard / Lock-On: its status block); 
- `{Move} with {Name}'s Gulp Missile …` (no spit while semi-invulnerable), `{OHKO move} with {Name}'s {Hidden} …` (the
  accuracy step's semi-invulnerable branch), `Smack Down with {Name}'s Fly …` (a Fly / Bounce user already grounded: Iron Ball,
  not Flying type; A2's write lands only where the step grounded it), `{Move} with {Name}'s Sky Drop / Eject Button …`
  (DragOut and Eject Button read isSkyDropped);
- `{Hazard} with {Name}'s Magic Bounce / Magic Coat …` while a Pokémon of that side can be hidden (the bounce reads the
  move's first target's semi-invulnerability; doubles-status.ts's bounce does not);
- `Toxic with Protean …` (generation 7 reads the user's types before Protean);
- `Sky Drop with Follow Me / Rage Powder …` (a lifted redirector freed later this turn by Gravity or its user's knockout
  before a foe's move), `Sky Drop with Snatch …` (a lifted Snatch user with a later action);
- `{Move} with no Pokémon to aim at …` (a carried release with both foe slots empty never reaches its TryMove in the walk);
- `Gulp Missile changing {Name}'s form …` (Cramorant's Dive with an HP range across half, or with a Power Herb).

## Deviations from the spec text (each checked in pinned Showdown)

1. **A release stopped at BeforeMove is no longer hidden** (ADDENDUM2 §4.1 step 1 and §4.2 H, T2M §3.1.6 say it stays hidden
   to the end of the turn): twoturnmove onMoveAborted removes twoturnmove and its onEnd the move's volatile. Probe
   `w1a-h-probes.ts` H01 (full paralysis), H02 (sleep): a slower Body Slam after the stopped release hits. T2-SI12b's
   paralysed Dragonite moved after the Body Slam (halved Speed). T2M-SI-13b's check text should say so (V1).
2. **The lifted Pokémon carries `eot.hidden = "skydrop"` too**, beside `eot.lifted` (ADDENDUM2 C21: `eot.hidden` on the user,
   `eot.lifted` on the target): every reader of `eot.hidden` (terrain status and priority blocks, Grassy Terrain's heal, the
   landing at the end of turn) is pinned `isSemiInvulnerable()`, true for both of the pair.
3. **E2: only the Sky Drop user has `twoturnmove` and `skydrop`** (ADDENDUM2 §4.2: "both carry"): the volatiles are the
   user's (CQ08's dump: `p2a Lifted [no volatiles]`).
4. **`vol.charging` for every damaging two-turn charge**, not only the hidden ones: DoublesOutcomeMon.charging is "present
   exactly when volatiles has twoturnmove", which every charge adds (probe H03: Solar Beam, Meteor Beam, Fly, Dig, Geomancy).
5. The turn fact `Assumes {Name} did not charge {Move} last turn.` comes from chargeHidden as a walk fact (kernel.turnFact) for
   a damaging move that charges this turn with no `carried.charging` (A1 has Geomancy's).
6. `land` takes an optional cause (inferred when absent), `missesField` an optional user (No Guard, Lock-On): both compatible
   with Step 0a's signatures.
7. A Gravity-cancelled release keeps its place in DoublesStep.order (`w.executed++`): the oracle counts every move taken off
   the queue before a pick.

## Validation

- `w1a-h-cases.ts` (45 scenarios: T2M-SI-01…14, T2E-SI-01, IN-CHG-01, CQ-SKD-01/02 and the corners above) through
  `w1a-h-run.ts` (sim-dfs.ts oracle in memory, app-turn.ts, compare.ts): **all match** on the wired copy; on this tree all but
  the E2 `twoturnmove` volatile (I7) and Sky Drop (guarded until I1–I4, I6) and H-SI-13c (I1).
- Stored cases (1705) through `step0a-run-app.ts` on three copies of one snapshot (`w1a-h-wire.mjs`: base = Step 1's
  doubles-hidden.ts, new = this track, wired = new + the integrator's lines), compared by `w1a-h-changed.ts`: new 47 changed,
  42 agree with the stored oracle; wired 51 changed, 48 agree. The others: FX-CR-06-sv (its case still expects the removed
  `semiInvulnerable` reason: V1's STATUS2_REEXPECT 1a), SAT-SBM-1/1b-champions (an engine error in every copy; only the
  copy's path in the stack differs). Changed and agreeing: T2M-SI-*, T2E-SI-01b, IN-CHG-01*, CQ-SKD-01/02 (wired),
  ER01c, ER10d, ER10e, INT04a, INT04b, SAT-GEO-1b-swsh/usum (wired: E2 volatiles), each by the turn fact and E2 `charging`.
- `tests/unit/doubles-hidden.test.ts`: 35 pass, 8 skipped on this tree; 42 pass, 1 skipped on the wired copy
  (`w1a-h-vitest.config.mts`). golden-1v1 differs only in F's Fling rows. eslint and tsc clean for H's files.
