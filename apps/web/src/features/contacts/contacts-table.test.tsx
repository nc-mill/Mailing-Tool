import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsTable, type ContactRow } from './contacts-table';
import { renderWithProviders } from './test-utils';

const push = vi.fn();
vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('./actions', () => ({
  bulkDeleteContactsAction: vi.fn().mockResolvedValue({ status: 'success' }),
  exportContactsAction: vi.fn().mockResolvedValue({ status: 'success' }),
  bulkTagContactsAction: vi.fn().mockResolvedValue({ status: 'success' }),
}));

const rows: ContactRow[] = [
  {
    id: 'c-1',
    email: 'jana@firma.cz',
    name: 'Jana Nováková',
    status: 'active',
    processing_restricted: false,
    snooze_until: null,
    anonymized_at: null,
    lists: ['Zákazníci'],
    tags: ['Brno'],
    created_at: '2026-06-12T14:20:00.000Z',
  },
  {
    id: 'c-2',
    email: 'petr@firma.cz',
    name: null,
    status: 'unconfirmed',
    processing_restricted: false,
    snooze_until: null,
    anonymized_at: null,
    lists: [],
    tags: [],
    created_at: '2026-07-01T08:00:00.000Z',
  },
];

function renderTable(props: Partial<React.ComponentProps<typeof ContactsTable>> = {}) {
  return renderWithProviders(
    <ContactsTable
      basePath="/w/eshop/contacts"
      rows={rows}
      pagination={{ next_cursor: 'c2', prev_cursor: null, has_more: true, limit: 50 }}
      total={{ count: 12480, precision: 'estimated' }}
      filters={{}}
      names={{ lists: {}, tags: {}, segments: {} }}
      {...props}
    />,
  );
}

beforeEach(() => {
  push.mockClear();
});

describe('ContactsTable', () => {
  it('ukáže počet s vlnovkou, když je odhadovaný', () => {
    renderTable();
    expect(screen.getByText(/~/)).toBeInTheDocument();
    expect(screen.getByText(/12\s?480/)).toBeInTheDocument();
  });

  it('u přesného počtu vlnovku nepíše', () => {
    renderTable({ total: { count: 2, precision: 'exact' } });
    expect(screen.queryByText(/~/)).toBeNull();
  });

  it('nemá čísla stránek, jen tlačítko na další stránku se stejným filtrem', async () => {
    const user = userEvent.setup();
    renderTable({ filters: { status: 'active' } });
    expect(screen.queryByRole('link', { name: '2' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Další' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/contacts?status=active&cursor=c2');
  });

  it('na poslední stránce další stránku nenabízí', () => {
    renderTable({
      pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50 },
    });
    expect(screen.getByRole('button', { name: 'Další' })).toBeDisabled();
  });

  it('stav nese slovo, ne jen barvu', () => {
    renderTable();
    expect(screen.getByText('Aktivní')).toBeInTheDocument();
    expect(screen.getByText('Nepotvrzený')).toBeInTheDocument();
  });

  it('odkaz na detail je pojmenovaný adresou, ať čtečka ví, kam vede', () => {
    renderTable();
    expect(screen.getByLabelText('Otevřít kontakt jana@firma.cz')).toHaveAttribute(
      'href',
      '/w/eshop/contacts/c-1',
    );
  });

  it('prázdný seznam vysvětlí pojem, nabídne tři cesty a nepíše o filtru', () => {
    renderTable({ rows: [], total: { count: 0, precision: 'exact' } });
    expect(
      screen.getByRole('heading', { name: 'Zatím tu nejsou žádné kontakty' }),
    ).toBeInTheDocument();
    const explanation = screen.getByTestId('empty-explanation');
    expect(explanation.textContent!.match(/[.!?]/g)!.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Naimportovat ze souboru' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Vytvořit přihlašovací formulář' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Přidat jeden kontakt ručně' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Žádný kontakt neodpovídá' })).toBeNull();
  });

  it('prázdný výsledek filtru vypíše filtr slovy a nabídne dvě různá zrušení', async () => {
    const user = userEvent.setup();
    renderTable({
      rows: [],
      total: { count: 0, precision: 'exact' },
      filters: { list_id: 'l-1', status: 'active', q: 'novák' },
      names: { lists: { 'l-1': 'Zákazníci' }, tags: {}, segments: {} },
    });
    const state = screen.getByTestId('empty-state');
    expect(
      within(state).getByRole('heading', { name: 'Žádný kontakt neodpovídá' }),
    ).toBeInTheDocument();
    expect(state).toHaveTextContent('seznam Zákazníci');
    expect(state).toHaveTextContent('stav Aktivní');
    expect(state).toHaveTextContent('hledání');

    await user.click(within(state).getByRole('button', { name: 'Zrušit všechny filtry' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/contacts');

    await user.click(within(state).getByRole('button', { name: 'Zrušit jen hledání' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/contacts?list_id=l-1&status=active');
  });

  it('vybraný řádek ohlásí pruh s počtem a nabídne hromadné akce', async () => {
    const user = userEvent.setup();
    renderTable();
    const grid = screen.getByRole('grid');
    const checkboxes = within(grid).getAllByRole('checkbox', { name: 'Vybrat kontakt' });
    await user.click(checkboxes[0]!);
    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('Vybrán 1 kontakt na této stránce');
    expect(within(bar).getByRole('button', { name: 'Smazat' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Vybrat všech/ })).toBeInTheDocument();
  });

  it('nabídne rozšíření výběru na všechny odpovídající filtru a rozliší to slovy', async () => {
    const user = userEvent.setup();
    renderTable();
    const grid = screen.getByRole('grid');
    await user.click(within(grid).getAllByRole('checkbox', { name: 'Vybrat kontakt' })[0]!);
    const expand = screen.getByRole('button', { name: /Vybrat všech/ });
    await user.click(expand);
    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('Vybráno všech 12 480 kontaktů odpovídajících filtru');
    expect(within(bar).getByRole('button', { name: 'Zrušit výběr' })).toBeInTheDocument();
  });
});
