import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
(async () => {
  const want: Record<string, { moves: string[]; abilities: string[]; species: string[] }> = {
    scarlet_violet: { moves: ["fissure", "guillotine", "horndrill", "sheercold"], abilities: ["sturdy"], species: [] },
    champions: { moves: ["matchagotcha"], abilities: ["lightningrod", "roughskin", "sturdy"], species: ["sinistcha", "garchomp", "tyranitar", "rhydon", "raichu", "gastrodon"] },
  };
  for (const [game, w] of Object.entries(want)) {
    const rt = await loadBattleRuntime(game as never);
    for (const m of w.moves) console.log(game, m, [...rt.speciesById.values()].filter((s) => s.moves.includes(m)).map((s) => s.id).slice(0, 20).join(" "));
    for (const a of w.abilities) console.log(game, a, [...rt.speciesById.values()].filter((s) => s.abilities.includes(a)).map((s) => s.id).slice(0, 20).join(" "));
    for (const s of w.species) console.log(game, s, rt.speciesById.has(s));
  }
})();
