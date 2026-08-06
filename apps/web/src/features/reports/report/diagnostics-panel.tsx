'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Card } from '@mlain/ui/components/card';
import type { StatsPayload } from './report-model';

export function DiagnosticsPanel({ payload }: { payload: StatsPayload }) {
  const t = useTranslations('reports');
  const format = useFormatter();

  return (
    <Card as="div" gap="none">
      <details>
        <summary className="cursor-pointer text-h3 font-semibold tracking-[var(--tracking-heading)] text-text">
          {t('report.diagnostics.heading')}
        </summary>
        <dl className="mt-[var(--spacing-stack)] flex flex-col gap-1">
          <dt className="meta-caps text-text-muted">{t('report.diagnostics.scannerClicks')}</dt>
          <dd className="font-mono text-sm text-text">
            {format.number(payload.counts.clicks_scanner ?? 0)}
          </dd>
          <dd className="text-meta text-text-muted">{t('report.diagnostics.scannerClicksHint')}</dd>
          <dt className="meta-caps mt-3 text-text-muted">{t('report.diagnostics.lastEvent')}</dt>
          <dd className="font-mono text-sm text-text">
            {payload.last_event_at === null
              ? t('report.diagnostics.noEvents')
              : format.dateTime(new Date(payload.last_event_at), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
          </dd>
          {/*
           * ODKUD SE DORUČENOST BERE MÁ VLASTNÍ ŘÁDEK a čte se z `delivered_known`
           * DŘÍV než z `delivered_source`. Předtím visel jako druhý popisek pod
           * poslední událostí a rozhodoval se jen podle zdroje, takže u účtu typu
           * `ses`, od kterého nikdy nedorazila jediná zpětná zpráva, tvrdil
           * „Doručení hlásí odesílací služba." O dvě obrazovky výš přitom stálo
           * „Zatím nevíme" a v grafu chyběla celá řada Doručeno. Diagnostika je
           * poslední místo, kde se má uživatel dozvědět pravdu, ne třetí verzi.
           */}
          <dt className="meta-caps mt-3 text-text-muted">
            {t('report.diagnostics.deliveredSource')}
          </dt>
          <dd className="text-meta text-text-muted">
            {!payload.delivered_known
              ? t('report.diagnostics.deliveredSourceUnknown')
              : payload.delivered_source === 'provider_events'
                ? t('report.diagnostics.deliveredSourceProvider')
                : t('report.diagnostics.deliveredSourceDerived')}
          </dd>
        </dl>
      </details>
    </Card>
  );
}
