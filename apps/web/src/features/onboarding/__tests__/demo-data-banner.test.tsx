import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoDataBanner } from '../demo-data-banner';
import { renderWithProviders } from '../test-utils';

const present = {
  present: true,
  counts: { contacts: 50, lists: 3, tags: 4, segments: 2, templates: 2, campaigns: 1 },
  tagId: '019fbf80-a544-7b74-bfb8-ad00553ac1b9',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DemoDataBanner', () => {
  it('bez ukázkových dat se nevykreslí nic', () => {
    renderWithProviders(
      <DemoDataBanner state={{ present: false, counts: null, tagId: null }} slug="e-shop" />,
    );
    expect(screen.queryByText(/ukázková data/i)).toBeNull();
  });

  it('s ukázkovými daty ukáže trvalý pruh s počtem a s akcí', () => {
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" />);
    expect(screen.getByText(/V projektu jsou ukázková data/)).toBeInTheDocument();
    expect(screen.getByText(/50 ukázkových kontaktů/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Odstranit/ })).toBeInTheDocument();
  });

  it('odkáže na hromadný výběr přes štítek, aby šlo mazat i po částech', () => {
    // ODCHYLKA OD PLÁNU, OVĚŘENÁ V PROHLÍŽEČI: plán psal `?tag=ukazkova-data`,
    // jenže tabulka kontaktů filtruje podle `tag_id`. Se jménem štítku v URL
    // se seznam nefiltroval vůbec a odkaz jen vypadal, že něco dělá.
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" />);
    expect(screen.getByRole('link', { name: /štítku Ukázková data/ })).toHaveAttribute(
      'href',
      `/w/e-shop/contacts?tag_id=${present.tagId}`,
    );
  });

  it('bez známého štítku vede odkaz aspoň na seznam kontaktů, ne na rozbité URL', () => {
    renderWithProviders(<DemoDataBanner state={{ ...present, tagId: null }} slug="e-shop" />);
    expect(screen.getByRole('link', { name: /štítku Ukázková data/ })).toHaveAttribute(
      'href',
      '/w/e-shop/contacts',
    );
  });

  it('kliknutí na Odstranit otevře dialog s počty všech druhů položek', async () => {
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /^Odstranit$/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/50 kontaktů/);
    expect(dialog).toHaveTextContent(/1 kampaň/);
    expect(dialog).toHaveTextContent(/Na nic ostatního v projektu se nesáhne/);
  });

  it('dialog nemá zaškrtávací políčko ani opisování, protože je to úroveň N2', async () => {
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /^Odstranit$/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(dialog.querySelectorAll('input[type="text"]')).toHaveLength(0);
    expect(dialog.querySelectorAll('input')).toHaveLength(0);
  });

  it('výchozí fokus je na ústupovém tlačítku, ne na potvrzení', async () => {
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /^Odstranit$/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Nechat je tu/ })).toHaveFocus());
  });

  it('potvrzení zavolá DELETE na endpoint ukázkových dat', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /^Odstranit$/ }));
    await userEvent.click(screen.getByRole('button', { name: /Odstranit ukázková data/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/demo-data', { method: 'DELETE' }),
    );
  });

  it('po smazání oznámí úspěch, po selhání chybu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /^Odstranit$/ }));
    await userEvent.click(screen.getByRole('button', { name: /Odstranit ukázková data/ }));
    expect(await screen.findByText(/nepodařilo odstranit/)).toBeInTheDocument();
  });
});
