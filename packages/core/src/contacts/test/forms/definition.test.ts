import { describe, expect, it } from 'vitest';
import {
  FormDefinitionSchema,
  formFieldName,
  localizedText,
  validateFormFields,
  type FormField,
} from '../../forms/definition';

/**
 * ODCHYLKA OD PLÁNU. Plánový soubor otevírá blokem, který se ptá databáze na
 * `ck_consents__legal_basis` přes `asMigrator()`. Tenhle soubor je jinak čistý unit test
 * bez kontejneru, takže by ho ta jediná kontrola prodloužila o start PostgreSQL.
 * Kontrola se NEZTRÁCÍ: přesunula se do `test/repo/forms.submit.test.ts`, kde kontejner
 * stejně běží, a je tam pod stejným jménem.
 */

const catalog = ['city', 'order_total'];

describe('FormDefinitionSchema', () => {
  it('přijme minimální definici', () => {
    const parsed = FormDefinitionSchema.parse({
      name: 'Newsletter',
      fields: [{ target: 'email', label: { en: 'Email' }, required: true, type: 'email' }],
    });
    expect(parsed.double_opt_in).toBe(true);
    expect(parsed.min_fill_seconds).toBe(2);
    expect(parsed.honeypot_field).toBe('website');
  });

  it('dvojí potvrzení je ve výchozím stavu zapnuté', () => {
    expect(FormDefinitionSchema.parse({ name: 'F', fields: [] }).double_opt_in).toBe(true);
  });

  it('captcha je ve výchozím stavu vypnutá', () => {
    expect(FormDefinitionSchema.parse({ name: 'F', fields: [] }).captcha_provider).toBe('none');
  });

  it('odmítne neznámý klíč', () => {
    expect(() => FormDefinitionSchema.parse({ name: 'F', fields: [], nope: 1 })).toThrow();
  });

  it('odmítne víc než patnáct polí', () => {
    const fields = Array.from({ length: 16 }, () => ({
      target: 'email' as const,
      label: { en: 'E' },
      required: false,
      type: 'text' as const,
    }));
    expect(() => FormDefinitionSchema.parse({ name: 'F', fields })).toThrow();
  });

  it('vlastní styl nad dvacet tisíc znaků neprojde', () => {
    expect(() =>
      FormDefinitionSchema.parse({ name: 'F', fields: [], custom_css: 'x'.repeat(20_001) }),
    ).toThrow();
  });
});

describe('LocalizedText', () => {
  it('vyžaduje klíč en', () => {
    expect(() =>
      FormDefinitionSchema.parse({
        name: 'F',
        fields: [{ target: 'email', label: { cs: 'E-mail' }, required: true, type: 'email' }],
      }),
    ).toThrow();
  });

  it('přijme libovolný další jazyk bez změny typu', () => {
    const parsed = FormDefinitionSchema.parse({
      name: 'F',
      fields: [
        {
          target: 'email',
          label: { en: 'Email', cs: 'E-mail', de: 'E-Mail', pl: 'E-mail' },
          required: true,
          type: 'email',
        },
      ],
    });
    expect(parsed.fields[0]?.label['de']).toBe('E-Mail');
  });

  it('vykreslení padá zpět na en, protože ten je povinný', () => {
    expect(localizedText({ en: 'Email', cs: 'E-mail' }, 'cs')).toBe('E-mail');
    expect(localizedText({ en: 'Email' }, 'de')).toBe('Email');
    expect(localizedText({ en: 'Email', cs: 'E-mail' }, 'cs-CZ')).toBe('E-mail');
  });
});

describe('KRITÉRIUM 88: cíle polí', () => {
  it('přijme pevná pole kontaktu', () => {
    expect(
      validateFormFields(
        [{ target: 'first_name', label: { en: 'N' }, required: false, type: 'text' }],
        catalog,
      ),
    ).toEqual({ ok: true });
  });

  it('přijme vlastní pole, které v katalogu existuje', () => {
    expect(
      validateFormFields(
        [{ target: { attribute: 'city' }, label: { en: 'C' }, required: false, type: 'text' }],
        catalog,
      ),
    ).toEqual({ ok: true });
  });

  it('odmítne vlastní pole, které v katalogu není, už při ukládání formuláře', () => {
    expect(
      validateFormFields(
        [
          {
            target: { attribute: 'neexistuje' },
            label: { en: 'X' },
            required: false,
            type: 'text',
          },
        ],
        catalog,
      ),
    ).toEqual({ ok: false, code: 'unknown_field_key', path: 'fields.0.target' });
  });

  it('formulář bez pole pro e-mail projde validací definice', () => {
    expect(
      validateFormFields(
        [{ target: 'first_name', label: { en: 'N' }, required: false, type: 'text' }],
        catalog,
      ).ok,
    ).toBe(true);
  });
});

describe('jméno pole v těle požadavku', () => {
  it('pevné pole se jmenuje samo sebou', () => {
    const field: FormField = {
      target: 'first_name',
      label: { en: 'N' },
      required: false,
      type: 'text',
    };
    expect(formFieldName(field)).toBe('first_name');
  });

  it('vlastní pole nese prefix attr_, aby nešlo přepsat pevné pole kontaktu', () => {
    const field: FormField = {
      target: { attribute: 'status' },
      label: { en: 'S' },
      required: false,
      type: 'text',
    };
    expect(formFieldName(field)).toBe('attr_status');
  });
});
