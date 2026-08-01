import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../load-messages';
import { SUPPORTED_LOCALES } from '../locales';

function entries(tree: unknown, prefix = ''): Array<[string, string]> {
  if (typeof tree === 'string') return [[prefix, tree]];
  if (typeof tree !== 'object' || tree === null) return [];
  return Object.entries(tree).flatMap(([key, value]) =>
    entries(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('platnost ICU výrazů', () => {
  for (const locale of SUPPORTED_LOCALES) {
    it(`${locale}: každá zpráva se dá zkompilovat`, async () => {
      const messages = await loadMessages(locale);
      const broken: string[] = [];
      for (const [key, value] of entries(messages)) {
        try {
          new IntlMessageFormat(value, locale);
        } catch (error) {
          broken.push(`${key}: ${(error as Error).message}`);
        }
      }
      expect(broken, broken.join('\n')).toEqual([]);
    });
  }

  it('každý plural v češtině má kategorie =0, one, few, many i other', async () => {
    const messages = await loadMessages('cs');
    const missing: string[] = [];
    for (const [key, value] of entries(messages)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0 {', 'one {', 'few {', 'many {', 'other {']) {
        if (!value.includes(category)) missing.push(`${key} postrádá ${category.trim()}`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('každý plural v angličtině má =0, one i other', async () => {
    const messages = await loadMessages('en');
    const missing: string[] = [];
    for (const [key, value] of entries(messages)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0 {', 'one {', 'other {']) {
        if (!value.includes(category)) missing.push(`${key} postrádá ${category.trim()}`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('plural dává správné tvary pro 0, 1, 2, 5, 21, 100 a 1,5', async () => {
    const messages = (await loadMessages('cs')) as { common: { counts: { contacts: string } } };
    const format = new IntlMessageFormat(messages.common.counts.contacts, 'cs');
    expect(format.format({ count: 0 })).toBe('Žádné kontakty');
    expect(format.format({ count: 1 })).toBe('1 kontakt');
    expect(format.format({ count: 2 })).toBe('2 kontakty');
    expect(String(format.format({ count: 5 }))).toContain('kontaktů');
    expect(String(format.format({ count: 21 }))).toContain('kontaktů');
    expect(String(format.format({ count: 100 }))).toContain('kontaktů');
    expect(String(format.format({ count: 1.5 }))).toContain('kontaktu');
  });
});
