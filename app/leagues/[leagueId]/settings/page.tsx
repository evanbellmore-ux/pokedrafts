"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { ScheduleFormat } from "@/app/lib/league/schedule";
import { createClient } from "@/app/lib/supabase/client";

type DraftFormatOption = {
  id: string;
  name: string;
};

type LeagueMember = {
  id: string;
  user_id: string;
  team_name: string | null;
  role: string | null;
  draft_position: number | null;
};

function hasCommissionerRole(role: string | null | undefined) {
  const normalizedRole = role?.trim().toLowerCase();

  return normalizedRole === "commissioner" || normalizedRole === "commisioner";
}

export default function LeagueSettingsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [leagueName, setLeagueName] = useState("");
  const [maxCoaches, setMaxCoaches] = useState(8);
  const [pointBudget, setPointBudget] = useState(120);
  const [picksPerTeam, setPicksPerTeam] = useState(10);
  const [pickTimerSeconds, setPickTimerSeconds] = useState(120);
  const [scheduleFormat, setScheduleFormat] =
    useState<ScheduleFormat>("round_robin");
  const [draftFormatId, setDraftFormatId] = useState("");

  const [formats, setFormats] = useState<DraftFormatOption[]>([]);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [isCommissioner, setIsCommissioner] = useState(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSettings() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: league } = await supabase
      .from("leagues")
      .select("name, max_coaches, point_budget, picks_per_team, pick_timer_seconds, schedule_format, draft_format_id, commissioner_id")
      .eq("id", leagueId)
      .single();

    const { data: formatData } = await supabase
      .from("draft_formats")
      .select("id, name")
      .order("name", { ascending: true });

    const { data: memberData, error: memberError } = await supabase
      .from("league_members")
      .select("id, user_id, team_name, role, draft_position")
      .eq("league_id", leagueId)
      .order("draft_position", { ascending: true, nullsFirst: false })
      .order("team_name", { ascending: true });

    if (memberError) {
      setMessage(memberError.message);
    }

    const { data: currentMember } = user
      ? await supabase
          .from("league_members")
          .select("role")
          .eq("league_id", leagueId)
          .eq("user_id", user.id)
          .maybeSingle()
      : { data: null };

    if (league) {
      setIsCommissioner(
        hasCommissionerRole(currentMember?.role) ||
          Boolean(user && league.commissioner_id === user.id)
      );
      setLeagueName(league.name ?? "");
      setMaxCoaches(league.max_coaches ?? 8);
      setPointBudget(league.point_budget ?? 120);
      setPicksPerTeam(league.picks_per_team ?? 10);
      setPickTimerSeconds(league.pick_timer_seconds ?? 120);
      setScheduleFormat(
        league.schedule_format === "double_round_robin"
          ? "double_round_robin"
          : "round_robin"
      );
      setDraftFormatId(league.draft_format_id ?? "");
    }

    setFormats(formatData ?? []);
    setMembers(memberData ?? []);
  }

  function updateDraftPosition(memberId: string, value: number) {
    setMembers((prev) =>
      prev.map((member) =>
        member.id === memberId
          ? { ...member, draft_position: value || null }
          : member
      )
    );
  }

  function randomizeDraftOrder() {
    const shuffled = [...members].sort(() => Math.random() - 0.5);

    setMembers(
      shuffled.map((member, index) => ({
        ...member,
        draft_position: index + 1,
      }))
    );
  }

  function clearDraftOrder() {
    setMembers(
      members.map((member) => ({
        ...member,
        draft_position: null,
      }))
    );
  }

  async function saveSettings() {
    setSaving(true);
    setMessage("");

    if (!isCommissioner) {
      setMessage("Only the commissioner can save league settings.");
      setSaving(false);
      return;
    }

    const { error: leagueError } = await supabase
      .from("leagues")
      .update({
        name: leagueName.trim(),
        max_coaches: maxCoaches,
        point_budget: pointBudget,
        picks_per_team: picksPerTeam,
        pick_timer_seconds: pickTimerSeconds,
        schedule_format: scheduleFormat,
        draft_format_id: draftFormatId || null,
      })
      .eq("id", leagueId);

    if (leagueError) {
      setMessage(leagueError.message);
      setSaving(false);
      return;
    }

    for (const member of members) {
      const { error } = await supabase
        .from("league_members")
        .update({
          draft_position: member.draft_position,
        })
        .eq("id", member.id);

      if (error) {
        setMessage(error.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setMessage("Settings saved.");
    await loadSettings();
  }

  return (
    <>
      <h1 className="text-4xl font-bold">League Settings</h1>

      <section className="mt-6 rounded-lg border border-amber-900/40 bg-stone-900 p-5">
        <h2 className="text-xl font-semibold">League Info</h2>

        <label className="mt-5 block text-sm font-medium text-stone-300">
          League Name
        </label>
        <input
          value={leagueName}
          onChange={(e) => setLeagueName(e.target.value)}
          className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
        />

        <label className="mt-5 block text-sm font-medium text-stone-300">
          Max Coaches
        </label>
        <input
          type="number"
          min={2}
          max={24}
          value={maxCoaches}
          onChange={(e) => setMaxCoaches(Number(e.target.value))}
          className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
        />

        <label className="mt-5 block text-sm font-medium text-stone-300">
          Point Budget
        </label>
        <input
          type="number"
          min={1}
          value={pointBudget}
          onChange={(e) => setPointBudget(Number(e.target.value))}
          className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
        />

        <label className="mt-5 block text-sm font-medium text-stone-300">
          Picks Per Team
        </label>
        <input
          type="number"
          min={1}
          value={picksPerTeam}
          onChange={(e) => setPicksPerTeam(Number(e.target.value))}
          className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
        />

        <label className="mt-5 block text-sm font-medium text-stone-300">
          Pick Timer Seconds
        </label>
        <input
          type="number"
          min={10}
          value={pickTimerSeconds}
          onChange={(e) => setPickTimerSeconds(Number(e.target.value))}
          className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
        />

        <label className="mt-5 block text-sm font-medium text-stone-300">
          Draft Format
        </label>
        <select
          value={draftFormatId}
          onChange={(e) => setDraftFormatId(e.target.value)}
          className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
        >
          <option value="">No draft format selected</option>
          {formats.map((format) => (
            <option key={format.id} value={format.id}>
              {format.name}
            </option>
          ))}
        </select>

        <label className="mt-5 block text-sm font-medium text-stone-300">
          Matchup Format
        </label>
        <select
          value={scheduleFormat}
          onChange={(e) => setScheduleFormat(e.target.value as ScheduleFormat)}
          className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
        >
          <option value="round_robin">Round Robin</option>
          <option value="double_round_robin">Double Round Robin</option>
        </select>
      </section>

      <section className="mt-6 rounded-lg border border-emerald-900/40 bg-stone-900 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Draft Order</h2>
            <p className="mt-1 text-sm text-stone-400">
              Assign each team a draft position. Position 1 picks first.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={randomizeDraftOrder}
              className="rounded-lg border border-amber-800/50 bg-stone-900 px-4 py-2 text-sm font-semibold hover:bg-stone-800"
            >
              Randomize
            </button>

            <button
              onClick={clearDraftOrder}
              className="rounded-lg border border-stone-700 bg-stone-900 px-4 py-2 text-sm font-semibold hover:bg-stone-800"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-amber-900/30 bg-stone-950 p-3"
            >
              <div>
                <p className="font-semibold">
                  {member.team_name || "Unnamed Team"}
                </p>
                <p className="text-sm text-stone-500">{member.role}</p>
              </div>

              <input
                type="number"
                min={1}
                max={members.length}
                value={member.draft_position ?? ""}
                onChange={(e) =>
                  updateDraftPosition(member.id, Number(e.target.value))
                }
                placeholder="-"
                className="w-24 rounded-lg border border-stone-700 bg-stone-900 p-3 text-center"
              />
            </div>
          ))}

          {members.length === 0 && (
            <p className="text-sm text-stone-500">No members yet.</p>
          )}
        </div>
      </section>

      <button
        onClick={saveSettings}
        disabled={saving || !isCommissioner}
        className="mt-6 rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-stone-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Settings"}
      </button>

      {!isCommissioner && (
        <p className="mt-4 text-sm text-stone-500">
          Only the commissioner can change league settings.
        </p>
      )}

      {message && <p className="mt-4 text-sm text-stone-400">{message}</p>}
    </>
  );
}
