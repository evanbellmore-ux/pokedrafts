import { getBerryResistType } from "@smogon/calc/dist/items";
import { BUSTED_FORMS, REASONS, RESIST_BERRIES } from "./doubles-actions";
import * as faceNs from "./doubles-faces";
import * as fieldChangeNs from "./doubles-fieldchange";
import type { DoublesSlotId } from "./doubles-types";
import { cloneWorld, mapHP, type PendingAction, type World } from "./doubles-world";
import type { FaceKind, HitCheck, SearchEntry, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import { ownMoveId, startHits, subHit, type HitLoopInput, type SubCost } from "./hit-loop";
import { MAX_MOVE_EFFECTS, Z_MOVE_EFFECTS } from "./stat-moves";
import { itemTakeable, type TurnCase, type UsesSearch } from "./uses-to-ko";
import type { BattleBuild, BattleConditions, ChampionsMove } from "./types";

// The hook namespaces are copied once into plain objects (as the other hook modules do): under tsx a namespace import's
// member is a getter over the module's own export getter. No runtime import here is in a cycle (status2-hooks.test.ts).
const faceHooks = { ...faceNs };
const fieldChangeHooks = { ...fieldChangeNs };

// Damaging hits into a Substitute (status-eot ADDENDUM §4.13; status2 ADDENDUM2 §2.3 #33, #34, T2M §3.22, §3.23): Track S's
// file (with doubles-faces.ts). MonState.vol.substitute holds its HP; doubles-turn.ts asks `single` (singleStep) and `plan`
// (spreadStep) before each target's calculation, and the kernel gives searchFor's behindSubstitute calculation (the target's
// resist Berry as Leftovers, an intact Disguise or Ice Face as no ability), applyStep's part (uses-to-ko.ts TurnStepPart)
// and subStat (DoublesHit.substitute). Pinned Showdown c23d2e94: data/moves.ts:18325-18376 (substitute condition),
// sim/battle-actions.ts:940-1000 (hitStepMoveHitLoop), 1317-1351 (selfDrops and secondaries run for a hit into a
// Substitute: a Max Move's and a Z-Move's self effects), data/abilities.ts magician (move.hitTargets keeps the target).
//
// Each hit of the move meets the Substitute while it stands (onTryPrimaryHit returns HIT_SUBSTITUTE): the damage is
// capped at its HP, and from the hit after it breaks the move's hits reach the Pokémon (a multi-hit move continues).
// The walk below is the prefix over every roll of each case (turnCases): equal (case, hits into the Substitute, HP left)
// merge. Each class is one world, its Substitute's HP set, the attacker's HP through the prefix's recoil, drain and
// self-cost (hit-loop.ts subHit), then the pair's step with that part (applyStep), which runs the user's per-use effects
// and, for the hits after the break, the full pair machinery. A Pokémon whose effects the engine's later hits read as if
// each earlier hit had reached it (SUB_PER_HIT) keeps them behind the Substitute: the hits into it all read as the first
// (the prefix's `frozen` cases) and the hits after the break are a fresh continuation against its real build
// (TurnStepPart.fresh, T2M §3.23); an intact Disguise or Ice Face behind it takes the first hit after the break and the
// rest go into the busted form (doubles-faces.ts faceAfterSub, T2M §3.13).

/**
 * A spread move's hit into one target's Substitute (spreadStep): applied to each world in the target's place in the hit
 * order. `cost`: the HP the user pays to this Substitute as its hit lands (Mind Blown's applyRecoilDamage: round(maxHP / 2),
 * Magic Guard none), for a spread step that adds it to its own losses (plan's `costs` option).
 */
export type SubPlan = { apply: (world: World) => World[]; cost?: number };

/** Damaging moves without the sound flag that pass a Substitute (pinned Showdown flags.bypasssub; tests/source/doubles-substitute-census.test.ts). */
export const PASSING_MOVES: ReadonlySet<string> = new Set(["hyperspacefury", "hyperspacehole", "spectralthief"]);

/**
 * The target's effects the engine's per-hit damages read as if each earlier hit had reached the Pokémon (ADDENDUM §4.13.6:
 * @smogon/calc mechanics/util.js checkMultihitBoost and the hitCount === 0 terms of calculateFinalModsSMSSSV, less the
 * Parental Bond-only Gooey and Tangling Hair and the items calculate.ts withholds between hits, AFTER_MOVE_ITEMS: Kee
 * Berry, Maranga Berry, White Herb). Behind a Substitute none of them fires (no DamagingHit; the Pokémon keeps its HP and
 * its Berry): the hits into it read as the first (frozen), and the first hit after the break reads them as a first hit
 * (T2M §3.23). `contact`: only on a contact move (the ability swap).
 */
export const SUB_PER_HIT = {
  abilities: ["multiscale", "shadowshield", "stamina", "watercompaction", "weakarmor", "seedsower", "sandspit"],
  contact: ["mummy", "lingeringaroma", "wanderingspirit"],
  items: [...RESIST_BERRIES, "luminousmoss"],
} as const;
const PER_HIT_ABILITIES: ReadonlySet<string> = new Set(SUB_PER_HIT.abilities);
const PER_HIT_CONTACT: ReadonlySet<string> = new Set(SUB_PER_HIT.contact);
/** The multi-hit moves whose hits differ in power (data/moves.ts triplekick, tripleaxel basePowerCallback): a hit into the Substitute is not its first. */
const VARYING_POWER_HITS: ReadonlySet<string> = new Set(["triplekick", "tripleaxel"]);
/** The strong weathers a Max Move's weather does not replace (sim/field.ts setWeather: a primal weather stays). */
const STRONG_WEATHERS: ReadonlySet<string> = new Set(["Harsh Sunshine", "Heavy Rain", "Strong Winds"]);

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
  return hitInto(kernel, w, action, info, target, entry, false, attackerHP);
}

