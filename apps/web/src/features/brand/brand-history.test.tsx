import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import csAi from '@mlain/i18n/messages/cs/ai.json';
import { BrandHistory, type BrandExtractionView } from './brand-history';

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ ai: csAi }} timeZone="Europe/Prague">
      {ui}
    </NextIntlClientProvider>,
  );

const run = (over: Partial<BrandExtractionView> = {}): BrandExtractionView => ({
  id: crypto.randomUUID(),
  url: 'https://petrnovak.com/',
  status: 'succeeded',
  errorCode: null,
  warnings: [],
  palette: { primary: '#c41e3a', text: '#111827' },
  createdAt: '2026-08-04T09:30:00.000Z',
  finishedAt: '2026-08-04T09:30:06.000Z',
  ...over,
});

describe('historie stažení značky', () => {
  /**
   * Na tomhle místě býval seznam „Uložené značky", který po šesti stiscích
   * tlačítka Stáhnout ukazoval šestkrát tentýž web a nešlo v něm nic vybrat
   * ani přejmenovat. Nahradil ho záznam BĚHŮ.
   */
  it('je to historie běhů, ne seznam značek', () => {
    wrap(<BrandHistory runs={[run(), run(), run()]} />);

    expect(screen.getByRole('heading', { name: 'Historie stažení' })).toBeInTheDocument();
    expect(screen.queryByText('Uložené značky')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('brand-history-row')).toHaveLength(3);
  });

  it('u každého běhu je vidět kdy, odkud a co se vytáhlo', () => {
    wrap(<BrandHistory runs={[run()]} />);

    expect(screen.getByText('https://petrnovak.com/')).toBeInTheDocument();
    expect(screen.getByText('Staženo')).toBeInTheDocument();
    expect(screen.getByText('#c41e3a')).toBeInTheDocument();
    expect(screen.getByRole('time').getAttribute('dateTime')).toBe('2026-08-04T09:30:00.000Z');
  });

  /**
   * Značku má projekt jednu a přepíše ji každé stažení, takže z historie musí
   * jít poznat, ze kterého běhu barvy ve formuláři nahoře pocházejí. Je to
   * vždycky nejnovější ÚSPĚŠNÝ běh, ne prostě první řádek.
   */
  it('označí běh, ze kterého je platná značka', () => {
    wrap(
      <BrandHistory
        runs={[
          run({ status: 'failed', errorCode: 'brand_dns_failed', palette: null }),
          run(),
          run(),
        ]}
      />,
    );

    const marks = screen.getAllByText('Odsud je značka nahoře');
    expect(marks).toHaveLength(1);
    const rows = screen.getAllByTestId('brand-history-row');
    expect(rows[1]?.textContent).toContain('Odsud je značka nahoře');
  });

  /**
   * Běh, který na webu barvy nenašel, uložil neutrální výchozí paletu.
   * Vypsat ji jako „stažené barvy" by o cizím webu lhalo, a přesně tuhle
   * záměnu zadavatel na obrazovce hlásil.
   */
  it('u běhu bez nálezu se výchozí barvy nevydávají za stažené', () => {
    wrap(<BrandHistory runs={[run({ warnings: ['colors_not_found', 'logo_not_measured'] })]} />);

    expect(screen.queryByText('Stažené barvy:')).not.toBeInTheDocument();
    expect(screen.getByText('Na webu se nenašlo:')).toBeInTheDocument();
    expect(screen.getByText('barvy')).toBeInTheDocument();
  });

  it('neúspěšný běh nese důvod, ne jen razítko', () => {
    wrap(<BrandHistory runs={[run({ status: 'failed', errorCode: 'brand_dns_failed' })]} />);

    expect(screen.getByText('Nepovedlo se')).toBeInTheDocument();
    expect(screen.getByText(/jsme se nedostali/)).toBeInTheDocument();
  });

  it('bez jediného běhu to řekne rovnou', () => {
    wrap(<BrandHistory runs={[]} />);

    expect(screen.getByText('Zatím jste nic nestahovali.')).toBeInTheDocument();
    expect(screen.queryAllByTestId('brand-history-row')).toHaveLength(0);
  });
});
