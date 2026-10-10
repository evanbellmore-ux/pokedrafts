import { describe, expect, it } from "vitest";
import { requestTargetRule } from "@/app/(app)/training/actions/request-targets";
import {
  buildMoveAction, buildSwitchAction, EMPTY_SELECTION, megaBlockedBy, replaceSlots, slotOptions, type SlotSelection,
} from "@/app/(app)/training/actions/choice-builder";
import { conditionText } from "@/app/(app)/training/actions/condition";
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { boardView, moveRequest, REQUEST_SIDE, runtime, switchRequest } from "../fixtures/training";

const all = () => true;
const move = (moveId: string, target: DoublesSlotId | null = null, mega: SlotSelection["mega"] = null): SlotSelection => ({ choice: { kind: "move", moveId }, target, mega });
const switchTo = (key: string): SlotSelection => ({ choice: { kind: "switch", key }, target: null, mega: null });

describe("request target rules (pinned sim/battle.ts validTargetLoc, sim/side.ts:664,671)", () => {
  it("lets you pick only for normal, any, adjacentFoe and adjacentAllyOrSelf", () => {
    expect(requestTargetRule("normal", "own-left", all)).toEqual({ kind: "choose", options: ["opponent-left", "opponent-right", "own-right"] });
    expect(requestTargetRule("any", "own-right", all)).toEqual({ kind: "choose", options: ["opponent-left", "opponent-right", "own-left"] });
    expect(requestTargetRule("adjacentFoe", "own-left", all)).toEqual({ kind: "choose", options: ["opponent-left", "opponent-right"] });
    expect(requestTargetRule("adjacentAllyOrSelf", "own-left", all)).toEqual({ kind: "choose", options: ["own-right", "own-left"] });
    expect(requestTargetRule("allAdjacentFoes", "own-left", all)).toEqual({ kind: "auto", hits: ["opponent-left", "opponent-right"] });
    expect(requestTargetRule("allAdjacent", "own-left", all)).toEqual({ kind: "auto", hits: ["opponent-left", "opponent-right", "own-right"] });
    expect(requestTargetRule("randomNormal", "own-left", all)).toEqual({ kind: "auto", hits: ["opponent-left", "opponent-right"], random: true });
    expect(requestTargetRule("self", "own-left", all)).toEqual({ kind: "none", scope: "self" });
    expect(requestTargetRule("allySide", "own-left", all)).toEqual({ kind: "none", scope: "own-side" });
    expect(requestTargetRule("normal", "own-left", (slot) => slot !== "opponent-left")).toEqual({ kind: "choose", options: ["opponent-right", "own-right"] });
  });
});

