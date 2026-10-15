import { createHash } from 'node:crypto';
import catalog from '../../../../../vendor/castmirror/reviews/venomous-abyss-mythic.json';
import reviewedScopes from '../../../../../vendor/castmirror/reviews/raid-execution-scopes.json';
import personal from '../../../../../vendor/castmirror/native/execution/statistics-v3-rules.json';
import { maintenanceClient } from '../../../../../vendor/castmirror/native/execution/maintenance.mjs';
import type { ComparisonClient } from '../../compare/contracts';
import { isRecord, realmKey, sameRealm } from '../pins';
import type { ExecutionOwnership } from '../store-types';
import { clusterContactIncidents } from './grade';
import type { RaidBossReview, RaidFightEvidence, RaidRole } from './types';

export const RAID_REVIEW_VERSION = 'raid-execution-review-1';
export const RAID_REVIEW_TTL_MS = 600_000;
export const RAID_REVIEW_RULES_VERSION = 'reviewed-contact-rubric-1-' + createHash('sha256')
  .update(JSON.stringify([catalog, reviewedScopes])).digest('hex').slice(0, 16);
export const RAID_REVIEW_SELECTION = 'latest-six-reviewed-public-kills-2';
export const RAID_REVIEW_SCOPE = catalog.scope;
export const RAID_REVIEW_BOSSES = catalog.encounters.map(({ encounter, name }) => ({ id: encounter, name }));
export interface RaidReviewRequest { name: string; server: string; region: 'us' | 'eu' | 'kr' | 'tw'; zone: number; difficulty: number; encounter: number }
export interface RaidBudget {
  snapshot(): { counters: Record<string, number>; stop: string | null; [key: string]: unknown };
  count(key: string, count?: number): void;
  recordPlayers(count: number): void;
  recordRanking(rows: number): void;
  recordEvents(page: { page: number; count: number }): void;
}
export interface RaidBudgetGrant { budget: RaidBudget; ownership: ExecutionOwnership; release(): Promise<void> }
export interface RaidReviewRuntime {
  account: string;
  client: ComparisonClient;
  budgetFactory(options: { signal?: AbortSignal; now?: () => number }): Promise<RaidBudgetGrant>;
  store: { readRaidReview(key: string): Promise<unknown | null>; saveRaidReview(review: RaidBossReview, ownership: ExecutionOwnership): Promise<void> };
  close(): Promise<void>;
}
type Row = Record<string, unknown>;
type StreamName = 'damage' | 'casts' | 'deaths' | 'interrupts' | 'dispels' | 'healing';
type Stream = { complete: boolean; events: Row[]; cursor: number; pages: number; reason: string | null };
const STREAMS: Record<StreamName, string> = { damage: 'DamageTaken', casts: 'Casts', deaths: 'Deaths', interrupts: 'Interrupts', dispels: 'Dispels', healing: 'Healing' };
const names = Object.keys(STREAMS) as StreamName[];
const positiveID = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 2_147_483_647;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(v);
const norm = (v: string) => v.trim().toLowerCase();
const codeOK = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9]{16}$/.test(v);
const contextual = new Set([1300239]); // Swirling Spirit exposure varies with encounter assignments and well context.
class EvidenceError extends Error { constructor(readonly code: string) { super(code); } }
function requireEvidence(condition: unknown, reason = 'public-evidence-unverified'): asserts condition { if (!condition) throw new EvidenceError(reason); }
function safeReason(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(error.code) ? error.code
    : error instanceof EvidenceError ? error.code : 'public-evidence-unavailable';
}
export function reviewedRaidAbilities(encounter: number, scope: { partition: number; patch: string }) {
  const boss = catalog.encounters.find((e) => e.encounter === encounter);
  const binding = reviewedScopes.scopes.find((s) => s.partition === scope.partition && s.patch === scope.patch);
  if (!boss || !binding) return [];
  const policy = (binding as { abilityIDsByEncounter?: Record<string, number[]> }).abilityIDsByEncounter;
  if (!policy) return boss.abilities;
  const ids = policy[String(encounter)];
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => !boss.abilities.some((a) => a.abilityID === id))) return [];
  return boss.abilities.filter((a) => ids.includes(a.abilityID));
}
function scopesForBoss(encounter: number) {
  return reviewedScopes.scopes.filter((s) => reviewedRaidAbilities(encounter, s).length > 0)
    .map(({ partition, patch }) => ({ partition, patch }));
}
export function raidReviewKey(request: RaidReviewRequest, account: string): string {
  return createHash('sha256').update(JSON.stringify([RAID_REVIEW_VERSION, RAID_REVIEW_RULES_VERSION, RAID_REVIEW_SELECTION,
    account, norm(request.name), realmKey(request.server), request.region, request.zone, request.encounter, request.difficulty, catalog.scope])).digest('hex');
}
function emptyReview(request: RaidReviewRequest, key: string, now: number): RaidBossReview {
  const boss = RAID_REVIEW_BOSSES.find((b) => b.id === request.encounter)!;
  return { version: RAID_REVIEW_VERSION, key, at: now, rulesVersion: RAID_REVIEW_RULES_VERSION,
    identity: { name: request.name, server: request.server, region: request.region, className: '' },
    scope: { ...catalog.scope, encounter: request.encounter }, boss, status: 'unavailable', reason: null,
    reviewedScopes: scopesForBoss(request.encounter), coverageLimited: false, availableKills: 0, fights: [], sampleLimit: 6 };
}
export function isRetainedRaidReview(value: unknown, request: RaidReviewRequest, key: string, now: number): value is RaidBossReview {
  const reviewed = catalog.encounters.find((e) => e.encounter === request.encounter);
  const supported = scopesForBoss(request.encounter);
  if (!reviewed) return false;
  if (!isRecord(value) || value.version !== RAID_REVIEW_VERSION || value.key !== key || value.rulesVersion !== RAID_REVIEW_RULES_VERSION
    || !finite(value.at) || value.at > now || now - value.at >= RAID_REVIEW_TTL_MS || !isRecord(value.scope) || !isRecord(value.identity)
    || !isRecord(value.boss) || value.boss.id !== request.encounter || value.sampleLimit !== 6
    || !['complete', 'partial', 'unavailable'].includes(String(value.status)) || !Number.isSafeInteger(value.availableKills)
    || (value.availableKills as number) < 0 || (value.availableKills as number) > 100 || !(value.reason === null || text(value.reason))
    || !Array.isArray(value.fights) || value.fights.length > 6 || !text(value.identity.name) || !text(value.identity.server)
    || typeof value.identity.className !== 'string' || (value.fights.length > 0 && !text(value.identity.className))
    || norm(value.identity.name) !== norm(request.name) || !sameRealm(value.identity.server, request.server)
    || value.identity.region !== request.region || value.scope.encounter !== request.encounter
    || !Array.isArray(value.reviewedScopes) || value.reviewedScopes.length !== supported.length
    || !supported.every((s) => (value.reviewedScopes as unknown[]).filter((v) => isRecord(v) && v.partition === s.partition && v.patch === s.patch).length === 1)
    || !Object.entries(catalog.scope).every(([k, v]) => (value.scope as Row)[k] === v)) return false;
  // This cache contains only evidence the collector produced; reject incompatible
  // or malformed aggregates rather than turning absent fields into clean kills.
  if (new Set(value.fights.map((f) => isRecord(f) ? `${f.code}:${f.fightID}` : null)).size !== value.fights.length) return false;
  if (value.coverageLimited !== value.fights.some((f) => isRecord(f) && isRecord(f.scope)
    && reviewedRaidAbilities(request.encounter, { partition: f.scope.partition as number, patch: f.scope.patch as string }).length < reviewed.abilities.length)) return false;
  const integer = (v: unknown) => finite(v) && Number.isSafeInteger(v);
  return value.fights.every((f) => {
    const abilities = isRecord(f) && isRecord(f.scope) ? reviewedRaidAbilities(request.encounter,
      { partition: f.scope.partition as number, patch: f.scope.patch as string }) : [];
    return abilities.length > 0 && isRecord(f) && codeOK(f.code) && positiveID(f.fightID) && positiveID(f.actorID)
    && text(f.spec) && ['dps', 'tank', 'healer'].includes(String(f.role)) && f.kill === true && finite(f.date)
    && isRecord(f.scope) && supported.some((s) => s.partition === (f.scope as Row).partition && s.patch === (f.scope as Row).patch)
    && finite(f.durationSec) && f.durationSec > 0 && isRecord(f.damage) && typeof f.damage.complete === 'boolean'
    && ['total', 'avoidableHealth', 'avoidableAbsorbed'].every((k) => finite((f.damage as Row)[k]))
    && Array.isArray(f.damage.abilities) && f.damage.abilities.length === abilities.length
    && new Set(f.damage.abilities.map((a) => isRecord(a) ? a.abilityID : null)).size === abilities.length
    && f.damage.abilities.every((a) => {
      if (!isRecord(a)) return false;
      const definition = abilities.find((d) => d.abilityID === a.abilityID);
      return definition && a.name === (('label' in definition ? definition.label : undefined) ?? definition.name)
        && finite(a.health) && finite(a.absorbed) && integer(a.hits) && integer(a.clusters) && (a.clusters as number) <= (a.hits as number)
        && a.contextual === contextual.has(definition.abilityID);
    })
    && f.damage.abilities.reduce((sum, a) => sum + ((a as Row).health as number), 0) === f.damage.avoidableHealth
    && f.damage.abilities.reduce((sum, a) => sum + ((a as Row).absorbed as number), 0) === f.damage.avoidableAbsorbed
    && (f.damage.total as number) >= (f.damage.avoidableHealth as number)
    && isRecord(f.survival) && typeof f.survival.complete === 'boolean' && Array.isArray(f.survival.deaths)
    && f.survival.deaths.every((d) => isRecord(d) && finite(d.at) && d.at <= (f.durationSec as number) && (d.causeID === null || positiveID(d.causeID))
      && typeof d.causeName === 'string' && d.reviewedAvoidable === (d.causeID !== null && abilities.some((a) => a.abilityID === d.causeID) && !contextual.has(d.causeID as number))
      && (d.raidDeathOrder === null || positiveID(d.raidDeathOrder)))
    && isRecord(f.utility) && typeof f.utility.complete === 'boolean'
    && ['successfulInterrupts', 'dispels'].every((k) => integer((f.utility as Row)[k])) && finite(f.utility.raidAbsorbed)
    && Array.isArray(f.utility.absorbAbilities) && f.utility.absorbAbilities.every((a) => isRecord(a) && positiveID(a.abilityID) && text(a.name) && finite(a.amount))
    && f.utility.absorbAbilities.reduce((sum, a) => sum + ((a as Row).amount as number), 0) === f.utility.raidAbsorbed
    && Array.isArray(f.utility.personalCasts) && f.utility.personalCasts.every((a) => isRecord(a) && positiveID(a.abilityID) && text(a.name) && integer(a.count))
    && Array.isArray(f.limitations) && f.limitations.every((s) => typeof s === 'string');
  });
}
interface Candidate { code: string; fightID: number; date: number; spec: string; scope: { partition: number; patch: string } }
interface Head { code: string; startTime: number; endTime: number; actors: Row[]; abilities: Row[]; fights: Row[]; mixedZone: boolean }
const HEAD = `query($code:String!){ reportData{report(code:$code){ code startTime endTime revision visibility zone{id}
  masterData{actors{id name server type subType petOwner} abilities{gameID name}}
  fights{id encounterID difficulty size kill startTime endTime friendlyPlayers} }}}`;
