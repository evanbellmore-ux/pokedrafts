import { chanceText } from "@/app/lib/battle/chance";
import { defaultAbilityActive, NATURES, STATS } from "@/app/lib/battle/model";
import type { MoveSlot, MoveSlots } from "@/app/lib/battle/move-defaults";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleStat } from "@/app/lib/battle/types";
import type { MemberEdit, MoveOptionsState, TrainingMember } from "../model/view-types";

// The set editor (addendum A1.3): every move the species can legally use in Reg M-C (the worker's validator, any category),
// usage order first then A–Z; catalog items (the catalog holds exactly the legal ones); the form's abilities; natures;
// Champions Stat Points (at most 32 per stat, PS/sim/team-validator.ts:1306-1311; 66 in total, PS/sim/dex-formats.ts:343-345).

export const MAX_STAT_POINTS = 32;
export const TOTAL_STAT_POINTS = 66;

export type EditorMove = { id: string; name: string; type: string | null; category: string | null; weight: number | null };
export type EditorMoveList = {
  status: "loading" | "ready" | "fallback";
  /** Usage order (A1.1 weights). */
  usage: EditorMove[];
  /** The other legal moves, A–Z. */
  other: EditorMove[];
  /** Why the list is the catalog learnset instead of the validator's (the worker's message). */
  message: string | null;
};

function editorMove(id: string, weight: number | null, runtime: BattleRuntime): EditorMove {
  const move = runtime.movesById.get(id);
  return { id, name: move?.name ?? id, type: move?.type ?? null, category: move?.category ?? null, weight };
}

/** The editor's move list: the worker's legal moves, or (while it loads or after an error) the catalog learnset A–Z. */
export function editorMoveList(state: MoveOptionsState | undefined, speciesId: string, runtime: BattleRuntime): EditorMoveList {
  if (state?.status === "ready") {
    const usage = state.moves.filter((move) => move.weight !== null).map((move) => editorMove(move.id, move.weight, runtime));
    const other = state.moves.filter((move) => move.weight === null).map((move) => editorMove(move.id, null, runtime));
    return { status: "ready", usage, other, message: null };
  }
  const learnset = (runtime.speciesById.get(speciesId)?.moves ?? []).map((id) => editorMove(id, null, runtime))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return { status: state?.status === "error" ? "fallback" : "loading", usage: [], other: learnset, message: state?.status === "error" ? state.message : null };
}

/** The moves whose name contains the query (case and punctuation ignored), always keeping `keep` (the slot's current move). */
export function filterMoves(moves: readonly EditorMove[], query: string, keep: string | null): EditorMove[] {
  const needle = query.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!needle) return [...moves];
  return moves.filter((move) => move.id === keep || move.name.toLowerCase().replace(/[^a-z0-9]+/g, "").includes(needle) || move.id.includes(needle));
}

/** "Fake Out · 99.81%" for a usage move; the name otherwise. */
export function moveOptionText(move: EditorMove) {
  return move.weight === null ? move.name : `${move.name} · ${chanceText(move.weight)}`;
}

const STAT_SHORT: Record<string, string> = { atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
/** "Adamant (+Atk −SpA)", "Hardy". */
export function natureLabel(name: string) {
  const nature = NATURES.find((entry) => entry.name === name);
  return nature?.plus && nature.minus ? `${name} (+${STAT_SHORT[nature.plus]} −${STAT_SHORT[nature.minus]})` : name;
}

/** Facts for a Stat Point table that Showdown would reject. */
export function pointsIssues(points: Readonly<Record<BattleStat, number | null>>): string[] {
  const issues: string[] = [];
  if (STATS.some((stat) => points[stat] === null || !Number.isInteger(points[stat]) || points[stat]! < 0)) issues.push("Stat Points are whole numbers from 0.");
  if (STATS.some((stat) => (points[stat] ?? 0) > MAX_STAT_POINTS)) issues.push(`At most ${MAX_STAT_POINTS} Stat Points per stat.`);
  const total = STATS.reduce((sum, stat) => sum + (points[stat] ?? 0), 0);
  if (total > TOTAL_STAT_POINTS) issues.push(`At most ${TOTAL_STAT_POINTS} Stat Points in total (${total}).`);
  return issues;
}

export function totalPoints(build: BattleBuild) {
  return build.game === "champions" ? STATS.reduce((sum, stat) => sum + (build.points[stat] ?? 0), 0) : 0;
}

/** The member's set as a MemberEdit (the editor's starting point). */
export function editOf(member: TrainingMember): MemberEdit {
  return { build: structuredClone(member.build), moves: structuredClone(member.moves) };
}

export function withMove(edit: MemberEdit, slotIndex: number, moveId: string | null): MemberEdit {
  const moves = edit.moves.map((slot, index): MoveSlot => index !== slotIndex ? slot
    : moveId ? { moveId, origin: "manual", gameType: "Doubles" } : { moveId: null, origin: "empty", gameType: null }) as MoveSlots;
  return { ...edit, moves };
}

export function withItem(edit: MemberEdit, itemId: string): MemberEdit {
  return { ...edit, build: { ...edit.build, itemId } };
}

export function withAbility(edit: MemberEdit, abilityId: string): MemberEdit {
  return { ...edit, build: { ...edit.build, abilityId, abilityActive: defaultAbilityActive(abilityId) } };
}

export function withNature(edit: MemberEdit, nature: string): MemberEdit {
  return { ...edit, build: { ...edit.build, nature } };
}

export function withPoints(edit: MemberEdit, stat: BattleStat, value: number | null): MemberEdit {
  const build = edit.build;
  if (build.game !== "champions") return edit;
  return { ...edit, build: { ...build, points: { ...build.points, [stat]: value } } };
}

/** The other chosen members' items (Item Clause = 1): item id → member name. */
export function takenItems(members: readonly (TrainingMember | null)[], key: string): Map<string, string> {
  const taken = new Map<string, string>();
  for (const member of members) if (member && member.key !== key && member.build.itemId) taken.set(member.build.itemId, member.name);
  return taken;
}
