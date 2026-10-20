/**
 * One letter of the mark: a "p" whose stem is the left side of its ring
 * bowl and drops below it, set high and left in the tile. The "d" is this
 * same shape turned half a circle about the tile's centre, so it lands lower
 * and to the right with both letters sharing one stroke and one bowl, and a
 * small gap (2 units) between the two rings.
 */
const LETTER = (
  <>
    <rect x="5.8" y="4.4" width="3.5" height="18" rx="1.75" className="fill-on-accent" />
    <circle cx="11.8" cy="10.4" r="4.25" fill="none" strokeWidth="3.5" className="stroke-on-accent" />
  </>
);

/**
 * The PokeDrafts mark: "pd" on a rounded tile in the palette's accent, so it
 * follows the chosen type theme. Decorative: the wordmark (or the
 * surrounding link's name) carries the brand for assistive technology.
 * app/icon.svg, app/favicon.ico and app/apple-icon.png draw the same mark.
 */
export default function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <rect width="32" height="32" rx="9" className="fill-accent" />
      {LETTER}
      <g transform="rotate(180 16 16)">{LETTER}</g>
    </svg>
  );
}
