import type { BattleStat } from "@/app/lib/battle/types";
import type { InfoView } from "./info";
import { showdownNature } from "./sets";
import type { TrainingTeam } from "./view-types";

export type StatPoints = Readonly<Record<BattleStat, number>>;
/** A member as its own side knows it: the set the battle uses. itemId "" = no item. */
export type FullSheetMember = {
  key: string; speciesId: string; name: string; gender: "M" | "F" | "N" | null;
  nature: string; itemId: string; abilityId: string; moves: readonly string[]; points: StatPoints;
};
/** The same member as the other side knows it at team preview: null = closed. */
export type SheetMember = {
  key: string; speciesId: string; name: string; gender: "M" | "F" | "N" | null;
  nature: string | null; itemId: string | null; abilityId: string | null; moves: readonly string[] | null; points: StatPoints | null;
};
export type SheetView = { members: readonly SheetMember[]; info: InfoView };

export function redactSheet(full: readonly FullSheetMember[], info: InfoView): SheetView {
  return {
    info,
    members: full.map((member) => ({
      key: member.key, speciesId: member.speciesId, name: member.name, gender: member.gender,
      nature: info.open.natures ? member.nature : null,
      itemId: info.open.items ? member.itemId : null,
      abilityId: info.open.abilities ? member.abilityId : null,
      moves: info.open.moves ? [...member.moves] : null,
      points: info.open.statPoints ? { ...member.points } : null,
    })),
  };
}
/** The page's copy of a team (no simulator): gender null. The worker builds the AI's sheet from the Showdown sets instead. */
export function sheetFromTeam(team: TrainingTeam): FullSheetMember[] {
  return team.members.map((member) => {
    const build = showdownNature(member.build);
    const points = build.game === "champions" ? build.points : null;
    return {
      key: member.key, speciesId: member.speciesId, name: member.name, gender: null,
      nature: build.nature, itemId: build.itemId, abilityId: build.abilityId,
      moves: [...new Set(member.moves.map((slot) => slot.moveId).filter((id): id is string => !!id))],
      points: { hp: points?.hp ?? 0, atk: points?.atk ?? 0, def: points?.def ?? 0, spa: points?.spa ?? 0, spd: points?.spd ?? 0, spe: points?.spe ?? 0 },
    };
  });
}
