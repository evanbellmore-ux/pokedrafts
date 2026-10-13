import { MOLD_BREAKERS, REASONS, SELF_COST_MOVES } from "./doubles-actions";
import { slotSide, type DoublesSlotId } from "./doubles-types";
import { cloneWorld, marginal, type PendingAction, type World } from "./doubles-world";
import type { HitCheck, Resolution, SearchEntry, StepChild, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import * as guardNs from "./doubles-guards";
import { gulpingTarget, ownMoveId } from "./hit-loop";
import type { BattleBuild, ChampionsMove, CombatStat, MoveContext, MoveDamageResult } from "./types";
import type { TurnStepOutcome, TurnStepPart } from "./uses-to-ko";

// The pair's environment (status2 ADDENDUM2 §2.3 #6, #16-#20, #50; tier2-moves.md §3.5, §3.14-§3.18, §3.27): Track W's file.
// A priority move into the user's own ally, Focus Band, a Berry between the hits of one move, Sparkling Aria's cure after its
// user faints, generation 7's frozen priority (Gale Wings), Assurance after the target's own move hurt it, Safeguard against a
// damaging move's status. Pinned Showdown c23d2e94 is the ground truth of every rule here (PS/ = its read-only source).
// Build notes: scripts/.cache/calc-audit/status2/build/W1A-W.md.

const guardHooks = { ...guardNs };

/*
 * The kernel lines Track W asked the integrator for (W1A-W.md "Kernel lines") are in since integration 1a (its WIRED flags and
 * the fallbacks they kept went at integration 1b):
 * - the continuation: applyStep hands a use the target's Berry stopped between two hits to continueHits (L1); damagingMove
 *   takes a random hit count's worlds from hitCounts (L11), whose count the context hook gives the calculation (L4);
 * - the frozen context: contextFor takes W's context (L4): MoveContext.frozenPriority from frozenContext (generation 7's
 *   frozen priority, and Gale Wings at the user's HP in every generation);
 * - faintedInHits: the step reports a followed Sparkling Aria user's faint in the hits (L9, L10: uses-to-ko.ts; L3: applyStep's
 *   child key keeps it apart), and D's spreadStep takes its user's losses through userLosses;
 * - the attacker's Safeguard: the calculation reads the user's side's Safeguard against the target's Spicy Spray (L12:
 *   conditionsFor puts SideState.safeguard into the side conditions; F's calculate.ts spicySprayFirstBurnedHit reads it);
 * - hurt gets the step's target and the builds as it began (L2), selfHitBand the self-hit's loss distribution (L6-L8).
 */

/** The Berries a target eats at the Update between two hits whose effect the later hits read (data/items.ts onUpdate at a quarter). */
const BETWEEN_HITS = new Set(["ganlonberry", "apicotberry", "starfberry"]);
const STAT_NAMES: Record<CombatStat, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };
const STATS: CombatStat[] = ["atk", "def", "spa", "spd", "spe"];

// ------------------------------------------------------------------------------------------------------------------
// The pair's step environment (uses-to-ko.ts UsesEnv; doubles-turn.ts searchFor puts it in the memo key)
// ------------------------------------------------------------------------------------------------------------------

/**
 * W's part of one pair's step environment (doubles-turn.ts searchFor), each only while its holder is in the step (the readers
 * rule: every other turn's keys and worlds stay as they were):
 * - `focusBand`: the target's working Focus Band (PS/data/items.ts focusband onDamage priority −40: randomChance(1, 10) on a
 *   hit of a Move with damage at least its HP leaves 1 HP; after Endure (−10), Sturdy (−30) and Focus Sash; not used up). The
 *   step branches each knocking hit 9/10 and 1/10 in every walk (T2M §3.14; a residual landing's hit too: its effect is a Move).
 * - `safeguard`: Safeguard on the target's side against a move of another Pokémon (PS/data/moves.ts safeguard onSetStatus:
 *   `target !== source`, an ally's move included; an Infiltrator foe's move passes: `effect.infiltrates && !target.isAlly(source)`),
 *   set this turn or from an earlier turn (SideConditions.safeguard): the move's statuses on the target fail in the step
 *   (the kernel's moveConfusion reads the same side for the moves' confusion).
 * - `betweenHits`: a move that can hit more than once (multihit, Parental Bond, Beat
 *   Up) into a target holding a working Ganlon, Apicot or Starf Berry, or a Lansat Berry with Cheek Pouch, that no foe's
 *   Unnerve or As One stops: the use stops at the hit whose Update eats it (PS/sim/battle-actions.ts:967) and continueHits
 *   finishes it against the target as the Berry leaves it. Review 2 (R4-6): with a move that has recoil or a user holding a
 *   working Shell Bell, `report.dealt` too: the stopped part's damage goes to the continuation (TurnStepPart.dealt), whose
 *   recoil and Shell Bell read the move's whole total (move.totalDamage).
 * - `report.faintedInHits`: a Sparkling Aria user with a working Life Orb in a single step, whose
 *   faint in the hits (a Rowap Berry, Innards Out) the outcome reports apart from Life Orb's after them (ariaFaint).
 */
