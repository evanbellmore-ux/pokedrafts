import { assessRaidRanking, compareSharedRaidRanking, selectRaidRankingReviews } from "../../api/castmirror/execution/raid/grade";
import type { ExecutionUtility, RaidBossReview, RaidFightEvidence, RaidRankingAssessment, RaidRankingOptions, RaidRole } from "../../api/castmirror/execution/raid/types";

export interface ReportSource {
  code: string; fightID: number; actorID: number; url: string; date: number; role: RaidRole; spec: string;
  bossID: number; bossName: string; partition: number; patch: string;
}
export interface MechanicObservation {
  source: ReportSource; affected: boolean; incidents: number; hits: number; health: number; absorbed: number;
  avoidableDeaths: number; survived: boolean; reviewedAbilityIDs: number[];
}
export interface MechanicRow {
  bossID: number; bossName: string; partition: number; patch: string; abilityID: number; abilityName: string;
  observedKills: number; affectedKills: number; incidents: number; hits: number; health: number; absorbed: number; avoidableDeaths: number;
  observations: MechanicObservation[];
  trend: { status: "insufficient" | "descriptive"; label: string };
}
export interface BossPatchRow {
  bossID: number; bossName: string; partition: number; patch: string; observedKills: number; affectedKills: number;
  survivedKills: number; survivedCleanKills: number; incidents: number; hits: number; health: number; absorbed: number;
  avoidableDeaths: number; mechanics: MechanicRow[]; sources: ReportSource[];
}
export interface DeathCard {
  source: ReportSource; causeID: number | null; causeName: string; atSeconds: number | null; fightDurationSec: number | null;
  remainingFightSeconds: number | null; remainingFightPercent: number | null; raidDeathOrder: number | null;
  survivalComplete: boolean; mechanicsComplete: boolean;
  attribution: "reviewed-avoidable" | "reported-avoidable-incomplete" | "context-or-unproven" | "unknown-cause";
  explanation: string;
}
export interface PeerMetrics { affectedKills: number; incidents: number; survivedKills: number; survivedCleanKills: number; avoidableDeaths: number }
export interface PeerComparison {
  identity: { name: string; server: string; region: string }; pairedKills: number; withheldKills: number; sharedKills: number;
  self: PeerMetrics; peer: PeerMetrics; sources: Array<{ self: ReportSource; peer: ReportSource }>; summary: string; limits: string[];
}
export interface ReportPriority {
  kind: "fatal" | "mechanic" | "evidence"; title: string; detail: string; bossID?: number; abilityID?: number;
  incidents?: number; affectedKills?: number; observedKills?: number; avoidableDeaths?: number; sources: ReportSource[];
}
export interface RaiderReport {
  assessment: RaidRankingAssessment;
  reliability: {
    sampledKills: number; gradeableKills: number; completeObservedKills: number; incompleteMechanicsKills: number;
    affectedKills: number; survivedKills: number; survivedCleanKills: number; contactIncidents: number;
    completeSurvivalKills: number; completeSurvivalDeaths: number; confirmedAvoidableDeaths: number; observedDeathCards: number;
    utilityCompleteKills: number; utilityObservedKills: number; summary: string; limits: string[];
  };
  bosses: BossPatchRow[]; mechanics: MechanicRow[]; deaths: DeathCard[]; peers: PeerComparison[]; priorities: ReportPriority[];
  utility: { observations: ExecutionUtility; confidence: "complete" | "incomplete" | "unavailable"; summary: string }; limits: string[];
}

type Identity = PeerComparison["identity"];
type BoundFight = { review: RaidBossReview; fight: RaidFightEvidence; source: ReportSource };
const contextualID = 1300239;
const positive = (n: number) => Number.isFinite(n) && n > 0 ? n : 0;
const integer = (n: number) => Math.floor(positive(n));
const rounded = (n: number) => Math.round(n * 10) / 10;
const identityKey = (v: Identity) => JSON.stringify([v.name.trim().normalize("NFKC").toLocaleLowerCase("en-US"),
  v.server.trim().normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, ""), v.region.trim().toLocaleLowerCase("en-US")]);
