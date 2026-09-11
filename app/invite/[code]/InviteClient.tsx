"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Users } from "lucide-react";
import Alert from "@/app/components/ui/Alert";
import Button, { ButtonLink } from "@/app/components/ui/Button";
import EmptyState from "@/app/components/ui/EmptyState";
import Field from "@/app/components/ui/Field";
import Input from "@/app/components/ui/Input";
import Skeleton, { SkeletonLines } from "@/app/components/ui/Skeleton";
import StatusPill from "@/app/components/ui/StatusPill";
import { getCurrentUser } from "@/app/lib/auth/current-user";
import { friendlyError } from "@/app/lib/errors";
import { rpc } from "@/app/lib/rpc";
import { createClient } from "@/app/lib/supabase/client";
import { LEAGUE_LIMITS, type InvitePreview } from "@/app/types/league";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: InvitePreview; loggedIn: boolean };

export default function InviteClient({ code }: { code: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [teamName, setTeamName] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(async (): Promise<LoadState> => {
    try {
      const supabase = createClient();
      const [previewResult, current] = await Promise.all([
        rpc.getInvitePreview(code),
        getCurrentUser(supabase.auth),
      ]);

      if (previewResult.error !== null) {
        return { status: "error", message: previewResult.error };
      }

      // A failed session check must not pass for "logged out": the "Log in
      // to join" button would send a signed-in coach to /login for nothing
      // (app/lib/auth/current-user.ts). Show it with Retry instead.
      if (current.status === "error") {
        return { status: "error", message: current.message };
      }

      return {
        status: "ready",
        preview: previewResult.data,
        loggedIn: current.status === "signed-in",
      };
    } catch (caught) {
      return { status: "error", message: friendlyError(caught) };
    }
  }, [code]);

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

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (joining) return;

    const cleanName = teamName.trim();
    if (
      cleanName.length < LEAGUE_LIMITS.teamName.min ||
      cleanName.length > LEAGUE_LIMITS.teamName.max
    ) {
      setJoinError(
        `Team names are ${LEAGUE_LIMITS.teamName.min} to ${LEAGUE_LIMITS.teamName.max} characters.`
      );
      return;
    }

    setJoinError(null);
    setJoining(true);

    const { data: leagueId, error } = await rpc.joinLeague(code, cleanName);

    if (error || !leagueId) {
      setJoinError(error ?? "Could not join the league.");
      setJoining(false);
      return;
    }

    router.replace(`/leagues/${leagueId}`);
    router.refresh();
  }

  const invitePath = `/invite/${encodeURIComponent(code)}`;
  const loginHref = `/login?next=${encodeURIComponent(invitePath)}`;
  const signupHref = `/signup?next=${encodeURIComponent(invitePath)}`;

  if (state.status === "loading") {
    return (
      <div aria-busy="true">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-8 w-3/4" />
        <SkeletonLines lines={2} className="mt-4" />
        <Skeleton className="mt-6 h-12 w-full" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <h1 className="text-2xl font-bold sm:text-3xl">League invite</h1>
        <Alert
          variant="error"
          className="mt-5"
          action={
            <Button size="sm" variant="secondary" onClick={retry}>
              Retry
            </Button>
          }
        >
          {state.message}
        </Alert>
      </>
    );
  }

  const { preview, loggedIn } = state;

  if (!preview.invite_valid || !preview.league_id) {
    return (
      <>
        <h1 className="text-2xl font-bold sm:text-3xl">League invite</h1>
        <EmptyState
          className="mt-5"
          icon={<Users className="h-5 w-5" />}
          title="This invite is no longer valid"
          description="The link may have been replaced by the commissioner, or the league no longer exists. Ask them for a fresh link."
          action={
            <ButtonLink href={loggedIn ? "/dashboard" : "/"} variant="secondary">
              {loggedIn ? "Go to dashboard" : "Home"}
            </ButtonLink>
          }
        />
      </>
    );
  }

  const full = preview.coach_count >= preview.max_coaches;
  const leagueHref = `/leagues/${preview.league_id}`;

  const status = preview.draft_completed
    ? { tone: "success" as const, label: "Season underway" }
    : preview.draft_started
      ? { tone: "warning" as const, label: "Draft in progress" }
      : { tone: "accent" as const, label: "Waiting for coaches" };

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">
        You are invited to coach in
      </p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
        {preview.league_name ?? "a league"}
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        <span>
          {preview.coach_count} of {preview.max_coaches} coaches
        </span>
      </div>

      {preview.already_member ? (
        <>
          <Alert variant="info" className="mt-5">
            You are already a coach in this league.
          </Alert>
          <div className="mt-5">
            <ButtonLink href={leagueHref}>Open league</ButtonLink>
          </div>
        </>
      ) : preview.draft_started ? (
        <>
          <Alert variant="warning" className="mt-5">
            The draft has already started, so this league is no longer taking
            new coaches.
          </Alert>
          <div className="mt-5">
            <ButtonLink href={loggedIn ? "/dashboard" : "/"} variant="secondary">
              {loggedIn ? "Go to dashboard" : "Home"}
            </ButtonLink>
          </div>
        </>
      ) : full ? (
        <>
          <Alert variant="warning" className="mt-5">
            This league is full. Ask the commissioner to raise the coach limit
            if there should be room for you.
          </Alert>
          <div className="mt-5">
            <ButtonLink href={loggedIn ? "/dashboard" : "/"} variant="secondary">
              {loggedIn ? "Go to dashboard" : "Home"}
            </ButtonLink>
          </div>
        </>
      ) : !loggedIn ? (
        <>
          <p className="mt-5 text-sm text-muted">
            Log in or create an account to join. You will come straight back
            to this invite afterwards.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <ButtonLink href={loginHref}>Log in to join</ButtonLink>
            <ButtonLink href={signupHref} variant="secondary">
              Create an account
            </ButtonLink>
          </div>
        </>
      ) : (
        <form onSubmit={handleJoin} noValidate className="mt-6 flex flex-col gap-4">
          <Field
            label="Team name"
            required
            help={`You can change this later. ${LEAGUE_LIMITS.teamName.max} characters max.`}
          >
            <Input
              name="team-name"
              autoComplete="off"
              maxLength={LEAGUE_LIMITS.teamName.max}
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              disabled={joining}
              autoFocus
            />
          </Field>

          {joinError && <Alert variant="error">{joinError}</Alert>}

          <Button
            type="submit"
            size="lg"
            pending={joining}
            pendingText="Joining..."
            disabled={!teamName.trim()}
            className="w-full"
          >
            Join league
          </Button>
        </form>
      )}
    </>
  );
}
