import { Skeleton } from '../../components/skeleton';

/** Skeleton má obrys řádků a sloupců, ne obecný obdélník (14.4). */
export function TableSkeleton({
  rows = 8,
  columns = 6,
  label,
}: {
  rows?: number;
  columns?: number;
  label: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-2">
      <div className="flex gap-3 border-b border-border pb-2">
        {Array.from({ length: columns }, (_, column) => (
          <Skeleton key={`head-${column}`} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={`row-${row}`} className="flex gap-3 py-2">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={`cell-${row}-${column}`} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
