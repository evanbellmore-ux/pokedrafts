import { generateKeyPairSync, sign } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * Session handling against the REAL @supabase/ssr and auth-js clients.
 *
 * tests/unit/proxy.test.ts and auth-callback-route.test.ts drive proxy.ts and
 * app/auth/callback/route.ts with stand-ins for the Supabase client. This
 * file removes the stand-ins: a fake GoTrue server answers /token, /verify
 * and /user on 127.0.0.1, the session cookie is encoded exactly the way
 * @supabase/ssr writes it (`base64-` + base64url(JSON)), and `next/headers`
 * is replaced by an in-memory cookie jar so the callback route runs the real
 * `createServerSupabase()`.
 *
 * It proves (docs/release-architecture.md sections 3.1 and 3.2):
 * - an expired access token is refreshed inside the proxy and the rotated
 *   cookies plus Cache-Control reach the client on pass-through AND redirect
 *   responses;
 * - a dead refresh token clears the cookies on the redirect to /login and
 *   /login renders instead of bouncing (no loop);
 * - the callback route exchanges a PKCE code with the verifier cookie, or
 *   verifies a token_hash, and writes the session through `cookies().set()`,
 *   clearing the verifier;
 * - a missing verifier is reported as `auth-device` without a network call;
 * - with asymmetric signing keys the proxy verifies the JWT locally against
 *   /.well-known/jwks.json and only contacts /user to confirm a session
 *   before bouncing a signed-in user off /login; when /user is unreachable
 *   or rejects the token, /login renders instead (no redirect loop with a
 *   client whose own getUser() just failed the same way).
 */

type Json = Record<string, unknown>;
type Route = { status: number; body: Json | null };
type SeenRequest = {
  method: string;
  url: string;
  authorization: string | null;
  body: Json | null;
};

const cookieJar = vi.hoisted(() => {
  type Write = { name: string; value: string; options: Record<string, unknown> };
  const jar = new Map<string, string>();
  const writes: Write[] = [];
  return {
    jar,
    writes,
    reset(initial: Record<string, string> = {}) {
      jar.clear();
      writes.length = 0;
      for (const [name, value] of Object.entries(initial)) jar.set(name, value);
    },
    store: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      get: (name: string) =>
        jar.has(name) ? { name, value: jar.get(name) as string } : undefined,
      has: (name: string) => jar.has(name),
      set: (name: string, value: string, options: Record<string, unknown> = {}) => {
        writes.push({ name, value, options });
        if (options.maxAge === 0) jar.delete(name);
        else jar.set(name, value);
      },
    },
  };
});

// The callback route builds its client with `await cookies()` from
// next/headers, which only works inside a Next request scope.
vi.mock("next/headers", () => ({ cookies: async () => cookieJar.store }));

const ORIGIN = "https://pokedrafts.example";
const USER_ID = "8f3c9c1e-1111-4222-8333-444455556666";
// supabase-js derives the storage key from the first host label of the URL.
const STORAGE_KEY = "sb-127-auth-token";
const VERIFIER_KEY = `${STORAGE_KEY}-code-verifier`;

const now = () => Math.floor(Date.now() / 1000);

function base64url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fakeJwt(exp: number) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "coach@example.com",
      exp,
      iat: now(),
    })
  );
  return `${header}.${payload}.${base64url("signature")}`;
}

const user = {
  id: USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "coach@example.com",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

function session(expiresAt: number, refreshToken: string) {
  return {
    access_token: fakeJwt(expiresAt),
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user,
  };
}

/* ---------------------- asymmetric (ES256) signing ---------------------- */

// Projects on Supabase's asymmetric JWT signing keys let auth-js verify the
// access token locally against /.well-known/jwks.json, so the proxy's
// getClaims() never contacts /user. That is the path the /login confirmation
// in proxy.ts exists for.
const KID = "test-es256-key";
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const JWK = {
  ...(publicKey.export({ format: "jwk" }) as Record<string, string>),
  kid: KID,
  alg: "ES256",
  use: "sig",
};

function signedJwt(exp: number) {
  const header = base64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: KID }));
  const payload = base64url(
    JSON.stringify({
      sub: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "coach@example.com",
      session_id: "session-1",
      exp,
      iat: now(),
    })
  );
  // JWS ES256 signatures are raw r||s, not DER.
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function signedSession(expiresAt: number, refreshToken: string) {
  return { ...session(expiresAt, refreshToken), access_token: signedJwt(expiresAt) };
}

