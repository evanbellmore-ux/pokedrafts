# Supabase Schema Notes

PokeDrafts expects Supabase Auth plus the tables, storage bucket, and RPCs below. This is a working contract for the app code; keep it in sync with migrations or dashboard changes.

SQL setup files live in `supabase/migrations/`. Apply `20260626163000_create_draft_chat_messages.sql` before using draft-room chat and `20260626170000_add_league_schedule_format.sql` before using matchup format automation.

## Tables

### `pokemon_dex`

- `dex_number` number, unique
- `name` text
- `sprite_url` text, nullable

Used by the builder and sprite components as the local Pokemon sprite/name source.

### `draft_formats`

- `id` uuid
- `name` text
- `json` jsonb

`json` should match:

```json
{
  "version": "1.0",
  "leagueName": "League Name",
  "pokemon": [
    { "name": "pokemon-name", "points": 10, "tier": 11 }
  ]
}
```

### `leagues`

- `id` uuid
- `name` text
- `max_coaches` number
- `commissioner_id` uuid, references auth user id
- `draft_format_id` uuid, nullable
- `custom_pool` jsonb, nullable
- `point_budget` number
- `picks_per_team` number
- `pick_timer_seconds` number
- `draft_started` boolean
- `draft_completed` boolean
- `current_pick_number` number
- `pick_started_at` timestamp, nullable
- `auto_pick_in_progress` boolean
- `schedule_format` text, expected values `round_robin` or `double_round_robin`

### `league_members`

- `id` uuid
- `league_id` uuid
- `user_id` uuid, references auth user id
- `role` text, expected values `commissioner` or `coach`
- `team_name` text
- `draft_position` number, nullable

### `league_invites`

- `id` uuid
- `league_id` uuid
- `invite_code` text, unique
- `max_uses` number
- `used_count` number

### `draft_picks`

- `id` uuid
- `league_id` uuid
- `member_id` uuid
- `pokemon_name` text
- `points` number
- `tier` number
- `pick_number` number

Recommended unique constraints:

- `(league_id, pokemon_name)`
- `(league_id, pick_number)`

### `drafted_teams`

- `id` uuid
- `league_id` uuid
- `member_id` uuid
- `pokemon` jsonb
- `total_points` number

Recommended unique constraint:

- `(league_id, member_id)`

### `draft_chat_messages`

- `id` uuid
- `league_id` uuid
- `member_id` uuid
- `user_id` uuid, references auth user id
- `message` text
- `created_at` timestamp

Used by the draft room chat. The UI loads the latest 100 messages by `created_at` and subscribes to realtime inserts for the active league.

### `league_matches`

- `id` uuid
- `league_id` uuid
- `round_number` number
- `match_number` number
- `home_member_id` uuid
- `away_member_id` uuid
- `status` text
- `winner_member_id` uuid, nullable
- `scheduled_at` timestamp, nullable

Draft completion auto-generates `league_matches` from the league's `schedule_format`. Commissioners can still change the matchup format on the Matches page and regenerate the schedule.

## RPCs

### `get_server_time()`

Returns the current database/server timestamp. The draft room uses this to align the client timer.

### `start_draft_timer(target_league_id uuid)`

Starts the draft and sets the first pick timer state.

Expected effects:

- `draft_started = true`
- `draft_completed = false`
- `current_pick_number = 1`
- `pick_started_at = now()`
- `auto_pick_in_progress = false`

### `advance_draft_timer(target_league_id uuid, next_pick number)`

Advances the draft to the next pick.

Expected effects:

- `current_pick_number = next_pick`
- `pick_started_at = now()`
- `auto_pick_in_progress = false`

### `complete_draft_timer(target_league_id uuid, final_pick number)`

Marks the draft complete after the final pick.

Expected effects:

- `draft_completed = true`
- `current_pick_number = final_pick`
- `auto_pick_in_progress = false`

## Authorization Expectations

The app now guards commissioner-only actions in the client before writes, but Supabase RLS should still enforce the real permissions.

Recommended policy intent:

- League members can read their own leagues, league members, pools, picks, finalized teams, and matches.
- League members can read and insert chat messages for leagues they belong to.
- Commissioners can update their leagues, custom pools, draft order, draft settings, match schedules, and draft start state.
- Coaches can insert a draft pick only when they are the current drafting member and the draft is active.
- Invites should not allow joins past `max_uses` or `max_coaches`.
