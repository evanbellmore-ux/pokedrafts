import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchPokePaste,
  parsePokePasteUrl,
  type PokePastePayload,
} from "@/app/(app)/calculator/pokepaste-data";

const ID = "0123456789abcdef";
const URL = `https://pokepast.es/${ID}`;
const JSON_URL = `${URL}/json`;
const RESPONSE_LIMIT = 128 * 1024;
const PASTE_LIMIT = 64 * 1024;
const encoder = new TextEncoder();
const payload = {
  paste: "Pikachu @ Light Ball\nAbility: Static\n- Thunderbolt\n",
  title: "Practice – café",
  author: "A trainer",
  notes: "Team notes",
};
const fetchMock = vi.fn<typeof fetch>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function streamedResponse(chunks: Uint8Array[], init?: ResponseInit) {
  let index = 0;
  const cancel = vi.fn();
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (index < chunks.length) controller.enqueue(chunks[index++]);
    else controller.close();
  });
  // No speculative pulls: cancellation tests can distinguish consuming a body
  // from rejecting its headers, and can leave the stream open after a bad chunk.
  const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
  return { response: new Response(stream, init), stream, cancel, pull };
}

function jsonResponse(data: unknown = payload, init?: ResponseInit) {
  return streamedResponse([encoder.encode(JSON.stringify(data))], init);
}

function pendingResponse(prefix = "") {
  const started = deferred<void>();
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (prefix) controller.enqueue(encoder.encode(prefix));
    },
    pull() {
      started.resolve(undefined);
    },
    cancel,
  }, { highWaterMark: 0 });
  return { response: new Response(stream), stream, cancel, started: started.promise };
}

function setResponseProperty(response: Response, key: string, value: unknown) {
  Object.defineProperty(response, key, { value });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("Unexpected mocked fetch"));
  // No test in this file can reach a real service, including failure paths.
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  const remainingTimers = vi.getTimerCount();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(remainingTimers).toBe(0);
});

