import assert from "node:assert/strict";
import { describe, test } from "vitest";
import snapshotData from "../../data/castmirror/guild-execution.json";
import type { RaidBossReview, RaidRole } from "../../app/api/castmirror/execution/raid/types";
import { buildRankingStability } from "../../app/castmirror/guild-execution/stability";

function fixture(name: string, contacts: number[], samples = 3, role: RaidRole = "dps") {
  const originals = snapshotData.raiders[0].reviews as RaidBossReview[];
  return originals.slice(0, contacts.length).map((original, bossIndex) => {
    const review = structuredClone(original);
    review.identity.name = name; review.status = "complete";
    review.reviewedScopes = [{ partition: review.scope.partition, patch: review.scope.patch }];
    review.fights = Array.from({ length: samples }, (_, index) => {
      const fight = structuredClone(original.fights[0]);
      fight.code = "AAAAAAAAAAAAAAAA"; fight.fightID = bossIndex * 100 + index + 1; fight.role = role;
      fight.scope = { partition: review.scope.partition, patch: review.scope.patch };
      fight.damage = { complete: true, total: contacts[bossIndex] * 10, avoidableHealth: contacts[bossIndex] * 10, avoidableAbsorbed: 0,
        abilities: [{ abilityID: 1, name: "Fixture", health: contacts[bossIndex] * 10, absorbed: 0, hits: contacts[bossIndex], clusters: contacts[bossIndex], contextual: false }] };
      fight.survival = { complete: true, deaths: [] };
      fight.utility = { complete: true, successfulInterrupts: 0, dispels: 0, raidAbsorbed: 0, absorbAbilities: [], personalCasts: [] };
      return fight;
    });
    return review;
  });
}
const peer = (name: string, contacts: number[]) => { const reviews = fixture(name, contacts); return { identity: reviews[0].identity, reviews }; };

describe("saved ranking deletion sensitivity", () => {
  test("recomputes capped boss weights and competition ranks with other raiders fixed", () => {
    const result = buildRankingStability(fixture("Subject", [0, 4]), { role: "primary", patch: "all" }, [peer("Better", [1]), peer("Lower", [3])]);
    assert.equal(result.baselineScore, 79); assert.equal(result.baselineRank, 1);
    assert.deepEqual(result.killRemoval, { cases: 6, ungradedCases: 0, scoreMin: 74.8, scoreMax: 83.2, rankMin: 1, rankMax: 1 });
    assert.deepEqual(result.bossRemoval, { cases: 2, ungradedCases: 0, scoreMin: 58, scoreMax: 100, rankMin: 1, rankMax: 3 });
  });
  test("removing the only evidence cannot manufacture a clean score or ordinal", () => {
    const result = buildRankingStability(fixture("Subject", [2], 1), { patch: "all" }, []);
    for (const range of [result.killRemoval, result.bossRemoval]) assert.deepEqual(range, { cases: 1, ungradedCases: 1, scoreMin: null, scoreMax: null, rankMin: null, rankMax: null });
  });
  test("keeps the selected subject role fixed instead of falling back to another role", () => {
    const reviews = fixture("Subject", [2], 1);
    const tank = structuredClone(reviews[0].fights[0]); tank.role = "tank"; tank.fightID = 1001;
    tank.damage.abilities.forEach(ability => { ability.clusters = 0; ability.health = 0; });
    reviews[0].fights.push(tank);
    const result = buildRankingStability(reviews, { role: "primary", patch: "all" }, []);
    assert.equal(result.baselineScore, 64); assert.equal(result.killRemoval.ungradedCases, 1);
    assert.equal(result.killRemoval.scoreMax, null);
  });
  test("missing current evidence and identity-mismatched peers stay ungraded or excluded", () => {
    const reviews = fixture("Subject", [2]);
    assert.equal(buildRankingStability(reviews, { patch: "unknown-patch" }, []).status, "unavailable");
    const wrong = peer("Better", [0]); wrong.identity = { ...wrong.identity, name: "Different character" };
    assert.equal(buildRankingStability(reviews, { patch: "all" }, [wrong]).baselineRank, 1);
    const otherRules = peer("Other rules", [0]); otherRules.reviews.forEach(review => { review.rulesVersion += "-different"; });
    assert.equal(buildRankingStability(reviews, { patch: "all" }, [otherRules]).baselineRank, 1);
  });
  test("saved baseline and source objects remain exact", () => {
    const before = JSON.stringify(snapshotData);
    const raider = snapshotData.raiders.find(value => value.identity.name === "Bstay")!;
    const result = buildRankingStability(raider.reviews as RaidBossReview[], { role: "primary", patch: "all", currentPatch: snapshotData.currentPatch }, snapshotData.raiders as unknown as Parameters<typeof buildRankingStability>[2]);
    assert.equal(result.baselineScore, 62.9); assert.equal(result.baselineRank, 26);
    assert.equal(result.killRemoval.cases, 23); assert.equal(result.bossRemoval.cases, 5);
    assert.equal(JSON.stringify(snapshotData), before);
    assert.match(result.limitation, /not statistical confidence/);
  });
});
