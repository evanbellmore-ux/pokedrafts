// Track R-V (status2 wave 2): regression tests for the oracle harness's switch-outs with a replacement: the bench members
// (prepare, hidden sleep, the checks), hazard layers, the identity keys, the mid-turn and after-the-residual switch answers
// (the default and Case.replacement), random drags over the bench, the cancelled action's order, the snapshots that keep a
// queued switch's move (Baton Pass, Shed Tail), Pursuit at a foe's switch, app-turn.ts's bench / replacement / hazards input,
// compare.ts's bench comparisons (replaced, hpEntered, the newcomers' hits and E2, the default replacement's facts), and
// changed-cases.ts's wave 2 rows.
//   npx vitest run --config scripts/.cache/calc-audit/2v2/verify/v3/vitest.v3.config.mts
import { describe, expect, it } from "vitest";
import type { Case, CaseBenchMon, OracleResult } from "../case-types";
import { OL, OR, PL, PR, act, idle, lax, mon, slots } from "../case-kit";
import { compareWalks, hiddenCases, idOf, keyOf, monOf, oracle, pokemonAt, prepare, splitKey, walk, walkReplay } from "../sim-dfs";
import { oracle as oracleBefore } from "../sim-dfs-pre-r";
import { benchPokemon, caseBenchInput, caseHazards, caseInput, preflight, runtimeFor } from "../app-turn";
import { compareCase } from "../compare";
import { CASE_BY_ID } from "../cases";
import { removalOf } from "../status2-removed";
import { listChanged2 } from "../../../status2/build/changed-cases";
import type { DoublesOutcomesResult, DoublesTurnResult } from "@/app/lib/battle/doubles-types";

