// SPEC 10.11 team preview: which four the AI brings and which two lead. Pair scores from calculateTurnMove at full HP on a
// neutral Doubles field (the player's six as the belief's MAP builds and moves, open categories from the sheet), a bring
// model of the player blended with bring and lead habits, and the 90 configurations (15 subsets of four × 6 lead pairs).
import { calculateTurnMove, turnSpeed } from "@/app/lib/battle/calculate";
import { createConditions, getBuildStats } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";
import type { AIRandom } from "../model/decision";
import type { SheetView } from "../model/sheet";
import type { DecisionReport, TrainingDifficulty, TrainingTeam } from "../model/view-types";
import { inForm, megaFormFor, typeEffectiveness, TYPE_NAMES } from "./battle-facts";
import { fieldOfAbility, favorOf, type FieldSetting } from "./field-favor";
import type { HabitsData } from "./habits";
import { rowMean, SPREAD_TARGETS } from "./rows";

/** P_bring's softmax temperature (SPEC 10.11). */
export const BRING_TEMPERATURE = 0.15;
/** The Speed relation's share of a pair score. */
export const PAIR_SPEED = 0.15;
/** Reads you: softmax temperature over the top 3 configurations. */
export const READS_TEMPERATURE = 0.1;
const BROUGHT = 4;

export type PreviewMember = { key: string; build: BattleBuild; moves: readonly string[] };
export type PreviewArgs = {
  runtime: BattleRuntime;
  ai: TrainingTeam;
  sheet: SheetView;
  /** The player's six as the belief's MAP builds (BeliefModel.mapBuilds) and moves (its moves belief), by SheetMember key. */
  builds: Record<string, BattleBuild>;
  moves: Record<string, readonly string[]>;
  habits: HabitsData | null;
  difficulty: TrainingDifficulty;
  random: AIRandom;
};
export type PreviewResult = {
  /** 1-based into ai.members, four entries, the two leads first. */
  order: number[];
  /** The player's bring chances (four in total), for BeliefModel.setBring. */
  bring: Record<string, number>;
  report: DecisionReport;
  /** Every configuration's value, for tests and tuning. */
  configurations: { members: number[]; leads: [number, number]; value: number }[];
};

const neutral = (): BattleConditions => ({ ...createConditions(), gameType: "Doubles" });
/** The form a member battles in most: its Mega form when it holds its own stone (pinned champions scripts.ts:183-195). */
function battleForm(build: BattleBuild, runtime: BattleRuntime): BattleBuild {
  const form = megaFormFor(build.speciesId, build.itemId, runtime);
  return form ? inForm(build, form, runtime) : build;
}
/** Base accuracy with the holder's and target's sure modifiers (SPEC 10.3 subset: No Guard, Compound Eyes, Hustle, Wide Lens, Bright Powder). */
function accuracyOf(moveId: string, attacker: BattleBuild, defender: BattleBuild, runtime: BattleRuntime): number {
  const move = runtime.movesById.get(moveId);
  if (!move || move.accuracy === null || attacker.abilityId === "noguard" || defender.abilityId === "noguard") return 1;
  let accuracy = move.accuracy;
  if (attacker.abilityId === "compoundeyes") accuracy *= 5325 / 4096;
  if (attacker.abilityId === "hustle" && move.category === "Physical") accuracy *= 3277 / 4096;
  if (attacker.itemId === "widelens") accuracy *= 4505 / 4096;
  if (defender.itemId === "brightpowder") accuracy *= 3686 / 4096;
  return Math.min(1, accuracy / 100);
}
/** off(i→j): the best fraction × accuracy of the attacker's damaging moves into the defender at full HP. */
function offense(attacker: PreviewMember, defender: PreviewMember, runtime: BattleRuntime, field: BattleConditions): number {
  const maxHp = getBuildStats(defender.build, runtime)?.hp ?? 1;
  let best = 0;
  for (const moveId of attacker.moves) {
    const move = runtime.movesById.get(moveId);
    if (!move || move.category === "Status") continue;
    try {
      const row = calculateTurnMove(move, attacker.build, defender.build, { ...field, multipleTargets: SPREAD_TARGETS.has(move.target) }, undefined, runtime);
      if (row.kind !== "calculated" || row.min === null) continue;
      best = Math.max(best, Math.min(1, rowMean(row) / maxHp) * accuracyOf(moveId, attacker.build, defender.build, runtime));
    } catch {
      continue;
    }
  }
  return best;
}
function softmax(values: readonly number[], tau: number): number[] {
  const top = Math.max(...values);
  const raw = values.map((value) => Math.exp((value - top) / tau));
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / total);
}
/** Chances summing to `total`, none above 1 (the excess spread over the rest in proportion). */
export function capToOne(values: readonly number[], total: number): number[] {
  const out = [...values];
  const capped = new Set<number>();
  for (let round = 0; round < out.length; round++) {
    const free = out.map((_, i) => i).filter((i) => !capped.has(i));
    const freeTotal = free.reduce((sum, i) => sum + out[i], 0);
    const left = total - capped.size;
    for (const i of free) out[i] = freeTotal > 0 ? out[i] * left / freeTotal : left / Math.max(1, free.length);
    const over = free.filter((i) => out[i] > 1);
    if (!over.length) break;
    for (const i of over) { out[i] = 1; capped.add(i); }
  }
  return out;
}
const pairs = <T,>(list: readonly T[]): [T, T][] => list.flatMap((a, i) => list.slice(i + 1).map((b) => [a, b] as [T, T]));
function subsets(n: number, k: number): number[][] {
  const out: number[][] = [];
  const walk = (start: number, chosen: number[]) => {
    if (chosen.length === k) { out.push(chosen); return; }
    for (let i = start; i < n; i++) walk(i + 1, [...chosen, i]);
  };
  walk(0, []);
  return out;
}
/** The weather or terrain a member sets: its ability on entry, else a weather or terrain move it carries. */
function fieldSetter(member: PreviewMember): FieldSetting | null {
  const byAbility = fieldOfAbility(member.build.abilityId);
  if (byAbility) return byAbility;
  const moves: Record<string, FieldSetting> = {
    sunnyday: { weather: "Sun" }, raindance: { weather: "Rain" }, sandstorm: { weather: "Sand" }, snowscape: { weather: "Snow" },
    electricterrain: { terrain: "Electric" }, grassyterrain: { terrain: "Grassy" }, psychicterrain: { terrain: "Psychic" }, mistyterrain: { terrain: "Misty" },
  };
  for (const moveId of member.moves) if (moves[moveId]) return moves[moveId];
  return null;
}

