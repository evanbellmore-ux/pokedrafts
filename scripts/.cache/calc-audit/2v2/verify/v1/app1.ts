// Track V1: print one case's app result (steps, facts, hp, end of turn, E2) for review.
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v1/app1.ts <id> [--outcomes]
import { CASES } from "../cases";
import { appTurn } from "../app-turn";

(async () => {
  const id = process.argv[2];
  const c = CASES.find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  const app = await appTurn(c);
  if (app.error) { console.log(app.error); return; }
  const r = app.result as any;
  console.log(r.status, r.reason ?? "", r.issues ? JSON.stringify(r.issues) : "");
  if (r.status !== "ready") return;
  console.log("facts:", JSON.stringify(r.facts));
  for (const s of r.steps) {
    console.log("step", s.slot, s.moveId, "moves", s.moves, "skipped", JSON.stringify(s.skipped), "facts", JSON.stringify(s.facts));
    for (const h of s.hits) console.log("   hit", h.slot, h.kind, "reached", h.reached, "ko", h.koChance, h.min, h.max, JSON.stringify(h.facts ?? []), h.substitute ? JSON.stringify(h.substitute) : "");
  }
  for (const [slot, hp] of Object.entries(r.hp) as [string, any][]) if (hp) console.log("hp", slot, hp.start, `${hp.min}..${hp.max}`, "ko", hp.koChance, JSON.stringify(hp.losses ?? []), JSON.stringify(hp.conditions ?? []));
  console.log("eot:", r.endOfTurn.status, r.endOfTurn.reason ?? "");
  for (const x of r.endOfTurn.residuals ?? []) console.log("   res", x.slot, x.effect, x.chance, `${x.min}..${x.max}`, JSON.stringify(x.facts ?? []));
  if (process.argv.includes("--outcomes") && app.outcomes) console.log("E2:", JSON.stringify(app.outcomes).slice(0, 4000));
})();
