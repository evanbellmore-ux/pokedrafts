import {
  canAffordPick,
  getDraftRound,
  getSnakeDraftIndex,
  totalDraftPicks,
} from "@/app/lib/league/draft";
import { pluralize } from "@/app/lib/league/labels";
import { normalizePokemonName } from "@/app/lib/pokemon";
import { pointsToTier, type DraftFormat, type DraftPokemon } from "@/app/types/draft";
import type {
  DraftChatMessage,
  DraftPick,
  League,
  LeagueMember,
} from "@/app/types/league";

/**
 * Pure helpers for the draft room. Everything that can be derived from the
 * league row, the member list and the picks lives here so the hook and the
 * components stay small. The database enforces the same rules; these exist
 * for instant feedback and for rendering.
 */

/** Newest chat messages kept in the room (docs/schema.md, draft_chat_messages). */
export const CHAT_LIMIT = 100;
/** `draft_chat_messages.message` check constraint (1..500). */
export const CHAT_MAX_LENGTH = 500;
/** The countdown switches to urgency styling below this many seconds. */
export const URGENT_SECONDS = 10;
/** Rows rendered in the pool at once; search narrows the list further. */
export const POOL_ROW_CAP = 300;
/** Polling interval while the realtime channel is down (docs section 7). */
export const RECONNECT_POLL_MS = 10_000;
/** Retry interval for `auto_pick_if_expired` while the clock stays at 0. */
export const AUTO_PICK_RETRY_MS = 5_000;

export type MobilePanel = "roster" | "pool" | "board" | "chat";

export const MOBILE_PANELS: Array<{ id: MobilePanel; label: string }> = [
  { id: "roster", label: "Roster" },
  { id: "pool", label: "Pool" },
  { id: "board", label: "Board" },
  { id: "chat", label: "Chat" },
];

export type DraftPhase = "setup" | "live" | "paused" | "completed";

export function getDraftPhase(
  league: Pick<League, "draft_started" | "draft_completed" | "draft_paused_at">
): DraftPhase {
  if (league.draft_completed) return "completed";
  if (!league.draft_started) return "setup";
  return league.draft_paused_at ? "paused" : "live";
}

type PoolEntry = { name: string; points: number; tier?: unknown };

function isPoolEntry(value: unknown): value is PoolEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === "string" &&
    entry.name.trim().length > 0 &&
    typeof entry.points === "number" &&
    Number.isFinite(entry.points)
  );
}

/**
 * The league's draft pool is always `leagues.custom_pool` (docs/schema.md);
 * `draft_formats` is never consulted. Malformed entries are skipped and a
 * missing tier is derived so nothing downstream has to guard against them.
 */
export function readPool(customPool: DraftFormat | null | undefined): DraftPokemon[] {
  const raw: unknown = customPool?.pokemon;
  if (!Array.isArray(raw)) return [];

  const pool: DraftPokemon[] = [];
  for (const entry of raw) {
    if (!isPoolEntry(entry)) continue;
    pool.push({
      name: entry.name.trim(),
      points: Math.trunc(entry.points),
      tier:
        typeof entry.tier === "number" ? entry.tier : pointsToTier(entry.points),
    });
  }
  return pool;
}

/**
 * Key used to match picks against pool entries. `draft_picks.pokemon_name`
 * is the canonical pool name, so a case-insensitive trimmed key is a safe
 * superset of the database's exact match.
 */
export function pokemonKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Highest points first, then name; the order `auto_pick_if_expired` uses. */
export function compareByValue(a: DraftPokemon, b: DraftPokemon) {
  return b.points - a.points || a.name.localeCompare(b.name);
}

/** Coaches with a draft position, in draft order. Everyone else spectates. */
export function getDraftingCoaches(members: LeagueMember[]): LeagueMember[] {
  return members
    .filter((member) => member.draft_position !== null)
    .sort(
      (a, b) =>
        (a.draft_position ?? 0) - (b.draft_position ?? 0) ||
        (a.joined_at ?? "").localeCompare(b.joined_at ?? "")
    );
}

export type TeamBudget = {
  budget: number;
  spent: number;
  remaining: number;
  pickCount: number;
  /** Roster slots still empty before the next pick. */
  slotsLeft: number;
};

