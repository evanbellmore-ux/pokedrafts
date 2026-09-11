"use client";

import { useMemo, useState } from "react";
import { Newspaper, Undo2 } from "lucide-react";
import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import { useLeague } from "@/app/components/league/LeagueProvider";
import {
  Button,
  Dialog,
  EmptyState,
  Skeleton,
  SkeletonLines,
  StatusPill,
  type StatusTone,
} from "@/app/components/ui";
import { rpc } from "@/app/lib/rpc";
import LiveStatusPill, { type LiveStatus } from "./LiveStatusPill";
import {
  formatDateTime,
  freeAgentMove,
  NEWS_LABEL,
  newsKind,
  type NewsKind,
  type OverviewNews,
} from "./overview";

export type NewsFeedProps = {
  loading: boolean;
  news: OverviewNews[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** Called after `undo_free_agent_move` succeeded; resolves once reloaded. */
  onUndone: (message: string) => Promise<void>;
  liveStatus: LiveStatus;
};

const KIND_TONE: Record<NewsKind, StatusTone> = {
  free_agent: "accent",
  match_result: "success",
  other: "neutral",
};

const NO_IDS: ReadonlySet<string> = new Set();

type UndoCandidate = Pick<
  OverviewNews,
  "id" | "member_id" | "news_type" | "created_at"
>;

function newsTime(item: Pick<OverviewNews, "created_at">): number {
  const time = Date.parse(item.created_at);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Ids of the free-agent rows the commissioner may undo: the newest
 * `free_agent` row per team among the loaded rows. `undo_free_agent_move`
 * refuses anything but a team's newest move (`not_latest_move`), so older
 * rows get no button. Rows are put in the feed's order (newest first, ties
 * by id) before picking, so a caller that hands them over unsorted gets the
 * same answer; rows without a member are skipped.
 */
export function undoableNewsIds(news: readonly UndoCandidate[]): Set<string> {
  const ordered = [...news].sort(
    (a, b) => newsTime(b) - newsTime(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
  const ids = new Set<string>();
  const seen = new Set<string>();
  for (const item of ordered) {
    if (newsKind(item.news_type) !== "free_agent" || !item.member_id) continue;
    if (seen.has(item.member_id)) continue;
    seen.add(item.member_id);
    ids.add(item.id);
  }
  return ids;
}

function MoveTile({
  label,
  name,
  tone,
}: {
  label: string;
  name: string;
  tone: "success" | "danger";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
      <PokemonSprite name={name} size="sm" />
      <div className="min-w-0">
        <p
          className={`text-xs font-semibold uppercase tracking-wide ${
            tone === "success" ? "text-success" : "text-danger"
          }`}
        >
          {label}
        </p>
        <p className="truncate text-sm font-semibold text-text">{name}</p>
        <PokemonTypes name={name} />
      </div>
    </div>
  );
}

function NewsItem({
  item,
  canUndo,
  onUndo,
}: {
  item: OverviewNews;
  canUndo: boolean;
  onUndo: (item: OverviewNews) => void;
}) {
  const kind = newsKind(item.news_type);
  const move = freeAgentMove(item);

  return (
    <li className="rounded-lg border border-line bg-bg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill tone={KIND_TONE[kind]}>{NEWS_LABEL[kind]}</StatusPill>
        <time dateTime={item.created_at} className="text-xs text-muted">
          {formatDateTime(item.created_at)}
        </time>
      </div>

      {move && (move.added || move.dropped) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {move.added && <MoveTile label="Added" name={move.added} tone="success" />}
          {move.dropped && (
            <MoveTile label="Dropped" name={move.dropped} tone="danger" />
          )}
        </div>
      )}

      <p className="mt-3 text-sm text-text">{item.message}</p>

      {canUndo && kind === "free_agent" && (
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => onUndo(item)}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            Undo move
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * League news, newest first, with cursor paging and a commissioner undo on
 * each team's newest free-agent move (`undoableNewsIds`). The function still
 * validates every call, and its message is shown in the dialog.
 */
export default function NewsFeed({
  loading,
  news,
  hasMore,
  loadingMore,
  onLoadMore,
  onUndone,
  liveStatus,
}: NewsFeedProps) {
  const { league, isCommissioner } = useLeague();
  const [pendingUndo, setPendingUndo] = useState<OverviewNews | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  const canUndo = isCommissioner && Boolean(league.draft_completed);
  const undoable = useMemo(
    () => (canUndo ? undoableNewsIds(news) : NO_IDS),
    [canUndo, news]
  );
  const pendingMove = pendingUndo ? freeAgentMove(pendingUndo) : null;

  function openUndo(item: OverviewNews) {
    setUndoError(null);
    setPendingUndo(item);
  }

  function closeUndo() {
    if (busy) return;
    setPendingUndo(null);
    setUndoError(null);
  }

  async function confirmUndo() {
    if (!pendingUndo || busy) return;
    setBusy(true);
    setUndoError(null);

    const { error } = await rpc.undoFreeAgentMove(pendingUndo.id);
    if (error) {
      setUndoError(error);
      setBusy(false);
      return;
    }

    setPendingUndo(null);
    await onUndone(
      "Free agent move undone. The roster and swap count are back to how they were."
    );
    setBusy(false);
  }

  return (
    <section
      aria-labelledby="news-heading"
      className="flex min-w-0 flex-col rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="news-heading" className="text-lg font-semibold text-text">
          League news
        </h2>
        <LiveStatusPill status={liveStatus} />
      </div>

      {loading ? (
        <div aria-busy="true" className="mt-4 flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="rounded-lg border border-line bg-bg p-4">
              <Skeleton className="h-5 w-24" />
              <SkeletonLines lines={2} className="mt-3" />
            </div>
          ))}
        </div>
      ) : news.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<Newspaper className="h-5 w-5" />}
          title="No league news yet"
          description="Match results and free agent moves show up here as they happen."
        />
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-3 lg:max-h-[48rem] lg:overflow-y-auto lg:pr-1">
            {news.map((item) => (
              <NewsItem
                key={item.id}
                item={item}
                canUndo={undoable.has(item.id)}
                onUndo={openUndo}
              />
            ))}
          </ul>
          {hasMore && (
            <div className="mt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={onLoadMore}
                pending={loadingMore}
                pendingText="Loading..."
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog
        open={pendingUndo !== null}
        onClose={closeUndo}
        title="Undo this free agent move?"
        description={
          pendingMove?.added
            ? pendingMove.dropped
              ? `${pendingMove.added} goes back to the free agents and ${pendingMove.dropped} returns to the roster. Only a team's newest move can be undone.`
              : `${pendingMove.added} goes back to the free agents. Only a team's newest move can be undone.`
            : "The roster and swap count return to how they were before this move. Only a team's newest move can be undone."
        }
        danger
        confirmLabel="Undo move"
        onConfirm={confirmUndo}
        pending={busy}
        error={undoError}
      />
    </section>
  );
}
