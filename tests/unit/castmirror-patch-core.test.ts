import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { buildComparison as buildCoreComparison } from "../../app/api/castmirror/compare/core.mjs";
import { assertUpstreamData, normalizeComparison, type Comparison, type ComparisonClient, type CompareParams } from "../../app/api/castmirror/compare/contracts";
import { wclFixture, worldCalls, talents } from "../helpers/castmirror-wcl.mjs";

type QueryCall = { query: string; variables: Record<string, unknown> };
type RankingQuery = { metric: string; page: number; xb: string; partition?: number };
const previousID = 407;
const previousLabel = { current: "12.1.5", selected: "12.1", fallback: true };
const metadataCalls = (fixture: ReturnType<typeof wclFixture>): QueryCall[] => fixture.calls.filter((call: QueryCall) => call.query.includes("partitions"));
const characterCalls = (fixture: ReturnType<typeof wclFixture>): QueryCall[] => fixture.calls.filter((call: QueryCall) => call.query.includes("encounterRankings"));
const recentCalls = (fixture: ReturnType<typeof wclFixture>): QueryCall[] => fixture.calls.filter((call: QueryCall) => call.query.includes("recentReports"));
const metricCalls = (fixture: ReturnType<typeof wclFixture>, metric = "dps"): QueryCall[] => worldCalls(fixture).filter((call: QueryCall) => call.variables.metric === metric);

function patchFixture(options: Parameters<typeof wclFixture>[0] = {}) {
  const fixture = wclFixture(options);
  fixture.partitions = [
    { id: 801, name: "Patch 12.0.5", default: false },
    { id: 93, name: "Patch 12.1.5", default: true },
    { id: previousID, name: "Patch 12.1", default: false },
  ];
  // Real hosted queries run this same validator. Do not let synthetic malformed
  // ranking rows bypass it and accidentally authorize historical acquisition.
  const query = fixture.client.query.bind(fixture.client);
  fixture.client.query = async (document: string, variables: Record<string, unknown> = {}) => {
    const value = await query(document, variables);
    assertUpstreamData(document, value);
    return value;
  };
  return fixture;
}

async function buildComparison(client: ComparisonClient, params: CompareParams): Promise<Comparison> {
  const value = await buildCoreComparison(client, params) as Comparison;
  normalizeComparison(value, params); // Every successful raw core result must also satisfy the parent-owned public contract.
  return value;
}

const currentWorldDocument = `query($enc: Int!, $cls: String!, $spec: String!, $diff: Int!, $metric: CharacterRankingMetricType!, $page: Int!, $xb: ExternalBuffRankFilter) {
             worldData { encounter(id: $enc) {
               name
               characterRankings(className: $cls, specName: $spec, difficulty: $diff, metric: $metric, page: $page, includeCombatantInfo: true, externalBuffs: $xb)
             } }
           }`;
const currentCharacterDocument = `query($name: String!, $slug: String!, $region: String!, $enc: Int!, $diff: Int!, $metric: CharacterRankingMetricType!) {
       characterData { character(name: $name, serverSlug: $slug, serverRegion: $region) {
         classID
         encounterRankings(encounterID: $enc, difficulty: $diff, metric: $metric)
       } }
     }`;

