import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CACHE, ROOT, SHOWDOWN_SOURCE } from "../../scripts/lib/champions-data/sources.mjs";
import { KLUTZ_IGNORED_ITEMS, knownStolenBerry, RESIST_BERRIES, stolenEat, UNEATEN_BERRIES, type StolenEat } from "../../app/lib/battle/hit-loop";
import type { BattleCatalog, CombatStat } from "../../app/lib/battle/types";

/**
 * hit-loop.ts stolenEat (what Bug Bite's and Pluck's user gets from the target's Berry) against pinned Showdown c23d2e94: every
 * Berry of the four catalogs, read from the compiled dex the data build makes (node_modules/.cache/champions/showdown-dex-<rev>,
 * `npm run data:champions`) and, for the generation 7 mod's Figy family, the pinned source. A data refresh that adds a Berry
 * or changes an onEat fails here until stolenEat follows it.
 */
const DEX = join(CACHE, `showdown-dex-${SHOWDOWN_SOURCE.revision}`);
const SOURCE = join(CACHE, `pokemon-showdown-${SHOWDOWN_SOURCE.revision}`);
const load = createRequire(import.meta.url);
type Entry = Record<string, unknown>;
function table(file: string, key: string): Record<string, Entry> {
  const path = join(DEX, file);
  if (!existsSync(path)) throw new Error(`The pinned Showdown dex is missing (${path}); run npm run data:champions.`);
  return load(path)[key] as Record<string, Entry>;
}
const items = table("data/items.js", "Items"), championsItems = table("data/mods/champions/items.js", "Items");
const moves = table("data/moves.js", "Moves"), abilities = table("data/abilities.js", "Abilities");
const item = (id: string, game: string): Entry => {
  const mod = game === "champions" ? championsItems[id] : undefined;
  return mod ? (mod.inherit ? { ...items[id], ...mod } : mod) : items[id];
};
const CATALOGS: Record<string, { file: string; generation: number }> = {
  champions: { file: "data/champions/catalog.json", generation: 0 }, scarlet_violet: { file: "data/battle/scarlet_violet/catalog.json", generation: 9 },
  sword_shield: { file: "data/battle/sword_shield/catalog.json", generation: 8 }, ultra_sun_ultra_moon: { file: "data/battle/ultra_sun_ultra_moon/catalog.json", generation: 7 },
};
const text = (fn: unknown) => String(fn).replace(/\s+/g, " ");
/** The divisor of the heal the generation 7 mod's entry for `id` (`\tid: {` to its `\n\t},`) gives in its onEat, or null. */
function gen7Heal(source: string, id: string): number | null {
  const start = source.indexOf(`\n\t${id}: {`);
  if (start < 0) return null;
  const block = source.slice(start, source.indexOf("\n\t},", start));
  const found = block.match(/onEat\(pokemon\) \{\s*this\.heal\(pokemon\.baseMaxhp \/ (\d)\)/);
  return found ? Number(found[1]) : null;
}

/** stolenEat's expectation from an onEat handler's source, for an eater with 145 base maximum HP. */
function expected(onEat: unknown, gen7Heal: number | null): StolenEat {
  const none: StolenEat = { heal: 0, pouch: 0, stages: {}, cures: [], curesConfusion: false };
  if (onEat === false) return none;
  const source = text(onEat);
  const out: StolenEat = { ...none, stages: {}, cures: [] };
  const part = source.match(/this\.heal\(pokemon\.baseMaxhp \/ (\d)\)/);
  if (part) out.heal = Math.floor(145 / Number(gen7Heal ?? part[1]));
  if (/this\.heal\(10\)/.test(source)) out.heal = 10;
  const raised = source.match(/this\.boost\(\{ (\w+): 1 \}\)/);
  if (raised) out.stages = { [raised[1] as CombatStat]: 1 };
  const minus = source.match(/getNature\(\)\.minus === '(\w+)'/);
  if (minus) out.confuses = minus[1] as CombatStat;
  if (/addVolatile\('focusenergy'\)/.test(source)) out.focusEnergy = true;
  if (/boost\[randomStat\] = 2/.test(source)) out.starf = 2;
  if (/moveSlot\.pp \+ addedPP/.test(source) && /\? 20 : 10/.test(source)) out.leppa = 10;
  if (/removeVolatile\('confusion'\)/.test(source)) out.curesConfusion = true;
  if (/cureStatus\(\)/.test(source)) {
    const checked = [...source.matchAll(/pokemon\.status === '(\w+)'/g)].map((match) => match[1]);
    out.cures = checked.length ? checked : ["brn", "par", "psn", "tox", "slp", "frz"];
  }
  return out;
}

describe("the Berry Bug Bite and Pluck make their user eat (hit-loop.ts stolenEat)", () => {
  it("eats through singleEvent('Eat') on the user, then runEvent('EatItem'), only while the user stands", () => {
    for (const id of ["bugbite", "pluck"]) {
      const onHit = text(moves[id].onHit);
      expect(onHit).toContain("if (source.hp && item.isBerry && target.takeItem(source))");
      expect(onHit).toContain("if (this.singleEvent('Eat', item, target.itemState, source, source, move)) { this.runEvent('EatItem', source, source, move, item);");
    }
    expect(text(abilities.cheekpouch.onEatItem)).toContain("this.heal(pokemon.baseMaxhp / 3)");
    expect(text(abilities.ripen.onTryHeal)).toContain("if (effect.isBerry) return this.chainModify(2)");
    expect(text(abilities.ripen.onChangeBoost)).toContain("boost[b] *= 2");
    expect(text(abilities.stickyhold.onTakeItem)).toContain("if (!pokemon.hp || pokemon.item === 'stickybarb') return;");
    expect(text(abilities.cudchew.onEatItem)).toContain("!['bugbite', 'pluck'].includes(effect.id)");
  });

  it.each(Object.keys(CATALOGS))("follows each %s Berry's onEat", (game) => {
    const { file, generation } = CATALOGS[game];
    const catalog = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as BattleCatalog;
    // The generation 7 mod's Figy family heals a half (data/mods/gen7/items.ts onEat this.heal(pokemon.baseMaxhp / 2)).
    const gen7 = readFileSync(join(SOURCE, "data/mods/gen7/items.ts"), "utf8");
    const berries = catalog.items.map((row) => row.id).filter((id) => items[id]?.isBerry);
    expect(berries.length).toBeGreaterThan(20);
    for (const id of berries) {
      const entry = item(id, game);
      const heal = generation === 7 ? gen7Heal(gen7, id) : null;
      expect(knownStolenBerry(id), id).toBe(true);
      expect(UNEATEN_BERRIES.has(id), id).toBe(entry.onEat === false);
      expect(stolenEat(id, { baseMaxHP: 145, ability: "technician", ignoresItem: false }, generation), id).toEqual(expected(entry.onEat, heal));
      // Cheek Pouch heals as the EatItem runs: for every Berry whose Eat does not return false, and for any once the Eat is suppressed.
      expect(stolenEat(id, { baseMaxHP: 145, ability: "cheekpouch", ignoresItem: false }, generation).pouch, id).toBe(entry.onEat === false ? 0 : 48);
      expect(stolenEat(id, { baseMaxHP: 145, ability: "cheekpouch", ignoresItem: true }, generation).pouch, id).toBe(48);
      // Ripen doubles a Berry's heal and its rises.
      const ripened = stolenEat(id, { baseMaxHP: 145, ability: "ripen", ignoresItem: false }, generation), plain = expected(entry.onEat, heal);
      expect(ripened.heal, id).toBe(plain.heal * 2);
      expect(ripened.stages, id).toEqual(Object.fromEntries(Object.entries(plain.stages).map(([stat, amount]) => [stat, amount! * 2])));
    }
  });

  it("names the resist Berries and the items Klutz ignores as the dex has them", () => {
    const resist = Object.entries(items).filter(([, entry]) => entry.isBerry && typeof entry.onSourceModifyDamage === "function"
      && /eatItem\(\)/.test(text(entry.onSourceModifyDamage))).map(([id]) => id).sort();
    expect([...RESIST_BERRIES].sort()).toEqual(resist);
    expect([...KLUTZ_IGNORED_ITEMS].sort()).toEqual(Object.entries(items).filter(([, entry]) => entry.ignoreKlutz).map(([id]) => id).sort());
  });
});
