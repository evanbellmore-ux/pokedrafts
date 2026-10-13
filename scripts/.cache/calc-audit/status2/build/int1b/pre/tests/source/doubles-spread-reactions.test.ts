import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CACHE, ROOT, SHOWDOWN_SOURCE } from "../../scripts/lib/champions-data/sources.mjs";
import { LISTED_REACTIONS, STATE_REACTIONS, USER_REACTIONS } from "../../app/lib/battle/doubles-reactions";
import type { BattleCatalog } from "../../app/lib/battle/types";

/**
 * A spread move's reactions on its user (status2 tier2-moves.md §3.3, ADDENDUM2 §4.3 K: app/lib/battle/doubles-reactions.ts
 * USER_REACTIONS, spreadUser) against pinned Showdown c23d2e94's compiled dex (node_modules/.cache/champions/showdown-dex-
 * <revision>) and the pair's step (uses-to-ko.ts HIT_ABILITIES): every catalog ability and item whose hit reaction acts on
 * the move's user is classified, the step lists exactly the "listed" ones (a spread step's UsesEnv.spreadUser), and each
 * "listed" or "state" reaction changes only what spreadUser composes. A data refresh that adds one fails here until
 * doubles-reactions.ts classifies it.
 */
const DEX = join(CACHE, `showdown-dex-${SHOWDOWN_SOURCE.revision}`);
const load = createRequire(import.meta.url);
type Entry = Record<string, unknown>;
function table(file: string, key: string): Record<string, Entry> {
  const path = join(DEX, file);
  if (!existsSync(path)) throw new Error(`The pinned Showdown dex is missing (${path}); run npm run data:champions.`);
  return load(path)[key] as Record<string, Entry>;
}
const dex = {
  abilities: [table("data/abilities.js", "Abilities"), table("data/mods/champions/abilities.js", "Abilities")],
  items: [table("data/items.js", "Items"), table("data/mods/champions/items.js", "Items")],
};
const CATALOGS = ["data/champions/catalog.json", "data/battle/scarlet_violet/catalog.json", "data/battle/sword_shield/catalog.json", "data/battle/ultra_sun_ultra_moon/catalog.json"];
const catalogs = CATALOGS.map((file) => JSON.parse(readFileSync(join(ROOT, file), "utf8")) as BattleCatalog);
const inCatalogs = {
  abilities: new Set(catalogs.flatMap((catalog) => catalog.abilities.map((ability) => ability.id))),
  items: new Set(catalogs.flatMap((catalog) => catalog.items.map((item) => item.id))),
};
/** The hit reactions of the target's ability or item (PS/sim/battle-actions.ts spreadMoveHit: DamagingHit; the hit's onHit; AfterMoveSecondary). */
const HOOKS = ["onDamagingHit", "onAfterMoveSecondary", "onHit"];
/** A handler that acts on the move's user: its status, ability, volatiles, item or side, a boost or damage on it, a swap, or every active Pokémon. */
const ON_USER = /source\.(trySetStatus|setStatus|setAbility|addVolatile|takeItem|setItem|side|forceSwitchFlag)|this\.(boost|damage)\([^;]*\bsource\b|skillSwap\(source|getAllActive\(/;

/** Every catalog ability and item with a hit reaction on the user, and the handlers' sources. */
function reactionsOnUser(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [kind, tables] of Object.entries(dex) as [keyof typeof dex, Record<string, Entry>[]][]) {
    for (const entries of tables) {
      for (const [id, entry] of Object.entries(entries)) {
        if (!inCatalogs[kind].has(id)) continue;
        for (const hook of HOOKS) {
          const handler = entry[hook];
          if (typeof handler === "function" && ON_USER.test(String(handler))) out.set(id, [...(out.get(id) ?? []), String(handler)]);
        }
      }
    }
  }
  return out;
}

describe("a spread move's reactions on its user (T2M §3.3)", () => {
  const found = reactionsOnUser();
  it("classifies every catalog ability and item whose hit reaction acts on the move's user, and nothing else", () => {
    expect([...found.keys()].filter((id) => !(id in USER_REACTIONS)).sort(), "unclassified").toEqual([]);
    expect(Object.keys(USER_REACTIONS).filter((id) => !found.has(id)).sort(), "classified but not a reaction on the user").toEqual([]);
  });
  it("lists in the step exactly the reactions on the user that uses-to-ko.ts HIT_ABILITIES marks `attacker` (UsesEnv.spreadUser)", () => {
    const source = readFileSync(fileURLToPath(new URL("../../app/lib/battle/uses-to-ko.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
    const start = source.indexOf("const HIT_ABILITIES");
    const block = source.slice(start, source.indexOf("\n};\n", start));
    const marked = [...block.matchAll(/^\s*(\w+): \{[^\n]*attacker: true/gm)].map((match) => match[1]).sort();
    expect(marked).toEqual([...LISTED_REACTIONS].sort());
  });
  it("each listed reaction is a Speed drop on the user (spreadUser replays it through boost())", () => {
    for (const id of LISTED_REACTIONS) {
      const text = found.get(id)!.join("\n");
      expect(text, id).toMatch(/spe: -1/);
      expect(text, id).not.toMatch(/trySetStatus|setAbility|takeItem|setItem|this\.damage/);
    }
  });
  it("each state reaction changes the user's status, ability or item, which spreadUser composes in target order", () => {
    for (const id of STATE_REACTIONS) {
      const text = found.get(id)!.join("\n");
      expect(text, id).toMatch(/trySetStatus|setAbility|skillSwap\(source|takeItem|setItem|formeChange|this\.boost/);
    }
  });
});
