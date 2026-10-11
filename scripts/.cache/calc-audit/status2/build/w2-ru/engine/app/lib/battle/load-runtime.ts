import { championsRuntime, createBattleRuntime, type BattleRuntime } from "./runtime";
import type { BattleGame, NativeCatalog } from "./types";

const loaded = new Map<BattleGame, BattleRuntime>([["champions", championsRuntime]]);

/** Literal imports let Next split native catalogs without a runtime network data source. */
export async function loadBattleRuntime(game: BattleGame): Promise<BattleRuntime> {
  const previous = loaded.get(game);
  if (previous) return previous;
  const bundle = game === "ultra_sun_ultra_moon" ? await Promise.all([
    import("@/data/battle/ultra_sun_ultra_moon/catalog.json"), import("@/data/battle/ultra_sun_ultra_moon/manifest.json"),
  ]) : game === "sword_shield" ? await Promise.all([
    import("@/data/battle/sword_shield/catalog.json"), import("@/data/battle/sword_shield/manifest.json"),
  ]) : game === "scarlet_violet" ? await Promise.all([
    import("@/data/battle/scarlet_violet/catalog.json"), import("@/data/battle/scarlet_violet/manifest.json"),
  ]) : null;
  if (!bundle || bundle[0].default.game !== game) throw new Error("The requested battle game is unavailable.");
  const runtime = createBattleRuntime(bundle[0].default as NativeCatalog, bundle[1].default.catalogSha256);
  loaded.set(game, runtime);
  return runtime;
}
