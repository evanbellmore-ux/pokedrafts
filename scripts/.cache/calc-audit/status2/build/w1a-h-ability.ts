// Track H helper: holders of an ability per game. Run: npx --no-install tsx <this> <game> <ability id...>
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
const GAME: Record<string, "scarlet_violet" | "sword_shield" | "ultra_sun_ultra_moon" | "champions"> = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" };
(async () => {
  const [game, ...abilities] = process.argv.slice(2);
  const runtime = await loadBattleRuntime(GAME[game]);
  for (const ability of abilities) {
    const species = [...runtime.speciesById.values()].filter((s) => (s.abilities as string[]).includes(ability)).map((s) => s.id);
    console.log(`${game} ${ability}: ${species.join(" ")}`);
  }
})();
