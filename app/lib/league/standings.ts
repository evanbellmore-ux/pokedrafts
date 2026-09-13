import type { Tiebreaker } from "@/app/types/league";

/**
 * Standings derivation, the TypeScript half of the one definition in
 * docs/release-architecture.md section 12.3 (docs/schema.md, "Standings and
 * playoffs"). `league_standings` in SQL is the other half;
 * `tests/db/playoffs.test.ts` runs both on the same fixtures and requires
 * identical output, so every rule here follows the section to the letter:
 *
 * 1. Win percentage desc, then wins desc.
 * 2. Groups still tied on both are refined, group by group, by the league's
 *    primary tiebreaker, then the other one, then strength of schedule,
 *    then the coin flip. A sub-group that is still tied after a step
 *    continues with the next step (a step is never applied twice).
 *    - Head-to-head: win percentage in completed regular matches between
 *      members of the tied group (0 when a coach has none); higher first.
 *    - Differential: `+winner_remaining` for wins, `-winner_remaining` for
 *      losses (null counts 0); higher first.
 *    - Strength of schedule: mean win percentage of the opponents faced in
 *      completed regular matches, one term per match (0 when none); higher
 *      first.
 *    - Coin flip: member id ascending (byte order, like a Postgres uuid).
 * 3. `seed` is always distinct; `rank` is shared by coaches separated only
 *    by the coin flip, and `tied` marks them. `headToHeadApplied` is true
 *    for every coach of a head-to-head group whose records were not all
 *    equal.
 *
 * Only `stage = 'regular'` matches count (a missing `stage` means regular).
 * Members whose `draft_position` is null and who appear in no match are
 * excluded, like the SQL function does. Percentages (win, head-to-head,
 * strength of schedule) are compared rounded to 3 decimals, half up: the
 * precision of the function's `round(x, 3)` sort keys and of the `win_pct`
 * and `strength_of_schedule` columns it reports, so two coaches never differ
 * only in a digit nobody sees (docs/schema.md, "Standings and playoffs").
 */

export type StandingsMember = {
  id: string;
  team_name: string | null;
  draft_position?: number | null;
};

export type StandingsMatch = {
  home_member_id: string | null;
  away_member_id: string | null;
  status: string | null;
  winner_member_id: string | null;
  /** `league_matches.stage`; absent means a regular-season match. */
  stage?: string | null;
  /** Pokémon the winner had left standing; absent or null counts 0. */
  winner_remaining?: number | null;
};

export type Standing<M extends StandingsMember = StandingsMember> = {
  member: M;
  /** 1..n, always distinct. */
  seed: number;
  /** Shared by coaches separated only by the coin flip. */
  rank: number;
  /** "3", or "T-3" for a coin-flip group. */
  rankLabel: string;
  /** True when separated from another coach only by the coin flip. */
  tied: boolean;
  wins: number;
  losses: number;
  played: number;
  /** Regular matches without a decided result. */
  remaining: number;
  /** wins / played at 3 decimals; 0 before the first result. */
  winPercentage: number;
  differential: number;
  /** 3 decimals; 0 without a completed match. */
  strengthOfSchedule: number;
  /** The coach's position depended on a head-to-head comparison. */
  headToHeadApplied: boolean;
};

type Step = Tiebreaker | "strength_of_schedule" | "coin_flip";

type CompletedMatch = { winner: string; loser: string; remaining: number };

type Record_<M extends StandingsMember> = {
  member: M;
  wins: number;
  losses: number;
  played: number;
  remaining: number;
  differential: number;
  /** Exact wins / played; compared and reported at 3 decimals. */
  ratio: number;
  /**
   * Exact mean of the opponents' exact ratios (the function averages
   * `win_pct_exact`); compared and reported at 3 decimals.
   */
  schedule: number;
  /** One entry per completed regular match: the opponent's id. */
  opponents: string[];
  headToHeadApplied: boolean;
};

