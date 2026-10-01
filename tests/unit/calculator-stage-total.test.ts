import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getModifiedStat } from "@smogon/calc/dist/mechanics/util";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import { stagedStat } from "@/app/(app)/calculator/stage-stat";
import { createBuild, getBuildStats, STATS, STAT_LABELS, validateBuild } from "@/app/lib/battle/model";
import { championsRuntime, createBattleRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, NativeBuild, NativeCatalog } from "@/app/lib/battle/types";
import usumCatalog from "@/data/battle/ultra_sun_ultra_moon/catalog.json";
import swshCatalog from "@/data/battle/sword_shield/catalog.json";
import svCatalog from "@/data/battle/scarlet_violet/catalog.json";

const usum = createBattleRuntime(usumCatalog as NativeCatalog, "1".repeat(64));
const swsh = createBattleRuntime(swshCatalog as NativeCatalog, "2".repeat(64));
const sv = createBattleRuntime(svCatalog as NativeCatalog, "3".repeat(64));

function native(runtime: BattleRuntime, id = "charizard"): NativeBuild {
  const build = createBuild(id, runtime);
  if (build.game === "champions") throw new Error("Native fixture required");
  return build;
}
function panel(build: BattleBuild, runtime: BattleRuntime = championsRuntime) {
  return renderToStaticMarkup(createElement(PokemonPanel, {
    side: "attacker", build, runtime, issues: validateBuild(build, runtime), onChange: vi.fn(), hpInput: "", onHPChange: vi.fn(),
  }));
}
const text = (html: string) => html.replace(/<[^>]+>/g, "");
function headers(html: string) {
  const head = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
  return [...head.matchAll(/<th\b[^>]*>(.*?)<\/th>/g)].map(([, cell]) => text(cell));
}
/** Each stat row's Value and Total cells, by stat label. */
function rows(html: string) {
  const body = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
  return Object.fromEntries([...body.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/g)].map(([, row]) => {
    const label = text(/<th\b[^>]*>(.*?)<\/th>/.exec(row)![1]);
    const cells = [...row.matchAll(/<td\b[^>]*>(.*?)<\/td>/g)].map(([, cell]) => cell);
    return [label, { value: text(cells.at(-3)!), stage: cells.at(-2)!, total: text(cells.at(-1)!) }];
  }));
}

describe("stat with its stage", () => {
  it("applies stages as pinned Showdown does", () => {
    expect(stagedStat(120, 0)).toBe(120);
    expect(stagedStat(120, 1)).toBe(180);
    expect(stagedStat(120, -1)).toBe(80);
    expect(stagedStat(120, 6)).toBe(480);
    expect(stagedStat(120, -6)).toBe(30);
    // Rounded down after the multiplier.
    expect(stagedStat(101, 1)).toBe(151);
    expect(stagedStat(101, -1)).toBe(67);
    expect(stagedStat(129, 3)).toBe(322);
    expect(stagedStat(105, -5)).toBe(30);
  });

  it("matches the pinned calculator's stage multiplier for every stat and stage", () => {
    for (let stat = 1; stat <= 999; stat++) {
      for (let stage = -6; stage <= 6; stage++) expect(stagedStat(stat, stage)).toBe(getModifiedStat(stat, stage));
    }
  });

  it("clamps stages to ±6 and has no total without a stat or a whole-number stage", () => {
    expect(stagedStat(120, 8)).toBe(480);
    expect(stagedStat(120, -9)).toBe(30);
    expect(stagedStat(null, 1)).toBeNull();
    expect(stagedStat(undefined, 1)).toBeNull();
    expect(stagedStat(120, null)).toBeNull();
    expect(stagedStat(120, 1.5)).toBeNull();
  });
});

describe("Total column in the build editor's stat table", () => {
  it("follows the Stage dropdown with the staged Champions stat, and a dash for HP", () => {
    const build = createBuild("charizard");
    build.boosts = { ...build.boosts, atk: -1, spe: 1, spd: 6, def: -6 };
    const html = panel(build);
    expect(headers(html)).toEqual(["Stat", "Points", "Value", "Stage", "Total"]);
    expect(html).toContain('<th scope="col" class="px-1 py-1 text-right">Total</th>');
    const table = rows(html);
    expect(table[STAT_LABELS.spe]).toMatchObject({ value: "120", total: "180" });
    expect(table[STAT_LABELS.atk]).toMatchObject({ value: "104", total: "69" });
    expect(table[STAT_LABELS.spd]).toMatchObject({ value: "105", total: "420" });
    expect(table[STAT_LABELS.def]).toMatchObject({ value: "98", total: "24" });
    expect(table[STAT_LABELS.spa]).toMatchObject({ value: "129", total: "129" });
    expect(table[STAT_LABELS.hp].total).toBe("—");
    expect(table[STAT_LABELS.hp].stage).not.toContain("<select");
    // The Total cell is the one right of the Stage dropdown.
    expect(table[STAT_LABELS.spe].stage).toContain("-stage-spe");
  });

  it("updates with training as well as the stage", () => {
    const build = createBuild("charizard");
    build.boosts = { ...build.boosts, spe: 1 };
    build.points = { ...build.points, spe: 32 };
    expect(rows(panel(build))[STAT_LABELS.spe]).toMatchObject({ value: "152", total: "228" });
  });

  it.each([
    ["Ultra Sun and Ultra Moon", usum],
    ["Sword and Shield", swsh],
    ["Scarlet and Violet", sv],
  ])("adds the column to the EV and IV table in %s", (_name, runtime) => {
    const build = native(runtime);
    build.native.evs = { ...build.native.evs, spe: 252 };
    build.boosts = { ...build.boosts, spe: 2, spa: -2 };
    const html = panel(build, runtime);
    expect(headers(html)).toEqual(["Stat", "EVs", "IVs", "Value", "Stage", "Total"]);
    const stats = getBuildStats(build, runtime)!;
    const table = rows(html);
    expect(table[STAT_LABELS.spe]).toMatchObject({ value: String(stats.spe), total: String(stats.spe * 2) });
    expect(table[STAT_LABELS.spa]).toMatchObject({ value: String(stats.spa), total: String(Math.floor(stats.spa / 2)) });
    expect(table[STAT_LABELS.hp].total).toBe("—");
  });

  it("adds the column to the innate IV table", () => {
    const build = native(usum);
    build.native.innateIVs = { ...build.native.ivs };
    build.boosts = { ...build.boosts, atk: 1 };
    const html = panel(build, usum);
    expect(headers(html)).toEqual(["Stat", "EVs", "IVs", "Innate IVs", "Value", "Stage", "Total"]);
    const stats = getBuildStats(build, usum)!;
    expect(rows(html)[STAT_LABELS.atk]).toMatchObject({ value: String(stats.atk), total: String(Math.floor(stats.atk * 3 / 2)) });
  });

  it("shows a dash when the stat or the stage is not valid", () => {
    const build = createBuild("charizard");
    build.boosts = { ...build.boosts, spe: null };
    expect(rows(panel(build))[STAT_LABELS.spe].total).toBe("—");
    const unfinished = createBuild("charizard");
    unfinished.points = { ...unfinished.points, atk: null };
    unfinished.boosts = { ...unfinished.boosts, spe: 1 };
    const table = rows(panel(unfinished));
    for (const stat of STATS) expect(table[STAT_LABELS[stat]]).toMatchObject({ value: "—", total: "—" });
  });
});
