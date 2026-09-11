"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Swords, Users } from "lucide-react";
import { useLeague } from "@/app/components/league/LeagueProvider";
import {
  Alert,
  Button,
  ButtonLink,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonLines,
} from "@/app/components/ui";
import { friendlyError } from "@/app/lib/errors";
import { pluralize } from "@/app/lib/league/labels";
import { createClient } from "@/app/lib/supabase/client";
import RosterStats from "./RosterStats";
import RosterTable from "./RosterTable";
import TeamCard from "./TeamCard";
import TeamNamePanel from "./TeamNamePanel";
import {
  TEAM_ROSTER_SELECT,
  leagueBudget,
  leaguePicksPerTeam,
  parseTeamRosters,
  sortTeamsByName,
  swapsRemaining,
  type TeamRoster,
} from "./roster";

type TeamsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; teams: TeamRoster[] };

type Notice = { variant: "success" | "error"; text: string };

const NO_TEAMS: TeamRoster[] = [];

/**
 * My Team: the coach's team name (inline rename), their roster once the
 * draft has finished, and every other team in the league. The league and
 * member rows come from `useLeague()`; only `drafted_teams` is read here.
 */
export default function TeamClient() {
  const { league, member, isCommissioner } = useLeague();
  const leagueId = league.id;
  const supabase = useMemo(() => createClient(), []);

  const [state, setState] = useState<TeamsState>({ status: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reloading, setReloading] = useState(false);

  const load = useCallback(async (): Promise<TeamsState> => {
    try {
      const { data, error } = await supabase
        .from("drafted_teams")
        .select(TEAM_ROSTER_SELECT)
        .eq("league_id", leagueId);

      if (error) return { status: "error", message: friendlyError(error) };
      return { status: "ready", teams: parseTeamRosters(data) };
    } catch (caught) {
      return { status: "error", message: friendlyError(caught) };
    }
  }, [supabase, leagueId]);

  useEffect(() => {
    let active = true;
    void load().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [load]);

  function retry() {
    setState({ status: "loading" });
    void load().then(setState);
  }

  async function handleRefresh() {
    if (reloading) return;
    setReloading(true);
    const next = await load();
    setState(next);
    setReloading(false);
  }

  const draftCompleted = Boolean(league.draft_completed);
  const loading = state.status === "loading";
  const teams = state.status === "ready" ? state.teams : NO_TEAMS;
  const myTeam = teams.find((team) => team.member_id === member.id) ?? null;
  const otherTeams = useMemo(
    () => sortTeamsByName(teams.filter((team) => team.member_id !== member.id)),
    [teams, member.id]
  );

  const budget = leagueBudget(league);
  const picksPerTeam = leaguePicksPerTeam(league);
  const draftHref = `/leagues/${leagueId}/draft`;
  const freeAgentsHref = `/leagues/${leagueId}/free-agents`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My Team"
        description={`Your roster and every other team in ${league.name}.`}
        actions={
          draftCompleted ? (
            <Button
              variant="secondary"
              onClick={handleRefresh}
              pending={reloading}
              pendingText="Refreshing..."
              disabled={loading}
            >
              Refresh
            </Button>
          ) : undefined
        }
      />

      {notice && (
        <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      <TeamNamePanel
        onSaved={(text) => setNotice({ variant: "success", text })}
      />

      {!draftCompleted ? (
        <EmptyState
          icon={<Swords className="h-5 w-5" />}
          title="Your roster appears after the draft"
          description={
            league.draft_started
              ? "The draft is in progress. Once the last pick is in, every team is saved here with its points and tiers."
              : "The draft has not started yet. Your Pokémon will show up here once it is complete."
          }
          action={<ButtonLink href={draftHref}>Go to draft room</ButtonLink>}
        />
      ) : loading ? (
        <div aria-busy="true" className="flex flex-col gap-6">
          <RosterStats
            loading
            items={[
              { label: "Points used", value: "" },
              { label: "Roster slots", value: "" },
              { label: "Free agent swaps", value: "" },
            ]}
          />
          <div className="rounded-xl border border-line bg-panel p-4">
            <SkeletonLines lines={4} />
          </div>
          <Skeleton className="h-6 w-32" />
          <div className="rounded-xl border border-line bg-panel p-4">
            <SkeletonLines lines={2} />
          </div>
        </div>
      ) : state.status === "error" ? (
        <Alert
          variant="error"
          action={
            <Button size="sm" variant="secondary" onClick={retry}>
              Retry
            </Button>
          }
        >
          {state.message}
        </Alert>
      ) : (
        <>
          <section
            aria-labelledby="my-roster-heading"
            className="flex flex-col gap-4"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="my-roster-heading" className="text-xl font-bold text-text">
                My roster
              </h2>
              {myTeam && (
                <ButtonLink href={freeAgentsHref} variant="secondary" size="sm">
                  Free agents
                </ButtonLink>
              )}
            </div>

            {myTeam ? (
              <>
                <RosterStats
                  items={[
                    {
                      label: "Points used",
                      value: `${myTeam.total_points} / ${budget}`,
                      hint: `${Math.max(0, budget - myTeam.total_points)} left in the budget`,
                    },
                    {
                      label: "Roster slots",
                      value: `${myTeam.pokemon.length} / ${picksPerTeam}`,
                      hint:
                        myTeam.pokemon.length < picksPerTeam
                          ? pluralize(
                              picksPerTeam - myTeam.pokemon.length,
                              "open slot"
                            )
                          : "Roster full",
                    },
                    {
                      label: "Free agent swaps",
                      value: `${swapsRemaining(league, member)} / ${league.free_agent_swap_limit}`,
                      hint: "remaining this season",
                    },
                  ]}
                />
                {myTeam.pokemon.length > 0 ? (
                  <RosterTable roster={myTeam.pokemon} label="My roster" />
                ) : (
                  <EmptyState
                    title="No Pokémon on your roster"
                    description="Every slot is open. Pick up free agents to fill your team."
                    action={
                      <ButtonLink href={freeAgentsHref}>
                        Browse free agents
                      </ButtonLink>
                    }
                  />
                )}
              </>
            ) : (
              <EmptyState
                icon={<Users className="h-5 w-5" />}
                title="No roster for your team"
                description={
                  isCommissioner
                    ? "You were not in the draft order, so there are no Pokémon on your team. You still run the league as Commissioner."
                    : "You were not in the draft order for this league, so there are no Pokémon on your team."
                }
              />
            )}
          </section>

          <section
            aria-labelledby="all-teams-heading"
            className="flex flex-col gap-4"
          >
            <h2 id="all-teams-heading" className="text-xl font-bold text-text">
              All teams
            </h2>

            {otherTeams.length > 0 ? (
              <div className="flex flex-col gap-4">
                {otherTeams.map((team) => (
                  <TeamCard key={team.id} team={team} budget={budget} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Users className="h-5 w-5" />}
                title="No other teams yet"
                description="Yours is the only team with a roster in this league."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
