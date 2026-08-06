import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagsScreen, type TagRow } from './tags-screen';
import { renderWithProviders } from './test-utils';

/**
 * Obrazovka štítků byla prázdná skořápka: „Přidat štítek" i „Sloučit" byla tlačítka
 * bez `onClick`, přejmenovat štítek nešlo vůbec, zaškrtávátka nedělala nic a lišta
 * výběru nad nimi mluvila o KONTAKTECH. Testy proto tvrdí o tom, co se po kliknutí
 * skutečně zavolá, ne jen o tom, že se něco vykreslilo.
 */

const createTag = vi.fn().mockResolvedValue({ status: 'success' });
const renameTag = vi.fn().mockResolvedValue({ status: 'success' });
const mergeTags = vi.fn().mockResolvedValue({ status: 'success', merged: 1 });
const deleteTag = vi.fn().mockResolvedValue({ status: 'success' });
const createExport = vi
  .fn()
  .mockResolvedValue({ status: 'success', id: 'e-1', downloadUrl: '/api/v1/x?token=t' });
const exportStatus = vi
  .fn()
  .mockResolvedValue({ status: 'success', state: 'completed', rowCount: 4 });

const push = vi.fn();
vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('./actions', () => ({
  createTagAction: (...args: unknown[]) => createTag(...args),
  renameTagAction: (...args: unknown[]) => renameTag(...args),
  mergeTagsAction: (...args: unknown[]) => mergeTags(...args),
  deleteTagAction: (...args: unknown[]) => deleteTag(...args),
  createContactExportAction: (...args: unknown[]) => createExport(...args),
  exportStatusAction: (...args: unknown[]) => exportStatus(...args),
}));

const tags: TagRow[] = [
  { id: 't-1', name: 'VIP', contact_count: 4 },
  { id: 't-2', name: 'Brno', contact_count: 2 },
  { id: 't-3', name: 'Prázdný', contact_count: 0 },
];

function renderTags(props: Partial<React.ComponentProps<typeof TagsScreen>> = {}) {
  return renderWithProviders(
    <TagsScreen workspaceId="w-1" basePath="/w/petr" tags={tags} {...props} />,
  );
}

