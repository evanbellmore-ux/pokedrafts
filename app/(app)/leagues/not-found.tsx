import { ButtonLink } from "@/app/components/ui/Button";

/**
 * Catches notFound() thrown by the league layout (a segment's own
 * not-found.tsx only wraps its page, so the parent segment renders this).
 */
export default function LeagueNotFound() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-panel p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">
        League
      </p>
      <h1 className="mt-2 text-2xl font-bold">League not found</h1>
      <p className="mt-2 text-sm text-muted">
        Either this league does not exist or you are not a coach in it. If you
        were sent an invite link, open that link to join first.
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <ButtonLink href="/dashboard">Go to dashboard</ButtonLink>
      </div>
    </div>
  );
}
