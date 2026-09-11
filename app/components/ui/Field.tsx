"use client";

import { createContext, useContext, useId, type ReactNode } from "react";

type FieldContextValue = {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/** Read by Input/Select/NumberInput to auto-wire id and aria attributes. */
export function useFieldContext() {
  return useContext(FieldContext);
}

export type FieldProps = {
  label: ReactNode;
  /** Explanatory text under the control. */
  help?: ReactNode;
  /** Validation message; sets aria-invalid on the control. */
  error?: ReactNode;
  required?: boolean;
  /** Visually hide the label (still announced). */
  hideLabel?: boolean;
  /** Override the generated control id. */
  id?: string;
  className?: string;
  children: ReactNode;
};

export default function Field({
  label,
  help,
  error,
  required = false,
  hideLabel = false,
  id: idProp,
  className = "",
  children,
}: FieldProps) {
  const generated = useId();
  const id = idProp ?? `field-${generated}`;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [errorId, helpId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider
      value={{ id, describedBy, invalid: !!error, required }}
    >
      <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
        <label
          htmlFor={id}
          className={
            hideLabel ? "sr-only" : "text-sm font-medium text-text"
          }
        >
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-danger">
              *
            </span>
          )}
        </label>
        {children}
        {help && (
          <p id={helpId} className="text-xs text-muted">
            {help}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
