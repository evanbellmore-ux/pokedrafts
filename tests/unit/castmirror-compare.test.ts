import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { buildComparison as buildCoreComparison } from "../../app/api/castmirror/compare/core.mjs";
import type { Comparison, ComparisonClient, CompareParams } from "../../app/api/castmirror/compare/contracts";

// Preserve the raw canonical result (including stream object identity); assertions
// below exercise the production result, not a normalizer or alternate algorithm.
async function buildComparison(client: ComparisonClient, params: CompareParams): Promise<Comparison> {
  return await buildCoreComparison(client, params) as Comparison;
}
import { wclFixture, worldCalls, streamCalls, talents } from "../helpers/castmirror-wcl.mjs";

type RankingQuery = { metric: string; page: number; xb: string };
type QueryCall = { query: string; variables: Record<string, unknown> };

// Query-level regressions adapted from all 14 upstream compare.test.mjs cases.
// apiCompare's cache case is additionally exercised through the hosted service.
describe("CastMirror hosted throughput parity (synthetic queries)", () => {
  test("loads independent Overall/Boss leaderboards while all analysis remains full-fight DPS", async () => {
    const f = wclFixture();
    const overall = f.entry("Overall", { amount: 2200, dmg: { Fireball: 264000 } });
    const boss = f.entry("Boss", { amount: 1400, dmg: { Fireball: 300000, Explosion: 60000 } });
    f.rankings = ({ metric }: RankingQuery) => [metric === "dps" ? overall : boss];
    const out = await buildComparison(f.client, f.params);

    assert.equal(out.b.name, overall.name);
    assert.equal(out.b.amount, 2200);
    assert.equal(out.bossReference!.b.name, boss.name);
    assert.equal(out.bossReference!.b.amount, 1400);
    assert.equal(out.bossReference!.rankingMetric, "bossdps");
    assert.equal(out.metric, "dps");
    assert.equal(out.a.amount, 900);
    assert.deepEqual(out.bossReference!.b.dmg, { Fireball: 300000, Explosion: 60000 });
    assert.deepEqual(out.bossReference!.b.lust, [[0, 40]]);
    assert.deepEqual(worldCalls(f).map((c: QueryCall) => c.variables.metric).sort(), ["bossdps", "dps"]);
    for (const { query, variables } of worldCalls(f)) {
      assert.equal(variables.enc, 42);
      assert.equal(variables.cls, "Mage");
      assert.equal(variables.spec, "Arcane");
      assert.equal(variables.diff, 4);
      assert.match(query, /includeCombatantInfo: true/);
    }
    assert.equal(f.calls.find((c: QueryCall) => c.query.includes("encounterRankings")).variables.metric, "dps");
    assert.equal(f.calls.some((c: QueryCall) => c.query.includes("dataType: Healing")), false);
    for (const c of f.calls.filter((c: QueryCall) => c.query.includes("dataType: DamageDone"))) {
      assert.doesNotMatch(c.query, /targetID|filterExpression/);
    }
  });

  test("identical winners reuse streams but retain independent ranked amounts", async () => {
    const f = wclFixture();
    const top = f.entry("Shared", { amount: 2400 });
    f.rankings = ({ metric }: RankingQuery) => [{ ...top, amount: metric === "dps" ? 2400 : 1700 }];
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.b.name, out.bossReference!.b.name);
    assert.equal(out.b.amount, 2400);
    assert.equal(out.bossReference!.b.amount, 1700);
    assert.equal(out.b.casts, out.bossReference!.b.casts);
    assert.equal(out.b.resources, out.bossReference!.b.resources);
    assert.equal(streamCalls(f).filter((c: QueryCall) => c.variables.code === top.report.code).length, 1);
  });

  test("an exact self-winner remains eligible and reuses the selected player stream", async () => {
    const f = wclFixture();
    f.rankings = ({ metric }: RankingQuery) => [{ ...f.player, amount: metric === "dps" ? 2000 : 1500 }];
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.b.name, out.a.name);
    assert.equal(out.bossReference!.b.name, out.a.name);
    assert.equal(out.a.casts, out.b.casts);
    assert.equal(out.a.casts, out.bossReference!.b.casts);
    assert.equal(out.a.amount, 900);
    assert.equal(out.b.amount, 2000);
    assert.equal(out.bossReference!.b.amount, 1500);
    assert.equal(streamCalls(f).length, 1);
  });

  test("another fight by the player in the same report can be the top reference", async () => {
    const f = wclFixture();
    const other = f.entry("OtherFight", {
      name: f.params.name, code: f.player.report.code, fightID: 2,
      casts: [[4, "Arcane Blast"]], amount: 2100,
    });
    f.rankings = () => [other];
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.a.fightID, 1);
    assert.equal(out.b.fightID, 2);
    assert.deepEqual(out.b.casts, [[4, "Arcane Blast"]]);
    assert.equal(streamCalls(f).length, 2);
  });

  test("two actors on one report/fight share only metadata, never actor streams", async () => {
    const f = wclFixture();
    const overall = f.entry("First", { casts: [[1, "Fireball"]] });
    const boss = f.entry("Second", { code: overall.report.code, casts: [[2, "Arcane Blast"]] });
    f.rankings = ({ metric }: RankingQuery) => [metric === "dps" ? overall : boss];
    const out = await buildComparison(f.client, f.params);
    assert.deepEqual(out.b.casts, [[1, "Fireball"]]);
    assert.deepEqual(out.bossReference!.b.casts, [[2, "Arcane Blast"]]);
    assert.notEqual(out.b.actorID, out.bossReference!.b.actorID);
    assert.equal(streamCalls(f).filter((c: QueryCall) => c.variables.code === overall.report.code).length, 1);
    const casts = f.calls.filter((c: QueryCall) => c.variables.code === overall.report.code && c.query.includes("dataType: Casts"));
    assert.equal(casts.length, 2);
    assert.equal(new Set(casts.map((c: QueryCall) => c.variables.src)).size, 2);
  });

  test("leaderboard pagination is independent", async () => {
    const f = wclFixture();
    const top = f.entry("Paged");
    f.rankings = ({ metric, page }: RankingQuery) => metric === "dps" && page === 1
      ? { rankings: Array.from({ length: 100 }, () => ({ name: "Anonymous", report: { code: "a:private", fightID: 1 } })), hasMorePages: true }
      : { rankings: [top], hasMorePages: false };
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.b.name, top.name);
    assert.deepEqual(worldCalls(f).filter((c: QueryCall) => c.variables.metric === "dps").map((c: QueryCall) => c.variables.page), [1, 2]);
    assert.deepEqual(worldCalls(f).filter((c: QueryCall) => c.variables.metric === "bossdps").map((c: QueryCall) => c.variables.page), [1]);
  });

  test("external-buff fallback and PI metadata are independent per reference", async () => {
    const f = wclFixture();
    const overall = f.entry("Fair");
    const boss = f.entry("Infused", { pi: true });
    f.rankings = ({ metric, xb }: RankingQuery) => metric === "dps" ? [overall] : xb === "Exclude" ? [] : [boss];
    const out = await buildComparison(f.client, f.params);
    assert.deepEqual(out.pi, { a: false, b: false, excluded: true });
    assert.deepEqual(out.bossReference!.pi, { a: false, b: true, excluded: false });
    assert.deepEqual(worldCalls(f).filter((c: QueryCall) => c.variables.metric === "bossdps").map((c: QueryCall) => c.variables.xb), ["Exclude", "Any"]);
    assert.deepEqual(worldCalls(f).filter((c: QueryCall) => c.variables.metric === "dps").map((c: QueryCall) => c.variables.xb), ["Exclude"]);
  });

  test("a player with PI queries both unrestricted pools", async () => {
    const f = wclFixture({ playerPI: true });
    const top = f.entry("Top");
    f.rankings = () => [top];
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.pi.a, true);
    assert.equal(out.bossReference!.pi.a, true);
    assert.equal(worldCalls(f).every((c: QueryCall) => c.variables.xb === "Any"), true);
  });

  test("each leaderboard independently matches the player hero tree and honors overrides", async () => {
    const f = wclFixture({ playerHero: "Sunfury" });
    const pools = Object.fromEntries(["dps", "bossdps"].map((metric) => [metric, [
      f.entry(metric + "Splinter", { hero: "Spellslinger", talents: talents(20) }),
      f.entry(metric + "Phoenix", { hero: "Sunfury", talents: talents(10) }),
      f.entry(metric + "PhoenixSecond", { hero: "Sunfury", talents: talents(10) }),
      f.entry(metric + "SplinterSecond", { hero: "Spellslinger", talents: talents(20) }),
    ]]));
    f.rankings = ({ metric }: RankingQuery) => pools[metric];
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.b.name, pools.dps[1].name);
    assert.equal(out.bossReference!.b.name, pools.bossdps[1].name);
    assert.equal(out.hero.b, "Sunfury");
    assert.equal(out.bossReference!.hero.b, "Sunfury");
    const alternate = await buildComparison(f.client, { ...f.params, hero: "Spellslinger" });
    assert.equal(alternate.b.name, pools.dps[0].name);
    assert.equal(alternate.bossReference!.b.name, pools.bossdps[0].name);
    assert.equal(alternate.hero.requested, "Spellslinger");
    assert.equal(alternate.bossReference!.hero.requested, "Spellslinger");
  });

  test("hero identification separates damage and healing analysis for the same candidates", async () => {
    const f = wclFixture();
    const pool = [
      f.entry("FirstTree", { hero: "Sunfury", talents: talents(10), healing: { Piety: 50000 } }),
      f.entry("FirstTreeSecond", { hero: "Sunfury", talents: talents(10), healing: { Piety: 50000 } }),
      f.entry("SecondTree", { hero: "Spellslinger", talents: talents(20), healing: { "Power Surge": 50000 } }),
      f.entry("SecondTreeSecond", { hero: "Spellslinger", talents: talents(20), healing: { "Power Surge": 50000 } }),
    ];
    f.rankings = () => pool;
    const damage = await buildComparison(f.client, f.params);
    const healing = await buildComparison(f.client, { ...f.params, metric: "hps" });
    assert.equal(damage.hero.b, "Sunfury");
    assert.equal(healing.hero.b, "Oracle");
  });

  test("a failed Boss reference preserves completed Overall and succeeds on a fresh retry", async () => {
    const f = wclFixture();
    const overall = f.entry("Overall");
    const boss = f.entry("Boss");
    f.rankings = ({ metric }: RankingQuery) => {
      if (metric === "bossdps") throw new Error("boss leaderboard temporarily unavailable");
      return [overall];
    };
    const first = await buildComparison(f.client, f.params);
    assert.equal(first.b.name, overall.name);
    assert.equal(first.bossReference, null);
    assert.match(first.bossReferenceError ?? "", /temporarily unavailable/);
    f.rankings = ({ metric }: RankingQuery) => [metric === "bossdps" ? boss : overall];
    const second = await buildComparison(f.client, f.params);
    assert.equal(second.b.name, overall.name);
    assert.equal(second.bossReference!.b.name, boss.name);
  });

  test("unmirrorable Boss rankings are explicit, never relabeled Overall references", async () => {
    const f = wclFixture();
    const overall = f.entry("Overall");
    f.rankings = ({ metric }: RankingQuery) => metric === "dps" ? [overall]
      : [{ name: "Anonymous", report: { code: "a:hidden", fightID: 1 } }];
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.b.name, overall.name);
    assert.equal(out.bossReference, null);
    assert.match(out.bossReferenceError ?? "", /no mirrorable bossdps/);
  });

  test("HPS retains one reference and existing self exclusion, with only healing streams", async () => {
    const f = wclFixture();
    const top = f.entry("Healer");
    f.rankings = () => [f.player, top];
    const out = await buildComparison(f.client, { ...f.params, metric: "hps" });
    assert.equal(out.b.name, top.name);
    assert.equal(out.metric, "hps");
    assert.equal("bossReference" in out, false);
    assert.equal("bossReferenceError" in out, false);
    assert.deepEqual(worldCalls(f).map((c: QueryCall) => c.variables.metric), ["hps"]);
    assert.equal(f.calls.some((c: QueryCall) => c.query.includes("dataType: DamageDone")), false);
    assert.equal(out.a.actorID, 1);
    assert.deepEqual(out.a.dmg, { Fireball: 60000 });
  });

  test("a pinned unranked fight retains exact player report/fight/actor for both references", async () => {
    const f = wclFixture();
    const pinned = f.entry("Pinned", {
      name: f.params.name, fightID: 2, dmg: { "Arcane Blast": 240000 }, casts: [[1, "Arcane Blast"]],
    });
    const top = f.entry("Top");
    f.rankings = () => [top];
    const out = await buildComparison(f.client, { ...f.params, code: pinned.report.code, fightID: 2 });
    assert.equal(out.a.code, pinned.report.code);
    assert.equal(out.a.fightID, 2);
    assert.equal(out.a.actorID, 1);
    assert.equal(out.a.amount, 2000);
    assert.equal(out.a.rankPercent, 0);
    assert.deepEqual(out.a.casts, [[1, "Arcane Blast"]]);
    assert.equal(streamCalls(f).filter((c: QueryCall) => c.variables.code === pinned.report.code).length, 1);
  });
});

