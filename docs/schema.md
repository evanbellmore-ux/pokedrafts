# PokeDrafts database schema

Generated from `supabase/migrations`. The migrations are the source of truth;
this document describes what they produce. Apply them in filename order:

| File | Purpose |
| --- | --- |
| `00000000000000_base_schema.sql` | Every table, `create table if not exists`. Matches the live project; a no-op there. |
| `20260626163000` .. `20260718120000` | The eight incremental migrations from earlier releases (chat, schedule format, cascades, swap limits, news, legacy policies). |
| `20260909120000_release_hardening.sql` | Columns, data fixes, constraints, indexes, realtime, storage, the RPC catalog, and the complete RLS policy set. Idempotent. |
| `20260912120000_playoffs.sql` | Standings tiebreakers and single-elimination playoffs (docs/release-architecture.md section 12): league and match columns, the `season` news type, `league_standings`, `generate_playoffs`, `clear_playoffs`, new signatures for `create_league` and `report_match_result`, and a champion for finished leagues without playoffs. Idempotent. |
| `20260916120000_pool_builder.sql` | Pool Builder v2 (docs/release-architecture.md section 13): the [`pokemon`](#pokemon) dataset table with its generated `bst`, indexes, one select policy for `authenticated`, read-only grants, and `_migration_report()` extended with the table's unique constraints. Loads no data (`npm run seed:pokemon` does), adds no function. Idempotent. |

The hardening migration drops **every** policy on the application tables and
recreates the set in [Row level security](#row-level-security), and drops the
legacy `start_draft_timer`, `advance_draft_timer` and `complete_draft_timer`
functions. The browser never writes directly to `leagues`, `league_members`,
`league_invites`, `draft_picks`, `drafted_teams`, `league_matches` or
`league_news`; all mutations go through the functions below.

Two ordering rules. First, the legacy files and the hardening file:
never run one of the eight legacy files after the hardening file. The eight
older files recreate the pre-release write policies (among them an
unrestricted `league_members` update for coaches and a `leagues` delete that
trusts `league_members.role`), and only
`20260909120000_release_hardening.sql` removes them again; with the older
policies back, a coach in a finished league can make themselves commissioner
and delete the league. If any older file is ever run after the hardening file,
for any reason, re-run the hardening file afterwards. Second, feature
migrations after the hardening file (`20260912120000_playoffs.sql` and later)
are applied in filename order after it: they build on its functions and drop
the signatures they replace, and re-running the hardening file alone brings
those old signatures back next to the new ones (an ambiguous `create_league`
for PostgREST), so re-run every later feature file after any re-run of the
hardening file. The README explains how to record hand-applied files with
`supabase migration repair` without letting `db push` do that.

## Tables

All ids are `uuid primary key default gen_random_uuid()` unless noted.
`leagues.commissioner_id` is the single source of truth for who runs a league;
`league_members.role` is display-only and kept in sync by the functions.

### `draft_formats`

Reusable point-priced Pokémon lists saved from the pool builder. A league never
reads a format live: choosing one (`create_league`, `update_league_settings`)
copies its list onto the league row as `leagues.custom_pool` with
`source: "format"`, and `reset_league_pool` copies it again on request. Every
copy goes through `_validate_pool`, the same rules `update_league_pool`
applies (1..2000 entries, unique names of at most 80 characters, integer
points 1..20, `tier = 21 - points`), so a format that breaks them is refused
with the same error code and a message that names the format, and no league
ever drafts from a mispriced or oversized list. Editing or deleting a format
never changes what any league drafts from, so a format's owner who has handed
the league to another commissioner has no way back into its pool. The
hardening migration copies the format onto every existing format-based league
(see [Data fixes](#data-fixes-applied-by-the-hardening-migration)).

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | uuid | pk |
| `name` | text | not null, check length 1..60 |
| `json` | jsonb | not null, `{ version, leagueName, pokemon: [{ name, points, tier }], rules? }`; check: an object whose `pokemon` is an array of at most 2000 entries (the shape the pool builder writes; the entry-level rules are applied by `_validate_pool` when a league copies the format). `rules` is the optional recipe a Pool Builder v2 format is built from (docs/release-architecture.md 13.5: source, preset, filters, form toggles, pricing bands); the check does not look at it and `_format_pool` / `update_league_pool` never copy it, so a league's `custom_pool` only ever carries `{ name, points, tier }` entries, whatever else a format entry holds |
| `created_by` | uuid | `default auth.uid()`; null means shared with everyone |
| `created_at` | timestamptz | `now()` |

### `leagues`

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | uuid | pk |
| `name` | text | not null, check length 1..60 |
| `commissioner_id` | uuid | not null (auth user id) |
| `max_coaches` | integer | not null, default 8, check 2..24 |
| `created_at` | timestamptz | `now()` |
| `draft_format_id` | uuid | fk `draft_formats(id)` on delete set null |
| `point_budget` | integer | default 100, check 1..10000 |
| `draft_started` | boolean | default false |
| `current_pick_number` | integer | default 1 |
| `picks_per_team` | integer | default 10, check 1..30 |
| `draft_completed` | boolean | default false |
| `pick_timer_seconds` | integer | not null, default 120, check 10..3600 |
| `pick_started_at` | timestamptz | default `now()`; restarted on every pick |
| `auto_pick_in_progress` | boolean | not null, default false (legacy flag, always reset to false) |
| `custom_pool` | jsonb | `{ version: "1.0", leagueName, pokemon: [{ name, points, tier }] }`: the only pool the functions read (`draft_formats` is never consulted for a league's pool). Every list the functions store here has passed `_validate_pool`. A pool copied from a format also carries `source: "format"` and `draft_format_id`; a pool set with `update_league_pool` has no `source`. Null means the league has no pool yet |
| `schedule_format` | text | not null, default `round_robin`, check in (`round_robin`, `double_round_robin`) |
| `free_agent_swap_limit` | integer | not null, default 3, check >= 0 |
| `draft_paused_at` | timestamptz | null while the draft is running |
| `draft_paused_total_seconds` | integer | not null, default 0 |
| `tiebreaker` | text | not null, default `head_to_head`, check in (`head_to_head`, `differential`): the tiebreaker applied first after win percentage and wins (see [Standings and playoffs](#standings-and-playoffs)) |
| `playoff_format` | text | not null, default `none`, check in (`none`, `top_2`, `top_4`, `top_6`, `top_8`); `create_league` defaults it to `top_4` |
| `champion_member_id` | uuid | fk `league_members(id)` on delete set null; the winner of the final, or the top seed once the regular season is complete in a league without playoffs; null until then |

Index on `(draft_format_id)`, used by the `draft_formats` select policy, and a
partial index on `(champion_member_id)` for the foreign key.

Since this column is a second foreign key between `leagues` and
`league_members` (the first is `league_members.league_id`), a PostgREST embed
between the two tables in either direction must name the column, e.g.
`leagues!league_id(...)` from `league_members`; a bare `leagues(...)` gets
HTTP 300 ("more than one relationship was found").
`tests/unit/postgrest-embeds.test.ts` checks the client for this.

### `league_members`

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | uuid | pk |
| `league_id` | uuid | not null, fk `leagues(id)` on delete cascade |
| `user_id` | uuid | not null (auth user id) |
| `role` | text | not null, default `coach`, check in (`commissioner`, `coach`) |
| `joined_at` | timestamptz | `now()` |
| `team_name` | text | check null or length 1..40 |
| `draft_position` | integer | null = spectator (does not draft) |
| `free_agent_swaps_used` | integer | not null, default 0, check >= 0 |

Constraints: unique `(league_id, user_id)`; unique `(league_id, draft_position)`
**deferrable initially deferred** (so `set_draft_order` can reorder in one
statement). Indexes on `(league_id)` and `(user_id)`.

### `league_invites`

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | uuid | pk |
| `league_id` | uuid | not null, fk `leagues(id)` on delete cascade |
| `invite_code` | text | not null, unique; 10 chars from `A-Z 2-9` without `I O 0 1` |
| `max_uses` | integer | not null, default 1; informational (`max_coaches - 1`) |
| `used_count` | integer | not null, default 0; informational |
| `expires_at` | timestamptz | null = never |
| `created_at` | timestamptz | `now()` |

Capacity is enforced by `join_league` from `count(league_members) < max_coaches`,
not from `max_uses`.

### `draft_picks`

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | uuid | pk |
| `league_id` | uuid | fk `leagues(id)` on delete cascade |
| `member_id` | uuid | fk `league_members(id)` on delete cascade |
| `pokemon_name` | text | not null (canonical pool name) |
| `points` | integer | not null (from the pool, never from the client) |
| `tier` | integer | not null |
| `pick_number` | integer | not null |
| `created_at` | timestamptz | `now()` |

Constraints: unique `(league_id, pokemon_name)`, unique `(league_id, pick_number)`.

### `drafted_teams`

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | uuid | pk |
| `league_id` | uuid | fk `leagues(id)` on delete cascade |
| `member_id` | uuid | fk `league_members(id)` on delete cascade |
| `pokemon` | jsonb | not null; array of `{ name, points, tier, pick_number, acquired? }` |
| `total_points` | integer | not null, default 0 |
| `created_at` | timestamptz | `now()` |

Unique `(league_id, member_id)`. Drafted entries carry their `pick_number`;
free-agent pickups have `pick_number: null` and `acquired: "free_agent"`.

### `league_matches`

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | uuid | pk |
| `league_id` | uuid | not null, fk `leagues(id)` on delete cascade |
| `round_number` | integer | not null |
| `match_number` | integer | not null, restarts at 1 per round |
| `home_member_id` | uuid | fk `league_members(id)` on delete cascade; always set on a regular match, null on a playoff match until the round feeding it is decided |
| `away_member_id` | uuid | fk `league_members(id)` on delete cascade; nullable like `home_member_id` |
| `status` | text | not null, default `upcoming`, check in (`upcoming`, `completed`) |
| `winner_member_id` | uuid | fk `league_members(id)` on delete set null |
| `scheduled_at` | timestamptz | unused |
| `created_at` | timestamptz | not null, `now()` |
| `stage` | text | not null, default `regular`, check in (`regular`, `playoff`) |
| `winner_remaining` | integer | null or check 1..12: Pokémon the winner had left standing (null when not recorded, counts as 0 in the differential) |
| `home_seed`, `away_seed` | integer | the playoff seeds of the two coaches, for display; null on regular matches and on empty playoff slots |
| `feeds_match_id` | uuid | fk `league_matches(id)` on delete set null: the playoff match the winner advances to; null for the final and for regular matches |
| `feeds_slot` | text | null or check in (`home`, `away`): the side of that match the winner fills |

Unique `(league_id, round_number, match_number)` (playoff rounds continue
after the last regular round); index on `(league_id)` and a partial index on
`(feeds_match_id)` for the self-referencing foreign key.

### `league_news`

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | uuid | pk |
| `league_id` | uuid | not null, fk `leagues(id)` on delete cascade |
| `member_id` | uuid | fk `league_members(id)` on delete set null |
| `news_type` | text | not null, check in (`free_agent`, `match_result`, `season`) |
| `message` | text | not null, check length 1..500 |
| `metadata` | jsonb | not null, default `{}` |
| `created_at` | timestamptz | not null, `now()` |

Index on `(league_id, created_at desc)`. Metadata shapes:

- `free_agent`: `{ added, dropped, team_id, before_pokemon, after_pokemon, previous_free_agent_swaps_used, next_free_agent_swaps_used }`
- `match_result`: `{ match_id, winner_member_id, loser_member_id, round_number, match_number, stage, winner_remaining }` (one row per match; re-reporting replaces it). The message reads "X defeated Y in Round 3." for a regular match and "X defeated Y in the Semifinals." (the round name, see below) for a playoff match.
- `season` with `kind: "bracket"`: `{ kind, playoff_format, seeds: [{ seed, member_id }] }`, message "The playoff bracket is set.", `member_id` null; written whenever the bracket is (re)built.
- `season` with `kind: "champion"`: `{ kind, member_id, match_id }`, message "X won the championship.", `member_id` = the champion; written when the final is reported (a league without playoffs gets a champion but no news row).

### `draft_chat_messages`

`id`, `league_id` (fk cascade), `member_id` (fk cascade), `user_id` (fk
`auth.users(id)` cascade), `message` (check length 1..500), `created_at`.
Index on `(league_id, created_at)`.

The draft room inserts these rows directly, so the trigger
`draft_chat_messages_defaults` (`before insert ... for each row`, function
`_chat_message_defaults`) assigns `id = gen_random_uuid()` and
`created_at = now()` on every insert. A value the client sends for either
column is ignored, never stored, so a message cannot be given a chosen id or a
timestamp that pins it to the top or bottom of the conversation; the row order
is the order the messages reached the server in. The room's
`insert(...).select(...)` gets the server values back, so nothing changes for
an honest client.

### `pokemon_dex`

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | bigint | identity pk |
| `dex_number` | integer | not null, unique |
| `name` | text | not null, English species name |
| `created_at` | timestamptz | `now()` |
| `sprite_url` | text | public URL in the `sprites` bucket |
| `type1`, `type2` | text | lowercase PokeAPI type names (`fire`), `type2` nullable |

### `pokemon_forms`

`id bigint pk`, `name text not null`, `base_dex_number integer`, `sprite_url text`,
`pokeapi_slug text`. Present in the live project; not read by the app yet.

Both `pokemon_dex` and `pokemon_forms` stay as they are in this release: the
Pool Builder v2 dataset below replaces their reads (the dex loader falls back
to `pokemon_dex` only while `pokemon` is empty), and a later cleanup drops
them.

### `pokemon`

The Pool Builder v2 dataset (`20260916120000_pool_builder.sql`,
docs/release-architecture.md section 13.4): one row per distinct, usable
Pokémon, default forms and the battle-relevant forms alike (Megas, regional
and gender forms, Rotom appliances, Urshifu styles, and so on), never a
cosmetic variant or an in-battle-only transformation. Generated by
`scripts/build-pokemon-data.mjs` into `data/pokemon/pokemon.json` and loaded
by `scripts/seed-pokemon.ts`, the table's only writer; the browser only reads
it. Sorted by `species_id` then `id` in the file; 1,237 rows in the 2026-09-16 build (1025 default forms, 96 Megas and Primals, 57 regional, 4 gender, 55 other).

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | integer | pk; the PokéAPI `pokemon` id, stable across rebuilds |
| `species_id` | integer | not null; the national dex number, shared by every form of a species |
| `slug` | text | not null, unique; the PokéAPI `pokemon` name, e.g. `charizard-mega-x` |
| `display_name` | text | not null, unique; the app's prose convention, e.g. `Mega Charizard X`, `Alolan Raichu`, `Rotom (Wash)`, `Indeedee (Female)`; `normalizePokemonName` of it equals that of the slug |
| `species_name` | text | not null; `Charizard` |
| `form_kind` | text | not null, check in (`default`, `mega`, `regional`, `gender`, `other`) |
| `form_label` | text | `Mega X`, `Alolan`, `Wash`, `Female`; null for the default form |
| `type1` | text | not null; the capitalised app spelling shared with `pokemon_dex` and `TYPE_OVERRIDES` (`Fire`) |
| `type2` | text | nullable |
| `hp`, `attack`, `defense`, `special_attack`, `special_defense`, `speed` | smallint | not null; base stats |
| `bst` | smallint | `generated always as (hp + attack + defense + special_attack + special_defense + speed) stored`; cannot be written |
| `generation` | smallint | not null, check between 1 and 9 |
| `tags` | text[] | not null, default `{}`; any of `legendary`, `sub_legendary`, `restricted`, `mythical`, `paradox`, `ultra_beast`; forms inherit their species' tags |
| `games` | text[] | not null, default `{}`; the game keys the row is available in (`champions`, `scarlet_violet`, `legends_za`, `sword_shield`, `legends_arceus`, `bdsp`, `lets_go`, `ultra_sun_ultra_moon`, `sun_moon`, `oras`, `x_y`, and one key per older generation's main pair) |
| `dex_numbers` | jsonb | not null, default `{}`; entry numbers per Pokédex for the species, `{ "paldea": 12, "champions": 6 }` |
| `sprite_url` | text | PokéAPI official artwork, falling back to the front sprite, then the species' |
| `updated_at` | timestamptz | not null, default `now()`; the seed script sets it to the run's timestamp on every upsert |

Indexes: `pokemon_species_id_idx (species_id)`, `pokemon_bst_idx (bst)`,
`pokemon_tags_idx` (GIN on `tags`), `pokemon_games_idx` (GIN on `games`),
plus the primary key and the two unique constraints. RLS is enabled with one
policy, `Signed-in users can read the dataset` (`select` for `authenticated`,
`using (true)`), and the grants make the table read-only for the API roles:
`select` for `authenticated`, nothing for `anon` (a read fails with `42501`),
no `insert`, `update` or `delete` for either (they fail with `42501` before RLS
is consulted); `service_role`, which the seed script uses, keeps `select`,
`insert`, `update` and `delete`. The migration creates the table with `create
table if not exists`, adds the unique and check constraints to a table that
already existed without them (skipping a unique that duplicates would violate
with a warning, like the hardening file), drops and recreates the policy, and
re-runs cleanly; it loads no rows and prints a notice with the row count (0
means "run `npm run seed:pokemon`"). Until the seed runs, the Pool Builder
shows its empty state and the rest of the app keeps reading `pokemon_dex`.

Seed and refresh order (docs/release-architecture.md 13.9):

1. Apply `20260916120000_pool_builder.sql` (after the hardening and playoffs
   files).
2. `npm run seed:pokemon` with the service-role key in `.env.scripts` (the
   only file the scripts read): validates every row of
   `data/pokemon/pokemon.json`, parks the rows whose `slug` or
   `display_name` the file moved to another `id` (both are unique, so the
   upsert would otherwise stop with `23505`), upserts every row on `id` in
   batches of 500, deletes the rows whose `id` is not in the file, and prints
   the counts (1,237 upserts in the 2026-09-16 build). Exits 1 on any error.
3. Deploy the client.
4. To refresh the data later: `npm run data:pokemon` (add `-- --refresh-serebii`
   to re-fetch the Champions regulation pages), review the diff of
   `data/pokemon/*.json` and `report.json`, commit, and run `npm run seed:pokemon`
   again.

### `draft_order`

Legacy (`id`, `league_id`, `member_id`, `pick_slot`, `created_at`). RLS enabled
with no policies, so it is unreachable through the API.

## Data fixes applied by the hardening migration

- `league_members.role`: the historical `commisioner` typo is corrected, then
  every row is synced to `leagues.commissioner_id` (`commissioner` for that
  user, `coach` for everyone else).
- `league_members.team_name` trimmed and capped at 40 characters (blank -> null).
- `leagues.name` trimmed and capped at 60 characters (blank -> `Untitled League`).
- `draft_formats.name` trimmed and capped at 60 characters (blank ->
  `Untitled format`).
- Format-based leagues that have no pool array in `custom_pool` (the
  pre-release client never wrote one for a format, so the pool was read from
  `draft_formats` live) get a copy of their format's list, validated and
  normalized by `_validate_pool` like every other pool, with
  `source: "format"` and `draft_format_id`. A `notice` says how many leagues
  were copied. A league whose format breaks the pool rules (a 0-point entry,
  say) is skipped with a `warning` that names the league, the format and the
  entry, keeps no pool, and is listed by `_migration_report`; fix the format
  and re-run the migration to copy it. A started league whose format row was
  already deleted keeps an empty pool and is listed as well.
- `leagues` numeric settings clamped into the documented ranges (`max_coaches`
  2..24, `point_budget` 1..10000, `picks_per_team` 1..30, `pick_timer_seconds`
  10..3600, `free_agent_swap_limit >= 0`) so the check constraints validate; a
  `warning` says how many leagues were touched.
- Duplicate `(league_id, user_id)` memberships created by the old join flow are
  removed when the duplicate owns no picks, team, matches, news or chat.
- If a unique or check constraint still cannot be added because existing rows
  violate it, the migration raises a `warning` instead of failing: unique
  constraints are skipped, check constraints are added `not valid`. See the
  next section.

## Data fix applied by the playoffs migration

- Leagues with `playoff_format = 'none'` (every league that existed before the
  file ran), `draft_completed`, at least one regular match, every regular
  match completed, no bracket and no champion yet get
  `champion_member_id = seed 1` from the standings; a `notice` says how many.
  Leagues that already carry a champion are left alone, so re-running the
  file changes nothing.
- Values outside the new checks (only possible when one of the new columns was
  added by hand first) fall back to the defaults (`head_to_head`, `none`,
  `regular`) so the checks validate; the guarded helpers add a violated check
  or foreign key `not valid` with a warning, exactly as the hardening file
  does, and `_migration_report` lists it.

## Verifying the migration

The hardening migration ends with `select * from public._migration_report();`,
and so do the playoffs and pool builder files, so the Supabase SQL editor
shows the report as the result of running any of them. Run it again at any
time as the database owner (it is revoked from `anon` and `authenticated`). It
returns one row per open item with `severity`, `item`, `detail` and `action`,
and **no rows when there is nothing to fix**:

| Item | Why | Action |
| --- | --- | --- |
| `constraint <name> on <table>` | a check constraint was added `not valid` because existing rows violate it | fix the rows, then `alter table <table> validate constraint <name>;` |
| `unique (<cols>) on <table>` | duplicates exist, so the unique constraint was skipped | remove the duplicates, then re-run the hardening migration (or, for `unique (slug)` / `unique (display_name) on public.pokemon`, the pool builder migration) |
| `realtime: <table>` | not in the `supabase_realtime` publication | Database > Replication, or `alter publication supabase_realtime add table ...` |
| `storage: ...` | the `sprites` bucket or its read policy is missing (or could not be inspected by this role) | create the public bucket / policy from the dashboard |
| `league <id> (<name>)`, warning | the league started (or finished) its draft but has no pool, so no pick or free-agent pickup is possible: its draft format was deleted before the migration could copy it onto the league, or the format breaks the pool rules (the detail quotes the offending entry) | fix the format and re-run the hardening migration (it copies the format then), or put the list back on `custom_pool` with the statement in the action, or have the commissioner run `reset_draft` and choose a pool again |
| `league <id> (<name>)`, info | the league has not started and has no pool because its draft format breaks the pool rules, so the draft cannot start | fix the format, then have the commissioner use "Reset to format" on the Pool page (`reset_league_pool`) or set a pool there |

`20260916120000_pool_builder.sql` re-creates `_migration_report()` with the
hardening file's body plus the `pokemon` unique constraints in the list it
checks (an empty `pokemon` table is not a report row: the file prints a notice
with the row count instead, since loading the data is the seed script's job).
Re-running the hardening file alone puts its own body back, so re-run the pool
builder file after it, as with every feature file.

A row that still violates a `not valid` check rejects **every** update with
SQLSTATE `23514`, including unrelated ones made through the RPCs (on `leagues`
that would be a plain rename through `update_league_settings`, and the app only
shows a generic error). That is why the migration clamps `leagues` settings
before adding the checks; what remains `not valid` are values it cannot guess,
such as an unknown `league_matches.status`.

The same facts straight from the catalog:

```sql
select conrelid::regclass, conname, pg_get_constraintdef(oid)
from pg_constraint
where connamespace = 'public'::regnamespace and not convalidated;
```

## Functions (RPC catalog)

Every function is `language plpgsql security definer set search_path = public,
extensions`, revoked from `public` and `anon`, and granted to `authenticated`.
`get_server_time`, `get_invite_preview` and `is_league_member` are also granted
to `anon`. Helpers prefixed with `_` are internal (no API grants).

Validation failures raise SQLSTATE `P0001` with a user-facing `message` and a
`snake_case` code in `detail`. `friendlyError()` in the app shows the message
verbatim. Every function that mutates a league locks its row (`for update`)
first, so concurrent callers serialize.

Codes shared by many functions: `not_authenticated` (no user),
`league_not_found`, `not_commissioner`, `not_a_member`.

| Function | Who | Behaviour | Returns / errors |
| --- | --- | --- | --- |
| `get_server_time()` | anon, authenticated | `now()` for the draft timer. | `timestamptz` |
| `create_league(p_name text, p_team_name text, p_max_coaches int, p_draft_format_id uuid = null, p_point_budget int = 100, p_picks_per_team int = 10, p_pick_timer_seconds int = 120, p_playoff_format text = 'top_4', p_tiebreaker text = 'head_to_head')` | authenticated | Validates ranges (name 1..60, team 1..40, coaches 2..24, budget 1..10000, picks 1..30, timer 10..3600), the two playoff settings (a null value means the default) and that the format is visible to the caller. Inserts the league (`commissioner_id = auth.uid()`), the commissioner member and one invite with a server-generated code. A chosen format is copied onto `custom_pool` at once (see `leagues.custom_pool`) after `_validate_pool` checks it like an `update_league_pool` pool; a format that breaks the rules is refused with the pool error codes and nothing is created. The playoffs migration drops the 7-parameter signature so exactly one exists. | `uuid`. `invalid_name`, `invalid_team_name`, `invalid_max_coaches`, `invalid_point_budget`, `invalid_picks_per_team`, `invalid_pick_timer`, `invalid_playoff_format`, `invalid_tiebreaker`, `format_not_found`, `invalid_pool`, `duplicate_pokemon`, `invalid_points`, `invalid_tier` |
| `get_invite_preview(p_code text)` | anon, authenticated | Case-insensitive lookup. Never raises; unknown codes return `invite_valid: false` with null fields. `invite_valid` is false when the code is unknown or expired. | `jsonb { league_id, league_name, coach_count, max_coaches, draft_started, draft_completed, already_member, invite_valid }` |
| `join_league(p_code text, p_team_name text)` | authenticated | Locks the league and the invite. Existing members get the league id back without a new row. Otherwise validates the team name and inserts a coach; increments `used_count`. | `uuid`. `invite_invalid`, `draft_already_started`, `league_full`, `invalid_team_name` |
| `regenerate_invite(p_league_id uuid)` | commissioner | New code, `used_count = 0`, `expires_at = null`, `max_uses = max_coaches - 1`; extra invite rows are removed (`_rotate_invite`, which `remove_member` also runs). | `text` (the code). `invite_generation_failed` |
| `rename_team(p_league_id uuid, p_team_name text)` | member | Trims and validates 1..40 chars, updates the caller's row. | void. `invalid_team_name` |
| `leave_league(p_league_id uuid)` | coach | Only before the draft starts; the commissioner cannot leave. | void. `commissioner_cannot_leave`, `draft_already_started` |
| `remove_member(p_league_id uuid, p_member_id uuid)` | commissioner | Only before the draft starts; never self. Deletes the member row, then rotates the league's invite code in the same transaction (`_rotate_invite`, exactly what `regenerate_invite` does), so the link the removed coach was invited with is dead the moment they are gone: `join_league` with it raises `invite_invalid` and `get_invite_preview` returns `invite_valid: false` with a null `league_id`, for the removed coach and for anyone they passed it to. The commissioner must copy and reshare the new link to whoever should still join (the removed coach included, if that is the intent); a refused call (`not_commissioner`, `member_not_found`, ...) leaves the invite as it was. | void. `draft_already_started`, `member_not_found`, `cannot_remove_self`, `invite_generation_failed` |
| `transfer_commissioner(p_league_id uuid, p_member_id uuid)` | commissioner | Sets `commissioner_id` to that member's user and re-syncs `role` on every row. | void. `member_not_found`, `already_commissioner` |
| `update_league_settings(p_league_id uuid, p_settings jsonb)` | commissioner | Keys: `name, max_coaches, point_budget, picks_per_team, pick_timer_seconds, free_agent_swap_limit, schedule_format, draft_format_id, playoff_format, tiebreaker`. Validates ranges; `max_coaches` may not drop below the member count. Once `draft_started`, changing `max_coaches`, `point_budget`, `picks_per_team` or `draft_format_id` raises `locked_during_draft` (sending the unchanged value is fine). `draft_format_id` only has to be visible to the caller when it changes: the league's current value is always accepted, so a settings form that echoes it back keeps working after `transfer_commissioner` even when the format is private to the previous commissioner (the new one reads it through league membership). Changing `draft_format_id` replaces `custom_pool` with a copy of the new format (`source: "format"`, checked by `_validate_pool`; a format that breaks the pool rules is refused and no setting changes), or clears it when the format is removed; an unchanged value leaves the pool alone. Keeps `league_invites.max_uses` in step. Playoff settings: echoing the current values is always fine; a change to `playoff_format` or `tiebreaker` raises `playoffs_started` once any playoff match is completed; once the draft has started a changed `top_N` needs at least N playing coaches (`not_enough_coaches`; before the draft any format is accepted since the coaches are not known yet); once the regular season is complete a change rebuilds the bracket (`_generate_playoffs`), or, with `playoff_format = 'none'`, deletes it and makes seed 1 the champion. A `tiebreaker` change on its own is held to nothing more than the last regular result was: in a league that cannot fill its unchanged format it is saved and the league stays without a bracket (a smaller format chosen here builds one), while a changed `top_N` still needs N playing coaches. The returned row reflects those changes. | the updated league row as `jsonb`. `invalid_settings`, `unknown_setting`, `invalid_name`, `invalid_max_coaches`, `max_coaches_below_members`, `invalid_point_budget`, `invalid_picks_per_team`, `invalid_pick_timer`, `invalid_swap_limit`, `invalid_schedule_format`, `invalid_playoff_format`, `invalid_tiebreaker`, `format_not_found`, `locked_during_draft`, `playoffs_started`, `not_enough_coaches`, `invalid_pool`, `duplicate_pokemon`, `invalid_points`, `invalid_tier` |
| `update_league_pool(p_league_id uuid, p_pool jsonb)` | commissioner | Only before the draft. `{ version?, leagueName?, pokemon: [{ name, points, tier? }] }`: 1..2000 entries, unique non-empty trimmed names (case-insensitive, max 80 chars), integer points 1..20 (a number or a string of digits), `tier` must equal `21 - points` when given (filled in otherwise). These rules live in `_validate_pool`, which the format copies use too. Stored normalized in `custom_pool` as `{ version: "1.0", leagueName, pokemon }` in the order given: the client's `version` is ignored and `leagueName` is trimmed and capped at 60 characters (blank -> the league name), so the row every coach downloads stays small. | void. `draft_already_started`, `invalid_pool`, `duplicate_pokemon`, `invalid_points`, `invalid_tier` |
| `reset_league_pool(p_league_id uuid)` | commissioner | Only before the draft. Copies the league's draft format onto `custom_pool` again, as the format is right now (the way to pick up edits made in the pool builder), checked by `_validate_pool`: an edit that breaks the pool rules is refused and the current pool stays. Without a format the pool becomes null. | void. `draft_already_started`, `invalid_pool`, `duplicate_pokemon`, `invalid_points`, `invalid_tier` |
| `set_draft_order(p_league_id uuid, p_member_ids uuid[])` | commissioner | Only before the draft. At least 2 ids, no duplicates, all in the league. Listed members get positions 1..n; unlisted members become spectators (`null`). One statement under the deferred unique constraint. | void. `draft_already_started`, `not_enough_coaches`, `duplicate_member`, `member_not_found` |
| `start_draft(p_league_id uuid)` | commissioner | Requires >= 2 positioned members, `pool size >= positioned * picks_per_team`, and `picks_per_team * min(points) <= point_budget`. The pool is `custom_pool` as configured (`draft_formats` is never read). Clears stale picks/teams, sets `draft_started`, `current_pick_number = 1`, `pick_started_at = now()`, un-pauses. | void. `draft_already_started`, `not_enough_coaches`, `pool_too_small`, `budget_too_small` |
| `make_pick(p_league_id uuid, p_pokemon_name text)` | coach on the clock | The caller's membership is checked right after the league lock, before any draft-state check, so a non-member only ever sees `not_a_member` and learns nothing about the draft. Points and tier come from the pool. Budget rule: `points <= remaining` and `remaining - points >= slots_left_after * min_pool_points`. Inserts the pick at `current_pick_number`, then advances the clock or finalizes on the last pick. | `jsonb { pick_number, pokemon_name, draft_completed }`. `draft_not_started`, `draft_completed`, `draft_paused`, `not_your_turn`, `pokemon_not_in_pool`, `pokemon_already_drafted`, `roster_full`, `over_budget` |
| `auto_pick_if_expired(p_league_id uuid)` | any member | If the draft is live, not paused and `now() >= pick_started_at + pick_timer_seconds`, drafts the best legal Pokémon (highest points, then name) for the coach on the clock; if nothing is legal the turn is skipped (empty slot). Idempotent under concurrency: the second caller sees the refreshed clock and returns `picked: false`. | `jsonb { picked, pokemon_name, skipped, draft_completed }` |
| `pause_draft(p_league_id uuid)` / `resume_draft(p_league_id uuid)` | commissioner | Pause records `draft_paused_at`; resume shifts `pick_started_at` forward by the paused duration, adds it to `draft_paused_total_seconds` and clears the pause. | void. `draft_not_started`, `draft_completed`, `already_paused`, `not_paused` |
| `undo_last_pick(p_league_id uuid)` | commissioner | Deletes the highest pick, sets `current_pick_number` to its number and restarts the clock. | `jsonb { pick_number, pokemon_name }`. `draft_not_started`, `draft_completed`, `no_picks` |
| `force_pick(p_league_id uuid, p_pokemon_name text)` | commissioner | Picks for the coach on the clock (same validation as `make_pick` without the turn check). `null` name = best available; if nothing is legal the turn is skipped. | `jsonb { pick_number, pokemon_name, draft_completed, skipped }`. As `make_pick` minus `not_your_turn` |
| `finalize_draft(p_league_id uuid)` | commissioner | Recovery entry point: requires every positioned member to have `picks_per_team` picks or the draft to have reached the last pick number. Refuses when the draft is already complete and teams exist. | void. `draft_not_started`, `draft_completed`, `not_enough_coaches`, `draft_incomplete` |
| `reset_draft(p_league_id uuid)` | commissioner | Deletes picks, teams, matches (the bracket included) and news; resets swap counts, every draft flag and `champion_member_id`. `custom_pool` is kept as it is, whether it was copied from a format or set with `update_league_pool` (`reset_league_pool` pulls a format's current list). | void |
| `swap_free_agent(p_league_id uuid, p_drop_name text, p_add_name text)` | member | Membership is checked before the draft state (as in `make_pick`), so a non-member only ever sees `not_a_member`. Requires `draft_completed`; locks the league and every team row. `p_drop_name = null` adds to an open slot. Writes the roster, increments `free_agent_swaps_used` and inserts the `free_agent` news row. | the news row as `jsonb`. `draft_not_completed`, `no_team`, `no_swaps_left`, `pokemon_not_in_pool`, `pokemon_owned`, `not_on_roster`, `roster_full`, `over_budget` |
| `undo_free_agent_move(p_news_id uuid)` | commissioner | The row must be the newest `free_agent` news for that team, the roster must still equal `metadata.after_pokemon`, and nothing in `before_pokemon` may be owned by another team. Restores roster and total, sets `free_agent_swaps_used` to `previous_free_agent_swaps_used`, deletes the news row. | void. `news_not_found`, `member_not_found`, `not_latest_move`, `no_team`, `invalid_news`, `roster_changed`, `pokemon_owned` |
| `generate_schedule(p_league_id uuid, p_format text, p_randomize bool, p_discard_results bool = false)` | commissioner | Requires `draft_completed` and >= 2 positioned members. With reported results (playoff results included), raises `results_exist` unless discarding, which also deletes `match_result` news. Updates `schedule_format`, regenerates the regular matches (Fisher-Yates shuffle when randomizing); the bracket, every `season` news row and `champion_member_id` go with the old schedule. | `integer` (matches created). `draft_not_completed`, `invalid_schedule_format`, `not_enough_coaches`, `results_exist` |
| `report_match_result(p_match_id uuid, p_winner_member_id uuid, p_winner_remaining int = null)` | commissioner | Winner must be home or away; `p_winner_remaining` is null or 1..12 (`invalid_score`). Re-reads the match under the league lock, so a schedule regenerated while the call waited for the lock raises `match_not_found` instead of writing a news row for a match that no longer exists. A playoff match with an empty slot raises `match_not_ready`; a regular match while any playoff match is completed raises `playoffs_started` (edit the playoff results first, or clear the bracket); a playoff match whose next match is already completed raises `later_round_decided`. Marks the match `completed`, stores the count, and replaces the match's `match_result` news row (the round name for playoff matches). After a regular result, when every regular match is now completed: builds (or rebuilds, reseeded) the bracket for a `top_N` format the league can fill, leaves the league without a bracket when it has fewer than N playing coaches (the result is still recorded; `generate_playoffs` then explains, and a smaller format chosen in Settings builds it), or, for `none`, makes seed 1 the champion. After a playoff result: fills the next match's `feeds_slot` with the winner and its seed, or, for the final, sets `champion_member_id` and inserts the `season` news "X won the championship." (re-reporting the final replaces both). The playoffs migration drops the 2-parameter signature. | void. `match_not_found`, `invalid_score`, `match_not_ready`, `playoffs_started`, `invalid_winner`, `later_round_decided` |
| `clear_match_result(p_match_id uuid)` | commissioner | Back to `upcoming`, winner and count cleared, the match's news deleted. Same re-read under the league lock as `report_match_result`. A regular match while any playoff match is completed raises `playoffs_started`; otherwise clearing a regular result deletes the bracket (the season is no longer complete), the `season` news and the champion. A playoff match whose next match is completed raises `later_round_decided`; otherwise its slot in the next match is emptied, and clearing the final clears `champion_member_id` and the championship news. | void. `match_not_found`, `playoffs_started`, `later_round_decided` |
| `league_standings(p_league_id uuid)` | member | The standings of [Standings and playoffs](#standings-and-playoffs) for a league the caller belongs to; fast enough for 24 coaches in a double round robin (one SQL statement). | `setof (member_id uuid, seed int, rank int, tied bool, wins int, losses int, played int, remaining int, win_pct numeric(3 decimals), differential int, strength_of_schedule numeric(3 decimals), head_to_head_applied bool)` ordered by `seed`. `league_not_found`, `not_a_member` |
| `generate_playoffs(p_league_id uuid)` | commissioner | Builds the bracket by hand, for a league that finished its regular season before the playoffs release (normally the last regular result builds it) or one that could not fill its format. Requires `draft_completed` (`draft_not_completed`), a format other than `none` (`no_playoffs`), every regular match completed (`regular_season_incomplete`), no completed playoff match (`playoffs_started`) and at least N playing coaches for `top_N` (`not_enough_coaches`). Replaces any existing bracket. | `integer` (playoff matches created). `draft_not_completed`, `no_playoffs`, `regular_season_incomplete`, `playoffs_started`, `not_enough_coaches` |
| `clear_playoffs(p_league_id uuid)` | commissioner | Deletes every playoff match, the `match_result` news of playoff matches, every `season` news row, and clears `champion_member_id`. Allowed with playoff results (the UI confirms first); the regular season is untouched. A league without playoffs has no bracket to remove and its champion is the top seed by rule, so with a complete regular season the call leaves seed 1 crowned (the same champion the data fix restores). | void |
| `is_league_member(p_league_id uuid)` | policies | `true` when the caller has a member row. Security definer so the `league_members` policy does not recurse. | `boolean` |

### Internal helpers

`_fail`, `_validate_pool` (the pool contract: validates a raw pokemon list the
way `update_league_pool` documents and returns the normalized entries, or
raises `invalid_pool` / `duplicate_pokemon` / `invalid_points` /
`invalid_tier` naming the first offending entry; used by `update_league_pool`,
`_format_pool` and the migration's format backfill, and created in section 2
of the migration ahead of that backfill), `_caller_uid`, `_lock_league`,
`_league_commissioner_check`, `_member_for`, `_validate_team_name`,
`_visible_format`, `_pool_rows` (a raw pokemon array as rows, for reading
`custom_pool`; lenient only for a list put on the row by hand: malformed
entries skipped, duplicate names collapse to the most expensive entry),
`_pool_json` (a league's pool as JSON: always `custom_pool`, never
`draft_formats`), `_league_pool` (the two combined), `_format_pool` (a format
as the `custom_pool` value that `create_league`, `update_league_settings` and
`reset_league_pool` store, after `_validate_pool`; a format that fails is
refused with the same code and a message naming the format),
`_positioned_members`, `_snake_member` (coach on the clock for a pick number),
`_budget_fits` (the pure budget rule), `_pick_legal` (that rule for one
candidate), `_best_available` (parses the pool once and applies the rule as a
SQL filter, so auto-picks on a 2000-entry pool take milliseconds, not seconds,
while the league row is locked), `_roster_total`,
`_schedule_rows` (circle-method round robin, identical to
`app/lib/league/schedule.ts`), `_new_invite_code`, `_create_invite`,
`_rotate_invite` (replaces a league's invite code in place: the newest invite
row keeps its id and gets a fresh code, `used_count = 0`, `expires_at = null`
and `max_uses` in step with the coach limit, extra rows are removed, and a
league without a row gets one through `_create_invite`; runs under the league
lock the caller holds, for `regenerate_invite` and `remove_member`),
`_setting_int`, `_advance_or_finalize`, `_finalize_draft` (materializes
`drafted_teams`, regenerates `league_matches`, sets `draft_completed`),
`_pick_internal`, and `_chat_message_defaults` (the `draft_chat_messages`
trigger function: plain `language plpgsql`, not security definer, since it
only rewrites `new.id` and `new.created_at`). `_migration_report` is the
operator-facing health check from
[Verifying the migration](#verifying-the-migration); like the other helpers it
has no API grants.

The playoffs migration adds `_playoff_size(format)` (coaches a format needs),
`_round_name(rounds_from_final)` (Final, Semifinals, Quarterfinals, else
"Round of N"), `_bracket_rows(format)` (the shapes of section 12.4 as rows:
`round_offset, match_number, home_seed, away_seed, feeds_round_offset,
feeds_match_number, feeds_slot`), `_league_standings(league_id)` (the
algorithm without the membership check, used by `league_standings`,
`_generate_playoffs`, `_crown_top_seed` and the data fix),
`_regular_season_complete`, `_playoffs_started`, `_last_regular_round`,
`_delete_playoffs` (playoff matches, their `match_result` news, every `season`
row and the champion), `_crown_top_seed` (seed 1 becomes the champion) and
`_generate_playoffs(league_id, strict)` (replaces the bracket, seeded from the
standings; with `strict` false a format the league cannot fill leaves it
without a bracket instead of raising `not_enough_coaches`).

### Standings and playoffs

`league_standings` (SQL) and `computeStandings` in `app/lib/league/standings.ts`
implement the same definition; `tests/db/playoffs.test.ts` runs both on
randomised fixtures and requires identical output. Only regular matches
(`stage = 'regular'`) that are `completed` with a winner count; a member with
no draft position who appears in no match is excluded.

1. Order by win percentage (wins / played, 0 when nothing played) descending,
   then wins descending.
2. Coaches still tied are ordered by the tiebreakers in this order: the
   league's `tiebreaker` first, then the other one, then strength of schedule,
   then the coin flip. Each tiebreaker is applied to the coaches that are
   still tied when it is reached (ties inside ties):
   - head-to-head: win percentage in the completed regular matches between
     the coaches of that tied group (0 for a coach who played none of them);
     higher first. Sub-groups still tied continue with the next tiebreaker.
   - differential: sum over completed regular matches of `+winner_remaining`
     for wins and `-winner_remaining` for losses (null counts 0); higher first.
   - strength of schedule: mean win percentage of the opponents faced in
     completed regular matches, one term per match (0 when none); higher first.
   - coin flip: `league_members.id` ascending, so seeding never changes
     between calls.
   Percentages (win, head-to-head, strength of schedule) are compared rounded
   to 3 decimals, half up, the precision the function returns and the table
   shows, so two coaches never differ only in a digit nobody sees: 10-17
   (.370) and 17-29 (.370) tie on percentage and wins decide, and two
   strength-of-schedule means that both print as .708 leave the coin flip to
   decide. `computeStandings` compares at the same 3 decimals
   (`roundPercentage`); `tests/db/playoffs.test.ts` holds both to those
   fixtures and to a mean that sits exactly on a boundary (0.3125 rounds up
   to .313 on both sides).
3. Output per coach: `seed` (1..n, always distinct), `rank` (shared by coaches
   separated only by the coin flip), `tied` (true for those coaches), `wins`,
   `losses`, `played`, `remaining` (regular matches without a decided result),
   `win_pct` and `strength_of_schedule` rounded to 3 decimals, `differential`,
   and `head_to_head_applied` (true for every coach of a head-to-head group
   whose records were not all equal, i.e. whose position depended on that
   comparison).

Brackets are single elimination, seeded from `league_standings`, higher seed
at home, no reseeding between rounds, built all at once with undecided slots
null. Playoff rounds are numbered after the last regular round, match numbers
restart at 1 per round, and round names come from the distance to the final
(the last playoff round is the Final, the one before it the Semifinals, the one
before that the Quarterfinals; the first round of a `top_6` bracket is the
Quarterfinals although it holds two matches, seeds 1 and 2 having a bye):

| Format | First round | Then |
| --- | --- | --- |
| `top_2` | Final: 1 v 2 | |
| `top_4` | Semifinals: M1 = 1 v 4, M2 = 2 v 3 | Final: winner M1 (home) v winner M2 |
| `top_6` | Quarterfinals: M1 = 4 v 5, M2 = 3 v 6 | Semifinals: M1 = 1 v winner QF1, M2 = 2 v winner QF2; Final: winner SF1 v winner SF2 |
| `top_8` | Quarterfinals: M1 = 1 v 8, M2 = 4 v 5, M3 = 3 v 6, M4 = 2 v 7 | Semifinals: M1 = winner QF1 v winner QF2, M2 = winner QF3 v winner QF4; Final |

`feeds_match_id` / `feeds_slot` point each match at the slot its winner fills
(the final has neither); `home_seed` / `away_seed` are filled for predetermined
slots at generation and for fed slots when the earlier match is reported. The
bracket is (re)built by the last regular result and by a change to
`playoff_format` or `tiebreaker` after the regular season, removed when a
regular result is cleared, by `clear_playoffs`, by `generate_schedule` and by
`reset_draft`. A league without playoffs (`none`) gets `champion_member_id =
seed 1` with the last regular result, keeps it through `clear_playoffs`
(there is no bracket to remove, and the champion comes from the rules) and
loses it when a result is cleared.

### Snake order and schedule

For `n` positioned members ordered by `draft_position`, pick `p` belongs to
index `(p - 1) mod n` in even rounds and `n - 1 - ((p - 1) mod n)` in odd
rounds (`round = (p - 1) div n`). The draft finalizes when the last pick number
(`n * picks_per_team`) is consumed, whether by a pick or a skipped turn.

The schedule appends a bye when `n` is odd, then for round `r` (0-based) pairs
index `i` with `n - 1 - i`, skipping byes, with home/away swapped on odd rounds,
and rotates all but the first entry between rounds. Double round robin appends
the mirrored rounds. Match numbers restart at 1 per round.

## Row level security

RLS is enabled on every table. Only these policies exist after the hardening
migration:

| Table | Policy |
| --- | --- |
| `leagues` | select: `is_league_member(id)`; delete: `commissioner_id = auth.uid()`. No insert/update. |
| `league_members` | select: `is_league_member(league_id)`. No writes. |
| `league_invites` | select: the league's commissioner. Joiners use `get_invite_preview` / `join_league`. |
| `draft_formats` | authenticated only. select: own rows (`created_by = auth.uid()`), shared rows (`created_by is null`), and the format that a league the caller belongs to points at (`leagues.draft_format_id` + `is_league_member`), so the app can show the format behind a league through the `leagues -> draft_formats` embed (the pool a league drafts from is `leagues.custom_pool`); insert with check `created_by = auth.uid()`; update/delete own rows (no league is affected: each league holds its own copy, see `leagues.custom_pool`). |
| `draft_picks`, `drafted_teams`, `league_matches`, `league_news` | select: `is_league_member(league_id)`. No writes. |
| `draft_chat_messages` | select: members; insert with check `user_id = auth.uid()` and a matching member row. `id` and `created_at` are overwritten by the `draft_chat_messages_defaults` trigger, so the client only chooses `league_id`, `member_id`, `user_id` and `message`. |
| `pokemon_dex`, `pokemon_forms` | select for `authenticated`. |
| `pokemon` | select for `authenticated` (`Signed-in users can read the dataset`, `using (true)`). No writes; the grants also revoke `insert`, `update` and `delete` from `authenticated` and everything from `anon`, so a client write fails with `42501` and an anon read too. Only `service_role` (the seed script) writes it. Created by the pool builder migration, which drops and recreates the policy on every run. |
| `draft_order` | none (inaccessible). |

The browser's only remaining direct writes are `draft_formats` (own rows),
`draft_chat_messages` inserts and `leagues` deletes. PostgREST reports an
update or delete that a policy filtered out as a success with zero rows, so
those calls should end with `.select().single()` (or check the returned
count) to turn a silent no-op into `PGRST116`, which `friendlyError()` shows as
"Nothing to update, you may not have permission.". Every other direct write to
`leagues`, `league_members`, `league_invites`, `draft_picks`, `drafted_teams`,
`league_matches` or `league_news`, every write to the read-only `pokemon`
table, and every call to a dropped or unknown RPC, is reported by
`node scripts/check-client-contract.mjs` (exit 1), the gate to run before
applying the hardening migration (see the README). The gate learns the
read-only tables from the same `Grants` sections as the RPC catalog: a bare
`'public.<table>'` entry, as in the pool builder file.

## Realtime

`supabase_realtime` publishes `draft_chat_messages`, `draft_picks`, `leagues`,
`league_members`, `league_matches`, `league_news` and `drafted_teams` (each
added only if the publication exists and does not already contain it).

## Storage

A public bucket `sprites` with the policy `Public read access to sprites`
(`select` on `storage.objects` where `bucket_id = 'sprites'`). Files are named
`<dex_number>.png`. Both steps are skipped with a warning when the `storage`
schema is absent or the role lacks privileges; create the bucket from the
dashboard in that case.

## Seeding

`.env.scripts` needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (see
`.env.example`). Run in this order:

1. `npm run seed:dex` - fetches species 1..1025 from PokeAPI (retrying with
   backoff) and upserts `{ dex_number, name }` on `dex_number`. `POKEDEX_MAX`
   limits the range.
2. Upload `<dex>.png` files to the `sprites` bucket.
3. `npm run seed:sprites` - lists the bucket and writes `sprite_url` only for
   files that exist.
4. `npm run seed:types` - fills `type1`/`type2` for rows where `type1` is null,
   resolving each species by dex number through `/pokemon-species/{dex}` and its
   default variety.
5. `npm run seed:pokemon` - loads `data/pokemon/pokemon.json` into
   [`pokemon`](#pokemon) once `20260916120000_pool_builder.sql` is applied:
   validates every row (columns, form kinds, tags, stat and generation
   ranges, unique ids, slugs and display names), parks the rows in the table
   whose `slug` or `display_name` the file gives to a different `id` (their
   two names become `~<id>` until the upsert overwrites them or the stale
   delete removes them; a swap or a move between ids would otherwise fail the
   unique constraints row by row with `23505`, whatever the batch order),
   upserts on `id` in batches of 500 with `updated_at` set to the run, deletes
   the rows whose `id` is not in the file, prints the counts and exits 1 on
   any error. The file itself comes
   from `npm run data:pokemon` (`scripts/build-pokemon-data.mjs`, the PokéAPI
   crawl and the Serebii regulation pages; `-- --refresh-serebii` re-fetches
   the latter) and is committed, so a data refresh is a reviewed diff plus a
   seed run. Like the other seed scripts it reads `.env.scripts` only.

All reads page with `.range()` until exhausted.

## Tests

`npm run test:db` boots an embedded Postgres (`tests/db/global-setup.ts`),
creates Supabase-like scaffolding (roles, `auth.uid()`, the publication, a stub
`storage` schema, default grants), applies every migration in order and runs
the suites in `tests/db/*.test.ts`: fresh apply + idempotency, the RLS matrix,
every function's happy path and error codes, snake order and finalization,
schedule parity with `app/lib/league/schedule.ts`, and the concurrency cases
(two joins for the last seat, two swaps for one free agent, auto-pick from two
clients, undo after a newer move), the security probes (`security.test.ts`),
timing regressions for `_best_available` on 2000-entry pools, the
format-ownership regressions (`security-attack-r3.test.ts`: a former
commissioner who still owns the format cannot touch the league's pool, and a
chat insert cannot choose its `id` or `created_at`), the authorization
probes (`security-authz-review.test.ts`: authority after
`transfer_commissioner`, `remove_member` rotating the invite code so the
removed coach's link is dead, the commissioner's direct write paths, an
outsider armed with a league id), the outsider probe on the member RPCs
(`security-attack-r4.test.ts`: `make_pick` and `swap_free_agent` answer a
non-member with `not_a_member` in every draft state), the
format-copy validation (`security-attack-r4.test.ts`,
`review-r4-correctness.test.ts`: a format that `update_league_pool` would
refuse is refused by `create_league`, `update_league_settings` and
`reset_league_pool` with the same code, the 2000-entry cap holds, and
`draft_formats` rejects oversized names and bodies without a pokemon array),
a live-like apply (`live-simulation.test.ts`: dirty data, legacy functions and
policies, format-based leagues without a pool copy including one whose format
breaks the pool rules, a non-superuser owner) that checks the
`_migration_report` output and that re-running the file copies a fixed format,
the re-run hazard (`review-applyability.test.ts`: an older file re-run after
the hardening brings the legacy policies back until the hardening runs again,
and the hardening re-run alone leaves an ambiguous `create_league` until the
playoffs file follows it), the playoffs feature (`playoffs.test.ts`: the
bracket shape of every format, automatic generation on the last regular
result, advancement and `later_round_decided`, `match_not_ready`, the champion
for every format including `none`, the playoff settings (a tiebreaker change
in a league that cannot fill its format included), `clear_playoffs`,
`generate_schedule` / `reset_draft` clearing the champion, `winner_remaining`
validation, permissions, the migration's data fix, the standings algorithm on
hand-made ties inside ties, its speed on a 24-coach double round robin, the
3-decimal comparison precision it shares with `computeStandings` (two
collisions and an exact rounding boundary), and the SQL/TypeScript parity of
the two on 200 random fixtures per tiebreaker setting),
the Pool Builder v2 dataset (`pool-builder.test.ts`: the pool builder file
sorts last and applies on a fresh database after the hardening and playoffs
files, twice, and again after those two are re-run; every column of `pokemon`,
the generated `bst`, the unique and check constraints, the four indexes, RLS
and the read-only grants; the committed `data/pokemon/pokemon.json` inserts
cleanly with `bst` equal to the six stats for every row, a case that is
skipped by name while the file is not generated yet; anon cannot read the
table, signed-in users can, neither can write it and the service role can;
`_migration_report()` lists a missing `pokemon` unique constraint and a re-run
adds it back; and `draft_formats.json` accepts a `rules` key while
`_format_pool` and `update_league_pool` still copy only `{ name, points, tier }`),
and the client contract (`client-contract.test.ts`: the RPC names the release
gate `scripts/check-client-contract.mjs` accepts are exactly the functions
granted to the API roles, the read-only tables it knows are exactly the tables
`authenticated` may select but never write (`pokemon`), its scanner catches the
call shapes the pre-hardening client used and a write to a read-only table,
every wrapper in `app/lib/rpc.ts` names a catalog function, and the gate
passes on the working tree, so `npm run test:db` fails while the client still
uses a dropped RPC or a direct write; the catalog and the read-only tables are
the union of every migration's `Grants` section). `exit-code.test.ts`
runs a failing one-file suite through the same global setup in a child process
and checks that vitest exits 1: `embedded-postgres` registers an exit hook on
import that used to end the process with status 0 after a failed run, and the
global setup removes it once the server is stopped.
