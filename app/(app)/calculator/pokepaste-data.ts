export type PokePastePayload = {
  paste: string;
  title: string;
  author: string;
  notes: string;
  url: string;
};

const RESPONSE_BYTE_LIMIT = 128 * 1024;
const PASTE_BYTE_LIMIT = 64 * 1024;
const TIMEOUT_MS = 10_000;

class PokePasteError extends Error {
  constructor(message: string) {
    super(`${message} Please paste the team text instead.`);
  }
}

export function parsePokePasteUrl(input: string): { url: string; jsonUrl: string } {
  // Match the original input, not a URL parser's normalized host/path. This also
  // excludes credentials, explicit ports, escapes, queries and path traversal.
  const match = typeof input === "string"
    ? /^(?:https:\/\/)?pokepast\.es\/([0-9a-f]{16}|[0-9]{1,10})(?:\/(?:raw|json)?)?$/.exec(input)
    : null;
  // JavaScript's $ can match before a final newline; require the entire input.
  if (!match || match[0] !== input) {
    throw new PokePasteError("Enter a valid HTTPS pokepast.es paste link.");
  }
  const url = `https://pokepast.es/${match[1]}`;
  return { url, jsonUrl: `${url}/json` };
}

function cancelled(): DOMException {
  return new DOMException("PokePaste import was cancelled.", "AbortError");
}

/** Bound pending fetches/reads even if an implementation ignores its signal. */
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    function onAbort() {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    }
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

export async function fetchPokePaste(
  input: string,
  signal?: AbortSignal,
): Promise<PokePastePayload> {
  if (signal?.aborted) throw cancelled();
  const { url, jsonUrl } = parsePokePasteUrl(input);
  const controller = new AbortController();
  const onAbort = () => controller.abort(cancelled());
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(new PokePasteError("PokePaste timed out after 10 seconds."));
  }, TIMEOUT_MS);

  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    const result = await abortable(fetch(jsonUrl, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    }).then((value) => {
      // Dispose of a late response if a superseded fetch ignored cancellation.
      if (controller.signal.aborted) {
        void value.body?.cancel().catch(() => {});
        throw controller.signal.reason;
      }
      response = value;
      return value;
    }), controller.signal);
    if (controller.signal.aborted) throw controller.signal.reason;
    if (
      result.redirected ||
      !["basic", "cors", "default"].includes(result.type) ||
      (result.url !== "" && result.url !== jsonUrl)
    ) {
      throw new PokePasteError("PokePaste returned an unexpected or redirected response.");
    }
    if (!result.ok || result.status !== 200) {
      throw new PokePasteError("PokePaste did not return an available paste.");
    }
    if (!result.body) {
      throw new PokePasteError("PokePaste returned no readable response body.");
    }
    reader = result.body.getReader();
    const length = result.headers.get("content-length");
    if (length !== null) {
      if (!/^[0-9]+$/.test(length)) {
        throw new PokePasteError("PokePaste returned an invalid response size.");
      }
      if (Number(length) > RESPONSE_BYTE_LIMIT) {
        throw new PokePasteError("The PokePaste response exceeds the 128 KiB limit.");
      }
    }

    // Content-Type is not reliable on the official JSON endpoint. Decode only
    // bounded streamed bytes, rejecting malformed UTF-8 instead of replacing it.
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    while (true) {
      const chunk = await abortable(reader.read(), controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > RESPONSE_BYTE_LIMIT) {
        throw new PokePasteError("The PokePaste response exceeds the 128 KiB limit.");
      }
      try {
        text += decoder.decode(chunk.value, { stream: true });
      } catch {
        throw new PokePasteError("PokePaste returned invalid UTF-8 text.");
      }
    }
    try {
      text += decoder.decode();
    } catch {
      throw new PokePasteError("PokePaste returned invalid UTF-8 text.");
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new PokePasteError("PokePaste returned invalid JSON.");
    }
    if (
      typeof data !== "object" || data === null || Array.isArray(data) ||
      !("paste" in data) || typeof data.paste !== "string" ||
      !("title" in data) || typeof data.title !== "string" ||
      !("author" in data) || typeof data.author !== "string" ||
      !("notes" in data) || typeof data.notes !== "string"
    ) {
      throw new PokePasteError("PokePaste returned invalid paste or metadata fields.");
    }
    if (new TextEncoder().encode(data.paste).byteLength > PASTE_BYTE_LIMIT) {
      throw new PokePasteError("The PokePaste team text exceeds the 64 KiB limit.");
    }
    complete = true;
    return { paste: data.paste, title: data.title, author: data.author, notes: data.notes, url };
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof PokePasteError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw cancelled();
    // Do not expose response text, fetch diagnostics, or caller abort reasons.
    throw new PokePasteError("PokePaste could not be read. The link may be unavailable or blocked by your browser.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
    if (reader) {
      // Do not await cancellation: a broken stream must not hold up the fallback.
      if (!complete) void reader.cancel().catch(() => {});
      reader.releaseLock();
    } else if (response?.body) {
      void response.body.cancel().catch(() => {});
    }
  }
}
