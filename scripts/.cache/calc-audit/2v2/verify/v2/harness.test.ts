// Track V2 (status2 wave 1b): regression tests for the oracle harness's 1b additions: prepare()'s new carried and battle
// state (Uproar, Fury Cutter, Rollout, Defense Curl, PP left, Bide, Cud Chew's Berry, the last move's target, the landings,
// the battle's last move, a side's faint last turn, Echoed Voice, G-Max damage over time), the random start (start
// variants), keepStartBoosts, exactMoves, choice() (a commanding Tatsugiri, a locked or random-target move), the copied
// uses (a Dancer's copy, an instructed move), Magnitude's bands and G-Max Replenish's chance, app-turn.ts's mapping,
// compare.ts's calling moves, copies and named step facts, and changed-cases.ts's 1b rows.
//   npx vitest run --config scripts/.cache/calc-audit/2v2/verify/v2/vitest.v2.config.mts
import { describe, expect, it } from "vitest";
import { SLOTS, type Case, type CaseMon, type OracleResult, type StepResult } from "../case-types";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, slots } from "../case-kit";
import { choice, monOf, pokemonAt, prepare, prepareAll, walk } from "../sim-dfs";
import { caseInput, runtimeFor } from "../app-turn";
import { compareCase } from "../compare";
import { removalOf, REEXPECT_TO } from "../status2-removed";
import { listChanged } from "../../../status2/build/changed-cases";
import { WAVE1B_CASES, ownerOf1b } from "../cases-wave1b";
import { CASES } from "../cases";
import type { DoublesStep, DoublesTurnResult } from "@/app/lib/battle/doubles-types";

const base = (over: Partial<Case>, own: CaseMon = lax(8), game: Case["game"] = "sv"): Case => ({
  id: "V2-T", title: "t", game, checks: "t",
  slots: slots(idle(own), idle(lax(16)), idle(lax(24)), idle(lax(32))), ...over,
});

describe("prepare(): the carried state of wave 1b (ADDENDUM2 §3.1, CL and PR)", () => {
  it("Uproar, Fury Cutter, Rollout with Defense Curl, PP left, as an earlier turn leaves them", () => {
    const own = carried(lax(8, { moves: ["Trump Card"] }), { uproar: 2, furyCutter: 3, defenseCurl: true, ppLeft: { "Trump Card": 1 } });
    const p = pokemonAt(prepare(base({}, own, "usum")).b, OL);
    expect(p.volatiles.uproar.duration).toBe(2);
    expect(p.volatiles.furycutter).toMatchObject({ multiplier: 4, duration: 1 });
    expect(p.volatiles.defensecurl).toBeDefined();
    expect(p.moveSlots.find((s: any) => s.id === "trumpcard").pp).toBe(1);
    const r = pokemonAt(prepare(base({ slots: slots(act(carried(mon("Golem", "Sturdy"), { rollout: 2 }), "Rollout", PR), idle(lax(16)), idle(lax(24)), idle(lax(32))) }, undefined, "usum")).b, OL);
    expect(r.volatiles.rollout).toMatchObject({ hitCount: 2, contactHitCount: 2, duration: 1 });
    expect(r.lastMoveTargetLoc).toBe(1);
  });
  it("Bide: the store, its source, release at duration 1 and storing at 2", () => {
    const c = (release: boolean) => base({ slots: slots(act(carried(lax(8), { bide: { stored: 50, source: PR, release } }), "Bide"), idle(lax(16)), idle(lax(24)), idle(lax(32))) }, undefined, "usum");
    const b = prepare(c(true)).b;
    expect(pokemonAt(b, OL).volatiles.bide).toMatchObject({ duration: 1, totalDamage: 50 });
    expect(pokemonAt(b, OL).volatiles.bide.lastDamageSource).toBe(monOf(b, PR));
    expect(pokemonAt(prepare(c(false)).b, OL).volatiles.bide.duration).toBe(2);
  });
  it("Cud Chew's Berry due this turn: abilityState.berry and counter 1; a bare true sets nothing", () => {
    const p = pokemonAt(prepare(base({}, carried(mon("Farigiraf", "Cud Chew"), { cudChew: "Sitrus Berry" }))).b, OL);
    expect(p.abilityState.berry.id).toBe("sitrusberry");
    expect(p.abilityState.counter).toBe(1);
    expect(pokemonAt(prepare(base({}, carried(mon("Farigiraf", "Cud Chew"), { cudChew: true }))).b, OL).abilityState.berry).toBeUndefined();
  });
  it("the target of the last move (Instruct): lastMoveTargetLoc", () => {
    const p = pokemonAt(prepare(base({}, lax(8, { lastMove: "Body Slam", lastMoveTarget: PL }))).b, OL);
    expect(p.lastMove.id).toBe("bodyslam");
    expect(p.lastMoveTargetLoc).toBe(2);
  });
});

