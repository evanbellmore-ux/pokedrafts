import type { Comparison, CompareParams, Difficulty, FightSide, HeroInfo, SupportInfo } from '../compare/contracts';

export const EXECUTION_PIN_TTL_MS = 600_000;
export const EXECUTION_ANALYTICAL_VERSION = 'execution-statistical-3';
export const COMPARISON_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPORT = /^[A-Za-z0-9]{16}$/;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const MAX_ID = 2_147_483_647;

export interface RankingScope {
  zone: number;
  encounter: number;
  difficulty: Difficulty;
  size: number;
  partition: number;
  patch: string;
}
export type PinnedSide = Pick<FightSide, 'name' | 'server' | 'actorID' | 'code' | 'fightID' | 'amount' | 'rankPercent' | 'durSec' | 'kill' | 'scope'>;
export interface PinnedComparison extends Record<string, unknown> {
  encounter: { id: number; name: string };
  difficulty: Difficulty;
  metric: 'dps' | 'hps';
  spec: string;
  className: string;
  pi: SupportInfo;
  hero: HeroInfo;
  a: PinnedSide;
  b: PinnedSide;
}
export interface PinnedParams extends CompareParams, Record<string, unknown> {
  zone: number;
  executionRankingScope?: RankingScope;
  executionCurrentPartition: boolean;
  executionReferenceCurrentPartition: boolean;
}
export interface ComparisonPin { base: PinnedComparison; params: PinnedParams }
export interface ExecutionPinStore {
  preflight(): Promise<void>;
  putPin(base: PinnedComparison, params: PinnedParams): Promise<string>;
  readPin(id: string): Promise<unknown>;
  close(): Promise<void>;
}
export interface ExecutionPinBinding { comparisonID: string; createdAt: number }
export interface CompareExecutionBinder {
  readonly cacheKey: string;
  observe(document: string, variables: Record<string, unknown>, data: unknown): void;
  bind(comparison: Comparison, params: CompareParams, client: { query(document: string, variables?: Record<string, unknown>): Promise<unknown> }, signal: AbortSignal): Promise<ExecutionPinBinding | null>;
}

export class InvalidComparisonPin extends Error {
  constructor() { super('The retained comparison is unavailable or incompatible.'); }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !CONTROL.test(value);
}
function id(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_ID; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function requirePin(condition: unknown): asserts condition { if (!condition) throw new InvalidComparisonPin(); }
export function realmKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
}
function support(value: unknown): SupportInfo {
  requirePin(isRecord(value) && ['a', 'b', 'excluded'].every((key) => typeof value[key] === 'boolean'));
  return { a: value.a as boolean, b: value.b as boolean, excluded: value.excluded as boolean };
}
function hero(value: unknown): HeroInfo {
  requirePin(isRecord(value) && ['a', 'b', 'alt', 'requested'].every((key) => value[key] === null || text(value[key], 80)));
  return { a: value.a as string | null, b: value.b as string | null, alt: value.alt as string | null, requested: value.requested as string | null };
}
function side(value: unknown, encounter: number, difficulty: Difficulty): PinnedSide {
  requirePin(isRecord(value) && text(value.name, 128) && text(value.server, 128) && value.server !== '?' && realmKey(value.server).length > 0
    && id(value.actorID) && typeof value.code === 'string' && REPORT.test(value.code) && id(value.fightID));
  requirePin(finite(value.amount) && value.amount >= 0 && (value.rankPercent === null || finite(value.rankPercent) && value.rankPercent >= 0 && value.rankPercent <= 100)
    && finite(value.durSec) && value.durSec > 0 && value.kill === true);
  const scope = value.scope;
  requirePin(isRecord(scope) && id(scope.zone) && scope.encounter === encounter && scope.difficulty === difficulty
    && typeof scope.size === 'number' && Number.isSafeInteger(scope.size) && scope.size > 0 && scope.size <= 40);
  return {
    name: value.name, server: value.server, actorID: value.actorID, code: value.code, fightID: value.fightID,
    amount: value.amount, rankPercent: value.rankPercent as number | null, durSec: value.durSec, kill: true,
    // Browser/builder partition and patch fields are deliberately not proof.
    scope: { zone: scope.zone, encounter, difficulty, size: scope.size },
  };
}
export function validateRankingScope(value: unknown, base: PinnedComparison): RankingScope {
  requirePin(isRecord(value) && id(value.zone) && value.encounter === base.encounter.id && value.difficulty === base.difficulty
    && typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0 && value.size <= 40
    && id(value.partition) && text(value.patch, 128));
  requirePin([base.a, base.b].every((entry) => entry.scope.zone === value.zone && (value.size === 0 || entry.scope.size === value.size))
    && (base.difficulty !== 5 || value.size === 20));
  return { zone: value.zone, encounter: base.encounter.id, difficulty: base.difficulty, size: value.size, partition: value.partition, patch: value.patch };
}

