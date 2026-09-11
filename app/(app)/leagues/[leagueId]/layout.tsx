import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import LeagueNav from "@/app/components/LeagueNav";
import { LeagueProvider } from "@/app/components/league/LeagueProvider";
import { friendlyError } from "@/app/lib/errors";
import { createServerSupabase } from "@/app/lib/supabase/server";
import type { League, LeagueMember, SessionUser } from "@/app/types/league";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LeagueContext =
  | { status: "not_found" }
  | { status: "unauthenticated" }
  | { status: "ok"; league: League; member: LeagueMember; user: SessionUser };

/**
 * Loads the league row and the caller's membership once per request
 * (shared by generateMetadata and the layout via React cache). RLS already
 * hides leagues from non-members, so a missing row means "not a member".
 */
const loadLeagueContext = cache(
  async (leagueId: string): Promise<LeagueContext> => {
    if (!UUID_PATTERN.test(leagueId)) return { status: "not_found" };

    const supabase = await createServerSupabase();
    const { data: claimsData } = await supabase.auth.getClaims();
    const claims = claimsData?.claims;

    if (!claims?.sub) return { status: "unauthenticated" };

    const [leagueResult, memberResult] = await Promise.all([
      supabase.from("leagues").select("*").eq("id", leagueId).maybeSingle(),
      supabase
        .from("league_members")
        .select("*")
        .eq("league_id", leagueId)
        .eq("user_id", claims.sub)
        .maybeSingle(),
    ]);

    if (leagueResult.error) throw new Error(friendlyError(leagueResult.error));
    if (memberResult.error) throw new Error(friendlyError(memberResult.error));
    if (!leagueResult.data || !memberResult.data) return { status: "not_found" };

    return {
      status: "ok",
      league: leagueResult.data as League,
      member: memberResult.data as LeagueMember,
      user: {
        id: claims.sub,
        email: typeof claims.email === "string" ? claims.email : null,
      },
    };
  }
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}): Promise<Metadata> {
  const { leagueId } = await params;
  const context = await loadLeagueContext(leagueId);

  if (context.status !== "ok") {
    return { title: "League" };
  }

  return {
    title: {
      default: context.league.name,
      template: `%s · ${context.league.name} | PokeDrafts`,
    },
  };
}

export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const context = await loadLeagueContext(leagueId);

  if (context.status === "unauthenticated") {
    redirect(`/login?next=${encodeURIComponent(`/leagues/${leagueId}`)}`);
  }

  if (context.status === "not_found") {
    notFound();
  }

  return (
    <LeagueProvider
      league={context.league}
      member={context.member}
      user={context.user}
    >
      <LeagueNav leagueId={leagueId} leagueName={context.league.name} />
      {children}
    </LeagueProvider>
  );
}
