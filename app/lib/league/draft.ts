/**
 * Pure draft helpers shared by the draft room and the unit tests. The
 * database enforces the same rules; these exist for instant UI feedback.
 */

/**
 * Index (0-based) into the ordered team list of the team that picks
 * `pickNumber` (1-based) in a snake draft with `teamCount` teams.
 */
export function getSnakeDraftIndex(pickNumber: number, teamCount: number) {
  if (teamCount <= 0 || pickNumber <= 0) return 0;
  const roundIndex = Math.floor((pickNumber - 1) / teamCount);
  const pickIndexInRound = (pickNumber - 1) % teamCount;

  return roundIndex % 2 === 0
    ? pickIndexInRound
    : teamCount - 1 - pickIndexInRound;
}

/** 1-based round number for a pick. */
export function getDraftRound(pickNumber: number, teamCount: number) {
  if (teamCount <= 0 || pickNumber <= 0) return 1;
  return Math.floor((pickNumber - 1) / teamCount) + 1;
}

export type BudgetCheck = {
  /** Cost of the Pokémon being considered. */
  points: number;
  /** Budget the team still has before this pick. */
  remainingBudget: number;
  /** Roster slots that will still be empty after this pick. */
  slotsLeftAfter: number;
  /** Cheapest Pokémon still available in the pool. */
  minPoolPoints: number;
};

/**
 * Budget rule from section 5 (`make_pick`): the pick must fit the remaining
 * budget, and enough must remain to fill every later slot with the cheapest
 * available Pokémon.
 */
export function canAffordPick({
  points,
  remainingBudget,
  slotsLeftAfter,
  minPoolPoints,
}: BudgetCheck): boolean {
  if (points > remainingBudget) return false;
  const reserve = Math.max(0, slotsLeftAfter) * Math.max(0, minPoolPoints);
  return remainingBudget - points >= reserve;
}

/** Total picks in a draft. */
export function totalDraftPicks(teamCount: number, picksPerTeam: number) {
  return Math.max(0, teamCount) * Math.max(0, picksPerTeam);
}
