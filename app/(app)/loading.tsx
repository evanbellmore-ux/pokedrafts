import Skeleton, { SkeletonLines } from "@/app/components/ui/Skeleton";

export default function AppLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="rounded-xl border border-line bg-panel p-5"
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-8 w-16" />
          </div>
        ))}
      </div>
      <div className="mt-8 rounded-xl border border-line bg-panel p-5">
        <Skeleton className="h-5 w-40" />
        <SkeletonLines lines={4} className="mt-4" />
      </div>
    </div>
  );
}
