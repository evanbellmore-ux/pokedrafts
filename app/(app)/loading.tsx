import Skeleton, { SkeletonLines } from "@/app/components/ui/Skeleton";

/** Neutral page fallback for the signed-in pages without their own. */
export default function AppLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-8 rounded-xl border border-hairline bg-panel/60 p-5">
        <Skeleton className="h-5 w-40" />
        <SkeletonLines lines={4} className="mt-4" />
      </div>
    </div>
  );
}
