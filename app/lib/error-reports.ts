import type { Instrumentation } from "next";

/**
 * Error reports (docs/release-architecture.md section 17). While
 * NEXT_PUBLIC_ERROR_REPORTING is on, the browser posts its errors to
 * /api/error-reports and instrumentation.ts's onRequestError catches the
 * server's; each becomes one `[pokedrafts] error report {...}` line in the
 * host's logs (Vercel), so one log search finds both. No outside service
 * receives them.
 *
 * A report holds the error's name, message, code, digest and stack, the page
 * path and what kind of failure it was. It never holds cookies, request
 * headers (apart from the browser's user agent), query strings, database row
 * details or account ids, and email addresses, tokens and query strings are
 * scrubbed from its text in the browser and again on the server.
 */

export const ERROR_REPORTS_PATH = "/api/error-reports";

/** What a browser report comes from. */
export const BROWSER_ERROR_KINDS = [
  // app/error.tsx caught a render error.
  "page",
  // app/global-error.tsx replaced the root layout.
  "root",
  // An error no error boundary caught (window "error").
  "uncaught",
  // A promise rejection nothing handled (window "unhandledrejection").
  "rejection",
  // friendlyError hid a raw error behind a generic sentence (app/lib/errors.ts).
  "unexpected",
  // The Training battle engine did not load or stopped (load-error).
  "training",
] as const;

export type BrowserErrorKind = (typeof BROWSER_ERROR_KINDS)[number];

export type ErrorReport = {
  kind: BrowserErrorKind;
  name?: string;
  message: string;
  code?: string;
  digest?: string;
  path?: string;
  build?: string;
  stack?: string;
};

/** Longest text kept per field, so a report stays one short log line. */
const LIMITS = {
  name: 100,
  message: 500,
  code: 60,
  digest: 60,
  path: 200,
  build: 40,
  stack: 2000,
  browser: 200,
} as const;

/** A report is a few kilobytes; the route refuses bodies past this. */
export const MAX_REPORT_BYTES = 16 * 1024;

/** A page that keeps failing sends this many reports, not one per render. */
const MAX_REPORTS_PER_PAGE = 10;

/**
 * On when NEXT_PUBLIC_ERROR_REPORTING is "on" (or "1" or "true"). Next inlines
 * the value at build time, so changing it takes a new deployment.
 */
export function errorReportingEnabled(): boolean {
  const value = process.env.NEXT_PUBLIC_ERROR_REPORTING?.trim().toLowerCase();
  return value === "on" || value === "1" || value === "true";
}

/**
 * A URL's query string or fragment, up to the `:line:column` a stack frame
 * appends to it.
 */
const URL_QUERY =
  /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#()'"<>]*)[?#][^\s()'"<>]*?(?=:\d+(?::\d+)?(?=[\s)]|$)|[\s()'"<>]|$)/gim;
