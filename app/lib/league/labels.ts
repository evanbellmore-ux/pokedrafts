import type { PlayoffFormat, Tiebreaker } from "@/app/types/league";

/**
 * User-facing labels for raw enum values (section 2 of the architecture doc:
 * status enums are never rendered raw).
 */

export function roleLabel(role: string | null | undefined): string {
  const normalized = (role ?? "").trim().toLowerCase();
  if (normalized === "commissioner" || normalized === "commisioner") {
    return "Commissioner";
  }
  return "Coach";
}

export function matchStatusLabel(status: string | null | undefined): string {
  return (status ?? "").trim().toLowerCase() === "completed"
    ? "Final"
    : "Upcoming";
}

export function scheduleFormatLabel(format: string | null | undefined): string {
  return format === "double_round_robin"
    ? "Double round robin"
    : "Round robin";
}

const PLAYOFF_FORMAT_LABELS: Record<PlayoffFormat, string> = {
  none: "No playoffs",
  top_2: "Top 2 (final only)",
  top_4: "Top 4",
  top_6: "Top 6 (top 2 seeds get a bye)",
  top_8: "Top 8",
};

/** `leagues.playoff_format` as the settings selects show it (section 12.6). */
export function playoffFormatLabel(format: string | null | undefined): string {
  return format && format in PLAYOFF_FORMAT_LABELS
    ? PLAYOFF_FORMAT_LABELS[format as PlayoffFormat]
    : PLAYOFF_FORMAT_LABELS.none;
}

const TIEBREAKER_LABELS: Record<Tiebreaker, string> = {
  head_to_head: "Head-to-head first",
  differential: "Differential first",
};

/** `leagues.tiebreaker` as the settings select shows it (section 12.6). */
export function tiebreakerLabel(tiebreaker: string | null | undefined): string {
  return tiebreaker === "differential"
    ? TIEBREAKER_LABELS.differential
    : TIEBREAKER_LABELS.head_to_head;
}

/**
 * Playoff rounds are named by their distance from the final, never by their
 * round number (section 12.1). `roundSize` is the size of a full round at
 * that distance, `2 ** (lastPlayoffRound - round_number)`: 1 is the Final,
 * 2 the Semifinals, 4 the Quarterfinals. It is not the number of matches on
 * file: the first round of a `top_6` bracket holds two matches (seeds 1 and
 * 2 have a bye) and is still the Quarterfinals, the name `_round_name` in
 * SQL gives it too. Larger rounds (not produced by any current format) fall
 * back to "Round of N".
 */
export function playoffRoundName(roundSize: number): string {
  switch (roundSize) {
    case 1:
      return "Final";
    case 2:
      return "Semifinals";
    case 4:
      return "Quarterfinals";
    default:
      return `Round of ${Math.max(2, roundSize * 2)}`;
  }
}

/**
 * One match inside a playoff round: "Final", "Semifinal 2", "Quarterfinal 1"
 * (`roundSize` as in `playoffRoundName`). Used for "Winner of Quarterfinal
 * 2" placeholders and result dialogs.
 */
export function playoffMatchName(roundSize: number, matchNumber: number): string {
  switch (roundSize) {
    case 1:
      return "Final";
    case 2:
      return `Semifinal ${matchNumber}`;
    case 4:
      return `Quarterfinal ${matchNumber}`;
    default:
      return `${playoffRoundName(roundSize)}, match ${matchNumber}`;
  }
}

export function teamNameLabel(teamName: string | null | undefined): string {
  const trimmed = (teamName ?? "").trim();
  return trimmed.length > 0 ? trimmed : "Unnamed team";
}

export function pluralize(count: number, singular: string, plural?: string) {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
