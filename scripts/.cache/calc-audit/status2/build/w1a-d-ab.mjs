// Track D: the cases whose app result D's files change (old vs new D trees), each with its status and reasons before and after.
import fs from "node:fs";
import path from "node:path";
const [a, b] = process.argv.slice(2);
const sum = (o) => {
  const r = o.result;
  if (!r) return `error ${String(o.error).split("\n")[0].slice(0, 80)}`;
  if (r.status !== "ready") return `${r.status}: ${r.reason ?? JSON.stringify(r.issues).slice(0, 80)}`;
  const e = r.endOfTurn?.status === "ready" ? "end ready" : `end: ${r.endOfTurn?.reason}`;
  return `ready (${e})${o.outcomes ? ` E2 ${o.outcomes.status}${o.outcomes.status !== "ready" ? ": " + o.outcomes.reason : ""}` : ""}`;
};
for (const f of fs.readdirSync(a).filter((x) => x.endsWith(".json")).sort()) {
  const x = JSON.parse(fs.readFileSync(path.join(a, f), "utf8")), y = JSON.parse(fs.readFileSync(path.join(b, f), "utf8"));
  delete x.ms; delete y.ms;
  if (JSON.stringify(x) === JSON.stringify(y)) continue;
  const sx = sum(x), sy = sum(y);
  console.log(`${f.replace(".json", "")}: ${sx === sy ? `same status (${sx}); details differ` : `${sx}  →  ${sy}`}`);
}
