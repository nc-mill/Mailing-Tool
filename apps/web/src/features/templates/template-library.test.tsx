// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import csEditor from '../../../../../packages/i18n/messages/cs/editor.json';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { TemplateLibrary, type TemplateListItem } from './template-library';

// Serverové akce sahají na `server-only` a cookies, které v jsdom nejsou.
const deleteTemplateAction = vi.fn();
const restoreTemplateAction = vi.fn();
const duplicateTemplateAction = vi.fn();
vi.mock('./actions', () => ({
  deleteTemplateAction: (input: unknown) => deleteTemplateAction(input),
  restoreTemplateAction: (input: unknown) => restoreTemplateAction(input),
  duplicateTemplateAction: (input: unknown) => duplicateTemplateAction(input),
}));

const refresh = vi.fn();
const replace = vi.fn();
const push = vi.fn();
vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ refresh, replace, push }),
}));

const messages = { editor: csEditor, settings: csSettings };

const free = (id: string, name: string): TemplateListItem => ({
  id,
  name,
  category: 'campaign',
  usage: { forms: [], lists: [] },
  updated_at: '2026-08-04T09:30:00.000Z',
});

const templates = [free('t1', 'Newsletter'), free('t2', 'Pozvánka')];

function renderLibrary(props: Partial<Parameters<typeof TemplateLibrary>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <TemplateLibrary
        workspaceSlug="eshop"
        workspaceId="ws1"
        templates={templates}
        canWrite
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  deleteTemplateAction.mockReset();
  restoreTemplateAction.mockReset();
  duplicateTemplateAction.mockReset();
  refresh.mockReset();
  replace.mockReset();
  push.mockReset();
  deleteTemplateAction.mockResolvedValue({ status: 'success' });
  restoreTemplateAction.mockResolvedValue({ status: 'success' });
  duplicateTemplateAction.mockResolvedValue({ status: 'success', id: 't1-copy' });
});

/**
 * Mazání i kopie bydlí od 6. 8. 2026 v řádkové nabídce „…", ne v samostatné
 * ikoně koše. Zavřená nabídka svoje položky vůbec nevykresluje, takže ji test
 * musí nejdřív otevřít.
 */
async function openRowMenu(index = 0) {
  const triggers = screen.getAllByRole('button', { name: /Další akce se šablonou/ });
  const trigger = triggers[index];
  if (trigger === undefined) throw new Error(`Řádek ${index} nemá nabídku akcí.`);
  await userEvent.click(trigger);
}

/** Položka nabídky se jménem akce. Zkratka do všech testů mazání níž. */
async function chooseRowAction(name: string, index = 0) {
  await openRowMenu(index);
  await userEvent.click(await screen.findByRole('menuitem', { name }));
}

function itemNames() {
  return screen.getAllByRole('menuitem').map((item) => item.textContent);
}

