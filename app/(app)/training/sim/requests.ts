// A pinned Showdown request (sim/side.ts:64-164) → the page's TrainingRequest (SPEC §7.6). Copies, never the live object.
import type { ShowdownRequest } from "../model/showdown-types";
import type { TrainingRequest } from "../model/view-types";

/**
 * Is a replacement request mid-turn (U-turn, Parting Shot, Eject Button/Pack)? turnLoop keeps `midTurn` true at every
 * replacement request, the end-of-turn ones included (pinned sim/battle.ts:2943-2956); a mid-turn one still has the turn's
 * actions queued (at least its residual), while fainted Pokémon are replaced only once the queue is empty (runAction).
 */
export function isMidTurn(battle: { readonly midTurn: boolean }): boolean {
  const queue = (battle as { readonly queue?: { readonly list?: readonly unknown[] } }).queue;
  return battle.midTurn && (!queue?.list || queue.list.length > 0);
}

/** `battle` is read for midTurn only (isMidTurn). */
export function normalizeRequest(request: ShowdownRequest, battle: { readonly midTurn: boolean }, requestId: number): TrainingRequest {
  const side = structuredClone(request.side.pokemon);
  if ("teamPreview" in request) return { kind: "team-preview", id: requestId, maxChosenTeamSize: request.maxChosenTeamSize ?? 4, side };
  if ("forceSwitch" in request) return { kind: "switch", id: requestId, forceSwitch: [...request.forceSwitch], midTurn: isMidTurn(battle), side };
  if ("active" in request) return { kind: "move", id: requestId, active: structuredClone(request.active).map((each) => each ?? null), side };
  return { kind: "wait", id: requestId, side };
}