export function stepEnv(kernel: TurnKernel, w: World, attacker: DoublesSlotId | null, target: DoublesSlotId, moveId: string, spread: boolean): Record<string, unknown> {
  const mon = w.mons[target];
  if (!mon || mon.fainted) return {};
  const build = mon.build;
  const works = kernel.itemWorks(w, build);
  let env: Record<string, unknown> | null = null;
  if (build.itemId === "focusband" && works) (env ??= {}).focusBand = true;
  if (attacker && attacker !== target && w.sides[slotSide(target)].safeguard && !infiltrates(kernel, w, attacker, target)) (env ??= {}).safeguard = true;
  if (attacker && !spread && works && stopsBetweenHits(build) && !kernel.berryStopped(w, target) && hitsMoreThanOnce(kernel, w, attacker, moveId)) {
    (env ??= {}).betweenHits = true;
    if (readsTotal(kernel, w, attacker, moveId)) env.report = { ...guardHooks.stepReport(kernel), dealt: true };
  }
  if (attacker && !spread && moveId === "sparklingaria" && lifeOrbOn(kernel, w, w.mons[attacker]!.build)) {
    (env ??= {}).report = { ...((env.report as object | undefined) ?? guardHooks.stepReport(kernel)), faintedInHits: true };
  }
  return env ?? {};
}

/** An Infiltrator user's move into a foe passes the target side's Safeguard (data/abilities.ts infiltrator onModifyMove: move.infiltrates). */
function infiltrates(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId): boolean {
  return w.mons[attacker]!.build.abilityId === "infiltrator" && kernel.isFoe(attacker, target);
}

/** A held Berry whose Update between two hits the later hits read: Ganlon, Apicot, Starf, and Lansat with Cheek Pouch (its heal). */
function stopsBetweenHits(build: BattleBuild): boolean {
  return BETWEEN_HITS.has(build.itemId) || (build.itemId === "lansatberry" && build.abilityId === "cheekpouch");
}

/** A move that can hit its one target more than once: its own hits, Parental Bond's two strikes, Beat Up's party. */
function hitsMoreThanOnce(kernel: TurnKernel, w: World, attacker: DoublesSlotId, moveId: string): boolean {
  const move = kernel.runtime.movesById.get(moveId);
  return !!move && (move.multihit !== null || moveId === "beatup" || w.mons[attacker]!.build.abilityId === "parentalbond");
}

/**
 * Review 2 (R4-6): what reads the move's damage total after its hits (move.totalDamage, PS/sim/battle-actions.ts:965): its
 * recoil (applyRecoilDamage, :981-982) or the user's working Shell Bell (PS/data/items.ts:5653-5655).
 */
function readsTotal(kernel: TurnKernel, w: World, attacker: DoublesSlotId, moveId: string): boolean {
  const user = w.mons[attacker]!.build;
  if (user.itemId === "shellbell" && kernel.itemWorks(w, user)) return true;
  const info = kernel.moveInfo(w, attacker, moveId, kernel.input.pokemon[attacker]?.contexts[moveId]);
  return info.kind === "move" && info.recoil;
}

/** A working Life Orb on a Pokémon without Magic Guard (data/items.ts lifeorb onAfterMoveSecondarySelf; Magic Guard stops non-Move damage). */
function lifeOrbOn(kernel: TurnKernel, w: World, build: BattleBuild): boolean {
  return build.itemId === "lifeorb" && kernel.itemWorks(w, build) && build.abilityId !== "magicguard";
}

