// One constructor per public effect for belief battles (SPEC §9.3). Hidden durations are redrawn from the public counts
// (SPEC 2.2, I6): never read from any battle. Pinned sources: data/conditions.ts (confusion 162, partiallytrapped 222,
// lockedmove 253, twoturnmove 287, mustrecharge 364, stall 439), data/moves.ts conditions, data/mods/champions/conditions.ts.
import type { AIRandom } from "../model/decision";
import type { PublicMon, PublicVolatile } from "../model/public-state";
import type { ClonedBattle, EffectState, WritablePokemon } from "./sim";

export type EffectContext = {
  battle: ClonedBattle;
  mon: WritablePokemon;
  pub: PublicMon;
  /** The decision's turn (PublicState.turn). */
  turn: number;
  random: AIRandom;
  /** The belief battle's Pokémon for a PublicMon key, or null. */
  monOf(key: string | undefined): WritablePokemon | null;
  /** The mon is on the AI's own side (its own last targets are known to it). */
  own: boolean;
  approximations: Set<string>;
};

/** Base durations of volatiles that count down at each end of turn (pinned data/moves.ts conditions, data/abilities.ts slowstart). */
const COUNTDOWN: Record<string, number> = {
  magnetrise: 5, telekinesis: 3, throatchop: 2, healblock: 5, laserfocus: 2, slowstart: 5, embargo: 5, lockon: 2, uproar: 3, syrupbomb: 4,
};
/** Public volatiles with no hidden duration: written as shown. */
const PLAIN: ReadonlySet<string> = new Set([
  "smackdown", "saltcure", "tarshot", "charge", "focusenergy", "torment", "flashfire", "minimize", "defensecurl", "ingrain", "aquaring",
  "curse", "imprison", "nightmare", "noretreat", "gastroacid", "destinybond", "grudge", "foresight", "miracleeye", "dragoncheer", "octolock",
  "glaiverush",
]);
/** Effects dropped at |turn| or represented elsewhere (the lock, the protect streak, Supreme Overlord's count). */
const HANDLED_ELSEWHERE: ReadonlySet<string> = new Set(["protect", "helpinghand", "followme", "ragepowder", "roost", "endure", "fallen", "trapper", "typechange", "typeadd"]);

const pick = <T,>(list: readonly T[], random: AIRandom): T => list[random.int(list.length)];
const left = (base: number, since: number, turn: number) => Math.max(1, base - (turn - since));
const locOf = (from: WritablePokemon, target: WritablePokemon) => (target.side === from.side ? -(target.position + 1) : target.position + 1);

/** The belief battle's volatiles for one Pokémon from its public volatiles, plus the derived ones (stall, lockedmove, choicelock, unburden). */
export function volatileStates(ctx: EffectContext): Record<string, EffectState> {
  const { battle, mon, pub, random } = ctx;
  const out: Record<string, EffectState> = {};
  const state = (id: string, extra: Record<string, unknown> = {}) => battle.initEffectState({ id, target: mon, source: mon, ...extra });
  for (const volatile of pub.volatiles) {
    const made = construct(ctx, volatile, state);
    if (made) for (const [id, effect] of Object.entries(made)) out[id] = effect;
  }
  // R11: a protect streak k gives the stall counter 3^k (data/conditions.ts stall onRestart).
  if (pub.protectStreak > 0) out.stall = state("stall", { duration: 1, counter: Math.min(729, 3 ** pub.protectStreak) });
  // R7: Outrage-type locks: 2–3 uses in all (lockedmove onStart random(2, 4)); after one use 1 or 2 left, after two 1.
  if (pub.lock && !pub.fainted && pub.position !== null) {
    out.lockedmove = state("lockedmove", { duration: 1, trueDuration: pub.lock.turns <= 1 ? pick([1, 2], random) : 1, move: pub.lock.moveId });
  }
  // Choice lock: the holder's item is a Choice item and it acted this stint (items.ts choicescarf onModifyMove → choicelock).
  if (pub.lastMove && pub.actions > 0 && pub.position !== null && mon.getItem().isChoice) out.choicelock = state("choicelock", { move: pub.lastMove });
  // R8: Unburden is active when it lost its item this stint (data/abilities.ts unburden onAfterUseItem/onTakeItem).
  if (mon.ability === "unburden" && pub.item.state === "gone" && pub.item.stint === pub.switchIns && pub.position !== null) out.unburden = state("unburden");
  // The Metronome item's counter starts at switch-in (data/items.ts metronome onStart addVolatile).
  if (mon.item === "metronome" && pub.position !== null) {
    out.metronome = state("metronome", { lastMove: pub.lastMove ?? "", numConsecutive: 0 });
    if (pub.lastMove) ctx.approximations.add("Metronome item count assumed 0.");
  }
  return out;
}

