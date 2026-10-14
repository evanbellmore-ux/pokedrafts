import type { ImportDraft } from "@/app/(app)/calculator/PokePasteImporter";
import type { AppliedPaste } from "@/app/(app)/calculator/roster-prep";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { parseTeamImport, type ImportFormat } from "@/app/lib/battle/team-import";
import type { InfoSettings } from "../model/info";
import { storedChecks, type StoredCheck } from "../model/saved-battle";
import type { MemberEdit, SetupDraft, SetupPicks, TeamSourceDraft, TrainingDifficulty } from "../model/view-types";
import { createSetupDraft, emptySource, isPasteKey } from "./team-draft";

// The remembered setup (training-session.ts SETUP_KEY, localStorage per account): your league, each league's opponent you
// picked and the opponents of your last starts there, AI difficulty, Show the AI's read, each side's source with its
// Choose 6 picks per mode, its set edits for those members and its PokéPaste text, and your last team order ("Same as last
// battle"). Never the information settings (their own key) and never the test extras. Read back as untrusted data with the
// saved-battle record's checks: a malformed part is dropped silently.

/** A side's PokéPaste text kept (the imported team's and the importer's together); text beyond it is not remembered. */
export const REMEMBERED_PASTE_MAX = 20_000;
/** Opponents of your last starts kept per league, newest first. */
export const RECENT_OPPONENTS = 4;
/** Leagues whose picks are kept (the latest picked or played). */
const LEAGUES_MAX = 50;
/** Set edits kept per side (the chosen six of each source mode). */
const EDITS_MAX = 12;

/** Your last submitted team order (1-based) and your six it was for, by member key. */
export type LastTeam = { ownKeys: string[]; order: number[] };
type StoredPaste = Pick<AppliedPaste, "id" | "text" | "title" | "url"> & { format: ImportFormat };
export type StoredSide = Pick<TeamSourceDraft, "mode" | "epoch" | "chosen" | "otherChosen" | "pasteDraft"> & {
  edits: Record<string, MemberEdit>;
  /** The imported team's text (imported again on restore, so its members keep their keys). */
  paste: StoredPaste | null;
};
export type StoredSetup = {
  version: 1;
  /** The league you picked ("": "—"; null: none picked). */
  leagueId: string | null;
  /** The opponent you picked per league ("": "—"). */
  opponents: Record<string, string>;
  recent: Record<string, string[]>;
  difficulty: TrainingDifficulty;
  showRead: boolean;
  own: StoredSide;
  opponent: StoredSide;
  lastTeam: LastTeam | null;
};

// ---------- writing ----------
/**
 * The roster a member key belongs to: a league key's runtime, league, member and roster, or a paste key's runtime, side and
 * paste id (roster-prep.ts rosterChoices, team-draft.ts pasteKey); null for a key of another shape.
 */
function rosterOf(key: string): string | null {
  try {
    const parts: unknown = JSON.parse(key);
    return Array.isArray(parts) && parts.length > 4 ? JSON.stringify(parts.slice(0, 4)) : null;
  } catch {
    return null;
  }
}
/**
 * A mode's edit is kept for one of its chosen members, or while that mode is on its first six (which are not known here): no
 * picks, or picks made on another roster (another opponent or league), which Choose 6 replaces by the roster's first six.
 */
function keepsEdit(key: string, picks: readonly string[] | null): boolean {
  if (!picks || picks.includes(key)) return true;
  const roster = rosterOf(key);
  return roster !== null && !picks.some((each) => rosterOf(each) === roster);
}
/** The record's PokéPaste parts as the reader takes them back: a title over its limit cut, a link over its limit left out. */
function fitted(paste: StoredPaste | null): StoredPaste | null {
  if (!paste) return null;
  const fit = { ...paste, title: paste.title.slice(0, TITLE_MAX), url: paste.url !== null && paste.url.length <= URL_MAX ? paste.url : null };
  return valid(PASTE, fit) ? fit : null;
}
function fittedDraft(draft: ImportDraft | null): ImportDraft | null {
  if (!draft) return null;
  const fit = { text: draft.text, url: draft.url.length <= URL_MAX ? draft.url : "", title: draft.title.slice(0, TITLE_MAX), format: draft.format };
  return valid(PASTE_DRAFT, fit) ? fit : null;
}

