import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormEditor } from './form-editor';
import type { FormView } from './types';
import { renderWithProviders } from './test-utils';

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const updateForm = vi.fn();
const deleteForm = vi.fn();
const createTemplate = vi.fn();
vi.mock('./actions', () => ({
  updateFormAction: (input: unknown) => updateForm(input),
  deleteFormAction: (input: unknown) => deleteForm(input),
  createDeliveryTemplateAction: (input: unknown) => createTemplate(input),
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

function renderEditor(overrides: Partial<FormView> = {}, canEdit = true) {
  return renderWithProviders(
    <FormEditor
      form={{ ...FORM, ...overrides }}
      lists={[
        { id: 'list-1', name: 'Newsletter' },
        { id: 'list-2', name: 'VIP' },
      ]}
      templates={[{ id: 'tpl-1', name: 'E-book' }]}
      contactFields={[
        {
          id: 'cf-1',
          key: 'company',
          label: { cs: 'Firma', en: 'Company' },
          type: 'text',
          options: {},
          required: false,
          archived_at: null,
        },
      ]}
      workspaceId="ws-1"
      workspaceSlug="muj-projekt"
      basePath="/w/muj-projekt/forms"
      canEdit={canEdit}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  updateForm.mockResolvedValue({ status: 'success', id: 'form-1' });
  deleteForm.mockResolvedValue({ status: 'success', id: 'form-1' });
  createTemplate.mockResolvedValue({ status: 'success', id: 'tpl-9' });
});

/**
 * Krok „co člověku přijde po vyplnění". Je to důvod, proč si většina lidí
 * formulář na web dává: nech mi adresu a já ti pošlu e-book.
 */
describe('FormEditor a e-mail po vyplnění', () => {
  it('formulář se zapnutým potvrzováním řekne, že e-mail odejde až po kliknutí', () => {
    renderEditor();
    expect(screen.getByTestId('form-email-timing')).toHaveTextContent(
      'Odejde až ve chvíli, kdy člověk klikne na potvrzovací odkaz.',
    );
  });

  it('s vypnutým potvrzováním řekne, že e-mail odejde hned', () => {
    renderEditor({ double_opt_in: false });
    expect(screen.getByTestId('form-email-timing')).toHaveTextContent(
      'Odejde hned po odeslání formuláře',
    );
  });

  it('výběr e-mailu se uloží na formulář', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('combobox', { name: 'Který e-mail se pošle' }));
    await user.click(screen.getByRole('option', { name: 'E-book' }));
    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { delivery_template_id: 'tpl-1' },
      });
    });
  });

  it('odebrání e-mailu pošle null, ne prázdný řetězec', async () => {
    const user = userEvent.setup();
    renderEditor({ delivery_template_id: 'tpl-1' });
    await user.click(screen.getByRole('combobox', { name: 'Který e-mail se pošle' }));
    await user.click(screen.getByRole('option', { name: 'Neposílat nic' }));
    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { delivery_template_id: null },
      });
    });
  });

  it('nastavený e-mail nabídne odkaz do editoru', () => {
    renderEditor({ delivery_template_id: 'tpl-1' });
    expect(screen.getByTestId('edit-delivery-template')).toHaveAttribute(
      'href',
      '/w/muj-projekt/templates/tpl-1',
    );
  });

  it('bez nastaveného e-mailu se odkaz do editoru nenabízí', () => {
    renderEditor();
    expect(screen.queryByTestId('edit-delivery-template')).toBeNull();
  });

  it('založení e-mailu ho rovnou naváže a otevře editor', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByTestId('create-delivery-template'));
    await waitFor(() => {
      expect(createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-1', formId: 'form-1' }),
      );
    });
    // Dalším krokem je psaní e-mailu, ne návrat na nastavení formuláře.
    expect(push).toHaveBeenCalledWith('/w/muj-projekt/templates/tpl-9');
  });
});

