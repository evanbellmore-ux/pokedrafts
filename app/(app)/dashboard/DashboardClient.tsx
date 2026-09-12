"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  Hammer,
  KeyRound,
  Plus,
  Radio,
  ShieldCheck,
  Trash2,
  Trophy,
} from "lucide-react";
import Alert from "@/app/components/ui/Alert";
import Button, { ButtonLink } from "@/app/components/ui/Button";
import Dialog from "@/app/components/ui/Dialog";
import EmptyState from "@/app/components/ui/EmptyState";
import Field from "@/app/components/ui/Field";
import Input from "@/app/components/ui/Input";
import PageHeader from "@/app/components/ui/PageHeader";
import Skeleton from "@/app/components/ui/Skeleton";
import StatusPill, { type StatusTone } from "@/app/components/ui/StatusPill";
import { getCurrentUser } from "@/app/lib/auth/current-user";
import { friendlyError } from "@/app/lib/errors";
import { playoffSize } from "@/app/lib/league/bracket";
import { roleLabel, teamNameLabel } from "@/app/lib/league/labels";
import { isLeagueCommissioner } from "@/app/lib/league/permissions";
import { createClient } from "@/app/lib/supabase/client";
import type { SessionUser } from "@/app/types/league";

/** The `leagues` columns the dashboard embeds through `league_members`. */
type LeagueSummary = {
  id: string;
  name: string;
  commissioner_id: string;
  max_coaches: number;
  draft_started: boolean | null;
  draft_completed: boolean | null;
  current_pick_number: number | null;
  picks_per_team: number | null;
  playoff_format: string | null;
  champion_member_id: string | null;
};

/** Member columns read across the caller's leagues: seat counts and the champion's name. */
type LeagueMemberRow = {
  id: string;
  league_id: string;
  team_name: string | null;
};

type MembershipRow = {
  league_id: string;
  team_name: string | null;
  role: string | null;
  leagues: LeagueSummary | LeagueSummary[] | null;
};

type Phase = "live" | "setup" | "complete";

type DashboardLeague = {
  league: LeagueSummary;
  teamName: string | null;
  role: string | null;
  coachCount: number;
  phase: Phase;
  /** The champion's team name once `champion_member_id` is set. */
  championTeamName: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "signed-out" }
  | { status: "ready"; user: SessionUser; leagues: DashboardLeague[] };

/** Outcome banner after a delete (success, or a warning when nothing changed). */
type Notice = { variant: "success" | "warning"; text: string };

/** Live drafts first, then leagues still in setup, then finished drafts. */
const PHASE_ORDER: Record<Phase, number> = { live: 0, setup: 1, complete: 2 };

function phaseOf(league: LeagueSummary): Phase {
  if (league.draft_completed) return "complete";
  if (league.draft_started) return "live";
  return "setup";
}

function compareLeagues(a: DashboardLeague, b: DashboardLeague) {
  return (
    PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] ||
    a.league.name.localeCompare(b.league.name)
  );
}

type Pill = { tone: StatusTone; label: string };

/**
 * The card's phase pills. After the draft, a decided champion replaces the
 * "Draft complete" pill, and a league with a playoff format shows "Playoffs"
 * until then (docs/release-architecture.md section 12.6).
 */
function phasePills(item: DashboardLeague): Pill[] {
  switch (item.phase) {
    case "live":
      return [
        {
          tone: "warning",
          label: `Drafting: pick #${item.league.current_pick_number ?? 1}`,
        },
      ];
    case "complete":
      if (item.league.champion_member_id) {
        return [
          {
            tone: "success",
            label: `Champion: ${item.championTeamName ?? "Unknown team"}`,
          },
        ];
      }
      return playoffSize(item.league.playoff_format) > 0
        ? [
            { tone: "success", label: "Draft complete" },
            { tone: "accent", label: "Playoffs" },
          ]
        : [{ tone: "success", label: "Draft complete" }];
    default:
      return [{ tone: "accent", label: "Setup" }];
  }
}

