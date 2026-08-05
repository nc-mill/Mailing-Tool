import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldBuilder } from './field-builder';
import type { ContactFieldOption, FormFieldView } from './types';
import { renderWithProviders } from './test-utils';

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const saveFields = vi.fn();
const createField = vi.fn();
vi.mock('./actions', () => ({
  saveFormFieldsAction: (input: unknown) => saveFields(input),
  createContactFieldAction: (input: unknown) => createField(input),
}));

const EMAIL: FormFieldView = {
  target: 'email',
  label: { cs: 'E-mail', en: 'Email' },
  required: true,
  type: 'email',
};

const CONTACT_FIELDS: ContactFieldOption[] = [
  {
    id: 'cf-1',
    key: 'company',
    label: { cs: 'Firma', en: 'Company' },
    type: 'text',
    options: {},
    required: false,
    archived_at: null,
  },
  {
    id: 'cf-2',
    key: 'segment',
    label: { cs: 'Segment', en: 'Segment' },
    type: 'enum',
    options: { values: ['malá', 'velká'] },
    required: false,
    archived_at: null,
  },
  {
    id: 'cf-3',
    key: 'zajmy',
    label: { cs: 'Zájmy', en: 'Interests' },
    type: 'multi_enum',
    options: { values: ['a', 'b'] },
    required: false,
    archived_at: null,
  },
];

function renderBuilder(fields: FormFieldView[] = [EMAIL], canEdit = true) {
  return renderWithProviders(
    <FieldBuilder
      formId="form-1"
      workspaceId="ws-1"
      fields={fields}
      contactFields={CONTACT_FIELDS}
      locale="cs"
      canEdit={canEdit}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  saveFields.mockResolvedValue({ status: 'success', id: 'form-1' });
  createField.mockResolvedValue({ status: 'success', id: 'cf-9', key: 'ico' });
});

