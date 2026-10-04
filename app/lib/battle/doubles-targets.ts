import { allyOf, foesOf, type DoublesSlotId, type DoublesTargetRule, type DoublesTurnInput } from "./doubles-types";

// The 2v2 tab's target rules, as the game asks for them when a move is chosen (pinned Showdown sim/side.ts chooseMove and
// sim/battle.ts validTargetLoc). No engine imports: the target pickers render before the engine chunk loads
// (resolve-move.ts is the engine-only boundary).

/**
 * Pinned Showdown's dex target types (data/moves.ts `target`) and what a doubles player is asked: "choose" for the
 * types validTargetLoc lets a player pick (normal, any, adjacentFoe, adjacentAllyOrSelf; sim/battle.ts:2399-2431), the
 * hit list for the spread types (sim/pokemon.ts getMoveTargets: allAdjacent hits the adjacent ally too), one living foe
 * at random for randomNormal (sim/battle.ts getRandomTarget), the ally for adjacentAlly (doubles has one ally, so the
 * choice is automatic), and no Pokémon target for the self, side, field and team types and for scripted (Counter,
 * Mirror Coat, Metal Burst: the last Pokémon that hit the user).
 */
const NO_TARGET: Record<string, Extract<DoublesTargetRule, { kind: "none" }>["scope"]> = {
  self: "self", allies: "self-and-ally", allySide: "own-side", foeSide: "foe-side", all: "field", allyTeam: "own-team", scripted: "last-attacker",
};

/** The dex target types that can reach a foe: with both foes gone, a move of one of them has no target (doublesTargetRule). */
const FOE_TARGETS: ReadonlySet<string> = new Set(["normal", "any", "adjacentFoe", "allAdjacentFoes", "allAdjacent", "randomNormal"]);

/** The dex target type of the move `slot` would use for `moveId` (doublesTargetRule), or null with no Pokémon or no such move. */
function targetType(input: DoublesTurnInput, slot: DoublesSlotId, moveId: string): string | null {
  const entry = input.pokemon[slot];
  const move = input.runtime.movesById.get(moveId);
  if (!entry || !move) return null;
  const dynamaxed = entry.build.mechanic === "dynamax" || entry.build.mechanic === "gigantamax";
  const useZ = entry.contexts[moveId]?.useZ === true && move.category !== "Status";
  const crystal = useZ ? input.runtime.itemsById.get(entry.build.itemId) : undefined;
  const signature = crystal?.zMove && crystal.zMoveFrom === moveId ? input.runtime.movesById.get(crystal.zMove) : undefined;
  return dynamaxed ? (move.category === "Status" ? "self" : "adjacentFoe") : useZ ? signature?.target ?? "normal" : move.target;
}

/**
 * Whether `slot`'s move aims at the foes while both foe slots are empty (fainted with no replacement): the battle is
 * over, so the turn gives it no target and no step (doubles-turn.ts).
 */
export function doublesNoFoeLeft(input: DoublesTurnInput, slot: DoublesSlotId, moveId: string): boolean {
  const type = targetType(input, slot, moveId);
  return type !== null && FOE_TARGETS.has(type) && foesOf(slot).every((foe) => input.pokemon[foe] === null);
}

/**
 * The target rule for `moveId` from `slot` (SPEC §3.3): the dex target, or the Z-Move's / Max Move's ("adjacentFoe"; a
 * status move is Max Guard, self). A damaging Z-Move has its own dex target (pinned Showdown getActiveZMove): a
 * signature Z-Crystal's Z-Move (zMoveFrom) its own, Clangorous Soulblaze's allAdjacentFoes (data/moves.ts
 * clangoroussoulblaze), and every type Z-Move normal; a Max Move targets one foe (getActiveMaxMove: adjacentFoe; Max
 * Guard, self). Expanding Force and Tera Starstorm ask for one target here, as in the game: they spread when they run.
 * An empty slot (null: a Pokémon that fainted with no replacement) is never an option or a hit, as pinned Showdown's
 * allies(), foes() and adjacency skip a fainted Pokémon (sim/side.ts allies, sim/pokemon.ts isAdjacent); with both foe
 * slots empty, a move that can reach a foe has no target at all (doublesNoFoeLeft).
 */
export function doublesTargetRule(input: DoublesTurnInput, slot: DoublesSlotId, moveId: string): DoublesTargetRule {
  const target = targetType(input, slot, moveId);
  if (target === null) return { kind: "none", scope: "self" };
  const [left, right] = foesOf(slot);
  const ally = allyOf(slot);
  const noFoe = doublesNoFoeLeft(input, slot, moveId);
  const present = (list: DoublesSlotId[]) => noFoe ? [] : list.filter((each) => input.pokemon[each] !== null);
  switch (target) {
    case "normal":
    case "any":
      return { kind: "choose", options: present([left, right, ally]) };
    case "adjacentFoe":
      return { kind: "choose", options: present([left, right]) };
    case "adjacentAllyOrSelf":
      return { kind: "choose", options: present([ally, slot]) };
    case "adjacentAlly":
      return { kind: "auto", hits: present([ally]) };
    case "allAdjacentFoes":
      return { kind: "auto", hits: present([left, right]) };
    case "allAdjacent":
      return { kind: "auto", hits: present([left, right, ally]) };
    case "randomNormal":
      return { kind: "auto", hits: present([left, right]), random: true };
    default:
      return { kind: "none", scope: NO_TARGET[target] ?? "self" };
  }
}

/** For "choose": `current` when it is an option, else `preferred` when it is, else options[0]; null for "auto" and "none". */
export function defaultDoublesTarget(rule: DoublesTargetRule, current: DoublesSlotId | null, preferred: DoublesSlotId | null): DoublesSlotId | null {
  if (rule.kind !== "choose") return null;
  if (current && rule.options.includes(current)) return current;
  if (preferred && rule.options.includes(preferred)) return preferred;
  return rule.options[0] ?? null;
}
