import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { corpus } from "./golden-corpus";
import { fspecOf, flingOracle } from "./oracle";
(async () => {
  const cases = await corpus();
  const c = cases.find((x) => x.id === process.argv[2])!;
  const R = await loadBattleRuntime(c.game);
  const spec = fspecOf(c.id, c.game as never, "Fling", c.attacker, c.defender, c.field, R);
  try { flingOracle(spec, 1, 100); } catch (e) { console.log((e as Error).stack?.split("\n").slice(0, 8).join("\n")); }
})();
