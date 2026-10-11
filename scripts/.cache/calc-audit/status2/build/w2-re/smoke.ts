// R-E smoke: a U-turn with a bench and a later move into the newcomer (B2-like).
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { bench, input, showOutcomes, turn } from "./kit";

async function main() {
  const runtime = await loadBattleRuntime("scarlet_violet");
  const value = input(runtime, {
    "own-left": { species: "rillaboom", ability: "grassysurge", move: "uturn", target: "opponent-left", evs: { spe: 252 } },
    "own-right": { species: "snorlax", ability: "thickfat" },
    "opponent-left": { species: "garchomp", ability: "roughskin", move: "dragonclaw", target: "own-left" },
    "opponent-right": { species: "snorlax", ability: "thickfat" },
  }, { bench: { own: [bench(runtime, "incin", { species: "incineroar", ability: "intimidate" })], opponent: [bench(runtime, "lax2", { species: "snorlax", ability: "thickfat" })] } });
  console.log(turn(value));
  console.log(showOutcomes(value));
}
void main();