/**
 * Rounds to the 3 decimals `league_standings` compares and reports at, half
 * up like Postgres `round(numeric, 3)` on a non-negative value. The small
 * nudge keeps a ratio that is exactly on a boundary in decimal (1/16 =
 * 0.0625) from landing just under it as a double; no ratio of the counts
 * involved sits inexactly within 1e-9 of a boundary.
 */
export function roundPercentage(value: number): number {
  return Math.round(value * 1000 + 1e-9) / 1000;
}

function isRegular(match: Pick<StandingsMatch, "stage">): boolean {
  const stage = (match.stage ?? "regular").trim().toLowerCase();
  return stage === "" || stage === "regular";
}

function isCompleted(match: Pick<StandingsMatch, "status">): boolean {
  return (match.status ?? "").trim().toLowerCase() === "completed";
}

/** The steps after win percentage and wins, in the league's order. */
export function tiebreakerSteps(primary: Tiebreaker): Step[] {
  const secondary: Tiebreaker =
    primary === "differential" ? "head_to_head" : "differential";
  return [primary, secondary, "strength_of_schedule", "coin_flip"];
}

const STEP_PHRASES: Record<Step, string> = {
  head_to_head: "head-to-head",
  differential: "differential",
  strength_of_schedule: "strength of schedule",
  coin_flip: "a coin flip",
};

/** "Tiebreakers: head-to-head, then differential, then ..." in the league's order. */
export function tiebreakerLegend(primary: Tiebreaker): string {
  const phrases = tiebreakerSteps(primary).map((step) => STEP_PHRASES[step]);
  return `Tiebreakers: ${phrases.join(", then ")}`;
}

