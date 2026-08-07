import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './test-utils';
import { CampaignsScreen } from './campaigns-screen';
import type { CampaignRow } from './campaign-list';

/**
 * Seznam kampaní. Tři věci, které tenhle soubor hlídá:
 *
 *  - Regrese na nález: tlačítko „Vytvořit kampaň" bylo JEN v prázdném stavu.
 *    Nic nespadlo a testy byly zelené, jen po založení první kampaně tlačítko
 *    zmizelo a druhou už nešlo z rozhraní založit vůbec.
 *  - Akce z řádkové nabídky se testují CELOU obrazovkou, ne samotným dialogem.
 *    Test komponenty s ručně dodanými propy by neodhalil, že tabulka obsluhu
 *    nikdy nedostane a nabídka je mrtvá.
 *  - Duplikace: endpoint `POST /campaigns/{id}/duplicate` existoval bez jediného
 *    tlačítka. Kdyby tenhle blok spadl, je zpátky.
 */

const remove = vi.fn().mockResolvedValue({ status: 'success' });
const duplicate = vi.fn().mockResolvedValue({ status: 'success', campaignId: 'camp-3' });
const pause = vi.fn().mockResolvedValue({ status: 'success' });
const cancel = vi.fn().mockResolvedValue({ status: 'success' });
vi.mock('./actions', () => ({
  deleteCampaignAction: (input: unknown) => remove(input),
  duplicateCampaignAction: (input: unknown) => duplicate(input),
  pauseCampaignAction: (input: unknown) => pause(input),
  resumeCampaignAction: vi.fn().mockResolvedValue({ status: 'success' }),
  unscheduleCampaignAction: vi.fn().mockResolvedValue({ status: 'success' }),
  cancelCampaignAction: (input: unknown) => cancel(input),
  renameCampaignAction: vi.fn().mockResolvedValue({ status: 'success' }),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock('@mlain/i18n/navigation', async () => {
  const react = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      react.createElement('a', { href, ...rest }, children),
    useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh }),
  };
});

const ROWS: CampaignRow[] = [
  {
    id: 'camp-1',
    name: 'Letní výprodej',
    status: 'draft',
    audience_size: 12,
    counters: { total: 12, sent: 0, delivered: 0, bounced: 0 },
    updated_at: '2026-08-01T10:00:00.000Z',
    template_id: 'tpl-1',
    pause_reason: null,
  },
  {
    id: 'camp-2',
    name: 'Jarní novinky',
    status: 'sent',
    audience_size: 40,
    counters: { total: 40, sent: 40, delivered: 39, bounced: 1 },
    updated_at: '2026-07-01T10:00:00.000Z',
    template_id: 'tpl-2',
    pause_reason: null,
  },
];

beforeEach(() => {
  remove.mockClear();
  remove.mockResolvedValue({ status: 'success' });
  duplicate.mockClear();
  duplicate.mockResolvedValue({ status: 'success', campaignId: 'camp-3' });
  pause.mockClear();
  cancel.mockClear();
  push.mockClear();
  refresh.mockClear();
  window.localStorage.clear();
});

/** Všechno smí každý; omezená práva se testují nad samotnou tabulkou. */
const ALL_PERMISSIONS = {
  editContent: true,
  write: true,
  send: true,
  control: true,
  remove: true,
};

/** Otevře nabídku „…" v řádku dané kampaně. */
async function openRowMenu(name: string) {
  await userEvent.click(screen.getByRole('button', { name: `Další akce s kampaní ${name}` }));
}

function renderScreen(state: 'data' | 'empty') {
  return renderWithProviders(
    <CampaignsScreen
      rows={state === 'data' ? ROWS : []}
      state={state}
      basePath="/w/kolo-shop"
      workspaceId="ws-1"
      permissions={ALL_PERMISSIONS}
    />,
  );
}

describe('seznam kampaní', () => {
  it('nabízí založení kampaně i tehdy, když už nějaká existuje', async () => {
    renderScreen('data');

    await userEvent.click(screen.getByTestId('create-campaign'));

    // Zakládání začíná OBSAHEM, ne prázdným řádkem v databázi.
    await waitFor(() => expect(push).toHaveBeenCalledWith('/w/kolo-shop/campaigns/new'));
  });

  it('v prázdném stavu vede akce na týž první krok', async () => {
    renderScreen('empty');

    expect(screen.queryByTestId('create-campaign')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Vytvořit kampaň' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/w/kolo-shop/campaigns/new'));
  });
});

