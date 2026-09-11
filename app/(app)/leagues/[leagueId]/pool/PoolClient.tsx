"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Layers, Pencil, RotateCcw, Save, Search, X } from "lucide-react";
import { useLeague } from "@/app/components/league/LeagueProvider";
import {
  Alert,
  Button,
  ButtonLink,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  SkeletonLines,
} from "@/app/components/ui";
import { friendlyError } from "@/app/lib/errors";
import { pluralize } from "@/app/lib/league/labels";
import { rpc } from "@/app/lib/rpc";
import { createClient } from "@/app/lib/supabase/client";
import { readLeaguePool } from "../leaguePool";
import LiveStatusPill from "../LiveStatusPill";
import type { Notice } from "../notice";
import { useLeagueRealtime } from "../useLeagueRealtime";
import { useMinWidthMd } from "../useMinWidthMd";
import PoolAddRow from "./PoolAddRow";
import PoolCards from "./PoolCards";
import PoolSummary from "./PoolSummary";
import PoolTable from "./PoolTable";
import {
  addProblem,
  editRows,
  filterRows,
  isValidPoints,
  toDraftEntries,
  validatePool,
  viewRows,
  type PoolDraftEntry,
} from "./poolEditing";
import { pointsToTier } from "@/app/types/draft";

/** Rows rendered before "Show more"; keeps a 2000-entry pool responsive. */
const VISIBLE_STEP = 100;

type PoolContext = {
  /** Coaches with a draft position. */
  draftingCoaches: number;
  formatName: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: PoolContext };

const EDIT_FORM_ID = "pool-edit-form";

function SummarySkeleton() {
  return (
    <div aria-busy="true" className="rounded-xl border border-line bg-panel p-5">
      <Skeleton className="h-4 w-64 max-w-full" />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div aria-busy="true" className="rounded-xl border border-line bg-panel p-5">
      <SkeletonLines lines={6} />
    </div>
  );
}

/**
 * The league's draft pool: always `leagues.custom_pool` (docs/schema.md).
 * Read-only for everyone; the commissioner can edit points, add and remove
 * entries, or copy the draft format again, until the draft starts.
 */
