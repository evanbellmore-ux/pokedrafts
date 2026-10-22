import { describe, expect, it } from "vitest";
import {
  parseReplayLink,
  parseStartTime,
  parseStreamLink,
  readReplayEntries,
  readStreamLink,
  replayEmbedUrl,
  streamEmbedUrl,
  streamLabel,
  twitchTime,
} from "@/app/lib/watch/stream-links";

/**
 * The links a commissioner pastes into the Public page card
 * (app/lib/watch/stream-links.ts): what each one is stored as, which ones are
 * refused and why, and the player each stored link becomes. The database
 * side of the same forms is tests/db/public-leagues.test.ts.
 */

function stream(input: string) {
  const result = parseStreamLink(input);
  return result.ok ? result.link : result.error;
}

function replay(input: string) {
  const result = parseReplayLink(input);
  return result.ok ? result.link : result.error;
}

describe("stream links", () => {
  it.each([
    ["https://www.twitch.tv/PokeDrafts", "https://www.twitch.tv/pokedrafts"],
    ["twitch.tv/pokedrafts", "https://www.twitch.tv/pokedrafts"],
    ["http://m.twitch.tv/pokedrafts/", "https://www.twitch.tv/pokedrafts"],
    ["https://www.twitch.tv/pokedrafts/videos?filter=archives", "https://www.twitch.tv/pokedrafts"],
    ["https://www.twitch.tv/pokedrafts?referrer=raid", "https://www.twitch.tv/pokedrafts"],
    ["https://player.twitch.tv/?channel=Some_Streamer&parent=example.com", "https://www.twitch.tv/some_streamer"],
    ["https://www.youtube.com/@PokeDrafts", "https://www.youtube.com/@pokedrafts"],
    ["youtube.com/@poke.drafts-live/streams", "https://www.youtube.com/@poke.drafts-live"],
    ["https://m.youtube.com/@pokedrafts/live", "https://www.youtube.com/@pokedrafts"],
    ["https://www.youtube.com/channel/UC1234567890abcdefghijAB", "https://www.youtube.com/channel/UC1234567890abcdefghijAB"],
    ["https://www.youtube.com/channel/UC1234567890abcdefghijAB/live", "https://www.youtube.com/channel/UC1234567890abcdefghijAB"],
    ["https://www.youtube.com/embed/live_stream?channel=UC1234567890abcdefghijAB", "https://www.youtube.com/channel/UC1234567890abcdefghijAB"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=share", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ?feature=share", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  ])("%s is stored as %s", (input, url) => {
    const link = stream(input);
    expect(typeof link === "string" ? link : link.url).toBe(url);
  });

  it("names what it points at", () => {
    const labels = [
      "https://www.twitch.tv/pokedrafts",
      "https://www.youtube.com/@pokedrafts",
      "https://www.youtube.com/channel/UC1234567890abcdefghijAB",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ].map((url) => {
      const link = readStreamLink(url);
      return link ? streamLabel(link) : null;
    });
    expect(labels).toEqual(["twitch.tv/pokedrafts", "youtube.com/@pokedrafts", "YouTube channel", "YouTube live video"]);
  });

  it("refuses everything else, saying what to paste instead", () => {
    expect(stream("")).toBe("Paste the stream's link.");
    for (const input of [
      "https://example.com/pokedrafts",
      "javascript:alert(1)",
      "ftp://twitch.tv/pokedrafts",
      "https://evil.twitch.tv.example.com/pokedrafts",
      "https://dashboard.twitch.tv/pokedrafts",
      "https://www.twitch.tv/directory/category/pokemon",
      "https://www.twitch.tv/",
      "pokedrafts",
      "https://www.youtube.com/",
      "https://www.youtube.com/channel/UCshort",
      `https://www.twitch.tv/${"a".repeat(26)}`,
    ]) {
      expect(stream(input), input).toMatch(/^Use a Twitch channel link/);
    }
    expect(stream("https://www.twitch.tv/videos/123456")).toMatch(/That is a Twitch video/);
    expect(stream("https://clips.twitch.tv/SomeClip")).toMatch(/That is a Twitch video/);
    expect(stream("https://www.youtube.com/c/PokeDrafts")).toMatch(/@handle link/);
    expect(stream("https://www.youtube.com/user/PokeDrafts")).toMatch(/@handle link/);
    expect(stream("https://www.youtube.com/@ポケモン")).toMatch(/youtube\.com\/channel\//);
    expect(stream("https://www.youtube.com/@ab")).toMatch(/youtube\.com\/channel\//);
  });

  it("re-reads a stored link to the same link", () => {
    for (const url of [
      "https://www.twitch.tv/pokedrafts",
      "https://www.youtube.com/@pokedrafts",
      "https://www.youtube.com/channel/UC1234567890abcdefghijAB",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ]) {
      expect(readStreamLink(url)?.url).toBe(url);
    }
    expect(readStreamLink(null)).toBeNull();
    expect(readStreamLink("https://example.com")).toBeNull();
  });
});

describe("replay links", () => {
  it.each([
    ["https://www.twitch.tv/videos/2345678901", "https://www.twitch.tv/videos/2345678901"],
    ["https://www.twitch.tv/videos/2345678901?t=01h02m03s", "https://www.twitch.tv/videos/2345678901?t=1h2m3s"],
    ["twitch.tv/videos/42?t=95", "https://www.twitch.tv/videos/42?t=0h1m35s"],
    ["https://www.twitch.tv/pokedrafts/v/42", "https://www.twitch.tv/videos/42"],
    ["https://player.twitch.tv/?video=v42&time=1m", "https://www.twitch.tv/videos/42?t=0h1m0s"],
    ["https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage-a1B2_c3", "https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage-a1B2_c3"],
    ["https://www.twitch.tv/pokedrafts/clip/FunnyClip?filter=clips", "https://clips.twitch.tv/FunnyClip"],
    ["https://clips.twitch.tv/embed?clip=FunnyClip&parent=example.com", "https://clips.twitch.tv/FunnyClip"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s&list=PL1", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=65s"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=7", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=7s"],
    ["https://www.youtube.com/shorts/abcdefghijk", "https://www.youtube.com/watch?v=abcdefghijk"],
    ["https://www.youtube.com/live/abcdefghijk", "https://www.youtube.com/watch?v=abcdefghijk"],
  ])("%s is stored as %s", (input, url) => {
    const link = replay(input);
    expect(typeof link === "string" ? link : link.url).toBe(url);
  });

  it("refuses channels and other sites", () => {
    expect(replay("")).toBe("Paste the replay's link.");
    expect(replay("https://www.twitch.tv/pokedrafts")).toMatch(/That is a channel link/);
    expect(replay("https://www.youtube.com/@pokedrafts")).toMatch(/That is a channel link/);
    expect(replay("https://vimeo.com/123")).toMatch(/^Use a Twitch video or clip link/);
    expect(replay("https://www.youtube.com/watch?v=short")).toMatch(/^Use a Twitch video or clip link/);
    expect(replay("https://www.twitch.tv/videos/notanumber")).toMatch(/^Use a Twitch video or clip link/);
  });

  it("reads the stored list, skipping entries that are not a titled replay", () => {
    expect(
      readReplayEntries([
        { title: "Draft night", url: "https://www.twitch.tv/videos/1", added_at: "2026-10-22T10:00:00Z" },
        { title: "No link" },
        { title: "Bad", url: "https://example.com" },
        "https://www.twitch.tv/videos/2",
        null,
        { title: "Week 1", url: "https://clips.twitch.tv/Clip" },
      ]).map((entry) => [entry.title, entry.url, entry.added_at ?? null]),
    ).toEqual([
      ["Draft night", "https://www.twitch.tv/videos/1", "2026-10-22T10:00:00Z"],
      ["Week 1", "https://clips.twitch.tv/Clip", null],
    ]);
    expect(readReplayEntries(undefined)).toEqual([]);
    expect(readReplayEntries({})).toEqual([]);
  });
});

describe("start times", () => {
  it.each([
    ["90", 90],
    ["90s", 90],
    ["1m30s", 90],
    ["1h2m3s", 3723],
    ["02h03m04s", 7384],
    ["0", null],
    ["", null],
    ["soon", null],
    [null, null],
  ])("%s is %s seconds", (value, seconds) => {
    expect(parseStartTime(value)).toBe(seconds);
  });

  it("writes Twitch's form", () => {
    expect(twitchTime(45)).toBe("0h0m45s");
    expect(twitchTime(3723)).toBe("1h2m3s");
  });
});

describe("players", () => {
  const options = { host: "www.pokedrafts.io" };

  it("plays a Twitch channel inside this site only, muted when it starts by itself", () => {
    const link = readStreamLink("https://www.twitch.tv/pokedrafts");
    if (!link) throw new Error("expected a link");
    expect(streamEmbedUrl(link, options)).toBe(
      "https://player.twitch.tv/?channel=pokedrafts&parent=www.pokedrafts.io&autoplay=false&muted=false",
    );
    expect(streamEmbedUrl(link, { host: "localhost", autoplay: true })).toBe(
      "https://player.twitch.tv/?channel=pokedrafts&parent=localhost&autoplay=true&muted=true",
    );
  });

  it("plays a YouTube channel's live stream, its found live video, or nothing for an unresolved @handle", () => {
    const channel = readStreamLink("https://www.youtube.com/channel/UC1234567890abcdefghijAB");
    const handle = readStreamLink("https://www.youtube.com/@pokedrafts");
    const video = readStreamLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    if (!channel || !handle || !video) throw new Error("expected links");
    expect(streamEmbedUrl(channel, options)).toBe(
      "https://www.youtube.com/embed/live_stream?channel=UC1234567890abcdefghijAB",
    );
    expect(streamEmbedUrl(channel, { ...options, liveVideoId: "abcdefghijk", autoplay: true })).toBe(
      "https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0&playsinline=1&autoplay=1&mute=1",
    );
    expect(streamEmbedUrl(handle, options)).toBeNull();
    expect(streamEmbedUrl(handle, { ...options, channelId: "UC1234567890abcdefghijAB" })).toBe(
      "https://www.youtube.com/embed/live_stream?channel=UC1234567890abcdefghijAB",
    );
    expect(streamEmbedUrl(video, options)).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1",
    );
  });

  it("plays replays from their start time, never by itself", () => {
    const urls = [
      "https://www.twitch.tv/videos/42?t=0h1m35s",
      "https://clips.twitch.tv/FunnyClip",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    ].map((url) => {
      const link = parseReplayLink(url);
      return link.ok ? replayEmbedUrl(link.link, options) : link.error;
    });
    expect(urls).toEqual([
      "https://player.twitch.tv/?video=v42&parent=www.pokedrafts.io&autoplay=false&time=0h1m35s",
      "https://clips.twitch.tv/embed?clip=FunnyClip&parent=www.pokedrafts.io&autoplay=false",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1&start=42",
    ]);
  });
});
