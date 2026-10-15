import { describe, expect, it } from "vitest";
import { clusterContactIncidents, executionLetter, gradeBoss, gradeRaid } from "../../app/api/castmirror/execution/raid/grade";
import type { RaidBossReview, RaidContactEvent, RaidFightEvidence } from "../../app/api/castmirror/execution/raid/types";

function fight(overrides: Partial<RaidFightEvidence> = {}): RaidFightEvidence {
  return {
    code: "LJ317qRxH2MXvPkD", fightID: 1, actorID: 59, spec: "Havoc", role: "dps", kill: true,
    date: 1_792_000_000_000, durationSec: 360,
    damage: { complete: true, total: 10_000_000, avoidableHealth: 0, avoidableAbsorbed: 0, abilities: [
      { abilityID: 1288554, name: "Latent Cultist", health: 0, absorbed: 0, hits: 0, clusters: 0, contextual: false },
      { abilityID: 1294846, name: "Anguished Echoes", health: 0, absorbed: 0, hits: 0, clusters: 0, contextual: false },
    ] },
    survival: { complete: true, deaths: [] },
    utility: { complete: true, successfulInterrupts: 0, dispels: 0, raidAbsorbed: 0, absorbAbilities: [], personalCasts: [] },
    limitations: [], ...overrides,
  };
}

function contacted(incidents: number, id = 1): RaidFightEvidence {
  const evidence = fight({ fightID: id });
  evidence.damage.abilities[0] = { ...evidence.damage.abilities[0], health: incidents * 100_000, hits: incidents * 4, clusters: incidents };
  evidence.damage.avoidableHealth = incidents * 100_000;
  return evidence;
}

function death(evidence: RaidFightEvidence, avoidable: boolean, at = 240): RaidFightEvidence {
  return { ...evidence, survival: { complete: true, deaths: [{ at, causeID: avoidable ? 1288554 : 1,
    causeName: avoidable ? "Latent Cultist" : "Melee", reviewedAvoidable: avoidable, raidDeathOrder: 1 }] } };
}

function review(fights: RaidFightEvidence[], overrides: Partial<RaidBossReview> = {}): RaidBossReview {
  return {
    version: "raid-execution-review-1", key: "Bstay:3470", at: 1_792_000_000_000,
    rulesVersion: "native-live-statistics-4-0123456789abcdef",
    identity: { name: "Bstay", server: "Mal'Ganis", region: "US", className: "DemonHunter" },
    scope: { zone: 53, encounter: 3470, difficulty: 5, size: 20, partition: 2, patch: "12.1.5" },
    boss: { id: 3470, name: "Nek'zali" }, status: "complete", reason: null,
    availableKills: fights.filter((entry) => entry.kill).length, fights, sampleLimit: 6, ...overrides,
  };
}

describe("reviewed contact clustering", () => {
  const event = (at: number, abilityID = 1, health = 10, absorbed = 0): RaidContactEvent => ({ at, abilityID, health, absorbed });

  it("groups adjacent dot ticks rather than treating every tick as a movement mistake", () => {
    expect(clusterContactIncidents([event(5_000), event(0), event(10_000), event(16_000)])).toBe(2);
  });

  it("tracks separate abilities independently", () => {
    expect(clusterContactIncidents([event(0, 1), event(2_000, 2), event(4_000, 1), event(8_000, 2)])).toBe(3);
  });

  it("ignores immune zero-damage contacts and does not let them bridge two incidents", () => {
    expect(clusterContactIncidents([event(0), event(4_000, 1, 0), event(8_000)])).toBe(2);
  });

  it("counts genuinely absorbed incoming damage", () => {
    expect(clusterContactIncidents([event(0, 1, 0, 20)])).toBe(1);
  });

  it("rejects malformed event timestamps and ability IDs", () => {
    expect(clusterContactIncidents([event(NaN), event(0, -1), event(0, 1.5), event(0, 1, -1), event(0)])).toBe(1);
  });
});

