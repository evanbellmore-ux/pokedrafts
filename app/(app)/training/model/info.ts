// Information settings: what the AI may know of your team (aiKnows) and what you see of its team (youSee).
export const SHEET_FIELDS = ["statPoints", "natures", "items", "abilities", "moves"] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];
export type InfoView = {
  /** true: known from team preview (open team sheet). false: known only once the battle shows it. */
  open: Readonly<Record<SheetField, boolean>>;
  /** Test only: exact HP instead of the shown percentage. */
  exactHP: boolean;
  /** Test only: which four were brought, and their order, before they appear. */
  brought: boolean;
};
export type InfoSettings = { aiKnows: InfoView; youSee: InfoView };

export const OPEN_TEAM_SHEETS: InfoView = {
  open: { statPoints: false, natures: true, items: true, abilities: true, moves: true }, exactHP: false, brought: false,
};
export const CLOSED_TEAM_SHEETS: InfoView = {
  open: { statPoints: false, natures: false, items: false, abilities: false, moves: false }, exactHP: false, brought: false,
};
export const PERFECT_INFORMATION: InfoView = {
  open: { statPoints: true, natures: true, items: true, abilities: true, moves: true }, exactHP: true, brought: true,
};
export const DEFAULT_INFO: InfoSettings = { aiKnows: OPEN_TEAM_SHEETS, youSee: OPEN_TEAM_SHEETS };

export type InfoPreset = "open" | "closed" | "perfect";
export const INFO_PRESETS: Record<InfoPreset, { label: string; view: InfoView }> = {
  open: { label: "Champions open team sheets", view: OPEN_TEAM_SHEETS },
  closed: { label: "Closed team sheets", view: CLOSED_TEAM_SHEETS },
  perfect: { label: "Perfect information (test)", view: PERFECT_INFORMATION },
};
export const SHEET_FIELD_LABEL: Record<SheetField, string> = {
  statPoints: "Stat Points", natures: "Natures", items: "Items", abilities: "Abilities", moves: "Moves",
};

export function sameView(a: InfoView, b: InfoView): boolean {
  return a.exactHP === b.exactHP && a.brought === b.brought && SHEET_FIELDS.every((field) => a.open[field] === b.open[field]);
}
export function presetOf(view: InfoView): InfoPreset | null {
  return (Object.keys(INFO_PRESETS) as InfoPreset[]).find((preset) => sameView(INFO_PRESETS[preset].view, view)) ?? null;
}
export function usesTestSettings(view: InfoView): boolean {
  return view.exactHP || view.brought;
}
/** "Open: Natures · Items · Abilities · Moves · Closed: Stat Points", plus " · Test: exact HP · brought Pokémon". */
export function infoFact(view: InfoView): string {
  const open = SHEET_FIELDS.filter((field) => view.open[field]).map((field) => SHEET_FIELD_LABEL[field]);
  const closed = SHEET_FIELDS.filter((field) => !view.open[field]).map((field) => SHEET_FIELD_LABEL[field]);
  const test = [view.exactHP ? "exact HP" : null, view.brought ? "brought Pokémon" : null].filter((part): part is string => !!part);
  return [
    open.length ? `Open: ${open.join(" · ")}` : null,
    closed.length ? `Closed: ${closed.join(" · ")}` : null,
    test.length ? `Test: ${test.join(" · ")}` : null,
  ].filter((part): part is string => !!part).join(" · ");
}
function parseView(value: unknown, fallback: InfoView): InfoView {
  const raw = (value && typeof value === "object" ? value : {}) as { open?: Record<string, unknown> };
  const open = Object.fromEntries(SHEET_FIELDS.map((field) => {
    const flag = raw.open?.[field];
    return [field, typeof flag === "boolean" ? flag : fallback.open[field]];
  })) as Record<SheetField, boolean>;
  // Test extras are never remembered (I2).
  return { open, exactHP: false, brought: false };
}
/** Stored settings (localStorage) back to InfoSettings: malformed parts fall back to the default; test extras off. */
export function parseInfoSettings(value: unknown): InfoSettings {
  const raw = (value && typeof value === "object" ? value : {}) as { aiKnows?: unknown; youSee?: unknown };
  return { aiKnows: parseView(raw.aiKnows, DEFAULT_INFO.aiKnows), youSee: parseView(raw.youSee, DEFAULT_INFO.youSee) };
}
