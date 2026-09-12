import type { DraftFormat, DraftPokemon } from "@/app/types/draft";

export type ScheduleFormat = "round_robin" | "double_round_robin";

export type LeagueRole = "commissioner" | "coach";

export type MatchStatus = "upcoming" | "completed";

/** `leagues.playoff_format` (docs/release-architecture.md section 12.2). */
export type PlayoffFormat = "none" | "top_2" | "top_4" | "top_6" | "top_8";

/** Every playoff format, in the order the selects list them. */
export const PLAYOFF_FORMATS: readonly PlayoffFormat[] = [
  "none",
  "top_2",
  "top_4",
  "top_6",
  "top_8",
];

/** `leagues.tiebreaker`: which tiebreaker applies first (section 12.3). */
export type Tiebreaker = "head_to_head" | "differential";

export const TIEBREAKERS: readonly Tiebreaker[] = ["head_to_head", "differential"];

/** `league_matches.stage`: the round robin or the playoff bracket. */
export type MatchStage = "regular" | "playoff";

/** `league_matches.feeds_slot`: the side of the next match a winner fills. */
export type BracketSlot = "home" | "away";

/** Row shape of `public.leagues` (see docs/release-architecture.md section 4). */
export type League = {
  id: string;
  name: string;
  commissioner_id: string;
  max_coaches: number;
  created_at: string | null;
  draft_format_id: string | null;
  point_budget: number | null;
  draft_started: boolean | null;
  current_pick_number: number | null;
  picks_per_team: number | null;
  draft_completed: boolean | null;
  pick_timer_seconds: number;
  pick_started_at: string | null;
  auto_pick_in_progress: boolean;
  custom_pool: DraftFormat | null;
  schedule_format: ScheduleFormat;
  free_agent_swap_limit: number;
  draft_paused_at?: string | null;
  draft_paused_total_seconds?: number;
  /** Which tiebreaker applies first after win percentage and wins. */
  tiebreaker: Tiebreaker;
  playoff_format: PlayoffFormat;
  /** The winner of the final, or the top seed when there are no playoffs. */
  champion_member_id: string | null;
};

/** Row shape of `public.league_members`. */
export type LeagueMember = {
  id: string;
  league_id: string;
  user_id: string;
  role: string;
  joined_at: string | null;
  team_name: string | null;
  draft_position: number | null;
  free_agent_swaps_used: number;
};

export type LeagueInvite = {
  id: string;
  league_id: string;
  invite_code: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  created_at: string | null;
};

export type DraftFormatRow = {
  id: string;
  name: string;
  json: DraftFormat;
  created_by: string | null;
  created_at: string | null;
};

export type DraftPick = {
  id: string;
  league_id: string;
  member_id: string;
  pokemon_name: string;
  points: number;
  tier: number;
  pick_number: number;
  created_at: string | null;
};

/** One roster entry inside `drafted_teams.pokemon`. */
export type RosterPokemon = DraftPokemon & {
  pick_number?: number | null;
  acquired?: "draft" | "free_agent";
};

export type DraftedTeam = {
  id: string;
  league_id: string;
  member_id: string;
  pokemon: RosterPokemon[];
  total_points: number;
  created_at: string | null;
};

/**
 * Row shape of `public.league_matches`. Regular matches always name both
 * coaches; a playoff match keeps a side null until the match feeding it is
 * decided (docs/release-architecture.md section 12.4).
 */
export type LeagueMatch = {
  id: string;
  league_id: string;
  round_number: number;
  match_number: number;
  home_member_id: string | null;
  away_member_id: string | null;
  status: MatchStatus | string;
  winner_member_id: string | null;
  scheduled_at: string | null;
  created_at: string;
  stage: MatchStage | string;
  /** Pokémon the winner had left standing; null when not recorded. */
  winner_remaining: number | null;
  home_seed: number | null;
  away_seed: number | null;
  /** The playoff match this match's winner advances to; null for the final. */
  feeds_match_id: string | null;
  feeds_slot: BracketSlot | null;
};

/** One row of `league_standings` (docs/release-architecture.md section 12.3). */
export type LeagueStanding = {
  member_id: string;
  /** 1..n, always distinct. */
  seed: number;
  /** Shared by coaches separated only by the coin flip. */
  rank: number;
  /** True when separated from another coach only by the coin flip. */
  tied: boolean;
  wins: number;
  losses: number;
  played: number;
  remaining: number;
  /** Numeric with 3 decimals. */
  win_pct: number;
  differential: number;
  /** Numeric with 3 decimals. */
  strength_of_schedule: number;
  /** The coach's position depended on a head-to-head comparison. */
  head_to_head_applied: boolean;
};

export type LeagueNews = {
  id: string;
  league_id: string;
  member_id: string | null;
  news_type: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type DraftChatMessage = {
  id: string;
  league_id: string;
  member_id: string;
  user_id: string;
  message: string;
  created_at: string;
};

/** Returned by `get_invite_preview`. */
export type InvitePreview = {
  league_id: string | null;
  league_name: string | null;
  coach_count: number;
  max_coaches: number;
  draft_started: boolean;
  draft_completed: boolean;
  already_member: boolean;
  invite_valid: boolean;
};

/** Accepted keys for `update_league_settings`. */
export type LeagueSettingsInput = Partial<{
  name: string;
  max_coaches: number;
  point_budget: number;
  picks_per_team: number;
  pick_timer_seconds: number;
  free_agent_swap_limit: number;
  schedule_format: ScheduleFormat;
  draft_format_id: string | null;
  playoff_format: PlayoffFormat;
  tiebreaker: Tiebreaker;
}>;

export type CreateLeagueInput = {
  name: string;
  teamName: string;
  maxCoaches: number;
  draftFormatId: string | null;
  pointBudget: number;
  picksPerTeam: number;
  pickTimerSeconds: number;
  playoffFormat: PlayoffFormat;
  tiebreaker: Tiebreaker;
};

/**
 * Returned by `make_pick` and `force_pick` (docs/schema.md). `force_pick`
 * adds `skipped`, and its `pokemon_name` is null when the turn was skipped
 * because nothing legal was left.
 */
export type PickResult = {
  pick_number: number;
  pokemon_name: string | null;
  draft_completed: boolean;
  skipped?: boolean;
};

export type AutoPickResult = {
  picked: boolean;
  pokemon_name: string | null;
  skipped: boolean;
  draft_completed: boolean;
};

export type UndoPickResult = {
  pick_number: number;
  pokemon_name: string;
};

/** Minimal user shape passed from the server layout to the client. */
export type SessionUser = {
  id: string;
  email: string | null;
};

/** Validation ranges enforced by the database (section 4). */
export const LEAGUE_LIMITS = {
  name: { min: 1, max: 60 },
  teamName: { min: 1, max: 40 },
  maxCoaches: { min: 2, max: 24 },
  pointBudget: { min: 1, max: 10000 },
  picksPerTeam: { min: 1, max: 30 },
  pickTimerSeconds: { min: 10, max: 3600 },
  freeAgentSwapLimit: { min: 0, max: 1000 },
  poolPoints: { min: 1, max: 20 },
  poolSize: { min: 1, max: 2000 },
  /**
   * "Winner's Pokémon left standing" on a result. The column accepts 1..12
   * (section 12.2); the UI offers a full team of 6.
   */
  winnerRemaining: { min: 1, max: 6 },
} as const;
