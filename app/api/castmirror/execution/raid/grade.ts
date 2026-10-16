import type {
  ExecutionGrade,
  ExecutionLetter,
  ExecutionUtility,
  RaidBossGrade,
  RaidBossReview,
  RaidContactEvent,
  RaidExecutionGrade,
  RaidFightEvidence,
  RaidRole,
  RaidRoleGrade,
  RaidRankingOptions,
  RaidRankingSelection,
  RaidRankingAssessment,
  SharedRaidRankingComparison,
} from "./types";

/** A review rubric, not an official parse, percentile or measure of assigned opportunities. */
export const EXECUTION_RUBRIC: RaidExecutionGrade["rubric"] = {
  version: "reviewed-contact-rubric-1",
  label: "Non-damage execution review",
  description: "Start each complete kill at 100; subtract 5 per independently avoidable contact incident and 35 per directly attributed avoidable death, to a minimum of 0. Average kills within each boss, then weight graded bosses equally. Adjacent damaging ticks of one ability within five seconds count as one incident. Context-dependent mechanics and unproven deaths carry no blame. Death-shortened pulls cannot improve a grade. Utility is reported as observed contribution, with no points for casts or unknown assignments. Damage output and healing output do not affect the letter.",
  thresholds: [
    { letter: "A", minimum: 95 },
    { letter: "A−", minimum: 90 },
    { letter: "B+", minimum: 87 },
    { letter: "B", minimum: 83 },
    { letter: "B−", minimum: 80 },
    { letter: "C+", minimum: 77 },
    { letter: "C", minimum: 73 },
    { letter: "C−", minimum: 70 },
    { letter: "D", minimum: 60 },
    { letter: "F", minimum: 0 },
  ],
};

const ROLE_ORDER: RaidRole[] = ["dps", "tank", "healer"];
const CONTEXTUAL_IDS = [1300239];

function nonnegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function count(value: number): number {
  return Math.floor(nonnegative(value));
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

export function executionLetter(score: number | null): ExecutionLetter | null {
  if (score === null || !Number.isFinite(score)) return null;
  return EXECUTION_RUBRIC.thresholds.find((threshold) => score >= threshold.minimum)?.letter ?? "F";
}

/** Counts positive health/absorbed contact; fully immune zero-damage events do not count. */
export function clusterContactIncidents(events: RaidContactEvent[], gapMs = 5_000): number {
  const gap = Number.isFinite(gapMs) && gapMs >= 0 ? gapMs : 5_000;
  const last = new Map<number, number>();
  let incidents = 0;
  const damaging = events.filter((event) => Number.isFinite(event.at) && Number.isSafeInteger(event.abilityID)
    && event.abilityID > 0 && nonnegative(event.health) + nonnegative(event.absorbed) > 0)
    .sort((a, b) => a.at - b.at);
  for (const event of damaging) {
    const previous = last.get(event.abilityID);
    if (previous === undefined || event.at - previous > gap) incidents += 1;
    last.set(event.abilityID, event.at);
  }
  return incidents;
}

function isContextual(ability: RaidFightEvidence["damage"]["abilities"][number]): boolean {
  return ability.contextual || CONTEXTUAL_IDS.includes(ability.abilityID);
}

function damagingAbilities(fight: RaidFightEvidence) {
  return fight.damage.abilities.filter((ability) => nonnegative(ability.health) + nonnegative(ability.absorbed) > 0);
}

function incidentsFor(fight: RaidFightEvidence): number {
  return damagingAbilities(fight).filter((ability) => !isContextual(ability))
    .reduce((total, ability) => total + count(ability.clusters), 0);
}

function confirmedDeaths(fight: RaidFightEvidence): number {
  return fight.survival.deaths.filter((death) => death.reviewedAvoidable
    && death.causeID !== null && !CONTEXTUAL_IDS.includes(death.causeID)
    && fight.damage.abilities.some((ability) => ability.abilityID === death.causeID && !isContextual(ability)))
    .length;
}

function completeFight(fight: RaidFightEvidence): boolean {
  return fight.damage.complete && fight.survival.complete && Number.isFinite(fight.durationSec)
    && fight.durationSec > 0 && fight.damage.abilities.some((ability) => !isContextual(ability))
    && fight.damage.abilities.every((ability) => [ability.health, ability.absorbed, ability.hits, ability.clusters]
      .every((value) => Number.isFinite(value) && value >= 0)
      && Number.isSafeInteger(ability.hits) && Number.isSafeInteger(ability.clusters)
      && (ability.health + ability.absorbed <= 0 || ability.clusters > 0));
}

function dedupeFights(fights: RaidFightEvidence[]): RaidFightEvidence[] {
  const found = new Set<string>();
  return fights.filter((fight) => {
    const key = `${fight.code}:${fight.fightID}:${fight.actorID}`;
    if (found.has(key)) return false;
    found.add(key);
    return true;
  });
}

function utilityFor(fights: RaidFightEvidence[]): ExecutionUtility {
  const abilities = new Map<number, { abilityID: number; name: string; amount: number }>();
  let successfulInterrupts = 0;
  let dispels = 0;
  let raidAbsorbed = 0;
  for (const fight of fights) {
    successfulInterrupts += count(fight.utility.successfulInterrupts);
    dispels += count(fight.utility.dispels);
    raidAbsorbed += nonnegative(fight.utility.raidAbsorbed);
    for (const ability of fight.utility.absorbAbilities) {
      const previous = abilities.get(ability.abilityID);
      abilities.set(ability.abilityID, {
        abilityID: ability.abilityID,
        name: previous?.name ?? ability.name,
        amount: (previous?.amount ?? 0) + nonnegative(ability.amount),
      });
    }
  }
  return {
    successfulInterrupts,
    dispels,
    raidAbsorbed,
    completeFights: fights.filter((fight) => fight.utility.complete).length,
    observedFights: fights.length,
    absorbAbilities: Array.from(abilities.values()).filter((ability) => ability.amount > 0)
      .sort((a, b) => b.amount - a.amount || a.abilityID - b.abilityID),
  };
}

function summarizeFights(rawFights: RaidFightEvidence[], inheritedLimitations: string[] = []): ExecutionGrade {
  const fights = dedupeFights(rawFights);
  const complete = fights.filter(completeFight);
  const completeKills = complete.filter((fight) => fight.kill);
  const survived = completeKills.filter((fight) => fight.survival.deaths.length === 0);
  const survivingScores = survived.map((fight) => Math.max(0, 100 - 5 * incidentsFor(fight)));
  const fullExposureBaseline = average(survivingScores);
  const scored = completeKills.flatMap((fight) => {
    const deaths = confirmedDeaths(fight);
    const contactScore = Math.max(0, 100 - 5 * incidentsFor(fight) - 35 * deaths);
    if (!fight.survival.deaths.length) return [{ fight, score: contactScore }];
    if (deaths > 0) return [{ fight, score: fullExposureBaseline === null ? contactScore : Math.min(contactScore, fullExposureBaseline) }];
    // An unproven death earns no death penalty, but lost exposure can never improve the average.
    return fullExposureBaseline === null ? [] : [{ fight, score: Math.min(contactScore, fullExposureBaseline) }];
  });
  const rawScore = average(scored.map((entry) => entry.score));
  const score = rawScore === null ? null : rounded(rawScore);
  const incidents = fights.reduce((total, fight) => total + incidentsFor(fight), 0);
  const allAbilities = fights.flatMap(damagingAbilities);
  const blamedAbilities = allAbilities.filter((ability) => !isContextual(ability));
  const deaths = fights.reduce((total, fight) => total + fight.survival.deaths.length, 0);
  const avoidableDeaths = fights.reduce((total, fight) => total + confirmedDeaths(fight), 0);
  const utility = utilityFor(fights);
  const progression = fights.filter((fight) => !fight.kill).length;
  const distinctRules = new Set(fights.flatMap((fight) => fight.damage.abilities.filter((ability) => !isContextual(ability))
    .map((ability) => ability.abilityID))).size;
  const limitations = [...inheritedLimitations, ...fights.flatMap((fight) => fight.limitations)];
  limitations.push("This is an automated review judgment, not an official parse or percentile. It covers reviewed avoidable mechanics and directly attributed deaths; assignments and unreviewed mechanics are not graded.");
  limitations.push("Interrupts, dispels and logged absorbs on teammates show contribution. Their totals do not establish opportunity, assignment completion or optimal timing, so they do not add points.");
  if (complete.length < fights.length) limitations.push("Incomplete damage or survival evidence cannot earn a grade or clean-pull credit.");
  if (survived.length < 3) limitations.push("Fewer than three complete, survived kills: the sample is provisional.");
  if (distinctRules < 2) limitations.push("Only one independently reviewed mechanic is covered here; this is a narrow execution sample.");
  if (deaths > avoidableDeaths) limitations.push("Deaths without a proven avoidable cause need assignment and encounter context. They carry no death penalty and shortened exposure cannot improve the grade.");
  if (progression) limitations.push("Progression pulls contribute observed evidence but do not earn clean-kill credit or affect the letter; later phases may be unseen.");
  if (utility.completeFights < fights.length) limitations.push("Utility evidence is incomplete; displayed totals are observed lower bounds, not confirmed zero contribution.");
  const provisional = survived.length < 3 || complete.length < fights.length || distinctRules < 2
    || deaths > avoidableDeaths || progression > 0 || utility.completeFights < fights.length;
  const reasons: string[] = [];
  if (scored.length) {
    const gradedIncidents = scored.reduce((total, entry) => total + incidentsFor(entry.fight), 0);
    reasons.push(`${gradedIncidents} independently avoidable contact incident${gradedIncidents === 1 ? "" : "s"} across ${scored.length} graded kill${scored.length === 1 ? "" : "s"}.`);
  }
  if (avoidableDeaths) reasons.push(`${avoidableDeaths} death${avoidableDeaths === 1 ? "" : "s"} directly attributed to reviewed avoidable mechanics.`);
  if (deaths > avoidableDeaths) reasons.push(`${deaths - avoidableDeaths} death${deaths - avoidableDeaths === 1 ? " needs" : "s need"} encounter or assignment context.`);
  if (utility.successfulInterrupts || utility.dispels || utility.raidAbsorbed) reasons.push("Verified non-damage utility is shown separately from the mechanics letter.");
  const letter = executionLetter(score);
  const summary = score === null
    ? progression ? "Progression evidence only; no gradeable complete kill sample." : "Insufficient complete kill evidence for an execution grade."
    : incidents === 0 && avoidableDeaths === 0
      ? "No independently avoidable contacts in the graded kill sample."
      : avoidableDeaths > 0 ? "Avoidable contacts include a directly attributed death."
        : "Reviewed avoidable contacts are the main improvement area.";
  return {
    status: score === null ? "ungraded" : "graded",
    letter,
    score,
    provisional,
    summary,
    reasons,
    limitations: unique(limitations),
    sample: {
      kills: fights.filter((fight) => fight.kill).length,
      progression,
      completeFights: complete.length,
      gradedFights: scored.length,
      survivedKills: survived.length,
      deathShortenedFights: fights.filter((fight) => fight.survival.deaths.length > 0).length,
    },
    mechanics: {
      incidents,
      hits: blamedAbilities.reduce((total, ability) => total + count(ability.hits), 0),
      health: blamedAbilities.reduce((total, ability) => total + nonnegative(ability.health), 0),
      absorbed: blamedAbilities.reduce((total, ability) => total + nonnegative(ability.absorbed), 0),
      contextualIncidents: allAbilities.filter(isContextual).reduce((total, ability) => total + count(ability.clusters), 0),
      cleanKills: survived.filter((fight) => incidentsFor(fight) === 0).length,
      meanIncidentsPerGradedFight: scored.length ? rounded(scored.reduce((total, entry) => total + incidentsFor(entry.fight), 0) / scored.length) : null,
    },
    survival: { deaths, confirmedAvoidableDeaths: avoidableDeaths, contextDeaths: deaths - avoidableDeaths },
    utility,
  };
}

function sourceScopesFor(review: RaidBossReview): Array<{ partition: number; patch: string }> {
  const scopes = review.reviewedScopes ?? [{ partition: review.scope.partition, patch: review.scope.patch }];
  if (!Array.isArray(scopes) || !scopes.length || scopes.some((scope) => !scope
    || !Number.isSafeInteger(scope.partition) || scope.partition <= 0 || typeof scope.patch !== "string" || !scope.patch.trim())
    || new Set(scopes.map((scope) => scope.partition)).size !== scopes.length) return [];
  return scopes.map(({ partition, patch }) => ({ partition, patch })).sort((a, b) => a.partition - b.partition);
}

export function gradeBoss(review: RaidBossReview): RaidBossGrade {
  const limitations = review.status !== "complete" ? [`Boss review is ${review.status}${review.reason ? `: ${review.reason}` : "."}`] : [];
  if (review.coverageLimited) limitations.push("Some historical kills cover fewer verified mechanics; unreviewed effects are withheld rather than counted as clean.");
  const scopes = sourceScopesFor(review);
  const fights = review.fights.filter((fight) => scopes.some((scope) =>
    (fight.scope?.partition ?? (review.reviewedScopes ? null : review.scope.partition)) === scope.partition
    && (fight.scope?.patch ?? (review.reviewedScopes ? null : review.scope.patch)) === scope.patch));
  if (fights.length < review.fights.length) limitations.push("Source kills without a verified reviewed patch binding were excluded.");
  const grade = summarizeFights(fights, limitations);
  const roles = ROLE_ORDER.filter((role) => fights.some((fight) => fight.role === role)).map((role) => ({
    ...summarizeFights(fights.filter((fight) => fight.role === role), limitations),
    role,
    bosses: 1,
  }));
  return { ...grade, provisional: grade.provisional || review.status !== "complete" || fights.length < review.fights.length || review.coverageLimited === true,
    boss: review.boss, key: review.key, roles: roles.map((role) => ({ ...role, provisional: role.provisional || review.coverageLimited === true })) };
}

function combineUtility(values: ExecutionUtility[]): ExecutionUtility {
  const abilities = new Map<number, { abilityID: number; name: string; amount: number }>();
  for (const value of values) for (const ability of value.absorbAbilities) {
    const previous = abilities.get(ability.abilityID);
    abilities.set(ability.abilityID, { ...ability, amount: (previous?.amount ?? 0) + ability.amount });
  }
  return {
    successfulInterrupts: values.reduce((total, value) => total + value.successfulInterrupts, 0),
    dispels: values.reduce((total, value) => total + value.dispels, 0),
    raidAbsorbed: values.reduce((total, value) => total + value.raidAbsorbed, 0),
    completeFights: values.reduce((total, value) => total + value.completeFights, 0),
    observedFights: values.reduce((total, value) => total + value.observedFights, 0),
    absorbAbilities: Array.from(abilities.values()).sort((a, b) => b.amount - a.amount || a.abilityID - b.abilityID),
  };
}

function combineRoles(bosses: RaidBossGrade[]): RaidRoleGrade[] {
  return ROLE_ORDER.flatMap((role) => {
    const grades = bosses.flatMap((boss) => boss.roles.filter((value) => value.role === role));
    if (!grades.length) return [];
    const scores = grades.flatMap((grade) => grade.score === null ? [] : [grade.score]);
    const mean = average(scores);
    const score = mean === null ? null : rounded(mean);
    const combined = summarizeFights([]);
    return [{
      ...combined,
      role,
      bosses: scores.length,
      score,
      letter: executionLetter(score),
      status: score === null ? "ungraded" as const : "graded" as const,
      provisional: grades.some((grade) => grade.provisional) || scores.length < grades.length,
      summary: `${scores.length} graded boss${scores.length === 1 ? "" : "es"} in this role, weighted equally.`,
      reasons: [],
      limitations: unique(grades.flatMap((grade) => grade.limitations)),
      sample: {
        kills: grades.reduce((total, grade) => total + grade.sample.kills, 0),
        progression: grades.reduce((total, grade) => total + grade.sample.progression, 0),
        completeFights: grades.reduce((total, grade) => total + grade.sample.completeFights, 0),
        gradedFights: grades.reduce((total, grade) => total + grade.sample.gradedFights, 0),
        survivedKills: grades.reduce((total, grade) => total + grade.sample.survivedKills, 0),
        deathShortenedFights: grades.reduce((total, grade) => total + grade.sample.deathShortenedFights, 0),
      },
      mechanics: {
        incidents: grades.reduce((total, grade) => total + grade.mechanics.incidents, 0),
        hits: grades.reduce((total, grade) => total + grade.mechanics.hits, 0),
        health: grades.reduce((total, grade) => total + grade.mechanics.health, 0),
        absorbed: grades.reduce((total, grade) => total + grade.mechanics.absorbed, 0),
        contextualIncidents: grades.reduce((total, grade) => total + grade.mechanics.contextualIncidents, 0),
        cleanKills: grades.reduce((total, grade) => total + grade.mechanics.cleanKills, 0),
        meanIncidentsPerGradedFight: null,
      },
      survival: {
        deaths: grades.reduce((total, grade) => total + grade.survival.deaths, 0),
        confirmedAvoidableDeaths: grades.reduce((total, grade) => total + grade.survival.confirmedAvoidableDeaths, 0),
        contextDeaths: grades.reduce((total, grade) => total + grade.survival.contextDeaths, 0),
      },
      utility: combineUtility(grades.map((grade) => grade.utility)),
    }];
  });
}

function reviewIdentity(review: RaidBossReview): string {
  return JSON.stringify([
    review.identity.name.toLocaleLowerCase("en-US"),
    review.identity.server.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, ""),
    review.identity.region.toLocaleLowerCase("en-US"),
    review.scope.zone, review.scope.difficulty, review.scope.size, review.scope.partition, review.scope.patch,
    review.rulesVersion,
  ]);
}

