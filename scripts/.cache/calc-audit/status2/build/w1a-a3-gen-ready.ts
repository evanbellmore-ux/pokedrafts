// Track A3 helper: which generated Showdown case (tests/unit/doubles-turn-showdown.test.ts) the app no longer estimates.
import { readFileSync } from "node:fs";
import { CASES } from "../../2v2/verify/cases";
import { appTurn } from "../../2v2/verify/app-turn";
const text = readFileSync("tests/unit/doubles-turn-showdown.test.ts", "utf8");
const ids = new Set([...text.matchAll(/id: "([^"]+)"/g)].map((m) => m[1]));
(async () => {
  for (const c of CASES) {
    if (!ids.has(c.id) || c.notEstimated) continue;
    const app = await appTurn(c);
    if (app.result?.status !== "ready") console.log(c.id, app.result?.status, (app.result as { reason?: string })?.reason ?? app.error);
  }
})();
