"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Check, Copy, Plus, X } from "lucide-react";
import { Alert, Button, Field, Input } from "@/app/components/ui";
import { rpc } from "@/app/lib/rpc";
import { linkClassName } from "@/app/lib/theme";
import {
  LINK_MAX,
  REPLAY_LIMIT,
  REPLAY_TITLE_MAX,
  parseReplayLink,
  parseStreamLink,
  platformOf,
  readReplayEntries,
} from "@/app/lib/watch/stream-links";
import type { League, ReplayLinkRow } from "@/app/types/league";

type PublicPageCardProps = {
  league: League;
  /** Called after a save; the parent refreshes the league and reports. */
  onSaved: (madePublic: boolean | null) => Promise<void>;
};

type Values = { isPublic: boolean; stream: string; replays: ReplayLinkRow[] };

function valuesFromLeague(league: League): Values {
  return {
    isPublic: league.is_public ?? false,
    stream: league.stream_url ?? "",
    replays: readReplayEntries(league.replay_links).map(({ title, url, added_at }) => ({ title, url, added_at })),
  };
}

function sameValues(a: Values, b: Values) {
  return (
    a.isPublic === b.isPublic &&
    a.stream.trim() === b.stream.trim() &&
    a.replays.length === b.replays.length &&
    a.replays.every((replay, index) => replay.url === b.replays[index].url && replay.title === b.replays[index].title)
  );
}

const subscribeNoop = () => () => {};

function useOrigin() {
  return useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => ""
  );
}

/**
 * The commissioner's Public page card (docs/release-architecture.md section
 * 15): make the league public, attach its stream, list replays. Links are
 * checked and normalized here (app/lib/watch/stream-links.ts) and saved
 * together through `update_league_public_page`, which accepts only the
 * normalized forms.
 */