describe("CastMirror realm-specific PI, hero and summary evidence", () => {
  test("query fixtures cannot invent actor IDs or realms omitted by the production GraphQL selection", async () => {
    const f = wclFixture();
    const probe = async (fields: string) => (await f.client.query(
      `query($code: String!) { reportData { report(code: $code) { masterData { actors(type: "Player") { ${fields} } } } } }`,
      { code: f.player.report.code },
    )).reportData.report.masterData.actors[0];
    assert.deepEqual(await probe("name"), { name: f.params.name });
    assert.deepEqual(await probe("id name"), { id: f.actorFor(f.player).id, name: f.params.name });
    assert.deepEqual(await probe("id name server"), { id: f.actorFor(f.player).id, name: f.params.name, server: "Test Realm" });
  });

  for (const playerPI of [true, false]) {
    test(`an earlier cross-realm namesake cannot change player PI=${playerPI} or either ranking pool`, async () => {
      const f = wclFixture({ playerPI, playerHero: "Sunfury" });
      f.entry("EarlierNamesake", {
        name: f.params.name, code: f.player.report.code, server: "Other Realm", prepend: true,
        pi: !playerPI, hero: "Spellslinger",
      });
      const overall = f.entry("Overall", { hero: "Sunfury" }), boss = f.entry("Boss", { hero: "Sunfury" });
      f.rankings = ({ metric }: RankingQuery) => [metric === "dps" ? overall : boss];
      const out = await buildComparison(f.client, f.params);
      assert.equal(out.a.actorID, f.actorFor(f.player).id);
      assert.deepEqual(out.a.casts, [[0, "Arcane Phoenix"], [10, "Arcane Phoenix"]]);
      assert.equal(out.hero.a, "Sunfury");
      assert.equal(out.pi.a, playerPI);
      assert.equal(out.bossReference!.pi.a, playerPI);
      assert.deepEqual(worldCalls(f).map((call: QueryCall) => [call.variables.metric, call.variables.xb]).sort(), [
        ["bossdps", playerPI ? "Any" : "Exclude"], ["dps", playerPI ? "Any" : "Exclude"],
      ]);
      assert.equal(f.calls.some((call: QueryCall) => call.query.includes("dataType: Summary")), false, "the authoritative character-rank spec must stay unchanged");
    });
  }

  for (const overallPI of [true, false]) {
    test(`same-report same-name references on distinct realms keep independent PI=${overallPI}/${!overallPI} and actor streams`, async () => {
      const f = wclFixture({ playerPI: true });
      const overall = f.entry("Namesake", { server: "Red Realm", pi: overallPI, hero: "Spellslinger", amount: 2200 });
      const boss = f.entry("Namesake", { name: overall.name, code: overall.report.code, server: "Blue Realm", pi: !overallPI, hero: "Sunfury", amount: 1700 });
      f.rankings = ({ metric }: RankingQuery) => [metric === "dps" ? overall : boss];
      const out = await buildComparison(f.client, f.params);
      assert.equal(out.b.name, out.bossReference!.b.name);
      assert.equal(out.b.actorID, f.actorFor(overall).id);
      assert.equal(out.bossReference!.b.actorID, f.actorFor(boss).id);
      assert.notEqual(out.b.actorID, out.bossReference!.b.actorID);
      assert.equal(out.b.server, "Red Realm"); assert.equal(out.bossReference!.b.server, "Blue Realm");
      assert.deepEqual(out.pi, { a: true, b: overallPI, excluded: false });
      assert.deepEqual(out.bossReference!.pi, { a: true, b: !overallPI, excluded: false });
      assert.equal(out.hero.b, "Spellslinger"); assert.equal(out.bossReference!.hero.b, "Sunfury");
      assert.deepEqual(out.b.casts, [[0, "Arcane Splinter"], [10, "Arcane Splinter"]]);
      assert.deepEqual(out.bossReference!.b.casts, [[0, "Arcane Phoenix"], [10, "Arcane Phoenix"]]);
      assert.equal(out.b.amount, 2200); assert.equal(out.bossReference!.b.amount, 1700);
    });
  }

  test("candidate hero evidence and both memoization layers distinguish same-report namesakes by realm", async () => {
    const f = wclFixture({ playerHero: "Sunfury" });
    const splinter = f.entry("Namesake", { server: "Red Realm", hero: "Spellslinger", talents: talents(20) });
    const phoenix = f.entry("Namesake", { name: splinter.name, code: splinter.report.code, server: "Blue Realm", hero: "Sunfury", talents: talents(10) });
    const pool = [splinter, f.entry("SplinterSecond", { hero: "Spellslinger", talents: talents(20) }), phoenix,
      f.entry("PhoenixSecond", { hero: "Sunfury", talents: talents(10) })];
    f.rankings = ({ metric }: RankingQuery) => pool.map((entry) => ({ ...entry, amount: metric === "dps" ? 2200 : 1700 }));
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.b.actorID, f.actorFor(phoenix).id);
    assert.equal(out.bossReference!.b.actorID, f.actorFor(phoenix).id);
    assert.equal(out.b.server, "Blue Realm"); assert.equal(out.bossReference!.b.server, "Blue Realm");
    assert.equal(out.hero.b, "Sunfury"); assert.equal(out.bossReference!.hero.b, "Sunfury");
    assert.equal(out.b.amount, 2200); assert.equal(out.bossReference!.b.amount, 1700);
    assert.deepEqual(out.b.casts, [[0, "Arcane Phoenix"], [10, "Arcane Phoenix"]]);
    const alternate = await buildComparison(f.client, { ...f.params, hero: "Spellslinger" });
    assert.equal(alternate.b.actorID, f.actorFor(splinter).id);
    assert.equal(alternate.bossReference!.b.actorID, f.actorFor(splinter).id);
    assert.equal(alternate.b.server, "Red Realm"); assert.equal(alternate.hero.b, "Spellslinger");
  });

  test("unique realm-less player and candidate identities retain name fallback for PI and hero evidence", async () => {
    const f = wclFixture({ playerPI: true, playerHero: "Sunfury", playerServer: null });
    const pool = [
      f.entry("Splinter", { server: null, hero: "Spellslinger", talents: talents(20) }),
      f.entry("SplinterSecond", { server: null, hero: "Spellslinger", talents: talents(20) }),
      f.entry("Phoenix", { server: null, hero: "Sunfury", talents: talents(10), pi: true }),
      f.entry("PhoenixSecond", { server: null, hero: "Sunfury", talents: talents(10), pi: true }),
    ];
    f.rankings = () => pool;
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.a.actorID, f.actorFor(f.player).id);
    assert.equal(out.b.actorID, f.actorFor(pool[2]).id);
    assert.equal(out.b.name, pool[2].name); assert.equal(out.bossReference!.b.name, pool[2].name);
    assert.deepEqual(out.pi, { a: true, b: true, excluded: false });
    assert.deepEqual(out.bossReference!.pi, { a: true, b: true, excluded: false });
    assert.equal(out.hero.a, "Sunfury"); assert.equal(out.hero.b, "Sunfury");
    assert.equal(out.bossReference!.hero.b, "Sunfury");
  });

  test("ambiguous realm-less player evidence fails closed before choosing either ranking pool", async () => {
    const f = wclFixture({ playerPI: true, playerServer: null });
    const top = f.entry("Top"); f.rankings = () => [top];
    const query = f.client.query.bind(f.client);
    f.client.query = async (source: string, variables: Record<string, unknown> = {}) => {
      const out = await query(source, variables);
      if (variables.code === f.player.report.code && source.includes("masterData")) {
        out.reportData.report.masterData.actors.push({ id: 999, name: f.params.name, server: null });
      }
      return out;
    };
    await assert.rejects(buildComparison(f.client, f.params), /identity missing or ambiguous/);
    assert.equal(worldCalls(f).length, 0);
  });

  for (const ambiguity of ["duplicate realm-less actor", "known realm mismatch"]) {
    test(`candidate hero ${ambiguity} fails closed rather than classifying a different actor`, async () => {
      const f = wclFixture({ playerHero: "Sunfury" });
      const first = f.entry("Splinter", { server: ambiguity === "duplicate realm-less actor" ? null : "Reference Realm", hero: "Spellslinger", talents: talents(20) });
      const pool = [first, f.entry("SplinterSecond", { hero: "Spellslinger", talents: talents(20) }),
        f.entry("Phoenix", { hero: "Sunfury", talents: talents(10) }), f.entry("PhoenixSecond", { hero: "Sunfury", talents: talents(10) })];
      if (ambiguity === "known realm mismatch") first.server = { name: "Wrong Realm" };
      const query = f.client.query.bind(f.client);
      f.client.query = async (source: string, variables: Record<string, unknown> = {}) => {
        const out = await query(source, variables);
        if (ambiguity === "duplicate realm-less actor" && variables.code === first.report.code && source.includes("masterData")) {
          out.reportData.report.masterData.actors.push({ id: 999, name: first.name, server: null });
        }
        return out;
      };
      f.rankings = () => pool;
      await assert.rejects(buildComparison(f.client, f.params), /identity missing or ambiguous/);
      assert.equal(f.calls.filter((call: QueryCall) => call.variables.code === first.report.code && call.query.includes("dataType: DamageDone")).length, 0);
    });
  }

  test("a pinned fight missing its rank accepts a unique matching summary spec without inventing an actor binding", async () => {
    const f = wclFixture(); f.ranks = [];
    const top = f.entry("Top"); f.rankings = () => [top];
    const out = await buildComparison(f.client, { ...f.params, code: f.player.report.code, fightID: 1 });
    assert.equal(out.spec, "Arcane"); assert.equal(out.a.actorID, f.actorFor(f.player).id);
    assert.equal(out.a.code, f.player.report.code); assert.equal(out.a.fightID, 1);
    assert.equal(f.calls.filter((call: QueryCall) => call.query.includes("dataType: Summary")).length, 1);
  });

  test("a pinned fight missing its rank rejects duplicate matching summary names rather than taking the first spec", async () => {
    const f = wclFixture(); f.ranks = [];
    f.entry("Namesake", { name: f.params.name, code: f.player.report.code, server: "Other Realm" });
    const top = f.entry("Top"); f.rankings = () => [top];
    await assert.rejects(buildComparison(f.client, { ...f.params, code: f.player.report.code, fightID: 1 }), /ambiguous|could not determine.*spec/);
    assert.equal(worldCalls(f).length, 0, "an ambiguous summary must not drive either specialization leaderboard");
  });
});

