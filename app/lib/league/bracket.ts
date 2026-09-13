import {
  playoffMatchName,
  playoffRoundName,
  teamNameLabel,
} from "@/app/lib/league/labels";
import type {
  BracketSlot,
  LeagueMatch,
  PlayoffFormat,
  Tiebreaker,
} from "@/app/types/league";

/**
 * Shared helpers for the playoff bracket (docs/release-architecture.md
 * sections 12.2 and 12.4). The bracket lives in `league_matches` with
 * `stage = 'playoff'`; every match carries its seeds and the slot its winner
 * advances to (`feeds_match_id` / `feeds_slot`). The client never builds a
 * bracket itself, it only reads the rows the functions wrote.
 */

/** The columns the bracket helpers read from a match row. */
export type BracketMatch = Pick<
  LeagueMatch,
  | "id"
  | "round_number"
  | "match_number"
  | "stage"
  | "status"
  | "home_member_id"
  | "away_member_id"
  | "winner_member_id"
  | "home_seed"
  | "away_seed"
  | "feeds_match_id"
  | "feeds_slot"
>;

export type BracketMember = { id: string; team_name: string | null };

/** A coach who sits out a round because of a bye (the top seeds in `top_6`). */
export type BracketBye = { memberId: string; seed: number | null };

export type BracketRound<M extends BracketMatch = BracketMatch> = {
  roundNumber: number;
  /** "Quarterfinals", "Semifinals" or "Final" (section 12.1). */
  name: string;
  matches: M[];
  byes: BracketBye[];
};

/** What an empty or filled bracket slot holds. */
export type SlotInfo<M extends BracketMatch = BracketMatch> =
  | { kind: "member"; memberId: string; seed: number | null }
  | { kind: "winner_of"; feeder: M }
  | { kind: "bye" };

const PLAYOFF_SIZES: Record<PlayoffFormat, number> = {
  none: 0,
  top_2: 2,
  top_4: 4,
  top_6: 6,
  top_8: 8,
};

/** Coaches a format takes into the bracket; 0 for `none`. */
export function playoffSize(format: string | null | undefined): number {
  return format && format in PLAYOFF_SIZES
    ? PLAYOFF_SIZES[format as PlayoffFormat]
    : 0;
}

/** Normalises a raw `playoff_format` value; unknown values mean no playoffs. */
export function toPlayoffFormat(value: string | null | undefined): PlayoffFormat {
  return value && value in PLAYOFF_SIZES ? (value as PlayoffFormat) : "none";
}

/** Normalises a raw `tiebreaker` value; unknown values mean head-to-head first. */
export function toTiebreaker(value: string | null | undefined): Tiebreaker {
  return value === "differential" ? "differential" : "head_to_head";
}

export function isPlayoffMatch(match: Pick<BracketMatch, "stage">): boolean {
  return (match.stage ?? "").trim().toLowerCase() === "playoff";
}

export function isMatchCompleted(match: Pick<BracketMatch, "status">): boolean {
  return (match.status ?? "").trim().toLowerCase() === "completed";
}

export function playoffMatches<M extends Pick<BracketMatch, "stage">>(
  matches: M[]
): M[] {
  return matches.filter(isPlayoffMatch);
}

export function regularMatches<M extends Pick<BracketMatch, "stage">>(
  matches: M[]
): M[] {
  return matches.filter((match) => !isPlayoffMatch(match));
}

/** True when both sides are decided (section 12.4: a null side is "waiting"). */
export function isPlayable(
  match: Pick<BracketMatch, "home_member_id" | "away_member_id">
): boolean {
  return match.home_member_id !== null && match.away_member_id !== null;
}

function compareMatches(a: BracketMatch, b: BracketMatch): number {
  return a.round_number - b.round_number || a.match_number - b.match_number;
}

/**
 * The size of a full round at a match's distance from the final (1 for the
 * final, 2 for the semifinals, 4 for the quarterfinals), the argument
 * `playoffRoundName` takes. Distance, not the number of matches on file,
 * decides the name: in `top_6` the first round holds only two matches
 * because seeds 1 and 2 have a bye, and it is still the Quarterfinals.
 */
export function roundSizeAtDistance(
  match: Pick<BracketMatch, "round_number">,
  matches: Pick<BracketMatch, "round_number" | "stage">[]
): number {
  const lastRound = playoffMatches(matches).reduce(
    (max, candidate) => Math.max(max, candidate.round_number),
    match.round_number
  );
  return 2 ** Math.max(0, lastRound - match.round_number);
}

/** The match whose winner fills `side` of `match`, if any. */
export function feederOf<M extends BracketMatch>(
  match: Pick<BracketMatch, "id">,
  side: BracketSlot,
  matches: M[]
): M | null {
  return (
    matches.find(
      (candidate) =>
        candidate.feeds_match_id === match.id && candidate.feeds_slot === side
    ) ?? null
  );
}

