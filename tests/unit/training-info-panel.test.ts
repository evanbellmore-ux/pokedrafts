import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import InfoSettingsPanel from "@/app/(app)/training/setup/InfoSettingsPanel";
import { capture } from "../fixtures/jsx-capture";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO, OPEN_TEAM_SHEETS, PERFECT_INFORMATION, type InfoSettings } from "@/app/(app)/training/model/info";

vi.mock("react/jsx-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));
vi.mock("react/jsx-dev-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));

function render(info: InfoSettings) {
  const onChange = vi.fn();
  const { result: html, elements } = capture(() => renderToStaticMarkup(createElement(InfoSettingsPanel, { info, onChange })));
  return { html, elements: elements.map((element) => element.props), onChange };
}

describe("Information settings panel", () => {
  it("renders a fieldset, two preset groups and a table of labelled checkboxes", () => {
    const { html } = render(DEFAULT_INFO);
    expect(html).toContain("<legend class=\"text-sm font-semibold text-text\">Information</legend>");
    expect(html).toContain("AI knows your team");
    expect(html).toContain("You see the AI&#x27;s team");
    expect(html.match(/role="group"/g)).toHaveLength(2);
    for (const direction of ["aiKnows", "youSee"]) {
      expect(html).toMatch(new RegExp(`data-training-info-preset="${direction}:open" aria-pressed="true"`));
      expect(html).toMatch(new RegExp(`data-training-info-preset="${direction}:closed" aria-pressed="false"`));
      expect(html).toMatch(new RegExp(`data-training-info-preset="${direction}:perfect" aria-pressed="false"`));
    }
    expect(html).toContain("<caption class=\"sr-only\">");
    for (const label of ["Stat Points", "Natures", "Items", "Abilities", "Moves", "Test: exact HP", "Test: brought Pokémon"]) {
      expect(html).toContain(`aria-label="${label}: AI knows"`);
      expect(html).toContain(`aria-label="${label}: You see"`);
    }
    expect(html).toMatch(/data-training-info-toggle="aiKnows:statPoints" aria-label="Stat Points: AI knows" class="[^"]*"\/>/);
    expect(html).toMatch(/data-training-info-toggle="aiKnows:natures" aria-label="Natures: AI knows" class="[^"]*" checked=""/);
    expect(html).not.toContain("Custom");
    expect(html).not.toContain("Test settings on.");
  });

  it("reads Custom when the toggles match no preset, and warns while a test extra is on", () => {
    const custom = render({ aiKnows: { ...OPEN_TEAM_SHEETS, open: { ...OPEN_TEAM_SHEETS.open, items: false } }, youSee: CLOSED_TEAM_SHEETS });
    expect(custom.html.match(/Custom/g)).toHaveLength(1);
    expect(custom.html).toMatch(/data-training-info-preset="youSee:closed" aria-pressed="true"/);
    const test = render({ aiKnows: PERFECT_INFORMATION, youSee: OPEN_TEAM_SHEETS });
    expect(test.html).toMatch(/data-training-info-preset="aiKnows:perfect" aria-pressed="true"/);
    expect(test.html).toContain("Test settings on.");
    expect(test.html).toContain('role="alert"');
  });

  it("applies a preset to one direction and a toggle to one category", () => {
    const { elements, onChange } = render(DEFAULT_INFO);
    const preset = elements.find((element) => element["data-training-info-preset"] === "youSee:perfect")!;
    (preset.onClick as () => void)();
    expect(onChange).toHaveBeenLastCalledWith({ aiKnows: DEFAULT_INFO.aiKnows, youSee: PERFECT_INFORMATION });
    const toggle = elements.find((element) => element["data-training-info-toggle"] === "aiKnows:statPoints")!;
    (toggle.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    // Changes before the next render build on the last one sent (two clicks in one frame both count).
    expect(onChange).toHaveBeenLastCalledWith({ aiKnows: { ...OPEN_TEAM_SHEETS, open: { ...OPEN_TEAM_SHEETS.open, statPoints: true } }, youSee: PERFECT_INFORMATION });
    const exact = elements.find((element) => element["data-training-info-toggle"] === "youSee:exactHP")!;
    (exact.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: false } });
    expect(onChange).toHaveBeenLastCalledWith({ aiKnows: { ...OPEN_TEAM_SHEETS, open: { ...OPEN_TEAM_SHEETS.open, statPoints: true } }, youSee: { ...PERFECT_INFORMATION, exactHP: false } });
  });
  it("changes from one render apply to the settings of that render", () => {
    const { elements, onChange } = render(DEFAULT_INFO);
    const exact = elements.find((element) => element["data-training-info-toggle"] === "youSee:exactHP")!;
    (exact.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_INFO, youSee: { ...OPEN_TEAM_SHEETS, exactHP: true } });
  });
});
