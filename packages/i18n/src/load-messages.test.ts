import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isSupportedLocale } from './locales';
import { NAMESPACES, loadMessages, listNamespaces } from './load-messages';

describe('locales', () => {
  it('podporuje češtinu a angličtinu, výchozí je čeština', () => {
    expect(SUPPORTED_LOCALES).toEqual(['cs', 'en']);
    expect(DEFAULT_LOCALE).toBe('cs');
  });

  it('pozná nepodporovaný jazyk', () => {
    expect(isSupportedLocale('cs')).toBe(true);
    expect(isSupportedLocale('de')).toBe(false);
  });
});

describe('loadMessages', () => {
  it('složí soubory po namespace do jednoho vnořeného stromu', async () => {
    const messages = await loadMessages('cs');
    expect(messages).toHaveProperty('common');
    expect(typeof messages.common).toBe('object');
  });

  it('klíč se čte plnou cestou, namespace je první segment', async () => {
    const messages = await loadMessages('cs');
    expect(messages.common).toHaveProperty('actions');
  });

  it('registr namespace se shoduje s obsahem adresáře', async () => {
    // Aplikace čte katalog přes NAMESPACES, kontroly přes adresář. Kdyby se
    // ty dva seznamy rozešly, chyběl by celý namespace až za běhu.
    for (const locale of SUPPORTED_LOCALES) {
      expect(await listNamespaces(locale), locale).toEqual([...NAMESPACES].sort());
    }
  });

  it('oba jazyky mají stejnou množinu namespace', async () => {
    const cs = await listNamespaces('cs');
    const en = await listNamespaces('en');
    expect(cs).toEqual(en);
  });

  it('nepodporovaný jazyk vyhodí chybu, nevrací prázdný objekt', async () => {
    await expect(loadMessages('de' as never)).rejects.toThrow(/Nepodporovaný jazyk/);
  });
});
