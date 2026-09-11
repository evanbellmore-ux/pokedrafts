// The client contract behind the hardening migration. The release gate
// (scripts/check-client-contract.mjs) refuses to let the migration ship ahead
// of a client that still calls the dropped timer RPCs or writes directly to
// the function-only tables. These tests keep that gate honest against the
// real database: the catalog it accepts is exactly what the migration grants,
// its scanner recognises every call shape the pre-hardening client used, and
// app/lib/rpc.ts only names functions that exist.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FUNCTION_ONLY_TABLES, LEGACY_RPCS, parseRpcCatalog, scanProject, scanSource } from "../../scripts/lib/client-contract.mjs";
import { connect, type Client } from "./harness";
import { HARDENING_MIGRATION, readMigrations } from "./migrations-lib";

describe("client contract", () => {
  let db: Client;
  let catalog: string[];

  beforeAll(async () => {
    db = await connect();
    const hardening = readMigrations().find((m) => m.name === HARDENING_MIGRATION);
    if (!hardening) {
      throw new Error(`${HARDENING_MIGRATION} not found`);
    }
    catalog = parseRpcCatalog(hardening.sql);
  });

  afterAll(async () => {
    await db.end();
  });

  it("the catalog the release gate accepts is exactly the set of public functions granted to the API roles", async () => {
    const { rows } = await db.query<{ fn: string }>(`
      select distinct p.proname as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname not like '\\_%'
        and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
      order by 1
    `);
    expect(catalog).toEqual(rows.map((r) => r.fn));
    expect(catalog).toHaveLength(28);
    for (const legacy of LEGACY_RPCS) {
      expect(catalog).not.toContain(legacy);
    }
    // No stray catalog entry: every name resolves to a function the API can call.
    for (const fn of catalog) {
      const exists = await db.query("select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = $1", [fn]);
      expect(exists.rowCount, `${fn} should exist`).toBe(1);
    }
  });

  it("the function-only tables have no insert or update policy, and the only remaining write policy is the leagues delete", async () => {
    const { rows } = await db.query<{ tablename: string; cmd: string }>(
      "select tablename, cmd from pg_policies where schemaname = 'public' and tablename = any($1) and cmd <> 'SELECT' order by 1, 2",
      [FUNCTION_ONLY_TABLES],
    );
    expect(rows).toEqual([{ tablename: "leagues", cmd: "DELETE" }]);
  });

  it("the scanner flags the call shapes the pre-hardening client used and accepts the documented ones", () => {
    const source = [
      /*  1 */ 'const { error } = await supabase.rpc("start_draft_timer", { target_league_id: leagueId });',
      /*  2 */ "await supabase.rpc('advance_draft_timer', { target_league_id: leagueId, next_pick: 2 });",
      /*  3 */ 'await supabase.rpc("make_pick", { p_league_id: leagueId, p_pokemon_name: name });',
      /*  4 */ 'await supabase.rpc("make_pick_v2", { p_league_id: leagueId });',
      /*  5 */ 'const { error: pickError } = await supabase.from("draft_picks").insert({ league_id: leagueId });',
      /*  6 */ "const { error } = await supabase",
      /*  7 */ '  .from("leagues")',
      /*  8 */ "  .update({ auto_pick_in_progress: true })",
      /*  9 */ '  .eq("id", leagueId);',
      /* 10 */ 'await supabase.from("drafted_teams").upsert(rows, { onConflict: "league_id,member_id" });',
      /* 11 */ 'await supabase.from("league_matches").delete().eq("league_id", leagueId);',
      /* 12 */ 'await supabase.from("leagues").delete().eq("id", leagueId).select().single();',
      /* 13 */ 'await supabase.from("league_members").select("*").eq("league_id", leagueId);',
      /* 14 */ 'await supabase.from("draft_formats").insert({ name, json }).select().single();',
      /* 15 */ 'await supabase.from("draft_chat_messages").insert({ league_id: leagueId, message });',
      /* 16 */ "await supabase.from('league_news').insert({ news_type: 'free_agent' });",
      /* 17 */ 'await supabase.rpc("complete_draft_timer", { target_league_id: leagueId, final_pick: 12 });',
      /* 18 */ 'const { data } = await supabase.rpc("get_invite_preview", { p_code: code });',
    ].join("\n");
    const findings = scanSource(source, "fixture.tsx", catalog);
    expect(findings.map((f) => [f.line, f.kind])).toEqual([
      [1, "legacy_rpc"],
      [2, "legacy_rpc"],
      [4, "unknown_rpc"],
      [5, "direct_write"],
      [7, "direct_write"],
      [10, "direct_write"],
      [11, "direct_write"],
      [16, "direct_write"],
      [17, "legacy_rpc"],
    ]);
    for (const finding of findings) {
      expect(finding.file).toBe("fixture.tsx");
      expect(finding.detail.length).toBeGreaterThan(0);
    }
    expect(scanSource("", "empty.ts", catalog)).toEqual([]);
  });

  it("every wrapper in app/lib/rpc.ts names a catalog function, and every catalog function has a wrapper", () => {
    const source = readFileSync(resolve(process.cwd(), "app", "lib", "rpc.ts"), "utf8");
    const names = [...source.matchAll(/\bcall(?:<[^(]*)?\(\s*client,\s*["']([a-z0-9_]+)["']/g)].map((m) => m[1]);
    expect(names.length, "no wrappers found in app/lib/rpc.ts; update the extraction pattern in this test").toBeGreaterThan(0);
    for (const name of names) {
      expect(catalog, `app/lib/rpc.ts calls "${name}", which the hardening migration does not grant`).toContain(name);
    }
    // is_league_member exists for the policies; everything else is a client action.
    const missing = catalog.filter((fn) => fn !== "is_league_member" && !names.includes(fn));
    expect(missing, "catalog functions without a wrapper in app/lib/rpc.ts").toEqual([]);
  });

  it("the release gate passes on this working tree: app/ and proxy.ts call no dropped or unknown RPC and write to no function-only table", () => {
    // The same scan as `node scripts/check-client-contract.mjs`, so a client
    // that is not yet on the RPC catalog fails `npm run test:db` instead of
    // only the gate the README asks the deployer to run by hand.
    const { files, findings } = scanProject(process.cwd(), catalog);
    expect(files).toBeGreaterThan(0);
    expect(
      findings.map((f) => `${f.file}:${f.line} [${f.kind}] ${f.detail}`),
      "the client still uses calls the hardening migration removes; replace them with the wrappers in app/lib/rpc.ts (README: \"The deployed client must be on the RPC catalog first\")",
    ).toEqual([]);
  });
});
