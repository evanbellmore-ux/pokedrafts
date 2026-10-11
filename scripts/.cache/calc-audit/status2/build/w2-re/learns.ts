// Which species of a game exist and learn which moves (probe authoring).
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
async function main() {
  const [game, ...pairs] = process.argv.slice(2);
  const runtime = await loadBattleRuntime(game as never);
  for (const pair of pairs) {
    const [species, ...moves] = pair.split(":");
    const s = runtime.speciesById.get(species);
    console.log(species, s ? `abilities ${JSON.stringify((s as any).abilities)} learns ${moves.map((m) => `${m}=${s.moves.includes(m)}`).join(" ")}` : "MISSING");
  }
}
void main();
