import { describe, expect, it } from "vitest";
import {
  leaguePhase,
  ordinal,
  PHASE_PILL,
  playingMembers,
  rankPhrase,
} from "@/app/(app)/leagues/[leagueId]/season";

/**
 * The league phases behind the overview status card, the overview header
 * pill and the standings page (docs/release-architecture.md section 12.6):
 * `playoffs` while a bracket exists without a champion, `complete` once
 * `champion_member_id` is set, whatever the playoff format.
 */

type LeagueFlags = {
  draft_started: boolean | null;
  draft_completed: boolean | null;
  champion_member_id: string | null;
};

function league(overrides: Partial<LeagueFlags> = {}): LeagueFlags {
  return {
    draft_started: true,
    draft_completed: true,
    champion_member_id: null,
    ...overrides,
  };
}

const regularOpen = { status: "upcoming", stage: "regular" };
const regularFinal = { status: "completed", stage: "regular" };
const playoffOpen = { status: "upcoming", stage: "playoff" };
const playoffFinal = { status: "completed", stage: "playoff" };

describe("leaguePhase", () => {
  it("is setup before the draft starts and drafting until it completes", () => {
    expect(leaguePhase(league({ draft_started: false, draft_completed: false }), [])).toBe("setup");
    expect(leaguePhase(league({ draft_started: null, draft_completed: null }), [])).toBe("setup");
    expect(leaguePhase(league({ draft_completed: false }), [])).toBe("drafting");
  });

  it("is season after the draft, including a finished regular season waiting for its bracket", () => {
    expect(leaguePhase(league(), [])).toBe("season");
    expect(leaguePhase(league(), [regularOpen, regularFinal])).toBe("season");
    expect(leaguePhase(league(), [regularFinal, regularFinal])).toBe("season");
  });

  it("is playoffs while playoff matches exist and no champion is set", () => {
    expect(leaguePhase(league(), [regularFinal, playoffOpen])).toBe("playoffs");
    expect(leaguePhase(league(), [regularFinal, playoffFinal, playoffOpen])).toBe("playoffs");
  });

  it("is complete once the champion is set, with or without a bracket", () => {
    expect(leaguePhase(league({ champion_member_id: "m1" }), [regularFinal, playoffFinal])).toBe(
      "complete"
    );
    // A league without playoffs: the function names the top seed when the
    // last regular result lands, so no playoff match ever exists.
    expect(leaguePhase(league({ champion_member_id: "m1" }), [regularFinal])).toBe("complete");
    expect(leaguePhase(league({ champion_member_id: "m1" }), [])).toBe("complete");
  });

  it("never reports complete or playoffs before the draft is over", () => {
    expect(
      leaguePhase(league({ draft_completed: false, champion_member_id: "m1" }), [playoffFinal])
    ).toBe("drafting");
  });
});

describe("PHASE_PILL", () => {
  it("has the section 12.6 labels for the new phases", () => {
    expect(PHASE_PILL.playoffs.label).toBe("Playoffs underway");
    expect(PHASE_PILL.complete.label).toBe("Season complete");
    expect(PHASE_PILL.complete.tone).toBe("success");
    expect(PHASE_PILL.season.label).toBe("Season underway");
  });
});

describe("playingMembers", () => {
  const members = [
    { id: "a", draft_position: 1 },
    { id: "b", draft_position: null },
    { id: "c", draft_position: null },
  ];

  it("keeps the draft order plus anyone named in a match, ignoring empty playoff slots", () => {
    const playing = playingMembers(members, [
      { home_member_id: "b", away_member_id: null },
      { home_member_id: null, away_member_id: null },
    ]);
    expect(playing.map((member) => member.id)).toEqual(["a", "b"]);
  });

  it("falls back to everyone when nobody is positioned or named", () => {
    const nobody = [
      { id: "x", draft_position: null },
      { id: "y", draft_position: null },
    ];
    expect(playingMembers(nobody, [])).toEqual(nobody);
  });
});

describe("ordinals", () => {
  it("formats ranks and tie phrases", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(rankPhrase(3, false)).toBe("3rd");
    expect(rankPhrase(3, true)).toBe("tied for 3rd");
  });
});
