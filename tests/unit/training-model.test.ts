import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { DOUBLES_SLOTS, SHOWDOWN_POSITION, type DoublesSideId, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { createMoveSlots } from "@/app/lib/battle/move-defaults";
import { createBuild } from "@/app/lib/battle/model";
import type { BattleBuild, NativeBuild } from "@/app/lib/battle/types";
import {
  DEFAULT_BUDGET, DEFAULT_MEGA_POLICY,
  type DecisionStats, type MegaPolicy, type PreviewContext, type SlotContext, type SwitchContext, type TurnContext, type TurnRecord,
} from "@/app/(app)/training/model/decision";
import { FORMAT_FACTS, TRAINING_LABEL, formatFacts } from "@/app/(app)/training/model/format-facts";
import {
  CLOSED_TEAM_SHEETS, DEFAULT_INFO, INFO_PRESETS, OPEN_TEAM_SHEETS, PERFECT_INFORMATION, SHEET_FIELDS,
  infoFact, parseInfoSettings, presetOf, sameView, usesTestSettings, type InfoView, type SheetField,
} from "@/app/(app)/training/model/info";
import { showdownPosition, slotAt, targetLoc } from "@/app/(app)/training/model/positions";
import { createRandom, fnv1a32, seedHex } from "@/app/(app)/training/model/random";
import { showdownNature } from "@/app/(app)/training/model/sets";
import { redactSheet, sheetFromTeam, type FullSheetMember } from "@/app/(app)/training/model/sheet";
import {
  PROTECT_ADDED_FACT, SUGGESTION_LABEL, USAGE_SOURCE_FACT,
  type EditorMoveOption, type SuggestedSet, type SuggestMember, type TrainingUsageData,
} from "@/app/(app)/training/model/usage";
import {
  jointActionKey, megaSlots, slotActionKey, withoutMega,
  type DecisionReport, type JointAction, type MegaFact, type TrainingSnapshot, type TrainingTeam,
} from "@/app/(app)/training/model/view-types";
import type { FromWorker, ToWorker } from "@/app/(app)/training/model/worker-protocol";

// STEP 0 contract (SPEC §13.1, addendum A1.1–A1.5): the model/* helpers return the values the spec states.

const modelDir = join(__dirname, "..", "..", "app", "(app)", "training", "model");
const SIDE_INDEX = { p1: 0, p2: 1 } as const;

describe("positions", () => {
  it("showdownPosition for an AI on p2 equals SHOWDOWN_POSITION (doubles-types.ts:40)", () => {
    for (const slot of DOUBLES_SLOTS) {
      const { side, position } = showdownPosition(slot, "p2");
      expect({ side: SIDE_INDEX[side], position }, slot).toEqual(SHOWDOWN_POSITION[slot]);
    }
  });

  it("mirrors the sides for an AI on p1, and slotAt inverts showdownPosition", () => {
    expect(showdownPosition("own-left", "p1")).toEqual({ side: "p2", position: 0 });
    expect(showdownPosition("opponent-right", "p1")).toEqual({ side: "p1", position: 0 });
    expect(showdownPosition("opponent-left", "p1")).toEqual({ side: "p1", position: 1 });
    for (const aiSide of ["p1", "p2"] as const) {
      for (const slot of DOUBLES_SLOTS) {
        const { side, position } = showdownPosition(slot, aiSide);
        expect(slotAt(side, position, aiSide), `${aiSide} ${slot}`).toBe(slot);
      }
    }
  });

  it("targetLoc is negative for the actor's own side and positive for the foes (sim/pokemon.ts getLocOf)", () => {
    // AI = p2: its position 0 is opponent-right, position 1 opponent-left.
    expect(DOUBLES_SLOTS.map((slot) => targetLoc(slot, "p2", "p2"))).toEqual([1, 2, -2, -1]);
    expect(DOUBLES_SLOTS.map((slot) => targetLoc(slot, "p1", "p2"))).toEqual([-1, -2, 2, 1]);
    // AI = p1: the engine's own side is p2.
    expect(DOUBLES_SLOTS.map((slot) => targetLoc(slot, "p1", "p1"))).toEqual([1, 2, -2, -1]);
    expect(DOUBLES_SLOTS.map((slot) => targetLoc(slot, "p2", "p1"))).toEqual([-1, -2, 2, 1]);
  });
});

describe("action keys", () => {
  const closeCombat: SlotAction = { kind: "move", moveId: "closecombat", target: "opponent-left" };
  it("slotActionKey is stable", () => {
    expect(slotActionKey({ kind: "move", moveId: "protect", target: null })).toBe("move:protect:-");
    expect(slotActionKey(closeCombat)).toBe("move:closecombat:opponent-left");
    expect(slotActionKey({ ...closeCombat, mega: "mega" })).toBe("move:closecombat:opponent-left:mega");
    expect(slotActionKey({ kind: "move", moveId: "heatwave", target: null, mega: "megay" })).toBe("move:heatwave:-:megay");
    expect(slotActionKey({ kind: "switch", to: "garchomp" })).toBe("switch:garchomp");
    expect(slotActionKey({ kind: "pass" })).toBe("pass");
  });

  it("jointActionKey follows slot order, not insertion order", () => {
    const a: JointAction = { "own-right": { kind: "pass" }, "own-left": closeCombat };
    const b: JointAction = { "own-left": closeCombat, "own-right": { kind: "pass" } };
    expect(jointActionKey(a)).toBe("own-left=move:closecombat:opponent-left;own-right=pass");
    expect(jointActionKey(b)).toBe(jointActionKey(a));
    expect(jointActionKey({})).toBe("");
  });

  it("megaSlots and withoutMega (addendum A1.5)", () => {
    const mega: JointAction = {
      "opponent-left": { kind: "move", moveId: "heatwave", target: null, mega: "megay" },
      "opponent-right": { kind: "switch", to: "incineroar" },
    };
    expect(megaSlots(mega)).toEqual(["opponent-left"]);
    const plain = withoutMega(mega);
    expect(megaSlots(plain)).toEqual([]);
    expect(plain).toEqual({ "opponent-left": { kind: "move", moveId: "heatwave", target: null }, "opponent-right": { kind: "switch", to: "incineroar" } });
    expect(jointActionKey(plain)).toBe("opponent-left=move:heatwave:-;opponent-right=switch:incineroar");
    expect(jointActionKey(mega)).not.toBe(jointActionKey(plain));
    expect(mega["opponent-left"]).toEqual({ kind: "move", moveId: "heatwave", target: null, mega: "megay" });
    expect(withoutMega(plain)).toEqual(plain);
    expect(megaSlots({ "own-left": { kind: "pass" } })).toEqual([]);
  });
});
type SlotAction = NonNullable<JointAction[DoublesSlotId]>;

describe("random", () => {
  it("FNV-1a and sfc32 are deterministic per parts (G4)", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    const a = createRandom("aiBase", 7, "ai"), b = createRandom("aiBase", 7, "ai"), c = createRandom("aiBase", 8, "ai");
    const draws = (random: ReturnType<typeof createRandom>) => Array.from({ length: 64 }, () => random.float());
    const first = draws(a);
    expect(draws(b)).toEqual(first);
    expect(draws(c)).not.toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
    const pinned = createRandom("aiBase", 7, "ai");
    expect([pinned.float(), pinned.float(), pinned.float()]).toEqual([0.5161066979635507, 0.5769589219707996, 0.8975536352954805]);
    expect([pinned.int(6), pinned.int(6), pinned.int(100)]).toEqual([1, 0, 99]);
  });

  it("seedHex gives 32 hex digits for a sodium seed", () => {
    expect(seedHex("run", 0, "battle")).toBe("3d4772b9b3537a8a0a5b9f9a3bada307");
    expect(seedHex("0123456789abcdef0123456789abcdef", 3)).toBe("3865657c6ca26ce3d8d588a7ec4596fb");
    expect(seedHex("run", 1, "battle")).toMatch(/^[0-9a-f]{32}$/);
    expect(seedHex("run", 1, "battle")).not.toBe(seedHex("run", 0, "battle"));
  });
});

