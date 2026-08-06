'use client';

import { Button } from '@mlain/ui/components/button';
import { useTranslations } from 'next-intl';

export { NEGATING_OPERATORS, isNegating } from './negating-operators';

export function NullHint({ onAddEmptyCondition }: { onAddEmptyCondition: () => void }) {
  const t = useTranslations('segments');
  return (
    <div role="note" className="flex flex-col items-start gap-1">
      <p className="text-sm text-text-muted">{t('notNullHint')}</p>
      <Button variant="link" className="text-sm" onClick={onAddEmptyCondition}>
        {t('addEmptyCondition')}
      </Button>
    </div>
  );
}
