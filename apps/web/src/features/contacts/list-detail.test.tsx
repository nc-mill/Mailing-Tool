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

/**
 * Serverové akce e-mailů seznamu se podvrhují, jinak by se do modulového grafu
 * testu dostal `@mlain/core/contacts` a s ním `server-only`, který se z klientské
 * komponenty importovat nesmí. Chování akcí má vlastní testy na serveru.
 */
const createEmail = vi.fn().mockResolvedValue({ status: 'success', templateId: 't-1' });
const makeDefault = vi.fn().mockResolvedValue({ status: 'success' });
const toggleEmail = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./list-email-actions', () => ({
  createListEmailTemplateAction: (...args: unknown[]) => createEmail(...args),
  detachListEmailTemplateAction: vi.fn().mockResolvedValue({ status: 'success' }),
  setListEmailEnabledAction: (...args: unknown[]) => toggleEmail(...args),
  saveListBasicsAction: vi.fn().mockResolvedValue({ status: 'success' }),
  saveListRedirectsAction: vi.fn().mockResolvedValue({ status: 'success' }),
  setDefaultListAction: (...args: unknown[]) => makeDefault(...args),
}));

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
  description: '',
  confirmation_ttl_hours: 168,
  confirmation_max_resends: 3,
  confirm_redirect_url: '',
  unsubscribe_redirect_url: '',
  is_default: false,
  // Tři e-maily seznamu ve výchozím stavu: obecné znění, uvítání i rozloučení vypnuté.
  emails: [
    {
      kind: 'confirmation',
      templateId: null,
      templateName: null,
      enabled: true,
      hasConfirmLink: true,
    },
    { kind: 'welcome', templateId: null, templateName: null, enabled: false, hasConfirmLink: true },
    { kind: 'goodbye', templateId: null, templateName: null, enabled: false, hasConfirmLink: true },
  ],
};

function renderDetail(overrides: Partial<ListDetailData> = {}) {
  return renderWithProviders(
    <ListDetail
      basePath="/w/eshop/lists"
      templatesPath="/w/eshop/templates"
      workspaceId="w-1"
      language="cs"
      list={{ ...list, ...overrides }}
    />,
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

/**
 * E-maily seznamu. Testuje se to, co uživatel na obrazovce rozhoduje:
 * jestli se posílají, jestli má znění vlastní, a jestli se dozví o e-mailu,
 * ze kterého se přihlášení dokončit nedá.
 */
describe('e-maily seznamu', () => {
  beforeEach(() => {
    createEmail.mockClear();
    toggleEmail.mockClear();
  });

  it('ukáže všechny tři e-maily a u potvrzení nenabídne vypínač', () => {
    renderDetail();
    expect(screen.getByTestId('list-email-confirmation')).toBeInTheDocument();
    expect(screen.getByTestId('list-email-welcome')).toBeInTheDocument();
    expect(screen.getByTestId('list-email-goodbye')).toBeInTheDocument();
    // Vypnout potvrzení znamená rozbít seznam s dvojím potvrzením, takže vypínač nemá.
    expect(screen.queryByTestId('list-email-enabled-confirmation')).toBeNull();
    expect(screen.getByTestId('list-email-enabled-welcome')).toBeInTheDocument();
  });

  it('vlastní znění zakládá šablonu jedním tlačítkem', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByTestId('list-email-create-welcome'));

    expect(createEmail).toHaveBeenCalledWith(
      expect.objectContaining({ listId: 'l-1', kind: 'welcome', language: 'cs' }),
    );
  });

  it('rozloučení se zapíná přepínačem', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByTestId('list-email-enabled-goodbye'));

    expect(toggleEmail).toHaveBeenCalledWith(
      expect.objectContaining({ listId: 'l-1', kind: 'goodbye', enabled: true }),
    );
  });

  it('potvrzovací e-mail bez odkazu na potvrzení hlásí nahlas', () => {
    renderDetail({
      emails: [
        {
          kind: 'confirmation',
          templateId: 't-9',
          templateName: 'Moje potvrzení',
          enabled: true,
          hasConfirmLink: false,
        },
        {
          kind: 'welcome',
          templateId: null,
          templateName: null,
          enabled: false,
          hasConfirmLink: true,
        },
        {
          kind: 'goodbye',
          templateId: null,
          templateName: null,
          enabled: false,
          hasConfirmLink: true,
        },
      ],
    });

    expect(screen.getByTestId('list-email-no-link')).toHaveTextContent(/nemá odkaz na potvrzení/);
  });
});

/**
 * VÝCHOZÍ SEZNAM. Endpoint `POST /lists/{id}/default` existoval od začátku
 * a neměl volajícího, takže se výchozí seznam nedal přehodit odnikud.
 */
describe('výchozí seznam projektu', () => {
  it('nabídne nastavení, když seznam výchozí není', async () => {
    const user = userEvent.setup();
    makeDefault.mockClear();
    renderDetail();

    await user.click(screen.getByTestId('list-make-default'));

    expect(makeDefault).toHaveBeenCalledWith(expect.objectContaining({ listId: 'l-1' }));
  });

  it('u výchozího seznamu tlačítko nenabízí a řekne to větou', () => {
    renderDetail({ is_default: true });
    expect(screen.queryByTestId('list-make-default')).toBeNull();
    expect(screen.getByTestId('list-is-default')).toBeInTheDocument();
  });
});
