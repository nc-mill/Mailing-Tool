import '@testing-library/jest-dom/vitest';

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { formats } from '@mlain/i18n/formats';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import csCommon from '../../../../../packages/i18n/messages/cs/common.json';
import csContacts from '../../../../../packages/i18n/messages/cs/contacts.json';
import type { ApiJob } from './job-view';
import type { ApiWorkerStatus } from './worker-status-view';
import { JobsList } from './jobs-list';
import { JOBS_LIST_REFRESH_MS } from './refresh';

const push = vi.fn();

vi.mock('@mlain/i18n/navigation', async () => {
  const react = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      react.createElement('a', { href, ...rest }, children),
    useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  };
});

const runningJob: ApiJob = {
  id: 'i-1',
  kind: 'import',
  title: 'kveten.csv',
  status: 'running',
  done: 120,
  total: 5000,
  started_by: 'Jana Nováková',
  started_at: '2026-08-07T10:00:00.000Z',
  updated_at: '2026-08-07T10:01:00.000Z',
  finished_at: null,
  note: null,
  can_cancel: true,
  stopping: false,
};

const finishedJob: ApiJob = {
  ...runningJob,
  id: 'i-2',
  title: 'duben.csv',
  status: 'completed',
  done: 5000,
  finished_at: '2026-08-06T09:00:00.000Z',
  updated_at: '2026-08-06T09:00:00.000Z',
  can_cancel: false,
};

const audienceJob: ApiJob = {
  ...runningJob,
  id: 'c-1',
  kind: 'campaign_audience',
  title: 'Jarní výprodej',
  done: 800,
  total: 12000,
};

function renderList(
  initial: ApiJob[],
  options: {
    nextBefore?: string | null;
    total?: number;
    worker?: ApiWorkerStatus | null;
  } = {},
) {
  return render(
    <NextIntlClientProvider
      locale="cs"
      messages={{ common: csCommon, contacts: csContacts }}
      formats={formats}
      timeZone="Europe/Prague"
    >
      <JobsList
        initialJobs={initial}
        initialNextBefore={options.nextBefore ?? null}
        initialTotal={options.total ?? initial.length}
        initialWorker={options.worker ?? null}
        workspaceId="w-1"
        workspaceSlug="eshop-kolo"
      />
    </NextIntlClientProvider>,
  );
}

function respondWith(jobs: ApiJob[], nextBefore: string | null = null) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: jobs,
      running_count: jobs.length,
      total: jobs.length,
      next_before: nextBefore,
    }),
  });
}

/** Rozbalí nabídku akcí na řádku a vrátí její obsah. */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>, jobId: string) {
  await user.click(screen.getByTestId(`job-row-menu-${jobId}`));
  return screen.getByRole('menu');
}

