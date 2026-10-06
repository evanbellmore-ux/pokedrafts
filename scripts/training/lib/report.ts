// Training evaluation statistics and report lines (SPEC §14.2): win rates with Wilson 95% bounds (ties count ½), paired
// differences on shared seeds, quantiles, and the gate table. Pure: no simulator, no AI.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const Z95 = 1.959963984540054;

export type Interval = { estimate: number; low: number; high: number; n: number };
/** Wilson score interval for `score` successes out of `n` (a tie is ½ a success). */
export function wilson(score: number, n: number, z = Z95): Interval {
  if (n <= 0) return { estimate: Number.NaN, low: Number.NaN, high: Number.NaN, n: 0 };
  const p = score / n;
  const z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { estimate: p, low: Math.max(0, center - half), high: Math.min(1, center + half), n };
}
/** Mean of paired differences a_i − b_i with a normal 95% interval (same seeds on both sides). */
export function pairedDifference(a: readonly number[], b: readonly number[], z = Z95): Interval {
  const n = Math.min(a.length, b.length);
  if (!n) return { estimate: Number.NaN, low: Number.NaN, high: Number.NaN, n: 0 };
  const d = Array.from({ length: n }, (_, i) => a[i] - b[i]);
  const mean = d.reduce((sum, x) => sum + x, 0) / n;
  const variance = n > 1 ? d.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1) : 0;
  const half = z * Math.sqrt(variance / n);
  return { estimate: mean, low: mean - half, high: mean + half, n };
}
/** Nearest-rank quantile (p in [0, 1]); NaN for an empty list. */
export function quantile(values: readonly number[], p: number): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}
export const mean = (values: readonly number[]) => values.length ? values.reduce((sum, x) => sum + x, 0) / values.length : Number.NaN;

export const pct = (x: number, digits = 1) => Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : "n/a";
export const ms = (x: number) => Number.isFinite(x) ? `${x.toFixed(x < 10 ? 2 : 0)} ms` : "n/a";
export const intervalText = (interval: Interval) => `${pct(interval.estimate)} [${pct(interval.low)}, ${pct(interval.high)}] n=${interval.n}`;
export const pointsText = (interval: Interval) => Number.isFinite(interval.estimate)
  ? `${(interval.estimate * 100).toFixed(1)} pts [${(interval.low * 100).toFixed(1)}, ${(interval.high * 100).toFixed(1)}] n=${interval.n}`
  : "n/a";

export type GateStatus = "pass" | "fail" | "report" | "not-run";
export type GateRow = { gate: string; threshold: string; result: string; status: GateStatus; detail?: string };
export function gateTable(rows: readonly GateRow[]): string {
  const head = ["Gate", "Threshold", "Result", "Status"];
  const body = rows.map((row) => [row.gate, row.threshold, row.result, row.status.toUpperCase()]);
  const widths = head.map((_, i) => Math.max(head[i].length, ...body.map((cells) => cells[i].length)));
  const line = (cells: string[]) => `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`;
  return [line(head), `|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`, ...body.map(line)].join("\n");
}
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`);
}
export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`);
}

/** --key value / --flag arguments. */
export function parseArgs(argv: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}
