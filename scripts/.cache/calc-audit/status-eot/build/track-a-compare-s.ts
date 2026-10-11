// Track A: the app's turn (calculateDoublesTurn) against Track D's oracle results for the S cases (2v2/verify/cases-s.ts,
// results/<id>.json), with the old compare.ts field checks (HP after the moves, steps, order, skips, damaging hits) plus the
// status-eot fields the app has: each slot's status mass after the moves, each status move's per-target effect lines
// (status:*, start:confusion), and its HP change. The status-eot mapping of the case's new fields (carried, moves,
// lastMove, canSwitch, weatherTurns, substitute) is this script's own until Track D's app-turn.ts maps them.
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/track-a-compare-s.ts [S01 ...]
import fs from "node:fs";
import path from "node:path";
import type { DoublesCarried, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { SLOTS, toID, type Case } from "../../2v2/verify/case-types";
import { caseInput, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase, readOracle, type Mismatch } from "../../2v2/verify/compare";
import { S_CASES } from "../../2v2/verify/cases-s";
import { oracle as runOracle } from "../../2v2/verify/sim-dfs";
import { TRACK_A_CASES } from "./track-a-cases";
import type { OracleResult } from "../../2v2/verify/case-types";

const EXTRA_DIR = path.resolve("scripts/.cache/calc-audit/status-eot/build/track-a-results");
/** Track A's own cases: the oracle computed once and kept in build/track-a-results (--fresh recomputes). */
function extraOracle(c: Case, fresh: boolean): OracleResult {
  const file = path.join(EXTRA_DIR, `${c.id}.json`);
  if (!fresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as OracleResult;
  const r = runOracle(c);
  fs.mkdirSync(EXTRA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(r, null, 1));
  return r;
}

export function statusInput(c: Case, input: DoublesTurnInput): DoublesTurnInput {
  const pokemon = { ...input.pokemon };
  for (const slot of SLOTS) {
    const m = c.slots[slot];
    const entry = pokemon[slot];
    if (!entry || m.absent) continue;
    const carried: DoublesCarried = {};
    const from = m.carried ?? {};
    for (const [key, value] of Object.entries(from)) {
      if (key === "trap") { const trap = value as { source: DoublesSlotId; bindingBand: boolean }; carried.trap = { source: trap.source, bindingBand: trap.bindingBand }; }
      else (carried as Record<string, unknown>)[key] = value;
    }
    if (m.substitute !== undefined) carried.substitute = m.substitute;
    const own = m.action.move === null ? [] : [toID(m.action.move)];
    // The app's choice: no target for a move whose rule is not "choose" (Aromatic Mist, Dragon Cheer, Uproar); a non-Ghost
    // Curse is the user's own (doubles-targets.ts reads Curse's dex target: a foe stands in until it reads the user's type).
    let action = entry.action;
    if (action.moveId) {
      const rule = doublesTargetRule(input, slot as DoublesSlotId, action.moveId);
      if (rule.kind !== "choose" && action.target) action = { ...action, target: null };
      if (rule.kind === "choose" && !action.target && action.moveId === "curse") action = { ...action, target: rule.options[0] };
    }
    pokemon[slot] = {
      ...entry, action, ...(Object.keys(carried).length ? { carried } : {}),
      ...(m.moves ? { moves: [...new Set([...m.moves.map(toID), ...own])] } : {}),
      ...(m.lastMove !== undefined ? { lastMove: m.lastMove === null ? null : toID(m.lastMove) } : {}),
    };
  }
  return { ...input, pokemon, ...(c.weatherTurns !== undefined ? { weatherTurns: c.weatherTurns } : {}), ...(c.canSwitch ? { canSwitch: c.canSwitch } : {}) };
}

/** The app's per-slot status after the moves, from its condition facts and the start status. */
function appStatus(c: Case, result: Extract<DoublesTurnResult, { status: "ready" }>, slot: (typeof SLOTS)[number]): Record<string, number> {
  const start = c.slots[slot].status ?? "";
  const words: Record<string, string> = { "Asleep.": "slp", "Paralysed.": "par", "Burned.": "brn", "Poisoned.": "psn", "Badly poisoned.": "tox", "Frozen.": "frz", "Status cured.": "" };
  const out: Record<string, number> = {};
  let changed = 0;
  for (const fact of result.hp[slot]?.conditions ?? []) {
    if (!(fact.text in words)) continue;
    out[words[fact.text]] = (out[words[fact.text]] ?? 0) + fact.chance;
    changed += fact.chance;
  }
  if (changed < 1 - 1e-9) out[start] = (out[start] ?? 0) + 1 - changed;
  return out;
}

const STAT_KEYS: Record<string, string> = { Attack: "atk", Defense: "def", "Sp. Atk": "spa", "Sp. Def": "spd", Speed: "spe", accuracy: "accuracy", evasion: "evasion" };
const STATUS_KEYS: Record<string, string> = { "Falls asleep.": "slp", "Is paralysed.": "par", "Is burned.": "brn", "Is poisoned.": "psn", "Is badly poisoned.": "tox", "Is frozen.": "frz" };
/** The oracle's effect key of one of the app's hit facts (doubles-status.ts texts), or null. */
function factKey(text: string): string | null {
  const plain = text.replace(/^[A-Z][\w' .-]*: (?=[+−]\d)/, "");
  const stage = /^([+−])(\d+) (Attack|Defense|Sp\. Atk|Sp\. Def|Speed|accuracy|evasion)\.$/.exec(plain);
  if (stage) return `boost:${STAT_KEYS[stage[3]]}:${stage[1] === "+" ? "" : "-"}${stage[2]}`;
  const none = /^Its (Attack|Defense|Sp\. Atk|Sp\. Def|Speed|accuracy|evasion) cannot go (higher|lower)\.$/.exec(text);
  if (none) return `boost:${STAT_KEYS[none[1]]}:0`;
  const set = /^Attack ([+−])(\d+) \(Belly Drum\)\.$/.exec(text);
  if (set) return `setboost:atk:${set[1] === "+" ? "" : "-"}${set[2]}`;
  if (STATUS_KEYS[text]) return `status:${STATUS_KEYS[text]}`;
  const synchronize = /^Synchronize: .* is (paralysed|burned|poisoned|badly poisoned) too\.$/.exec(text);
  if (synchronize) return null;
  if (text === "Becomes confused.") return "start:confusion";
  if (text === "Taunted.") return "start:taunt";
  if (text === "Becomes drowsy.") return "start:yawn";
  if (text === "Is seeded.") return "start:leechseed";
  if (text === "Is cursed.") return "start:curse";
  if (text === "Perish count 3.") return "start:perish3";
  if (/^Substitute: \d+ HP\.$/.test(text)) return "start:substitute";
  if (/^Encore: /.test(text)) return "start:encore";
  if (/^Disable: .* is disabled\.$/.test(text)) return "start:disable";
  if (text === "Aqua Ring starts.") return "start:aquaring";
  if (text === "Ingrain starts.") return "start:ingrain";
  if (/^Magnet Rise: /.test(text)) return "start:magnetrise";
  if (text === "Imprison starts.") return "start:imprison";
  if (/^Focus Energy: /.test(text)) return "start:focusenergy";
  if (/^Dragon Cheer: /.test(text)) return "start:dragoncheer";
  if (/^Charged: /.test(text)) return "start:charge";
  return null;
}

(async () => {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const verbose = process.argv.includes("--verbose");
  const report: { id: string; status: string; mismatches: Mismatch[]; error?: string }[] = [];
  const extra = process.argv.includes("--extra");
  for (const c of extra ? TRACK_A_CASES : S_CASES) {
    if (ids.length && !ids.some((id) => c.id.startsWith(id))) continue;
    const runtime = await runtimeFor(c);
    const oracle = extra ? (c.notEstimated ? null : extraOracle(c, process.argv.includes("--fresh"))) : readOracle(c.id);
    let result: DoublesTurnResult | null = null;
    let error: string | undefined;
    const input = statusInput(c, caseInput(c, runtime));
    const base = (slot: DoublesSlotId) => { const entry = input.pokemon[slot]; return entry ? runtime.speciesById.get(entry.build.speciesId)?.name ?? entry.build.speciesId : ""; };
    const WHERE: Record<DoublesSlotId, string> = { "own-left": "your left", "own-right": "your right", "opponent-left": "opponent's left", "opponent-right": "opponent's right" };
    const nameOf = (slot: DoublesSlotId) => SLOTS.some((other) => other !== slot && base(other) === base(slot)) ? `${base(slot)} (${WHERE[slot]})` : base(slot);
    /** A step fact about `slot` (doubles-status.ts aboutSlot) as the hit fact it stands for, or null. */
    const unabout = (slot: DoublesSlotId, text: string): string | null => {
      const name = nameOf(slot);
      if (text.startsWith(`${name} is `)) return `Is ${text.slice(name.length + 4)}`;
      if (text.startsWith(`${name}'s `)) { const rest = text.slice(name.length + 3); return /^[^:]+: /.test(rest) ? rest : `Its ${rest}`; }
      if (text.startsWith(`${name}: `)) return text.slice(name.length + 2);
      return null;
    };
    try {
      result = calculateDoublesTurn(input);
    } catch (e) {
      error = (e as Error).stack?.split("\n").slice(0, 4).join(" | ");
    }
    if (error || !result) { report.push({ id: c.id, status: "error", mismatches: [], error }); console.log(`${c.id}: ERROR ${error}`); continue; }
    let mismatches = compareCase(c, oracle, result, (moveId) => runtime.movesById.get(moveId)?.category === "Status")
      .filter((m) => !(m.field === "facts" && m.expected === "End-of-turn effects are not applied."))
      // E2 (calculateDoublesOutcomes) is not Track A's: compared by Track D's app-turn.ts and compare.ts.
      .filter((m) => m.where !== "E2" && !m.where.startsWith("E2"));
    // status-eot: statuses after the moves.
    if (result.status === "ready" && oracle && !c.notEstimated) {
      for (const slot of SLOTS) {
        const o = oracle.walks.all.slots[slot]?.status;
        if (!o || c.slots[slot].absent) continue;
        const a = appStatus(c, result, slot);
        for (const key of new Set([...Object.keys(o), ...Object.keys(a)])) {
          if (Math.abs((o[key] ?? 0) - (a[key] ?? 0)) > 1e-9) mismatches.push({ id: c.id, where: slot, field: `status[${key || "none"}]`, expected: o[key] ?? 0, got: a[key] ?? 0 });
        }
      }
    }
    // status-eot: each step's per-target effects (status, volatiles started, stages), the oracle's lines by mass.
    if (result.status === "ready" && oracle && !c.notEstimated) {
      for (const [slot, o] of Object.entries(oracle.walks.all.steps)) {
        const step = result.steps.find((each) => each.slot === slot);
        // A damaging move's added effects are the kernel's (no stage or status facts): compare.ts checks what it reports.
        if (runtime.movesById.get((o as { moveId: string }).moveId)?.category !== "Status") continue;
        for (const target of SLOTS) {
          const expected: Record<string, number> = {};
          for (const [key, mass] of Object.entries((o as { effects?: Record<string, Record<string, number>> }).effects?.[target] ?? {})) {
            if (/^(status:|boost:|setboost:|start:(confusion|taunt|yawn|leechseed|curse|perish3|substitute|encore|disable|aquaring|ingrain|magnetrise|imprison|focusenergy|dragoncheer|charge)$)/.test(key)) expected[key] = mass;
          }
          const got: Record<string, number> = {};
          for (const fact of step?.hits.find((hit) => hit.slot === target)?.facts ?? []) {
            const key = factKey(fact.text);
            if (key) got[key] = (got[key] ?? 0) + fact.chance;
          }
          // Effects on a Pokémon the move did not reach (Mirror Armor, Synchronize onto the user) are step facts naming it.
          for (const fact of step?.facts ?? []) {
            const text = unabout(target, fact.text);
            const key = text ? factKey(text) : null;
            if (key) got[key] = (got[key] ?? 0) + fact.chance;
          }
          for (const key of new Set([...Object.keys(expected), ...Object.keys(got)])) {
            if (Math.abs((expected[key] ?? 0) - (got[key] ?? 0)) > 1e-9) mismatches.push({ id: c.id, where: `${slot}→${target}`, field: `effect ${key}`, expected: expected[key] ?? 0, got: got[key] ?? 0 });
          }
          // A status move's hits: reached, and the HP change on each Pokémon it reached (heals, costs, Pain Split).
          const status = runtime.movesById.get((o as { moveId: string }).moveId)?.category === "Status";
          const hit = step?.hits.find((each) => each.slot === target);
          const oh = (o as { hits: Record<string, { reached: number }> }).hits[target];
          if (status && oh && hit && Math.abs(oh.reached - hit.reached) > 1e-9) mismatches.push({ id: c.id, where: `${slot}→${target}`, field: "status hit.reached", expected: oh.reached, got: hit.reached });
          const oc = (o as { change?: Record<string, { min: number; max: number }> }).change?.[target];
          if (status && hit && oc && (oc.min !== 0 || oc.max !== 0) && hit.change && (hit.change.min !== Math.min(oc.min, oc.max < 0 ? oc.min : oc.min) || hit.change.max !== oc.max)) {
            // The oracle's change covers every outcome (0 where nothing changed); the app's only those where it did.
            const appRange = [hit.change.min, hit.change.max];
            if (!(appRange[0] === oc.min || oc.min === 0) || !(appRange[1] === oc.max || oc.max === 0)) mismatches.push({ id: c.id, where: `${slot}→${target}`, field: "status hit.change", expected: oc, got: hit.change });
          }
        }
      }
    }
    if (c.notEstimated === undefined && result.status === "not-estimated" && c.endNotEstimated === undefined) mismatches = mismatches.length ? mismatches : [{ id: c.id, where: "turn", field: "status", expected: "ready", got: result.reason }];
    report.push({ id: c.id, status: result.status, mismatches });
    const reason = result.status === "not-estimated" ? ` (${result.reason})` : "";
    console.log(`${c.id}: ${result.status}${reason}, ${mismatches.length ? `${mismatches.length} mismatches` : "match"}`);
    for (const m of mismatches.slice(0, verbose ? 100 : 6)) console.log(`   ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
  }
  const bad = report.filter((r) => r.status === "error" || r.mismatches.length);
  fs.writeFileSync(path.resolve("scripts/.cache/calc-audit/status-eot/build/track-a-compare-s.json"), JSON.stringify(report, null, 1));
  console.log(`\n${report.length - bad.length}/${report.length} S cases match.`);
})();
