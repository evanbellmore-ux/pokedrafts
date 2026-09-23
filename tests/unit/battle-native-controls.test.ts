import { createElement, type ChangeEvent, type ComponentProps, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import PokemonChooser from "@/app/(app)/calculator/PokemonChooser";
import CurrentHPField from "@/app/(app)/calculator/CurrentHPField";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import MoveResults, { filterMoveResults, MoveDetails } from "@/app/(app)/calculator/MoveResults";
import MechanicControls, { TeraTypeField } from "@/app/(app)/calculator/MechanicControls";
import BattleConditions from "@/app/(app)/calculator/BattleConditions";
import { getBuildHealth, previewRemainingHP } from "@/app/(app)/calculator/hp-preview";
import { createMatchup, getMoveOwner } from "@/app/(app)/calculator/roster-prep";
import { createBuild, createConditions, getBuildStats, validateBuild } from "@/app/lib/battle/model";
import { championsRuntime, createBattleRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, MoveDamageResult, NativeBuild, NativeCatalog } from "@/app/lib/battle/types";
import usumCatalog from "@/data/battle/ultra_sun_ultra_moon/catalog.json";
import swshCatalog from "@/data/battle/sword_shield/catalog.json";
import svCatalog from "@/data/battle/scarlet_violet/catalog.json";

const usum = createBattleRuntime(usumCatalog as NativeCatalog, "1".repeat(64));
const swsh = createBattleRuntime(swshCatalog as NativeCatalog, "2".repeat(64));
const sv = createBattleRuntime(svCatalog as NativeCatalog, "3".repeat(64));
const events = vi.hoisted(() => ({
  capture: false,
  inputs: [] as ComponentProps<"input">[],
  selects: [] as ComponentProps<"select">[],
  buttons: [] as (ComponentProps<"button"> & { "data-battle-mechanic"?: string })[],
}));
vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  function record(type: unknown, props: unknown) {
    if (!events.capture) return;
    if (type === "input") events.inputs.push(props as typeof events.inputs[number]);
    if (type === "select") events.selects.push(props as typeof events.selects[number]);
    if (type === "button") events.buttons.push(props as typeof events.buttons[number]);
  }
  return {
    ...actual,
    jsx: (...args: Parameters<typeof actual.jsx>) => { record(args[0], args[1]); return actual.jsx(...args); },
    jsxs: (...args: Parameters<typeof actual.jsxs>) => { record(args[0], args[1]); return actual.jsxs(...args); },
  };
});
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  return {
    ...actual,
    jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
      if (events.capture && args[0] === "input") events.inputs.push(args[1] as typeof events.inputs[number]);
      if (events.capture && args[0] === "select") events.selects.push(args[1] as typeof events.selects[number]);
      if (events.capture && args[0] === "button") events.buttons.push(args[1] as typeof events.buttons[number]);
      return actual.jsxDEV(...args);
    },
  };
});

