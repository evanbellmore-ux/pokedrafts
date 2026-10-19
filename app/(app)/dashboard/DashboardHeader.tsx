import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { ButtonLink } from "@/app/components/ui/Button";

/**
 * "Your leagues", its one-line summary and Create League. Shared by the
 * dashboard and its route-level loading screen, so nothing moves when the
 * page takes over from the fallback.
 */
export default function DashboardHeader({ summary }: { summary: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1
          id="leagues-heading"
          className="text-2xl font-semibold tracking-tight text-text sm:text-[1.75rem]"
        >
          Your leagues
        </h1>
        {summary}
      </div>
      <ButtonLink href="/leagues/new">
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create League
      </ButtonLink>
    </header>
  );
}
