import type { ReactNode } from "react";

export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger";

const tones: Record<StatusTone, string> = {
  neutral: "border-line bg-panel-hover text-muted",
  accent: "border-accent-border bg-accent-soft text-accent-text",
  success: "border-success/50 bg-success-soft text-success",
  warning: "border-warning/50 bg-warning-soft text-warning",
  danger: "border-danger/50 bg-danger-soft text-danger",
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
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
