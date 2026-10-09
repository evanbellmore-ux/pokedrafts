import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CACHE, ROOT, SHOWDOWN_SOURCE } from "../../scripts/lib/champions-data/sources.mjs";
import { LAST_ORDER, RESIDUAL_KEYS, type ResidualKey } from "../../app/lib/battle/residuals";
import type { BattleCatalog } from "../../app/lib/battle/types";

/**
 * Every residual handler of pinned Showdown c23d2e94 (onResidual, onFieldResidual, onSideResidual on abilities, items,
 * move conditions and conditions; the base data and the Champions mod, read from the compiled dex `npm run data:champions`
 * makes) is classified for the 2v2 end of turn (status-eot SPEC §9 "doubles-residuals.test.ts"): modelled (its sort key,
 * as sim/battle.ts resolvePriority makes it, equals RESIDUAL_KEYS), state only (a countdown or a next-turn change the
 * turn's HP never reads), guarded (the end of turn is not estimated when it acts), or unreachable in the four catalogs.
 * A refresh that adds a handler or changes a key fails here until the engine models or guards it.
 */
const DEX = join(CACHE, `showdown-dex-${SHOWDOWN_SOURCE.revision}`);
const load = createRequire(import.meta.url);
type Entry = Record<string, unknown> & { name?: string; isNonstandard?: string | null; condition?: Entry; effectType?: string };
type Table = Record<string, Entry>;
function table(file: string, key: string): Table {
  const path = join(DEX, file);
  if (!existsSync(path)) throw new Error(`The pinned Showdown dex is missing (${path}); run npm run data:champions.`);
  return load(path)[key] as Table;
}
const base = { abilities: table("data/abilities.js", "Abilities"), items: table("data/items.js", "Items"), moves: table("data/moves.js", "Moves"), conditions: table("data/conditions.js", "Conditions") };
const champions = { abilities: table("data/mods/champions/abilities.js", "Abilities"), items: table("data/mods/champions/items.js", "Items"), moves: table("data/mods/champions/moves.js", "Moves"), conditions: table("data/mods/champions/conditions.js", "Conditions") };

const CATALOGS = ["data/champions/catalog.json", "data/battle/scarlet_violet/catalog.json", "data/battle/sword_shield/catalog.json", "data/battle/ultra_sun_ultra_moon/catalog.json"]
  .map((file) => JSON.parse(readFileSync(join(ROOT, file), "utf8")) as BattleCatalog);
const inCatalogs = (kind: "abilities" | "items" | "moves", id: string) => CATALOGS.some((catalog) => {
  const list = (catalog as unknown as Record<string, unknown>)[kind];
  const values = Array.isArray(list) ? list : Object.values(list ?? {});
  return (values as { id: string }[]).some((each) => each.id === id);
});

