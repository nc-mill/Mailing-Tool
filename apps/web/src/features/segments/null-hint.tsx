'use client';

import { useTranslations } from 'next-intl';

/**
 * Operátory, po kterých kontakt s NEVYPLNĚNÝM polem do segmentu nespadne.
 * Je to nejzrádnější místo celého builderu: „město není Praha" nevrátí lidi
 * bez vyplněného města, což netechnický člověk nečeká a tiše přijde o část
 * databáze.
 */
export const NEGATING_OPERATORS = [
  'neq',
  'not_contains',
  'not_in',
  'has_none',
  'not_in_last_days',
] as const;

export function isNegating(operator: string): boolean {
  return (NEGATING_OPERATORS as readonly string[]).includes(operator);
}

export function NullHint({ onAddEmptyCondition }: { onAddEmptyCondition: () => void }) {
  const t = useTranslations('segments');
  return (
    <div role="note" className="flex flex-col gap-1">
      <p>{t('notNullHint')}</p>
      <button type="button" onClick={onAddEmptyCondition}>
        {t('addEmptyCondition')}
      </button>
    </div>
  );
}
