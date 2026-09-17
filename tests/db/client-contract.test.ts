// The client contract behind the hardening migration and the feature
// migrations after it. The release gate (scripts/check-client-contract.mjs)
// refuses to let a migration ship ahead of a client that still calls the
// dropped timer RPCs, calls a function no migration grants, writes directly
// to the function-only tables, or writes a read-only table. These tests keep
// that gate honest against the real database: the catalog it accepts (the
// union of every migration's grants section) is exactly what the migrations
// grant, the read-only tables it knows (the same sections) are exactly the
// tables the API roles may select but never write, its scanner recognises
// every call shape the pre-hardening client used, and app/lib/rpc.ts only
// names functions that exist.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FUNCTION_ONLY_TABLES,
  LEGACY_RPCS,
  grantsSection,
  parseReadOnlyTables,
  parseRpcCatalog,
  readReadOnlyTables,
  readRpcCatalog,
  scanProject,
  scanSource,
} from "../../scripts/lib/client-contract.mjs";
import { connect, type Client } from "./harness";
import { HARDENING_MIGRATION, PLAYOFFS_MIGRATION, POOL_BUILDER_MIGRATION, readMigrations } from "./migrations-lib";

const GRANTING_MIGRATIONS = [HARDENING_MIGRATION, PLAYOFFS_MIGRATION, POOL_BUILDER_MIGRATION];

