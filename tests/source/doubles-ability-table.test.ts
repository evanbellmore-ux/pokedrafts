import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadModule, withVerifiedSources } from "../../scripts/lib/battle-data/sources";
import { ROOT } from "../../scripts/lib/champions-data/sources.mjs";
import { ABILITY_TABLE, abilityEntry, type AbilityEntry, type AbilityFlag } from "../../app/lib/battle/ability-table";
import { ABILITY_ENDS, ABILITY_STARTS } from "../../app/lib/battle/doubles-abilities";
import { CANT_SUPPRESS, OWN_STATUS_CURES } from "../../app/lib/battle/hit-loop";
import { NO_TRACE_ABILITIES, NO_TRANSFORM_ABILITIES } from "../../app/lib/battle/imposter";
import type { BattleCatalog, BattleGame } from "../../app/lib/battle/types";

/**
 * app/lib/battle/ability-table.ts against pinned Showdown c23d2e94 (status2 SPEC2 §3.5, §4.2; ADDENDUM2 §4.2): per game, every
 * catalog ability's flags (with noreceiver) and Start, SwitchIn, End and Update handlers equal the verified source archive's
 * Dex (the mods gen9, champions, gen8, gen7), and no other ability is listed. The 2v2 ability changes (doubles-abilities.ts)
 * classify every Start and End the table has, and every Update handler is one the turn runs or one no move can give. A data
 * refresh that changes an ability fails here until scripts/.cache/calc-audit/status2/build/gen-ability-table.ts is rerun.
 */
type DexAbility = { exists?: boolean; flags?: Record<string, number>; [hook: string]: unknown };
type Dex = { abilities: { get(id: string): DexAbility; all(): (DexAbility & { id: string })[] } };

const GAMES: [BattleGame, string, string][] = [
  ["scarlet_violet", "data/battle/scarlet_violet/catalog.json", "gen9"],
  ["champions", "data/champions/catalog.json", "champions"],
  ["sword_shield", "data/battle/sword_shield/catalog.json", "gen8"],
  ["ultra_sun_ultra_moon", "data/battle/ultra_sun_ultra_moon/catalog.json", "gen7"],
];
const FLAGS: AbilityFlag[] = ["breakable", "cantsuppress", "failroleplay", "failskillswap", "noentrain", "noreceiver", "notrace", "notransform"];
const HOOKS: [string, keyof Omit<AbilityEntry, "flags">][] = [["onStart", "start"], ["onSwitchIn", "switchIn"], ["onEnd", "end"], ["onUpdate", "update"]];
const catalogs = Object.fromEntries(GAMES.map(([game, file]) => [game, JSON.parse(readFileSync(join(ROOT, file), "utf8")) as BattleCatalog])) as Record<BattleGame, BattleCatalog>;

/** Per game: the pinned entry of every catalog ability; and Scarlet/Violet's whole dex flags (imposter.ts's lists). */
const pinned = {} as Record<BattleGame, Record<string, AbilityEntry>>;
const allFlags: Record<string, Set<string>> = {};
beforeAll(async () => {
  await withVerifiedSources(async ({ runtime }) => {
    const { Dex } = loadModule(join(runtime, "sim/dex.js")) as { Dex: { mod(name: string): Dex } };
    for (const [game, , mod] of GAMES) {
      // Everything is read here: Dex loads its data lazily, and the compiled runtime is removed afterwards.
      const dex = Dex.mod(mod);
      pinned[game] = {};
      for (const { id } of catalogs[game].abilities) {
        const ability = dex.abilities.get(id);
        if (!ability?.exists) throw new Error(`${game} ${id}: not in the pinned dex`);
        const entry: AbilityEntry = { flags: Object.fromEntries(FLAGS.filter((flag) => ability.flags?.[flag]).map((flag) => [flag, true])) };
        for (const [hook, key] of HOOKS) if (typeof ability[hook] === "function") entry[key] = true;
        pinned[game][id] = entry;
      }
      if (game === "scarlet_violet") {
        for (const flag of FLAGS) allFlags[flag] = new Set(dex.abilities.all().filter((ability) => ability.exists && ability.flags?.[flag]).map((ability) => ability.id));
      }
    }
  });
}, 600_000);

