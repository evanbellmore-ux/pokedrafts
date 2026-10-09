// Conformance gate 4b's reading of a played turn (status-eot EOT-5): the Pokémon each engine slot held as the turn
// started, followed through the turn. E2's outcomes are keyed by the slot a Pokémon started in; after an Ally Switch
// (pinned sim/battle.ts swapPosition) the side's two stand swapped, so reading HP by position would compare one
// Pokémon's range with its partner's HP.
import type { ClonedBattle } from "@pokedrafts/showdown-sim";
import { DOUBLES_SLOTS, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { SideID } from "@/app/(app)/training/model/showdown-types";

type Active = NonNullable<ClonedBattle["p1"]["active"][number]>;

/** The Pokémon in each engine slot as the turn starts (engine "own" is the player, the other side of `aiSide`). */
export function startingMons(battle: ClonedBattle, aiSide: SideID): Partial<Record<DoublesSlotId, Active>> {
  const out: Partial<Record<DoublesSlotId, Active>> = {};
  for (const slot of DOUBLES_SLOTS) {
    const side = slot.startsWith("own") ? (aiSide === "p2" ? "p1" : "p2") : aiSide;
    const position = slot === "own-left" ? 0 : slot === "own-right" ? 1 : slot === "opponent-right" ? 0 : 1;
    const mon = battle[side].active[position];
    if (mon) out[slot] = mon;
  }
  return out;
}

/** Each starting slot's Pokémon's HP now, wherever it stands. */
export function startingHP(started: Partial<Record<DoublesSlotId, Active>>): Partial<Record<DoublesSlotId, number>> {
  const out: Partial<Record<DoublesSlotId, number>> = {};
  for (const slot of DOUBLES_SLOTS) {
    const mon = started[slot];
    if (mon) out[slot] = mon.hp;
  }
  return out;
}
