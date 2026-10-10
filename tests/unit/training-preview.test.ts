import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installFakeDom, reactProps, type FakeDocument, type FakeElement } from "../fixtures/fake-dom";
import { buildTeamOrder, fromTeamOrder, orderLabel, previewSummary, swapLeads, toggleBrought } from "@/app/(app)/training/preview/preview-order";
import OpponentSheet, { sheetFacts } from "@/app/(app)/training/preview/OpponentSheet";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO, OPEN_TEAM_SHEETS, PERFECT_INFORMATION } from "@/app/(app)/training/model/info";
import { redactSheet, sheetFromTeam } from "@/app/(app)/training/model/sheet";
import type { TeamPreviewProps } from "@/app/(app)/training/preview/TeamPreview";
import { PREVIEW_REQUEST, runtime, trainingSetup } from "../fixtures/training";

describe("preview order (pinned Showdown `team 3152`: tap order, the first two lead)", () => {
  it("adds, removes, caps and swaps", () => {
    expect(toggleBrought([], 2)).toEqual([2]);
    expect(toggleBrought([2, 0, 4, 1], 3)).toEqual([2, 0, 4, 1]);
    expect(toggleBrought([2, 0, 4, 1], 0)).toEqual([2, 4, 1]);
    expect(swapLeads([2, 0, 4, 1])).toEqual([0, 2, 4, 1]);
    expect(orderLabel([2, 0, 4, 1], 2)).toBe("Lead");
    expect(orderLabel([2, 0, 4, 1], 0)).toBe("Lead");
    expect(orderLabel([2, 0, 4, 1], 1)).toBe("Back");
    expect(orderLabel([2, 0, 4, 1], 5)).toBe("Not brought");
    expect(buildTeamOrder([2, 0, 4, 1])).toEqual([3, 1, 5, 2]);
    expect(fromTeamOrder([3, 1, 5, 2], 6)).toEqual([2, 0, 4, 1]);
    expect(fromTeamOrder([3, 3, 5, 2], 6)).toEqual([]);
    expect(previewSummary([2, 0, 4, 1], ["A", "B", "C", "D", "E", "F"])).toBe("Leads: C, A · Back: E, B");
    expect(previewSummary([], ["A", "B", "C", "D", "E", "F"])).toBe("Leads: —, — · Back: —");
    expect(previewSummary([4], ["A", "B", "C", "D", "E", "F"])).toBe("Leads: E, — · Back: —");
  });
});

describe("the opponent's team sheet obeys You see", () => {
  const opponent = trainingSetup().opponent;
  it("shows open categories and words closed ones as not shown", () => {
    const open = redactSheet(sheetFromTeam(opponent), OPEN_TEAM_SHEETS);
    expect(sheetFacts(open.members[0], runtime)).toEqual(["Item: Absolite", "Pressure", "Adamant", "Stat Points: not shown"]);
    const perfect = redactSheet(sheetFromTeam(opponent), PERFECT_INFORMATION);
    expect(sheetFacts(perfect.members[0], runtime)).toEqual(["Item: Absolite", "Pressure", "Adamant", "SPs: 2 HP / 32 Atk / 32 Spe"]);
    const closed = renderToStaticMarkup(createElement(OpponentSheet, { sheet: redactSheet(sheetFromTeam(opponent), CLOSED_TEAM_SHEETS), runtime }));
    expect(closed).toContain("Items: not shown · Abilities: not shown · Natures: not shown · Stat Points: not shown");
    expect(closed).toContain("Moves: not shown");
    expect(closed).not.toMatch(/Absolite|Sucker Punch|Pressure/);
    expect(closed).toContain("Absol");
    const shown = renderToStaticMarkup(createElement(OpponentSheet, { sheet: open, runtime }));
    expect(shown).toContain("Sucker Punch · Night Slash · Protect · Close Combat");
  });
});

let document: FakeDocument;
let root: { render: (node: unknown) => void; unmount: () => void };
let TeamPreview: (props: TeamPreviewProps) => unknown;

beforeAll(async () => {
  document = installFakeDom();
  const { createRoot } = await import("react-dom/client");
  TeamPreview = (await import("@/app/(app)/training/preview/TeamPreview")).default as unknown as typeof TeamPreview;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element) as unknown as typeof root;
});
afterAll(async () => { await act(async () => { root?.unmount(); }); });

async function show(props: Partial<TeamPreviewProps> = {}) {
  const onConfirm = vi.fn();
  await act(async () => {
    root.render(createElement(TeamPreview as never, { runtime, setup: trainingSetup(), request: PREVIEW_REQUEST, lastPreview: null, ai: { status: "thinking" }, onConfirm, ...props }));
  });
  return onConfirm;
}
const toggles = () => document.querySelectorAll("li[data-training-preview-member]").map((item) => item.querySelectorAll("button")[0]);
async function press(element: FakeElement) {
  await act(async () => { (reactProps(element).onClick as () => void)(); });
}
const button = (label: string) => document.querySelectorAll("button").find((element) => element.textContent === label)!;

describe("team preview", () => {
  it("brings four in tap order, disables the rest and confirms the 1-based order", async () => {
    const onConfirm = await show();
    expect(toggles()).toHaveLength(6);
    expect(toggles().map((element) => reactProps(element)["aria-label"])).toEqual(["Bring Garchomp", "Bring Gyarados", "Bring Incineroar", "Bring Aerodactyl", "Bring Aegislash", "Bring Aggron"]);
    expect(reactProps(button("Confirm")).disabled).toBe(true);
    expect(document.body.textContent).toContain("AI choosing…");
    for (const index of [2, 0, 4, 1]) await press(toggles()[index]);
    expect(toggles().map((element) => reactProps(element)["aria-pressed"])).toEqual([true, true, true, false, true, false]);
    expect(reactProps(toggles()[3]).disabled).toBe(true);
    expect(document.body.textContent).toContain("Not brought · 4 chosen");
    expect(document.body.textContent).toContain("Leads: Incineroar, Garchomp · Back: Aegislash, Gyarados");
    const place = document.getElementById(String(reactProps(toggles()[2])["aria-describedby"]));
    expect(place?.textContent).toBe("Lead");
    await press(button("Swap leads"));
    expect(document.body.textContent).toContain("Leads: Garchomp, Incineroar · Back: Aegislash, Gyarados");
    await press(button("Confirm"));
    expect(onConfirm).toHaveBeenCalledWith({ kind: "team", order: [1, 3, 5, 2] });
  });

  it("restores the last battle's order and shows the sheet as You see allows; nothing to press while starting", async () => {
    await show({ request: { ...PREVIEW_REQUEST, id: 5 }, lastPreview: [3, 1, 5, 2], setup: trainingSetup({ info: { ...DEFAULT_INFO, youSee: CLOSED_TEAM_SHEETS } }) });
    await press(button("Same as last battle"));
    expect(document.body.textContent).toContain("Leads: Incineroar, Garchomp · Back: Aegislash, Gyarados");
    expect(document.body.textContent).toContain("Items: not shown");
    expect(document.body.textContent).not.toContain("Absolite");
    await show({ request: null });
    expect(document.body.textContent).toContain("Starting battle…");
    expect(toggles().every((element) => reactProps(element).disabled)).toBe(true);
  });
});
