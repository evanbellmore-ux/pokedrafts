import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  getCurrentUser,
  isSessionMissingError,
} from "@/app/lib/auth/current-user";
import {
  ACCOUNT_UNAVAILABLE_ERROR,
  CONNECTION_ERROR,
} from "@/app/lib/errors";

/**
 * Client-side session classification (docs/release-architecture.md
 * section 8.2), against the REAL auth-js client.
 *
 * The defect this guards against: a loader that treats
 * `getUser().data.user === null` as "logged out" and navigates to /login.
 * auth-js keeps the local session for a network failure, a 5xx or a rejected
 * token, so the proxy still sees a valid cookie at /login and bounces the
 * user back to /dashboard, which fails the same way: an unbounded loop.
 * `getCurrentUser` only reports `signed-out` when auth-js itself has no
 * session (or has just removed it for `session_not_found`), so the proxy
 * always agrees with a client that navigates to /login.
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
const EMAIL = "coach@example.com";

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

const user = {
  id: USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: EMAIL,
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

function seededClient(fetchImpl: typeof fetch, { seeded = true } = {}) {
  const storage = memoryStorage();
  const storageKey = "sb-test-auth-token";
  if (seeded) {
    storage.setItem(
      storageKey,
      JSON.stringify({
        access_token: fakeJwt(NOW + 3600),
        refresh_token: "refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: NOW + 3600,
        user,
      })
    );
  }

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

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function countingFetch(respond: () => Promise<Response> | Response) {
  const calls: string[] = [];
  const impl: typeof fetch = async (input) => {
    calls.push(String(input));
    return respond();
  };
  return { calls, impl };
}

async function sessionStillHeld(client: ReturnType<typeof seededClient>["client"]) {
  const { data } = await client.auth.getSession();
  return data.session?.user.id === USER_ID;
}

describe("getCurrentUser with the real auth-js client", () => {
  it("is signed-in with id and email when the auth server confirms the session", async () => {
    const { calls, impl } = countingFetch(() => jsonResponse(200, user));
    const { client } = seededClient(impl);

    const result = await getCurrentUser(client.auth);

    expect(result).toEqual({
      status: "signed-in",
      user: { id: USER_ID, email: EMAIL },
    });
    expect(calls.some((url) => url.endsWith("/auth/v1/user"))).toBe(true);
  });

  it("reports a connection problem and keeps the session when the auth server is unreachable", async () => {
    const { client, storage, storageKey } = seededClient(async () => {
      throw new TypeError("Failed to fetch");
    });

    const result = await getCurrentUser(client.auth);

    // NOT signed-out: navigating to /login now would bounce straight back.
    expect(result).toEqual({ status: "error", message: CONNECTION_ERROR });
    expect(storage.map.has(storageKey)).toBe(true);
    expect(await sessionStillHeld(client)).toBe(true);
  });

  it("reports an error and keeps the session on a 5xx", async () => {
    const { client, storage, storageKey } = seededClient(async () =>
      jsonResponse(503, { code: 503, msg: "service unavailable" })
    );

    const result = await getCurrentUser(client.auth);

    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("unreachable");
    expect(result.message.trim().length).toBeGreaterThan(0);
    expect(storage.map.has(storageKey)).toBe(true);
  });

  it("reports an error and keeps the session when the token is rejected for a deleted user", async () => {
    // GoTrue answers 403 user_not_found for a valid JWT whose user is gone;
    // auth-js returns the error and keeps the session.
    const { client, storage, storageKey } = seededClient(async () =>
      jsonResponse(403, {
        error_code: "user_not_found",
        msg: "User from sub claim in JWT does not exist",
      })
    );

    const result = await getCurrentUser(client.auth);

    expect(result).toEqual({ status: "error", message: ACCOUNT_UNAVAILABLE_ERROR });
    expect(storage.map.has(storageKey)).toBe(true);
  });

  it("is signed-out, with the local session cleared, when the auth server answers session_not_found", async () => {
    const { client, storage, storageKey } = seededClient(async () =>
      jsonResponse(403, {
        error_code: "session_not_found",
        msg: "Session from session_id claim in JWT does not exist",
      })
    );

    const result = await getCurrentUser(client.auth);

    expect(result).toEqual({ status: "signed-out" });
    // auth-js removed the session, so the cookies the proxy reads are gone
    // too and /login renders instead of bouncing.
    expect(storage.map.has(storageKey)).toBe(false);
    expect(await sessionStillHeld(client)).toBe(false);
  });

  it("is signed-out without a network call when there is no local session", async () => {
    const { calls, impl } = countingFetch(() => jsonResponse(200, user));
    const { client } = seededClient(impl, { seeded: false });

    const result = await getCurrentUser(client.auth);

    expect(result).toEqual({ status: "signed-out" });
    expect(calls).toEqual([]);
  });
});

describe("getCurrentUser with a stub", () => {
  it("never throws: a rejected getUser becomes an error result", async () => {
    const result = await getCurrentUser({
      getUser: async () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      },
    });
    expect(result).toEqual({ status: "error", message: CONNECTION_ERROR });
  });

  it("maps a returned retryable error through friendlyError and does not sign out", async () => {
    const result = await getCurrentUser({
      getUser: async () => ({
        data: { user: null },
        error: { name: "AuthRetryableFetchError", message: "Failed to fetch" },
      }),
    });
    expect(result).toEqual({ status: "error", message: CONNECTION_ERROR });
  });

  it("treats AuthSessionMissingError as signed-out", async () => {
    const result = await getCurrentUser({
      getUser: async () => ({
        data: { user: null },
        error: { name: "AuthSessionMissingError", message: "Auth session missing!" },
      }),
    });
    expect(result).toEqual({ status: "signed-out" });
  });

  it("normalises a missing email to null", async () => {
    const result = await getCurrentUser({
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    });
    expect(result).toEqual({
      status: "signed-in",
      user: { id: USER_ID, email: null },
    });
  });
});

describe("isSessionMissingError", () => {
  it("matches auth-js by name or by the GoTrue code", () => {
    expect(isSessionMissingError({ name: "AuthSessionMissingError" })).toBe(true);
    expect(isSessionMissingError({ name: "AuthApiError", code: "session_not_found" })).toBe(true);
    expect(isSessionMissingError({ name: "AuthRetryableFetchError" })).toBe(false);
    expect(isSessionMissingError({ name: "AuthApiError", code: "user_not_found" })).toBe(false);
    expect(isSessionMissingError(null)).toBe(false);
    expect(isSessionMissingError("session_not_found")).toBe(false);
  });
});

describe("call sites in the foundation track", () => {
  const root = resolve(__dirname, "../..");
  const files = [
    "app/(auth)/update-password/UpdatePasswordForm.tsx",
    "app/invite/[code]/InviteClient.tsx",
    "app/(app)/builder/BuilderClient.tsx",
    "app/(app)/dashboard/DashboardClient.tsx",
    "app/(app)/leagues/new/NewLeagueClient.tsx",
  ];

  it.each(files)("%s classifies the session through getCurrentUser", (file) => {
    const source = readFileSync(resolve(root, file), "utf8");
    expect(source).toContain("getCurrentUser(");
    // The original defect shape: reading data.user straight off getUser().
    expect(source).not.toMatch(/auth\.getUser\(\)/);
  });

  it("no module under app/ navigates to /login on the strength of data.user alone", () => {
    // Every page has adopted the helper; the assertion covers the whole app
    // tree so a regression fails `npm run test` instead of looping users in
    // production.
    const pending = new Set<string>();
    // The helper itself documents the anti-pattern in its JSDoc.
    const exempt = new Set(["app/lib/auth/current-user.ts"]);
    const offenders: string[] = [];
    for (const file of walkApp(root)) {
      const rel = file.slice(root.length + 1).split("\\").join("/");
      if (pending.has(rel) || exempt.has(rel)) continue;
      const source = readFileSync(file, "utf8");
      if (
        /auth\.getUser\(\)/.test(source) &&
        /router\.(?:push|replace)\(\s*["'`]\/login/.test(source)
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

function walkApp(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  visit(join(root, "app"));
  return out;
}
