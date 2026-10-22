/**
 * Stream and replay links for public leagues (docs/release-architecture.md
 * section 15). A commissioner pastes whatever their browser shows; the
 * Settings card stores the normalized form, which is the only form the
 * database accepts (`_stream_url_ok` and `_replay_url_ok` in
 * supabase/migrations/20261022120000_public_leagues.sql), and the watch
 * pages turn a stored link back into an embedded player.
 *
 * Stored forms:
 * - stream: https://www.twitch.tv/<login>, https://www.youtube.com/channel/<UC id>,
 *   https://www.youtube.com/@<handle>, https://www.youtube.com/watch?v=<id>
 * - replay: https://www.twitch.tv/videos/<id>[?t=<h>h<m>m<s>s],
 *   https://clips.twitch.tv/<slug>, https://www.youtube.com/watch?v=<id>[&t=<s>s]
 */

export const REPLAY_LIMIT = 20;
export const REPLAY_TITLE_MAX = 80;
export const LINK_MAX = 200;

export type StreamLink =
  | { kind: "twitch_channel"; url: string; login: string }
  | { kind: "youtube_channel"; url: string; channelId: string }
  | { kind: "youtube_handle"; url: string; handle: string }
  | { kind: "youtube_video"; url: string; videoId: string };

export type ReplayLink =
  | { kind: "twitch_video"; url: string; videoId: string; startSeconds: number | null }
  | { kind: "twitch_clip"; url: string; slug: string }
  | { kind: "youtube_video"; url: string; videoId: string; startSeconds: number | null };

export type LinkResult<T> = { ok: true; link: T } | { ok: false; error: string };

/** A replay as `leagues.replay_links` stores it. */
export type ReplayEntry = { title: string; url: string; added_at?: string };

export type StreamPlatform = "Twitch" | "YouTube";

const TWITCH_LOGIN = /^[a-z0-9_]{1,25}$/i;
const TWITCH_VIDEO_ID = /^[0-9]{1,15}$/;
const TWITCH_CLIP_SLUG = /^[A-Za-z0-9_-]{1,100}$/;
const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const YOUTUBE_HANDLE = /^[a-z0-9._-]{3,30}$/i;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** First path segments on twitch.tv that are pages, not channels. */
const TWITCH_RESERVED = new Set([
  "clip",
  "collections",
  "directory",
  "downloads",
  "drops",
  "embed",
  "friends",
  "inventory",
  "jobs",
  "login",
  "messages",
  "moderator",
  "p",
  "popout",
  "prime",
  "search",
  "settings",
  "signup",
  "store",
  "subscriptions",
  "turbo",
  "videos",
  "wallet",
]);

/** Longest start offsets the stored forms allow (99 h for Twitch, 6 digits of seconds for YouTube). */
const TWITCH_MAX_START = 99 * 3600 + 59 * 60 + 59;
const YOUTUBE_MAX_START = 999_999;

/** Everything a pasted link can be, before the stream or replay rules apply. */
type Classified =
  | { kind: "twitch_channel"; login: string }
  | { kind: "twitch_video"; videoId: string; startSeconds: number | null }
  | { kind: "twitch_clip"; slug: string }
  | { kind: "youtube_channel"; channelId: string }
  | { kind: "youtube_handle"; handle: string }
  | { kind: "youtube_video"; videoId: string; startSeconds: number | null }
  /** youtube.com/c/... and /user/...: the API cannot look these up by name. */
  | { kind: "youtube_legacy" }
  /** An @handle with characters the stored form does not allow (letters outside a-z). */
  | { kind: "youtube_bad_handle" }
  | { kind: "unknown" };

const TWITCH_HOSTS = new Set(["twitch.tv", "go.twitch.tv", "clips.twitch.tv", "player.twitch.tv"]);
const YOUTUBE_HOSTS = new Set(["youtube.com", "youtu.be", "youtube-nocookie.com", "music.youtube.com"]);

/** "90", "90s", "1m30s", "1h2m3s", "02h03m04s" as seconds; null for anything else or 0. */
export function parseStartTime(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (/^[0-9]{1,7}$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds > 0 ? seconds : null;
  }
  const match = /^(?:([0-9]{1,3})h)?(?:([0-9]{1,4})m)?(?:([0-9]{1,7})s)?$/.exec(trimmed);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const seconds =
    Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 ? seconds : null;
}

