import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadModule, withVerifiedSources } from "../../scripts/lib/battle-data/sources";
import { CACHE, ROOT, SHOWDOWN_SOURCE } from "../../scripts/lib/champions-data/sources.mjs";
import { GMAX_EFFECTS, HP_STATUS_MOVES, MODELLED_STATUS_MOVES, NO_EFFECT_MOVES } from "../../app/lib/battle/doubles-actions";
import { ACCURACY_DROPS, accuracyDrop } from "../../app/lib/battle/stat-moves";
import {
  CANTUSETWICE_MOVES, DEFROST_MOVES, FAILENCORE_MOVES, STATUS_MOVE_TABLE, statusEntry, THAWING_MOVES, type StatusEntry, type StatusKind,
} from "../../app/lib/battle/status-table";
import type { BattleCatalog, BattleGame } from "../../app/lib/battle/types";

/**
 * app/lib/battle/status-table.ts against pinned Showdown c23d2e94 (status-eot SPEC §2.2, §9): every catalog Status move has
 * one entry with the build's kind, and its dex fields equal each game's pinned data. Scarlet/Violet and Champions are read
 * from the compiled dex the data build makes (node_modules/.cache/champions/showdown-dex-<revision>, `npm run
 * data:champions`; the Champions mod's fields over the base data), Sword/Shield and Ultra Sun/Ultra Moon from the verified
 * source archive's Dex (data/mods/gen8, data/mods/gen7). A data refresh that changes a status move fails here until the
 * table is regenerated (scripts/.cache/calc-audit/status-eot/build/track-a-gen-status-table.ts) and the pipeline follows.
 */
type DexMove = Record<string, unknown> & {
  name?: string; exists?: boolean; category?: string; target?: string; priority?: number; type?: string; flags?: Record<string, number>; ignoreImmunity?: unknown;
  boosts?: Record<string, number>; self?: { boosts?: Record<string, number>; volatileStatus?: string }; status?: string; volatileStatus?: string;
  sideCondition?: string; slotCondition?: string; heal?: number[]; selfdestruct?: string | boolean; condition?: Record<string, unknown>; thawsTarget?: boolean;
  inherit?: boolean;
};
type Condition = Record<string, unknown>;
type GameFacts = { moves: Record<string, DexMove>; conditions: Record<string, Condition> };

const GAMES: BattleGame[] = ["scarlet_violet", "champions", "sword_shield", "ultra_sun_ultra_moon"];
const CATALOGS: Record<BattleGame, string> = {
  champions: "data/champions/catalog.json", scarlet_violet: "data/battle/scarlet_violet/catalog.json",
  sword_shield: "data/battle/sword_shield/catalog.json", ultra_sun_ultra_moon: "data/battle/ultra_sun_ultra_moon/catalog.json",
};
const catalogs = Object.fromEntries(GAMES.map((game) => [game, JSON.parse(readFileSync(join(ROOT, CATALOGS[game]), "utf8")) as BattleCatalog])) as Record<BattleGame, BattleCatalog>;
/** The catalog's Status moves (Extreme Evoboost and Max Guard included: today's handling, X). */
const statusMoves = (game: BattleGame) => catalogs[game].moves.filter((move) => move.category === "Status").map((move) => move.id);

// Scarlet/Violet and Champions: the compiled dex (third-party test's reader).
const DEX = join(CACHE, `showdown-dex-${SHOWDOWN_SOURCE.revision}`);
const load = createRequire(import.meta.url);
function table(file: string, key: string): Record<string, DexMove> {
  const path = join(DEX, file);
  if (!existsSync(path)) throw new Error(`The pinned Showdown dex is missing (${path}); run npm run data:champions.`);
  return load(path)[key] as Record<string, DexMove>;
}
function generation9(game: "scarlet_violet" | "champions"): GameFacts {
  const base = table("data/moves.js", "Moves");
  const mod = game === "champions" ? table("data/mods/champions/moves.js", "Moves") : {};
  const moves = Object.fromEntries(Object.keys(base).map((id) => {
    const own = mod[id];
    if (!own) return [id, base[id]];
    if (!own.inherit) return [id, own];
    // sim/dex.ts loadData: inherit: true takes the parent's fields, and a condition with inherit: true the parent condition's.
    const condition = (own.condition as Condition | undefined)?.inherit ? { ...(base[id].condition ?? {}), ...own.condition } : own.condition ?? base[id].condition;
    return [id, { ...base[id], ...own, ...(condition ? { condition } : {}) }];
  }));
  const conditions = table("data/conditions.js", "Conditions") as Record<string, Condition>;
  return { moves, conditions };
}