/** Missing bosses stay ungraded; they neither earn a zero nor contribute a clean score. */
export function gradeRaid(reviews: RaidBossReview[], totalBosses = 10): RaidExecutionGrade {
  const expected = reviews.length ? reviewIdentity(reviews[0]) : null;
  const compatible = reviews.filter((review) => reviewIdentity(review) === expected);
  const latest = new Map<number, RaidBossReview>();
  for (const review of compatible) {
    const previous = latest.get(review.boss.id);
    if (!previous || review.at > previous.at) latest.set(review.boss.id, review);
  }
  const bosses = Array.from(latest.values()).map(gradeBoss);
  const scores = bosses.flatMap((boss) => boss.score === null ? [] : [boss.score]);
  const mean = average(scores);
  const score = mean === null ? null : rounded(mean);
  const total = Math.max(bosses.length, Number.isFinite(totalBosses) ? Math.max(0, Math.floor(totalBosses)) : 10);
  const limitations = [
    "Graded bosses receive equal weight. Bosses without complete kill evidence remain ungraded; their missing data cannot improve or lower the average.",
    "The letter judges reviewed mechanics and proven avoidable deaths. Successful utility is shown alongside it without assuming assignments, opportunities or cast effectiveness.",
  ];
  if (scores.length < total) limitations.push(`Coverage is ${scores.length} of ${total} bosses; the overall grade is provisional.`);
  if (compatible.length < reviews.length) limitations.push("Reviews for a different raider, raid scope or rule version were excluded from this overall grade.");
  const provisional = scores.length < total || bosses.some((boss) => boss.provisional);
  return {
    version: "raid-execution-grade-1",
    rubric: EXECUTION_RUBRIC,
    status: score === null ? "ungraded" : "graded",
    letter: executionLetter(score),
    score,
    provisional,
    summary: score === null ? "No gradeable complete kill evidence yet."
      : `${scores.length} of ${total} bosses graded from observed non-damage execution${provisional ? "; provisional coverage" : ""}.`,
    gradedBosses: scores.length,
    totalBosses: total,
    bosses,
    roles: combineRoles(bosses),
    utility: combineUtility(bosses.map((boss) => boss.utility)),
    limitations: unique(limitations),
  };
}

