import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignList, type CampaignRow } from './campaign-list';
import { StatusBadge } from './status-badge';
import { renderWithProviders } from './test-utils';

/**
 * `push` je jedna stálá funkce, ne nová při každém zavolání `useRouter`.
 * S novou by se nedalo ověřit, kam řádek vede, protože test by držel jinou
 * instanci než komponenta.
 */
const push = vi.hoisted(() => vi.fn());

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

beforeEach(() => {
  push.mockClear();
  window.localStorage.clear();
});

const rows: CampaignRow[] = [
  {
    id: 'k1',
    name: 'Letní výprodej',
    status: 'sending',
    audience_size: 1129,
    counters: { total: 1129, sent: 428, delivered: 421, bounced: 6 },
    updated_at: '2026-08-01T12:38:00.000Z',
    template_id: 't1',
    pause_reason: null,
  },
];

/** Všechno smí každý. Omezená práva mají vlastní blok níž. */
const ALL_PERMISSIONS = {
  editContent: true,
  write: true,
  send: true,
  control: true,
  remove: true,
};

describe('seznam kampaní', () => {
  it('prázdný stav vysvětluje a nabízí akci', () => {
    renderWithProviders(<CampaignList rows={[]} state="empty" onCreate={vi.fn()} />);
    expect(screen.getByText('Zatím žádné kampaně')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vytvořit kampaň' })).toBeInTheDocument();
  });

  it('stav načítání ukazuje kostru pěti řádků, ne kolečko', () => {
    renderWithProviders(<CampaignList rows={[]} state="loading" />);
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(5);
  });

  it('chybový stav nabízí Zkusit znovu', () => {
    renderWithProviders(<CampaignList rows={[]} state="error" onRetry={vi.fn()} />);
    expect(screen.getByText('Kampaně se nepodařilo načíst.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
  });

  it('tabulka ukazuje název, stav i počet příjemců', () => {
    renderWithProviders(<CampaignList rows={rows} state="data" />);
    expect(screen.getByText('Letní výprodej')).toBeInTheDocument();
    expect(screen.getByText('Odesílá se')).toBeInTheDocument();
    expect(screen.getByText('1 129 příjemců')).toBeInTheDocument();
  });
});

/**
 * KDYBY TENHLE BLOK SPADL: report kampaně zase nemá ze seznamu žádnou cestu.
 * Přesně to byl stav, který zadavatel nahlásil („netuším, kde se k té stránce
 * vůbec dostat"). Odeslaná kampaň končila na obrazovce průběhu.
 */
describe('řádek seznamu vede podle stavu', () => {
  function row(status: string): CampaignRow {
    return { ...rows[0]!, status };
  }

  async function activate(status: string) {
    renderWithProviders(
      <CampaignList rows={[row(status)]} state="data" basePath="/w/demo/campaigns" />,
    );
    await userEvent.click(screen.getByText('Letní výprodej'));
    return push.mock.calls[0]?.[0];
  }

  it.each([['sent'], ['partially_sent'], ['cancelled'], ['failed']])(
    'dojetá kampaň ve stavu %s otevře report',
    async (status) => {
      expect(await activate(status)).toBe('/w/demo/campaigns/k1/report');
    },
  );

  it('odesílající se kampaň otevře průběh', async () => {
    expect(await activate('sending')).toBe('/w/demo/campaigns/k1/progress');
  });

  it('rozepsaná kampaň otevře nastavení', async () => {
    expect(await activate('draft')).toBe('/w/demo/campaigns/k1');
  });

  it('naplánovaná kampaň otevře nastavení, ne průběh', async () => {
    expect(await activate('scheduled')).toBe('/w/demo/campaigns/k1');
  });
});

/**
 * KDYBY TENHLE BLOK SPADL: z řádku kampaně zase nejde udělat nic než smazat
 * rozepsanou. Přesně tak vypadal seznam do 6. 8. 2026: jediná ikona koše
 * a žádná cesta k duplikaci, zrušení plánu ani pozastavení rozesílky.
 */
describe('nabídka „…" v řádku kampaně', () => {
  function render(row: Partial<CampaignRow>, permissions = ALL_PERMISSIONS) {
    const onAction = vi.fn();
    renderWithProviders(
      <CampaignList
        rows={[{ ...rows[0]!, ...row }]}
        state="data"
        basePath="/w/demo/campaigns"
        rowActions={{ permissions, onAction }}
      />,
    );
    return onAction;
  }

  function openMenu() {
    return userEvent.click(screen.getByRole('button', { name: /Další akce s kampaní/ }));
  }

  function itemNames() {
    return screen.getAllByRole('menuitem').map((item) => item.textContent);
  }

  it('rozepsaná kampaň nabízí obsah, přejmenování, kopii a smazání', async () => {
    render({ status: 'draft' });
    await openMenu();
    expect(itemNames()).toEqual(['Upravit obsah', 'Přejmenovat', 'Duplikovat', 'Smazat']);
  });

  it('naplánovaná kampaň nabízí zrušení plánu, ale ani obsah, ani smazání', async () => {
    render({ status: 'scheduled' });
    await openMenu();
    expect(itemNames()).toEqual(['Přejmenovat', 'Duplikovat', 'Zrušit plán']);
  });

  /*
   * Zrušení rozesílky u naplánované kampaně API pustí, nabídka ho schválně
   * nenabízí: správná odpověď je zrušit plán, po kterém je z kampaně zase
   * koncept. Dvě akce vedle sebe, ze kterých je jedna nevratná, jsou past.
   */
  it('naplánovaná kampaň nenabízí zrušení rozesílky', async () => {
    render({ status: 'scheduled' });
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Zrušit rozesílku' })).toBeNull();
  });

  it('běžící kampaň nabízí pozastavení a zrušení rozesílky, ne úpravu obsahu', async () => {
    render({ status: 'sending' });
    await openMenu();
    expect(itemNames()).toEqual(['Duplikovat', 'Pozastavit', 'Zrušit rozesílku']);
  });

  it('pozastavená kampaň nabízí pokračování', async () => {
    render({ status: 'paused' });
    await openMenu();
    expect(itemNames()).toEqual(['Duplikovat', 'Pokračovat', 'Zrušit rozesílku']);
  });

  /*
   * Kampaň zastavenou poskytovatelem server znovu nepustí (422
   * `provider_sending_paused`), takže se položka nenabízí vůbec. Nabídnout akci,
   * která vždycky skončí chybou, je horší než ji nenabídnout.
   */
  it('kampaň zastavená poskytovatelem nenabízí pokračování', async () => {
    render({ status: 'paused', pause_reason: { code: 'provider_blocked' } });
    await openMenu();
    expect(itemNames()).toEqual(['Duplikovat', 'Zrušit rozesílku']);
  });

  it('odeslaná kampaň nabízí jedinou akci, a to kopii', async () => {
    render({ status: 'sent' });
    await openMenu();
    expect(itemNames()).toEqual(['Duplikovat']);
  });

  /*
   * Stavy, které se v běžném provozu skoro nepotkají, a proto se na ně zapomíná.
   * `queueing` trvá vteřiny, `schedule_missed` vznikne jen po výpadku a
   * `partially_sent` po chybě poskytovatele uprostřed rozesílky. Zrovna v nich
   * ale rozhoduje o nevratných akcích, takže se tabulka stavů musí ověřit i tady.
   */
  it('kampaň ve frontě se dá pozastavit a zrušit, ne přejmenovat', async () => {
    render({ status: 'queueing' });
    await openMenu();
    expect(itemNames()).toEqual(['Duplikovat', 'Pozastavit', 'Zrušit rozesílku']);
  });

  it('propásnutý plán se chová jako koncept, ale zrušení rozesílky nenabízí', async () => {
    render({ status: 'schedule_missed' });
    await openMenu();
    expect(itemNames()).toEqual(['Upravit obsah', 'Přejmenovat', 'Duplikovat', 'Smazat']);
  });

  it('částečně odeslaná kampaň nabízí jedinou akci, a to kopii', async () => {
    render({ status: 'partially_sent' });
    await openMenu();
    expect(itemNames()).toEqual(['Duplikovat']);
  });

  it('kampaň bez pracovní kopie úpravu obsahu nenabízí', async () => {
    render({ status: 'draft', template_id: null });
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Upravit obsah' })).toBeNull();
  });

  /*
   * Prázdná nabídka je horší než žádná: slibuje akce, které nemá. Odeslaná
   * kampaň u člověka bez práva zapisovat je přesně ten případ.
   */
  it('bez jediné použitelné akce se nekreslí ani spouštěč', () => {
    render({ status: 'sent' }, { ...ALL_PERMISSIONS, write: false });
    expect(screen.queryByRole('button', { name: /Další akce s kampaní/ })).toBeNull();
  });

  it('bez práva mazat nenabízí smazání ani u rozepsané kampaně', async () => {
    render({ status: 'draft' }, { ...ALL_PERMISSIONS, remove: false });
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Smazat' })).toBeNull();
  });

  it('volba položky hlásí akci obalu', async () => {
    const onAction = render({ status: 'draft' });
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplikovat' }));
    expect(onAction).toHaveBeenCalledWith('duplicate', expect.objectContaining({ id: 'k1' }));
  });

  it('úprava obsahu vede do editoru, ne přes obal', async () => {
    const onAction = render({ status: 'draft' });
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Upravit obsah' }));
    expect(push).toHaveBeenCalledWith('/w/demo/campaigns/k1/content');
    expect(onAction).not.toHaveBeenCalled();
  });

  /*
   * KDYBY TENHLE TEST SPADL: obal řádku zase polyká ovládací prvky uvnitř buňky.
   * Je to vzorec z kapitoly 7 `DESIGN-INTEGRACE.md`, na který jsme 6. 8. narazili
   * čtyřikrát za jedno dopoledne. Ověřeno vypnutím opravy: s výčtem `ROW_CONTROLS`
   * zúženým zpátky na `INPUT, TEXTAREA` obě tvrzení padnou, protože Enter i klik
   * odnavigují na kampaň místo otevření nabídky.
   */
  it('otevření nabídky neaktivuje řádek, myší ani klávesnicí', async () => {
    render({ status: 'draft' });
    await openMenu();
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
    expect(push).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    screen.getByRole('button', { name: /Další akce s kampaní/ }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('štítek stavu', () => {
  it.each([
    ['draft', 'Rozepsaná'],
    ['sending', 'Odesílá se'],
    ['partially_sent', 'Odeslaná částečně'],
    ['schedule_missed', 'Plán propásnut'],
  ])('stav %s je %s', (status, label) => {
    renderWithProviders(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('neznámý stav se zobrazí neutrálně, komponenta nespadne', () => {
    renderWithProviders(<StatusBadge status="ab_testing" />);
    expect(screen.getByText('ab_testing')).toBeInTheDocument();
  });

  it('běžící stav má aria-live, aby ho přečetla čtečka', () => {
    renderWithProviders(<StatusBadge status="sending" />);
    expect(screen.getByText('Odesílá se').closest('[aria-live]')).not.toBeNull();
  });
});
