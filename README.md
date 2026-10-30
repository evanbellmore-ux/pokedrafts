# PokeDrafts

Fantasy-football-style Pokémon draft leagues. A commissioner creates a league,
picks a point-priced draft pool, invites coaches with a link, and runs a live
snake draft with a pick timer. Finalized rosters feed a round-robin schedule,
reported results build the standings, and coaches make a limited number of
free-agent swaps during the season.

Built with Next.js 16 (App Router, React 19, Tailwind 4) on Supabase (Postgres,
Auth, Realtime, Storage). Every multi-row mutation runs inside a Postgres
function so it is atomic and enforced server-side; the browser reads through
row level security with the anon key.

## Repository layout

| Path | What |
| --- | --- |
| `app/` | Next.js routes, components and client helpers |
| `proxy.ts` | Auth gate (Next 16 `proxy.ts`, the former middleware) |
| `supabase/migrations/` | The whole backend: tables, constraints, RLS, functions |
| `scripts/` | Seeding tools for the Pokémon dex, sprites and types, and the Pool Builder dataset build + seed |
| `data/pokemon/` | The generated Pokémon dataset, regulation presets and build report that `npm run seed:pokemon` loads |
| `tests/unit/` | Vitest unit tests (`npm run test`) |
| `tests/db/` | Migration + RPC + RLS tests on an embedded Postgres (`npm run test:db`) |
| `docs/schema.md` | Generated description of the schema, functions and policies |
| `docs/release-architecture.md` | The contract this release implements |

## Champions damage calculator

The signed-in **Calculator** page (`/calculator`) ranks an attacker's Champions
learnset against a configured defender. It uses level-50 Stat Points, supported
forms/items/abilities, explicit field conditions and damage/KO assumptions.
Calculations run locally; no calculator migration or seed is required.
See [calculator usage, limitations and data maintenance](docs/champions-calculator.md).

## Hosted CastMirror