const facts = {} as Record<BattleGame, GameFacts>;
beforeAll(async () => {
  facts.scarlet_violet = generation9("scarlet_violet");
  facts.champions = generation9("champions");
  await withVerifiedSources(async ({ runtime }) => {
    type Dex = { moves: { get(id: string): DexMove }; conditions: { get(id: string): Condition } };
    const { Dex } = loadModule(join(runtime, "sim/dex.js")) as { Dex: { mod(name: string): Dex } };
    for (const [game, mod] of [["sword_shield", "gen8"], ["ultra_sun_ultra_moon", "gen7"]] as const) {
      // Everything is read here: Dex loads its data lazily, and the compiled runtime is removed afterwards.
      const dex = Dex.mod(mod);
      const moves: Record<string, DexMove> = {};
      // The catalog's moves and the BeforeMove conditions the test reads.
      for (const id of [...catalogs[game].moves.map((row) => row.id), "disable", "gravity", "throatchop", "taunt", "imprison", "destinybond"]) {
        const move = dex.moves.get(id);
        if (!move?.exists) continue;
        moves[id] = { ...move, flags: { ...move.flags }, ...(move.condition ? { condition: { ...move.condition } } : {}) };
      }
      const conditions = Object.fromEntries(["slp", "frz", "flinch", "confusion", "par"].map((id) => [id, { ...dex.conditions.get(id) }]));
      facts[game] = { moves, conditions };
    }
  });
}, 600_000);

/** The build's kinds (scripts/.cache/calc-audit/status-eot/design/spec-classify.md with ADDENDUM §2.2: Ally Switch, Trick and Switcheroo are M). */
const KINDS: Record<StatusKind, string> = {
  M: `acidarmor afteryou agility allyswitch amnesia aquaring aromaticmist babydolleyes barrier bellydrum bulkup calmmind charge charm clangoroussoul
    coaching coil confide confuseray cosmicpower cottonguard cottonspore curse darkvoid decorate defendorder defensecurl destinybond doubleteam dragoncheer
    dragondance eerieimpulse endure faketears featherdance filletaway flash flatter floralhealing focusenergy glare grasswhistle growl growth harden haze
    healingwish healorder healpulse honeclaws howl hypnosis irondefense junglehealing kinesis leechseed leer lifedew lovelykiss lunarblessing lunardance
    meditate memento metalsound milkdrink moonlight morningsun nastyplot nobleroar painsplit perishsong playnice poisongas poisonpowder quash quiverdance
    recover refresh rest rockpolish safeguard sandattack scaryface screech sharpen shellsmash shelter shiftgear shoreup sing slackoff sleeppowder smokescreen
    softboiled spicyextract spore strengthsap stringshot stunspore substitute supersonic swagger sweetkiss sweetscent switcheroo swordsdance synthesis
    tailglow tailwhip takeheart taunt tearfullook teeterdance thunderwave tickle toxic toxicthread trick venomdrench victorydance willowisp wish withdraw
    workup yawn`,
  N: "block celebrate fairylock grudge happyhour holdhands laserfocus lockon meanlook mimic mindreader sketch spiderweb spikes spite splash stealthrock stickyweb torment toxicspikes",
  C: "disable encore imprison ingrain magnetrise roost",
  L: `acupressure aromatherapy attract autotomize bestow camouflage captivate conversion conversion2 corrosivegas courtchange craftyshield defog doodle
    electrify embargo entrainment flowershield foresight forestscurse gastroacid gearup geomancy guardsplit guardswap healbell healblock heartswap iondeluge
    luckychant magiccoat magicpowder magicroom magneticflux matblock minimize miracleeye mist mudsport nightmare noretreat octolock odorsleuth powder
    powershift powersplit powerswap powertrick psychoshift psychup purify recycle reflecttype roleplay rototiller simplebeam skillswap snatch soak speedswap
    stockpile stuffcheeks swallow tarshot teatime telekinesis tidyup topsyturvy transform trickortreat watersport wonderroom worryseed`,
  S: "batonpass chillyreception partingshot roar shedtail teleport whirlwind",
  P: "revivalblessing",
  X: `assist auroraveil banefulbunker burningbulwark copycat detect electricterrain extremeevoboost followme grassyterrain gravity hail helpinghand instruct
    kingsshield lightscreen maxguard mefirst metronome mirrormove mistyterrain naturepower obstruct protect psychicterrain quickguard ragepowder raindance
    reflect sandstorm silktrap sleeptalk snowscape spikyshield spotlight sunnyday tailwind trickroom wideguard`,
};
const kindOf = new Map(Object.entries(KINDS).flatMap(([kind, ids]) => ids.split(/\s+/).filter(Boolean).map((id) => [id, kind as StatusKind])));

