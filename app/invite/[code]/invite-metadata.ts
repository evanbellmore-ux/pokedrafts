import type { InvitePreview } from "@/app/types/league";

/**
 * The title and description an invite link shows when it is pasted into
 * Discord or another chat app. They state what the invite page itself shows
 * a signed-out visitor (`get_invite_preview` is callable without an
 * account), so the league is named only while the invite is valid. `null`
 * means the preview could not be read.
 */
export function inviteMetadata(preview: InvitePreview | null): {
  title: string;
  description: string;
} {
  if (preview && (!preview.invite_valid || !preview.league_id)) {
    return {
      title: "League invite",
      description:
        "This invite link is no longer valid. Ask the commissioner for a fresh link.",
    };
  }

  const name = preview?.league_name?.trim();
  if (!preview || !name) {
    return {
      title: "League invite",
      description: "You have been invited to coach in a PokeDrafts league.",
    };
  }

  if (preview.draft_started) {
    return {
      title: name,
      description: `${name} is a Pokémon draft league on PokeDrafts. Its draft has started, so it is not taking new coaches.`,
    };
  }

  if (preview.coach_count >= preview.max_coaches) {
    return {
      title: name,
      description: `${name} is a Pokémon draft league on PokeDrafts. It is full.`,
    };
  }

  return {
    title: `Join ${name}`,
    description: `You have been invited to coach in ${name}, a Pokémon draft league on PokeDrafts.`,
  };
}
