import sys; sys.path.insert(0, 'v3/tools')
from patchlib import patch
P = 'gen-tests.ts'
patch(P, [
# Row type
("""  copies?: { slot: SlotId; copied: "Dancer" | "Instruct"; moveId: string; picked: number; moves: number; source: number }[];
};
const catalogs""",
"""  copies?: { slot: SlotId; copied: "Dancer" | "Instruct"; moveId: string; picked: number; moves: number; source: number }[];
  // status2 wave 2 (Track R-V): the bench, the replacement, and the switch-outs (verify/compare.ts compareBench).
  bench?: Case["bench"]; replacement?: Case["replacement"]; r?: unknown;
};
const catalogs"""),
# the row's wave 2 fields (after the copies, inside SE)
("""      row.copies = copies.map((x) => ({ slot: x.slot, copied: x.copied, moveId: x.moveId, picked: num(x.picked), moves: num(x.moved), source: num(meanPos(x.source)) })).sort((a, b) => a.source - b.source);
    }""",
"""      row.copies = copies.map((x) => ({ slot: x.slot, copied: x.copied, moveId: x.moveId, picked: num(x.picked), moves: num(x.moved), source: num(meanPos(x.source)) })).sort((a, b) => a.source - b.source);
    }
    // status2 wave 2 (Track R-V): a case with a bench: its bench and replacement, and verify/compare.ts compareBench's
    // expectations (the leavers and newcomers after the moves and the turn, the newcomers' hits and E2 state, the default
    // replacement's facts).
    if (c.bench && Object.values(c.bench).some((b) => b?.members !== undefined)) {
      row.bench = c.bench;
      if (c.replacement) row.replacement = c.replacement;
      row.r = benchRow(c, r, allWalk);
    }"""),
# the residuals keep their newcomer id
("""        residuals: (r.residuals ?? []).filter((x) => x.min !== null).map((x) => ({ slot: x.slot, chance: num(x.chance), min: x.min, max: x.max, koChance: num(x.koChance) })),""",
"""        residuals: (r.residuals ?? []).filter((x) => x.min !== null).map((x) => ({ slot: x.slot, ...(x.id ? { id: x.id } : {}), chance: num(x.chance), min: x.min, max: x.max, koChance: num(x.koChance) })),"""),
# benchRow helper, before the rows loop
("""const rows: Row[] = [];
let skipped = 0;""",
"""/** status2 wave 2: an Expected as the generated test's HP check (low, high, min, max, average, KO chance; start and maximum). */
const hpRow = (e: { start: number; maximum: number; low: number; high: number; min: number; max: number; average: number; koChance: number }) =>
  ({ start: e.start, maximum: e.maximum, low: e.low, high: e.high, min: e.min, max: e.max, average: num(e.average), koChance: num(e.koChance) });
/** status2 wave 2 (verify/compare.ts compareBench, compareEnteredHits, compareOutcomeNewcomers): a bench case's expectations. */
function benchRow(c: Case, r: OracleResult, walk: WalkResult) {
  type Rep = NonNullable<OracleResult["expectedReplaced"]>;
  type Ent = NonNullable<OracleResult["expectedEntered"]>;
  const rep = (x: Rep | null | undefined) => Object.fromEntries(Object.entries(x ?? {}).map(([slot, v]) => [slot, {
    left: v!.left.map((l) => ({ id: l.id, chance: num(l.chance), ...hpRow(l) })), entered: v!.entered.map((e) => ({ id: e.id, chance: num(e.chance) })),
  }]));
  const ent = (x: Ent | null | undefined) => Object.fromEntries(Object.entries(x ?? {}).map(([slot, byId]) => [slot, Object.fromEntries(Object.entries(byId ?? {}).map(([id, e]) => [id, hpRow(e)]))]));
  const hits = Object.fromEntries(Object.entries(walk.steps).filter(([, s]) => s?.hitsEntered && !usedStatus(c, s)).map(([slot, s]) => [slot, Object.entries(s!.hitsEntered!).flatMap(([target, byId]) =>
    Object.entries(byId ?? {}).filter(([, h]) => h.reached > 0).map(([id, h]) => ({
      slot: target, id, reached: num(h.reached), koChance: num(h.ko),
      ...(h.landed > 0 && h.dmgMax !== null && h.dmgMax > 0 && !h.sub ? ((h.truncated ?? 0) > 0 ? { kind: "calculated" } : { min: h.dmgMin, max: h.dmgMax }) : h.landed === 0 ? { kind: "blocked" } : {}),
    })))]));
  // The default replacement's facts: each slot whose player's switch-out happened without Case.replacement.
  const chosen = new Set<string>();
  for (const table of [walk.replaced, walk.afterTurn?.replaced]) {
    for (const [slot, x] of Object.entries(table ?? {})) if (x!.entered.some((e) => (e.chosen ?? 0) > 1e-12) && !c.replacement?.[slot as SlotId]) chosen.add(slot);
  }
  const after = !c.endNotEstimated && r.afterTurn;
  const e2 = (after ? walk.afterTurn?.entered : walk.entered) ?? {};
  const newcomers = Object.fromEntries(Object.entries(e2).map(([slot, byId]) => [slot, Object.fromEntries(Object.entries(byId ?? {}).map(([id, e]) => [id, {
    chance: num(e.chance), hp: e.dist.map(([h, p]) => [h, num(p * e.chance)]), item: mix(e.item),
    ...(e.koChance === 0 ? { status: mix(e.status), stages: mix(e.boosts), volatiles: mix(Object.fromEntries(Object.entries(e.volatiles ?? {}).filter(([v]) => NEWCOMER_VOLATILES.includes(v)))) } : {}),
  }]))]));
  return {
    replaced: rep(r.expectedReplaced), hpEntered: ent(r.expectedEntered),
    ...(after ? { endReplaced: rep(r.afterTurnReplaced), endHpEntered: ent(r.afterTurnEntered) } : {}),
    hits, defaultFacts: chosen.size, ...(c.outcomes ? { newcomers } : {}),
  };
}
const NEWCOMER_VOLATILES = ["confusion", "taunt", "encore", "yawn", "leechseed", "perishsong", "substitute", "curse", "saltcure", "aquaring", "ingrain", "partiallytrapped", "focusenergy", "magnetrise"];
const rows: Row[] = [];
let skipped = 0;"""),
# header types
("""/** hazards (status2 Step 1 #7): on the side before the turn (the oracle's; the app reports E2 sides.hazardsFrom). */
type Side = { tailwind?: boolean; reflect?: boolean; lightScreen?: boolean; auroraVeil?: boolean; hazards?: string[]; safeguard?: boolean; mist?: boolean; luckyChant?: boolean; gmaxResidual?: SideConditions["gmaxResidual"] };""",
"""/**
 * hazards (status2 Step 1 #7): on the side before the turn; status2 wave 2: also the input's (DoublesTurnInput.hazards, with
 * Spikes and Toxic Spikes layers). The app reports E2 sides.hazardsFrom.
 */
type Side = { tailwind?: boolean; reflect?: boolean; lightScreen?: boolean; auroraVeil?: boolean; hazards?: string[]; layers?: { spikes?: 1 | 2 | 3; toxicSpikes?: 1 | 2 }; safeguard?: boolean; mist?: boolean; luckyChant?: boolean; gmaxResidual?: SideConditions["gmaxResidual"] };"""),
("""type Residual = { slot: DoublesSlotId; chance: number; min: number; max: number; koChance: number };""",
"""type Residual = { slot: DoublesSlotId; id?: string; chance: number; min: number; max: number; koChance: number };
/** status2 wave 2: a bench member (DoublesBenchPokemon), its replacement table, and a bench case's expectations (verify/compare.ts compareBench). */
type Member = Omit<Mon, "move"> & { id: string };
type Bench = Partial<Record<"own" | "opponent", { status?: string; ability?: string; members?: Member[] }>>;
type HPRow = Range & { start: number; maximum: number };
type Replaced = Partial<Record<DoublesSlotId, { left: (HPRow & { id: string; chance: number })[]; entered: { id: string; chance: number }[] }>>;
type Entered = Partial<Record<DoublesSlotId, Record<string, HPRow>>>;
type EnteredHit = { slot: DoublesSlotId; id: string; reached: number; koChance: number; min?: number; max?: number; kind?: "blocked" | "calculated" };
type Newcomer = { chance: number; hp: [number, number][]; item: Record<string, number>; status?: Record<string, number>; stages?: Record<string, number>; volatiles?: Record<string, number> };
type BenchRow = {
  replaced: Replaced; hpEntered: Entered; endReplaced?: Replaced; endHpEntered?: Entered; hits: Partial<Record<DoublesSlotId, EnteredHit[]>>; defaultFacts: number;
  newcomers?: Partial<Record<DoublesSlotId, Record<string, Newcomer>>>;
};"""),
("""  copies?: { slot: DoublesSlotId; copied: "Dancer" | "Instruct"; moveId: string; picked: number; moves: number; source: number }[];
};

const GAMES""",
"""  copies?: { slot: DoublesSlotId; copied: "Dancer" | "Instruct"; moveId: string; picked: number; moves: number; source: number }[];
  bench?: Bench; replacement?: Partial<Record<DoublesSlotId, string>>; r?: BenchRow;
};

const GAMES"""),
# landing from a bench member
("""function landing(fm: NonNullable<Carried["futureMove"]>, runtime: BattleRuntime): DoublesCarried["futureMove"] {
  if (typeof fm === "string") return id(fm);
  if ("source" in fm) return { move: fm.move, source: fm.source };""",
"""function landing(fm: NonNullable<Carried["futureMove"]>, runtime: BattleRuntime, c?: Case): DoublesCarried["futureMove"] {
  if (typeof fm === "string") return id(fm);
  if ("source" in fm) return { move: fm.move, source: fm.source };
  // status2 wave 2: its user is a bench member (its build as it is on the bench).
  if ("benchId" in fm) {
    const member = c?.bench?.[fm.benchSide]?.members?.find((x) => x.id === fm.benchId);
    if (!member) throw new Error(\\`no bench member \\${fm.benchId}\\`);
    return { move: fm.move, build: build({ ...member, move: null }, runtime) };
  }"""),
("""  futureMove?: string | { move: "futuresight" | "doomdesire"; source: DoublesSlotId } | { move: "futuresight" | "doomdesire"; bench: Omit<Mon, "move">; benchSide: "own" | "opponent"; fainted?: true; terastallized?: string };""",
"""  futureMove?: string | { move: "futuresight" | "doomdesire"; source: DoublesSlotId } | { move: "futuresight" | "doomdesire"; bench: Omit<Mon, "move">; benchSide: "own" | "opponent"; fainted?: true; terastallized?: string }
    | { move: "futuresight" | "doomdesire"; benchId: string; benchSide: "own" | "opponent" };"""),
("""function carried(m: Mon, runtime: BattleRuntime): DoublesCarried | undefined {
  const { trap, futureMove, charging, encore, disable, cudChew, ppLeft, ...rest } = m.carried ?? {};
  const out: DoublesCarried = {
    ...rest, ...(trap ? { trap: { source: trap.source, bindingBand: trap.bindingBand, move: id(trap.move ?? "Fire Spin") } } : {}), ...(futureMove ? { futureMove: landing(futureMove, runtime) } : {}),""",
"""function carried(m: Mon, runtime: BattleRuntime, c?: Case): DoublesCarried | undefined {
  const { trap, futureMove, charging, encore, disable, cudChew, ppLeft, ...rest } = m.carried ?? {};
  const out: DoublesCarried = {
    ...rest, ...(trap ? { trap: { source: trap.source, bindingBand: trap.bindingBand, move: id(trap.move ?? "Fire Spin") } } : {}), ...(futureMove ? { futureMove: landing(futureMove, runtime, c) } : {}),"""),
("""    const state = carried(m, runtime);
    const entry: DoublesPokemonInput = {""",
"""    const state = carried(m, runtime, c);
    const entry: DoublesPokemonInput = {"""),
# input: bench, replacement, hazards
("""    ...(c.faintedLastTurn ? { faintedLastTurn: { ...c.faintedLastTurn } } : {}), ...(c.echoedVoice !== undefined ? { echoedVoice: c.echoedVoice } : {}),
  };
  // A move the app takes no chosen target for""",
"""    ...(c.faintedLastTurn ? { faintedLastTurn: { ...c.faintedLastTurn } } : {}), ...(c.echoedVoice !== undefined ? { echoedVoice: c.echoedVoice } : {}),
    // status2 wave 2: the bench (a side with members), the replacement and the hazards (verify/app-turn.ts caseBenchInput).
    ...benchInput(c, runtime),
  };
  // A move the app takes no chosen target for"""),
("""const chanceOf = (facts: DoublesFact[], test: (text: string) => boolean) => facts.filter((f) => test(f.text)).reduce((s, f) => s + f.chance, 0);
""",
"""const chanceOf = (facts: DoublesFact[], test: (text: string) => boolean) => facts.filter((f) => test(f.text)).reduce((s, f) => s + f.chance, 0);
const HAZARD_KEYS: Record<string, keyof DoublesHazards> = { stealthrock: "stealthRock", spikes: "spikes", toxicspikes: "toxicSpikes", stickyweb: "stickyWeb", gmaxsteelsurge: "steelsurge" };
/** status2 wave 2 (verify/app-turn.ts caseBenchInput): the bench members, the replacement and the hazards with their layers. */
function benchInput(c: Case, runtime: BattleRuntime): Pick<DoublesTurnInput, "bench" | "replacement" | "hazards"> {
  const bench: Partial<Record<"own" | "opponent", DoublesBenchPokemon[]>> = {};
  for (const sideId of ["own", "opponent"] as const) {
    const members = c.bench?.[sideId]?.members;
    if (!members) continue;
    bench[sideId] = members.map((m) => {
      const state = carried({ ...m, move: null }, runtime);
      const kept = { ...(state?.sleep ? { sleep: state.sleep } : {}), ...(state?.freeze ? { freeze: state.freeze } : {}), ...(state?.onceUsed ? { onceUsed: state.onceUsed } : {}) };
      return { id: m.id, build: build({ ...m, move: null }, runtime), ...(Object.keys(kept).length ? { carried: kept } : {}), ...(m.moves?.length ? { moves: [...new Set(m.moves.map(id))] } : {}) };
    });
  }
  const hazards: Partial<Record<"own" | "opponent", DoublesHazards>> = {};
  for (const sideId of ["own", "opponent"] as const) {
    const s = c.field?.[sideId];
    const out: DoublesHazards = {};
    for (const h of s?.hazards ?? []) {
      const key = HAZARD_KEYS[h];
      if (key === "spikes") out.spikes = s?.layers?.spikes ?? 1;
      else if (key === "toxicSpikes") out.toxicSpikes = s?.layers?.toxicSpikes ?? 1;
      else if (key) out[key] = true;
    }
    if (Object.keys(out).length) hazards[sideId] = out;
  }
  return {
    ...(Object.keys(bench).length ? { bench } : {}), ...(c.replacement && Object.keys(c.replacement).length ? { replacement: { ...c.replacement } } : {}),
    ...(Object.keys(hazards).length ? { hazards } : {}),
  };
}
/**
 * status2 wave 2 (verify/compare.ts compareBench, compareEnteredHits, compareOutcomeNewcomers): a bench case's switch-outs and
 * newcomers (DoublesTurnResult.replaced, hpEntered, the end of turn's), the hits on a newcomer (DoublesHit.id), the default
 * replacement's facts, and E2's newcomers (mons[slot].id, benched).
 */
function checkBench(c: Case, result: Extract<DoublesTurnResult, { status: "ready" }>, close: (got: number, want: number, label: string) => void) {
  const r = c.r!;
  const hp = (got: DoublesHP | undefined, want: HPRow, label: string) => {
    expect(got, label).toBeDefined();
    expect({ start: got!.start, maximum: got!.maximum, low: got!.low, high: got!.high }, label).toEqual({ start: want.start, maximum: want.maximum, low: want.low, high: want.high });
    if (c.exact) expect({ min: got!.min, max: got!.max }, label).toEqual({ min: want.min, max: want.max });
    expect(got!.average, \\`\\${label} average\\`).toBeCloseTo(want.average, c.exact ? 9 : 0);
    close(got!.koChance, want.koChance, \\`\\${label} KO chance\\`);
  };
  const replaced = (got: Partial<Record<DoublesSlotId, DoublesReplaced>> | undefined, want: Replaced, label: string) => {
    expect(Object.keys(got ?? {}).sort(), \\`\\${c.id} \\${label} slots\\`).toEqual(Object.keys(want).sort());
    for (const [slot, w] of Object.entries(want) as [DoublesSlotId, NonNullable<Replaced[DoublesSlotId]>][]) {
      const g = got![slot]!;
      expect(g.left.map((l) => l.id).sort(), \\`\\${c.id} \\${label} \\${slot} left\\`).toEqual(w.left.map((l) => l.id).sort());
      for (const l of w.left) {
        const a = g.left.find((x) => x.id === l.id)!;
        close(a.chance, l.chance, \\`\\${c.id} \\${label} \\${slot} left \\${l.id} chance\\`);
        hp(a.hp, l, \\`\\${c.id} \\${label} \\${slot} left \\${l.id}\\`);
      }
      expect(g.entered.map((e) => e.id).sort(), \\`\\${c.id} \\${label} \\${slot} entered\\`).toEqual(w.entered.map((e) => e.id).sort());
      for (const e of w.entered) close(g.entered.find((x) => x.id === e.id)!.chance, e.chance, \\`\\${c.id} \\${label} \\${slot} entered \\${e.id}\\`);
    }
  };
  const entered = (got: Partial<Record<DoublesSlotId, Record<string, DoublesHP>>> | undefined, want: Entered, label: string) => {
    expect(Object.entries(got ?? {}).flatMap(([slot, byId]) => Object.keys(byId ?? {}).map((id) => \\`\\${slot}|\\${id}\\`)).sort(), \\`\\${c.id} \\${label}\\`)
      .toEqual(Object.entries(want).flatMap(([slot, byId]) => Object.keys(byId ?? {}).map((id) => \\`\\${slot}|\\${id}\\`)).sort());
    for (const [slot, byId] of Object.entries(want) as [DoublesSlotId, Record<string, HPRow>][]) for (const [id, w] of Object.entries(byId)) hp(got![slot]![id], w, \\`\\${c.id} \\${label} \\${slot}|\\${id}\\`);
  };
  replaced(result.replaced, r.replaced, "replaced");
  entered(result.hpEntered, r.hpEntered, "hpEntered");
  if (r.endReplaced && result.endOfTurn.status === "ready") {
    replaced(result.endOfTurn.replaced, r.endReplaced, "endOfTurn.replaced");
    entered(result.endOfTurn.hpEntered, r.endHpEntered ?? {}, "endOfTurn.hpEntered");
  }
  for (const [slot, hits] of Object.entries(r.hits) as [DoublesSlotId, EnteredHit[]][]) {
    const step = result.steps.find((s) => s.slot === slot && !s.copied)!;
    for (const hit of hits) {
      const got = step.hits.find((h) => h.slot === hit.slot && h.id === hit.id);
      const label = \\`\\${c.id} \\${slot} → \\${hit.slot}|\\${hit.id}\\`;
      expect(got, label).toBeDefined();
      close(got!.reached, hit.reached, \\`\\${label} reached\\`);
      close(got!.koChance, hit.koChance, \\`\\${label} KO chance\\`);
      if (hit.kind) expect(got!.kind === hit.kind || (hit.kind === "blocked" && got!.kind === "no-damage"), \\`\\${label} \\${got!.kind}\\`).toBe(true);
      if (hit.min !== undefined) expect({ kind: got!.kind, min: got!.min, max: got!.max }, label).toEqual({ kind: "calculated", min: hit.min, max: hit.max });
    }
  }
  expect(result.facts.filter((f) => /^Assumes .+ comes in for .+\\\\.$/.test(f)).length, \\`\\${c.id} the default replacement's facts\\`).toBe(r.defaultFacts);
}
/** status2 wave 2: the outcomes with each slot's entry its starting Pokémon (the leaver of DoublesOutcome.benched where it left). */
function identity(outcomes: DoublesOutcome[]): DoublesOutcome[] {
  return outcomes.map((o) => ({
    ...o, mons: Object.fromEntries(SLOTS.flatMap((slot) => {
      const m = o.mons[slot];
      if (!m?.id) return m ? [[slot, m]] : [];
      const left = o.benched?.[slot.startsWith("own") ? "own" : "opponent"]?.find((b) => b.id === \\`slot:\\${slot}\\`);
      return left ? [[slot, left]] : [];
    })),
  }));
}
/** status2 wave 2: each newcomer's E2 state (its occupant entry with its id, or benched again). */
function checkNewcomers(c: Case, outcomes: DoublesOutcome[], close: (got: number, want: number, label: string) => void) {
  for (const [slot, byId] of Object.entries(c.r?.newcomers ?? {}) as [DoublesSlotId, Record<string, Newcomer>][]) {
    for (const [who, want] of Object.entries(byId)) {
      const monOf = (o: DoublesOutcome): DoublesOutcomeMon | undefined => o.mons[slot]?.id === who ? o.mons[slot] : o.benched?.[slot.startsWith("own") ? "own" : "opponent"]?.find((b) => b.id === who && b.slot === slot);
      const mass = (f: (m: DoublesOutcomeMon) => number) => outcomes.reduce((s, o) => { const m = monOf(o); return s + (m ? o.chance * f(m) : 0); }, 0);
      const label = \\`\\${c.id} E2 \\${slot}|\\${who}\\`;
      close(mass(() => 1), want.chance, \\`\\${label} came in\\`);
      for (const [h, p] of want.hp) close(mass((m) => m.hp.find((x) => x.hp === h)?.chance ?? 0), p, \\`\\${label} hp \\${h}\\`);
      for (const [item, p] of Object.entries(want.item)) close(mass((m) => ((m.build.itemId ?? "") === item ? 1 : 0)), p, \\`\\${label} item \\${item || "(none)"}\\`);
      for (const [status, p] of Object.entries(want.status ?? {})) close(mass((m) => ((m.build.status ?? "") === status ? 1 : 0)), p, \\`\\${label} status \\${status || "(none)"}\\`);
      for (const [key, p] of Object.entries(want.stages ?? {})) {
        const [stat, n] = key.split(":");
        close(mass((m) => ((stat === "accuracy" || stat === "evasion" ? m.stages?.[stat] : (m.build.boosts as Record<string, number | undefined>)[stat]) === Number(n) ? 1 : 0)), p, \\`\\${label} stage \\${key}\\`);
      }
      for (const [v, p] of Object.entries(want.volatiles ?? {})) close(mass((m) => (m.volatiles?.includes(v) ? 1 : 0)), p, \\`\\${label} volatile \\${v}\\`);
    }
  }
}
"""),
# header imports
("""import type { DoublesCarried, DoublesFact, DoublesOutcome, DoublesOutcomeMon, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";""",
"""import type { DoublesBenchPokemon, DoublesCarried, DoublesFact, DoublesHazards, DoublesHP, DoublesOutcome, DoublesOutcomeMon, DoublesPokemonInput, DoublesReplaced, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";"""),
# body: the residual id, the bench checks, E2 identity and newcomers
("""            const got = end.residuals.find((a) => a.slot === r.slot && a.min === r.min && a.max === r.max && Math.abs(a.chance - r.chance) <= (c.exact ? 1e-9 : 0.015));""",
"""            const got = end.residuals.find((a) => a.slot === r.slot && (a.id ?? null) === (r.id ?? null) && a.min === r.min && a.max === r.max && Math.abs(a.chance - r.chance) <= (c.exact ? 1e-9 : 0.015));"""),
("""      for (const sideId of ["own", "opponent"] as const) close(result.swapped?.[sideId] ?? 0, c.swapped?.[sideId] ?? 0, \\`\\${c.id} swapped \\${sideId}\\`);""",
"""      for (const sideId of ["own", "opponent"] as const) close(result.swapped?.[sideId] ?? 0, c.swapped?.[sideId] ?? 0, \\`\\${c.id} swapped \\${sideId}\\`);
      // status2 wave 2: a case with a bench.
      if (c.r) checkBench(c, result, close);"""),
("""        expect(out.endOfTurn === "applied", \\`\\${c.id} outcomes after the turn\\`).toBe(c.outcomes.applied);
        for (const [slot, want] of Object.entries(c.outcomes.mons) as [DoublesSlotId, OutcomeMon][]) {
          const mass = (f: (m: DoublesOutcomeMon) => number) => out.outcomes.reduce((s, o) => s + (o.mons[slot] ? o.chance * f(o.mons[slot]!) : 0), 0);""",
"""        expect(out.endOfTurn === "applied", \\`\\${c.id} outcomes after the turn\\`).toBe(c.outcomes.applied);
        // status2 wave 2: with a bench, each slot is its starting Pokémon (identity), the newcomers apart.
        const outcomes = c.r ? identity(out.outcomes) : out.outcomes;
        if (c.r) checkNewcomers(c, out.outcomes, close);
        for (const [slot, want] of Object.entries(c.outcomes.mons) as [DoublesSlotId, OutcomeMon][]) {
          const mass = (f: (m: DoublesOutcomeMon) => number) => outcomes.reduce((s, o) => s + (o.mons[slot] ? o.chance * f(o.mons[slot]!) : 0), 0);"""),
("""          if (want.s2) checkState2(c, slot, want.s2, out.outcomes, turnInput.runtime, close);
          const sideId = slot.startsWith("own") ? "own" : "opponent";
          close(out.outcomes.reduce((s, o) => s + (o.positions[sideId] === "swapped" && o.mons[slot] ? o.chance : 0), 0), want.swapped, \\`\\${c.id} \\${slot} swapped\\`);""",
"""          if (want.s2) checkState2(c, slot, want.s2, outcomes, turnInput.runtime, close);
          const sideId = slot.startsWith("own") ? "own" : "opponent";
          close(outcomes.reduce((s, o) => s + (o.positions[sideId] === "swapped" && o.mons[slot] ? o.chance : 0), 0), want.swapped, \\`\\${c.id} \\${slot} swapped\\`);"""),
])
