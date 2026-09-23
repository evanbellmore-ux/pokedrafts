import { createElement, isValidElement, type ChangeEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PokePasteImporter, { type ImportDraft } from "@/app/(app)/calculator/PokePasteImporter";
import * as fieldControl from "@/app/components/ui/Field";
import * as inputControl from "@/app/components/ui/Input";
import * as selectControl from "@/app/components/ui/Select";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, createBattleRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { MAX_TEAM_IMPORT_BYTES, MAX_TEAM_IMPORT_MEMBERS, parseTeamImport, type ImportFormat } from "@/app/lib/battle/team-import";
import type { ChampionsSpecies, NativeBattleGame, StatTable } from "@/app/lib/battle/types";

const CHARIZARD = "Charizard\nAbility: Blaze\nEVs: 32 SpA / 32 Spe / 2 HP\nTimid Nature\n- Flamethrower\n- Protect";
const zero: StatTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const perfect: StatTable = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

/** Small, explicit catalog fixtures test importer boundaries, not native data availability. */
function nativeRuntime(game: NativeBattleGame, patch: Partial<ChampionsSpecies> = {}): BattleRuntime {
  const charizard = championsRuntime.speciesById.get("charizard")!;
  return createBattleRuntime({
    ...championsRuntime.catalog,
    game,
    level: null,
    species: [{ ...charizard, moves: [...charizard.moves, "hiddenpower", "frustration", "return"], ...patch }],
    moves: [
      ...championsRuntime.catalog.moves,
      ...["hiddenpower", "frustration", "return"].map((id) => ({
        id, name: id === "hiddenpower" ? "Hidden Power" : id === "frustration" ? "Frustration" : "Return",
        type: "Normal", category: id === "hiddenpower" ? "Special" as const : "Physical" as const,
        power: id === "hiddenpower" ? 60 : 1, accuracy: 100, priority: 0, target: "normal",
        multihit: null, ohko: false, description: "Explicit importer fixture", unsupported: [],
      })),
    ],
  }, "1".repeat(64));
}

function member(text: string, format: ImportFormat = "traditional", runtime = nativeRuntime("scarlet_violet")) {
  const team = parseTeamImport(text, format, runtime);
  expect(team.members).toHaveLength(1);
  return team.members[0];
}

function errors(value: ReturnType<typeof member>) {
  return value.diagnostics.filter((entry) => entry.severity === "error");
}

describe("game-aware team import", () => {
  it("keeps a Champions Fighting Tera set Ready with unchanged inactive damage", () => {
    const plain = parseTeamImport(CHARIZARD, "champions").members[0];
    const tera = parseTeamImport(`${CHARIZARD}\nTera Type: Fighting`, "champions").members[0];
    expect(errors(tera)).toEqual([]);
    expect(tera.selectable).toBe(true);
    expect(tera.build?.game).toBe("champions");
    expect(tera.build?.configuration).toEqual({ teraType: "Fighting" });
    expect(tera.build?.mechanic).toBeUndefined();
    expect(tera.stats).toEqual(plain.stats);
    expect(tera.diagnostics).toContainEqual(expect.objectContaining({ severity: "info", message: expect.stringMatching(/retained; inactive in Champions/i) }));
    const defender = createBuild("blastoise");
    const conditions = createConditions();
    const before = calculateMatchup(plain.build!, defender, conditions);
    const after = calculateMatchup(tera.build!, defender, conditions);
    expect(before.results.find((row) => row.moveId === "flamethrower")?.kind).toBe("calculated");
    expect(after.results).toEqual(before.results);
  });

  it.each(["ultra_sun_ultra_moon", "sword_shield", "scarlet_violet"] as const)("retains native levels/EVs/IVs for %s instead of converting them", (game) => {
    const runtime = nativeRuntime(game);
    const text = "Charizard\nLevel: 73\nEVs: 252 SpA / 252 Spe / 4 HP\nIVs: 0 Atk / 7 Def\nTimid Nature\n- Protect\n- Flamethrower";
    const team = parseTeamImport(text, "traditional", runtime);
    const imported = team.members[0];
    expect(team).toMatchObject({ format: "traditional", game, runtimeIdentity: runtime.identity });
    expect(errors(imported)).toEqual([]);
    expect(imported.selectable).toBe(true);
    expect(imported.build).toMatchObject({
      game, native: { level: 73, evs: { ...zero, hp: 4, spa: 252, spe: 252 }, ivs: { ...perfect, atk: 0, def: 7 } },
      preparedMoves: ["protect", "flamethrower"],
    });
    expect(imported.build?.points).toBeUndefined();
    expect(imported.build?.mechanic).toBeUndefined();
    expect(imported.moves.map((slot) => slot.moveId)).toEqual(["protect", "flamethrower", null, null]);
    // Independent native arithmetic, not the Champions level-50 point formula.
    expect(imported.stats?.hp).toBe(Math.floor((2 * 78 + 31 + 1) * 73 / 100) + 73 + 10);
    expect(imported.stats?.spe).toBe(Math.floor((Math.floor((2 * 100 + 31 + 63) * 73 / 100) + 5) * 110 / 100));
  });

  it("clearly defaults omitted native levels to 100 and keeps manual creation at 50", () => {
    const runtime = nativeRuntime("ultra_sun_ultra_moon");
    const imported = member("Charizard", "traditional", runtime);
    expect(imported.build?.native).toEqual({ level: 100, evs: zero, ivs: perfect });
    expect(imported.source?.level).toBeUndefined();
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({ severity: "info", message: expect.stringContaining("native level 100 default") }));
    expect(createBuild("charizard", runtime).native?.level).toBe(50);
  });

  it.each([1, 50, 99, 100])("keeps explicit native level %s", (level) => {
    const imported = member(`Charizard\nLevel: ${level}`);
    expect(errors(imported)).toEqual([]);
    expect(imported.build?.native?.level).toBe(level);
    expect(imported.source?.level).toBe(level);
  });

  it.each(["0", "101", "1.5", "5e1", "50x", "", "-1", "+50", "9007199254740992"])("rejects malformed native level %j without clamping", (level) => {
    const imported = member(`Charizard\nLevel: ${level}`);
    expect(imported.selectable).toBe(false);
    expect(imported.build?.native?.level).toBeNull();
    expect(errors(imported)).toContainEqual(expect.objectContaining({ line: 2, message: expect.stringContaining("whole number from 1 to 100") }));
  });

  it.each(["EVs: 253 HP", "EVs: 252 HP / 252 Def / 8 SpD", "EVs: 1.5 HP", "IVs: 32 HP", "IVs: -1 HP", "IVs: 31 HP / 30 HP"])("rejects invalid native spreads: %s", (line) => {
    const imported = member(`Charizard\n${line}`);
    expect(imported.selectable).toBe(false);
    expect(errors(imported).length).toBeGreaterThan(0);
  });

  it("rejects Champions source encoding in a native game instead of guessing EVs", () => {
    const imported = member(CHARIZARD, "champions");
    expect(imported.selectable).toBe(false);
    expect(imported.build?.native?.evs).toEqual({ hp: null, atk: null, def: null, spa: null, spd: null, spe: null });
    expect(imported.source?.training?.values).toEqual({ ...zero, hp: 2, spa: 32, spe: 32 });
    expect(errors(imported)).toContainEqual(expect.objectContaining({ message: expect.stringContaining("cannot be reverse-converted") }));
  });

  it.each(["SPs", "Stat Points"])("rejects explicit native %s while retaining its original structured values", (label) => {
    const imported = member(`Charizard\n${label}: 32 SpA / 32 Spe / 2 HP`);
    expect(imported.selectable).toBe(false);
    expect(imported.source?.training).toEqual({ label, values: { ...zero, hp: 2, spa: 32, spe: 32 } });
    expect(imported.build?.native?.evs.spa).toBeNull();
  });

  it("preserves original structured spreads, configuration and source lines across Champions conversion", () => {
    const text = "Charizard\nLevel: 50\nEVs: 252 SpA / 252 Spe / 4 HP\nIVs: 30 Atk\nTera Type: Stellar";
    const imported = parseTeamImport(text, "traditional").members[0];
    expect(errors(imported)).toEqual([]);
    expect(imported.build?.points).toEqual({ ...zero, hp: 1, spa: 32, spe: 32 });
    expect(imported.source).toMatchObject({
      format: "traditional", level: 50,
      training: { label: "EVs", values: { ...zero, hp: 4, spa: 252, spe: 252 } },
      ivs: { ...perfect, atk: 30 }, configuration: { teraType: "Stellar" },
    });
    expect(imported.source?.lines.map((line) => line.text).join("\n")).toBe(text);
    imported.build!.configuration!.teraType = "Water";
    imported.build!.points!.hp = 10;
    expect(imported.source?.configuration.teraType).toBe("Stellar");
    expect(imported.source?.training?.values.hp).toBe(4);
    expect(parseTeamImport(text, "traditional").members[0].source).toEqual(imported.source);
  });

  it("does not infer target rules or spread encoding from an exported heading", () => {
    const team = parseTeamImport(`=== [gen9ou] Original format hint ===\n${CHARIZARD}`, "champions");
    expect(team).toMatchObject({ formatHint: "gen9ou", title: "Original format hint", format: "champions", game: "champions" });
    expect(team.members[0].build?.points?.spa).toBe(32);
    expect(team.members[0].build?.preparedMoves).toBeUndefined();
  });
});

