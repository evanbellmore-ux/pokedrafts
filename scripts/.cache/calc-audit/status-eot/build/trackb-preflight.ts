import { preflight, runtimeFor } from "../../2v2/verify/app-turn";
import { TB_CASES } from "./trackb-cases";
async function main() {
  for (const c of TB_CASES) { const r = await runtimeFor(c); const p = preflight(c, r); if (p.length) console.log(c.id, p.join("; ")); }
  console.log("done");
}
void main();