// ------------------------------------------------------------------------------------------------------------------
// Focus Band (T2M §3.14)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Focus Band before a pair's step (singleStep, spreadStep, a hit after a Substitute: the kernel's focusBandGuard): modelled in
 * the step (stepEnv's focusBand), so nothing here. Kept as the hook its callers name.
 */
export function focusBand(kernel: TurnKernel, w: World, target: DoublesSlotId, row: MoveDamageResult) {
  void kernel; void w; void target; void row;
}

/**
 * Focus Band against a confusion self-hit (doubles-status.ts confusionHit; data/conditions.ts confusion: this.damage with the
 * move as its effect, of type Move, so the Band acts: T2-FB01). With `dist` (the self-hit's loss → mass, the kernel line L6):
 * 1/10 of each loss that can knock it out at some HP becomes the banded loss −loss (bandedLoss leaves 1 HP where it would
 * knock out, after Endure, Sturdy and Focus Sash), and the loss fact `Focus Band: {Name} keeps 1 HP.` with its chance.
 */
export function selfHitBand(kernel: TurnKernel, w: World, slot: DoublesSlotId, values: number[], dist: Map<number, number>) {
  const mon = w.mons[slot]!;
  const build = mon.build;
  if (build.itemId !== "focusband" || !kernel.itemWorks(w, build)) return;
  const hps = marginal(w, slot);
  const lowest = Math.min(...hps.keys());
  if (Math.max(...values) < lowest) return;
  for (const [loss, share] of [...dist]) {
    if (loss < lowest) continue;
    dist.set(loss, share * 0.9);
    dist.set(-loss, (dist.get(-loss) ?? 0) + share * 0.1);
  }
  // It keeps 1 HP where the loss would knock it out and nothing before the Band saved it (Endure; Sturdy at full HP: the
  // Band is its item, so no Sash).
  const { maxHP } = kernel.hp[slot];
  const endure = !!mon.vol.endure, sturdy = build.abilityId === "sturdy";
  let saved = 0;
  for (const [hp, mass] of hps) {
    if (endure || (sturdy && hp >= maxHP)) continue;
    for (const [loss, share] of dist) if (loss < 0 && -loss >= hp) saved += mass * share;
  }
  if (saved > 0) kernel.lossFact(slot, `Focus Band: ${kernel.names[slot]} keeps 1 HP.`, w.mass * saved);
}

/** A self-hit's damage after Endure, Sturdy and Focus Sash (`damage`), for its loss from selfHitBand's `dist`: a banded loss (< 0) keeps 1 HP. */
export function bandedLoss(loss: number, hp: number, damage: number): number {
  return loss < 0 && damage >= hp ? hp - 1 : damage;
}

// ------------------------------------------------------------------------------------------------------------------
// A Berry between the hits of one move (T2M §3.15)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Before a pair's step (applyStep): a target's Starf, Ganlon or Apicot Berry or, with Cheek Pouch, a Lansat Berry eaten at the
 * Update between two hits (data/items.ts onUpdate; sim/battle-actions.ts:967) stops the step at the Berry's hit (stepEnv's
 * betweenHits) and continueHits finishes the use: nothing here. Kept as the hook its caller names.
 */
export function betweenHits(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, entry: SearchEntry) {
  void kernel; void w; void action; void target; void entry;
}

/**
 * The rest of a use the target's Berry stopped between two hits (uses-to-ko.ts TurnStepOutcome.stopAt; stepEnv's
 * betweenHits), from applyStep's child world of the stopped outcome (kernel line L1): the target after the hits so far with
 * the Berry still held, the user without its per-use effects yet. Pinned Showdown hitStepMoveHitLoop (sim/battle-actions.ts
 * 857-1020): the Update after hit h eats the Berry (Ganlon +1 Defense, Apicot +1 Sp. Def, Starf +2 to one of its stats below
 * +6 at random: one world each; Ripen, Contrary, Simple; Unburden; Cheek Pouch heals a third; T2-BE01, BE02), then hits h + 1
 * on are the same move into the target as the Berry left it: the search for that build (memoised) and applyStep with the part
 * `{ caseIndex, skip }` (the stopped part's hits are the part's first `skip`: the target's hit count takes every hit, the
 * user's per-use effects act once there: Life Orb, its stages, Throat Spray, Charge). `before`: the builds as the step began.
 * The stopped part's damage (its outcome's report.dealt: stepEnv asks for it with a recoil or Shell Bell) goes on in the part
 * (TurnStepPart.dealt): the continuation's recoil and Shell Bell read the whole move's total once (review 2 R4-6). Not
 * estimated, with today's text, in one corner: the user fainted at that hit (Rough Skin, Iron Barbs or Gulp Missile with one
 * of these Berries: the move ends at that Update, which the part cannot give).
 */
