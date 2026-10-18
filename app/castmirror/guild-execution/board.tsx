"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { assessRaidRanking, compareSharedRaidRanking, selectRaidRankingReviews } from "@/app/api/castmirror/execution/raid/grade";
import type { RaidBossReview, RaidRole } from "@/app/api/castmirror/execution/raid/types";
import styles from "./board.module.css";
import RaiderReportCard from "./report-card";
import { buildRaiderReport } from "./report";
import { buildRankingStability } from "./stability";

export interface GuildExecutionSnapshot {
  version: "guild-execution-snapshot-1";
  title: string;
  guild: { name: string; server: string; region: string };
  snapshotAt: string;
  reviewedAt: string;
  currentPatch: string;
  patches: string[];
  scope: { zone: number; difficulty: number };
  limitations: string[];
  raiders: Array<{ identity: { name: string; server: string; region: string }; membership: "verified";
    reviews: RaidBossReview[]; legacyScore: number | null; legacyLetter: string | null; coaching: string[]; evidenceStatus: string }>;
  provenance?: { sourceSHA256: string; sourceAt: string; publicSelectedReviews: number; sampledKills: number };
}
type RoleFilter = "primary" | RaidRole;
const ROLE_NAMES = { dps: "DPS", tank: "Tank", healer: "Healer" };
const key = (identity: GuildExecutionSnapshot["raiders"][number]["identity"]) => [identity.name.toLowerCase(), identity.server.toLowerCase(), identity.region].join("|");
const date = (value: number | string) => new Date(value).toISOString().slice(0, 10);

export function guildCoaching(reviews: RaidBossReview[]) {
  const abilities = new Map<number, { name: string; contacts: number; fatal: number }>();
  for (const review of reviews) for (const fight of review.fights) {
    if (!fight.damage.complete || !fight.survival.complete) continue;
    for (const ability of fight.damage.abilities) {
      if (ability.contextual || ability.abilityID === 1300239 || !(ability.health + ability.absorbed > 0)) continue;
      const previous = abilities.get(ability.abilityID) ?? { name: ability.name, contacts: 0, fatal: 0 };
      previous.contacts += ability.clusters;
      previous.fatal += fight.survival.deaths.filter(d => d.reviewedAvoidable && d.causeID === ability.abilityID).length;
      abilities.set(ability.abilityID, previous);
    }
  }
  return [...abilities.values()].filter(a => a.contacts || a.fatal).sort((a, b) => b.fatal - a.fatal || b.contacts - a.contacts || a.name.localeCompare(b.name))
    .slice(0, 2).map(a => `${a.name}: ${a.contacts} reviewed contacts${a.fatal ? `, ${a.fatal} directly attributed ${a.fatal === 1 ? "death" : "deaths"}` : ""}.`);
}

