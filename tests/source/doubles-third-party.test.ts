import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CACHE, ROOT, SHOWDOWN_SOURCE } from "../../scripts/lib/champions-data/sources.mjs";
import {
  GUARDED_THIRD_PARTY, HP_STATUS_MOVES, MODELLED_STATUS_MOVES, MODELLED_THIRD_PARTY, NO_EFFECT_MOVES, PROTECT_CONTACT, PROTECT_MOVES,
} from "../../app/lib/battle/doubles-actions";
import { doublesTargetRule } from "../../app/lib/battle/doubles-targets";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTargetRule, DoublesTurnInput } from "../../app/lib/battle/doubles-types";
import { createBuild, createConditions } from "../../app/lib/battle/model";
import { createBattleRuntime, type BattleRuntime } from "../../app/lib/battle/runtime";
import { statusEntry } from "../../app/lib/battle/status-table";
import type { BattleCatalog, BattleGame } from "../../app/lib/battle/types";

/**
 * The 2v2 engine's tables against pinned Showdown c23d2e94 (SPEC §8.4), read from the compiled dex the data build makes
 * (node_modules/.cache/champions/showdown-dex-<revision>: data/*.js and data/mods/champions/*.js, `npm run data:champions`).
 * A data refresh that adds a handler acting on Pokémon other than its holder and that holder's target fails here until the
 * engine models or guards it.
 */
const DEX = join(CACHE, `showdown-dex-${SHOWDOWN_SOURCE.revision}`);
const load = createRequire(import.meta.url);
type Entry = Record<string, unknown> & { name?: string };
type Table = Record<string, Entry>;
function table(file: string, key: string): Table {
  const path = join(DEX, file);
  if (!existsSync(path)) throw new Error(`The pinned Showdown dex is missing (${path}); run npm run data:champions.`);
  return load(path)[key] as Table;
}
const base = { abilities: table("data/abilities.js", "Abilities"), items: table("data/items.js", "Items"), moves: table("data/moves.js", "Moves") };
const champions = { abilities: table("data/mods/champions/abilities.js", "Abilities"), items: table("data/mods/champions/items.js", "Items"), moves: table("data/mods/champions/moves.js", "Moves") };
/** The entry as a game sees it: the Champions mod's fields over the base data (inherit: true). */
function entry(kind: keyof typeof base, id: string, game: string): Entry | undefined {
  const mod = game === "champions" ? champions[kind][id] : undefined;
  return mod ? (mod.inherit ? { ...base[kind][id], ...mod } : mod) : base[kind][id];
}

const CATALOGS: Record<string, string> = {
  champions: "data/champions/catalog.json", scarlet_violet: "data/battle/scarlet_violet/catalog.json",
  sword_shield: "data/battle/sword_shield/catalog.json", ultra_sun_ultra_moon: "data/battle/ultra_sun_ultra_moon/catalog.json",
};
const catalogs = Object.fromEntries(Object.entries(CATALOGS).map(([game, file]) => [game, JSON.parse(readFileSync(join(ROOT, file), "utf8")) as BattleCatalog]));

