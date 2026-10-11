// FAMILY 4, Fling's data: for every item of each game's app catalog, pinned Showdown's Fling (data/items.ts item.fling, the
// item's onTakeItem for a holder that is not its own user, PS/data/moves.ts:5743-5748) against @smogon/calc's getFlingPower,
// which the app's 1v1 calculation would read. Also the items whose fling has an effect on the target (status, volatile,
// effect, Berry). Read-only.
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/guards-probes-fling.ts > scripts/.cache/calc-audit/status2/design/guards-probes-fling.out
import { getFlingPower } from "@smogon/calc/dist/items";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import * as sim from "../../showdown/sim/index.ts";

const { Dex } = sim as any;
const GAMES = [
  { game: "scarlet_violet", format: "gen9doublescustomgame", gen: 9 },
  { game: "champions", format: "gen9championsdoublescustomgame", gen: 9 },
  { game: "sword_shield", format: "gen8doublescustomgame", gen: 8 },
  { game: "ultra_sun_ultra_moon", format: "gen7doublescustomgame", gen: 7 },
] as const;

(async () => {
  for (const { game, format, gen } of GAMES) {
    const runtime = await loadBattleRuntime(game);
    const dex = Dex.forFormat(format);
    const diff: string[] = [], effects: string[] = [], fails: string[] = [];
    let same = 0;
    for (const entry of runtime.catalog.items) {
      const item = dex.items.get(entry.id);
      if (!item.exists) { diff.push(`${entry.id}: not in Showdown's dex`); continue; }
      const sd = item.fling?.basePower ?? 0;
      const calc = getFlingPower(item.name, gen);
      if (sd !== calc) diff.push(`${item.name}: Showdown ${sd || "no fling (fails)"} vs @smogon/calc ${calc}`);
      else same++;
      if (!sd) fails.push(item.name);
      const what = item.isBerry ? "the target eats it" : item.fling?.effect ? "fling.effect" : item.fling?.status ? `status ${item.fling.status}` : item.fling?.volatileStatus ? `volatile ${item.fling.volatileStatus}` : "";
      if (what) effects.push(`${item.name}: ${what}`);
    }
    console.log(`\n== ${game} (${runtime.catalog.items.length} catalog items): ${same} equal, ${diff.length} different`);
    for (const line of diff) console.log(`  DIFF ${line}`);
    console.log(`  no fling data (Fling fails): ${fails.join(", ") || "none"}`);
    console.log(`  effects on the target: ${effects.filter((e) => !e.endsWith("the target eats it")).join("; ")}`);
    console.log(`  Berries (the target eats them): ${effects.filter((e) => e.endsWith("the target eats it")).length}`);
    // onTakeItem: items a holder of another species can still not fling (Z-Crystals, Mega Stones of its own family, Memories, Drives...).
    const takeGuarded = runtime.catalog.items.map((entry: any) => dex.items.get(entry.id)).filter((item: any) => item.exists && item.onTakeItem).map((item: any) => item.name);
    console.log(`  items with an onTakeItem (Fling fails for their own user or always): ${takeGuarded.length}: ${takeGuarded.slice(0, 40).join(", ")}${takeGuarded.length > 40 ? ", ..." : ""}`);
  }
})();
