"use client";

import { useState } from "react";
import type { RaiderReport } from "./report";
import type { RankingStability } from "./stability";
import styles from "./report-card.module.css";

const ROLES = { dps: "DPS", tank: "Tank", healer: "Healer" };
const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 1 });
const percent = (value: number | null) => value === null ? "Unverified" : `${number(value)}%`;
const seconds = (value: number | null) => {
  if (value === null) return "Unverified";
  const rounded = Math.max(0, Math.round(value));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
};
const day = (value: number) => new Date(value).toISOString().slice(0, 10);
const peerKey = (identity: { name: string; server: string; region: string }) => [identity.name, identity.server, identity.region].join("|");
const SUPPORT_LIMITS = [
  ["healing:event-actor-unverified", "Teammate shield attribution could not be verified for part of the sample."],
  ["healing:missing-event-page", "Teammate shield event coverage is incomplete for part of the sample."],
  ["dispels:event-actor-unverified", "Dispel attribution could not be verified for part of the sample."],
  ["interrupts:event-actor-unverified", "Interrupt attribution could not be verified for part of the sample."],
] as const;
const canonicalLimit = (value: string) => value.replace(/\s*:\s*/g,":");
const friendlyLimit = (value: string) => SUPPORT_LIMITS.reduce((text,[code,label]) => text.replace(new RegExp(code.replace(":","\\s*:\\s*"),"g"),label),value);
type Source = RaiderReport["deaths"][number]["source"];

