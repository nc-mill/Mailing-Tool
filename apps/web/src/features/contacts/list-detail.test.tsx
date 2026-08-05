import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListDetail, type ListDetailData } from './list-detail';
import { renderWithProviders } from './test-utils';

const setMode = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const setPublic = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./actions', () => ({
  setConfirmationModeAction: (...args: unknown[]) => setMode(...args),
  archiveListAction: vi.fn().mockResolvedValue({ status: 'success' }),
  setListPublicVisibilityAction: (...args: unknown[]) => setPublic(...args),
}));

const list: ListDetailData = {
  id: 'l-1',
  name: 'Newsletter',
  confirmed_count: 12480,
  pending_count: 312,
  double_opt_in: true,
  confirmation_mode: 'one_step',
  archived: false,
  // Výchozí stav je „nenabízet". Seznam je nositelem oprávnění k rozesílce, takže
  // zapnuté nabízení znamená, že se do něj smí přihlásit kdokoli s odhlašovacím odkazem.
  public_visible: false,
  public_name: '',
  public_description: '',
};

function renderDetail(overrides: Partial<ListDetailData> = {}) {
  return renderWithProviders(
    <ListDetail basePath="/w/eshop/lists" workspaceId="w-1" list={{ ...list, ...overrides }} />,
  );
}

beforeEach(() => {
  setMode.mockClear();
});

describe('ListDetail', () => {
  it('ukáže počet potvrzených i čekajících, protože obojí nese rozhodnutí', () => {
    const counts = () => screen.getByTestId('list-counts').textContent!;
    renderDetail();
    expect(counts()).toMatch(/12\s480 potvrzených kontaktů/);
    expect(counts()).toMatch(/312 čeká na potvrzení/);
  });

  it('u obou režimů potvrzení vysvětlí rozdíl větou, ne jen názvem', () => {
    renderDetail();
    expect(screen.getByText(/Potvrzení odešle stránka za něj/)).toBeInTheDocument();
    expect(screen.getByText(/Je to o klik navíc, zato máte doložené/)).toBeInTheDocument();
  });

  it('nepoužívá slova jednokrokové a dvoukrokové jako jediné vysvětlení', () => {
    renderDetail();
    expect(screen.getByRole('radio', { name: 'Jedním kliknutím' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Kliknutím a potvrzením na stránce' }),
    ).toBeInTheDocument();
  });

  it('vybraný režim odpovídá datům', () => {
    renderDetail({ confirmation_mode: 'two_step' });
    expect(screen.getByRole('radio', { name: 'Kliknutím a potvrzením na stránce' })).toBeChecked();
  });

  it('přepnutí režimu uloží a řekne, od kdy platí', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('radio', { name: 'Kliknutím a potvrzením na stránce' }));
    expect(setMode).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'l-1', mode: 'two_step' });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Platí pro potvrzovací e-maily odeslané od teď.',
    );
  });
});

/**
 * Bezpečnostní vada: veřejné centrum předvoleb nabízelo VŠECHNY seznamy projektu,
 * takže se držitel jakéhokoli odhlašovacího odkazu mohl sám přihlásit i do seznamu,
 * který znamená nárok. Nastavení, které to řídí, musí být vidět v detailu seznamu.
 */
describe('veřejné nabízení seznamu', () => {
  beforeEach(() => setPublic.mockClear());

  it('je ve výchozím stavu vypnuté a texty pro příjemce se neptají', () => {
    renderDetail();
    expect(screen.getByTestId('list-public-visible')).toHaveAttribute('data-state', 'unchecked');
    expect(screen.queryByTestId('list-public-name')).toBeNull();
  });

  it('zapnutí se uloží a teprve pak se ptá na veřejný název', async () => {
    renderDetail();
    await userEvent.click(screen.getByTestId('list-public-visible'));

    expect(setPublic).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      id: 'l-1',
      publicVisible: true,
      publicName: '',
      publicDescription: '',
    });
    expect(screen.getByTestId('list-public-name')).toBeTruthy();
  });

  it('nevyplněný veřejný název nabídne pracovní název jako to, co příjemce uvidí', () => {
    renderDetail({ public_visible: true });
    // Správce musí vědět, co se místo prázdného pole ukáže, jinak by mu unikla
    // pracovní poznámka do e-mailu příjemci. (Nadpis stránky nese totéž jméno,
    // proto se hledá celá nápověda, ne jen jméno seznamu.)
    expect(screen.getByText(/uvidí váš pracovní název „Newsletter“/)).toBeTruthy();
  });
});
