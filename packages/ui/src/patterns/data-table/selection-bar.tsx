'use client';

import { Button } from '../../components/button';
import { cn } from '../../lib/cn';

/**
 * Rozlišení „vybráno na stránce" a „vybráno vše" (6.5).
 * Bez něj uživatel zaškrtne hlavičku, myslí si, že vybral 50 řádků,
 * a smaže 50 000.
 */
export function SelectionBar({
  mode,
  count,
  total,
  labels,
  onSelectAllMatching,
  onClear,
  actions,
}: {
  mode: 'rows' | 'allMatchingFilter';
  count: number;
  total: number;
  labels: {
    selectedOnPage: (count: number) => string;
    selectAllMatching: (total: number) => string;
    selectedAllMatching: (total: number) => string;
    clearSelection: string;
  };
  onSelectAllMatching: () => void;
  onClear: () => void;
  actions?: React.ReactNode;
}) {
  if (count === 0) return null;

  // Tmavý pruh. V návrhu se hromadný výběr odlišuje od zbytku stránky plochou,
  // ne rámečkem: papír zůstává papírem a výběr je na něm cizí těleso, dokud ho
  // uživatel nezruší. Režim „vybráno vše, co odpovídá filtru" navíc přebarví
  // text do identitní žluté, aby bylo poznat, že jde o víc než jednu stránku.
  return (
    <div
      data-testid="selection-bar"
      className={cn(
        'on-panel flex flex-wrap items-center gap-[var(--spacing-inline)]',
        'rounded-[var(--radius-surface)] bg-panel px-[var(--spacing-row-x)] py-3',
        'font-mono text-meta',
        mode === 'allMatchingFilter' ? 'text-primary' : 'text-panel-foreground',
      )}
    >
      {mode === 'allMatchingFilter' ? (
        <>
          <span>{labels.selectedAllMatching(count)}</span>
          <Button
            variant="link"
            onClick={onClear}
            className="text-panel-soft hover:text-panel-foreground"
          >
            {labels.clearSelection}
          </Button>
        </>
      ) : (
        <>
          <span>{labels.selectedOnPage(count)}</span>
          <Button
            variant="link"
            onClick={onSelectAllMatching}
            className="text-panel-soft hover:text-panel-foreground"
          >
            {labels.selectAllMatching(total)}
          </Button>
        </>
      )}
      {actions}
    </div>
  );
}