describe("prepare(): the landings (C33, T2E §4.1.9)", () => {
  it("from a Pokémon of the turn: the futuremove slot condition on the target's slot, its source, landing now", () => {
    const c = base({ slots: slots(idle(mon("Hatterene", "Magic Bounce")), idle(lax(16)), idle(lax(24)), idle(carried(lax(32), { futureMove: { move: "futuresight", source: OL } }))) });
    const b = prepare(c).b;
    const target = pokemonAt(b, PR);
    const st = target.side.slotConditions[target.position].futuremove;
    expect(st.source).toBe(monOf(b, OL));
    expect(st.endingTurn).toBe(0);
    expect(st.moveData.basePower).toBe(120);
  });
  it("from a bench Pokémon (its set on the bench before the Snorlax), fainted on an earlier turn, Terastallized", () => {
    const bench = mon("Hatterene", "Magic Bounce", { item: "Choice Specs" });
    const c = base({ slots: slots(idle(lax(2)), idle(lax(16)), idle(lax(24)), idle(carried(lax(32), { futureMove: { move: "futuresight", bench, benchSide: "own", fainted: true, terastallized: "Psychic" } }))) });
    const b = prepare(c).b;
    const source = b.sides[0].pokemon.find((p: any) => p.name.startsWith("Lander"));
    expect(source.species.name).toBe("Hatterene");
    expect(source.fainted).toBe(true);
    expect(source.terastallized).toBe("Psychic");
    expect(b.sides[0].pokemon.some((p: any) => p.name === "Bench")).toBe(true);
    const target = pokemonAt(b, PR);
    expect(target.side.slotConditions[target.position].futuremove.source).toBe(source);
  });
  it("the app input: a source slot as is, a bench user as its build (Tera as the mechanic), a bare id as the id", async () => {
    const runtime = await runtimeFor({ game: "sv" } as Case);
    const bench = mon("Hatterene", "Magic Bounce");
    const c = base({ slots: slots(idle(lax(2)), idle(carried(lax(16), { futureMove: { move: "futuresight", source: OL } })), idle(carried(lax(24), { futureMove: "futuresight" })),
      idle(carried(lax(32), { futureMove: { move: "futuresight", bench, benchSide: "own", terastallized: "Psychic" } }))) });
    const input = caseInput(c, runtime);
    expect(input.pokemon[OR]!.carried!.futureMove).toEqual({ move: "futuresight", source: OL });
    expect(input.pokemon[PL]!.carried!.futureMove).toBe("futuresight");
    const fm = input.pokemon[PR]!.carried!.futureMove as { build: { speciesId: string; mechanic?: string } };
    expect(fm.build.speciesId).toBe("hatterene");
    expect(fm.build.mechanic).toBe("tera");
  });
});

describe("prepare(): the battle's history (Copycat, Retaliate, Echoed Voice) and the sides", () => {
  it("battle.lastMove, side.faintedLastTurn, the echoedvoice pseudo-weather at its multiplier, G-Max Vine Lash on a side", () => {
    const c = base({ battleLastMove: "Ember", faintedLastTurn: { own: true }, echoedVoice: 2, field: { opponent: { gmaxResidual: ["gmaxvinelash"] } } }, lax(8), "swsh");
    const b = prepare(c).b;
    expect(b.lastMove.id).toBe("ember");
    expect(b.sides[0].faintedLastTurn).toBeTruthy();
    expect(b.sides[1].faintedLastTurn).toBeFalsy();
    expect(b.field.pseudoWeather.echoedvoice).toMatchObject({ multiplier: 2, duration: 1 });
    expect(b.sides[1].sideConditions.gmaxvinelash.duration).toBe(3);
    expect(prepare(base({ battleLastMove: null })).b.lastMove).toBeNull();
  });
  it("the app input gets them (battleLastMove as an id, faintedLastTurn, echoedVoice, gmaxResidual)", async () => {
    const runtime = await runtimeFor({ game: "swsh" } as Case);
    const input = caseInput(base({ battleLastMove: "Fire Fang", faintedLastTurn: { own: true }, echoedVoice: 0, field: { opponent: { gmaxResidual: ["gmaxwildfire"] } } }, lax(8), "swsh"), runtime);
    expect(input.battleLastMove).toBe("firefang");
    expect(input.faintedLastTurn).toEqual({ own: true });
    expect(input.echoedVoice).toBe(0);
    expect(input.field.defenderSide.gmaxResidual).toEqual(["gmaxwildfire"]);
  });
});

