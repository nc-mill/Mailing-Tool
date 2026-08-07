import '@testing-library/jest-dom/vitest';

import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { formats } from '@mlain/i18n/formats';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import csCommon from '../../../../../packages/i18n/messages/cs/common.json';
import { WORKER_STATUS_REFRESH_MS } from './refresh';
import { WorkerStatusPanel } from './worker-status-panel';
import type { ApiWorkerStatus } from './worker-status-view';

const healthy: ApiWorkerStatus = {
  state: 'running',
  last_seen_at: '2026-08-07T10:00:00.000Z',
  seconds_since_last_seen: 5,
  queue: { waiting: 3, running: 1, failed_recent: 12, failed_window_hours: 24, dead_letter: 0 },
  queues: { registered: 60, cron_expected: 30, cron_scheduled: 30 },
};

function renderPanel(worker: ApiWorkerStatus | null) {
  return render(
    <NextIntlClientProvider
      locale="cs"
      messages={{ common: csCommon }}
      formats={formats}
      timeZone="Europe/Prague"
    >
      <WorkerStatusPanel initialWorker={worker} workspaceId="w-1" />
    </NextIntlClientProvider>,
  );
}

function respondWith(worker: ApiWorkerStatus) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ worker }) });
}

beforeEach(() => {
  vi.stubGlobal('fetch', respondWith(healthy));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Panel stavu zpracování na pozadí', () => {
  it('ukazuje čísla fronty, ne jen to, že worker běží', () => {
    renderPanel(healthy);

    expect(screen.getByText('Běží')).toBeInTheDocument();
    expect(screen.getByText('Čeká ve frontě')).toBeInTheDocument();
    // Popisek NESE OKNO. Bez něj je číslo poplašná zpráva: 7. 8. stálo na
    // panelu „SELHALO 4 142" a 4 116 z toho byla jedna dávno spravená fronta.
    expect(screen.getByText('Selhalo za 24 h')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  /**
   * Jádro zadání: obrazovka má říct, jestli worker běží, NEBO JE ZASEKNUTÝ.
   * Mezistupeň `late` je proto vlastní zpráva, ne mlčení: „chvíli se neozval"
   * znamená počkat, „neběží" znamená volat správce.
   */
  it('u zpožděného workeru říká něco jiného než u zastaveného', () => {
    const { unmount } = renderPanel({ ...healthy, state: 'late' });
    expect(screen.getByText('Chvíli se neozval')).toBeInTheDocument();
    unmount();

    renderPanel({ ...healthy, state: 'down' });
    expect(screen.getByText('Neběží')).toBeInTheDocument();
  });

  /**
   * Nezměřený stav NENÍ „neběží". `unknown` znamená, že se nepodařilo přečíst
   * frontu (chybějící schéma, nedostupná databáze); tvrdit v tu chvíli, že
   * worker stojí, by poslalo člověka hledat na nesprávné místo.
   */
  it('nezměřený stav se nevydává za zastavený worker', () => {
    renderPanel({ ...healthy, state: 'unknown' });

    expect(screen.getByText('Nezměřeno')).toBeInTheDocument();
    expect(screen.queryByText('Neběží')).toBeNull();
  });

  /**
   * Běžící worker s plnou dead letter frontou je pořád porucha: ty úlohy
   * vyčerpaly všechny pokusy a NIKDO je nevezme. Panel, který by koukal jen
   * na stav workeru, by se v tu chvíli tvářil zeleně.
   */
  it('odložené úlohy hlásí i u běžícího workeru', () => {
    renderPanel({ ...healthy, queue: { ...healthy.queue, dead_letter: 2 } });

    expect(screen.getByText('Běží')).toBeInTheDocument();
    expect(screen.getByText(/Něco se nezpracovává samo/)).toBeInTheDocument();
  });

  it('cronové fronty bez obsluhy pojmenuje, místo aby je zamlčel', () => {
    renderPanel({
      ...healthy,
      queues: { registered: 60, cron_expected: 30, cron_scheduled: 22 },
    });

    expect(screen.getByText(/8 front nemá v téhle verzi obsluhu/)).toBeInTheDocument();
  });

  /**
   * TOHLE JE TEN ROZDÍL PROTI SEZNAMU. Seznam se obnovuje jen dokud něco běží,
   * což je u něj správně; panel se musí ptát i tehdy, když neběží nic, protože
   * přesně tak vypadá zaseknutý worker. Kdyby zdědil pravidlo seznamu, zamrzl
   * by ve chvíli, kdy ho někdo čte.
   */
  it('obnovuje se, i když nic neběží', async () => {
    vi.useFakeTimers();
    const fetchMock = respondWith({ ...healthy, queue: { ...healthy.queue, waiting: 9 } });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel({
      ...healthy,
      queue: { ...healthy.queue, waiting: 0, running: 0, failed_recent: 0, dead_letter: 0 },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORKER_STATUS_REFRESH_MS + 100);
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/jobs/worker', expect.anything());
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  /**
   * Skrytá záložka se neptá. Je to totéž rozhodnutí jako u seznamu, jen tady
   * váží víc: panel na rozdíl od seznamu tiká pořád, takže odložená záložka
   * by se ptala do konce dne.
   */
  it('skrytá záložka se neptá', async () => {
    vi.useFakeTimers();
    const fetchMock = respondWith(healthy);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    renderPanel(healthy);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORKER_STATUS_REFRESH_MS * 3);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * Nepodařené měření panel NEKRESLÍ. Karta s pomlčkami tvrdí, že se měřilo
   * a nic nevyšlo, což je horší než nic: uživatel by z ní usoudil, že fronta
   * je prázdná.
   */
  it('bez naměřeného stavu se nekreslí vůbec', () => {
    const { container } = renderPanel(null);
    expect(container).toBeEmptyDOMElement();
  });
});
