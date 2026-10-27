import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { fakeTransport, memoryStorage } from "../fixtures/training";

/**
 * Error reports (docs/release-architecture.md section 17): off unless
 * NEXT_PUBLIC_ERROR_REPORTING is on; the browser posts its errors to
 * /api/error-reports and instrumentation.ts logs the server's, each as one
 * `[pokedrafts] error report {...}` line, with no cookies, query strings,
 * emails, tokens or row details.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = "https://pokedrafts.example";
const PREFIX = "[pokedrafts] error report ";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImNvYWNoQGV4YW1wbGUuY29tIn0.c2lnbmF0dXJlLXZhbHVl";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

function turnOn() {
  vi.stubEnv("NEXT_PUBLIC_ERROR_REPORTING", "on");
}

/** A fresh copy of the module, so the per-page report count starts at zero. */
function reports() {
  return import("@/app/lib/error-reports");
}

/** A browser page at `url`: `window` (an EventTarget with `location`), `navigator` and `fetch`. */
function browserPage(url = `${ORIGIN}/leagues/0d1c/draft`, online = true) {
  const { pathname, search, hash } = new URL(url);
  const page = Object.assign(new EventTarget(), { location: { pathname, search, hash } });
  const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("window", page);
  vi.stubGlobal("navigator", { onLine: online });
  vi.stubGlobal("fetch", fetch);
  return {
    page,
    fetch,
    sent: () => fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>),
  };
}

/** Every `[pokedrafts] error report` line console.error printed, parsed. */
function logged(spy: MockInstance<typeof console.error>) {
  return spy.mock.calls
    .map(([line]) => line)
    .filter((line): line is string => typeof line === "string" && line.startsWith(PREFIX))
    .map((line) => JSON.parse(line.slice(PREFIX.length)) as Record<string, unknown>);
}

function quietConsole() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("the switch", () => {
  it("is on only for NEXT_PUBLIC_ERROR_REPORTING on, 1 or true", async () => {
    const { errorReportingEnabled } = await reports();
    expect(errorReportingEnabled()).toBe(false);
    for (const value of ["", "off", "0", "false", "no"]) {
      vi.stubEnv("NEXT_PUBLIC_ERROR_REPORTING", value);
      expect(errorReportingEnabled(), value).toBe(false);
    }
    for (const value of ["on", "ON", " 1 ", "true"]) {
      vi.stubEnv("NEXT_PUBLIC_ERROR_REPORTING", value);
      expect(errorReportingEnabled(), value).toBe(true);
    }
  });
});

describe("scrubText", () => {
  it("drops query strings and fragments, keeping a stack frame's line and column", async () => {
    const { scrubText } = await reports();
    expect(scrubText("at go (https://www.pokedrafts.io/auth/callback?code=abc&next=%2Fdashboard:3:15)")).toBe(
      "at go (https://www.pokedrafts.io/auth/callback:3:15)"
    );
    expect(scrubText("go@https://www.pokedrafts.io/update-password?next=/leagues/1:7:2")).toBe(
      "go@https://www.pokedrafts.io/update-password:7:2"
    );
    expect(scrubText("Failed to load https://x.supabase.co/rest/v1/leagues?select=*&id=eq.42")).toBe(
      "Failed to load https://x.supabase.co/rest/v1/leagues"
    );
    expect(scrubText("https://www.pokedrafts.io/watch#live and more")).toBe("https://www.pokedrafts.io/watch and more");
    const plain = "TypeError: x is undefined\n    at a (https://www.pokedrafts.io/_next/static/chunks/0f3a.js:1:2345)";
    expect(scrubText(plain)).toBe(plain);
  });

  it("replaces email addresses and tokens", async () => {
    const { scrubText } = await reports();
    expect(scrubText("Key (email)=(coach.one+x@example.co.uk) already exists.")).toBe("Key (email)=([email]) already exists.");
    expect(scrubText(`jwt ${TOKEN} expired`)).toBe("jwt [token] expired");
    expect(scrubText("Authorization: Bearer abc.def-123==")).toBe("Authorization: Bearer [token]");
    // Firefox and Safari write frames as name@url: not an address.
    expect(scrubText("render@https://www.pokedrafts.io/_next/static/chunks/a.js:1:2")).toBe(
      "render@https://www.pokedrafts.io/_next/static/chunks/a.js:1:2"
    );
  });
});

