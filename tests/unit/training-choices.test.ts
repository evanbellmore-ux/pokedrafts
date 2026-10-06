import { describe, expect, it } from "vitest";
import { UNSEEN_MEMBER } from "@/app/(app)/training/model/ai-inputs";
import type { ShowdownRequest } from "@/app/(app)/training/model/showdown-types";
import { jointActionKey, type JointAction } from "@/app/(app)/training/model/view-types";
import { ChoiceBuildError, identName, legalJointActions, teamChoice, toChoiceString } from "@/app/(app)/training/sim/choices";
import { memberKeys, toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { Battle, State } from "@/app/(app)/training/sim/sim";
import { AI_TEAM, PLAYER_TEAM, runtime } from "./training-sim-fixtures";
import { createChooser } from "../../scripts/lib/showdown-sim/fixtures.mjs";

// SPEC §7.4: JointAction → choice strings, and legalJointActions, against the pinned simulator.

const FORMAT = "gen9championsvgc2026regmc";
const own = toShowdownTeam(PLAYER_TEAM.members, runtime), opponent = toShowdownTeam(AI_TEAM.members, runtime);
const keys = memberKeys(own, opponent);

const pokemon = (side: "p1" | "p2", name: string, active: boolean, condition = "100/100") =>
  ({ ident: `${side}: ${name}`, details: name, condition, active, stats: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, moves: [], baseAbility: "", item: "" });
type ActiveList = Extract<ShowdownRequest, { active: unknown }>["active"];
const moveRequest = (side: "p1" | "p2", names: string[], active: ActiveList): ShowdownRequest =>
  ({ active, side: { name: side === "p1" ? "You" : "Training", id: side, pokemon: names.map((name, i) => pokemon(side, name, i < 2)) } });

const p1Move = moveRequest("p1", ["Incineroar", "Charizard", "Whimsicott", "Garchomp"], [
  { moves: [{ move: "Fake Out", id: "fakeout", target: "normal", pp: 10, maxpp: 10 }, { move: "Protect", id: "protect", target: "self", pp: 10, maxpp: 10 }, { move: "Helping Hand", id: "helpinghand", target: "adjacentAlly" }, { move: "Acupressure", id: "acupressure", target: "adjacentAllyOrSelf" }] },
  { moves: [{ move: "Heat Wave", id: "heatwave", target: "allAdjacentFoes" }, { move: "Air Slash", id: "airslash", target: "any" }, { move: "Tailwind", id: "tailwind", target: "allySide" }, { move: "Earthquake", id: "earthquake", target: "allAdjacent" }], canMegaEvoY: true },
]);

describe("toChoiceString", () => {
  it("writes targets for the choosable types only (pinned sim/battle-actions.ts:3, sim/side.ts:671)", () => {
    expect(toChoiceString("p1", { "own-left": { kind: "move", moveId: "fakeout", target: "opponent-right" }, "own-right": { kind: "move", moveId: "heatwave", target: null } }, p1Move, keys, "p2"))
      .toBe("move 1 1, move 1");
    expect(toChoiceString("p1", { "own-left": { kind: "move", moveId: "fakeout", target: "opponent-left" }, "own-right": { kind: "move", moveId: "airslash", target: "own-left" } }, p1Move, keys, "p2"))
      .toBe("move 1 2, move 2 -1");
    // adjacentAlly: the ally without a chosen target; adjacentAllyOrSelf: self is -1 for position 0.
    expect(toChoiceString("p1", { "own-left": { kind: "move", moveId: "helpinghand", target: null }, "own-right": { kind: "move", moveId: "tailwind", target: null } }, p1Move, keys, "p2"))
      .toBe("move 3 -2, move 3");
    expect(toChoiceString("p1", { "own-left": { kind: "move", moveId: "acupressure", target: "own-left" }, "own-right": { kind: "move", moveId: "earthquake", target: null } }, p1Move, keys, "p2"))
      .toBe("move 4 -1, move 4");
    expect(() => toChoiceString("p1", { "own-left": { kind: "move", moveId: "fakeout", target: null }, "own-right": { kind: "move", moveId: "heatwave", target: null } }, p1Move, keys, "p2"))
      .toThrow("Fake Out: no target");
    expect(() => toChoiceString("p1", { "own-left": { kind: "move", moveId: "fakeout", target: "opponent-left" } }, p1Move, keys, "p2"))
      .toThrow(ChoiceBuildError);
  });

  it("mirrors p2: its position 0 is opponent-right, and your left is target 1", () => {
    const p2 = moveRequest("p2", ["Gyarados", "Pelipper", "Sneasler", "Archaludon"], [
      { moves: [{ move: "Waterfall", id: "waterfall", target: "normal" }], canMegaEvo: true },
      { moves: [{ move: "Hurricane", id: "hurricane", target: "any" }] },
    ]);
    const action: JointAction = { "opponent-right": { kind: "move", moveId: "waterfall", target: "own-left", mega: "mega" }, "opponent-left": { kind: "move", moveId: "hurricane", target: "own-right" } };
    expect(toChoiceString("p2", action, p2, keys, "p2")).toBe("move 1 1 mega, move 1 2");
    // aiSide "p1": the AI's own slots are p1's (evaluation self-play).
    expect(toChoiceString("p1", { "opponent-right": { kind: "move", moveId: "fakeout", target: "own-left" }, "opponent-left": { kind: "move", moveId: "airslash", target: "opponent-right" } }, p1Move, keys, "p1"))
      .toBe("move 1 1, move 2 -1");
  });

  it("allows at most one Mega Evolution, only where the request offers it", () => {
    expect(toChoiceString("p1", { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "heatwave", target: null, mega: "megay" } }, p1Move, keys, "p2"))
      .toBe("move 2, move 1 megay");
    expect(() => toChoiceString("p1", { "own-left": { kind: "move", moveId: "protect", target: null, mega: "mega" }, "own-right": { kind: "move", moveId: "heatwave", target: null } }, p1Move, keys, "p2"))
      .toThrow("Incineroar cannot Mega Evolve");
    const both = moveRequest("p2", ["Gyarados", "Pelipper"], [{ moves: [{ move: "Protect", id: "protect", target: "self" }], canMegaEvo: true }, { moves: [{ move: "Protect", id: "protect", target: "self" }], canMegaEvo: true }]);
    expect(() => toChoiceString("p2", { "opponent-right": { kind: "move", moveId: "protect", target: null, mega: "mega" }, "opponent-left": { kind: "move", moveId: "protect", target: null, mega: "mega" } }, both, keys, "p2"))
      .toThrow("is Mega Evolving");
  });

  it("switches by this request's side order, never twice to one Pokémon, passes for fainted actives", () => {
    const reordered = moveRequest("p1", ["Garchomp", "Charizard", "Whimsicott", "Incineroar"], [{ moves: [{ move: "Protect", id: "protect", target: "self" }] }, { moves: [{ move: "Protect", id: "protect", target: "self" }] }]);
    expect(toChoiceString("p1", { "own-left": { kind: "switch", to: "incineroar" }, "own-right": { kind: "switch", to: "whimsicott" } }, reordered, keys, "p2"))
      .toBe("switch 4, switch 3");
    expect(() => toChoiceString("p1", { "own-left": { kind: "switch", to: "incineroar" }, "own-right": { kind: "switch", to: "incineroar" } }, reordered, keys, "p2"))
      .toThrow("Incineroar is chosen for both");
    expect(() => toChoiceString("p1", { "own-left": { kind: "switch", to: UNSEEN_MEMBER }, "own-right": { kind: "pass" } }, reordered, keys, "p2")).toThrow(ChoiceBuildError);
    const fainted: ShowdownRequest = { ...reordered, side: { ...reordered.side, pokemon: reordered.side.pokemon.map((p, i) => (i === 0 ? { ...p, condition: "0 fnt" } : p)) } };
    expect(toChoiceString("p1", { "own-right": { kind: "move", moveId: "protect", target: null } }, fainted, keys, "p2")).toBe("pass, move 1");
  });

  it("writes forced switches and team orders", () => {
    const forced: ShowdownRequest = { forceSwitch: [false, true], side: { name: "You", id: "p1", pokemon: ["Incineroar", "Charizard", "Whimsicott", "Garchomp"].map((name, i) => pokemon("p1", name, i < 2, i === 1 ? "0 fnt" : "100/100")) } };
    expect(toChoiceString("p1", { "own-right": { kind: "switch", to: "garchomp" } }, forced, keys, "p2")).toBe("pass, switch 4");
    expect(teamChoice([3, 1, 5, 2])).toBe("team 3152");
    expect(identName("p2a: Rotom-Wash")).toBe("Rotom-Wash");
  });
});

