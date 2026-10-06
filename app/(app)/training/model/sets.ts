// model/sets.ts
import type { BattleBuild } from "@/app/lib/battle/types";
/** Showdown rejects Serious with 0 Stat Points (team-validator.ts:1333-1335); Hardy is the same neutral nature. */
export function showdownNature(build: BattleBuild): BattleBuild {
  const points = build.game === "champions" ? Object.values(build.points).reduce<number>((sum, value) => sum + (value ?? 0), 0) : 1;
  return build.nature === "Serious" && points === 0 ? { ...build, nature: "Hardy" } : build;
}
