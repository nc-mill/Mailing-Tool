import { describe, expect, it } from 'vitest';
import { ContactsWorkspaceSettingsSchema } from '../settings';

describe('ContactsWorkspaceSettingsSchema', () => {
  it('doplní výchozí hodnoty u prázdného objektu', () => {
    const parsed = ContactsWorkspaceSettingsSchema.parse({});
    expect(parsed).toEqual({
      salutation_by: 'first_name',
      vocative_policy: 'strict',
      default_country: 'CZ',
      number_format: 'auto',
      date_format: 'cs',
      export_encoding: 'utf-8-bom',
      export_delimiter: ';',
      contact_limit: null,
      require_consent_on_import: true,
    });
  });

  it('výchozí vocative_policy je strict podle rozhodnutí zadavatele, ne balanced', () => {
    expect(ContactsWorkspaceSettingsSchema.parse({}).vocative_policy).toBe('strict');
  });

  it('odmítne neznámý klíč', () => {
    expect(() =>
      ContactsWorkspaceSettingsSchema.parse({ salutation_by: 'first_name', nope: 1 }),
    ).toThrow();
  });

  it('odmítne default_country jiné délky než dva znaky', () => {
    expect(() => ContactsWorkspaceSettingsSchema.parse({ default_country: 'CZE' })).toThrow();
  });

  it('dovolí default_country null', () => {
    expect(
      ContactsWorkspaceSettingsSchema.parse({ default_country: null }).default_country,
    ).toBeNull();
  });
});
