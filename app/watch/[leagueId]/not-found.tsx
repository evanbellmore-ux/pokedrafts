import { ButtonLink } from "@/app/components/ui/Button";

/**
 * notFound() from the watch page: the league does not exist, or its
 * commissioner has not made it public (`get_public_league` cannot tell the
 * two apart, on purpose).
 */
export default function WatchLeagueNotFound() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-panel p-8 text-center">
      <p className="text-sm tabular-nums text-muted">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">League not found</h1>
      <p className="mt-2 text-sm text-muted">
        This league does not exist or is not public. A league&apos;s commissioner can make it
        public in its Settings.
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <ButtonLink href="/watch">Browse public leagues</ButtonLink>
      </div>
    </div>
  );
}
