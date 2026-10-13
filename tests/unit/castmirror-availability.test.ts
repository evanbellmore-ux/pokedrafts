import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, beforeEach, describe, test, vi } from "vitest";
import type { RequestedExecutionContext } from "../../app/api/castmirror/compare/contracts";

const context: RequestedExecutionContext = {
  zone: 99, encounter: 42, difficulty: 4, className: "Mage", spec: "Arcane", hero: "Sunfury", pi: false,
};
const statusRequest = (updates: Record<string, string | null> = {}) => {
  const q = new URLSearchParams({ zone: "99", encounter: "42", difficulty: "4", className: "Mage", spec: "Arcane", hero: "Sunfury", pi: "false" });
  for (const [key, value] of Object.entries(updates)) { if (value === null) q.delete(key); else q.set(key, value); }
  return new Request("https://hosted.example/api/castmirror/execution/status?" + q);
};

// Instrument the actual imported adapter/routes, including their module setup.
// A call here is a test failure and is blocked before any real network/write.
let network: ReturnType<typeof vi.fn>;
let writes: Array<{ mock: { calls: unknown[][] } }>;
beforeEach(() => {
  network = vi.fn(() => { throw new Error("Hosted availability must not use the network"); });
  vi.stubGlobal("fetch", network);
  const blocked = () => { throw new Error("Hosted availability must not write files or dispatch persistent jobs"); };
  const blockedAsync = async () => blocked();
  writes = [
    vi.spyOn(fs, "writeFileSync").mockImplementation(blocked),
    vi.spyOn(fs, "appendFileSync").mockImplementation(blocked),
    vi.spyOn(fs, "mkdirSync").mockImplementation(blocked),
    vi.spyOn(fs, "renameSync").mockImplementation(blocked),
    vi.spyOn(fs, "createWriteStream").mockImplementation(blocked),
    vi.spyOn(fs, "writeFile").mockImplementation(blocked),
    vi.spyOn(fs, "appendFile").mockImplementation(blocked),
    vi.spyOn(fs, "mkdir").mockImplementation(blocked),
    vi.spyOn(fs.promises, "writeFile").mockImplementation(blockedAsync),
    vi.spyOn(fs.promises, "appendFile").mockImplementation(blockedAsync),
    vi.spyOn(fs.promises, "mkdir").mockImplementation(blockedAsync),
    vi.spyOn(fs.promises, "rename").mockImplementation(blockedAsync),
    vi.spyOn(fs.promises, "copyFile").mockImplementation(blockedAsync),
  ];
  syncBuiltinESMExports();
});
afterEach(() => {
  try {
    assert.equal(network.mock.calls.length, 0, "availability/routes must make zero network calls");
    for (const write of writes) assert.equal(write.mock.calls.length, 0, "availability/routes must make zero filesystem writes");
  } finally {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    vi.unstubAllGlobals();
  }
});

function assertUnavailable(value: Record<string, unknown>) {
  assert.equal(value.state, "unsupported");
  assert.deepEqual(value.capabilities, { build: false, reference: false });
  for (const key of ["scope", "revision", "coverage", "job", "updatedAt"]) assert.equal(value[key], null, `${key} must not invent benchmark metadata`);
  assert.match(String(value.reason), /statistics.*unavailable.*connected/i);
  assert.match((value.reasons as string[]).join(" "), /reachable durable native Execution backend/);
  assert.match((value.reasons as string[]).join(" "), /quota accounting.*retained comparison pins.*durable/);
  assert.doesNotMatch((value.reasons as string[]).join(" "), /catalog|mechanics|top-ten|score-ready/i);
  for (const key of ["comparisonID", "executionReference", "winner", "score", "benchmark"]) assert.equal(key in value, false, key);
}

function assertPrivate(response: Response) {
  assert.match(response.headers.get("Content-Type") ?? "", /application\/json/);
  assert.match(response.headers.get("Cache-Control") ?? "", /private.*no-store/);
  assert.equal(response.headers.get("CDN-Cache-Control"), "no-store");
  assert.equal(response.headers.get("Vercel-CDN-Cache-Control"), "no-store");
}

describe("CastMirror stateless hosted Execution availability", () => {
  test("bare availability has truthful unsupported/null metadata and no synthetic scope", async () => {
    const { getHostedExecutionAvailability } = await import("../../app/api/castmirror/execution/availability");
    const first = getHostedExecutionAvailability();
    assertUnavailable(first);
    assert.equal(first.requestedContext, null);
  });

  test("requested throughput context remains separate from verified Execution scope", async () => {
    const { getHostedExecutionAvailability } = await import("../../app/api/castmirror/execution/availability");
    const first = getHostedExecutionAvailability(context);
    assertUnavailable(first);
    assert.deepEqual(first.requestedContext, context);
    assert.notEqual(first.requestedContext, context);
    first.reasons[0] = "mutated synthetic reason";
    first.requestedContext!.zone = 100;
    const second = getHostedExecutionAvailability(context);
    assertUnavailable(second);
    assert.deepEqual(second.requestedContext, context);
    assert.equal(context.zone, 99);
  });
});

