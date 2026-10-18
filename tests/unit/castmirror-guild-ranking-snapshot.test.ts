import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import saved from "../../data/castmirror/guild-execution.json";
import { APPROVED_GUILD_SOURCE_SHA256, buildGuildSnapshot } from "../../scripts/build-castmirror-guild-snapshot.mjs";
import { assessRaidRanking, compareSharedRaidRanking, gradeRaid, selectRaidRankingReviews } from "../../app/api/castmirror/execution/raid/grade";
import type { RaidBossReview, RaidRole } from "../../app/api/castmirror/execution/raid/types";

const snapshot = saved as unknown as ReturnType<typeof buildGuildSnapshot>;
const identity = (name: string, realm: string) => JSON.stringify([name, realm, "us"]);
const expectedIdentities = [
  ["Bstay", "Mal'Ganis"], ["Bownerjamms", "Mal'Ganis"], ["Wakiespriest", "Illidan"],
  ["Tsrallyt", "Mal'Ganis"], ["Clubbedmg", "Mal'Ganis"], ["Dabusele", "Mal'Ganis"],
  ["Dapussadin", "Mal'Ganis"], ["Exmortui", "Stormrage"], ["Fallinx", "Tichondrius"],
  ["Grantusla", "Mal'Ganis"], ["Hobgoblinn", "Black Dragonflight"], ["Jujuza", "Frostmourne"],
  ["Lindorai", "Mal'Ganis"], ["Mechabun", "Mal'Ganis"], ["Meepsmoo", "Thrall"],
  ["Pbrine", "Mal'Ganis"], ["Phildolock", "Illidan"], ["Puppabrew", "Mal'Ganis"],
  ["Rct", "Mal'Ganis"], ["Rendskaar", "Arygos"], ["Shameeps", "Thrall"],
  ["Slicedbreád", "Mok'Nathal"], ["Unrlydemonic", "Mal'Ganis"], ["Watchyostep", "Mal'Ganis"],
  ["Worsthunterx", "Crushridge"], ["Zaura", "Mal'Ganis"],
].map(([name, realm]) => identity(name, realm));
const roles: RaidRole[] = ["dps", "tank", "healer"];
const raider = (name: string) => snapshot.raiders.find((entry) => entry.identity.name === name)!;
const options = (patch: string, role: "primary" | RaidRole = "primary") => ({ role, patch, currentPatch: snapshot.currentPatch });
const key = (bossID: number, fight: RaidBossReview["fights"][number]) => JSON.stringify([
  bossID, fight.code, fight.fightID, fight.role, fight.scope!.partition, fight.scope!.patch,
]);

