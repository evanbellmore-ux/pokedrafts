// Track V1: the changed leaf paths of one case between app-results and v1/app-now (values shown).
import fs from "node:fs";
const [id] = process.argv.slice(2);
const a = JSON.parse(fs.readFileSync(`scripts/.cache/calc-audit/2v2/verify/app-results/${id}.json`, "utf8"));
const b = JSON.parse(fs.readFileSync(`scripts/.cache/calc-audit/2v2/verify/v1/app-now/${id}.json`, "utf8"));
delete a.ms; delete b.ms;
const out = [];
const walk = (x, y, at) => {
  if (JSON.stringify(x) === JSON.stringify(y)) return;
  if (x && y && typeof x === "object" && typeof y === "object" && Array.isArray(x) === Array.isArray(y)) {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${at}.${k}`);
    return;
  }
  out.push(`${at}: ${JSON.stringify(x)?.slice(0, 160)} => ${JSON.stringify(y)?.slice(0, 160)}`);
};
walk(a, b, id);
console.log(out.slice(0, 12).join("\n") + (out.length > 12 ? `\n... ${out.length} paths` : ""));