export type Matchups = {
  mine: PreviewMember[]; yours: PreviewMember[];
  /** off(i→j) for the AI's i into your j, and off(j→i). */
  offMine: number[][]; offYours: number[][];
  /** m(i,j) = off(i→j) − off(j→i) + 0.15·sign(spe_i − spe_j). */
  m: number[][];
  /** turnSpeed on a neutral field. */
  speeds: { mine: number[]; yours: number[] };
};
/** SPEC 10.11 step 1: the pair scores of the AI's members against yours. */
export function previewMatchups(args: Pick<PreviewArgs, "runtime" | "ai" | "sheet" | "builds" | "moves">): Matchups {
  const { runtime, ai, sheet } = args;
  const field = neutral();
  const mine: PreviewMember[] = ai.members.map((member) => ({
    key: member.key, build: battleForm(member.build, runtime), moves: member.moves.map((slot) => slot.moveId).filter((id): id is string => !!id),
  }));
  const yours: PreviewMember[] = sheet.members.map((member) => {
    const build = args.builds[member.key];
    return { key: member.key, build: battleForm(build, runtime), moves: [...(args.moves[member.key] ?? member.moves ?? [])] };
  });
  const speed = (member: PreviewMember) => turnSpeed(member.build, false, field, runtime);
  const offMine = mine.map((i) => yours.map((j) => offense(i, j, runtime, field)));
  const offYours = yours.map((j) => mine.map((i) => offense(j, i, runtime, field)));
  const speeds = { mine: mine.map(speed), yours: yours.map(speed) };
  const m = mine.map((_, i) => yours.map((_, j) => offMine[i][j] - offYours[j][i] + PAIR_SPEED * Math.sign(speeds.mine[i] - speeds.yours[j])));
  return { mine, yours, offMine, offYours, m, speeds };
}

/**
 * Addendum A1.4: the four's support value, so a redirector or a speed-control setter earns a place beside the attackers
 * (pair scores count damage only): Follow Me or Rage Powder +0.2; Tailwind +0.05 per partner slower than the player's
 * median Speed; Trick Room +0.08 per such partner beyond the first; Fake Out +0.04.
 */
export function supportValue(members: readonly number[], mine: readonly PreviewMember[], speeds: Matchups["speeds"]): number {
  const sorted = [...speeds.yours].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
  let total = 0;
  for (const i of members) {
    const moves = mine[i].moves;
    const slower = members.filter((k) => k !== i && speeds.mine[k] < median).length;
    if (moves.includes("followme") || moves.includes("ragepowder")) total += 0.2;
    if (moves.includes("tailwind")) total += 0.05 * slower;
    if (moves.includes("trickroom")) total += 0.08 * Math.max(0, slower - 1);
    if (moves.includes("fakeout")) total += 0.04;
  }
  return total;
}

