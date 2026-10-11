// Track A: writes app/lib/battle/status-table.ts from the pinned dex dump (track-a-dex-dump.ts) and the build's
// classification (design/spec-classify.md, with ADDENDUM §2.2: allyswitch, trick and switcheroo are M).
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/track-a-dex-dump.ts --flags <flags.json> > <dump.json>
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/track-a-gen-status-table.ts <dump.json> <flags.json> > app/lib/battle/status-table.ts
import fs from "node:fs";

type Game = "scarlet_violet" | "champions" | "sword_shield" | "ultra_sun_ultra_moon";
const ORDER: Game[] = ["scarlet_violet", "champions", "sword_shield", "ultra_sun_ultra_moon"];
const dump = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as Record<string, Partial<Record<Game, any>>>;

// ---- Kinds: design/spec-classify.md, then ADDENDUM §2.2 ----
const kinds: Record<string, string> = {};
for (const line of fs.readFileSync("scripts/.cache/calc-audit/status-eot/design/spec-classify.md", "utf8").split(/\r?\n/)) {
  const cells = line.split("|").map((cell) => cell.trim());
  if (cells.length > 5 && /^[a-z0-9]+$/.test(cells[1]) && /^[MNCLSPX]$/.test(cells[4])) kinds[cells[1]] = cells[4];
}
for (const id of ["allyswitch", "trick", "switcheroo"]) kinds[id] = "M";

// ---- Handler keys (the onHit / onTry / onTryHit / condition the pipeline dispatches) and onTry failure keys ----
const HANDLERS: Record<string, string> = {
  yawn: "yawn", venomdrench: "venomDrench", growth: "growth", takeheart: "takeHeart", dragoncheer: "dragonCheer", charge: "charge",
  focusenergy: "focusEnergy", haze: "haze", afteryou: "afterYou", quash: "quash", endure: "endure", destinybond: "destinyBond",
  safeguard: "safeguard", taunt: "taunt", leechseed: "leechSeed", aquaring: "aquaRing", ingrain: "ingrain", magnetrise: "magnetRise",
  roost: "roost", perishsong: "perishSong", moonlight: "weatherHeal", morningsun: "weatherHeal", synthesis: "weatherHeal",
  shoreup: "shoreUp", healpulse: "healPulse", floralhealing: "floralHealing", junglehealing: "jungleHealing", lunarblessing: "jungleHealing",
  strengthsap: "strengthSap", painsplit: "painSplit", rest: "rest", wish: "wish", bellydrum: "bellyDrum", filletaway: "filletAway",
  clangoroussoul: "clangorousSoul", curse: "curse", substitute: "substitute", healingwish: "healingWish", lunardance: "healingWish",
  refresh: "refresh", disable: "disable", encore: "encore", imprison: "imprison", darkvoid: "darkVoid",
  allyswitch: "allySwitch", trick: "swapItems", switcheroo: "swapItems",
};
const FAILS: Record<string, string> = {
  darkvoid: "darkrai", rest: "rest", bellydrum: "bellyDrum", filletaway: "halfHP", clangoroussoul: "clangorousSoul", substitute: "substitute",
  healingwish: "canSwitch", lunardance: "canSwitch", focusenergy: "critVolatile", dragoncheer: "critVolatile", afteryou: "queued", quash: "queued",
  magnetrise: "magnetRise", destinybond: "destinyBond", endure: "stall", curse: "cursed", yawn: "yawn", disable: "lastMove", encore: "lastMove",
  allyswitch: "allySwitch",
};
const FLAGS = ["protect", "reflectable", "powder", "sound", "bypasssub", "heal", "wind", "gravity"];

function entryOf(m: any): Record<string, unknown> {
  const flags = Object.fromEntries(FLAGS.filter((flag) => m.flags[flag]).map((flag) => [flag, true]));
  return {
    target: m.target, priority: m.priority, type: m.type, flags,
    ...(m.ignoreImmunity === false ? { ignoreImmunity: false } : {}),
    ...(m.boosts ? { boosts: m.boosts } : {}),
    ...(m.self?.boosts ? { selfBoosts: m.self.boosts } : {}),
    ...(m.self?.volatileStatus ? { selfVolatile: m.self.volatileStatus } : {}),
    ...(m.status ? { status: m.status } : {}), ...(m.volatileStatus ? { volatile: m.volatileStatus } : {}),
    ...(m.sideCondition ? { side: m.sideCondition } : {}), ...(m.slotCondition ? { slot: m.slotCondition } : {}),
    ...(m.heal ? { heal: m.heal } : {}), ...(m.selfdestruct ? { selfdestruct: m.selfdestruct } : {}),
  };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const lines: string[] = [];
const counts: Record<string, number> = {};
for (const id of Object.keys(dump).sort()) {
  const games = ORDER.filter((game) => dump[id][game]);
  const kind = kinds[id];
  if (!kind) throw new Error(`no kind for ${id}`);
  counts[kind] = (counts[kind] ?? 0) + 1;
  const base = entryOf(dump[id][games[0]]);
  const overrides: Record<string, Record<string, unknown>> = {};
  for (const game of games.slice(1)) {
    const other = entryOf(dump[id][game]);
    const diff: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(other)])) if (!same(base[key], other[key])) diff[key] = other[key] ?? null;
    if (Object.keys(diff).length) overrides[game] = diff;
  }
  const entry = {
    kind, ...base, ...(HANDLERS[id] && (kind === "M" || kind === "C") ? { handler: HANDLERS[id] } : {}),
    ...(FAILS[id] && (kind === "M" || kind === "C") ? { fails: FAILS[id] } : {}),
    games: Object.fromEntries(games.map((game) => [game, overrides[game] ?? {}])),
  };
  lines.push(`  ${id}: ${JSON.stringify(entry).replace(/"([a-zA-Z_]+)":/g, "$1:")},`);
}