function storedSide(source: TeamSourceDraft): StoredSide {
  const applied = source.paste;
  const paste = applied && applied.text.length <= REMEMBERED_PASTE_MAX
    ? { id: applied.id, text: applied.text, title: applied.title, url: applied.url, format: applied.team.format }
    : null;
  // The importer's text when it is not the imported team's own (the importer starts from that team without it).
  const typed = source.pasteDraft;
  const same = !!typed && !!paste && typed.text === paste.text && typed.title === paste.title && typed.url === (paste.url ?? "") && typed.format === paste.format;
  const pasteDraft = typed && !same && (paste?.text.length ?? 0) + typed.text.length <= REMEMBERED_PASTE_MAX ? typed : null;
  // Each mode's edits for its chosen members (all of them while a mode is on its first six).
  const picks = (key: string) => (isPasteKey(key) === (source.mode === "paste") ? source.chosen : source.otherChosen);
  const edits = Object.entries(source.edits).filter(([key]) => keepsEdit(key, picks(key))).slice(-EDITS_MAX);
  return {
    mode: source.mode, epoch: source.epoch, chosen: source.chosen && [...source.chosen], otherChosen: source.otherChosen && [...source.otherChosen],
    edits: Object.fromEntries(edits), paste: fitted(paste), pasteDraft: fittedDraft(pasteDraft),
  };
}

/** The record for the current draft, your picks and the last team order (the information settings have their own key). */
export function storedSetupOf(draft: SetupDraft, picks: SetupPicks, lastTeam: LastTeam | null): StoredSetup {
  return {
    version: 1, leagueId: picks.leagueId, opponents: { ...picks.opponents },
    recent: Object.fromEntries(Object.entries(picks.recent).map(([league, ids]) => [league, [...ids]])),
    difficulty: draft.difficulty, showRead: draft.showRead, own: storedSide(draft.own), opponent: storedSide(draft.opponent),
    lastTeam: lastTeam && { ownKeys: [...lastTeam.ownKeys], order: [...lastTeam.order] },
  };
}

// ---------- your league picks ----------
export function picksOf(userId: string | null, stored: StoredSetup | null): SetupPicks {
  return { userId, leagueId: stored?.leagueId ?? null, opponents: stored?.opponents ?? {}, recent: stored?.recent ?? {} };
}
/** `map` with `league` set last (the latest league first to stay), at most LEAGUES_MAX leagues. */
function withEntry<T>(map: Readonly<Record<string, T>>, league: string, value: T): Record<string, T> {
  const entries = Object.entries(map).filter(([key]) => key !== league);
  entries.push([league, value]);
  return Object.fromEntries(entries.slice(-LEAGUES_MAX));
}
/** The league you picked ("": "—", remembered as your pick). */
export function withLeague(picks: SetupPicks, leagueId: string): SetupPicks {
  return leagueId === picks.leagueId ? picks : { ...picks, leagueId };
}
/** The opponent you picked in a league ("": "—", remembered as your pick, so no default replaces it there). */
export function withOpponent(picks: SetupPicks, leagueId: string, opponentId: string): SetupPicks {
  if (!leagueId || picks.opponents[leagueId] === opponentId) return picks;
  return { ...picks, opponents: withEntry(picks.opponents, leagueId, opponentId) };
}
/** A start against a league opponent: first of that league's recent opponents. */
export function withStart(picks: SetupPicks, leagueId: string, opponentId: string): SetupPicks {
  if (!leagueId || !opponentId) return picks;
  const recent = [opponentId, ...(picks.recent[leagueId] ?? []).filter((id) => id !== opponentId)].slice(0, RECENT_OPPONENTS);
  return { ...picks, recent: withEntry(picks.recent, leagueId, recent) };
}

// ---------- reading (untrusted: storage another version or a person may have changed) ----------
const { text, int, bool, oneOf, nullable, list, shape, memberEdit } = storedChecks;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const valid = (check: StoredCheck, value: unknown) => check(value, "setup") === null;
const ID: StoredCheck = (value, path) => text(200)(value, path) ?? (value === "" ? `${path} is empty` : null);
/** A league or opponent you picked: an id, or "" for "—". */
const PICK: StoredCheck = (value, path) => (value === "" ? null : ID(value, path));
const KEY = text(1000);
const KEYS = nullable(list(KEY, 0, 6));
const TITLE_MAX = 200;
const URL_MAX = 2000;
const PASTE = shape({
  id: (value, path) => (typeof value === "string" && /^(own|opponent)-\d{1,9}$/.test(value) ? null : `${path} is not a paste id`),
  text: text(REMEMBERED_PASTE_MAX), title: text(TITLE_MAX), url: nullable(text(URL_MAX)), format: oneOf("champions", "traditional"),
});
const PASTE_DRAFT = shape({ text: text(REMEMBERED_PASTE_MAX), url: text(URL_MAX), title: text(TITLE_MAX), format: oneOf("champions", "traditional") });
const LAST_TEAM = shape({ ownKeys: list(KEY, 6, 6), order: list(int(1, 6), 1, 6) });
/** A Champions set (Training's only game) with its Stat Points. */
const isEdit = (value: unknown): value is MemberEdit => valid(memberEdit, value) && (value as MemberEdit).build.game === "champions" && isObject((value as MemberEdit).build.points);

