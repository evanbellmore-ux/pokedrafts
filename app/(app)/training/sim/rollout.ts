// One sampled turn on a reseeded copy of a belief battle (SPEC §9.4 "rollout"): Showdown plays every hit, miss, crit
// and added effect; mid-turn replacements are the AI's policy for its side and, for the player's side, the healthiest
// living bench member of that world. It stops at the next decision (the end-of-turn request or the end).
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { MonKey, ReplacePolicy } from "../model/ai-view";
import { slotAt } from "../model/positions";
import type { SideID } from "../model/showdown-types";
import { identName, type MemberKeys } from "./choices";
import { keyOfPokemon } from "./bridge";
import { isMidTurn } from "./requests";
import { PRNG, State, type ClonedBattle, type PRNGSeed } from "./sim";

export type RolloutResult = { battle: ClonedBattle; replacements: number; error: string | null };

function replacementChoice(battle: ClonedBattle, side: SideID, aiSide: SideID, keys: MemberKeys, replace: ReplacePolicy): string | null {
  const request = battle[side].activeRequest;
  if (!request || !("forceSwitch" in request)) return null;
  const pokemon = request.side.pokemon;
  const bench = pokemon.map((each, index) => ({ each, index })).filter(({ each }) => !each.active && !each.condition.endsWith(" fnt"));
  const flagged = request.forceSwitch.map((flag, position) => (flag ? position : -1)).filter((position) => position >= 0);
  const engineSide = side === aiSide ? "opponent" : "own";
  let picks: number[];
  if (side === aiSide) {
    const options = bench.map(({ each }) => `opponent:${keys.keyOf(side, identName(each.ident))}` as MonKey);
    const slots = flagged.map((position) => slotAt(side, position, aiSide));
    const chosen = replace(engineSide, slots, options);
    picks = chosen.map((key) => bench.find(({ each }) => `opponent:${keys.keyOf(side, identName(each.ident))}` === key)?.index ?? -1);
  } else {
    // The player's side: its healthiest living bench members (by HP share), deterministic.
    const byHealth = [...bench].sort((a, b) => health(b.each.condition) - health(a.each.condition) || a.index - b.index);
    picks = byHealth.map(({ index }) => index);
  }
  const used = new Set<number>();
  return request.forceSwitch.map((flag) => {
    if (!flag) return "pass";
    const pick = picks.find((index) => index >= 0 && !used.has(index));
    if (pick === undefined) return "pass";
    used.add(pick);
    return `switch ${pick + 1}`;
  }).join(", ");
}
const health = (condition: string) => { const [hp, max] = condition.split(" ")[0].split("/").map(Number); return max ? hp / max : 0; };

/** Plays `choices` on a reseeded copy of `json` until the next decision. */
export function runRollout(json: string, choices: { p1: string; p2: string }, seed: string, ctx: { aiSide: SideID; keys: MemberKeys; replace: ReplacePolicy }): RolloutResult {
  const battle = State.deserializeBattle(json);
  battle.restart(() => {});
  battle.prng = new PRNG(`sodium,${seed}` as PRNGSeed);
  let replacements = 0;
  try {
    battle.makeChoices(choices.p1, choices.p2);
    // Mid-turn replacements (U-turn, Parting Shot, Eject Button/Pack, Red Card) continue the same turn. An end-of-turn
    // replacement after a faint is the next decision, as in the engine's cells (midTurn is true there too: isMidTurn).
    for (let guard = 0; isMidTurn(battle) && battle.requestState === "switch" && !battle.ended && guard < 8; guard++) {
      replacements++;
      const p1 = replacementChoice(battle, "p1", ctx.aiSide, ctx.keys, ctx.replace) ?? "";
      const p2 = replacementChoice(battle, "p2", ctx.aiSide, ctx.keys, ctx.replace) ?? "";
      battle.makeChoices(p1, p2);
    }
    return { battle, replacements, error: null };
  } catch (error) {
    return { battle, replacements, error: String((error as Error)?.message ?? error).slice(0, 120) };
  }
}

/** Slot of each active Pokémon after the turn, engine orientation (fainted ones keep their slot). */
export function activeSlots(battle: ClonedBattle, aiSide: SideID, keys: MemberKeys): Map<MonKey, DoublesSlotId> {
  const slots = new Map<MonKey, DoublesSlotId>();
  for (const side of ["p1", "p2"] as const) {
    battle[side].active.forEach((mon, position) => { if (mon) slots.set(keyOfPokemon(mon, aiSide, keys), slotAt(side, position, aiSide)); });
  }
  return slots;
}
