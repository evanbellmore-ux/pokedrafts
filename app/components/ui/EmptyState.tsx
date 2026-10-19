import type { ReactNode } from "react";

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Primary call to action (button or link). */
  action?: ReactNode;
  className?: string;
};

export default function EmptyState({
  title,
  description,
  icon,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-10 text-center ${className}`.trim()}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-panel-hover text-muted"
        >
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-text">{title}</p>
      {description && (
        <p className="mt-1 max-w-md text-sm text-muted">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
