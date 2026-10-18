import { describe, expect, it } from "vitest";
import { assessRaidRanking, compareSharedRaidRanking, gradeBoss, gradeRaid, selectRaidRankingReviews } from "../../app/api/castmirror/execution/raid/grade";
import type { RaidBossReview, RaidFightEvidence, RaidRole } from "../../app/api/castmirror/execution/raid/types";

const scopes = [{ partition: 1, patch: "12.1" }, { partition: 2, patch: "12.1.5" }];
const ids = [3470, 3445, 3455, 3497];
function fight(id: number, contacts = 0, role: RaidRole = "dps"): RaidFightEvidence {
  return { code: "LJ317qRxH2MXvPkD", fightID: id, actorID: 101, spec: "Test", role, kill: true,
    date: 1_792_000_000_000 + id, durationSec: 300, scope: scopes[1],
    damage: { complete: true, total: 1000, avoidableHealth: contacts * 100, avoidableAbsorbed: 0,
      abilities: [{ abilityID: 1288554, name: "Latent Cultist", health: contacts * 100, absorbed: 0, hits: contacts, clusters: contacts, contextual: false }] },
    survival: { complete: true, deaths: [] },
    utility: { complete: true, successfulInterrupts: 0, dispels: 0, raidAbsorbed: 0, absorbAbilities: [], personalCasts: [] }, limitations: [] };
}
function review(id: number, fights: RaidFightEvidence[], overrides: Partial<RaidBossReview> = {}): RaidBossReview {
  return { version: "raid-execution-review-1", key: `test:${id}`, at: 1_792_100_000_000,
    rulesVersion: "native-live-statistics-4-test", identity: { name: "Alice", server: "Mal'Ganis", region: "us", className: "Test" },
    scope: { zone: 53, encounter: id, difficulty: 5, size: 20, partition: 2, patch: "12.1.5" }, reviewedScopes: scopes,
    boss: { id, name: `Boss ${id}` }, status: "complete", reason: null, availableKills: fights.length, sampleLimit: 6, fights, ...overrides };
}
function kills(id: number, n: number, contacts = 0, role: RaidRole = "dps") {
  return review(id, Array.from({ length: n }, (_, i) => fight(id * 100 + i, contacts, role)));
}
function broader(role: RaidRole = "dps") { return ids.map((id) => kills(id, 3, 0, role)); }
function asOther(reviews: RaidBossReview[]) {
  return reviews.map((r) => ({ ...structuredClone(r), identity: { ...r.identity, name: "Bob" }, fights: r.fights.map((f) => ({ ...structuredClone(f), actorID: 202 })) }));
}
function contextDeath(f: RaidFightEvidence): RaidFightEvidence {
  return { ...f, survival: { complete: true, deaths: [{ at: 120, causeID: 1, causeName: "Needs context", reviewedAvoidable: false, raidDeathOrder: 1 }] } };
}

