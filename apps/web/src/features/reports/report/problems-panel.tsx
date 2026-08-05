'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { FEEDBACK_GAP_BODY_KEY, type FeedbackGap } from './provider-feedback';
import type { StatsPayload } from './report-model';

const BOUNCE_WARN = 0.04;
const COMPLAINT_WARN = 0.001;

export function ProblemsPanel({
  payload,
  gap,
  onShowWho,
}: {
  payload: StatsPayload;
  /**
   * Chybí zpětná vazba od odesílací služby? Rozhoduje `feedbackGap`, ne panel:
   * potřebuje k tomu aktuální čas a ten patří tam, kde se report skládá, ne
   * do komponenty, která se překresluje.
   *
   * `null` znamená „údaje máme naměřené" a nula je pak opravdu nula.
   */
  gap: FeedbackGap | null;
  onShowWho: (filter: string) => void;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();

  /*
   * ODRAZY A STÍŽNOSTI SE BEZ ZPĚTNÝCH UDÁLOSTÍ NEMĚŘÍ, viz `provider-feedback.ts`.
   * Dřív se u nich vždycky vykreslila „0" a „v normě", tedy „poslali jsme
   * a nikomu se to neodrazilo". Nula a chybějící údaj jsou dvě různé věci.
   */
  const measured = gap === null;

  const rows = [
    {
      key: 'bounced',
      filter: 'bounced',
      count: (payload.counts.bounced_hard ?? 0) + (payload.counts.bounced_soft ?? 0),
      rate: payload.rates.bounce_rate ?? null,
      warn: (payload.rates.bounce_rate ?? 0) > BOUNCE_WARN,
      measured,
    },
    {
      key: 'complained',
      filter: 'complained',
      count: payload.counts.complained ?? 0,
      rate: payload.rates.complaint_rate ?? null,
      warn: (payload.rates.complaint_rate ?? 0) > COMPLAINT_WARN,
      measured,
    },
    {
      // Selhání odesílání zapisuje odesílací proces sám, takže se měří vždycky,
      // i u SMTP účtu. Míra u nich není, jmenovatel by neznamenal nic.
      key: 'failed',
      filter: 'bounced',
      count: payload.counts.failed ?? 0,
      rate: null,
      warn: false,
      measured: true,
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
              {/*
                Nezměřený řádek NEUKAZUJE nulu ani procento, ukáže větu přes
                celou šířku. Nula s poznámkou vedle by se pořád četla jako
                naměřená hodnota. „Zobrazit komu" u něj taky není: vedlo by na
                prázdný seznam, který by tvrdil totéž špatně.
              */}
              {row.measured ? (
                <>
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
                </>
              ) : (
                <td colSpan={4} className="py-2 text-right text-text-muted">
                  {t('report.problems.notMeasured')}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {gap === null ? null : (
        <p className="mt-3 text-sm text-text-muted" data-testid="problems-not-measured">
          {t(FEEDBACK_GAP_BODY_KEY[gap])}
        </p>
      )}
    </section>
  );
}
