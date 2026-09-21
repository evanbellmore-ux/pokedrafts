"use client";

import { Field, Input } from "@/app/components/ui";
import type { InputProps } from "@/app/components/ui/Input";
import { getBuildStats } from "@/app/lib/battle/model";
import type { BattleBuild, BuildIssue } from "@/app/lib/battle/types";

type Props = Omit<InputProps, "value" | "onChange" | "type"> & {
  build: BattleBuild;
  issues: BuildIssue[];
  text: string;
  onTextChange: (text: string) => void;
  compact?: boolean;
};

export default function CurrentHPField({ build, issues, text, onTextChange, compact = false, ...inputProps }: Props) {
  const stats = getBuildStats(build);
  const error = issues.filter((issue) => issue.field === "currentHP").map((issue) => issue.message).join(" ");
  const help = `Blank means full HP${stats ? ` (${stats.hp})` : ""}.`;
  return (
    <Field id={inputProps.id} label="Current HP" error={error} help={compact ? help : `${help} Damage percentages use maximum HP; KO chances use current HP.`}>
      <Input
        {...inputProps}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        placeholder={stats ? `Full HP (${stats.hp})` : "Full HP"}
        onChange={(event) => onTextChange(event.target.value)}
      />
    </Field>
  );
}
