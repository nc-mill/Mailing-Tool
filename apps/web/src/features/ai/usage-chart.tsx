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
    inputCostUsd: number | null;
    outputCostUsd: number | null;
    /** SKUTEČNÁ účtovaná částka. Jiná veličina než odhad, ne jeho zpřesnění. */
    reportedCost: number | null;
    /** Jednotka částky výš. NENÍ to měna, viz `reportedAmount` níž. */
    reportedCostUnit: string | null;
    priceStatus: 'reported' | 'estimated' | 'provider_reports' | 'unknown';
    longContextThresholdTokens: number | null;
  }>;
  byDay: Array<{
    day: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    inputCostUsd: number | null;
    outputCostUsd: number | null;
  }>;
  estimatedCostUsd: number | null;
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  reportedCost: number | null;
  reportedCostUnit: string | null;
  hasLongContextCaveat: boolean;
  pricingUpdatedAt: string;
};

/**
 * Spotřeba za posledních 30 dní. Peníze jsou tu proto, že platí uživatel:
 * bez ceny by se dozvěděl, kolik ho asistent stál, až z faktury poskytovatele.
 * U modelu mimo ceník se ukazuje jen spotřeba tokenů, protože vymyslet cenu by
 * znamenalo lhát (rozhodnutí D2).
 *
 * ČTYŘI různé stavy ceny se podávají čtyřmi různými větami a nejdůležitější
 * hranice vede mezi prvními dvěma: „tohle nám poskytovatel naúčtoval" je
 * doložený údaj, „tolik nám vyšlo z ceníku" je náš dopočet. Prázdná buňka je
 * nejhorší varianta ze všech: uživatel z ní nepozná, jestli ho model nic
 * nestál, jestli cenu neznáme, nebo jestli se nám ji nepodařilo spočítat.
 *
 * Graf se načítá líně: `recharts` je největší závislost balíčku a na obrazovku
 * nastavení nepatří do základního balíku.
 */
