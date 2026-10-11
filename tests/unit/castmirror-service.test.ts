import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, vi } from "vitest";
import {
  createCompareHandler, COMPARE_TTL_MS, COMPARE_DEADLINE_MS,
  type CompareHandlerOptions,
} from "../../app/api/castmirror/compare/service";
import { buildComparison } from "../../app/api/castmirror/compare/core.mjs";
import type { ComparisonClient, CompareParams } from "../../app/api/castmirror/compare/contracts";
import { wclFixture, worldCalls } from "../helpers/castmirror-wcl.mjs";
import {
  comparisonFixture, pageFixture, button, spells, state, compareRequests, controlledTimers, deferred,
} from "../helpers/castmirror-page.mjs";

type RankingQuery = { metric: string; xb: string; page: number };
type QueryCall = { query: string; variables: Record<string, unknown> };

function request(updates: Record<string, string | null> = {}, init: RequestInit = {}) {
  const q = new URLSearchParams({ name: "You", server: "Test Realm", region: "us", encounter: "42", difficulty: "4", metric: "dps", zone: "99" });
  for (const [key, value] of Object.entries(updates)) { if (value === null) q.delete(key); else q.set(key, value); }
  return new Request("https://hosted.example/api/castmirror/compare?" + q, init);
}

function comparisonFor(params: CompareParams) {
  const value = comparisonFixture();
  value.encounter.id = params.encounter; value.difficulty = params.difficulty; value.metric = params.metric;
  value.a.name = params.name; value.a.server = params.server;
  if (params.code) { value.a.code = params.code; value.a.fightID = params.fightID; }
  for (const side of [value.a, value.b, value.bossReference.b]) {
    side.scope.encounter = params.encounter; side.scope.difficulty = params.difficulty;
  }
  value.hero.requested = params.hero; value.bossReference.hero.requested = params.hero;
  if (params.metric === "hps") delete value.bossReference;
  return value;
}

