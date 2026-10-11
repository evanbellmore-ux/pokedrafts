# Track K (wave 1b): the reactions to a hit

Branch `calc-2v2-status-2` (checked before the work and before this report). Owner files: `app/lib/battle/doubles-reactions.ts`,
`tests/unit/doubles-reactions.test.ts` (new), `tests/source/doubles-spread-reactions.test.ts` (new). Spec: ADDENDUM2 §4.3 K
(FX-CE first), T2M §3.2-§3.12. Ground truth: pinned Showdown c23d2e94 (`verify/sim-dfs.ts oracle()`). Nothing committed, pushed
or switched; no `next build`; nothing against Supabase; `.claude/`, `node_modules` and the CastMirror / RaidCard files untouched;
no other track's file edited.

Scratch (all in `build/w1b-k/`): `cases.ts` (78 scenario cases, ids `K-…`), `run.ts` (oracle + app + compareCase; `--verify --local`
re-runs a stored reason case as an oracle case), `results/` (their oracle results), `sync-tree.mjs` (a copy of `app/lib/battle`:
`base/` = the tree when wave 1b started, E2's two files from `build/e2/before`; `tree/` = base + this file + `--patch` the asks
of `asks.json`; `before/` = base + this file as wave 1a left it), `app-all.ts` (every verify case on a tree, digests), `bench.sh`,
`vitest.tree.config.mts` (unit tests against `tree/`, `K_TREE=before` for the before tree), `print.ts`, `hp.ts`, `one.ts`.

## What K models

