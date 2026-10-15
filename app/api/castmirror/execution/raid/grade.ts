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

export function gradeBoss(review: RaidBossReview): RaidBossGrade {
  const limitations = review.status !== "complete" ? [`Boss review is ${review.status}${review.reason ? `: ${review.reason}` : "."}`] : [];
  const grade = summarizeFights(review.fights, limitations);
  const roles = ROLE_ORDER.filter((role) => review.fights.some((fight) => fight.role === role)).map((role) => ({
    ...summarizeFights(review.fights.filter((fight) => fight.role === role), limitations),
    role,
    bosses: 1,
  }));
  return { ...grade, provisional: grade.provisional || review.status !== "complete", boss: review.boss, key: review.key, roles };
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
