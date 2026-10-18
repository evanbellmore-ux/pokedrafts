# Raid execution review

Find a character's kills in Cast Mirror, then choose **Review raid execution**. The review does not require a selected damage log or a world-ranking reference. It uses the selected character, realm, region, raid and difficulty. The first release supports the reviewed current Mythic raid.

The review checks each boss in order and collects up to six of the character's latest eligible public kills per boss across the explicitly reviewed patches, currently 12.1 and 12.1.5. Selection uses date, not damage or healing rank. Each kill retains its verified patch and partition; older kills are never relabeled as current evidence. The overall review and each boss show reviewed patch coverage, actual sampled patches and sample dates. Each source kill also shows its patch. A character with no suitable public evidence for a boss remains ungraded on that boss. Coverage is always shown alongside the overall letter.

The grade is a provisional automated coaching rubric, not an official percentile. The headline and boss cards use Execution reliability v2, described below. The retained legacy calculation starts complete kills at 100, subtracts 5 per independently avoidable contact and 35 per directly attributed avoidable death, and weights bosses equally. It remains available explicitly as legacy evidence for audit. Adjacent damaging ticks of one ability within five seconds form one contact cluster. Incomplete or shortened exposure cannot earn favorable credit. Context-dependent damage and deaths with unproven responsibility do not receive blame.

Successful interrupts, dispels and logged damage absorbed on teammates appear as observed raid support. Unknown assignments and opportunities prevent using those raw totals as bonus or penalty points. Damage output, healing output and personal defensive cast counts do not affect the letter. Tank, healer and damage roles are identified in the evidence and receive separate role summaries when applicable.

