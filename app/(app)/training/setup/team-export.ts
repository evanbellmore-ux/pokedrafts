import { STATS } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleStat } from "@/app/lib/battle/types";
import type { TrainingMember } from "../model/view-types";

// Edit as PokéPaste: the six sets in the Champions spelling app/lib/battle/team-import.ts parseTeamImport reads
// (explicit `SPs:` points, team-import.ts:230-251; `Level: 50`).

const STAT_SHORT: Record<BattleStat, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };

/** "32 HP / 32 Atk / 2 Spe"; "" when every stat is 0. */
export function pointsText(points: Partial<Record<BattleStat, number | null>> | null | undefined) {
  if (!points) return "";
  return STATS.filter((stat) => (points[stat] ?? 0) > 0).map((stat) => `${points[stat]} ${STAT_SHORT[stat]}`).join(" / ");
}

export function memberText(member: TrainingMember, runtime: BattleRuntime) {
  const { build } = member;
  const species = runtime.speciesById.get(build.speciesId)?.name ?? member.name;
  const gender = build.configuration?.gender && build.configuration.gender !== "N" ? ` (${build.configuration.gender})` : "";
  const item = build.itemId ? ` @ ${runtime.itemsById.get(build.itemId)?.name ?? build.itemId}` : "";
  const lines = [`${species}${gender}${item}`];
  if (build.abilityId) lines.push(`Ability: ${runtime.abilitiesById.get(build.abilityId)?.name ?? build.abilityId}`);
  lines.push("Level: 50");
  const points = build.game === "champions" ? pointsText(build.points) : "";
  if (points) lines.push(`SPs: ${points}`);
  lines.push(`${build.nature} Nature`);
  for (const slot of member.moves) if (slot.moveId) lines.push(`- ${runtime.movesById.get(slot.moveId)?.name ?? slot.moveId}`);
  return lines.join("\n");
}

export function exportTeamText(members: readonly TrainingMember[], runtime: BattleRuntime) {
  return members.map((member) => memberText(member, runtime)).join("\n\n");
}
