import { describe, expect, it } from "vitest";
import { createFirstChanceMegaProvider, createHabitBotProvider, createMaxDamageProvider, createRandomLegalProvider } from "@/app/(app)/training/ai/baselines";
import { createEngineProvider } from "@/app/(app)/training/ai/engine-provider";
import { damageRows, worthOf } from "@/app/(app)/training/ai/rows";
import { chooseReplacements, replacementScore, replacePolicy } from "@/app/(app)/training/ai/switches";
import type { AiView } from "@/app/(app)/training/model/ai-view";
import { DEFAULT_BUDGET, type DecideOptions, type DecisionProvider, type WorkBudget } from "@/app/(app)/training/model/decision";
import { OPEN_TEAM_SHEETS } from "@/app/(app)/training/model/info";
import { createRandom, seedHex } from "@/app/(app)/training/model/random";
import { redactSheet } from "@/app/(app)/training/model/sheet";
import { jointActionKey, megaSlots, type JointAction } from "@/app/(app)/training/model/view-types";
import { fullSheet, keys, makeInputs, makeView, PROBE_AI, PROBE_PLAYER, publicMon, runtime, trainingTeam, usageFixture, type MonSpec } from "../fixtures/training-ai";
import { fakeServices } from "../fixtures/training-ai-services";

/** SPEC 10.8 the engine provider (deterministic per seed, budget, valve, abort), A1.5 Mega positions, 10.10, 10.13. */
const inputs = makeInputs({ player: PROBE_PLAYER, ai: PROBE_AI, mons: [publicMon("p1", "garchomp", "garchomp", 0), publicMon("p1", "incineroar", "incineroar", 1)] });
function options(seed: number | string, changes: Partial<DecideOptions> = {}): DecideOptions {
  return {
    difficulty: "safe", budget: DEFAULT_BUDGET, deadlineMs: null, random: createRandom("provider", seed, "ai"), seedBase: seedHex("provider", seed),
    signal: new AbortController().signal, yieldNow: async () => {}, now: () => performance.now(), ...changes,
  };
}
const turn = (provider: DecisionProvider, view: AiView, o: DecideOptions) => provider.chooseTurn({ runtime, inputs, services: () => fakeServices(view), usage: usageFixture }, o);
const megaOf = (action: JointAction) => megaSlots(action).some((slot) => slot.startsWith("opponent"));

const whimsicott: MonSpec = { side: "opponent", species: "whimsicott", slot: "opponent-left", moves: ["tailwind", "moonblast", "encore", "protect"], ability: "prankster", item: "focussash", nature: "Timid", points: { hp: 2, spa: 32, spe: 32 } };
const charizard: MonSpec = { side: "opponent", species: "charizard", slot: "opponent-right", moves: ["heatwave", "airslash", "solarbeam", "protect"], ability: "blaze", item: "charizarditey", nature: "Modest", points: { hp: 2, spa: 32, spe: 32 }, canMega: true };
const kingambit: MonSpec = { side: "opponent", species: "kingambit", slot: null, moves: ["kowtowcleave", "suckerpunch", "ironhead", "protect"], ability: "defiant", item: "blackglasses", nature: "Adamant", points: { hp: 32, atk: 32 } };
const garchomp: MonSpec = { side: "own", species: "garchomp", slot: "own-left", moves: ["earthquake", "dragonclaw", "rockslide", "protect"], ability: "roughskin", item: "lifeorb", nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } };
const incineroar: MonSpec = { side: "own", species: "incineroar", slot: "own-right", moves: ["fakeout", "flareblitz", "partingshot", "protect"], ability: "intimidate", item: "sitrusberry", nature: "Careful", points: { hp: 32, spd: 32 }, firstTurn: true };
const opening = () => makeView([whimsicott, charizard, kingambit, garchomp, incineroar], { turn: 1 });