describe("CastMirror current-first bounded previous-patch core (synthetic only)", () => {
  test("successful default character/Overall/Boss queries are byte-identical and request no partition metadata", async () => {
    const f = patchFixture();
    const top = f.entry("Current");
    f.rankings = () => [top];
    const out = await buildComparison(f.client, f.params);
    assert.equal(metadataCalls(f).length, 0);
    assert.equal(characterCalls(f).length, 1);
    assert.equal(characterCalls(f)[0].query, currentCharacterDocument);
    assert.deepEqual(characterCalls(f)[0].variables, {
      name: f.params.name, slug: "test-realm", region: "us", enc: 42, diff: 4, metric: "dps",
    });
    for (const call of worldCalls(f) as QueryCall[]) {
      assert.equal(call.query, currentWorldDocument);
      assert.deepEqual(call.variables, { enc: 42, cls: "Mage", spec: "Arcane", diff: 4, metric: call.variables.metric, page: 1, xb: "Exclude" });
    }
    assert.equal(out.a.rankingPatch, undefined);
    assert.equal(out.b.rankingPatch, undefined);
    assert.equal(out.bossReference!.b.rankingPatch, undefined);
  });

  for (const [historicalOverall, historicalBoss] of [[true, false], [false, true], [true, true]] as const) {
    test(`Overall historical=${historicalOverall}, Boss historical=${historicalBoss} select and label independently`, async () => {
      const f = patchFixture();
      const current = f.entry("Current"), previous = f.entry("Previous", { amount: 2300 });
      f.rankings = ({ metric, partition }: RankingQuery) => {
        const historical = metric === "dps" ? historicalOverall : historicalBoss;
        return partition === undefined ? historical ? [] : [current] : [previous];
      };
      const out = await buildComparison(f.client, f.params);
      assert.equal(out.b.name, historicalOverall ? previous.name : current.name);
      assert.equal(out.bossReference!.b.name, historicalBoss ? previous.name : current.name);
      assert.deepEqual(out.b.rankingPatch, historicalOverall ? previousLabel : undefined);
      assert.deepEqual(out.bossReference!.b.rankingPatch, historicalBoss ? previousLabel : undefined);
      assert.equal(out.a.rankingPatch, undefined);
      assert.equal(metadataCalls(f).length, 1, "concurrent reference searches share one metadata Promise");
      assert.deepEqual(metadataCalls(f)[0].variables, { enc: 42 });
      assert.match(metadataCalls(f)[0].query, /id zone \{ id partitions \{ id name default \}/);
      assert.doesNotMatch(metadataCalls(f)[0].query, /timestamp|startTime|endTime/);
      for (const call of worldCalls(f) as QueryCall[]) {
        assert.equal(call.variables.enc, 42); assert.equal(call.variables.cls, "Mage");
        assert.equal(call.variables.spec, "Arcane"); assert.equal(call.variables.diff, 4);
        if (call.variables.partition !== undefined) {
          assert.equal(call.variables.partition, previousID);
          assert.match(call.query, /\$partition: Int!/);
          assert.match(call.query, /externalBuffs: \$xb, partition: \$partition/);
        }
      }
      for (const side of [out.b, out.bossReference!.b]) {
        if (side.rankingPatch) assert.deepEqual(Object.keys(side.rankingPatch).sort(), ["current", "fallback", "selected"]);
      }
    });
  }

  for (const ineligibleExclude of [false, true]) {
    test(`current Any wins before historical Exclude, including ineligible current Exclude=${ineligibleExclude}`, async () => {
      const f = patchFixture();
      const top = f.entry("CurrentInfused", { pi: true });
      f.rankings = ({ xb, partition }: RankingQuery) => partition !== undefined ? [f.entry("MustNotAcquire")]
        : xb === "Any" ? [top] : ineligibleExclude ? [{ name: "Anonymous", report: { code: "a:hidden", fightID: 1 } }] : [];
      const out = await buildComparison(f.client, f.params);
      assert.equal(out.b.name, top.name); assert.equal(out.bossReference!.b.name, top.name);
      assert.deepEqual(out.pi, { a: false, b: true, excluded: false });
      assert.equal(out.b.rankingPatch, undefined);
      assert.equal(metadataCalls(f).length, 0);
      for (const metric of ["dps", "bossdps"]) assert.deepEqual(metricCalls(f, metric).map((call) => call.variables.xb), ["Exclude", "Any"]);
    });
  }

  test("historical PI policy resets from A rather than inheriting the failed current Any policy", async () => {
    const f = patchFixture();
    const overall = f.entry("HistoricalFair"), boss = f.entry("HistoricalInfused", { pi: true });
    f.rankings = ({ metric, partition, xb }: RankingQuery) => partition === undefined ? []
      : metric === "dps" ? [overall] : xb === "Exclude" ? [] : [boss];
    const out = await buildComparison(f.client, f.params);
    assert.deepEqual(out.pi, { a: false, b: false, excluded: true });
    assert.deepEqual(out.bossReference!.pi, { a: false, b: true, excluded: false });
    assert.deepEqual(metricCalls(f).map((call) => [call.variables.partition ?? null, call.variables.xb]), [
      [null, "Exclude"], [null, "Any"], [previousID, "Exclude"],
    ]);
    assert.deepEqual(metricCalls(f, "bossdps").map((call) => [call.variables.partition ?? null, call.variables.xb]), [
      [null, "Exclude"], [null, "Any"], [previousID, "Exclude"], [previousID, "Any"],
    ]);
  });

  test("an infused player keeps independent current and previous Any pools", async () => {
    const f = patchFixture({ playerPI: true });
    const top = f.entry("Previous");
    f.rankings = ({ partition }: RankingQuery) => partition === undefined ? [] : [top];
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.pi.a, true); assert.equal(out.bossReference!.pi.a, true);
    assert.ok((worldCalls(f) as QueryCall[]).every((call) => call.variables.xb === "Any"));
    assert.deepEqual(metricCalls(f).map((call) => call.variables.partition ?? null), [null, previousID]);
  });

  for (const hero of [null, "Spellslinger"] as const) {
    test(`previous pools retain independent hero matching and requested override=${hero}`, async () => {
      const f = patchFixture({ playerHero: "Sunfury" });
      const pool = [
        f.entry("Splinter", { hero: "Spellslinger", talents: talents(20) }),
        f.entry("SplinterSecond", { hero: "Spellslinger", talents: talents(20) }),
        f.entry("Phoenix", { hero: "Sunfury", talents: talents(10) }),
        f.entry("PhoenixSecond", { hero: "Sunfury", talents: talents(10) }),
      ];
      f.rankings = ({ partition, metric }: RankingQuery) => partition === undefined ? []
        : pool.map((entry: { amount: number }) => ({ ...entry, amount: metric === "dps" ? 2300 : 1700 }));
      const out = await buildComparison(f.client, { ...f.params, hero });
      assert.equal(out.b.name, pool[hero ? 0 : 2].name);
      assert.equal(out.bossReference!.b.name, pool[hero ? 0 : 2].name);
      assert.equal(out.hero.b, hero ?? "Sunfury"); assert.equal(out.bossReference!.hero.b, hero ?? "Sunfury");
      assert.equal(out.b.amount, 2300); assert.equal(out.bossReference!.b.amount, 1700);
      assert.deepEqual(out.b.rankingPatch, previousLabel);
    });
  }

  test("ineligible current HPS self-only pools fall back independently and retain signed full-fight healing", async () => {
    const f = patchFixture();
    const healer = f.entry("PreviousHealer", { healing: { Piety: 100000, AbsorbAdjustment: -2500 } });
    f.rankings = ({ partition }: RankingQuery) => partition === undefined ? [f.player] : [healer];
    const out = await buildComparison(f.client, { ...f.params, metric: "hps" });
    assert.equal(out.b.name, healer.name); assert.deepEqual(out.b.rankingPatch, previousLabel);
    assert.equal("bossReference" in out, false); assert.equal(out.metric, "hps");
    assert.deepEqual(out.b.dmg, { Piety: 100000, AbsorbAdjustment: -2500 });
    assert.ok((worldCalls(f) as QueryCall[]).every((call) => call.variables.metric === "hps"));
    assert.deepEqual(metricCalls(f, "hps").map((call) => [call.variables.partition ?? null, call.variables.xb]), [
      [null, "Exclude"], [null, "Any"], [previousID, "Exclude"],
    ]);
    assert.equal(f.calls.some((call: QueryCall) => call.query.includes("dataType: DamageDone")), false);
  });

  test("exhausted ineligible pagination can authorize one predecessor after current PI policies complete", async () => {
    const f = patchFixture();
    const top = f.entry("Previous");
    f.rankings = ({ partition, page, xb }: RankingQuery) => partition !== undefined ? [top]
      : xb === "Exclude" && page === 1
        ? { rankings: Array.from({ length: 100 }, () => ({ name: "Anonymous", report: { code: "a:hidden", fightID: 1 } })), hasMorePages: true }
        : { rankings: [], hasMorePages: false };
    const out = await buildComparison(f.client, f.params);
    assert.deepEqual(out.b.rankingPatch, previousLabel);
    assert.deepEqual(metricCalls(f).map((call) => [call.variables.partition ?? null, call.variables.page, call.variables.xb]), [
      [null, 1, "Exclude"], [null, 2, "Exclude"], [null, 1, "Any"], [previousID, 1, "Exclude"],
    ]);
    assert.equal(metadataCalls(f).length, 1);
  });

  for (const shape of ["short empty unexhausted", "short ineligible unexhausted", "three-page cap"] as const) {
    test(`${shape} cannot authorize a previous-patch search`, async () => {
      const f = patchFixture();
      const count = shape === "three-page cap" ? 100 : shape === "short empty unexhausted" ? 0 : 1;
      f.rankings = () => ({ rankings: Array.from({ length: count }, () => ({ name: "Anonymous", report: { code: "a:hidden", fightID: 1 } })), hasMorePages: true });
      await assert.rejects(buildComparison(f.client, { ...f.params, metric: "hps" }), /no mirrorable/);
      assert.equal(metadataCalls(f).length, 0);
      assert.equal(metricCalls(f, "hps").length, shape === "three-page cap" ? 3 : 1);
      assert.ok(metricCalls(f, "hps").every((call) => call.variables.partition === undefined && call.variables.xb === "Exclude"));
    });
  }

  const malformedWorld: Array<[string, unknown]> = [
    ["hidden", { error: "hidden", rankings: [], hasMorePages: false }],
    ["errors", { errors: [], rankings: [], hasMorePages: false }],
    ["null envelope", null], ["missing rankings", { hasMorePages: false }],
    ["wrong pagination type", { rankings: [], hasMorePages: "false" }],
    ["null row", { rankings: [null], hasMorePages: false }],
    ["invalid row name", { rankings: [{ name: 5 }], hasMorePages: false }],
    ["invalid usable row", { rankings: [{ name: "Bad", report: { code: "SyntheticCode123", fightID: 1 }, amount: -1 }], hasMorePages: false }],
  ];
  for (const [label, value] of malformedWorld) {
    test(`${label} current world response never becomes empty-pool patch evidence`, async () => {
      const f = patchFixture(); f.rankings = () => value;
      await assert.rejects(buildComparison(f.client, { ...f.params, metric: "hps" }));
      assert.equal(metadataCalls(f).length, 0);
      assert.equal((worldCalls(f) as QueryCall[]).some((call) => call.variables.partition !== undefined), false);
    });
  }

  for (const level of ["response", "worldData", "encounter"] as const) {
    test(`hidden ${level} envelope cannot authorize historical world acquisition`, async () => {
      const f = patchFixture(); f.rankings = () => [];
      const query = f.client.query.bind(f.client);
      f.client.query = async (document: string, variables: Record<string, unknown> = {}) => {
        const value = await query(document, variables);
        if (document.includes("characterRankings")) {
          const target = level === "response" ? value : level === "worldData" ? value.worldData : value.worldData.encounter;
          target.error = "hidden";
        }
        return value;
      };
      await assert.rejects(buildComparison(f.client, { ...f.params, metric: "hps" }), /Incomplete world ranking search/);
      assert.equal(metadataCalls(f).length, 0); assert.equal(worldCalls(f).length, 1);
    });
  }

  for (const failure of [new Error("Synthetic provider failure"), new DOMException("Synthetic cancellation", "AbortError")]) {
    test(`${failure.name} in the current search is propagated without historical acquisition`, async () => {
      const f = patchFixture(); f.rankings = () => { throw failure; };
      await assert.rejects(buildComparison(f.client, { ...f.params, metric: "hps" }), (error: unknown) => error === failure);
      assert.equal(metadataCalls(f).length, 0); assert.equal(worldCalls(f).length, 1);
    });
  }

  for (const failure of ["error", "unexhausted"] as const) {
    test(`current Any ${failure} after empty Exclude still cannot authorize previous acquisition`, async () => {
      const f = patchFixture();
      f.rankings = ({ xb }: RankingQuery) => {
        if (xb === "Exclude") return [];
        if (failure === "error") throw new Error("Synthetic Any failure");
        return { rankings: [], hasMorePages: true };
      };
      await assert.rejects(buildComparison(f.client, { ...f.params, metric: "hps" }));
      assert.equal(metadataCalls(f).length, 0);
      assert.deepEqual(metricCalls(f, "hps").map((call) => call.variables.xb), ["Exclude", "Any"]);
    });
  }

  test("a hidden immediate predecessor is not treated as empty and does not trigger any older search", async () => {
    const f = patchFixture();
    f.rankings = ({ partition }: RankingQuery) => partition === undefined ? [] : { error: "hidden", rankings: [], hasMorePages: false };
    await assert.rejects(buildComparison(f.client, { ...f.params, metric: "hps" }), /Incomplete world ranking search/);
    assert.equal(metadataCalls(f).length, 1);
    assert.deepEqual(metricCalls(f, "hps").map((call) => [call.variables.partition ?? null, call.variables.xb]), [
      [null, "Exclude"], [null, "Any"], [previousID, "Exclude"],
    ]);
  });

  test("a failed historical Boss search preserves a completed current Overall reference", async () => {
    const f = patchFixture(); const top = f.entry("CurrentOverall");
    f.rankings = ({ metric, partition }: RankingQuery) => {
      if (metric === "dps") return [top];
      if (partition === undefined) return [];
      throw new Error("Synthetic historical Boss failure");
    };
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.b.name, top.name); assert.equal(out.b.rankingPatch, undefined); assert.equal(out.a.rankingPatch, undefined);
    assert.equal(out.bossReference, null); assert.match(out.bossReferenceError ?? "", /Synthetic historical Boss failure/);
    assert.equal(metadataCalls(f).length, 1);
    assert.ok(metricCalls(f).every((call) => call.variables.partition === undefined));
  });

  test("an empty immediate predecessor does not scan any older partition", async () => {
    const f = patchFixture(); f.rankings = () => [];
    await assert.rejects(buildComparison(f.client, { ...f.params, metric: "hps" }), /no mirrorable/);
    assert.equal(metadataCalls(f).length, 1);
    assert.deepEqual(metricCalls(f, "hps").map((call) => [call.variables.partition ?? null, call.variables.xb]), [
      [null, "Exclude"], [null, "Any"], [previousID, "Exclude"], [previousID, "Any"],
    ]);
  });

  test("invalid metadata fails closed without querying a guessed partition", async () => {
    const f = patchFixture(); f.rankings = () => [];
    f.partitions.push({ id: 1001, name: "unknown season", default: false });
    await assert.rejects(buildComparison(f.client, { ...f.params, metric: "hps" }), /no mirrorable/);
    assert.equal(metadataCalls(f).length, 1);
    assert.ok((worldCalls(f) as QueryCall[]).every((call) => call.variables.partition === undefined));
  });

  test("metadata transport errors are not caught into a guessed historical partition", async () => {
    const f = patchFixture(); f.rankings = () => [];
    f.rankingMetadata = () => { throw new Error("Synthetic metadata failure"); };
    await assert.rejects(buildComparison(f.client, { ...f.params, metric: "hps" }), /Synthetic metadata failure/);
    assert.equal(metadataCalls(f).length, 1);
    assert.ok((worldCalls(f) as QueryCall[]).every((call) => call.variables.partition === undefined));
  });

  test("an inaccessible selected current winner is not a signal to acquire previous logs", async () => {
    const f = patchFixture();
    const top = f.entry("Current"); f.rankings = () => [top];
    const query = f.client.query.bind(f.client);
    f.client.query = async (document: string, variables: Record<string, unknown> = {}) => {
      if (variables.code === top.report.code) throw new Error("Synthetic selected report unavailable");
      return await query(document, variables);
    };
    await assert.rejects(buildComparison(f.client, { ...f.params, metric: "hps" }), /Synthetic selected report unavailable/);
    assert.equal(metadataCalls(f).length, 0);
  });
});

