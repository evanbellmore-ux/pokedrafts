import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import InfoSettingsPanel from "@/app/(app)/training/setup/InfoSettingsPanel";
import { capture } from "../fixtures/jsx-capture";
import { installFakeDom, reactProps, type FakeDocument } from "../fixtures/fake-dom";
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

  it("states each direction's categories under its presets and keeps the table behind Information categories", () => {
    const { html } = render(DEFAULT_INFO);
    for (const direction of ["aiKnows", "youSee"]) {
      const fact = new RegExp(`<p id="([^"]+)" data-training-info-fact="${direction}" class="[^"]*">Open: Natures · Items · Abilities · Moves · Closed: Stat Points</p>`).exec(html);
      expect(fact, direction).not.toBeNull();
      // The preset group is described by its fact line.
      expect(html).toContain(`aria-describedby="${fact![1]}"`);
    }
    // Closed by default: the toggle names the table; the checkboxes stay in the markup under hidden; Test settings on. is outside.
    const toggle = /<button type="button" data-training-info-categories="true" aria-expanded="(true|false)" aria-controls="([^"]+)"[^>]*>([^]*?)<\/button>/.exec(html)!;
    expect(toggle[1]).toBe("false");
    expect(toggle[3]).toMatch(/<svg[^>]*aria-hidden="true"[^]*<\/svg>Information categories$/);
    expect(html).toMatch(new RegExp(`<div id="${toggle[2]}" hidden="" class="min-w-0"><table`));
    expect(html).toContain('aria-label="Stat Points: AI knows"');
    const opened = (info: InfoSettings) => /data-training-info-categories="true" aria-expanded="(true|false)"/.exec(render(info).html)![1];
    expect(opened({ ...DEFAULT_INFO, youSee: CLOSED_TEAM_SHEETS })).toBe("false");
    // A Custom direction or a test extra shows the table from the start.
    expect(opened({ ...DEFAULT_INFO, aiKnows: { ...OPEN_TEAM_SHEETS, open: { ...OPEN_TEAM_SHEETS.open, items: false } } })).toBe("true");
    expect(opened({ ...DEFAULT_INFO, youSee: PERFECT_INFORMATION })).toBe("true");
    expect(opened({ ...DEFAULT_INFO, youSee: { ...OPEN_TEAM_SHEETS, exactHP: true } })).toBe("true");
    const test = render({ ...DEFAULT_INFO, youSee: PERFECT_INFORMATION }).html;
    expect(test).toMatch(/<div id="[^"]+" class="min-w-0"><table/);
    expect(test).toMatch(/data-training-info-fact="youSee"[^>]*>Open: Stat Points · Natures · Items · Abilities · Moves · Test: exact HP · brought Pokémon</);
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

describe("Information categories disclosure (fake DOM)", () => {
  let document: FakeDocument;
  let root: { render(node: unknown): void; unmount(): void };
  beforeAll(async () => {
    document = installFakeDom();
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element) as unknown as typeof root;
  });
  afterAll(async () => { await act(async () => { root?.unmount(); }); });
  const show = async (info: InfoSettings) => { await act(async () => { root.render(createElement(InfoSettingsPanel, { info, onChange: vi.fn() })); }); };
  const toggle = () => document.querySelectorAll("[data-training-info-categories]")[0];
  const table = () => document.getElementById(String(toggle().getAttribute("aria-controls")))!;

  it("opens and closes on its toggle; opens by itself when a Custom or test state arrives, and never closes by itself", async () => {
    await show(DEFAULT_INFO);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(table().hidden).toBe(true);
    await act(async () => { (reactProps(toggle()).onClick as () => void)(); });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(table().hidden).toBe(false);
    await act(async () => { (reactProps(toggle()).onClick as () => void)(); });
    expect(table().hidden).toBe(true);
    // Stored settings load after the first render: a Custom direction opens the table.
    const custom = { ...DEFAULT_INFO, aiKnows: { ...OPEN_TEAM_SHEETS, open: { ...OPEN_TEAM_SHEETS.open, moves: false } } };
    await show(custom);
    expect(table().hidden).toBe(false);
    // Back on a preset it stays as it is until its toggle.
    await show(DEFAULT_INFO);
    expect(table().hidden).toBe(false);
    await act(async () => { (reactProps(toggle()).onClick as () => void)(); });
    await show({ ...DEFAULT_INFO, youSee: PERFECT_INFORMATION });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });
});