function rankingIdentity(review: RaidBossReview): string | null {
  if (!review || review.version !== "raid-execution-review-1" || !review.identity || !review.scope
    || !review.boss || !Array.isArray(review.fights) || !Number.isSafeInteger(review.at) || review.at <= 0
    || typeof review.rulesVersion !== "string" || !review.rulesVersion.trim() || !Number.isSafeInteger(review.boss.id) || review.boss.id <= 0
    || review.scope.encounter !== review.boss.id || review.scope.zone !== 53 || review.scope.difficulty !== 5 || review.scope.size !== 20
    || !Number.isSafeInteger(review.scope.partition) || review.scope.partition <= 0 || typeof review.scope.patch !== "string" || !review.scope.patch.trim()
    || ![review.identity.name, review.identity.server, review.identity.region].every((v) => typeof v === "string" && v.trim())) return null;
  const normalized = [review.identity.name.trim().normalize("NFKC").toLocaleLowerCase("en-US"),
    review.identity.server.trim().normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, ""),
    review.identity.region.trim().toLocaleLowerCase("en-US")];
  if (!normalized[1] || !["us", "eu", "kr", "tw"].includes(normalized[2])) return null;
  return JSON.stringify([...normalized, review.scope.zone, review.scope.difficulty, review.scope.size,
    review.scope.partition, review.scope.patch, review.rulesVersion]);
}

