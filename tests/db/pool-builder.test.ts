// Section 13 of docs/release-architecture.md, the database side of Pool
// Builder v2 (supabase/migrations/20260916120000_pool_builder.sql).
//
// Covers: the file sorts last and applies on a fresh database after the
// hardening and playoffs files, twice, and again after those two are re-run;
// the public.pokemon table of 13.4 (every column, the generated bst, the
// unique and check constraints, the four indexes, RLS with one select policy
// and the read-only grants); the committed seed file inserting cleanly
// (visibly skipped while data/pokemon/pokemon.json is not generated yet);
// anon cannot read the table, authenticated can, neither can write it and the
// service role can; _migration_report() listing a missing unique constraint
// on the table and a re-run adding it back; the seed script's write order
// (park the rows whose slug or display name moved to another id, upsert,
// delete the stale rows) seeding a refresh that moves names between ids where
// the upsert alone fails with 23505; and draft_formats.json accepting a
// "rules" key next to "pokemon" while _format_pool and update_league_pool
// still copy only { name, points, tier }.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parkedValue, readSeedRows, rowsToPark } from "../../scripts/seed-pokemon";
import { asAnon, asUser, connect, count, createUser, expectSqlState, leagueRow, rolledBack, rpcAs, type Client } from "./harness";
import {
  HARDENING_MIGRATION,
  PLAYOFFS_MIGRATION,
  POOL_BUILDER_MIGRATION,
  applyMigration,
  createDatabaseSql,
  createScaffolding,
  readMigrations,
  type MigrationFile,
} from "./migrations-lib";

const FRESH_DB = "pokedrafts_pool_builder_fresh";
const SEED_DB = "pokedrafts_pool_builder_seed";
const SEED_FILE = resolve(process.cwd(), "data", "pokemon", "pokemon.json");
const seedFileExists = existsSync(SEED_FILE);
if (!seedFileExists) {
  console.warn(`[pool-builder] ${SEED_FILE} does not exist yet (npm run data:pokemon writes it); the seed-file case is skipped.`);
}

const STATS = ["hp", "attack", "defense", "special_attack", "special_defense", "speed"] as const;

// The writable columns of public.pokemon, in table order. bst is generated and
// updated_at defaults, so a row from the seed file is reduced to these before
// it is inserted (the seed script does the same).
const COLUMNS = [
  "id",
  "species_id",
  "slug",
  "display_name",
  "species_name",
  "form_kind",
  "form_label",
  "type1",
  "type2",
  ...STATS,
  "generation",
  "tags",
  "games",
  "dex_numbers",
  "sprite_url",
] as const;
const RECORD_SHAPE =
  "id integer, species_id integer, slug text, display_name text, species_name text, form_kind text, form_label text, type1 text, type2 text, " +
  "hp smallint, attack smallint, defense smallint, special_attack smallint, special_defense smallint, speed smallint, " +
  "generation smallint, tags text[], games text[], dex_numbers jsonb, sprite_url text";

type Row = Record<string, unknown>;

// Two rows of one species, a default form and its Mega, with ids far above
// anything PokéAPI assigns so they never collide with the seed file.
const FIXTURE: Row[] = [
  {
    id: 900001,
    species_id: 9001,
    slug: "testmon",
    display_name: "Testmon",
    species_name: "Testmon",
    form_kind: "default",
    form_label: null,
    type1: "Fire",
    type2: "Flying",
    hp: 78,
    attack: 84,
    defense: 78,
    special_attack: 109,
    special_defense: 85,
    speed: 100,
    generation: 1,
    tags: ["legendary", "sub_legendary"],
    games: ["champions", "scarlet_violet"],
    dex_numbers: { paldea: 12, champions: 6 },
    sprite_url: "https://example.test/testmon.png",
  },
  {
    id: 900002,
    species_id: 9001,
    slug: "testmon-mega",
    display_name: "Mega Testmon",
    species_name: "Testmon",
    form_kind: "mega",
    form_label: "Mega",
    type1: "Fire",
    type2: "Dragon",
    hp: 78,
    attack: 104,
    defense: 78,
    special_attack: 159,
    special_defense: 115,
    speed: 100,
    generation: 1,
    tags: ["legendary", "sub_legendary"],
    games: ["champions"],
    dex_numbers: { champions: 6 },
    sprite_url: null,
  },
];
const FIXTURE_BST = [534, 634];

