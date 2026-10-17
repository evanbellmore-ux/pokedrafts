import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test } from "vitest";
import snapshot from "../../data/castmirror/guild-execution.json";
import type { RaidBossReview, RaidRankingOptions } from "../../app/api/castmirror/execution/raid/types";
import RaiderReportCard from "../../app/castmirror/guild-execution/report-card";
import { buildRaiderReport, type RaiderReport } from "../../app/castmirror/guild-execution/report";
import { buildRankingStability } from "../../app/castmirror/guild-execution/stability";

const options = {role:"dps" as const,patch:"all",currentPatch:snapshot.currentPatch};
function fixture(name = "Fixture", count = 2): RaidBossReview {
  const review = structuredClone(snapshot.raiders[0].reviews[0]) as RaidBossReview;
  review.identity.name = name; review.status = "complete"; review.reason = null;
  review.reviewedScopes = [{partition:review.scope.partition,patch:review.scope.patch}]; review.availableKills = count;
  const original = structuredClone(review.fights[0]);
  review.fights = Array.from({length:count},(_,index) => ({...structuredClone(original),code:"ReportCardFixture000",fightID:index+1,actorID:101,role:"dps",durationSec:100,
    date:original.date+index*86400000,scope:{partition:review.scope.partition,patch:review.scope.patch},
    damage:{complete:true,total:100,avoidableHealth:100,avoidableAbsorbed:50,abilities:[{abilityID:1,name:"Dodgeable Blast",health:100,absorbed:50,hits:4,clusters:2,contextual:false}]},
    survival:{complete:true,deaths:index===0?[{at:20,causeID:1,causeName:"Dodgeable Blast",reviewedAvoidable:true,raidDeathOrder:2}]:[]},
    utility:{complete:true,successfulInterrupts:2,dispels:1,raidAbsorbed:250,absorbAbilities:[{abilityID:3,name:"Teammate Barrier",amount:250}],personalCasts:[]},limitations:[],
  }));
  return review;
}
function render(reviews: RaidBossReview[], peers: Array<{identity:{name:string;server:string;region:string};reviews:RaidBossReview[]}> = [], selectedOptions: RaidRankingOptions = options) {
  const report=buildRaiderReport(reviews,selectedOptions,peers),stability=buildRankingStability(reviews,selectedOptions,peers);
  return {report,stability,html:renderToStaticMarkup(createElement(RaiderReportCard,{report,stability}))};
}
const escaped = (value: string) => value.replaceAll("&","&amp;");
const panel = (html:string,title:string) => html.slice(html.indexOf(`<summary>${title}`));