export function continueHits(kernel: TurnKernel, next: World, action: PendingAction, target: DoublesSlotId, entry: SearchEntry, info: TurnMoveInfo,
  outcome: TurnStepOutcome, before: { user: BattleBuild; receiver: BattleBuild }, part?: TurnStepPart): StepChild[] {
  const attacker = action.slot;
  const moveId = action.moveId!;
  const receiver = next.mons[target]!, user = next.mons[attacker]!;
  const item = receiver.build.itemId;
  const stopped = REASONS.berryBetweenHits(kernel.itemName(item), kernel.moveName(moveId));
  if (entry.follow && outcome.attackerFainted) kernel.notEstimated(stopped);
  // Review 2 (R4-6): the damage dealt so far, for the continuation's recoil and Shell Bell (stepEnv's report.dealt).
  const shellBell = before.user.itemId === "shellbell" && kernel.itemWorks(next, before.user);
  if ((info.recoil || shellBell) && outcome.dealt === undefined) kernel.notEstimated(stopped);
  const dealt = (part?.dealt ?? 0) + (outcome.dealt ?? 0);
  const skip = (part?.skip ?? 0) + outcome.stopAt!;
  // The stopped part's own record, as applyStep's tail keeps it for a whole use: the field the hits left (a Seed Sower's
  // terrain), the stages that rose or fell in them, an item the user used up in them (a Gem). The rest (the hit count, hurt,
  // the reactions after the move) the continuation's applyStep keeps for the whole move.
  const kept = outcome.conditions.weather === "" && kernel.conditionsFor(next, attacker, target, false).weather === "";
  next.field = { ...next.field, weather: kept ? next.field.weather : outcome.conditions.weather, terrain: outcome.conditions.terrain };
  for (const [mon, was] of [[user, before.user], [receiver, before.receiver]] as const) {
    if (STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < (was.boosts[stat] ?? 0))) mon.statsLowered = true;
    if (STATS.some((stat) => (mon.build.boosts[stat] ?? 0) > (was.boosts[stat] ?? 0))) mon.statsRaised = true;
  }
  if (kernel.tracksItems && attacker !== target && before.user.itemId && user.build.itemId !== before.user.itemId) kernel.noteItemUse(next, attacker, before.user.itemId);
  // The Berry at hit h's Update (berryDue: its HP part, Cheek Pouch, then ateBerry's rise and Starf's worlds).
  const boosts = { ...receiver.build.boosts };
  const name = kernel.names[target];
  const out: StepChild[] = [];
  for (const world of kernel.berryDue(next, target)) {
    const now = world.mons[target]!.build;
    const changes = STATS.filter((stat) => (now.boosts[stat] ?? 0) !== (boosts[stat] ?? 0))
      .map((stat) => { const by = (now.boosts[stat] ?? 0) - (boosts[stat] ?? 0); return `${by > 0 ? "+" : "−"}${Math.abs(by)} ${STAT_NAMES[stat]}`; });
    kernel.hitFact(action, target, `${name} eats its ${kernel.itemName(item)} after hit ${skip}${changes.length ? `: ${changes.join(", ")}` : ""}.`, world.mass);
    const conditions = kernel.conditionsFor(world, attacker, target, false, moveId);
    const context = kernel.contextFor(world, action, target, info);
    const rest = kernel.searchFor(world, attacker, target, moveId, conditions, context);
    if (rest.row.kind !== "calculated" || !rest.search) kernel.notEstimated(stopped);
    const continued: TurnStepPart = { caseIndex: part?.caseIndex ?? 0, skip, ...(part?.fresh ? { fresh: true as const } : {}), ...(dealt ? { dealt } : {}) };
    for (const child of kernel.applyStep(world, action, target, rest, info, false, continued)) out.push({ ...child, landed: child.landed + outcome.stopAt! });
  }
  return out;
}

