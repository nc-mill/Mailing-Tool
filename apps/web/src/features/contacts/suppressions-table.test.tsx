import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SuppressionsTable } from './suppressions-table';
import type { SuppressionRow } from './suppression-affordance';
import { renderWithProviders } from './test-utils';

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const addSuppression = vi.fn().mockResolvedValue({ status: 'success' });
const removeSuppression = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./actions', () => ({
  removeSuppressionAction: (...args: unknown[]) => removeSuppression(...args),
  addSuppressionAction: (...args: unknown[]) => addSuppression(...args),
}));

const rows: SuppressionRow[] = [
  {
    id: '1',
    masked_email: 'a***@seznam.cz',
    reason: 'complaint',
    created_at: '2026-06-12T10:00:00.000Z',
  },
  {
    id: '2',
    masked_email: 'b***@firma.cz',
    reason: 'hard_bounce',
    created_at: '2026-07-19T10:00:00.000Z',
  },
  {
    id: '3',
    masked_email: 'c***@gmail.com',
    reason: 'soft_bounce_threshold',
    created_at: '2026-07-20T10:00:00.000Z',
  },
  {
    id: '4',
    masked_email: 'd***@firma.cz',
    reason: 'manual',
    created_at: '2026-07-25T10:00:00.000Z',
  },
  {
    id: '5',
    masked_email: 'e***@firma.cz',
    reason: 'global_unsubscribe',
    created_at: '2026-07-28T10:00:00.000Z',
  },
];

function renderTable(props: Partial<React.ComponentProps<typeof SuppressionsTable>> = {}) {
  return renderWithProviders(
    <SuppressionsTable
      basePath="/w/eshop/suppressions"
      workspaceId="w-1"
      rows={rows}
      role="owner"
      now={new Date('2026-07-31T12:00:00.000Z')}
      pagination={{ next_cursor: null, prev_cursor: null, has_more: false, limit: 50 }}
      filters={{}}
      {...props}
    />,
  );
}

/** Celý řádek mřížky, ne jen buňka s adresou: tlačítko Odebrat je ve sloupci akcí. */
function removalRow(id: string): HTMLElement {
  const row = screen.getByTestId(`suppression-${id}`).closest('[role="row"]');
  if (row === null) throw new Error(`řádek pro blokaci ${id} se nenašel`);
  return row as HTMLElement;
}

/** Zaškrtávátko řádku podle pořadí v mřížce. Popisek je u P05 jeden pro všechny řádky. */
async function selectRows(user: ReturnType<typeof userEvent.setup>, indexes: number[]) {
  const grid = screen.getByRole('grid');
  const boxes = within(grid).getAllByRole('checkbox', { name: 'Vybrat adresu' });
  for (const index of indexes) await user.click(boxes[index]!);
}

beforeEach(() => {
  removeSuppression.mockClear();
  addSuppression.mockClear();
});

