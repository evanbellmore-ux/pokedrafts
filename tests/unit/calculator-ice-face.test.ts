import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { neutralEffectiveness } from "@/app/lib/battle/engine-corrections.cjs";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleBuild, BattleConditions, BattleGame, CombatStat } from "@/app/lib/battle/types";

/**
 * The hit an intact Ice Face (Eiscue, physical moves) or Disguise (Mimikyu, any damaging move) takes is calculated at a
 * neutral type effectiveness before it deals nothing: pinned Showdown c23d2e94 data/abilities.ts iceface and disguise
 * onEffectiveness return 0 for each of the holder's types the move does not miss (sim/pokemon.ts runEffectiveness sums
 * them), then onDamage returns 0. The 2v2 turn shows that hit's damage (doubles-turn.ts neutralRow), so a super-effective
 * or resisted move shows its neutral damage and nothing that reads the effectiveness acts (Expert Belt, Tinted Lens),
 * in every generation; an Ice-type Eiscue keeps Snow's 1.5x Defense. The 1v1 row into an intact face shows no damage (it
 * needs the busted form selected). 2v2 values: scripts/.cache/calc-audit/2v2/verify/sim-dfs.ts, cases FI01-FI11
 * (forms-iceface-fling/fix/cases-fif.ts; FI01 is SA13). Level 50, 31 IVs, 0 EVs, Serious nature unless set.
 */

