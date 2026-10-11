// Track V1: what changed in each NOT LISTED stored case (log-diff), grouped: added/removed turn facts, other paths.
import fs from "node:fs";
const log = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter((l) => l.includes("NOT LISTED"));
const groups = new Map();
for (const line of log) {
  const id = line.split(":")[0];
  const a = JSON.parse(fs.readFileSync(`scripts/.cache/calc-audit/2v2/verify/app-results/${id}.json`, "utf8"));
  const b = JSON.parse(fs.readFileSync(`scripts/.cache/calc-audit/2v2/verify/v1/app-now/${id}.json`, "utf8"));
  const fa = a.result?.facts ?? [], fb = b.result?.facts ?? [];
  const added = fb.filter((f) => !fa.includes(f)).map((f) => f.replace(/Assumes .* has not used Minimize\./, "Assumes X has not used Minimize."));
  const removed = fa.filter((f) => !fb.includes(f));
  let other = "";
  if (JSON.stringify(a.result?.steps) !== JSON.stringify(b.result?.steps)) other += " steps";
  if (JSON.stringify(a.result?.endOfTurn) !== JSON.stringify(b.result?.endOfTurn)) other += " endOfTurn";
  if (JSON.stringify(a.outcomes) !== JSON.stringify(b.outcomes)) other += " outcomes";
  const key = `+${JSON.stringify([...new Set(added)])} -${JSON.stringify(removed)}${other}`;
  (groups.get(key) ?? groups.set(key, []).get(key)).push(id);
}
for (const [k, ids] of groups) console.log(`${ids.length}: ${k}\n    ${ids.join(" ")}`);