function fixtureBuilder() {
  return vi.fn(async (client: ComparisonClient, params: CompareParams) => {
    assert.equal(typeof client.query, "function");
    return comparisonFor(params);
  });
}
function handlerWith(options: CompareHandlerOptions = {}) {
  return createCompareHandler({
    admission: () => true,
    query: async () => { throw new Error("Unexpected query in a response-shape fixture"); },
    ...options,
  });
}
function assertPrivate(response: Response) {
  assert.match(response.headers.get("Content-Type") ?? "", /application\/json/);
  assert.match(response.headers.get("Cache-Control") ?? "", /private.*no-store/);
  assert.equal(response.headers.get("CDN-Cache-Control"), "no-store");
  assert.equal(response.headers.get("Vercel-CDN-Cache-Control"), "no-store");
}
function awaitAbort(signal: AbortSignal, finish: () => void = () => {}) {
  signal.throwIfAborted();
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => { finish(); reject(signal.reason); }, { once: true });
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("A test must not issue real network requests"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("CastMirror actual core/service/page integration", () => {
  test("default builder uses injectable query transport and preserves independent Overall/Boss results", async () => {
    const f = wclFixture();
    const overall = f.entry("Overall", { amount: 2200 });
    const boss = f.entry("Boss", { amount: 1400, casts: [[5, "Arcane Blast"]] });
    f.rankings = ({ metric }: RankingQuery) => [metric === "dps" ? overall : boss];
    const query = vi.fn<NonNullable<CompareHandlerOptions["query"]>>(f.client.query.bind(f.client));
    // Deliberately omit builder: this fails if production wiring uses the obsolete port.
    const handler = handlerWith({ query });
    const response = await handler(request({ name: f.params.name }));
    assert.equal(response.status, 200);
    assertPrivate(response);
    const out = await response.json();
    assert.equal(out.b.name, overall.name);
    assert.equal(out.b.amount, 2200);
    assert.equal(out.bossReference.b.name, boss.name);
    assert.equal(out.bossReference.b.amount, 1400);
    assert.equal(out.bossReference.rankingMetric, "bossdps");
    assert.equal(out.a.actorID, 1);
    assert.deepEqual(out.a.scope, { zone: 99, encounter: 42, difficulty: 4, size: 20 });
    assert.deepEqual(worldCalls(f).map((c: QueryCall) => c.variables.metric).sort(), ["bossdps", "dps"]);
    assert.equal(query.mock.calls.length, f.calls.length);
    for (const call of query.mock.calls) {
      const options = call[2] as { signal: AbortSignal };
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.signal.aborted, true, "invocation cleanup closes every transport signal");
    }
    assert.equal(out.executionStatus.state, "unsupported");
    assert.deepEqual(out.executionStatus.capabilities, { build: false, reference: false });
    assert.equal(out.executionStatus.scope, null);
    assert.equal("comparisonID" in out, false);
  });

  for (const zone of ["0", "", null]) {
    test(`the actual generated page works through the real default handler with Auto zone ${JSON.stringify(zone)}`, async () => {
      const f = wclFixture();
      const overall = f.entry("Overall", { casts: [[0, "Arcane Phoenix"]] });
      const boss = f.entry("Boss", { casts: [[5, "Arcane Splinter"]] });
      f.rankings = ({ metric }: RankingQuery) => [metric === "dps" ? overall : boss];
      const handler = handlerWith({ query: f.client.query.bind(f.client) });
      const clock = controlledTimers();
      let body: Record<string, unknown> | undefined;
      const p = await pageFixture(async (url: URL) => {
        assert.equal(url.pathname, "/api/castmirror/compare");
        const response = await handler(new Request(url));
        body = await response.clone().json();
        return response;
      }, { timers: clock.timers });
      p.nodes.get("name").value = f.params.name;
      p.nodes.get("zone").value = zone ?? "";
      await p.runMirror(42, "Test Boss");
      assert.equal(p.nodes.get("status").textContent, "");
      assert.equal(p.nodes.get("hn1").textContent, f.params.name);
      assert.equal(p.nodes.get("hn2").textContent, overall.name);
      assert.ok(body);
      const availability = body.executionStatus as { requestedContext: { zone: number | null }; scope: null };
      assert.equal(availability.requestedContext.zone, null);
      assert.equal(availability.scope, null);
      const player = state(p, "comparison.a"), count = p.requests.length;
      button(p, "boss").click();
      assert.equal(p.nodes.get("hn2").textContent, boss.name);
      assert.deepEqual(spells(p, "laneB"), ["Arcane Splinter"]);
      assert.deepEqual(state(p, "comparison.a"), player);
      assert.equal(p.requests.length, count);
      assert.equal(compareRequests(p).length, 1);
      assert.equal(button(p, "execution").disabled, true);
      assert.equal(clock.pending.size, 0);
    });
  }

  test("actual thin Next GET uses the hosted core and real WCL/OAuth transport with controlled responses", async () => {
    const f = wclFixture();
    const overall = f.entry("Overall"), boss = f.entry("Boss");
    f.rankings = ({ metric }: RankingQuery) => [metric === "dps" ? overall : boss];
    // Explicitly fake environment values only; no credential file is read or written.
    vi.stubEnv("WCL_CLIENT_ID", "synthetic-test-client-not-a-credential");
    vi.stubEnv("WCL_CLIENT_SECRET", "synthetic-test-secret-not-a-credential");
    const transport = vi.fn(async (url: string, init: RequestInit) => {
      assert.equal(init.cache, "no-store");
      assert.ok(init.signal instanceof AbortSignal);
      if (url.endsWith("/oauth/token")) return Response.json({ access_token: "synthetic-test-token", expires_in: 3600 });
      assert.equal(url, "https://www.warcraftlogs.com/api/v2/client");
      const payload = JSON.parse(String(init.body));
      return Response.json({ data: await f.client.query(payload.query, payload.variables) });
    });
    vi.stubGlobal("fetch", transport);
    const { GET, maxDuration, runtime } = await import("../../app/api/castmirror/compare/route");
    assert.equal(maxDuration, 60);
    assert.equal(runtime, "nodejs");
    const response = await GET(request({ name: f.params.name }));
    assert.equal(response.status, 200);
    assertPrivate(response);
    const out = await response.json();
    assert.equal(out.b.name, overall.name);
    assert.equal(out.bossReference.b.name, boss.name);
    assert.equal(out.executionStatus.state, "unsupported");
    assert.equal("comparisonID" in out, false);
    assert.ok(transport.mock.calls.length > 1);
    const count = transport.mock.calls.length;
    assert.equal((await GET(request({ name: f.params.name }))).status, 200);
    assert.equal(transport.mock.calls.length, count, "the thin route must retain its warm handler instead of recreating the cache");
  });
});

