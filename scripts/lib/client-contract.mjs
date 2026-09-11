// Shared by scripts/check-client-contract.mjs (the release gate) and
// tests/db/client-contract.test.ts.
//
// After supabase/migrations/20260909120000_release_hardening.sql the browser
// can only mutate the league tables through the RPC catalog granted in its
// section 10, and the three legacy timer functions no longer exist. A client
// that still calls them gets PGRST202 (function not found); a direct insert
// gets 42501, and a direct update or delete that a policy filters out
// "succeeds" with zero rows. This module finds both kinds of call site in the
// client source so the migration is never applied ahead of the client.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Relative to the project root. */
export const HARDENING_MIGRATION = join("supabase", "migrations", "20260909120000_release_hardening.sql");

/** Tables the browser never writes to (docs/release-architecture.md, section 1). */
export const FUNCTION_ONLY_TABLES = [
  "leagues",
  "league_members",
  "league_invites",
  "draft_picks",
  "drafted_teams",
  "league_matches",
  "league_news",
];

/**
 * Direct writes the policy set still allows on those tables
 * (docs/schema.md, "Row level security").
 * @type {Record<string, string[]>}
 */
export const ALLOWED_DIRECT_WRITES = { leagues: ["delete"] };

/** Dropped by section 7 of the hardening migration. */
export const LEGACY_RPCS = ["start_draft_timer", "advance_draft_timer", "complete_draft_timer"];

/** Directories (recursive) and single files scanned under the project root. */
export const SCAN_DIRS = ["app"];
export const SCAN_FILES = ["proxy.ts"];

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs)$/;

/**
 * @typedef {"legacy_rpc" | "unknown_rpc" | "direct_write"} FindingKind
 * @typedef {{ file: string, line: number, kind: FindingKind, detail: string }} Finding
 */

/**
 * The API functions the hardening migration grants to the API roles: every
 * `'public.<name>(` entry in its section 10 whose name is not an internal
 * `_` helper. Sorted and unique.
 * @param {string} migrationSql
 * @returns {string[]}
 */
export function parseRpcCatalog(migrationSql) {
  const start = migrationSql.indexOf("-- 10. Grants");
  if (start < 0) {
    throw new Error("hardening migration: section '10. Grants' not found");
  }
  const end = migrationSql.indexOf("-- 11. Post-apply report", start);
  const section = migrationSql.slice(start, end < 0 ? undefined : end);
  const names = new Set();
  for (const match of section.matchAll(/'public\.([a-z][a-z0-9_]*)\(/g)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

/**
 * Finds `.rpc("<name>")` calls that name a dropped or unknown function and
 * `.from("<table>").<insert|update|upsert|delete>(` chains on the
 * function-only tables (the chain may span lines). Reads are never reported.
 * @param {string} source
 * @param {string} file label used in the findings
 * @param {string[]} catalog from parseRpcCatalog
 * @returns {Finding[]} ordered by line
 */
export function scanSource(source, file, catalog) {
  const known = new Set(catalog);
  /** @type {Finding[]} */
  const findings = [];
  /** @param {number | undefined} index */
  const lineOf = (index) => source.slice(0, index ?? 0).split("\n").length;

  for (const match of source.matchAll(/\.rpc\(\s*["']([A-Za-z0-9_]+)["']/g)) {
    const name = match[1];
    if (LEGACY_RPCS.includes(name)) {
      findings.push({ file, line: lineOf(match.index), kind: "legacy_rpc", detail: `rpc("${name}") was dropped by the hardening migration` });
    } else if (!known.has(name)) {
      findings.push({ file, line: lineOf(match.index), kind: "unknown_rpc", detail: `rpc("${name}") is not in the RPC catalog` });
    }
  }

  for (const match of source.matchAll(/\.from\(\s*["']([A-Za-z0-9_]+)["']\s*\)\s*\.\s*([A-Za-z]+)\s*\(/g)) {
    const table = match[1];
    const method = match[2];
    if (!FUNCTION_ONLY_TABLES.includes(table) || !WRITE_METHODS.has(method)) {
      continue;
    }
    if ((ALLOWED_DIRECT_WRITES[table] ?? []).includes(method)) {
      continue;
    }
    findings.push({ file, line: lineOf(match.index), kind: "direct_write", detail: `from("${table}").${method}() must go through the RPC catalog (app/lib/rpc.ts)` });
  }

  return findings.sort((a, b) => a.line - b.line);
}

/**
 * @param {string} dir
 * @param {string[]} out absolute paths, appended in place
 */
function collectSourceFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      collectSourceFiles(path, out);
    } else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(path);
    }
  }
}

/**
 * Scans app/ and proxy.ts under `root`.
 * @param {string} root project root (absolute)
 * @param {string[]} [catalog] defaults to the catalog parsed from the hardening migration under root
 * @returns {{ files: number, findings: Finding[] }}
 */
export function scanProject(root, catalog = parseRpcCatalog(readFileSync(join(root, HARDENING_MIGRATION), "utf8"))) {
  /** @type {string[]} */
  const files = [];
  for (const dir of SCAN_DIRS) {
    const path = join(root, dir);
    if (existsSync(path) && statSync(path).isDirectory()) {
      collectSourceFiles(path, files);
    }
  }
  for (const name of SCAN_FILES) {
    const path = join(root, name);
    if (existsSync(path)) {
      files.push(path);
    }
  }
  /** @type {Finding[]} */
  const findings = [];
  for (const path of files) {
    const label = relative(root, path).split(sep).join("/");
    findings.push(...scanSource(readFileSync(path, "utf8"), label, catalog));
  }
  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { files: files.length, findings };
}
