// Review test (applyability lens): what the README's CLI guidance implies
// about re-running migration files.
//
// 1. The whole ten-file set is re-runnable in filename order (README.md,
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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createUser, inviteCodeFor, rpcAs, type Client } from "./harness";
import { HARDENING_MIGRATION, applyMigration, createScaffolding, readMigrations } from "./migrations-lib";

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
    await admin.query(`create database ${RERUN_DB}`);
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

  it("all ten files apply a second time in filename order and leave the hardened policy set", async () => {
    for (const migration of readMigrations()) {
      await applyMigration(db, migration);
    }
    const policies = await policyRows(db);
    expect(policies).toHaveLength(16);
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
    expect(after).toHaveLength(16);
    expect(after.filter((p) => p.cmd !== "SELECT").map((p) => `${p.tablename}.${p.cmd}`).sort()).toEqual([
      "draft_chat_messages.INSERT",
      "draft_formats.DELETE",
      "draft_formats.INSERT",
      "draft_formats.UPDATE",
      "leagues.DELETE",
    ]);
  });
});

describe("review: the ordering rule is documented", () => {
  it("README.md and docs/schema.md say the hardening file must always be the last migration file to run, and the README covers migration repair", () => {
    for (const file of ["README.md", "docs/schema.md"]) {
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(text, file).toContain("the last migration file to run");
      expect(text, file).toContain("20260909120000_release_hardening.sql");
    }
    const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
    expect(readme).toContain("supabase migration repair");
    expect(readme).toContain("supabase migration list");
    expect(readme).toContain("re-run `20260909120000_release_hardening.sql`");
  });
});
