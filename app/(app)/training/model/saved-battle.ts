// Saved battles and replays (docs/training.md "Saved battles and replays"): the stored record (format v1), its summary for
// the Saved battles list, the export file, the import check (untrusted input: size, schema, version) and the log hash a
// re-run is compared with. Types and pure functions only: no simulator, engine, storage or React code.
import { DOUBLES_SLOTS } from "@/app/lib/battle/doubles-types";
import type { HabitsData } from "./habits-data";
import type { HabitsRecord } from "./decision";
import { SHEET_FIELDS } from "./info";
import { fnv1a32 } from "./random";
import { TRAINING_FORMAT_ID, type BoardView, type LogTurn, type TrainingDifficulty, type TrainingSetup } from "./view-types";

export const SAVED_BATTLE_VERSION = 1;
/** Saved battles kept per account in this browser; the oldest are removed first. */
export const SAVED_BATTLES_CAP = 100;
/** Import files larger than this are refused before they are read. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_LABEL = "2 MB";
/** The export file's `kind`. */
export const EXPORT_KIND = "pokedrafts-training-battle";
/** The pinned Showdown commit a record was played on (FORMAT_FACTS "Rules"); a re-run needs the same one. */
export const RULES_VERSION = "c23d2e94";
/** The latest time a Date holds (ms since 1970): createdAt and updatedAt above it are refused (they would not render). */
export const MAX_TIME = 8.64e15;
/** An import file nesting deeper than this is refused before any other check (an export file nests about 10 levels). */
export const IMPORT_MAX_DEPTH = 24;

export type SavedResult = { result: "win" | "loss" | "tie"; forfeited: boolean };

/**
 * One saved battle, format v1. `finished`: seed, inputLog and result are set, resume is null. `unfinished` (the autosave
 * of a battle in progress): resume holds the worker's sealed checkpoint (seed, both sides' choices, the AI's seed base and
 * the habits at the start, encrypted with a key kept in this browser: the page never reads them); seed, inputLog and
 * result are null.
 */
export type SavedBattleV1 = {
  version: 1;
  id: string;
  status: "finished" | "unfinished";
  /** "imported": it came from an export file. */
  source: "played" | "imported";
  format: typeof TRAINING_FORMAT_ID;
  rules: string;
  /** Milliseconds since 1970: the battle's start and the last save. */
  createdAt: number;
  updatedAt: number;
  /** Both teams as played, the information settings, the difficulty and showRead. */
  setup: TrainingSetup;
  /** Finished: the battle's last turn. Unfinished: the turn it resumes at. */
  turn: number;
  result: SavedResult | null;
  /** The simulator's seed ("sodium,<32 hex>"). */
  seed: string | null;
  /** The simulator's choice lines in order (">p1 team 1, 2, 3, 4", ">p2 move 1 2, switch 3"). */
  inputLog: string[] | null;
  /** The log as the page showed it: lines, steps, both sides' actions and the AI's reads as redacted for you. */
  log: LogTurn[];
  resume: { sealed: string } | null;
  /** Unfinished only: the habits before the battle (its end comparison) and the habits its last turn left (Resume checks them). */
  habitsBefore: HabitsData | null;
  habitsAfter: HabitsRecord | null;
  /** Your team order (1-based) for Rematch after a Resume. */
  order: number[] | null;
};
export type SavedBattle = SavedBattleV1;

export type SavedBattleSummary = {
  id: string;
  status: SavedBattle["status"];
  source: SavedBattle["source"];
  createdAt: number;
  updatedAt: number;
  own: string;
  opponent: string;
  turn: number;
  result: SavedResult | null;
  difficulty: TrainingDifficulty;
};

/** The Saved battles list on the setup screen (the page store's view of the BattleStore). */
export type SavedBattlesState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  list: SavedBattleSummary[];
  /** The last storage fact: "Storage is full: turn 4 was not saved.", "Saved battles are unavailable in this browser." */
  message: string | null;
  import:
    | { status: "idle" }
    | { status: "checking"; name: string }
    | { status: "error"; name: string; message: string }
    | { status: "done"; name: string };
  /** The battle in progress was stored after this turn began (a reload offers Resume there). */
  autosaved: { battleId: number; turn: number } | null;
};