`/castmirror` (also `/CastMirror`) serves `public/castmirror.html` and the
server-only `/api/castmirror` routes. This is a **separate integration** from the
standalone [CastMirror repository](https://github.com/evanbellmore-ux/cast-mirror):
merging that repository does not update this site. See
[the hosted port and maintenance contract](docs/castmirror-hosted.md).

The hosted port provides independent Overall/Boss damage references (Healing
for HPS), preserves the selected player kill, and switches loaded references
locally. **Execution is visible but unavailable**: the real encounter catalogs
are not score-ready, no top-ten-per-boss benchmark set has been completed, and
this serverless release has no durable benchmark worker or hydration service.
It does not invent a score, winner, verified scope, or coverage.

`npm run castmirror:check` checks generated parity against the pinned source
snapshot and also runs first in `npm run check`. Source updates are explicit;
ordinary builds never fetch upstream or need a sibling checkout.

## Local setup

1. Install Node 24, the version in `.nvmrc` (22.12 or a later 22.x also
   works; vitest 5 does not run on Node 20), and run `npm install`.
2. Create a Supabase project (or use an existing one) and note the project URL,
   anon key and service-role key from **Project Settings > API**.
3. Copy the blocks from `.env.example` into two files in the project root:
   - `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     (read by Next.js).
   - `.env.scripts` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (read only
     by `scripts/`). Keep the service-role key out of `.env.local` and out of
     every deploy target; it bypasses row level security.
4. Apply the migrations (next section) and seed the dex and the Pool Builder
   dataset (below).
5. `npm run dev` and open http://localhost:3000.

## Applying migrations to a Supabase project

The files in `supabase/migrations/` must be applied **in filename order**:

1. `00000000000000_base_schema.sql` - creates every table with
   `create table if not exists`. On the existing project it is a no-op.
2. `20260626163000_...` through `20260718120000_...` - the eight earlier
   incremental migrations.
3. `20260909120000_release_hardening.sql` - constraints, indexes, realtime,
   the `sprites` bucket, the complete function catalog and the complete policy
   set. It **drops every existing policy** on the application tables before
   recreating them, and **drops the legacy** `start_draft_timer`,
   `advance_draft_timer` and `complete_draft_timer` functions. It is idempotent
   and safe to re-run.
4. `20260912120000_playoffs.sql` - standings tiebreakers and single-elimination
   playoffs: the `tiebreaker`, `playoff_format` and `champion_member_id` league
   columns, the playoff columns on `league_matches` (`stage`,
   `winner_remaining`, seeds and bracket links; a playoff slot may be empty),
   the `season` news type, `league_standings`, `generate_playoffs`,
   `clear_playoffs`, and new signatures for `create_league` and
   `report_match_result` (the old ones are dropped). Idempotent and safe to
   re-run.
5. `20260916120000_pool_builder.sql` - the Pool Builder v2 dataset table
   `public.pokemon` (one row per distinct, usable Pokémon with stats, types,
   tags, game availability and Pokédex numbers; `bst` is generated), its
   indexes, a select policy for signed-in users and read-only grants (no
   client writes, no anon access), and `_migration_report()` extended with the
   table's unique constraints. It loads no data: `npm run seed:pokemon` does
   (see "Seeding Pokémon data"). Idempotent and safe to re-run; it adds no
   function, so the client contract does not change.

**Never run one of the eight legacy files after the hardening file.** The
eight older files recreate the pre-release write policies (a coach could set
their own `league_members.role` to `commissioner` and then delete the league),
and only the hardening file removes them again. Whatever runs an older file
after it, for any reason, reopens that hole until the hardening file runs once
more, so never run an older file after the hardening file without re-running
the hardening file afterwards.

**Feature migrations after the hardening file are applied in filename order,
after it.** `20260912120000_playoffs.sql` (and any later feature file) builds
on the hardening file's functions and drops the signatures it replaces (the
7-parameter `create_league`, the 2-parameter `report_match_result`).
Re-running the hardening file on its own recreates those old signatures next
to the new ones, and PostgREST can then not choose between them ("could not
choose the best candidate function") until the later file runs again. So
whenever you re-run `20260909120000_release_hardening.sql`, also
re-run `20260912120000_playoffs.sql` (and every later feature file) after it,
in filename order. `npm run test:db` demonstrates all of this: the whole set
re-applies cleanly in filename order, an older file re-applied after the
hardening brings the legacy policies back, and the hardening re-applied on
its own makes `create_league` ambiguous until the playoffs file follows it.

Either way works:

- **SQL editor**: open the Supabase dashboard > SQL Editor, paste each file in
  order and run it. The hardening migration prints a `WARNING` (instead of
  failing) if existing rows block a constraint or if it could not create the
  bucket or the realtime entries, and the result grid it leaves behind is the
  report described next. If you ever paste one of the older files again (to
  re-check it, say), paste and run the hardening file again right after it,
  followed by the feature files that sort after it.
- **Supabase CLI**: the repository does not ship `supabase/config.toml`, so
  `supabase init` has to run once before `link` and `db push` work:

  ```bash
  supabase init                       # writes supabase/config.toml (commit it, or keep it local)
  supabase login
  supabase link --project-ref <ref>   # writes supabase/.temp/, which is git-ignored
  supabase migration list             # local files vs the remote history table
  supabase db push --include-all
  ```

  `--include-all` is required. Without it `db push` applies only the files
  that sort **after** the newest version already recorded in the remote
  history table (`supabase_migrations.schema_migrations`), and
  `00000000000000_base_schema.sql` sorts before every version that table could
  contain, so on a project that was ever pushed with the CLI the base file (and
  any older file that was never pushed) would be skipped silently. Read the
  `migration list` output first: a file listed under `Local` only is one that
  `--include-all` will run, in filename order, each in its own transaction.

  Files already applied by hand through the SQL editor are recorded instead of
  re-run with `supabase migration repair --status applied <version>` (the
  14-digit prefix, e.g. `20260626163000`). Repair **every** version up to and
  including the newest one applied by hand, never the hardening version on its
  own: if `20260909120000` is recorded as applied while an older version is
  still listed under `Local` only, the next `db push --include-all` runs that
  older file **after** the hardening and reinstates the legacy policies (see
  the rule above). Before pushing, check that `supabase migration list` shows
  no version older than `20260909120000` under `Local` only once the hardening
  is recorded as applied; if it does, repair those versions too, or let the
  push run and then re-run `20260909120000_release_hardening.sql` in the SQL
  editor followed by `20260912120000_playoffs.sql` and
  `20260916120000_pool_builder.sql`. Re-running files is otherwise harmless:
  `npm run test:db` applies the whole set twice in filename order.

### The deployed client must be on the RPC catalog first

The hardening migration removes everything the pre-release client relied on:
the three timer functions are dropped (calls to them return PostgREST
`PGRST202`, function not found) and the browser can no longer insert, update
or upsert `leagues`, `league_members`, `league_invites`, `draft_picks`,
`drafted_teams`, `league_matches` or `league_news` (inserts fail with `42501`;
an update or delete that a policy filters out "succeeds" with zero rows, so the
old client even reports "Settings saved."). Creating a league, the draft room,
free agents, matches, the overview and the settings page all stop working
until the deployed client uses the wrappers in `app/lib/rpc.ts`, and that
client cannot run against the pre-hardening database either, because the
functions it calls do not exist there yet (every call returns `PGRST202`,
which the client shows as "This feature is not available yet, please try
again later." and logs with the missing function name; `/invite/<code>`
logged out is the quickest way to see it). Ship both in one step: apply the
hardening migration and deploy the client that goes with it in the same
maintenance window.

`node scripts/check-client-contract.mjs` is the gate for that. It scans `app/`
and `proxy.ts` for calls to dropped or unknown RPCs, for direct writes to
the tables above, and for writes to the read-only tables (`pokemon`, the Pool
Builder dataset, which only `npm run seed:pokemon` writes), prints each
`file:line`, and exits 1 when it finds any. The RPC names it accepts and the
read-only tables it knows are the union of the `Grants` sections of every file
under `supabase/migrations/` (the hardening file and the feature files after
it). Run it on the branch you are about to deploy and apply the migrations
only when it exits 0. `npm run test:db` runs the same scan against the working
tree and fails while the gate is red, and checks the gate itself (the names it
accepts are exactly the functions the migrations grant, the read-only tables
are exactly the tables `authenticated` may select but never write, and every
wrapper in `app/lib/rpc.ts` names one of the functions).

The same rule applies to `20260912120000_playoffs.sql`: a client deployed
ahead of it gets `PGRST202` for `league_standings`, `generate_playoffs` and
`clear_playoffs` (the standings page and the bracket show "This feature is not
available yet"), while the previous client keeps working after it, because the
parameters the file adds to `create_league` and `report_match_result` have
defaults. Apply it and deploy the client that uses it in the same window.

The direct writes that remain (`draft_formats`, draft chat inserts, deleting a
league) should end with `.select().single()` so a row filtered out by a policy
surfaces as `PGRST116` ("Nothing to update, you may not have permission.")
instead of a silent success with zero rows.

### Verify the result

The hardening migration never fails on bad existing data: a unique constraint
that duplicates would violate is **skipped**, a check constraint that rows
violate is added **`NOT VALID`** (enforced for new writes only), and pieces it
lacks privileges for (the bucket, the realtime entries) are left for the
dashboard. Each case prints a `WARNING`, but the SQL editor does not show
notices reliably, so the file (and the playoffs and pool builder files after
it) ends with

```sql
select * from public._migration_report();
```

which is also what the editor displays as the result of running it. Run it
again at any time as the `postgres` role (it is not callable through the API).
**No rows means there is nothing to fix.** Each row names the item, why it was
skipped and the exact statement that resolves it, for example
`alter table public.league_matches validate constraint league_matches_status_check;`
once the offending rows have been fixed. It also lists any league that has no
pool: one that started its draft before this release and whose draft format
was deleted before the migration could copy it onto the league, or one whose
format breaks the pool rules the functions enforce (points 1..20, at most 2000
entries, and so on), in which case the row quotes the entry to fix and the
migration copies the format once it is fixed and the file is re-run (see
`docs/schema.md`).

Until a `NOT VALID` check is resolved, every row that still violates it rejects
**all** updates with SQLSTATE `23514`, including unrelated ones made through the
RPCs (on `leagues` that would be a plain rename in `update_league_settings`),
and the app only shows a generic error for it. To keep that from happening on
`leagues`, the migration first clamps out-of-range settings into the documented
ranges (`max_coaches` 2..24, `point_budget` 1..10000, `picks_per_team` 1..30,
`pick_timer_seconds` 10..3600, `free_agent_swap_limit >= 0`) and reports how
many leagues it touched; what remains `NOT VALID` are values it cannot guess,
such as an unknown `league_matches.status`.

The same facts straight from the catalog:

```sql
-- checks added NOT VALID
select conrelid::regclass, conname, pg_get_constraintdef(oid)
from pg_constraint
where connamespace = 'public'::regnamespace and not convalidated;

-- unique constraints that exist (compare with docs/schema.md)
select conrelid::regclass, conname
from pg_constraint
where contype = 'u' and connamespace = 'public'::regnamespace
order by 1, 2;
```

`docs/schema.md` describes the resulting schema, functions and error codes.

## Auth settings

In the Supabase dashboard under **Authentication**:

- **URL Configuration > Site URL**: `https://www.pokedrafts.io` (for a project
  used only locally, `http://localhost:3000`).
