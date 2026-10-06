// SPEC 10.1.2 belief updates, once per new TurnObservations record: hard reveals, entry silence, speed order, damage; pruning.
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild } from "@/app/lib/battle/types";
import type { DamageObservation, EntryObservation, OrderObservation, RevealObservation } from "../../model/public-state";
import { buildFromCandidate, inForm, megaFormFor, pointsKey, splitPublicKey, toId } from "../battle-facts";
import { atHitSnapshot, damageLikelihood, EPSILON, orderLikelihood, type DamageMemo } from "./likelihood";
import type { SetCandidate } from "./types";

/** Candidates kept per member (SPEC 10.1.1 joint candidates). */
export const CANDIDATES_KEPT = 48;
/** Candidates more than ln(10⁴) below the best are dropped (SPEC 10.1.2 pruning). */
export const PRUNE_LOG = Math.log(1e4);
/** At most this many candidate × observation likelihoods per member per turn (SPEC 10.1.2 cost cap: 48 × 12). */
export const COST_CAP = CANDIDATES_KEPT * 12;
/** Copies of the top candidates made when a hard reveal matches none (SPEC 10.1.2). */
const REVEAL_COPIES = 8;

/**
 * Abilities that announce themselves on entry (PS/data/abilities.ts onStart: intimidate 2193, pressure 3437, unnerve 5258,
 * moldbreaker 2689, cloudnine 543, supersweetsyrup 4712, drought 1088, drizzle 1078, sandstream 3997, snowwarning 4387,
 * grassysurge 1707, electricsurge 1179, psychicsurge 3580). "conditional": silent when there is no adjacent foe
 * (Intimidate), on a second entry (Supersweet Syrup's syrupTriggered), or when its weather or terrain is already up
 * (setWeather / setTerrain fail without a message); the entry record does not carry those, so silence is weaker evidence.
 */
export const ENTRY_ANNOUNCED: Readonly<Record<string, "always" | "conditional">> = {
  pressure: "always", unnerve: "always", moldbreaker: "always", cloudnine: "always",
  intimidate: "conditional", supersweetsyrup: "conditional", drought: "conditional", drizzle: "conditional", sandstream: "conditional",
  snowwarning: "conditional", grassysurge: "conditional", electricsurge: "conditional", psychicsurge: "conditional",
};
/** P(silent entry) for a candidate whose ability announces: ε when it always does, more when a condition can stop it. */
const SILENT_CONDITIONAL = 0.25;

/** One of the player's members as the belief holds it (model.ts). */
export type MemberState = {
  key: string; speciesId: string; publicKey: string;
  candidates: SetCandidate[];
  seenMoves: string[];
  itemGone: boolean;
  /** Facts the battle showed (or the sheet opens): the set's item and ability; Choice ruled out; the turn it Mega Evolved. */
  hard: { item: string | null; ability: string | null; notChoice: boolean; megaTurn: number | null };
};

export const candidateId = (candidate: Pick<SetCandidate, "points" | "nature" | "itemId" | "abilityId">) =>
  `${pointsKey(candidate.points)}|${candidate.nature}|${candidate.itemId}|${candidate.abilityId}`;

const logSumExp = (a: number, b: number) => { const m = Math.max(a, b); return m === -Infinity ? m : m + Math.log(Math.exp(a - m) + Math.exp(b - m)); };

/** Heaviest first (ties keep their order), equal ids merged (log weights added as masses), at most CANDIDATES_KEPT. */
export function normaliseCandidates(candidates: readonly SetCandidate[]): SetCandidate[] {
  const byId = new Map<string, SetCandidate>();
  for (const candidate of candidates) {
    const known = byId.get(candidate.id);
    if (known) known.logWeight = logSumExp(known.logWeight, candidate.logWeight);
    else byId.set(candidate.id, { ...candidate });
  }
  return [...byId.values()].map((candidate, order) => ({ candidate, order }))
    .sort((a, b) => b.candidate.logWeight - a.candidate.logWeight || a.order - b.order).slice(0, CANDIDATES_KEPT).map(({ candidate }) => candidate);
}
/** Drop candidates more than PRUNE_LOG below the best; always keep one. */
export function prune(candidates: readonly SetCandidate[]): SetCandidate[] {
  if (!candidates.length) return [];
  const best = Math.max(...candidates.map((candidate) => candidate.logWeight));
  const kept = candidates.filter((candidate) => candidate.logWeight >= best - PRUNE_LOG);
  return kept.length ? kept : [candidates[0]];
}

/**
 * Keep the candidates that pass `test`; when none does, copies of the REVEAL_COPIES heaviest changed by `make` (SPEC 10.1.2:
 * a hard reveal never empties a member).
 */
export function restrict(candidates: readonly SetCandidate[], test: (candidate: SetCandidate) => boolean, make: (candidate: SetCandidate) => SetCandidate): SetCandidate[] {
  const kept = candidates.filter(test);
  if (kept.length) return normaliseCandidates(kept);
  return normaliseCandidates(candidates.slice(0, REVEAL_COPIES).map((candidate) => { const next = make(candidate); return { ...next, id: candidateId(next) }; }));
}

/** The item a reveal names as the set's own: the stone for a Mega Evolution (PS/sim/battle-actions.ts runMegaEvo shows `-mega`). */
export function revealedItem(reveal: RevealObservation, speciesId: string, runtime: BattleRuntime): string | null {
  if (reveal.kind === "item" || reveal.kind === "item-gone") return toId(reveal.id);
  if (reveal.kind === "mega") {
    const id = toId(reveal.id);
    if (runtime.itemsById.get(id)?.megaStone) return id;
    // A species id instead of the stone: the stone of that Mega form.
    const form = runtime.speciesById.get(id);
    return form?.requiredItem ?? null;
  }
  return null;
}