/** How the 2v2 end of turn treats each handler (doubles-eot.ts). `modelled` names its RESIDUAL_KEYS entry. */
const CLASSES: Record<string, { modelled: string } | "state" | "guarded" | "unreachable"> = {
  // Order 1: the weather (data/conditions.ts onFieldResidual), with its per-Pokémon part and the Update after it.
  ...Object.fromEntries(["deltastream", "desolateland", "hail", "primordialsea", "raindance", "sandstorm", "snowscape", "sunnyday"].map((id) => [`condition:${id}:onFieldResidual`, { modelled: "weather" }])),
  "condition:futuremove:onResidual": "guarded",
  "move:wish:onResidual": { modelled: "wish" },
  "move:firepledge:onResidual": "guarded", "move:gmaxcannonade:onResidual": "guarded", "move:gmaxvinelash:onResidual": "guarded",
  "move:gmaxvolcalith:onResidual": "guarded", "move:gmaxwildfire:onResidual": "guarded",
  "move:grassyterrain:onResidual": { modelled: "grassyterrain" },
  "ability:healer:onResidual": { modelled: "healer" }, "ability:hydration:onResidual": { modelled: "hydration" }, "ability:shedskin:onResidual": { modelled: "shedskin" },
  "item:leftovers:onResidual": { modelled: "leftovers" }, "item:blacksludge:onResidual": { modelled: "blacksludge" },
  "move:aquaring:onResidual": { modelled: "aquaring" }, "move:ingrain:onResidual": { modelled: "ingrain" }, "move:leechseed:onResidual": { modelled: "leechseed" },
  "condition:psn:onResidual": { modelled: "psn" }, "condition:tox:onResidual": { modelled: "tox" }, "condition:brn:onResidual": { modelled: "brn" },
  "item:berry:onResidual": "unreachable", "item:goldberry:onResidual": "unreachable",
  // Nightmare, Octolock, Telekinesis, Heal Block, Embargo and Uproar are not modelled moves (an end-of-turn guard when last).
  "move:nightmare:onResidual": "guarded", "move:octolock:onResidual": "guarded", "move:uproar:onResidual": "guarded",
  "move:curse:onResidual": { modelled: "curse" },
  "condition:partiallytrapped:onResidual": { modelled: "partiallytrapped" }, "move:saltcure:onResidual": { modelled: "saltcure" },
  "move:syrupbomb:onResidual": { modelled: "syrupbomb" },
  ...Object.fromEntries(["taunt", "encore", "disable", "magnetrise", "telekinesis", "healblock", "embargo", "throatchop"].map((id) => [`move:${id}:onResidual`, "state"])),
  // Roost's volatile ends at 25: grounding the Orbs (28.3) read under Misty Terrain.
  "move:roost:onResidual": { modelled: "roost" },
  "move:yawn:onResidual": { modelled: "yawn" }, "move:perishsong:onResidual": { modelled: "perishsong" },
  ...Object.fromEntries(["auroraveil", "firepledge", "gmaxcannonade", "gmaxvinelash", "gmaxvolcalith", "gmaxwildfire", "grasspledge", "lightscreen", "luckychant", "mist",
    "reflect", "safeguard", "tailwind", "waterpledge"].map((id) => [`move:${id}:onSideResidual`, "state"])),
  ...Object.fromEntries(["electricterrain", "grassyterrain", "gravity", "magicroom", "mistyterrain", "mudsport", "psychicterrain", "trickroom", "watersport", "wonderroom"]
    .map((id) => [`move:${id}:onFieldResidual`, "state"])),
  "ability:baddreams:onResidual": { modelled: "baddreams" }, "ability:speedboost:onResidual": { modelled: "speedboost" },
  "ability:cudchew:onResidual": "guarded", "ability:harvest:onResidual": "guarded", "ability:pickup:onResidual": "guarded", "ability:moody:onResidual": "guarded",
  "ability:slowstart:onResidual": "state",
  "item:stickybarb:onResidual": { modelled: "stickybarb" }, "item:flameorb:onResidual": { modelled: "flameorb" }, "item:toxicorb:onResidual": { modelled: "toxicorb" },
  "ability:hungerswitch:onResidual": { modelled: "hungerswitch" }, "item:whiteherb:onResidual": { modelled: "whiteherb" }, "item:ejectpack:onResidual": { modelled: "ejectpack" },
  "ability:opportunist:onResidual": "guarded", "item:mirrorherb:onResidual": "guarded",
  "ability:powerconstruct:onResidual": "guarded", "ability:schooling:onResidual": "guarded", "ability:shieldsdown:onResidual": "guarded", "ability:zenmode:onResidual": "guarded",
  "item:micleberry:onResidual": { modelled: "micleberry" },
  // Dynamax counts its turns (the turn assumes it started this turn); a locked move, Ice Ball and Rollout carry to the next turn.
  "condition:dynamax:onResidual": "state", "condition:lockedmove:onResidual": "state", "move:iceball:onResidual": "state", "move:rollout:onResidual": "state",
};

const PREFIXES = ["onResidual", "onFieldResidual", "onSideResidual"] as const;
type Found = { kind: string; id: string; prefix: string; key: ResidualKey; past: boolean };

/** sim/battle.ts resolvePriority's subOrder default by effect type and where the condition sits. */
function defaultSubOrder(kind: string, id: string, entry: Entry, move?: Entry): number {
  if (kind === "ability") return entry.name === "Poison Touch" || entry.name === "Perish Body" ? 6 : entry.name === "Stall" ? 9 : 7;
  if (kind === "item") return 8;
  if (kind === "condition") {
    if (entry.effectType === "Status") return 0;
    if (entry.effectType === "Weather") return 5;
    return id === "futuremove" ? 3 : 2;
  }
  if (move?.slotCondition) return 3;
  if (move?.sideCondition) return 4;
  if (move?.terrain || move?.pseudoWeather || move?.weather) return 5;
  return 2;
}