function statTotal(row: Row): number {
  return STATS.reduce((sum, stat) => sum + Number(row[stat]), 0);
}

// One statement for any number of rows: the seed file is about 1,230 of them.
async function insertRows(client: Client, rows: Row[]): Promise<void> {
  const reduced = rows.map((row) => Object.fromEntries(COLUMNS.map((column) => [column, row[column] ?? null])));
  await client.query(
    `insert into public.pokemon (${COLUMNS.join(", ")})
     select ${COLUMNS.join(", ")} from jsonb_to_recordset($1::jsonb) as r(${RECORD_SHAPE})`,
    [JSON.stringify(reduced)],
  );
}

// The statement PostgREST runs for the seed script's
// supabase.from("pokemon").upsert(batch, { onConflict: "id" }): one insert
// per batch with on conflict (id) do update on every column, so the unique
// constraints on slug and display_name are checked row by row.
async function upsertRows(client: Client, rows: Row[]): Promise<void> {
  const reduced = rows.map((row) => Object.fromEntries(COLUMNS.map((column) => [column, row[column] ?? null])));
  await client.query(
    `insert into public.pokemon (${COLUMNS.join(", ")})
     select ${COLUMNS.join(", ")} from jsonb_to_recordset($1::jsonb) as r(${RECORD_SHAPE})
     on conflict (id) do update set ${COLUMNS.map((column) => `${column} = excluded.${column}`).join(", ")}, updated_at = now()`,
    [JSON.stringify(reduced)],
  );
}

async function namesById(client: Client, from: number): Promise<Array<{ id: number; slug: string; display_name: string }>> {
  const { rows } = await client.query<{ id: number; slug: string; display_name: string }>(
    "select id, slug, display_name from public.pokemon where id >= $1 order by id",
    [from],
  );
  return rows;
}

function migrationNamed(migrations: MigrationFile[], name: string): MigrationFile {
  const migration = migrations.find((m) => m.name === name);
  if (!migration) throw new Error(`${name} not found under supabase/migrations`);
  return migration;
}

