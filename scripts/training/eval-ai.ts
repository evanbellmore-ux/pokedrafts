// Training AI evaluation harness and gates (SPEC §14.2 + addendum A1.4 / A1.5).
//   npx tsx scripts/training/eval-ai.ts --pairing safe:maxdamage --battles 400 --pool S,V --info open --shards 8
//   npx tsx scripts/training/eval-ai.ts --gates [--scale 0.25] [--shards 8]
// A pairing "a:b" seats a on p2 (the AI's seat) and b on p1; battles 2k and 2k + 1 play one team pair with sides swapped
// (lib/teams.ts mirroredPair). Each shard is a child process that plays every battle index
// i with i % shards == shard in order, carrying each seat's habits from one battle to the next (as one browser does).
// Writes scripts/.cache/training/eval/<run>/… and exits 1 when a gate fails.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { HabitsRecord } from "@/app/(app)/training/model/decision";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO, OPEN_TEAM_SHEETS, PERFECT_INFORMATION, type InfoSettings } from "@/app/(app)/training/model/info";
import type { SideID } from "@/app/(app)/training/model/showdown-types";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { runMatch, scoreOf, type DecisionRecord, type MatchResult } from "./lib/match";
import { runMegaPositions, type PositionSummary } from "./lib/positions";
import { createSeat, ensureSeats, isSeatName, type SeatName } from "./lib/providers";
import { gateTable, intervalText, mean, ms, pairedDifference, parseArgs, pct, pointsText, quantile, wilson, writeJson, writeText, type GateRow } from "./lib/report";
import { mirroredPair, parsePools } from "./lib/teams";

const ROOT = process.cwd();
const OUT = join(ROOT, "scripts", ".cache", "training", "eval");
export type InfoName = "open" | "closed" | "perfect";
export function infoSettings(name: InfoName): InfoSettings {
  if (name === "closed") return { aiKnows: CLOSED_TEAM_SHEETS, youSee: CLOSED_TEAM_SHEETS };
  if (name === "perfect") return { aiKnows: PERFECT_INFORMATION, youSee: OPEN_TEAM_SHEETS };
  return DEFAULT_INFO;
}
const STATUS_GATE_MOVES = ["tailwind", "trickroom", "followme", "ragepowder"] as const;

export type RunSpec = { name: string; p2: SeatName; p1: SeatName; battles: number; pools: string; info: InfoName; run: string; first?: number };
/** Per battle: what the gates read (decisions trimmed to numbers). */
export type BattleSummary = {
  index: number; seed: string; teams: { p1: string; p2: string };
  winner: MatchResult["winner"]; turns: number; ended: boolean; capped: boolean; score: number; hash: string;
  errors: MatchResult["errors"];
  decisions: {
    side: SideID; kind: DecisionRecord["kind"]; ms: number; turn: number;
    recovery: DecisionRecord["recovery"];
    stats: null | { byMethod: Record<string, number>; engineCalls: number; rolloutSamples: number; builds: number; preludes: number; beliefMs: number;
      valveFired: boolean; exploitability: number; approximations: string[]; statusOptions: { its: number; yours: number };
      mega: { eligible: string[]; chosen: string | null; share: number } | null; engineIssues: number };
    moves: string[]; mega: boolean;
  }[];
  /** A1.4: status moves on the p2 team, the p2 turns each was usable on, and the turns p2 chose it. */
  statusMoves: { held: string[]; available: Record<string, number>; chosen: Record<string, number> };
};

