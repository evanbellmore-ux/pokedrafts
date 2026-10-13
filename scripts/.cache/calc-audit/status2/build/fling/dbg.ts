import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { corpus } from "./golden-corpus";
import { fspecOf, prepare } from "./oracle";
(async () => {
  const cases = await corpus();
  const c = cases.find((x) => x.id === process.argv[2])!;
  const R = await loadBattleRuntime(c.game);
  const spec = fspecOf(c.id, c.game as never, "Fling", c.attacker, c.defender, c.field, R);
  console.log(JSON.stringify(spec));
  const row = calculateMatchup(c.attacker, c.defender, c.field, c.contexts, R).results.find((r) => r.moveId === "fling");
  console.log(row?.kind, row?.assumptions);
  const { b } = prepare(spec);
  console.log(b.requestState, b.p1.active.map((p: any) => p.name), b.p2.active.map((p: any) => p.name), b.field.weather);
})();
import { flingOracle } from "./oracle";
(async () => {
  const cases = await corpus();
  const c = cases.find((x) => x.id === process.argv[2])!;
  const R = await loadBattleRuntime(c.game);
  const spec = fspecOf(c.id, c.game as never, "Fling", c.attacker, c.defender, c.field, R);
  const t0 = Date.now();
  try { const o = flingOracle(spec, 1, Number(process.argv[3] ?? 3000)); console.log("runs", o.runs, o.ko, Date.now() - t0); } catch (e) { console.log("ERR", (e as Error).message, Date.now() - t0); }
})();