/** Byte-order comparison, the order Postgres gives a uuid column. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function headToHeadRatio(
  memberId: string,
  group: ReadonlySet<string>,
  completed: CompletedMatch[]
): number {
  let wins = 0;
  let games = 0;
  for (const match of completed) {
    if (match.winner === memberId && group.has(match.loser)) {
      wins += 1;
      games += 1;
    } else if (match.loser === memberId && group.has(match.winner)) {
      games += 1;
    }
  }
  return games > 0 ? roundPercentage(wins / games) : 0;
}

/** Splits `ordered` (already sorted by `key` desc) into runs of equal keys. */
function splitByKey<T>(ordered: T[], key: (item: T) => number): T[][] {
  const groups: T[][] = [];
  for (const item of ordered) {
    const last = groups[groups.length - 1];
    if (last && key(last[0]) === key(item)) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

/**
 * Orders one group of coaches tied on win percentage and wins. Every coach
 * ends up in `out` inside a final group: a singleton, or a coin-flip group
 * whose members share a rank.
 */
function refine<M extends StandingsMember>(
  group: Record_<M>[],
  steps: readonly Step[],
  completed: CompletedMatch[],
  out: Record_<M>[][]
): void {
  if (group.length === 1) {
    out.push(group);
    return;
  }

  const [step, ...rest] = steps;

  if (step === "coin_flip" || step === undefined) {
    // Deterministic, so seeding never changes between calls; the UI calls
    // it a coin flip. Everyone here shares a rank.
    out.push([...group].sort((a, b) => compareIds(a.member.id, b.member.id)));
    return;
  }

  let key: (record: Record_<M>) => number;
  if (step === "head_to_head") {
    const ids = new Set(group.map((record) => record.member.id));
    const ratios = new Map(
      group.map((record) => [
        record.member.id,
        headToHeadRatio(record.member.id, ids, completed),
      ])
    );
    key = (record) => ratios.get(record.member.id) ?? 0;
  } else if (step === "differential") {
    key = (record) => record.differential;
  } else {
    key = (record) => roundPercentage(record.schedule);
  }

  const ordered = [...group].sort((a, b) => key(b) - key(a));
  const subGroups = splitByKey(ordered, key);

  if (step === "head_to_head" && subGroups.length > 1) {
    // The records were not all equal: the comparison placed every coach
    // here relative to the others.
    for (const record of group) record.headToHeadApplied = true;
  }

  for (const subGroup of subGroups) refine(subGroup, rest, completed, out);
}

export function computeStandings<M extends StandingsMember>(
  members: M[],
  matches: StandingsMatch[],
  tiebreaker: Tiebreaker = "head_to_head"
): Standing<M>[] {
  const named = new Set<string>();
  for (const match of matches) {
    if (match.home_member_id) named.add(match.home_member_id);
    if (match.away_member_id) named.add(match.away_member_id);
  }

  const records = new Map<string, Record_<M>>();
  for (const member of members) {
    // A spectator (null position) who plays in no match is not in the
    // standings; a member whose position is unknown is kept.
    if (member.draft_position === null && !named.has(member.id)) continue;
    records.set(member.id, {
      member,
      wins: 0,
      losses: 0,
      played: 0,
      remaining: 0,
      differential: 0,
      ratio: 0,
      schedule: 0,
      opponents: [],
      headToHeadApplied: false,
    });
  }

  const completed: CompletedMatch[] = [];
  for (const match of matches) {
    if (!isRegular(match)) continue;
    const home = match.home_member_id ? records.get(match.home_member_id) : undefined;
    const away = match.away_member_id ? records.get(match.away_member_id) : undefined;
    if (!home || !away) continue;

    const winner =
      isCompleted(match) && match.winner_member_id === home.member.id
        ? home
        : isCompleted(match) && match.winner_member_id === away.member.id
          ? away
          : null;
    if (!winner) {
      home.remaining += 1;
      away.remaining += 1;
      continue;
    }

    const loser = winner === home ? away : home;
    const remaining = match.winner_remaining ?? 0;
    winner.wins += 1;
    winner.differential += remaining;
    loser.losses += 1;
    loser.differential -= remaining;
    for (const side of [home, away]) side.played += 1;
    winner.opponents.push(loser.member.id);
    loser.opponents.push(winner.member.id);
    completed.push({ winner: winner.member.id, loser: loser.member.id, remaining });
  }

  for (const record of records.values()) {
    record.ratio = record.played > 0 ? record.wins / record.played : 0;
  }
  for (const record of records.values()) {
    if (record.opponents.length === 0) continue;
    let total = 0;
    for (const opponent of record.opponents) {
      total += records.get(opponent)?.ratio ?? 0;
    }
    record.schedule = total / record.opponents.length;
  }

  const winKey = (record: Record_<M>) => roundPercentage(record.ratio);
  const ordered = [...records.values()].sort(
    (a, b) => winKey(b) - winKey(a) || b.wins - a.wins
  );
  const steps = tiebreakerSteps(tiebreaker);
  const finalGroups: Record_<M>[][] = [];
  for (const group of splitByKey(ordered, winKey)) {
    for (const byWins of splitByKey(group, (record) => record.wins)) {
      refine(byWins, steps, completed, finalGroups);
    }
  }

  const result: Standing<M>[] = [];
  for (const group of finalGroups) {
    const rank = result.length + 1;
    const tied = group.length > 1;
    for (const record of group) {
      result.push({
        member: record.member,
        seed: result.length + 1,
        rank,
        rankLabel: tied ? `T-${rank}` : String(rank),
        tied,
        wins: record.wins,
        losses: record.losses,
        played: record.played,
        remaining: record.remaining,
        winPercentage: roundPercentage(record.ratio),
        differential: record.differential,
        strengthOfSchedule: roundPercentage(record.schedule),
        headToHeadApplied: record.headToHeadApplied,
      });
    }
  }

  return result;
}

export function formatWinPercentage(value: number): string {
  return value.toFixed(3).replace(/^0/, "");
}

/** "+3", "-2" or "0" for the differential column. */
export function formatDifferential(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