describe("boss non-damage execution rubric", () => {
  it("uses a complete survived clean sample with enough independent rules", () => {
    const grade = gradeBoss(review([fight({ fightID: 1 }), fight({ fightID: 2 }), fight({ fightID: 3 })]));
    expect(grade).toMatchObject({ letter: "A", score: 100, provisional: false, mechanics: { cleanKills: 3 } });
  });

  it("scores contact incidents, not inflated tick counts or damage magnitude", () => {
    const first = contacted(2);
    const second = structuredClone(first);
    second.damage.abilities[0].hits = 200;
    second.damage.abilities[0].health = 20_000_000;
    expect(gradeBoss(review([first])).score).toBe(90);
    expect(gradeBoss(review([second])).score).toBe(90);
  });

  it("does not score immune contacts even if raw events counted them", () => {
    const immune = fight();
    immune.damage.abilities[0].clusters = 6;
    immune.damage.abilities[0].hits = 20;
    expect(gradeBoss(review([immune])).score).toBe(100);
    expect(gradeBoss(review([immune])).mechanics.incidents).toBe(0);
  });

  it("keeps context-dependent Swirling Spirit visible without blame even if mislabeled", () => {
    const evidence = contacted(1);
    evidence.damage.abilities.push({ abilityID: 1300239, name: "Swirling Spirit", health: 1_000_000, absorbed: 0, hits: 10, clusters: 5, contextual: false });
    evidence.survival.deaths.push({ at: 200, causeID: 1300239, causeName: "Swirling Spirit", reviewedAvoidable: true, raidDeathOrder: 1 });
    const grade = gradeBoss(review([evidence, contacted(1, 2)]));
    expect(grade.score).toBe(95);
    expect(grade.mechanics.contextualIncidents).toBe(5);
    expect(grade.survival).toEqual({ deaths: 1, confirmedAvoidableDeaths: 0, contextDeaths: 1 });
  });

  it("does not fabricate a grade from exclusively contextual rules", () => {
    const evidence = fight();
    evidence.damage.abilities = [{ abilityID: 1300239, name: "Swirling Spirit", health: 0, absorbed: 0, hits: 0, clusters: 0, contextual: true }];
    expect(gradeBoss(review([evidence]))).toMatchObject({ score: null, letter: null, status: "ungraded" });
  });

  it("penalizes a directly attributed avoidable death", () => {
    expect(gradeBoss(review([death(contacted(1), true)]))).toMatchObject({ score: 60, letter: "D", provisional: true,
      survival: { confirmedAvoidableDeaths: 1 } });
  });

  it("does not assume an arbitrary fatal cause is avoidable", () => {
    const evidence = death(contacted(1), false);
    evidence.survival.deaths[0].reviewedAvoidable = true;
    expect(gradeBoss(review([evidence, contacted(1, 2)]))).toMatchObject({ score: 95, survival: { confirmedAvoidableDeaths: 0, contextDeaths: 1 } });
  });

  it("does not reward an unproven early death for fewer later contacts", () => {
    const baseline = contacted(4, 1);
    const shortened = death(fight({ fightID: 2 }), false, 30);
    expect(gradeBoss(review([baseline, shortened])).score).toBe(80);
    expect(gradeBoss(review([baseline, shortened])).provisional).toBe(true);
  });

  it("does not reward an avoidable early death for fewer later contacts", () => {
    const baseline = contacted(10, 1);
    const shortened = death(contacted(1, 2), true, 30);
    expect(gradeBoss(review([baseline, shortened])).score).toBe(50);
  });

  it("leaves exclusively unproven death-shortened samples ungraded", () => {
    expect(gradeBoss(review([death(fight(), false)]))).toMatchObject({ score: null, status: "ungraded", provisional: true });
  });

  it("does not convert incomplete avoidance or survival into clean credit", () => {
    const missingDamage = fight({ fightID: 1 });
    missingDamage.damage.complete = false;
    const missingSurvival = fight({ fightID: 2 });
    missingSurvival.survival.complete = false;
    expect(gradeBoss(review([missingDamage, missingSurvival]))).toMatchObject({ score: null, sample: { gradedFights: 0 }, mechanics: { cleanKills: 0 } });
  });

  it("does not accept nonfinite values or damage without recovered incident evidence", () => {
    const missingEvents = contacted(1);
    missingEvents.damage.abilities[0].clusters = 0;
    const malformed = contacted(1, 2);
    malformed.damage.abilities[0].health = NaN;
    expect(gradeBoss(review([missingEvents, malformed])).score).toBe(null);
  });

  it("rejects fractional contact counts rather than rounding away positive damage", () => {
    const malformed = contacted(1);
    malformed.damage.abilities[0].clusters = 0.5;
    expect(gradeBoss(review([malformed])).score).toBe(null);
  });

  it("shows progression evidence without claiming clean unseen phases", () => {
    const progression = fight({ kill: false, durationSec: 50 });
    const grade = gradeBoss(review([progression]));
    expect(grade).toMatchObject({ status: "ungraded", score: null, provisional: true, sample: { progression: 1, gradedFights: 0 } });
    expect(grade.limitations.join(" ")).toContain("later phases may be unseen");
  });

  it("reports successful utility but does not award casts or arbitrary opportunity points", () => {
    const evidence = contacted(2);
    const before = gradeBoss(review([evidence]));
    evidence.utility = { complete: true, successfulInterrupts: 15, dispels: 9, raidAbsorbed: 9_000_000,
      absorbAbilities: [{ abilityID: 196718, name: "Darkness", amount: 9_000_000 }], personalCasts: [{ abilityID: 196718, name: "Darkness", count: 25 }] };
    const after = gradeBoss(review([evidence]));
    expect(after.score).toBe(before.score);
    expect(after.utility).toMatchObject({ successfulInterrupts: 15, dispels: 9, raidAbsorbed: 9_000_000 });
  });

  it("does not depend on incoming damage, damage output, healing output or personal cast volume", () => {
    const evidence = contacted(2);
    const before = gradeBoss(review([evidence])).score;
    evidence.damage.total = 1_000_000_000;
    Object.assign(evidence, { damageOutput: 9_000_000_000, healingOutput: 9_000_000_000 });
    evidence.utility.personalCasts.push({ abilityID: 1, name: "A button", count: 1_000_000 });
    expect(gradeBoss(review([evidence])).score).toBe(before);
  });

  it("flags missing utility as unknown rather than zero-contribution evidence", () => {
    const evidence = fight();
    evidence.utility.complete = false;
    const grade = gradeBoss(review([evidence]));
    expect(grade.provisional).toBe(true);
    expect(grade.utility.completeFights).toBe(0);
    expect(grade.limitations.join(" ")).toContain("observed lower bounds");
  });

  it("deduplicates the same public fight and actor", () => {
    const evidence = contacted(2);
    expect(gradeBoss(review([evidence, structuredClone(evidence)]))).toMatchObject({ score: 90, sample: { kills: 1 }, mechanics: { incidents: 2 } });
  });

  it("separates role samples and flags narrow reviewed ability coverage", () => {
    const tank = fight({ fightID: 2, role: "tank", spec: "Vengeance" });
    tank.damage.abilities.pop();
    const grade = gradeBoss(review([contacted(2), tank]));
    expect(grade.roles.map((role) => [role.role, role.score])).toEqual([["dps", 90], ["tank", 100]]);
    expect(grade.roles[1].provisional).toBe(true);
    expect(grade.roles[1].limitations.join(" ")).toContain("Only one independently reviewed mechanic");
  });

  it("bounds repeated-contact scores at zero", () => {
    expect(gradeBoss(review([contacted(100)])).score).toBe(0);
  });
});

