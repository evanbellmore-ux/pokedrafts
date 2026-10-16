import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradeBoss, gradeRaid } from "../app/api/castmirror/execution/raid/grade";
import type { RaidBossReview, RaidFightEvidence } from "../app/api/castmirror/execution/raid/types";

export const APPROVED_GUILD_SOURCE_SHA256 = "f8a7786ce6172acff0df1cda4e362c045dfbdfa494d0fa46d3f022689e9ddc50";
const identities = [
  ["Bstay", "Mal'Ganis"], ["Bownerjamms", "Mal'Ganis"], ["Wakiespriest", "Illidan"],
  ["Tsrallyt", "Mal'Ganis"], ["Clubbedmg", "Mal'Ganis"], ["Dabusele", "Mal'Ganis"],
  ["Dapussadin", "Mal'Ganis"], ["Exmortui", "Stormrage"], ["Fallinx", "Tichondrius"],
  ["Grantusla", "Mal'Ganis"], ["Hobgoblinn", "Black Dragonflight"], ["Jujuza", "Frostmourne"],
  ["Lindorai", "Mal'Ganis"], ["Mechabun", "Mal'Ganis"], ["Meepsmoo", "Thrall"],
  ["Pbrine", "Mal'Ganis"], ["Phildolock", "Illidan"], ["Puppabrew", "Mal'Ganis"],
  ["Rct", "Mal'Ganis"], ["Rendskaar", "Arygos"], ["Shameeps", "Thrall"],
  ["Slicedbreád", "Mok'Nathal"], ["Unrlydemonic", "Mal'Ganis"], ["Watchyostep", "Mal'Ganis"],
  ["Worsthunterx", "Crushridge"], ["Zaura", "Mal'Ganis"],
];
const identityKey = (name: string, realm: string) => JSON.stringify([name, realm, "us"]);
const approvedIdentities = new Set(identities.map(([name, realm]) => identityKey(name, realm)));
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Explicit allowlist: public log evidence only; never acquisition, jobs, accounting or local paths. */
function publicFight(fight: RaidFightEvidence): RaidFightEvidence {
  return {
    code: fight.code, fightID: fight.fightID, actorID: fight.actorID, spec: fight.spec, role: fight.role,
    kill: fight.kill, date: fight.date, durationSec: fight.durationSec, scope: fight.scope,
    damage: { complete: fight.damage.complete, total: fight.damage.total,
      avoidableHealth: fight.damage.avoidableHealth, avoidableAbsorbed: fight.damage.avoidableAbsorbed,
      abilities: fight.damage.abilities.map((ability) => ({ abilityID: ability.abilityID, name: ability.name,
        health: ability.health, absorbed: ability.absorbed, hits: ability.hits,
        clusters: ability.clusters, contextual: ability.contextual })) },
    survival: { complete: fight.survival.complete, deaths: fight.survival.deaths.map((death) => ({
      at: death.at, causeID: death.causeID, causeName: death.causeName,
      reviewedAvoidable: death.reviewedAvoidable, raidDeathOrder: death.raidDeathOrder,
    })) },
    utility: { complete: fight.utility.complete, successfulInterrupts: fight.utility.successfulInterrupts,
      dispels: fight.utility.dispels, raidAbsorbed: fight.utility.raidAbsorbed,
      absorbAbilities: fight.utility.absorbAbilities.map((ability) => ({
        abilityID: ability.abilityID, name: ability.name, amount: ability.amount,
      })), personalCasts: fight.utility.personalCasts.map((cast) => ({
        abilityID: cast.abilityID, name: cast.name, count: cast.count,
      })) },
    limitations: [...fight.limitations],
  };
}

function publicReview(review: RaidBossReview): RaidBossReview {
  return {
    version: review.version, key: review.key, at: review.at, rulesVersion: review.rulesVersion,
    identity: { name: review.identity.name, server: review.identity.server,
      region: review.identity.region, className: review.identity.className },
    scope: { zone: review.scope.zone, encounter: review.scope.encounter, difficulty: review.scope.difficulty,
      size: review.scope.size, partition: review.scope.partition, patch: review.scope.patch },
    reviewedScopes: review.reviewedScopes?.map((scope) => ({ partition: scope.partition, patch: scope.patch })),
    coverageLimited: review.coverageLimited, boss: { id: review.boss.id, name: review.boss.name },
    status: review.status, reason: review.reason, availableKills: review.availableKills,
    fights: review.fights.map(publicFight), sampleLimit: review.sampleLimit,
  };
}

interface ApprovedSource {
  at: string;
  guild: { name: string; server: string; region: string; publicLogGuildID: number };
  scope: { zone: number; difficulty: number };
  counts: { raiders: number; gradedRaiders: number; repairAttemptsPending: number };
  rosterDiscoveryAuthorized: boolean;
  raiders: Array<{
    identity: { name: string; server: string; region: string };
    membership: string; status: string; sampledKills: number;
    grade: ReturnType<typeof gradeRaid>;
    bosses: Array<{ eligible: boolean; outcome?: { review?: RaidBossReview } }>;
  }>;
}