/** 3723 -> "1h2m3s", the form Twitch's own links and its player's `time` use. */
export function twitchTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h${minutes}m${seconds % 60}s`;
}

function toUrl(input: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function bareHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, "");
}

function segmentsOf(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

function classifyTwitch(url: URL, host: string): Classified {
  const segments = segmentsOf(url);

  if (host === "clips.twitch.tv") {
    const slug = segments[0] === "embed" ? url.searchParams.get("clip") : segments[0];
    return slug && TWITCH_CLIP_SLUG.test(slug) ? { kind: "twitch_clip", slug } : { kind: "unknown" };
  }

  if (host === "player.twitch.tv") {
    const channel = url.searchParams.get("channel");
    if (channel && TWITCH_LOGIN.test(channel)) {
      return { kind: "twitch_channel", login: channel.toLowerCase() };
    }
    const video = url.searchParams.get("video")?.replace(/^v/i, "");
    return video && TWITCH_VIDEO_ID.test(video)
      ? { kind: "twitch_video", videoId: video, startSeconds: parseStartTime(url.searchParams.get("time")) }
      : { kind: "unknown" };
  }

  const [first, second, third] = segments;
  if (!first) return { kind: "unknown" };

  if (first.toLowerCase() === "videos") {
    return second && TWITCH_VIDEO_ID.test(second)
      ? { kind: "twitch_video", videoId: second, startSeconds: parseStartTime(url.searchParams.get("t")) }
      : { kind: "unknown" };
  }
  if (TWITCH_RESERVED.has(first.toLowerCase()) || !TWITCH_LOGIN.test(first)) {
    return { kind: "unknown" };
  }
  if (second?.toLowerCase() === "clip") {
    return third && TWITCH_CLIP_SLUG.test(third) ? { kind: "twitch_clip", slug: third } : { kind: "unknown" };
  }
  if (second?.toLowerCase() === "v" || second?.toLowerCase() === "video") {
    return third && TWITCH_VIDEO_ID.test(third)
      ? { kind: "twitch_video", videoId: third, startSeconds: parseStartTime(url.searchParams.get("t")) }
      : { kind: "unknown" };
  }
  return { kind: "twitch_channel", login: first.toLowerCase() };
}

function classifyYouTube(url: URL, host: string): Classified {
  const segments = segmentsOf(url);
  const start = () =>
    parseStartTime(url.searchParams.get("t") ?? url.searchParams.get("start"));
  const video = (id: string | null | undefined): Classified =>
    id && YOUTUBE_VIDEO_ID.test(id) ? { kind: "youtube_video", videoId: id, startSeconds: start() } : { kind: "unknown" };

  if (host === "youtu.be") return video(segments[0]);

  const [first, second] = segments;
  if (!first) return { kind: "unknown" };
  const section = first.toLowerCase();

  if (section === "watch") return video(url.searchParams.get("v"));
  if (section === "embed" && second === "live_stream") {
    const channel = url.searchParams.get("channel");
    return channel && YOUTUBE_CHANNEL_ID.test(channel)
      ? { kind: "youtube_channel", channelId: channel }
      : { kind: "unknown" };
  }
  if (section === "live" || section === "embed" || section === "shorts" || section === "v") {
    return video(second);
  }
  if (section === "channel") {
    return second && YOUTUBE_CHANNEL_ID.test(second)
      ? { kind: "youtube_channel", channelId: second }
      : { kind: "unknown" };
  }
  if (first.startsWith("@")) {
    const handle = first.slice(1);
    return YOUTUBE_HANDLE.test(handle)
      ? { kind: "youtube_handle", handle: handle.toLowerCase() }
      : { kind: "youtube_bad_handle" };
  }
  if (section === "c" || section === "user") return { kind: "youtube_legacy" };
  return { kind: "unknown" };
}

function classify(input: string): Classified | null {
  const url = toUrl(input);
  if (!url) return null;
  const host = bareHost(url);
  if (TWITCH_HOSTS.has(host)) return classifyTwitch(url, host);
  if (YOUTUBE_HOSTS.has(host)) return classifyYouTube(url, host);
  return { kind: "unknown" };
}

const STREAM_HELP =
  "Use a Twitch channel link (twitch.tv/name), or a YouTube channel (youtube.com/@name) or live video link.";
const REPLAY_HELP =
  "Use a Twitch video or clip link, or a YouTube video link.";

/**
 * The stream a league attaches: a Twitch channel, or a YouTube channel
 * (@handle or channel ID) or one live video. Blank input is not a link; the
 * caller decides whether blank means "no stream".
 */
export function parseStreamLink(input: string): LinkResult<StreamLink> {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Paste the stream's link." };
  const found = classify(trimmed);
  if (!found || found.kind === "unknown") return { ok: false, error: STREAM_HELP };

  switch (found.kind) {
    case "twitch_channel":
      return {
        ok: true,
        link: { kind: "twitch_channel", url: `https://www.twitch.tv/${found.login}`, login: found.login },
      };
    case "youtube_channel":
      return {
        ok: true,
        link: {
          kind: "youtube_channel",
          url: `https://www.youtube.com/channel/${found.channelId}`,
          channelId: found.channelId,
        },
      };
    case "youtube_handle":
      return {
        ok: true,
        link: { kind: "youtube_handle", url: `https://www.youtube.com/@${found.handle}`, handle: found.handle },
      };
    case "youtube_video":
      return {
        ok: true,
        link: { kind: "youtube_video", url: `https://www.youtube.com/watch?v=${found.videoId}`, videoId: found.videoId },
      };
    case "twitch_video":
    case "twitch_clip":
      return {
        ok: false,
        error: "That is a Twitch video. Use the channel's link for the stream and add videos under Replays.",
      };
    case "youtube_legacy":
      return {
        ok: false,
        error: "Use the channel's @handle link or its youtube.com/channel/ link.",
      };
    case "youtube_bad_handle":
      return {
        ok: false,
        error:
          "That @handle has letters a link here cannot hold. Use the channel's youtube.com/channel/ link (YouTube Studio, Settings, Channel, Advanced settings).",
      };
  }
}