function capture(render: () => string) {
  events.inputs = []; events.selects = []; events.buttons = []; events.capture = true;
  try { return { html: render(), inputs: events.inputs, selects: events.selects, buttons: events.buttons }; }
  finally { events.capture = false; }
}
function native(runtime: BattleRuntime, id = "charizard"): NativeBuild {
  const build = createBuild(id, runtime);
  if (build.game === "champions") throw new Error("Native fixture required");
  return build;
}
function panel(build: BattleBuild, runtime = championsRuntime, onChange = vi.fn()) {
  return renderToStaticMarkup(createElement(PokemonPanel, {
    side: "attacker", build, runtime, issues: validateBuild(build, runtime), onChange,
    hpInput: "00101", onHPChange: vi.fn(), editorRevision: 2,
  }));
}
function row(moveId = "flamethrower", overrides: Partial<MoveDamageResult> = {}): MoveDamageResult {
  return { moveId, kind: "calculated", min: 20, max: 20, minPercent: null, maxPercent: null, rolls: 20,
    ohkoChance: 0, description: "", assumptions: [], reason: null, hits: 1, ...overrides };
}
function moves(runtime: BattleRuntime, sourceBuild: BattleBuild, overrides: Partial<ComponentProps<typeof MoveResults>> = {}) {
  return renderToStaticMarkup(createElement(MoveResults, {
    runtime, sourceBuild, rows: [row()], moveIds: ["flamethrower"], ownerId: "2:3", sourcePosition: "left",
    selectedMoveId: "flamethrower", onSelectMove: vi.fn(), contexts: {}, onContextChange: vi.fn(),
    abilityId: sourceBuild.abilityId, itemId: sourceBuild.itemId, attackerName: "Charizard", defenderName: "Blastoise", defenderHP: 154,
    ...overrides,
  }));
}
function summary(matchup: ReturnType<typeof createMatchup>, overrides: Partial<ComponentProps<typeof MatchupSummary>> = {}) {
  return renderToStaticMarkup(createElement(MatchupSummary, {
    runtime: matchup.runtime, attacker: matchup.attacker, defender: matchup.defender, attack: matchup.attack, replacement: null,
    issues: { attacker: validateBuild(matchup.attacker.build, matchup.runtime), defender: validateBuild(matchup.defender.build, matchup.runtime) },
    resultIdentity: { source: getMoveOwner(matchup.attacker), receiver: getMoveOwner(matchup.defender) }, selectedRow: undefined,
    rollMode: "average", onRollModeChange: vi.fn(), movesControl: "moves", onActivateMove: vi.fn(), onShowMove: vi.fn(),
    onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onToggleMega: vi.fn(), onToggleMechanic: vi.fn(), ...overrides,
  }));
}
function assertLabels(html: string) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [, references] of html.matchAll(/\baria-(?:describedby|labelledby)="([^"]+)"/g)) {
    for (const id of references.split(" ")) expect(ids).toContain(id);
  }
  for (const [, id] of html.matchAll(/\bfor="([^"]+)"/g)) expect(ids).toContain(id);
}
const inputChange = (value: string) => ({ target: { value } }) as ChangeEvent<HTMLInputElement>;
const selectChange = (value: string) => ({ target: { value } }) as ChangeEvent<HTMLSelectElement>;

