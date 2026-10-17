import { describe, expect, it } from "vitest";
import snapshotData from "../../data/castmirror/guild-execution.json";
import { buildRaiderReport } from "../../app/castmirror/guild-execution/report";
import { gradeBoss, gradeRaid } from "../../app/api/castmirror/execution/raid/grade";
import type { RaidBossReview, RaidFightEvidence } from "../../app/api/castmirror/execution/raid/types";

const scopes = [{ partition: 1, patch: "12.1" }, { partition: 2, patch: "12.1.5" }];
function fight(id: number, contacts = 0): RaidFightEvidence {
  return { code: "LJ317qRxH2MXvPkD", fightID: id, actorID: 101, spec: "Test", role: "dps", kill: true,
    date: 1_792_000_000_000 + id, durationSec: 300, scope: scopes[1],
    damage: { complete: true, total: 1000, avoidableHealth: contacts * 100, avoidableAbsorbed: 0,
      abilities: [{ abilityID: 1288554, name: "Latent Cultist", health: contacts * 100, absorbed: 0, hits: contacts * 2, clusters: contacts, contextual: false }] },
    survival: { complete: true, deaths: [] },
    utility: { complete: true, successfulInterrupts: 0, dispels: 0, raidAbsorbed: 0, absorbAbilities: [], personalCasts: [] }, limitations: [] };
}
function review(fights: RaidFightEvidence[], overrides: Partial<RaidBossReview> = {}): RaidBossReview {
  return { version: "raid-execution-review-1", key: "test:3470", at: 1_792_100_000_000, rulesVersion: "native-live-statistics-4-test",
    identity: { name: "Alice", server: "Mal'Ganis", region: "us", className: "Test" },
    scope: { zone: 53, encounter: 3470, difficulty: 5, size: 20, partition: 2, patch: "12.1.5" }, reviewedScopes: scopes,
    boss: { id: 3470, name: "Nek'zali" }, status: "complete", reason: null, availableKills: fights.length, sampleLimit: 6, fights, ...overrides };
}
const options = { role: "dps" as const, patch: "all", currentPatch: "12.1.5" };
function other(input: RaidBossReview[], name = "Bob") {
  return input.map((r) => ({ ...structuredClone(r), identity: { ...r.identity, name }, fights: r.fights.map((f) => ({ ...structuredClone(f), actorID: 202 })) }));
}
function death(f: RaidFightEvidence, at = 120, causeID: number | null = 1288554, avoidable = true) {
  f.survival.deaths.push({ at, causeID, causeName: causeID === null ? "Unknown" : "Reported cause", reviewedAvoidable: avoidable, raidDeathOrder: 1 });
  return f;
}
function peer(reviews: RaidBossReview[]) { const { name, server, region } = reviews[0].identity; return { identity: { name, server, region }, reviews }; }