/** onAlly*, onFoe*, onAny* and onSource* handlers (not their Priority/Order/SubOrder numbers). */
const THIRD_PARTY_HOOK = /^on(Ally|Foe|Any|Source)[A-Z]/;
/** A handler that reaches other Pokémon on the field. */
const REACHES_OTHERS = /\.(allies|foes|adjacentFoes|adjacentAllies|alliesAndSelf)\(|getAllActive\(/;
function thirdParty(value: Entry): string[] {
  const hooks = Object.keys(value).filter((key) => THIRD_PARTY_HOOK.test(key) && !/(Priority|Order|SubOrder)$/.test(key));
  const reaches = Object.entries(value).filter(([key, fn]) => key.startsWith("on") && typeof fn === "function" && REACHES_OTHERS.test(String(fn))).map(([key]) => key);
  const condition = value.condition as Entry | undefined;
  const nested = condition ? Object.keys(condition).filter((key) => THIRD_PARTY_HOOK.test(key) && !/(Priority|Order|SubOrder)$/.test(key)).map((key) => `condition.${key}`) : [];
  return [...new Set([...hooks, ...reaches, ...nested])];
}

describe("third-party handlers (SPEC §8.4)", () => {
  it("lists every ability of a supported species and every catalog item that acts on other Pokémon as modelled or guarded", () => {
    const missing = new Map<string, { games: string[]; hooks: Set<string> }>();
    const note = (key: string, game: string, hooks: string[]) => {
      const found = missing.get(key) ?? { games: [], hooks: new Set<string>() };
      found.games.push(game);
      for (const hook of hooks) found.hooks.add(hook);
      missing.set(key, found);
    };
    for (const [game, catalog] of Object.entries(catalogs)) {
      const abilities = new Set(catalog.species.filter((s) => !s.unsupported.length).flatMap((s) => s.abilities));
      for (const id of abilities) {
        const value = entry("abilities", id, game);
        if (!value) continue;
        const hooks = thirdParty(value);
        if (hooks.length && !MODELLED_THIRD_PARTY.has(id) && !GUARDED_THIRD_PARTY.has(id)) note(`ability ${id}`, game, hooks);
      }
      for (const item of catalog.items) {
        const value = entry("items", item.id, game);
        if (!value) continue;
        const hooks = thirdParty(value);
        if (hooks.length && !MODELLED_THIRD_PARTY.has(item.id) && !GUARDED_THIRD_PARTY.has(item.id)) note(`item ${item.id}`, game, hooks);
      }
    }
    // One line per ability or item: its games and the handlers that reach other Pokémon.
    const lines = [...missing].map(([key, found]) => `${key} [${found.games.join(", ")}]: ${[...found.hooks].join(", ")}`).sort();
    expect(lines.join("\n")).toBe("");
  });

  it("keeps the modelled and the guarded lists apart", () => {
    expect([...MODELLED_THIRD_PARTY].filter((id) => GUARDED_THIRD_PARTY.has(id))).toEqual([]);
  });

  it("models the status pipeline's and the end of turn's third parties (status-eot SPEC §9)", () => {
    for (const id of ["sweetveil", "magicbounce", "goodasgold", "oblivious", "owntempo", "synchronize", "earlybird", "healer", "hydration", "shedskin", "baddreams", "bigroot"]) {
      expect(MODELLED_THIRD_PARTY.has(id), id).toBe(true);
    }
    // Flower Veil and Pastel Veil are modelled against status moves (doubles-status.ts canStatus, applyBoosts) and stay
    // guarded against a damaging move's added effect (doubles-turn.ts veilGuard); Pickup acts at the end of turn (E2).
    for (const id of ["flowerveil", "pastelveil", "pickup"]) expect(GUARDED_THIRD_PARTY.has(id), id).toBe(true);
  });
});

describe("move tables against pinned data", () => {
  const move = (id: string) => entry("moves", id, "scarlet_violet") as (Entry & { category?: string; target?: string; flags?: Record<string, number>; heal?: unknown; selfdestruct?: unknown; stallingMove?: boolean; volatileStatus?: string; condition?: Entry }) | undefined;

  it("models only status moves, and every protecting move is a stalling move with its own volatile", () => {
    for (const id of MODELLED_STATUS_MOVES) expect(move(id)?.category, id).toBe("Status");
    for (const [id, kind] of Object.entries(PROTECT_MOVES)) {
      const data = move(id)!;
      expect(data.stallingMove, id).toBe(true);
      expect(data.volatileStatus, id).toBe(kind);
      expect(data.target, id).toBe("self");
    }
  });

  it("gives each protecting move its contact effect (its condition's onTryHit)", () => {
    // Detect uses Protect's volatile, so each kind's condition is on the move of that name.
    const source = (kind: string) => String((move(kind)!.condition as Entry).onTryHit ?? "");
    for (const [id, kind] of Object.entries(PROTECT_MOVES)) {
      const effect = PROTECT_CONTACT[kind];
      const text = source(kind);
      if (!effect) { expect(text, id).not.toMatch(/boost\(|damage\(|trySetStatus\(/); continue; }
      for (const [stat, stages] of Object.entries(effect.stages ?? {})) expect(text.replace(/\s+/g, ""), id).toContain(`${stat}:${stages}`);
      if (effect.damage) expect(text.replace(/\s+/g, ""), id).toContain(`baseMaxhp/${effect.damage}`);
      if (effect.status) expect(text, id).toMatch(new RegExp(`trySetStatus\\(["']${effect.status}["']`));
    }
  });

  it("models or guards every status move that changes HP", () => {
    const changesHP = (data: NonNullable<ReturnType<typeof move>>) => !!data.heal || !!data.flags?.heal || !!data.selfdestruct
      || Object.entries(data).some(([key, fn]) => /^on(Hit|TryHit|HitField|HitSide|AfterHit|PrepareHit)$/.test(key) && typeof fn === "function" && /\.heal\(|\.sethp\(|directDamage\(|this\.damage\(|\.faint\(|\.eatItem\(/.test(String(fn)));
    // status-eot SPEC §2.2: such a move is modelled (kind M, C or S, status-table.ts) or guarded wherever it is (HP_STATUS_MOVES).
    const unfollowed: string[] = [];
    for (const [game, catalog] of Object.entries(catalogs)) {
      for (const m of catalog.moves) {
        const data = move(m.id);
        if (data?.category !== "Status" || !changesHP(data)) continue;
        const kind = statusEntry(m.id, game as BattleGame)?.kind;
        if (kind !== "M" && kind !== "C" && kind !== "S" && !HP_STATUS_MOVES.has(m.id)) unfollowed.push(`${game} ${m.id} (${kind})`);
      }
    }
    expect(unfollowed, "neither modelled nor guarded").toEqual([]);
    for (const id of HP_STATUS_MOVES) {
      expect(move(id)?.category, id).toBe("Status");
      expect(MODELLED_STATUS_MOVES.has(id), id).toBe(false);
    }
  });

  it("keeps the no-effect moves (kind N) free of anything this turn's later moves can see", () => {
    // Their volatiles act on a later turn (Grudge and Laser Focus on the user's next move, Torment on the next choice), their
    // side conditions on a switch-in (the hazards).
    const LATER_VOLATILES = new Set(["grudge", "laserfocus", "torment"]);
    const HAZARDS = new Set(["spikes", "stealthrock", "stickyweb", "toxicspikes"]);
    for (const id of NO_EFFECT_MOVES) {
      const data = move(id)! as NonNullable<ReturnType<typeof move>> & { sideCondition?: string };
      expect(data.category, id).toBe("Status");
      expect(!!data.heal || !!data.flags?.heal || !!data.selfdestruct || !!data.boosts || !!data.status, id).toBe(false);
      if (data.volatileStatus) expect(LATER_VOLATILES.has(data.volatileStatus), `${id}: ${data.volatileStatus}`).toBe(true);
      if (data.sideCondition) expect(HAZARDS.has(data.sideCondition), `${id}: ${data.sideCondition}`).toBe(true);
      expect(HP_STATUS_MOVES.has(id) || MODELLED_STATUS_MOVES.has(id), id).toBe(false);
    }
  });
});

describe("the target map (doubles-targets.ts) against pinned move targets", () => {
  const expected = (target: string, slot: DoublesSlotId): DoublesTargetRule => {
    const left: DoublesSlotId = slot.startsWith("own") ? "opponent-left" : "own-left";
    const right: DoublesSlotId = slot.startsWith("own") ? "opponent-right" : "own-right";
    const ally: DoublesSlotId = ({ "own-left": "own-right", "own-right": "own-left", "opponent-left": "opponent-right", "opponent-right": "opponent-left" } as const)[slot];
    switch (target) {
      case "normal": case "any": return { kind: "choose", options: [left, right, ally] };
      case "adjacentFoe": return { kind: "choose", options: [left, right] };
      case "adjacentAllyOrSelf": return { kind: "choose", options: [ally, slot] };
      case "adjacentAlly": return { kind: "auto", hits: [ally] };
      case "allAdjacentFoes": return { kind: "auto", hits: [left, right] };
      case "allAdjacent": return { kind: "auto", hits: [left, right, ally] };
      case "randomNormal": return { kind: "auto", hits: [left, right], random: true };
      case "self": return { kind: "none", scope: "self" };
      case "allies": return { kind: "none", scope: "self-and-ally" };
      case "allySide": return { kind: "none", scope: "own-side" };
      case "foeSide": return { kind: "none", scope: "foe-side" };
      case "all": return { kind: "none", scope: "field" };
      case "allyTeam": return { kind: "none", scope: "own-team" };
      case "scripted": return { kind: "none", scope: "last-attacker" };
      default: throw new Error(`unmapped Showdown target ${target}`);
    }
  };

  it("maps every catalog move's pinned target from each slot", () => {
    for (const [game, catalog] of Object.entries(catalogs)) {
      const runtime: BattleRuntime = createBattleRuntime(catalog, "0".repeat(64));
      const species = catalog.species.find((s) => !s.unsupported.length)!.id;
      const pokemon = Object.fromEntries((["own-left", "own-right", "opponent-left", "opponent-right"] as const).map((slot) => {
        const value: DoublesPokemonInput = { build: createBuild(species, runtime), contexts: {}, charged: false, action: { moveId: null, target: null } };
        return [slot, value];
      })) as Record<DoublesSlotId, DoublesPokemonInput>;
      const input: DoublesTurnInput = { runtime, field: { ...createConditions(), gameType: "Doubles" }, pokemon };
      for (const m of catalog.moves) {
        if (m.isZ || m.isMax) continue;
        // Generation 9 targets are the compiled dex's own (it holds no generation 7 or 8 mod).
        if (game === "champions" || game === "scarlet_violet") {
          const pinned = (entry("moves", m.id, game) as { target?: string } | undefined)?.target;
          expect(m.target, `${game} ${m.id}: the catalog's target is the pinned one`).toBe(pinned);
        }
        // Curse from a user that is not a Ghost type asks for its nonGhostTarget, self (pinned sim/pokemon.ts getMoves).
        const ghost = runtime.speciesById.get(species)?.types.includes("Ghost");
        const target = m.id === "curse" && !ghost ? "self" : m.target;
        for (const slot of ["own-left", "opponent-right"] as const) expect(doublesTargetRule(input, slot, m.id), `${game} ${m.id} from ${slot}`).toEqual(expected(target, slot));
      }
    }
  });
});
