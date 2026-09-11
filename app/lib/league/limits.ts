import { LEAGUE_LIMITS, type CreateLeagueInput } from "@/app/types/league";

/**
 * Client-side normalisation for league settings forms
 * (docs/release-architecture.md section 8.3): numbers are parsed with
 * Number.parseInt, NaN is rejected, and values are clamped to the ranges in
 * section 4 before the RPC is called. The Postgres functions re-validate.
 */

export type IntRange = { readonly min: number; readonly max: number };

/** Defaults for a new league; match the column defaults in section 4. */
export const CREATE_LEAGUE_DEFAULTS = {
  maxCoaches: 8,
  pointBudget: 100,
  picksPerTeam: 10,
  pickTimerSeconds: 120,
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
};

export type CreateLeagueBuildResult =
  | { input: CreateLeagueInput; error: null }
  | { input: null; error: string };

/**
 * Turns the form state into a `CreateLeagueInput` for `rpc.createLeague`.
 * Text is trimmed and length-checked against LEAGUE_LIMITS (a user-facing
 * error is returned instead of silently truncating); numbers are clamped.
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
    },
    error: null,
  };
}
