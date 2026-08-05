import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddDomainDialog } from './add-domain-dialog';
import { DomainScreen } from './domain-screen';
import { SendingScreen } from './sending-screen';
import type { DomainView, ProviderView } from './sending-settings';
import type { TrialView } from './trial-mode-panel';
import { renderWithProviders } from '../campaigns/test-utils';

/**
 * Regrese na nález ze zkoušení: tlačítko „Přidat doménu" NEDĚLALO NIC.
 *
 * `SendingSettings` má obsluhu `onAddDomain` jako nepovinnou a v prázdném stavu
 * ji volala přes `onAddDomain?.()`, jenže `SendingScreen` ji nikdy nepředával.
 * Kliknutí tedy zavolalo prázdno a nespadlo, takže testy zůstaly zelené.
 *
 * Proto se tady mountuje CELÁ obrazovka, ne komponenta s ručně dodanými propy.
 * Test nad komponentou, které si obsluhu dodá sám, tuhle třídu vad z principu
 * neodhalí: ověřuje jen to, co si sám předal. Je to tatáž vada jako u tlačítka
 * „Vytvořit kampaň" a u „Přidat odesílací účet".
 */

const createDomain = vi.fn().mockResolvedValue({ status: 'success', domainId: 'dom-9' });
const createProvider = vi.fn().mockResolvedValue({ status: 'success', providerId: 'p9' });
const testProvider = vi.fn().mockResolvedValue({ status: 'success', detail: '', sandbox: false });
const deleteDomain = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./actions', () => ({
  createDomainAction: (input: unknown) => createDomain(input),
  createProviderAction: (input: unknown) => createProvider(input),
  testProviderAction: (input: unknown) => testProvider(input),
  deleteDomainAction: (input: unknown) => deleteDomain(input),
  checkDomainAction: vi.fn(),
  updateProviderAction: vi.fn(),
  deleteProviderAction: vi.fn(),
  setDefaultProviderAction: vi.fn(),
  saveGuardsAction: vi.fn(),
  setTrialModeAction: vi.fn(),
  addTrialAddressAction: vi.fn(),
  removeTrialAddressAction: vi.fn(),
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

const ses: ProviderView = {
  id: 'p1',
  name: 'Výchozí SES',
  type: 'ses',
  status: 'ready',
  is_default: true,
  config: { kind: 'ses', region: 'eu-central-1' },
  quota_max_24h: null,
  quota_sent_24h: null,
};

const smtp: ProviderView = {
  id: 'p2',
  name: 'Záložní SMTP',
  type: 'smtp',
  status: 'ready',
  is_default: false,
  config: { kind: 'smtp', host: 'smtp.wedos.net' },
  quota_max_24h: null,
  quota_sent_24h: null,
};

const domain: DomainView = {
  id: 'dom-1',
  domain: 'kolo-shop.cz',
  dkim_ok: true,
  spf_ok: true,
  dmarc_ok: null,
  verified_at: '2026-08-01T10:00:00.000Z',
};

const trial: TrialView = {
  trial_mode: false,
  trial_mode_explicit: false,
  verified: [],
  verified_count: 0,
  max_addresses: 10,
  has_verified_domain: true,
};

const limits = {
  DELIVERABILITY_BOUNCE_GUARD_RATE: 0.08,
  DELIVERABILITY_COMPLAINT_GUARD_RATE: 0.003,
  DELIVERABILITY_BOUNCE_WARN_RATE: 0.04,
  DELIVERABILITY_COMPLAINT_WARN_RATE: 0.001,
  DELIVERABILITY_GUARD_MIN_SENT: 500,
};

function renderScreen(options: { providers?: ProviderView[]; domains?: DomainView[] } = {}) {
  renderWithProviders(
    <SendingScreen
      providers={options.providers ?? [ses]}
      domains={options.domains ?? []}
      guards={{}}
      limits={limits}
      trial={trial}
      basePath="/w/kolo-shop"
      workspaceId="ws-1"
    />,
  );
}

