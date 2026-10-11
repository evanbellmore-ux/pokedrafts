// R-E's A/B of the stored cases: the working tree against the same tree with R-E's files as they were before wave 2 (w2-re/pre),
// so the other tracks' work in progress is on both sides. Every case's calculateDoublesTurn and calculateDoublesOutcomes JSON
// must be byte-equal (no case has a bench). Usage: npx --no-install tsx scripts/.cache/calc-audit/status2/build/w2-re/ab-app.ts [--rebuild]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CASES } from "../../../2v2/verify/cases";
import { caseInput, runtimeFor } from "../../../2v2/verify/app-turn";
import * as current from "@/app/lib/battle/doubles-turn";

const MINE = ["doubles-switch.ts", "doubles-turn.ts", "doubles-world.ts", "doubles-eot.ts", "doubles-presence.ts", "doubles-calling.ts"];
const HERE = path.resolve("scripts/.cache/calc-audit/status2/build/w2-re");

(async () => {
  const tree = path.join(HERE, "abtree", "app", "lib", "battle");
  // The A tree: the working tree's battle folder with R-E's files from before wave 2.
  fs.rmSync(path.join(HERE, "abtree"), { recursive: true, force: true });
  fs.mkdirSync(tree, { recursive: true });
  const live = path.resolve("app/lib/battle");
  for (const file of fs.readdirSync(live)) {
    const from = MINE.includes(file) ? path.join(HERE, "pre", "app", "lib", "battle", file) : path.join(live, file);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(tree, file));
  }
  const before = (await import(pathToFileURL(path.join(tree, "doubles-turn.ts")).href)) as typeof current;
  let same = 0;
  const differ: string[] = [];
  const errors: string[] = [];
  for (const c of CASES) {
    try {
      const runtime = await runtimeFor(c);
      const a = JSON.stringify(before.calculateDoublesTurn(caseInput(c, runtime)));
      const b = JSON.stringify(current.calculateDoublesTurn(caseInput(c, runtime)));
      const oa = c.outcomes ? JSON.stringify(before.calculateDoublesOutcomes(caseInput(c, runtime))) : "";
      const ob = c.outcomes ? JSON.stringify(current.calculateDoublesOutcomes(caseInput(c, runtime))) : "";
      if (a === b && oa === ob) same++; else differ.push(c.id);
    } catch (error) {
      errors.push(`${c.id}: ${(error as Error).message}`);
    }
  }
  console.log(`${same}/${CASES.length} byte-equal; differ: ${differ.length}${differ.length ? ` ${differ.join(",")}` : ""}; errors: ${errors.length}${errors.length ? ` ${errors.slice(0, 5).join(" | ")}` : ""}`);
})();
