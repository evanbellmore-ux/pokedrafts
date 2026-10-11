import { loadBattleRuntime } from "../../../../../app/lib/battle/load-runtime";
(async () => {
  for (const game of ["scarlet_violet", "champions", "sword_shield", "ultra_sun_ultra_moon"] as const) {
    const r = await loadBattleRuntime(game);
    const ok = r.catalog.species.filter((s) => !s.battleForm && !s.unsupported.length);
    const small = [...ok].sort((a, b) => (a.moves?.length ?? 0) - (b.moves?.length ?? 0)).slice(0, 6).map((s) => `${s.id}(${s.moves.length}:${s.moves.slice(0,6).join("/")};${s.types.join("/")};${s.abilities.join("/")};${s.gender ?? "-"})`);
    console.log(game, small.join("  "));
    console.log(" ditto:", r.speciesById.has("ditto"), "swalot:", r.speciesById.has("swalot"), "garchomp:", r.speciesById.has("garchomp"), "gengar:", r.speciesById.has("gengar"), "snorlax:", r.speciesById.has("snorlax"));
  }
})();