export function getTeamBudget(
  memberId: string,
  picks: DraftPick[],
  budget: number,
  picksPerTeam: number
): TeamBudget {
  let spent = 0;
  let pickCount = 0;
  for (const pick of picks) {
    if (pick.member_id !== memberId) continue;
    spent += pick.points;
    pickCount += 1;
  }
  return {
    budget,
    spent,
    remaining: budget - spent,
    pickCount,
    slotsLeft: Math.max(0, picksPerTeam - pickCount),
  };
}

/** Why a Pokémon cannot be drafted by a team right now (null = legal). */
export type PickBlock = "roster_full" | "over_budget" | "reserve";

export const PICK_BLOCK_LABELS: Record<PickBlock, string> = {
  roster_full: "Roster full",
  over_budget: "Over budget",
  reserve: "Not enough left for later picks",
};

/**
 * Mirrors `_pick_legal` in the database: the pick must fit the remaining
 * budget and leave enough to fill every later slot with the cheapest Pokémon
 * in the whole pool (`min_pool_points` is taken over the full pool, not only
 * the undrafted part).
 */
export function getPickBlock(
  points: number,
  team: TeamBudget,
  minPoolPoints: number
): PickBlock | null {
  if (team.slotsLeft <= 0) return "roster_full";
  if (points > team.remaining) return "over_budget";
  const affordable = canAffordPick({
    points,
    remainingBudget: team.remaining,
    slotsLeftAfter: team.slotsLeft - 1,
    minPoolPoints,
  });
  return affordable ? null : "reserve";
}

/** Cheapest entry of the whole pool (0 for an empty pool), as the database sees it. */
export function getMinPoolPoints(pool: DraftPokemon[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const entry of pool) {
    if (entry.points < min) min = entry.points;
  }
  return Number.isFinite(min) ? min : 0;
}

/** The drafting coaches in the order they pick during `round` (1-based). */
export function getRoundOrder(coaches: LeagueMember[], round: number): LeagueMember[] {
  return round % 2 === 1 ? coaches : [...coaches].reverse();
}

/** First pick number of a round (1-based round and pick numbers). */
export function getRoundFirstPick(round: number, teamCount: number) {
  return (round - 1) * teamCount + 1;
}

/**
 * Why "Start draft" is disabled before the function is even called, or null
 * when the client-side checks pass (the function re-validates and raises the
 * precise reason for anything else, such as a budget that is too small).
 */
export function getStartBlock(
  coachCount: number,
  poolSize: number,
  picksPerTeam: number
): string | null {
  if (coachCount < 2) {
    return "Set a draft order with at least two coaches in Settings before starting.";
  }
  if (poolSize === 0) {
    return "Choose a draft pool in Settings or on the Pool page before starting.";
  }
  const required = totalDraftPicks(coachCount, picksPerTeam);
  if (poolSize < required) {
    return `The draft pool has ${pluralize(poolSize, "Pokémon", "Pokémon")} but ${required} are needed for ${pluralize(coachCount, "coach", "coaches")} drafting ${picksPerTeam} each.`;
  }
  return null;
}

/** Case- and punctuation-insensitive substring match on a Pokémon name. */
export function matchesSearch(name: string, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  if (name.toLowerCase().includes(trimmed.toLowerCase())) return true;
  const normalizedQuery = normalizePokemonName(trimmed);
  return normalizedQuery.length > 0 && normalizePokemonName(name).includes(normalizedQuery);
}

export type CountdownInput = {
  pickStartedAt: string | null;
  pickTimerSeconds: number;
  /** `leagues.draft_paused_at`; freezes the countdown at the pause moment. */
  pausedAt: string | null | undefined;
  /** Current time on the server's clock (client clock + measured offset). */
  nowMs: number;
};