describe('FormEditor a potvrzování e-mailem', () => {
  it('vypnutí potvrzování otevře dialog s doslovným zněním následku', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('switch', { name: 'Potvrzení přihlášení e-mailem' }));
    expect(
      screen.getByRole('heading', { name: 'Vypnout potvrzení přihlášení e-mailem?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Bez potvrzovacího e-mailu může kdokoliv přihlásit cizí adresu. Zvyšuje to riziko stížností na spam a v některých případech to znamená, že souhlas nedokážete doložit. Opravdu vypnout?',
      ),
    ).toBeInTheDocument();
  });

  it('dokud dialog nepotvrdí, zůstane potvrzování zapnuté a nic se neuloží', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('switch', { name: 'Potvrzení přihlášení e-mailem' }));
    await user.click(screen.getByRole('button', { name: 'Nechat zapnuté' }));
    expect(screen.getByRole('switch', { name: 'Potvrzení přihlášení e-mailem' })).toBeChecked();
    expect(updateForm).not.toHaveBeenCalled();
  });

  it('po potvrzení dialogu se vypne a uloží', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('switch', { name: 'Potvrzení přihlášení e-mailem' }));
    await user.click(screen.getByRole('button', { name: 'Vypnout potvrzení' }));
    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { double_opt_in: false },
      });
    });
  });

  it('zapnutí zpátky žádný dialog nemá, protože je to bezpečnější směr', async () => {
    const user = userEvent.setup();
    renderEditor({ double_opt_in: false });
    await user.click(screen.getByRole('switch', { name: 'Potvrzení přihlášení e-mailem' }));
    expect(
      screen.queryByRole('heading', { name: 'Vypnout potvrzení přihlášení e-mailem?' }),
    ).toBeNull();
    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { double_opt_in: true },
      });
    });
  });
});

describe('FormEditor a ostatní nastavení', () => {
  it('pozastavení je přepínač, ne mazání', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('switch', { name: 'Formulář sbírá přihlášení' }));
    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { active: false },
      });
    });
    expect(deleteForm).not.toHaveBeenCalled();
  });

  it('přejmenování se uloží až při opuštění pole, ne po každém písmenu', async () => {
    const user = userEvent.setup();
    renderEditor();
    const input = screen.getByTestId('form-name');
    await user.clear(input);
    await user.type(input, 'Patička webu');
    expect(updateForm).not.toHaveBeenCalled();
    await user.tab();
    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { name: 'Patička webu' },
      });
    });
  });

  it('odkaz na veřejnou stránku míří na adresu z API, ne na složenou z identifikátoru', () => {
    renderEditor();
    expect(screen.getByTestId('open-public-form')).toHaveAttribute(
      'href',
      'https://mail.example.cz/f/AAAAAAAAAAAAAAAAAAAAAAAA',
    );
  });

  it('mazání nabídne mírnější cestu a teprve pak smaže', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByTestId('delete-form'));
    // Většina lidí, kteří sáhnou po smazání, chce formulář jen zastavit.
    expect(
      screen.getByText(
        'Když chcete formulář jen dočasně zastavit, vypněte přepínač Formulář sbírá přihlášení.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Smazat formulář', hidden: false }));
    await waitFor(() => {
      expect(deleteForm).toHaveBeenCalledWith({ workspaceId: 'ws-1', id: 'form-1' });
    });
    expect(push).toHaveBeenCalledWith('/w/muj-projekt/forms');
  });

  it('bez práva zapisovat se mazání nenabízí', () => {
    renderEditor({}, false);
    expect(screen.queryByTestId('delete-form')).toBeNull();
  });

  it('selhání uložení řekne důvod ze serveru', async () => {
    const user = userEvent.setup();
    updateForm.mockResolvedValue({
      status: 'error',
      code: 'validation_failed',
      detail: 'Seznam neexistuje.',
      fieldErrors: {},
    });
    renderEditor();
    await user.click(screen.getByRole('switch', { name: 'Formulář sbírá přihlášení' }));
    expect(await screen.findByTestId('form-editor-error')).toHaveTextContent('Seznam neexistuje.');
  });
});
