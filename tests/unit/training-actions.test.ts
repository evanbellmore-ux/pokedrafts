import { act, createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installFakeDom, reactProps, type FakeDocument, type FakeElement } from "../fixtures/fake-dom";
import type { AIStatus, BoardView, PlayerChoice, TrainingPhase } from "@/app/(app)/training/model/view-types";
import type { TurnControlsArgs } from "@/app/(app)/training/actions/useTurnControls";
import { boardView, moveRequest, REQUEST_SIDE, runtime, switchRequest } from "../fixtures/training";

// Your controls, client-rendered in the fake DOM (tests/fixtures/fake-dom.ts): selections survive a re-render with the
// same request id (a rejected choice) and clear on a new one; the form submits a PlayerChoice.

type HarnessProps = Omit<TurnControlsArgs, "runtime">;
let document: FakeDocument;
let root: { render: (node: unknown) => void; unmount: () => void };
let Harness: FunctionComponent<HarnessProps>;
let useTurnControls: typeof import("@/app/(app)/training/actions/useTurnControls").useTurnControls;
const IDLE: AIStatus = { status: "idle" };

beforeAll(async () => {
  document = installFakeDom();
  const { createRoot } = await import("react-dom/client");
  ({ useTurnControls } = await import("@/app/(app)/training/actions/useTurnControls"));
  Harness = function Harness(props: HarnessProps) {
    const controls = useTurnControls({ runtime, ...props });
    return createElement("form", { ...controls.formProps, "data-harness": "" }, controls.renderSlot("own-left"), controls.renderSlot("own-right"), controls.submitBar);
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element) as unknown as typeof root;
});

afterAll(async () => {
  await act(async () => { root?.unmount(); });
});

async function show(phase: TrainingPhase, onSubmit = vi.fn(), board: BoardView = boardView(), ai: AIStatus = IDLE) {
  await act(async () => { root.render(createElement(Harness, { phase, board, ai, onSubmit })); });
  return onSubmit;
}
const fieldset = (slot: string) => document.querySelectorAll(`fieldset[data-training-action="${slot}"]`)[0];
const inputs = (scope: FakeElement) => scope.querySelectorAll("input");
function input(scope: FakeElement, value: string) {
  const found = inputs(scope).find((element) => reactProps(element).value === value || reactProps(element)["data-training-mechanic"] === value);
  if (!found) throw new Error(`No input ${value}.`);
  return found;
}
async function choose(element: FakeElement, checked = true) {
  await act(async () => { (reactProps(element).onChange as (event: unknown) => void)({ target: { checked, value: reactProps(element).value } }); });
}
async function submit() {
  const form = document.querySelectorAll("form[data-harness]")[0];
  await act(async () => { (reactProps(form).onSubmit as (event: unknown) => void)({ preventDefault() {} }); });
}
const text = (element: FakeElement | undefined) => element?.textContent ?? "";

