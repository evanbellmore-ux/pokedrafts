# PokeDrafts database schema

Generated from `supabase/migrations`. The migrations are the source of truth;
this document describes what they produce. Apply them in filename order:

| File | Purpose |
| --- | --- |
| `00000000000000_base_schema.sql` | Every table, `create table if not exists`. Matches the live project; a no-op there. |
| `20260626163000` .. `20260718120000` | The eight incremental migrations from earlier releases (chat, schedule format, cascades, swap limits, news, legacy policies). |
| `20260909120000_release_hardening.sql` | Columns, data fixes, constraints, indexes, realtime, storage, the RPC catalog, and the complete RLS policy set. Idempotent. |

The hardening migration drops **every** policy on the application tables and
recreates the set in [Row level security](#row-level-security), and drops the
legacy `start_draft_timer`, `advance_draft_timer` and `complete_draft_timer`
functions. The browser never writes directly to `leagues`, `league_members`,
`league_invites`, `draft_picks`, `drafted_teams`, `league_matches` or
`league_news`; all mutations go through the functions below.

`20260909120000_release_hardening.sql` must always be
**the last migration file to run**. The eight older files recreate the
pre-release write policies (among them an unrestricted `league_members` update
for coaches and a `leagues` delete that trusts `league_members.role`), and only
the hardening file removes them again; with the older policies back, a coach in
a finished league can make themselves commissioner and delete the league. If
any older file is ever run after the hardening file, for any reason, re-run the
hardening file afterwards. The README explains how to record hand-applied files
with `supabase migration repair` without letting `db push` do that.

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
| `json` | jsonb | not null, `{ version, leagueName, pokemon: [{ name, points, tier }] }`; check: an object whose `pokemon` is an array of at most 2000 entries (the shape the pool builder writes; the entry-level rules are applied by `_validate_pool` when a league copies the format) |
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

Index on `(draft_format_id)`, used by the `draft_formats` select policy.

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
| `home_member_id` | uuid | not null, fk `league_members(id)` on delete cascade |
| `away_member_id` | uuid | not null, fk `league_members(id)` on delete cascade |
| `status` | text | not null, default `upcoming`, check in (`upcoming`, `completed`) |
| `winner_member_id` | uuid | fk `league_members(id)` on delete set null |
| `scheduled_at` | timestamptz | unused |
| `created_at` | timestamptz | not null, `now()` |

Unique `(league_id, round_number, match_number)`; index on `(league_id)`.

### `league_news`

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | uuid | pk |
| `league_id` | uuid | not null, fk `leagues(id)` on delete cascade |
| `member_id` | uuid | fk `league_members(id)` on delete set null |
| `news_type` | text | not null, check in (`free_agent`, `match_result`) |
| `message` | text | not null, check length 1..500 |
| `metadata` | jsonb | not null, default `{}` |
| `created_at` | timestamptz | not null, `now()` |

Index on `(league_id, created_at desc)`. Metadata shapes:

- `free_agent`: `{ added, dropped, team_id, before_pokemon, after_pokemon, previous_free_agent_swaps_used, next_free_agent_swaps_used }`
- `match_result`: `{ match_id, winner_member_id, loser_member_id, round_number, match_number }` (one row per match; re-reporting replaces it)

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

## Verifying the migration

The hardening migration ends with `select * from public._migration_report();`,
so the Supabase SQL editor shows the report as the result of running the file.
Run it again at any time as the database owner (it is revoked from `anon` and
`authenticated`). It returns one row per open item with `severity`, `item`,
`detail` and `action`, and **no rows when there is nothing to fix**:

| Item | Why | Action |
| --- | --- | --- |
| `constraint <name> on <table>` | a check constraint was added `not valid` because existing rows violate it | fix the rows, then `alter table <table> validate constraint <name>;` |
| `unique (<cols>) on <table>` | duplicates exist, so the unique constraint was skipped | remove the duplicates, then re-run the hardening migration |
| `realtime: <table>` | not in the `supabase_realtime` publication | Database > Replication, or `alter publication supabase_realtime add table ...` |
| `storage: ...` | the `sprites` bucket or its read policy is missing (or could not be inspected by this role) | create the public bucket / policy from the dashboard |
| `league <id> (<name>)`, warning | the league started (or finished) its draft but has no pool, so no pick or free-agent pickup is possible: its draft format was deleted before the migration could copy it onto the league, or the format breaks the pool rules (the detail quotes the offending entry) | fix the format and re-run the hardening migration (it copies the format then), or put the list back on `custom_pool` with the statement in the action, or have the commissioner run `reset_draft` and choose a pool again |
| `league <id> (<name>)`, info | the league has not started and has no pool because its draft format breaks the pool rules, so the draft cannot start | fix the format, then have the commissioner use "Reset to format" on the Pool page (`reset_league_pool`) or set a pool there |

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
| `create_league(p_name text, p_team_name text, p_max_coaches int, p_draft_format_id uuid = null, p_point_budget int = 100, p_picks_per_team int = 10, p_pick_timer_seconds int = 120)` | authenticated | Validates ranges (name 1..60, team 1..40, coaches 2..24, budget 1..10000, picks 1..30, timer 10..3600) and that the format is visible to the caller. Inserts the league (`commissioner_id = auth.uid()`), the commissioner member and one invite with a server-generated code. A chosen format is copied onto `custom_pool` at once (see `leagues.custom_pool`) after `_validate_pool` checks it like an `update_league_pool` pool; a format that breaks the rules is refused with the pool error codes and nothing is created. | `uuid`. `invalid_name`, `invalid_team_name`, `invalid_max_coaches`, `invalid_point_budget`, `invalid_picks_per_team`, `invalid_pick_timer`, `format_not_found`, `invalid_pool`, `duplicate_pokemon`, `invalid_points`, `invalid_tier` |
| `get_invite_preview(p_code text)` | anon, authenticated | Case-insensitive lookup. Never raises; unknown codes return `invite_valid: false` with null fields. `invite_valid` is false when the code is unknown or expired. | `jsonb { league_id, league_name, coach_count, max_coaches, draft_started, draft_completed, already_member, invite_valid }` |
| `join_league(p_code text, p_team_name text)` | authenticated | Locks the league and the invite. Existing members get the league id back without a new row. Otherwise validates the team name and inserts a coach; increments `used_count`. | `uuid`. `invite_invalid`, `draft_already_started`, `league_full`, `invalid_team_name` |
| `regenerate_invite(p_league_id uuid)` | commissioner | New code, `used_count = 0`, `expires_at = null`, `max_uses = max_coaches - 1`; extra invite rows are removed (`_rotate_invite`, which `remove_member` also runs). | `text` (the code). `invite_generation_failed` |
| `rename_team(p_league_id uuid, p_team_name text)` | member | Trims and validates 1..40 chars, updates the caller's row. | void. `invalid_team_name` |
| `leave_league(p_league_id uuid)` | coach | Only before the draft starts; the commissioner cannot leave. | void. `commissioner_cannot_leave`, `draft_already_started` |
| `remove_member(p_league_id uuid, p_member_id uuid)` | commissioner | Only before the draft starts; never self. Deletes the member row, then rotates the league's invite code in the same transaction (`_rotate_invite`, exactly what `regenerate_invite` does), so the link the removed coach was invited with is dead the moment they are gone: `join_league` with it raises `invite_invalid` and `get_invite_preview` returns `invite_valid: false` with a null `league_id`, for the removed coach and for anyone they passed it to. The commissioner must copy and reshare the new link to whoever should still join (the removed coach included, if that is the intent); a refused call (`not_commissioner`, `member_not_found`, ...) leaves the invite as it was. | void. `draft_already_started`, `member_not_found`, `cannot_remove_self`, `invite_generation_failed` |
| `transfer_commissioner(p_league_id uuid, p_member_id uuid)` | commissioner | Sets `commissioner_id` to that member's user and re-syncs `role` on every row. | void. `member_not_found`, `already_commissioner` |
| `update_league_settings(p_league_id uuid, p_settings jsonb)` | commissioner | Keys: `name, max_coaches, point_budget, picks_per_team, pick_timer_seconds, free_agent_swap_limit, schedule_format, draft_format_id`. Validates ranges; `max_coaches` may not drop below the member count. Once `draft_started`, changing `max_coaches`, `point_budget`, `picks_per_team` or `draft_format_id` raises `locked_during_draft` (sending the unchanged value is fine). `draft_format_id` only has to be visible to the caller when it changes: the league's current value is always accepted, so a settings form that echoes it back keeps working after `transfer_commissioner` even when the format is private to the previous commissioner (the new one reads it through league membership). Changing `draft_format_id` replaces `custom_pool` with a copy of the new format (`source: "format"`, checked by `_validate_pool`; a format that breaks the pool rules is refused and no setting changes), or clears it when the format is removed; an unchanged value leaves the pool alone. Keeps `league_invites.max_uses` in step. | the updated league row as `jsonb`. `invalid_settings`, `unknown_setting`, `invalid_name`, `invalid_max_coaches`, `max_coaches_below_members`, `invalid_point_budget`, `invalid_picks_per_team`, `invalid_pick_timer`, `invalid_swap_limit`, `invalid_schedule_format`, `format_not_found`, `locked_during_draft`, `invalid_pool`, `duplicate_pokemon`, `invalid_points`, `invalid_tier` |
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
| `reset_draft(p_league_id uuid)` | commissioner | Deletes picks, teams, matches and news; resets swap counts and every draft flag. `custom_pool` is kept as it is, whether it was copied from a format or set with `update_league_pool` (`reset_league_pool` pulls a format's current list). | void |
| `swap_free_agent(p_league_id uuid, p_drop_name text, p_add_name text)` | member | Membership is checked before the draft state (as in `make_pick`), so a non-member only ever sees `not_a_member`. Requires `draft_completed`; locks the league and every team row. `p_drop_name = null` adds to an open slot. Writes the roster, increments `free_agent_swaps_used` and inserts the `free_agent` news row. | the news row as `jsonb`. `draft_not_completed`, `no_team`, `no_swaps_left`, `pokemon_not_in_pool`, `pokemon_owned`, `not_on_roster`, `roster_full`, `over_budget` |
| `undo_free_agent_move(p_news_id uuid)` | commissioner | The row must be the newest `free_agent` news for that team, the roster must still equal `metadata.after_pokemon`, and nothing in `before_pokemon` may be owned by another team. Restores roster and total, sets `free_agent_swaps_used` to `previous_free_agent_swaps_used`, deletes the news row. | void. `news_not_found`, `member_not_found`, `not_latest_move`, `no_team`, `invalid_news`, `roster_changed`, `pokemon_owned` |
| `generate_schedule(p_league_id uuid, p_format text, p_randomize bool, p_discard_results bool = false)` | commissioner | Requires `draft_completed` and >= 2 positioned members. With reported results, raises `results_exist` unless discarding, which also deletes `match_result` news. Updates `schedule_format`, regenerates matches (Fisher-Yates shuffle when randomizing). | `integer` (matches created). `draft_not_completed`, `invalid_schedule_format`, `not_enough_coaches`, `results_exist` |
| `report_match_result(p_match_id uuid, p_winner_member_id uuid)` | commissioner | Winner must be home or away. Re-reads the match under the league lock, so a schedule regenerated while the call waited for the lock raises `match_not_found` instead of writing a news row for a match that no longer exists. Marks the match `completed` and replaces the match's `match_result` news row. | void. `match_not_found`, `invalid_winner` |
| `clear_match_result(p_match_id uuid)` | commissioner | Back to `upcoming`, winner cleared, the match's news deleted. Same re-read under the league lock as `report_match_result`. | void. `match_not_found` |
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
| `draft_order` | none (inaccessible). |

The browser's only remaining direct writes are `draft_formats` (own rows),
`draft_chat_messages` inserts and `leagues` deletes. PostgREST reports an
update or delete that a policy filtered out as a success with zero rows, so
those calls should end with `.select().single()` (or check the returned
count) to turn a silent no-op into `PGRST116`, which `friendlyError()` shows as
"Nothing to update, you may not have permission.". Every other direct write to
`leagues`, `league_members`, `league_invites`, `draft_picks`, `drafted_teams`,
`league_matches` or `league_news`, and every call to a dropped or unknown RPC,
is reported by `node scripts/check-client-contract.mjs` (exit 1), the gate to
run before applying the hardening migration (see the README).

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
the hardening brings the legacy policies back until the hardening runs again),
and the client contract (`client-contract.test.ts`: the RPC names the release
gate `scripts/check-client-contract.mjs` accepts are exactly the functions
granted to the API roles, its scanner catches the call shapes the
pre-hardening client used, every wrapper in `app/lib/rpc.ts` names a catalog
function, and the gate passes on the working tree, so `npm run test:db` fails
while the client still uses a dropped RPC or a direct write). `exit-code.test.ts`
runs a failing one-file suite through the same global setup in a child process
and checks that vitest exits 1: `embedded-postgres` registers an exit hook on
import that used to end the process with status 0 after a failed run, and the
global setup removes it once the server is stopped.
