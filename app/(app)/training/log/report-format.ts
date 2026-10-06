import { chanceText } from "@/app/lib/battle/chance";
import { DOUBLES_SLOTS, SLOT_POSITION, slotSide, type DoublesSideId, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { UNSEEN_MEMBER } from "../model/ai-inputs";
import type { BoardView, DecisionOption, DecisionReport, JointAction, MegaMechanic, SlotAction } from "../model/view-types";
import { capitalize } from "../board/board-format";

// The AI's read and each turn's actions as facts. Slots are named by position ("Your left"), as the turn's own lines
// above them name each Pokémon with its position; switches name the member.

const MEGA_TEXT: Record<MegaMechanic, string> = { mega: "Mega Evolution", megax: "Mega Evolution X", megay: "Mega Evolution Y" };

/** Where a move with this catalog target aims, from `actor`: "→ opponent's left", "→ both foes", "" for self and field moves. */
function aimText(target: string | undefined, actor: DoublesSlotId, slot: DoublesSlotId | null) {
  switch (target) {
    case "normal": case "any": case "adjacentFoe": case "adjacentAllyOrSelf": case "adjacentAlly":
      return slot ? ` → ${slot === actor ? "itself" : SLOT_POSITION[slot]}` : "";
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

/** "Rock Slide → both foes", "Close Combat → opponent's left (Mega Evolution)", "Protect", "Switch to Garchomp", "No action". */
export function slotActionText(slot: DoublesSlotId, action: SlotAction, board: BoardView | null, runtime: BattleRuntime) {
  if (action.kind === "pass") return "No action";
  if (action.kind === "switch") return `Switch to ${memberName(board, slotSide(slot), action.to)}`;
  const move = runtime.movesById.get(action.moveId);
  return `${move?.name ?? action.moveId}${aimText(move?.target, slot, action.target)}${action.mega ? ` (${MEGA_TEXT[action.mega]})` : ""}`;
}

/** "Your left: Rock Slide → both foes · Your right: Protect"; "Not shown" for a redacted option. */
export function jointText(action: JointAction | null, board: BoardView | null, runtime: BattleRuntime) {
  if (!action) return "Not shown";
  const parts = DOUBLES_SLOTS.flatMap((slot) => {
    const each = action[slot];
    return each ? [`${capitalize(SLOT_POSITION[slot])}: ${slotActionText(slot, each, board, runtime)}`] : [];
  });
  return parts.length ? parts.join(" · ") : "No action";
}

export function optionText(option: DecisionOption, board: BoardView | null, runtime: BattleRuntime) {
  return `${jointText(option.action, board, runtime)} · ${chanceText(option.chance)}`;
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