/**
 * jsdom nezná Pointer Capture ani `scrollIntoView`, na kterých Radix stojí.
 * Bez těchhle náhrad se nabídka řádku ani výběr cílového štítku v testu neotevřou
 * a chyba vypadá jako vada komponenty, přestože v prohlížeči funguje.
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  createTag.mockClear();
  renameTag.mockClear();
  mergeTags.mockClear();
  deleteTag.mockClear();
  createExport.mockClear();
  exportStatus.mockClear();
  push.mockClear();
});

/** Nabídka na kartě štítku. Akce z ní se nedají zavolat jinudy, tak se otevírá pořád. */
async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Další akce se štítkem ${name}` }));
}

describe('TagsScreen', () => {
  it('„Přidat štítek" opravdu založí štítek', async () => {
    const user = userEvent.setup();
    renderTags();
    await user.click(screen.getByRole('button', { name: 'Přidat štítek' }));
    await user.type(screen.getByLabelText('Název štítku'), 'Z veletrhu');
    await user.click(screen.getByRole('button', { name: 'Založit štítek' }));
    expect(createTag).toHaveBeenCalledWith({ workspaceId: 'w-1', name: 'Z veletrhu' });
  });

  it('prázdný název tlačítko nezašedí, ale řekne, co chybí', async () => {
    const user = userEvent.setup();
    renderTags();
    await user.click(screen.getByRole('button', { name: 'Přidat štítek' }));
    expect(screen.getByText('Zadejte název štítku.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Založit štítek' }));
    expect(createTag).not.toHaveBeenCalled();
  });

  it('prázdný stav zakládá štítek, ne obnovení stránky', async () => {
    const user = userEvent.setup();
    renderTags({ tags: [] });
    await user.click(screen.getByRole('button', { name: 'Přidat první štítek' }));
    await user.type(screen.getByLabelText('Název štítku'), 'VIP');
    await user.click(screen.getByRole('button', { name: 'Založit štítek' }));
    expect(createTag).toHaveBeenCalledWith({ workspaceId: 'w-1', name: 'VIP' });
  });

  it('štítek jde přejmenovat z nabídky karty', async () => {
    const user = userEvent.setup();
    renderTags();
    await openMenu(user, 'VIP');
    await user.click(await screen.findByRole('menuitem', { name: 'Přejmenovat' }));
    const field = screen.getByLabelText('Nový název');
    expect(field).toHaveValue('VIP');
    await user.clear(field);
    await user.type(field, 'VIP zákazníci');
    await user.click(screen.getByRole('button', { name: 'Uložit název' }));
    expect(renameTag).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      id: 't-1',
      name: 'VIP zákazníci',
    });
  });

  it('název štítku vede na kontakty předfiltrované tím štítkem', () => {
    renderTags();
    expect(screen.getByRole('link', { name: 'Zobrazit kontakty se štítkem VIP' })).toHaveAttribute(
      'href',
      '/w/petr/contacts?tag_id=t-1',
    );
  });

  it('na kartě je počet kontaktů celou větou, ne holým číslem', () => {
    renderTags();
    expect(screen.getByText('4 kontakty')).toBeInTheDocument();
    expect(screen.getByText('Žádný kontakt')).toBeInTheDocument();
  });

  it('obrazovka nemá výběr ani stránkování, pro které tu není práce', () => {
    renderTags();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Další' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nastavení sloupců' })).toBeNull();
  });

  it('o nedočtené další stránce řekne, místo aby mlčela', () => {
    renderTags({ hasMore: true });
    expect(screen.getByText(/prvních dvě stě štítků/)).toBeInTheDocument();
  });

  it('sloučení vybere cíl, potvrdí následky a teprve pak volá server', async () => {
    const user = userEvent.setup();
    renderTags();
    await openMenu(user, 'VIP');
    await user.click(await screen.findByRole('menuitem', { name: 'Sloučit s jiným štítkem' }));

    // Bez vybraného cíle se dál nejde a tlačítko to řekne slovy, ne zašedlostí.
    expect(screen.getByText('Vyberte štítek, do kterého se má sloučit.')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Do kterého štítku' }));
    await user.click(await screen.findByRole('option', { name: 'Brno' }));
    await user.click(screen.getByRole('button', { name: 'Pokračovat' }));

    expect(screen.getByText(/4 kontakty dostanou štítek Brno/)).toBeInTheDocument();
    expect(screen.getByText(/Štítek VIP zanikne/)).toBeInTheDocument();
    // Nevratná akce: bez zaškrtnutí následku se potvrdit nedá.
    await user.click(screen.getByRole('checkbox', { name: /nejde vrátit zpět/ }));
    await user.click(screen.getByRole('button', { name: 'Sloučit štítky' }));

    expect(mergeTags).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      sourceIds: ['t-1'],
      targetId: 't-2',
    });
  });

  it('do sebe sama sloučit nejde, nabídka cíle sebe nenabízí', async () => {
    const user = userEvent.setup();
    renderTags();
    await openMenu(user, 'VIP');
    await user.click(await screen.findByRole('menuitem', { name: 'Sloučit s jiným štítkem' }));
    await user.click(screen.getByRole('combobox', { name: 'Do kterého štítku' }));
    expect(await screen.findByRole('option', { name: 'Brno' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'VIP' })).toBeNull();
  });

  /*
   * Mazání je NEVRATNÉ a dialog to říká.
   *
   * Dřív se odbylo oznámením s tlačítkem „Vrátit zpět", které jen obnovilo stránku:
   * `deleteTag` maže řádek natvrdo i s přiřazeními kontaktů a endpoint na obnovení
   * v API není. Slíbit vrácení a nesplnit ho je horší než se zeptat.
   */
  it('mazání se ptá a vyjmenuje, koho se to dotkne', async () => {
    const user = userEvent.setup();
    renderTags();
    await openMenu(user, 'VIP');
    await user.click(await screen.findByRole('menuitem', { name: 'Smazat štítek' }));

    expect(screen.getByText(/4 kontakty přijdou o tuhle nálepku/)).toBeInTheDocument();
    expect(screen.getByText(/Vrátit to nejde/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vrátit zpět' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Smazat štítek' }));
    expect(deleteTag).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 't-1' });
  });

  it('export nabídne stažení, až je soubor hotový', async () => {
    const user = userEvent.setup();
    renderTags();
    await openMenu(user, 'VIP');
    await user.click(await screen.findByRole('menuitem', { name: 'Exportovat kontakty' }));
    // Publikum je podmínka „má tenhle štítek", ne `tag_id`; tvar hlídá export-audience.test.ts.
    expect(createExport).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w-1', locale: 'cs' }),
    );
    expect(JSON.stringify(createExport.mock.calls[0])).toContain('has_any');
    // Stahuje se tlačítkem přes `fetch`, ne odkazem: endpoint chce hlavičku
    // `X-Workspace-Id` a `<a href>` ji poslat neumí, takže odkaz padal na 404.
    expect(
      await screen.findByRole('button', { name: 'Stáhnout CSV' }, { timeout: 5000 }),
    ).toBeVisible();
    // Skutečný počet řádků ze serveru, ne obecná věta „může jich být míň".
    expect(screen.getByText(/jsou v něm 4 kontakty/)).toBeVisible();
  }, 10_000);

  it('stažení posílá projekt v hlavičce, jinak server vrátí 404', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(['e-mail\n'])) });
    vi.stubGlobal('fetch', fetchSpy);
    URL.createObjectURL = vi.fn().mockReturnValue('blob:x');
    URL.revokeObjectURL = vi.fn();

    renderTags();
    await openMenu(user, 'VIP');
    await user.click(await screen.findByRole('menuitem', { name: 'Exportovat kontakty' }));
    await user.click(
      await screen.findByRole('button', { name: 'Stáhnout CSV' }, { timeout: 5000 }),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/x?token=t',
      expect.objectContaining({ headers: { 'X-Workspace-Id': 'w-1' } }),
    );
    vi.unstubAllGlobals();
  }, 10_000);

  it('u štítku bez kontaktů se export nenabízí, není co exportovat', async () => {
    const user = userEvent.setup();
    renderTags();
    await openMenu(user, 'Prázdný');
    expect(await screen.findByRole('menuitem', { name: 'Přejmenovat' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Exportovat kontakty' })).toBeNull();
  });

  it('nad jediným štítkem projektu se slučování nenabízí', async () => {
    const user = userEvent.setup();
    renderTags({ tags: [tags[0]!] });
    await openMenu(user, 'VIP');
    expect(await screen.findByRole('menuitem', { name: 'Přejmenovat' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Sloučit s jiným štítkem' })).toBeNull();
  });

  /*
   * KDYBY TENHLE TEST SPADL: kontakty se štítkem jsou zase dostupné jen tím, že
   * uživatel uhodne, že název v řádku je odkaz. Kdo si zvykne otevírat „…",
   * nemá důvod to tušit.
   */
  it('nabídka vede na kontakty se štítkem, ne jen název v řádku', async () => {
    const user = userEvent.setup();
    renderTags();
    await openMenu(user, 'VIP');
    await user.click(await screen.findByRole('menuitem', { name: 'Zobrazit kontakty' }));

    expect(push).toHaveBeenCalledWith('/w/petr/contacts?tag_id=t-1');
  });

  /*
   * KDYBY TENHLE TEST SPADL: spouštěč nabídky se zase liší od kontaktů. Do
   * 6. 8. 2026 tu byl vlastní `button` o straně 44 px, takže táž nabídka měla
   * na každé obrazovce jiný tvar. Viditelný čtverec je 34 px
   * (`--size-control-xs` přes `size="row"`), klikací plocha 44 px překryvem.
   */
  it('spouštěč má viditelných 34 px a klikací plochu 44 px, stejně jako kontakty', () => {
    renderTags();
    const trigger = screen.getByRole('button', { name: 'Další akce se štítkem VIP' });
    expect(trigger).toHaveClass('size-[var(--size-control-xs)]');
    expect(trigger).toHaveClass('after:size-[var(--size-target-min)]');
  });
});
