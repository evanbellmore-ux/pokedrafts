import type { NextRequest } from "next/server";
import {
  MAX_REPORT_BYTES,
  browserErrorReportLine,
  errorReportingEnabled,
  readErrorReport,
} from "@/app/lib/error-reports";

/** Sec-Fetch-Site where the browser sends it, otherwise the Origin's host against Host. */
function fromThisSite(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Receives the browser's error reports (app/lib/error-reports.ts) and writes
 * each as one `[pokedrafts] error report` line to the server log
 * (docs/release-architecture.md section 17). 404 while reports are off, and
 * only same-origin requests are accepted. The browser sends a report without
 * cookies, and of the request itself only the user agent is logged.
 */
export async function POST(request: NextRequest) {
  if (!errorReportingEnabled()) return new Response(null, { status: 404 });
  if (!fromThisSite(request)) return new Response(null, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REPORT_BYTES) {
    return new Response(null, { status: 413 });
  }
  const text = await request.text();
  if (text.length > MAX_REPORT_BYTES) return new Response(null, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const report = readErrorReport(body);
  if (!report) return new Response(null, { status: 400 });

  console.error(browserErrorReportLine(report, request.headers.get("user-agent")));
  return new Response(null, { status: 204 });
}