describe("native training and set controls", () => {
  it.each([usum, swsh, sv])("renders exact level/EV/IV values for $profile.id rather than Stat Points", (runtime) => {
    const build = native(runtime);
    build.native.level = 100;
    build.native.evs = { hp: 6, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 };
    build.native.ivs.atk = 0;
    const before = structuredClone(build);
    const { html, inputs } = capture(() => panel(build, runtime));
    expect(html).toContain("Stats at level 100");
    expect(html).toContain("510 / 510 EVs");
    expect(inputs.filter((input) => /-evs-\w+$/.test(input.id ?? ""))).toHaveLength(6);
    expect(inputs.filter((input) => /-ivs-\w+$/.test(input.id ?? ""))).toHaveLength(6);
    expect(inputs.find((input) => input.id?.endsWith("-ivs-atk"))?.value).toBe("0");
    expect(inputs.find((input) => input.id?.endsWith("-level") && !input.id.endsWith("-dynamax-level"))?.value).toBe("100");
    expect(html).not.toMatch(/id="[^"]*-points-(?:hp|atk|def|spa|spd|spe)"/);
    expect(html).toContain('value="00101"');
    expect(html).toContain(String(getBuildStats(build, runtime)!.hp));
    expect(build).toEqual(before);
    assertLabels(html);
  });

  it("keeps native invalid/unfinished values representable and preserves all other preparation", () => {
    const build = native(sv);
    build.configuration = { teraType: "Water", happiness: 123 };
    const onChange = vi.fn();
    const controls = capture(() => panel(build, sv, onChange));
    controls.inputs.find((input) => input.id?.endsWith("-level"))!.onChange!(inputChange("101"));
    expect(onChange.mock.lastCall![0]).toEqual({ ...build, native: { ...build.native, level: 101 } });
    controls.inputs.find((input) => input.id?.endsWith("-evs-hp"))!.onChange!(inputChange("1.5"));
    expect(onChange.mock.lastCall![0]).toEqual({ ...build, native: { ...build.native, evs: { ...build.native.evs, hp: null } } });
    controls.inputs.find((input) => input.id?.endsWith("-ivs-spe"))!.onChange!(inputChange(""));
    expect(onChange.mock.lastCall![0].native.ivs.spe).toBeNull();
    build.native.evs = { hp: 7, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 };
    const invalid = capture(() => panel(build, sv));
    expect(invalid.html).toContain("511 / 510 EVs");
    expect(invalid.inputs.filter((input) => /-evs-\w+$/.test(input.id ?? "")).every((input) => input["aria-invalid"])).toBe(true);
    expect(build.native.evs.hp).toBe(7);
  });

  it("preserves Champions point columns and visibly retains foreign metadata without activation", () => {
    const build = createBuild();
    build.configuration = { teraType: "Fighting", gigantamax: true, dynamaxLevel: 3, hiddenPowerType: "Ice" };
    const { html, inputs } = capture(() => panel(build));
    expect(html).toContain("0 / 66 Stat Points");
    expect(inputs.filter((input) => /-points-\w+$/.test(input.id ?? ""))).toHaveLength(6);
    expect(html).toContain("Tera Type: Fighting");
    expect(html).toContain("Gigantamax factor: Yes");
    expect(html).toContain("Dynamax Level: 3");
    expect(html).toContain("Hidden Power: Ice");
    expect(html).toContain("retained; inactive in");
    expect(html).not.toContain("data-battle-mechanic");
    expect(html).not.toContain('value="Stellar"');
    expect(build.mechanic).toBeUndefined();
    expect(validateBuild(build)).toEqual([]);
  });

  it("updates Tera configuration including Stellar without activating or changing training", () => {
    const build = native(sv);
    const onChange = vi.fn();
    const controls = capture(() => renderToStaticMarkup(createElement(TeraTypeField, { id: "tera", build, runtime: sv, onChange })));
    expect(controls.html).toContain('<option value="Stellar">Stellar</option>');
    controls.selects[0].onChange!(selectChange("Stellar"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...build, configuration: { teraType: "Stellar" } });
    expect(onChange.mock.lastCall![0].mechanic).toBeUndefined();
  });

  it("edits happiness and Dynamax level without clamping or confusing invalid text with default", () => {
    const build = native(swsh);
    const onChange = vi.fn();
    const controls = capture(() => panel(build, swsh, onChange));
    controls.inputs.find((input) => input.id?.endsWith("-happiness"))!.onChange!(inputChange("abc"));
    expect(onChange.mock.lastCall![0].configuration.happiness).toBeNaN();
    controls.inputs.find((input) => input.id?.endsWith("-happiness"))!.onChange!(inputChange(""));
    expect(onChange.mock.lastCall![0].configuration.happiness).toBeUndefined();
    controls.inputs.find((input) => input.id?.endsWith("-dynamax-level"))!.onChange!(inputChange("11"));
    expect(onChange.mock.lastCall![0].configuration.dynamaxLevel).toBe(11);
    expect(onChange.mock.lastCall![0].mechanic).toBeUndefined();
    controls.selects.find((select) => select.id?.endsWith("-gigantamax"))!.onChange!(selectChange("yes"));
    expect(onChange.mock.lastCall![0]).toEqual({ ...build, configuration: { gigantamax: true } });
  });

  it("exposes native innate-IV context and gender without inventing Hyper Training history", () => {
    const build = native(usum);
    build.native.level = 100;
    const onChange = vi.fn();
    const controls = capture(() => panel(build, usum, onChange));
    controls.selects.find((select) => select.id?.endsWith("-gender"))!.onChange!(selectChange("F"));
    expect(onChange.mock.lastCall![0]).toEqual({ ...build, configuration: { gender: "F" } });
    controls.selects.find((select) => select.id?.endsWith("-hidden-power"))!.onChange!(selectChange("Ice"));
    expect(onChange.mock.lastCall![0].native).toBe(build.native);
    controls.inputs.find((input) => input.id?.endsWith("-innate-context"))!.onChange!({ target: { checked: true } } as ChangeEvent<HTMLInputElement>);
    const next: NativeBuild = onChange.mock.lastCall![0];
    expect(next.native.innateIVs).toEqual(build.native.ivs);
    expect(next.native.innateIVs).not.toBe(build.native.ivs);
    next.native.innateIVs!.atk = 30;
    const rendered = capture(() => panel(next, usum));
    expect(rendered.inputs.filter((input) => /-innateIVs-\w+$/.test(input.id ?? ""))).toHaveLength(6);
    expect(rendered.html).toContain("enter the known originals, not guesses");
    expect(build.native.innateIVs).toBeUndefined();
  });

  it("uses only the chosen catalog and resets manual native choices with native defaults", () => {
    const catalog = { ...usum.catalog, species: [usum.speciesById.get("charizard")!, usum.speciesById.get("mew")!] };
    const runtime = createBattleRuntime(catalog, "4".repeat(64));
    const build = native(runtime);
    build.native.level = 100;
    build.native.evs.spa = 252;
    const onChange = vi.fn();
    const onClose = vi.fn();
    const rendered = capture(() => renderToStaticMarkup(createElement(PokemonChooser, { runtime, side: "attacker", build, open: true, onChange, onClose })));
    expect(rendered.html).toContain("of 2 Pokémon");
    expect(rendered.html).toContain("Mew");
    expect(rendered.html).not.toContain("Alcremie");
    rendered.buttons.find((button) => button["aria-pressed"] === false)!.onClick!({} as MouseEvent<HTMLButtonElement>);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(createBuild("mew", runtime));
    expect(onChange.mock.lastCall![0].native).toMatchObject({ level: 50, evs: { spa: 0 }, ivs: { spa: 31 } });
  });
});