export function teamPreview(args: PreviewArgs): PreviewResult {
  const { runtime, sheet } = args;
  const { mine, yours, offMine, offYours, m, speeds } = previewMatchups(args);

  // Your bring model: b_j = mean_i(off(j→i) − off(i→j)); P_bring = 4·softmax(b/0.15), capped at 1; blended with bring habits.
  const size = Math.min(BROUGHT, yours.length);
  const b = yours.map((_, j) => mine.reduce((sum, _, i) => sum + offYours[j][i] - offMine[i][j], 0) / Math.max(1, mine.length));
  const model = capToOne(softmax(b, BRING_TEMPERATURE).map((p) => p * size), size);
  const habits = args.habits;
  const n = habits?.battles ?? 0;
  const lambda = 0.75 * n / (n + 8);
  const speciesOf = (j: number) => sheet.members[j].speciesId;
  const habitBring = capToOne(yours.map((_, j) => (habits?.brings[speciesOf(j)] ?? 0) + 1), size);
  const bringChance = capToOne(model.map((p, j) => (1 - lambda) * p + lambda * habitBring[j]), size);
  const bring = Object.fromEntries(yours.map((member, j) => [member.key, bringChance[j]]));

  // Your lead pairs: ∝ products of P_bring, blended with lead habits (+1 smoothing).
  const yourPairs = pairs(yours.map((_, j) => j));
  const byProduct = yourPairs.map(([x, y]) => bringChance[x] * bringChance[y]);
  const productTotal = byProduct.reduce((sum, value) => sum + value, 0) || 1;
  const leadHabit = yourPairs.map(([x, y]) => (habits?.leads[[speciesOf(x), speciesOf(y)].sort().join("+")] ?? 0) + 1);
  const leadTotal = leadHabit.reduce((sum, value) => sum + value, 0);
  const leadChance = yourPairs.map((_, k) => (1 - lambda) * byProduct[k] / productTotal + lambda * leadHabit[k] / leadTotal);

  // Its 90 configurations.
  const typesOf = (member: PreviewMember) => runtime.speciesById.get(member.build.speciesId)?.types ?? [];
  const configurations: PreviewResult["configurations"] = [];
  for (const members of subsets(mine.length, Math.min(BROUGHT, mine.length))) {
    const material = members.reduce((sum, i) => sum + yours.reduce((inner, _, j) => inner + bringChance[j] * m[i][j], 0) / Math.max(1, size), 0);
    const weak = TYPE_NAMES.filter((type) => members.filter((i) => typeEffectiveness(type, typesOf(mine[i])) > 1).length >= 3).length;
    const synergy = members.some((i) => {
      const setting = fieldSetter(mine[i]);
      return !!setting && members.some((k) => k !== i && favorOf(mine[k].moves, mine[k].build, setting, runtime) > 0);
    }) ? 1 : 0;
    const support = supportValue(members, mine, speeds);
    for (const leads of pairs(members)) {
      const lead = yourPairs.reduce((sum, pair, k) => sum + leadChance[k] * pair.reduce((inner, j) => inner + Math.max(...leads.map((i) => m[i][j])), 0) / 2, 0);
      configurations.push({ members, leads, value: material + lead - 0.1 * weak + 0.1 * synergy + support });
    }
  }
  const ranked = configurations.map((entry, index) => ({ entry, index })).sort((x, y) => y.entry.value - x.entry.value || x.index - y.index);
  let pick = ranked[0];
  if (args.difficulty === "reads" && ranked.length > 1) {
    const top = ranked.slice(0, 3);
    const chances = softmax(top.map((each) => each.entry.value), READS_TEMPERATURE);
    let u = args.random.float();
    pick = top[top.length - 1];
    for (let k = 0; k < top.length; k++) { u -= chances[k]; if (u < 0) { pick = top[k]; break; } }
  }
  const { members, leads } = pick.entry;
  // The lead with the larger expected edge goes first; the bench by its bring value.
  const edge = (i: number) => yours.reduce((sum, _, j) => sum + bringChance[j] * m[i][j], 0);
  const leadOrder = [...leads].sort((x, y) => edge(y) - edge(x) || x - y);
  const benchOrder = members.filter((i) => !leads.includes(i)).sort((x, y) => edge(y) - edge(x) || x - y);
  const order = [...leadOrder, ...benchOrder].map((i) => i + 1);

  const predictedLeads = yourPairs.map((pair, k) => ({ keys: pair.map((j) => yours[j].key), chance: leadChance[k] }))
    .sort((x, y) => y.chance - x.chance || (x.keys.join() < y.keys.join() ? -1 : 1)).slice(0, 3);
  const report: DecisionReport = {
    turn: 0, provider: "engine", difficulty: args.difficulty, predicted: [], strategy: [], chosen: 0, actual: null, reason: null, mega: null,
    assumed: [], elapsedMs: 0, evaluated: { yours: yourPairs.length, its: configurations.length }, preview: { predictedLeads },
  };
  return { order, bring, report, configurations };
}
