"use client";

import { memo, useId, useState } from "react";
import { Alert, Button, Dialog, Field, Select } from "@/app/components/ui";
import { teamNameLabel } from "@/app/lib/league/labels";
import type { DraftPokemon } from "@/app/types/draft";
import type { DraftPick, LeagueMember } from "@/app/types/league";
import type { DraftPhase } from "./draft-room";
import type { DraftAction } from "./useDraftRoom";

type DialogKind = "undo" | "force" | "reset";

/**
 * What an open dialog acts on, captured when it opens. The room reloads on
 * every realtime event and every client runs the auto-pick when the clock
 * hits 0, so the pick a dialog was opened for can be gone by the time the
 * commissioner confirms; the target lets the dialog notice and close.
 */
type DialogTarget =
  | { kind: "undo"; pickId: string }
  | { kind: "force"; pickNumber: number; onClockId: string }
  | { kind: "reset" };

type DialogState = DialogTarget & {
  /** True from Confirm until the action settles; the target changes then by design. */
  submitted: boolean;
};

export type CommissionerControlsProps = {
  phase: DraftPhase;
  leagueName: string;
  currentPick: number;
  /** Inline reason "Start draft" is disabled, or null when it may be tried. */
  startBlock: string | null;
  canFinalize: boolean;
  /** Why Finalize is offered (null whenever it is not). */
  finalizeNote: string | null;
  lastPick: DraftPick | null;
  onClock: LeagueMember | null;
  membersById: Map<string, LeagueMember>;
  /** Legal Pokémon for the coach on the clock (the Force pick choices). */
  legalForOnClock: DraftPokemon[];
  pendingAction: DraftAction | null;
  onStart: () => Promise<string | null>;
  onPause: () => Promise<string | null>;
  onResume: () => Promise<string | null>;
  onUndo: () => Promise<string | null>;
  onForce: (name: string | null) => Promise<string | null>;
  onFinalize: () => Promise<string | null>;
  onReset: () => Promise<string | null>;
};

/**
 * Start / Pause / Resume / Undo / Force pick / Finalize / Reset for the
 * commissioner, who may well be a spectator. Destructive steps confirm in a
 * Dialog; the dialog stays open with the function's message when it fails.
 *
 * The Undo and Force pick dialogs are pinned to the pick they were opened
 * for. When the room moves on underneath them (an auto-pick fired, another
 * pick landed) they close with a notice instead of acting on whatever is on
 * the clock now.
 *
 * Memoised: the room re-renders on every clock tick, and every prop here is
 * a primitive, a memoised value or a `useCallback` action from the hook, so
 * only a reload (not a tick) renders this section again.
 */
