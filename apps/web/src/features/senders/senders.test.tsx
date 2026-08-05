import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SendersScreen, type SenderIdentityView } from './senders-screen';
import type { SenderDomainOption } from './sender-dialog';
import { SenderIdentityPicker } from '../campaigns/sender-identity-picker';
import { renderWithProviders } from '../campaigns/test-utils';

/**
 * Mountuje se CELÁ obrazovka, ne dialog s ručně dodanými propy.
 *
 * Je to poučení ze stejné třídy vad, jakou má zapsanou `sending-screen.test.tsx`:
 * tlačítko „Přidat doménu" nedělalo nic, protože obrazovka obsluhu nepředala,
 * a test nad komponentou, která si obsluhu dodá sama, to z principu neodhalí.
 */

/**
 * Radix `Select` se otevírá přes Pointer Events a při otevření odroluje na
 * vybranou položku. jsdom nezná ani jedno, takže bez těchhle náhrad spadne
 * kliknutí na spouštěč chybou `target.hasPointerCapture is not a function`
 * a nabídka se nikdy neotevře. Náhrady nic nesimulují, jen ta volání spolknou.
 * Opsáno z `settings-form.test.tsx`, kde je totéž ze stejného důvodu.
 */
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const createSender = vi.fn().mockResolvedValue({ status: 'success' });
const updateSender = vi.fn().mockResolvedValue({ status: 'success' });
const deleteSender = vi.fn().mockResolvedValue({ status: 'success' });
const setDefaultSender = vi.fn().mockResolvedValue({ status: 'success' });
const applySender = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./actions', () => ({
  createSenderAction: (input: unknown) => createSender(input),
  updateSenderAction: (input: unknown) => updateSender(input),
  deleteSenderAction: (input: unknown) => deleteSender(input),
  setDefaultSenderAction: (input: unknown) => setDefaultSender(input),
  applySenderToCampaignAction: (input: unknown) => applySender(input),
}));

const refresh = vi.fn();
vi.mock('@mlain/i18n/navigation', async () => {
  const react = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      react.createElement('a', { href, ...rest }, children),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh }),
  };
});

const domain: SenderDomainOption = {
  id: 'dom-1',
  domain: 'kolo-shop.cz',
  provider_id: 'prov-1',
  provider_name: 'Výchozí SES',
  verified: true,
};

const identity: SenderIdentityView = {
  id: 'sid-1',
  name: 'Newsletter',
  from_name: 'Kolo Shop',
  from_email: 'newsletter@kolo-shop.cz',
  reply_to: null,
  provider_id: 'prov-1',
  provider_name: 'Výchozí SES',
  provider_status: 'ready',
  sender_domain_id: 'dom-1',
  domain: 'kolo-shop.cz',
  domain_verified: true,
  is_default: true,
};