/**
 * A spread move's hit into a Substitute (doubles-turn.ts spreadStep's plans, after the block check), or null when it does
 * not meet one or deals no damage. The calculation is from the world before the move, with the spread modifier while
 * more than one target was in place (`multiple`; U5); the attacker's state joins world.spread like the other targets',
 * and its Life Orb stays spreadStep's, once per move. Mind Blown (T2M §3.22; status-eot U17): the user pays round(maxHP /
 * 2) as each hit into a Substitute lands (the Substitute's applyRecoilDamage), in the hit's DamagingHit place before its
 * one Update, and its own cost after the hits only when a target took damage (sim/battle-actions.ts:981-983
 * move.totalDamage; a hit into a Substitute adds none) or every target failed (onMoveFail): a spread step that adds
 * SubPlan.cost to its losses and charges the end cost so (`opts.costs`); without it the move keeps its reason. Magician
 * takes from the fastest target it hit (speedSort), which spreadStep's order is not: kept reason.
 */
export function plan(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, check: HitCheck, multiple: boolean, attackerHP?: number,
  opts: { costs?: true } = {}): SubPlan | null {
  const target = check.slot;
  if (!meets(w, action, info, target)) return null;
  const move = kernel.runtime.movesById.get(action.moveId!)!;
  const mindBlown = !info.transformed && action.moveId === "mindblown";
  if (mindBlown && !opts.costs) kernel.notEstimated(REASONS.intoSubstitute(kernel.moveName("mindblown")));
  const conditions = kernel.conditionsFor(w, action.slot, target, multiple, move.id);
  const entry = kernel.searchFor(w, action.slot, target, move.id, conditions, kernel.contextFor(w, action, target, info), true, attackerHP, { behindSubstitute: true });
  if (entry.row.kind !== "calculated") kernel.notEstimated(kernel.rowReason(w, target, entry.row, move));
  if (!entry.search) return null;
  const user = w.mons[action.slot]!.build, holder = w.mons[target]!.build;
  if (user.abilityId === "magician" && !user.itemId && holder.itemId && takeable(kernel, entry.search, holder, user)) kernel.notEstimated(REASONS.intoSubstitute(kernel.abilityName("magician")));
  const cost = mindBlown && user.abilityId !== "magicguard" ? Math.round(kernel.hp[action.slot].maxHP / 2) : 0;
  return { apply: (world) => hitInto(kernel, world, action, info, target, entry, true, attackerHP), ...(mindBlown ? { cost } : {}) };
}

