/** A league in the deletion plan (docs/release-architecture.md section 18). */
export type AccountLeague = {
  league_id: string;
  league_name: string;
};

/** A team in the deletion plan: `team_name` is null when the coach never named it. */
export type AccountTeam = AccountLeague & {
  team_name: string | null;
};

/**
 * `account_deletion_preview()`: what deleting the caller's account would do,
 * from the same plan `delete_account()` carries out. A league the caller
 * hands over is listed in `handed_over_leagues` and, with the caller's own
 * team, in `removed_teams` or `kept_teams`.
 */
export type AccountDeletionPreview = {
  /** Leagues the caller runs with no other coach: deleted with the account. */
  deleted_leagues: AccountLeague[];
  /** Leagues the caller runs with other coaches: the coach who joined earliest becomes commissioner. */
  handed_over_leagues: Array<AccountLeague & { new_commissioner_team: string | null }>;
  /** The caller's place in leagues whose draft has not started: removed. */
  removed_teams: AccountTeam[];
  /** The caller's teams in leagues whose draft has started: kept, with no link to the account. */
  kept_teams: AccountTeam[];
  /** Draft formats the caller saved in the Pool Builder: deleted. */
  draft_formats: number;
  /** Draft chat messages the caller wrote: deleted. */
  chat_messages: number;
  /** The caller reviews Watch listings (section 16): that access is removed. */
  site_admin: boolean;
};

/** `delete_account()` (and the owner's `_delete_account`): what it did, as counts. */
export type AccountDeletionResult = {
  deleted_leagues: number;
  handed_over_leagues: number;
  removed_teams: number;
  kept_teams: number;
  draft_formats: number;
  chat_messages: number;
  /** A site admin row was removed. */
  site_admin: boolean;
  /** An auth.users row was deleted: false for an id that had none (mistyped, or already deleted). */
  sign_in_deleted: boolean;
  /** Rows of GoTrue's auth.audit_log_entries that named the account. */
  audit_log_entries: number;
};
