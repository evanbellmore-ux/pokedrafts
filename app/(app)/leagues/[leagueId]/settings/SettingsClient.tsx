"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLeague } from "@/app/components/league/LeagueProvider";
import {
  Alert,
  Button,
  PageHeader,
  Skeleton,
  SkeletonLines,
} from "@/app/components/ui";
import { friendlyError } from "@/app/lib/errors";
import { teamNameLabel } from "@/app/lib/league/labels";
import { createClient } from "@/app/lib/supabase/client";
import type { LeagueInvite, LeagueSettingsInput } from "@/app/types/league";
import CoachesCard from "./CoachesCard";
import DangerZone from "./DangerZone";
import DraftOrderCard from "./DraftOrderCard";
import type { FormatOption, Notice, SettingsMember } from "./helpers";
import InviteCard from "./InviteCard";
import SettingsForm from "./SettingsForm";
import SettingsSummary from "./SettingsSummary";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      members: SettingsMember[];
      formats: FormatOption[];
      invite: LeagueInvite | null;
    };

function SettingsSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading settings"
      className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
    >
      <div className="flex min-w-0 flex-col gap-6">
        <div className="rounded-xl border border-line bg-panel p-5">
          <Skeleton className="h-6 w-40" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-panel p-5">
          <Skeleton className="h-6 w-32" />
          <SkeletonLines lines={4} className="mt-4" />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <div className="rounded-xl border border-line bg-panel p-5">
          <Skeleton className="h-6 w-24" />
          <SkeletonLines lines={3} className="mt-4" />
        </div>
        <div className="rounded-xl border border-line bg-panel p-5">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="mt-4 h-11 w-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * Settings page. Coaches get a read-only summary; the commissioner gets the
 * settings form, draft order, coach management, the invite link and the
 * danger zone. Every write goes through `rpc.*` (the league delete is the
 * one direct write the policy set allows), and anything that changes the
 * league or member row is followed by `refresh()` from the league context.
 */