describe("the random start (Case.startRandom) and the other 1b options", () => {
  it("Trace with two candidates: the start paths' weights sum to 1, half of them Rough Skin", () => {
    const c = base({ startRandom: true, keepStartBoosts: true, slots: slots(idle(mon("Gardevoir", "Trace")), idle(lax(16)), idle(mon("Garchomp", "Rough Skin")), idle(mon("Hydreigon", "Levitate"))) });
    const starts = prepareAll(c);
    const total = starts.reduce((a, s) => a + s.weight, 0);
    expect(total).toBeCloseTo(1, 12);
    const rough = starts.filter((s) => pokemonAt(s.b, OL).ability === "roughskin").reduce((a, s) => a + s.weight, 0);
    expect(rough).toBeCloseTo(0.5, 12);
    // Without startRandom the seeded start is one path.
    expect(prepareAll({ ...c, startRandom: undefined }).length).toBe(1);
  });
  it("keepStartBoosts leaves a lead Intimidate's drop as Showdown made it; without it the case's stages win", () => {
    const c = base({ keepStartBoosts: true, slots: slots(idle(mon("Incineroar", "Intimidate")), idle(lax(16)), idle(lax(24)), idle(lax(32))) });
    expect(pokemonAt(prepare(c).b, PR).boosts.atk).toBe(-1);
    expect(pokemonAt(prepare({ ...c, keepStartBoosts: undefined }).b, PR).boosts.atk).toBe(0);
  });
  it("exactMoves: no Splash slot (Sleep Talk picks among the case's moves only)", () => {
    const p = pokemonAt(prepare(base({ slots: slots(act(lax(8, { status: "slp", moves: ["Body Slam"], exactMoves: true }), "Sleep Talk"), idle(lax(16)), idle(lax(24)), idle(lax(32))) })).b, OL);
    expect(p.moveSlots.map((s: any) => s.id)).toEqual(["sleeptalk", "bodyslam"]);
  });
  it("choice(): a commanding Tatsugiri passes; a random-target move and a locked move take no target", () => {
    const dozo = mon("Dondozo", "Unaware", { boosts: { atk: 2, def: 2, spa: 2, spd: 2, spe: 2 } });
    const { b, choices } = prepare(base({ slots: slots(act(mon("Tatsugiri", "Commander"), "Dragon Pulse", PR), idle(dozo), idle(lax(24)), idle(lax(32))) }));
    expect(pokemonAt(b, OL).volatiles.commanding).toBeDefined();
    expect(choices[0].startsWith("pass,")).toBe(true);
    const u = prepare(base({ slots: slots(act(mon("Annihilape", "Inner Focus"), "Uproar", PL), idle(lax(16)), idle(lax(24)), idle(lax(32))) }));
    expect(choice(u.b, u.b && base({ slots: slots(act(mon("Annihilape", "Inner Focus"), "Uproar", PL), idle(lax(16)), idle(lax(24)), idle(lax(32))) }), OL)).toBe("move 1");
  });
});

