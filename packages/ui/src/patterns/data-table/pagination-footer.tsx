'use client';

import { ChevronLeft, ChevronRight } from '../../icons';
import { IconButton } from '../../components/icon-button';

export type CountInfo = { value: number; precision: 'exact' | 'estimated' };

/**
 * Kurzorové stránkování bez čísel stránek (14.2). Nekonečné rolování
 * se vědomě nezavádí: znemožňuje odkázat na konkrétní místo a u tabulky
 * s hromadnými akcemi není poznat, co je vlastně vybráno.
 *
 * VZHLED: patička uvnitř karty tabulky, tedy na papíru a bez vlastního
 * rámečku po stranách; odděluje ji jen linka nahoře. Vlevo mono věta
 * „ukazujeme X z Y", vpravo dvě šipky 36×36. Návrh tu nemá slova „předchozí"
 * a „další": ve dvou čtvercích vedle sebe by se nevešla a šipka je
 * jednoznačná. Název akce proto nese `aria-label`, ne viditelný text.
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-[var(--spacing-row-x)] py-[var(--spacing-stack)] font-mono text-meta text-text-muted">
      {/* Vlnovka je viditelné přiznání nepřesnosti (princip P7). */}
      <span>{labels.showing(shown, count.value, count.precision === 'estimated')}</span>
      <div className="flex gap-2">
        <IconButton
          size="xs"
          label={labels.previous}
          icon={<ChevronLeft aria-hidden className="icon-sm" />}
          disabled={!canGoBack}
          onClick={onPrevious}
        />
        <IconButton
          size="xs"
          label={labels.next}
          icon={<ChevronRight aria-hidden className="icon-sm" />}
          disabled={!hasMore}
          onClick={onNext}
        />
      </div>
    </div>
  );
}