describe("CastMirror request and response validation", () => {
  for (const updates of [
    { name: "" }, { name: " ".repeat(5) }, { name: "N".repeat(65) }, { name: "N\u0000ame" },
    { server: "" }, { server: "R".repeat(129) }, { region: "cn" }, { region: "usa" },
    { metric: "bossdps" }, { difficulty: "2" }, { difficulty: "4.0" }, { hero: "H".repeat(81) },
    { encounter: "0" }, { encounter: "-1" }, { encounter: "1.5" }, { encounter: "1e2" },
    { encounter: "2147483648" }, { encounter: "NaN" }, { encounter: "42junk" },
    { zone: "-1" }, { zone: "1.2" }, { zone: "2147483648" },
    { code: "Player0123456789" }, { fightID: "7" }, { code: "", fightID: "7" },
    { code: "a:private", fightID: "7" }, { code: "Player0123456789", fightID: "0" },
    { code: "Player0123456789", fightID: "1e2" },
  ] as Array<Record<string, string | null>>) {
    test(`invalid request ${JSON.stringify(updates)} is HTTP 400 before builder/query/admission`, async () => {
      const builder = fixtureBuilder(), query = vi.fn(), admission = vi.fn(() => true);
      const response = await handlerWith({ builder, query, admission })(request(updates));
      assert.equal(response.status, 400);
      assertPrivate(response);
      assert.equal(typeof (await response.json()).error, "string");
      assert.equal(builder.mock.calls.length, 0);
      assert.equal(query.mock.calls.length, 0);
      assert.equal(admission.mock.calls.length, 0);
    });
  }

  test("duplicate IDs and oversized URLs are rejected before any work", async () => {
    const builder = fixtureBuilder(), admission = vi.fn(() => true);
    const handler = handlerWith({ builder, admission });
    assert.equal((await handler(new Request(request().url + "&encounter=43"))).status, 400);
    assert.equal((await handler(new Request(request().url + "&extra=" + "x".repeat(4096)))).status, 400);
    assert.equal(builder.mock.calls.length, 0);
    assert.equal(admission.mock.calls.length, 0);
  });

  test("validated parameters trim bounded names and accept supported region/difficulty/metric and paired pins", async () => {
    const builder = fixtureBuilder();
    const response = await handlerWith({ builder })(request({
      name: " Élise ", server: " Test Realm ", region: "EU", difficulty: "5", metric: "hps",
      hero: "San'layn", code: "Player0123456789", fightID: "7",
    }));
    assert.equal(response.status, 200);
    const params = builder.mock.calls[0][1];
    assert.deepEqual(params, {
      name: "Élise", server: "Test Realm", region: "eu", difficulty: 5, metric: "hps", encounter: 42,
      code: "Player0123456789", fightID: 7, hero: "San'layn",
    });
    const out = await response.json();
    assert.equal("bossReference" in out, false);
    assert.equal("bossReferenceError" in out, false);
  });

  test("service rejects non-GET directly; real Next method dispatch is covered separately", async () => {
    const builder = fixtureBuilder(), admission = vi.fn(() => true);
    const response = await handlerWith({ builder, admission })(request({}, { method: "POST", body: "{}" }));
    assert.equal(response.status, 405);
    assert.equal(builder.mock.calls.length, 0);
    assert.equal(admission.mock.calls.length, 0);
  });

  test("untrusted builder Execution metadata/IDs are stripped and replaced with truthful hosted availability", async () => {
    const builder = vi.fn(async (client: ComparisonClient, params: CompareParams) => {
      assert.equal(typeof client.query, "function");
      return {
        ...comparisonFor(params), comparisonID: "synthetic-forged-id", executionReference: { winner: "synthetic" },
        executionStatus: { state: "ready", revision: "synthetic-not-a-benchmark", capabilities: { build: true, reference: true } },
        rawDebug: "synthetic-internal-detail",
      };
    });
    const response = await handlerWith({ builder })(request());
    assert.equal(response.status, 200);
    const out = await response.json();
    for (const key of ["comparisonID", "executionReference", "rawDebug"]) assert.equal(key in out, false);
    assert.equal(out.executionStatus.state, "unsupported");
    assert.deepEqual(out.executionStatus.capabilities, { build: false, reference: false });
    for (const key of ["scope", "revision", "coverage", "job", "updatedAt"]) assert.equal(out.executionStatus[key], null);
  });

  for (const mutation of ["missing actor", "wrong encounter", "zero duration", "non-kill", "malformed casts", "non-finite amount", "wrong pin"]) {
    test(`${mutation} required builder output becomes safe HTTP 502 and is never cached`, async () => {
      const builder = vi.fn(async (client: ComparisonClient, params: CompareParams) => {
        assert.equal(typeof client.query, "function");
        const out = comparisonFor(params);
        if (mutation === "missing actor") out.a.actorID = null;
        if (mutation === "wrong encounter") out.a.scope.encounter = 43;
        if (mutation === "zero duration") out.b.durSec = 0;
        if (mutation === "non-kill") out.a.kill = false;
        if (mutation === "malformed casts") out.a.casts = [[NaN, "Fireball"]];
        if (mutation === "non-finite amount") out.b.amount = Infinity;
        if (mutation === "wrong pin") out.a.fightID = 9;
        return out;
      });
      const handler = handlerWith({ builder });
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await handler(request(mutation === "wrong pin" ? { code: "Player0123456789", fightID: "7" } : {}));
        assert.equal(response.status, 502);
        assertPrivate(response);
        assert.match((await response.json()).error, /incomplete|incompatible/i);
      }
      assert.equal(builder.mock.calls.length, 2);
    });
  }

  test("malformed required upstream stream fails safely through the real builder, not an empty-stream fallback", async () => {
    const f = wclFixture();
    const top = f.entry("Top"); f.rankings = () => [top];
    const query = f.client.query.bind(f.client);
    const handler = handlerWith({ query: async (document, variables = {}) => {
      const out = await query(document, variables);
      if (variables.code === f.player.report.code && document.includes("dataType: Casts")) {
        delete out.reportData.report.events.nextPageTimestamp;
      }
      return out;
    } });
    const response = await handler(request({ name: f.params.name }));
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /incomplete|incompatible/i);
  });

  test("missing output/PI evidence is not silently accepted as zero damage/no external buffs", async () => {
    for (const missing of ["table", "PI"]) {
      const f = wclFixture(); const top = f.entry("Top"); f.rankings = () => [top];
      const query = f.client.query.bind(f.client);
      const handler = handlerWith({ query: async (document, variables = {}) => {
        const out = await query(document, variables);
        if (variables.code === f.player.report.code && (
          (missing === "table" && document.includes("dataType: DamageDone")) ||
          (missing === "PI" && document.includes("abilityID: $aid"))
        )) {
          if (missing === "table") delete out.reportData.report.table.data.entries;
          else delete out.reportData.report.events;
        }
        return out;
      } });
      const response = await handler(request({ name: f.params.name }));
      assert.equal(response.status, 502, missing);
      assert.match((await response.json()).error, /incomplete|incompatible/i);
    }
  });

  for (const [label, maximum] of [["missing", undefined], ["explicit undefined", undefined], ["null", null], ["valid", 100]] as const) {
    test(`optional classResources.max ${label} succeeds through actual validation/core without mutating raw snapshots`, async () => {
      const f = wclFixture(); const top = f.entry("Top"); f.rankings = () => [top];
      const underlying = f.client.query.bind(f.client);
      const captured: Array<{ raw: Record<string, unknown>; before: Record<string, unknown> }> = [];
      const handler = handlerWith({ query: async (document, variables = {}) => {
        const out = await underlying(document, variables);
        if (variables.code === f.player.report.code && document.includes("dataType: Casts")) {
          for (const event of out.reportData.report.events.data) {
            const raw: Record<string, unknown> = event.classResources[0];
            if (label === "missing") delete raw.max; else raw.max = maximum;
            captured.push({ raw: Object.freeze(raw), before: structuredClone(raw) });
          }
        }
        return out;
      } });
      const response = await handler(request({ name: f.params.name }));
      assert.equal(response.status, 200); assertPrivate(response);
      const out = await response.json();
      assert.equal(out.a.resources["0"].max, label === "valid" ? 100 : 0, "the canonical aggregate supplies its existing numeric fallback");
      assert.equal(out.a.resources["0"].spentSnap, 10);
      assert.ok(captured.length > 0);
      for (const { raw, before } of captured) {
        assert.deepEqual(raw, before); assert.equal(Object.isFrozen(raw), true);
        assert.equal(Object.hasOwn(raw, "max"), label !== "missing");
        assert.equal(raw.max, maximum);
      }
    });
  }

  for (const [label, maximum] of [["negative", -1], ["numeric string", "100"], ["NaN", NaN], ["Infinity", Infinity], ["object", {}], ["boolean", true]] as const) {
    test(`provided malformed classResources.max ${label} remains a safe uncached failure, never coerced or mutated`, async () => {
      const f = wclFixture(); const top = f.entry("Top"); f.rankings = () => [top];
      const underlying = f.client.query.bind(f.client);
      const captured: Array<{ raw: Record<string, unknown>; before: Record<string, unknown> }> = [];
      const handler = handlerWith({ query: async (document, variables = {}) => {
        const out = await underlying(document, variables);
        if (variables.code === f.player.report.code && document.includes("dataType: Casts")) {
          for (const event of out.reportData.report.events.data) {
            const raw: Record<string, unknown> = event.classResources[0]; raw.max = maximum;
            captured.push({ raw: Object.freeze(raw), before: structuredClone(raw) });
          }
        }
        return out;
      } });
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await handler(request({ name: f.params.name }));
        assert.equal(response.status, 502); assertPrivate(response);
        assert.match((await response.json()).error, /incomplete|incompatible/);
      }
      assert.ok(captured.length >= 2, "invalid snapshots must not produce a warm success");
      for (const { raw, before } of captured) assert.deepEqual(raw, before);
    });
  }

  test("actual default handler preserves realm-specific player/reference PI and hero identity", async () => {
    const f = wclFixture({ playerPI: true, playerHero: "Sunfury" });
    f.entry("EarlierPlayerNamesake", { name: f.params.name, code: f.player.report.code, server: "Other Realm", prepend: true, pi: false, hero: "Spellslinger" });
    const overall = f.entry("Namesake", { server: "Red Realm", pi: true, hero: "Spellslinger" });
    const boss = f.entry("Namesake", { name: overall.name, code: overall.report.code, server: "Blue Realm", pi: false, hero: "Sunfury" });
    f.rankings = ({ metric }: RankingQuery) => [metric === "dps" ? overall : boss];
    const response = await handlerWith({ query: f.client.query.bind(f.client) })(request({ name: f.params.name }));
    assert.equal(response.status, 200); assertPrivate(response);
    const out = await response.json();
    assert.equal(out.a.actorID, f.actorFor(f.player).id); assert.equal(out.hero.a, "Sunfury");
    assert.deepEqual(out.pi, { a: true, b: true, excluded: false });
    assert.deepEqual(out.bossReference.pi, { a: true, b: false, excluded: false });
    assert.equal(out.b.actorID, f.actorFor(overall).id); assert.equal(out.bossReference.b.actorID, f.actorFor(boss).id);
    assert.equal(out.hero.b, "Spellslinger"); assert.equal(out.bossReference.hero.b, "Sunfury");
    assert.deepEqual(worldCalls(f).map((call: QueryCall) => call.variables.xb), ["Any", "Any"]);
  });

  test("raw upstream failures are sanitized and failed requests are retried instead of cached", async () => {
    const internal = "synthetic-private-debug token=NOT_A_REAL_TOKEN <script>alert(1)</script>";
    const builder = vi.fn(async () => { throw new Error(internal); });
    const handler = handlerWith({ builder });
    for (let i = 0; i < 2; i++) {
      const response = await handler(request());
      assert.equal(response.status, 502);
      const value = await response.json();
      assert.equal(typeof value.error, "string");
      assert.ok(!JSON.stringify(value).includes(internal));
      assert.doesNotMatch(value.error, /NOT_A_REAL_TOKEN|<script>|private-debug/);
    }
    assert.equal(builder.mock.calls.length, 2);
  });
});

