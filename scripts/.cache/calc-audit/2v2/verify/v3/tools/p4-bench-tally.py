import sys; sys.path.insert(0, 'v3/tools')
from patchlib import patch
P = 'sim-dfs.ts'
patch(P, [
# Tally: a BenchTally fed at the end of the moves
("""  /** status-eot: the state mixtures after the moves. */
  endState(out: SegmentEnd, w: number) {
    this.states.add(out.state, w, this.ctx.absent);""",
"""  /** status2 wave 2: the switch-outs and newcomers after the moves (a case with a bench). */
  bench = new BenchTally(this.ctx);
  /** status-eot: the state mixtures after the moves. */
  endState(out: SegmentEnd, w: number) {
    if (out.r) this.bench.add(out.r, w, false);
    this.states.add(out.state, w, this.ctx.absent);"""),
# AfterTally: the after-the-turn BenchTally and residual ids
("""  benchCured: Partial<Record<SideKey, number>> = {};
  runs = 0;
  noResidual = 0;
  kinds: Record<string, number> = {};
  constructor(readonly ctx: Ctx) {}
  add(out: SegmentEnd, w: number) {
    if (!out.after) {
      this.noResidual += w;
      return;
    }""",
"""  benchCured: Partial<Record<SideKey, number>> = {};
  runs = 0;
  noResidual = 0;
  kinds: Record<string, number> = {};
  /** status2 wave 2: the switch-outs after the residual and every newcomer after the turn (a case with a bench). */
  bench: BenchTally;
  constructor(readonly ctx: Ctx) { this.bench = new BenchTally(ctx); }
  add(out: SegmentEnd, w: number) {
    if (!out.after) {
      this.noResidual += w;
      return;
    }
    if (out.after.r) this.bench.add(out.after.r, w, true);"""),
("""    for (const e of out.after.residuals) {
      const id = `${e.slot}|${e.effect}|${e.other ?? ""}${e.role}`;
      let a = this.residuals.get(id);
      if (!a) this.residuals.set(id, a = { r: { slot: e.slot, effect: e.effect, ...(e.other ? { other: e.other } : {}), chance: 0, min: null, max: null, koChance: 0, facts: {}, index: 0 }, indexMass: 0 });""",
"""    for (const e of out.after.residuals) {
      const id = `${e.slot}|${e.effect}|${e.other ?? ""}${e.role}`;
      let a = this.residuals.get(id);
      // status2 wave 2: a residual on a newcomer ("<slot>|<id>") is the slot's with the newcomer's id (DoublesResidual.id).
      const [slot, who] = splitKey(e.slot);
      if (!a) this.residuals.set(id, a = { r: { slot, ...(who ? { id: who } : {}), effect: e.effect, ...(e.other ? { other: splitKey(e.other)[0] } : {}), chance: 0, min: null, max: null, koChance: 0, facts: {}, index: 0 }, indexMass: 0 });"""),
("""      pseudo: Object.fromEntries([...this.pseudo].sort()), sides: Object.fromEntries([...this.sides].sort()),
      ...(Object.keys(this.benchCured).length ? { benchCured: this.benchCured } : {}),
    };
  }
}""",
"""      pseudo: Object.fromEntries([...this.pseudo].sort()), sides: Object.fromEntries([...this.sides].sort()),
      ...(Object.keys(this.benchCured).length ? { benchCured: this.benchCured } : {}),
      ...(this.ctx.bench ? this.bench.result() : {}),
    };
  }
}

/**
 * status2 wave 2 (Track R-V): one walk's switch-outs and newcomers (a case with a bench): per slot, each leaver's HP as it left
 * and its mass, each newcomer's mass (ReplacedResult); per newcomer its state (EnteredResult: dist conditional on its having
 * come in, the state mixtures absolute). `afterOnly`: the after-the-turn table, whose switch-outs are those after the residual.
 */
class BenchTally {
  left = new Map<SlotId, Map<string, { hp: Map<number, number>; mass: number; order: number }>>();
  entered = new Map<SlotId, Map<string, number>>();
  newcomers = new Map<string, { dist: Map<number, number>; max: Map<number, number>; start: Map<number, number>; states: StateTally; mass: number }>();
  constructor(readonly ctx: Ctx) {}
  add(r: BenchRecord, w: number, afterOnly: boolean) {
    const bump = <K,>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + w);
    for (const slot of SLOTS) {
      const events = (r.replaced[slot] ?? []).filter((e) => !afterOnly || e.after);
      events.forEach((e, k) => {
        const byId = this.left.get(slot) ?? this.left.set(slot, new Map()).get(slot)!;
        const x = byId.get(e.left) ?? byId.set(e.left, { hp: new Map(), mass: 0, order: k }).get(e.left)!;
        bump(x.hp, e.hp);
        x.mass += w;
        x.order = Math.min(x.order, k);
        bump(this.entered.get(slot) ?? this.entered.set(slot, new Map()).get(slot)!, e.entered);
      });
    }
    for (const [key, s] of Object.entries(r.entered)) {
      const t = this.newcomers.get(key) ?? this.newcomers.set(key, { dist: new Map(), max: new Map(), start: new Map(), states: new StateTally(), mass: 0 }).get(key)!;
      bump(t.dist, s.hp);
      bump(t.max, s.max);
      bump(t.start, s.start);
      t.states.add(Object.fromEntries(SLOTS.map((x) => [x, s])) as Record<SlotId, MonState>, w, new Set());
      t.mass += w;
    }
  }
  result(): { replaced: Partial<Record<SlotId, ReplacedResult>>; entered: Partial<Record<SlotId, Record<string, EnteredResult>>> } {
    const replaced: Partial<Record<SlotId, ReplacedResult>> = {};
    for (const slot of SLOTS) {
      const byId = this.left.get(slot);
      if (!byId) continue;
      replaced[slot] = {
        left: [...byId].sort((a, b) => a[1].order - b[1].order).map(([id, x]) => ({ id, hp: conditional(x.hp, x.mass), chance: x.mass })),
        entered: [...(this.entered.get(slot) ?? new Map<string, number>())].map(([id, chance]) => ({ id, chance })),
      };
    }
    const entered: Partial<Record<SlotId, Record<string, EnteredResult>>> = {};
    const species = new Map(membersOf(this.ctx.c).map(({ m }) => [m.id, m.species]));
    for (const [key, t] of this.newcomers) {
      const [slot, id] = splitKey(key);
      const dist = conditional(t.dist, t.mass);
      const top = Math.max(...dist.map(([, p]) => p));
      const modes = dist.filter(([, p]) => Math.abs(p - top) <= 1e-12).map(([hp]) => hp);
      const mode = (m: Map<number, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? NaN;
      (entered[slot] ??= {})[id!] = {
        id: id!, chance: t.mass, species: species.get(id!) ?? "?", start: mode(t.start), maximum: mode(t.max),
        dist, koChance: dist.find(([hp]) => hp === 0)?.[1] ?? 0, average: dist.reduce((sum, [hp, p]) => sum + hp * p, 0),
        min: dist[0][0], max: dist[dist.length - 1][0], modeTieUp: Math.max(...modes), modeTieDown: Math.min(...modes),
        ...t.states.fields("own-left"),
      };
    }
    return { replaced, entered };
  }
}
/** [hp, mass] as [hp, probability] given the event (mass `total`), ascending by HP. */
function conditional(m: Map<number, number>, total: number): [number, number][] {
  return [...m].sort((a, b) => a[0] - b[0]).map(([hp, p]) => [hp, total > 0 ? p / total : 0]);
}"""),
("""  return { c, pass, absent, totalMoves: SLOTS.length - absent.size - switching.size - commanding.size, critical: !!c.field?.critical, switching, commanding };
}""",
"""  return { c, pass, absent, totalMoves: SLOTS.length - absent.size - switching.size - commanding.size, critical: !!c.field?.critical, switching, commanding, bench: hasBench(c) };
}"""),
("""function extraFields(tally: Tally, after: AfterTally, t0: number, residualClasses: number): Pick<WalkResult, "swapped" | "afterTurn" | "noMove"> & { sideConditions: Record<SideKey, Record<string, number>> } {
  const swapped: Partial<Record<SideKey, number>> = {};
  for (const side of ["own", "opponent"] as const) if (tally.states.sideSwapped[side] > 0) swapped[side] = tally.states.sideSwapped[side];
  return {
    ...(Object.keys(swapped).length ? { swapped } : {}),
    sideConditions: { own: Object.fromEntries([...tally.sideConditions.own].sort()), opponent: Object.fromEntries([...tally.sideConditions.opponent].sort()) },
    ...(Object.keys(tally.noMove).length ? { noMove: tally.noMove } : {}),
    afterTurn: after.result(t0, residualClasses),
  };
}""",
"""function extraFields(tally: Tally, after: AfterTally, t0: number, residualClasses: number): Pick<WalkResult, "swapped" | "afterTurn" | "noMove" | "replaced" | "entered"> & { sideConditions: Record<SideKey, Record<string, number>> } {
  const swapped: Partial<Record<SideKey, number>> = {};
  for (const side of ["own", "opponent"] as const) if (tally.states.sideSwapped[side] > 0) swapped[side] = tally.states.sideSwapped[side];
  return {
    ...(Object.keys(swapped).length ? { swapped } : {}),
    sideConditions: { own: Object.fromEntries([...tally.sideConditions.own].sort()), opponent: Object.fromEntries([...tally.sideConditions.opponent].sort()) },
    ...(Object.keys(tally.noMove).length ? { noMove: tally.noMove } : {}),
    afterTurn: after.result(t0, residualClasses),
    // status2 wave 2: a case with a bench.
    ...(tally.ctx.bench ? tally.bench.result() : {}),
  };
}"""),
])