/** The replay screen: a saved battle re-run in the worker from its seed and choices. */
export type ReplayState = {
  id: string;
  summary: SavedBattleSummary;
  setup: TrainingSetup;
  log: LogTurn[];
  /** "board": re-run and equal to the saved log; "log": only the saved log can be shown (message says why). */
  status: "loading" | "board" | "log";
  /** The board as each turn began (turns 1…), and after the last one. */
  boards: { starts: Record<number, BoardView>; end: BoardView } | null;
  message: string | null;
};

// ---------- the log hash (a re-run reproduces the log exactly) ----------
/** JSON with sorted keys and undefined properties left out, so the hash does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((each) => (each === undefined ? "null" : canonicalJson(each))).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
/** 128 bits from four FNV-1a passes (not for anything secret). */
export function hashText(text: string): string {
  return [0, 1, 2, 3].map((part) => fnv1a32(`${part}|${text}`).toString(16).padStart(8, "0")).join("");
}
/** The turns the simulator wrote (lines and playback steps) without the reads or actions; turns with neither are left out. */
function written(log: readonly LogTurn[]) {
  return [...log].filter((turn) => turn.lines.length || turn.steps?.length).sort((a, b) => a.turn - b.turn);
}
export function logHash(log: readonly LogTurn[]): string {
  return hashText(canonicalJson(written(log).map((turn) => [turn.turn, turn.lines, turn.steps ?? []])));
}
export function turnHashes(log: readonly LogTurn[]): Record<number, string> {
  return Object.fromEntries(written(log).map((turn) => [turn.turn, hashText(canonicalJson([turn.turn, turn.lines, turn.steps ?? []]))]));
}
/** The first turn whose lines or steps differ (null when every turn is equal). */
export function firstDifference(a: Record<number, string>, b: Record<number, string>): number | null {
  const turns = [...new Set([...Object.keys(a), ...Object.keys(b)].map(Number))].sort((x, y) => x - y);
  return turns.find((turn) => a[turn] !== b[turn]) ?? null;
}

// ---------- list, export ----------
export function summaryOf(record: SavedBattle): SavedBattleSummary {
  return {
    id: record.id, status: record.status, source: record.source, createdAt: record.createdAt, updatedAt: record.updatedAt,
    own: record.setup.own.label, opponent: record.setup.opponent.label, turn: record.turn, result: record.result, difficulty: record.setup.difficulty,
  };
}
/** "Won", "Lost", "Tie", "Forfeited", "Unfinished". */
export function resultText(summary: Pick<SavedBattleSummary, "status" | "result">): string {
  if (summary.status === "unfinished" || !summary.result) return "Unfinished";
  if (summary.result.forfeited) return "Forfeited";
  return summary.result.result === "win" ? "Won" : summary.result.result === "loss" ? "Lost" : "Tie";
}
export function turnsText(summary: Pick<SavedBattleSummary, "status" | "turn">): string {
  if (summary.status === "unfinished") return `Turn ${summary.turn}`;
  return `${summary.turn} ${summary.turn === 1 ? "turn" : "turns"}`;
}