/**
 * Groups the playoff matches into named rounds, first round to final. A
 * round's byes are the coaches already placed in the next round whose slot
 * no match of this round feeds (seeds 1 and 2 in `top_6`).
 */
export function bracketRounds<M extends BracketMatch>(
  matches: M[]
): BracketRound<M>[] {
  const playoff = playoffMatches(matches).sort(compareMatches);
  const byRound = new Map<number, M[]>();
  for (const match of playoff) {
    const list = byRound.get(match.round_number) ?? [];
    list.push(match);
    byRound.set(match.round_number, list);
  }

  const ordered = [...byRound.entries()].sort(([a], [b]) => a - b);
  const rounds = ordered.map(([roundNumber, roundMatches], index) => ({
    roundNumber,
    name: playoffRoundName(2 ** (ordered.length - 1 - index)),
    matches: roundMatches,
    byes: [] as BracketBye[],
  }));

  rounds.forEach((round, index) => {
    const next = rounds[index + 1];
    if (!next) return;
    for (const match of next.matches) {
      for (const side of ["home", "away"] as const) {
        const memberId = side === "home" ? match.home_member_id : match.away_member_id;
        if (!memberId || feederOf(match, side, playoff)) continue;
        round.byes.push({
          memberId,
          seed: side === "home" ? match.home_seed : match.away_seed,
        });
      }
    }
    round.byes.sort((a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity));
  });

  return rounds;
}

/** "Final", "Semifinal 1", "Quarterfinal 2" for a playoff match. */
export function playoffMatchLabel(
  match: Pick<BracketMatch, "round_number" | "match_number">,
  matches: Pick<BracketMatch, "round_number" | "stage">[]
): string {
  return playoffMatchName(roundSizeAtDistance(match, matches), match.match_number);
}

export function slotInfo<M extends BracketMatch>(
  match: M,
  side: BracketSlot,
  matches: M[]
): SlotInfo<M> {
  const memberId = side === "home" ? match.home_member_id : match.away_member_id;
  if (memberId) {
    return {
      kind: "member",
      memberId,
      seed: side === "home" ? match.home_seed : match.away_seed,
    };
  }
  const feeder = feederOf(match, side, matches);
  return feeder ? { kind: "winner_of", feeder } : { kind: "bye" };
}

/** "Seed 3 · Team", "Winner of Quarterfinal 2" or "Bye" (section 12.6). */
export function slotLabel<M extends BracketMatch>(
  match: M,
  side: BracketSlot,
  matches: M[],
  members: BracketMember[]
): string {
  const info = slotInfo(match, side, matches);
  switch (info.kind) {
    case "member": {
      const member = members.find((candidate) => candidate.id === info.memberId);
      const name = member ? teamNameLabel(member.team_name) : "Unknown team";
      return info.seed === null ? name : `Seed ${info.seed} · ${name}`;
    }
    case "winner_of":
      return `Winner of ${playoffMatchLabel(info.feeder, matches)}`;
    default:
      return "Bye";
  }
}

/** The completed playoff match a coach lost, or null while they are alive. */
export function eliminationMatch<M extends BracketMatch>(
  matches: M[],
  memberId: string
): M | null {
  return (
    playoffMatches(matches).find(
      (match) =>
        isMatchCompleted(match) &&
        match.winner_member_id !== null &&
        match.winner_member_id !== memberId &&
        (match.home_member_id === memberId || match.away_member_id === memberId)
    ) ?? null
  );
}

/** "Semifinals" for the round a coach went out in, or null while alive. */
export function eliminationRoundName<M extends BracketMatch>(
  matches: M[],
  memberId: string
): string | null {
  const lost = eliminationMatch(matches, memberId);
  return lost ? playoffRoundName(roundSizeAtDistance(lost, matches)) : null;
}

/** The coach's next undecided playoff match, playable or waiting, or null. */
export function nextPlayoffMatchFor<M extends BracketMatch>(
  matches: M[],
  memberId: string
): M | null {
  return (
    playoffMatches(matches)
      .filter(
        (match) =>
          !isMatchCompleted(match) &&
          (match.home_member_id === memberId || match.away_member_id === memberId)
      )
      .sort(compareMatches)[0] ?? null
  );
}

/** True when the coach has a seat somewhere in the bracket. */
export function isInBracket<M extends BracketMatch>(
  matches: M[],
  memberId: string
): boolean {
  return playoffMatches(matches).some(
    (match) => match.home_member_id === memberId || match.away_member_id === memberId
  );
}

/** True once a playoff result exists (regular-season results are then locked). */
export function playoffResultsExist<M extends Pick<BracketMatch, "stage" | "status">>(
  matches: M[]
): boolean {
  return playoffMatches(matches).some(isMatchCompleted);
}

/**
 * True when the regular season has a schedule and every regular match is
 * final, the point where the functions create the bracket.
 */
export function regularSeasonComplete<
  M extends Pick<BracketMatch, "stage" | "status">,
>(matches: M[]): boolean {
  const regular = regularMatches(matches);
  return regular.length > 0 && regular.every(isMatchCompleted);
}
