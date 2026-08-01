import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BASE_SECTION_KINDS,
  baseSectionSpecSchema,
  buildBaseTemplate,
  type BaseSectionSpec,
} from '../../src/base/index';

const brand = {
  palette: {
    primary: '#c41e3a',
    secondary: '#1a1a1a',
    accent: '#c41e3a',
    background: '#f4f5f7',
    text: '#111827',
    source: {
      primary: 'fallback' as const,
      secondary: 'fallback' as const,
      accent: 'fallback' as const,
      background: 'fallback' as const,
      text: 'fallback' as const,
    },
  },
  typography: { headingStack: 'system', bodyStack: 'system', radius: 6 },
};

describe('baseSectionSpecSchema', () => {
  it('přijme platnou sekci hero', () => {
    const parsed = baseSectionSpecSchema.safeParse({
      kind: 'hero',
      headline: 'Letní výprodej kol',
      subhead: 'Slevy až 20 %',
      cta: { label: 'Prohlédnout kola', href: 'https://kolo-shop.cz/vyprodej' },
    });
    expect(parsed.success).toBe(true);
  });

  it('přijme zbylých sedm druhů sekcí', () => {
    const sections = [
      { kind: 'article', heading: 'Novinky', body: 'První odstavec.\n\nDruhý odstavec.' },
      {
        kind: 'feature',
        headline: 'Nové kolo',
        body: 'Popis.',
        cta: { label: 'Koupit', href: 'https://kolo-shop.cz' },
      },
      { kind: 'bullets', heading: 'Co je nového', items: ['Nová kola', 'Delší záruka'] },
      { kind: 'keyValue', rows: [{ label: 'Číslo objednávky', value: '12345' }] },
      { kind: 'quote', text: 'Skvělý obchod.', author: 'Jana N.' },
      { kind: 'cta', label: 'Koupit', href: 'https://kolo-shop.cz' },
      { kind: 'spacer' },
    ];
    for (const section of sections) {
      expect(baseSectionSpecSchema.safeParse(section).success, section.kind).toBe(true);
    }
  });

  it('odmítne neznámý druh sekce', () => {
    expect(baseSectionSpecSchema.safeParse({ kind: 'carousel' }).success).toBe(false);
  });

  it('odmítne HTML tam, kde má být prostý text', () => {
    // Sekce chodí z jazykového modelu a generátor je vkládá do dokumentu jako
    // prostý text. Značka by se ve výsledném mailu ukázala jako viditelné znaky
    // uprostřed odstavce, případně by prolezla do bloku bez sanitizace.
    const parsed = baseSectionSpecSchema.safeParse({
      kind: 'article',
      heading: '<script>alert(1)</script>',
      body: 'text',
    });
    expect(parsed.success).toBe(false);
    expect(
      baseSectionSpecSchema.safeParse({
        kind: 'article',
        heading: 'Nadpis',
        body: 'text &lt;script&gt;',
      }).success,
    ).toBe(false);
  });

  it('odmítne odkaz, který není absolutní http ani https', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/relativni', 'ftp://a.cz/x']) {
      expect(
        baseSectionSpecSchema.safeParse({ kind: 'cta', label: 'Klik', href: bad }).success,
        bad,
      ).toBe(false);
    }
  });

  it('jde vložit do z.array, tedy je to runtime schéma, ne jen typ', () => {
    const many = z.array(baseSectionSpecSchema).min(1).max(12);
    expect(many.safeParse([{ kind: 'spacer' }]).success).toBe(true);
    expect(many.safeParse([]).success).toBe(false);
  });

  it('výčet druhů odpovídá variantám unie', () => {
    expect([...BASE_SECTION_KINDS].sort()).toEqual([
      'article',
      'bullets',
      'cta',
      'feature',
      'hero',
      'keyValue',
      'quote',
      'spacer',
    ]);
  });

  it('rozparsovaná sekce projde generátorem beze změny tvaru', () => {
    // Schéma a generátor musí mluvit o témž tvaru. Kdyby se rozešly, tenhle
    // test spadne na typu i za běhu, ne až na nevalidním dokumentu.
    const parsed = baseSectionSpecSchema.parse({
      kind: 'hero',
      headline: 'Ahoj',
      cta: { label: 'Dál', href: 'https://example.com' },
    });
    const sections: BaseSectionSpec[] = [parsed];
    const doc = buildBaseTemplate({
      variant: 'newsletter',
      brand,
      language: 'cs',
      sections,
      darkMode: true,
    });
    expect(doc.schemaVersion).toBe(1);
    expect(JSON.stringify(doc)).toContain('Ahoj');
  });
});
