// Field-by-field comparison of the app's calculateDoublesTurn (app-turn.ts) with the pinned Showdown oracle (results/<id>.json
// from sim-dfs.ts), SPEC §8.1, extended by status-eot SPEC §7 step 5 and ADDENDUM §7.1 step 4.
//
// Tolerances. Exhaustive cases: every probability and the average within 1e-9; start, maximum, min, max, low and high exact.
// Monte Carlo cases ("modes"): low and high exact (their walks are exhaustive), KO chance within 1.5 percentage points, the
// average within 4 standard errors of the sample, the app's min ≤ the least sampled HP and max ≥ the most. Steps: moves, the order
// distribution (every pick counted), the reach and KO chance of each hit within 1e-9 (exhaustive) or 0.015 (sampled); a hit the
// harness saw land must be "calculated" with the same min and max damage over the calculations it met (a multi-hit move whose hits
// stopped at its target's knockout: the app's calculation covers Showdown's largest sum); one that
// never landed must be "blocked" (or "no-damage" for a type immunity). Not-estimated cases: the status, the exact reason and non-empty start rows.
//
// status-eot additions:
// - status moves: each hit's reach; its kind against reached/landed; its `change` against the HP change; the effect lines of
//   EFFECT_FACTS (a status given, a stage, a skipped move, a self-hit, a volatile started) against the app's facts with their
//   chances; the No-move self-hit against DoublesHP.losses;
// - the end of turn: endOfTurn.hp against the oracle after the whole turn, each oracle residual against a DoublesResidual
//   (chance, min, max, koChance), the end-of-turn reason of a case with `endNotEstimated`; the removed End-of-turn fact is no
//   longer expected;
// - ADDENDUM: `swapped`, DoublesHit.substitute against the oracle's Substitute record, kind "substitute";
// - E2 (`outcomes` cases): the outcomes' HP, item, Substitute, position and volatile mixtures.
//
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/compare.ts [V01 ...] [--no-write]
// Writes scripts/.cache/calc-audit/2v2/verify/results/compare.json and app-results/<id>.json.
import fs from "node:fs";
import path from "node:path";
import type { DoublesFact, DoublesHit, DoublesHP, DoublesOutcome, DoublesOutcomeMon, DoublesOutcomesResult, DoublesReplaced, DoublesResidual, DoublesStep, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { SLOTS, toID, type Case, type EnteredResult, type Expected, type OracleResult, type ResidualResult, type SlotId, type SlotResult, type StepResult } from "./case-types";
import { buildTypes } from "@/app/lib/battle/mechanics";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { CASES } from "./cases";
import { appTurn, APP_RESULTS_DIR, runtimeFor } from "./app-turn";

const RESULTS_DIR = path.resolve("scripts/.cache/calc-audit/2v2/verify/results");
export type Mismatch = { id: string; where: string; field: string; expected: unknown; got: unknown; note?: string };

const TURN_FACT = "Every move hits; no critical hits; added effects below 100% do not happen.";
const TURN_FACT_CRIT = "Every move hits and every damaging hit is critical; added effects below 100% do not happen.";
/** The hit rule when a critical-hit ratio made some hit certainly critical (status-eot fix L1: the oracle's crit effect). */
const TURN_FACT_CERTAIN = "Every move hits; critical hits only where certain; added effects below 100% do not happen.";
const END_FACT = "End-of-turn effects are not applied.";
const PROTECT_FACT = "Assumes no protecting move was used last turn.";
const TRICK_ROOM_FACT = "Trick Room: slower Pokémon move first.";
const PROTECT_FAMILY = new Set(["protect", "detect", "kingsshield", "spikyshield", "banefulbunker", "obstruct", "silktrap", "burningbulwark", "endure"]);
const IDENT: Record<SlotId, string> = { "own-left": "p1a", "own-right": "p1b", "opponent-left": "p2b", "opponent-right": "p2a" };

// ---------- EFFECT_FACTS (status-eot SPEC §7 step 5): oracle effect keys ↔ the app's fact texts (doubles-status.ts) ----------
const STATUS_GIVEN: Record<string, string> = { slp: "Falls asleep.", par: "Is paralysed.", brn: "Is burned.", psn: "Is poisoned.", tox: "Is badly poisoned.", frz: "Is frozen." };
const STAGE_NAMES: Record<string, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasion" };
const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);
/** A volatile the move started on the target ↔ a fact naming it. */
const START_FACTS: Record<string, RegExp> = {
  confusion: /confus/i, taunt: /taunt/i, yawn: /drows|yawn/i, leechseed: /leech seed|seeded/i, substitute: /substitute/i,
  curse: /curse/i, encore: /encore/i, disable: /disable/i, healblock: /heal block/i, perish3: /perish/i, aquaring: /aqua ring/i,
  ingrain: /ingrain/i, focusenergy: /focus energy/i, dragoncheer: /dragon cheer|critical/i, magnetrise: /magnet rise/i,
  saltcure: /salt cure/i, attract: /infatuat|attract/i,
};
/** A move stopped at its BeforeMove ↔ the step's skipped fact. */
const CANT_FACTS: Record<string, RegExp> = {
  slp: /^Asleep\./, frz: /^Frozen\./, taunt: /^Taunt: /, disable: /^Disable: /, imprison: /^Imprison: /, gravity: /gravity/i,
  dazzling: /dazzling/i, armortail: /armor tail/i, queenlymajesty: /queenly majesty/i,
};

/** `isStatus`: the move is a status move (its hits are effects, compared through EFFECT_FACTS and kind). */
/** ADDENDUM §2.2's L moves (not modelled in this build): no effect facts to compare. */
const L_MOVES = new Set(`acupressure aromatherapy attract autotomize bestow camouflage captivate conversion conversion2 corrosivegas courtchange
craftyshield defog doodle electrify embargo entrainment flowershield foresight forestscurse gastroacid gearup geomancy guardsplit guardswap
healbell healblock heartswap iondeluge luckychant magiccoat magicpowder magicroom magneticflux matblock minimize miracleeye mist mudsport
nightmare noretreat octolock odorsleuth powder powershift powersplit powerswap powertrick psychoshift psychup purify recycle reflecttype
roleplay rototiller simplebeam skillswap snatch soak speedswap stockpile stuffcheeks swallow tarshot teatime telekinesis tidyup topsyturvy
transform trickortreat watersport wonderroom worryseed`.split(/\s+/));
/** Moves used while asleep in Showdown (the cant line comes, then the move): no skip. */
const SLEEP_USABLE = new Set(["snore", "sleeptalk"]);

