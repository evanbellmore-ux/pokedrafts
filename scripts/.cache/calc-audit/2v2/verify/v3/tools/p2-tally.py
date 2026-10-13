import sys; sys.path.insert(0, 'v3/tools')
from patchlib import patch
P = 'sim-dfs.ts'
patch(P, [
("""    for (const p of parsed) {
      if (!p.slot || p.delta === undefined) continue;
      if (p.from && /^(item|ability): |^confusion$/.test(p.from)) continue;
      if (p.key.startsWith("damage:confusion")) continue;
      cur.moveChange.set(p.slot, (cur.moveChange.get(p.slot) ?? 0) + p.delta);
    }""",
"""    for (const p of parsed) {
      // status2 wave 2: a newcomer's HP lines are not a status move's change on the slot's Pokémon.
      if (!p.slot || p.delta === undefined || p.slot.includes("|")) continue;
      if (p.from && /^(item|ability): |^confusion$/.test(p.from)) continue;
      if (p.key.startsWith("damage:confusion")) continue;
      cur.moveChange.set(p.slot as SlotId, (cur.moveChange.get(p.slot as SlotId) ?? 0) + p.delta);
    }"""),
("""    const subAfter = cur.frozen?.sub ?? subNow(this.b);
    for (const s of SLOTS) {
      const before = cur.subBefore[s];""",
"""    const subAfter = cur.frozen?.sub ?? subNow(this.b);
    for (const s of Object.keys(cur.subBefore)) {
      const before = cur.subBefore[s];"""),
("""  sub: Map<SlotId, { taken: number; broke: boolean }>;""",
"""  sub: Map<string, { taken: number; broke: boolean }>;"""),
("""function subNow(b: any): Record<SlotId, number | null> {
  return Object.fromEntries(SLOTS.map((slot) => [slot, monOf(b, slot)?.volatiles?.substitute ? monOf(b, slot).volatiles.substitute.hp : null])) as Record<SlotId, number | null>;
}""",
"""function subNow(b: any): Record<string, number | null> {
  const out: Record<string, number | null> = Object.fromEntries(SLOTS.map((slot) => [slot, monOf(b, slot)?.volatiles?.substitute ? monOf(b, slot).volatiles.substitute.hp : null]));
  // status2 wave 2: a newcomer's Substitute (Shed Tail passes one), by its key.
  for (const p of newcomers(b)) out[keyOf(p)!] = p.isActive && p.volatiles?.substitute ? p.volatiles.substitute.hp : null;
  return out;
}"""),
("""  current: (ActionRec & { hpBefore: Record<string, number>; logStart: number; ident: string; posBefore: PosMap; subBefore: Record<SlotId, number | null>;
    /** status2 wave 1b: where a Dancer's first copy began (the action's own record ends there). */
    frozen?: { log: number; hp: Record<string, number>; sub: Record<SlotId, number | null> } }) | null = null;""",
"""  current: (ActionRec & { hpBefore: Record<string, number>; logStart: number; ident: string; posBefore: PosMap; subBefore: Record<string, number | null>;
    /** status2 wave 1b: where a Dancer's first copy began (the action's own record ends there). */
    frozen?: { log: number; hp: Record<string, number>; sub: Record<string, number | null> } }) | null = null;"""),
("""      if (r.effective && toID(r.effective) !== s.moveId) s.lines[`|effective|${r.effective}`] = (s.lines[`|effective|${r.effective}`] ?? 0) + w;
      for (const t of new Set([...r.reached, ...r.dmg.keys()])) {
        const h: HitResult = s.hits[t] ??= { reached: 0, landed: 0, ko: 0, dmgMin: null, dmgMax: null, truncated: 0 };""",
"""      if (r.effective && toID(r.effective) !== s.moveId) s.lines[`|effective|${r.effective}`] = (s.lines[`|effective|${r.effective}`] ?? 0) + w;
      // status2 wave 2: a hit on a newcomer ("<slot>|<id>") goes to hitsEntered[slot][id]; a slot's starting Pokémon's to hits.
      const step = s;
      const hitOf = (t: string): HitResult => {
        const [slot, id] = splitKey(t);
        const table = (id === null ? step.hits : ((step.hitsEntered ??= {})[slot] ??= {})) as Record<string, HitResult>;
        return table[id ?? slot] ??= { reached: 0, landed: 0, ko: 0, dmgMin: null, dmgMax: null, truncated: 0 };
      };
      for (const t of new Set([...r.reached, ...r.dmg.keys()])) {
        const h: HitResult = hitOf(t);"""),
("""      // status-eot.
      for (const [t, keys] of r.effects) {
        const into = s.effects![t] ??= {};
        for (const k of keys) into[k] = (into[k] ?? 0) + w;
      }""",
"""      // status-eot.
      for (const [t, keys] of r.effects) {
        const [slot, id] = splitKey(t);
        const into = id === null ? s.effects![slot] ??= {} : ((s.effectsEntered ??= {})[slot] ??= {})[id] ??= {};
        for (const k of keys) into[k] = (into[k] ?? 0) + w;
      }"""),
("""      for (const [t, sub] of r.sub) {
        const h: HitResult = s.hits[t] ??= { reached: 0, landed: 0, ko: 0, dmgMin: null, dmgMax: null, truncated: 0 };""",
"""      for (const [t, sub] of r.sub) {
        const h: HitResult = hitOf(t);"""),
])
