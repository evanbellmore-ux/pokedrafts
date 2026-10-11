// FINAL: copy the oracle results of the review regression cases (2v2/verify/cases-review.ts REVIEW_CASES_FINAL) from
// build/final-results into the corpus' results/. Usage (repo root): npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/final-copy-results.ts
import fs from "node:fs";
import { REVIEW_CASES_FINAL } from "../../2v2/verify/cases-review";

let copied = 0;
const missing: string[] = [];
for (const c of REVIEW_CASES_FINAL) {
  if (c.notEstimated) continue;
  const src = `scripts/.cache/calc-audit/status-eot/build/final-results/${c.id}.json`;
  if (!fs.existsSync(src)) { missing.push(c.id); continue; }
  fs.copyFileSync(src, `scripts/.cache/calc-audit/2v2/verify/results/${c.id}.json`);
  copied++;
}
console.log(`${REVIEW_CASES_FINAL.length} cases, ${copied} oracle results copied, missing: ${missing.join(" ") || "none"}`);
