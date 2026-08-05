import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './test-utils';
import { CampaignsScreen } from './campaigns-screen';
import type { CampaignRow } from './campaign-list';

/**
 * Seznam kampaní. Dvě věci, které tenhle soubor hlídá:
 *
 *  - Regrese na nález: tlačítko „Vytvořit kampaň" bylo JEN v prázdném stavu.
 *    Nic nespadlo a testy byly zelené, jen po založení první kampaně tlačítko
 *    zmizelo a druhou už nešlo z rozhraní založit vůbec.
 *  - Mazání se testuje CELOU obrazovkou, ne samotným dialogem. Test komponenty
 *    s ručně dodanými propy by neodhalil, že tabulka `onDelete` nikdy nedostane
 *    a tlačítko je mrtvé.
 */

const remove = vi.fn().mockResolvedValue({ status: 'success' });
vi.mock('./actions', () => ({
  deleteCampaignAction: (input: unknown) => remove(input),
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

const ROWS: CampaignRow[] = [
  {
    id: 'camp-1',
    name: 'Letní výprodej',
    status: 'draft',
    audience_size: 12,
    counters: { total: 12, sent: 0, delivered: 0, bounced: 0 },
    updated_at: '2026-08-01T10:00:00.000Z',
  },
  {
    id: 'camp-2',
    name: 'Jarní novinky',
    status: 'sent',
    audience_size: 40,
    counters: { total: 40, sent: 40, delivered: 39, bounced: 1 },
    updated_at: '2026-07-01T10:00:00.000Z',
  },
];

beforeEach(() => {
  remove.mockClear();
  remove.mockResolvedValue({ status: 'success' });
  push.mockClear();
  refresh.mockClear();
});

function renderScreen(state: 'data' | 'empty') {
  return renderWithProviders(
    <CampaignsScreen
      rows={state === 'data' ? ROWS : []}
      state={state}
      basePath="/w/kolo-shop"
      workspaceId="ws-1"
    />,
  );
}

describe('seznam kampaní', () => {
  it('nabízí založení kampaně i tehdy, když už nějaká existuje', async () => {
    renderScreen('data');

    await userEvent.click(screen.getByTestId('create-campaign'));

    // Zakládání začíná OBSAHEM, ne prázdným řádkem v databázi.
    await waitFor(() => expect(push).toHaveBeenCalledWith('/w/kolo-shop/campaigns/new'));
  });

  it('v prázdném stavu vede akce na týž první krok', async () => {
    renderScreen('empty');

    expect(screen.queryByTestId('create-campaign')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Vytvořit kampaň' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/w/kolo-shop/campaigns/new'));
  });
});

describe('mazání kampaně ze seznamu', () => {
  it('rozepsaná kampaň mazání nabízí, odeslaná ne', () => {
    renderScreen('data');

    expect(screen.getByTestId('delete-campaign-camp-1')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-campaign-camp-2')).not.toBeInTheDocument();
  });

  it('tlačítko je opravdu napojené: potvrzení zavolá akci a seznam se obnoví', async () => {
    renderScreen('data');

    await userEvent.click(screen.getByTestId('delete-campaign-camp-1'));
    // Dialog říká, co se stane, ne jen „opravdu?".
    expect(screen.getByText('Smazat kampaň Letní výprodej?')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('delete-campaign-submit'));

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ workspaceId: 'ws-1', campaignId: 'camp-1' }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('odmítnutí serveru pojmenuje stav, ne kód, a dialog nezavře', async () => {
    remove.mockResolvedValueOnce({
      status: 'error',
      code: 'conflict',
      campaignStatus: 'scheduled',
      detail: '',
    });
    renderScreen('data');

    await userEvent.click(screen.getByTestId('delete-campaign-camp-1'));
    await userEvent.click(screen.getByTestId('delete-campaign-submit'));

    const error = await screen.findByTestId('delete-campaign-error');
    expect(error).toHaveTextContent('Zrušte plán');
    // Obnova by chybovou hlášku přebila novým vykreslením.
    expect(refresh).not.toHaveBeenCalled();
  });
});
