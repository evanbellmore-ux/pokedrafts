import { getSupabaseEnv } from "@/app/lib/supabase/env";

/** The sign-in providers beyond email and password that the login and sign-up pages offer. */
export type SignInProviders = { discord: boolean };

/** No provider beyond email and password. */
export const NO_PROVIDERS: SignInProviders = { discord: false };

/** Seconds the project's auth settings are cached between reads. */
export const PROVIDERS_REVALIDATE_SECONDS = 300;

/**
 * The providers the Supabase project has turned on (its public
 * `/auth/v1/settings`, whose `external` lists each provider's on/off), so
 * Continue with Discord shows once Discord is on in the dashboard and never
 * leads to Supabase's "provider is not enabled" page. Read on the server and
 * cached for five minutes; none when the settings cannot be read.
 */
export async function signInProviders(): Promise<SignInProviders> {
  try {
    const { url, anonKey } = getSupabaseEnv();
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      next: { revalidate: PROVIDERS_REVALIDATE_SECONDS },
    });
    if (!response.ok) return NO_PROVIDERS;
    const settings: unknown = await response.json();
    const external =
      typeof settings === "object" && settings !== null
        ? (settings as { external?: Record<string, unknown> }).external
        : undefined;
    return { discord: external?.discord === true };
  } catch {
    return NO_PROVIDERS;
  }
}
