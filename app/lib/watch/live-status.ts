import "server-only";
import { NOT_LIVE, type StreamStatus } from "@/app/lib/watch/watch-view";
import { readStreamLink, type StreamLink } from "@/app/lib/watch/stream-links";

/**
 * Whether a public league's stream is on air (docs/release-architecture.md
 * section 15.4), asked of the platforms on the server, since both need keys
 * that never reach the browser:
 *
 * - Twitch: an app access token (client credentials, TWITCH_CLIENT_ID and
 *   TWITCH_CLIENT_SECRET) and Helix `streams`, up to 100 channels a call.
 * - YouTube: an API key (YOUTUBE_API_KEY). An @handle becomes its channel ID
 *   through `channels?forHandle` (cached a day); a channel's newest uploads
 *   come from its uploads playlist, which lists a broadcast while it is live,
 *   and `videos` says which of those (and of the attached live videos) is
 *   live, 50 a call. Both list calls cost one quota unit, where `search`
 *   would cost a hundred.
 *
 * Answers are cached through Next's fetch cache (`next.revalidate`), so a
 * busy Watch page asks each platform at most once a minute (YouTube every
 * two, to stay inside its daily quota). Without the keys, on any error and
 * after a three-second timeout, a stream counts as not live: the league then
 * shows as live only while its draft runs.
 */

export type LiveCheckEnv = {
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  YOUTUBE_API_KEY?: string;
};

export type LiveCheckOptions = {
  env?: LiveCheckEnv;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_STREAMS_URL = "https://api.twitch.tv/helix/streams";
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

export const TWITCH_REVALIDATE_SECONDS = 60;
export const YOUTUBE_REVALIDATE_SECONDS = 120;
const HANDLE_REVALIDATE_SECONDS = 86_400;
const TIMEOUT_MS = 3000;
/** Uploads read per YouTube channel: a live broadcast is among the newest. */
const UPLOADS_PER_CHANNEL = 5;

type Context = { fetch: typeof fetch; timeoutMs: number };

type TwitchToken = { clientId: string; value: string; expiresAt: number };
let twitchToken: TwitchToken | null = null;

/** Forgets the cached Twitch token (tests, and a 401 from Helix). */
export function resetTwitchToken() {
  twitchToken = null;
}

async function getJson(context: Context, url: string, init: RequestInit & { next?: { revalidate: number } }) {
  const response = await context.fetch(url, { ...init, signal: AbortSignal.timeout(context.timeoutMs) });
  if (!response.ok) return { status: response.status, body: null as unknown };
  return { status: response.status, body: (await response.json()) as unknown };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function items(value: unknown, key = "items"): Record<string, unknown>[] {
  const list = record(value)[key];
  return Array.isArray(list) ? list.map(record) : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function count(value: unknown): number | null {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : null;
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

async function twitchAppToken(context: Context, clientId: string, secret: string): Promise<string | null> {
  if (twitchToken && twitchToken.clientId === clientId && twitchToken.expiresAt > Date.now() + 60_000) {
    return twitchToken.value;
  }
  const { body } = await getJson(context, TWITCH_TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: "client_credentials" }),
    cache: "no-store",
  });
  const value = text(record(body).access_token);
  const expiresIn = count(record(body).expires_in);
  if (!value) return null;
  twitchToken = { clientId, value, expiresAt: Date.now() + (expiresIn ?? 3600) * 1000 };
  return value;
}

/** Twitch's answer for each login it was asked about; logins it could not be asked about are missing. */
async function twitchLive(context: Context, env: LiveCheckEnv, logins: string[]): Promise<Map<string, StreamStatus>> {
  const statuses = new Map<string, StreamStatus>();
  const clientId = env.TWITCH_CLIENT_ID;
  const secret = env.TWITCH_CLIENT_SECRET;
  if (!clientId || !secret || logins.length === 0) return statuses;

  for (const batch of chunks(logins, 100)) {
    const params = new URLSearchParams({ first: "100" });
    for (const login of batch) params.append("user_login", login);
    let answer = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await twitchAppToken(context, clientId, secret);
      if (!token) return statuses;
      answer = await getJson(context, `${TWITCH_STREAMS_URL}?${params}`, {
        headers: { "Client-Id": clientId, Authorization: `Bearer ${token}` },
        next: { revalidate: TWITCH_REVALIDATE_SECONDS },
      });
      if (answer.status !== 401) break;
      resetTwitchToken();
    }
    if (!answer || answer.body === null) continue;
    for (const login of batch) statuses.set(login, { ...NOT_LIVE, checked: true });
    for (const stream of items(answer.body, "data")) {
      const login = text(stream.user_login)?.toLowerCase();
      if (!login || stream.type !== "live" || !statuses.has(login)) continue;
      statuses.set(login, {
        checked: true,
        live: true,
        title: text(stream.title),
        viewers: count(stream.viewer_count),
        startedAt: text(stream.started_at),
        liveVideoId: null,
        channelId: null,
      });
    }
  }
  return statuses;
}

async function youTubeChannelForHandle(context: Context, key: string, handle: string): Promise<string | null> {
  const params = new URLSearchParams({ part: "id", forHandle: `@${handle}`, key });
  const { body } = await getJson(context, `${YOUTUBE_API}/channels?${params}`, {
    next: { revalidate: HANDLE_REVALIDATE_SECONDS },
  });
  const id = text(items(body)[0]?.id);
  return id && /^UC[A-Za-z0-9_-]{22}$/.test(id) ? id : null;
}