function summarize(result: MatchResult, teams: { p1: string; p2: string }, heldStatus: string[]): BattleSummary {
  const chosen: Record<string, number> = {};
  const available: Record<string, number> = {};
  const decisions = result.decisions.map((record) => {
    const moves = record.action ? Object.values(record.action).flatMap((each) => each?.kind === "move" ? [each.moveId] : []) : [];
    if (record.side === "p2" && record.kind === "turn") {
      for (const move of moves) if (heldStatus.includes(move)) chosen[move] = (chosen[move] ?? 0) + 1;
      for (const move of record.available) if ((STATUS_GATE_MOVES as readonly string[]).includes(move)) available[move] = (available[move] ?? 0) + 1;
    }
    const stats = record.stats;
    return {
      side: record.side, kind: record.kind, ms: record.ms, turn: record.turn, recovery: record.recovery, moves,
      mega: !!record.action && Object.values(record.action).some((each) => each?.kind === "move" && !!each.mega),
      stats: stats && {
        byMethod: stats.byMethod, engineCalls: stats.engineCalls, rolloutSamples: stats.rolloutSamples, builds: stats.builds, preludes: stats.preludes,
        beliefMs: stats.beliefMs, valveFired: stats.valveFired, exploitability: stats.exploitability, approximations: stats.approximations,
        statusOptions: stats.statusOptions, mega: stats.mega && { eligible: stats.mega.eligible, chosen: stats.mega.chosen, share: stats.mega.share },
        engineIssues: record.engineIssues,
      },
    };
  });
  return {
    index: result.index, seed: result.seed, teams, winner: result.winner, turns: result.turns, ended: result.ended, capped: result.capped,
    score: scoreOf(result, "p2"), hash: result.choiceLogHash, errors: result.errors, decisions, statusMoves: { held: heldStatus, available, chosen },
  };
}

/** One shard of a run, in-process. */
export async function playShard(spec: RunSpec, shard: number, shards: number): Promise<BattleSummary[]> {
  await ensureSeats([spec.p1, spec.p2]);
  const usage = loadTrainingUsage();
  const pools = parsePools(spec.pools);
  const info = infoSettings(spec.info);
  const habits: Record<SideID, HabitsRecord | null> = { p1: null, p2: null };
  const out: BattleSummary[] = [];
  const first = spec.first ?? 0;
  for (let index = first; index < first + spec.battles; index++) {
    if (index % shards !== shard) continue;
    const pair = mirroredPair(spec.run, index, pools, runtime);
    const seats = { p1: createSeat(spec.p1, runtime, habits.p1), p2: createSeat(spec.p2, runtime, habits.p2) };
    const result = await runMatch({ seats, teams: { p1: pair.p1.team, p2: pair.p2.team }, info, runtime, usage, seedRun: spec.run, index });
    habits.p1 = result.habits.p1; habits.p2 = result.habits.p2;
    const held = [...new Set(pair.p2.team.members.flatMap((member) => member.moves.flatMap((slot) => slot.moveId && (STATUS_GATE_MOVES as readonly string[]).includes(slot.moveId) ? [slot.moveId] : [])))];
    out.push(summarize(result, { p1: pair.p1.id, p2: pair.p2.id }, held));
  }
  return out;
}