describe("showdownNature (SPEC C15)", () => {
  it("turns Serious with 0 Stat Points into Hardy and leaves everything else", () => {
    const fresh = createBuild("garchomp");
    expect(fresh.nature).toBe("Serious");
    expect(showdownNature(fresh)).toEqual({ ...fresh, nature: "Hardy" });
    const nulls: BattleBuild = { ...fresh, points: { hp: null, atk: null, def: null, spa: null, spd: null, spe: null } };
    expect(showdownNature(nulls).nature).toBe("Hardy");
    const invested: BattleBuild = { ...fresh, points: { ...fresh.points, spe: 2 } };
    expect(showdownNature(invested)).toBe(invested);
    const jolly: BattleBuild = { ...fresh, nature: "Jolly" };
    expect(showdownNature(jolly)).toBe(jolly);
    const native: NativeBuild = {
      speciesId: "garchomp", nature: "Serious", abilityId: fresh.abilityId, abilityActive: fresh.abilityActive, itemId: "", boosts: fresh.boosts,
      currentHP: null, status: "", game: "scarlet_violet",
      native: { level: 50, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } },
    };
    expect(showdownNature(native)).toBe(native);
  });
});

describe("sheets", () => {
  const full: FullSheetMember[] = [{
    key: "garchomp", speciesId: "garchomp", name: "Garchomp", gender: "M", nature: "Jolly", itemId: "lifeorb", abilityId: "roughskin",
    moves: ["earthquake", "rockslide", "dragonclaw", "protect"], points: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
  }];
  const fieldValue: Record<SheetField, keyof FullSheetMember> = { statPoints: "points", natures: "nature", items: "itemId", abilities: "abilityId", moves: "moves" };

  it("redactSheet nulls exactly the closed fields", () => {
    for (const open of SHEET_FIELDS) {
      const view: InfoView = { ...CLOSED_TEAM_SHEETS, open: { ...CLOSED_TEAM_SHEETS.open, [open]: true } };
      const [member] = redactSheet(full, view).members;
      expect({ key: member.key, speciesId: member.speciesId, name: member.name, gender: member.gender }).toEqual({ key: "garchomp", speciesId: "garchomp", name: "Garchomp", gender: "M" });
      for (const field of SHEET_FIELDS) {
        const value = member[fieldValue[field] as keyof typeof member];
        if (field === open) expect(value, field).toEqual(full[0][fieldValue[field]]);
        else expect(value, `${open} open, ${field} closed`).toBeNull();
      }
    }
  });

  it("redactSheet copies the open values and passes the view", () => {
    const sheet = redactSheet(full, PERFECT_INFORMATION);
    expect(sheet.info).toBe(PERFECT_INFORMATION);
    expect(sheet.members[0].moves).toEqual(full[0].moves);
    expect(sheet.members[0].moves).not.toBe(full[0].moves);
    expect(sheet.members[0].points).not.toBe(full[0].points);
    const open = redactSheet(full, OPEN_TEAM_SHEETS).members[0];
    expect(open.points).toBeNull();
    expect(open.nature).toBe("Jolly");
    expect(open.itemId).toBe("lifeorb");
  });

  it("sheetFromTeam: Hardy for a fresh suggested build, distinct moves, gender null", () => {
    const build = createBuild("garchomp");
    const moves = createMoveSlots("garchomp", "Doubles");
    moves[3] = { ...moves[0] };
    const team: TrainingTeam = { label: "Home", members: [{ key: "k", name: "Garchomp", speciesId: "garchomp", build, moves, origin: "suggested", suggestion: { source: "no-usage", protectAdded: false } }] };
    const [member] = sheetFromTeam(team);
    expect(member).toEqual({
      key: "k", speciesId: "garchomp", name: "Garchomp", gender: null, nature: "Hardy", itemId: build.itemId, abilityId: build.abilityId,
      moves: [...new Set(moves.map((slot) => slot.moveId).filter((id): id is string => !!id))], points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    });
    expect(member.moves.length).toBeLessThan(4);
  });
});

