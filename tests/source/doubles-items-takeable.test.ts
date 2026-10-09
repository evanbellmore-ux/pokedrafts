import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CACHE, ROOT, SHOWDOWN_SOURCE } from "../../scripts/lib/champions-data/sources.mjs";
import { usesHelpers } from "../../app/lib/battle/calculate";
import { createBattleRuntime, type BattleRuntime } from "../../app/lib/battle/runtime";
import { itemTakeable } from "../../app/lib/battle/uses-to-ko";
import type { BattleCatalog } from "../../app/lib/battle/types";

/**
 * Trick and Switcheroo's two TakeItem checks (status-eot ADDENDUM §4.12.2; pinned Showdown c23d2e94 data/moves.ts:19878-19893):
 * takeItem runs the item's onTakeItem with its holder (runEvent('TakeItem', holder, taker)), and the move's
 * singleEvent('TakeItem', item, …, receiver, holder) runs it with its receiver. For every catalog item with a pinned
 * onTakeItem, in each of the four games, uses-to-ko.ts itemTakeable(…, thief) must equal both checks, holder × receiver.
 * The handlers are read from the compiled dex (node_modules/.cache/champions/showdown-dex-<revision>, `npm run
 * data:champions`); Sword/Shield and Ultra Sun/Ultra Moon use data/mods/gen8/items.ts's Griseous Orb (the one onTakeItem
 * the generation 8 and 7 mods change, checked from the source text).
 */
const DEX = join(CACHE, `showdown-dex-${SHOWDOWN_SOURCE.revision}`);
const SOURCE = join(CACHE, `pokemon-showdown-${SHOWDOWN_SOURCE.revision}`);
const load = createRequire(import.meta.url);
type Handler = ((this: unknown, item: unknown, pokemon: unknown, source?: unknown) => unknown) | false;
type ItemData = { name: string; onTakeItem?: Handler; inherit?: boolean; [key: string]: unknown };
type SpeciesData = { num: number; name: string; baseSpecies?: string; tags?: string[] };
function table<T>(file: string, key: string): Record<string, T> {
  const path = join(DEX, file);
  if (!existsSync(path)) throw new Error(`The pinned Showdown dex is missing (${path}); run npm run data:champions.`);
  return load(path)[key] as Record<string, T>;
}
const baseItems = table<ItemData>("data/items.js", "Items");
const championsItems = table<ItemData>("data/mods/champions/items.js", "Items");
const pokedex = table<SpeciesData>("data/pokedex.js", "Pokedex");

/** The generation 8 mod's Griseous Orb (data/mods/gen8/items.ts), which Ultra Sun/Ultra Moon's gen 7 mod inherits. */
function griseousOrb(): Handler {
  const gen8 = readFileSync(join(SOURCE, "data/mods/gen8/items.ts"), "utf8");
  const gen7 = readFileSync(join(SOURCE, "data/mods/gen7/items.ts"), "utf8");
  expect((gen8.match(/onTakeItem/g) ?? []).length, "the generation 8 mod's onTakeItem handlers").toBe(1);
  expect(gen7.includes("onTakeItem"), "the generation 7 mod's onTakeItem handlers").toBe(false);
  expect(gen8).toMatch(/griseousorb: \{[^}]*onTakeItem\(item, pokemon, source\) \{\s*if \(source\?\.baseSpecies\.num === 487 \|\| pokemon\.baseSpecies\.num === 487\) \{\s*return false;/);
  return function (_item, pokemon, source) {
    const of = (each: unknown) => (each as { baseSpecies: SpeciesData } | undefined)?.baseSpecies;
    return !(of(source)?.num === 487 || of(pokemon)?.num === 487);
  };
}

const CATALOGS: Record<string, string> = {
  champions: "data/champions/catalog.json", scarlet_violet: "data/battle/scarlet_violet/catalog.json",
  sword_shield: "data/battle/sword_shield/catalog.json", ultra_sun_ultra_moon: "data/battle/ultra_sun_ultra_moon/catalog.json",
};

/** The item as a game sees it: the Champions mod over the base data, and the generation 8 mod's Griseous Orb. */
function itemFor(game: string, id: string, orb: Handler): ItemData | undefined {
  const base = baseItems[id];
  const mod = game === "champions" ? championsItems[id] : undefined;
  const item = mod ? (mod.inherit ? { ...base, ...mod } : mod) : base;
  if (item && id === "griseousorb" && (game === "sword_shield" || game === "ultra_sun_ultra_moon")) return { ...item, onTakeItem: orb };
  return item;
}

/** A Pokémon as the handlers read it: its baseSpecies (the species it entered as: num, name, baseSpecies, tags). */
function mon(id: string): unknown {
  const entry = pokedex[id];
  if (!entry) throw new Error(`No pinned species ${id}.`);
  return { baseSpecies: { ...entry, baseSpecies: entry.baseSpecies ?? entry.name, tags: entry.tags ?? [] } };
}
/** One onTakeItem call as runEvent or singleEvent makes it: false refuses; anything else (undefined: the item) lets it go. */
function passes(item: ItemData, pokemon: unknown, source: unknown): boolean {
  const handler = item.onTakeItem;
  if (handler === false) return false;
  if (!handler) return true;
  return handler.call({ activeMove: { id: "trick" } }, item, pokemon, source) !== false;
}

describe("Trick and Switcheroo's TakeItem checks equal itemTakeable (ADDENDUM §4.12.2, §9)", () => {
  const orb = griseousOrb();
  for (const [game, file] of Object.entries(CATALOGS)) {
    it(game, () => {
      const catalog = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as BattleCatalog;
      const runtime: BattleRuntime = createBattleRuntime(catalog, "0".repeat(64));
      const paradox = usesHelpers(runtime).paradox;
      const species = catalog.species.map((entry) => entry.id).filter((id) => pokedex[id]);
      const neutral = "snorlax";
      let checked = 0;
      for (const { id } of catalog.items) {
        const item = itemFor(game, id, orb);
        if (!item || !("onTakeItem" in item)) continue;
        // The species that make a check refuse, either as the Pokémon or as the other one (every pinned handler reads one
        // Pokémon, or either of the two: the pairs among them and a neutral one cover every pair).
        const matters = species.filter((each) => !passes(item, mon(each), mon(neutral)) || !passes(item, mon(neutral), mon(each)));
        // An item no Pokémon gives up (a Z-Crystal, onTakeItem: false): each species with the neutral one, both ways.
        if (item.onTakeItem === false) {
          for (const each of species) {
            expect(itemTakeable(runtime, paradox, id, each, neutral, true) || itemTakeable(runtime, paradox, id, neutral, each, true), `${game} ${id}: ${each}`).toBe(false);
          }
          checked++;
          continue;
        }
        const pool = [...new Set([neutral, ...matters])];
        for (const holder of pool) {
          for (const receiver of pool) {
            const showdown = passes(item, mon(holder), mon(receiver)) && passes(item, mon(receiver), mon(holder));
            expect(itemTakeable(runtime, paradox, id, holder, receiver, true), `${game} ${id}: ${holder} → ${receiver}`).toBe(showdown);
            checked++;
          }
        }
        // Every other species moves it to and from the neutral one.
        for (const each of species) {
          if (pool.includes(each)) continue;
          expect(itemTakeable(runtime, paradox, id, each, neutral, true) && itemTakeable(runtime, paradox, id, neutral, each, true), `${game} ${id}: ${each}`).toBe(true);
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});
