// Track H helper: learners of moves per game (a catalog check for the validation cases).
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status2/build/w1a-h-learners.ts <game> <move id...>
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";

const GAME: Record<string, "scarlet_violet" | "sword_shield" | "ultra_sun_ultra_moon" | "champions"> = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" };
(async () => {
  const [game, ...moves] = process.argv.slice(2);
  const runtime = await loadBattleRuntime(GAME[game]);
  for (const move of moves) {
    const species = [...runtime.speciesById.values()].filter((s) => s.moves.includes(move)).map((s) => s.id);
    console.log(`${game} ${move} (${runtime.movesById.has(move) ? "in catalog" : "NOT in catalog"}): ${species.length} learners: ${species.slice(0, 30).join(" ")}`);
  }
})();