/** Exact identity/rule isolation and latest whole-boss selection precede every view filter. */
function rankingLatest(reviews: RaidBossReview[]) {
  const exclusions: string[] = [], latest = new Map<number, RaidBossReview>();
  let expected: string | null = null;
  for (const review of reviews) {
    const identity = rankingIdentity(review);
    if (identity === null) { exclusions.push("Excluded a review with an invalid identity, raid scope or timestamp."); continue; }
    expected ??= identity;
    if (identity !== expected) { exclusions.push("Excluded a different character, raid scope or rule version."); continue; }
    const prior = latest.get(review.boss.id);
    if (!prior || review.at > prior.at) latest.set(review.boss.id, review);
    if (prior) exclusions.push("Earlier or duplicate whole-boss reviews were withheld; their kills were not merged.");
  }
  return { reviews: [...latest.values()].sort((a, b) => a.boss.id - b.boss.id), exclusions };
}

function rankingPatchReviews(reviews: RaidBossReview[], options: RaidRankingOptions) {
  const latest = rankingLatest(reviews), exclusions = [...latest.exclusions];
  const requested = options.patch ?? "all";
  const patch = requested === "current" ? options.currentPatch ?? latest.reviews[0]?.scope.patch ?? "" : requested;
  const label = requested === "all" ? "All reviewed source patches"
    : requested === "current" ? patch ? `Current patch · ${patch}` : "Current patch unavailable" : `Patch ${patch}`;
  if (typeof patch !== "string" || !patch.trim()) return { reviews: [], patch: "", patchLabel: label, exclusions: [...exclusions, "No explicit current patch is available; historical evidence was not substituted."] };
  const candidates = latest.reviews.map((review) => {
    if (review.reviewedScopes !== undefined && !Array.isArray(review.reviewedScopes)) {
      exclusions.push(`Boss ${review.boss.id}: invalid reviewed source scopes.`); return { ...review, fights: [] };
    }
    const scopes = sourceScopesFor(review);
    const anchorKnown = scopes.some((s) => s.partition === review.scope.partition && s.patch === review.scope.patch);
    if (!anchorKnown) { exclusions.push(`Boss ${review.boss.id}: invalid or conflicting reviewed source scopes.`); return { ...review, fights: [] }; }
    const uniqueFights = new Map<string, RaidFightEvidence>(), conflicts = new Set<string>();
    for (const fight of review.fights) {
      if (!fight || typeof fight.code !== "string" || !/^[A-Za-z0-9]{8,64}$/.test(fight.code)
        || !Number.isSafeInteger(fight.fightID) || fight.fightID <= 0 || !Number.isSafeInteger(fight.actorID) || fight.actorID <= 0
        || !ROLE_ORDER.includes(fight.role) || !Number.isSafeInteger(fight.date) || fight.date <= 0 || !fight.scope
        || !scopes.some((s) => s.partition === fight.scope!.partition && s.patch === fight.scope!.patch)) {
        exclusions.push(`Boss ${review.boss.id}: excluded a fight without an exact reviewed source, role or patch binding.`); continue;
      }
      const id = `${fight.code}:${fight.fightID}`, prior = uniqueFights.get(id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(fight)) conflicts.add(id);
      uniqueFights.set(id, fight);
    }
    if (conflicts.size) exclusions.push(`Boss ${review.boss.id}: conflicting duplicate source fights were excluded.`);
    return { ...review, fights: [...uniqueFights].filter(([id, f]) => !conflicts.has(id) && (patch === "all" || f.scope!.patch === patch)).map(([, f]) => f) };
  });
  const owners = new Map<string, number>(), conflicts = new Set<string>();
  for (const review of candidates) for (const f of review.fights) {
    const id = `${f.code}:${f.fightID}`, owner = owners.get(id);
    if (owner !== undefined && owner !== review.boss.id) conflicts.add(id);
    owners.set(id, review.boss.id);
  }
  if (conflicts.size) exclusions.push("Sources filed under conflicting bosses were excluded.");
  const selected = candidates.map((review) => ({ ...review, fights: review.fights.filter((f) => !conflicts.has(`${f.code}:${f.fightID}`)) })).filter((r) => r.fights.length);
  if (patch !== "all" && !selected.length) exclusions.push(`No verified kills in patch ${patch}; historical evidence was not substituted.`);
  return { reviews: selected, patch, patchLabel: label, exclusions: unique(exclusions) };
}

