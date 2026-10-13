# Native Execution verification

Status on 2026-10-13: implementation is gated and **not publicly activated**.
The production site must not be described as running native Execution until the
provisioning, cutover, and real hosted verification below are complete.

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
9,010 tests across 277 files, with one existing skip; lint, global typecheck, and
explicit owned-API lint passed. The client contract scan passed all 392 files.
The local embedded-Postgres suite passed 273 tests across 24 files, including
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
requests. The native-off endpoint remained 503/private-no-store. These are genuine
provider-backed local browser results, not public deployment or real native hosted
verification.

Read-only final byte verification matched all 82 historical files against the
existing post-pilot baseline and all 27 consumed-pilot files against their existing
final manifest. No baseline was regenerated or job resumed/reset. Native public
acquisition stayed off. No production SQL migration, account bootstrap/enablement,
live-account cutover, or native restart/redeployment verification occurred.

## Remaining release gates

1. Read-only authenticated Vercel inspection confirmed Node 24.x, Fluid enabled,
   an active Hobby plan and owner-level project access. Encrypted WCL credentials
   are configured for Preview and Production; Execution credentials/flags are not.
   [Documented Hobby/Fluid duration limits](https://vercel.com/docs/functions/configuring-functions/duration)
   allow 300 seconds. Authenticated deployed lambda metadata for the successful
   `f927c80d` Preview confirms `nodejs24.x`, 180 seconds for native v3, and the
   unchanged 60 seconds for comparison. Remaining usage headroom still needs
   verification before native enablement; a successful disabled deployment alone
   is not proof of acquisition capacity.
2. Authenticated Supabase management inspection matches the existing application
   project in `us-east-1`. Isolated scratch linkage succeeds without modifying the
   repository or production SQL, but the installed CLI's advertised linked SQL
   query failed on a read-only catalog SELECT. No direct SQL/password or Execution
   database configuration was available among the checked keys. Management login
   alone does not verify SQL migration/role authority or capacity. Obtain verified
   SQL authority, check capacity, and provision a dedicated restricted executor
   LOGIN with verified TLS. An unrestricted service-role REST key is not a
   substitute.
3. Stop every old native writer for the same WCL identity; conservatively import
   the exact final live ledger/history and verify all charged, pending, uncertain,
   legacy and unbound debt before the administrator enables the account.
4. Verify the exact v4 deployment and repeat genuine Overall/Boss/Healing browser
   checks through the hosted site. Local real-browser throughput checks above are
   complete, but bounded private hosted Mythic DPS/healer/tank native tests still
   need Any/Exclude, missing data, cached requests, contention and
   restart/redeployment safety.
5. Enable public native acquisition only after those checks succeed.

Provisioning, cutover and rollback procedures are in `castmirror-hosted.md`.