/** Exactly how @supabase/ssr (cookieEncoding "base64url") stores a value. */
function encodeCookie(value: unknown) {
  return `base64-${base64url(JSON.stringify(value))}`;
}

function decodeCookie(value: string): Json {
  expect(value.startsWith("base64-")).toBe(true);
  return JSON.parse(
    Buffer.from(value.slice("base64-".length), "base64url").toString("utf8")
  ) as Json;
}

type SetCookie = { name: string; value: string; attributes: Record<string, string | true> };

function parseSetCookie(line: string): SetCookie {
  const [pair, ...rest] = line.split(";").map((part) => part.trim());
  const eq = pair.indexOf("=");
  const attributes: Record<string, string | true> = {};
  for (const attr of rest) {
    const i = attr.indexOf("=");
    if (i === -1) attributes[attr.toLowerCase()] = true;
    else attributes[attr.slice(0, i).toLowerCase()] = attr.slice(i + 1);
  }
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attributes };
}

function setCookies(response: Response) {
  return response.headers.getSetCookie().map(parseSetCookie);
}

const SSR_CACHE_CONTROL =
  "private, no-cache, no-store, must-revalidate, max-age=0";

/* ----------------------------- fake GoTrue ------------------------------ */

const gotrue: {
  refresh: Route;
  pkce: Route;
  verify: Route;
  user: Route;
  requests: SeenRequest[];
} = {
  refresh: { status: 200, body: null },
  pkce: { status: 200, body: null },
  verify: { status: 200, body: null },
  user: { status: 200, body: null },
  requests: [],
};

function resetGotrue() {
  gotrue.refresh = { status: 200, body: session(now() + 3600, "refresh-2") };
  gotrue.pkce = { status: 200, body: session(now() + 3600, "refresh-pkce") };
  gotrue.verify = { status: 200, body: session(now() + 3600, "refresh-otp") };
  gotrue.user = { status: 200, body: user };
  gotrue.requests.length = 0;
}

function readBody(req: IncomingMessage): Promise<Json | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve(null);
      try {
        resolve(JSON.parse(text) as Json);
      } catch {
        resolve(null);
      }
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const body = await readBody(req);
  gotrue.requests.push({
    method: req.method ?? "GET",
    url: `${url.pathname}${url.search}`,
    authorization: req.headers.authorization ?? null,
    body,
  });

  let route: Route = { status: 404, body: { error_code: "not_found", msg: "no route" } };
  if (url.pathname === "/auth/v1/token") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "refresh_token") route = gotrue.refresh;
    if (grant === "pkce") route = gotrue.pkce;
  } else if (url.pathname === "/auth/v1/verify") {
    route = gotrue.verify;
  } else if (url.pathname === "/auth/v1/user") {
    route = gotrue.user;
  } else if (url.pathname === "/auth/v1/logout") {
    route = { status: 204, body: null };
  } else if (url.pathname === "/auth/v1/.well-known/jwks.json") {
    route = { status: 200, body: { keys: [JWK] } };
  }

  // status 0 = "unreachable": drop the connection so fetch rejects.
  if (route.status === 0) {
    req.socket.destroy();
    return;
  }

  if (route.body === null) {
    res.writeHead(route.status);
    res.end();
    return;
  }
  res.writeHead(route.status, { "content-type": "application/json" });
  res.end(JSON.stringify(route.body));
}

let server: Server;

beforeAll(async () => {
  server = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `http://127.0.0.1:${port}`);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  resetGotrue();
  cookieJar.reset();
});

/* ------------------------------- helpers -------------------------------- */

