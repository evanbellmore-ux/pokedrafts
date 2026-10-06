// Team pairs for the Training evaluation (SPEC §14.2): random pairs from the fixture pools, deterministic per (run, index).
import { createRandom } from "@/app/(app)/training/model/random";
import type { TrainingTeam } from "@/app/(app)/training/model/view-types";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { fixturesIn, fixtureTeam, type TeamFixture, type TeamPool } from "@/tests/fixtures/training-teams";

export type TeamPair = { p1: { id: string; team: TrainingTeam }; p2: { id: string; team: TrainingTeam } };

const cache = new Map<string, TrainingTeam>();
export function teamOf(fixture: TeamFixture, runtime: BattleRuntime = championsRuntime): TrainingTeam {
  const known = cache.get(fixture.id);
  if (known) return structuredClone(known);
  const team = fixtureTeam(fixture, runtime);
  cache.set(fixture.id, team);
  return structuredClone(team);
}

export function parsePools(text: string): TeamPool[] {
  const pools = text.split(",").map((part) => part.trim().toUpperCase()).filter(Boolean);
  for (const pool of pools) if (!["S", "V", "U", "A"].includes(pool)) throw new Error(`Unknown pool ${pool} (S, V, U, A).`);
  return pools as TeamPool[];
}

/** Two distinct teams from the pools for battle `index` of `run` (each side drawn uniformly). */
export function teamPair(run: string, index: number, pools: readonly TeamPool[], runtime: BattleRuntime = championsRuntime): TeamPair {
  const fixtures = fixturesIn(pools);
  if (fixtures.length < 2) throw new Error("Need at least two teams.");
  const random = createRandom(run, index, "teams");
  const first = random.int(fixtures.length);
  const other = random.int(fixtures.length - 1);
  const a = fixtures[first];
  const b = fixtures[other >= first ? other + 1 : other];
  return { p1: { id: a.id, team: teamOf(a, runtime) }, p2: { id: b.id, team: teamOf(b, runtime) } };
}

/**
 * Mirrored pairs for win-rate gates: battles 2k and 2k + 1 play one random pair (teamPair of pair k) with the teams'
 * sides swapped, so a strong team helps each seat equally often (team matchups decided most results:
 * scripts/.cache/training/review-ai/ "Win-rate gates depend on the run name").
 */
export function mirroredPair(run: string, index: number, pools: readonly TeamPool[], runtime: BattleRuntime = championsRuntime): TeamPair {
  const pair = teamPair(`${run}:mirrored`, Math.floor(index / 2), pools, runtime);
  return index % 2 === 0 ? pair : { p1: pair.p2, p2: pair.p1 };
}