/** The table's dex fields of a pinned move (track-a-gen-status-table.ts entryOf). */
const FLAGS = ["protect", "reflectable", "powder", "sound", "bypasssub", "heal", "wind", "gravity"];
function dexFields(move: DexMove): Record<string, unknown> {
  return {
    target: move.target, priority: move.priority, type: move.type,
    flags: Object.fromEntries(FLAGS.filter((flag) => move.flags?.[flag]).map((flag) => [flag, true])),
    ...(move.ignoreImmunity === false ? { ignoreImmunity: false } : {}),
    ...(move.boosts ? { boosts: move.boosts } : {}),
    ...(move.self?.boosts ? { selfBoosts: move.self.boosts } : {}),
    ...(move.self?.volatileStatus ? { selfVolatile: move.self.volatileStatus } : {}),
    ...(move.status ? { status: move.status } : {}), ...(move.volatileStatus ? { volatile: move.volatileStatus } : {}),
    ...(move.sideCondition ? { side: move.sideCondition } : {}), ...(move.slotCondition ? { slot: move.slotCondition } : {}),
    ...(move.heal ? { heal: move.heal } : {}), ...(move.selfdestruct ? { selfdestruct: move.selfdestruct } : {}),
  };
}
function tableFields(entry: StatusEntry): Record<string, unknown> {
  const { kind, games, handler, fails, ...rest } = entry;
  void kind; void games; void handler; void fails;
  return rest;
}

