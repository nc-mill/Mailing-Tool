'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';

/**
 * Odložený start je jediný stav, kde je zaručeno, že neodešel ani jeden mail.
 * Po vypršení okna se tlačítko mění na Pozastavit a platí, že zprávy ve stavu
 * claimed doběhnou; UI to nikdy nesmí vydávat za vrácení odeslané pošty.
 *
 * Odpočet začíná hodnotou ze SERVERU a tiká až po připojení komponenty. Kdyby se
 * počítal z `Date.now()` už při renderu, server by měl jiné číslo než prohlížeč
 * a React by ten rozdíl neopravil.
 */
export function UndoCountdown({
  remainingSeconds,
  onUndo,
  onPause,
}: {
  remainingSeconds: number;
  onUndo: () => void;
  onPause?: () => void;
}) {
  const t = useTranslations('campaigns.progress');
  const [remaining, setRemaining] = useState(remainingSeconds);

  useEffect(() => {
    setRemaining(remainingSeconds);
  }, [remainingSeconds]);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  if (remaining <= 0) {
    return (
      <Button onClick={onPause} data-testid="undo-expired">
        {t('pause')}
      </Button>
    );
  }

  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3">
      <p>{t('undoCountdown', { seconds: remaining })}</p>
      <Button variant="primary" size="lg" onClick={onUndo}>
        {t('undo')}
      </Button>
    </div>
  );
}
