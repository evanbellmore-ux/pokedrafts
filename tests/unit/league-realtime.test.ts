import { createElement, useEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REALTIME_BATCH_MS,
  useLeagueRealtime,
  type LeagueRealtimeOptions,
  type LeagueRealtimeTable,
} from "@/app/(app)/leagues/[leagueId]/useLeagueRealtime";

/**
 * Realtime sends one postgres_changes event per row, and one function call
 * can write hundreds of rows: generate_schedule inserts the new schedule
 * (240 matches for 16 coaches, double round robin), and _finalize_draft
 * writes every team and match. Each league page reloads everything it shows
 * on a change, so the hook hands a burst of row events to the page as one
 * call instead of one reload per row.
 *
 * The hook runs in a component rendered to static markup with React's
 * useEffect and useState stubbed (the unit suite has no DOM), and its effect
 * is run by hand against a fake channel that records each table's handler.
 */

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: vi.fn(),
  useEffectEvent: (fn: unknown) => fn,
  useState: vi.fn(),
}));

type Effect = () => void | (() => void);

function fakeChannel() {
  const handlers = new Map<string, () => void>();
  let onStatus: (state: string) => void = () => undefined;
  const channel = {
    on(_type: string, filter: { table: string }, handler: () => void) {
      handlers.set(filter.table, handler);
      return channel;
    },
    subscribe(callback: (state: string) => void) {
      onStatus = callback;
      return channel;
    },
  };
  const supabase = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => "ok"),
  };
  return {
    supabase: supabase as unknown as SupabaseClient,
    removeChannel: supabase.removeChannel,
    /** One postgres_changes event for a row of `table`. */
    row(table: LeagueRealtimeTable) {
      const handler = handlers.get(table);
      if (!handler) throw new Error(`no handler for ${table}`);
      handler();
    },
    status(state: string) {
      onStatus(state);
    },
  };
}

const OVERVIEW_TABLES: readonly LeagueRealtimeTable[] = [
  "leagues",
  "league_members",
  "league_matches",
  "league_news",
];

function RealtimeProbe(options: LeagueRealtimeOptions) {
  useLeagueRealtime(options);
  return null;
}

function mount(tables = OVERVIEW_TABLES) {
  const effects: Effect[] = [];
  vi.mocked(useEffect).mockImplementation((effect) => {
    effects.push(effect as Effect);
  });
  vi.mocked(useState).mockImplementation(((initial: unknown) => [initial, vi.fn()]) as unknown as typeof useState);

  const channel = fakeChannel();
  const onChange = vi.fn<(tables: ReadonlySet<LeagueRealtimeTable> | null) => void>();
  renderToStaticMarkup(
    createElement(RealtimeProbe, { supabase: channel.supabase, leagueId: "league-1", name: "overview", tables, onChange })
  );
  expect(effects).toHaveLength(1);
  const cleanup = effects[0]();
  channel.status("SUBSCRIBED");
  return { channel, onChange, unmount: () => (typeof cleanup === "function" ? cleanup() : undefined) };
}

/** What onChange received, with each set as a sorted list. */
function calls(onChange: ReturnType<typeof mount>["onChange"]) {
  return onChange.mock.calls.map(([tables]) => (tables === null ? null : [...tables].sort()));
}

describe("useLeagueRealtime batches row events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(useEffect).mockReset();
    vi.mocked(useState).mockReset();
  });

  it("turns a regenerated schedule (one event per inserted match) into one call", () => {
    const { channel, onChange } = mount();
    // generate_schedule for 16 coaches, double round robin: the league row
    // changes and 240 matches are inserted. (Its deletes send no event the
    // league filter matches: a delete event carries only the primary key.)
    channel.row("leagues");
    for (let i = 0; i < 240; i += 1) channel.row("league_matches");

    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REALTIME_BATCH_MS);
    expect(calls(onChange)).toEqual([["league_matches", "leagues"]]);
  });

  it("gathers events that arrive within the batch window, then starts a new batch", () => {
    const { channel, onChange } = mount();
    channel.row("league_matches");
    vi.advanceTimersByTime(REALTIME_BATCH_MS - 1);
    channel.row("league_matches");
    channel.row("league_members");
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(calls(onChange)).toEqual([["league_matches", "league_members"]]);

    channel.row("league_news");
    vi.advanceTimersByTime(REALTIME_BATCH_MS);
    expect(calls(onChange)).toEqual([["league_matches", "league_members"], ["league_news"]]);
  });

  it("asks for everything at once when the channel comes back, replacing a pending batch", () => {
    const { channel, onChange } = mount();
    channel.row("league_matches");
    channel.status("CHANNEL_ERROR");
    channel.status("SUBSCRIBED");
    expect(calls(onChange)).toEqual([null]);
    vi.advanceTimersByTime(REALTIME_BATCH_MS * 4);
    expect(calls(onChange)).toEqual([null]);
  });

  it("drops a pending batch on unmount and removes the channel", () => {
    const { channel, onChange, unmount } = mount();
    channel.row("league_matches");
    unmount();
    expect(channel.removeChannel).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(REALTIME_BATCH_MS * 4);
    channel.row("league_matches");
    vi.advanceTimersByTime(REALTIME_BATCH_MS * 4);
    expect(onChange).not.toHaveBeenCalled();
  });
});