describe("the status-move table (status-table.ts)", () => {
  it("has one entry for every catalog Status move and none for another move", () => {
    const all = new Set(GAMES.flatMap(statusMoves));
    expect(Object.keys(STATUS_MOVE_TABLE).sort()).toEqual([...all].sort());
    for (const game of GAMES) {
      const own = new Set(statusMoves(game));
      for (const id of Object.keys(STATUS_MOVE_TABLE)) expect(!!statusEntry(id, game), `${game} ${id}`).toBe(own.has(id));
    }
  });

  it("gives each the build's kind: 125 M, 20 N, 6 C, 73 L, 7 S, 1 P, 39 X", () => {
    const counts: Record<string, number> = {};
    for (const [id, entry] of Object.entries(STATUS_MOVE_TABLE)) {
      expect(entry.kind, id).toBe(kindOf.get(id));
      counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
      // A move keeps its kind in every game (the overrides carry dex fields only).
      for (const game of GAMES) if (statusEntry(id, game)) expect(statusEntry(id, game)!.kind, `${game} ${id}`).toBe(entry.kind);
    }
    expect(counts).toEqual({ M: 125, N: 20, C: 6, L: 73, S: 7, P: 1, X: 39 });
    expect(kindOf.size).toBe(271);
  });

  for (const game of GAMES) {
    it(`equals the pinned dex fields in ${game}`, () => {
      const mismatches: string[] = [];
      for (const id of statusMoves(game)) {
        const pinned = facts[game].moves[id];
        expect(pinned, `${game} ${id} in the pinned dex`).toBeDefined();
        const expected = dexFields(pinned), got = tableFields(statusEntry(id, game)!);
        if (JSON.stringify(sortKeys(expected)) !== JSON.stringify(sortKeys(got))) mismatches.push(`${id}: pinned ${JSON.stringify(expected)}, table ${JSON.stringify(got)}`);
      }
      expect(mismatches.join("\n")).toBe("");
    });
  }

  it("lists the failencore, defrost, cantusetwice and thawsTarget moves of the four catalogs", () => {
    const flagged = { failencore: new Set<string>(), defrost: new Set<string>(), cantusetwice: new Set<string>(), thaws: new Set<string>() };
    for (const game of GAMES) {
      for (const row of catalogs[game].moves) {
        const move = facts[game].moves[row.id];
        if (!move) continue;
        if (move.flags?.failencore) flagged.failencore.add(row.id);
        if (move.flags?.defrost) flagged.defrost.add(row.id);
        if (move.flags?.cantusetwice) flagged.cantusetwice.add(row.id);
        if (move.thawsTarget) flagged.thaws.add(row.id);
      }
    }
    expect([...FAILENCORE_MOVES].sort()).toEqual([...flagged.failencore].sort());
    expect([...DEFROST_MOVES].sort()).toEqual([...flagged.defrost].sort());
    expect([...CANTUSETWICE_MOVES].sort()).toEqual([...flagged.cantusetwice].sort());
    expect([...THAWING_MOVES].sort()).toEqual([...flagged.thaws].sort());
  });

  it("gives every M or C move with its own onHit, onTry, onTryHit, onHitField or condition a handler", () => {
    // Handled without a key: Defense Curl's volatile only doubles Rollout and Ice Ball, a later turn's; Toxic's condition
    // only makes a Poison type's use hit a semi-invulnerable target (every move hits; a semi-invulnerable Pokémon is a guard).
    const GENERIC = new Set(["defensecurl", "toxic"]);
    const missing: string[] = [];
    for (const game of GAMES) {
      for (const id of statusMoves(game)) {
        const entry = statusEntry(id, game)!;
        if (entry.kind !== "M" && entry.kind !== "C") continue;
        const move = facts[game].moves[id];
        const hooks = ["onHit", "onTry", "onTryHit", "onHitField", "onHitSide"].filter((hook) => typeof move[hook] === "function");
        if (move.condition) hooks.push("condition");
        if (hooks.length && !entry.handler && !GENERIC.has(id)) missing.push(`${game} ${id}: ${hooks.join(", ")}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("derives the engine's sets from the kinds", () => {
    for (const [id, entry] of Object.entries(STATUS_MOVE_TABLE)) {
      if (entry.kind === "M" || entry.kind === "C") expect(MODELLED_STATUS_MOVES.has(id), id).toBe(true);
      expect(NO_EFFECT_MOVES.has(id), id).toBe(entry.kind === "N");
      if (entry.kind === "P") expect(HP_STATUS_MOVES.has(id), id).toBe(true);
    }
  });
});

describe("BeforeMove's handler priorities (status-eot SPEC §4.2)", () => {
  for (const game of GAMES) {
    it(`are the pinned onBeforeMovePriority values in ${game}`, () => {
      const { conditions, moves } = facts[game];
      const condition = (id: string) => moves[id]?.condition as Condition | undefined;
      expect(conditions.slp.onBeforeMovePriority).toBe(10);
      expect(conditions.frz.onBeforeMovePriority).toBe(10);
      expect(conditions.flinch.onBeforeMovePriority).toBe(8);
      expect(conditions.confusion.onBeforeMovePriority).toBe(3);
      expect(conditions.par.onBeforeMovePriority).toBe(1);
      expect(condition("disable")?.onBeforeMovePriority).toBe(7);
      expect(condition("gravity")?.onBeforeMovePriority).toBe(6);
      expect(condition("throatchop")?.onBeforeMovePriority).toBe(6);
      expect(condition("taunt")?.onBeforeMovePriority).toBe(5);
      expect(condition("imprison")?.onFoeBeforeMovePriority).toBe(4);
      expect(condition("destinybond")?.onBeforeMovePriority).toBe(-1);
    });
  }
});

describe("the damaging moves' accuracy drops (stat-moves.ts ACCURACY_DROPS; status-eot review H8)", () => {
  type Secondary = { chance?: number; boosts?: Record<string, number> };
  for (const game of GAMES) {
    it(`lists every ${game} damaging move whose secondary lowers its target's accuracy, by its chance`, () => {
      const ids = catalogs[game].moves.filter((move) => move.category !== "Status").map((move) => move.id);
      const found = Object.fromEntries(ids.flatMap((id) => {
        const move = facts[game].moves[id] as (DexMove & { secondary?: Secondary | null; secondaries?: Secondary[] | null }) | undefined;
        const secondaries = move?.secondaries ?? (move?.secondary ? [move.secondary] : []);
        const drop = secondaries.find((each) => each.boosts?.accuracy);
        if (!drop) return [];
        expect(drop.boosts, id).toEqual({ accuracy: -1 });
        return [[id, drop.chance ?? 100]];
      }));
      expect(found).toEqual(Object.fromEntries(Object.entries(ACCURACY_DROPS).filter(([id]) => ids.includes(id))));
      // Certain: Mud-Slap's 100%, and with Serene Grace (its chance doubled) the 50% ones.
      expect(ids.filter((id) => accuracyDrop(id)).sort()).toEqual(Object.keys(found).filter((id) => found[id] >= 100).sort());
      expect(ids.filter((id) => accuracyDrop(id, true)).sort()).toEqual(Object.keys(found).filter((id) => found[id] >= 50).sort());
    });
  }
  it("has G-Max Tartness lower each foe's evasion (doubles-actions.ts GMAX_EFFECTS)", () => {
    const tartness = facts.sword_shield.moves.gmaxtartness as DexMove & { self?: { onHit?: unknown } };
    expect(String(tartness.self?.onHit)).toMatch(/for \(const pokemon of source\.foes\(\)\)[\s\S]*this\.boost\(\{ evasion: -1 \}, pokemon\)/);
    expect(GMAX_EFFECTS["G-Max Tartness"]).toEqual({ foeStages: { evasion: -1 } });
  });
});

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]));
  return value;
}
