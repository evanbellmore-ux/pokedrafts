/** Evidence is damage taken, survival and observed utility. Output damage is never collected here. */
export type RaidRole = "dps" | "tank" | "healer";

export interface RaidFightEvidence {
  code: string;
  fightID: number;
  actorID: number;
  spec: string;
  role: RaidRole;
  kill: boolean;
  /** Report start plus fight start, as Unix milliseconds. */
  date: number;
  durationSec: number;
  /** Verified explicit ranking partition for this source kill; never inferred from its date. */
  scope?: { partition: number; patch: string };
  damage: {
    complete: boolean;
    total: number;
    avoidableHealth: number;
    avoidableAbsorbed: number;
    abilities: Array<{
      abilityID: number;
      name: string;
      health: number;
      absorbed: number;
      hits: number;
      /** Adjacent damaging ticks of one ability, separated by no more than five seconds. */
      clusters: number;
      /** Recorded for inspection, but assignments/encounter context prevent blame. */
      contextual: boolean;
    }>;
  };
  survival: {
    complete: boolean;
    deaths: Array<{
      /** Seconds after pull. */
      at: number;
      causeID: number | null;
      causeName: string;
      /** Only a directly attributed death from an independently avoidable mechanic. */
      reviewedAvoidable: boolean;
      raidDeathOrder: number | null;
    }>;
  };
  utility: {
    complete: boolean;
    successfulInterrupts: number;
    dispels: number;
    /** Logged absorbs credited to this actor on OTHER players, excluding self and pets. */
    raidAbsorbed: number;
    absorbAbilities: Array<{ abilityID: number; name: string; amount: number }>;
    /** Usage context only: a cast is not proof of prevention or correct timing. */
    personalCasts: Array<{ abilityID: number; name: string; count: number }>;
  };
  limitations: string[];
}

export interface RaidBossReview {
  version: "raid-execution-review-1";
  key: string;
  at: number;
  rulesVersion: string;
  identity: { name: string; server: string; region: string; className: string };
  scope: { zone: number; encounter: number; difficulty: number; size: number; partition: number; patch: string };
  /** Reviewed source patches; scope above anchors the rule catalog, while fights retain their own patch. */
  reviewedScopes?: Array<{ partition: number; patch: string }>;
  /** Some sampled source patches cover a narrower independently verified mechanic subset. */
  coverageLimited?: boolean;
  boss: { id: number; name: string };
  status: "complete" | "partial" | "unavailable";
  reason: string | null;
  availableKills: number;
  fights: RaidFightEvidence[];
  sampleLimit: 6;
  acquisition?: {
    state: string;
    reason: string | null;
    cached?: boolean;
    [key: string]: unknown;
  };
}

export type ExecutionLetter = "A" | "A−" | "B+" | "B" | "B−" | "C+" | "C" | "C−" | "D" | "F";

export interface ExecutionUtility {
  successfulInterrupts: number;
  dispels: number;
  raidAbsorbed: number;
  completeFights: number;
  observedFights: number;
  absorbAbilities: Array<{ abilityID: number; name: string; amount: number }>;
}

export interface ExecutionGrade {
  status: "graded" | "ungraded";
  letter: ExecutionLetter | null;
  score: number | null;
  provisional: boolean;
  summary: string;
  reasons: string[];
  limitations: string[];
  sample: {
    kills: number;
    progression: number;
    completeFights: number;
    gradedFights: number;
    survivedKills: number;
    deathShortenedFights: number;
  };
  mechanics: {
    incidents: number;
    hits: number;
    health: number;
    absorbed: number;
    contextualIncidents: number;
    cleanKills: number;
    meanIncidentsPerGradedFight: number | null;
  };
  survival: { deaths: number; confirmedAvoidableDeaths: number; contextDeaths: number };
  utility: ExecutionUtility;
}

export interface RaidRoleGrade extends ExecutionGrade {
  role: RaidRole;
  bosses: number;
}

export interface RaidBossGrade extends ExecutionGrade {
  boss: { id: number; name: string };
  key: string;
  roles: RaidRoleGrade[];
}

