import { describe, expect, it } from 'vitest';
import { baseSectionSpecSchema, buildBaseTemplate } from '@mlain/emails/base';
import { composeSchema, formatZodIssues } from './compose-schema';

describe('schéma strukturovaného výstupu', () => {
  it('přijme platnou kompozici', () => {
    const parsed = composeSchema.safeParse({
      meta: { name: 'Letní výprodej', previewText: 'Slevy až 20 % končí v neděli' },
      sections: [{ kind: 'hero', headline: 'Letní výprodej kol' }],
      paletteHint: 'brand',
    });
    expect(parsed.success).toBe(true);
  });

  it('doplní výchozí paletteHint brand', () => {
    const parsed = composeSchema.parse({
      meta: { name: 'A', previewText: 'B' },
      sections: [{ kind: 'spacer' }],
    });
    expect(parsed.paletteHint).toBe('brand');
  });

  it('odmítne prázdný seznam sekcí a víc než dvanáct sekcí', () => {
    const meta = { name: 'A', previewText: 'B' };
    expect(composeSchema.safeParse({ meta, sections: [] }).success).toBe(false);
    expect(
      composeSchema.safeParse({
        meta,
        sections: new Array(13).fill({ kind: 'spacer' }),
      }).success,
    ).toBe(false);
  });

  it('hlídá délku názvu a preview textu', () => {
    expect(
      composeSchema.safeParse({
        meta: { name: 'x'.repeat(121), previewText: 'B' },
        sections: [{ kind: 'spacer' }],
      }).success,
    ).toBe(false);
    expect(
      composeSchema.safeParse({
        meta: { name: 'A', previewText: 'x'.repeat(151) },
        sections: [{ kind: 'spacer' }],
      }).success,
    ).toBe(false);
  });

  it('formatZodIssues vrátí konkrétní seznam pro opravný pokus', () => {
    const parsed = composeSchema.safeParse({ meta: { name: 'A' }, sections: [] });
    expect(parsed.success).toBe(false);
    const formatted = formatZodIssues(parsed.error!);
    expect(formatted).toMatch(/meta\.previewText/);
    expect(formatted).toMatch(/sections/);
  });
});

/**
 * Schéma sekcí vlastní P08, ale soulad SCHÉMATU S GENERÁTOREM se ověřuje tady:
 * každý druh sekce, který schéma pustí, musí projít skutečným
 * `buildBaseTemplate`. Kdyby P08 druh sekce přejmenoval jen na jednom ze dvou
 * míst, spadne to tady, ne až u zákazníka v editoru.
 */
describe('soulad s blokovým modelem P08', () => {
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

  const sections = [
    {
      kind: 'hero',
      headline: 'Letní výprodej kol',
      subhead: 'Slevy až 20 %',
      cta: { label: 'Prohlédnout kola', href: 'https://kolo-shop.cz/vyprodej' },
    },
    { kind: 'article', heading: 'Novinky', body: 'První odstavec.\n\nDruhý odstavec.' },
    {
      kind: 'feature',
      headline: 'Nový model',
      body: 'Lehčí rám.',
      cta: { label: 'Detail', href: 'https://kolo-shop.cz/model' },
    },
    { kind: 'bullets', heading: 'Co je nového', items: ['Nová kola', 'Delší záruka'] },
    { kind: 'keyValue', rows: [{ label: 'Číslo objednávky', value: '12345' }] },
    { kind: 'quote', text: 'Skvělý obchod.', author: 'Jana N.' },
    { kind: 'cta', label: 'Koupit', href: 'https://kolo-shop.cz' },
    { kind: 'spacer' },
  ];

  it('schéma pustí všech osm druhů sekcí, které P08 zná', () => {
    for (const section of sections) {
      expect(baseSectionSpecSchema.safeParse(section).success).toBe(true);
    }
  });

  it('odmítne neznámý druh sekce', () => {
    expect(baseSectionSpecSchema.safeParse({ kind: 'carousel' }).success).toBe(false);
  });

  it('všechny sekce ze schématu projdou generátorem buildBaseTemplate', () => {
    const parsed = composeSchema.parse({
      meta: { name: 'Kontrola', previewText: 'Kontrola' },
      sections: sections.slice(0, 12),
    });
    const doc = buildBaseTemplate({
      variant: 'newsletter',
      brand,
      language: 'cs',
      sections: parsed.sections,
      darkMode: true,
    });
    expect(doc.schemaVersion).toBe(1);
    expect(Array.isArray(doc.blocks)).toBe(true);
    expect(doc.blocks.length).toBeGreaterThan(0);
  });
});