describe("approved saved guild snapshot", () => {
  it("publishes exactly the26 approved identities with their actual realms and fixed reviewed scope", () => {
    expect(snapshot.version).toBe("guild-execution-snapshot-1");
    expect(snapshot.guild).toEqual({ name: "Nothing But Trouble", server: "Mal'Ganis", region: "us" });
    expect(snapshot.scope).toEqual({ zone: 53, difficulty: 5 });
    const keys = snapshot.raiders.map((entry) => identity(entry.identity.name, entry.identity.server));
    expect(keys).toHaveLength(26); expect(new Set(keys).size).toBe(26);
    expect(new Set(keys)).toEqual(new Set(expectedIdentities));
    expect(snapshot.raiders.every((entry) => entry.identity.region === "us" && entry.membership === "verified")).toBe(true);
    for (const excluded of ["Pawed", "Bobbymercer", "Gewchee", "Gewchlock", "Linoru", "Nate", "Nyletha"]) {
      expect(snapshot.raiders.some((entry) => entry.identity.name.normalize("NFKC").toLowerCase() === excluded.toLowerCase())).toBe(false);
    }
    expect(snapshot.limitations.join(" ")).toContain("membership-uncertain participants remain separate");
  });

  it("retains146 selected whole-boss reviews and524 individual kill samples without retry duplication", () => {
    const reviews = snapshot.raiders.flatMap((entry) => entry.reviews);
    expect(reviews).toHaveLength(146);
    expect(reviews.flatMap((review) => review.fights)).toHaveLength(524);
    expect(snapshot.provenance).toMatchObject({ publicSelectedReviews: 146, sampledKills: 524, publicLogGuildID: 576131 });
    for (const entry of snapshot.raiders) {
      expect(new Set(entry.reviews.map((review) => review.boss.id)).size).toBe(entry.reviews.length);
      const seen = new Set<string>();
      for (const review of entry.reviews) for (const fight of review.fights) {
        const source = `${fight.code}:${fight.fightID}`;
        expect(seen.has(source), `${entry.identity.name} duplicated ${source}`).toBe(false); seen.add(source);
      }
    }
  });

  it("binds every source to the exact character, reviewed encounter/partition and public kill identity", () => {
    const encounters = new Set([3379, 3420, 3445, 3455, 3470, 3497]);
    for (const entry of snapshot.raiders) for (const review of entry.reviews) {
      expect(review.identity).toMatchObject(entry.identity);
      expect(review.scope).toMatchObject({ zone: 53, difficulty: 5, size: 20, encounter: review.boss.id });
      expect(encounters.has(review.boss.id)).toBe(true);
      for (const fight of review.fights) {
        expect(fight.kill).toBe(true); expect(fight.code).toMatch(/^[A-Za-z0-9]{16}$/);
        expect(Number.isSafeInteger(fight.fightID) && fight.fightID > 0).toBe(true);
        expect(Number.isSafeInteger(fight.actorID) && fight.actorID > 0).toBe(true);
        expect(roles).toContain(fight.role);
        expect([{ partition: 1, patch: "12.1" }, { partition: 2, patch: "12.1.5" }]).toContainEqual(fight.scope);
        expect(review.reviewedScopes).toContainEqual(fight.scope);
        expect(Number.isSafeInteger(fight.date) && fight.date > 0).toBe(true);
      }
    }
  });

  it("preserves the immutable approved input pin and rejects changed/unreviewed builder bytes without acquisition", () => {
    expect(APPROVED_GUILD_SOURCE_SHA256).toBe("f8a7786ce6172acff0df1cda4e362c045dfbdfa494d0fa46d3f022689e9ddc50");
    expect(snapshot.provenance.sourceSHA256).toBe(APPROVED_GUILD_SOURCE_SHA256);
    const publicBytes = readFileSync(new URL("../../data/castmirror/guild-execution.json", import.meta.url));
    expect(createHash("sha256").update(publicBytes).digest("hex")).not.toBe(APPROVED_GUILD_SOURCE_SHA256);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      for (const bytes of [publicBytes, Buffer.concat([publicBytes, Buffer.from(" ")]), Buffer.from("{}")]) {
        expect(() => buildGuildSnapshot(bytes)).toThrow("approved saved review changed");
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it("contains only the public allowlisted review fields and no acquisition/accounting/local-path data", () => {
    expect(Object.keys(snapshot).sort()).toEqual(["version", "title", "guild", "snapshotAt", "reviewedAt", "currentPatch", "patches", "scope", "limitations", "provenance", "raiders"].sort());
    const text = JSON.stringify(snapshot);
    expect(text).not.toMatch(/scripts[\\/]\.cache|[a-z]:[\\/]|service_role|access_token|refresh_token|authorization|ledger|attemptID|bodyPath|metaPath|jobID|WCL_CLIENT|EXECUTION_DATABASE|Bearer /i);
    for (const entry of snapshot.raiders) {
      expect(Object.keys(entry).sort()).toEqual(["identity", "membership", "reviews", "legacyScore", "legacyLetter", "coaching", "evidenceStatus"].sort());
      for (const review of entry.reviews) {
        expect(Object.keys(review).every((name) => ["version", "key", "at", "rulesVersion", "identity", "scope", "reviewedScopes", "coverageLimited", "boss", "status", "reason", "availableKills", "fights", "sampleLimit"].includes(name))).toBe(true);
        expect(review).not.toHaveProperty("acquisition");
      }
    }
  });

  it("preserves legacy grades for all26 and the known Bstay benchmark", () => {
    for (const entry of snapshot.raiders) {
      const legacy = gradeRaid(entry.reviews, 10);
      expect(legacy.score, entry.identity.name).toBe(entry.legacyScore);
      expect(legacy.letter, entry.identity.name).toBe(entry.legacyLetter);
    }
    expect(raider("Bstay")).toMatchObject({ legacyScore: 81.8, legacyLetter: "B−" });
    expect(raider("Bownerjamms")).toMatchObject({ legacyScore: 97.6, legacyLetter: "A" });
    expect(raider("Worsthunterx").reviews.flatMap((review) => review.fights)).toHaveLength(2);
  });

  it("labels the saved review date separately from actual historical/current source dates", () => {
    expect(new Date(snapshot.snapshotAt).toISOString()).toBe(snapshot.snapshotAt);
    expect(snapshot.reviewedAt).toBe(snapshot.snapshotAt); expect(snapshot.provenance.sourceAt).toBe(snapshot.snapshotAt);
    expect(snapshot.snapshotAt.slice(0, 10)).toBe("2026-10-15");
    expect(snapshot.currentPatch).toBe("12.1.5"); expect(snapshot.patches).toEqual(["12.1", "12.1.5"]);
    expect(snapshot.limitations.join(" ")).toContain("does not refresh or acquire logs");
  });
});

describe("saved evidence ranking behavior", () => {
  it("qualifies17 broader all-patch primary samples while keeping9 limited samples visible after exact exposure matching", () => {
    const assessments = snapshot.raiders.map((entry) => assessRaidRanking(entry.reviews, options("all")));
    expect(assessments.filter((value) => value.rankEligible)).toHaveLength(17);
    expect(assessments.filter((value) => !value.rankEligible)).toHaveLength(9);
    for (const result of assessments) {
      expect(result.rankEligible).toBe(result.supportedBosses >= 4); expect(result.provisional).toBe(true);
      expect(result.sample).toBe(result.rankEligible ? "broader" : "limited");
      expect(result.bosses.every((boss) => boss.weight === Math.min(boss.gradeableKills, 3))).toBe(true);
      expect(result.supportedBosses).toBe(result.bosses.filter((boss) => boss.gradeableKills >= 3).length);
    }
    const small = assessRaidRanking(raider("Worsthunterx").reviews, options("all"));
    expect(small.score).not.toBeNull(); expect(small.rankEligible).toBe(false); expect(small.supportedBosses).toBe(0);
  });

  it("gives no current-patch authoritative ranks and never fills seven empty current samples with history", () => {
    const current = snapshot.raiders.map((entry) => assessRaidRanking(entry.reviews, options("current")));
    expect(current.filter((value) => value.rankEligible)).toHaveLength(0);
    expect(current.filter((value) => value.sampledKills === 0)).toHaveLength(7);
    for (const result of current) {
      expect(result.patchLabel).toContain("12.1.5"); expect(result.supportedBosses).toBe(0);
      expect(result.sourcePatches.every((patch) => patch === "12.1.5")).toBe(true);
      if (!result.sampledKills) {
        expect(result.score).toBeNull(); expect(result.firstDate).toBeNull(); expect(result.lastDate).toBeNull();
        expect(result.utilityConfidence).toBe("unavailable");
      }
    }
    expect(assessRaidRanking(raider("Pbrine").reviews, options("current"))).toMatchObject({ score: null, sampledKills: 0, rankEligible: false });
    expect(assessRaidRanking(raider("Pbrine").reviews, options("all")).rankEligible).toBe(true);
  });

  it("isolates Bstay's23 DPS and5 tank graded kills instead of choosing his best-scoring role", () => {
    const primary = assessRaidRanking(raider("Bstay").reviews, options("all"));
    const tank = assessRaidRanking(raider("Bstay").reviews, options("all", "tank"));
    expect(primary).toMatchObject({ primaryRole: "dps", role: "dps", gradeableKills: 23, supportedBosses: 4, rankEligible: true });
    expect(tank).toMatchObject({ role: "tank", gradeableKills: 5, supportedBosses: 1, rankEligible: false });
    expect(tank.score).toBeGreaterThan(primary.score!);
  });

  it("recomputes Slicedbreád's primary role after patch filtering", () => {
    const all = assessRaidRanking(raider("Slicedbreád").reviews, options("all"));
    const current = assessRaidRanking(raider("Slicedbreád").reviews, options("current"));
    expect(all).toMatchObject({ primaryRole: "healer", role: "healer", gradeableKills: 16, rankEligible: false });
    expect(current).toMatchObject({ primaryRole: "dps", role: "dps", gradeableKills: 3, rankEligible: false });
  });

  it("recomputes scores, sample support and dates independently for every role/patch view", () => {
    for (const entry of snapshot.raiders) for (const patch of ["all", "12.1", "12.1.5"]) for (const role of roles) {
      const result = assessRaidRanking(entry.reviews, options(patch, role));
      const selected = entry.reviews.map((review) => ({ ...review, fights: review.fights.filter((fight) => fight.role === role && (patch === "all" || fight.scope?.patch === patch)) })).filter((review) => review.fights.length);
      const grades = selected.map(review => assessRaidRanking([review], options(patch, role)));
      const weight = grades.reduce((n, grade) => n + Math.min(grade.gradeableKills, 3), 0);
      const mean = weight ? Math.round(grades.reduce((n, grade) => n + grade.breakdown.components.reduce((sum, component) => sum + (component.points ?? 0), 0) * Math.min(grade.gradeableKills, 3), 0) / weight * 10) / 10 : null;
      expect(result.score).toBe(mean); expect(result.gradeableKills).toBe(grades.reduce((n, grade) => n + grade.gradeableKills, 0));
      const dates = selected.flatMap((review) => review.fights.map((fight) => fight.date));
      expect(result.firstDate).toBe(dates.length ? Math.min(...dates) : null); expect(result.lastDate).toBe(dates.length ? Math.max(...dates) : null);
      const actual = selectRaidRankingReviews(entry.reviews, options(patch, role));
      expect(actual.reviews.flatMap((review) => review.fights).every((fight) => fight.role === role && (patch === "all" || fight.scope?.patch === patch))).toBe(true);
    }
  });

  it("retains incomplete utility as observed lower bounds and awards no score for arbitrary utility totals", () => {
    const original = raider("Phildolock").reviews, changed = structuredClone(original);
    for (const review of changed) for (const fight of review.fights) {
      fight.utility.successfulInterrupts += 1000; fight.utility.dispels += 1000; fight.utility.raidAbsorbed += 1_000_000;
    }
    const before = assessRaidRanking(original, options("all")), after = assessRaidRanking(changed, options("all"));
    expect(before.utilityConfidence).toBe("incomplete"); expect(before.utility.completeFights).toBeLessThan(before.utility.observedFights);
    expect(after.score).toBe(before.score); expect(after.gradeableKills).toBe(before.gradeableKills);
    expect(after.utility.successfulInterrupts).toBeGreaterThan(before.utility.successfulInterrupts);
  });

  it("does not turn missing damage or survival evidence into clean credit", () => {
    for (const stream of ["damage", "survival"] as const) {
      const reviews = structuredClone(raider("Bownerjamms").reviews);
      for (const review of reviews) for (const fight of review.fights) fight[stream].complete = false;
      expect(assessRaidRanking(reviews, options("all"))).toMatchObject({ score: null, gradeableKills: 0, supportedBosses: 0, rankEligible: false });
    }
  });

  it("keeps foreign character/realm evidence and duplicate retries out of a member's sample", () => {
    const original = raider("Bstay").reviews, base = assessRaidRanking(original, options("all"));
    for (const foreign of [raider("Exmortui").reviews, original.map((review) => ({ ...structuredClone(review), identity: { ...review.identity, server: "Illidan" } }))]) {
      const result = assessRaidRanking([...original, ...foreign], options("all"));
      expect(result.score).toBe(base.score); expect(result.sampledKills).toBe(base.sampledKills);
      expect(result.exclusions.join(" ")).toContain("different character");
    }
    const duplicate = assessRaidRanking([...original, ...structuredClone(original)], options("all"));
    expect(duplicate.score).toBe(base.score); expect(duplicate.gradeableKills).toBe(base.gradeableKills);
  });
});

describe("actual shared-kill comparisons", () => {
  for (const [nameA, nameB, role, shared] of [["Wakiespriest", "Fallinx", "healer", 15], ["Bstay", "Exmortui", "dps", 23], ["Rendskaar", "Lindorai", "tank", 22]] as const) {
    it(`compares only exact common ${role} sources for ${nameA} and ${nameB}`, () => {
      const a = raider(nameA).reviews, b = raider(nameB).reviews, result = compareSharedRaidRanking(a, b, options("all", role));
      expect(result.status).toBe("compared"); expect(result.sharedFights).toBe(shared); expect(result.provisional).toBe(true);
      const sourceA = new Map(a.flatMap((review) => review.fights.map((fight) => [key(review.boss.id, fight), fight] as const)));
      const sourceB = new Map(b.flatMap((review) => review.fights.map((fight) => [key(review.boss.id, fight), fight] as const)));
      for (const source of result.sources) {
        const id = JSON.stringify([source.bossID, source.code, source.fightID, source.role, source.partition, source.patch]);
        expect(sourceA.get(id)?.actorID).toBe(source.actorA); expect(sourceB.get(id)?.actorID).toBe(source.actorB);
        expect(source.actorA).not.toBe(source.actorB); expect(source.role).toBe(role);
      }
      expect(result.reason).toContain("source kills only");
      expect(result.reason).toContain("no opportunity or assignment denominator");
      expect(result.a.sampledKills).toBe(shared); expect(result.b.sampledKills).toBe(shared);
    });
  }

  it("does not substitute historical shared kills into the current healer comparison", () => {
    const result = compareSharedRaidRanking(raider("Wakiespriest").reviews, raider("Fallinx").reviews, options("current", "healer"));
    expect(result.sharedFights).toBe(3); expect(result.sources.every((source) => source.patch === "12.1.5" && source.partition === 2 && source.role === "healer")).toBe(true);
    expect(result.a.rankEligible).toBe(false); expect(result.b.rankEligible).toBe(false);
  });

  it("does not cross primary-role boundaries and leaves the public source snapshot values unchanged", () => {
    const before = JSON.stringify(snapshot);
    const result = compareSharedRaidRanking(raider("Bstay").reviews, raider("Lindorai").reviews, options("all"));
    expect(result.status).toBe("insufficient-evidence"); expect(result.sharedFights).toBe(0);
    for (const entry of snapshot.raiders) for (const patch of ["all", "current", "12.1"]) {
      assessRaidRanking(entry.reviews, options(patch));
    }
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
