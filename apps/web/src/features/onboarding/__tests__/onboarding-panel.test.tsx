import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingState } from '@mlain/core/onboarding';
import { OnboardingPanel } from '../onboarding-panel';
import { renderWithProviders } from '../test-utils';

const refresh = vi.fn();
vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn(), back: vi.fn() }),
}));

const setOnboardingHiddenAction = vi.fn();
const dismissOnboardingFinishedAction = vi.fn();
vi.mock('../actions', () => ({
  setOnboardingHiddenAction: (...args: unknown[]) => setOnboardingHiddenAction(...args),
  dismissOnboardingFinishedAction: (...args: unknown[]) => dismissOnboardingFinishedAction(...args),
}));

beforeEach(() => {
  refresh.mockClear();
  setOnboardingHiddenAction.mockReset().mockResolvedValue({ status: 'success' });
  dismissOnboardingFinishedAction.mockReset().mockResolvedValue({ status: 'success' });
});

const state: OnboardingState = {
  steps: [
    { id: 'sending', done: false, href: 'settings/sending', secondaryHref: null },
    { id: 'contacts', done: false, href: 'contacts/import', secondaryHref: 'contacts?demo=1' },
    { id: 'template', done: false, href: 'templates', secondaryHref: null },
    { id: 'testSend', done: false, href: 'campaigns', secondaryHref: null },
    { id: 'firstCampaign', done: false, href: 'campaigns', secondaryHref: null },
  ],
  doneCount: 0,
  total: 5,
  finished: false,
  hidden: false,
  finishedDismissed: false,
};

describe('OnboardingPanel', () => {
  it('vypíše všech pět kroků s odhadem času', () => {
    renderWithProviders(<OnboardingPanel state={state} slug="e-shop" />);
    expect(screen.getByRole('heading', { name: /Vaše první kampaň/ })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText(/asi 10 min/)).toBeInTheDocument();
  });

  it('u kroku s kontakty nabízí i ukázková data jako rovnocennou cestu', () => {
    renderWithProviders(<OnboardingPanel state={state} slug="e-shop" />);
    const link = screen.getByRole('link', { name: /Ukázková/ });
    expect(link).toHaveAttribute('href', '/w/e-shop/contacts?demo=1');
  });

  it('panel jde skrýt, ne zavřít, a po skrytí zůstane řádek se stavem', async () => {
    const onHide = vi.fn();
    renderWithProviders(<OnboardingPanel state={state} slug="e-shop" onHide={onHide} />);
    await userEvent.click(screen.getByRole('button', { name: /Skrýt/ }));
    expect(onHide).toHaveBeenCalledWith(true);
    // Skrytí se ukládá S PROJEKTEM. Bez něj autentizace požadavek odmítne
    // se 404 a panel by se po obnovení stránky zase objevil.
    expect(setOnboardingHiddenAction).toHaveBeenCalledWith({
      workspaceRef: 'e-shop',
      hidden: true,
    });
    // Panel se překreslí hned, ne až po ručním obnovení stránky.
    expect(await screen.findByRole('button', { name: /Zobrazit/ })).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('skrytý panel jde zase zobrazit a uloží se to', async () => {
    renderWithProviders(<OnboardingPanel state={{ ...state, hidden: true }} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /Zobrazit/ }));
    expect(setOnboardingHiddenAction).toHaveBeenCalledWith({
      workspaceRef: 'e-shop',
      hidden: false,
    });
    expect(await screen.findByRole('heading', { name: /Vaše první kampaň/ })).toBeInTheDocument();
  });

  it('když se skrytí neuloží, panel se vrátí a uživatel se to dozví', async () => {
    setOnboardingHiddenAction.mockResolvedValue({ status: 'error', code: 'not_found' });
    renderWithProviders(<OnboardingPanel state={state} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /Skrýt/ }));
    expect(await screen.findByText(/nepodařilo uložit \(not_found\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skrýt/ })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ve skrytém stavu ukazuje počet hotových kroků a tlačítko Zobrazit', () => {
    renderWithProviders(
      <OnboardingPanel state={{ ...state, hidden: true, doneCount: 2 }} slug="e-shop" />,
    );
    expect(screen.getByText(/2 z 5 hotovo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Zobrazit/ })).toBeInTheDocument();
  });

  it('po dokončení ukazuje jednorázovou gratulaci, kterou jde zavřít nadobro', () => {
    renderWithProviders(
      <OnboardingPanel state={{ ...state, finished: true, doneCount: 5 }} slug="e-shop" />,
    );
    expect(screen.getByText(/Hotovo, první kampaň odeslána/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Zavřít/ })).toBeInTheDocument();
  });

  it('kliknutí na Zavřít gratulaci opravdu zavře a uloží to s projektem', async () => {
    const onDismiss = vi.fn();
    renderWithProviders(
      <OnboardingPanel
        state={{ ...state, finished: true, doneCount: 5 }}
        slug="e-shop"
        onDismiss={onDismiss}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Zavřít$/ }));

    expect(onDismiss).toHaveBeenCalled();
    expect(dismissOnboardingFinishedAction).toHaveBeenCalledWith({ workspaceRef: 'e-shop' });
    // Panel mizí HNED. Přehled je serverová stránka, takže bez místního stavu
    // by gratulace zůstala na obrazovce až do ručního obnovení; přesně tak
    // vypadala vada „zelený panel nejde zavřít".
    await waitFor(() => expect(screen.queryByText(/Hotovo, první kampaň odeslána/)).toBeNull());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('když se zavření neuloží, gratulace se vrátí a řekne se proč', async () => {
    dismissOnboardingFinishedAction.mockResolvedValue({ status: 'error', code: 'not_found' });
    renderWithProviders(
      <OnboardingPanel state={{ ...state, finished: true, doneCount: 5 }} slug="e-shop" />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Zavřít$/ }));

    // Žádné tiché selhání: kód problému je vidět, ne schovaný v konzoli.
    expect(await screen.findByText(/nepodařilo zavřít \(not_found\)/)).toBeInTheDocument();
    expect(screen.getByText(/Hotovo, první kampaň odeslána/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('hotový krok je označený i pro čtečku obrazovky, ne jen barvou', () => {
    renderWithProviders(
      <OnboardingPanel
        state={{ ...state, steps: [{ ...state.steps[0]!, done: true }, ...state.steps.slice(1)] }}
        slug="e-shop"
      />,
    );
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'false');
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(/hotovo/i);
  });

  it('po zavření gratulace se nic nevykreslí', () => {
    const { container } = renderWithProviders(
      <OnboardingPanel
        state={{ ...state, finished: true, doneCount: 5, finishedDismissed: true }}
        slug="e-shop"
      />,
    );
    // ToastProvider vykresluje vlastní oblast pro oznámení, takže se hledá
    // konkrétně to, že z panelu nezbylo nic.
    expect(container.querySelector('section')).toBeNull();
    expect(screen.queryByRole('heading', { name: /Vaše první kampaň/ })).toBeNull();
  });

  it('ukázkový kontakt krok neodškrtne, takže seznam pořád ukazuje, co zbývá', () => {
    // Smlouva s výpočtem stavu v packages/core: panel jen zobrazuje, co dostal.
    renderWithProviders(<OnboardingPanel state={state} slug="e-shop" />);
    expect(screen.getByText(/Zbývá 5 kroků/)).toBeInTheDocument();
  });
});