describe("native summary mechanics and health", () => {
  it("routes Tera and compact configuration to the owning combatant, keeping eight quick moves", () => {
    const matchup = createMatchup(2, sv);
    matchup.attacker.build.configuration = { teraType: "Water" };
    const onToggleMechanic = vi.fn();
    const onBuildChange = vi.fn();
    const rendered = capture(() => summary(matchup, { onToggleMechanic, onBuildChange }));
    expect([...rendered.html.matchAll(/data-move-slot=/g)]).toHaveLength(8);
    const left = rendered.buttons.find((button) => button["aria-label"] === "Charizard left Tera")!;
    expect(left.disabled).toBe(false);
    left.onClick!({} as MouseEvent<HTMLButtonElement>);
    expect(onToggleMechanic).toHaveBeenCalledExactlyOnceWith(getMoveOwner(matchup.attacker), "tera");
    rendered.selects.find((select) => select.id?.endsWith("-tera-type"))!.onChange!(selectChange("Stellar"));
    expect(onBuildChange).toHaveBeenCalledExactlyOnceWith(matchup.attacker.key, { ...matchup.attacker.build, configuration: { teraType: "Stellar" } });
    expect(matchup.attacker.build.mechanic).toBeUndefined();
    assertLabels(rendered.html);
  });

  it("shows only legal mechanics and explains missing factors or excluded species", () => {
    const build = native(swsh);
    const render = (build: BattleBuild, runtime = swsh) => capture(() => renderToStaticMarkup(createElement(MechanicControls, { build, runtime, position: "right", onToggle: vi.fn() })));
    const controls = render(build);
    expect(controls.buttons.find((button) => button["data-battle-mechanic"] === "dynamax")!.disabled).toBe(false);
    expect(controls.buttons.find((button) => button["data-battle-mechanic"] === "gigantamax")!.disabled).toBe(true);
    expect(controls.html).toContain("Gigantamax factor explicitly enabled");
    expect(controls.html).not.toContain('data-battle-mechanic="tera"');
    const factor = render({ ...build, configuration: { gigantamax: true } });
    expect(factor.buttons.find((button) => button["data-battle-mechanic"] === "dynamax")!.disabled).toBe(true);
    expect(factor.buttons.find((button) => button["data-battle-mechanic"] === "gigantamax")!.disabled).toBe(false);
    expect(factor.html).toContain("Remove the factor to use ordinary Dynamax");
    expect(render(native(swsh, "zacian")).html).toContain("cannot Dynamax or Gigantamax");
    expect(render(createBuild(), championsRuntime).buttons).toHaveLength(0);
    expect(render(native(usum), usum).buttons).toHaveLength(0);
  });

  it("shows effective Tera defense without renaming the catalog Pokémon and retains Stellar defense", () => {
    const matchup = createMatchup(0, sv);
    matchup.attacker.build.configuration = { teraType: "Water" };
    matchup.attacker.build.mechanic = "tera";
    const before = structuredClone(matchup.attacker.build);
    const html = summary(matchup);
    expect(html).toContain("Tera Water");
    expect(html).toContain("Original types: Fire / Flying");
    expect(html).toContain(">Charizard</h3>");
    expect(matchup.attacker.build).toEqual(before);
    matchup.attacker.build.configuration.teraType = "Stellar";
    expect(summary(matchup)).toContain("Stellar retains original defensive typing");
  });

  it("uses native Primal/Ultra options and the original Ultra base for toggle ownership", () => {
    const matchup = createMatchup(0, usum);
    matchup.attacker.build = native(usum, "necrozmaultra");
    const base = native(usum, "necrozmadawnwings");
    matchup.attacker.megaBase = { speciesId: base.speciesId, abilityId: base.abilityId, abilityActive: base.abilityActive, itemId: base.itemId };
    matchup.defender.build = native(usum, "kyogre");
    const html = summary(matchup);
    expect(html).toContain('aria-label="Necrozma-Dawn-Wings left Ultra Burst"');
    expect(html).toContain('aria-label="Kyogre right Primal"');
    expect(html).not.toContain("Mega Z");
  });

  it.each(Array.from({ length: 11 }, (_, level) => level))("keeps base HP text while effective health/projection share Dynamax level %s", (dynamaxLevel) => {
    const build = native(swsh);
    build.currentHP = 101;
    build.configuration = { dynamaxLevel };
    build.mechanic = "dynamax";
    const maximum = Math.floor(153 * (150 + 5 * dynamaxLevel) / 100);
    const current = Math.floor(101 * (150 + 5 * dynamaxLevel) / 100);
    expect(getBuildHealth(build, swsh)).toEqual({ current, maximum });
    expect(previewRemainingHP(build, row(), "average", swsh)).toMatchObject({ status: "ready", current, maximum, remaining: current - 20 });
    const html = renderToStaticMarkup(createElement(CurrentHPField, { build, runtime: swsh, issues: [], text: "00101", onTextChange: vi.fn(), compact: true }));
    expect(html).toContain("Current HP (base / pre-Dynamax)");
    expect(html).toContain(`Effective Dynamax HP: ${current} / ${maximum}.`);
    expect(html).toContain('placeholder="Full HP (153)"');
    expect(html).toContain('value="00101"');
    expect(build.currentHP).toBe(101);
  });

  it("withholds ineligible health with its reason and retains survival-sensitive guards", () => {
    const invalid = { ...native(swsh, "zacian"), mechanic: "dynamax" as const };
    expect(getBuildHealth(invalid, swsh)).toBeNull();
    expect(previewRemainingHP(invalid, row(), "average", swsh)).toMatchObject({ status: "unavailable", reason: expect.stringContaining("cannot Dynamax") });
    const sash = { ...native(swsh), itemId: "focussash", mechanic: "dynamax" as const };
    expect(previewRemainingHP(sash, row(), "average", swsh)).toMatchObject({ status: "unavailable", reason: expect.stringContaining("Focus Sash") });
    const shedinja = { ...native(swsh, "shedinja"), mechanic: "dynamax" as const };
    expect(getBuildHealth(shedinja, swsh)).toEqual({ current: 1, maximum: 1 });
  });
});

