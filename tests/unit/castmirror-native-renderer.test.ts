// Synthetic API fixtures exercise the actual generated page. No provider calls,
// captured reports, saved pilot data, or production readiness claims are involved.
import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { button, comparisonFixture, controlledTimers, pageFixture, requestsTo, state } from "../helpers/castmirror-page.mjs";

const id = "11111111-1111-4111-8111-111111111111";
function comparison(metric = "dps") {
  const data = comparisonFixture();
  data.metric = metric;
  data.comparisonID = id;
  data.executionV3Status = { state: "available", available: true, backend: "native", analyticalVersion: "execution-statistical-3", capabilities: { build: false, reference: true } };
  return data;
}
function reference(policy = "Any", { sparse = false, incompatible = false, incomplete = false } = {}) {
  const base = comparison();
  const sample = { observations: sparse ? 2 : 6, players: sparse ? 1 : 6, kills: 3, confidence: sparse ? "insufficient" : "low" };
  const weights = { avoidance: 30, survival: 15, incoming: 10, defenses: 20, output: 20, healing: 5 };
  const known = (value: number, weight: number, measurements = {}) => ({ state: "known", value, score: sparse ? null : 63,
    percentile: sparse ? null : 63, weight, measurements: { complete: true, ...measurements }, sample });
  const unavailable = (weight: number) => ({ state: "unknown", value: null, score: null, percentile: null, weight, measurements: {}, sample });
  const evaluation = () => ({ status: sparse ? "measurements-only" : "partial", score: sparse ? null : 63,
    mask: sparse ? "000000" : "010110", coverageWeight: sparse ? 0 : 55, weights, sample,
    support: { pi: policy === "Exclude" ? null : false }, components: {
      avoidance: unavailable(30), survival: known(0, 15, { deathCount: 0 }), incoming: unavailable(10),
      defenses: known(1, 20, { boundedUses: 2, boundedUsesPerMinute: 1 }),
      output: known(40, 20, { usefulDamage: 4800, usefulDamagePerSecond: 40 }),
      healing: incomplete ? { state: "incomplete", value: null, score: null, weight: 5,
        measurements: { total: 1200, perSecond: 10, complete: false, basis: "observed-lower-bound" }, sample } : unavailable(5),
    } });
  const a = evaluation(), b = evaluation();
  if (incompatible) { b.mask = "010100"; b.coverageWeight = 35; b.components.output.score = null; }
  // Native responses deliberately omit the large throughput timeline/resources.
  const { name, code, fightID, actorID, server, durSec, scope } = base.b;
  return { comparisonID: id, executionReference: {
    b: { name, code, fightID, actorID, server, durSec, scope }, rankingMetric: "execution", hero: base.hero,
    pi: { a: false, b: policy === "Exclude" ? null : false, excluded: policy === "Exclude" },
    execution: { analyticalVersion: "execution-statistical-3", piPolicy: policy, cohortMode: "spec", status: a.status,
      a, b, comparable: !sparse && !incompatible, comparison: { comparable: !sparse && !incompatible },
      coverage: { ...sample, pi: { present: 0, absent: policy === "Any" ? 6 : 0, unknown: policy === "Exclude" ? 6 : 0 },
        acquisition: { state: incomplete ? "limited" : "complete", reason: incomplete ? "event-page-cap" : null,
          counters: { graphql: 30 }, limits: { graphql: 60 } } }, reasons: [], globalWinner: null,
    },
  } };
}
const text = (p: Awaited<ReturnType<typeof pageFixture>>) => ["board", "executionSummary", "executionBreakdown", "executionCoverage", "executionState"]
  .map((name) => p.nodes.get(name).htmlTree()).join(" ");

async function setup(options = {}) {
  const clock = controlledTimers();
  const p = await pageFixture((url: URL) => url.pathname.endsWith("/compare") ? comparison() : reference(url.searchParams.get("pi") ?? "Any", options), { timers: clock.timers });
  await p.runMirror(42, "Synthetic Boss");
  return { p, clock };
}