export function guildRows(snapshot: GuildExecutionSnapshot, role: RoleFilter, patch: string) {
  const rows = snapshot.raiders.map(raider => {
    const options = { role, patch, currentPatch: snapshot.currentPatch };
    const assessment = assessRaidRanking(raider.reviews, options);
    const selected = selectRaidRankingReviews(raider.reviews, options);
    return { raider, assessment, reviews: selected.reviews, coaching: guildCoaching(selected.reviews), primaryView: role === "primary", rank: null as number | null };
  });
  rows.sort((a, b) => (b.assessment.score ?? -1) - (a.assessment.score ?? -1)
    || a.raider.identity.name.localeCompare(b.raider.identity.name)
    || key(a.raider.identity).localeCompare(key(b.raider.identity)));
  rows.forEach((row, index) => {
    if (row.assessment.score !== null) {
      row.rank = index && row.assessment.score === rows[index - 1].assessment.score ? rows[index - 1].rank : index + 1;
    }
  });
  return rows;
}
type Row = ReturnType<typeof guildRows>[number];
function support(row: Row) {
  const u = row.assessment.utility, complete = row.assessment.utilityConfidence === "complete";
  const count = (n: number) => !complete && n === 0 ? "unverified" : `${complete ? "" : "observed ≥ "}${n.toLocaleString("en-US")}`;
  return `${count(u.successfulInterrupts)} interrupts · ${count(u.dispels)} dispels · ${count(u.raidAbsorbed)} absorbed on teammates`;
}
function Evidence({ row }: { row: Row }) {
  const a = row.assessment;
  return <details className={styles.evidence}><summary>Evidence and source kills</summary>
    <p>{a.summary}</p><p>{support(row)}. Utility is descriptive, with no points for unknown assignments.</p>
    <p>Utility complete in {a.utility.completeFights}/{a.utility.observedFights} sampled fights.</p>
    <p>Legacy overall score: {row.raider.legacyLetter ?? "Ungraded"} {row.raider.legacyScore ?? ""}. This older score can blend roles and weights bosses equally.</p>
    <p>Saved review status across all roles and patches: {row.raider.evidenceStatus}. Context-dependent deaths require assignment review.</p>
    {a.exclusions.filter(reason => row.primaryView || !reason.startsWith("Primary role tie")).map((reason, i) => <p key={i}>{reason}</p>)}
    {row.reviews.map(review => <div key={review.boss.id}><h4>{review.boss.name}</h4>
      <p>{review.reason ?? "Collected public evidence"}</p>
      <ul>{review.fights.map(fight => <li key={`${fight.code}:${fight.fightID}:${fight.actorID}`}>
        <a href={`https://www.warcraftlogs.com/reports/${fight.code}#fight=${fight.fightID}&source=${fight.actorID}`} target="_blank" rel="noopener noreferrer">
          {date(fight.date)} · {fight.spec} · {fight.role} · Patch {fight.scope?.patch ?? review.scope.patch}
        </a>
        {(!fight.damage.complete || !fight.survival.complete || !fight.utility.complete) && <span> · partial evidence</span>}
        {fight.limitations.filter(v => /^(damage|deaths|healing|casts|dispels|interrupts):/.test(v)).map((v, i) => <p key={i}>{v}</p>)}
      </li>)}</ul></div>)}
  </details>;
}
function Results({ rows, onReport }: { rows: Row[]; onReport: (identity: GuildExecutionSnapshot["raiders"][number]["identity"]) => void }) {
  return <div className={styles.tableWrap}><table aria-label="Overall execution ranking"><thead><tr><th scope="col">Placement</th><th scope="col">Raider</th><th scope="col">Execution</th><th scope="col">Evidence</th><th scope="col">Main improvement areas</th></tr></thead>
    <tbody>{rows.map(row => { const a = row.assessment; return <tr key={key(row.raider.identity)}>
      <td>{row.rank === null ? "—" : `#${row.rank}`}</td>
      <th scope="row">{row.raider.identity.name}<small>{row.raider.identity.server}</small><small>{a.role ? ROLE_NAMES[a.role as RaidRole] : "No role sample"}</small>
        <button type="button" className={styles.reportButton} onClick={() => onReport(row.raider.identity)} aria-label={`View ${row.raider.identity.name}'s report card`}>View report card</button></th>
      <td><strong>{a.letter ?? "Ungraded"}</strong>{a.score !== null && <span> {a.score.toFixed(1)}</span>}
        {a.score !== null && !a.rankEligible && <small className={styles.provisional}>Provisional</small>}
        {a.score !== null ? <><small>{a.breakdown.affectedKills}/{a.gradeableKills} graded kills affected</small><small>{a.breakdown.avoidableFatalKills} avoidable fatal kills</small></> : <small>No gradeable mechanics evidence</small>}</td>
      <td>{a.sampledKills} kills · {a.gradedBosses}/10 bosses<small>{a.supportedBosses} bosses with ≥3 gradeable kills</small><small>{a.sampleLabel}</small>
        <small>{a.sourcePatches.length ? `Patch ${a.sourcePatches.join(" / ")}` : "No matching patch evidence"}</small>
        {row.primaryView && a.primaryRoleAmbiguous && <small>Primary role tied; choose a role explicitly.</small>}
        {a.firstDate && a.lastDate && <small>{date(a.firstDate)} – {date(a.lastDate)}</small>}
        <Evidence row={row}/></td>
      <td>{row.coaching.length ? <ul>{row.coaching.map(point => <li key={point}>{point}</li>)}</ul> : <p>{!a.sampledKills ? "No supported observations for this filter." : !a.gradeableKills
        ? "Insufficient complete, gradeable exposure to identify improvement areas." : "No reviewed avoidable contacts in the complete observed evidence. Incomplete evidence remains ungraded."}</p>}
        {a.role === "tank" && <small>Interpret movement alongside tank assignments.</small>}</td>
    </tr>; })}</tbody></table></div>;
}