export interface RaidExecutionGrade {
  version: "raid-execution-grade-1";
  rubric: {
    version: "reviewed-contact-rubric-1";
    label: string;
    description: string;
    thresholds: Array<{ letter: ExecutionLetter; minimum: number }>;
  };
  status: "graded" | "ungraded";
  letter: ExecutionLetter | null;
  score: number | null;
  provisional: boolean;
  summary: string;
  gradedBosses: number;
  totalBosses: number;
  bosses: RaidBossGrade[];
  roles: RaidRoleGrade[];
  utility: ExecutionUtility;
  limitations: string[];
}

export interface RaidContactEvent {
  /** Milliseconds on a common fight timeline. */
  at: number;
  abilityID: number;
  health: number;
  absorbed: number;
}

export interface RaidRankingOptions {
  /** Primary uses most gradeable kills in the selected patch view; ties use dps, tank, healer. */
  role?: "primary" | RaidRole;
  /** "current" resolves only the explicit currentPatch or the review's anchored catalog patch. */
  patch?: "all" | "current" | string;
  currentPatch?: string;
}

export interface RaidRankingSelection {
  reviews: RaidBossReview[];
  role: RaidRole | null;
  primaryRole: RaidRole | null;
  tiedRoles: RaidRole[];
  primaryRoleAmbiguous: boolean;
  patch: string;
  patchLabel: string;
  exclusions: string[];
}

export interface RaidRankingBossAssessment {
  boss: { id: number; name: string };
  score: number | null;
  letter: ExecutionLetter | null;
  sampledKills: number;
  gradeableKills: number;
  /** Capped at three so repeated farming cannot overwhelm encounter balance. */
  weight: number;
  sampleSupported: boolean;
  grade: RaidBossGrade;
  /** Current grading policy; grade above is the retained legacy evidence summary. */
  breakdown: RaidExecutionBreakdown;
  sourcePatches: string[];
  firstDate: number | null;
  lastDate: number | null;
}

export interface RaidExecutionComponent {
  key: "consistency" | "contactControl" | "survival";
  label: string;
  /** Maximum contribution to the 100-point grade. */
  weight: number;
  score: number | null;
  /** Unrounded earned points; round for display only. */
  points: number | null;
}

export interface RaidExecutionBreakdown {
  components: RaidExecutionComponent[];
  gradeableKills: number;
  affectedKills: number;
  contactIncidents: number;
  avoidableFatalKills: number;
  exposureAdjustedKills: number;
  ungradedContextDeaths: number;
}

export interface RaidRankingAssessment {
  version: "raid-ranking-assessment-2";
  rubric: {
    version: "execution-reliability-rubric-2";
    label: string;
    description: string;
    weights: { consistency: number; contactControl: number; survival: number };
    thresholds: Array<{ letter: ExecutionLetter; minimum: number }>;
  };
  breakdown: RaidExecutionBreakdown;
  identity: { name: string; server: string; region: string } | null;
  role: RaidRole | null;
  primaryRole: RaidRole | null;
  tiedRoles: RaidRole[];
  primaryRoleAmbiguous: boolean;
  patch: string;
  patchLabel: string;
  status: "graded" | "ungraded";
  score: number | null;
  letter: ExecutionLetter | null;
  sample: "broader" | "limited";
  sampleLabel: "Broader sample" | "Limited sample";
  rankEligible: boolean;
  sampledKills: number;
  gradeableKills: number;
  gradedBosses: number;
  /** Bosses with at least three gradeable kills, independently of utility completeness. */
  supportedBosses: number;
  bosses: RaidRankingBossAssessment[];
  utility: ExecutionUtility;
  utilityConfidence: "complete" | "incomplete" | "unavailable";
  sourcePatches: string[];
  firstDate: number | null;
  lastDate: number | null;
  exclusions: string[];
  provisional: true;
  summary: string;
}

export interface SharedRaidRankingComparison {
  version: "shared-raid-ranking-comparison-1";
  status: "compared" | "insufficient-evidence";
  reason: string;
  role: RaidRole | null;
  sharedFights: number;
  sharedBosses: number;
  sources: Array<{
    code: string;
    fightID: number;
    bossID: number;
    role: RaidRole;
    partition: number;
    patch: string;
    actorA: number;
    actorB: number;
  }>;
  a: RaidRankingAssessment;
  b: RaidRankingAssessment;
  exclusions: string[];
  provisional: true;
}