describe("the walk: copied uses, Magnitude, G-Max Replenish", () => {
  it("a Dancer's copy is its own record (Dancer:<slot>:<move>:<dance user>), the dance's own step unchanged", () => {
    const c = base({ slots: slots(idle(mon("Oricorio", "Dancer")), idle(lax(1)), idle(lax(2)), act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Swords Dance")) });
    const w = walk(c, "lowest");
    expect(Object.keys(w.copies ?? {})).toEqual(["Dancer:own-left:swordsdance:opponent-right"]);
    expect(w.copies!["Dancer:own-left:swordsdance:opponent-right"].moved).toBeCloseTo(1, 12);
    expect(w.steps[PR]!.moved).toBeCloseTo(1, 12);
    expect(w.steps[PR]!.orderAll).toEqual({ 1: 1 });
  });
  it("an instructed move is its target's copied record; the target's own action keeps its position", () => {
    const c = base({ slots: slots(act(mon("Oranguru", "Inner Focus"), "Instruct", OR), act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Dragon Claw", PR), idle(lax(2)), idle(lax(1))) });
    const w = walk(c, "lowest");
    expect(Object.keys(w.copies ?? {})).toEqual(["Instruct:own-right:dragonclaw:own-left"]);
    expect(w.steps[OR]!.orderAll).toEqual({ 1: 1 });
    expect(w.steps[OL]!.orderAll).toEqual({ 2: 1 });
  });
  it("a commanding Tatsugiri's slot takes no position and the first move's HP is read", () => {
    const dozo = mon("Dondozo", "Unaware", { boosts: { atk: 2, def: 2, spa: 2, spd: 2, spe: 2 } });
    const c = base({ slots: slots(act(mon("Tatsugiri", "Commander"), "Dragon Pulse", PR), act(dozo, "Wave Crash", PL), idle(lax(24)), idle(lax(32))) });
    const w = walk(c, "lowest");
    expect(w.steps[OR]!.orderAll).toEqual({ 1: 1 });
    expect(w.steps[OL]!.picked).toBe(0);
    expect(Number.isFinite(w.slots[OL].start)).toBe(true);
  });
  it("a Bide release (no |move| line: '-end … move: Bide', tryMoveHit) counts as moved, its target reached and hit for 2x the store", () => {
    const c = base({ slots: slots(act(carried(lax(8), { bide: { stored: 50, source: PR, release: true } }), "Bide"), idle(lax(16)), idle(lax(24)), idle(lax(32))) }, undefined, "usum");
    const w = walk(c, "lowest");
    expect(w.steps[OL]!.moved).toBeCloseTo(1, 12);
    expect(w.steps[OL]!.hits[PR]).toMatchObject({ reached: 1, landed: 1, dmgMin: 100, dmgMax: 100 });
    // Storing (duration 2): no use.
    const store = base({ slots: slots(act(carried(lax(8), { bide: { stored: 50, source: PR, release: false } }), "Bide"), idle(lax(16)), idle(lax(24)), idle(lax(32))) }, undefined, "usum");
    expect(walk(store, "lowest").steps[OL]!.moved).toBe(0);
  });
  it("G-Max Replenish's one 1/2 for the move (its self.onHit has no effect set): the eaten Berries come back half the time", () => {
    const gmax = mon("Snorlax", "Thick Fat", { evs: { spe: 252 }, choice: "dynamax", gigantamax: true, lastItem: "Lum Berry" });
    const c = base({ slots: slots(act(gmax, "Body Slam", PR), idle(lax(16, { lastItem: "Sitrus Berry" })), idle(lax(24)), idle(lax(32))) }, undefined, "swsh");
    const w = walk(c, "lowest");
    expect(w.decisions["chance:gmaxreplenish"]).toBeGreaterThan(0);
    expect(w.slots[OL].item!.lumberry).toBeCloseTo(0.5, 12);
    expect(w.slots[OR].item!.sitrusberry).toBeCloseTo(0.5, 12);
  });
  it("a damage callback's fraction (Metal Burst: 1.5x) is recorded as the HP it takes (floored)", () => {
    const c = base({ slots: slots(act(mon("Bastiodon", "Sturdy", { evs: { hp: 252, spd: 252 } }), "Metal Burst"), idle(lax(1)), idle(lax(2)), act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Dragon Pulse", OL)) });
    const h = walk(c, "highest").steps[OL]!.hits[PR]!;
    expect(Number.isInteger(h.dmgMin) && Number.isInteger(h.dmgMax)).toBe(true);
    expect(h.dmgMax).toBe(22);
  });
  it("Magnitude's seven bands at 5/10/20/30/20/10/5 %", () => {
    const c = base({ slots: slots(act(mon("Dugtrio", "Arena Trap", { evs: { spe: 252 } }), "Magnitude"), idle(lax(16)), idle(lax(24)), idle(lax(32))) }, undefined, "usum");
    const w = walk(c, "lowest");
    expect(w.decisions.magnitude).toBeGreaterThan(0);
    // The foe's HP takes seven values (power 10…150) at the bands' masses.
    expect(w.slots[PL].dist.map(([, p]) => p)).toEqual([0.05, 0.1, 0.2, 0.3, 0.2, 0.1, 0.05].map((p) => expect.closeTo(p, 12)));
  });
});

describe("compare.ts: calling moves, copies, named step facts", () => {
  const step = (over: Partial<StepResult>): StepResult => ({ moveId: "x", picked: 1, faintedAtPick: 0, moved: 1, cant: {}, orderAll: { 1: 1 }, orderMoved: { 1: 1 }, hits: {}, lines: {}, effects: {}, change: {}, sides: {}, ...over });
  const hp = { start: 100, maximum: 100, low: 100, high: 100, average: 100, min: 100, max: 100, koChance: 0, dist: [[100, 1]] as [number, number][] };
  const oracleOf = (steps: OracleResult["walks"]["all"]["steps"], copies?: OracleResult["walks"]["all"]["copies"]): OracleResult => {
    const slotsR = Object.fromEntries(SLOTS.map((s) => [s, { species: "Snorlax", ...hp, modeTieUp: 100, modeTieDown: 100 }])) as OracleResult["walks"]["all"]["slots"];
    const w = { mode: "all" as const, exact: true, runs: 1, classes: 1, ms: 0, decisions: {}, slots: slotsR, steps, ...(copies ? { copies } : {}) };
    return { id: "V2-T", title: "t", game: "sv", format: "f", checks: "t", walks: { all: w, lowest: w, highest: w }, expected: Object.fromEntries(SLOTS.map((s) => [s, hp])) as OracleResult["expected"], warnings: [] };
  };
  const appHP = Object.fromEntries(SLOTS.map((s) => [s, { start: 100, maximum: 100, low: 100, high: 100, average: 100, min: 100, max: 100, koChance: 0, heals: [], losses: [] }]));
  const result = (steps: Partial<DoublesStep>[], facts = ["Every move hits; no critical hits; added effects below 100% do not happen."]): DoublesTurnResult =>
    ({ status: "ready", facts, steps: steps.map((s) => ({ order: [{ position: 1, chance: 1 }], moves: 1, skipped: [], hits: [], facts: [], ...s })), hp: appHP, swapped: {}, endOfTurn: { status: "ready", hp: appHP, residuals: [] }, startRows: [] } as unknown as DoublesTurnResult);
  const c = base({ slots: slots(act(mon("Bellossom", "Chlorophyll"), "Nature Power", PL), idle(lax(16)), idle(lax(24)), idle(lax(32))) });
  it("a status calling move that called a damaging move compares as damaging (usedmove keys)", () => {
    const o = oracleOf({ [OL]: step({ moveId: "naturepower", effects: { [OL]: { "usedmove:psychic:naturepower": 1 } }, hits: { [PL]: { reached: 1, landed: 1, ko: 0, dmgMin: 44, dmgMax: 52 } } }) });
    const isStatus = (m: string) => m === "naturepower";
    const good = result([{ slot: OL, moveId: "naturepower", hits: [{ slot: PL, kind: "calculated", reached: 1, koChance: 0, min: 44, max: 52, cases: 1, facts: [] }] }]);
    expect(compareCase(c, o, good, isStatus).filter((m) => m.where.startsWith("own-left"))).toEqual([]);
    const bad = result([{ slot: OL, moveId: "naturepower", hits: [{ slot: PL, kind: "calculated", reached: 1, koChance: 0, min: 40, max: 52, cases: 1, facts: [] }] }]);
    expect(compareCase(c, o, bad, isStatus).some((m) => m.field === "hit.min")).toBe(true);
  });
  it("copies pair with the app's copied steps by slot and move, in the source's order", () => {
    const copies = {
      "Dancer:own-left:fierydance:own-right": { ...step({ moveId: "fierydance", hits: { [PR]: { reached: 1, landed: 1, ko: 0, dmgMin: 21, dmgMax: 25 } } }), slot: OL, copied: "Dancer" as const, source: OR },
      "Dancer:own-left:fierydance:opponent-left": { ...step({ moveId: "fierydance", hits: { [PL]: { reached: 1, landed: 1, ko: 0, dmgMin: 43, dmgMax: 52 } } }), slot: OL, copied: "Dancer" as const, source: PL },
    };
    const steps = { [OR]: step({ moveId: "fierydance", orderAll: { 1: 1 } }), [PL]: step({ moveId: "fierydance", orderAll: { 2: 1 } }) };
    const o = oracleOf(steps, copies);
    const own = (slot: typeof OR, at: number) => ({ slot, moveId: "fierydance", order: [{ position: at, chance: 1 }] });
    const two = result([own(OR, 1), { slot: OL, moveId: "fierydance", copied: "Dancer", order: [], hits: [{ slot: PR, kind: "calculated", reached: 1, koChance: 0, min: 21, max: 25, cases: 1, facts: [] }] },
      own(PL, 2), { slot: OL, moveId: "fierydance", copied: "Dancer", order: [], hits: [{ slot: PL, kind: "calculated", reached: 1, koChance: 0, min: 43, max: 52, cases: 1, facts: [] }] }]);
    const cc = base({ slots: slots(idle(mon("Oricorio", "Dancer")), act(mon("Volcarona", "Flame Body"), "Fiery Dance", PR), act(mon("Volcarona", "Flame Body"), "Fiery Dance", OR), idle(lax(32))) });
    expect(compareCase(cc, o, two).filter((m) => m.where.includes("copy"))).toEqual([]);
    const one = result([own(OR, 1), own(PL, 2), { slot: OL, moveId: "fierydance", copied: "Dancer", order: [], hits: [{ slot: PR, kind: "calculated", reached: 1, koChance: 0, min: 21, max: 25, cases: 1, facts: [] }] }]);
    expect(compareCase(cc, o, one).some((m) => m.where.includes("copy") && m.field === "step")).toBe(true);
  });
  it("a step fact '{Effect}: {Name} ±n {Stat}.' counts for the Pokémon it names (Wind Rider on the ally)", () => {
    const cc = base({ slots: slots(act(mon("Talonflame", "Flame Body"), "Tailwind"), idle(mon("Brambleghast", "Wind Rider")), idle(lax(24)), idle(lax(32))) });
    const o = oracleOf({ [OL]: step({ moveId: "tailwind", effects: { [OR]: { "boost:atk:1": 1 } } }) });
    const isStatus = () => true;
    const withFact = result([{ slot: OL, moveId: "tailwind", facts: [{ text: "Wind Rider: Brambleghast +1 Attack.", chance: 1 }] }]);
    expect(compareCase(cc, o, withFact, isStatus).filter((m) => m.field.startsWith("effect"))).toEqual([]);
    const without = result([{ slot: OL, moveId: "tailwind", facts: [] }]);
    expect(compareCase(cc, o, without, isStatus).some((m) => m.field === "effect boost:atk:1")).toBe(true);
  });
});

describe("the case set and the changed list (ADDENDUM2 §7.1, §7.2)", () => {
  it("every wave 1b case has an owner, a unique id, and is in CASES", () => {
    const ids = new Set(CASES.map((c) => c.id));
    for (const c of WAVE1B_CASES) {
      expect(ownerOf1b(c.id), c.id).not.toBe("?");
      expect(ids.has(c.id), c.id).toBe(true);
    }
    expect(new Set(WAVE1B_CASES.map((c) => c.id)).size).toBe(WAVE1B_CASES.length);
  });
  it("1b's removed texts: the field's end, the E2 and calling reasons; the kept ones stay", () => {
    expect(removalOf("Magic Room ending is not modelled in 2v2.")?.wave).toBe("1b");
    expect(removalOf("Misty Terrain ending is not modelled in 2v2.")?.wave).toBe("1b");
    expect(removalOf("Neutralizing Gas ending is not modelled in 2v2.")?.wave).toBe("kept");
    expect(removalOf("Sleep Talk is not modelled in 2v2.")?.owner).toBe("CL");
    expect(REEXPECT_TO.ER41d.endNotEstimated).toBe("Cud Chew needs Farigiraf's Berry from the last turn.");
    expect(REEXPECT_TO.S47b.notEstimated).toBe("Sleep Talk needs Snorlax's moves.");
  });
  it("changed-cases: the 1b rows over the cases before wave 1b (wave 1a's included), one row per reason", () => {
    const rows = listChanged({ wave1b: true }).filter((l) => l.wave === "1b");
    const ids = new Set(rows.map((r) => r.id));
    for (const id of ["ER41d", "ER41e", "ER41g-usum", "R09", "R10", "F14a", "S47c", "FS08e-sv", "G4-WHR-01-sv", "G4-ENC-01-sv"]) expect(ids.has(id), id).toBe(true);
    expect(rows.some((r) => WAVE1B_CASES.some((c) => c.id === r.id))).toBe(false);
    const keys = rows.map((r) => `${r.id}|${r.why}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
void PR; void OR;
