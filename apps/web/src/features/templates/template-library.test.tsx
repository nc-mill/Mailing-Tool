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
vi.mock('./actions', () => ({
  deleteTemplateAction: (input: unknown) => deleteTemplateAction(input),
  restoreTemplateAction: (input: unknown) => restoreTemplateAction(input),
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
  refresh.mockReset();
  replace.mockReset();
  push.mockReset();
  deleteTemplateAction.mockResolvedValue({ status: 'success' });
  restoreTemplateAction.mockResolvedValue({ status: 'success' });
});

describe('knihovna šablon', () => {
  it('nabídne mazání u každé šablony, ne jen u první', () => {
    renderLibrary();
    expect(screen.getAllByRole('button', { name: 'Smazat' })).toHaveLength(2);
  });

  it('bez oprávnění templates:write mazání nenabízí', () => {
    renderLibrary({ canWrite: false });
    expect(screen.queryByRole('button', { name: 'Smazat' })).not.toBeInTheDocument();
  });

  it('okno vyjmenuje následky včetně toho, že kampaně zůstanou beze změny', async () => {
    renderLibrary();
    await userEvent.click(screen.getAllByRole('button', { name: 'Smazat' })[0]!);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Smazat šablonu „Newsletter“\?/)).toBeInTheDocument();
    expect(
      screen.getByText(/Kampaně, které z ní vznikly, zůstanou beze změny/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Historie verzí i záznamy o testovacím odeslání/)).toBeInTheDocument();
  });

  it('okno NETVRDÍ, že akce je nevratná, protože vratná je', async () => {
    renderLibrary();
    await userEvent.click(screen.getAllByRole('button', { name: 'Smazat' })[0]!);

    // Tahle věta patří k nevratným akcím. U měkkého mazání s nabídkou vrácení
    // zpět by to byla lež, kterou uživatel jednou prohlédne a příště přeskočí
    // i okno, kde je pravdivá.
    expect(screen.queryByText(csSettings.confirm.irreversible)).not.toBeInTheDocument();
    expect(screen.getByText(/Hned po smazání nabídneme Vrátit zpět/)).toBeInTheDocument();
  });

  it('potvrzení zavolá akci a nabídne vrácení zpět', async () => {
    renderLibrary();
    await userEvent.click(screen.getAllByRole('button', { name: 'Smazat' })[0]!);
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
    await userEvent.click(screen.getAllByRole('button', { name: 'Smazat' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Smazat šablonu' }));

    // Hláška pod zastíněným dialogem by byla neviditelná, viz komentář v akci.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/Tohle je dodávaná šablona/)).toBeInTheDocument();
    expect(screen.queryByText('Šablona „Newsletter“ je smazaná.')).not.toBeInTheDocument();
  });
});

describe('kategorie a zapojení', () => {
  const formTemplate: TemplateListItem = {
    id: 't3',
    name: 'E-mail z formuláře Patička webu',
    category: 'form',
    usage: { forms: [{ id: 'f1', name: 'Patička webu' }], lists: [] },
  };
  const listTemplate: TemplateListItem = {
    id: 't4',
    name: 'Potvrzení',
    category: 'transactional',
    usage: { forms: [], lists: [{ id: 'l1', name: 'Novinky', role: 'confirmation' }] },
  };

  it('e-mail z formuláře se neplete s volnou šablonou: má odznak i jméno formuláře', () => {
    renderLibrary({ templates: [formTemplate] });

    expect(screen.getByText('E-mail z formuláře')).toBeInTheDocument();
    expect(screen.getByText('Rozesílá formulář „Patička webu“.')).toBeInTheDocument();
  });

  it('zapojenou šablonu nenabízí ke smazání, protože server takové mazání odmítne', () => {
    renderLibrary({ templates: [formTemplate, ...templates] });

    // Dvě volné šablony ano, ta z formuláře ne.
    expect(screen.getAllByRole('button', { name: 'Smazat' })).toHaveLength(2);
    expect(screen.getByText(/Dokud je takhle zapojená, nejde smazat/)).toBeInTheDocument();
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
