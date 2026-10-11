// Track R-V: the paths where two JSON files differ (ms removed).
import fs from "node:fs";
const [a, b] = process.argv.slice(2, 4).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const out = [];
const walk = (x, y, at) => {
  if (JSON.stringify(x) === JSON.stringify(y)) return;
  if (x && y && typeof x === "object" && typeof y === "object") { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (k !== "ms") walk(x[k], y[k], `${at}.${k}`); return; }
  out.push(`${at}: ${JSON.stringify(x)?.slice(0, 120)} → ${JSON.stringify(y)?.slice(0, 120)}`);
};
walk(a, b, "");
console.log(out.slice(0, Number(process.argv[4] ?? 30)).join("\n"), `\n(${out.length} paths)`);