beforeEach(() => {
  push.mockClear();
  vi.stubGlobal('fetch', respondWith([]));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Centrum úloh, tabulka', () => {
  it('ukáže úlohy, které dodal server, bez čekání na prohlížeč', () => {
    renderList([runningJob, finishedJob]);
    expect(screen.getByText('kveten.csv')).toBeVisible();
    expect(screen.getByText('duben.csv')).toBeVisible();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  /**
   * SEZNAM JE TABULKA, ne karty. Zadavatel to viděl na obrazovce: tři úlohy
   * jako karty na čtyři řádky zabraly celý displej. Měří se sloupce, ne třídy:
   * kdyby se tabulka vrátila k `JobsCenter`, tenhle test spadne.
   */
  it('kreslí se jako tabulka se sloupci, ne jako karty', () => {
    renderList([runningJob]);
    expect(screen.getByRole('columnheader', { name: 'Úloha' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Stav' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Postup' })).toBeVisible();
  });

  it('řádek nese stav i postup, aby se nemuselo klikat na detail', () => {
    renderList([runningJob]);
    expect(screen.getByText('Běží')).toBeVisible();
    expect(screen.getByText('120 z 5 000')).toBeVisible();
  });

  /**
   * ŘÁDKOVÉ AKCE JSOU V NABÍDCE, ne jako dva odkazy v řádku. Je to týž tvar
   * jako u kontaktů, seznamů a vlastních polí; čtvrtý způsob řádkových akcí
   * v produktu vznikat nemá.
   */
  it('akce řádku jsou v nabídce pod třemi tečkami', async () => {
    const user = userEvent.setup();
    renderList([runningJob]);

    // Dokud se nabídka nerozbalí, žádná položka na obrazovce není.
    expect(screen.queryByText('Otevřít import')).toBeNull();

    const menu = await openRowMenu(user, 'i-1');
    expect(within(menu).getByRole('menuitem', { name: 'Otevřít' })).toBeVisible();
    expect(within(menu).getByRole('menuitem', { name: 'Otevřít import' })).toBeVisible();
  });

  it('řádek vede na detail úlohy s druhem i ID', async () => {
    const user = userEvent.setup();
    renderList([runningJob]);

    const menu = await openRowMenu(user, 'i-1');
    await user.click(within(menu).getByRole('menuitem', { name: 'Otevřít' }));

    expect(push).toHaveBeenCalledWith('/w/eshop-kolo/jobs/import/i-1');
  });

  it('vedle detailu nabídne i obrazovku, která o úloze ví všechno', async () => {
    const user = userEvent.setup();
    renderList([runningJob]);

    const menu = await openRowMenu(user, 'i-1');
    await user.click(within(menu).getByRole('menuitem', { name: 'Otevřít import' }));

    expect(push).toHaveBeenCalledWith('/w/eshop-kolo/contacts/import/i-1');
  });

  it('tlačítko Obnovit načte seznam znovu', async () => {
    const user = userEvent.setup();
    const fetchMock = respondWith([finishedJob]);
    vi.stubGlobal('fetch', fetchMock);

    renderList([runningJob]);
    await user.click(screen.getByRole('button', { name: 'Obnovit' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContainEqual(
      expect.stringContaining('/api/v1/jobs?limit='),
    );
    await waitFor(() => expect(screen.queryByText('kveten.csv')).toBeNull());
  });

  /**
   * Jádro rozhodnutí o obnovování: časovač běží JEN dokud něco běží.
   * Kdyby tikal pořád, platila by každá otevřená záložka dotaz do databáze
   * za nic, protože seznam dokončených úloh se sám od sebe nemění.
   */
  it('dokud něco běží, obnovuje se sám', async () => {
    vi.useFakeTimers();
    const fetchMock = respondWith([runningJob]);
    vi.stubGlobal('fetch', fetchMock);

    renderList([runningJob]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOBS_LIST_REFRESH_MS + 100);
    });

    expect(fetchMock).toHaveBeenCalled();
  });

  /**
   * Měří se SEZNAM, ne „nezavolalo se nic". Panel stavu workeru se od 7. 8.
   * ptá vlastní cestou a schválně tiká pořád (zaseknutý worker se pozná právě
   * ve chvíli, kdy neběží nic), takže tvrzení „fetch se nezavolal ani jednou"
   * by od té chvíle měřilo souběh dvou nesouvisejících rozhodnutí.
   */
  it('když neběží nic, seznam se sám neobnovuje', async () => {
    vi.useFakeTimers();
    const fetchMock = respondWith([finishedJob]);
    vi.stubGlobal('fetch', fetchMock);

    renderList([finishedJob]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOBS_LIST_REFRESH_MS * 5);
    });

    const listCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).startsWith('/api/v1/jobs?'),
    );
    expect(listCalls).toHaveLength(0);
  });

  /**
   * LIMIT 50 UŽ NENÍ STROP, JE TO VELIKOST STRÁNKY, a stránkuje se šipkami
   * v patičce tabulky jako u všech ostatních seznamů. Zpátky se jde přes
   * ZÁSOBNÍK KURZORŮ: kurzor `before` umí jen dopředu, takže bez něj by šipka
   * zpátky musela zůstat trvale zašedlá.
   */
  it('šipka dopředu načte další stránku kurzorem z odpovědi', async () => {
    const user = userEvent.setup();
    const fetchMock = respondWith([finishedJob]);
    vi.stubGlobal('fetch', fetchMock);

    renderList([runningJob], { nextBefore: '2026-08-07T10:01:00.000Z', total: 2 });
    await user.click(screen.getByRole('button', { name: 'Další' }));

    await waitFor(() => expect(screen.getByText('duben.csv')).toBeInTheDocument());
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContainEqual(
      expect.stringContaining('before=2026-08-07T10%3A01%3A00.000Z'),
    );
    // Dolistovaná stránka NAHRAZUJE tu předchozí. Slití by z tabulky udělalo
    // nekonečný seznam, který se stránkovacími šipkami nejde přečíst.
    expect(screen.queryByText('kveten.csv')).toBeNull();
  });

  it('na první stránce je šipka zpátky zašedlá, na druhé už ne', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', respondWith([finishedJob], '2026-08-06T09:00:00.000Z'));

    renderList([runningJob], { nextBefore: '2026-08-07T10:01:00.000Z', total: 3 });
    expect(screen.getByRole('button', { name: 'Předchozí' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Další' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Předchozí' })).toBeEnabled());
  });

  it('patička ukazuje celek, ne jen to, co je na stránce', () => {
    renderList([runningJob], { nextBefore: '2026-08-07T10:01:00.000Z', total: 137 });
    expect(screen.getByText('Zobrazeno 1 z 137')).toBeVisible();
  });

  /**
   * Zastavení úlohy. Testy hlídají to, co se u nevratné akce dělá nejčastěji
   * špatně: zašedlá položka bez vysvětlení, potvrzení, které neřekne, co
   * zůstane, a hláška, která tvrdí „zastaveno" dřív, než se cokoli zastavilo.
   */
  it('úloha, která zastavit nejde, položku nedostane ani zašedlou', async () => {
    const user = userEvent.setup();
    renderList([finishedJob]);

    const menu = await openRowMenu(user, 'i-2');
    expect(within(menu).queryByRole('menuitem', { name: 'Zastavit import' })).toBeNull();
  });

  it('potvrzení řekne, kolik kontaktů v projektu ZŮSTANE', async () => {
    const user = userEvent.setup();
    renderList([runningJob]);

    const menu = await openRowMenu(user, 'i-1');
    await user.click(within(menu).getByRole('menuitem', { name: 'Zastavit import' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/zůstanou v projektu: 120 z 5 000/)).toBeVisible();
    // Zbytek souboru je ta druhá půlka pravdy: co se nenaimportuje.
    expect(within(dialog).getByText(/Zbytek souboru se nenaimportuje/)).toBeVisible();
  });

  it('po potvrzení hlásí vyžádané zastavení, ne hotové zastavení', async () => {
    const user = userEvent.setup();
    const stopped = {
      ...runningJob,
      status: 'cancelled' as const,
      can_cancel: false,
      stopping: true,
    };
    // Zastavení i následné načtení seznamu jdou přes tentýž `fetch`, takže se
    // odpověď vybírá podle adresy. Jedna odpověď na obojí by test uklidnila
    // falešně: seznam by dostal tvar, který nikdy nepřijde.
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).endsWith('/cancel')
          ? { outcome: 'cancelling', job: stopped }
          : { data: [stopped], running_count: 0, total: 1, next_before: null },
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderList([runningJob]);
    const menu = await openRowMenu(user, 'i-1');
    await user.click(within(menu).getByRole('menuitem', { name: 'Zastavit import' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Zastavit import' }));

    await waitFor(() =>
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/jobs/import/i-1/cancel'),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    // „Zastavení jsme vyžádali", ne „zastaveno": běh dobíhá rozepsanou dávku.
    expect(await screen.findByText(/Zastavení jsme vyžádali/)).toBeVisible();
  });

  it('u stavby publika se ptá na zrušení CELÉ kampaně, ne jen úlohy', async () => {
    const user = userEvent.setup();
    renderList([audienceJob]);

    const menu = await openRowMenu(user, 'c-1');
    await user.click(within(menu).getByRole('menuitem', { name: 'Zrušit kampaň' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/zruší celá kampaň/)).toBeVisible();
    // N3: bez zaškrtnutí následku se potvrzení neprovede. Hledá se UVNITŘ okna,
    // protože zaškrtávátka kreslí i tabulka pod ním.
    expect(within(dialog).getByRole('checkbox')).toBeVisible();
  });

  /**
   * Dokud dávka dobíhá, řádek NESMÍ tvrdit „Zrušeno". Odznak proto hlásí
   * zastavování a vedle něj stojí to, co odznak neříká: že rozpracovaná dávka
   * ještě doběhne, takže se čísla můžou pohnout.
   */
  it('dobíhající dávku přizná na řádku, místo aby ji zamlčel', () => {
    renderList([{ ...runningJob, status: 'cancelled', can_cancel: false, stopping: true }]);
    expect(screen.getByText('Zastavuje se')).toBeVisible();
    expect(screen.getByText('rozpracovaná dávka ještě doběhne')).toBeVisible();
    expect(screen.queryByText('Zrušeno')).toBeNull();
  });

  it('neúspěšné obnovení seznam nesmaže, jen přizná, že je starý', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    renderList([runningJob]);
    await user.click(screen.getByRole('button', { name: 'Obnovit' }));

    await waitFor(() => expect(screen.getByTestId('stale-banner')).toBeVisible());
    expect(screen.getByText('kveten.csv')).toBeVisible();
  });
});