function handlers(): Found[] {
  const out = new Map<string, Found>();
  const visit = (kind: string, id: string, entry: Entry | undefined, past: boolean, move?: Entry) => {
    if (!entry) return;
    for (const prefix of PREFIXES) {
      // A handler with a callback or an order (a countdown with neither, as Protect's, acts at no point the turn reads).
      if (typeof entry[prefix] !== "function" && entry[`${prefix}Order`] === undefined) continue;
      const key = { order: (entry[`${prefix}Order`] as number) || LAST_ORDER, subOrder: (entry[`${prefix}SubOrder`] as number) || defaultSubOrder(kind, id, entry, move), priority: (entry[`${prefix}Priority`] as number) || 0 };
      out.set(`${kind}:${id}:${prefix}`, { kind, id, prefix, key, past });
    }
  };
  for (const tables of [base, champions]) {
    for (const [id, entry] of Object.entries(tables.abilities)) visit("ability", id, { ...base.abilities[id], ...entry }, !!entry.isNonstandard);
    for (const [id, entry] of Object.entries(tables.items)) visit("item", id, { ...base.items[id], ...entry }, !!entry.isNonstandard);
    for (const [id, entry] of Object.entries(tables.moves)) {
      const move = { ...base.moves[id], ...entry };
      visit("move", id, move.condition ? { ...base.moves[id]?.condition, ...move.condition } : undefined, !!move.isNonstandard, move);
    }
    for (const [id, entry] of Object.entries(tables.conditions)) visit("condition", id, { ...base.conditions[id], ...entry }, false);
  }
  return [...out.values()];
}

describe("the 2v2 end of turn's residual handlers (status-eot SPEC §9)", () => {
  const found = handlers();

  it("classifies every pinned residual handler", () => {
    const missing = found.map((each) => `${each.kind}:${each.id}:${each.prefix}`).filter((name) => !(name in CLASSES));
    expect(missing).toEqual([]);
    expect(found.length).toBeGreaterThan(80);
  });

  it("gives every modelled handler the pinned order, subOrder and priority (RESIDUAL_KEYS)", () => {
    for (const each of found) {
      const kind = CLASSES[`${each.kind}:${each.id}:${each.prefix}`];
      if (typeof kind !== "object") continue;
      expect(RESIDUAL_KEYS[kind.modelled], `${each.kind}:${each.id}`).toEqual(each.key);
    }
    // Every key the engine uses but the weather's sub-effects and the guarded ones comes from a pinned handler.
    const used = new Set(Object.values(CLASSES).filter((kind): kind is { modelled: string } => typeof kind === "object").map((kind) => kind.modelled));
    const subEffects = ["sandstorm", "hail", "icebody", "raindish", "dryskin", "solarpower", "poisonheal", "futuremove", "moody", "harvest", "pickup", "cudchew", "slowstart",
      "opportunist", "powerconstruct", "schooling", "shieldsdown", "zenmode", "mirrorherb"];
    for (const key of Object.keys(RESIDUAL_KEYS)) if (!subEffects.includes(key)) expect(used.has(key), key).toBe(true);
    // The guarded handlers' keys too, where the engine lists them.
    for (const each of found) {
      const name = `${each.kind}:${each.id}:${each.prefix}`;
      if (CLASSES[name] === "guarded" && RESIDUAL_KEYS[each.id] && each.kind !== "move") expect(RESIDUAL_KEYS[each.id], name).toEqual(each.key);
    }
  });

  it("marks unreachable only what no catalog has", () => {
    for (const each of found) {
      if (CLASSES[`${each.kind}:${each.id}:${each.prefix}`] !== "unreachable") continue;
      const kind = each.kind === "ability" ? "abilities" : each.kind === "item" ? "items" : "moves";
      expect(inCatalogs(kind, each.id), `${each.kind}:${each.id}`).toBe(false);
    }
  });
});
