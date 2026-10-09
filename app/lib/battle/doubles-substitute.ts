import { getBerryResistType } from "@smogon/calc/dist/items";
import { BUSTED_FORMS, REASONS, RESIST_BERRIES } from "./doubles-actions";
import type { DoublesSlotId } from "./doubles-types";
import { cloneWorld, condition, mapHP, marginal, type PendingAction, type World } from "./doubles-world";
import type { HitCheck, SearchEntry, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import { ownMoveId, startHits, subHit, type HitLoopInput, type SubCost } from "./hit-loop";
import { Z_MOVE_EFFECTS } from "./stat-moves";
import { itemTakeable, type TurnCase, type UsesSearch } from "./uses-to-ko";
import type { BattleBuild, ChampionsMove, MoveDamageResult } from "./types";

// Damaging hits into a Substitute (status-eot ADDENDUM §4.13): Track E's file. MonState.vol.substitute holds its HP;
// doubles-turn.ts asks `single` (singleStep) and `plan` (spreadStep) before each target's calculation, and the kernel
// gives searchFor's behindSubstitute calculation (the target's resist Berry as Leftovers, an intact Disguise or Ice Face
// as no ability), applyStep's part (uses-to-ko.ts TurnStepPart) and subStat (DoublesHit.substitute). Pinned Showdown
// c23d2e94: data/moves.ts:18325-18376 (substitute condition), sim/battle-actions.ts:940-1000 (hitStepMoveHitLoop).
//
// Each hit of the move meets the Substitute while it stands (onTryPrimaryHit returns HIT_SUBSTITUTE): the damage is
// capped at its HP, and from the hit after it breaks the move's hits reach the Pokémon (a multi-hit move continues).
// The walk below is the prefix over every roll of each case (turnCases): equal (case, hits into the Substitute, HP left)
// merge. Each class is one world, its Substitute's HP set, the attacker's HP through the prefix's recoil, drain and
// self-cost (hit-loop.ts subHit), then the pair's step with that part (applyStep), which runs the user's per-use effects
// and, for the hits after the break, the full pair machinery.

/** A spread move's hit into one target's Substitute (spreadStep): applied to each world in the target's place in the hit order. */
export type SubPlan = { apply: (world: World) => World[] };

/** Damaging moves without the sound flag that pass a Substitute (pinned Showdown flags.bypasssub; tests/source/doubles-substitute-census.test.ts). */
export const PASSING_MOVES: ReadonlySet<string> = new Set(["hyperspacefury", "hyperspacehole", "spectralthief"]);

/**
 * The target's effects the engine's per-hit damages read as if each earlier hit had reached the Pokémon (ADDENDUM §4.13.6:
 * @smogon/calc mechanics/util.js checkMultihitBoost and the hitCount === 0 terms of calculateFinalModsSMSSSV, less the
 * Parental Bond-only Gooey and Tangling Hair and the items calculate.ts withholds between hits, AFTER_MOVE_ITEMS: Kee
 * Berry, Maranga Berry, White Herb). Behind a Substitute none of them fires (no DamagingHit; the Pokémon keeps its HP and
 * its Berry), so a multi-hit move's values after the first hit are not the engine's: not estimated (REASONS.subPerHit).
 * `contact`: only on a contact move (the ability swap). An intact Disguise or Ice Face has its own reason (faceMultiHit).
 */
export const SUB_PER_HIT = {
  abilities: ["multiscale", "shadowshield", "stamina", "watercompaction", "weakarmor", "seedsower", "sandspit"],
  contact: ["mummy", "lingeringaroma", "wanderingspirit"],
  items: [...RESIST_BERRIES, "luminousmoss"],
} as const;
const PER_HIT_ABILITIES: ReadonlySet<string> = new Set(SUB_PER_HIT.abilities);
const PER_HIT_CONTACT: ReadonlySet<string> = new Set(SUB_PER_HIT.contact);

/**
 * Whether the hit meets a Substitute (PS/data/moves.ts:18342-18343): the target has one in this world, the attacker is
 * not the target, the move has no bypasssub flag (sound moves have it) and the attacker's ability in effect is not
 * Infiltrator (PS/data/abilities.ts:2133 move.infiltrates).
 */
function meets(w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId): boolean {
  if (target === action.slot || !w.mons[target]?.vol.substitute) return false;
  return meetsSubstitute(w.mons[action.slot]!.build, info);
}

/** Whether a move from `user` meets a Substitute standing in front of its target (not a sound or bypasssub move, no Infiltrator). */
export function meetsSubstitute(user: BattleBuild, info: TurnMoveInfo): boolean {
  if (info.flags.sound || (PASSING_MOVES.has(info.effective.id) && !info.transformed)) return false;
  return user.abilityId !== "infiltrator";
}

/**
 * The narrow guards (ADDENDUM §4.13.2, REASONS.intoSubstitute): Max Moves (their user and foe effects on a Pokémon
 * behind a Substitute, U16c), a signature Z-Move with an effect of its own (Z_MOVE_EFFECTS: Genesis Supernova's terrain
 * from a self secondary, Splintered Stormshards' onAfterSubDamage, Clangorous Soulblaze), Mind Blown (one cost per
 * Substitute hit and one after the hits, U17), and Magician when the attacker holds nothing and the target holds an item
 * it could take (it reads move.hitTargets, which a hit into a Substitute keeps: U15). Parental Bond is checked on the
 * cases (hitInto: a move it doubles has more than one hit there).
 */
function narrowGuards(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, entry: SearchEntry) {
  if (info.isMax) kernel.notEstimated(REASONS.intoSubstitute("Max Moves"));
  if (info.isZ && Z_MOVE_EFFECTS[info.effective.name]) kernel.notEstimated(REASONS.intoSubstitute(info.effective.name));
  if (!info.transformed && action.moveId === "mindblown") kernel.notEstimated(REASONS.intoSubstitute(kernel.moveName("mindblown")));
  const user = w.mons[action.slot]!.build, holder = w.mons[target]!.build;
  if (user.abilityId === "magician" && !user.itemId && holder.itemId && entry.search) {
    const species = (build: typeof user) => build.transformedFrom?.speciesId ?? build.speciesId;
    if (itemTakeable(kernel.runtime, entry.search.m.helpers.paradox, holder.itemId, species(holder), species(user), false)) {
      kernel.notEstimated(REASONS.intoSubstitute(kernel.abilityName("magician")));
    }
  }
}

/**
 * A single-target hit into a Substitute (doubles-turn.ts singleStep, after the block check and Final Gambit's split), or
 * null when the hit does not meet one (or deals no damage: the type immunity and TryHit come first, sim/battle-actions.ts
 * trySpreadMoveHit, so it is today's no-damage hit).
 */
export function single(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, check: HitCheck, attackerHP?: number): World[] | null {
  const target = check.slot;
  if (!meets(w, action, info, target)) return null;
  const move = kernel.runtime.movesById.get(action.moveId!)!;
  const conditions = kernel.conditionsFor(w, action.slot, target, false, move.id);
  const context = kernel.contextFor(w, action, target, info);
  const entry = kernel.searchFor(w, action.slot, target, move.id, conditions, context, false, attackerHP, { behindSubstitute: true });
  if (entry.row.kind !== "calculated") kernel.notEstimated(kernel.rowReason(w, target, entry.row, move));
  if (!entry.search) return null;
  narrowGuards(kernel, w, action, info, target, entry);
  return hitInto(kernel, w, action, info, target, entry, false, attackerHP);
}

/**
 * A spread move's hit into a Substitute (doubles-turn.ts spreadStep's plans, after the block check), or null when it does
 * not meet one or deals no damage. The calculation is from the world before the move, with the spread modifier while
 * more than one target was in place (`multiple`; U5); the attacker's state joins world.spread like the other targets',
 * and its Life Orb stays spreadStep's, once per move.
 */
export function plan(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, check: HitCheck, multiple: boolean, attackerHP?: number): SubPlan | null {
  const target = check.slot;
  if (!meets(w, action, info, target)) return null;
  const move = kernel.runtime.movesById.get(action.moveId!)!;
  const conditions = kernel.conditionsFor(w, action.slot, target, multiple, move.id);
  const entry = kernel.searchFor(w, action.slot, target, move.id, conditions, kernel.contextFor(w, action, target, info), true, attackerHP, { behindSubstitute: true });
  if (entry.row.kind !== "calculated") kernel.notEstimated(kernel.rowReason(w, target, entry.row, move));
  if (!entry.search) return null;
  narrowGuards(kernel, w, action, info, target, entry);
  return { apply: (world) => hitInto(kernel, world, action, info, target, entry, true, attackerHP) };
}

/** The world split by a key of `slot`'s HP: one world per key with an HP of it (the first met), or `w` itself for one key. */
function byClass(w: World, slot: DoublesSlotId, key: (hp: number) => string): { world: World; hp: number }[] {
  const firsts = new Map<string, number>();
  for (const hp of marginal(w, slot).keys()) { const at = key(hp); if (!firsts.has(at)) firsts.set(at, hp); }
  if (firsts.size === 1) return [{ world: w, hp: firsts.values().next().value! }];
  return [...firsts].flatMap(([at, hp]) => condition(w, slot, (value) => key(value) === at).filter(({ meets: inside }) => inside).map(({ world }) => ({ world, hp })));
}

/** One class of the prefix walk (§4.13.5): case `caseIndex`, its first `skip` hits into the Substitute, `left` HP after them, and its share of the part. */
export type SubClass = { caseIndex: number; skip: number; left: number; mass: number };

/**
 * The prefix over every roll (ADDENDUM §4.13.5): for each case of the run, the hits h = 0, 1, … meet the Substitute with
 * `s` HP (start `start`): taken = min(value, s), s −= taken; at s = 0 it breaks and the case's later hits continue into
 * the Pokémon (skip h + 1); a case whose hits all met it ends with s > 0 (skip = its hit count). Mass = the case's chance ×
 * the rolls' weights; equal (case, skip, s) merge. (The attacker's HP through the prefix is the caller's: only a one-hit
 * case can change it, §3.6.)
 */
export function subPrefix(cases: readonly TurnCase[], start: number): SubClass[] {
  const out = new Map<string, SubClass>();
  const add = (caseIndex: number, skip: number, left: number, mass: number) => {
    if (mass <= 0) return;
    const key = `${caseIndex},${skip},${left}`;
    const known = out.get(key);
    if (known) known.mass += mass; else out.set(key, { caseIndex, skip, left, mass });
  };
  cases.forEach((useCase, caseIndex) => {
    let standing = new Map<number, number>([[start, useCase.chance]]);
    for (let hit = 0; hit < useCase.hits.length && standing.size; hit++) {
      const { values, weights } = useCase.hits[hit];
      const next = new Map<number, number>();
      for (const [left, mass] of standing) {
        for (let roll = 0; roll < values.length; roll++) {
          const after = left - Math.min(values[roll], left);
          const share = mass * weights[roll];
          if (after <= 0) add(caseIndex, hit + 1, 0, share);
          else next.set(after, (next.get(after) ?? 0) + share);
        }
      }
      standing = next;
    }
    for (const [left, mass] of standing) add(caseIndex, useCase.hits.length, left, mass);
  });
  return [...out.values()];
}

/** What the prefix's hit costs the attacker (hit-loop.ts SubCost): Steel Beam's and Chloroblast's half, else the engine move's recoil. */
function costOf(search: UsesSearch, info: TurnMoveInfo, moveId: string): SubCost {
  const own = ownMoveId(moveId, info);
  if (own === "steelbeam" || own === "chloroblast") return { half: own };
  const recoil = (search.result.move as { recoil?: [number, number] }).recoil;
  return recoil ? { recoil } : null;
}

/** The attacker as one hit into a Substitute reads it (hit-loop.ts HitLoopInput), from the pair's matchup (abilities in effect, items that work). */
function loopOf(kernel: TurnKernel, search: UsesSearch, attacker: DoublesSlotId, hp: number): HitLoopInput {
  const { m } = search;
  return {
    hp, maxHP: kernel.hp[attacker].maxHP, baseMaxHP: kernel.hp[attacker].baseMaxHP,
    attackerAbility: m.attAbility, attackerItem: m.attItemOn ? m.attacker.itemId : "",
    targetAbility: m.defAbility, targetItem: m.defItemOn ? m.defender.itemId : "",
    attackerShielded: false, targetShielded: false, targetDynamaxed: false, contact: false, category: "Physical",
    drain: (search.result.move as { drain?: [number, number] }).drain ?? null, takesBerry: false, targetGulping: false,
    generation: m.runtime.profile.generation, ...(m.unnerve ? { unnerve: m.unnerve } : {}),
  };
}

/**
 * The multi-hit guard (ADDENDUM §4.13.6, SUB_PER_HIT): a case with more than one hit meets a Substitute in front of an
 * effect the engine's per-hit damages read as if each earlier hit had reached the Pokémon. Abilities in effect (a
 * breaker passes the breakable Multiscale; Multiscale and Shadow Shield only at full HP, `fullHP`; Water Compaction on a
 * Water move; Weak Armor on a physical one; the ability swaps on contact), working items (a resist Berry for the move's
 * type, Chilan for Normal; Luminous Moss on a Water move), and an intact Disguise or Ice Face (faceMultiHit; Ice Face on a
 * physical move; a breaker passes both).
 */
function perHitGuard(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, entry: SearchEntry, fullHP: boolean) {
  const holder = w.mons[target]!.build;
  const type = entry.row.effectiveType ?? info.effective.type;
  const physical = (entry.row.effectiveCategory ?? info.effective.category) === "Physical";
  const broken = kernel.breaks(w, action.slot, target, info);
  const ability = holder.abilityId;
  const name = kernel.names[target];
  const moveName = kernel.moveName(action.moveId!);
  const face = BUSTED_FORMS[holder.speciesId] && (ability === "disguise" || (ability === "iceface" && physical));
  if (face && !broken) kernel.notEstimated(REASONS.faceMultiHit(kernel.abilityName(ability)));
  const reads = PER_HIT_ABILITIES.has(ability) && ({
    multiscale: fullHP && !broken, shadowshield: fullHP, watercompaction: type === "Water", weakarmor: physical,
  } as Record<string, boolean>)[ability] !== false;
  if (reads || (PER_HIT_CONTACT.has(ability) && info.contact)) kernel.notEstimated(REASONS.subPerHit(moveName, name, kernel.abilityName(ability)));
  const item = kernel.itemWorks(w, holder) ? holder.itemId : "";
  const resisted = RESIST_BERRIES.has(item) && (item === "chilanberry" ? type === "Normal" : getBerryResistType(kernel.itemName(item) as never) === type);
  if (resisted || (item === "luminousmoss" && type === "Water")) kernel.notEstimated(REASONS.subPerHit(moveName, name, kernel.itemName(item)));
}

/**
 * The hit into `target`'s Substitute in one world (ADDENDUM §4.13.3-8): the world split by the parts of the target's HP
 * the damage reads (and of the attacker's, where it reads that), the prefix walk of each part's cases, and per class the
 * Substitute's HP, the attacker through the prefix, and the pair's step with its part. `spread`: a spread move's target
 * (the attacker's state for spreadStep; no faint batch or Final Gambit here).
 */
function hitInto(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, entry: SearchEntry, spread: boolean, attackerHP?: number): World[] {
  const attacker = action.slot;
  const move = kernel.runtime.movesById.get(action.moveId!)!;
  const search = entry.search!;
  const reads = search.readsAttackerHP() && attackerHP === undefined && entry.follow;
  const parts = byClass(w, target, (hp) => search.targetHPClass(hp)).flatMap(({ world, hp: t }) => reads
    ? byClass(world, attacker, (hp) => search.attackerHPClass(hp)).map(({ world: each, hp: x }) => ({ world: each, x, t }))
    : [{ world, x: search.initial.att.hp, t }]);
  const out: World[] = [];
  for (const part of parts) {
    const cases = search.turnCases(part.x, part.t, kernel.mode);
    if ("failed" in cases) kernel.notEstimated(cases.failed);
    const multi = cases.some((useCase) => useCase.hits.length > 1);
    // Parental Bond's second hit (×0.25) and its self effects per hit (U16; a move it doubles has one hit of its own).
    if (multi && move.multihit === null && w.mons[attacker]!.build.abilityId === "parentalbond") kernel.notEstimated(REASONS.intoSubstitute(kernel.abilityName("parentalbond")));
    if (multi) {
      perHitGuard(kernel, part.world, action, info, target, entry, part.t >= kernel.hp[target].maxHP);
      // A hit after the break can meet a Focus Band (doubles-turn.ts focusBandGuard).
      kernel.focusBandGuard(part.world, target, entry.row);
    }
    const cost = costOf(search, info, move.id);
    const drains = !!(search.result.move as { drain?: unknown }).drain;
    // No catalog move has a hit count above one with recoil, drain or a self-cost (tests/source/doubles-substitute-census.test.ts).
    if (multi && (cost || drains)) kernel.notEstimated(REASONS.intoSubstitute(move.name));
    const start = part.world.mons[target]!.vol.substitute!;
    const classes = subPrefix(cases, start);
    if (cost || drains) {
      for (const each of classes) out.push(...applyClass(kernel, part.world, action, info, target, entry, spread, attackerHP, each, start, cost, drains, cases[each.caseIndex]));
      continue;
    }
    // With the attacker unchanged by the prefix, the classes of one (case, hits into the Substitute) differ only by the
    // Substitute's HP left: one step for them, its worlds then split by that HP (the same worlds, fewer calls).
    const groups = new Map<string, SubClass[]>();
    for (const each of classes) {
      const key = `${each.caseIndex},${each.skip}`;
      const known = groups.get(key);
      if (known) known.push(each); else groups.set(key, [each]);
    }
    for (const group of groups.values()) {
      const mass = group.reduce((sum, each) => sum + each.mass, 0);
      const world = cloneWorld(part.world, part.world.mass * mass);
      setSubstitute(world, target, group[0].left);
      for (const each of group) noteClass(kernel, action, target, part.world.mass * each.mass, start, each.left);
      const children = stepped(kernel, world, action, info, target, entry, spread, group[0], cases[group[0].caseIndex]);
      if (group.length === 1) { out.push(...children); continue; }
      for (const child of children) {
        for (const each of group) {
          const next = cloneWorld(child, child.mass * each.mass / mass);
          setSubstitute(next, target, each.left);
          out.push(next);
        }
      }
    }
  }
  return out;
}

/** The Substitute's HP left in a world: deleted at 0 (the volatile ends). */
function setSubstitute(w: World, target: DoublesSlotId, left: number) {
  const holder = w.mons[target]!;
  const { substitute: _gone, ...rest } = holder.vol;
  void _gone;
  holder.vol = left > 0 ? { ...rest, substitute: left } : rest;
}

/** A class's statistics (kernel.subStat: DoublesHit.substitute) and its break fact. */
function noteClass(kernel: TurnKernel, action: PendingAction, target: DoublesSlotId, mass: number, start: number, left: number) {
  kernel.subStat(action, target, mass, start - left, left === 0);
  if (left === 0) kernel.hitFact(action, target, "Its Substitute breaks.", mass);
}

/** One class of the prefix as a world (ADDENDUM §4.13.7): the Substitute's HP, the attacker through the prefix, and the pair's step with the part. */
function applyClass(kernel: TurnKernel, from: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, entry: SearchEntry, spread: boolean,
  attackerHP: number | undefined, each: SubClass, start: number, cost: SubCost, drains: boolean, useCase: TurnCase): World[] {
  const attacker = action.slot;
  const move = kernel.runtime.movesById.get(action.moveId!)!;
  const world = cloneWorld(from, from.mass * each.mass);
  setSubstitute(world, target, each.left);
  const taken = start - each.left;
  noteClass(kernel, action, target, world.mass, start, each.left);
  // The attacker through the prefix's one hit (a one-hit case alone changes its HP: subHit's recoil, drain, self-cost,
  // Liquid Ooze, then its HP or pinch Berry at the hit's Update).
  let worlds: { world: World; ate: string | null; fainted: boolean }[] = [{ world, ate: null, fainted: false }];
  const search = entry.search!;
  if ((cost || drains) && taken > 0) {
    worlds = mapHP(world, attacker, (hp) => {
      if (hp <= 0) return { hp, tag: "" };
      const loop = loopOf(kernel, search, attacker, hp);
      const outcome = subHit(loop, startHits(loop), taken, cost);
      if (outcome.state.ate) {
        kernel.noteHeal(attacker, kernel.itemName(outcome.state.ate.item), outcome.state.ate.heal);
        kernel.noteHeal(attacker, "Cheek Pouch", outcome.state.ate.pouch);
      }
      return { hp: outcome.state.hp, tag: outcome.fainted ? "fainted" : outcome.ate ? `ate:${outcome.ate}` : "" };
    }).map(({ world: next, tag }) => ({ world: next, ate: tag.startsWith("ate:") ? tag.slice(4) : null, fainted: tag === "fainted" }));
  }
  const out: World[] = [];
  for (const { world: next, ate, fainted } of worlds) {
    if (fainted) {
      // The attacker fainted in the prefix (recoil, Steel Beam's or Chloroblast's cost, Liquid Ooze): no step. A Gem was
      // spent before the hit (its onSourceTryPrimaryHit), and the target's Air Balloon pops (onAfterSubDamage runs after
      // the recoil; with Unburden).
      const user = next.mons[attacker]!;
      if (search.result.rawDesc.attackerItem?.endsWith(" Gem") && user.build.itemId.endsWith("gem")) user.build = { ...user.build, itemId: "" };
      const balloon = next.mons[target]!;
      if (balloon.build.itemId === "airballoon" && kernel.itemWorks(next, balloon.build)) {
        balloon.build = { ...balloon.build, itemId: "", ...(balloon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
      }
      kernel.faint(next, attacker);
      out.push(next);
      continue;
    }
    if (!ate) { out.push(...stepped(kernel, next, action, info, target, entry, spread, each, useCase)); continue; }
    // The prefix's Update ate the attacker's HP or pinch Berry: in the world (no item, Unburden, the pinch rise, Lansat's
    // focus, Starf's random rise: one world each), and the step from the attacker's new build (memoised).
    for (const eaten of kernel.ateBerry(next, attacker, ate)) {
      const use = kernel.searchFor(eaten, attacker, target, move.id, kernel.conditionsFor(eaten, attacker, target, spread, move.id), kernel.contextFor(eaten, action, target, info),
        spread, attackerHP, { behindSubstitute: true });
      if (use.row.kind !== "calculated" || !use.search) kernel.notEstimated(kernel.rowReason(eaten, target, use.row, move));
      out.push(...stepped(kernel, eaten, action, info, target, use, spread, each, useCase));
    }
  }
  return out;
}

/**
 * The pair's step after the prefix (kernel.applyStep with the part): the user's per-use effects once, the target's only
 * for the hits after the break. The stand-ins of the calculation into the Substitute (searchFor's behindSubstitute: a
 * working resist or Chilan Berry as Leftovers, an intact Disguise or Ice Face as no ability) are put back after it: with
 * a continuation in front of one the turn is not estimated (perHitGuard), so nothing in the step changed them.
 */
function stepped(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, entry: SearchEntry, spread: boolean, each: SubClass, useCase: TurnCase): World[] {
  const attacker = action.slot;
  const move: ChampionsMove = kernel.runtime.movesById.get(action.moveId!)!;
  const real = w.mons[target]!.build;
  const standItem = RESIST_BERRIES.has(real.itemId) && kernel.itemWorks(w, real);
  const standAbility = !!BUSTED_FORMS[real.speciesId] && (real.abilityId === "disguise" || real.abilityId === "iceface");
  const stats = each.skip > 0 && each.skip < useCase.hits.length ? kernel.hitStats(action, target) : null;
  const before = stats ? new Map([...stats.met].map(([key, met]) => [key, met.mass])) : null;
  const children = kernel.applyStep(w, action, target, entry, info, spread, { caseIndex: each.caseIndex, skip: each.skip });
  if (stats && before) continuationRows(stats.met, before, useCase, each.skip);
  const out: World[] = [];
  for (const { world, landed, knocked } of children) {
    const receiver = world.mons[target]!;
    if (standItem || standAbility) {
      receiver.build = {
        ...receiver.build, ...(standItem ? { itemId: real.itemId } : {}),
        ...(standAbility ? { abilityId: real.abilityId, abilityActive: real.abilityActive } : {}),
      };
    }
    if (landed > 0) kernel.hitFact(action, target, `${move.name} hits ${kernel.names[target]} after its Substitute breaks.`, world.mass);
    if (spread) { out.push(world); continue; }
    // The faint batch after the hits: the knocker-out's rise (doubles-turn.ts singleStep).
    if (knocked) kernel.koBoost(world, attacker, 1);
    // Final Gambit's damageCallback faints its user as it deals the damage, whatever it hits (data/moves.ts finalgambit).
    if (move.id === "finalgambit" && !info.transformed && kernel.alive(world, attacker)) {
      for (const { world: next } of mapHP(world, attacker, () => ({ hp: 0, tag: "" }))) { kernel.faint(next, attacker); out.push(next); }
      continue;
    }
    out.push(world);
  }
  return out;
}

/**
 * The calculations a continuation met (HitStats.met; DoublesHit.min and max: the hits that reached the Pokémon, ADDENDUM
 * §3.1): the step lists the run's row, the whole move's damage, for an outcome in which a hit after the break reached the
 * target; its share goes to the continuation's own damage instead, the case's hits from `skip` on (their least and most
 * rolls summed), keyed apart.
 */
function continuationRows(met: Map<string, { row: MoveDamageResult; mass: number }>, before: Map<string, number>, useCase: TurnCase, skip: number) {
  const hits = useCase.hits.slice(skip);
  const min = hits.reduce((sum, hit) => sum + Math.min(...hit.values), 0), max = hits.reduce((sum, hit) => sum + Math.max(...hit.values), 0);
  for (const [key, entry] of [...met]) {
    if (key.startsWith("substitute:")) continue;
    const added = entry.mass - (before.get(key) ?? 0);
    if (added <= 0) continue;
    if (before.has(key)) entry.mass -= added; else met.delete(key);
    const row: MoveDamageResult = { ...entry.row, min, max, rolls: null, hits: hits.length };
    const own = `substitute:${JSON.stringify([min, max, hits.length, entry.row.effectiveName, entry.row.effectivePower])}`;
    const known = met.get(own);
    if (known) known.mass += added; else met.set(own, { row, mass: added });
  }
}

/** Track E's Substitute facts on `slot` in one world (DoublesHP.conditions: "Substitute: {HP} HP." while one stands). */
export function conditions(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  void kernel;
  const mon = w.mons[slot];
  return mon && !mon.fainted && mon.vol.substitute ? [`Substitute: ${mon.vol.substitute} HP.`] : [];
}
