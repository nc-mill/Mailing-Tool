'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';

/**
 * Princip P5: tlačítko primární akce nikdy není disabled, jen mění popisek
 * a přepne se do stavu `pending`.
 */
export function BackupRunButton({ onDone }: { onDone?: () => void }) {
  const t = useTranslations('onboarding.backups');
  const [running, setRunning] = useState(false);

  return (
    <Button
      variant="primary"
      pending={running}
      pendingLabel={t('running')}
      onClick={() => {
        setRunning(true);
        void fetch('/api/v1/backups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
          .catch(() => undefined)
          .finally(() => {
            setRunning(false);
            onDone?.();
          });
      }}
    >
      {running ? t('running') : t('run')}
    </Button>
  );
}
