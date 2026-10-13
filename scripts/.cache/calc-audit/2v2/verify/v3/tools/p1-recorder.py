import sys; sys.path.insert(0, 'v3/tools')
from patchlib import patch
P = 'sim-dfs.ts'
patch(P, [
# posMapOf: identity keys (a newcomer: "<slot>|<id>")
("""/** p1a/p1b/p2a/p2b → the slot of the Pokémon standing there (identity), from the battle. */
type PosMap = Record<string, SlotId | null>;
function posMapOf(b: any): PosMap {
  const out: PosMap = {};
  for (const [i, side] of b.sides.entries()) {
    for (const [pos, p] of side.active.entries()) out[`p${i + 1}${pos ? "b" : "a"}`] = p ? slotOf(p) : null;
  }
  return out;
}""",
"""/**
 * p1a/p1b/p2a/p2b → the slot of the Pokémon standing there (identity), from the battle. status2 wave 2: a newcomer's key
 * "<slot>|<bench id>" (keyOf; only in a case with a bench).
 */
type PosMap = Record<string, string | null>;
function posMapOf(b: any): PosMap {
  const out: PosMap = {};
  for (const [i, side] of b.sides.entries()) {
    for (const [pos, p] of side.active.entries()) out[`p${i + 1}${pos ? "b" : "a"}`] = p ? keyOf(p) : null;
  }
  return out;
}"""),
("""type ParsedLine = {
  /** The Pokémon the line is about (by identity), null for a side or field line. */
  slot: SlotId | null;""",
"""type ParsedLine = {
  /** The Pokémon the line is about (by identity: a slot, or a newcomer's "<slot>|<id>"), null for a side or field line. */
  slot: string | null;"""),
("""  from: string | null; of: SlotId | null;
};""",
"""  from: string | null; of: string | null;
};"""),
("""function parseLines(lines: string[], pos: PosMap, hp: Record<SlotId, number>): (ParsedLine & { index: number })[] {
  const out: (ParsedLine & { index: number })[] = [];
  const identSlot = (text: string | undefined): SlotId | null => {""",
"""function parseLines(lines: string[], pos: PosMap, hp: Record<string, number>): (ParsedLine & { index: number })[] {
  const out: (ParsedLine & { index: number })[] = [];
  const identSlot = (text: string | undefined): string | null => {"""),
# ActionRec keys
("""  reached: Set<SlotId>; landed: Set<SlotId>; dmg: Map<SlotId, number>; kos: SlotId[]; lines: string[]; effective: string | null;
  /** Targets whose knockout stopped a multi-hit move before its planned last hit (sim/battle-actions.ts:890-895 move.lastHit). */
  truncated: Set<SlotId>;
  /** status-eot: the lines on each Pokémon as keys, its HP change, the side lines, its Substitute's loss. */
  effects: Map<SlotId, Set<string>>; change: Map<SlotId, number>; sides: Map<SideKey | "field", Set<string>>;""",
"""  // status2 wave 2: reached, landed, dmg, kos, truncated and effects are keyed by identity (keyOf: a slot, or a newcomer's "<slot>|<id>").
  reached: Set<string>; landed: Set<string>; dmg: Map<string, number>; kos: string[]; lines: string[]; effective: string | null;
  /** Targets whose knockout stopped a multi-hit move before its planned last hit (sim/battle-actions.ts:890-895 move.lastHit). */
  truncated: Set<string>;
  /** status-eot: the lines on each Pokémon as keys, its HP change, the side lines, its Substitute's loss. */
  effects: Map<string, Set<string>>; change: Map<SlotId, number>; sides: Map<SideKey | "field", Set<string>>;"""),
("""type Ctx = { c: Case; pass: Set<SlotId>; absent: Set<SlotId>; totalMoves: number; critical: boolean; switching: Set<SlotId>; commanding?: Set<SlotId> };""",
"""type Ctx = { c: Case; pass: Set<SlotId>; absent: Set<SlotId>; totalMoves: number; critical: boolean; switching: Set<SlotId>; commanding?: Set<SlotId>;
  /** status2 wave 2: the case has a bench (hasBench): switch requests answered, identity tracked. */
  bench: boolean };"""),
("""function maxNow(b: any): Record<SlotId, number> {""",
"""/** status2 wave 2: hpNow plus each newcomer by its key (keyOf), in a case with a bench; otherwise hpNow. */
function hpAll(b: any): Record<string, number> {
  const out: Record<string, number> = hpNow(b);
  for (const p of newcomers(b)) out[keyOf(p)!] = hpOf(p);
  return out;
}
/** status2 wave 2: every bench Pokémon that came in this turn (active now or gone again), both sides, in team order. */
function newcomers(b: any): any[] {
  return b.sides.flatMap((side: any) => side.pokemon.filter((p: any) => p.m?.benchId && p.m.enteredFor));
}
function maxNow(b: any): Record<SlotId, number> {"""),
# Recorder
("""  current: (ActionRec & { hpBefore: Record<SlotId, number>; logStart: number; ident: string; posBefore: PosMap; subBefore: Record<SlotId, number | null>;
    /** status2 wave 1b: where a Dancer's first copy began (the action's own record ends there). */
    frozen?: { log: number; hp: Record<SlotId, number>; sub: Record<SlotId, number | null> } }) | null = null;""",
"""  current: (ActionRec & { hpBefore: Record<string, number>; logStart: number; ident: string; posBefore: PosMap; subBefore: Record<SlotId, number | null>;
    /** status2 wave 1b: where a Dancer's first copy began (the action's own record ends there). */
    frozen?: { log: number; hp: Record<string, number>; sub: Record<SlotId, number | null> } }) | null = null;"""),
("""      for (const t of targets) { const s = slotOf(t); if (s && rec.current) rec.current.reached.add(s); }""",
"""      for (const t of targets) { const s = keyOf(t); if (s && rec.current) rec.current.reached.add(s); }"""),
("""      for (const t of targets) { const s = slotOf(t); if (s && rec.current) rec.current.landed.add(s); }
      const out = loop.call(this, targets, pokemon, move);
      if (rec.current && move.multihit && !move.lastHit) for (const t of targets) { const s = slotOf(t); if (s && !t.hp) rec.current.truncated.add(s); }""",
"""      for (const t of targets) { const s = keyOf(t); if (s && rec.current) rec.current.landed.add(s); }
      const out = loop.call(this, targets, pokemon, move);
      if (rec.current && move.multihit && !move.lastHit) for (const t of targets) { const s = keyOf(t); if (s && !t.hp) rec.current.truncated.add(s); }"""),
("""      const out = gd.call(this, s, t, m, sup);
      const slot = slotOf(t);""",
"""      const out = gd.call(this, s, t, m, sup);
      const slot = keyOf(t);"""),
("""      if (!outer.frozen) outer.frozen = { log: rec.b.log.length, hp: hpNow(rec.b), sub: subNow(rec.b) };""",
"""      if (!outer.frozen) outer.frozen = { log: rec.b.log.length, hp: hpAll(rec.b), sub: subNow(rec.b) };"""),
("""      reached: new Set<SlotId>(), landed: new Set<SlotId>(), dmg: new Map<SlotId, number>(), kos: [] as SlotId[], lines: [] as string[], effective: null, truncated: new Set<SlotId>(),
      effects: new Map(), change: new Map(), sides: new Map(), sub: new Map(), moveChange: new Map(), selfHit: null,
      hpBefore: hpNow(this.b), logStart: this.b.log.length,""",
"""      reached: new Set<string>(), landed: new Set<string>(), dmg: new Map<string, number>(), kos: [] as string[], lines: [] as string[], effective: null, truncated: new Set<string>(),
      effects: new Map(), change: new Map(), sides: new Map(), sub: new Map(), moveChange: new Map(), selfHit: null,
      hpBefore: hpAll(this.b), logStart: this.b.log.length,"""),
("""    const nonPass = SLOTS.filter((s) => !this.ctx.pass.has(s) && !this.ctx.absent.has(s) && !this.ctx.switching.has(s) && !this.ctx.commanding?.has(s)).length;
    this.current = this.open(slot, pass ? "splash" : toID(this.ctx.c.slots[slot].action.move!), action.pokemon, undefined, nonPass - remaining, pass, !!action.pokemon.fainted || !action.pokemon.hp);""",
"""    const nonPass = SLOTS.filter((s) => !this.ctx.pass.has(s) && !this.ctx.absent.has(s) && !this.ctx.switching.has(s) && !this.ctx.commanding?.has(s)).length;
    // status2 wave 2: an action a switch-out cancelled was never picked (the app's order counts the actions it runs).
    const cancelled = this.ctx.bench ? SLOTS.filter((s) => !this.ctx.pass.has(s) && anchorOf(this.b, s)?.m?.cancelled).length : 0;
    this.current = this.open(slot, pass ? "splash" : toID(this.ctx.c.slots[slot].action.move!), action.pokemon, undefined, nonPass - remaining - cancelled, pass, !!action.pokemon.fainted || !action.pokemon.hp);"""),
("""    const after = cur.frozen?.hp ?? hpNow(this.b);""",
"""    const after = cur.frozen?.hp ?? hpAll(this.b);"""),
("""      const tag: HandlerTag = { name: h.effect?.name ?? h.effect?.id ?? "?", holder: slotOf(h.effectHolder) };""",
"""      const tag: HandlerTag = { name: h.effect?.name ?? h.effect?.id ?? "?", holder: keyOf(h.effectHolder) };"""),
("""type ResidualEntry = { slot: SlotId; effect: string; other: SlotId | null; amount: number | null; ko: boolean; facts: Set<string>; index: number; role: string };
type HandlerTag = { name: string; holder: SlotId | null } | null;""",
"""type ResidualEntry = { slot: string; effect: string; other: string | null; amount: number | null; ko: boolean; facts: Set<string>; index: number; role: string };
type HandlerTag = { name: string; holder: string | null } | null;"""),
("""function residualEntries(lines: string[], tags: HandlerTag[], logStart: number, pos: PosMap, hpStart: Record<SlotId, number>, hpEnd: Record<SlotId, number>): ResidualEntry[] {""",
"""function residualEntries(lines: string[], tags: HandlerTag[], logStart: number, pos: PosMap, hpStart: Record<string, number>, hpEnd: Record<string, number>): ResidualEntry[] {"""),
("""  let lastLeechSeeded: SlotId | null = null;
  /** A line with no [from] and no residual handler (a faint's side effects: Soul-Heart's boost) takes its Pokémon's last effect. */
  const lastName = new Map<SlotId, string>();""",
"""  let lastLeechSeeded: string | null = null;
  /** A line with no [from] and no residual handler (a faint's side effects: Soul-Heart's boost) takes its Pokémon's last effect. */
  const lastName = new Map<string, string>();"""),
("""    let other: SlotId | null = p.of ?? (tag?.holder && tag.holder !== p.slot ? tag.holder : null);""",
"""    let other: string | null = p.of ?? (tag?.holder && tag.holder !== p.slot ? tag.holder : null);"""),
])