function parseSide(value: unknown): StoredSide {
  const raw = isObject(value) ? value : {};
  const edits = isObject(raw.edits) ? Object.entries(raw.edits).filter(([key, edit]) => valid(KEY, key) && isEdit(edit)).slice(-EDITS_MAX) : [];
  return {
    mode: raw.mode === "paste" ? "paste" : "league",
    epoch: valid(int(0, 1e9), raw.epoch) ? raw.epoch as number : 0,
    chosen: valid(KEYS, raw.chosen) ? (raw.chosen as string[] | null) : null,
    otherChosen: valid(KEYS, raw.otherChosen) ? (raw.otherChosen as string[] | null) : null,
    edits: Object.fromEntries(edits) as Record<string, MemberEdit>,
    paste: valid(PASTE, raw.paste) ? (raw.paste as StoredPaste) : null,
    pasteDraft: valid(PASTE_DRAFT, raw.pasteDraft) ? (raw.pasteDraft as ImportDraft) : null,
  };
}
function parseMap<T>(value: unknown, check: StoredCheck): Record<string, T> {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([league, each]) => valid(ID, league) && valid(check, each)).slice(-LEAGUES_MAX)) as Record<string, T>;
}

/** A stored setup back (null when there is none or it is not version 1); each malformed part falls back to its default. */
export function parseStoredSetup(value: unknown): StoredSetup | null {
  if (!isObject(value) || value.version !== 1) return null;
  const order = valid(LAST_TEAM, value.lastTeam) ? (value.lastTeam as LastTeam).order : null;
  const lastTeam = order && new Set(order).size === order.length ? { ownKeys: [...(value.lastTeam as LastTeam).ownKeys], order: [...order] } : null;
  const recent = parseMap<string[]>(value.recent, list(ID, 1, RECENT_OPPONENTS));
  return {
    version: 1,
    leagueId: valid(PICK, value.leagueId) ? value.leagueId as string : null,
    opponents: parseMap<string>(value.opponents, PICK),
    recent: Object.fromEntries(Object.entries(recent).map(([league, ids]) => [league, [...new Set(ids)]])),
    difficulty: value.difficulty === "reads" ? "reads" : "safe",
    showRead: valid(bool, value.showRead) ? value.showRead as boolean : true,
    own: parseSide(value.own), opponent: parseSide(value.opponent), lastTeam,
  };
}

function restoredSide(side: StoredSide, runtime: BattleRuntime): TeamSourceDraft {
  // The same text, format and id as imported: the members' keys (and so the picks and edits) are the ones remembered.
  const stored = side.paste;
  const paste: AppliedPaste | null = stored
    ? { id: stored.id, text: stored.text, title: stored.title, url: stored.url, team: parseTeamImport(stored.text, stored.format, runtime) }
    : null;
  // A PokéPaste side comes back only with its text; without any, as a League team side as it started, with that mode's picks.
  if (side.mode === "paste" && !paste && !side.pasteDraft) return { ...emptySource(), chosen: side.otherChosen, edits: side.edits };
  return { mode: side.mode, paste, pasteDraft: side.pasteDraft, epoch: side.epoch, chosen: side.chosen, otherChosen: side.otherChosen, edits: side.edits };
}

/** The draft a stored setup restores, with the information settings from their own key. */
export function restoredDraft(stored: StoredSetup, info: InfoSettings, runtime: BattleRuntime = championsRuntime): SetupDraft {
  return {
    ...createSetupDraft(info), own: restoredSide(stored.own, runtime), opponent: restoredSide(stored.opponent, runtime),
    difficulty: stored.difficulty, showRead: stored.showRead,
  };
}
