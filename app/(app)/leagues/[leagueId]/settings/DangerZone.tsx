"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { Button, Dialog } from "@/app/components/ui";
import { friendlyError } from "@/app/lib/errors";
import { rpc } from "@/app/lib/rpc";
import { createClient } from "@/app/lib/supabase/client";
import type { League } from "@/app/types/league";

type DangerZoneProps = {
  league: League;
  /** Called after the draft was reset; the parent refreshes and reports. */
  onReset: () => Promise<void>;
};

type DangerAction = "reset" | "delete";

/**
 * Reset draft (`reset_draft`) and delete league (the one direct `leagues`
 * write the policy set allows). Both need the league name typed back; the
 * name checked is the saved one from the league row, never the form field.
 */
export default function DangerZone({ league, onReset }: DangerZoneProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [action, setAction] = useState<DangerAction | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draftStarted = Boolean(league.draft_started);

  function open(next: DangerAction) {
    setError(null);
    setAction(next);
  }

  function close() {
    if (pending) return;
    setAction(null);
    setError(null);
  }

  async function confirmReset() {
    if (pending) return;

    setError(null);
    setPending(true);
    const { error: rpcError } = await rpc.resetDraft(league.id);
    if (rpcError !== null) {
      setError(rpcError);
      setPending(false);
      return;
    }

    await onReset();
    setPending(false);
    setAction(null);
  }

  async function confirmDelete() {
    if (pending) return;

    setError(null);
    setPending(true);
    try {
      // PostgREST reports a delete the policy filtered out as a success with
      // zero rows, so the returned ids are what proves it happened.
      const { data, error: deleteError } = await supabase
        .from("leagues")
        .delete()
        .eq("id", league.id)
        .select("id");
      if (deleteError) {
        setError(friendlyError(deleteError));
        setPending(false);
        return;
      }
      if (!data || data.length === 0) {
        setError(
          "Nothing was deleted. Only the commissioner can delete a league, and it may already be gone."
        );
        setPending(false);
        return;
      }

      // Keep the dialog pending while the dashboard takes over; the page
      // unmounts on navigation.
      router.replace("/dashboard");
      router.refresh();
    } catch (caught) {
      setError(friendlyError(caught));
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="danger-heading"
      className="rounded-xl border border-danger/50 bg-panel p-5"
    >
      <div className="flex items-center gap-2">
        <TriangleAlert className="h-5 w-5 text-danger" aria-hidden="true" />
        <h2 id="danger-heading" className="text-lg font-semibold text-text">
          Danger zone
        </h2>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold text-text">Reset draft</p>
            <p className="mt-1 text-sm text-muted">
              {draftStarted
                ? "Deletes every pick, team, match and news item and reopens the draft. Coaches, the draft order and the draft pool are kept."
                : "The draft has not started, so there is nothing to reset."}
            </p>
          </div>
          <Button
            variant="danger"
            onClick={() => open("reset")}
            disabled={!draftStarted || pending}
            className="sm:shrink-0"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reset draft
          </Button>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold text-text">Delete league</p>
            <p className="mt-1 text-sm text-muted">
              Permanently removes the league for every coach, including its
              invite, draft picks, teams, matches and news.
            </p>
          </div>
          <Button
            variant="danger"
            onClick={() => open("delete")}
            disabled={pending}
            className="sm:shrink-0"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete league
          </Button>
        </div>
      </div>

      <Dialog
        open={action === "reset"}
        onClose={close}
        title="Reset the draft?"
        description={`Every pick, team, match and news item in ${league.name} is deleted and the draft goes back to setup. This cannot be undone.`}
        danger
        confirmText={league.name}
        confirmLabel="Reset draft"
        onConfirm={confirmReset}
        pending={pending}
        error={error}
      />

      <Dialog
        open={action === "delete"}
        onClose={close}
        title="Delete league"
        description={`This permanently removes ${league.name}, including its invite, draft picks, teams, matches and news, for every coach.`}
        danger
        confirmText={league.name}
        confirmLabel="Delete league"
        onConfirm={confirmDelete}
        pending={pending}
        error={error}
      />
    </section>
  );
}