describe("CastMirror bounded warm caches, admission and cold instances", () => {
  test("complete comparisons cache for exactly ten minutes, without shared HTTP caching", async () => {
    assert.equal(COMPARE_TTL_MS, 600000);
    assert.ok(COMPARE_DEADLINE_MS < 60000);
    let now = 0;
    const builder = fixtureBuilder(), admission = vi.fn(() => true);
    const handler = handlerWith({ builder, admission, clock: () => now });
    const first = await handler(request()); assertPrivate(first);
    const firstBody = await first.json();
    now = 599999;
    const hit = await handler(request()); assertPrivate(hit);
    assert.deepEqual(await hit.json(), firstBody);
    assert.equal(builder.mock.calls.length, 1);
    assert.equal(admission.mock.calls.length, 1, "warm hits must not spend fresh admission");
    now = 600000;
    assert.equal((await handler(request())).status, 200);
    assert.equal(builder.mock.calls.length, 2);
    assert.equal(admission.mock.calls.length, 2);
  });

  test("injectable cache TTL expires at its boundary and a backwards clock never extends a hit", async () => {
    let now = 100;
    const builder = fixtureBuilder();
    const handler = handlerWith({ builder, cacheTtlMs: 10, clock: () => now });
    await handler(request());
    now = 109; await handler(request()); assert.equal(builder.mock.calls.length, 1);
    now = 110; await handler(request()); assert.equal(builder.mock.calls.length, 2);
    now = 99; await handler(request()); assert.equal(builder.mock.calls.length, 3);
  });

  test("entry-bounded cache evicts least-recently-used comparisons", async () => {
    const builder = fixtureBuilder();
    const handler = handlerWith({ builder, maxCacheEntries: 2 });
    await handler(request({ name: "First" }));
    await handler(request({ name: "Second" }));
    await handler(request({ name: "First" }));
    await handler(request({ name: "Third" }));
    assert.equal(builder.mock.calls.length, 3);
    await handler(request({ name: "First" }));
    assert.equal(builder.mock.calls.length, 3);
    await handler(request({ name: "Second" }));
    assert.equal(builder.mock.calls.length, 4);
  });

  test("oversized comparisons are returned but not retained above the byte limit", async () => {
    const builder = fixtureBuilder();
    const handler = handlerWith({ builder, maxCacheBytes: 1 });
    assert.equal((await handler(request())).status, 200);
    assert.equal((await handler(request())).status, 200);
    assert.equal(builder.mock.calls.length, 2);
  });

  test("cache keys separate player, fight pin, hero, metric, and requested zone contexts", async () => {
    const builder = fixtureBuilder();
    const handler = handlerWith({ builder });
    for (const updates of [
      {}, { name: "Other" }, { code: "Player0123456789", fightID: "7" },
      { hero: "Spellslinger" }, { metric: "hps" }, { zone: "100" },
    ] as Array<Record<string, string | null>>) await handler(request(updates));
    assert.equal(builder.mock.calls.length, 6);
    for (const updates of [
      {}, { name: "Other" }, { code: "Player0123456789", fightID: "7" },
      { hero: "Spellslinger" }, { metric: "hps" }, { zone: "100" },
    ] as Array<Record<string, string | null>>) await handler(request(updates));
    assert.equal(builder.mock.calls.length, 6);
  });

  test("a cold handler rebuilds throughput and has no retained comparison ID or Execution hydration", async () => {
    const f = wclFixture(); const top = f.entry("Top"); f.rankings = () => [top];
    const query = vi.fn<NonNullable<CompareHandlerOptions["query"]>>(f.client.query.bind(f.client));
    const warm = handlerWith({ query }), cold = handlerWith({ query });
    const r = request({ name: f.params.name });
    const first = await warm(r); assert.equal(first.status, 200);
    const firstCount = query.mock.calls.length;
    assert.equal((await warm(request({ name: f.params.name }))).status, 200);
    assert.equal(query.mock.calls.length, firstCount);
    const out = await (await cold(request({ name: f.params.name }))).json();
    assert.ok(query.mock.calls.length > firstCount);
    assert.equal(out.a.name, f.params.name);
    assert.equal("comparisonID" in out, false);
    assert.equal("executionReference" in out, false);
    assert.equal(out.executionStatus.revision, null);
  });

  test("independent Boss failure is safe HTTP 200, retried until complete, then warmed", async () => {
    const f = wclFixture(); const overall = f.entry("Overall"), boss = f.entry("Boss");
    let broken = true;
    f.rankings = ({ metric }: RankingQuery) => {
      if (metric === "bossdps" && broken) throw new Error("synthetic Boss service failure NOT_A_REAL_TOKEN");
      return [metric === "bossdps" ? boss : overall];
    };
    const handler = handlerWith({ query: f.client.query.bind(f.client) });
    const first = await handler(request({ name: f.params.name }));
    assert.equal(first.status, 200);
    const partial = await first.json();
    assert.equal(partial.b.name, overall.name);
    assert.equal(partial.bossReference, null);
    assert.match(partial.bossReferenceError, /unavailable.*Overall|Overall.*available/);
    assert.doesNotMatch(partial.bossReferenceError, /NOT_A_REAL_TOKEN/);
    broken = false;
    const second = await handler(request({ name: f.params.name }));
    assert.equal(second.status, 200);
    assert.equal((await second.json()).bossReference.b.name, boss.name);
    const count = f.calls.length;
    const third = await handler(request({ name: f.params.name }));
    assert.equal(third.status, 200);
    assert.equal((await third.json()).bossReference.b.name, boss.name);
    assert.equal(f.calls.length, count);
  });

  test("admission rejects fresh work but allows a complete warm hit, and admission failures are controlled", async () => {
    let allowed = true;
    const builder = fixtureBuilder(), admission = vi.fn(() => allowed);
    const handler = handlerWith({ builder, admission });
    assert.equal((await handler(request())).status, 200);
    allowed = false;
    assert.equal((await handler(request())).status, 200);
    assert.equal((await handler(request({ name: "Other" }))).status, 429);
    assert.equal(builder.mock.calls.length, 1);
    const failed = handlerWith({ builder, admission: () => { throw new Error("synthetic internal admission error"); } });
    const response = await failed(request());
    assert.equal(response.status, 503);
    assert.doesNotMatch((await response.json()).error, /internal admission error/);
  });

  test("unsafe deadline/TTL options cannot expand the hosted budget", () => {
    for (const options of [{ deadlineMs: 0 }, { deadlineMs: 60000 }, { cacheTtlMs: 600001 }, { cacheTtlMs: 0 }, { maxCacheEntries: 0 }, { maxCacheBytes: 0 }]) {
      assert.throws(() => handlerWith(options), RangeError);
    }
  });
});