describe("information settings", () => {
  it("infoFact for the three presets", () => {
    expect(infoFact(OPEN_TEAM_SHEETS)).toBe("Open: Natures · Items · Abilities · Moves · Closed: Stat Points");
    expect(infoFact(CLOSED_TEAM_SHEETS)).toBe("Closed: Stat Points · Natures · Items · Abilities · Moves");
    expect(infoFact(PERFECT_INFORMATION)).toBe("Open: Stat Points · Natures · Items · Abilities · Moves · Test: exact HP · brought Pokémon");
    expect(infoFact({ ...OPEN_TEAM_SHEETS, brought: true })).toBe("Open: Natures · Items · Abilities · Moves · Closed: Stat Points · Test: brought Pokémon");
  });

  it("presetOf names each preset and returns null for a custom view", () => {
    expect(presetOf(OPEN_TEAM_SHEETS)).toBe("open");
    expect(presetOf(CLOSED_TEAM_SHEETS)).toBe("closed");
    expect(presetOf(PERFECT_INFORMATION)).toBe("perfect");
    expect(presetOf({ ...OPEN_TEAM_SHEETS, open: { ...OPEN_TEAM_SHEETS.open, items: false } })).toBeNull();
    expect(presetOf({ ...PERFECT_INFORMATION, exactHP: false })).toBeNull();
    expect(Object.values(INFO_PRESETS).map((preset) => preset.label)).toEqual(["Champions open team sheets", "Closed team sheets", "Perfect information (test)"]);
    expect(DEFAULT_INFO).toEqual({ aiKnows: OPEN_TEAM_SHEETS, youSee: OPEN_TEAM_SHEETS });
    expect(usesTestSettings(OPEN_TEAM_SHEETS)).toBe(false);
    expect(usesTestSettings({ ...OPEN_TEAM_SHEETS, exactHP: true })).toBe(true);
  });

  it("parseInfoSettings falls back on malformed data", () => {
    for (const value of [undefined, null, "open", 7, [], { aiKnows: 5, youSee: "x" }, { aiKnows: { open: null } }]) {
      const parsed = parseInfoSettings(value);
      expect(sameView(parsed.aiKnows, DEFAULT_INFO.aiKnows), JSON.stringify(value)).toBe(true);
      expect(sameView(parsed.youSee, DEFAULT_INFO.youSee), JSON.stringify(value)).toBe(true);
    }
    const parsed = parseInfoSettings({ aiKnows: { open: { statPoints: true, natures: "yes", items: 0 } }, youSee: { open: { moves: false } } });
    expect(parsed.aiKnows.open).toEqual({ statPoints: true, natures: true, items: true, abilities: true, moves: true });
    expect(parsed.youSee.open).toEqual({ statPoints: false, natures: true, items: true, abilities: true, moves: false });
  });

  it("parseInfoSettings always turns the test extras off (I2)", () => {
    const stored = JSON.parse(JSON.stringify({ aiKnows: PERFECT_INFORMATION, youSee: { ...CLOSED_TEAM_SHEETS, exactHP: true, brought: true } }));
    const parsed = parseInfoSettings(stored);
    expect(parsed.aiKnows).toEqual({ ...PERFECT_INFORMATION, exactHP: false, brought: false });
    expect(parsed.youSee).toEqual(CLOSED_TEAM_SHEETS);
    expect(usesTestSettings(parsed.aiKnows) || usesTestSettings(parsed.youSee)).toBe(false);
    expect(presetOf(parsed.aiKnows)).toBeNull();
    expect(presetOf(parseInfoSettings(JSON.parse(JSON.stringify(DEFAULT_INFO))).aiKnows)).toBe("open");
  });
});

