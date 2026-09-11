export type SkeletonProps = {
  className?: string;
};

/** Pulsing placeholder block. Hidden from assistive technology. */
export default function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-panel-hover ${className}`.trim()}
    />
  );
}

/** A stack of skeleton lines, handy for text blocks. */
export function SkeletonLines({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={`flex flex-col gap-2 ${className}`.trim()}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={`h-4 ${index === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}