beforeEach(() => {
  createDomain.mockClear();
  createDomain.mockResolvedValue({ status: 'success', domainId: 'dom-9' });
  deleteDomain.mockClear();
  deleteDomain.mockResolvedValue({ status: 'success' });
  push.mockClear();
  refresh.mockClear();
});

describe('obrazovka nastavení odesílání', () => {
  it('tlačítko Přidat doménu v prázdném stavu opravdu otevře dialog', async () => {
    renderScreen();

    await userEvent.click(screen.getByRole('button', { name: 'Přidat doménu' }));

    expect(await screen.findByText('Nová odesílací doména')).toBeInTheDocument();
  });

  it('tlačítko Přidat doménu je i tam, kde už nějaká doména je, a taky otevírá dialog', async () => {
    renderScreen({ domains: [domain] });

    await userEvent.click(screen.getByTestId('add-domain'));

    expect(await screen.findByText('Nová odesílací doména')).toBeInTheDocument();
  });

  it('vyplněná doména odejde v tvaru, který přijímá POST /api/v1/domains', async () => {
    renderScreen();
    await userEvent.click(screen.getByRole('button', { name: 'Přidat doménu' }));

    await userEvent.type(await screen.findByTestId('domain-name'), 'https://www.Kolo-Shop.cz/');
    await userEvent.click(screen.getByTestId('add-domain-submit'));

    await waitFor(() => expect(createDomain).toHaveBeenCalledTimes(1));
    expect(createDomain).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      domain: 'kolo-shop.cz',
      providerId: 'p1',
    });
  });

  it('po založení vede rovnou na DNS záznamy domény, ne zpátky do seznamu', async () => {
    renderScreen();
    await userEvent.click(screen.getByRole('button', { name: 'Přidat doménu' }));

    await userEvent.type(await screen.findByTestId('domain-name'), 'kolo-shop.cz');
    await userEvent.click(screen.getByTestId('add-domain-submit'));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/w/kolo-shop/settings/sending/domains/dom-9'),
    );
  });

  it('dialog dostane všechny účty, takže je z čeho vybrat', async () => {
    renderScreen({ providers: [ses, smtp] });
    await userEvent.click(screen.getByRole('button', { name: 'Přidat doménu' }));

    expect(await screen.findByTestId('domain-provider-p1')).toBeInTheDocument();
    expect(screen.getByTestId('domain-provider-p2')).toBeInTheDocument();
  });
});

/**
 * Doména šla přidat, ale ne odebrat: `DELETE /api/v1/domains/{id}` existuje
 * v kontraktu i v jádru, jen k němu nevedlo z rozhraní nic. Je to tatáž třída vady
 * jako u tlačítka „Přidat doménu", proto se i tady mountuje CELÁ obrazovka: test
 * nad komponentou, které si obsluhu dodá sám, by nezapojenou obsluhu neodhalil.
 */
