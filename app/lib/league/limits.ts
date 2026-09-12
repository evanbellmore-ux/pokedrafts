import {
  LEAGUE_LIMITS,
  PLAYOFF_FORMATS,
  TIEBREAKERS,
  type CreateLeagueInput,
  type PlayoffFormat,
  type Tiebreaker,
} from "@/app/types/league";

/**
 * Client-side normalisation for league settings forms
 * (docs/release-architecture.md section 8.3): numbers are parsed with
 * Number.parseInt, NaN is rejected, and values are clamped to the ranges in
 * section 4 before the RPC is called. The Postgres functions re-validate.
 */

export type IntRange = { readonly min: number; readonly max: number };

/** Defaults for a new league; match the column defaults in sections 4 and 12. */
export const CREATE_LEAGUE_DEFAULTS = {
  maxCoaches: 8,
  pointBudget: 100,
  picksPerTeam: 10,
  pickTimerSeconds: 120,
  /** `create_league` defaults to Top 4 (section 12.5); Settings can change it. */
  playoffFormat: "top_4" as PlayoffFormat,
  tiebreaker: "head_to_head" as Tiebreaker,
} as const;

/** Clamps an integer into `range`; non-finite input becomes `fallback`. */
export function clampToRange(
  value: number | null | undefined,
  range: IntRange,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return clampToRange(fallback, range, range.min);
  }
  const int = Math.trunc(value);
  if (int < range.min) return range.min;
  if (int > range.max) return range.max;
  return int;
}

/** Parses a text or numeric input as an integer and clamps it. */
export function parseClampedInt(
  raw: unknown,
  range: IntRange,
  fallback: number
): number {
  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw.trim(), 10)
        : Number.NaN;
  return clampToRange(Number.isNaN(parsed) ? fallback : parsed, range, fallback);
}

export function isPlayoffFormat(value: unknown): value is PlayoffFormat {
  return (
    typeof value === "string" &&
    (PLAYOFF_FORMATS as readonly string[]).includes(value)
  );
}

export function isTiebreaker(value: unknown): value is Tiebreaker {
  return (
    typeof value === "string" && (TIEBREAKERS as readonly string[]).includes(value)
  );
}

/** Raw state of the create-league form before normalisation. */
export type CreateLeagueForm = {
  name: string;
  teamName: string;
  maxCoaches: number | string | null;
  /** Empty string or null means "no draft format". */
  draftFormatId: string | null;
  pointBudget?: number | string | null;
  picksPerTeam?: number | string | null;
  pickTimerSeconds?: number | string | null;
  /** Omitted or null means the default (Top 4); anything else must be a format. */
  playoffFormat?: string | null;
};

export type CreateLeagueBuildResult =
  | { input: CreateLeagueInput; error: null }
  | { input: null; error: string };

/**
 * Turns the form state into a `CreateLeagueInput` for `rpc.createLeague`.
 * Text is trimmed and length-checked against LEAGUE_LIMITS (a user-facing
 * error is returned instead of silently truncating); numbers are clamped.
 * The tiebreaker is not on the form (it lives in Settings) and stays at its
 * default.
 */
export function buildCreateLeagueInput(
  form: CreateLeagueForm
): CreateLeagueBuildResult {
  const name = form.name.trim();
  if (name.length < LEAGUE_LIMITS.name.min) {
    return { input: null, error: "Enter a league name." };
  }
  if (name.length > LEAGUE_LIMITS.name.max) {
    return {
      input: null,
      error: `League names are at most ${LEAGUE_LIMITS.name.max} characters.`,
    };
  }

  const teamName = form.teamName.trim();
  if (teamName.length < LEAGUE_LIMITS.teamName.min) {
    return { input: null, error: "Enter a team name." };
  }
  if (teamName.length > LEAGUE_LIMITS.teamName.max) {
    return {
      input: null,
      error: `Team names are at most ${LEAGUE_LIMITS.teamName.max} characters.`,
    };
  }

  const draftFormatId = form.draftFormatId?.trim() || null;

  const rawFormat = form.playoffFormat == null ? null : form.playoffFormat.trim();
  const playoffFormat: PlayoffFormat | null =
    rawFormat === null || rawFormat === ""
      ? CREATE_LEAGUE_DEFAULTS.playoffFormat
      : isPlayoffFormat(rawFormat)
        ? rawFormat
        : null;
  if (playoffFormat === null) {
    return { input: null, error: "Choose a playoff format." };
  }

  return {
    input: {
      name,
      teamName,
      maxCoaches: parseClampedInt(
        form.maxCoaches,
        LEAGUE_LIMITS.maxCoaches,
        CREATE_LEAGUE_DEFAULTS.maxCoaches
      ),
      draftFormatId,
      pointBudget: parseClampedInt(
        form.pointBudget,
        LEAGUE_LIMITS.pointBudget,
        CREATE_LEAGUE_DEFAULTS.pointBudget
      ),
      picksPerTeam: parseClampedInt(
        form.picksPerTeam,
        LEAGUE_LIMITS.picksPerTeam,
        CREATE_LEAGUE_DEFAULTS.picksPerTeam
      ),
      pickTimerSeconds: parseClampedInt(
        form.pickTimerSeconds,
        LEAGUE_LIMITS.pickTimerSeconds,
        CREATE_LEAGUE_DEFAULTS.pickTimerSeconds
      ),
      playoffFormat,
      tiebreaker: CREATE_LEAGUE_DEFAULTS.tiebreaker,
    },
    error: null,
  };
}
