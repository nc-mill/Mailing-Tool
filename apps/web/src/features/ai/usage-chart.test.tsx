import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import csAi from '@mlain/i18n/messages/cs/ai.json';
import enAi from '@mlain/i18n/messages/en/ai.json';
import { UsageChart, type UsageReportView } from './usage-chart';

const wrap = (ui: ReactNode, locale: 'cs' | 'en' = 'cs') =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ ai: locale === 'cs' ? csAi : enAi }}
      timeZone="Europe/Prague"
    >
      {ui}
    </NextIntlClientProvider>,
  );

type ModelRow = UsageReportView['byModel'][number];

const model = (overrides: Partial<ModelRow>): ModelRow => ({
  provider: 'openrouter',
  model: 'nejaky/model',
  requests: 4,
  inputTokens: 1_000,
  outputTokens: 200,
  errors: 0,
  estimatedCostUsd: null,
  inputCostUsd: null,
  outputCostUsd: null,
  reportedCost: null,
  reportedCostUnit: null,
  priceStatus: 'unknown',
  longContextThresholdTokens: null,
  ...overrides,
});

const report = (overrides: Partial<UsageReportView> = {}): UsageReportView => ({
  totals: { requests: 4, inputTokens: 1_000, outputTokens: 200, errors: 0 },
  byModel: [],
  byDay: [
    {
      day: '2026-08-03',
      requests: 4,
      inputTokens: 1_000,
      outputTokens: 200,
      inputCostUsd: null,
      outputCostUsd: null,
    },
  ],
  estimatedCostUsd: null,
  inputCostUsd: null,
  outputCostUsd: null,
  reportedCost: null,
  reportedCostUnit: null,
  hasLongContextCaveat: false,
  pricingUpdatedAt: '2026-08-01',
  ...overrides,
});

describe('přehled spotřeby rozlišuje účtovanou částku od odhadu', () => {
  it('skutečná částka se ukáže v KREDITECH, nikdy jako dolary', () => {
    wrap(
      <UsageChart
        report={report({
          byModel: [
            model({
              priceStatus: 'reported',
              reportedCost: 0.0042,
              reportedCostUnit: 'openrouter_credit',
            }),
          ],
          reportedCost: 0.0042,
          reportedCostUnit: 'openrouter_credit',
        })}
      />,
    );

    /*
     * TOHLE JE JÁDRO CELÉ ZMĚNY. OpenRouter posílá kredity a nikde nedoložil,
     * že kredit je dolar. Kdyby se částka vysázela jako měna, přibyl by k číslu
     * znak dolaru, který jsme si vymysleli, a uživatel by podle něj plánoval
     * rozpočet. Test proto hlídá obojí: jednotka je vidět, dolar u ní není.
     */
    // Částka stojí v souhrnu nahoře i v řádku tabulky, proto `getAllByText`.
    expect(screen.getAllByText(/0,0042 kreditu OpenRouteru/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Skutečně naúčtováno/)).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('účtovaná částka a odhad mají v tabulce různý popisek', () => {
    wrap(
      <UsageChart
        report={report({
          totals: { requests: 8, inputTokens: 2_000, outputTokens: 400, errors: 0 },
          byModel: [
            model({
              priceStatus: 'reported',
              reportedCost: 0.0042,
              reportedCostUnit: 'openrouter_credit',
            }),
            model({
              provider: 'anthropic',
              model: 'claude-opus-5',
              priceStatus: 'estimated',
              estimatedCostUsd: 0.4,
              inputCostUsd: 0.2,
              outputCostUsd: 0.2,
            }),
          ],
          reportedCost: 0.0042,
          reportedCostUnit: 'openrouter_credit',
        })}
      />,
    );

    // Dvě různě spolehlivé věci se nesmí podat stejně.
    expect(screen.getByText('účtováno poskytovatelem')).toBeInTheDocument();
    expect(screen.getByText(/odhad z ceníku/)).toBeInTheDocument();
    expect(screen.getByText(/jsou to skutečně strhnuté peníze/)).toBeInTheDocument();
  });

  it('bez uložené částky se o účtování nemluví vůbec', () => {
    wrap(
      <UsageChart
        report={report({
          byModel: [
            model({
              provider: 'anthropic',
              model: 'claude-opus-5',
              priceStatus: 'estimated',
              estimatedCostUsd: 0.4,
              inputCostUsd: 0.2,
              outputCostUsd: 0.2,
            }),
          ],
          estimatedCostUsd: 0.4,
          inputCostUsd: 0.2,
          outputCostUsd: 0.2,
        })}
      />,
    );
    expect(screen.queryByText(/Skutečně naúčtováno/)).not.toBeInTheDocument();
    expect(screen.getByText(/Odhad ceny/)).toBeInTheDocument();
  });

  it('starý řádek bez uložené ceny říká, že ji aplikace tehdy neukládala', () => {
    wrap(<UsageChart report={report({ byModel: [model({ priceStatus: 'provider_reports' })] })} />);
    expect(screen.getByText(/aplikace ji ještě neukládala/)).toBeInTheDocument();
  });

  it('jednotka se skloňuje: jeden kredit, pět kreditů', () => {
    const { unmount } = wrap(
      <UsageChart
        report={report({
          byModel: [
            model({
              priceStatus: 'reported',
              reportedCost: 1,
              reportedCostUnit: 'openrouter_credit',
            }),
          ],
          reportedCost: 1,
          reportedCostUnit: 'openrouter_credit',
        })}
      />,
    );
    // Částka stojí v souhrnu nahoře i v řádku tabulky, proto `getAllByText`.
    expect(screen.getAllByText(/1 kredit OpenRouteru/).length).toBeGreaterThan(0);
    unmount();

    wrap(
      <UsageChart
        report={report({
          byModel: [
            model({
              priceStatus: 'reported',
              reportedCost: 5,
              reportedCostUnit: 'openrouter_credit',
            }),
          ],
          reportedCost: 5,
          reportedCostUnit: 'openrouter_credit',
        })}
      />,
    );
    // Částka stojí v souhrnu nahoře i v řádku tabulky, proto `getAllByText`.
    expect(screen.getAllByText(/5 kreditů OpenRouteru/).length).toBeGreaterThan(0);
  });

  it('anglický katalog mluví o creditech, ne o dolarech', () => {
    wrap(
      <UsageChart
        report={report({
          byModel: [
            model({
              priceStatus: 'reported',
              reportedCost: 1,
              reportedCostUnit: 'openrouter_credit',
            }),
          ],
          reportedCost: 1,
          reportedCostUnit: 'openrouter_credit',
        })}
      />,
      'en',
    );
    // Částka stojí v souhrnu nahoře i v řádku tabulky, proto `getAllByText`.
    expect(screen.getAllByText(/1 OpenRouter credit/).length).toBeGreaterThan(0);
  });

  it('neznámá jednotka nového poskytovatele obrazovku nepoloží', () => {
    wrap(
      <UsageChart
        report={report({
          byModel: [
            model({
              priceStatus: 'reported',
              reportedCost: 3,
              reportedCostUnit: 'jednotka_bez_prekladu',
            }),
          ],
          reportedCost: 3,
          reportedCostUnit: 'jednotka_bez_prekladu',
        })}
      />,
    );
    // Radši holý kód jednotky než pád obrazovky, ale nikdy ne číslo bez ní.
    // Částka stojí v souhrnu nahoře i v řádku tabulky, proto `getAllByText`.
    expect(screen.getAllByText(/3 jednotka_bez_prekladu/).length).toBeGreaterThan(0);
  });
});
