// SPEC 10.6 scoring: V(S) = the AI's side minus the player's, every term computed the same way for both sides; addendum
// A1.5's Mega lasting value and the option value of keeping it. M[a][b] = E[V(S′_ab)] (a constant offset does not change
// the solution).
import { turnSpeed } from "@/app/lib/battle/calculate";
import { DOUBLES_SLOTS, slotSide, type DoublesSideId } from "@/app/lib/battle/doubles-types";
import { createConditions } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";
import type { AiView, CellActions, MonKey, PostMon, PostState } from "../model/ai-view";
import { isProtectMove, megaFormFor } from "./battle-facts";
import { RESIST_BERRY } from "./belief/items";
import { bestMoveOf, favorOf } from "./field-favor";
import type { MegaOutlook } from "./mega";
import type { RowTable } from "./rows";
import { DEFAULT_WEIGHTS, type Weights } from "./value-weights";

export { DEFAULT_WEIGHTS, type Weights } from "./value-weights";

export type ValueContext = {
  weights: Weights; worth: Record<MonKey, number>; runtime: BattleRuntime; field: BattleConditions; rows: RowTable;
  /** The player's revealed members' builds in each belief world (AiView.particles): the Speed term averages them. */
  particles: AiView["particles"];
  /** The decision's view: Protect streaks, moves, unseen members, which side had Mega Evolved before the turn. */
  view?: AiView;
  /** A1.5: the decision's Mega outlook (ai/mega.ts megaOutlook) for the lasting and option values. */
  mega?: MegaOutlook;
  /** The pairing being valued: a Choice lock comes from the move each Pokémon used. */
  cell?: CellActions;
};
export type ValueTerms = {
  material: number; terminal: number; speed: number; field: number; status: number; volatiles: number; stages: number; items: number;
  /** A1.5: a Mega Evolution of this turn's lasting value (less megaReveal), and the option value of a Mega kept. */
  megaLasting: number; megaKeep: number;
  protect: number; hazards: number;
  /** Choice item holders locked into a status or protecting move. */
  lock: number;
  total: number;
};

const SIGN: Record<DoublesSideId, number> = { opponent: 1, own: -1 };
/** Items that lock the holder into the move it used (isChoice: PS/data/items.ts:979, 1002, 1026). */
const CHOICE_ITEMS: ReadonlySet<string> = new Set(["choiceband", "choicescarf", "choicespecs"]);
/** Status, volatile and stage terms of one Pokémon together reach at most this share of its HP utility (scripts/.cache/training/review-ai/value-ko-probe.out). */
const EXTRA_CAP = 0.8;
const alivePart = (mon: PostMon) => mon.hp.reduce((sum, entry) => sum + (entry.hp > 0 ? entry.chance : 0), 0);
const hpPart = (mon: PostMon) => mon.hp.reduce((sum, entry) => sum + entry.chance * Math.max(0, entry.hp) / Math.max(1, mon.maxHp), 0);
const worthOf = (ctx: ValueContext, mon: PostMon) => mon.known ? ctx.worth[mon.key] ?? ctx.weights.unknownWorth : ctx.weights.unknownWorth;
const movesOf = (ctx: ValueContext, key: MonKey) => ctx.view?.mons.find((mon) => mon.key === key)?.moves ?? [];

/** g(s) = sign(s)·Σ_{k=1..|s|} stageDecay^(k−1) (SPEC 10.6 Stages). */
function stageValue(stage: number | null | undefined, decay: number): number {
  const s = stage ?? 0;
  let total = 0;
  for (let k = 1; k <= Math.abs(s); k++) total += decay ** (k - 1);
  return Math.sign(s) * total;
}

const SPEED_CACHE = new Map<string, number>();
/** turnSpeed, memoised by everything it reads (the cache is bounded). */
function speedOf(build: BattleBuild, tailwind: boolean, conditions: BattleConditions, runtime: BattleRuntime): number {
  const key = JSON.stringify([runtime.identity, build.speciesId, build.nature, build.game === "champions" ? build.points : build.native, build.boosts.spe, build.status, build.itemId, build.abilityId, build.abilityActive, tailwind, conditions.weather, conditions.terrain]);
  let speed = SPEED_CACHE.get(key);
  if (speed === undefined) {
    speed = turnSpeed(build, tailwind, conditions, runtime);
    if (SPEED_CACHE.size > 20_000) SPEED_CACHE.clear();
    SPEED_CACHE.set(key, speed);
  }
  return speed;
}
/** A particle's believed set (points, nature, item, ability) on the post-turn build (stages, status, form; an item used stays used). */
function inParticle(post: BattleBuild, particle: BattleBuild): BattleBuild {
  const formChanged = post.speciesId !== particle.speciesId;
  const merged = { ...post, nature: particle.nature, itemId: post.itemId === "" ? "" : particle.itemId, abilityId: formChanged ? post.abilityId : particle.abilityId };
  return merged.game === "champions" && particle.game === "champions" ? { ...merged, points: { ...particle.points } } : merged;
}

