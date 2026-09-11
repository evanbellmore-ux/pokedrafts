"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Download, FilePlus, Plus, Save } from "lucide-react";
import Alert from "@/app/components/ui/Alert";
import Button, { ButtonLink } from "@/app/components/ui/Button";
import Dialog from "@/app/components/ui/Dialog";
import EmptyState from "@/app/components/ui/EmptyState";
import Field from "@/app/components/ui/Field";
import Input from "@/app/components/ui/Input";
import PageHeader from "@/app/components/ui/PageHeader";
import StatusPill from "@/app/components/ui/StatusPill";
import { getCurrentUser } from "@/app/lib/auth/current-user";
import { friendlyError } from "@/app/lib/errors";
import { createClient } from "@/app/lib/supabase/client";
import FormatLibrary, {
  type LibraryState,
  type Notice,
  type SavedFormat,
} from "./FormatLibrary";
import PoolTable from "./PoolTable";
import {
  cleanName,
  copyName,
  DEFAULT_POINTS,
  entryKey,
  exportFileName,
  findDuplicateKeys,
  makeEntry,
  MAX_FORMAT_NAME_LENGTH,
  MAX_POINTS,
  MAX_POKEMON_NAME_LENGTH,
  MAX_POOL_SIZE,
  MIN_POINTS,
  parsePoolFile,
  parsePoolJson,
  rowProblem,
  serializeEntries,
  toDraftFormat,
  type ParsedPool,
  type PoolEntry,
} from "./poolFormat";
import { resolvePokemonName } from "./resolvePokemon";

/** Rows rendered before a "Show more" button appears. */
const PAGE_SIZE = 100;

/** The saved row the editor is working on; `owned` decides update vs insert. */
type LoadedFormat = { id: string; owned: boolean };

/** What the editor last loaded or saved, for unsaved-change detection. */
type Snapshot = { name: string; pool: string };

type PendingSwitch = { kind: "load"; format: SavedFormat } | { kind: "new" };

