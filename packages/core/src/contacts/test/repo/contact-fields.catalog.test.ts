import { describe, expect, it } from 'vitest';
import { toLiquidRoots } from '@mlain/emails/paths';
import { getFieldCatalog } from '../../fields/catalog';
import { archiveContactField, createContactField } from '../../repo/contact-fields';
import { setGreetingEnabled, testContext } from '../support/db';

describe('getFieldCatalog', () => {
  it('obsahuje i prvotřídní pole, ne jen vlastní', async () => {
    const ctx = await testContext();
    const catalog = await getFieldCatalog(ctx);
    const paths = catalog.fields.map((f) => f.path);
    for (const expected of [
      'email',
      'first_name',
      'last_name',
      'greeting',
      'first_name_vocative',
      'locale',
      'created_at',
    ]) {
      expect(paths).toContain(expected);
    }
  });

  /**
   * VYPÍNAČ OSLOVENÍ NESMÍ ROZBÍT ODESÍLÁNÍ.
   *
   * Katalog nekrmí jenom nabídku v editoru. Přes `toLiquidRoots` z něj vzniká
   * seznam povolených cest pro Liquid validátor, a ten na neznámé pole hlásí
   * `liquid_unknown_field` se závažností **error**, na kterou `compileTemplate`
   * vrátí `ok: false`. Kdyby se pole z katalogu ODSTRANILA, přestala by jít
   * odeslat každá šablona, ve které `{{ contact.greeting }}` už stojí.
   *
   * Proto se jen označují `deleted`: editor je nenabídne (`usableFields`),
   * validátor je zná dál.
   */
  describe('vypnuté oslovení a 5. pád', () => {
    it('označí pole oslovení jako deleted, ale nechá je v katalogu', async () => {
      const ctx = await testContext();
      await setGreetingEnabled(ctx, false);
      const catalog = await getFieldCatalog(ctx);

      for (const path of ['greeting', 'first_name_vocative', 'last_name_vocative']) {
        const field = catalog.fields.find((f) => f.path === path);
        expect(field, `pole ${path} zmizelo z katalogu`).toBeDefined();
        expect(field!.deleted, `pole ${path} není označené`).toBe(true);
      }
    });

    it('validátor merge tagů pole dál zná, takže šablona zůstane platná', async () => {
      const ctx = await testContext();
      await setGreetingEnabled(ctx, false);
      const roots = toLiquidRoots(await getFieldCatalog(ctx));
      expect(roots.contactFirstClass).toContain('greeting');
      expect(roots.contactFirstClass).toContain('first_name_vocative');
    });

    it('rod ani jméno se neskrývají, nejsou to 5. pád', async () => {
      const ctx = await testContext();
      await setGreetingEnabled(ctx, false);
      const catalog = await getFieldCatalog(ctx);
      expect(catalog.fields.find((f) => f.path === 'gender')?.deleted).toBe(false);
      expect(catalog.fields.find((f) => f.path === 'first_name')?.deleted).toBe(false);
    });

    it('zapnutí zpátky pole zase odkryje', async () => {
      const ctx = await testContext();
      await setGreetingEnabled(ctx, false);
      await setGreetingEnabled(ctx, true);
      const catalog = await getFieldCatalog(ctx);
      expect(catalog.fields.find((f) => f.path === 'greeting')?.deleted).toBe(false);
    });
  });

  it('vlastní pole se adresují prefixem attr', async () => {
    const ctx = await testContext();
    await createContactField(ctx, {
      key: 'city',
      type: 'text',
      label: { en: 'City', cs: 'Město' },
    });
    const catalog = await getFieldCatalog(ctx);
    expect(catalog.fields.map((f) => f.path)).toContain('attr.city');
  });

  it.each([
    ['text', 'string'],
    ['long_text', 'string'],
    ['url', 'string'],
    ['email', 'string'],
    ['phone', 'string'],
    ['enum', 'string'],
    ['number', 'number'],
    ['boolean', 'boolean'],
    ['date', 'date'],
    ['datetime', 'datetime'],
  ] as const)('typ %s se mapuje na %s', async (type, expected) => {
    const ctx = await testContext();
    await createContactField(ctx, {
      key: 'f',
      type,
      label: { en: 'F' },
      options: type === 'enum' ? { values: ['a'] } : {},
    });
    const catalog = await getFieldCatalog(ctx);
    expect(catalog.fields.find((f) => f.path === 'attr.f')?.type).toBe(expected);
  });

  it('multi_enum je list s itemType string', async () => {
    const ctx = await testContext();
    await createContactField(ctx, {
      key: 'f',
      type: 'multi_enum',
      label: { en: 'F' },
      options: { values: ['a'] },
    });
    const entry = (await getFieldCatalog(ctx)).fields.find((f) => f.path === 'attr.f');
    expect(entry).toMatchObject({ type: 'list', itemType: 'string' });
  });

  it('archivované pole je v katalogu s příznakem deleted, ne vynechané', async () => {
    const ctx = await testContext();
    const { id } = await createContactField(ctx, {
      key: 'old',
      type: 'text',
      label: { en: 'Old' },
    });
    await archiveContactField(ctx, id);
    const entry = (await getFieldCatalog(ctx)).fields.find((f) => f.path === 'attr.old');
    expect(entry?.deleted).toBe(true);
  });

  it('label je otevřená mapa jazyků s povinným en', async () => {
    const ctx = await testContext();
    await createContactField(ctx, {
      key: 'city',
      type: 'text',
      label: { en: 'City', cs: 'Město', de: 'Stadt' },
    });
    const entry = (await getFieldCatalog(ctx)).fields.find((f) => f.path === 'attr.city');
    expect(entry?.label).toEqual({ en: 'City', cs: 'Město', de: 'Stadt' });
  });

  it('version se změní, když se katalog změní', async () => {
    const ctx = await testContext();
    const before = (await getFieldCatalog(ctx)).version;
    await createContactField(ctx, { key: 'city', type: 'text', label: { en: 'City' } });
    expect((await getFieldCatalog(ctx)).version).not.toBe(before);
  });

  it('version se nezmění, když se katalog nezměnil', async () => {
    const ctx = await testContext();
    expect((await getFieldCatalog(ctx)).version).toBe((await getFieldCatalog(ctx)).version);
  });

  it('KONTRAKT PRO P08 A P12: každá položka má path, type, label.en, group a deleted', async () => {
    const ctx = await testContext();
    await createContactField(ctx, { key: 'city', type: 'text', label: { en: 'City' } });
    const catalog = await getFieldCatalog(ctx);
    for (const entry of catalog.fields) {
      expect(typeof entry.path).toBe('string');
      expect(['string', 'number', 'boolean', 'date', 'datetime', 'list']).toContain(entry.type);
      expect(typeof entry.label.en).toBe('string');
      expect(['identity', 'name', 'salutation', 'custom', 'meta']).toContain(entry.group);
      expect(typeof entry.deleted).toBe('boolean');
    }
    expect(catalog.version).toMatch(/^[0-9a-f]{16}$/);
  });
});
