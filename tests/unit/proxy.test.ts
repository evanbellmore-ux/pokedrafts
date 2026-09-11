import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drives proxy.ts with a stand-in for @supabase/ssr that behaves like the
 * real client: when the session is refreshed (or cleared) it calls the
 * `setAll` adapter with the cookies and the Cache-Control headers the
 * library asks for, then resolves `getClaims`.
 */
type CookieWrite = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

type SetAll = (cookies: CookieWrite[], headers: Record<string, string>) => void;

/**
 * How the auth server answers the proxy's `getUser()` confirmation at an
 * auth-entry path (proxy.ts): `ok` (default) confirms the session,
 * `unreachable` is a network failure, `rejected` is a 403 for a deleted or
 * banned user (auth-js keeps the session), `session-missing` is GoTrue's
 * `session_not_found` (auth-js clears the session through setAll).
 */
type UserCheck = "ok" | "unreachable" | "rejected" | "session-missing";

type Scenario = {
  /** What getClaims resolves to. */
  claims: { sub: string } | null;
  /** Cookies the library writes during getClaims, if any. */
  writes?: CookieWrite[];
  user?: UserCheck;
};

const scenario: { current: Scenario } = { current: { claims: null } };
const userCalls = { count: 0 };

/** Exactly what @supabase/ssr passes as the second argument of setAll. */
const SSR_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { getAll: () => unknown; setAll: SetAll } }
  ) => ({
    auth: {
      async getClaims() {
        const { claims, writes } = scenario.current;
        if (writes && writes.length > 0) {
          options.cookies.setAll(writes, SSR_HEADERS);
        }
        return claims
          ? { data: { claims }, error: null }
          : { data: null, error: null };
      },
      async getUser() {
        userCalls.count += 1;
        const { claims, user = "ok" } = scenario.current;
        const sessionMissing = {
          name: "AuthSessionMissingError",
          message: "Auth session missing!",
        };
        if (!claims) return { data: { user: null }, error: sessionMissing };
        switch (user) {
          case "ok":
            return { data: { user: { id: claims.sub } }, error: null };
          case "unreachable":
            return {
              data: { user: null },
              error: {
                name: "AuthRetryableFetchError",
                message: "Failed to fetch",
                status: 0,
              },
            };
          case "rejected":
            return {
              data: { user: null },
              error: {
                name: "AuthApiError",
                message: "User from sub claim in JWT does not exist",
                status: 403,
                code: "user_not_found",
              },
            };
          case "session-missing":
            options.cookies.setAll(CLEARED, SSR_HEADERS);
            return { data: { user: null }, error: sessionMissing };
        }
      },
    },
  }),
}));

const ORIGIN = "https://pokedrafts.example";

const REFRESHED: CookieWrite[] = [
  {
    name: "sb-abc-auth-token.0",
    value: "refreshed-chunk-0",
    options: { path: "/", maxAge: 31536000, sameSite: "lax" },
  },
  {
    name: "sb-abc-auth-token.1",
    value: "refreshed-chunk-1",
    options: { path: "/", maxAge: 31536000, sameSite: "lax" },
  },
];

const CLEARED: CookieWrite[] = [
  { name: "sb-abc-auth-token", value: "", options: { path: "/", maxAge: 0 } },
];

async function run(path: string, s: Scenario, cookie?: string) {
  scenario.current = s;
  userCalls.count = 0;
  const { proxy } = await import("@/proxy");
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const request = new NextRequest(new URL(path, ORIGIN), { headers });
  return proxy(request);
}

function setCookieNames(response: Response) {
  return response.headers.getSetCookie().map((line) => line.split("=")[0]);
}

