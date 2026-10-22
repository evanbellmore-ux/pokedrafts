import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTwitchToken, streamStatuses } from "@/app/lib/watch/live-status";
import { NOT_LIVE } from "@/app/lib/watch/watch-view";

/**
 * The server's live check (app/lib/watch/live-status.ts) against stand-ins
 * for Twitch and YouTube: which calls it makes, what it reads from the
 * answers, and that a missing key, an error or a refused token means "not
 * live" rather than a failed page.
 */

type Call = { url: string; init?: RequestInit & { next?: { revalidate: number } } };

const TWITCH_ENV = { TWITCH_CLIENT_ID: "client", TWITCH_CLIENT_SECRET: "secret" };
const YOUTUBE_ENV = { YOUTUBE_API_KEY: "key" };
const CHANNEL = "UC1234567890abcdefghijAB";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch that answers by URL prefix and records every call. */
function fakeFetch(routes: Array<[string, (call: Call) => Response]>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init as Call["init"] });
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    return route ? route[1]({ url, init: init as Call["init"] }) : json({ error: "no route" }, 404);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

beforeEach(() => {
  resetTwitchToken();
});

describe("live check: Twitch", () => {
  it("asks Helix about every channel in one call with an app token, and reads who is live", async () => {
    const { fetch, calls } = fakeFetch([
      ["https://id.twitch.tv/oauth2/token", () => json({ access_token: "token-1", expires_in: 5000, token_type: "bearer" })],
      [
        "https://api.twitch.tv/helix/streams",
        () =>
          json({
            data: [
              { user_login: "PokeDrafts", type: "live", title: "Draft night!", viewer_count: 1234, started_at: "2026-10-22T18:00:00Z" },
            ],
          }),
      ],
    ]);
    const statuses = await streamStatuses(
      ["https://www.twitch.tv/pokedrafts", "https://www.twitch.tv/quiet", "https://www.twitch.tv/pokedrafts", null],
      { env: TWITCH_ENV, fetch },
    );

    expect(statuses.get("https://www.twitch.tv/pokedrafts")).toEqual({
      checked: true,
      live: true,
      title: "Draft night!",
      viewers: 1234,
      startedAt: "2026-10-22T18:00:00Z",
      liveVideoId: null,
      channelId: null,
    });
    expect(statuses.get("https://www.twitch.tv/quiet")).toEqual({ ...NOT_LIVE, checked: true });

    expect(calls.map((call) => call.url.split("?")[0])).toEqual([
      "https://id.twitch.tv/oauth2/token",
      "https://api.twitch.tv/helix/streams",
    ]);
    const token = calls[0];
    expect(token.init?.method).toBe("POST");
    expect(String(token.init?.body)).toBe("client_id=client&client_secret=secret&grant_type=client_credentials");
    const helix = calls[1];
    expect(new URL(helix.url).searchParams.getAll("user_login")).toEqual(["pokedrafts", "quiet"]);
    expect(helix.init?.headers).toEqual({ "Client-Id": "client", Authorization: "Bearer token-1" });
    expect(helix.init?.next).toEqual({ revalidate: 60 });
  });

  it("keeps the token between checks and gets a new one when Helix refuses it", async () => {
    let tokens = 0;
    let helixCalls = 0;
    const { fetch, calls } = fakeFetch([
      ["https://id.twitch.tv/oauth2/token", () => json({ access_token: `token-${++tokens}`, expires_in: 5000 })],
      [
        "https://api.twitch.tv/helix/streams",
        () => (++helixCalls === 2 ? json({ message: "Invalid OAuth token" }, 401) : json({ data: [] })),
      ],
    ]);
    const urls = ["https://www.twitch.tv/pokedrafts"];
    await streamStatuses(urls, { env: TWITCH_ENV, fetch });
    const second = await streamStatuses(urls, { env: TWITCH_ENV, fetch });

    expect(tokens).toBe(2);
    expect(calls.filter((call) => call.url.startsWith("https://api.twitch.tv")).map((call) => (call.init?.headers as Record<string, string>).Authorization)).toEqual([
      "Bearer token-1",
      "Bearer token-1",
      "Bearer token-2",
    ]);
    expect(second.get(urls[0])).toEqual({ ...NOT_LIVE, checked: true });
  });

  it("says nothing without the keys, and counts an error or a refused token as not checked", async () => {
    const unused = fakeFetch([]);
    const without = await streamStatuses(["https://www.twitch.tv/pokedrafts"], { env: {}, fetch: unused.fetch });
    expect(without.get("https://www.twitch.tv/pokedrafts")).toEqual(NOT_LIVE);
    expect(unused.calls).toEqual([]);

    const refused = fakeFetch([["https://id.twitch.tv/oauth2/token", () => json({ message: "invalid client" }, 403)]]);
    const noToken = await streamStatuses(["https://www.twitch.tv/pokedrafts"], { env: TWITCH_ENV, fetch: refused.fetch });
    expect(noToken.get("https://www.twitch.tv/pokedrafts")).toEqual(NOT_LIVE);

    const failing = {
      fetch: vi.fn(async () => {
        throw new TypeError("network down");
      }) as unknown as typeof globalThis.fetch,
    };
    const down = await streamStatuses(["https://www.twitch.tv/pokedrafts"], { env: TWITCH_ENV, fetch: failing.fetch });
    expect(down.get("https://www.twitch.tv/pokedrafts")).toEqual(NOT_LIVE);
  });
});

