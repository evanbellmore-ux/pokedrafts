// Shared by the seeding scripts (both the .ts ones run through tsx and the
// .mjs one run by node). Loads .env.scripts, validates the two variables the
// scripts need, and builds a service-role Supabase client.
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

/**
 * @returns {{ url: string, serviceRoleKey: string }}
 */
export function loadScriptEnv() {
  dotenv.config({ path: ".env.scripts", quiet: true });
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    console.error(
      [
        `Missing ${missing.join(" and ")}.`,
        "Create .env.scripts in the project root (see .env.example) with the project URL and the",
        "service-role key from the Supabase dashboard (Project Settings > API). The service-role key",
        "bypasses row level security: keep it out of .env.local and never commit it.",
      ].join("\n"),
    );
    process.exit(1);
  }
  return { url: /** @type {string} */ (url), serviceRoleKey: /** @type {string} */ (serviceRoleKey) };
}

/**
 * @returns {import("@supabase/supabase-js").SupabaseClient}
 */
export function createAdminClient() {
  const { url, serviceRoleKey } = loadScriptEnv();
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Reads every row of a query by paging with .range() until a page comes back
 * short. PostgREST caps a single request at 1000 rows by default.
 *
 * @template T
 * @param {(from: number, to: number) => PromiseLike<{ data: T[] | null, error: { message: string } | null }>} page
 * @param {number} [pageSize]
 * @returns {Promise<T[]>}
 */
export async function fetchAllRows(page, pageSize = 1000) {
  /** @type {T[]} */
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) {
      throw new Error(`Supabase read failed: ${error.message}`);
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) {
      return rows;
    }
  }
}

/**
 * Splits an array into chunks of `size`.
 *
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
export function chunk(items, size) {
  /** @type {T[][]} */
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