/** A replay: a Twitch video (past broadcast or highlight) or clip, or a YouTube video. */
export function parseReplayLink(input: string): LinkResult<ReplayLink> {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Paste the replay's link." };
  const found = classify(trimmed);
  if (!found || found.kind === "unknown") return { ok: false, error: REPLAY_HELP };

  switch (found.kind) {
    case "twitch_video": {
      const start =
        found.startSeconds !== null && found.startSeconds <= TWITCH_MAX_START ? found.startSeconds : null;
      return {
        ok: true,
        link: {
          kind: "twitch_video",
          url: `https://www.twitch.tv/videos/${found.videoId}${start ? `?t=${twitchTime(start)}` : ""}`,
          videoId: found.videoId,
          startSeconds: start,
        },
      };
    }
    case "twitch_clip":
      return {
        ok: true,
        link: { kind: "twitch_clip", url: `https://clips.twitch.tv/${found.slug}`, slug: found.slug },
      };
    case "youtube_video": {
      const start =
        found.startSeconds !== null && found.startSeconds <= YOUTUBE_MAX_START ? found.startSeconds : null;
      return {
        ok: true,
        link: {
          kind: "youtube_video",
          url: `https://www.youtube.com/watch?v=${found.videoId}${start ? `&t=${start}s` : ""}`,
          videoId: found.videoId,
          startSeconds: start,
        },
      };
    }
    case "twitch_channel":
    case "youtube_channel":
    case "youtube_handle":
    case "youtube_legacy":
    case "youtube_bad_handle":
      return {
        ok: false,
        error: "That is a channel link. A replay needs the link of one video or clip.",
      };
  }
}

/** A stored stream link, or null for none (or a value the parser no longer accepts). */
export function readStreamLink(stored: string | null | undefined): StreamLink | null {
  if (!stored) return null;
  const result = parseStreamLink(stored);
  return result.ok ? result.link : null;
}

/** A stored replay link, or null when it does not parse. */
export function readReplayLink(stored: string | null | undefined): ReplayLink | null {
  if (!stored) return null;
  const result = parseReplayLink(stored);
  return result.ok ? result.link : null;
}

/**
 * The replays of a stored `replay_links` value that still parse, in the
 * stored order. Anything that is not a { title, url } entry is skipped.
 */