describe("readErrorReport", () => {
  it("refuses anything that is not a report", async () => {
    const { readErrorReport } = await reports();
    for (const body of [null, "boom", 42, [], {}, { kind: "page" }, { kind: "server", message: "x" }, { kind: "page", message: 1 }]) {
      expect(readErrorReport(body), JSON.stringify(body)).toBeNull();
    }
  });

  it("keeps the known fields, cleaned and clipped, and drops the rest", async () => {
    const { readErrorReport } = await reports();
    const report = readErrorReport({
      kind: "unexpected",
      name: "PostgrestError",
      message: `${"m".repeat(600)} coach@example.com`,
      code: 42501,
      digest: "123",
      path: "/invite/ABC?next=/x#y",
      build: "abc1234",
      stack: "s".repeat(3000),
      details: "Failing row contains (coach@example.com).",
      cookie: "sb-access-token=secret",
    });
    expect(report).toEqual({
      kind: "unexpected",
      name: "PostgrestError",
      message: `${"m".repeat(499)}…`,
      code: "42501",
      digest: "123",
      path: "/invite/ABC",
      build: "abc1234",
      stack: `${"s".repeat(1999)}…`,
    });
    expect(readErrorReport({ kind: "page", message: "x", path: "https://evil.example/" })?.path).toBeUndefined();
  });
});

