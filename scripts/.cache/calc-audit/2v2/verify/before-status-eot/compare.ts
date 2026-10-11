// Field-by-field comparison of the app's calculateDoublesTurn (app-turn.ts) with the pinned Showdown oracle (results/<id>.json
// from sim-dfs.ts), SPEC §8.1.
//
// Tolerances. Exhaustive cases: every probability and the average within 1e-9; start, maximum, min, max, low and high exact.
// Monte Carlo cases ("modes"): low and high exact (their walks are exhaustive), KO chance within 1.5 percentage points, the
// average within 4 standard errors of the sample, the app's min ≤ the least sampled HP and max ≥ the most. Steps: moves, the order
// distribution (every pick counted), the reach and KO chance of each hit within 1e-9 (exhaustive) or 0.015 (sampled); a hit the
// harness saw land must be "calculated" with the same min and max damage over the calculations it met (a multi-hit move whose hits
// stopped at its target's knockout: the app's calculation covers Showdown's largest sum); one that
// never landed must be "blocked" (or "no-damage" for a type immunity). Not-estimated cases: the status, the exact reason and non-empty start rows.
//
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts [V01 ...]
// Writes scripts/.cache/calc-audit/2v2/verify/results/compare.json.
import fs from "node:fs";
import path from "node:path";
import type { DoublesHit, DoublesStep, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { SLOTS, type Case, type OracleResult, type SlotId } from "./case-types";
import { CASES } from "./cases";
import { appTurn, APP_RESULTS_DIR, runtimeFor } from "./app-turn";

const RESULTS_DIR = path.resolve("scripts/.cache/calc-audit/2v2/verify/results");
export type Mismatch = { id: string; where: string; field: string; expected: unknown; got: unknown; note?: string };

const TURN_FACT = "Every move hits; no critical hits; added effects below 100% do not happen.";
const TURN_FACT_CRIT = "Every move hits and every damaging hit is critical; added effects below 100% do not happen.";
const END_FACT = "End-of-turn effects are not applied.";
const PROTECT_FACT = "Assumes no protecting move was used last turn.";
const TRICK_ROOM_FACT = "Trick Room: slower Pokémon move first.";
const PROTECT_FAMILY = new Set(["protect", "detect", "kingsshield", "spikyshield", "banefulbunker", "obstruct", "silktrap", "burningbulwark"]);

/** `isStatus`: the move is a status move (its "hits" are not damage, so they are not compared). */
export function compareCase(c: Case, oracle: OracleResult | null, result: DoublesTurnResult | null, isStatus: (moveId: string) => boolean = () => false): Mismatch[] {
  const out: Mismatch[] = [];
  const push = (where: string, field: string, expected: unknown, got: unknown, note?: string) => out.push({ id: c.id, where, field, expected, got, ...(note ? { note } : {}) });
  if (!result) return [{ id: c.id, where: "turn", field: "result", expected: "a result", got: null }];
  if (c.notEstimated) {
    if (result.status !== "not-estimated") push("turn", "status", "not-estimated", result.status);
    else {
      if (result.reason !== c.notEstimated) push("turn", "reason", c.notEstimated, result.reason);
      if (!result.startRows.length) push("turn", "startRows", "at least one start row", 0);
    }
    return out;
  }
  if (!oracle) return [{ id: c.id, where: "turn", field: "oracle", expected: "results/<id>.json", got: null, note: "run sim-dfs.ts first" }];
  if (result.status !== "ready") {
    push("turn", "status", "ready", result.status, result.status === "not-estimated" ? result.reason : JSON.stringify(result.issues));
    return out;
  }
  const sampled = !oracle.walks.all.exact;
  const pTol = sampled ? 0.015 : 1e-9;
  const near = (a: number, b: number, tol = pTol) => Math.abs(a - b) <= tol;
  for (const slot of SLOTS) {
    const e = oracle.expected[slot], hp = result.hp[slot];
    if (c.slots[slot].absent) {
      if (hp !== null) push(slot, "hp", null, hp);
      continue;
    }
    if (!hp) { push(slot, "hp", "a DoublesHP", null); continue; }
    if (hp.start !== e.start) push(slot, "start", e.start, hp.start);
    if (hp.maximum !== e.maximum) push(slot, "maximum", e.maximum, hp.maximum);
    if (hp.low !== e.low) push(slot, "low", e.low, hp.low, "mode of the all-lowest-rolls walk, ties to the higher HP");
    if (hp.high !== e.high) push(slot, "high", e.high, hp.high, "mode of the all-highest-rolls walk, ties to the lower HP");
    if (!near(hp.koChance, e.koChance)) push(slot, "koChance", e.koChance, hp.koChance);
    if (sampled) {
      const n = oracle.walks.all.samples ?? 1;
      const variance = e.dist.reduce((sum, [h, p]) => sum + p * (h - e.average) ** 2, 0);
      const se = Math.sqrt(variance / n);
      if (Math.abs(hp.average - e.average) > Math.max(4 * se, 1e-9)) push(slot, "average", e.average, hp.average, `sampled, 4 SE = ${(4 * se).toFixed(4)}`);
      if (hp.min > e.min) push(slot, "min", `≤ ${e.min}`, hp.min, "sampled");
      if (hp.max < e.max) push(slot, "max", `≥ ${e.max}`, hp.max, "sampled");
    } else {
      if (!near(hp.average, e.average)) push(slot, "average", e.average, hp.average);
      if (hp.min !== e.min) push(slot, "min", e.min, hp.min);
      if (hp.max !== e.max) push(slot, "max", e.max, hp.max);
    }
    const step = oracle.walks.all.steps[slot];
    const before = step?.faintedAtPick ?? 0;
    if (before > 0 && !near(hp.faintsBeforeMoving ?? 0, before)) push(slot, "faintsBeforeMoving", before, hp.faintsBeforeMoving);
    if (before === 0 && hp.faintsBeforeMoving !== undefined && hp.faintsBeforeMoving > 0) push(slot, "faintsBeforeMoving", undefined, hp.faintsBeforeMoving);
    const healed = Object.keys(oracle.walks.all.steps).some((s) => Object.keys(oracle.walks.all.steps[s as SlotId]!.lines)
      .some((l) => l.startsWith(`|-heal|${ident(slot)}: `) && /\[from\] item: /.test(l)));
    if (healed && !hp.heals.length) push(slot, "heals", "an item heal", hp.heals, "info: an HP item healed it on some path");
  }
  // Steps: only slots with a move, by mean position.
  const steps = new Map<SlotId, DoublesStep>(result.steps.map((s) => [s.slot as SlotId, s]));
  for (const slot of SLOTS) {
    const o = oracle.walks.all.steps[slot];
    const s = steps.get(slot);
    if (!o) { if (s) push(slot, "step", "no step (No move)", s.moveId); continue; }
    if (!s) { push(slot, "step", o.moveId, "missing"); continue; }
    if (s.moveId !== o.moveId) push(slot, "step.moveId", o.moveId, s.moveId);
    if (!near(s.moves, o.moved)) push(slot, "step.moves", o.moved, s.moves);
    const order = Object.fromEntries(s.order.map((e) => [String(e.position), e.chance]));
    for (const pos of new Set([...Object.keys(o.orderAll), ...Object.keys(order)])) {
      if (!near(order[pos] ?? 0, o.orderAll[pos] ?? 0)) push(slot, `step.order[${pos}]`, o.orderAll[pos] ?? 0, order[pos] ?? 0, o.orderMoved[pos] !== undefined && near(order[pos] ?? 0, o.orderMoved[pos]) ? "equals the moved-only order" : undefined);
    }
    const skipped = s.skipped.reduce((sum, f) => sum + f.chance, 0);
    if (!near(skipped, 1 - o.moved)) push(slot, "step.skipped (total)", 1 - o.moved, skipped, JSON.stringify(s.skipped));
    if (isStatus(o.moveId)) continue;
    const hits = new Map<SlotId, DoublesHit>(s.hits.map((h) => [h.slot as SlotId, h]));
    for (const target of SLOTS) {
      const oh = o.hits[target], ah = hits.get(target);
      const reached = oh?.reached ?? 0;
      if (reached === 0) {
        if (ah && ah.reached > 0) push(`${slot}→${target}`, "hit.reached", 0, ah.reached);
        continue;
      }
      if (!ah) { push(`${slot}→${target}`, "hit", `reached ${reached}`, "missing"); continue; }
      if (!near(ah.reached, reached)) push(`${slot}→${target}`, "hit.reached", reached, ah.reached);
      if (!near(ah.koChance, oh!.ko)) push(`${slot}→${target}`, "hit.koChance", oh!.ko, ah.koChance);
      const immune = Object.keys(o.lines).some((l) => l.startsWith(`|-immune|${ident(target)}: `));
      if (oh!.landed === 0) {
        const kind = immune ? "no-damage" : "blocked";
        if (ah.kind !== kind && !(ah.kind === "no-damage" && kind === "blocked")) push(`${slot}→${target}`, "hit.kind", kind, ah.kind);
      } else if (oh!.dmgMax !== null && oh!.dmgMax > 0) {
        if (ah.kind !== "calculated") push(`${slot}→${target}`, "hit.kind", "calculated", ah.kind);
        // A multi-hit move whose hits stopped at its target's knockout before the planned last hit (the oracle's
        // `truncated`: sim/battle-actions.ts:890-895 move.lastHit false) has Showdown's sum over the hits it dealt on that
        // path only; the app's hit is the move's calculation (shown with its hit count, as the 1v1 row), which must cover
        // every sum Showdown met.
        if ((oh!.truncated ?? 0) > 0) {
          if (ah.max === null || ah.max < oh!.dmgMax) push(`${slot}→${target}`, "hit.max", `≥ ${oh!.dmgMax}`, ah.max, "hits stopped at the knockout: the calculation covers the hits dealt");
        } else if (!sampled) {
          if (ah.min !== oh!.dmgMin) push(`${slot}→${target}`, "hit.min", oh!.dmgMin, ah.min, "damage summed over the action's hits, uncapped");
          if (ah.max !== oh!.dmgMax) push(`${slot}→${target}`, "hit.max", oh!.dmgMax, ah.max, "damage summed over the action's hits, uncapped");
        }
      }
    }
    for (const [target, ah] of hits) if (!o.hits[target] && ah.reached > 0) push(`${slot}→${target}`, "hit.reached", 0, ah.reached);
  }
  // Turn facts (SPEC §2.3).
  const facts = result.facts;
  const want = c.field?.critical ? TURN_FACT_CRIT : TURN_FACT;
  if (!facts.includes(want)) push("turn", "facts", want, facts);
  if (!facts.includes(END_FACT)) push("turn", "facts", END_FACT, facts);
  const protects = SLOTS.some((slot) => !c.slots[slot].absent && PROTECT_FAMILY.has((c.slots[slot].action.move ?? "").toLowerCase().replace(/[^a-z]/g, "")));
  if (protects !== facts.includes(PROTECT_FACT)) push("turn", "facts", protects ? PROTECT_FACT : `no "${PROTECT_FACT}"`, facts);
  const room = !!c.field?.trickRoom || SLOTS.some((slot) => (c.slots[slot].action.move ?? "") === "Trick Room");
  if (room !== facts.includes(TRICK_ROOM_FACT)) push("turn", "facts", room ? TRICK_ROOM_FACT : `no "${TRICK_ROOM_FACT}"`, facts);
  return out;
}

function ident(slot: SlotId) {
  return { "own-left": "p1a", "own-right": "p1b", "opponent-left": "p2b", "opponent-right": "p2a" }[slot];
}

export function readOracle(id: string): OracleResult | null {
  const file = path.join(RESULTS_DIR, `${id}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as OracleResult : null;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("verify/compare.ts")) {
  (async () => {
    const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
    const report: { id: string; status: string; ms: number; mismatches: Mismatch[]; error?: string }[] = [];
    fs.mkdirSync(APP_RESULTS_DIR, { recursive: true });
    for (const c of CASES) {
      if (ids.length && !ids.some((id) => c.id.startsWith(id))) continue;
      const oracle = readOracle(c.id);
      const app = await appTurn(c);
      fs.writeFileSync(path.join(APP_RESULTS_DIR, `${c.id}.json`), JSON.stringify(app, null, 1));
      if (app.error) {
        report.push({ id: c.id, status: "error", ms: app.ms, mismatches: [], error: app.error.split("\n").slice(0, 3).join(" ") });
        console.log(`${c.id}: ERROR ${app.error.split("\n")[0]}`);
        continue;
      }
      const runtime = await runtimeFor(c);
      const mismatches = compareCase(c, oracle, app.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status");
      report.push({ id: c.id, status: app.result?.status ?? "none", ms: app.ms, mismatches });
      console.log(`${c.id}: ${app.result?.status} ${app.ms.toFixed(1)} ms, ${mismatches.length ? `${mismatches.length} mismatches` : "match"}`);
      for (const m of mismatches) console.log(`   ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
    }
    fs.writeFileSync(path.join(RESULTS_DIR, "compare.json"), JSON.stringify(report, null, 1));
    const bad = report.filter((r) => r.status === "error" || r.mismatches.length);
    console.log(`\n${report.length - bad.length}/${report.length} cases match.`);
  })();
}
