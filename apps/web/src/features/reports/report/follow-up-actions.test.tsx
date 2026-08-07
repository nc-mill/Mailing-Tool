// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { ToastProvider } from '@mlain/ui/patterns/toast';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import csReports from '../../../../../../packages/i18n/messages/cs/reports.json';
import { TOAST_LABELS } from '@/features/contacts/test-utils';
import { FollowUpActions } from './follow-up-actions';

const duplicate = vi.fn();
vi.mock('@/features/campaigns/actions', () => ({
  duplicateCampaignAction: (input: unknown) => duplicate(input),
}));

const push = vi.fn();
vi.mock('@mlain/i18n/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

function renderActions() {
  render(
    <NextIntlClientProvider locale="cs" messages={{ reports: csReports }} timeZone="Europe/Prague">
      <ToastProvider labels={TOAST_LABELS}>
        <FollowUpActions workspaceId="ws-1" workspaceSlug="kolo-shop" campaignId="camp-1" />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe('FollowUpActions', () => {
  beforeEach(() => {
    duplicate.mockReset();
    push.mockReset();
  });

  /**
   * MRTVÉ ODKAZY. Obě akce vedly na `/campaigns/new` s parametrem, který ta
   * stránka nečte, takže se otevřel prázdný průvodce. Tenhle test hlídá, že se
   * na tu adresu nevrátí ani jedna: kdyby se vrátila, vypadá to zvenčí jako
   * funkční tlačítko a neudělá to nic.
   */
  it('nevede odsud jediný odkaz na prázdného průvodce', () => {
    renderActions();

    const dead = screen
      .getAllByRole('link')
      .filter((link) => (link.getAttribute('href') ?? '').includes('/campaigns/new'));
    expect(dead).toEqual([]);
  });

  it('duplikace zavolá akci a odejde rovnou do kopie', async () => {
    duplicate.mockResolvedValue({ status: 'success', campaignId: 'camp-2' });
    renderActions();

    await userEvent.click(screen.getByTestId('report-duplicate'));

    expect(duplicate).toHaveBeenCalledWith({ workspaceId: 'ws-1', campaignId: 'camp-1' });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/w/kolo-shop/campaigns/camp-2'));
  });

  it('neúspěšná duplikace to řekne a nikam neodejde', async () => {
    duplicate.mockResolvedValue({ status: 'error', code: 'campaign_locked' });
    renderActions();

    await userEvent.click(screen.getByTestId('report-duplicate'));

    expect(await screen.findByText(/campaign_locked/)).toBeVisible();
    expect(push).not.toHaveBeenCalled();
  });

  /**
   * „Poslat znovu neotevřevším" je pryč schválně: duplikace kopíruje PŮVODNÍ
   * publikum, takže by tlačítko s tímhle nápisem poslalo e-mail znovu všem.
   * Zbývají dvě akce, které tutéž práci udělají poctivě ve dvou krocích.
   */
  it('nenabízí odeslání neotevřevším, ale nabízí segment z nich', () => {
    renderActions();

    expect(screen.queryByText(/Poslat znovu/)).toBeNull();
    expect(
      screen.getByRole('link', { name: csReports.report.actions.segmentFromNotOpened }),
    ).toHaveAttribute('href', '/w/kolo-shop/segments/new?from_campaign=camp-1&preset=not_opened');
  });
});
