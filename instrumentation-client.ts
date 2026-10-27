import { errorReportingEnabled, isExtensionUrl, reportClientError } from "@/app/lib/error-reports";

/**
 * Runs before the app hydrates. While error reports are on
 * (docs/release-architecture.md section 17), errors that no error boundary
 * caught are reported: a throw outside rendering (an event handler, a timer)
 * and a promise rejection nothing handled. app/error.tsx and
 * app/global-error.tsx report what they catch themselves.
 */
if (errorReportingEnabled()) {
  window.addEventListener("error", (event) => {
    // A browser extension's script, not PokeDrafts.
    if (isExtensionUrl(event.filename)) return;
    reportClientError("uncaught", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError("rejection", event.reason);
  });
}
