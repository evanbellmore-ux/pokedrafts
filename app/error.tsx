"use client";

import { useEffect } from "react";
import Button, { ButtonLink } from "@/app/components/ui/Button";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[pokedrafts] route error", error);
  }, [error]);

  return (
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
          The page hit an error while loading. Trying again usually fixes
          it; if it keeps happening, head back to the dashboard.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-faint">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={() => unstable_retry()}>Try again</Button>
          <ButtonLink href="/dashboard" variant="secondary">
            Go to dashboard
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
