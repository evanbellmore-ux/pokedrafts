"use client";

import type { SelectHTMLAttributes, Ref } from "react";
import { ChevronDown } from "lucide-react";
import { useFieldContext } from "@/app/components/ui/Field";
import { controlClassName } from "@/app/components/ui/Input";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  ref?: Ref<HTMLSelectElement>;
};

export default function Select({
  className = "",
  id,
  ref,
  children,
  ...rest
}: SelectProps) {
  const field = useFieldContext();

  return (
    <div className="relative">
      <select
        ref={ref}
        id={id ?? field?.id}
        aria-describedby={rest["aria-describedby"] ?? field?.describedBy}
        aria-invalid={rest["aria-invalid"] ?? (field?.invalid || undefined)}
        required={rest.required ?? field?.required}
        className={`${controlClassName} appearance-none pr-9 ${className}`.trim()}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
