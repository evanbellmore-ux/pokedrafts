"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Crown, LogOut, UserMinus } from "lucide-react";
import { useLeague } from "@/app/components/league/LeagueProvider";
import { Button, Dialog, StatusPill } from "@/app/components/ui";
import { roleLabel, teamNameLabel } from "@/app/lib/league/labels";
import { rpc } from "@/app/lib/rpc";
import type { OverviewMember } from "./overview";

export type CoachesListProps = {
  /** Already sorted by draft position, then team name. */
  members: OverviewMember[];
  /** Called after a change to the coaches; resolves once the page reloaded. */
  onChanged: (message: string) => Promise<void>;
};

type PendingAction = {
  kind: "remove" | "transfer" | "leave";
  target: OverviewMember;
};

const DIALOG_COPY = {
  remove: {
    title: (name: string) => `Remove ${name}?`,
    description:
      "They lose their seat and the invite link is replaced, so they cannot rejoin with the old one. Share the new link with anyone who should still join.",
    confirm: "Remove coach",
    danger: true,
  },
  transfer: {
    title: (name: string) => `Make ${name} the commissioner?`,
    description:
      "They take over the league settings, draft controls and results. You stay in the league as a coach.",
    confirm: "Transfer role",
    danger: false,
  },
  leave: {
    title: () => "Leave this league?",
    description:
      "Your seat opens up for another coach. You would need a new invite link to rejoin.",
    confirm: "Leave league",
    danger: true,
  },
} as const;

/**
 * Coaches in draft order with role pills and the pre-draft membership
 * actions: the commissioner can remove a coach or hand over the role, a
 * coach can leave. Every action confirms in a Dialog and goes through an RPC.
 * The buttons repeat their visible text on every row, so each carries an
 * `aria-label` that starts with that text and names the row (WCAG 2.5.3).
 */
export default function CoachesList({ members, onChanged }: CoachesListProps) {
  const router = useRouter();
  const { league, member, isCommissioner } = useLeague();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const preDraft = !league.draft_started;
  const orderSet = members.some((row) => row.draft_position != null);

  function open(kind: PendingAction["kind"], target: OverviewMember) {
    setDialogError(null);
    setPending({ kind, target });
  }

  function close() {
    if (busy) return;
    setPending(null);
    setDialogError(null);
  }

  async function confirm() {
    if (!pending || busy) return;
    const { kind, target } = pending;
    const name = teamNameLabel(target.team_name);

    setBusy(true);
    setDialogError(null);

    const result =
      kind === "remove"
        ? await rpc.removeMember(league.id, target.id)
        : kind === "transfer"
          ? await rpc.transferCommissioner(league.id, target.id)
          : await rpc.leaveLeague(league.id);

    if (result.error) {
      setDialogError(result.error);
      setBusy(false);
      return;
    }

    if (kind === "leave") {
      // The layout will refuse this league from now on; go home.
      router.replace("/dashboard");
      router.refresh();
      return;
    }

    setPending(null);
    if (kind === "transfer") {
      // The server layout re-reads the membership so the nav and every
      // page see the new commissioner.
      router.refresh();
    }
    await onChanged(
      kind === "remove"
        ? `${name} was removed from the league. The invite link was replaced; share the new one with anyone who should still join.`
        : `${name} is now the commissioner.`
    );
    setBusy(false);
  }

  const copy = pending ? DIALOG_COPY[pending.kind] : null;

  return (
    <section
      aria-labelledby="coaches-heading"
      className="rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="coaches-heading" className="text-lg font-semibold text-text">
          Coaches
        </h2>
        <p className="text-sm text-muted">
          {members.length} of {league.max_coaches}
        </p>
      </div>
      {!orderSet && (
        <p className="mt-1 text-sm text-muted">
          {preDraft
            ? "The draft order has not been set yet."
            : "No draft order is recorded for this league."}
        </p>
      )}

      <ul className="mt-3 divide-y divide-line">
        {members.map((row) => {
          const isMe = row.id === member.id;
          const label = roleLabel(row.role);
          const name = teamNameLabel(row.team_name);
          return (
            <li
              key={row.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 truncate font-semibold text-text">
                    {name}
                  </p>
                  <StatusPill tone={label === "Commissioner" ? "accent" : "neutral"}>
                    {label}
                  </StatusPill>
                  {isMe && <StatusPill tone="success">You</StatusPill>}
                </div>
                {orderSet && (
                  <p className="mt-0.5 text-xs text-muted">
                    {row.draft_position != null
                      ? `Draft slot ${row.draft_position}`
                      : "Not in the draft order (spectator)"}
                  </p>
                )}
              </div>

              {preDraft && (
                <div className="flex shrink-0 flex-wrap gap-2">
                  {isCommissioner && !isMe && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => open("transfer", row)}
                        disabled={busy}
                        aria-label={`Make commissioner: ${name}`}
                      >
                        <Crown className="h-4 w-4" aria-hidden="true" />
                        Make commissioner
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => open("remove", row)}
                        disabled={busy}
                        aria-label={`Remove ${name}`}
                      >
                        <UserMinus className="h-4 w-4" aria-hidden="true" />
                        Remove
                      </Button>
                    </>
                  )}
                  {!isCommissioner && isMe && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => open("leave", row)}
                      disabled={busy}
                      aria-label={`Leave league: ${league.name}`}
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      Leave league
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={pending !== null}
        onClose={close}
        title={
          pending && copy
            ? copy.title(teamNameLabel(pending.target.team_name))
            : ""
        }
        description={copy?.description}
        danger={copy?.danger ?? false}
        confirmLabel={copy?.confirm ?? "Confirm"}
        onConfirm={confirm}
        pending={busy}
        error={dialogError}
      />
    </section>
  );
}
