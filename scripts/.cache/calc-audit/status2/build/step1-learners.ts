// Which species learn a move in a game's runtime (the 2v2 preflight's species.moves): step1 case construction.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/step1-learners.ts <game runtime id> <move id>...
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
(async () => {
  const [game, ...moves] = process.argv.slice(2);
  const runtime = await loadBattleRuntime(game as never);
  for (const move of moves) {
    const list = [...runtime.speciesById.values()].filter((s) => s.moves.includes(move)).map((s) => `${s.name}(${s.baseStats?.spe ?? "?"})`);
    console.log(`${game} ${move}: ${list.join(", ")}`);
  }
})();