/** Selects one role before recomputing death-shortened exposure; primary ties use dps, tank, healer. */
export function selectRaidRankingReviews(reviews: RaidBossReview[], options: RaidRankingOptions = {}): RaidRankingSelection {
  const selected = rankingPatchReviews(reviews, options), totals = ROLE_ORDER.map((role) => ({ role,
    present: selected.reviews.some((r) => r.fights.some((f) => f.role === role)),
    kills: selected.reviews.reduce((n, r) => n + gradeBoss({ ...r, fights: r.fights.filter((f) => f.role === role) }).sample.gradedFights, 0) }));
  const present = totals.filter((v) => v.present), maximum = Math.max(-1, ...present.map((v) => v.kills));
  const tied = present.filter((v) => v.kills === maximum), primaryRole = tied[0]?.role ?? null;
  const role = options.role === undefined || options.role === "primary" ? primaryRole : ROLE_ORDER.includes(options.role) ? options.role : null;
  const exclusions = [...selected.exclusions];
  if (tied.length > 1) exclusions.push(`Primary role tie (${tied.map((v) => v.role).join(", ")}) uses fixed dps, tank, healer order; select a role explicitly to compare it.`);
  const filtered = role ? selected.reviews.map((r) => ({ ...r, fights: r.fights.filter((f) => f.role === role) })).filter((r) => r.fights.length) : [];
  if (role && !filtered.length) exclusions.push(`No verified ${role} evidence in this patch view.`);
  return { reviews: filtered, role, primaryRole, tiedRoles: tied.map((v) => v.role), primaryRoleAmbiguous: tied.length > 1,
    patch: selected.patch, patchLabel: selected.patchLabel, exclusions: unique(exclusions) };
}