describe("CastMirror actual hosted Execution routes", () => {
  test("status returns HTTP 200 unsupported and validated requested context without network or writes", async () => {
    const { GET } = await import("../../app/api/castmirror/execution/status/route");
    const response = GET(statusRequest());
    assert.equal(response.status, 200);
    assertPrivate(response);
    const value = await response.json();
    assertUnavailable(value);
    assert.deepEqual(value.requestedContext, context);
    assert.equal(value.scope, null, "request scope is not verified Execution scope");
  });

  test("bare status rejects missing encounter with HTTP 400 instead of inventing a context", async () => {
    const { GET } = await import("../../app/api/castmirror/execution/status/route");
    const response = GET(new Request("https://hosted.example/api/castmirror/execution/status"));
    assert.equal(response.status, 400);
    assertPrivate(response);
    assert.match((await response.json()).error, /encounter.*required/);
  });

  for (const zone of [null, "0", ""]) {
    test(`Auto zone ${JSON.stringify(zone)} is unverified null context, never a benchmark scope`, async () => {
      const { GET } = await import("../../app/api/castmirror/execution/status/route");
      const response = GET(statusRequest({ zone }));
      assert.equal(response.status, 200);
      const value = await response.json();
      assertUnavailable(value);
      assert.equal(value.requestedContext.zone, null);
      assert.equal(value.scope, null);
    });
  }

  for (const updates of [
    { encounter: "-1" }, { encounter: "1e2" }, { zone: "2147483648" },
    { difficulty: "2" }, { pi: "yes" }, { className: "M".repeat(65) },
    { spec: "A\u0000rcane" }, { hero: "H".repeat(81) },
  ] as Array<Record<string, string | null>>) {
    test(`invalid contextual status ${JSON.stringify(updates)} is controlled HTTP 400`, async () => {
      const { GET } = await import("../../app/api/castmirror/execution/status/route");
      const response = GET(statusRequest(updates));
      assert.equal(response.status, 400);
      assertPrivate(response);
      const value = await response.json();
      assert.equal(typeof value.error, "string");
      assert.equal("revision" in value, false);
    });
  }

  test("duplicate status IDs are rejected instead of choosing an ambiguous scope", async () => {
    const { GET } = await import("../../app/api/castmirror/execution/status/route");
    const request = statusRequest();
    const response = GET(new Request(request.url + "&encounter=43"));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /once/);
  });

  for (const headers of [
    {},
    { host: "localhost", origin: "http://localhost", "x-forwarded-for": "127.0.0.1", "sec-fetch-site": "same-origin" },
    {
      host: "127.0.0.1", origin: "http://127.0.0.1", "x-forwarded-for": "::1",
      "x-forwarded-host": "localhost", "x-forwarded-proto": "http", "x-real-ip": "127.0.0.1",
      forwarded: "for=127.0.0.1;host=localhost;proto=http",
    },
  ] as Array<Record<string, string>>) {
    test(`refresh is unconditionally HTTP 403 even with forwarding ${JSON.stringify(headers)}`, async () => {
      const { POST } = await import("../../app/api/castmirror/execution/refresh/route");
      const request = new Request("https://hosted.example/api/castmirror/execution/refresh", {
        method: "POST", headers, body: '{"zone":99,"encounter":42,"raid":true,"resume":true}',
      });
      const readBody = vi.spyOn(request, "json");
      // Next supplies the request even to handlers which need no parameters.
      const response: Response = Reflect.apply(POST, undefined, [request]);
      assert.equal(response.status, 403);
      assertPrivate(response);
      const value = await response.json();
      assertUnavailable(value);
      assert.match(value.error, /disabled/);
      assert.equal(readBody.mock.calls.length, 0);
      assert.equal(value.requestedContext, null);
    });
  }

  test("malformed refresh JSON still receives disabled HTTP 403 without parsing a build request", async () => {
    const { POST } = await import("../../app/api/castmirror/execution/refresh/route");
    const request = new Request("https://hosted.example/api/castmirror/execution/refresh", { method: "POST", body: "{not-json" });
    const response: Response = Reflect.apply(POST, undefined, [request]);
    assert.equal(response.status, 403);
    assertUnavailable(await response.json());
  });

  test("reference returns HTTP 409 without hydrating a forged ID/revision or claiming a benchmark", async () => {
    const { GET } = await import("../../app/api/castmirror/execution/reference/route");
    const request = new Request("https://hosted.example/api/castmirror/execution/reference?comparisonID=11111111-1111-4111-8111-111111111111&revision=synthetic-ready");
    const response: Response = Reflect.apply(GET, undefined, [request]);
    assert.equal(response.status, 409);
    assertPrivate(response);
    const value = await response.json();
    assertUnavailable(value);
    assert.match(value.error, /unavailable.*snapshot|snapshot.*unavailable/i);
    assert.match(value.error, /cross-instance/);
  });
});

// Unsupported method dispatch is intentionally not faked here: it is tested by
// the parent's real Next HTTP smoke, which also checks automatic HEAD/OPTIONS.
