import type { ReactNode } from "react";

export type TableWrapProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Horizontal scroll container for wide tables so the page itself never
 * scrolls sideways on small screens.
 */
export default function TableWrap({ children, className = "" }: TableWrapProps) {
  return (
    <div
      className={`overflow-x-auto rounded-xl border border-line bg-panel ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export const tableClassName = "w-full min-w-[32rem] text-left text-sm";
export const theadClassName =
  "bg-panel-hover text-xs font-semibold uppercase tracking-wide text-muted";
export const thClassName = "px-4 py-3";
export const tdClassName = "px-4 py-3 align-middle";
export const trClassName = "border-t border-line";
