// Integration 1a, H's I1-I4 and I6 (W1A-H.md; w1a-h-wire.mjs PATCHES). I7 (outcomeOf's twoturnmove) went in with the merged outcomeOf edit.
import fs from "node:fs";
import path from "node:path";
import { PATCHES } from "../w1a-h-wire.mjs";
const SRC = path.resolve("app/lib/battle");
for (const [file, before, after, what] of PATCHES) {
  if (what.startsWith("I7")) continue;
  const target = path.join(SRC, file);
  const text = fs.readFileSync(target, "utf8");
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${what}: the anchor in ${file} matches ${count} times`);
  fs.writeFileSync(target, text.replace(before, () => after));
  console.log(`applied ${what}`);
}