/** The hit count a world of hitCounts was given (its action's copy), for the context hook. */
const COUNTS = new WeakMap<PendingAction, number>();

/**
 * A random hit count into a target whose Berry can stop the use between two hits (doubles-turn.ts damagingMove, kernel line
 * L11; stepEnv's betweenHits): the count is drawn as the hits start (PS/sim/battle-actions.ts hitStepMoveHitLoop: 2 and 3 hits
 * 35% each, 4 and 5 hits 15% each, Loaded Dice 4 or 5 hits half each, Loaded Dice Population Bomb 4–10 hits 1/7 each), and
 * which hits remain after the Berry's hit depends on it, so the exact walk takes one world per count at its chance
 * (MoveDamageResult.hitChances), each with that count chosen (MoveContext.hits, through the context hook) and so one case to
 * continue. The roll walks keep their one case (the fewest or the most hits). Otherwise the world and the action as they are.
 */
export function hitCounts(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, check: HitCheck): { world: World; action: PendingAction }[] {
  const one = [{ world: w, action }];
  if (kernel.mode !== "all" || check.block || info.transformed || !action.moveId) return one;
  const attacker = action.slot, target = check.slot;
  const mon = w.mons[target];
  if (!mon || mon.fainted || attacker === target || !stopsBetweenHits(mon.build) || !kernel.itemWorks(w, mon.build) || kernel.berryStopped(w, target)) return one;
  const move = kernel.runtime.movesById.get(action.moveId);
  if (!move || move.multihit === null) return one;
  const context = kernel.contextFor(w, action, target, info);
  if (context?.hits) return one;
  const row = kernel.searchFor(w, attacker, target, move.id, kernel.conditionsFor(w, attacker, target, false, move.id), context).row;
  const chances = row.hitChances;
  if (!chances || chances.length < 2 || row.attackerFaintsOnHit) return one;
  return chances.map(({ hits, chance }) => {
    const counted: PendingAction = { ...action };
    COUNTS.set(counted, hits);
    return { world: cloneWorld(w, w.mass * chance), action: counted };
  });
}

/**
 * W's part of a move's context (doubles-turn.ts contextFor, kernel line L4): the priority it is used with where the
 * calculation would read another (frozenContext), and the hit count a world of hitCounts was given. Undefined: none.
 */
export function context(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo): Partial<MoveContext> | undefined {
  const frozen = frozenContext(kernel, w, action, info);
  const hits = COUNTS.get(action);
  if (frozen === undefined && hits === undefined) return undefined;
  return { ...(frozen !== undefined ? { frozenPriority: frozen } : {}), ...(hits !== undefined ? { hits } : {}) };
}

// ------------------------------------------------------------------------------------------------------------------
// A priority move into the user's own ally (T2M §3.5)
// ------------------------------------------------------------------------------------------------------------------

/**
 * A priority move into the user's own ally (doubles-turn.ts moveFailure): Queenly Majesty, Dazzling and Armor Tail stop only
 * a foe's move (data/abilities.ts onFoeTryMove), Psychic Terrain only a foe's (data/conditions.ts psychicterrain onTryHit:
 * `target.isAlly(source)` returns; guards-probes-3 R1). The kernel's priorityShield reads foes only, and the calculation reads
 * BattleConditions.allyTarget (conditionsFor sets it for an ally target; calculate.ts: neither block, the terrain's power kept),
 * so the move proceeds: nothing here.
 */
export function allyShield(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, priority: number) {
  void kernel; void w; void action; void move; void target; void priority;
}

// ------------------------------------------------------------------------------------------------------------------
// Generation 7's frozen priority (T2M §3.17; USUM)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Generation 7 keeps the priority sorted at the turn's start (no re-sort: sim/battle.ts:2919 needs gen 8; action.move.priority
 * set once, :2649), while the calculation reads Gale Wings at full HP (its build holds no HP). The calculation reads the frozen
 * priority (MoveContext.frozenPriority, frozenContext through contextFor): nothing here. Kept as the hook its caller names.
 */
export function frozenPriority(kernel: TurnKernel, world: World, action: PendingAction, priority: number, resolution: Resolution) {
  void kernel; void world; void action; void priority; void resolution;
}