| Entry | Model | Showdown |
|---|---|---|
| Core Enforcer (FX-CE) | `volatileSecondary` → `coreEnforcer`: a target the hit reached (a Substitute's hit too) that has HP, has moved (no action of it left in `w.remaining`) and did not switch in this turn gets the gastroacid volatile through A1's own `HANDLERS.gastroAcid.onHit` (the old ability's End, the stand-in, Unnerve's Berries, the field change), unless cantsuppress or already suppressed; a gas holder's own gas ends through `kernel.gasEnds` (Q5's reason while a suppressed Pokémon is in: A1's End skips a holder whose build holds the stand-in). Hit fact `Core Enforcer: {Name}'s {Ability} is suppressed.` | moves.ts:2874-2893 onHit, onAfterSubDamage; queue.willMove; newlySwitched |
| spread-effect | `stepEnv` sets `UsesEnv.spreadUser` for a spread step into a Gooey, Tangling Hair or Cotton Down holder (the step lists the drop on the user, not applying it). `veil` (called on every child of `applyStep`) tags a spread child's `World.spread` entry of a target whose reaction changes the user's own state (Spicy Spray, Mummy, Lingering Aroma, Wandering Spirit, Pickpocket, Gulp Missile, Sticky Barb) with the target. `spreadUser` then composes, in hit order (`World.hitTargets`): the reference state (an untagged target's), each tagged target's difference from it (status: the first stands; ability; item; Unburden), each listed drop through `kernel.applyBoosts` (Defiant, Mirror Armor, Mist, Clear Body…), White Herb after the move, Receiver copies stashed during the hits, then Battle Bond; it applies the build itself and empties `states`. The attacker's Unnerve stand-in (below) is read as its Unnerve. | battle-actions.ts spreadMoveHit (all damage, then each DamagingHit by compareLeftToRightOrder: target index) |
| spread-contact-ko | `contactKO`: a user Spiky Shield knocks out still hits the rest and faints in spreadStep's first loss group; not estimated only where it holds an after-the-hits effect that needs HP (Moxie and its kin, Battle Bond, Throat Spray). | battle-actions.ts:550-577 |
| unnerve-resist | `calcStandIns` (the integrator's searchFor line, ask 1): where the turn's Unnerve and the calculation's reading of a working resist Berry differ, the target's item reads Leftovers (a third Pokémon's Unnerve stops it) or the attacker's ability reads the stand-in (its own Unnerve does not stop its ally's Berry); `unnerveRecoil` puts both back on every child, `spreadUser` reads the attacker's back. `unnerveStand` is then silent, except for a Berry taker (Bug Bite, Pluck, Thief, Covet, Incinerate, a Magician user: `{Move} with Unnerve is not modelled in 2v2.`) and S's face paths (`{Face} with Unnerve …`). Without the line: today's reason. | abilities.ts unnerve onFoeTryEatItem; gen789 calculateFinalModsSMSSSV |
| unnerve-recoil | `stepEnv` sets `unnerve.endsOnKO` (single-target steps): the target is a foe Unnerve or As One holder, no third holder stops the attacker's working HP or pinch Berry: the knocking hit's Update eats it (hit-loop), before recoil, Life Orb and Steel Beam's cost. The guard is gone. | battle-actions.ts:967 |
| cotton-down (SwSh) | single-target hits: `koRetaliationAfter` (it has `landed`), per hit, every other active Pokémon in getAllActive order but the user (its drop is the step's) takes Spe −1 from the holder through `applyBoosts` (`herb: false`, White Herb after); spread moves: `spreadUser`, every other active Pokémon, the user included, after both targets' steps. Hit facts `Cotton Down: {Name}'s Speed falls.` A residual hit into a holder: `{Move} with Cotton Down is not modelled in 2v2.` | abilities.ts cottondown |
| flower-pastel-veil | `stepEnv` sets `UsesEnv.veil` from the target's side's living Flower Veil holder (the target Grass by `typesIn`) or Pastel Veil holder that the move does not break (`kernel.breaks`, an Ability Shield keeps it); the step drops the move's drops and statuses. The guard is gone; hit fact `Flower Veil: {Name}'s stats do not fall.` for a certain drop it kept off. | abilities.ts flowerveil, pastelveil |
| battle-bond | single-target: `afterKnockOut`; spread: `spreadUser` (one faint batch, one boost). SV: +1 Atk, SpA, Spe through `applyBoosts`, `vol.onceUsed` (`battlebond`), the turn fact `Assumes {Name} has not had Battle Bond act before in this battle.` when the input does not say; USUM: `withSpecies(…, "greninjaash")`. Not when used, the user fainted, transformed, or the foes have none left (`foesLeft`). | abilities.ts battlebond; mods/gen8 |
| aftermath-innardsout | single-target steps: `stepEnv` sets `koRetaliation` (Aftermath with no unbroken Damp; Innards Out with the holder's HP at the move's start when every entry gives one value, Dynamax undone) and the hit loop takes it on the knocking hit before its Update. Spread moves: `koRetaliationAfter` → `spreadRetaliation`: the loss joins the user's HP with no Update (mapHP) before spreadStep's retaliation group; Innards Out's HP from `stepEnv`'s note of the plan's search. Loss fact `{Name} loses {n} HP ({Ability}).` | abilities.ts aftermath, innardsout (damage + totalDamage), damp |
| receiver-alchemy | `allyFaint`: the partner with Receiver or Power of Alchemy in effect takes the fainted Pokémon's ability (`realAbility`; not noreceiver) through A1's `setAbility` (`how: "roleplay"`: cantsuppress, Ability Shield, End, Start: Intimidate acts). In a spread move's hits the copy is stashed (`KVol.receive`) and `spreadUser` applies it after the hits (the receiver may be a later target). E's faints reach it through the kernel's `faint`. | abilities.ts receiver, powerofalchemy onAllyFaint |

`USER_REACTIONS` classifies every catalog ability and item whose hit reaction acts on the user (listed, state, loss, chance,
switch, field, later); the source test checks it against the pinned dex and HIT_ABILITIES' `attacker` entries.

## Narrow reasons kept (each tested)

- `Core Enforcer with {Ability} is not modelled in 2v2.`: a moved target whose own after-onHit reaction the step applied with
  the ability it read for the damage (Stamina, Cotton Down, Sand Spit, Anger Point, Berserk, Color Change, Emergency Exit,
  Wimp Out); also where the suppression's Update splits the world. Justification: the step reads one ability through the hit.
- `{Move} with Innards Out|Aftermath is not modelled in 2v2.` (spread): the user holds a Berry the Update could eat, or the
  loss alone could knock it out, or the holder's HP differed between entries.
- `Innards Out with earlier damage this turn is not modelled in 2v2.` (single target): the holder's HP differs between the
  step's entries (UsesEnv.koRetaliation holds one value). Residual: `{Move} with Innards Out is not modelled in 2v2.`
- `{Move}'s effect on {Name} from more than one target is not modelled.` (spreadEffect): states that cannot be told apart or
  composed; Dragon Darts whose first dart's target changes the user before the second dart; a Cotton Down drop before a later
  target's own Speed reaction; a White Herb the user's step used up with listed drops.
- `{Holder} with {Ability} is not modelled in 2v2.` where a Receiver copy's Start splits the world.
- `{Move} with Unnerve …` / `{Face} with Unnerve …` (above).

## For the integrator (frozen files; checked in `w1b-k/tree` via `sync-tree.mjs --patch`, `asks.json`)

1. `doubles-turn.ts` searchFor, after `let tb = calcBuild(ctx, w, target);`:
   `if (attacker && !opts?.attackerBuild) [xb, tb] = reactionHooks.calcStandIns(kernelOf(ctx), w, attacker, target, moveId, xb, tb);`
   Failing tests: `doubles-reactions.test.ts` K-UN-01, K-UN-02, K-UN-03 (`it.fails` now; flip to `it`).
2. `doubles-turn.ts` selfFaintFact, after the Liquid Ooze line:
   `if (reached && (target.build.abilityId === "innardsout" || (target.build.abilityId === "aftermath" && info.contact))) sources.push(abilityName(ctx, target.build.abilityId));`
   Failing test: "the user's faint names Innards Out and Aftermath" (`it.fails`; flip).
3. `doubles-actions.ts` (§2.4's sets): drop `flowerveil`, `pastelveil`, `aftermath`, `innardsout`, `cottondown`, `battlebond` and
   `FAINT_REACTIONS`' `receiver`, `powerofalchemy` from `EVENT_THIRD_PARTY` (into `MODELLED_THIRD_PARTY`; nothing reads
   `FAINT_REACTIONS` now); `tests/source/doubles-third-party.test.ts:96` then expects only `pickup` (or E2's) guarded.
4. Tests in other owners' files that assert the removed reasons (pass before, fail after; each new value agrees with the oracle):
   - `doubles-turn-fixes.test.ts:263-264`: F30d is ready now: `expect(turn.status).toBe("ready")` (the pane rows keep
     `resistUnnerve`'s reason, lines 265-267 unchanged); move F30d from `GUARDED` to `READY` with hp
     `own-left 153/153 (153), own-right 175/175, opponent-left start 155 max 155 low 39 high 17 min 17 max 39 average 29.125,
     opponent-right 154/154` (w1b-k `--verify --local --oracle F30d`: match).
   - `doubles-turn-mechanics.test.ts:335-339` (M29c): `expect(ready(recoil).hp["own-left"]).toMatchObject({ start: 80, low: 115,
     high: 115, min: 115, max: 115 })` (oracle match, `--local`).
   - `doubles-turn-guards.test.ts:268-277`: Breaking Swipe into Gooey + Blastoise and Rock Slide into Scovillain-Mega are ready
     (`expect(calculateDoublesTurn(…).status).toBe("ready")`); `:335-338` Cotton Down: ready.
5. Stored cases that change (all oracle-checked): M29c and F30d (reason → ready, `--verify --local` match); the 41 wave-1b
   K cases of V2 (T2M-VS-05, -SE, -SCK, -UN, -UNR, -CD, -FV, -BB, -AF, -IO, -RC, FX-CE): all match on the patched tree. No other
   stored case's app result changed (`app-all.ts` digests before/after: 43 changed).

## For other tracks

- V2: suggested extra cases from `w1b-k/cases.ts` (all oracle-matched): K-IO-04 (spread Innards Out), K-AF-05 (spread
  Aftermath), K-RC-03 (spread Receiver), K-CD-03/04 (Cotton Down read later; spread), K-SE-07/08 (Defiant ×2, the cap), K-SE-10
  (Lum), K-SE-12 (Matcha Gotcha + Spicy Spray), K-BB-04/05, K-UNR-03, K-CE-03 (through a Substitute), K-IO-07 / K-AF-06 (the
  user knocked out), and the reason cases K-CE-04, K-IO-05, K-IO-06, K-UN-03, K-SE-11.
- U2: new fact texts: `Core Enforcer: {Name}'s {Ability} is suppressed.`, `Cotton Down: {Name}'s Speed falls.`, `Flower Veil:
  {Name}'s stats do not fall.`, `Battle Bond: {Name} gets +1 Attack, +1 Sp. Atk and +1 Speed.` / `… becomes Greninja-Ash.`,
  losses `{Name} loses {n} HP (Aftermath|Innards Out).`, turn fact `Assumes {Name} has not had Battle Bond act before in this
  battle.`; a Receiver copy shows as A1's condition `Ability: {Ability}.`.

## Verification (2026-10-11)

- Scratch cases (`run.ts`, patched tree): 78/78 match (73 against the oracle, 5 reason cases). Unpatched tree: 73/78 (the five
  Unnerve stand-in cases keep today's reason).
- Every verify case on the before / now trees (`app-all.ts`, same moment): 43 app results changed; 41 match the oracle; M29c and
  F30d are stored reason cases now ready and matching the oracle locally. Nothing that matched before fails now.
- `golden-1v1.ts --check` on the tree: 254 cases byte-equal.
- Unit: `doubles-reactions.test.ts` 60 pass + 4 expected fail (unpatched tree); patched: the 4 `it.fails` pass (flip at 1).
  Doubles unit suites before / now (tree): newly failing only the four asserts of ask 4 and K's own `it.fails`.
- Source: `doubles-spread-reactions.test.ts` 4/4; `status2-hooks.test.ts`, `doubles-third-party.test.ts` pass.
- Bench (`bench.sh`; the machine shared with the other tracks): concurrent before/now rounds, per-turn ratio median 1.021 and
  1.009 (p50 4.28 → 4.38 ms, p95 equal); 44 turns newly ready.
- `tsc --noEmit`: no error in K's files (the shared tree's other errors are other tracks' work in progress).
