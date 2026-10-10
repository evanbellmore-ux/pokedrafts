import { chanceText } from "@/app/lib/battle/chance";
import { DOUBLES_SLOTS, duplicateNameParts, nameText, slotSide, type DoublesSideId, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { UNSEEN_MEMBER } from "../model/ai-inputs";
import type { BoardView, DecisionOption, DecisionReport, JointAction, LogTurn, MegaMechanic, SlotAction } from "../model/view-types";
import { boardNames, type BoardNames } from "../board/board-format";

// The AI's read and each turn's actions as facts. Each slot is named by its Pokémon when the turn's actions were chosen
// (LogTurn.names: the occupants as the board of the decision named them), so the names never change later; switches name
// the member.

const MEGA_TEXT: Record<MegaMechanic, string> = { mega: "Mega Evolution", megax: "Mega Evolution X", megay: "Mega Evolution Y" };

/** "—" in every slot: a turn whose Pokémon are not known. */
const UNKNOWN: BoardNames = { "own-left": "—", "own-right": "—", "opponent-left": "—", "opponent-right": "—" };

/**
 * Each slot's Pokémon when a turn's actions were chosen, by name as the board names it: the member `occupants` holds (its
 * name on `board`), with "(yours)" / "(opponent's)" when both teams have the name or both sides hold it, and "(1)" / "(2)"
 * when one side holds it twice; "—" for a slot without a known member.
 */
export function occupantNames(occupants: LogTurn["occupants"], board: BoardView | null): BoardNames {
  if (!occupants || !board) return { ...UNKNOWN };
  const base = Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const key = occupants[slot];
    return [slot, (key && board.team[slotSide(slot)].find((mon) => mon.key === key)?.name) || ""];
  })) as BoardNames;
  const parts = duplicateNameParts(base);
  return Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const key = occupants[slot];
    const side = parts[slot].side ?? (key && board.mirrored.includes(key) ? (slotSide(slot) === "own" ? "yours" : "opponent's") : null);
    return [slot, nameText({ ...parts[slot], side }) || "—"];
  })) as BoardNames;
}

/**
 * A turn's slot names for its read and actions: the names the worker gave them at the decision (LogTurn.names); without
 * them (a battle saved before they were recorded), its occupants on `decisionBoard` (the board its actions were chosen on:
 * a replay's boards.starts[turn]), else on `board`; without occupants, the active Pokémon of `decisionBoard`; else "—".
 */
export function turnNames(turn: Pick<LogTurn, "occupants" | "names">, board: BoardView | null, decisionBoard: BoardView | null = null): BoardNames {
  if (turn.names) return Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, turn.names![slot] || "—"])) as BoardNames;
  if (turn.occupants) return occupantNames(turn.occupants, decisionBoard ?? board);
  if (!decisionBoard) return { ...UNKNOWN };
  const names = boardNames(decisionBoard);
  return Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, names[slot] || "—"])) as BoardNames;
}

/** Where a move with this catalog target aims, from `actor`: "→ Abomasnow", "→ both foes", "" for self and field moves. */
function aimText(target: string | undefined, actor: DoublesSlotId, slot: DoublesSlotId | null, names: BoardNames) {
  switch (target) {
    case "normal": case "any": case "adjacentFoe": case "adjacentAllyOrSelf": case "adjacentAlly":
      return slot ? ` → ${slot === actor ? "itself" : names[slot] || "—"}` : "";
    case "allAdjacentFoes": return " → both foes";
    case "allAdjacent": return " → all adjacent";
    case "randomNormal": return " → a random foe";
    default: return "";
  }
}

export function memberName(board: BoardView | null, side: DoublesSideId, key: string) {
  if (key === UNSEEN_MEMBER) return "a Pokémon not seen yet";
  return board?.team[side].find((mon) => mon.key === key)?.name ?? "a benched Pokémon";
}

/** "Rock Slide → both foes", "Close Combat → Abomasnow (Mega Evolution)", "Protect", "Switch to Garchomp", "No action". */
export function slotActionText(slot: DoublesSlotId, action: SlotAction, board: BoardView | null, runtime: BattleRuntime, names: BoardNames = UNKNOWN) {
  if (action.kind === "pass") return "No action";
  if (action.kind === "switch") return `Switch to ${memberName(board, slotSide(slot), action.to)}`;
  const move = runtime.movesById.get(action.moveId);
  return `${move?.name ?? action.moveId}${aimText(move?.target, slot, action.target, names)}${action.mega ? ` (${MEGA_TEXT[action.mega]})` : ""}`;
}

/**
 * "Garchomp: Rock Slide → both foes · Gyarados: Protect", each slot by `names` (turnNames: its Pokémon at the decision);
 * "Not shown" for a redacted option.
 */
export function jointText(action: JointAction | null, board: BoardView | null, runtime: BattleRuntime, names: BoardNames = UNKNOWN) {
  if (!action) return "Not shown";
  const parts = DOUBLES_SLOTS.flatMap((slot) => {
    const each = action[slot];
    return each ? [`${names[slot] || "—"}: ${slotActionText(slot, each, board, runtime, names)}`] : [];
  });
  return parts.length ? parts.join(" · ") : "No action";
}

export function optionText(option: DecisionOption, board: BoardView | null, runtime: BattleRuntime, names: BoardNames = UNKNOWN) {
  return `${jointText(option.action, board, runtime, names)} · ${chanceText(option.chance)}`;
}

/** "Engine · 0.4 s · 10 × 6 pairings · Plays safe", "Jev · 0.6 s", "Engine (Jev unavailable)". */
export function providerText(report: DecisionReport) {
  const seconds = `${(Math.round(report.elapsedMs / 100) / 10).toFixed(1)} s`;
  const difficulty = report.difficulty === "reads" ? "Reads you" : "Plays safe";
  if (report.provider === "jev") return `Jev · ${seconds}`;
  if (report.provider === "engine-fallback") return `Engine (Jev unavailable) · ${seconds} · ${difficulty}`;
  return `Engine · ${seconds} · ${report.evaluated.its} × ${report.evaluated.yours} pairings · ${difficulty}`;
}

/** Turn 0: "Garchomp + Gyarados · 40%". */
export function leadsText(keys: readonly string[], chance: number, board: BoardView | null, names: (key: string) => string | null) {
  return `${keys.map((key) => names(key) ?? memberName(board, "own", key)).join(" + ")} · ${chanceText(chance)}`;
}

/** The predicted chance of what you did, as "(predicted 45%)", or "(not predicted)". */
export function actualText(report: DecisionReport) {
  if (!report.actual) return "";
  return report.actual.chance === null ? " (not predicted)" : ` (predicted ${chanceText(report.actual.chance)})`;
}
