import { beforeAll, describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, MoveContext, SetConfiguration, StatTable } from "@/app/lib/battle/types";

/**
 * A transformed Imposter Ditto keeps its own Hidden Power type and happiness (pinned
 * Showdown transformInto keeps hpType from generation 5 and never touches happiness). Ultra Sun/Ultra
 * Moon, level 50 unless stated, Serious nature, no EVs, Singles. Every number is from a real pinned
 * Showdown lead battle (oos/imposter-hp/repro.ts and edges.ts).
 */
let us: BattleRuntime;
beforeAll(async () => { us = await loadBattleRuntime("ultra_sun_ultra_moon"); });

const IVS = (x: Partial<StatTable<number>> = {}): StatTable<number> => ({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...x });
const ALL30 = { hp: 30, atk: 30, def: 30, spa: 30, spd: 30, spe: 30 };
const FIRE = { atk: 30, spa: 30, spe: 30 };
const ICE = { atk: 30, def: 30 };
type Spec = { abilityId: string; itemId?: string; level?: number; ivs?: Partial<StatTable<number>>; innate?: Partial<StatTable<number>>; configuration?: SetConfiguration; evs?: Partial<StatTable<number>> };
function build(id: string, spec: Spec): BattleBuild {
  const base = createBuild(id, us);
  if (base.game === "champions") throw new Error("native builds only");
  return {
    ...base, abilityId: spec.abilityId, abilityActive: spec.abilityId === "imposter" ? true : base.abilityActive, itemId: spec.itemId ?? "",
    ...(spec.configuration ? { configuration: spec.configuration } : {}),
    native: { ...base.native, level: spec.level ?? 50, evs: { ...base.native.evs, ...spec.evs }, ivs: IVS(spec.ivs), ...(spec.innate ? { innateIVs: IVS(spec.innate) } : {}) },
  };
}
function rows(attacker: BattleBuild, defender: BattleBuild, contexts: Record<string, MoveContext> = {}) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles" }, contexts, us);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results;
}
const row = (moveId: string, attacker: BattleBuild, defender: BattleBuild, context?: MoveContext) =>
  rows(attacker, defender, context ? { [moveId]: context } : {}).find((result) => result.moveId === moveId)!;
const range = (result: { min: number | null; max: number | null }) => `${result.min}-${result.max}`;
const ditto = (spec: Partial<Spec> = {}) => build("ditto", { abilityId: "imposter", ...spec });
const magnezone = (spec: Partial<Spec> = {}) => build("magnezone", { abilityId: "magnetpull", ...spec });