export function readReplayEntries(value: unknown): Array<ReplayEntry & { link: ReplayLink }> {
  if (!Array.isArray(value)) return [];
  const entries: Array<ReplayEntry & { link: ReplayLink }> = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { title, url, added_at } = item as Record<string, unknown>;
    if (typeof title !== "string" || typeof url !== "string") continue;
    const link = readReplayLink(url);
    if (!link) continue;
    entries.push({
      title,
      url: link.url,
      added_at: typeof added_at === "string" ? added_at : undefined,
      link,
    });
  }
  return entries;
}

export function platformOf(link: StreamLink | ReplayLink): StreamPlatform {
  return link.kind.startsWith("twitch") ? "Twitch" : "YouTube";
}

/** "twitch.tv/name", "youtube.com/@name", "YouTube channel", "YouTube video": what a link points at. */
export function streamLabel(link: StreamLink): string {
  switch (link.kind) {
    case "twitch_channel":
      return `twitch.tv/${link.login}`;
    case "youtube_handle":
      return `youtube.com/@${link.handle}`;
    case "youtube_channel":
      return "YouTube channel";
    case "youtube_video":
      return "YouTube live video";
  }
}

export type EmbedOptions = {
  /** The page's hostname: Twitch only plays inside the domains named in `parent`. */
  host: string;
  /** Start playing at once (muted, which browsers require for autoplay). */
  autoplay?: boolean;
};

/**
 * The player for a stream, or null when it cannot be embedded: a YouTube
 * @handle needs its channel ID, which only the YouTube API knows
 * (`channelId`, from the live check). A YouTube channel that is live plays
 * its live video (`liveVideoId`) when the check found it, else YouTube's own
 * "current live stream" player.
 */
export function streamEmbedUrl(
  link: StreamLink,
  options: EmbedOptions & { liveVideoId?: string | null; channelId?: string | null }
): string | null {
  const autoplay = options.autoplay ?? false;
  switch (link.kind) {
    case "twitch_channel": {
      const params = new URLSearchParams({
        channel: link.login,
        parent: options.host,
        autoplay: String(autoplay),
        muted: String(autoplay),
      });
      return `https://player.twitch.tv/?${params}`;
    }
    case "youtube_video":
      return youTubeVideoEmbed(link.videoId, null, autoplay);
    case "youtube_channel":
    case "youtube_handle": {
      if (options.liveVideoId && YOUTUBE_VIDEO_ID.test(options.liveVideoId)) {
        return youTubeVideoEmbed(options.liveVideoId, null, autoplay);
      }
      const channelId = link.kind === "youtube_channel" ? link.channelId : options.channelId;
      if (!channelId || !YOUTUBE_CHANNEL_ID.test(channelId)) return null;
      const params = new URLSearchParams({ channel: channelId });
      if (autoplay) {
        params.set("autoplay", "1");
        params.set("mute", "1");
      }
      return `https://www.youtube.com/embed/live_stream?${params}`;
    }
  }
}

function youTubeVideoEmbed(videoId: string, start: number | null, autoplay: boolean): string {
  const params = new URLSearchParams({ rel: "0", playsinline: "1" });
  if (start) params.set("start", String(start));
  if (autoplay) {
    params.set("autoplay", "1");
    params.set("mute", "1");
  }
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params}`;
}

/** The player for a replay. Never autoplays: a page can list several. */
export function replayEmbedUrl(link: ReplayLink, options: EmbedOptions): string {
  switch (link.kind) {
    case "twitch_video": {
      const params = new URLSearchParams({
        video: `v${link.videoId}`,
        parent: options.host,
        autoplay: String(options.autoplay ?? false),
      });
      if (link.startSeconds) params.set("time", twitchTime(link.startSeconds));
      return `https://player.twitch.tv/?${params}`;
    }
    case "twitch_clip": {
      const params = new URLSearchParams({
        clip: link.slug,
        parent: options.host,
        autoplay: String(options.autoplay ?? false),
      });
      return `https://clips.twitch.tv/embed?${params}`;
    }
    case "youtube_video":
      return youTubeVideoEmbed(link.videoId, link.startSeconds, options.autoplay ?? false);
  }
}
