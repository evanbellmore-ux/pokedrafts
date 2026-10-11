// Track V1 (status2 wave 1a): regression tests for the oracle harness's additions (sim-dfs.ts prepare() and choice(), the
// new chance events, app-turn.ts's mapping, compare.ts's new checks, the changed-cases classification). Each test sets up a
// case and reads pinned Showdown's state (or the app input) the case maps to; no full walk except one small chance case.
//   npx vitest run --config scripts/.cache/calc-audit/2v2/verify/v1/vitest.v1.config.mts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SLOTS, toID, type Case, type CaseMon } from "../case-types";
import { CASES } from "../cases";
import { listChanged } from "../../../status2/build/changed-cases";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, slots } from "../case-kit";
import { choice, monOf, pokemonAt, prepare, walk } from "../sim-dfs";
import { caseInput, runtimeFor } from "../app-turn";
import { compareCase } from "../compare";
import { removalOf } from "../status2-removed";
import type { DoublesTurnResult } from "@/app/lib/battle/doubles-types";

const base = (over: Partial<Case>, own: CaseMon = lax(8)): Case => ({
  id: "V1-T", title: "t", game: "sv", checks: "t",
  slots: slots(idle(own), idle(lax(16)), idle(lax(24)), idle(lax(32))), ...over,
});
const ready = (facts: string[]): DoublesTurnResult => ({ status: "ready", facts, steps: [], hp: { "own-left": null, "own-right": null, "opponent-left": null, "opponent-right": null }, swapped: {}, endOfTurn: { status: "ready", hp: {}, residuals: [] } } as unknown as DoublesTurnResult);