describe("format facts and addendum constants", () => {
  it("lists the static facts, the usage source (A1.1) and both information lines", () => {
    expect(TRAINING_LABEL).toBe("Training");
    expect(FORMAT_FACTS.map((fact) => fact.term)).toEqual(["Format", "Battle", "Teams", "Clauses", "Mega Evolution", "Terastallization", "Timer", "AI", "Battles", "Rules", "Usage"]);
    expect(FORMAT_FACTS.find((fact) => fact.term === "Usage")?.value).toBe("Smogon 2026-08 VGC Reg M-B");
    expect(USAGE_SOURCE_FACT).toBe("Smogon 2026-08 VGC Reg M-B");
    expect(formatFacts(DEFAULT_INFO).slice(-2)).toEqual([
      { term: "AI knows", value: "Open: Natures · Items · Abilities · Moves · Closed: Stat Points" },
      { term: "You see", value: "Open: Natures · Items · Abilities · Moves · Closed: Stat Points" },
    ]);
  });

  it("labels and defaults", () => {
    expect(SUGGESTION_LABEL).toEqual({ usage: "Suggested set", "no-usage": "Suggested set (no usage data)" });
    expect(PROTECT_ADDED_FACT).toBe("Protect added");
    expect(DEFAULT_MEGA_POLICY).toBe("per-turn");
    // A1.5 keeps the decision budget (SPEC 15): rollouts are trimmed first on Mega turns.
    expect(DEFAULT_BUDGET).toEqual({ engineCalls: 240, rolloutSamples: 160, stageASamples: 2, stageBSamples: 8, worlds: 4 });
  });
});