// ---- Every catalog move with failencore, defrost, cantusetwice or thawsTarget (track-a-dex-dump.ts --flags) ----
const flagged = JSON.parse(fs.readFileSync(process.argv[3], "utf8")) as Record<string, Record<Game | "all", string[]>>;

console.log(`// Generated by scripts/.cache/calc-audit/status-eot/build/track-a-gen-status-table.ts from pinned Showdown c23d2e94
// (data/moves.ts with the mods applied: gen 9 for Scarlet/Violet, data/mods/champions, data/mods/gen8, data/mods/gen7).
// Data only, no engine imports: every Status move of the four games' catalogs (${Object.keys(dump).length}), with the build's kind
// (status-eot SPEC §2.2, ADDENDUM §2.2) and the dex fields the 2v2 status-move pipeline (doubles-status.ts) reads.
// tests/source/doubles-status-moves.test.ts checks every field against the pinned dex per game.
import type { BattleGame } from "./types";

/**
 * M: modelled exactly. N: no effect on this turn's HP or order. C: modelled under a condition, otherwise guarded. L: not
 * modelled in this build (not estimated before a later living action; with none only the end of turn). S: switches a
 * Pokémon out. P: presence guard. X: today's handling (doubles-status.ts statusMove's early branches, presence guards).
 */
export type StatusKind = "M" | "N" | "C" | "L" | "S" | "P" | "X";
export type StatusFlags = Partial<Record<"protect" | "reflectable" | "powder" | "sound" | "bypasssub" | "heal" | "wind" | "gravity", true>>;
export type StatusStages = Partial<Record<"atk" | "def" | "spa" | "spd" | "spe" | "accuracy" | "evasion", number>>;
export type StatusEntry = {
  kind: StatusKind;
  /** The dex target type. */
  target: string;
  priority: number;
  type: string;
  flags: StatusFlags;
  /** ignoreImmunity false: type immunity applies (Thunder Wave vs Ground). */
  ignoreImmunity?: false;
  /** moveData.boosts (on each target). */
  boosts?: StatusStages;
  /** moveData.self.boosts (on the user). */
  selfBoosts?: StatusStages;
  /** moveData.self.volatileStatus (Roost). */
  selfVolatile?: string;
  status?: "slp" | "par" | "brn" | "psn" | "tox" | "frz";
  volatile?: string;
  side?: string;
  slot?: string;
  heal?: [number, number];
  selfdestruct?: string;
  /** The move's own onHit or condition the pipeline runs (doubles-status.ts onHit, volatile, sideOrField). */
  handler?: string;
  /** The move's own Try or TryHit failure the pipeline checks (doubles-status.ts moveTry, hitOne). */
  fails?: string;
  /** Each catalog game that has the move, with the fields that differ there (null: absent there). */
  games: Partial<Record<BattleGame, Partial<Record<keyof Omit<StatusEntry, "kind" | "games" | "handler" | "fails">, unknown>>>>;
};

export const STATUS_MOVE_TABLE: Readonly<Record<string, StatusEntry>> = {
${lines.join("\n")}
} as Record<string, StatusEntry>;

/** The move's entry as \`game\` sees it (its overrides applied), or undefined when the move is not a catalog Status move there. */
export function statusEntry(id: string, game: BattleGame): StatusEntry | undefined {
  const entry = STATUS_MOVE_TABLE[id];
  const own = entry?.games[game];
  if (!entry || !own) return undefined;
  const merged = { ...entry, ...own } as Record<string, unknown>;
  for (const [key, value] of Object.entries(own)) if (value === null) delete merged[key];
  return merged as StatusEntry;
}

/** Moves with flags.failencore (Encore fails when it is the last move), in any of the four games. */
export const FAILENCORE_MOVES: ReadonlySet<string> = new Set(${JSON.stringify(flagged.failencore.all)});
/** Moves with flags.defrost: a frozen user thaws as it uses one (data/conditions.ts frz onBeforeMove; Burn Up only for a Fire type). */
export const DEFROST_MOVES: ReadonlySet<string> = new Set(${JSON.stringify(flagged.defrost.all)});
/** Champions: moves with flags.cantusetwice, which Disable does not stop there (data/mods/champions/moves.ts disable). */
export const CANTUSETWICE_MOVES: ReadonlySet<string> = new Set(${JSON.stringify(flagged.cantusetwice.all)});
/** Moves with thawsTarget: a hit thaws a frozen target (data/conditions.ts frz onAfterMoveSecondary). */
export const THAWING_MOVES: ReadonlySet<string> = new Set(${JSON.stringify(flagged.thawsTarget.all)});

/** Status moves with flags.heal in \`game\` (Triage: +3 priority, calculate.ts turnPriority). */
export function healFlag(id: string, game: BattleGame): boolean {
  return !!statusEntry(id, game)?.flags.heal;
}
`);
console.error(JSON.stringify(counts));