/**
 * The priority an action's move is used with, for the calculation (MoveContext.frozenPriority; doubles-turn.ts contextFor,
 * kernel line L4), where the calculation would read another: the kernel's priority shields, Quick Guard and the queue read
 * the priority it is used with, while the calculation reads Gale Wings at full HP (its build holds no HP) for the partner
 * shields, the target's own Queenly Majesty, Dazzling and Armor Tail, and Psychic Terrain. Generation 7: the priority the
 * queue sorted at the turn's start, without the fractional part (PS/sim/battle.ts:2641-2649 action.move.priority, no
 * re-sort: T2-GW01-usum), for a Gale Wings user's Flying move or a priority that differs from the one it has now (an ability
 * changed since). Generation 8 on: the one it has now (the queue re-sorts before each action, :2919; a user hit before it
 * moves has no Gale Wings: T2-GW01-sv), for a Gale Wings user's Flying move. Review 2 (R4-4): a called damaging move (Sleep
 * Talk's, Copycat's, Metronome's…: the kernel's useCalled) is used with its caller's priority (useMoveInner: move.priority =
 * activeMove.priority, PS/sim/battle-actions.ts:410-411), which the partner shields (Dazzling: move.priority > 0.1,
 * PS/data/abilities.ts:872) and Psychic Terrain (PS/data/moves.ts:14116-14117) read: PendingAction.calledPriority. Otherwise
 * the queued move only. Undefined otherwise (the context and its memo key stay as they were).
 */
export function frozenContext(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo): number | undefined {
  if (action.calledPriority !== undefined) return action.calledPriority;
  if (action.external || !action.moveId || action.moveId !== kernel.input.pokemon[action.slot]?.action.moveId) return undefined;
  const galeWings = w.mons[action.slot]!.build.abilityId === "galewings" && info.effective.type === "Flying";
  if (!action.frozen) return galeWings ? kernel.priorityOf(w, action) : undefined;
  const frozen = action.frozen.priority - action.fractional;
  return galeWings || frozen !== kernel.priorityOf(w, action) ? frozen : undefined;
}

// ------------------------------------------------------------------------------------------------------------------
// Assurance (T2M §3.18), Sparkling Aria (T2M §3.16)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Assurance (doubles-turn.ts contextFor): its power doubles when the target took damage this turn (PS/data/moves.ts assurance
 * basePowerCallback: target.hurtThisTurn, set by sim/battle.ts spreadDamage for any damage, :2138). MonState.hurt holds it;
 * a target whose own move's step followed its HP (recoil, Life Orb, retaliation, draining) has it from hurt (below), which
 * leaves `ownHP` only where the step's own record cannot tell whether it lost HP: not estimated there alone.
 */
export function assurance(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId): boolean {
  const receiver = w.mons[target]!;
  if (!receiver.hurt && receiver.ownHP) kernel.notEstimated(REASONS.notIn2v2(kernel.moveName(action.moveId!)));
  return receiver.hurt;
}

/**
 * Sparkling Aria with its user gone (doubles-turn.ts sparklingAria): its onAfterMove cures nothing once `source.fainted`
 * (PS/data/moves.ts:17358), which faintMessages sets after the hit loop (sim/battle-actions.ts:976): a user knocked out in the
 * hits (a Rowap Berry, Innards Out, Destiny Bond: MonState.faintedInHits) has fainted; one Life Orb knocks out after them
 * (onAfterMoveSecondarySelf) has not, and its burned targets are cured as with a living user (T2-AR01, T2-AR02). Without a
 * working Life Orb nothing can knock it out after the hits. `cures`: a Pokémon it hit that is cured.
 */
export function ariaFaint(kernel: TurnKernel, w: World, action: PendingAction, hit: DoublesSlotId[], cures: (slot: DoublesSlotId) => boolean) {
  const mon = w.mons[action.slot]!;
  if (mon.faintedInHits || !lifeOrbOn(kernel, w, mon.build) || !hit.some(cures)) return;
  for (const slot of hit) {
    if (!cures(slot)) continue;
    const target = w.mons[slot]!;
    target.build = { ...target.build, status: "" };
    kernel.hitFact(action, slot, `${kernel.moveName("sparklingaria")}: its burn is cured.`, w.mass);
  }
}