const sourceKey = (v: ReportSource) => JSON.stringify([v.bossID, v.code, v.fightID, v.actorID, v.role, v.partition, v.patch]);
const pairKey = (v: ReportSource) => JSON.stringify([v.bossID, v.code, v.fightID, v.role, v.partition, v.patch]);
function source(review: RaidBossReview, f: RaidFightEvidence): ReportSource {
  return { code: f.code, fightID: f.fightID, actorID: f.actorID, url: `https://www.warcraftlogs.com/reports/${f.code}#fight=${f.fightID}&source=${f.actorID}`,
    date: f.date, role: f.role, spec: f.spec, bossID: review.boss.id, bossName: review.boss.name, partition: f.scope!.partition, patch: f.scope!.patch };
}
function bound(reviews: RaidBossReview[]): BoundFight[] {
  return reviews.flatMap((review) => review.fights.filter((f) => f.kill).map((fight) => ({ review, fight, source: source(review, fight) })));
}
function abilities(f: RaidFightEvidence) {
  return f.damage.abilities.filter((a) => !a.contextual && a.abilityID !== contextualID && Number.isSafeInteger(a.abilityID) && a.abilityID > 0);
}
function coverage(f: RaidFightEvidence) { return [...new Set(abilities(f).map((a) => a.abilityID))].sort((a, b) => a - b); }
function observed(f: RaidFightEvidence) {
  return f.damage.complete && f.survival.complete && Number.isFinite(f.durationSec) && f.durationSec > 0 && coverage(f).length > 0
    && new Set(f.damage.abilities.map((a) => a.abilityID)).size === f.damage.abilities.length
    && f.damage.abilities.every((a) => Number.isSafeInteger(a.abilityID) && a.abilityID > 0
      && [a.health, a.absorbed, a.hits, a.clusters].every((n) => Number.isFinite(n) && n >= 0)
      && Number.isSafeInteger(a.hits) && Number.isSafeInteger(a.clusters)
      && (a.health + a.absorbed <= 0 || a.clusters > 0));
}
function damaging(f: RaidFightEvidence) { return abilities(f).filter((a) => positive(a.health) + positive(a.absorbed) > 0); }
function fatalCause(f: RaidFightEvidence, id: number | null) {
  return id !== null && id !== contextualID && abilities(f).some((a) => a.abilityID === id);
}
function avoidableDeaths(f: RaidFightEvidence) {
  return observed(f) ? f.survival.deaths.filter((d) => d.reviewedAvoidable && fatalCause(f, d.causeID)).length : 0;
}
function metrics(fights: BoundFight[]): PeerMetrics {
  return { affectedKills: fights.filter(({ fight }) => damaging(fight).length > 0).length,
    incidents: fights.reduce((n, { fight }) => n + damaging(fight).reduce((sum, a) => sum + integer(a.clusters), 0), 0),
    survivedKills: fights.filter(({ fight }) => !fight.survival.deaths.length).length,
    survivedCleanKills: fights.filter(({ fight }) => !fight.survival.deaths.length && !damaging(fight).length).length,
    avoidableDeaths: fights.reduce((n, { fight }) => n + avoidableDeaths(fight), 0) };
}
function trend(observations: MechanicObservation[]): MechanicRow["trend"] {
  const lists = new Set(observations.map((o) => o.reviewedAbilityIDs.join(",")));
  const middle = Math.floor(observations.length / 2), earlier = observations.slice(0, middle), later = observations.slice(middle);
  if (observations.length < 6 || lists.size !== 1 || earlier.at(-1)!.source.date >= later[0].source.date)
    return { status: "insufficient", label: "No directional trend: fewer than six comparable kills, reviewed mechanic coverage differs, or chronological groups overlap." };
  const total = (values: MechanicObservation[]) => values.reduce((n, v) => n + v.incidents, 0);
  return { status: "descriptive", label: `Chronological observations: earlier ${earlier.length} kills had ${total(earlier)} contacts; later ${later.length} had ${total(later)}. Exposure and assignments are unknown; this does not establish improvement or decline.` };
}
function mechanicRows(fights: BoundFight[]): MechanicRow[] {
  const rows = new Map<string, MechanicRow>();
  for (const { fight: f, source: s } of fights.filter(({ fight }) => observed(fight))) {
    for (const id of coverage(f)) {
      const entries = abilities(f).filter((a) => a.abilityID === id), contact = entries.filter((a) => positive(a.health) + positive(a.absorbed) > 0);
      const key = JSON.stringify([s.bossID, s.partition, s.patch, id]);
      let row = rows.get(key);
      if (!row) { row = { bossID: s.bossID, bossName: s.bossName, partition: s.partition, patch: s.patch, abilityID: id, abilityName: entries[0].name,
        observedKills: 0, affectedKills: 0, incidents: 0, hits: 0, health: 0, absorbed: 0, avoidableDeaths: 0, observations: [], trend: { status: "insufficient", label: "" } }; rows.set(key, row); }
      const observation: MechanicObservation = { source: s, affected: contact.length > 0,
        incidents: contact.reduce((n, a) => n + integer(a.clusters), 0), hits: contact.reduce((n, a) => n + integer(a.hits), 0),
        health: contact.reduce((n, a) => n + positive(a.health), 0), absorbed: contact.reduce((n, a) => n + positive(a.absorbed), 0),
        avoidableDeaths: f.survival.deaths.filter((d) => d.reviewedAvoidable && d.causeID === id && fatalCause(f, id)).length,
        survived: f.survival.deaths.length === 0, reviewedAbilityIDs: coverage(f) };
      row.observedKills++; row.affectedKills += Number(observation.affected);
      for (const key of ["incidents", "hits", "health", "absorbed", "avoidableDeaths"] as const) row[key] += observation[key];
      row.observations.push(observation);
    }
  }
  for (const row of rows.values()) { row.observations.sort((a, b) => a.source.date - b.source.date || sourceKey(a.source).localeCompare(sourceKey(b.source))); row.trend = trend(row.observations); }
  return [...rows.values()].sort((a, b) => a.bossID - b.bossID || a.patch.localeCompare(b.patch) || a.partition - b.partition || a.abilityID - b.abilityID);
}
function bossRows(fights: BoundFight[], mechanics: MechanicRow[]): BossPatchRow[] {
  const groups = new Map<string, BoundFight[]>();
  for (const entry of fights.filter(({ fight }) => observed(fight))) {
    const s = entry.source, key = JSON.stringify([s.bossID, s.partition, s.patch]), values = groups.get(key) ?? []; values.push(entry); groups.set(key, values);
  }
  return [...groups.values()].map((entries) => {
    const s = entries[0].source, m = metrics(entries), contact = entries.flatMap(({ fight }) => damaging(fight));
    return { bossID: s.bossID, bossName: s.bossName, partition: s.partition, patch: s.patch, observedKills: entries.length, affectedKills: m.affectedKills,
      survivedKills: entries.filter(({ fight }) => !fight.survival.deaths.length).length, survivedCleanKills: m.survivedCleanKills, incidents: m.incidents,
      hits: contact.reduce((n, a) => n + integer(a.hits), 0), health: contact.reduce((n, a) => n + positive(a.health), 0), absorbed: contact.reduce((n, a) => n + positive(a.absorbed), 0),
      avoidableDeaths: m.avoidableDeaths, mechanics: mechanics.filter((r) => r.bossID === s.bossID && r.partition === s.partition && r.patch === s.patch), sources: entries.map((v) => v.source) };
  }).sort((a, b) => a.bossID - b.bossID || a.patch.localeCompare(b.patch) || a.partition - b.partition);
}
function deathCards(fights: BoundFight[]): DeathCard[] {
  return fights.flatMap(({ fight: f, source: s }) => f.survival.deaths.map((d): DeathCard => {
    const duration = Number.isFinite(f.durationSec) && f.durationSec > 0 ? f.durationSec : null;
    const at = Number.isFinite(d.at) && d.at >= 0 ? d.at : null;
    const remaining = duration !== null && at !== null && at <= duration ? duration - at : null;
    const reviewed = d.reviewedAvoidable && fatalCause(f, d.causeID);
    const attribution = d.causeID === null ? "unknown-cause" : reviewed ? observed(f) ? "reviewed-avoidable" : "reported-avoidable-incomplete" : "context-or-unproven";
    return { source: s, causeID: d.causeID, causeName: d.causeName, atSeconds: at, fightDurationSec: duration,
      remainingFightSeconds: remaining !== null ? rounded(remaining) : null, remainingFightPercent: remaining !== null && duration !== null ? rounded(remaining / duration * 100) : null,
      raidDeathOrder: f.survival.complete && Number.isSafeInteger(d.raidDeathOrder) && Number(d.raidDeathOrder) > 0 ? d.raidDeathOrder : null,
      survivalComplete: f.survival.complete, mechanicsComplete: observed(f), attribution,
      explanation: `${attribution === "reviewed-avoidable" ? "Directly attributed to a reviewed avoidable mechanic." : attribution === "reported-avoidable-incomplete" ? "A reviewed cause is reported, but incomplete streams withhold confirmed totals." : "Cause or assignment context does not establish avoidable responsibility."} ${f.survival.complete ? "" : "The survival stream is incomplete; total deaths and raid death order are unverified. "}Remaining fight time is not time dead; resurrection evidence is not collected.` };
  })).sort((a, b) => a.source.date - b.source.date || sourceKey(a.source).localeCompare(sourceKey(b.source)) || (a.atSeconds ?? 0) - (b.atSeconds ?? 0));
}
function peerComparisons(reviews: RaidBossReview[], options: RaidRankingOptions, assessment: RaidRankingAssessment, peers: Array<{ identity: Identity; reviews: RaidBossReview[] }>): PeerComparison[] {
  if (!assessment.role || !assessment.identity) return [];
  const explicit = { ...options, role: assessment.role }, self = bound(selectRaidRankingReviews(reviews, explicit).reviews);
  const selfMap = new Map(self.map((f) => [pairKey(f.source), f]));
  const identities = new Map<string, number>(); for (const p of peers) identities.set(identityKey(p.identity), (identities.get(identityKey(p.identity)) ?? 0) + 1);
  return peers.filter((p) => identityKey(p.identity) !== identityKey(assessment.identity!) && identities.get(identityKey(p.identity)) === 1).flatMap((p): PeerComparison[] => {
    const peerAssessment = assessRaidRanking(p.reviews, explicit);
    if (!peerAssessment.identity || identityKey(peerAssessment.identity) !== identityKey(p.identity)) return [];
    const shared = compareSharedRaidRanking(reviews, p.reviews, explicit), peer = bound(selectRaidRankingReviews(p.reviews, explicit).reviews), peerMap = new Map(peer.map((f) => [pairKey(f.source), f]));
    if (!shared.sources.length) return [];
    const accepted: Array<{ a: BoundFight; b: BoundFight }> = [];
    for (const s of shared.sources) {
      const key = JSON.stringify([s.bossID, s.code, s.fightID, s.role, s.partition, s.patch]), a = selfMap.get(key), b = peerMap.get(key);
      if (!a || !b || a.source.actorID !== s.actorA || b.source.actorID !== s.actorB || s.actorA === s.actorB || !observed(a.fight) || !observed(b.fight)) continue;
      if (coverage(a.fight).join(",") !== coverage(b.fight).join(",")) continue;
      accepted.push({ a, b });
    }
    return [{ identity: p.identity, sharedKills: shared.sources.length, pairedKills: accepted.length, withheldKills: shared.sources.length - accepted.length,
      self: metrics(accepted.map((v) => v.a)), peer: metrics(accepted.map((v) => v.b)), sources: accepted.map((v) => ({ self: v.a.source, peer: v.b.source })),
      summary: accepted.length ? `${accepted.length} paired kills have complete damage/survival and equal reviewed mechanic coverage; ${shared.sources.length - accepted.length} shared kills were withheld. These are sampled-kill denominators, not mechanic opportunities.` : "Insufficient paired evidence with complete damage/survival and equal reviewed mechanic coverage.",
      limits: [...shared.exclusions, "Different assignments, exposure and resurrection history remain unknown. No peer score or opportunity-normalized performance is inferred."] }];
  }).sort((a, b) => b.pairedKills - a.pairedKills || identityKey(a.identity).localeCompare(identityKey(b.identity)));
}
function priorities(mechanics: MechanicRow[], assessment: RaidRankingAssessment, incomplete: number, utility: ExecutionUtility): ReportPriority[] {
  const groups = new Map<string, ReportPriority>();
  for (const row of mechanics) {
    const key = `${row.bossID}:${row.abilityID}`, prior = groups.get(key) ?? { kind: "mechanic", title: `${row.bossName}: ${row.abilityName}`, detail: "", bossID: row.bossID, abilityID: row.abilityID,
      incidents: 0, affectedKills: 0, observedKills: 0, avoidableDeaths: 0, sources: [] };
    prior.incidents! += row.incidents; prior.affectedKills! += row.affectedKills; prior.observedKills! += row.observedKills; prior.avoidableDeaths! += row.avoidableDeaths;
    prior.sources.push(...row.observations.filter((o) => o.affected || o.avoidableDeaths).map((o) => o.source)); groups.set(key, prior);
  }
  const ordered = [...groups.values()].filter((g) => g.avoidableDeaths! > 0 || g.incidents! > 0).sort((a, b) => b.avoidableDeaths! - a.avoidableDeaths! || b.incidents! - a.incidents! || a.title.localeCompare(b.title));
  for (const g of ordered) {
    g.kind = g.avoidableDeaths! > 0 ? "fatal" : "mechanic";
    g.detail = `${g.incidents} contact${g.incidents === 1 ? "" : "s"} affected ${g.affectedKills}/${g.observedKills} observed complete kills${g.avoidableDeaths ? `; ${g.avoidableDeaths} directly attributed avoidable death${g.avoidableDeaths === 1 ? "" : "s"}` : ""}. Counts combine verified source patches for coaching only; trend and peer comparisons remain patch-bound.`;
    g.sources = [...new Map(g.sources.map((s) => [sourceKey(s), s])).values()];
  }
  const evidenceNeeded = !assessment.rankEligible || incomplete > 0 || !utility.observedFights || utility.completeFights < utility.observedFights;
  const result = ordered.slice(0, evidenceNeeded ? 2 : 3);
  if (evidenceNeeded) result.push({ kind: "evidence", title: "Resolve evidence limits before stronger conclusions", detail: `${assessment.gradeableKills} gradeable kills; ${assessment.supportedBosses} bosses with at least three each. ${incomplete} sampled kills lack complete reviewed mechanics evidence. Utility is complete in ${utility.completeFights}/${utility.observedFights} sampled kills; missing support is unknown, not a missed assignment.`, sources: [] });
  return result;
}
function utilityFor(fights: BoundFight[]): ExecutionUtility {
  const abilities = new Map<number, ExecutionUtility["absorbAbilities"][number]>();
  for (const { fight } of fights) for (const a of fight.utility.absorbAbilities) {
    const prior = abilities.get(a.abilityID);
    abilities.set(a.abilityID, { abilityID: a.abilityID, name: prior?.name ?? a.name, amount: (prior?.amount ?? 0) + positive(a.amount) });
  }
  return { successfulInterrupts: fights.reduce((n, { fight }) => n + integer(fight.utility.successfulInterrupts), 0),
    dispels: fights.reduce((n, { fight }) => n + integer(fight.utility.dispels), 0),
    raidAbsorbed: fights.reduce((n, { fight }) => n + positive(fight.utility.raidAbsorbed), 0),
    observedFights: fights.length, completeFights: fights.filter(({ fight }) => fight.utility.complete).length,
    absorbAbilities: [...abilities.values()].filter((a) => a.amount > 0).sort((a, b) => b.amount - a.amount || a.abilityID - b.abilityID) };
}

