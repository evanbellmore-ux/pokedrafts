import { pluralize, teamNameLabel } from "@/app/lib/league/labels";
import type { AccountDeletionPreview } from "@/app/types/account";

/** One line of the confirm step; `key` stays unique when two leagues share a name. */
export type SummaryLine = { key: string; text: string };

/**
 * The confirm step of Delete account in plain words: what goes, which
 * leagues pass to another coach, and what stays without any link to the
 * person (docs/release-architecture.md section 17). Built from
 * `account_deletion_preview()`, the same plan `delete_account()` carries out,
 * so the dialog says exactly what happens.
 */
export type DeletionSummary = {
  removed: SummaryLine[];
  handedOver: SummaryLine[];
  kept: SummaryLine[];
};

export function deletionSummary(
  preview: AccountDeletionPreview,
  email: string | null
): DeletionSummary {
  const removed: SummaryLine[] = [
    {
      key: "account",
      text: email
        ? `Your sign-in and your email address (${email})`
        : "Your sign-in and your email address",
    },
    ...(preview.site_admin
      ? [{ key: "site-admin", text: "Your site admin access (reviewing Watch listings)" }]
      : []),
    ...preview.deleted_leagues.map((league) => ({
      key: `league:${league.league_id}`,
      text: `${league.league_name}, which only you coach, with everything in it`,
    })),
    ...preview.removed_teams.map((team) => ({
      key: `team:${team.league_id}`,
      text: `Your place in ${team.league_name}, whose draft has not started`,
    })),
  ];
  if (preview.draft_formats > 0) {
    removed.push({
      key: "formats",
      text: `${pluralize(preview.draft_formats, "draft format")} you saved (leagues keep their own copy of their pool)`,
    });
  }
  if (preview.chat_messages > 0) {
    removed.push({ key: "chat", text: pluralize(preview.chat_messages, "draft chat message") });
  }

  const handedOver = preview.handed_over_leagues.map((league) => ({
    key: `handed:${league.league_id}`,
    text: `${league.league_name}: ${teamNameLabel(league.new_commissioner_team)}, the coach who joined it first, becomes commissioner`,
  }));

  const kept = preview.kept_teams.map((team) => ({
    key: `kept:${team.league_id}`,
    text: `${teamNameLabel(team.team_name)} in ${team.league_name}: its roster and results stay, so the other coaches keep their matches and standings`,
  }));

  return { removed, handedOver, kept };
}

/** The text a person types to confirm the deletion. */
export const DELETE_CONFIRM_TEXT = "DELETE";
