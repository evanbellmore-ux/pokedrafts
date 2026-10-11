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
- **Execution is visible but disabled.** Current real encounter catalogs are not
  score-ready; no real top-ten-per-boss benchmark set or best-observed individual
  has been selected. This hosted release also has no durable worker/snapshot or
  cross-instance hydration service. It does not fabricate a winner, score,
  percentile, reviewed scope, sample size, or coverage. WCL Execution rankings
  describe raid/team kills, not an individual world #1.

The page includes a `castmirror-source` meta tag and a small source-version line
for checking the deployed copy. Frozen release capabilities and explicit response
capabilities guard reference rendering, polling, hydration, and refresh. Missing
or false capabilities fail closed, including inconsistent ready-looking payloads.

## Serverless boundaries

The comparison core contains only request-scoped throughput behavior. It does
not import standalone `apiCompare`, `createServer`, filesystem registries,
retained comparison-ID Maps, refresh CLI code, or post-response crawls.

Hosted adaptations make PI and hero probes use the same realm-aware actor
identity as fight streams; probe caches also include the normalized realm.
Ambiguous actors or spec-summary names fail closed instead of borrowing a
namesake's evidence. Raw resource snapshots may omit `max`, as the canonical
aggregator already supports; a supplied maximum must still be a valid number.

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
  existing `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` configuration.
- Request inputs are validated before queries, including paired public report
  pins, bounded strings, GraphQL integer IDs, regions, difficulty, and metric.
  An auto-zone sentinel remains unverified requested context, not benchmark scope.

## Hosted Execution API

All availability endpoints are stateless. They make **zero WCL requests,
filesystem writes, or job dispatches**.

| Endpoint | Method | Result |
| --- | --- | --- |
| `/api/castmirror/execution/status?zone=53&encounter=3470&difficulty=4` | GET | 200, `state: unsupported` |
| `/api/castmirror/execution/refresh` | POST | 403, builds disabled |
| `/api/castmirror/execution/reference` | GET | 409, benchmarks unavailable |

Status validates context; missing/invalid required encounter returns 400.
Unsupported methods return Next.js 405 responses. Refresh is unconditionally
forbidden: forwarded loopback headers are not authorization. Comparisons attach
the same availability state but issue no retained `comparisonID`.

The status contract sets `capabilities.build` and `capabilities.reference` to
`false`, with `revision`, `scope`, `coverage`, `job`, and `updatedAt` all null.
`requestedContext` is separate from verified Execution scope. No query starts a
raid scan. Durable production benchmarks, reviewed encounter bindings, shared
snapshots, cross-instance pins, and authenticated maintenance remain future work.

## Source pin and deterministic maintenance

The reviewed source pin is
`862458f24ac1859b569813f57d104732117ef67c` from standalone CastMirror main.
`vendor/castmirror/manifest.json` records origin hashes, the declaration allowlist,
minimal pinned source files, hosted adaptation names, and generated checksums.
Only the frontend and required throughput declarations are vendored; credentials,
raw reports, caches, workers, and server startup are not copied.

```sh
npm run castmirror:check  # verify source hashes, patch anchors, dependencies, outputs
npm run castmirror:sync   # regenerate from the checked-in pinned snapshot
npm run check            # parity, lint, typecheck, all configured unit tests
npm run build            # prebuild checks parity, then creates the Next production build
```

Neither generation nor normal builds fetch upstream or need the sibling checkout.
To reconstruct the **currently pinned** snapshot from a local CastMirror checkout:

```sh
node scripts/sync-castmirror.mjs --import-source /path/to/cast-mirror
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

Before merging a CastMirror change, run `npm run check`, explicit adapter lint,
`node scripts/check-client-contract.mjs`, and `npm run build`; drive the actual Next
app in Chrome at desktop/phone widths with controlled fixtures. No database
migration or seed is required for this integration. Inspect the deployed Vercel
revision, both URL aliases, the source marker, validated status JSON, disabled
refresh capability, and independent Overall/Boss behavior. Do not mistake a
successful standalone test or deployment of unchanged Pokedrafts for live parity.
