import { describe, expect, it } from "vitest";
import { BattleHost } from "@/app/(app)/training/sim/battle-host";
import { identName, teamChoice, toChoiceString, type MemberKeys } from "@/app/(app)/training/sim/choices";
import { normalizeRequest } from "@/app/(app)/training/sim/requests";
import { memberKeys, toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import {
  buildMoveAction, buildSwitchAction, OWN_SLOTS, replaceSlots, slotOptions, type SlotSelection,
} from "@/app/(app)/training/actions/choice-builder";
import { buildTeamOrder } from "@/app/(app)/training/preview/preview-order";
import { TRAINING_FORMAT_ID, type BoardView, type JointAction, type MoveRequest, type PokemonView, type SwitchRequest } from "@/app/(app)/training/model/view-types";
import type { ShowdownRequest } from "@/app/(app)/training/model/showdown-types";
import { OPPONENT_MEMBERS, OWN_MEMBERS, runtime } from "../fixtures/training";

// Every JointAction the turn controls build is a choice the pinned simulator accepts, once the worker converts it with
// sim/choices.ts toChoiceString (SPEC C7: one path to Showdown), checked on a clone of the live battle (BattleHost.checkChoice).

function view(key: string, ident: string, slot: PokemonView["slot"], fainted: boolean): PokemonView {
  return {
    key, ident, side: slot?.startsWith("opponent") ? "opponent" : "own", slot, speciesId: "", name: identName(ident), types: [],
    hp: { kind: "percent", percent: fainted ? 0 : 100 }, fainted, status: "", boosts: {}, volatiles: [], item: { state: "unknown" },
    ability: null, nature: null, points: null, moves: [], mega: false, revealed: true, brought: true,
  };
}

/** The board the worker would post, reduced to what the controls read: keys, idents, who is active and fainted. */
function boardFrom(p1: ShowdownRequest, p2: ShowdownRequest | null, keys: MemberKeys, turn: number, megaUsed: boolean): BoardView {
  const own = p1.side.pokemon.map((pokemon, index) => view(keys.keyOf("p1", identName(pokemon.ident)), `p1: ${identName(pokemon.ident)}`,
    pokemon.active ? OWN_SLOTS[index] ?? null : null, pokemon.condition.endsWith(" fnt")));
  const foes = (p2?.side.pokemon ?? []).map((pokemon, index) => view(keys.keyOf("p2", identName(pokemon.ident)), `p2: ${identName(pokemon.ident)}`,
    pokemon.active ? (index === 0 ? "opponent-right" : "opponent-left") : null, pokemon.condition.endsWith(" fnt")));
  const at = (slot: string) => [...own, ...foes].find((mon) => mon.slot === slot) ?? null;
  return {
    turn, team: { own, opponent: foes },
    active: { "own-left": at("own-left"), "own-right": at("own-right"), "opponent-left": at("opponent-left"), "opponent-right": at("opponent-right") },
    field: { weather: null, terrain: null, rooms: [], sides: { own: [], opponent: [] } }, megaUsed: { own: megaUsed, opponent: false },
  };
}

/** Every selection pair the controls allow for a move request: each move (and target, and Mega) or switch per slot. */
function moveSelections(request: MoveRequest, board: BoardView): SlotSelection[][] {
  const per = OWN_SLOTS.map((_, index) => {
    const options = slotOptions(request, board, index as 0 | 1, runtime);
    if (options.passes) return [{ choice: null, target: null, mega: null } as SlotSelection];
    const list: SlotSelection[] = [];
    for (const move of options.moves) {
      if (move.disabledReason) continue;
      const targets = move.rule.kind === "choose" && move.rule.options.length > 1 ? move.rule.options : [null];
      for (const target of targets) {
        list.push({ choice: { kind: "move", moveId: move.id }, target, mega: null });
        for (const mega of options.mega) list.push({ choice: { kind: "move", moveId: move.id }, target, mega });
      }
    }
    for (const option of options.switches) if (!option.disabledReason) list.push({ choice: { kind: "switch", key: option.key }, target: null, mega: null });
    return list;
  });
  return per[0].flatMap((left) => per[1].map((right) => [left, right]));
}

describe("turn controls → toChoiceString → the pinned simulator", () => {
  it("accepts every action the controls can build, over a whole battle (preview, moves, Mega, targets, switches, replacements)", () => {
    // Your Garchomp holds its Mega Stone, so Mega Evolution is a choice on your side too.
    const members = OWN_MEMBERS.map((member, index) => index ? member : { ...member, build: { ...member.build, itemId: "garchompite" } });
    const own = toShowdownTeam(members, runtime);
    const opponent = toShowdownTeam(OPPONENT_MEMBERS, runtime);
    expect(Object.values(own.problems).flat()).toEqual([]);
    const keys = memberKeys(own, opponent);
    const host = new BattleHost({ formatid: TRAINING_FORMAT_ID, seed: [11, 22, 33, 44], p1: { name: "You", team: own.sets.map((entry) => entry.set) }, p2: { name: "Training", team: opponent.sets.map((entry) => entry.set) } });
    host.drain();
    expect(host.choose("p1", teamChoice(buildTeamOrder([2, 0, 1, 3]))).ok).toBe(true);
    expect(host.choose("p2", "team 1234").ok).toBe(true);
    host.drain();
    const seen = { move: 0, switch: 0, mega: 0, target: 0, swaps: 0, replacements: 0 };
    for (let step = 0; step < 80 && !host.battle.ended; step++) {
      const p1 = host.request("p1");
      const p2 = host.request("p2");
      if (host.needsChoice("p2")) host.choose("p2", "default");
      if (!p1 || "wait" in p1 || !host.needsChoice("p1")) { host.drain(); continue; }
      const request = normalizeRequest(p1, host.battle, host.requestId);
      const board = boardFrom(p1, p2, keys, host.battle.turn, false);
      const snapshot = host.snapshot();
      const accepted: JointAction[] = [];
      if (request.kind === "move") {
        for (const selections of moveSelections(request, board)) {
          const built = buildMoveAction(request, board, selections, runtime);
          if ("missing" in built) continue;
          const choice = toChoiceString("p1", built.action, p1, keys, "p2");
          const check = host.checkChoice("p1", choice, snapshot);
          expect(check, `${choice} (${JSON.stringify(built.action)})`).toEqual({ ok: true });
          accepted.push(built.action);
          for (const each of Object.values(built.action)) {
            if (each?.kind === "move") { seen.move++; if (each.mega) seen.mega++; if (each.target) seen.target++; }
            if (each?.kind === "switch") seen.switch++;
          }
        }
      } else if (request.kind === "switch") {
        const slots = replaceSlots(request as SwitchRequest, board);
        const options = slots.find((slot) => slot.flagged)?.options ?? [];
        for (const first of options) {
          for (const second of [null, ...options]) {
            const picks = slots.map((slot) => slot.flagged ? (slot === slots.find((each) => each.flagged) ? first.key : second?.key ?? null) : null);
            const built = buildSwitchAction(request as SwitchRequest, board, picks);
            if ("missing" in built) continue;
            const choice = toChoiceString("p1", built.action, p1, keys, "p2");
            expect(host.checkChoice("p1", choice, snapshot), choice).toEqual({ ok: true });
            accepted.push(built.action);
            seen.replacements++;
          }
        }
        if (request.midTurn) seen.swaps++;
      }
      expect(accepted.length, `request ${request.kind} at turn ${host.battle.turn}`).toBeGreaterThan(0);
      // Play a switch-heavy line so replacements come up: Parting Shot when offered, else the first accepted action.
      const pick = accepted.find((action) => Object.values(action).some((each) => each?.kind === "move" && each.moveId === "partingshot")) ?? accepted[0];
      expect(host.choose("p1", toChoiceString("p1", pick, p1, keys, "p2")).ok).toBe(true);
      host.drain();
    }
    expect(seen.move).toBeGreaterThan(100);
    expect(seen.mega).toBeGreaterThan(0);
    expect(seen.target).toBeGreaterThan(0);
    expect(seen.switch).toBeGreaterThan(0);
    expect(seen.replacements).toBeGreaterThan(0);
  }, 60_000);
});
