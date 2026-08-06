'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Card, CardTitle } from '@mlain/ui/components/card';

export type SystemLinkClicks = {
  unsubscribe_page: number;
  preferences: number;
  webview: number;
};

const ROWS = [
  { key: 'unsubscribe_page', labelKey: 'report.systemLinks.unsubscribePage' },
  { key: 'preferences', labelKey: 'report.systemLinks.preferences' },
  { key: 'webview', labelKey: 'report.systemLinks.webview' },
] as const;

/**
 * Kliknutí na odkazy v patičce, SAMOSTATNĚ VEDLE ČÍSEL KAMPANĚ.
 *
 * VZNIKLO ZE STÍŽNOSTI. Zadavatel klikl v doručeném e-mailu na „Nastavit
 * předvolby" a report ukazoval nulu. Klik se přitom měřil, jen se neměl kde
 * ukázat: do `campaign_stats.clicks_*` se systémový proklik ZÁMĚRNĚ nezapočítává.
 *
 * DO MÍRY PROKLIKU TO NESMÍ VSTOUPIT. Panel proto stojí mimo dlaždice a mimo
 * tabulku odkazů a věta pod ním to říká nahlas, aby to za půl roku nikdo
 * nesečetl dohromady s prokliky na obsah. Odhlášení není zájem o sdělení a
 * míra prokliku, do které by se počítalo, by se nedala srovnat s ničím jiným
 * na trhu.
 *
 * Na localhostu je to navíc často JEDINÁ interakce, která vůbec dorazí:
 * měřicí pixel jde u Gmailu přes proxy Googlu, kdežto systémový odkaz otevírá
 * prohlížeč příjemce.
 */
export function SystemLinksPanel({ clicks }: { clicks: SystemLinkClicks | null }) {
  const t = useTranslations('reports');
  const format = useFormatter();

  if (clicks === null) return null;

  const total = clicks.unsubscribe_page + clicks.preferences + clicks.webview;

  return (
    <Card data-testid="system-links-panel" aria-labelledby="system-links-heading">
      <CardTitle>
        <span id="system-links-heading">{t('report.systemLinks.heading')}</span>
      </CardTitle>

      {total === 0 ? (
        // Pravdivá nula, ne chybějící údaj: měření systémových odkazů běží vždy,
        // takže „nikdo neklikl" je tady měření, a smí se to napsat jako fakt.
        <p className="text-ui text-text-muted">{t('report.systemLinks.none')}</p>
      ) : (
        <dl className="grid gap-x-[var(--spacing-card)] gap-y-1 sm:grid-cols-[1fr_auto]">
          {ROWS.map((row) => (
            <div key={row.key} className="contents">
              <dt className="text-ui text-text">{t(row.labelKey)}</dt>
              <dd
                data-testid={`system-links-${row.key}`}
                className="text-right font-mono text-sm tabular-nums text-text"
              >
                {format.number(clicks[row.key])}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <p className="text-meta text-text-muted">{t('report.systemLinks.notInClickRate')}</p>
    </Card>
  );
}