describe("CastMirror stream completeness and identity", () => {
  for (const stream of ["Casts", "Resources"]) {
    for (const [label, cursor] of [
      ["same", 100000], ["backwards", 99999], ["beyond fight end", 220001],
      ["string", "110000"], ["non-finite", NaN],
    ] as const) {
      test(`${stream} rejects a ${label} cursor instead of silently returning a partial stream`, async () => {
        const f = wclFixture();
        f.rankings = () => [f.entry("Top")];
        const query = f.client.query.bind(f.client);
        f.client.query = async (source: string, variables: Record<string, unknown> = {}) => {
          const out = await query(source, variables);
          if (variables.code === f.player.report.code && source.includes(`dataType: ${stream}`)) {
            out.reportData.report.events.nextPageTimestamp = cursor;
          }
          return out;
        };
        await assert.rejects(buildComparison(f.client, f.params), /cursor.*advance/i);
        assert.equal(f.calls.filter((c: QueryCall) => c.variables.code === f.player.report.code && c.query.includes(`dataType: ${stream}`)).length, 1);
      });
    }
    test(`${stream} requires an explicit nextPageTimestamp even for an empty page`, async () => {
      const f = wclFixture();
      const top = f.entry("Top");
      f.rankings = () => [top];
      const query = f.client.query.bind(f.client);
      f.client.query = async (source: string, variables: Record<string, unknown> = {}) => {
        const out = await query(source, variables);
        if (variables.code === f.player.report.code && source.includes(`dataType: ${stream}`)) {
          out.reportData.report.events = { data: [] };
        }
        return out;
      };
      await assert.rejects(buildComparison(f.client, f.params), /Incomplete analysis stream/);
    });
    test(`${stream} rejects a malformed data array`, async () => {
      const f = wclFixture();
      const top = f.entry("Top");
      f.rankings = () => [top];
      const query = f.client.query.bind(f.client);
      f.client.query = async (source: string, variables: Record<string, unknown> = {}) => {
        const out = await query(source, variables);
        if (variables.code === f.player.report.code && source.includes(`dataType: ${stream}`)) {
          out.reportData.report.events.data = null;
        }
        return out;
      };
      await assert.rejects(buildComparison(f.client, f.params), /Incomplete analysis stream/);
    });
    test(`${stream} stops at its twenty-page cap even when cursors keep advancing`, async () => {
      const f = wclFixture();
      const top = f.entry("Top");
      f.rankings = () => [top];
      const query = f.client.query.bind(f.client);
      f.client.query = async (source: string, variables: Record<string, unknown> = {}) => {
        const out = await query(source, variables);
        if (variables.code === f.player.report.code && source.includes(`dataType: ${stream}`)) {
          out.reportData.report.events = { data: [], nextPageTimestamp: Number(variables.s) + 1 };
        }
        return out;
      };
      await assert.rejects(buildComparison(f.client, f.params), /stream page cap reached/i);
      assert.equal(f.calls.filter((c: QueryCall) => c.variables.code === f.player.report.code && c.query.includes(`dataType: ${stream}`)).length, 20);
    });
  }

  test("two advancing cast/resource pages concatenate each actor's full-fight data", async () => {
    const f = wclFixture();
    const top = f.entry("Top");
    f.rankings = () => [top];
    const query = f.client.query.bind(f.client);
    f.client.query = async (source: string, variables: Record<string, unknown> = {}) => {
      const out = await query(source, variables);
      if (source.includes("dataType: Casts")) {
        out.reportData.report.events = {
          data: [{ type: "cast", timestamp: Number(variables.s), abilityGameID: 100 }],
          nextPageTimestamp: variables.s === 100000 ? 110000 : null,
        };
      } else if (source.includes("dataType: Resources")) {
        out.reportData.report.events = {
          data: [{ type: "resourcechange", resourceChangeType: 0, resourceChange: 25, waste: 2 }],
          nextPageTimestamp: variables.s === 100000 ? 110000 : null,
        };
      }
      return out;
    };
    const out = await buildComparison(f.client, f.params);
    assert.deepEqual(out.a.casts, [[0, "Fireball"], [10, "Fireball"]]);
    assert.deepEqual(out.b.casts, out.a.casts);
    assert.equal(out.a.resources[0].gained, 50);
    assert.equal(out.b.resources[0].waste, 4);
  });

  test("a Boss-only incomplete stream leaves completed Overall/player data intact", async () => {
    const f = wclFixture();
    const overall = f.entry("Overall");
    const boss = f.entry("Boss");
    f.rankings = ({ metric }: RankingQuery) => [metric === "dps" ? overall : boss];
    const query = f.client.query.bind(f.client);
    f.client.query = async (source: string, variables: Record<string, unknown> = {}) => {
      const out = await query(source, variables);
      if (variables.code === boss.report.code && source.includes("dataType: Casts")) {
        delete out.reportData.report.events.nextPageTimestamp;
      }
      return out;
    };
    const out = await buildComparison(f.client, f.params);
    assert.equal(out.b.name, overall.name);
    assert.equal(out.a.name, f.params.name);
    assert.equal(out.bossReference, null);
    assert.match(out.bossReferenceError ?? "", /Incomplete analysis stream/);
  });

  test("ambiguous actor identity is rejected rather than selecting another actor", async () => {
    const f = wclFixture();
    const top = f.entry("Top");
    f.rankings = () => [top];
    const query = f.client.query.bind(f.client);
    f.client.query = async (source: string, variables: Record<string, unknown> = {}) => {
      const out = await query(source, variables);
      if (variables.code === f.player.report.code && source.includes("abilities { gameID name }")) {
        out.reportData.report.masterData.actors.push({ id: 999, name: f.params.name, server: f.params.server });
      }
      return out;
    };
    await assert.rejects(buildComparison(f.client, f.params), /identity missing or ambiguous/);
  });
});
