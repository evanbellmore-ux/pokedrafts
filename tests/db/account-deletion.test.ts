// Account deletion (20261026130000_account_deletion.sql, docs/release-architecture.md
// section 17): account_deletion_preview says what delete_account will do, and
// delete_account does exactly that in one transaction. A league the person
// runs alone goes with them, a league they run with other coaches passes to
// the coach who joined it earliest, their spot before a draft is removed, and
// their team after a draft has started stays with no link to them, so the
// other coaches keep their matches, standings and draft. Their chat messages,
// their draft formats, the auth.users row and their audit-log rows go too.
// _delete_account does the same for any id, run by the owner with no caller.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asAuthenticatedNoSub,
  asUser,
  bestAvailable,
  buildLeague,
  connect,
  count,
  createUser,
  expectRpcError,
  expectSqlState,
  expireTimer,
  inviteCodeFor,
  leagueRow,
  matchesFor,
  memberFor,
  onClockMember,
  rpc,
  rpcAs,
  runFullDraft,
  samplePool,
  teamFor,
  type Client,
  type LeagueFixture,
  type Participant,
} from "./harness";

type Preview = {
  deleted_leagues: Array<{ league_id: string; league_name: string }>;
  handed_over_leagues: Array<{ league_id: string; league_name: string; new_commissioner_team: string | null }>;
  removed_teams: Array<{ league_id: string; league_name: string; team_name: string | null }>;
  kept_teams: Array<{ league_id: string; league_name: string; team_name: string | null }>;
  draft_formats: number;
  chat_messages: number;
  site_admin: boolean;
};

type Result = {
  deleted_leagues: number;
  handed_over_leagues: number;
  removed_teams: number;
  kept_teams: number;
  draft_formats: number;
  chat_messages: number;
  site_admin: boolean;
  sign_in_deleted: boolean;
  audit_log_entries: number;
};

const NOTHING: Result = {
  deleted_leagues: 0,
  handed_over_leagues: 0,
  removed_teams: 0,
  kept_teams: 0,
  draft_formats: 0,
  chat_messages: 0,
  site_admin: false,
  sign_in_deleted: false,
  audit_log_entries: 0,
};

