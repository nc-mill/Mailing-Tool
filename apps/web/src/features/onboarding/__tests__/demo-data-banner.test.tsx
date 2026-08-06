import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoDataBanner } from '../demo-data-banner';
import { renderWithProviders } from '../test-utils';

const refresh = vi.fn();
vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn(), back: vi.fn() }),
}));

const removeDemoDataAction = vi.fn();
vi.mock('../actions', () => ({
  removeDemoDataAction: (...args: unknown[]) => removeDemoDataAction(...args),
}));

beforeEach(() => {
  refresh.mockClear();
  removeDemoDataAction.mockReset().mockResolvedValue({ status: 'success' });
});

const present = {
  present: true,
  counts: { contacts: 50, lists: 3, tags: 4, segments: 2, templates: 2, campaigns: 1 },
  tagId: '019fbf80-a544-7b74-bfb8-ad00553ac1b9',
};

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
    //
    // Akce se jmenuje „Zobrazit v kontaktech" (návrh má vpravo dvě krátké
    // akce), o štítku mluví věta v pruhu. Podstatná je pořád ADRESA.
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" />);
    expect(screen.getByRole('link', { name: 'Zobrazit v kontaktech' })).toHaveAttribute(
      'href',
      `/w/e-shop/contacts?tag_id=${present.tagId}`,
    );
    expect(screen.getByText(/pod štítkem Ukázková data/)).toBeInTheDocument();
  });

  it('bez známého štítku vede odkaz aspoň na seznam kontaktů, ne na rozbité URL', () => {
    renderWithProviders(<DemoDataBanner state={{ ...present, tagId: null }} slug="e-shop" />);
    expect(screen.getByRole('link', { name: 'Zobrazit v kontaktech' })).toHaveAttribute(
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

  it('potvrzení maže serverovou akcí, která nese projekt', async () => {
    // Holý `fetch` z prohlížeče tuhle cestu volat NEMŮŽE: hlavička
    // `X-Workspace-Id` by chyběla, cesta `/api/v1/demo-data` segment `/w/`
    // nemá a autentizace požadavek odmítne se 404.
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /^Odstranit$/ }));
    await userEvent.click(screen.getByRole('button', { name: /Odstranit ukázková data/ }));
    await waitFor(() =>
      expect(removeDemoDataAction).toHaveBeenCalledWith({ workspaceRef: 'e-shop' }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('po smazání oznámí úspěch, po selhání chybu i s kódem problému', async () => {
    removeDemoDataAction.mockResolvedValue({ status: 'error', code: 'not_found' });
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /^Odstranit$/ }));
    await userEvent.click(screen.getByRole('button', { name: /Odstranit ukázková data/ }));
    expect(await screen.findByText(/nepodařilo odstranit \(not_found\)/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('po úspěšném smazání oznámí, že jsou data pryč', async () => {
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /^Odstranit$/ }));
    await userEvent.click(screen.getByRole('button', { name: /Odstranit ukázková data/ }));
    expect(await screen.findByText(/Ukázková data jsou pryč/)).toBeInTheDocument();
  });
});

/**
 * PRAVIDLO 2 z 7.2b: akce se neskrývají, vysvětlují se. Mazání ukázkových dat
 * chce `contacts:delete`, tedy editora a výš. Prohlížející tlačítko viděl,
 * klikl, a dostal odmítnutí bez jediného vysvětlení.
 */
describe('DemoDataBanner bez oprávnění mazat', () => {
  it('tlačítko nemizí a vedle něj stojí, koho požádat', () => {
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" canRemove={false} />);
    expect(screen.getByTestId('demo-remove')).toBeInTheDocument();
    expect(
      screen.getByText(/Odstranit ukázková data smí editor, správce projektu nebo vlastník/),
    ).toBeInTheDocument();
  });

  it('kliknutí neotevře okno mazání, ale ukáže důvod fokusem', async () => {
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" canRemove={false} />);

    await userEvent.click(screen.getByTestId('demo-remove'));

    expect(screen.queryByRole('button', { name: /Odstranit ukázková data/ })).toBeNull();
    expect(removeDemoDataAction).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toMatch(/Odstranit ukázková data smí editor/);
  });

  it('s oprávněním se chová jako dřív a okno otevře', async () => {
    renderWithProviders(<DemoDataBanner state={present} slug="e-shop" />);
    await userEvent.click(screen.getByTestId('demo-remove'));
    expect(screen.getByRole('button', { name: /Odstranit ukázková data/ })).toBeInTheDocument();
  });
});
