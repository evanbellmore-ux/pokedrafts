import type { ReactNode } from "react";

export type PageHeaderProps = {
  title: ReactNode;
  /** Small uppercase label above the title. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Buttons or links rendered on the right. */
  actions?: ReactNode;
  className?: string;
};

export default function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <header
      className={`flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`.trim()}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">
            {eyebrow}
          </p>
        )}
        {/* `wrap-anywhere` (overflow-wrap: anywhere) lets a spaceless league
            or team name break instead of widening a 375px viewport; the
            `min-w-0` wrapper lets it shrink below its longest word. */}
        <h1 className="mt-1 wrap-anywhere text-3xl font-bold tracking-tight text-text sm:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl wrap-anywhere text-sm text-muted">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap gap-2 sm:justify-end">{actions}</div>
      )}
    </header>
  );
}