describe("account deletion", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  const preview = (userId: string) => rpcAs<Preview>(db, userId, "account_deletion_preview");
  const deleteAccount = (userId: string) => rpcAs<Result>(db, userId, "delete_account");

  async function authUserExists(userId: string): Promise<boolean> {
    const { rowCount } = await db.query("select 1 from auth.users where id = $1", [userId]);
    return rowCount === 1;
  }

  async function chat(leagueId: string, userId: string, message: string): Promise<void> {
    const member = await memberFor(db, leagueId, userId);
    await asUser(db, userId, (c) =>
      c.query("insert into public.draft_chat_messages (league_id, member_id, user_id, message) values ($1, $2, $3, $4)", [
        leagueId,
        member.id,
        userId,
        message,
      ]),
    );
  }

  async function saveFormat(userId: string, name: string): Promise<string> {
    return asUser(db, userId, async (c) => {
      const { rows } = await c.query<{ id: string }>("insert into public.draft_formats (name, json) values ($1, $2) returning id", [
        name,
        { version: "1.0", leagueName: name, pokemon: samplePool(12) },
      ]);
      return rows[0].id;
    });
  }

  async function join(userId: string, leagueId: string, teamName: string): Promise<Participant> {
    await rpcAs(db, userId, "join_league", { p_code: await inviteCodeFor(db, leagueId), p_team_name: teamName });
    const member = await memberFor(db, leagueId, userId);
    return { userId, memberId: member.id, teamName };
  }

  // Someone else's league (commissioner + one coach) that `person` joins as a
  // third coach before the order is set, optionally drafted to the end.
  async function leagueWithCoach(person: string, name: string, drafted: boolean): Promise<{ league: LeagueFixture; seat: Participant }> {
    const base = await buildLeague(db, { name, coaches: 1, maxCoaches: 4, setOrder: false });
    const seat = await join(person, base.leagueId, `${name} team`);
    const order = [base.commissioner, ...base.coaches, seat];
    await rpcAs(db, base.commissioner.userId, "set_draft_order", { p_league_id: base.leagueId, p_member_ids: order.map((p) => p.memberId) });
    const league: LeagueFixture = { ...base, coaches: [...base.coaches, seat], order };
    if (drafted) await runFullDraft(db, league);
    return { league, seat };
  }

  async function standings(leagueId: string, userId: string) {
    const { rows } = await asUser(db, userId, (c) => c.query("select * from public.league_standings($1) order by seed", [leagueId]));
    return rows;
  }

  // The owner's way (section 17.7): the SQL editor's role, no JWT claims, so auth.uid() is null.
  async function ownerDelete(userId: string | null): Promise<Result> {
    const { rows } = await db.query<{ uid: string | null; result: Result }>(
      "select auth.uid() as uid, public._delete_account($1) as result",
      [userId],
    );
    expect(rows[0].uid).toBeNull();
    return rows[0].result;
  }

  // What the dashboard's Delete user does: only the auth.users row (and its cascades) go.
  async function dashboardDelete(userId: string): Promise<void> {
    await db.query("delete from auth.users where id = $1", [userId]);
  }

  async function auditRow(payload: Record<string, unknown>): Promise<string> {
    const id = randomUUID();
    await db.query("insert into auth.audit_log_entries (id, payload, created_at, ip_address) values ($1, $2, now(), '203.0.113.7')", [
      id,
      JSON.stringify(payload),
    ]);
    return id;
  }

  async function auditRowsLeft(ids: string[]): Promise<string[]> {
    const { rows } = await db.query<{ id: string }>("select id from auth.audit_log_entries where id = any($1) order by id", [ids]);
    return rows.map((r) => r.id);
  }

  it("is not open to anon, and a session without a user gets not_authenticated", async () => {
    await expectSqlState(rpcAs(db, null, "delete_account"), "42501");
    await expectSqlState(rpcAs(db, null, "account_deletion_preview"), "42501");
    await expectRpcError(asAuthenticatedNoSub(db, (c) => rpc(c, "delete_account")), "not_authenticated");
    await expectRpcError(asAuthenticatedNoSub(db, (c) => rpc(c, "account_deletion_preview")), "not_authenticated");
  });

  it("previews the plan, then carries it out: a league only they coach goes, a spot before the draft goes, a drafted team stays unlinked", async () => {
    const email = `Alpha.${randomUUID()}@Test.Local`;
    const person = await createUser(db, email);
    // GoTrue's sign-in history for them (by id, and by email in another case), and someone else's.
    const theirs = [await auditRow({ actor_id: person, action: "login" }), await auditRow({ actor_username: email.toLowerCase(), action: "user_signedup" })];
    const someoneElse = await auditRow({ actor_id: randomUUID(), actor_username: "other@test.local", action: "login" });

    // A league they run alone.
    const soloId = await rpcAs<string>(db, person, "create_league", { p_name: "Alpha Solo", p_team_name: "Mine", p_max_coaches: 4 });

    // A league they started from one of their formats and handed over before
    // its draft: they are a coach there now.
    const formatId = await saveFormat(person, "My format");
    await saveFormat(person, "Unused format");
    const handedId = await rpcAs<string>(db, person, "create_league", {
      p_name: "Bravo Handed",
      p_team_name: "Founder",
      p_max_coaches: 4,
      p_draft_format_id: formatId,
    });
    const heir = await createUser(db);
    const heirSeat = await join(heir, handedId, "Heir");
    await rpcAs(db, person, "transfer_commissioner", { p_league_id: handedId, p_member_id: heirSeat.memberId });
    const handedPool = (await leagueRow(db, handedId)).custom_pool;

    // Someone else's league before its draft, and one whose draft is over.
    const open = await leagueWithCoach(person, "Charlie Open", false);
    const done = await leagueWithCoach(person, "Delta Done", true);
    expect((await leagueRow(db, done.league.leagueId)).draft_completed).toBe(true);

    await chat(open.league.leagueId, person, "see you at the draft");
    await chat(done.league.leagueId, person, "good games");
    await chat(soloId, person, "talking to myself");

    const plan = await preview(person);
    expect(plan.handed_over_leagues).toEqual([]);
    expect(plan.deleted_leagues).toEqual([{ league_id: soloId, league_name: "Alpha Solo" }]);
    expect(plan.removed_teams).toEqual([
      { league_id: handedId, league_name: "Bravo Handed", team_name: "Founder" },
      { league_id: open.league.leagueId, league_name: "Charlie Open", team_name: "Charlie Open team" },
    ]);
    expect(plan.kept_teams).toEqual([{ league_id: done.league.leagueId, league_name: "Delta Done", team_name: "Delta Done team" }]);
    expect(plan.draft_formats).toBe(2);
    expect(plan.chat_messages).toBe(3);
    expect(plan.site_admin).toBe(false);

    // They also review Watch listings (20261026120000_watch_review.sql).
    await db.query("insert into public.site_admins (user_id) values ($1)", [person]);
    expect((await preview(person)).site_admin).toBe(true);

    const doneId = done.league.leagueId;
    const rosterBefore = await teamFor(db, doneId, done.seat.memberId);
    const matchesBefore = await matchesFor(db, doneId);
    expect(matchesBefore.length).toBeGreaterThan(0);
    const standingsBefore = await standings(doneId, done.league.commissioner.userId);

    // The result counts are the preview's.
    expect(await deleteAccount(person)).toEqual({
      deleted_leagues: 1,
      handed_over_leagues: 0,
      removed_teams: 2,
      kept_teams: 1,
      draft_formats: 2,
      chat_messages: 3,
      site_admin: true,
      sign_in_deleted: true,
      audit_log_entries: 2,
    });

    expect(await authUserExists(person)).toBe(false);
    expect(await auditRowsLeft([...theirs, someoneElse])).toEqual([someoneElse]);
    expect(await count(db, "site_admins", "user_id = $1", [person])).toBe(0);
    expect(await count(db, "leagues", "id = $1", [soloId])).toBe(0);
    expect(await count(db, "league_invites", "league_id = $1", [soloId])).toBe(0);
    expect(await count(db, "league_members", "user_id = $1", [person])).toBe(0);
    expect(await count(db, "draft_chat_messages", "user_id = $1", [person])).toBe(0);
    expect(await count(db, "draft_formats", "created_by = $1", [person])).toBe(0);

    // The handed league keeps its pool copy; only the link to the deleted format goes.
    const handed = await leagueRow(db, handedId);
    expect(handed.commissioner_id).toBe(heir);
    expect(handed.draft_format_id).toBeNull();
    expect(handed.custom_pool).toEqual(handedPool);
    expect(await count(db, "league_members", "league_id = $1", [handedId])).toBe(1);
    expect(await count(db, "league_members", "league_id = $1", [open.league.leagueId])).toBe(2);

    // The drafted team is still there for the other coaches, pointing at nobody.
    const { rows: kept } = await db.query<{ user_id: string; account_deleted_at: Date | null; team_name: string }>(
      "select user_id, account_deleted_at, team_name from public.league_members where id = $1",
      [done.seat.memberId],
    );
    expect(kept[0].user_id).not.toBe(person);
    expect(await authUserExists(kept[0].user_id)).toBe(false);
    expect(kept[0].account_deleted_at).toBeInstanceOf(Date);
    expect(kept[0].team_name).toBe("Delta Done team");
    expect(await teamFor(db, doneId, done.seat.memberId)).toEqual(rosterBefore);
    expect(await matchesFor(db, doneId)).toEqual(matchesBefore);
    expect(await standings(doneId, done.league.commissioner.userId)).toEqual(standingsBefore);

    // The remaining coaches still read the kept team; nobody can act as it.
    const visible = await asUser(db, done.league.coaches[0].userId, (c) =>
      c.query("select id from public.league_members where league_id = $1", [doneId]),
    );
    expect(visible.rows.map((r) => r.id)).toContain(done.seat.memberId);

    // A second call with the same (now dangling) session finds nothing left to do.
    expect(await deleteAccount(person)).toEqual(NOTHING);
  });

  async function roles(leagueId: string): Promise<Record<string, string>> {
    const { rows } = await db.query<{ id: string; role: string }>("select id, role from public.league_members where league_id = $1", [leagueId]);
    return Object.fromEntries(rows.map((r) => [r.id, r.role]));
  }

  it("hands a league they run, before its draft, to the coach who joined it earliest, and removes their own place", async () => {
    const league = await buildLeague(db, { name: "Echo Run", coaches: 2, setOrder: false });
    const person = league.commissioner.userId;
    const [first, second] = league.coaches;
    // The second coach to join through the invite is made the earliest by
    // date, so the heir follows joined_at rather than insertion order.
    await db.query("update public.league_members set joined_at = now() - interval '30 days' where id = $1", [second.memberId]);

    const plan = await preview(person);
    expect(plan.deleted_leagues).toEqual([]);
    expect(plan.handed_over_leagues).toEqual([{ league_id: league.leagueId, league_name: "Echo Run", new_commissioner_team: second.teamName }]);
    expect(plan.removed_teams).toEqual([{ league_id: league.leagueId, league_name: "Echo Run", team_name: "Commish" }]);
    expect(plan.kept_teams).toEqual([]);

    expect(await deleteAccount(person)).toMatchObject({ handed_over_leagues: 1, removed_teams: 1, kept_teams: 0, deleted_leagues: 0 });
    expect(await authUserExists(person)).toBe(false);
    expect((await leagueRow(db, league.leagueId)).commissioner_id).toBe(second.userId);
    expect(await roles(league.leagueId)).toEqual({ [second.memberId]: "commissioner", [first.memberId]: "coach" });

    // The heir really runs the league now.
    const code = await rpcAs<string>(db, second.userId, "regenerate_invite", { p_league_id: league.leagueId });
    expect(code).toMatch(/^[A-Z2-9]{10}$/);
    await expectRpcError(rpcAs(db, first.userId, "regenerate_invite", { p_league_id: league.leagueId }), "not_commissioner");
  });

  it("hands a finished league to the earliest active coach, skipping deleted accounts, and keeps their own team unlinked", async () => {
    const league = await buildLeague(db, { name: "Foxtrot Finished", coaches: 2 });
    await runFullDraft(db, league);
    const person = league.commissioner.userId;
    const [gone, heir] = league.coaches;
    // The earliest coach deleted their account: their team stays, but can never inherit the league.
    await db.query("update public.league_members set joined_at = now() - interval '30 days' where id = $1", [gone.memberId]);
    await deleteAccount(gone.userId);
    const matchesBefore = await matchesFor(db, league.leagueId);
    // A public, listed league (sections 15 and 16): its page belongs to the league.
    await db.query(
      "update public.leagues set is_public = true, stream_url = 'https://www.twitch.tv/foxtrotcast', watch_listed = true, watch_reviewed_at = now() where id = $1",
      [league.leagueId],
    );

    const plan = await preview(person);
    expect(plan.handed_over_leagues).toEqual([{ league_id: league.leagueId, league_name: "Foxtrot Finished", new_commissioner_team: heir.teamName }]);
    expect(plan.kept_teams).toEqual([{ league_id: league.leagueId, league_name: "Foxtrot Finished", team_name: "Commish" }]);
    expect(plan.removed_teams).toEqual([]);

    expect(await deleteAccount(person)).toMatchObject({ handed_over_leagues: 1, kept_teams: 1, removed_teams: 0 });
    expect((await leagueRow(db, league.leagueId)).commissioner_id).toBe(heir.userId);
    const { rows } = await db.query<{ user_id: string; role: string; account_deleted_at: Date | null }>(
      "select user_id, role, account_deleted_at from public.league_members where id = $1",
      [league.commissioner.memberId],
    );
    expect(rows[0].user_id).not.toBe(person);
    expect(rows[0].role).toBe("coach");
    expect(rows[0].account_deleted_at).toBeInstanceOf(Date);
    expect((await roles(league.leagueId))[heir.memberId]).toBe("commissioner");
    expect(await matchesFor(db, league.leagueId)).toEqual(matchesBefore);
    const handed = await leagueRow(db, league.leagueId);
    expect(handed).toMatchObject({ is_public: true, stream_url: "https://www.twitch.tv/foxtrotcast", watch_listed: true });
  });

  it("breaks a joined_at tie by member id", async () => {
    const league = await buildLeague(db, { name: "Golf Tie", coaches: 2, setOrder: false });
    const ids = league.coaches.map((c) => c.memberId);
    await db.query("update public.league_members set joined_at = '2026-01-01T00:00:00Z' where id = any($1)", [ids]);
    const { rows } = await db.query<{ id: string }>("select id from public.league_members where id = any($1) order by id limit 1", [ids]);
    const expected = league.coaches.find((c) => c.memberId === rows[0].id);

    const plan = await preview(league.commissioner.userId);
    expect(plan.handed_over_leagues.map((l) => l.new_commissioner_team)).toEqual([expected?.teamName]);
    await deleteAccount(league.commissioner.userId);
    expect((await leagueRow(db, league.leagueId)).commissioner_id).toBe(expected?.userId);
  });

  it("counts a league whose other coaches all deleted their accounts as theirs alone", async () => {
    const league = await buildLeague(db, { name: "Hotel Empty", coaches: 1 });
    await runFullDraft(db, league);
    await deleteAccount(league.coaches[0].userId);

    const person = league.commissioner.userId;
    const plan = await preview(person);
    expect(plan.handed_over_leagues).toEqual([]);
    expect(plan.deleted_leagues).toEqual([{ league_id: league.leagueId, league_name: "Hotel Empty" }]);

    expect(await deleteAccount(person)).toMatchObject({ deleted_leagues: 1 });
    expect(await count(db, "leagues", "id = $1", [league.leagueId])).toBe(0);
    expect(await count(db, "league_members", "league_id = $1", [league.leagueId])).toBe(0);
  });

  it("never hands a league to a member whose sign-in is gone: the next coach with one inherits it", async () => {
    const league = await buildLeague(db, { name: "India Heirless", coaches: 2, setOrder: false });
    const [ghost, real] = league.coaches;
    // The earliest coach's account went through the dashboard: their member row is all that is left.
    await db.query("update public.league_members set joined_at = now() - interval '30 days' where id = $1", [ghost.memberId]);
    await dashboardDelete(ghost.userId);

    const plan = await preview(league.commissioner.userId);
    expect(plan.handed_over_leagues).toEqual([{ league_id: league.leagueId, league_name: "India Heirless", new_commissioner_team: real.teamName }]);
    expect(await deleteAccount(league.commissioner.userId)).toMatchObject({ handed_over_leagues: 1, deleted_leagues: 0 });
    expect((await leagueRow(db, league.leagueId)).commissioner_id).toBe(real.userId);
  });

  it("deletes a league whose only other member has no sign-in", async () => {
    const league = await buildLeague(db, { name: "Juliet Ghost", coaches: 1, setOrder: false });
    await dashboardDelete(league.coaches[0].userId);

    const plan = await preview(league.commissioner.userId);
    expect(plan.handed_over_leagues).toEqual([]);
    expect(plan.deleted_leagues).toEqual([{ league_id: league.leagueId, league_name: "Juliet Ghost" }]);
    expect(await deleteAccount(league.commissioner.userId)).toMatchObject({ deleted_leagues: 1, handed_over_leagues: 0 });
    expect(await count(db, "leagues", "id = $1", [league.leagueId])).toBe(0);
  });

  it("never makes a member whose sign-in is gone commissioner", async () => {
    const league = await buildLeague(db, { name: "Kilo Transfer", coaches: 1, setOrder: false });
    await dashboardDelete(league.coaches[0].userId);

    const error = await expectRpcError(
      rpcAs(db, league.commissioner.userId, "transfer_commissioner", { p_league_id: league.leagueId, p_member_id: league.coaches[0].memberId }),
      "member_account_deleted",
    );
    expect(error.message).toBe("That coach no longer has an account, so they cannot run the league.");
    expect((await leagueRow(db, league.leagueId)).commissioner_id).toBe(league.commissioner.userId);
  });

  it("_delete_account, run by the owner with no caller, deletes someone else's account with the same outcomes", async () => {
    const email = `Lima.${randomUUID()}@test.local`;
    const person = await createUser(db, email);
    const runId = await rpcAs<string>(db, person, "create_league", { p_name: "Lima Run", p_team_name: "Lima", p_max_coaches: 4 });
    const coach = await join(await createUser(db), runId, "Lima Coach");
    const done = await leagueWithCoach(person, "Lima Done", true);
    await saveFormat(person, "Lima format");
    await chat(done.league.leagueId, person, "gg");
    const theirs = await auditRow({ action: "token_refreshed", traits: { user_id: person, user_email: email.toUpperCase() } });

    const plan = await preview(person);
    expect(await ownerDelete(person)).toEqual({
      deleted_leagues: plan.deleted_leagues.length,
      handed_over_leagues: plan.handed_over_leagues.length,
      removed_teams: plan.removed_teams.length,
      kept_teams: plan.kept_teams.length,
      draft_formats: 1,
      chat_messages: 1,
      site_admin: false,
      sign_in_deleted: true,
      audit_log_entries: 1,
    });
    expect(plan.handed_over_leagues.map((l) => l.new_commissioner_team)).toEqual(["Lima Coach"]);
    expect((await leagueRow(db, runId)).commissioner_id).toBe(coach.userId);
    expect(await authUserExists(person)).toBe(false);
    expect(await count(db, "league_members", "user_id = $1", [person])).toBe(0);
    expect(await count(db, "draft_formats", "created_by = $1", [person])).toBe(0);
    expect(await auditRowsLeft([theirs])).toEqual([]);
    const { rows } = await db.query<{ account_deleted_at: Date | null }>("select account_deleted_at from public.league_members where id = $1", [done.seat.memberId]);
    expect(rows[0].account_deleted_at).toBeInstanceOf(Date);
  });

  it("_delete_account tidies up after a dashboard deletion, and says no sign-in was deleted", async () => {
    const league = await buildLeague(db, { name: "Mike Leftover", coaches: 1, setOrder: false });
    const person = league.commissioner.userId;
    await saveFormat(person, "Mike format");
    await dashboardDelete(person);

    // The leftovers an orphan check finds (docs section 17.7).
    const orphans = async () =>
      (
        await db.query<{ id: string }>(`
          select lm.user_id as id from public.league_members lm
          where lm.account_deleted_at is null and not exists (select 1 from auth.users u where u.id = lm.user_id)
          union select l.commissioner_id from public.leagues l where not exists (select 1 from auth.users u where u.id = l.commissioner_id)
          union select f.created_by from public.draft_formats f where f.created_by is not null and not exists (select 1 from auth.users u where u.id = f.created_by)
        `)
      ).rows.map((r) => r.id);
    expect(await orphans()).toContain(person);

    expect(await ownerDelete(person)).toEqual({ ...NOTHING, handed_over_leagues: 1, removed_teams: 1, draft_formats: 1 });
    expect((await leagueRow(db, league.leagueId)).commissioner_id).toBe(league.coaches[0].userId);
    expect(await orphans()).not.toContain(person);
  });

  it("_delete_account with a mistyped id deletes nothing and says so; with no id it refuses", async () => {
    expect(await ownerDelete(randomUUID())).toEqual(NOTHING);
    await expectRpcError(ownerDelete(null), "account_id_required");
  });

  it("only the owner can run _delete_account: anon, signed-in users and the service role cannot", async () => {
    const victim = await createUser(db);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rows } = await db.query<{ ok: boolean }>("select has_function_privilege($1, 'public._delete_account(uuid)', 'execute') as ok", [role]);
      expect(rows[0].ok, role).toBe(false);
    }
    await expectSqlState(asAnon(db, (c) => c.query("select public._delete_account($1)", [victim])), "42501");
    await expectSqlState(asUser(db, await createUser(db), (c) => c.query("select public._delete_account($1)", [victim])), "42501");
    await db.query("begin");
    try {
      await db.query("set local role service_role");
      await expectSqlState(db.query("select public._delete_account($1)", [victim]), "42501");
    } finally {
      await db.query("rollback");
    }
    expect(await authUserExists(victim)).toBe(true);
  });

  it("removes every audit-log row that names them, by id or by email in any case, and nobody else's", async () => {
    const email = `November.${randomUUID()}@Test.Local`;
    const person = await createUser(db, email);
    const other = await createUser(db, `other.${randomUUID()}@test.local`);
    const theirs = [
      await auditRow({ actor_id: person, action: "login" }),
      await auditRow({ actor_username: email.toLowerCase(), action: "user_recovery_requested" }),
      await auditRow({ action: "token_revoked", traits: { user_id: person } }),
      await auditRow({ action: "user_confirmation_requested", traits: { user_email: email.toUpperCase() } }),
    ];
    const kept = [
      await auditRow({ actor_id: other, action: "login" }),
      await auditRow({ action: "user_invited", traits: { user_email: "someone@test.local" } }),
      await auditRow({ action: "logout" }),
    ];

    expect(await deleteAccount(person)).toMatchObject({ audit_log_entries: 4, sign_in_deleted: true });
    expect(await auditRowsLeft([...theirs, ...kept])).toEqual([...kept].sort());
  });

  it("keeps a team mid-draft: auto-pick drafts for it and the draft still finishes", async () => {
    const league = await buildLeague(db, { name: "Golf Live", coaches: 2, picksPerTeam: 2 });
    await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
    const gone = league.coaches[0];
    expect(await deleteAccount(gone.userId)).toMatchObject({ kept_teams: 1 });

    for (let guard = 0; guard < 50; guard += 1) {
      const clock = await onClockMember(db, league.leagueId);
      if (clock.completed) break;
      if (clock.memberId === gone.memberId) {
        await expireTimer(db, league.leagueId);
        const auto = await rpcAs<{ picked: boolean }>(db, league.commissioner.userId, "auto_pick_if_expired", { p_league_id: league.leagueId });
        expect(auto.picked).toBe(true);
        continue;
      }
      const participant = league.order.find((p) => p.memberId === clock.memberId);
      if (!participant || !clock.memberId) throw new Error("no participant on the clock");
      const name = await bestAvailable(db, league.leagueId, clock.memberId);
      await rpcAs(db, participant.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: name });
    }

    expect((await leagueRow(db, league.leagueId)).draft_completed).toBe(true);
    expect((await teamFor(db, league.leagueId, gone.memberId)).pokemon).toHaveLength(2);
  });

  it("never makes a team whose coach deleted their account commissioner", async () => {
    const league = await buildLeague(db, { name: "Hotel Heir", coaches: 1 });
    await runFullDraft(db, league);
    await deleteAccount(league.coaches[0].userId);

    await expectRpcError(
      rpcAs(db, league.commissioner.userId, "transfer_commissioner", { p_league_id: league.leagueId, p_member_id: league.coaches[0].memberId }),
      "member_account_deleted",
    );
    expect((await leagueRow(db, league.leagueId)).commissioner_id).toBe(league.commissioner.userId);
  });

  it.each([
    ["auth.users", "grant select, references on auth.users to pd_limited_owner; grant select on auth.audit_log_entries to pd_limited_owner;"],
    ["auth.audit_log_entries", "grant select, delete, references on auth.users to pd_limited_owner; grant select on auth.audit_log_entries to pd_limited_owner;"],
  ])("rolls everything back with account_deletion_unavailable when the owner may not delete from %s", async (_table, authGrants) => {
    const league = await buildLeague(db, { name: "Oscar Rollback", coaches: 1 });
    const person = league.coaches[0].userId;
    await saveFormat(person, "Still here");
    const audit = await auditRow({ actor_id: person, action: "login" });

    // Supabase applies migrations as postgres; model an owner that may write
    // the public tables but not delete from one of the two auth tables. It
    // owns _delete_account, where the deletes run, and the caller goes
    // through delete_account as usual. Everything runs in one transaction
    // that is rolled back, the role included.
    let caught: (Error & { code?: string; detail?: string }) | null = null;
    await db.query("begin");
    try {
      await db.query(`
        create role pd_limited_owner nologin bypassrls;
        grant usage on schema public, auth, extensions to pd_limited_owner;
        grant all on all tables in schema public to pd_limited_owner;
        ${authGrants}
        grant execute on all functions in schema public to pd_limited_owner;
        grant execute on function auth.uid() to pd_limited_owner;
        alter function public._delete_account(uuid) owner to pd_limited_owner;
      `);
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [person]);
      await db.query("set local role authenticated");
      await db.query("select public.delete_account()");
    } catch (error) {
      caught = error as Error & { code?: string; detail?: string };
    } finally {
      await db.query("rollback");
    }

    expect(caught?.code).toBe("P0001");
    expect(caught?.detail).toBe("account_deletion_unavailable");
    expect(await authUserExists(person)).toBe(true);
    expect(await auditRowsLeft([audit])).toEqual([audit]);
    expect(await count(db, "draft_formats", "created_by = $1", [person])).toBe(1);
    expect(await count(db, "league_members", "user_id = $1", [person])).toBe(1);
    const { rows } = await db.query<{ owner: string }>(
      "select pg_get_userbyid(proowner) as owner from pg_proc where oid = 'public._delete_account(uuid)'::regprocedure",
    );
    expect(rows[0].owner).not.toBe("pd_limited_owner");
  });
});