describe('mazání kampaně ze seznamu', () => {
  it('rozepsaná kampaň mazání nabízí, odeslaná ne', async () => {
    renderScreen('data');

    await openRowMenu('Letní výprodej');
    expect(screen.getByRole('menuitem', { name: 'Smazat' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await openRowMenu('Jarní novinky');
    expect(screen.queryByRole('menuitem', { name: 'Smazat' })).toBeNull();
  });

  it('položka je opravdu napojená: potvrzení zavolá akci a seznam se obnoví', async () => {
    renderScreen('data');

    await openRowMenu('Letní výprodej');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Smazat' }));
    // Dialog říká, co se stane, ne jen „opravdu?".
    expect(screen.getByText('Smazat kampaň Letní výprodej?')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('delete-campaign-submit'));

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ workspaceId: 'ws-1', campaignId: 'camp-1' }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('odmítnutí serveru pojmenuje stav, ne kód, a dialog nezavře', async () => {
    remove.mockResolvedValueOnce({
      status: 'error',
      code: 'conflict',
      campaignStatus: 'scheduled',
      detail: '',
    });
    renderScreen('data');

    await openRowMenu('Letní výprodej');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Smazat' }));
    await userEvent.click(screen.getByTestId('delete-campaign-submit'));

    const error = await screen.findByTestId('delete-campaign-error');
    expect(error).toHaveTextContent('Zrušte plán');
    // Obnova by chybovou hlášku přebila novým vykreslením.
    expect(refresh).not.toHaveBeenCalled();
  });
});

/**
 * HROMADNÉ MAZÁNÍ Z PRUHU VÝBĚRU.
 *
 * Nález zadavatele: „Multivýběr. Nemůžu s nimi nic dělat. Třeba je smazat, pokud
 * jsou rozepsané. Jediné, co tam je, je vybrat všech 12, ale to mi je k prdu."
 * Zaškrtávátka kreslí `DataTable` vždycky, ale seznam kampaní si výběr nebral ven,
 * takže pruh nabízel jedině vybrat všechno a výběr zrušit.
 *
 * Hlídá se hlavně to, co je na hromadném mazání nebezpečné: výběr může obsahovat
 * kampaně, které smazat nejde, a tichý částečný úspěch je nepřijatelný.
 */
describe('hromadné mazání ze seznamu', () => {
  /** Zaškrtne řádek podle pořadí v tabulce. Popisek mají všechny řádky stejný. */
  async function selectRow(index: number) {
    const boxes = screen.getAllByRole('checkbox', { name: 'Označit řádek' });
    const box = boxes[index];
    if (box === undefined) throw new Error(`řádek ${index} v tabulce není`);
    await userEvent.click(box);
  }

  it('výběr vede k akci, ne jen k počtu', async () => {
    renderScreen('data');
    await selectRow(0);

    // Pruh výběru s akcí, ne bez ní. Tohle je celý nález.
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
    expect(screen.getByTestId('campaigns-bulk-delete')).toHaveTextContent('Smazat 1 kampaň');
  });

  it('tlačítko počítá jen kampaně, které jádro smazat nechá', async () => {
    renderScreen('data');
    await selectRow(0);
    await selectRow(1);

    // Označené jsou dvě, ale odeslanou kampaň smazat nelze, takže tlačítko slibuje jednu.
    expect(screen.getByTestId('campaigns-bulk-delete')).toHaveTextContent('Smazat 1 kampaň');

    await userEvent.click(screen.getByTestId('campaigns-bulk-delete'));
    // A dialog to řekne nahlas, aby po akci nikdo nehledal, kam se zbytek poděl.
    expect(screen.getByTestId('bulk-delete-campaigns-skipped')).toHaveTextContent(
      '1 další označená kampaň zůstane',
    );
  });

  it('maže se jen to, co jde, a odeslaná kampaň zůstane ve výběru', async () => {
    renderScreen('data');
    await selectRow(0);
    await selectRow(1);

    await userEvent.click(screen.getByTestId('campaigns-bulk-delete'));
    await userEvent.click(screen.getByTestId('bulk-delete-campaigns-submit'));

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith({ workspaceId: 'ws-1', campaignId: 'camp-1' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    // Výběr se po úspěchu uklidil, ale nesmazatelná kampaň v něm zůstala:
    // je to jediné, s čím se dá dál něco dělat.
    await waitFor(() => expect(screen.queryByTestId('campaigns-bulk-delete')).toBeNull());
    expect(screen.getByTestId('campaigns-bulk-nothing')).toHaveTextContent(
      'Z označených kampaní nejde smazat žádná',
    );
  });

  it('výběr samotné odeslané kampaně nabídne vysvětlení, ne zašedlé tlačítko', async () => {
    renderScreen('data');
    await selectRow(1);

    expect(screen.queryByTestId('campaigns-bulk-delete')).toBeNull();
    expect(screen.getByTestId('campaigns-bulk-nothing')).toBeInTheDocument();
  });

  /*
   * ODKAZ „VYBRAT VŠECH N" SE TU NENABÍZÍ, A JE TO SPRÁVNĚ.
   *
   * Seznam kampaní se nestránkuje, takže by odkaz sliboval rozšíření výběru na řádky,
   * které jsou všechny na obrazovce a dají se zaškrtnout hlavičkou. Do 7. 8. 2026 tu
   * odkaz stál a vedl do prázdna: přepnul režim UVNITŘ `DataTable`, pruh napsal
   * „Vybráno všech 9" a akce pod ním dál pracovala se zaškrtnutými řádky. Přesně
   * na tohle si zadavatel stěžoval („vybrat všech 12, ale to mi je k prdu").
   */
  it('nenabízí vybrat všech N, protože je celá tabulka na jedné stránce', async () => {
    renderScreen('data');
    await selectRow(0);

    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Vybrat všech/ })).toBeNull();
  });

  it('nezdar u serveru výběr nezruší a pojmenuje se počtem', async () => {
    remove.mockResolvedValueOnce({
      status: 'error',
      code: 'conflict',
      campaignStatus: 'scheduled',
      detail: 'Kampaň je naplánovaná.',
    });
    renderScreen('data');
    await selectRow(0);

    await userEvent.click(screen.getByTestId('campaigns-bulk-delete'));
    await userEvent.click(screen.getByTestId('bulk-delete-campaigns-submit'));

    const error = await screen.findByTestId('bulk-delete-campaigns-error');
    expect(error).toHaveTextContent('Kampaň je naplánovaná.');
    // Odklikaná práce se po chybě neztrácí.
    expect(screen.getByTestId('campaigns-bulk-delete')).toBeInTheDocument();
  });
});

describe('duplikace kampaně ze seznamu', () => {
  /*
   * Duplikaci nabízí KAŽDÝ stav včetně odeslaného. U odeslané kampaně je to
   * jediná zbývající akce a zároveň jediná podporovaná cesta, jak poslat totéž
   * znovu: přechod `sent → sending` stavový automat schválně nezná.
   */
  it('odeslaná kampaň nabízí kopii a po ní se otevře ta kopie, ne předloha', async () => {
    renderScreen('data');

    await openRowMenu('Jarní novinky');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplikovat' }));

    await waitFor(() =>
      expect(duplicate).toHaveBeenCalledWith({ workspaceId: 'ws-1', campaignId: 'camp-2' }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/w/kolo-shop/campaigns/camp-3'));
  });

  it('selhání kopie neodnaviguje nikam', async () => {
    duplicate.mockResolvedValueOnce({ status: 'error', code: 'forbidden' });
    renderScreen('data');

    await openRowMenu('Jarní novinky');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplikovat' }));

    await waitFor(() => expect(duplicate).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });
});

describe('zrušení rozesílky ze seznamu', () => {
  const RUNNING: CampaignRow = {
    id: 'camp-9',
    name: 'Běžící rozesílka',
    status: 'sending',
    audience_size: 500,
    counters: { total: 500, sent: 120, delivered: 118, bounced: 2 },
    updated_at: '2026-08-06T08:00:00.000Z',
    template_id: 'tpl-9',
    pause_reason: null,
  };

  function renderRunning() {
    renderWithProviders(
      <CampaignsScreen
        rows={[RUNNING]}
        state="data"
        basePath="/w/kolo-shop"
        workspaceId="ws-1"
        permissions={ALL_PERMISSIONS}
      />,
    );
  }

  /*
   * Zrušení je nevratné, `cancelled` je koncový stav. Dialog proto musí říct
   * následek číslem, ne jen slovem: kolik lidí zprávu dostalo a kolika už
   * nepřijde, je jediný údaj, podle kterého se dá rozhodnout.
   */
  it('dialog říká, kolika lidem zpráva už nepřijde', async () => {
    renderRunning();

    await openRowMenu('Běžící rozesílka');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zrušit rozesílku' }));

    expect(screen.getByTestId('cancel-campaign-numbers')).toHaveTextContent('380');
  });

  it('potvrzení zavolá akci a seznam se obnoví', async () => {
    renderRunning();

    await openRowMenu('Běžící rozesílka');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zrušit rozesílku' }));
    await userEvent.click(screen.getByTestId('cancel-campaign-submit'));

    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({ workspaceId: 'ws-1', campaignId: 'camp-9' }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  /* Pozastavení je vratné, takže se spouští rovnou a bez potvrzovacího okna. */
  it('pozastavení běží bez potvrzení a obnoví seznam', async () => {
    renderRunning();

    await openRowMenu('Běžící rozesílka');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pozastavit' }));

    await waitFor(() =>
      expect(pause).toHaveBeenCalledWith({ workspaceId: 'ws-1', campaignId: 'camp-9' }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
