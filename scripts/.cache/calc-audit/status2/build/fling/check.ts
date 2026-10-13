// Track F (SPEC2 §4.7): an app Fling row against the exact oracle (oracle.ts) on pinned Showdown c23d2e94. Shared by the golden
// check (golden-check.ts) and the sweep (sweep.ts). Compares the first use's damage rolls, its KO chance, the first use's
// outcome (afterUse) and Uses to KO (one use: P(out by that use's end of turn); a Dynamaxed attacker's count over its uses).
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveDamageResult } from "@/app/lib/battle/types";
import { flingOracle, fspecOf, type FOracle, type Game } from "./oracle";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const fmt = (x: number) => +x.toFixed(6);

export type Check = { id: string; ok: boolean; skipped?: string; diffs: string[]; app: string; oracle: string };

/** The app row's damage distribution: each roll 1/16 ("none" for a row that deals no damage because the move fails or is blocked). */
function appDamage(row: MoveDamageResult): Map<string, number> {
  const out = new Map<string, number>();
  if (row.kind !== "calculated" || row.max === null) return out;
  if (row.max === 0 && row.min === 0) {
    // A failing or blocked Fling: no getDamage call; an immune target: getDamage is not reached either (the hit fails in
    // hitStepTypeImmunity), so "none" too.
    out.set("none", 1);
    return out;
  }
  const rolls = row.rolls as number[];
  for (const roll of rolls) out.set(String(roll), (out.get(String(roll)) ?? 0) + 1 / rolls.length);
  return out;
}

function sameDist(a: Map<string, number>, b: [string, number][]): boolean {
  const bm = new Map(b);
  if (a.size !== bm.size) return false;
  for (const [k, v] of a) if (!close(v, bm.get(k) ?? -1)) return false;
  return true;
}

export function checkRow(id: string, game: Game, attacker: BattleBuild, defender: BattleBuild, field: BattleConditions, runtime: BattleRuntime, row: MoveDamageResult,
  opts: { turns?: number } = {}): Check {
  const app = `${row.kind} ${row.effectiveName} ${row.min}-${row.max} ko=${row.ohkoChance} uses=${JSON.stringify(row.usesToKO)} after=${row.afterUse ? JSON.stringify({ ...row.afterUse, paths: undefined }) : "-"} | ${row.reason ?? row.assumptions.join(" / ")}`;
  if (row.kind !== "calculated") return { id, ok: true, skipped: `app ${row.kind}: ${row.reason}`, diffs: [], app, oracle: "" };
  const dyn = attacker.mechanic === "dynamax" || attacker.mechanic === "gigantamax";
  const turns = opts.turns ?? (dyn ? 6 : 1);
  let o: FOracle;
  try {
    const spec = fspecOf(id, game, "Fling", attacker, defender, field, runtime);
    // A sleeping or frozen attacker does not move in the oracle; the row is the move as used (its damage does not read the status).
    if (spec.a.status === "slp" || spec.a.status === "frz") delete spec.a.status;
    // A protecting target protected (the row's premise): a sleeping or frozen one could not, so it is awake for that.
    if (spec.protect && (spec.d.status === "slp" || spec.d.status === "frz")) delete spec.d.status;
    o = flingOracle(spec, turns);
  } catch (error) {
    return { id, ok: false, diffs: [`oracle error: ${(error as Error).message}`], app, oracle: "" };
  }
  const oracle = `damage=${JSON.stringify(o.damage.map(([k, p]) => [k, fmt(p)]))} first=${JSON.stringify({ min: o.first.min, max: o.first.max, avg: fmt(o.first.average), ko: fmt(o.first.koChance) })} ko=${o.ko.map(fmt).join(" ")} open=${fmt(o.open)} log=${o.log.slice(0, 8).join(" ")}`;
  const diffs: string[] = [];
  const damage = appDamage(row);
  if (!sameDist(damage, o.damage)) diffs.push(`damage app ${JSON.stringify([...damage].map(([k, p]) => [k, fmt(p)]))} vs oracle ${JSON.stringify(o.damage.map(([k, p]) => [k, fmt(p)]))}`);
  // The hit's KO chance: the oracle's mass at 0 HP right after the move.
  if (row.ohkoChance !== null && !close(row.ohkoChance, o.first.koChance)) diffs.push(`ohkoChance app ${row.ohkoChance} vs oracle ${o.first.koChance}`);
  if (row.afterUse) {
    const a = row.afterUse;
    if (a.start !== o.tgtStart) diffs.push(`afterUse.start app ${a.start} vs oracle ${o.tgtStart}`);
    if (a.min !== o.first.min || a.max !== o.first.max) diffs.push(`afterUse min/max app ${a.min}/${a.max} vs oracle ${o.first.min}/${o.first.max}`);
    if (!close(a.average, o.first.average)) diffs.push(`afterUse.average app ${a.average} vs oracle ${o.first.average}`);
    if (!close(a.koChance, o.first.koChance) && !(o.first.koChance === 0 && a.koChance === 0)) diffs.push(`afterUse.koChance app ${a.koChance} vs oracle ${o.first.koChance}`);
    if (o.lowest.firstHP !== a.low || o.highest.firstHP !== a.high) diffs.push(`afterUse low/high app ${a.low}/${a.high} vs oracle ${o.lowest.firstHP}/${o.highest.firstHP}`);
  }
  const u = row.usesToKO;
  if (u?.kind === "single-use") {
    if (!close(u.koChance, o.ko[0] ?? 0) && !(u.koChance > 0 && u.koChance < 1e-300 && (o.ko[0] ?? 0) > 0 && (o.ko[0] ?? 0) < 1e-12)) diffs.push(`single-use koChance app ${u.koChance} vs oracle ${o.ko[0]}`);
  } else if (u?.kind === "uses") {
    const guaranteed = o.ko.findIndex((p) => p > 1 - 1e-12) + 1 || null;
    const fewest = o.ko.findIndex((p) => p > 0) + 1 || null;
    if (u.guaranteed !== null && u.guaranteed <= o.turns && u.guaranteed !== guaranteed) diffs.push(`guaranteed app ${u.guaranteed} vs oracle ${guaranteed} (${o.ko.map(fmt).join(" ")})`);
    if (u.fewest !== null && u.fewest <= o.turns && u.fewest !== fewest) diffs.push(`fewest app ${u.fewest} vs oracle ${fewest}`);
    if (u.guaranteed === null && guaranteed !== null && guaranteed <= Math.min(o.turns, u.limit ?? o.turns)) diffs.push(`guaranteed app none vs oracle ${guaranteed}`);
    if (u.fasterChance !== undefined && u.guaranteed !== null && !close(u.fasterChance, o.ko[u.guaranteed - 2] ?? 0)) diffs.push(`fasterChance app ${u.fasterChance} vs oracle ${o.ko[u.guaranteed - 2]}`);
  } else if (u?.kind === "no-damage") {
    if (o.ko.some((p) => p > 0)) diffs.push(`no-damage but oracle ko ${o.ko.map(fmt).join(" ")}`);
  } else if (u?.kind === "never") {
    if (o.ko.some((p) => p > 0)) diffs.push(`never but oracle ko ${o.ko.map(fmt).join(" ")}`);
  }
  return { id, ok: !diffs.length, diffs, app, oracle };
}