describe('odebrání odesílací domény ze seznamu', () => {
  it('u domény je tlačítko Odebrat doménu a obrazovka obsluhu opravdu předává', async () => {
    renderScreen({ domains: [domain] });

    await userEvent.click(screen.getByTestId('delete-domain-dom-1'));

    expect(await screen.findByText('Odebrat doménu kolo-shop.cz?')).toBeInTheDocument();
  });

  it('potvrzení říká, co se doopravdy stane u Amazonu, s DNS a s historií', async () => {
    renderScreen({ domains: [domain] });
    await userEvent.click(screen.getByTestId('delete-domain-dom-1'));

    expect(await screen.findByText(/U Amazonu doména zůstane ověřená/)).toBeInTheDocument();
    expect(screen.getByText(/DNS záznamy u registrátora nechte být/)).toBeInTheDocument();
    expect(screen.getByText(/Odeslané kampaně a jejich statistiky zůstanou/)).toBeInTheDocument();
  });

  it('u jediné ověřené domény varuje před návratem do zkušebního režimu', async () => {
    renderScreen({ domains: [domain] });
    await userEvent.click(screen.getByTestId('delete-domain-dom-1'));

    expect(await screen.findByTestId('delete-domain-trial-warning')).toHaveTextContent(
      /vrátí do zkušebního režimu/,
    );
  });

  it('úspěch zavře dialog a obnoví seznam, aby z něj doména zmizela', async () => {
    renderScreen({ domains: [domain] });
    await userEvent.click(screen.getByTestId('delete-domain-dom-1'));
    await userEvent.click(await screen.findByTestId('delete-domain-submit'));

    await waitFor(() =>
      expect(deleteDomain).toHaveBeenCalledWith({ workspaceId: 'ws-1', domainId: 'dom-1' }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText('Odebrat doménu kolo-shop.cz?')).not.toBeInTheDocument(),
    );
  });

  it('běžící kampaň se pojmenuje konkrétně, ne obecným „nejde to"', async () => {
    deleteDomain.mockResolvedValue({
      status: 'error',
      code: 'conflict',
      reason: 'domain_in_use',
      count: null,
      detail: '',
    });
    renderScreen({ domains: [domain] });
    await userEvent.click(screen.getByTestId('delete-domain-dom-1'));
    await userEvent.click(await screen.findByTestId('delete-domain-submit'));

    expect(await screen.findByTestId('delete-domain-error')).toHaveTextContent(
      /běží nebo je naplánovaná kampaň/,
    );
  });

  it('hotová kampaň drží doménu přes cizí klíč a řekne se to i s počtem', async () => {
    deleteDomain.mockResolvedValue({
      status: 'error',
      code: 'conflict',
      reason: 'domain_has_campaigns',
      count: 3,
      detail: '',
    });
    renderScreen({ domains: [domain] });
    await userEvent.click(screen.getByTestId('delete-domain-dom-1'));
    await userEvent.click(await screen.findByTestId('delete-domain-submit'));

    const error = await screen.findByTestId('delete-domain-error');
    expect(error).toHaveTextContent('3 kampaně');
    expect(error).toHaveTextContent(/smazat natrvalo/);
  });

  it('odmítnutí nechá dialog otevřený, aby si uživatel důvod přečetl', async () => {
    deleteDomain.mockResolvedValue({
      status: 'error',
      code: 'forbidden',
      reason: null,
      count: null,
      detail: '',
    });
    renderScreen({ domains: [domain] });
    await userEvent.click(screen.getByTestId('delete-domain-dom-1'));
    await userEvent.click(await screen.findByTestId('delete-domain-submit'));

    expect(await screen.findByTestId('delete-domain-error')).toHaveTextContent(/chybí oprávnění/);
    expect(screen.getByText('Odebrat doménu kolo-shop.cz?')).toBeInTheDocument();
  });
});

/** Odebrání musí jít i z detailu, kde uživatel zjistí, že doménu přidal omylem. */
describe('odebrání odesílací domény z detailu', () => {
  function renderDetail() {
    renderWithProviders(
      <DomainScreen
        workspaceId="ws-1"
        domainId="dom-1"
        domain="kolo-shop.cz"
        records={[]}
        checks={{ mx: null }}
        checkedAt={null}
        sesStatus={null}
        verifiedAt={null}
        basePath="/w/kolo-shop"
      />,
    );
  }

  it('tlačítko je i na detailu a obrazovka obsluhu předává', async () => {
    renderDetail();
    await userEvent.click(screen.getByTestId('delete-domain'));
    expect(await screen.findByText('Odebrat doménu kolo-shop.cz?')).toBeInTheDocument();
  });

  it('po úspěchu se jde zpátky na seznam, ne na neexistující detail', async () => {
    renderDetail();
    await userEvent.click(screen.getByTestId('delete-domain'));
    await userEvent.click(await screen.findByTestId('delete-domain-submit'));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/w/kolo-shop/settings/sending'));
    expect(refresh).toHaveBeenCalled();
  });

  it('odmítnutí z detailu drží uživatele na místě a pojmenuje důvod', async () => {
    deleteDomain.mockResolvedValue({
      status: 'error',
      code: 'conflict',
      reason: 'domain_in_use',
      count: null,
      detail: '',
    });
    renderDetail();
    await userEvent.click(screen.getByTestId('delete-domain'));
    await userEvent.click(await screen.findByTestId('delete-domain-submit'));

    expect(await screen.findByTestId('delete-domain-error')).toHaveTextContent(
      /běží nebo je naplánovaná kampaň/,
    );
    expect(push).not.toHaveBeenCalled();
  });
});