export function buildGuildSnapshot(bytes: Uint8Array) {
  assert.equal(digest(bytes), APPROVED_GUILD_SOURCE_SHA256, "The approved saved review changed; review a new source explicitly.");
  const source = JSON.parse(Buffer.from(bytes).toString("utf8")) as ApprovedSource;
  assert.equal(source.counts.raiders, 26); assert.equal(source.counts.gradedRaiders, 26);
  assert.equal(source.counts.repairAttemptsPending, 0); assert.equal(source.rosterDiscoveryAuthorized, false);
  assert.equal(source.scope.zone, 53); assert.equal(source.scope.difficulty, 5);
  assert.equal(source.guild.publicLogGuildID, 576131); assert.equal(source.guild.name, "Nothing But Trouble");
  const found = new Set<string>();
  let reviewCount = 0, killCount = 0;
  const raiders = source.raiders.map((raider) => {
    const { name, server, region } = raider.identity, key = identityKey(name, server);
    assert.equal(region, "us"); assert.equal(raider.membership, "verified");
    assert(approvedIdentities.has(key) && !found.has(key), "Unexpected, duplicate or excluded identity."); found.add(key);
    const reviews = raider.bosses.filter((boss) => boss.eligible).map((boss) => {
      const review = boss.outcome?.review; assert(review, "An eligible boss is missing its selected public capture.");
      assert.equal(review.identity.name, name); assert.equal(review.identity.server, server);
      assert.equal(review.identity.region.toLowerCase(), region);
      assert.equal(review.scope.zone, 53); assert.equal(review.scope.difficulty, 5); assert.equal(review.scope.size, 20);
      for (const fight of review.fights) {
        assert(fight.kill && /^[A-Za-z0-9]{16}$/.test(fight.code));
        assert(Number.isSafeInteger(fight.fightID) && fight.fightID > 0);
        assert(fight.scope && ((fight.scope.partition === 1 && fight.scope.patch === "12.1")
          || (fight.scope.partition === 2 && fight.scope.patch === "12.1.5")));
      }
      const clean = publicReview(review);
      assert.deepEqual(gradeBoss(clean), gradeBoss(review), "Publishing must not change source grading.");
      reviewCount++; killCount += clean.fights.length;
      return clean;
    });
    const legacy = gradeRaid(reviews, 10);
    assert.equal(legacy.score, raider.grade.score); assert.equal(legacy.letter, raider.grade.letter);
    assert.equal(reviews.reduce((count, review) => count + review.fights.length, 0), raider.sampledKills);
    return { identity: { name, server, region }, membership: "verified" as const, reviews,
      legacyScore: legacy.score, legacyLetter: legacy.letter, coaching: [] as string[], evidenceStatus: raider.status };
  });
  assert.deepEqual(found, approvedIdentities); assert.equal(reviewCount, 146); assert.equal(killCount, 524);
  const snapshot = {
    version: "guild-execution-snapshot-1", title: "Nothing But Trouble — raid execution",
    guild: { name: source.guild.name, server: source.guild.server, region: source.guild.region },
    snapshotAt: source.at, reviewedAt: source.at, currentPatch: "12.1.5", patches: ["12.1", "12.1.5"],
    scope: { zone: 53, difficulty: 5 },
    limitations: [
      "Saved public Mythic kills captured on October 15, 2026; this page does not refresh or acquire logs.",
      "Only 26 verified guild members with confirmed public Mythic kills are included. Pawed is excluded at the user's request; membership-uncertain participants remain separate.",
      "Scores grade reviewed avoidable contacts and directly attributed deaths. Utility is observed contribution and earns no points; unknown assignments and missing evidence stay unknown.",
      "Historical patch 12.1 covers a narrower reviewed mechanic list. Current and historical evidence can be inspected separately.",
    ],
    provenance: { sourceSHA256: APPROVED_GUILD_SOURCE_SHA256, sourceAt: source.at,
      publicSelectedReviews: reviewCount, sampledKills: killCount, publicLogGuildID: source.guild.publicLogGuildID },
    raiders,
  };
  const serialized = JSON.stringify(snapshot);
  assert(!/scripts\/\.cache|[A-Z]:\\|service_role|access_token|refresh_token|authorization|ledger|attemptID|bodyPath|metaPath|jobID/i.test(serialized), "Private acquisition or local evidence fields must not be published.");
  return snapshot;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4, "Usage: npx tsx scripts/build-castmirror-guild-snapshot.mts --input <approved combined-results.json>");
  assert.equal(process.argv[2], "--input");
  const snapshot = buildGuildSnapshot(await readFile(path.resolve(process.argv[3])));
  const output = new URL("../data/castmirror/guild-execution.json", import.meta.url);
  await mkdir(path.dirname(fileURLToPath(output)), { recursive: true });
  await writeFile(output, JSON.stringify(snapshot) + "\n");
  console.log(JSON.stringify({ output: fileURLToPath(output), raiders: snapshot.raiders.length,
    reviews: snapshot.provenance.publicSelectedReviews, kills: snapshot.provenance.sampledKills,
    sourceSHA256: snapshot.provenance.sourceSHA256, providerRequests: 0 }));
}
