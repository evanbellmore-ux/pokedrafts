// Track R-V: oracle results byte-equal against the stored ones, ms (and the walks' ms) removed.
import fs from "node:fs";
import path from "node:path";
const [dirA, dirB] = process.argv.slice(2);
const strip = (j) => JSON.stringify(j, (k, v) => (k === "ms" ? undefined : v));
let same = 0, diff = 0;
for (const f of fs.readdirSync(dirB).filter((f) => f.endsWith(".json"))) {
  const a = path.join(dirA, f);
  if (!fs.existsSync(a)) { console.log(`${f}: missing in ${dirA}`); diff++; continue; }
  if (strip(JSON.parse(fs.readFileSync(a, "utf8"))) === strip(JSON.parse(fs.readFileSync(path.join(dirB, f), "utf8")))) same++;
  else { diff++; console.log(`${f}: DIFFERS`); }
}
console.log(`${same} byte-equal (ms removed), ${diff} differ`);
