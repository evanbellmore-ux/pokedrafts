import { ButtonLink } from "@/app/components/ui/Button";

/** Rendered when a page inside a league calls notFound(). */
export default function LeaguePageNotFound() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-panel p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">
        League
      </p>
      <h1 className="mt-2 text-2xl font-bold">Nothing here</h1>
      <p className="mt-2 text-sm text-muted">
        That part of the league could not be found. It may have been removed
        by the commissioner.
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <ButtonLink href="/dashboard" variant="secondary">
          Go to dashboard
        </ButtonLink>
      </div>
    </div>
  );
}
