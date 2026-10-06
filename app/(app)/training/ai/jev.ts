// SPEC 11 the Jev seam (unused in v1 production; no route): the request and response a remote player model would exchange,
// their validation, a remote PlayerModel / TieBreaker over an injected fetchJson, and withFallback, which combines player
// models by weight and drops the ones that fail. Everything a question or its summary carries is built from AiView, so a
// remote model never receives more than the AI's seat knows.
import { DOUBLES_SLOTS, slotSide } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { AiView } from "../model/ai-view";
import type { BattleRecord, PlayerModel, PlayerOption, PlayerPrediction, PlayerQuestion, TieBreaker, TurnRecord } from "../model/decision";

export type JevPredictRequest = { version: 1; kind: "predict-player"; question: PlayerQuestion; summary: string };
export type JevPredictResponse = { probabilities: Record<string, number> };
export type JevTieBreakRequest = { version: 1; kind: "tie-break"; options: { id: string; label: string }[]; summary: string };
export type JevTieBreakResponse = { pick: string };
/** The worker's same-origin POST later (SPEC 11): resolves to the parsed JSON body, rejects on a network error or abort. */
export type FetchJson = (body: JevPredictRequest | JevTieBreakRequest, signal: AbortSignal) => Promise<unknown>;
export type RemoteOptions = { timeoutMs: number };
export const JEV_TIMEOUT_MS = 700;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** A question's option ids (turn and preview questions alike). */
export function questionOptionIds(question: PlayerQuestion): string[] {
  return question.kind === "turn" ? question.options.map((option) => option.id) : question.options.map((option) => option.id);
}

/** A response's probabilities over `optionIds`: unknown ids, negative or non-finite numbers, or an empty total → null; else renormalised. */
export function parseJevPrediction(json: unknown, optionIds: readonly string[]): Record<string, number> | null {
  if (!isRecord(json) || !isRecord(json.probabilities)) return null;
  const allowed = new Set(optionIds);
  const out: Record<string, number> = Object.fromEntries(optionIds.map((id) => [id, 0]));
  let total = 0;
  for (const [id, value] of Object.entries(json.probabilities)) {
    if (!allowed.has(id) || typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    out[id] = value;
    total += value;
  }
  if (!(total > 0)) return null;
  for (const id of optionIds) out[id] /= total;
  return out;
}
/** A tie-break response's pick, when it names one of the options; else null. */
export function parseJevPick(json: unknown, optionIds: readonly string[]): string | null {
  return isRecord(json) && typeof json.pick === "string" && optionIds.includes(json.pick) ? json.pick : null;
}

/** fetchJson raced against `timeoutMs` and the caller's signal; null on timeout, abort or a rejection. */
async function withTimeout(fetchJson: FetchJson, body: JevPredictRequest | JevTieBreakRequest, signal: AbortSignal, timeoutMs: number): Promise<unknown> {
  if (signal.aborted) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); });
  const aborted = new Promise<null>((resolve) => controller.signal.addEventListener("abort", () => resolve(null), { once: true }));
  try {
    return await Promise.race([fetchJson(body, controller.signal).catch(() => null), timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

/** The remote player model (id "jev"): null on timeout, abort or invalid data. */
export function createRemotePlayerModel(fetchJson: FetchJson, options: RemoteOptions = { timeoutMs: JEV_TIMEOUT_MS }): PlayerModel {
  return {
    id: "jev",
    async predict(question, signal) {
      const ids = questionOptionIds(question);
      if (!ids.length) return null;
      const json = await withTimeout(fetchJson, { version: 1, kind: "predict-player", question, summary: question.summary ?? "" }, signal, options.timeoutMs);
      const probabilities = parseJevPrediction(json, ids);
      return probabilities ? { probabilities, weight: 1 } : null;
    },
    observeTurn(record: TurnRecord) { void record; },
    observeBattle(record: BattleRecord) { void record; },
  };
}

/** The remote tie-breaker: one of the options' ids, or null on timeout, abort or invalid data. */
export function createRemoteTieBreaker(fetchJson: FetchJson, options: RemoteOptions = { timeoutMs: JEV_TIMEOUT_MS }): TieBreaker {
  return {
    async pick(question: { options: PlayerOption[]; summary?: string }, signal: AbortSignal) {
      const ids = question.options.map((option) => option.id);
      const json = await withTimeout(fetchJson, { version: 1, kind: "tie-break", options: question.options.map(({ id, label }) => ({ id, label })), summary: question.summary ?? "" }, signal, options.timeoutMs);
      return parseJevPick(json, ids);
    },
  };
}

/** Player models combined by their predictions' weights; a model that fails (null or a throw) is dropped; null when all fail. */
export function withFallback(models: readonly PlayerModel[]): PlayerModel {
  return {
    id: models.some((model) => model.id === "jev") ? "jev" : "habits",
    async predict(question, signal): Promise<PlayerPrediction | null> {
      const answers = (await Promise.all(models.map((model) => model.predict(question, signal).catch(() => null))))
        .filter((answer): answer is PlayerPrediction => !!answer && answer.weight > 0);
      if (!answers.length) return null;
      const total = answers.reduce((sum, answer) => sum + answer.weight, 0);
      const ids = questionOptionIds(question);
      const probabilities = Object.fromEntries(ids.map((id) => [id, answers.reduce((sum, answer) => sum + answer.weight * (answer.probabilities[id] ?? 0), 0) / total]));
      return { probabilities, weight: total };
    },
    observeTurn(record) { for (const model of models) model.observeTurn(record); },
    observeBattle(record) { for (const model of models) model.observeBattle(record); },
  };
}

/**
 * The question's summary, from the AI's view alone: "Turn 3 · Yours: Garchomp 64%, Incineroar 100% · Its: Charizard 80%,
 * Whimsicott 100% · Field: Sun, Trick Room". HP of yours as the share the AI believes (inside the shown band).
 */
export function questionSummary(view: AiView, runtime: BattleRuntime): string {
  const side = (id: "own" | "opponent") => DOUBLES_SLOTS.filter((slot) => slotSide(slot) === id).map((slot) => view.mons.find((mon) => mon.slot === slot && !mon.fainted))
    .filter((mon): mon is NonNullable<typeof mon> => !!mon)
    .map((mon) => `${runtime.speciesById.get(mon.build.speciesId)?.name ?? mon.memberKey} ${Math.max(1, Math.floor(100 * mon.hp / Math.max(1, mon.maxHp)))}%`);
  const field = [view.field.weather, view.field.terrain ? `${view.field.terrain} Terrain` : "", view.field.trickRoom ? "Trick Room" : "",
    view.field.attackerSide.tailwind ? "Tailwind (yours)" : "", view.field.defenderSide.tailwind ? "Tailwind (its)" : ""].filter(Boolean);
  return [`Turn ${view.turn}`, `Yours: ${side("own").join(", ") || "none"}`, `Its: ${side("opponent").join(", ") || "none"}`, ...(field.length ? [`Field: ${field.join(", ")}`] : [])].join(" · ");
}
