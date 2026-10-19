/**
 * The PokeDrafts mark: a "P" whose bowl is a ring, on a rounded tile in the
 * palette's accent, so it follows the chosen type theme. Decorative: the
 * wordmark (or the surrounding link's name) carries the brand for assistive
 * technology.
 */
export default function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <rect width="32" height="32" rx="9" className="fill-accent" />
      <rect x="8.5" y="7" width="4.5" height="18" rx="2.25" className="fill-on-accent" />
      <circle cx="17.25" cy="13.25" r="5" fill="none" strokeWidth="4.5" className="stroke-on-accent" />
    </svg>
  );
}