describe('FieldBuilder', () => {
  it('e-mail nejde odebrat a řekne proč přímo u pole', () => {
    renderBuilder();
    expect(screen.queryByTestId('field-remove-email')).toBeNull();
    // Důvod patří k poli, ne do nápovědy: uživatel ho hledá tam, kde čeká tlačítko.
    expect(screen.getByTestId('email-locked')).toHaveTextContent('E-mail odebrat nejde');
  });

  it('strop patnácti polí říká dřív, než na něj uživatel narazí', () => {
    renderBuilder();
    expect(screen.getByTestId('field-limit')).toHaveTextContent('nejvýš 15 polí');
  });

  it('přidá pevné pole kontaktu', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByTestId('add-field'));
    await user.click(screen.getByTestId('pick-first_name'));
    expect(screen.getByTestId('field-first_name')).toBeInTheDocument();
  });

  it('už použité pole se podruhé nabídnout nedá', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByTestId('add-field'));
    expect(screen.getByTestId('pick-email')).toBeDisabled();
  });

  it('pole s víc hodnotami se nenabízí a řekne se proč', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByTestId('add-field'));
    const button = screen.getByTestId('pick-attr-zajmy');
    // Tiché uložení jedné hodnoty z několika je horší než nenabídnout pole vůbec.
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Pole s víc vybranými hodnotami zatím formulář sbírat neumí');
  });

  it('výběrové pole přebírá hodnoty z vlastního pole kontaktu', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByTestId('add-field'));
    await user.click(screen.getByTestId('pick-attr-segment'));
    await user.click(screen.getByTestId('save-fields'));

    await waitFor(() => {
      expect(saveFields).toHaveBeenCalled();
    });
    const payload = saveFields.mock.calls[0]?.[0] as { fields: { options?: unknown }[] };
    // Kdyby si je uživatel psal podruhé a rozešly se, zápis by neprošel.
    expect(payload.fields[1]?.options).toEqual([
      { value: 'malá', label: 'malá' },
      { value: 'velká', label: 'velká' },
    ]);
  });

  it('pořadí jde změnit klávesnicí, ne jen myší', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByTestId('add-field'));
    await user.click(screen.getByTestId('pick-first_name'));

    // Tlačítko je dosažitelné tabulátorem a má popisek pro čtečku, takže táhnutí
    // myší není jediná cesta.
    const up = screen.getByRole('button', { name: /Posunout pole first_name nahoru/ });
    await user.click(up);
    await user.click(screen.getByTestId('save-fields'));

    await waitFor(() => {
      expect(saveFields).toHaveBeenCalled();
    });
    const payload = saveFields.mock.calls[0]?.[0] as { fields: { target: unknown }[] };
    expect(payload.fields[0]?.target).toBe('first_name');
    expect(payload.fields[1]?.target).toBe('email');
  });

  it('vlastní pole jde založit rovnou ze stavitele a hned se přidá', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByTestId('add-field'));
    await user.click(screen.getByTestId('new-contact-field'));
    await user.type(screen.getByTestId('new-field-label'), 'IČO');
    await user.click(screen.getByTestId('new-field-submit'));

    await waitFor(() => {
      expect(createField).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-1', label: 'IČO', type: 'text' }),
      );
    });
    // Bez odchodu na Nastavení, přesně tam se dnes uživatel ztrácí.
    expect(screen.getByTestId('field-attr_ico')).toBeInTheDocument();
  });

  it('klíč pro API se odvodí z popisku, včetně odstranění diakritiky', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByTestId('add-field'));
    await user.click(screen.getByTestId('new-contact-field'));
    await user.type(screen.getByTestId('new-field-label'), 'Město sídla');
    expect(screen.getByTestId('new-field-key')).toHaveValue('mesto_sidla');
  });

  it('náhled je holé značkování ve vlastním dokumentu, ne ostylovaný obrázek', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByTestId('add-field'));
    await user.click(screen.getByTestId('pick-first_name'));

    const preview = screen.getByTestId('field-preview') as HTMLIFrameElement;
    // Rámeček má vlastní dokument, takže se do něj nepromítne reset stylů aplikace
    // a je vidět to, co uvidí návštěvník stránky bez CSS.
    expect(preview.tagName).toBe('IFRAME');
    expect(preview.srcdoc).toContain('first_name');
    expect(preview.srcdoc).not.toContain('<style');
  });

  it('bez práva zapisovat se needituje nic', () => {
    renderBuilder([EMAIL], false);
    expect(screen.queryByTestId('add-field')).toBeNull();
    expect(screen.queryByTestId('save-fields')).toBeNull();
  });

  it('selhání uložení řekne důvod ze serveru', async () => {
    const user = userEvent.setup();
    saveFields.mockResolvedValue({
      status: 'error',
      code: 'validation_failed',
      detail: 'Formulář odkazuje na vlastní pole, které v projektu neexistuje.',
      fieldErrors: {},
    });
    renderBuilder();
    await user.click(screen.getByTestId('add-field'));
    await user.click(screen.getByTestId('pick-first_name'));
    await user.click(screen.getByTestId('save-fields'));

    expect(await screen.findByTestId('field-builder-error')).toHaveTextContent(
      'Formulář odkazuje na vlastní pole, které v projektu neexistuje.',
    );
  });

  it('popisek pole se ukládá tak, jak ho uživatel napsal', async () => {
    const user = userEvent.setup();
    renderBuilder();
    const label = within(screen.getByTestId('field-email')).getByRole('textbox');
    await user.clear(label);
    await user.type(label, 'Váš e-mail');
    await user.click(screen.getByTestId('save-fields'));

    await waitFor(() => {
      expect(saveFields).toHaveBeenCalled();
    });
    const payload = saveFields.mock.calls[0]?.[0] as { fields: { label: string }[] };
    expect(payload.fields[0]?.label).toBe('Váš e-mail');
  });
});