describe("additive role and evidence ranking", () => {
  it("keeps old graders and penalties unchanged while reducing one-kill boss weight", () => {
    const input = [kills(3470, 1, 10), kills(3445, 3)];
    expect(gradeBoss(input[0]).score).toBe(50);
    expect(gradeRaid(input).score).toBe(75);
    const assessed = assessRaidRanking(input);
    expect(assessed.score).toBe(85);
    expect(assessed.bosses.map((b) => b.weight).sort()).toEqual([1, 3]);
  });
  it("caps stable farm encounters at three without letting six kills dominate three", () => {
    const three = assessRaidRanking([kills(3470, 3), kills(3445, 3, 4)]);
    const six = assessRaidRanking([kills(3470, 6), kills(3445, 3, 4)]);
    expect(three.score).toBe(79); expect(six.score).toBe(79);
    expect(six.bosses.every((b) => b.weight === 3)).toBe(true);
  });
  it("requires four individually supported bosses, rather than twelve kills on one", () => {
    expect(assessRaidRanking(broader())).toMatchObject({ supportedBosses: 4, gradeableKills: 12, rankEligible: true, sampleLabel: "Broader sample", provisional: true });
    expect(assessRaidRanking([kills(3470, 12)])).toMatchObject({ supportedBosses: 1, score: 100, rankEligible: false, sampleLabel: "Limited sample" });
    expect(assessRaidRanking([...broader().slice(0, 3), kills(3497, 2)])).toMatchObject({ gradeableKills: 11, supportedBosses: 3, rankEligible: false });
  });
  it("preserves a limited numeric score without manufacturing an authoritative ordinal", () => {
    expect(assessRaidRanking([kills(3470, 1)])).toMatchObject({ score: 100, rankEligible: false, sample: "limited" });
    expect(assessRaidRanking([])).toMatchObject({ score: null, letter: null, role: null, primaryRole: null, utilityConfidence: "unavailable" });
  });
  it("selects primary by gradeable kills, never the best-scoring role", () => {
    const input = [review(3470, [...kills(3470, 5, 5).fights, fight(99, 0, "healer")])];
    expect(assessRaidRanking(input)).toMatchObject({ role: "dps", primaryRole: "dps", score: 55, sampledKills: 5 });
    expect(assessRaidRanking(input, { role: "healer" })).toMatchObject({ role: "healer", primaryRole: "dps", score: 100, sampledKills: 1 });
  });
  it("exposes primary ties and withholds its ordinal even with a broader sample", () => {
    const tied = broader().map((r) => ({ ...r, fights: [...r.fights.map((f) => ({ ...f, damage: { ...f.damage, abilities: [{ ...f.damage.abilities[0], health: 400, clusters: 4, hits: 4 }] } })),
      ...r.fights.map((f) => ({ ...structuredClone(f), fightID: f.fightID + 10, role: "healer" as const }))] }));
    expect(assessRaidRanking(tied)).toMatchObject({ role: "dps", score: 58, tiedRoles: ["dps", "healer"], primaryRoleAmbiguous: true, sample: "broader", rankEligible: false });
    expect(assessRaidRanking(tied, { role: "healer" })).toMatchObject({ score: 100, primaryRoleAmbiguous: true, rankEligible: true });
  });
  it("recomputes context-death baselines after isolating role", () => {
    const input = [review(3470, [contextDeath(fight(1)), fight(2, 0, "healer")])];
    expect(gradeBoss(input[0]).score).toBe(100);
    expect(assessRaidRanking(input, { role: "dps" })).toMatchObject({ score: null, gradeableKills: 0 });
    expect(assessRaidRanking(input)).toMatchObject({ primaryRole: "healer", score: 100 });
  });
  it("excludes incomplete mechanics and progression from supported kill counts", () => {
    const input = broader(); input[0].fights[0].damage.complete = false; input[1].fights[0].kill = false;
    expect(assessRaidRanking(input)).toMatchObject({ gradeableKills: 10, supportedBosses: 2, rankEligible: false });
  });
  it("does not let utility completeness or large support counts change the score or sample gate", () => {
    const input = broader(), before = assessRaidRanking(input);
    for (const r of input) for (const f of r.fights) f.utility = { ...f.utility, complete: false, successfulInterrupts: 999, dispels: 888, raidAbsorbed: 1e9 };
    const after = assessRaidRanking(input);
    expect(after.score).toBe(before.score); expect(after.rankEligible).toBe(true);
    expect(after.utilityConfidence).toBe("incomplete"); expect(after.utility.completeFights).toBe(0);
    expect(after.utility.successfulInterrupts).toBe(12 * 999);
  });
  it("does not mutate reviews or alter legacy grade output", () => {
    const input = broader(), copy = structuredClone(input), old = gradeRaid(input);
    selectRaidRankingReviews(input, { patch: "current" }); assessRaidRanking(input); compareSharedRaidRanking(input, asOther(input));
    expect(input).toEqual(copy); expect(gradeRaid(input)).toEqual(old);
  });
});

