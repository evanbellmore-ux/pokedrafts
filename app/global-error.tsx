"use client";

import "./globals.css";

/**
 * Replaces the root layout when it fails to render, so it must provide its
 * own <html> and <body>. Kept dependency-free apart from the global styles.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en" data-pokemon-theme="normal">
      <body className="flex min-h-full flex-col bg-bg text-text">
        <title>Something went wrong | PokeDrafts</title>
        <main className="flex flex-1 items-center justify-center px-4 py-16">
          <div
            role="alert"
            className="w-full max-w-md rounded-xl border border-danger/50 bg-panel p-8 text-center"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">
              PokeDrafts
            </p>
            <h1 className="mt-3 text-2xl font-bold">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted">
              The app could not load this page. Try again, or reload the
              browser tab.
            </p>
            {error.digest && (
              <p className="mt-3 font-mono text-xs text-faint">
                Reference: {error.digest}
              </p>
            )}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => unstable_retry()}
                className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover"
              >
                Try again
              </button>
              <a
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-lg border border-line bg-panel px-4 py-2.5 text-sm font-semibold text-text hover:bg-panel-hover"
              >
                Go to dashboard
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
