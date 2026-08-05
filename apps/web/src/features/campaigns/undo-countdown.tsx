'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { IndeterminateProgress } from '@mlain/ui/components/progress';

/**
 * Odložený start je jediný stav, kde je zaručeno, že neodešel ani jeden mail.
 * Po vypršení okna se tlačítko mění na Pozastavit a platí, že zprávy ve stavu
 * claimed doběhnou; UI to nikdy nesmí vydávat za vrácení odeslané pošty.
 *
 * Odpočet začíná hodnotou ze SERVERU a tiká až po připojení komponenty. Kdyby se
 * počítal z `Date.now()` už při renderu, server by měl jiné číslo než prohlížeč
 * a React by ten rozdíl neopravil.
 *
 * DVĚ CESTY VEN, obě vedle sebe a obě viditelné. „Vzít zpět" je bezpečná a je
 * proto výrazná; „Odeslat teď" je nevratná a je proto tišší, ale NE schovaná.
 * Že je nevratná, říká věta pod tlačítky rovnou, ne až potvrzovací dialog:
 * uživatel si tlačítko zmáčkl schválně a druhý dotaz na totéž by ho jen zdržel.
 */
export function UndoCountdown({
  remainingSeconds,
  onUndo,
  onSendNow,
  onPause,
  releasing = false,
}: {
  remainingSeconds: number;
  onUndo: () => void;
  onSendNow?: () => void;
  onPause?: () => void;
  /**
   * „Odeslat teď" je zmáčknuté a odpověď serveru ještě nedorazila.
   *
   * Bez tohohle příznaku by po kliknutí chvíli běžel dál odpočet, tedy přesný
   * opak toho, co se děje. Stav drží obrazovka průběhu, ne tahle komponenta:
   * odpověď serveru přijde do ní a jen ona ví, jestli akce prošla.
   */
  releasing?: boolean;
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

  /*
   * Rozesílka se spouští. Odpočet se schová okamžitě, protože už neplatí, a na
   * jeho místě je NEURČITÝ ukazatel: víme, že se pracuje, a nevíme jak daleko.
   * Určitý pruh by tady musel předstírat postup, který se ještě nestal.
   */
  if (releasing) {
    return (
      <div role="status" aria-live="assertive" className="flex flex-col gap-2">
        <p className="font-medium">{t('releasing')}</p>
        <IndeterminateProgress label={t('releasing')} />
      </div>
    );
  }

  if (remaining <= 0) {
    return (
      <Button onClick={onPause} data-testid="undo-expired">
        {t('pause')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="undo-countdown">
      <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3">
        <p>{t('undoCountdown', { seconds: remaining })}</p>
        <Button variant="primary" size="lg" onClick={onUndo}>
          {t('undo')}
        </Button>
        {onSendNow && (
          <Button variant="secondary" size="lg" onClick={onSendNow} data-testid="send-now">
            {t('sendNow')}
          </Button>
        )}
      </div>
      {onSendNow && <p className="text-sm text-text-muted">{t('sendNowHint')}</p>}
    </div>
  );
}
