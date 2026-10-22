import "server-only";
import { cache } from "react";
import { createRpc } from "@/app/lib/rpc";
import { createServerSupabase } from "@/app/lib/supabase/server";
import type { PublicLeague, PublicLeagueList } from "@/app/types/league";

/**
 * The Watch pages read on the server, so a shared link and a search engine
 * see the league, and the live check can run beside the read with keys that
 * never reach the browser (docs/release-architecture.md section 15.5). The
 * two functions are callable without a session; the visitor's own session,
 * if any, rides along. Cached per request, so generateMetadata and the page
 * share one call.
 */

export type Loaded<T> = { data: T; error: null } | { data: null; error: string };

export const readPublicLeagues = cache(async (): Promise<Loaded<PublicLeagueList>> => {
  const rpc = createRpc(await createServerSupabase());
  const { data, error } = await rpc.listPublicLeagues();
  if (error !== null) return { data: null, error };
  return { data: { server_time: data.server_time, leagues: data.leagues ?? [] }, error: null };
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A public league, or `data: null` when the id is malformed, unknown or private. */
export const readPublicLeague = cache(async (leagueId: string): Promise<Loaded<PublicLeague | null>> => {
  if (!UUID_PATTERN.test(leagueId)) return { data: null, error: null };
  const rpc = createRpc(await createServerSupabase());
  const { data, error } = await rpc.getPublicLeague(leagueId);
  if (error !== null) return { data: null, error };
  return { data: data ?? null, error: null };
});
