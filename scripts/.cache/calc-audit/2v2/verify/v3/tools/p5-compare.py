import sys; sys.path.insert(0, 'v3/tools')
from patchlib import patch
P = 'compare.ts'
patch(P, [
("""import type { DoublesFact, DoublesHit, DoublesHP, DoublesOutcomesResult, DoublesResidual, DoublesStep, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { SLOTS, toID, type Case, type Expected, type OracleResult, type ResidualResult, type SlotId, type SlotResult, type StepResult } from "./case-types";""",
"""import type { DoublesFact, DoublesHit, DoublesHP, DoublesOutcome, DoublesOutcomeMon, DoublesOutcomesResult, DoublesReplaced, DoublesResidual, DoublesStep, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { SLOTS, toID, type Case, type EnteredResult, type Expected, type OracleResult, type ResidualResult, type SlotId, type SlotResult, type StepResult } from "./case-types";"""),
# the slot-level hits: the starting Pokémon's only (status2 wave 2: a newcomer's hit has an id)
("""    const hits = new Map<SlotId, DoublesHit>(s.hits.map((h) => [h.slot as SlotId, h]));
    if (usedStatus) {
      compareStatusHits(slot, o, hits, near, push);
      continue;
    }""",
"""    const hits = new Map<SlotId, DoublesHit>(s.hits.filter((h) => !h.id).map((h) => [h.slot as SlotId, h]));
    // status2 wave 2: the hits on a newcomer (DoublesHit.id) against the oracle's hitsEntered.
    compareEnteredHits(slot, o, s, near, push, usedStatus, sampled);
    if (usedStatus) {
      compareStatusHits(slot, o, hits, near, push);
      continue;
    }"""),
("""function compareEffects(slot: SlotId, o: StepResult, s: DoublesStep, near: Near, push: Push, status: boolean, c?: Case) {
  const hits = new Map(s.hits.map((h) => [h.slot as SlotId, h]));""",
"""function compareEffects(slot: SlotId, o: StepResult, s: DoublesStep, near: Near, push: Push, status: boolean, c?: Case) {
  const hits = new Map(s.hits.filter((h) => !h.id).map((h) => [h.slot as SlotId, h]));"""),
("""  compareEndOfTurn(c, oracle, result, near, push, hpCheck);
  if (c.outcomes) compareOutcomes(c, oracle, outcomes, near, push);
  return out;
}""",
"""  compareEndOfTurn(c, oracle, result, near, push, hpCheck);
  // status2 wave 2: the switch-outs and newcomers (a case with a bench), and the default replacement's turn fact.
  compareBench(c, oracle, result, near, push, hpCheck);
  if (c.outcomes) compareOutcomes(c, oracle, outcomes, near, push);
  return out;
}

/** status2 wave 2: the case gives a bench (Case.bench.{side}.members). */
export const hasBench = (c: Case) => (["own", "opponent"] as const).some((side) => c.bench?.[side]?.members !== undefined);
/**
 * status2 wave 2 (Track R-V): DoublesHit with an id against the oracle's hitsEntered (StepResult.hitsEntered[slot][id]):
 * the reach, and for a damaging move the KO chance and the damage range (the kind as the slot-level hits have it).
 */
function compareEnteredHits(slot: SlotId, o: StepResult, s: DoublesStep, near: Near, push: Push, status: boolean, sampled: boolean) {
  const seen = new Set<DoublesHit>();
  for (const [target, byId] of Object.entries(o.hitsEntered ?? {}) as [SlotId, Record<string, NonNullable<StepResult["hits"][SlotId]>>][]) {
    for (const [id, oh] of Object.entries(byId)) {
      const where = `${slot}→${target}|${id}`;
      const ah = s.hits.find((h) => h.slot === target && h.id === id);
      if (ah) seen.add(ah);
      if (oh.reached === 0) { if (ah && ah.reached > 0) push(where, "hit.reached", 0, ah.reached); continue; }
      if (!ah) { if (!status) push(where, "hit", `reached ${oh.reached}`, "missing"); continue; }
      if (!near(ah.reached, oh.reached)) push(where, "hit.reached", oh.reached, ah.reached);
      if (status) continue;
      if (!near(ah.koChance, oh.ko)) push(where, "hit.koChance", oh.ko, ah.koChance);
      if (oh.landed === 0) { if (!["blocked", "no-damage"].includes(ah.kind)) push(where, "hit.kind", "blocked or no-damage", ah.kind); }
      else if (oh.dmgMax !== null && oh.dmgMax > 0 && !oh.sub) {
        if (ah.kind !== "calculated") push(where, "hit.kind", "calculated", ah.kind);
        if ((oh.truncated ?? 0) > 0) { if (ah.max === null || ah.max < oh.dmgMax) push(where, "hit.max", `≥ ${oh.dmgMax}`, ah.max); }
        else if (!sampled && (ah.min !== oh.dmgMin || ah.max !== oh.dmgMax)) push(where, "hit.min/max", [oh.dmgMin, oh.dmgMax], [ah.min, ah.max], "damage summed over the action's hits, uncapped");
      }
    }
  }
  for (const h of s.hits) if (h.id && !seen.has(h) && h.reached > 0) push(`${slot}→${h.slot}|${h.id}`, "hit.reached", 0, h.reached, "no such newcomer hit in Showdown");
}
type ReplacedExpected = NonNullable<OracleResult["expectedReplaced"]>;
type EnteredExpected = NonNullable<OracleResult["expectedEntered"]>;
/**
 * status2 wave 2 (Track R-V): DoublesTurnResult.replaced and hpEntered against the oracle after the moves; the end of turn's
 * (DoublesEndOfTurn.replaced: the switches after the residual; hpEntered: every newcomer after the turn) when ready; and the
 * default replacement's turn fact ("Assumes {Newcomer} comes in for {Name}.") for each slot whose player's switch happened
 * with no Case.replacement given. A case without a bench has none of these.
 */
function compareBench(c: Case, oracle: OracleResult, result: Extract<DoublesTurnResult, { status: "ready" }>, near: Near, push: Push, hpCheck: (where: string, e: Expected, hp: DoublesHP, n: number | undefined) => void) {
  const n = oracle.walks.all.samples;
  const replaced = (where: string, want: ReplacedExpected | null | undefined, got: Partial<Record<SlotId, DoublesReplaced>> | undefined) => {
    for (const slot of new Set([...Object.keys(want ?? {}), ...Object.keys(got ?? {})]) as Set<SlotId>) {
      const w = want?.[slot], g = got?.[slot];
      if (!w) { push(`${where} ${slot}`, "replaced", "none in Showdown", g); continue; }
      if (!g) { push(`${where} ${slot}`, "replaced", w.entered.map((e) => `${e.id} ${+e.chance.toFixed(6)}`).join(", "), "missing"); continue; }
      for (const l of w.left) {
        const a = g.left.find((x) => x.id === l.id);
        if (!a) { push(`${where} ${slot}`, `left ${l.id}`, l.chance, "missing"); continue; }
        if (!near(a.chance, l.chance)) push(`${where} ${slot}`, `left ${l.id}.chance`, l.chance, a.chance);
        hpCheck(`${where} ${slot} left ${l.id}`, l, a.hp, n);
      }
      for (const a of g.left) if (!w.left.some((l) => l.id === a.id)) push(`${where} ${slot}`, `left ${a.id}`, "none in Showdown", a.chance);
      for (const id of new Set([...w.entered.map((e) => e.id), ...g.entered.map((e) => e.id)])) {
        const x = w.entered.find((e) => e.id === id)?.chance ?? 0, y = g.entered.find((e) => e.id === id)?.chance ?? 0;
        if (!near(x, y)) push(`${where} ${slot}`, `entered ${id}.chance`, x, y);
      }
    }
  };
  const entered = (where: string, want: EnteredExpected | null | undefined, got: Partial<Record<SlotId, Record<string, DoublesHP>>> | undefined) => {
    for (const slot of new Set([...Object.keys(want ?? {}), ...Object.keys(got ?? {})]) as Set<SlotId>) {
      for (const id of new Set([...Object.keys(want?.[slot] ?? {}), ...Object.keys(got?.[slot] ?? {})])) {
        const w = want?.[slot]?.[id], g = got?.[slot]?.[id];
        if (!w) { push(`${where} ${slot}|${id}`, "hpEntered", "none in Showdown", g); continue; }
        if (!g) { push(`${where} ${slot}|${id}`, "hpEntered", `a DoublesHP (came in ${+w.chance.toFixed(6)})`, "missing"); continue; }
        hpCheck(`${where} ${slot}|${id}`, w, g, n);
      }
    }
  };
  if (!hasBench(c)) {
    if (result.replaced) push("turn", "replaced", "none (no bench)", result.replaced);
    if (result.hpEntered) push("turn", "hpEntered", "none (no bench)", result.hpEntered);
    return;
  }
  replaced("replaced", oracle.expectedReplaced, result.replaced);
  entered("hpEntered", oracle.expectedEntered, result.hpEntered);
  const eot = result.endOfTurn;
  if (eot?.status === "ready" && oracle.afterTurn && !c.endNotEstimated) {
    replaced("endOfTurn.replaced", oracle.afterTurnReplaced, eot.replaced);
    entered("endOfTurn.hpEntered", oracle.afterTurnEntered, eot.hpEntered);
  }
  // The default replacement's fact: one per slot whose player's switch-out happened (a chosen newcomer, not a drag) with no
  // Case.replacement, after the moves or after the residual.
  const chosen = new Set<SlotId>();
  for (const table of [oracle.walks.all.replaced, oracle.walks.all.afterTurn?.replaced]) {
    for (const [slot, r] of Object.entries(table ?? {}) as [SlotId, NonNullable<NonNullable<typeof table>[SlotId]>][]) {
      if (r.entered.some((e) => (e.chosen ?? 0) > 1e-12) && !c.replacement?.[slot]) chosen.add(slot);
    }
  }
  const said = result.facts.filter((f) => /^Assumes .+ comes in for .+\\.$/.test(f));
  if (said.length !== chosen.size) push("turn", "facts (the default replacement)", `${chosen.size} "Assumes {Newcomer} comes in for {Name}." (${[...chosen].join(", ") || "none"})`, said);
}"""),
# residuals by the newcomer's id
("""    const candidates = eot.residuals.map((a, k) => ({ a, k })).filter(({ a, k }) => !used.has(k) && a.slot === r.slot && residualMatches(r.effect, a) && (r.other === undefined || a.other === undefined || a.other === r.other));""",
"""    // status2 wave 2: a residual on a newcomer matches one with its id (DoublesResidual.id).
    const sameMon = (a: DoublesResidual) => a.slot === r.slot && (a.id ?? null) === (r.id ?? null);
    const candidates = eot.residuals.map((a, k) => ({ a, k })).filter(({ a, k }) => !used.has(k) && sameMon(a) && residualMatches(r.effect, a) && (r.other === undefined || a.other === undefined || a.other === r.other));"""),
("""    const j = i >= 0 ? i : eot.residuals.findIndex((a, k) => !used.has(k) && a.slot === r.slot && a.min === r.min && a.max === r.max && near(a.chance, r.chance));""",
"""    const j = i >= 0 ? i : eot.residuals.findIndex((a, k) => !used.has(k) && sameMon(a) && a.min === r.min && a.max === r.max && near(a.chance, r.chance));"""),
("""      if (r.min !== null || r.koChance > 0 || given.length) push(`endOfTurn ${r.slot}`, `residual ${r.effect}`, residualText(r), "missing", JSON.stringify(eot.residuals.filter((a) => a.slot === r.slot).map((a) => `${a.effect} ${a.chance} ${a.min}..${a.max}`)));""",
"""      if (r.min !== null || r.koChance > 0 || given.length) push(`endOfTurn ${r.slot}${r.id ? `|${r.id}` : ""}`, `residual ${r.effect}`, residualText(r), "missing", JSON.stringify(eot.residuals.filter((a) => a.slot === r.slot).map((a) => `${a.id ? `${a.id} ` : ""}${a.effect} ${a.chance} ${a.min}..${a.max}`)));"""),
# E2: the identity view of a bench case's outcomes, and the newcomers
("""function compareOutcomes(c: Case, oracle: OracleResult, outcomes: DoublesOutcomesResult | null | undefined, near: Near, push: Push) {
  if (!outcomes) { push("E2", "result", "a DoublesOutcomesResult", outcomes ?? null); return; }
  if (outcomes.status !== "ready") { push("E2", "status", "ready", outcomes.status, outcomes.status === "not-estimated" ? outcomes.reason : undefined); return; }
  const applied = outcomes.endOfTurn === "applied";""",
"""function compareOutcomes(c: Case, oracle: OracleResult, given: DoublesOutcomesResult | null | undefined, near: Near, push: Push) {
  if (!given) { push("E2", "result", "a DoublesOutcomesResult", given ?? null); return; }
  if (given.status !== "ready") { push("E2", "status", "ready", given.status, given.status === "not-estimated" ? given.reason : undefined); return; }
  // status2 wave 2: with a bench, each slot is compared as its starting Pokémon (identityOutcomes), and the newcomers apart.
  const outcomes = hasBench(c) ? identityOutcomes(given, push) : given;
  const applied = outcomes.endOfTurn === "applied";
  if (hasBench(c)) compareOutcomeNewcomers(c, oracle, given, applied, near, push);"""),
("""type ReadyOutcomes = Extract<DoublesOutcomesResult, { status: "ready" }>;""",
"""type ReadyOutcomes = Extract<DoublesOutcomesResult, { status: "ready" }>;
/**
 * status2 wave 2: the outcomes with each slot's mons entry its starting Pokémon: the occupant when it has no id, else the
 * leaver of DoublesOutcome.benched with id startId(slot) (the oracle's slots are by identity: a leaver's HP as it left).
 */
function identityOutcomes(r: ReadyOutcomes, push: Push): ReadyOutcomes {
  return {
    ...r, outcomes: r.outcomes.map((oc) => {
      const mons: DoublesOutcome["mons"] = {};
      for (const slot of SLOTS) {
        const m = oc.mons[slot];
        if (!m?.id) { if (m) mons[slot] = m; continue; }
        const side = slot.startsWith("own") ? "own" : "opponent";
        const left = oc.benched?.[side]?.find((b) => b.id === `slot:${slot}`);
        if (!left) { push(`E2 ${slot}`, "benched", `slot:${slot} (the occupant is ${m.id})`, "missing"); continue; }
        mons[slot] = left;
      }
      return { ...oc, mons };
    }),
  };
}
/**
 * status2 wave 2: each newcomer's E2 state (DoublesOutcome.mons[slot] with its id, or benched again) against the oracle's
 * entered (after the turn when applied, else after the moves): its HP mixture (absolute: the chance it came in times its
 * conditional HP), its item and, where it never faints, its status; and no app newcomer or leaver Showdown does not have.
 */
function compareOutcomeNewcomers(c: Case, oracle: OracleResult, r: ReadyOutcomes, applied: boolean, near: Near, push: Push) {
  const want = (applied ? oracle.walks.all.afterTurn?.entered : oracle.walks.all.entered) ?? {};
  const monOf = (oc: DoublesOutcome, slot: SlotId, id: string): DoublesOutcomeMon | undefined => {
    if (oc.mons[slot]?.id === id) return oc.mons[slot];
    const side = slot.startsWith("own") ? "own" : "opponent";
    return oc.benched?.[side]?.find((b) => b.id === id && b.slot === slot);
  };
  const known = new Set<string>();
  for (const [slot, byId] of Object.entries(want) as [SlotId, Record<string, EnteredResult>][]) {
    for (const [id, e] of Object.entries(byId)) {
      known.add(`${slot}|${id}`);
      const hp = new Map<number, number>(), item = new Map<string, number>(), status = new Map<string, number>();
      let mass = 0;
      for (const oc of r.outcomes) {
        const m = monOf(oc, slot, id);
        if (!m) continue;
        mass += oc.chance;
        for (const h of m.hp) hp.set(h.hp, (hp.get(h.hp) ?? 0) + oc.chance * h.chance);
        item.set(m.build.itemId ?? "", (item.get(m.build.itemId ?? "") ?? 0) + oc.chance);
        status.set(m.build.status ?? "", (status.get(m.build.status ?? "") ?? 0) + oc.chance);
      }
      const where = `E2 ${slot}|${id}`;
      if (!near(mass, e.chance)) push(where, "came in", e.chance, mass);
      for (const [h, p] of e.dist) if (!near(hp.get(h) ?? 0, p * e.chance)) push(where, `hp ${h}`, p * e.chance, hp.get(h) ?? 0);
      for (const [h, p] of hp) if (p > 1e-12 && !e.dist.some(([x]) => x === h)) push(where, `hp ${h}`, 0, p);
      for (const [k, p] of Object.entries(e.item ?? {})) if (!near(item.get(k) ?? 0, p)) push(where, `item ${k || "(none)"}`, p, item.get(k) ?? 0);
      if (e.status && e.koChance === 0) for (const k of new Set([...Object.keys(e.status), ...status.keys()])) if (!near(status.get(k) ?? 0, e.status[k] ?? 0)) push(where, `status ${k || "(none)"}`, e.status[k] ?? 0, status.get(k) ?? 0);
    }
  }
  for (const oc of r.outcomes) {
    for (const slot of SLOTS) {
      const id = oc.mons[slot]?.id;
      if (id && !known.has(`${slot}|${id}`)) push(`E2 ${slot}|${id}`, "came in", "not in Showdown", oc.chance);
    }
    for (const list of Object.values(oc.benched ?? {})) for (const b of list ?? []) {
      if (b.id.startsWith("slot:") ? b.id !== `slot:${b.slot}` : !known.has(`${b.slot}|${b.id}`)) push(`E2 benched ${b.slot}|${b.id}`, "left", "not in Showdown", oc.chance);
    }
  }
  void c;
}"""),
])