describe("engine provider", () => {
  it("is deterministic per seed and plays a legal joint action with a fact report and stats", async () => {
    const view = opening();
    const a = await turn(createEngineProvider({ runtime, habits: null }), view, options(1));
    const b = await turn(createEngineProvider({ runtime, habits: null }), view, options(1));
    expect(jointActionKey(a.action)).toBe(jointActionKey(b.action));
    expect({ ...a.report, elapsedMs: 0 }).toEqual({ ...b.report, elapsedMs: 0 });
    expect({ ...a.stats, elapsedMs: 0, beliefMs: 0 }).toEqual({ ...b.stats, elapsedMs: 0, beliefMs: 0 });
    expect(new Set(keys(view.legal.opponent)).has(jointActionKey(a.action))).toBe(true);
    expect(a.report.strategy.reduce((sum, option) => sum + option.chance, 0)).toBeCloseTo(1, 9);
    expect(a.report.strategy[a.report.chosen].action).toEqual(a.action);
    expect(a.report.predicted.length).toBeGreaterThan(0);
    expect(a.report.predicted.length).toBeLessThanOrEqual(3);
    expect(a.stats.options.its).toBeGreaterThan(10);
    expect(a.stats.byMethod.dropped).toBe(0);
    expect(a.stats.exploitability).toBeLessThan(0.02);
    expect(a.stats.mega).toMatchObject({ eligible: ["opponent-right"] });
    expect(a.report.mega?.memberKey).toBe("charizard");
    expect(a.question.options.length).toBe(a.stats.options.yours);
    expect(Object.keys(a.question.slots).sort()).toEqual(["own-left", "own-right"]);
  }, 120_000);

  it("never exceeds the work budget", async () => {
    const budget: WorkBudget = { ...DEFAULT_BUDGET, engineCalls: 30, rolloutSamples: 5 };
    const decision = await turn(createEngineProvider({ runtime, habits: null }), opening(), options(2, { budget }));
    expect(decision.stats.engineCalls).toBeLessThanOrEqual(30);
    expect(decision.stats.rolloutSamples).toBeLessThanOrEqual(5);
    expect(decision.stats.options.its).toBeGreaterThan(decision.report.evaluated.its);
  }, 120_000);

  it("drops the remaining rows when the wall-clock valve fires (browser only), keeping at least two", async () => {
    let clock = 0;
    const decision = await turn(createEngineProvider({ runtime, habits: null }), opening(), options(3, { deadlineMs: 10, now: () => (clock += 1) }));
    expect(decision.stats.valveFired).toBe(true);
    expect(decision.report.evaluated.its).toBeGreaterThanOrEqual(2);
    expect(decision.report.evaluated.its).toBeLessThan(decision.stats.options.its);
  }, 120_000);

  it("rejects with AbortError when stopped, before or during a decision", async () => {
    const stopped = new AbortController();
    stopped.abort();
    await expect(turn(createEngineProvider({ runtime, habits: null }), opening(), options(4, { signal: stopped.signal }))).rejects.toMatchObject({ name: "AbortError" });
    const midway = new AbortController();
    let yields = 0;
    const pending = turn(createEngineProvider({ runtime, habits: null }), opening(), options(4, { signal: midway.signal, yieldNow: async () => { if (++yields === 3) midway.abort(); } }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  }, 120_000);

  it("Reads you blends habits into its prediction once the habits have turns", async () => {
    const habits = { version: 1 as const, turns: 40, data: { v: 1, battles: 5, classes: { "*": { protect: 40 } }, targets: {}, moves: {}, brings: {}, leads: {}, mega: {} } };
    const safe = await turn(createEngineProvider({ runtime, habits }), opening(), options(5));
    const reads = await turn(createEngineProvider({ runtime, habits }), opening(), options(5, { difficulty: "reads" }));
    const protects = (decision: typeof safe) => decision.report.predicted.filter((option) => Object.values(option.action ?? {}).some((each) => each?.kind === "move" && each.moveId === "protect")).reduce((sum, option) => sum + option.chance, 0);
    expect(protects(reads)).toBeGreaterThan(protects(safe));
  }, 120_000);
});

describe("habits through the provider (I8)", () => {
  it("learns the shown move with its target slot from the decision's view, and a shown Mega", async () => {
    const provider = createEngineProvider({ runtime, habits: null });
    const decision = await turn(provider, opening(), options(8));
    provider.observeTurn({
      turn: decision.question.turn, question: decision.question, opponent: decision.action, observedMega: null,
      observed: { "own-left": { kind: "move", moveId: "dragonclaw", targetKey: "p2:charizard", spread: false }, "own-right": { kind: "none", reason: "cant" } },
    });
    const data = provider.habits().data as { moves: Record<string, Record<string, number>>; classes: Record<string, Record<string, number>>; targets: Record<string, Record<string, number>> };
    expect(data.moves.garchomp).toEqual({ dragonclaw: 1 });
    expect(data.moves.incineroar).toBeUndefined();
    const expected = decision.question.slots["own-left"]!.classes["move:dragonclaw:opponent-right"];
    expect(data.classes["*"]).toEqual({ [expected.cls]: 1 });
    if (expected.target) expect(data.targets[expected.cls]).toEqual({ [expected.target]: 1 });
    expect(provider.habits().turns).toBe(1);
  }, 120_000);
});

describe("A1.5 Mega Evolution every turn", () => {
  const count = async (view: AiView, provider: () => DecisionProvider, n = 10) => {
    let megas = 0;
    for (let seed = 0; seed < n; seed++) if (megaOf((await turn(provider(), view, options(`mega-${seed}`))).action)) megas++;
    return megas;
  };
  it("keeps the Mega when the Mega form would take a super-effective hit the base form resists (Mega Gyarados into Close Combat)", async () => {
    const view = makeView([
      { side: "opponent", species: "gyarados", slot: "opponent-left", moves: ["waterfall", "crunch", "icefang", "dragondance"], ability: "intimidate", item: "gyaradosite", nature: "Adamant", points: { hp: 2, atk: 32, spe: 32 }, canMega: true },
      { side: "opponent", species: "rotomwash", slot: "opponent-right", moves: ["hydropump", "thunderbolt", "willowisp", "protect"], ability: "levitate", item: "sitrusberry", nature: "Modest", points: { hp: 32, spa: 32 } },
      { side: "own", species: "sneasler", slot: "own-left", moves: ["closecombat", "direclaw", "protect", "throatchop"], ability: "unburden", item: "whiteherb", nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } },
      { side: "own", species: "kingambit", slot: "own-right", moves: ["kowtowcleave", "suckerpunch", "ironhead", "protect"], ability: "defiant", item: "blackglasses", nature: "Adamant", points: { hp: 32, atk: 32 } },
    ]);
    expect(await count(view, () => createEngineProvider({ runtime, habits: null }))).toBeLessThanOrEqual(3);
  }, 120_000);
  it("keeps the Mega when its ability would hurt its own side (Drought replacing its partner's Rain)", async () => {
    const view = makeView([
      { side: "opponent", species: "pelipper", slot: "opponent-left", moves: ["hydropump", "hurricane", "protect", "tailwind"], ability: "drizzle", item: "damprock", nature: "Modest", points: { hp: 32, spa: 32 } },
      { side: "opponent", species: "charizard", slot: "opponent-right", moves: ["airslash", "dragonpulse", "protect", "focusblast"], ability: "blaze", item: "charizarditey", nature: "Modest", points: { hp: 2, spa: 32, spe: 32 }, canMega: true },
      { side: "own", species: "garchomp", slot: "own-left", moves: ["earthquake", "rockslide", "protect", "dragonclaw"], ability: "roughskin", item: "lifeorb", nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } },
      { side: "own", species: "tyranitar", slot: "own-right", moves: ["rockslide", "crunch", "protect", "lowkick"], ability: "unnerve", item: "sitrusberry", nature: "Adamant", points: { hp: 32, atk: 32 } },
    ], { field: { weather: "Rain" }, clock: { weather: { id: "Rain", turns: 6 } } });
    expect(await count(view, () => createEngineProvider({ runtime, habits: null }))).toBe(0);
    const decision = await turn(createEngineProvider({ runtime, habits: null }), view, options(0));
    expect(decision.report.mega).toMatchObject({ evolved: false, text: "Kept Mega Evolution: Drought would weaken Pelipper's Hydro Pump." });
    expect(decision.stats.mega!.terms.thisTurn).toBeLessThan(0);
  }, 120_000);
  it("Mega Evolves where the Mega wins this turn's KO race, and the first-chance baseline always does when it can", async () => {
    const view = makeView([
      { side: "opponent", species: "charizard", slot: "opponent-left", moves: ["heatwave", "airslash", "protect", "solarbeam"], ability: "blaze", item: "charizarditey", nature: "Modest", points: { hp: 2, spa: 32, spe: 32 }, canMega: true },
      { side: "opponent", species: "whimsicott", slot: "opponent-right", moves: ["tailwind", "moonblast", "encore", "protect"], ability: "prankster", item: "focussash", nature: "Timid", points: { hp: 2, spa: 32, spe: 32 } },
      { side: "own", species: "venusaur", slot: "own-left", moves: ["gigadrain", "sludgebomb", "earthpower", "sleeppowder"], ability: "chlorophyll", item: "", nature: "Modest", points: { hp: 32, spa: 32 }, hp: 0.85 },
      { side: "own", species: "scizor", slot: "own-right", moves: ["bulletpunch", "uturn", "closecombat", "swordsdance"], ability: "technician", item: "", nature: "Adamant", points: { hp: 32, atk: 32 }, hp: 0.7 },
    ]);
    expect(await count(view, () => createEngineProvider({ runtime, habits: null }))).toBeGreaterThanOrEqual(8);
    const decision = await turn(createEngineProvider({ runtime, habits: null }), view, options(0));
    expect(decision.report.mega).toEqual({ memberKey: "charizard", evolved: true, moves: ["heatwave"], text: "Mega Evolved Charizard: Drought before Heat Wave." });
    expect(decision.stats.mega!.terms.thisTurn).toBeGreaterThan(1);
    const first = await turn(createFirstChanceMegaProvider({ runtime, habits: null }), opening(), options(0));
    expect(megaOf(first.action)).toBe(true);
    expect(first.report.strategy.every((option) => megaOf(option.action!))).toBe(true);
  }, 120_000);
});