/** Whole seconds left on the pick clock, or null when there is no clock. */
export function getSecondsLeft({
  pickStartedAt,
  pickTimerSeconds,
  pausedAt,
  nowMs,
}: CountdownInput): number | null {
  if (!pickStartedAt) return null;
  const startedMs = new Date(pickStartedAt).getTime();
  if (Number.isNaN(startedMs)) return null;

  const deadlineMs = startedMs + pickTimerSeconds * 1000;
  const pausedMs = pausedAt ? new Date(pausedAt).getTime() : Number.NaN;
  const referenceMs = Number.isNaN(pausedMs) ? nowMs : pausedMs;
  return Math.max(0, Math.ceil((deadlineMs - referenceMs) / 1000));
}

/** `m:ss` for a countdown; timers go up to 3600 s so minutes can reach 60. */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function isChatMessage(value: unknown): value is DraftChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.member_id === "string" &&
    typeof row.message === "string" &&
    typeof row.created_at === "string"
  );
}

function chatTimestamp(message: DraftChatMessage): number {
  const ms = new Date(message.created_at).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Unions two message lists by id, oldest first, keeping the newest
 * CHAT_LIMIT. Used for the initial load (newest 100, reversed), for
 * realtime inserts and for the local append after sending, so a message
 * that arrives twice is shown once and a reload never drops one that
 * arrived while the request was in flight.
 */
export function mergeChat(
  existing: DraftChatMessage[],
  incoming: DraftChatMessage[]
): DraftChatMessage[] {
  const byId = new Map<string, DraftChatMessage>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()]
    .sort(
      (a, b) =>
        chatTimestamp(a) - chatTimestamp(b) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id)
    )
    .slice(-CHAT_LIMIT);
}

/** Calendar-day key used to insert date separators between messages. */
export function chatDayKey(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toDateString();
}

export function formatChatDay(iso: string, todayKey: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (date.toDateString() === todayKey) return "Today";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatChatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Characters in `text` as the database counts them (`char_length`: code points). */
export function chatLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Cuts a chat message to CHAT_MAX_LENGTH characters. Counts code points,
 * like the `char_length` check on `draft_chat_messages.message`, so an emoji
 * (a surrogate pair in UTF-16) is never split in half the way
 * `String#slice(0, 500)` would split it.
 */
export function clampChatMessage(text: string): string {
  const chars = Array.from(text);
  return chars.length > CHAT_MAX_LENGTH
    ? chars.slice(0, CHAT_MAX_LENGTH).join("")
    : text;
}

export type BoardEntry = {
  pickNumber: number;
  /** Coach who owned the pick slot (null when the order no longer resolves). */
  coach: LeagueMember | null;
  /** The pick, or null when the turn was skipped (no legal Pokémon). */
  pick: DraftPick | null;
};

export type BoardRound = {
  round: number;
  entries: BoardEntry[];
};

/**
 * Picks grouped by round, newest round first and newest pick first inside a
 * round. Pick numbers without a row up to `lastPickNumber` are turns that
 * `auto_pick_if_expired` / `force_pick` skipped, so they render as such
 * instead of silently disappearing.
 */
export function buildBoard(
  picks: DraftPick[],
  coaches: LeagueMember[],
  membersById: Map<string, LeagueMember>,
  lastPickNumber: number
): BoardRound[] {
  const teamCount = coaches.length;
  const byNumber = new Map<number, DraftPick>();
  let maxPick = 0;
  for (const pick of picks) {
    byNumber.set(pick.pick_number, pick);
    if (pick.pick_number > maxPick) maxPick = pick.pick_number;
  }
  const last = Math.max(lastPickNumber, maxPick);
  if (last <= 0) return [];

  const rounds = new Map<number, BoardEntry[]>();
  for (let pickNumber = 1; pickNumber <= last; pickNumber += 1) {
    const pick = byNumber.get(pickNumber) ?? null;
    const coach = pick
      ? (membersById.get(pick.member_id) ?? null)
      : teamCount > 0
        ? (coaches[getSnakeDraftIndex(pickNumber, teamCount)] ?? null)
        : null;
    const round = teamCount > 0 ? getDraftRound(pickNumber, teamCount) : 1;
    const entries = rounds.get(round) ?? [];
    entries.push({ pickNumber, coach, pick });
    rounds.set(round, entries);
  }

  return [...rounds.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([round, entries]) => ({
      round,
      entries: [...entries].sort((a, b) => b.pickNumber - a.pickNumber),
    }));
}
