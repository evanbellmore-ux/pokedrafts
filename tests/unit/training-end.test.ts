import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import BattleEnd from "@/app/(app)/training/end/BattleEnd";
import { emptyHabits } from "@/app/(app)/training/model/habits-data";
import type { TrainingBattle } from "@/app/(app)/training/model/view-types";
import { capture, textOf } from "../fixtures/jsx-capture";
import { boardView, logTurns, trainingSetup } from "../fixtures/training";

vi.mock("react/jsx-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));
vi.mock("react/jsx-dev-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));

function ended(result: "win" | "loss" | "tie", forfeited = false): TrainingBattle {
  return {
    id: 1, setup: trainingSetup(), seed: "sodium,1a2b3c4d", phase: { kind: "ended", result, forfeited },
    board: boardView({ turn: 7 }), log: logTurns(), ai: { status: "idle" }, lastPreview: null, habitsBefore: emptyHabits(), savedId: "saved-1", startedAt: 0,
  };
}

describe("battle end", () => {
  it.each([["win", false, "You won"], ["loss", false, "The AI won"], ["tie", false, "Tie"], ["loss", true, "You forfeited"]] as const)("%s (forfeited %s) reads %s", (result, forfeited, heading) => {
    const html = renderToStaticMarkup(createElement(BattleEnd, { battle: ended(result, forfeited), onRematch: () => undefined, onChangeTeams: () => undefined, logText: "", habits: emptyHabits() }));
    expect(html).toMatch(new RegExp(`<h2[^>]*tabindex="-1"[^>]*>${heading}</h2>`));
    expect(html).toContain("data-training-end");
  });

  it("states turns, Pokémon left and the seed, and offers Rematch, Change teams and Copy log", () => {
    const onRematch = vi.fn();
    const onChangeTeams = vi.fn();
    const { result: html, elements } = capture(() => renderToStaticMarkup(createElement(BattleEnd, { battle: ended("win"), onRematch, onChangeTeams, logText: "Start", habits: emptyHabits() })));
    expect(html).toContain("7 turns · You: 3 left · AI: 4 left · Seed sodium,1a2b3c4d");
    const buttons = elements.filter((element) => element.type === "button");
    expect(buttons.map((button) => textOf(button.props.children))).toEqual(["Rematch", "Change teams", "Copy log"]);
    (buttons[0].props.onClick as () => void)();
    (buttons[1].props.onClick as () => void)();
    expect(onRematch).toHaveBeenCalledOnce();
    expect(onChangeTeams).toHaveBeenCalledOnce();
  });

  it("renders nothing before the end", () => {
    const html = renderToStaticMarkup(createElement(BattleEnd, { battle: { ...ended("win"), phase: { kind: "waiting", reason: "simulating" } }, onRematch: () => undefined, onChangeTeams: () => undefined, logText: "", habits: emptyHabits() }));
    expect(html).toBe("");
  });
});
