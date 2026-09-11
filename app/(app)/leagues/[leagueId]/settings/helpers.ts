import { pluralize, teamNameLabel } from "@/app/lib/league/labels";
import {
  CREATE_LEAGUE_DEFAULTS,
  clampToRange,
  type IntRange,
} from "@/app/lib/league/limits";
import {
  LEAGUE_LIMITS,
  type League,
  type LeagueMember,
  type LeagueSettingsInput,
  type ScheduleFormat,
} from "@/app/types/league";

/** Columns the settings page reads from `league_members`. */
export type SettingsMember = Pick<
  LeagueMember,
  "id" | "user_id" | "team_name" | "role" | "draft_position" | "joined_at"
>;

/** Columns the settings page reads from `draft_formats`. */
export type FormatOption = {
  id: string;
  name: string;
  created_by: string | null;
};

/** Outcome banner for an action on the page (rendered with `Alert`). */
export type Notice = {
  variant: "success" | "warning" | "error" | "info";
  text: string;
};

export const SCHEDULE_FORMATS: readonly ScheduleFormat[] = [
  "round_robin",
  "double_round_robin",
];

/** `<Select>` value meaning "no draft format". */
export const NO_FORMAT = "";

export function toScheduleFormat(value: string): ScheduleFormat {
  return value === "double_round_robin" ? "double_round_robin" : "round_robin";
}

/** The editable settings as the form holds them (null = empty number field). */
export type SettingsValues = {
  name: string;
  maxCoaches: number | null;
  pointBudget: number | null;
  picksPerTeam: number | null;
  pickTimerSeconds: number | null;
  freeAgentSwapLimit: number | null;
  scheduleFormat: ScheduleFormat;
  draftFormatId: string;
};

export type NumericSettingKey =
  | "maxCoaches"
  | "pointBudget"
  | "picksPerTeam"
  | "pickTimerSeconds"
  | "freeAgentSwapLimit";

export function settingsValuesFromLeague(league: League): SettingsValues {
  return {
    name: league.name,
    maxCoaches: league.max_coaches,
    pointBudget: league.point_budget ?? CREATE_LEAGUE_DEFAULTS.pointBudget,
    picksPerTeam: league.picks_per_team ?? CREATE_LEAGUE_DEFAULTS.picksPerTeam,
    pickTimerSeconds: league.pick_timer_seconds,
    freeAgentSwapLimit: league.free_agent_swap_limit,
    scheduleFormat: toScheduleFormat(league.schedule_format),
    draftFormatId: league.draft_format_id ?? NO_FORMAT,
  };
}

export function sameSettingsValues(a: SettingsValues, b: SettingsValues): boolean {
  return (Object.keys(a) as (keyof SettingsValues)[]).every(
    (key) => a[key] === b[key]
  );
}

export type SettingsFieldErrors = Partial<Record<keyof SettingsValues, string>>;

export type SettingsPatchResult = {
  /** Only the keys whose value differs from the saved league row. */
  patch: LeagueSettingsInput;
  errors: SettingsFieldErrors;
};

const NUMERIC_FIELDS: Array<{
  key: NumericSettingKey;
  column: keyof LeagueSettingsInput;
  range: IntRange;
}> = [
  { key: "maxCoaches", column: "max_coaches", range: LEAGUE_LIMITS.maxCoaches },
  { key: "pointBudget", column: "point_budget", range: LEAGUE_LIMITS.pointBudget },
  { key: "picksPerTeam", column: "picks_per_team", range: LEAGUE_LIMITS.picksPerTeam },
  {
    key: "pickTimerSeconds",
    column: "pick_timer_seconds",
    range: LEAGUE_LIMITS.pickTimerSeconds,
  },
  {
    key: "freeAgentSwapLimit",
    column: "free_agent_swap_limit",
    range: LEAGUE_LIMITS.freeAgentSwapLimit,
  },
];

/**
 * Turns the form into an `update_league_settings` payload holding only the
 * changed keys (docs section 8.3: integers are clamped to the section 4
 * ranges before the call; the function re-validates). Field errors are
 * returned instead of a payload when something cannot be sent.
 */