function renderScreen(over: Partial<Parameters<typeof SendersScreen>[0]> = {}) {
  return renderWithProviders(
    <SendersScreen
      identities={[identity]}
      domains={[domain]}
      workspaceId="ws-1"
      basePath="/w/demo"
      canEdit
      {...over}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('obrazovka odesílatelů', () => {
  it('ukáže předvolbu i s odznakem výchozí a ověřené domény', () => {
    renderScreen();
    expect(screen.getByText('Newsletter')).toBeInTheDocument();
    expect(screen.getByText('Kolo Shop <newsletter@kolo-shop.cz>')).toBeInTheDocument();
    expect(screen.getByText('Výchozí')).toBeInTheDocument();
    expect(screen.getByText('kolo-shop.cz ověřena')).toBeInTheDocument();
  });

  it('bez domény nenabízí formulář, ale cestu k doméně', () => {
    renderScreen({ domains: [], identities: [] });
    expect(screen.getByTestId('senders-no-domains')).toBeInTheDocument();
    expect(screen.queryByTestId('add-sender')).not.toBeInTheDocument();
  });

  it('prázdný stav vede na založení první předvolby', async () => {
    const user = userEvent.setup();
    renderScreen({ identities: [] });
    await user.click(screen.getByRole('button', { name: 'Nový odesílatel' }));
    expect(await screen.findByTestId('sender-name')).toBeInTheDocument();
  });

  it('bez oprávnění nejsou akce vidět', () => {
    renderScreen({ canEdit: false });
    expect(screen.queryByTestId('add-sender')).not.toBeInTheDocument();
    expect(screen.queryByTestId('edit-sender-sid-1')).not.toBeInTheDocument();
  });

  it('založení pošle celou sadu včetně účtu odvozeného z domény', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByTestId('add-sender'));

    await user.type(screen.getByTestId('sender-name'), 'Fakturace');
    await user.type(screen.getByTestId('sender-from-name'), 'Kolo Shop účtárna');
    await user.type(screen.getByTestId('sender-from-email'), 'faktury@kolo-shop.cz');
    await user.click(screen.getByTestId('sender-submit'));

    await waitFor(() => expect(createSender).toHaveBeenCalledTimes(1));
    expect(createSender.mock.calls[0]![0]).toEqual({
      workspaceId: 'ws-1',
      body: {
        name: 'Fakturace',
        from_name: 'Kolo Shop účtárna',
        from_email: 'faktury@kolo-shop.cz',
        reply_to: null,
        // Účet se nevybírá, odvozuje se z domény.
        provider_id: 'prov-1',
        sender_domain_id: 'dom-1',
        is_default: false,
      },
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('adresa mimo vybranou doménu se na server vůbec nedostane', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByTestId('add-sender'));

    await user.type(screen.getByTestId('sender-name'), 'Cizí');
    await user.type(screen.getByTestId('sender-from-name'), 'Kdosi');
    await user.type(screen.getByTestId('sender-from-email'), 'nekdo@jinde.cz');
    await user.click(screen.getByTestId('sender-submit'));

    expect(await screen.findByText('Adresa musí být na doméně kolo-shop.cz.')).toBeInTheDocument();
    expect(createSender).not.toHaveBeenCalled();
  });

  it('chyba z 422 dosedne k poli, ne do obecné hlášky', async () => {
    createSender.mockResolvedValueOnce({
      status: 'error',
      code: 'validation_failed',
      detail: 'Neplatný vstup',
      fieldErrors: { name: 'Předvolba s tímhle názvem už existuje.' },
    });
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByTestId('add-sender'));
    await user.type(screen.getByTestId('sender-name'), 'Newsletter');
    await user.type(screen.getByTestId('sender-from-name'), 'Kolo Shop');
    await user.type(screen.getByTestId('sender-from-email'), 'a@kolo-shop.cz');
    await user.click(screen.getByTestId('sender-submit'));

    expect(await screen.findByText('Předvolba s tímhle názvem už existuje.')).toBeInTheDocument();
    expect(screen.queryByTestId('sender-dialog-error')).not.toBeInTheDocument();
  });

  it('mazání se ptá a slíbí, že kampaně zůstanou', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByTestId('delete-sender-sid-1'));
    expect(await screen.findByText(/Odeslaných ani rozepsaných kampaní/)).toBeInTheDocument();
    await user.click(screen.getByTestId('confirm-delete-sender'));
    await waitFor(() =>
      expect(deleteSender).toHaveBeenCalledWith({ workspaceId: 'ws-1', id: 'sid-1' }),
    );
  });
});

describe('výběr uloženého odesílatele v kampani', () => {
  it('bez jediné předvolby ukáže cestu, ne prázdný seznam', () => {
    renderWithProviders(
      <SenderIdentityPicker
        identities={[]}
        workspaceId="ws-1"
        campaignId="camp-1"
        selectedId={null}
        basePath="/w/demo"
      />,
    );
    expect(screen.getByTestId('sender-picker-empty')).toBeInTheDocument();
  });

  it('výběrem se kampani uloží všech pět hodnot i odkaz na předvolbu', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <SenderIdentityPicker
        identities={[
          {
            id: 'sid-1',
            name: 'Newsletter',
            from_name: 'Kolo Shop',
            from_email: 'newsletter@kolo-shop.cz',
            reply_to: 'podpora@kolo-shop.cz',
            provider_id: 'prov-1',
            sender_domain_id: 'dom-1',
            domain_verified: true,
          },
        ]}
        workspaceId="ws-1"
        campaignId="camp-1"
        selectedId={null}
        basePath="/w/demo"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Uložený odesílatel' }));
    await user.click(await screen.findByText('Newsletter'));

    await waitFor(() => expect(applySender).toHaveBeenCalledTimes(1));
    expect(applySender.mock.calls[0]![0]).toEqual({
      workspaceId: 'ws-1',
      campaignId: 'camp-1',
      identity: {
        id: 'sid-1',
        from_name: 'Kolo Shop',
        from_email: 'newsletter@kolo-shop.cz',
        reply_to: 'podpora@kolo-shop.cz',
        provider_id: 'prov-1',
        sender_domain_id: 'dom-1',
      },
    });
    expect(refresh).toHaveBeenCalled();
  });
});
