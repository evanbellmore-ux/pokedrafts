"use client";

import { useRef, useState, type FormEvent } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { useLeague } from "@/app/components/league/LeagueProvider";
import { Alert, Button, Dialog, Field, Input } from "@/app/components/ui";
import { pluralize } from "@/app/lib/league/labels";
import { rpc } from "@/app/lib/rpc";
import { inviteUrl, type OverviewInvite } from "./overview";

export type InviteCardProps = {
  invite: OverviewInvite | null;
  coachCount: number;
  /** Called after `regenerate_invite` succeeded; resolves once the page reloaded. */
  onRegenerated: (message: string) => Promise<void>;
};

/**
 * Commissioner-only invite card, shown while the draft has not started.
 * Copy uses the async clipboard and falls back to selecting the link.
 */
export default function InviteCard({
  invite,
  coachCount,
  onRegenerated,
}: InviteCardProps) {
  const { league } = useLeague();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const url = invite ? inviteUrl(invite.invite_code) : "";
  const seats = Math.max(0, league.max_coaches - coachCount);

  async function copyLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url) return;

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopyStatus("Invite link copied to the clipboard.");
        return;
      }
    } catch {
      // Clipboard access can be denied (insecure context, permissions).
      // Fall through to the manual path.
    }

    const input = inputRef.current;
    input?.focus();
    input?.select();
    setCopyStatus(
      "Copying was blocked by the browser. The link is selected, so press Ctrl+C (Cmd+C on a Mac) to copy it."
    );
  }

  function openConfirm() {
    setDialogError(null);
    setConfirming(true);
  }

  function closeConfirm() {
    if (pending) return;
    setConfirming(false);
    setDialogError(null);
  }

  async function regenerate() {
    if (pending) return;
    setPending(true);
    setDialogError(null);

    const { error } = await rpc.regenerateInvite(league.id);
    if (error) {
      setDialogError(error);
      setPending(false);
      return;
    }

    setConfirming(false);
    setCopyStatus(null);
    await onRegenerated(
      invite
        ? "New invite link created. The old link no longer works."
        : "Invite link created."
    );
    setPending(false);
  }

  return (
    <section
      id="invite"
      aria-labelledby="invite-heading"
      className="scroll-mt-24 rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="invite-heading" className="text-lg font-semibold text-text">
            Invite coaches
          </h2>
          <p className="mt-1 text-sm text-muted">
            {seats > 0
              ? `${pluralize(seats, "seat")} remaining. Share this link with the coaches you want in the league.`
              : "Every seat is taken. Raise the coach limit in Settings to invite more coaches."}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={openConfirm}
          pending={pending}
          pendingText="Working..."
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {invite ? "Regenerate link" : "Create invite link"}
        </Button>
      </div>

      {invite ? (
        <form
          onSubmit={copyLink}
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <Field label="Invite link" className="min-w-0 flex-1">
            <Input
              ref={inputRef}
              readOnly
              value={url}
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
            />
          </Field>
          <Button type="submit" className="shrink-0">
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy link
          </Button>
        </form>
      ) : (
        <Alert variant="warning" className="mt-4">
          This league has no invite link yet. Create one to invite coaches.
        </Alert>
      )}

      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-muted">
        {copyStatus}
      </p>

      <Dialog
        open={confirming}
        onClose={closeConfirm}
        title={invite ? "Regenerate invite link?" : "Create an invite link?"}
        description={
          invite
            ? "The current link stops working immediately. Coaches who already joined keep their seats."
            : "Anyone with the link can join this league until the draft starts."
        }
        danger={Boolean(invite)}
        confirmLabel={invite ? "Regenerate link" : "Create link"}
        onConfirm={regenerate}
        pending={pending}
        error={dialogError}
      />
    </section>
  );
}