describe("legalJointActions", () => {
  it("enumerates moves × targets, one Mega per side, distinct switches, Fake Out on the first turn only", () => {
    const base = { side: "p1" as const, aiSide: "p2" as const, request: p1Move, bench: ["whimsicott", "garchomp"], megaUsed: false, keys };
    const first = legalJointActions({ ...base, firstTurn: [true, true] });
    const later = legalJointActions({ ...base, firstTurn: [false, true] });
    const keysOf = (list: JointAction[]) => new Set(list.map(jointActionKey));
    expect(first.some((a) => a["own-left"]?.kind === "move" && a["own-left"].moveId === "fakeout")).toBe(true);
    expect(later.some((a) => a["own-left"]?.kind === "move" && a["own-left"].moveId === "fakeout")).toBe(false);
    expect(first.every((a) => Object.values(a).filter((s) => s?.kind === "move" && s.mega).length <= 1)).toBe(true);
    expect(first.some((a) => a["own-right"]?.kind === "move" && a["own-right"].mega === "megay")).toBe(true);
    expect(first.some((a) => a["own-left"]?.kind === "switch" && a["own-right"]?.kind === "switch" && a["own-left"].to === a["own-right"].to)).toBe(false);
    expect(keysOf(first).size).toBe(first.length);
    // Fake Out into either foe or the ally (normal), Air Slash into three (any), Heat Wave without a target.
    expect(first.filter((a) => a["own-left"]?.kind === "move" && a["own-left"].moveId === "fakeout" && a["own-right"]?.kind === "move" && a["own-right"].moveId === "heatwave" && !a["own-right"].mega).map((a) => (a["own-left"] as { target: string }).target).sort())
      .toEqual(["opponent-left", "opponent-right", "own-right"]);
    const noMega = legalJointActions({ ...base, firstTurn: [true, true], megaUsed: true });
    expect(noMega.some((a) => Object.values(a).some((s) => s?.kind === "move" && s.mega))).toBe(false);
    const absent = legalJointActions({ ...base, firstTurn: [true, true], present: { "opponent-left": false } });
    expect(absent.some((a) => a["own-left"]?.kind === "move" && a["own-left"].target === "opponent-left")).toBe(false);
  });

  it("offers at most one unseen-member switch per joint action and passes on an exhausted forced switch", () => {
    const list = legalJointActions({ side: "p1", aiSide: "p2", request: p1Move, bench: ["garchomp", UNSEEN_MEMBER], firstTurn: [false, false], megaUsed: true, keys });
    expect(list.some((a) => a["own-left"]?.kind === "switch" && a["own-left"].to === UNSEEN_MEMBER)).toBe(true);
    expect(list.some((a) => a["own-left"]?.kind === "switch" && a["own-right"]?.kind === "switch" && a["own-left"].to === UNSEEN_MEMBER && a["own-right"].to === UNSEEN_MEMBER)).toBe(false);
    const forced: ShowdownRequest = { forceSwitch: [true, true], side: { name: "You", id: "p1", pokemon: ["Incineroar", "Charizard", "Whimsicott", "Garchomp"].map((name, i) => pokemon("p1", name, i < 2, i < 2 || i === 2 ? "0 fnt" : "100/100")) } };
    const replacements = legalJointActions({ side: "p1", aiSide: "p2", request: forced, bench: ["whimsicott", "garchomp"], firstTurn: [false, false], megaUsed: true, keys });
    expect(replacements.map(jointActionKey).sort()).toEqual(["own-left=pass;own-right=switch:garchomp", "own-left=switch:garchomp;own-right=pass"]);
  });

  it("every string it returns is accepted by the pinned simulator on a clone (6 battles, both sides)", () => {
    let checked = 0, decisions = 0;
    const rejected: string[] = [];
    for (let k = 0; k < 6; k++) {
      const choose = createChooser(k + 40);
      const battle = new Battle({ formatid: FORMAT, seed: [k + 40, 2, 3, 4] });
      battle.setPlayer("p1", { name: "You", team: structuredClone(own.sets.map((s) => s.set)) });
      battle.setPlayer("p2", { name: "Training", team: structuredClone(opponent.sets.map((s) => s.set)) });
      let guard = 0;
      while (!battle.ended && guard++ < 120) {
        const json = JSON.stringify(State.serializeBattle(battle));
        for (const side of ["p1", "p2"] as const) {
          const request = battle[side].activeRequest as ShowdownRequest | null;
          if (!request || "wait" in request || "teamPreview" in request) continue;
          decisions++;
          const bench = request.side.pokemon.map((p) => keys.keyOf(side, identName(p.ident)));
          const firstTurn = battle[side].active.map((p) => !!p && p.activeMoveActions === 0);
          const actions = legalJointActions({ side, aiSide: "p2", request, bench, firstTurn, megaUsed: false, keys });
          expect(actions.length, `${side} turn ${battle.turn}`).toBeGreaterThan(0);
          const step = Math.max(1, Math.floor(actions.length / 25));
          let clone = State.deserializeBattle(json);
          for (let i = 0; i < actions.length; i += step) {
            const text = toChoiceString(side, actions[i], request, keys, "p2");
            if (clone[side].choice.cantUndo || clone.requestState !== battle.requestState || clone.turn !== battle.turn) clone = State.deserializeBattle(json);
            clone.restart(() => {});
            if (!clone.choose(side, text)) rejected.push(`${side} turn ${battle.turn}: ${text} (${clone[side].choice.error})`);
            checked++;
          }
        }
        battle.makeChoices(choose("p1", battle.p1.activeRequest), choose("p2", battle.p2.activeRequest));
      }
    }
    expect(rejected).toEqual([]);
    expect(decisions).toBeGreaterThan(100);
    expect(checked).toBeGreaterThan(2000);
  }, 120_000);
});