/**
 * A spread move's user losses after its hits (doubles-spread.ts spreadStep's last afterLoss; D calls this in its place):
 * `losses[0]` at the Update after the hits (the targets' retaliation: a Rowap Berry; K's Innards Out), the rest after them
 * (Mind Blown's cost, Life Orb). A Sparkling Aria user that the first group knocks out fainted in the hits
 * (MonState.faintedInHits, read by ariaFaint; only with its Life Orb after them). The worlds, as kernel.afterLoss gives them.
 */
export function userLosses(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, losses: (number | number[])[]): World[] {
  const attacker = action.slot;
  if (action.moveId !== "sparklingaria" || info.transformed || losses.length < 2) return kernel.afterLoss(w, attacker, ...losses);
  return kernel.afterLoss(w, attacker, losses[0]).flatMap((world) => {
    if (!kernel.alive(world, attacker)) { world.mons[attacker]!.faintedInHits = true; return [world]; }
    return kernel.afterLoss(world, attacker, ...losses.slice(1));
  });
}

/**
 * After a step's child world (doubles-turn.ts applyStep, before afterHit), three records:
 * - Sparkling Aria's user fainted in the hits (MonState.faintedInHits; only with a Sparkling Aria user): Destiny Bond took it
 *   (hitReactions, after the step: its faint is not the step's own), a Destiny Bond holder the hit knocked out (with
 *   `target`), or the step reports its faint in the hits (outcome.attackerFaintedInHits).
 * - Focus Band's fact on a one-hit move (with `target`): each roll that would knock the holder out does so 9/10 of the time
 *   and leaves 1 HP 1/10, so the mass it saved is a ninth of the knocked-out mass: `Focus Band: {Name} keeps 1 HP.`.
 * - Assurance's hurtThisTurn on the user of a followed step (applyStep marks it `ownHP`): hurt where one of its own-loss
 *   sources dealt damage (ownLoss), and `ownHP` dropped wherever ownLoss can tell.
 * `target` and `before` (kernel line L2): the step's target and the builds as it began; without them only the user's own
 * sources are read.
 */
export function hurt(kernel: TurnKernel, next: World, action: PendingAction, outcome: TurnStepOutcome, info: TurnMoveInfo, follow: boolean,
  target?: DoublesSlotId, before?: { user: BattleBuild; receiver: BattleBuild }) {
  const attacker = action.slot;
  const user = next.mons[attacker];
  if (!user) return;
  if (action.moveId === "sparklingaria" && !info.transformed && user.fainted) {
    const ownFaint = follow && outcome.attackerFainted;
    const bonded = !!target && outcome.knocked && !!next.mons[target]?.destinyBond && kernel.isFoe(attacker, target);
    if (!ownFaint || bonded || outcome.attackerFaintedInHits !== undefined) user.faintedInHits = true;
  }
  if (target && before && outcome.knocked && before.receiver.itemId === "focusband" && kernel.itemWorks(next, before.receiver) && hitsOnce(action, info, before.user)) {
    kernel.hitFact(action, target, `Focus Band: ${kernel.names[target]} keeps 1 HP.`, next.mass / 9);
  }
  if (!follow || !user.ownHP) return;
  const loss = ownLoss(kernel, next, action, outcome, info, target, before);
  if (loss) user.hurt = true;
  if (loss !== null) delete user.ownHP;
}

/** A move of one hit into its target (no multihit, no Parental Bond, no Beat Up; a Z-Move or Max Move has one). */
function hitsOnce(action: PendingAction, info: TurnMoveInfo, user: BattleBuild): boolean {
  if (info.transformed) return true;
  return info.effective.multihit === null && action.moveId !== "beatup" && user.abilityId !== "parentalbond";
}

/**
 * Whether the user of a followed step lost HP in it (pinned spreadDamage sets hurtThisTurn for any damage; each source below is
 * this.damage, which Magic Guard stops for every effect but a Move): true, false, or null where the step's record cannot tell.
 * Its own: recoil (not Rock Head) and Steel Beam's or Chloroblast's cost on damage dealt (sim/battle-actions.ts:982
 * applyRecoilDamage on move.totalDamage; a Substitute's hit deals its recoil through the Substitute: substitute
 * onTryPrimaryHit), Life Orb after any hit (data/items.ts lifeorb onAfterMoveSecondarySelf; not after a Sheer Force move with
 * secondaries; one Pickpocket took first is gone; one Thief or Covet took acts, one Magician takes in the same event does not).
 * The target's, on a hit that reached it (with `target` and `before`): Rough Skin, Iron Barbs and Rocky Helmet on contact, a
 * Jaboca or Rowap Berry it ate (not one Bug Bite, Pluck or Incinerate took first: their onHit comes before DamagingHit),
 * Liquid Ooze on a draining move, Gulp Missile's form, a Wandering Spirit holder that took the user's Rough Skin or Iron Barbs
 * (from the second hit), and on the knocking hit Aftermath (contact, no Damp the user does not break) and Innards Out.
 */
