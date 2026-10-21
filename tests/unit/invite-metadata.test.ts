import { describe, expect, it } from "vitest";
import { inviteMetadata } from "@/app/invite/[code]/invite-metadata";
import type { InvitePreview } from "@/app/types/league";

const OPEN: InvitePreview = {
  league_id: "8f3c9c1e-1111-4222-8333-444455556666",
  league_name: "Kanto Classic",
  coach_count: 3,
  max_coaches: 8,
  draft_started: false,
  draft_completed: false,
  already_member: false,
  invite_valid: true,
};

describe("invite link previews", () => {
  it("names the league of a valid invite", () => {
    expect(inviteMetadata(OPEN)).toEqual({
      title: "Join Kanto Classic",
      description:
        "You have been invited to coach in Kanto Classic, a Pokémon draft league on PokeDrafts.",
    });
  });

  it("says when the draft has started", () => {
    const { title, description } = inviteMetadata({ ...OPEN, draft_started: true });
    expect(title).toBe("Kanto Classic");
    expect(description).toMatch(/draft has started, so it is not taking new coaches/);
  });

  it("says when the league is full", () => {
    const { title, description } = inviteMetadata({ ...OPEN, coach_count: 8 });
    expect(title).toBe("Kanto Classic");
    expect(description).toMatch(/It is full\.$/);
  });

  it("does not name the league once the invite is no longer valid", () => {
    // get_invite_preview still returns the name for an expired invite; the
    // page does not show it, so neither does the preview.
    for (const preview of [
      { ...OPEN, invite_valid: false },
      { ...OPEN, league_id: null },
    ]) {
      const { title, description } = inviteMetadata(preview);
      expect(title).toBe("League invite");
      expect(description).toBe(
        "This invite link is no longer valid. Ask the commissioner for a fresh link."
      );
      expect(description).not.toContain("Kanto");
    }
  });

  it("falls back to the generic text when the preview could not be read", () => {
    expect(inviteMetadata(null)).toEqual({
      title: "League invite",
      description: "You have been invited to coach in a PokeDrafts league.",
    });
    expect(inviteMetadata({ ...OPEN, league_name: "  " }).title).toBe("League invite");
  });
});
