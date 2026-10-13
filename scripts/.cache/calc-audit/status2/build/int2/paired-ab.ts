// Integration 2: an in-process paired per-turn A/B against an engine tree at argv[2] (the main worktree; step2/pre for 1b):
// for every loaded case but wave 2's (no bench; both engines calculate the same input), each engine's turn time is the
// minimum of argv[3] (default 5) alternating runs; the ratio is taken over the turns both give ready.
import { CASES } from "../../../2v2/verify/cases";
import { WAVE2_CASES } from "../../../2v2/verify/cases-wave2";
import { caseInput, runtimeFor } from "../../../2v2/verify/app-turn";
import { calculateDoublesTurn as current } from "@/app/lib/battle/doubles-turn";
import type { DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { pathToFileURL } from "node:url";

(async () => {
  const head = (await import(pathToFileURL(`${process.argv[2]}/app/lib/battle/doubles-turn.ts`).href)).calculateDoublesTurn as typeof current;
  const runs = Number(process.argv[3] ?? 5);
  const wave2 = new Set(WAVE2_CASES.map((c) => c.id));
  const inputs: { id: string; input: DoublesTurnInput }[] = [];
  for (const c of CASES) { if (wave2.has(c.id)) continue; try { inputs.push({ id: c.id, input: caseInput(c, await runtimeFor(c)) }); } catch { /* skipped */ } }
  const time = (engine: typeof current, input: DoublesTurnInput) => {
    const t0 = performance.now();
    let status = "throws";
    try { status = engine({ ...input }).status; } catch { /* timed as it is */ }
    return { ms: performance.now() - t0, status };
  };
  for (const { input } of inputs.slice(0, 50)) { time(head, input); time(current, input); }
  const rows: { id: string; head: number; now: number; hs: string; ns: string }[] = [];
  for (const { id, input } of inputs) {
    let h = Infinity, n = Infinity, hs = "", ns = "";
    for (let i = 0; i < runs; i++) {
      const a = time(head, input); h = Math.min(h, a.ms); hs = a.status;
      const b = time(current, input); n = Math.min(n, b.ms); ns = b.status;
    }
    rows.push({ id, head: h, now: n, hs, ns });
  }
  const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const both = rows.filter((r) => r.hs === "ready" && r.ns === "ready");
  const ratios = both.map((r) => r.now / r.head);
  const newly = rows.filter((r) => r.ns === "ready" && r.hs !== "ready");
  console.log(`paired ready turns ${both.length} (min of ${runs} alternating runs each): head p50 ${pct(both.map((r) => r.head), 0.5).toFixed(2)} p95 ${pct(both.map((r) => r.head), 0.95).toFixed(2)} | now p50 ${pct(both.map((r) => r.now), 0.5).toFixed(2)} p95 ${pct(both.map((r) => r.now), 0.95).toFixed(2)} | per-turn ratio median ${pct(ratios, 0.5).toFixed(3)} p90 ${pct(ratios, 0.9).toFixed(3)}; sum ratio ${(both.reduce((s, r) => s + r.now, 0) / both.reduce((s, r) => s + r.head, 0)).toFixed(3)}`);
  console.log(`ready now and not in head: ${newly.length}; ready in head and not now: ${rows.filter((r) => r.hs === "ready" && r.ns !== "ready").map((r) => r.id).join(", ") || "none"}`);
})();