const byId = (id: string) => {
  const c = CASE_BY_ID.get(id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
};
const member = (id: string, extra: Partial<CaseBenchMon> = {}): CaseBenchMon => ({ ...lax(4), ...extra, id });
const base = (over: Partial<Case>, game: Case["game"] = "sv"): Case => ({
  id: "R-V-T", title: "t", game, checks: "t", slots: slots(idle(lax(8)), idle(lax(16)), idle(lax(24)), idle(lax(32))), ...over,
});
const uturn = (over: Partial<Case> = {}) => base({
  slots: slots(act(mon("Ambipom", "Technician", { evs: { spe: 252 } }), "U-turn", PL), idle(lax(16)), act(lax(24), "Body Slam", OL), idle(lax(32))),
  bench: { own: { members: [member("a", { hp: 200 }), member("b")] } }, ...over,
});

describe("prepare(): the bench members (Case.bench.{side}.members)", () => {
  it("take the Snorlax's place on their side, with their ids, HP and status; the starting Pokémon keep their identity", () => {
    const b = prepare(byId("G4-SWX-08-sv")).b;
    const names = (i: number) => b.sides[i].pokemon.slice(2).map((p: any) => p.name);
    expect(names(1)).toEqual(["corv", "bliss"]);
    expect(names(0)).toEqual(["Bench"]);
    const corv = b.sides[1].pokemon.find((p: any) => p.name === "corv");
    expect(corv.m).toMatchObject({ benchId: "corv", startHP: corv.maxhp });
    expect(pokemonAt(b, OL).m.keep).toBe(true);
    const c = base({ bench: { opponent: { members: [member("x", { hp: 100, status: "par" })] } } });
    const x = prepare(c).b.sides[1].pokemon.find((p: any) => p.name === "x");
    expect([x.hp, x.status, x.m.startHP]).toEqual([100, "par", 100]);
  });
  it("an asleep member's hidden sleep length is a weighted sub-case; its counter is set", () => {
    const c = base({ bench: { own: { members: [member("z", { status: "slp", carried: { sleep: { attempts: 1, rest: false } } })] } } });
    const subs = hiddenCases(c);
    expect(subs.map((s) => s.label)).toEqual(["bench:z sleep 2", "bench:z sleep 3", "bench:z sleep 4"]);
    expect(subs.reduce((a, s) => a + s.weight, 0)).toBeCloseTo(1, 12);
    const z = prepare(c, subs[1].hidden).b.sides[0].pokemon.find((p: any) => p.name === "z");
    expect([z.statusState.startTime, z.statusState.time]).toEqual([3, 2]);
  });
  it("refuses what a bench cannot be: members with the Snorlax's status, with canSwitch false, a replacement not on the bench, a switch-in beside a bench, a reserved id", () => {
    expect(() => prepare(base({ bench: { own: { members: [member("a")], status: "par" } } }))).toThrow(/not both/);
    expect(() => prepare(base({ bench: { own: { members: [member("a")] } }, canSwitch: { own: false } }))).toThrow(/canSwitch false/);
    expect(() => prepare(uturn({ replacement: { [OL]: "nope" } }))).toThrow(/not on its side's bench/);
    expect(() => prepare(base({ bench: { own: { members: [member("slot-x")] } } }))).toThrow(/bench id/);
    const switchIn = base({ slots: slots({ ...lax(8), action: { move: null, switchIn: true } }, idle(lax(16)), idle(lax(24)), idle(lax(32))), bench: { opponent: { members: [member("a")] } } });
    expect(() => prepare(switchIn)).toThrow(/switch-in slot beside a bench/);
  });
  it("hazards with layers (Spikes 3, Toxic Spikes 2) and SwSh's G-Max Steelsurge", () => {
    const b = prepare(base({ field: { own: { hazards: ["spikes", "toxicspikes"], layers: { spikes: 3, toxicSpikes: 2 } }, opponent: { hazards: ["stealthrock"] } } })).b;
    expect([b.sides[0].sideConditions.spikes.layers, b.sides[0].sideConditions.toxicspikes.layers]).toEqual([3, 2]);
    expect(b.sides[1].sideConditions.stealthrock).toBeDefined();
    expect(prepare(base({ field: { own: { hazards: ["gmaxsteelsurge"] } } }, "swsh")).b.sides[0].sideConditions.gmaxsteelsurge).toBeDefined();
  });
  it("identity keys: a slot, or '<slot>|<id>' for a newcomer; ids startId-like for the starting Pokémon", () => {
    expect(splitKey("own-left|inci")).toEqual(["own-left", "inci"]);
    expect(splitKey("own-left")).toEqual(["own-left", null]);
    const b = prepare(uturn()).b;
    expect(idOf(pokemonAt(b, OL))).toBe("slot:own-left");
    const a = b.sides[0].pokemon.find((p: any) => p.name === "a");
    expect(idOf(a)).toBe("a");
    expect(keyOf(a)).toBeNull();
    a.m.enteredFor = OL;
    expect(keyOf(a)).toBe("own-left|a");
  });
});

describe("the walk: switch requests answered from the bench", () => {
  it("U-turn mid-turn: the first bench Pokémon by default (chosen), its HP after a later Body Slam; the leaver by identity", () => {
    const w = walk(uturn(), "all");
    expect(w.replaced?.[OL]).toMatchObject({ left: [{ id: "slot:own-left", chance: 1 }], entered: [{ id: "a", chance: 1, chosen: 1 }] });
    const a = w.entered![OL]!.a;
    expect(a.start).toBe(200);
    expect(a.max).toBeLessThan(200);
    expect(w.steps[PL]!.hitsEntered?.[OL]?.a?.reached).toBe(1);
    expect(w.steps[PL]!.hits[OL]).toBeUndefined();
    expect(w.slots[OL].dist).toEqual([[w.slots[OL].start, 1]]);
  });
  it("Case.replacement picks the second bench Pokémon", () => {
    const w = walk(uturn({ replacement: { [OL]: "b" } }), "all");
    expect(w.replaced?.[OL]?.entered).toEqual([{ id: "b", chance: 1, chosen: 1 }]);
  });
  it("a random drag (Roar) over a two-Pokémon bench: 1/2 each, not chosen; their residuals keep their ids", () => {
    const r = oracle(byId("G4-SWX-04-sv"));
    expect(r.walks.all.decisions.drag).toBeGreaterThan(0);
    expect(r.expectedReplaced?.[PL]?.entered).toEqual([{ id: "lax", chance: 0.5 }, { id: "bliss", chance: 0.5 }]);
    expect(r.residuals?.filter((x) => x.id).map((x) => [x.slot, x.id, x.effect])).toEqual([[PL, "lax", "Leftovers"], [PL, "bliss", "Leftovers"]]);
    expect(r.afterTurnEntered?.[PL]?.lax?.low).toBe(164);
  });
  it("Eject Button: the holder's queued move is cancelled (never picked) and the later action is the second in the order", () => {
    const w = walk(byId("G4-SWX-08-sv"), "all");
    expect(w.steps[PL]).toMatchObject({ picked: 0, moved: 0, orderAll: {} });
    expect(w.steps[OR]!.orderAll).toEqual({ 2: 1 });
    expect(w.steps[OR]!.hitsEntered?.[PL]?.corv?.reached).toBe(1);
  });
  it("Emergency Exit after the residual: answered, the newcomer meets Stealth Rock; only the after-the-turn table has it", () => {
    const r = oracle(byId("G4-SWX-12-usum"));
    expect(r.walks.all.replaced ?? {}).toEqual({});
    expect(r.afterTurnReplaced?.[PL]).toMatchObject({ left: [{ id: "slot:opponent-left", chance: 1, low: 71 }], entered: [{ id: "lax", chance: 1 }] });
    expect(r.afterTurnEntered?.[PL]?.lax).toMatchObject({ start: 200, low: 171, high: 171 });
    expect(r.afterTurn?.[PL]?.low).toBe(71);
  });
  it("a snapshot keeps a queued switch's move: Baton Pass passes the stages, Shed Tail its Substitute; the walk equals whole-turn replays", () => {
    for (const id of ["G4-SWX-09-sv", "G4-SWX-19-sv"]) {
      const c = byId(id);
      const fast = walk(c, "all"), ref = walkReplay(c, "all");
      expect(compareWalks(fast, ref)).toEqual([]);
      if (id === "G4-SWX-09-sv") expect(fast.afterTurn?.entered?.[OL]?.lax?.boosts).toEqual({ "atk:2": 1, "evasion:1": 1 });
      else expect(fast.steps[PL]!.hitsEntered?.[OL]?.lax?.sub).toMatchObject({ mass: 1, breaks: 1 });
    }
  });
  it("Pursuit at the U-turn user's switch-out is its own user's action (second in the order), into the switching Pokémon", () => {
    const w = walk(byId("CQ-PUR-R-01-usum"), "all");
    expect(w.steps[PL]).toMatchObject({ picked: 1, moved: 1, orderAll: { 2: 1 } });
    expect(w.steps[PL]!.hits[OL]?.reached).toBe(1);
    expect(w.steps[OL]!.hits[OL]).toBeUndefined();
  });
  it("a request from a side without a bench in the case is not answered (as before: a mid-turn switch is not supported)", () => {
    const c = uturn({ bench: { opponent: { members: [member("o")] } } });
    expect(() => walk(c, "all")).toThrow(/a mid-turn switch is not supported/);
  });
  it("without a bench the oracle is the one before wave 2, byte for byte (ms aside)", () => {
    const strip = (r: OracleResult) => JSON.stringify(r, (k, v) => (k === "ms" ? undefined : v));
    for (const id of ["ZS16", "ER32a", "S1-RSP-champions"]) expect(strip(oracle(byId(id)))).toBe(strip(oracleBefore(byId(id))));
  });
  it("monOf finds a starting Pokémon on the bench only in a case with a bench", () => {
    const c = uturn();
    const b = prepare(c).b;
    const leaver = pokemonAt(b, OL);
    leaver.isActive = false;
    b.sides[0].active[0] = b.sides[0].pokemon.find((p: any) => p.name === "a");
    expect(monOf(b, OL)).toBe(leaver);
  });
});

describe("app-turn.ts: the bench, the replacement and the hazards of the input", () => {
  it("bench members as DoublesBenchPokemon (build, sleep and freeze counters, onceUsed, moves); a side with members only", async () => {
    const runtime = await runtimeFor({ game: "sv" } as Case);
    const m = member("z", { status: "slp", carried: { sleep: { attempts: 1, rest: false } }, moves: ["Body Slam", "Body Slam", "Rest"] });
    expect(benchPokemon(m, runtime)).toMatchObject({ id: "z", build: { speciesId: "snorlax", status: "slp" }, carried: { sleep: { attempts: 1, rest: false } }, moves: ["bodyslam", "rest"] });
    const input = caseInput(uturn({ replacement: { [OL]: "b" }, field: { own: { hazards: ["spikes", "stealthrock"], layers: { spikes: 2 } } } }), runtime);
    expect(input.bench?.own?.map((x) => x.id)).toEqual(["a", "b"]);
    expect(input.bench?.opponent).toBeUndefined();
    expect(input.replacement).toEqual({ [OL]: "b" });
    expect(input.hazards).toEqual({ own: { spikes: 2, stealthRock: true } });
    expect(caseBenchInput(base({}), runtime)).toEqual({});
  });
  it("hazards map to DoublesHazards (one layer by default; Steelsurge); a landing from a bench member is its build", async () => {
    expect(caseHazards({ hazards: ["toxicspikes", "stickyweb", "gmaxsteelsurge"] })).toEqual({ toxicSpikes: 1, stickyWeb: true, steelsurge: true });
    expect(caseHazards({})).toBeNull();
    const runtime = await runtimeFor({ game: "sv" } as Case);
    const input = caseInput(byId("IN-FSL-02-sv"), runtime);
    const fm = input.pokemon[PR]!.carried!.futureMove as { move: string; build: { speciesId: string; itemId: string } };
    expect([fm.move, fm.build.speciesId, fm.build.itemId]).toEqual(["futuresight", "hatterene", "twistedspoon"]);
  });
  it("preflight checks the bench members' builds and moves too", async () => {
    const runtime = await runtimeFor({ game: "sv" } as Case);
    expect(preflight(base({ bench: { own: { members: [member("q", { moves: ["Spore"] })] } } }), runtime)).toEqual(["bench q: Snorlax does not learn spore in scarlet_violet"]);
  });
});

describe("compare.ts: the bench comparisons", () => {
  const c = byId("G4-SWX-01-sv");
  const o = oracle(c);
  const hpOf = (e: { start: number; maximum: number; low: number; high: number; average: number; min: number; max: number; koChance: number }) =>
    ({ start: e.start, maximum: e.maximum, low: e.low, high: e.high, average: e.average, min: e.min, max: e.max, koChance: e.koChance, heals: [] });
  /** A ready result with only what compareBench reads (its other mismatches are filtered out below). */
  const ready = (over: Partial<Extract<DoublesTurnResult, { status: "ready" }>> = {}): DoublesTurnResult => ({
    status: "ready", start: {} as never, steps: [], hp: {} as never, startRows: [], facts: ["Assumes Incineroar comes in for Rillaboom."],
    endOfTurn: { status: "ready", hp: {} as never, residuals: [], facts: [], hpEntered: { [OL]: { inci: hpOf(o.afterTurnEntered![OL]!.inci) } }, replaced: {} },
    replaced: { [OL]: { left: [{ id: "slot:own-left", hp: hpOf(o.expectedReplaced![OL]!.left[0]), chance: 1 }], entered: [{ id: "inci", chance: 1 }] } },
    hpEntered: { [OL]: { inci: hpOf(o.expectedEntered![OL]!.inci) } }, ...over,
  });
  const bench = (r: DoublesTurnResult) => compareCase(c, o, r).filter((m) => /replaced|hpEntered|default replacement/.test(`${m.where} ${m.field}`));
  it("a result with the oracle's leaver, newcomer and HP agrees; the default replacement's fact is required", () => {
    expect(bench(ready())).toEqual([]);
    expect(bench(ready({ facts: [] })).map((m) => m.field)).toEqual(["facts (the default replacement)"]);
  });
  it("a missing newcomer HP, a wrong chance, or a switch Showdown does not have is a mismatch", () => {
    expect(bench(ready({ hpEntered: {} })).map((m) => m.field)).toEqual(["hpEntered"]);
    const wrong = ready();
    if (wrong.status === "ready") wrong.replaced![OL]!.entered[0].chance = 0.5;
    expect(bench(wrong).map((m) => m.field)).toEqual(["entered inci.chance"]);
    expect(bench(ready({ replaced: { ...(ready() as { replaced: object }).replaced, [OR]: { left: [], entered: [{ id: "x", chance: 1 }] } } })).some((m) => m.where === `replaced ${OR}`)).toBe(true);
  });
  it("E2: each slot compared as its starting Pokémon (DoublesOutcome.benched), each newcomer apart", () => {
    const build = (speciesId: string) => ({ speciesId, itemId: "", status: "", boosts: {} }) as never;
    const leftHp = o.walks.all.afterTurn!.slots[OL].dist;
    const inci = o.walks.all.afterTurn!.entered![OL]!.inci;
    const outcomes = (withLeaver: boolean): DoublesOutcomesResult => ({
      status: "ready", start: {} as never, endOfTurn: "applied",
      outcomes: [{
        chance: 1, mons: { [OL]: { id: "inci", hp: inci.dist.map(([hp, chance]) => ({ hp, chance })), build: build("incineroar"), protected: false, moved: false } },
        sides: { own: {}, opponent: {} } as never, field: {} as never, allFainted: {} as never, positions: { own: "kept", opponent: "kept" },
        ...(withLeaver ? { benched: { own: [{ id: "slot:own-left", slot: OL, hp: leftHp.map(([hp, chance]) => ({ hp, chance })), build: build("rillaboom"), protected: false, moved: true }] } } : {}),
      }],
    });
    const e2 = (r: DoublesOutcomesResult, slot: string) => compareCase(c, o, ready(), () => false, r).filter((m) => m.where.startsWith(`E2 ${slot}`) && /hp|came in|benched/.test(`${m.where} ${m.field}`));
    expect(e2(outcomes(true), OL)).toEqual([]);
    expect(e2(outcomes(false), OL).map((m) => m.field)).toContain("benched");
  });
});

describe("the wave 2 bookkeeping", () => {
  it("a stored case keeps the switch-out reason (no bench); changed-cases lists the stored cases whose hazards now reach the app", () => {
    expect(removalOf("Snorlax switches out: the replacement is not known.")).toMatchObject({ wave: "kept" });
    expect(listChanged2().map((l) => l.id).sort()).toEqual(["FS07b-champions", "FS08c-champions", "S1-RSP-champions", "S1-RSP-sv"]);
  });
});
void OR; void PR;
