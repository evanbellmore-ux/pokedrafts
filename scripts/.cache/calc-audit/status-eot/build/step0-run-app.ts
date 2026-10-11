// Re-run the app side of every 2v2 oracle case into a scratch folder (argv[2]); never touches app-results/.
import fs from "node:fs";
import path from "node:path";
import { CASES } from "../../2v2/verify/cases";
import { appTurn } from "../../2v2/verify/app-turn";

(async () => {
  const out = path.resolve(process.argv[2]);
  fs.mkdirSync(out, { recursive: true });
  let n = 0;
  for (const c of CASES) {
    const app = await appTurn(c);
    fs.writeFileSync(path.join(out, `${c.id}.json`), JSON.stringify(app, null, 1));
    n++;
  }
  console.log(`wrote ${n} cases to ${out}`);
})();