The raid support query requests consumed-shield events with the documented `type = "absorbed"` filter, avoiding ordinary heals that this review does not use. Exact actor attribution, teammate eligibility, pagination, request budgets and deadlines remain enforced. Other Cast Mirror healing/statistics queries still collect their required healing evidence. This removes unnecessary raid-query traffic; the precise cause of earlier slow or incomplete responses remains unproven. See the [WCL expression guide](https://www.warcraftlogs.com/help/pins) and [events filter schema](https://de.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html).

Each boss includes its grade, reasons, sample size and source-log links. Expand source kills to inspect reviewed mechanics, hit/tick counts, contact clusters and death causes. Assigned soaks, tank duties and ambiguous mechanics are governed by the reviewed encounter rules; see [raid avoidance coverage](castmirror-raid-avoidance.md).

Reviewing is explicit. Opening a character does not start the raid acquisition. **Stop review** cancels the current browser request and keeps collected results. **Continue raid review** resumes the remaining bosses only when chosen. A busy account or exhausted log allowance stops the queue without automatic retries. Changing the character, realm, region, raid or difficulty clears the review and suppresses late responses, preventing stale grades from appearing for another character.

Each live Warcraft Logs request has up to 60 seconds to finish, including authentication, retries and response delivery. That allowance is shortened when less time remains in the two-minute boss review. A timeout still stops the queue and preserves the attempted boss and any collected evidence; increasing the request timeout does not restart failed attempts or extend the review deadline.

The browser receives the same pure grading functions used by the service through the hosted generator. The vendored upstream snapshot stays immutable. UI regression tests exercise the checked-in generated page, including sequential requests, cancellation, identity matching, unsupported scopes and source-link validation.

## Role and repeated-evidence ranking views

The review headline and boss cards use the versioned `assessRaidRanking` model. Existing
`gradeBoss` and `gradeRaid` scores remain available in a legacy-score disclosure;
their penalties and encounter rules are unchanged. The view first selects
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
and the broader-sample threshold stays explicit.
This overall ordering does not normalize different raid assignments or utility
opportunities. A two-raider view uses
only exact shared report/fight/boss/role/patch sources through the same pure
model, retains each source actor and reports insufficient shared evidence
without fallback. Raid assignments and unreviewed mechanics remain unknown.

## Saved raider report cards

The guild page keeps one overall ranking and adds a selectable report card for
each of the same 26 verified raiders. Role and patch filters apply to the card,
its coaching priorities and its evidence. The card uses the existing saved
reviews; opening it does not acquire new logs. Its score breakdown uses the same
versioned model as the ranking, shared-kill comparison and deletion sensitivity.

Mechanic reliability shows affected sampled kills, contact incidents and
survived-clean observations. Each boss, patch and mechanic has its own observed
denominator: incomplete streams and kills without that reviewed ability cannot
earn clean credit. These denominators are sampled kills, not known mechanic
opportunities. Historical rules can cover a narrower mechanic list.

Death cards retain cause, time after pull, raid death event order, source kill
and whether responsibility is established. Fight time remaining at a death is
shown as context; it is not time spent dead or a measure of contribution lost.
Resurrection timing and assignments are not present in the saved data. Utility
remains observed support, with incomplete zeros unverified and no inferred
cooldown effectiveness or missed assignments.

Peer diagnostics require exact shared boss, fight, role and patch sources with
complete mechanics and survival and matching reviewed mechanic coverage for
both raiders. Peers are ordered by overlap size rather than performance. A
ranking sensitivity check removes each selected kill or boss once and recomputes
the existing score with the subject's role and other raiders' scores fixed.
Ungraded variants stay ungraded. The displayed ranges are sample sensitivity,
not statistical confidence intervals or predictions. Kill-only saved evidence
cannot establish progression performance.

## Execution reliability v2

The saved report-card evidence now changes the actual grades through a fixed
30/30/40 coaching policy, `execution-reliability-rubric-2`. These weights are
product judgment, not fitted to the 26 raiders or statistically validated:

- **Consistency (30 points):** each gradeable kill receives 100% if it contains
  neither reviewed avoidable contact nor a directly attributed avoidable death;
  otherwise 0%. This distinguishes mistakes spread across kills from an equal
  volume concentrated in one kill.
- **Contact control (30 points):** each kill receives `max(0, 100 - 10 * incidents)`.
  Positive health damage or absorbed contact counts; fully immune zero events
  and contextual mechanics do not. Contact control bottoms out at ten incidents.
- **Avoidable survival (40 points):** each kill receives 100% without a proven
  avoidable death, otherwise 0%. Multiple deaths in one kill do not create extra
  survival penalties because resurrection opportunities are unknown.

A first contact costs 33 points in that kill, each further contact 3 until control
is exhausted; a proven fatal mistake also loses 40 survival points. One contact
every kill scores 67, rather than the legacy 95. Average the unrounded components
within each boss, then weight bosses by gradeable kills capped at three. Only the
final score is rounded; component displays can differ by a tenth through rounding.
The existing letter thresholds remain unchanged. Grades under the two policies
are not directly interchangeable.

Death-shortened mechanics components cannot exceed the mean of survived kills
with the same boss, role, source partition/patch and exact reviewed noncontext
ability set. A context-only death without such a baseline remains ungraded; a
proven avoidable fatal kill still loses consistency/survival credit. This guard
can reduce supported sample counts relative to legacy grading. Unknown deaths
never receive an automatic survival penalty. Invalid/duplicate mechanic IDs or
incomplete damage/survival evidence cannot earn points. Historical narrower
review coverage stays visible and is not normalized into equal opportunities.

No second recurrence surcharge or peer percentile is added: affected-kill
consistency already measures repeated mistakes. Death timing/order, raw damage
amounts, DPS/HPS, personal cast counts, interrupts, dispels, teammate absorbs and
descriptive trends do not affect points. They remain inspectable context because
opportunities, assignments, cooldown timing and resurrection evidence are absent.
The immutable saved snapshot and legacy `gradeBoss`/`gradeRaid` outputs are
preserved; the API's `grade` field remains that legacy evidence contract while
the live browser derives its explicitly versioned current assessment from `review`.