const CommissionerControls = memo(function CommissionerControls({
  phase,
  leagueName,
  currentPick,
  startBlock,
  canFinalize,
  finalizeNote,
  lastPick,
  onClock,
  membersById,
  legalForOnClock,
  pendingAction,
  onStart,
  onPause,
  onResume,
  onUndo,
  onForce,
  onFinalize,
  onReset,
}: CommissionerControlsProps) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [forceChoice, setForceChoice] = useState("");
  /** Why the last dialog closed on its own (cleared when the next one opens). */
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const startReasonId = useId();
  const forceReasonId = useId();

  const anyPending = pendingAction !== null;
  const running = phase === "live" || phase === "paused";
  /** `force_pick` raises `draft_paused` while paused; undo still works. */
  const forceBlock =
    phase === "paused"
      ? "Resume the draft to pick for the coach on the clock."
      : onClock === null
        ? "Nobody is on the clock."
        : null;
  const onClockName = teamNameLabel(onClock?.team_name);
  const lastPickTeam = lastPick
    ? teamNameLabel(membersById.get(lastPick.member_id)?.team_name)
    : null;

  /** The choice as it will be sent: a name that is still legal, else Best available. */
  const forceValue = legalForOnClock.some((entry) => entry.name === forceChoice)
    ? forceChoice
    : "";

  /** Why `target` no longer matches the room, or null while it still does. */
  function getStaleReason(target: DialogTarget): string | null {
    switch (target.kind) {
      case "force":
        return onClock === null ||
          onClock.id !== target.onClockId ||
          currentPick !== target.pickNumber
          ? "The clock moved on, so the Force pick dialog was closed. Open it again to pick for the coach on the clock now."
          : null;
      case "undo":
        return lastPick === null || lastPick.id !== target.pickId
          ? "The last pick changed, so the Undo dialog was closed. Open it again to undo the newest pick."
          : null;
      case "reset":
        return null;
    }
  }

  // Adjusting state on prop change during render (not in an effect): close a
  // dialog whose target moved on before the commissioner confirms it. While
  // the confirm is in flight the target changes because of that confirm, so
  // the check waits for the action to settle.
  const staleReason =
    dialog !== null && !dialog.submitted && !anyPending ? getStaleReason(dialog) : null;
  if (staleReason !== null) {
    setDialog(null);
    setDialogError(null);
    setStaleNotice(staleReason);
  }

  function openDialog(kind: DialogKind) {
    let target: DialogTarget | null;
    if (kind === "undo") {
      target = lastPick ? { kind, pickId: lastPick.id } : null;
    } else if (kind === "force") {
      target = onClock ? { kind, pickNumber: currentPick, onClockId: onClock.id } : null;
    } else {
      target = { kind };
    }
    if (target === null) return;
    setStaleNotice(null);
    setDialogError(null);
    setForceChoice("");
    setDialog({ ...target, submitted: false });
  }

  function closeDialog() {
    if (anyPending) return;
    setDialog(null);
    setDialogError(null);
  }

  async function confirm(action: () => Promise<string | null>) {
    if (dialog === null || dialog.submitted) return;

    // Second line of defence for the moment between a reload and its render.
    const reason = getStaleReason(dialog);
    if (reason !== null) {
      setDialog(null);
      setDialogError(null);
      setStaleNotice(reason);
      return;
    }

    if (dialog.kind === "force" && forceChoice !== "" && forceValue === "") {
      setForceChoice("");
      setDialogError(
        `${forceChoice} is no longer available for ${onClockName}. Choose another Pokémon or use Best available.`
      );
      return;
    }

    setDialogError(null);
    setDialog({ ...dialog, submitted: true });
    const error = await action();
    if (error) {
      setDialogError(error);
      setDialog((current) => (current ? { ...current, submitted: false } : current));
      return;
    }
    setDialog(null);
  }

  return (
    <section
      aria-labelledby="commissioner-controls-heading"
      className="rounded-xl border border-accent-border bg-panel p-4"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 id="commissioner-controls-heading" className="text-sm font-semibold text-text">
          Commissioner controls
        </h2>
        <p className="text-xs text-muted">
          {phase === "setup"
            ? "Start the draft once the order and the pool are set."
            : phase === "completed"
              ? "The draft is finished. Reset it to run the draft again."
              : "Pause the clock, fix a pick, or pick for an absent coach."}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {phase === "setup" && (
          <Button
            onClick={() => void onStart()}
            pending={pendingAction === "start"}
            pendingText="Starting..."
            disabled={anyPending || startBlock !== null}
            aria-describedby={startBlock ? startReasonId : undefined}
          >
            Start draft
          </Button>
        )}

        {phase === "live" && (
          <Button
            variant="secondary"
            onClick={() => void onPause()}
            pending={pendingAction === "pause"}
            pendingText="Pausing..."
            disabled={anyPending}
          >
            Pause
          </Button>
        )}

        {phase === "paused" && (
          <Button
            onClick={() => void onResume()}
            pending={pendingAction === "resume"}
            pendingText="Resuming..."
            disabled={anyPending}
          >
            Resume
          </Button>
        )}

        {running && (
          <>
            <Button
              variant="secondary"
              onClick={() => openDialog("undo")}
              disabled={anyPending || lastPick === null}
            >
              Undo last pick
            </Button>
            <Button
              variant="secondary"
              onClick={() => openDialog("force")}
              disabled={anyPending || forceBlock !== null}
              aria-describedby={forceBlock ? forceReasonId : undefined}
            >
              Force pick
            </Button>
            {canFinalize && (
              <Button
                onClick={() => void onFinalize()}
                pending={pendingAction === "finalize"}
                pendingText="Finalizing..."
                disabled={anyPending}
              >
                Finalize draft
              </Button>
            )}
          </>
        )}

        {phase !== "setup" && (
          <Button
            variant="danger"
            onClick={() => openDialog("reset")}
            disabled={anyPending}
          >
            Reset draft
          </Button>
        )}
      </div>

      {phase === "setup" && startBlock && (
        <p id={startReasonId} className="mt-2 text-xs text-warning">
          {startBlock}
        </p>
      )}

      {running && forceBlock && (
        <p id={forceReasonId} className="mt-2 text-xs text-muted">
          {forceBlock}
        </p>
      )}

      {canFinalize && finalizeNote && (
        <p className="mt-2 text-xs text-muted">
          {finalizeNote} Finalize it to build the teams and the match schedule.
        </p>
      )}

      {staleNotice && (
        <Alert variant="info" className="mt-3" onDismiss={() => setStaleNotice(null)}>
          {staleNotice}
        </Alert>
      )}

      <Dialog
        open={dialog?.kind === "undo"}
        onClose={closeDialog}
        title="Undo the last pick?"
        description={
          lastPick
            ? `Pick #${lastPick.pick_number}, ${lastPick.pokemon_name} by ${lastPickTeam}, goes back into the pool. ${lastPickTeam} returns to the clock and the timer restarts.`
            : "There is no pick to undo."
        }
        onConfirm={lastPick ? () => confirm(onUndo) : undefined}
        confirmLabel="Undo pick"
        pending={pendingAction === "undo"}
        error={dialogError}
      />

      <Dialog
        open={dialog?.kind === "force"}
        onClose={closeDialog}
        title={`Pick for ${onClockName}`}
        description={`Makes pick #${currentPick} on behalf of ${onClockName}. "Best available" takes the highest-priced legal Pokémon, the same choice the auto-pick makes.`}
        onConfirm={() => confirm(() => onForce(forceValue || null))}
        confirmLabel="Make pick"
        pending={pendingAction === "force"}
        error={dialogError}
      >
        <Field label="Pokémon">
          <Select
            value={forceValue}
            onChange={(event) => setForceChoice(event.target.value)}
            disabled={pendingAction === "force"}
          >
            <option value="">Best available</option>
            {legalForOnClock.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name} ({entry.points} pts)
              </option>
            ))}
          </Select>
        </Field>
        {legalForOnClock.length === 0 && (
          <Alert variant="warning" className="mt-3">
            No legal Pokémon remain for {onClockName}. Best available will skip
            this turn and leave the slot open.
          </Alert>
        )}
      </Dialog>

      <Dialog
        open={dialog?.kind === "reset"}
        onClose={closeDialog}
        title="Reset the draft?"
        description="This deletes every pick, team, match and news item in the league and returns it to setup. The draft pool and the draft order are kept. This cannot be undone."
        onConfirm={() => confirm(onReset)}
        confirmLabel="Reset draft"
        danger
        confirmText={leagueName}
        pending={pendingAction === "reset"}
        error={dialogError}
      />
    </section>
  );
});

export default CommissionerControls;
