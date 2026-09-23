import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NativeCatalog } from "@/app/lib/battle/types";

const engineLoads = vi.hoisted(() => ({ root: vi.fn(), move: vi.fn() }));

// Any transitive engine load during preparation fails, including a root import
// whose only used export happens to be a small utility such as toID.
vi.mock("@smogon/calc", () => {
  engineLoads.root();
  throw new Error("The calculation engine must remain lazy during preparation.");
});
vi.mock("@smogon/calc/dist/move", () => {
  engineLoads.move();
  throw new Error("The engine Move constructor must remain lazy during preparation.");
});

async function preparation() {
  const [model, mechanics, health, importer, runtime, moves, mega, hpPreview, controls, panel] = await Promise.all([
    import("@/app/lib/battle/model"),
    import("@/app/lib/battle/mechanics"),
    import("@/app/lib/battle/health"),
    import("@/app/lib/battle/team-import"),
    import("@/app/lib/battle/runtime"),
    import("@/app/lib/battle/move-defaults"),
    import("@/app/lib/battle/mega-forms"),
    import("@/app/(app)/calculator/hp-preview"),
    import("@/app/(app)/calculator/MechanicControls"),
    import("@/app/(app)/calculator/PokemonPanel"),
  ]);
  return { model, mechanics, health, importer, runtime, moves, mega, hpPreview, controls, panel };
}

function expectNoEngineLoads() {
  expect(engineLoads.root).not.toHaveBeenCalled();
  expect(engineLoads.move).not.toHaveBeenCalled();
}

describe("engine-independent calculator preparation", () => {
  it("creates, validates and imports Champions builds with retained configuration without loading the engine", async () => {
    const { model, mechanics, health, importer, runtime, moves, mega, hpPreview, controls, panel } = await preparation();
    const build = model.createBuild();
    build.configuration = { teraType: "Fighting", gender: "F" };
    expect(model.validateBuild(build)).toEqual([]);
    expect(mechanics.validateMechanic(build)).toEqual([]);
    expect(mechanics.getBuildGender(build)).toBe("F");
    expect(mechanics.hiddenPowerType({ hp: 31, atk: 30, def: 30, spa: 31, spd: 31, spe: 31 })).toBe("Ice");
    expect(model.getBuildStats(build)?.hp).toBe(153);
    expect(health.getBuildHealth(build)).toMatchObject({ baseMax: 153, current: 153, max: 153, reason: null });
    expect(hpPreview.getBuildHealth(build)).toEqual({ current: 153, maximum: 153 });
    expect(moves.createMoveSlots(build.speciesId, "Doubles").some((slot) => slot.moveId)).toBe(true);
    expect(mega.getMegaOptions("charizard").map((option) => option.formId)).toContain("charizardmegax");
    const team = importer.parseTeamImport("Charizard\nAbility: Blaze\nTera Type: Fighting\n- Flamethrower", "champions");
    expect(team.members[0]).toMatchObject({ selectable: true, build: { game: "champions", configuration: { teraType: "Fighting" } } });
    const html = renderToStaticMarkup(createElement(controls.RetainedConfiguration, { build, runtime: runtime.championsRuntime }));
    expect(html).toContain("Tera Type: Fighting");
    expect(html).toContain("retained; inactive");
    expect(typeof panel.default).toBe("function");
    expectNoEngineLoads();
  });

  it("renders and validates native Tera controls without importing a calculation module", async () => {
    const { model, mechanics, runtime, controls } = await preparation();
    const catalog = (await import("@/data/battle/scarlet_violet/catalog.json")).default as NativeCatalog;
    const selected = runtime.createBattleRuntime(catalog, "4".repeat(64));
    const build = model.createBuild("charizard", selected);
    build.configuration = { teraType: "Fighting" };
    expect(model.validateBuild(build, selected)).toEqual([]);
    const html = renderToStaticMarkup(createElement(controls.default, { build, runtime: selected, position: "left", onToggle: vi.fn() }));
    expect(html).toContain('data-battle-mechanic="tera"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("disabled=");
    const field = renderToStaticMarkup(createElement(controls.TeraTypeField, { build, runtime: selected, id: "test-tera", onChange: vi.fn() }));
    expect(field).toContain('value="Fighting" selected=""');
    build.mechanic = "tera";
    expect(mechanics.validateMechanic(build, selected)).toEqual([]);
    expect(model.validateBuild(build, selected)).toEqual([]);
    expectNoEngineLoads();
  });

  it("renders Max controls and previews effective HP without the engine or its move adapter", async () => {
    const { model, mechanics, health, runtime, controls, hpPreview } = await preparation();
    const catalog = (await import("@/data/battle/sword_shield/catalog.json")).default as NativeCatalog;
    const selected = runtime.createBattleRuntime(catalog, "5".repeat(64));
    const build = model.createBuild("charizard", selected);
    build.configuration = { gigantamax: true, dynamaxLevel: 0 };
    const html = renderToStaticMarkup(createElement(controls.default, { build, runtime: selected, position: "right", onToggle: vi.fn() }));
    expect(html).toContain('data-battle-mechanic="dynamax"');
    expect(html).toContain('data-battle-mechanic="gigantamax"');
    expect(html).toContain("Gigantamax factor requires Gigantamax");
    const dynamaxButton = html.match(/<button\b[^>]*data-battle-mechanic="dynamax"[^>]*>/)?.[0];
    const gmaxButton = html.match(/<button\b[^>]*data-battle-mechanic="gigantamax"[^>]*>/)?.[0];
    expect(dynamaxButton).toContain("disabled=");
    expect(gmaxButton).toBeDefined();
    expect(gmaxButton).not.toContain("disabled=");
    build.mechanic = "gigantamax";
    expect(mechanics.isMaxActive(build)).toBe(true);
    expect(model.validateBuild(build, selected)).toEqual([]);
    expect(health.getBuildHealth(build, selected)).toEqual({ baseMax: 153, baseCurrent: 153, max: 229, current: 229, reason: null });
    expect(hpPreview.getBuildHealth(build, selected)).toEqual({ current: 229, maximum: 229 });
    expectNoEngineLoads();
  });
});