/** Project again AFTER throughput normalization. A builder cannot supply an ID,
 * Execution metadata, unknown-PI fallback, or extra nested fields to a pin. */
export function createComparisonPin(comparison: unknown, params: CompareParams): ComparisonPin {
  requirePin(isRecord(comparison) && isRecord(comparison.encounter) && comparison.encounter.id === params.encounter && text(comparison.encounter.name, 256)
    && comparison.difficulty === params.difficulty && comparison.metric === params.metric && text(comparison.spec, 64) && text(comparison.className, 64));
  const a = side(comparison.a, params.encounter, params.difficulty), b = side(comparison.b, params.encounter, params.difficulty);
  requirePin(a.name.trim().toLowerCase() === params.name.trim().toLowerCase() && realmKey(a.server) === realmKey(params.server)
    && (params.code === null || a.code === params.code && a.fightID === params.fightID));
  return {
    base: { encounter: { id: params.encounter, name: comparison.encounter.name }, difficulty: params.difficulty, metric: params.metric,
      spec: comparison.spec, className: comparison.className, pi: support(comparison.pi), hero: hero(comparison.hero), a, b },
    params: { name: params.name, server: params.server, region: params.region, encounter: params.encounter, difficulty: params.difficulty,
      metric: params.metric, hero: params.hero, code: a.code, fightID: a.fightID, zone: a.scope.zone!,
      executionCurrentPartition: false, executionReferenceCurrentPartition: false },
  };
}

/** Database rows are data, not authority to override the pinned pair or policy. */
export function readComparisonPin(value: unknown): ComparisonPin {
  requirePin(isRecord(value) && isRecord(value.params));
  const p = value.params;
  requirePin(text(p.name, 64) && text(p.server, 128) && typeof p.region === 'string' && ['us', 'eu', 'kr', 'tw'].includes(p.region) && id(p.encounter)
    && typeof p.difficulty === 'number' && [3, 4, 5].includes(p.difficulty) && (p.metric === 'dps' || p.metric === 'hps')
    && typeof p.code === 'string' && REPORT.test(p.code) && id(p.fightID) && (p.hero === null || text(p.hero, 80))
    && typeof p.executionCurrentPartition === 'boolean' && typeof p.executionReferenceCurrentPartition === 'boolean');
  const params: CompareParams = { name: p.name, server: p.server, region: p.region as CompareParams['region'], encounter: p.encounter,
    difficulty: p.difficulty as Difficulty, metric: p.metric, code: p.code, fightID: p.fightID, hero: p.hero as string | null };
  const pin = createComparisonPin(value.base, params);
  requirePin(p.zone === pin.params.zone);
  if (p.executionRankingScope !== undefined) {
    pin.params.executionRankingScope = validateRankingScope(p.executionRankingScope, pin.base);
    pin.params.executionCurrentPartition = p.executionCurrentPartition;
    pin.params.executionReferenceCurrentPartition = p.executionReferenceCurrentPartition;
  } else requirePin(!p.executionCurrentPartition && !p.executionReferenceCurrentPartition);
  return freezePin(pin);
}
export function freezePin(pin: ComparisonPin): ComparisonPin {
  Object.freeze(pin.base.encounter); Object.freeze(pin.base.pi); Object.freeze(pin.base.hero);
  for (const entry of [pin.base.a, pin.base.b]) { Object.freeze(entry.scope); Object.freeze(entry); }
  if (pin.params.executionRankingScope) Object.freeze(pin.params.executionRankingScope);
  Object.freeze(pin.base); Object.freeze(pin.params);
  return Object.freeze(pin);
}

export function nativeExecutionStatus(binding: ExecutionPinBinding | null) {
  return {
    state: binding ? 'available' as const : 'unavailable' as const,
    available: binding !== null, backend: 'native' as const, analyticalVersion: EXECUTION_ANALYTICAL_VERSION,
    capabilities: { build: false as const, reference: true as const },
    ...(binding ? { expiresAt: binding.createdAt + EXECUTION_PIN_TTL_MS } : { reason: 'Native Execution is temporarily unavailable.' }),
  };
}