function leagueHref(item: DashboardLeague) {
  return item.phase === "live"
    ? `/leagues/${item.league.id}/draft`
    : `/leagues/${item.league.id}`;
}

/** Accepts a bare code or a pasted invite link; returns the uppercase code. */
function normalizeInviteCode(raw: string): string {
  const match = raw.match(/invite\/([^/?#\s]+)/i);
  return (match ? match[1] : raw).replace(/\s+/g, "").toUpperCase();
}

function StatTile({
  label,
  value,
  icon: Icon,
  loading,
}: {
  label: string;
  /** Null when the count is unknown (load failed). */
  value: number | null;
  icon: typeof Trophy;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{label}</p>
        <Icon className="h-5 w-5 text-accent-text" aria-hidden="true" />
      </div>
      {loading ? (
        <Skeleton className="mt-4 h-9 w-12" />
      ) : (
        <p className="mt-4 text-3xl font-bold text-text">
          {value === null ? "—" : value}
        </p>
      )}
    </div>
  );
}

function LeagueCard({
  item,
  canDelete,
  onDelete,
}: {
  item: DashboardLeague;
  canDelete: boolean;
  onDelete: (item: DashboardLeague) => void;
}) {
  const { league } = item;
  const pills = phasePills(item);

  return (
    <li className="relative rounded-xl border border-line bg-panel p-5 transition-colors hover:border-line-strong hover:bg-panel-hover">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="wrap-anywhere text-lg font-semibold text-text">
              {/* Stretched link: the pseudo-element makes the whole card clickable. */}
              <Link
                href={leagueHref(item)}
                className="rounded-md after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {league.name}
              </Link>
            </h3>
            <StatusPill>{roleLabel(item.role)}</StatusPill>
            {pills.map((pill) => (
              <StatusPill key={pill.label} tone={pill.tone} className="wrap-anywhere">
                {pill.label}
              </StatusPill>
            ))}
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            <div className="min-w-0">
              <dt className="sr-only">Team</dt>
              <dd className="wrap-anywhere">{teamNameLabel(item.teamName)}</dd>
            </div>
            <div>
              <dt className="sr-only">Coaches</dt>
              <dd>
                {item.coachCount}/{league.max_coaches} coaches
              </dd>
            </div>
            <div>
              <dt className="sr-only">Picks per team</dt>
              <dd>{league.picks_per_team ?? 10} picks per team</dd>
            </div>
          </dl>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
          <span
            aria-hidden="true"
            className="inline-flex items-center gap-1 text-sm font-semibold text-accent-text"
          >
            {item.phase === "live" ? "Enter draft room" : "Open league"}
            <ArrowRight className="h-4 w-4" />
          </span>
          {canDelete && (
            <Button
              variant="danger"
              size="sm"
              className="relative z-10"
              onClick={() => onDelete(item)}
              aria-label={`Delete ${league.name}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Dashboard: the caller's leagues, a join-by-code card and the entry points
 * to Create League and the Pool Builder (docs/release-architecture.md
 * sections 2, 8.2 and 8.3). Deleting a league is the one direct `leagues`
 * write the policy set allows; everything else goes through the RPCs.
 */
export default function DashboardClient() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DashboardLeague | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<LoadState> => {
    try {
      // A failed session check must not read as "logged out": the session
      // is kept and the error is shown with Retry (app/lib/auth/current-user.ts).
      const current = await getCurrentUser(supabase.auth);
      if (current.status === "error") {
        return { status: "error", message: current.message };
      }
      if (current.status === "signed-out") return { status: "signed-out" };
      const { user } = current;

      const { data, error } = await supabase
        .from("league_members")
        .select(
          "league_id, team_name, role, leagues!league_id(id, name, commissioner_id, max_coaches, draft_started, draft_completed, current_pick_number, picks_per_team, playoff_format, champion_member_id)"
        )
        .eq("user_id", user.id);
      if (error) return { status: "error", message: friendlyError(error) };

      const memberships = ((data ?? []) as MembershipRow[]).flatMap((row) => {
        const league = Array.isArray(row.leagues) ? row.leagues[0] : row.leagues;
        return league ? [{ row, league }] : [];
      });

      const counts = new Map<string, number>();
      const teamNames = new Map<string, string | null>();
      const leagueIds = memberships.map(({ league }) => league.id);
      if (leagueIds.length > 0) {
        const { data: memberRows, error: countError } = await supabase
          .from("league_members")
          .select("id, league_id, team_name")
          .in("league_id", leagueIds);
        if (countError) {
          return { status: "error", message: friendlyError(countError) };
        }
        for (const member of (memberRows ?? []) as LeagueMemberRow[]) {
          counts.set(member.league_id, (counts.get(member.league_id) ?? 0) + 1);
          teamNames.set(member.id, member.team_name);
        }
      }

      const leagues = memberships
        .map(
          ({ row, league }): DashboardLeague => ({
            league,
            teamName: row.team_name,
            role: row.role,
            coachCount: counts.get(league.id) ?? 0,
            phase: phaseOf(league),
            championTeamName: league.champion_member_id
              ? teamNameLabel(teamNames.get(league.champion_member_id) ?? null)
              : null,
          })
        )
        .sort(compareLeagues);

      return { status: "ready", user, leagues };
    } catch (caught) {
      return { status: "error", message: friendlyError(caught) };
    }
  }, [supabase]);

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

  function openDelete(item: DashboardLeague) {
    setDeleteError(null);
    setPendingDelete(item);
  }

  function closeDelete() {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  }

  async function deleteLeague() {
    if (!pendingDelete || deleting) return;
    const { league } = pendingDelete;

    setDeleting(true);
    setDeleteError(null);
    try {
      // PostgREST reports a delete the policy filtered out as a success with
      // zero rows, so the returned ids are what proves it happened.
      const { data, error } = await supabase
        .from("leagues")
        .delete()
        .eq("id", league.id)
        .select("id");
      if (error) {
        setDeleteError(friendlyError(error));
        return;
      }
      if (!data || data.length === 0) {
        // The league is already gone or the caller is no longer its
        // commissioner: there is nothing left to confirm, so close the
        // dialog and show the list as it is now.
        setPendingDelete(null);
        setState(await load());
        setNotice({
          variant: "warning",
          text: "Nothing was deleted. Only the commissioner can delete a league, and it may already be gone.",
        });
        return;
      }

      setPendingDelete(null);
      setState(await load());
      setNotice({ variant: "success", text: `Deleted ${league.name}.` });
    } catch (caught) {
      setDeleteError(friendlyError(caught));
    } finally {
      setDeleting(false);
    }
  }

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = normalizeInviteCode(code);
    if (!clean) {
      setCodeError("Enter an invite code.");
      return;
    }
    if (!/^[A-Z0-9]+$/.test(clean)) {
      setCodeError("Invite codes only contain letters and numbers.");
      return;
    }
    setCodeError(null);
    router.push(`/invite/${encodeURIComponent(clean)}`);
  }

  const loading = state.status === "loading";
  const ready = state.status === "ready" ? state : null;
  const leagues = ready?.leagues ?? [];
  const stats = ready
    ? {
        leagues: leagues.length,
        commissioner: leagues.filter((item) =>
          isLeagueCommissioner(item.league, ready.user.id)
        ).length,
        live: leagues.filter((item) => item.phase === "live").length,
      }
    : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description={
          ready?.user.email
            ? `Signed in as ${ready.user.email}.`
            : "Your leagues, live drafts and draft pool tools."
        }
        actions={
          <ButtonLink href="/leagues/new">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create League
          </ButtonLink>
        }
      />

      {notice && (
        <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      {state.status === "error" && (
        <Alert
          variant="error"
          title="Could not load your leagues"
          action={
            <Button size="sm" variant="secondary" onClick={retry}>
              Retry
            </Button>
          }
        >
          {state.message}
        </Alert>
      )}

      {state.status === "signed-out" && (
        <Alert
          variant="warning"
          title="You are not logged in"
          action={
            <ButtonLink size="sm" variant="secondary" href="/login?next=/dashboard">
              Log in
            </ButtonLink>
          }
        >
          Log in to see your leagues.
        </Alert>
      )}

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Leagues"
          value={stats?.leagues ?? null}
          icon={Trophy}
          loading={loading}
        />
        <StatTile
          label="Commissioner seats"
          value={stats?.commissioner ?? null}
          icon={ShieldCheck}
          loading={loading}
        />
        <StatTile
          label="Live drafts"
          value={stats?.live ?? null}
          icon={Radio}
          loading={loading}
        />
      </section>

      <section aria-labelledby="leagues-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="leagues-heading" className="text-2xl font-bold tracking-tight text-text">
            Your leagues
          </h2>
          <p className="mt-1 text-sm text-muted">
            Continue a draft, manage settings, or review finished teams.
          </p>
        </div>

        {loading ? (
          <ul aria-busy="true" className="flex flex-col gap-3">
            {Array.from({ length: 3 }, (_, index) => (
              <li
                key={index}
                className="rounded-xl border border-line bg-panel p-5"
              >
                <Skeleton className="h-6 w-48 max-w-full" />
                <Skeleton className="mt-3 h-4 w-72 max-w-full" />
              </li>
            ))}
          </ul>
        ) : leagues.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {leagues.map((item) => (
              <LeagueCard
                key={item.league.id}
                item={item}
                canDelete={
                  ready !== null &&
                  isLeagueCommissioner(item.league, ready.user.id)
                }
                onDelete={openDelete}
              />
            ))}
          </ul>
        ) : ready ? (
          <EmptyState
            icon={<Trophy className="h-5 w-5" />}
            title="No leagues yet"
            description="Create a league to invite coaches, set up a draft pool, and run a live draft. Or join one with an invite code below."
            action={
              <ButtonLink href="/leagues/new">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create League
              </ButtonLink>
            }
          />
        ) : null}
      </section>

      <section aria-label="Join and tools" className="grid gap-4 md:grid-cols-2">
        <form
          onSubmit={handleJoin}
          noValidate
          className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-5"
        >
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-accent-text" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-text">Join with a code</h2>
          </div>
          <p className="text-sm text-muted">
            Enter the invite code a commissioner shared with you. Pasting the
            whole invite link works too.
          </p>
          <Field label="Invite code" error={codeError}>
            <Input
              value={code}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
                if (codeError) setCodeError(null);
              }}
              placeholder="e.g. K7PZQ4XM2B"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div>
            <Button type="submit" variant="secondary" disabled={!code.trim()}>
              Open invite
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </form>

        <div className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <Hammer className="h-5 w-5 text-accent-text" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-text">Draft pool tools</h2>
          </div>
          <p className="text-sm text-muted">
            Build point-priced Pokémon lists in the Pool Builder and save them
            as draft formats to reuse across your leagues.
          </p>
          <div className="mt-auto">
            <ButtonLink href="/builder" variant="secondary">
              Open Pool Builder
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          </div>
        </div>
      </section>

      <Dialog
        open={pendingDelete !== null}
        onClose={closeDelete}
        title="Delete league"
        description={
          pendingDelete
            ? `This permanently removes ${pendingDelete.league.name}, including its invite, draft picks, teams, matches and news.`
            : undefined
        }
        danger
        confirmText={pendingDelete?.league.name}
        confirmLabel="Delete league"
        onConfirm={deleteLeague}
        pending={deleting}
        error={deleteError}
      />
    </div>
  );
}