describe("POST /api/error-reports", () => {
  async function post(body: unknown, headers: Record<string, string> = {}) {
    const { POST } = await import("@/app/api/error-reports/route");
    return POST(
      new NextRequest(new URL("/api/error-reports", ORIGIN), {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "user-agent": USER_AGENT, ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      })
    );
  }

  const REPORT = {
    kind: "page",
    name: "TypeError",
    message: "Cannot read properties of undefined (reading 'name') for coach@example.com",
    digest: "1234567",
    path: "/leagues/0d1c/draft?tab=board",
    stack: "TypeError: x\n    at a (https://pokedrafts.example/leagues/0d1c/draft?tab=board:1:20)",
  };

  it("is a 404 while reports are off, and logs nothing", async () => {
    const spy = quietConsole();
    expect((await post(REPORT)).status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it("logs one cleaned line per report, with the user agent and nothing else of the request", async () => {
    turnOn();
    const spy = quietConsole();
    const response = await post(REPORT, { cookie: "sb-ref-auth-token=secret", "x-forwarded-for": "203.0.113.9" });
    expect(response.status).toBe(204);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(logged(spy)).toEqual([
      {
        source: "browser",
        kind: "page",
        name: "TypeError",
        message: "Cannot read properties of undefined (reading 'name') for [email]",
        digest: "1234567",
        path: "/leagues/0d1c/draft",
        browser: USER_AGENT,
        stack: "TypeError: x\n    at a (https://pokedrafts.example/leagues/0d1c/draft:1:20)",
      },
    ]);
    const line = String(spy.mock.calls[0][0]);
    expect(line).not.toMatch(/secret|203\.0\.113\.9|coach@|tab=board/);
  });

  it("accepts only same-origin requests", async () => {
    turnOn();
    const spy = quietConsole();
    expect((await post(REPORT, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post(REPORT, { "sec-fetch-site": "same-site" })).status).toBe(403);
    // Browsers without Sec-Fetch-Site: the Origin's host must be the Host.
    const old = { "sec-fetch-site": "" };
    expect((await post(REPORT, { ...old, origin: "https://evil.example", host: "pokedrafts.example" })).status).toBe(403);
    expect((await post(REPORT, { ...old, host: "pokedrafts.example" })).status).toBe(403);
    expect((await post(REPORT, { ...old, origin: ORIGIN, host: "pokedrafts.example" })).status).toBe(204);
    expect(logged(spy)).toHaveLength(1);
  });

  it("refuses oversized bodies, bad JSON and other shapes", async () => {
    turnOn();
    const spy = quietConsole();
    expect((await post({ ...REPORT, stack: "s".repeat(20_000) })).status).toBe(413);
    expect((await post(REPORT, { "content-length": String(17 * 1024) })).status).toBe(413);
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ kind: "server", message: "x" })).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("onRequestError (instrumentation.ts)", () => {
  const request = {
    path: "/leagues/0d1c?next=/x",
    method: "GET",
    headers: { cookie: "sb-ref-auth-token=secret", "user-agent": USER_AGENT },
  };
  const context = {
    routerKind: "App Router" as const,
    routePath: "/(app)/leagues/[leagueId]",
    routeType: "render" as const,
    renderSource: "react-server-components" as const,
    revalidateReason: undefined,
  };

  it("logs nothing while reports are off", async () => {
    const spy = quietConsole();
    const { onRequestError } = await import("@/instrumentation");
    await onRequestError(new Error("boom"), request, context);
    expect(spy).not.toHaveBeenCalled();
  });

  it("logs one line with the route, path and digest, and never the request's headers", async () => {
    turnOn();
    const spy = quietConsole();
    const { onRequestError } = await import("@/instrumentation");
    const error = Object.assign(new Error(`league load failed for coach@example.com with ${TOKEN}`), { digest: "998877" });
    await onRequestError(error, request, context);
    const [line] = logged(spy);
    expect(line).toMatchObject({
      source: "server",
      kind: "render",
      route: "/(app)/leagues/[leagueId]",
      method: "GET",
      path: "/leagues/0d1c",
      name: "Error",
      message: "league load failed for [email] with [token]",
      digest: "998877",
    });
    expect(String(line.stack)).toMatch(/^Error: league load failed for \[email\]/);
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/secret|Chrome\/141|coach@|next=/);
  });
});

describe("browser reports", () => {
  it("sends nothing while reports are off, or outside a browser", async () => {
    const { reportClientError } = await reports();
    const { fetch } = browserPage();
    reportClientError("page", new Error("off"));
    vi.unstubAllGlobals();
    turnOn();
    const fetchOnServer = vi.fn();
    vi.stubGlobal("fetch", fetchOnServer);
    reportClientError("page", new Error("server side"));
    expect(fetch).not.toHaveBeenCalled();
    expect(fetchOnServer).not.toHaveBeenCalled();
  });

  it("posts the report without cookies, without the page's query string", async () => {
    turnOn();
    const { reportClientError } = await reports();
    const { fetch, sent } = browserPage(`${ORIGIN}/invite/AB12?next=/leagues/9`);
    const error = new TypeError("cannot join /invite/AB12?next=/leagues/9");
    error.stack = `TypeError: cannot join\n    at join (${ORIGIN}/_next/static/chunks/a.js:1:2)`;
    reportClientError("uncaught", error);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/error-reports");
    expect(init).toMatchObject({ method: "POST", credentials: "omit", keepalive: true, headers: { "content-type": "application/json" } });
    expect(sent()).toEqual([
      {
        kind: "uncaught",
        name: "TypeError",
        message: "cannot join /invite/AB12",
        stack: `TypeError: cannot join\n    at join (${ORIGIN}/_next/static/chunks/a.js:1:2)`,
        path: "/invite/AB12",
      },
    ]);
  });

  it("sends a repeated error once and at most ten reports a page", async () => {
    turnOn();
    const { reportClientError } = await reports();
    const { fetch } = browserPage();
    reportClientError("page", new Error("same"));
    reportClientError("page", new Error("same"));
    expect(fetch).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 20; index += 1) reportClientError("rejection", new Error(`error ${index}`));
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it("skips browser noise, extensions and offline pages", async () => {
    turnOn();
    const { reportClientError } = await reports();
    const { fetch } = browserPage();
    reportClientError("rejection", new DOMException("The user aborted a request.", "AbortError"));
    reportClientError("uncaught", "ResizeObserver loop completed with undelivered notifications.");
    reportClientError("uncaught", "Script error.");
    const fromExtension = new Error("extension");
    fromExtension.stack = "Error: extension\n    at x (chrome-extension://abcdef/content.js:1:1)";
    reportClientError("uncaught", fromExtension);
    expect(fetch).not.toHaveBeenCalled();

    vi.resetModules();
    const offline = await reports();
    const page = browserPage(undefined, false);
    offline.reportClientError("page", new Error("offline"));
    expect(page.fetch).not.toHaveBeenCalled();
  });

  it("never throws, even when fetch does", async () => {
    turnOn();
    const { reportClientError } = await reports();
    browserPage();
    vi.stubGlobal("fetch", () => {
      throw new TypeError("fetch is broken");
    });
    expect(() => reportClientError("page", new Error("still fine"))).not.toThrow();
  });

  it("friendlyError reports the raw error it hides with its code and message, never its details or hint", async () => {
    turnOn();
    quietConsole();
    const { friendlyError, GENERIC_ERROR } = await import("@/app/lib/errors");
    const { sent } = browserPage();
    const raw = { code: "XX000", message: "internal error", details: "Failing row contains (coach@example.com).", hint: "Check row 7." };
    expect(friendlyError(raw)).toBe(GENERIC_ERROR);
    expect(sent()).toEqual([{ kind: "unexpected", code: "XX000", message: "internal error", path: "/leagues/0d1c/draft" }]);
  });

  it("Training reports the battle engine's load error", async () => {
    turnOn();
    const { createTrainingSession } = await import("@/app/(app)/training/training-session");
    vi.useFakeTimers();
    try {
      const { sent } = browserPage(`${ORIGIN}/training`);
      const fake = fakeTransport();
      const session = createTrainingSession({ transport: () => fake.transport, storage: memoryStorage() });
      const unsubscribe = session.subscribe(() => undefined);
      fake.emit({ type: "load-error", message: "The simulator worker failed to start." });
      unsubscribe();
      expect(sent()).toEqual([{ kind: "training", message: "The simulator worker failed to start.", path: "/training" }]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("instrumentation-client.ts", () => {
  function errorEvent(error: unknown, filename = `${ORIGIN}/_next/static/chunks/a.js`) {
    return Object.assign(new Event("error"), { error, filename, message: error instanceof Error ? error.message : String(error) });
  }

  it("listens for nothing while reports are off", async () => {
    const { page, fetch } = browserPage();
    await import("@/instrumentation-client");
    page.dispatchEvent(errorEvent(new Error("off")));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports errors and rejections nothing caught, but not an extension's", async () => {
    turnOn();
    const { page, sent } = browserPage();
    await import("@/instrumentation-client");
    page.dispatchEvent(errorEvent(new Error("from an extension"), "chrome-extension://abcdef/content.js"));
    page.dispatchEvent(errorEvent(new Error("click handler failed")));
    page.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: { code: "PGRST301", message: "JWT expired" } }));
    expect(sent().map(({ kind, message }) => [kind, message])).toEqual([
      ["uncaught", "click handler failed"],
      ["rejection", "JWT expired"],
    ]);
  });
});

describe("the error boundaries report what they catch", () => {
  it.each([
    ["app/error.tsx", 'reportClientError("page", error)'],
    ["app/global-error.tsx", 'reportClientError("root", error)'],
  ])("%s", (file, call) => {
    const source = readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
    expect(source).toMatch(new RegExp(`useEffect\\(\\(\\) => \\{[^}]*${call.replace(/[()]/g, "\\$&")};[^}]*\\}, \\[error\\]\\)`));
  });
});