describe("reviewed patch and latest whole-boss isolation", () => {
  it("does not use historical survivors as a current context-death baseline", () => {
    const historic = { ...fight(1), scope: scopes[0] }, current = contextDeath(fight(2));
    const input = [review(3470, [historic, current])];
    expect(assessRaidRanking(input).score).toBe(100);
    expect(assessRaidRanking(input, { patch: "current" })).toMatchObject({ score: null, sampledKills: 1, gradeableKills: 0, sourcePatches: ["12.1.5"] });
    expect(assessRaidRanking(input, { patch: "12.1" })).toMatchObject({ score: 100, sampledKills: 1 });
  });
  it("never falls back to older boss captures to fill an empty current view", () => {
    const old = kills(3470, 3), latest = { ...kills(3470, 3), at: old.at + 1 };
    latest.fights = latest.fights.map((f) => ({ ...f, scope: scopes[0] }));
    expect(assessRaidRanking([old, latest], { patch: "current" })).toMatchObject({ score: null, sampledKills: 0, sourcePatches: [] });
    expect(assessRaidRanking([old, latest]).sampledKills).toBe(3);
    expect(assessRaidRanking([latest, old]).sampledKills).toBe(3);
  });
  it("respects an explicit current patch and refuses unknown or absent views", () => {
    const input = [kills(3470, 3)];
    expect(assessRaidRanking(input, { patch: "current", currentPatch: "12.2" }).score).toBeNull();
    expect(assessRaidRanking(input, { patch: "12.2" }).score).toBeNull();
    expect(assessRaidRanking(input, { patch: "current" }).patch).toBe("12.1.5");
  });
  it("requires an explicit exact partition/patch source binding", () => {
    const input = [review(3470, [fight(1, 0), { ...fight(2), scope: undefined }, { ...fight(3), scope: { partition: 1, patch: "12.1.5" } }, { ...fight(4), scope: { partition: 999, patch: "unknown" } }])];
    expect(assessRaidRanking(input)).toMatchObject({ sampledKills: 1, gradeableKills: 1 });
  });
  it("fails closed for conflicting reviewed scope declarations or an undeclared catalog anchor", () => {
    const a = kills(3470, 3); a.reviewedScopes = [scopes[0], { partition: 1, patch: "12.1.5" }];
    expect(assessRaidRanking([a]).score).toBeNull();
    a.reviewedScopes = [scopes[0]]; expect(assessRaidRanking([a]).score).toBeNull();
  });
  it("fails closed for malformed runtime scope and rule declarations without treating null as legacy", () => {
    const a = kills(3470, 3);
    expect(assessRaidRanking([{ ...a, reviewedScopes: null } as unknown as RaidBossReview]).score).toBeNull();
    expect(assessRaidRanking([{ ...a, scope: { ...a.scope, patch: 2 } } as unknown as RaidBossReview]).score).toBeNull();
    expect(assessRaidRanking([{ ...a, rulesVersion: 123 } as unknown as RaidBossReview]).score).toBeNull();
  });
  it("isolates exact identity, realm, region, rules and raid scope before dedupe", () => {
    const a = kills(3470, 3, 4);
    for (const mutate of [
      (r: RaidBossReview) => { r.identity.name = "Other"; }, (r: RaidBossReview) => { r.identity.server = "OtherRealm"; },
      (r: RaidBossReview) => { r.identity.region = "eu"; }, (r: RaidBossReview) => { r.rulesVersion += "different"; },
      (r: RaidBossReview) => { r.scope.difficulty = 4; }, (r: RaidBossReview) => { r.scope.encounter = 3445; },
    ]) { const b = structuredClone(a); b.at++; b.fights = b.fights.map((f) => fight(f.fightID)); mutate(b);
      expect(assessRaidRanking([a, b])).toMatchObject({ score: 58, sampledKills: 3 }); }
  });
  it("chooses primary within the patch view, without historical-role carryover", () => {
    const historic = kills(3470, 5, 0, "tank").fights.map((f) => ({ ...f, scope: scopes[0] }));
    const input = [review(3470, [...historic, fight(1, 4, "dps")])];
    expect(assessRaidRanking(input).primaryRole).toBe("tank");
    expect(assessRaidRanking(input, { patch: "current" })).toMatchObject({ primaryRole: "dps", role: "dps", score: 58 });
  });
  it("dedupes identical source rows but refuses conflicting actor or role bindings", () => {
    const f = fight(1);
    expect(assessRaidRanking([review(3470, [f, structuredClone(f)])]).sampledKills).toBe(1);
    expect(assessRaidRanking([review(3470, [f, { ...f, actorID: 202 }])]).score).toBeNull();
    expect(assessRaidRanking([review(3470, [f, { ...f, role: "healer" }])]).score).toBeNull();
    expect(assessRaidRanking([review(3470, [f]), review(3445, [f])]).score).toBeNull();
  });
  it("preserves explicit source patch and date labels", () => {
    const a = fight(1), b = { ...fight(2), scope: scopes[0] };
    expect(assessRaidRanking([review(3470, [b, a])])).toMatchObject({ sourcePatches: ["12.1", "12.1.5"], firstDate: a.date, lastDate: b.date });
  });
});

