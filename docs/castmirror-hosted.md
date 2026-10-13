# Hosted CastMirror

## Which application is live?

`https://www.pokedrafts.io/castmirror` is part of **this Next.js/Vercel app**.
`next.config.ts` rewrites `/castmirror` and `/CastMirror` to the static
`public/castmirror.html`; that page uses `/api/castmirror`. It does not proxy or
import the running standalone CastMirror HTTP server. Merging or restarting
[standalone CastMirror](https://github.com/evanbellmore-ux/cast-mirror) does not
update this copy. A normal Pokedrafts deployment is required.

## References provided by this release

- **Overall damage #1** and **Boss damage #1** independently select the highest
  mirrorable ranked parse under the existing spec/hero-tree and Power Infusion
  rules. The player fight stays fixed. Casts, full-fight output, cooldowns,
  resources, and reference identity switch together without another request.
- Boss DPS is a **ranking selection metric**, not a boss-target filter on the
  existing full-fight analysis. Identical winners reuse streams but keep their
  different ranked amounts. A Boss-only failure leaves Overall usable and is
  retryable with another comparison.
- HPS comparisons offer **Healing #1**, not Boss damage.
- **Execution v3 has a gated Vercel-native path.** The dedicated Node route reuses
  CastMirror's collector, statistical engine, attribution, role weights, and PI
  rules. Private Postgres transactions retain the shared quota ledger, ownership,
  compact peer pools, and server-minted comparison pins. No separate HTTP server,
  tunnel, Redis, queue, or Supabase service-role credential is required or used.
  Public collection remains disabled until production provisioning, safe writer
  cutover, runtime/capacity checks, and real private hosted verification succeed.
  The six-category renderer hides incompatible partial ratings, labels incomplete
  observations, keeps missing values unavailable, and shows sample/confidence once.
  Synthetic tests or a deployed disabled route do not establish native readiness.

The page includes `castmirror-source` and `castmirror-adapter` meta tags plus a
hidden developer source line for checking the deployed copy. Source identifiers
are not primary comparison content. Frozen release capabilities and explicit
response capabilities guard both v3 and legacy selection, PI controls, acquisition,
rendering, polling, hydration, hero reload, and refresh. Missing, false, or merely
truthy capabilities fail closed, including inconsistent ready-looking payloads.

## Serverless boundaries

The comparison core contains only request-scoped throughput behavior. It does
not import standalone `apiCompare`, `createServer`, filesystem registries,
retained comparison-ID Maps, refresh CLI code, or post-response crawls.

Hosted adaptations make PI and hero probes use the same realm-aware actor
identity as fight streams; probe caches also include the normalized realm. The
reviewed source's portable `sameRealm` helper is explicitly allowlisted so native
realm spellings and navigation realm names resolve consistently. The adapter
preserves its full-set actor ambiguity check rather than narrowing away namesakes
outside a supplied fight roster.
Ambiguous actors or spec-summary names fail closed instead of borrowing a
namesake's evidence. Raw resource snapshots may omit `max`, as the canonical
aggregator already supports; a supplied maximum must still be a valid number.
Raw validation follows the core's consumption rules: finite signed healing-spell
totals (including health-redistribution adjustments) are retained for HPS only;
DamageDone totals and ranked DPS/HPS amounts still must be nonnegative. Missing,
nonnumeric, nonfinite, and unnamed consumed totals remain invalid.
Signed numeric resource keys are retained, null/untyped snapshots are skipped,
and unnamed/unmirrorable or irrelevant metadata does not invalidate otherwise
complete comparisons. A missing
zone stays null (unverified), never an invented scope. Selected actor/fight identity,
public visibility, pagination, usable rankings, and consumed numeric values remain
strict; malformed usable evidence is not silently discarded. Query-level fixtures
project only the selected GraphQL fields so unsolicited metadata cannot hide a
production query mismatch.

[WCL `ReportAbility.gameID`](https://ru.warcraftlogs.com/v2-api-docs/warcraft/reportability.doc.html)
is a **Float**, not an actor/fight GraphQL Int ID. Ability metadata and consumed
cast `abilityGameID` values therefore use finite-number validation, preserving
the core's exact numeric Map lookup and `String(gameID)` fallback for missing
names or unmapped keys. There is no coercion, positive-only gate, or Int32 ceiling
for these two lookup keys. Missing/null/nonnumeric/nonfinite keys, malformed
metadata rows or names, and malformed consumed timing/resource evidence still
fail closed. Actor/fight IDs retain their positive Int32 limits. The zero, signed,
fractional, and large finite keys in regressions are **synthetic boundaries**, not
observed production values; an ability assertion-group diagnostic does not reveal
which production row or field failed.

- `compare` keeps `maxDuration = 60`, with a 55-second invocation deadline.
  Cancellation covers OAuth, WCL fetches, and retry sleeps. Outstanding queries
  are aborted and settled before returning; required failures are controlled
  JSON errors, and a Boss-only failure preserves completed Overall data.
- Complete comparison responses may be cached for ten minutes, bounded to
  32 entries / 8 MiB per warm instance. Failed or partial Boss responses are not
  cached. Metadata caches are bounded as well; hero/class memoization is keyed
  to the invocation's client. Warm caches are optimizations, **not shared durable
  storage or distributed rate limits**.
- Existing fresh-request admission remains in place (12 compares and 30 character
  lookups per IP/hour/warm instance). Cache hits do not spend another admission.
- Character-dependent comparison and availability responses use private no-store
  headers, not shared HTTP caching. WCL credentials remain server-side, using
  existing `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` configuration. Valid positive,
  finite OAuth lifetimes are accepted even when longer than seven days; only the
  warm token cache is capped at seven days, with a one-minute expiry safety margin.
- Request inputs are validated before queries, including paired public report
  pins, bounded strings, GraphQL integer IDs, regions, difficulty, and metric.
  An auto-zone sentinel remains unverified requested context, not benchmark scope.

Required comparison failures may include an optional `diagnostic` alongside the
existing controlled HTTP 502 `error`. Data-validation labels come from a closed
allowlist of assertion groups (for example, `upstream.casts.pagination` or
`normalized.overall.fight`); transport failures use the fixed
`transport.log-service` label. Untagged or invalid data-error labels become
`data.unclassified`, and other errors carry no diagnostic. The escaping exception
owns the label: an earlier swallowed Boss failure cannot overwrite it. A label
identifies an assertion group, **not an offending value or a confirmed provider
schema mismatch**. No query text/variables, identities, report contents, stacks,
causes, or arbitrary error properties are returned or logged by this diagnostic.
Cancellation/deadline errors omit it, and Boss-only failures remain partial
successes. The diagnostic mechanism does not alter validation, request settlement,
cache rules, or Execution availability.

## Hosted Execution API

The three **legacy** availability/build endpoints below remain stateless. They
make **zero WCL requests, filesystem writes, or job dispatches**. They do not
activate or proxy the new native route.

| Endpoint | Method | Result |
| --- | --- | --- |
| `/api/castmirror/execution/status?zone=53&encounter=3470&difficulty=4` | GET | 200, `state: unsupported` |
| `/api/castmirror/execution/refresh` | POST | 403, builds disabled |
| `/api/castmirror/execution/reference` | GET | 409, benchmarks unavailable |

Status validates context; missing/invalid required encounter returns 400.
Unsupported methods return Next.js 405 responses. Refresh is unconditionally
forbidden: forwarded loopback headers are not authorization. The legacy status
contract keeps `capabilities.build` and `capabilities.reference` false, with
`revision`, `scope`, `coverage`, `job`, and `updatedAt` all null. `requestedContext`
is separate from verified native scope.

### Native reference route and trusted pins

`GET /api/castmirror/execution/v3?comparisonID=<uuid>&pi=Any|Exclude` accepts only
one retained UUID and an optional PI policy (default `Any`). Extra or duplicate
parameters return 400; missing/expired pins return 409; disabled/unconfigured
native access returns 503 without opening Postgres or dispatching native WCL work.
All responses are private/no-store. A successful response is bounded to 1 MiB and
contains `{ comparisonID, executionReference }`, not raw throughput timelines.
The browser retains its original pinned A/B streams when rendering these compact
statistics. `Exclude` never falls back to `Any`.

When configured, the existing comparison handler can mint a trusted compact pin
from its validated server result. It observes the existing ranking queries to
verify A/B current-partition provenance independently, and optionally resolves
native scope inside the **same existing 55-second comparison deadline**. Unknown
or historic partition provenance remains unknown. Persistence/provenance failure
must not break a valid throughput comparison or produce a usable native ID.
Pins expire ten minutes after minting; cached throughput responses never slide
that expiry or mint a replacement pin on a cache hit. Verification and public/off
throughput caches are segregated. No arbitrary browser comparison object is stored.

The native route declares `runtime = 'nodejs'`, `maxDuration = 180`, and a
140-second application deadline. Its job retains the original **one 120-second**
acquisition budget and a fixed 150-second ownership lease. Hosted mode does not
wait behind another acquisition; it returns available cached measurements/limits.
These source declarations are not proof the actual Vercel project supports those
settings. Existing Overall/Boss/Healing `maxDuration = 60` and 55-second application
deadline remain unchanged.

### Private persistence and dispatch safety

Migration: `supabase/migrations/20261013120000_castmirror_execution_private.sql`.
The private `execution_v3` schema must never be exposed through PostgREST. Its
NOLOGIN owner and executor roles are separate. Browser roles, PUBLIC, and
service_role have no private-table/function access. The runtime login receives
only executor membership and fixed transactional functions, not DDL, raw table
writes, account bootstrap/enablement, or owner membership. Runtime preflight
rejects elevated roles. The server-only `pg` adapter uses certificate-verifying
TLS, at most two connections per invocation, and short connection/query/lock
limits. An ambiguous write latches failure and is not replayed.

Account identity is `sha256('wcl-client:' + WCL_CLIENT_ID)`. Admission and actual
OAuth/GraphQL dispatch reservations are committed before sends. Quota observation,
settlement, revision CAS, owner/fence checks, exact-byte immutable history, and
fenced pool publication retain charged/pending/uncertain debt across process
termination and redeployment. No database transaction spans provider HTTP. A
lease expiry is not a refund or permission to replay a dispatched provider call.
Only verified expired terminal groups may archive, atomically with the reduced
active ledger; unknown/nonterminal/unbound debt is never pruned. Pools and pins
have fixed ten-minute TTLs; cache pruning cannot remove accounting/history.
Neither Vercel temporary files nor process-local Maps are shared quota authority.

## Source pin and deterministic maintenance

The reviewed source pin is
`af7d034354abcb4cc4d52719989900a0e0b1b455` from standalone CastMirror main.
`vendor/castmirror/manifest.json` records origin hashes, the declaration allowlist,
minimal pinned source files, hosted adaptation names, and generated checksums.
The frontend/throughput pin remains independent of the reviewed native pin,
`9d1c23fc00aba51c0357e4e312a9306bb1fda130`. Its standalone suite passed 1,154
cases before import. Adapter `castmirror-vercel-v3` preserves existing hosted throughput query selection;
native binding is an optional server-side hook, not a scoring rewrite. Native
provenance and the explicit transitive inventory live in
`vendor/castmirror/native-manifest.json`, generated by
`scripts/sync-castmirror-native.mjs`. The runtime uses only those checked-in native
modules, with the same WCL transport transpiled from TypeScript for dispatch and
diagnostics. Credentials, raw reports, caches, legacy workers/registry, and server
startup are never copied. Native generation rejects dependencies outside its
reviewed inventory and unrelated server/worker lifecycles. Native adapter
`castmirror-native-postgres-2` adds two exact-anchor Turbopack tracing annotations
only to unused local-filesystem branches. The source SHA and runtime/scoring
behavior remain unchanged. Changed or ambiguous anchors fail generation. The
automatic `postbuild` trace guard rejects private files and unreviewed CastMirror
source roots; it does not strip other app routes' existing runtime assets.

```sh
npm run castmirror:check  # verify source hashes, patch anchors, dependencies, outputs
npm run castmirror:sync   # regenerate from the checked-in pinned snapshot
npm run check            # parity, lint, typecheck, all configured unit tests
npm run build            # prebuild checks parity, then creates the Next production build
npm run castmirror:trace # audit actual build inventories without reading traced private contents
```

Neither generation nor normal builds fetch upstream or need the sibling checkout.
To reconstruct the **currently pinned** snapshot from a local CastMirror checkout:

```sh
node scripts/sync-castmirror.mjs --import-source /path/to/cast-mirror
node scripts/sync-castmirror-native.mjs --import-source /path/to/cast-mirror
```

The import reads exactly the pinned Git commit, not the working tree. A future
source update must explicitly change and review the pin, adapt any changed
anchors/dependencies, regenerate, and run the regression/browser checks. Do not
edit generated HTML/core files directly or silently bump readiness flags.

The generator uses the installed TypeScript compiler API to extract complete
allowlisted declarations. It rejects missing/duplicate declarations, unresolved
symbols, server-lifecycle/transport dependencies, altered patch anchors, source
hash drift, and edited generated outputs. Import validates before writing. All
checksums normalize LF line endings for reproducibility on Windows and Linux.

## Verification and deployment

New suites live under the existing `tests/unit/castmirror-*.test.ts` glob and test
the production core/adapters plus the **actual generated HTML** (all inline scripts
run in order). Synthetic fixtures establish plumbing, not real benchmark readiness.
Explicit ESLint is also run for the CastMirror adapters because the general lint
config excludes that existing integration.

Before merging, run the standalone native suite, `npm run check`, explicit adapter
lint, `npm run test:db`, `node scripts/check-client-contract.mjs`, and `npm run build`.
The embedded-Postgres tests exercise real local transactions/concurrency and role
permissions; they do not establish production Supabase access or capacity. Drive
the actual Next app in Chrome at desktop/phone widths and verify real
Overall/Boss/Healing responses. Preserve the 82 historical and 27 consumed pilot
files without baseline regeneration. Inspect the exact Production deployment SHA,
both URL aliases, source markers, legacy-disabled endpoints, and native gate.
Do not mistake a standalone test, synthetic fixture, or unchanged deployment for
working public native Execution.

### Production provisioning and one-writer cutover

1. Verify actual Vercel project runtime, plan/function duration support, and
   deployment access. Verify real PostgreSQL connectivity, migration/role
   authority, connection limits, storage usage, and available capacity. No
   service-role REST credential establishes these permissions or replaces a
   restricted SQL login. Keep `EXECUTION_NATIVE_ENABLED` and
   `EXECUTION_RUNTIME_VERIFIED` off until their corresponding checks pass.
2. An authorized database administrator applies the private migration and
   provisions a dedicated `LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB
   NOCREATEROLE NOREPLICATION` login with executor membership only, no admin option.
   Deliver its connection string securely; never commit or print it. The database
   hostname/certificate must verify successfully (use the provider CA if needed).
3. Stop/disable **every old native acquisition writer for the same WCL client**
   before exporting its final live ledger and linked live history. A running
   loopback 8130 process is not persistent hosting and must not remain a second
   acquisition authority after cutover. Preserve charged, pending, uncertain,
   legacy, and unbound debt; never manufacture an empty account or reset/resume an
   old job. Do not migrate or rewrite protected historical/pilot files.
4. After validating the final live snapshot and exact history hashes, the
   administrator calls `execution_v3.seed_account(account, exact_ledger_text,
   history_json)` using bound SQL parameters. History is oldest-first
   `[{sha256, bytes}]` containing exact UTF-8 JSON including its original newline,
   not reserialized objects. Bootstrap is admin-only and leaves `enabled=false`.
   Verify the imported ledger/hash/archive head and retained debt, then the
   administrator explicitly enables that account. The application cannot seed,
   enable, or silently replace a missing account.
5. Configure server-only `EXECUTION_DATABASE_URL`, optional
   `EXECUTION_DATABASE_CA`, existing `WCL_CLIENT_ID`/`WCL_CLIENT_SECRET`, and a
   securely generated `EXECUTION_VERIFY_TOKEN`. Set `EXECUTION_RUNTIME_VERIFIED=1`
   **only after actual hosting/database/cutover checks pass**. With the public flag
   still off, private verification uses `Authorization: Bearer <verification token>`
   against the same enabled account; query strings/forwarded headers are not
   authorization. Do not use `NEXT_PUBLIC_*` credentials or a Supabase service-role
   key. Private verification does not create a new quota identity.
6. Run strictly bounded real hosted Mythic DPS, healer, and tank comparisons,
   including Any/Exclude, unknown/incomplete data, repeated cached requests,
   contention, and restart/redeployment safety. Verify admission is persisted
   before dispatch, stale owners cannot publish, and uncertain debt survives.
   Set `EXECUTION_NATIVE_ENABLED=1` only after these hosted checks succeed, then
   verify the actual public page and report its exact deployment SHA.

Do not roll back to the old filesystem writer after shared-ledger activity unless
an administrator reconciles the **latest** shared accounting and disables the new
writer first. Reusing the pre-cutover file ledger would discard new debt. If any
access, capacity, migration, cutover, or hosted verification step is blocked, leave
public native acquisition off and report the exact blocker rather than readiness.