export type ExportFile = { kind: typeof EXPORT_KIND; version: 1; battle: SavedBattle };
/** The file Export downloads: only finished battles, without the habits. */
export function exportText(record: SavedBattle): string {
  const battle: SavedBattle = { ...record, resume: null, habitsBefore: null, habitsAfter: null };
  return JSON.stringify({ kind: EXPORT_KIND, version: SAVED_BATTLE_VERSION, battle } satisfies ExportFile);
}
/** training-battle-2026-10-08-1402.json for a battle started then (local time). */
export function exportFileName(record: Pick<SavedBattle, "createdAt">): string {
  const date = new Date(record.createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `training-battle-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

// ---------- schema (untrusted input: import files, and anything read back from storage) ----------
type Check = (value: unknown, path: string) => string | null;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (max = 500): Check => (value, path) => (typeof value === "string" && value.length <= max ? null : `${path} is not text`);
const pattern = (re: RegExp, what: string): Check => (value, path) => (typeof value === "string" && re.test(value) ? null : `${path} is not ${what}`);
const num: Check = (value, path) => (typeof value === "number" && Number.isFinite(value) ? null : `${path} is not a number`);
const int = (min = 0, max = Number.MAX_SAFE_INTEGER): Check => (value, path) =>
  (Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? null : `${path} is not a whole number from ${min} to ${max}`);
const bool: Check = (value, path) => (typeof value === "boolean" ? null : `${path} is not true or false`);
const oneOf = (...values: readonly unknown[]): Check => (value, path) => (values.includes(value) ? null : `${path} is not one of ${values.map(String).join(", ")}`);
const nullable = (check: Check): Check => (value, path) => (value === null ? null : check(value, path));
const optional = (check: Check): Check => (value, path) => (value === undefined ? null : check(value, path));
const list = (check: Check, min = 0, max = 10_000): Check => (value, path) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) return `${path} is not a list of ${min === max ? min : `${min} to ${max}`} entries`;
  for (let i = 0; i < value.length; i++) { const error = check(value[i], `${path}.${i}`); if (error) return error; }
  return null;
};
const shape = (fields: Record<string, Check>): Check => (value, path) => {
  if (!isObject(value)) return `${path} is not an object`;
  for (const [key, check] of Object.entries(fields)) { const error = check(value[key], `${path}.${key}`); if (error) return error; }
  return null;
};
const map = (keys: Check, values: Check, max = 200): Check => (value, path) => {
  if (!isObject(value)) return `${path} is not an object`;
  const entries = Object.entries(value);
  if (entries.length > max) return `${path} has too many entries`;
  for (const [key, each] of entries) { const error = keys(key, `${path} key ${key.slice(0, 40)}`) ?? values(each, `${path}.${key.slice(0, 40)}`); if (error) return error; }
  return null;
};
const id = pattern(/^[a-z0-9]{1,60}$/, "an id");
const slot = oneOf(...DOUBLES_SLOTS);
const STATS = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
const statTable = (values: Check) => shape(Object.fromEntries(STATS.map((stat) => [stat, values])));
const boosts = map(oneOf("atk", "def", "spa", "spd", "spe", "accuracy", "evasion"), int(-6, 6), 7);
const status = oneOf("", "brn", "par", "psn", "tox", "slp", "frz");
const infoView = shape({ open: shape(Object.fromEntries(SHEET_FIELDS.map((field) => [field, bool]))), exactHP: bool, brought: bool });
const moveSlot = shape({ moveId: nullable(id), origin: text(30), gameType: nullable(oneOf("Singles", "Doubles")) });
const build = shape({
  game: text(30), speciesId: id, nature: text(30), abilityId: pattern(/^[a-z0-9]{0,60}$/, "an id"), itemId: pattern(/^[a-z0-9]{0,60}$/, "an id"),
  abilityActive: bool, boosts: map(oneOf("atk", "def", "spa", "spd", "spe", "accuracy", "evasion"), nullable(int(-6, 6)), 7), currentHP: nullable(num), status,
  points: optional(statTable(nullable(int(0, 66)))),
});
function isObjectCheck(): Check { return (value, path) => (isObject(value) ? null : `${path} is not an object`); }
const time = int(0, MAX_TIME);
const member = shape({
  key: text(200), name: text(100), speciesId: id, build, moves: list(moveSlot, 4, 4), origin: oneOf("suggested", "imported", "edited"),
  spriteName: optional(text(200)),
});
const team = shape({ label: text(200), members: list(member, 6, 6) });
const setup = shape({
  own: team, opponent: team, difficulty: oneOf("safe", "reads"), showRead: bool, info: shape({ aiKnows: infoView, youSee: infoView }),
});
const slotAction: Check = (value, path) => {
  if (!isObject(value)) return `${path} is not an object`;
  if (value.kind === "move") return shape({ moveId: id, target: nullable(slot), mega: optional(oneOf("mega", "megax", "megay")) })(value, path);
  if (value.kind === "switch") return shape({ to: text(200) })(value, path);
  return value.kind === "pass" ? null : `${path}.kind is not move, switch or pass`;
};
const jointAction = map(slot, slotAction, 4);
const hpView: Check = (value, path) => {
  if (!isObject(value)) return `${path} is not an object`;
  if (value.kind === "exact") return shape({ current: int(0, 100_000), maximum: int(1, 100_000) })(value, path);
  return value.kind === "percent" ? shape({ percent: num, color: optional(oneOf("g", "y", "r")) })(value, path) : `${path}.kind is not exact or percent`;
};
const stepSlot = shape({
  slot, key: text(200), name: text(100), entered: optional(oneOf(true)), hp: optional(shape({ from: hpView, to: hpView, low: optional(hpView) })),
  fainted: optional(oneOf(true)), status: optional(status), boosts: optional(boosts), mega: optional(oneOf(true)), facts: list(text(200), 0, 40),
});
const step = shape({
  kind: oneOf("move", "switch", "cant", "mega", "end", "effect"), title: text(300), by: nullable(text(200)), results: list(text(200), 0, 40),
  type: nullable(text(30)), targets: list(slot, 0, 4), actor: nullable(slot), slots: list(stepSlot, 0, 12),
});
const line = shape({
  text: text(1000), kind: oneOf("move", "switch", "damage", "heal", "faint", "status", "boost", "field", "item", "ability", "form", "fail", "info", "result"),
  slots: list(slot, 0, 4),
});
const option = shape({ action: nullable(jointAction), chance: num });
const megaFact = shape({ memberKey: text(200), evolved: bool, moves: list(id, 0, 8), text: text(1000) });
const report = shape({
  turn: int(0, 1000), provider: oneOf("engine", "jev", "engine-fallback"), difficulty: oneOf("safe", "reads"),
  predicted: list(option, 0, 20), strategy: list(option, 0, 60), chosen: int(0, 60), actual: nullable(shape({ chance: nullable(num) })),
  reason: nullable(text(1000)), mega: nullable(megaFact), facts: oneOf(undefined), assumed: list(text(300), 0, 8), elapsedMs: num,
  evaluated: shape({ yours: int(0, 1000), its: int(0, 1000) }),
  preview: optional(shape({ predictedLeads: list(shape({ keys: list(text(200), 0, 4), chance: num }), 0, 20) })),
});
const logTurn = shape({
  turn: int(0, 1000), lines: list(line, 0, 2000), steps: optional(list(step, 0, 200)),
  actions: nullable(shape({ own: jointAction, opponent: jointAction })), read: nullable(report),
});
const SEED = /^(sodium,[0-9a-f]{32}|gen5,[0-9a-f]{16}|\d+(,\d+){3})$/;
const INPUT_LINE = /^>p[12] [\x20-\x7e]{1,300}$/;
const finished = shape({
  version: oneOf(1), id: text(100), status: oneOf("finished"), source: oneOf("played", "imported"), format: oneOf(TRAINING_FORMAT_ID),
  rules: text(40), createdAt: time, updatedAt: time, setup, turn: int(0, 1000),
  result: shape({ result: oneOf("win", "loss", "tie"), forfeited: bool }), seed: pattern(SEED, "a simulator seed"),
  inputLog: list(pattern(INPUT_LINE, "a choice line"), 1, 4000), log: list(logTurn, 1, 1001),
});

export type ParsedBattle = { ok: true; record: SavedBattle } | { ok: false; error: string };

/**
 * Older formats → the current one. Each step takes the record of `version` and returns the next version's; none yet
 * (v1 is the first). A version above SAVED_BATTLE_VERSION is refused.
 */
const MIGRATIONS: Record<number, (record: Record<string, unknown>) => Record<string, unknown>> = {};
export function migrateSavedBattle(value: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!isObject(value) || !Number.isInteger(value.version) || (value.version as number) < 1) return { ok: false, error: "Not a saved Training battle." };
  let record = value;
  let version = record.version as number;
  if (version > SAVED_BATTLE_VERSION) return { ok: false, error: `Saved by a newer version of Training (format ${version}).` };
  while (version < SAVED_BATTLE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return { ok: false, error: `Format ${version} can no longer be read.` };
    record = step(record);
    version = record.version as number;
  }
  return { ok: true, value: record };
}

/** A finished battle from untrusted JSON (an import file's `battle`): version, format, rules and every field's type. */
export function parseFinishedBattle(value: unknown): ParsedBattle {
  const migrated = migrateSavedBattle(value);
  if (!migrated.ok) return migrated;
  const record = migrated.value;
  if (record.status === "unfinished") return { ok: false, error: "Unfinished battles cannot be imported." };
  if (record.format !== TRAINING_FORMAT_ID) return { ok: false, error: `Another format (${String(record.format).slice(0, 60)}).` };
  if (typeof record.rules === "string" && record.rules !== RULES_VERSION) {
    return { ok: false, error: `Played on Pokémon Showdown ${record.rules.slice(0, 40)}; Training runs ${RULES_VERSION}.` };
  }
  const error = finished(record, "battle");
  if (error) return { ok: false, error: `Not a saved Training battle: ${error}.` };
  const log = record.log as LogTurn[];
  if (new Set(log.map((turn) => turn.turn)).size !== log.length) return { ok: false, error: "Not a saved Training battle: battle.log repeats a turn." };
  const keys = (side: "own" | "opponent") => (record.setup as TrainingSetup)[side].members.map((each) => each.key);
  if (new Set(keys("own")).size !== 6 || new Set(keys("opponent")).size !== 6) return { ok: false, error: "Not a saved Training battle: a team repeats a member key." };
  const clean: SavedBattle = {
    version: 1, id: record.id as string, status: "finished", source: record.source as SavedBattle["source"], format: TRAINING_FORMAT_ID,
    rules: record.rules as string, createdAt: record.createdAt as number, updatedAt: record.updatedAt as number,
    setup: record.setup as TrainingSetup, turn: record.turn as number, result: record.result as SavedResult, seed: record.seed as string,
    inputLog: record.inputLog as string[], log, resume: null, habitsBefore: null, habitsAfter: null, order: null,
  };
  return { ok: true, record: clean };
}

/** True when `value` nests deeper than `max` objects and lists (walked without recursion: a hostile file cannot overflow the stack). */
export function nestsDeeper(value: unknown, max: number): boolean {
  const stack: [unknown, number][] = [[value, 1]];
  while (stack.length) {
    const [each, depth] = stack.pop()!;
    if (!each || typeof each !== "object") continue;
    if (depth > max) return true;
    for (const child of Array.isArray(each) ? each : Object.values(each)) if (child && typeof child === "object") stack.push([child, depth + 1]);
  }
  return false;
}

/** An export file's text → its battle (size, JSON, nesting, kind, version, schema). */
export function parseExportText(raw: string): ParsedBattle {
  if (raw.length > IMPORT_MAX_BYTES) return { ok: false, error: `The file is larger than ${IMPORT_MAX_LABEL}.` };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The file is not JSON." };
  }
  if (nestsDeeper(value, IMPORT_MAX_DEPTH)) return { ok: false, error: `Not a saved Training battle: it nests deeper than ${IMPORT_MAX_DEPTH} levels.` };
  if (!isObject(value) || value.kind !== EXPORT_KIND) return { ok: false, error: "Not a saved Training battle." };
  if (value.version !== SAVED_BATTLE_VERSION) {
    return Number.isInteger(value.version) && (value.version as number) > SAVED_BATTLE_VERSION
      ? { ok: false, error: `Saved by a newer version of Training (format ${value.version}).` }
      : { ok: false, error: "Not a saved Training battle." };
  }
  return parseFinishedBattle(value.battle);
}

const summaryCheck = shape({
  id: text(100), status: oneOf("finished", "unfinished"), source: oneOf("played", "imported"), createdAt: time, updatedAt: time,
  own: text(200), opponent: text(200), turn: int(0, 1000), result: nullable(shape({ result: oneOf("win", "loss", "tie"), forfeited: bool })),
  difficulty: oneOf("safe", "reads"),
});
/** A stored summary back (null when corrupt). */
export function parseSummary(value: unknown): SavedBattleSummary | null {
  return summaryCheck(value, "summary") ? null : (value as SavedBattleSummary);
}
/** A stored record back: this browser wrote it, so only the version and the fields the page reads are checked. */
export function parseStoredBattle(value: unknown): SavedBattle | null {
  const migrated = migrateSavedBattle(value);
  if (!migrated.ok) return null;
  const record = migrated.value;
  const base = shape({
    id: text(100), status: oneOf("finished", "unfinished"), createdAt: time, updatedAt: time, turn: int(0, 1000),
    setup: shape({ own: shape({ label: text(200), members: list(isObjectCheck(), 6, 6) }), opponent: shape({ label: text(200), members: list(isObjectCheck(), 6, 6) }) }),
    log: list(shape({ turn: int(0, 1000), lines: list(isObjectCheck(), 0, 2000) }), 0, 1001),
  })(record, "battle");
  if (base) return null;
  if (record.status === "finished" && (typeof record.seed !== "string" || !Array.isArray(record.inputLog) || !isObject(record.result))) return null;
  if (record.status === "unfinished" && (!isObject(record.resume) || typeof record.resume.sealed !== "string")) return null;
  return record as unknown as SavedBattle;
}

/** A fresh record id (crypto.randomUUID where available). */
export function newBattleId(random: () => number = Math.random): string {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null;
  return uuid ?? Array.from({ length: 4 }, () => Math.floor(random() * 4294967296).toString(16).padStart(8, "0")).join("");
}
