import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SetEditor, { type SetEditorProps } from "@/app/(app)/training/setup/SetEditor";
import {
  editOf, editorMoveList, filterMoves, moveOptionText, natureLabel, pointsIssues, takenItems, withAbility, withMove, withPoints,
} from "@/app/(app)/training/setup/set-editor";
import type { MoveOptionsState } from "@/app/(app)/training/model/view-types";
import { capture, textOf } from "../fixtures/jsx-capture";
import { OWN_MEMBERS, runtime } from "../fixtures/training";

vi.mock("react/jsx-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));
vi.mock("react/jsx-dev-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));

// Addendum A1.3: every legal move (status moves included) from the worker's validator, usage order first, then A–Z.
const READY: MoveOptionsState = {
  status: "ready",
  moves: [
    { id: "earthquake", weight: 0.95 }, { id: "protect", weight: 0.81 }, { id: "rockslide", weight: 0.62 }, { id: "dragonclaw", weight: 0.41 },
    { id: "swordsdance", weight: 0.12 }, { id: "helpinghand", weight: null }, { id: "sandstorm", weight: null }, { id: "stealthrock", weight: null },
  ],
};

const garchomp = OWN_MEMBERS[0];

function render(props: Partial<SetEditorProps> = {}) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  const { result: html, elements } = capture(() => renderToStaticMarkup(createElement(SetEditor, {
    member: garchomp, runtime, moveOptions: READY, takenItems: new Map([["sitrusberry", "Gyarados"]]), canReset: false, onChange, onReset, ...props,
  })));
  return { html, elements, onChange, onReset };
}

describe("set editor helpers", () => {
  it("orders the worker's legal moves usage first, then A–Z, and falls back to the catalog learnset", () => {
    const list = editorMoveList(READY, "garchomp", runtime);
    expect(list.status).toBe("ready");
    expect(list.usage.map((move) => move.id)).toEqual(["earthquake", "protect", "rockslide", "dragonclaw", "swordsdance"]);
    expect(list.other.map((move) => move.name)).toEqual(["Helping Hand", "Sandstorm", "Stealth Rock"]);
    const fallback = editorMoveList({ status: "error", message: "Validator failed." }, "garchomp", runtime);
    expect(fallback).toMatchObject({ status: "fallback", message: "Validator failed.", usage: [] });
    const names = fallback.other.map((move) => move.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(names).toContain("Protect");
    expect(editorMoveList(undefined, "garchomp", runtime).status).toBe("loading");
  });

  it("filters by name and keeps the slot's move; formats usage and natures as facts", () => {
    const list = editorMoveList(READY, "garchomp", runtime);
    expect(filterMoves(list.usage, "sword", null).map((move) => move.id)).toEqual(["swordsdance"]);
    expect(filterMoves(list.usage, "Sword", "protect").map((move) => move.id)).toEqual(["protect", "swordsdance"]);
    expect(filterMoves(list.other, "stealth-rock", null).map((move) => move.id)).toEqual(["stealthrock"]);
    expect(moveOptionText(list.usage[1])).toBe("Protect · 81%");
    expect(moveOptionText(list.other[0])).toBe("Helping Hand");
    expect(natureLabel("Adamant")).toBe("Adamant (+Atk −SpA)");
    expect(natureLabel("Hardy")).toBe("Hardy");
  });

  it("checks Champions Stat Points: 32 per stat, 66 in total, whole numbers", () => {
    expect(pointsIssues({ hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 })).toEqual([]);
    expect(pointsIssues({ hp: 33, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 })).toEqual(["At most 32 Stat Points per stat.", "At most 66 Stat Points in total (97)."]);
    expect(pointsIssues({ hp: null, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 })).toEqual(["Stat Points are whole numbers from 0."]);
  });

  it("edits one field at a time", () => {
    const edit = editOf(garchomp);
    expect(withMove(edit, 3, "swordsdance").moves.map((slot) => slot.moveId)).toEqual(["earthquake", "dragonclaw", "rockslide", "swordsdance"]);
    expect(withMove(edit, 0, null).moves[0]).toEqual({ moveId: null, origin: "empty", gameType: null });
    expect(withAbility(edit, "sandveil").build).toMatchObject({ abilityId: "sandveil", abilityActive: false });
    const points = withPoints(edit, "hp", 10).build;
    expect(points.game === "champions" && points.points.hp).toBe(10);
    expect(garchomp.build.game === "champions" && garchomp.build.points.hp).toBe(2);
    expect([...takenItems(OWN_MEMBERS, garchomp.key).keys()]).toContain("sitrusberry");
    expect(takenItems(OWN_MEMBERS, garchomp.key).has("lifeorb")).toBe(false);
  });
});

describe("set editor", () => {
  it("offers every legal move, status moves included, in four searchable pickers", () => {
    const { html, elements } = render();
    const selects = elements.filter((element) => element.type === "select" && element.props["data-training-move-slot"] !== undefined);
    expect(selects).toHaveLength(4);
    expect(html).toContain("Search moves");
    expect(html).toContain('<optgroup label="Usage">');
    expect(html).toContain('<optgroup label="Other legal moves">');
    for (const text of ["Protect · 81%", "Swords Dance · 12%", "Helping Hand", "Stealth Rock", "No move"]) expect(html).toContain(text);
    // A move in one slot is disabled in the others (sim/showdown-set.ts would merge duplicates).
    expect(html).toMatch(/<option value="earthquake" disabled="">Earthquake · 95%<\/option>/);
    expect(html).toMatch(/<option value="earthquake" selected="">Earthquake · 95%<\/option>/);
  });

  it("edits item (Item Clause shown), ability, nature and Stat Points", () => {
    const { html, elements, onChange } = render({ canReset: true });
    expect(html).toContain('<option value="">No item</option>');
    expect(html).toContain("Sitrus Berry · on Gyarados");
    expect(html).toMatch(/<option value="roughskin" selected="">Rough Skin<\/option><option value="sandveil">Sand Veil<\/option>/);
    expect(html).toContain("Adamant (+Atk −SpA)");
    expect(html).toContain("66 / 66");
    expect(elements.filter((element) => element.type === "input" && String(element.props["aria-label"] ?? "").includes("Stat Points"))).toHaveLength(6);
    const slot = elements.find((element) => element.type === "select" && element.props["data-training-move-slot"] === 3)!;
    (slot.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "swordsdance" } });
    expect(onChange.mock.calls[0][0].moves.map((each: { moveId: string | null }) => each.moveId)).toEqual(["earthquake", "dragonclaw", "rockslide", "swordsdance"]);
    const item = elements.find((element) => element.type === "select" && element.props["data-training-item"])!;
    (item.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "" } });
    expect(onChange.mock.calls[1][0].build.itemId).toBe("");
    const reset = elements.find((element) => element.type === "button" && textOf(element.props.children).includes("Reset set"));
    expect(reset).toBeDefined();
  });

  it("reports Stat Point problems and the move list's state as facts", () => {
    const over = { ...garchomp, build: garchomp.build.game === "champions" ? { ...garchomp.build, points: { hp: 32, atk: 32, def: 32, spa: 0, spd: 0, spe: 0 } } : garchomp.build };
    const { html } = render({ member: over, moveOptions: { status: "loading" } });
    expect(html).toContain("At most 66 Stat Points in total (96).");
    expect(html).toContain("Loading legal moves…");
    expect(render({ moveOptions: { status: "error", message: "Validator failed." } }).html).toContain("Legal moves unavailable: Validator failed. · Showing the catalog learnset.");
    expect(render().html).not.toContain("Reset set");
  });

  it("shows a form's required item as a fact instead of a picker", () => {
    const mega = { ...garchomp, speciesId: "charizardmegay", name: "Charizard-Mega-Y", build: { ...garchomp.build, speciesId: "charizardmegay", itemId: "charizarditey", abilityId: "drought" } };
    const { html, elements } = render({ member: mega });
    expect(html).toContain("Charizardite Y · Required");
    expect(elements.some((element) => element.type === "select" && element.props["data-training-item"])).toBe(false);
  });
});
