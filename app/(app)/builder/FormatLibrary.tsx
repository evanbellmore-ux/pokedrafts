"use client";

import { useState } from "react";
import { Copy, FolderOpen, Library, Pencil, Trash2 } from "lucide-react";
import Alert, { type AlertVariant } from "@/app/components/ui/Alert";
import Button from "@/app/components/ui/Button";
import Dialog from "@/app/components/ui/Dialog";
import EmptyState from "@/app/components/ui/EmptyState";
import Field from "@/app/components/ui/Field";
import Input from "@/app/components/ui/Input";
import Skeleton from "@/app/components/ui/Skeleton";
import StatusPill from "@/app/components/ui/StatusPill";
import { describeRules, PRESETS } from "@/app/lib/pokemon/rules";
import {
  cleanName,
  countFormatPokemon,
  formatRules,
  MAX_FORMAT_NAME_LENGTH,
} from "./poolFormat";

/** Row of `draft_formats` as read by the builder. */
export type SavedFormat = {
  id: string;
  name: string;
  json: unknown;
  created_at: string | null;
  /** Null means the format is shared with everyone. */
  created_by: string | null;
};

export type LibraryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; formats: SavedFormat[]; userId: string | null };

/**
 * Outcome banner for one action in the builder. Each section keeps its own
 * so the message renders next to the control that produced it (the page is
 * a single column below lg, where a banner at the top would be off-screen).
 */
export type Notice = { variant: AlertVariant; message: string };

export type FormatLibraryProps = {
  state: LibraryState;
  /** Id of the format currently open in the editor. */
  loadedId: string | null;
  /** Id of the format whose Duplicate is in flight. */
  duplicatingId: string | null;
  /** Outcome of the last Load, Duplicate, Rename or Delete. */
  notice: Notice | null;
  onDismissNotice: () => void;
  onRetry: () => void;
  onLoad: (format: SavedFormat) => void;
  onDuplicate: (format: SavedFormat) => void;
  /** Resolve with an error message to keep the dialog open, or null when done. */
  onRename: (format: SavedFormat, name: string) => Promise<string | null>;
  onDelete: (format: SavedFormat) => Promise<string | null>;
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * "My formats": the caller's saved draft formats plus the other rows RLS
 * returns (shared formats and the format behind each league the caller
 * belongs to, docs/schema.md "Row level security"). Own formats can be
 * renamed and deleted; the others can only be loaded and duplicated, so the
 * actions that would silently do nothing are not offered.
 */
export default function FormatLibrary({
  state,
  loadedId,
  duplicatingId,
  notice,
  onDismissNotice,
  onRetry,
  onLoad,
  onDuplicate,
  onRename,
  onDelete,
}: FormatLibraryProps) {
  const [renaming, setRenaming] = useState<SavedFormat | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renamePending, setRenamePending] = useState(false);
  const [deleting, setDeleting] = useState<SavedFormat | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  function openRename(format: SavedFormat) {
    setRenameValue(format.name);
    setRenameError(null);
    setRenaming(format);
  }

  async function confirmRename() {
    if (!renaming || renamePending) return;
    const name = cleanName(renameValue);
    if (!name) {
      setRenameError("Enter a format name.");
      return;
    }
    setRenamePending(true);
    setRenameError(null);
    const problem = await onRename(renaming, name);
    setRenamePending(false);
    if (problem) {
      setRenameError(problem);
      return;
    }
    setRenaming(null);
  }

  function openDelete(format: SavedFormat) {
    setDeleteError(null);
    setDeleting(format);
  }

  async function confirmDelete() {
    if (!deleting || deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    const problem = await onDelete(deleting);
    setDeletePending(false);
    if (problem) {
      setDeleteError(problem);
      return;
    }
    setDeleting(null);
  }

  return (
    <aside
      aria-labelledby="format-library-heading"
      className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-20 lg:order-first lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto"
    >
      <div className="flex items-center gap-2">
        <Library className="h-5 w-5 text-accent-text" aria-hidden="true" />
        <h2
          id="format-library-heading"
          className="text-lg font-semibold text-text"
        >
          My formats
        </h2>
      </div>
      <p className="text-sm text-muted">
        Your formats and the shared ones can be picked when you create a
        league. Formats from other coaches&apos; leagues can be loaded and
        duplicated.
      </p>

      {notice && (
        <Alert variant={notice.variant} onDismiss={onDismissNotice}>
          {notice.message}
        </Alert>
      )}

      {state.status === "loading" && (
        <div aria-busy="true" className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="rounded-xl border border-line bg-panel p-4"
            >
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/2" />
              <Skeleton className="mt-3 h-8 w-full" />
            </div>
          ))}
        </div>
      )}

      {state.status === "error" && (
        <Alert
          variant="error"
          action={
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          {state.message}
        </Alert>
      )}

      {state.status === "ready" && state.formats.length === 0 && (
        <EmptyState
          title="No saved formats yet"
          description="Build a pool in the editor and save it to reuse it in your leagues."
        />
      )}

      {state.status === "ready" && state.formats.length > 0 && (
        <ul className="flex flex-col gap-3">
          {state.formats.map((format) => {
            const owned =
              state.userId !== null && format.created_by === state.userId;
            const loaded = format.id === loadedId;
            const count = countFormatPokemon(format.json);
            const saved = formatDate(format.created_at);
            // Rule-built formats show their recipe under the name (docs 13.7).
            const rules = formatRules(format.json);
            const recipe = rules ? describeRules(rules, PRESETS) : null;

            return (
              <li
                key={format.id}
                className={`rounded-xl border bg-panel p-4 ${
                  loaded ? "border-accent-border" : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
                    {format.name}
                  </h3>
                  {loaded && <StatusPill tone="accent">Loaded</StatusPill>}
                  {!owned && (
                    <StatusPill>
                      {format.created_by === null ? "Shared" : "From a league"}
                    </StatusPill>
                  )}
                </div>
                {recipe && (
                  <p className="mt-1 wrap-anywhere text-xs text-accent-text">{recipe}</p>
                )}
                <p className="mt-1 text-xs text-muted">
                  {count} Pokémon
                  {saved ? ` · Saved ${saved}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onLoad(format)}
                    aria-label={`Load ${format.name}`}
                  >
                    <FolderOpen className="h-4 w-4" aria-hidden="true" />
                    Load
                  </Button>
                  {owned && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openRename(format)}
                      aria-label={`Rename ${format.name}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      Rename
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDuplicate(format)}
                    pending={duplicatingId === format.id}
                    pendingText="Copying..."
                    disabled={duplicatingId !== null}
                    aria-label={`Duplicate ${format.name}`}
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    Duplicate
                  </Button>
                  {owned && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => openDelete(format)}
                      aria-label={`Delete ${format.name}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Delete
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename format"
        description="Leagues that already copied this format keep their draft pool."
        onConfirm={confirmRename}
        confirmLabel="Rename"
        pending={renamePending}
        error={renameError}
      >
        <Field label="Format name" required>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            maxLength={MAX_FORMAT_NAME_LENGTH}
            autoComplete="off"
            autoFocus
            disabled={renamePending}
          />
        </Field>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete format"
        description={
          deleting
            ? `"${deleting.name}" will be deleted for good. Leagues that already copied it keep their draft pool.`
            : undefined
        }
        danger
        onConfirm={confirmDelete}
        confirmLabel="Delete format"
        pending={deletePending}
        error={deleteError}
      />
    </aside>
  );
}