export default function PoolClient() {
  const { league, isCommissioner, refresh } = useLeague();
  const supabase = useMemo(() => createClient(), []);
  const leagueId = league.id;
  const draftFormatId = league.draft_format_id;
  const wide = useMinWidthMd();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(VISIBLE_STEP);
  /** Non-null while the commissioner is editing. */
  const [entries, setEntries] = useState<PoolDraftEntry[] | null>(null);
  /** `custom_pool` as it was when editing started, to detect a newer pool on save. */
  const [editBaseline, setEditBaseline] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const generation = useRef(0);

  const pool = useMemo(() => readLeaguePool(league), [league]);
  /**
   * `custom_pool` as the page currently knows it. Captured when editing
   * starts and compared again later, so the page can tell that Settings or
   * another commissioner replaced the pool while it was being edited.
   */
  const poolKey = useMemo(
    () => JSON.stringify(league.custom_pool ?? null),
    [league.custom_pool]
  );

  const load = useCallback(async (): Promise<LoadState> => {
    try {
      const [membersResult, formatResult] = await Promise.all([
        supabase
          .from("league_members")
          .select("id, draft_position")
          .eq("league_id", leagueId),
        draftFormatId
          ? supabase
              .from("draft_formats")
              .select("name")
              .eq("id", draftFormatId)
              .maybeSingle()
          : Promise.resolve(null),
      ]);

      if (membersResult.error) {
        return { status: "error", message: friendlyError(membersResult.error) };
      }
      if (formatResult?.error) {
        return { status: "error", message: friendlyError(formatResult.error) };
      }

      const members = (membersResult.data ?? []) as Array<{
        id: string;
        draft_position: number | null;
      }>;
      const format = (formatResult?.data ?? null) as { name: string } | null;

      return {
        status: "ready",
        data: {
          draftingCoaches: members.filter((row) => row.draft_position != null)
            .length,
          formatName: format?.name ?? null,
        },
      };
    } catch (caught) {
      return { status: "error", message: friendlyError(caught) };
    }
  }, [supabase, leagueId, draftFormatId]);

  useEffect(() => {
    let active = true;
    const current = generation.current + 1;
    generation.current = current;
    void load().then((next) => {
      if (active && current === generation.current) setState(next);
    });
    return () => {
      active = false;
      // A retry that started before this cleanup must not apply either.
      generation.current += 1;
    };
  }, [load]);

  function retry() {
    setState({ status: "loading" });
    const current = generation.current + 1;
    generation.current = current;
    void load().then((next) => {
      if (current === generation.current) setState(next);
    });
  }

  // The league row can change from elsewhere (Settings in another tab, a
  // commissioner transfer, Start draft). Keeping the context row current
  // means Cancel shows the pool that is really there, the next edit starts
  // from it, and the edit buttons go away as soon as the draft starts.
  const liveStatus = useLeagueRealtime({
    supabase,
    leagueId,
    name: "pool",
    tables: ["leagues"],
    onChange: () => void refresh(),
  });

  const canEdit = isCommissioner && !league.draft_started;

  // Editing ends the moment the caller may no longer edit (the draft started
  // or the commissioner role moved, from another tab); update_league_pool
  // would refuse the save anyway. Adjusted during render, per React's
  // "adjusting state on prop change" guidance, as LeagueProvider does.
  if (entries !== null && !canEdit) {
    setEntries(null);
    setEditError(null);
    setNotice({
      variant: "warning",
      text: league.draft_started
        ? "The draft has started, so the draft pool can no longer be edited. Unsaved changes were discarded."
        : "You are no longer the commissioner, so the draft pool can no longer be edited. Unsaved changes were discarded.",
    });
  }

  const editing = entries !== null;
  /**
   * True once the pool on the league row differs from the one being edited.
   * Not while saving: the realtime event for the caller's own save can
   * refresh the row before the RPC resolves, and that is not a conflict.
   */
  const poolChanged = editing && !saving && editBaseline !== poolKey;
  const showReset = canEdit && Boolean(draftFormatId) && !pool.mirrorsFormat;
  const formatName = state.status === "ready" ? state.data.formatName : null;

  function startEditing() {
    setEntries(toDraftEntries(pool.pokemon));
    setEditBaseline(poolKey);
    setEditError(null);
    setVisible(VISIBLE_STEP);
  }

  function cancelEditing() {
    if (saving) return;
    setEntries(null);
    setEditError(null);
  }

  function updatePoints(index: number, value: number | null) {
    setEntries((previous) =>
      previous
        ? previous.map((entry, i) =>
            i === index ? { ...entry, points: value } : entry
          )
        : previous
    );
  }

  function removeEntry(index: number) {
    setEntries((previous) =>
      previous
        ? previous.map((entry, i) =>
            i === index ? { ...entry, removed: true } : entry
          )
        : previous
    );
  }

  function addEntry(name: string, points: number): string | null {
    if (!entries) return "Start editing the pool first.";
    const problem = addProblem(entries, name, points);
    if (problem) return problem;
    setEntries([...entries, { name: name.trim(), points, removed: false }]);
    setEditError(null);
    return null;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entries || saving) return;

    const result = validatePool(entries);
    if (result.error !== null) {
      setEditError(result.error);
      return;
    }

    setSaving(true);
    setEditError(null);

    // Last writer wins on `custom_pool`, so refuse to overwrite a pool that
    // changed since editing began (Settings in another tab, another
    // commissioner after a transfer).
    try {
      const { data, error: readError } = await supabase
        .from("leagues")
        .select("custom_pool")
        .eq("id", leagueId)
        .maybeSingle();
      if (readError) {
        setEditError(friendlyError(readError));
        setSaving(false);
        return;
      }
      const current = JSON.stringify(
        (data as { custom_pool: unknown } | null)?.custom_pool ?? null
      );
      if (current !== editBaseline) {
        // Pull the newer pool into the page first, so that Cancel really
        // shows it and the next edit starts from it instead of from the
        // stale baseline that just failed.
        const refreshError = await refresh();
        setEditError(
          refreshError
            ? `The draft pool changed since you started editing, so your changes were not saved, and the current pool could not be loaded either. ${refreshError}`
            : "The draft pool changed since you started editing, so your changes were not saved. Cancel to see the current pool, then edit it again."
        );
        setSaving(false);
        return;
      }
    } catch (caught) {
      setEditError(friendlyError(caught));
      setSaving(false);
      return;
    }

    const { error } = await rpc.updateLeaguePool(leagueId, {
      version: "1.0",
      leagueName: league.name,
      pokemon: result.pokemon,
    });
    if (error) {
      setEditError(error);
      setSaving(false);
      return;
    }

    // Success waits for the reload so the page never shows a pool it has
    // not read back.
    const refreshError = await refresh();
    setSaving(false);
    if (refreshError) {
      setEditError(
        `The draft pool was saved, but it could not be reloaded. ${refreshError}`
      );
      return;
    }

    setEntries(null);
    setNotice({
      variant: "success",
      text: `Draft pool saved with ${pluralize(result.pokemon.length, "Pokémon", "Pokémon")}.`,
    });
  }

  function openReset() {
    setResetError(null);
    setConfirmReset(true);
  }

  function closeReset() {
    if (resetting) return;
    setConfirmReset(false);
    setResetError(null);
  }

  async function resetToFormat() {
    if (resetting) return;
    setResetting(true);
    setResetError(null);

    const { error } = await rpc.resetLeaguePool(leagueId);
    if (error) {
      setResetError(error);
      setResetting(false);
      return;
    }

    const refreshError = await refresh();
    setResetting(false);
    setConfirmReset(false);
    setEntries(null);
    setNotice(
      refreshError
        ? {
            variant: "warning",
            text: `The draft pool was reset, but it could not be reloaded. ${refreshError}`,
          }
        : {
            variant: "success",
            text: formatName
              ? `Draft pool reset to the format ${formatName}.`
              : "Draft pool reset to the draft format.",
          }
    );
  }

  const allRows = useMemo(
    () => (entries ? editRows(entries) : viewRows(pool.pokemon)),
    [entries, pool.pokemon]
  );
  // While editing, the summary counts the list being edited so "Short by N"
  // and the budget check follow every add, remove and point change.
  const summaryPool = useMemo(() => {
    if (!entries) return pool;
    const pokemon = [];
    for (const entry of entries) {
      if (entry.removed || !isValidPoints(entry.points)) continue;
      pokemon.push({
        name: entry.name,
        points: entry.points,
        tier: pointsToTier(entry.points),
      });
    }
    return { ...pool, pokemon };
  }, [entries, pool]);
  const filtered = useMemo(() => filterRows(allRows, search), [allRows, search]);
  const shown = filtered.slice(0, visible);
  const settingsHref = `/leagues/${leagueId}/settings`;

  const rowsView =
    shown.length === 0 ? (
      <EmptyState
        icon={<Search className="h-5 w-5" />}
        title={
          search.trim()
            ? "No Pokémon match your search"
            : editing
              ? "No Pokémon in the pool yet"
              : "This pool is empty"
        }
        description={
          search.trim()
            ? "Try a different spelling, or clear the search."
            : editing
              ? "Add Pokémon above, then save the pool."
              : "The draft cannot start until the pool has enough Pokémon."
        }
      />
    ) : wide ? (
      <PoolTable
        rows={shown}
        editing={editing}
        disabled={saving}
        onPointsChange={updatePoints}
        onRemove={removeEntry}
      />
    ) : (
      <PoolCards
        rows={shown}
        editing={editing}
        disabled={saving}
        onPointsChange={updatePoints}
        onRemove={removeEntry}
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Draft pool"
        description="The point-priced Pokémon this league drafts from. Every coach drafts from the same list."
        actions={
          <>
            <span className="flex items-center">
              <LiveStatusPill status={liveStatus} />
            </span>
            {canEdit &&
              (editing ? (
                <>
                  <Button
                    type="submit"
                    form={EDIT_FORM_ID}
                    pending={saving}
                    pendingText="Saving..."
                  >
                    <Save className="h-4 w-4" aria-hidden="true" />
                    Save pool
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={cancelEditing}
                    disabled={saving}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={startEditing}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Edit pool
                  </Button>
                  {showReset && (
                    <Button variant="secondary" onClick={openReset}>
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      Reset to format
                    </Button>
                  )}
                </>
              ))}
          </>
        }
      />

      {notice && (
        <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      {poolChanged && (
        <Alert
          variant="warning"
          title="The draft pool changed while you were editing"
        >
          Settings or another commissioner replaced the pool, so these changes
          cannot be saved over it. Cancel to see the current pool, then edit
          it again.
        </Alert>
      )}

      {state.status === "error" ? (
        <Alert
          variant="error"
          title="Could not load the draft pool"
          action={
            <Button size="sm" variant="secondary" onClick={retry}>
              Retry
            </Button>
          }
        >
          {state.message}
        </Alert>
      ) : state.status === "loading" ? (
        <>
          <SummarySkeleton />
          <RowsSkeleton />
        </>
      ) : (
        <>
          <PoolSummary
            league={league}
            pool={summaryPool}
            formatName={state.data.formatName}
            draftingCoaches={state.data.draftingCoaches}
          />

          {editing && editError && (
            <Alert variant="error" onDismiss={() => setEditError(null)}>
              {editError}
            </Alert>
          )}

          {editing && <PoolAddRow onAdd={addEntry} disabled={saving} />}

          {!editing && pool.pool === null ? (
            <EmptyState
              icon={<Layers className="h-5 w-5" />}
              title="No draft pool yet"
              description={
                canEdit
                  ? "Choose a draft format in Settings to copy its list here, or build the pool by hand."
                  : isCommissioner
                    ? "This league has no draft pool."
                    : "The commissioner has not chosen a draft pool yet."
              }
              action={
                canEdit ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    <ButtonLink href={settingsHref}>Choose a format</ButtonLink>
                    <Button variant="secondary" onClick={startEditing}>
                      Build the pool by hand
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ) : (
            <>
              <Field label="Search Pokémon" hideLabel>
                <Input
                  type="search"
                  placeholder="Search Pokémon"
                  autoComplete="off"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setVisible(VISIBLE_STEP);
                  }}
                />
              </Field>

              {editing ? (
                <form id={EDIT_FORM_ID} onSubmit={save} noValidate>
                  {rowsView}
                </form>
              ) : (
                rowsView
              )}

              {filtered.length > shown.length && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setVisible((count) => count + VISIBLE_STEP)}
                  >
                    Show more
                  </Button>
                  <p className="text-sm text-muted">
                    Showing {shown.length} of {filtered.length} Pokémon
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}

      <Dialog
        open={confirmReset}
        onClose={closeReset}
        title="Reset the pool to the format?"
        description={`This replaces the current pool with ${
          formatName ? `the format ${formatName}` : "the league's draft format"
        } as it is right now. Point changes made on this page are lost.`}
        danger
        confirmLabel="Reset to format"
        onConfirm={resetToFormat}
        pending={resetting}
        error={resetError}
      />
    </div>
  );
}