export function UsageChart({ report }: { report: UsageReportView }) {
  const t = useTranslations('ai');
  const format = useFormatter();

  const money = (value: number) =>
    format.number(value, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });

  /*
   * SKUTEČNÁ ČÁSTKA SE NEFORMÁTUJE JAKO MĚNA, a je to to nejdůležitější
   * rozhodnutí na téhle obrazovce.
   *
   * `format.number(..., { style: 'currency' })` by před číslo přilepil znak
   * dolaru. Jenže OpenRouter posílá kredity: jejich dokumentace u `usage.cost`
   * píše doslova „Cost in credits" a NIKDE neuvádí, že jeden kredit je jeden
   * dolar. Dolar u toho čísla by tedy byl údaj, který jsme si vymysleli, a to
   * je horší než žádný, protože uživatel podle něj plánuje rozpočet.
   *
   * Ukazuje se proto číslo a za ním jméno jednotky přeložené v katalogu. Kdo
   * kurz doloží, přepne to na měnu; kdo ho nedoloží, to nechá být.
   */
  const reportedAmount = (value: number, unit: string | null) => {
    const amount = format.number(value, { maximumFractionDigits: 6 });
    if (unit === null) return amount;
    // `has` chrání před jednotkou nového poskytovatele, na kterou katalog
    // ještě nemá překlad: radši holý kód jednotky než pád obrazovky.
    const key = `usage.unit.${unit}`;
    /*
     * `count` jde do překladu vedle už naformátovaného `amount` schválně.
     * Skloňování jednotky potřebuje ČÍSLO (čeština má jiný tvar pro 1, pro
     * 2 až 4, pro desetinná čísla a pro zbytek), kdežto zobrazit se musí
     * číslo naformátované podle jazyka. Jedním parametrem to nejde obojí.
     */
    return t.has(key) ? t(key, { amount, count: value }) : `${amount} ${unit}`;
  };

  if (report.totals.requests === 0) {
    return <p className="text-text-muted">{t('usage.empty')}</p>;
  }

  /*
   * Cena po dnech se kreslí jen tehdy, když ji známe za KAŽDÝ den v období.
   * Chybějící den vykreslený jako nula by v grafu vypadal jako den zdarma.
   */
  const costChartReady = report.byDay.every(
    (day) => day.inputCostUsd !== null && day.outputCostUsd !== null,
  );

  /*
   * Buňka s cenou. Čtyři stavy, čtyři různé věty, a rozdíl mezi nimi je celý
   * smysl tohohle sloupce: „tohle nám poskytovatel naúčtoval" a „tolik nám
   * vyšlo z ceníku" jsou dvě různě spolehlivé věci. Kdyby vypadaly stejně,
   * uživatel by odhad četl jako fakturu.
   *
   * Skutečná částka je proto vysázená normální barvou textu a doprovází ji
   * štítek „účtováno", kdežto odhad si nechává svůj popisek. Prázdná buňka
   * tu není nikdy: z té by nešlo poznat, jestli model nic nestál, nebo jestli
   * cenu neznáme.
   */
  const priceCell = (row: UsageReportView['byModel'][number]) => {
    if (row.priceStatus === 'reported' && row.reportedCost !== null) {
      return (
        <span className="flex flex-col items-end">
          <span>{reportedAmount(row.reportedCost, row.reportedCostUnit)}</span>
          <span className="text-xs text-text-muted">{t('usage.billedLabel')}</span>
        </span>
      );
    }
    if (row.priceStatus === 'provider_reports') {
      return <span className="text-text-muted">{t('usage.providerReportsPrice')}</span>;
    }
    if (row.estimatedCostUsd === null || row.inputCostUsd === null || row.outputCostUsd === null) {
      return <span className="text-text-muted">{t('usage.noPrice')}</span>;
    }
    return (
      <span className="flex flex-col items-end">
        <span>{money(row.estimatedCostUsd)}</span>
        <span className="text-xs text-text-muted">
          {t('usage.estimateLabel')}
          {' · '}
          {t('usage.split', {
            input: money(row.inputCostUsd),
            output: money(row.outputCostUsd),
          })}
        </span>
      </span>
    );
  };

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
        {/*
         * SKUTEČNĚ NAÚČTOVANÁ ČÁSTKA STOJÍ PŘED ODHADEM a je zvýrazněná víc.
         * Je to jediné číslo na téhle obrazovce, které někdo opravdu vyfakturoval;
         * odhad je vedle něj dopočet a musí to tak i vypadat. Když je uložená,
         * ukáže se obojí, protože pokrývají různé modely.
         */}
        {report.reportedCost === null ? null : (
          <p className="text-lg font-semibold text-text">
            {t('usage.billed', {
              amount: reportedAmount(report.reportedCost, report.reportedCostUnit),
            })}
          </p>
        )}
        <p
          className={
            report.reportedCost === null ? 'text-lg font-semibold text-text' : 'text-text-muted'
          }
        >
          {report.estimatedCostUsd === null
            ? t('usage.noPrice')
            : t('usage.estimate', { amount: money(report.estimatedCostUsd) })}
        </p>
        {report.inputCostUsd !== null && report.outputCostUsd !== null ? (
          <p className="text-text-muted">
            {t('usage.split', {
              input: money(report.inputCostUsd),
              output: money(report.outputCostUsd),
            })}
          </p>
        ) : null}
      </div>

      {/*
       * Vysvětlení rozdílu patří nahoru, ne do poznámek pod tabulkou: bez něj
       * uživatel neví, proč jsou v jednom sloupci dva druhy čísel.
       */}
      {report.reportedCost === null ? null : (
        <p className="text-sm text-text-muted">{t('usage.billedExplain')}</p>
      )}

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

      {costChartReady ? (
        <BarChart
          title={t('usage.costByDay')}
          formatValue={money}
          series={[
            {
              id: 'inputCost',
              label: t('usage.inputCost'),
              pattern: 'solid',
              points: report.byDay.map((day) => ({ x: day.day, y: day.inputCostUsd ?? 0 })),
            },
            {
              id: 'outputCost',
              label: t('usage.outputCost'),
              pattern: 'dashed',
              points: report.byDay.map((day) => ({ x: day.day, y: day.outputCostUsd ?? 0 })),
            },
          ]}
          labels={{
            showTable: t('usage.showCostTable'),
            hideTable: t('usage.hideCostTable'),
            tableCaption: t('usage.costTableCaption'),
            periodColumn: t('usage.periodColumn'),
          }}
        />
      ) : (
        <p className="text-text-muted">{t('usage.costChartUnavailable')}</p>
      )}

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
              {/*
               * Hlavička už neříká „Odhad ceny": ve sloupci teď stojí vedle
               * sebe skutečně naúčtované částky i odhady a nadpis, který slibuje
               * jen odhad, by z faktury udělal odhad.
               */}
              <th scope="col" className="pb-2 text-right">
                {t('usage.priceColumn')}
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
                  <span className="flex flex-col items-end">
                    <span>{format.number(row.inputTokens + row.outputTokens)}</span>
                    <span className="text-xs text-text-muted">
                      {t('usage.tokenSplit', {
                        input: format.number(row.inputTokens),
                        output: format.number(row.outputTokens),
                      })}
                    </span>
                  </span>
                </td>
                <td className="py-3 pr-6 text-right">{format.number(row.errors)}</td>
                <td className="py-3 text-right">{priceCell(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-1 text-sm text-text-muted">
        <p>{t('usage.estimateDisclaimer')}</p>
        <p>{t('usage.pricingUpdated', { date: report.pricingUpdatedAt })}</p>
        {report.hasLongContextCaveat ? (
          <p>
            {t('usage.longContextCaveat', {
              threshold: format.number(
                report.byModel.find((row) => row.longContextThresholdTokens !== null)
                  ?.longContextThresholdTokens ?? 0,
              ),
            })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
