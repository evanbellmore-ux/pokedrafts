import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { signOutLocally } from "@/app/lib/auth/sign-out";
import { CONNECTION_ERROR } from "@/app/lib/errors";

/**
 * Sign-out contract (docs/release-architecture.md section 3.2).
 *
 * auth-js `signOut({ scope: "local" })` still calls the auth server's
 * /logout endpoint, and when that request fails for any reason other than a
 * 401/403/404 (network failure, 5xx, rate limit) it RETURNS `{ error }` and
 * KEEPS the local session. If the app navigated to /login regardless, the
 * proxy would see the still-valid cookies and bounce the user straight back
 * to /dashboard with no explanation. `signOutLocally` (used by AppNav)
 * therefore reports `{ ok: false, message }` and AppNav only navigates on
 * `ok`.
 */

function base64url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const NOW = Math.floor(Date.now() / 1000);
const USER_ID = "8f3c9c1e-1111-4222-8333-444455556666";

function fakeJwt(exp: number) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ sub: USER_ID, role: "authenticated", exp, iat: NOW })
  );
  return `${header}.${payload}.${base64url("signature")}`;
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

function seededClient(fetchImpl: typeof fetch) {
  const storage = memoryStorage();
  const storageKey = "sb-test-auth-token";
  storage.setItem(
    storageKey,
    JSON.stringify({
      access_token: fakeJwt(NOW + 3600),
      refresh_token: "refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: NOW + 3600,
      user: { id: USER_ID, aud: "authenticated", email: "coach@example.com" },
    })
  );

  const client = createClient("http://127.0.0.1:1", "anon-key-for-tests", {
    auth: {
      storage,
      storageKey,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fetchImpl },
  });

  return { client, storage, storageKey };
}

const unreachableFetch: typeof fetch = async () => {
  throw new TypeError("Failed to fetch");
};

describe("auth-js signOut({ scope: 'local' }) when the auth server is unreachable", () => {
  it("returns an error and keeps the session in storage", async () => {
    const calls: string[] = [];
    const failingFetch: typeof fetch = async (input) => {
      calls.push(String(input));
      throw new TypeError("Failed to fetch");
    };

    const { client, storage, storageKey } = seededClient(failingFetch);

    const { error } = await client.auth.signOut({ scope: "local" });

    // The logout request was attempted even though the scope is local...
    expect(calls.some((url) => url.includes("/logout?scope=local"))).toBe(true);
    // ...it failed with a retryable fetch error that the caller must handle...
    expect(error).not.toBeNull();
    expect(error?.name).toBe("AuthRetryableFetchError");
    // ...and the local session was NOT removed, so the cookies the proxy
    // reads are still valid and /login would redirect back to /dashboard.
    expect(storage.map.has(storageKey)).toBe(true);
    const { data } = await client.auth.getSession();
    expect(data.session?.user.id).toBe(USER_ID);
  });

  it("clears the session when the server answers 401/403/404 or succeeds", async () => {
    const okFetch: typeof fetch = async () =>
      new Response(null, { status: 204 });
    const ok = seededClient(okFetch);
    expect((await ok.client.auth.signOut({ scope: "local" })).error).toBeNull();
    expect(ok.storage.map.has(ok.storageKey)).toBe(false);

    const unauthorizedFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ code: 401, msg: "invalid JWT" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    const stale = seededClient(unauthorizedFetch);
    expect((await stale.client.auth.signOut({ scope: "local" })).error).toBeNull();
    expect(stale.storage.map.has(stale.storageKey)).toBe(false);
  });
});

describe("signOutLocally (app/lib/auth/sign-out.ts)", () => {
  it("reports a connection problem and leaves the session intact when /logout is unreachable", async () => {
    const { client, storage, storageKey } = seededClient(unreachableFetch);

    const result = await signOutLocally(client.auth);

    expect(result).toEqual({ ok: false, message: CONNECTION_ERROR });
    expect(storage.map.has(storageKey)).toBe(true);
    const { data } = await client.auth.getSession();
    expect(data.session?.user.id).toBe(USER_ID);
  });

  it("reports failure with a user-facing message on a server error", async () => {
    const serverErrorFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ code: 500, msg: "unexpected failure" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    const { client, storage, storageKey } = seededClient(serverErrorFetch);

    const result = await signOutLocally(client.auth);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message.trim().length).toBeGreaterThan(0);
    // Still signed in, so the caller must not navigate.
    expect(storage.map.has(storageKey)).toBe(true);
  });

  it("succeeds once the session is really gone (204 or a stale 401)", async () => {
    const ok = seededClient(async () => new Response(null, { status: 204 }));
    expect(await signOutLocally(ok.client.auth)).toEqual({ ok: true });
    expect(ok.storage.map.has(ok.storageKey)).toBe(false);

    const stale = seededClient(
      async () =>
        new Response(JSON.stringify({ code: 401, msg: "invalid JWT" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
    );
    expect(await signOutLocally(stale.client.auth)).toEqual({ ok: true });
    expect(stale.storage.map.has(stale.storageKey)).toBe(false);
  });

  it("maps a returned auth error through friendlyError", async () => {
    const result = await signOutLocally({
      signOut: async () => ({
        error: { name: "AuthRetryableFetchError", message: "Failed to fetch" },
      }),
    });
    expect(result).toEqual({ ok: false, message: CONNECTION_ERROR });
  });

  it("never throws: a rejected signOut becomes { ok: false }", async () => {
    const result = await signOutLocally({
      signOut: async () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      },
    });
    expect(result).toEqual({ ok: false, message: CONNECTION_ERROR });
  });
});

describe("AppNav wiring", () => {
  const source = readFileSync(
    resolve(__dirname, "../../app/components/AppNav.tsx"),
    "utf8"
  );

  it("signs out through signOutLocally and navigates only on success", () => {
    expect(source).toContain("signOutLocally(");
    // The original defect: navigation in a `finally` ran even when signOut
    // returned an error and the session was still valid.
    expect(source).not.toMatch(/finally\s*\{[^}]*router\.(replace|push)/);
    // Navigation is guarded by the helper's result.
    expect(source).toMatch(
      /if \(result\.ok\) \{\s*router\.replace\("\/login"\);\s*router\.refresh\(\);/
    );
    expect(source).toContain("You are still signed in on this device.");
  });
});