/** A run split over child processes (each writes its shard's JSON). */
async function playRun(spec: RunSpec, shards: number, dir: string): Promise<BattleSummary[]> {
  const files = Array.from({ length: shards }, (_, shard) => join(dir, `${spec.name}.shard-${shard}.json`));
  if (shards === 1) {
    const battles = await playShard(spec, 0, 1);
    writeJson(files[0], battles);
    return battles;
  }
  await Promise.all(files.map((file, shard) => new Promise<void>((resolve, reject) => {
    const specFile = `${file}.spec.json`;
    writeJson(specFile, spec);
    const args = [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "--tsconfig", "tsconfig.json", "scripts/training/eval-ai.ts", "--child", specFile, "--shard", `${shard}/${shards}`, "--file", file];
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${spec.name} shard ${shard} exited ${code}: ${stderr.slice(-2000)}`)));
  })));
  return files.flatMap((file) => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as BattleSummary[] : []).sort((a, b) => a.index - b.index);
}

export type RunSummary = ReturnType<typeof summarizeRun>;
export function summarizeRun(spec: RunSpec, battles: readonly BattleSummary[]) {
  const scores = battles.map((battle) => battle.score);
  const ai = battles.flatMap((battle) => battle.decisions.filter((decision) => decision.side === "p2"));
  const turns = ai.filter((decision) => decision.kind === "turn");
  const engineSeats = !["random", "maxdamage", "habitbot", "val-random"].includes(spec.p2);
  const methods = { engine: 0, prelude: 0, rollout: 0, dropped: 0 };
  for (const decision of turns) if (decision.stats) for (const key of Object.keys(methods) as (keyof typeof methods)[]) methods[key] += decision.stats.byMethod[key] ?? 0;
  const cells = methods.engine + methods.prelude + methods.rollout + methods.dropped;
  const errors = battles.flatMap((battle) => battle.errors.map((error) => ({ index: battle.index, ...error })));
  const recoveries = battles.flatMap((battle) => battle.decisions.filter((decision) => decision.recovery).map((decision) => ({ index: battle.index, side: decision.side, ...decision.recovery! })));
  const statusHeld: Record<string, number> = {}, statusChosen: Record<string, number> = {}, statusAvailable: Record<string, number> = {};
  for (const battle of battles) {
    for (const move of battle.statusMoves.held) statusHeld[move] = (statusHeld[move] ?? 0) + 1;
    for (const [move, count] of Object.entries(battle.statusMoves.chosen)) statusChosen[move] = (statusChosen[move] ?? 0) + count;
    for (const [move, count] of Object.entries(battle.statusMoves.available ?? {})) statusAvailable[move] = (statusAvailable[move] ?? 0) + count;
  }
  const megaTurns = turns.filter((decision) => decision.stats?.mega);
  return {
    spec, n: battles.length,
    winRate: wilson(scores.reduce((sum, x) => sum + x, 0), scores.length),
    record: { wins: battles.filter((b) => b.winner === "p2").length, losses: battles.filter((b) => b.winner === "p1").length, ties: battles.filter((b) => b.winner === "tie" || b.winner === null).length },
    turnsPerBattle: mean(battles.map((battle) => battle.turns)),
    capped: battles.filter((battle) => battle.capped || !battle.ended).length,
    time: {
      turn: { p50: quantile(turns.map((d) => d.ms), 0.5), p95: quantile(turns.map((d) => d.ms), 0.95), max: Math.max(0, ...turns.map((d) => d.ms)), n: turns.length },
      preview: { p95: quantile(ai.filter((d) => d.kind === "preview").map((d) => d.ms), 0.95), n: ai.filter((d) => d.kind === "preview").length },
      switch: { p95: quantile(ai.filter((d) => d.kind === "switch").map((d) => d.ms), 0.95), n: ai.filter((d) => d.kind === "switch").length },
      belief: { p95: quantile(turns.flatMap((d) => d.stats ? [d.stats.beliefMs] : []), 0.95) },
    },
    budget: {
      engineCalls: Math.max(0, ...turns.map((d) => d.stats?.engineCalls ?? 0)),
      rolloutSamples: Math.max(0, ...turns.map((d) => d.stats?.rolloutSamples ?? 0)),
      builds: Math.max(0, ...turns.map((d) => d.stats?.builds ?? 0)),
    },
    methods, cells, enginePreludeShare: cells ? (methods.engine + methods.prelude) / cells : Number.NaN,
    exploitability: { p95: quantile(turns.flatMap((d) => d.stats ? [d.stats.exploitability] : []), 0.95), max: Math.max(0, ...turns.map((d) => d.stats?.exploitability ?? 0)) },
    valve: turns.filter((d) => d.stats?.valveFired).length,
    engineIssues: turns.reduce((sum, d) => sum + (d.stats?.engineIssues ?? 0), 0),
    approximations: Object.entries(turns.flatMap((d) => d.stats?.approximations ?? []).reduce<Record<string, number>>((acc, note) => { acc[note] = (acc[note] ?? 0) + 1; return acc; }, {})),
    errors, recoveries,
    fallbacks: recoveries.filter((r) => r.kind === "fallback").length,
    status: { held: statusHeld, available: statusAvailable, chosen: statusChosen, optionsIts: mean(turns.flatMap((d) => d.stats ? [d.stats.statusOptions.its] : [])) },
    mega: { turns: megaTurns.length, megaShare: mean(megaTurns.map((d) => d.stats!.mega!.share)), evolved: megaTurns.filter((d) => d.mega).length },
    engineSeat: engineSeats,
    scores,
    hashes: battles.map((battle) => battle.hash),
  };
}

function runLine(summary: RunSummary): string {
  const s = summary;
  return [
    `${s.spec.name}: ${s.spec.p2} (p2) vs ${s.spec.p1} (p1), pools ${s.spec.pools}, info ${s.spec.info}`,
    `  p2 score ${intervalText(s.winRate)} (W ${s.record.wins} / L ${s.record.losses} / T ${s.record.ties}), ${s.turnsPerBattle.toFixed(1)} turns, capped ${s.capped}`,
    `  time turn p50 ${ms(s.time.turn.p50)} p95 ${ms(s.time.turn.p95)} max ${ms(s.time.turn.max)} (n=${s.time.turn.n}); preview p95 ${ms(s.time.preview.p95)}; switch p95 ${ms(s.time.switch.p95)}; belief p95 ${ms(s.time.belief.p95)}`,
    `  budget max engine ${s.budget.engineCalls} rollouts ${s.budget.rolloutSamples} builds ${s.budget.builds}; cells ${s.cells} engine+prelude ${pct(s.enginePreludeShare)} dropped ${s.methods.dropped}; exploitability p95 ${pct(s.exploitability.p95, 2)}`,
    `  errors ${s.errors.length}, fallbacks ${s.fallbacks}, retries ${s.recoveries.filter((r) => r.kind === "retry").length}, engine issues ${s.engineIssues}, valve ${s.valve}`,
    `  status held ${JSON.stringify(s.status.held)} usable turns ${JSON.stringify(s.status.available)} chosen ${JSON.stringify(s.status.chosen)}; mega turns ${s.mega.turns} evolved ${s.mega.evolved} share ${pct(s.mega.megaShare)}`,
  ].join("\n");
}

/** The SPEC §14.2 gate suite (+ A1.4/A1.5), scaled by `scale` (1 = the SPEC's n). */
function gateRuns(scale: number, run: string): RunSpec[] {
  const n = (count: number) => Math.max(4, Math.round(count * scale));
  return [
    { name: "safe-random-open", p2: "safe", p1: "random", battles: n(200), pools: "S,V", info: "open", run },
    { name: "safe-maxdamage-open", p2: "safe", p1: "maxdamage", battles: n(400), pools: "S,V", info: "open", run },
    { name: "reads-maxdamage-open", p2: "reads", p1: "maxdamage", battles: n(400), pools: "S,V", info: "open", run },
    { name: "safe-habitbot-open", p2: "safe", p1: "habitbot", battles: n(400), pools: "S,V", info: "open", run },
    { name: "reads-habitbot-open", p2: "reads", p1: "habitbot", battles: n(400), pools: "S,V", info: "open", run },
    { name: "safe-safe-open", p2: "safe", p1: "safe", battles: n(200), pools: "S,V", info: "open", run },
    { name: "safe-random-closed", p2: "safe", p1: "random", battles: n(200), pools: "S,V", info: "closed", run },
    { name: "safe-maxdamage-perfect", p2: "safe", p1: "maxdamage", battles: n(400), pools: "S,V", info: "perfect", run },
    { name: "safefirst-maxdamage-open", p2: "safe-first", p1: "maxdamage", battles: n(400), pools: "S,V", info: "open", run },
    { name: "safe-maxdamage-usage", p2: "safe", p1: "maxdamage", battles: n(100), pools: "U", info: "open", run },
    { name: "safe-maxdamage-suggested", p2: "safe", p1: "maxdamage", battles: n(100), pools: "S", info: "open", run },
  ];
}

function gates(runs: Record<string, RunSummary>, positions: PositionSummary[] | null, determinism: { same: number; n: number } | null): GateRow[] {
  const rows: GateRow[] = [];
  const get = (name: string) => runs[name];
  const engineRuns = Object.values(runs).filter((run) => run.engineSeat);
  for (const info of ["open", "closed", "perfect"] as const) {
    const list = Object.values(runs).filter((run) => run.spec.info === info);
    if (!list.length) { rows.push({ gate: `Legality (${info})`, threshold: "0 exceptions/issues/fallbacks/errors; all end < turn 200", result: "not run", status: "not-run" }); continue; }
    const errors = list.reduce((sum, run) => sum + run.errors.length, 0), issues = list.reduce((sum, run) => sum + run.engineIssues, 0);
    const fallbacks = list.reduce((sum, run) => sum + run.fallbacks, 0), capped = list.reduce((sum, run) => sum + run.capped, 0);
    const n = list.reduce((sum, run) => sum + run.n, 0);
    rows.push({ gate: `Legality (${info})`, threshold: "0 exceptions/issues/fallbacks/errors; all end < turn 200",
      result: `${errors} errors, ${issues} engine issues, ${fallbacks} fallbacks, ${capped} capped (n=${n})`, status: errors + issues + fallbacks + capped === 0 ? "pass" : "fail" });
  }
  const winGate = (gate: string, name: string, threshold: number, lowBound?: number) => {
    const run = get(name);
    if (!run) { rows.push({ gate, threshold: `≥ ${pct(threshold, 0)}`, result: "not run", status: "not-run" }); return; }
    const ok = run.winRate.estimate >= threshold && (lowBound === undefined || run.winRate.low >= lowBound);
    rows.push({ gate, threshold: `≥ ${pct(threshold, 0)}${lowBound !== undefined ? ` (Wilson low ≥ ${pct(lowBound, 0)})` : ""}`, result: intervalText(run.winRate), status: ok ? "pass" : "fail" });
  };
  winGate("Plays safe vs RandomLegal", "safe-random-open", 0.9, 0.85);
  winGate("Plays safe vs MaxDamage", "safe-maxdamage-open", 0.6);
  winGate("Reads you vs MaxDamage", "reads-maxdamage-open", 0.6);
  const safeHabit = get("safe-habitbot-open"), readsHabit = get("reads-habitbot-open");
  if (safeHabit && readsHabit) {
    const diff = pairedDifference(readsHabit.scores, safeHabit.scores);
    rows.push({ gate: "Reads you − Plays safe, both vs HabitBot", threshold: "≥ +5 points (same seeds)", result: pointsText(diff), status: diff.estimate >= 0.05 ? "pass" : "fail" });
  } else rows.push({ gate: "Reads you − Plays safe, both vs HabitBot", threshold: "≥ +5 points", result: "not run", status: "not-run" });
  const self = get("safe-safe-open");
  rows.push(self
    ? { gate: "Self-play, Plays safe both seats", threshold: "p2 50% ± 7", result: intervalText(self.winRate), status: Math.abs(self.winRate.estimate - 0.5) <= 0.07 ? "pass" : "fail" }
    : { gate: "Self-play, Plays safe both seats", threshold: "p2 50% ± 7", result: "not run", status: "not-run" });
  winGate("Closed team sheets: Plays safe vs RandomLegal", "safe-random-closed", 0.85);
  const open = get("safe-maxdamage-open"), perfect = get("safe-maxdamage-perfect");
  rows.push(open && perfect
    ? { gate: "Information cost: open vs perfect (vs MaxDamage)", threshold: "open ≥ perfect − 10 points", result: `open ${pct(open.winRate.estimate)} perfect ${pct(perfect.winRate.estimate)}; ${pointsText(pairedDifference(open.scores, perfect.scores))}`,
      status: open.winRate.estimate >= perfect.winRate.estimate - 0.1 ? "pass" : "fail" }
    : { gate: "Information cost: open vs perfect", threshold: "open ≥ perfect − 10 points", result: "not run", status: "not-run" });
  const turnTimes = engineRuns.flatMap((run) => [run.time.turn]);
  if (engineRuns.length) {
    const all = engineRuns.map((run) => run.time.turn);
    const p50 = Math.max(...all.map((t) => t.p50)), p95 = Math.max(...all.map((t) => t.p95)), max = Math.max(...all.map((t) => t.max));
    rows.push({ gate: "Turn decision time (Node, worst run)", threshold: "p50 ≤ 400, p95 ≤ 800, max ≤ 2,000 ms", result: `p50 ${ms(p50)} p95 ${ms(p95)} max ${ms(max)} (n=${turnTimes.reduce((s, t) => s + t.n, 0)})`, status: p50 <= 400 && p95 <= 800 && max <= 2000 ? "pass" : "fail" });
    const preview = Math.max(...engineRuns.map((run) => run.time.preview.p95)), replacement = Math.max(...engineRuns.map((run) => run.time.switch.p95));
    rows.push({ gate: "Preview / replacement time", threshold: "p95 ≤ 150 / ≤ 60 ms", result: `${ms(preview)} / ${ms(replacement)}`, status: preview <= 150 && replacement <= 60 ? "pass" : "fail" });
    const closedBelief = Math.max(0, ...engineRuns.filter((run) => run.spec.info === "closed").map((run) => run.time.belief.p95));
    const openBelief = Math.max(0, ...engineRuns.filter((run) => run.spec.info === "open").map((run) => run.time.belief.p95));
    rows.push({ gate: "Belief update per turn", threshold: "p95 ≤ 30 ms (closed), ≤ 8 ms (open)", result: `closed ${ms(closedBelief)}, open ${ms(openBelief)}`, status: closedBelief <= 30 && openBelief <= 8 ? "pass" : "fail" });
    const engine = Math.max(...engineRuns.map((run) => run.budget.engineCalls)), rollouts = Math.max(...engineRuns.map((run) => run.budget.rolloutSamples)), builds = Math.max(...engineRuns.map((run) => run.budget.builds));
    rows.push({ gate: "Work budget per decision", threshold: "engine ≤ 240, rollouts ≤ 160, builds ≤ 4", result: `engine ${engine}, rollouts ${rollouts}, builds ${builds}`, status: engine <= 240 && rollouts <= 160 && builds <= 4 ? "pass" : "fail" });
    const dropped = engineRuns.reduce((sum, run) => sum + run.methods.dropped, 0);
    rows.push({ gate: "Dropped cells (deterministic)", threshold: "0", result: `${dropped}`, status: dropped === 0 ? "pass" : "fail" });
    const suggested = get("safe-maxdamage-suggested");
    rows.push(suggested
      ? { gate: "Cell methods on pool S (soft)", threshold: "engine + prelude ≥ 80%", result: `${pct(suggested.enginePreludeShare)} of ${suggested.cells}`, status: suggested.enginePreludeShare >= 0.8 ? "pass" : "fail" }
      : { gate: "Cell methods on pool S (soft)", threshold: "engine + prelude ≥ 80%", result: "not run", status: "not-run" });
    const expl = Math.max(...engineRuns.map((run) => run.exploitability.p95));
    rows.push({ gate: "Exploitability", threshold: "p95 ≤ 2% of the matrix spread", result: pct(expl, 2), status: expl <= 0.02 ? "pass" : "fail" });
  }
  rows.push(determinism
    ? { gate: "Determinism", threshold: "20 battles rerun, identical choice-log hashes", result: `${determinism.same}/${determinism.n}`, status: determinism.same === determinism.n ? "pass" : "fail" }
    : { gate: "Determinism", threshold: "identical choice-log hashes", result: "not run", status: "not-run" });
  const usageRun = get("safe-maxdamage-usage");
  if (usageRun) {
    const missing = STATUS_GATE_MOVES.filter((move) => (usageRun.status.available[move] ?? 0) > 0 && !(usageRun.status.chosen[move] > 0));
    rows.push({ gate: "A1.4 status moves used (pool U)", threshold: "Tailwind, Trick Room, Follow Me, Rage Powder each chosen on some turns", result: `chosen turns ${JSON.stringify(usageRun.status.chosen)} of usable turns ${JSON.stringify(usageRun.status.available)}`, status: missing.length === 0 ? "pass" : "fail", detail: missing.join(",") });
  } else rows.push({ gate: "A1.4 status moves used (pool U)", threshold: "each chosen on some turns", result: "not run", status: "not-run" });
  if (positions) {
    for (const expect of ["keep", "mega"] as const) {
      const list = positions.filter((position) => position.expect === expect);
      const ok = list.every((position) => expect === "keep" ? position.megaRate.estimate < 0.5 : position.megaRate.estimate > 0.5);
      rows.push({ gate: expect === "keep" ? "A1.5 Mega-now-worse positions: keeps" : "A1.5 KO-race positions: Mega Evolves with the KO move", threshold: expect === "keep" ? "Mega in < 50% of samples, each" : "Mega + the race's move in > 50% of samples, each",
        result: list.map((position) => `${position.id} ${intervalText(position.megaRate)}`).join("; "), status: ok ? "pass" : "fail" });
    }
  } else rows.push({ gate: "A1.5 Mega positions", threshold: "keep / Mega in most samples", result: "not run", status: "not-run" });
  const firstChance = get("safefirst-maxdamage-open");
  rows.push(open && firstChance
    ? { gate: "A1.5 per-turn vs first-chance Mega (vs MaxDamage)", threshold: "per-turn ≥ first-chance − 2 points", result: `per-turn ${pct(open.winRate.estimate)} first-chance ${pct(firstChance.winRate.estimate)}; ${pointsText(pairedDifference(open.scores, firstChance.scores))}`,
      status: open.winRate.estimate >= firstChance.winRate.estimate - 0.02 ? "pass" : "fail" }
    : { gate: "A1.5 per-turn vs first-chance Mega", threshold: "per-turn ≥ first-chance − 2 points", result: "not run", status: "not-run" });
  return rows;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.child === "string") {
    const spec = JSON.parse(readFileSync(args.child, "utf8")) as RunSpec;
    const [shard, shards] = String(args.shard).split("/").map(Number);
    writeJson(String(args.file), await playShard(spec, shard, shards));
    return;
  }
  const shards = Number(args.shards ?? 1);
  const run = String(args.run ?? `eval-${new Date().toISOString().slice(0, 10)}`);
  const dir = join(OUT, run);
  const lines: string[] = [];
  const summaries: Record<string, RunSummary> = {};
  const specs: RunSpec[] = args.gates
    ? gateRuns(Number(args.scale ?? 1), run).filter((spec) => typeof args.only !== "string" || String(args.only).split(",").includes(spec.name))
    : [(() => {
      const [p2, p1] = String(args.pairing ?? "safe:maxdamage").split(":");
      if (!isSeatName(p2) || !isSeatName(p1)) throw new Error(`Unknown seat in --pairing ${String(args.pairing)}.`);
      return { name: `${p2}-${p1}-${String(args.info ?? "open")}`, p2, p1, battles: Number(args.battles ?? 40), pools: String(args.pool ?? "S,V"), info: String(args.info ?? "open") as InfoName, run };
    })()];
  for (const spec of specs) {
    const started = performance.now();
    const battles = await playRun(spec, shards, dir);
    writeJson(join(dir, `${spec.name}.json`), battles);
    summaries[spec.name] = summarizeRun(spec, battles);
    lines.push(runLine(summaries[spec.name]), `  wall ${((performance.now() - started) / 1000).toFixed(0)} s`);
    writeText(join(dir, "summary.txt"), lines.join("\n"));
  }
  let positions: PositionSummary[] | null = null;
  let determinism: { same: number; n: number } | null = null;
  if (args.gates) {
    if (typeof args.only !== "string" || String(args.only).split(",").includes("positions")) {
      await ensureSeats(["safe"]);
      positions = await runMegaPositions({ samples: Math.max(8, Math.round(40 * Number(args.scale ?? 1))), run, runtime, usage: loadTrainingUsage() });
      writeJson(join(dir, "mega-positions.json"), positions);
      for (const position of positions) lines.push(`${position.id} (${position.expect}): Mega ${intervalText(position.megaRate)}, mean share ${pct(position.meanShare)}; facts: ${position.reads.slice(0, 2).join(" | ")}`);
    }
    const base = summaries["safe-maxdamage-open"];
    if (base) {
      // Two back-to-back plays of the first 20 battles (the long base run may span code edits made meanwhile).
      const first = await playRun({ ...base.spec, name: "determinism-a", battles: Math.min(20, base.n) }, shards, dir);
      const second = await playRun({ ...base.spec, name: "determinism-b", battles: Math.min(20, base.n) }, shards, dir);
      determinism = { same: second.filter((battle) => battle.hash === first.find((each) => each.index === battle.index)?.hash).length, n: second.length };
      lines.push(`determinism: ${determinism.same}/${determinism.n} identical back to back; ${first.filter((battle) => battle.hash === base.hashes[battle.index]).length}/${first.length} equal to the base run`);
    }
  }
  const rows = args.gates ? gates(summaries, positions, determinism) : [];
  const table = rows.length ? gateTable(rows) : "";
  writeText(join(dir, "summary.txt"), [...lines, "", table].join("\n"));
  writeJson(join(dir, "gates.json"), { rows, runs: Object.fromEntries(Object.entries(summaries).map(([name, s]) => [name, { ...s, scores: undefined, hashes: undefined }])) });
  process.stdout.write(`${[...lines, "", table].join("\n")}\n`);
  if (rows.some((row) => row.status === "fail")) process.exitCode = 1;
}

if (process.argv[1] && /eval-ai\.ts$/.test(process.argv[1])) {
  main().catch((error) => { process.stderr.write(`${(error as Error).stack ?? String(error)}\n`); process.exitCode = 1; });
}
