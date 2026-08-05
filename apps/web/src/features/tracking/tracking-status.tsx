'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Alert } from '@mlain/ui/patterns/states';

export type TrackingStatusProps = {
  recentEvents: number;
  recentVisitors: number;
  /** ISO řetězec, serverová komponenta nesmí posílat Date do klienta. */
  lastEventAt: string | null;
  enabled: boolean;
};

/**
 * Odpověď na jedinou otázku, kterou uživatel po vložení úryvku má:
 * „přišlo už nám odsud něco?"
 *
 * Bez tohohle bloku je obrazovka jen formulář a člověk nemá jak poznat, jestli
 * měření běží. Nula událostí je legitimní stav, ne chyba, takže se ukazuje
 * neutrálně a s návodem, co zkontrolovat.
 */
export function TrackingStatus({
  recentEvents,
  recentVisitors,
  lastEventAt,
  enabled,
}: TrackingStatusProps) {
  const t = useTranslations('tracking');
  const format = useFormatter();

  return (
    <section aria-labelledby="tracking-status">
      <h2 id="tracking-status" className="text-xl font-semibold">
        {t('settings.status.title')}
      </h2>

      {!enabled ? (
        <div className="mt-4">
          <Alert tone="warning">{t('settings.status.disabled')}</Alert>
        </div>
      ) : null}

      {recentEvents === 0 ? (
        <div className="mt-4">
          <Alert tone="info" title={t('settings.status.waiting')}>
            <p>{t('settings.status.waiting_hint')}</p>
          </Alert>
        </div>
      ) : (
        <div className="mt-4">
          <Alert tone="success">
            <p>
              {t('settings.status.receiving', { events: recentEvents, visitors: recentVisitors })}
            </p>
            {lastEventAt === null ? null : (
              <p className="mt-1 text-sm">
                {t('settings.status.last_event', {
                  date: format.dateTime(new Date(lastEventAt), 'short'),
                })}
              </p>
            )}
          </Alert>
        </div>
      )}
    </section>
  );
}