function SharedKills({ snapshot, patch }: { snapshot: GuildExecutionSnapshot; patch: string }) {
  const [left, setLeft] = useState(key(snapshot.raiders[0].identity)), [right, setRight] = useState(key(snapshot.raiders[1].identity)), [role, setRole] = useState<RaidRole>("dps");
  const a = snapshot.raiders.find(r => key(r.identity) === left)!, b = snapshot.raiders.find(r => key(r.identity) === right)!;
  const comparison = compareSharedRaidRanking(a.reviews, b.reviews, { role, patch, currentPatch: snapshot.currentPatch });
  const choices = snapshot.raiders.map(r => <option key={key(r.identity)} value={key(r.identity)}>{r.identity.name} — {r.identity.server}</option>);
  return <section className={styles.note}><h2>Compare the same kills</h2><p>Use only shared report fights in an explicit role and the patch selection above. Different assignments and opportunities remain unknown.</p>
    <div className={styles.filters}><label>First raider<select value={left} onChange={e => setLeft(e.target.value)}>{choices}</select></label>
      <label>Second raider<select value={right} onChange={e => setRight(e.target.value)}>{choices}</select></label>
      <label>Shared role<select value={role} onChange={e => setRole(e.target.value as RaidRole)}><option value="dps">DPS</option><option value="tank">Tank</option><option value="healer">Healer</option></select></label></div>
    {left === right ? <p>Choose two different raiders.</p> : <div aria-live="polite"><p>{comparison.sharedFights} exact shared kills · {comparison.sharedBosses} bosses · {ROLE_NAMES[role]}</p>
      <p>{comparison.reason}</p>
      {comparison.status === "compared" && <p>{a.identity.name}: {comparison.a.letter} {comparison.a.score?.toFixed(1)} ({comparison.a.sampleLabel}) · {b.identity.name}: {comparison.b.letter} {comparison.b.score?.toFixed(1)} ({comparison.b.sampleLabel}). Both remain provisional.</p>}
      {!!comparison.sharedFights && <p>Gradeable exposure: {a.identity.name} {comparison.a.gradeableKills}/{comparison.a.sampledKills} sampled shared kills · {b.identity.name} {comparison.b.gradeableKills}/{comparison.b.sampledKills}. Shared sources can have different complete or surviving exposure.</p>}
      {!!comparison.sources.length && <details><summary>Inspect shared source kills</summary><ul>{comparison.sources.map(source => <li key={`${source.code}:${source.fightID}:${source.bossID}`}>
        Patch {source.patch} · <a href={`https://www.warcraftlogs.com/reports/${source.code}#fight=${source.fightID}&source=${source.actorA}`} target="_blank" rel="noopener noreferrer">{a.identity.name}</a>{" / "}
        <a href={`https://www.warcraftlogs.com/reports/${source.code}#fight=${source.fightID}&source=${source.actorB}`} target="_blank" rel="noopener noreferrer">{b.identity.name}</a>
      </li>)}</ul></details>}</div>}
  </section>;
}

