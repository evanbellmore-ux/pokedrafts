// model/positions.ts
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
/** Showdown side and position of an engine slot when the AI is `aiSide`; equals SHOWDOWN_POSITION (doubles-types.ts:40) for "p2". */
export function showdownPosition(slot: DoublesSlotId, aiSide: "p1" | "p2"): { side: "p1" | "p2"; position: 0 | 1 } {
  const other = aiSide === "p2" ? "p1" : "p2";
  switch (slot) {
    case "own-left": return { side: other, position: 0 };
    case "own-right": return { side: other, position: 1 };
    case "opponent-right": return { side: aiSide, position: 0 };
    case "opponent-left": return { side: aiSide, position: 1 };
  }
}
export function slotAt(side: "p1" | "p2", position: number, aiSide: "p1" | "p2"): DoublesSlotId {
  return side === aiSide ? (position === 0 ? "opponent-right" : "opponent-left") : (position === 0 ? "own-left" : "own-right");
}
/** Choice-string target location of `target` as seen by an actor on `actorSide` (pinned sim/pokemon.ts:770-789). */
export function targetLoc(target: DoublesSlotId, actorSide: "p1" | "p2", aiSide: "p1" | "p2"): -2 | -1 | 1 | 2 {
  const { side, position } = showdownPosition(target, aiSide);
  return (side === actorSide ? -(position + 1) : position + 1) as -2 | -1 | 1 | 2;
}
