// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import csReports from '../../../../../../packages/i18n/messages/cs/reports.json';
import { HeadlineTiles } from './headline-tiles';
import type { StatsPayload } from './report-model';

/**
 * TENHLE SOUBOR MĚŘÍ ZAPOJENÍ, NE FUNKCI.
 *
 * `metricDisplay` v `@mlain/core/reports/metrics/display` má vlastní jednotkový
 * test a ten byl zelený celou dobu, co ji nikdo nevolal. Zelený test funkce je
 * důkaz, že funkce počítá správně, ne že se k ní uživatel dostane (nález I71).
 *
 * Proto se tady nekontroluje návratová hodnota, ale VYKRESLENÝ TEXT celého
 * řetězu komponenta -> `headlineTiles` -> `metricDisplay`. Kdyby kdokoliv
 * kterýkoliv článek obešel a formátoval si čísla po svém, tenhle test spadne.
 *
 * Kdyby spadl: neupravuj ho. Znamená to, že vypnuté měření zase vypadá jako
 * nula, a to je jiná informace než „nikdo neklikl" (3.16 části 5).
 */
const messages = { reports: csReports };

const basePayload: StatsPayload = {
  campaign_id: 'c1',
  name: 'Letní výprodej',
  subject: 'Sleva 30 %',
  status: 'sent',
  track_opens: true,
  track_clicks: true,
  delivered_source: 'provider_events',
  delivered_known: true,
  counts: {
    sent: 1153,
    delivered: 1141,
    delivered_effective: 1141,
    unsubscribed: 4,
    clicks_unique_human: 187,
  },
  rates: { click_rate: 0.164, unsubscribe_rate: 0.0035 },
  open_breakdown: {
    verified: 387,
    machine: 411,
    uncertain: 34,
    total: 832,
    clicked_from_verified: 187,
  },
  predicted_opens: null,
  small_sample: false,
  audience_built_at: null,
  started_at: null,
  finished_at: null,
  first_event_at: null,
  last_event_at: null,
  version: 42,
  updated_at: '2026-07-31T18:02:00.000Z',
};

function renderTiles(payload: StatsPayload, label: string = csReports.report.clicked.label) {
  render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <HeadlineTiles payload={payload} />
    </NextIntlClientProvider>,
  );
  const heading = screen.getByText(label);
  const tile = heading.closest('section');
  if (tile === null) throw new Error(`Dlaždice „${label}" se nevykreslila.`);
  return tile;
}

describe('HeadlineTiles je zapojená na metricDisplay', () => {
  it('u vypnutého měření prokliků ukáže vysvětlení a žádné číslo', () => {
    const tile = renderTiles({ ...basePayload, track_clicks: false });

    expect(tile).toHaveTextContent(csReports.report.states.trackingOffClicks);
    // Nula ani jakékoliv jiné číslo v dlaždici být nesmí: bez měření není co
    // ukázat a „0" by znamenala, že se měřilo a nikdo neklikl.
    expect(tile.textContent ?? '').not.toMatch(/\d/);
  });

  it('u zapnutého měření a nuly prokliků ukáže nulu, ne vysvětlení', () => {
    const tile = renderTiles({
      ...basePayload,
      counts: { ...basePayload.counts, clicks_unique_human: 0 },
      rates: { ...basePayload.rates, click_rate: 0 },
    });

    expect(tile).toHaveTextContent('0');
    expect(tile).not.toHaveTextContent(csReports.report.states.trackingOffClicks);
  });

  it('u chybějící míry ukáže pomlčku, ne nulové procento', () => {
    const tile = renderTiles({
      ...basePayload,
      rates: { ...basePayload.rates, click_rate: null },
    });

    expect(tile).toHaveTextContent('–');
    expect(tile).not.toHaveTextContent('%');
  });

  /**
   * Naměřený nález zadavatele: kampaň normálně dorazila do tří schránek a report
   * u ní hlásil „Doručeno 0". Není to špatné měření, ale ABSENCE MĚŘENÍ: doručení
   * hlásí jedině odesílací služba, a dokud od ní nedorazí ani jedna událost, není
   * to číslo z čeho vzít. Nula na tom místě tvrdí, že rozesílka nedošla nikomu.
   *
   * Kdyby tenhle test spadl: neupravuj ho. Znamená to, že se nezměřená doručenost
   * zase vydává za naměřenou nulu, což je táž záměna, jakou o pár testů výš hlídá
   * vypnuté měření prokliků.
   */
  it('u nezměřené doručenosti ukáže vysvětlení a žádné číslo, ne nulu', () => {
    const tile = renderTiles(
      {
        ...basePayload,
        delivered_known: false,
        counts: { ...basePayload.counts, delivered: 0, delivered_effective: 0 },
      },
      csReports.report.delivered.label,
    );

    expect(tile).toHaveTextContent(csReports.report.states.deliveryUnknown);
    expect(tile).toHaveTextContent(csReports.report.delivered.hintUnknown);
    // Vysvětlivka mluví o osudu e-mailů, ne o číslech, takže v dlaždici nesmí
    // zůstat ani jedna číslice. Kdyby tam „0" byla, celý smysl padá.
    expect(tile.textContent ?? '').not.toMatch(/\d/);
  });

  it('u změřené doručenosti ukáže číslo i odkud se bere', () => {
    const tile = renderTiles(basePayload, csReports.report.delivered.label);

    expect(tile).toHaveTextContent('1 141');
    expect(tile).toHaveTextContent(csReports.report.delivered.hintProvider);
    expect(tile).not.toHaveTextContent(csReports.report.states.deliveryUnknown);
  });

  it('u malého vzorku připojí k procentu výhradu', () => {
    const tile = renderTiles({ ...basePayload, small_sample: true });

    expect(tile).toHaveTextContent(csReports.report.states.smallSample);
    expect(tile).toHaveTextContent('16,4 %');
  });
});
