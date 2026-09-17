// Review test (applyability lens): what the README's CLI guidance implies
// about re-running migration files.
//
// 1. The whole twelve-file set is re-runnable in filename order (README.md,
//    "Applying migrations"), so an operator who lets `supabase db push
//    --include-all` re-run files that were applied by hand through the SQL
//    editor ends up in the hardened state.
// 2. The hazard, and the rule README.md and docs/schema.md state: the eight
//    older files recreate the legacy write policies, and only the hardening
//    file (which sorts last) removes them again. If an older file runs AFTER
//    the hardening (for example `supabase migration repair --status applied
//    20260909120000` without also repairing the older versions, followed by
//    `db push --include-all`, or a single old file pasted into the SQL editor),
//    a post-draft coach can set their own role to commissioner and delete the
//    league until the hardening file is applied again.
// 3. Feature migrations after the hardening file follow it in filename order:
//    re-running the hardening file alone recreates the 7-parameter
//    create_league next to the 9-parameter one from the playoffs file, which
//    makes the name ambiguous, so the playoffs file has to run again after it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createUser, inviteCodeFor, rpcAs, type Client } from "./harness";
import { HARDENING_MIGRATION, PLAYOFFS_MIGRATION, applyMigration, createDatabaseSql, createScaffolding, readMigrations } from "./migrations-lib";

const RERUN_DB = "pokedrafts_rerun_review";

async function policyRows(client: Client): Promise<Array<{ tablename: string; policyname: string; cmd: string }>> {
  const { rows } = await client.query<{ tablename: string; policyname: string; cmd: string }>(
    "select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2",
  );
  return rows;
}

