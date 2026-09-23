"use client";

import { Field, Input } from "@/app/components/ui";
import type { InputProps } from "@/app/components/ui/Input";
import { getBuildHealth } from "@/app/lib/battle/health";
import { getBuildStats } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BuildIssue } from "@/app/lib/battle/types";

type Props = Omit<InputProps, "value" | "onChange" | "type"> & {
  build: BattleBuild;
  issues: BuildIssue[];
  text: string;
  onTextChange: (text: string) => void;
  compact?: boolean;
  runtime?: BattleRuntime;
};

export default function CurrentHPField({ build, issues, text, onTextChange, compact = false, runtime = championsRuntime, ...inputProps }: Props) {
  const stats = getBuildStats(build, runtime);
  const health = getBuildHealth(build, runtime);
  const maxActive = build.mechanic === "dynamax" || build.mechanic === "gigantamax";
  const error = issues.filter((issue) => issue.field === "currentHP").map((issue) => issue.message).join(" ");
  const baseHelp = `Blank means full HP${stats ? ` (${stats.hp})` : ""}.`;
  const effectiveHelp = maxActive ? health && !health.reason
    ? ` Effective ${build.mechanic === "gigantamax" ? "Gigantamax" : "Dynamax"} HP: ${health.current} / ${health.max}. This input stays in base HP.`
    : ` Effective HP unavailable${health?.reason ? `: ${health.reason}` : " until the build is valid."}` : "";
  const help = `${baseHelp}${effectiveHelp}`;
  return (
    <Field id={inputProps.id} label={maxActive ? "Current HP (base / pre-Dynamax)" : "Current HP"} error={error} help={compact ? help : `${help} Damage percentages use ${maxActive ? "effective " : ""}maximum HP; KO chances use ${maxActive ? "effective " : ""}current HP.`}>
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