/**
 * Speed (SPEC 10.6): for t = 1..speedHorizon, Tailwind on a side while clock.tailwind ≥ t and Trick Room while
 * clock.rooms.trickRoom ≥ t; SA_t = Σ w·s_ij / Σ w over the known pairs alive at the decision (i the AI's, j the player's),
 * w = worth_i·worth_j × benchSpeedShare per benched one, s_ij = P(both alive)·sign(s_i − s_j)·(Trick Room ? −1 : 1) + P(only
 * i alive) − P(only j alive); the player's s_j averaged over the belief particles. speed · Σ decay^(t−1) SA_t / Σ decay^(t−1).
 */
function speedTerm(post: PostState, ctx: ValueContext): number {
  const { weights, runtime } = ctx;
  const base: BattleConditions = { ...createConditions(), ...ctx.field, gameType: "Doubles", trickRoom: false, weather: post.clock.weather?.id ?? "", terrain: post.clock.terrain?.id ?? "" };
  const ai = post.mons.filter((mon) => mon.side === "opponent" && mon.known);
  const player = post.mons.filter((mon) => mon.side === "own" && mon.known);
  const particles = ctx.particles.length ? ctx.particles : [{ weight: 1, builds: {} }];
  const aliveBefore = (key: MonKey) => { const mon = ctx.view?.mons.find((each) => each.key === key); return !mon || (!mon.fainted && mon.hp > 0); };
  const totalParticle = particles.reduce((sum, particle) => sum + particle.weight, 0) || 1;
  let sum = 0, norm = 0;
  for (let t = 1; t <= weights.speedHorizon; t++) {
    const decay = weights.speedDecay ** (t - 1);
    norm += decay;
    const trickRoom = post.clock.rooms.trickRoom >= t;
    const tail = (side: DoublesSideId) => post.clock.sides[side].tailwind >= t;
    let numerator = 0, denominator = 0;
    for (const i of ai) {
      if (!aliveBefore(i.key)) continue;
      const ai_ = alivePart(i);
      const si = speedOf(i.build, tail("opponent"), base, runtime);
      for (const j of player) {
        if (!aliveBefore(j.key)) continue;
        const aj = alivePart(j);
        const w = worthOf(ctx, i) * worthOf(ctx, j) * (i.slot === null ? weights.benchSpeedShare : 1) * (j.slot === null ? weights.benchSpeedShare : 1);
        let sign = 0;
        if (ai_ > 0 && aj > 0) {
          for (const particle of particles) {
            const believed = particle.builds[j.key];
            const sj = speedOf(believed ? inParticle(j.build, believed) : j.build, tail("own"), base, runtime);
            sign += particle.weight * Math.sign(si - sj);
          }
        }
        // Every pair alive at the decision keeps its weight; a pair with a fainted side counts for the survivor (+1 for
        // the AI when the player's Pokémon fainted, −1 when its own did), so a KO never lowers its side's Speed term.
        numerator += w * (ai_ * aj * (sign / totalParticle) * (trickRoom ? -1 : 1) + ai_ * (1 - aj) - (1 - ai_) * aj);
        denominator += w;
      }
    }
    sum += decay * (denominator > 0 ? numerator / denominator : 0);
  }
  return norm > 0 ? weights.speed * sum / norm : 0;
}