// The state section 13.4 describes, checked on the shared database and on a
// fresh one after every apply order the tests try.
async function assertPoolBuilderState(client: Client): Promise<void> {
  const columns = await client.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    is_generated: string;
    generation_expression: string | null;
  }>(
    `select column_name, data_type, is_nullable, column_default, is_generated, generation_expression
     from information_schema.columns where table_schema = 'public' and table_name = 'pokemon' order by ordinal_position`,
  );
  expect(columns.rows.map((r) => r.column_name)).toEqual([
    "id",
    "species_id",
    "slug",
    "display_name",
    "species_name",
    "form_kind",
    "form_label",
    "type1",
    "type2",
    ...STATS,
    "bst",
    "generation",
    "tags",
    "games",
    "dex_numbers",
    "sprite_url",
    "updated_at",
  ]);
  const column = new Map(columns.rows.map((r) => [r.column_name, r]));
  expect(column.get("id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
  expect(column.get("species_id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
  for (const name of ["slug", "display_name", "species_name", "form_kind", "type1"]) {
    expect(column.get(name), name).toMatchObject({ data_type: "text", is_nullable: "NO" });
  }
  for (const name of ["form_label", "type2", "sprite_url"]) {
    expect(column.get(name), name).toMatchObject({ data_type: "text", is_nullable: "YES" });
  }
  for (const stat of STATS) {
    expect(column.get(stat), stat).toMatchObject({ data_type: "smallint", is_nullable: "NO", is_generated: "NEVER" });
  }
  expect(column.get("bst")).toMatchObject({ data_type: "smallint", is_generated: "ALWAYS" });
  for (const stat of STATS) {
    expect(column.get("bst")?.generation_expression, `bst sums ${stat}`).toContain(stat);
  }
  expect(column.get("generation")).toMatchObject({ data_type: "smallint", is_nullable: "NO" });
  expect(column.get("tags")).toMatchObject({ data_type: "ARRAY", is_nullable: "NO", column_default: "'{}'::text[]" });
  expect(column.get("games")).toMatchObject({ data_type: "ARRAY", is_nullable: "NO", column_default: "'{}'::text[]" });
  expect(column.get("dex_numbers")).toMatchObject({ data_type: "jsonb", is_nullable: "NO", column_default: "'{}'::jsonb" });
  expect(column.get("updated_at")).toMatchObject({ data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" });

  // Postgres 18 lists not-null constraints in pg_constraint too (contype 'n');
  // the columns check above already covers those.
  const constraints = await client.query<{ conname: string; contype: string; def: string; convalidated: boolean }>(
    "select conname, contype, pg_get_constraintdef(oid) as def, convalidated from pg_constraint where conrelid = 'public.pokemon'::regclass and contype in ('p', 'u', 'c') order by conname",
  );
  expect(constraints.rows.map((r) => [r.conname, r.contype, r.convalidated])).toEqual([
    ["pokemon_display_name_key", "u", true],
    ["pokemon_form_kind_check", "c", true],
    ["pokemon_generation_check", "c", true],
    ["pokemon_pkey", "p", true],
    ["pokemon_slug_key", "u", true],
  ]);
  const def = new Map(constraints.rows.map((r) => [r.conname, r.def]));
  expect(def.get("pokemon_form_kind_check")).toContain("'default'");
  expect(def.get("pokemon_form_kind_check")).toContain("'other'");
  expect(def.get("pokemon_generation_check")).toContain("1");
  expect(def.get("pokemon_generation_check")).toContain("9");

  const indexes = await client.query<{ indexname: string; indexdef: string }>(
    "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'pokemon' order by indexname",
  );
  const index = new Map(indexes.rows.map((r) => [r.indexname, r.indexdef]));
  expect([...index.keys()]).toEqual([
    "pokemon_bst_idx",
    "pokemon_display_name_key",
    "pokemon_games_idx",
    "pokemon_pkey",
    "pokemon_slug_key",
    "pokemon_species_id_idx",
    "pokemon_tags_idx",
  ]);
  expect(index.get("pokemon_species_id_idx")).toContain("USING btree (species_id)");
  expect(index.get("pokemon_bst_idx")).toContain("USING btree (bst)");
  expect(index.get("pokemon_tags_idx")).toContain("USING gin (tags)");
  expect(index.get("pokemon_games_idx")).toContain("USING gin (games)");

  const rls = await client.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'public.pokemon'::regclass");
  expect(rls.rows[0].relrowsecurity).toBe(true);
  const policies = await client.query<{ policyname: string; cmd: string; roles: string; qual: string | null; with_check: string | null }>(
    "select policyname, cmd, roles::text as roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'pokemon'",
  );
  expect(policies.rows).toEqual([{ policyname: "Signed-in users can read the dataset", cmd: "SELECT", roles: "{authenticated}", qual: "true", with_check: null }]);

  // Grants: authenticated reads, the service role (the seed script) writes,
  // anon has nothing. RLS is the second line; this is the first.
  const privileges = await client.query<{ role: string; priv: string; ok: boolean }>(`
    select r.role, p.priv, has_table_privilege(r.role, 'public.pokemon', p.priv) as ok
    from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
    cross join unnest(array['select', 'insert', 'update', 'delete']) as p(priv)
    order by 1, 2`);
  expect(privileges.rows.filter((r) => r.ok).map((r) => `${r.role}:${r.priv}`)).toEqual([
    "authenticated:select",
    "service_role:delete",
    "service_role:insert",
    "service_role:select",
    "service_role:update",
  ]);

  // pokemon_dex and pokemon_forms are untouched in this release.
  const legacy = await client.query<{ tablename: string; n: number }>(
    "select tablename, count(*)::int as n from pg_policies where schemaname = 'public' and tablename in ('pokemon_dex', 'pokemon_forms') group by 1 order by 1",
  );
  expect(legacy.rows).toEqual([
    { tablename: "pokemon_dex", n: 1 },
    { tablename: "pokemon_forms", n: 1 },
  ]);
}

describe("pool builder migration", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
    await db.query("delete from public.pokemon where id >= 900000");
    await insertRows(db, FIXTURE);
  });

  afterAll(async () => {
    await db.query("delete from public.pokemon where id >= 900000");
    await db.end();
  });

  it("is the last migration file, after the hardening and playoffs files", () => {
    const names = readMigrations().map((m) => m.name);
    expect(names.at(-1)).toBe(POOL_BUILDER_MIGRATION);
    expect(names.indexOf(POOL_BUILDER_MIGRATION)).toBeGreaterThan(names.indexOf(PLAYOFFS_MIGRATION));
    expect(names.indexOf(PLAYOFFS_MIGRATION)).toBeGreaterThan(names.indexOf(HARDENING_MIGRATION));
  });

  it("creates the public.pokemon table of section 13.4 with its constraints, indexes, generated bst, RLS and grants", async () => {
    await assertPoolBuilderState(db);
    const { rows } = await db.query<{ slug: string; bst: number; sum: number }>(
      "select slug, bst, (hp + attack + defense + special_attack + special_defense + speed)::int as sum from public.pokemon where id >= 900000 order by id",
    );
    expect(rows).toEqual([
      { slug: "testmon", bst: FIXTURE_BST[0], sum: FIXTURE_BST[0] },
      { slug: "testmon-mega", bst: FIXTURE_BST[1], sum: FIXTURE_BST[1] },
    ]);
    expect(FIXTURE.map(statTotal)).toEqual(FIXTURE_BST);
    // bst cannot be written, only derived.
    await expectSqlState(db.query("update public.pokemon set bst = 1 where id = 900001"), "428C9");
    // The check constraints and the uniques hold.
    await expectSqlState(
      db.query("insert into public.pokemon (id, species_id, slug, display_name, species_name, form_kind, type1, hp, attack, defense, special_attack, special_defense, speed, generation) values (900003, 9001, 'testmon-x', 'Testmon X', 'Testmon', 'gigantamax', 'Fire', 1, 1, 1, 1, 1, 1, 1)"),
      "23514",
    );
    await expectSqlState(
      db.query("insert into public.pokemon (id, species_id, slug, display_name, species_name, form_kind, type1, hp, attack, defense, special_attack, special_defense, speed, generation) values (900003, 9001, 'testmon-x', 'Testmon X', 'Testmon', 'other', 'Fire', 1, 1, 1, 1, 1, 1, 10)"),
      "23514",
    );
    await expectSqlState(
      db.query("insert into public.pokemon (id, species_id, slug, display_name, species_name, form_kind, type1, hp, attack, defense, special_attack, special_defense, speed, generation) values (900003, 9001, 'testmon', 'Testmon X', 'Testmon', 'other', 'Fire', 1, 1, 1, 1, 1, 1, 1)"),
      "23505",
    );
    await expectSqlState(
      db.query("insert into public.pokemon (id, species_id, slug, display_name, species_name, form_kind, type1, hp, attack, defense, special_attack, special_defense, speed, generation) values (900003, 9001, 'testmon-x', 'Testmon', 'Testmon', 'other', 'Fire', 1, 1, 1, 1, 1, 1, 1)"),
      "23505",
    );
  });

  it("applies on an empty database after the hardening and playoffs files, twice, and again after those two are re-run", async () => {
    await db.query(`drop database if exists ${FRESH_DB}`);
    await db.query(createDatabaseSql(FRESH_DB));
    const fresh = await connect(FRESH_DB);
    const notices: string[] = [];
    fresh.on("notice", (n) => notices.push(n.message ?? ""));
    try {
      await createScaffolding(fresh);
      const migrations = readMigrations();
      for (const migration of migrations) {
        await applyMigration(fresh, migration);
      }
      await assertPoolBuilderState(fresh);
      // The file loads no data and says so, without a report row: an empty
      // table is the expected state between step 1 and step 2 of 13.9.
      expect(notices.some((n) => n.includes("public.pokemon is empty") && n.includes("npm run seed:pokemon"))).toBe(true);
      expect((await fresh.query("select * from public._migration_report()")).rows).toEqual([]);

      // A second time on its own.
      await applyMigration(fresh, migrationNamed(migrations, POOL_BUILDER_MIGRATION));
      await assertPoolBuilderState(fresh);

      // The hardening and playoffs files re-run in filename order leave the
      // table, its policy and its grants alone (the hardening policy loop
      // only touches its own tables), and the pool builder file re-run
      // after them restores the extended report.
      await applyMigration(fresh, migrationNamed(migrations, HARDENING_MIGRATION));
      await applyMigration(fresh, migrationNamed(migrations, PLAYOFFS_MIGRATION));
      await assertPoolBuilderState(fresh);
      await applyMigration(fresh, migrationNamed(migrations, POOL_BUILDER_MIGRATION));
      await assertPoolBuilderState(fresh);
      expect((await fresh.query("select * from public._migration_report()")).rows).toEqual([]);

      // With data in the table a re-run keeps every row and reports the count.
      await insertRows(fresh, FIXTURE);
      notices.length = 0;
      await applyMigration(fresh, migrationNamed(migrations, POOL_BUILDER_MIGRATION));
      expect(notices.some((n) => n.includes("public.pokemon holds 2 row(s)"))).toBe(true);
      expect(notices.some((n) => n.includes("nothing left to fix"))).toBe(true);
      expect(await count(fresh, "pokemon", "true")).toBe(2);

      const policyCount = await fresh.query<{ n: number }>("select count(*)::int as n from pg_policies where schemaname = 'public'");
      expect(policyCount.rows[0].n).toBe(17);
    } finally {
      await fresh.end();
      await db.query(`drop database if exists ${FRESH_DB}`);
    }
  });

  it.skipIf(!seedFileExists)(
    seedFileExists
      ? "the committed seed file data/pokemon/pokemon.json inserts cleanly and bst is generated for every row"
      : "the committed seed file data/pokemon/pokemon.json inserts cleanly and bst is generated for every row (SKIPPED: the file is not generated yet, run npm run data:pokemon)",
    async () => {
      const rows = JSON.parse(readFileSync(SEED_FILE, "utf8")) as Row[];
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(1000);
      // The seed script's own validation accepts the committed file.
      expect(readSeedRows(SEED_FILE).map((row) => row.id)).toEqual(rows.map((row) => row.id));

      // Loaded into a database with the project's encoding (UTF8, like every
      // Supabase project): the shared test database follows the cluster
      // default, which on Windows is the OS code page and cannot store
      // Nidoran♀, and that would fail the file for the wrong reason.
      await db.query(`drop database if exists ${SEED_DB}`);
      await db.query(createDatabaseSql(SEED_DB));
      const seeded = await connect(SEED_DB);
      try {
        await createScaffolding(seeded);
        for (const migration of readMigrations()) {
          await applyMigration(seeded, migration);
        }
        const encoding = await seeded.query<{ encoding: string }>(
          "select pg_encoding_to_char(encoding) as encoding from pg_database where datname = current_database()",
        );
        expect(encoding.rows[0].encoding).toBe("UTF8");

        await insertRows(seeded, rows);
        expect(await count(seeded, "pokemon", "true")).toBe(rows.length);

        const mismatched = await seeded.query("select slug from public.pokemon where bst <> hp + attack + defense + special_attack + special_defense + speed");
        expect(mismatched.rows).toEqual([]);
        const stored = await seeded.query<{ id: number; bst: number }>("select id, bst from public.pokemon");
        const bstById = new Map(stored.rows.map((r) => [r.id, r.bst]));
        for (const row of rows) {
          const expected = statTotal(row);
          expect(bstById.get(Number(row.id)), `bst of ${String(row.slug)}`).toBe(expected);
          if (typeof row.bst === "number") {
            expect(row.bst, `the file's bst for ${String(row.slug)}`).toBe(expected);
          }
        }

        // Every form kind is represented and every species has a default row.
        const kinds = await seeded.query<{ form_kind: string }>("select distinct form_kind from public.pokemon order by 1");
        expect(kinds.rows.map((r) => r.form_kind)).toEqual(["default", "gender", "mega", "other", "regional"]);
        const speciesWithoutDefault = await seeded.query(
          "select species_id from public.pokemon group by species_id having count(*) filter (where form_kind = 'default') <> 1",
        );
        expect(speciesWithoutDefault.rows).toEqual([]);

        // The GIN indexes answer the builder's tag and game filters.
        expect(await count(seeded, "pokemon", "tags @> array['legendary']")).toBeGreaterThan(0);
        expect(await count(seeded, "pokemon", "games @> array['champions']")).toBeGreaterThan(0);
        expect(await count(seeded, "pokemon", "games @> array['scarlet_violet']")).toBeGreaterThan(0);

        // Names outside ASCII come back intact to a signed-in user.
        const nonAscii = rows.filter((row) => /[^\x20-\x7e]/.test(String(row.display_name)));
        expect(nonAscii.length).toBeGreaterThan(0);
        const user = await createUser(seeded);
        const readBack = await asUser(seeded, user, (c) =>
          c.query<{ id: number; display_name: string }>("select id, display_name from public.pokemon where id = any($1::int[]) order by id", [
            nonAscii.map((row) => Number(row.id)),
          ]),
        );
        expect(readBack.rows).toEqual(
          nonAscii.map((row) => ({ id: Number(row.id), display_name: String(row.display_name) })).sort((a, b) => a.id - b.id),
        );
      } finally {
        await seeded.end();
        await db.query(`drop database if exists ${SEED_DB}`);
      }
    },
  );

  it("anon cannot read the dataset", async () => {
    await expectSqlState(asAnon(db, (c) => c.query("select id from public.pokemon limit 1")), "42501");
  });

  it("signed-in users can read every column of the dataset", async () => {
    const user = await createUser(db);
    const visible = await asUser(db, user, (c) => count(c, "pokemon", "id >= 900000"));
    expect(visible).toBe(2);
    const { rows } = await asUser(db, user, (c) =>
      c.query<{ display_name: string; form_kind: string; type1: string; type2: string | null; bst: number; tags: string[]; games: string[]; dex_numbers: Record<string, number>; sprite_url: string | null }>(
        "select display_name, form_kind, type1, type2, bst, tags, games, dex_numbers, sprite_url from public.pokemon where id = 900002",
      ),
    );
    expect(rows).toEqual([
      {
        display_name: "Mega Testmon",
        form_kind: "mega",
        type1: "Fire",
        type2: "Dragon",
        bst: FIXTURE_BST[1],
        tags: ["legendary", "sub_legendary"],
        games: ["champions"],
        dex_numbers: { champions: 6 },
        sprite_url: null,
      },
    ]);
  });

  it("signed-in users cannot insert, update or delete the dataset; the service role can", async () => {
    const user = await createUser(db);
    await expectSqlState(
      asUser(db, user, (c) =>
        c.query(
          "insert into public.pokemon (id, species_id, slug, display_name, species_name, form_kind, type1, hp, attack, defense, special_attack, special_defense, speed, generation) values (900009, 9009, 'fakemon', 'Fakemon', 'Fakemon', 'default', 'Normal', 1, 1, 1, 1, 1, 1, 1)",
        ),
      ),
      "42501",
    );
    await expectSqlState(asUser(db, user, (c) => c.query("update public.pokemon set display_name = 'Hacked' where id = 900001")), "42501");
    await expectSqlState(asUser(db, user, (c) => c.query("delete from public.pokemon where id = 900001")), "42501");
    const after = await db.query<{ id: number; display_name: string }>("select id, display_name from public.pokemon where id >= 900000 order by id");
    expect(after.rows).toEqual([
      { id: 900001, display_name: "Testmon" },
      { id: 900002, display_name: "Mega Testmon" },
    ]);

    // The seed script's role: writes, bypassing RLS, and the rows are gone
    // again with the rollback.
    await rolledBack(db, async (c) => {
      await c.query("set local role service_role");
      await c.query("update public.pokemon set display_name = 'Seeded' where id = 900001");
      await c.query("delete from public.pokemon where id = 900002");
      const rows = await c.query<{ id: number; display_name: string }>("select id, display_name from public.pokemon where id >= 900000 order by id");
      expect(rows.rows).toEqual([{ id: 900001, display_name: "Seeded" }]);
    });
  });

  it("a refresh that moves a slug or display name to another id fails the plain upsert with 23505 and seeds cleanly in the script's order: park, upsert, delete stale", async () => {
    // The table as the previous run left it, and the new file: the first two
    // rows swap display names (a display-name fix in overrides.json moved
    // between ids), the third row is stale and its slug and display name now
    // belong to a new id (a row that gained a real PokéAPI id), the fourth is
    // unchanged and the fifth is new.
    const mon = (id: number, slug: string, displayName: string): Row => ({
      ...FIXTURE[0],
      id,
      species_id: id - 890000,
      slug,
      display_name: displayName,
      species_name: displayName,
    });
    const before = [mon(900011, "swapmon-a", "Swapmon A"), mon(900012, "swapmon-b", "Swapmon B"), mon(900013, "oldmon", "Oldmon"), mon(900015, "keepmon", "Keepmon")];
    const file = [
      mon(900011, "swapmon-a", "Swapmon B"),
      mon(900012, "swapmon-b", "Swapmon A"),
      mon(900014, "oldmon", "Oldmon"),
      mon(900015, "keepmon", "Keepmon"),
      mon(900016, "newmon", "Newmon"),
    ];
    const names = (rows: Row[]) => rows.map((row) => ({ id: Number(row.id), slug: String(row.slug), display_name: String(row.display_name) }));

    // The pure plan: the two swapped rows and the stale row are parked, the
    // unchanged row is not, and a file identical to the table parks nothing.
    expect(rowsToPark(names(before), names(file))).toEqual([900011, 900012, 900013]);
    expect(rowsToPark(names(before), names(before))).toEqual([]);
    expect(parkedValue(900011)).toBe("~900011");

    await rolledBack(db, async (c) => {
      await c.query("set local role service_role");
      await insertRows(c, before);

      // The upsert alone, as the script ran it before the parking step, in
      // one batch or in two: a swap fails whatever the row order, and a move
      // fails when the taker's batch runs before the giver's.
      await c.query("savepoint plain_upsert");
      await expectSqlState(upsertRows(c, file), "23505");
      await c.query("rollback to savepoint plain_upsert");
      await expectSqlState(upsertRows(c, [file[2]]), "23505");
      await c.query("rollback to savepoint plain_upsert");
      expect(await namesById(c, 900010)).toEqual(names(before));

      // The script's order.
      const existing = await namesById(c, 900010);
      for (const id of rowsToPark(existing, names(file))) {
        const parked = await c.query("update public.pokemon set slug = $1, display_name = $1 where id = $2", [parkedValue(id), id]);
        expect(parked.rowCount).toBe(1);
      }
      expect((await namesById(c, 900010)).map((row) => row.display_name)).toEqual(["~900011", "~900012", "~900013", "Keepmon"]);
      await upsertRows(c, file.slice(0, 2));
      await upsertRows(c, file.slice(2));
      const keep = new Set(file.map((row) => Number(row.id)));
      const stale = existing.map((row) => row.id).filter((id) => !keep.has(id));
      expect(stale).toEqual([900013]);
      await c.query("delete from public.pokemon where id = any($1::int[])", [stale]);

      expect(await namesById(c, 900010)).toEqual(names(file));
      expect(await count(c, "pokemon", "slug like '~%' or display_name like '~%'")).toBe(0);
    });

    // The file may not use the parking marker itself.
    const dir = mkdtempSync(join(tmpdir(), "pokedrafts-seed-"));
    try {
      const bad = join(dir, "pokemon.json");
      writeFileSync(bad, JSON.stringify([{ ...FIXTURE[0], display_name: "~Testmon" }]));
      expect(() => readSeedRows(bad)).toThrow(/display_name must not start with "~"/);
      writeFileSync(bad, JSON.stringify([{ ...FIXTURE[0], slug: "~testmon" }]));
      expect(() => readSeedRows(bad)).toThrow(/slug must not start with "~"/);
      writeFileSync(bad, JSON.stringify([FIXTURE[0], { ...FIXTURE[1], display_name: "Testmon" }]));
      expect(() => readSeedRows(bad)).toThrow(/duplicate display_name "Testmon"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("_migration_report() lists a missing unique constraint on public.pokemon, and re-running the file adds it back", async () => {
    const sql = migrationNamed(readMigrations(), POOL_BUILDER_MIGRATION).sql;
    await rolledBack(db, async (c) => {
      await c.query("alter table public.pokemon drop constraint pokemon_slug_key");
      const missing = await c.query<{ severity: string; item: string; action: string }>(
        "select severity, item, action from public._migration_report() where item like '%public.pokemon%'",
      );
      expect(missing.rows).toEqual([
        { severity: "warning", item: "unique (slug) on public.pokemon", action: "remove the duplicate rows, then re-run 20260916120000_pool_builder.sql" },
      ]);
      await c.query(sql);
      const again = await c.query("select item from public._migration_report() where item like '%public.pokemon%'");
      expect(again.rows).toEqual([]);
      await assertPoolBuilderState(c);
    });
  });

  it("draft_formats.json accepts a rules key next to pokemon, and _format_pool / update_league_pool still copy only { name, points, tier }", async () => {
    const user = await createUser(db);
    const rules = {
      version: "2.0",
      source: { kind: "games", games: ["champions"] },
      preset: "champions-m-c",
      filters: {
        bst: { min: null, max: 600 },
        stats: { hp: null, attack: null, defense: null, special_attack: null, special_defense: null, speed: 100 },
        generation: { min: null, max: null },
        types: [],
        excludeTags: ["mythical"],
        forms: { mega: true, regional: true, gender: true, other: true },
      },
      pricing: { mode: "bands", bands: [700, 680, 650, 620, 600, 580, 560, 540, 520, 500, 480, 460, 440, 420, 400, 380, 350, 320, 280, 0] },
    };
    const list = [
      { name: "Testmon", points: 20, tier: 1, slug: "testmon", bst: 534 },
      { name: "Mega Testmon", points: 19, tier: 2, slug: "testmon-mega", bst: 634 },
    ];
    const copied = [
      { name: "Testmon", points: 20, tier: 1 },
      { name: "Mega Testmon", points: 19, tier: 2 },
    ];

    // The check constraint only looks at "pokemon", so "rules" is stored as
    // sent, and a body without a pokemon array is still refused.
    const formatId = await asUser(db, user, async (c) => {
      const { rows } = await c.query<{ id: string }>("insert into public.draft_formats (name, json) values ($1, $2::jsonb) returning id", [
        "Rules format",
        JSON.stringify({ version: "2.0", leagueName: "Rules League", pokemon: list, rules }),
      ]);
      return rows[0].id;
    });
    const stored = await db.query<{ json: { rules: unknown; pokemon: unknown } }>("select json from public.draft_formats where id = $1", [formatId]);
    expect(stored.rows[0].json.rules).toEqual(rules);
    expect(stored.rows[0].json.pokemon).toEqual(list);
    await expectSqlState(
      asUser(db, user, (c) => c.query("insert into public.draft_formats (name, json) values ('No list', $1::jsonb)", [JSON.stringify({ version: "2.0", rules })])),
      "23514",
    );
    const check = await db.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'draft_formats_json_check'");
    expect(check.rows[0].def).toContain("'pokemon'");
    expect(check.rows[0].def).not.toContain("rules");

    // create_league copies the validated list only: no rules, no extra
    // entry fields, tier recomputed from points.
    const leagueId = await rpcAs<string>(db, user, "create_league", {
      p_name: "Rules League",
      p_team_name: "Commish",
      p_max_coaches: 4,
      p_draft_format_id: formatId,
      p_point_budget: 100,
      p_picks_per_team: 1,
      p_pick_timer_seconds: 60,
      p_playoff_format: "none",
      p_tiebreaker: "head_to_head",
    });
    const fromFormat = { version: "1.0", leagueName: "Rules League", pokemon: copied, source: "format", draft_format_id: formatId };
    expect((await leagueRow(db, leagueId)).custom_pool).toEqual(fromFormat);

    // update_league_pool ignores a rules key and extra entry fields too.
    await rpcAs(db, user, "update_league_pool", {
      p_league_id: leagueId,
      p_pool: { version: "2.0", leagueName: "Custom", pokemon: [{ name: "Testmon", points: 5, tier: 16, slug: "testmon", bst: 534 }], rules },
    });
    expect((await leagueRow(db, leagueId)).custom_pool).toEqual({ version: "1.0", leagueName: "Custom", pokemon: [{ name: "Testmon", points: 5, tier: 16 }] });

    // reset_league_pool copies the format again, still without rules.
    await rpcAs(db, user, "reset_league_pool", { p_league_id: leagueId });
    expect((await leagueRow(db, leagueId)).custom_pool).toEqual(fromFormat);
  });
});
