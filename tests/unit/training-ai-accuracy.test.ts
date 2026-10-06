import { describe, expect, it } from "vitest";
import { effectiveAccuracy } from "@/app/(app)/training/ai/accuracy";
import { makeView, runtime, type MonSpec } from "../fixtures/training-ai";

/** SPEC 10.3 against pinned Showdown's hitStepAccuracy (PS/sim/battle-actions.ts:690-740) and its accuracy handlers. */
const user = (changes: Partial<MonSpec> = {}): MonSpec => ({ side: "opponent", species: "garchomp", slot: "opponent-left", moves: ["rockslide", "stoneedge", "thunder"], ...changes });
const foe = (changes: Partial<MonSpec> = {}): MonSpec => ({ side: "own", species: "incineroar", slot: "own-left", moves: ["fakeout"], ...changes });
const acc = (actor: MonSpec, target: MonSpec, moveId: string, field = {}) => {
  const view = makeView([actor, target], { field });
  return effectiveAccuracy(view, view.mons[0].key, moveId, view.mons[1].key, runtime);
};

describe("effectiveAccuracy", () => {
  it("reads the base accuracy; accuracy true never misses", () => {
    expect(acc(user(), foe(), "rockslide")).toBeCloseTo(0.9, 12);
    expect(acc(user(), foe(), "stoneedge")).toBeCloseTo(0.8, 12);
    expect(acc(user({ moves: ["aerialace"] }), foe(), "aerialace")).toBe(1);
    expect(acc(user({ moves: ["protect"] }), foe(), "protect")).toBe(1);
  });

  it("applies accuracy − evasion stages, clamped to ±6", () => {
    expect(acc(user({ accuracyStage: 1 }), foe(), "stoneedge")).toBeCloseTo(0.8 * 4 / 3 > 1 ? 1 : 0.8 * 4 / 3, 12);
    expect(acc(user(), foe({ evasionStage: 1 }), "stoneedge")).toBeCloseTo(0.8 * 3 / 4, 12);
    expect(acc(user({ accuracyStage: -2 }), foe({ evasionStage: 6 }), "stoneedge")).toBeCloseTo(0.8 * 3 / 9, 12);
    // Keen Eye ignores the target's evasion.
    expect(acc(user({ species: "lycanroc", ability: "keeneye", moves: ["stoneedge"] }), foe({ evasionStage: 2 }), "stoneedge")).toBe(0.8);
  });

  it("applies the ModifyAccuracy modifiers", () => {
    expect(acc(user({ ability: "compoundeyes" }), foe(), "stoneedge")).toBe(1);
    expect(acc(user({ ability: "compoundeyes" }), foe({ evasionStage: 1 }), "stoneedge")).toBeCloseTo(0.8 * 5325 / 4096 * 3 / 4, 12);
    expect(acc(user({ ability: "hustle" }), foe(), "stoneedge")).toBeCloseTo(0.8 * 3277 / 4096, 12);
    expect(acc(user({ item: "widelens" }), foe(), "stoneedge")).toBeCloseTo(0.8 * 4505 / 4096, 12);
    expect(acc(user(), foe({ item: "brightpowder" }), "stoneedge")).toBeCloseTo(0.8 * 3686 / 4096, 12);
    expect(acc(user(), foe({ species: "garchomp", ability: "sandveil" }), "stoneedge", { weather: "Sand" })).toBeCloseTo(0.8 * 3277 / 4096, 12);
    expect(acc(user(), foe({ species: "garchomp", ability: "sandveil" }), "stoneedge")).toBeCloseTo(0.8, 12);
    expect(acc(user(), foe(), "stoneedge", { gravity: true })).toBe(1);
    expect(acc(user(), foe(), "rockslide", { gravity: true })).toBe(1);
  });

  it("No Guard on either side always hits", () => {
    expect(acc(user({ species: "machamp", ability: "noguard", moves: ["dynamicpunch"] }), foe(), "dynamicpunch")).toBe(1);
    expect(acc(user(), foe({ species: "machamp", ability: "noguard" }), "stoneedge")).toBe(1);
  });

  it("weather moves: Thunder sure in rain and 50 in sun; Blizzard sure in snow; Cloud Nine negates the weather", () => {
    expect(acc(user(), foe(), "thunder")).toBeCloseTo(0.7, 12);
    expect(acc(user(), foe(), "thunder", { weather: "Rain" })).toBe(1);
    expect(acc(user(), foe(), "thunder", { weather: "Sun" })).toBeCloseTo(0.5, 12);
    expect(acc(user({ species: "abomasnow", moves: ["blizzard"] }), foe(), "blizzard", { weather: "Snow" })).toBe(1);
    expect(acc(user({ species: "abomasnow", moves: ["blizzard"] }), foe(), "blizzard")).toBeCloseTo(0.7, 12);
    const view = makeView([user(), foe({ species: "altaria", ability: "cloudnine", moves: ["dracometeor"] })], { field: { weather: "Rain" } });
    expect(effectiveAccuracy(view, view.mons[0].key, "thunder", view.mons[1].key, runtime)).toBeCloseTo(0.7, 12);
  });

  it("Toxic from a Poison type and OHKO moves", () => {
    expect(acc(user({ species: "toxapex", moves: ["toxic"] }), foe(), "toxic")).toBe(1);
    expect(acc(user({ species: "garchomp", moves: ["toxic"] }), foe(), "toxic")).toBeCloseTo(0.9, 12);
    expect(acc(user({ species: "glalie", moves: ["sheercold"] }), foe(), "sheercold")).toBeCloseTo(0.3, 12);
    expect(acc(user({ moves: ["sheercold"] }), foe(), "sheercold")).toBeCloseTo(0.2, 12);
  });
});