describe('knihovna šablon', () => {
  it('nabídne mazání u každé šablony, ne jen u první', async () => {
    renderLibrary();
    expect(screen.getAllByRole('button', { name: /Další akce se šablonou/ })).toHaveLength(2);

    await openRowMenu(1);
    expect(screen.getByRole('menuitem', { name: 'Smazat' })).toBeInTheDocument();
  });

  it('bez oprávnění templates:write se nekreslí ani spouštěč nabídky', () => {
    renderLibrary({ canWrite: false });
    expect(
      screen.queryByRole('button', { name: /Další akce se šablonou/ }),
    ).not.toBeInTheDocument();
  });

  it('okno vyjmenuje následky včetně toho, že kampaně zůstanou beze změny', async () => {
    renderLibrary();
    await chooseRowAction('Smazat');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Smazat šablonu „Newsletter“\?/)).toBeInTheDocument();
    expect(
      screen.getByText(/Kampaně, které z ní vznikly, zůstanou beze změny/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Historie verzí i záznamy o testovacím odeslání/)).toBeInTheDocument();
  });

  it('okno NETVRDÍ, že akce je nevratná, protože vratná je', async () => {
    renderLibrary();
    await chooseRowAction('Smazat');

    // Tahle věta patří k nevratným akcím. U měkkého mazání s nabídkou vrácení
    // zpět by to byla lež, kterou uživatel jednou prohlédne a příště přeskočí
    // i okno, kde je pravdivá.
    expect(screen.queryByText(csSettings.confirm.irreversible)).not.toBeInTheDocument();
    expect(screen.getByText(/Hned po smazání nabídneme Vrátit zpět/)).toBeInTheDocument();
  });

  it('potvrzení zavolá akci a nabídne vrácení zpět', async () => {
    renderLibrary();
    await chooseRowAction('Smazat');
    await userEvent.click(screen.getByRole('button', { name: 'Smazat šablonu' }));

    expect(deleteTemplateAction).toHaveBeenCalledWith({ workspaceId: 'ws1', id: 't1' });
    expect(screen.getByText('Šablona „Newsletter“ je smazaná.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vrátit zpět' })).toBeInTheDocument();
    // Smazaná položka mizí ze seznamu hned, ne až po dojití obnovy ze serveru.
    expect(screen.queryByRole('link', { name: 'Newsletter' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pozvánka' })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('Vrátit zpět zavolá obnovu a řekne, že je šablona zpátky', async () => {
    renderLibrary({ initialDeleted: { id: 't1', name: 'Newsletter' } });
    await userEvent.click(screen.getByRole('button', { name: 'Vrátit zpět' }));

    expect(restoreTemplateAction).toHaveBeenCalledWith({ workspaceId: 'ws1', id: 't1' });
    expect(screen.getByText('Šablona „Newsletter“ je zpátky v knihovně.')).toBeInTheDocument();
    // Adresa se uklidí, jinak by po obnovení stránky nabízela vrácení znovu.
    expect(replace).toHaveBeenCalledWith('/w/eshop/templates');
  });

  it('obsazené jméno při vrácení vysvětlí, co s tím', async () => {
    restoreTemplateAction.mockResolvedValue({ status: 'error', code: 'template_name_conflict' });
    renderLibrary({ initialDeleted: { id: 't1', name: 'Newsletter' } });
    await userEvent.click(screen.getByRole('button', { name: 'Vrátit zpět' }));

    expect(screen.getByText(/Přejmenujte tu novou a zkuste to znovu/)).toBeInTheDocument();
  });

  it('neúspěšné smazání zavře okno a řekne důvod na obrazovce', async () => {
    deleteTemplateAction.mockResolvedValue({ status: 'error', code: 'template_starter_immutable' });
    renderLibrary();
    await chooseRowAction('Smazat');
    await userEvent.click(screen.getByRole('button', { name: 'Smazat šablonu' }));

    // Hláška pod zastíněným dialogem by byla neviditelná, viz komentář v akci.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/Tohle je dodávaná šablona/)).toBeInTheDocument();
    expect(screen.queryByText('Šablona „Newsletter“ je smazaná.')).not.toBeInTheDocument();
  });
});

/**
 * KDYBY TENHLE BLOK SPADL: z řádku knihovny zase nejde nic než smazat volnou
 * šablonu. Přesně tak výpis vypadal do 6. 8. 2026, přestože
 * `POST /templates/{id}/duplicate` v jádru existuje od začátku a rozhraní ho
 * nevolalo odnikud.
 */
describe('nabídka „…" v řádku knihovny', () => {
  it('„Upravit" otevře šablonu', async () => {
    renderLibrary();
    await chooseRowAction('Upravit');

    expect(push).toHaveBeenCalledWith('/w/eshop/templates/t1');
  });

  it('„Duplikovat" udělá kopii a odejde rovnou do ní', async () => {
    renderLibrary();
    await chooseRowAction('Duplikovat');

    expect(duplicateTemplateAction).toHaveBeenCalledWith({ workspaceId: 'ws1', id: 't1' });
    expect(push).toHaveBeenCalledWith('/w/eshop/templates/t1-copy');
  });

  /*
   * Selhání kopie se hlásí týmž pruhem nad výpisem jako odmítnuté mazání:
   * v řádku pro celou větu místo není a mlčení vypadá jako nefunkční položka.
   */
  it('neúspěšná kopie řekne důvod na obrazovce a nikam neodchází', async () => {
    duplicateTemplateAction.mockResolvedValue({ status: 'error', code: 'template_name_conflict' });
    renderLibrary();
    await chooseRowAction('Duplikovat');

    expect(await screen.findByTestId('template-delete-failed')).toHaveTextContent(
      'template_name_conflict',
    );
    expect(push).not.toHaveBeenCalled();
  });
});

