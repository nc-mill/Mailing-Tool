'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';

/**
 * Vygenerovaný obsah nikdy nepřepíše rozdělanou práci nevratně. Předchozí
 * podoba dokumentu zůstane v paměti panelu a „Zkusit jinak" ji vrátí zpátky
 * do editoru, než se pošle nové zadání.
 */
export function DraftDecision({
  onKeep,
  onRetry,
}: {
  onKeep?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
}) {
  const t = useTranslations('ai');

  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium text-text">{t('draft.doneTitle')}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onKeep}>
          {t('draft.keep')}
        </Button>
        <Button type="button" variant="secondary" onClick={onRetry}>
          {t('draft.retry')}
        </Button>
      </div>
      <p className="text-sm text-text-muted">{t('draft.backupNote')}</p>
    </div>
  );
}