/** "Pokémon" is its own plural. */
function countPokemon(count: number) {
  return `${count} Pokémon`;
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Pool Builder: the reusable draft-format editor (docs/release-architecture.md
 * sections 2, 8.2-8.5). Reads and writes `draft_formats` directly (the one
 * table the browser may still write to, docs/schema.md "Row level security");
 * `created_by` is defaulted by the database and never sent. A league copies
 * a format when it is chosen, so nothing here touches a league.
 */
export default function BuilderClient() {
  const supabase = useMemo(() => createClient(), []);

  const [library, setLibrary] = useState<LibraryState>({ status: "loading" });
  const [formatName, setFormatName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [entries, setEntries] = useState<PoolEntry[]>([]);
  const [loaded, setLoaded] = useState<LoadedFormat | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    name: "",
    pool: serializeEntries([]),
  });
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  // One banner per section, rendered next to the control that produced it
  // (section 8.5: below lg the page is one column and the header actions,
  // the upload field, the Add form and the library are screens apart).
  const [editorNotice, setEditorNotice] = useState<Notice | null>(null);
  const [uploadNotice, setUploadNotice] = useState<Notice | null>(null);
  const [addNotice, setAddNotice] = useState<Notice | null>(null);
  const [libraryNotice, setLibraryNotice] = useState<Notice | null>(null);

  const loadLibrary = useCallback(async (): Promise<LibraryState> => {
    try {
      // A failed session check is shown as the error it is; only a genuinely
      // missing session reads as "not logged in" (app/lib/auth/current-user.ts).
      const current = await getCurrentUser(supabase.auth);
      if (current.status === "error") {
        return { status: "error", message: current.message };
      }
      const userId = current.status === "signed-in" ? current.user.id : null;

      const { data, error } = await supabase
        .from("draft_formats")
        .select("id, name, json, created_at, created_by")
        .order("name", { ascending: true });
      if (error) return { status: "error", message: friendlyError(error) };

      return {
        status: "ready",
        formats: (data ?? []) as SavedFormat[],
        userId,
      };
    } catch (caught) {
      return { status: "error", message: friendlyError(caught) };
    }
  }, [supabase]);

  useEffect(() => {
    let active = true;
    void loadLibrary().then((next) => {
      if (active) setLibrary(next);
    });
    return () => {
      active = false;
    };
  }, [loadLibrary]);

  function retryLibrary() {
    setLibrary({ status: "loading" });
    void loadLibrary().then(setLibrary);
  }

  /** Re-reads the list after a write without blanking it. */
  async function refreshLibrary() {
    setLibrary(await loadLibrary());
  }

  const sessionKnown = library.status === "ready";
  const userId = library.status === "ready" ? library.userId : null;
  const trimmedName = cleanName(formatName);
  const duplicateKeys = useMemo(() => findDuplicateKeys(entries), [entries]);
  const problem = useMemo(() => rowProblem(entries), [entries]);
  const fingerprint = useMemo(() => serializeEntries(entries), [entries]);
  const dirty = trimmedName !== snapshot.name || fingerprint !== snapshot.pool;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return entries;
    const key = entryKey(needle);
    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        (key !== "" && entryKey(entry.name).includes(key))
    );
  }, [entries, search]);
  const visible = filtered.slice(0, visibleCount);

  const canExport = entries.length > 0 && problem === null;
  const canSave = canExport && trimmedName.length > 0;
  const nameError =
    nameTouched && trimmedName.length === 0 ? "Enter a format name." : null;
  const saveLabel = loaded
    ? loaded.owned
      ? "Save changes"
      : "Save as new format"
    : "Save format";

  function updateEntry(key: string, patch: Partial<PoolEntry>) {
    setEntries((prev) =>
      prev.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry))
    );
  }

  function removeEntry(key: string) {
    setEntries((prev) => prev.filter((entry) => entry.key !== key));
  }

  /** Replaces the editor content and records it as the saved state. */
  function applyPool(name: string, next: PoolEntry[], target: LoadedFormat | null) {
    setFormatName(name);
    setNameTouched(false);
    setEntries(next);
    setLoaded(target);
    setSnapshot({ name: cleanName(name), pool: serializeEntries(next) });
    setSearch("");
    setVisibleCount(PAGE_SIZE);
  }

  function applyLoad(format: SavedFormat) {
    let parsed: ParsedPool;
    try {
      parsed = parsePoolJson(format.json);
    } catch (caught) {
      setLibraryNotice({
        variant: "error",
        message: `Could not load "${format.name}": ${friendlyError(caught)}`,
      });
      return;
    }

    applyPool(format.name, parsed.entries, {
      id: format.id,
      owned: userId !== null && format.created_by === userId,
    });

    const skipped =
      parsed.skipped > 0
        ? ` Skipped ${plural(parsed.skipped, "entry", "entries")} without a name.`
        : "";
    setEditorNotice(null);
    setUploadNotice(null);
    setAddNotice(null);
    setLibraryNotice({
      variant: parsed.skipped > 0 ? "warning" : "info",
      message: `Loaded "${format.name}" (${countPokemon(parsed.entries.length)}).${skipped}`,
    });
  }

  function applyNew() {
    applyPool("", [], null);
    setEditorNotice(null);
    setUploadNotice(null);
    setAddNotice(null);
    setLibraryNotice(null);
  }

  function requestLoad(format: SavedFormat) {
    if (dirty) setPendingSwitch({ kind: "load", format });
    else applyLoad(format);
  }

  function requestNew() {
    if (dirty) setPendingSwitch({ kind: "new" });
    else applyNew();
  }

  function confirmSwitch() {
    const next = pendingSwitch;
    setPendingSwitch(null);
    if (!next) return;
    if (next.kind === "new") applyNew();
    else applyLoad(next.format);
  }

  async function addPokemon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = cleanName(newName);
    if (!typed || adding) return;

    if (entries.length >= MAX_POOL_SIZE) {
      setAddNotice({
        variant: "error",
        message: `A draft pool can hold at most ${MAX_POOL_SIZE} Pokémon.`,
      });
      return;
    }
    if (entries.some((entry) => entryKey(entry.name) === entryKey(typed))) {
      setAddNotice({
        variant: "warning",
        message: `${typed} is already in this pool.`,
      });
      return;
    }

    setAdding(true);
    setAddNotice(null);
    try {
      const resolved = await resolvePokemonName(typed);
      if (resolved === null) {
        setAddNotice({
          variant: "error",
          message: `Could not find a Pokémon called "${typed}". Check the spelling, or add it through a JSON upload.`,
        });
        return;
      }
      setEntries((prev) => [...prev, makeEntry(resolved, DEFAULT_POINTS)]);
      setNewName("");
      setAddNotice({
        variant: "success",
        message: `Added ${resolved} at ${DEFAULT_POINTS} points. Adjust the points in the list below.`,
      });
    } catch (caught) {
      setAddNotice({ variant: "error", message: friendlyError(caught) });
    } finally {
      setAdding(false);
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const parsed = parsePoolFile(await file.text());
      setEntries(parsed.entries);
      if (parsed.name && trimmedName.length === 0) setFormatName(parsed.name);
      setSearch("");
      setVisibleCount(PAGE_SIZE);

      const notes = [
        `Loaded ${countPokemon(parsed.entries.length)} from ${file.name}.`,
      ];
      if (parsed.skipped > 0) {
        notes.push(
          `Skipped ${plural(parsed.skipped, "entry", "entries")} without a name.`
        );
      }
      if (parsed.adjusted > 0) {
        notes.push(
          `Moved ${plural(parsed.adjusted, "point value", "point values")} into ${MIN_POINTS} to ${MAX_POINTS}.`
        );
      }
      const remaining = rowProblem(parsed.entries);
      if (remaining) notes.push(remaining);

      setUploadNotice({
        variant: notes.length > 1 ? "warning" : "success",
        message: notes.join(" "),
      });
    } catch (caught) {
      setUploadNotice({ variant: "error", message: friendlyError(caught) });
    } finally {
      // Reset so choosing the same file again fires another change event.
      input.value = "";
    }
  }

  async function saveFormat() {
    if (saving) return;
    setNameTouched(true);

    if (trimmedName.length === 0) {
      setEditorNotice({
        variant: "error",
        message: "Enter a format name before saving.",
      });
      return;
    }
    if (entries.length === 0) {
      setEditorNotice({
        variant: "error",
        message: "Add at least one Pokémon before saving.",
      });
      return;
    }
    if (problem) {
      setEditorNotice({ variant: "error", message: problem });
      return;
    }
    if (sessionKnown && userId === null) {
      setEditorNotice({
        variant: "error",
        message: "You are not logged in. Log in to save formats.",
      });
      return;
    }

    const json = toDraftFormat(trimmedName, entries);
    setSaving(true);
    setEditorNotice(null);
    try {
      if (loaded?.owned) {
        const { data, error } = await supabase
          .from("draft_formats")
          .update({ name: trimmedName, json })
          .eq("id", loaded.id)
          .select("id");
        if (error) {
          setEditorNotice({ variant: "error", message: friendlyError(error) });
          return;
        }
        if (!data || data.length === 0) {
          setEditorNotice({
            variant: "error",
            message:
              "Nothing was saved. You can only change formats you created; use Duplicate to make your own copy.",
          });
          return;
        }
      } else {
        const { data, error } = await supabase
          .from("draft_formats")
          .insert({ name: trimmedName, json })
          .select("id")
          .single();
        if (error) {
          setEditorNotice({ variant: "error", message: friendlyError(error) });
          return;
        }
        setLoaded({ id: (data as { id: string }).id, owned: true });
      }

      setSnapshot({ name: trimmedName, pool: serializeEntries(entries) });
      await refreshLibrary();
      setEditorNotice({
        variant: "success",
        message: `Saved "${trimmedName}". Pick it as the draft format when you create or edit a league.`,
      });
    } catch (caught) {
      setEditorNotice({ variant: "error", message: friendlyError(caught) });
    } finally {
      setSaving(false);
    }
  }

  function exportJson() {
    if (entries.length === 0) return;
    if (problem) {
      setEditorNotice({ variant: "error", message: problem });
      return;
    }

    const json = toDraftFormat(trimmedName || "Untitled format", entries);
    const fileName = exportFileName(json.leagueName);
    const blob = new Blob([JSON.stringify(json, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setEditorNotice({
      variant: "success",
      message: `Exported ${countPokemon(entries.length)} to ${fileName}.`,
    });
  }

  async function duplicateFormat(format: SavedFormat) {
    if (duplicatingId !== null) return;
    if (sessionKnown && userId === null) {
      setLibraryNotice({
        variant: "error",
        message: "You are not logged in. Log in to save formats.",
      });
      return;
    }

    setDuplicatingId(format.id);
    setLibraryNotice(null);
    try {
      const name = copyName(format.name);
      const { error } = await supabase
        .from("draft_formats")
        .insert({ name, json: format.json })
        .select("id")
        .single();
      if (error) {
        setLibraryNotice({ variant: "error", message: friendlyError(error) });
        return;
      }
      await refreshLibrary();
      setLibraryNotice({
        variant: "success",
        message: `Duplicated "${format.name}" as "${name}".`,
      });
    } catch (caught) {
      setLibraryNotice({ variant: "error", message: friendlyError(caught) });
    } finally {
      setDuplicatingId(null);
    }
  }

  async function renameFormat(
    format: SavedFormat,
    name: string
  ): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from("draft_formats")
        .update({ name })
        .eq("id", format.id)
        .select("id");
      if (error) return friendlyError(error);
      if (!data || data.length === 0) {
        return "Nothing was renamed. You can only rename formats you created.";
      }

      if (loaded?.id === format.id) {
        setFormatName(name);
        setSnapshot((prev) => ({ ...prev, name }));
      }
      await refreshLibrary();
      setLibraryNotice({
        variant: "success",
        message: `Renamed "${format.name}" to "${name}".`,
      });
      return null;
    } catch (caught) {
      return friendlyError(caught);
    }
  }

  async function deleteFormat(format: SavedFormat): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from("draft_formats")
        .delete()
        .eq("id", format.id)
        .select("id");
      if (error) return friendlyError(error);
      if (!data || data.length === 0) {
        return "Nothing was deleted. You can only delete formats you created.";
      }

      const wasLoaded = loaded?.id === format.id;
      if (wasLoaded) {
        // The rows stay in the editor as an unsaved new format.
        setLoaded(null);
        setSnapshot({ name: "", pool: serializeEntries([]) });
      }
      await refreshLibrary();
      setLibraryNotice({
        variant: "success",
        message: wasLoaded
          ? `Deleted "${format.name}". The Pokémon still in the editor can be saved as a new format.`
          : `Deleted "${format.name}".`,
      });
      return null;
    } catch (caught) {
      return friendlyError(caught);
    }
  }

  const canStartNew = dirty || loaded !== null || entries.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Draft pool"
        title="Pool Builder"
        description="Build a point-priced list of Pokémon and save it as a draft format to pick when you create a league. A league copies the format, so later edits here never change a league that already has its pool."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={requestNew}
              disabled={!canStartNew}
            >
              <FilePlus className="h-4 w-4" aria-hidden="true" />
              New format
            </Button>
            <Button
              variant="secondary"
              onClick={exportJson}
              disabled={!canExport}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export JSON
            </Button>
            <Button
              onClick={saveFormat}
              pending={saving}
              pendingText="Saving..."
              disabled={!canSave}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {saveLabel}
            </Button>
          </>
        }
      />

      {sessionKnown && userId === null && (
        <Alert
          variant="warning"
          title="You are not logged in"
          action={
            <ButtonLink size="sm" variant="secondary" href="/login?next=/builder">
              Log in
            </ButtonLink>
          }
        >
          You can build and export a pool, but saving a draft format needs an
          account.
        </Alert>
      )}

      {editorNotice && (
        <Alert
          variant={editorNotice.variant}
          onDismiss={() => setEditorNotice(null)}
        >
          {editorNotice.message}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section
            aria-labelledby="format-details-heading"
            className="rounded-xl border border-line bg-panel p-5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="format-details-heading"
                className="text-lg font-semibold text-text"
              >
                Format details
              </h2>
              {loaded && (
                <StatusPill tone="accent">
                  {loaded.owned ? "Editing saved format" : "Loaded shared format"}
                </StatusPill>
              )}
              {dirty && <StatusPill tone="warning">Unsaved changes</StatusPill>}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field
                label="Format name"
                required
                error={nameError}
                help="Shown in the draft format list when you create or edit a league."
              >
                <Input
                  value={formatName}
                  onChange={(event) => setFormatName(event.target.value)}
                  onBlur={() => setNameTouched(true)}
                  maxLength={MAX_FORMAT_NAME_LENGTH}
                  autoComplete="off"
                  disabled={saving}
                />
              </Field>

              <Field
                label="Upload draft pool JSON"
                help='A file with a "pokemon" list of { "name", "points" } entries replaces the Pokémon below. Entries without a name are skipped.'
              >
                <Input
                  type="file"
                  accept="application/json,.json"
                  onChange={handleUpload}
                  disabled={saving}
                  className="file:mr-3 file:rounded-md file:border-0 file:bg-panel-hover file:px-3 file:py-1 file:text-sm file:font-semibold file:text-text"
                />
              </Field>
            </div>
            {uploadNotice && (
              <Alert
                variant={uploadNotice.variant}
                onDismiss={() => setUploadNotice(null)}
                className="mt-4"
              >
                {uploadNotice.message}
              </Alert>
            )}
          </section>

          <section
            aria-labelledby="find-add-heading"
            className="rounded-xl border border-line bg-panel p-5"
          >
            <h2 id="find-add-heading" className="text-lg font-semibold text-text">
              Find and add Pokémon
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Search this pool">
                <Input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setVisibleCount(PAGE_SIZE);
                  }}
                  placeholder="Filter by name"
                  autoComplete="off"
                />
              </Field>

              <form onSubmit={addPokemon} className="flex items-end gap-2">
                <Field label="Add Pokémon by name" className="min-w-0 flex-1">
                  <Input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder="e.g. Garchomp"
                    maxLength={MAX_POKEMON_NAME_LENGTH}
                    autoComplete="off"
                    disabled={adding}
                  />
                </Field>
                <Button
                  type="submit"
                  variant="secondary"
                  pending={adding}
                  pendingText="Checking..."
                  disabled={!cleanName(newName)}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add
                </Button>
              </form>
            </div>
            {addNotice && (
              <Alert
                variant={addNotice.variant}
                onDismiss={() => setAddNotice(null)}
                className="mt-4"
              >
                {addNotice.message}
              </Alert>
            )}
          </section>

          <section aria-labelledby="pool-list-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="pool-list-heading" className="text-lg font-semibold text-text">
                Pokémon in this pool
              </h2>
              <span className="text-sm text-muted">
                {countPokemon(entries.length)}
                {search.trim() && entries.length > 0
                  ? `, ${filtered.length} shown`
                  : ""}
              </span>
            </div>

            {problem && <Alert variant="error">{problem}</Alert>}

            {entries.length === 0 ? (
              <EmptyState
                title="No Pokémon in this pool yet"
                description="Add Pokémon one at a time above, upload a JSON file, or load one of your saved formats."
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                title="No Pokémon match your search"
                description="Try a different name or clear the search box."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setVisibleCount(PAGE_SIZE);
                    }}
                  >
                    Clear search
                  </Button>
                }
              />
            ) : (
              <>
                <PoolTable
                  entries={visible}
                  duplicateKeys={duplicateKeys}
                  onChange={updateEntry}
                  onRemove={removeEntry}
                />
                {filtered.length > visible.length && (
                  <div className="flex justify-center">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setVisibleCount((current) => current + PAGE_SIZE)
                      }
                    >
                      Show {Math.min(PAGE_SIZE, filtered.length - visible.length)}{" "}
                      more
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <FormatLibrary
          state={library}
          loadedId={loaded?.id ?? null}
          duplicatingId={duplicatingId}
          notice={libraryNotice}
          onDismissNotice={() => setLibraryNotice(null)}
          onRetry={retryLibrary}
          onLoad={requestLoad}
          onDuplicate={duplicateFormat}
          onRename={renameFormat}
          onDelete={deleteFormat}
        />
      </div>

      <Dialog
        open={pendingSwitch !== null}
        onClose={() => setPendingSwitch(null)}
        title="Discard unsaved changes?"
        description="The name and Pokémon in the editor have not been saved. Save the format first if you want to keep them."
        danger
        onConfirm={confirmSwitch}
        confirmLabel="Discard changes"
      />
    </div>
  );
}