describe("review: re-running migration files", () => {
  let admin: Client;
  let db: Client;

  beforeAll(async () => {
    admin = await connect();
    await admin.query(`drop database if exists ${RERUN_DB}`);
    await admin.query(createDatabaseSql(RERUN_DB));
    db = await connect(RERUN_DB);
    await createScaffolding(db);
    for (const migration of readMigrations()) {
      await applyMigration(db, migration);
    }
  });

  afterAll(async () => {
    await db.end();
    await admin.query(`drop database if exists ${RERUN_DB}`);
    await admin.end();
  });

  it("all twelve files apply a second time in filename order and leave the hardened policy set", async () => {
    const migrations = readMigrations();
    expect(migrations).toHaveLength(12);
    for (const migration of migrations) {
      await applyMigration(db, migration);
    }
    const policies = await policyRows(db);
    // The hardening file's 16 policies plus the pool builder's one select
    // policy on public.pokemon, which a hardening re-run leaves alone (its
    // policy loop only lists its own tables).
    expect(policies).toHaveLength(17);
    expect(policies.filter((p) => p.tablename === "pokemon").map((p) => [p.policyname, p.cmd])).toEqual([
      ["Signed-in users can read the dataset", "SELECT"],
    ]);
    expect(policies.filter((p) => p.tablename === "league_members" && p.cmd !== "SELECT")).toEqual([]);
    expect(policies.filter((p) => p.tablename === "leagues" && p.cmd === "DELETE").map((p) => p.policyname)).toEqual([
      "Commissioners can delete their leagues",
    ]);
  });

  it("an older file re-run after the hardening reinstates the legacy write policies and the role escalation", async () => {
    const migrations = readMigrations();
    const older = migrations.filter((m) => /^20260703(120000|124500)_/.test(m.name));
    expect(older.map((m) => m.name)).toEqual([
      "20260703120000_allow_commissioner_delete_leagues.sql",
      "20260703124500_add_free_agent_swap_limits.sql",
    ]);
    for (const migration of older) {
      await applyMigration(db, migration);
    }

    const policies = await policyRows(db);
    const names = policies.map((p) => `${p.tablename}.${p.policyname} (${p.cmd})`);
    expect(names).toContain("league_members.Members can increment their free agent swap count (UPDATE)");
    expect(names).toContain("drafted_teams.Members can update their finalized team after draft (UPDATE)");
    expect(names).toContain("leagues.Commissioners can delete leagues (DELETE)");

    // A post-draft coach promotes themselves and deletes the league.
    const commissioner = await createUser(db);
    const leagueId = await rpcAs<string>(db, commissioner, "create_league", {
      p_name: "Rerun hazard",
      p_team_name: "Commish",
      p_max_coaches: 4,
      p_draft_format_id: null,
      p_point_budget: 100,
      p_picks_per_team: 2,
      p_pick_timer_seconds: 60,
    });
    const coach = await createUser(db);
    await rpcAs(db, coach, "join_league", { p_code: await inviteCodeFor(db, leagueId), p_team_name: "Coach" });
    await db.query("update public.leagues set draft_completed = true where id = $1", [leagueId]);

    const promoted = await asUser(db, coach, (c) =>
      c.query("update public.league_members set role = 'commissioner' where league_id = $1 and user_id = $2", [leagueId, coach]),
    );
    expect(promoted.rowCount).toBe(1);
    const deleted = await asUser(db, coach, (c) => c.query("delete from public.leagues where id = $1", [leagueId]));
    expect(deleted.rowCount).toBe(1);

    // Re-applying the hardening file is the fix.
    const hardening = migrations.find((m) => m.name === HARDENING_MIGRATION);
    if (!hardening) throw new Error("hardening migration missing");
    await applyMigration(db, hardening);
    const after = await policyRows(db);
    expect(after).toHaveLength(17);
    expect(after.filter((p) => p.cmd !== "SELECT").map((p) => `${p.tablename}.${p.cmd}`).sort()).toEqual([
      "draft_chat_messages.INSERT",
      "draft_formats.DELETE",
      "draft_formats.INSERT",
      "draft_formats.UPDATE",
      "leagues.DELETE",
    ]);

    // ... but the hardening file alone brings back the 7-parameter
    // create_league and the 2-parameter report_match_result next to the
    // playoffs signatures, so a call that omits the new parameters is
    // ambiguous (42725) until the playoffs file runs again after it.
    const signatureCount = async () =>
      (await db.query<{ n: number }>("select count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace and proname in ('create_league', 'report_match_result')")).rows[0].n;
    expect(await signatureCount()).toBe(4);
    const ambiguous = await asUser(db, commissioner, (c) =>
      c.query("select public.create_league(p_name => 'Ambiguous', p_team_name => 'T', p_max_coaches => 4)").then(
        () => null,
        (error: Error & { code?: string }) => error.code,
      ),
    );
    expect(ambiguous).toBe("42725");
    const playoffs = migrations.find((m) => m.name === PLAYOFFS_MIGRATION);
    if (!playoffs) throw new Error("playoffs migration missing");
    await applyMigration(db, playoffs);
    expect(await signatureCount()).toBe(2);
    const created = await rpcAs<string>(db, commissioner, "create_league", { p_name: "After re-run", p_team_name: "T", p_max_coaches: 4 });
    expect(typeof created).toBe("string");
  });
});

describe("review: the ordering rule is documented", () => {
  it("README.md and docs/schema.md say the hardening file runs after the eight legacy files, that feature migrations follow it in filename order, and the README covers migration repair", () => {
    for (const file of ["README.md", "docs/schema.md"]) {
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(text.toLowerCase(), file).toContain("never run one of the eight legacy files after the hardening file");
      expect(text, file).toContain("20260909120000_release_hardening.sql");
      expect(text, file).toContain("20260912120000_playoffs.sql");
      expect(text, file).toContain("filename order");
    }
    const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
    expect(readme).toContain("supabase migration repair");
    expect(readme).toContain("supabase migration list");
    expect(readme).toContain("re-run `20260909120000_release_hardening.sql`");
    expect(readme).toContain("re-run `20260912120000_playoffs.sql`");
  });
});
