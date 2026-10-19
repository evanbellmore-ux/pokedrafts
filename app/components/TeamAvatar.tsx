import { teamInitials } from "@/app/lib/league/labels";

const SIZES = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
} as const;

/**
 * A team's initials in a circle; the caller's own team takes the accent.
 * Decorative: the team name is always written next to it.
 */
export default function TeamAvatar({
  name,
  mine = false,
  size = "md",
  title,
}: {
  name: string | null | undefined;
  mine?: boolean;
  size?: keyof typeof SIZES;
  /** Tooltip, for avatars shown without their name (stacks). */
  title?: string;
}) {
  return (
    <span
      aria-hidden="true"
      title={title}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${SIZES[size]} ${
        mine ? "bg-accent text-on-accent" : "bg-panel-hover text-muted"
      }`}
    >
      {teamInitials(name)}
    </span>
  );
}
