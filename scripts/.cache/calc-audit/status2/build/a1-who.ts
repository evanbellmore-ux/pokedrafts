// Track A1: which species have an ability (any game). npx --no-install tsx scripts/.cache/calc-audit/status2/build/a1-who.ts <runtime> <ability>...
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
(async () => {
  const [game, ...abilities] = process.argv.slice(2);
  const runtime = await loadBattleRuntime(game as never);
  for (const ability of abilities) {
    const list = [...runtime.speciesById.values()].filter((s) => s.abilities.includes(ability)).map((s) => `${s.name}(${s.baseStats?.spe ?? "?"})`);
    console.log(`${game} ${ability}: ${list.join(", ")}`);
  }
})();
