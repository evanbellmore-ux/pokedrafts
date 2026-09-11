import type { SupabaseClient } from "@supabase/supabase-js";
import { friendlyError, getErrorCode, getErrorDetailCode } from "@/app/lib/errors";
import { createClient } from "@/app/lib/supabase/client";
import type { DraftFormat } from "@/app/types/draft";
import type {
  AutoPickResult,
  CreateLeagueInput,
  InvitePreview,
  League,
  LeagueNews,
  LeagueSettingsInput,
  PickResult,
  ScheduleFormat,
  UndoPickResult,
} from "@/app/types/league";

/**
 * Typed wrappers around the Postgres functions in
 * docs/release-architecture.md section 5. Every wrapper resolves to
 * `{ data, error, code }`: `error` has already been passed through
 * `friendlyError`, so pages can render it directly, and `code` lets a page
 * branch on *why* a call failed without matching the sentence. It is the
 * `snake_case` detail code of a function's own raise (docs/schema.md, e.g.
 * `results_exist`), else the PostgREST / SQLSTATE code, else null (a
 * network failure). Consumers that only read `error` are unaffected.
 */
export type RpcResult<T> =
  | { data: T; error: null; code: null }
  | { data: null; error: string; code: string | null };

type RpcArgs = Record<string, unknown>;

function failure<T>(error: unknown): RpcResult<T> {
  return {
    data: null,
    error: friendlyError(error),
    code: getErrorDetailCode(error) ?? getErrorCode(error),
  };
}

async function call<T>(
  client: SupabaseClient,
  fn: string,
  args: RpcArgs
): Promise<RpcResult<T>> {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error) return failure(error);
    return { data: data as T, error: null, code: null };
  } catch (caught) {
    return failure(caught);
  }
}

/** Creates the wrapper set bound to a specific client (browser by default). */
export function createRpc(client: SupabaseClient = createClient()) {
  return {
    getServerTime: () => call<string>(client, "get_server_time", {}),

    createLeague: (input: CreateLeagueInput) =>
      call<string>(client, "create_league", {
        p_name: input.name,
        p_team_name: input.teamName,
        p_max_coaches: input.maxCoaches,
        p_draft_format_id: input.draftFormatId,
        p_point_budget: input.pointBudget,
        p_picks_per_team: input.picksPerTeam,
        p_pick_timer_seconds: input.pickTimerSeconds,
      }),

    getInvitePreview: (code: string) =>
      call<InvitePreview>(client, "get_invite_preview", { p_code: code }),

    joinLeague: (code: string, teamName: string) =>
      call<string>(client, "join_league", {
        p_code: code,
        p_team_name: teamName,
      }),

    regenerateInvite: (leagueId: string) =>
      call<string>(client, "regenerate_invite", { p_league_id: leagueId }),

    renameTeam: (leagueId: string, teamName: string) =>
      call<null>(client, "rename_team", {
        p_league_id: leagueId,
        p_team_name: teamName,
      }),

    leaveLeague: (leagueId: string) =>
      call<null>(client, "leave_league", { p_league_id: leagueId }),

    removeMember: (leagueId: string, memberId: string) =>
      call<null>(client, "remove_member", {
        p_league_id: leagueId,
        p_member_id: memberId,
      }),

    transferCommissioner: (leagueId: string, memberId: string) =>
      call<null>(client, "transfer_commissioner", {
        p_league_id: leagueId,
        p_member_id: memberId,
      }),

    updateLeagueSettings: (leagueId: string, settings: LeagueSettingsInput) =>
      call<League>(client, "update_league_settings", {
        p_league_id: leagueId,
        p_settings: settings,
      }),

    updateLeaguePool: (leagueId: string, pool: DraftFormat) =>
      call<null>(client, "update_league_pool", {
        p_league_id: leagueId,
        p_pool: pool,
      }),

    resetLeaguePool: (leagueId: string) =>
      call<null>(client, "reset_league_pool", { p_league_id: leagueId }),

    setDraftOrder: (leagueId: string, memberIds: string[]) =>
      call<null>(client, "set_draft_order", {
        p_league_id: leagueId,
        p_member_ids: memberIds,
      }),

    startDraft: (leagueId: string) =>
      call<null>(client, "start_draft", { p_league_id: leagueId }),

    makePick: (leagueId: string, pokemonName: string) =>
      call<PickResult>(client, "make_pick", {
        p_league_id: leagueId,
        p_pokemon_name: pokemonName,
      }),

    autoPickIfExpired: (leagueId: string) =>
      call<AutoPickResult>(client, "auto_pick_if_expired", {
        p_league_id: leagueId,
      }),

    pauseDraft: (leagueId: string) =>
      call<null>(client, "pause_draft", { p_league_id: leagueId }),

    resumeDraft: (leagueId: string) =>
      call<null>(client, "resume_draft", { p_league_id: leagueId }),

    undoLastPick: (leagueId: string) =>
      call<UndoPickResult>(client, "undo_last_pick", {
        p_league_id: leagueId,
      }),

    forcePick: (leagueId: string, pokemonName: string | null) =>
      call<PickResult>(client, "force_pick", {
        p_league_id: leagueId,
        p_pokemon_name: pokemonName,
      }),

    finalizeDraft: (leagueId: string) =>
      call<null>(client, "finalize_draft", { p_league_id: leagueId }),

    resetDraft: (leagueId: string) =>
      call<null>(client, "reset_draft", { p_league_id: leagueId }),

    swapFreeAgent: (
      leagueId: string,
      dropName: string | null,
      addName: string
    ) =>
      call<LeagueNews>(client, "swap_free_agent", {
        p_league_id: leagueId,
        p_drop_name: dropName,
        p_add_name: addName,
      }),

    undoFreeAgentMove: (newsId: string) =>
      call<null>(client, "undo_free_agent_move", { p_news_id: newsId }),

    generateSchedule: (
      leagueId: string,
      format: ScheduleFormat,
      randomize: boolean,
      discardResults = false
    ) =>
      call<number>(client, "generate_schedule", {
        p_league_id: leagueId,
        p_format: format,
        p_randomize: randomize,
        p_discard_results: discardResults,
      }),

    reportMatchResult: (matchId: string, winnerMemberId: string) =>
      call<null>(client, "report_match_result", {
        p_match_id: matchId,
        p_winner_member_id: winnerMemberId,
      }),

    clearMatchResult: (matchId: string) =>
      call<null>(client, "clear_match_result", { p_match_id: matchId }),
  };
}

export type Rpc = ReturnType<typeof createRpc>;

let browserRpc: Rpc | null = null;

/**
 * Browser-bound wrapper set. Constructed lazily so importing this module in
 * a server component does not touch the browser client.
 */
export const rpc: Rpc = new Proxy({} as Rpc, {
  get(_target, prop) {
    if (!browserRpc) browserRpc = createRpc();
    return browserRpc[prop as keyof Rpc];
  },
});