describe("a transformed Imposter Ditto's Hidden Power (Ultra Sun/Ultra Moon)", () => {
  it("takes its type from Ditto's own IVs, not the target's IVs with Ditto's HP IV", () => {
    // All-30 Ditto has Hidden Power Fighting; the mix with all-31 Magnezone would be Dragon (16-19).
    const intoMagnezone = row("hiddenpower", ditto({ ivs: ALL30 }), magnezone());
    expect(intoMagnezone).toMatchObject({ kind: "calculated", effectiveType: "Fighting", effectivePower: 60, min: 64, max: 76 });
    expect(intoMagnezone.rolls).toEqual([64, 64, 66, 66, 66, 68, 68, 68, 70, 70, 72, 72, 72, 74, 74, 76]);
    expect(intoMagnezone.assumptions).toContain("Hidden Power Fighting, 60 power: Transform keeps Ditto's own Hidden Power type, from its own IVs.");
    expect(row("hiddenpower", ditto({ ivs: ALL30 }), build("snorlax", { abilityId: "thickfat" }))).toMatchObject({ effectiveType: "Fighting", min: 32, max: 38 });
    // All-31 Ditto keeps Dark against an HP Fire (atk/spa/spe 30) or HP Ice (atk/def 30) Magnezone.
    expect(row("hiddenpower", ditto(), magnezone({ ivs: FIRE }))).toMatchObject({ effectiveType: "Dark", min: 32, max: 38 });
    expect(row("hiddenpower", ditto(), magnezone({ ivs: ICE }))).toMatchObject({ effectiveType: "Dark", min: 32, max: 38 });
    // HP Fire Ditto against an HP-30 (Dragon) Magnezone.
    expect(row("hiddenpower", ditto({ ivs: FIRE }), magnezone({ ivs: { hp: 30 } }))).toMatchObject({ effectiveType: "Fire", min: 64, max: 76 });
  });

  it("ignores the target's declared type and uses Ditto's own", () => {
    const fireMagnezone = magnezone({ ivs: FIRE, configuration: { hiddenPowerType: "Fire" } });
    expect(row("hiddenpower", ditto(), fireMagnezone)).toMatchObject({ kind: "calculated", effectiveType: "Dark", min: 32, max: 38 });
    expect(row("hiddenpower", ditto({ ivs: ICE, configuration: { hiddenPowerType: "Ice" } }), fireMagnezone)).toMatchObject({ kind: "calculated", effectiveType: "Ice", min: 16, max: 19 });
    expect(row("hiddenpower", ditto({ ivs: ALL30, configuration: { hiddenPowerType: "Fighting" } }), magnezone())).toMatchObject({ effectiveType: "Fighting", min: 64, max: 76 });
    // Ditto's own declared type must still match its own innate IVs.
    expect(row("hiddenpower", ditto({ configuration: { hiddenPowerType: "Fire" } }), magnezone())).toMatchObject({ kind: "needs-context", reason: expect.stringContaining("innate IVs") });
  });

  it("reads Ditto's own innate IVs when either Pokémon is Hyper Trained (level 100)", () => {
    expect(row("hiddenpower", ditto({ level: 100, innate: ALL30 }), magnezone({ level: 100 }))).toMatchObject({ effectiveType: "Fighting", min: 120, max: 142 });
    expect(row("hiddenpower", ditto({ level: 100, innate: FIRE, configuration: { hiddenPowerType: "Fire" } }), magnezone({ level: 100 }))).toMatchObject({ effectiveType: "Fire", min: 120, max: 142 });
    expect(row("hiddenpower", ditto({ level: 100 }), magnezone({ level: 100, innate: FIRE, configuration: { hiddenPowerType: "Fire" } }))).toMatchObject({ effectiveType: "Dark", min: 60, max: 71 });
  });

  it("calculates only Hidden Power and the typed entry of Ditto's own type", () => {
    const results = rows(ditto({ ivs: ALL30 }), magnezone({ ivs: FIRE }));
    const hiddenPower = results.filter((result) => result.moveId.startsWith("hiddenpower"));
    expect(hiddenPower).toHaveLength(17);
    expect(hiddenPower.filter((result) => result.kind === "calculated").map((result) => [result.moveId, result.effectiveType, range(result)]))
      .toEqual([["hiddenpower", "Fighting", "64-76"], ["hiddenpowerfighting", "Fighting", "64-76"]]);
    expect(hiddenPower.find((result) => result.moveId === "hiddenpowerfire")).toMatchObject({
      kind: "needs-context", reason: "Transform keeps Ditto's own Hidden Power type, Fighting, so its copy of this move is Hidden Power Fighting.",
    });
  });

  it("follows team imports: the target's Hidden Power [Fire] does not become Ditto's", () => {
    const paste = ["Ditto", "Ability: Imposter", "Level: 50", "IVs: 30 HP / 30 Atk / 30 Def / 30 SpA / 30 SpD / 30 Spe", "- Transform", "",
      "Magnezone", "Ability: Magnet Pull", "Level: 50", "IVs: 30 Atk / 30 SpA / 30 Spe", "- Hidden Power [Fire]"].join("\n");
    const [imposter, target] = parseTeamImport(paste, "traditional", us).members.map((member) => member.build!);
    expect(target.configuration?.hiddenPowerType).toBe("Fire");
    const calculated = rows({ ...imposter, abilityActive: true }, target).filter((result) => result.moveId.startsWith("hiddenpower") && result.kind === "calculated");
    expect(calculated.map((result) => [result.moveId, result.effectiveType, range(result)])).toEqual([["hiddenpower", "Fighting", "64-76"], ["hiddenpowerfighting", "Fighting", "64-76"]]);
  });

  it("keeps Normalize, Z-Moves, Trace and a transformed target as before", () => {
    const normalize = row("hiddenpower", ditto({ ivs: ALL30 }), build("delcatty", { abilityId: "normalize" }));
    expect(normalize).toMatchObject({ effectiveType: "Fighting", min: 46, max: 56 });
    expect(normalize.assumptions).toContain("Normalize does not change Hidden Power's type, so it gets no Normalize boost.");
    expect(row("hiddenpower", ditto({ ivs: ALL30, itemId: "normaliumz" }), magnezone(), { useZ: true })).toMatchObject({ effectiveName: "Breakneck Blitz", effectiveType: "Normal", effectivePower: 120, min: 31, max: 37 });
    expect(row("hiddenpower", build("porygon2", { abilityId: "trace", ivs: ALL30 }), magnezone({ ivs: FIRE }))).toMatchObject({ effectiveType: "Fighting", min: 54, max: 64 });
    expect(row("hiddenpower", magnezone({ ivs: FIRE }), ditto({ ivs: ALL30 }))).toMatchObject({ effectiveType: "Fire", min: 64, max: 76 });
  });
});

describe("a transformed Imposter Ditto's happiness (Ultra Sun/Ultra Moon)", () => {
  it("powers Return and Frustration by Ditto's own happiness", () => {
    const snorlax = (configuration?: SetConfiguration) => build("snorlax", { abilityId: "thickfat", configuration });
    expect(row("return", ditto(), snorlax({ happiness: 0 }))).toMatchObject({ effectivePower: 102, min: 88, max: 105 });
    expect(row("return", ditto({ configuration: { happiness: 0 } }), snorlax())).toMatchObject({ effectivePower: 1, min: 1, max: 3 });
    expect(row("frustration", ditto({ configuration: { happiness: 0 } }), snorlax())).toMatchObject({ effectivePower: 102, min: 88, max: 105 });
    expect(row("frustration", ditto(), snorlax({ happiness: 0 }))).toMatchObject({ effectivePower: 1, min: 1, max: 3 });
  });
});