describe("client contract", () => {
  let db: Client;
  let catalog: string[];
  let readOnlyTables: string[];

  beforeAll(async () => {
    db = await connect();
    catalog = readRpcCatalog(process.cwd());
    readOnlyTables = readReadOnlyTables(process.cwd());
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
    expect(catalog).toHaveLength(31);
    for (const legacy of LEGACY_RPCS) {
      expect(catalog).not.toContain(legacy);
    }
    // Per file: the hardening file grants the 28 first-release functions, the
    // playoffs file the three new ones plus the six it re-creates, the pool
    // builder file no function at all (its grants section only names the
    // read-only pokemon table), and the base schema and the eight legacy
    // files have no grants section.
    const migrations = readMigrations();
    const hardening = migrations.find((m) => m.name === HARDENING_MIGRATION);
    const playoffs = migrations.find((m) => m.name === PLAYOFFS_MIGRATION);
    const poolBuilder = migrations.find((m) => m.name === POOL_BUILDER_MIGRATION);
    if (!hardening || !playoffs || !poolBuilder) throw new Error("hardening, playoffs or pool builder migration missing");
    expect(parseRpcCatalog(hardening.sql)).toHaveLength(28);
    expect(parseRpcCatalog(playoffs.sql)).toEqual([
      "clear_match_result",
      "clear_playoffs",
      "create_league",
      "generate_playoffs",
      "generate_schedule",
      "league_standings",
      "report_match_result",
      "reset_draft",
      "update_league_settings",
    ]);
    expect(parseRpcCatalog(poolBuilder.sql)).toEqual([]);
    expect(parseReadOnlyTables(hardening.sql)).toEqual([]);
    expect(parseReadOnlyTables(playoffs.sql)).toEqual([]);
    expect(parseReadOnlyTables(poolBuilder.sql)).toEqual(["pokemon"]);
    // The parser must see the same section whatever line endings the checkout
    // has: git's core.autocrlf (the Windows default) hands it CRLF files, and
    // a section boundary that only matched LF ran the pool builder's section
    // into the _migration_report() body, whose VALUES rows name six more
    // tables, so the gate's read-only list depended on the platform.
    const asCrlf = (sql: string) => sql.replace(/\r?\n/g, "\r\n");
    const asLf = (sql: string) => sql.replace(/\r\n?/g, "\n");
    for (const migration of [hardening, playoffs, poolBuilder]) {
      expect(grantsSection(asCrlf(migration.sql)), `${migration.name} grants section on CRLF`).toBe(grantsSection(asLf(migration.sql)));
    }
    expect(parseReadOnlyTables(asCrlf(poolBuilder.sql))).toEqual(["pokemon"]);
    expect(parseReadOnlyTables(asLf(poolBuilder.sql))).toEqual(["pokemon"]);
    expect(parseRpcCatalog(asCrlf(hardening.sql))).toHaveLength(28);
    expect(parseRpcCatalog(asLf(hardening.sql))).toHaveLength(28);
    expect(parseRpcCatalog(asCrlf(playoffs.sql))).toEqual(parseRpcCatalog(asLf(playoffs.sql)));
    for (const migration of migrations) {
      if (!GRANTING_MIGRATIONS.includes(migration.name)) {
        expect(grantsSection(migration.sql), `${migration.name} should have no grants section`).toBeNull();
      }
    }
    expect(() => parseRpcCatalog("-- nothing here")).toThrow(/Grants/);
    expect(() => parseReadOnlyTables("-- nothing here")).toThrow(/Grants/);
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

  it("the read-only tables the gate knows are exactly the tables the API roles may select but never write", async () => {
    expect(readOnlyTables).toEqual(["pokemon"]);
    // Derived from the privileges themselves: a table authenticated can read
    // but not insert, update or delete (the function-only tables keep their
    // write privileges and rely on RLS, so they do not qualify).
    const { rows } = await db.query<{ tablename: string }>(`
      select c.relname as tablename
      from pg_class c
      where c.relnamespace = 'public'::regnamespace
        and c.relkind = 'r'
        and has_table_privilege('authenticated', c.oid, 'select')
        and not has_table_privilege('authenticated', c.oid, 'insert')
        and not has_table_privilege('authenticated', c.oid, 'update')
        and not has_table_privilege('authenticated', c.oid, 'delete')
      order by 1
    `);
    expect(rows.map((r) => r.tablename)).toEqual(readOnlyTables);
    for (const table of readOnlyTables) {
      const anon = await db.query<{ ok: boolean }>("select has_table_privilege('anon', $1, 'select') as ok", [`public.${table}`]);
      expect(anon.rows[0].ok, `anon should not read ${table}`).toBe(false);
      const policies = await db.query<{ cmd: string; roles: string }>(
        "select cmd, roles::text as roles from pg_policies where schemaname = 'public' and tablename = $1 order by 1",
        [table],
      );
      expect(policies.rows, `${table} should have one select policy for authenticated`).toEqual([{ cmd: "SELECT", roles: "{authenticated}" }]);
    }
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
      /* 19 */ 'const { data: dataset } = await supabase.from("pokemon").select("display_name, slug, sprite_url, type1, type2").range(0, 999);',
      /* 20 */ 'await supabase.from("pokemon").upsert(rows, { onConflict: "id" });',
      /* 21 */ "await supabase.from('pokemon').delete().not('id', 'in', ids);",
    ].join("\n");
    const findings = scanSource(source, "fixture.tsx", catalog, readOnlyTables);
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
      [20, "direct_write"],
      [21, "direct_write"],
    ]);
    for (const finding of findings) {
      expect(finding.file).toBe("fixture.tsx");
      expect(finding.detail.length).toBeGreaterThan(0);
    }
    expect(findings.filter((f) => f.line >= 20).every((f) => f.detail.includes("read-only"))).toBe(true);
    // Without the read-only list (the default) the dataset writes pass the
    // scanner, so the gate has to be handed both lists, as scanProject does.
    expect(scanSource(source, "fixture.tsx", catalog).map((f) => f.line)).not.toContain(20);
    expect(scanSource("", "empty.ts", catalog, readOnlyTables)).toEqual([]);
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

  it("the release gate passes on this working tree: app/ and proxy.ts call no dropped or unknown RPC and write to no function-only or read-only table", () => {
    // The same scan as `node scripts/check-client-contract.mjs`, so a client
    // that is not yet on the RPC catalog fails `npm run test:db` instead of
    // only the gate the README asks the deployer to run by hand.
    const { files, findings } = scanProject(process.cwd(), catalog, readOnlyTables);
    expect(files).toBeGreaterThan(0);
    expect(
      findings.map((f) => `${f.file}:${f.line} [${f.kind}] ${f.detail}`),
      "the client still uses calls the hardening migration removes; replace them with the wrappers in app/lib/rpc.ts (README: \"The deployed client must be on the RPC catalog first\")",
    ).toEqual([]);
  });
});