describe("recognized set configuration", () => {
  it("retains all valid foreign configuration as inactive info, including false and zero", () => {
    const imported = parseTeamImport("Charizard\nTera Type: sTeLlAr\nGigantamax: No\nDynamax Level: 0\nHappiness: 0\nGender: M\nHidden Power: Ice", "champions").members[0];
    expect(errors(imported)).toEqual([]);
    expect(imported.selectable).toBe(true);
    expect(imported.build?.configuration).toEqual({ teraType: "Stellar", gigantamax: false, dynamaxLevel: 0, happiness: 0, gender: "M", hiddenPowerType: "Ice" });
    expect(imported.build?.mechanic).toBeUndefined();
    expect(imported.diagnostics.filter((entry) => entry.severity === "warning")).toEqual([]);
    expect(imported.diagnostics.filter((entry) => entry.message.includes("inactive in Champions"))).toHaveLength(5);
  });

  it.each(["Tera Type: Unknown", "Tera Type:", "Gigantamax: true", "Dynamax Level: 11", "Dynamax Level: -1", "Dynamax Level: 1.5", "Happiness: 256", "Happiness: -1", "Happiness: 1e2", "Gender: X", "Hidden Power: Fairy", "Hidden Power: Normal", "Hidden Power: Stellar"])("reports malformed metadata rather than silently ignoring %s", (line) => {
    const imported = member(`Charizard\n${line}`);
    expect(imported.selectable).toBe(false);
    expect(errors(imported)).toContainEqual(expect.objectContaining({ line: 2 }));
  });

  it.each(["Tera Type: Fire\nTera Type: Water", "Gigantamax: Yes\nGigantamax: No", "Dynamax Level: 0\nDynamax Level: 10", "Happiness: 0\nHappiness: 255", "Hidden Power: Ice\nHidden Power: Ice", "Gender: M\nGender: F", "Trait: Blaze\nAbility: Blaze"])("rejects duplicate configuration without last-write-wins: %s", (lines) => {
    const imported = member(`Charizard\n${lines}`);
    expect(imported.selectable).toBe(false);
    expect(errors(imported)).toContainEqual(expect.objectContaining({ line: 3, message: expect.stringContaining("Duplicate") }));
  });

  it.each([0, 10])("retains Dynamax level %s without activation", (level) => {
    const imported = member(`Charizard\nGigantamax: Yes\nDynamax Level: ${level}`, "traditional", nativeRuntime("sword_shield", { canGigantamax: "gmaxwildfire" }));
    expect(errors(imported)).toEqual([]);
    expect(imported.build?.configuration).toEqual({ gigantamax: true, dynamaxLevel: level });
    expect(imported.build?.mechanic).toBeUndefined();
  });

  it("reports impossible applicable metadata but not valid foreign configuration", () => {
    const gmax = member("Charizard\nGigantamax: Yes", "traditional", nativeRuntime("sword_shield"));
    expect(errors(gmax)).toContainEqual(expect.objectContaining({ line: 2, message: expect.stringContaining("Gigantamax factor") }));
    const tera = member("Charizard\nTera Type: Water", "traditional", nativeRuntime("scarlet_violet", { requiredTeraType: "Fire" }));
    expect(errors(tera)).toContainEqual(expect.objectContaining({ line: 2, message: expect.stringContaining("requires Tera Fire") }));
    const foreign = member("Charizard\nGigantamax: Yes\nTera Type: Water", "traditional", nativeRuntime("ultra_sun_ultra_moon", { requiredTeraType: "Fire" }));
    expect(errors(foreign)).toEqual([]);
  });

  it.each(["M", "F", "N"] as const)("retains explicit individual gender %s", (gender) => {
    const runtime = nativeRuntime("ultra_sun_ultra_moon", gender === "N" ? { gender: "N" } : {});
    const imported = member(`Charizard\nGender: ${gender}`, "traditional", runtime);
    expect(errors(imported)).toEqual([]);
    expect(imported.gender).toBe(gender);
    expect(imported.build?.configuration?.gender).toBe(gender);
  });

  it("preserves nickname, gender and shiny without replacing exact species identity", () => {
    const imported = member("Sparky (Charizard) (F)\nShiny: Yes\nTrait: Blaze\n~ Protect\n- Flamethrower");
    expect(errors(imported)).toEqual([]);
    expect(imported).toMatchObject({ speciesId: "charizard", name: "Sparky", nickname: "Sparky", gender: "F", shiny: true });
    expect(imported.build?.configuration?.gender).toBe("F");
    expect(imported.moves.map((slot) => slot.moveId)).toEqual(["protect", "flamethrower", null, null]);
    const duplicate = member("Charizard (M)\nGender: F");
    expect(errors(duplicate)).toContainEqual(expect.objectContaining({ line: 2, message: expect.stringContaining("Duplicate gender") }));
    const fixed = member("Charizard\nGender: F", "traditional", nativeRuntime("ultra_sun_ultra_moon", { gender: "N" }));
    expect(errors(fixed)).toContainEqual(expect.objectContaining({ line: 2, message: expect.stringContaining("fixed gender N") }));
  });

  it.each(["Charizard-Gmax", "Torch (Charizard-Gmax) (F)"])("uses verified Gmax alias %s to attach an inactive factor to the actual species", (header) => {
    const runtime = nativeRuntime("sword_shield", { canGigantamax: "gmaxwildfire", gmaxNames: ["Charizard-Gmax"] });
    const imported = member(`${header}\n- Flamethrower`, "traditional", runtime);
    expect(errors(imported)).toEqual([]);
    expect(imported.speciesId).toBe("charizard");
    expect(imported.build?.configuration?.gigantamax).toBe(true);
    expect(imported.build?.mechanic).toBeUndefined();
    expect(runtime.speciesById.has("charizardgmax")).toBe(false);
  });

  it("never guesses a Gmax identity by stripping a suffix or by using an unverified alias", () => {
    for (const patch of [{}, { canGigantamax: "gmaxwildfire" }, { gmaxNames: ["Charizard-Gmax"] }]) {
      const imported = member("Charizard-Gmax", "traditional", nativeRuntime("sword_shield", patch));
      expect(imported.selectable).toBe(false);
      expect(imported.speciesId).toBeNull();
    }
    const runtime = nativeRuntime("sword_shield", { canGigantamax: "gmaxwildfire", gmaxNames: ["Charizard-Gmax"] });
    expect(member("Charizard-Gmax-Imaginary", "traditional", runtime).speciesId).toBeNull();
    expect(errors(member("Charizard-Gmax\nGigantamax: No", "traditional", runtime))).toContainEqual(expect.objectContaining({ line: 2, message: expect.stringContaining("conflicts") }));
  });

  it("does not Mega evolve from a stone or silently equip the item required by an exact imported form", () => {
    const base = parseTeamImport("Charizard @ Charizardite X", "champions").members[0];
    expect(base.build?.speciesId).toBe("charizard");
    const mega = parseTeamImport("Charizard-Mega-X @ Charizardite X", "champions").members[0];
    expect(errors(mega)).toEqual([]);
    expect(mega.build?.speciesId).toBe("charizardmegax");
    const missing = parseTeamImport("Charizard-Mega-X", "champions").members[0];
    expect(missing.build?.itemId).toBe("");
    expect(errors(missing)).toContainEqual(expect.objectContaining({ message: expect.stringContaining("requires Charizardite X") }));
  });

  it("passes required-item alternatives and actual prepared-move proof to the model", () => {
    const runtime = nativeRuntime("ultra_sun_ultra_moon", { requiredItems: ["leftovers", "focussash"], requiredMove: "flamethrower" });
    for (const item of ["Leftovers", "Focus Sash"]) {
      const imported = member(`Charizard @ ${item}\n- Protect\n- Flamethrower`, "traditional", runtime);
      expect(errors(imported)).toEqual([]);
      expect(imported.build?.preparedMoves).toEqual(["protect", "flamethrower"]);
    }
    const missing = member("Charizard\n- Protect", "traditional", runtime);
    expect(missing.build?.itemId).toBe("");
    expect(errors(missing).some((entry) => entry.message.includes("requires Leftovers or Focus Sash"))).toBe(true);
    expect(errors(missing).some((entry) => entry.message.includes("requires Flamethrower"))).toBe(true);
  });
});

