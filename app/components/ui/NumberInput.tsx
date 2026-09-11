"use client";

import { useState, type InputHTMLAttributes, type Ref } from "react";
import Input from "@/app/components/ui/Input";

export type NumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "min" | "max" | "step"
> & {
  /** Current numeric value; null when empty or not a number. */
  value: number | null;
  /** Called with the parsed integer, or null when the field is empty/invalid. */
  onValueChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Clamp into [min, max] on blur (default true). */
  clampOnBlur?: boolean;
  ref?: Ref<HTMLInputElement>;
};

export function clampInteger(
  value: number,
  min: number | undefined,
  max: number | undefined
) {
  let next = Math.trunc(value);
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return next;
}

/**
 * Integer input that parses with Number.parseInt, rejects NaN and clamps to
 * the given range on blur. Keeps a text buffer so users can clear the field
 * while typing; if the owner did not accept the empty value (`value` is still
 * a number on blur) the buffer is restored to it so the field never shows
 * blank while holding a number.
 */
export default function NumberInput({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  clampOnBlur = true,
  onBlur,
  ref,
  ...rest
}: NumberInputProps) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [syncedValue, setSyncedValue] = useState(value);

  // Keep the text buffer in step with an externally changed `value` without
  // clobbering what the user is mid-way through typing (React's "adjusting
  // state when a prop changes" pattern, evaluated during render).
  if (value !== syncedValue) {
    setSyncedValue(value);
    const parsed = Number.parseInt(text, 10);
    if (value === null) {
      if (!Number.isNaN(parsed)) setText("");
    } else if (parsed !== value) {
      setText(String(value));
    }
  }

  return (
    <Input
      ref={ref}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = Number.parseInt(next, 10);
        onValueChange(Number.isNaN(parsed) ? null : parsed);
      }}
      onBlur={(event) => {
        const parsed = Number.parseInt(event.target.value, 10);
        if (Number.isNaN(parsed)) {
          if (value !== null) setText(String(value));
        } else if (clampOnBlur) {
          const clamped = clampInteger(parsed, min, max);
          if (clamped !== parsed) {
            setText(String(clamped));
            onValueChange(clamped);
          }
        }
        onBlur?.(event);
      }}
      {...rest}
    />
  );
}
