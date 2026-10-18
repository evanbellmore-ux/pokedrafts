import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import snapshotData from "../../data/castmirror/guild-execution.json";
import { assessRaidRanking, compareSharedRaidRanking, gradeBoss, gradeRaid } from "../../app/api/castmirror/execution/raid/grade";
import type { RaidBossReview, RaidExecutionBreakdown, RaidFightEvidence, RaidRankingAssessment, RaidRole } from "../../app/api/castmirror/execution/raid/types";

const scopes = [{ partition: 1, patch: "12.1" }, { partition: 2, patch: "12.1.5" }];
const options = { role: "dps" as const, patch: "all", currentPatch: "12.1.5" };
function fight(id: number, incidents = 0, role: RaidRole = "dps"): RaidFightEvidence {
  return { code: "LJ317qRxH2MXvPkD", fightID: id, actorID: 101, spec: "Fixture", role, kill: true,
    date: 1_792_000_000_000 + id, durationSec: 360, scope: scopes[1],
    damage: { complete: true, total: 1_000_000, avoidableHealth: incidents * 100, avoidableAbsorbed: 0,
      abilities: [{ abilityID: 1288554, name: "Latent Cultist", health: incidents * 100, absorbed: 0, hits: incidents * 2, clusters: incidents, contextual: false }] },
    survival: { complete: true, deaths: [] },
    utility: { complete: true, successfulInterrupts: 0, dispels: 0, raidAbsorbed: 0, absorbAbilities: [], personalCasts: [] }, limitations: [] };
}
function review(fights: RaidFightEvidence[], id = 3470): RaidBossReview {
  return { version: "raid-execution-review-1", key: `Alice:${id}`, at: 1_792_100_000_000,
    rulesVersion: "native-live-statistics-4-test", identity: { name: "Alice", server: "Mal'Ganis", region: "us", className: "Fixture" },
    scope: { zone: 53, encounter: id, difficulty: 5, size: 20, partition: 2, patch: "12.1.5" }, reviewedScopes: scopes.map((s) => ({ ...s })),
    boss: { id, name: `Boss ${id}` }, status: "complete", reason: null, availableKills: fights.length, sampleLimit: 6, fights };
}
function died(f: RaidFightEvidence, avoidable = true, at = 120): RaidFightEvidence {
  f.survival.deaths.push({ at, causeID: avoidable ? 1288554 : 1300239, causeName: avoidable ? "Latent Cultist" : "Context cause",
    reviewedAvoidable: avoidable, raidDeathOrder: 1 });
  return f;
}
function assess(fights: RaidFightEvidence[]): RaidRankingAssessment { return assessRaidRanking([review(fights)], options); }
function components(b: RaidExecutionBreakdown) {
  return Object.fromEntries(b.components.map((c) => [c.key, { score: c.score, points: c.points, weight: c.weight }]));
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("versioned 30/30/40 execution reliability", () => {
  it("publishes the exact current rubric and retains the original boss grade separately", () => {
    const input = review([fight(1, 1), fight(2)]), result = assessRaidRanking([input], options);
    expect(result).toMatchObject({ version: "raid-ranking-assessment-2", score: 83.5,
      rubric: { version: "execution-reliability-rubric-2", weights: { consistency: 30, contactControl: 30, survival: 40 } } });
    expect(result.bosses[0].score).toBe(83.5); expect(result.bosses[0].grade).toEqual(gradeBoss(input));
    expect(result.bosses[0].grade.score).toBe(97.5);
    expect(components(result.breakdown)).toEqual({ consistency: { score: 50, points: 15, weight: 30 },
      contactControl: { score: 95, points: 28.5, weight: 30 }, survival: { score: 100, points: 40, weight: 40 } });
    expect(result.breakdown).toMatchObject({ gradeableKills: 2, affectedKills: 1, contactIncidents: 1, avoidableFatalKills: 0 });
  });
  it.each([
    [0, 100, 100, 100], [1, 67, 0, 90], [2, 64, 0, 80], [6, 52, 0, 40], [10, 40, 0, 0], [100, 40, 0, 0],
  ])("scores %i nonfatal contacts as %i while keeping consistency and volume distinct", (incidents, score, consistency, control) => {
    const result = assess([fight(1, incidents)]);
    expect(result.score).toBe(score);
    expect(components(result.breakdown)).toMatchObject({ consistency: { score: consistency }, contactControl: { score: control }, survival: { score: 100 } });
  });
  it("distinguishes repeated affected kills from concentrated volume with the same contact count", () => {
    const spread = assess([fight(1, 2), fight(2, 2), fight(3, 2)]), concentrated = assess([fight(1, 6), fight(2), fight(3)]);
    expect(spread.breakdown.contactIncidents).toBe(6); expect(concentrated.breakdown.contactIncidents).toBe(6);
    expect(spread.score).toBe(64); expect(concentrated.score).toBe(84);
    expect(spread.breakdown.affectedKills).toBe(3); expect(concentrated.breakdown.affectedKills).toBe(1);
    expect(components(spread.breakdown).contactControl.score).toBe(components(concentrated.breakdown).contactControl.score);
  });
  it("penalizes a proven fatal kill once rather than multiplying punishment for multiple death events", () => {
    const once = died(fight(1, 1)), repeated = structuredClone(once); died(repeated, true, 240);
    const a = assess([once]), b = assess([repeated]);
    expect(a.score).toBe(27); expect(b.score).toBe(a.score); expect(b.breakdown).toEqual(a.breakdown);
    expect(a.breakdown).toMatchObject({ affectedKills: 1, avoidableFatalKills: 1, contactIncidents: 1 });
    expect(components(a.breakdown)).toMatchObject({ consistency: { score: 0 }, contactControl: { score: 90 }, survival: { score: 0 } });
    const zeroContacts = assess([died(fight(2))]);
    expect(zeroContacts.score).toBe(30); expect(zeroContacts.breakdown).toMatchObject({ affectedKills: 1, contactIncidents: 0, avoidableFatalKills: 1 });
  });
  it("averages unrounded components using capped boss weights and rounds only the final score", () => {
    const input = [review([fight(1, 1), fight(2)]), review([fight(11, 2), fight(12), fight(13)], 3445)];
    const result = assessRaidRanking(input, options);
    expect(result.bosses.map((b) => [b.boss.id, b.weight])).toEqual([[3445, 3], [3470, 2]]);
    expect(components(result.breakdown)).toMatchObject({ consistency: { score: 60, points: 18 }, contactControl: { score: 94, points: 28.2 }, survival: { score: 100, points: 40 } });
    expect(result.score).toBe(86.2);
    const repeating = assess([fight(1, 1), fight(2), fight(3)]);
    expect(repeating.breakdown.components.find((c) => c.key === "consistency")!.score).toBeCloseTo(200 / 3, 12);
    expect(repeating.breakdown.components.find((c) => c.key === "consistency")!.points).toBeCloseTo(20, 12);
    expect(repeating.score).toBe(89);
    const roundingTrap = [review([died(fight(1, 1)), ...Array.from({ length: 5 }, (_, i) => fight(i + 2, 1))]), review([fight(11)], 3445)];
    const exact = assessRaidRanking(roundingTrap, options);
    expect(exact.bosses.find((b) => b.boss.id === 3470)!.score).toBe(60.3);
    expect(exact.score).toBe(70.3);
    const incorrectlyRoundedBossAverage = exact.bosses.reduce((n, b) => n + b.score! * b.weight, 0) / 4;
    expect(Math.round(incorrectlyRoundedBossAverage * 10) / 10).toBe(70.2);
  });
});

describe("saved evidence invariances", () => {
  it("does not change grades for death timing, raid order, fight duration, spec, or health scaling", () => {
    const original = [fight(1, 4), died(fight(2, 1))], altered = structuredClone(original);
    altered[1].survival.deaths[0].at = 359; altered[1].survival.deaths[0].raidDeathOrder = 20;
    for (const f of altered) { f.durationSec = 720; f.spec = "Changed display spec"; f.damage.total *= 1000;
      for (const a of f.damage.abilities) { a.health *= 1000; a.absorbed *= 1000; a.hits *= 100; } }
    expect(assess(altered).breakdown).toEqual(assess(original).breakdown); expect(assess(altered).score).toBe(assess(original).score);
  });
  it("keeps support volume and completeness outside every scoring component", () => {
    const original = [fight(1), fight(2, 2)], altered = structuredClone(original);
    for (const f of altered) f.utility = { complete: false, successfulInterrupts: 999, dispels: 888, raidAbsorbed: 1e12,
      absorbAbilities: [{ abilityID: 42, name: "Observed shield", amount: 1e12 }], personalCasts: [{ abilityID: 43, name: "Personal cast", count: 999 }] };
    const a = assess(original), b = assess(altered);
    expect(b.score).toBe(a.score); expect(b.breakdown).toEqual(a.breakdown); expect(b.rankEligible).toBe(a.rankEligible);
    expect(b.utilityConfidence).toBe("incomplete"); expect(b.utility.dispels).toBe(1776);
  });
  it("counts absorbed-only contact but ignores contextual and fully immune events", () => {
    const f = fight(1), immune = { ...f.damage.abilities[0], hits: 99, clusters: 9 };
    f.damage.abilities.push({ ...immune, abilityID: 1300239, health: 999 }, { ...immune, abilityID: 42, health: 999, contextual: true });
    expect(assess([f]).score).toBe(100);
    f.damage.abilities[0] = { ...f.damage.abilities[0], health: 0, absorbed: 100, clusters: 1, hits: 2 };
    expect(assess([f]).score).toBe(67); expect(assess([f]).breakdown.contactIncidents).toBe(1);
  });
  it("does not turn contextual, unknown or unmatched flagged death causes into proven fatal kills", () => {
    for (const causeID of [1300239, null, 999]) {
      const f = died(fight(2)); f.survival.deaths[0].causeID = causeID;
      const result = assess([fight(1), f]);
      expect(result.score).toBe(100); expect(result.breakdown.avoidableFatalKills).toBe(0);
    }
    const f = died(fight(1)); f.damage.abilities[0].contextual = true;
    expect(assess([f]).score).toBeNull();
  });
  it("withholds incomplete, empty, contextual-only, malformed and progression-only evidence", () => {
    const values = [fight(1), fight(2), fight(3), fight(4), fight(5), fight(6), fight(7)];
    values[0].damage.complete = false; values[1].survival.complete = false; values[2].damage.abilities = [];
    values[3].damage.abilities[0].contextual = true; values[4].durationSec = 0;
    values[5].damage.abilities[0].clusters = -1; values[6].kill = false;
    const result = assess(values);
    expect(result).toMatchObject({ score: null, gradeableKills: 0, gradedBosses: 0, rankEligible: false });
    expect(result.breakdown.components.every((c) => c.score === null && c.points === null)).toBe(true);
  });
  it.each([Number.NaN, 0, -1, 1.5])("rejects invalid reviewed ability ID %s only in the new model", (abilityID) => {
    const f = fight(1); f.damage.abilities[0].abilityID = abilityID;
    const input = review([f]), legacy = gradeBoss(input), legacyRaid = gradeRaid([input]);
    expect(legacy.score).toBe(100);
    expect(assessRaidRanking([input], options)).toMatchObject({ score: null, gradeableKills: 0 });
    expect(gradeBoss(input)).toEqual(legacy); expect(gradeRaid([input])).toEqual(legacyRaid);
  });
  it("withholds ambiguous duplicate ability rows instead of double counting or manufacturing clean credit", () => {
    for (const contacts of [0, 1]) {
      const f = fight(1, contacts); f.damage.abilities.push(structuredClone(f.damage.abilities[0]));
      const input = review([f]), legacy = gradeBoss(input), legacyRaid = gradeRaid([input]);
      expect(legacy.score).toBe(contacts ? 90 : 100);
      expect(assessRaidRanking([input], options)).toMatchObject({ score: null, gradeableKills: 0, breakdown: { contactIncidents: 0 } });
      expect(gradeBoss(input)).toEqual(legacy); expect(gradeRaid([input])).toEqual(legacyRaid);
    }
  });
});

describe("same-coverage shortened-exposure safeguards", () => {
  it("clamps both mechanics components to matched survived evidence without assigning context-death blame", () => {
    const result = assess([fight(1, 4), died(fight(2), false)]);
    expect(result.score).toBe(58);
    expect(result.breakdown).toMatchObject({ gradeableKills: 2, affectedKills: 1, contactIncidents: 4, avoidableFatalKills: 0, exposureAdjustedKills: 1, ungradedContextDeaths: 0 });
    expect(components(result.breakdown)).toMatchObject({ consistency: { score: 0 }, contactControl: { score: 60 }, survival: { score: 100 } });
  });
  it("does not erase worse observed contact control while applying the exposure ceiling", () => {
    const result = assess([fight(1, 4), died(fight(2, 6), false)]);
    expect(result.score).toBe(55); expect(result.breakdown.exposureAdjustedKills).toBe(0);
    expect(result.breakdown.contactIncidents).toBe(10);
  });
  it("applies the same ceiling to proven fatal kills while retaining fatal survival responsibility", () => {
    const result = assess([fight(1, 4), died(fight(2, 1))]);
    expect(result.score).toBe(38); expect(result.breakdown).toMatchObject({ avoidableFatalKills: 1, exposureAdjustedKills: 1 });
    expect(components(result.breakdown)).toMatchObject({ consistency: { score: 0 }, contactControl: { score: 60 }, survival: { score: 50 } });
  });
  it("does not borrow survivors across role, patch, partition or independently reviewed mechanic sets", () => {
    const context = died(fight(2), false);
    const variants = [fight(1, 4, "healer"), { ...fight(1, 4), scope: scopes[0] },
      { ...fight(1, 4), scope: { partition: 3, patch: "12.1.5" } }, fight(1, 4)];
    variants[3].damage.abilities.push({ ...fight(1).damage.abilities[0], abilityID: 1294846, name: "Other reviewed mechanic" });
    for (const survivor of variants) {
      const input = review([survivor, structuredClone(context)]);
      if (survivor.scope?.partition === 3) input.reviewedScopes!.push({ partition: 3, patch: "12.1.5" });
      const result = assessRaidRanking([input], options);
      expect(result.breakdown.ungradedContextDeaths).toBe(1); expect(result.breakdown.gradeableKills).toBe(survivor.role === "healer" ? 0 : 1);
    }
    expect(assess([died(fight(1), false)])).toMatchObject({ score: null, breakdown: { gradeableKills: 0, ungradedContextDeaths: 1 } });
    expect(assess([died(fight(1, 1))])).toMatchObject({ score: 27, breakdown: { gradeableKills: 1, ungradedContextDeaths: 0 } });
  });
  it("matches coverage as a set, excluding contextual rows and ignoring reviewed-row order", () => {
    const a = fight(1, 4), b = died(fight(2), false);
    for (const f of [a, b]) f.damage.abilities.push({ ...fight(3).damage.abilities[0], abilityID: 1294846 });
    b.damage.abilities.reverse(); b.damage.abilities.push({ ...fight(4).damage.abilities[0], abilityID: 1300239, health: 999, hits: 1, clusters: 1 });
    expect(assess([a, b])).toMatchObject({ score: 58, breakdown: { gradeableKills: 2, exposureAdjustedKills: 1, ungradedContextDeaths: 0 } });
  });
  it("excludes unmatched context exposure from primary-role kill counts and shared rescoring", () => {
    const a = review([died(fight(1), false), died(fight(2), false), fight(3, 0, "healer")]);
    expect(assessRaidRanking([a])).toMatchObject({ primaryRole: "healer", gradeableKills: 1, score: 100 });
    const b = structuredClone(a); b.identity.name = "Bob"; b.fights = b.fights.map((f) => ({ ...f, actorID: 202, survival: { complete: true, deaths: [] } }));
    const shared = compareSharedRaidRanking([a], [b], options);
    expect(shared).toMatchObject({ status: "insufficient-evidence", sharedFights: 2, a: { score: null, breakdown: { ungradedContextDeaths: 2 } }, b: { score: 100 } });
  });
});

describe("immutable saved legacy review output", () => {
  it("retains all146 original boss grades and26 original raid aggregates byte-for-byte as JSON", () => {
    const snapshot = snapshotData as unknown as { raiders: Array<{ reviews: RaidBossReview[] }> }, original = hash(snapshotData);
    const bosses = snapshot.raiders.map((r) => r.reviews.map(gradeBoss)), raids = snapshot.raiders.map((r) => gradeRaid(r.reviews, 10));
    expect(bosses.flat()).toHaveLength(146); expect(raids).toHaveLength(26);
    expect(hash(bosses)).toBe("343cd5eae9dd35203f4e0ba64e75f463d5a65108c17d0e8442a2024de937ca22");
    expect(hash(raids)).toBe("f85a12ecb5b0405e26b718440e8786b253198044c0e0ef72c917b4b445b1e8af");
    for (const raider of snapshot.raiders) assessRaidRanking(raider.reviews, options);
    expect(hash(snapshotData)).toBe(original);
    expect(snapshot.raiders.map((r) => r.reviews.map(gradeBoss))).toEqual(bosses);
    expect(snapshot.raiders.map((r) => gradeRaid(r.reviews, 10))).toEqual(raids);
  });
});