/** Whether `taker` can take `holder`'s item (uses-to-ko.ts itemTakeable: Z-Crystals, a Mega Stone or Booster Energy of its own species, a Paradox's Booster Energy). */
function takeable(kernel: TurnKernel, search: UsesSearch, holder: BattleBuild, taker: BattleBuild): boolean {
  const species = (build: BattleBuild) => build.transformedFrom?.speciesId ?? build.speciesId;
  return itemTakeable(kernel.runtime, search.m.helpers.paradox, holder.itemId, species(holder), species(taker), false);
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

/**
 * The cases with every hit read as the first (T2M §3.23): behind a Substitute the Pokémon does not change between hits, so
 * a constant-power move's hit k into it deals what its first does (hits[k] := hits[0]).
 */
export function frozenCases(cases: readonly TurnCase[]): TurnCase[] {
  return cases.map((useCase) => ({ chance: useCase.chance, hits: useCase.hits.map(() => useCase.hits[0]) }));
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
 * What the Pokémon behind the Substitute keeps from a multi-hit move's later hits (ADDENDUM §4.13.6, SUB_PER_HIT; T2M §3.13,
 * §3.23): `face`, an intact Disguise or Ice Face the first hit after the break meets (Ice Face a physical move; a breaker
 * passes both); `frozen`, an effect the engine's per-hit damages read as if each earlier hit had reached it: abilities in
 * effect (a breaker passes the breakable Multiscale; Multiscale and Shadow Shield only at full HP, `fullHP`; Water
 * Compaction on a Water move; Weak Armor on a physical one; the ability swaps on contact) and working items (a resist Berry
 * for the move's type, Chilan for Normal; Luminous Moss on a Water move). A frozen prefix needs every hit into the
 * Substitute to be the first's: not for Triple Axel and Triple Kick (a hit's power is its index's), Parental Bond's ×0.25
 * strike, or a Gem the first hit spends (REASONS.subPerHit, kept: T2M §3.23, ADDENDUM2 §2.3 #34).
 */
function perHitReads(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, entry: SearchEntry, fullHP: boolean): { face: FaceKind | null; frozen: boolean } {
  const holder = w.mons[target]!.build;
  const type = entry.row.effectiveType ?? info.effective.type;
  const physical = (entry.row.effectiveCategory ?? info.effective.category) === "Physical";
  const broken = kernel.breaks(w, action.slot, target, info);
  const ability = holder.abilityId;
  const name = kernel.names[target];
  const moveName = kernel.moveName(action.moveId!);
  const face = BUSTED_FORMS[holder.speciesId] && !holder.transformedFrom && !broken && (ability === "disguise" || (ability === "iceface" && physical))
    ? ability as FaceKind : null;
  const reads = PER_HIT_ABILITIES.has(ability) && ({
    multiscale: fullHP && !broken, shadowshield: fullHP, watercompaction: type === "Water", weakarmor: physical,
  } as Record<string, boolean>)[ability] !== false;
  const what = reads || (PER_HIT_CONTACT.has(ability) && info.contact) ? kernel.abilityName(ability) : "";
  const item = kernel.itemWorks(w, holder) ? holder.itemId : "";
  const resisted = RESIST_BERRIES.has(item) && (item === "chilanberry" ? type === "Normal" : getBerryResistType(kernel.itemName(item) as never) === type);
  const itemWhat = resisted || (item === "luminousmoss" && type === "Water") ? kernel.itemName(item) : "";
  const effect = what || itemWhat;
  if (!effect) return { face, frozen: false };
  const doubled = w.mons[action.slot]!.build.abilityId === "parentalbond" && kernel.runtime.movesById.get(action.moveId!)!.multihit === null;
  const gem = !!entry.trace?.result?.rawDesc.attackerItem?.endsWith(" Gem");
  if (doubled || gem || (!info.transformed && VARYING_POWER_HITS.has(action.moveId!))) kernel.notEstimated(REASONS.subPerHit(moveName, name, effect));
  return { face, frozen: true };
}

/**
 * The hit into `target`'s Substitute in one world (ADDENDUM §4.13.3-8): the world split by the parts of the target's HP
 * the damage reads (and of the attacker's, where it reads that), the prefix walk of each part's cases, and per class the
 * Substitute's HP, the attacker through the prefix, and the pair's step with its part. `spread`: a spread move's target
 * (the attacker's state for spreadStep; no faint batch or Final Gambit here).
 */
function hitInto(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, entry: SearchEntry, spread: boolean, attackerHP?: number): World[] {
  const move = kernel.runtime.movesById.get(action.moveId!)!;
  const search = entry.search!;
  const out: World[] = [];
  for (const part of faceHooks.hpParts(kernel, w, action, entry, target, attackerHP)) {
    const cases = search.turnCases(part.x, part.t, kernel.mode);
    if ("failed" in cases) kernel.notEstimated(cases.failed);
    const multi = cases.some((useCase) => useCase.hits.length > 1);
    // Parental Bond's two strikes walk the prefix with their own values (the second at ×0.25) and its per-strike self
    // effects (T2-SB06: Power-Up Punch +1 per strike, a Substitute's hits included) are the part's.
    const reads = multi ? perHitReads(kernel, part.world, action, info, target, entry, part.t >= kernel.hp[target].maxHP) : { face: null, frozen: false };
    // A hit after the break can meet a Focus Band (W's doubles-pairs.ts focusBand).
    if (multi) kernel.focusBandGuard(part.world, target, entry.row);
    const cost = costOf(search, info, move.id);
    const drains = !!(search.result.move as { drain?: unknown }).drain;
    // No catalog move has a hit count above one with recoil, drain or a self-cost (tests/source/doubles-substitute-census.test.ts).
    if (multi && (cost || drains)) kernel.notEstimated(REASONS.intoSubstitute(move.name));
    const start = part.world.mons[target]!.vol.substitute!;
    const classes = subPrefix(reads.frozen ? frozenCases(cases) : cases, start);
    const after = { reads, attackerHP };
    if (cost || drains) {
      for (const each of classes) out.push(...applyClass(kernel, part.world, action, info, target, entry, spread, attackerHP, each, start, cost, drains, cases[each.caseIndex], after));
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
      const children = stepped(kernel, world, action, info, target, entry, spread, group[0], cases[group[0].caseIndex], after);
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

/** What the step after the prefix keeps to: the per-hit reads behind the Substitute (perHitReads) and the attacker's HP class. */
type After = { reads: { face: FaceKind | null; frozen: boolean }; attackerHP: number | undefined };

/** One class of the prefix as a world (ADDENDUM §4.13.7): the Substitute's HP, the attacker through the prefix, and the pair's step with the part. */
function applyClass(kernel: TurnKernel, from: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, entry: SearchEntry, spread: boolean,
  attackerHP: number | undefined, each: SubClass, start: number, cost: SubCost, drains: boolean, useCase: TurnCase, after: After): World[] {
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
    if (!ate) { out.push(...stepped(kernel, next, action, info, target, entry, spread, each, useCase, after)); continue; }
    // The prefix's Update ate the attacker's HP or pinch Berry: in the world (no item, Unburden, the pinch rise, Lansat's
    // focus, Starf's random rise: one world each), and the step from the attacker's new build (memoised).
    for (const eaten of kernel.ateBerry(next, attacker, ate)) {
      const use = kernel.searchFor(eaten, attacker, target, move.id, kernel.conditionsFor(eaten, attacker, target, spread, move.id), kernel.contextFor(eaten, action, target, info),
        spread, attackerHP, { behindSubstitute: true });
      if (use.row.kind !== "calculated" || !use.search) kernel.notEstimated(kernel.rowReason(eaten, target, use.row, move));
      out.push(...stepped(kernel, eaten, action, info, target, use, spread, each, useCase, after));
    }
  }
  return out;
}

/**
 * The pair's step after the prefix (kernel.applyStep with the part): the user's per-use effects once, the target's only
 * for the hits after the break. The stand-ins of the calculation into the Substitute (searchFor's behindSubstitute: a
 * working resist or Chilan Berry as Leftovers, an intact Disguise or Ice Face as no ability) are put back after it. With
 * hits after the break: an intact face behind the Substitute takes the first of them (doubles-faces.ts faceAfterSub), a
 * frozen prefix goes on as a fresh continuation against the real build (TurnStepPart.fresh: the first hit after the
 * break reads the Pokémon as a first hit: its resist Berry, Multiscale at full HP, Stamina from then on). Then what a hit
 * into the Substitute alone does that the step's part leaves (subOnly).
 */
function stepped(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, entry: SearchEntry, spread: boolean, each: SubClass, useCase: TurnCase,
  after: After): World[] {
  const attacker = action.slot;
  const move: ChampionsMove = kernel.runtime.movesById.get(action.moveId!)!;
  const continues = each.skip < useCase.hits.length;
  if (continues && after.reads.face && !spread) return faceHooks.faceAfterSub(kernel, w, action, info, target, after.reads.face, each.caseIndex, useCase, each.skip);
  const real = w.mons[target]!.build;
  const fresh = continues && after.reads.frozen && !spread;
  // The fresh continuation's search: the real build, no stand-ins (searchFor without behindSubstitute).
  const use = fresh ? realEntry(kernel, w, action, info, target, after.attackerHP) : entry;
  const standItem = !fresh && RESIST_BERRIES.has(real.itemId) && kernel.itemWorks(w, real);
  const standAbility = !fresh && !!BUSTED_FORMS[real.speciesId] && (real.abilityId === "disguise" || real.abilityId === "iceface");
  const stats = continues ? kernel.hitStats(action, target) : null;
  const before = stats ? new Map([...stats.met].map(([key, met]) => [key, met.mass])) : null;
  const part = { caseIndex: each.caseIndex, skip: each.skip, ...(fresh ? { fresh: true as const } : {}) };
  const startItem = w.mons[attacker]!.build.itemId;
  const children = kernel.applyStep(w, action, target, use, info, spread, part);
  if (stats && before) faceHooks.continuedRows(stats.met, before, fresh ? freshCase(kernel, w, action, use, target, each, after.attackerHP) : useCase, fresh ? 0 : each.skip, null);
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
    for (const each of landed === 0 ? subOnly(kernel, world, action, info, target, use, spread, startItem) : [world]) {
      if (spread) { out.push(each); continue; }
      // The faint batch after the hits: the knocker-out's rise (doubles-turn.ts singleStep).
      if (knocked) kernel.koBoost(each, attacker, 1);
      // Final Gambit's damageCallback faints its user as it deals the damage, whatever it hits (data/moves.ts finalgambit).
      if (move.id === "finalgambit" && !info.transformed && kernel.alive(each, attacker)) {
        for (const { world: next } of mapHP(each, attacker, () => ({ hp: 0, tag: "" }))) { kernel.faint(next, attacker); out.push(next); }
        continue;
      }
      out.push(each);
    }
  }
  return out;
}

/** The pair's search into the real build (no behindSubstitute stand-ins) for a fresh continuation, from the world after the prefix. */
function realEntry(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, attackerHP: number | undefined): SearchEntry {
  const move = kernel.runtime.movesById.get(action.moveId!)!;
  const entry = kernel.searchFor(w, action.slot, target, move.id, kernel.conditionsFor(w, action.slot, target, false, move.id), kernel.contextFor(w, action, target, info), false, attackerHP);
  if (entry.row.kind !== "calculated" || !entry.search) kernel.notEstimated(kernel.rowReason(w, target, entry.row, move));
  // Another resist Berry's Unnerve where the real calculation reads it (K's doubles-reactions.ts unnerveStand, as singleStep).
  kernel.unnerveGuard(w, action.slot, target);
  return entry;
}

/** The fresh continuation's hits as one case (its statistics): the real search's case, its first hits (TurnStepPart.fresh: the case's hits less the prefix's). */
function freshCase(kernel: TurnKernel, w: World, action: PendingAction, use: SearchEntry, target: DoublesSlotId, each: SubClass, attackerHP: number | undefined): TurnCase {
  const search = use.search!;
  const [part] = faceHooks.hpParts(kernel, w, action, use, target, attackerHP);
  const cases = search.turnCases(part.x, part.t, kernel.mode);
  if ("failed" in cases) kernel.notEstimated(cases.failed);
  const picked = cases[each.caseIndex];
  return { chance: 1, hits: picked.hits.slice(0, picked.hits.length - each.skip) };
}

/**
 * What a hit into the Substitute alone (no hit reached the Pokémon) does beyond the step's part (T2M §3.22): a Max Move's
 * self effects (sim/battle-actions.ts selfDrops runs for the hit: data/moves.ts max* self.onHit): the user's own stage
 * (the kernel's maxEffects gives its partner's), the drop on every foe, the one behind the Substitute included (its
 * partner's: maxEffects), the weather or terrain it sets or ends, G-Max Wind Rage's screens, G-Max Sweetness's cure; then
 * the kernel's maxEffects (the user's partner, the other foe, the G-Max effects). A signature Z-Move's own field effect
 * (Z_MOVE_EFFECTS): Splintered Stormshards ends the terrain (onAfterSubDamage), Genesis Supernova sets Psychic Terrain (its
 * secondary's self runs for the hit, status2/build/w1a-s S-SB-02b). A field change re-settles what reads it (FC's
 * fieldchange.changed: today's reason with a field-settled Pokémon in). Magician (data/abilities.ts magician: move.hitTargets
 * keeps a Substitute's holder): an item-less user that spent no Gem takes its item (T2-FA12, status-eot U15).
 */
function subOnly(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, entry: SearchEntry, spread: boolean, startItem: string): World[] {
  const attacker = action.slot;
  const user = w.mons[attacker]!;
  const field = w.field;
  const weather0 = field.weather, terrain0 = field.terrain;
  if (info.isMax && !spread) {
    const effect = MAX_MOVE_EFFECTS[kernel.usedMove(w, attacker, action.moveId!, target, info).name];
    if (effect?.user && kernel.alive(w, attacker)) kernel.selfBoost(w, attacker, effect.user, action);
    if (effect?.foe && kernel.alive(w, target)) kernel.foeDrop(w, target, effect.foe, attacker, kernel.breaks(w, attacker, target, info));
    if (effect?.weather && !STRONG_WEATHERS.has(field.weather) && field.weather !== effect.weather) w.field = { ...w.field, weather: effect.weather as BattleConditions["weather"] };
    if (effect?.terrain && field.terrain !== effect.terrain) w.field = { ...w.field, terrain: effect.terrain as BattleConditions["terrain"] };
    if (effect?.clearsTerrain && w.field.terrain) w.field = { ...w.field, terrain: "" };
    if (effect?.clearsScreens) {
      const side = target.startsWith("own") ? "own" : "opponent";
      w.sides[side] = { ...w.sides[side], reflect: false, lightScreen: false, auroraVeil: false };
    }
    if (effect?.curesUserStatus && user.build.status) user.build = { ...user.build, status: "" };
  }
  const z = info.isZ ? Z_MOVE_EFFECTS[info.effective.name] : undefined;
  if (z?.clearsTerrain && w.field.terrain) w.field = { ...w.field, terrain: "" };
  if (z?.terrain && w.field.terrain !== z.terrain && user.build.abilityId !== "sheerforce") w.field = { ...w.field, terrain: z.terrain as BattleConditions["terrain"] };
  if (w.field.weather !== weather0 || w.field.terrain !== terrain0) fieldChangeHooks.changed(kernel, w, { weather: weather0, terrain: terrain0 }, action);
  // Magician after the move (not a spread move's: plan's reason), as the step's own (an item-less user, no Gem spent).
  const gemSpent = startItem.endsWith("gem") && !user.build.itemId;
  const holder = w.mons[target]!;
  if (!spread && user.build.abilityId === "magician" && !user.build.itemId && !gemSpent && kernel.alive(w, attacker) && kernel.alive(w, target) && holder.build.itemId && action.moveId !== "fling") {
    const item = holder.build.itemId;
    if (takeable(kernel, entry.search!, holder.build, user.build)) {
      holder.build = { ...holder.build, itemId: "" };
      user.build = { ...user.build, itemId: item };
      if (kernel.tracksItems) w.itemsTaken = [...(w.itemsTaken ?? []), target];
      kernel.hitFact(action, target, `${kernel.abilityName("magician")}: ${kernel.names[attacker]} takes ${kernel.names[target]}'s ${kernel.itemName(item)}.`, w.mass);
    }
  }
  // The kernel's maxEffects (the user's partner, the other foe, the G-Max effects: their random worlds), last (M).
  return info.isMax && !spread ? kernel.maxEffects(w, action, info, target) : [w];
}

/** Track E's Substitute facts on `slot` in one world (DoublesHP.conditions: "Substitute: {HP} HP." while one stands). */
export function conditions(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  void kernel;
  const mon = w.mons[slot];
  return mon && !mon.fainted && mon.vol.substitute ? [`Substitute: ${mon.vol.substitute} HP.`] : [];
}