describe("CastMirror cancellation, deadlines and settled work", () => {
  test("a pre-aborted request is HTTP 499 without builder/query/admission work", async () => {
    const controller = new AbortController(); controller.abort();
    const builder = fixtureBuilder(), admission = vi.fn(() => true), query = vi.fn();
    const response = await handlerWith({ builder, query, admission })(request({}, { signal: controller.signal }));
    assert.equal(response.status, 499);
    assert.equal(builder.mock.calls.length, 0);
    assert.equal(query.mock.calls.length, 0);
    assert.equal(admission.mock.calls.length, 0);
  });

  test("caller cancellation aborts and settles outstanding transport before HTTP 499", async () => {
    const started = deferred(); let active = 0, settled = 0;
    const signals: AbortSignal[] = [];
    const query: NonNullable<CompareHandlerOptions["query"]> = async (_document, _variables, options) => {
      assert.ok(options?.signal); signals.push(options.signal);
      active++; started.resolve(undefined);
      return awaitAbort(options.signal, () => { active--; settled++; });
    };
    const builder: NonNullable<CompareHandlerOptions["builder"]> = async (client, params) => {
      await client.query("query SyntheticPending");
      return comparisonFor(params);
    };
    const controller = new AbortController();
    const pending = handlerWith({ builder, query })(request({}, { signal: controller.signal }));
    await started.promise;
    controller.abort();
    const response = await pending;
    assert.equal(response.status, 499);
    assert.equal(active, 0);
    assert.equal(settled, 1);
    assert.ok(signals.every((signal) => signal.aborted));
    assert.match((await response.json()).error, /canceled/);
  });

  test("required-query deadline aborts transport and settles it before safe HTTP 504", async () => {
    vi.useFakeTimers();
    const started = deferred(); let active = 0;
    const query: NonNullable<CompareHandlerOptions["query"]> = async (_document, _variables, options) => {
      assert.ok(options?.signal); active++; started.resolve(undefined);
      return awaitAbort(options.signal, () => active--);
    };
    const builder: NonNullable<CompareHandlerOptions["builder"]> = async (client, params) => {
      await client.query("query SyntheticPending");
      return comparisonFor(params);
    };
    const pending = handlerWith({ builder, query, deadlineMs: 25 })(request());
    await started.promise;
    await vi.advanceTimersByTimeAsync(25);
    const response = await pending;
    assert.equal(response.status, 504);
    assert.equal(active, 0);
    assert.match((await response.json()).error, /deadline/);
    assert.equal(vi.getTimerCount(), 0);
  });

  test("required branch failure aborts an independent in-flight branch before returning and prevents follow-up queries", async () => {
    let active = 0, settled = false;
    const query = vi.fn<NonNullable<CompareHandlerOptions["query"]>>(async (_document, _variables, options) => {
      assert.ok(options?.signal); active++;
      return awaitAbort(options.signal, () => { active--; settled = true; });
    });
    let lateRejected = false;
    const builder: NonNullable<CompareHandlerOptions["builder"]> = async (client) => {
      void client.query("query SyntheticIndependentBoss").catch(async () => {
        try { await client.query("query MustNotDispatchAfterAbort"); } catch { lateRejected = true; }
      });
      throw new Error("synthetic required branch failure");
    };
    const response = await handlerWith({ builder, query })(request());
    assert.equal(response.status, 502);
    assert.equal(active, 0);
    assert.equal(settled, true);
    assert.equal(query.mock.calls.length, 1);
    assert.equal(lateRejected, true);
  });

  test("the actual core's required Overall failure settles an already-started independent Boss query before returning", async () => {
    const f = wclFixture(); const overall = f.entry("Overall"), boss = f.entry("Boss");
    f.rankings = ({ metric }: RankingQuery) => [metric === "dps" ? overall : boss];
    const bossStarted = deferred(); let broken = true, active = 0, settled = 0;
    const underlying = f.client.query.bind(f.client);
    const query = vi.fn<NonNullable<CompareHandlerOptions["query"]>>(async (document, variables = {}, options) => {
      assert.ok(options?.signal);
      if (broken && document.includes("characterRankings")) {
        if (variables.metric === "bossdps") {
          active++; bossStarted.resolve(undefined);
          return awaitAbort(options.signal, () => { active--; settled++; });
        }
        await bossStarted.promise;
        throw new Error("synthetic required Overall failure NOT_A_REAL_TOKEN");
      }
      return underlying(document, variables);
    });
    const handler = handlerWith({ query }); // Real generated core is the default builder.
    const response = await handler(request({ name: f.params.name }));
    assert.equal(response.status, 502);
    assert.equal(active, 0); assert.equal(settled, 1);
    assert.doesNotMatch((await response.json()).error, /NOT_A_REAL_TOKEN|synthetic required/);
    assert.ok(query.mock.calls.every((call) => call[2]?.signal?.aborted));
    broken = false;
    const retry = await handler(request({ name: f.params.name }));
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).bossReference.b.name, boss.name);
  });

  test("a builder returning with unfinished work still aborts/settles it and does not cache the result", async () => {
    let active = 0;
    const query: NonNullable<CompareHandlerOptions["query"]> = async (_document, _variables, options) => {
      assert.ok(options?.signal); active++;
      return awaitAbort(options.signal, () => active--);
    };
    const builder = vi.fn(async (client: ComparisonClient, params: CompareParams) => {
      void client.query("query SyntheticDangling").catch(() => {});
      return comparisonFor(params);
    });
    const handler = handlerWith({ builder, query });
    assert.equal((await handler(request())).status, 200);
    assert.equal(active, 0);
    assert.equal((await handler(request())).status, 200);
    assert.equal(active, 0);
    assert.equal(builder.mock.calls.length, 2);
  });

  test("Boss-only deadline preserves completed Overall with a partial response and never warms it", async () => {
    vi.useFakeTimers();
    const f = wclFixture(); const overall = f.entry("Overall"), boss = f.entry("Boss");
    f.rankings = ({ metric }: RankingQuery) => [metric === "dps" ? overall : boss];
    const overallDone = deferred(); let active = 0;
    const underlying = f.client.query.bind(f.client);
    const query: NonNullable<CompareHandlerOptions["query"]> = async (document, variables = {}, options) => {
      assert.ok(options?.signal);
      if (document.includes("characterRankings") && variables.metric === "bossdps") {
        active++; return awaitAbort(options.signal, () => active--);
      }
      const out = await underlying(document, variables);
      if (variables.code === overall.report.code && document.includes("dataType: Buffs")) overallDone.resolve(undefined);
      return out;
    };
    const builder = vi.fn(buildComparison);
    const handler = handlerWith({ builder, query, deadlineMs: 25 });
    const first = handler(request({ name: f.params.name }));
    await overallDone.promise;
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);
    const response = await first;
    assert.equal(response.status, 200);
    const out = await response.json();
    assert.equal(out.b.name, overall.name);
    assert.equal(out.bossReference, null);
    assert.match(out.bossReferenceError, /unavailable/);
    assert.equal(active, 0);
    const next = handler(request({ name: f.params.name }));
    await vi.advanceTimersByTimeAsync(25);
    assert.equal((await next).status, 200);
    assert.equal(builder.mock.calls.length, 2);
    assert.equal(vi.getTimerCount(), 0);
  });
});
