// Integration 1a: the bench's per-turn times paired by id over the turns both trees calculate (ready in both), from the last
// bench-head.json and bench-now.json (bench.sh): p50, p95 and the median of the per-turn ratio.
import fs from "node:fs";
const dir = "scripts/.cache/calc-audit/status2/build/int1a";
const read = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
const head = read("bench-head.json"), now = read("bench-now.json");
const rows = (j) => new Map([...j.rows, ...j.fuzzRows].map((r) => [r.id, r]));
const h = rows(head), n = rows(now);
const both = [...h.keys()].filter((id) => n.has(id) && h.get(id).status === "ready" && n.get(id).status === "ready");
const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const hm = both.map((id) => h.get(id).ms), nm = both.map((id) => n.get(id).ms);
const ratios = both.map((id) => n.get(id).ms / h.get(id).ms);
const newlyReady = [...n.keys()].filter((id) => n.get(id).status === "ready" && h.get(id)?.status !== "ready");
console.log(`paired ready turns ${both.length}: main p50 ${pct(hm, 0.5).toFixed(2)} p95 ${pct(hm, 0.95).toFixed(2)} | now p50 ${pct(nm, 0.5).toFixed(2)} p95 ${pct(nm, 0.95).toFixed(2)} | per-turn ratio median ${pct(ratios, 0.5).toFixed(3)} p90 ${pct(ratios, 0.9).toFixed(3)}`);
console.log(`newly ready ${newlyReady.length}: p50 ${pct(newlyReady.map((id) => n.get(id).ms), 0.5).toFixed(2)} max ${Math.max(...newlyReady.map((id) => n.get(id).ms)).toFixed(1)} ms`);
console.log(`moves pane p50 main ${head.summary.movesPane.p50.toFixed(2)} now ${now.summary.movesPane.p50.toFixed(2)}; max now ${now.summary.movesPane.max.toFixed(1)}`);
