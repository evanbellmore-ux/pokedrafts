"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/app/components/ui";
import { IMPORT_MAX_LABEL, resultText, SAVED_BATTLES_CAP, turnsText, type SavedBattleSummary, type SavedBattlesState } from "../model/saved-battle";
import type { TrainingSession } from "../training-session";
import { downloadText, isoTime, savedDate } from "./download";

type SavedActions = Pick<TrainingSession, "openReplay" | "resume" | "deleteSaved" | "deleteAllSaved" | "exportSaved" | "importSaved">;

const teams = (summary: SavedBattleSummary) => `${summary.own} vs ${summary.opponent}`;
/** After a delete the row (or the prompt) is gone: keyboard focus moves to the Saved battles heading instead of the page. */
const focusSavedHeading = () => { if (typeof document !== "undefined") document.querySelector<HTMLElement>("[data-training-saved-heading]")?.focus(); };
/** Looks disabled while it stays focusable (aria-disabled), so keyboard focus is not dropped while a file is checked. */
const UNAVAILABLE = "aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const when = (summary: SavedBattleSummary) => savedDate(summary.status === "unfinished" ? summary.updatedAt : summary.createdAt);

/** The newest unfinished battle (a reload ended it): Resume or Delete, above the setup. */
export function ResumePrompt({ saved, session }: { saved: SavedBattlesState; session: Pick<SavedActions, "resume" | "deleteSaved"> }) {
  const id = useId();
  const unfinished = saved.list.find((summary) => summary.status === "unfinished");
  if (!unfinished) return null;
  const label = `${teams(unfinished)}, ${turnsText(unfinished)}`;
  return (
    <section data-training-resume aria-labelledby={`${id}-heading`} className="min-w-0 space-y-2 rounded-xl border border-accent-border bg-panel p-3 sm:p-4">
      <h2 id={`${id}-heading`} className="text-base font-semibold text-text">Unfinished battle</h2>
      <p className="wrap-anywhere text-sm text-text">{teams(unfinished)}</p>
      <p className="text-sm tabular-nums text-muted">{turnsText(unfinished)} · Saved <time dateTime={isoTime(unfinished.updatedAt)}>{when(unfinished)}</time></p>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" aria-label={`Resume ${label}`} onClick={() => session.resume(unfinished.id)}>Resume</Button>
        <Button variant="secondary" className="min-h-11" aria-label={`Delete ${label}`}
          onClick={() => { if (window.confirm("Delete this unfinished battle?")) { session.deleteSaved(unfinished.id); focusSavedHeading(); } }}>Delete</Button>
      </div>
    </section>
  );
}

