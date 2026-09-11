import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";

export type AlertVariant = "success" | "error" | "warning" | "info";

const styles: Record<
  AlertVariant,
  { box: string; icon: typeof Info; role: "status" | "alert"; iconClass: string }
> = {
  success: {
    box: "border-success/50 bg-success-soft",
    icon: CircleCheck,
    role: "status",
    iconClass: "text-success",
  },
  error: {
    box: "border-danger/50 bg-danger-soft",
    icon: CircleAlert,
    role: "alert",
    iconClass: "text-danger",
  },
  warning: {
    box: "border-warning/50 bg-warning-soft",
    icon: TriangleAlert,
    role: "alert",
    iconClass: "text-warning",
  },
  info: {
    box: "border-accent-border bg-accent-soft",
    icon: Info,
    role: "status",
    iconClass: "text-accent-text",
  },
};

export type AlertProps = {
  variant: AlertVariant;
  title?: ReactNode;
  children?: ReactNode;
  /** Optional trailing control, e.g. a Retry button. */
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
};

export default function Alert({
  variant,
  title,
  children,
  action,
  onDismiss,
  className = "",
}: AlertProps) {
  const style = styles[variant];
  const Icon = style.icon;

  return (
    <div
      role={style.role}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm text-text ${style.box} ${className}`.trim()}
    >
      <Icon
        aria-hidden="true"
        className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconClass}`}
      />
      {/* `overflow-wrap` inherits, so `wrap-anywhere` here keeps both the
          title and the body (which often quote a long name or an email
          address) inside a 375px viewport. */}
      <div className="min-w-0 flex-1 wrap-anywhere">
        {title && <p className="font-semibold">{title}</p>}
        {children && (
          <div className={title ? "mt-0.5 text-muted" : ""}>{children}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-muted hover:bg-panel-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
