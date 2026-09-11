import type { Metadata } from "next";
import { ButtonLink } from "@/app/components/ui/Button";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">
          PokeDrafts
        </p>
        <p
          aria-hidden="true"
          className="mt-4 text-6xl font-black tracking-tight text-faint"
        >
          404
        </p>
        <h1 className="mt-2 text-2xl font-bold">That page got away</h1>
        <p className="mt-2 text-sm text-muted">
          The link may be wrong, or the page may have moved. Head back to
          your leagues and try again from there.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <ButtonLink href="/dashboard">Go to dashboard</ButtonLink>
          <ButtonLink href="/" variant="secondary">
            Home
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
