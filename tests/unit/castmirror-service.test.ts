import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, vi } from "vitest";
import {
  createCompareHandler, COMPARE_TTL_MS, COMPARE_DEADLINE_MS,
  type CompareHandlerOptions,
} from "../../app/api/castmirror/compare/service";
import { buildComparison } from "../../app/api/castmirror/compare/core.mjs";
import { ComparisonDataError, type ComparisonClient, type CompareParams } from "../../app/api/castmirror/compare/contracts";
import { LogServiceError } from "../../app/api/castmirror/lib";
import { wclFixture, worldCalls, talents } from "../helpers/castmirror-wcl.mjs";
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
        const out = await response.json();
        assert.equal(out.error, new ComparisonDataError().message);
        const labels: Record<string, string> = {
          "missing actor": "normalized.player.identity", "wrong encounter": "normalized.player.scope",
          "zero duration": "normalized.overall.fight", "non-kill": "normalized.player.fight",
          "malformed casts": "normalized.player.casts", "non-finite amount": "normalized.overall.ranking",
          "wrong pin": "normalized.requested-pin",
        };
        assert.equal(out.diagnostic, labels[mutation]);
        assert.deepEqual(Object.keys(out).sort(), ["diagnostic", "error"]);
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
    assertPrivate(response);
    const out = await response.json();
    assert.equal(out.error, new ComparisonDataError().message);
    assert.equal(out.diagnostic, "upstream.casts.pagination");
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
      assertPrivate(response);
      const out = await response.json();
      assert.equal(out.error, new ComparisonDataError().message);
      assert.equal(out.diagnostic, missing === "table" ? "upstream.damage.entries" : "upstream.pi.envelope");
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

  for (const mutation of [
    "unnamed unrelated actor", "signed snapshot type", "null snapshot", "empty snapshot", "untyped snapshot",
    "untyped resource event", "signed resource event", "unmirrorable ranking", "zero-ID unused ability",
    "unnamed zero-damage row", "unnamed non-lust aura", "unrelated aura bands", "null zone", "minimum snapshot type", "minimum resource event",
  ]) {
    test(`supported or ignored raw shape: ${mutation} succeeds through the default hosted handler`, async () => {
      const f = wclFixture(); const overall = f.entry("Overall"), boss = f.entry("Boss");
      f.rankings = ({ metric }: RankingQuery) => [metric === "dps" ? overall : boss];
      const updates = { name: f.params.name, code: f.player.report.code, fightID: String(f.player.report.fightID) };
      const baselineResponse = await handlerWith({ query: f.client.query.bind(f.client) })(request(updates));
      assert.equal(baselineResponse.status, 200);
      const baseline = await baselineResponse.json();
      let mutations = 0;
      const underlying = f.client.query.bind(f.client);
      const handler = handlerWith({ query: async (document, variables = {}) => {
        const out = await underlying(document, variables);
        const report = out.reportData?.report;
        if (mutation === "unmirrorable ranking" && document.includes("characterRankings")) {
          out.worldData.encounter.characterRankings.rankings.push(Object.freeze({ name: null, report: null })); mutations++;
        }
        if (variables.code !== f.player.report.code) return out;
        if (mutation === "unnamed unrelated actor" && document.includes("masterData")) {
          report.masterData.actors.push(Object.freeze({ id: 999, name: null, server: null })); mutations++;
        }
        if (mutation === "zero-ID unused ability" && document.includes("abilities {")) {
          report.masterData.abilities.push(Object.freeze({ gameID: 0, name: null })); mutations++;
        }
        if (document.includes("dataType: Casts")) {
          const resource = mutation === "signed snapshot type" || mutation === "minimum snapshot type"
            ? { type: mutation === "minimum snapshot type" ? -2147483648 : -1, amount: 100, max: 100 }
            : mutation === "null snapshot" ? null : mutation === "empty snapshot" ? {}
              : mutation === "untyped snapshot" ? { type: null } : undefined;
          if (resource !== undefined) {
            for (const event of report.events.data) event.classResources.push(resource === null ? null : Object.freeze(resource));
            mutations++;
          }
        }
        if (["untyped resource event", "signed resource event", "minimum resource event"].includes(mutation) && document.includes("dataType: Resources")) {
          report.events.data.push(Object.freeze({ type: "resourcechange", resourceChangeType: mutation === "minimum resource event"
            ? -2147483648 : mutation === "signed resource event" ? -1 : null, resourceChange: 50, waste: 5 })); mutations++;
        }
        if (mutation === "unnamed zero-damage row" && document.includes("dataType: DamageDone")) {
          report.table.data.entries.push(Object.freeze({ name: null, total: 0 })); mutations++;
        }
        if ((mutation === "unnamed non-lust aura" || mutation === "unrelated aura bands") && document.includes("table(dataType: Buffs")) {
          report.table.data.auras.push(Object.freeze({ name: mutation === "unrelated aura bands" ? "Unrelated Buff" : null,
            bands: mutation === "unrelated aura bands" ? "not consumed by the comparison" : null })); mutations++;
        }
        if (mutation === "null zone" && document.includes("zone {")) { report.zone = null; mutations++; }
        return out;
      } });
      const response = await handler(request(updates));
      assert.equal(response.status, 200); assertPrivate(response);
      const out = await response.json();
      assert.ok(mutations > 0, "the default builder must exercise the raw mutation");
      assert.equal(out.a.actorID, f.actorFor(f.player).id);
      assert.equal(out.a.code, f.player.report.code); assert.equal(out.a.fightID, f.player.report.fightID);
      assert.equal(out.b.name, overall.name); assert.equal(out.bossReference.b.name, boss.name);
      assert.equal(out.bossReference.rankingMetric, "bossdps");
      assert.equal("bossReferenceError" in out, false);
      assert.equal(out.executionStatus.state, "unsupported");
      assert.deepEqual(out.executionStatus.capabilities, { build: false, reference: false });
      if (mutation === "signed snapshot type" || mutation === "minimum snapshot type") {
        baseline.a.resources[mutation === "minimum snapshot type" ? "-2147483648" : "-1"] = { max: 100, spentSnap: 0, gained: 0, waste: 0, series: [[0, 100], [10, 100]] };
      } else if (mutation === "signed resource event" || mutation === "minimum resource event") {
        baseline.a.resources[mutation === "minimum resource event" ? "-2147483648" : "-1"] = { max: 0, spentSnap: 0, gained: 50, waste: 5, series: [] };
      } else if (mutation === "null zone") { baseline.a.scope.zone = null; }
      assert.deepEqual(out, baseline, "ignored metadata cannot alter or invent comparison evidence");
    });
  }

  test("recent-report discovery ignores unused nullable fight timing without changing the selected kill", async () => {
    const f = wclFixture(); const top = f.entry("Top"); f.rankings = () => [top]; f.ranks = [];
    const underlying = f.client.query.bind(f.client);
    let discovery = 0;
    const response = await handlerWith({ query: async (document, variables = {}) => {
      if (document.includes("recentReports")) return { characterData: { character: { recentReports: { data: [{ code: f.player.report.code }] } } } };
      const out = await underlying(document, variables);
      if (document.includes("killType: Kills")) {
        out.reportData.report.fights.unshift({ id: 2, encounterID: 43, difficulty: 4, startTime: null }); discovery++;
      }
      return out;
    } })(request({ name: f.params.name }));
    assert.equal(response.status, 200); assertPrivate(response);
    const out = await response.json();
    assert.equal(discovery, 1);
    assert.equal(out.a.code, f.player.report.code); assert.equal(out.a.fightID, f.player.report.fightID);
    assert.equal(out.a.actorID, f.actorFor(f.player).id); assert.equal(out.a.amount, 1000);
    assert.equal(out.b.name, top.name); assert.equal(out.bossReference.b.name, top.name);
  });

  test("query-level fixtures expose only report fields selected by the actual comparison documents", async () => {
    const f = wclFixture({ playerHero: "Sunfury" });
    const entries = [
      f.entry("SunA", { hero: "Sunfury", talents: talents(100) }),
      f.entry("SunB", { hero: "Sunfury", talents: talents(100) }),
      f.entry("SpellA", { hero: "Spellslinger", talents: talents(200) }),
      f.entry("SpellB", { hero: "Spellslinger", talents: talents(200) }),
    ];
    f.rankings = () => entries;
    const underlying = f.client.query.bind(f.client);
    let heads = 0;
    const response = await handlerWith({ query: async (document, variables = {}) => {
      const out = await underlying(document, variables);
      if (document.includes("masterData")) {
        const report = out.reportData.report; heads++;
        for (const [field, selected] of [["visibility", /\bvisibility\b/.test(document)], ["zone", document.includes("zone {")],
          ["fights", document.includes("fights(")]] as const) {
          assert.equal(Object.hasOwn(report, field), selected, `unsolicited or missing report.${field}`);
        }
        assert.equal(Object.hasOwn(report.masterData, "abilities"), document.includes("abilities {"));
      }
      return out;
    } })(request({ name: f.params.name }));
    assert.equal(response.status, 200); assert.ok(heads >= 3);
  });

  for (const [label, name] of [["null", null], ["array", ["Arcane Phoenix"]], ["object", { signature: "Arcane Phoenix" }]] as const) {
    test(`zero-total hero-probe row with ${label} name cannot invent a hero vote`, async () => {
      const f = wclFixture({ playerHero: "Sunfury" });
      const entries = [
        f.entry("SunA", { hero: "Sunfury", talents: talents(100) }), f.entry("SunB", { hero: "Sunfury", talents: talents(100) }),
        f.entry("SpellA", { hero: "Spellslinger", talents: talents(200) }), f.entry("SpellB", { hero: "Spellslinger", talents: talents(200) }),
      ];
      f.rankings = () => entries;
      const underlying = f.client.query.bind(f.client);
      const baselineResponse = await handlerWith({ query: underlying })(request({ name: f.params.name }));
      assert.equal(baselineResponse.status, 200);
      const baseline = await baselineResponse.json(); let mutations = 0;
      const response = await handlerWith({ query: async (document, variables = {}) => {
        const out = await underlying(document, variables);
        if (variables.code === entries[2].report.code && document.includes("dataType: DamageDone")) {
          out.reportData.report.table.data.entries.push(Object.freeze({ name, total: 0 })); mutations++;
        }
        return out;
      } })(request({ name: f.params.name }));
      assert.ok(mutations > 0, "the raw row must reach the candidate hero probe");
      assertPrivate(response);
      if (name === null) {
        assert.equal(response.status, 200);
        const out = await response.json(); assert.deepEqual(out, baseline);
        assert.equal(out.b.name, entries[0].name); assert.equal(out.bossReference.b.name, entries[0].name);
      } else {
        assert.equal(response.status, 502);
        assert.match((await response.json()).error, /incomplete|incompatible/);
      }
    });
  }

  for (const [mutation, field, value] of [
    ["typed snapshot missing amount", "amount", undefined], ["typed snapshot negative amount", "amount", -1],
    ["typed snapshot string amount", "amount", "100"], ["typed snapshot nonfinite amount", "amount", NaN],
    ["typed snapshot string type", "type", "-1"], ["typed snapshot fractional type", "type", 0.5],
    ["typed snapshot positive overflow", "type", 2147483648], ["typed snapshot negative overflow", "type", -2147483649],
    ["resource event positive overflow", "resourceChangeType", 2147483648], ["resource event negative overflow", "resourceChangeType", -2147483649],
    ["resource event string type", "resourceChangeType", "-1"], ["resource event nonfinite gain", "resourceChange", Infinity],
    ["resource event string gain", "resourceChange", "50"], ["resource event negative waste", "waste", -1],
    ["usable ranking nonfinite amount", "amount", NaN], ["usable ranking missing fight", "fightID", undefined],
    ["usable ranking malformed talents", "talents", [{ talentID: "100" }]],
    ["consumed damage missing name", "name", null], ["consumed damage negative total", "total", -1],
    ["consumed lust malformed bands", "bands", "invalid"], ["consumed lust nonfinite start", "startTime", NaN],
    ["consumed lust reversed window", "endTime", 1],
    ["selected actor missing ID", "id", null], ["selected actor unnamed", "name", null],
    ["selected report nonpublic", "visibility", "private"], ["selected fight wrong encounter", "encounterID", 43],
    ["selected fight wrong difficulty", "difficulty", 5], ["selected fight zero duration", "endTime", 100000],
    ["selected fight non-kill", "kill", false],
  ] as const) {
    test(`consumed raw evidence remains a safe uncached failure: ${mutation}`, async () => {
      const f = wclFixture(); const top = f.entry("Top"); f.rankings = () => [top];
      const underlying = f.client.query.bind(f.client); let mutations = 0;
      const rankingBefore = structuredClone(top);
      const handler = handlerWith({ query: async (document, variables = {}) => {
        const out = await underlying(document, variables);
        if (mutation.startsWith("usable ranking") && document.includes("characterRankings") && variables.metric === "dps") {
          const rank = out.worldData.encounter.characterRankings.rankings[0];
          out.worldData.encounter.characterRankings.rankings[0] = field === "fightID"
            ? { ...rank, report: { ...rank.report, fightID: value } } : { ...rank, [field]: value };
          mutations++;
        }
        if (variables.code !== f.player.report.code) return out;
        const report = out.reportData.report;
        if (mutation.startsWith("typed snapshot") && document.includes("dataType: Casts")) {
          report.events.data[0].classResources[0][field] = value; mutations++;
        }
        if (mutation.startsWith("resource event") && document.includes("dataType: Resources")) {
          report.events.data[0][field] = value; mutations++;
        }
        if (mutation.startsWith("consumed damage") && document.includes("dataType: DamageDone")) {
          report.table.data.entries[0][field] = value; mutations++;
        }
        if (mutation.startsWith("consumed lust") && document.includes("table(dataType: Buffs")) {
          const aura = report.table.data.auras[0];
          if (field === "bands") aura.bands = value; else aura.bands[0][field] = value;
          mutations++;
        }
        if (mutation.startsWith("selected actor") && document.includes("abilities {")) {
          report.masterData.actors[0][field] = value; mutations++;
        }
        if (mutation.startsWith("selected report") && document.includes("visibility")) { report[field] = value; mutations++; }
        if (mutation.startsWith("selected fight") && document.includes("endTime kill")) { report.fights[0][field] = value; mutations++; }
        return out;
      } });
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await handler(request({ name: f.params.name }));
        assert.equal(response.status, 502, mutation); assertPrivate(response);
        assert.match((await response.json()).error, /incomplete|incompatible|identity/i);
      }
      assert.ok(mutations >= 2, "malformed consumed evidence cannot become a cached success");
      assert.deepEqual(top, rankingBefore, "response mutations must not contaminate shared ranking fixtures");
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
        const out = await underlying(document, variables);
        const rankings = out.worldData.encounter.characterRankings;
        rankings.rankings = rankings.rankings.map((entry: Record<string, unknown>) => ({ ...entry, amount: "NOT_A_REAL_TOKEN" }));
        return out;
      }
      return underlying(document, variables);
    });
    const handler = handlerWith({ query }); // Real generated core is the default builder.
    const response = await handler(request({ name: f.params.name }));
    assert.equal(response.status, 502);
    assert.equal(active, 0); assert.equal(settled, 1);
    assertPrivate(response);
    const out = await response.json();
    assert.equal(out.diagnostic, "upstream.world.entries");
    assert.doesNotMatch(JSON.stringify(out), /NOT_A_REAL_TOKEN|synthetic required/);
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