- **URL Configuration > Redirect URLs**: `https://www.pokedrafts.io/**`, plus
  `http://localhost:3000/**` for local work against the same project.
  Sign-up confirmations, password resets and Discord sign-ins return through
  `<origin>/auth/callback?next=<path>`, which completes the login and then
  redirects to the page the user came from. Supabase matches an entry against
  the whole URL, query string included, so a bare `<origin>/auth/callback`
  entry never matches; `**` matches any path and query.
- **Email Templates**: change the link in **Confirm signup** and in **Reset
  password** from the default `{{ .ConfirmationURL }}` to a token-hash link:

  ```
  {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup&next={{ .RedirectTo }}
  {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next={{ .RedirectTo }}
  ```

  The default link is a PKCE flow that only works in the browser that started
  it, because the code verifier lives in a cookie there. A confirmation email
  opened on another device or in another browser (sign up on a laptop, tap the
  email on the phone) then lands on `/login?error=auth-device` even though the
  address was confirmed. Token-hash links carry everything the callback route
  needs (`verifyOtp`), so they work anywhere. `{{ .RedirectTo }}` expands to
  the `emailRedirectTo` / `redirectTo` value the app sends
  (`<origin>/auth/callback?next=<path>`), which the route unwraps to `<path>`,
  so an invited coach still lands on the invite and a password reset still
  leads to `/update-password`. `{{ .SiteURL }}` is the Site URL above, so set
  that first.