describe('dialog pro novou odesílací doménu', () => {
  function renderDialog(
    providers = [{ id: 'p1', name: 'Výchozí SES', is_default: true }],
    onSubmit = vi.fn().mockResolvedValue({ status: 'success', domainId: 'dom-9' }),
  ) {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <AddDomainDialog
        open
        onOpenChange={onOpenChange}
        providers={providers}
        onSubmit={onSubmit}
      />,
    );
    return { onSubmit, onOpenChange };
  }

  it('vysvětlí laikovi, co doména je a proč to bez DNS nejde', () => {
    renderDialog();
    expect(screen.getByText(/nevyžádané poště/)).toBeInTheDocument();
  });

  it('řekne, kde se záznamy vkládají a jak dlouho ověření trvá', () => {
    renderDialog();
    const next = screen.getByTestId('add-domain-next');
    expect(next).toHaveTextContent(/u správce vaší domény/);
    expect(next).toHaveTextContent(/registrátor, nebo váš webhosting/);
    expect(next).toHaveTextContent(/pár minut, výjimečně to trvá i několik hodin/);
  });

  it('prázdné pole se neodešle a řekne to', async () => {
    const { onSubmit } = renderDialog();
    await userEvent.click(screen.getByTestId('add-domain-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Doménu je potřeba vyplnit.')).toBeInTheDocument();
  });

  it('e-mailová adresa místo domény se opraví na doménu, ne odmítne', async () => {
    const { onSubmit } = renderDialog();
    await userEvent.type(screen.getByTestId('domain-name'), 'info@kolo-shop.cz');
    await userEvent.click(screen.getByTestId('add-domain-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ domain: 'kolo-shop.cz', providerId: 'p1' });
  });

  it('text bez tečky doménou není a neodešle se', async () => {
    const { onSubmit } = renderDialog();
    await userEvent.type(screen.getByTestId('domain-name'), 'kolo shop');
    await userEvent.click(screen.getByTestId('add-domain-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Tohle nevypadá jako doména/)).toBeInTheDocument();
  });

  it('s jediným účtem se na účet neptá, jen řekne, ke kterému doména půjde', () => {
    renderDialog();
    expect(screen.getByTestId('domain-provider-single')).toHaveTextContent('Výchozí SES');
    expect(screen.queryByTestId('domain-provider-p1')).not.toBeInTheDocument();
  });

  it('z více účtů je předvybraný výchozí, ale jde přepnout', async () => {
    const { onSubmit } = renderDialog([
      { id: 'p1', name: 'Výchozí SES', is_default: true },
      { id: 'p2', name: 'Záložní SMTP', is_default: false },
    ]);
    await userEvent.type(screen.getByTestId('domain-name'), 'kolo-shop.cz');
    await userEvent.click(screen.getByTestId('domain-provider-p2'));
    await userEvent.click(screen.getByTestId('add-domain-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ domain: 'kolo-shop.cz', providerId: 'p2' });
  });

  it('bez odesílacího účtu řekne proč to nejde a doménu neodešle', async () => {
    const { onSubmit } = renderDialog([]);
    expect(screen.getByTestId('add-domain-no-providers')).toHaveTextContent(
      /Nejdřív potřebujete odesílací účet/,
    );
    await userEvent.click(screen.getByTestId('add-domain-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('chyba ze serveru zůstane v dialogu a dialog se nezavře', async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      status: 'error',
      code: 'validation_failed',
      detail: 'Doména je zabraná.',
    });
    const { onOpenChange } = renderDialog(
      [{ id: 'p1', name: 'Výchozí SES', is_default: true }],
      onSubmit,
    );
    await userEvent.type(screen.getByTestId('domain-name'), 'kolo-shop.cz');
    await userEvent.click(screen.getByTestId('add-domain-submit'));
    expect(await screen.findByTestId('add-domain-error')).toHaveTextContent('Doména je zabraná.');
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
