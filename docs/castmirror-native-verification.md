# Native Execution verification

Status on 2026-10-13: **private hosted DPS acquisition and persisted-cache checks
passed; public Execution remains disabled**. The focused pin fix is deployed at
`5c33ee020192128c50ecca7edc4b605422101b6a`. Real Chrome passed public
Overall/Boss/Healing on that deployment. Native healer/tank, hosted restart and
native browser verification remain incomplete; the single authorized new
acquisition has been consumed. Do not describe public Execution as live.

## Implemented

- Separate Vercel Node Execution route, preserving the existing 55-second
  Overall/Boss/Healing application deadline.
- Private transactional Postgres ledger, ownership/fencing, immutable linked
  accounting history, compact peer pools, and fixed-expiry server comparison pins.
- Actual native dispatch reservations persisted before provider sends, conservative
  uncertainty/debt retention, and fail-closed ambiguous writes without replay.
- Existing collector, scoring, role weights, attribution, PI policies and peer
  comparison algorithms reused from native source
  `9d1c23fc00aba51c0357e4e312a9306bb1fda130` (standalone PR #6).
- Source-pinned deterministic generation, strict frontend availability gates, and
  automatic post-build private-file/whole-project trace checks.
- Targeted Next.js/ESLint configuration update to 16.4.0 removes the reported
  critical Next.js advisory entry. Dependency audit is not clean: ten high and
  two moderate advisories remain.

## Verification boundaries

The standalone native suite passed 1,154 tests. Final application checks passed
9,011 tests across 277 files, with one existing skip; lint, global typecheck, and
explicit owned-API lint passed. The client contract scan passed all 392 files.
The local embedded-Postgres suite passed 277 tests across 24 files, including
restricted privileges, concurrency, revision CAS,
expired ownership, retained debt, immutable history, fixed TTLs, and committed
writes with lost acknowledgement. The v4 current-first/immediate-previous-patch adapter is included in these checks;
its 569 focused regression tests cover independent selections, pagination/PI,
explicit pins, labels, cache bypass and native cohort isolation. Synthetic
integration tests run the actual vendored native modules and transport, but do not
establish production readiness.

The initial Windows production build passed after two reviewed bundler-only
filesystem annotations: 184 native-route files, approximately 2.2 MB instead of
46 MB, and all 34 trace inventories passed the private-file audit. The automatic
Vercel Linux Preview for `1a2bcd8` compiled but failed the same postbuild guard:
its non-Windows directory-fsync open traced the whole project, and the guard
rejected `AGENTS.md`. Adapter `castmirror-native-postgres-3` adds a third exact
annotation for that unused hosted branch without changing directory durability,
runtime behavior, scoring, or trace validation. The exact fix commit
`f927c80d6744a1f30f4bdf7c69c49620e7445fc7` subsequently produced a successful
Linux Preview (`dpl_8XE7LdCLccqux6ZaC834YQA63TUM`, GitHub deployment
`7045760978`). Authenticated build inspection confirmed the strict postbuild
guard passed all 32 remote trace inventories, including 184 native-route files,
with no whole-project warning. Actual Preview HTTP checks returned 200 for
`/castmirror` with the expected source/adapter and 503 `unsupported` with private
no-store headers for the disabled native route. This resolves the Linux build
failure, not production provisioning or native readiness. Other application
routes retain their existing runtime assets.

Real installed Chrome reached the local production build. Initial metadata HTTP
502 responses were traced to missing WCL variables in that test process. The
existing public-only credential loader supplied them privately in memory without
copying or printing secrets; zones and realms then returned HTTP 200.

The initial Arcane Mythic and bounded healer checks returned HTTP 502, classified
as **world reference unavailable** before native binding or projection. The v4
adapter resolves this new-patch gap without changing scoring or weakening
validation: current rankings are searched first, followed by the verified immediate
predecessor only after an empty eligible, exhausted search.

Real installed Chrome against the final local production build then passed Arcane
Mythic Overall/Boss (encounter 3445) and Discipline Mythic Healing (encounter 3470).
All three references actually selected patch `12.1` after current `12.1.5` searches
and displayed the corresponding previous-patch label. Explicit player fights
remained pinned; reference switching/restoration, signed healing, both URL aliases,
desktop/phone widths and no-horizontal-overflow checks passed. Metadata and both
comparison responses were HTTP 200, with zero page errors and zero native-page
requests. The native-off endpoint remained 503/private-no-store.

The exact PR #30 Production deployment,
`58f19b5279c8612c9c6ebf0194930bfebcfc3106`
(`dpl_AZk8Q8aK3CiY1iECYogpXYRLACRF`), was subsequently verified READY. Real Chrome
against the public site also passed those Arcane Overall/Boss and Discipline
Healing comparisons, actual previous-patch labels, pinned player fights,
reference switching/restoration, signed healing, desktop/phone layout, both URL
aliases, and zero page errors/native page requests. Actual Production lambda
metadata confirms `nodejs24.x`, native 180 seconds and the unchanged comparison
60 seconds. The strict remote audit passed 32 inventories with 184 native-route
files. These are genuine public throughput checks, **not** native acquisition
or public Execution readiness.

Read-only final byte verification matched all 82 historical files against the
existing post-pilot baseline and all 27 consumed-pilot files against their existing
final manifest. No baseline was regenerated or job resumed/reset.

## Production prerequisites completed on 2026-10-13

- Standard linked Supabase SQL access works using ordinary pooler linkage. The
  earlier `--skip-pooler` connectivity failure did not establish missing SQL
  authority. Actual authorized schema/role DDL was verified and the reviewed
  private migration committed in one guarded transaction. Read-only inspection
  found no existing `supabase_migrations.schema_migrations` table; this was not a
  bulk `db push` or migration-history rewrite. Do not replay this applied SQL or
  the unrelated migration chain as a retry.
- PostgreSQL 17.6 now has the isolated NOLOGIN owner/executor, four RLS-protected
  private tables, and dedicated `castmirror_execution_runtime` LOGIN. Its
  elevated attributes are false, connection limit is eight, and executor
  membership has no admin or SET option. The application pool remains at most
  two connections per invocation.
- The runtime can execute exactly nine approved private functions, but cannot
  read/write private tables, create database objects, seed or enable accounts.
  Browser/service roles have zero private-function grants. The existing 31
  public functions executable by anon/authenticated are unchanged.
- Runtime preflight permits SELECT on the two genuine `pg_stat_statements`
  extension views only after verifying their catalog extension membership. It
  still rejects writes, same-name impostors and public application data. Four
  new embedded-Postgres regressions pass; the Execution DB file has 26 tests.
- The initial certificate-chain refusal occurred **after** the migration's
  successful commit. The provider-published production CA resolved it without
  disabling certificate or hostname verification. The real restricted runtime
  connection and role preflight passed with `rejectUnauthorized: true`.
- Hosted and standalone WCL quota identities match. The old local 8130 writer
  was stopped and a sanitized Windows inventory found zero remaining native
  process candidates/listeners. Its final exact 16,090-byte LIVE ledger was
  imported and verified **disabled**, preserving 15 jobs, six windows, all 22
  pending points and three nonterminal jobs, charged/legacy/uncertain debt, and
  the original bytes/hash. There are no linked LIVE history segments. This did
  not migrate protected historical/pilot files or dispatch provider requests.
- Server-only `EXECUTION_DATABASE_URL`, `EXECUTION_DATABASE_CA` and
  `EXECUTION_VERIFY_TOKEN` are durably configured as sensitive Vercel variables
  for Preview and Production. Both `EXECUTION_RUNTIME_VERIFIED` and
  `EXECUTION_NATIVE_ENABLED` are explicitly zero in both environments. The
  original batch's unverified acknowledgement was reconciled read-only: no
  native variables existed. Supported CLI additions then acknowledged each
  value from private stdin; flags were independently verified through normal
  private environment loading. No credentials, tokens or private report data
  are included here or in Git.

## Current activation boundary

The resume recovered the completed private cutover: the existing imported account
is enabled, Production runtime verification is enabled, and public native access
is still disabled. The zero flags in the initial provisioning record above are
historical, not the current Production state. Provisioning, import, account
enablement and private runtime configuration were not repeated. Do not reopen
those steps or invent a new capacity blocker from the earlier provisioning
checkpoint.

The successful private acquisition and cache checks are recorded below. Remaining
real hosted checks are healer/tank native data, explicit restart/redeployment
native durability, and native browser interaction. Concurrent cached requests
passed; this is not an acquisition-contention, stale-fence or hosted-restart test.
Those protections passed isolated embedded-Postgres tests, which remain distinct
from production evidence.

The one authorized new acquisition reached the unchanged 60-GraphQL-query cap.
Its Arcane pool cannot establish healer/tank coverage. The pool expired before
native browser interaction could be verified, and an ordinary native GET on an
expired/uncovered pool can acquire again. No second acquisition is authorized by
this resume. Preserve all one-shot/uncertainty markers, existing jobs and debt;
do not refresh, replay or expand the acquisition allowance to complete these
checks. Public native access must remain disabled until the remaining real
verification succeeds under an authorized acquisition budget.

Provisioning, cutover and rollback procedures are in `castmirror-hosted.md`;
they are not instructions to replay completed operations.

## Hosted pin diagnosis (2026-10-13)

The activation resume recovered the existing private cutover rather than
reprovisioning it. A fresh shared-account audit preserved all 15 original jobs,
22 pending points and three nonterminal jobs exactly, with no new native job,
pool or pin. Public native acquisition remained disabled.

A comparison-only hosted probe verified the private nonexistent-pin route
returned 409, then obtained a complete HTTP 200 comparison in 4.5 seconds with
no historical A, Overall B or Boss B labels. Its native status was unavailable
and it carried no comparison ID. Offline validation of the privately retained
response identified exactly one failed pin assertion: requested-realm matching.
The requested realm contained word separators, whereas the validated WCL actor
realm omitted them. The two realms matched under the source-pinned throughput
actor-identity rule, but not under the pin validator's API-slug equality.

The focused fix uses that existing realm-identity rule for pin validation and
Overall B current-ranking proof, without changing the original retained actor
or request values. API query slug normalization remains unchanged. Regressions
cover compact actor realms, independent current A/B proof, retained-row reads
and rejection of genuinely different realms. The captured real comparison now
passes the pin projection offline. No historical, authentication, ownership,
TTL, deadline or acquisition-budget protection was relaxed.

The original failed smoke did not retain its raw response, so its individual
failed predicate cannot be reconstructed with certainty. The resumed probe
provides the exact demonstrated blocker above; offline projection and mocked
regressions alone are not proof of a hosted pin write or native scoring.

Local gates passed: source parity; repository lint/typecheck; 9,062 unit tests
across 281 files (one existing skip); all 597 CastMirror tests across 15 files;
and 277 isolated embedded-Postgres tests across 24 files. Explicit lint with
`--no-ignore` also passed for the changed hosted adapter files. The original
private-smoke offline safeguard check still passed all 157 assertions. The new
reconciled continuation passed 19 offline checks, including durable dispatch
markers and refusal to replay an ambiguous request after restart.

## Actual hosted native results (2026-10-13)

PR #32 merged fix `3aca4a78`. Vercel verified Production
`5c33ee020192128c50ecca7edc4b605422101b6a` READY with both public aliases. The
strict Linux postbuild audit passed 32 trace inventories / 184 native-route
files. The native route remains Node 24.x / 180 seconds; comparison remains
Node 24.x / 60 seconds with its unchanged 55-second application deadline.

Before the new smoke, a fresh database audit reconciled the earlier zero-native-
dispatch attempt and exact original ledger. A separately latched continuation
then performed exactly one new acquisition, without resetting the original
smoke latch or any pending/uncertain accounting:

- Current-first comparison: HTTP 200 in 5.383 seconds. The server minted a UUID;
  restricted Supabase read-back matched its compact projection. Both A and
  Overall B independently proved current scope: zone 53, encounter 3445,
  Mythic difficulty 5, size 20, partition 2, patch `12.1.5`.
- Native Any: HTTP 200, real Mage/Arcane DPS observations and comparable partial
  scores, three scored components per side. Thirteen observations / thirteen
  players across six kills had low confidence. Per side, three components were
  known, one incomplete, one missing and one unsupported. No absent component
  received a fabricated value or score; no global winner was asserted.
- Acquisition was honestly **limited**, not full coverage: 60 GraphQL queries,
  61 network attempts, one ranking page / 100 rows, six report heads / kills,
  and 315,858 events. All original acquisition limits remained unchanged.
- Accounting/pool persistence was available. The database held one new job,
  one pool and one pin; all 15 original jobs remained deep-equal to the imported
  originals, including three nonterminal jobs and all 22 pending points.
  Charged job totals increased from 657.12 to 746.41 points, a native increase
  of 89.29. No pending points were reset or refunded.

A new service with warm caching disabled read and validated the shared pool
through the restricted runtime login. Both pinned sides satisfied the actual
cache-coverage predicate before two concurrent hosted native follow-ups:

| Policy | HTTP/cache | Result |
| --- | --- | --- |
| Any | 200 / cached | Comparable partial scores for both sides; mask `010110`; all 13 observations retained. |
| Exclude | 200 / cached | Measurements-only, no score and mask `000000` on either side; noncomparable; all 13 observations excluded. |

PI coverage was one confirmed present, zero confirmed absent and twelve unknown.
Exclude did not treat unknown as absent or fall back to Any. Cached responses
retain original acquisition counters; these are not new provider calls. Actual
audits after the concurrent follow-ups and after Chrome checks confirmed no
additional job, charge or pending debt: revision 1453, fence 1, charged total
746.41, original pending 22, and no active lease. The previous owner UUID is
intentionally retained with the lease released; it was not cleared or reset.

## Production browser results and unfinished checks

Real installed Chrome at `https://www.pokedrafts.io/castmirror` passed Arcane
Mythic Overall/Boss and Discipline Mythic Healing, preserving the explicitly
selected player fights. Both comparisons and metadata returned 200 with no
historical labels on this run. Reference switching/restoration, desktop/phone
widths, no horizontal overflow, both URL aliases and zero page errors passed.
Public native controls remained disabled, direct off-mode handlers made zero
native-page requests, and the unauthenticated native route returned
503 / unsupported / private-no-store. An earlier pinned Arcane browser attempt
had returned 504; that failed attempt is not counted as a pass or erased by the
successful post-deployment rerun.

A separate private-authenticated Chrome attempt required fresh exact shared-cache
proof before permitting either native policy. It stopped with zero native HTTP
requests and zero page errors; the original pool was expired by the end of that
check. No private native UI rendering or public native browser result is claimed.
No second acquisition or expired-cache retry was dispatched. Real healer/tank
native coverage and explicit hosted restart/redeployment verification also remain
unverified. The successful DPS/API/cache evidence does not replace those gates,
and public Execution remains **off**.