function construct(ctx: EffectContext, volatile: PublicVolatile, state: (id: string, extra?: Record<string, unknown>) => EffectState): Record<string, EffectState> | null {
  const { battle, mon, pub, turn, random } = ctx;
  const since = volatile.since;
  const id = volatile.id;
  if (HANDLED_ELSEWHERE.has(id)) return null;
  switch (id) {
    case "confusion": {
      // random(2, 6) attempts in all, one used per -activate line (R10); still confused, so more than elapsed.
      const t0 = pick([2, 3, 4, 5].filter((n) => n > volatile.elapsed), random) ?? volatile.elapsed + 1;
      return { confusion: state("confusion", { time: t0 - volatile.elapsed }) };
    }
    case "twoturnmove": {
      const moveId = volatile.moveId ?? "";
      const foes = (mon.side.foe.active as readonly (WritablePokemon | null)[]).filter((foe): foe is WritablePokemon => !!foe && !foe.fainted);
      let targetLoc: number;
      if (ctx.own && pub.lastMoveTarget) {
        targetLoc = pub.lastMoveTarget.side === mon.side.id ? -(pub.lastMoveTarget.position + 1) : pub.lastMoveTarget.position + 1;
      } else {
        // The charging move's target is not shown (-prepare names no target): drawn over the living foes.
        targetLoc = foes.length ? locOf(mon, pick(foes, random)) : 1;
        if (ctx.own) ctx.approximations.add("Charging move's target drawn.");
      }
      return { twoturnmove: state("twoturnmove", { duration: 1, move: moveId }), [moveId]: state(moveId, { duration: 1, targetLoc }) };
    }
    case "mustrecharge": return { mustrecharge: state("mustrecharge", { duration: 1 }) };
    case "encore": return { encore: state("encore", { move: volatile.moveId ?? pub.lastMove ?? "", duration: left(3 + (volatile.targetMovedFirst ? 1 : 0), since, turn) }) };
    case "taunt": return { taunt: state("taunt", { duration: left(3 + (volatile.targetMovedFirst && pub.activeTurns > 0 ? 1 : 0), since, turn) }) };
    // Disable: 5, one less when the target had not moved yet that turn (data/moves.ts disable condition onStart).
    case "disable": return { disable: state("disable", { move: volatile.moveId ?? "", duration: left(volatile.targetMovedFirst ? 5 : 4, since, turn) }) };
    case "yawn": return { yawn: state("yawn", { duration: left(2, since, turn), source: ctx.monOf(volatile.sourceKey) ?? undefined }) };
    case "perishsong": return { perishsong: state("perishsong", { duration: Math.max(1, volatile.layers ?? 3) }) };
    case "partiallytrapped": {
      const source = ctx.monOf(volatile.sourceKey);
      const total = source?.getItem().id === "gripclaw" ? 8 : pick([5, 6], random);
      return { partiallytrapped: state("partiallytrapped", {
        duration: left(total, since, turn), source: source ?? undefined, sourceSlot: source?.getSlot(),
        sourceEffect: battle.dex.moves.get(volatile.moveId ?? "wrap"), boundDivisor: source?.getItem().id === "bindingband" ? 6 : 8,
      }) };
    }
    case "leechseed": {
      const source = ctx.monOf(volatile.sourceKey);
      return { leechseed: state("leechseed", { source: source ?? undefined, sourceSlot: source?.getSlot() ?? (mon.side.foe.active[0] as WritablePokemon | null)?.getSlot() }) };
    }
    case "substitute":
      ctx.approximations.add("Substitute HP assumed full.");
      return { substitute: state("substitute", { hp: Math.floor(mon.maxhp / 4) }) };
    case "stockpile": return { stockpile: state("stockpile", { layers: volatile.layers ?? 1 }) };
    case "attract": return { attract: state("attract", { source: ctx.monOf(volatile.sourceKey) ?? undefined }) };
    // Psychic Noise's Heal Block lasts 2 turns, Heal Block's 5 (data/moves.ts healblock condition durationCallback).
    case "healblock": return { healblock: state("healblock", { duration: left(volatile.moveId === "psychicnoise" ? 2 : 5, since, turn) }) };
    // Dragon Cheer remembers whether the target was a Dragon type when it started (data/moves.ts dragoncheer condition onStart).
    case "dragoncheer": return { dragoncheer: state("dragoncheer", { hasDragonType: mon.hasType("Dragon") }) };
    case "trapped": {
      const source = ctx.monOf(volatile.sourceKey);
      if (!source) return null;
      // Linked with the source's "trapper" (data/moves.ts meanlook onHit addVolatile(..., 'trapper')).
      source.volatiles.trapper = battle.initEffectState({ id: "trapper", target: source, linkedPokemon: [mon], linkedStatus: "trapped" });
      return { trapped: state("trapped", { source, linkedPokemon: [source], linkedStatus: "trapper" }) };
    }
    default:
      if (COUNTDOWN[id] !== undefined) return { [id]: state(id, { duration: left(COUNTDOWN[id], since, turn) }) };
      if (PLAIN.has(id)) return { [id]: state(id) };
      ctx.approximations.add(`Effect not rebuilt: ${id}.`);
      return null;
  }
}
