"use client";

import { useState } from "react";
import { Crown, UserMinus, Users } from "lucide-react";
import { Button, Dialog, StatusPill } from "@/app/components/ui";
import { roleLabel, teamNameLabel } from "@/app/lib/league/labels";
import { rpc } from "@/app/lib/rpc";
import type { League } from "@/app/types/league";
import { compareTeamNames, type SettingsMember } from "./helpers";

type CoachesCardProps = {
  league: League;
  members: SettingsMember[];
  currentUserId: string;
  /** Called after a coach was removed; the parent reloads and reports. */
  onRemoved: (member: SettingsMember) => Promise<void>;
  /** Called after the league was handed over; the parent refreshes and reports. */
  onTransferred: (member: SettingsMember) => Promise<void>;
};

type CoachAction =
  | { kind: "remove"; member: SettingsMember }
  | { kind: "transfer"; member: SettingsMember };

function joinedLabel(joinedAt: string | null): string | null {
  if (!joinedAt) return null;
  const date = new Date(joinedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Coach management for the commissioner: remove a coach before the draft
 * (`remove_member`, which also rotates the invite code so the removed coach's
 * link is dead; the parent reloads the invite row) or hand the league to
 * another coach (`transfer_commissioner`).
 */
export default function CoachesCard({
  league,
  members,
  currentUserId,
  onRemoved,
  onTransferred,
}: CoachesCardProps) {
  const [action, setAction] = useState<CoachAction | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draftStarted = Boolean(league.draft_started);
  const sorted = [...members].sort((a, b) => {
    if (a.user_id === league.commissioner_id) return -1;
    if (b.user_id === league.commissioner_id) return 1;
    return compareTeamNames(a, b);
  });

  function open(next: CoachAction) {
    setError(null);
    setAction(next);
  }

  function close() {
    if (pending) return;
    setAction(null);
    setError(null);
  }

  async function confirm() {
    if (!action || pending) return;

    setError(null);
    setPending(true);
    const { error: rpcError } =
      action.kind === "remove"
        ? await rpc.removeMember(league.id, action.member.id)
        : await rpc.transferCommissioner(league.id, action.member.id);
    if (rpcError !== null) {
      setError(rpcError);
      setPending(false);
      return;
    }

    if (action.kind === "remove") await onRemoved(action.member);
    else await onTransferred(action.member);
    setPending(false);
    setAction(null);
  }

  const actionName = action ? teamNameLabel(action.member.team_name) : "";

  return (
    <section
      aria-labelledby="coaches-heading"
      className="rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-accent-text" aria-hidden="true" />
          <h2 id="coaches-heading" className="text-lg font-semibold text-text">
            Coaches
          </h2>
        </div>
        <p className="text-sm text-muted">
          {members.length} of {league.max_coaches}
        </p>
      </div>
      <p className="mt-2 text-sm text-muted">
        {draftStarted
          ? "Coaches can no longer be removed because the draft has started. You can still hand the league to another coach."
          : "Remove a coach who is not taking part, or hand the league to another coach."}
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {sorted.map((member) => {
          const isSelf = member.user_id === currentUserId;
          const isCommissioner = member.user_id === league.commissioner_id;
          const teamName = teamNameLabel(member.team_name);
          const joined = joinedLabel(member.joined_at);
          return (
            <li
              key={member.id}
              className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="min-w-0 truncate font-semibold text-text">{teamName}</span>
                  <StatusPill tone={isCommissioner ? "accent" : "neutral"}>
                    {roleLabel(member.role)}
                  </StatusPill>
                  {isSelf && <StatusPill tone="accent">You</StatusPill>}
                </p>
                {joined && <p className="text-xs text-muted">Joined {joined}</p>}
              </div>
              {!isSelf && (
                <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => open({ kind: "transfer", member })}
                    disabled={pending}
                    aria-label={`Make commissioner: ${teamName}`}
                  >
                    <Crown className="h-4 w-4" aria-hidden="true" />
                    Make commissioner
                  </Button>
                  {!draftStarted && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => open({ kind: "remove", member })}
                      disabled={pending}
                      aria-label={`Remove ${teamName} from the league`}
                    >
                      <UserMinus className="h-4 w-4" aria-hidden="true" />
                      Remove
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={action?.kind === "remove"}
        onClose={close}
        title="Remove coach"
        description={`Remove ${actionName} from ${league.name}? The invite link is replaced at the same time, so they cannot rejoin with the old one. Share the new link with anyone who should still join.`}
        danger
        confirmLabel="Remove coach"
        onConfirm={confirm}
        pending={pending}
        error={error}
      />

      <Dialog
        open={action?.kind === "transfer"}
        onClose={close}
        title="Make commissioner"
        description={`Hand ${league.name} to ${actionName}? They take over these settings and you become a coach. Only they can hand it back.`}
        danger
        confirmLabel="Make commissioner"
        onConfirm={confirm}
        pending={pending}
        error={error}
      />
    </section>
  );
}
