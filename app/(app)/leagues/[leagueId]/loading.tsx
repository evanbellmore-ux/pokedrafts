import Skeleton, { SkeletonLines } from "@/app/components/ui/Skeleton";

export default function LeagueLoading() {
  return (
    <div aria-busy="true" aria-label="Loading league">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      <div className="mt-8 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-xl border border-line bg-panel p-5">
          <Skeleton className="h-5 w-32" />
          <SkeletonLines lines={5} className="mt-4" />
        </div>
        <div className="rounded-xl border border-line bg-panel p-5">
          <Skeleton className="h-5 w-24" />
          <SkeletonLines lines={3} className="mt-4" />
        </div>
      </div>
    </div>
  );
}