export default function PublicPageCard({ league, onSaved }: PublicPageCardProps) {
  const origin = useOrigin();
  const saved = valuesFromLeague(league);
  const [seed, setSeed] = useState(saved);
  const [form, setForm] = useState(saved);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [addError, setAddError] = useState<{ field: "title" | "url"; text: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt the row after a refresh (own save, another tab, a transfer).
  if (!sameValues(seed, saved)) {
    setSeed(saved);
    setForm(saved);
    setStreamError(null);
  }

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const dirty = !sameValues(form, saved);
  const watchPath = `/watch/${league.id}`;
  const watchLink = `${origin}${watchPath}`;
  const full = form.replays.length >= REPLAY_LIMIT;

  function addReplay() {
    const title = newTitle.trim();
    const parsed = parseReplayLink(newUrl);
    if (!parsed.ok) {
      setAddError({ field: "url", text: parsed.error });
      return;
    }
    if (!title) {
      setAddError({ field: "title", text: "Give the replay a title." });
      return;
    }
    if (form.replays.some((replay) => replay.url === parsed.link.url)) {
      setAddError({ field: "url", text: "That replay is already in the list." });
      return;
    }
    setAddError(null);
    setFormError(null);
    setForm((previous) => ({
      ...previous,
      replays: [{ title, url: parsed.link.url }, ...previous.replays],
    }));
    setNewTitle("");
    setNewUrl("");
  }

  function removeReplay(url: string) {
    setForm((previous) => ({ ...previous, replays: previous.replays.filter((replay) => replay.url !== url) }));
  }

  function resetForm() {
    setForm(saved);
    setStreamError(null);
    setFormError(null);
    setAddError(null);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(watchLink);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    let streamUrl: string | null = null;
    if (form.stream.trim()) {
      const parsed = parseStreamLink(form.stream);
      if (!parsed.ok) {
        setStreamError(parsed.error);
        setFormError("Fix the stream link and try again.");
        return;
      }
      streamUrl = parsed.link.url;
    }
    if (!dirty) {
      setFormError("Nothing has changed.");
      return;
    }

    setStreamError(null);
    setFormError(null);
    setPending(true);
    const { error } = await rpc.updateLeaguePublicPage(league.id, {
      is_public: form.isPublic,
      stream_url: streamUrl,
      replay_links: form.replays,
    });
    if (error !== null) {
      setFormError(error);
      setPending(false);
      return;
    }
    await onSaved(form.isPublic === saved.isPublic ? null : form.isPublic);
    setPending(false);
  }

  return (
    <section aria-labelledby="public-page-heading" className="rounded-xl border border-line bg-panel p-5">
      <h2 id="public-page-heading" className="text-base font-semibold text-text">
        Public page
      </h2>
      <p className="mt-2 text-sm text-muted">
        {saved.isPublic
          ? "Anyone with the link can watch this league, and it is listed on Watch."
          : "Only the league's coaches can see it."}
      </p>

      {saved.isPublic && (
        <div className="mt-4 flex flex-col gap-2">
          <Field label="Watch link">
            <Input readOnly value={watchLink} onFocus={(event) => event.target.select()} spellCheck={false} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={copyLink} disabled={!origin}>
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Link href={watchPath} className={`${linkClassName} text-sm font-medium text-accent-text hover:underline`}>
              Open the watch page
            </Link>
            <span role="status" className="text-sm text-muted">
              {copied ? "Copied to the clipboard." : ""}
            </span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-4 flex flex-col gap-4">
        <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
          <input
            type="checkbox"
            checked={form.isPublic}
            onChange={(event) => {
              setForm((previous) => ({ ...previous, isPublic: event.target.checked }));
              setFormError(null);
            }}
            disabled={pending}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
          <span className="min-w-0">
            <span className="block font-medium text-text">Public league</span>
            <span className="mt-0.5 block text-muted">
              Anyone, signed in or not, can watch the stream, the draft board and the standings. Team
              names are shown; coaches&apos; accounts, the invite link and the draft chat stay private.
            </span>
          </span>
        </label>

        <Field
          label="Stream link"
          error={streamError ?? undefined}
          help="A Twitch channel, or a YouTube channel or live video. Leave it empty for none."
        >
          <Input
            name="stream-link"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={LINK_MAX}
            placeholder="https://www.twitch.tv/yourchannel"
            value={form.stream}
            onChange={(event) => {
              setForm((previous) => ({ ...previous, stream: event.target.value }));
              setStreamError(null);
              setFormError(null);
            }}
            disabled={pending}
          />
        </Field>

        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="text-sm font-medium text-text">Replays</legend>
          <p className="-mt-1 text-sm text-muted">
            Twitch videos and clips, or YouTube videos: what Watch shows while nothing is live.{" "}
            {form.replays.length} of {REPLAY_LIMIT}.
          </p>

          {form.replays.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {form.replays.map((replay) => {
                const link = parseReplayLink(replay.url);
                return (
                  <li key={replay.url} className="flex min-w-0 items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="wrap-anywhere text-sm font-medium text-text">{replay.title}</p>
                      <p className="truncate text-xs text-muted">
                        {link.ok ? `${platformOf(link.link)} · ` : ""}
                        {replay.url.replace(/^https:\/\/(www\.)?/, "")}
                      </p>
                    </div>
                    <Button
                      variant="ghost-danger"
                      size="icon"
                      onClick={() => removeReplay(replay.url)}
                      disabled={pending}
                      aria-label={`Remove replay: ${replay.title}`}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] sm:items-end">
            <Field label="Replay title" error={addError?.field === "title" ? addError.text : undefined}>
              <Input
                name="replay-title"
                autoComplete="off"
                maxLength={REPLAY_TITLE_MAX}
                placeholder="Draft night"
                value={newTitle}
                onChange={(event) => {
                  setNewTitle(event.target.value);
                  setAddError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (newUrl.trim()) addReplay();
                  }
                }}
                disabled={pending || full}
              />
            </Field>
            <Field label="Replay link" error={addError?.field === "url" ? addError.text : undefined}>
              <Input
                name="replay-link"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                maxLength={LINK_MAX}
                placeholder="https://www.twitch.tv/videos/…"
                value={newUrl}
                onChange={(event) => {
                  setNewUrl(event.target.value);
                  setAddError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addReplay();
                  }
                }}
                disabled={pending || full}
              />
            </Field>
            <Button
              type="button"
              variant="secondary"
              onClick={addReplay}
              disabled={pending || full || !newUrl.trim()}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
          </div>
        </fieldset>

        {formError && <Alert variant="error">{formError}</Alert>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={resetForm} disabled={!dirty || pending}>
            Discard changes
          </Button>
          <Button type="submit" pending={pending} pendingText="Saving..." disabled={!dirty}>
            Save public page
          </Button>
        </div>
      </form>
    </section>
  );
}