describe("raid aggregation", () => {
  it("weights bosses equally regardless of the number of logs", () => {
    const cleanBoss = review(Array.from({ length: 6 }, (_, index) => fight({ fightID: index + 1 })));
    const badBoss = review([contacted(5)], { boss: { id: 3445, name: "Sentinels" }, key: "Bstay:3445" });
    expect(gradeRaid([cleanBoss, badBoss], 2)).toMatchObject({ score: 87.5, letter: "B+", gradedBosses: 2, totalBosses: 2 });
  });

  it("keeps missing bosses ungraded without assigning zero or perfect credit", () => {
    const only = review([contacted(2)]);
    const noEvidence = review([], { boss: { id: 3445, name: "Sentinels" }, status: "unavailable", reason: "No public kills" });
    expect(gradeRaid([only, noEvidence], 10)).toMatchObject({ score: 90, letter: "A−", gradedBosses: 1, totalBosses: 10, provisional: true });
  });

  it("leaves an empty review ungraded", () => {
    expect(gradeRaid([])).toMatchObject({ letter: null, score: null, gradedBosses: 0, totalBosses: 10, provisional: true });
  });

  it("uses the newest review once per boss, without duplicating utility", () => {
    const old = review([contacted(4)], { at: 1 });
    old.fights[0].utility.successfulInterrupts = 10;
    const newest = review([contacted(1)], { at: 2 });
    newest.fights[0].utility.successfulInterrupts = 2;
    expect(gradeRaid([old, newest], 1)).toMatchObject({ score: 95, gradedBosses: 1, utility: { successfulInterrupts: 2 } });
  });

  it("never combines different people, scopes or rule versions", () => {
    const valid = review([contacted(2)]);
    const other = review([fight()], { identity: { ...valid.identity, name: "Other" }, boss: { id: 3445, name: "Sentinels" } });
    const oldPatch = review([fight()], { scope: { ...valid.scope, patch: "12.1" }, boss: { id: 3455, name: "Vashnik" } });
    const oldRules = review([fight()], { rulesVersion: "old", boss: { id: 3420, name: "Sszorak" } });
    const grade = gradeRaid([valid, other, oldPatch, oldRules], 4);
    expect(grade).toMatchObject({ score: 90, gradedBosses: 1 });
    expect(grade.limitations.join(" ")).toContain("different raider, raid scope or rule version");
  });

  it("normalizes apostrophe/server slug spelling but preserves region separation", () => {
    const valid = review([contacted(2)]);
    const alias = review([contacted(1)], { identity: { ...valid.identity, name: "bstay", server: "malganis" }, boss: { id: 3445, name: "Sentinels" } });
    expect(gradeRaid([valid, alias], 2)).toMatchObject({ score: 92.5, gradedBosses: 2 });
  });

  it("aggregates roles with equal boss weight as well", () => {
    const first = review([contacted(1), fight({ fightID: 2, role: "tank" })]);
    const second = review([contacted(5)], { boss: { id: 3445, name: "Sentinels" } });
    const roles = gradeRaid([first, second], 2).roles;
    expect(roles.map((role) => [role.role, role.score, role.bosses])).toEqual([["dps", 85, 2], ["tank", 100, 1]]);
  });

  it("merges logged team-absorb ability evidence across bosses", () => {
    const first = review([fight()]);
    first.fights[0].utility.raidAbsorbed = 300;
    first.fights[0].utility.absorbAbilities.push({ abilityID: 1, name: "Barrier", amount: 300 });
    const second = review([fight()], { boss: { id: 3445, name: "Sentinels" } });
    second.fights[0].utility.raidAbsorbed = 700;
    second.fights[0].utility.absorbAbilities.push({ abilityID: 1, name: "Barrier", amount: 700 });
    expect(gradeRaid([first, second], 2).utility).toMatchObject({ raidAbsorbed: 1_000,
      absorbAbilities: [{ abilityID: 1, name: "Barrier", amount: 1_000 }] });
  });

  it("publishes stable explicit thresholds and rejects nonfinite scores", () => {
    expect([95, 90, 87, 83, 80, 77, 73, 70, 60, 59].map(executionLetter)).toEqual(["A", "A−", "B+", "B", "B−", "C+", "C", "C−", "D", "F"]);
    expect(executionLetter(null)).toBe(null);
    expect(executionLetter(NaN)).toBe(null);
  });
});
