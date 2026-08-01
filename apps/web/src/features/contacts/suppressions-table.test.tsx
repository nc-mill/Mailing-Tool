import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SuppressionsTable } from './suppressions-table';
import type { SuppressionRow } from './suppression-affordance';
import { renderWithProviders } from './test-utils';

const reveal = vi.fn().mockResolvedValue({ status: 'success', email: 'alena@seznam.cz' });

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('./actions', () => ({
  removeSuppressionAction: vi.fn().mockResolvedValue({ status: 'success' }),
  revealSuppressionEmailAction: (...args: unknown[]) => reveal(...args),
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
      rows={rows}
      role="owner"
      now={new Date('2026-07-31T12:00:00.000Z')}
      pagination={{ next_cursor: null, prev_cursor: null, has_more: false, limit: 50 }}
      filters={{}}
      {...props}
    />,
  );
}

/** Zaškrtávátko řádku podle pořadí v mřížce. Popisek je u P05 jeden pro všechny řádky. */
async function selectRows(user: ReturnType<typeof userEvent.setup>, indexes: number[]) {
  const grid = screen.getByRole('grid');
  const boxes = within(grid).getAllByRole('checkbox', { name: 'Vybrat adresu' });
  for (const index of indexes) await user.click(boxes[index]!);
}

beforeEach(() => {
  reveal.mockClear();
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

  it('adresy jsou maskované a celá se ukáže až po kliknutí, se zápisem do auditu', async () => {
    const user = userEvent.setup();
    renderTable();
    expect(screen.getByText('a***@seznam.cz')).toBeInTheDocument();
    await user.click(
      within(screen.getByTestId('suppression-1')).getByRole('button', {
        name: 'Zobrazit celou adresu',
      }),
    );
    expect(reveal).toHaveBeenCalledWith({ id: '1' });
    expect(await screen.findByText('alena@seznam.cz')).toBeInTheDocument();
    expect(screen.getByText('Zobrazení celé adresy zapíšeme do auditu.')).toBeInTheDocument();
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
});
