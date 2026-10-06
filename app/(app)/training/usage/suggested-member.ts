// Addendum A1.2: a worker SuggestedSet as the TrainingMember Setup shows and the battle uses (the calculator's build shape).
// Page-safe: no usage data, simulator or engine imports.
import { createBuild, withUsualAbility } from "@/app/lib/battle/model";
import type { MoveSlot, MoveSlots } from "@/app/lib/battle/move-defaults";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { showdownNature } from "../model/sets";
import type { SuggestedSet } from "../model/usage";
import type { TrainingMember } from "../model/view-types";

/**
 * createBuild's fresh Champions build with the set's ability (abilityActive as the calculator defaults it), item, nature and
 * Stat Points, nature through showdownNature; moves as MoveSlots: "usage" (Champions Doubles usage) for a usage set, "suggested"
 * for the calculator's fill and the Protect the rule added.
 */
export function suggestedMember(set: SuggestedSet, extra: { name: string; spriteName?: string }, runtime: BattleRuntime = championsRuntime): TrainingMember {
  const fresh = createBuild(set.speciesId, runtime);
  if (fresh.game !== "champions") throw new Error("Training suggested sets are Champions builds.");
  const build = showdownNature({ ...withUsualAbility(fresh, set.abilityId), itemId: set.itemId, nature: set.nature, points: { ...set.points } });
  const slot = (index: number): MoveSlot => {
    const moveId = set.moves[index] ?? null;
    if (!moveId) return { moveId: null, origin: "empty", gameType: null };
    const added = set.protectAdded && moveId === "protect";
    return { moveId, origin: set.source === "usage" && !added ? "usage" : "suggested", gameType: "Doubles" };
  };
  const moves: MoveSlots = [slot(0), slot(1), slot(2), slot(3)];
  return {
    key: set.key, name: extra.name, speciesId: set.speciesId, build, moves, origin: "suggested",
    suggestion: { source: set.source, protectAdded: set.protectAdded },
    ...(extra.spriteName ? { spriteName: extra.spriteName } : {}),
  };
}