export function compareCase(c: Case, oracle: OracleResult | null, result: DoublesTurnResult | null, isStatus: (moveId: string) => boolean = () => false, outcomes?: DoublesOutcomesResult | null): Mismatch[] {
  const out: Mismatch[] = [];
  const push = (where: string, field: string, expected: unknown, got: unknown, note?: string) => out.push({ id: c.id, where, field, expected, got, ...(note ? { note } : {}) });
  if (!result) return [{ id: c.id, where: "turn", field: "result", expected: "a result", got: null }];
  if (c.notEstimated) {
    if (result.status !== "not-estimated") push("turn", "status", "not-estimated", result.status);
    else {
      if (result.reason !== c.notEstimated) push("turn", "reason", c.notEstimated, result.reason);
      const damaging = SLOTS.some((slot) => !c.slots[slot].absent && c.slots[slot].action.move && !isStatus(toID(c.slots[slot].action.move!)));
      // status2 integration 1b: a reason the start gives itself (no start: result.start null, ST's kept Trace reason) has no rows.
      if (damaging && !result.startRows.length && result.start !== null) push("turn", "startRows", "at least one start row", 0);
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
  const hpCheck = (where: string, e: Expected, hp: DoublesHP, walkSamples: number | undefined) => {
    if (hp.start !== e.start) push(where, "start", e.start, hp.start);
    if (hp.maximum !== e.maximum) push(where, "maximum", e.maximum, hp.maximum);
    if (hp.low !== e.low) push(where, "low", e.low, hp.low, "mode of the all-lowest-rolls walk, ties to the higher HP");
    if (hp.high !== e.high) push(where, "high", e.high, hp.high, "mode of the all-highest-rolls walk, ties to the lower HP");
    if (!near(hp.koChance, e.koChance)) push(where, "koChance", e.koChance, hp.koChance);
    if (sampled) {
      const n = walkSamples ?? 1;
      const variance = e.dist.reduce((sum, [h, p]) => sum + p * (h - e.average) ** 2, 0);
      const se = Math.sqrt(variance / n);
      if (Math.abs(hp.average - e.average) > Math.max(4 * se, 1e-9)) push(where, "average", e.average, hp.average, `sampled, 4 SE = ${(4 * se).toFixed(4)}`);
      if (hp.min > e.min) push(where, "min", `≤ ${e.min}`, hp.min, "sampled");
      if (hp.max < e.max) push(where, "max", `≥ ${e.max}`, hp.max, "sampled");
    } else {
      if (!near(hp.average, e.average)) push(where, "average", e.average, hp.average);
      if (hp.min !== e.min) push(where, "min", e.min, hp.min);
      if (hp.max !== e.max) push(where, "max", e.max, hp.max);
    }
  };
  for (const slot of SLOTS) {
    const e = oracle.expected[slot], hp = result.hp[slot];
    if (c.slots[slot].absent) {
      if (hp !== null) push(slot, "hp", null, hp);
      continue;
    }
    if (!hp) { push(slot, "hp", "a DoublesHP", null); continue; }
    hpCheck(slot, e, hp, oracle.walks.all.samples);
    const step = oracle.walks.all.steps[slot];
    const before = step?.faintedAtPick ?? 0;
    if (before > 0 && !near(hp.faintsBeforeMoving ?? 0, before)) push(slot, "faintsBeforeMoving", before, hp.faintsBeforeMoving);
    if (before === 0 && hp.faintsBeforeMoving !== undefined && hp.faintsBeforeMoving > 0) push(slot, "faintsBeforeMoving", undefined, hp.faintsBeforeMoving);
    const healed = Object.keys(oracle.walks.all.steps).some((s) => Object.keys(oracle.walks.all.steps[s as SlotId]!.lines)
      .some((l) => l.startsWith(`|-heal|${IDENT[slot]}: `) && /\[from\] item: /.test(l)));
    if (healed && !hp.heals.length) push(slot, "heals", "an item heal", hp.heals, "info: an HP item healed it on some path");
    // status-eot C5: a No-move Pokémon's confusion self-hit ↔ DoublesHP.losses.
    const noMove = oracle.walks.all.noMove?.[slot]?.[slot];
    if (noMove) {
      const selfHit = selfHitOf(noMove);
      const losses = (hp.losses ?? []).filter((f) => /hurts itself in confusion/i.test(f.text));
      const chance = losses.reduce((s, f) => s + f.chance, 0);
      // status2 (integration 1a): Disguise's share (its own fact, no HP lost); a delta the oracle capped at the Pokémon's HP
      // (it fainted, or Focus Band left 1 HP: W) shows no raw range, so only the chance is checked there.
      const all = selfHit.mass + selfHit.disguised;
      const capped = selfHit.mass > 0 && selfHit.max >= hp.start - 1;
      if (all > 0 || chance > 0) {
        if (!near(chance, all)) push(slot, "losses (confusion self-hit)", all, chance, JSON.stringify(hp.losses ?? []));
        else if (!near(chanceOf(losses, disguiseSelfHit), selfHit.disguised)) push(slot, "losses (confusion self-hit, Disguise)", selfHit.disguised, chanceOf(losses, disguiseSelfHit), losses.map((f) => f.text));
        else if (selfHit.mass > 0 && !capped && !losses.some((f) => f.text.includes(rangeText(selfHit.min, selfHit.max)))) push(slot, "losses (confusion self-hit range)", rangeText(selfHit.min, selfHit.max), losses.map((f) => f.text));
      }
    }
  }
  // Steps: only slots with a move, by mean position.
  // status2 wave 1b: a copied step (DoublesStep.copied) is compared with the oracle's copies below, not the slot's own action.
  const steps = new Map<SlotId, DoublesStep>(result.steps.filter((s) => !s.copied).map((s) => [s.slot as SlotId, s]));
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
    // status2 (integration 1a): an Encore that changed the queued move: the move used decides how its hits compare.
    const encored = s.facts.map((f) => /^Encore: .+ uses (.+)\.$/.exec(f.text)?.[1]).find((name) => name && o.lines[`|effective|${name}`] !== undefined);
    // status2 wave 1b (T2P §3.9–§3.14): a calling move (Nature Power, Copycat, Me First, Mirror Move, Sleep Talk) is compared
    // as the moves it called (the oracle's usedmove:<called>:<caller> keys): damaging when one of them is (the caller's own
    // hit step on its user, Sleep Talk's and Copycat's, compares by its reach as both sides list it).
    const called = calledMoves(o, slot);
    const usedStatus = called.length ? called.every((m) => isStatus(m)) : isStatus(encored ? toID(encored) : o.moveId);
    if (o.effects) compareEffects(slot, o, s, near, push, usedStatus, c);
    // The confusion self-hit, raw damage (getConfusionDamage, uncapped as hit damage is) ↔ the skipped fact.
    if (o.selfHit && o.selfHit.mass > 0) {
      const facts = s.skipped.filter((f) => /hurts itself in confusion/i.test(f.text));
      const got = facts.reduce((x, f) => x + f.chance, 0);
      // status2 (integration 1a): the share Disguise took has its own fact and no range.
      const disguised = selfHitOf(o.effects?.[slot] ?? {}).disguised;
      const ranged = facts.filter((f) => !disguiseSelfHit(f.text));
      if (!near(got, o.selfHit.mass)) push(slot, "confusion self-hit (skipped)", o.selfHit.mass, got, JSON.stringify(s.skipped));
      else if (!near(chanceOf(facts, disguiseSelfHit), disguised)) push(slot, "confusion self-hit (Disguise)", disguised, chanceOf(facts, disguiseSelfHit), facts.map((f) => f.text));
      else if (o.selfHit.mass - disguised > 1e-9 && !ranged.some((f) => f.text.includes(rangeText(o.selfHit!.min, o.selfHit!.max)))) push(slot, "confusion self-hit range", rangeText(o.selfHit.min, o.selfHit.max), facts.map((f) => f.text));
    }
    const hits = new Map<SlotId, DoublesHit>(s.hits.filter((h) => !h.id).map((h) => [h.slot as SlotId, h]));
    // status2 wave 2: the hits on a newcomer (DoublesHit.id) against the oracle's hitsEntered.
    compareEnteredHits(slot, o, s, near, push, usedStatus, sampled);
    if (usedStatus) {
      compareStatusHits(slot, o, hits, near, push);
      continue;
    }
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
      const immune = o.effects ? Object.keys(o.effects[target] ?? {}).some((k) => k.startsWith("immune"))
        : Object.keys(o.lines).some((l) => l.startsWith(`|-immune|${IDENT[target]}: `));
      // ADDENDUM: a hit into a Substitute.
      const sub = oh!.sub;
      if (sub && sub.mass > 0) {
        const as = ah.substitute;
        if (!as) push(`${slot}→${target}`, "hit.substitute", sub, "missing");
        else {
          if (!near(as.chance, sub.mass)) push(`${slot}→${target}`, "hit.substitute.chance", sub.mass, as.chance);
          if (as.min !== sub.takenMin || as.max !== sub.takenMax) push(`${slot}→${target}`, "hit.substitute.min/max", [sub.takenMin, sub.takenMax], [as.min, as.max]);
          if (!near(as.breaks, sub.breaks)) push(`${slot}→${target}`, "hit.substitute.breaks", sub.breaks, as.breaks);
        }
        const hurt = (o.change?.[target]?.min ?? 0) < 0;
        if (!hurt && ah.kind !== "substitute") push(`${slot}→${target}`, "hit.kind", "substitute", ah.kind, "every outcome met the Substitute");
        continue;
      }
      if (ah.substitute) push(`${slot}→${target}`, "hit.substitute", "none", ah.substitute);
      if (oh!.landed === 0) {
        const kind = immune ? "no-damage" : "blocked";
        if (ah.kind !== kind && !(ah.kind === "no-damage" && kind === "blocked")) push(`${slot}→${target}`, "hit.kind", kind, ah.kind);
      } else if (oh!.dmgMax !== null && oh!.dmgMax > 0) {
        if (ah.kind !== "calculated") push(`${slot}→${target}`, "hit.kind", "calculated", ah.kind);
        // A multi-hit move whose hits stopped at its target's knockout before the planned last hit (the oracle's
        // `truncated`: sim/battle-actions.ts:890-895 move.lastHit false) has Showdown's sum over the hits it dealt on that
        // path only; the app's hit is the move's calculation (shown with its hit count, as the 1v1 row), which must cover
        // every sum Showdown met.
        // status2 (integration 1a, W): a Berry its target ate between two hits changed the later hits (pairs.ts continueHits).
        const between = Object.keys(o.lines).some((l) => l.startsWith(`|-enditem|${IDENT[target]}: `) && /\|(Ganlon|Apicot|Starf|Lansat) Berry\|\[eat\]$/.test(l));
        if ((oh!.truncated ?? 0) > 0 || between) {
          if (ah.max === null || ah.max < oh!.dmgMax) push(`${slot}→${target}`, "hit.max", `≥ ${oh!.dmgMax}`, ah.max, between ? "a Berry between the hits: the calculations cover the sums dealt" : "hits stopped at the knockout: the calculation covers the hits dealt");
        } else if (!sampled) {
          if (ah.min !== oh!.dmgMin) push(`${slot}→${target}`, "hit.min", oh!.dmgMin, ah.min, "damage summed over the action's hits, uncapped");
          if (ah.max !== oh!.dmgMax) push(`${slot}→${target}`, "hit.max", oh!.dmgMax, ah.max, "damage summed over the action's hits, uncapped");
        }
      }
    }
    for (const [target, ah] of hits) if (!o.hits[target] && ah.reached > 0) push(`${slot}→${target}`, "hit.reached", 0, ah.reached);
  }
  compareCopies(oracle, result.steps, near, push, isStatus);
  // ADDENDUM: Ally Switch positions.
  const swapped = oracle.walks.all.swapped ?? {};
  for (const side of ["own", "opponent"] as const) {
    if (!near(result.swapped?.[side] ?? 0, swapped[side] ?? 0)) push("turn", `swapped.${side}`, swapped[side] ?? 0, result.swapped?.[side] ?? 0);
  }
  // Turn facts (SPEC §2.3, status-eot §2.5: the End-of-turn fact is removed).
  const facts = result.facts;
  const certainCrit = !!oracle && Object.values(oracle.walks.all.steps).some((step) => step && Object.values(step.effects ?? {}).some((effects) => effects && (effects as Record<string, number>).crit > 0));
  const want = c.field?.critical ? TURN_FACT_CRIT : certainCrit ? TURN_FACT_CERTAIN : TURN_FACT;
  if (!facts.includes(want)) push("turn", "facts", want, facts);
  if (oracle.walks.all.afterTurn && facts.includes(END_FACT) && result.endOfTurn?.status === "ready") push("turn", "facts", `no "${END_FACT}"`, facts);
  // status2 (ADDENDUM2 §2.5, C23): the fact only while a protecting or Endure user has no carried stall counter.
  // status2 integration 1b (M's ask): a Dynamaxed Pokémon's status move is Max Guard, a protecting move (ADDENDUM2 §2.5).
  const maxGuard = (slot: SlotId) => c.slots[slot].choice === "dynamax" && !!c.slots[slot].action.move && isStatus(toID(c.slots[slot].action.move!));
  const protects = SLOTS.some((slot) => !c.slots[slot].absent && (PROTECT_FAMILY.has((c.slots[slot].action.move ?? "").toLowerCase().replace(/[^a-z]/g, "")) || maxGuard(slot)) && !c.slots[slot].carried?.stall);
  if (protects !== facts.includes(PROTECT_FACT)) push("turn", "facts", protects ? PROTECT_FACT : `no "${PROTECT_FACT}"`, facts);
  const room = !!c.field?.trickRoom || SLOTS.some((slot) => (c.slots[slot].action.move ?? "") === "Trick Room");
  if (room !== facts.includes(TRICK_ROOM_FACT)) push("turn", "facts", room ? TRICK_ROOM_FACT : `no "${TRICK_ROOM_FACT}"`, facts);
  compareEndOfTurn(c, oracle, result, near, push, hpCheck);
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
  const said = result.facts.filter((f) => /^Assumes .+ comes in for .+\.$/.test(f));
  if (said.length !== chosen.size) push("turn", "facts (the default replacement)", `${chosen.size} "Assumes {Newcomer} comes in for {Name}." (${[...chosen].join(", ") || "none"})`, said);
}

