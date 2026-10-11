// Print the app's turn facts and per-step facts for cases (run with TSX_TSCONFIG_PATH at a HEAD tree to see HEAD's).
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/step1-facts.ts <id>...
import { CASES } from "../../2v2/verify/cases";
import { appTurn } from "../../2v2/verify/app-turn";
(async () => {
  for (const id of process.argv.slice(2)) {
    const c = CASES.find((each) => each.id === id);
    if (!c) { console.log(`${id}: no case`); continue; }
    const app = await appTurn(c);
    const r = app.result as { status: string; reason?: string; facts?: string[]; steps?: { slot: string; facts?: { text: string }[]; hits: { slot: string; facts?: { text: string }[] }[] }[] } | null;
    console.log(`== ${id}: ${r?.status}${r?.reason ? `: ${r.reason}` : ""}`);
    for (const f of r?.facts ?? []) console.log(`  turn: ${f}`);
    for (const s of r?.steps ?? []) {
      for (const f of s.facts ?? []) console.log(`  ${s.slot}: ${f.text}`);
      for (const h of s.hits) for (const f of h.facts ?? []) console.log(`  ${s.slot} -> ${h.slot}: ${f.text}`);
    }
  }
})();