export default function SettingsClient() {
  const router = useRouter();
  const { league, user, isCommissioner, refresh } = useLeague();
  const leagueId = league.id;
  const supabase = useMemo(() => createClient(), []);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const generationRef = useRef(0);

  const load = useCallback(async (): Promise<LoadState> => {
    try {
      const [membersResult, formatsResult] = await Promise.all([
        supabase
          .from("league_members")
          .select("id, user_id, team_name, role, draft_position, joined_at")
          .eq("league_id", leagueId)
          .order("draft_position", { ascending: true, nullsFirst: false })
          .order("team_name", { ascending: true }),
        supabase
          .from("draft_formats")
          .select("id, name, created_by")
          .order("name", { ascending: true }),
      ]);
      if (membersResult.error) {
        return { status: "error", message: friendlyError(membersResult.error) };
      }
      if (formatsResult.error) {
        return { status: "error", message: friendlyError(formatsResult.error) };
      }

      // Only the commissioner can read the invite row (RLS); coaches never ask.
      let invite: LeagueInvite | null = null;
      if (isCommissioner) {
        const inviteResult = await supabase
          .from("league_invites")
          .select("*")
          .eq("league_id", leagueId)
          .order("created_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        if (inviteResult.error) {
          return { status: "error", message: friendlyError(inviteResult.error) };
        }
        invite = (inviteResult.data as LeagueInvite | null) ?? null;
      }

      return {
        status: "ready",
        members: (membersResult.data ?? []) as SettingsMember[],
        formats: (formatsResult.data ?? []) as FormatOption[],
        invite,
      };
    } catch (caught) {
      return { status: "error", message: friendlyError(caught) };
    }
  }, [supabase, leagueId, isCommissioner]);

  /** Re-reads and applies the result unless a newer request has started. */
  const reload = useCallback(() => {
    const generation = ++generationRef.current;
    return load().then((next) => {
      if (generation === generationRef.current) setState(next);
      return next;
    });
  }, [load]);

  useEffect(() => {
    void reload();
    return () => {
      generationRef.current += 1;
    };
  }, [reload]);

  function retry() {
    setState({ status: "loading" });
    void reload();
  }

  /**
   * After a mutation: reload the page data, refresh the league context when
   * the league or member row changed, then report. The success message is
   * only set once the reload has finished (docs section 8.2).
   */
  const settle = useCallback(
    async (text: string, options: { refreshLeague?: boolean } = {}) => {
      const [next, refreshError] = await Promise.all([
        reload(),
        options.refreshLeague ? refresh() : Promise.resolve<string | null>(null),
      ]);
      const problem = next.status === "error" ? next.message : refreshError;
      setNotice(
        problem
          ? {
              variant: "warning",
              text: `${text} The page could not be refreshed: ${problem}`,
            }
          : { variant: "success", text }
      );
    },
    [reload, refresh]
  );

  async function handleSettingsSaved(patch: LeagueSettingsInput) {
    const poolNote =
      "draft_format_id" in patch
        ? patch.draft_format_id
          ? " The draft pool was replaced with a copy of the chosen format."
          : " The draft pool was cleared."
        : "";
    await settle(`Settings saved.${poolNote}`, { refreshLeague: true });
    // The league layout renders the name in the eyebrow and the tab title;
    // re-render it so a rename shows up without leaving the page.
    router.refresh();
  }

  async function handleOrderSaved() {
    await settle("Draft order saved.", { refreshLeague: true });
  }

  async function handleRemoved(member: SettingsMember) {
    // remove_member rotates the invite code; settle() re-reads the invite row.
    await settle(
      `Removed ${teamNameLabel(member.team_name)} from the league. The invite link was replaced; share the new one with anyone who should still join.`
    );
  }

  async function handleTransferred(member: SettingsMember) {
    // The server layout re-renders with the new commissioner; the context
    // refresh flips this page to the read-only view right away.
    router.refresh();
    await settle(`${teamNameLabel(member.team_name)} is now the commissioner.`, {
      refreshLeague: true,
    });
  }

  async function handleRegenerated() {
    await settle("Invite link regenerated. The old link no longer works.");
  }

  async function handleReset() {
    await settle(
      "Draft reset. Picks, teams, matches and news were cleared; the draft is back in setup.",
      { refreshLeague: true }
    );
  }

  const ready = state.status === "ready" ? state : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description={
          isCommissioner
            ? "League rules, draft order, coaches and the invite link."
            : "How this league is set up."
        }
      />

      {notice && (
        <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      {!isCommissioner && (
        <Alert variant="info">Only the commissioner can change settings.</Alert>
      )}

      {state.status === "loading" && <SettingsSkeleton />}

      {state.status === "error" && (
        <Alert
          variant="error"
          title="Could not load the settings"
          action={
            <Button size="sm" variant="secondary" onClick={retry}>
              Retry
            </Button>
          }
        >
          {state.message}
        </Alert>
      )}

      {ready && !isCommissioner && (
        <SettingsSummary
          league={league}
          members={ready.members}
          formats={ready.formats}
          currentUserId={user.id}
        />
      )}

      {ready && isCommissioner && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <SettingsForm
              league={league}
              memberCount={ready.members.length}
              formats={ready.formats}
              currentUserId={user.id}
              onSaved={handleSettingsSaved}
            />
            <DraftOrderCard
              league={league}
              members={ready.members}
              currentUserId={user.id}
              onSaved={handleOrderSaved}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <CoachesCard
              league={league}
              members={ready.members}
              currentUserId={user.id}
              onRemoved={handleRemoved}
              onTransferred={handleTransferred}
            />
            <InviteCard
              league={league}
              invite={ready.invite}
              memberCount={ready.members.length}
              onRegenerated={handleRegenerated}
            />
            <DangerZone league={league} onReset={handleReset} />
          </div>
        </div>
      )}
    </div>
  );
}