describe("contract shape", () => {
  it("model files import values only from model/ and doubles-types (no simulator, engine, data or React)", () => {
    const files = readdirSync(modelDir).filter((file) => file.endsWith(".ts"));
    expect(files.sort()).toEqual([
      "ai-inputs.ts", "ai-view.ts", "decision.ts", "format-facts.ts", "habits-data.ts", "info.ts", "positions.ts", "public-state.ts", "random.ts", "saved-battle.ts",
      "sets.ts", "sheet.ts", "showdown-types.ts", "usage.ts", "view-types.ts", "worker-protocol.ts",
    ]);
    for (const file of files) {
      const source = readFileSync(join(modelDir, file), "utf8");
      for (const [, clause, from] of source.matchAll(/^import\s+(.*?)\s+from\s+"([^"]+)";/gm)) {
        if (clause.startsWith("type ")) continue;
        const values = clause.replace(/[{}]/g, "").split(",").map((part) => part.trim()).filter((part) => part && !part.startsWith("type "));
        if (!values.length) continue;
        expect(from.startsWith("./") || from === "@/app/lib/battle/doubles-types", `${file}: ${clause} from ${from}`).toBe(true);
      }
      expect(source, file).not.toMatch(/showdown-sim|\.json"|from "react|console\.log/);
    }
  });

  it("every file the addendum extends says so in its first line", () => {
    for (const file of ["usage.ts", "view-types.ts", "decision.ts", "worker-protocol.ts", "format-facts.ts"]) {
      expect(readFileSync(join(modelDir, file), "utf8").split("\n")[0], file).toMatch(/^\/\/ Addendum A1\./);
    }
  });

  it("types the addendum messages and fields", () => {
    expectTypeOf<Extract<ToWorker, { type: "suggest" }>>().toEqualTypeOf<{ type: "suggest"; key: string; side: DoublesSideId; members: SuggestMember[] }>();
    expectTypeOf<Extract<ToWorker, { type: "move-options" }>>().toEqualTypeOf<{ type: "move-options"; speciesId: string }>();
    expectTypeOf<Extract<FromWorker, { type: "suggested" }>["sets"]>().toEqualTypeOf<SuggestedSet[]>();
    expectTypeOf<Extract<FromWorker, { type: "move-options-ready" }>["moves"]>().toEqualTypeOf<EditorMoveOption[]>();
    expectTypeOf<DecisionReport["mega"]>().toEqualTypeOf<MegaFact | null>();
    expectTypeOf<TurnRecord["observedMega"]>().toEqualTypeOf<DoublesSlotId | null>();
    expectTypeOf<SlotContext["canMega"]>().toEqualTypeOf<boolean>();
    expectTypeOf<DecisionStats["statusOptions"]>().toEqualTypeOf<{ its: number; yours: number }>();
    expectTypeOf<keyof TrainingSnapshot>().toEqualTypeOf<"revision" | "engine" | "draft" | "validation" | "habits" | "trendsOpen" | "setupError" | "battle" | "suggestions" | "moveOptions" | "saved" | "replay">();
    expectTypeOf<MegaPolicy>().toEqualTypeOf<"per-turn" | "first-chance">();
    expectTypeOf<PreviewContext["usage"]>().toEqualTypeOf<TrainingUsageData>();
    expectTypeOf<TurnContext["usage"]>().toEqualTypeOf<TrainingUsageData>();
    expectTypeOf<SwitchContext["usage"]>().toEqualTypeOf<TrainingUsageData>();
  });
});
