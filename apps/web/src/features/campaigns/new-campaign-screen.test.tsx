import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './test-utils';
import { NewCampaignScreen } from './new-campaign-screen';

/**
 * První krok zakládání kampaně.
 *
 * Testuje se CELÁ obrazovka i s napojením na serverové akce, ne jen vzhled:
 * test komponenty s ručně dodanými propy by neodhalil, že tlačítko akci nikdy
 * nezavolá, a přesně tahle třída chyb tu už jednou byla.
 */

const fromBlank = vi.fn();
const fromTemplate = vi.fn();
vi.mock('./actions', () => ({
  startCampaignFromBlankAction: (input: unknown) => fromBlank(input),
  startCampaignFromTemplateAction: (input: unknown) => fromTemplate(input),
}));

const push = vi.fn();
vi.mock('@mlain/i18n/navigation', async () => {
  const react = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      react.createElement('a', { href, ...rest }, children),
    useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  };
});

const TEMPLATES = [
  { id: 'tpl-1', name: 'Výprodejová šablona' },
  { id: 'tpl-2', name: 'Novinky' },
];

beforeEach(() => {
  fromBlank.mockClear();
  fromBlank.mockResolvedValue({ status: 'success', campaignId: 'camp-9', templateId: 'tpl-9' });
  fromTemplate.mockClear();
  fromTemplate.mockResolvedValue({ status: 'success', campaignId: 'camp-8', templateId: 'tpl-1' });
  push.mockClear();
});

function renderScreen(templates = TEMPLATES) {
  return renderWithProviders(
    <NewCampaignScreen workspaceId="ws-1" basePath="/w/kolo-shop" templates={templates} />,
  );
}

describe('krok 1: obsah e-mailu', () => {
  it('ohlásí, že je to první krok ze tří', () => {
    renderScreen();
    expect(screen.getByRole('status')).toHaveTextContent('Krok 1 z 3');
  });

  /**
   * KROK 1 JE EDITOR, ne obrazovka šablon. Dřív tahle cesta končila v editoru
   * knihovní šablony s parametry návratu, takže uživatel psal e-mail mimo
   * kampaň a vracel se do ní tlačítkem.
   */
  it('prázdný e-mail založí kampaň s obsahem a pustí uživatele rovnou do kroku 1', async () => {
    renderScreen();

    await userEvent.click(screen.getByTestId('new-campaign-continue'));

    await waitFor(() =>
      expect(fromBlank).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        name: 'Nová kampaň',
        locale: 'cs',
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/w/kolo-shop/campaigns/camp-9/content'));
  });

  it('výběr šablony vede taky do kroku 1, obsah se v něm upraví', async () => {
    renderScreen();

    await userEvent.click(screen.getByTestId('campaign-source-template'));
    await userEvent.click(screen.getByLabelText('Novinky'));
    await userEvent.click(screen.getByTestId('new-campaign-continue'));

    await waitFor(() =>
      expect(fromTemplate).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        name: 'Nová kampaň',
        templateId: 'tpl-2',
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/w/kolo-shop/campaigns/camp-8/content'));
  });

  it('nevybraná šablona zastaví u obrazovky, ne až na API', async () => {
    renderScreen();

    await userEvent.click(screen.getByTestId('campaign-source-template'));
    await userEvent.click(screen.getByTestId('new-campaign-continue'));

    expect(await screen.findByTestId('new-campaign-error')).toHaveTextContent('Vyberte šablonu');
    expect(fromTemplate).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('prázdný název zastaví u obrazovky', async () => {
    renderScreen();

    await userEvent.clear(screen.getByLabelText('Název kampaně'));
    await userEvent.click(screen.getByTestId('new-campaign-continue'));

    expect(await screen.findByTestId('new-campaign-error')).toHaveTextContent('Zadejte název');
    expect(fromBlank).not.toHaveBeenCalled();
  });

  it('bez jediné šablony to nabídne cestu k šablonám, ne prázdný seznam', async () => {
    renderScreen([]);

    await userEvent.click(screen.getByTestId('campaign-source-template'));

    expect(screen.getByTestId('template-choice')).toHaveTextContent('Zatím nemáte žádnou šablonu');
    expect(screen.getByRole('link', { name: 'Spravovat šablony' })).toHaveAttribute(
      'href',
      '/w/kolo-shop/templates',
    );
  });

  it('neúspěch se nespolkne a na nikam se nepřesměruje', async () => {
    fromBlank.mockResolvedValueOnce({ status: 'error', code: 'internal_error' });
    renderScreen();

    await userEvent.click(screen.getByTestId('new-campaign-continue'));

    expect(await screen.findByTestId('new-campaign-error')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