describe("replacements and the rollout policy", () => {
  const view = makeView([
    { side: "opponent", species: "charizard", slot: null, moves: ["heatwave", "airslash", "solarbeam", "protect"], ability: "blaze", item: "", nature: "Modest", points: { hp: 2, spa: 32, spe: 32 } },
    { side: "opponent", species: "gyarados", slot: null, moves: ["waterfall", "crunch", "icefang", "protect"], ability: "intimidate", item: "", nature: "Adamant", points: { hp: 2, atk: 32, spe: 32 } },
    { side: "opponent", species: "whimsicott", slot: "opponent-right", moves: ["tailwind", "moonblast", "encore", "protect"], ability: "prankster", item: "focussash", nature: "Timid", points: { hp: 2, spa: 32, spe: 32 } },
    { side: "own", species: "venusaur", slot: "own-left", moves: ["gigadrain", "sludgebomb", "earthpower", "protect"], ability: "chlorophyll", item: "", nature: "Modest", points: { hp: 32, spa: 32 } },
    { side: "own", species: "scizor", slot: "own-right", moves: ["bulletpunch", "uturn", "closecombat", "protect"], ability: "technician", item: "", nature: "Adamant", points: { hp: 32, atk: 32 } },
  ]);
  const rows = damageRows(view, runtime);
  const worth = worthOf(view, rows, runtime);
  it("sends in the member with the best S(c): Charizard into Venusaur and Scizor", () => {
    expect(replacementScore(view, rows, worth, "opponent:charizard", "opponent-left", runtime)).toBeGreaterThan(replacementScore(view, rows, worth, "opponent:gyarados", "opponent-left", runtime));
    expect(chooseReplacements({ ...view, legal: { ...view.legal, opponent: [] } }, rows, worth, ["opponent-left"], runtime)).toEqual({ "opponent-left": { kind: "switch", to: "charizard" } });
    expect(replacePolicy(view, rows, worth, runtime)("opponent", ["opponent-left"], ["opponent:gyarados", "opponent:charizard"])).toEqual(["opponent:charizard"]);
    expect(replacePolicy(view, rows, worth, runtime)("opponent", ["opponent-left", "opponent-right"], ["opponent:gyarados"])).toEqual(["opponent:gyarados"]);
  });
  it("answers a forced switch through the provider with the request's legal options", async () => {
    const legal: JointAction[] = [{ "opponent-left": { kind: "switch", to: "gyarados" } }, { "opponent-left": { kind: "switch", to: "charizard" } }];
    const decision = await createEngineProvider({ runtime, habits: null }).chooseReplacements(
      { runtime, inputs, services: () => fakeServices({ ...view, legal: { ...view.legal, opponent: legal } }), usage: usageFixture, slots: ["opponent-left"], midTurn: false }, options(6));
    expect(decision.action).toEqual({ "opponent-left": { kind: "switch", to: "charizard" } });
  }, 120_000);
});