describe("CastMirror fixed data diagnostics", () => {
  for (const kind of ["tagged", "untagged", "forged", "accessor", "generic", "transport"]) {
    test(`${kind} error projects only an allowlisted label without values, properties or getters`, async () => {
      const secret = "NOT_A_REAL_TOKEN_OR_REPORT";
      const error = kind === "generic" ? new Error("synthetic failure " + secret)
        : kind === "transport" ? new LogServiceError("response")
          : new ComparisonDataError(kind === "tagged" ? "normalized.context" : undefined);
      const getter = vi.fn(() => secret);
      Object.assign(error, { cause: { token: secret }, rawBody: secret, document: secret, variables: { code: secret } });
      if (kind === "forged" || kind === "generic" || kind === "transport") {
        Object.defineProperty(error, "diagnostic", { value: kind === "generic" ? "normalized.context" : secret });
      }
      if (kind === "accessor") Object.defineProperty(error, "diagnostic", { get: getter });
      const builder = vi.fn(async () => { throw error; });
      const handler = handlerWith({ builder });
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await handler(request());
        assert.equal(response.status, 502);
        assertPrivate(response);
        const out = await response.json();
        const diagnostic = kind === "generic" ? undefined : kind === "transport" ? "transport.log-service"
          : kind === "tagged" ? "normalized.context" : "data.unclassified";
        assert.equal(out.diagnostic, diagnostic);
        assert.deepEqual(Object.keys(out).sort(), diagnostic ? ["diagnostic", "error"] : ["error"]);
        assert.doesNotMatch(JSON.stringify(out), /NOT_A_REAL_TOKEN_OR_REPORT|rawBody|variables|document|cause|stack/);
        if (error instanceof ComparisonDataError) assert.equal(out.error, new ComparisonDataError().message);
      }
      assert.equal(getter.mock.calls.length, 0);
      assert.equal(builder.mock.calls.length, 2);
    });
  }

  test("typed resource failure through the default builder has a fixed upstream label and is not cached", async () => {
    const f = wclFixture(); const top = f.entry("Top"); f.rankings = () => [top];
    const underlying = f.client.query.bind(f.client); let mutations = 0;
    const handler = handlerWith({ query: async (document, variables = {}) => {
      const out = await underlying(document, variables);
      if (variables.code === f.player.report.code && document.includes("dataType: Resources")) {
        out.reportData.report.events.data[0].resourceChange = "NOT_A_REAL_TOKEN_OR_REPORT";
        mutations++;
      }
      return out;
    } });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handler(request({ name: f.params.name }));
      assert.equal(response.status, 502); assertPrivate(response);
      const out = await response.json();
      assert.equal(out.error, new ComparisonDataError().message);
      assert.equal(out.diagnostic, "upstream.resources.evidence");
      assert.doesNotMatch(JSON.stringify(out), /NOT_A_REAL_TOKEN_OR_REPORT/);
    }
    assert.equal(mutations, 2);
  });

  test("an actual-core Boss query validation failure stays partial, retries and warms only after recovery", async () => {
    const f = wclFixture(); const overall = f.entry("Overall"), boss = f.entry("Boss");
    f.rankings = ({ metric }: RankingQuery) => [metric === "dps" ? overall : boss];
    const underlying = f.client.query.bind(f.client); let broken = true, failures = 0;
    const handler = handlerWith({ query: async (document, variables = {}) => {
      const out = await underlying(document, variables);
      if (broken && document.includes("characterRankings") && variables.metric === "bossdps") {
        out.worldData.encounter.characterRankings.hasMorePages = "NOT_A_REAL_TOKEN_OR_REPORT";
        failures++;
      }
      return out;
    } });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handler(request({ name: f.params.name }));
      assert.equal(response.status, 200); assertPrivate(response);
      const out = await response.json();
      assert.equal(out.b.name, overall.name); assert.equal(out.bossReference, null);
      assert.equal("diagnostic" in out, false);
      assert.doesNotMatch(out.bossReferenceError, /NOT_A_REAL_TOKEN_OR_REPORT|upstream\./);
    }
    assert.equal(failures, 2);
    broken = false;
    const recovered = await handler(request({ name: f.params.name }));
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).bossReference.b.name, boss.name);
    const calls = f.calls.length;
    assert.equal((await handler(request({ name: f.params.name }))).status, 200);
    assert.equal(f.calls.length, calls);
  });

  test("class metadata failure identifies its assertion group, not a class value", async () => {
    const builder: NonNullable<CompareHandlerOptions["builder"]> = async (client, params) => {
      await client.query("query { gameData { classes { id name } } }");
      return comparisonFor(params);
    };
    const response = await handlerWith({ builder, query: async () => ({ gameData: { classes: [{ id: 0, name: "SyntheticUnknown" }] } }) })(request());
    assert.equal(response.status, 502); assertPrivate(response);
    assert.deepEqual(await response.json(), { error: new ComparisonDataError().message, diagnostic: "upstream.classes.entries" });
  });

  test("ambiguous event selectors use the fixed generic event envelope label", async () => {
    const builder: NonNullable<CompareHandlerOptions["builder"]> = async (client, params) => {
      await client.query("query { reportData { report { events(dataType: Casts) { data } events(dataType: Resources) { data } } } }");
      return comparisonFor(params);
    };
    const response = await handlerWith({ builder, query: async () => ({ reportData: { report: {} } }) })(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).diagnostic, "upstream.events.envelope");
  });

  test("a swallowed query failure cannot replace the diagnostic of the escaping required normalization failure", async () => {
    const builder: NonNullable<CompareHandlerOptions["builder"]> = async (client, params) => {
      await assert.rejects(client.query("query { worldData { encounter { name characterRankings } } }"), ComparisonDataError);
      const out = comparisonFor(params); out.b.durSec = 0;
      return out;
    };
    const response = await handlerWith({ builder, query: async () => ({ worldData: { encounter: { name: "SyntheticBoss", characterRankings: {} } } }) })(request());
    assert.equal(response.status, 502); assertPrivate(response);
    assert.equal((await response.json()).diagnostic, "normalized.overall.fight");
  });

  test("Boss-only tagged validation failure remains a partial uncached success without fatal diagnostics", async () => {
    const builder = vi.fn(async (_client: ComparisonClient, params: CompareParams) => {
      const out = comparisonFor(params); out.bossReference.b.casts = [[NaN, "SyntheticSpell"]];
      return out;
    });
    const handler = handlerWith({ builder });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handler(request());
      assert.equal(response.status, 200); assertPrivate(response);
      const out = await response.json();
      assert.equal(out.b.name, "OverallWinner"); assert.equal(out.bossReference, null);
      assert.equal("diagnostic" in out, false);
      assert.doesNotMatch(out.bossReferenceError, /normalized\.|NaN|SyntheticSpell/);
      assert.equal(out.executionStatus.state, "unsupported");
    }
    assert.equal(builder.mock.calls.length, 2);
  });

  for (const kind of ["cancellation", "deadline"]) {
    test(`${kind} takes precedence over an escaping tagged error without emitting a diagnostic`, async () => {
      vi.useFakeTimers();
      const started = deferred(), release = deferred();
      const builder: NonNullable<CompareHandlerOptions["builder"]> = async () => {
        started.resolve(undefined); await release.promise;
        throw new ComparisonDataError("normalized.context");
      };
      const controller = new AbortController();
      const pending = handlerWith({ builder, deadlineMs: 25 })(request({}, { signal: controller.signal }));
      await started.promise;
      if (kind === "cancellation") controller.abort(); else await vi.advanceTimersByTimeAsync(25);
      release.resolve(undefined);
      const response = await pending;
      assert.equal(response.status, kind === "cancellation" ? 499 : 504); assertPrivate(response);
      assert.deepEqual(Object.keys(await response.json()), ["error"]);
      assert.equal(vi.getTimerCount(), 0);
    });
  }
});