const handlers = (game: BattleGame, key: keyof Omit<AbilityEntry, "flags">) => Object.keys(ABILITY_TABLE[game]).filter((id) => ABILITY_TABLE[game][id][key]);
const anyGame = (key: keyof Omit<AbilityEntry, "flags">) => [...new Set(GAMES.flatMap(([game]) => handlers(game, key)))].sort();

describe("the ability table (ability-table.ts)", () => {
  it("lists, per game, exactly the catalog abilities with a flag or a handler, with the pinned flags and handlers", () => {
    for (const [game] of GAMES) {
      const expected = Object.fromEntries(Object.entries(pinned[game]).filter(([, entry]) => Object.keys(entry).length > 1 || Object.keys(entry.flags).length));
      expect(Object.keys(ABILITY_TABLE[game]).sort(), game).toEqual(Object.keys(expected).sort());
      for (const id of Object.keys(pinned[game])) expect(abilityEntry(id, game), `${game} ${id}`).toEqual(pinned[game][id]);
    }
  });

  it("carries the per-game differences the turn reads (Gulp Missile's flags, the auras' breakable; Trace's noreceiver)", () => {
    expect(pinned.sword_shield.gulpmissile.flags.failskillswap).toBe(true);
    expect(pinned.scarlet_violet.gulpmissile.flags.failskillswap).toBeUndefined();
    expect(pinned.ultra_sun_ultra_moon.fairyaura.flags.breakable).toBe(true);
    expect(pinned.champions.fairyaura.flags.breakable).toBeUndefined();
    expect(pinned.scarlet_violet.trace.flags.noreceiver).toBe(true);
    expect(abilityEntry("trace", "scarlet_violet").flags.noreceiver).toBe(true);
  });

  it("matches the older lists made from the same flags (imposter.ts, hit-loop.ts)", () => {
    expect([...NO_TRACE_ABILITIES].sort()).toEqual([...allFlags.notrace].filter((id) => id !== "noability").sort());
    expect([...NO_TRANSFORM_ABILITIES].sort()).toEqual([...allFlags.notransform].sort());
    expect([...CANT_SUPPRESS].sort()).toEqual([...allFlags.cantsuppress].sort());
  });
});

describe("the 2v2 ability changes classify every handler the table has (doubles-abilities.ts)", () => {
  it("gives every Start a kind (acts, nothing or guard)", () => {
    expect(anyGame("start").filter((id) => !ABILITY_STARTS[id])).toEqual([]);
    expect(Object.keys(ABILITY_STARTS).filter((id) => !anyGame("start").includes(id))).toEqual([]);
  });
  it("gives every End a kind", () => {
    expect(anyGame("end").filter((id) => !ABILITY_ENDS[id])).toEqual([]);
    expect(Object.keys(ABILITY_ENDS).filter((id) => !anyGame("end").includes(id))).toEqual([]);
  });
  it("runs every Update handler of an ability a move can give mid-turn (updateCures), the rest no move gives", () => {
    // Commander, Disguise and Ice Face: failroleplay, failskillswap, noentrain (or cantsuppress) in every game, and a transformed
    // copy reads its base species (Commander) or is notransform; Trace's seeking is traceStart's guard.
    const covered = new Set([...Object.keys(OWN_STATUS_CURES), "owntempo", "oblivious", "commander", "disguise", "iceface", "trace"]);
    expect(anyGame("update").filter((id) => !covered.has(id))).toEqual([]);
    for (const id of ["commander", "disguise", "iceface"]) {
      for (const [game] of GAMES) {
        const entry = ABILITY_TABLE[game][id];
        if (!entry) continue;
        expect([game, id, !!entry.flags.failroleplay, !!entry.flags.failskillswap, !!entry.flags.noentrain || !!entry.flags.cantsuppress]).toEqual([game, id, true, true, true]);
      }
    }
  });
});
