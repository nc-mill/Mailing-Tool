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

  return (
    <div
      data-testid="selection-bar"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] px-4 py-3 text-sm',
        mode === 'allMatchingFilter'
          ? 'border border-accent-text bg-accent-surface text-accent-text'
          : 'bg-surface-muted text-text',
      )}
    >
      {mode === 'allMatchingFilter' ? (
        <>
          <span>{labels.selectedAllMatching(count)}</span>
          <Button variant="link" onClick={onClear}>
            {labels.clearSelection}
          </Button>
        </>
      ) : (
        <>
          <span>{labels.selectedOnPage(count)}</span>
          <Button variant="link" onClick={onSelectAllMatching}>
            {labels.selectAllMatching(total)}
          </Button>
        </>
      )}
      {actions}
    </div>
  );
}