function location(response: Response) {
  return new URL(response.headers.get("location") ?? "");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy: refreshed cookies and cache headers survive every response", () => {
  it("pass-through response carries the refreshed cookies and Cache-Control", async () => {
    const response = await run("/dashboard", {
      claims: { sub: "user-1" },
      writes: REFRESHED,
    });
    expect(response.status).toBe(200);
    expect(setCookieNames(response)).toEqual([
      "sb-abc-auth-token.0",
      "sb-abc-auth-token.1",
    ]);
    expect(response.headers.get("cache-control")).toBe(
      SSR_HEADERS["Cache-Control"]
    );
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("redirect away from /login for a signed-in user keeps the refreshed cookies and headers", async () => {
    const response = await run("/login?next=%2Finvite%2FABC", {
      claims: { sub: "user-1" },
      writes: REFRESHED,
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/invite/ABC`);
    expect(setCookieNames(response)).toEqual([
      "sb-abc-auth-token.0",
      "sb-abc-auth-token.1",
    ]);
    expect(response.headers.get("cache-control")).toBe(
      SSR_HEADERS["Cache-Control"]
    );
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("redirect to /login for an invalid session carries the cleared cookies", async () => {
    const target = "/leagues/8f3c9c1e-1111-4222-8333-444455556666/draft?tab=picks";
    const response = await run(
      target,
      { claims: null, writes: CLEARED },
      "sb-abc-auth-token=garbage"
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/login?next=${encodeURIComponent(target)}`
    );
    const setCookie = response.headers.getSetCookie();
    expect(setCookie).toHaveLength(1);
    expect(setCookie[0]).toMatch(/^sb-abc-auth-token=; /);
    expect(setCookie[0]).toMatch(/Max-Age=0/);
    expect(response.headers.get("cache-control")).toBe(
      SSR_HEADERS["Cache-Control"]
    );
  });
});

describe("proxy: no redirect loops", () => {
  it("a stale cookie on /login renders the login page instead of bouncing", async () => {
    const response = await run(
      "/login",
      { claims: null, writes: CLEARED },
      "sb-abc-auth-token=garbage"
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("a stale cookie on /dashboard goes to /login exactly once", async () => {
    const first = await run(
      "/dashboard",
      { claims: null, writes: CLEARED },
      "sb-abc-auth-token=garbage"
    );
    expect(first.headers.get("location")).toBe(
      `${ORIGIN}/login?next=%2Fdashboard`
    );
    const second = await run("/login?next=%2Fdashboard", { claims: null });
    expect(second.status).toBe(200);
  });

  it("a signed-in user at /login?next=/login lands on /dashboard, not /login", async () => {
    const response = await run("/login?next=%2Flogin", {
      claims: { sub: "user-1" },
    });
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("a signed-in user at / is sent to /dashboard", async () => {
    const response = await run("/", { claims: { sub: "user-1" } });
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("confirms the session with the auth server exactly once before bouncing a signed-in user off /login", async () => {
    const response = await run("/login", { claims: { sub: "user-1" }, user: "ok" });
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
    expect(userCalls.count).toBe(1);
  });

  it("a verified cookie at /login while the auth server is unreachable renders the login page instead of re-entering /dashboard", async () => {
    // The loader on /dashboard has just failed its own getUser() the same
    // way and navigated here; bouncing back would loop until the token
    // expired.
    const response = await run("/login?next=%2Fdashboard", {
      claims: { sub: "user-1" },
      user: "unreachable",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    // Nothing is cleared while the outage lasts.
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("a verified cookie for a user the auth server rejects renders the login page", async () => {
    const response = await run("/login", {
      claims: { sub: "user-1" },
      user: "rejected",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("a verified cookie whose server session is gone renders the login page and clears the cookie", async () => {
    const response = await run(
      "/login",
      { claims: { sub: "user-1" }, user: "session-missing" },
      "sb-abc-auth-token=stale"
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    const setCookie = response.headers.getSetCookie();
    expect(setCookie).toHaveLength(1);
    expect(setCookie[0]).toMatch(/^sb-abc-auth-token=; /);
    expect(setCookie[0]).toMatch(/Max-Age=0/);
    expect(response.headers.get("cache-control")).toBe(
      SSR_HEADERS["Cache-Control"]
    );
  });

  it("the landing page renders for a signed-in user the auth server cannot vouch for", async () => {
    const response = await run("/", {
      claims: { sub: "user-1" },
      user: "unreachable",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("protected paths stay optimistic: no auth-server round trip for a verified cookie", async () => {
    const response = await run("/dashboard", {
      claims: { sub: "user-1" },
      user: "unreachable",
    });
    expect(response.status).toBe(200);
    expect(userCalls.count).toBe(0);
  });
});

describe("proxy: next cannot leave the origin", () => {
  it.each([
    "//evil.example",
    "%2F%2Fevil.example",
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "https://evil.example/dashboard",
    "https%3A%2F%2Fevil.example",
    "javascript:alert(1)",
    "/javascript:alert(1)",
    "/%09/evil.example",
    "/%0D%0ALocation:%20https://evil.example",
    "/%00//evil.example",
  ])("signed-in user at /login?next=%s stays on our origin", async (raw) => {
    const response = await run(`/login?next=${raw}`, {
      claims: { sub: "user-1" },
    });
    expect(response.status).toBe(307);
    expect(location(response).origin).toBe(ORIGIN);
  });

  it("double-encoded values decode once and are rejected or kept literal", async () => {
    // "%252F%252Fevil.example" decodes to "%2F%2Fevil.example": not a path.
    const bare = await run("/login?next=%252F%252Fevil.example", {
      claims: { sub: "user-1" },
    });
    expect(location(bare).href).toBe(`${ORIGIN}/dashboard`);

    // "/%252F%252Fevil.example" decodes to "/%2F%2Fevil.example": a literal
    // path segment on our origin, never a host.
    const slashed = await run("/login?next=/%252F%252Fevil.example", {
      claims: { sub: "user-1" },
    });
    const url = location(slashed);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/%2F%2Fevil.example");
  });
});

describe("proxy: public and protected paths", () => {
  it.each([
    "/",
    "/login",
    "/signup",
    "/forgot-password",
    "/update-password",
    "/auth/callback?code=x",
    "/invite/ABC123",
  ])("%s is reachable logged out", async (path) => {
    const response = await run(path, { claims: null });
    expect(response.status).toBe(200);
  });

  it.each(["/dashboard", "/builder", "/leagues/new", "/invite", "/nope"])(
    "%s requires a session",
    async (path) => {
      const response = await run(path, { claims: null });
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `${ORIGIN}/login?next=${encodeURIComponent(path)}`
      );
    }
  );
});