type Runtime = Awaited<ReturnType<typeof loadBattleRuntime>>;
type Slot = { id: string; ability: string; item?: string; status?: BattleBuild["status"]; evs?: Partial<Record<CombatStat, number>>; dynamax?: true; move?: string; target?: DoublesSlotId };
function build(runtime: Runtime, m: Slot): BattleBuild {
  const base = createBuild(m.id, runtime);
  const evs = m.evs ? (base.game === "champions" ? { points: { ...base.points!, ...m.evs } } : { native: { ...base.native!, evs: { ...base.native!.evs, ...m.evs } } }) : {};
  return {
    ...base, nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, status: m.status ?? "", ...evs, ...(m.dynamax ? { mechanic: "dynamax" } : {}),
  } as BattleBuild;
}
async function ready(game: BattleGame, slots: Record<DoublesSlotId, Slot>, field: Partial<BattleConditions> = {}) {
  const runtime = await loadBattleRuntime(game);
  const pokemon = Object.fromEntries(Object.entries(slots).map(([slot, m]) => [slot, {
    build: build(runtime, m), contexts: {}, charged: false, action: { moveId: m.move ?? null, target: m.target ?? null },
  } satisfies DoublesPokemonInput])) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const input: DoublesTurnInput = { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(result.status === "not-estimated" ? result.reason : result.status);
  return result;
}
const hit = (result: Awaited<ReturnType<typeof ready>>, from: DoublesSlotId, to: DoublesSlotId) => result.steps.find((step) => step.slot === from)?.hits.find((each) => each.slot === to);
const SV: BattleGame = "scarlet_violet", SW: BattleGame = "sword_shield", US: BattleGame = "ultra_sun_ultra_moon";
const venusaur: Slot = { id: "venusaur", ability: "overgrow", evs: { spe: 4 } };
const snorlax: Slot = { id: "snorlax", ability: "thickfat", evs: { spe: 4 } };
const eiscue: Slot = { id: "eiscue", ability: "iceface" };
const mimikyu: Slot = { id: "mimikyu", ability: "disguise" };
const at = (m: Slot, move: string, target?: DoublesSlotId): Slot => ({ ...m, move, ...(target ? { target } : {}) });
const face = "opponent-left";

describe("the hit an intact Ice Face takes, in the 2v2 turn", () => {
  it("is calculated neutral: Rock Smash into Eiscue is 5-6, not the busted form's 10-14 (FI01, Sword/Shield)", async () => {
    // Serene Grace's Rock Smash still drops the Defense: Hammer Arm 302-356 into Eiscue-Noice at -1, out.
    const result = await ready(SW, { "own-left": at({ id: "blissey", ability: "serenegrace" }, "rocksmash", face), "own-right": at({ id: "conkeldurr", ability: "guts" }, "hammerarm", face), [face]: eiscue, "opponent-right": venusaur });
    expect(hit(result, "own-left", face)).toMatchObject({ kind: "calculated", min: 5, max: 6 });
    expect(hit(result, "own-left", face)!.facts).toContainEqual({ text: "Ice Face: Eiscue takes no damage.", chance: 1 });
    expect(hit(result, "own-right", face)).toMatchObject({ min: 302, max: 356, koChance: 1 });
    expect(result.hp[face]).toMatchObject({ start: 150, low: 0, high: 0, koChance: 1 });
  });

  it("is neutral for a spread move, with no Expert Belt, and for Max Moves and a Dynamaxed Eiscue (Sword/Shield)", async () => {
    // FI02: Rock Slide 39-46 into the face (2x before), Snorlax its ordinary 58-69.
    const slide = await ready(SW, { "own-left": at({ id: "tyranitar", ability: "unnerve" }, "rockslide"), "own-right": venusaur, [face]: eiscue, "opponent-right": snorlax });
    expect(hit(slide, "own-left", face)).toMatchObject({ min: 39, max: 46 });
    expect(hit(slide, "own-left", "opponent-right")).toMatchObject({ min: 58, max: 69 });
    expect(slide.hp[face]).toMatchObject({ start: 150, low: 150, high: 150 });
    expect(slide.hp["opponent-right"]).toMatchObject({ start: 235, low: 177, high: 166, average: 172.0625 });
    // FI03: Expert Belt reads the hit's typeMod (0): Close Combat 67-81, not 238-281.
    const belt = await ready(SW, { "own-left": at({ id: "lucario", ability: "innerfocus", item: "expertbelt" }, "closecombat", face), "own-right": venusaur, [face]: eiscue, "opponent-right": snorlax });
    expect(hit(belt, "own-left", face)).toMatchObject({ min: 67, max: 81 });
    // FI10: Max Knuckle 67-79; its +1 Attack reaches Snorlax's Body Slam (105-124) into Eiscue-Noice.
    const knuckle = await ready(SW, { "own-left": at({ id: "conkeldurr", ability: "guts", dynamax: true }, "closecombat", face), "own-right": at({ id: "snorlax", ability: "thickfat" }, "bodyslam", face), [face]: eiscue, "opponent-right": venusaur });
    expect(hit(knuckle, "own-left", face)).toMatchObject({ min: 67, max: 79 });
    expect(hit(knuckle, "own-right", face)).toMatchObject({ min: 105, max: 124 });
    expect(knuckle.hp[face]).toMatchObject({ start: 150, low: 45, high: 26, average: 35.6875 });
    // FI11: a Dynamaxed intact Eiscue (300 HP) takes Close Combat's neutral 67-81, then its Max Strike hits Venusaur.
    const giant = await ready(SW, { "own-left": at({ id: "lucario", ability: "innerfocus" }, "closecombat", face), "own-right": venusaur, [face]: at({ ...eiscue, dynamax: true }, "headbutt", "own-right"), "opponent-right": snorlax });
    expect(hit(giant, "own-left", face)).toMatchObject({ min: 67, max: 81 });
    expect(giant.hp[face]).toMatchObject({ start: 300, low: 300, high: 300 });
    expect(giant.hp["own-right"]).toMatchObject({ start: 155, low: 110, high: 102, average: 106.4375 });
  });

  it("keeps Snow's Defense for the Ice-type face, and makes a resisted move neutral (Scarlet/Violet)", async () => {
    // FI04: in Snow, Close Combat 46-55 (neutral, 1.5x Defense); FI05: Ice Shard 25-30 (0.5x made neutral).
    const snow = await ready(SV, { "own-left": at({ id: "lucario", ability: "innerfocus" }, "closecombat", face), "own-right": venusaur, [face]: eiscue, "opponent-right": snorlax }, { weather: "Snow" });
    expect(hit(snow, "own-left", face)).toMatchObject({ min: 46, max: 55 });
    const shard = await ready(SV, { "own-left": at({ id: "weavile", ability: "pressure" }, "iceshard", face), "own-right": venusaur, [face]: eiscue, "opponent-right": snorlax });
    expect(hit(shard, "own-left", face)).toMatchObject({ min: 25, max: 30 });
    // FI09: a Normal move is already neutral: Body Slam 49-58.
    const slam = await ready(SW, { "own-left": at({ id: "snorlax", ability: "thickfat" }, "bodyslam", face), "own-right": venusaur, [face]: eiscue, "opponent-right": snorlax });
    expect(hit(slam, "own-left", face)).toMatchObject({ min: 49, max: 58 });
  });
});

describe("the hit an intact Disguise takes, in the 2v2 turn", () => {
  it("is calculated neutral, then the busted form takes its 1/8 from generation 8 (Champions, USUM, Scarlet/Violet)", async () => {
    // FI06 (Champions): Iron Head 70-84 (2x into Fairy before: 140-168); Mimikyu-Busted at 114 of 130.
    const iron = await ready("champions", { "own-left": at({ id: "metagross", ability: "clearbody" }, "ironhead", face), "own-right": venusaur, [face]: mimikyu, "opponent-right": snorlax });
    expect(hit(iron, "own-left", face)).toMatchObject({ min: 70, max: 84 });
    expect(iron.hp[face]).toMatchObject({ start: 130, low: 114, high: 114 });
    // FI07 (USUM): Shadow Ball 55-66 (2x into Ghost before: 110-132); no 1/8 in generation 7.
    const ball = await ready(US, { "own-left": at({ id: "gengar", ability: "cursedbody" }, "shadowball", face), "own-right": venusaur, [face]: mimikyu, "opponent-right": snorlax });
    expect(hit(ball, "own-left", face)).toMatchObject({ min: 55, max: 66 });
    expect(ball.hp[face]).toMatchObject({ start: 130, low: 130, high: 130 });
    // FI08 (SV): Tinted Lens Bug Buzz 57-67: 0.25x made neutral, so Tinted Lens does not double it.
    const buzz = await ready(SV, { "own-left": at({ id: "yanmega", ability: "tintedlens" }, "bugbuzz", face), "own-right": venusaur, [face]: mimikyu, "opponent-right": snorlax });
    expect(hit(buzz, "own-left", face)).toMatchObject({ min: 57, max: 67 });
    expect(buzz.hp[face]).toMatchObject({ start: 130, low: 114, high: 114 });
  });
});

describe("the hit a face takes is never critical, and a Chilan Berry is eaten by it", () => {
  // iceface and disguise onCriticalHit return false (getDamage's CriticalHit event), whatever made the hit critical; a Chilan
  // Berry's onSourceModifyDamage runs inside getDamage for any Normal hit, so the face's hit eats it. Values: sim-dfs.ts,
  // cases VF01-VF07, VF18-VF21 (forms-iceface-fling/verify/cases-v.ts).
  it("stops the field's Critical hit, an always-critical move, a certain ratio and Merciless", async () => {
    // VF01: Close Combat 67-81 with Critical hit on (102-121 as a crit); VF06: Rock Slide's crit only into Snorlax.
    const close = await ready(SV, { "own-left": at({ id: "lucario", ability: "innerfocus" }, "closecombat", face), "own-right": venusaur, [face]: eiscue, "opponent-right": snorlax }, { critical: true });
    expect(hit(close, "own-left", face)).toMatchObject({ min: 67, max: 81 });
    const slide = await ready(SW, { "own-left": at({ id: "tyranitar", ability: "unnerve" }, "rockslide"), "own-right": venusaur, [face]: eiscue, "opponent-right": snorlax }, { critical: true });
    expect(hit(slide, "own-left", face)).toMatchObject({ min: 39, max: 46 });
    expect(hit(slide, "own-left", "opponent-right")).toMatchObject({ min: 87, max: 103 });
    // VF02 and VF03: Flower Trick 40-48 and Wicked Blow 67-81, not critical.
    const trick = await ready(SV, { "own-left": at({ id: "meowscarada", ability: "overgrow" }, "flowertrick", face), "own-right": venusaur, [face]: eiscue, "opponent-right": snorlax });
    expect(hit(trick, "own-left", face)).toMatchObject({ min: 40, max: 48 });
    const blow = await ready(SW, { "own-left": at({ id: "urshifu", ability: "unseenfist" }, "wickedblow", face), "own-right": venusaur, [face]: mimikyu, "opponent-right": snorlax });
    expect(hit(blow, "own-left", face)).toMatchObject({ min: 67, max: 81 });
    // VF04: Super Luck and a Scope Lens make Night Slash's ratio certain: 58-69, neutral and not critical.
    const slash = await ready(SV, { "own-left": at({ id: "honchkrow", ability: "superluck", item: "scopelens" }, "nightslash", face), "own-right": venusaur, [face]: mimikyu, "opponent-right": snorlax });
    expect(hit(slash, "own-left", face)).toMatchObject({ min: 58, max: 69 });
    // VF21: Merciless into a poisoned Mimikyu: Liquidation 42-49.
    const pex = await ready(SV, { "own-left": at({ id: "toxapex", ability: "merciless" }, "liquidation", face), "own-right": venusaur, [face]: { ...mimikyu, status: "psn" }, "opponent-right": snorlax });
    expect(hit(pex, "own-left", face)).toMatchObject({ min: 42, max: 49 });
    // VF05 (USUM) and VF18 (Snow, Icicle Crash resisted made neutral): 55-66 and 34-42 with Critical hit on.
    const ball = await ready(US, { "own-left": at({ id: "gengar", ability: "cursedbody" }, "shadowball", face), "own-right": venusaur, [face]: mimikyu, "opponent-right": snorlax }, { critical: true });
    expect(hit(ball, "own-left", face)).toMatchObject({ min: 55, max: 66 });
    const crash = await ready(SV, { "own-left": at({ id: "weavile", ability: "pressure" }, "iciclecrash", face), "own-right": venusaur, [face]: eiscue, "opponent-right": snorlax }, { critical: true, weather: "Snow" });
    expect(hit(crash, "own-left", face)).toMatchObject({ min: 34, max: 42 });
  });

  it("eats a Chilan Berry with a Normal hit, unless the attacker's Unnerve stops it", async () => {
    // VF07: Tauros's Body Slam into the face is halved (22-27) and eats the Berry, so Snorlax's Body Slam into Eiscue-Noice is
    // whole: 70-84, not 35-42.
    const chilan = { ...eiscue, item: "chilanberry" };
    const slams = await ready(SV, { "own-left": at({ id: "tauros", ability: "angerpoint" }, "bodyslam", face), "own-right": at({ id: "snorlax", ability: "thickfat" }, "bodyslam", face), [face]: chilan, "opponent-right": venusaur });
    expect(hit(slams, "own-left", face)).toMatchObject({ min: 22, max: 27 });
    expect(hit(slams, "own-right", face)).toMatchObject({ min: 70, max: 84 });
    expect(slams.hp[face]).toMatchObject({ start: 150, low: 80, high: 66 });
    // VF19: Unnerve stops eatItem: 39-46, not halved.
    const unnerve = await ready(SV, { "own-left": at({ id: "tyranitar", ability: "unnerve" }, "bodyslam", face), "own-right": snorlax, [face]: chilan, "opponent-right": venusaur });
    expect(hit(unnerve, "own-left", face)).toMatchObject({ min: 39, max: 46 });
    // VF20 (USUM): Scrappy's Body Slam reaches the Ghost-type disguise (28-33, halved); Snorlax's then does not affect Mimikyu-Busted.
    const scrappy = await ready(US, { "own-left": at({ id: "kangaskhan", ability: "scrappy" }, "bodyslam", face), "own-right": at({ id: "snorlax", ability: "thickfat" }, "bodyslam", face), [face]: { ...mimikyu, item: "chilanberry" }, "opponent-right": venusaur });
    expect(hit(scrappy, "own-left", face)).toMatchObject({ min: 28, max: 33 });
    expect(hit(scrappy, "own-right", face)).toMatchObject({ kind: "no-damage" });
    // VF23: an Occa Berry needs a super-effective typeMod, so the face's hit keeps it for the next Fire Punch (41-49, halved).
    const occa = await ready(SV, { "own-left": at({ id: "annihilape", ability: "defiant" }, "firepunch", face), "own-right": at({ id: "snorlax", ability: "thickfat" }, "firepunch", face), [face]: { ...eiscue, item: "occaberry" }, "opponent-right": venusaur });
    expect(hit(occa, "own-left", face)).toMatchObject({ min: 30, max: 36 });
    expect(hit(occa, "own-right", face)).toMatchObject({ min: 41, max: 49 });
  });
});

describe("the 1v1 row into an intact face", () => {
  it("shows no damage: it needs the busted form, whose row is the busted form's own", async () => {
    const sw = await loadBattleRuntime(SW);
    const field: BattleConditions = { ...createConditions(), gameType: "Singles" };
    const smash = (target: string) => calculateMatchup(build(sw, { id: "blissey", ability: "serenegrace" }), build(sw, { id: target, ability: "iceface" }), field, {}, sw).results.find((row) => row.moveId === "rocksmash")!;
    expect(smash("eiscue")).toMatchObject({ kind: "needs-context", reason: "Intact Ice Face takes the first physical hit.", min: null, max: null });
    expect(smash("eiscue").usesToKO).toBeUndefined();
    expect(smash("eiscuenoice")).toMatchObject({ kind: "calculated", min: 10, max: 14 });
  });
});

describe("engine-corrections.cjs neutralEffectiveness", () => {
  it("makes every effectiveness but an immunity neutral inside it only", async () => {
    const sw = await loadBattleRuntime(SW);
    const field: BattleConditions = { ...createConditions(), gameType: "Singles" };
    const rows = () => calculateMatchup(build(sw, { id: "lucario", ability: "innerfocus" }), build(sw, { id: "eiscuenoice", ability: "iceface" }), field, {}, sw).results;
    const close = () => rows().find((row) => row.moveId === "closecombat")!;
    // Close Combat into Eiscue-Noice (Ice): 2x, 198-234; inside, 1x: 99-117.
    const before = close();
    expect(before).toMatchObject({ min: 198, max: 234 });
    const inside = neutralEffectiveness(() => close());
    expect(inside).toMatchObject({ min: 99, max: 117 });
    expect(close()).toMatchObject({ min: before.min, max: before.max });
    // A Ghost-type target stays immune to Normal moves inside it.
    const ghost = neutralEffectiveness(() => calculateMatchup(build(sw, { id: "snorlax", ability: "thickfat" }), build(sw, { id: "gengar", ability: "cursedbody" }), field, {}, sw).results.find((row) => row.moveId === "bodyslam")!);
    expect(ghost).toMatchObject({ min: 0, max: 0 });
  });
});