describe("observed mechanic denominators", () => {
  it("uses only complete kills where that noncontext reviewed ability row exists", () => {
    const second = fight(2); second.damage.abilities = [{ ...second.damage.abilities[0], abilityID: 1294846, name: "Other reviewed ability" }];
    const result = buildRaiderReport([review([fight(1, 2), second])], options, []);
    const row = result.mechanics.find((m) => m.abilityID === 1288554)!;
    expect(row).toMatchObject({ observedKills: 1, affectedKills: 1, incidents: 2, hits: 4, health: 200 });
    expect(result.reliability).toMatchObject({ completeObservedKills: 2, affectedKills: 1, survivedCleanKills: 1 });
  });
  it("withholds incomplete, empty and contextual-only kills from clean denominators", () => {
    const incomplete = fight(2); incomplete.damage.complete = false;
    const missingSurvival = fight(3); missingSurvival.survival.complete = false;
    const empty = fight(4); empty.damage.abilities = [];
    const contextual = fight(5); contextual.damage.abilities[0].contextual = true;
    const contextualID = fight(6); contextualID.damage.abilities[0].abilityID = 1300239;
    const r = buildRaiderReport([review([fight(1), incomplete, missingSurvival, empty, contextual, contextualID])], options, []);
    expect(r.reliability).toMatchObject({ sampledKills: 6, completeObservedKills: 1, incompleteMechanicsKills: 5, affectedKills: 0, survivedCleanKills: 1 });
    expect(r.mechanics).toHaveLength(1); expect(r.mechanics[0].observedKills).toBe(1);
    expect(r.priorities.some((p) => p.kind === "evidence")).toBe(true);
  });
  it("does not count immune zero-damage clusters or hits as contacts", () => {
    const immune = fight(1); immune.damage.abilities[0].clusters = 9; immune.damage.abilities[0].hits = 99;
    const r = buildRaiderReport([review([immune])], options, []);
    expect(r.mechanics[0]).toMatchObject({ observedKills: 1, affectedKills: 0, incidents: 0, hits: 0, health: 0, absorbed: 0 });
    expect(r.reliability).toMatchObject({ survivedCleanKills: 1, contactIncidents: 0 });
  });
  it("counts positive absorbed-only contact and keeps health distinct", () => {
    const absorbed = fight(1); absorbed.damage.abilities[0] = { ...absorbed.damage.abilities[0], absorbed: 400, hits: 3, clusters: 1 };
    expect(buildRaiderReport([review([absorbed])], options, []).mechanics[0]).toMatchObject({ affectedKills: 1, incidents: 1, hits: 3, health: 0, absorbed: 400 });
  });
  it("refuses malformed complete mechanics instead of converting invalid values into clean credit", () => {
    const invalid = Array.from({ length: 9 }, (_, i) => fight(i + 1));
    invalid[0].durationSec = 0; invalid[1].durationSec = Number.NaN;
    invalid[2].damage.abilities[0].health = -1; invalid[3].damage.abilities[0].absorbed = Number.POSITIVE_INFINITY;
    invalid[4].damage.abilities[0].hits = 0.5; invalid[5].damage.abilities[0].clusters = -1;
    invalid[6].damage.abilities[0].health = 100; invalid[7].damage.abilities[0].abilityID = Number.NaN;
    invalid[8].damage.abilities[0].clusters = Number.NaN;
    const r = buildRaiderReport([review(invalid)], options, []);
    expect(r.reliability).toMatchObject({ completeObservedKills: 0, survivedCleanKills: 0, incompleteMechanicsKills: 9 });
    expect(r.mechanics).toEqual([]);
  });
  it("filters role and source patch before every diagnostic and never fills empty current evidence", () => {
    const historic = { ...fight(1, 4), scope: scopes[0] }, healer = { ...fight(2, 3), role: "healer" as const };
    const input = [review([historic, healer])];
    const current = buildRaiderReport(input, { ...options, patch: "current" }, []);
    expect(current.reliability).toMatchObject({ sampledKills: 0, completeObservedKills: 0, survivedCleanKills: 0 });
    expect(current.assessment.score).toBeNull(); expect(current.mechanics).toEqual([]); expect(current.deaths).toEqual([]);
    expect(current.priorities[0].kind).toBe("evidence");
    expect(buildRaiderReport(input, { ...options, role: "healer", patch: "current" }, []).reliability.contactIncidents).toBe(3);
  });
  it("dedupes latest whole-boss evidence and refuses foreign identity or rules", () => {
    const older = review([fight(1, 4)]), newer = review([fight(2)], { at: older.at + 1 });
    const foreign = review([fight(3)], { identity: { ...older.identity, name: "Other" } });
    const wrongRule = review([fight(4)], { at: newer.at + 1, rulesVersion: "other-rule" });
    const r = buildRaiderReport([older, newer, foreign, wrongRule], options, []);
    expect(r.reliability).toMatchObject({ sampledKills: 1, contactIncidents: 0 });
    expect(r.mechanics[0].observations[0].source.fightID).toBe(2);
  });
  it("orders observations chronologically and only describes sufficiently comparable patch-local samples", () => {
    const input = Array.from({ length: 6 }, (_, i) => fight(i + 1, i < 3 ? 2 : 0)).reverse();
    const r = buildRaiderReport([review(input)], options, []), row = r.mechanics[0];
    expect(row.observations.map((o) => o.source.fightID)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(row.trend.status).toBe("descriptive"); expect(row.trend.label).toContain("earlier 3 kills had 6 contacts; later 3 had 0");
    expect(row.trend.label).toContain("does not establish improvement or decline");
    expect(buildRaiderReport([review(input.slice(0, 5))], options, []).mechanics[0].trend.status).toBe("insufficient");
    input[0].damage.abilities.push({ ...input[0].damage.abilities[0], abilityID: 1294846 });
    expect(buildRaiderReport([review(input)], options, []).mechanics.find((m) => m.abilityID === 1288554)!.trend.status).toBe("insufficient");
    const sameTime = Array.from({ length: 6 }, (_, i) => ({ ...fight(i + 1), date: fight(1).date }));
    expect(buildRaiderReport([review(sameTime)], options, []).mechanics[0].trend.status).toBe("insufficient");
  });
  it("never combines patch-local trends into a single directional conclusion", () => {
    const input = Array.from({ length: 6 }, (_, i) => ({ ...fight(i + 1, 2), scope: i < 5 ? scopes[0] : scopes[1] }));
    const r = buildRaiderReport([review(input)], options, []);
    expect(r.mechanics).toHaveLength(2); expect(r.mechanics.every((m) => m.trend.status === "insufficient")).toBe(true);
    const focus = r.priorities.filter((p) => p.abilityID === 1288554); expect(focus).toHaveLength(1);
    expect(focus[0]).toMatchObject({ observedKills: 6, incidents: 12, affectedKills: 6 });
  });
});

describe("death cards without inferred downtime", () => {
  it("preserves exact cause/source/time and labels remaining fight time without resurrection claims", () => {
    const f = death(fight(1, 1), 120), r = buildRaiderReport([review([f])], options, []), d = r.deaths[0];
    expect(d).toMatchObject({ causeID: 1288554, atSeconds: 120, fightDurationSec: 300, remainingFightSeconds: 180, remainingFightPercent: 60, raidDeathOrder: 1, attribution: "reviewed-avoidable", survivalComplete: true });
    expect(d.source.url).toContain("fight=1&source=101"); expect(d.explanation).toContain("Remaining fight time is not time dead");
    expect(d.explanation).toContain("resurrection evidence is not collected"); expect(r.reliability.confirmedAvoidableDeaths).toBe(1);
  });
  it("handles valid endpoints and invalid timings without fabricating remaining time", () => {
    const f = fight(1, 1); for (const at of [0, 300, 301, Number.NaN]) death(f, at);
    const cards = buildRaiderReport([review([f])], options, []).deaths;
    expect(cards.find((d) => d.atSeconds === 0)).toMatchObject({ remainingFightSeconds: 300, remainingFightPercent: 100 });
    expect(cards.find((d) => d.atSeconds === 300)).toMatchObject({ remainingFightSeconds: 0, remainingFightPercent: 0 });
    expect(cards.find((d) => d.atSeconds === 301)?.remainingFightSeconds).toBeNull();
    expect(cards.find((d) => d.atSeconds === null)?.remainingFightSeconds).toBeNull();
    expect(cards.every((d) => !("deadTime" in d) && !("downtime" in d))).toBe(true);
  });
  it("calculates remaining fight percentage before rounding the displayed seconds", () => {
    const f = death(fight(1, 1), 349.414); f.durationSec = 358.183;
    const card = buildRaiderReport([review([f])], options, []).deaths[0];
    expect(card).toMatchObject({ remainingFightSeconds: 8.8, remainingFightPercent: 2.4 });
  });
  it("withholds complete totals and first-death assertions for incomplete survival", () => {
    const f = death(fight(1, 1)); f.survival.complete = false;
    const r = buildRaiderReport([review([f])], options, []);
    expect(r.deaths[0]).toMatchObject({ raidDeathOrder: null, attribution: "reported-avoidable-incomplete", survivalComplete: false });
    expect(r.reliability).toMatchObject({ observedDeathCards: 1, completeSurvivalDeaths: 0, confirmedAvoidableDeaths: 0, completeObservedKills: 0 });
  });
  it("does not blame contextual, unknown or unmatched causes despite a stale avoidable flag", () => {
    const context = death(fight(1, 1), 100, 1300239); context.damage.abilities[0].abilityID = 1300239;
    const explicitContext = death(fight(2, 1)); explicitContext.damage.abilities[0].contextual = true;
    const unknown = death(fight(3, 1), 100, null), unmatched = death(fight(4, 1), 100, 999);
    const r = buildRaiderReport([review([context, explicitContext, unknown, unmatched])], options, []);
    expect(r.reliability.confirmedAvoidableDeaths).toBe(0); expect(r.deaths.some((d) => d.attribution === "reviewed-avoidable")).toBe(false);
    expect(r.deaths.find((d) => d.causeID === null)?.attribution).toBe("unknown-cause");
    expect(r.priorities.some((p) => p.kind === "fatal")).toBe(false);
  });
  it("aligns authoritative reviewed fatal causes with grading independently of zero-damage contact rows", () => {
    const f = death(fight(1)), r = buildRaiderReport([review([f])], options, []);
    expect(r.reliability).toMatchObject({ contactIncidents: 0, affectedKills: 0, survivedCleanKills: 0, confirmedAvoidableDeaths: 1 });
    expect(r.deaths[0].attribution).toBe("reviewed-avoidable");
    expect(r.priorities[0]).toMatchObject({ kind: "fatal", incidents: 0, avoidableDeaths: 1 });
    expect(gradeBoss(review([f])).survival.confirmedAvoidableDeaths).toBe(1);
  });
  it("counts complete survival separately when damage evidence is incomplete", () => {
    const f = fight(1); f.damage.complete = false;
    const r = buildRaiderReport([review([f])], options, []);
    expect(r.reliability).toMatchObject({ completeSurvivalKills: 1, completeSurvivalDeaths: 0, completeObservedKills: 0, survivedCleanKills: 0 });
  });
});

describe("paired saved-log diagnostics", () => {
  it("withholds incomplete or narrower reviewed coverage without pooling alternate evidence", () => {
    const a = [review([fight(1, 2), fight(2, 4), fight(3, 1)])], b = other(a);
    b[0].fights[1].survival.complete = false;
    b[0].fights[2].damage.abilities.push({ ...b[0].fights[2].damage.abilities[0], abilityID: 1294846 });
    const p = buildRaiderReport(a, options, [peer(b)]).peers[0];
    expect(p).toMatchObject({ sharedKills: 3, pairedKills: 1, withheldKills: 2, self: { affectedKills: 1, incidents: 2 }, peer: { affectedKills: 1, incidents: 2 } });
    expect(p.sources[0].self.actorID).toBe(101); expect(p.sources[0].peer.actorID).toBe(202);
    expect(p.summary).toContain("not mechanic opportunities");
  });
  it("withholds empty/context-only coverage and same-actor bindings", () => {
    const a = [review([fight(1)])], b = other(a); b[0].fights[0].damage.abilities = [];
    expect(buildRaiderReport(a, options, [peer(b)]).peers[0]).toMatchObject({ pairedKills: 0, withheldKills: 1 });
    b[0].fights[0] = { ...fight(1), actorID: 101 };
    expect(buildRaiderReport(a, options, [peer(b)]).peers).toEqual([]);
  });
  it("rejects transplanted peer identities, duplicate entries and self comparisons", () => {
    const a = [review([fight(1)])], b = other(a), p = peer(b);
    expect(buildRaiderReport(a, options, [{ ...p, identity: { ...p.identity, name: "Transplanted" } }]).peers).toEqual([]);
    expect(buildRaiderReport(a, options, [p, structuredClone(p)]).peers).toEqual([]);
    expect(buildRaiderReport(a, options, [peer(a)]).peers).toEqual([]);
  });
  it("sorts by overlap then identity, never by damage score or support totals", () => {
    const a = [review([fight(1), fight(2)])], alpha = other([review([fight(1, 10)])], "Alpha"), zeta = other([review([fight(1), fight(2)])], "Zeta");
    const rows = buildRaiderReport(a, options, [peer(alpha), peer(zeta)]).peers;
    expect(rows.map((p) => p.identity.name)).toEqual(["Zeta", "Alpha"]);
    const tied = other([review([fight(1)])], "Zed");
    expect(buildRaiderReport(a, options, [peer(tied), peer(alpha)]).peers.map((p) => p.identity.name)).toEqual(["Alpha", "Zed"]);
  });
  it("does not borrow historical or different-role peer sources", () => {
    const f = { ...fight(1), scope: scopes[0] }, a = [review([f])], b = other(a);
    expect(buildRaiderReport(a, { ...options, patch: "current" }, [peer(b)]).peers[0]?.pairedKills ?? 0).toBe(0);
    b[0].fights[0].role = "healer";
    expect(buildRaiderReport(a, options, [peer(b)]).peers).toEqual([]);
    b[0].fights[0].role = "dps"; b[0].rulesVersion = "different";
    expect(buildRaiderReport(a, options, [peer(b)]).peers).toEqual([]);
  });
});

describe("saved benchmarks and unchanged scoring", () => {
  const snapshot = snapshotData as unknown as { currentPatch: string; raiders: Array<{ identity: { name: string; server: string; region: string }; reviews: RaidBossReview[] }> };
  it("verifies Bstay/Bowner's22 paired kills and Bstay's24 Latent Cultist contacts", () => {
    const a = snapshot.raiders.find((r) => r.identity.name === "Bstay")!, b = snapshot.raiders.find((r) => r.identity.name === "Bownerjamms")!;
    const r = buildRaiderReport(a.reviews, options, [b]), p = r.peers[0];
    expect(p).toMatchObject({ pairedKills: 22, self: { affectedKills: 18, incidents: 50, survivedKills: 19 }, peer: { affectedKills: 5, incidents: 8, survivedKills: 21 } });
    const rows = r.mechanics.filter((m) => m.bossID === 3470 && m.abilityID === 1288554);
    expect(rows.reduce((n, m) => n + m.observedKills, 0)).toBe(6); expect(rows.reduce((n, m) => n + m.incidents, 0)).toBe(24);
    expect(r.priorities.filter((p) => p.bossID === 3470 && p.abilityID === 1288554)).toHaveLength(1);
  });
  it("keeps utility zeros unknown, scores unchanged, and inputs immutable", () => {
    const input = [review([fight(1, 2)])], before = structuredClone(input), legacy = gradeRaid(input);
    input[0].fights[0].utility.complete = false;
    const copy = structuredClone(input), r = buildRaiderReport(input, options, []);
    expect(r.utility.confidence).toBe("incomplete"); expect(r.utility.summary).toContain("unverified zero");
    expect(r.assessment.score).toBe(90); expect(gradeRaid(input).score).toBe(legacy.score); expect(input).toEqual(copy);
    expect(before[0].fights[0].utility.complete).toBe(true);
  });
  it("reports kill-only utility, excludes progression contributions, and preserves actual refusal limitations", () => {
    const kill = fight(1); kill.utility.successfulInterrupts = 2; kill.utility.complete = false;
    kill.limitations = ["healing:event-actor-unverified", "healing:event-actor-unverified"];
    const wipe = fight(2); wipe.kill = false; wipe.utility.dispels = 99; wipe.limitations = ["Progression-only limit"];
    const r = buildRaiderReport([review([kill, wipe])], options, []);
    expect(r.utility.observations).toMatchObject({ successfulInterrupts: 2, dispels: 0, observedFights: 1, completeFights: 0 });
    expect(r.reliability).toMatchObject({ sampledKills: 1, utilityObservedKills: 1, utilityCompleteKills: 0 });
    expect(r.priorities.find((p) => p.kind === "evidence")?.detail).toContain("0/1 sampled kills");
    expect(r.limits.filter((s) => s === "healing:event-actor-unverified")).toHaveLength(1);
    expect(r.limits).not.toContain("Progression-only limit"); expect(r.limits.join(" ")).toContain("progression pulls are excluded");
  });
  it("keeps an isolated single-contact coaching point even with a broader complete sample", () => {
    const input = [3470, 3445, 3455, 3497].map((boss, i) => review(Array.from({ length: 3 }, (_, j) => fight(i * 3 + j + 1, i === 0 && j === 0 ? 1 : 0)),
      { boss: { id: boss, name: `Boss ${boss}` }, scope: { ...review([]).scope, encounter: boss } }));
    const r = buildRaiderReport(input, options, []);
    expect(r.assessment.rankEligible).toBe(true); expect(r.reliability.contactIncidents).toBe(1);
    expect(r.priorities).toHaveLength(1); expect(r.priorities[0]).toMatchObject({ kind: "mechanic", incidents: 1 });
  });
});