describe("turn controls", () => {
  it("renders one fieldset per active Pokémon with its moves, switches and Mega Evolution", async () => {
    await show({ kind: "choose", request: moveRequest() });
    const left = fieldset("own-left");
    expect(text(left.querySelectorAll("legend")[0])).toBe("Garchomp (your left)");
    const radios = inputs(left).filter((element) => reactProps(element).type === "radio");
    expect(radios.map((element) => reactProps(element).value)).toEqual(["move:earthquake", "move:dragonclaw", "move:rockslide", "move:protect", "switch:own-incineroar"]);
    expect(new Set(radios.map((element) => reactProps(element).name)).size).toBe(1);
    expect(radios.filter((element) => reactProps(element).disabled).map((element) => reactProps(element).value)).toEqual(["move:dragonclaw", "move:protect"]);
    expect(text(left)).toContain("No PP");
    expect(text(left)).toContain("Both foes");
    expect(reactProps(input(left, "mega"))["aria-label"]).toBe("Mega Evolve Garchomp");
    expect(text(document.querySelectorAll("[data-training-submit-bar]")[0])).toContain("Garchomp: no action");
  });

  it("keeps selections for the same request id and clears them for a new one", async () => {
    await show({ kind: "choose", request: moveRequest() });
    await choose(input(fieldset("own-left"), "move:rockslide"));
    await choose(input(fieldset("own-right"), "move:waterfall"));
    expect(document.querySelectorAll('fieldset[data-training-target="own-right"]')).toHaveLength(1);
    await show({ kind: "choose", request: moveRequest(), error: "Can't move: Waterfall needs a target" });
    expect(reactProps(input(fieldset("own-left"), "move:rockslide")).checked).toBe(true);
    await show({ kind: "choose", request: moveRequest({ id: 8 }) });
    expect(reactProps(input(fieldset("own-left"), "move:rockslide")).checked).toBe(false);
  });

  it("allows one Mega Evolution, asks for a target, and submits a JointAction", async () => {
    const onSubmit = await show({ kind: "choose", request: moveRequest({ id: 20 }) });
    await choose(input(fieldset("own-left"), "move:rockslide"));
    await choose(input(fieldset("own-left"), "mega"));
    const partnerMega = input(fieldset("own-right"), "mega");
    expect(reactProps(partnerMega).disabled).toBe(true);
    expect(text(fieldset("own-right"))).toContain("Your left is Mega Evolving");
    await choose(input(fieldset("own-right"), "move:waterfall"));
    const bar = document.querySelectorAll("[data-training-submit-bar]")[0];
    expect(text(bar)).toContain("Waterfall: no target");
    const submitButton = bar.querySelectorAll("button")[0];
    expect(reactProps(submitButton).disabled).toBe(true);
    const target = document.querySelectorAll('fieldset[data-training-target="own-right"]')[0];
    expect(text(target)).toContain("Left foe");
    expect(text(target)).toContain("Ally");
    await choose(input(target, "opponent-right"));
    expect(text(document.querySelectorAll("[data-training-submit-bar]")[0])).toContain("Garchomp: Rock Slide → both foes · Mega Evolve");
    expect(text(document.querySelectorAll("[data-training-submit-bar]")[0])).toContain("Gyarados: Waterfall → Absol-Mega (right foe)");
    await submit();
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "action",
      action: { "own-left": { kind: "move", moveId: "rockslide", target: null, mega: "mega" }, "own-right": { kind: "move", moveId: "waterfall", target: "opponent-right" } },
    } satisfies PlayerChoice);
  });

  it("marks a Pokémon the other slot switches to, and trapped switches", async () => {
    await show({ kind: "choose", request: moveRequest({ id: 30, active: [{ ...moveRequest().active[0]!, trapped: true }, moveRequest().active[1]] }) });
    expect(reactProps(input(fieldset("own-left"), "switch:own-incineroar")).disabled).toBe(true);
    expect(text(fieldset("own-left"))).toContain("Trapped");
    await show({ kind: "choose", request: moveRequest({ id: 31 }) });
    await choose(input(fieldset("own-left"), "switch:own-incineroar"));
    expect(reactProps(input(fieldset("own-right"), "switch:own-incineroar")).disabled).toBe(true);
    expect(text(fieldset("own-right"))).toContain("Chosen for your left");
  });

  it("sends out replacements: end of turn, mid-turn, and No Pokémon left", async () => {
    const side = [{ ...REQUEST_SIDE[0], condition: "0 fnt" }, { ...REQUEST_SIDE[1], condition: "0 fnt" }, REQUEST_SIDE[2], REQUEST_SIDE[3]];
    const onSubmit = await show({ kind: "switch", request: switchRequest([true, true], false, side) });
    const legends = document.querySelectorAll("legend[data-training-replace-legend]").map(text);
    expect(legends).toEqual(["Replace Garchomp (your left)", "Replace Gyarados (your right)"]);
    expect(text(document.querySelectorAll('fieldset[data-training-replace="own-right"]')[0])).toContain("No Pokémon left");
    const left = document.querySelectorAll('fieldset[data-training-replace="own-left"]')[0];
    await choose(input(left, "own-incineroar"));
    expect(text(document.querySelectorAll("[data-training-submit-bar]")[0])).toContain("Incineroar (your left)");
    await submit();
    expect(onSubmit).toHaveBeenCalledWith({ kind: "action", action: { "own-left": { kind: "switch", to: "own-incineroar" }, "own-right": { kind: "pass" } } });
    await show({ kind: "switch", request: { ...switchRequest([true, false], true), id: 40 } });
    expect(document.querySelectorAll("legend[data-training-replace-legend]").map(text)).toEqual(["Switch in for Garchomp (your left)"]);
  });
});

