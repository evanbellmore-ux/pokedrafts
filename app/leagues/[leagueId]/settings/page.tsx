"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";

type DraftFormatOption = {
  id: string;
  name: string;
};

export default function LeagueSettingsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [leagueName, setLeagueName] = useState("");
  const [maxCoaches, setMaxCoaches] = useState(8);
  const [draftFormatId, setDraftFormatId] = useState("");
  const [formats, setFormats] = useState<DraftFormatOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const { data: league } = await supabase
      .from("leagues")
      .select("name, max_coaches, draft_format_id")
      .eq("id", leagueId)
      .single();

    const { data: formatData } = await supabase
      .from("draft_formats")
      .select("id, name")
      .order("name", { ascending: true });

    if (league) {
      setLeagueName(league.name ?? "");
      setMaxCoaches(league.max_coaches ?? 8);
      setDraftFormatId(league.draft_format_id ?? "");
    }

    setFormats(formatData ?? []);
  }

  async function saveSettings() {
    setSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("leagues")
      .update({
        name: leagueName.trim(),
        max_coaches: maxCoaches,
        draft_format_id: draftFormatId || null,
      })
      .eq("id", leagueId);

    setSaving(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Settings saved.");
  }

  return (
    <>
      <h1 className="text-4xl font-bold">League Settings</h1>

      <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <label className="block text-sm font-medium text-zinc-300">
          League Name
        </label>

        <input
          value={leagueName}
          onChange={(e) => setLeagueName(e.target.value)}
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3"
        />

        <label className="mt-5 block text-sm font-medium text-zinc-300">
          Max Coaches
        </label>

        <input
          type="number"
          min={2}
          max={24}
          value={maxCoaches}
          onChange={(e) => setMaxCoaches(Number(e.target.value))}
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3"
        />

        <label className="mt-5 block text-sm font-medium text-zinc-300">
          Draft Format
        </label>

        <select
          value={draftFormatId}
          onChange={(e) => setDraftFormatId(e.target.value)}
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3"
        >
          <option value="">No draft format selected</option>

          {formats.map((format) => (
            <option key={format.id} value={format.id}>
              {format.name}
            </option>
          ))}
        </select>

        <button
          onClick={saveSettings}
          disabled={saving}
          className="mt-6 rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>

        {message && <p className="mt-4 text-sm text-zinc-400">{message}</p>}
      </section>
    </>
  );
}