- **Providers > Email**: keep **Confirm email** enabled; the sign-up page shows
  a "Check your email" message and the callback route completes the login.
- **Emails > SMTP Settings**: Supabase's built-in sender only delivers to the
  members of your Supabase team, a couple of emails an hour, so real users
  never get their confirmation or password-reset emails. Turn on custom SMTP
  with a provider such as Resend, Postmark or Amazon SES, sending from a domain
  you own (the provider gives you its DNS records to add), then raise the email
  limit under **Rate Limits**. While Supabase cannot send, the sign-up,
  resend and password-reset forms say "We can't send email right now, please
  try again later." (`app/lib/errors.ts`).
- **Providers > Discord** (optional, no email needed): in the Discord Developer
  Portal create an application, and under **OAuth2** add the redirect
  `https://<project-ref>.supabase.co/auth/v1/callback`; copy its client ID and
  client secret into this provider and turn it on. Within five minutes the
  login and sign-up pages show **Continue with Discord** (they read the
  project's public auth settings: `app/lib/auth/providers.ts`). It signs the
  user in, creating the account on the first visit, and returns through
  `/auth/callback` like the email links, so the Redirect URLs above cover it.

## Seeding Pokémon data

With `.env.scripts` in place, run in this order:

```bash
npm run seed:dex       # pokemon_dex: dex_number + English name for 1..1025 (POKEDEX_MAX=151 to limit)
# upload <dex_number>.png files to the public "sprites" bucket (created by the hardening migration)
npm run seed:sprites   # pokemon_dex.sprite_url, only for files that exist in the bucket
npm run seed:types     # pokemon_dex.type1/type2 for rows that have no type yet
npm run seed:pokemon   # pokemon: the Pool Builder dataset from data/pokemon/pokemon.json (after 20260916120000_pool_builder.sql)
```

The scripts stop with a clear message when the env variables are missing, retry
PokeAPI requests with backoff, page through the table until exhausted, and
resolve species by dex number so special names and default forms resolve.

The Pool Builder dataset (`public.pokemon`, docs/release-architecture.md
section 13) is generated, never typed, and the generated files are committed:

```bash
npm run data:pokemon                      # scripts/build-pokemon-data.mjs: rebuilds data/pokemon/{pokemon,regulations,report}.json
npm run data:pokemon -- --refresh-serebii # also re-fetches the Champions regulation pages
npm run seed:pokemon                      # scripts/seed-pokemon.ts: loads data/pokemon/pokemon.json into public.pokemon
```

`data:pokemon` crawls PokéAPI (cached under `scripts/.cache/pokeapi/`, git
ignored, so a rerun only fetches what is missing) and parses the saved
Serebii regulation pages into `data/pokemon/sources/`; it exits 1 on a roster
name it cannot map and writes `data/pokemon/report.json` with the counts to
review. `seed:pokemon` validates every row of `pokemon.json` against the
table's constraints, parks the rows whose slug or display name the file has
moved to another `id` (a display-name fix, a swap, a row that gained a real
PokéAPI id: `slug` and `display_name` are unique, so the upsert would
otherwise fail with `23505`), upserts every row on `id` in batches of 500,
deletes the rows whose `id` is no longer in the file, prints the counts and
exits 1 on any error; it is the table's only writer (the browser only reads
it). It reads the
service-role key from `.env.scripts` like the other scripts, and only from
there. To refresh the data later: `npm run data:pokemon`, review the diff of
`data/pokemon/*.json` and `report.json`, commit, and run
`npm run seed:pokemon` again.

