import type { Metadata } from "next";
import PublicShell from "@/app/components/PublicShell";
import { ButtonLink } from "@/app/components/ui/Button";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * Any URL with no page (proxy.ts lets unknown paths through to here, with a
 * 404) and any notFound() outside the league pages. Same shell as the
 * sign-in pages, since a visitor may not be signed in.
 */
export default function NotFound() {
  return (
    <PublicShell>
      <p className="text-sm tabular-nums text-muted">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-muted">
        There is no page at this address. The link may be mistyped, or the
        page may have moved.
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <ButtonLink href="/dashboard">Go to dashboard</ButtonLink>
        <ButtonLink href="/" variant="secondary">
          Home
        </ButtonLink>
      </div>
    </PublicShell>
  );
}