describe('kategorie a zapojení', () => {
  const formTemplate: TemplateListItem = {
    id: 't3',
    name: 'E-mail z formuláře Patička webu',
    category: 'form',
    usage: { forms: [{ id: 'f1', name: 'Patička webu' }], lists: [] },
    updated_at: '2026-08-04T09:30:00.000Z',
  };
  const listTemplate: TemplateListItem = {
    id: 't4',
    name: 'Potvrzení',
    category: 'transactional',
    usage: { forms: [], lists: [{ id: 'l1', name: 'Novinky', role: 'confirmation' }] },
    updated_at: '2026-08-04T09:30:00.000Z',
  };

  it('e-mail z formuláře se neplete s volnou šablonou: má odznak i jméno formuláře', () => {
    renderLibrary({ templates: [formTemplate] });

    expect(screen.getByText('E-mail z formuláře')).toBeInTheDocument();
    expect(screen.getByText('Rozesílá formulář „Patička webu“.')).toBeInTheDocument();
  });

  /*
   * KDYBY TENHLE TEST SPADL: v nabídce živě rozesílané šablony se zase objeví
   * mazání, které server odmítne (409 `template_in_use`). Úprava a kopie tam
   * zůstat MUSÍ: kopie je jediná cesta, jak z rozesílané předlohy vyjít a nesáhnout
   * na poštu, která odchází teď.
   */
  it('zapojená šablona nabízí úpravu a kopii, ne mazání', async () => {
    renderLibrary({ templates: [formTemplate, ...templates] });

    await openRowMenu(0);
    expect(itemNames()).toEqual(['Upravit', 'Duplikovat']);
    expect(screen.getByText(/Dokud je takhle zapojená, nejde smazat/)).toBeInTheDocument();
  });

  it('volná šablona nabízí úpravu, kopii i mazání', async () => {
    renderLibrary({ templates: [formTemplate, ...templates] });

    await openRowMenu(1);
    expect(itemNames()).toEqual(['Upravit', 'Duplikovat', 'Smazat']);
  });

  it('šablona seznamu řekne, co v tom seznamu dělá', () => {
    renderLibrary({ templates: [listTemplate] });

    expect(screen.getByText('Transakční e-mail')).toBeInTheDocument();
    expect(screen.getByText('Potvrzuje přihlášení do seznamu „Novinky“.')).toBeInTheDocument();
  });

  it('volná šablona ke kampani žádný odznak nemá, aby odznak něco znamenal', () => {
    renderLibrary();

    expect(screen.queryByText('E-mail z formuláře')).not.toBeInTheDocument();
    expect(screen.queryByText('Transakční e-mail')).not.toBeInTheDocument();
  });

  it('prázdno pod filtrem je jiný stav než prázdná knihovna: připomene filtr a nabídne zrušení', async () => {
    renderLibrary({ templates: [], category: 'form' });

    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'filtered');
    expect(screen.getByText(/Kategorie: E-maily z formulářů/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Zobrazit všechny šablony' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/templates');
  });

  it('bez filtru se stav S2 nenabízí, protože není co rušit', () => {
    renderLibrary({ templates: [] });
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });
});

/**
 * VEŘEJNÁ STRÁNKA V KNIHOVNĚ.
 *
 * Do 7. 8. 2026 se šablony druhu `page` do knihovny vůbec nevypisovaly. Bylo to
 * míněné jako ochrana, aby se stránka nedala nabídnout jako e-mail, jenže to
 * znamenalo, že nově založená stránka ZMIZELA: nešla najít, otevřít ani smazat.
 * Nahlásil zadavatel snímkem knihovny, kde stránky nebyly ani vidět, ani podle
 * čeho filtrovat.
 *
 * Odznak je proto povinný. Bez něj stránka v seznamu splyne s transakčním
 * e-mailem, což je přesně ta záměna, kterou celý druh `page` má vyloučit.
 */
describe('knihovna šablon: veřejné stránky', () => {
  const page = (id: string, name: string): TemplateListItem => ({
    id,
    name,
    category: 'page',
    usage: { forms: [], lists: [] },
    updated_at: '2026-08-07T09:30:00.000Z',
  });

  it('vypíše veřejnou stránku, ne že ji schová', () => {
    renderLibrary({ templates: [page('p1', 'Děkujeme za přihlášení')] });
    expect(screen.getByText('Děkujeme za přihlášení')).toBeInTheDocument();
  });

  it('označí ji vlastním odznakem, aby nesplynula s e-mailem', () => {
    renderLibrary({ templates: [page('p1', 'Děkujeme za přihlášení')] });
    expect(screen.getByText('VEŘEJNÁ STRÁNKA')).toBeInTheDocument();
    expect(screen.queryByText('TRANSAKČNÍ E-MAIL')).toBeNull();
  });

  it('kampaňová šablona odznak dál nemá, zúžení se jí netýká', () => {
    renderLibrary({ templates: [free('t1', 'Newsletter')] });
    expect(screen.queryByText('VEŘEJNÁ STRÁNKA')).toBeNull();
  });
});