describe("hosted native Execution renderer", () => {
  test("a valid UUID cannot borrow contradictory or truthy native availability metadata", async () => {
    for (const status of [
      { available: false, backend: "native" }, { available: "true", backend: "native" },
      { available: true, backend: true }, { available: true, backend: "legacy" }, {},
    ]) {
      const clock = controlledTimers();
      const data = comparison();
      data.executionV3Status = { state: "available", analyticalVersion: "execution-statistical-3",
        capabilities: { build: false, reference: true }, ...status };
      const p = await pageFixture(() => data, { timers: clock.timers });
      await p.runMirror(42, "Synthetic Boss");
      assert.equal(button(p, "execution").disabled, true);
      await p.evaluate("loadExecutionV3()");
      assert.equal(requestsTo(p, "execution/v3").length, 0);
      assert.equal(clock.pending.size, 0);
    }
  });

  test("compact native responses retain pinned streams and preserve Overall/Boss locally", async () => {
    const { p, clock } = await setup();
    const player = state(p, "comparison.a"), overall = p.nodes.get("board").innerHTML;
    button(p, "boss").click(); const boss = p.nodes.get("board").innerHTML;
    assert.equal(button(p, "execution").disabled, false);
    await button(p, "execution").click();
    assert.deepEqual(state(p, "comparison.a"), player);
    assert.equal(p.nodes.get("executionPanel").style.display, "");
    const rows = p.nodes.get("executionBreakdown").querySelector("tbody").children;
    assert.deepEqual(rows.map((row: { dataset: { category: string } }) => row.dataset.category), ["avoidance", "survival", "incoming", "defenses", "output", "healing"]);
    assert.match(text(p), /Execution rating/);
    assert.equal((text(p).match(/Peer sample/g) ?? []).length, 1);
    assert.doesNotMatch(text(p), /graphql|GraphQL|000000|010110|event-page-cap|sourceID|accountingWriteRetries/);
    assert.equal(requestsTo(p, "execution/v3").length, 1);
    assert.equal(requestsTo(p, "execution/refresh").length, 0);
    assert.equal(clock.pending.size, 0);
    button(p, "overall").click(); assert.equal(p.nodes.get("board").innerHTML, overall);
    button(p, "boss").click(); assert.equal(p.nodes.get("board").innerHTML, boss);
    assert.equal(requestsTo(p, "compare").length, 1);
  });

  test("incompatible masks keep all six measurements without displaying aggregate ratings", async () => {
    const { p } = await setup({ incompatible: true });
    await button(p, "execution").click();
    assert.equal(p.nodes.get("executionBreakdown").querySelector("tbody").children.length, 6);
    assert.match(text(p), /40 DPS/);
    assert.doesNotMatch(p.nodes.get("board").innerHTML, /execution-rating/);
    assert.match(p.nodes.get("executionSummary").textContent, /no fair shared Execution rating/i);
  });

  test("incomplete healing is labeled as a lower bound, never as a complete scored total", async () => {
    const { p } = await setup({ incomplete: true });
    await button(p, "execution").click();
    const healing = p.nodes.get("executionBreakdown").querySelector("tbody").children.find((row: { dataset: { category: string } }) => row.dataset.category === "healing");
    assert.match(healing.htmlTree(), /Incomplete|at least|≥/i);
    assert.equal(healing.querySelectorAll(".execution-percentile").length, 0);
    assert.match(text(p), /Incomplete observations/);
  });

  test("Any/Exclude switch exactly the requested PI policy without fallback or throughput refetch", async () => {
    const clock = controlledTimers();
    const p = await pageFixture((url: URL) => url.pathname.endsWith("/compare") ? comparison("hps")
      : reference(url.searchParams.get("pi") ?? "Any", { sparse: url.searchParams.get("pi") === "Exclude" }), { timers: clock.timers });
    await p.runMirror(42, "Synthetic Boss");
    assert.equal(button(p, "boss"), undefined);
    await button(p, "execution").click();
    const excluded = p.nodes.get("executionPiRow").children.find((node: { dataset: { pi: string } }) => node.dataset.pi === "Exclude");
    await excluded.click();
    assert.deepEqual(requestsTo(p, "execution/v3").map((url: string) => new URL(url, "https://fixture.example").searchParams.get("pi")), ["Any", "Exclude"]);
    assert.doesNotMatch(p.nodes.get("board").innerHTML, /execution-rating/);
    assert.match(p.nodes.get("executionSummary").textContent, /Measurements only/);
    assert.match(p.nodes.get("executionPiHint").textContent, /No fallback to Any/);
    assert.equal(requestsTo(p, "compare").length, 1);
    assert.equal(clock.pending.size, 0);
  });
});