export function buildSettingsPatch(
  saved: SettingsValues,
  form: SettingsValues,
  memberCount: number
): SettingsPatchResult {
  const errors: SettingsFieldErrors = {};
  const patch: LeagueSettingsInput = {};

  const name = form.name.trim();
  if (name !== saved.name) {
    if (name.length < LEAGUE_LIMITS.name.min) {
      errors.name = "Enter a league name.";
    } else if (name.length > LEAGUE_LIMITS.name.max) {
      errors.name = `League names are at most ${LEAGUE_LIMITS.name.max} characters.`;
    } else {
      patch.name = name;
    }
  }

  for (const field of NUMERIC_FIELDS) {
    const raw = form[field.key];
    if (raw === null) {
      errors[field.key] = "Enter a whole number.";
      continue;
    }
    const value = clampToRange(raw, field.range, field.range.min);
    if (value === saved[field.key]) continue;
    if (field.key === "maxCoaches" && value < memberCount) {
      errors.maxCoaches = `The league already has ${pluralize(memberCount, "coach", "coaches")}.`;
      continue;
    }
    (patch as Record<string, number>)[field.column] = value;
  }

  if (form.scheduleFormat !== saved.scheduleFormat) {
    patch.schedule_format = form.scheduleFormat;
  }

  if (form.draftFormatId !== saved.draftFormatId) {
    patch.draft_format_id = form.draftFormatId || null;
  }

  return { patch, errors };
}

/** Unbiased Fisher-Yates shuffle (returns a new array). */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** The groups the draft-format `<Select>` offers. */
export type FormatGroups = {
  own: FormatOption[];
  shared: FormatOption[];
  /**
   * The league's current format when it is neither own nor shared (it
   * belongs to a previous commissioner), so the form can echo it back.
   */
  current: FormatOption | null;
  /** The league points at a format that is not in the visible list. */
  currentMissing: boolean;
};

/**
 * Splits the visible formats into the groups the settings form may offer.
 * `update_league_settings` accepts a *changed* `draft_format_id` only when
 * the caller owns the format or it is shared (`_visible_format` in the
 * hardening migration); a format seen through another league's membership
 * would be refused with `format_not_found`, so it is left out. The league's
 * current value is always accepted unchanged, so it stays selectable even
 * when a previous commissioner owns it.
 */
export function groupFormatOptions(
  formats: FormatOption[],
  currentUserId: string,
  currentFormatId: string | null | undefined
): FormatGroups {
  const own = formats.filter((format) => format.created_by === currentUserId);
  const shared = formats.filter((format) => format.created_by === null);
  const currentVisible = currentFormatId
    ? (formats.find((format) => format.id === currentFormatId) ?? null)
    : null;
  const current =
    currentVisible &&
    currentVisible.created_by !== null &&
    currentVisible.created_by !== currentUserId
      ? currentVisible
      : null;
  return {
    own,
    shared,
    current,
    currentMissing: Boolean(currentFormatId) && currentVisible === null,
  };
}

/** Name of a draft format the caller can see, or null when there is none. */
export function formatName(
  formats: FormatOption[],
  formatId: string | null | undefined
): string | null {
  if (!formatId) return null;
  return formats.find((format) => format.id === formatId)?.name ?? null;
}

/**
 * Content key for a members list, so a card that seeds local state from it
 * only starts over when a coach, position, name or role actually changed,
 * not on every reload (which hands in a new array).
 */
export function membersKey(members: SettingsMember[]): string {
  return members
    .map(
      (member) =>
        `${member.id}:${member.draft_position ?? ""}:${member.team_name ?? ""}:${member.role}`
    )
    .join("|");
}

export function compareTeamNames(a: SettingsMember, b: SettingsMember): number {
  return teamNameLabel(a.team_name).localeCompare(teamNameLabel(b.team_name), undefined, {
    sensitivity: "base",
  });
}

/** Coaches in the draft order, by position. */
export function positionedMembers(members: SettingsMember[]): SettingsMember[] {
  return members
    .filter((member) => member.draft_position != null)
    .sort((a, b) => (a.draft_position ?? 0) - (b.draft_position ?? 0));
}

/** Coaches who watch the draft (no position), by team name. */
export function spectatorMembers(members: SettingsMember[]): SettingsMember[] {
  return members
    .filter((member) => member.draft_position == null)
    .sort(compareTeamNames);
}

/** "2 min 30 s" style label for the pick timer. */
export function timerLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${seconds} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}
