'use client';

import { Button } from '../../components/button';

export type CountInfo = { value: number; precision: 'exact' | 'estimated' };

/**
 * Kurzorové stránkování bez čísel stránek (14.2). Nekonečné rolování
 * se vědomě nezavádí: znemožňuje odkázat na konkrétní místo a u tabulky
 * s hromadnými akcemi není poznat, co je vlastně vybráno.
 */
export function PaginationFooter({
  shown,
  count,
  hasMore,
  canGoBack,
  onPrevious,
  onNext,
  labels,
}: {
  shown: number;
  count: CountInfo;
  hasMore: boolean;
  canGoBack: boolean;
  onPrevious: () => void;
  onNext: () => void;
  labels: {
    previous: string;
    next: string;
    showing: (shown: number, total: number, estimated: boolean) => string;
  };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-2 py-3 text-sm text-text-muted">
      {/* Vlnovka je viditelné přiznání nepřesnosti (princip P7). */}
      <span>{labels.showing(shown, count.value, count.precision === 'estimated')}</span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={!canGoBack} onClick={onPrevious}>
          {labels.previous}
        </Button>
        <Button variant="secondary" disabled={!hasMore} onClick={onNext}>
          {labels.next}
        </Button>
      </div>
    </div>
  );
}
