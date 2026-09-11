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

export function teamNameLabel(teamName: string | null | undefined): string {
  const trimmed = (teamName ?? "").trim();
  return trimmed.length > 0 ? trimmed : "Unnamed team";
}

export function pluralize(count: number, singular: string, plural?: string) {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
