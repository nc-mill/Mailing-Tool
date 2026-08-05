import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormsScreen } from './forms-screen';
import type { FormView } from './types';
import { renderWithProviders } from './test-utils';

/**
 * Mountuje se CELÁ obrazovka, ne dialog s ručně dodanými propy: tlačítko, které
 * nic nevolá, poznají jedině testy nad tím, co si obsluhu dodává samo.
 */

// Radix `Select` jede na Pointer Events a jsdom je nezná. Bez těchhle náhrad
// spadne kliknutí na spouštěč chybou `target.hasPointerCapture is not a function`.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const createForm = vi.fn();
vi.mock('./actions', () => ({
  createFormAction: (input: unknown) => createForm(input),
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

const FORM: FormView = {
  id: 'form-1',
  name: 'Newsletter',
  slug: 'AAAAAAAAAAAAAAAAAAAAAAAA',
  hosted_url: 'https://mail.example.cz/f/AAAAAAAAAAAAAAAAAAAAAAAA',
  fields: [
    { target: 'email', label: { en: 'Email', cs: 'E-mail' }, required: true, type: 'email' },
  ],
  list_ids: ['list-1'],
  double_opt_in: true,
  consent_text: null,
  redirect_url: null,
  success_message: {},
  active: true,
  delivery_template_id: null,
  submission_count: 12,
  accepted_30d: 4,
  created_at: '2026-07-31T10:15:30.000Z',
};

const LISTS = [
  { id: 'list-1', name: 'Newsletter' },
  { id: 'list-2', name: 'VIP' },
];

function renderScreen(forms: FormView[], canEdit = true) {
  return renderWithProviders(
    <FormsScreen
      forms={forms}
      lists={LISTS}
      workspaceId="ws-1"
      basePath="/w/muj-projekt/forms"
      canEdit={canEdit}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  createForm.mockResolvedValue({ status: 'success', id: 'form-9' });
});

describe('FormsScreen', () => {
  it('prázdný stav vysvětlí, k čemu formulář je, a nabídne založení', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vytvořit první formulář' }));
    expect(screen.getByRole('heading', { name: 'Nový formulář' })).toBeInTheDocument();
  });

  it('ukazuje seznam, do kterého formulář zapisuje', () => {
    renderScreen([FORM]);
    expect(screen.getByRole('link', { name: 'Otevřít formulář Newsletter' })).toBeInTheDocument();
    // Jméno seznamu, ne jeho identifikátor: podle něj se pozná, kam přihlášení tečou.
    expect(screen.getAllByText('Newsletter').length).toBeGreaterThan(0);
  });

  it('formulář bez seznamu to přizná, místo aby ukázal prázdno', () => {
    renderScreen([{ ...FORM, list_ids: [] }]);
    expect(screen.getByText('Zatím do žádného, jen založit kontakt')).toBeInTheDocument();
  });

  it('pozastavený formulář má jiný odznak než zapnutý', () => {
    renderScreen([{ ...FORM, active: false }]);
    expect(screen.getByText('Pozastavený')).toBeInTheDocument();
  });

  it('založení pošle jméno i vybraný seznam a otevře detail nového formuláře', async () => {
    const user = userEvent.setup();
    renderScreen([FORM]);
    await user.click(screen.getByTestId('create-form'));
    await user.type(screen.getByTestId('form-name'), 'Patička webu');
    await user.click(screen.getByTestId('create-form-submit'));

    await waitFor(() => {
      expect(createForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        body: { name: 'Patička webu', list_ids: ['list-1'] },
      });
    });
    // Vrátit se do seznamu je slepá ulička: uživatel zakládal formulář proto,
    // aby ho nastavil a vložil na web.
    expect(push).toHaveBeenCalledWith('/w/muj-projekt/forms/form-9');
  });

  it('bez práva zapisovat se zakládání vůbec nenabízí', () => {
    renderScreen([FORM], false);
    expect(screen.queryByTestId('create-form')).toBeNull();
  });

  it('selhání založení řekne důvod ze serveru, ne obecnou hlášku', async () => {
    const user = userEvent.setup();
    createForm.mockResolvedValue({
      status: 'error',
      code: 'validation_failed',
      detail: 'Seznam, do kterého má formulář zapisovat, neexistuje.',
      fieldErrors: {},
    });
    renderScreen([FORM]);
    await user.click(screen.getByTestId('create-form'));
    await user.type(screen.getByTestId('form-name'), 'Patička webu');
    await user.click(screen.getByTestId('create-form-submit'));

    expect(await screen.findByTestId('forms-error')).toHaveTextContent(
      'Seznam, do kterého má formulář zapisovat, neexistuje.',
    );
    expect(push).not.toHaveBeenCalled();
  });
});