/** The channel's newest upload IDs, or null when YouTube did not answer. */
async function youTubeRecentUploads(context: Context, key: string, channelId: string): Promise<string[] | null> {
  const params = new URLSearchParams({
    part: "contentDetails",
    playlistId: `UU${channelId.slice(2)}`,
    maxResults: String(UPLOADS_PER_CHANNEL),
    key,
  });
  const { body } = await getJson(context, `${YOUTUBE_API}/playlistItems?${params}`, {
    next: { revalidate: YOUTUBE_REVALIDATE_SECONDS },
  });
  if (body === null) return null;
  return items(body)
    .map((item) => text(record(item.contentDetails).videoId))
    .filter((id): id is string => id !== null);
}

/** Each video's status by ID, for the batches YouTube answered; `answered` lists every ID it was asked about then. */
async function youTubeVideos(
  context: Context,
  key: string,
  ids: string[]
): Promise<{ videos: Map<string, StreamStatus>; answered: Set<string> }> {
  const videos = new Map<string, StreamStatus>();
  const answered = new Set<string>();
  for (const batch of chunks([...new Set(ids)].sort(), 50)) {
    const params = new URLSearchParams({ part: "snippet,liveStreamingDetails", id: batch.join(","), key });
    const { body } = await getJson(context, `${YOUTUBE_API}/videos?${params}`, {
      next: { revalidate: YOUTUBE_REVALIDATE_SECONDS },
    });
    if (body === null) continue;
    for (const id of batch) answered.add(id);
    for (const item of items(body)) {
      const id = text(item.id);
      if (!id) continue;
      const snippet = record(item.snippet);
      const details = record(item.liveStreamingDetails);
      const live = snippet.liveBroadcastContent === "live";
      videos.set(id, {
        checked: true,
        live,
        title: text(snippet.title),
        viewers: live ? count(details.concurrentViewers) : null,
        startedAt: text(details.actualStartTime),
        liveVideoId: live ? id : null,
        channelId: text(snippet.channelId),
      });
    }
  }
  return { videos, answered };
}

/** Statuses for YouTube links, keyed by stored URL. */
async function youTubeLive(
  context: Context,
  env: LiveCheckEnv,
  links: StreamLink[]
): Promise<Map<string, StreamStatus>> {
  const statuses = new Map<string, StreamStatus>();
  const key = env.YOUTUBE_API_KEY;
  if (!key || links.length === 0) return statuses;

  const channelOf = new Map<string, string>();
  await Promise.all(
    links.map(async (link) => {
      if (link.kind === "youtube_channel") channelOf.set(link.url, link.channelId);
      if (link.kind === "youtube_handle") {
        const id = await youTubeChannelForHandle(context, key, link.handle).catch(() => null);
        if (id) channelOf.set(link.url, id);
      }
    })
  );

  const uploadsOf = new Map<string, string[] | null>();
  await Promise.all(
    [...new Set(channelOf.values())].map(async (channelId) => {
      uploadsOf.set(channelId, await youTubeRecentUploads(context, key, channelId).catch(() => null));
    })
  );

  const wanted = [
    ...[...uploadsOf.values()].flatMap((ids) => ids ?? []),
    ...links.flatMap((link) => (link.kind === "youtube_video" ? [link.videoId] : [])),
  ];
  const { videos, answered } =
    wanted.length > 0
      ? await youTubeVideos(context, key, wanted)
      : { videos: new Map<string, StreamStatus>(), answered: new Set<string>() };

  for (const link of links) {
    if (link.kind === "youtube_video") {
      if (answered.has(link.videoId)) {
        statuses.set(link.url, videos.get(link.videoId) ?? { ...NOT_LIVE, checked: true });
      }
      continue;
    }
    const channelId = channelOf.get(link.url) ?? null;
    const uploads = channelId ? uploadsOf.get(channelId) : null;
    if (!channelId || !uploads || !uploads.every((id) => answered.has(id))) {
      if (channelId) statuses.set(link.url, { ...NOT_LIVE, channelId });
      continue;
    }
    const live = uploads.map((id) => videos.get(id)).find((status) => status?.live);
    statuses.set(link.url, live ? { ...live, channelId } : { ...NOT_LIVE, checked: true, channelId });
  }
  return statuses;
}

/**
 * The status of every stored stream link (null and unknown links are
 * skipped), keyed by the link. A link the platforms were not asked about, or
 * did not answer for, is NOT_LIVE.
 */
export async function streamStatuses(
  urls: ReadonlyArray<string | null | undefined>,
  options: LiveCheckOptions = {}
): Promise<Map<string, StreamStatus>> {
  const env: LiveCheckEnv = options.env ?? {
    TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  };
  const context: Context = { fetch: options.fetch ?? fetch, timeoutMs: options.timeoutMs ?? TIMEOUT_MS };

  const links = new Map<string, StreamLink>();
  for (const url of urls) {
    const link = readStreamLink(url);
    if (link) links.set(link.url, link);
  }
  const all = [...links.values()];
  const twitchLogins = all.flatMap((link) => (link.kind === "twitch_channel" ? [link.login] : []));
  const youTubeLinks = all.filter((link) => link.kind !== "twitch_channel");

  const [twitch, youTube] = await Promise.all([
    twitchLive(context, env, [...new Set(twitchLogins)].sort()).catch(() => new Map<string, StreamStatus>()),
    youTubeLive(context, env, youTubeLinks).catch(() => new Map<string, StreamStatus>()),
  ]);

  const statuses = new Map<string, StreamStatus>();
  for (const link of all) {
    statuses.set(
      link.url,
      link.kind === "twitch_channel" ? (twitch.get(link.login) ?? NOT_LIVE) : (youTube.get(link.url) ?? NOT_LIVE)
    );
  }
  return statuses;
}