describe("move requests to JointActions", () => {
  const board = boardView();

  it("reads moves, PP, disabled moves, Mega and switches from the request", () => {
    const left = slotOptions(moveRequest(), board, 0, runtime);
    expect(left.name).toBe("Garchomp");
    expect(left).not.toHaveProperty("label");
    expect(left.moves.map((each) => [each.id, each.disabledReason])).toEqual([["earthquake", null], ["dragonclaw", "No PP"], ["rockslide", null], ["protect", "Disabled"]]);
    expect(left.moves[0]).toMatchObject({ type: "Ground", pp: 8, maxpp: 8, rule: { kind: "auto" } });
    expect(left.mega).toEqual(["mega"]);
    expect(left.switches).toEqual([{ key: "own-incineroar", ident: "p1: Incineroar", name: "Incineroar", condition: "202/202", disabledReason: null }]);
    const trapped = slotOptions(moveRequest({ active: [{ ...moveRequest().active[0]!, trapped: true }, moveRequest().active[1]] }), board, 0, runtime);
    expect(trapped.switches[0].disabledReason).toBe("Trapped");
    expect(slotOptions(moveRequest(), boardView({ megaUsed: { own: true, opponent: true } }), 0, runtime).mega).toEqual([]);
  });

  it("builds moves with targets, spreads without, a Mega and a switch", () => {
    expect(buildMoveAction(moveRequest(), board, [move("rockslide", null, "mega"), move("waterfall", "opponent-right")], runtime)).toEqual({
      action: {
        "own-left": { kind: "move", moveId: "rockslide", target: null, mega: "mega" },
        "own-right": { kind: "move", moveId: "waterfall", target: "opponent-right" },
      },
    });
    expect(buildMoveAction(moveRequest(), board, [switchTo("own-incineroar"), move("protect")], runtime)).toEqual({
      action: { "own-left": { kind: "switch", to: "own-incineroar" }, "own-right": { kind: "move", moveId: "protect", target: null } },
    });
  });

  it("names what is missing as facts", () => {
    expect(buildMoveAction(moveRequest(), board, [EMPTY_SELECTION, move("waterfall")], runtime)).toEqual({ missing: ["Garchomp: no action", "Waterfall: no target"] });
    expect(buildMoveAction(moveRequest(), board, [move("dragonclaw"), move("waterfall", "opponent-left")], runtime)).toEqual({ missing: ["Garchomp: no action"] });
    expect(buildMoveAction(moveRequest(), board, [switchTo("own-incineroar"), switchTo("own-incineroar")], runtime)).toEqual({ missing: ["Incineroar is chosen for both"] });
    expect(buildMoveAction(moveRequest(), board, [move("rockslide", null, "mega"), move("protect", null, "mega")], runtime)).toEqual({ missing: ["Garchomp is Mega Evolving"] });
    expect(megaBlockedBy([move("rockslide", null, "mega"), EMPTY_SELECTION], 1, ["Garchomp", "Gyarados"])).toBe("Garchomp is Mega Evolving");
    expect(megaBlockedBy([EMPTY_SELECTION, move("waterfall", "opponent-left", "mega")], 0, ["Garchomp", "Gyarados"])).toBe("Gyarados is Mega Evolving");
    expect(megaBlockedBy([switchTo("own-incineroar"), EMPTY_SELECTION], 1, ["Garchomp", "Gyarados"])).toBeNull();
  });

  it("aims a single-option choose move at its only target and passes a fainted or commanding slot", () => {
    const oneFoe = boardView({ active: { ...boardView().active, "opponent-left": { ...boardView().active["opponent-left"]!, fainted: true }, "own-right": { ...boardView().active["own-right"]!, fainted: true } } });
    const fainted = moveRequest({ side: [REQUEST_SIDE[0], { ...REQUEST_SIDE[1], condition: "0 fnt" }, ...REQUEST_SIDE.slice(2)] });
    expect(buildMoveAction(fainted, oneFoe, [move("rockslide"), EMPTY_SELECTION], runtime)).toEqual({ action: { "own-left": { kind: "move", moveId: "rockslide", target: null }, "own-right": { kind: "pass" } } });
    const single = moveRequest({ active: [{ moves: [{ move: "Dragon Claw", id: "dragonclaw", pp: 4, maxpp: 12, target: "adjacentFoe" }] }, moveRequest().active[1]], side: fainted.side });
    expect(buildMoveAction(single, oneFoe, [move("dragonclaw"), EMPTY_SELECTION], runtime)).toEqual({ action: { "own-left": { kind: "move", moveId: "dragonclaw", target: "opponent-right" }, "own-right": { kind: "pass" } } });
    const commanding = moveRequest({ side: [{ ...REQUEST_SIDE[0], commanding: true }, ...REQUEST_SIDE.slice(1)] });
    expect(buildMoveAction(commanding, board, [EMPTY_SELECTION, move("protect")], runtime)).toEqual({ action: { "own-left": { kind: "pass" }, "own-right": { kind: "move", moveId: "protect", target: null } } });
    const helping = moveRequest({ active: [{ moves: [{ move: "Helping Hand", id: "helpinghand", pp: 8, maxpp: 8, target: "adjacentAlly" }] }, moveRequest().active[1]] });
    expect(buildMoveAction(helping, board, [move("helpinghand"), move("protect")], runtime)).toMatchObject({ action: { "own-left": { moveId: "helpinghand", target: "own-right" } } });
  });
});

describe("forced and mid-turn replacements", () => {
  const board = boardView();
  const side = [REQUEST_SIDE[0], { ...REQUEST_SIDE[1], condition: "0 fnt" }, REQUEST_SIDE[2], REQUEST_SIDE[3]];

  it("switches the flagged slot and passes the others", () => {
    expect(buildSwitchAction(switchRequest([false, true], false, side), board, [null, "own-incineroar"])).toEqual({ action: { "own-left": { kind: "pass" }, "own-right": { kind: "switch", to: "own-incineroar" } } });
    expect(buildSwitchAction(switchRequest([true, false], true, side), board, ["own-incineroar", null])).toEqual({ action: { "own-left": { kind: "switch", to: "own-incineroar" }, "own-right": { kind: "pass" } } });
    expect(buildSwitchAction(switchRequest([false, true], false, side), board, [null, null])).toEqual({ missing: ["Gyarados: no action"] });
  });

  it("passes a flagged slot once the living bench is used up (pinned sim/side.ts:936)", () => {
    const both = switchRequest([true, true], false, [{ ...REQUEST_SIDE[0], condition: "0 fnt" }, { ...REQUEST_SIDE[1], condition: "0 fnt" }, REQUEST_SIDE[2], REQUEST_SIDE[3]]);
    expect(replaceSlots(both, board).map((slot) => slot.options.map((option) => option.key))).toEqual([["own-incineroar"], ["own-incineroar"]]);
    expect(buildSwitchAction(both, board, ["own-incineroar", null])).toEqual({ action: { "own-left": { kind: "switch", to: "own-incineroar" }, "own-right": { kind: "pass" } } });
  });

  it("words a request Pokémon's condition", () => {
    expect(conditionText("177/177")).toBe("177 / 177 HP");
    expect(conditionText("88/177 par")).toBe("88 / 177 HP · Paralyzed");
    expect(conditionText("0 fnt")).toBe("Fainted");
  });
});
