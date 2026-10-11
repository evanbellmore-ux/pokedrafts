// The species of a game that learn a move (probe authoring).
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
async function main() {
  const [game, move] = process.argv.slice(2);
  const runtime = await loadBattleRuntime(game as never);
  console.log([...runtime.speciesById.values()].filter((s) => s.moves.includes(move)).map((s) => s.id).slice(0, 60).join(" "));
}
void main();
