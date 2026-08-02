'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { BarChart } from '@mlain/ui/patterns/charts/lazy';

export type UsageReportView = {
  totals: { requests: number; inputTokens: number; outputTokens: number; errors: number };
  byModel: Array<{
    provider: string;
    model: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    errors: number;
    estimatedCostUsd: number | null;
  }>;
  byDay: Array<{ day: string; requests: number; inputTokens: number; outputTokens: number }>;
  estimatedCostUsd: number | null;
  pricingUpdatedAt: string;
};

/**
 * Spotřeba za posledních 30 dní. Peníze jsou tu proto, že platí uživatel:
 * bez odhadu ceny by se dozvěděl, kolik ho asistent stál, až z faktury
 * poskytovatele. U modelu mimo ceník se ukazuje jen spotřeba tokenů, protože
 * vymyslet cenu by znamenalo lhát (rozhodnutí D2).
 *
 * Graf se načítá líně: `recharts` je největší závislost balíčku a na obrazovku
 * nastavení nepatří do základního balíku.
 */
export function UsageChart({ report }: { report: UsageReportView }) {
  const t = useTranslations('ai');
  const format = useFormatter();

  const money = (value: number) =>
    format.number(value, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

  if (report.totals.requests === 0) {
    return <p className="text-text-muted">{t('usage.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <p className="text-text">
          {t('usage.month', {
            requests: report.totals.requests,
            inputTokens: format.number(report.totals.inputTokens),
            outputTokens: format.number(report.totals.outputTokens),
          })}
        </p>
        <p className="text-lg font-semibold text-text">
          {report.estimatedCostUsd === null
            ? t('usage.noPrice')
            : t('usage.estimate', { amount: money(report.estimatedCostUsd) })}
        </p>
      </div>

      <BarChart
        title={t('usage.byDay')}
        series={[
          {
            id: 'requests',
            label: t('usage.requests'),
            pattern: 'solid',
            points: report.byDay.map((day) => ({ x: day.day, y: day.requests })),
          },
        ]}
        labels={{
          showTable: t('usage.showTable'),
          hideTable: t('usage.hideTable'),
          tableCaption: t('usage.tableCaption'),
          periodColumn: t('usage.periodColumn'),
        }}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('usage.byModel')}</caption>
          <thead>
            <tr>
              <th scope="col" className="pb-2 pr-6">
                {t('usage.byModel')}
              </th>
              <th scope="col" className="pb-2 pr-6 text-right">
                {t('usage.requests')}
              </th>
              <th scope="col" className="pb-2 pr-6 text-right">
                {t('usage.tokens')}
              </th>
              <th scope="col" className="pb-2 pr-6 text-right">
                {t('usage.errors')}
              </th>
              <th scope="col" className="pb-2 text-right">
                {t('usage.estimateColumn')}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.byModel.map((row) => (
              <tr key={`${row.provider}/${row.model}`} className="border-t border-border">
                <th scope="row" className="py-3 pr-6 text-left font-normal">
                  {row.provider} {'·'} <code>{row.model}</code>
                </th>
                <td className="py-3 pr-6 text-right">{format.number(row.requests)}</td>
                <td className="py-3 pr-6 text-right">
                  {format.number(row.inputTokens + row.outputTokens)}
                </td>
                <td className="py-3 pr-6 text-right">{format.number(row.errors)}</td>
                <td className="py-3 text-right">
                  {row.estimatedCostUsd === null ? (
                    <span className="text-text-muted">{t('usage.noPrice')}</span>
                  ) : (
                    money(row.estimatedCostUsd)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-text-muted">
        {t('usage.pricingUpdated', { date: report.pricingUpdatedAt })}
      </p>
    </div>
  );
}
