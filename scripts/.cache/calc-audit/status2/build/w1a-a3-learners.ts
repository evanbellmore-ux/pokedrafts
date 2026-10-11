// Track A3 helper: which species learn each move per game (the 2v2 preflight checks learnsets).
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/w1a-a3-learners.ts <move> [<move> ...] [--with <species,...>]
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";

const args = process.argv.slice(2);
const withAt = args.indexOf("--with");
const wanted = withAt >= 0 ? args[withAt + 1].split(",") : null;
const moves = (withAt >= 0 ? args.slice(0, withAt) : args).map((m) => m.toLowerCase().replace(/[^a-z0-9]/g, ""));
(async () => {
  for (const game of ["scarlet_violet", "champions", "sword_shield", "ultra_sun_ultra_moon"] as const) {
    const rt = await loadBattleRuntime(game);
    for (const move of moves) {
      if (!rt.movesById.has(move)) { console.log(`${game} ${move}: not in catalog`); continue; }
      const learners = [...rt.speciesById.values()].filter((s) => s.moves.includes(move)).map((s) => s.id);
      const shown = wanted ? learners.filter((id) => wanted.includes(id)) : learners.slice(0, 40);
      console.log(`${game} ${move} (${learners.length}): ${shown.join(" ")}`);
    }
  }
})();
