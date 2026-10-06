import { allyOf, foesOf, type DoublesSlotId, type DoublesTargetRule } from "@/app/lib/battle/doubles-types";

// Target rules keyed by the Showdown request's own target string (pinned sim/side.ts:64-164 move data), so a locked move,
// Struggle or Recharge is read as the request states it. Same table as the 2v2 tab's doublesTargetRule
// (app/lib/battle/doubles-targets.ts): a player picks a target only for normal, any, adjacentFoe and adjacentAllyOrSelf
// (sim/battle.ts:2399-2431 validTargetLoc; sim/side.ts:664,671 "needs a target" / "can't choose a target").

const NO_TARGET: Record<string, Extract<DoublesTargetRule, { kind: "none" }>["scope"]> = {
  self: "self", allies: "self-and-ally", allySide: "own-side", foeSide: "foe-side", all: "field",
  allyTeam: "own-team", scripted: "last-attacker",
};

/** The request target types that take a target location in the choice string. */
export const CHOOSE_TARGETS: ReadonlySet<string> = new Set(["normal", "any", "adjacentFoe", "adjacentAlly", "adjacentAllyOrSelf"]);

export function requestTargetRule(target: string | undefined, actor: DoublesSlotId, present: (slot: DoublesSlotId) => boolean): DoublesTargetRule {
  const [left, right] = foesOf(actor);
  const ally = allyOf(actor);
  const living = (slots: DoublesSlotId[]) => slots.filter(present);
  switch (target) {
    case "normal":
    case "any":
      return { kind: "choose", options: living([left, right, ally]) };
    case "adjacentFoe":
      return { kind: "choose", options: living([left, right]) };
    case "adjacentAllyOrSelf":
      return { kind: "choose", options: living([ally, actor]) };
    case "adjacentAlly":
      return { kind: "auto", hits: living([ally]) };
    case "allAdjacentFoes":
      return { kind: "auto", hits: living([left, right]) };
    case "allAdjacent":
      return { kind: "auto", hits: living([left, right, ally]) };
    case "randomNormal":
      return { kind: "auto", hits: living([left, right]), random: true };
    default:
      return { kind: "none", scope: (target && NO_TARGET[target]) || "self" };
  }
}

/** The slot a choose rule aims at without a pick: its only option. */
export function onlyTarget(rule: DoublesTargetRule): DoublesSlotId | null {
  return rule.kind === "choose" && rule.options.length === 1 ? rule.options[0] : null;
}
