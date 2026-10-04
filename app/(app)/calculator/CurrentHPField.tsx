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
  runtime?: BattleRuntime;
  /** 2v2: current HP 0 is a fainted Pokémon, whose effective Dynamax HP is 0 (its issues come without the HP one). */
  allowFainted?: boolean;
};

export default function CurrentHPField({ build, issues, text, onTextChange, runtime = championsRuntime, allowFainted = false, ...inputProps }: Props) {
  const stats = getBuildStats(build, runtime);
  const fainted = allowFainted && build.currentHP === 0;
  const health = getBuildHealth(fainted ? { ...build, currentHP: null } : build, runtime);
  const maxActive = build.mechanic === "dynamax" || build.mechanic === "gigantamax";
  const error = issues.filter((issue) => issue.field === "currentHP").map((issue) => issue.message).join(" ");
  const help = maxActive ? health && !health.reason
    ? `Effective ${build.mechanic === "gigantamax" ? "Gigantamax" : "Dynamax"} HP: ${fainted ? 0 : health.current} / ${health.max}.`
    : `Effective HP unavailable${health?.reason ? `: ${health.reason}` : " until the build is valid."}` : undefined;
  return (
    <Field id={inputProps.id} label={maxActive ? "Current HP (base / pre-Dynamax)" : "Current HP"} error={error} help={help}>
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
