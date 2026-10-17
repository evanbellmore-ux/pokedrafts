import { assessRaidRanking, selectRaidRankingReviews } from "@/app/api/castmirror/execution/raid/grade";
import type { RaidBossReview, RaidRankingOptions, RaidRole } from "@/app/api/castmirror/execution/raid/types";

type Identity = { name: string; server: string; region: string };
export interface RankingPeer { identity: Identity; reviews: RaidBossReview[] }
export interface RemovalRange {
  cases: number;
  ungradedCases: number;
  scoreMin: number | null;
  scoreMax: number | null;
  rankMin: number | null;
  rankMax: number | null;
}
export interface RankingStability {
  status: "available" | "unavailable";
  baselineScore: number | null;
  baselineRank: number | null;
  role: RaidRole | null;
  killRemoval: RemovalRange;
  bossRemoval: RemovalRange;
  summary: string;
  limitation: string;
}

const identityKey = (identity: Identity) => JSON.stringify([
  identity.name.trim().normalize("NFKC").toLocaleLowerCase("en-US"),
  identity.server.trim().normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, ""),
  identity.region.trim().toLocaleLowerCase("en-US"),
]);
const emptyRange = (): RemovalRange => ({ cases: 0, ungradedCases: 0, scoreMin: null, scoreMax: null, rankMin: null, rankMax: null });
const policy = (review: RaidBossReview | undefined) => review ? JSON.stringify([
  review.scope.zone, review.scope.difficulty, review.scope.size, review.scope.partition, review.scope.patch, review.rulesVersion,
]) : null;

/** A deletion sensitivity check, not a confidence interval or prediction of future performance. */
export function buildRankingStability(reviews: RaidBossReview[], options: RaidRankingOptions, peers: RankingPeer[]): RankingStability {
  const baseline = assessRaidRanking(reviews, options), selected = selectRaidRankingReviews(reviews, options);
  const scores: number[] = [], seen = new Set<string>();
  const self = baseline.identity ? identityKey(baseline.identity) : null;
  const selectedPolicy = policy(selected.reviews[0]);
  for (const peer of peers) {
    const id = identityKey(peer.identity);
    if (id === self || seen.has(id)) continue;
    seen.add(id);
    const assessment = assessRaidRanking(peer.reviews, options);
    const peerPolicy = policy(selectRaidRankingReviews(peer.reviews, options).reviews[0]);
    if (selectedPolicy !== null && peerPolicy === selectedPolicy && assessment.identity && identityKey(assessment.identity) === id && assessment.score !== null) scores.push(assessment.score);
  }
  const rank = (score: number) => scores.filter(value => value > score).length + 1;
  const result: RankingStability = {
    status: baseline.score === null || !selected.role ? "unavailable" : "available",
    baselineScore: baseline.score, baselineRank: baseline.score === null ? null : rank(baseline.score), role: selected.role,
    killRemoval: emptyRange(), bossRemoval: emptyRange(),
    summary: baseline.score === null ? "No graded evidence for a ranking sensitivity check." : "Recalculate after removing each sampled kill or boss once, holding the other raiders fixed.",
    limitation: "These ranges measure sensitivity to saved sample selection, not statistical confidence, future performance or a trend. The selected role stays fixed; patch and evidence rules remain enforced. Removing evidence can leave a variant ungraded.",
  };
  if (result.status === "unavailable") return result;
  const fixedOptions = { ...options, role: selected.role! };
  const inspect = (variants: RaidBossReview[][]): RemovalRange => {
    const variantScores = variants.map(variant => assessRaidRanking(variant, fixedOptions).score);
    const graded = variantScores.filter((value): value is number => value !== null), ranks = graded.map(rank);
    return { cases: variants.length, ungradedCases: variants.length - graded.length,
      scoreMin: graded.length ? Math.min(...graded) : null, scoreMax: graded.length ? Math.max(...graded) : null,
      rankMin: ranks.length ? Math.min(...ranks) : null, rankMax: ranks.length ? Math.max(...ranks) : null };
  };
  result.killRemoval = inspect(selected.reviews.flatMap((review, reviewIndex) => review.fights.map((_, fightIndex) => selected.reviews.map((candidate, index) =>
    index === reviewIndex ? { ...candidate, fights: candidate.fights.filter((__, i) => i !== fightIndex) } : candidate))));
  result.bossRemoval = inspect(selected.reviews.map((_, index) => selected.reviews.filter((__, i) => i !== index)));
  return result;
}
