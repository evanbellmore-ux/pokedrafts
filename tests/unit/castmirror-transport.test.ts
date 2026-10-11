import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, vi } from "vitest";
import { deferred } from "../helpers/castmirror-page.mjs";

const oauthURL = "https://www.warcraftlogs.com/oauth/token";
const apiURL = "https://www.warcraftlogs.com/api/v2/client";
const clientID = "synthetic-test-client-not-a-credential";
const clientSecret = "synthetic-test-secret-not-a-credential";
const token = "synthetic-test-token-not-a-credential";
const privateDetail = "synthetic-private-upstream-detail NOT_A_REAL_SECRET <script>alert(1)</script>";

function transport(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const network = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = String(input);
    assert.ok([oauthURL, apiURL].includes(url), "only explicitly controlled log-service URLs are allowed");
    assert.equal(init.cache, "no-store");
    return handler(url, init);
  });
  vi.stubGlobal("fetch", network);
  return network;
}
const oauth = () => Response.json({ access_token: token, expires_in: 3600 });
const spin = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => {
  // A cold actual module, not a replacement implementation, owns each test's
  // token/metadata cache. Only fetch and explicit fake environment values vary.
  vi.resetModules();
  vi.stubEnv("WCL_CLIENT_ID", clientID);
  vi.stubEnv("WCL_CLIENT_SECRET", clientSecret);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Uncontrolled real network access is forbidden in transport tests"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function controlledFailure(work: Promise<unknown>, code: string) {
  const { LogServiceError } = await import("../../app/api/castmirror/lib");
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof LogServiceError);
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /NOT_A_REAL_SECRET|private-upstream-detail|<script>/);
    return true;
  });
}