## Running the tests

```bash
npm run test       # unit tests (schedule generator, standings, helpers)
npm run test:db    # migrations, RPCs, RLS and concurrency on an embedded Postgres
npm run check      # lint + tsc --noEmit + unit tests
```

`npm run test:db` downloads nothing and touches no remote project: it starts an
embedded Postgres in a temporary directory, creates the Supabase-like
scaffolding (`anon`/`authenticated` roles, `auth.uid()`, the realtime
publication, a stub `storage` schema), applies every migration in order and runs
the suites in `tests/db/`. It takes about twenty seconds, and it exits 1 when a
test fails: `embedded-postgres` hooks the process exit and used to end the run
with status 0 regardless of the results, so `tests/db/global-setup.ts` removes
that hook once it has stopped the server, and `tests/db/exit-code.test.ts`
checks the status of a failing run.

GitHub Actions runs `npm run check` and `npm run test:db` on every push to
`main` and on every pull request (`.github/workflows/ci.yml`: two jobs on
Ubuntu with Node 24 and the npm cache). Vercel runs only the build, so this is
where the tests run.

## Deploying

1. Run `node scripts/check-client-contract.mjs` on the release branch; it must
   exit 0 (`npm run test:db` runs the same scan and fails while it is red).
   Then apply the migrations and configure Auth as above on the production
   project, including the two token-hash email templates, and deploy the
   client from that same branch in the same window (see "The deployed client
   must be on the RPC catalog first").
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` on the
   host (Vercel or any Node host that runs `npm run build` and `npm start`). The
   service-role key is not needed by the app.
3. Optional, error reports: set `NEXT_PUBLIC_ERROR_REPORTING=on` on the host
   and deploy again (Next reads it at build time). The browser then posts its
   errors to `/api/error-reports`, and they and the server's errors are written
   to the host's logs as `[pokedrafts] error report {...}` lines; on Vercel,
   search the project's Logs for `error report`. Vercel keeps runtime logs
   for a limited time that depends on the plan. Unset, the browser sends
   nothing and no report lines are written (docs/release-architecture.md
   section 17).
4. Seed the dex, upload sprites, link them and backfill types.
5. Do a smoke test: sign up, confirm the email, create a league, join with a
   second account through the invite link, set the draft order, run a short
   draft, report a result, check the standings, make and undo a free-agent move.

Several later migrations need a one-time step in the dashboard or the SQL
editor. [docs/release-architecture.md section 10](docs/release-architecture.md#10-deployment-hand-off)
lists every step in order, including these:

- pg_cron must be on before `20261020130000_draft_timer_sweep.sql` runs, so
  pick clocks run out with every draft room closed (section 14.5).
- Your account must be in `site_admins` after
  `20261026120000_watch_review.sql` runs, so you can approve leagues for
  /watch at /admin (section 16.6).
- Custom SMTP (Auth settings above) must be on before real users sign up.

Pool Builder v2 (the Pokémon dataset, `20260916120000_pool_builder.sql`) ships
in this order:

1. Apply `20260916120000_pool_builder.sql` in the SQL editor (after the
   hardening and playoffs files). It creates the empty `public.pokemon` table
   and ends with the usual `select * from public._migration_report();`.
2. Run `npm run seed:pokemon` with the service-role key in `.env.scripts`
   (1,237 upserts in the 2026-09-16 build, then it deletes rows that left the file and prints
   the counts; it exits 1 on any error and never touches another table).
3. Deploy the client. Until step 2 runs, the builder shows "Building from rules
   is not available right now" and the rest of the app keeps using `pokemon_dex`;
   the previous client keeps working after step 1, because the file adds no
   function and changes no policy on the other tables.
4. To refresh the data later: `npm run data:pokemon` (add
   `-- --refresh-serebii` for the Champions regulation pages), review the diff
   of `data/pokemon/*.json` and `report.json`, commit, and run
   `npm run seed:pokemon` again.

Public leagues and streams (`20261022120000_public_leagues.sql`,
docs/release-architecture.md section 15) ship in this order:

1. Run `20261022120000_public_leagues.sql` in the SQL editor (after every
   earlier file). It adds three `leagues` columns and three functions, changes
   no policy, and ends with `select * from public._migration_report();`.
2. Optional, for live status on the Watch pages: set `TWITCH_CLIENT_ID` and
   `TWITCH_CLIENT_SECRET` (an application registered at dev.twitch.tv/console,
   client type Confidential) and `YOUTUBE_API_KEY` (a Google Cloud API key with
   the YouTube Data API v3 enabled) on the host. They are server-only and take
   effect on the next deployment; without them a public league counts as live
   only while its draft runs.
3. Deploy the client. A client deployed before step 1 shows "This feature is
   not available yet" on /watch and on the Settings card's Public page until
   the file runs.