function rankingDates(fights: RaidFightEvidence[]) {
  const dates = fights.map((f) => f.date);
  return { firstDate: dates.length ? Math.min(...dates) : null, lastDate: dates.length ? Math.max(...dates) : null };
}

/** Additive ranking model. Existing execution scores and penalties remain unchanged. */
export function assessRaidRanking(reviews: RaidBossReview[], options: RaidRankingOptions = {}): RaidRankingAssessment {
  const selected = selectRaidRankingReviews(reviews, options), identityReview = rankingLatest(reviews).reviews[0];
  const bosses = selected.reviews.map((review) => {
    const grade = gradeBoss(review), gradeableKills = grade.sample.gradedFights;
    return { boss: review.boss, score: grade.score, letter: grade.letter, sampledKills: grade.sample.kills, gradeableKills,
      weight: grade.score === null ? 0 : Math.min(gradeableKills, 3), sampleSupported: grade.score !== null && gradeableKills >= 3,
      grade, sourcePatches: unique(review.fights.map((f) => f.scope!.patch)).sort(), ...rankingDates(review.fights) };
  });
  const weight = bosses.reduce((n, b) => n + b.weight, 0), score = weight ? rounded(bosses.reduce((n, b) => n + (b.score ?? 0) * b.weight, 0) / weight) : null;
  const fights = selected.reviews.flatMap((r) => r.fights), utility = combineUtility(bosses.map((b) => b.grade.utility));
  const supportedBosses = bosses.filter((b) => b.sampleSupported).length, broader = supportedBosses >= 4;
  const rankEligible = broader && !((options.role === undefined || options.role === "primary") && selected.primaryRoleAmbiguous);
  return { version: "raid-ranking-assessment-1", identity: identityReview ? { name: identityReview.identity.name, server: identityReview.identity.server, region: identityReview.identity.region } : null,
    role: selected.role, primaryRole: selected.primaryRole, tiedRoles: selected.tiedRoles, primaryRoleAmbiguous: selected.primaryRoleAmbiguous, patch: selected.patch, patchLabel: selected.patchLabel,
    status: score === null ? "ungraded" : "graded", score, letter: executionLetter(score), sample: broader ? "broader" : "limited", sampleLabel: broader ? "Broader sample" : "Limited sample", rankEligible,
    sampledKills: bosses.reduce((n, b) => n + b.sampledKills, 0), gradeableKills: bosses.reduce((n, b) => n + b.gradeableKills, 0), gradedBosses: bosses.filter((b) => b.score !== null).length,
    supportedBosses, bosses, utility, utilityConfidence: !utility.observedFights ? "unavailable" : utility.completeFights === utility.observedFights ? "complete" : "incomplete",
    sourcePatches: unique(fights.map((f) => f.scope!.patch)).sort(), ...rankingDates(fights), exclusions: selected.exclusions, provisional: true,
    summary: score === null ? "No gradeable evidence in the selected role and patch."
      : `${broader ? "Broader sample" : "Limited sample"}: ${supportedBosses} bosses have at least three gradeable kills. Boss weight is capped at three. Utility is descriptive and does not affect this score.` };
}

