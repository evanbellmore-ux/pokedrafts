"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import Button from "@/app/components/ui/Button";
import Dialog from "@/app/components/ui/Dialog";
import { SkeletonLines } from "@/app/components/ui/Skeleton";
import { signOutLocally } from "@/app/lib/auth/sign-out";
import { rpc } from "@/app/lib/rpc";
import { createClient } from "@/app/lib/supabase/client";
import type { AccountDeletionPreview } from "@/app/types/account";
import { DELETE_CONFIRM_TEXT, deletionSummary, type SummaryLine } from "./account";

/**
 * Delete account: the danger card and the confirm dialog that lists exactly
 * what is removed, which leagues pass to another coach and what stays
 * (`account_deletion_preview`). The preview is read again when the dialog
 * opens, and `delete_account` works from the same plan under the league
 * locks, so a coach who joined or left in the meantime is accounted for.
 */
export default function DeleteAccount({
  preview,
  email,
  onRefresh,
}: {
  /** Null while the page loads (or after a failed load). */
  preview: AccountDeletionPreview | null;
  email: string | null;
  onRefresh: () => Promise<AccountDeletionPreview | null>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summary = preview ? deletionSummary(preview, email) : null;

  async function openDialog() {
    if (checking) return;
    setChecking(true);
    const fresh = await onRefresh();
    setChecking(false);
    if (fresh) {
      setError(null);
      setOpen(true);
    }
  }

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  async function confirm() {
    if (pending) return;
    setError(null);
    setPending(true);

    const { error: deleteError } = await rpc.deleteAccount();
    if (deleteError !== null) {
      setPending(false);
      setError(deleteError);
      return;
    }

    // The account is gone, sessions included, so signing out only clears
    // this browser; whatever it answers, /login renders for a deleted user.
    await signOutLocally(createClient().auth);
    router.replace("/login?account=deleted");
    router.refresh();
  }

  return (
    <section
      aria-labelledby="delete-account-heading"
      className="rounded-xl border border-danger/50 bg-panel p-5"
    >
      <h2 id="delete-account-heading" className="text-base font-semibold text-text">
        Delete account
      </h2>
      <p className="mt-1 text-sm text-muted">
        Permanently deletes your PokeDrafts account and the data that belongs to
        it. A league you run with other coaches passes to the coach who joined it
        first. This cannot be undone.
      </p>

      {preview === null && <SkeletonLines lines={2} className="mt-4" />}

      <div className="mt-4 flex justify-end">
        <Button
          variant="danger"
          onClick={openDialog}
          disabled={preview === null}
          pending={checking}
          pendingText="Checking..."
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete account
        </Button>
      </div>

      <Dialog
        open={open}
        onClose={close}
        title="Delete your account?"
        description="Your PokeDrafts account is deleted at once and cannot be restored."
        danger
        confirmLabel="Delete account"
        confirmText={DELETE_CONFIRM_TEXT}
        onConfirm={confirm}
        pending={pending}
        error={error}
      >
        {summary && (
          <div className="flex flex-col gap-4 text-sm">
            <SummaryList title="Deleted" lines={summary.removed} />
            <SummaryList title="Handed to another coach" lines={summary.handedOver} />
            <SummaryList title="Kept, with no link to you" lines={summary.kept} />
          </div>
        )}
      </Dialog>
    </section>
  );
}

/** One titled list of the confirm step; renders nothing when it is empty. */
function SummaryList({ title, lines }: { title: string; lines: SummaryLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <h3 className="font-semibold text-text">{title}</h3>
      <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 wrap-anywhere text-muted marker:text-faint">
        {lines.map((line) => (
          <li key={line.key}>{line.text}</li>
        ))}
      </ul>
    </div>
  );
}
