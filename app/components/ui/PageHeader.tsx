import type { ReactNode } from "react";

export type PageHeaderProps = {
  title: ReactNode;
  /** Small muted line above the title (context, not a shouted label). */
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
        {eyebrow && <p className="text-sm font-medium text-muted">{eyebrow}</p>}
        {/* `wrap-anywhere` (overflow-wrap: anywhere) lets a spaceless league
            or team name break instead of widening a 375px viewport; the
            `min-w-0` wrapper lets it shrink below its longest word. */}
        <h1 className="mt-0.5 wrap-anywhere text-2xl font-semibold tracking-tight text-text sm:text-[1.75rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl wrap-anywhere text-sm text-muted">
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