/** Pairs exact shared kills. Actor IDs stay separate; no opportunities, assignments or missing sources are invented. */
export function compareSharedRaidRanking(aReviews: RaidBossReview[], bReviews: RaidBossReview[], options: RaidRankingOptions = {}): SharedRaidRankingComparison {
  const aSelected = selectRaidRankingReviews(aReviews, options), bSelected = selectRaidRankingReviews(bReviews, options);
  const aAnchor = rankingLatest(aReviews).reviews[0], bAnchor = rankingLatest(bReviews).reviews[0];
  const policy = (r: RaidBossReview | undefined) => r ? JSON.stringify([r.scope.zone, r.scope.difficulty, r.scope.size, r.scope.partition, r.scope.patch, r.rulesVersion]) : null;
  const character = (r: RaidBossReview | undefined) => r ? JSON.stringify([r.identity.name.trim().normalize("NFKC").toLocaleLowerCase("en-US"),
    r.identity.server.trim().normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, ""), r.identity.region.trim().toLocaleLowerCase("en-US")]) : null;
  const sameCharacter = character(aAnchor) !== null && character(aAnchor) === character(bAnchor);
  const role = aSelected.role === bSelected.role ? aSelected.role : null;
  const primaryAmbiguous = (options.role === undefined || options.role === "primary") && (aSelected.primaryRoleAmbiguous || bSelected.primaryRoleAmbiguous);
  const compatible = role !== null && !sameCharacter && !primaryAmbiguous && policy(aAnchor) !== null && policy(aAnchor) === policy(bAnchor);
  const key = (boss: number, f: RaidFightEvidence) => JSON.stringify([boss, f.code, f.fightID, f.role, f.scope!.partition, f.scope!.patch]);
  const bFights = new Map<string, RaidFightEvidence>();
  if (compatible) for (const r of bSelected.reviews) for (const f of r.fights) if (f.kill) bFights.set(key(r.boss.id, f), f);
  const sources: SharedRaidRankingComparison["sources"] = [], keys = new Set<string>(), actorExclusions: string[] = [];
  if (compatible) for (const r of aSelected.reviews) for (const f of r.fights) {
    const id = key(r.boss.id, f), other = bFights.get(id);
    if (!f.kill || !other) continue;
    if (f.actorID === other.actorID) { actorExclusions.push(`Shared source ${f.code}/${f.fightID} binds both characters to the same actor; it was withheld.`); continue; }
    keys.add(id); sources.push({ code: f.code, fightID: f.fightID, bossID: r.boss.id, role: f.role, partition: f.scope!.partition, patch: f.scope!.patch, actorA: f.actorID, actorB: other.actorID });
  }
  const restrict = (selection: RaidRankingSelection) => selection.reviews.map((r) => ({ ...r, fights: r.fights.filter((f) => keys.has(key(r.boss.id, f))) })).filter((r) => r.fights.length);
  const selectedOptions = { ...options, role: role ?? options.role ?? "primary" };
  const assessment = (selection: RaidRankingSelection, anchor: RaidBossReview | undefined) => ({
    ...assessRaidRanking(restrict(selection), { ...selectedOptions, currentPatch: options.currentPatch ?? selection.patch }),
    identity: anchor ? { name: anchor.identity.name, server: anchor.identity.server, region: anchor.identity.region } : null,
    primaryRole: selection.primaryRole, tiedRoles: selection.tiedRoles, primaryRoleAmbiguous: selection.primaryRoleAmbiguous,
  });
  const a = assessment(aSelected, aAnchor), b = assessment(bSelected, bAnchor);
  const compared = sources.length > 0 && a.score !== null && b.score !== null;
  return { version: "shared-raid-ranking-comparison-1", status: compared ? "compared" : "insufficient-evidence",
    reason: sameCharacter ? "Choose two distinct raiders for a shared-kill comparison."
      : !compatible ? "Choose an explicit shared role when primary is ambiguous, with matching raid and rule scope for both raiders."
      : !sources.length ? "No exact shared report, fight, boss, role and reviewed patch evidence."
        : !compared ? "Shared kills exist, but complete gradeable mechanics evidence is insufficient."
          : "Scores use paired source kills only. Each raider's gradeable count and death-shortened exposure may differ; no opportunity or assignment denominator is inferred.",
    role, sharedFights: sources.length, sharedBosses: new Set(sources.map((s) => s.bossID)).size, sources, a, b,
    exclusions: unique([...aSelected.exclusions, ...bSelected.exclusions, ...actorExclusions]), provisional: true };
}
