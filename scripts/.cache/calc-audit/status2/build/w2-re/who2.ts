// Species of a game with an ability that learn one of the moves (probe authoring).
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
async function main() {
  const [game, ability, ...moves] = process.argv.slice(2);
  const runtime = await loadBattleRuntime(game as never);
  for (const [id, s] of runtime.speciesById as Map<string, any>) {
    const abilities = Object.values(s.abilities ?? {}) as string[];
    if (ability !== "-" && !abilities.includes(ability)) continue;
    const has = moves.filter((m) => s.moves.includes(m));
    if (has.length) console.log(id, has.join(","));
  }
}
void main();
