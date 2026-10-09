import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CACHE, ROOT, SHOWDOWN_SOURCE } from "../../scripts/lib/champions-data/sources.mjs";
import { RESIST_BERRIES } from "../../app/lib/battle/doubles-actions";
import { PASSING_MOVES, SUB_PER_HIT } from "../../app/lib/battle/doubles-substitute";
import type { BattleCatalog } from "../../app/lib/battle/types";

/**
 * The 2v2 turn's hits into a Substitute (status-eot ADDENDUM §4.13, doubles-substitute.ts) against pinned Showdown
 * c23d2e94's compiled dex (node_modules/.cache/champions/showdown-dex-<revision>) and the engine's per-hit reads
 * (@smogon/calc dist/mechanics): every handler a hit into a Substitute meets is classified (§4.13.10) or unreachable in
 * the four catalogs; SUB_PER_HIT is exactly the target effects the engine's later hits read; no catalog move has a hit
 * count above one with recoil, drain or a self-cost (hit-loop.ts subHit, §3.6); and the moves that pass a Substitute.
 * A data refresh that adds one fails here until doubles-substitute.ts models or guards it.
 */
const DEX = join(CACHE, `showdown-dex-${SHOWDOWN_SOURCE.revision}`);
const load = createRequire(import.meta.url);
type Entry = Record<string, unknown> & { name?: string; flags?: Record<string, number>; category?: string; multihit?: unknown };
function table(file: string, key: string): Record<string, Entry> {
  const path = join(DEX, file);
  if (!existsSync(path)) throw new Error(`The pinned Showdown dex is missing (${path}); run npm run data:champions.`);
  return load(path)[key] as Record<string, Entry>;
}
const dex = { abilities: table("data/abilities.js", "Abilities"), items: table("data/items.js", "Items"), moves: table("data/moves.js", "Moves") };
const champions = { abilities: table("data/mods/champions/abilities.js", "Abilities"), items: table("data/mods/champions/items.js", "Items"), moves: table("data/mods/champions/moves.js", "Moves") };
const CATALOGS: Record<string, string> = {
  champions: "data/champions/catalog.json", scarlet_violet: "data/battle/scarlet_violet/catalog.json",
  sword_shield: "data/battle/sword_shield/catalog.json", ultra_sun_ultra_moon: "data/battle/ultra_sun_ultra_moon/catalog.json",
};
const catalogs = Object.values(CATALOGS).map((file) => JSON.parse(readFileSync(join(ROOT, file), "utf8")) as BattleCatalog);
const inCatalogs = {
  moves: new Set(catalogs.flatMap((catalog) => catalog.moves.map((move) => move.id))),
  items: new Set(catalogs.flatMap((catalog) => catalog.items.map((item) => item.id))),
  abilities: new Set(catalogs.flatMap((catalog) => catalog.abilities.map((ability) => ability.id))),
};
const toId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The handlers of an entry (its condition's, secondary's and self's too) whose source matches `test`, as "id.path.key". */
function handlers(kind: keyof typeof dex, test: (key: string, source: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const tables of [dex[kind], champions[kind]]) {
    for (const [id, entry] of Object.entries(tables)) {
      const walk = (value: Record<string, unknown>, path: string) => {
        for (const [key, each] of Object.entries(value)) {
          if (typeof each === "function" && test(key, String(each))) out.add(id);
          else if (each && typeof each === "object" && ["condition", "secondary", "self"].includes(key)) walk(each as Record<string, unknown>, `${path}${key}.`);
        }
      };
      walk(entry, "");
    }
  }
  return out;
}

describe("what a hit into a Substitute meets (ADDENDUM §4.13.10)", () => {
  /**
   * Moves with their own onAfterSubDamage (data/moves.ts) and what the turn does with each: modelled through the part
   * path (uses-to-ko.ts TurnStepPart: Ice Spinner and Steel Roller end the terrain), by Track B's end of turn (Rapid Spin
   * and Mortal Spin end their user's Leech Seed and trap, C16; Rapid Spin, Mortal Spin, Ceaseless Edge and Stone Axe's
   * hazards in E2), a hint only (Shell Side Arm's category); existing guards (Core Enforcer: volatileGuard; Flame Burst:
   * a presence guard, C17); guarded here (G-Max Snooze: Max Moves; Splintered Stormshards: a signature Z-Move).
   */
  const MOVES_AFTER_SUB: Record<string, "modelled" | "existing guard" | "guarded"> = {
    icespinner: "modelled", steelroller: "modelled", rapidspin: "modelled", mortalspin: "modelled", ceaselessedge: "modelled", stoneaxe: "modelled",
    shellsidearm: "modelled", coreenforcer: "existing guard", flameburst: "existing guard", gmaxsnooze: "guarded", splinteredstormshards: "guarded",
  };
  /** Items with onAfterSubDamage: Air Balloon pops (the part path; the prefix's faint path). */
  const ITEMS_AFTER_SUB: Record<string, "modelled"> = { airballoon: "modelled" };
  /**
   * Item and ability handlers that read a hit into a Substitute (move.hitSub, or the substitute volatile): the resist
   * Berries and Chilan Berry (their onSourceModifyDamage returns: searchFor's behindSubstitute reads them as Leftovers),
   * Disguise and Ice Face (onEffectiveness, onCriticalHit return: no ability in the calculation), Intimidate and
   * Supersweet Syrup (onStart, settled as the turn starts: no hit).
   */
  const STAND_INS = new Set([...RESIST_BERRIES, "disguise", "iceface"]);
  const ENTRY = new Set(["intimidate", "supersweetsyrup"]);
  /** Moves that read the substitute volatile themselves: Track A's Substitute and Shed Tail, Sky Drop (a presence guard), and moves the turn does not model (L). */
  const MOVES_READING = new Set(["substitute", "shedtail", "skydrop", "aromatherapy", "defog", "sparklyswirl"]);
  const reads = (_key: string, source: string) => /hitSub|volatiles\[['"]substitute['"]\]|volatiles\.substitute|HIT_SUBSTITUTE/.test(source);

  it("every move's and item's onAfterSubDamage is classified or unreachable", () => {
    const moves = handlers("moves", (key) => key === "onAfterSubDamage");
    expect([...moves].filter((id) => inCatalogs.moves.has(id) && !MOVES_AFTER_SUB[id])).toEqual([]);
    expect(handlers("abilities", (key) => key === "onAfterSubDamage")).toEqual(new Set());
    const items = handlers("items", (key) => key === "onAfterSubDamage");
    expect([...items].filter((id) => inCatalogs.items.has(id) && !ITEMS_AFTER_SUB[id])).toEqual([]);
    // Each classified entry is a real handler (the table has no stale rows).
    expect(Object.keys(MOVES_AFTER_SUB).filter((id) => !moves.has(id))).toEqual([]);
  });

  it("every item and ability that reads a hit into a Substitute is a stand-in or acts on entry", () => {
    const found = [...handlers("items", reads), ...handlers("abilities", reads)].filter((id) => inCatalogs.items.has(id) || inCatalogs.abilities.has(id));
    expect(found.filter((id) => !STAND_INS.has(id) && !ENTRY.has(id))).toEqual([]);
    expect([...RESIST_BERRIES].filter((id) => inCatalogs.items.has(id) && !found.includes(id))).toEqual([]);
    expect([...handlers("moves", reads)].filter((id) => inCatalogs.moves.has(id) && !MOVES_READING.has(id))).toEqual([]);
  });

  it("PASSING_MOVES is every catalog damaging move that passes a Substitute without the sound flag (flags.bypasssub)", () => {
    const passing = Object.entries(dex.moves).filter(([id, move]) => inCatalogs.moves.has(id) && move.category !== "Status" && move.flags?.bypasssub && !move.flags?.sound).map(([id]) => id);
    expect(passing.sort()).toEqual([...PASSING_MOVES].filter((id) => inCatalogs.moves.has(id)).sort());
  });
});

describe("SUB_PER_HIT is the engine's per-hit reads of the target (ADDENDUM §4.13.6)", () => {
  const MECHANICS = join(ROOT, "node_modules/@smogon/calc/dist/mechanics");
  const source = (file: string) => readFileSync(join(MECHANICS, file), "utf8");
  /** The names in `defender.hasAbility(...)` and `defender.hasItem(...)` calls of a source fragment. */
  const calls = (text: string, method: "hasAbility" | "hasItem") => [...text.matchAll(new RegExp(`defender\\.${method}\\(([^)]*)\\)`, "g"))]
    .flatMap((match) => [...match[1].matchAll(/'([^']+)'/g)].map((name) => toId(name[1])));
  const boost = (() => {
    const text = source("util.js");
    const start = text.indexOf("function checkMultihitBoost");
    return text.slice(start, text.indexOf("\n}\n", start));
  })();
  /** The conditions of the final modifiers' `hitCount === 0` terms (gen789.js, champions.js). */
  const firstHitTerms = ["gen789.js", "champions.js"].flatMap((file) => {
    const text = source(file);
    const out: string[] = [];
    for (let at = text.indexOf("hitCount === 0"); at >= 0; at = text.indexOf("hitCount === 0", at + 1)) out.push(text.slice(text.lastIndexOf("if (", at), text.indexOf(")) {", at) + 2));
    return out;
  });

  it("abilities: checkMultihitBoost's and the first-hit terms', less Parental Bond's own Gooey and Tangling Hair", () => {
    const engine = new Set([...calls(boost, "hasAbility"), ...firstHitTerms.flatMap((term) => calls(term, "hasAbility"))]);
    for (const only of ["gooey", "tanglinghair"]) expect(engine.delete(only), only).toBe(true);
    // Contrary and Simple there only turn the items' rises (Luminous Moss, Kee and Maranga Berry), each read on its own.
    for (const modifier of ["contrary", "simple"]) expect(engine.delete(modifier), modifier).toBe(true);
    expect([...engine].sort()).toEqual([...SUB_PER_HIT.abilities, ...SUB_PER_HIT.contact].sort());
  });

  it("items: checkMultihitBoost's and the first-hit resist Berries, less those calculate.ts holds back between hits", () => {
    const engine = new Set(calls(boost, "hasItem"));
    if (firstHitTerms.some((term) => /getBerryResistType\)?\(defender\.item\)/.test(term))) for (const berry of RESIST_BERRIES) engine.add(berry);
    // calculate.ts AFTER_MOVE_ITEMS (Kee and Maranga Berry, White Herb): held back from the hits between, they act after the whole move.
    const held = readFileSync(join(ROOT, "app/lib/battle/calculate.ts"), "utf8").match(/const AFTER_MOVE_ITEMS = new Set\(\[([^\]]*)\]\)/);
    expect(held, "calculate.ts AFTER_MOVE_ITEMS").not.toBeNull();
    const after = [...held![1].matchAll(/"([^"]+)"/g)].map((name) => toId(name[1]));
    expect(after.sort()).toEqual(["keeberry", "marangaberry", "whiteherb"]);
    for (const each of after) expect(engine.delete(each), each).toBe(true);
    expect([...engine].sort()).toEqual([...SUB_PER_HIT.items].sort());
  });
});

describe("hit-loop.ts subHit's premise (ADDENDUM §3.6)", () => {
  it("no catalog move has a hit count above one with recoil, drain or a self-cost", () => {
    const costly = Object.entries(dex.moves).filter(([id, move]) => inCatalogs.moves.has(id) && move.category !== "Status" && move.multihit
      && (move.recoil || move.drain || move.mindBlownRecoil || move.chloroblastRecoil || move.struggleRecoil)).map(([id]) => id);
    expect(costly).toEqual([]);
    const modded = Object.entries(champions.moves).filter(([, move]) => move.multihit && (move.recoil || move.drain || move.mindBlownRecoil || move.chloroblastRecoil));
    expect(modded).toEqual([]);
  });
});