describe("Showdown Hidden Power and Happiness syntax", () => {
  it.each(["Hidden Power [Ice]", "Hidden Power Ice", "hiddenpowerice"])("recognizes %s without rewriting IVs or inventing Hyper Training", (move) => {
    const runtime = nativeRuntime("ultra_sun_ultra_moon");
    const imported = member(`Charizard\n- ${move}\n- Flamethrower`, "traditional", runtime);
    expect(errors(imported)).toEqual([]);
    expect(imported.moves[0].moveId).toBe("hiddenpower");
    expect(imported.build?.configuration?.hiddenPowerType).toBe("Ice");
    expect(imported.build?.native?.ivs).toEqual(perfect);
    expect(imported.build?.native?.innateIVs).toBeUndefined();
    const results = calculateMatchup(imported.build!, createBuild("charizard", runtime), createConditions(), {}, runtime);
    expect(results.results.find((row) => row.moveId === "hiddenpower")?.kind).toBe("needs-context");
    expect(results.results.find((row) => row.moveId === "flamethrower")?.kind).toBe("calculated");
  });

  it("retains a matching explicit Hidden Power declaration and supplied IVs in either order", () => {
    const runtime = nativeRuntime("ultra_sun_ultra_moon");
    const lines = ["Hidden Power: Ice", "IVs: 0 Atk / 30 Def", "- Hidden Power [Ice]"];
    for (const fields of [lines, [...lines].reverse()]) {
      const imported = member(["Charizard", "Level: 50", ...fields].join("\n"), "traditional", runtime);
      expect(errors(imported)).toEqual([]);
      expect(imported.build?.native?.ivs).toEqual({ ...perfect, atk: 0, def: 30 });
      const results = calculateMatchup(imported.build!, createBuild("charizard", runtime), createConditions(), {}, runtime);
      expect(results.results.find((row) => row.moveId === "hiddenpower")?.kind).toBe("calculated");
    }
  });

  it.each(["Hidden Power: Fire\n- Hidden Power [Ice]", "- Hidden Power [Ice]\n- Hidden Power Ice", "- Hidden Power []", "- Hidden Power [Ice", "- Hidden Power [Fairy]"])("rejects contradictory, duplicate or malformed typed Hidden Power: %s", (lines) => {
    const imported = member(`Charizard\n${lines}`, "traditional", nativeRuntime("ultra_sun_ultra_moon"));
    expect(imported.selectable).toBe(false);
    expect(errors(imported).length).toBeGreaterThan(0);
  });

  it("preserves explicit Happiness, the Showdown Frustration default and omitted Return separately", () => {
    const runtime = nativeRuntime("ultra_sun_ultra_moon");
    const frustration = member("Charizard\n- Frustration", "traditional", runtime);
    expect(errors(frustration)).toEqual([]);
    expect(frustration.build?.configuration?.happiness).toBe(0);
    expect(frustration.source?.configuration.happiness).toBeUndefined();
    for (const lines of ["Happiness: 255\n- Frustration", "- Frustration\nHappiness: 255"]) {
      const imported = member(`Charizard\n${lines}`, "traditional", runtime);
      expect(imported.build?.configuration?.happiness).toBe(255);
      expect(imported.source?.configuration.happiness).toBe(255);
    }
    expect(member("Charizard\n- Return", "traditional", runtime).build?.configuration?.happiness).toBeUndefined();
  });
});