describe("saved raider execution report card", () => {
  test("real selected evidence renders compact summary, quantified priorities and inspectable source panels", () => {
    const raider=snapshot.raiders.find(value=>value.identity.name==="Bstay")!;
    const result=render(raider.reviews as RaidBossReview[],snapshot.raiders as Array<{identity:{name:string;server:string;region:string};reviews:RaidBossReview[]}>);
    const {report,html}=result;
    assert.match(html,/aria-label="Raider execution report card"/);assert.match(html,/<h2>Bstay<\/h2>/);
    assert(html.includes(`${report.reliability.affectedKills}/${report.reliability.completeObservedKills}`));
    assert.match(html,/affected sampled kills in complete observed evidence/);assert.match(html,/Main improvement priorities/);
    assert(report.priorities.length<=3);for(const priority of report.priorities)assert(html.includes(renderToStaticMarkup(createElement("h4",null,priority.title))));
    for(const title of["Mechanic reliability","Inspect deaths","Observed support","Compare the same pulls","Ranking sensitivity","Evidence limits"])assert(html.includes(`<summary>${title}`));
    assert.match(html,/aria-label="Boss and patch reliability"/);assert.match(html,/aria-label="Reviewed mechanic reliability"/);
    assert.match(html,/target="_blank" rel="noopener noreferrer"/);
    assert(html.includes(escaped(report.bosses[0].sources[0].url)));
    const defaultPeer=report.peers.find(peer=>peer.sharedKills>0);
    if(defaultPeer?.pairedKills)assert(html.includes(`${defaultPeer.self.survivedKills}/${defaultPeer.pairedKills} survived kills`));
    assert.doesNotMatch(html,/<details[^>]*\sopen(?:[\s=>])/);
  });
  test("mechanic and death details preserve sample denominators, health and absorbed amounts, attribution and unknown order", () => {
    const review=fixture();
    review.fights[1].survival.deaths=[{at:30,causeID:2,causeName:"Contextual Hit",reviewedAvoidable:false,raidDeathOrder:null}];
    const {html,report}=render([review]);
    assert.equal(report.reliability.confirmedAvoidableDeaths,1);
    assert.match(html,/2\/2<small>complete observed kills/);assert.match(html,/4 contacts/);
    assert.match(html,/200 health/);assert.match(html,/100 absorbed/);
    assert.match(html,/Fight time remaining at death<\/dt><dd>1:20 · 80%/);
    assert.match(html,/Time after pull<\/dt><dd>0:20/);assert.match(html,/Raid death event order<\/dt><dd>#2/);
    assert.match(html,/Order unknown/);assert.match(html,/Directly attributed fatal mistake/);assert.match(html,/Context or unproven cause/);
    assert.match(html,/does not establish time spent dead/);assert.doesNotMatch(html,/<dt>[^<]*(?:Downtime|Time dead|Lost contribution)/i);
    assert.match(html,/No directional trend/);assert.match(html,/Inspect 2 chronological kills/);
  });
  test("empty and fully incomplete mechanics never render a clean performance or zero support claim", () => {
    const empty=render([]);
    assert.match(empty.html,/Ungraded/);assert.match(empty.html,/Complete mechanics evidence unavailable/);
    assert.match(empty.html,/No complete reviewed mechanic observations/);assert.match(empty.html,/No supported same-pull peer comparison/);
    assert.match(empty.html,/No graded evidence for a ranking sensitivity check/);
    const partial=fixture();partial.status="partial";partial.reason="Incomplete source evidence";
    for(const fight of partial.fights){fight.damage.complete=false;fight.survival.complete=false;fight.utility.complete=false;fight.utility.successfulInterrupts=0;fight.utility.dispels=0;fight.utility.raidAbsorbed=0;fight.utility.absorbAbilities=[];}
    partial.fights[0].survival.deaths[0].raidDeathOrder=1;
    const result=render([partial]);
    assert.equal(result.report.reliability.completeObservedKills,0);assert.equal(result.report.reliability.confirmedAvoidableDeaths,0);
    assert.match(result.html,/Reported avoidable cause · incomplete evidence/);assert.match(result.html,/Order unknown/);
    assert.match(result.html,/Unverified<\/strong><span>Successful interrupts/);
    assert.doesNotMatch(result.html,/No reviewed avoidable contacts are identified/);
    assert.doesNotMatch(result.html,/<dd>0 fatal mistakes<\/dd>/);
    assert.match(result.html,/incomplete survival sample cannot establish that no deaths occurred|survival stream is incomplete/);
  });
  test("limited samples and partial utility stay provisional and use observed lower bounds without effectiveness points", () => {
    const review=fixture("Limited",1);review.fights[0].survival.deaths=[];review.fights[0].utility.complete=false;
    const {html,report}=render([review]);
    assert.equal(report.assessment.rankEligible,false);assert.match(html,/>Provisional<\/span>/);
    assert.match(html,/Observed ≥ 2<\/strong><span>Successful interrupts/);assert.match(html,/Observed ≥ 250<\/strong><span>Logged teammate absorbs/);
    assert.match(html,/Assignments, available opportunities and correct timing are unknown/);assert.match(html,/observed counts add no ranking points/);
    assert.match(html,/aria-label="Observed teammate absorbs"/);assert.match(html,/Teammate Barrier/);
    assert.doesNotMatch(html,/(?:defensive|cooldown|interrupt|dispel) effectiveness|missed assignments/i);
  });
  test("peer choices use supported overlap and both actor source links, withholding unsupported matches", () => {
    const self=fixture("Self",3),near=structuredClone(self),far=structuredClone(self),none=structuredClone(self);
    near.identity.name="Near";far.identity.name="Far";none.identity.name="NoOverlap";
    near.fights.forEach(fight=>fight.actorID=202);far.fights=far.fights.slice(0,1);far.fights.forEach(fight=>fight.actorID=303);
    none.fights.forEach(fight=>{fight.actorID=404;fight.code="DifferentReport000";});
    const peers=[far,none,near].map(review=>({identity:review.identity,reviews:[review]})),{html,report}=render([self],peers);
    assert.equal(report.peers[0].identity.name,"Near");
    const peerPanel=panel(html,"Compare the same pulls"),optionsMarkup=peerPanel.match(/<select[^>]*>([\s\S]*?)<\/select>/)![1];
    assert(optionsMarkup.indexOf(">Near —")<optionsMarkup.indexOf(">Far —"));assert.doesNotMatch(optionsMarkup,/NoOverlap/);
    assert.match(peerPanel,/3\/3 shared kills have complete mechanics and survival/);assert.match(peerPanel,/3\/3 affected sampled kills/);
    assert.match(peerPanel,/2\/3 survived kills/);
    assert(peerPanel.includes("source=101"));assert(peerPanel.includes("source=202"));assert.match(peerPanel,/sampled-kill denominators, not mechanic opportunities/);
    assert.match(peerPanel,/No peer score or opportunity-normalized performance is inferred/);
    assert.doesNotMatch(peerPanel,/<(?:h[1-6]|dt)>Peer score|opportunity.normalized grade/i);
  });
  test("shared sources without a supported pair cannot render favorable zero-over-zero peer metrics", () => {
    const self=fixture("Self"),peer=structuredClone(self);peer.identity.name="Withheld";
    for(const fight of peer.fights){fight.actorID=202;fight.damage.complete=false;}
    const {html,report}=render([self],[{identity:peer.identity,reviews:[peer]}]);
    assert.equal(report.peers[0].sharedKills,2);assert.equal(report.peers[0].pairedKills,0);
    const peerPanel=panel(html,"Compare the same pulls");
    assert.match(peerPanel,/2 shared kills are withheld/);assert.match(peerPanel,/No complete, equally reviewed paired kills support a mechanic comparison/);
    assert.doesNotMatch(peerPanel,/0\/0 affected sampled kills|0 directly attributed fatal mistakes · 0 survived clean kills|Inspect 0 paired source kills/);
  });
  test("role and patch selection controls every detail and sensitivity ranges remain deletion scenarios", () => {
    const review=fixture("Filtered");review.fights[0].role="healer";
    const filtered=render([review],[],{...options,role:"tank"});
    assert.equal(filtered.report.reliability.sampledKills,0);assert.equal(filtered.report.deaths.length,0);assert.equal(filtered.report.bosses.length,0);
    assert.doesNotMatch(filtered.html,/Dodgeable Blast|Teammate Barrier/);
    const full=render([fixture("Sensitivity",3)]);
    assert.match(full.html,/Remove one sampled kill/);assert.match(full.html,/Remove one boss/);
    assert.match(full.html,/holding the other raiders fixed/);assert.match(full.html,/not statistical confidence/);
    assert.match(full.html,/sample variants · 1 become ungraded/);
    const missingPatch=render([review],[],{...options,patch:"unsupported-patch"});
    assert.equal(missingPatch.report.reliability.sampledKills,0);assert.doesNotMatch(missingPatch.html,/Dodgeable Blast|Teammate Barrier/);
  });
  test("nullable death timing stays explicitly unverified rather than becoming zero", () => {
    const {report,stability}=render([fixture("Timing",1)]);
    const copy=structuredClone(report) as RaiderReport;
    copy.deaths[0].atSeconds=null;copy.deaths[0].remainingFightSeconds=null;copy.deaths[0].remainingFightPercent=null;
    const html=renderToStaticMarkup(createElement(RaiderReportCard,{report:copy,stability}));
    assert.match(html,/Time after pull<\/dt><dd>Unverified/);assert.match(html,/Fight time remaining at death<\/dt><dd>Unverified · Unverified/);
    assert.doesNotMatch(html,/Time after pull<\/dt><dd>0:00/);
  });
  test("a lone nonfatal contact in a broader sample cannot become a no-contact coaching claim", () => {
    const reviews=structuredClone(snapshot.raiders.find(value=>value.identity.name==="Bstay")!.reviews) as RaidBossReview[];
    for(const review of reviews)for(const fight of review.fights){
      fight.survival.deaths=[];fight.damage.complete=true;fight.survival.complete=true;fight.utility.complete=true;
      for(const ability of fight.damage.abilities){ability.health=0;ability.absorbed=0;ability.clusters=0;ability.hits=0;}
    }
    const ability=reviews.flatMap(review=>review.fights).flatMap(fight=>fight.damage.abilities).find(value=>!value.contextual&&value.abilityID!==1300239)!;
    ability.health=10;ability.clusters=1;ability.hits=1;
    const {html,report}=render(reviews);
    assert.equal(report.assessment.rankEligible,true);assert.equal(report.reliability.contactIncidents,1);
    assert.doesNotMatch(html,/No reviewed avoidable contacts are identified/);assert.match(html,/1 contacts|1 observed contacts/);
  });
  test("support attribution limitations read plainly while retaining exact source codes for inspection", () => {
    const review=fixture("Support");for(const fight of review.fights){fight.utility.complete=false;fight.limitations=["healing:event-actor-unverified","dispels:event-actor-unverified","healing:missing-event-page"];}
    const {html}=render([review]);
    assert.match(html,/Teammate shield attribution could not be verified for part of the sample/);
    assert.match(html,/Dispel attribution could not be verified for part of the sample/);
    assert.match(html,/Teammate shield event coverage is incomplete for part of the sample/);
    assert.match(html,/Inspect source limitation code/);assert.match(html,/<code>[^<]*healing:event-actor-unverified/);
    assert.doesNotMatch(html,/pet attribution|rename caused|network timeout caused/i);
  });
  test("real saved Unrly limitations with native colon spacing read plainly and preserve the original code", () => {
    const raider=snapshot.raiders.find(value=>value.identity.name==="Unrlydemonic")!;
    const {report,html}=render(raider.reviews as RaidBossReview[]);
    assert(report.limits.some(limit=>limit.includes("healing: event-actor-unverified")),"the regression must exercise the real spaced native code");
    const support=panel(html,"Observed support").split("<summary>Compare the same pulls")[0],evidence=panel(html,"Evidence limits");
    assert.match(support,/Teammate shield attribution could not be verified for part of the sample/);
    assert.match(evidence,/Teammate shield attribution could not be verified for part of the sample/);
    assert.match(evidence,/Inspect source limitation code/);assert.match(evidence,/<code>[^<]*healing: event-actor-unverified/);
    assert.doesNotMatch(support,/healing: event-actor-unverified/);
  });
  test("whitespace around a known limitation colon is display-only and unknown source wording remains intact", () => {
    const review=fixture("Whitespace");for(const fight of review.fights){fight.utility.complete=false;fight.limitations=["healing \t : \t missing-event-page","healing : untouched-unknown"];}
    const {html}=render([review]),support=panel(html,"Observed support").split("<summary>Compare the same pulls")[0],evidence=panel(html,"Evidence limits");
    assert.match(support,/Teammate shield event coverage is incomplete for part of the sample/);
    assert.match(evidence,/<code>[^<]*healing \t : \t missing-event-page/);
    assert.match(evidence,/healing : untouched-unknown/);
    assert.doesNotMatch(support,/Teammate shield attribution could not be verified/);
  });
});