async function runProxy(path: string, cookies: Record<string, string> = {}) {
  const { proxy } = await import("@/proxy");
  const headers: Record<string, string> = {};
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (cookieHeader) headers.cookie = cookieHeader;
  return proxy(new NextRequest(new URL(path, ORIGIN), { headers }));
}

async function runCallback(pathAndQuery: string) {
  const { GET } = await import("@/app/auth/callback/route");
  return GET(new NextRequest(new URL(pathAndQuery, ORIGIN)));
}

function location(response: Response) {
  return new URL(response.headers.get("location") ?? "");
}

function requestsTo(pathPrefix: string) {
  return gotrue.requests.filter((r) => r.url.startsWith(pathPrefix));
}

/* -------------------------------- proxy --------------------------------- */

describe("proxy.ts with the real @supabase/ssr client", () => {
  it("refreshes an expired session and puts the rotated cookies and Cache-Control on the pass-through response", async () => {
    const expired = session(now() - 60, "refresh-1");
    const response = await runProxy("/dashboard", {
      [STORAGE_KEY]: encodeCookie(expired),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();

    // The refresh really happened against the fake auth server.
    const refreshCalls = requestsTo("/auth/v1/token?grant_type=refresh_token");
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0].body).toMatchObject({ refresh_token: "refresh-1" });

    // getClaims falls back to /user for HS256 tokens and must use the NEW token.
    const userCalls = requestsTo("/auth/v1/user");
    expect(userCalls).toHaveLength(1);
    expect(userCalls[0].authorization).toBe(
      `Bearer ${(gotrue.refresh.body as Json).access_token}`
    );

    // The rotated session reached the response cookies with the ssr headers.
    const cookies = setCookies(response);
    const sessionCookie = cookies.find((c) => c.name === STORAGE_KEY);
    expect(sessionCookie).toBeDefined();
    expect(decodeCookie(sessionCookie!.value)).toMatchObject({
      refresh_token: "refresh-2",
    });
    expect(sessionCookie!.attributes["max-age"]).not.toBe("0");
    expect(response.headers.get("cache-control")).toBe(SSR_CACHE_CONTROL);
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("keeps the rotated cookies and Cache-Control on the redirect away from /login", async () => {
    const expired = session(now() - 60, "refresh-1");
    const response = await runProxy("/login?next=%2Finvite%2FABC", {
      [STORAGE_KEY]: encodeCookie(expired),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/invite/ABC`);
    const sessionCookie = setCookies(response).find((c) => c.name === STORAGE_KEY);
    expect(sessionCookie).toBeDefined();
    expect(decodeCookie(sessionCookie!.value)).toMatchObject({
      refresh_token: "refresh-2",
    });
    expect(response.headers.get("cache-control")).toBe(SSR_CACHE_CONTROL);
  });

  it("a session whose refresh token is dead is cleared on the redirect to /login, and /login renders instead of bouncing", async () => {
    gotrue.refresh = {
      status: 400,
      body: {
        error_code: "refresh_token_not_found",
        msg: "Invalid Refresh Token: Refresh Token Not Found",
      },
    };
    const dead = session(now() - 60, "refresh-dead");

    const first = await runProxy("/dashboard", {
      [STORAGE_KEY]: encodeCookie(dead),
    });
    expect(first.status).toBe(307);
    expect(first.headers.get("location")).toBe(
      `${ORIGIN}/login?next=%2Fdashboard`
    );
    const cleared = setCookies(first).find((c) => c.name === STORAGE_KEY);
    expect(cleared).toBeDefined();
    expect(cleared!.value).toBe("");
    expect(cleared!.attributes["max-age"]).toBe("0");
    expect(first.headers.get("cache-control")).toBe(SSR_CACHE_CONTROL);

    // Even if the browser still sends the stale cookie, /login must render.
    const second = await runProxy("/login?next=%2Fdashboard", {
      [STORAGE_KEY]: encodeCookie(dead),
    });
    expect(second.status).toBe(200);
    expect(second.headers.get("location")).toBeNull();
    expect(setCookies(second).find((c) => c.name === STORAGE_KEY)?.value).toBe("");
  });

  it("an unparseable session cookie is treated as logged out exactly once", async () => {
    const first = await runProxy("/dashboard", { [STORAGE_KEY]: "garbage" });
    expect(first.status).toBe(307);
    expect(location(first).pathname).toBe("/login");
    expect(gotrue.requests).toHaveLength(0);

    const second = await runProxy("/login?next=%2Fdashboard", {
      [STORAGE_KEY]: "garbage",
    });
    expect(second.status).toBe(200);
  });

  it("a token the auth server no longer accepts logs the user out without a loop", async () => {
    gotrue.user = {
      status: 401,
      body: { error_code: "bad_jwt", msg: "invalid JWT: unable to parse or verify signature" },
    };
    const live = session(now() + 3600, "refresh-live");

    const first = await runProxy("/dashboard", { [STORAGE_KEY]: encodeCookie(live) });
    expect(first.status).toBe(307);
    expect(location(first).pathname).toBe("/login");

    const second = await runProxy("/login", { [STORAGE_KEY]: encodeCookie(live) });
    expect(second.status).toBe(200);
  });

  it("a valid session passes through untouched and is bounced away from /login", async () => {
    const live = session(now() + 3600, "refresh-live");

    const page = await runProxy("/dashboard", { [STORAGE_KEY]: encodeCookie(live) });
    expect(page.status).toBe(200);
    expect(page.headers.getSetCookie()).toEqual([]);
    expect(requestsTo("/auth/v1/token")).toHaveLength(0);

    const login = await runProxy("/login", { [STORAGE_KEY]: encodeCookie(live) });
    expect(login.status).toBe(307);
    expect(login.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });
});

/* ----------------- proxy with asymmetric signing keys ------------------- */

describe("proxy.ts with asymmetric signing keys (local JWT verification)", () => {
  const live = () => encodeCookie(signedSession(now() + 3600, "refresh-live"));

  it("passes a protected path through without contacting /user", async () => {
    const response = await runProxy("/dashboard", { [STORAGE_KEY]: live() });

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(requestsTo("/auth/v1/user")).toHaveLength(0);
    expect(requestsTo("/auth/v1/token")).toHaveLength(0);
  });

  it("confirms with /user exactly once before bouncing a signed-in user off /login", async () => {
    const response = await runProxy("/login?next=%2Finvite%2FABC", {
      [STORAGE_KEY]: live(),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/invite/ABC`);
    expect(requestsTo("/auth/v1/user")).toHaveLength(1);
  });

  it("renders /login instead of re-entering /dashboard when /user is unreachable, and keeps the session", async () => {
    // The browser's own getUser() has just failed the same way; a loader
    // that navigated here on `data.user === null` would otherwise be bounced
    // straight back to /dashboard, forever.
    gotrue.user = { status: 0, body: null };

    const response = await runProxy("/login?next=%2Fdashboard", {
      [STORAGE_KEY]: live(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(requestsTo("/auth/v1/user")).toHaveLength(1);
    expect(setCookies(response).find((c) => c.name === STORAGE_KEY)).toBeUndefined();
  });

  it("renders /login for a deleted user's still-valid token (403 user_not_found)", async () => {
    gotrue.user = {
      status: 403,
      body: {
        error_code: "user_not_found",
        msg: "User from sub claim in JWT does not exist",
      },
    };

    const response = await runProxy("/login", { [STORAGE_KEY]: live() });

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("renders /login and clears the cookie when the server session is gone (session_not_found)", async () => {
    gotrue.user = {
      status: 403,
      body: {
        error_code: "session_not_found",
        msg: "Session from session_id claim in JWT does not exist",
      },
    };

    const response = await runProxy("/login", { [STORAGE_KEY]: live() });

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    const cleared = setCookies(response).find((c) => c.name === STORAGE_KEY);
    expect(cleared).toBeDefined();
    expect(cleared!.value).toBe("");
    expect(cleared!.attributes["max-age"]).toBe("0");
  });

  it("still bounces the landing page to /dashboard for a confirmed session", async () => {
    const response = await runProxy("/", { [STORAGE_KEY]: live() });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });
});

/* ------------------------------ callback -------------------------------- */

describe("app/auth/callback/route.ts with the real server client", () => {
  it("exchanges a PKCE code with the verifier cookie, writes the session through cookies().set and clears the verifier", async () => {
    // auth-js JSON-stringifies storage values, so the browser client stores
    // the verifier as base64-(JSON string).
    cookieJar.reset({ [VERIFIER_KEY]: encodeCookie("verifier-123") });

    const response = await runCallback("/auth/callback?code=abc&next=%2Finvite%2FABC");

    const exchange = requestsTo("/auth/v1/token?grant_type=pkce");
    expect(exchange).toHaveLength(1);
    expect(exchange[0].body).toEqual({
      auth_code: "abc",
      code_verifier: "verifier-123",
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/invite/ABC`);

    // Session written, verifier removed (Next merges these writes onto the
    // returned redirect: server/route-modules/app-route/module.js).
    expect(cookieJar.jar.has(STORAGE_KEY)).toBe(true);
    expect(decodeCookie(cookieJar.jar.get(STORAGE_KEY)!)).toMatchObject({
      refresh_token: "refresh-pkce",
    });
    expect(cookieJar.jar.has(VERIFIER_KEY)).toBe(false);
    const verifierClear = cookieJar.writes.find(
      (w) => w.name === VERIFIER_KEY && w.options.maxAge === 0
    );
    expect(verifierClear).toBeDefined();
    const sessionWrite = cookieJar.writes.find((w) => w.name === STORAGE_KEY);
    expect(sessionWrite?.options).toMatchObject({ path: "/", sameSite: "lax" });
  });

  it("reports auth-device without a network call when the verifier cookie is missing", async () => {
    const response = await runCallback("/auth/callback?code=abc&next=%2Finvite%2FABC");

    expect(gotrue.requests).toHaveLength(0);
    expect(response.status).toBe(307);
    const url = location(response);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe("auth-device");
    expect(url.searchParams.get("next")).toBe("/invite/ABC");
    expect(cookieJar.jar.has(STORAGE_KEY)).toBe(false);
  });

  it("a rejected PKCE code goes to /login?error=auth and leaves no session behind", async () => {
    cookieJar.reset({ [VERIFIER_KEY]: encodeCookie("verifier-123") });
    gotrue.pkce = {
      status: 403,
      body: { error_code: "flow_state_expired", msg: "PKCE flow state has expired" },
    };

    const response = await runCallback("/auth/callback?code=abc&next=%2Finvite%2FABC");

    const url = location(response);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe("auth");
    expect(url.searchParams.get("next")).toBe("/invite/ABC");
    expect(cookieJar.jar.has(STORAGE_KEY)).toBe(false);
  });

  it("verifies a recovery token_hash from a {{ .RedirectTo }} template, stores the session and lands on /update-password", async () => {
    const redirectTo = `${ORIGIN}/auth/callback?next=%2Fupdate-password`;
    const response = await runCallback(
      `/auth/callback?token_hash=h&type=recovery&next=${encodeURIComponent(redirectTo)}`
    );

    const verify = requestsTo("/auth/v1/verify");
    expect(verify).toHaveLength(1);
    expect(verify[0].body).toMatchObject({ token_hash: "h", type: "recovery" });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/update-password`);
    // PASSWORD_RECOVERY is one of the events @supabase/ssr persists on.
    expect(decodeCookie(cookieJar.jar.get(STORAGE_KEY)!)).toMatchObject({
      refresh_token: "refresh-otp",
    });
  });

  it("an expired token_hash goes to /login?error=auth, keeps next and writes no session", async () => {
    gotrue.verify = {
      status: 403,
      body: { error_code: "otp_expired", msg: "Email link is invalid or has expired" },
    };
    const response = await runCallback(
      "/auth/callback?token_hash=h&type=signup&next=%2Finvite%2FABC"
    );

    const url = location(response);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe("auth");
    expect(url.searchParams.get("next")).toBe("/invite/ABC");
    expect(cookieJar.jar.has(STORAGE_KEY)).toBe(false);
  });
});