describe("native attack context and effective metadata", () => {
  it("requests Z for the selected base ID, preserves other context and exposes adapter rejection", () => {
    const build = native(usum);
    const onContextChange = vi.fn();
    const reason = "A Z-Move requires the matching Z-Crystal.";
    const rendered = capture(() => moves(usum, build, { contexts: { flamethrower: { hits: 3, useZ: true } }, onContextChange,
      rows: [row("flamethrower", { kind: "unsupported", reason, min: null, max: null, rolls: null, ohkoChance: null, hits: null })] }));
    expect(rendered.html).toContain(reason);
    expect(rendered.html).toContain("consumption is not tracked");
    expect(rendered.html).not.toContain("20 HP");
    const toggle = rendered.inputs.find((input) => input.id?.endsWith("-use-z"))!;
    expect(toggle.checked).toBe(true);
    toggle.onChange!({ target: { checked: false } } as ChangeEvent<HTMLInputElement>);
    expect(onContextChange).toHaveBeenCalledExactlyOnceWith("flamethrower", { hits: 3, useZ: false });
    expect(build.mechanic).toBeUndefined();
    assertLabels(rendered.html);
  });

  it("does not enable status-Z damage and lets an invalid existing request be cleared", () => {
    const base = { moveIds: ["protect"], selectedMoveId: "protect", rows: [row("protect", { kind: "status", min: null, max: null, rolls: null })] };
    const initial = capture(() => moves(usum, native(usum), base));
    expect(initial.inputs.find((input) => input.id?.endsWith("-use-z"))!.disabled).toBe(true);
    expect(initial.html).toContain("Status Z-Move bonuses are not simulated");
    const invalid = capture(() => moves(usum, native(usum), { ...base, contexts: { protect: { useZ: true } } }));
    expect(invalid.inputs.find((input) => input.id?.endsWith("-use-z"))!.disabled).toBe(false);
  });

  it("requires explicit Stellar context and merges it rather than discarding hit context", () => {
    const build = native(sv);
    build.mechanic = "tera";
    build.configuration = { teraType: "Stellar" };
    const onContextChange = vi.fn();
    const rendered = capture(() => moves(sv, build, { contexts: { flamethrower: { hits: 2 } }, onContextChange }));
    const select = rendered.selects.find((select) => select.id?.endsWith("-stellar-first-use"))!;
    expect(select.value).toBe("");
    select.onChange!(selectChange("yes"));
    select.onChange!(selectChange("no"));
    expect(onContextChange.mock.calls).toEqual([["flamethrower", { hits: 2, stellarFirstUse: true }], ["flamethrower", { hits: 2, stellarFirstUse: false }]]);
    expect(rendered.html).not.toContain("Use Z-Move");
    build.mechanic = undefined;
    expect(moves(sv, build)).not.toContain("stellar-first-use");
  });

  it.each(["z", "max"] as const)("does not require base multi-hit context for a converted %s attack", (kind) => {
    const runtime = kind === "z" ? usum : swsh;
    const build = native(runtime, "venusaur");
    if (kind === "max") build.mechanic = "dynamax";
    const context = kind === "z" ? { useZ: true } : undefined;
    const effective = row("bulletseed", { effectiveName: kind === "z" ? "Bloom Doom" : "Max Overgrowth", effectiveType: "Grass", effectivePower: 130, effectiveCategory: "Physical" });
    const html = renderToStaticMarkup(createElement(MoveDetails, { runtime, sourceBuild: build, moveId: "bulletseed", row: effective, id: "bullet", context, abilityId: "skilllink", itemId: "", onContextChange: vi.fn() }));
    expect(html).not.toContain("hits this use");
    expect(html).not.toContain("Skill Link fixes");
    expect(html).toContain(effective.effectiveName);
    expect(html).toContain("Power: 130");
    const list = moves(runtime, build, { moveIds: ["bulletseed"], selectedMoveId: "bulletseed", rows: [effective], contexts: context ? { bulletseed: context } : {} });
    expect(list).toContain('value="bulletseed"');
    expect(list).toContain(effective.effectiveName);
    expect(list).not.toContain("Set hits");
    expect(filterMoveResults([effective], effective.effectiveName!, "damaging", runtime)).toEqual([effective]);
  });

  it("preserves Stellar/Z flags when the base hit editor changes", () => {
    const onContextChange = vi.fn();
    const rendered = capture(() => renderToStaticMarkup(createElement(MoveDetails, { runtime: sv, moveId: "bulletseed", id: "hits", context: { stellarFirstUse: false, useZ: false }, abilityId: "overgrow", itemId: "", onContextChange })));
    rendered.selects[0].onChange!(selectChange("4"));
    expect(onContextChange).toHaveBeenCalledExactlyOnceWith({ stellarFirstUse: false, useZ: false, hits: 4 });
  });

  it("shows transformed names in the summary and owning quick slot without changing base move IDs", () => {
    const matchup = createMatchup(0, swsh);
    matchup.attacker.build.mechanic = "gigantamax";
    matchup.attacker.build.configuration = { gigantamax: true };
    matchup.attacker.moves[0] = { moveId: "flamethrower", origin: "manual", gameType: null };
    matchup.attack = { owner: getMoveOwner(matchup.attacker), moveId: "flamethrower" };
    const selectedRow = row("flamethrower", { effectiveName: "G-Max Wildfire", effectiveType: "Fire", effectivePower: 130, effectiveCategory: "Special" });
    const html = summary(matchup, { selectedRow });
    expect(html).toContain('aria-label="Charizard left move 1: G-Max Wildfire (from Flamethrower)"');
    expect(html).toContain("After G-Max Wildfire");
    expect(html).toContain("Power 130");
    expect(matchup.attacker.moves[0].moveId).toBe("flamethrower");
  });

  it.each([championsRuntime, usum, swsh, sv])("offers only $profile.id weather and labels its field rules", (runtime) => {
    const html = renderToStaticMarkup(createElement(BattleConditions, { runtime, value: createConditions(), issues: [], onChange: vi.fn() }));
    expect(html).toContain(runtime.profile.label);
    for (const weather of ["Snow", "Hail", "Harsh Sunshine", "Heavy Rain", "Strong Winds"] as const) {
      expect(html.includes(`<option value="${weather}">`)).toBe(runtime.profile.weather.includes(weather));
    }
    expect(html).toContain(`after ${runtime.profile.weather.includes("Hail") ? "Hail" : "Snow"} ends.`);
    assertLabels(html);
  });
});
