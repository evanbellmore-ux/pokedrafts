// SPEC 10.7: the simultaneous turn as a zero-sum matrix game (the AI's rows maximise M). Regret matching+ with alternating
// updates and linear averaging, deterministic; the robust response for "Reads you"; purification and seeded sampling.
import type { AIRandom } from "../model/decision";

export type Solution = {
  /** The AI's maximin strategy x* and the player's minimax strategy y*. */
  x: number[]; y: number[];
  /** v* = min_b (x*ᵀM)_b: what x* guarantees. */
  value: number;
  /** (max_a (M y*)_a − min_b (x*ᵀ M)_b) / spread(M): 0 at an equilibrium; 0 when every entry is equal. */
  exploitability: number;
  /** max M − min M. */
  spread: number;
};

const uniform = (n: number) => Array.from({ length: n }, () => 1 / n);
function normalise(values: ArrayLike<number>): number[] {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total > 0 ? Array.from(values, (value) => value / total) : uniform(values.length);
}
export function spreadOf(M: readonly (readonly number[])[]): number {
  let min = Infinity, max = -Infinity;
  for (const row of M) for (const value of row) { if (value < min) min = value; if (value > max) max = value; }
  return Number.isFinite(min) ? max - min : 0;
}
/** (M y)_a for every row. */
export function rowPayoffs(M: readonly (readonly number[])[], y: readonly number[]): number[] {
  return M.map((row) => row.reduce((sum, value, j) => sum + value * y[j], 0));
}
/** (xᵀ M)_b for every column. */
export function columnPayoffs(M: readonly (readonly number[])[], x: readonly number[]): number[] {
  const B = M[0]?.length ?? 0;
  const out = new Array<number>(B).fill(0);
  for (let i = 0; i < M.length; i++) for (let j = 0; j < B; j++) out[j] += x[i] * M[i][j];
  return out;
}

/**
 * RM+ (Tammelin 2014): regrets clipped at 0, the row player updated first and the column player against the new x
 * (alternating), strategies averaged with weight t (linear averaging). Deterministic: no randomness.
 */
export function solveZeroSum(M: readonly (readonly number[])[], iterations = 2000): Solution {
  const A = M.length, B = M[0]?.length ?? 0;
  if (!A || !B) return { x: uniform(A), y: uniform(B), value: 0, exploitability: 0, spread: 0 };
  const spread = spreadOf(M);
  if (spread === 0) {
    const x = uniform(A), y = uniform(B);
    return { x, y, value: M[0][0], exploitability: 0, spread: 0 };
  }
  const rx = new Float64Array(A), ry = new Float64Array(B), sx = new Float64Array(A), sy = new Float64Array(B);
  let y = uniform(B);
  for (let t = 1; t <= iterations; t++) {
    const x = normalise(rx);
    const ux = rowPayoffs(M, y);
    const vx = ux.reduce((sum, value, i) => sum + value * x[i], 0);
    for (let i = 0; i < A; i++) rx[i] = Math.max(0, rx[i] + ux[i] - vx);
    const xNext = normalise(rx);
    const uy = columnPayoffs(M, xNext).map((value) => -value);
    const vy = uy.reduce((sum, value, j) => sum + value * y[j], 0);
    for (let j = 0; j < B; j++) ry[j] = Math.max(0, ry[j] + uy[j] - vy);
    y = normalise(ry);
    for (let i = 0; i < A; i++) sx[i] += t * xNext[i];
    for (let j = 0; j < B; j++) sy[j] += t * y[j];
  }
  const x = normalise(sx), yStar = normalise(sy);
  const value = Math.min(...columnPayoffs(M, x));
  const best = Math.max(...rowPayoffs(M, yStar));
  return { x, y: yStar, value, exploitability: Math.max(0, best - value) / spread, spread };
}

function softmax(values: readonly number[], tau: number): number[] {
  if (!(tau > 0)) return uniform(values.length);
  const top = Math.max(...values);
  return normalise(values.map((value) => Math.exp((value - top) / tau)));
}

/**
 * Reads you (SPEC 10.7): x_r = softmax(Mq/τ) with τ = tauShare × (max(Mq) − min(Mq)) (uniform when 0), then the first
 * ρ ∈ {0, .25, .5, .75, 1} with min_b(((1−ρ)x_r + ρx*)ᵀM)_b ≥ v* − epsilonShare × spread(M); ρ = 1 is x* itself.
 */
export function robustResponse(M: readonly (readonly number[])[], q: readonly number[], safe: Solution, options: { tauShare: number; epsilonShare: number } = { tauShare: 0.1, epsilonShare: 0.1 }): number[] {
  const payoff = rowPayoffs(M, q);
  const range = Math.max(...payoff) - Math.min(...payoff);
  const xr = range > 0 ? softmax(payoff, options.tauShare * range) : uniform(M.length);
  const floor = safe.value - options.epsilonShare * safe.spread;
  for (const rho of [0, 0.25, 0.5, 0.75]) {
    const mixed = xr.map((value, i) => (1 - rho) * value + rho * safe.x[i]);
    if (Math.min(...columnPayoffs(M, mixed)) >= floor - 1e-12) return mixed;
  }
  return [...safe.x];
}

/** Row k weakly dominates row i: at least as good against every column and better against one. */
function dominates(M: readonly (readonly number[])[], k: number, i: number): boolean {
  let better = false;
  for (let j = 0; j < M[i].length; j++) {
    if (M[k][j] < M[i][j]) return false;
    if (M[k][j] > M[i][j]) better = true;
  }
  return better;
}
/**
 * Each weakly dominated row's weight moves to an undominated row that dominates it (the one with the largest row sum,
 * then the first), so no column pays the AI less: a row as good or better everywhere is played instead.
 */
export function undominated(M: readonly (readonly number[])[], p: readonly number[]): number[] {
  const A = M.length;
  const out = [...p];
  const sums = M.map((row) => row.reduce((sum, value) => sum + value, 0));
  const dominated = M.map((_, i) => M.some((__, k) => k !== i && dominates(M, k, i)));
  for (let i = 0; i < A; i++) {
    if (!(out[i] > 0) || !dominated[i]) continue;
    let best = -1;
    for (let k = 0; k < A; k++) {
      if (k === i || dominated[k] || !dominates(M, k, i)) continue;
      if (best < 0 || sums[k] > sums[best]) best = k;
    }
    if (best < 0) continue;
    out[best] += out[i];
    out[i] = 0;
  }
  return out;
}

/** Drop probabilities below `floor` and renormalise; the most likely option stays when every one is below it. */
export function purify(p: readonly number[], floor = 0.05): number[] {
  if (!p.length) return [];
  const kept = p.map((value) => value >= floor ? value : 0);
  if (kept.every((value) => value === 0)) {
    const top = p.indexOf(Math.max(...p));
    return p.map((_, i) => i === top ? 1 : 0);
  }
  return normalise(kept);
}

/** An index drawn with one uniform draw of `random` (the last positive one on rounding). */
export function sample(p: readonly number[], random: AIRandom): number {
  const total = p.reduce((sum, value) => sum + value, 0);
  let u = random.float() * total;
  let last = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i] <= 0) continue;
    last = i;
    u -= p[i];
    if (u < 0) return i;
  }
  return last;
}
