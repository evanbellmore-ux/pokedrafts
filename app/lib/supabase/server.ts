import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/app/lib/supabase/env";

/**
 * Server-side Supabase client for route handlers, server components and
 * layouts. Always create a fresh client per request; never share one.
 *
 * `setAll` is wrapped in try/catch because server components cannot write
 * cookies; in that case the proxy is responsible for refreshing sessions.
 */
export async function createServerSupabase(): Promise<SupabaseClient> {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a server component: cookies are read-only there and
          // the proxy already refreshed the session for this request.
        }
      },
    },
  });
}