function SavedRow({ summary, session, onExported }: { summary: SavedBattleSummary; session: SavedActions; onExported(text: string): void }) {
  const label = `${teams(summary)}, ${when(summary)}`;
  const unfinished = summary.status === "unfinished";
  const exportFile = async () => {
    const file = await session.exportSaved(summary.id);
    if (!file) return;
    onExported(downloadText(file.name, file.text) ? `Exported ${file.name}.` : "The browser did not save the file.");
  };
  return (
    <li data-training-saved-row={summary.status} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="wrap-anywhere text-sm font-medium text-text">{teams(summary)}</p>
        <p className="text-xs tabular-nums text-muted">
          <time dateTime={isoTime(summary.createdAt)}>{when(summary)}</time>
          {` · ${resultText(summary)} · ${turnsText(summary)}${summary.source === "imported" ? " · Imported" : ""}`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {unfinished
          ? <Button size="sm" className="min-h-11" aria-label={`Resume ${label}`} onClick={() => session.resume(summary.id)}>Resume</Button>
          : (
            <>
              <Button size="sm" className="min-h-11" aria-label={`Replay ${label}`} data-training-replay-for={summary.id} onClick={() => session.openReplay(summary.id)}>Replay</Button>
              <Button variant="secondary" size="sm" className="min-h-11" aria-label={`Export ${label}`} onClick={() => void exportFile()}>Export</Button>
            </>
          )}
        <Button variant="secondary" size="sm" className="min-h-11" aria-label={`Delete ${label}`}
          onClick={() => { if (window.confirm("Delete this saved battle?")) { session.deleteSaved(summary.id); focusSavedHeading(); } }}>Delete</Button>
      </div>
    </li>
  );
}

/**
 * Saved battles in this browser, newest first: Replay, Export and Delete (Resume for an unfinished one), Import and Delete all.
 * `returnTo`: the replay just closed; its row's Replay button (else the heading) takes the keyboard focus back.
 */
export default function SavedBattles({ saved, session, returnTo = null, onReturned }: { saved: SavedBattlesState; session: SavedActions; returnTo?: string | null; onReturned?(): void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [exported, setExported] = useState<string | null>(null);
  const shown = saved.status !== "idle";
  useEffect(() => {
    if (!returnTo || !shown) return;
    const row = [...document.querySelectorAll<HTMLElement>("[data-training-replay-for]")].find((button) => button.getAttribute("data-training-replay-for") === returnTo);
    (row ?? heading.current)?.focus();
    onReturned?.();
  }, [returnTo, shown, onReturned]);
  if (!shown) return null;
  const count = saved.list.length;
  const importing = saved.import;
  return (
    <section data-training-saved aria-labelledby={`${id}-heading`} className="min-w-0 space-y-3 rounded-xl border border-line bg-panel p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-heading`} ref={heading} tabIndex={-1} data-training-saved-heading
          className="rounded text-lg font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Saved battles</h2>
        {saved.status === "ready" && <p data-training-saved-count className="text-sm tabular-nums text-muted">{count} of {SAVED_BATTLES_CAP} in this browser · oldest removed first</p>}
      </div>
      {saved.status === "loading" && <p role="status" className="text-sm text-muted">Loading saved battles…</p>}
      <div role="status" className="text-sm text-text empty:hidden">{saved.message ?? exported ?? ""}</div>
      {saved.status === "ready" && (count
        ? <ul aria-labelledby={`${id}-heading`} className="min-w-0">{saved.list.map((summary) => <SavedRow key={summary.id} summary={summary} session={session} onExported={setExported} />)}</ul>
        : <p className="text-sm text-muted">No saved battles</p>)}
      {saved.status !== "unavailable" && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} id={`${id}-file`} type="file" accept=".json,application/json" hidden aria-describedby={`${id}-import-fact`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              setExported(null);
              if (file) session.importSaved(file);
            }} />
          <Button variant="secondary" size="sm" className={`min-h-11 ${UNAVAILABLE}`} aria-describedby={`${id}-import-fact`}
            aria-disabled={importing.status === "checking" || undefined} aria-busy={importing.status === "checking" || undefined}
            onClick={() => { if (importing.status !== "checking") input.current?.click(); }}>{importing.status === "checking" ? "Checking…" : "Import"}</Button>
          <span id={`${id}-import-fact`} className="text-xs text-muted">Export file (.json), up to {IMPORT_MAX_LABEL}</span>
          {count > 0 && (
            <Button variant="secondary" size="sm" className="min-h-11 sm:ms-auto"
              onClick={() => { if (window.confirm(`Delete all ${count} saved ${count === 1 ? "battle" : "battles"}?`)) { session.deleteAllSaved(); heading.current?.focus(); } }}>Delete all</Button>
          )}
        </div>
      )}
      {importing.status === "checking" && <p role="status" className="wrap-anywhere text-sm text-muted">Checking {importing.name}…</p>}
      {importing.status === "error" && <p role="alert" data-training-import-error className="wrap-anywhere text-sm text-danger">{importing.name}: {importing.message}</p>}
      {importing.status === "done" && <p role="status" className="wrap-anywhere text-sm text-success">{importing.name} imported.</p>}
    </section>
  );
}