describe("prepare(): the carried state of status2 wave 1a", () => {
  it("Stockpile: the volatile written directly, its counts, the case's stages kept (no boost event)", () => {
    const c = base({ slots: slots(idle(carried(lax(8, { boosts: { def: 2, spd: 2 } }), { stockpile: { layers: 2, def: -2, spd: -1 } })), idle(mon("Espathra", "Opportunist")), idle(lax(24)), idle(lax(32))) });
    const p = pokemonAt(prepare(c).b, OL);
    expect(p.volatiles.stockpile).toMatchObject({ layers: 2, def: -2, spd: -1 });
    expect(p.boosts.def).toBe(2);
    // Counts absent: −layers each (the app's assumption).
    const q = pokemonAt(prepare(base({}, carried(lax(8, { boosts: { def: 3, spd: 3 } }), { stockpile: { layers: 3 } }))).b, OL);
    expect(q.volatiles.stockpile).toMatchObject({ layers: 3, def: -3, spd: -3 });
  });
  it("the stall counter, recharge, Destiny Bond, Laser Focus, Glaive Rush with their durations", () => {
    const own = carried(lax(8), { stall: 9, mustRecharge: true, destinyBond: true, laserFocus: true, glaiveRush: true });
    const p = pokemonAt(prepare(base({}, own)).b, OL);
    expect(p.volatiles.stall).toMatchObject({ counter: 9, duration: 1 });
    expect(p.volatiles.mustrecharge.duration).toBe(1);
    expect(p.volatiles.destinybond).toBeDefined();
    expect(p.volatiles.laserfocus.duration).toBe(1);
    expect(p.volatiles.glaiverush).toBeDefined();
    // 1 is no volatile (C23).
    expect(pokemonAt(prepare(base({}, carried(lax(8), { stall: 1, allySwitch: 1 }))).b, OL).volatiles.stall).toBeUndefined();
  });
  it("a charge from last turn: twoturnmove and the move's volatile, one turn left, aimed at the case's target; the choice is locked", () => {
    const c = base({ slots: slots(act(carried(mon("Garchomp", "Rough Skin"), { charging: "dig" }), "Dig", PR), idle(lax(16)), idle(lax(24)), idle(lax(32))) });
    const { b, choices } = prepare(c);
    const p = pokemonAt(b, OL);
    expect(p.volatiles.twoturnmove).toMatchObject({ move: "dig", duration: 1 });
    expect(p.volatiles.dig).toBeDefined();
    expect(p.volatiles.dig.targetLoc).toBe(1);
    expect(choices[0].startsWith("move 1,")).toBe(true);
  });
  it("Taunt, Encore, Disable, Heal Block, Embargo, Telekinesis: turns left as the duration", () => {
    const own = carried(lax(8, { moves: ["Body Slam"] }), { taunt: 2, encore: { move: "Body Slam", turns: 3 }, healBlock: 1, embargo: 4, telekinesis: 2 });
    const p = pokemonAt(prepare(base({}, own)).b, OL);
    expect(p.volatiles.taunt.duration).toBe(2);
    expect(p.volatiles.encore).toMatchObject({ move: "bodyslam", duration: 3 });
    expect(p.volatiles.healblock.duration).toBe(1);
    expect(p.volatiles.embargo.duration).toBe(4);
    expect(p.volatiles.telekinesis.duration).toBe(2);
    const d = pokemonAt(prepare(base({}, carried(lax(8, { moves: ["Body Slam"] }), { disable: { move: "Body Slam", turns: 3 } }))).b, OL);
    expect(d.volatiles.disable).toMatchObject({ move: "bodyslam", duration: 3 });
  });
  it("sources: Lock-On, Octolock, Attract point at the Pokémon of the slot", () => {
    const c = base({ slots: slots(idle(carried(lax(8, { gender: "M" }), { lockOn: PL, octolock: PR, attract: PR })), idle(lax(16)), idle(lax(24)), idle(lax(32, { gender: "F" }))) });
    const b = prepare(c).b;
    const p = pokemonAt(b, OL);
    expect(p.volatiles.lockon.source).toBe(monOf(b, PL));
    expect(p.volatiles.lockon.duration).toBe(1);
    expect(p.volatiles.octolock.source).toBe(monOf(b, PR));
    expect(p.volatiles.attract.source).toBe(monOf(b, PR));
  });
  it("types, the added type, the last item, not its first turn, a used Protean, once-a-battle flags, a pending copy, a locked Berry", () => {
    const own = carried(mon("Greninja", "Protean", { types: ["Water"], addedType: "Grass", lastItem: "Sitrus Berry", firstTurn: false, appBuild: { abilityActive: false } }), { onceUsed: ["battlebond"] });
    const p = pokemonAt(prepare(base({}, own)).b, OL);
    expect(p.getTypes()).toEqual(["Water", "Grass"]);
    expect(p.lastItem).toBe("sitrusberry");
    expect(p.activeMoveActions).toBe(1);
    expect(p.abilityState.protean).toBe(true);
    expect(p.bondTriggered).toBe(true);
    const e = pokemonAt(prepare(base({}, carried(mon("Espathra", "Opportunist"), { copy: { atk: 1 } }))).b, OL);
    expect(e.abilityState.boosts).toEqual({ atk: 1 });
    const z = pokemonAt(prepare(base({ game: "usum" }, carried(mon("Drampa", "Berserk", { item: "Sitrus Berry" }), { berryLocked: true }))).b, OL);
    expect(z.abilityState.checkedBerserk).toBe(false);
  });
  it("the field and sides from earlier turns, field turns left, the bench's status and ability", () => {
    const c = base({
      game: "usum", field: { gravity: true, mudSport: true, waterSport: true, own: { safeguard: true, mist: true }, opponent: { luckyChant: true } },
      fieldTurns: { gravity: 1 }, bench: { own: { status: "psn", ability: "Soundproof" } },
    });
    const b = prepare(c).b;
    expect(Object.keys(b.field.pseudoWeather).sort()).toEqual(["gravity", "mudsport", "watersport"]);
    expect(b.field.pseudoWeather.gravity.duration).toBe(1);
    expect(Object.keys(b.sides[0].sideConditions).sort()).toEqual(["mist", "safeguard"]);
    expect(Object.keys(b.sides[1].sideConditions)).toEqual(["luckychant"]);
    const benched = b.sides[0].pokemon.find((p: any) => p.name === "Bench");
    expect(benched.status).toBe("psn");
    expect(benched.ability).toBe("soundproof");
  });
  it("entryOrder re-makes the ability states in rank order (smaller first: the older state)", () => {
    const c = base({ entryOrder: { "opponent-left": 0, "own-left": 1 } });
    const b = prepare(c).b;
    expect(pokemonAt(b, PL).abilityState.effectOrder).toBeLessThan(pokemonAt(b, OL).abilityState.effectOrder);
    expect(pokemonAt(b, OL).abilityState.effectOrder).toBeLessThan(pokemonAt(b, OR).abilityState.effectOrder);
  });
  it("Struggle: every slot at 0 PP, so the choice becomes Struggle; No move is Splash wherever it stands", () => {
    const c = base({ slots: slots(act(lax(8), "Struggle"), idle(lax(16)), idle(lax(24)), idle(lax(32))) });
    const { b } = prepare(c);
    expect(pokemonAt(b, OL).moveSlots.every((s: any) => s.pp === 0)).toBe(true);
    // A transformed lead (Imposter) has its target's slots: No move picks Splash's index.
    const imp = base({ slots: slots(idle(mon("Ditto", "Imposter")), idle(lax(16)), idle(lax(24, { moves: ["Body Slam"] })), idle(lax(32))) });
    const p = prepare(imp);
    const at = pokemonAt(p.b, OL).moveSlots.findIndex((s: any) => s.id === "splash");
    expect(choice(p.b, imp, OL)).toBe(`move ${at + 1}`);
  });
  it("a move used last turn is lastMove and lastMoveUsed (useMoveInner sets both; Conversion 2 reads lastMoveUsed)", () => {
    const p = pokemonAt(prepare(base({}, lax(8, { lastMove: "Body Slam" }))).b, OL);
    expect(p.lastMove?.id).toBe("bodyslam");
    expect(p.lastMoveUsed?.id).toBe("bodyslam");
  });
});