const rangeText = (min: number, max: number) => (min === max ? `${min}` : `${min}–${max}`);
/** status2 wave 1b: the moves a calling move used (the oracle's usedmove:<called>:<caller> effect keys on its user). */
function calledMoves(o: StepResult, slot: SlotId): string[] {
  const out = new Set<string>();
  for (const k of Object.keys(o.effects?.[slot] ?? {})) {
    const m = /^usedmove:([a-z0-9]+):([a-z0-9]+)$/.exec(k);
    if (m && m[2] === o.moveId) out.add(m[1]);
  }
  return [...out];
}
/**
 * status2 wave 1b (T2P §2.3, §3.13): the copied uses. Each oracle copy (WalkResult.copies, "<kind>:<slot>:<move>") against the
 * app's steps with that `copied`, slot and move: the mass it moved, the mass it was stopped (picked − moved) against its skipped
 * facts, and each hit's reach, KO chance and damage range (a status copy: the reach). An app copy the oracle never had fails.
 */
function compareCopies(oracle: OracleResult, appSteps: DoublesStep[], near: Near, push: Push, isStatus: (moveId: string) => boolean) {
  const copies = oracle.walks.all.copies ?? {};
  const used = new Set<DoublesStep>();
  // Two copies of one move by one Pokémon (two dances copied): paired in turn order, the oracle's by its source's mean position.
  const meanPos = (slot: SlotId | undefined) => {
    const st = slot ? oracle.walks.all.steps[slot] : undefined;
    const total = st ? Object.values(st.orderAll).reduce((a, p) => a + p, 0) : 0;
    return st && total ? Object.entries(st.orderAll).reduce((a, [pos, p]) => a + Number(pos) * p, 0) / total : 0;
  };
  const ordered = Object.entries(copies).sort((a, b) => meanPos(a[1].source) - meanPos(b[1].source));
  for (const [key, o] of ordered) {
    const s = appSteps.find((x) => x.copied === o.copied && x.slot === o.slot && x.moveId === o.moveId && !used.has(x));
    const where = `${o.slot} (${o.copied} copy)`;
    if (!s) { if (o.picked > 1e-12) push(where, "step", key, "missing"); continue; }
    used.add(s);
    if (!near(s.moves, o.moved)) push(where, "step.moves", o.moved, s.moves);
    const skipped = s.skipped.reduce((sum, f) => sum + f.chance, 0);
    if (!near(skipped, o.picked - o.moved)) push(where, "step.skipped (total)", o.picked - o.moved, skipped, JSON.stringify(s.skipped));
    const hits = new Map<SlotId, DoublesHit>(s.hits.map((h) => [h.slot as SlotId, h]));
    for (const target of SLOTS) {
      const oh = o.hits[target], ah = hits.get(target);
      const reached = oh?.reached ?? 0;
      if (reached === 0) { if (ah && ah.reached > 0) push(`${where}→${target}`, "hit.reached", 0, ah.reached); continue; }
      // status2 integration 1b (CL's ask): a status copy's hit the app does not record (an instructed Helping Hand's ally) is
      // skipped, as compareStatusHits skips a status step's.
      if (!ah) { if (!isStatus(o.moveId)) push(`${where}→${target}`, "hit", `reached ${reached}`, "missing"); continue; }
      if (!near(ah.reached, reached)) push(`${where}→${target}`, "hit.reached", reached, ah.reached);
      if (isStatus(o.moveId)) continue;
      if (!near(ah.koChance, oh!.ko)) push(`${where}→${target}`, "hit.koChance", oh!.ko, ah.koChance);
      if (oh!.landed > 0 && oh!.dmgMax !== null && oh!.dmgMax > 0 && !oh!.sub) {
        if (ah.min !== oh!.dmgMin || ah.max !== oh!.dmgMax) push(`${where}→${target}`, "hit.min/max", [oh!.dmgMin, oh!.dmgMax], [ah.min, ah.max]);
      }
    }
  }
  for (const s of appSteps) if (s.copied && !used.has(s) && s.moves > 1e-12) push(`${s.slot} (${s.copied} copy)`, "step", "no such copy in Showdown", s.moveId);
}
/** The confusion self-hit of an action: its mass and damage range from the `damage:confusion:-N` keys on the actor. */
function selfHitOf(keys: Record<string, number>) {
  let mass = 0, min = Infinity, max = -Infinity;
  for (const [k, v] of Object.entries(keys)) {
    const m = /^damage:confusion:-(\d+)$/.exec(k);
    if (!m) continue;
    mass += v;
    min = Math.min(min, Number(m[1]));
    max = Math.max(max, Number(m[1]));
  }
  // status2 (integration 1a, S): a self-hit Disguise takes (damage:confusion:0 beside activate:disguise): no HP lost.
  const disguised = keys["activate:disguise"] ? keys["damage:confusion:0"] ?? 0 : 0;
  return { mass, min, max, disguised };
}
/** The self-hit facts Disguise took (doubles-faces.ts selfHit: "... hurts itself in confusion; Disguise takes the hit."). */
const disguiseSelfHit = (text: string) => /hurts itself in confusion; Disguise takes the hit/i.test(text);