describe("PokePaste URL allowlist", () => {
  it.each([
    URL, `${URL}/`, `${URL}/raw`, `${URL}/json`,
    `pokepast.es/${ID}`, `pokepast.es/${ID}/`,
    `pokepast.es/${ID}/raw`, `pokepast.es/${ID}/json`,
  ])("canonicalizes the approved form %s", (input) => {
    expect(parsePokePasteUrl(input)).toEqual({ url: URL, jsonUrl: JSON_URL });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["0", "1", "999", "1000", "0000000001", "9999999999", "0123456789012345"])(
    "accepts ID %s without imposing the service's decoded legacy ID checks",
    (id) => {
      expect(parsePokePasteUrl(`https://pokepast.es/${id}/raw`)).toEqual({
        url: `https://pokepast.es/${id}`, jsonUrl: `https://pokepast.es/${id}/json`,
      });
    },
  );

  it.each([
    "", "pokepast.es", "https://pokepast.es/", ID,
    `http://pokepast.es/${ID}`, `ftp://pokepast.es/${ID}`,
    `HTTPS://pokepast.es/${ID}`, `https://POKEPAST.ES/${ID}`,
    `//pokepast.es/${ID}`, `https:pokepast.es/${ID}`,
    `https:///pokepast.es/${ID}`, `https:////pokepast.es/${ID}`,
    `https://example.com/${ID}`, `https://www.pokepast.es/${ID}`,
    `https://pokepast.es.example.com/${ID}`, `https://pokepast.es./${ID}`,
    `https://127.0.0.1/${ID}`, `https://[::1]/${ID}`,
    `https://pokepаst.es/${ID}`, `https://pokepast。es/${ID}`,
    `https://%70okepast.es/${ID}`,
    `https://user@pokepast.es/${ID}`, `https://user:password@pokepast.es/${ID}`,
    `https://@pokepast.es/${ID}`, `https://pokepast.es@example.com/${ID}`,
    `https://pokepast.es:443/${ID}`, `https://pokepast.es:0443/${ID}`,
    `https://pokepast.es:80/${ID}`, `https://pokepast.es:0/${ID}`,
    `https://pokepast.es:65536/${ID}`, `https://pokepast.es:/${ID}`,
    `https://pokepast.es:443@example.com/${ID}`, `https://pokepast.es%3A443/${ID}`,
    `${URL}?`, `${URL}?download=1`, `${URL}#`, `${URL}#fragment`,
    `${URL}/raw?download=1`, `${URL}/json#fragment`,
    `${URL}//`, `${URL}/raw/`, `${URL}/json/`, `${URL}/other`, `${URL}/RAW`,
    `https://pokepast.es//${ID}`, `https://pokepast.es/other/${ID}`,
    `https://pokepast.es/./${ID}`, `https://pokepast.es/other/../${ID}`,
    `https://pokepast.es/%2e/${ID}`, `${URL}/../${ID}`, `${URL}%2Fjson`,
    `https://pokepast.es/%30123456789abcdef`,
    "https://pokepast.es/0123456789abcde", "https://pokepast.es/0123456789abcdef0",
    "https://pokepast.es/0123456789ABCDEF", "https://pokepast.es/0123456789abcdeg",
    "https://pokepast.es/12345678901", "https://pokepast.es/-1",
    ` ${URL}`, `${URL} `, `\t${URL}`, `${URL}\n`, `${URL}\r\n`, `${URL}\u0000`,
    `https://poke\tpast.es/${ID}`, `https://pokepast.es/\n${ID}`,
    `https:\\pokepast.es\\${ID}`, `https://pokepast.es\\@example.com/${ID}`,
    `${URL}\\raw`, `${URL}\u007f`, `${URL}​`,
  ])("rejects noncanonical or disguised input %j", (input) => {
    expect(() => parsePokePasteUrl(input)).toThrow(/valid HTTPS pokepast\.es.*paste the team text instead/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid input before starting a fetch or timeout", async () => {
    await expect(fetchPokePaste("https://example.com/private")).rejects.toThrow(/paste the team text instead/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("bounded direct PokePaste reads", () => {
  it.each([undefined, "text/plain; charset=utf-8", "text/html", "application/json"])(
    "reads valid JSON regardless of Content-Type %s and preserves split UTF-8",
    async (contentType) => {
      const bytes = encoder.encode(JSON.stringify(payload));
      const split = bytes.indexOf(0xc3) + 1;
      const h = streamedResponse([bytes.slice(0, split), bytes.slice(split, split + 1), bytes.slice(split + 1)], {
        headers: contentType ? { "content-type": contentType } : undefined,
      });
      setResponseProperty(h.response, "type", "cors");
      setResponseProperty(h.response, "url", JSON_URL);
      const unboundedText = vi.spyOn(h.response, "text");
      const unboundedJson = vi.spyOn(h.response, "json");
      fetchMock.mockResolvedValueOnce(h.response);

      const result: PokePastePayload = await fetchPokePaste(`${URL}/raw`);
      expect(result).toEqual({ ...payload, url: URL });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(JSON_URL, {
        credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error",
        signal: expect.any(AbortSignal),
      });
      expect(unboundedText).not.toHaveBeenCalled();
      expect(unboundedJson).not.toHaveBeenCalled();
      expect(h.cancel).not.toHaveBeenCalled();
      expect(h.stream.locked).toBe(false);
    },
  );

  it("uses the JSON endpoint for legacy IDs above 999 too", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse().response);
    await expect(fetchPokePaste("pokepast.es/9999999999/json")).resolves.toEqual({
      ...payload, url: "https://pokepast.es/9999999999",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://pokepast.es/9999999999/json");
  });

  it("returns only string metadata and the trusted canonical URL without following links or logging content", async () => {
    const data = {
      ...payload,
      title: "<b>Untrusted title</b>",
      author: "https://example.com/author",
      notes: '<script>alert("untrusted")</script>',
      url: "https://example.com/not-the-source",
      anotherLink: "https://example.com/extra",
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(jsonResponse(data).response);
    await expect(fetchPokePaste(URL)).resolves.toEqual({
      paste: data.paste, title: data.title, author: data.author, notes: data.notes, url: URL,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("allows empty string fields so team validation can be handled by the parser", async () => {
    const empty = { paste: "", title: "", author: "", notes: "" };
    fetchMock.mockResolvedValueOnce(jsonResponse(empty).response);
    await expect(fetchPokePaste(URL)).resolves.toEqual({ ...empty, url: URL });
  });

  it.each([201, 206, 301, 302, 400, 401, 403, 404, 429, 500])(
    "rejects HTTP %i and cancels the body without reading response text",
    async (status) => {
      const h = jsonResponse(payload, { status });
      fetchMock.mockResolvedValueOnce(h.response);
      await expect(fetchPokePaste(URL)).rejects.toThrow(/available paste.*paste the team text instead/);
      expect(h.pull).not.toHaveBeenCalled();
      expect(h.cancel).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["redirected", true],
    ["type", "opaque"], ["type", "opaqueredirect"], ["type", "error"], ["type", "unexpected"],
    ["url", "https://example.com/stolen/json"],
    ["url", "https://pokepast.es:8443/0123456789abcdef/json"],
    ["url", `${URL}/raw`],
    ["url", "https://pokepast.es/999/json"],
  ])("defensively rejects unexpected response %s=%s", async (key, value) => {
    const h = jsonResponse();
    setResponseProperty(h.response, key as string, value);
    fetchMock.mockResolvedValueOnce(h.response);
    await expect(fetchPokePaste(URL)).rejects.toThrow(/unexpected or redirected.*paste the team text instead/);
    expect(h.pull).not.toHaveBeenCalled();
    expect(h.cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing response body instead of falling back to unbounded text()", async () => {
    const response = new Response(null);
    const text = vi.spyOn(response, "text");
    fetchMock.mockResolvedValueOnce(response);
    await expect(fetchPokePaste(URL)).rejects.toThrow(/no readable response body.*paste the team text instead/);
    expect(text).not.toHaveBeenCalled();
  });

  it.each([
    new TypeError("Failed to fetch"),
    new Error("<html>private service diagnostic</html>"),
  ])("reports safe fallback text for a rejected fetch", async (error) => {
    fetchMock.mockRejectedValueOnce(error);
    const result = fetchPokePaste(URL);
    await expect(result).rejects.toThrow(/could not be read.*paste the team text instead/);
    await expect(result).rejects.not.toThrow(error.message);
  });

  it("handles a failed body read without leaking the stream error or retaining its lock", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError("<html>private stream diagnostic</html>"));
      },
    }, { highWaterMark: 0 });
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");
    fetchMock.mockResolvedValueOnce(new Response(stream));
    const result = fetchPokePaste(URL);
    await expect(result).rejects.toThrow(/could not be read.*paste the team text instead/);
    await expect(result).rejects.not.toThrow(/private stream diagnostic/);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });
});

describe("PokePaste encoding and schema validation", () => {
  const invalidPayloads: [string, unknown][] = [
    ["null", null], ["array", [payload]], ["string", "not a payload"],
    ["number", 42], ["boolean", true], ["empty object", {}],
    ["numeric paste", { ...payload, paste: 42 }],
    ["object title", { ...payload, title: {} }],
    ["null author", { ...payload, author: null }],
    ["array notes", { ...payload, notes: [] }],
    ...(["paste", "title", "author", "notes"] as const).map((field): [string, unknown] => {
      const data: Record<string, unknown> = { ...payload };
      delete data[field];
      return [`missing ${field}`, data];
    }),
  ];

  it.each(invalidPayloads)("rejects %s and cancels/releases its reader", async (_name, data) => {
    const h = jsonResponse(data);
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");
    fetchMock.mockResolvedValueOnce(h.response);
    await expect(fetchPokePaste(URL)).rejects.toThrow(/invalid paste or metadata fields.*paste the team text instead/);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.stream.locked).toBe(false);
  });

  it.each(["", "<html>not a paste</html>", '{"paste":', `${JSON.stringify(payload)} trailing text`])(
    "rejects invalid JSON %j with a safe error and cancels its reader",
    async (text) => {
      const h = streamedResponse([encoder.encode(text)]);
      const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");
      fetchMock.mockResolvedValueOnce(h.response);
      await expect(fetchPokePaste(URL)).rejects.toThrow(/invalid JSON.*paste the team text instead/);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(h.stream.locked).toBe(false);
    },
  );

  it.each([
    ["invalid sequence", [new Uint8Array([0xf0, 0x28, 0x8c, 0x28])]],
    ["truncated final sequence", [new Uint8Array([0xc3])]],
    ["split invalid sequence", [new Uint8Array([0xc3]), new Uint8Array([0x28])]],
  ] as const)("rejects %s rather than silently replacing malformed UTF-8", async (_name, chunks) => {
    const h = streamedResponse([...chunks]);
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");
    fetchMock.mockResolvedValueOnce(h.response);
    await expect(fetchPokePaste(URL)).rejects.toThrow(/invalid UTF-8.*paste the team text instead/);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.stream.locked).toBe(false);
  });
});

describe("PokePaste response and team byte limits", () => {
  it.each([String(RESPONSE_LIMIT + 1), "999999999999999999999999999999999999"])(
    "rejects Content-Length %s before reading and cancels the reader",
    async (length) => {
      const h = jsonResponse(payload, { headers: { "content-length": length } });
      fetchMock.mockResolvedValueOnce(h.response);
      await expect(fetchPokePaste(URL)).rejects.toThrow(/128 KiB.*paste the team text instead/);
      expect(h.pull).not.toHaveBeenCalled();
      expect(h.cancel).toHaveBeenCalledTimes(1);
      expect(h.stream.locked).toBe(false);
    },
  );

  it.each(["-1", "1.5", "1e3", "12, 34", "not-a-number", ""])(
    "rejects malformed declared size %j safely",
    async (length) => {
      const h = jsonResponse(payload, { headers: { "content-length": length } });
      fetchMock.mockResolvedValueOnce(h.response);
      await expect(fetchPokePaste(URL)).rejects.toThrow(/invalid response size.*paste the team text instead/);
      expect(h.cancel).toHaveBeenCalledTimes(1);
    },
  );

  it.each([undefined, "1", String(RESPONSE_LIMIT)])(
    "counts actual cumulative bytes even with Content-Length %s",
    async (length) => {
      const h = streamedResponse([
        encoder.encode(" ".repeat(RESPONSE_LIMIT / 2)),
        encoder.encode(" ".repeat(RESPONSE_LIMIT / 2)),
        encoder.encode(" "),
      ], { headers: length === undefined ? undefined : { "content-length": length } });
      fetchMock.mockResolvedValueOnce(h.response);
      await expect(fetchPokePaste(URL)).rejects.toThrow(/128 KiB.*paste the team text instead/);
      expect(h.pull).toHaveBeenCalledTimes(3);
      expect(h.cancel).toHaveBeenCalledTimes(1);
      expect(h.stream.locked).toBe(false);
    },
  );

  it("rejects an oversized single chunk immediately", async () => {
    const h = streamedResponse([new Uint8Array(RESPONSE_LIMIT + 1)]);
    fetchMock.mockResolvedValueOnce(h.response);
    await expect(fetchPokePaste(URL)).rejects.toThrow(/128 KiB.*paste the team text instead/);
    expect(h.pull).toHaveBeenCalledTimes(1);
    expect(h.cancel).toHaveBeenCalledTimes(1);
  });

  it("allows metadata up to the total 128 KiB response boundary", async () => {
    const data = { paste: "Pikachu", title: "", author: "", notes: "" };
    const overhead = encoder.encode(JSON.stringify(data)).byteLength;
    data.notes = "n".repeat(RESPONSE_LIMIT - overhead);
    expect(encoder.encode(JSON.stringify(data)).byteLength).toBe(RESPONSE_LIMIT);
    const h = jsonResponse(data, { headers: { "content-length": String(RESPONSE_LIMIT) } });
    fetchMock.mockResolvedValueOnce(h.response);
    await expect(fetchPokePaste(URL)).resolves.toEqual({ ...data, url: URL });
    expect(h.stream.locked).toBe(false);
  });

  it.each(["a", "é", "😀"])("allows exactly 64 KiB of UTF-8 team text using %s", async (character) => {
    const paste = character.repeat(PASTE_LIMIT / encoder.encode(character).byteLength);
    expect(encoder.encode(paste).byteLength).toBe(PASTE_LIMIT);
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...payload, paste }).response);
    await expect(fetchPokePaste(URL)).resolves.toEqual({ ...payload, paste, url: URL });
  });

  it.each(["a", "é", "😀"])("rejects team text over 64 KiB of UTF-8 using %s", async (character) => {
    const paste = character.repeat(PASTE_LIMIT / encoder.encode(character).byteLength + 1);
    const h = jsonResponse({ ...payload, paste });
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");
    fetchMock.mockResolvedValueOnce(h.response);
    await expect(fetchPokePaste(URL)).rejects.toThrow(/64 KiB.*paste the team text instead/);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.stream.locked).toBe(false);
  });

  it("does not wait for a broken stream's cancellation promise to settle", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(RESPONSE_LIMIT + 1));
      },
      cancel,
    }, { highWaterMark: 0 });
    fetchMock.mockResolvedValueOnce(new Response(stream));
    await expect(fetchPokePaste(URL)).rejects.toThrow(/128 KiB.*paste the team text instead/);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });
});

