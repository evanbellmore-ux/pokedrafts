"use client";

import type { InputHTMLAttributes, Ref } from "react";
import { useFieldContext } from "@/app/components/ui/Field";

/**
 * Shared classes for Input, Select and NumberInput.
 *
 * Boundary: the opaque per-palette `--color-control-border` token, which is
 * >= 3:1 against `bg` (the field fill), `panel` and `panel-hover` in all 18
 * palettes (WCAG 1.4.11, tests/unit/ui-a11y-review.test.ts). The fill is
 * within 1.2:1 of the surrounding card, so this line is what identifies the
 * field; the translucent `border-line` is only for decorative card borders.
 *
 * Focus indicator: opaque `--color-focus` on both the border and a 1px ring,
 * a 2px solid outline at >= 3:1 against every palette surface.
 */
export const controlClassName =
  "w-full rounded-lg border border-control-border bg-bg px-3 py-2.5 text-sm text-text placeholder:text-faint transition-colors focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  ref?: Ref<HTMLInputElement>;
};

export default function Input({ className = "", id, ref, ...rest }: InputProps) {
  const field = useFieldContext();

  return (
    <input
      ref={ref}
      id={id ?? field?.id}
      aria-describedby={rest["aria-describedby"] ?? field?.describedBy}
      aria-invalid={rest["aria-invalid"] ?? (field?.invalid || undefined)}
      required={rest.required ?? field?.required}
      className={`${controlClassName} ${className}`.trim()}
      {...rest}
    />
  );
}
