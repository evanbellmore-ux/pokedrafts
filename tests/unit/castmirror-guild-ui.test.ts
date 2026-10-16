import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test } from "vitest";
import snapshotData from "../../data/castmirror/guild-execution.json";
import GuildExecutionBoard, { guildCoaching, guildRows, type GuildExecutionSnapshot } from "../../app/castmirror/guild-execution/board";
import { assessRaidRanking } from "../../app/api/castmirror/execution/raid/grade";

const snapshot = snapshotData as unknown as GuildExecutionSnapshot;
describe("saved guild execution board", () => {
  test("all26 stay visible while unsupported samples receive no ordinal", () => {
    const rows = guildRows(snapshot, "primary", "all");
    assert.equal(rows.length, 26);
    for (const row of rows) {
      assert.deepEqual(row.assessment, assessRaidRanking(row.raider.reviews, {role:"primary",patch:"all",currentPatch:snapshot.currentPatch}));
      assert.equal(row.rank !== null, row.assessment.rankEligible);
    }
    assert.equal(rows.find(r=>r.raider.identity.name === "Worsthunterx")!.rank, null);
    assert.equal(rows.find(r=>r.raider.identity.name === "Bstay")!.assessment.role, "dps");
    const html = renderToStaticMarkup(createElement(GuildExecutionBoard, {snapshot}));
    for (const row of rows) assert(html.includes(row.raider.identity.name));
    assert.match(html, /Snapshot reviewed 2026-10-15/);
    assert.match(html, /no new log requests/);
    assert.match(html, /Limited evidence or ambiguous primary role · no placement/);
    assert.match(html, /Compare the same kills/);
    assert.match(html, /Legacy overall score/);
    assert.match(html, /Gradeable exposure:/);
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  });
  test("current-only and explicit role views never borrow historical or other-role sources", () => {
    const rows = guildRows(snapshot, "tank", "current");
    assert.equal(rows.length, 26);
    for (const row of rows) for (const review of row.reviews) for (const fight of review.fights) {
      assert.equal(fight.role, "tank"); assert.equal(fight.scope?.patch, snapshot.currentPatch);
    }
    const oldOnly = rows.find(r=>r.raider.identity.name === "Tsrallyt")!;
    assert.equal(oldOnly.assessment.score, null);assert.equal(oldOnly.rank, null);assert.equal(oldOnly.reviews.length, 0);assert.deepEqual(oldOnly.coaching, []);
  });
  test("coaching excludes context-only responsibility and follows selected source abilities", () => {
    const raider = snapshot.raiders.find(r=>r.identity.name === "Bstay")!;
    const tank = guildRows(snapshot,"tank","all").find(r=>r.raider.identity.name === "Bstay")!;
    assert.deepEqual(tank.coaching, []);
    assert(guildCoaching(raider.reviews).some(v=>v.includes("Latent Cultist")) || guildCoaching(raider.reviews).some(v=>v.includes("Tempest")));
    const review = structuredClone(raider.reviews[0]);
    for (const f of review.fights) {f.damage.abilities.forEach(a=>a.contextual=true);f.survival.deaths.forEach(d=>d.reviewedAvoidable=false);}
    assert.deepEqual(guildCoaching([review]), []);
  });
  test("zero-damage immunity rows do not create contact blame", () => {
    const review = structuredClone(snapshot.raiders[0].reviews[0]);
    for (const fight of review.fights) {
      fight.damage.abilities.forEach(a => { a.health = 0; a.absorbed = 0; a.hits = 5; a.clusters = 5; });
      fight.survival.deaths = [];
    }
    assert.deepEqual(guildCoaching([review]), []);
  });
  test("missing mechanics evidence cannot render a clean coaching interpretation", () => {
    const limited = structuredClone(snapshot);
    limited.raiders = limited.raiders.slice(0, 2);
    for (const raider of limited.raiders) for (const review of raider.reviews) for (const fight of review.fights) {
      fight.damage.complete = false; fight.survival.complete = false;
    }
    const html = renderToStaticMarkup(createElement(GuildExecutionBoard, {snapshot:limited}));
    assert.match(html, /Insufficient complete, gradeable exposure to identify improvement areas/);
    assert.doesNotMatch(html, /No reviewed avoidable contacts in/);
    assert.match(html, /Saved review status across all roles and patches/);
  });
});
