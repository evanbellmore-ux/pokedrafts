import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/app/lib/supabase/env";

let browserClient: SupabaseClient | null = null;

/**
 * Browser Supabase client singleton. `createBrowserClient` already caches
 * its instance, but holding our own reference keeps the type stable and
 * avoids re-reading the environment on every call.
 */
export function createClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const { url, anonKey } = getSupabaseEnv();
  browserClient = createBrowserClient(url, anonKey);
  return browserClient;
}

/**
 * Lazy alias for modules that prefer a constant. Property access constructs
 * the singleton on first use so importing this module has no side effects
 * during server rendering.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = createClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