/** Saved evidence only. The shared assessment owns scoring; diagnostics never pool alternate sources or infer opportunities. */
export function buildRaiderReport(reviews: RaidBossReview[], options: RaidRankingOptions, peers: Array<{ identity: Identity; reviews: RaidBossReview[] }>): RaiderReport {
  const assessment = assessRaidRanking(reviews, options), selection = selectRaidRankingReviews(reviews, options), fights = bound(selection.reviews), complete = fights.filter(({ fight }) => observed(fight));
  const m = metrics(complete), mechanics = mechanicRows(fights), deaths = deathCards(fights), incomplete = fights.length - complete.length, utility = utilityFor(fights);
  const confidence = !utility.observedFights ? "unavailable" : utility.completeFights === utility.observedFights ? "complete" : "incomplete";
  const limits = [...new Set([...assessment.exclusions, ...fights.flatMap(({ fight }) => fight.limitations), "These diagnostics cover selected kill samples only; progression pulls are excluded.",
    "Observed kills are selected saved samples with reviewed mechanic rows, not every mechanic opportunity or every public kill.",
    "Empty, contextual-only or incomplete mechanics evidence cannot establish a clean kill. Utility has no scoring points or verified assignment denominator.",
    "Remaining fight time after a death is not downtime; resurrection evidence is not collected. Historical/current source patches and reviewed coverage stay explicit."])];
  return { assessment, reliability: { sampledKills: fights.length, gradeableKills: assessment.gradeableKills, completeObservedKills: complete.length, incompleteMechanicsKills: incomplete,
    affectedKills: m.affectedKills, survivedKills: complete.filter(({ fight }) => !fight.survival.deaths.length).length, survivedCleanKills: m.survivedCleanKills, contactIncidents: m.incidents,
    completeSurvivalKills: fights.filter(({ fight }) => fight.survival.complete).length, completeSurvivalDeaths: fights.filter(({ fight }) => fight.survival.complete).reduce((n, { fight }) => n + fight.survival.deaths.length, 0),
    confirmedAvoidableDeaths: m.avoidableDeaths, observedDeathCards: deaths.length, utilityCompleteKills: fights.filter(({ fight }) => fight.utility.complete).length, utilityObservedKills: fights.length,
    summary: `${complete.length}/${fights.length} selected kills have complete damage/survival and noncontext reviewed mechanics. ${m.affectedKills} were affected; ${m.survivedCleanKills} survived without reviewed contacts. Unknown evidence is withheld from clean counts.`, limits },
    bosses: bossRows(fights, mechanics), mechanics, deaths, peers: peerComparisons(reviews, options, assessment, peers), priorities: priorities(mechanics, assessment, incomplete, utility),
    utility: { observations: utility, confidence, summary: confidence === "complete" ? "Complete observed utility streams for selected kills; assignments and opportunities remain unknown." : "Observed kill utility is incomplete or unavailable. Positive counts are lower bounds; unverified zero does not establish zero contribution." }, limits };
}