/** SPEC 10.6 Status, × worth × u (stateTerms): Guts and Magic Guard / Poison Heal holders read their own rules. */
function statusOf(mon: PostMon, ctx: ValueContext): number {
  const { weights, runtime } = ctx;
  const ability = mon.build.abilityId;
  switch (mon.build.status) {
    case "brn": {
      if (ability === "guts") return 0;
      const best = bestMoveOf(movesOf(ctx, mon.key), mon.build, runtime);
      return -(best?.category === "Physical" ? weights.burnPhysical : weights.burnSpecial);
    }
    case "par": return -weights.paralysis;
    case "slp": return -weights.sleepPerTurn * (mon.sleepTurns ?? 1.67);
    case "frz": return -weights.freeze;
    case "psn": return ability === "poisonheal" ? weights.poison : ability === "magicguard" ? 0 : -weights.poison;
    case "tox": return ability === "poisonheal" ? weights.toxic : ability === "magicguard" ? 0 : -weights.toxic;
    default: return 0;
  }
}
/** SPEC 10.6 Volatiles (rollouts carry them), × worth. */
function volatilesOf(mon: PostMon, ctx: ValueContext): number {
  const { weights, runtime } = ctx;
  let total = 0;
  for (const id of mon.volatiles) {
    if (id === "confusion") total -= weights.confusion;
    else if (id === "taunt" && movesOf(ctx, mon.key).some((move) => runtime.movesById.get(move)?.category === "Status")) total -= weights.taunt;
    else if (id === "encore") total -= weights.encore;
    else if (id === "yawn") total -= weights.yawn;
    else if (id === "leechseed") total -= weights.leechSeed;
    else if (id === "substitute") total += weights.substitute;
    else if (id === "perishsong") total -= weights.perishSong / Math.max(1, mon.perishCount ?? 3);
  }
  return total;
}
/** SPEC 10.6 Stages (actives), × worth: offenseStage·g(Atk or SpA by the best move) + defenseStage·(g(Def)+g(SpD))/2. */
function stagesOf(mon: PostMon, ctx: ValueContext): number {
  if (mon.slot === null) return 0;
  const { weights, runtime } = ctx;
  const best = bestMoveOf(movesOf(ctx, mon.key), mon.build, runtime);
  const offense = stageValue(best?.category === "Special" ? mon.build.boosts.spa : mon.build.boosts.atk, weights.stageDecay);
  const defense = (stageValue(mon.build.boosts.def, weights.stageDecay) + stageValue(mon.build.boosts.spd, weights.stageDecay)) / 2;
  return weights.offenseStage * offense + weights.defenseStage * defense;
}
const RESIST_BERRIES = new Set(Object.values(RESIST_BERRY));
/** SPEC 10.6 Items, × worth: Focus Sash at full HP; a Sitrus or resist Berry still held. */
function itemsOf(mon: PostMon, ctx: ValueContext): number {
  const { weights } = ctx;
  const item = mon.build.itemId;
  if (item === "focussash") return weights.focusSash * mon.hp.reduce((sum, entry) => sum + (entry.hp >= mon.maxHp ? entry.chance : 0), 0);
  if (item === "sitrusberry" || RESIST_BERRIES.has(item)) return weights.berry;
  return 0;
}

/**
 * A1.5 Mega terms for one side:
 * - lasting: a Pokémon of the side in the Mega form the outlook gives it (it Mega Evolved this turn) adds
 *   megaLasting × the form's gain × P(alive), less megaReveal;
 * - keep: with the side's Mega unused, megaOption × the largest gain × P(alive) × (½ + ½·expected HP) among the living
 *   members that can still Mega Evolve (the risk the holder faints before it can), plus megaAvailable when two or more can
 *   (the choice of which one; with a single holder the option value is the whole of it, so a Mega now that gains is not
 *   outweighed by a flat bonus for keeping it: scripts/.cache/training/build/ai2/position-R1-charizard-y-double-ko.out).
 */
function megaTerms(post: PostState, side: DoublesSideId, ctx: ValueContext): { lasting: number; keep: number } {
  const { weights } = ctx;
  const outlook = ctx.mega ?? {};
  const mons = post.mons.filter((mon) => mon.side === side);
  if (post.megaUsed[side]) {
    if (ctx.view?.megaUsed[side]) return { lasting: 0, keep: 0 };
    const evolved = mons.find((mon) => outlook[mon.key] && mon.build.speciesId === outlook[mon.key].formId);
    if (!evolved) return { lasting: 0, keep: 0 };
    return { lasting: weights.megaLasting * outlook[evolved.key].gain * alivePart(evolved) - weights.megaReveal, keep: 0 };
  }
  let holders = 0, best = 0;
  for (const mon of mons) {
    const entry = outlook[mon.key];
    const canMega = entry ? mon.build.speciesId !== entry.formId : megaFormFor(mon.build.speciesId, mon.build.itemId, ctx.runtime) !== null;
    if (!canMega || alivePart(mon) <= 0) continue;
    holders++;
    if (entry) best = Math.max(best, entry.gain * alivePart(mon) * (0.5 + 0.5 * hpPart(mon)));
  }
  return { lasting: 0, keep: holders ? (holders > 1 ? weights.megaAvailable : 0) + weights.megaOption * best : 0 };
}

