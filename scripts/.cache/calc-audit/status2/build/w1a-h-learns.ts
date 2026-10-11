// Track H helper: whether a species learns each move in a game. Run: npx --no-install tsx <this> <game> <species> <move id...>
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";

const GAME: Record<string, "scarlet_violet" | "sword_shield" | "ultra_sun_ultra_moon" | "champions"> = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" };
(async () => {
  const [game, species, ...moves] = process.argv.slice(2);
  const runtime = await loadBattleRuntime(GAME[game]);
  const entry = runtime.speciesById.get(species);
  if (!entry) { console.log(`${game} ${species}: not in the catalog`); return; }
  console.log(`${game} ${species} (${(entry.abilities as string[]).join("/")}): ${moves.map((move) => `${move} ${entry.moves.includes(move) ? "yes" : "no"}`).join(", ")}`);
})();
