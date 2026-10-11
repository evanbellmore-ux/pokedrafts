/** Moves whose damage is fixed or HP-based, so no power boost changes it. */
export const FIXED_DAMAGE_MOVES = new Set(["seismictoss", "nightshade", "dragonrage", "sonicboom", "finalgambit", "guardianofalola", "superfang", "naturesmadness", "ruination", "endeavor"]);

const FUTURE_MOVES = new Set(["futuresight", "doomdesire"]);
const EXPLOSIVE_MOVES = new Set(["explosion", "selfdestruct", "mistyexplosion", "mindblown"]);

/** Moves that double their power when the user moves before its target (pinned Showdown basePowerCallback: the target switched in or will still move). */
export const MOVES_FIRST_POWER_MOVES = new Set(["boltbeak", "fishiousrend"]);

/**
 * The turn-order question a move asks, if any, answered by MoveContext.turnOrder: "analytic" when an
 * Analytic user's boost depends on moving last, "first" when Bolt Beak or Fishious Rend doubles for
 * moving before the target. Analytic's own condition (the target switches out) already decides it.
 */
export function turnOrderQuestion(
  move: { id: string; category: string }, source: { abilityId: string; abilityActive: boolean; itemId?: string }, converted: boolean,
  battle: { opponentAbilityId?: string; magicRoom?: boolean; gameType?: "Singles" | "Doubles" } = {},
): "analytic" | "first" | null {
  if (MOVES_FIRST_POWER_MOVES.has(move.id) && !converted) return "first";
  if (source.abilityId !== "analytic" || move.category === "Status") return null;
  // Its condition settles it in Singles; in Doubles the other two Pokémon still decide it.
  if (source.abilityActive && battle.gameType !== "Doubles") return null;
  // A Z-Move or Max Move made from a fixed-damage move is an ordinary attack.
  if (FIXED_DAMAGE_MOVES.has(move.id) && !converted) return null;
  // Future Sight and Doom Desire always land after every Pokémon has moved.
  if (!converted && FUTURE_MOVES.has(move.id)) return null;
  // The target's Neutralizing Gas suppresses Analytic; Damp stops an explosion.
  if (battle.opponentAbilityId === "neutralizinggas" && !(source.itemId === "abilityshield" && !battle.magicRoom)) return null;
  if (!converted && EXPLOSIVE_MOVES.has(move.id) && (battle.opponentAbilityId === "damp")) return null;
  return "analytic";
}