/** Every SPEC 10.6 term of V(post) (AI side minus player side) and their total. */
export function stateTerms(post: PostState, ctx: ValueContext): ValueTerms {
  const { weights, runtime } = ctx;
  const terms: ValueTerms = { material: 0, terminal: 0, speed: 0, field: 0, status: 0, volatiles: 0, stages: 0, items: 0, megaLasting: 0, megaKeep: 0, protect: 0, hazards: 0, lock: 0, total: 0 };
  const u = (mon: PostMon) => mon.hp.reduce((sum, entry) => sum + entry.chance * (entry.hp <= 0 ? 0 : weights.alive + (1 - weights.alive) * Math.min(1, entry.hp / Math.max(1, mon.maxHp))), 0);
  let unseenInPost = 0;
  for (const mon of post.mons) {
    const sign = SIGN[mon.side];
    const worth = worthOf(ctx, mon);
    const alive = alivePart(mon);
    terms.material += sign * worth * u(mon);
    if (!mon.known) { unseenInPost++; continue; }
    if (alive <= 0) continue;
    // Field: the weather and the terrain each by the turns they have left (a strong weather's null: 3), at most 3.
    const weather = post.clock.weather, terrain = post.clock.terrain;
    if (weather?.id) terms.field += sign * worth * alive * favorOf(movesOf(ctx, mon.key), mon.build, { weather: weather.id }, runtime) * Math.min(weather.turns ?? 3, 3) / 3 * weights.field;
    if (terrain?.id) terms.field += sign * worth * alive * favorOf(movesOf(ctx, mon.key), mon.build, { terrain: terrain.id }, runtime) * Math.min(terrain.turns, 3) / 3 * weights.field;
    // Status, volatiles and stages scale with the HP utility u (not P(alive)) and together stay within 0.8·u, so a KO
    // always gains more than the material a crippled foe still holds.
    const um = u(mon);
    const status = statusOf(mon, ctx), volatiles = volatilesOf(mon, ctx), stages = stagesOf(mon, ctx);
    const extra = Math.abs(status + volatiles + stages);
    const scale = extra > EXTRA_CAP ? EXTRA_CAP / extra : 1;
    terms.status += sign * worth * um * scale * status;
    terms.volatiles += sign * worth * um * scale * volatiles;
    terms.stages += sign * worth * um * scale * stages;
    terms.items += sign * worth * alive * itemsOf(mon, ctx);
    if (mon.protected) {
      const streak = ctx.view?.mons.find((each) => each.key === mon.key)?.protectStreak ?? 0;
      terms.protect -= sign * weights.protectStreak * (streak + 1);
    }
  }
  // Unseen members the post state leaves out are unchanged: each adds unknownWorth (consistent across engine and rollout cells).
  if (ctx.view) terms.material -= Math.max(0, ctx.view.hidden.unrevealed - unseenInPost) * weights.unknownWorth;
  terms.terminal = weights.win * (post.wiped.own - post.wiped.opponent);
  // Choice lock: a holder that used a status or protecting move from the slot it still holds stays locked into it.
  if (ctx.cell && ctx.view) {
    for (const slot of DOUBLES_SLOTS) {
      const action = (slotSide(slot) === "own" ? ctx.cell.own : ctx.cell.opponent)[slot];
      if (action?.kind !== "move") continue;
      const move = runtime.movesById.get(action.moveId);
      if (!move || (move.category !== "Status" && !isProtectMove(move.id))) continue;
      const before = ctx.view.mons.find((mon) => mon.slot === slot && !mon.fainted);
      const after = before ? post.mons.find((mon) => mon.key === before.key) : undefined;
      if (!after || after.slot !== slot || !CHOICE_ITEMS.has(after.build.itemId)) continue;
      terms.lock -= SIGN[after.side] * worthOf(ctx, after) * u(after) * weights.choiceLock;
    }
  }
  terms.speed = speedTerm(post, ctx);
  for (const side of ["opponent", "own"] as const) {
    const mega = megaTerms(post, side, ctx);
    terms.megaLasting += SIGN[side] * mega.lasting;
    terms.megaKeep += SIGN[side] * mega.keep;
    const clock = post.clock.sides[side];
    const layers = (clock.stealthRock ? 1 : 0) + clock.spikes + clock.toxicSpikes + (clock.stickyWeb ? 1 : 0);
    const bench = post.mons.some((mon) => mon.side === side && mon.slot === null && alivePart(mon) > 0);
    if (layers && bench) terms.hazards -= SIGN[side] * weights.hazard * layers;
  }
  terms.total = terms.material + terms.terminal + terms.speed + terms.field + terms.status + terms.volatiles + terms.stages + terms.items
    + terms.megaLasting + terms.megaKeep + terms.protect + terms.hazards + terms.lock;
  return terms;
}

/** V(post), SPEC 10.6. */
export function stateValue(post: PostState, ctx: ValueContext): number {
  return stateTerms(post, ctx).total;
}

/** A value context with SPEC's default weights overridden by `weights`. */
export function valueWeights(weights?: Partial<Weights>): Weights {
  return { ...DEFAULT_WEIGHTS, ...weights };
}