describe("PokePaste cancellation, supersession and timeout cleanup", () => {
  it("does not fetch or attach a listener when already aborted and hides arbitrary abort reasons", async () => {
    const caller = new AbortController();
    caller.abort(new Error("<html>private abort reason</html>"));
    const add = vi.spyOn(caller.signal, "addEventListener");
    await expect(fetchPokePaste(URL, caller.signal)).rejects.toMatchObject({
      name: "AbortError", message: "PokePaste import was cancelled.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it("links caller cancellation while fetching and removes its listener", async () => {
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, "addEventListener");
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    fetchMock.mockImplementationOnce((_input, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    }));
    const request = fetchPokePaste(URL, caller.signal);
    const failure = expect(request).rejects.toMatchObject({ name: "AbortError" });
    const linked = fetchMock.mock.calls[0][1]!.signal!;
    expect(linked).not.toBe(caller.signal);
    expect(linked.aborted).toBe(false);
    caller.abort("a superseded request");
    await failure;
    expect(linked.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels a pending streamed read, releases its reader and cleans up the caller listener", async () => {
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, "addEventListener");
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    const h = pendingResponse('{"paste":"partial team');
    fetchMock.mockResolvedValueOnce(h.response);
    const request = fetchPokePaste(URL, caller.signal);
    const failure = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await h.started;
    caller.abort();
    await failure;
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(h.stream.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
  });

  it("preserves a safe AbortError when fetch itself aborts", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("private cancellation detail", "AbortError"));
    await expect(fetchPokePaste(URL)).rejects.toMatchObject({
      name: "AbortError", message: "PokePaste import was cancelled.",
    });
  });

  it("keeps a superseded read aborted, cancels its late body, and does not affect the replacement read", async () => {
    const old = new AbortController();
    const current = new AbortController();
    const delayed = deferred<Response>();
    const late = jsonResponse({ ...payload, title: "Stale team" });
    const latest = jsonResponse({ ...payload, title: "Current team" });
    fetchMock.mockReturnValueOnce(delayed.promise).mockResolvedValueOnce(latest.response);
    const first = fetchPokePaste(URL, old.signal);
    const failure = expect(first).rejects.toMatchObject({ name: "AbortError" });
    old.abort();
    const second = fetchPokePaste("https://pokepast.es/1000", current.signal);
    await failure;
    await expect(second).resolves.toEqual({ ...payload, title: "Current team", url: "https://pokepast.es/1000" });
    delayed.resolve(late.response);
    await delayed.promise;
    await Promise.resolve();
    expect(late.pull).not.toHaveBeenCalled();
    expect(late.cancel).toHaveBeenCalledTimes(1);
    expect(current.signal.aborted).toBe(false);
    expect(fetchMock.mock.calls[1][1]!.signal!.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
  });

  it("handles a late rejection from an aborted fetch without exposing the old diagnostic", async () => {
    const caller = new AbortController();
    const delayed = deferred<Response>();
    fetchMock.mockReturnValueOnce(delayed.promise);
    const request = fetchPokePaste(URL, caller.signal);
    const failure = expect(request).rejects.toMatchObject({ name: "AbortError" });
    caller.abort();
    await failure;
    delayed.reject(new TypeError("late private diagnostic"));
    await Promise.resolve();
    await Promise.resolve();
    await expect(request).rejects.toMatchObject({ name: "AbortError", message: "PokePaste import was cancelled." });
  });

  it("times out at 10 seconds even if fetch ignores abort, without aborting its caller", async () => {
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, "addEventListener");
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}));
    const request = fetchPokePaste(URL, caller.signal);
    const settled = vi.fn();
    void request.then(settled, settled);
    const failure = expect(request).rejects.toThrow(/timed out after 10 seconds.*paste the team text instead/);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await failure;
    expect(settled).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
  });

  it("keeps the timeout active through a stalled body and cancels/releases that reader", async () => {
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, "addEventListener");
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    const h = pendingResponse();
    fetchMock.mockResolvedValueOnce(h.response);
    const request = fetchPokePaste(URL, caller.signal);
    const failure = expect(request).rejects.toThrow(/timed out.*paste the team text instead/);
    await h.started;
    await vi.advanceTimersByTimeAsync(10_000);
    await failure;
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(h.stream.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
  });

  it.each(["success", "fetch error", "schema error"] as const)(
    "removes the caller listener and timeout after %s",
    async (outcome) => {
      const caller = new AbortController();
      const add = vi.spyOn(caller.signal, "addEventListener");
      const remove = vi.spyOn(caller.signal, "removeEventListener");
      if (outcome === "fetch error") fetchMock.mockRejectedValueOnce(new TypeError("failed"));
      else fetchMock.mockResolvedValueOnce(jsonResponse(outcome === "success" ? payload : {}).response);
      const request = fetchPokePaste(URL, caller.signal);
      if (outcome === "success") await expect(request).resolves.toEqual({ ...payload, url: URL });
      else await expect(request).rejects.toThrow(/paste the team text instead/);
      expect(add).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
      expect(vi.getTimerCount()).toBe(0);
      caller.abort();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(false);
    },
  );
});