function readHead(value: unknown, code: string): Head {
  const rep = isRecord(value) && isRecord(value.reportData) ? value.reportData.report : null;
  requireEvidence(isRecord(rep) && rep.code === code && rep.visibility === 'public' && finite(rep.startTime) && finite(rep.endTime)
    && rep.endTime >= rep.startTime && Number.isSafeInteger(rep.revision) && isRecord(rep.zone) && positiveID(rep.zone.id)
    && isRecord(rep.masterData) && Array.isArray(rep.masterData.actors) && rep.masterData.actors.length <= 10_000
    && Array.isArray(rep.masterData.abilities) && rep.masterData.abilities.length <= 20_000 && Array.isArray(rep.fights) && rep.fights.length <= 10_000,
  'public-report-unverified');
  const actors = rep.masterData.actors as Row[];
  requireEvidence(actors.every((a) => isRecord(a) && typeof a.id === 'number' && Number.isSafeInteger(a.id))
    && new Set(actors.map((a) => a.id)).size === actors.length, 'report-actors-unverified');
  return { code, startTime: rep.startTime as number, endTime: rep.endTime as number, actors, abilities: rep.masterData.abilities as Row[],
    fights: rep.fights as Row[], mixedZone: rep.zone.id !== catalog.scope.zone };
}
function verifyFight(head: Head, candidate: Candidate, request: RaidReviewRequest, className: string) {
  const matches = head.fights.filter((f) => f.id === candidate.fightID);
  requireEvidence(matches.length === 1, 'fight-scope-unverified');
  const fight = matches[0];
  requireEvidence(fight.kill === true && fight.encounterID === request.encounter && fight.difficulty === request.difficulty
    && fight.size === catalog.scope.size && finite(fight.startTime) && finite(fight.endTime) && fight.endTime > fight.startTime
    && head.startTime + fight.endTime <= head.endTime && head.startTime + fight.startTime === candidate.date
    && Array.isArray(fight.friendlyPlayers) && fight.friendlyPlayers.length >= 20 && fight.friendlyPlayers.length <= 40
    && fight.friendlyPlayers.every(positiveID) && new Set(fight.friendlyPlayers).size === fight.friendlyPlayers.length, 'fight-scope-unverified');
  const players = fight.friendlyPlayers as number[];
  requireEvidence(players.every((id) => head.actors.some((a) => a.id === id && a.type === 'Player')), 'fight-roster-unverified');
  const actors = head.actors.filter((a) => a.type === 'Player' && text(a.name) && norm(a.name) === norm(request.name)
    && text(a.server) && sameRealm(a.server, request.server) && players.includes(a.id as number));
  requireEvidence(actors.length === 1 && actors[0].subType === className, 'player-identity-unverified');
  return { fight, actor: actors[0], players };
}
function verifyPlayer(value: unknown, actor: Row, candidate: Candidate, request: RaidReviewRequest, players: number[]): RaidRole {
  const detail = isRecord(value) && isRecord(value.data) ? value.data.playerDetails : null;
  requireEvidence(isRecord(detail), 'player-specialization-unverified');
  const roster: Array<{ player: Row; role: RaidRole }> = [];
  for (const [key, role] of [['dps', 'dps'], ['tanks', 'tank'], ['healers', 'healer']] as const) {
    requireEvidence(Array.isArray(detail[key]), 'player-specialization-unverified');
    for (const p of detail[key] as unknown[]) { requireEvidence(isRecord(p), 'player-specialization-unverified'); roster.push({ player: p, role }); }
  }
  requireEvidence(roster.length === players.length && new Set(roster.map(({ player }) => player.id)).size === players.length
    && roster.every(({ player }) => players.includes(player.id as number)), 'player-roster-unverified');
  const rows = roster.filter(({ player }) => player.id === actor.id);
  requireEvidence(rows.length === 1, 'player-specialization-unverified');
  const { player, role } = rows[0];
  requireEvidence(text(player.name) && norm(player.name) === norm(request.name) && text(player.server) && sameRealm(player.server, request.server)
    && text(player.region) && norm(player.region) === request.region && player.type === actor.subType && Array.isArray(player.specs)
    && player.specs.length === 1 && isRecord(player.specs[0]) && player.specs[0].spec === candidate.spec
    && finite(player.specs[0].count) && player.specs[0].count > 0, 'player-specialization-unverified');
  return role;
}
function eventDocument(active: StreamName[], details: boolean): string {
  const variables = active.map((n) => `$${n}S:Float!`).join(',');
  const actorVariable = active.some((n) => n !== 'deaths') ? ',$actor:Int!' : '';
  return `query($code:String!,$fid:[Int]!,$e:Float!${actorVariable},${variables}){reportData{report(code:$code){
    ${details ? 'playerDetails(fightIDs:$fid,includeCombatantInfo:true)' : ''}
    ${active.map((n) => `${n}:events(dataType:${STREAMS[n]},hostilityType:Friendlies,fightIDs:$fid,startTime:$${n}S,endTime:$e,
      ${n === 'deaths' ? '' : 'sourceID:$actor,'}${n === 'damage' ? 'includeResources:true,' : ''}limit:10000){data nextPageTimestamp}`).join('\n')}
  }}}`;
}
function acceptPage(stream: Stream, raw: unknown, name: StreamName, fight: Row, actorID: number, budget: RaidBudget) {
  stream.pages++;
  if (!isRecord(raw) || !Array.isArray(raw.data) || raw.data.length > 10_000 || !Object.hasOwn(raw, 'nextPageTimestamp')) {
    stream.reason = 'missing-event-page'; return;
  }
  const events = raw.data;
  if (events.some((e) => !isRecord(e) || !finite(e.timestamp) || e.timestamp < stream.cursor || e.timestamp > (fight.endTime as number)
    || e.fight !== fight.id || typeof e.type !== 'string')) { stream.reason = 'event-bounds-unverified'; return; }
  const rows = events as Row[];
  // The provider's DamageTaken actor filter is sourceID, but the returned damage
  // recipient must still be the independently verified player.
  if (rows.some((e) => name === 'damage' && e.type === 'damage' && (e.targetID !== actorID || !finite(e.amount) || !positiveID(e.abilityGameID)
      || e.absorbed !== undefined && !finite(e.absorbed))
    || name === 'casts' && e.type === 'cast' && (e.sourceID !== actorID || !positiveID(e.abilityGameID))
    || name === 'deaths' && e.type === 'death' && (!Number.isSafeInteger(e.targetID) || e.targetID === 0)
    || name === 'interrupts' && e.type === 'interrupt' && (e.sourceID !== actorID || !positiveID(e.abilityGameID) || !positiveID(e.extraAbilityGameID))
    || name === 'dispels' && e.type === 'dispel' && (e.sourceID !== actorID || !positiveID(e.abilityGameID) || !positiveID(e.extraAbilityGameID))
    || name === 'healing' && e.type === 'absorbed' && (e.sourceID !== actorID || !finite(e.amount) || !positiveID(e.abilityGameID)
      || !Number.isSafeInteger(e.targetID) || e.targetID === 0))) {
    stream.reason = 'event-actor-unverified'; return;
  }
  budget.recordEvents({ page: stream.pages, count: rows.length });
  stream.events.push(...rows);
  if (raw.nextPageTimestamp === null) { stream.complete = true; return; }
  if (!finite(raw.nextPageTimestamp) || raw.nextPageTimestamp <= stream.cursor || raw.nextPageTimestamp > (fight.endTime as number)) {
    stream.reason = 'event-cursor-unverified'; return;
  }
  stream.cursor = raw.nextPageTimestamp;
  if (stream.pages >= 3) stream.reason = 'event-page-cap';
}
function summarize(head: Head, fight: Row, actor: Row, role: RaidRole, candidate: Candidate, streams: Record<StreamName, Stream>): RaidFightEvidence {
  const reviewed = catalog.encounters.find((e) => e.encounter === fight.encounterID)!;
  const reviewedAbilities = reviewedRaidAbilities(fight.encounterID as number, candidate.scope);
  const namesByID = new Map<number, string>(head.abilities.filter((a) => positiveID(a.gameID) && text(a.name)).map((a) => [a.gameID as number, a.name as string]));
  const roster = fight.friendlyPlayers as number[];
  const abilityName = (id: number) => namesByID.get(id) ?? `Ability ${id}`;
  const damage = streams.damage.events.filter((e) => e.type === 'damage');
  const abilities = reviewedAbilities.map((a) => {
    const es = damage.filter((e) => e.abilityGameID === a.abilityID);
    return { abilityID: a.abilityID, name: ('label' in a ? a.label : undefined) ?? a.name,
      health: es.reduce((sum, e) => sum + (e.amount as number), 0), absorbed: es.reduce((sum, e) => sum + (finite(e.absorbed) ? e.absorbed : 0), 0),
      hits: es.length, clusters: clusterContactIncidents(es.map((e) => ({ at: e.timestamp as number, abilityID: a.abilityID,
        health: e.amount as number, absorbed: finite(e.absorbed) ? e.absorbed : 0 }))), contextual: contextual.has(a.abilityID) };
  });
  const deaths = streams.deaths.events.filter((e) => e.type === 'death' && roster.includes(e.targetID as number)).sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
  const actorDeaths = deaths.filter((e) => e.targetID === actor.id).map((e) => {
    const causeID = positiveID(e.killingAbilityGameID) ? e.killingAbilityGameID : null;
    return { at: ((e.timestamp as number) - (fight.startTime as number)) / 1000, causeID,
      causeName: causeID === null ? 'Unknown cause' : abilityName(causeID),
      reviewedAvoidable: causeID !== null && reviewedAbilities.some((a) => a.abilityID === causeID) && !contextual.has(causeID),
      raidDeathOrder: streams.deaths.complete ? deaths.indexOf(e) + 1 : null };
  });
  const absorb = new Map<number, number>();
  for (const e of streams.healing.events.filter((e) => e.type === 'absorbed' && e.sourceID === actor.id && e.targetID !== actor.id && roster.includes(e.targetID as number))) {
    const id = e.abilityGameID as number; absorb.set(id, (absorb.get(id) ?? 0) + (e.amount as number));
  }
  const casts = new Map<number, number>();
  const definitions = personal.defensives.filter((d) => d.className === actor.subType && d.specs.includes(candidate.spec));
  const personalIDs = new Set(definitions.flatMap((d) => d.abilityIDs));
  for (const e of streams.casts.events.filter((e) => e.type === 'cast' && e.fake !== true && personalIDs.has(e.abilityGameID as number))) {
    const id = e.abilityGameID as number; casts.set(id, (casts.get(id) ?? 0) + 1);
  }
  const limitations = names.filter((n) => !streams[n].complete).map((n) => `${n}: ${streams[n].reason ?? 'incomplete-event-stream'}`);
  if (head.mixedZone) limitations.push('Mixed report raid label; scope verified from an explicit reviewed-partition character ranking and exact encounter, difficulty and size.');
  if (roster.length > 20) limitations.push(`The provider lists ${roster.length} participant identities in this ranked 20-player kill; both public roster sources agree. The reason for extra identities is unknown.`);
  if (reviewedAbilities.length < reviewed.abilities.length) limitations.push(`Patch ${candidate.scope.patch} has a narrower reviewed mechanic list; omitted abilities are unreviewed, not observed zero contacts.`);
  limitations.push('Interrupt and dispel assignments are unknown; counts describe successful logged actions, not missed opportunities.',
    'Consumed shields credit only this player on other roster players; self, pets and inferred reduction are excluded.',
    'Personal casts describe reviewed buttons only; cast count does not prove correct timing or mitigation.');
  if (actorDeaths.some((d) => d.causeID === null)) limitations.push('One or more death causes were unavailable.');
  return { code: candidate.code, fightID: candidate.fightID, actorID: actor.id as number, spec: candidate.spec, role, kill: true,
    scope: { ...candidate.scope },
    date: head.startTime + (fight.startTime as number), durationSec: ((fight.endTime as number) - (fight.startTime as number)) / 1000,
    damage: { complete: streams.damage.complete, total: damage.reduce((sum, e) => sum + (e.amount as number), 0),
      avoidableHealth: abilities.reduce((sum, a) => sum + a.health, 0), avoidableAbsorbed: abilities.reduce((sum, a) => sum + a.absorbed, 0), abilities },
    survival: { complete: streams.deaths.complete, deaths: actorDeaths },
    utility: { complete: streams.interrupts.complete && streams.dispels.complete && streams.healing.complete && streams.casts.complete,
      successfulInterrupts: streams.interrupts.events.filter((e) => e.type === 'interrupt').length,
      dispels: streams.dispels.events.filter((e) => e.type === 'dispel').length,
      raidAbsorbed: [...absorb.values()].reduce((sum, amount) => sum + amount, 0),
      absorbAbilities: [...absorb].map(([abilityID, amount]) => ({ abilityID, name: abilityName(abilityID), amount })),
      personalCasts: [...casts].map(([abilityID, count]) => ({ abilityID, name: definitions.find((d) => d.abilityIDs.includes(abilityID))?.name ?? abilityName(abilityID), count })) }, limitations };
}

