// Saved battles in Node (conformance gate 9, the leak test's replays, tests/unit/training-saved-worker.test.ts): drive the
// real worker message loop with a seeded random p1, keep every checkpoint, then
//   - replay: re-run the finished battle from its seed and choice lines; the re-run log must hash as the original (its text
//     and its wording-free shape), its result must be the battle's, and its boards (each turn's start, the end) must equal the
//     boards the battle posted then;
//   - resume: a fresh worker resumes the middle checkpoint and plays on with the same p1; the whole log (lines, steps,
//     actions, reads, occupants, names), the choice lines, the seed and the habits must equal the uninterrupted battle's.
// Decision times are fixed (now = 0) so the reads' elapsed times compare equal; the AI has no wall valve (deadlineMs null).
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { DecisionProvider, HabitsRecord } from "@/app/(app)/training/model/decision";
import { DEFAULT_INFO, CLOSED_TEAM_SHEETS, PERFECT_INFORMATION, type InfoSettings } from "@/app/(app)/training/model/info";
import { createRandom, seedHex } from "@/app/(app)/training/model/random";
import { canonicalJson, logHash, logShapeHash } from "@/app/(app)/training/model/saved-battle";
import type { ShowdownRequest } from "@/app/(app)/training/model/showdown-types";
import type { BoardView, JointAction, LogTurn, PlayerChoice, TrainingRequest, TrainingSetup, TrainingTeam } from "@/app/(app)/training/model/view-types";
import type { FromWorker, ToWorker } from "@/app/(app)/training/model/worker-protocol";
import { identName, legalJointActions, type MemberKeys } from "@/app/(app)/training/sim/choices";
import { memberKeys, toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { createMemorySealer, type Sealer } from "@/app/(app)/training/worker/sealer";
import { createTrainingWorker } from "@/app/(app)/training/worker/worker-handler";
import { createSeat, forcedProvider, type ForcedChoices, type SeatName } from "./providers";
import { parsePools, teamPair, type TeamPair } from "./teams";

export type BattleMessage = Extract<FromWorker, { type: "battle" }>;
export type Checkpointed = { turn: number; sealed: string };
export type Played = {
  log: Map<number, LogTurn>;
  messages: FromWorker[];
  checkpoints: Checkpointed[];
  ended: BattleMessage | null;
  habits: HabitsRecord | null;
  errors: string[];
};

/** Your members' keys by Showdown ident name, as the worker maps them (a regional form battles under its base name). */
function playerKeys(team: TrainingTeam): MemberKeys {
  const adapted = toShowdownTeam(team.members, runtime);
  return memberKeys(adapted, adapted);
}

/** A legal p1 choice drawn from (run, battle, request id, attempt) alone, so a resumed battle chooses as the original did. */
export function seededChoice(request: TrainingRequest, board: BoardView | null, team: TrainingTeam, random: { int(n: number): number }): PlayerChoice | null {
  if (request.kind === "wait") return null;
  if (request.kind === "team-preview") {
    const order = [1, 2, 3, 4, 5, 6];
    for (let i = order.length - 1; i > 0; i--) { const j = random.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    return { kind: "team", order: order.slice(0, request.maxChosenTeamSize) };
  }
  const keys = playerKeys(team);
  const side = { name: "You", id: "p1" as const, pokemon: request.side };
  const raw: ShowdownRequest = request.kind === "move" ? { active: request.active, side } : { forceSwitch: request.forceSwitch, side };
  const bench = request.side.filter((pokemon) => !pokemon.active && !pokemon.condition.endsWith(" fnt")).map((pokemon) => keys.keyOf("p1", identName(pokemon.ident)));
  const firstTurn = [board?.turn === 1, board?.turn === 1];
  const legal = legalJointActions({ side: "p1", aiSide: "p2", request: raw, bench, firstTurn, megaUsed: board?.megaUsed.own ?? false, keys });
  const action: JointAction = legal[random.int(legal.length)] ?? {};
  return { kind: "action", action };
}

export type DriveOptions = {
  run: string; index: number; setup: TrainingSetup; seat: SeatName; sealer: Sealer | null;
  habits?: HabitsRecord | null;
  /** Forfeit once the AI has locked in this turn's move request (before your choice for it). */
  forfeitTurn?: number | null;
  /** Called with every posted message (the leak test scans them). */
  onMessage?(message: FromWorker, log: ReadonlyMap<number, LogTurn>): void;
  /** The AI's forced choices (the Illusion and Transform slice). */
  forced?: ForcedChoices;
};

/** Starts (or, with `resume`, resumes) one battle in a fresh worker and plays it to the end. */
export async function playBattle(options: DriveOptions, resume?: { sealed: string; log: LogTurn[] }): Promise<Played> {
  const { run, index, setup } = options;
  const out: Played = { log: new Map((resume?.log ?? []).map((turn) => [turn.turn, structuredClone(turn)])), messages: [], checkpoints: [], ended: null, habits: null, errors: [] };
  const inbox: FromWorker[] = [];
  let wake: (() => void) | null = null;
  let hexes = 0;
  const worker = createTrainingWorker({
    post: (message) => { inbox.push(structuredClone(message)); wake?.(); },
    createProvider: (habits: HabitsRecord | null): DecisionProvider => forcedProvider(createSeat(options.seat, runtime, habits).provider, options.forced),
    now: () => 0,
    randomHex: () => seedHex(run, index, "worker", hexes++),
    deadlineMs: null,
    sealer: options.sealer,
  });
  const send = (message: ToWorker) => worker.receive(message);
  const next = async (): Promise<FromWorker> => {
    for (let wait = 0; !inbox.length; wait++) {
      if (wait > 4000) throw new Error("worker idle");
      await new Promise<void>((resolve) => { wake = resolve; setTimeout(resolve, 5); });
      wake = null;
    }
    return inbox.shift()!;
  };
  const battleId = index + 1;
  send({ type: "load" });
  if (resume) send({ type: "resume", battleId, setup, sealed: resume.sealed, log: resume.log });
  else send({ type: "start", battleId, setup, habits: options.habits ?? null });
  let board: BoardView | null = null;
  let lastRequest: TrainingRequest | null = null;
  let attempts = 0;
  let forfeitAt: number | null = null;
  try {
    for (let step = 0; step < 6000; step++) {
      const message = await next();
      out.messages.push(message);
      if (message.type === "battle-error") { out.errors.push(`#${index}: ${message.message}`); break; }
      if (message.type === "checkpoint") {
        if (message.sealed) out.checkpoints.push({ turn: message.turn, sealed: message.sealed });
        else out.errors.push(`#${index}: checkpoint ${message.turn} not sealed`);
        options.onMessage?.(message, out.log);
        continue;
      }
      if (message.type === "ai" && forfeitAt !== null && message.requestId === forfeitAt && message.status !== "thinking") {
        send({ type: "forfeit", battleId });
        continue;
      }
      if (message.type === "choice-error") {
        attempts++;
        const request = message.request ?? lastRequest;
        const retry = request && seededChoice(request, board, setup.own, createRandom(run, index, request.id, "p1", attempts));
        if (retry && lastRequest) send({ type: "choose", battleId, requestId: lastRequest.id, choice: retry });
        continue;
      }
      if (message.type !== "battle") { options.onMessage?.(message, out.log); continue; }
      for (const turn of message.log) out.log.set(turn.turn, turn);
      if (message.habits) out.habits = message.habits;
      options.onMessage?.(message, out.log);
      board = message.board;
      if (message.ended) { out.ended = message; break; }
      if (!message.request || message.request.kind === "wait") continue;
      if (message.request.id === lastRequest?.id) continue;
      lastRequest = message.request;
      attempts = 0;
      if (options.forfeitTurn != null && forfeitAt === null && message.request.kind === "move" && message.board.turn >= options.forfeitTurn) {
        forfeitAt = message.request.id;
        continue;
      }
      const choice = seededChoice(message.request, board, setup.own, createRandom(run, index, message.request.id, "p1", 0));
      if (choice) send({ type: "choose", battleId, requestId: message.request.id, choice });
    }
  } catch (error) {
    out.errors.push(`#${index}: ${(error as Error).message}`);
  }
  send({ type: "stop", battleId });
  // Checkpoints are sealed asynchronously: the last ones can arrive after the end.
  const expected = Math.max(0, (out.ended?.board.turn ?? 0) - (resume ? Math.max(...[...out.log.keys()], 0) + 1 : 0));
  for (let wait = 0; wait < 200 && out.checkpoints.length + inbox.filter((m) => m.type === "checkpoint").length < expected; wait++) await new Promise((resolve) => setTimeout(resolve, 5));
  for (const message of inbox.splice(0)) if (message.type === "checkpoint" && message.sealed) out.checkpoints.push({ turn: message.turn, sealed: message.sealed });
  out.checkpoints.sort((x, y) => x.turn - y.turn);
  return out;
}

export type ReplayResult = { ok: true; message: Extract<FromWorker, { type: "replay-ready" }> } | { ok: false; error: string };

/** Re-runs a finished battle in a fresh worker (as the replay screen does). */
export async function replayBattle(setup: TrainingSetup, ended: BattleMessage): Promise<ReplayResult> {
  const posted: FromWorker[] = [];
  const worker = createTrainingWorker({
    post: (message) => posted.push(structuredClone(message)),
    createProvider: () => { throw new Error("A replay never asks the AI."); }, now: () => 0, randomHex: () => "0".repeat(32), deadlineMs: null,
  });
  worker.receive({ type: "replay", replayId: 1, setup, seed: ended.seed ?? "", inputLog: ended.inputLog ?? [], forfeited: !!ended.ended?.forfeited });
  const message = posted.find((each) => each.type === "replay-ready" || each.type === "replay-error");
  if (!message) return { ok: false, error: "no replay message" };
  return message.type === "replay-ready" ? { ok: true, message } : { ok: false, error: message.type === "replay-error" ? message.message : "?" };
}

const INFOS: InfoSettings[] = [DEFAULT_INFO, { aiKnows: DEFAULT_INFO.aiKnows, youSee: CLOSED_TEAM_SHEETS }, { aiKnows: CLOSED_TEAM_SHEETS, youSee: PERFECT_INFORMATION }];

export type SavedCheck = {
  battles: number; ended: number; replays: number; replayEqual: number; resumed: number; resumeEqual: number; forfeits: number;
  /** Replays whose boards and result equal the battle's (a replay shows no more than the battle showed you). */
  replayBoardsEqual: number;
  /** The largest finished record (setup + log + choices) as JSON, in bytes. */
  maxRecordBytes: number;
  failures: string[];
};

/**
 * `battles` seeded battles (info settings rotate: open both ways, You see closed, AI knows closed with You see perfect; every
 * fifth forfeits on turn 3 once the AI has locked in).
 */
export async function runSavedCheck(options: {
  battles: number; seat: SeatName; pools?: string; run?: string; onProgress?(index: number): void;
  /** Fixed teams for every battle (the Illusion and Transform slice) in place of pairs from the pools, and the AI's forced choices. */
  teams?: { pair: () => TeamPair } & ForcedChoices;
}): Promise<SavedCheck> {
  const run = options.run ?? "saved";
  const pools = parsePools(options.pools ?? "S,V,A");
  const sealer = createMemorySealer();
  const out: SavedCheck = { battles: 0, ended: 0, replays: 0, replayEqual: 0, resumed: 0, resumeEqual: 0, forfeits: 0, replayBoardsEqual: 0, maxRecordBytes: 0, failures: [] };
  for (let index = 0; index < options.battles; index++) {
    options.onProgress?.(index);
    const pair = options.teams ? options.teams.pair() : teamPair(run, index, pools, runtime);
    const setup: TrainingSetup = { own: pair.p1.team, opponent: pair.p2.team, difficulty: index % 2 ? "reads" : "safe", showRead: true, info: INFOS[index % INFOS.length] };
    const forfeitTurn = index % 5 === 4 ? 3 : null;
    const base: DriveOptions = { run, index, setup, seat: options.seat, sealer, forfeitTurn, forced: options.teams };
    out.battles++;
    const a = await playBattle(base);
    out.failures.push(...a.errors);
    if (!a.ended) { out.failures.push(`#${index}: did not end after ${a.messages.length} messages (${a.messages.slice(-3).map((m) => m.type === "choice-error" ? `choice-error ${m.message}` : m.type).join(", ")})`); continue; }
    out.ended++;
    if (a.ended.ended?.forfeited) out.forfeits++;
    const finalLog = [...a.log.values()].sort((x, y) => x.turn - y.turn);
    out.maxRecordBytes = Math.max(out.maxRecordBytes, JSON.stringify({ setup, log: finalLog, inputLog: a.ended.inputLog, seed: a.ended.seed }).length);
    // Replay: the re-run log hashes as the original.
    const replay = await replayBattle(setup, a.ended);
    out.replays++;
    if (!replay.ok) out.failures.push(`#${index}: replay error ${replay.error}`);
    else if (replay.message.hash !== logHash(finalLog)) out.failures.push(`#${index}: replay hash differs`);
    else if (replay.message.shape !== logShapeHash(finalLog)) out.failures.push(`#${index}: replay shape differs`);
    else {
      out.replayEqual++;
      const differs = replayBoardDifference(a, replay.message);
      if (differs) out.failures.push(`#${index}: replay ${differs}`);
      else out.replayBoardsEqual++;
    }
    // Resume from the middle checkpoint, then play on: everything equals the uninterrupted battle.
    if (!a.checkpoints.length) continue;
    const at = a.checkpoints[Math.floor(a.checkpoints.length / 2)];
    out.resumed++;
    const b = await playBattle(base, { sealed: at.sealed, log: finalLog.filter((turn) => turn.turn < at.turn) });
    const diff = compareRuns(a, b);
    if (diff) out.failures.push(`#${index}: resume at turn ${at.turn}: ${diff}`);
    else out.resumeEqual++;
  }
  return out;
}

/**
 * null when the replay's boards and result are the battle's: each turn's start board equals the first board the battle
 * posted in that turn, the end board its last one; else what differs.
 */
export function replayBoardDifference(played: Played, replay: Extract<FromWorker, { type: "replay-ready" }>): string | null {
  const live = new Map<number, string>();
  for (const message of played.messages) {
    if (message.type !== "battle" || message.ended || message.board.turn < 1 || live.has(message.board.turn)) continue;
    live.set(message.board.turn, canonicalJson(message.board));
  }
  const turns = [...new Set([...live.keys(), ...Object.keys(replay.starts).map(Number)])].sort((x, y) => x - y);
  const turn = turns.find((each) => live.get(each) !== (replay.starts[each] ? canonicalJson(replay.starts[each]) : undefined));
  if (turn !== undefined) return `board at turn ${turn} differs from the battle's`;
  if (!played.ended || canonicalJson(replay.end) !== canonicalJson(played.ended.board)) return "end board differs from the battle's";
  if (canonicalJson(replay.result) !== canonicalJson(played.ended.ended)) return "result differs from the battle's";
  return null;
}

/** null when equal, else the first difference. */
export function compareRuns(a: Played, b: Played): string | null {
  if (b.errors.length) return b.errors[0];
  if (!a.ended || !b.ended) return "did not end";
  const sorted = (log: Map<number, LogTurn>) => [...log.values()].sort((x, y) => x.turn - y.turn);
  const logA = sorted(a.log), logB = sorted(b.log);
  if (logA.length !== logB.length) return `log turns ${logA.length} vs ${logB.length}`;
  for (let i = 0; i < logA.length; i++) {
    for (const part of ["lines", "steps", "actions", "read", "occupants", "names"] as const) {
      if (canonicalJson(logA[i][part]) !== canonicalJson(logB[i][part])) return `turn ${logA[i].turn} ${part} differ`;
    }
  }
  if (canonicalJson(a.ended.inputLog) !== canonicalJson(b.ended.inputLog)) return "choice lines differ";
  if (a.ended.seed !== b.ended.seed) return "seed differs";
  if (canonicalJson(a.ended.ended) !== canonicalJson(b.ended.ended)) return "result differs";
  if (canonicalJson(a.habits) !== canonicalJson(b.habits)) return "habits differ";
  if (canonicalJson(a.ended.board) !== canonicalJson(b.ended.board)) return "final board differs";
  return null;
}
