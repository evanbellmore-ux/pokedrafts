import type { ReactNode } from "react";

export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger";

/** Soft fills, no outline: a pill labels something, it is not a control. */
const tones: Record<StatusTone, string> = {
  neutral: "bg-panel-hover text-muted",
  accent: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

/** A tone as a small status dot, for "● Label" lines that need no pill. */
export const toneDot: Record<StatusTone, string> = {
  neutral: "bg-faint",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export type StatusPillProps = {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
};

export default function StatusPill({
  tone = "neutral",
  children,
  className = "",
}: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