describe("the oracle's E2 state", () => {
  it("a transformed Pokémon (pokemon.transformed, no Showdown volatile) is E2's transform volatile", () => {
    const c = CASES.find((x) => x.id === "SAT-TRF-1-sv")!;
    const user = SLOTS.find((s) => toID(c.slots[s].action.move ?? "") === "transform")!;
    expect(walk(c, "lowest").slots[user].volatiles?.transform).toBeCloseTo(1, 12);
  });
});

describe("compare.ts: copy facts (Opportunist, Mirror Herb)", () => {
  it("a copy counts for its copier by name and side, not for the user's own stages", async () => {
    const dir = path.resolve("scripts/.cache/calc-audit/2v2/verify/v1/fixtures");
    const c = CASES.find((x) => x.id === "G4-OPP-11-sv")!;
    const oracle = JSON.parse(fs.readFileSync(path.join(dir, "G4-OPP-11-sv.oracle.json"), "utf8"));
    const app = JSON.parse(fs.readFileSync(path.join(dir, "G4-OPP-11-sv.app.json"), "utf8")).result as DoublesTurnResult;
    const runtime = await runtimeFor(c);
    const isStatus = (moveId: string) => runtime.movesById.get(moveId)?.category === "Status";
    const effects = (result: DoublesTurnResult) => compareCase(c, oracle, result, isStatus).filter((m) => m.field.startsWith("effect"));
    expect(effects(app)).toEqual([]);
    // The same copy named for the user's side: it would be the user's (twice its own +1) and the foe Espathra's goes missing.
    const yours = JSON.parse(JSON.stringify(app).replace("Espathra (opponent's) copies", "Espathra (yours) copies")) as DoublesTurnResult;
    const wrong = effects(yours).map((m) => m.where);
    expect(wrong).toContain("own-left→own-left");
    expect(wrong).toContain("own-left→opponent-left");
  });
});

describe("changed-cases.ts: the app's new output reaching stored cases (header 5)", () => {
  it("lists the Minimize and charge facts, E2's new fields, Protean's world type change and Syrup Bomb's residual", () => {
    const listed = listChanged();
    const why = (id: string) => listed.filter((l) => l.id === id).map((l) => `${l.owner}: ${l.why}`).join(" | ");
    expect(why("V05")).toMatch(/has not used Minimize/);
    expect(why("INT04a")).toMatch(/did not charge .* and E2 charging/);
    expect(why("S35a")).toMatch(/sides\.clock/);
    expect(why("RT-RV02")).toMatch(/fieldSet/);
    expect(why("VT-VE09")).toMatch(/lastItem/);
    expect(why("RT-RV18")).toMatch(/turnsLeft/);
    expect(why("FE-FX09")).toMatch(/^A1 \(outcomeMon\): E2 own-left: accuracy:-1/);
    expect(why("F10a")).toMatch(/^A2: Protean/);
    expect(why("ER29b")).toMatch(/^E1: Syrup Bomb/);
    // Each is compared again in diff mode, with no oracle re-run and its reasons kept.
    expect(listed.filter((l) => l.id === "V05").every((l) => !l.oracle && !l.reexpect)).toBe(true);
  });
});

describe("the oracle's new chance events (CHANCE_EFFECTS)", () => {
  it("Focus Band's 1/10 on a knocking hit is a decision, not a failed chance", () => {
    const c = base({ slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { atk: 252, spe: 252 } }), "Dragon Claw", PR), idle(lax(16)), idle(lax(24)), idle(lax(32, { item: "Focus Band", hp: 30 }))) });
    const w = walk(c, "lowest");
    expect(w.decisions["chance:focusband"]).toBeGreaterThan(0);
    expect(w.slots[PR].koChance).toBeCloseTo(0.9, 12);
  });
});

