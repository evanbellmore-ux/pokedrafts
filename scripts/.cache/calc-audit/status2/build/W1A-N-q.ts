// Track N: which builds and moves the four app runtimes accept for doubles-history.test.ts (a catalog query, no engine).
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";

(async () => {
  for (const g of ["champions", "scarlet_violet", "ultra_sun_ultra_moon", "sword_shield"] as const) {
    const r = await loadBattleRuntime(g);
    const sp = (id: string) => r.speciesById.get(id);
    const has = (id: string, moves: string[]) => `${id}${sp(id) ? "" : "(none)"}: ${moves.filter((m) => sp(id)?.moves.includes(m)).join(",")}`;
    console.log(g, "|", has("snorlax", ["tackle", "bodyslam", "headbutt", "protect", "endure", "detect", "facade", "lick"]), "|", has("garchomp", ["protect", "endure", "detect", "quickguard", "wideguard"]),
      "|", has("golisopod", ["firstimpression"]), "|", has("incineroar", ["fakeout"]), "|", has("gengar", ["destinybond", "shadowball"]), "|", has("weavile", ["nightslash"]),
      "|", has("meowscarada", ["protect"]), "|", has("greninja", ["protect"]), "|", has("clefairy", ["followme"]), "|", has("raichu", []), sp("raichu")?.abilities?.join("/"),
      "|", has("jolteon", ["thunderbolt"]), "|", has("kangaskhan", ["fakeout", "tackle"]), "|", has("hariyama", ["fakeout"]), "|", has("lopunny", ["fakeout"]));
  }
})();
