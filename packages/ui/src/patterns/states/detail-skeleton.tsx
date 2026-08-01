import { Skeleton } from '../../components/skeleton';

export function DetailSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-4">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-5 w-40" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-11" />
        ))}
      </div>
    </div>
  );
}