function ownLoss(kernel: TurnKernel, next: World, action: PendingAction, outcome: TurnStepOutcome, info: TurnMoveInfo,
  target?: DoublesSlotId, before?: { user: BattleBuild; receiver: BattleBuild }): boolean | null {
  const attacker = action.slot;
  const now = next.mons[attacker]!.build;
  const was = before?.user ?? null;
  const damaged = outcome.landed > 0, hitAny = outcome.landed + outcome.subHits > 0;
  const guardedNow = now.abilityId === "magicguard";
  const own = ownMoveId(action.moveId!, info);
  if (!guardedNow) {
    if (info.recoil && now.abilityId !== "rockhead" && hitAny) return true;
    if (damaged && SELF_COST_MOVES.has(own)) return true;
    const sheerForce = (was ?? now).abilityId === "sheerforce" && info.secondaries;
    if (hitAny && !sheerForce && now.itemId === "lifeorb" && kernel.itemWorks(next, now)) {
      if (was ? was.itemId === "lifeorb" || own === "thief" || own === "covet" : now.abilityId !== "magician") return true;
      if (!was) return null;
    }
  }
  if (!target || !before) return null;
  const guardedBefore = before.user.abilityId === "magicguard";
  // Magic Guard throughout stops every source; one the hits replaced (Mummy, Lingering Aroma, Wandering Spirit) leaves their order open.
  if (guardedBefore && guardedNow) return false;
  if (!damaged) return false;
  const foe = before.receiver;
  const foeItem = kernel.itemWorks(next, foe) ? foe.itemId : "";
  const ate = (berry: string) => foeItem === berry && next.mons[target]!.build.itemId !== berry && !["bugbite", "pluck", "incinerate"].includes(own);
  const sources = [
    info.contact && (foe.abilityId === "roughskin" || foe.abilityId === "ironbarbs"),
    info.contact && foeItem === "rockyhelmet",
    ate("jabocaberry") || ate("rowapberry"),
    info.drain && foe.abilityId === "liquidooze" && !next.mons[attacker]!.eot.healBlock,
    gulpingTarget({ speciesId: foe.speciesId, abilityId: foe.abilityId, transformed: !!foe.transformedFrom }),
    info.contact && foe.abilityId === "wanderingspirit" && ["roughskin", "ironbarbs"].includes(before.user.abilityId) && outcome.landed > 1,
    outcome.knocked && info.contact && foe.abilityId === "aftermath" && !damp(kernel, next, attacker, before.user),
    outcome.knocked && foe.abilityId === "innardsout",
  ];
  if (!sources.some(Boolean)) return false;
  return guardedBefore === guardedNow ? true : null;
}

/** A living Damp holder stops Aftermath (data/abilities.ts damp onAnyDamage), unless the user's Mold Breaker breaks it (no Ability Shield). */
function damp(kernel: TurnKernel, w: World, attacker: DoublesSlotId, user: BattleBuild): boolean {
  return (["own-left", "own-right", "opponent-left", "opponent-right"] as const).some((slot) => {
    if (!kernel.alive(w, slot) || w.mons[slot]!.build.abilityId !== "damp") return false;
    const shielded = w.mons[slot]!.build.itemId === "abilityshield" && !w.field.magicRoom;
    return slot === attacker || shielded || !MOLD_BREAKERS.has(user.abilityId);
  });
}

// ------------------------------------------------------------------------------------------------------------------
// Safeguard (T2M §3.27)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Safeguard against a damaging move's status (doubles-status.ts afterHit): the step reads the target side's Safeguard
 * (stepEnv's safeguard; set this turn or from an earlier turn), so no status it keeps off reaches the target: nothing here.
 */
export function safeguard(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo) {
  void kernel; void w; void action; void target; void info;
}
