import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test } from "vitest";
import snapshotData from "../../data/castmirror/guild-execution.json";
import GuildExecutionBoard, { guildCoaching, guildRows, type GuildExecutionSnapshot } from "../../app/castmirror/guild-execution/board";
import { assessRaidRanking } from "../../app/api/castmirror/execution/raid/grade";
import type { RaidRole } from "../../app/api/castmirror/execution/raid/types";

const snapshot = snapshotData as unknown as GuildExecutionSnapshot;
const renderedRows = (html: string) => [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].flatMap(table => [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(row => row[1]));
const rowFor = (rows: string[], name: string) => rows.find(row => row.includes(`>${name}<small`))!;
const provisionalBadge = /<small\b[^>]*>Provisional<\/small>/;
function fixtureRaider(name: string, role: RaidRole, contacts: number, samples = 1, bosses = 1) {
  const raider = structuredClone(snapshot.raiders[0]);
  raider.identity.name = name;
  raider.reviews = raider.reviews.slice(0, bosses).map((review, bossIndex) => {
    review.identity.name = name; review.status = "complete"; review.reason = null; review.availableKills = samples;
    review.reviewedScopes = [{ partition: review.scope.partition, patch: review.scope.patch }];
    review.fights = Array.from({length:samples}, (_, index) => {
      const fight = structuredClone(review.fights[0]);
      fight.code = `Fixture${name}000000`; fight.fightID = bossIndex * 10 + index + 1;
      fight.scope = { partition: review.scope.partition, patch: review.scope.patch }; fight.role = role;
      fight.damage = { complete: true, total: contacts * 10, avoidableHealth: contacts * 10, avoidableAbsorbed: 0,
        abilities: [{ abilityID: 1, name: "Reviewed fixture mechanic", health: contacts * 10, absorbed: 0, hits: contacts, clusters: contacts, contextual: false }] };
      fight.survival = {complete:true,deaths:[]};
      fight.utility = {complete:true,successfulInterrupts:0,dispels:0,raidAbsorbed:0,absorbAbilities:[],personalCasts:[]};
      fight.limitations = []; return fight;
    });
    return review;
  });
  return raider;
}
describe("saved guild execution board", () => {
  test("all26 form one score-sorted ranking including scored limited samples", () => {
    const rows = guildRows(snapshot, "primary", "all");
    assert.equal(rows.length, 26);
    const expected = snapshot.raiders.map(raider => ({raider, assessment:assessRaidRanking(raider.reviews,{role:"primary",patch:"all",currentPatch:snapshot.currentPatch})}))
      .sort((a,b)=>(b.assessment.score??-1)-(a.assessment.score??-1)||a.raider.identity.name.localeCompare(b.raider.identity.name));
    for (const row of rows) {
      assert.deepEqual(row.assessment, assessRaidRanking(row.raider.reviews, {role:"primary",patch:"all",currentPatch:snapshot.currentPatch}));
      const index=expected.findIndex(v=>v.raider.identity.name===row.raider.identity.name);
      const firstSameScore=expected.findIndex(v=>v.assessment.score===row.assessment.score);
      assert.equal(row.rank,row.assessment.score===null?null:firstSameScore+1);
      assert(index>=0);
    }
    assert.equal(rows.find(r=>r.raider.identity.name === "Worsthunterx")!.assessment.rankEligible, false);
    assert(rows.find(r=>r.raider.identity.name === "Worsthunterx")!.rank !== null);
    assert.equal(rows.find(r=>r.raider.identity.name === "Bstay")!.assessment.role, "dps");
    const html = renderToStaticMarkup(createElement(GuildExecutionBoard, {snapshot}));
    const displayed=renderedRows(html);
    assert.equal((html.match(/<table\b/g)??[]).length,1);assert.equal(displayed.length,26);
    for (const [index,row]of expected.entries()) {
      assert(displayed[index].includes(`>${row.raider.identity.name}<small`));
      const rendered=rowFor(displayed,row.raider.identity.name);
      assert.equal(provisionalBadge.test(rendered),row.assessment.score!==null&&!row.assessment.rankEligible);
      assert(rendered.startsWith(`<td>${row.assessment.score===null?"—":`#${expected.findIndex(v=>v.assessment.score===row.assessment.score)+1}`}</td>`));
    }
    assert.match(html, /Snapshot reviewed 2026-10-15/);
    assert.match(html, /no new log requests/);
    assert.doesNotMatch(html, /Supported comparisons<|Limited evidence or ambiguous primary role · no placement/);
    assert.match(html, /Compare the same kills/);
    assert.match(html, /Legacy overall score/);
    assert.match(html, /Gradeable exposure:/);
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  });
  test("one overall competition rank crosses roles, includes limited scores and retains unscored rows", () => {
    const data=structuredClone(snapshot);
    const ambiguous=fixtureRaider("Epsilon","dps",1,3,4);
    for(const review of ambiguous.reviews)review.fights.push(...structuredClone(review.fights).map(f=>({...f,role:"tank" as const,fightID:f.fightID+100})));
    const missing=fixtureRaider("Missing","dps",0);missing.reviews=[];
    data.raiders=[fixtureRaider("Alpha","dps",1,3,4),fixtureRaider("Beta","tank",0),fixtureRaider("Gamma","healer",1),fixtureRaider("Delta","dps",2,3,4),ambiguous,missing];
    const rows=guildRows(data,"primary","all"),byName=new Map(rows.map(r=>[r.raider.identity.name,r]));
    assert.equal(byName.get("Beta")!.rank,1);assert.equal(byName.get("Beta")!.assessment.rankEligible,false);
    for(const name of["Alpha","Gamma","Epsilon"])assert.equal(byName.get(name)!.rank,2);
    assert.equal(byName.get("Delta")!.rank,5);assert.equal(byName.get("Missing")!.rank,null);
    assert.equal(byName.get("Epsilon")!.assessment.primaryRoleAmbiguous,true);assert.equal(byName.get("Epsilon")!.assessment.sample,"broader");
    const html=renderToStaticMarkup(createElement(GuildExecutionBoard,{snapshot:data})),displayed=renderedRows(html);
    assert.equal(displayed.length,6);for(const[index,name]of["Beta","Alpha","Epsilon","Gamma","Delta","Missing"].entries())assert(displayed[index].includes(`>${name}<small`));
    for(const name of["Beta","Gamma","Epsilon"])assert.match(rowFor(displayed,name),provisionalBadge);
    for(const name of["Alpha","Delta","Missing"])assert.doesNotMatch(rowFor(displayed,name),provisionalBadge);
    for(const name of["Alpha","Gamma","Epsilon"])assert(rowFor(displayed,name).startsWith("<td>#2</td>"));
    assert(rowFor(displayed,"Beta").startsWith("<td>#1</td>"));assert(rowFor(displayed,"Delta").startsWith("<td>#5</td>"));
    assert.match(rowFor(displayed,"Missing"),/<td>—<\/td>/);assert.match(rowFor(displayed,"Missing"),/Ungraded/);
  });
  test("current-only and explicit role views never borrow historical or other-role sources", () => {
    const rows = guildRows(snapshot, "tank", "current");
    assert.equal(rows.length, 26);
    for (const row of rows) for (const review of row.reviews) for (const fight of review.fights) {
      assert.equal(fight.role, "tank"); assert.equal(fight.scope?.patch, snapshot.currentPatch);
    }
    const oldOnly = rows.find(r=>r.raider.identity.name === "Tsrallyt")!;
    assert.equal(oldOnly.assessment.score, null);assert.equal(oldOnly.rank, null);assert.equal(oldOnly.reviews.length, 0);assert.deepEqual(oldOnly.coaching, []);
    const scored=rows.filter(r=>r.assessment.score!==null).sort((a,b)=>b.assessment.score!-a.assessment.score!);
    for(const row of scored)assert.equal(row.rank,scored.findIndex(v=>v.assessment.score===row.assessment.score)+1);
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
