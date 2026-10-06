// The end of turn with no moves (SPEC C13, §9.4 "residual"): one copy of belief world 0 whose runAction skips every
// move, played with Showdown's default choices, so the residual phase (Leftovers, weather, burn and poison, Grassy
// Terrain, Leech Seed, Salt Cure, Wish, Future Sight …) runs exactly. Prototype: design probe/residual-probe.mjs.
import type { MonKey } from "../model/ai-view";
import type { SideID } from "../model/showdown-types";
import { keyOfPokemon } from "./bridge";
import type { MemberKeys } from "./choices";
import { PRNG, State, type BattleAction, type PRNGSeed } from "./sim";

/** HP change of each Pokémon active now (positive heals); {} when the battle is not at a move request. */
export function runResidual(json: string, seed: string, ctx: { aiSide: SideID; keys: MemberKeys }): Record<MonKey, number> {
  const battle = State.deserializeBattle(json);
  battle.restart(() => {});
  if (battle.requestState !== "move") return {};
  battle.prng = new PRNG(`sodium,${seed}` as PRNGSeed);
  const before = new Map<MonKey, number>();
  for (const side of ["p1", "p2"] as const) for (const mon of battle[side].active) if (mon && !mon.fainted) before.set(keyOfPokemon(mon, ctx.aiSide, ctx.keys), mon.hp);
  const runAction = battle.runAction.bind(battle);
  battle.runAction = (action: BattleAction) => { if (action.choice !== "move") runAction(action); };
  try {
    battle.makeChoices();
  } catch {
    return {};
  }
  const out: Record<MonKey, number> = {};
  for (const side of ["p1", "p2"] as const) {
    for (const mon of battle[side].pokemon) {
      const key = keyOfPokemon(mon, ctx.aiSide, ctx.keys);
      const start = before.get(key);
      if (start !== undefined) out[key] = mon.hp - start;
    }
  }
  return out;
}