describe('SuppressionsTable', () => {
  it('u stížnosti ukáže vysvětlení místo tlačítka', () => {
    renderTable();
    const row = screen.getByTestId('suppression-1');
    expect(within(row).queryByRole('button', { name: 'Odebrat' })).toBeNull();
    expect(
      within(row).getByText('Adresu, která nahlásila spam, nelze odblokovat.'),
    ).toBeInTheDocument();
  });

  it('u čerstvého trvalého nedoručení ukáže, kdy to půjde', () => {
    renderTable();
    expect(screen.getByText(/za 18 dní/)).toBeInTheDocument();
  });

  it('u odebratelných důvodů nabídne tlačítko', () => {
    renderTable();
    expect(screen.getAllByRole('button', { name: 'Odebrat' }).length).toBeGreaterThan(0);
  });

  it('u odhlášení vysvětlí, že se odebere samo', () => {
    renderTable();
    expect(
      within(screen.getByTestId('suppression-5')).getByText(/Odebere se samo/),
    ).toBeInTheDocument();
  });

  it('nikde nemá zašedlé tlačítko, kromě stránkování na konci seznamu', () => {
    renderTable();
    for (const button of screen.getAllByRole('button')) {
      if (button.textContent === 'Další' || button.textContent === 'Předchozí') continue;
      expect(button).not.toBeDisabled();
    }
  });

  /**
   * Tlačítko „Zobrazit celou adresu" volalo `POST /suppressions/{id}/reveal`, tedy cestu,
   * jaká v API nikdy nebyla. Odpověď výpisu nese jen `masked_email`, takže odkrýt nebylo
   * z čeho a kliknutí spolehlivě končilo na 404.
   */
  it('adresy zůstávají maskované a nic nenabízí jejich odkrytí', () => {
    renderTable();
    expect(screen.getByText('a***@seznam.cz')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zobrazit celou adresu' })).toBeNull();
  });

  /**
   * Regrese na 422: obrazovka posílala `note: ''`, jenže tělo `DELETE /suppressions/{id}`
   * má `z.string().min(1)`. Odblokování proto neprošlo NIKDY. Test kontroluje to,
   * co odesílá opravdu obrazovka, tedy včetně poznámky napsané v dialogu.
   */
  it('odebrání pošle poznámku, kterou uživatel napsal v dialogu', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(within(removalRow('4')).getByRole('button', { name: 'Odebrat' }));
    await user.type(screen.getByLabelText('Poznámka, proč adresu odebíráte'), 'omyl při importu');
    await user.click(screen.getByRole('button', { name: 'Odebrat adresu' }));

    expect(removeSuppression).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      id: '4',
      note: 'omyl při importu',
    });
  });

  it('bez poznámky odebrání neodešle a řekne proč', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(within(removalRow('4')).getByRole('button', { name: 'Odebrat' }));
    await user.click(screen.getByRole('button', { name: 'Odebrat adresu' }));

    expect(removeSuppression).not.toHaveBeenCalled();
    expect(
      screen.getByText('Bez poznámky odebrat nejde. Napište, proč adresu odblokováváte.'),
    ).toBeInTheDocument();
  });

  it('hromadné odebrání posílá poznámku u každé adresy', async () => {
    const user = userEvent.setup();
    renderTable();

    await selectRows(user, [2, 3]);
    await user.click(
      within(screen.getByTestId('suppressions-bulk')).getByRole('button', {
        name: 'Odebrat 2 z 2 vybraných',
      }),
    );
    await user.type(screen.getByLabelText('Poznámka, proč adresu odebíráte'), 'úklid seznamu');
    await user.click(screen.getByRole('button', { name: 'Odebrat adresy' }));

    expect(removeSuppression).toHaveBeenCalledTimes(2);
    for (const [call] of removeSuppression.mock.calls) {
      expect((call as { note: string }).note).toBe('úklid seznamu');
    }
  });

  it('u smíšeného výběru řekne, kolika adres se akce týká, a pod tím proč ne všech', async () => {
    const user = userEvent.setup();
    renderTable();
    await selectRows(user, [0, 1, 2, 3, 4]);
    const bar = screen.getByTestId('suppressions-bulk');
    expect(
      within(bar).getByRole('button', { name: 'Odebrat 2 z 5 vybraných' }),
    ).toBeInTheDocument();
    expect(bar).toHaveTextContent('3 adresy odebrat nejde, viz důvody v tabulce');
  });

  it('u čistého výběru žádné vysvětlení nepřidává', async () => {
    const user = userEvent.setup();
    renderTable();
    await selectRows(user, [3]);
    const bar = screen.getByTestId('suppressions-bulk');
    expect(
      within(bar).getByRole('button', { name: 'Odebrat 1 z 1 vybraných' }),
    ).toBeInTheDocument();
    expect(bar).not.toHaveTextContent('odebrat nejde');
  });

  it('prázdný seznam vysvětlí, k čemu blokované adresy jsou', () => {
    renderTable({ rows: [] });
    expect(
      screen.getByRole('heading', { name: 'Zatím tu není žádná blokovaná adresa' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Přidat adresu' })).toBeInTheDocument();
  });

  /**
   * Tlačítko dřív volalo `router.push(basePath)`, tedy navigaci na tutéž
   * stránku. Kliknutí nedělalo nic, ani chybu v konzoli; ověřeno v prohlížeči.
   * Text pod nadpisem přitom slibuje „Přidat si sem adresu můžete i ručně."
   */
  it('z prázdného stavu jde adresu opravdu zablokovat', async () => {
    const user = userEvent.setup();
    renderTable({ rows: [] });

    await user.click(screen.getByRole('button', { name: 'Přidat adresu' }));
    await user.type(screen.getByLabelText('E-mailová adresa'), 'spam@firma.cz');
    await user.click(screen.getByRole('button', { name: 'Zablokovat adresu' }));

    expect(addSuppression).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'spam@firma.cz' }),
    );
  });

  it('adresu jde zablokovat i tehdy, když už seznam něco obsahuje', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole('button', { name: 'Přidat adresu' }));
    expect(screen.getByLabelText('E-mailová adresa')).toBeInTheDocument();
  });
});
