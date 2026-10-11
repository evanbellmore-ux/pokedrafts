// Compare two app-results folders: every case JSON with `ms` removed (and, with --strip-eot, the new result.endOfTurn removed
// after checking it equals the Step 0 stub) must be byte-equal in JSON.stringify(x, null, 1) form.
import fs from "node:fs";
import path from "node:path";
const [a, b, ...flags] = process.argv.slice(2);
const strip = flags.includes("--strip-eot");
const STUB = JSON.stringify({ status: "not-estimated", reason: "End-of-turn effects are not applied." });
const files = fs.readdirSync(a).filter((f) => f.endsWith(".json")).sort();
let same = 0, diff = [], missing = [], eotBad = [], eotSeen = 0;
for (const f of files) {
  const pb = path.join(b, f);
  if (!fs.existsSync(pb)) { missing.push(f); continue; }
  const x = JSON.parse(fs.readFileSync(path.join(a, f), "utf8"));
  const y = JSON.parse(fs.readFileSync(pb, "utf8"));
  delete x.ms; delete y.ms;
  for (const o of [x, y]) {
    if (strip && o.result && o.result.status === "ready" && "endOfTurn" in o.result) {
      eotSeen++;
      if (JSON.stringify(o.result.endOfTurn) !== STUB) eotBad.push(f);
      delete o.result.endOfTurn;
    }
  }
  if (JSON.stringify(x, null, 1) === JSON.stringify(y, null, 1)) same++; else diff.push(f);
}
const extra = fs.readdirSync(b).filter((f) => f.endsWith(".json") && !files.includes(f));
console.log(`${same}/${files.length} byte-equal (ms removed${strip ? ", endOfTurn stub removed" : ""}); differ: ${diff.length}${diff.length ? " " + diff.slice(0, 20).join(",") : ""}; missing: ${missing.length}; extra: ${extra.length}${strip ? `; endOfTurn seen ${eotSeen}, not the stub: ${eotBad.length}` : ""}`);
