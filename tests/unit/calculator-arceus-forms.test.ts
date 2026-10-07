import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DOUBLE_TARGET, DOUBLE_TARGET_ACTIONS, DOUBLE_TARGET_RULES, fixture } from "../fixtures/doubles-turn";
import DoublesSummary from "@/app/(app)/calculator/DoublesSummary";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive, heldItemForm, validateBuild } from "@/app/lib/battle/model";
import { championsRuntime } from "@/app/lib/battle/runtime";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import type { BattleBuild, BattleConditions, BattleGame, CombatStat, MoveContext, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * Arceus (Multitype) holding a Plate, or in Ultra Sun / Ultra Moon a type's Z-Crystal, and Silvally (RKS System) holding a
 * Memory battle as that type (pinned Showdown c23d2e94 data/conditions.ts arceus / silvally onType: the item's onPlate /
 * onMemory), and the team validator gives the set the item's forcedForme (sim/team-validator.ts). Like Zacian holding its
 * Rusted Sword, the base form holding the item is flagged as battling in that form and an import takes the form; the form
 * then calculates as Showdown does: Judgment takes a Plate's type but not a Z-Crystal's (data/moves.ts judgment
 * onModifyType: `!item.zMove`), Multi-Attack the Memory's. Singles values: the exact Uses oracle
 * scripts/.cache/calc-audit/zmove-status/verify/u-oracle2.ts through zmove-status/verify/run.ts (cases
 * serene-arceus/fix/cases-1v1.json); 2v2 values: scripts/.cache/calc-audit/2v2/verify/sim-dfs.ts, cases SA09-SA12
 * (serene-arceus/fix/cases-sa.ts). Level 50, 31 IVs, 0 EVs, Serious nature unless set.
 */

type Runtime = Awaited<ReturnType<typeof loadBattleRuntime>>;
type Mon = { id: string; ability: string; item?: string; evs?: Partial<Record<CombatStat, number>> };
function build(runtime: Runtime, m: Mon): BattleBuild {
  const base = createBuild(m.id, runtime);
  return {
    ...base, nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ...(m.evs ? { native: { ...base.native!, evs: { ...base.native!.evs, ...m.evs } } } : {}),
  } as BattleBuild;
}
const singles = (field: Partial<BattleConditions> = {}): BattleConditions => ({ ...createConditions(), gameType: "Singles", ...field });
async function row(game: BattleGame, moveId: string, attacker: Mon, defender: Mon, options: { z?: boolean; field?: Partial<BattleConditions> } = {}): Promise<MoveDamageResult> {
  const runtime = await loadBattleRuntime(game);
  const contexts: Record<string, MoveContext> = options.z ? { [moveId]: { useZ: true } } : {};
  const out = calculateMatchup(build(runtime, attacker), build(runtime, defender), singles(options.field), contexts, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const SV: BattleGame = "scarlet_violet", SW: BattleGame = "sword_shield", US: BattleGame = "ultra_sun_ultra_moon";
const blissey: Mon = { id: "blissey", ability: "naturalcure" };
const snorlax: Mon = { id: "snorlax", ability: "thickfat" };

describe("the form a held item gives (mechanics.ts heldItemForm)", () => {
  it("is the type's Arceus or Silvally form, or the Crowned form, and nothing for other items", async () => {
    const [sv, sw, us] = await Promise.all([loadBattleRuntime(SV), loadBattleRuntime(SW), loadBattleRuntime(US)]);
    expect(heldItemForm("arceus", "flameplate", sv)).toBe("arceusfire");
    expect(heldItemForm("arceus", "pixieplate", sv)).toBe("arceusfairy");
    expect(heldItemForm("arceus", "firiumz", us)).toBe("arceusfire");
    expect(heldItemForm("arceus", "insectplate", us)).toBe("arceusbug");
    expect(heldItemForm("silvally", "firememory", sw)).toBe("silvallyfire");
    expect(heldItemForm("silvally", "watermemory", us)).toBe("silvallywater");
    expect(heldItemForm("zacian", "rustedsword", sw)).toBe("zaciancrowned");
    // Normalium Z has no onPlate; Leftovers no type; a form already holding its item stays.
    for (const [species, item] of [["arceus", "normaliumz"], ["arceus", "leftovers"], ["arceus", ""], ["arceusfire", "flameplate"], ["silvallyfire", "firememory"]]) {
      expect(heldItemForm(species, item, us)).toBeNull();
    }
    // Genesect's Drives are item forms too (calculator-item-forms.test.ts has those and the other forced forms).
    expect(heldItemForm("genesect", "dousedrive", us)).toBe("genesectdouse");
  });

  it("flags the base form holding the item, as Zacian holding its Rusted Sword", async () => {
    const [sv, sw, us] = await Promise.all([loadBattleRuntime(SV), loadBattleRuntime(SW), loadBattleRuntime(US)]);
    expect(validateBuild(build(sv, { id: "arceus", ability: "multitype", item: "flameplate" }), sv))
      .toEqual([{ field: "itemId", message: "Arceus holding Flame Plate battles as Arceus-Fire." }]);
    expect(validateBuild(build(us, { id: "arceus", ability: "multitype", item: "firiumz" }), us))
      .toEqual([{ field: "itemId", message: "Arceus holding Firium Z battles as Arceus-Fire." }]);
    expect(validateBuild(build(sw, { id: "silvally", ability: "rkssystem", item: "firememory" }), sw))
      .toEqual([{ field: "itemId", message: "Silvally holding Fire Memory battles as Silvally-Fire." }]);
    for (const [runtime, m] of [[us, { id: "arceus", ability: "multitype", item: "normaliumz" }], [sv, { id: "arceusfire", ability: "multitype", item: "flameplate" }], [us, { id: "silvallyfire", ability: "rkssystem", item: "firememory" }]] as const) {
      expect(validateBuild(build(runtime, m), runtime)).toEqual([]);
    }
    const out = calculateMatchup(build(sv, { id: "arceus", ability: "multitype", item: "flameplate" }), build(sv, blissey), singles(), {}, sv);
    expect(out.issues.attacker).toEqual([{ field: "itemId", message: "Arceus holding Flame Plate battles as Arceus-Fire." }]);
  });

  it("is the form an import takes, with an info line", async () => {
    const us = await loadBattleRuntime(US);
    const member = (paste: string) => parseTeamImport(paste, "traditional", us).members[0];
    const plate = member("Arceus @ Flame Plate\nAbility: Multitype\nLevel: 50\n- Judgment\n- Recover");
    expect(plate).toMatchObject({ speciesId: "arceusfire", build: { speciesId: "arceusfire", itemId: "flameplate" } });
    expect(plate.moves.map((slot) => slot.moveId)).toEqual(["judgment", "recover", null, null]);
    expect(plate.diagnostics).toContainEqual({ line: 1, severity: "info", message: "Arceus holding Flame Plate battles as Arceus-Fire." });
    expect(member("Arceus @ Firium Z\nAbility: Multitype\nLevel: 50\n- Judgment")).toMatchObject({ speciesId: "arceusfire", build: { itemId: "firiumz" } });
    const memory = member("Silvally @ Fire Memory\nAbility: RKS System\nLevel: 50\n- Multi-Attack");
    expect(memory).toMatchObject({ speciesId: "silvallyfire", build: { speciesId: "silvallyfire", itemId: "firememory" } });
    expect(memory.diagnostics).toContainEqual({ line: 1, severity: "info", message: "Silvally holding Fire Memory battles as Silvally-Fire." });
    const normal = member("Arceus @ Normalium Z\nAbility: Multitype\nLevel: 50\n- Judgment");
    expect(normal).toMatchObject({ speciesId: "arceus", build: { itemId: "normaliumz" } });
    expect(normal.diagnostics.some((entry) => entry.message.includes("battles as"))).toBe(false);
    // The form named in the paste needs no line.
    expect(member("Arceus-Fire @ Flame Plate\nAbility: Multitype\nLevel: 50\n- Judgment").diagnostics.some((entry) => entry.message.includes("battles as"))).toBe(false);
  });
});

describe("the item's form in 1v1, as pinned Showdown", () => {
  it("Arceus-Fire holding a Flame Plate: Fire type, and Judgment is Fire", async () => {
    // sv|arceusfire|judgment|blissey: 61-73 (the plate's 1.2x and Fire STAB), out within 5 at 0.7992..., within 6.
    for (const game of [SV, US]) {
      const judgment = await row(game, "judgment", { id: "arceusfire", ability: "multitype", item: "flameplate" }, blissey);
      expect(judgment).toMatchObject({ min: 61, max: 73, effectiveType: "Fire" });
      expect(judgment.usesToKO).toMatchObject({ kind: "uses", guaranteed: 6, fewest: 5 });
      expect((judgment.usesToKO as { fasterChance: number }).fasterChance).toBeCloseTo(0.7992038726806641, 15);
      expect(judgment.afterUse).toMatchObject({ start: 330, low: 269, high: 257, average: 262.75 });
    }
    expect(await row(SV, "flamethrower", { id: "arceusfire", ability: "multitype", item: "flameplate" }, snorlax)).toMatchObject({ min: 33, max: 40 });
    // Under Magic Room the plate does nothing: Judgment is Normal, 34-41, out in 9 to 10.
    const room = await row(SV, "judgment", { id: "arceusfire", ability: "multitype", item: "flameplate" }, blissey, { field: { magicRoom: true } });
    expect(room).toMatchObject({ min: 34, max: 41 });
    expect(room.usesToKO).toMatchObject({ kind: "uses", guaranteed: 10, fewest: 9 });
  });

  it("Arceus-Fire holding a Firium Z: Fire type, Judgment stays Normal, Fire Z-Moves", async () => {
    // us|arceusfire-z|judgment|blissey: Normal Judgment without STAB 34-41; Z-Flamethrower (Inferno Overdrive) 90-106.
    const judgment = await row(US, "judgment", { id: "arceusfire", ability: "multitype", item: "firiumz" }, blissey);
    expect(judgment).toMatchObject({ min: 34, max: 41, effectiveType: "Normal" });
    expect(judgment.usesToKO).toMatchObject({ kind: "uses", guaranteed: 10, fewest: 9 });
    const z = await row(US, "flamethrower", { id: "arceusfire", ability: "multitype", item: "firiumz" }, blissey, { z: true });
    expect(z).toMatchObject({ effectiveName: "Inferno Overdrive", min: 90, max: 106 });
    expect(z.afterUse).toMatchObject({ start: 330, low: 240, high: 224, average: 232.375 });
  });

  it("Silvally-Fire holding a Fire Memory: Fire type, and Multi-Attack is Fire", async () => {
    // Multi-Attack is 90 power in Ultra Sun/Ultra Moon, 120 in Sword/Shield (data/mods/gen7/moves.ts multiattack).
    expect(await row(US, "multiattack", { id: "silvallyfire", ability: "rkssystem", item: "firememory" }, blissey)).toMatchObject({ min: 195, max: 229, effectiveType: "Fire" });
    const sword = await row(SW, "multiattack", { id: "silvallyfire", ability: "rkssystem", item: "firememory" }, blissey);
    expect(sword).toMatchObject({ min: 259, max: 306, effectiveType: "Fire" });
    expect(sword.usesToKO).toMatchObject({ kind: "uses", guaranteed: 2, fewest: 2 });
    // Under Magic Room the Memory does nothing (runEvent skips it): Multi-Attack is Normal, 173-204.
    expect(await row(SW, "multiattack", { id: "silvallyfire", ability: "rkssystem", item: "firememory" }, blissey, { field: { magicRoom: true } })).toMatchObject({ min: 173, max: 204 });
    // Silvally-Water takes Fire moves without STAB: Flamethrower 16-19 into Snorlax.
    expect(await row(SW, "flamethrower", { id: "silvallywater", ability: "rkssystem", item: "watermemory" }, snorlax)).toMatchObject({ min: 16, max: 19 });
  });
});

type Slot = Mon & { move?: string; target?: DoublesSlotId };
async function turn(game: BattleGame, slots: Record<DoublesSlotId, Slot>) {
  const runtime = await loadBattleRuntime(game);
  const pokemon = Object.fromEntries(Object.entries(slots).map(([slot, m]) => [slot, {
    build: build(runtime, m), contexts: {}, charged: false, action: { moveId: m.move ?? null, target: m.target ?? null },
  } satisfies DoublesPokemonInput])) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const input: DoublesTurnInput = { runtime, field: { ...createConditions(), gameType: "Doubles" }, pokemon };
  return calculateDoublesTurn(input);
}
async function ready(game: BattleGame, slots: Record<DoublesSlotId, Slot>) {
  const result = await turn(game, slots);
  if (result.status !== "ready") throw new Error(result.status);
  return result;
}
const hit = (result: Awaited<ReturnType<typeof ready>>, from: DoublesSlotId, to: DoublesSlotId) => result.steps.find((step) => step.slot === from)?.hits.find((each) => each.slot === to);
const venusaur: Slot = { id: "venusaur", ability: "overgrow", evs: { spe: 4 } };
const foeSnorlax: Slot = { ...snorlax, evs: { spe: 4 } };
const waterPulse: Slot = { id: "blastoise", ability: "torrent", move: "waterpulse", target: "own-left" };

describe("the item's form in the 2v2 turn (oracle cases SA09-SA12)", () => {
  it("hits with the item's type and takes hits as that type", async () => {
    // SA09: Arceus-Fire's Fire Judgment 37-45 into Thick Fat Snorlax; Water Pulse 50-62 (2x) into it.
    const plate = await ready(SV, { "own-left": { id: "arceusfire", ability: "multitype", item: "flameplate", move: "judgment", target: "opponent-left" }, "own-right": venusaur, "opponent-left": foeSnorlax, "opponent-right": waterPulse });
    expect(hit(plate, "own-left", "opponent-left")).toMatchObject({ min: 37, max: 45 });
    expect(hit(plate, "opponent-right", "own-left")).toMatchObject({ min: 50, max: 62 });
    expect(plate.hp["own-left"]).toMatchObject({ start: 195, low: 145, high: 133, average: 138.625 });
    expect(plate.hp["opponent-left"]).toMatchObject({ start: 235, low: 198, high: 190, average: 194.3125 });
    // SA10: holding a Firium Z, Judgment is Normal (41-49 into Snorlax), and Arceus-Fire still takes Water Pulse 2x.
    const crystal = await ready(US, { "own-left": { id: "arceusfire", ability: "multitype", item: "firiumz", move: "judgment", target: "opponent-left" }, "own-right": venusaur, "opponent-left": foeSnorlax, "opponent-right": waterPulse });
    expect(hit(crystal, "own-left", "opponent-left")).toMatchObject({ min: 41, max: 49 });
    expect(hit(crystal, "opponent-right", "own-left")).toMatchObject({ min: 50, max: 62 });
    expect(crystal.hp["opponent-left"]).toMatchObject({ start: 235, low: 194, high: 186, average: 190 });
    // SA11: Silvally-Fire's Fire Multi-Attack 34-42 into Snorlax; Water Pulse 66-78 into it.
    const memory = await ready(US, { "own-left": { id: "silvallyfire", ability: "rkssystem", item: "firememory", move: "multiattack", target: "opponent-left" }, "own-right": venusaur, "opponent-left": foeSnorlax, "opponent-right": waterPulse });
    expect(hit(memory, "own-left", "opponent-left")).toMatchObject({ min: 34, max: 42 });
    expect(hit(memory, "opponent-right", "own-left")).toMatchObject({ min: 66, max: 78 });
    expect(memory.hp["own-left"]).toMatchObject({ start: 170, low: 104, high: 92, average: 99.75 });
    // SA12: Silvally-Water's Water Multi-Attack 93-109 into Snorlax; Venusaur's Energy Ball 108-128 (2x) into it.
    const water = await ready(SW, {
      "own-left": { id: "silvallywater", ability: "rkssystem", item: "watermemory", move: "multiattack", target: "opponent-left" }, "own-right": { id: "conkeldurr", ability: "guts" },
      "opponent-left": foeSnorlax, "opponent-right": { ...venusaur, move: "energyball", target: "own-left" },
    });
    expect(hit(water, "own-left", "opponent-left")).toMatchObject({ min: 93, max: 109 });
    expect(hit(water, "opponent-right", "own-left")).toMatchObject({ min: 108, max: 128 });
    expect(water.hp["own-left"]).toMatchObject({ start: 170, low: 62, high: 42, average: 52.75 });
  });

  it("flags the base form holding the item on its card", async () => {
    const result = await turn(SV, { "own-left": { id: "arceus", ability: "multitype", item: "flameplate", move: "judgment", target: "opponent-left" }, "own-right": venusaur, "opponent-left": foeSnorlax, "opponent-right": waterPulse });
    expect(result.status).toBe("issues");
    if (result.status !== "issues") return;
    expect(result.issues.pokemon["own-left"]).toContainEqual({ field: "itemId", message: "Arceus holding Flame Plate battles as Arceus-Fire." });
  });
});

describe("the 2v2 card's move type", () => {
  it("is the type the turn's calculation gave the move (Judgment's Plate, Weather Ball's weather), not its catalog type", () => {
    // The DOUBLE_TARGET fixture: Charizard's Weather Ball, its hit calculated as a Fire move (in sun).
    const turn = structuredClone(DOUBLE_TARGET);
    if (turn.status !== "ready") throw new Error(turn.status);
    turn.steps.find((entry) => entry.slot === "own-left")!.hits[0].row!.effectiveType = "Fire";
    const view = fixture({ actions: DOUBLE_TARGET_ACTIONS, rules: DOUBLE_TARGET_RULES, turn });
    const html = renderToStaticMarkup(createElement(DoublesSummary, {
      runtime: championsRuntime, cards: view.cards, names: view.names, turn: view.turn, rollMode: "average", onRollModeChange: vi.fn(),
      replacement: null, movesControl: "moves-list", magicRoom: false, terrain: "",
      onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onToggleMega: vi.fn(), onToggleMechanic: vi.fn(),
      onActivateMove: vi.fn(), onChooseMove: vi.fn(), onShowMoves: vi.fn(), onTargetChange: vi.fn(), onShowStep: vi.fn(), onFixSettings: vi.fn(),
    }));
    const button = /aria-label="Charizard your left move \d: Weather Ball"[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ?? "";
    expect(button).toContain(">Fire<");
    expect(button).not.toContain(">Normal<");
  });
});