export default function GuildExecutionBoard({ snapshot }: { snapshot: GuildExecutionSnapshot }) {
  const [role, setRole] = useState<RoleFilter>("primary"), [patch, setPatch] = useState("all");
  const [reportIdentity, setReportIdentity] = useState(snapshot.raiders[0] ? key(snapshot.raiders[0].identity) : "");
  const reportSection = useRef<HTMLElement>(null);
  const rows = guildRows(snapshot, role, patch), supported = rows.filter(r => r.assessment.rankEligible), limited = rows.filter(r => !r.assessment.rankEligible);
  const selectedRaider = snapshot.raiders.find(raider => key(raider.identity) === reportIdentity) ?? snapshot.raiders[0];
  const diagnostics = useMemo(() => {
    if (!selectedRaider) return null;
    const options = { role, patch, currentPatch: snapshot.currentPatch };
    return { report: buildRaiderReport(selectedRaider.reviews, options, snapshot.raiders),
      stability: buildRankingStability(selectedRaider.reviews, options, snapshot.raiders) };
  }, [selectedRaider, role, patch, snapshot]);
  const showReport = (identity: GuildExecutionSnapshot["raiders"][number]["identity"]) => {
    setReportIdentity(key(identity));
    reportSection.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return <main className={styles.page}>
    <nav><Link href="/castmirror">← Cast Mirror</Link></nav>
    <header><p className={styles.eyebrow}>Saved Mythic execution review</p><h1>{snapshot.guild.name}</h1>
      <p>The Venomous Abyss · {snapshot.guild.region.toUpperCase()} {snapshot.guild.server}</p>
      <p className={styles.muted}>Snapshot reviewed {date(snapshot.reviewedAt)}. This page reads saved public evidence and makes no new log requests.</p></header>
    <section className={styles.note}><h2>How this ranking works</h2><p>All raiders appear in one ranking using Execution reliability v2: 30% mistake-free consistency, 30% contact control and 40% avoiding proven fatal mistakes. Repeated mistakes across kills now matter more. Each score uses one role and your selected patches; roles and sample sizes remain visible.</p>
      <p>Provisional marks a limited sample or ambiguous primary role. A broader sample requires at least four bosses with three gradeable kills each. Boss weights stop increasing after three kills. Equal scores share a placement; missing graded evidence receives no placement.</p>
      <p>Primary role means the role with the most gradeable kills in this patch selection; equal counts use DPS, then tank, then healer for display and are marked provisional until you choose a role explicitly. Support counts never add points.</p></section>
    <div className={styles.filters}><label>Role<select value={role} onChange={e => setRole(e.target.value as RoleFilter)}><option value="primary">Primary role for each raider</option><option value="dps">DPS</option><option value="tank">Tank</option><option value="healer">Healer</option></select></label>
      <label>Patch<select value={patch} onChange={e => setPatch(e.target.value)}><option value="all">All reviewed patches</option><option value="current">{snapshot.currentPatch} · current only</option>{snapshot.patches.filter(p => p !== snapshot.currentPatch).map(p => <option key={p} value={p}>{p} · historical only</option>)}</select></label></div>
    <p aria-live="polite">{supported.length} broader samples · {limited.length} provisional or ungraded samples · all {rows.length} reviewed raiders shown. Pawed excluded at the user’s request.</p>
    <section ref={reportSection} className={styles.reportSection} aria-labelledby="raider-report-title">
      <h2 id="raider-report-title">Raider report card</h2>
      <p className={styles.muted}>Recurring mechanics, death context and shared-kill comparisons from the saved evidence. The role and patch filters above apply throughout.</p>
      <div className={styles.filters}><label>Report card raider<select value={selectedRaider ? key(selectedRaider.identity) : ""} onChange={event => setReportIdentity(event.target.value)}>
        {snapshot.raiders.map(raider => <option key={key(raider.identity)} value={key(raider.identity)}>{raider.identity.name} — {raider.identity.server}</option>)}
      </select></label></div>
      {diagnostics && selectedRaider && <RaiderReportCard key={`${key(selectedRaider.identity)}:${role}:${patch}`} report={diagnostics.report} stability={diagnostics.stability}/>}
    </section>
    <section><h2>Overall execution ranking</h2><p className={styles.muted}>Placement describes the selected mechanics sample, not a percentile or complete measure of raid contribution. Broader samples also remain automated coaching estimates.</p>
      <Results rows={rows} onReport={showReport}/></section>
    <SharedKills snapshot={snapshot} patch={patch}/>
    <section className={styles.note}><h2>What this cannot establish</h2><p>Interrupt, dispel and cooldown assignments are unknown. Incomplete support is an observed lower bound; zero unverified events does not establish zero contribution. Context deaths carry no automatic blame. Historical patches can cover fewer reviewed mechanics.</p>
      {snapshot.limitations.map((limit, i) => <p key={i}>{limit}</p>)}</section>
  </main>;
}