/** One boss, one durable account lease. Every query and response is accounted by
 * the existing native transport; cache hydration never opens a provider job. */
export async function collectRaidBoss(runtime: RaidReviewRuntime, request: RaidReviewRequest, options: { now?: () => number; signal?: AbortSignal } = {}): Promise<RaidBossReview> {
  const now = options.now ?? Date.now, key = raidReviewKey(request, runtime.account);
  const cached = await runtime.store.readRaidReview(key);
  if (isRetainedRaidReview(cached, request, key, now())) return { ...cached, acquisition: { ...cached.acquisition, state: cached.acquisition?.state ?? cached.status, reason: cached.acquisition?.reason ?? cached.reason, cached: true } };
  const review = emptyReview(request, key, now());
  const supported = scopesForBoss(request.encounter);
  let grant: RaidBudgetGrant | undefined;
  let wrapped: ReturnType<typeof maintenanceClient> | undefined;
  let accountingReason: string | null = null;
  try {
    grant = await runtime.budgetFactory(options);
    wrapped = maintenanceClient(runtime.client, grant.budget);
    await wrapped.measure();
    const metadata = await wrapped.query(`query($enc:Int!){worldData{encounter(id:$enc){id name zone{id name
      difficulties{id sizes} partitions{id name default}}}}}`, { enc: request.encounter });
    const encounter = metadata?.worldData?.encounter, zone = encounter?.zone;
    requireEvidence(isRecord(encounter) && encounter.id === request.encounter && isRecord(zone) && zone.id === reviewedScopes.zone
      && Array.isArray(zone.difficulties) && Array.isArray(zone.partitions), 'raid-scope-unreviewed');
    const partitions = zone.partitions;
    const difficulty = zone.difficulties.filter((d: unknown) => isRecord(d) && d.id === reviewedScopes.difficulty);
    requireEvidence(difficulty.length === 1 && Array.isArray(difficulty[0].sizes) && difficulty[0].sizes.includes(reviewedScopes.size)
      && supported.every((s) => partitions.filter((p: unknown) => isRecord(p) && p.id === s.partition && p.name === s.patch).length === 1), 'raid-scope-unreviewed');
    const current = partitions.filter((p: unknown) => isRecord(p) && p.default === true);
    requireEvidence(current.length === 1 && current[0].id === catalog.scope.partition && current[0].name === catalog.scope.patch, 'raid-scope-unreviewed');
    const rankingAliases = supported.map((s) => `p${s.partition}:encounterRankings(encounterID:$enc,difficulty:$diff,partition:${s.partition},metric:dps)`).join('\n');
    const data = await wrapped.query(`query($name:String!,$slug:String!,$region:String!,$enc:Int!,$diff:Int!){
      gameData{classes{id name}} characterData{character(name:$name,serverSlug:$slug,serverRegion:$region){name classID
        ${rankingAliases}}}}`, {
      name: request.name, slug: realmKey(request.server), region: request.region, enc: request.encounter, diff: request.difficulty,
    });
    const ch = data?.characterData?.character;
    requireEvidence(isRecord(ch) && text(ch.name) && norm(ch.name) === norm(request.name) && positiveID(ch.classID), 'public-character-unavailable');
    const classes = data?.gameData?.classes;
    requireEvidence(Array.isArray(classes) && classes.length <= 128, 'character-class-unverified');
    const classRows = classes.filter((c: unknown) => isRecord(c) && c.id === ch.classID && text(c.name));
    requireEvidence(classRows.length === 1, 'character-class-unverified');
    review.identity.className = (classRows[0].name as string).replace(/\s+/g, '');
    review.identity.name = ch.name;
    const byFight = new Map<string, Candidate>();
    for (const scope of supported) {
      const ranksEnvelope = ch[`p${scope.partition}`];
      requireEvidence(isRecord(ranksEnvelope) && !ranksEnvelope.error && Array.isArray(ranksEnvelope.ranks), 'public-character-unavailable');
      requireEvidence(ranksEnvelope.hasMorePages === undefined || ranksEnvelope.hasMorePages === false, 'character-ranking-incomplete');
      requireEvidence(ranksEnvelope.partition === scope.partition && ranksEnvelope.zone === reviewedScopes.zone
        && ranksEnvelope.difficulty === reviewedScopes.difficulty && ranksEnvelope.metric === 'dps', 'character-ranking-scope-unverified');
      const ranks = ranksEnvelope.ranks as unknown[];
      requireEvidence(ranks.length <= 100, 'ranking-rows-cap');
      for (const row of ranks) {
        requireEvidence(isRecord(row) && isRecord(row.report) && codeOK(row.report.code) && positiveID(row.report.fightID)
          && finite(row.startTime) && text(row.spec) && (row.partition == null || row.partition === scope.partition)
          && (row.partitionID == null || row.partitionID === scope.partition), 'character-ranking-unverified');
        const candidate = { code: row.report.code, fightID: row.report.fightID, date: row.startTime, spec: row.spec, scope: { ...scope } };
        const candidateKey = `${candidate.code}:${candidate.fightID}`;
        const prior = byFight.get(candidateKey);
        requireEvidence(!prior || prior.spec === candidate.spec && prior.date === candidate.date && prior.scope.partition === scope.partition, 'character-ranking-conflict');
        byFight.set(candidateKey, candidate);
      }
    }
    requireEvidence(byFight.size <= 100, 'ranking-rows-cap');
    grant.budget.recordRanking(byFight.size);
    const candidates = [...byFight.values()].sort((a, b) => b.date - a.date || a.code.localeCompare(b.code) || b.fightID - a.fightID).slice(0, 6);
    review.availableKills = byFight.size;
    if (!candidates.length) { review.reason = 'no-public-reviewed-kills'; return review; }
    const heads = new Map<string, Head>();
    for (const candidate of candidates) {
      grant.budget.count('kills');
      try {
        if (!heads.has(candidate.code)) { grant.budget.count('reportHeads'); heads.set(candidate.code, readHead(await wrapped.query(HEAD, { code: candidate.code }), candidate.code)); }
        const head = heads.get(candidate.code)!;
        const { fight, actor, players } = verifyFight(head, candidate, request, review.identity.className);
        const streams = Object.fromEntries(names.map((n): [StreamName, Stream] => [n, { complete: false, events: [], cursor: fight.startTime as number, pages: 0, reason: null }])) as Record<StreamName, Stream>;
        let role: RaidRole | undefined;
        for (let round = 0; round < 3; round++) {
          const active = names.filter((n) => !streams[n].complete && !streams[n].reason);
          if (!active.length) break;
          const variables = { code: candidate.code, fid: [candidate.fightID], e: fight.endTime, actor: actor.id,
            ...Object.fromEntries(active.map((n) => [`${n}S`, streams[n].cursor])) };
          let page: unknown;
          try { page = await wrapped.query(eventDocument(active, round === 0), variables); }
          catch (error) {
            if (!role) throw error;
            for (const n of active) streams[n].reason = safeReason(error);
            review.reason ??= safeReason(error); break;
          }
          const rep = isRecord(page) && isRecord(page.reportData) ? page.reportData.report : null;
          requireEvidence(isRecord(rep), 'event-report-unavailable');
          if (round === 0) role = verifyPlayer(rep.playerDetails, actor, candidate, request, players);
          for (const n of active) acceptPage(streams[n], rep[n], n, fight, actor.id as number, grant.budget);
        }
        requireEvidence(role, 'player-specialization-unverified');
        review.fights.push(summarize(head, fight, actor, role, candidate, streams));
        grant.budget.recordPlayers(1);
      } catch (error) {
        review.reason ??= safeReason(error);
        if (!(error instanceof EvidenceError)) throw error;
      }
    }
    review.status = review.fights.length === candidates.length && review.fights.every((f) => f.damage.complete && f.survival.complete && f.utility.complete) ? 'complete'
      : review.fights.length ? 'partial' : 'unavailable';
    if (review.status !== 'complete') review.reason ??= 'public-evidence-incomplete';
  } catch (error) {
    review.reason ??= safeReason(error);
    review.status = review.fights.length ? 'partial' : 'unavailable';
  } finally {
    try {
      try { await wrapped?.settle(); } catch (error) { accountingReason = safeReason(error); review.reason ??= accountingReason; review.status = review.fights.length ? 'partial' : 'unavailable'; }
      review.at = now();
      review.coverageLimited = review.fights.some((f) => f.scope !== undefined
        && reviewedRaidAbilities(request.encounter, f.scope).length < catalog.encounters.find((e) => e.encounter === request.encounter)!.abilities.length);
      review.acquisition = { state: review.status, reason: review.reason, cached: false, counters: grant?.budget.snapshot().counters ?? {},
        selection: RAID_REVIEW_SELECTION, sampleLimit: 6, deadlineMs: 120_000,
        ...(accountingReason ? { accountingPersistence: 'unavailable', accountingReason } : {}) };
      // No grant means no ownership and no cache write. Uncertain accounting
      // cannot publish a durable success or obtain a fresh lease elsewhere.
      if (grant && !accountingReason) {
        try { await runtime.store.saveRaidReview(review, grant.ownership); }
        catch { Object.assign(review.acquisition, { cachePersistence: 'unavailable', cacheReason: 'raid-cache-write-failed' }); }
      }
    } finally {
      try { await grant?.release(); }
      catch (error) { review.status = review.fights.length ? 'partial' : 'unavailable'; review.reason ??= safeReason(error);
        if (review.acquisition) Object.assign(review.acquisition, { accountingPersistence: 'unavailable', accountingReason: safeReason(error) }); }
    }
  }
  return review;
}
