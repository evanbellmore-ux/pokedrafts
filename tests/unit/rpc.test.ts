import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_ERROR,
  FEATURE_UNAVAILABLE_ERROR,
  PERMISSION_ERROR,
} from "@/app/lib/errors";
import { createRpc } from "@/app/lib/rpc";

/**
 * `rpc.*` resolves every call to `{ data, error, code }` (docs section 8.1):
 * `error` is the sentence a page can show, `code` is what a page may branch
 * on. The code is the detail code of one of our own raises before anything
 * else, so a page never has to recognise a failure from its wording.
 */

type RpcResponse = { data: unknown; error: unknown };

function fakeClient(
  respond: (fn: string, args: Record<string, unknown>) => Promise<RpcResponse>
) {
  const rpc = vi.fn(respond);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

const RESULTS_EXIST_MESSAGE =
  "Results have already been reported. Discard them to regenerate the schedule.";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRpc", () => {
  it("passes the function name and arguments through and reports success with no code", async () => {
    const { client, rpc } = fakeClient(async () => ({ data: 12, error: null }));

    const result = await createRpc(client).generateSchedule(
      "league-1",
      "double_round_robin",
      true,
      true
    );

    expect(rpc).toHaveBeenCalledWith("generate_schedule", {
      p_league_id: "league-1",
      p_format: "double_round_robin",
      p_randomize: true,
      p_discard_results: true,
    });
    expect(result).toEqual({ data: 12, error: null, code: null });
  });

  it("carries the detail code of a function's own raise next to its message", async () => {
    const { client } = fakeClient(async () => ({
      data: null,
      error: {
        code: "P0001",
        message: RESULTS_EXIST_MESSAGE,
        details: "results_exist",
        hint: null,
      },
    }));

    const result = await createRpc(client).generateSchedule("league-1", "round_robin", false);

    expect(result).toEqual({
      data: null,
      error: RESULTS_EXIST_MESSAGE,
      code: "results_exist",
    });
  });

  it("falls back to the SQLSTATE / PostgREST code when there is no detail code", async () => {
    const raisedWithoutDetail = fakeClient(async () => ({
      data: null,
      error: { code: "P0001", message: "Custom message.", details: "Key (x) is odd." },
    }));
    expect(await createRpc(raisedWithoutDetail.client).startDraft("league-1")).toEqual({
      data: null,
      error: "Custom message.",
      code: "P0001",
    });

    const denied = fakeClient(async () => ({
      data: null,
      error: { code: "42501", message: "permission denied for function start_draft" },
    }));
    expect(await createRpc(denied.client).startDraft("league-1")).toEqual({
      data: null,
      error: PERMISSION_ERROR,
      code: "42501",
    });

    // A missing function is logged (docs section 2) and still carries its code.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = fakeClient(async () => ({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.start_draft in the schema cache",
      },
    }));
    expect(await createRpc(missing.client).startDraft("league-1")).toEqual({
      data: null,
      error: FEATURE_UNAVAILABLE_ERROR,
      code: "PGRST202",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("passes the playoff settings to create_league and the winner's Pokémon left to report_match_result (section 12.5)", async () => {
    const { client, rpc } = fakeClient(async () => ({ data: null, error: null }));
    const wrappers = createRpc(client);

    await wrappers.createLeague({
      name: "Kanto Cup",
      teamName: "Rocket",
      maxCoaches: 8,
      draftFormatId: null,
      pointBudget: 100,
      picksPerTeam: 10,
      pickTimerSeconds: 120,
      playoffFormat: "top_6",
      tiebreaker: "differential",
    });
    expect(rpc).toHaveBeenLastCalledWith("create_league", {
      p_name: "Kanto Cup",
      p_team_name: "Rocket",
      p_max_coaches: 8,
      p_draft_format_id: null,
      p_point_budget: 100,
      p_picks_per_team: 10,
      p_pick_timer_seconds: 120,
      p_playoff_format: "top_6",
      p_tiebreaker: "differential",
    });

    await wrappers.reportMatchResult("match-1", "member-1");
    expect(rpc).toHaveBeenLastCalledWith("report_match_result", {
      p_match_id: "match-1",
      p_winner_member_id: "member-1",
      p_winner_remaining: null,
    });
    await wrappers.reportMatchResult("match-1", "member-1", 4);
    expect(rpc).toHaveBeenLastCalledWith("report_match_result", {
      p_match_id: "match-1",
      p_winner_member_id: "member-1",
      p_winner_remaining: 4,
    });

    await wrappers.leagueStandings("league-1");
    expect(rpc).toHaveBeenLastCalledWith("league_standings", { p_league_id: "league-1" });
    await wrappers.generatePlayoffs("league-1");
    expect(rpc).toHaveBeenLastCalledWith("generate_playoffs", { p_league_id: "league-1" });
    await wrappers.clearPlayoffs("league-1");
    expect(rpc).toHaveBeenLastCalledWith("clear_playoffs", { p_league_id: "league-1" });
  });

  it("has no code for a thrown network failure", async () => {
    const { client } = fakeClient(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await createRpc(client).getServerTime()).toEqual({
      data: null,
      error: CONNECTION_ERROR,
      code: null,
    });
  });
});