/** JSON web tokens: a Supabase access token carries the account's email. */
const JWT = /\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g;
const BEARER = /\bBearer\s+[\w.~+/-]+=*/gi;
const EMAIL = /[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
/** Errors from browser extensions say nothing about PokeDrafts. */
const EXTENSION_URL = /\b(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//;
/** Browser noise: a ResizeObserver warning and cross-origin script errors. */
const NOISE = /^(?:ResizeObserver loop|Script error\.?$)/;

/** Drops query strings, tokens and email addresses from report text. */
export function scrubText(text: string): string {
  return text
    .replace(URL_QUERY, "$1")
    .replace(JWT, "[token]")
    .replace(BEARER, "Bearer [token]")
    .replace(EMAIL, "[email]");
}

export function isExtensionUrl(url: unknown): boolean {
  return typeof url === "string" && EXTENSION_URL.test(url);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Scrubbed and clipped; undefined for an empty or missing value. */
function field(value: unknown, max: number): string | undefined {
  if (typeof value === "number") value = String(value);
  if (typeof value !== "string") return undefined;
  const text = clip(scrubText(value).trim(), max);
  return text || undefined;
}

/** A path without its query string or fragment; undefined unless it starts with "/". */
function pathField(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  return field(value.split(/[?#]/)[0], LIMITS.path);
}

function stringProperty(value: object, key: string): unknown {
  return (value as Record<string, unknown>)[key];
}

/**
 * The parts of a thrown value a report keeps. Supabase and PostgREST errors
 * are plain objects: their code and message are kept, never `details` or
 * `hint`, which can quote row values.
 */
function describeError(error: unknown): Omit<ErrorReport, "kind" | "path" | "build"> {
  if (typeof error === "object" && error !== null) {
    return {
      name: field(stringProperty(error, "name"), LIMITS.name),
      message: field(stringProperty(error, "message"), LIMITS.message) ?? "",
      code: field(stringProperty(error, "code"), LIMITS.code),
      digest: field(stringProperty(error, "digest"), LIMITS.digest),
      stack: field(stringProperty(error, "stack"), LIMITS.stack),
    };
  }
  return { message: field(String(error), LIMITS.message) ?? "" };
}

function isNoise(report: Pick<ErrorReport, "name" | "message" | "stack">): boolean {
  return (
    report.name === "AbortError" ||
    NOISE.test(report.message) ||
    isExtensionUrl(report.message) ||
    isExtensionUrl(report.stack)
  );
}

/**
 * The report the route accepts, cleaned again on the server; null for
 * anything that is not one.
 */
export function readErrorReport(body: unknown): ErrorReport | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const kind = stringProperty(body, "kind");
  const message = stringProperty(body, "message");
  if (!BROWSER_ERROR_KINDS.some((known) => known === kind) || typeof message !== "string") return null;
  return {
    kind: kind as BrowserErrorKind,
    name: field(stringProperty(body, "name"), LIMITS.name),
    message: field(message, LIMITS.message) ?? "",
    code: field(stringProperty(body, "code"), LIMITS.code),
    digest: field(stringProperty(body, "digest"), LIMITS.digest),
    path: pathField(stringProperty(body, "path")),
    build: field(stringProperty(body, "build"), LIMITS.build),
    stack: field(stringProperty(body, "stack"), LIMITS.stack),
  };
}

function reportLine(entry: Record<string, string | undefined>): string {
  return `[pokedrafts] error report ${JSON.stringify(entry)}`;
}

/** The log line for a report the browser sent. */
export function browserErrorReportLine(report: ErrorReport, userAgent: string | null): string {
  const { kind, name, message, code, digest, path, build, stack } = report;
  return reportLine({
    source: "browser",
    kind,
    name,
    message,
    code,
    digest,
    path,
    build,
    browser: field(userAgent, LIMITS.browser),
    stack,
  });
}

type RequestErrorArgs = Parameters<Instrumentation.onRequestError>;

/** The log line for a server error (instrumentation.ts). Request headers are never read. */
export function serverErrorReportLine(
  error: unknown,
  request: Pick<RequestErrorArgs[1], "path" | "method">,
  context: Pick<RequestErrorArgs[2], "routePath" | "routeType">
): string {
  const { name, message, code, digest, stack } = describeError(error);
  return reportLine({
    source: "server",
    kind: context.routeType,
    route: field(context.routePath, LIMITS.path),
    method: field(request.method, LIMITS.code),
    path: pathField(request.path),
    name,
    message,
    code,
    digest,
    stack,
  });
}

let reportsSent = 0;
const reported = new Set<string>();

/**
 * Sends one browser report while reports are on; a no-op on the server, for
 * a repeat of the same error, past MAX_REPORTS_PER_PAGE, offline, and for
 * browser noise. The request carries no cookies. Never throws.
 */
export function reportClientError(kind: BrowserErrorKind, error: unknown): void {
  if (!errorReportingEnabled() || typeof window === "undefined") return;
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const described = describeError(error);
    if (isNoise(described)) return;
    // The page's own query string, wherever the error quotes it.
    const query = window.location.search;
    const unquery = (text: string | undefined) => (text && query.length > 1 ? text.split(query).join("") : text);
    const report: ErrorReport = {
      kind,
      ...described,
      message: unquery(described.message) ?? "",
      stack: unquery(described.stack),
      path: pathField(window.location.pathname),
      build: field(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7), LIMITS.build),
    };
    const key = [kind, report.name, report.message, report.digest].join("\n");
    if (reported.has(key) || reportsSent >= MAX_REPORTS_PER_PAGE) return;
    reported.add(key);
    reportsSent += 1;
    void fetch(ERROR_REPORTS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      credentials: "omit",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // A failing report must not add a second failure to the page.
  }
}
