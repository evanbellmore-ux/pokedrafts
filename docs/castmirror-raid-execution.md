# Raid execution review

Find a character's kills in Cast Mirror, then choose **Review raid execution**. The review does not require a selected damage log or a world-ranking reference. It uses the selected character, realm, region, raid and difficulty. The first release supports the reviewed current Mythic raid.

The review checks each boss in order and collects up to six of the character's latest eligible public kills per boss across the explicitly reviewed patches, currently 12.1 and 12.1.5. Selection uses date, not damage or healing rank. Each kill retains its verified patch and partition; older kills are never relabeled as current evidence. The overall review and each boss show reviewed patch coverage, actual sampled patches and sample dates. Each source kill also shows its patch. A character with no suitable public evidence for a boss remains ungraded on that boss. Coverage is always shown alongside the overall letter.

The grade is a provisional automated coaching rubric, not an official percentile. Complete kills start at 100; each independently avoidable contact incident subtracts 5, and a directly attributed avoidable death subtracts 35, with a floor of zero. Adjacent damaging ticks of one ability within five seconds form one contact cluster. Grades average kills within each boss and weight graded bosses equally. The page shows the exact grade bands and limitations. Incomplete or shortened exposure cannot earn favorable credit. Context-dependent damage and deaths with unproven responsibility do not receive blame.

Successful interrupts, dispels and logged damage absorbed on teammates appear as observed raid support. Unknown assignments and opportunities prevent using those raw totals as bonus or penalty points. Damage output, healing output and personal defensive cast counts do not affect the letter. Tank, healer and damage roles are identified in the evidence and receive separate role summaries when applicable.

The raid support query requests consumed-shield events with the documented `type = "absorbed"` filter, avoiding ordinary heals that this review does not use. Exact actor attribution, teammate eligibility, pagination, request budgets and deadlines remain enforced. Other Cast Mirror healing/statistics queries still collect their required healing evidence. This removes unnecessary raid-query traffic; the precise cause of earlier slow or incomplete responses remains unproven. See the [WCL expression guide](https://www.warcraftlogs.com/help/pins) and [events filter schema](https://de.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html).

Each boss includes its grade, reasons, sample size and source-log links. Expand source kills to inspect reviewed mechanics, hit/tick counts, contact clusters and death causes. Assigned soaks, tank duties and ambiguous mechanics are governed by the reviewed encounter rules; see [raid avoidance coverage](castmirror-raid-avoidance.md).

Reviewing is explicit. Opening a character does not start the raid acquisition. **Stop review** cancels the current browser request and keeps collected results. **Continue raid review** resumes the remaining bosses only when chosen. A busy account or exhausted log allowance stops the queue without automatic retries. Changing the character, realm, region, raid or difficulty clears the review and suppresses late responses, preventing stale grades from appearing for another character.

Each live Warcraft Logs request has up to 60 seconds to finish, including authentication, retries and response delivery. That allowance is shortened when less time remains in the two-minute boss review. A timeout still stops the queue and preserves the attempted boss and any collected evidence; increasing the request timeout does not restart failed attempts or extend the review deadline.

The browser receives the same pure grading functions used by the service through the hosted generator. The vendored upstream snapshot stays immutable. UI regression tests exercise the checked-in generated page, including sequential requests, cancellation, identity matching, unsupported scopes and source-link validation.

## Role and repeated-evidence ranking views

The review headline now uses the additive `assessRaidRanking` model. Existing
`gradeBoss` and `gradeRaid` scores remain available in a legacy-score disclosure;
their penalties and encounter rules are unchanged. The new view first selects
one role and explicit source patches, then weights each boss by its gradeable
kill count, capped at three. A supported placement requires at least four bosses
with three gradeable kills each. This is a sample heuristic, not a statistical
confidence interval or official percentile. Short samples retain their coaching
score without an authoritative ordinal.

Primary role means the role with the most gradeable kills in the selected patch
view. Equal counts use a fixed display order (DPS, tank, healer), disclose the
ambiguity and require an explicit role for supported placement. Current-patch
selection never substitutes historical kills. Boss cards, source links, dates,
coaching and observed utility use the same selected role and patch as the
headline. Utility is descriptive and never adds points; incomplete zero totals
are labeled unverified rather than asserting no contribution.

`/castmirror/guild-execution` displays the saved public 26-raider Nothing But
Trouble review from 2026-10-15. The exact `/castmirror` rewrite does not capture
this nested App Router page. The server imports the sanitized public snapshot
from `data/castmirror/guild-execution.json`; the page makes no WCL or execution
requests. The guild board orders all 26 raiders together by their selected
mechanics score, including limited samples with an explicit **Provisional**
badge. Equal scores share a competition placement; missing graded evidence
stays visible without a placement. Role, patch and sample details remain shown,
and the broader-sample threshold and underlying score calculation are unchanged.
This overall ordering does not normalize different raid assignments or utility
opportunities. A two-raider view uses
only exact shared report/fight/boss/role/patch sources through the same pure
model, retains each source actor and reports insufficient shared evidence
without fallback. Raid assignments and unreviewed mechanics remain unknown.