/** Apply one hard item fact to a member (its own candidates). */
export function applyItem(member: MemberState, itemId: string) {
  member.hard.item = itemId;
  member.candidates = restrict(member.candidates, (candidate) => candidate.itemId === itemId, (candidate) => ({ ...candidate, itemId }));
}
export function applyAbility(member: MemberState, abilityId: string) {
  member.hard.ability = abilityId;
  member.candidates = restrict(member.candidates, (candidate) => candidate.abilityId === abilityId, (candidate) => ({ ...candidate, abilityId }));
}
/** Item Clause (Flat Rules, PS/data/mods/champions/rulesets.ts:28-32): an item known on one member is no other member's. */
export function applyItemClause(members: readonly MemberState[], fallback: (member: MemberState, taken: ReadonlySet<string>) => string) {
  const taken = new Map<string, string>();
  for (const member of members) if (member.hard.item) taken.set(member.hard.item, member.key);
  for (const member of members) {
    if (member.hard.item) continue;
    const others = new Set([...taken].filter(([item, owner]) => item !== "" && owner !== member.key).map(([item]) => item));
    if (!member.candidates.some((candidate) => others.has(candidate.itemId))) continue;
    const replacement = fallback(member, others);
    member.candidates = restrict(member.candidates, (candidate) => !others.has(candidate.itemId), (candidate) => ({ ...candidate, itemId: replacement }));
  }
}

/** Entry silence (SPEC 10.1.2): an entry with no announcement weighs down candidates whose ability announces on entry. */
export function applyEntry(member: MemberState, entry: EntryObservation) {
  const announced = new Set(entry.announced.map(toId));
  member.candidates = normaliseCandidates(member.candidates.map((candidate) => {
    const kind = ENTRY_ANNOUNCED[candidate.abilityId];
    if (!kind || announced.has(candidate.abilityId)) return candidate;
    return { ...candidate, logWeight: candidate.logWeight + Math.log(kind === "always" ? EPSILON : SILENT_CONDITIONAL) };
  }));
}

/**
 * The build a candidate gives at one moment, stages and status set by the caller: its Mega form once the battle showed the
 * Mega Evolution (megaTurn ≤ turn), else the form shown then when it is a form of the same species (an Illusion's disguise
 * is not), else the sheet's.
 */
export function candidateBuild(member: MemberState, candidate: SetCandidate, turn: number, shown: string, runtime: BattleRuntime): BattleBuild {
  const build = buildFromCandidate(member.speciesId, candidate, runtime);
  const family = (id: string) => runtime.speciesById.get(id)?.baseSpecies ?? id;
  const sameSpecies = shown !== member.speciesId && runtime.speciesById.has(shown) && family(shown) === family(member.speciesId);
  const form = member.hard.megaTurn !== null && member.hard.megaTurn <= turn
    ? megaFormFor(member.speciesId, candidate.itemId, runtime) ?? (sameSpecies ? shown : null)
    : sameSpecies ? shown : null;
  return form ? inForm(build, form, runtime) : build;
}

export type LikelihoodBudget = { used: Map<string, number>; skipped: number };
/** Multiply each candidate's weight by a likelihood; returns false when the member's cost cap is spent. */
function weigh(member: MemberState, budget: LikelihoodBudget, likelihood: (candidate: SetCandidate) => number | null): boolean {
  const used = budget.used.get(member.key) ?? 0;
  if (used + member.candidates.length > COST_CAP) { budget.skipped++; return false; }
  budget.used.set(member.key, used + member.candidates.length);
  const values = member.candidates.map(likelihood);
  if (values.every((value) => value === null)) return true;
  member.candidates = normaliseCandidates(member.candidates.map((candidate, index) => {
    const value = values[index];
    return value === null ? candidate : { ...candidate, logWeight: candidate.logWeight + Math.log(value) };
  }));
  return true;
}

/** SPEC 10.1.2 speed order, for a pair with exactly one of the player's Pokémon. */
export function applyOrder(member: MemberState, observation: OrderObservation, turn: number, playerFirst: boolean, aiBuild: BattleBuild, formNow: string, runtime: BattleRuntime, budget: LikelihoodBudget) {
  weigh(member, budget, (candidate) => {
    const own = candidateBuild(member, candidate, turn, formNow, runtime);
    return playerFirst ? orderLikelihood(observation, own, aiBuild, runtime) : orderLikelihood(observation, aiBuild, own, runtime);
  });
}

/** SPEC 10.1.2 damage, for a hit between one of the player's Pokémon and one of the AI's. */
export function applyDamage(member: MemberState, observation: DamageObservation, turn: number, playerAttacks: boolean, aiBuild: BattleBuild, runtime: BattleRuntime,
  budget: LikelihoodBudget, memo: DamageMemo) {
  const playerSnapshot = playerAttacks ? observation.attacker : observation.defender;
  const aiSnapshot = playerAttacks ? observation.defender : observation.attacker;
  const ai = atHitSnapshot(aiBuild, aiSnapshot, runtime);
  weigh(member, budget, (candidate) => {
    const own = atHitSnapshot(candidateBuild(member, candidate, turn, playerSnapshot.speciesId, runtime), playerSnapshot, runtime);
    return playerAttacks ? damageLikelihood(observation, own, ai, runtime, memo) : damageLikelihood(observation, ai, own, runtime, memo);
  });
}

/** The TrainingMember.key of a PublicMon key on `side`, or null for the other side. */
export function memberOf(publicKey: string, side: string): string | null {
  const { side: owner, member } = splitPublicKey(publicKey);
  return owner === side ? member : null;
}