describe("card frames as targets", () => {
  it("picks the target of the move being chosen by clicking the Pokémon's card", async () => {
    const { default: BattleBoard } = await import("@/app/(app)/training/board/BattleBoard");
    function BoardHarness(props: HarnessProps) {
      const controls = useTurnControls({ runtime, ...props });
      return createElement("form", { ...controls.formProps, "data-harness": "" },
        createElement(BattleBoard, { board: props.board, renderControls: controls.renderSlot, cardTarget: controls.cardTarget }), controls.submitBar);
    }
    const onSubmit = vi.fn();
    await act(async () => { root.render(createElement(BoardHarness, { phase: { kind: "choose", request: moveRequest({ id: 50 }) }, board: boardView(), ai: IDLE, onSubmit })); });
    const picks = () => document.querySelectorAll("button[data-training-card-pick]");
    expect(picks()).toHaveLength(0);
    // Rock Slide hits both foes: nothing to pick.
    await choose(input(fieldset("own-left"), "move:rockslide"));
    expect(picks()).toHaveLength(0);
    // Waterfall takes one target: both foes and the ally get a frame.
    await choose(input(fieldset("own-right"), "move:waterfall"));
    expect(picks().map((button) => reactProps(button)["data-training-card-pick"]).sort()).toEqual(["opponent-left", "opponent-right", "own-left"]);
    const left = picks().find((button) => reactProps(button)["data-training-card-pick"] === "opponent-left")!;
    expect(reactProps(left)["aria-label"]).toMatch(/^Target .+ \(left foe\) with Gyarados's Waterfall$/);
    expect(reactProps(left)["aria-pressed"]).toBe(false);
    await act(async () => { (reactProps(left).onClick as () => void)(); });
    const target = document.querySelectorAll('fieldset[data-training-target="own-right"]')[0];
    expect(reactProps(input(target, "opponent-left")).checked).toBe(true);
    const picked = picks().find((button) => reactProps(button)["data-training-card-pick"] === "opponent-left")!;
    expect(reactProps(picked)["aria-pressed"]).toBe(true);
    expect(document.querySelectorAll("p[data-training-card-chips]").map(text)).toEqual(["Target of Gyarados's Waterfall"]);
    expect(text(document.querySelectorAll("[data-training-submit-bar]")[0])).toMatch(/Gyarados: Waterfall → .+ \(left foe\)/);
    // A second click on another frame changes it; choosing the radio still works too.
    const right = picks().find((button) => reactProps(button)["data-training-card-pick"] === "opponent-right")!;
    await act(async () => { (reactProps(right).onClick as () => void)(); });
    expect(reactProps(input(document.querySelectorAll('fieldset[data-training-target="own-right"]')[0], "opponent-right")).checked).toBe(true);
    await submit();
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "action",
      action: { "own-left": { kind: "move", moveId: "rockslide", target: null }, "own-right": { kind: "move", moveId: "waterfall", target: "opponent-right" } },
    } satisfies PlayerChoice);
  });
});

describe("waiting", () => {
  it("shows the simulation or the AI's status instead of controls", async () => {
    const { useTurnControls: hook } = await import("@/app/(app)/training/actions/useTurnControls");
    function Waiting({ ai, reason }: { ai: AIStatus; reason: "simulating" | "opponent-switch" }) {
      const controls = hook({ runtime, board: boardView(), phase: { kind: "waiting", reason }, ai, onSubmit: () => undefined });
      return createElement("div", null, controls.renderSlot("own-left"), controls.submitBar);
    }
    expect(renderToStaticMarkup(createElement(Waiting, { ai: IDLE, reason: "simulating" }))).toContain("Simulating turn 3…");
    expect(renderToStaticMarkup(createElement(Waiting, { ai: { status: "thinking" }, reason: "simulating" }))).toContain("AI choosing…");
    expect(renderToStaticMarkup(createElement(Waiting, { ai: IDLE, reason: "opponent-switch" }))).toContain("Opponent choosing a replacement…");
  });
});