describe("CastMirror actual WCL/OAuth transport validation", () => {
  test("legacy callers and cancellable callers use actual OAuth/query serialization with private no-store transport", async () => {
    const network = transport((url) => url === oauthURL ? oauth() : Response.json({ data: { answer: 42 } }));
    const { wcl } = await import("../../app/api/castmirror/lib");
    assert.deepEqual(await wcl("query Synthetic", { input: "first" }), { answer: 42 });
    const controller = new AbortController();
    assert.deepEqual(await wcl("query Synthetic", { input: "second" }, { signal: controller.signal }), { answer: 42 });
    assert.deepEqual(network.mock.calls.map(([url]) => url), [oauthURL, apiURL, apiURL]);
    const auth = network.mock.calls[0][1]!;
    assert.equal(auth.method, "POST");
    assert.equal(new Headers(auth.headers).get("Authorization"), `Basic ${Buffer.from(`${clientID}:${clientSecret}`).toString("base64")}`);
    assert.equal(new Headers(auth.headers).get("Content-Type"), "application/x-www-form-urlencoded");
    assert.equal(auth.body, "grant_type=client_credentials");
    const api = network.mock.calls[2][1]!;
    assert.equal(api.method, "POST");
    assert.equal(api.signal, controller.signal);
    assert.equal(new Headers(api.headers).get("Authorization"), `Bearer ${token}`);
    assert.deepEqual(JSON.parse(String(api.body)), { query: "query Synthetic", variables: { input: "second" } });
  });

  test("a pre-aborted query never authenticates or fetches and preserves its cancellation reason", async () => {
    const network = transport(() => { throw new Error("must not fetch"); });
    const { wcl } = await import("../../app/api/castmirror/lib");
    const controller = new AbortController(), reason = new DOMException("Synthetic request canceled", "AbortError");
    controller.abort(reason);
    await assert.rejects(wcl("query Synthetic", {}, { signal: controller.signal }), (error) => error === reason);
    assert.equal(network.mock.calls.length, 0);
  });

  test("missing fake credentials fail safely before any fetch", async () => {
    vi.stubEnv("WCL_CLIENT_ID", ""); vi.stubEnv("WCL_CLIENT_SECRET", "");
    const network = transport(() => { throw new Error("must not fetch"); });
    const { wcl } = await import("../../app/api/castmirror/lib");
    await controlledFailure(wcl("query Synthetic"), "credentials");
    assert.equal(network.mock.calls.length, 0);
  });

  for (const [label, body] of [
    ["missing token", { expires_in: 3600 }], ["empty token", { access_token: "", expires_in: 3600 }],
    ["non-string token", { access_token: 123, expires_in: 3600 }],
    ["oversized token", { access_token: "x".repeat(16385), expires_in: 3600 }],
    ["missing expiry", { access_token: token }], ["non-numeric expiry", { access_token: token, expires_in: "3600" }],
    ["non-positive expiry", { access_token: token, expires_in: 0 }],
    ["negative expiry", { access_token: token, expires_in: -1 }],
  ] as const) {
    test(`invalid OAuth ${label} cannot be cached or sent to GraphQL`, async () => {
      const network = transport(() => Response.json(body));
      const { wcl } = await import("../../app/api/castmirror/lib");
      await controlledFailure(wcl("query Synthetic"), "oauth");
      await controlledFailure(wcl("query Synthetic"), "oauth");
      assert.equal(network.mock.calls.length, 2);
      assert.ok(network.mock.calls.every(([url]) => url === oauthURL));
    });
  }

  test("OAuth HTTP/body errors are controlled and never include an authentication response", async () => {
    for (const response of [new Response(privateDetail, { status: 401 }), new Response("{not-json"), Response.json({ error: privateDetail }, { status: 500 })]) {
      const network = transport(() => response);
      const { wcl } = await import("../../app/api/castmirror/lib");
      await controlledFailure(wcl("query Synthetic"), "oauth");
      assert.equal(network.mock.calls.length, 1);
    }
  });

  test("network exceptions are controlled and do not leak URLs, tokens, or raw transport errors", async () => {
    const network = transport(() => { throw new Error(privateDetail); });
    const { wcl } = await import("../../app/api/castmirror/lib");
    await controlledFailure(wcl("query Synthetic"), "unavailable");
    assert.equal(network.mock.calls.length, 1);
  });

  for (const [label, body, code] of [
    ["invalid JSON", "{not-json", "response"], ["missing data", "{}", "response"],
    ["null data", '{"data":null}', "response"], ["array data", '{"data":[]}', "response"],
    ["malformed errors", '{"data":{},"errors":{}}', "response"],
    ["private GraphQL query error", JSON.stringify({ errors: [{ message: privateDetail }] }), "query"],
    ["private GraphQL rate error", JSON.stringify({ errors: [{ message: "rate limit " + privateDetail }] }), "rate-limit"],
  ] as const) {
    test(`GraphQL ${label} becomes a controlled error, not a raw upstream body`, async () => {
      const network = transport((url) => url === oauthURL ? oauth() : new Response(body));
      const { wcl } = await import("../../app/api/castmirror/lib");
      await controlledFailure(wcl("query Synthetic"), code);
      assert.deepEqual(network.mock.calls.map(([url]) => url), [oauthURL, apiURL]);
    });
  }

  test("a non-retryable GraphQL HTTP error is sanitized without additional work", async () => {
    const network = transport((url) => url === oauthURL ? oauth() : new Response(privateDetail, { status: 403 }));
    const { wcl } = await import("../../app/api/castmirror/lib");
    await controlledFailure(wcl("query Synthetic"), "query");
    assert.equal(network.mock.calls.length, 2);
  });

  test("HTTP 401 forces fresh OAuth and the existing three-attempt cap settles without timer retries", async () => {
    vi.useFakeTimers();
    const network = transport((url) => url === oauthURL ? oauth() : new Response(privateDetail, { status: 401 }));
    const { wcl } = await import("../../app/api/castmirror/lib");
    await controlledFailure(wcl("query Synthetic"), "unauthorized");
    assert.deepEqual(network.mock.calls.map(([url]) => url), [oauthURL, apiURL, oauthURL, apiURL, oauthURL, apiURL]);
    assert.equal(vi.getTimerCount(), 0);
  });

  for (const status of [429, 503]) {
    test(`HTTP ${status} honors 500/1000ms waits, three attempts and sanitized terminal failure`, async () => {
      vi.useFakeTimers();
      const network = transport((url) => url === oauthURL ? oauth() : new Response(privateDetail, { status }));
      const { wcl } = await import("../../app/api/castmirror/lib");
      const rejection = controlledFailure(wcl("query Synthetic"), status === 429 ? "rate-limit" : "unavailable");
      await spin();
      assert.equal(network.mock.calls.filter(([url]) => url === apiURL).length, 1);
      assert.equal(vi.getTimerCount(), 1);
      await vi.advanceTimersByTimeAsync(499);
      assert.equal(network.mock.calls.filter(([url]) => url === apiURL).length, 1);
      await vi.advanceTimersByTimeAsync(1);
      assert.equal(network.mock.calls.filter(([url]) => url === apiURL).length, 2);
      assert.equal(vi.getTimerCount(), 1);
      await vi.advanceTimersByTimeAsync(999);
      assert.equal(network.mock.calls.filter(([url]) => url === apiURL).length, 2);
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
      assert.equal(network.mock.calls.filter(([url]) => url === apiURL).length, 3);
      assert.equal(network.mock.calls.filter(([url]) => url === oauthURL).length, 3);
      assert.equal(vi.getTimerCount(), 0);
    });
  }

  test("a transient retry can succeed without retaining its first upstream failure", async () => {
    vi.useFakeTimers(); let attempts = 0;
    const network = transport((url) => url === oauthURL ? oauth() : ++attempts === 1
      ? new Response(privateDetail, { status: 503 }) : Response.json({ data: { recovered: true } }));
    const { wcl } = await import("../../app/api/castmirror/lib");
    const pending = wcl("query Synthetic");
    await spin(); await vi.advanceTimersByTimeAsync(500);
    assert.deepEqual(await pending, { recovered: true });
    assert.equal(network.mock.calls.length, 4);
    assert.equal(vi.getTimerCount(), 0);
  });

  for (const expiresIn of [604801, 5184000, Number.MAX_VALUE]) {
    test(`valid OAuth lifetime ${expiresIn} is accepted while its local cache stays bounded`, async () => {
      vi.useFakeTimers();
      const start = 2_000_000, cacheLimit = 7 * 24 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(start));
      const network = transport((url) => url === oauthURL
        ? Response.json({ access_token: token, expires_in: expiresIn }) : Response.json({ data: {} }));
      const { wcl } = await import("../../app/api/castmirror/lib");
      assert.deepEqual(await wcl("query Synthetic"), {});
      vi.setSystemTime(new Date(start + cacheLimit - 60_001));
      assert.deepEqual(await wcl("query Synthetic"), {});
      assert.equal(network.mock.calls.filter(([url]) => url === oauthURL).length, 1);
      vi.setSystemTime(new Date(start + cacheLimit - 60_000));
      assert.deepEqual(await wcl("query Synthetic"), {});
      assert.deepEqual(network.mock.calls.map(([url]) => url), [oauthURL, apiURL, apiURL, oauthURL, apiURL]);
      assert.equal(vi.getTimerCount(), 0);
    });
  }

  test("OAuth cache expires at its safety margin and a cold module cannot rely on another instance's token", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2000000));
    const network = transport((url) => url === oauthURL ? Response.json({ access_token: token, expires_in: 120 }) : Response.json({ data: {} }));
    const warm = await import("../../app/api/castmirror/lib");
    await warm.wcl("query Synthetic");
    vi.setSystemTime(new Date(2059999)); await warm.wcl("query Synthetic");
    assert.equal(network.mock.calls.filter(([url]) => url === oauthURL).length, 1);
    vi.setSystemTime(new Date(2060000)); await warm.wcl("query Synthetic");
    assert.equal(network.mock.calls.filter(([url]) => url === oauthURL).length, 2);
    vi.resetModules();
    const cold = await import("../../app/api/castmirror/lib");
    await cold.wcl("query Synthetic");
    assert.equal(network.mock.calls.filter(([url]) => url === oauthURL).length, 3);
  });
});

