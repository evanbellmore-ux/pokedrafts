// Test-side helpers: connections to the embedded database, running statements
// as a Supabase user (or anon) inside a transaction, calling RPCs with named
// arguments, asserting our P0001 error codes, and league fixtures.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    dbPort: number;
    dbUser: string;
    dbPassword: string;
    dbName: string;
  }
}

export type Client = pg.Client;

export async function connect(database?: string): Promise<Client> {
  const client = new pg.Client({
    host: "127.0.0.1",
    port: inject("dbPort"),
    user: inject("dbUser"),
    password: inject("dbPassword"),
    database: database ?? inject("dbName"),
  });
  await client.connect();
  return client;
}

// Runs `fn` inside one transaction as the given Supabase user (role
// authenticated + request.jwt.claim.sub) or as anon when userId is null.
export async function asUser<T>(client: Client, userId: string | null, fn: (c: Client) => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await client.query(`set local role ${userId ? "authenticated" : "anon"}`);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

export function asAnon<T>(client: Client, fn: (c: Client) => Promise<T>): Promise<T> {
  return asUser(client, null, fn);
}

// The authenticated role with no JWT subject: what a function sees when
// auth.uid() is null but the caller may execute it.
export async function asAuthenticatedNoSub<T>(client: Client, fn: (c: Client) => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query("select set_config('request.jwt.claim.sub', '', true)");
    await client.query("set local role authenticated");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

export type RosterEntry = { name: string; points: number; tier: number; pick_number: number | null; acquired?: string };

export async function teamFor(client: Client, leagueId: string, memberId: string): Promise<{ id: string; pokemon: RosterEntry[]; total_points: number }> {
  const { rows } = await client.query(
    "select id, pokemon, total_points from public.drafted_teams where league_id = $1 and member_id = $2",
    [leagueId, memberId],
  );
  return rows[0];
}

export async function newsFor(client: Client, leagueId: string, type?: string): Promise<Array<{ id: string; member_id: string | null; news_type: string; message: string; metadata: Record<string, unknown>; created_at: string }>> {
  const { rows } = await client.query(
    `select id, member_id, news_type, message, metadata, created_at from public.league_news
     where league_id = $1 and ($2::text is null or news_type = $2) order by created_at desc, id desc`,
    [leagueId, type ?? null],
  );
  return rows;
}

export async function matchesFor(client: Client, leagueId: string): Promise<Array<{ id: string; round_number: number; match_number: number; home_member_id: string; away_member_id: string; status: string; winner_member_id: string | null }>> {
  const { rows } = await client.query(
    "select id, round_number, match_number, home_member_id, away_member_id, status, winner_member_id from public.league_matches where league_id = $1 order by round_number, match_number",
    [leagueId],
  );
  return rows;
}

// select public.<fn>(p_a => $1, ...) with named arguments.
export async function rpc<T = unknown>(client: Client, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const keys = Object.keys(args);
  const named = keys.map((key, index) => `${key} => $${index + 1}`).join(", ");
  const { rows } = await client.query(`select public.${fn}(${named}) as result`, keys.map((key) => args[key]));
  return rows[0].result as T;
}

export function rpcAs<T = unknown>(client: Client, userId: string | null, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  return asUser(client, userId, (c) => rpc<T>(c, fn, args));
}

export type PgError = Error & { code?: string; detail?: string };

// Asserts that a call fails with our convention: SQLSTATE P0001 and the
// snake_case code in DETAIL. Returns the error for further assertions.
export async function expectRpcError(promise: Promise<unknown>, code: string): Promise<PgError> {
  let caught: PgError | null = null;
  try {
    await promise;
  } catch (error) {
    caught = error as PgError;
  }
  if (!caught) {
    throw new Error(`expected error "${code}" but the call succeeded`);
  }
  expect(caught.detail, `expected error code "${code}" but got "${caught.detail}" (${caught.message})`).toBe(code);
  expect(caught.code).toBe("P0001");
  expect(caught.message.length).toBeGreaterThan(0);
  return caught;
}

export async function expectSqlState(promise: Promise<unknown>, sqlState: string): Promise<PgError> {
  let caught: PgError | null = null;
  try {
    await promise;
  } catch (error) {
    caught = error as PgError;
  }
  if (!caught) {
    throw new Error(`expected SQLSTATE ${sqlState} but the call succeeded`);
  }
  expect(caught.code, caught.message).toBe(sqlState);
  return caught;
}

export async function createUser(client: Client, email?: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [
    email ?? `${randomUUID()}@test.local`,
  ]);
  return rows[0].id;
}

export type PoolEntry = { name: string; points: number; tier: number };

// n entries priced from 20 down to 1, cycling.
export function samplePool(n: number, maxPoints = 20): PoolEntry[] {
  return Array.from({ length: n }, (_, i) => {
    const points = maxPoints - (i % maxPoints);
    return { name: `Mon${String(i + 1).padStart(3, "0")}`, points, tier: 21 - points };
  });
}

export type Participant = { userId: string; memberId: string; teamName: string };

export type LeagueFixture = {
  leagueId: string;
  inviteCode: string;
  commissioner: Participant;
  coaches: Participant[];
  // Every participant in draft order (commissioner first) when positioned.
  order: Participant[];
};

export type LeagueOptions = {
  coaches?: number;
  maxCoaches?: number;
  picksPerTeam?: number;
  pointBudget?: number;
  pickTimerSeconds?: number;
  pool?: PoolEntry[] | null;
  setOrder?: boolean;
  name?: string;
  // create_league defaults to top_4; the fixture defaults to none so a fully
  // reported regular season does not grow a bracket unless a test asks for one.
  playoffFormat?: "none" | "top_2" | "top_4" | "top_6" | "top_8";
  tiebreaker?: "head_to_head" | "differential";
};

export async function inviteCodeFor(client: Client, leagueId: string): Promise<string> {
  const { rows } = await client.query<{ invite_code: string }>(
    "select invite_code from public.league_invites where league_id = $1 order by created_at desc limit 1",
    [leagueId],
  );
  return rows[0].invite_code;
}

export async function memberFor(client: Client, leagueId: string, userId: string): Promise<{ id: string; team_name: string | null; role: string; draft_position: number | null; free_agent_swaps_used: number }> {
  const { rows } = await client.query(
    "select id, team_name, role, draft_position, free_agent_swaps_used from public.league_members where league_id = $1 and user_id = $2",
    [leagueId, userId],
  );
  return rows[0];
}

export async function leagueRow(client: Client, leagueId: string): Promise<Record<string, unknown>> {
  const { rows } = await client.query("select * from public.leagues where id = $1", [leagueId]);
  return rows[0];
}

// Creates a league through the RPCs: commissioner + n coaches joined via the
// invite, a custom pool, and a draft order (commissioner first).
export async function buildLeague(client: Client, options: LeagueOptions = {}): Promise<LeagueFixture> {
  const coachCount = options.coaches ?? 2;
  const maxCoaches = options.maxCoaches ?? Math.max(2, coachCount + 1);
  const commissionerUser = await createUser(client);
  const leagueId = await rpcAs<string>(client, commissionerUser, "create_league", {
    p_name: options.name ?? "Test League",
    p_team_name: "Commish",
    p_max_coaches: maxCoaches,
    p_draft_format_id: null,
    p_point_budget: options.pointBudget ?? 100,
    p_picks_per_team: options.picksPerTeam ?? 2,
    p_pick_timer_seconds: options.pickTimerSeconds ?? 60,
    p_playoff_format: options.playoffFormat ?? "none",
    p_tiebreaker: options.tiebreaker ?? "head_to_head",
  });
  const inviteCode = await inviteCodeFor(client, leagueId);

  const coaches: Participant[] = [];
  for (let i = 0; i < coachCount; i += 1) {
    const userId = await createUser(client);
    const teamName = `Coach ${i + 1}`;
    await rpcAs(client, userId, "join_league", { p_code: inviteCode, p_team_name: teamName });
    const member = await memberFor(client, leagueId, userId);
    coaches.push({ userId, memberId: member.id, teamName });
  }

  const commissionerMember = await memberFor(client, leagueId, commissionerUser);
  const commissioner: Participant = { userId: commissionerUser, memberId: commissionerMember.id, teamName: "Commish" };

  const pool = options.pool === undefined ? samplePool(Math.max(12, (coachCount + 1) * (options.picksPerTeam ?? 2) * 2)) : options.pool;
  if (pool) {
    await rpcAs(client, commissionerUser, "update_league_pool", {
      p_league_id: leagueId,
      p_pool: { version: "1.0", leagueName: "Test", pokemon: pool },
    });
  }

  const order = [commissioner, ...coaches];
  if ((options.setOrder ?? true) && order.length >= 2) {
    await rpcAs(client, commissionerUser, "set_draft_order", {
      p_league_id: leagueId,
      p_member_ids: order.map((p) => p.memberId),
    });
  }

  return { leagueId, inviteCode, commissioner, coaches, order };
}

export async function onClockMember(client: Client, leagueId: string): Promise<{ pickNumber: number; memberId: string | null; completed: boolean }> {
  const league = await leagueRow(client, leagueId);
  const pickNumber = Number(league.current_pick_number ?? 1);
  const { rows } = await client.query<{ member: string | null }>("select public._snake_member($1, $2) as member", [leagueId, pickNumber]);
  return { pickNumber, memberId: rows[0].member, completed: Boolean(league.draft_completed) };
}

export async function bestAvailable(client: Client, leagueId: string, memberId: string): Promise<string | null> {
  const { rows } = await client.query<{ name: string }>("select name from public._best_available($1, $2)", [leagueId, memberId]);
  return rows[0]?.name ?? null;
}

// Starts the draft and makes every pick through make_pick as the coach on the
// clock. Returns the picks in order.
export async function runFullDraft(client: Client, league: LeagueFixture): Promise<Array<{ pickNumber: number; memberId: string; name: string }>> {
  await rpcAs(client, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
  const picks: Array<{ pickNumber: number; memberId: string; name: string }> = [];
  for (let guard = 0; guard < 500; guard += 1) {
    const clock = await onClockMember(client, league.leagueId);
    if (clock.completed) {
      break;
    }
    if (!clock.memberId) {
      throw new Error("no member on the clock");
    }
    const participant = league.order.find((p) => p.memberId === clock.memberId);
    if (!participant) {
      throw new Error("on-clock member is not in the fixture");
    }
    const name = await bestAvailable(client, league.leagueId, clock.memberId);
    if (!name) {
      throw new Error("no legal pick available for the fixture draft");
    }
    await rpcAs(client, participant.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: name });
    picks.push({ pickNumber: clock.pickNumber, memberId: clock.memberId, name });
  }
  return picks;
}

export async function expireTimer(client: Client, leagueId: string): Promise<void> {
  await client.query("update public.leagues set pick_started_at = now() - interval '1 hour' where id = $1", [leagueId]);
}

export async function count(client: Client, table: string, where: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(`select count(*)::text as n from public.${table} where ${where}`, params);
  return Number(rows[0].n);
}