describe("CastMirror unpinned ranked A fallback and explicit pin invariants", () => {
  test("empty current A tries one verified previous ranked A before any recent-report lookup", async () => {
    const f = patchFixture();
    const previous = f.entry("PreviousPlayer", { name: f.params.name, server: "Test Realm", fightID: 2 });
    const top = f.entry("CurrentReference"); f.rankings = () => [top];
    f.playerRankings = ({ partition }: { partition?: number }) => partition === undefined ? []
      : [{ report: previous.report, amount: 1500, rankPercent: 88, spec: "Arcane" }];
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.a.code, previous.report.code); assert.equal(out.a.fightID, 2); assert.equal(out.a.amount, 1500);
    assert.equal(out.a.rankPercent, 88); assert.deepEqual(out.a.rankingPatch, previousLabel);
    assert.equal(out.b.rankingPatch, undefined); assert.equal(out.bossReference!.b.rankingPatch, undefined);
    assert.equal(recentCalls(f).length, 0); assert.equal(metadataCalls(f).length, 1);
    assert.deepEqual(characterCalls(f).map((call) => call.variables.partition ?? null), [null, previousID]);
    const prior = characterCalls(f)[1];
    assert.match(prior.query, /encounterRankings\(encounterID: \$enc, difficulty: \$diff, metric: \$metric, partition: \$partition\)/);
    assert.deepEqual(prior.variables, { name: f.params.name, slug: "test-realm", region: "us", enc: 42, diff: 4, metric: "dps", partition: previousID });
  });

  test("A/Overall/Boss historical selections share metadata but retain separate labels", async () => {
    const f = patchFixture();
    const top = f.entry("PreviousReference");
    f.playerRankings = ({ partition }: { partition?: number }) => partition === undefined ? [] : f.ranks;
    f.rankings = ({ partition }: RankingQuery) => partition === undefined ? [] : [top];
    const out = await buildComparison(f.client, f.params);
    assert.equal(metadataCalls(f).length, 1);
    assert.deepEqual(out.a.rankingPatch, previousLabel); assert.deepEqual(out.b.rankingPatch, previousLabel);
    assert.deepEqual(out.bossReference!.b.rankingPatch, previousLabel);
    assert.notEqual(out.a.rankingPatch, out.b.rankingPatch);
    assert.notEqual(out.b.rankingPatch, out.bossReference!.b.rankingPatch);
    assert.equal(recentCalls(f).length, 0);
  });

  test("an explicit unranked A kill is never replaced, even when both reference metrics fall back", async () => {
    const f = patchFixture(); f.ranks = [];
    const top = f.entry("PreviousReference");
    f.rankings = ({ partition }: RankingQuery) => partition === undefined ? [] : [top];
    const out = await buildComparison(f.client, { ...f.params, code: f.player.report.code, fightID: f.player.report.fightID });
    assert.equal(out.a.code, f.player.report.code); assert.equal(out.a.fightID, f.player.report.fightID);
    assert.equal(out.a.rankPercent, 0); assert.equal(out.a.rankingPatch, undefined);
    assert.equal(characterCalls(f).length, 1); assert.equal(characterCalls(f)[0].variables.partition, undefined);
    assert.equal(recentCalls(f).length, 0); assert.deepEqual(out.b.rankingPatch, previousLabel);
  });

  for (const value of [
    { error: "hidden" }, { ranks: [], error: "hidden" }, { ranks: [], errors: [] },
    { ranks: [], hasMorePages: true },
  ]) {
    test(`hidden or unexhausted A ${JSON.stringify(value)} keeps existing recent fallback without patch acquisition`, async () => {
      const f = patchFixture();
      const top = f.entry("CurrentReference"); f.rankings = () => [top];
      f.playerRankings = () => value; f.recentReports = () => [{ code: f.player.report.code }];
      const out = await buildComparison(f.client, f.params);
      assert.equal(out.a.code, f.player.report.code); assert.equal(out.a.rankingPatch, undefined);
      assert.equal(metadataCalls(f).length, 0); assert.equal(characterCalls(f).length, 1); assert.equal(recentCalls(f).length, 1);
    });
  }

  for (const value of [null, { ranks: null }, { ranks: [null] }, { ranks: [], hasMorePages: "false" }]) {
    test(`malformed current A ${JSON.stringify(value)} cannot authorize patch acquisition`, async () => {
      const f = patchFixture(); f.playerRankings = () => value;
      if (value && Array.isArray(value.ranks) && value.ranks.length === 0) {
        f.recentReports = () => [];
      }
      await assert.rejects(buildComparison(f.client, f.params));
      assert.equal(metadataCalls(f).length, 0);
    });
  }

  for (const value of [{ error: "hidden" }, { ranks: [], hasMorePages: true }, { ranks: [null] }]) {
    test(`hidden, truncated or malformed previous A ${JSON.stringify(value)} is not selected`, async () => {
      const f = patchFixture();
      f.playerRankings = ({ partition }: { partition?: number }) => partition === undefined ? [] : value;
      await assert.rejects(buildComparison(f.client, f.params));
      assert.equal(metadataCalls(f).length, 1); assert.equal(characterCalls(f).length, 2);
      assert.equal(recentCalls(f).length, 0); assert.equal(worldCalls(f).length, 0);
    });
  }

  for (const level of ["response", "characterData", "character"] as const) {
    test(`hidden previous A ${level} envelope is never selected`, async () => {
      const f = patchFixture();
      f.playerRankings = ({ partition }: { partition?: number }) => partition === undefined ? [] : f.ranks;
      const query = f.client.query.bind(f.client);
      f.client.query = async (document: string, variables: Record<string, unknown> = {}) => {
        const value = await query(document, variables);
        if (document.includes("encounterRankings") && variables.partition !== undefined) {
          const target = level === "response" ? value : level === "characterData" ? value.characterData : value.characterData.character;
          target.error = "hidden";
        }
        return value;
      };
      await assert.rejects(buildComparison(f.client, f.params), /Incomplete previous-patch character rankings/);
      assert.equal(metadataCalls(f).length, 1); assert.equal(characterCalls(f).length, 2);
      assert.equal(recentCalls(f).length, 0); assert.equal(worldCalls(f).length, 0);
    });
  }

  test("previous A must preserve the validated current character class", async () => {
    const f = patchFixture();
    f.playerRankings = ({ partition }: { partition?: number }) => partition === undefined ? [] : f.ranks;
    const query = f.client.query.bind(f.client);
    f.client.query = async (document: string, variables: Record<string, unknown> = {}) => {
      const value = await query(document, variables);
      if (document.includes("encounterRankings") && variables.partition !== undefined) value.characterData.character.classID = 9;
      return value;
    };
    await assert.rejects(buildComparison(f.client, f.params), /Incomplete previous-patch character rankings/);
    assert.equal(metadataCalls(f).length, 1); assert.equal(recentCalls(f).length, 0);
  });

  test("an empty previous ranked A retains existing recent fallback without falsely labeling the recent kill", async () => {
    const f = patchFixture(); f.playerRankings = () => [];
    f.recentReports = () => [{ code: f.player.report.code }];
    const top = f.entry("CurrentReference"); f.rankings = () => [top];
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.a.code, f.player.report.code); assert.equal(out.a.rankingPatch, undefined);
    assert.equal(metadataCalls(f).length, 1); assert.equal(characterCalls(f).length, 2); assert.equal(recentCalls(f).length, 1);
    assert.ok(characterCalls(f).every((call) => call.variables.partition === undefined || call.variables.partition === previousID));
  });
});
