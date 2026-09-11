/**
 * `leagues.commissioner_id` is the single source of truth for who runs a
 * league. `league_members.role` is display-only; never use it for checks.
 */
export function isLeagueCommissioner(
  league: { commissioner_id: string | null | undefined } | null | undefined,
  userId: string | null | undefined
): boolean {
  if (!league || !userId) return false;
  return league.commissioner_id === userId;
}

/** True when the member is the caller's own row. */
export function isOwnMember(
  member: { user_id: string } | null | undefined,
  userId: string | null | undefined
): boolean {
  return !!member && !!userId && member.user_id === userId;
}