// Real default handler -> generated comparison core -> real WCL client. A
// cooperative synthetic fetch/ReadableStream models in-flight transport only.
// Deadlines/cancellation must settle it before the handler returns, including
// authentication bodies and the client's actual exponential-backoff timer.
describe("CastMirror default request deadline through the actual transport", () => {
  for (const phase of ["OAuth fetch", "OAuth body", "GraphQL fetch", "GraphQL body", "retry backoff"]) {
    for (const terminal of ["caller cancellation", "deadline"]) {
      test(`${terminal} during ${phase} aborts and settles real default-path work`, async () => {
        vi.useFakeTimers();
        const ready = deferred(); let active = 0, settled = 0;
        const waitForAbort = (signal: AbortSignal) => {
          signal.throwIfAborted(); active++; ready.resolve(undefined);
          return new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => { active--; settled++; reject(signal.reason); }, { once: true });
          });
        };
        const stalledBody = (signal: AbortSignal) => new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            signal.throwIfAborted(); active++; ready.resolve(undefined);
            signal.addEventListener("abort", () => { active--; settled++; controller.error(signal.reason); }, { once: true });
          },
        }));
        const signals: AbortSignal[] = [];
        const network = transport((url, init) => {
          assert.ok(init.signal instanceof AbortSignal);
          const signal = init.signal; signals.push(signal);
          if (url === oauthURL) {
            if (phase === "OAuth fetch") return waitForAbort(signal);
            if (phase === "OAuth body") return stalledBody(signal);
            return oauth();
          }
          if (phase === "GraphQL fetch") return waitForAbort(signal);
          if (phase === "GraphQL body") return stalledBody(signal);
          assert.equal(phase, "retry backoff"); ready.resolve(undefined);
          return new Response(privateDetail, { status: 503 });
        });
        const { createCompareHandler } = await import("../../app/api/castmirror/compare/service");
        const handler = createCompareHandler({ admission: () => true, deadlineMs: 25 });
        const caller = new AbortController();
        const request = () => new Request("https://hosted.example/api/castmirror/compare?name=You&server=Test%20Realm&region=us&encounter=42&difficulty=4&metric=dps&zone=99", { signal: caller.signal });
        const pending = handler(request());
        await ready.promise; await spin();
        if (phase === "retry backoff") assert.equal(vi.getTimerCount(), 2, "the real client retry timer and request deadline must both be armed");
        if (terminal === "deadline") await vi.advanceTimersByTimeAsync(25); else caller.abort();
        const response = await pending;
        assert.equal(response.status, terminal === "deadline" ? 504 : 499);
        const value = await response.json();
        assert.match(value.error, terminal === "deadline" ? /deadline/ : /canceled/);
        assert.doesNotMatch(JSON.stringify(value), /NOT_A_REAL_SECRET|private-upstream-detail|<script>/);
        assert.match(response.headers.get("Cache-Control") ?? "", /private.*no-store/);
        assert.equal(active, 0, "body/fetch transport must settle before the response");
        assert.equal(settled, phase === "retry backoff" ? 0 : 1);
        assert.ok(signals.length > 0 && signals.every((signal) => signal.aborted));
        assert.equal(vi.getTimerCount(), 0, "deadline/retry timers must be cleared");
        const count = network.mock.calls.length;
        await vi.advanceTimersByTimeAsync(2000);
        assert.equal(network.mock.calls.length, count, "aborted retry work must not restart after returning");
        if (terminal === "deadline") {
          const retried = handler(request()); await spin(); await vi.advanceTimersByTimeAsync(25);
          assert.equal((await retried).status, 504);
          assert.ok(network.mock.calls.length > count, "deadline failures must not become warm-cache hits");
          assert.equal(active, 0); assert.equal(vi.getTimerCount(), 0);
        }
      });
    }
  }
});