function SourceLinks({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  const links = <ul className={styles.sources}>{sources.map(source => <li key={`${source.code}:${source.fightID}:${source.actorID}`}>
    <a href={source.url} target="_blank" rel="noopener noreferrer">{source.bossName} · {day(source.date)} · Fight {source.fightID} · Patch {source.patch}</a>
  </li>)}</ul>;
  return sources.length > 2 ? <details className={styles.sourceToggle}><summary>Inspect {sources.length} source kills</summary>{links}</details> : links;
}

function Mechanics({ report }: { report: RaiderReport }) {
  return <details className={styles.panel}><summary>Mechanic reliability<span>{report.mechanics.length} reviewed mechanics</span></summary>
    <div className={styles.panelContent}>
      <p>Affected sampled kills show whether a reviewed contact occurred in a complete observed kill. This is a sample denominator; mechanic opportunities and assignments are unknown.</p>
      {!report.mechanics.length ? <p className={styles.quiet}>No complete reviewed mechanic observations in this role and patch selection. Missing evidence does not establish a clean performance.</p> : <>
        <h4>Boss and patch overview</h4>
        <div className={styles.tableWrap}><table aria-label="Boss and patch reliability"><thead><tr><th scope="col">Boss / source patch</th><th scope="col">Affected sampled kills</th><th scope="col">Survived clean kills</th><th scope="col">Contacts / fatal mistakes</th><th scope="col">Health / absorbed damage</th></tr></thead>
          <tbody>{report.bosses.map(row => <tr key={`${row.bossID}:${row.partition}:${row.patch}`}>
            <th scope="row">{row.bossName}<small>Patch {row.patch} · {row.mechanics.length} reviewed mechanics</small><SourceLinks sources={row.sources}/></th>
            <td>{row.affectedKills}/{row.observedKills}<small>complete observed kills</small></td><td>{row.survivedCleanKills}/{row.observedKills}<small>survived without reviewed contacts</small><small>{row.survivedKills}/{row.observedKills} survived overall</small></td>
            <td>{number(row.incidents)} contacts<small>{row.avoidableDeaths} directly attributed fatal mistakes</small></td><td>{number(row.health)} health<small>{number(row.absorbed)} absorbed</small></td>
          </tr>)}</tbody></table></div>
        <h4>Individual mechanics</h4>
        <div className={styles.tableWrap}><table aria-label="Reviewed mechanic reliability"><thead><tr><th scope="col">Boss / mechanic</th><th scope="col">Affected sampled kills</th><th scope="col">Contacts / fatal mistakes</th><th scope="col">Health / absorbed damage</th><th scope="col">Sample pattern</th></tr></thead>
          <tbody>{report.mechanics.map(row => <tr key={`${row.bossID}:${row.partition}:${row.patch}:${row.abilityID}`}>
            <th scope="row">{row.abilityName}<small>{row.bossName} · Patch {row.patch}</small></th>
            <td>{row.affectedKills}/{row.observedKills}<small>complete observed kills</small></td>
            <td>{number(row.incidents)} contacts<small>{row.avoidableDeaths} directly attributed fatal mistakes</small></td>
            <td>{number(row.health)} health<small>{number(row.absorbed)} absorbed</small></td>
            <td><p>{row.trend.label}</p><details className={styles.sourceToggle}><summary>Inspect {row.observations.length} chronological kills</summary>
              <ul className={styles.observations}>{row.observations.map(observation => <li key={`${observation.source.code}:${observation.source.fightID}:${observation.source.actorID}`}>
                <a href={observation.source.url} target="_blank" rel="noopener noreferrer">{day(observation.source.date)} · Fight {observation.source.fightID}</a>
                <small>{observation.affected ? "Affected" : "No reviewed contact"} · {observation.incidents} contacts · {number(observation.health)} health / {number(observation.absorbed)} absorbed · {observation.avoidableDeaths} fatal mistakes</small>
              </li>)}</ul>
            </details></td>
          </tr>)}</tbody></table></div>
        <p className={styles.muted}>Adjacent damaging ticks are grouped into contact incidents. Absorbed damage remains visible separately from health lost. Context-dependent mechanics carry no automatic blame.</p>
      </>}
    </div>
  </details>;
}

function Deaths({ report }: { report: RaiderReport }) {
  const labels = {"reviewed-avoidable":"Directly attributed fatal mistake","reported-avoidable-incomplete":"Reported avoidable cause · incomplete evidence","context-or-unproven":"Context or unproven cause","unknown-cause":"Cause unknown"};
  return <details className={styles.panel}><summary>Inspect deaths<span>{report.deaths.length} recorded events</span></summary>
    <div className={styles.panelContent}>
      <p>Only directly attributed avoidable deaths count as fatal mistakes. Context-dependent and unknown causes remain unassigned. Fight time remaining at death does not establish time spent dead; resurrection events and assignments are unavailable.</p>
      {!report.deaths.length ? <p className={styles.quiet}>No death events are retained in this selection. An empty or incomplete survival sample cannot establish that no deaths occurred.</p> : <div className={styles.deaths}>
        {report.deaths.map((death, index) => <article className={styles.death} key={`${death.source.code}:${death.source.fightID}:${death.source.actorID}:${death.atSeconds}:${index}`}>
          <h4>{death.causeName}</h4><p className={styles.muted}>{death.source.bossName} · {day(death.source.date)} · {ROLES[death.source.role]} · Patch {death.source.patch}</p>
          <dl><div><dt>Time after pull</dt><dd>{seconds(death.atSeconds)}</dd></div>
            <div><dt>Fight time remaining at death</dt><dd>{seconds(death.remainingFightSeconds)} · {percent(death.remainingFightPercent)}</dd></div>
            <div><dt>Raid death event order</dt><dd>{death.raidDeathOrder === null ? "Order unknown" : `#${death.raidDeathOrder}`}</dd></div>
            <div><dt>Evidence streams</dt><dd>{death.mechanicsComplete && death.survivalComplete ? "Mechanics and survival complete" : "Partial evidence"}</dd></div></dl>
          <p className={death.attribution === "reviewed-avoidable" ? styles.fatal : styles.muted}>{labels[death.attribution]}</p><p>{death.explanation}</p><SourceLinks sources={[death.source]}/>
        </article>)}
      </div>}
    </div>
  </details>;
}

function Utility({ report }: { report: RaiderReport }) {
  const u = report.utility.observations;
  const count = (value: number) => report.utility.confidence === "complete" ? number(value) : value ? `Observed ≥ ${number(value)}` : "Unverified";
  return <details className={styles.panel}><summary>Observed support<span>{u.completeFights}/{u.observedFights} utility streams complete</span></summary>
    <div className={styles.panelContent}><p>{report.utility.summary}</p>
      <div className={styles.utilityGrid}>
        <div className={styles.utilityTile}><strong>{count(u.successfulInterrupts)}</strong><span>Successful interrupts</span></div>
        <div className={styles.utilityTile}><strong>{count(u.dispels)}</strong><span>Dispels</span></div>
        <div className={styles.utilityTile}><strong>{count(u.raidAbsorbed)}</strong><span>Logged teammate absorbs</span></div>
      </div>
      <p>Assignments, available opportunities and correct timing are unknown. These observed counts add no ranking points. Incomplete support is a lower bound; an unverified zero cannot establish zero contribution.</p>
      {SUPPORT_LIMITS.filter(([code]) => report.limits.some(limit => canonicalLimit(limit).includes(code))).map(([code,label]) => <p className={styles.muted} key={code}>{label}</p>)}
      {!!u.absorbAbilities.length && <div className={styles.tableWrap}><table aria-label="Observed teammate absorbs"><thead><tr><th scope="col">Teammate absorb ability</th><th scope="col">Observed amount</th></tr></thead>
        <tbody>{u.absorbAbilities.map(ability => <tr key={ability.abilityID}><th scope="row">{ability.name}</th><td>{number(ability.amount)}</td></tr>)}</tbody></table></div>}
    </div>
  </details>;
}

function Peers({ report }: { report: RaiderReport }) {
  const [selected, setSelected] = useState("");
  const peers = report.peers.filter(value => value.sharedKills > 0);
  const peer = peers.find(value => peerKey(value.identity) === selected) ?? peers[0];
  return <details className={styles.panel}><summary>Compare the same pulls<span>{peers.length} overlapping peers</span></summary>
    <div className={styles.panelContent}>
      <p>Peers are ordered by paired kills with complete mechanics and equal reviewed coverage, with the largest supported overlap first. Comparisons use the same boss, patch, role and report fight. Different assignments and opportunities remain unknown.</p>
      {!peer ? <p className={styles.quiet}>No supported same-pull peer comparison for this selection. Broader samples from different pulls are not substituted.</p> : <>
        <label className={styles.select}>Peer with shared sampled kills<select value={peerKey(peer.identity)} onChange={event => setSelected(event.target.value)}>
          {peers.map(value => <option key={peerKey(value.identity)} value={peerKey(value.identity)}>{value.identity.name} — {value.identity.server} · {value.pairedKills} paired kills</option>)}
        </select></label><p>{peer.summary}</p>
        <p>{peer.pairedKills}/{peer.sharedKills} shared kills have complete mechanics and survival for both raiders. {peer.withheldKills} shared kills are withheld from the paired comparison.</p>
        {peer.pairedKills ? <div className={styles.peerSummary}>{[{name:report.assessment.identity?.name ?? "Selected raider",metrics:peer.self},{name:peer.identity.name,metrics:peer.peer}].map(side => <div key={side.name}>
          <h4>{side.name}</h4><p>{side.metrics.affectedKills}/{peer.pairedKills} affected sampled kills · {side.metrics.incidents} contacts</p>
          <p>{side.metrics.survivedKills}/{peer.pairedKills} survived kills · {side.metrics.survivedCleanKills} survived clean kills</p><p>{side.metrics.avoidableDeaths} directly attributed fatal mistakes</p>
        </div>)}</div> : <p className={styles.quiet}>No complete, equally reviewed paired kills support a mechanic comparison. Incomplete shared evidence remains ungraded.</p>}
        {!!peer.sources.length && <details className={styles.sourceToggle}><summary>Inspect {peer.sources.length} paired source kills</summary>
          <ul className={styles.sources}>{peer.sources.map(source => <li key={`${source.self.code}:${source.self.fightID}:${source.self.actorID}:${source.peer.actorID}`}>
            {source.self.bossName} · {day(source.self.date)} · Patch {source.self.patch} · <a href={source.self.url} target="_blank" rel="noopener noreferrer">{report.assessment.identity?.name ?? "Selected raider"}</a>{" / "}
            <a href={source.peer.url} target="_blank" rel="noopener noreferrer">{peer.identity.name}</a>
          </li>)}</ul>
        </details>}{peer.limits.map((limit,index) => <p key={index} className={styles.muted}>{limit}</p>)}
      </>}
    </div>
  </details>;
}

function Stability({ stability }: { stability: RankingStability }) {
  const range = (minimum: number | null, maximum: number | null, prefix = "") => minimum === null || maximum === null ? "Ungraded" : minimum === maximum ? `${prefix}${number(minimum)}` : `${prefix}${number(minimum)} – ${prefix}${number(maximum)}`;
  return <details className={styles.panel}><summary>Ranking sensitivity<span>How much the sample changes the result</span></summary>
    <div className={styles.panelContent}><p>{stability.summary}</p>
      {stability.status === "available" && <p>Current estimate: {range(stability.baselineScore,stability.baselineScore)} · placement {range(stability.baselineRank,stability.baselineRank,"#")}.</p>}
      {stability.status === "available" && <div className={styles.scenarioList}>{[
        {label:"Remove one sampled kill",value:stability.killRemoval}, {label:"Remove one boss",value:stability.bossRemoval},
      ].map(scenario => <div className={styles.scenario} key={scenario.label}><div><strong>{scenario.label}</strong><p>{scenario.value.cases} sample variants · {scenario.value.ungradedCases} become ungraded</p></div>
        <p>Score {range(scenario.value.scoreMin,scenario.value.scoreMax)}<br/>Placement {range(scenario.value.rankMin,scenario.value.rankMax,"#")}</p>
      </div>)}</div>}
      <p className={styles.muted}>{stability.limitation}</p>
    </div>
  </details>;
}

function GradeBreakdown({ report }: { report: RaiderReport }) {
  const a = report.assessment, b = a.breakdown;
  return <section className={styles.gradeBreakdown} aria-label="Execution grade breakdown">
    <h3>Why this grade</h3><p>{a.rubric.label} · a fixed coaching policy based on reviewed mistakes, not damage or healing output.</p>
    <dl className={styles.components}>{b.components.map(component => <div key={component.key}>
      <dt>{component.label}</dt><dd>{component.points === null ? "Ungraded" : `${number(component.points)} / ${component.weight}`}</dd>
      <p>earned points</p></div>)}</dl>
    {b.gradeableKills ? <p>{b.affectedKills}/{b.gradeableKills} gradeable kills contained reviewed contacts or a proven fatal mistake; {number(b.contactIncidents)} contact incidents; {b.avoidableFatalKills} kills with a directly attributed avoidable death.</p>
      : <p>No gradeable kill evidence for these components. Missing or unmatched evidence cannot establish clean execution.</p>}
    <p className={styles.muted}>{b.exposureAdjustedKills} shortened kills had mechanics credit capped at matching survived evidence. {b.ungradedContextDeaths} context-death kills lack a matching survived baseline and remain ungraded.</p>
    <details className={styles.sourceToggle}><summary>Inspect scoring policy and boss points</summary>
      <p>{a.rubric.description}</p><p>Weights are coaching choices, not statistically learned from these 26 raiders. Contact incidents describe sampled mistakes, not mechanic opportunities. Historical coverage can be narrower; source patches remain visible. Displayed points are rounded.</p>
      <p>Grade bands: {a.rubric.thresholds.map(band => `${band.letter} ≥ ${band.minimum}`).join(" · ")}</p>
      <div className={styles.tableWrap}><table aria-label="Execution grade by boss"><thead><tr><th scope="col">Boss</th><th scope="col">Consistency / 30</th><th scope="col">Control / 30</th><th scope="col">Survival / 40</th><th scope="col">Execution</th></tr></thead><tbody>
        {a.bosses.map(boss => <tr key={boss.boss.id}><th scope="row">{boss.boss.name}<small>{boss.gradeableKills}/{boss.sampledKills} gradeable kills · weight {boss.weight}</small><small>Patch {boss.sourcePatches.join(" / ")}</small></th>
          {boss.breakdown.components.map(component => <td key={component.key}>{component.points === null ? "—" : number(component.points)}</td>)}
          <td>{boss.score === null ? "Ungraded" : `${boss.letter} ${number(boss.score)}`}</td></tr>)}
      </tbody></table></div>
    </details>
  </section>;
}

export default function RaiderReportCard({ report, stability }: { report: RaiderReport; stability: RankingStability }) {
  const a = report.assessment, r = report.reliability;
  const noMechanics = r.completeObservedKills === 0;
  return <section className={styles.card} aria-label="Raider execution report card">
    <header className={styles.heading}><div><p className={styles.eyebrow}>Detailed execution report</p><h2>{a.identity?.name ?? "Selected raider"}</h2>
      <p className={styles.muted}>{a.identity?.server ?? "No matching identity evidence"} · {a.role ? ROLES[a.role] : "No role sample"} · {a.patchLabel}</p>
      <p className={styles.muted}>Saved observations from your selected role and patches.</p></div>
      <div className={styles.score}><strong>{a.letter ?? "Ungraded"}{a.score !== null ? ` ${a.score.toFixed(1)}` : ""}</strong>
        {a.score !== null && !a.rankEligible && <span className={styles.badge}>Provisional</span>}<small>{a.sampleLabel} · {a.gradedBosses}/10 graded bosses</small></div>
    </header>
    <div className={styles.body}><dl className={styles.stats}>
      <div className={styles.stat}><dt>Mechanic reliability</dt><dd>{noMechanics ? "Unknown" : `${r.affectedKills}/${r.completeObservedKills}`}</dd><p>{noMechanics ? "Complete mechanics evidence unavailable" : "affected sampled kills in complete observed evidence"}</p></div>
      <div className={styles.stat}><dt>Survival</dt><dd>{r.completeSurvivalKills === 0 ? "Unknown" : `${r.confirmedAvoidableDeaths} confirmed fatal mistakes`}</dd><p>{r.completeSurvivalDeaths} death events across {r.completeSurvivalKills} complete survival kills; context and unknown causes unassigned</p></div>
      <div className={styles.stat}><dt>Observed support</dt><dd>{r.utilityCompleteKills}/{r.utilityObservedKills}</dd><p>utility streams complete; assignments unknown</p></div>
      <div className={styles.stat}><dt>Sample coverage</dt><dd>{r.gradeableKills}/{r.sampledKills}</dd><p>gradeable sampled kills · {r.incompleteMechanicsKills} with incomplete mechanics</p></div>
    </dl><p className={styles.muted}>{r.summary}</p><GradeBreakdown report={report}/>
      <div className={styles.priorities}><h3>Main improvement priorities</h3>
        {report.priorities.length ? <ol>{report.priorities.slice(0,3).map((priority,index) => <li key={`${priority.kind}:${priority.bossID}:${priority.abilityID}:${index}`}><div><h4>{priority.title}</h4><p>{priority.detail}</p><SourceLinks sources={priority.sources}/></div></li>)}</ol>
          : <p className={styles.quiet}>{noMechanics ? "Insufficient complete mechanics evidence to identify improvement priorities." : r.contactIncidents || r.affectedKills
            ? `No repeated or fatal issue stands out. Mechanic details retain ${r.contactIncidents} observed contacts across ${r.affectedKills} affected sampled kills.`
            : "No reviewed avoidable contacts are identified in the complete observed evidence. This does not assess unreviewed mechanics or unknown assignments."}</p>}
      </div>
      <Mechanics report={report}/><Deaths report={report}/><Utility report={report}/><Peers report={report}/><Stability stability={stability}/>
      {!!report.limits.length && <details className={styles.panel}><summary>Evidence limits<span>{report.limits.length} notes</span></summary><div className={styles.panelContent}>{report.limits.map((limit,index) => <div key={index}><p>{friendlyLimit(limit)}</p>{friendlyLimit(limit)!==limit && <details className={styles.sourceToggle}><summary>Inspect source limitation code</summary><p><code>{limit}</code></p></details>}</div>)}</div></details>}
    </div>
  </section>;
}
