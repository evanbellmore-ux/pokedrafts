import type { Instrumentation } from "next";
import { errorReportingEnabled, serverErrorReportLine } from "@/app/lib/error-reports";

/**
 * Server errors while error reports are on (docs/release-architecture.md
 * section 17): one `[pokedrafts] error report` line per error, next to the
 * line Next logs for it, with the same digest the error page shows as its
 * Reference. Redirects, notFound() and other navigation signals never get
 * here (node_modules/next/dist/server/app-render/create-error-handler.js).
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  if (!errorReportingEnabled()) return;
  console.error(serverErrorReportLine(error, request, context));
};
