"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, Copy, Link2, RefreshCw } from "lucide-react";
import { Alert, Button, Dialog, Field, Input } from "@/app/components/ui";
import { rpc } from "@/app/lib/rpc";
import type { League, LeagueInvite } from "@/app/types/league";

type InviteCardProps = {
  league: League;
  invite: LeagueInvite | null;
  memberCount: number;
  /** Called after a new code was issued; the parent reloads and reports. */
  onRegenerated: (code: string) => Promise<void>;
};

const subscribeNoop = () => () => {};

/** The page origin, empty during server rendering so hydration matches. */
function useOrigin() {
  return useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => ""
  );
}

/**
 * Invite link for the commissioner: copy it or replace it
 * (`regenerate_invite`) with the same confirmation the overview uses. Once
 * the draft has started `join_league` refuses new coaches, so the link and
 * its buttons are hidden and only the seat count remains.
 */
export default function InviteCard({
  league,
  invite,
  memberCount,
  onRegenerated,
}: InviteCardProps) {
  const origin = useOrigin();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const link = invite
    ? `${origin}/invite/${encodeURIComponent(invite.invite_code)}`
    : "";
  const full = memberCount >= league.max_coaches;
  const closed = Boolean(league.draft_started);

  async function copyLink() {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      inputRef.current?.select();
      setCopyError("Could not copy automatically. The link is selected; copy it by hand.");
    }
  }

  async function regenerate() {
    if (pending) return;

    setError(null);
    setPending(true);
    const { data, error: rpcError } = await rpc.regenerateInvite(league.id);
    if (rpcError !== null) {
      setError(rpcError);
      setPending(false);
      return;
    }

    setCopied(false);
    await onRegenerated(data ?? "");
    setPending(false);
    setConfirmOpen(false);
  }

  function closeConfirm() {
    if (pending) return;
    setConfirmOpen(false);
    setError(null);
  }

  return (
    <section
      aria-labelledby="invite-heading"
      className="rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex items-center gap-2">
        <Link2 className="h-5 w-5 text-accent-text" aria-hidden="true" />
        <h2 id="invite-heading" className="text-lg font-semibold text-text">
          Invite link
        </h2>
      </div>
      <p className="mt-2 text-sm text-muted">
        {closed
          ? `${memberCount} of ${league.max_coaches} seats are taken.`
          : `Share this link with coaches you want in the league. ${memberCount} of ${league.max_coaches} seats are taken.`}
      </p>

      {closed ? (
        <Alert variant="info" className="mt-4">
          The draft has started, so new coaches can no longer join and the
          invite link is closed.
        </Alert>
      ) : full ? (
        <Alert variant="warning" className="mt-4">
          The league is full. Raise the coach limit in the settings above to
          let more coaches join.
        </Alert>
      ) : null}

      {closed ? null : invite ? (
        <div className="mt-4 flex flex-col gap-3">
          <Field label="Invite link">
            <Input
              ref={inputRef}
              readOnly
              value={link}
              onFocus={(event) => event.target.select()}
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={copyLink} disabled={!link}>
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setError(null);
                setConfirmOpen(true);
              }}
              disabled={pending}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Regenerate link
            </Button>
            <span role="status" className="text-sm text-muted">
              {copied ? "Copied to the clipboard." : ""}
            </span>
          </div>
          {copyError && <Alert variant="warning">{copyError}</Alert>}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <Alert variant="warning">
            This league has no invite link yet. Generate one to let coaches
            join.
          </Alert>
          <div>
            <Button
              variant="secondary"
              onClick={regenerate}
              pending={pending}
              pendingText="Generating..."
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Generate invite link
            </Button>
          </div>
          {error && <Alert variant="error">{error}</Alert>}
        </div>
      )}

      <Dialog
        open={confirmOpen}
        onClose={closeConfirm}
        title="Regenerate invite link?"
        description="The current link stops working immediately. Coaches who already joined keep their seats."
        danger
        confirmLabel="Regenerate link"
        onConfirm={regenerate}
        pending={pending}
        error={error}
      />
    </section>
  );
}