type Push = (where: string, field: string, expected: unknown, got: unknown, note?: string) => void;
type Near = (a: number, b: number, tol?: number) => boolean;
const chanceOf = (facts: DoublesFact[], test: (text: string) => boolean) => facts.filter((f) => test(f.text)).reduce((s, f) => s + f.chance, 0);

/** EFFECT_FACTS: the oracle's effect lines of one action against the app step's facts. */
function compareEffects(slot: SlotId, o: StepResult, s: DoublesStep, near: Near, push: Push, status: boolean, c?: Case) {
  const hits = new Map(s.hits.filter((h) => !h.id).map((h) => [h.slot as SlotId, h]));
  // A move stopped at BeforeMove (SPEC §4.2) ↔ the skipped facts.
  for (const [key, mass] of Object.entries(o.effects?.[slot] ?? {})) {
    const cant = /^cant:(.+)$/.exec(key)?.[1];
    if (cant === "slp" && SLEEP_USABLE.has(o.moveId)) continue;
    if (cant && CANT_FACTS[cant]) {
      const got = chanceOf(s.skipped, (t) => CANT_FACTS[cant].test(t));
      if (!near(got, mass)) push(slot, `effect ${key} (skipped)`, mass, got, JSON.stringify(s.skipped));
    }
  }
  const selfHit = selfHitOf(o.effects?.[slot] ?? {});
  if (selfHit.mass > 0 && !o.selfHit) {
    const got = chanceOf(s.skipped, (t) => /hurts itself in confusion/i.test(t));
    if (!near(got, selfHit.mass)) push(slot, "effect confusion self-hit (skipped)", selfHit.mass, got, JSON.stringify(s.skipped));
    else if (!s.skipped.some((f) => /hurts itself in confusion/i.test(f.text) && f.text.includes(rangeText(selfHit.min, selfHit.max)))) push(slot, "effect confusion self-hit range", rangeText(selfHit.min, selfHit.max), s.skipped.map((f) => f.text));
  }
  if (!status || L_MOVES.has(o.moveId)) return;
  for (const target of SLOTS) {
    const keys = o.effects?.[target];
    if (!keys) continue;
    // status2: a copy of a rise (Opportunist, Mirror Herb: "Opportunist: {Name} copies +2 Attack.") is a step fact naming
    // its copier: it counts for the copier, not for the user's own stages.
    const copyFact = (t: string) => / copies [+−]/.test(t);
    // The copier's name ("Espathra (opponent's)", "Espathra (yours)" across sides) against the target's species and side.
    const species = c?.slots[target]?.species;
    const copiedBy = (t: string) => {
      const name = /: (.+?) copies [+−]/.exec(t)?.[1];
      if (!name || !species) return false;
      const side = /\((yours|opponent's)/.exec(name)?.[1];
      return name.split(" (")[0] === species && (!side || (side === "yours") === target.startsWith("own"));
    };
    // status2 wave 1b (FC, PR): a step fact "{Effect}: {Name} ±n {Stat}." about another Pokémon (Wind Rider, Room Service, a
    // Seed, Order Up, Battle Bond) counts for the Pokémon it names, as a copy fact does.
    const namedBy = (t: string) => {
      const name = /^[^:]+: (.+?) [+−]\d/.exec(t)?.[1];
      if (!name || !species || target === slot) return false;
      const side = /\((yours|opponent's)/.exec(name)?.[1];
      return name.split(" (")[0] === species && (!side || (side === "yours") === target.startsWith("own"));
    };
    // status2 integration 1b (FC's ask): a step fact in doubles-use.ts aboutSlot's forms ("{Name}'s {Effect}: …", "{Name} is …",
    // "{Name}: …") about a Pokémon with no hit entry in the step (a Seed used on a terrain, Room Service, Wind Rider) counts
    // for the Pokémon it names.
    const about = (t: string) => {
      if (!species || target === slot || hits.has(target)) return false;
      const m = /^(.+?)(?:'s | is |: )/.exec(t);
      if (!m) return false;
      const side = /\((yours|opponent's)/.exec(m[1])?.[1];
      return m[1].split(" (")[0] === species && (!side || (side === "yours") === target.startsWith("own"));
    };
    const facts = [
      ...(hits.get(target)?.facts ?? []), ...(target === slot ? s.facts.filter((f) => !copyFact(f.text)) : []),
      ...s.facts.filter((f) => copyFact(f.text) && copiedBy(f.text)),
      ...s.facts.filter((f) => !copyFact(f.text) && (namedBy(f.text) || about(f.text))),
    ];
    for (const [key, mass] of Object.entries(keys)) {
      let test: ((t: string) => boolean) | null = null;
      const st = /^status:(\w+)$/.exec(key);
      if (st && STATUS_GIVEN[st[1]]) test = (t) => t.toLowerCase().includes(STATUS_GIVEN[st[1]].toLowerCase());
      const bo = /^boost:(\w+):(-?\d+)$/.exec(key);
      if (bo && STAGE_NAMES[bo[1]] && Number(bo[2]) !== 0) test = (t) => t.includes(`${signed(Number(bo[2]))} ${STAGE_NAMES[bo[1]]}`);
      const sv = /^start:(\w+)$/.exec(key);
      if (sv && START_FACTS[sv[1]]) test = (t) => START_FACTS[sv[1]].test(t);
      if (!test) continue;
      const got = chanceOf(facts, test);
      if (!near(got, mass)) push(`${slot}→${target}`, `effect ${key}`, mass, got, JSON.stringify(facts.map((f) => `${f.text} (${+f.chance.toFixed(4)})`)));
    }
  }
}

/** A status move's hits (status-eot SPEC §7 step 5): reach, kind against reached/landed, `change` against the HP change. */
function compareStatusHits(slot: SlotId, o: StepResult, hits: Map<SlotId, DoublesHit>, near: Near, push: Push) {
  // A field-wide move (Perish Song, Haze: target "all") runs tryMoveHit, which has no per-target hit step to record.
  const stepped = Object.keys(o.hits).length > 0;
  for (const target of SLOTS) {
    const oh = o.hits[target], ah = hits.get(target);
    if (!ah) continue;
    const reached = oh?.reached ?? 0;
    if (stepped && !near(ah.reached, reached)) push(`${slot}→${target}`, "hit.reached (status)", reached, ah.reached);
    if (reached > 0 && oh) {
      const keys = Object.keys(o.effects?.[target] ?? {});
      const failed = keys.some((k) => /^(immune|fail|activate:(substitute|safeguard|mistyterrain|electricterrain|psychicterrain|protect|quickguard|wideguard|craftyshield)|block)/.test(k));
      if (oh.landed === 0 && !["blocked", "no-damage"].includes(ah.kind)) push(`${slot}→${target}`, "hit.kind (status)", "blocked or no-damage", ah.kind);
      if (oh.landed > 0 && !failed && !["effect", "no-damage", "blocked"].includes(ah.kind)) push(`${slot}→${target}`, "hit.kind (status)", "effect", ah.kind);
    }
    const ch = o.moveChange?.[target];
    if (ch) {
      if (!ah.change && (ch.min !== 0 || ch.max !== 0)) push(`${slot}→${target}`, "hit.change", { min: ch.min, max: ch.max }, "absent", "the move's own HP lines where it moved");
      else if (ah.change && (ah.change.min !== ch.min || ah.change.max !== ch.max)) push(`${slot}→${target}`, "hit.change", { min: ch.min, max: ch.max }, ah.change, "the move's own HP lines where it moved");
    } else if (o.moveChange && ah.change && (ah.change.min !== 0 || ah.change.max !== 0)) push(`${slot}→${target}`, "hit.change", "none", ah.change);
  }
}

const RESIDUAL_ALIASES: Record<string, string[]> = {
  brn: ["burn"], psn: ["poison", "badpoison", "toxic"], tox: ["badpoison", "toxic"], partiallytrapped: [],
  liquidooze: ["leechseed", "liquidooze"], sandstorm: ["sandstorm", "sand"], hail: ["hail"],
};
const residualMatches = (oracleName: string, app: DoublesResidual) => {
  const o = toID(oracleName), a = toID(app.effect);
  return o === a || (RESIDUAL_ALIASES[o] ?? []).includes(a) || a.includes(o) || o.includes(a);
};

/** The end of turn (SPEC §7 step 5): endOfTurn.hp, each residual, the end-of-turn reason. */
function compareEndOfTurn(c: Case, oracle: OracleResult, result: Extract<DoublesTurnResult, { status: "ready" }>, near: Near, push: Push, hpCheck: (where: string, e: Expected, hp: DoublesHP, n: number | undefined) => void) {
  const eot = result.endOfTurn;
  if (!eot) { push("endOfTurn", "endOfTurn", "a DoublesEndOfTurn", undefined); return; }
  if (c.endNotEstimated) {
    if (eot.status !== "not-estimated") push("endOfTurn", "status", "not-estimated", eot.status);
    else if (eot.reason !== c.endNotEstimated) push("endOfTurn", "reason", c.endNotEstimated, eot.reason);
    return;
  }
  if (!oracle.afterTurn) {
    // Paths without a residual (a switch request after the last action): the app must not estimate the end of turn.
    if (oracle.walks.all.afterTurn && oracle.walks.all.afterTurn.noResidual > 0 && eot.status === "ready") push("endOfTurn", "status", "not-estimated (a switch-out before the residual)", eot.status);
    return;
  }
  if (eot.status !== "ready") { push("endOfTurn", "status", "ready", eot.status, eot.reason); return; }
  for (const slot of SLOTS) {
    if (c.slots[slot].absent) continue;
    const hp = eot.hp[slot];
    if (!hp) { push(`endOfTurn ${slot}`, "hp", "a DoublesHP", null); continue; }
    hpCheck(`endOfTurn ${slot}`, oracle.afterTurn[slot], hp, oracle.walks.all.samples);
  }
  const used = new Set<number>();
  for (const r of oracle.residuals ?? []) {
    const sign = (x: number | null) => (x === null ? 0 : Math.sign(x));
    // status2 wave 2: a residual on a newcomer matches one with its id (DoublesResidual.id).
    const sameMon = (a: DoublesResidual) => a.slot === r.slot && (a.id ?? null) === (r.id ?? null);
    const candidates = eot.residuals.map((a, k) => ({ a, k })).filter(({ a, k }) => !used.has(k) && sameMon(a) && residualMatches(r.effect, a) && (r.other === undefined || a.other === undefined || a.other === r.other));
    const best = candidates.find(({ a }) => a.min === r.min && a.max === r.max) ?? candidates.find(({ a }) => sign(a.min) === sign(r.min)) ?? candidates[0];
    const i = best ? best.k : -1;
    const j = i >= 0 ? i : eot.residuals.findIndex((a, k) => !used.has(k) && sameMon(a) && a.min === r.min && a.max === r.max && near(a.chance, r.chance));
    // A status the residual gave (an Orb's, Yawn's sleep: status-eot FINAL), which changes no HP.
    const given = Object.entries(r.facts ?? {}).filter(([k, mass]) => mass > 0 && STATUS_GIVEN[/^status:(\w+)$/.exec(k)?.[1] ?? ""]);
    if (j < 0) {
      if (r.min !== null || r.koChance > 0 || given.length) push(`endOfTurn ${r.slot}${r.id ? `|${r.id}` : ""}`, `residual ${r.effect}`, residualText(r), "missing", JSON.stringify(eot.residuals.filter((a) => a.slot === r.slot).map((a) => `${a.id ? `${a.id} ` : ""}${a.effect} ${a.chance} ${a.min}..${a.max}`)));
      continue;
    }
    used.add(j);
    const a = eot.residuals[j];
    // status2 (integration 1a): the app splits a line with no HP change by its source (Pickup's `other`); the oracle's has none.
    let chance = a.chance;
    if (r.other === undefined && r.min === null && a.min === null && a.other !== undefined) {
      eot.residuals.forEach((b, k) => {
        if (!used.has(k) && b.slot === r.slot && b.min === null && b.other !== undefined && residualMatches(r.effect, b)) { used.add(k); chance += b.chance; }
      });
    }
    if (!near(chance, r.chance)) push(`endOfTurn ${r.slot}`, `residual ${r.effect}.chance`, r.chance, chance);
    if (a.min !== r.min || a.max !== r.max) push(`endOfTurn ${r.slot}`, `residual ${r.effect}.min/max`, [r.min, r.max], [a.min, a.max]);
    if (!near(a.koChance, r.koChance)) push(`endOfTurn ${r.slot}`, `residual ${r.effect}.koChance`, r.koChance, a.koChance);
    for (const [k, mass] of given) {
      const text = STATUS_GIVEN[k.slice("status:".length)];
      const got = chanceOf(a.facts, (t) => t === text);
      if (!near(got, mass)) push(`endOfTurn ${r.slot}`, `residual ${r.effect} ${k}`, mass, got, JSON.stringify(a.facts));
    }
  }
  eot.residuals.forEach((a, k) => {
    if (!used.has(k) && a.min !== null && (a.min !== 0 || a.max !== 0)) push(`endOfTurn ${a.slot}`, `residual ${a.effect}`, "none in Showdown", `${a.chance} ${a.min}..${a.max}`);
  });
}
const residualText = (r: ResidualResult) => `${r.effect} ${+r.chance.toFixed(6)} ${r.min}..${r.max} ko ${+r.koChance.toFixed(6)}`;

const SD_WEATHER: Record<string, string> = { "": "", sunnyday: "Sun", raindance: "Rain", sandstorm: "Sand", snowscape: "Snow", hail: "Hail", desolateland: "Harsh Sunshine", primordialsea: "Heavy Rain", deltastream: "Strong Winds" };
/** E2 (ADDENDUM §7.1): the outcomes' mixtures against the oracle's after the turn (or after the moves when not applied). */
function compareOutcomes(c: Case, oracle: OracleResult, given: DoublesOutcomesResult | null | undefined, near: Near, push: Push) {
  if (!given) { push("E2", "result", "a DoublesOutcomesResult", given ?? null); return; }
  if (given.status !== "ready") { push("E2", "status", "ready", given.status, given.status === "not-estimated" ? given.reason : undefined); return; }
  // status2 wave 2: with a bench, each slot is compared as its starting Pokémon (identityOutcomes), and the newcomers apart.
  const outcomes: ReadyOutcomes = hasBench(c) ? identityOutcomes(given, push) : given;
  const applied = outcomes.endOfTurn === "applied";
  if (hasBench(c)) compareOutcomeNewcomers(c, oracle, given, applied, near, push);
  const slotsOf = applied ? oracle.walks.all.afterTurn?.slots : oracle.walks.all.slots;
  if (!slotsOf) return;
  for (const slot of SLOTS) {
    if (c.slots[slot].absent) continue;
    const o = slotsOf[slot];
    const hp = new Map<number, number>(), item = new Map<string, number>(), sub = new Map<number, number>(), vol = new Map<string, number>();
    let swappedMass = 0;
    for (const oc of outcomes.outcomes) {
      const m = oc.mons[slot];
      if (!m) continue;
      for (const h of m.hp) hp.set(h.hp, (hp.get(h.hp) ?? 0) + oc.chance * h.chance);
      item.set(m.build.itemId ?? "", (item.get(m.build.itemId ?? "") ?? 0) + oc.chance);
      for (const s of m.substitute ?? []) sub.set(s.hp, (sub.get(s.hp) ?? 0) + oc.chance * s.chance);
      for (const v of m.volatiles ?? []) vol.set(v, (vol.get(v) ?? 0) + oc.chance);
      const side = slot.startsWith("own") ? "own" : "opponent";
      if (oc.positions?.[side] === "swapped") swappedMass += oc.chance;
    }
    // The status of a Pokémon that never faints (status-eot FINAL: an Orb's or Yawn's status at the end of turn, a status
    // move's), against each outcome's build.status. Where it can faint the oracle's mixture is not split by HP ("fnt", or
    // the status it had when the battle ended), so it is not compared.
    if (o.status && o.koChance === 0) {
      const status = new Map<string, number>();
      for (const oc of outcomes.outcomes) {
        const m = oc.mons[slot];
        if (m) status.set(m.build.status ?? "", (status.get(m.build.status ?? "") ?? 0) + oc.chance);
      }
      for (const k of new Set([...Object.keys(o.status), ...status.keys()])) {
        if (!near(status.get(k) ?? 0, o.status[k] ?? 0)) push(`E2 ${slot}`, `status ${k || "(none)"}`, o.status[k] ?? 0, status.get(k) ?? 0);
      }
    }
    for (const [h, p] of o.dist) if (!near(hp.get(h) ?? 0, p)) push(`E2 ${slot}`, `hp ${h}`, p, hp.get(h) ?? 0);
    for (const [h, p] of hp) if (p > 1e-12 && !o.dist.some(([x]) => x === h)) push(`E2 ${slot}`, `hp ${h}`, 0, p);
    for (const [k, p] of Object.entries(o.item ?? {})) if (!near(item.get(k) ?? 0, p)) push(`E2 ${slot}`, `item ${k || "(none)"}`, p, item.get(k) ?? 0);
    for (const [h, p] of o.sub ?? []) if (!near(sub.get(h) ?? 0, p)) push(`E2 ${slot}`, `substitute ${h}`, p, sub.get(h) ?? 0);
    for (const v of ["confusion", "taunt", "encore", "yawn", "leechseed", "perishsong", "substitute", "curse", "saltcure", "aquaring", "ingrain", "partiallytrapped", "allyswitch"]) {
      // After the moves (end of turn not applied) E2 lists the volatiles the next turn reads (doubles-eot.ts outcomeMon, which
      // Training's postFromOutcome projects forward): a Yawn carried into this turn resolves at its end, so it is not listed,
      // while Showdown's state after the moves still has it (this turn's Yawn fails on a drowsy Pokémon: data/moves.ts yawn).
      const p = !applied && v === "yawn" && c.slots[slot].carried?.yawn ? 0 : o.volatiles?.[v] ?? 0;
      if (!near(vol.get(v) ?? 0, p)) push(`E2 ${slot}`, `volatile ${v}`, p, vol.get(v) ?? 0);
    }
    if (!near(swappedMass, o.swapped ?? 0)) push(`E2 ${slot}`, "positions swapped", o.swapped ?? 0, swappedMass);
    // Perish counts and the sleep counter (E2 perishCount, sleepTurns: the expected remaining counter while asleep).
    const perish = new Map<string, number>();
    let asleep = 0, sleepSum = 0;
    for (const oc of outcomes.outcomes) {
      const m = oc.mons[slot];
      if (!m) continue;
      if (m.perishCount !== undefined) perish.set(String(m.perishCount), (perish.get(String(m.perishCount)) ?? 0) + oc.chance);
      if (m.build.status === "slp" && m.sleepTurns !== undefined) { asleep += oc.chance; sleepSum += oc.chance * m.sleepTurns; }
    }
    for (const [k, p] of Object.entries(o.perish ?? {})) if (!near(perish.get(k) ?? 0, p)) push(`E2 ${slot}`, `perishCount ${k}`, p, perish.get(k) ?? 0);
    // The stages the turn leaves (Speed Boost, Syrup Bomb, Soul-Heart, Agility...), from the build. status2 (SPEC2 §7.1,
    // Step 1's finding): both ways, and accuracy and evasion (DoublesOutcomeMon.stages): a stage the app gives and the
    // oracle does not is a mismatch too.
    const stageOf = (m: NonNullable<DoublesOutcomesResult & { status: "ready" }>["outcomes"][number]["mons"][SlotId], stat: string): number =>
      stat === "accuracy" || stat === "evasion" ? (m!.stages?.[stat] ?? 0) : ((m!.build.boosts as Record<string, number | undefined>)[stat] ?? 0);
    for (const stat of ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"]) {
      const values = new Set<number>([0]);
      for (const k of Object.keys(o.boosts ?? {})) if (k.split(":")[0] === stat) values.add(Number(k.split(":")[1]));
      // A stage only the app gives, where the Pokémon never faints (Showdown clears a fainted Pokémon's stages, and the
      // oracle's mixture is not split by HP; a world's build keeps them).
      if (o.koChance === 0) for (const oc of outcomes.outcomes) if (oc.mons[slot]) values.add(stageOf(oc.mons[slot], stat));
      for (const n of values) {
        if (n === 0) continue;
        const want = o.boosts?.[`${stat}:${n}`] ?? 0;
        // status2 (integration 1a): the living share of each outcome (a fainted Pokémon's stages are cleared in Showdown).
        const living = (m: NonNullable<typeof outcomes.outcomes[number]["mons"][SlotId]>) => m.hp.reduce((x, h) => x + (h.hp > 0 ? h.chance : 0), 0);
        const got = outcomes.outcomes.reduce((x, oc) => x + (oc.mons[slot] && stageOf(oc.mons[slot], stat) === n ? oc.chance * living(oc.mons[slot]!) : 0), 0);
        if (!near(got, want)) push(`E2 ${slot}`, `stage ${stat}:${n}`, want, got);
      }
    }
    compareOutcomeState2(c, slot, o, outcomes, near, push);
    const oracleAsleep = Object.values(o.sleepTime ?? {}).reduce((x, p) => x + p, 0);
    if (oracleAsleep > 0) {
      const mean = Object.entries(o.sleepTime ?? {}).reduce((x, [t, p]) => x + Number(t) * p, 0) / oracleAsleep;
      if (!near(asleep, oracleAsleep)) push(`E2 ${slot}`, "asleep (sleepTurns given)", oracleAsleep, asleep);
      else if (Math.abs(sleepSum / asleep - mean) > 1e-6) push(`E2 ${slot}`, "sleepTurns (mean while asleep)", mean, sleepSum / asleep, "Showdown statusState.time after the turn");
    }
  }
  // The weather after the turn (a Desolate Land holder fainting in the residual ends the harsh sunshine).
  if (applied) {
    for (const [k, p] of Object.entries(oracle.walks.all.afterTurn?.field ?? {})) {
      const m = /^weather:(.*)$/.exec(k);
      if (!m) continue;
      const got = outcomes.outcomes.reduce((x, oc) => x + ((oc.field.weather ?? "") === (SD_WEATHER[m[1]] ?? m[1]) ? oc.chance : 0), 0);
      if (!near(got, p)) push("E2 field", `weather ${SD_WEATHER[m[1]] || "(none)"}`, p, got);
    }
  }
  // Hazards that landed this turn (E2 sides.hazards; Magic Bounce sends them back), and status2 Step 1 #7's pre-turn ones
  // (case field.{side}.hazards): standing on a side where its hazardsFrom is not null (absent: its own; else that side's).
  const sides = oracle.walks.all.sideConditions ?? {};
  const before = (side: "own" | "opponent") => c.field?.[side]?.hazards ?? [];
  const standing = (oc: DoublesOutcomesResult["outcomes"][number], side: "own" | "opponent", hazard: string) => {
    if (oc.sides[side].hazards?.includes(hazard)) return true;
    const from = oc.sides[side].hazardsFrom === undefined ? side : oc.sides[side].hazardsFrom;
    return from !== null && before(from).includes(hazard);
  };
  for (const side of ["own", "opponent"] as const) {
    for (const hazard of ["stealthrock", "spikes", "toxicspikes", "stickyweb"]) {
      const p = sides[side]?.[hazard] ?? 0;
      const got = outcomes.outcomes.reduce((x, oc) => x + (standing(oc, side, hazard) ? oc.chance : 0), 0);
      if (!near(got, p)) push(`E2 ${side}`, `hazard ${hazard}`, p, got);
    }
    const safeguard = sides[side]?.safeguard ?? 0;
    const got = outcomes.outcomes.reduce((x, oc) => x + (oc.sides[side].safeguard ? oc.chance : 0), 0);
    if (!near(got, safeguard)) push(`E2 ${side}`, "safeguard", safeguard, got);
  }
  // status2 wave 1b: results that record the 1b fields (charging is written for every slot then).
  if (applied && oracle.walks.all.afterTurn && SLOTS.some((slot) => oracle.walks.all.slots[slot].charging)) compareSides1b(oracle, outcomes, near, push, (oc, side, id) => standing(oc, side, id));
}

type ReadyOutcomes = Extract<DoublesOutcomesResult, { status: "ready" }>;
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
      const hp = new Map<number, number>(), item = new Map<string, number>(), status = new Map<string, number>(), boosts = new Map<string, number>(), vols = new Map<string, number>();
      let mass = 0;
      const bump = (m: Map<string, number>, k: string, p: number) => m.set(k, (m.get(k) ?? 0) + p);
      for (const oc of r.outcomes) {
        const m = monOf(oc, slot, id);
        if (!m) continue;
        mass += oc.chance;
        for (const h of m.hp) hp.set(h.hp, (hp.get(h.hp) ?? 0) + oc.chance * h.chance);
        bump(item, m.build.itemId ?? "", oc.chance);
        bump(status, m.build.status ?? "", oc.chance);
        for (const [stat, n] of Object.entries(m.build.boosts ?? {})) if (n) bump(boosts, `${stat}:${n}`, oc.chance);
        for (const [stat, n] of Object.entries(m.stages ?? {})) if (n) bump(boosts, `${stat}:${n}`, oc.chance);
        for (const v of m.volatiles ?? []) bump(vols, v, oc.chance);
      }
      const where = `E2 ${slot}|${id}`;
      if (!near(mass, e.chance)) push(where, "came in", e.chance, mass);
      for (const [h, p] of e.dist) if (!near(hp.get(h) ?? 0, p * e.chance)) push(where, `hp ${h}`, p * e.chance, hp.get(h) ?? 0);
      for (const [h, p] of hp) if (p > 1e-12 && !e.dist.some(([x]) => x === h)) push(where, `hp ${h}`, 0, p);
      for (const [k, p] of Object.entries(e.item ?? {})) if (!near(item.get(k) ?? 0, p)) push(where, `item ${k || "(none)"}`, p, item.get(k) ?? 0);
      // Where it never faints (the oracle's mixtures are not split by HP): its status, stages (Baton Pass, Sticky Web) and volatiles.
      if (e.koChance === 0) {
        for (const k of new Set([...Object.keys(e.status ?? {}), ...status.keys()])) if (!near(status.get(k) ?? 0, e.status?.[k] ?? 0)) push(where, `status ${k || "(none)"}`, e.status?.[k] ?? 0, status.get(k) ?? 0);
        for (const k of new Set([...Object.keys(e.boosts ?? {}), ...boosts.keys()])) if (!near(boosts.get(k) ?? 0, e.boosts?.[k] ?? 0)) push(where, `stage ${k}`, e.boosts?.[k] ?? 0, boosts.get(k) ?? 0);
        for (const v of ["confusion", "taunt", "encore", "yawn", "leechseed", "perishsong", "substitute", "curse", "saltcure", "aquaring", "ingrain", "partiallytrapped", "focusenergy", "magnetrise"]) {
          if (!near(vols.get(v) ?? 0, e.volatiles?.[v] ?? 0)) push(where, `volatile ${v}`, e.volatiles?.[v] ?? 0, vols.get(v) ?? 0);
        }
      }
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
}
/** status2's volatile ids E2 lists (DoublesOutcomeMon.volatiles, SPEC2 §3.1, ADDENDUM2 §3.1), compared where the oracle result is fresh. */
const STATUS2_VOLATILES = ["stockpile", "powertrick", "powershift", "noretreat", "minimize", "gastroacid", "transform", "trapped", "twoturnmove",
  "attract", "octolock", "tarshot", "foresight", "miracleeye", "telekinesis", "embargo", "nightmare", "glaiverush", "healblock", "lockon"];
/**
 * status2 wave 1b (ADDENDUM2 §3.1, §7.1): the volatiles E2 gains in 1b (the hidden move's id beside "twoturnmove", Sky Drop,
 * Uproar, Chi Strike, Commander, Bide, Disable while turns are left), compared where the oracle result records the 1b fields.
 */
const STATUS2_VOLATILES_1B = ["fly", "bounce", "dig", "dive", "phantomforce", "shadowforce", "skydrop", "uproar", "gmaxchistrike", "commanding", "commanded", "bide", "disable"];
/**
 * status2 wave 1a (SPEC2 §7.1, ADDENDUM2 §7.1): E2's new per-Pokémon fields against the oracle's mixtures, only where the
 * oracle result records them (results written by this harness: `types` present). Ability, species, types (buildTypes),
 * stored stats, weight, Stockpile, the last item (where the app tracks it), turns left, a pending copy, the Berry lock, the
 * new volatile ids.
 */
function compareOutcomeState2(c: Case, slot: SlotId, o: SlotResult, outcomes: ReadyOutcomes, near: Near, push: Push) {
  if (!o.types) return;
  const mixture = (f: (m: NonNullable<ReadyOutcomes["outcomes"][number]["mons"][SlotId]>) => string | null) => {
    const out = new Map<string, number>();
    for (const oc of outcomes.outcomes) {
      const m = oc.mons[slot];
      if (!m) continue;
      const k = f(m);
      if (k === null) continue;
      out.set(k, (out.get(k) ?? 0) + oc.chance);
    }
    return out;
  };
  const check = (label: string, want: Record<string, number>, got: Map<string, number>, keyOf: (k: string) => string = (k) => k) => {
    const wanted = new Map<string, number>();
    for (const [k, p] of Object.entries(want)) wanted.set(keyOf(k), (wanted.get(keyOf(k)) ?? 0) + p);
    for (const k of new Set([...wanted.keys(), ...got.keys()])) if (!near(got.get(k) ?? 0, wanted.get(k) ?? 0)) push(`E2 ${slot}`, `${label} ${k || "(none)"}`, wanted.get(k) ?? 0, got.get(k) ?? 0);
  };
  const runtime = runtimes.get(c.game);
  // A fainted Pokémon's state is not compared (the oracle's mixture is not split by HP).
  if (o.koChance > 0) return;
  check("ability", o.ability ?? {}, mixture((m) => m.build.abilityId ?? ""), toID);
  check("species", o.forme ?? {}, mixture((m) => toID(m.build.speciesId)), toID);
  if (runtime) check("types", o.types ?? {}, mixture((m) => buildTypes(m.build, runtime).join("/")));
  else if (!warnedRuntimes) { warnedRuntimes = true; console.log("compare.ts: E2 types not compared (call loadRuntimes() first)"); }
  if (o.stockpile && Object.keys(o.stockpile).length) check("stockpile", o.stockpile, mixture((m) => (m.stockpile ? `${m.stockpile.layers}:${m.stockpile.def}:${m.stockpile.spd}` : null)));
  else if (outcomes.outcomes.some((oc) => oc.mons[slot]?.stockpile)) push(`E2 ${slot}`, "stockpile", "none", "a Stockpile");
  const stored = Object.keys(o.stored ?? {});
  if (stored.length === 1 && outcomes.outcomes.some((oc) => oc.mons[slot]?.build.storedStats)) {
    check("storedStats", o.stored!, mixture((m) => (m.build.storedStats ? ["atk", "def", "spa", "spd", "spe"].map((k) => (m.build.storedStats as Record<string, number>)[k]).join("/") : stored[0])));
  }
  // The last item: only where the app reports one (DoublesOutcomeMon.lastItem: only when tracked).
  if (outcomes.outcomes.some((oc) => oc.mons[slot]?.lastItem !== undefined)) check("lastItem", o.lastItem ?? {}, mixture((m) => m.lastItem ?? ""));
  // Turns left (after the countdown): the oracle's durations of the counted volatiles.
  // status2 wave 1b: Uproar's turns left too, where the oracle result records the 1b fields.
  for (const v of (o.charging ? ["healblock", "embargo", "telekinesis", "taunt", "encore", "disable", "uproar"] as const : ["healblock", "embargo", "telekinesis", "taunt", "encore", "disable"] as const)) {
    const want: Record<string, number> = {};
    for (const [k, p] of Object.entries(o.durations ?? {}) as [string, number][]) if (k.startsWith(`${v}:`)) want[k.split(":")[1]] = p;
    const got = mixture((m) => (m.turnsLeft?.[v] !== undefined ? String(m.turnsLeft[v]) : null));
    if (Object.keys(want).length || got.size) check(`turnsLeft.${v}`, want, got);
  }
  if (o.pendingCopy && Object.keys(o.pendingCopy).length || outcomes.outcomes.some((oc) => oc.mons[slot]?.pendingCopy)) {
    check("pendingCopy", o.pendingCopy ?? {}, mixture((m) => {
      const parts = Object.entries(m.pendingCopy ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).sort();
      return parts.length ? parts.join(",") : null;
    }));
  }
  const locked = outcomes.outcomes.reduce((x, oc) => x + (oc.mons[slot]?.berryLocked ? oc.chance : 0), 0);
  if (!near(locked, o.berryLocked ?? 0)) push(`E2 ${slot}`, "berryLocked", o.berryLocked ?? 0, locked);
  for (const v of STATUS2_VOLATILES) {
    const p = o.volatiles?.[v] ?? 0;
    const got = outcomes.outcomes.reduce((x, oc) => x + (oc.mons[slot]?.volatiles?.includes(v) ? oc.chance : 0), 0);
    if (!near(got, p)) push(`E2 ${slot}`, `volatile ${v}`, p, got);
  }
  // status2 wave 1b (oracle results that record charging, Cud Chew, the once-a-battle flags and Chi Strike).
  if (!o.charging) return;
  for (const v of STATUS2_VOLATILES_1B) {
    const p = o.volatiles?.[v] ?? 0;
    const got = outcomes.outcomes.reduce((x, oc) => x + (oc.mons[slot]?.volatiles?.includes(v) ? oc.chance : 0), 0);
    if (!near(got, p)) push(`E2 ${slot}`, `volatile ${v}`, p, got);
  }
  check("charging", o.charging, mixture((m) => m.charging ?? null));
  // Cud Chew: a Berry still due after the turn (its counter 1); the oracle key is "<berry>:<counter>".
  check("cudChew", o.cudChew ?? {}, mixture((m) => m.cudChew ?? null), (k) => k.split(":")[0]);
  const ORDER = ["battlebond", "intrepidsword", "dauntlessshield", "supersweetsyrup"];
  // Generation 9's flags only (ADDENDUM2 §3.1, C22: USUM's Battle Bond is the Ash form the species shows).
  if (c.game === "sv" || c.game === "champions") check("onceUsed", o.onceUsed ?? {}, mixture((m) => (m.onceUsed?.length ? [...m.onceUsed].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join(",") : null)));
  check("chiStrike", o.chiStrike ?? {}, mixture((m) => (m.chiStrike ? String(m.chiStrike) : null)));
}
/** status2 wave 1b: the Pledges' and G-Max side conditions after the turn (E2 sides.pledge turns left, sides.gmax), when applied. */
/**
 * `preTurn`: a side condition from before the turn standing now (status2 wave 2: a pre-turn G-Max Steelsurge of the input's
 * hazards, which E2 may report through hazardsFrom as the other hazards, or in sides.gmax).
 */
function compareSides1b(oracle: OracleResult, outcomes: ReadyOutcomes, near: Near, push: Push, preTurn: (oc: ReadyOutcomes["outcomes"][number], side: "own" | "opponent", id: string) => boolean = () => false) {
  const sides = oracle.walks.all.afterTurn?.sides ?? {};
  const PLEDGE: Record<string, "fire" | "grass" | "water"> = { firepledge: "fire", grasspledge: "grass", waterpledge: "water" };
  for (const side of ["own", "opponent"] as const) {
    for (const [id, kind] of Object.entries(PLEDGE)) {
      const want = new Map<string, number>();
      for (const [k, p] of Object.entries(sides)) {
        const m = new RegExp(`^${side}\\|${id}:(.+)$`).exec(k);
        if (m) want.set(m[1], (want.get(m[1]) ?? 0) + p);
      }
      const got = new Map<string, number>();
      for (const oc of outcomes.outcomes) {
        const n = oc.sides[side].pledge?.[kind];
        if (n !== undefined) got.set(String(n), (got.get(String(n)) ?? 0) + oc.chance);
      }
      for (const k of new Set([...want.keys(), ...got.keys()])) if (!near(got.get(k) ?? 0, want.get(k) ?? 0)) push(`E2 ${side}`, `pledge ${kind} ${k}`, want.get(k) ?? 0, got.get(k) ?? 0);
    }
    for (const id of ["gmaxvinelash", "gmaxwildfire", "gmaxcannonade", "gmaxvolcalith", "gmaxsteelsurge"]) {
      const want = Object.entries(sides).reduce((x, [k, p]) => x + (k.startsWith(`${side}|${id}:`) ? p : 0), 0);
      const got = outcomes.outcomes.reduce((x, oc) => x + (oc.sides[side].gmax?.includes(id) || (id === "gmaxsteelsurge" && preTurn(oc, side, id)) ? oc.chance : 0), 0);
      if (!near(got, want)) push(`E2 ${side}`, `gmax ${id}`, want, got);
    }
  }
}
const runtimes = new Map<string, BattleRuntime>();
let warnedRuntimes = false;
/** Loads the four runtimes once (compareOutcomeState2's buildTypes). */
export async function loadRuntimes() {
  for (const game of ["sv", "swsh", "usum", "champions"] as const) if (!runtimes.has(game)) runtimes.set(game, await runtimeFor({ game } as Case));
}

export function readOracle(id: string): OracleResult | null {
  const file = path.join(RESULTS_DIR, `${id}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as OracleResult : null;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("verify/compare.ts")) {
  (async () => {
    const args = process.argv.slice(2);
    const ids = args.filter((a) => !a.startsWith("--"));
    const write = !args.includes("--no-write");
    const exact = args.includes("--exact");
    const report: { id: string; status: string; ms: number; mismatches: Mismatch[]; error?: string }[] = [];
    await loadRuntimes();
    fs.mkdirSync(APP_RESULTS_DIR, { recursive: true });
    for (const c of CASES) {
      if (ids.length && !ids.some((id) => (exact ? c.id === id : c.id.startsWith(id)))) continue;
      const oracle = readOracle(c.id);
      const app = await appTurn(c);
      if (write) fs.writeFileSync(path.join(APP_RESULTS_DIR, `${c.id}.json`), JSON.stringify(app, null, 1));
      if (app.error) {
        report.push({ id: c.id, status: "error", ms: app.ms, mismatches: [], error: app.error.split("\n").slice(0, 3).join(" ") });
        console.log(`${c.id}: ERROR ${app.error.split("\n")[0]}`);
        continue;
      }
      const runtime = await runtimeFor(c);
      const mismatches = compareCase(c, oracle, app.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status", app.outcomes);
      report.push({ id: c.id, status: app.result?.status ?? "none", ms: app.ms, mismatches });
      console.log(`${c.id}: ${app.result?.status} ${app.ms.toFixed(1)} ms, ${mismatches.length ? `${mismatches.length} mismatches` : "match"}`);
      for (const m of mismatches) console.log(`   ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
    }
    if (write) fs.writeFileSync(path.join(RESULTS_DIR, ids.length ? "compare-partial.json" : "compare.json"), JSON.stringify(report, null, 1));
    const bad = report.filter((r) => r.status === "error" || r.mismatches.length);
    console.log(`\n${report.length - bad.length}/${report.length} cases match.`);
  })();
}
