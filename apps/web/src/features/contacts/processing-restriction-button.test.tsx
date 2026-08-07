import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessingRestrictionButton } from './processing-restriction-button';
import { renderWithProviders } from './test-utils';

const refresh = vi.fn();
vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn(), back: vi.fn() }),
}));

const restrictProcessingAction = vi.fn();
const liftProcessingRestrictionAction = vi.fn();
vi.mock('./restriction-actions', () => ({
  restrictProcessingAction: (...args: unknown[]) => restrictProcessingAction(...args),
  liftProcessingRestrictionAction: (...args: unknown[]) => liftProcessingRestrictionAction(...args),
}));

const WORKSPACE = '019fbf52-d8b9-7b0d-b67e-528e8026a383';

beforeEach(() => {
  refresh.mockClear();
  restrictProcessingAction.mockReset().mockResolvedValue({ status: 'success' });
  liftProcessingRestrictionAction.mockReset().mockResolvedValue({ status: 'success' });
});

function render(mode: 'restrict' | 'lift') {
  renderWithProviders(
    <ProcessingRestrictionButton
      workspaceId={WORKSPACE}
      contactId="c-1"
      name="Jana Nováková"
      mode={mode}
    />,
  );
}

describe('omezení zpracování z detailu kontaktu', () => {
  it('zapnutí se ptá jedním oknem a v něm je vidět důsledek', async () => {
    render('restrict');
    await userEvent.click(screen.getByTestId('restrict-processing'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('vypadne ze všech segmentů');
    expect(dialog).toHaveTextContent('nedostane žádnou kampaň');
    expect(dialog).toHaveTextContent('Zprávy, které na něj čekají ve frontě, se zruší');
    // Bez téhle věty by okno vypadalo jako mazání. Článek 18 nic nemaže.
    expect(dialog).toHaveTextContent('Nic se nemaže');
    expect(restrictProcessingAction).not.toHaveBeenCalled();
  });

  it('bez poznámky se nic neodešle, protože audit bez důvodu nikomu nepomůže', async () => {
    render('restrict');
    await userEvent.click(screen.getByTestId('restrict-processing'));
    await userEvent.click(screen.getAllByRole('button', { name: /^omezit zpracování$/i }).at(-1)!);

    expect(restrictProcessingAction).not.toHaveBeenCalled();
    expect(await screen.findByText(/Bez odůvodnění to neuděláme/i)).toBeInTheDocument();
  });

  it('s poznámkou zapne omezení a poznámku pošle serveru', async () => {
    render('restrict');
    await userEvent.click(screen.getByTestId('restrict-processing'));
    await userEvent.type(
      await screen.findByLabelText(/čeho se žádost týká/i),
      'Žádost e-mailem 4. 8.',
    );
    await userEvent.click(screen.getAllByRole('button', { name: /^omezit zpracování$/i }).at(-1)!);

    await waitFor(() =>
      expect(restrictProcessingAction).toHaveBeenCalledWith({
        workspaceId: WORKSPACE,
        id: 'c-1',
        note: 'Žádost e-mailem 4. 8.',
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('zrušení se ptá stejně a taky chce odůvodnění', async () => {
    render('lift');
    await userEvent.click(screen.getByTestId('lift-restriction'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('vrátí do segmentů');
    await userEvent.type(
      await screen.findByLabelText(/jak jste žádost vyřídili/i),
      'Vyřízeno 5. 8.',
    );
    await userEvent.click(screen.getAllByRole('button', { name: /^zrušit omezení$/i }).at(-1)!);

    await waitFor(() =>
      expect(liftProcessingRestrictionAction).toHaveBeenCalledWith({
        workspaceId: WORKSPACE,
        id: 'c-1',
        note: 'Vyřízeno 5. 8.',
      }),
    );
  });

  it('kliknutí mimo okno rozepsané odůvodnění neztratí', async () => {
    // Od 7. 8. jde nedestruktivní okno zavřít kliknutím mimo (pravidlo 5.3)
    // a tohle je JEDINÉ ze sedmnácti takových oken, ve kterém se něco vyplňuje.
    // Kliknutí mimo je ústup, ne zahození rozdělané práce (princip P10): text
    // drží spouštěč, ne dialog, takže se po znovuotevření vrátí. Kdyby si ho
    // někdy vzal dialog nebo kdyby ho zavření mazalo, spadne tenhle test.
    //
    // `pointerEventsCheck: 0` je nutné: Radix nad otevřeným modálem nastaví
    // `pointer-events: none` a kliknutí mimo by se jinak nedalo poslat. Cílem
    // je kořenový prvek, ne `body`: user-event si výsledek kontroly pamatuje
    // na prvku, a `body` už ho má z dřívějších testů v tomhle souboru, kdy
    // nad ním okno otevřené bylo.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render('restrict');
    await user.click(screen.getByTestId('restrict-processing'));
    await user.type(await screen.findByLabelText(/čeho se žádost týká/i), 'Žádost e-mailem 4. 8.');

    await user.click(document.documentElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(restrictProcessingAction).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('restrict-processing'));
    expect(await screen.findByLabelText(/čeho se žádost týká/i)).toHaveValue(
      'Žádost e-mailem 4. 8.',
    );
  });

  it('chybu ze serveru ukáže, nespolkne ji', async () => {
    restrictProcessingAction.mockResolvedValue({ status: 'error', code: 'forbidden' });
    render('restrict');
    await userEvent.click(screen.getByTestId('restrict-processing'));
    await userEvent.type(await screen.findByLabelText(/čeho se žádost týká/i), 'x');
    await userEvent.click(screen.getAllByRole('button', { name: /^omezit zpracování$/i }).at(-1)!);

    expect(await screen.findByText(/forbidden/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
