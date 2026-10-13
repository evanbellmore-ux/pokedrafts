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
8,886 tests across 274 files, with one existing skip; lint, global typecheck, and
explicit owned-API lint passed. The client contract scan passed all 392 files.
The local embedded-Postgres suite passed 273 tests across 24 files, including
restricted privileges, concurrency, revision CAS,
expired ownership, retained debt, immutable history, fixed TTLs, and committed
writes with lost acknowledgement. Synthetic integration tests run the actual
vendored native modules and transport, but do not establish production readiness.

The initial Windows production build passed after two reviewed bundler-only
filesystem annotations: 184 native-route files, approximately 2.2 MB instead of
46 MB, and all 34 trace inventories passed the private-file audit. The automatic
Vercel Linux Preview for `1a2bcd8` compiled but failed the same postbuild guard:
its non-Windows directory-fsync open traced the whole project, and the guard
rejected `AGENTS.md`. Adapter `castmirror-native-postgres-3` adds a third exact
annotation for that unused hosted branch without changing directory durability,
runtime behavior, scoring, or trace validation. A successful Linux Preview is
required before this deployment issue is considered resolved. Other application
routes retain their existing runtime assets.

Real installed Chrome reached the local production build. Initial metadata HTTP
502 responses were traced to missing WCL variables in that test process. The
existing public-only credential loader supplied them privately in memory without
copying or printing secrets; zones and realms then returned HTTP 200.

The selected Arcane Mythic comparison still returned HTTP 502. A separate bounded
real healer check also returned HTTP 502. Sanitized direct-handler diagnostics
classified both as **world reference unavailable in the unchanged throughput
core**, before native binding or protected projection. No successful
Overall/Boss/Healing browser comparison or real native hosted comparison is
claimed for this migration. Projection parity tests do not replace those checks.
No scoring or validation guard was weakened to force a pass.

Protected historical and consumed-pilot evidence was preserved. Native public
acquisition stayed off. No production SQL migration, account bootstrap/enablement,
live-account cutover, or native restart/redeployment verification occurred.

## Remaining release gates

1. Read-only authenticated Vercel inspection confirmed Node 24.x, Fluid enabled,
   an active Hobby plan and owner-level project access. Encrypted WCL credentials
   are configured for Preview and Production; Execution credentials/flags are not.
   [Documented Hobby/Fluid duration limits](https://vercel.com/docs/functions/configuring-functions/duration)
   allow 300 seconds, sufficient for the 180-second route declaration. Verify the
   actual deployed per-route configuration and available hosting capacity after
   the successful Linux Preview; declarations/local builds alone are not proof.
2. Obtain authorized PostgreSQL migration/role-management access, verify production
   capacity, and provision a dedicated restricted executor LOGIN with verified TLS.
   An unrestricted Supabase service-role REST key is not a substitute.
3. Stop every old native writer for the same WCL identity; conservatively import
   the exact final live ledger/history and verify all charged, pending, uncertain,
   legacy and unbound debt before the administrator enables the account.
4. Complete genuine Overall/Boss/Healing browser verification with viable real
   references, then bounded private hosted Mythic DPS/healer/tank native tests,
   including Any/Exclude, missing data, cached requests, contention, and
   restart/redeployment safety. Verify the actual deployment SHA.
5. Enable public native acquisition only after those checks succeed.

Provisioning, cutover and rollback procedures are in `castmirror-hosted.md`.
