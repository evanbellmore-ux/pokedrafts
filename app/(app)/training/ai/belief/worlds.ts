// SPEC 10.1.3 belief worlds: world 0 is the MAP set of each brought member, worlds 1..k−1 sample bring and sets.
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { AiInputs, BeliefWorld } from "../../model/ai-inputs";
import type { AIRandom } from "../../model/decision";
import { seedHex } from "../../model/random";
import type { SheetMember } from "../../model/sheet";
import type { ShowdownSet } from "../../model/showdown-types";
import { otherSide, outOfBattleForm } from "../battle-facts";
import type { SetCandidate } from "./types";
import type { MemberState } from "./update";

/** Picked Team Size = Auto: 4 in doubles (PS/sim/dex-formats.ts:336-341). */
export const BROUGHT = 4;

/** The player's members the AI has seen: active now, or ever switched in, or fainted (PublicMon), by SheetMember key. */
export function revealedMembers(inputs: AiInputs): { actives: string[]; revealed: Set<string> } {
  const side = otherSide(inputs.perspective);
  const prefix = `${side}:`;
  const actives: { key: string; position: number }[] = [];
  const revealed = new Set<string>();
  for (const [publicKey, mon] of Object.entries(inputs.public.mons)) {
    if (mon.side !== side || !publicKey.startsWith(prefix)) continue;
    const key = publicKey.slice(prefix.length);
    if (mon.position !== null || mon.switchIns > 0 || mon.fainted) revealed.add(key);
    if (mon.position !== null) actives.push({ key, position: mon.position });
  }
  return { actives: actives.sort((a, b) => a.position - b.position).map((entry) => entry.key), revealed };
}

/** The set one candidate gives a sheet member (SPEC 10.1.3): sheet species and gender, IVs 31, level 50, name = species. */
export function beliefSet(member: SheetMember, candidate: SetCandidate, moves: readonly string[], runtime: BattleRuntime): ShowdownSet {
  // A Mega form is sent as its base species holding its stone (SPEC 7.5).
  const form = outOfBattleForm(member.speciesId, runtime);
  const species = runtime.speciesById.get(form.speciesId);
  const itemId = form.stone ?? candidate.itemId;
  const abilityId = form.stone && !species?.abilities.includes(candidate.abilityId) ? species?.abilities[0] ?? candidate.abilityId : candidate.abilityId;
  const name = species?.name ?? form.speciesId;
  const gender = member.gender ?? species?.gender ?? "M";
  return {
    name, species: name,
    item: itemId ? runtime.itemsById.get(itemId)?.name ?? itemId : "",
    ability: runtime.abilitiesById.get(abilityId)?.name ?? abilityId,
    moves: moves.map((id) => runtime.movesById.get(id)?.name ?? id),
    nature: candidate.nature, gender,
    evs: { ...candidate.points },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  };
}

const posterior = (candidates: readonly SetCandidate[]) => {
  const best = Math.max(...candidates.map((candidate) => candidate.logWeight));
  const masses = candidates.map((candidate) => Math.exp(candidate.logWeight - best));
  const total = masses.reduce((sum, mass) => sum + mass, 0);
  return masses.map((mass) => mass / total);
};
/** Index drawn ∝ weights with one uniform draw. */
function draw(weights: readonly number[], random: AIRandom): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return 0;
  let u = random.float() * total;
  for (let i = 0; i < weights.length; i++) { u -= weights[i]; if (u < 0) return i; }
  return weights.length - 1;
}

export type WorldArgs = {
  members: readonly MemberState[];               // sheet order
  sheet: readonly SheetMember[];
  moves: Readonly<Record<string, string[]>>;
  bring: Readonly<Record<string, number>>;
  inputs: AiInputs;
  k: number; random: AIRandom; seedBase: string; runtime: BattleRuntime;
};

/**
 * World 0: bring = the actives by position, the other revealed members, then the highest bring chances (TestReveals.brought:
 * the true four); each member's heaviest candidate whose item no earlier member holds in that world (Item Clause; "" may
 * repeat); hp "midpoint". Worlds 1..k−1: the unrevealed part of the bring drawn without replacement ∝ bring, each brought
 * member's candidate drawn ∝ posterior among those whose item is free, members in sheet order; hp "sample". Weights 1/k.
 */
export function beliefWorlds(args: WorldArgs): BeliefWorld[] {
  const { members, sheet, inputs, k, random, seedBase, runtime } = args;
  const { actives, revealed } = revealedMembers(inputs);
  const byKey = new Map(members.map((member) => [member.key, member]));
  const order = sheet.map((member) => member.key).filter((key) => byKey.has(key));
  const size = Math.min(BROUGHT, order.length);
  const known = inputs.reveals.brought ? [...inputs.reveals.brought].filter((key) => byKey.has(key)) : null;
  const worlds: BeliefWorld[] = [];
  for (let w = 0; w < Math.max(1, k); w++) {
    const brought: string[] = [...actives.filter((key) => byKey.has(key))];
    const push = (key: string) => { if (brought.length < size && !brought.includes(key)) brought.push(key); };
    for (const key of order) if (revealed.has(key)) push(key);
    if (known) for (const key of known) push(key);
    const rest = order.filter((key) => !brought.includes(key));
    if (w === 0) {
      for (const key of [...rest].sort((a, b) => (args.bring[b] ?? 0) - (args.bring[a] ?? 0) || order.indexOf(a) - order.indexOf(b))) push(key);
    } else {
      const pool = [...rest];
      while (brought.length < size && pool.length) {
        const index = draw(pool.map((key) => Math.max(1e-9, args.bring[key] ?? 0)), random);
        push(pool[index]);
        pool.splice(index, 1);
      }
    }
    const used = new Set<string>();
    const sets: Record<string, ShowdownSet> = {};
    for (const key of order.filter((each) => brought.includes(each))) {
      const member = byKey.get(key)!;
      const candidates = member.candidates;
      const free = candidates.map((candidate) => candidate.itemId === "" || !used.has(candidate.itemId));
      let index: number;
      if (w === 0) {
        index = free.indexOf(true);
        if (index < 0) index = 0;
      } else {
        const weights = posterior(candidates).map((mass, i) => free[i] ? mass : 0);
        index = weights.some((weight) => weight > 0) ? draw(weights, random) : 0;
      }
      const chosen = candidates[index];
      if (chosen.itemId) used.add(chosen.itemId);
      const sheetMember = sheet.find((each) => each.key === key)!;
      sets[key] = beliefSet(sheetMember, chosen, args.moves[key] ?? [], runtime);
    }
    worlds.push({ weight: 1 / Math.max(1, k), brought, sets, hp: w === 0 ? "midpoint" : "sample", seed: seedHex(seedBase, "world", w) });
  }
  return worlds;
}