describe("shared kill comparison", () => {
  it("refuses self-comparison and an actor ID claimed by two different characters", () => {
    const a = broader();
    expect(compareSharedRaidRanking(a, structuredClone(a))).toMatchObject({ status: "insufficient-evidence", sharedFights: 0, reason: "Choose two distinct raiders for a shared-kill comparison." });
    const normalized = structuredClone(a); normalized.forEach((r) => { r.identity.name = "ALICE"; r.identity.server = "malganis"; r.identity.region = "US"; });
    expect(compareSharedRaidRanking(a, normalized).sharedFights).toBe(0);
    const b = asOther(a); b.forEach((r) => r.fights.forEach((f) => { f.actorID = 101; }));
    expect(compareSharedRaidRanking(a, b)).toMatchObject({ status: "insufficient-evidence", sharedFights: 0 });
    expect(compareSharedRaidRanking(a, b).exclusions.join(" ")).toContain("same actor");
  });
  it("compares only exact shared kills and retains both actual actor IDs", () => {
    const a = [review(3470, [fight(1, 2), fight(2, 10)])], b = asOther([review(3470, [fight(1), { ...fight(3), code: "OtherReportCode01" }])]);
    const c = compareSharedRaidRanking(a, b);
    expect(c).toMatchObject({ status: "compared", sharedFights: 1, sharedBosses: 1, a: { score: 64, sampledKills: 1, rankEligible: false }, b: { score: 100, sampledKills: 1 } });
    expect(c.sources[0]).toMatchObject({ code: "LJ317qRxH2MXvPkD", fightID: 1, actorA: 101, actorB: 202, role: "dps", patch: "12.1.5", partition: 2 });
  });
  it("does not invent a comparison for different reports, fights, roles, bosses or patches", () => {
    const a = [review(3470, [fight(1)])];
    for (const mutate of [(r: RaidBossReview) => { r.fights[0].code = "OtherReportCode01"; }, (r: RaidBossReview) => { r.fights[0].fightID++; },
      (r: RaidBossReview) => { r.fights[0].role = "healer"; }, (r: RaidBossReview) => { r.boss.id = 3445; r.scope.encounter = 3445; },
      (r: RaidBossReview) => { r.fights[0].scope = scopes[0]; }]) {
      const b = asOther(a); mutate(b[0]); expect(compareSharedRaidRanking(a, b)).toMatchObject({ status: "insufficient-evidence", sharedFights: 0 });
    }
  });
  it("rejects different rule policies even on identical shared fight IDs", () => {
    const a = broader(), b = asOther(a); b.forEach((r) => { r.rulesVersion += "different"; });
    expect(compareSharedRaidRanking(a, b)).toMatchObject({ status: "insufficient-evidence", sharedFights: 0 });
  });
  it("keeps shared context-only deaths ungraded without borrowing another role or patch baseline", () => {
    const a = [review(3470, [contextDeath(fight(1))])], b = asOther([review(3470, [fight(1)])]);
    expect(compareSharedRaidRanking(a, b)).toMatchObject({ status: "insufficient-evidence", sharedFights: 1, a: { score: null }, b: { score: 100 } });
  });
  it("cannot improve shared scores through utility totals or completeness", () => {
    const a = broader(), b = asOther(a); for (const r of b) for (const f of r.fights) f.utility = { ...f.utility, complete: false, dispels: 99999 };
    expect(compareSharedRaidRanking(a, b)).toMatchObject({ status: "compared", sharedFights: 12, a: { score: 100, rankEligible: true, utilityConfidence: "complete" }, b: { score: 100, rankEligible: true, utilityConfidence: "incomplete" } });
  });
  it("does not backfill shared sources from an older boss review", () => {
    const older = review(3470, [fight(1)]), latest = review(3470, [fight(2)], { at: older.at + 1 });
    expect(compareSharedRaidRanking([older, latest], asOther([older]))).toMatchObject({ status: "insufficient-evidence", sharedFights: 0 });
  });
});
