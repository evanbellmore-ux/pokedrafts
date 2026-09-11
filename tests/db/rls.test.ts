import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  buildLeague,
  connect,
  count,
  createUser,
  expectSqlState,
  memberFor,
  rpc,
  runFullDraft,
  type Client,
  type LeagueFixture,
} from "./harness";

const LEAGUE_TABLES = [
  "leagues",
  "league_members",
  "league_invites",
  "draft_picks",
  "drafted_teams",
  "league_matches",
  "league_news",
  "draft_chat_messages",
  "draft_order",
];

describe("row level security", () => {
  let db: Client;
  let league: LeagueFixture;
  let outsider: string;

  beforeAll(async () => {
    db = await connect();
    league = await buildLeague(db, { coaches: 2, picksPerTeam: 2 });
    outsider = await createUser(db);
    await runFullDraft(db, league);
    await db.query("insert into public.pokemon_dex (dex_number, name, type1) values (99001, 'Testmon', 'normal') on conflict (dex_number) do nothing");
    await db.query("insert into public.pokemon_forms (id, name) values (99001, 'Testmon-Form') on conflict (id) do nothing");
    await db.query("insert into public.draft_order (league_id, member_id, pick_slot) values ($1, $2, 1)", [
      league.leagueId,
      league.commissioner.memberId,
    ]);
  });

  afterAll(async () => {
    await db.end();
  });

  it("anon reads nothing from any league table, the dex or formats", async () => {
    for (const table of [...LEAGUE_TABLES, "pokemon_dex", "pokemon_forms", "draft_formats"]) {
      const n = await asAnon(db, (c) => count(c, table, "true"));
      expect(n, `anon should see no ${table} rows`).toBe(0);
    }
  });

  it("anon cannot execute the authenticated API", async () => {
    await expectSqlState(
      asAnon(db, (c) => rpc(c, "create_league", { p_name: "x", p_team_name: "y", p_max_coaches: 4 })),
      "42501",
    );
    const time = await asAnon(db, (c) => rpc<string>(c, "get_server_time"));
    expect(new Date(time).getTime()).toBeGreaterThan(0);
  });

  it("a non-member cannot read a league or its members", async () => {
    const leagues = await asUser(db, outsider, (c) => count(c, "leagues", "id = $1", [league.leagueId]));
    const members = await asUser(db, outsider, (c) => count(c, "league_members", "league_id = $1", [league.leagueId]));
    const picks = await asUser(db, outsider, (c) => count(c, "draft_picks", "league_id = $1", [league.leagueId]));
    const teams = await asUser(db, outsider, (c) => count(c, "drafted_teams", "league_id = $1", [league.leagueId]));
    const matches = await asUser(db, outsider, (c) => count(c, "league_matches", "league_id = $1", [league.leagueId]));
    expect([leagues, members, picks, teams, matches]).toEqual([0, 0, 0, 0, 0]);
  });

  it("a member can read the league, every coach, picks, teams and matches", async () => {
    const coach = league.coaches[0].userId;
    const leagues = await asUser(db, coach, (c) => count(c, "leagues", "id = $1", [league.leagueId]));
    const members = await asUser(db, coach, (c) => count(c, "league_members", "league_id = $1", [league.leagueId]));
    const picks = await asUser(db, coach, (c) => count(c, "draft_picks", "league_id = $1", [league.leagueId]));
    const teams = await asUser(db, coach, (c) => count(c, "drafted_teams", "league_id = $1", [league.leagueId]));
    const matches = await asUser(db, coach, (c) => count(c, "league_matches", "league_id = $1", [league.leagueId]));
    expect(leagues).toBe(1);
    expect(members).toBe(3);
    expect(picks).toBe(6);
    expect(teams).toBe(3);
    expect(matches).toBe(3);
  });

  it("a coach cannot update role, draft_position or free_agent_swaps_used", async () => {
    const coach = league.coaches[0];
    const before = await memberFor(db, league.leagueId, coach.userId);
    for (const assignment of ["role = 'commissioner'", "draft_position = 99", "free_agent_swaps_used = 0", "team_name = 'Hacked'"]) {
      const result = await asUser(db, coach.userId, (c) =>
        c.query(`update public.league_members set ${assignment} where id = $1`, [coach.memberId]),
      );
      expect(result.rowCount, `update "${assignment}" should affect no rows`).toBe(0);
    }
    const after = await memberFor(db, league.leagueId, coach.userId);
    expect(after).toEqual(before);
  });

  it("a coach cannot insert draft_picks or update leagues directly", async () => {
    const coach = league.coaches[0];
    await expectSqlState(
      asUser(db, coach.userId, (c) =>
        c.query(
          "insert into public.draft_picks (league_id, member_id, pokemon_name, points, tier, pick_number) values ($1, $2, 'Hack', 1, 20, 999)",
          [league.leagueId, coach.memberId],
        ),
      ),
      "42501",
    );
    const update = await asUser(db, coach.userId, (c) =>
      c.query("update public.leagues set point_budget = 9999 where id = $1", [league.leagueId]),
    );
    expect(update.rowCount).toBe(0);
    const commissionerUpdate = await asUser(db, league.commissioner.userId, (c) =>
      c.query("update public.leagues set point_budget = 9999 where id = $1", [league.leagueId]),
    );
    expect(commissionerUpdate.rowCount).toBe(0);
    const { rows } = await db.query("select point_budget from public.leagues where id = $1", [league.leagueId]);
    expect(rows[0].point_budget).toBe(100);
  });

  it("only the commissioner can read invites", async () => {
    const asCoach = await asUser(db, league.coaches[0].userId, (c) => count(c, "league_invites", "league_id = $1", [league.leagueId]));
    const asCommissioner = await asUser(db, league.commissioner.userId, (c) => count(c, "league_invites", "league_id = $1", [league.leagueId]));
    expect(asCoach).toBe(0);
    expect(asCommissioner).toBe(1);
  });

  it("draft_order is inaccessible even to members", async () => {
    const n = await asUser(db, league.commissioner.userId, (c) => count(c, "draft_order", "league_id = $1", [league.leagueId]));
    expect(n).toBe(0);
  });

  it("pokemon_dex and pokemon_forms are readable by authenticated users only", async () => {
    const dex = await asUser(db, outsider, (c) => count(c, "pokemon_dex", "dex_number = 99001"));
    const forms = await asUser(db, outsider, (c) => count(c, "pokemon_forms", "id = 99001"));
    expect(dex).toBe(1);
    expect(forms).toBe(1);
    const anonDex = await asAnon(db, (c) => count(c, "pokemon_dex", "dex_number = 99001"));
    expect(anonDex).toBe(0);
    const write = await asUser(db, outsider, (c) => c.query("update public.pokemon_dex set name = 'x' where dex_number = 99001"));
    expect(write.rowCount).toBe(0);
  });

  it("draft_formats: owners see and edit their own; shared (unowned) rows are visible to all", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const inserted = await asUser(db, alice, (c) =>
      c.query<{ id: string; created_by: string }>(
        "insert into public.draft_formats (name, json) values ('Alice format', '{\"pokemon\": []}') returning id, created_by",
      ),
    );
    const formatId = inserted.rows[0].id;
    expect(inserted.rows[0].created_by).toBe(alice);

    await expectSqlState(
      asUser(db, bob, (c) =>
        c.query("insert into public.draft_formats (name, json, created_by) values ('Spoof', '{}', $1)", [alice]),
      ),
      "42501",
    );

    const aliceSees = await asUser(db, alice, (c) => count(c, "draft_formats", "id = $1", [formatId]));
    const bobSees = await asUser(db, bob, (c) => count(c, "draft_formats", "id = $1", [formatId]));
    expect(aliceSees).toBe(1);
    expect(bobSees).toBe(0);

    const bobUpdate = await asUser(db, bob, (c) => c.query("update public.draft_formats set name = 'Stolen' where id = $1", [formatId]));
    const bobDelete = await asUser(db, bob, (c) => c.query("delete from public.draft_formats where id = $1", [formatId]));
    expect(bobUpdate.rowCount).toBe(0);
    expect(bobDelete.rowCount).toBe(0);

    const aliceUpdate = await asUser(db, alice, (c) => c.query("update public.draft_formats set name = 'Renamed' where id = $1", [formatId]));
    expect(aliceUpdate.rowCount).toBe(1);
    await expectSqlState(
      asUser(db, alice, (c) => c.query("update public.draft_formats set created_by = $1 where id = $2", [bob, formatId])),
      "42501",
    );

    const sharedName = `Shared ${randomUUID()}`;
    await db.query("insert into public.draft_formats (name, json, created_by) values ($1, '{\"pokemon\": []}', null)", [sharedName]);
    const sharedForBob = await asUser(db, bob, (c) => count(c, "draft_formats", "name = $1", [sharedName]));
    expect(sharedForBob).toBe(1);
    const sharedForAnon = await asAnon(db, (c) => count(c, "draft_formats", "name = $1", [sharedName]));
    expect(sharedForAnon).toBe(0);

    const aliceDelete = await asUser(db, alice, (c) => c.query("delete from public.draft_formats where id = $1", [formatId]));
    expect(aliceDelete.rowCount).toBe(1);
  });

  it("commissioner can delete their league and the cascade removes every child row", async () => {
    const doomed = await buildLeague(db, { coaches: 2, picksPerTeam: 2 });
    await runFullDraft(db, doomed);
    await db.query(
      "insert into public.draft_chat_messages (league_id, member_id, user_id, message) values ($1, $2, $3, 'hi')",
      [doomed.leagueId, doomed.commissioner.memberId, doomed.commissioner.userId],
    );

    const coachDelete = await asUser(db, doomed.coaches[0].userId, (c) => c.query("delete from public.leagues where id = $1", [doomed.leagueId]));
    expect(coachDelete.rowCount).toBe(0);

    const deleted = await asUser(db, doomed.commissioner.userId, (c) => c.query("delete from public.leagues where id = $1", [doomed.leagueId]));
    expect(deleted.rowCount).toBe(1);

    for (const table of LEAGUE_TABLES) {
      const n = await count(db, table, table === "leagues" ? "id = $1" : "league_id = $1", [doomed.leagueId]);
      expect(n, `${table} rows should cascade`).toBe(0);
    }
  });
});
