'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { StatsPayload } from './report-model';

const BOUNCE_WARN = 0.04;
const COMPLAINT_WARN = 0.001;

export function ProblemsPanel({
  payload,
  onShowWho,
}: {
  payload: StatsPayload;
  onShowWho: (filter: string) => void;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();

  const rows = [
    {
      key: 'bounced',
      filter: 'bounced',
      count: (payload.counts.bounced_hard ?? 0) + (payload.counts.bounced_soft ?? 0),
      rate: payload.rates.bounce_rate ?? null,
      warn: (payload.rates.bounce_rate ?? 0) > BOUNCE_WARN,
    },
    {
      key: 'complained',
      filter: 'complained',
      count: payload.counts.complained ?? 0,
      rate: payload.rates.complaint_rate ?? null,
      warn: (payload.rates.complaint_rate ?? 0) > COMPLAINT_WARN,
    },
    {
      key: 'failed',
      filter: 'bounced',
      count: payload.counts.failed ?? 0,
      rate: null,
      warn: false,
    },
  ];

  return (
    <section
      aria-labelledby="problems-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="problems-heading" className="text-base font-semibold">
        {t('report.problems.heading')}
      </h2>
      {/* Čísla vpravo, popisky vlevo, řádky oddělené linkou. Bez toho tabulka
          rozprostře sloupce náhodně po šířce a vypadá jako výpis, ne jako
          součást produktu. */}
      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">{t('report.problems.heading')}</caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border first:border-t-0">
              <th scope="row" className="py-2 text-left font-normal">
                {t(`report.problems.${row.key}`)}
              </th>
              <td className="py-2 text-right tabular-nums">{format.number(row.count)}</td>
              <td className="py-2 text-right tabular-nums">
                {row.rate === null
                  ? '–'
                  : format.number(row.rate, { style: 'percent', maximumFractionDigits: 2 })}
              </td>
              <td
                className={`py-2 text-right ${row.warn ? 'text-danger-text' : 'text-text-muted'}`}
              >
                {row.warn ? t('report.problems.high') : t('report.problems.withinNorm')}
              </td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  className="inline-flex min-h-6 min-w-6 items-center justify-center rounded px-2 py-1 text-accent-text underline"
                  onClick={() => onShowWho(row.filter)}
                >
                  {t('report.problems.showWho')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