describe("retained importer safety and exact identities", () => {
  it("keeps duplicate species distinct and keeps unknown custom lines actionable", () => {
    const team = parseTeamImport("Charizard\n- Protect\n\nCharizard\nTera: Fire\n\nCharizard\n- Flamethrower", "traditional", nativeRuntime("scarlet_violet"));
    expect(team.members.map((row) => [row.index, row.selectable])).toEqual([[0, true], [1, false], [2, true]]);
    expect(team.members[0].build).not.toBe(team.members[2].build);
    expect(team.members[0].moves).not.toBe(team.members[2].moves);
    expect(errors(team.members[1])).toContainEqual(expect.objectContaining({ line: 5, message: expect.stringContaining("Unsupported or unknown") }));
  });

  it.each(["Imaginarymon", "Char", "Charizard-Unknown", "Charizard\nAbility: Unknown", "Charizard @ Unknown", "Charizard\n- Unknown", "Charizard\n- Thunderbolt"])("does not substitute unavailable exact identities in %s", (text) => {
    const imported = member(text);
    expect(imported.selectable).toBe(false);
    expect(errors(imported).length).toBeGreaterThan(0);
  });

  it.each(["- Protect\n- PROTECT", "EVs: 1 HP / 1 HP", "EVs: 1 HP\nEVs: 1 Atk", "- Protect\n- Flamethrower\n- Air Slash\n- Roost\n- Heat Wave"])("retains duplicate/move-count validation: %s", (lines) => {
    expect(member(`Charizard\n${lines}`).selectable).toBe(false);
  });

  it("preserves Alcremie catalog identity precedence over shared engine identity", () => {
    const rows = championsRuntime.catalog.species.filter((row) => row.id.startsWith("alcremie") && !row.battleForm);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      const imported = parseTeamImport(row.name, "champions").members[0];
      expect(imported.speciesId).toBe(row.id);
      expect(imported.build?.speciesId).toBe(row.id);
    }
  });

  it("enforces text limits and rejects packed/JSON/multiple-section payloads without network access", () => {
    const network = vi.fn(() => { throw new Error("Manual import must not fetch"); });
    vi.stubGlobal("fetch", network);
    const runtime = nativeRuntime("sword_shield");
    for (const text of ["x".repeat(MAX_TEAM_IMPORT_BYTES + 1), "é".repeat(MAX_TEAM_IMPORT_BYTES / 2 + 1), Array(MAX_TEAM_IMPORT_MEMBERS + 1).fill("Charizard").join("\n\n"), "[{\"species\":\"Charizard\"}]", "Charizard||blaze||||", "Charizard\u0000", "=== First ===\nCharizard\n\n=== Second ===\nCharizard"]) {
      const team = parseTeamImport(text, "traditional", runtime);
      expect(team.diagnostics.some((entry) => entry.severity === "error")).toBe(true);
      expect(team.members.every((row) => !row.selectable)).toBe(true);
    }
    expect(parseTeamImport(Array(MAX_TEAM_IMPORT_MEMBERS).fill("Charizard").join("\n\n"), "traditional", runtime).members).toHaveLength(24);
    expect(network).not.toHaveBeenCalled();
  });
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("runtime-aware importer draft interface", () => {
  const owner = { role: "own" as const, revision: 0, epoch: 0 };

  it("uses native EV/IV source format for a fresh native importer and renders the target game", () => {
    const runtime = nativeRuntime("scarlet_violet");
    const onApply = vi.fn();
    const html = renderToStaticMarkup(createElement(PokePasteImporter, { role: "own", owner, applied: null, onApply, onRemove: vi.fn(), runtime }));
    expect(html).toContain(runtime.profile.label);
    expect(html).toContain('value="traditional" selected=""');
    expect(html).not.toContain('value="champions"');
    expect(html).toContain("omitted level defaults to 100");
    expect(html).not.toContain("data-paste-preview");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("keeps supplied Champions drafts intact across target selection instead of silently reinterpreting EV labels", () => {
    const draft: ImportDraft = { text: CHARIZARD, title: "Preserved title", url: "https://pokepast.es/0123456789abcdef", format: "champions" };
    const before = structuredClone(draft);
    const onDraftChange = vi.fn();
    const html = renderToStaticMarkup(createElement(PokePasteImporter, { role: "own", owner, applied: null, onApply: vi.fn(), onRemove: vi.fn(), runtime: nativeRuntime("sword_shield"), draft, onDraftChange }));
    expect(html).toContain("Source encoding preserved");
    expect(html).toContain("incompatible source");
    expect(html).toContain("EVs: 32 SpA / 32 Spe / 2 HP");
    expect(html).toContain("Preserved title");
    expect(html).toContain(draft.url);
    expect(draft).toEqual(before);
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("reports every controlled text, URL, title and format edit as a complete draft without mutating the supplied object", () => {
    const field = vi.spyOn(fieldControl, "default");
    const input = vi.spyOn(inputControl, "default");
    const select = vi.spyOn(selectControl, "default");
    const draft: ImportDraft = { text: "Charizard", title: "Original", url: "", format: "champions" };
    const onDraftChange = vi.fn();
    renderToStaticMarkup(createElement(PokePasteImporter, { role: "own", owner, applied: null, onApply: vi.fn(), onRemove: vi.fn(), draft, onDraftChange }));
    const url = input.mock.calls.map(([props]) => props).find((props) => props.placeholder === "https://pokepast.es/…")!;
    const title = input.mock.calls.map(([props]) => props).find((props) => props.placeholder === "Imported team")!;
    url.onChange!({ target: { value: "https://pokepast.es/0123456789abcdef" } } as ChangeEvent<HTMLInputElement>);
    expect(onDraftChange).toHaveBeenLastCalledWith({ ...draft, url: "https://pokepast.es/0123456789abcdef" });
    title.onChange!({ target: { value: "Changed title" } } as ChangeEvent<HTMLInputElement>);
    expect(onDraftChange).toHaveBeenLastCalledWith({ ...draft, title: "Changed title" });
    select.mock.calls[0][0].onChange!({ target: { value: "traditional" } } as ChangeEvent<HTMLSelectElement>);
    expect(onDraftChange).toHaveBeenLastCalledWith({ ...draft, format: "traditional" });
    const text = field.mock.calls.map(([props]) => props).find((props) => props.label === "Team text")!.children;
    if (!isValidElement<{ onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void }>(text)) throw new Error("Expected the team text editor");
    expect(text.type).toBe("textarea");
    text.props.onChange({ target: { value: "Blastoise" } } as ChangeEvent<HTMLTextAreaElement>);
    expect(onDraftChange).toHaveBeenLastCalledWith({ ...draft, text: "Blastoise" });
    expect(onDraftChange).toHaveBeenCalledTimes(4);
    expect(draft).toEqual({ text: "Charizard", title: "Original", url: "", format: "champions" });
  });
});
