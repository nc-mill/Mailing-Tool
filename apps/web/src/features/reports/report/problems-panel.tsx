'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Card, CardTitle } from '@mlain/ui/components/card';
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
    <Card aria-labelledby="problems-heading">
      <CardTitle>
        <span id="problems-heading">{t('report.problems.heading')}</span>
      </CardTitle>
      {/* Čísla vpravo, popisky vlevo, řádky oddělené linkou. Bez toho tabulka
          rozprostře sloupce náhodně po šířce a vypadá jako výpis, ne jako
          součást produktu. */}
      <table className="w-full">
        <caption className="sr-only">{t('report.problems.heading')}</caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border">
              <th scope="row" className="py-3 text-left text-ui font-normal text-text">
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
                  <td className="py-3 text-right font-mono text-sm tabular-nums text-text">
                    {format.number(row.count)}
                  </td>
                  <td className="py-3 text-right font-mono text-sm tabular-nums text-text-muted">
                    {row.rate === null
                      ? '–'
                      : format.number(row.rate, { style: 'percent', maximumFractionDigits: 2 })}
                  </td>
                  <td
                    className={`py-3 text-right font-mono text-sm ${row.warn ? 'text-danger-text' : 'text-text-muted'}`}
                  >
                    {row.warn ? t('report.problems.high') : t('report.problems.withinNorm')}
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      className="min-h-[var(--size-target-min)] px-2 text-ui text-accent-text underline underline-offset-[3px]"
                      onClick={() => onShowWho(row.filter)}
                    >
                      {t('report.problems.showWho')}
                    </button>
                  </td>
                </>
              ) : (
                <td colSpan={4} className="py-3 text-right font-mono text-sm text-text-muted">
                  {t('report.problems.notMeasured')}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {gap === null ? null : (
        <p className="text-meta text-text-muted" data-testid="problems-not-measured">
          {t(FEEDBACK_GAP_BODY_KEY[gap])}
        </p>
      )}
    </Card>
  );
}
