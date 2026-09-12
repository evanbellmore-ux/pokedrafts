import { StatusPill } from "@/app/components/ui";

/**
 * A team name that can never widen the page: the name is a flex item, so it
 * needs `min-w-0` to shrink below its longest word, and `wrap-anywhere`
 * (overflow-wrap: anywhere) so a spaceless 40-character name breaks instead
 * of setting the item's min-content width. Plain `break-words` is not enough
 * for either. Shared by the regular-season rounds and the playoff bracket.
 */
export default function TeamName({
  name,
  isYou,
  muted = false,
}: {
  name: string;
  isYou: boolean;
  /** Renders the name in the muted colour (an eliminated coach). */
  muted?: boolean;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span
        className={`min-w-0 wrap-anywhere font-semibold ${muted ? "text-muted" : "text-text"}`}
      >
        {name}
      </span>
      {isYou && <StatusPill tone="accent">You</StatusPill>}
    </span>
  );
}