describe("live check: YouTube", () => {
  it("finds a channel's live broadcast among its newest uploads, by channel ID and by @handle", async () => {
    const { fetch, calls } = fakeFetch([
      [
        "https://www.googleapis.com/youtube/v3/channels",
        () => json({ items: [{ id: "UCabcdefghijklmnopqrstuv" }] }),
      ],
      [
        "https://www.googleapis.com/youtube/v3/playlistItems",
        (call) => {
          const playlist = new URL(call.url).searchParams.get("playlistId");
          return json({
            items:
              playlist === `UU${CHANNEL.slice(2)}`
                ? [{ contentDetails: { videoId: "liveVideo01" } }, { contentDetails: { videoId: "oldVideo001" } }]
                : [{ contentDetails: { videoId: "oldVideo002" } }],
          });
        },
      ],
      [
        "https://www.googleapis.com/youtube/v3/videos",
        () =>
          json({
            items: [
              {
                id: "liveVideo01",
                snippet: { title: "Week 3", liveBroadcastContent: "live", channelId: CHANNEL },
                liveStreamingDetails: { concurrentViewers: "321", actualStartTime: "2026-10-22T19:00:00Z" },
              },
              { id: "oldVideo001", snippet: { title: "Week 2", liveBroadcastContent: "none", channelId: CHANNEL } },
              { id: "oldVideo002", snippet: { title: "Old", liveBroadcastContent: "none", channelId: "UCabcdefghijklmnopqrstuv" } },
              { id: "upcomingVid", snippet: { title: "Soon", liveBroadcastContent: "upcoming", channelId: CHANNEL } },
            ],
          }),
      ],
    ]);
    const statuses = await streamStatuses(
      [
        `https://www.youtube.com/channel/${CHANNEL}`,
        "https://www.youtube.com/@pokedrafts",
        "https://www.youtube.com/watch?v=upcomingVid",
      ],
      { env: YOUTUBE_ENV, fetch },
    );

    expect(statuses.get(`https://www.youtube.com/channel/${CHANNEL}`)).toEqual({
      checked: true,
      live: true,
      title: "Week 3",
      viewers: 321,
      startedAt: "2026-10-22T19:00:00Z",
      liveVideoId: "liveVideo01",
      channelId: CHANNEL,
    });
    expect(statuses.get("https://www.youtube.com/@pokedrafts")).toEqual({
      ...NOT_LIVE,
      checked: true,
      channelId: "UCabcdefghijklmnopqrstuv",
    });
    expect(statuses.get("https://www.youtube.com/watch?v=upcomingVid")).toMatchObject({ checked: true, live: false, title: "Soon" });

    const handleCall = calls.find((call) => call.url.includes("/channels?"));
    expect(new URL(String(handleCall?.url)).searchParams.get("forHandle")).toBe("@pokedrafts");
    expect(handleCall?.init?.next).toEqual({ revalidate: 86_400 });
    const videoCalls = calls.filter((call) => call.url.includes("/videos?"));
    expect(videoCalls).toHaveLength(1);
    expect(new URL(videoCalls[0].url).searchParams.get("id")).toBe("liveVideo01,oldVideo001,oldVideo002,upcomingVid");
    expect(videoCalls[0].init?.next).toEqual({ revalidate: 120 });
    // One unit per playlist and one per 50 videos: never the 100-unit search.
    expect(calls.some((call) => call.url.includes("/search"))).toBe(false);
  });

  it("leaves a stream unchecked when YouTube does not answer, and asks nothing without a key", async () => {
    const down = fakeFetch([["https://www.googleapis.com/youtube/v3/", () => json({ error: { code: 403 } }, 403)]]);
    const statuses = await streamStatuses(
      [`https://www.youtube.com/channel/${CHANNEL}`, "https://www.youtube.com/@pokedrafts"],
      { env: YOUTUBE_ENV, fetch: down.fetch },
    );
    expect(statuses.get(`https://www.youtube.com/channel/${CHANNEL}`)).toEqual({ ...NOT_LIVE, channelId: CHANNEL });
    expect(statuses.get("https://www.youtube.com/@pokedrafts")).toEqual(NOT_LIVE);

    const unused = fakeFetch([]);
    const noKey = await streamStatuses([`https://www.youtube.com/channel/${CHANNEL}`], { env: {}, fetch: unused.fetch });
    expect(noKey.get(`https://www.youtube.com/channel/${CHANNEL}`)).toEqual(NOT_LIVE);
    expect(unused.calls).toEqual([]);
  });
});
