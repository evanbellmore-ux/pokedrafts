// Track B: compare two app-results folders with `ms`, result.endOfTurn and the end-of-turn turn facts removed (the
// removed "End-of-turn effects are not applied." and the new assumptions), byte-equal otherwise; reports the endOfTurn
// statuses and not-estimated reasons seen in the first folder.
import fs from "node:fs";
import path from "node:path";
const [a, b] = process.argv.slice(2);
const EOT_FACTS = /^(End-of-turn effects are not applied\.|Assumes the .* does not end this turn\.|Assumes this is .*'s first turn of bad poison damage\.|Assumes Dynamax started this turn\.|Moody raises one stat and lowers another\.)$/;
const files = fs.readdirSync(a).filter((f) => f.endsWith(".json")).sort();
let same = 0; const diff = [], reasons = new Map(); let ready = 0;
for (const f of files) {
  const pb = path.join(b, f);
  if (!fs.existsSync(pb)) continue;
  const x = JSON.parse(fs.readFileSync(path.join(a, f), "utf8")), y = JSON.parse(fs.readFileSync(pb, "utf8"));
  delete x.ms; delete y.ms;
  for (const [o, first] of [[x, true], [y, false]]) {
    if (!o.result) continue;
    if (first && o.result.endOfTurn) { if (o.result.endOfTurn.status === "ready") ready++; else reasons.set(o.result.endOfTurn.reason, (reasons.get(o.result.endOfTurn.reason) ?? 0) + 1); }
    delete o.result.endOfTurn;
    if (o.result.facts) o.result.facts = o.result.facts.filter((t) => !EOT_FACTS.test(t));
    // DoublesHP.conditions is new for every track (--keep-conditions keeps it).
    if (!process.argv.includes("--keep-conditions")) for (const hp of Object.values(o.result.hp ?? {})) if (hp) delete hp.conditions;
  }
  if (JSON.stringify(x, null, 1) === JSON.stringify(y, null, 1)) same++; else diff.push(f);
}
console.log(`${same}/${files.length} equal without the end of turn; differ ${diff.length}: ${diff.join(",")}`);
console.log(`end of turn ready ${ready}; not estimated: ${[...reasons].map(([r, n]) => `${n}× ${r}`).join(" | ")}`);