describe("team preview through the provider", () => {
  it("brings four and seeds the belief's bring chances", async () => {
    const provider = createEngineProvider({ runtime, habits: null });
    const sheet = redactSheet(fullSheet(PROBE_PLAYER), OPEN_TEAM_SHEETS);
    const decision = await provider.teamPreview({ runtime, ai: trainingTeam(PROBE_AI), sheet, info: OPEN_TEAM_SHEETS, usage: usageFixture }, options(7));
    expect(decision.order).toHaveLength(4);
    expect(decision.report.turn).toBe(0);
    expect(provider.habits().data).toMatchObject({ battles: 1 });
  }, 120_000);
});

describe("baselines", () => {
  it("RandomLegal plays a legal action; MaxDamage the most damage, Mega at first chance, never Protect; HabitBot protects at low HP", async () => {
    const view = opening();
    const legal = new Set(keys(view.legal.opponent));
    for (let seed = 0; seed < 5; seed++) expect(legal.has(jointActionKey((await turn(createRandomLegalProvider({ runtime }), view, options(seed))).action))).toBe(true);
    const max = (await turn(createMaxDamageProvider({ runtime }), view, options(0))).action;
    expect(megaOf(max)).toBe(true);
    for (const action of Object.values(max)) expect(action?.kind === "move" && action.moveId !== "protect").toBe(true);
    const low = makeView([{ ...whimsicott, hp: 0.3 }, charizard, kingambit, garchomp, incineroar], { turn: 2 });
    const bot = (await turn(createHabitBotProvider({ runtime }), low, options(0))).action;
    expect(bot["opponent-left"]).toEqual({ kind: "move", moveId: "protect", target: null });
    const target = bot["opponent-right"];
    if (target?.kind === "move" && target.target) expect(target.target).toBe("own-left");
  }, 120_000);
});