describe("app-turn.ts: the new fields into DoublesTurnInput", () => {
  it("carried fields keep their names (moves to ids), Case fields and sides map, a gender into the build", async () => {
    const own = carried(lax(8, { types: ["Ghost"], addedType: "Grass", lastItem: "Sitrus Berry", firstTurn: false, gender: "F" }), {
      stockpile: { layers: 2 }, charging: "Solar Beam", stall: 3, encore: { move: "Body Slam", turns: 2 }, octolock: PR, onceUsed: ["intrepidsword"],
    });
    const c = base({ entryOrder: { "own-left": 0 }, fieldTurns: { magicRoom: 1 }, field: { magicRoom: true, own: { safeguard: true }, mudSport: true } }, own);
    const input = caseInput(c, await runtimeFor(c));
    const entry = input.pokemon["own-left"]!;
    expect(entry.build).toMatchObject({ types: ["Ghost"], addedType: "Grass", configuration: { gender: "F" } });
    expect(entry.lastItem).toBe("sitrusberry");
    expect(entry.firstTurn).toBe(false);
    expect(entry.carried).toMatchObject({ stockpile: { layers: 2 }, charging: "solarbeam", stall: 3, encore: { move: "bodyslam", turns: 2 }, octolock: PR, onceUsed: ["intrepidsword"] });
    expect(entry.carried!.stockpile).toEqual({ layers: 2 });
    expect(input.entryOrder).toEqual({ "own-left": 0 });
    expect(input.fieldTurns).toEqual({ magicRoom: 1 });
    expect(input.field.attackerSide.safeguard).toBe(true);
    expect(input.field.mudSport).toBe(true);
  });
  it("a stored case's input is unchanged by the additions (no new key set)", async () => {
    const c = base({});
    const input = caseInput(c, await runtimeFor(c));
    expect(Object.keys(input).sort()).toEqual(["canSwitch", "field", "pokemon", "runtime"]);
    expect(input.field.attackerSide).not.toHaveProperty("safeguard");
    expect(input.field).not.toHaveProperty("mudSport");
  });
});

describe("compare.ts: the status2 rules", () => {
  it("the protecting-move fact only while a protecting user has no carried stall counter (C23)", () => {
    const withStall = base({ slots: slots(act(carried(lax(8), { stall: 3 }), "Protect"), idle(lax(16)), idle(lax(24)), idle(lax(32))) });
    const noStall = base({ slots: slots(act(lax(8), "Protect"), idle(lax(16)), idle(lax(24)), idle(lax(32))) });
    const oracle = { walks: { all: { exact: true, steps: {}, slots: {} } }, expected: {} } as never;
    const factsIssue = (c: Case, facts: string[]) => compareCase(c, oracle, ready(facts)).filter((m) => m.field === "facts" && JSON.stringify(m.expected).includes("protecting"));
    const rule = "Every move hits; no critical hits; added effects below 100% do not happen.";
    expect(factsIssue(withStall, [rule])).toEqual([]);
    expect(factsIssue(noStall, [rule]).length).toBe(1);
  });
});

describe("status2-removed.ts: the reasons this build removes", () => {
  it("classifies the stored texts by owner and wave", () => {
    expect(removalOf("Attract is not modelled and comes before another move.")).toMatchObject({ owner: "A2", wave: "1a" });
    expect(removalOf("Roost changes Dragonite's type: later moves are not modelled.")).toMatchObject({ owner: "A2", wave: "1a" });
    expect(removalOf("Harvest is not modelled in 2v2.")).toMatchObject({ owner: "E1", wave: "1a" });
    expect(removalOf("Icicle Spear into Dragonite's Substitute with Multiscale is not modelled in 2v2.")).toMatchObject({ owner: "S", wave: "1a" });
    expect(removalOf("Triple Axel into Snorlax's Substitute with Multiscale is not modelled in 2v2.")?.wave).not.toBe("1a");
    expect(removalOf("Sleep Talk is not modelled in 2v2.")).toMatchObject({ owner: "CL", wave: "1b" });
    expect(removalOf("Neutralizing Gas ending is not modelled in 2v2.")).toMatchObject({ wave: "kept" });
    // status2 wave 2 (Track R-V): a stored case has no bench, so the reason stays (status2-removed.ts).
    expect(removalOf("Snorlax switches out: the replacement is not known.")).toMatchObject({ wave: "kept" });
  });
});
void OR;
