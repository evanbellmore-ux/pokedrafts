import Skeleton from "@/app/components/ui/Skeleton";
import DashboardHeader from "./DashboardHeader";
import { JoinLeagueCard, ToolLinks } from "./DashboardSidebar";
import { LeagueCardSkeleton } from "./LeagueCard";

/** Route fallback in the shape of DashboardClient's own loading state. */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <DashboardHeader summary={<Skeleton className="mt-2 h-4 w-44" />} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <ul aria-busy="true" aria-label="Loading your leagues" className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <LeagueCardSkeleton key={index} />
          ))}
        </ul>
        <aside aria-label="Join a league and tools" className="flex flex-col gap-4">
          <JoinLeagueCard />
          <ToolLinks />
        </aside>
      </div>
    </div>
  );
}
